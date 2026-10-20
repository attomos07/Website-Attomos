package handlers

import (
	"log"
	"net/http"
	"time"

	"attomos/config"
	"attomos/models"

	"attomos/payments"
	"github.com/gin-gonic/gin"
)

// GetBillingPage renderiza la página de facturación
func GetBillingPage(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.Redirect(http.StatusFound, "/login")
		return
	}
	user := userInterface.(*models.User)
	c.HTML(http.StatusOK, "billing.html", gin.H{"user": user})
}

// GetBillingInfo devuelve la suscripción activa con datos completos del usuario.
// Devuelve códigos crudos (plan, status, billingCycle) y fechas ISO 8601;
// el frontend se encarga de traducir y formatear según el idioma activo.
func GetBillingInfo(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}
	user := userInterface.(*models.User)

	var subscription models.Subscription
	if err := config.DB.Where("user_id = ?", user.ID).First(&subscription).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{
			"subscription": nil,
			"hasPlan":      false,
		})
		return
	}

	// Precio: solo monto crudo + moneda. El plan gratuito no tiene pago asociado.
	var priceAmount float64
	var priceCurrency string
	isFree := subscription.Plan == "gratuito"
	if !isFree {
		var lastPayment models.Payment
		if err := config.DB.Where("user_id = ? AND status = ?", user.ID, "succeeded").
			Order("paid_at DESC").First(&lastPayment).Error; err == nil {
			priceAmount = lastPayment.GetAmountInMXN()
			priceCurrency = lastPayment.Currency
		}
	}

	statusClass := "inactive"
	switch subscription.Status {
	case "active":
		statusClass = "active"
	case "trialing":
		statusClass = "trial"
	case "canceled":
		statusClass = "canceled"
	case "past_due":
		statusClass = "past_due"
	}

	var startISO, endISO string
	if subscription.CurrentPeriodStart != nil {
		startISO = subscription.CurrentPeriodStart.Format(time.RFC3339)
	}
	if subscription.CurrentPeriodEnd != nil {
		endISO = subscription.CurrentPeriodEnd.Format(time.RFC3339)
	}

	c.JSON(http.StatusOK, gin.H{
		"hasPlan": subscription.Plan != "" && subscription.Plan != "pending",
		"subscription": gin.H{
			"id":                 subscription.ID,
			"plan":               subscription.Plan,
			"billingCycle":       subscription.BillingCycle,
			"status":             subscription.Status,
			"statusClass":        statusClass,
			"isFree":             isFree,
			"priceAmount":        priceAmount,
			"priceCurrency":      priceCurrency,
			"currentPeriodStart": startISO,
			"currentPeriodEnd":   endISO,
			"cancelAtPeriodEnd":  subscription.CancelAtPeriodEnd,
			"stripeCustomerId":   subscription.StripeCustomerID,
			"maxAgents":          subscription.MaxAgents,
			"maxMessages":        subscription.MaxMessages,
			"usedMessages":       subscription.UsedMessages,
			"daysRemaining":      subscription.GetDaysRemaining(),
			"isTrial":            subscription.IsTrial(),
		},
	})
}

// GetBillingPayments devuelve el historial de pagos del usuario.
// Devuelve el código de plan crudo y la fecha en ISO 8601;
// el frontend traduce el nombre del plan y formatea la fecha según el idioma.
func GetBillingPayments(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}
	user := userInterface.(*models.User)

	var payments []models.Payment
	if err := config.DB.Where("user_id = ?", user.ID).
		Order("created_at DESC").
		Find(&payments).Error; err != nil {
		log.Printf("❌ Error obteniendo pagos del usuario %d: %v", user.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error obteniendo pagos"})
		return
	}

	type PaymentRow struct {
		ID          uint    `json:"id"`
		PaymentID   string  `json:"paymentId"`
		ReceiptID   string  `json:"receiptId"`
		Plan        string  `json:"plan"`
		PaymentDate string  `json:"paymentDate"` // ISO 8601
		Amount      string  `json:"amount"`
		AmountRaw   float64 `json:"amountRaw"`
		Invoiced    bool    `json:"invoiced"`
		Status      string  `json:"status"`
		ChargeID    string  `json:"chargeId"`
	}

	rows := make([]PaymentRow, 0, len(payments))
	for _, p := range payments {
		paidDate := p.CreatedAt
		if p.PaidAt != nil {
			paidDate = *p.PaidAt
		}

		paymentDateISO := ""
		if !paidDate.IsZero() {
			paymentDateISO = paidDate.Format(time.RFC3339)
		}

		receiptSrc := p.StripeChargeID
		if receiptSrc == "" {
			receiptSrc = p.StripePaymentIntentID
		}
		receiptID := "#" + receiptSrc
		if len(receiptSrc) > 8 {
			receiptID = "#" + receiptSrc[len(receiptSrc)-8:]
		}

		rows = append(rows, PaymentRow{
			ID:          p.ID,
			PaymentID:   p.StripePaymentIntentID,
			ReceiptID:   receiptID,
			Plan:        p.Plan,
			PaymentDate: paymentDateISO,
			Amount:      p.GetFormattedAmount(),
			AmountRaw:   p.GetAmountInMXN(),
			Invoiced:    false,
			Status:      p.Status,
			ChargeID:    p.StripeChargeID,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"payments": rows,
		"total":    len(rows),
	})
}

// CancelSubscription cancela la suscripción en Stripe Y en BD
func CancelSubscription(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}
	user := userInterface.(*models.User)

	var subscription models.Subscription
	if err := config.DB.Where("user_id = ?", user.ID).First(&subscription).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "No se encontró suscripción activa"})
		return
	}

	// ── Cancelar en Stripe (al final del período) ────────────────────────────
	if subscription.StripeSubscriptionID != "" {
		stripeService, err := payments.NewStripeService()
		if err != nil {
			log.Printf("❌ [CANCEL] Error inicializando Stripe: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al cancelar en Stripe"})
			return
		}

		// CancelAtPeriodEnd = true → Stripe cancela al vencer el período actual,
		// no de inmediato. El webhook customer.subscription.updated sincronizará la BD.
		if err := stripeService.CancelAtPeriodEnd(subscription.StripeSubscriptionID); err != nil {
			log.Printf("❌ [CANCEL] Error cancelando en Stripe: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al cancelar en Stripe"})
			return
		}

		log.Printf("✅ [User %d] Suscripción Stripe %s marcada para cancelar al fin del período",
			user.ID, subscription.StripeSubscriptionID)
	} else {
		log.Printf("⚠️  [User %d] Sin StripeSubscriptionID — cancelando solo en BD", user.ID)
	}

	// ── Actualizar BD ────────────────────────────────────────────────────────
	now := time.Now()
	subscription.CancelAtPeriodEnd = true
	subscription.CanceledAt = &now

	if err := config.DB.Save(&subscription).Error; err != nil {
		log.Printf("❌ Error actualizando BD para usuario %d: %v", user.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al guardar cancelación"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":           "Suscripción cancelada. Tendrás acceso hasta el final del período actual.",
		"cancelAtPeriodEnd": true,
		"currentPeriodEnd":  subscription.CurrentPeriodEnd,
	})
}
