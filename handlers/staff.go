package handlers

// staff.go — Cuentas del equipo (ópticas). Ver models/staff.go.
//
//	GET  /equipo/login            página de entrada del equipo (pública)
//	POST /api/equipo/login        {usuario, password} (pública)
//	GET  /equipo                  Usuarios: el dueño crea las cuentas y sus roles
//	GET  /api/equipo              lista (solo el dueño)
//	POST /api/equipo              alta
//	PUT  /api/equipo/:id          cambios (contraseña opcional)
//	DELETE /api/equipo/:id        baja

import (
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"attomos/auth"
	"attomos/config"
	"attomos/models"

	"github.com/gin-gonic/gin"
)

/* ---------------- entrada del equipo ---------------- */

// StaffLoginPage — GET /equipo/login
func StaffLoginPage(c *gin.Context) {
	c.HTML(http.StatusOK, "staff-login.html", gin.H{"title": "Attomos"})
}

// Freno simple contra adivinar contraseñas: 8 intentos fallidos por
// usuario cada 10 minutos.
var (
	staffFailMu sync.Mutex
	staffFails  = map[string][]time.Time{}
)

func staffTooManyFails(key string) bool {
	staffFailMu.Lock()
	defer staffFailMu.Unlock()
	cut := time.Now().Add(-10 * time.Minute)
	keep := staffFails[key][:0]
	for _, t := range staffFails[key] {
		if t.After(cut) {
			keep = append(keep, t)
		}
	}
	staffFails[key] = keep
	return len(keep) >= 8
}

func staffAddFail(key string) {
	staffFailMu.Lock()
	staffFails[key] = append(staffFails[key], time.Now())
	staffFailMu.Unlock()
}

// StaffLogin — POST /api/equipo/login
func StaffLogin(c *gin.Context) {
	var in struct {
		Usuario  string `json:"usuario"`
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || strings.TrimSpace(in.Usuario) == "" || in.Password == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Escribe tu usuario y tu contraseña."})
		return
	}
	key := models.NormalizeStaffUsername(in.Usuario)
	if staffTooManyFails(key) {
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "Demasiados intentos. Espera unos minutos y vuelve a intentar."})
		return
	}
	s, err := models.FindStaffByUsername(key)
	if err != nil || !s.CheckPassword(in.Password) {
		staffAddFail(key)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Usuario o contraseña incorrectos."})
		return
	}
	if !s.Active {
		c.JSON(http.StatusForbidden, gin.H{"error": "Tu cuenta está desactivada. Pide acceso al dueño del negocio."})
		return
	}
	if len(s.RoleList()) == 0 {
		c.JSON(http.StatusForbidden, gin.H{"error": "Tu cuenta no tiene ningún rol todavía. Pide al dueño que te asigne uno."})
		return
	}
	var owner models.User
	if err := config.DB.Select("id").First(&owner, s.OwnerID).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "El negocio de esta cuenta ya no existe."})
		return
	}
	token, err := auth.GenerateStaffToken(s.OwnerID, s.ID, s.Username)
	if err != nil {
		log.Printf("staff.Login: token: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "No se pudo iniciar sesión. Intenta de nuevo."})
		return
	}
	models.TouchStaffLogin(s.ID)
	c.SetCookie("auth_token", token, 3600*24, "/", "", false, true)
	c.JSON(http.StatusOK, gin.H{"ok": true, "redirect": s.Home(), "name": s.Name})
}

/* ---------------- Usuarios (solo el dueño) ---------------- */

func staffOwnerOnly(c *gin.Context) bool {
	if currentStaff(c) != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "Solo el dueño del negocio administra los usuarios."})
		return false
	}
	return true
}

// StaffPage — GET /equipo
func StaffPage(c *gin.Context) {
	if currentStaff(c) != nil {
		c.Redirect(http.StatusFound, currentStaff(c).Home())
		return
	}
	c.HTML(http.StatusOK, "equipo.html", gin.H{"Optica": invIsOptica(invUserID(c))})
}

type staffJSON struct {
	ID          uint       `json:"id"`
	Name        string     `json:"name"`
	Username    string     `json:"username"`
	Roles       []string   `json:"roles"`
	Active      bool       `json:"active"`
	LastLoginAt *time.Time `json:"lastLoginAt,omitempty"`
	CreatedAt   time.Time  `json:"createdAt"`
}

func toStaffJSON(s *models.StaffUser) staffJSON {
	return staffJSON{ID: s.ID, Name: s.Name, Username: s.Username, Roles: s.RoleList(), Active: s.Active, LastLoginAt: s.LastLoginAt, CreatedAt: s.CreatedAt}
}

// StaffList — GET /api/equipo
func StaffList(c *gin.Context) {
	if !staffOwnerOnly(c) {
		return
	}
	list, err := models.ListStaff(invUserID(c))
	if err != nil {
		log.Printf("staff.List: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "No se pudieron cargar los usuarios."})
		return
	}
	out := make([]staffJSON, 0, len(list))
	for i := range list {
		out = append(out, toStaffJSON(&list[i]))
	}
	c.JSON(http.StatusOK, gin.H{"usuarios": out, "roles": models.StaffRoles})
}

type staffInput struct {
	Name     string   `json:"name"`
	Username string   `json:"username"`
	Password string   `json:"password"`
	Roles    []string `json:"roles"`
	Active   *bool    `json:"active"`
}

func staffInputError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, models.ErrStaffUsername):
		c.JSON(http.StatusConflict, gin.H{"error": "Ese usuario ya existe: elige otro."})
	case errors.Is(err, models.ErrStaffBadInput):
		c.JSON(http.StatusBadRequest, gin.H{"error": "Revisa los datos: nombre, usuario (3 a 40 letras o números, sin espacios), contraseña de al menos 6 caracteres y al menos un rol."})
	case errors.Is(err, models.ErrStaffNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "Ese usuario ya no existe."})
	default:
		log.Printf("staff: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "No se pudo guardar. Intenta de nuevo."})
	}
}

// StaffCreate — POST /api/equipo
func StaffCreate(c *gin.Context) {
	if !staffOwnerOnly(c) {
		return
	}
	var in staffInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos inválidos."})
		return
	}
	s, err := models.CreateStaff(invUserID(c), in.Name, in.Username, in.Password, in.Roles)
	if err != nil {
		staffInputError(c, err)
		return
	}
	c.JSON(http.StatusCreated, toStaffJSON(s))
}

// StaffUpdate — PUT /api/equipo/:id
func StaffUpdate(c *gin.Context) {
	if !staffOwnerOnly(c) {
		return
	}
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Dato inválido."})
		return
	}
	var in staffInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos inválidos."})
		return
	}
	active := true
	if in.Active != nil {
		active = *in.Active
	}
	s, err := models.UpdateStaff(invUserID(c), uint(id), in.Name, in.Username, in.Password, in.Roles, active)
	if err != nil {
		staffInputError(c, err)
		return
	}
	c.JSON(http.StatusOK, toStaffJSON(s))
}

// StaffDelete — DELETE /api/equipo/:id
func StaffDelete(c *gin.Context) {
	if !staffOwnerOnly(c) {
		return
	}
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Dato inválido."})
		return
	}
	if err := models.DeleteStaff(invUserID(c), uint(id)); err != nil {
		staffInputError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
