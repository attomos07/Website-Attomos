package handlers

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"

	"attomos/config"
	"attomos/models"

	"github.com/gin-gonic/gin"
	stripe "github.com/stripe/stripe-go/v78"
	"github.com/stripe/stripe-go/v78/account"
	"github.com/stripe/stripe-go/v78/accountlink"
	"github.com/stripe/stripe-go/v78/paymentlink"
	"github.com/stripe/stripe-go/v78/price"
)

// ============================================
// GET /api/payment-config/:branch_id
// Retorna la configuración de pagos de una sucursal
// ============================================

func GetPaymentConfig(c *gin.Context) {
	userInterface, _ := c.Get("user")
	user := userInterface.(*models.User)

	branchID := c.Param("branch_id")

	// Verificar que la sucursal pertenece al usuario
	var branch models.MyBusinessInfo
	if err := config.DB.Where("id = ? AND user_id = ?", branchID, user.ID).First(&branch).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Sucursal no encontrada"})
		return
	}

	var cfg models.PaymentConfig
	err := config.DB.Where("branch_id = ? AND user_id = ?", branch.ID, user.ID).First(&cfg).Error
	if err != nil {
		// No existe config todavía — retornar vacía
		c.JSON(http.StatusOK, gin.H{
			"configured":                false,
			"speiEnabled":               false,
			"clabeNumber":               "",
			"bankName":                  "",
			"accountName":               "",
			"stripeEnabled":             false,
			"stripeAccountStatus":       "",
			"stripePayoutsEnabled":      false,
			"stripeChargesEnabled":      false,
			"paymentRequiredForBooking": false,
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"configured":                true,
		"speiEnabled":               cfg.SPEIEnabled,
		"clabeNumber":               maskCLABE(cfg.CLABENumber),
		"bankName":                  cfg.BankName,
		"accountName":               cfg.AccountName,
		"stripeEnabled":             cfg.StripeEnabled,
		"stripeAccountId":           cfg.StripeAccountID,
		"stripeAccountStatus":       cfg.StripeAccountStatus,
		"stripePayoutsEnabled":      cfg.StripePayoutsEnabled,
		"stripeChargesEnabled":      cfg.StripeChargesEnabled,
		"stripeConnectedAt":         cfg.StripeConnectedAt,
		"paymentRequiredForBooking": cfg.PaymentRequiredForBooking,
	})
}

// ============================================
// POST /api/payment-config/spei/:branch_id
// Guarda o actualiza los datos de CLABE SPEI
// ============================================

type SPEIRequest struct {
	CLABENumber string `json:"clabeNumber" binding:"required"`
	BankName    string `json:"bankName"`
	AccountName string `json:"accountName"`
	Enabled     bool   `json:"enabled"`
}

func SaveSPEIConfig(c *gin.Context) {
	userInterface, _ := c.Get("user")
	user := userInterface.(*models.User)

	branchID := c.Param("branch_id")

	var req SPEIRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos inválidos: " + err.Error()})
		return
	}

	// Validar CLABE: 18 dígitos
	clabeClean := strings.ReplaceAll(req.CLABENumber, " ", "")
	if !regexp.MustCompile(`^\d{18}$`).MatchString(clabeClean) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "La CLABE debe tener exactamente 18 dígitos"})
		return
	}

	// Verificar que la sucursal pertenece al usuario
	var branch models.MyBusinessInfo
	if err := config.DB.Where("id = ? AND user_id = ?", branchID, user.ID).First(&branch).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Sucursal no encontrada"})
		return
	}

	var cfg models.PaymentConfig
	result := config.DB.Where("branch_id = ? AND user_id = ?", branch.ID, user.ID).First(&cfg)

	if result.Error != nil {
		// Crear nueva config
		cfg = models.PaymentConfig{
			UserID:      user.ID,
			BranchID:    branch.ID,
			SPEIEnabled: req.Enabled,
			CLABENumber: clabeClean,
			BankName:    req.BankName,
			AccountName: req.AccountName,
		}
		if err := config.DB.Create(&cfg).Error; err != nil {
			log.Printf("❌ [PAYMENT] Error creando config: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al guardar configuración"})
			return
		}
	} else {
		// Actualizar existente
		cfg.SPEIEnabled = req.Enabled
		cfg.CLABENumber = clabeClean
		cfg.BankName = req.BankName
		cfg.AccountName = req.AccountName
		if err := config.DB.Save(&cfg).Error; err != nil {
			log.Printf("❌ [PAYMENT] Error actualizando config: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al actualizar configuración"})
			return
		}
	}

	log.Printf("✅ [PAYMENT] CLABE guardada para sucursal %d del usuario %d", branch.ID, user.ID)

	c.JSON(http.StatusOK, gin.H{
		"message":     "Configuración SPEI guardada exitosamente",
		"clabeNumber": maskCLABE(clabeClean),
		"bankName":    cfg.BankName,
		"accountName": cfg.AccountName,
		"enabled":     cfg.SPEIEnabled,
	})
}

// ============================================
// DELETE /api/payment-config/spei/:branch_id
// Elimina la configuración SPEI
// ============================================

func RemoveSPEIConfig(c *gin.Context) {
	userInterface, _ := c.Get("user")
	user := userInterface.(*models.User)
	branchID := c.Param("branch_id")

	var branch models.MyBusinessInfo
	if err := config.DB.Where("id = ? AND user_id = ?", branchID, user.ID).First(&branch).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Sucursal no encontrada"})
		return
	}

	config.DB.Model(&models.PaymentConfig{}).
		Where("branch_id = ? AND user_id = ?", branch.ID, user.ID).
		Updates(map[string]interface{}{
			"spei_enabled": false,
			"clabe_number": "",
			"bank_name":    "",
			"account_name": "",
		})

	c.JSON(http.StatusOK, gin.H{"message": "Configuración SPEI eliminada"})
}

// ============================================
// POST /api/payment-config/stripe/connect/:branch_id
// Inicia el flujo OAuth de Stripe Connect
// ============================================

func InitiateStripeConnect(c *gin.Context) {
	userInterface, _ := c.Get("user")
	user := userInterface.(*models.User)
	branchID := c.Param("branch_id")

	var branch models.MyBusinessInfo
	if err := config.DB.Where("id = ? AND user_id = ?", branchID, user.ID).First(&branch).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Sucursal no encontrada"})
		return
	}

	stripeKey := os.Getenv("STRIPE_SECRET_KEY")
	if stripeKey == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Stripe no configurado"})
		return
	}
	stripe.Key = stripeKey

	// Crear cuenta Stripe Connect Express
	params := &stripe.AccountParams{
		Type:    stripe.String("express"),
		Country: stripe.String("MX"),
		Email:   stripe.String(user.Email),
		Capabilities: &stripe.AccountCapabilitiesParams{
			CardPayments: &stripe.AccountCapabilitiesCardPaymentsParams{
				Requested: stripe.Bool(true),
			},
			Transfers: &stripe.AccountCapabilitiesTransfersParams{
				Requested: stripe.Bool(true),
			},
		},
		BusinessType: stripe.String("individual"),
		BusinessProfile: &stripe.AccountBusinessProfileParams{
			MCC:                stripe.String("7299"), // Servicios personales
			Name:               stripe.String(branch.BusinessName),
			ProductDescription: stripe.String("Servicios de negocio vía WhatsApp Bot"),
		},
	}

	acc, err := account.New(params)
	if err != nil {
		log.Printf("❌ [STRIPE CONNECT] Error creando cuenta: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al crear cuenta Stripe"})
		return
	}

	log.Printf("✅ [STRIPE CONNECT] Cuenta creada: %s para sucursal %d", acc.ID, branch.ID)

	// Guardar el account ID antes de redirigir
	var cfg models.PaymentConfig
	result := config.DB.Where("branch_id = ? AND user_id = ?", branch.ID, user.ID).First(&cfg)

	baseURL := os.Getenv("BASE_URL")
	if baseURL == "" {
		baseURL = "https://" + c.Request.Host
	}

	refreshURL := fmt.Sprintf("%s/integrations?stripe_refresh=1&branch_id=%d", baseURL, branch.ID)
	returnURL := fmt.Sprintf("%s/api/payment-config/stripe/callback?branch_id=%d&account_id=%s", baseURL, branch.ID, acc.ID)

	// Generar link de onboarding
	linkParams := &stripe.AccountLinkParams{
		Account:    stripe.String(acc.ID),
		RefreshURL: stripe.String(refreshURL),
		ReturnURL:  stripe.String(returnURL),
		Type:       stripe.String("account_onboarding"),
	}

	link, err := accountlink.New(linkParams)
	if err != nil {
		log.Printf("❌ [STRIPE CONNECT] Error generando link: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al generar link de onboarding"})
		return
	}

	// Guardar o actualizar config
	if result.Error != nil {
		cfg = models.PaymentConfig{
			UserID:              user.ID,
			BranchID:            branch.ID,
			StripeAccountID:     acc.ID,
			StripeAccountStatus: "pending",
			StripeOnboardingURL: link.URL,
		}
		config.DB.Create(&cfg)
	} else {
		cfg.StripeAccountID = acc.ID
		cfg.StripeAccountStatus = "pending"
		cfg.StripeOnboardingURL = link.URL
		config.DB.Save(&cfg)
	}

	c.JSON(http.StatusOK, gin.H{
		"onboardingUrl": link.URL,
		"accountId":     acc.ID,
	})
}

// ============================================
// GET /api/payment-config/stripe/callback
// Stripe redirige aquí después del onboarding
// ============================================

func HandleStripeConnectCallback(c *gin.Context) {
	branchIDStr := c.Query("branch_id")
	accountID := c.Query("account_id")

	if branchIDStr == "" || accountID == "" {
		c.Redirect(http.StatusFound, "/integrations?stripe_error=1")
		return
	}

	stripeKey := os.Getenv("STRIPE_SECRET_KEY")
	if stripeKey == "" {
		c.Redirect(http.StatusFound, "/integrations?stripe_error=1")
		return
	}
	stripe.Key = stripeKey

	// Verificar el estado de la cuenta en Stripe
	acc, err := account.GetByID(accountID, nil)
	if err != nil {
		log.Printf("❌ [STRIPE CB] Error obteniendo cuenta %s: %v", accountID, err)
		c.Redirect(http.StatusFound, fmt.Sprintf("/integrations?stripe_error=1&branch_id=%s", branchIDStr))
		return
	}

	status := "pending"
	payoutsEnabled := acc.PayoutsEnabled
	chargesEnabled := acc.ChargesEnabled

	if acc.ChargesEnabled && acc.PayoutsEnabled {
		status = "active"
	} else if acc.DetailsSubmitted {
		status = "pending_verification"
	}

	now := time.Now()

	result := config.DB.Model(&models.PaymentConfig{}).
		Where("branch_id = ? AND stripe_account_id = ?", branchIDStr, accountID).
		Updates(map[string]interface{}{
			"stripe_enabled":         chargesEnabled,
			"stripe_account_status":  status,
			"stripe_payouts_enabled": payoutsEnabled,
			"stripe_charges_enabled": chargesEnabled,
			"stripe_connected_at":    &now,
			"stripe_onboarding_url":  "",
		})

	if result.Error != nil {
		log.Printf("❌ [STRIPE CB] Error actualizando config: %v", result.Error)
	}

	log.Printf("✅ [STRIPE CB] Cuenta %s activada (charges=%v, payouts=%v)", accountID, chargesEnabled, payoutsEnabled)

	c.Redirect(http.StatusFound, fmt.Sprintf("/integrations?stripe_success=1&branch_id=%s", branchIDStr))
}

// ============================================
// DELETE /api/payment-config/stripe/:branch_id
// Desconecta Stripe Connect
// ============================================

func DisconnectStripeConnect(c *gin.Context) {
	userInterface, _ := c.Get("user")
	user := userInterface.(*models.User)
	branchID := c.Param("branch_id")

	var branch models.MyBusinessInfo
	if err := config.DB.Where("id = ? AND user_id = ?", branchID, user.ID).First(&branch).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Sucursal no encontrada"})
		return
	}

	// Opcionalmente: revocar la cuenta en Stripe
	var cfg models.PaymentConfig
	if err := config.DB.Where("branch_id = ? AND user_id = ?", branch.ID, user.ID).First(&cfg).Error; err == nil {
		if cfg.StripeAccountID != "" {
			stripeKey := os.Getenv("STRIPE_SECRET_KEY")
			if stripeKey != "" {
				stripe.Key = stripeKey
				// account.Del revoca el acceso — solo si Anthropic/Attomos es la plataforma
				// account.Del(cfg.StripeAccountID, nil)
			}
		}
	}

	config.DB.Model(&models.PaymentConfig{}).
		Where("branch_id = ? AND user_id = ?", branch.ID, user.ID).
		Updates(map[string]interface{}{
			"stripe_enabled":         false,
			"stripe_account_id":      "",
			"stripe_account_status":  "",
			"stripe_payouts_enabled": false,
			"stripe_charges_enabled": false,
			"stripe_connected_at":    nil,
			"stripe_onboarding_url":  "",
		})

	log.Printf("✅ [STRIPE CONNECT] Desconectado para sucursal %d del usuario %d", branch.ID, user.ID)

	c.JSON(http.StatusOK, gin.H{"message": "Stripe desconectado exitosamente"})
}

// ============================================
// PATCH /api/payment-config/settings/:branch_id
// Actualiza configuración general (ej: paymentRequiredForBooking)
// ============================================

type PaymentSettingsRequest struct {
	PaymentRequiredForBooking bool `json:"paymentRequiredForBooking"`
}

func UpdatePaymentSettings(c *gin.Context) {
	userInterface, _ := c.Get("user")
	user := userInterface.(*models.User)
	branchID := c.Param("branch_id")

	var req PaymentSettingsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos inválidos"})
		return
	}

	var branch models.MyBusinessInfo
	if err := config.DB.Where("id = ? AND user_id = ?", branchID, user.ID).First(&branch).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Sucursal no encontrada"})
		return
	}

	config.DB.Model(&models.PaymentConfig{}).
		Where("branch_id = ? AND user_id = ?", branch.ID, user.ID).
		Update("payment_required_for_booking", req.PaymentRequiredForBooking)

	c.JSON(http.StatusOK, gin.H{"message": "Configuración actualizada"})
}

// ============================================
// HELPERS
// ============================================

// maskCLABE enmascara la CLABE para mostrar solo los últimos 4 dígitos
func maskCLABE(clabe string) string {
	if len(clabe) < 4 {
		return clabe
	}
	return "•••••••••••••• " + clabe[len(clabe)-4:]
}

// GetBotPaymentConfig — GET /api/bot/payment-config/:branch_id
// Autenticado con BOT_API_TOKEN (Bearer token interno).
// Lo llama el bot AtomicBot al arrancar para cargar la config de pagos.
func GetBotPaymentConfig(c *gin.Context) {
	auth := c.GetHeader("Authorization")
	botToken := os.Getenv("BOT_API_TOKEN")
	if botToken == "" || auth != "Bearer "+botToken {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autorizado"})
		return
	}

	branchID := c.Param("branch_id")
	if branchID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "branchId requerido"})
		return
	}

	var cfg models.PaymentConfig
	err := config.DB.Where("branch_id = ?", branchID).First(&cfg).Error
	if err != nil {
		// Sin config todavía — responder vacío en lugar de error
		c.JSON(http.StatusOK, gin.H{
			"configured":                false,
			"speiEnabled":               false,
			"clabeNumber":               "",
			"bankName":                  "",
			"accountName":               "",
			"stripeEnabled":             false,
			"stripeAccountId":           "",
			"stripeAccountStatus":       "",
			"stripeChargesEnabled":      false,
			"paymentRequiredForBooking": false,
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"configured":                true,
		"speiEnabled":               cfg.SPEIEnabled,
		"clabeNumber":               cfg.CLABENumber, // CLABE sin enmascarar para el bot
		"bankName":                  cfg.BankName,
		"accountName":               cfg.AccountName,
		"stripeEnabled":             cfg.StripeEnabled,
		"stripeAccountId":           cfg.StripeAccountID,
		"stripeAccountStatus":       cfg.StripeAccountStatus,
		"stripeChargesEnabled":      cfg.StripeChargesEnabled,
		"paymentRequiredForBooking": cfg.PaymentRequiredForBooking,
	})
}

// ============================================================
// POST /api/payment-config/stripe/payment-link
// Llamado por el bot para generar un Stripe Payment Link
// Autenticado con BOT_API_TOKEN (Bearer token interno)
// ============================================================

type PaymentLinkRequest struct {
	ServiceName string  `json:"serviceName"`
	Amount      float64 `json:"amount"` // en MXN, 0 = sin monto fijo
	BranchID    string  `json:"branchId"`
}

func CreateBotPaymentLink(c *gin.Context) {
	// Auth: token interno del bot (no JWT de usuario)
	auth := c.GetHeader("Authorization")
	botToken := os.Getenv("BOT_API_TOKEN")
	if botToken == "" || auth != "Bearer "+botToken {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autorizado"})
		return
	}

	var req PaymentLinkRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos inválidos"})
		return
	}

	if req.BranchID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "branchId requerido"})
		return
	}

	stripeKey := os.Getenv("STRIPE_SECRET_KEY")
	if stripeKey == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Stripe no configurado"})
		return
	}

	// Verificar que la sucursal tiene Stripe Connect activo
	var cfg models.PaymentConfig
	if err := config.DB.Where("branch_id = ? AND stripe_enabled = ?", req.BranchID, true).First(&cfg).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Stripe no configurado para esta sucursal"})
		return
	}

	if cfg.StripeAccountID == "" || !cfg.StripeChargesEnabled {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Cuenta Stripe no activa para cobros"})
		return
	}

	stripe.Key = stripeKey

	amountCents := int64(req.Amount * 100)
	if amountCents <= 0 {
		amountCents = 100 // mínimo $1 MXN
	}

	// Paso 1: crear Price con product_data inline en la cuenta conectada
	priceParams := &stripe.PriceParams{
		Currency:   stripe.String("mxn"),
		UnitAmount: stripe.Int64(amountCents),
		ProductData: &stripe.PriceProductDataParams{
			Name: stripe.String(req.ServiceName),
		},
	}
	priceParams.SetStripeAccount(cfg.StripeAccountID)

	createdPrice, err := price.New(priceParams)
	if err != nil {
		log.Printf("❌ [PaymentLink] Error creando Price para sucursal %s: %v", req.BranchID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al crear precio"})
		return
	}

	// Paso 2: crear Payment Link con el Price recién creado
	paymentLinkParams := &stripe.PaymentLinkParams{
		LineItems: []*stripe.PaymentLinkLineItemParams{
			{
				Price:    stripe.String(createdPrice.ID),
				Quantity: stripe.Int64(1),
			},
		},
	}
	paymentLinkParams.SetStripeAccount(cfg.StripeAccountID)

	link, err := paymentlink.New(paymentLinkParams)
	if err != nil {
		log.Printf("❌ [PaymentLink] Error creando PaymentLink para sucursal %s: %v", req.BranchID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al crear link de pago"})
		return
	}

	log.Printf("✅ [PaymentLink] Link creado: %s para sucursal %s", link.URL, req.BranchID)

	c.JSON(http.StatusOK, gin.H{"url": link.URL})
}
