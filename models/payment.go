package models

import (
	"fmt"
	"time"

	"gorm.io/gorm"
)

type Payment struct {
	ID             uint `gorm:"primaryKey" json:"id"`
	UserID         uint `gorm:"not null;index" json:"userId"`
	SubscriptionID uint `gorm:"index" json:"subscriptionId"`

	// Stripe Information
	StripePaymentIntentID string `gorm:"size:255;uniqueIndex" json:"stripePaymentIntentId"`
	StripeChargeID        string `gorm:"size:255;index" json:"stripeChargeId"`
	StripeInvoiceID       string `gorm:"size:255;index" json:"stripeInvoiceId"`

	// Payment Details
	Amount        int64  `gorm:"not null" json:"amount"` // Amount in cents
	Currency      string `gorm:"size:10;default:'mxn'" json:"currency"`
	Status        string `gorm:"size:50;not null" json:"status"` // pending, succeeded, failed, refunded, canceled
	PaymentMethod string `gorm:"size:50" json:"paymentMethod"`   // card, oxxo, spei, etc.

	// Plan Information (at the time of payment)
	Plan         string `gorm:"size:50" json:"plan"`
	BillingCycle string `gorm:"size:20" json:"billingCycle"`

	// Description and Metadata
	Description string  `gorm:"size:500" json:"description"`
	Metadata    *string `gorm:"type:json;default:null" json:"metadata"` // JSON para datos adicionales

	// Dates
	PaidAt     *time.Time `json:"paidAt"`
	RefundedAt *time.Time `json:"refundedAt"`
	FailedAt   *time.Time `json:"failedAt"`

	// Error Information (if failed)
	ErrorCode    string `gorm:"size:100" json:"errorCode"`
	ErrorMessage string `gorm:"size:500" json:"errorMessage"`

	// Timestamps
	CreatedAt time.Time      `json:"createdAt"`
	UpdatedAt time.Time      `json:"updatedAt"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

	// Relations
	User         User         `gorm:"foreignKey:UserID" json:"-"`
	Subscription Subscription `gorm:"foreignKey:SubscriptionID" json:"-"`
}

func (Payment) TableName() string {
	return "payments"
}

// IsSuccessful verifica si el pago fue exitoso
func (p *Payment) IsSuccessful() bool {
	return p.Status == "succeeded"
}

// IsPending verifica si el pago está pendiente
func (p *Payment) IsPending() bool {
	return p.Status == "pending"
}

// IsFailed verifica si el pago falló
func (p *Payment) IsFailed() bool {
	return p.Status == "failed"
}

// IsRefunded verifica si el pago fue reembolsado
func (p *Payment) IsRefunded() bool {
	return p.Status == "refunded"
}

// GetAmountInMXN retorna el monto en pesos mexicanos (formato legible)
func (p *Payment) GetAmountInMXN() float64 {
	return float64(p.Amount) / 100.0
}

// GetFormattedAmount retorna el monto formateado con símbolo de moneda
func (p *Payment) GetFormattedAmount() string {
	amount := p.GetAmountInMXN()
	if p.Currency == "mxn" {
		return fmt.Sprintf("$%.2f MXN", amount)
	}
	return fmt.Sprintf("$%.2f %s", amount, p.Currency)
}

// MarkAsSucceeded marca el pago como exitoso
func (p *Payment) MarkAsSucceeded() {
	p.Status = "succeeded"
	now := time.Now()
	p.PaidAt = &now
}

// MarkAsFailed marca el pago como fallido
func (p *Payment) MarkAsFailed(errorCode, errorMessage string) {
	p.Status = "failed"
	p.ErrorCode = errorCode
	p.ErrorMessage = errorMessage
	now := time.Now()
	p.FailedAt = &now
}

// MarkAsRefunded marca el pago como reembolsado
func (p *Payment) MarkAsRefunded() {
	p.Status = "refunded"
	now := time.Now()
	p.RefundedAt = &now
}
