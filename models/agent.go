package models

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"time"

	"gorm.io/gorm"
)

// FlexibleString es un tipo que acepta string o number en JSON
type FlexibleString string

func (fs *FlexibleString) UnmarshalJSON(data []byte) error {
	var s string
	if err := json.Unmarshal(data, &s); err == nil {
		*fs = FlexibleString(s)
		return nil
	}
	var n float64
	if err := json.Unmarshal(data, &n); err == nil {
		*fs = FlexibleString(fmt.Sprintf("%.2f", n))
		return nil
	}
	return fmt.Errorf("no se pudo parsear como string o número")
}

func (fs FlexibleString) String() string { return string(fs) }

type DaySchedule struct {
	Open  bool   `json:"open"`
	Start string `json:"start"`
	End   string `json:"end"`
}

type Schedule struct {
	Monday    DaySchedule `json:"monday"`
	Tuesday   DaySchedule `json:"tuesday"`
	Wednesday DaySchedule `json:"wednesday"`
	Thursday  DaySchedule `json:"thursday"`
	Friday    DaySchedule `json:"friday"`
	Saturday  DaySchedule `json:"saturday"`
	Sunday    DaySchedule `json:"sunday"`
	Timezone  string      `json:"timezone"`
}

type Service struct {
	Title           string          `json:"title"`
	Description     string          `json:"description"`
	ImageUrls       []string        `json:"imageUrls"`
	PriceType       string          `json:"priceType"`
	Price           FlexibleString  `json:"price"`
	OriginalPrice   *FlexibleString `json:"originalPrice"`
	PromoPrice      *FlexibleString `json:"promoPrice"`
	PromoPeriodType string          `json:"promoPeriodType"`
	PromoDays       []string        `json:"promoDays"`
	PromoDateStart  string          `json:"promoDateStart"`
	PromoDateEnd    string          `json:"promoDateEnd"`
}

type Staff struct {
	Name      string   `json:"name"`
	StartTime string   `json:"startTime"`
	EndTime   string   `json:"endTime"`
	Days      []string `json:"days"`
}

type Holiday struct {
	Date string `json:"date"`
	Name string `json:"name"`
}

type Promotion struct {
	Name        string         `json:"name"`
	Discount    FlexibleString `json:"discount"`
	ValidDays   string         `json:"validDays"`
	Description string         `json:"description"`
}

// AgentConfig — solo datos propios del agente (sin duplicar negocio)
type AgentConfig struct {
	WelcomeMessage      string      `json:"welcomeMessage"`
	AIPersonality       string      `json:"aiPersonality"`
	Tone                string      `json:"tone"`
	CustomTone          string      `json:"customTone"`
	Languages           []string    `json:"languages"`
	AdditionalLanguages []string    `json:"additionalLanguages"`
	Promotions          []Promotion `json:"promotions"`
	Capabilities        []string    `json:"capabilities"`
	SpecialInstructions string      `json:"specialInstructions"`

	// ── Campos legacy (mantenidos por compatibilidad con agentes existentes) ──
	Schedule     Schedule            `json:"schedule,omitempty"`
	Holidays     []Holiday           `json:"holidays,omitempty"`
	Services     []Service           `json:"services,omitempty"`
	Workers      []Staff             `json:"workers,omitempty"`
	Facilities   []string            `json:"facilities,omitempty"`
	BusinessInfo BusinessProfileInfo `json:"businessInfo,omitempty"`
	Location     LocationProfile     `json:"location,omitempty"`
	SocialMedia  SocialMediaProfile  `json:"socialMedia,omitempty"`
}

type BusinessProfileInfo struct {
	Description string `json:"description,omitempty"`
	Website     string `json:"website,omitempty"`
	Email       string `json:"email,omitempty"`
}

type LocationProfile struct {
	Address        string `json:"address,omitempty"`
	BetweenStreets string `json:"betweenStreets,omitempty"`
	Number         string `json:"number,omitempty"`
	Neighborhood   string `json:"neighborhood,omitempty"`
	City           string `json:"city,omitempty"`
	State          string `json:"state,omitempty"`
	Country        string `json:"country,omitempty"`
	PostalCode     string `json:"postalCode,omitempty"`
}

type SocialMediaProfile struct {
	Facebook  string `json:"facebook,omitempty"`
	Instagram string `json:"instagram,omitempty"`
	Twitter   string `json:"twitter,omitempty"`
	LinkedIn  string `json:"linkedin,omitempty"`
}

func (a AgentConfig) Value() (driver.Value, error) { return json.Marshal(a) }
func (a *AgentConfig) Scan(value interface{}) error {
	if value == nil {
		return nil
	}
	bytes, ok := value.([]byte)
	if !ok {
		return nil
	}
	return json.Unmarshal(bytes, a)
}

type Agent struct {
	ID     uint `gorm:"primaryKey" json:"id"`
	UserID uint `gorm:"not null;index" json:"userId"`

	// Sucursal vinculada (fuente de verdad del negocio)
	BranchID uint `gorm:"default:0;index" json:"branchId"`

	// Información del agente
	Name         string `gorm:"size:255;not null" json:"name"`
	PhoneNumber  string `gorm:"size:50;not null" json:"phoneNumber"`
	BusinessType string `gorm:"size:100" json:"businessType"`
	MetaDocument string `gorm:"size:500" json:"metaDocument"`

	Config       AgentConfig `gorm:"type:json" json:"config"`
	Port         int         `gorm:"default:0" json:"port"`
	DeployStatus string      `gorm:"size:50;default:pending" json:"deployStatus"`
	IsActive     bool        `gorm:"default:false" json:"isActive"`
	BotType      string      `gorm:"size:50;default:orbital" json:"botType"`

	// WhatsApp Web (AtomicBot) — indica si el dispositivo ya está vinculado.
	// Se actualiza en GetAgentQRCode cuando detecta la sesión conectada, y se
	// resetea a false en ResetAgentSession/RedeployAgent (requieren nuevo QR).
	WhatsappConnected bool `gorm:"column:whatsapp_connected;default:false" json:"whatsappConnected"`

	// Servidor individual (OrbitalBot)
	ServerID       int    `gorm:"default:0" json:"serverId"`
	ServerIP       string `gorm:"size:50" json:"serverIp"`
	ServerPassword string `gorm:"size:255" json:"-"`
	ServerStatus   string `gorm:"size:50;default:pending" json:"serverStatus"`

	// Chatwoot
	ChatwootEmail       string `gorm:"size:255" json:"chatwootEmail"`
	ChatwootPassword    string `gorm:"size:255" json:"-"`
	ChatwootAccountID   int    `gorm:"default:0" json:"chatwootAccountId"`
	ChatwootAccountName string `gorm:"size:255" json:"chatwootAccountName"`
	ChatwootInboxID     int    `gorm:"default:0" json:"chatwootInboxId"`
	ChatwootInboxName   string `gorm:"size:255" json:"chatwootInboxName"`
	ChatwootURL         string `gorm:"size:500" json:"chatwootUrl"`

	// Google
	GoogleToken       string     `gorm:"type:text" json:"-"`
	GoogleCalendarID  string     `gorm:"size:500" json:"googleCalendarId"`
	GoogleSheetID     string     `gorm:"size:500" json:"googleSheetId"`
	GoogleConnected   bool       `gorm:"default:false" json:"googleConnected"`
	GoogleConnectedAt *time.Time `json:"googleConnectedAt"`

	// Meta WhatsApp
	MetaAccessToken    string     `gorm:"type:text" json:"-"`
	MetaWABAID         string     `gorm:"size:255" json:"metaWabaId"`
	MetaPhoneNumberID  string     `gorm:"size:255" json:"metaPhoneNumberId"`
	MetaDisplayNumber  string     `gorm:"size:50" json:"metaDisplayNumber"`
	MetaVerifiedName   string     `gorm:"size:255" json:"metaVerifiedName"`
	MetaConnected      bool       `gorm:"default:false" json:"metaConnected"`
	MetaConnectedAt    *time.Time `json:"metaConnectedAt"`
	MetaTokenExpiresAt *time.Time `json:"metaTokenExpiresAt"`

	CreatedAt time.Time      `json:"createdAt"`
	UpdatedAt time.Time      `json:"updatedAt"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

	// Relaciones
	User User `gorm:"foreignKey:UserID" json:"-"`
}

func (Agent) TableName() string { return "agents" }

func (a *Agent) IsAtomicBot() bool   { return a.BotType == "atomic" }
func (a *Agent) IsOrbitalBot() bool  { return a.BotType == "orbital" }
func (a *Agent) IsTelegramBot() bool { return a.BotType == "telegram" }
func (a *Agent) IsBuilderBot() bool {
	return a.BotType == "builderbot" || a.BotType == "orbital" || a.BotType == ""
}
func (a *Agent) HasOwnServer() bool {
	// Solo OrbitalBot tiene servidor propio por usuario.
	// AtomicBot y TelegramBot usan el servidor compartido global.
	return (a.IsOrbitalBot() || a.BotType == "builderbot") && a.ServerID > 0
}

func (a *Agent) GetEnvVarsForBot() map[string]string {
	envVars := map[string]string{
		"AGENT_ID":     fmt.Sprintf("%d", a.ID),
		"AGENT_NAME":   a.Name,
		"PHONE_NUMBER": a.PhoneNumber,
		"PORT":         fmt.Sprintf("%d", a.Port),
	}
	if a.GoogleConnected {
		if a.GoogleSheetID != "" {
			envVars["SPREADSHEETID"] = a.GoogleSheetID
		}
		if a.GoogleCalendarID != "" {
			envVars["GOOGLE_CALENDAR_ID"] = a.GoogleCalendarID
		}
	}
	if a.MetaConnected {
		if a.MetaAccessToken != "" {
			envVars["META_ACCESS_TOKEN"] = a.MetaAccessToken
		}
		if a.MetaPhoneNumberID != "" {
			envVars["META_PHONE_NUMBER_ID"] = a.MetaPhoneNumberID
		}
		if a.MetaWABAID != "" {
			envVars["META_WABA_ID"] = a.MetaWABAID
		}
	}
	return envVars
}

func (a *Agent) GetGoogleCalendarEmail() string {
	if a.GoogleToken == "" {
		return ""
	}
	var tokenData struct {
		AccessToken  string `json:"access_token"`
		TokenType    string `json:"token_type"`
		RefreshToken string `json:"refresh_token"`
		Expiry       string `json:"expiry"`
	}
	if err := json.Unmarshal([]byte(a.GoogleToken), &tokenData); err != nil {
		return ""
	}
	return a.GoogleCalendarID
}

func (a *Agent) IsMetaTokenExpired() bool {
	if !a.MetaConnected || a.MetaTokenExpiresAt == nil {
		return true
	}
	return time.Now().After(*a.MetaTokenExpiresAt)
}

func (a *Agent) GetMetaTokenDaysRemaining() int {
	if !a.MetaConnected || a.MetaTokenExpiresAt == nil {
		return 0
	}
	duration := time.Until(*a.MetaTokenExpiresAt)
	days := int(duration.Hours() / 24)
	if days < 0 {
		return 0
	}
	return days
}
