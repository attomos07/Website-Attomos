package models

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"
)

// ============================================================
// AgencySocialMedia — incluye YouTube además de las redes base
// ============================================================

type AgencySocialMedia struct {
	Facebook  string `json:"facebook"`
	Instagram string `json:"instagram"`
	Twitter   string `json:"twitter"`
	YouTube   string `json:"youtube"`
	LinkedIn  string `json:"linkedin"`
}

func (a AgencySocialMedia) Value() (driver.Value, error) { return json.Marshal(a) }
func (a *AgencySocialMedia) Scan(v interface{}) error {
	if b, ok := v.([]byte); ok {
		return json.Unmarshal(b, a)
	}
	return nil
}

// ============================================================
// AgencyLocation — igual que BusinessLocation + MapsLink
// ============================================================

type AgencyLocation struct {
	Address  string `json:"address"`
	City     string `json:"city"`
	State    string `json:"state"`
	Country  string `json:"country"`
	MapsLink string `json:"mapsLink"`
}

func (a AgencyLocation) Value() (driver.Value, error) { return json.Marshal(a) }
func (a *AgencyLocation) Scan(v interface{}) error {
	if b, ok := v.([]byte); ok {
		return json.Unmarshal(b, a)
	}
	return nil
}

// ============================================================
// AgencyCurso — curso/taller con cupos
// ============================================================

type AgencyCurso struct {
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Disponible  bool     `json:"disponible"` // true = con cupos, false = agotado
	Cupos       string   `json:"cupos"`      // número de lugares restantes (string para permitir "")
	Modalidad   string   `json:"modalidad"`  // "presencial" | "en-linea" | "hibrido"
	FechaInicio string   `json:"fechaInicio"`
	FechaFin    string   `json:"fechaFin"`
	ImageUrls   []string `json:"imageUrls"`
}

type AgencyCursos []AgencyCurso

func (ac AgencyCursos) Value() (driver.Value, error) { return json.Marshal(ac) }
func (ac *AgencyCursos) Scan(v interface{}) error {
	if b, ok := v.([]byte); ok {
		return json.Unmarshal(b, ac)
	}
	return nil
}

// ============================================================
// MyAgencyInfo — oficina/módulo de una dependencia gubernamental
// Un usuario puede tener múltiples oficinas (one-to-many).
// ============================================================

type MyAgencyInfo struct {
	ID           uint   `gorm:"primaryKey" json:"id"`
	UserID       uint   `gorm:"not null;index" json:"userId"`
	OfficeNumber int    `gorm:"default:1" json:"officeNumber"`
	OfficeName   string `gorm:"size:255" json:"officeName"`

	// Datos institucionales
	DepName    string `gorm:"size:255" json:"depName"`   // Nombre oficial completo
	DepAcronym string `gorm:"size:50" json:"depAcronym"` // Siglas: SEP, IMSS, etc.
	DepArea    string `gorm:"size:255" json:"depArea"`   // Área / Departamento
	DepParent  string `gorm:"size:255" json:"depParent"` // Dependencia madre
	GovLevel   string `gorm:"size:50" json:"govLevel"`   // federal | estatal | municipal | autonomo
	RFC        string `gorm:"size:20" json:"rfc"`

	Description string `gorm:"type:text" json:"description"`
	Website     string `gorm:"size:500" json:"website"`
	Email       string `gorm:"size:255" json:"email"`
	PhoneNumber string `gorm:"size:50" json:"phoneNumber"`

	Location    AgencyLocation    `gorm:"type:json" json:"location"`
	SocialMedia AgencySocialMedia `gorm:"type:json" json:"socialMedia"`
	Schedule    BusinessSchedule  `gorm:"type:json" json:"schedule"` // reutiliza el mismo tipo
	Holidays    BusinessHolidays  `gorm:"type:json" json:"holidays"` // reutiliza el mismo tipo
	Cursos      AgencyCursos      `gorm:"type:json" json:"cursos"`

	// Imágenes institucionales
	LogoURL   string `gorm:"size:500" json:"logoUrl"`   // Escudo / logotipo
	BannerURL string `gorm:"size:500" json:"bannerUrl"` // Banner de portada

	CreatedAt time.Time      `json:"createdAt"`
	UpdatedAt time.Time      `json:"updatedAt"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

	User User `gorm:"foreignKey:UserID" json:"-"`
}

func (MyAgencyInfo) TableName() string { return "my_agency_info" }

func (a *MyAgencyInfo) GenerateOfficeName() string {
	addr := strings.TrimSpace(a.Location.Address)
	if addr != "" {
		return "Oficina " + addr
	}
	return fmt.Sprintf("Oficina %d", a.OfficeNumber)
}

func (a *MyAgencyInfo) UpdateOfficeName() {
	a.OfficeName = a.GenerateOfficeName()
}

// ============================================================
// AgencyInscription — inscripción de un ciudadano a un curso
// ============================================================

type AgencyInscription struct {
	ID        uint   `gorm:"primaryKey" json:"id"`
	AgentID   uint   `gorm:"index" json:"agentId"`
	UserID    uint   `gorm:"index" json:"userId"`
	Nombre    string `gorm:"size:255" json:"nombre"`
	Telefono  string `gorm:"size:50" json:"telefono"`
	Email     string `gorm:"size:255" json:"email"`
	Curso     string `gorm:"size:255" json:"curso"`
	Sede      string `gorm:"size:255" json:"sede"`
	Modalidad string `gorm:"size:50" json:"modalidad"`
	Fecha     string `gorm:"size:50" json:"fecha"`
	Estado    string `gorm:"size:50;default:confirmado" json:"estado"`

	CreatedAt time.Time      `json:"createdAt"`
	UpdatedAt time.Time      `json:"updatedAt"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

func (AgencyInscription) TableName() string { return "agency_inscriptions" }
