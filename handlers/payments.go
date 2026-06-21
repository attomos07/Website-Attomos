package handlers

import (
	"fmt"
	"log"
	"net/http"
	"time"

	"attomos/config"
	"attomos/models"
	"attomos/services"

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

// GetBillingInfo devuelve la suscripción activa con datos completos del usuario
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

	planNames := map[string]string{
		"gratuito": "Gratuito (Prueba)",
		"proton":   "Protón",
		"neutron":  "Neutrón",
		"electron": "Electrón",
		"pending":  "Sin plan",
	}
	planDisplay := planNames[subscription.Plan]
	if planDisplay == "" {
		planDisplay = subscription.Plan
	}

	cycleDisplay := "Mensual"
	if subscription.BillingCycle == "annual" {
		cycleDisplay = "Anual"
	}

	priceDisplay := ""
	if subscription.Plan == "gratuito" {
		priceDisplay = "Gratis"
	} else {
		var lastPayment models.Payment
		if err := config.DB.Where("user_id = ? AND status = ?", user.ID, "succeeded").
			Order("paid_at DESC").First(&lastPayment).Error; err == nil {
			priceDisplay = lastPayment.GetFormattedAmount()
			if subscription.BillingCycle == "monthly" {
				priceDisplay += " / mes"
			} else {
				priceDisplay += " / año"
			}
		}
	}

	months := []string{"enero", "febrero", "marzo", "abril", "mayo", "junio",
		"julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"}

	nextBillingDisplay := ""
	if subscription.CurrentPeriodEnd != nil {
		t := *subscription.CurrentPeriodEnd
		nextBillingDisplay = fmt.Sprintf("%d de %s, %d", t.Day(), months[t.Month()-1], t.Year())
	}

	startDisplay := ""
	if subscription.CurrentPeriodStart != nil {
		t := *subscription.CurrentPeriodStart
		startDisplay = fmt.Sprintf("%d de %s, %d", t.Day(), months[t.Month()-1], t.Year())
	}

	statusDisplay := "Inactiva"
	statusClass := "inactive"
	switch subscription.Status {
	case "active":
		statusDisplay = "Activa"
		statusClass = "active"
	case "trialing":
		statusDisplay = "Prueba"
		statusClass = "trial"
	case "canceled":
		statusDisplay = "Cancelada"
		statusClass = "canceled"
	case "past_due":
		statusDisplay = "Vencida"
		statusClass = "past_due"
	}

	c.JSON(http.StatusOK, gin.H{
		"hasPlan": subscription.Plan != "" && subscription.Plan != "pending",
		"subscription": gin.H{
			"id":                subscription.ID,
			"plan":              subscription.Plan,
			"planDisplay":       planDisplay,
			"billingCycle":      subscription.BillingCycle,
			"cycleDisplay":      cycleDisplay,
			"status":            subscription.Status,
			"statusDisplay":     statusDisplay,
			"statusClass":       statusClass,
			"priceDisplay":      priceDisplay,
			"startDate":         startDisplay,
			"nextBilling":       nextBillingDisplay,
			"currentPeriodEnd":  subscription.CurrentPeriodEnd,
			"cancelAtPeriodEnd": subscription.CancelAtPeriodEnd,
			"stripeCustomerId":  subscription.StripeCustomerID,
			"maxAgents":         subscription.MaxAgents,
			"maxMessages":       subscription.MaxMessages,
			"usedMessages":      subscription.UsedMessages,
			"daysRemaining":     subscription.GetDaysRemaining(),
			"isTrial":           subscription.IsTrial(),
		},
	})
}

// GetBillingPayments devuelve el historial de pagos del usuario
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

	planNames := map[string]string{
		"gratuito": "Gratuito",
		"proton":   "Protón",
		"neutron":  "Neutrón",
		"electron": "Electrón",
	}

	months := []string{"", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
		"Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"}

	type PaymentRow struct {
		ID           uint    `json:"id"`
		PaymentID    string  `json:"paymentId"`
		ReceiptID    string  `json:"receiptId"`
		Subscription string  `json:"subscription"`
		Month        string  `json:"month"`
		PaymentDate  string  `json:"paymentDate"`
		Amount       string  `json:"amount"`
		AmountRaw    float64 `json:"amountRaw"`
		Invoiced     bool    `json:"invoiced"`
		Status       string  `json:"status"`
		ChargeID     string  `json:"chargeId"`
	}

	rows := make([]PaymentRow, 0, len(payments))
	for _, p := range payments {
		planDisplay := planNames[p.Plan]
		if planDisplay == "" {
			planDisplay = p.Plan
		}

		paidDate := p.CreatedAt
		if p.PaidAt != nil {
			paidDate = *p.PaidAt
		}

		monthDisplay := ""
		dateDisplay := ""
		if !paidDate.IsZero() {
			monthDisplay = months[int(paidDate.Month())]
			dateDisplay = fmt.Sprintf("%d %s %d", paidDate.Day(), monthDisplay[:3], paidDate.Year())
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
			ID:           p.ID,
			PaymentID:    p.StripePaymentIntentID,
			ReceiptID:    receiptID,
			Subscription: planDisplay,
			Month:        monthDisplay,
			PaymentDate:  dateDisplay,
			Amount:       p.GetFormattedAmount(),
			AmountRaw:    p.GetAmountInMXN(),
			Invoiced:     false,
			Status:       p.Status,
			ChargeID:     p.StripeChargeID,
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
		stripeService, err := services.NewStripeService()
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
