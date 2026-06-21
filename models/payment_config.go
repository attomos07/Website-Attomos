package models

import (
	"time"

	"gorm.io/gorm"
)

// PaymentConfig almacena la configuración de métodos de pago para una sucursal.
// Un usuario puede tener múltiples sucursales, cada una con su propia config.
type PaymentConfig struct {
	ID       uint `gorm:"primaryKey" json:"id"`
	UserID   uint `gorm:"not null;index" json:"userId"`
	BranchID uint `gorm:"not null;index" json:"branchId"` // MyBusinessInfo.ID

	// ── Transferencia SPEI ──────────────────────────────────────────────────
	SPEIEnabled bool   `gorm:"default:false" json:"speiEnabled"`
	CLABENumber string `gorm:"size:18" json:"clabeNumber"`  // CLABE interbancaria 18 dígitos
	BankName    string `gorm:"size:100" json:"bankName"`    // Nombre del banco (opcional, para mostrar al cliente)
	AccountName string `gorm:"size:255" json:"accountName"` // Nombre del titular (para mostrar al cliente)

	// ── Stripe Connect ──────────────────────────────────────────────────────
	StripeEnabled        bool       `gorm:"default:false" json:"stripeEnabled"`
	StripeAccountID      string     `gorm:"size:100" json:"stripeAccountId"`     // acct_xxxxxxxx
	StripeAccountStatus  string     `gorm:"size:50" json:"stripeAccountStatus"`  // "pending" | "active" | "restricted"
	StripeOnboardingURL  string     `gorm:"size:500" json:"stripeOnboardingUrl"` // URL de onboarding (temporal)
	StripePayoutsEnabled bool       `gorm:"default:false" json:"stripePayoutsEnabled"`
	StripeChargesEnabled bool       `gorm:"default:false" json:"stripeChargesEnabled"`
	StripeConnectedAt    *time.Time `json:"stripeConnectedAt"`

	// ── Configuración general ───────────────────────────────────────────────
	// Cuándo mostrar opciones de pago en el bot
	PaymentRequiredForBooking bool `gorm:"default:false" json:"paymentRequiredForBooking"` // Si true, el bot pide pago antes de confirmar cita

	CreatedAt time.Time      `json:"createdAt"`
	UpdatedAt time.Time      `json:"updatedAt"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

func (PaymentConfig) TableName() string { return "payment_configs" }
