package handlers

import (
	"fmt"
	"log"
	"net/http"
	"time"

	"attomos/config"
	"attomos/models"

	"github.com/gin-gonic/gin"
	"github.com/go-pdf/fpdf"
)

// GetReceiptPDF genera y descarga el recibo en PDF para un pago específico
func GetReceiptPDF(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}
	user := userInterface.(*models.User)

	paymentID := c.Param("id")

	var payment models.Payment
	if err := config.DB.Where("id = ? AND user_id = ?", paymentID, user.ID).First(&payment).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Recibo no encontrado"})
		return
	}

	var subscription models.Subscription
	config.DB.Where("user_id = ?", user.ID).First(&subscription)

	folioNumber := fmt.Sprintf("ATT-%06d", payment.ID)

	paidDate := payment.CreatedAt
	if payment.PaidAt != nil {
		paidDate = *payment.PaidAt
	}

	planNames := map[string]string{
		"gratuito": "Plan Gratuito",
		"proton":   "Plan Proton",
		"neutron":  "Plan Neutron",
		"electron": "Plan Electron",
	}
	planDisplay := planNames[payment.Plan]
	if planDisplay == "" {
		planDisplay = payment.Plan
	}

	cycleDisplay := "Mensual"
	if payment.BillingCycle == "annual" {
		cycleDisplay = "Anual"
	}

	// ============================================
	// CONFIGURAR PDF — go-pdf/fpdf con UTF-8 nativo
	// ============================================
	pdf := fpdf.New("P", "mm", "A4", "")
	pdf.SetMargins(20, 20, 20)

	// UTF-8 nativo: solo necesitas el traductor, sin fuentes embebidas
	tr := pdf.UnicodeTranslatorFromDescriptor("")

	pdf.AddPage()

	pageW, _ := pdf.GetPageSize()
	safeW := pageW - 40

	// ---- COLORES ----
	primaryR, primaryG, primaryB := 14, 165, 233
	darkR, darkG, darkB := 15, 23, 42
	grayR, grayG, grayB := 100, 116, 139
	lightR, lightG, lightB := 241, 245, 249
	successR, successG, successB := 34, 197, 94
	borderR, borderG, borderB := 226, 232, 240

	// ---- NOMBRE EMPRESA ----
	pdf.SetFont("Helvetica", "B", 16)
	pdf.SetTextColor(primaryR, primaryG, primaryB)
	pdf.CellFormat(safeW, 10, "Attomos", "", 1, "C", false, 0, "")
	pdf.Ln(2)

	// ---- LÍNEA DIVISORIA ----
	pdf.SetDrawColor(borderR, borderG, borderB)
	pdf.SetLineWidth(0.3)
	pdf.Line(20, pdf.GetY(), pageW-20, pdf.GetY())
	pdf.Ln(5)

	// ---- TÍTULO ----
	pdf.SetFont("Helvetica", "B", 18)
	pdf.SetTextColor(darkR, darkG, darkB)
	pdf.CellFormat(safeW, 8, tr("RECIBO DE PAGO"), "", 1, "C", false, 0, "")
	pdf.Ln(1)

	// ---- FOLIO ----
	pdf.SetFont("Helvetica", "", 9)
	pdf.SetTextColor(grayR, grayG, grayB)
	pdf.CellFormat(safeW, 5, tr("Folio: "+folioNumber), "", 1, "C", false, 0, "")
	pdf.Ln(2)

	// ---- BADGE PAGADO ----
	badgeW := 28.0
	badgeH := 6.0
	badgeX := (pageW - badgeW) / 2
	badgeY := pdf.GetY()
	pdf.SetFillColor(successR, successG, successB)
	pdf.RoundedRect(badgeX, badgeY, badgeW, badgeH, 2, "1234", "F")
	pdf.SetFont("Helvetica", "B", 8)
	pdf.SetTextColor(255, 255, 255)
	pdf.SetXY(badgeX, badgeY+0.5)
	pdf.CellFormat(badgeW, badgeH-1, tr("PAGADO"), "", 0, "C", false, 0, "")
	pdf.Ln(badgeH + 5)

	// ---- MONTO ----
	pdf.SetFont("Helvetica", "B", 28)
	pdf.SetTextColor(primaryR, primaryG, primaryB)
	pdf.CellFormat(safeW, 12, tr(payment.GetFormattedAmount()), "", 1, "C", false, 0, "")
	pdf.SetFont("Helvetica", "", 8)
	pdf.SetTextColor(grayR, grayG, grayB)
	pdf.CellFormat(safeW, 4, tr("IVA incluido"), "", 1, "C", false, 0, "")
	pdf.Ln(5)

	// ---- LÍNEA ----
	pdf.SetDrawColor(borderR, borderG, borderB)
	pdf.Line(20, pdf.GetY(), pageW-20, pdf.GetY())
	pdf.Ln(5)

	// ---- DOS COLUMNAS ----
	colW := safeW / 2
	startY := pdf.GetY()

	// Columna izquierda: Cliente
	pdf.SetFont("Helvetica", "B", 7)
	pdf.SetTextColor(grayR, grayG, grayB)
	pdf.SetX(20)
	pdf.CellFormat(colW, 4, tr("FACTURADO A"), "", 1, "L", false, 0, "")

	pdf.SetFont("Helvetica", "B", 10)
	pdf.SetTextColor(darkR, darkG, darkB)
	pdf.SetX(20)
	displayName := user.Company
	if displayName == "" {
		displayName = user.Email
	}
	pdf.CellFormat(colW, 6, tr(displayName), "", 1, "L", false, 0, "")

	pdf.SetFont("Helvetica", "", 9)
	pdf.SetTextColor(grayR, grayG, grayB)
	pdf.SetX(20)
	pdf.CellFormat(colW, 5, tr(user.Email), "", 1, "L", false, 0, "")

	if subscription.StripeCustomerID != "" {
		pdf.SetFont("Helvetica", "", 7)
		pdf.SetX(20)
		pdf.CellFormat(colW, 4, tr("ID Cliente: "+subscription.StripeCustomerID), "", 1, "L", false, 0, "")
	}

	// Columna derecha: Emisor
	pdf.SetXY(20+colW, startY)
	pdf.SetFont("Helvetica", "B", 7)
	pdf.SetTextColor(grayR, grayG, grayB)
	pdf.CellFormat(colW, 4, tr("EMITIDO POR"), "", 1, "L", false, 0, "")

	pdf.SetFont("Helvetica", "B", 10)
	pdf.SetTextColor(darkR, darkG, darkB)
	pdf.SetX(20 + colW)
	pdf.CellFormat(colW, 6, tr("Attomos Industries"), "", 1, "L", false, 0, "")

	pdf.SetFont("Helvetica", "", 9)
	pdf.SetTextColor(grayR, grayG, grayB)
	pdf.SetX(20 + colW)
	pdf.CellFormat(colW, 5, tr("contacto@attomos.com"), "", 1, "L", false, 0, "")

	pdf.SetX(20 + colW)
	pdf.CellFormat(colW, 5, tr("attomos.com"), "", 1, "L", false, 0, "")

	pdf.Ln(6)

	// ---- DETALLES DEL PAGO ----
	sectionY := pdf.GetY()
	pdf.SetFillColor(lightR, lightG, lightB)
	pdf.Rect(20, sectionY, safeW, 6, "F")
	pdf.SetFont("Helvetica", "B", 8)
	pdf.SetTextColor(darkR, darkG, darkB)
	pdf.SetXY(24, sectionY+1)
	pdf.CellFormat(safeW-8, 4, tr("DETALLES DEL PAGO"), "", 1, "L", false, 0, "")
	pdf.Ln(3)

	rowH := 7.0
	type detailRow struct {
		label string
		value string
	}
	rows := []detailRow{
		{"Descripcion", planDisplay + " - Suscripcion Attomos"},
		{"Ciclo de facturacion", cycleDisplay},
		{"Fecha de pago", formatDateES(paidDate)},
		{"ID de transaccion", payment.StripePaymentIntentID},
	}
	if payment.StripeChargeID != "" {
		rows = append(rows, detailRow{"ID de cargo", payment.StripeChargeID})
	}
	rows = append(rows,
		detailRow{"Metodo de pago", "Tarjeta de credito/debito"},
		detailRow{"Moneda", "MXN (Peso Mexicano)"},
		detailRow{"Estado", "Pagado"},
	)

	for i, row := range rows {
		if i%2 == 0 {
			pdf.SetFillColor(255, 255, 255)
		} else {
			pdf.SetFillColor(248, 250, 252)
		}
		rowY := pdf.GetY()
		pdf.Rect(20, rowY, safeW, rowH, "F")

		pdf.SetFont("Helvetica", "", 8)
		pdf.SetTextColor(grayR, grayG, grayB)
		pdf.SetXY(24, rowY+1.5)
		pdf.CellFormat(colW-4, rowH-3, tr(row.label), "", 0, "L", false, 0, "")

		pdf.SetFont("Helvetica", "B", 8)
		pdf.SetTextColor(darkR, darkG, darkB)
		pdf.SetXY(20+colW, rowY+1.5)
		pdf.CellFormat(colW-4, rowH-3, tr(row.value), "", 1, "L", false, 0, "")
	}

	tableH := float64(len(rows)) * rowH
	pdf.SetDrawColor(borderR, borderG, borderB)
	pdf.SetLineWidth(0.3)
	pdf.Rect(20, sectionY+6+3, safeW, tableH, "D")
	pdf.Ln(4)

	// ---- TOTAL ----
	totalY := pdf.GetY()
	pdf.SetFillColor(primaryR, primaryG, primaryB)
	pdf.Rect(20, totalY, safeW, 10, "F")
	pdf.SetFont("Helvetica", "B", 11)
	pdf.SetTextColor(255, 255, 255)
	pdf.SetXY(24, totalY+1.5)
	pdf.CellFormat(colW-4, 7, tr("TOTAL PAGADO"), "", 0, "L", false, 0, "")
	pdf.SetXY(20+colW, totalY+1.5)
	pdf.CellFormat(colW-4, 7, tr(payment.GetFormattedAmount()), "", 1, "R", false, 0, "")
	pdf.Ln(5)

	// ---- NOTA CFDI ----
	noteY := pdf.GetY()
	pdf.SetFillColor(254, 252, 232)
	pdf.SetDrawColor(253, 224, 71)
	pdf.SetLineWidth(0.3)
	pdf.Rect(20, noteY, safeW, 14, "FD")
	pdf.SetFont("Helvetica", "B", 8)
	pdf.SetTextColor(133, 77, 14)
	pdf.SetXY(24, noteY+2)
	pdf.CellFormat(safeW-8, 4, tr("Necesitas factura fiscal (CFDI)?"), "", 1, "L", false, 0, "")
	pdf.SetFont("Helvetica", "", 7)
	pdf.SetX(24)
	pdf.CellFormat(safeW-8, 4, tr("Envia tu RFC y datos fiscales a: facturacion@attomos.com — Folio: "+folioNumber), "", 1, "L", false, 0, "")
	pdf.Ln(8)

	// ---- FOOTER (posicionado justo debajo del contenido, no al final de la página) ----
	footerY := pdf.GetY()
	pdf.SetDrawColor(borderR, borderG, borderB)
	pdf.SetLineWidth(0.3)
	pdf.Line(20, footerY, pageW-20, footerY)
	pdf.Ln(2)

	pdf.SetFont("Helvetica", "", 7)
	pdf.SetTextColor(grayR, grayG, grayB)
	pdf.CellFormat(safeW/2, 4, tr(fmt.Sprintf("© %d Attomos Industries. Todos los derechos reservados.", time.Now().Year())), "", 0, "L", false, 0, "")
	pdf.SetX(20 + safeW/2)
	pdf.CellFormat(safeW/2, 4, tr("Generado el "+formatDateES(time.Now())), "", 1, "R", false, 0, "")
	pdf.CellFormat(safeW, 4, tr("Este documento es un comprobante de pago electronico emitido por Attomos Industries."), "", 1, "C", false, 0, "")

	// ============================================
	// ENVIAR PDF
	// ============================================
	if err := pdf.Error(); err != nil {
		log.Printf("❌ [User %d] Error en PDF: %v", user.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error generando recibo"})
		return
	}

	filename := fmt.Sprintf("recibo-%s.pdf", folioNumber)
	c.Header("Content-Type", "application/pdf")
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", filename))
	c.Header("Cache-Control", "no-store")

	if err := pdf.Output(c.Writer); err != nil {
		log.Printf("❌ [User %d] Error generando PDF: %v", user.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error generando recibo"})
		return
	}

	log.Printf("✅ [User %d] Recibo PDF generado: %s", user.ID, filename)
}

// formatDateES formatea una fecha en español
func formatDateES(t time.Time) string {
	months := []string{"", "enero", "febrero", "marzo", "abril", "mayo", "junio",
		"julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"}
	return fmt.Sprintf("%d de %s de %d", t.Day(), months[t.Month()], t.Year())
}
