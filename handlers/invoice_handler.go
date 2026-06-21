package handlers

import (
	"log"
	"net/http"
	"time"

	"attomos/config"
	"attomos/models"

	"github.com/gin-gonic/gin"
)

// AdminGetInvoices — GET /admin/api/invoices
func AdminGetInvoices(c *gin.Context) {
	type InvoiceRow struct {
		ID              uint      `gorm:"column:id"`
		RazonSocial     string    `gorm:"column:razon_social"`
		RFC             string    `gorm:"column:rfc"`
		DireccionFiscal string    `gorm:"column:direccion_fiscal"`
		CodigoPostal    string    `gorm:"column:codigo_postal"`
		EmailFactura    string    `gorm:"column:email_factura"`
		UsoCFDI         string    `gorm:"column:uso_cfdi"`
		RegimenFiscal   string    `gorm:"column:regimen_fiscal"`
		Status          string    `gorm:"column:status"`
		Notes           string    `gorm:"column:notes"`
		CreatedAt       time.Time `gorm:"column:created_at"`
		// De users
		UserID       uint   `gorm:"column:user_id"`
		Email        string `gorm:"column:email"`
		BusinessName string `gorm:"column:business_name"`
		// De payments
		Amount   float64 `gorm:"column:amount"`
		Currency string  `gorm:"column:currency"`
		Plan     string  `gorm:"column:plan"`
	}

	var rows []InvoiceRow
	config.DB.
		Table("invoices i").
		Select(`i.id, i.razon_social, i.rfc, i.direccion_fiscal, i.codigo_postal,
			i.email_factura, i.uso_cfdi, i.regimen_fiscal, i.status, i.notes, i.created_at,
			u.id AS user_id, u.email,
			COALESCE(b.business_name, u.company) AS business_name,
			COALESCE(p.amount, 0) AS amount, COALESCE(p.currency, 'MXN') AS currency,
			COALESCE(p.plan, '') AS plan`).
		Joins("JOIN users u ON u.id = i.user_id").
		Joins("LEFT JOIN my_business_info b ON b.user_id = i.user_id AND b.branch_number = 1").
		Joins("LEFT JOIN payments p ON p.id = i.payment_id").
		Where("i.deleted_at IS NULL").
		Order("i.created_at DESC").
		Scan(&rows)

	invoices := make([]gin.H, len(rows))
	for i, r := range rows {
		invoices[i] = gin.H{
			"id":              r.ID,
			"razonSocial":     r.RazonSocial,
			"rfc":             r.RFC,
			"direccionFiscal": r.DireccionFiscal,
			"codigoPostal":    r.CodigoPostal,
			"emailFactura":    r.EmailFactura,
			"usoCfdi":         r.UsoCFDI,
			"regimenFiscal":   r.RegimenFiscal,
			"status":          r.Status,
			"notes":           r.Notes,
			"createdAt":       r.CreatedAt,
			"userId":          r.UserID,
			"email":           r.Email,
			"businessName":    r.BusinessName,
			"amount":          r.Amount,
			"currency":        r.Currency,
			"plan":            r.Plan,
		}
	}

	// Stats
	var totalCount, pendingCount, emitidaCount int64
	config.DB.Model(&models.Invoice{}).Where("deleted_at IS NULL").Count(&totalCount)
	config.DB.Model(&models.Invoice{}).Where("status = 'pendiente' AND deleted_at IS NULL").Count(&pendingCount)
	config.DB.Model(&models.Invoice{}).Where("status = 'emitida' AND deleted_at IS NULL").Count(&emitidaCount)

	c.JSON(http.StatusOK, gin.H{
		"invoices": invoices,
		"stats": gin.H{
			"total":     totalCount,
			"pending":   pendingCount,
			"emitida":   emitidaCount,
			"cancelada": totalCount - pendingCount - emitidaCount,
		},
	})
}

// AdminUpdateInvoiceStatus — PATCH /admin/api/invoices/:id
func AdminUpdateInvoiceStatus(c *gin.Context) {
	id := c.Param("id")
	var body struct {
		Status string `json:"status"`
		Notes  string `json:"notes"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos inválidos."})
		return
	}

	result := config.DB.Model(&models.Invoice{}).
		Where("id = ?", id).
		Updates(map[string]interface{}{
			"status": body.Status,
			"notes":  body.Notes,
		})

	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al actualizar."})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

// SaveInvoiceFromCheckout guarda los datos fiscales del checkout.
// Es idempotente: si ya existe una factura para ese paymentID no crea duplicado.
func SaveInvoiceFromCheckout(userID uint, paymentID uint, data InvoiceData) error {
	log.Printf("🧾 [INVOICE] Intentando guardar factura | UserID=%d | PaymentID=%d | RFC=%s",
		userID, paymentID, data.RFC)

	// FIX: Evitar duplicados por payment_id (puede llamarse 2 veces si el webhook llega primero)
	var existing models.Invoice
	if config.DB.Where("payment_id = ?", paymentID).First(&existing).Error == nil {
		log.Printf("ℹ️  [INVOICE] Ya existe factura para PaymentID=%d (ID=%d), omitiendo", paymentID, existing.ID)
		return nil
	}

	invoice := models.Invoice{
		UserID:          userID,
		PaymentID:       paymentID,
		RazonSocial:     data.RazonSocial,
		RFC:             data.RFC,
		DireccionFiscal: data.DireccionFiscal,
		CodigoPostal:    data.CodigoPostal,
		EmailFactura:    data.EmailFactura,
		UsoCFDI:         data.UsoCFDI,
		RegimenFiscal:   data.RegimenFiscal,
		Status:          "pendiente",
	}

	if err := config.DB.Create(&invoice).Error; err != nil {
		log.Printf("❌ [INVOICE] Error creando factura: %v", err)
		return err
	}

	log.Printf("✅ [INVOICE] Factura creada exitosamente | ID=%d | UserID=%d | RFC=%s",
		invoice.ID, userID, data.RFC)
	return nil
}

type InvoiceData struct {
	RequiresInvoice bool   `json:"requiresInvoice"`
	RazonSocial     string `json:"razonSocial"`
	RFC             string `json:"rfc"`
	DireccionFiscal string `json:"direccionFiscal"`
	CodigoPostal    string `json:"codigoPostal"`
	EmailFactura    string `json:"emailFactura"`
	UsoCFDI         string `json:"usoCfdi"`
	RegimenFiscal   string `json:"regimenFiscal"`
}
