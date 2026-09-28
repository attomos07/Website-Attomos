package models

import (
	"time"

	"gorm.io/gorm"
)

type Subscription struct {
	ID     uint `gorm:"primaryKey" json:"id"`
	UserID uint `gorm:"not null;index;uniqueIndex:idx_user_subscription" json:"userId"`

	// Stripe Information
	StripeCustomerID     string `gorm:"size:255;index" json:"stripeCustomerId"`
	StripeSubscriptionID string `gorm:"size:255;index" json:"stripeSubscriptionId"`
	StripePriceID        string `gorm:"size:255" json:"stripePriceId"`

	// Plan Information
	Plan          string     `gorm:"size:50;not null;default:'pending'" json:"plan"`
	BillingCycle  string     `gorm:"size:20;default:'monthly'" json:"billingCycle"`
	Status        string     `gorm:"size:50;default:'inactive'" json:"status"`
	PlanChangedAt *time.Time `json:"planChangedAt"`

	// Billing Dates
	CurrentPeriodStart *time.Time `json:"currentPeriodStart"`
	CurrentPeriodEnd   *time.Time `json:"currentPeriodEnd"`
	TrialStart         *time.Time `json:"trialStart"`
	TrialEnd           *time.Time `json:"trialEnd"`
	CanceledAt         *time.Time `json:"canceledAt"`
	CancelAtPeriodEnd  bool       `gorm:"default:false" json:"cancelAtPeriodEnd"`

	// Pricing
	Amount   int64  `gorm:"default:0" json:"amount"`
	Currency string `gorm:"size:10;default:'mxn'" json:"currency"`

	// Usage Limits
	MaxAgents       int        `gorm:"default:1" json:"maxAgents"`
	MaxMessages     int        `gorm:"default:100" json:"maxMessages"`
	UsedMessages    int        `gorm:"default:0" json:"usedMessages"`
	ResetMessagesAt *time.Time `json:"resetMessagesAt"`

	// Metadata - CAMBIO AQUÍ: Ahora es *string (puntero) para permitir NULL
	Metadata *string `gorm:"type:json" json:"metadata"`

	// Timestamps
	CreatedAt time.Time      `json:"createdAt"`
	UpdatedAt time.Time      `json:"updatedAt"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

	// Relations
	User User `gorm:"foreignKey:UserID" json:"-"`
}

func (Subscription) TableName() string {
	return "subscriptions"
}

// IsActive verifica si la suscripción está activa
func (s *Subscription) IsActive() bool {
	return s.Status == "active" || s.Status == "trialing"
}

// IsTrial verifica si está en período de prueba
func (s *Subscription) IsTrial() bool {
	return s.Status == "trialing" && s.TrialEnd != nil && time.Now().Before(*s.TrialEnd)
}

// HasExpired verifica si la suscripción ha expirado
func (s *Subscription) HasExpired() bool {
	if s.CurrentPeriodEnd == nil {
		return true
	}
	return time.Now().After(*s.CurrentPeriodEnd)
}

// CanCreateAgent verifica si puede crear más agentes
func (s *Subscription) CanCreateAgent(currentAgentCount int) bool {
	if s.Plan == "electron" {
		return true
	}
	return currentAgentCount < s.MaxAgents
}

// CanSendMessage verifica si puede enviar más mensajes
func (s *Subscription) CanSendMessage() bool {
	if s.Plan == "electron" || s.Plan == "neutron" {
		return true
	}
	return s.UsedMessages < s.MaxMessages
}

// IncrementMessageUsage incrementa el contador de mensajes
func (s *Subscription) IncrementMessageUsage() {
	s.UsedMessages++
}

// ResetMessageUsage resetea el contador mensual
func (s *Subscription) ResetMessageUsage() {
	s.UsedMessages = 0
	now := time.Now()
	s.ResetMessagesAt = &now
}

// GetPlanLimits retorna los límites del plan actual
func (s *Subscription) GetPlanLimits() map[string]interface{} {
	limits := map[string]interface{}{
		"plan":         s.Plan,
		"maxAgents":    s.MaxAgents,
		"maxMessages":  s.MaxMessages,
		"usedMessages": s.UsedMessages,
		"isUnlimited":  s.Plan == "electron",
	}
	return limits
}

// GetDaysRemaining retorna los días restantes del período actual
func (s *Subscription) GetDaysRemaining() int {
	if s.CurrentPeriodEnd == nil {
		return 0
	}

	duration := time.Until(*s.CurrentPeriodEnd)
	days := int(duration.Hours() / 24)

	if days < 0 {
		return 0
	}

	return days
}

// SetPlanLimits configura los límites según el plan
func (s *Subscription) SetPlanLimits() {
	switch s.Plan {
	case "gratuito":
		s.MaxAgents = 1
		s.MaxMessages = 100
	case "proton":
		s.MaxAgents = 1
		s.MaxMessages = 1000
	case "neutron":
		s.MaxAgents = 3
		s.MaxMessages = 10000
	case "electron":
		s.MaxAgents = -1
		s.MaxMessages = -1
	default:
		s.MaxAgents = 0
		s.MaxMessages = 0
	}
}
