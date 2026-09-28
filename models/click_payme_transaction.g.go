package models

import (
	"time"

	"gorm.io/gorm"
)

// ClickPaymeTransaction trackea el ciclo de vida de una transacción de Click o Payme.
//
// Payme exige explícitamente que el merchant persista el estado de la
// transacción (Create → Perform/Cancel) de forma idempotente — sus propios
// reintentos dependen de eso. Click no lo exige tan estrictamente, pero
// usamos la misma tabla para ambos por simplicidad y para tener un log
// unificado de pagos de Uzbekistán.
//
// MerchantTransID es la referencia que el bot generó (buildOrderReference)
// y viaja como transaction_param (Click) / ac.order_id (Payme). Es la llave
// para reconciliar con el pedido/cita real una vez que se conecten esos modelos.
type ClickPaymeTransaction struct {
	ID       uint   `gorm:"primaryKey" json:"id"`
	Provider string `gorm:"size:20;not null;index" json:"provider"` // "click" | "payme"
	BranchID uint   `gorm:"not null;index" json:"branchId"`

	// Referencia generada por el bot (branchId-userId-timestamp)
	MerchantTransID string `gorm:"size:150;not null;index" json:"merchantTransId"`

	// ID de transacción del lado del proveedor
	ProviderTransID string `gorm:"size:100;index" json:"providerTransId"` // click_trans_id o el id que genera Payme

	// Monto en unidad mayor (UZS), no en tiyin
	Amount float64 `json:"amount"`

	// Estados estilo Payme (los reusamos también para Click por consistencia):
	//   1  = creada / esperando confirmación
	//   2  = completada (dinero entregado)
	//  -1  = cancelada antes de completarse
	//  -2  = cancelada después de completada (reembolso)
	State int `gorm:"default:1" json:"state"`

	// Específico de Click: en Prepare se genera un merchant_prepare_id que
	// Complete debe recibir de vuelta para validar la secuencia.
	ClickPrepareID string `gorm:"size:100" json:"clickPrepareId"`

	CancelReason int `json:"cancelReason"`

	// Si ya se marcó el pedido/cita real como pagado (una vez conectado ese flujo)
	OrderMarkedPaid bool `gorm:"default:false" json:"orderMarkedPaid"`

	CreatedAtProvider time.Time      `json:"createdAtProvider"`
	PerformedAt       *time.Time     `json:"performedAt"`
	CancelledAt       *time.Time     `json:"cancelledAt"`
	CreatedAt         time.Time      `json:"createdAt"`
	UpdatedAt         time.Time      `json:"updatedAt"`
	DeletedAt         gorm.DeletedAt `gorm:"index" json:"-"`
}

func (ClickPaymeTransaction) TableName() string { return "click_payme_transactions" }
