package models

import (
	"database/sql/driver"
	"encoding/json"
	"time"

	"gorm.io/gorm"
)

// ============================================
// TIPOS
// ============================================

type OrderStatus string

const (
	OrderStatusPending   OrderStatus = "pending"   // Recibido, sin confirmar
	OrderStatusConfirmed OrderStatus = "confirmed" // Confirmado por el negocio
	OrderStatusPreparing OrderStatus = "preparing" // En cocina / preparación
	OrderStatusReady     OrderStatus = "ready"     // Listo para entrega/retiro
	OrderStatusDelivered OrderStatus = "delivered" // Entregado
	OrderStatusCancelled OrderStatus = "cancelled" // Cancelado
)

type OrderType string

const (
	OrderTypeDelivery    OrderType = "delivery"     // A domicilio
	OrderTypePickup      OrderType = "pickup"       // Para llevar
	OrderTypeDineIn      OrderType = "dine_in"      // Consumo en el local
	OrderTypeLocalPickup OrderType = "local_pickup" // Recoger en local
)

type OrderSource string

const (
	OrderSourceManual OrderSource = "manual" // Creado manualmente desde el panel
	OrderSourceAgent  OrderSource = "agent"  // Creado por el bot de WhatsApp
	OrderSourceNinda  OrderSource = "ninda"  // Creado desde el marketplace Ninda
)

// ============================================
// ORDERITEM — ítem individual del pedido
// ============================================

type OrderItem struct {
	Name     string  `json:"name"`
	Quantity int     `json:"quantity"`
	Price    float64 `json:"price"`
	Notes    string  `json:"notes,omitempty"`
}

type OrderItems []OrderItem

func (oi OrderItems) Value() (driver.Value, error) {
	b, err := json.Marshal(oi)
	if err != nil {
		return nil, err
	}
	return string(b), nil
}

func (oi *OrderItems) Scan(v interface{}) error {
	switch val := v.(type) {
	case []byte:
		return json.Unmarshal(val, oi)
	case string:
		return json.Unmarshal([]byte(val), oi)
	}
	return nil
}

// ============================================
// ORDER — pedido completo
// ============================================

type Order struct {
	ID     uint `gorm:"primaryKey" json:"id"`
	UserID uint `gorm:"not null;index" json:"userId"`

	// *uint nullable: pedidos manuales no tienen agente → GORM inserta NULL
	// en lugar de 0, evitando violar el FK fk_orders_agent → agents.id
	AgentID *uint `gorm:"index" json:"agentId"`

	// ── Cliente ──────────────────────────────
	ClientName  string `gorm:"size:255;not null" json:"clientName"`
	ClientPhone string `gorm:"size:50" json:"clientPhone"`

	// ── Contenido del pedido ─────────────────
	Items OrderItems `gorm:"type:json" json:"items"`
	Total float64    `gorm:"default:0" json:"total"`
	Notes string     `gorm:"type:text" json:"notes"`

	// ── Clasificación ────────────────────────
	OrderType OrderType   `gorm:"size:50;default:'pickup';index" json:"orderType"`
	Status    OrderStatus `gorm:"size:50;default:'pending';index" json:"status"`
	Source    OrderSource `gorm:"size:50;default:'manual';index" json:"source"`

	// ── Entrega ──────────────────────────────
	DeliveryAddress string `gorm:"type:text" json:"deliveryAddress"`
	EstimatedTime   int    `gorm:"default:30" json:"estimatedTime"` // minutos

	// ── Pago ─────────────────────────────────
	PaymentMethod string  `gorm:"size:50;default:'cash'" json:"paymentMethod"` // cash | card | transfer
	CashReceived  float64 `gorm:"default:0" json:"cashReceived"`               // monto entregado en efectivo

	// ── Timestamps ───────────────────────────
	CreatedAt time.Time      `json:"createdAt"`
	UpdatedAt time.Time      `json:"updatedAt"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

	// ── Relaciones ───────────────────────────
	User  User  `gorm:"foreignKey:UserID" json:"-"`
	Agent Agent `gorm:"foreignKey:AgentID" json:"-"`
}

func (Order) TableName() string { return "orders" }

func (o *Order) IsPending() bool   { return o.Status == OrderStatusPending }
func (o *Order) IsReady() bool     { return o.Status == OrderStatusReady }
func (o *Order) IsCancelled() bool { return o.Status == OrderStatusCancelled }
func (o *Order) IsDelivery() bool  { return o.OrderType == OrderTypeDelivery }
