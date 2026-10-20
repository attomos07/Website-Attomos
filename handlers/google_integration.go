package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"attomos/config"
	"attomos/models"

	"attomos/bots"
	googlesvc "attomos/google"
	"github.com/gin-gonic/gin"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	"google.golang.org/api/drive/v3"
	"google.golang.org/api/option"
)

type GoogleIntegrationHandler struct {
	calendarService *googlesvc.GoogleCalendarService
	sheetsService   *googlesvc.GoogleSheetsService
}

type Schedule struct {
	Monday    DaySchedule `json:"monday"`
	Tuesday   DaySchedule `json:"tuesday"`
	Wednesday DaySchedule `json:"wednesday"`
	Thursday  DaySchedule `json:"thursday"`
	Friday    DaySchedule `json:"friday"`
	Saturday  DaySchedule `json:"saturday"`
	Sunday    DaySchedule `json:"sunday"`
	Timezone  string      `json:"timezone"`
}

type DaySchedule struct {
	Open  bool   `json:"open"`
	Start string `json:"start"`
	End   string `json:"end"`
}

// NewGoogleIntegrationHandler crea una nueva instancia del handler
func NewGoogleIntegrationHandler() (*GoogleIntegrationHandler, error) {
	// Intentar primero con variables específicas de integración
	clientID := os.Getenv("GOOGLE_INTEGRATION_CLIENT_ID")
	clientSecret := os.Getenv("GOOGLE_INTEGRATION_CLIENT_SECRET")
	redirectURL := os.Getenv("GOOGLE_INTEGRATION_REDIRECT_URL")

	// Fallback a variables genéricas si no existen las específicas
	if clientID == "" {
		clientID = os.Getenv("GOOGLE_CLIENT_ID")
	}
	if clientSecret == "" {
		clientSecret = os.Getenv("GOOGLE_CLIENT_SECRET")
	}
	if redirectURL == "" {
		redirectURL = os.Getenv("GOOGLE_REDIRECT_URL")
	}

	if clientID == "" || clientSecret == "" || redirectURL == "" {
		return nil, fmt.Errorf("faltan credenciales de Google OAuth (GOOGLE_INTEGRATION_CLIENT_ID, GOOGLE_INTEGRATION_CLIENT_SECRET, GOOGLE_INTEGRATION_REDIRECT_URL)")
	}

	log.Printf("✅ Google Integration configurado con redirect URL: %s", redirectURL)

	return &GoogleIntegrationHandler{
		calendarService: &googlesvc.GoogleCalendarService{
			ClientID:     clientID,
			ClientSecret: clientSecret,
			RedirectURL:  redirectURL,
		},
		sheetsService: &googlesvc.GoogleSheetsService{
			ClientID:     clientID,
			ClientSecret: clientSecret,
			RedirectURL:  redirectURL,
		},
	}, nil
}

// MakeSpreadsheetPublicEditor hace el Spreadsheet público con permisos de Editor
func (h *GoogleIntegrationHandler) MakeSpreadsheetPublicEditor(ctx context.Context, tokenJSON, spreadsheetID string) error {
	var token oauth2.Token
	if err := json.Unmarshal([]byte(tokenJSON), &token); err != nil {
		return fmt.Errorf("error parsing token: %w", err)
	}

	// Crear configuración OAuth con scope de Drive
	config := &oauth2.Config{
		ClientID:     h.sheetsService.ClientID,
		ClientSecret: h.sheetsService.ClientSecret,
		RedirectURL:  h.sheetsService.RedirectURL,
		Scopes: []string{
			"https://www.googleapis.com/auth/drive.file",
		},
		Endpoint: google.Endpoint,
	}

	client := config.Client(ctx, &token)

	// Crear servicio de Drive
	driveService, err := drive.NewService(ctx, option.WithHTTPClient(client))
	if err != nil {
		return fmt.Errorf("error creando servicio Drive: %w", err)
	}

	// Crear permiso público de EDITOR
	permission := &drive.Permission{
		Type: "anyone", // Cualquier persona con el link
		Role: "writer", // Permisos de EDITOR (writer = puede editar)
	}

	// Aplicar el permiso
	_, err = driveService.Permissions.Create(spreadsheetID, permission).Do()
	if err != nil {
		return fmt.Errorf("error creando permiso público: %w", err)
	}

	log.Printf("✅ [Spreadsheet %s] Ahora es público con permisos de Editor", spreadsheetID)
	return nil
}

// closeOAuthPopup responde con una página HTML mínima que:
//  1. Si esta ventana fue abierta como popup (window.opener existe), le avisa
//     al padre el resultado vía postMessage (incluyendo qué "service" se
//     conectó: calendar o sheets) y se cierra sola.
//  2. Si no fue abierta como popup, no puede cerrarse sola por seguridad del
//     navegador, así que manda a /my-agents como respaldo.
func closeOAuthPopup(c *gin.Context, success bool, service string, errorCode string, extra map[string]string) {
	payload := map[string]interface{}{
		"type":    "google-oauth-result",
		"success": success,
		"service": service,
	}
	if errorCode != "" {
		payload["error"] = errorCode
	}
	for k, v := range extra {
		payload[k] = v
	}
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		payloadJSON = []byte(`{"type":"google-oauth-result","success":false,"error":"internal_error"}`)
	}

	fallbackURL := "/my-agents"
	if success {
		fallbackURL += "?success=true"
	} else {
		fallbackURL += "?error=" + errorCode
	}
	for k, v := range extra {
		fallbackURL += fmt.Sprintf("&%s=%s", k, v)
	}

	message := "Conexión con Google completada. Esta ventana se cerrará automáticamente."
	if !success {
		message = "No se pudo completar la conexión con Google. Esta ventana se cerrará automáticamente."
	}

	html := fmt.Sprintf(`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Google OAuth</title>
</head>
<body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#4b5563;text-align:center;padding:1.5rem;">
<div>
	<p>%s</p>
	<p style="font-size:0.85rem;">Si no se cierra sola, <a href="%s" target="_top">haz clic aquí</a>.</p>
</div>
<script>
	(function () {
		var payload = %s;
		try {
			if (window.opener && !window.opener.closed) {
				window.opener.postMessage(payload, window.location.origin);
				window.close();
				return;
			}
		} catch (e) {
			// window.opener bloqueado por el navegador
		}
		window.top.location.href = %q;
	})();
</script>
</body>
</html>`, message, fallbackURL, string(payloadJSON), fallbackURL)

	c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(html))
}

// createGoogleResource crea el Calendar o el Sheet (según service) usando el
// token ya guardado en agent.GoogleToken, y actualiza los campos del agente
// EN MEMORIA (el caller es responsable de guardar en BD después).
func (h *GoogleIntegrationHandler) createGoogleResource(ctx context.Context, agent *models.Agent, service string) error {
	now := time.Now()
	switch service {
	case "calendar":
		calendarID, err := h.calendarService.CreateCalendar(ctx, agent.GoogleToken, agent.Name)
		if err != nil {
			return fmt.Errorf("error creando Calendar: %w", err)
		}
		agent.GoogleCalendarID = calendarID
		agent.GoogleCalendarConnected = true
		agent.GoogleCalendarConnectedAt = &now
		log.Printf("✅ [Agent %d] Calendar creado: %s", agent.ID, calendarID)

	case "sheets":
		spreadsheetID, err := h.sheetsService.CreateSpreadsheet(ctx, agent.GoogleToken, agent.Name, models.Schedule{
			Monday:    convertDaySchedule(agent.Config.Schedule.Monday),
			Tuesday:   convertDaySchedule(agent.Config.Schedule.Tuesday),
			Wednesday: convertDaySchedule(agent.Config.Schedule.Wednesday),
			Thursday:  convertDaySchedule(agent.Config.Schedule.Thursday),
			Friday:    convertDaySchedule(agent.Config.Schedule.Friday),
			Saturday:  convertDaySchedule(agent.Config.Schedule.Saturday),
			Sunday:    convertDaySchedule(agent.Config.Schedule.Sunday),
			Timezone:  agent.Config.Schedule.Timezone,
		})
		if err != nil {
			return fmt.Errorf("error creando Sheet: %w", err)
		}
		log.Printf("✅ [Agent %d] Sheet creado: %s", agent.ID, spreadsheetID)

		if err := h.MakeSpreadsheetPublicEditor(ctx, agent.GoogleToken, spreadsheetID); err != nil {
			log.Printf("⚠️  [Agent %d] No se pudo hacer público automáticamente: %v", agent.ID, err)
		} else {
			log.Printf("✅ [Agent %d] Spreadsheet ahora es público con permisos de Editor", agent.ID)
		}

		agent.GoogleSheetID = spreadsheetID
		agent.GoogleSheetsConnected = true
		agent.GoogleSheetsConnectedAt = &now

	default:
		return fmt.Errorf("service inválido: %s", service)
	}
	return nil
}

// syncAtomicBotGoogleEnv actualiza el .env de Google en el servidor y reinicia
// el bot (SOLO para AtomicBot). No-op para OrbitalBot/otros tipos.
func (h *GoogleIntegrationHandler) syncAtomicBotGoogleEnv(agent *models.Agent) {
	if !agent.IsAtomicBot() {
		return
	}
	log.Printf("🔄 [Agent %d] Actualizando .env de Google en el servidor AtomicBot...", agent.ID)

	serverManager := bots.GetGlobalServerManager()
	servers, err := serverManager.ListAllServers()
	if err != nil || len(servers) == 0 {
		log.Printf("⚠️  [Agent %d] No se encontró servidor compartido global", agent.ID)
		return
	}
	globalServer := servers[0]
	atomicService := bots.NewAtomicBotDeployService(globalServer.IPAddress, globalServer.RootPassword)

	if err := atomicService.Connect(); err != nil {
		log.Printf("⚠️  [Agent %d] Error conectando al servidor: %v", agent.ID, err)
		return
	}
	defer atomicService.Close()

	var googleCredentials []byte
	if agent.GoogleToken != "" {
		googleCredentials = []byte(agent.GoogleToken)
	}

	if err := atomicService.RestartBotAfterGoogleIntegration(agent, googleCredentials); err != nil {
		log.Printf("⚠️  [Agent %d] Error actualizando .env en servidor: %v", agent.ID, err)
	} else {
		log.Printf("✅ [Agent %d] .env actualizado y bot reiniciado en servidor", agent.ID)
	}
}

// InitiateGoogleIntegration inicia la conexión de UN servicio (Calendar o
// Sheets, ?service=calendar|sheets), de forma independiente del otro.
//
// Si el agente ya tiene un GoogleToken guardado (porque conectó el otro
// servicio antes), NO vuelve a pedirle permiso a Google: crea el recurso
// directo con el token existente y responde {"direct": true, ...} — el
// frontend detecta esto y no abre ningún popup.
func (h *GoogleIntegrationHandler) InitiateGoogleIntegration(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}

	user := userInterface.(*models.User)
	agentID := c.Query("agent_id")
	service := c.Query("service")

	if agentID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "agent_id es requerido"})
		return
	}
	if service != "calendar" && service != "sheets" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "service debe ser 'calendar' o 'sheets'"})
		return
	}

	// Verificar que el agente pertenece al usuario
	var agent models.Agent
	if err := config.DB.Where("id = ? AND user_id = ?", agentID, user.ID).First(&agent).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Agente no encontrado"})
		return
	}

	if (service == "calendar" && agent.GoogleCalendarConnected) ||
		(service == "sheets" && agent.GoogleSheetsConnected) {
		c.JSON(http.StatusOK, gin.H{"direct": true, "success": true, "already_connected": true})
		return
	}

	// Ya existe un token (se conectó el otro servicio antes) → crear directo,
	// sin volver a pedirle permiso al usuario.
	if agent.GoogleToken != "" {
		ctx := context.Background()
		if err := h.createGoogleResource(ctx, &agent, service); err != nil {
			log.Printf("❌ [Agent %d] Error creando %s con token existente: %v", agent.ID, service, err)
			c.JSON(http.StatusOK, gin.H{"direct": true, "success": false, "error": err.Error()})
			return
		}

		agent.SyncGoogleConnectedSummary()
		if err := config.DB.Save(&agent).Error; err != nil {
			log.Printf("❌ [Agent %d] Error guardando en BD: %v", agent.ID, err)
			c.JSON(http.StatusOK, gin.H{"direct": true, "success": false, "error": "save_failed"})
			return
		}
		h.syncAtomicBotGoogleEnv(&agent)

		c.JSON(http.StatusOK, gin.H{
			"direct":      true,
			"success":     true,
			"service":     service,
			"calendar_id": agent.GoogleCalendarID,
			"sheet_id":    agent.GoogleSheetID,
		})
		return
	}

	// No hay token todavía → consentimiento normal de Google. El scope pedido
	// cubre Calendar + Sheets de una sola vez (así, si luego conecta el otro
	// servicio, no vuelve a aparecer la pantalla de Google).
	state := fmt.Sprintf("%d:%d:%d:%s", user.ID, agent.ID, time.Now().Unix(), service)
	c.SetCookie("oauth_state", state, 600, "/", "", false, true) // 10 minutos

	authURL := h.calendarService.GetAuthURL(state)

	c.JSON(http.StatusOK, gin.H{
		"auth_url": authURL,
	})
}

// HandleGoogleCallback maneja el callback de OAuth2. Crea SOLO el recurso
// correspondiente al "service" codificado en el state, y responde cerrando el
// popup (ver closeOAuthPopup) en vez de redirigir a /my-agents.
func (h *GoogleIntegrationHandler) HandleGoogleCallback(c *gin.Context) {
	code := c.Query("code")
	state := c.Query("state")

	if code == "" || state == "" {
		closeOAuthPopup(c, false, "", "invalid_request", nil)
		return
	}

	// Verificar state (CSRF protection)
	savedState, err := c.Cookie("oauth_state")
	if err != nil || state != savedState {
		log.Printf("❌ Error de validación de state: state=%s, savedState=%s", state, savedState)
		closeOAuthPopup(c, false, "", "invalid_state", nil)
		return
	}
	c.SetCookie("oauth_state", "", -1, "/", "", false, true)

	// state = "userID:agentID:timestamp:service"
	parts := strings.Split(state, ":")
	if len(parts) != 4 {
		log.Printf("❌ State con formato inesperado: %s", state)
		closeOAuthPopup(c, false, "", "invalid_state", nil)
		return
	}
	var userID, agentID int64
	fmt.Sscanf(parts[0], "%d", &userID)
	fmt.Sscanf(parts[1], "%d", &agentID)
	service := parts[3]
	if service != "calendar" && service != "sheets" {
		closeOAuthPopup(c, false, "", "invalid_service", nil)
		return
	}

	// Obtener agente
	var agent models.Agent
	if err := config.DB.Where("id = ? AND user_id = ?", agentID, userID).First(&agent).Error; err != nil {
		log.Printf("❌ Error obteniendo agente: %v", err)
		closeOAuthPopup(c, false, service, "agent_not_found", nil)
		return
	}

	// Intercambiar código por tokens
	ctx := context.Background()
	token, err := h.calendarService.ExchangeCode(ctx, code)
	if err != nil {
		log.Printf("❌ Error intercambiando código: %v", err)
		closeOAuthPopup(c, false, service, "token_exchange_failed", nil)
		return
	}

	tokenJSON, err := json.Marshal(token)
	if err != nil {
		log.Printf("❌ Error serializando token: %v", err)
		closeOAuthPopup(c, false, service, "token_error", nil)
		return
	}
	agent.GoogleToken = string(tokenJSON)
	log.Printf("✅ [Agent %d] Token de Google obtenido (service=%s)", agent.ID, service)

	// Crear SOLO el recurso pedido
	if err := h.createGoogleResource(ctx, &agent, service); err != nil {
		log.Printf("❌ [Agent %d] %v", agent.ID, err)
		closeOAuthPopup(c, false, service, service+"_creation_failed", nil)
		return
	}

	agent.SyncGoogleConnectedSummary()
	if err := config.DB.Save(&agent).Error; err != nil {
		log.Printf("❌ [Agent %d] Error guardando en BD: %v", agent.ID, err)
		closeOAuthPopup(c, false, service, "save_failed", nil)
		return
	}

	log.Printf("🎉 [Agent %d] %s conectado exitosamente", agent.ID, service)
	h.syncAtomicBotGoogleEnv(&agent)

	closeOAuthPopup(c, true, service, "", map[string]string{
		"agent_id":    fmt.Sprintf("%d", agent.ID),
		"calendar_id": agent.GoogleCalendarID,
		"sheet_id":    agent.GoogleSheetID,
	})
}

// DisconnectGoogle desconecta Calendar y/o Sheets de forma independiente.
// Body JSON: {"service": "calendar"} o {"service": "sheets"}. Sin body (o
// "service" vacío) desconecta ambos — comportamiento legacy, por si algo
// más en el sistema todavía llama este endpoint sin especificar servicio.
func (h *GoogleIntegrationHandler) DisconnectGoogle(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}

	user := userInterface.(*models.User)
	agentID := c.Param("agent_id")
	if agentID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "agent_id es requerido"})
		return
	}

	var body struct {
		Service string `json:"service"`
	}
	_ = c.ShouldBindJSON(&body) // body opcional

	var agent models.Agent
	if err := config.DB.Where("id = ? AND user_id = ?", agentID, user.ID).First(&agent).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Agente no encontrado"})
		return
	}

	if body.Service == "calendar" || body.Service == "" {
		agent.GoogleCalendarID = ""
		agent.GoogleCalendarConnected = false
		agent.GoogleCalendarConnectedAt = nil
	}
	if body.Service == "sheets" || body.Service == "" {
		agent.GoogleSheetID = ""
		agent.GoogleSheetsConnected = false
		agent.GoogleSheetsConnectedAt = nil
	}

	// Si ya no queda ningún servicio conectado, el token no sirve de nada más.
	if !agent.GoogleCalendarConnected && !agent.GoogleSheetsConnected {
		agent.GoogleToken = ""
	}
	agent.SyncGoogleConnectedSummary()

	if err := config.DB.Save(&agent).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error desconectando"})
		return
	}

	log.Printf("✅ [Agent %d] Google desconectado (service=%q)", agent.ID, body.Service)
	h.syncAtomicBotGoogleEnv(&agent)

	c.JSON(http.StatusOK, gin.H{"success": true, "service": body.Service})
}

// GetIntegrationStatus obtiene el estado de Calendar y Sheets por separado
// (además de un resumen combinado legacy).
func (h *GoogleIntegrationHandler) GetIntegrationStatus(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}

	user := userInterface.(*models.User)
	agentID := c.Param("agent_id")
	if agentID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "agent_id es requerido"})
		return
	}

	var agent models.Agent
	if err := config.DB.Where("id = ? AND user_id = ?", agentID, user.ID).First(&agent).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Agente no encontrado"})
		return
	}

	response := gin.H{
		// Legacy combinado — se mantiene por compatibilidad con código viejo
		"connected":    agent.GoogleConnected,
		"connected_at": agent.GoogleConnectedAt,
		"calendar_id":  agent.GoogleCalendarID,
		"sheet_id":     agent.GoogleSheetID,

		// Estado independiente por servicio
		"calendar_connected":    agent.GoogleCalendarConnected,
		"calendar_connected_at": agent.GoogleCalendarConnectedAt,
		"sheets_connected":      agent.GoogleSheetsConnected,
		"sheets_connected_at":   agent.GoogleSheetsConnectedAt,
	}

	if agent.GoogleCalendarConnected && agent.GoogleCalendarID != "" {
		response["calendar_url"] = fmt.Sprintf("https://calendar.google.com/calendar/u/0/r?cid=%s", agent.GoogleCalendarID)
	}
	if agent.GoogleSheetsConnected && agent.GoogleSheetID != "" {
		response["sheet_url"] = fmt.Sprintf("https://docs.google.com/spreadsheets/d/%s/edit", agent.GoogleSheetID)
	}

	c.JSON(http.StatusOK, response)
}

// CreateAppointment crea una cita en Calendar y Sheets
func (h *GoogleIntegrationHandler) CreateAppointment(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}

	user := userInterface.(*models.User)

	var req struct {
		AgentID     uint      `json:"agent_id" binding:"required"`
		Title       string    `json:"title" binding:"required"`
		Description string    `json:"description"`
		StartTime   time.Time `json:"start_time" binding:"required"`
		EndTime     time.Time `json:"end_time" binding:"required"`
		ClientName  string    `json:"client_name" binding:"required"`
		ClientEmail string    `json:"client_email"`
		ClientPhone string    `json:"client_phone" binding:"required"`
		WorkerName  string    `json:"worker_name"` // Nuevo: nombre del trabajador/barbero
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos inválidos", "details": err.Error()})
		return
	}

	// Obtener agente con al menos un servicio de Google conectado
	var agent models.Agent
	if err := config.DB.Where(
		"id = ? AND user_id = ? AND (google_calendar_connected = ? OR google_sheets_connected = ?)",
		req.AgentID, user.ID, true, true,
	).First(&agent).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Agente no encontrado o sin Calendar/Sheets conectado"})
		return
	}

	ctx := context.Background()
	var eventID string

	// Crear evento en Calendar SOLO si está conectado
	if agent.GoogleCalendarConnected && agent.GoogleCalendarID != "" {
		eventData := googlesvc.EventData{
			Title:       req.Title,
			Description: req.Description,
			StartTime:   req.StartTime,
			EndTime:     req.EndTime,
			ClientEmail: req.ClientEmail,
			ClientPhone: req.ClientPhone,
		}

		var err error
		eventID, err = h.calendarService.CreateEvent(ctx, agent.GoogleToken, agent.GoogleCalendarID, eventData)
		if err != nil {
			log.Printf("❌ Error creando evento en Calendar: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Error creando evento en Calendar"})
			return
		}
		log.Printf("✅ [Agent %d] Evento creado en Calendar: %s", agent.ID, eventID)
	}

	// Agregar a Sheets SOLO si está conectado
	if agent.GoogleSheetsConnected && agent.GoogleSheetID != "" {
		appointmentData := googlesvc.AppointmentData{
			EventID:     eventID,
			Date:        req.StartTime.Format("2006-01-02"),
			StartTime:   req.StartTime.Format("15:04"),
			EndTime:     req.EndTime.Format("15:04"),
			ClientName:  req.ClientName,
			ClientEmail: req.ClientEmail,
			ClientPhone: req.ClientPhone,
			Description: req.Description,
			Status:      "Confirmada",
			WorkerName:  req.WorkerName, // Incluir el nombre del trabajador
		}

		if err := h.sheetsService.AddAppointment(ctx, agent.GoogleToken, agent.GoogleSheetID, appointmentData); err != nil {
			// Si falla Sheets y sí se había creado el evento, deshacer el evento
			if eventID != "" {
				h.calendarService.DeleteEvent(ctx, agent.GoogleToken, agent.GoogleCalendarID, eventID)
			}
			log.Printf("❌ Error agregando a Sheet: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Error agregando a la hoja de cálculo"})
			return
		}
		log.Printf("✅ [Agent %d] Cita agregada al calendario en Sheet", agent.ID)
	}

	c.JSON(http.StatusOK, gin.H{
		"success":  true,
		"event_id": eventID,
		"message":  "Cita creada exitosamente",
	})
}

// convertDaySchedule convierte un DaySchedule del modelo a un DaySchedule de services
func convertDaySchedule(day models.DaySchedule) models.DaySchedule {
	return models.DaySchedule{
		Open:  day.Open,
		Start: day.Start,
		End:   day.End,
	}
}
