package services

import (
	"attomos/models"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

// TelegramBotDeployService maneja el deploy del bot de Telegram en Hetzner.
// Comparte el mismo servidor compartido global que AtomicBot (WhatsApp Web),
// y sigue el mismo patrón: SSH + SFTP + systemd.
type TelegramBotDeployService struct {
	serverIP       string
	serverPassword string
	sshClient      *ssh.Client
	sftpClient     *sftp.Client
}

// NewTelegramBotDeployService crea instancia del servicio
func NewTelegramBotDeployService(serverIP, serverPassword string) *TelegramBotDeployService {
	return &TelegramBotDeployService{
		serverIP:       serverIP,
		serverPassword: serverPassword,
	}
}

// Connect conecta al servidor vía SSH y SFTP
func (s *TelegramBotDeployService) Connect() error {
	cfg := &ssh.ClientConfig{
		User: "root",
		Auth: []ssh.AuthMethod{
			ssh.Password(s.serverPassword),
		},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         30 * time.Second,
	}

	client, err := ssh.Dial("tcp", s.serverIP+":22", cfg)
	if err != nil {
		return fmt.Errorf("error conectando SSH: %w", err)
	}
	s.sshClient = client

	sftpClient, err := sftp.NewClient(client)
	if err != nil {
		s.sshClient.Close()
		return fmt.Errorf("error conectando SFTP: %w", err)
	}
	s.sftpClient = sftpClient
	return nil
}

// Close cierra conexiones SSH y SFTP
func (s *TelegramBotDeployService) Close() {
	if s.sftpClient != nil {
		s.sftpClient.Close()
	}
	if s.sshClient != nil {
		s.sshClient.Close()
	}
}

// GetSSHClient retorna el cliente SSH
func (s *TelegramBotDeployService) GetSSHClient() *ssh.Client {
	return s.sshClient
}

// botDir retorna el directorio del bot de Telegram para este usuario.
// Se separa del atomic-whatsapp-web usando un subdirectorio propio.
func (s *TelegramBotDeployService) botDir(userID uint) string {
	return fmt.Sprintf("/home/user_%d/atomic-telegram", userID)
}

// DeployTelegramBot es el punto de entrada principal.
// Replica el mismo flujo de 6 pasos que DeployAtomicBot.
func (s *TelegramBotDeployService) DeployTelegramBot(agent *models.Agent, branch *models.MyBusinessInfo, geminiAPIKey string, googleCredentials []byte) error {
	log.Printf("🚀 [Agent %d] Iniciando despliegue de TelegramBot...", agent.ID)

	dir := s.botDir(agent.UserID)

	// PASO 1: Preparar servidor (Go, GCC, nginx — idempotente)
	log.Printf("📦 [Agent %d] PASO 1/6: Preparando servidor...", agent.ID)
	if err := s.prepareServer(dir); err != nil {
		return fmt.Errorf("error preparando servidor: %w", err)
	}

	// PASO 2: Transferir archivos del bot de Telegram
	log.Printf("📤 [Agent %d] PASO 2/6: Transfiriendo archivos del bot...", agent.ID)
	if err := s.TransferBotFiles(agent.UserID, dir); err != nil {
		return fmt.Errorf("error transfiriendo archivos: %w", err)
	}

	// PASO 3: Configurar entorno (.env, business_config.json, google.json)
	log.Printf("⚙️  [Agent %d] PASO 3/6: Configurando entorno...", agent.ID)
	if err := s.configureEnvironment(agent, branch, dir, geminiAPIKey, googleCredentials); err != nil {
		return fmt.Errorf("error configurando entorno: %w", err)
	}

	// PASO 4: Compilar bot en Hetzner
	log.Printf("🔨 [Agent %d] PASO 4/6: Compilando bot en servidor...", agent.ID)
	if err := s.CompileBotOnServer(dir); err != nil {
		return fmt.Errorf("error compilando bot: %w", err)
	}

	// PASO 5: Crear servicio systemd
	log.Printf("🔧 [Agent %d] PASO 5/6: Creando servicio systemd...", agent.ID)
	if err := s.createSystemdService(agent, dir); err != nil {
		return fmt.Errorf("error creando servicio: %w", err)
	}

	// PASO 6: Iniciar bot
	log.Printf("▶️  [Agent %d] PASO 6/6: Iniciando TelegramBot...", agent.ID)
	if err := s.startBot(agent.ID); err != nil {
		diagnosis := s.DiagnoseBotFailure(agent.ID, agent.UserID)
		log.Printf("\n%s\n", diagnosis)
		return fmt.Errorf("error iniciando bot: %w\n\nDIAGNÓSTICO:\n%s", err, diagnosis)
	}

	log.Printf("✅ [Agent %d] TelegramBot desplegado exitosamente", agent.ID)
	return nil
}

// prepareServer instala Go, GCC y nginx si no están presentes (idempotente).
// Es una copia exacta del prepareServer de AtomicBotDeployService.
func (s *TelegramBotDeployService) prepareServer(dir string) error {
	log.Printf("   [1/5] Creando directorios...")
	if output, err := s.executeCommand(fmt.Sprintf("mkdir -p %s/src", dir)); err != nil {
		return fmt.Errorf("error creando directorios: %w\nOutput: %s", err, output)
	}

	log.Printf("   [2/5] Esperando que cloud-init termine...")
	waitCmd := `timeout 300 bash -c 'while fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 || fuser /var/lib/apt/lists/lock >/dev/null 2>&1 || fuser /var/lib/dpkg/lock >/dev/null 2>&1; do echo "Esperando locks de apt..."; sleep 5; done'`
	s.executeCommand(waitCmd)

	log.Printf("   [3/5] Verificando/instalando GCC...")
	gccCmd := `
	timeout 60 bash -c 'while fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1; do sleep 2; done' || true
	if ! command -v gcc &> /dev/null; then
		for i in 1 2 3; do apt-get update -y 2>&1 && break || sleep 10; done
		for i in 1 2 3; do DEBIAN_FRONTEND=noninteractive apt-get install -y build-essential gcc 2>&1 && break || sleep 10; done
	fi
	gcc --version`
	output, err := s.executeCommand(gccCmd)
	if strings.TrimSpace(output) != "" {
		log.Printf("   Output: %s", strings.TrimSpace(output))
	}
	if err != nil {
		return fmt.Errorf("error verificando/instalando GCC: %w", err)
	}

	log.Printf("   [4/5] Verificando/instalando Go...")
	installGoCmd := `
	if ! command -v go &> /dev/null; then
		cd /tmp
		wget -q https://go.dev/dl/go1.24.0.linux-amd64.tar.gz 2>&1
		rm -rf /usr/local/go
		tar -C /usr/local -xzf go1.24.0.linux-amd64.tar.gz 2>&1
		rm go1.24.0.linux-amd64.tar.gz
	fi
	export PATH=$PATH:/usr/local/go/bin
	go version`
	output, err = s.executeCommand(installGoCmd)
	if strings.TrimSpace(output) != "" {
		log.Printf("   Output: %s", strings.TrimSpace(output))
	}
	if err != nil {
		return fmt.Errorf("error instalando Go: %w", err)
	}

	log.Printf("   [5/5] Verificando/configurando nginx...")
	nginxCmd := `bash -c '
set -e
if ! command -v nginx &>/dev/null; then
    timeout 60 bash -c "while fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1; do sleep 2; done" || true
    apt-get install -y -qq nginx
fi
mkdir -p /var/www/uploads
chmod 755 /var/www/uploads
python3 -c "
import os
conf = \"\"\"server {
    listen 80 default_server;
    server_name _;
    location /uploads/ {
        alias /var/www/uploads/;
        autoindex off;
        add_header Access-Control-Allow-Origin \\\"*\\\";
        add_header Cache-Control \\\"public, max-age=2592000\\\";
        expires 30d;
    }
}
\"\"\"
dest = \"/etc/nginx/sites-available/attomos-uploads\"
try:
    with open(dest) as f:
        if f.read() == conf:
            print(\"nginx_config_sin_cambios\"); exit(0)
except FileNotFoundError:
    pass
with open(dest, \"w\") as f:
    f.write(conf)
print(\"nginx_config_escrita\")
"
ln -sf /etc/nginx/sites-available/attomos-uploads /etc/nginx/sites-enabled/attomos-uploads
rm -f /etc/nginx/sites-enabled/default
nginx -t 2>&1
systemctl enable nginx --quiet
if systemctl is-active nginx --quiet; then systemctl reload nginx; else systemctl start nginx; fi
echo "NGINX_OK"
'`
	nginxOut, nginxErr := s.executeCommand(nginxCmd)
	if nginxErr != nil || !strings.Contains(nginxOut, "NGINX_OK") {
		log.Printf("   ⚠️  nginx no se pudo configurar (no crítico): %v", nginxErr)
	} else {
		log.Printf("   ✅ nginx OK")
	}

	log.Printf("   ✅ Servidor preparado")
	return nil
}

// TransferBotFiles sube el código fuente del bot de Telegram desde
// ./providers/atomic-telegram al servidor Hetzner.
func (s *TelegramBotDeployService) TransferBotFiles(_ uint, dir string) error {
	// ── Fuente local del bot de Telegram ──────────────────────────────────
	localBotPath := "./providers/atomic-telegram"

	filesToTransfer := []string{
		"go.mod",
		"go.sum",
		"main.go",
		"src",
	}

	for _, file := range filesToTransfer {
		localPath := filepath.Join(localBotPath, file)
		remotePath := filepath.Join(dir, file)

		// ¿Directorio?
		info, err := os.ReadDir(localPath)
		if err == nil && len(info) > 0 {
			if err := s.uploadDirectory(localPath, remotePath); err != nil {
				return fmt.Errorf("error subiendo directorio %s: %w", file, err)
			}
			log.Printf("   ✅ Directorio transferido: %s", file)
		} else {
			if err := s.uploadFile(localPath, remotePath); err != nil {
				return fmt.Errorf("error subiendo archivo %s: %w", file, err)
			}
			log.Printf("   ✅ Archivo transferido: %s", file)
		}
	}

	log.Printf("   ✅ Archivos del TelegramBot transferidos")
	return nil
}

// configureEnvironment escribe .env, business_config.json y google.json
func (s *TelegramBotDeployService) configureEnvironment(agent *models.Agent, branch *models.MyBusinessInfo, dir, geminiAPIKey string, googleCredentials []byte) error {
	// business_config.json — reutiliza generateBusinessConfig de AtomicBotDeployService
	// Instanciamos un AtomicBotDeployService temporal solo para generar la config
	atomicHelper := &AtomicBotDeployService{}
	businessConfig := atomicHelper.generateBusinessConfig(agent, branch)
	businessJSON, err := json.MarshalIndent(businessConfig, "", "  ")
	if err != nil {
		return fmt.Errorf("error serializando business_config: %w", err)
	}

	configPath := fmt.Sprintf("%s/business_config.json", dir)
	configFile, err := s.sftpClient.Create(configPath)
	if err != nil {
		return fmt.Errorf("error creando business_config.json: %w", err)
	}
	configFile.Write(businessJSON)
	configFile.Close()
	log.Printf("   ✅ business_config.json creado")

	// .env
	envContent := s.generateEnvFile(agent, geminiAPIKey)
	envPath := fmt.Sprintf("%s/.env", dir)
	envFile, err := s.sftpClient.Create(envPath)
	if err != nil {
		return fmt.Errorf("error creando .env: %w", err)
	}
	envFile.Write([]byte(envContent))
	envFile.Close()
	log.Printf("   ✅ .env creado")

	// google.json (opcional)
	if len(googleCredentials) > 0 {
		googlePath := fmt.Sprintf("%s/google.json", dir)
		googleFile, err := s.sftpClient.Create(googlePath)
		if err != nil {
			return fmt.Errorf("error creando google.json: %w", err)
		}
		googleFile.Write(googleCredentials)
		googleFile.Close()
		log.Printf("   ✅ google.json creado")
	}

	log.Printf("   ✅ Entorno configurado")
	return nil
}

// generateEnvFile genera el contenido del .env para el bot de Telegram.
// Igual que AtomicBot pero con TELEGRAM_BOT_TOKEN en lugar de variables WhatsApp.
func (s *TelegramBotDeployService) generateEnvFile(agent *models.Agent, geminiAPIKey string) string {
	var env strings.Builder

	env.WriteString("# Configuración del Bot de Telegram\n")
	env.WriteString(fmt.Sprintf("AGENT_ID=%d\n", agent.ID))
	env.WriteString(fmt.Sprintf("AGENT_NAME=%s\n", agent.Name))
	env.WriteString(fmt.Sprintf("PORT=%d\n", agent.Port))
	env.WriteString("\n")

	// Token de Telegram — se guarda en el campo PhoneNumber del agente
	// (el onboarding reutiliza ese campo para el token al crear agentes Telegram)
	env.WriteString("# Telegram Bot Token\n")
	env.WriteString(fmt.Sprintf("TELEGRAM_BOT_TOKEN=%s\n", agent.PhoneNumber))
	env.WriteString("\n")

	// Gemini AI
	if geminiAPIKey != "" {
		env.WriteString("# Gemini AI\n")
		env.WriteString(fmt.Sprintf("GEMINI_API_KEY=%s\n", geminiAPIKey))
		env.WriteString("\n")
	}

	// Google Sheets
	env.WriteString("#Integracion Con Google Sheets Para Agendamiento\n")
	if agent.GoogleSheetID != "" {
		env.WriteString(fmt.Sprintf("SPREADSHEETID=%s\n", agent.GoogleSheetID))
	} else {
		env.WriteString("#SPREADSHEETID=\n")
	}
	env.WriteString("\n")

	// Google Calendar
	env.WriteString("#Integracion Con Google Calendar Para Agendar Los Eventos\n")
	if agent.GoogleCalendarID != "" {
		env.WriteString(fmt.Sprintf("GOOGLE_CALENDAR_ID=%s\n", agent.GoogleCalendarID))
	} else {
		env.WriteString("#GOOGLE_CALENDAR_ID=\n")
	}
	env.WriteString("\n")

	// Backend Attomos (pagos, pedidos, citas)
	attomosURL := os.Getenv("BASE_URL")
	botToken := os.Getenv("BOT_API_TOKEN")
	env.WriteString("# Pasarela de Pagos del Bot\n")
	env.WriteString(fmt.Sprintf("ATTOMOS_API_URL=%s\n", attomosURL))
	env.WriteString(fmt.Sprintf("BOT_API_TOKEN=%s\n", botToken))
	env.WriteString(fmt.Sprintf("BRANCH_ID=%d\n", agent.BranchID))
	env.WriteString("\n")

	return env.String()
}

// CompileBotOnServer compila el binario del bot de Telegram en Hetzner
func (s *TelegramBotDeployService) CompileBotOnServer(dir string) error {
	compileCmd := fmt.Sprintf(`
	export PATH=$PATH:/usr/local/go/bin
	export HOME=/root
	cd %s

	echo "Inicializando módulo Go..."
	go mod tidy 2>&1 || { echo "Error en go mod tidy"; exit 1; }

	echo "Compilando TelegramBot..."
	go build -o telegram-bot main.go 2>&1 || { echo "Error compilando bot"; exit 1; }

	chmod +x telegram-bot
	echo "Compilación exitosa"
	ls -lh telegram-bot`, dir)

	output, err := s.executeCommand(compileCmd)
	if strings.TrimSpace(output) != "" {
		log.Printf("   Output compilación:\n%s", strings.TrimSpace(output))
	}
	if err != nil {
		return fmt.Errorf("error compilando: %w", err)
	}

	log.Printf("   ✅ TelegramBot compilado exitosamente")
	return nil
}

// createSystemdService crea el servicio systemd para el bot de Telegram.
// El nombre del servicio es telegram-bot-{agentID} para no colisionar con
// los servicios atomic-bot-{agentID} del bot de WhatsApp.
func (s *TelegramBotDeployService) createSystemdService(agent *models.Agent, dir string) error {
	serviceName := fmt.Sprintf("telegram-bot-%d", agent.ID)
	serviceContent := fmt.Sprintf(`[Unit]
Description=TelegramBot - Attomos Agent %d
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=%s
ExecStart=%s/telegram-bot
Restart=always
RestartSec=10
StandardOutput=append:/var/log/telegram-bot-%d.log
StandardError=append:/var/log/telegram-bot-%d-error.log
Environment="PATH=/usr/local/go/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

[Install]
WantedBy=multi-user.target`,
		agent.ID, dir, dir, agent.ID, agent.ID)

	servicePath := fmt.Sprintf("/etc/systemd/system/%s.service", serviceName)
	serviceFile, err := s.sftpClient.Create(servicePath)
	if err != nil {
		return fmt.Errorf("error creando archivo de servicio: %w", err)
	}
	serviceFile.Write([]byte(serviceContent))
	serviceFile.Close()

	s.executeCommand("systemctl daemon-reload")
	s.executeCommand(fmt.Sprintf("systemctl enable %s", serviceName))

	log.Printf("   ✅ Servicio systemd telegram-bot-%d creado y habilitado", agent.ID)
	return nil
}

// startBot inicia el servicio systemd del bot
func (s *TelegramBotDeployService) startBot(agentID uint) error {
	serviceName := fmt.Sprintf("telegram-bot-%d", agentID)

	s.executeCommand(fmt.Sprintf("systemctl stop %s 2>/dev/null || true", serviceName))
	s.executeCommand(fmt.Sprintf("systemctl enable %s", serviceName))

	if _, err := s.executeCommand(fmt.Sprintf("systemctl start %s", serviceName)); err != nil {
		return fmt.Errorf("error iniciando servicio: %w", err)
	}

	time.Sleep(3 * time.Second)

	statusOutput, err := s.executeCommand(fmt.Sprintf("systemctl is-active %s", serviceName))
	if err != nil || !strings.Contains(statusOutput, "active") {
		return fmt.Errorf("servicio no está activo: %s", statusOutput)
	}

	log.Printf("   ✅ TelegramBot iniciado correctamente")
	return nil
}

// StopBot detiene el servicio systemd del bot de Telegram
func (s *TelegramBotDeployService) StopBot(agentID uint) error {
	serviceName := fmt.Sprintf("telegram-bot-%d", agentID)
	s.executeCommand(fmt.Sprintf("systemctl stop %s 2>/dev/null || true", serviceName))
	s.executeCommand(fmt.Sprintf("systemctl disable %s 2>/dev/null || true", serviceName))
	log.Printf("✅ [Agent %d] TelegramBot detenido", agentID)
	return nil
}

// RestartBot reinicia el bot de Telegram
func (s *TelegramBotDeployService) RestartBot(agentID uint) error {
	serviceName := fmt.Sprintf("telegram-bot-%d", agentID)
	s.executeCommand(fmt.Sprintf("systemctl enable %s", serviceName))
	if _, err := s.executeCommand(fmt.Sprintf("systemctl restart %s", serviceName)); err != nil {
		return fmt.Errorf("error reiniciando: %w", err)
	}
	log.Printf("✅ [Agent %d] TelegramBot reiniciado", agentID)
	return nil
}

// UpdateBusinessConfig actualiza el business_config.json y reinicia el bot
func (s *TelegramBotDeployService) UpdateBusinessConfig(agent *models.Agent, branch *models.MyBusinessInfo) error {
	atomicHelper := &AtomicBotDeployService{}
	businessConfig := atomicHelper.generateBusinessConfig(agent, branch)
	businessJSON, err := json.MarshalIndent(businessConfig, "", "  ")
	if err != nil {
		return fmt.Errorf("error serializando business_config: %w", err)
	}

	dir := s.botDir(agent.UserID)
	configPath := fmt.Sprintf("%s/business_config.json", dir)

	configFile, err := s.sftpClient.Create(configPath)
	if err != nil {
		return fmt.Errorf("error creando business_config.json: %w", err)
	}
	configFile.Write(businessJSON)
	configFile.Close()

	log.Printf("   ✅ [Agent %d] business_config.json actualizado (%d bytes)", agent.ID, len(businessJSON))

	if err := s.RestartBot(agent.ID); err != nil {
		log.Printf("   ⚠️  [Agent %d] No se pudo reiniciar bot: %v", agent.ID, err)
	}
	return nil
}

// UpdateGeminiAPIKey actualiza la Gemini API key en el .env y reinicia
func (s *TelegramBotDeployService) UpdateGeminiAPIKey(agent *models.Agent, apiKey string) error {
	dir := s.botDir(agent.UserID)
	return s.updateEnvVar(agent, dir, "GEMINI_API_KEY", apiKey)
}

// UpdatePaymentConfig actualiza las variables de pago en el .env
func (s *TelegramBotDeployService) UpdatePaymentConfig(agent *models.Agent) error {
	log.Printf("🔄 [Agent %d] Actualizando variables de pago (Telegram)...", agent.ID)

	dir := s.botDir(agent.UserID)
	envPath := fmt.Sprintf("%s/.env", dir)

	envFile, err := s.sftpClient.Open(envPath)
	if err != nil {
		return fmt.Errorf("error abriendo .env: %w", err)
	}

	buf := make([]byte, 64*1024)
	n, _ := envFile.Read(buf)
	envFile.Close()
	currentContent := string(buf[:n])

	lines := strings.Split(currentContent, "\n")
	updated := make([]string, 0, len(lines))

	attomosURL := os.Getenv("BASE_URL")
	botToken := os.Getenv("BOT_API_TOKEN")

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "ATTOMOS_API_URL=") ||
			strings.HasPrefix(trimmed, "BOT_API_TOKEN=") ||
			strings.HasPrefix(trimmed, "BRANCH_ID=") ||
			strings.Contains(line, "Pasarela de Pagos") {
			continue
		}
		updated = append(updated, line)
	}

	updated = append(updated,
		"# Pasarela de Pagos del Bot",
		fmt.Sprintf("ATTOMOS_API_URL=%s", attomosURL),
		fmt.Sprintf("BOT_API_TOKEN=%s", botToken),
		fmt.Sprintf("BRANCH_ID=%d", agent.BranchID),
		"",
	)

	newContent := strings.Join(updated, "\n")
	tmpPath := envPath + ".tmp"
	tmpFile, err := s.sftpClient.Create(tmpPath)
	if err != nil {
		return fmt.Errorf("error creando tmp: %w", err)
	}
	tmpFile.Write([]byte(newContent))
	tmpFile.Close()

	s.executeCommand(fmt.Sprintf("mv %s %s", tmpPath, envPath))
	s.RestartBot(agent.ID)

	log.Printf("✅ [Agent %d] Variables de pago actualizadas (Telegram)", agent.ID)
	return nil
}

// updateEnvVar helper genérico para actualizar una variable en el .env
func (s *TelegramBotDeployService) updateEnvVar(agent *models.Agent, dir, key, value string) error {
	envPath := fmt.Sprintf("%s/.env", dir)

	envFile, err := s.sftpClient.Open(envPath)
	if err != nil {
		return fmt.Errorf("error abriendo .env: %w", err)
	}
	buf := make([]byte, 64*1024)
	n, _ := envFile.Read(buf)
	envFile.Close()

	lines := strings.Split(string(buf[:n]), "\n")
	found := false
	for i, line := range lines {
		if strings.HasPrefix(strings.TrimSpace(line), key+"=") ||
			strings.HasPrefix(strings.TrimSpace(line), "#"+key+"=") {
			if value != "" {
				lines[i] = fmt.Sprintf("%s=%s", key, value)
			} else {
				lines[i] = fmt.Sprintf("#%s=", key)
			}
			found = true
			break
		}
	}
	if !found && value != "" {
		lines = append(lines, fmt.Sprintf("%s=%s", key, value))
	}

	newContent := strings.Join(lines, "\n")
	tmpPath := envPath + ".tmp"
	tmpFile, err := s.sftpClient.Create(tmpPath)
	if err != nil {
		return fmt.Errorf("error creando tmp: %w", err)
	}
	tmpFile.Write([]byte(newContent))
	tmpFile.Close()

	s.executeCommand(fmt.Sprintf("mv %s %s", tmpPath, envPath))
	s.RestartBot(agent.ID)
	return nil
}

// GetBotLogs obtiene los últimos N líneas del log del bot
func (s *TelegramBotDeployService) GetBotLogs(agentID uint, lines int) (string, error) {
	output, err := s.executeCommand(fmt.Sprintf("tail -n %d /var/log/telegram-bot-%d.log 2>/dev/null || echo ''", lines, agentID))
	if err != nil {
		return "", fmt.Errorf("error leyendo logs: %w", err)
	}
	return output, nil
}

// DiagnoseBotFailure genera diagnóstico cuando el bot falla al iniciar
func (s *TelegramBotDeployService) DiagnoseBotFailure(agentID uint, userID uint) string {
	var d strings.Builder
	d.WriteString("🔍 DIAGNÓSTICO TELEGRAM BOT\n")
	d.WriteString("═══════════════════════════════════\n\n")

	dir := s.botDir(userID)

	commands := []struct {
		label string
		cmd   string
	}{
		{"📁 ARCHIVOS", fmt.Sprintf("ls -lh %s", dir)},
		{"⚙️  .ENV (sin secrets)", fmt.Sprintf("cat %s/.env | grep -v TOKEN | grep -v API_KEY", dir)},
		{"📋 BUSINESS CONFIG", fmt.Sprintf("cat %s/business_config.json | head -20", dir)},
		{"🔧 ESTADO SERVICIO", fmt.Sprintf("systemctl status telegram-bot-%d --no-pager -l", agentID)},
		{"📝 ÚLTIMOS LOGS", fmt.Sprintf("tail -n 50 /var/log/telegram-bot-%d.log 2>&1 || journalctl -u telegram-bot-%d -n 50 --no-pager", agentID, agentID)},
		{"❌ LOGS DE ERROR", fmt.Sprintf("tail -n 30 /var/log/telegram-bot-%d-error.log 2>&1", agentID)},
	}

	for _, c := range commands {
		d.WriteString(c.label + "\n")
		output, err := s.executeCommand(c.cmd)
		if err != nil {
			d.WriteString(fmt.Sprintf("❌ Error: %v\n", err))
		} else if strings.TrimSpace(output) != "" {
			d.WriteString(output + "\n")
		} else {
			d.WriteString("(vacío)\n")
		}
		d.WriteString("\n")
	}

	return d.String()
}

// ── SSH helpers ───────────────────────────────────────────────────────────────

func (s *TelegramBotDeployService) executeCommand(cmd string) (string, error) {
	session, err := s.sshClient.NewSession()
	if err != nil {
		return "", fmt.Errorf("error creando sesión: %w", err)
	}
	defer session.Close()
	session.Setenv("PATH", "/usr/local/go/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin")
	output, err := session.CombinedOutput(cmd)
	if err != nil {
		return string(output), fmt.Errorf("comando falló: %s", err)
	}
	return string(output), nil
}

func (s *TelegramBotDeployService) uploadFile(localPath, remotePath string) error {
	data, err := os.ReadFile(localPath)
	if err != nil {
		return fmt.Errorf("error leyendo archivo local: %w", err)
	}
	s.executeCommand(fmt.Sprintf("mkdir -p %s", filepath.Dir(remotePath)))
	remoteFile, err := s.sftpClient.Create(remotePath)
	if err != nil {
		return fmt.Errorf("error creando archivo remoto: %w", err)
	}
	defer remoteFile.Close()
	_, err = remoteFile.Write(data)
	return err
}

func (s *TelegramBotDeployService) uploadDirectory(localPath, remotePath string) error {
	s.executeCommand(fmt.Sprintf("mkdir -p %s", remotePath))
	entries, err := os.ReadDir(localPath)
	if err != nil {
		return fmt.Errorf("error leyendo directorio local: %w", err)
	}
	for _, entry := range entries {
		lp := filepath.Join(localPath, entry.Name())
		rp := filepath.Join(remotePath, entry.Name())
		if entry.IsDir() {
			if err := s.uploadDirectory(lp, rp); err != nil {
				return err
			}
		} else {
			if err := s.uploadFile(lp, rp); err != nil {
				return err
			}
		}
	}
	return nil
}
