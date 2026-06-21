package models

import (
	"time"

	"gorm.io/gorm"
)

// AppointmentSource indica el origen de la cita
type AppointmentSource string

const (
	AppointmentSourceManual AppointmentSource = "manual" // Creada desde el panel
	AppointmentSourceSheets AppointmentSource = "sheets" // Sincronizada desde Google Sheets
	AppointmentSourceAgent  AppointmentSource = "agent"  // Creada por el agente de WhatsApp
)

// AppointmentStatus indica el estado de la cita
type AppointmentStatus string

const (
	AppointmentStatusPending   AppointmentStatus = "pending"
	AppointmentStatusConfirmed AppointmentStatus = "confirmed"
	AppointmentStatusCompleted AppointmentStatus = "completed"
	AppointmentStatusCancelled AppointmentStatus = "cancelled"
)

type Appointment struct {
	ID      uint `gorm:"primaryKey" json:"id"`
	UserID  uint `gorm:"not null;index" json:"userId"`
	AgentID uint `gorm:"index" json:"agentId"` // Agente que gestionó/creó la cita (puede ser 0 si es manual)

	// =============================================
	// INFORMACIÓN DEL CLIENTE
	// =============================================
	ClientFirstName string `gorm:"size:255;not null" json:"clientFirstName"`
	ClientLastName  string `gorm:"size:255;not null" json:"clientLastName"`
	ClientPhone     string `gorm:"size:50" json:"clientPhone"`

	// =============================================
	// DETALLES DE LA CITA
	// =============================================
	Service string    `gorm:"size:255" json:"service"`    // Servicio solicitado
	Worker  string    `gorm:"size:255" json:"worker"`     // Trabajador/Especialista asignado
	Date    time.Time `gorm:"not null;index" json:"date"` // Fecha y hora de la cita
	Notes   string    `gorm:"type:text" json:"notes"`     // Notas adicionales

	// =============================================
	// ESTADO Y ORIGEN
	// =============================================
	Status AppointmentStatus `gorm:"size:50;default:'pending';index" json:"status"`
	Source AppointmentSource `gorm:"size:50;default:'manual';index" json:"source"`

	// =============================================
	// SINCRONIZACIÓN CON GOOGLE SHEETS
	// =============================================
	// Fila de la hoja de cálculo (para actualizaciones bidireccionales)
	SheetRowIndex int `gorm:"default:0" json:"sheetRowIndex"`
	// ID único de la fila en Sheets (para detectar duplicados)
	SheetRowID string `gorm:"size:255;index" json:"sheetRowId"`
	// ID de la hoja de cálculo de donde proviene
	SheetID string `gorm:"size:500" json:"sheetId"`
	// Última vez que se sincronizó con Sheets
	LastSyncedAt *time.Time `json:"lastSyncedAt"`

	// =============================================
	// SINCRONIZACIÓN CON GOOGLE CALENDAR
	// =============================================
	CalendarEventID string `gorm:"size:500" json:"calendarEventId"` // ID del evento en Google Calendar

	// =============================================
	// TIMESTAMPS
	// =============================================
	CreatedAt time.Time      `json:"createdAt"`
	UpdatedAt time.Time      `json:"updatedAt"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

	// =============================================
	// RELACIONES
	// =============================================
	User  User  `gorm:"foreignKey:UserID" json:"-"`
	Agent Agent `gorm:"foreignKey:AgentID" json:"-"`
}

func (Appointment) TableName() string {
	return "appointments"
}

// GetClientFullName retorna el nombre completo del cliente
func (a *Appointment) GetClientFullName() string {
	return a.ClientFirstName + " " + a.ClientLastName
}

// IsFromSheets verifica si la cita proviene de Google Sheets
func (a *Appointment) IsFromSheets() bool {
	return a.Source == AppointmentSourceSheets
}

// IsFromAgent verifica si la cita fue creada por un agente
func (a *Appointment) IsFromAgent() bool {
	return a.Source == AppointmentSourceAgent
}

// IsManual verifica si la cita fue creada manualmente desde el panel
func (a *Appointment) IsManual() bool {
	return a.Source == AppointmentSourceManual
}

// IsPending verifica si la cita está pendiente
func (a *Appointment) IsPending() bool {
	return a.Status == AppointmentStatusPending
}

// IsConfirmed verifica si la cita está confirmada
func (a *Appointment) IsConfirmed() bool {
	return a.Status == AppointmentStatusConfirmed
}

// IsCompleted verifica si la cita fue completada
func (a *Appointment) IsCompleted() bool {
	return a.Status == AppointmentStatusCompleted
}

// IsCancelled verifica si la cita fue cancelada
func (a *Appointment) IsCancelled() bool {
	return a.Status == AppointmentStatusCancelled
}

// Confirm confirma la cita
func (a *Appointment) Confirm() {
	a.Status = AppointmentStatusConfirmed
}

// Complete marca la cita como completada
func (a *Appointment) Complete() {
	a.Status = AppointmentStatusCompleted
}

// Cancel cancela la cita
func (a *Appointment) Cancel() {
	a.Status = AppointmentStatusCancelled
}

// MarkSynced actualiza la marca de sincronización con Sheets
func (a *Appointment) MarkSynced() {
	now := time.Now()
	a.LastSyncedAt = &now
}

// HasCalendarEvent verifica si tiene un evento en Google Calendar
func (a *Appointment) HasCalendarEvent() bool {
	return a.CalendarEventID != ""
}

// IsPast verifica si la cita ya pasó
func (a *Appointment) IsPast() bool {
	return time.Now().After(a.Date)
}

// IsToday verifica si la cita es hoy
func (a *Appointment) IsToday() bool {
	now := time.Now()
	y1, m1, d1 := now.Date()
	y2, m2, d2 := a.Date.Date()
	return y1 == y2 && m1 == m2 && d1 == d2
}
