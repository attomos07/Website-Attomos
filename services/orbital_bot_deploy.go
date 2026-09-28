package services

import (
	"attomos/models"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

type OrbitalBotDeployService struct {
	serverIP       string
	serverPassword string
	sshClient      *ssh.Client
	sftpClient     *sftp.Client
}

// BusinessConfig estructura para generar business_config.json
type OrbitalBusinessConfig struct {
	AgentName                  string           `json:"agentName"`
	BusinessType               string           `json:"businessType"`
	PhoneNumber                string           `json:"phoneNumber"`
	Address                    string           `json:"address"`
	BusinessHours              string           `json:"business_hours"`
	GoogleMapsLink             string           `json:"google_maps_link"`
	Services                   []OrbitalService `json:"services"`
	DefaultAppointmentDuration int              `json:"default_appointment_duration"`
	WelcomeMessage             string           `json:"welcome_message"`
	AutoResponseEnabled        bool             `json:"auto_response_enabled"`
}

type OrbitalService struct {
	Name        string  `json:"name"`
	Description string  `json:"description"`
	Duration    int     `json:"duration"`
	Price       float64 `json:"price"`
}

// NewOrbitalBotDeployService crea instancia del servicio
func NewOrbitalBotDeployService(serverIP, serverPassword string) *OrbitalBotDeployService {
	return &OrbitalBotDeployService{
		serverIP:       serverIP,
		serverPassword: serverPassword,
	}
}

// Connect conecta al servidor vía SSH y SFTP
func (s *OrbitalBotDeployService) Connect() error {
	config := &ssh.ClientConfig{
		User: "root",
		Auth: []ssh.AuthMethod{
			ssh.Password(s.serverPassword),
		},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         30 * time.Second,
	}

	client, err := ssh.Dial("tcp", s.serverIP+":22", config)
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
func (s *OrbitalBotDeployService) Close() {
	if s.sftpClient != nil {
		s.sftpClient.Close()
	}
	if s.sshClient != nil {
		s.sshClient.Close()
	}
}

// DeployOrbitalBot despliega el bot de Go con Meta API en servidor INDIVIDUAL
func (s *OrbitalBotDeployService) DeployOrbitalBot(agent *models.Agent, geminiAPIKey string, googleCredentials []byte) error {
	log.Printf("🚀 [Agent %d] Iniciando despliegue de OrbitalBot (Meta API - Servidor Individual)...", agent.ID)

	botDir := fmt.Sprintf("/opt/orbital-bot-%d", agent.ID)

	// PASO 1: Preparar servidor
	log.Printf("📦 [Agent %d] PASO 1/6: Preparando servidor...", agent.ID)
	if err := s.prepareServer(botDir); err != nil {
		return fmt.Errorf("error preparando servidor: %w", err)
	}

	// PASO 2: Transferir archivos del bot
	log.Printf("📤 [Agent %d] PASO 2/6: Transfiriendo archivos del bot...", agent.ID)
	if err := s.transferBotFiles(botDir); err != nil {
		return fmt.Errorf("error transfiriendo archivos: %w", err)
	}

	// PASO 3: Configurar entorno
	log.Printf("⚙️  [Agent %d] PASO 3/6: Configurando entorno...", agent.ID)
	if err := s.configureEnvironment(agent, botDir, geminiAPIKey, googleCredentials); err != nil {
		return fmt.Errorf("error configurando entorno: %w", err)
	}

	// PASO 4: Compilar bot
	log.Printf("🔨 [Agent %d] PASO 4/6: Compilando bot en servidor...", agent.ID)
	if err := s.compileBotOnServer(botDir); err != nil {
		return fmt.Errorf("error compilando bot: %w", err)
	}

	// PASO 5: Crear servicio systemd
	log.Printf("🔧 [Agent %d] PASO 5/6: Creando servicio systemd...", agent.ID)
	if err := s.createSystemdService(agent, botDir); err != nil {
		return fmt.Errorf("error creando servicio: %w", err)
	}

	// PASO 6: Iniciar bot
	log.Printf("▶️  [Agent %d] PASO 6/6: Iniciando OrbitalBot...", agent.ID)
	if err := s.startBot(agent.ID); err != nil {
		log.Printf("❌ [Agent %d] Error iniciando bot, generando diagnóstico...", agent.ID)
		diagnosis := s.DiagnoseBotFailure(agent.ID)
		log.Printf("\n%s\n", diagnosis)
		return fmt.Errorf("error iniciando bot: %w\n\nDIAGNÓSTICO:\n%s", err, diagnosis)
	}

	log.Printf("✅ [Agent %d] OrbitalBot desplegado exitosamente", agent.ID)
	return nil
}

// prepareServer prepara el servidor (instala Go, GCC, nginx para uploads)
func (s *OrbitalBotDeployService) prepareServer(botDir string) error {
	// Crear directorios
	log.Printf("   [1/5] Creando directorios...")
	if output, err := s.executeCommand(fmt.Sprintf("mkdir -p %s/src", botDir)); err != nil {
		return fmt.Errorf("error creando directorios: %w\nOutput: %s", err, output)
	}

	// Esperar a que cloud-init libere locks de apt
	log.Printf("   [2/5] Esperando que cloud-init termine...")
	waitCmd := `timeout 300 bash -c 'while fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 || fuser /var/lib/apt/lists/lock >/dev/null 2>&1 || fuser /var/lib/dpkg/lock >/dev/null 2>&1; do echo "Esperando locks de apt..."; sleep 5; done'`
	if output, err := s.executeCommand(waitCmd); err != nil {
		log.Printf("   ⚠️  Timeout esperando locks (continuando de todas formas): %v", err)
	} else if strings.TrimSpace(output) != "" {
		log.Printf("   %s", strings.TrimSpace(output))
	}

	// Verificar e instalar GCC/build-essential
	log.Printf("   [3/5] Verificando/instalando GCC...")
	gccCmd := `
	timeout 60 bash -c 'while fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1; do sleep 2; done' || true
	
	if ! command -v gcc &> /dev/null; then
		echo "Instalando build-essential y gcc..."
		
		for i in 1 2 3; do
			apt-get update -y 2>&1 && break || {
				echo "Intento $i/3 fallido, esperando 10s..."
				sleep 10
			}
		done
		
		for i in 1 2 3; do
			DEBIAN_FRONTEND=noninteractive apt-get install -y build-essential gcc 2>&1 && break || {
				echo "Intento $i/3 fallido, esperando 10s..."
				sleep 10
			}
		done
		
		echo "Instalación completada"
	else
		echo "GCC ya está instalado"
	fi
	gcc --version`

	output, err := s.executeCommand(gccCmd)
	if strings.TrimSpace(output) != "" {
		log.Printf("   Output: %s", strings.TrimSpace(output))
	}
	if err != nil {
		return fmt.Errorf("error verificando/instalando GCC: %w", err)
	}

	// Instalar Go si no existe
	log.Printf("   [4/5] Verificando/instalando Go...")
	installGoCmd := `
	if ! command -v go &> /dev/null; then
		echo "Descargando Go 1.24..."
		cd /tmp
		wget -q https://go.dev/dl/go1.24.0.linux-amd64.tar.gz 2>&1 || {
			echo "Error descargando Go"
			exit 1
		}
		
		echo "Extrayendo Go..."
		rm -rf /usr/local/go
		tar -C /usr/local -xzf go1.24.0.linux-amd64.tar.gz 2>&1 || {
			echo "Error extrayendo Go"
			exit 1
		}
		
		rm go1.24.0.linux-amd64.tar.gz
		echo "Go instalado correctamente"
	else
		echo "Go ya está instalado"
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

	// Configurar nginx para servir /uploads/ en puerto 8080.
	// OrbitalBot usa servidores individuales con URLs http://{ip}:8080/uploads/branch_X/...
	// El bot orbital corre en agent.Port (distinto de 8080), nginx toma 8080 libremente.
	// Idempotente: si ya está configurado igual, no hace nada.
	log.Printf("   [5/5] Verificando/configurando nginx para /uploads/ (puerto 8080)...")
	nginxCmd := `bash -c '
set -e

if ! command -v nginx &>/dev/null; then
    timeout 60 bash -c "while fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1; do sleep 2; done" || true
    apt-get install -y -qq nginx
    echo "nginx_instalado"
else
    echo "nginx_ya_existe"
fi

mkdir -p /var/www/uploads
chmod 755 /var/www/uploads

python3 -c "
import os
conf = \"\"\"server {
    listen 8080;
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
os.makedirs(\"/etc/nginx/sites-available\", exist_ok=True)
dest = \"/etc/nginx/sites-available/attomos-uploads-orbital\"
try:
    with open(dest) as f:
        existing = f.read()
    if existing == conf:
        print(\"nginx_config_sin_cambios\")
        exit(0)
except FileNotFoundError:
    pass
with open(dest, \"w\") as f:
    f.write(conf)
print(\"nginx_config_escrita\")
"

ln -sf /etc/nginx/sites-available/attomos-uploads-orbital /etc/nginx/sites-enabled/attomos-uploads-orbital

nginx -t 2>&1
systemctl enable nginx --quiet
if systemctl is-active nginx --quiet; then
    systemctl reload nginx
else
    systemctl start nginx
fi

echo "NGINX_OK"
'`

	nginxOutput, nginxErr := s.executeCommand(nginxCmd)
	if nginxErr != nil || !strings.Contains(nginxOutput, "NGINX_OK") {
		log.Printf("   ⚠️  [prepareServer] nginx no se pudo configurar (las imágenes pueden no verse): %v — output: %s",
			nginxErr, strings.TrimSpace(nginxOutput))
	} else {
		log.Printf("   ✅ nginx configurado — /uploads/ disponible en puerto 8080")
	}

	log.Printf("   ✅ Servidor preparado correctamente")
	return nil
}

// transferBotFiles transfiere los archivos del bot al servidor
func (s *OrbitalBotDeployService) transferBotFiles(botDir string) error {
	localBotPath := "./providers/orbital-meta-whatsapp"

	filesToTransfer := []string{
		"go.mod",
		"go.sum",
		"main.go",
		"src",
	}

	for _, file := range filesToTransfer {
		localPath := filepath.Join(localBotPath, file)
		remotePath := filepath.Join(botDir, file)

		info, err := os.ReadDir(localPath)
		if err == nil && len(info) > 0 {
			// Es un directorio
			if err := s.uploadDirectory(localPath, remotePath); err != nil {
				return fmt.Errorf("error subiendo directorio %s: %w", file, err)
			}
			log.Printf("   ✅ Directorio transferido: %s", file)
		} else {
			// Es un archivo
			if err := s.uploadFile(localPath, remotePath); err != nil {
				return fmt.Errorf("error subiendo archivo %s: %w", file, err)
			}
			log.Printf("   ✅ Archivo transferido: %s", file)
		}
	}

	log.Printf("   ✅ Archivos del bot transferidos correctamente")
	return nil
}

// configureEnvironment configura el entorno (.env y business_config.json)
func (s *OrbitalBotDeployService) configureEnvironment(agent *models.Agent, botDir, geminiAPIKey string, googleCredentials []byte) error {
	// Generar business_config.json
	businessConfig := s.generateBusinessConfig(agent)
	businessJSON, err := json.MarshalIndent(businessConfig, "", "  ")
	if err != nil {
		return fmt.Errorf("error serializando business_config: %w", err)
	}

	businessConfigPath := fmt.Sprintf("%s/business_config.json", botDir)
	businessConfigFile, err := s.sftpClient.Create(businessConfigPath)
	if err != nil {
		return fmt.Errorf("error creando business_config.json: %w", err)
	}
	defer businessConfigFile.Close()

	if _, err := businessConfigFile.Write(businessJSON); err != nil {
		return fmt.Errorf("error escribiendo business_config.json: %w", err)
	}
	log.Printf("   ✅ business_config.json creado")

	// Generar .env
	envContent := s.generateEnvFile(agent, geminiAPIKey)
	envPath := fmt.Sprintf("%s/.env", botDir)
	envFile, err := s.sftpClient.Create(envPath)
	if err != nil {
		return fmt.Errorf("error creando .env: %w", err)
	}
	defer envFile.Close()

	if _, err := envFile.Write([]byte(envContent)); err != nil {
		return fmt.Errorf("error escribiendo .env: %w", err)
	}
	log.Printf("   ✅ .env creado")

	// Crear google.json si hay credenciales
	if len(googleCredentials) > 0 {
		googleJSONPath := fmt.Sprintf("%s/google.json", botDir)
		googleJSONFile, err := s.sftpClient.Create(googleJSONPath)
		if err != nil {
			return fmt.Errorf("error creando google.json: %w", err)
		}
		defer googleJSONFile.Close()

		if _, err := googleJSONFile.Write(googleCredentials); err != nil {
			return fmt.Errorf("error escribiendo google.json: %w", err)
		}
		log.Printf("   ✅ google.json creado")
	}

	log.Printf("   ✅ Entorno configurado correctamente")
	return nil
}

// generateBusinessConfig genera la configuración del negocio
func (s *OrbitalBotDeployService) generateBusinessConfig(agent *models.Agent) *OrbitalBusinessConfig {
	config := &OrbitalBusinessConfig{
		AgentName:                  agent.Name,
		BusinessType:               agent.BusinessType,
		PhoneNumber:                agent.PhoneNumber,
		Address:                    "",
		BusinessHours:              formatSchedule(agent.Config.Schedule),
		GoogleMapsLink:             "",
		Services:                   convertServicesToOrbital(agent.Config.Services),
		DefaultAppointmentDuration: 60,
		WelcomeMessage:             agent.Config.WelcomeMessage,
		AutoResponseEnabled:        true,
	}

	// Si WelcomeMessage está vacío, usar uno por defecto
	if config.WelcomeMessage == "" {
		config.WelcomeMessage = fmt.Sprintf("¡Bienvenido a %s! ¿En qué puedo ayudarte?", agent.Name)
	}

	return config
}

func formatSchedule(schedule models.Schedule) string {
	days := []struct {
		name string
		day  models.DaySchedule
	}{
		{"Lunes", schedule.Monday},
		{"Martes", schedule.Tuesday},
		{"Miércoles", schedule.Wednesday},
		{"Jueves", schedule.Thursday},
		{"Viernes", schedule.Friday},
		{"Sábado", schedule.Saturday},
		{"Domingo", schedule.Sunday},
	}

	var lines []string
	for _, d := range days {
		if d.day.Open {
			lines = append(lines, fmt.Sprintf("%s: %s - %s", d.name, d.day.Start, d.day.End))
		}
	}

	if len(lines) == 0 {
		return "Horario por confirmar"
	}

	return strings.Join(lines, "\n")
}

func convertServicesToOrbital(services []models.Service) []OrbitalService {
	result := make([]OrbitalService, len(services))
	for i, s := range services {
		service := OrbitalService{
			Name:        s.Title,
			Description: s.Description,
			Duration:    30,
		}

		// Convertir precio
		if priceStr := s.Price.String(); priceStr != "" {
			var priceFloat float64
			if _, err := fmt.Sscanf(priceStr, "%f", &priceFloat); err == nil {
				service.Price = priceFloat
			}
		}

		result[i] = service
	}
	return result
}

// generateEnvFile genera el contenido del archivo .env para OrbitalBot
func (s *OrbitalBotDeployService) generateEnvFile(agent *models.Agent, geminiAPIKey string) string {
	var env strings.Builder

	env.WriteString("# Configuración del Bot\n")
	env.WriteString(fmt.Sprintf("AGENT_ID=%d\n", agent.ID))
	env.WriteString(fmt.Sprintf("AGENT_NAME=%s\n", agent.Name))
	env.WriteString(fmt.Sprintf("PHONE_NUMBER=%s\n", agent.PhoneNumber))
	env.WriteString("\n")

	// Meta API Configuration
	env.WriteString("# Meta WhatsApp Business API\n")
	env.WriteString(fmt.Sprintf("META_ACCESS_TOKEN=%s\n", agent.MetaAccessToken))
	env.WriteString(fmt.Sprintf("META_PHONE_NUMBER_ID=%s\n", agent.MetaPhoneNumberID))
	env.WriteString(fmt.Sprintf("META_WABA_ID=%s\n", agent.MetaWABAID))
	env.WriteString(fmt.Sprintf("WEBHOOK_VERIFY_TOKEN=%s\n", generateWebhookToken(agent.ID)))
	env.WriteString(fmt.Sprintf("PORT=%d\n", agent.Port))
	env.WriteString("\n")

	// API Key de Gemini
	if geminiAPIKey != "" {
		env.WriteString("# Gemini AI\n")
		env.WriteString(fmt.Sprintf("GEMINI_API_KEY=%s\n", geminiAPIKey))
		env.WriteString("\n")
	}

	// Integración de Google Sheets
	if agent.GoogleSheetID != "" {
		env.WriteString("#Integracion Con Google Sheets Para Agendamiento\n")
		env.WriteString(fmt.Sprintf("SPREADSHEETID=%s\n", agent.GoogleSheetID))
		env.WriteString("GOOGLE_APPLICATION_CREDENTIALS=google.json\n")
		env.WriteString("\n")
	}

	// Integración de Google Calendar
	if agent.GoogleCalendarID != "" {
		env.WriteString("#Integracion Con Google Calendar Para Agendar Los Eventos\n")
		env.WriteString(fmt.Sprintf("GOOGLE_CALENDAR_ID=%s\n", agent.GoogleCalendarID))
		env.WriteString("\n")
	}

	// Pasarela de pagos (SPEI + Stripe Connect)
	attomosURL := os.Getenv("BASE_URL")
	botToken := os.Getenv("BOT_API_TOKEN")
	env.WriteString("# Pasarela de Pagos del Bot\n")
	env.WriteString(fmt.Sprintf("ATTOMOS_API_URL=%s\n", attomosURL))
	env.WriteString(fmt.Sprintf("BOT_API_TOKEN=%s\n", botToken))
	env.WriteString(fmt.Sprintf("BRANCH_ID=%d\n", agent.BranchID))
	env.WriteString("\n")

	return env.String()
}

// generateWebhookToken genera un token de verificación para webhook
func generateWebhookToken(agentID uint) string {
	return fmt.Sprintf("orbital_webhook_%d_%d", agentID, time.Now().Unix())
}

// compileBotOnServer compila el bot en el servidor
func (s *OrbitalBotDeployService) compileBotOnServer(botDir string) error {
	compileCmd := fmt.Sprintf(`
	export PATH=$PATH:/usr/local/go/bin
	export HOME=/root
	cd %s
	
	echo "Inicializando módulo Go..."
	go mod tidy 2>&1 || {
		echo "Error en go mod tidy"
		exit 1
	}
	
	echo "Compilando bot..."
	go build -o orbital-bot main.go 2>&1 || {
		echo "Error compilando bot"
		exit 1
	}
	
	chmod +x orbital-bot
	echo "Compilación exitosa"
	ls -lh orbital-bot`, botDir)

	output, err := s.executeCommand(compileCmd)
	if strings.TrimSpace(output) != "" {
		log.Printf("   Output compilación:\n%s", strings.TrimSpace(output))
	}
	if err != nil {
		return fmt.Errorf("error compilando: %w", err)
	}

	log.Printf("   ✅ Bot compilado exitosamente")
	return nil
}

// createSystemdService crea el servicio systemd para el bot
func (s *OrbitalBotDeployService) createSystemdService(agent *models.Agent, botDir string) error {
	serviceName := fmt.Sprintf("orbital-bot-%d", agent.ID)
	serviceContent := fmt.Sprintf(`[Unit]
Description=OrbitalBot WhatsApp Meta API - Agent %d
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=%s
ExecStart=%s/orbital-bot
Restart=always
RestartSec=10
StandardOutput=append:/var/log/orbital-bot-%d.log
StandardError=append:/var/log/orbital-bot-%d-error.log
Environment="PATH=/usr/local/go/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

[Install]
WantedBy=multi-user.target`,
		agent.ID,
		botDir,
		botDir,
		agent.ID,
		agent.ID)

	servicePath := fmt.Sprintf("/etc/systemd/system/%s.service", serviceName)

	// Crear archivo de servicio
	serviceFile, err := s.sftpClient.Create(servicePath)
	if err != nil {
		return fmt.Errorf("error creando archivo de servicio: %w", err)
	}
	defer serviceFile.Close()

	if _, err := serviceFile.Write([]byte(serviceContent)); err != nil {
		return fmt.Errorf("error escribiendo archivo de servicio: %w", err)
	}

	// Recargar systemd
	if _, err := s.executeCommand("systemctl daemon-reload"); err != nil {
		return fmt.Errorf("error recargando systemd: %w", err)
	}

	// Habilitar servicio
	if _, err := s.executeCommand(fmt.Sprintf("systemctl enable %s", serviceName)); err != nil {
		return fmt.Errorf("error habilitando servicio: %w", err)
	}

	log.Printf("   ✅ Servicio systemd creado y habilitado")
	return nil
}

// startBot inicia el bot
func (s *OrbitalBotDeployService) startBot(agentID uint) error {
	serviceName := fmt.Sprintf("orbital-bot-%d", agentID)

	// Detener si ya está corriendo
	s.executeCommand(fmt.Sprintf("systemctl stop %s", serviceName))

	// Iniciar servicio
	if _, err := s.executeCommand(fmt.Sprintf("systemctl start %s", serviceName)); err != nil {
		return fmt.Errorf("error iniciando servicio: %w", err)
	}

	// Esperar un momento para que inicie
	time.Sleep(3 * time.Second)

	// Verificar estado
	statusOutput, err := s.executeCommand(fmt.Sprintf("systemctl is-active %s", serviceName))
	if err != nil || !strings.Contains(statusOutput, "active") {
		return fmt.Errorf("servicio no está activo: %s", statusOutput)
	}

	log.Printf("   ✅ Bot iniciado correctamente")
	return nil
}

// StopBot detiene el bot
func (s *OrbitalBotDeployService) StopBot(agentID uint) error {
	cmd := fmt.Sprintf("systemctl stop orbital-bot-%d", agentID)
	if _, err := s.executeCommand(cmd); err != nil {
		return fmt.Errorf("error deteniendo: %w", err)
	}

	log.Printf("✅ [Agent %d] OrbitalBot detenido", agentID)
	return nil
}

// RestartBot reinicia el bot
func (s *OrbitalBotDeployService) RestartBot(agentID uint) error {
	cmd := fmt.Sprintf("systemctl restart orbital-bot-%d", agentID)
	if _, err := s.executeCommand(cmd); err != nil {
		return fmt.Errorf("error reiniciando: %w", err)
	}

	log.Printf("✅ [Agent %d] OrbitalBot reiniciado", agentID)
	return nil
}

// GetBotLogs obtiene los últimos logs del bot
func (s *OrbitalBotDeployService) GetBotLogs(agentID uint, lines int) (string, error) {
	cmd := fmt.Sprintf("tail -n %d /var/log/orbital-bot-%d.log", lines, agentID)
	output, err := s.executeCommand(cmd)
	if err != nil {
		return "", fmt.Errorf("error leyendo logs: %w", err)
	}
	return output, nil
}

// DiagnoseBotFailure realiza diagnóstico cuando el bot falla al iniciar
func (s *OrbitalBotDeployService) DiagnoseBotFailure(agentID uint) string {
	var diagnosis strings.Builder
	diagnosis.WriteString("🔍 DIAGNÓSTICO DEL BOT\n")
	diagnosis.WriteString("═══════════════════════════════════\n\n")

	botDir := fmt.Sprintf("/opt/orbital-bot-%d", agentID)

	// 1. Verificar archivos
	diagnosis.WriteString("📁 ARCHIVOS:\n")
	filesCmd := fmt.Sprintf("ls -lh %s", botDir)
	if output, err := s.executeCommand(filesCmd); err == nil {
		diagnosis.WriteString(output)
	} else {
		diagnosis.WriteString(fmt.Sprintf("❌ Error: %v\n", err))
	}
	diagnosis.WriteString("\n")

	// 2. Verificar .env
	diagnosis.WriteString("⚙️  ARCHIVO .ENV:\n")
	envCmd := fmt.Sprintf("cat %s/.env | grep -v TOKEN | grep -v API_KEY", botDir)
	if output, err := s.executeCommand(envCmd); err == nil {
		diagnosis.WriteString(output)
	} else {
		diagnosis.WriteString(fmt.Sprintf("❌ Error: %v\n", err))
	}
	diagnosis.WriteString("\n")

	// 3. Estado del servicio
	diagnosis.WriteString("🔧 ESTADO DEL SERVICIO:\n")
	statusCmd := fmt.Sprintf("systemctl status orbital-bot-%d --no-pager -l", agentID)
	if output, err := s.executeCommand(statusCmd); err == nil {
		diagnosis.WriteString(output)
	} else {
		diagnosis.WriteString(fmt.Sprintf("❌ Error: %v\n", err))
	}
	diagnosis.WriteString("\n")

	// 4. Últimos logs
	diagnosis.WriteString("📝 ÚLTIMOS LOGS (50 líneas):\n")
	logsCmd := fmt.Sprintf("tail -n 50 /var/log/orbital-bot-%d.log 2>&1 || journalctl -u orbital-bot-%d -n 50 --no-pager", agentID, agentID)
	if output, err := s.executeCommand(logsCmd); err == nil {
		diagnosis.WriteString(output)
	} else {
		diagnosis.WriteString(fmt.Sprintf("❌ Error: %v\n", err))
	}

	return diagnosis.String()
}

// executeCommand ejecuta comando SSH y retorna el output
func (s *OrbitalBotDeployService) executeCommand(cmd string) (string, error) {
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

// uploadFile sube un archivo al servidor
func (s *OrbitalBotDeployService) uploadFile(localPath, remotePath string) error {
	data, err := os.ReadFile(localPath)
	if err != nil {
		return fmt.Errorf("error leyendo archivo local: %w", err)
	}

	remoteDir := filepath.Dir(remotePath)
	s.executeCommand(fmt.Sprintf("mkdir -p %s", remoteDir))

	remoteFile, err := s.sftpClient.Create(remotePath)
	if err != nil {
		return fmt.Errorf("error creando archivo remoto: %w", err)
	}
	defer remoteFile.Close()

	if _, err := remoteFile.Write(data); err != nil {
		return fmt.Errorf("error escribiendo archivo remoto: %w", err)
	}

	return nil
}

// uploadDirectory sube un directorio completo al servidor
func (s *OrbitalBotDeployService) uploadDirectory(localPath, remotePath string) error {
	if _, err := s.executeCommand(fmt.Sprintf("mkdir -p %s", remotePath)); err != nil {
		return fmt.Errorf("error creando directorio remoto: %w", err)
	}

	entries, err := os.ReadDir(localPath)
	if err != nil {
		return fmt.Errorf("error leyendo directorio local: %w", err)
	}

	for _, entry := range entries {
		localEntryPath := filepath.Join(localPath, entry.Name())
		remoteEntryPath := filepath.Join(remotePath, entry.Name())

		if entry.IsDir() {
			if err := s.uploadDirectory(localEntryPath, remoteEntryPath); err != nil {
				return err
			}
		} else {
			if err := s.uploadFile(localEntryPath, remoteEntryPath); err != nil {
				return err
			}
		}
	}

	return nil
}

// UpdateGeminiAPIKey actualiza o elimina la API key de Gemini en el .env del bot
func (s *OrbitalBotDeployService) UpdateGeminiAPIKey(agent *models.Agent, apiKey string) error {
	log.Printf("🔄 [Agent %d] Actualizando Gemini API key...", agent.ID)

	botDir := fmt.Sprintf("/opt/orbital-bot-%d", agent.ID)
	envPath := fmt.Sprintf("%s/.env", botDir)

	// Leer .env actual
	envFile, err := s.sftpClient.Open(envPath)
	if err != nil {
		return fmt.Errorf("error abriendo .env: %w", err)
	}
	defer envFile.Close()

	currentContent, err := io.ReadAll(envFile)
	if err != nil {
		return fmt.Errorf("error leyendo .env: %w", err)
	}

	lines := strings.Split(string(currentContent), "\n")
	updatedLines := make([]string, 0)
	hasGeminiKey := false

	for _, line := range lines {
		trimmedLine := strings.TrimSpace(line)

		if strings.HasPrefix(trimmedLine, "GEMINI_API_KEY") || strings.HasPrefix(trimmedLine, "#GEMINI_API_KEY") {
			hasGeminiKey = true

			if apiKey == "" {
				updatedLines = append(updatedLines, "#GEMINI_API_KEY=")
				log.Printf("   ✅ GEMINI_API_KEY comentada (eliminada)")
			} else {
				updatedLines = append(updatedLines, fmt.Sprintf("GEMINI_API_KEY=%s", apiKey))
				log.Printf("   ✅ GEMINI_API_KEY actualizada")
			}
			continue
		}

		updatedLines = append(updatedLines, line)
	}

	// Si no existía la key, agregarla
	if !hasGeminiKey && apiKey != "" {
		updatedLines = append(updatedLines, "")
		updatedLines = append(updatedLines, "# Gemini AI")
		updatedLines = append(updatedLines, fmt.Sprintf("GEMINI_API_KEY=%s", apiKey))
		log.Printf("   ✅ GEMINI_API_KEY agregada")
	}

	// Escribir .env actualizado
	newContent := strings.Join(updatedLines, "\n")

	tmpEnvFile, err := s.sftpClient.Create(envPath + ".tmp")
	if err != nil {
		return fmt.Errorf("error creando archivo temporal: %w", err)
	}

	if _, err := tmpEnvFile.Write([]byte(newContent)); err != nil {
		tmpEnvFile.Close()
		return fmt.Errorf("error escribiendo archivo temporal: %w", err)
	}
	tmpEnvFile.Close()

	renameCmd := fmt.Sprintf("mv %s.tmp %s", envPath, envPath)
	if _, err := s.executeCommand(renameCmd); err != nil {
		return fmt.Errorf("error reemplazando .env: %w", err)
	}

	// Reiniciar bot
	if err := s.RestartBot(agent.ID); err != nil {
		return fmt.Errorf("error reiniciando bot: %w", err)
	}

	log.Printf("✅ [Agent %d] Gemini API key actualizada y bot reiniciado", agent.ID)
	return nil
}

// GetSSHClient retorna el cliente SSH
func (s *OrbitalBotDeployService) GetSSHClient() *ssh.Client {
	return s.sshClient
}

// CleanupBotFiles elimina completamente los archivos del bot
func (s *OrbitalBotDeployService) CleanupBotFiles(agentID uint) error {
	botDir := fmt.Sprintf("/opt/orbital-bot-%d", agentID)
	cmd := fmt.Sprintf("rm -rf %s", botDir)

	if _, err := s.executeCommand(cmd); err != nil {
		log.Printf("⚠️  Error limpiando archivos del bot: %v", err)
		return err
	}

	log.Printf("✅ Archivos del bot eliminados: %s", botDir)
	return nil
}

// StopAndRemoveBot detiene y elimina completamente el bot del servidor
func (s *OrbitalBotDeployService) StopAndRemoveBot(agentID uint) error {
	log.Printf("\n[CLEANUP] Eliminando agente %d del servidor...\n", agentID)

	// Detener servicio systemd
	serviceName := fmt.Sprintf("orbital-bot-%d", agentID)
	log.Printf("[SYSTEMD] Deteniendo servicio...")
	stopCmd := fmt.Sprintf("systemctl stop %s && systemctl disable %s", serviceName, serviceName)
	if _, err := s.executeCommand(stopCmd); err != nil {
		log.Printf("⚠️  Error deteniendo servicio: %v\n", err)
	} else {
		log.Printf("✅ Servicio detenido\n")
	}

	// Eliminar directorio del bot
	log.Printf("[FILES] Eliminando directorio /opt/orbital-bot-%d...\n", agentID)
	removeCmd := fmt.Sprintf("rm -rf /opt/orbital-bot-%d", agentID)
	if _, err := s.executeCommand(removeCmd); err != nil {
		log.Printf("❌ Error eliminando directorio: %v\n", err)
		return fmt.Errorf("error eliminando directorio: %v", err)
	}
	log.Printf("✅ Directorio eliminado\n")

	// Eliminar archivo de servicio
	serviceFile := fmt.Sprintf("/etc/systemd/system/%s.service", serviceName)
	removeServiceCmd := fmt.Sprintf("rm -f %s && systemctl daemon-reload", serviceFile)
	s.executeCommand(removeServiceCmd)

	log.Printf("✅ Agente %d eliminado completamente\n", agentID)

	return nil
}

// UpdatePaymentConfig actualiza las variables de pago en el .env del OrbitalBot
func (s *OrbitalBotDeployService) UpdatePaymentConfig(agent *models.Agent) error {
	log.Printf("🔄 [Agent %d] Actualizando variables de pago en .env...", agent.ID)

	botDir := fmt.Sprintf("/home/user_%d/orbital-bot", agent.UserID)
	envPath := fmt.Sprintf("%s/.env", botDir)

	envFile, err := s.sftpClient.Open(envPath)
	if err != nil {
		return fmt.Errorf("error abriendo .env: %w", err)
	}
	defer envFile.Close()

	currentContent, err := io.ReadAll(envFile)
	if err != nil {
		return fmt.Errorf("error leyendo .env: %w", err)
	}

	lines := strings.Split(string(currentContent), "\n")
	updated := make([]string, 0, len(lines))
	foundSection := false

	attomosURL := os.Getenv("BASE_URL")
	botToken := os.Getenv("BOT_API_TOKEN")

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "ATTOMOS_API_URL=") ||
			strings.HasPrefix(trimmed, "BOT_API_TOKEN=") ||
			strings.HasPrefix(trimmed, "BRANCH_ID=") ||
			strings.Contains(line, "Pasarela de Pagos") {
			foundSection = true
			continue
		}
		updated = append(updated, line)
	}

	if !foundSection {
		updated = append(updated, "")
	}

	updated = append(updated,
		"# Pasarela de Pagos del Bot",
		fmt.Sprintf("ATTOMOS_API_URL=%s", attomosURL),
		fmt.Sprintf("BOT_API_TOKEN=%s", botToken),
		fmt.Sprintf("BRANCH_ID=%d", agent.BranchID),
		"",
	)

	newContent := strings.Join(updated, "\n")

	tmpFile, err := s.sftpClient.Create(envPath + ".tmp")
	if err != nil {
		return fmt.Errorf("error creando tmp: %w", err)
	}
	if _, err := tmpFile.Write([]byte(newContent)); err != nil {
		tmpFile.Close()
		return fmt.Errorf("error escribiendo tmp: %w", err)
	}
	tmpFile.Close()

	if _, err := s.executeCommand(fmt.Sprintf("mv %s.tmp %s", envPath, envPath)); err != nil {
		return fmt.Errorf("error reemplazando .env: %w", err)
	}

	if err := s.RestartBot(agent.ID); err != nil {
		log.Printf("⚠️  [Agent %d] No se pudo reiniciar tras actualizar pagos: %v", agent.ID, err)
	}

	log.Printf("✅ [Agent %d] Variables de pago actualizadas y bot reiniciado", agent.ID)
	return nil
}
