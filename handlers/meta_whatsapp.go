package handlers

import (
	"bytes"
	"crypto/rand"
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
	// empresas" creada con la variación "WhatsApp Embedded Signup"
	// (developers.facebook.com → Inicio de sesión con Facebook → Configuraciones).
	// Si está definida, el panel usa Embedded Signup (SDK de JavaScript);
	// si está vacía, se usa el flujo OAuth clásico con scope.
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
		log.Printf("   - WhatsApp Embedded Signup config_id: %s", config.ConfigID)
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

	// Embedded Signup: el navegador abre el popup oficial de Meta con el SDK
	// de JavaScript y luego manda el código a CompleteEmbeddedSignup.
	if h.config.ConfigID != "" {
		c.JSON(http.StatusOK, gin.H{
			"mode":          "embedded_signup",
			"app_id":        h.config.AppID,
			"config_id":     h.config.ConfigID,
			"graph_version": "v22.0",
			"agent_id":      agentID,
		})
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
	params.Set("scope", "business_management,whatsapp_business_management,whatsapp_business_messaging")
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

	// El código del flujo con scope da un token de usuario de 1–2 horas:
	// cambiarlo por uno de larga duración (~60 días). Los tokens de usuario
	// del sistema (config_id) no lo necesitan; si falla se usa el original.
	if longLived, err := h.exchangeForLongLivedToken(accessToken); err == nil {
		accessToken = longLived
	} else {
		log.Printf("ℹ️  No se cambió a token de larga duración (se usa el original): %v", err)
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
	log.Printf("🔎 debug_token: expires_at=%d, scopes=%+v", tokenInfo.ExpiresAt, tokenInfo.GranularScopes)
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

// exchangeForLongLivedToken cambia un token de usuario de corta duración
// por uno de larga duración (~60 días)
func (h *MetaWhatsAppHandler) exchangeForLongLivedToken(shortToken string) (string, error) {
	params := url.Values{}
	params.Set("grant_type", "fb_exchange_token")
	params.Set("client_id", h.config.AppID)
	params.Set("client_secret", h.config.AppSecret)
	params.Set("fb_exchange_token", shortToken)

	resp, err := http.Get("https://graph.facebook.com/v22.0/oauth/access_token?" + params.Encode())
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
		if result.Error != nil {
			return "", fmt.Errorf("%s", result.Error.Message)
		}
		return "", fmt.Errorf("respuesta sin access_token")
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
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}

	if result.Error != nil {
		return "", fmt.Errorf("/me/businesses: %s", result.Error.Message)
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
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}

	if err := json.NewDecoder(resp2.Body).Decode(&wabaResult); err != nil {
		return "", err
	}

	if wabaResult.Error != nil {
		return "", fmt.Errorf("owned_whatsapp_business_accounts: %s", wabaResult.Error.Message)
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

// ============================================================================
// WHATSAPP EMBEDDED SIGNUP (flujo oficial para proveedores de tecnología)
// ============================================================================

// CompleteEmbeddedSignup recibe lo que regresa el popup de Embedded Signup
// (código + WABA + número que eligió el cliente) y conecta el agente.
// POST /api/meta/embedded-signup/:agent_id
// Body: { "code": "...", "wabaId": "...", "phoneNumberId": "..." }
func (h *MetaWhatsAppHandler) CompleteEmbeddedSignup(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Usuario no autenticado"})
		return
	}
	user := userInterface.(*models.User)

	agentID, err := strconv.ParseUint(c.Param("agent_id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "agent_id inválido"})
		return
	}

	var agent models.Agent
	if err := config.DB.Where("id = ? AND user_id = ?", agentID, user.ID).First(&agent).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Agente no encontrado"})
		return
	}

	var req struct {
		Code          string `json:"code"`
		WABAID        string `json:"wabaId"`
		PhoneNumberID string `json:"phoneNumberId"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Code) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Falta el código de autorización de Meta"})
		return
	}

	// 1. Código → token de integración comercial (usuario del sistema, no caduca).
	//    En el flujo del SDK de JavaScript el intercambio va SIN redirect_uri.
	accessToken, err := h.exchangeEmbeddedSignupCode(req.Code)
	if err != nil {
		log.Printf("❌ [Agent %d] Embedded Signup: error intercambiando código: %v", agent.ID, err)
		c.JSON(http.StatusBadGateway, gin.H{"error": "Meta rechazó la autorización: " + err.Error()})
		return
	}

	tokenInfo, err := h.debugToken(accessToken)
	if err != nil {
		log.Printf("⚠️  [Agent %d] debug_token falló (se continúa): %v", agent.ID, err)
		tokenInfo = &metaTokenInfo{}
	}

	// 2. WABA y número: los manda el popup (sessionInfo); si no, del token
	wabaID := strings.TrimSpace(req.WABAID)
	if wabaID == "" {
		wabaID = tokenInfo.firstTarget("whatsapp_business_management")
	}
	if wabaID == "" {
		log.Printf("❌ [Agent %d] Embedded Signup sin WABA. scopes=%+v", agent.ID, tokenInfo.GranularScopes)
		c.JSON(http.StatusBadRequest, gin.H{"error": "No se recibió la cuenta de WhatsApp Business. Vuelve a intentarlo y completa todos los pasos."})
		return
	}

	phoneNumberID := strings.TrimSpace(req.PhoneNumberID)
	var displayNumber, verifiedName string
	if phoneNumberID == "" {
		info, err := h.getPhoneNumberInfo(accessToken, wabaID)
		if err != nil {
			log.Printf("❌ [Agent %d] Embedded Signup: sin número en WABA %s: %v", agent.ID, wabaID, err)
			c.JSON(http.StatusBadRequest, gin.H{"error": "La cuenta de WhatsApp Business no tiene números de teléfono"})
			return
		}
		phoneNumberID, displayNumber, verifiedName = info.PhoneNumberID, info.DisplayNumber, info.VerifiedName
	} else {
		displayNumber, verifiedName, _ = fetchMetaPhoneNumberInfo(accessToken, phoneNumberID)
	}

	// 3. Suscribir la app al WABA (webhooks → /webhook/meta-app)
	h.subscribeAppToWABA(accessToken, wabaID)

	// 4. Registrar el número en la Cloud API (necesario para números nuevos;
	//    si ya estaba registrado, Meta lo indica y se continúa)
	h.registerPhoneNumber(accessToken, phoneNumberID)

	// 5. Guardar en el agente
	now := time.Now()
	tokenExpires := now.AddDate(10, 0, 0) // token de usuario del sistema: no caduca
	if tokenInfo.ExpiresAt > 0 {
		tokenExpires = time.Unix(tokenInfo.ExpiresAt, 0)
	}

	agent.MetaAccessToken = accessToken
	agent.MetaWABAID = wabaID
	agent.MetaPhoneNumberID = phoneNumberID
	agent.MetaDisplayNumber = displayNumber
	agent.MetaVerifiedName = verifiedName
	agent.MetaConnected = true
	agent.MetaConnectedAt = &now
	agent.MetaTokenExpiresAt = &tokenExpires

	if err := config.DB.Save(&agent).Error; err != nil {
		log.Printf("❌ [Agent %d] Embedded Signup: error guardando: %v", agent.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al guardar la conexión"})
		return
	}

	log.Printf("✅ [Agent %d] WhatsApp conectado con Embedded Signup: %s (%s) WABA=%s", agent.ID, displayNumber, verifiedName, wabaID)

	// 6. Llevar credenciales al bot y reiniciarlo
	if agent.IsOrbitalBot() {
		go updateMetaCredentialsInBot(&agent, generateWebhookVerifyToken(agent.ID))
	}

	c.JSON(http.StatusOK, gin.H{
		"success":       true,
		"displayNumber": displayNumber,
		"verifiedName":  verifiedName,
		"wabaId":        wabaID,
		"phoneNumberId": phoneNumberID,
	})
}

// exchangeEmbeddedSignupCode intercambia el código del SDK de JavaScript
// (sin redirect_uri) por el token de integración comercial
func (h *MetaWhatsAppHandler) exchangeEmbeddedSignupCode(code string) (string, error) {
	params := url.Values{}
	params.Set("client_id", h.config.AppID)
	params.Set("client_secret", h.config.AppSecret)
	params.Set("code", code)

	resp, err := http.Get("https://graph.facebook.com/v22.0/oauth/access_token?" + params.Encode())
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
		if result.Error != nil {
			return "", fmt.Errorf("%s", result.Error.Message)
		}
		return "", fmt.Errorf("respuesta sin access_token")
	}
	return result.AccessToken, nil
}

// registerPhoneNumber registra el número en la Cloud API con un PIN de
// verificación en dos pasos aleatorio (el cliente puede cambiarlo después
// en WhatsApp Manager). No bloquea la conexión si falla.
func (h *MetaWhatsAppHandler) registerPhoneNumber(accessToken, phoneNumberID string) {
	pin := randomSixDigitPIN()
	body, _ := json.Marshal(map[string]string{
		"messaging_product": "whatsapp",
		"pin":               pin,
	})

	req, err := http.NewRequest(http.MethodPost,
		fmt.Sprintf("https://graph.facebook.com/v22.0/%s/register", phoneNumberID),
		bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("⚠️  Error registrando el número %s: %v", phoneNumberID, err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		var out map[string]interface{}
		json.NewDecoder(resp.Body).Decode(&out)
		log.Printf("ℹ️  Registro del número %s respondió %d (si ya estaba registrado es normal): %v", phoneNumberID, resp.StatusCode, out)
		return
	}
	log.Printf("✅ Número %s registrado en la Cloud API", phoneNumberID)
}

func randomSixDigitPIN() string {
	b := make([]byte, 4)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%06d", time.Now().UnixNano()%1000000)
	}
	n := (uint32(b[0])<<24 | uint32(b[1])<<16 | uint32(b[2])<<8 | uint32(b[3])) % 1000000
	return fmt.Sprintf("%06d", n)
}
