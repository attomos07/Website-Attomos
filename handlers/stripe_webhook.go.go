package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"time"

	"attomos/config"
	"attomos/models"

	"github.com/gin-gonic/gin"
	stripe_lib "github.com/stripe/stripe-go/v78"
	"github.com/stripe/stripe-go/v78/paymentintent"
	"github.com/stripe/stripe-go/v78/webhook"
)

// StripeWebhook recibe eventos de Stripe y sincroniza la BD
// Ruta: POST /webhook/stripe  (PÚBLICA — sin middleware de auth)
func StripeWebhookHandler(c *gin.Context) {
	// ── Leer body raw ────────────────────────────────────────────────────────
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		log.Printf("❌ [WEBHOOK] Error leyendo body: %v", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Error leyendo body"})
		return
	}

	// ── Verificar firma de Stripe ────────────────────────────────────────────
	webhookSecret := os.Getenv("STRIPE_WEBHOOK_SECRET")
	sigHeader := c.GetHeader("Stripe-Signature")

	var event stripe_lib.Event

	if webhookSecret != "" {
		event, err = webhook.ConstructEvent(body, sigHeader, webhookSecret)
		if err != nil {
			log.Printf("❌ [WEBHOOK] Firma inválida: %v", err)
			c.JSON(http.StatusBadRequest, gin.H{"error": "Firma inválida"})
			return
		}
	} else {
		// Sin secret configurado: parsear sin verificar (solo dev)
		log.Printf("⚠️  [WEBHOOK] STRIPE_WEBHOOK_SECRET no configurado — saltando verificación de firma")
		if err := json.Unmarshal(body, &event); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "JSON inválido"})
			return
		}
	}

	log.Printf("📨 [WEBHOOK] Evento recibido: %s | ID: %s", event.Type, event.ID)

	// ── Manejar eventos ──────────────────────────────────────────────────────
	switch event.Type {

	// ── Pago exitoso (primer cobro o renovación) ─────────────────────────
	case "invoice.payment_succeeded":
		var invoice stripe_lib.Invoice
		if err := json.Unmarshal(event.Data.Raw, &invoice); err != nil {
			log.Printf("❌ [WEBHOOK] Error parseando invoice: %v", err)
			break
		}
		handleInvoicePaymentSucceeded(&invoice)

	// ── Pago fallido ──────────────────────────────────────────────────────
	case "invoice.payment_failed":
		var invoice stripe_lib.Invoice
		if err := json.Unmarshal(event.Data.Raw, &invoice); err != nil {
			break
		}
		handleInvoicePaymentFailed(&invoice)

	// ── Suscripción actualizada (renovación, cambio de estado) ────────────
	case "customer.subscription.updated":
		var sub stripe_lib.Subscription
		if err := json.Unmarshal(event.Data.Raw, &sub); err != nil {
			break
		}
		handleSubscriptionUpdated(&sub)

	// ── Suscripción eliminada/cancelada ───────────────────────────────────
	case "customer.subscription.deleted":
		var sub stripe_lib.Subscription
		if err := json.Unmarshal(event.Data.Raw, &sub); err != nil {
			break
		}
		handleSubscriptionDeleted(&sub)

	default:
		log.Printf("ℹ️  [WEBHOOK] Evento no manejado: %s", event.Type)
	}

	c.JSON(http.StatusOK, gin.H{"received": true})
}

// ── Handlers de eventos ──────────────────────────────────────────────────────

func handleInvoicePaymentSucceeded(invoice *stripe_lib.Invoice) {
	log.Printf("✅ [WEBHOOK] invoice.payment_succeeded | Customer: %s | Amount: $%.2f",
		invoice.Customer.ID, float64(invoice.AmountPaid)/100)

	// Buscar suscripción local por StripeCustomerID
	var sub models.Subscription
	if err := config.DB.Where("stripe_customer_id = ?", invoice.Customer.ID).First(&sub).Error; err != nil {
		log.Printf("⚠️  [WEBHOOK] No se encontró suscripción para customer %s", invoice.Customer.ID)
		return
	}

	now := time.Now()

	// Actualizar fechas del período desde la suscripción de Stripe
	if invoice.Lines != nil && len(invoice.Lines.Data) > 0 {
		line := invoice.Lines.Data[0]
		if line.Period != nil {
			start := time.Unix(line.Period.Start, 0)
			end := time.Unix(line.Period.End, 0)
			sub.CurrentPeriodStart = &start
			sub.CurrentPeriodEnd = &end
		}
	}

	sub.Status = "active"
	sub.CancelAtPeriodEnd = false
	config.DB.Save(&sub)

	log.Printf("✅ [WEBHOOK] Suscripción %d renovada | Expira: %s",
		sub.ID, sub.CurrentPeriodEnd.Format("2006-01-02"))

	// Registrar pago en tabla payments (evitar duplicados)
	piID := ""
	if invoice.PaymentIntent != nil {
		piID = invoice.PaymentIntent.ID
	}

	if piID != "" {
		var existing models.Payment
		if config.DB.Where("stripe_payment_intent_id = ?", piID).First(&existing).Error != nil {
			// No existe — crear
			chargeID := ""
			if invoice.Charge != nil {
				chargeID = invoice.Charge.ID
			}

			payment := models.Payment{
				UserID:                sub.UserID,
				SubscriptionID:        sub.ID,
				StripePaymentIntentID: piID,
				StripeInvoiceID:       invoice.ID,
				StripeChargeID:        chargeID,
				Amount:                invoice.AmountPaid,
				Currency:              string(invoice.Currency),
				Status:                "succeeded",
				PaymentMethod:         "card",
				Plan:                  sub.Plan,
				BillingCycle:          sub.BillingCycle,
				Description:           fmt.Sprintf("Renovación Attomos - Plan %s", sub.Plan),
				PaidAt:                &now,
			}
			if err := config.DB.Create(&payment).Error; err != nil {
				log.Printf("❌ [WEBHOOK] Error guardando pago: %v", err)
			} else {
				log.Printf("✅ [WEBHOOK] Pago registrado en BD: ID=%d | $%.2f MXN", payment.ID, float64(payment.Amount)/100)
			}
		} else {
			log.Printf("ℹ️  [WEBHOOK] Pago ya existía en BD: %s", piID)
		}
	}
}

func handleInvoicePaymentFailed(invoice *stripe_lib.Invoice) {
	log.Printf("❌ [WEBHOOK] invoice.payment_failed | Customer: %s", invoice.Customer.ID)

	var sub models.Subscription
	if err := config.DB.Where("stripe_customer_id = ?", invoice.Customer.ID).First(&sub).Error; err != nil {
		return
	}

	sub.Status = "past_due"
	config.DB.Save(&sub)
	log.Printf("⚠️  [WEBHOOK] Suscripción %d marcada como past_due", sub.ID)
}

func handleSubscriptionUpdated(stripeSub *stripe_lib.Subscription) {
	log.Printf("🔄 [WEBHOOK] customer.subscription.updated | Sub: %s | Status: %s",
		stripeSub.ID, stripeSub.Status)

	var sub models.Subscription
	if err := config.DB.Where("stripe_subscription_id = ?", stripeSub.ID).First(&sub).Error; err != nil {
		log.Printf("⚠️  [WEBHOOK] Sub local no encontrada para Stripe ID: %s", stripeSub.ID)
		return
	}

	// Sincronizar estado
	switch string(stripeSub.Status) {
	case "active":
		sub.Status = "active"
	case "trialing":
		sub.Status = "trialing"
	case "past_due":
		sub.Status = "past_due"
	case "canceled":
		sub.Status = "canceled"
	case "unpaid":
		sub.Status = "past_due"
	}

	sub.CancelAtPeriodEnd = stripeSub.CancelAtPeriodEnd

	// Sincronizar fechas del período
	start := time.Unix(stripeSub.CurrentPeriodStart, 0)
	end := time.Unix(stripeSub.CurrentPeriodEnd, 0)
	sub.CurrentPeriodStart = &start
	sub.CurrentPeriodEnd = &end

	config.DB.Save(&sub)
	log.Printf("✅ [WEBHOOK] Sub %d sincronizada → Status: %s | Expira: %s",
		sub.ID, sub.Status, end.Format("2006-01-02"))
}

func handleSubscriptionDeleted(stripeSub *stripe_lib.Subscription) {
	log.Printf("🗑️  [WEBHOOK] customer.subscription.deleted | Sub: %s", stripeSub.ID)

	var sub models.Subscription
	if err := config.DB.Where("stripe_subscription_id = ?", stripeSub.ID).First(&sub).Error; err != nil {
		return
	}

	now := time.Now()
	sub.Status = "canceled"
	sub.CanceledAt = &now
	config.DB.Save(&sub)
	log.Printf("✅ [WEBHOOK] Suscripción %d cancelada", sub.ID)
}

// ── Helper compartido entre ConfirmPayment y el webhook ──────────────────────
// Verifica el PaymentIntent en Stripe y activa la suscripción local.
// FIX: Ya no hace early return al encontrar un pago existente — devuelve el
// payment (nuevo o existente) para que ConfirmPayment pueda guardar la factura.
func activateSubscriptionFromPaymentIntent(piID string, userID uint, plan, billingPeriod string) (*models.Payment, *models.Subscription, error) {
	stripe_lib.Key = os.Getenv("STRIPE_SECRET_KEY")

	pi, err := paymentintent.Get(piID, &stripe_lib.PaymentIntentParams{
		Params: stripe_lib.Params{
			Expand: []*string{stripe_lib.String("latest_charge")},
		},
	})
	if err != nil {
		return nil, nil, fmt.Errorf("PaymentIntent no encontrado: %w", err)
	}

	if pi.Status != stripe_lib.PaymentIntentStatusSucceeded {
		return nil, nil, fmt.Errorf("pago no completado, status: %s", pi.Status)
	}

	// Buscar suscripción del usuario
	var sub models.Subscription
	if err := config.DB.Where("user_id = ?", userID).First(&sub).Error; err != nil {
		return nil, nil, fmt.Errorf("suscripción no encontrada para user %d", userID)
	}

	now := time.Now()
	var periodEnd time.Time
	if billingPeriod == "annual" {
		periodEnd = now.AddDate(1, 0, 0)
	} else {
		periodEnd = now.AddDate(0, 1, 0)
	}

	// Actualizar suscripción
	prevPlan := sub.Plan
	sub.Plan = plan
	sub.BillingCycle = billingPeriod
	sub.Status = "active"
	sub.CurrentPeriodStart = &now
	sub.CurrentPeriodEnd = &periodEnd
	if prevPlan != plan {
		sub.PlanChangedAt = &now
	}
	sub.SetPlanLimits()
	config.DB.Save(&sub)

	log.Printf("✅ [CONFIRM] Suscripción %d activada → Plan: %s | Expira: %s",
		sub.ID, plan, periodEnd.Format("2006-01-02"))

	// ── Registrar pago (evitar duplicados) ───────────────────────────────────
	// FIX: si el webhook ya creó el pago, lo retornamos igual para que
	// ConfirmPayment pueda guardar la factura con el payment.ID correcto.
	var existingPayment models.Payment
	if config.DB.Where("stripe_payment_intent_id = ?", piID).First(&existingPayment).Error == nil {
		log.Printf("ℹ️  [CONFIRM] Pago ya existía en BD (ID=%d), usando para factura", existingPayment.ID)
		return &existingPayment, &sub, nil
	}

	// Pago nuevo — crearlo
	chargeID := ""
	if pi.LatestCharge != nil {
		chargeID = pi.LatestCharge.ID
	}

	planDisplay := map[string]string{
		"proton": "Protón", "neutron": "Neutrón", "electron": "Electrón",
	}
	displayName := planDisplay[plan]
	if displayName == "" {
		displayName = plan
	}

	payment := models.Payment{
		UserID:                userID,
		SubscriptionID:        sub.ID,
		StripePaymentIntentID: piID,
		StripeChargeID:        chargeID,
		Amount:                pi.Amount,
		Currency:              string(pi.Currency),
		Status:                "succeeded",
		PaymentMethod:         "card",
		Plan:                  plan,
		BillingCycle:          billingPeriod,
		Description:           "Suscripción Attomos - Plan " + displayName,
		PaidAt:                &now,
	}

	if err := config.DB.Create(&payment).Error; err != nil {
		log.Printf("❌ [CONFIRM] Error guardando pago: %v", err)
	} else {
		log.Printf("✅ [CONFIRM] Pago creado en BD: ID=%d | $%.2f", payment.ID, float64(payment.Amount)/100)
	}

	return &payment, &sub, nil
}
