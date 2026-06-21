package handlers

import (
	"attomos/config"
	"attomos/models"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	stripe "github.com/stripe/stripe-go/v78"
	"github.com/stripe/stripe-go/v78/checkout/session"
	"github.com/stripe/stripe-go/v78/paymentintent"
)

// ─── Public store listing ────────────────────────────────────────────────────

// GetNindaDirectory - GET /ninda
// Página pública del directorio de negocios
func GetNindaDirectory(c *gin.Context) {
	c.HTML(http.StatusOK, "ninda-directory.html", gin.H{})
}

// GetNindaStore - GET /ninda/:branch_id
// Página pública del negocio con sus productos
func GetNindaStore(c *gin.Context) {
	c.HTML(http.StatusOK, "ninda-store.html", gin.H{})
}

// GetNindaMap - GET /ninda/map
// Demo de rastreo de pedido en tiempo real
func GetNindaMap(c *gin.Context) {
	c.HTML(http.StatusOK, "ninda-map.html", gin.H{})
}

// GetNindaLogin - GET /ninda/login
func GetNindaLogin(c *gin.Context) {
	c.HTML(http.StatusOK, "ninda/login-ninda.html", gin.H{})
}

// GetNindaRegister - GET /ninda/register
func GetNindaRegister(c *gin.Context) {
	c.HTML(http.StatusOK, "ninda/register-ninda.html", gin.H{})
}

// ─── API: Directory ──────────────────────────────────────────────────────────

// APIGetStores - GET /api/ninda/stores
// Lista todos los negocios con Stripe Connect activo o SPEI configurado
func APIGetStores(c *gin.Context) {
	businessType := c.Query("type")
	search := strings.ToLower(c.Query("q"))

	// Traer todas las sucursales que tienen al menos un método de pago
	var configs []models.PaymentConfig
	query := config.DB.Where("stripe_charges_enabled = ? OR spei_enabled = ?", true, true)
	if err := query.Find(&configs).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error obteniendo tiendas"})
		return
	}

	// Construir mapa branchID → config
	cfgMap := make(map[uint]models.PaymentConfig)
	branchIDs := make([]uint, 0, len(configs))
	for _, cfg := range configs {
		cfgMap[cfg.BranchID] = cfg
		branchIDs = append(branchIDs, cfg.BranchID)
	}

	if len(branchIDs) == 0 {
		c.JSON(http.StatusOK, gin.H{"stores": []gin.H{}})
		return
	}

	// Traer sucursales
	var branches []models.MyBusinessInfo
	db := config.DB.Where("id IN ?", branchIDs)
	if businessType != "" {
		db = db.Where("business_type = ?", businessType)
	}
	if err := db.Find(&branches).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error obteniendo negocios"})
		return
	}

	stores := make([]gin.H, 0, len(branches))
	for _, b := range branches {
		// Filtrar por búsqueda
		if search != "" {
			haystack := strings.ToLower(b.BusinessName + " " + b.BusinessType + " " + b.Location.City)
			if !strings.Contains(haystack, search) {
				continue
			}
		}

		cfg := cfgMap[b.ID]

		// Imagen del primer servicio disponible
		coverImg := ""
		for _, svc := range b.Services {
			if len(svc.ImageUrls) > 0 && svc.ImageUrls[0] != "" {
				coverImg = svc.ImageUrls[0]
				break
			}
			if svc.ImageURL != "" {
				coverImg = svc.ImageURL
				break
			}
		}

		stores = append(stores, gin.H{
			"id":            b.ID,
			"name":          b.BusinessName,
			"businessType":  b.BusinessType,
			"description":   b.Description,
			"city":          b.Location.City,
			"state":         b.Location.State,
			"coverImage":    coverImg,
			"servicesCount": len(b.Services),
			"hasStripe":     cfg.StripeChargesEnabled,
			"hasSPEI":       cfg.SPEIEnabled,
		})
	}

	c.JSON(http.StatusOK, gin.H{"stores": stores})
}

// APIGetStore - GET /api/ninda/stores/:branch_id
// Detalle público de un negocio con sus productos y métodos de pago
func APIGetStore(c *gin.Context) {
	branchIDStr := c.Param("branch_id")
	branchID, err := strconv.ParseUint(branchIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID inválido"})
		return
	}

	var branch models.MyBusinessInfo
	if err := config.DB.First(&branch, branchID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Negocio no encontrado"})
		return
	}

	// Obtener config de pagos
	var cfg models.PaymentConfig
	hasCfg := config.DB.Where("branch_id = ?", branch.ID).First(&cfg).Error == nil

	// Buscar el agente de WhatsApp activo para esta sucursal
	var agent models.Agent
	hasAgent := config.DB.Where("branch_id = ? AND is_active = ?", branch.ID, true).
		First(&agent).Error == nil

	whatsappNumber := ""
	if hasAgent {
		whatsappNumber = agent.MetaDisplayNumber
		if whatsappNumber == "" {
			whatsappNumber = agent.PhoneNumber
		}
	}

	// Construir servicios para el frontend
	services := make([]gin.H, 0, len(branch.Services))
	for i, svc := range branch.Services {
		imgs := svc.ImageUrls
		if len(imgs) == 0 && svc.ImageURL != "" {
			imgs = []string{svc.ImageURL}
		}
		price := svc.Price
		if svc.PriceType == "promotion" && svc.PromoPrice > 0 {
			price = svc.PromoPrice
		}
		services = append(services, gin.H{
			"index":         i,
			"title":         svc.Title,
			"description":   svc.Description,
			"price":         price,
			"originalPrice": svc.OriginalPrice,
			"promoPrice":    svc.PromoPrice,
			"priceType":     svc.PriceType,
			"images":        imgs,
			"promoDays":     svc.PromoDays,
		})
	}

	response := gin.H{
		"id":             branch.ID,
		"name":           branch.BusinessName,
		"businessType":   branch.BusinessType,
		"description":    branch.Description,
		"website":        branch.Website,
		"email":          branch.Email,
		"phone":          branch.PhoneNumber,
		"whatsappNumber": whatsappNumber,
		"location": gin.H{
			"address":      branch.Location.Address,
			"number":       branch.Location.Number,
			"neighborhood": branch.Location.Neighborhood,
			"city":         branch.Location.City,
			"state":        branch.Location.State,
		},
		"socialMedia": gin.H{
			"instagram": branch.SocialMedia.Instagram,
			"facebook":  branch.SocialMedia.Facebook,
		},
		"services": services,
		"payments": gin.H{
			"hasStripe":   hasCfg && cfg.StripeChargesEnabled,
			"hasSPEI":     hasCfg && cfg.SPEIEnabled,
			"clabeNumber": maskCLABEPublic(cfg.CLABENumber),
			"bankName":    cfg.BankName,
			"accountName": cfg.AccountName,
		},
	}

	c.JSON(http.StatusOK, gin.H{"store": response})
}

// ─── API: Checkout ───────────────────────────────────────────────────────────

// NindaCheckoutRequest estructura del pedido
type NindaCheckoutRequest struct {
	BranchID      uint            `json:"branchId" binding:"required"`
	Items         []NindaCartItem `json:"items" binding:"required"`
	CustomerName  string          `json:"customerName" binding:"required"`
	CustomerPhone string          `json:"customerPhone" binding:"required"`
	CustomerEmail string          `json:"customerEmail"`
	Notes         string          `json:"notes"`
	// Source: "ninda" = directo, "bot" = viene desde WhatsApp via ?item=
	Source  string `json:"source"`
	BotItem string `json:"botItem"`
}

type NindaCartItem struct {
	ServiceIndex int     `json:"serviceIndex"`
	Title        string  `json:"title"`
	Price        float64 `json:"price"`
	Quantity     int     `json:"quantity"`
}

// APICreateCheckout - POST /api/ninda/checkout
// Crea un Stripe Checkout Session para el pago de productos del negocio
func APICreateCheckout(c *gin.Context) {
	var req NindaCheckoutRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos inválidos: " + err.Error()})
		return
	}

	// Verificar que el negocio existe y tiene Stripe activo
	var branch models.MyBusinessInfo
	if err := config.DB.First(&branch, req.BranchID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Negocio no encontrado"})
		return
	}

	var cfg models.PaymentConfig
	if err := config.DB.Where("branch_id = ?", req.BranchID).First(&cfg).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Este negocio no tiene pagos configurados"})
		return
	}

	if !cfg.StripeChargesEnabled || cfg.StripeAccountID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Este negocio no acepta pagos con tarjeta"})
		return
	}

	stripe.Key = os.Getenv("STRIPE_SECRET_KEY")

	// Construir line items de Stripe
	lineItems := make([]*stripe.CheckoutSessionLineItemParams, 0, len(req.Items))
	totalAmount := int64(0)

	for _, item := range req.Items {
		if item.Quantity <= 0 {
			item.Quantity = 1
		}
		amountCents := int64(item.Price * 100)
		totalAmount += amountCents * int64(item.Quantity)

		// Usar price_data inline — no requiere crear producto/precio previos
		// y funciona directamente en la cuenta conectada del negocio
		lineItems = append(lineItems, &stripe.CheckoutSessionLineItemParams{
			PriceData: &stripe.CheckoutSessionLineItemPriceDataParams{
				Currency:   stripe.String("mxn"),
				UnitAmount: stripe.Int64(amountCents),
				ProductData: &stripe.CheckoutSessionLineItemPriceDataProductDataParams{
					Name: stripe.String(item.Title),
				},
			},
			Quantity: stripe.Int64(int64(item.Quantity)),
		})
	}

	baseURL := os.Getenv("BASE_URL")
	if baseURL == "" {
		baseURL = "http://localhost:8080"
	}

	// Metadata para el webhook
	itemsSummary := buildItemsSummary(req.Items)

	// Determinar source: bot (viene de WhatsApp via ?item=) o ninda (directo)
	source := req.Source
	if source == "" {
		source = "ninda"
	}

	metadata := map[string]string{
		"branch_id":      fmt.Sprintf("%d", req.BranchID),
		"branch_name":    branch.BusinessName,
		"customer_name":  req.CustomerName,
		"customer_phone": req.CustomerPhone,
		"items_summary":  itemsSummary,
		"notes":          req.Notes,
		"source":         source,
	}
	if req.CustomerEmail != "" {
		metadata["customer_email"] = req.CustomerEmail
	}
	// Si viene del bot, guardar el nombre del servicio original para el resumen
	if req.BotItem != "" {
		metadata["bot_item"] = req.BotItem
	}

	// Crear Checkout Session en la cuenta conectada del negocio
	params := &stripe.CheckoutSessionParams{
		PaymentMethodTypes: stripe.StringSlice([]string{"card"}),
		LineItems:          lineItems,
		Mode:               stripe.String(string(stripe.CheckoutSessionModePayment)),
		SuccessURL:         stripe.String(fmt.Sprintf("%s/ninda/%d?payment=success&session_id={CHECKOUT_SESSION_ID}", baseURL, req.BranchID)),
		CancelURL:          stripe.String(fmt.Sprintf("%s/ninda/%d?payment=cancelled", baseURL, req.BranchID)),
		Metadata:           metadata,
	}

	// Pago directo a la cuenta conectada del negocio
	params.SetStripeAccount(cfg.StripeAccountID)

	// Si el cliente tiene email, pre-llenarlo
	if req.CustomerEmail != "" {
		params.CustomerEmail = stripe.String(req.CustomerEmail)
	}

	sess, err := session.New(params)
	if err != nil {
		log.Printf("❌ [Ninda] Error creando Checkout Session: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al iniciar el pago: " + err.Error()})
		return
	}

	log.Printf("✅ [Ninda] Checkout Session creado: %s | Negocio: %s | Total: $%.2f MXN",
		sess.ID, branch.BusinessName, float64(totalAmount)/100)

	c.JSON(http.StatusOK, gin.H{
		"checkoutUrl": sess.URL,
		"sessionId":   sess.ID,
		"total":       float64(totalAmount) / 100,
	})
}

// APIConfirmOrder - POST /api/ninda/confirm
// Verifica el pago completado y envía resumen por WhatsApp
func APIConfirmOrder(c *gin.Context) {
	var req struct {
		SessionID string `json:"sessionId" binding:"required"`
		BranchID  uint   `json:"branchId" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos inválidos"})
		return
	}

	// Obtener config de pagos para la cuenta conectada
	var cfg models.PaymentConfig
	if err := config.DB.Where("branch_id = ?", req.BranchID).First(&cfg).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Negocio no encontrado"})
		return
	}

	stripe.Key = os.Getenv("STRIPE_SECRET_KEY")

	// Recuperar sesión desde la cuenta conectada
	params := &stripe.CheckoutSessionParams{}
	params.SetStripeAccount(cfg.StripeAccountID)
	sess, err := session.Get(req.SessionID, params)
	if err != nil {
		log.Printf("❌ [Ninda] Error obteniendo sesión: %v", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Sesión no encontrada"})
		return
	}

	if sess.PaymentStatus != stripe.CheckoutSessionPaymentStatusPaid {
		c.JSON(http.StatusBadRequest, gin.H{"error": "El pago no está completado"})
		return
	}

	// Extraer metadata
	customerName := sess.Metadata["customer_name"]
	customerPhone := sess.Metadata["customer_phone"]
	branchName := sess.Metadata["branch_name"]
	itemsSummary := sess.Metadata["items_summary"]
	notes := sess.Metadata["notes"]
	source := sess.Metadata["source"]

	total := float64(sess.AmountTotal) / 100

	// Construir mensaje de WhatsApp (con contexto de bot si aplica)
	waMsg := buildWhatsAppMessage(branchName, customerName, itemsSummary, total, notes, sess.ID, source)

	// Obtener número de WhatsApp del agente activo
	var agent models.Agent
	waURL := ""
	if config.DB.Where("branch_id = ? AND is_active = ?", req.BranchID, true).First(&agent).Error == nil {
		phone := agent.MetaDisplayNumber
		if phone == "" {
			phone = agent.PhoneNumber
		}
		phone = sanitizePhone(phone)
		if phone != "" {
			waURL = fmt.Sprintf("https://wa.me/%s?text=%s", phone, waMsg)
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"success":       true,
		"orderSummary":  itemsSummary,
		"total":         total,
		"customerName":  customerName,
		"customerPhone": customerPhone,
		"whatsappUrl":   waURL,
		"message":       waMsg,
	})
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

func buildItemsSummary(items []NindaCartItem) string {
	parts := make([]string, 0, len(items))
	for _, item := range items {
		parts = append(parts, fmt.Sprintf("%dx %s ($%.0f)", item.Quantity, item.Title, item.Price))
	}
	return strings.Join(parts, ", ")
}

// buildWhatsAppMessage construye el mensaje pre-llenado para WhatsApp.
// source: "bot" = viene del agente de WhatsApp, "ninda" = pedido directo
func buildWhatsAppMessage(branchName, customerName, items string, total float64, notes, sessionID, source string) string {
	now := time.Now().Format("02/01/2006 15:04")

	header := "✅ *Pedido confirmado - " + branchName + "*"
	if source == "bot" {
		header = "✅ *Pago de cita recibido - " + branchName + "*"
	}

	msg := fmt.Sprintf(
		"%s%%0A%%0A"+
			"👤 *Cliente:* %s%%0A"+
			"🛒 *Concepto:* %s%%0A"+
			"💰 *Total pagado:* $%.0f MXN%%0A"+
			"📅 *Fecha:* %s%%0A"+
			"🔖 *Referencia:* %s",
		header, customerName, items, total, now, sessionID[len(sessionID)-8:],
	)
	if notes != "" {
		msg += fmt.Sprintf("%%0A📝 *Notas:* %s", notes)
	}
	if source == "bot" {
		msg += "%%0A%%0A_Pago procesado vía Ninda · Originado desde el agente WhatsApp_"
	} else {
		msg += "%%0A%%0A_Pago procesado a través de Ninda_"
	}
	return msg
}

func sanitizePhone(phone string) string {
	// Eliminar todo excepto dígitos
	cleaned := ""
	for _, ch := range phone {
		if ch >= '0' && ch <= '9' {
			cleaned += string(ch)
		}
	}
	// Asegurar prefijo mexicano
	if len(cleaned) == 10 {
		cleaned = "52" + cleaned
	}
	return cleaned
}

func maskCLABEPublic(clabe string) string {
	if len(clabe) < 6 {
		return clabe
	}
	return clabe[:4] + strings.Repeat("•", len(clabe)-8) + clabe[len(clabe)-4:]
}

// Obtener PaymentIntent para verificación adicional
func getNindaPaymentIntent(piID, connectedAccountID string) (*stripe.PaymentIntent, error) {
	stripe.Key = os.Getenv("STRIPE_SECRET_KEY")
	params := &stripe.PaymentIntentParams{}
	params.SetStripeAccount(connectedAccountID)
	return paymentintent.Get(piID, params)
}
