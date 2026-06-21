package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"

	"attomos/config"
	"attomos/models"

	"github.com/gin-gonic/gin"
)

// OrderResponse representa un pedido para el frontend
type OrderResponse struct {
	ID              string            `json:"id"`
	ClientName      string            `json:"clientName"`
	ClientPhone     string            `json:"clientPhone"`
	Items           models.OrderItems `json:"items"`
	Total           float64           `json:"total"`
	Notes           string            `json:"notes"`
	OrderType       string            `json:"orderType"`
	Status          string            `json:"status"`
	Source          string            `json:"source"`
	AgentID         *uint             `json:"agentId"` // puntero: null cuando es manual
	AgentName       string            `json:"agentName"`
	DeliveryAddress string            `json:"deliveryAddress"`
	EstimatedTime   int               `json:"estimatedTime"`
	PaymentMethod   string            `json:"paymentMethod"`
	CashReceived    float64           `json:"cashReceived"`
	CreatedAt       string            `json:"createdAt"`
}

// GetOrders devuelve todos los pedidos del usuario
func GetOrders(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}
	user := userInterface.(*models.User)

	var orders []models.Order
	if err := config.DB.
		Where("user_id = ?", user.ID).
		Order("created_at DESC").
		Find(&orders).Error; err != nil {
		log.Printf("❌ [User %d] Error leyendo pedidos: %v", user.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error obteniendo pedidos"})
		return
	}

	// Mapa de agentes para nombres
	var agents []models.Agent
	config.DB.Where("user_id = ?", user.ID).Select("id, name").Find(&agents)
	agentNames := map[uint]string{}
	for _, a := range agents {
		agentNames[a.ID] = a.Name
	}

	response := make([]OrderResponse, 0, len(orders))
	for _, o := range orders {
		response = append(response, orderToResponse(o, agentNames))
	}

	c.JSON(http.StatusOK, gin.H{
		"orders": response,
		"total":  len(response),
	})
}

// CreateOrder crea un pedido manual desde el panel
func CreateOrder(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}
	user := userInterface.(*models.User)

	var req struct {
		ClientName      string      `json:"clientName" binding:"required"`
		ClientPhone     string      `json:"clientPhone"`
		Items           interface{} `json:"items"`
		Total           float64     `json:"total"`
		Notes           string      `json:"notes"`
		OrderType       string      `json:"orderType"`
		DeliveryAddress string      `json:"deliveryAddress"`
		EstimatedTime   int         `json:"estimatedTime"`
		AgentID         uint        `json:"agentId"`
		Status          string      `json:"status"`
		PaymentMethod   string      `json:"paymentMethod"`
		CashReceived    float64     `json:"cashReceived"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos inválidos", "details": err.Error()})
		return
	}

	// Serializar items a JSON
	itemsJSON := "[]"
	if req.Items != nil {
		b, _ := json.Marshal(req.Items)
		itemsJSON = string(b)
	}
	var items models.OrderItems
	json.Unmarshal([]byte(itemsJSON), &items)

	orderType := models.OrderTypePickup
	if req.OrderType != "" {
		orderType = models.OrderType(req.OrderType)
	}

	status := models.OrderStatusPending
	if req.Status != "" {
		status = models.OrderStatus(req.Status)
	}

	estimatedTime := 30
	if req.EstimatedTime > 0 {
		estimatedTime = req.EstimatedTime
	}

	// AgentID: si el frontend envía 0 (pedido manual sin agente),
	// usar nil para que GORM inserte NULL y no viole el FK fk_orders_agent.
	var agentID *uint
	if req.AgentID > 0 {
		agentID = &req.AgentID
	}

	order := models.Order{
		UserID:          user.ID,
		AgentID:         agentID, // nil = sin agente (pedido manual)
		ClientName:      req.ClientName,
		ClientPhone:     req.ClientPhone,
		Items:           items,
		Total:           req.Total,
		Notes:           req.Notes,
		OrderType:       orderType,
		Status:          status,
		Source:          models.OrderSourceManual,
		DeliveryAddress: req.DeliveryAddress,
		EstimatedTime:   estimatedTime,
		PaymentMethod:   req.PaymentMethod,
		CashReceived:    req.CashReceived,
	}

	if err := config.DB.Create(&order).Error; err != nil {
		log.Printf("❌ [User %d] Error creando pedido: %v", user.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error guardando el pedido"})
		return
	}

	log.Printf("✅ [User %d] Pedido creado con ID: %d", user.ID, order.ID)
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"id":      order.ID,
		"message": "Pedido creado exitosamente",
	})
}

// UpdateOrderStatus actualiza el estado de un pedido
func UpdateOrderStatus(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}
	user := userInterface.(*models.User)
	orderID := c.Param("id")

	var req struct {
		Status string `json:"status" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Estado inválido"})
		return
	}

	result := config.DB.Model(&models.Order{}).
		Where("id = ? AND user_id = ?", orderID, user.ID).
		Update("status", req.Status)

	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error actualizando estado"})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Pedido no encontrado"})
		return
	}

	log.Printf("✅ [User %d] Pedido %s → %s", user.ID, orderID, req.Status)
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// DeleteOrder elimina un pedido (soft delete)
func DeleteOrder(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}
	user := userInterface.(*models.User)
	orderID := c.Param("id")

	result := config.DB.Where("id = ? AND user_id = ?", orderID, user.ID).
		Delete(&models.Order{})

	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error eliminando pedido"})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Pedido no encontrado"})
		return
	}

	log.Printf("✅ [User %d] Pedido %s eliminado", user.ID, orderID)
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// ── Helper interno ──────────────────────────────────────────

func orderToResponse(o models.Order, agentNames map[uint]string) OrderResponse {
	agentName := ""
	if o.AgentID != nil {
		agentName = agentNames[*o.AgentID]
	}

	return OrderResponse{
		ID:              fmt.Sprintf("%d", o.ID),
		ClientName:      o.ClientName,
		ClientPhone:     o.ClientPhone,
		Items:           o.Items,
		Total:           o.Total,
		Notes:           o.Notes,
		OrderType:       string(o.OrderType),
		Status:          string(o.Status),
		Source:          string(o.Source),
		AgentID:         o.AgentID,
		AgentName:       agentName,
		DeliveryAddress: o.DeliveryAddress,
		EstimatedTime:   o.EstimatedTime,
		PaymentMethod:   o.PaymentMethod,
		CashReceived:    o.CashReceived,
		CreatedAt:       o.CreatedAt.Format("2006-01-02 15:04"),
	}
}

// CreateBotOrder crea un pedido desde el bot de WhatsApp
func CreateBotOrder(c *gin.Context) {
	botToken := os.Getenv("BOT_API_TOKEN")
	if botToken == "" || c.GetHeader("Authorization") != "Bearer "+botToken {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Token inválido"})
		return
	}

	var req struct {
		AgentID         uint                     `json:"agentId"`
		ClientName      string                   `json:"clientName"`
		ClientPhone     string                   `json:"clientPhone"`
		Items           []map[string]interface{} `json:"items"`
		Total           float64                  `json:"total"`
		OrderType       string                   `json:"orderType"`
		DeliveryAddress string                   `json:"deliveryAddress"`
		Status          string                   `json:"status"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var agent models.Agent
	if err := config.DB.First(&agent, req.AgentID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Agente no encontrado"})
		return
	}

	itemsJSON, _ := json.Marshal(req.Items)
	var items models.OrderItems
	json.Unmarshal(itemsJSON, &items)

	orderType := models.OrderTypePickup
	if req.OrderType != "" {
		orderType = models.OrderType(req.OrderType)
	}
	status := models.OrderStatusPending
	if req.Status != "" {
		status = models.OrderStatus(req.Status)
	}

	agentID := &req.AgentID
	order := models.Order{
		UserID:          agent.UserID,
		AgentID:         agentID,
		ClientName:      req.ClientName,
		ClientPhone:     req.ClientPhone,
		Items:           items,
		Total:           req.Total,
		OrderType:       orderType,
		Status:          status,
		Source:          models.OrderSourceAgent,
		DeliveryAddress: req.DeliveryAddress,
		EstimatedTime:   30,
	}

	if err := config.DB.Create(&order).Error; err != nil {
		log.Printf("❌ [Bot] Error guardando pedido: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error guardando pedido"})
		return
	}

	log.Printf("✅ [Bot] Pedido creado ID=%d agente=%d cliente=%s", order.ID, req.AgentID, req.ClientName)
	c.JSON(http.StatusOK, gin.H{"success": true, "id": order.ID})
}
