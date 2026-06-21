package handlers

import (
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"attomos/config"
	"attomos/models"

	"github.com/gin-gonic/gin"
)

// HistorialResponse representa una entrada del historial para el frontend
type HistorialResponse struct {
	ID            uint   `json:"id"`
	AppointmentID uint   `json:"appointmentId"`
	Client        string `json:"client"`
	ClientFirst   string `json:"clientFirst"`
	ClientLast    string `json:"clientLast"`
	Phone         string `json:"phone"`
	Service       string `json:"service"`
	Worker        string `json:"worker"`
	Date          string `json:"date"`      // YYYY-MM-DD
	Time          string `json:"time"`      // HH:MM
	EntryType     string `json:"entryType"` // visita | cancelada | cita
	Source        string `json:"source"`    // sheets | agent | manual
	AgentID       uint   `json:"agentId"`
	AgentName     string `json:"agentName"`
	SheetURL      string `json:"sheetUrl"`
	Notes         string `json:"notes"`
	CreatedAt     string `json:"createdAt"`
}

// HistorialStatsResponse estadísticas del historial
type HistorialStatsResponse struct {
	TotalVisitas    int64 `json:"totalVisitas"`
	TotalClientes   int64 `json:"totalClientes"`
	TotalCanceladas int64 `json:"totalCanceladas"`
	VisitasMes      int64 `json:"visitasMes"`
}

// GetHistorial obtiene el historial del usuario
// Estrategia: lee citas con source=sheets o source=agent (completadas o canceladas)
// y también las entries de client_history_entries si existen.
// De esta forma, funciona aunque no se hayan migrado aún a client_history_entries.
func GetHistorial(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}
	user := userInterface.(*models.User)

	// ── Parámetros de filtro ──────────────────────────────────────
	search := strings.TrimSpace(c.Query("search"))
	entryType := c.Query("type")  // visita | cancelada | all
	agentID := c.Query("agentId") // número o "all"
	dateRange := c.Query("range") // week | month | year | all
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "10"))
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 200 {
		limit = 50
	}
	offset := (page - 1) * limit

	// ── Construir query base sobre appointments ───────────────────
	// El historial muestra: citas de sheets/agent que están completadas o canceladas,
	// MÁS todas las entradas de client_history_entries propias.
	// Por simplicidad y para no requerir migración, leemos directamente desde appointments.
	db := config.DB.Model(&models.Appointment{}).
		Where("user_id = ?", user.ID).
		Where("source IN ?", []string{"sheets", "agent", "manual"})

	// Filtro por tipo
	switch entryType {
	case "visita":
		db = db.Where("status = ?", "completed")
	case "cancelada":
		db = db.Where("status = ?", "cancelled")
	default:
		// Todos: completadas + canceladas + (citas pasadas de sheets)
		db = db.Where("status IN ? OR (source IN ? AND date < ?)",
			[]string{"completed", "cancelled"},
			[]string{"sheets", "agent"},
			time.Now(),
		)
	}

	// Filtro por agente
	if agentID != "" && agentID != "all" {
		if aid, err := strconv.ParseUint(agentID, 10, 64); err == nil {
			db = db.Where("agent_id = ?", uint(aid))
		}
	}

	// Filtro por rango de fecha
	now := time.Now()
	switch dateRange {
	case "week":
		start := now.AddDate(0, 0, -7)
		db = db.Where("date >= ?", start)
	case "month":
		start := now.AddDate(0, -1, 0)
		db = db.Where("date >= ?", start)
	case "year":
		start := now.AddDate(-1, 0, 0)
		db = db.Where("date >= ?", start)
	}

	// Búsqueda por nombre o servicio
	if search != "" {
		like := "%" + strings.ToLower(search) + "%"
		db = db.Where(
			"LOWER(client_first_name) LIKE ? OR LOWER(client_last_name) LIKE ? OR LOWER(service) LIKE ? OR LOWER(client_phone) LIKE ?",
			like, like, like, like,
		)
	}

	// ── Contar total ──────────────────────────────────────────────
	var total int64
	db.Count(&total)

	// ── Obtener registros paginados ───────────────────────────────
	var appointments []models.Appointment
	if err := db.Order("date DESC").Limit(limit).Offset(offset).Find(&appointments).Error; err != nil {
		log.Printf("❌ [User %d] Error leyendo historial: %v", user.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error obteniendo historial"})
		return
	}

	// ── Mapa agentID → agentName ──────────────────────────────────
	var allAgents []models.Agent
	config.DB.Where("user_id = ?", user.ID).Select("id, name").Find(&allAgents)
	agentNames := map[uint]string{}
	for _, a := range allAgents {
		agentNames[a.ID] = a.Name
	}

	// ── Construir respuesta ───────────────────────────────────────
	response := make([]HistorialResponse, 0, len(appointments))
	for _, appt := range appointments {
		agName := agentNames[appt.AgentID]

		sheetURL := ""
		if appt.SheetID != "" {
			sheetURL = fmt.Sprintf("https://docs.google.com/spreadsheets/d/%s/edit", appt.SheetID)
		}

		entryT := "visita"
		if appt.Status == models.AppointmentStatusCancelled {
			entryT = "cancelada"
		} else if appt.Status == models.AppointmentStatusPending || appt.Status == models.AppointmentStatusConfirmed {
			entryT = "cita"
		}

		response = append(response, HistorialResponse{
			AppointmentID: appt.ID,
			Client:        appt.GetClientFullName(),
			ClientFirst:   appt.ClientFirstName,
			ClientLast:    appt.ClientLastName,
			Phone:         appt.ClientPhone,
			Service:       appt.Service,
			Worker:        appt.Worker,
			Date:          appt.Date.Format("2006-01-02"),
			Time:          appt.Date.Format("15:04"),
			EntryType:     entryT,
			Source:        string(appt.Source),
			AgentID:       appt.AgentID,
			AgentName:     agName,
			SheetURL:      sheetURL,
			Notes:         appt.Notes,
			CreatedAt:     appt.CreatedAt.Format("2006-01-02"),
		})
	}

	// ── Estadísticas ──────────────────────────────────────────────
	var totalVisitas, totalCanceladas, visitasMes, totalClientes int64

	config.DB.Model(&models.Appointment{}).
		Where("user_id = ? AND status = ?", user.ID, "completed").
		Count(&totalVisitas)

	config.DB.Model(&models.Appointment{}).
		Where("user_id = ? AND status = ?", user.ID, "cancelled").
		Count(&totalCanceladas)

	config.DB.Model(&models.Appointment{}).
		Where("user_id = ? AND status = ? AND date >= ?", user.ID, "completed", now.AddDate(0, -1, 0)).
		Count(&visitasMes)

	config.DB.Model(&models.Appointment{}).
		Where("user_id = ?", user.ID).
		Distinct("client_phone").
		Count(&totalClientes)

	log.Printf("✅ [User %d] Historial: %d registros devueltos (total: %d)", user.ID, len(response), total)

	c.JSON(http.StatusOK, gin.H{
		"historial": response,
		"total":     total,
		"page":      page,
		"limit":     limit,
		"stats": HistorialStatsResponse{
			TotalVisitas:    totalVisitas,
			TotalClientes:   totalClientes,
			TotalCanceladas: totalCanceladas,
			VisitasMes:      visitasMes,
		},
	})
}

// GetHistorialCliente obtiene todo el historial de un cliente específico por teléfono
func GetHistorialCliente(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}
	user := userInterface.(*models.User)
	phone := strings.TrimSpace(c.Param("phone"))

	if phone == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Teléfono requerido"})
		return
	}

	var appointments []models.Appointment
	if err := config.DB.
		Where("user_id = ? AND client_phone = ?", user.ID, phone).
		Order("date DESC").
		Find(&appointments).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error obteniendo historial del cliente"})
		return
	}

	var allAgents []models.Agent
	config.DB.Where("user_id = ?", user.ID).Select("id, name").Find(&allAgents)
	agentNames := map[uint]string{}
	for _, a := range allAgents {
		agentNames[a.ID] = a.Name
	}

	response := make([]HistorialResponse, 0, len(appointments))
	for _, appt := range appointments {
		agName := agentNames[appt.AgentID]
		sheetURL := ""
		if appt.SheetID != "" {
			sheetURL = fmt.Sprintf("https://docs.google.com/spreadsheets/d/%s/edit", appt.SheetID)
		}
		entryT := "visita"
		if appt.Status == models.AppointmentStatusCancelled {
			entryT = "cancelada"
		} else if appt.Status == models.AppointmentStatusPending || appt.Status == models.AppointmentStatusConfirmed {
			entryT = "cita"
		}
		response = append(response, HistorialResponse{
			AppointmentID: appt.ID,
			Client:        appt.GetClientFullName(),
			Phone:         appt.ClientPhone,
			Service:       appt.Service,
			Worker:        appt.Worker,
			Date:          appt.Date.Format("2006-01-02"),
			Time:          appt.Date.Format("15:04"),
			EntryType:     entryT,
			Source:        string(appt.Source),
			AgentID:       appt.AgentID,
			AgentName:     agName,
			SheetURL:      sheetURL,
			Notes:         appt.Notes,
			CreatedAt:     appt.CreatedAt.Format("2006-01-02"),
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"historial": response,
		"total":     len(response),
		"client":    phone,
	})
}
