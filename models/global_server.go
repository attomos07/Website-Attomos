package models

import (
	"time"

	"gorm.io/gorm"
)

// GlobalServer representa el servidor compartido global para AtomicBots
type GlobalServer struct {
	ID      uint   `gorm:"primaryKey" json:"id"`
	Name    string `gorm:"size:255;not null" json:"name"`
	Purpose string `gorm:"size:100;not null" json:"purpose"` // "atomic-bots" o "builder-bots"

	// Información del servidor Hetzner
	HetznerServerID int    `gorm:"not null;uniqueIndex" json:"hetznerServerId"`
	IPAddress       string `gorm:"size:50;not null" json:"ipAddress"`
	RootPassword    string `gorm:"size:255;not null" json:"-"`

	// Estado del servidor
	Status string `gorm:"size:50;default:pending" json:"status"` // pending, initializing, ready, error

	// Información de capacidad
	MaxAgents      int `gorm:"default:100" json:"maxAgents"`       // Máximo de agentes que puede alojar
	CurrentAgents  int `gorm:"default:0" json:"currentAgents"`     // Agentes actualmente desplegados
	NextPortNumber int `gorm:"default:3001" json:"nextPortNumber"` // Siguiente puerto disponible

	// Configuración de red
	SSHPort  int `gorm:"default:22" json:"sshPort"`
	BasePort int `gorm:"default:3001" json:"basePort"` // Puerto inicial para bots
	MaxPort  int `gorm:"default:3100" json:"maxPort"`  // Puerto máximo para bots

	// Timestamps
	CreatedAt time.Time      `json:"createdAt"`
	UpdatedAt time.Time      `json:"updatedAt"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

func (GlobalServer) TableName() string {
	return "global_servers"
}

// IsAtCapacity verifica si el servidor está a capacidad máxima
func (g *GlobalServer) IsAtCapacity() bool {
	return g.CurrentAgents >= g.MaxAgents
}

// GetNextPort obtiene el siguiente puerto disponible
func (g *GlobalServer) GetNextPort() int {
	if g.NextPortNumber >= g.MaxPort {
		// Buscar puertos disponibles desde BasePort
		return g.BasePort
	}
	return g.NextPortNumber
}

// IncrementAgentCount incrementa el contador de agentes
func (g *GlobalServer) IncrementAgentCount() {
	g.CurrentAgents++
	g.NextPortNumber++
}

// DecrementAgentCount decrementa el contador de agentes
func (g *GlobalServer) DecrementAgentCount() {
	if g.CurrentAgents > 0 {
		g.CurrentAgents--
	}
}

// IsReady verifica si el servidor está listo para recibir despliegues
func (g *GlobalServer) IsReady() bool {
	return g.Status == "ready"
}

// MarkAsReady marca el servidor como listo
func (g *GlobalServer) MarkAsReady() {
	g.Status = "ready"
}

// MarkAsInitializing marca el servidor como inicializándose
func (g *GlobalServer) MarkAsInitializing() {
	g.Status = "initializing"
}

// MarkAsError marca el servidor con error
func (g *GlobalServer) MarkAsError() {
	g.Status = "error"
}
