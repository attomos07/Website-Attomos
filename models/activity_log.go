package models

// activity_log.go — Bitácora del equipo: quién hizo qué y cuándo (ventas,
// pasos del laboratorio, citas, exámenes, inventario, caja, usuarios,
// inicios de sesión). La llena handlers/activity_log.go y la ve el dueño
// en /bitacora. Todo cae en el negocio del dueño (OwnerID).

import (
	"strings"
	"time"

	"attomos/config"
)

// Tipos de registro.
const (
	ActivityAction  = "accion" // creó, cambió, canceló, eliminó…
	ActivitySession = "sesion" // entró, salió, contraseña equivocada
)

// ActivityLog — un registro de la bitácora.
type ActivityLog struct {
	ID          int64     `gorm:"primaryKey" json:"id"`
	OwnerID     uint      `gorm:"not null;index:idx_actlog_owner_time,priority:1" json:"-"`
	StaffID     uint      `gorm:"not null;default:0;index" json:"staffId"` // 0 = el dueño
	ActorName   string    `gorm:"size:120" json:"actor"`
	ActorRoles  string    `gorm:"size:120" json:"roles"` // "dueno" o "recepcion,optometria"
	Kind        string    `gorm:"size:12;not null" json:"kind"`
	Area        string    `gorm:"size:20" json:"area"` // pos, caja, lab, optometria, citas, inventario, equipo, sesion
	Action      string    `gorm:"size:60" json:"action"`
	Description string    `gorm:"size:500" json:"description"`
	OK          bool      `gorm:"not null" json:"ok"` // sin default: GORM omitiría el false
	Method      string    `gorm:"size:8" json:"method"`
	Path        string    `gorm:"size:255" json:"path"`
	Status      int       `json:"status"`
	IP          string    `gorm:"size:64" json:"ip"`
	CreatedAt   time.Time `gorm:"index:idx_actlog_owner_time,priority:2" json:"createdAt"`
}

func (ActivityLog) TableName() string { return "activity_logs" }

// ActivityModels — para el AutoMigrate de main.go.
func ActivityModels() []interface{} { return []interface{}{&ActivityLog{}} }

func actCut(s string, n int) string {
	r := []rune(strings.TrimSpace(s))
	if len(r) > n {
		return string(r[:n-1]) + "…"
	}
	return string(r)
}

// InsertActivity — guarda un registro (recorta los textos largos).
func InsertActivity(a *ActivityLog) error {
	a.ActorName = actCut(a.ActorName, 120)
	a.ActorRoles = actCut(a.ActorRoles, 120)
	a.Description = actCut(a.Description, 500)
	a.Path = actCut(a.Path, 255)
	a.IP = actCut(a.IP, 64)
	if a.CreatedAt.IsZero() {
		a.CreatedAt = time.Now()
	}
	return config.DB.Create(a).Error
}

// ActivityFilter — filtros de la página Bitácora.
type ActivityFilter struct {
	OwnerID  uint
	Person   string // "" = todos · "dueno" · "staff:12"
	Kind     string // accion | sesion | fallidas
	Area     string
	From, To *time.Time
	Query    string
	BeforeID int64 // "Cargar más"
	AfterID  int64 // en vivo: solo lo nuevo
	Limit    int
}

func (f ActivityFilter) scope() (string, []interface{}) {
	conds := []string{"owner_id = ?"}
	args := []interface{}{f.OwnerID}
	switch {
	case f.Person == "dueno":
		conds = append(conds, "staff_id = 0")
	case strings.HasPrefix(f.Person, "staff:"):
		conds = append(conds, "staff_id = ?")
		args = append(args, strings.TrimPrefix(f.Person, "staff:"))
	}
	if f.From != nil {
		conds = append(conds, "created_at >= ?")
		args = append(args, *f.From)
	}
	if f.To != nil {
		conds = append(conds, "created_at < ?")
		args = append(args, *f.To)
	}
	return strings.Join(conds, " AND "), args
}

func (f ActivityFilter) where() (string, []interface{}) {
	w, args := f.scope()
	switch f.Kind {
	case ActivityAction, ActivitySession:
		w += " AND kind = ?"
		args = append(args, f.Kind)
	case "fallidas":
		w += " AND ok = ?"
		args = append(args, false)
	}
	if f.Area != "" {
		w += " AND area = ?"
		args = append(args, f.Area)
	}
	if q := strings.TrimSpace(f.Query); q != "" {
		like := "%" + strings.ReplaceAll(strings.ReplaceAll(q, "%", ""), "_", "") + "%"
		w += " AND (description LIKE ? OR actor_name LIKE ?)"
		args = append(args, like, like)
	}
	return w, args
}

// ListActivities — lo más nuevo primero.
func ListActivities(f ActivityFilter) ([]ActivityLog, bool, error) {
	if f.Limit <= 0 || f.Limit > 200 {
		f.Limit = 60
	}
	w, args := f.where()
	q := config.DB.Where(w, args...)
	if f.BeforeID > 0 {
		q = q.Where("id < ?", f.BeforeID)
	}
	if f.AfterID > 0 {
		q = q.Where("id > ?", f.AfterID)
	}
	var list []ActivityLog
	if err := q.Order("id DESC").Limit(f.Limit + 1).Find(&list).Error; err != nil {
		return nil, false, err
	}
	more := len(list) > f.Limit
	if more {
		list = list[:f.Limit]
	}
	return list, more, nil
}

// ActivityPersonStats — resumen por persona en el periodo.
type ActivityPersonStats struct {
	Key      string     `json:"key"` // "dueno" o "staff:12"
	StaffID  uint       `json:"staffId"`
	Name     string     `json:"name"`
	Roles    string     `json:"roles"`
	Acciones int64      `json:"acciones"`
	Sesiones int64      `json:"sesiones"`
	Fallidas int64      `json:"fallidas"`
	LastAt   *time.Time `json:"lastAt,omitempty"`
	Active   bool       `json:"active"`
}

// ActivityStatsByPerson — conteos por persona (respeta periodo, no tipo).
func ActivityStatsByPerson(f ActivityFilter) (map[string]*ActivityPersonStats, error) {
	f.Person = ""
	w, args := f.scope()
	type row struct {
		StaffID  uint
		Name     string
		Roles    string
		Acciones int64
		Sesiones int64
		Fallidas int64
		LastAt   *time.Time
	}
	var rows []row
	err := config.DB.Model(&ActivityLog{}).
		Select("staff_id, MAX(actor_name) AS name, MAX(actor_roles) AS roles, "+
			"SUM(CASE WHEN kind = 'accion' THEN 1 ELSE 0 END) AS acciones, "+
			"SUM(CASE WHEN kind = 'sesion' THEN 1 ELSE 0 END) AS sesiones, "+
			"SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS fallidas, MAX(created_at) AS last_at").
		Where(w, args...).Group("staff_id").Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	out := map[string]*ActivityPersonStats{}
	for _, r := range rows {
		k := "dueno"
		if r.StaffID > 0 {
			k = "staff:" + uitoa(r.StaffID)
		}
		out[k] = &ActivityPersonStats{Key: k, StaffID: r.StaffID, Name: r.Name, Roles: r.Roles,
			Acciones: r.Acciones, Sesiones: r.Sesiones, Fallidas: r.Fallidas, LastAt: r.LastAt}
	}
	return out, nil
}

func uitoa(n uint) string {
	if n == 0 {
		return "0"
	}
	s := ""
	for n > 0 {
		s = string(rune('0'+n%10)) + s
		n /= 10
	}
	return s
}

// PurgeOldActivities — borra lo más viejo que days días.
func PurgeOldActivities(days int) {
	if days <= 0 {
		return
	}
	config.DB.Where("created_at < ?", time.Now().AddDate(0, 0, -days)).Delete(&ActivityLog{})
}
