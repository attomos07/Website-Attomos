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
// rescatista). Venezuela → PayPal (pendiente). En cualquier país la
// rescatista puede publicar sus datos para transferencias (cuentas de banco,
// Pago Móvil, Zelle, PayPal, Binance...), que el donador copia y usa directo.
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
	Country string `gorm:"size:60;default:'México'" json:"country"` // México | Venezuela | Ecuador
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

	Plans         []FoundationPlan         `gorm:"foreignKey:RescuerID" json:"plans"`
	PayoutMethods []FoundationPayoutMethod `gorm:"foreignKey:RescuerID" json:"payoutMethods"`

	CreatedAt time.Time      `json:"createdAt"`
	UpdatedAt time.Time      `json:"updatedAt"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

func (FoundationRescuer) TableName() string { return "foundation_rescuers" }

// Currency moneda en la que cobra según su país.
func (r *FoundationRescuer) Currency() string {
	if r.Country == "México" || r.Country == "" {
		return "MXN"
	}
	return "USD"
}

// PaymentProvider pasarela de tarjeta según el país ("" = solo transferencias).
func (r *FoundationRescuer) PaymentProvider() string {
	switch r.Country {
	case "México", "":
		return "stripe"
	case "Venezuela":
		return "paypal" // próximamente
	}
	return ""
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

// FoundationPayoutMethod — dato para recibir transferencias directas que la
// rescatista publica en su página (el donador lo copia y paga por su cuenta).
type FoundationPayoutMethod struct {
	ID            uint   `gorm:"primaryKey" json:"-"`
	RescuerID     uint   `gorm:"not null;index" json:"-"`
	Kind          string `gorm:"size:20;not null" json:"kind"` // bank | pago_movil | zelle | paypal | binance | zinli | other
	Country       string `gorm:"size:40" json:"country"`
	BankName      string `gorm:"size:80" json:"bankName"`      // banco, o nombre del método si Kind = other
	BankCode      string `gorm:"size:10" json:"bankCode"`      // código de banco (Pago Móvil)
	AccountType   string `gorm:"size:20" json:"accountType"`   // ahorros | corriente | clabe | tarjeta | otra
	AccountNumber string `gorm:"size:40" json:"accountNumber"` // número de cuenta / CLABE / tarjeta
	HolderName    string `gorm:"size:120" json:"holderName"`
	HolderID      string `gorm:"size:40" json:"holderId"` // CI, cédula, RFC...
	Phone         string `gorm:"size:30" json:"phone"`
	Handle        string `gorm:"size:160" json:"handle"` // correo, teléfono, Pay ID, paypal.me...
	Note          string `gorm:"size:300" json:"note"`
	SortOrder     int    `gorm:"default:0" json:"-"`

	CreatedAt time.Time      `json:"-"`
	UpdatedAt time.Time      `json:"-"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

func (FoundationPayoutMethod) TableName() string { return "foundation_payout_methods" }

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
