package handlers

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"attomos/config"
	"attomos/models"

	"github.com/gin-gonic/gin"
)

// =============================================================================
// API EXPLORER — conecta cualquier endpoint externo que responda JSON y lo
// muestra en tabla. El backend hace el fetch al endpoint externo (proxy) en
// vez de que lo haga el navegador — así:
//   1. La API key del endpoint externo nunca se manda al navegador.
//   2. Se evita el problema de CORS que tenía la versión 100% frontend.
//
// Los datos viven en models.MyBusinessInfo (la sucursal/negocio), NO en
// models.Agent — así sobreviven a que el agente/bot se borre y se vuelva a
// crear. Antes vivían en Agent y se perdían en ese caso (ver comentario en
// agent.go). Un bot los consulta a través de su agent.BranchID.
//
//	APIExplorerEndpoint    string
//	APIExplorerKey         string
//	APIExplorerAuthMode    string     // "header" | "bearer" | "query" — default "header"
//	APIExplorerConnected   bool
//	APIExplorerConnectedAt *time.Time
//
// =============================================================================

const apiExplorerFetchTimeout = 15 * time.Second

// GetAPIExplorerStatus — GET /api/api-explorer/status/:branch_id
func GetAPIExplorerStatus(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	branch, ok := getBranchForAPIExplorer(c)
	if !ok {
		return
	}

	resp := gin.H{"connected": branch.APIExplorerConnected}
	if branch.APIExplorerConnected {
		resp["endpoint"] = branch.APIExplorerEndpoint
		resp["auth_mode"] = branch.APIExplorerAuthMode
		resp["has_key"] = branch.APIExplorerKey != ""
		if branch.APIExplorerConnectedAt != nil {
			resp["connected_at"] = branch.APIExplorerConnectedAt.Format(time.RFC3339)
		}
	}
	c.JSON(http.StatusOK, resp)
}

// ConnectAPIExplorerRequest — body de POST /api/api-explorer/connect/:branch_id
type ConnectAPIExplorerRequest struct {
	Endpoint string `json:"endpoint" binding:"required"`
	APIKey   string `json:"api_key"`
	AuthMode string `json:"auth_mode"`
}

// ConnectAPIExplorer — POST /api/api-explorer/connect/:branch_id
// Guarda el endpoint + key en el servidor (nunca en localStorage del
// navegador) y hace una prueba de conexión antes de confirmar.
func ConnectAPIExplorer(c *gin.Context) {
	branch, ok := getBranchForAPIExplorer(c)
	if !ok {
		return
	}

	var req ConnectAPIExplorerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos inválidos", "details": err.Error()})
		return
	}

	endpoint := strings.TrimSpace(req.Endpoint)
	parsed, err := url.ParseRequestURI(endpoint)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "El endpoint debe ser una URL http(s) válida"})
		return
	}

	authMode := strings.TrimSpace(req.AuthMode)
	if authMode != "bearer" && authMode != "query" {
		authMode = "header" // default
	}
	apiKey := strings.TrimSpace(req.APIKey)

	// Log sin exponer la key completa (mismo criterio que SetInventoryGeminiKey).
	safeSnippet := apiKey
	if len(apiKey) > 10 {
		safeSnippet = apiKey[:4] + "…" + apiKey[len(apiKey)-4:]
	}
	log.Printf("🔌 [Branch %d] Probando conexión API Explorer — endpoint=%s auth_mode=%s key=%q", branch.ID, endpoint, authMode, safeSnippet)

	result, err := fetchExternalJSON(endpoint, apiKey, authMode)
	if err != nil {
		log.Printf("❌ [Branch %d] API Explorer: prueba de conexión falló — err=%v", branch.ID, err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "No se pudo conectar con ese endpoint: " + err.Error()})
		return
	}

	now := time.Now()
	branch.APIExplorerEndpoint = endpoint
	branch.APIExplorerKey = apiKey
	branch.APIExplorerAuthMode = authMode
	branch.APIExplorerConnected = true
	branch.APIExplorerConnectedAt = &now

	// Updates() parcial (solo estas 5 columnas) en vez de Save() del struct
	// completo — evita pisar cualquier otro cambio hecho en paralelo sobre
	// la misma sucursal (ej. alguien guardando Mi Negocio al mismo tiempo).
	if err := config.DB.Model(branch).Updates(map[string]interface{}{
		"api_explorer_endpoint":     branch.APIExplorerEndpoint,
		"api_explorer_key":          branch.APIExplorerKey,
		"api_explorer_auth_mode":    branch.APIExplorerAuthMode,
		"api_explorer_connected":    branch.APIExplorerConnected,
		"api_explorer_connected_at": branch.APIExplorerConnectedAt,
	}).Error; err != nil {
		log.Printf("❌ [Branch %d] API Explorer: error guardando en DB — err=%v", branch.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "No se pudo guardar la conexión"})
		return
	}

	log.Printf("✅ [Branch %d] API Explorer conectado — endpoint=%s", branch.ID, endpoint)
	notifyBranchAgentsToRefreshAPIExplorer(branch.ID)
	c.JSON(http.StatusOK, gin.H{
		"connected":    true,
		"endpoint":     endpoint,
		"auth_mode":    authMode,
		"has_key":      apiKey != "",
		"connected_at": now.Format(time.RFC3339),
		"preview":      result,
	})
}

// DisconnectAPIExplorer — POST /api/api-explorer/disconnect/:branch_id
func DisconnectAPIExplorer(c *gin.Context) {
	branch, ok := getBranchForAPIExplorer(c)
	if !ok {
		return
	}

	// Updates() parcial con map (no struct): un Updates() de struct omite
	// campos en su valor zero (string vacío, bool false, nil), así que
	// "olvidar" la key NUNCA se guardaría con ese approach — el map fuerza a
	// escribir esos ceros de verdad.
	if err := config.DB.Model(branch).Updates(map[string]interface{}{
		"api_explorer_endpoint":     "",
		"api_explorer_key":          "",
		"api_explorer_auth_mode":    "",
		"api_explorer_connected":    false,
		"api_explorer_connected_at": nil,
	}).Error; err != nil {
		log.Printf("❌ [Branch %d] API Explorer: error al desconectar — err=%v", branch.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "No se pudo desconectar"})
		return
	}

	log.Printf("✅ [Branch %d] API Explorer desconectado (key olvidada del servidor)", branch.ID)
	notifyBranchAgentsToRefreshAPIExplorer(branch.ID)
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// GetAPIExplorerData — GET /api/api-explorer/data/:branch_id
// El backend hace el fetch al endpoint externo guardado (con la key, si
// aplica) y regresa el JSON tal cual al frontend. El navegador nunca ve la
// key ni pega directo contra el endpoint externo (evita CORS).
func GetAPIExplorerData(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	branch, ok := getBranchForAPIExplorer(c)
	if !ok {
		return
	}

	if !branch.APIExplorerConnected || branch.APIExplorerEndpoint == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No hay ningún endpoint conectado"})
		return
	}

	result, err := fetchExternalJSON(branch.APIExplorerEndpoint, branch.APIExplorerKey, branch.APIExplorerAuthMode)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"ok":    false,
			"error": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, result)
}

// GetAPIExplorerForBot — GET /api/bot/api-explorer/:agent_id
// Lo consume el bot de WhatsApp (no el navegador) para leer el inventario
// conectado y poder responder preguntas del cliente con esos datos. Se
// autentica con BOT_API_TOKEN — el mismo secreto que ya usan
// /api/bot/orders, /api/bot/inscriptions y /api/payment-config/bot/:branch_id
// — en vez de sesión de usuario, porque el bot no tiene una.
//
// Sigue keyed por agent_id (así lo consume el bot, vía AGENT_ID en su .env),
// pero internamente resuelve la sucursal vinculada (agent.BranchID) y lee
// los datos de ahí — el bot no necesita saber que el dato vive en la
// sucursal y no en su propio registro de agente.
func GetAPIExplorerForBot(c *gin.Context) {
	botToken := os.Getenv("BOT_API_TOKEN")
	if botToken == "" || c.GetHeader("Authorization") != "Bearer "+botToken {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Token inválido"})
		return
	}

	agentID := c.Param("agent_id")
	var agent models.Agent
	if err := config.DB.Where("id = ?", agentID).First(&agent).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Agente no encontrado"})
		return
	}

	if agent.BranchID == 0 {
		c.JSON(http.StatusOK, gin.H{"connected": false})
		return
	}

	var branch models.MyBusinessInfo
	if err := config.DB.Where("id = ?", agent.BranchID).First(&branch).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{"connected": false})
		return
	}

	if !branch.APIExplorerConnected || branch.APIExplorerEndpoint == "" {
		c.JSON(http.StatusOK, gin.H{"connected": false})
		return
	}

	result, err := fetchExternalJSON(branch.APIExplorerEndpoint, branch.APIExplorerKey, branch.APIExplorerAuthMode)
	if err != nil {
		log.Printf("⚠️  [Branch %d] API Explorer (bot, agente %d): error consultando endpoint externo — %v", branch.ID, agent.ID, err)
		c.JSON(http.StatusOK, gin.H{"connected": true, "ok": false, "error": err.Error()})
		return
	}

	result["connected"] = true
	// site_url — la web pública del cliente (mismo host que el endpoint,
	// sin el path de la API), para que el bot pueda invitar al cliente a
	// verlo también ahí, además de por WhatsApp.
	if siteURL := apxSiteURLFromEndpoint(branch.APIExplorerEndpoint); siteURL != "" {
		result["site_url"] = siteURL
	}
	c.JSON(http.StatusOK, result)
}

// ---------- helpers ----------

// apxSiteURLFromEndpoint deriva la URL pública del sitio (scheme + host) a
// partir del endpoint de API guardado — ej. de
// "https://fabianmongeautos.online/api/v1/vehiculos" saca
// "https://fabianmongeautos.online". Best-effort: si el endpoint no trae un
// host válido, regresa "".
func apxSiteURLFromEndpoint(endpoint string) string {
	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.Host == "" {
		return ""
	}
	return parsed.Scheme + "://" + parsed.Host
}

// getBranchForAPIExplorer obtiene la sucursal (MyBusinessInfo) verificando
// que pertenece al usuario autenticado — mismo patrón que GetBranch en
// business_handler.go. Función libre (no método) para no chocar con otros
// helpers getXForUser del paquete.
func getBranchForAPIExplorer(c *gin.Context) (*models.MyBusinessInfo, bool) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return nil, false
	}
	user := userInterface.(*models.User)

	branchID := c.Param("branch_id")
	var branch models.MyBusinessInfo
	if err := config.DB.Where("id = ? AND user_id = ?", branchID, user.ID).First(&branch).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Sucursal no encontrada"})
		return nil, false
	}
	return &branch, true
}

// notifyBranchAgentsToRefreshAPIExplorer avisa a TODOS los agentes/bots
// vinculados a esta sucursal (branch_id) — puede haber más de uno — que
// refresquen su caché del API Explorer de inmediato, en vez de esperar hasta
// 5 min a su siguiente ciclo de polling. Mismo patrón que syncAtomicBots en
// business_handler.go, pero sin filtrar por bot_type porque el comando
// "refresh_api_explorer" ya se maneja de forma genérica en el bot.
// Best-effort: si un bot no está conectado (apagado, redesplegándose, etc.)
// no pasa nada — su polling normal lo recoge de todas formas.
func notifyBranchAgentsToRefreshAPIExplorer(branchID uint) {
	var agents []models.Agent
	if err := config.DB.Where("branch_id = ? AND is_active = ?", branchID, true).Find(&agents).Error; err != nil || len(agents) == 0 {
		return
	}
	for _, agent := range agents {
		if CRMHub.sendToBot(agent.ID, crmSendCommand{Type: "refresh_api_explorer"}) {
			log.Printf("🔄 [Branch %d] Aviso de refresco de API Explorer enviado al agente %d", branchID, agent.ID)
		} else {
			log.Printf("ℹ️  [Branch %d] Agente %d no conectado al hub del CRM ahora mismo — recogerá el cambio en su próximo ciclo de polling", branchID, agent.ID)
		}
	}
}

// fetchExternalJSON hace el request al endpoint externo del cliente,
// adjuntando la key según authMode, y regresa un resumen listo para el
// frontend (estado, tiempo de respuesta, y el JSON crudo ya parseado).
func fetchExternalJSON(endpoint, apiKey, authMode string) (gin.H, error) {
	reqURL := endpoint
	client := &http.Client{Timeout: apiExplorerFetchTimeout}

	req, err := http.NewRequest(http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, err
	}

	if apiKey != "" {
		switch authMode {
		case "bearer":
			req.Header.Set("Authorization", "Bearer "+apiKey)
		case "query":
			q := req.URL.Query()
			q.Set("api_key", apiKey)
			req.URL.RawQuery = q.Encode()
		default: // "header"
			req.Header.Set("X-API-Key", apiKey)
		}
	}

	start := time.Now()
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()

	body, err := io.ReadAll(io.LimitReader(res.Body, 5<<20)) // 5 MB máx
	if err != nil {
		return nil, err
	}
	elapsedMs := time.Since(start).Milliseconds()

	var parsed interface{}
	if len(body) > 0 {
		if err := json.Unmarshal(body, &parsed); err != nil {
			return nil, err
		}
	}

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return gin.H{
			"ok":         false,
			"status":     res.StatusCode,
			"elapsed_ms": elapsedMs,
			"data":       parsed,
		}, nil
	}

	return gin.H{
		"ok":         true,
		"status":     res.StatusCode,
		"elapsed_ms": elapsedMs,
		"data":       parsed,
	}, nil
}
