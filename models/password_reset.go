package models

import "time"

// PasswordReset guarda el estado de un intento de recuperación de contraseña:
// primero el código de 4 dígitos (hasheado) que se manda por correo, y luego
// —una vez verificado ese código— un token de un solo uso que autoriza el
// cambio de contraseña final.
type PasswordReset struct {
	ID     uint   `gorm:"primaryKey" json:"id"`
	UserID uint   `gorm:"not null;index" json:"userId"`
	Email  string `gorm:"size:255;index" json:"email"`

	CodeHash string `gorm:"size:255;not null" json:"-"`   // bcrypt del código de 4 dígitos
	Token    string `gorm:"size:64;uniqueIndex" json:"-"` // se genera solo tras verificar el código

	Verified bool `gorm:"default:false" json:"verified"`
	Attempts int  `gorm:"default:0" json:"-"`

	ExpiresAt time.Time `json:"expiresAt"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func (PasswordReset) TableName() string {
	return "password_resets"
}
