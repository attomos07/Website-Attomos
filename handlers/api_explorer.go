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
// muestra en tabla. Mismo patrón que InventorySheet* (campos planos en
// models.Agent, protegidos por getAgentForUser), salvo que aquí el propio
// backend hace el fetch al endpoint externo (proxy) en vez de que lo haga
// el navegador — así:
//   1. La API key del endpoint externo nunca se manda al navegador.
//   2. Se evita el problema de CORS que tenía la versión 100% frontend.
//
// IMPORTANTE — requiere 5 campos nuevos en models.Agent (mismo patrón que
// InventorySheetID / InventorySheetConnected / InventorySheetConnectedAt):
//
//	APIExplorerEndpoint    string
//	APIExplorerKey         string
//	APIExplorerAuthMode    string     // "header" | "bearer" | "query" — default "header"
//	APIExplorerConnected   bool
//	APIExplorerConnectedAt *time.Time
//
// =============================================================================

const apiExplorerFetchTimeout = 15 * time.Second

// GetAPIExplorerStatus — GET /api/api-explorer/status/:agent_id
func GetAPIExplorerStatus(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	agent, _, ok := getAgentForAPIExplorer(c)
	if !ok {
		return
	}

	resp := gin.H{"connected": agent.APIExplorerConnected}
	if agent.APIExplorerConnected {
		resp["endpoint"] = agent.APIExplorerEndpoint
		resp["auth_mode"] = agent.APIExplorerAuthMode
		resp["has_key"] = agent.APIExplorerKey != ""
		if agent.APIExplorerConnectedAt != nil {
			resp["connected_at"] = agent.APIExplorerConnectedAt.Format(time.RFC3339)
		}
	}
	c.JSON(http.StatusOK, resp)
}

// ConnectAPIExplorerRequest — body de POST /api/api-explorer/connect/:agent_id
type ConnectAPIExplorerRequest struct {
	Endpoint string `json:"endpoint" binding:"required"`
	APIKey   string `json:"api_key"`
	AuthMode string `json:"auth_mode"`
}

// ConnectAPIExplorer — POST /api/api-explorer/connect/:agent_id
// Guarda el endpoint + key en el servidor (nunca en localStorage del
// navegador) y hace una prueba de conexión antes de confirmar.
func ConnectAPIExplorer(c *gin.Context) {
	agent, _, ok := getAgentForAPIExplorer(c)
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
	log.Printf("🔌 [Agent %d] Probando conexión API Explorer — endpoint=%s auth_mode=%s key=%q", agent.ID, endpoint, authMode, safeSnippet)

	result, err := fetchExternalJSON(endpoint, apiKey, authMode)
	if err != nil {
		log.Printf("❌ [Agent %d] API Explorer: prueba de conexión falló — err=%v", agent.ID, err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "No se pudo conectar con ese endpoint: " + err.Error()})
		return
	}

	now := time.Now()
	agent.APIExplorerEndpoint = endpoint
	agent.APIExplorerKey = apiKey
	agent.APIExplorerAuthMode = authMode
	agent.APIExplorerConnected = true
	agent.APIExplorerConnectedAt = &now

	if err := config.DB.Save(agent).Error; err != nil {
		log.Printf("❌ [Agent %d] API Explorer: error guardando en DB — err=%v", agent.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "No se pudo guardar la conexión"})
		return
	}

	log.Printf("✅ [Agent %d] API Explorer conectado — endpoint=%s", agent.ID, endpoint)
	c.JSON(http.StatusOK, gin.H{
		"connected":    true,
		"endpoint":     endpoint,
		"auth_mode":    authMode,
		"has_key":      apiKey != "",
		"connected_at": now.Format(time.RFC3339),
		"preview":      result,
	})
}

// DisconnectAPIExplorer — POST /api/api-explorer/disconnect/:agent_id
func DisconnectAPIExplorer(c *gin.Context) {
	agent, _, ok := getAgentForAPIExplorer(c)
	if !ok {
		return
	}

	agent.APIExplorerEndpoint = ""
	agent.APIExplorerKey = ""
	agent.APIExplorerAuthMode = ""
	agent.APIExplorerConnected = false
	agent.APIExplorerConnectedAt = nil

	if err := config.DB.Save(agent).Error; err != nil {
		log.Printf("❌ [Agent %d] API Explorer: error al desconectar — err=%v", agent.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "No se pudo desconectar"})
		return
	}

	log.Printf("✅ [Agent %d] API Explorer desconectado (key olvidada del servidor)", agent.ID)
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// GetAPIExplorerData — GET /api/api-explorer/data/:agent_id
// El backend hace el fetch al endpoint externo guardado (con la key, si
// aplica) y regresa el JSON tal cual al frontend. El navegador nunca ve la
// key ni pega directo contra el endpoint externo (evita CORS).
func GetAPIExplorerData(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	agent, _, ok := getAgentForAPIExplorer(c)
	if !ok {
		return
	}

	if !agent.APIExplorerConnected || agent.APIExplorerEndpoint == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No hay ningún endpoint conectado"})
		return
	}

	result, err := fetchExternalJSON(agent.APIExplorerEndpoint, agent.APIExplorerKey, agent.APIExplorerAuthMode)
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

	if !agent.APIExplorerConnected || agent.APIExplorerEndpoint == "" {
		c.JSON(http.StatusOK, gin.H{"connected": false})
		return
	}

	result, err := fetchExternalJSON(agent.APIExplorerEndpoint, agent.APIExplorerKey, agent.APIExplorerAuthMode)
	if err != nil {
		log.Printf("⚠️  [Agent %d] API Explorer (bot): error consultando endpoint externo — %v", agent.ID, err)
		c.JSON(http.StatusOK, gin.H{"connected": true, "ok": false, "error": err.Error()})
		return
	}

	result["connected"] = true
	c.JSON(http.StatusOK, result)
}

// ---------- helpers ----------

// getAgentForAPIExplorer obtiene el agente verificando que pertenece al
// usuario autenticado. Función libre (no método) para no chocar con
// GoogleIntegrationHandler.getAgentForUser, que vive en inventory_sheets.go.
func getAgentForAPIExplorer(c *gin.Context) (*models.Agent, *models.User, bool) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return nil, nil, false
	}
	user := userInterface.(*models.User)

	agentID := c.Param("agent_id")
	var agent models.Agent
	if err := config.DB.Where("id = ? AND user_id = ?", agentID, user.ID).First(&agent).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Agente no encontrado"})
		return nil, nil, false
	}
	return &agent, user, true
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
