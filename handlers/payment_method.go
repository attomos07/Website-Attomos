package handlers

import (
	"log"
	"net/http"
	"os"
	"strconv"

	"attomos/config"
	"attomos/models"

	"github.com/gin-gonic/gin"
	stripe_lib "github.com/stripe/stripe-go/v78"
	"github.com/stripe/stripe-go/v78/customer"
	"github.com/stripe/stripe-go/v78/paymentmethod"
	"github.com/stripe/stripe-go/v78/subscription"
)

// ============================================================
// GET /billing/payment-method  →  render page
// ============================================================
func GetPaymentMethodPage(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.Redirect(http.StatusFound, "/login")
		return
	}
	user := userInterface.(*models.User)
	c.HTML(http.StatusOK, "payment-method.html", gin.H{"user": user})
}

// ============================================================
// GET /api/billing/payment-methods
// Returns all saved payment methods for the user.
//
// Stripe's SaveDefaultPaymentMethod:"on_subscription" attaches
// the card to the Subscription object, NOT to the customer's
// standalone PM list. So we must check BOTH sources:
//  1. paymentmethod.List (PMs explicitly attached to customer)
//  2. The subscription's default_payment_method (expanded)
//
// ============================================================
func GetPaymentMethods(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}
	user := userInterface.(*models.User)

	stripe_lib.Key = os.Getenv("STRIPE_SECRET_KEY")

	// Get local subscription (needs StripeCustomerID + StripeSubscriptionID)
	var sub models.Subscription
	if err := config.DB.Where("user_id = ?", user.ID).First(&sub).Error; err != nil || sub.StripeCustomerID == "" {
		c.JSON(http.StatusOK, gin.H{"methods": []gin.H{}, "defaultMethodId": nil})
		return
	}

	type PMResponse struct {
		ID         string `json:"id"`
		Brand      string `json:"brand"`
		Last4      string `json:"last4"`
		ExpMonth   string `json:"expMonth"`
		ExpYear    string `json:"expYear"`
		HolderName string `json:"holderName"`
	}

	// Use a map to deduplicate PMs from both sources
	pmMap := map[string]PMResponse{}
	defaultPMID := ""

	// ── SOURCE 1: customer's invoice settings default PM ─────────────────────
	cust, err := customer.Get(sub.StripeCustomerID, nil)
	if err != nil {
		log.Printf("⚠️  [User %d] Error obteniendo customer Stripe: %v", user.ID, err)
	} else {
		if cust.InvoiceSettings != nil && cust.InvoiceSettings.DefaultPaymentMethod != nil {
			defaultPMID = cust.InvoiceSettings.DefaultPaymentMethod.ID
		}
	}

	// ── SOURCE 2: PMs explicitly attached to the customer ────────────────────
	listParams := &stripe_lib.PaymentMethodListParams{
		Customer: stripe_lib.String(sub.StripeCustomerID),
		Type:     stripe_lib.String("card"),
	}
	iter := paymentmethod.List(listParams)
	for iter.Next() {
		pm := iter.PaymentMethod()
		if pm.Card == nil {
			continue
		}
		pmMap[pm.ID] = PMResponse{
			ID:         pm.ID,
			Brand:      string(pm.Card.Brand),
			Last4:      pm.Card.Last4,
			ExpMonth:   padMonth(int(pm.Card.ExpMonth)),
			ExpYear:    itoa(int(pm.Card.ExpYear)),
			HolderName: pm.BillingDetails.Name,
		}
	}
	if err := iter.Err(); err != nil {
		log.Printf("⚠️  [User %d] Error listando customer PMs: %v", user.ID, err)
	}

	// ── SOURCE 3: PM saved on the Stripe Subscription (SaveDefaultPaymentMethod:"on_subscription") ──
	if sub.StripeSubscriptionID != "" {
		subParams := &stripe_lib.SubscriptionParams{}
		subParams.AddExpand("default_payment_method")
		stripeSub, err := subscription.Get(sub.StripeSubscriptionID, subParams)
		if err != nil {
			log.Printf("⚠️  [User %d] Error obteniendo subscription Stripe: %v", user.ID, err)
		} else if stripeSub.DefaultPaymentMethod != nil && stripeSub.DefaultPaymentMethod.Card != nil {
			pm := stripeSub.DefaultPaymentMethod
			pmMap[pm.ID] = PMResponse{
				ID:         pm.ID,
				Brand:      string(pm.Card.Brand),
				Last4:      pm.Card.Last4,
				ExpMonth:   padMonth(int(pm.Card.ExpMonth)),
				ExpYear:    itoa(int(pm.Card.ExpYear)),
				HolderName: pm.BillingDetails.Name,
			}
			// This is the authoritative default for recurring charges
			if defaultPMID == "" {
				defaultPMID = pm.ID
			}
			log.Printf("✅ [User %d] PM encontrado en suscripción: %s •••• %s", user.ID, pm.Card.Brand, pm.Card.Last4)
		}
	}

	// Build response slice
	methods := make([]PMResponse, 0, len(pmMap))
	for _, pm := range pmMap {
		methods = append(methods, pm)
	}

	log.Printf("ℹ️  [User %d] Total PMs encontrados: %d | Default: %s", user.ID, len(methods), defaultPMID)

	c.JSON(http.StatusOK, gin.H{
		"methods":         methods,
		"defaultMethodId": defaultPMID,
	})
}

// ============================================================
// POST /api/billing/payment-methods
// Attach a new payment method to the customer
// ============================================================
func AddPaymentMethod(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}
	user := userInterface.(*models.User)

	type AddPMRequest struct {
		// Stripe payment method token created on the frontend via Stripe.js
		// For now we accept a paymentMethodId created by Stripe Elements
		PaymentMethodID string `json:"paymentMethodId" binding:"required"`
		SetDefault      bool   `json:"setDefault"`
	}

	var req AddPMRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "paymentMethodId requerido"})
		return
	}

	stripe_lib.Key = os.Getenv("STRIPE_SECRET_KEY")

	// Get customer
	var sub models.Subscription
	if err := config.DB.Where("user_id = ?", user.ID).First(&sub).Error; err != nil || sub.StripeCustomerID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "El usuario no tiene un customer de Stripe"})
		return
	}

	// Attach payment method to customer
	attachParams := &stripe_lib.PaymentMethodAttachParams{
		Customer: stripe_lib.String(sub.StripeCustomerID),
	}
	pm, err := paymentmethod.Attach(req.PaymentMethodID, attachParams)
	if err != nil {
		log.Printf("❌ [User %d] Error adjuntando payment method: %v", user.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al guardar la tarjeta"})
		return
	}

	// Set as default if requested
	if req.SetDefault {
		if err := setCustomerDefaultPM(sub.StripeCustomerID, pm.ID); err != nil {
			log.Printf("⚠️  [User %d] Error seteando default PM: %v", user.ID, err)
		}
	}

	log.Printf("✅ [User %d] Payment method adjuntado: %s (%s •••• %s)", user.ID, pm.ID, pm.Card.Brand, pm.Card.Last4)

	c.JSON(http.StatusOK, gin.H{
		"message": "Tarjeta guardada correctamente",
		"id":      pm.ID,
		"last4":   pm.Card.Last4,
		"brand":   string(pm.Card.Brand),
	})
}

// ============================================================
// PUT /api/billing/payment-methods/:id
// Update billing details (holder name, expiry) of an existing PM
// ============================================================
func UpdatePaymentMethod(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}
	user := userInterface.(*models.User)
	pmID := c.Param("id")

	type UpdatePMRequest struct {
		HolderName string `json:"holderName"`
		ExpMonth   string `json:"expMonth"`
		ExpYear    string `json:"expYear"`
		SetDefault bool   `json:"setDefault"`
	}

	var req UpdatePMRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos inválidos"})
		return
	}

	stripe_lib.Key = os.Getenv("STRIPE_SECRET_KEY")

	// Build update params
	updateParams := &stripe_lib.PaymentMethodParams{}
	if req.HolderName != "" {
		updateParams.BillingDetails = &stripe_lib.PaymentMethodBillingDetailsParams{
			Name: stripe_lib.String(req.HolderName),
		}
	}
	if req.ExpMonth != "" && req.ExpYear != "" {
		month := int64(mustAtoi(req.ExpMonth))
		year := int64(mustAtoi(req.ExpYear))
		updateParams.Card = &stripe_lib.PaymentMethodCardParams{
			ExpMonth: &month,
			ExpYear:  &year,
		}
	}

	pm, err := paymentmethod.Update(pmID, updateParams)
	if err != nil {
		log.Printf("❌ [User %d] Error actualizando payment method %s: %v", user.ID, pmID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al actualizar la tarjeta"})
		return
	}

	// Set as default
	if req.SetDefault {
		var sub models.Subscription
		if config.DB.Where("user_id = ?", user.ID).First(&sub).Error == nil {
			if err := setCustomerDefaultPM(sub.StripeCustomerID, pm.ID); err != nil {
				log.Printf("⚠️  [User %d] Error seteando default PM: %v", user.ID, err)
			}
		}
	}

	log.Printf("✅ [User %d] Payment method actualizado: %s", user.ID, pm.ID)
	c.JSON(http.StatusOK, gin.H{"message": "Tarjeta actualizada correctamente"})
}

// ============================================================
// POST /api/billing/payment-methods/:id/default
// Set a payment method as the default for the customer
// ============================================================
func SetDefaultPaymentMethod(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}
	user := userInterface.(*models.User)
	pmID := c.Param("id")

	stripe_lib.Key = os.Getenv("STRIPE_SECRET_KEY")

	var sub models.Subscription
	if err := config.DB.Where("user_id = ?", user.ID).First(&sub).Error; err != nil || sub.StripeCustomerID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No se encontró el customer"})
		return
	}

	if err := setCustomerDefaultPM(sub.StripeCustomerID, pmID); err != nil {
		log.Printf("❌ [User %d] Error seteando default PM: %v", user.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al actualizar tarjeta principal"})
		return
	}

	log.Printf("✅ [User %d] Default payment method actualizado: %s", user.ID, pmID)
	c.JSON(http.StatusOK, gin.H{"message": "Tarjeta principal actualizada"})
}

// ============================================================
// DELETE /api/billing/payment-methods/:id
// Detach a payment method from the customer
// ============================================================
func DeletePaymentMethod(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}
	user := userInterface.(*models.User)
	pmID := c.Param("id")

	stripe_lib.Key = os.Getenv("STRIPE_SECRET_KEY")

	// Verify ownership: check the PM is attached to this customer
	var sub models.Subscription
	if err := config.DB.Where("user_id = ?", user.ID).First(&sub).Error; err != nil || sub.StripeCustomerID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No se encontró el customer"})
		return
	}

	pm, err := paymentmethod.Get(pmID, nil)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Método de pago no encontrado"})
		return
	}
	if pm.Customer == nil || pm.Customer.ID != sub.StripeCustomerID {
		c.JSON(http.StatusForbidden, gin.H{"error": "No autorizado"})
		return
	}

	_, err = paymentmethod.Detach(pmID, nil)
	if err != nil {
		log.Printf("❌ [User %d] Error eliminando payment method %s: %v", user.ID, pmID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al eliminar la tarjeta"})
		return
	}

	log.Printf("✅ [User %d] Payment method eliminado: %s", user.ID, pmID)
	c.JSON(http.StatusOK, gin.H{"message": "Tarjeta eliminada correctamente"})
}

// ============================================================
// HELPERS
// ============================================================

func setCustomerDefaultPM(customerID, pmID string) error {
	params := &stripe_lib.CustomerParams{
		InvoiceSettings: &stripe_lib.CustomerInvoiceSettingsParams{
			DefaultPaymentMethod: stripe_lib.String(pmID),
		},
	}
	_, err := customer.Update(customerID, params)
	return err
}

func padMonth(m int) string {
	if m < 10 {
		return "0" + itoa(m)
	}
	return itoa(m)
}

func itoa(n int) string {
	return strconv.Itoa(n)
}

func mustAtoi(s string) int {
	n, _ := strconv.Atoi(s)
	return n
}
