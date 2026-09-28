package services

import (
	"bytes"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"strconv"
	"strings"
	"time"

	"attomos/models"

	"golang.org/x/crypto/ssh"
)

type ChatwootService struct {
	serverIP       string
	baseURL        string
	userID         uint
	httpClient     *http.Client
	serverPassword string
}

type ChatwootAccount struct {
	ID     int    `json:"id"`
	Name   string `json:"name"`
	Locale string `json:"locale"`
}

type ChatwootUser struct {
	ID                int    `json:"id"`
	Email             string `json:"email"`
	Name              string `json:"name"`
	AccountID         int    `json:"account_id"`
	Role              string `json:"role"`
	AccessToken       string `json:"access_token,omitempty"`
	ConfirmationToken string `json:"confirmation_token,omitempty"`
}

type ChatwootInbox struct {
	ID          int    `json:"id"`
	Name        string `json:"name"`
	ChannelType string `json:"channel_type"`
	WebhookURL  string `json:"webhook_url,omitempty"`
}

type ChatwootCredentials struct {
	Email       string `json:"email"`
	Password    string `json:"password"`
	AccountID   int    `json:"accountId"`
	AccountName string `json:"accountName"`
	InboxID     int    `json:"inboxId"`
	InboxName   string `json:"inboxName"`
	ChatwootURL string `json:"chatwootUrl"`
}

// NewChatwootService crea una nueva instancia del servicio
func NewChatwootService(serverIP string, userID uint, password string) *ChatwootService {
	return &ChatwootService{
		serverIP:       serverIP,
		baseURL:        fmt.Sprintf("http://%s:3000", serverIP),
		userID:         userID,
		serverPassword: password,
		httpClient: &http.Client{
			Timeout: 60 * time.Second,
		},
	}
}

// executeSSHCommand ejecuta un comando en el servidor
func (c *ChatwootService) executeSSHCommand(command string) (string, error) {
	config := &ssh.ClientConfig{
		User: "root",
		Auth: []ssh.AuthMethod{
			ssh.Password(c.serverPassword),
		},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         30 * time.Second,
	}

	client, err := ssh.Dial("tcp", c.serverIP+":22", config)
	if err != nil {
		return "", fmt.Errorf("error conectando SSH: %v", err)
	}
	defer client.Close()

	session, err := client.NewSession()
	if err != nil {
		return "", fmt.Errorf("error creando sesión: %v", err)
	}
	defer session.Close()

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	session.Stdout = &stdout
	session.Stderr = &stderr

	err = session.Run(command)
	output := stdout.String()
	if stderr.String() != "" {
		output += "\n" + stderr.String()
	}

	return output, err
}

// diagnoseChatwootFailure diagnostica por qué Chatwoot no está funcionando
func (c *ChatwootService) diagnoseChatwootFailure() {
	fmt.Println("\n╔═══════════════════════════════════════════════════════════════╗")
	fmt.Println("║           🔍 DIAGNÓSTICO AUTOMÁTICO DE CHATWOOT               ║")
	fmt.Println("╚═══════════════════════════════════════════════════════════════╝")

	// 1. Verificar si Docker está corriendo
	fmt.Println("\n1️⃣  VERIFICANDO DOCKER:")
	fmt.Println("────────────────────────────────────────────────────────────────")
	dockerStatus, err := c.executeSSHCommand("systemctl is-active docker")
	if err != nil {
		fmt.Printf("❌ Docker NO está corriendo: %v\n", err)
	} else {
		fmt.Printf("✅ Docker status: %s\n", strings.TrimSpace(dockerStatus))
	}

	// 2. Ver containers de Docker
	fmt.Println("\n2️⃣  CONTAINERS DE DOCKER:")
	fmt.Println("────────────────────────────────────────────────────────────────")
	containers, _ := c.executeSSHCommand("cd /opt/chatwoot && docker compose ps")
	fmt.Println(containers)

	// 3. Ver si docker-compose.yml existe
	fmt.Println("\n3️⃣  VERIFICANDO DOCKER-COMPOSE.YML:")
	fmt.Println("────────────────────────────────────────────────────────────────")
	composeExists, _ := c.executeSSHCommand("ls -lh /opt/chatwoot/docker-compose.yml")
	fmt.Println(composeExists)

	// 4. Ver logs de Chatwoot (últimas 100 líneas)
	fmt.Println("\n4️⃣  LOGS DE CHATWOOT (últimas 100 líneas):")
	fmt.Println("────────────────────────────────────────────────────────────────")
	chatwootLogs, _ := c.executeSSHCommand("cd /opt/chatwoot && docker compose logs chatwoot --tail=100 2>&1")
	if chatwootLogs == "" {
		fmt.Println("⚠️  No hay logs de Chatwoot disponibles")
	} else {
		fmt.Println(chatwootLogs)
	}

	// 5. Ver logs de PostgreSQL
	fmt.Println("\n5️⃣  LOGS DE POSTGRESQL (últimas 50 líneas):")
	fmt.Println("────────────────────────────────────────────────────────────────")
	postgresLogs, _ := c.executeSSHCommand("cd /opt/chatwoot && docker compose logs postgres --tail=50 2>&1")
	if postgresLogs == "" {
		fmt.Println("⚠️  No hay logs de PostgreSQL disponibles")
	} else {
		fmt.Println(postgresLogs)
	}

	// 6. Ver logs de Redis
	fmt.Println("\n6️⃣  LOGS DE REDIS (últimas 50 líneas):")
	fmt.Println("────────────────────────────────────────────────────────────────")
	redisLogs, _ := c.executeSSHCommand("cd /opt/chatwoot && docker compose logs redis --tail=50 2>&1")
	if redisLogs == "" {
		fmt.Println("⚠️  No hay logs de Redis disponibles")
	} else {
		fmt.Println(redisLogs)
	}

	// 7. Ver si el puerto 3000 está escuchando
	fmt.Println("\n7️⃣  PUERTO 3000:")
	fmt.Println("────────────────────────────────────────────────────────────────")
	port3000, _ := c.executeSSHCommand("ss -tlnp | grep :3000 || netstat -tlnp | grep :3000 || echo 'Puerto 3000 NO está escuchando'")
	fmt.Println(port3000)

	// 8. Intentar curl local
	fmt.Println("\n8️⃣  TEST CURL LOCAL:")
	fmt.Println("────────────────────────────────────────────────────────────────")
	curlTest, _ := c.executeSSHCommand("curl -v http://localhost:3000/api 2>&1")
	fmt.Println(curlTest)

	// 9. Ver log de inicialización (últimas 100 líneas)
	fmt.Println("\n9️⃣  LOG DE INICIALIZACIÓN (últimas 100 líneas):")
	fmt.Println("────────────────────────────────────────────────────────────────")
	initLog, _ := c.executeSSHCommand("tail -100 /var/log/attomos/init.log 2>&1")
	fmt.Println(initLog)

	// 10. Ver cloud-init status
	fmt.Println("\n🔟 CLOUD-INIT STATUS:")
	fmt.Println("────────────────────────────────────────────────────────────────")
	cloudInitStatus, _ := c.executeSSHCommand("cloud-init status --long 2>&1")
	fmt.Println(cloudInitStatus)

	fmt.Println("\n═══════════════════════════════════════════════════════════════")
	fmt.Println("FIN DEL DIAGNÓSTICO")
	fmt.Println("═══════════════════════════════════════════════════════════════")
	fmt.Println()
}

// WaitForChatwoot espera a que Chatwoot esté disponible
func (c *ChatwootService) WaitForChatwoot(maxWaitMinutes int) error {
	fmt.Println("\n╔═══════════════════════════════════════════════════════════════╗")
	fmt.Println("║              ⏳ ESPERANDO A QUE CHATWOOT INICIE               ║")
	fmt.Println("╚═══════════════════════════════════════════════════════════════╝")
	fmt.Printf("\n🔗 URL base: %s\n", c.baseURL)
	fmt.Printf("⏱️  Timeout: %d minutos\n\n", maxWaitMinutes)

	maxAttempts := maxWaitMinutes * 6 // Cada 10 segundos

	for i := 0; i < maxAttempts; i++ {
		elapsed := (i + 1) * 10

		fmt.Printf("\n[%02d:%02d] 🔄 Intento %d/%d\n", elapsed/60, elapsed%60, i+1, maxAttempts)

		// Intentar conectar al endpoint de API
		resp, err := c.httpClient.Get(c.baseURL + "/api")

		if err != nil {
			fmt.Printf("   ❌ Error de conexión: %v\n", err)

			// Cada 2 minutos, hacer diagnóstico completo
			if (i+1)%12 == 0 {
				fmt.Println("\n   🔍 Ejecutando diagnóstico automático...")
				c.diagnoseChatwootFailure()
			}
		} else {
			resp.Body.Close()

			if resp.StatusCode == 200 {
				fmt.Println("   ✅ Chatwoot está disponible y respondiendo!")
				return nil
			}

			fmt.Printf("   ⚠️  Status code: %d (esperando 200)\n", resp.StatusCode)
		}

		if i < maxAttempts-1 {
			fmt.Printf("   ⏳ Esperando 10 segundos...\n")
			time.Sleep(10 * time.Second)
		}
	}

	// Diagnóstico final antes de fallar
	fmt.Println("\n❌ TIMEOUT ALCANZADO - Ejecutando diagnóstico final...")
	c.diagnoseChatwootFailure()

	return fmt.Errorf("chatwoot no respondió después de %d minutos", maxWaitMinutes)
}

// CreateAccountAndUser crea una cuenta y usuario en Chatwoot
func (c *ChatwootService) CreateAccountAndUser(user *models.User, agent *models.Agent) (*ChatwootCredentials, error) {
	fmt.Println("\n╔═══════════════════════════════════════════════════════════════╗")
	fmt.Println("║           🔧 CREANDO CUENTA Y USUARIO EN CHATWOOT             ║")
	fmt.Println("╚═══════════════════════════════════════════════════════════════╝")

	// 1. Esperar a que Chatwoot esté listo
	if err := c.WaitForChatwoot(20); err != nil {
		return nil, fmt.Errorf("chatwoot no está disponible: %v", err)
	}

	// 2. Generar credenciales
	email, password := c.generateCredentials(user.Company, agent.Name)
	fmt.Printf("\n📧 Email generado: %s\n", email)
	fmt.Printf("🔑 Password generado: %s\n", password)

	// 3. Crear usuario, cuenta e inbox en una sola operación
	accountName := fmt.Sprintf("%s - %s", user.Company, agent.Name)
	inboxName := fmt.Sprintf("%s WhatsApp", agent.Name)
	accountID, inboxID, _, err := c.createCompleteSetupViaConsole(
		email,
		password,
		user.Company,
		accountName,
		inboxName,
	)
	if err != nil {
		return nil, fmt.Errorf("error creando configuración completa: %v", err)
	}
	fmt.Printf("✅ Setup completo: AccountID=%d, InboxID=%d\n", accountID, inboxID)

	credentials := &ChatwootCredentials{
		Email:       email,
		Password:    password,
		AccountID:   accountID,
		AccountName: accountName,
		InboxID:     inboxID,
		InboxName:   inboxName,
		ChatwootURL: fmt.Sprintf("https://chat-user%d.attomos.com", c.userID),
	}

	return credentials, nil
}

// createCompleteSetupViaConsole crea usuario, cuenta e inbox en una sola operación
func (c *ChatwootService) createCompleteSetupViaConsole(email, password, name, accountName, inboxName string) (int, int, string, error) {
	fmt.Println("\n🔄 Creando setup completo en Chatwoot vía Rails console...")
	fmt.Printf("   Email: %s\n", email)
	fmt.Printf("   Name: %s\n", name)
	fmt.Printf("   Account: %s\n", accountName)
	fmt.Printf("   Inbox: %s\n", inboxName)

	scriptPath := fmt.Sprintf("/tmp/chatwoot_complete_setup_%d.rb", time.Now().Unix())
	createFileCmd := fmt.Sprintf(`cat > %s << 'EOFSCRIPT'
# Crear cuenta
account = Account.create!(name: '%s')

# Crear usuario
user = User.create!(
  email: '%s',
  password: '%s',
  password_confirmation: '%s',
  name: '%s',
  confirmed_at: Time.now
)

# Asociar usuario con cuenta como administrador
AccountUser.create!(account: account, user: user, role: :administrator)

# Crear canal API (WhatsApp) - NO tiene atributo 'name'
channel = Channel::Api.create!(
  account: account
)

# Crear inbox con el nombre
inbox = Inbox.create!(
  account: account,
  channel: channel,
  name: '%s'
)

# Agregar el usuario al inbox
InboxMember.create!(
  inbox: inbox,
  user: user
)

# IMPORTANTE: Marcar onboarding como completado
# En algunas versiones de Chatwoot el campo se llama diferente
begin
  if account.respond_to?(:onboarding_step=)
    account.update!(onboarding_step: 'completed')
  elsif account.respond_to?(:onboarding_completed=)
    account.update!(onboarding_completed: true)
  end
rescue => e
  # Si no existe el campo, no pasa nada
  puts "ONBOARDING_SKIP: #{e.message}"
end

# Obtener access token
access_token = user.access_token.token

# Output
puts "ACCOUNT_ID:#{account.id}"
puts "USER_ID:#{user.id}"
puts "INBOX_ID:#{inbox.id}"
puts "ACCESS_TOKEN:#{access_token}"
EOFSCRIPT
`,
		scriptPath,
		strings.ReplaceAll(accountName, "'", "\\'"),
		strings.ReplaceAll(email, "'", "\\'"),
		strings.ReplaceAll(password, "'", "\\'"),
		strings.ReplaceAll(password, "'", "\\'"),
		strings.ReplaceAll(name, "'", "\\'"),
		strings.ReplaceAll(inboxName, "'", "\\'"),
	)

	// Crear el archivo
	_, err := c.executeSSHCommand(createFileCmd)
	if err != nil {
		return 0, 0, "", fmt.Errorf("error creando archivo temporal: %v", err)
	}

	// Ejecutar el script
	command := fmt.Sprintf(`cd /opt/chatwoot && docker compose exec -T chatwoot bundle exec rails runner "$(cat %s)"`, scriptPath)
	output, err := c.executeSSHCommand(command)

	// Limpiar el archivo temporal
	c.executeSSHCommand(fmt.Sprintf("rm -f %s", scriptPath))

	if err != nil {
		return 0, 0, "", fmt.Errorf("error ejecutando Rails console: %v\nOutput: %s", err, output)
	}

	fmt.Printf("\n📥 Output de Rails console:\n%s\n", output)

	// Parsear el output
	accountID := 0
	inboxID := 0
	accessToken := ""
	lines := strings.Split(output, "\n")
	for _, line := range lines {
		if strings.HasPrefix(line, "ACCOUNT_ID:") {
			idStr := strings.TrimPrefix(line, "ACCOUNT_ID:")
			accountID, _ = strconv.Atoi(strings.TrimSpace(idStr))
		}
		if strings.HasPrefix(line, "INBOX_ID:") {
			idStr := strings.TrimPrefix(line, "INBOX_ID:")
			inboxID, _ = strconv.Atoi(strings.TrimSpace(idStr))
		}
		if strings.HasPrefix(line, "ACCESS_TOKEN:") {
			accessToken = strings.TrimSpace(strings.TrimPrefix(line, "ACCESS_TOKEN:"))
		}
	}

	if accountID == 0 || inboxID == 0 || accessToken == "" {
		return 0, 0, "", fmt.Errorf("datos incompletos en output: accountID=%d, inboxID=%d, token=%v", accountID, inboxID, accessToken != "")
	}

	fmt.Printf("✅ Setup completo exitoso: AccountID=%d, InboxID=%d\n", accountID, inboxID)

	// ===================================================================
	// ELIMINAR BANDERA DE ONBOARDING DE REDIS (OPCIÓN RECOMENDADA)
	// ===================================================================
	// Usa Rails console para manejar el namespace "alfred:" automáticamente
	fmt.Println("\n🔧 Eliminando bandera de onboarding de Redis vía Rails console...")
	deleteOnboardingScript := `::Redis::Alfred.delete(::Redis::Alfred::CHATWOOT_INSTALLATION_ONBOARDING)`
	deleteOnboardingCmd := fmt.Sprintf(`cd /opt/chatwoot && docker compose exec -T chatwoot bundle exec rails runner "%s"`, deleteOnboardingScript)
	delOutput, err := c.executeSSHCommand(deleteOnboardingCmd)
	if err != nil {
		fmt.Printf("⚠️  Error eliminando bandera (no crítico): %v\n", err)
	} else {
		fmt.Printf("✅ Bandera de onboarding eliminada: %s\n", strings.TrimSpace(delOutput))
	}

	// ===================================================================
	// REINICIAR CONTENEDORES PARA APLICAR CAMBIOS
	// ===================================================================
	fmt.Println("\n🔄 Reiniciando contenedores de Chatwoot para recargar configuración...")
	restartCmd := `cd /opt/chatwoot && docker compose restart`
	restartOutput, err := c.executeSSHCommand(restartCmd)
	if err != nil {
		fmt.Printf("⚠️  Error reiniciando contenedores: %v\n", err)
	} else {
		fmt.Printf("✅ Contenedores reiniciados: %s\n", strings.TrimSpace(restartOutput))
	}

	return accountID, inboxID, accessToken, nil
}

// generateCredentials genera credenciales con contraseña segura
func (c *ChatwootService) generateCredentials(companyName, agentName string) (string, string) {
	emailUser := strings.ToLower(companyName + "_" + agentName)
	emailUser = strings.ReplaceAll(emailUser, " ", "_")
	emailUser = strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_' {
			return r
		}
		return -1
	}, emailUser)

	email := emailUser + "@attomos.com"

	// Generar contraseña que cumpla TODOS los requisitos de Chatwoot:
	// - Mínimo 6 caracteres
	// - Al menos 1 mayúscula (A-Z)
	// - Al menos 1 minúscula (a-z)
	// - Al menos 1 número (0-9)
	// - Al menos 1 carácter especial de: !@#$%^&*()_+-=[]{}|"/\.,`<>:;?~'

	baseWord := "Chatwoot"
	if companyName != "" {
		// Usar nombre de compañía capitalizado
		baseWord = strings.Title(strings.ToLower(companyName))
		baseWord = strings.ReplaceAll(baseWord, " ", "")
		// Limitar a 8 caracteres
		if len(baseWord) > 8 {
			baseWord = baseWord[:8]
		}
		// Asegurar que empiece con mayúscula
		if len(baseWord) > 0 && baseWord[0] >= 'a' && baseWord[0] <= 'z' {
			baseWord = string(baseWord[0]-32) + baseWord[1:]
		}
	}

	// Formato: BaseWord123@#
	// Esto garantiza: mayúscula inicial, minúsculas, números, y caracteres especiales válidos
	password := baseWord + "123@#"

	return email, password
}

// createWhatsAppInbox crea un inbox de WhatsApp (MÉTODO LEGACY - ya no se usa)
func (c *ChatwootService) createWhatsAppInbox(accessToken string, accountID int, inboxName, phoneNumber string) (int, error) {
	payload := map[string]interface{}{
		"name": inboxName,
		"channel": map[string]interface{}{
			"type":         "api",
			"webhook_url":  "",
			"phone_number": phoneNumber,
		},
	}

	jsonData, _ := json.Marshal(payload)
	req, err := http.NewRequest(
		"POST",
		fmt.Sprintf("%s/api/v1/accounts/%d/inboxes", c.baseURL, accountID),
		bytes.NewBuffer(jsonData),
	)

	if err != nil {
		return 0, err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("api_access_token", accessToken)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return 0, fmt.Errorf("error HTTP %d: %s", resp.StatusCode, string(body))
	}

	var result ChatwootInbox
	if err := json.Unmarshal(body, &result); err != nil {
		return 0, err
	}

	return result.ID, nil
}

// generateAccessToken genera un token aleatorio
func (c *ChatwootService) generateAccessToken() string {
	const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	length := 40

	result := make([]byte, length)
	for i := range result {
		num, _ := rand.Int(rand.Reader, big.NewInt(int64(len(charset))))
		result[i] = charset[num.Int64()]
	}

	return string(result)
}

// GetChatwootURL retorna la URL de Chatwoot
func (c *ChatwootService) GetChatwootURL() string {
	return fmt.Sprintf("https://chat-user%d.attomos.com", c.userID)
}

// InvestigateChatwootOnboarding investiga la estructura y configuración de Chatwoot
func (c *ChatwootService) InvestigateChatwootOnboarding() error {
	fmt.Println("\n╔═══════════════════════════════════════════════════════════════╗")
	fmt.Println("║           🔍 INVESTIGANDO CHATWOOT ONBOARDING                  ║")
	fmt.Println("╚═══════════════════════════════════════════════════════════════╝")

	scriptPath := fmt.Sprintf("/tmp/chatwoot_investigate_%d.rb", time.Now().Unix())
	createFileCmd := fmt.Sprintf(`cat > %s << 'EOFSCRIPT'
puts "═══════════════════════════════════════════════════════════"
puts "VERSIÓN DE CHATWOOT"
puts "═══════════════════════════════════════════════════════════"
begin
  version = Chatwoot.config[:version] rescue 'unknown'
  puts "Version: #{version}"
rescue => e
  puts "Error getting version: #{e.message}"
end

puts "\n═══════════════════════════════════════════════════════════"
puts "COLUMNAS DE LA TABLA ACCOUNTS"
puts "═══════════════════════════════════════════════════════════"
Account.column_names.sort.each do |col|
  puts "- #{col}"
end

puts "\n═══════════════════════════════════════════════════════════"
puts "VERIFICAR CUENTA CON ID=1"
puts "═══════════════════════════════════════════════════════════"
account = Account.find_by(id: 1)
if account
  puts "Account encontrada: #{account.name}"
  puts "Atributos que contienen 'onboard' o 'setup':"
  account.attributes.select { |k, v| k.to_s.match?(/onboard|setup|install/i) }.each do |key, value|
    puts "  #{key}: #{value.inspect}"
  end
end

puts "\n═══════════════════════════════════════════════════════════"
puts "VERIFICAR REDIS - INSTALLATION ONBOARDING"
puts "═══════════════════════════════════════════════════════════"
begin
  redis_value = Redis::Alfred.get(Redis::Alfred::CHATWOOT_INSTALLATION_ONBOARDING)
  puts "Redis CHATWOOT_INSTALLATION_ONBOARDING: #{redis_value.inspect}"
rescue => e
  puts "Error checking Redis: #{e.message}"
end

puts "\n═══════════════════════════════════════════════════════════"
puts "BUSCAR CONTROLADOR DE INSTALLATION"
puts "═══════════════════════════════════════════════════════════"
begin
  if defined?(Installation::OnboardingController)
    puts "Installation::OnboardingController existe"
  else
    puts "Installation::OnboardingController NO existe"
  end
  
  if defined?(Super::OnboardingController)
    puts "Super::OnboardingController existe"
  else
    puts "Super::OnboardingController NO existe"
  end
rescue => e
  puts "Error: #{e.message}"
end

puts "\n═══════════════════════════════════════════════════════════"
puts "VERIFICAR USUARIO CON ID=1"
puts "═══════════════════════════════════════════════════════════"
user = User.find_by(id: 1)
if user
  puts "User encontrado: #{user.email}"
  puts "Confirmed: #{user.confirmed_at.present?}"
  puts "Super Admin: #{user.super_admin? rescue 'método no existe'}"
  puts "Accounts count: #{user.accounts.count}"
  puts "Account IDs: #{user.accounts.pluck(:id)}"
end

puts "\n═══════════════════════════════════════════════════════════"
puts "VERIFICAR TODAS LAS KEYS DE REDIS RELACIONADAS"
puts "═══════════════════════════════════════════════════════════"
begin
  redis = Redis.new(url: ENV['REDIS_URL'] || 'redis://redis:6379')
  keys = redis.keys('*ONBOARD*') + redis.keys('*onboard*') + redis.keys('*INSTALL*') + redis.keys('*install*')
  if keys.any?
    keys.each do |key|
      value = redis.get(key)
      puts "#{key}: #{value}"
    end
  else
    puts "No se encontraron keys relacionadas con onboarding"
  end
rescue => e
  puts "Error checking Redis keys: #{e.message}"
end
EOFSCRIPT
`, scriptPath)

	// Crear el archivo
	_, err := c.executeSSHCommand(createFileCmd)
	if err != nil {
		return fmt.Errorf("error creando archivo temporal: %v", err)
	}

	// Ejecutar el script
	command := fmt.Sprintf(`cd /opt/chatwoot && docker compose exec -T chatwoot bundle exec rails runner "$(cat %s)"`, scriptPath)
	output, err := c.executeSSHCommand(command)

	// Limpiar el archivo temporal
	c.executeSSHCommand(fmt.Sprintf("rm -f %s", scriptPath))

	if err != nil {
		return fmt.Errorf("error ejecutando investigación: %v\nOutput: %s", err, output)
	}

	fmt.Printf("\n📥 RESULTADO DE LA INVESTIGACIÓN:\n%s\n", output)

	return nil
}
