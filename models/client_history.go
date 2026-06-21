package models

import (
	"time"

	"gorm.io/gorm"
)

// ClientHistoryEntryType indicates the type of history entry
type ClientHistoryEntryType string

const (
	ClientHistoryEntryTypeVisit       ClientHistoryEntryType = "visit"       // Completed visit
	ClientHistoryEntryTypeCancelled   ClientHistoryEntryType = "cancelled"   // Cancelled appointment
	ClientHistoryEntryTypeAppointment ClientHistoryEntryType = "appointment" // Scheduled appointment
)

// ClientHistoryEntry represents a single entry in a client's visit history.
// It is created automatically when an appointment from Sheets or Agent
// transitions to "completed" or "cancelled", or during sync.
type ClientHistoryEntry struct {
	ID     uint `gorm:"primaryKey" json:"id"`
	UserID uint `gorm:"not null;index" json:"userId"`

	// =============================================
	// LINK TO ORIGINAL APPOINTMENT
	// =============================================
	AppointmentID uint `gorm:"index" json:"appointmentId"` // Source appointment (0 if direct entry)

	// =============================================
	// CLIENT INFORMATION
	// =============================================
	ClientFirstName string `gorm:"size:255;not null" json:"clientFirstName"`
	ClientLastName  string `gorm:"size:255;not null" json:"clientLastName"`
	ClientPhone     string `gorm:"size:50" json:"clientPhone"`

	// =============================================
	// VISIT / SERVICE DETAILS
	// =============================================
	Service   string    `gorm:"size:255" json:"service"`         // Service performed
	Worker    string    `gorm:"size:255" json:"worker"`          // Assigned worker / specialist
	VisitDate time.Time `gorm:"not null;index" json:"visitDate"` // Date of the visit
	Notes     string    `gorm:"type:text" json:"notes"`          // Additional notes

	// =============================================
	// ENTRY TYPE & SOURCE
	// =============================================
	EntryType ClientHistoryEntryType `gorm:"size:50;default:'visit';index" json:"entryType"`
	Source    AppointmentSource      `gorm:"size:50;default:'agent'" json:"source"` // sheets | agent | manual

	// =============================================
	// AGENT THAT MANAGED THE APPOINTMENT
	// =============================================
	AgentID   uint   `gorm:"index" json:"agentId"`
	AgentName string `gorm:"size:255" json:"agentName"` // Stored as snapshot at creation time

	// =============================================
	// SHEET REFERENCE (if applicable)
	// =============================================
	SheetID    string `gorm:"size:500" json:"sheetId"`
	SheetRowID string `gorm:"size:255;index" json:"sheetRowId"`

	// =============================================
	// TIMESTAMPS
	// =============================================
	CreatedAt time.Time      `json:"createdAt"`
	UpdatedAt time.Time      `json:"updatedAt"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

	// =============================================
	// RELATIONSHIPS
	// =============================================
	User        User        `gorm:"foreignKey:UserID" json:"-"`
	Appointment Appointment `gorm:"foreignKey:AppointmentID" json:"-"`
}

func (ClientHistoryEntry) TableName() string {
	return "client_history_entries"
}

// GetClientFullName returns the client's full name
func (h *ClientHistoryEntry) GetClientFullName() string {
	return h.ClientFirstName + " " + h.ClientLastName
}

// IsVisit returns true if the entry represents a completed visit
func (h *ClientHistoryEntry) IsVisit() bool {
	return h.EntryType == ClientHistoryEntryTypeVisit
}

// IsCancelled returns true if the entry represents a cancelled appointment
func (h *ClientHistoryEntry) IsCancelled() bool {
	return h.EntryType == ClientHistoryEntryTypeCancelled
}

// HistoryEntryFromAppointment creates a ClientHistoryEntry from a completed or cancelled Appointment.
// Call this in the handler when an appointment status changes to "completed" or during Sheets sync.
func HistoryEntryFromAppointment(appt *Appointment, agentName string) *ClientHistoryEntry {
	entryType := ClientHistoryEntryTypeVisit
	if appt.Status == AppointmentStatusCancelled {
		entryType = ClientHistoryEntryTypeCancelled
	}

	return &ClientHistoryEntry{
		UserID:          appt.UserID,
		AppointmentID:   appt.ID,
		ClientFirstName: appt.ClientFirstName,
		ClientLastName:  appt.ClientLastName,
		ClientPhone:     appt.ClientPhone,
		Service:         appt.Service,
		Worker:          appt.Worker,
		VisitDate:       appt.Date,
		Notes:           appt.Notes,
		EntryType:       entryType,
		Source:          appt.Source,
		AgentID:         appt.AgentID,
		AgentName:       agentName,
		SheetID:         appt.SheetID,
		SheetRowID:      appt.SheetRowID,
	}
}
