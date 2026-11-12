package handlers

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"attomos/config"
	"attomos/models"

	"github.com/gin-gonic/gin"
)

// MetaWhatsAppConfig contiene la configuración de Meta
type MetaWhatsAppConfig struct {
	AppID       string
	AppSecret   string
	RedirectURL string
	// ConfigID es la configuración de "Inicio de sesión con Facebook para
	// empresas" (developers.facebook.com → Inicio de sesión con Facebook →
	// Configuraciones). Opcional: si está vacío se usa el flujo clásico con scope.
	ConfigID string
}

// MetaWhatsAppHandler maneja la integración con Meta WhatsApp Business
type MetaWhatsAppHandler struct {
	config *MetaWhatsAppConfig
}

// NewMetaWhatsAppHandler crea una nueva instancia del handler
func NewMetaWhatsAppHandler() (*MetaWhatsAppHandler, error) {
	clientID := os.Getenv("META_APP_ID")
	clientSecret := os.Getenv("META_APP_SECRET")
	redirectURL := os.Getenv("META_REDIRECT_URL")

	if clientID == "" || clientSecret == "" || redirectURL == "" {
		return nil, fmt.Errorf("faltan credenciales de Meta (META_APP_ID, META_APP_SECRET, META_REDIRECT_URL)")
	}

	config := &MetaWhatsAppConfig{
		AppID:       clientID,
		AppSecret:   clientSecret,
		RedirectURL: redirectURL,
		ConfigID:    strings.TrimSpace(os.Getenv("META_CONFIG_ID")),
	}

	log.Printf("✅ Meta WhatsApp Handler configurado")
	log.Printf("   - App ID: %s", clientID)
	log.Printf("   - Redirect URL: %s", redirectURL)
	if config.ConfigID != "" {
		log.Printf("   - Facebook Login for Business config_id: %s", config.ConfigID)
	} else {
		log.Printf("   - ⚠️  META_CONFIG_ID vacío: se usará el flujo OAuth clásico con scope")
	}

	return &MetaWhatsAppHandler{config: config}, nil
}

// InitiateConnection genera la URL de OAuth para conectar WhatsApp a un agente específico
func (h *MetaWhatsAppHandler) InitiateConnection(c *gin.Context) {
	// Obtener usuario autenticado
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Usuario no autenticado"})
		return
	}

	user := userInterface.(*models.User)

	// Obtener agent_id de los parámetros
	agentIDStr := c.Query("agent_id")
	if agentIDStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "agent_id es requerido"})
		return
	}

	agentID, err := strconv.ParseUint(agentIDStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "agent_id inválido"})
		return
	}

	// Verificar que el agente pertenece al usuario
	var agent models.Agent
	if err := config.DB.Where("id = ? AND user_id = ?", agentID, user.ID).First(&agent).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Agente no encontrado"})
		return
	}

	// Generar state token para CSRF protection
	// Formato: user_id:agent_id:timestamp
	stateToken := fmt.Sprintf("%d:%d:%d", user.ID, agentID, time.Now().Unix())
	stateEncoded := base64.URLEncoding.EncodeToString([]byte(stateToken))

	// Guardar state en cookie (expira en 10 minutos)
	c.SetCookie(
		"meta_oauth_state",
		stateEncoded,
		600, // 10 minutos
		"/",
		"",
		false, // Usar true en producción con HTTPS
		true,  // HTTPOnly
	)

	// Construir URL de autorización de Meta
	params := url.Values{}
	params.Set("client_id", h.config.AppID)
	params.Set("redirect_uri", h.config.RedirectURL)
	params.Set("state", stateEncoded)
	params.Set("response_type", "code")
	if h.config.ConfigID != "" {
		// Facebook Login for Business: los permisos y el tipo de token
		// (usuario del sistema, sin caducidad) vienen de la configuración.
		params.Set("config_id", h.config.ConfigID)
		params.Set("override_default_response_type", "true")
	} else {
		params.Set("scope", "business_management,whatsapp_business_management,whatsapp_business_messaging")
	}
	authURL := "https://www.facebook.com/v22.0/dialog/oauth?" + params.Encode()

	c.JSON(http.StatusOK, gin.H{
		"auth_url": authURL,
		"agent_id": agentID,
	})
}

// HandleCallback procesa el callback de OAuth de Meta
func (h *MetaWhatsAppHandler) HandleCallback(c *gin.Context) {
	// Obtener code y state de la query
	code := c.Query("code")
	state := c.Query("state")

	if code == "" {
		c.Redirect(http.StatusFound, "/integrations?error=authorization_failed")
		return
	}

	// Validar state token (CSRF protection)
	savedState, err := c.Cookie("meta_oauth_state")
	if err != nil || savedState != state {
		c.Redirect(http.StatusFound, "/integrations?error=invalid_state")
		return
	}

	// Limpiar cookie de state
	c.SetCookie("meta_oauth_state", "", -1, "/", "", false, true)

	// Decodificar state para obtener user_id y agent_id
	stateDecoded, err := base64.URLEncoding.DecodeString(state)
	if err != nil {
		c.Redirect(http.StatusFound, "/integrations?error=invalid_state")
		return
	}

	parts := strings.Split(string(stateDecoded), ":")
	if len(parts) < 3 {
		c.Redirect(http.StatusFound, "/integrations?error=invalid_state")
		return
	}

	var userID, agentID uint
	fmt.Sscanf(parts[0], "%d", &userID)
	fmt.Sscanf(parts[1], "%d", &agentID)

	// Intercambiar code por access token
	accessToken, err := h.exchangeCodeForToken(code)
	if err != nil {
		log.Printf("❌ Error intercambiando código: %v", err)
		c.Redirect(http.StatusFound, "/integrations?error=token_exchange_failed")
		return
	}

	// Datos del token: WABA autorizadas y caducidad (debug_token)
	tokenInfo, err := h.debugToken(accessToken)
	if err != nil {
		log.Printf("⚠️  No se pudo consultar debug_token (se continúa): %v", err)
		tokenInfo = &metaTokenInfo{}
	}

	// Obtener WABA ID: primero la que el usuario eligió en el diálogo de
	// Facebook; si no viene, el método anterior (/me/businesses)
	wabaID := tokenInfo.firstTarget("whatsapp_business_management")
	if wabaID == "" {
		wabaID, err = h.getWABAID(accessToken)
	}
	if err != nil {
		log.Printf("❌ Error obteniendo WABA ID: %v", err)
		c.Redirect(http.StatusFound, "/integrations?error=waba_not_found")
		return
	}

	// Obtener información del número de teléfono
	phoneInfo, err := h.getPhoneNumberInfo(accessToken, wabaID)
	if err != nil {
		log.Printf("❌ Error obteniendo info del teléfono: %v", err)
		c.Redirect(http.StatusFound, "/integrations?error=phone_info_failed")
		return
	}

	// Verificar que el agente existe y pertenece al usuario
	var agent models.Agent
	if err := config.DB.Where("id = ? AND user_id = ?", agentID, userID).First(&agent).Error; err != nil {
		c.Redirect(http.StatusFound, "/integrations?error=agent_not_found")
		return
	}

	// Guardar credenciales en el agente
	now := time.Now()
	// Token de usuario del sistema (Login for Business): no caduca (expires_at = 0).
	// Se guarda una fecha lejana para que el panel no lo marque como vencido.
	tokenExpires := now.AddDate(10, 0, 0)
	if tokenInfo.ExpiresAt > 0 {
		tokenExpires = time.Unix(tokenInfo.ExpiresAt, 0)
	}

	agent.MetaAccessToken = accessToken
	agent.MetaWABAID = wabaID
	agent.MetaPhoneNumberID = phoneInfo.PhoneNumberID
	agent.MetaDisplayNumber = phoneInfo.DisplayNumber
	agent.MetaVerifiedName = phoneInfo.VerifiedName
	agent.MetaConnected = true
	agent.MetaConnectedAt = &now
	agent.MetaTokenExpiresAt = &tokenExpires

	if err := config.DB.Save(&agent).Error; err != nil {
		log.Printf("❌ Error guardando credenciales: %v", err)
		c.Redirect(http.StatusFound, "/integrations?error=save_failed")
		return
	}

	log.Printf("✅ WhatsApp conectado para agente %d: %s (%s)", agentID, phoneInfo.DisplayNumber, phoneInfo.VerifiedName)

	// Suscribir la app al WABA para que los mensajes entrantes lleguen al
	// webhook de la app (/webhook/meta-app). No bloquea la conexión.
	go h.subscribeAppToWABA(accessToken, wabaID)

	// Llevar las credenciales al .env del bot y reiniciarlo (igual que el
	// formulario manual en meta_credentials.go)
	if agent.IsOrbitalBot() {
		go updateMetaCredentialsInBot(&agent, generateWebhookVerifyToken(agent.ID))
	}

	// Redirigir al frontend con éxito
	c.Redirect(http.StatusFound, fmt.Sprintf("/agents/%d?success=whatsapp_connected", agentID))
}

// exchangeCodeForToken intercambia el código de autorización por un access token
func (h *MetaWhatsAppHandler) exchangeCodeForToken(code string) (string, error) {
	tokenURL := fmt.Sprintf(
		"https://graph.facebook.com/v22.0/oauth/access_token?client_id=%s&client_secret=%s&code=%s&redirect_uri=%s",
		h.config.AppID,
		h.config.AppSecret,
		code,
		url.QueryEscape(h.config.RedirectURL),
	)

	resp, err := http.Get(tokenURL)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var result struct {
		AccessToken string `json:"access_token"`
		Error       *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}

	if result.AccessToken == "" {
		if result.Error != nil && result.Error.Message != "" {
			return "", fmt.Errorf("no se recibió access_token: %s", result.Error.Message)
		}
		return "", fmt.Errorf("no se recibió access_token")
	}

	return result.AccessToken, nil
}

// metaTokenInfo es lo que nos interesa de GET /debug_token
type metaTokenInfo struct {
	ExpiresAt      int64 `json:"expires_at"`
	GranularScopes []struct {
		Scope     string   `json:"scope"`
		TargetIDs []string `json:"target_ids"`
	} `json:"granular_scopes"`
}

// firstTarget regresa el primer activo autorizado para un permiso
// (p. ej. el WABA elegido en el diálogo de Facebook)
func (t *metaTokenInfo) firstTarget(scope string) string {
	for _, gs := range t.GranularScopes {
		if gs.Scope == scope && len(gs.TargetIDs) > 0 {
			return gs.TargetIDs[0]
		}
	}
	return ""
}

// debugToken consulta caducidad y activos autorizados del token
func (h *MetaWhatsAppHandler) debugToken(accessToken string) (*metaTokenInfo, error) {
	debugURL := fmt.Sprintf(
		"https://graph.facebook.com/v22.0/debug_token?input_token=%s&access_token=%s",
		url.QueryEscape(accessToken),
		url.QueryEscape(h.config.AppID+"|"+h.config.AppSecret),
	)

	resp, err := http.Get(debugURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result struct {
		Data  metaTokenInfo `json:"data"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	if result.Error != nil {
		return nil, fmt.Errorf("%s", result.Error.Message)
	}
	return &result.Data, nil
}

// subscribeAppToWABA suscribe la app de Attomos al WABA del cliente
// (POST /{waba-id}/subscribed_apps) para recibir sus webhooks
func (h *MetaWhatsAppHandler) subscribeAppToWABA(accessToken, wabaID string) {
	subURL := fmt.Sprintf("https://graph.facebook.com/v22.0/%s/subscribed_apps", wabaID)
	req, err := http.NewRequest(http.MethodPost, subURL, nil)
	if err != nil {
		log.Printf("⚠️  No se pudo crear la suscripción al WABA %s: %v", wabaID, err)
		return
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("⚠️  Error suscribiendo la app al WABA %s: %v", wabaID, err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		var body map[string]interface{}
		json.NewDecoder(resp.Body).Decode(&body)
		log.Printf("⚠️  Meta respondió %d al suscribir el WABA %s: %v", resp.StatusCode, wabaID, body)
		return
	}
	log.Printf("✅ App suscrita a los webhooks del WABA %s", wabaID)
}

// getWABAID obtiene el WhatsApp Business Account ID
func (h *MetaWhatsAppHandler) getWABAID(accessToken string) (string, error) {
	// Obtener negocios del usuario
	businessURL := fmt.Sprintf(
		"https://graph.facebook.com/v22.0/me/businesses?access_token=%s",
		accessToken,
	)

	resp, err := http.Get(businessURL)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var result struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}

	if len(result.Data) == 0 {
		return "", fmt.Errorf("no se encontraron negocios asociados")
	}

	businessID := result.Data[0].ID

	// Obtener WABA del negocio
	wabaURL := fmt.Sprintf(
		"https://graph.facebook.com/v22.0/%s/owned_whatsapp_business_accounts?access_token=%s",
		businessID,
		accessToken,
	)

	resp2, err := http.Get(wabaURL)
	if err != nil {
		return "", err
	}
	defer resp2.Body.Close()

	var wabaResult struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}

	if err := json.NewDecoder(resp2.Body).Decode(&wabaResult); err != nil {
		return "", err
	}

	if len(wabaResult.Data) == 0 {
		return "", fmt.Errorf("no se encontró WhatsApp Business Account")
	}

	return wabaResult.Data[0].ID, nil
}

// PhoneNumberInfo contiene información del número de WhatsApp
type PhoneNumberInfo struct {
	PhoneNumberID string
	DisplayNumber string
	VerifiedName  string
}

// getPhoneNumberInfo obtiene la información del número de teléfono
func (h *MetaWhatsAppHandler) getPhoneNumberInfo(accessToken, wabaID string) (*PhoneNumberInfo, error) {
	phoneURL := fmt.Sprintf(
		"https://graph.facebook.com/v22.0/%s/phone_numbers?access_token=%s",
		wabaID,
		accessToken,
	)

	resp, err := http.Get(phoneURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result struct {
		Data []struct {
			ID            string `json:"id"`
			DisplayNumber string `json:"display_phone_number"`
			VerifiedName  string `json:"verified_name"`
		} `json:"data"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	if len(result.Data) == 0 {
		return nil, fmt.Errorf("no se encontraron números de teléfono")
	}

	phone := result.Data[0]

	return &PhoneNumberInfo{
		PhoneNumberID: phone.ID,
		DisplayNumber: phone.DisplayNumber,
		VerifiedName:  phone.VerifiedName,
	}, nil
}

// GetConnectionStatus obtiene el estado de conexión de un agente específico
func (h *MetaWhatsAppHandler) GetConnectionStatus(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Usuario no autenticado"})
		return
	}

	user := userInterface.(*models.User)

	// Obtener agent_id de los parámetros
	agentIDStr := c.Param("agent_id")
	if agentIDStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "agent_id es requerido"})
		return
	}

	agentID, err := strconv.ParseUint(agentIDStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "agent_id inválido"})
		return
	}

	// Verificar que el agente pertenece al usuario
	var agent models.Agent
	if err := config.DB.Where("id = ? AND user_id = ?", agentID, user.ID).First(&agent).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Agente no encontrado"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"agent_id":         agent.ID,
		"connected":        agent.MetaConnected,
		"phone_number_id":  agent.MetaPhoneNumberID,
		"display_number":   agent.MetaDisplayNumber,
		"verified_name":    agent.MetaVerifiedName,
		"connected_at":     agent.MetaConnectedAt,
		"token_expires_at": agent.MetaTokenExpiresAt,
		"days_remaining":   agent.GetMetaTokenDaysRemaining(),
		"token_expired":    agent.IsMetaTokenExpired(),
	})
}

// DisconnectWhatsApp desconecta WhatsApp de un agente específico
func (h *MetaWhatsAppHandler) DisconnectWhatsApp(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Usuario no autenticado"})
		return
	}

	user := userInterface.(*models.User)

	// Obtener agent_id de los parámetros
	agentIDStr := c.Param("agent_id")
	if agentIDStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "agent_id es requerido"})
		return
	}

	agentID, err := strconv.ParseUint(agentIDStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "agent_id inválido"})
		return
	}

	// Verificar que el agente pertenece al usuario
	var agent models.Agent
	if err := config.DB.Where("id = ? AND user_id = ?", agentID, user.ID).First(&agent).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Agente no encontrado"})
		return
	}

	// Limpiar credenciales de Meta
	agent.MetaAccessToken = ""
	agent.MetaWABAID = ""
	agent.MetaPhoneNumberID = ""
	agent.MetaDisplayNumber = ""
	agent.MetaVerifiedName = ""
	agent.MetaConnected = false
	agent.MetaConnectedAt = nil
	agent.MetaTokenExpiresAt = nil

	if err := config.DB.Save(&agent).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al desconectar"})
		return
	}

	log.Printf("✅ WhatsApp desconectado para agente %d", agent.ID)

	c.JSON(http.StatusOK, gin.H{
		"success":  true,
		"message":  "WhatsApp desconectado exitosamente",
		"agent_id": agent.ID,
	})
}
