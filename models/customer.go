package models

// customer.go — Clientes del negocio con cuenta (como en Avante): se
// registran desde la página pública del negocio (/n/:slug) para ver,
// reagendar o cancelar sus citas sin llamar. Cada negocio tiene sus propios
// clientes (el mismo correo puede tener cuenta en dos negocios distintos).
//
// BusinessSlug — la dirección pública del negocio: attomos.com/n/<slug>.
// Se arma con el nombre del negocio la primera vez que se pide y ya no
// cambia (las ligas compartidas siguen sirviendo aunque cambie el nombre).

import (
	"errors"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"

	"attomos/config"

	"golang.org/x/crypto/bcrypt"
	"golang.org/x/text/unicode/norm"
)

// Customer — cuenta de un cliente en UN negocio.
type Customer struct {
	ID              uint       `gorm:"primaryKey" json:"id"`
	OwnerID         uint       `gorm:"not null;uniqueIndex:idx_customer_owner_email,priority:1" json:"-"`
	Nombre          string     `gorm:"size:120;not null" json:"nombre"`
	Apellido        string     `gorm:"size:120" json:"apellido"`
	Celular         string     `gorm:"size:20" json:"celular"` // "+52XXXXXXXXXX"
	Correo          string     `gorm:"size:200;not null;uniqueIndex:idx_customer_owner_email,priority:2" json:"correo"`
	FechaNacimiento string     `gorm:"size:10" json:"fechaNacimiento"` // "AAAA-MM-DD" o ""
	Password        string     `gorm:"size:100;not null" json:"-"`
	LastLoginAt     *time.Time `json:"-"`
	CreatedAt       time.Time  `json:"createdAt"`
	UpdatedAt       time.Time  `json:"-"`
}

func (Customer) TableName() string { return "business_customers" }

// BusinessSlug — /n/<slug> → negocio.
type BusinessSlug struct {
	OwnerID   uint   `gorm:"primaryKey;autoIncrement:false"`
	Slug      string `gorm:"size:80;not null;uniqueIndex"`
	CreatedAt time.Time
}

func (BusinessSlug) TableName() string { return "business_slugs" }

// CustomerModels — para el AutoMigrate de main.go.
func CustomerModels() []interface{} { return []interface{}{&Customer{}, &BusinessSlug{}} }

var ErrCustomerExists = errors.New("customer exists")

func (c *Customer) SetPassword(pw string) error {
	h, err := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	c.Password = string(h)
	return nil
}

func (c *Customer) CheckPassword(pw string) bool {
	return bcrypt.CompareHashAndPassword([]byte(c.Password), []byte(pw)) == nil
}

// CreateCustomer — da de alta (el correo no puede repetirse en el negocio).
func CreateCustomer(c *Customer) error {
	c.Correo = strings.ToLower(strings.TrimSpace(c.Correo))
	var n int64
	config.DB.Model(&Customer{}).Where("owner_id = ? AND correo = ?", c.OwnerID, c.Correo).Count(&n)
	if n > 0 {
		return ErrCustomerExists
	}
	return config.DB.Create(c).Error
}

func GetCustomerByEmail(owner uint, correo string) (*Customer, error) {
	var c Customer
	err := config.DB.Where("owner_id = ? AND correo = ?", owner, strings.ToLower(strings.TrimSpace(correo))).First(&c).Error
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func GetCustomer(owner, id uint) (*Customer, error) {
	var c Customer
	if err := config.DB.Where("owner_id = ? AND id = ?", owner, id).First(&c).Error; err != nil {
		return nil, err
	}
	return &c, nil
}

func TouchCustomerLogin(c *Customer) {
	now := time.Now()
	c.LastLoginAt = &now
	config.DB.Model(c).UpdateColumn("last_login_at", now)
}

/* ---------------- slug ---------------- */

var slugJunk = regexp.MustCompile(`[^a-z0-9]+`)

// Slugify — "Óptica Visión Clara" → "optica-vision-clara".
func Slugify(s string) string {
	var b strings.Builder
	for _, r := range norm.NFD.String(strings.ToLower(s)) {
		if unicode.Is(unicode.Mn, r) { // acentos
			continue
		}
		if r == 'ñ' {
			r = 'n'
		}
		b.WriteRune(r)
	}
	out := strings.Trim(slugJunk.ReplaceAllString(b.String(), "-"), "-")
	if len(out) > 60 {
		out = strings.Trim(out[:60], "-")
	}
	return out
}

// reservedSlugs — no chocan con rutas propias de /n/.
var reservedSlugs = map[string]bool{"api": true, "static": true, "admin": true, "attomos": true}

// EnsureBusinessSlug — el slug del negocio; lo crea con el nombre si no
// tiene (si ya existe otro igual le agrega -2, -3…).
func EnsureBusinessSlug(owner uint, name string) string {
	var s BusinessSlug
	if config.DB.Where("owner_id = ?", owner).First(&s).Error == nil {
		return s.Slug
	}
	base := Slugify(name)
	if base == "" || reservedSlugs[base] {
		base = "negocio-" + strconv.FormatUint(uint64(owner), 10)
	}
	for i := 1; i < 200; i++ {
		cand := base
		if i > 1 {
			cand = base + "-" + strconv.Itoa(i)
		}
		var n int64
		config.DB.Model(&BusinessSlug{}).Where("slug = ?", cand).Count(&n)
		if n > 0 {
			continue
		}
		s = BusinessSlug{OwnerID: owner, Slug: cand}
		if err := config.DB.Create(&s).Error; err == nil {
			return cand
		}
		// Otro proceso lo creó al mismo tiempo: si es el de este negocio, listo.
		if config.DB.Where("owner_id = ?", owner).First(&s).Error == nil {
			return s.Slug
		}
	}
	return ""
}

// OwnerBySlug — el negocio de /n/<slug> (0 si no existe).
func OwnerBySlug(slug string) uint {
	var s BusinessSlug
	if err := config.DB.Where("slug = ?", strings.ToLower(strings.TrimSpace(slug))).First(&s).Error; err != nil {
		return 0
	}
	return s.OwnerID
}
