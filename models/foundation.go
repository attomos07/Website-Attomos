package models

import (
	"encoding/json"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

// =============================================================================
// ATTOMOS FOUNDATION — donaciones a rescatistas independientes
//
// Usuarios propios (separados de los usuarios B2B de Attomos): un donador o
// una rescatista. Cada rescatista tiene un perfil público con planes de
// suscripción mensual (o monto libre) y donación única.
//
// Pagos: México → Stripe Connect Express (cargo directo en la cuenta de la
// rescatista). Venezuela → PayPal (pendiente).
// Foto de perfil: vive en el Google Drive de la rescatista (scope drive.file);
// aquí solo se guarda el fileId.
// =============================================================================

const (
	FoundationRoleDonor   = "donor"
	FoundationRoleRescuer = "rescuer"

	FoundationPledgeSubscription = "subscription"
	FoundationPledgeOneTime      = "one_time"

	// Estados de un aporte
	FoundationPledgePending   = "pending"   // checkout creado, sin pagar
	FoundationPledgeActive    = "active"    // suscripción al corriente
	FoundationPledgeCanceling = "canceling" // se cancela al final del periodo
	FoundationPledgePastDue   = "past_due"  // falló el cobro mensual
	FoundationPledgeCanceled  = "canceled"  // suscripción terminada
	FoundationPledgePaid      = "paid"      // donación única pagada
	FoundationPledgeExpired   = "expired"   // checkout abandonado
)

// FoundationUser — cuenta de Attomos Foundation (donador o rescatista).
type FoundationUser struct {
	ID       uint   `gorm:"primaryKey" json:"id"`
	Name     string `gorm:"size:120;not null" json:"name"`
	Email    string `gorm:"size:255;uniqueIndex;not null" json:"email"`
	Password string `gorm:"size:255;not null" json:"-"`
	Role     string `gorm:"size:20;not null;index" json:"role"` // donor | rescuer

	CreatedAt time.Time      `json:"createdAt"`
	UpdatedAt time.Time      `json:"updatedAt"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

func (FoundationUser) TableName() string { return "foundation_users" }

func (u *FoundationUser) HashPassword(password string) error {
	h, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	u.Password = string(h)
	return nil
}

func (u *FoundationUser) CheckPassword(password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(u.Password), []byte(password)) == nil
}

// FoundationRescuer — perfil público de una rescatista.
type FoundationRescuer struct {
	ID      uint   `gorm:"primaryKey" json:"id"`
	UserID  uint   `gorm:"not null;uniqueIndex" json:"userId"`
	Slug    string `gorm:"size:60;not null;uniqueIndex" json:"slug"`
	Name    string `gorm:"size:120;not null" json:"name"`
	City    string `gorm:"size:120" json:"city"`
	Country string `gorm:"size:60;default:'México'" json:"country"` // México | Venezuela
	Bio     string `gorm:"type:text" json:"bio"`

	AvatarFileID string `gorm:"size:120" json:"avatarFileId"`

	Instagram string `gorm:"size:120" json:"instagram"`
	Facebook  string `gorm:"size:255" json:"facebook"`
	TikTok    string `gorm:"size:120" json:"tiktok"`
	WhatsApp  string `gorm:"size:40" json:"whatsapp"`

	// Monto libre mensual
	AllowCustomMonthly bool    `gorm:"default:true" json:"allowCustomMonthly"`
	MinCustomMonthly   float64 `gorm:"default:50" json:"minCustomMonthly"`

	// Donación única
	OneTimeEnabled     bool    `gorm:"default:true" json:"oneTimeEnabled"`
	OneTimeSuggested   string  `gorm:"type:text" json:"-"` // JSON []float64
	OneTimeAllowCustom bool    `gorm:"default:true" json:"oneTimeAllowCustom"`
	OneTimeMin         float64 `gorm:"default:20" json:"oneTimeMin"`

	Published bool `gorm:"default:false;index" json:"published"`

	// ── Stripe Connect (México) ─────────────────────────────────────────────
	StripeAccountID      string     `gorm:"size:100;index" json:"-"`
	StripeStatus         string     `gorm:"size:40" json:"-"` // pending | pending_verification | active | restricted
	StripeChargesEnabled bool       `gorm:"default:false" json:"-"`
	StripePayoutsEnabled bool       `gorm:"default:false" json:"-"`
	StripeConnectedAt    *time.Time `json:"-"`

	// ── Google Drive (fotos) ────────────────────────────────────────────────
	GoogleToken      string     `gorm:"type:text" json:"-"`
	GoogleEmail      string     `gorm:"size:255" json:"-"`
	DriveFolderID    string     `gorm:"size:120" json:"-"` // carpeta "Attomos Foundation"
	DriveConnectedAt *time.Time `json:"-"`
	DriveIssue       string     `gorm:"size:255" json:"-"` // aviso para la rescatista (foto en papelera, token revocado...)
	DriveCheckedAt   *time.Time `json:"-"`

	Plans []FoundationPlan `gorm:"foreignKey:RescuerID" json:"plans"`

	CreatedAt time.Time      `json:"createdAt"`
	UpdatedAt time.Time      `json:"updatedAt"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

func (FoundationRescuer) TableName() string { return "foundation_rescuers" }

// Currency moneda en la que cobra según su país.
func (r *FoundationRescuer) Currency() string {
	if r.Country == "Venezuela" {
		return "USD"
	}
	return "MXN"
}

// PaymentProvider pasarela según el país.
func (r *FoundationRescuer) PaymentProvider() string {
	if r.Country == "Venezuela" {
		return "paypal"
	}
	return "stripe"
}

// PaymentsReady true si ya puede recibir aportes.
func (r *FoundationRescuer) PaymentsReady() bool {
	if r.PaymentProvider() == "stripe" {
		return r.StripeAccountID != "" && r.StripeChargesEnabled
	}
	return false // PayPal: próximamente
}

func (r *FoundationRescuer) Suggested() []float64 {
	out := []float64{}
	if strings.TrimSpace(r.OneTimeSuggested) != "" {
		_ = json.Unmarshal([]byte(r.OneTimeSuggested), &out)
	}
	return out
}

func (r *FoundationRescuer) SetSuggested(v []float64) {
	if v == nil {
		v = []float64{}
	}
	b, _ := json.Marshal(v)
	r.OneTimeSuggested = string(b)
}

// FoundationPlan — plan de suscripción mensual de una rescatista.
type FoundationPlan struct {
	ID          uint    `gorm:"primaryKey" json:"id"`
	RescuerID   uint    `gorm:"not null;index" json:"rescuerId"`
	Name        string  `gorm:"size:60;not null" json:"name"`
	Amount      float64 `gorm:"not null" json:"amount"`
	Description string  `gorm:"size:255" json:"description"`
	Perks       string  `gorm:"type:text" json:"-"` // JSON []string
	Featured    bool    `gorm:"default:false" json:"featured"`

	CreatedAt time.Time      `json:"createdAt"`
	UpdatedAt time.Time      `json:"updatedAt"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

func (FoundationPlan) TableName() string { return "foundation_plans" }

func (p *FoundationPlan) PerkList() []string {
	out := []string{}
	if strings.TrimSpace(p.Perks) != "" {
		_ = json.Unmarshal([]byte(p.Perks), &out)
	}
	return out
}

func (p *FoundationPlan) SetPerks(v []string) {
	if v == nil {
		v = []string{}
	}
	b, _ := json.Marshal(v)
	p.Perks = string(b)
}

// FoundationPledge — un aporte: suscripción mensual o donación única.
type FoundationPledge struct {
	ID        uint `gorm:"primaryKey" json:"id"`
	DonorID   uint `gorm:"not null;index" json:"donorId"`
	RescuerID uint `gorm:"not null;index" json:"rescuerId"`

	Type     string  `gorm:"size:20;not null;index" json:"type"` // subscription | one_time
	Amount   float64 `gorm:"not null" json:"amount"`
	Currency string  `gorm:"size:3;not null" json:"currency"`
	Status   string  `gorm:"size:20;not null;index" json:"status"`

	PlanID   *uint  `json:"planId"`
	PlanName string `gorm:"size:60" json:"planName"`

	Provider                string `gorm:"size:20;default:'stripe'" json:"provider"`
	StripeAccountID         string `gorm:"size:100" json:"-"`
	StripeCheckoutSessionID string `gorm:"size:255;index" json:"-"`
	StripeSubscriptionID    string `gorm:"size:255;index" json:"-"`
	StripePaymentIntentID   string `gorm:"size:255" json:"-"`
	StripeCustomerID        string `gorm:"size:255" json:"-"`

	TotalPaid        float64    `gorm:"default:0" json:"totalPaid"`
	PaymentsCount    int        `gorm:"default:0" json:"paymentsCount"`
	LastPaidAt       *time.Time `json:"lastPaidAt"`
	CurrentPeriodEnd *time.Time `json:"currentPeriodEnd"`
	CanceledAt       *time.Time `json:"canceledAt"`

	CreatedAt time.Time      `json:"createdAt"`
	UpdatedAt time.Time      `json:"updatedAt"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

func (FoundationPledge) TableName() string { return "foundation_pledges" }

// IsMonthly suscripción (no donación única).
func (p *FoundationPledge) IsMonthly() bool { return p.Type != FoundationPledgeOneTime }

// FoundationPayment — cada cobro exitoso (primer pago, renovaciones y únicas).
type FoundationPayment struct {
	ID              uint      `gorm:"primaryKey" json:"id"`
	PledgeID        uint      `gorm:"not null;index" json:"pledgeId"`
	RescuerID       uint      `gorm:"not null;index" json:"rescuerId"`
	Amount          float64   `gorm:"not null" json:"amount"`
	Currency        string    `gorm:"size:3" json:"currency"`
	StripeInvoiceID string    `gorm:"size:255;uniqueIndex:idx_foundation_payment_ref" json:"-"`
	StripeIntentID  string    `gorm:"size:255;uniqueIndex:idx_foundation_payment_ref" json:"-"`
	PaidAt          time.Time `json:"paidAt"`

	CreatedAt time.Time `json:"createdAt"`
}

func (FoundationPayment) TableName() string { return "foundation_payments" }

// FoundationFile — foto de perfil subida por Attomos al Drive de una
// rescatista. Sirve para saber de quién es cada fileId (proxy y validación).
type FoundationFile struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	FileID    string    `gorm:"size:120;uniqueIndex;not null" json:"fileId"`
	RescuerID uint      `gorm:"not null;index" json:"rescuerId"`
	Kind      string    `gorm:"size:20" json:"kind"` // avatar
	MimeType  string    `gorm:"size:60" json:"mimeType"`
	Size      int       `json:"size"`
	CreatedAt time.Time `json:"createdAt"`
}

func (FoundationFile) TableName() string { return "foundation_files" }
