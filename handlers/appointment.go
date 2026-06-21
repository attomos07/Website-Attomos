package handlers

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"attomos/config"
	"attomos/models"
	"attomos/services"

	"github.com/gin-gonic/gin"
)

// AppointmentResponse representa una cita para el frontend
type AppointmentResponse struct {
	ID        string `json:"id"`
	Client    string `json:"client"`
	Phone     string `json:"phone"`
	Service   string `json:"service"`
	Worker    string `json:"worker"`
	Date      string `json:"date"`      // Formato: YYYY-MM-DD
	Time      string `json:"time"`      // Formato: HH:MM
	Status    string `json:"status"`    // confirmed, pending, cancelled, completed
	AgentID   uint   `json:"agentId"`   // ID del agente
	AgentName string `json:"agentName"` // Nombre del agente
	Duration  int    `json:"duration"`  // Duración en minutos (default 60)
	Notes     string `json:"notes"`     // Notas adicionales
	SheetCell string `json:"sheetCell"` // Celda en el sheet (ej: "B5")
	SheetURL  string `json:"sheetUrl"`  // URL del sheet
	Source    string `json:"source"`    // "manual", "sheets", "agent"
}

// GetAppointments obtiene todas las citas del usuario:
// 1. Lee citas desde Google Sheets de cada agente conectado
// 2. Sincroniza/guarda en la BD las nuevas (evitando duplicados)
// 3. Devuelve las citas de la BD (fuente de verdad unificada)
func GetAppointments(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}

	user := userInterface.(*models.User)

	// ============================================
	// PASO 1: Sincronizar citas desde Google Sheets
	// ============================================
	var agents []models.Agent
	if err := config.DB.Where("user_id = ? AND google_connected = ?", user.ID, true).Find(&agents).Error; err != nil {
		log.Printf("❌ [User %d] Error obteniendo agentes: %v", user.ID, err)
	}

	if len(agents) > 0 {
		sheetsService := &services.GoogleSheetsService{
			ClientID:     getGoogleClientID(),
			ClientSecret: getGoogleClientSecret(),
			RedirectURL:  getGoogleRedirectURL(),
		}
		ctx := context.Background()
		syncAppointmentsFromSheets(ctx, sheetsService, agents, user.ID)
	}

	// ============================================
	// PASO 2: Leer todas las citas del usuario desde BD
	// ============================================
	var appointments []models.Appointment
	if err := config.DB.
		Where("user_id = ?", user.ID).
		Order("date ASC").
		Find(&appointments).Error; err != nil {
		log.Printf("❌ [User %d] Error leyendo citas de BD: %v", user.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error obteniendo citas"})
		return
	}

	// ============================================
	// PASO 3: Construir mapa de agentID → agentName
	// ============================================
	agentNames := map[uint]string{}
	for _, a := range agents {
		agentNames[a.ID] = a.Name
	}
	// Completar con agentes sin Google (para citas manuales)
	var allAgents []models.Agent
	config.DB.Where("user_id = ?", user.ID).Select("id, name").Find(&allAgents)
	for _, a := range allAgents {
		if _, ok := agentNames[a.ID]; !ok {
			agentNames[a.ID] = a.Name
		}
	}

	// ============================================
	// PASO 4: Convertir a AppointmentResponse
	// ============================================
	response := make([]AppointmentResponse, 0, len(appointments))
	for _, appt := range appointments {
		agentName := agentNames[appt.AgentID]

		sheetURL := ""
		if appt.SheetID != "" {
			sheetURL = fmt.Sprintf("https://docs.google.com/spreadsheets/d/%s/edit", appt.SheetID)
		}

		response = append(response, AppointmentResponse{
			ID:        fmt.Sprintf("%d", appt.ID),
			Client:    appt.GetClientFullName(),
			Phone:     appt.ClientPhone,
			Service:   appt.Service,
			Worker:    appt.Worker,
			Date:      appt.Date.Format("2006-01-02"),
			Time:      appt.Date.Format("15:04"),
			Status:    string(appt.Status),
			AgentID:   appt.AgentID,
			AgentName: agentName,
			Duration:  60,
			Notes:     appt.Notes,
			SheetCell: appt.SheetRowID,
			SheetURL:  sheetURL,
			Source:    string(appt.Source),
		})
	}

	log.Printf("✅ [User %d] Total de citas devueltas: %d", user.ID, len(response))

	c.JSON(http.StatusOK, gin.H{
		"appointments": response,
		"total":        len(response),
	})
}

// CreateManualAppointment crea una cita manual desde el panel y la guarda en BD
func CreateManualAppointment(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}

	user := userInterface.(*models.User)

	var req struct {
		AgentID         uint   `json:"agentId"`
		ClientFirstName string `json:"clientFirstName" binding:"required"`
		ClientLastName  string `json:"clientLastName" binding:"required"`
		ClientPhone     string `json:"clientPhone"`
		Service         string `json:"service"`
		Worker          string `json:"worker"`
		Date            string `json:"date" binding:"required"` // YYYY-MM-DD
		Time            string `json:"time" binding:"required"` // HH:MM
		Notes           string `json:"notes"`
		Status          string `json:"status"` // Si vacío → "pending"
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos inválidos", "details": err.Error()})
		return
	}

	// Combinar fecha + hora
	dateTimeStr := fmt.Sprintf("%s %s:00", req.Date, req.Time)
	parsedDate, err := time.ParseInLocation("2006-01-02 15:04:05", dateTimeStr, time.Local)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Formato de fecha/hora inválido. Use YYYY-MM-DD y HH:MM"})
		return
	}

	status := models.AppointmentStatusPending
	if req.Status != "" {
		status = models.AppointmentStatus(req.Status)
	}

	appointment := models.Appointment{
		UserID:          user.ID,
		AgentID:         req.AgentID,
		ClientFirstName: req.ClientFirstName,
		ClientLastName:  req.ClientLastName,
		ClientPhone:     req.ClientPhone,
		Service:         req.Service,
		Worker:          req.Worker,
		Date:            parsedDate,
		Notes:           req.Notes,
		Status:          status,
		Source:          models.AppointmentSourceManual,
	}

	if err := config.DB.Create(&appointment).Error; err != nil {
		log.Printf("❌ [User %d] Error creando cita manual: %v", user.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error guardando la cita"})
		return
	}

	log.Printf("✅ [User %d] Cita manual creada con ID: %d", user.ID, appointment.ID)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"id":      appointment.ID,
		"message": "Cita creada exitosamente",
	})
}

// UpdateAppointmentStatus actualiza el estado de una cita
func UpdateAppointmentStatus(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}

	user := userInterface.(*models.User)
	appointmentID := c.Param("id")

	var req struct {
		Status string `json:"status" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Estado inválido"})
		return
	}

	result := config.DB.Model(&models.Appointment{}).
		Where("id = ? AND user_id = ?", appointmentID, user.ID).
		Update("status", req.Status)

	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error actualizando estado"})
		return
	}

	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Cita no encontrada"})
		return
	}

	log.Printf("✅ [User %d] Cita %s actualizada a estado: %s", user.ID, appointmentID, req.Status)
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// DeleteAppointment elimina una cita (soft delete)
func DeleteAppointment(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}

	user := userInterface.(*models.User)
	appointmentID := c.Param("id")

	result := config.DB.Where("id = ? AND user_id = ?", appointmentID, user.ID).
		Delete(&models.Appointment{})

	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error eliminando cita"})
		return
	}

	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Cita no encontrada"})
		return
	}

	log.Printf("✅ [User %d] Cita %s eliminada", user.ID, appointmentID)
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// ============================================
// ENDPOINT PARA EL BOT (autenticado con BOT_API_TOKEN)
// ============================================

// CreateBotAppointment — POST /api/bot/appointments
// Llamado por AtomicBot/OrbitalBot al confirmar una cita.
// Autenticado con BOT_API_TOKEN (Bearer token interno).
func CreateBotAppointment(c *gin.Context) {
	auth := c.GetHeader("Authorization")
	botToken := config.GetEnv("BOT_API_TOKEN")
	if botToken == "" || auth != "Bearer "+botToken {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autorizado"})
		return
	}

	var req struct {
		AgentID    uint   `json:"agentId"`
		UserID     uint   `json:"userId"`
		ClientName string `json:"clientName"`
		Phone      string `json:"phone"`
		Service    string `json:"service"`
		Worker     string `json:"worker"`
		Date       string `json:"date"` // YYYY-MM-DD
		Time       string `json:"time"` // HH:MM
		Notes      string `json:"notes"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos inválidos: " + err.Error()})
		return
	}

	if req.ClientName == "" || req.Date == "" || req.Time == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "clientName, date y time son requeridos"})
		return
	}

	// Obtener userID desde el agente si no viene en el body
	if req.UserID == 0 && req.AgentID > 0 {
		var agent models.Agent
		if err := config.DB.First(&agent, req.AgentID).Error; err == nil {
			req.UserID = agent.UserID
		}
	}

	if req.UserID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No se pudo determinar el usuario"})
		return
	}

	dateTimeStr := fmt.Sprintf("%s %s:00", req.Date, req.Time)
	parsedDate, err := time.ParseInLocation("2006-01-02 15:04:05", dateTimeStr, time.Local)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Formato de fecha/hora inválido"})
		return
	}

	firstName, lastName := splitClientName(req.ClientName)

	appointment := models.Appointment{
		UserID:          req.UserID,
		AgentID:         req.AgentID,
		ClientFirstName: firstName,
		ClientLastName:  lastName,
		ClientPhone:     req.Phone,
		Service:         req.Service,
		Worker:          req.Worker,
		Date:            parsedDate,
		Notes:           req.Notes,
		Status:          models.AppointmentStatusConfirmed,
		Source:          models.AppointmentSourceAgent,
	}

	if err := config.DB.Create(&appointment).Error; err != nil {
		log.Printf("❌ [BotAppointment] Error guardando cita: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error guardando la cita"})
		return
	}

	log.Printf("✅ [BotAppointment] Cita creada ID=%d | %s | %s | %s %s",
		appointment.ID, req.ClientName, req.Service, req.Date, req.Time)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"id":      appointment.ID,
		"message": "Cita guardada correctamente",
	})
}

// ============================================
// SINCRONIZACIÓN INTERNA (Sheets → BD)
// ============================================

// syncAppointmentsFromSheets lee los Sheets de cada agente y guarda citas nuevas en BD
func syncAppointmentsFromSheets(ctx context.Context, sheetsService *services.GoogleSheetsService, agents []models.Agent, userID uint) {
	for _, agent := range agents {
		if agent.GoogleSheetID == "" {
			continue
		}

		rawAppointments, err := readAppointmentsFromSheet(ctx, sheetsService, agent.GoogleToken, agent.GoogleSheetID, agent.ID, agent.Name)
		if err != nil {
			log.Printf("⚠️  [Agent %d] Error leyendo Sheet: %v", agent.ID, err)
			continue
		}

		saved := 0
		for _, raw := range rawAppointments {
			// Evitar duplicados: SheetRowID único por agente
			sheetRowID := fmt.Sprintf("agent_%d_%s", agent.ID, raw.SheetCell)

			var existing models.Appointment
			err := config.DB.Where("sheet_row_id = ? AND agent_id = ?", sheetRowID, agent.ID).
				First(&existing).Error

			if err == nil {
				// Ya existe → actualizar estado si cambió en Sheets
				if string(existing.Status) != raw.Status {
					config.DB.Model(&existing).Update("status", raw.Status)
					log.Printf("🔄 [Agent %d] Cita %s actualizada a estado: %s", agent.ID, sheetRowID, raw.Status)
				}
				continue
			}

			// Parsear fecha + hora
			dateTimeStr := fmt.Sprintf("%s %s:00", raw.Date, raw.Time)
			parsedDate, err := time.ParseInLocation("2006-01-02 15:04:05", dateTimeStr, time.Local)
			if err != nil {
				log.Printf("⚠️  [Agent %d] Fecha inválida en celda %s: %v", agent.ID, raw.SheetCell, err)
				continue
			}

			// Separar nombre completo en nombre + apellido
			firstName, lastName := splitClientName(raw.Client)

			now := time.Now()
			appt := models.Appointment{
				UserID:          userID,
				AgentID:         agent.ID,
				ClientFirstName: firstName,
				ClientLastName:  lastName,
				ClientPhone:     raw.Phone,
				Service:         raw.Service,
				Worker:          raw.Worker,
				Date:            parsedDate,
				Status:          models.AppointmentStatus(raw.Status),
				Source:          models.AppointmentSourceSheets,
				SheetRowID:      sheetRowID,
				SheetID:         agent.GoogleSheetID,
				LastSyncedAt:    &now,
			}

			if err := config.DB.Create(&appt).Error; err != nil {
				log.Printf("⚠️  [Agent %d] Error guardando cita %s: %v", agent.ID, sheetRowID, err)
				continue
			}
			saved++
		}

		if saved > 0 {
			log.Printf("✅ [Agent %d] %d citas nuevas sincronizadas desde Sheets", agent.ID, saved)
		}
	}
}

// splitClientName separa un nombre completo en nombre y apellido
func splitClientName(fullName string) (string, string) {
	fullName = strings.TrimSpace(fullName)
	parts := strings.Fields(fullName)
	if len(parts) == 0 {
		return "", ""
	}
	if len(parts) == 1 {
		return parts[0], ""
	}
	return parts[0], strings.Join(parts[1:], " ")
}

// ============================================
// LECTURA DESDE SHEETS (lógica original)
// ============================================

func readAppointmentsFromSheet(ctx context.Context, sheetsService *services.GoogleSheetsService, tokenJSON, sheetID string, agentID uint, agentName string) ([]AppointmentResponse, error) {
	service, err := sheetsService.CreateSheetsService(ctx, tokenJSON)
	if err != nil {
		return nil, fmt.Errorf("error creando servicio: %w", err)
	}

	resp, err := service.Spreadsheets.Values.Get(sheetID, "Calendario!B2:H12").Do()
	if err != nil {
		return nil, fmt.Errorf("error leyendo sheet: %w", err)
	}

	appointments := []AppointmentResponse{}
	columns := []string{"B", "C", "D", "E", "F", "G", "H"}
	weekdays := []time.Weekday{time.Monday, time.Tuesday, time.Wednesday, time.Thursday, time.Friday, time.Saturday, time.Sunday}

	for rowIdx, row := range resp.Values {
		hour := 9 + rowIdx
		for colIdx, cell := range row {
			if cell == nil || cell == "" {
				continue
			}
			cellContent := fmt.Sprintf("%v", cell)
			if strings.TrimSpace(cellContent) == "" {
				continue
			}
			appointment := parseAppointmentFromCell(cellContent, weekdays[colIdx], hour, columns[colIdx], rowIdx+2)
			if appointment == nil {
				continue
			}
			appointment.AgentID = agentID
			appointment.AgentName = agentName
			appointment.SheetURL = fmt.Sprintf("https://docs.google.com/spreadsheets/d/%s/edit", sheetID)
			appointments = append(appointments, *appointment)
		}
	}

	return appointments, nil
}

func parseAppointmentFromCell(content string, weekday time.Weekday, hour int, column string, row int) *AppointmentResponse {
	lines := strings.Split(content, "\n")
	if len(lines) < 3 {
		return nil
	}

	appointment := &AppointmentResponse{
		Duration: 60,
		Status:   "confirmed",
	}

	contentLower := strings.ToLower(content)
	if strings.Contains(content, "❌") ||
		strings.Contains(contentLower, "cancelada") ||
		strings.Contains(contentLower, "cancelado") {
		appointment.Status = "cancelled"
	}

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.Contains(line, "👤") {
			appointment.Client = strings.TrimSpace(strings.ReplaceAll(line, "👤", ""))
		}
		if strings.Contains(line, "📞") {
			appointment.Phone = strings.TrimSpace(strings.ReplaceAll(line, "📞", ""))
		}
		if strings.Contains(line, "✂️") || strings.Contains(line, "✂") {
			appointment.Service = strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(line, "✂️", ""), "✂", ""))
		}
		if strings.Contains(line, "👨‍💼") || strings.Contains(line, "👨") {
			appointment.Worker = strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(line, "👨‍💼", ""), "👨", ""))
		}
		if strings.Contains(line, "📅") {
			dateStr := strings.TrimSpace(strings.ReplaceAll(line, "📅", ""))
			if parsedDate, err := time.Parse("02/01/2006", dateStr); err == nil {
				appointment.Date = parsedDate.Format("2006-01-02")
			}
		}
	}

	if appointment.Date == "" {
		appointment.Date = getNextDateForWeekday(weekday)
	}

	appointment.Time = fmt.Sprintf("%02d:00", hour)
	appointment.ID = fmt.Sprintf("%s%d", column, row)
	appointment.SheetCell = fmt.Sprintf("%s%d", column, row)

	if appointment.Client == "" || appointment.Service == "" {
		return nil
	}

	return appointment
}

func getNextDateForWeekday(targetWeekday time.Weekday) string {
	now := time.Now()
	currentWeekday := now.Weekday()
	daysUntil := int(targetWeekday - currentWeekday)
	if daysUntil <= 0 {
		daysUntil += 7
	}
	return now.AddDate(0, 0, daysUntil).Format("2006-01-02")
}

func getGoogleClientID() string {
	clientID := config.GetEnv("GOOGLE_INTEGRATION_CLIENT_ID")
	if clientID == "" {
		clientID = config.GetEnv("GOOGLE_CLIENT_ID")
	}
	return clientID
}

func getGoogleClientSecret() string {
	clientSecret := config.GetEnv("GOOGLE_INTEGRATION_CLIENT_SECRET")
	if clientSecret == "" {
		clientSecret = config.GetEnv("GOOGLE_CLIENT_SECRET")
	}
	return clientSecret
}

func getGoogleRedirectURL() string {
	redirectURL := config.GetEnv("GOOGLE_INTEGRATION_REDIRECT_URL")
	if redirectURL == "" {
		redirectURL = config.GetEnv("GOOGLE_REDIRECT_URL")
	}
	return redirectURL
}
