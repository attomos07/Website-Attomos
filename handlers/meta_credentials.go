package handlers

import (
	"bytes"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"attomos/config"
	"attomos/models"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/ssh"
)

// SaveMetaCredentials guarda las credenciales de Meta WhatsApp
func SaveMetaCredentials(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}

	user := userInterface.(*models.User)
	agentIDStr := c.Param("agent_id")

	agentID, err := strconv.ParseUint(agentIDStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID de agente inválido"})
		return
	}

	// Verificar que el agente pertenece al usuario
	var agent models.Agent
	if err := config.DB.Where("id = ? AND user_id = ?", agentID, user.ID).First(&agent).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Agente no encontrado"})
		return
	}

	// Recibir datos del request (soporte para múltiples formatos de campo)
	var payload struct {
		AccessToken   string `json:"accessToken,omitempty"`
		PhoneNumberID string `json:"phoneNumberId,omitempty"`
		WABAID        string `json:"wabaId,omitempty"`
		VerifyToken   string `json:"verifyToken,omitempty"`

		// Alternativas con mayúsculas (por si el frontend las envía así)
		AccessTokenAlt   string `json:"AccessToken,omitempty"`
		PhoneNumberIDAlt string `json:"PhoneNumberID,omitempty"`
		WABAIDAlt        string `json:"WABAID,omitempty"`
		VerifyTokenAlt   string `json:"VerifyToken,omitempty"`

		// Alternativas con snake_case
		AccessTokenSnake   string `json:"access_token,omitempty"`
		PhoneNumberIDSnake string `json:"phone_number_id,omitempty"`
		WABAIDSnake        string `json:"waba_id,omitempty"`
		VerifyTokenSnake   string `json:"verify_token,omitempty"`
	}

	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos inválidos: " + err.Error()})
		return
	}

	// Normalizar los valores (usar el que no esté vacío)
	accessToken := payload.AccessToken
	if accessToken == "" {
		accessToken = payload.AccessTokenAlt
	}
	if accessToken == "" {
		accessToken = payload.AccessTokenSnake
	}

	phoneNumberID := payload.PhoneNumberID
	if phoneNumberID == "" {
		phoneNumberID = payload.PhoneNumberIDAlt
	}
	if phoneNumberID == "" {
		phoneNumberID = payload.PhoneNumberIDSnake
	}

	wabaID := payload.WABAID
	if wabaID == "" {
		wabaID = payload.WABAIDAlt
	}
	if wabaID == "" {
		wabaID = payload.WABAIDSnake
	}

	verifyToken := payload.VerifyToken
	if verifyToken == "" {
		verifyToken = payload.VerifyTokenAlt
	}
	if verifyToken == "" {
		verifyToken = payload.VerifyTokenSnake
	}

	// Validar que los campos no estén vacíos
	if accessToken == "" || phoneNumberID == "" || wabaID == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Todos los campos son requeridos (accessToken/AccessToken, phoneNumberId/PhoneNumberID, wabaId/WABAID)",
		})
		return
	}

	// Si el usuario no proporciona un verifyToken, generar uno por defecto
	if verifyToken == "" {
		verifyToken = generateWebhookVerifyToken(agent.ID)
		log.Printf("⚠️  [Agent %d] No se proporcionó verifyToken, usando el generado: %s", agent.ID, verifyToken)
	}

	log.Printf("💾 [Agent %d] Guardando credenciales de Meta WhatsApp", agent.ID)
	log.Printf("   - Phone Number ID: %s", maskSensitiveValue(phoneNumberID))
	log.Printf("   - WABA ID: %s", maskSensitiveValue(wabaID))

	// Actualizar credenciales en la base de datos
	agent.MetaAccessToken = accessToken
	agent.MetaPhoneNumberID = phoneNumberID
	agent.MetaWABAID = wabaID
	agent.MetaConnected = true
	now := time.Now()
	agent.MetaConnectedAt = &now

	// Calcular expiración del token (60 días desde ahora)
	tokenExpiry := now.AddDate(0, 0, 60)
	agent.MetaTokenExpiresAt = &tokenExpiry

	if err := config.DB.Save(&agent).Error; err != nil {
		log.Printf("❌ [Agent %d] Error guardando credenciales: %v", agent.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al guardar credenciales"})
		return
	}

	log.Printf("✅ [Agent %d] Credenciales de Meta guardadas exitosamente", agent.ID)

	// 🚀 ACTUALIZAR .ENV EN EL BOT AUTOMÁTICAMENTE (como AtomicBot)
	if agent.IsOrbitalBot() {
		log.Printf("🔄 [Agent %d] Actualizando credenciales en bot desplegado", agent.ID)
		log.Printf("   🔑 Verify Token: %s", verifyToken)

		// Actualizar .env en el servidor via SSH (IGUAL QUE ATOMICBOT)
		go updateMetaCredentialsInBot(&agent, verifyToken)
	}

	c.JSON(http.StatusOK, gin.H{
		"success":            true,
		"message":            "Credenciales guardadas exitosamente",
		"webhookVerifyToken": verifyToken,
		"agent": gin.H{
			"id":              agent.ID,
			"metaConnected":   agent.MetaConnected,
			"metaConnectedAt": agent.MetaConnectedAt,
			"tokenExpiresAt":  agent.MetaTokenExpiresAt,
			"daysRemaining":   agent.GetMetaTokenDaysRemaining(),
		},
	})
}

// GetMetaCredentialsStatus obtiene el estado de las credenciales de Meta
func GetMetaCredentialsStatus(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}

	user := userInterface.(*models.User)
	agentIDStr := c.Param("agent_id")

	agentID, err := strconv.ParseUint(agentIDStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID de agente inválido"})
		return
	}

	var agent models.Agent
	if err := config.DB.Where("id = ? AND user_id = ?", agentID, user.ID).First(&agent).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Agente no encontrado"})
		return
	}

	// Obtener el webhook verify token actual del servidor
	webhookVerifyToken := ""
	if agent.IsOrbitalBot() && agent.ServerIP != "" && agent.ServerPassword != "" {
		// Leer el token actual del .env del servidor
		readTokenScript := fmt.Sprintf("cat /opt/orbital-bot-%d/.env | grep WEBHOOK_VERIFY_TOKEN | cut -d'=' -f2", agent.ID)
		if token, err := executeSSHCommand(agent.ServerIP, agent.ServerPassword, readTokenScript); err == nil {
			webhookVerifyToken = strings.TrimSpace(token)
		}
	}

	// Si no se pudo leer del servidor, usar el generado por defecto
	if webhookVerifyToken == "" {
		webhookVerifyToken = generateWebhookVerifyToken(agent.ID)
	}

	c.JSON(http.StatusOK, gin.H{
		"connected":          agent.MetaConnected,
		"connectedAt":        agent.MetaConnectedAt,
		"phoneNumberId":      agent.MetaPhoneNumberID,
		"wabaId":             agent.MetaWABAID,
		"displayNumber":      agent.MetaDisplayNumber,
		"verifiedName":       agent.MetaVerifiedName,
		"tokenExpiresAt":     agent.MetaTokenExpiresAt,
		"tokenExpired":       agent.IsMetaTokenExpired(),
		"daysRemaining":      agent.GetMetaTokenDaysRemaining(),
		"webhookUrl":         fmt.Sprintf("https://attomos.com/webhook/meta/%d", agent.ID),
		"webhookVerifyToken": webhookVerifyToken,
	})
}

// DisconnectMetaCredentials desconecta las credenciales de Meta
func DisconnectMetaCredentials(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}

	user := userInterface.(*models.User)
	agentIDStr := c.Param("agent_id")

	agentID, err := strconv.ParseUint(agentIDStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID de agente inválido"})
		return
	}

	var agent models.Agent
	if err := config.DB.Where("id = ? AND user_id = ?", agentID, user.ID).First(&agent).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Agente no encontrado"})
		return
	}

	// Limpiar credenciales
	agent.MetaAccessToken = ""
	agent.MetaPhoneNumberID = ""
	agent.MetaWABAID = ""
	agent.MetaDisplayNumber = ""
	agent.MetaVerifiedName = ""
	agent.MetaConnected = false
	agent.MetaConnectedAt = nil
	agent.MetaTokenExpiresAt = nil

	if err := config.DB.Save(&agent).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al desconectar"})
		return
	}

	// Limpiar credenciales del .env del bot
	if agent.IsOrbitalBot() {
		go clearMetaCredentialsInBot(&agent)
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "Credenciales de Meta desconectadas exitosamente",
	})
}

// ============================================
// FUNCIONES PRIVADAS - ACTUALIZACIÓN DEL BOT
// ============================================

// executeSSHCommand ejecuta un comando en el servidor remoto vía SSH
// USA LA MISMA LIBRERÍA QUE ATOMICBOT: golang.org/x/crypto/ssh
func executeSSHCommand(serverIP, password, command string) (string, error) {
	// Configurar autenticación SSH con password
	sshConfig := &ssh.ClientConfig{
		User: "root",
		Auth: []ssh.AuthMethod{
			ssh.Password(password),
		},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         10 * time.Second,
	}

	// Conectar al servidor
	client, err := ssh.Dial("tcp", fmt.Sprintf("%s:22", serverIP), sshConfig)
	if err != nil {
		return "", fmt.Errorf("error conectando via SSH: %w", err)
	}
	defer client.Close()

	// Crear sesión
	session, err := client.NewSession()
	if err != nil {
		return "", fmt.Errorf("error creando sesión SSH: %w", err)
	}
	defer session.Close()

	// Ejecutar comando y capturar output
	var stdout, stderr bytes.Buffer
	session.Stdout = &stdout
	session.Stderr = &stderr

	if err := session.Run(command); err != nil {
		return "", fmt.Errorf("error ejecutando comando: %w\nSTDERR: %s", err, stderr.String())
	}

	return stdout.String(), nil
}

// updateMetaCredentialsInBot actualiza las credenciales en el bot desplegado
// Esta función usa SSH nativa de Go (golang.org/x/crypto/ssh) igual que AtomicBot
func updateMetaCredentialsInBot(agent *models.Agent, verifyToken string) {
	log.Printf("🔄 [Agent %d] Actualizando credenciales en bot desplegado", agent.ID)

	if agent.BotType != "orbital" {
		log.Printf("⚠️  [Agent %d] No es un bot orbital, saltando actualización", agent.ID)
		return
	}

	if agent.ServerIP == "" || agent.ServerPassword == "" {
		log.Printf("❌ [Agent %d] Faltan credenciales del servidor", agent.ID)
		return
	}

	// Construir script de actualización (IGUAL QUE ATOMICBOT)
	updateScript := fmt.Sprintf(`
# Actualizar .env con credenciales de Meta
ENV_FILE="/opt/orbital-bot-%d/.env"

# Hacer backup del .env
cp $ENV_FILE ${ENV_FILE}.backup

# Remover credenciales antiguas de Meta si existen
sed -i '/^META_ACCESS_TOKEN=/d' $ENV_FILE
sed -i '/^META_PHONE_NUMBER_ID=/d' $ENV_FILE
sed -i '/^META_WABA_ID=/d' $ENV_FILE
sed -i '/^WEBHOOK_VERIFY_TOKEN=/d' $ENV_FILE

# Agregar nuevas credenciales al final del archivo
cat >> $ENV_FILE << 'ENVEOF'

# Meta WhatsApp Business API Credentials
META_ACCESS_TOKEN=%s
META_PHONE_NUMBER_ID=%s
META_WABA_ID=%s
WEBHOOK_VERIFY_TOKEN=%s
ENVEOF

echo "✅ Credenciales actualizadas en .env"

# Reiniciar el bot para que cargue las nuevas credenciales
systemctl restart orbital-bot-%d

echo "✅ Bot reiniciado"

# Esperar 3 segundos
sleep 3

# Verificar que el bot esté corriendo
systemctl is-active orbital-bot-%d && echo "✅ Bot activo" || echo "❌ Bot no activo"
`,
		agent.ID,
		agent.MetaAccessToken,
		agent.MetaPhoneNumberID,
		agent.MetaWABAID,
		verifyToken,
		agent.ID,
		agent.ID,
	)

	// Ejecutar vía SSH usando la librería nativa de Go
	log.Printf("📡 [Agent %d] Conectando a servidor %s...", agent.ID, agent.ServerIP)

	output, err := executeSSHCommand(agent.ServerIP, agent.ServerPassword, updateScript)
	if err != nil {
		log.Printf("❌ [Agent %d] Error ejecutando SSH: %v", agent.ID, err)
		return
	}

	log.Printf("✅ [Agent %d] Credenciales actualizadas en servidor", agent.ID)
	log.Printf("   📤 Output: %s", output)

	// Verificar que el bot se reinició correctamente
	time.Sleep(2 * time.Second)
	verifyBotRestart(agent)
}

// verifyBotRestart verifica que el bot haya cargado las credenciales correctamente
func verifyBotRestart(agent *models.Agent) {
	log.Printf("🔍 [Agent %d] Verificando reinicio del bot...", agent.ID)

	// Esperar 5 segundos para que el bot reinicie completamente
	time.Sleep(5 * time.Second)

	checkScript := fmt.Sprintf(`
# Verificar que el bot esté corriendo
systemctl is-active orbital-bot-%d

# Ver últimas líneas del log para confirmar credenciales
tail -30 /var/log/orbital-bot-%d.log | grep -E "META_ACCESS_TOKEN|META_PHONE_NUMBER_ID|META_WABA_ID|Servidor webhook"
`,
		agent.ID,
		agent.ID,
	)

	output, err := executeSSHCommand(agent.ServerIP, agent.ServerPassword, checkScript)
	if err != nil {
		log.Printf("⚠️  [Agent %d] Error verificando reinicio: %v", agent.ID, err)
		return
	}

	// Verificar que las credenciales estén presentes en los logs
	if len(output) > 0 {
		log.Printf("✅ [Agent %d] Bot reiniciado correctamente", agent.ID)
		log.Printf("   📋 Logs: %s", output)
	} else {
		log.Printf("⚠️  [Agent %d] Bot reiniciado pero sin logs de credenciales", agent.ID)
	}
}

// clearMetaCredentialsInBot limpia las credenciales del .env del bot
func clearMetaCredentialsInBot(agent *models.Agent) {
	log.Printf("🗑️  [Agent %d] Limpiando credenciales del bot", agent.ID)

	if agent.ServerIP == "" || agent.ServerPassword == "" {
		log.Printf("❌ [Agent %d] Faltan credenciales del servidor", agent.ID)
		return
	}

	clearScript := fmt.Sprintf(`
ENV_FILE="/opt/orbital-bot-%d/.env"

# Remover credenciales de Meta
sed -i '/^META_ACCESS_TOKEN=/d' $ENV_FILE
sed -i '/^META_PHONE_NUMBER_ID=/d' $ENV_FILE
sed -i '/^META_WABA_ID=/d' $ENV_FILE
sed -i '/^WEBHOOK_VERIFY_TOKEN=/d' $ENV_FILE

echo "✅ Credenciales removidas del .env"

# Reiniciar bot
systemctl restart orbital-bot-%d

echo "✅ Bot reiniciado"
`,
		agent.ID,
		agent.ID,
	)

	output, err := executeSSHCommand(agent.ServerIP, agent.ServerPassword, clearScript)
	if err != nil {
		log.Printf("❌ [Agent %d] Error limpiando credenciales: %v", agent.ID, err)
		return
	}

	log.Printf("✅ [Agent %d] Credenciales limpiadas del servidor", agent.ID)
	log.Printf("   📤 Output: %s", output)
}

// generateWebhookVerifyToken genera un token de verificación único y consistente
// IMPORTANTE: Este token debe ser el mismo siempre para el mismo agente
func generateWebhookVerifyToken(agentID uint) string {
	// Generar token simple pero único basado en el ID del agente
	// Este token será el mismo cada vez que se llame para el mismo agente
	return fmt.Sprintf("orbital_webhook_%d", agentID)
}

// RemoveMetaCredentials es un alias de DisconnectMetaCredentials
// Para mantener compatibilidad con el código existente
func RemoveMetaCredentials(c *gin.Context) {
	DisconnectMetaCredentials(c)
}

// maskSensitiveValue enmascara valores sensibles para logs
func maskSensitiveValue(value string) string {
	if len(value) <= 8 {
		return "***"
	}
	return value[:4] + "..." + value[len(value)-4:]
}
