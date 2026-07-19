package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"attomos/config"
	"attomos/models"
	"attomos/services"

	"github.com/gin-gonic/gin"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	"google.golang.org/api/drive/v3"
	"google.golang.org/api/option"
)

type GoogleIntegrationHandler struct {
	calendarService *services.GoogleCalendarService
	sheetsService   *services.GoogleSheetsService
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
		calendarService: &services.GoogleCalendarService{
			ClientID:     clientID,
			ClientSecret: clientSecret,
			RedirectURL:  redirectURL,
		},
		sheetsService: &services.GoogleSheetsService{
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
//     al padre el resultado vía postMessage y se cierra sola.
//  2. Si no fue abierta como popup (ej. el usuario abrió el link directo en
//     una pestaña normal), no puede cerrarse sola por seguridad del navegador,
//     así que muestra un mensaje y un link de vuelta a /my-agents.
//
// extra son pares clave/valor adicionales a incluir en el mensaje postMessage
// (por ejemplo agent_id, calendar_id, sheet_id) y en el link de fallback.
func closeOAuthPopup(c *gin.Context, success bool, errorCode string, extra map[string]string) {
	payload := map[string]interface{}{
		"type":    "google-oauth-result",
		"success": success,
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

	// Link de respaldo por si el navegador no deja cerrar la ventana (por
	// ejemplo si no fue abierta vía window.open, sino navegación directa).
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
			// window.opener bloqueado por el navegador (ventanas de distinto origen, etc.)
		}
		// No es un popup con opener válido: no podemos cerrarla sola,
		// mandamos a la página de agentes como respaldo.
		window.top.location.href = %q;
	})();
</script>
</body>
</html>`, message, fallbackURL, string(payloadJSON), fallbackURL)

	c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(html))
}

// InitiateGoogleIntegration inicia el flujo OAuth2 para Calendar y Sheets
func (h *GoogleIntegrationHandler) InitiateGoogleIntegration(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}

	user := userInterface.(*models.User)
	agentID := c.Query("agent_id")

	if agentID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "agent_id es requerido"})
		return
	}

	// Verificar que el agente pertenece al usuario
	var agent models.Agent
	if err := config.DB.Where("id = ? AND user_id = ?", agentID, user.ID).First(&agent).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Agente no encontrado"})
		return
	}

	// Generar state token con agent_id incluido
	state := fmt.Sprintf("%d:%d:%d", user.ID, agent.ID, time.Now().Unix())

	// Guardar state en sesión (cookie temporal)
	c.SetCookie("oauth_state", state, 600, "/", "", false, true) // 10 minutos

	// Obtener URL de autorización con ambos scopes
	authURL := h.calendarService.GetAuthURL(state)

	c.JSON(http.StatusOK, gin.H{
		"auth_url": authURL,
	})
}

// HandleGoogleCallback maneja el callback de OAuth2 y crea automáticamente Calendar y Sheet
func (h *GoogleIntegrationHandler) HandleGoogleCallback(c *gin.Context) {
	code := c.Query("code")
	state := c.Query("state")

	if code == "" || state == "" {
		closeOAuthPopup(c, false, "invalid_request", nil)
		return
	}

	// Verificar state token
	savedState, err := c.Cookie("oauth_state")
	if err != nil || state != savedState {
		log.Printf("❌ Error de validación de state: state=%s, savedState=%s", state, savedState)
		closeOAuthPopup(c, false, "invalid_state", nil)
		return
	}

	// Limpiar cookie de state
	c.SetCookie("oauth_state", "", -1, "/", "", false, true)

	// Extraer user_id y agent_id del state
	var userID, agentID int64
	fmt.Sscanf(state, "%d:%d:", &userID, &agentID)

	// Obtener agente
	var agent models.Agent
	if err := config.DB.Where("id = ? AND user_id = ?", agentID, userID).First(&agent).Error; err != nil {
		log.Printf("❌ Error obteniendo agente: %v", err)
		closeOAuthPopup(c, false, "agent_not_found", nil)
		return
	}

	// Obtener usuario para acceder a servidor
	var user models.User
	if err := config.DB.Where("id = ?", userID).First(&user).Error; err != nil {
		log.Printf("❌ Error obteniendo usuario: %v", err)
		closeOAuthPopup(c, false, "user_not_found", nil)
		return
	}

	// Intercambiar código por tokens
	ctx := context.Background()
	token, err := h.calendarService.ExchangeCode(ctx, code)
	if err != nil {
		log.Printf("❌ Error intercambiando código: %v", err)
		closeOAuthPopup(c, false, "token_exchange_failed", nil)
		return
	}

	tokenJSON, err := json.Marshal(token)
	if err != nil {
		log.Printf("❌ Error serializando token: %v", err)
		closeOAuthPopup(c, false, "token_error", nil)
		return
	}

	log.Printf("✅ [Agent %d] Token obtenido exitosamente", agent.ID)

	// Obtener email del usuario de Google
	userEmail, err := h.calendarService.GetUserEmail(ctx, string(tokenJSON))
	if err != nil {
		log.Printf("❌ [Agent %d] Error obteniendo email de Google: %v", agent.ID, err)
		closeOAuthPopup(c, false, "get_email_failed", nil)
		return
	}
	log.Printf("✅ [Agent %d] Email de Google obtenido: %s", agent.ID, userEmail)

	// PASO 1: Crear Calendar automáticamente
	log.Printf("📅 [Agent %d] Creando Google Calendar...", agent.ID)
	calendarID, err := h.calendarService.CreateCalendar(ctx, string(tokenJSON), agent.Name)
	if err != nil {
		log.Printf("❌ [Agent %d] Error creando Calendar: %v", agent.ID, err)
		closeOAuthPopup(c, false, "calendar_creation_failed", nil)
		return
	}
	log.Printf("✅ [Agent %d] Calendar creado: %s", agent.ID, calendarID)

	// PASO 2: Crear Spreadsheet automáticamente con formato de calendario semanal
	log.Printf("📊 [Agent %d] Creando Google Sheet con formato de calendario...", agent.ID)
	spreadsheetID, err := h.sheetsService.CreateSpreadsheet(ctx, string(tokenJSON), agent.Name, services.Schedule{
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
		log.Printf("❌ [Agent %d] Error creando Sheet: %v", agent.ID, err)
		closeOAuthPopup(c, false, "sheet_creation_failed", nil)
		return
	}
	log.Printf("✅ [Agent %d] Sheet creado con formato de calendario: %s", agent.ID, spreadsheetID)

	// ✨ NUEVO: Hacer el Spreadsheet público automáticamente
	log.Printf("🔓 [Agent %d] Haciendo Spreadsheet público con permisos de Editor...", agent.ID)
	if err := h.MakeSpreadsheetPublicEditor(ctx, string(tokenJSON), spreadsheetID); err != nil {
		log.Printf("⚠️  [Agent %d] No se pudo hacer público automáticamente: %v", agent.ID, err)
		log.Printf("💡 [Agent %d] El usuario tendrá que compartir manualmente", agent.ID)
		// NO RETORNAR - continuar con el flujo
	} else {
		log.Printf("✅ [Agent %d] Spreadsheet ahora es público con permisos de Editor", agent.ID)
	}

	// PASO 3: Guardar todo en la base de datos
	now := time.Now()
	agent.GoogleToken = string(tokenJSON)
	agent.GoogleCalendarID = calendarID
	agent.GoogleSheetID = spreadsheetID
	agent.GoogleConnected = true
	agent.GoogleConnectedAt = &now

	if err := config.DB.Save(&agent).Error; err != nil {
		log.Printf("❌ [Agent %d] Error guardando en BD: %v", agent.ID, err)
		closeOAuthPopup(c, false, "save_failed", nil)
		return
	}

	log.Printf("🎉 [Agent %d] Integración completada exitosamente", agent.ID)
	log.Printf("📧 [Agent %d] Email de Google Calendar: %s", agent.ID, userEmail)
	log.Printf("📊 [Agent %d] Spreadsheet ID: %s", agent.ID, spreadsheetID)
	log.Printf("📅 [Agent %d] Calendar ID: %s", agent.ID, calendarID)

	// PASO 4: Actualizar .env del bot en el servidor (SOLO para AtomicBot)
	if agent.IsAtomicBot() {
		log.Printf("🔄 [Agent %d] Actualizando .env en el servidor AtomicBot...", agent.ID)

		// Obtener servidor compartido global
		serverManager := services.GetGlobalServerManager()
		servers, err := serverManager.ListAllServers()
		if err != nil || len(servers) == 0 {
			log.Printf("⚠️  [Agent %d] No se encontró servidor compartido global", agent.ID)
		} else {
			globalServer := servers[0]
			atomicService := services.NewAtomicBotDeployService(globalServer.IPAddress, globalServer.RootPassword)

			// Conectar al servidor
			if err := atomicService.Connect(); err != nil {
				log.Printf("⚠️  [Agent %d] Error conectando al servidor: %v", agent.ID, err)
			} else {
				defer atomicService.Close()

				// Leer google.json del token
				googleCredentials := []byte(tokenJSON)

				// Actualizar variables de entorno y reiniciar bot
				if err := atomicService.RestartBotAfterGoogleIntegration(&agent, googleCredentials); err != nil {
					log.Printf("⚠️  [Agent %d] Error actualizando .env en servidor: %v", agent.ID, err)
				} else {
					log.Printf("✅ [Agent %d] .env actualizado y bot reiniciado en servidor", agent.ID)
				}
			}
		}
	}

	// Éxito: cerrar el popup y avisarle a la pestaña original (integrations.js
	// ya hace polling de popup.closed, así que basta con cerrar; el postMessage
	// es un bonus para quien quiera reaccionar más rápido sin esperar el poll).
	closeOAuthPopup(c, true, "", map[string]string{
		"agent_id":    fmt.Sprintf("%d", agent.ID),
		"calendar_id": calendarID,
		"sheet_id":    spreadsheetID,
	})
}

// DisconnectGoogle desconecta la integración de Google
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

	// Verificar que el agente pertenece al usuario
	var agent models.Agent
	if err := config.DB.Where("id = ? AND user_id = ?", agentID, user.ID).First(&agent).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Agente no encontrado"})
		return
	}

	// Limpiar campos de Google
	agent.GoogleToken = ""
	agent.GoogleCalendarID = ""
	agent.GoogleSheetID = ""
	agent.GoogleConnected = false
	agent.GoogleConnectedAt = nil

	if err := config.DB.Save(&agent).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error desconectando"})
		return
	}

	log.Printf("✅ [Agent %d] Google desconectado", agent.ID)

	// Actualizar .env del bot en el servidor (SOLO para AtomicBot)
	if agent.IsAtomicBot() {
		log.Printf("🔄 [Agent %d] Limpiando variables de Google del .env en el servidor...", agent.ID)

		serverManager := services.GetGlobalServerManager()
		servers, err := serverManager.ListAllServers()
		if err == nil && len(servers) > 0 {
			globalServer := servers[0]
			atomicService := services.NewAtomicBotDeployService(globalServer.IPAddress, globalServer.RootPassword)

			if err := atomicService.Connect(); err != nil {
				log.Printf("⚠️  [Agent %d] Error conectando al servidor: %v", agent.ID, err)
			} else {
				defer atomicService.Close()

				if err := atomicService.RestartBotAfterGoogleIntegration(&agent, nil); err != nil {
					log.Printf("⚠️  [Agent %d] Error limpiando .env: %v", agent.ID, err)
				} else {
					log.Printf("✅ [Agent %d] Variables de Google limpiadas del .env", agent.ID)
				}
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

// GetIntegrationStatus obtiene el estado de la integración
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
		"connected":    agent.GoogleConnected,
		"calendar_id":  agent.GoogleCalendarID,
		"sheet_id":     agent.GoogleSheetID,
		"connected_at": agent.GoogleConnectedAt,
	}

	// Si está conectado, agregar URLs públicas
	if agent.GoogleConnected {
		if agent.GoogleCalendarID != "" {
			response["calendar_url"] = fmt.Sprintf("https://calendar.google.com/calendar/u/0/r?cid=%s", agent.GoogleCalendarID)
		}
		if agent.GoogleSheetID != "" {
			response["sheet_url"] = fmt.Sprintf("https://docs.google.com/spreadsheets/d/%s/edit", agent.GoogleSheetID)
		}
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

	// Obtener agente con integración
	var agent models.Agent
	if err := config.DB.Where("id = ? AND user_id = ? AND google_connected = ?", req.AgentID, user.ID, true).First(&agent).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Agente no encontrado o no conectado a Google"})
		return
	}

	ctx := context.Background()

	// Crear evento en Calendar
	eventData := services.EventData{
		Title:       req.Title,
		Description: req.Description,
		StartTime:   req.StartTime,
		EndTime:     req.EndTime,
		ClientEmail: req.ClientEmail,
		ClientPhone: req.ClientPhone,
	}

	eventID, err := h.calendarService.CreateEvent(ctx, agent.GoogleToken, agent.GoogleCalendarID, eventData)
	if err != nil {
		log.Printf("❌ Error creando evento en Calendar: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error creando evento en Calendar"})
		return
	}

	log.Printf("✅ [Agent %d] Evento creado en Calendar: %s", agent.ID, eventID)

	// Agregar a Sheets con formato de calendario
	appointmentData := services.AppointmentData{
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

	err = h.sheetsService.AddAppointment(ctx, agent.GoogleToken, agent.GoogleSheetID, appointmentData)
	if err != nil {
		// Si falla Sheets, intentar eliminar el evento de Calendar
		h.calendarService.DeleteEvent(ctx, agent.GoogleToken, agent.GoogleCalendarID, eventID)
		log.Printf("❌ Error agregando a Sheet: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error agregando a la hoja de cálculo"})
		return
	}

	log.Printf("✅ [Agent %d] Cita agregada al calendario en Sheet", agent.ID)

	c.JSON(http.StatusOK, gin.H{
		"success":  true,
		"event_id": eventID,
		"message":  "Cita creada exitosamente en Calendar y Sheet",
	})
}

// convertDaySchedule convierte un DaySchedule del modelo a un DaySchedule de services
func convertDaySchedule(day models.DaySchedule) services.DaySchedule {
	return services.DaySchedule{
		Open:  day.Open,
		Start: day.Start,
		End:   day.End,
	}
}