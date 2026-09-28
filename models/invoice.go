package models

import (
	"time"

	"gorm.io/gorm"
)

// Invoice guarda los datos fiscales capturados en checkout cuando el usuario requiere factura.
type Invoice struct {
	ID        uint `gorm:"primaryKey" json:"id"`
	UserID    uint `gorm:"not null;index" json:"userId"`
	PaymentID uint `gorm:"index" json:"paymentId"` // FK a payments.id

	// Datos fiscales
	RazonSocial     string `gorm:"size:255" json:"razonSocial"`
	RFC             string `gorm:"size:13" json:"rfc"`
	DireccionFiscal string `gorm:"type:text" json:"direccionFiscal"`
	CodigoPostal    string `gorm:"size:10" json:"codigoPostal"`
	EmailFactura    string `gorm:"size:255" json:"emailFactura"`
	UsoCFDI         string `gorm:"size:10" json:"usoCfdi"`
	RegimenFiscal   string `gorm:"size:10" json:"regimenFiscal"`

	// Estado
	Status string `gorm:"size:50;default:'pendiente'" json:"status"` // pendiente, emitida, cancelada
	Notes  string `gorm:"type:text" json:"notes"`

	CreatedAt time.Time      `json:"createdAt"`
	UpdatedAt time.Time      `json:"updatedAt"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

	User    User    `gorm:"foreignKey:UserID" json:"-"`
	Payment Payment `gorm:"foreignKey:PaymentID" json:"-"`
}
