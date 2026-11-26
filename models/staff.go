package models

// staff.go — Cuentas del equipo (ópticas): el dueño crea usuarios con
// contraseña y uno o varios roles (Recepción, Optometría, Laboratorio,
// Inventario). Entran por /equipo/login, ven solo su parte del sidebar y
// lo que hacen queda a su nombre (ventas, exámenes, órdenes, pasos del
// laboratorio, movimientos de inventario…). Todo cae en el negocio del
// dueño (OwnerID).

import (
	"errors"
	"regexp"
	"sort"
	"strings"
	"time"

	"attomos/config"

	"golang.org/x/crypto/bcrypt"
)

// Roles del equipo.
const (
	StaffRoleRecepcion   = "recepcion"
	StaffRoleOptometria  = "optometria"
	StaffRoleLaboratorio = "laboratorio"
	StaffRoleInventario  = "inventario"
)

// StaffRoleInfo — un rol con su nombre y su página de inicio.
type StaffRoleInfo struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Home  string `json:"home"`
}

// StaffRoles — en el orden del sidebar.
var StaffRoles = []StaffRoleInfo{
	{StaffRoleRecepcion, "Recepción", "/pos/punto-de-venta"},
	{StaffRoleOptometria, "Optometría", "/optometria/examen-vista"},
	{StaffRoleLaboratorio, "Laboratorio", "/laboratorio"},
	{StaffRoleInventario, "Inventario", "/inventory/articulos"},
}

func IsStaffRole(k string) bool {
	for _, r := range StaffRoles {
		if r.Key == k {
			return true
		}
	}
	return false
}

// StaffUser — una cuenta del equipo.
type StaffUser struct {
	ID          uint       `gorm:"primaryKey" json:"id"`
	OwnerID     uint       `gorm:"not null;index" json:"-"`
	Name        string     `gorm:"size:120;not null" json:"name"`
	Username    string     `gorm:"size:60;not null;uniqueIndex" json:"username"`
	Password    string     `gorm:"size:255;not null" json:"-"`
	Roles       string     `gorm:"size:120;not null;default:''" json:"-"` // "recepcion,optometria"
	Active      bool       `gorm:"not null;default:true" json:"active"`
	LastLoginAt *time.Time `json:"lastLoginAt,omitempty"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
}

func (StaffUser) TableName() string { return "staff_users" }

// StaffModels — para el AutoMigrate de main.go.
func StaffModels() []interface{} { return []interface{}{&StaffUser{}} }

// RoleList — los roles de la cuenta, en el orden del sidebar.
func (s *StaffUser) RoleList() []string {
	have := map[string]bool{}
	for _, r := range strings.Split(s.Roles, ",") {
		have[strings.TrimSpace(r)] = true
	}
	out := []string{}
	for _, r := range StaffRoles {
		if have[r.Key] {
			out = append(out, r.Key)
		}
	}
	return out
}

func (s *StaffUser) HasRole(role string) bool {
	for _, r := range s.RoleList() {
		if r == role {
			return true
		}
	}
	return false
}

// Home — la primera página de su primer rol.
func (s *StaffUser) Home() string {
	for _, r := range StaffRoles {
		if s.HasRole(r.Key) {
			return r.Home
		}
	}
	return "/equipo/login"
}

func (s *StaffUser) SetPassword(pw string) error {
	h, err := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	s.Password = string(h)
	return nil
}

func (s *StaffUser) CheckPassword(pw string) bool {
	return bcrypt.CompareHashAndPassword([]byte(s.Password), []byte(pw)) == nil
}

/* ---------------- permisos por rol ---------------- */

type staffRule struct {
	prefix  string
	getOnly bool
	// contains: además del prefijo, la ruta debe incluir esto (p. ej. el CRM
	// de un agente: /api/agents/:id/crm/... sin abrir el resto de /api/agents).
	contains string
}

// Lo que cada rol puede abrir (páginas y API). Lo demás (Dashboard, Mi
// Negocio, agentes, facturación, Usuarios…) es solo del dueño.
var staffRoleRules = map[string][]staffRule{
	StaffRoleRecepcion: {
		{"/pos", false, ""}, {"/appointments", false, ""},
		{"/api/pos", false, ""}, {"/api/caja", false, ""}, {"/api/citas", false, ""}, {"/api/appointments", true, ""},
		// CRM (en Recepción): la página, la lista de agentes (solo lectura) y
		// la conversación en vivo de cada agente (stream, enviar, tomar control).
		{"/crm", true, ""}, {"/api/agents", true, ""}, {"/api/agents", false, "/crm/"},
	},
	StaffRoleOptometria: {
		{"/optometria", false, ""},
		{"/api/optometria", false, ""}, {"/api/appointments", true, ""}, {"/api/citas", true, ""},
	},
	StaffRoleLaboratorio: {
		{"/laboratorio", false, ""},
		{"/api/laboratorio", false, ""},
	},
	StaffRoleInventario: {
		{"/inventory", false, ""},
		{"/api/inventario", false, ""},
	},
}

// Lo que cualquier cuenta del equipo necesita (sidebar, barra de arriba,
// tiempo real, cerrar sesión).
var staffCommonRules = []staffRule{
	{"/api/me", true, ""}, {"/api/my-business", true, ""}, {"/api/chatwoot/info", true, ""},
	{"/api/live", true, ""}, {"/api/logout", false, ""},
}

func ruleMatch(r staffRule, method, path string) bool {
	if r.getOnly && method != "GET" && method != "HEAD" {
		return false
	}
	if r.contains != "" && !strings.Contains(path, r.contains) {
		return false
	}
	return path == r.prefix || strings.HasPrefix(path, r.prefix+"/") || strings.HasPrefix(path, r.prefix+"?")
}

// StaffCanAccess — ¿esta cuenta puede abrir esa ruta?
func (s *StaffUser) StaffCanAccess(method, path string) bool {
	for _, r := range staffCommonRules {
		if ruleMatch(r, method, path) {
			return true
		}
	}
	for _, role := range s.RoleList() {
		for _, r := range staffRoleRules[role] {
			if ruleMatch(r, method, path) {
				return true
			}
		}
	}
	return false
}

/* ---------------- altas, cambios, bajas ---------------- */

var (
	ErrStaffNotFound   = errors.New("usuario no encontrado")
	ErrStaffUsername   = errors.New("ese usuario ya existe: elige otro")
	ErrStaffBadInput   = errors.New("datos inválidos")
	staffUsernameRegex = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{2,39}$`)
)

// NormalizeStaffUsername — minúsculas, sin espacios.
func NormalizeStaffUsername(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

// ValidStaffUsername — 3 a 40: letras, números, punto, guion y guion bajo.
func ValidStaffUsername(s string) bool { return staffUsernameRegex.MatchString(s) }

// CleanStaffRoles — solo roles válidos, sin repetir, en orden.
func CleanStaffRoles(in []string) string {
	have := map[string]bool{}
	for _, r := range in {
		if IsStaffRole(strings.TrimSpace(r)) {
			have[strings.TrimSpace(r)] = true
		}
	}
	keys := []string{}
	for _, r := range StaffRoles {
		if have[r.Key] {
			keys = append(keys, r.Key)
		}
	}
	return strings.Join(keys, ",")
}

// ListStaff — las cuentas del negocio, por nombre.
func ListStaff(ownerID uint) ([]StaffUser, error) {
	var list []StaffUser
	err := config.DB.Where("owner_id = ?", ownerID).Find(&list).Error
	sort.SliceStable(list, func(i, j int) bool { return strings.ToLower(list[i].Name) < strings.ToLower(list[j].Name) })
	return list, err
}

// GetStaff — una cuenta del negocio.
func GetStaff(ownerID, id uint) (*StaffUser, error) {
	var s StaffUser
	if err := config.DB.Where("id = ? AND owner_id = ?", id, ownerID).First(&s).Error; err != nil {
		return nil, ErrStaffNotFound
	}
	return &s, nil
}

// GetActiveStaff — para el middleware: la cuenta existe, es de ese dueño y
// está activa.
func GetActiveStaff(ownerID, id uint) (*StaffUser, error) {
	var s StaffUser
	if err := config.DB.Where("id = ? AND owner_id = ? AND active = ?", id, ownerID, true).First(&s).Error; err != nil {
		return nil, ErrStaffNotFound
	}
	return &s, nil
}

// FindStaffByUsername — para el login.
func FindStaffByUsername(username string) (*StaffUser, error) {
	var s StaffUser
	if err := config.DB.Where("username = ?", NormalizeStaffUsername(username)).First(&s).Error; err != nil {
		return nil, ErrStaffNotFound
	}
	return &s, nil
}

func staffUsernameTaken(username string, exceptID uint) bool {
	var n int64
	config.DB.Model(&StaffUser{}).Where("username = ? AND id <> ?", username, exceptID).Count(&n)
	if n > 0 {
		return true
	}
	// Tampoco puede ser el correo de una cuenta de dueño.
	config.DB.Model(&User{}).Where("email = ?", username).Count(&n)
	return n > 0
}

// CreateStaff — alta de una cuenta.
func CreateStaff(ownerID uint, name, username, password string, roles []string) (*StaffUser, error) {
	username = NormalizeStaffUsername(username)
	name = strings.TrimSpace(name)
	r := CleanStaffRoles(roles)
	if name == "" || !ValidStaffUsername(username) || len(password) < 6 || r == "" {
		return nil, ErrStaffBadInput
	}
	if staffUsernameTaken(username, 0) {
		return nil, ErrStaffUsername
	}
	s := StaffUser{OwnerID: ownerID, Name: cut(name, 120), Username: username, Roles: r, Active: true}
	if err := s.SetPassword(password); err != nil {
		return nil, err
	}
	if err := config.DB.Create(&s).Error; err != nil {
		if strings.Contains(err.Error(), "1062") || strings.Contains(strings.ToLower(err.Error()), "duplicate") {
			return nil, ErrStaffUsername
		}
		return nil, err
	}
	return &s, nil
}

// UpdateStaff — cambia nombre, usuario, roles, activo y (si viene) la contraseña.
func UpdateStaff(ownerID, id uint, name, username, password string, roles []string, active bool) (*StaffUser, error) {
	s, err := GetStaff(ownerID, id)
	if err != nil {
		return nil, err
	}
	username = NormalizeStaffUsername(username)
	name = strings.TrimSpace(name)
	r := CleanStaffRoles(roles)
	if name == "" || !ValidStaffUsername(username) || r == "" || (password != "" && len(password) < 6) {
		return nil, ErrStaffBadInput
	}
	if username != s.Username && staffUsernameTaken(username, s.ID) {
		return nil, ErrStaffUsername
	}
	upd := map[string]interface{}{"name": cut(name, 120), "username": username, "roles": r, "active": active, "updated_at": time.Now()}
	if password != "" {
		if err := s.SetPassword(password); err != nil {
			return nil, err
		}
		upd["password"] = s.Password
	}
	if err := config.DB.Model(&StaffUser{}).Where("id = ? AND owner_id = ?", id, ownerID).Updates(upd).Error; err != nil {
		return nil, err
	}
	return GetStaff(ownerID, id)
}

// DeleteStaff — baja definitiva (lo que hizo sigue registrado con su nombre).
func DeleteStaff(ownerID, id uint) error {
	res := config.DB.Where("id = ? AND owner_id = ?", id, ownerID).Delete(&StaffUser{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrStaffNotFound
	}
	return nil
}

// TouchStaffLogin — guarda cuándo entró.
func TouchStaffLogin(id uint) {
	now := time.Now()
	config.DB.Model(&StaffUser{}).Where("id = ?", id).Update("last_login_at", &now)
}
