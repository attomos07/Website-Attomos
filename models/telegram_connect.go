package models

// telegram_connect.go — "Conectar Telegram" sin pasos técnicos (Managed
// Bots de Telegram, Bot API 9.6).
//
// Cada intento de conexión del onboarding es un registro con un código
// temporal. El cliente abre el bot administrador de Attomos con ese código,
// toca "Crear mi bot", confirma en Telegram, y el bot administrador recibe
// el bot nuevo y su token. El onboarding consulta el código hasta que el
// bot queda creado y luego crea el agente con él.

import "time"

const (
	TelegramConnectPending = "pending" // se generó el enlace; aún no abren el bot administrador
	TelegramConnectOpened  = "opened"  // ya abrieron el bot administrador (se sabe su usuario de Telegram)
	TelegramConnectCreated = "created" // ya crearon su bot; se tiene el token
	TelegramConnectUsed    = "used"    // ya se creó el agente con ese bot
)

type TelegramConnect struct {
	ID          uint      `gorm:"primaryKey"`
	Code        string    `gorm:"size:40;not null;uniqueIndex"`
	UserID      uint      `gorm:"not null;index"`
	BranchID    uint      `gorm:"not null;default:0"`
	TgUserID    int64     `gorm:"not null;default:0;index"` // quien abrió el enlace en Telegram
	TgChatID    int64     `gorm:"not null;default:0;index"`
	BotID       int64     `gorm:"not null;default:0;index"` // el bot que se creó
	BotUsername string    `gorm:"size:64;not null;default:''"`
	BotName     string    `gorm:"size:128;not null;default:''"`
	Token       string    `gorm:"size:160;not null;default:''"`
	Status      string    `gorm:"size:12;not null;default:'pending';index"`
	AgentID     uint      `gorm:"not null;default:0"`
	ExpiresAt   time.Time `gorm:"type:datetime;index"`
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

func (TelegramConnect) TableName() string { return "telegram_connects" }
