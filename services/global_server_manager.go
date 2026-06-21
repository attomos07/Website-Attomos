package services

import (
	"attomos/config"
	"attomos/models"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"
)

// GlobalServerManager gestiona el servidor compartido global para AtomicBots
type GlobalServerManager struct {
	mu sync.Mutex
}

var (
	serverManager     *GlobalServerManager
	serverManagerOnce sync.Once
)

// GetGlobalServerManager obtiene la instancia singleton del manager
func GetGlobalServerManager() *GlobalServerManager {
	serverManagerOnce.Do(func() {
		serverManager = &GlobalServerManager{}
	})
	return serverManager
}

// GetOrCreateAtomicBotsServer obtiene o crea el servidor compartido para AtomicBots.
// Devuelve inmediatamente (el servidor puede estar aún en estado "initializing").
func (gsm *GlobalServerManager) GetOrCreateAtomicBotsServer() (*models.GlobalServer, error) {
	gsm.mu.Lock()
	defer gsm.mu.Unlock()

	// PASO 1: Buscar servidor READY con capacidad disponible
	var server models.GlobalServer
	err := config.DB.Where(
		"purpose = ? AND status = ? AND current_agents < max_agents",
		"atomic-bots",
		"ready",
	).Order("current_agents ASC").First(&server).Error

	if err == nil {
		log.Printf("✅ [GlobalServer] Reutilizando servidor compartido: ID=%d, IP=%s, Status=%s, Agentes=%d/%d",
			server.ID, server.IPAddress, server.Status, server.CurrentAgents, server.MaxAgents)
		return &server, nil
	}

	// PASO 2: Buscar servidor INITIALIZING
	err = config.DB.Where(
		"purpose = ? AND status = ?",
		"atomic-bots",
		"initializing",
	).Order("created_at DESC").First(&server).Error

	if err == nil {
		log.Printf("⏳ [GlobalServer] Servidor en inicialización encontrado: ID=%d, IP=%s, Status=%s",
			server.ID, server.IPAddress, server.Status)
		return &server, nil
	}

	// PASO 3: Crear nuevo servidor
	log.Println("🆕 [GlobalServer] No hay servidores disponibles - Creando nuevo servidor compartido...")

	hetznerService, err := NewHetznerService()
	if err != nil {
		return nil, fmt.Errorf("error inicializando Hetzner: %w", err)
	}

	serverName := fmt.Sprintf("attomos-atomic-bots-global-%d", time.Now().Unix())
	hetznerResp, err := hetznerService.CreateAtomicBotsGlobalServer(serverName)
	if err != nil {
		return nil, fmt.Errorf("error creando servidor en Hetzner: %w", err)
	}

	server = models.GlobalServer{
		Name:            serverName,
		Purpose:         "atomic-bots",
		HetznerServerID: hetznerResp.Server.ID,
		IPAddress:       hetznerResp.Server.PublicNet.IPv4.IP,
		RootPassword:    hetznerResp.RootPassword,
		Status:          "initializing",
		MaxAgents:       100,
		CurrentAgents:   0,
		NextPortNumber:  3001,
		BasePort:        3001,
		MaxPort:         3100,
	}

	if err := config.DB.Create(&server).Error; err != nil {
		hetznerService.DeleteServer(hetznerResp.Server.ID)
		return nil, fmt.Errorf("error guardando servidor en BD: %w", err)
	}

	log.Printf("✅ [GlobalServer] Servidor compartido creado: ID=%d, Hetzner ID=%d, IP=%s",
		server.ID, server.HetznerServerID, server.IPAddress)

	// Marcar como ready en goroutine (flujo normal de despliegue de bots)
	go gsm.waitAndMarkServerReady(&server, hetznerService)

	return &server, nil
}

// GetOrCreateReadyServer es la versión BLOQUEANTE para el flujo de onboarding/upload.
// Espera hasta que el servidor esté completamente listo (nginx corriendo) antes de
// devolver, con un timeout máximo de maxWait.
func (gsm *GlobalServerManager) GetOrCreateReadyServer(maxWait time.Duration) (*models.GlobalServer, error) {
	// Primero intentar encontrar uno ya listo
	var server models.GlobalServer
	if err := config.DB.
		Where("purpose = ? AND status = ? AND current_agents < max_agents", "atomic-bots", "ready").
		Order("current_agents ASC").
		First(&server).Error; err == nil {
		return &server, nil
	}

	// No hay ninguno listo — obtener o crear (puede quedar en "initializing")
	srv, err := gsm.GetOrCreateAtomicBotsServer()
	if err != nil {
		return nil, err
	}

	// Si ya está listo, devolver directamente
	if srv.IsReady() {
		return srv, nil
	}

	// Esperar a que esté listo, recargando desde BD
	log.Printf("⏳ [Upload] Servidor %d aún inicializando — esperando hasta %v...", srv.ID, maxWait)

	deadline := time.Now().Add(maxWait)
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()

	for time.Now().Before(deadline) {
		<-ticker.C

		var fresh models.GlobalServer
		if err := config.DB.First(&fresh, srv.ID).Error; err != nil {
			log.Printf("⚠️  [Upload] Error recargando servidor %d: %v", srv.ID, err)
			continue
		}

		if fresh.IsReady() {
			log.Printf("✅ [Upload] Servidor %d listo para subir imágenes", fresh.ID)
			return &fresh, nil
		}

		if fresh.Status == "error" {
			return nil, fmt.Errorf("servidor %d falló durante inicialización", fresh.ID)
		}

		log.Printf("⏳ [Upload] Servidor %d status=%s — seguimos esperando...", fresh.ID, fresh.Status)
	}

	return nil, fmt.Errorf("timeout esperando que el servidor esté listo (máx %v)", maxWait)
}

// waitAndMarkServerReady espera a que el servidor esté listo y actualiza su estado
func (gsm *GlobalServerManager) waitAndMarkServerReady(server *models.GlobalServer, hetznerService *HetznerService) {
	log.Printf("⏳ [GlobalServer %d] Esperando que el servidor esté en estado 'running'...", server.ID)

	if err := hetznerService.WaitForServer(server.HetznerServerID, 5*time.Minute); err != nil {
		log.Printf("❌ [GlobalServer %d] Error esperando servidor: %v", server.ID, err)
		gsm.mu.Lock()
		server.MarkAsError()
		config.DB.Save(server)
		gsm.mu.Unlock()
		return
	}

	log.Printf("✅ [GlobalServer %d] Servidor en estado 'running'", server.ID)

	go hetznerService.MonitorCloudInitLogs(server.IPAddress, server.RootPassword, 10*time.Minute)

	log.Printf("⏳ [GlobalServer %d] Esperando cloud-init (verificando cada 2 minutos)...", server.ID)

	maxAttempts := 15
	attempt := 0

	for attempt < maxAttempts {
		attempt++

		if attempt > 1 {
			log.Printf("⏳ [GlobalServer %d] Intento %d/%d - Esperando 2 minutos...", server.ID, attempt, maxAttempts)
			time.Sleep(2 * time.Minute)
		} else {
			log.Printf("⏳ [GlobalServer %d] Primera verificación - Esperando 1 minuto...", server.ID)
			time.Sleep(1 * time.Minute)
		}

		log.Printf("🔍 [GlobalServer %d] Verificando estado del servidor (intento %d/%d)...", server.ID, attempt, maxAttempts)

		if err := gsm.verifyServerReady(server); err != nil {
			log.Printf("⚠️  [GlobalServer %d] Intento %d/%d - Servidor aún no listo: %v", server.ID, attempt, maxAttempts, err)

			if attempt >= maxAttempts {
				log.Printf("❌ [GlobalServer %d] Timeout después de %d intentos (%d minutos)",
					server.ID, maxAttempts, maxAttempts*2)
				gsm.mu.Lock()
				server.MarkAsError()
				config.DB.Save(server)
				gsm.mu.Unlock()
				return
			}

			continue
		}

		break
	}

	gsm.mu.Lock()
	server.MarkAsReady()
	config.DB.Save(server)
	gsm.mu.Unlock()

	log.Printf("🎉 [GlobalServer %d] Servidor compartido de AtomicBots LISTO PARA DESPLIEGUES", server.ID)
	log.Printf("📊 [GlobalServer %d] Tiempo total de inicialización: ~%d minutos", server.ID, attempt*2)
}

// verifyServerReady verifica que el servidor esté completamente inicializado
// y configura nginx para servir /uploads/ estáticamente.
func (gsm *GlobalServerManager) verifyServerReady(server *models.GlobalServer) error {
	atomicService := NewAtomicBotDeployService(server.IPAddress, server.RootPassword)

	if err := atomicService.Connect(); err != nil {
		return fmt.Errorf("error conectando por SSH: %w", err)
	}
	defer atomicService.Close()

	// ── [1/4] cloud-init ────────────────────────────────────────────────────
	log.Printf("   🔍 [GlobalServer %d] [1/4] Verificando cloud-init...", server.ID)
	cloudInitCmd := `cloud-init status --wait 2>&1 || echo "TIMEOUT"`
	output, err := atomicService.executeCommand(cloudInitCmd)
	if err != nil || strings.Contains(output, "TIMEOUT") {
		return fmt.Errorf("cloud-init aún no termina")
	}
	if !strings.Contains(output, "done") && !strings.Contains(output, "status: done") {
		return fmt.Errorf("cloud-init en progreso: %s", strings.TrimSpace(output))
	}
	log.Printf("   ✅ [GlobalServer %d] Cloud-init completado", server.ID)

	// ── [2/4] Go ────────────────────────────────────────────────────────────
	log.Printf("   🔍 [GlobalServer %d] [2/4] Verificando Go...", server.ID)
	goCmd := `export PATH=$PATH:/usr/local/go/bin && go version 2>&1`
	goOutput, err := atomicService.executeCommand(goCmd)
	if err != nil || !strings.Contains(goOutput, "go version") {
		return fmt.Errorf("Go no está instalado correctamente: %s", strings.TrimSpace(goOutput))
	}
	log.Printf("   ✅ [GlobalServer %d] Go instalado: %s", server.ID, strings.TrimSpace(goOutput))

	// ── [3/4] GCC ───────────────────────────────────────────────────────────
	log.Printf("   🔍 [GlobalServer %d] [3/4] Verificando GCC...", server.ID)
	gccCmd := `gcc --version 2>&1`
	gccOutput, err := atomicService.executeCommand(gccCmd)
	if err != nil || !strings.Contains(gccOutput, "gcc") {
		return fmt.Errorf("GCC no está instalado correctamente: %s", strings.TrimSpace(gccOutput))
	}
	gccVersion := strings.Split(gccOutput, "\n")[0]
	log.Printf("   ✅ [GlobalServer %d] GCC instalado: %s", server.ID, gccVersion)

	// ── [4/4] nginx para servir /uploads/ ───────────────────────────────────
	// Usamos python3 para escribir el archivo de config nginx sin problemas de
	// heredoc/escaping dentro de un comando SSH en Go.
	log.Printf("   🔍 [GlobalServer %d] [4/4] Configurando nginx para /uploads/...", server.ID)

	nginxSetupCmd := `bash -c '
set -e

# Instalar nginx si no está
if ! command -v nginx &>/dev/null; then
    apt-get update -qq
    apt-get install -y -qq nginx
fi

# Crear directorio de uploads con permisos correctos
mkdir -p /var/www/uploads
chmod 755 /var/www/uploads
chown www-data:www-data /var/www/uploads 2>/dev/null || true

# Escribir config nginx via python3 para evitar problemas de escaping
python3 -c "
import os
conf = """server {
    listen 80 default_server;
    server_name _;

    location /uploads/ {
        alias /var/www/uploads/;
        autoindex off;
        add_header Access-Control-Allow-Origin \"*\";
        add_header Cache-Control \"public, max-age=2592000\";
        expires 30d;
    }
}
"""
os.makedirs(\"/etc/nginx/sites-available\", exist_ok=True)
with open(\"/etc/nginx/sites-available/attomos-uploads\", \"w\") as f:
    f.write(conf)
print(\"config_written\")
"

# Activar el site y desactivar el default si existe
ln -sf /etc/nginx/sites-available/attomos-uploads /etc/nginx/sites-enabled/attomos-uploads
rm -f /etc/nginx/sites-enabled/default

# Validar y recargar nginx
nginx -t 2>&1
systemctl enable nginx
systemctl restart nginx

echo "NGINX_OK"
'`

	nginxOutput, err := atomicService.executeCommand(nginxSetupCmd)
	if err != nil {
		log.Printf("   ❌ [GlobalServer %d] Error configurando nginx: %v — output: %s",
			server.ID, err, strings.TrimSpace(nginxOutput))
		return fmt.Errorf("error configurando nginx: %w", err)
	}
	if !strings.Contains(nginxOutput, "NGINX_OK") {
		log.Printf("   ❌ [GlobalServer %d] nginx no reportó OK — output: %s",
			server.ID, strings.TrimSpace(nginxOutput))
		return fmt.Errorf("nginx no quedó configurado correctamente: %s", strings.TrimSpace(nginxOutput))
	}
	log.Printf("   ✅ [GlobalServer %d] nginx configurado — /uploads/ disponible en puerto 80", server.ID)

	log.Printf("✅ [GlobalServer %d] Health check exitoso - Servidor completamente listo", server.ID)
	return nil
}

// AssignPortToAgent asigna un puerto disponible a un agente
func (gsm *GlobalServerManager) AssignPortToAgent(server *models.GlobalServer) (int, error) {
	gsm.mu.Lock()
	defer gsm.mu.Unlock()

	if server.IsAtCapacity() {
		return 0, fmt.Errorf("servidor a capacidad máxima (%d/%d agentes)", server.CurrentAgents, server.MaxAgents)
	}

	port := server.GetNextPort()
	server.IncrementAgentCount()

	if err := config.DB.Save(server).Error; err != nil {
		return 0, fmt.Errorf("error guardando servidor: %w", err)
	}

	log.Printf("📍 [GlobalServer %d] Puerto asignado: %d (Agentes: %d/%d)",
		server.ID, port, server.CurrentAgents, server.MaxAgents)

	return port, nil
}

// ReleaseAgentPort libera el puerto de un agente eliminado
func (gsm *GlobalServerManager) ReleaseAgentPort(server *models.GlobalServer) error {
	gsm.mu.Lock()
	defer gsm.mu.Unlock()

	server.DecrementAgentCount()

	if err := config.DB.Save(server).Error; err != nil {
		return fmt.Errorf("error guardando servidor: %w", err)
	}

	log.Printf("📍 [GlobalServer %d] Puerto liberado (Agentes: %d/%d)",
		server.ID, server.CurrentAgents, server.MaxAgents)

	return nil
}

// GetServerStatus obtiene el estado actual del servidor
func (gsm *GlobalServerManager) GetServerStatus(serverID uint) (*models.GlobalServer, error) {
	var server models.GlobalServer
	if err := config.DB.First(&server, serverID).Error; err != nil {
		return nil, err
	}
	return &server, nil
}

// ListAllServers lista todos los servidores globales
func (gsm *GlobalServerManager) ListAllServers() ([]models.GlobalServer, error) {
	var servers []models.GlobalServer
	if err := config.DB.Where("purpose = ?", "atomic-bots").Order("created_at DESC").Find(&servers).Error; err != nil {
		return nil, err
	}
	return servers, nil
}

// GetServerMetrics obtiene métricas del servidor
func (gsm *GlobalServerManager) GetServerMetrics(server *models.GlobalServer) map[string]interface{} {
	utilizationPercent := float64(server.CurrentAgents) / float64(server.MaxAgents) * 100

	return map[string]interface{}{
		"server_id":          server.ID,
		"ip_address":         server.IPAddress,
		"status":             server.Status,
		"current_agents":     server.CurrentAgents,
		"max_agents":         server.MaxAgents,
		"utilization":        fmt.Sprintf("%.1f%%", utilizationPercent),
		"available_capacity": server.MaxAgents - server.CurrentAgents,
		"port_range":         fmt.Sprintf("%d-%d", server.BasePort, server.MaxPort),
		"next_port":          server.NextPortNumber,
		"is_ready":           server.IsReady(),
		"is_at_capacity":     server.IsAtCapacity(),
	}
}
