package handlers

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ────────────────────────────────────────────────────────────────────────────
// MODELS
// ────────────────────────────────────────────────────────────────────────────

type Flow struct {
	ID         uint `json:"id"         gorm:"primaryKey;autoIncrement"`
	BusinessID uint `json:"businessId" gorm:"index;not null"`

	Name        string `json:"name"       gorm:"not null"`
	Trigger     string `json:"trigger"    gorm:"not null"`
	Welcome     string `json:"welcome"    gorm:"type:text"`
	ClosingMsg  string `json:"closingMsg" gorm:"type:text"`
	Action      string `json:"action"     gorm:"default:'none'"` // none|sheets|mark_open|mark_closed|agent
	SheetsID    string `json:"sheetsId"`
	SheetsTab   string `json:"sheetsTab"`
	SheetsRange string `json:"sheetsRange"`
	Status      string `json:"status"     gorm:"default:'draft'"`
	CanvasData  string `json:"canvasData" gorm:"type:text"` // JSON del diagrama canvas // draft|active|paused

	// Métricas — actualizadas por el bot, solo lectura desde el frontend
	Sent           int `json:"sent"           gorm:"default:0"`
	Delivered      int `json:"delivered"      gorm:"default:0"`
	Clicked        int `json:"clicked"        gorm:"default:0"`
	ResponsesToday int `json:"responsesToday" gorm:"-"` // calculado en runtime, no se persiste

	Options []FlowOption `json:"options" gorm:"foreignKey:FlowID;constraint:OnDelete:CASCADE"`

	CreatedAt time.Time      `json:"createdAt"`
	UpdatedAt time.Time      `json:"updatedAt"`
	DeletedAt gorm.DeletedAt `json:"-" gorm:"index"`
}

type FlowOption struct {
	ID     uint   `json:"id"     gorm:"primaryKey;autoIncrement"`
	FlowID uint   `json:"flowId" gorm:"index;not null"`
	Num    int    `json:"num"`
	Text   string `json:"text"`
}

// ────────────────────────────────────────────────────────────────────────────
// REQUEST TYPES
// ────────────────────────────────────────────────────────────────────────────

type FlowOptionInput struct {
	Num  int    `json:"num"`
	Text string `json:"text"`
}

type CreateFlowRequest struct {
	Name        string            `json:"name"       binding:"required"`
	Trigger     string            `json:"trigger"    binding:"required"`
	Welcome     string            `json:"welcome"`
	ClosingMsg  string            `json:"closingMsg"`
	Action      string            `json:"action"`
	SheetsID    string            `json:"sheetsId"`
	SheetsTab   string            `json:"sheetsTab"`
	SheetsRange string            `json:"sheetsRange"`
	Status      string            `json:"status"`
	CanvasData  string            `json:"canvasData"` // draft|active
	Options     []FlowOptionInput `json:"options"`
}

// ────────────────────────────────────────────────────────────────────────────
// HANDLER
// ────────────────────────────────────────────────────────────────────────────

type FlowHandler struct {
	DB *gorm.DB
}

func NewFlowHandler(db *gorm.DB) *FlowHandler {
	return &FlowHandler{DB: db}
}

// userIDFromContext extrae el userID del contexto (seteado por middleware.AuthRequired).
// Ajusta la clave "userID" si tu middleware usa otra distinta.
func userIDFromContext(c *gin.Context) (uint, bool) {
	val, exists := c.Get("userID")
	if !exists {
		return 0, false
	}
	switch v := val.(type) {
	case uint:
		return v, true
	case float64:
		return uint(v), true
	}
	return 0, false
}

// ────────────────────────────────────────────────────────────────────────────
// GET /api/flows
// ────────────────────────────────────────────────────────────────────────────

func (h *FlowHandler) ListFlows(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "no autenticado"})
		return
	}

	var flows []Flow
	if err := h.DB.
		Where("business_id = ?", userID).
		Preload("Options", func(db *gorm.DB) *gorm.DB {
			return db.Order("num ASC")
		}).
		Order("created_at DESC").
		Find(&flows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "error al obtener flujos"})
		return
	}

	c.JSON(http.StatusOK, flows)
}

// ────────────────────────────────────────────────────────────────────────────
// POST /api/flows
// ────────────────────────────────────────────────────────────────────────────

func (h *FlowHandler) CreateFlow(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "no autenticado"})
		return
	}

	var req CreateFlowRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Status != "active" && req.Status != "draft" {
		req.Status = "draft"
	}
	if req.Action == "" {
		req.Action = "none"
	}

	flow := Flow{
		BusinessID:  userID,
		Name:        req.Name,
		Trigger:     req.Trigger,
		Welcome:     req.Welcome,
		ClosingMsg:  req.ClosingMsg,
		Action:      req.Action,
		SheetsID:    req.SheetsID,
		SheetsTab:   req.SheetsTab,
		SheetsRange: req.SheetsRange,
		Status:      req.Status,
		CanvasData:  req.CanvasData,
	}

	if err := h.DB.Create(&flow).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "error al crear flujo"})
		return
	}

	// Insertar opciones después de tener el ID del flujo
	for _, opt := range req.Options {
		if opt.Text != "" {
			h.DB.Create(&FlowOption{FlowID: flow.ID, Num: opt.Num, Text: opt.Text})
		}
	}

	// Recargar con opciones
	h.DB.Preload("Options", func(db *gorm.DB) *gorm.DB {
		return db.Order("num ASC")
	}).First(&flow, flow.ID)

	c.JSON(http.StatusCreated, flow)
}

// ────────────────────────────────────────────────────────────────────────────
// PUT /api/flows/:id
// ────────────────────────────────────────────────────────────────────────────

func (h *FlowHandler) UpdateFlow(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "no autenticado"})
		return
	}

	flowID := c.Param("id")
	var flow Flow
	if err := h.DB.Where("id = ? AND business_id = ?", flowID, userID).First(&flow).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "flujo no encontrado"})
		return
	}

	var req CreateFlowRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Status != "active" && req.Status != "draft" && req.Status != "paused" {
		req.Status = flow.Status
	}

	flow.Name = req.Name
	flow.Trigger = req.Trigger
	flow.Welcome = req.Welcome
	flow.ClosingMsg = req.ClosingMsg
	flow.Action = req.Action
	flow.SheetsID = req.SheetsID
	flow.SheetsTab = req.SheetsTab
	flow.SheetsRange = req.SheetsRange
	flow.Status = req.Status
	flow.CanvasData = req.CanvasData

	if err := h.DB.Save(&flow).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "error al actualizar flujo"})
		return
	}

	// Reemplazar opciones
	h.DB.Where("flow_id = ?", flow.ID).Delete(&FlowOption{})
	for _, opt := range req.Options {
		if opt.Text != "" {
			h.DB.Create(&FlowOption{FlowID: flow.ID, Num: opt.Num, Text: opt.Text})
		}
	}

	h.DB.Preload("Options", func(db *gorm.DB) *gorm.DB {
		return db.Order("num ASC")
	}).First(&flow, flow.ID)

	c.JSON(http.StatusOK, flow)
}

// ────────────────────────────────────────────────────────────────────────────
// DELETE /api/flows/:id
// ────────────────────────────────────────────────────────────────────────────

func (h *FlowHandler) DeleteFlow(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "no autenticado"})
		return
	}

	flowID := c.Param("id")
	result := h.DB.Where("id = ? AND business_id = ?", flowID, userID).Delete(&Flow{})
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "error al eliminar flujo"})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "flujo no encontrado"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"deleted": flowID})
}

// ────────────────────────────────────────────────────────────────────────────
// POST /api/flows/:id/toggle
// Alterna active ↔ paused
// ────────────────────────────────────────────────────────────────────────────

func (h *FlowHandler) ToggleFlow(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "no autenticado"})
		return
	}

	flowID := c.Param("id")
	var flow Flow
	if err := h.DB.Where("id = ? AND business_id = ?", flowID, userID).First(&flow).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "flujo no encontrado"})
		return
	}

	if flow.Status == "active" {
		flow.Status = "paused"
	} else {
		flow.Status = "active"
	}

	if err := h.DB.Save(&flow).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "error al actualizar estado"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"id": flow.ID, "status": flow.Status})
}
