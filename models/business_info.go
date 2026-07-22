package models

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"
)

type BusinessSchedule struct {
	Monday    DaySchedule `json:"monday"`
	Tuesday   DaySchedule `json:"tuesday"`
	Wednesday DaySchedule `json:"wednesday"`
	Thursday  DaySchedule `json:"thursday"`
	Friday    DaySchedule `json:"friday"`
	Saturday  DaySchedule `json:"saturday"`
	Sunday    DaySchedule `json:"sunday"`
	Timezone  string      `json:"timezone"`
}

func (bs BusinessSchedule) Value() (driver.Value, error) { return json.Marshal(bs) }
func (bs *BusinessSchedule) Scan(v interface{}) error {
	if b, ok := v.([]byte); ok {
		return json.Unmarshal(b, bs)
	}
	return nil
}

type BusinessHolidays []Holiday

func (bh BusinessHolidays) Value() (driver.Value, error) { return json.Marshal(bh) }
func (bh *BusinessHolidays) Scan(v interface{}) error {
	if b, ok := v.([]byte); ok {
		return json.Unmarshal(b, bh)
	}
	return nil
}

type BusinessSocialMedia struct {
	Facebook  string `json:"facebook"`
	Instagram string `json:"instagram"`
	Twitter   string `json:"twitter"`
	LinkedIn  string `json:"linkedin"`
}

func (bsm BusinessSocialMedia) Value() (driver.Value, error) { return json.Marshal(bsm) }
func (bsm *BusinessSocialMedia) Scan(v interface{}) error {
	if b, ok := v.([]byte); ok {
		return json.Unmarshal(b, bsm)
	}
	return nil
}

type BusinessLocation struct {
	Address        string `json:"address"`
	BetweenStreets string `json:"betweenStreets"`
	Number         string `json:"number"`
	Neighborhood   string `json:"neighborhood"`
	City           string `json:"city"`
	State          string `json:"state"`
	Country        string `json:"country"`
	PostalCode     string `json:"postalCode"`
}

func (bl BusinessLocation) Value() (driver.Value, error) { return json.Marshal(bl) }
func (bl *BusinessLocation) Scan(v interface{}) error {
	if b, ok := v.([]byte); ok {
		return json.Unmarshal(b, bl)
	}
	return nil
}

// BranchService representa un servicio/producto de la sucursal.
// ImageURL almacena la ruta relativa a /static/uploads/services/{userID}/{file}
// PromoPeriodType: "days" | "range" — tipo de periodo de promoción
// PromoDays: días de la semana activos, e.g. ["lunes","miércoles","viernes"]
// PromoDateStart / PromoDateEnd: rango de fechas de la promo (ISO 8601)
type BranchService struct {
	Title           string   `json:"title"`
	Description     string   `json:"description"`
	PriceType       string   `json:"priceType"`
	Price           float64  `json:"price"`
	OriginalPrice   float64  `json:"originalPrice"`
	PromoPrice      float64  `json:"promoPrice"`
	ImageURL        string   `json:"imageUrl"`        // compatibilidad legada (1 foto)
	ImageUrls       []string `json:"imageUrls"`       // multi-foto (onboarding/my-business)
	PromoPeriodType string   `json:"promoPeriodType"` // "days" | "range" | ""
	PromoDays       []string `json:"promoDays"`       // ["lunes","martes",...] cuando type="days"
	PromoDateStart  string   `json:"promoDateStart"`  // "2025-01-15" cuando type="range"
	PromoDateEnd    string   `json:"promoDateEnd"`    // "2025-02-28" cuando type="range"
	InStock         bool     `json:"inStock"`         // true = en existencia, false = agotado
	StockQty        *int     `json:"stockQty"`        // nil = sin control de inventario; 0+ = unidades

	// FromSheetRow: 0 si el producto se agregó a mano en Mi Negocio; > 0 si
	// viene sincronizado del inventario de Sheets (fila real de la hoja).
	// La sincronización de inventario SOLO toca/reemplaza los productos con
	// este campo > 0 — los agregados a mano nunca se tocan.
	FromSheetRow int `json:"fromSheetRow,omitempty"`
}

type BranchServices []BranchService

func (bs BranchServices) Value() (driver.Value, error) { return json.Marshal(bs) }
func (bs *BranchServices) Scan(v interface{}) error {
	if b, ok := v.([]byte); ok {
		return json.Unmarshal(b, bs)
	}
	return nil
}

type BranchWorker struct {
	Name      string   `json:"name"`
	StartTime string   `json:"startTime"`
	EndTime   string   `json:"endTime"`
	Days      []string `json:"days"`
}

type BranchWorkers []BranchWorker

func (bw BranchWorkers) Value() (driver.Value, error) { return json.Marshal(bw) }
func (bw *BranchWorkers) Scan(v interface{}) error {
	if b, ok := v.([]byte); ok {
		return json.Unmarshal(b, bw)
	}
	return nil
}

// MyBusinessInfo representa una sucursal del negocio del usuario.
// Un usuario puede tener múltiples sucursales (one-to-many).
type MyBusinessInfo struct {
	ID           uint   `gorm:"primaryKey" json:"id"`
	UserID       uint   `gorm:"not null;index" json:"userId"`
	BranchNumber int    `gorm:"default:1" json:"branchNumber"`
	BranchName   string `gorm:"size:255" json:"branchName"`

	BusinessName string `gorm:"size:255" json:"businessName"`
	BusinessType string `gorm:"size:100" json:"businessType"`
	BusinessSize string `gorm:"size:50" json:"businessSize"`

	Description string `gorm:"type:text" json:"description"`
	Website     string `gorm:"size:500" json:"website"`
	Email       string `gorm:"size:255" json:"email"`
	PhoneNumber string `gorm:"size:50" json:"phoneNumber"`

	Location    BusinessLocation    `gorm:"type:json" json:"location"`
	SocialMedia BusinessSocialMedia `gorm:"type:json" json:"socialMedia"`
	Schedule    BusinessSchedule    `gorm:"type:json" json:"schedule"`
	Holidays    BusinessHolidays    `gorm:"type:json" json:"holidays"`
	Services    BranchServices      `gorm:"type:json" json:"services"`
	Workers     BranchWorkers       `gorm:"type:json" json:"workers"`

	// Imágenes de marca (subidas vía /api/upload/service-image)
	LogoURL   string `gorm:"size:500" json:"logoUrl"`   // Logotipo cuadrado
	BannerURL string `gorm:"size:500" json:"bannerUrl"` // Banner/portada horizontal
	MenuURL   string `gorm:"size:500" json:"menuUrl"`   // Menú (PDF o imagen)

	CreatedAt time.Time      `json:"createdAt"`
	UpdatedAt time.Time      `json:"updatedAt"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

	User User `gorm:"foreignKey:UserID" json:"-"`
}

func (MyBusinessInfo) TableName() string { return "my_business_info" }

func (b *MyBusinessInfo) GenerateBranchName() string {
	addr := strings.TrimSpace(b.Location.Address)
	if addr != "" {
		return "Sucursal " + addr
	}
	return fmt.Sprintf("Sucursal %d", b.BranchNumber)
}

func (b *MyBusinessInfo) UpdateBranchName() {
	b.BranchName = b.GenerateBranchName()
}
