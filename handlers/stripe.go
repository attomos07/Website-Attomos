package handlers

import (
	"log"
	"net/http"
	"os"

	"attomos/config"
	"attomos/models"
	"attomos/services"

	"github.com/gin-gonic/gin"
)

type CheckoutRequest struct {
	FullName      string `json:"fullName" binding:"required"`
	Email         string `json:"email" binding:"required,email"`
	Phone         string `json:"phone"`
	CountryCode   string `json:"countryCode" binding:"required"`
	PostalCode    string `json:"postalCode" binding:"required"`
	Plan          string `json:"plan" binding:"required"`
	BillingPeriod string `json:"billingPeriod" binding:"required"`
}

type CheckoutResponse struct {
	ClientSecret string `json:"clientSecret"`
	CustomerID   string `json:"customerId"`
	Amount       int64  `json:"amount"`
	Currency     string `json:"currency"`
}

// CreateCheckoutSession crea una Subscription real en Stripe (cobro recurrente)
func CreateCheckoutSession(c *gin.Context) {
	var req CheckoutRequest

	if err := c.ShouldBindJSON(&req); err != nil {
		log.Printf("❌ [CHECKOUT] Error al parsear JSON: %v", err)
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "Datos inválidos",
			"details": err.Error(),
		})
		return
	}

	userInterface, exists := c.Get("user")
	if !exists {
		log.Printf("❌ [CHECKOUT] Usuario no autenticado")
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}
	user := userInterface.(*models.User)

	log.Printf("🛒 [CHECKOUT] ══════════════════════════════════")
	log.Printf("🛒 [CHECKOUT] Usuario ID: %d | Email: %s", user.ID, user.Email)
	log.Printf("🛒 [CHECKOUT] Plan: %s | Período: %s", req.Plan, req.BillingPeriod)
	log.Printf("🛒 [CHECKOUT] ══════════════════════════════════")

	stripeService, err := services.NewStripeService()
	if err != nil {
		log.Printf("❌ [CHECKOUT] Error inicializando Stripe: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al procesar el pago"})
		return
	}

	// ── Obtener o crear customer en Stripe ──────────────────────────────────
	var subscription models.Subscription
	err = config.DB.Where("user_id = ?", user.ID).First(&subscription).Error

	var stripeCustomerID string

	if err == nil && subscription.StripeCustomerID != "" {
		stripeCustomerID = subscription.StripeCustomerID
		log.Printf("✅ [CHECKOUT] Cliente Stripe existente: %s", stripeCustomerID)
	} else {
		log.Printf("🆕 [CHECKOUT] Creando nuevo cliente en Stripe para: %s", req.Email)
		customer, err := stripeService.CreateCustomer(req.Email, req.FullName, req.Phone)
		if err != nil {
			log.Printf("❌ [CHECKOUT] Error creando cliente en Stripe: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al procesar el pago"})
			return
		}
		stripeCustomerID = customer.ID
		log.Printf("✅ [CHECKOUT] Nuevo cliente Stripe creado: %s", stripeCustomerID)

		if subscription.ID != 0 {
			subscription.StripeCustomerID = stripeCustomerID
			config.DB.Save(&subscription)
		} else {
			subscription = models.Subscription{
				UserID:           user.ID,
				StripeCustomerID: stripeCustomerID,
				Plan:             "pending",
				Status:           "inactive",
				Currency:         "mxn",
			}
			config.DB.Create(&subscription)
		}
	}

	// ── Obtener Price ID del plan ────────────────────────────────────────────
	priceID := stripeService.GetPriceIDForPlan(req.Plan, req.BillingPeriod)
	if priceID == "" {
		log.Printf("❌ [CHECKOUT] No se encontró Price ID para plan=%s billing=%s", req.Plan, req.BillingPeriod)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Plan inválido o no configurado"})
		return
	}
	log.Printf("✅ [CHECKOUT] Price ID: %s", priceID)

	// ── Cancelar suscripción Stripe anterior si existe ───────────────────────
	if subscription.StripeSubscriptionID != "" {
		log.Printf("🔄 [CHECKOUT] Cancelando suscripción Stripe anterior: %s", subscription.StripeSubscriptionID)
		if _, err := stripeService.CancelSubscription(subscription.StripeSubscriptionID); err != nil {
			log.Printf("⚠️  [CHECKOUT] No se pudo cancelar sub anterior (continuando): %v", err)
		}
	}

	// ── Crear Subscription recurrente en Stripe ──────────────────────────────
	log.Printf("🔔 [CHECKOUT] Creando Subscription recurrente en Stripe...")
	stripeSub, err := stripeService.CreateSubscription(stripeCustomerID, priceID)
	if err != nil {
		log.Printf("❌ [CHECKOUT] Error creando Subscription en Stripe: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al crear la suscripción"})
		return
	}

	log.Printf("✅ [CHECKOUT] Stripe Subscription creada: %s | Status: %s", stripeSub.ID, stripeSub.Status)

	// Guardar StripeSubscriptionID y StripePriceID en BD (estado aún pending_payment)
	subscription.StripeSubscriptionID = stripeSub.ID
	subscription.StripePriceID = priceID
	subscription.Plan = req.Plan
	subscription.BillingCycle = req.BillingPeriod
	subscription.Status = "inactive" // El webhook lo activará al confirmar pago
	config.DB.Save(&subscription)

	// ── Extraer client_secret del primer invoice ─────────────────────────────
	if stripeSub.LatestInvoice == nil || stripeSub.LatestInvoice.PaymentIntent == nil {
		log.Printf("❌ [CHECKOUT] No hay PaymentIntent en el invoice de la suscripción")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al obtener datos de pago"})
		return
	}

	clientSecret := stripeSub.LatestInvoice.PaymentIntent.ClientSecret
	amount := stripeSub.LatestInvoice.PaymentIntent.Amount

	log.Printf("✅ [CHECKOUT] ClientSecret obtenido | Monto: $%.2f MXN", float64(amount)/100)

	c.JSON(http.StatusOK, CheckoutResponse{
		ClientSecret: clientSecret,
		CustomerID:   stripeCustomerID,
		Amount:       amount,
		Currency:     "mxn",
	})
}

// ConfirmPayment — verifica el primer pago y activa la suscripción en BD
// Los cobros RECURRENTES posteriores los maneja el webhook automáticamente.
type ConfirmPaymentRequest struct {
	PaymentIntentID string       `json:"paymentIntentId" binding:"required"`
	Plan            string       `json:"plan" binding:"required"`
	BillingPeriod   string       `json:"billingPeriod" binding:"required"`
	Invoice         *InvoiceData `json:"invoice"`
}

func ConfirmPayment(c *gin.Context) {
	var req ConfirmPaymentRequest

	if err := c.ShouldBindJSON(&req); err != nil {
		log.Printf("❌ [CONFIRM] Error parseando JSON: %v", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos inválidos"})
		return
	}

	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}
	user := userInterface.(*models.User)

	log.Printf("💳 [CONFIRM] Usuario ID: %d | PI: %s | Plan: %s", user.ID, req.PaymentIntentID, req.Plan)

	// Delegar en el helper compartido con el webhook
	payment, subscription, err := activateSubscriptionFromPaymentIntent(req.PaymentIntentID, user.ID, req.Plan, req.BillingPeriod)
	if err != nil {
		log.Printf("❌ [CONFIRM] %v", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Guardar datos de factura si el usuario la solicitó
	if req.Invoice != nil && req.Invoice.RequiresInvoice {
		if err := SaveInvoiceFromCheckout(user.ID, payment.ID, *req.Invoice); err != nil {
			log.Printf("⚠️  [CONFIRM] Error guardando factura: %v", err)
		} else {
			log.Printf("🧾 [CONFIRM] Factura guardada para usuario %d", user.ID)
		}
	}

	log.Printf("🎉 [CONFIRM] Usuario %d activó plan %s", user.ID, req.Plan)

	c.JSON(http.StatusOK, gin.H{
		"message": "Pago confirmado exitosamente",
		"subscription": gin.H{
			"plan":   subscription.Plan,
			"status": subscription.Status,
		},
		"payment": gin.H{
			"id":     payment.ID,
			"amount": payment.GetFormattedAmount(),
		},
	})
}

// GetStripePublicKey retorna la clave pública de Stripe
func GetStripePublicKey(c *gin.Context) {
	publicKey := os.Getenv("STRIPE_PUBLISHABLE_KEY")
	if publicKey == "" {
		log.Printf("❌ [STRIPE] STRIPE_PUBLISHABLE_KEY no configurada")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Clave pública no configurada"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"publicKey": publicKey})
}
