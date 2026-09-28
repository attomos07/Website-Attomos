package models

import (
	"time"

	"gorm.io/gorm"
)

type GoogleCloudProject struct {
	ID     uint `gorm:"primaryKey" json:"id"`
	UserID uint `gorm:"not null;uniqueIndex" json:"userId"` // Un usuario = un proyecto

	// Información del Proyecto GCP
	ProjectID     string `gorm:"size:255;uniqueIndex" json:"projectId"`
	ProjectName   string `gorm:"size:255" json:"projectName"`
	ProjectStatus string `gorm:"size:50;default:pending" json:"projectStatus"` // pending, creating, ready, error

	// API Keys
	GeminiAPIKey string `gorm:"size:500" json:"-"` // No exponer en JSON

	// Billing
	BillingAccountID string `gorm:"size:255" json:"-"`
	BillingEnabled   bool   `gorm:"default:false" json:"billingEnabled"`

	// Configuración de APIs
	APIsEnabled []string `gorm:"type:json" json:"apisEnabled"` // APIs habilitadas

	// Metadatos
	OrganizationID string `gorm:"size:255" json:"organizationId"`
	Location       string `gorm:"size:100;default:global" json:"location"`

	// Fechas de creación/actualización del proyecto en GCP
	GCPCreatedAt *time.Time `json:"gcpCreatedAt"`
	GCPUpdatedAt *time.Time `json:"gcpUpdatedAt"`

	// Timestamps
	CreatedAt time.Time      `json:"createdAt"`
	UpdatedAt time.Time      `json:"updatedAt"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

	// Relación con User
	User User `gorm:"foreignKey:UserID" json:"-"`
}

func (GoogleCloudProject) TableName() string {
	return "google_cloud_projects"
}

// IsReady verifica si el proyecto está listo
func (g *GoogleCloudProject) IsReady() bool {
	return g.ProjectStatus == "ready" && g.ProjectID != ""
}

// HasGeminiAPI verifica si tiene API Key de Gemini
func (g *GoogleCloudProject) HasGeminiAPI() bool {
	return g.GeminiAPIKey != ""
}

// MarkAsReady marca el proyecto como listo
func (g *GoogleCloudProject) MarkAsReady() {
	g.ProjectStatus = "ready"
	now := time.Now()
	g.GCPUpdatedAt = &now
}

// MarkAsError marca el proyecto con error
func (g *GoogleCloudProject) MarkAsError() {
	g.ProjectStatus = "error"
	now := time.Now()
	g.GCPUpdatedAt = &now
}

// MarkAsCreating marca el proyecto como en creación
func (g *GoogleCloudProject) MarkAsCreating() {
	g.ProjectStatus = "creating"
}

// GetStatusMessage retorna un mensaje legible del estado
func (g *GoogleCloudProject) GetStatusMessage() string {
	messages := map[string]string{
		"pending":  "Tu proyecto de Google Cloud se creará cuando crees tu primer agente",
		"creating": "Configurando tu espacio de trabajo en Google Cloud (30-60 segundos)...",
		"ready":    "Tu proyecto de Google Cloud está listo",
		"error":    "Hubo un problema configurando tu proyecto. Contacta a soporte.",
	}

	if msg, ok := messages[g.ProjectStatus]; ok {
		return msg
	}

	return "Estado desconocido"
}

// EnableAPI marca una API como habilitada
func (g *GoogleCloudProject) EnableAPI(apiName string) {
	// Evitar duplicados
	for _, api := range g.APIsEnabled {
		if api == apiName {
			return
		}
	}
	g.APIsEnabled = append(g.APIsEnabled, apiName)
}

// IsAPIEnabled verifica si una API está habilitada
func (g *GoogleCloudProject) IsAPIEnabled(apiName string) bool {
	for _, api := range g.APIsEnabled {
		if api == apiName {
			return true
		}
	}
	return false
}
