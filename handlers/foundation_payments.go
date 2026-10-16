package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"attomos/config"
	"attomos/models"

	"github.com/gin-gonic/gin"
	stripe "github.com/stripe/stripe-go/v78"
	"github.com/stripe/stripe-go/v78/account"
	"github.com/stripe/stripe-go/v78/accountlink"
	"github.com/stripe/stripe-go/v78/checkout/session"
	"github.com/stripe/stripe-go/v78/loginlink"
	"github.com/stripe/stripe-go/v78/subscription"
	"github.com/stripe/stripe-go/v78/webhook"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// =============================================================================
// ATTOMOS FOUNDATION — pagos con Stripe Connect (México)
//
// Cada rescatista conecta su cuenta Express (persona física). Los cobros son
// "direct charges" en SU cuenta: el dinero le llega directo y Attomos nunca lo
// toca. Comisión opcional para Attomos con FOUNDATION_FEE_PERCENT (0 = nada).
//
// Webhook de Connect: POST /webhook/stripe/foundation
//   En Stripe → Developers → Webhooks → "Add endpoint" → marcar
//   "Listen to events on Connected accounts". Eventos:
//     checkout.session.completed, checkout.session.expired,
//     invoice.paid, invoice.payment_failed,
//     customer.subscription.updated, customer.subscription.deleted,
//     account.updated
//   Secreto en STRIPE_FOUNDATION_WEBHOOK_SECRET.
// =============================================================================

func foundationStripeKey() bool {
	k := os.Getenv("STRIPE_SECRET_KEY")
	if k == "" {
		return false
	}
	stripe.Key = k
	return true
}

func foundationBaseURL(c *gin.Context) string {
	if b := strings.TrimRight(os.Getenv("BASE_URL"), "/"); b != "" {
		return b
	}
	scheme := "https"
	if c.Request.TLS == nil && strings.HasPrefix(c.Request.Host, "localhost") {
		scheme = "http"
	}
	return scheme + "://" + c.Request.Host
}

func foundationFeePercent() float64 {
	v, err := strconv.ParseFloat(os.Getenv("FOUNDATION_FEE_PERCENT"), 64)
	if err != nil || v <= 0 || v >= 100 {
		return 0
	}
	return math.Round(v*100) / 100
}

func toCents(v float64) int64 { return int64(math.Round(v * 100)) }

// ─── Stripe Connect de la rescatista ─────────────────────────────────────────

func foundationSyncStripe(r *models.FoundationRescuer) error {
	if r.StripeAccountID == "" {
		return nil
	}
	acc, err := account.GetByID(r.StripeAccountID, nil)
	if err != nil {
		return err
	}
	foundationApplyAccount(r, acc)
	return nil
}

func foundationApplyAccount(r *models.FoundationRescuer, acc *stripe.Account) {
	status := "pending"
	if acc.ChargesEnabled && acc.PayoutsEnabled {
		status = "active"
	} else if acc.ChargesEnabled {
		status = "restricted"
	} else if acc.DetailsSubmitted {
		status = "pending_verification"
	}
	updates := map[string]interface{}{
		"stripe_status":          status,
		"stripe_charges_enabled": acc.ChargesEnabled,
		"stripe_payouts_enabled": acc.PayoutsEnabled,
	}
	if acc.ChargesEnabled && r.StripeConnectedAt == nil {
		now := time.Now()
		updates["stripe_connected_at"] = &now
		r.StripeConnectedAt = &now
	}
	r.StripeStatus, r.StripeChargesEnabled, r.StripePayoutsEnabled = status, acc.ChargesEnabled, acc.PayoutsEnabled
	config.DB.Model(&models.FoundationRescuer{}).Where("id = ?", r.ID).Updates(updates)
}

func foundationStripeJSON(r *models.FoundationRescuer) gin.H {
	return gin.H{
		"connected":      r.StripeAccountID != "",
		"status":         r.StripeStatus,
		"chargesEnabled": r.StripeChargesEnabled,
		"payoutsEnabled": r.StripePayoutsEnabled,
		"ready":          r.PaymentsReady(),
	}
}

func foundationOnboardingLink(c *gin.Context, r *models.FoundationRescuer) (string, error) {
	base := foundationBaseURL(c)
	link, err := accountlink.New(&stripe.AccountLinkParams{
		Account:    stripe.String(r.StripeAccountID),
		RefreshURL: stripe.String(base + "/api/foundation/stripe/refresh"),
		ReturnURL:  stripe.String(base + "/api/foundation/stripe/return"),
		Type:       stripe.String("account_onboarding"),
	})
	if err != nil {
		return "", err
	}
	return link.URL, nil
}

// POST /api/foundation/stripe/connect → { url }
func FoundationStripeConnect(c *gin.Context) {
	r := foundationRescuerFromCtx(c)
	u := foundationCurrentUser(c)
	if r.PaymentProvider() != "stripe" {
		badReq(c, "Stripe solo está disponible para rescatistas en México", "")
		return
	}
	if !foundationStripeKey() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Stripe no está configurado"})
		return
	}
	if r.StripeAccountID == "" {
		params := &stripe.AccountParams{
			Type:         stripe.String("express"),
			Country:      stripe.String("MX"),
			Email:        stripe.String(u.Email),
			BusinessType: stripe.String("individual"), // persona física
			Capabilities: &stripe.AccountCapabilitiesParams{
				CardPayments: &stripe.AccountCapabilitiesCardPaymentsParams{Requested: stripe.Bool(true)},
				Transfers:    &stripe.AccountCapabilitiesTransfersParams{Requested: stripe.Bool(true)},
			},
			BusinessProfile: &stripe.AccountBusinessProfileParams{
				MCC:                stripe.String("8398"), // Organizaciones de servicio social / caridad
				Name:               stripe.String(r.Name),
				ProductDescription: stripe.String("Donaciones mensuales y únicas para el rescate de gatos y perros"),
				URL:                stripe.String(foundationBaseURL(c) + "/foundation/r/" + r.Slug),
			},
		}
		params.AddMetadata("foundation_rescuer_id", idStr(r.ID))
		acc, err := account.New(params)
		if err != nil {
			log.Printf("❌ [Foundation] Error creando cuenta Stripe (rescatista %d): %v", r.ID, err)
			c.JSON(http.StatusBadGateway, gin.H{"error": "No se pudo crear tu cuenta de Stripe"})
			return
		}
		r.StripeAccountID, r.StripeStatus = acc.ID, "pending"
		config.DB.Model(&models.FoundationRescuer{}).Where("id = ?", r.ID).
			Updates(map[string]interface{}{"stripe_account_id": acc.ID, "stripe_status": "pending"})
		log.Printf("✅ [Foundation] Cuenta Stripe %s creada para rescatista %d", acc.ID, r.ID)
	}
	url, err := foundationOnboardingLink(c, r)
	if err != nil {
		log.Printf("❌ [Foundation] Error generando link de Stripe: %v", err)
		c.JSON(http.StatusBadGateway, gin.H{"error": "No se pudo abrir Stripe"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"url": url})
}

// GET /api/foundation/stripe/refresh — el link expiró: generar otro
func FoundationStripeRefresh(c *gin.Context) {
	r := foundationRescuerFromCtx(c)
	if r.StripeAccountID == "" || !foundationStripeKey() {
		c.Redirect(http.StatusFound, "/foundation/panel?stripe=error#cuenta")
		return
	}
	url, err := foundationOnboardingLink(c, r)
	if err != nil {
		c.Redirect(http.StatusFound, "/foundation/panel?stripe=error#cuenta")
		return
	}
	c.Redirect(http.StatusFound, url)
}

// GET /api/foundation/stripe/return — regresa del onboarding
func FoundationStripeReturn(c *gin.Context) {
	r := foundationRescuerFromCtx(c)
	if foundationStripeKey() {
		if err := foundationSyncStripe(r); err != nil {
			log.Printf("⚠️  [Foundation] No se pudo sincronizar Stripe (rescatista %d): %v", r.ID, err)
		}
	}
	c.Redirect(http.StatusFound, "/foundation/panel?stripe=return#cuenta")
}

// GET /api/foundation/stripe/status
func FoundationStripeStatus(c *gin.Context) {
	r := foundationRescuerFromCtx(c)
	if r.StripeAccountID != "" && foundationStripeKey() {
		_ = foundationSyncStripe(r)
	}
	c.JSON(http.StatusOK, gin.H{"stripe": foundationStripeJSON(r)})
}

// POST /api/foundation/stripe/dashboard → { url } panel Express de Stripe
func FoundationStripeDashboard(c *gin.Context) {
	r := foundationRescuerFromCtx(c)
	if r.StripeAccountID == "" || !foundationStripeKey() {
		badReq(c, "Primero conecta tu cuenta de Stripe", "")
		return
	}
	link, err := loginlink.New(&stripe.LoginLinkParams{Account: stripe.String(r.StripeAccountID)})
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "Termina de configurar tu cuenta de Stripe para ver tu panel"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"url": link.URL})
}

// ─── Checkout del donador ────────────────────────────────────────────────────

type foundationCheckoutReq struct {
	Slug   string  `json:"slug"`
	Type   string  `json:"type"` // subscription | one_time
	PlanID string  `json:"planId"`
	Amount float64 `json:"amount"`
}

// POST /api/foundation/checkout → { url }
func FoundationCreateCheckout(c *gin.Context) {
	u := foundationCurrentUser(c)
	var req foundationCheckoutReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badReq(c, "Datos inválidos", "")
		return
	}
	var r models.FoundationRescuer
	if err := foundationLoadRescuer(config.DB.Where("slug = ? AND published = ?", req.Slug, true)).First(&r).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "No encontramos a este rescatista"})
		return
	}
	if r.UserID == u.ID {
		badReq(c, "No puedes apoyar tu propia página", "")
		return
	}
	if !r.PaymentsReady() {
		badReq(c, "Este rescatista todavía no activa sus cobros", "")
		return
	}
	if !foundationStripeKey() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Pagos no disponibles por el momento"})
		return
	}
	cur := r.Currency()
	pledge := models.FoundationPledge{
		DonorID: u.ID, RescuerID: r.ID, Type: req.Type, Currency: cur,
		Status: models.FoundationPledgePending, Provider: "stripe", StripeAccountID: r.StripeAccountID,
	}
	var productName, productDesc string

	switch req.Type {
	case models.FoundationPledgeSubscription:
		if req.PlanID != "" && req.PlanID != "custom" {
			var plan *models.FoundationPlan
			for i := range r.Plans {
				if idStr(r.Plans[i].ID) == req.PlanID {
					plan = &r.Plans[i]
				}
			}
			if plan == nil {
				badReq(c, "Ese plan ya no existe", "")
				return
			}
			pledge.Amount, pledge.PlanID, pledge.PlanName = plan.Amount, &plan.ID, plan.Name
			productName = "Plan " + plan.Name + " · " + r.Name
			productDesc = plan.Description
		} else {
			if !r.AllowCustomMonthly {
				badReq(c, "Este rescatista no acepta montos libres", "")
				return
			}
			amt := round2(req.Amount)
			if amt < r.MinCustomMonthly || amt < foundationMinAmount(cur) || amt > 1000000 {
				badReq(c, fmt.Sprintf("El mínimo es $%s %s al mes", strconv.FormatFloat(r.MinCustomMonthly, 'f', -1, 64), cur), "amount")
				return
			}
			pledge.Amount = amt
			productName = "Suscripción mensual · " + r.Name
		}
	case models.FoundationPledgeOneTime:
		if !r.OneTimeEnabled {
			badReq(c, "Este rescatista no acepta donaciones únicas", "")
			return
		}
		amt := round2(req.Amount)
		ok := false
		for _, v := range r.Suggested() {
			if v == amt {
				ok = true
			}
		}
		if !ok && (!r.OneTimeAllowCustom || amt < r.OneTimeMin || amt < foundationMinAmount(cur) || amt > 1000000) {
			badReq(c, fmt.Sprintf("El mínimo es $%s %s", strconv.FormatFloat(r.OneTimeMin, 'f', -1, 64), cur), "amount")
			return
		}
		pledge.Amount = amt
		productName = "Donación única · " + r.Name
	default:
		badReq(c, "Tipo de aporte inválido", "")
		return
	}

	if err := config.DB.Create(&pledge).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "No se pudo iniciar el pago"})
		return
	}

	base := foundationBaseURL(c)
	tab := map[string]string{"subscription": "mensual", "one_time": "unica"}[pledge.Type]
	meta := map[string]string{
		"foundation_pledge_id":  idStr(pledge.ID),
		"foundation_rescuer_id": idStr(r.ID),
		"foundation_donor_id":   idStr(u.ID),
		"foundation_type":       pledge.Type,
	}
	productData := &stripe.CheckoutSessionLineItemPriceDataProductDataParams{Name: stripe.String(productName)}
	if productDesc != "" {
		productData.Description = stripe.String(productDesc)
	}
	priceData := &stripe.CheckoutSessionLineItemPriceDataParams{
		Currency:    stripe.String(strings.ToLower(cur)),
		UnitAmount:  stripe.Int64(toCents(pledge.Amount)),
		ProductData: productData,
	}
	params := &stripe.CheckoutSessionParams{
		LineItems:         []*stripe.CheckoutSessionLineItemParams{{PriceData: priceData, Quantity: stripe.Int64(1)}},
		SuccessURL:        stripe.String(base + "/foundation/r/" + r.Slug + "?checkout=success&session_id={CHECKOUT_SESSION_ID}"),
		CancelURL:         stripe.String(base + "/foundation/r/" + r.Slug + "?checkout=cancel&tab=" + tab),
		CustomerEmail:     stripe.String(u.Email),
		ClientReferenceID: stripe.String(idStr(pledge.ID)),
		Locale:            stripe.String("es"),
		Metadata:          meta,
	}
	fee := foundationFeePercent()
	if pledge.IsMonthly() {
		priceData.Recurring = &stripe.CheckoutSessionLineItemPriceDataRecurringParams{Interval: stripe.String("month")}
		params.Mode = stripe.String(string(stripe.CheckoutSessionModeSubscription))
		params.SubscriptionData = &stripe.CheckoutSessionSubscriptionDataParams{
			Description: stripe.String(productName),
			Metadata:    meta,
		}
		if fee > 0 {
			params.SubscriptionData.ApplicationFeePercent = stripe.Float64(fee)
		}
	} else {
		params.Mode = stripe.String(string(stripe.CheckoutSessionModePayment))
		params.SubmitType = stripe.String("donate")
		params.PaymentIntentData = &stripe.CheckoutSessionPaymentIntentDataParams{
			Description: stripe.String(productName),
			Metadata:    meta,
		}
		if fee > 0 {
			params.PaymentIntentData.ApplicationFeeAmount = stripe.Int64(int64(math.Round(float64(toCents(pledge.Amount)) * fee / 100)))
		}
	}
	params.SetStripeAccount(r.StripeAccountID)

	sess, err := session.New(params)
	if err != nil {
		log.Printf("❌ [Foundation] Error creando checkout (aporte %d): %v", pledge.ID, err)
		config.DB.Model(&pledge).Update("status", models.FoundationPledgeExpired)
		c.JSON(http.StatusBadGateway, gin.H{"error": "No se pudo iniciar el pago. Intenta de nuevo."})
		return
	}
	config.DB.Model(&pledge).Update("stripe_checkout_session_id", sess.ID)
	c.JSON(http.StatusOK, gin.H{"url": sess.URL, "pledgeId": idStr(pledge.ID)})
}

// foundationFetchSession recupera la sesión con la suscripción y su última factura.
func foundationFetchSession(sessionID, accountID string) (*stripe.CheckoutSession, error) {
	p := &stripe.CheckoutSessionParams{}
	p.SetStripeAccount(accountID)
	p.AddExpand("subscription")
	p.AddExpand("subscription.latest_invoice")
	return session.Get(sessionID, p)
}

// foundationApplySession marca el aporte como pagado/activo (idempotente).
func foundationApplySession(pledge *models.FoundationPledge, sess *stripe.CheckoutSession) {
	if sess.Status != stripe.CheckoutSessionStatusComplete {
		return
	}
	if sess.PaymentStatus != stripe.CheckoutSessionPaymentStatusPaid && sess.PaymentStatus != stripe.CheckoutSessionPaymentStatusNoPaymentRequired {
		return
	}
	updates := map[string]interface{}{}
	if sess.Customer != nil {
		updates["stripe_customer_id"] = sess.Customer.ID
	}
	now := time.Now()
	if pledge.IsMonthly() {
		if pledge.Status == models.FoundationPledgePending || pledge.Status == models.FoundationPledgeExpired {
			updates["status"] = models.FoundationPledgeActive
			pledge.Status = models.FoundationPledgeActive
		}
		if sess.Subscription != nil {
			updates["stripe_subscription_id"] = sess.Subscription.ID
			pledge.StripeSubscriptionID = sess.Subscription.ID
			if sess.Subscription.CurrentPeriodEnd > 0 {
				end := time.Unix(sess.Subscription.CurrentPeriodEnd, 0)
				updates["current_period_end"] = &end
			}
		}
		config.DB.Model(pledge).Updates(updates)
		if sub := sess.Subscription; sub != nil && sub.LatestInvoice != nil && sub.LatestInvoice.AmountPaid > 0 {
			foundationRecordPayment(pledge, float64(sub.LatestInvoice.AmountPaid)/100, sub.LatestInvoice.ID, "", now)
		}
		return
	}
	if pledge.Status != models.FoundationPledgePaid {
		updates["status"] = models.FoundationPledgePaid
		pledge.Status = models.FoundationPledgePaid
	}
	intentID := ""
	if sess.PaymentIntent != nil {
		intentID = sess.PaymentIntent.ID
		updates["stripe_payment_intent_id"] = intentID
	}
	config.DB.Model(pledge).Updates(updates)
	foundationRecordPayment(pledge, float64(sess.AmountTotal)/100, "", intentID, now)
}

// foundationRecordPayment guarda un cobro una sola vez y actualiza totales.
func foundationRecordPayment(pledge *models.FoundationPledge, amount float64, invoiceID, intentID string, paidAt time.Time) {
	if invoiceID == "" && intentID == "" {
		return
	}
	pay := models.FoundationPayment{
		PledgeID: pledge.ID, RescuerID: pledge.RescuerID, Amount: amount, Currency: pledge.Currency,
		StripeInvoiceID: invoiceID, StripeIntentID: intentID, PaidAt: paidAt,
	}
	res := config.DB.Clauses(clause.OnConflict{DoNothing: true}).Create(&pay)
	if res.Error != nil || res.RowsAffected == 0 {
		return
	}
	config.DB.Model(&models.FoundationPledge{}).Where("id = ?", pledge.ID).Updates(map[string]interface{}{
		"total_paid":     gorm.Expr("total_paid + ?", amount),
		"payments_count": gorm.Expr("payments_count + 1"),
		"last_paid_at":   &paidAt,
	})
}

// POST /api/foundation/checkout/confirm { sessionId } — al volver de Stripe
func FoundationConfirmCheckout(c *gin.Context) {
	u := foundationCurrentUser(c)
	var req struct {
		SessionID string `json:"sessionId"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.SessionID == "" {
		badReq(c, "Datos inválidos", "")
		return
	}
	var pledge models.FoundationPledge
	if err := config.DB.Where("stripe_checkout_session_id = ? AND donor_id = ?", req.SessionID, u.ID).First(&pledge).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "No encontramos tu aporte"})
		return
	}
	if !foundationStripeKey() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Pagos no disponibles"})
		return
	}
	sess, err := foundationFetchSession(req.SessionID, pledge.StripeAccountID)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "No pudimos confirmar el pago"})
		return
	}
	foundationApplySession(&pledge, sess)
	config.DB.First(&pledge, pledge.ID)
	var r models.FoundationRescuer
	config.DB.Select("id, name, slug").First(&r, pledge.RescuerID)
	c.JSON(http.StatusOK, gin.H{"pledge": foundationPledgeJSON(&pledge, u.Name, r.Name, r.Slug)})
}

// POST /api/foundation/pledges/:id/cancel — cancela al final del periodo pagado
func FoundationCancelPledge(c *gin.Context) {
	u := foundationCurrentUser(c)
	var pledge models.FoundationPledge
	if err := config.DB.Where("id = ? AND donor_id = ?", c.Param("id"), u.ID).First(&pledge).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "No encontramos ese aporte"})
		return
	}
	if !pledge.IsMonthly() || pledge.StripeSubscriptionID == "" ||
		(pledge.Status != models.FoundationPledgeActive && pledge.Status != models.FoundationPledgePastDue) {
		badReq(c, "Este aporte no se puede cancelar", "")
		return
	}
	if !foundationStripeKey() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Pagos no disponibles"})
		return
	}
	p := &stripe.SubscriptionParams{CancelAtPeriodEnd: stripe.Bool(true)}
	p.SetStripeAccount(pledge.StripeAccountID)
	sub, err := subscription.Update(pledge.StripeSubscriptionID, p)
	if err != nil {
		log.Printf("❌ [Foundation] Error cancelando suscripción %s: %v", pledge.StripeSubscriptionID, err)
		c.JSON(http.StatusBadGateway, gin.H{"error": "No se pudo cancelar. Intenta de nuevo."})
		return
	}
	foundationApplySubscription(&pledge, sub)
	config.DB.First(&pledge, pledge.ID)
	var r models.FoundationRescuer
	config.DB.Select("id, name, slug").First(&r, pledge.RescuerID)
	c.JSON(http.StatusOK, gin.H{"pledge": foundationPledgeJSON(&pledge, u.Name, r.Name, r.Slug)})
}

// foundationApplySubscription sincroniza estado y periodo desde Stripe.
func foundationApplySubscription(pledge *models.FoundationPledge, sub *stripe.Subscription) {
	status := pledge.Status
	switch sub.Status {
	case stripe.SubscriptionStatusActive, stripe.SubscriptionStatusTrialing:
		status = models.FoundationPledgeActive
		if sub.CancelAtPeriodEnd {
			status = models.FoundationPledgeCanceling
		}
	case stripe.SubscriptionStatusPastDue, stripe.SubscriptionStatusUnpaid:
		status = models.FoundationPledgePastDue
	case stripe.SubscriptionStatusCanceled, stripe.SubscriptionStatusIncompleteExpired:
		status = models.FoundationPledgeCanceled
	}
	updates := map[string]interface{}{"status": status}
	if sub.CurrentPeriodEnd > 0 {
		end := time.Unix(sub.CurrentPeriodEnd, 0)
		updates["current_period_end"] = &end
	}
	if status == models.FoundationPledgeCanceled && pledge.CanceledAt == nil {
		now := time.Now()
		if sub.CanceledAt > 0 {
			now = time.Unix(sub.CanceledAt, 0)
		}
		updates["canceled_at"] = &now
	}
	config.DB.Model(&models.FoundationPledge{}).Where("id = ?", pledge.ID).Updates(updates)
	pledge.Status = status
}

// ─── Webhook de Connect ──────────────────────────────────────────────────────

// POST /webhook/stripe/foundation
func FoundationStripeWebhook(c *gin.Context) {
	body, err := io.ReadAll(io.LimitReader(c.Request.Body, 1<<20))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "body"})
		return
	}
	secret := os.Getenv("STRIPE_FOUNDATION_WEBHOOK_SECRET")
	if secret == "" {
		log.Printf("⚠️  [Foundation] STRIPE_FOUNDATION_WEBHOOK_SECRET no configurado — evento ignorado")
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "webhook no configurado"})
		return
	}
	event, err := webhook.ConstructEventWithOptions(body, c.GetHeader("Stripe-Signature"), secret,
		webhook.ConstructEventOptions{IgnoreAPIVersionMismatch: true})
	if err != nil {
		log.Printf("❌ [Foundation] Firma de webhook inválida: %v", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "firma inválida"})
		return
	}
	foundationStripeKey()

	switch event.Type {
	case "checkout.session.completed", "checkout.session.async_payment_succeeded":
		var s stripe.CheckoutSession
		if json.Unmarshal(event.Data.Raw, &s) != nil {
			break
		}
		var pledge models.FoundationPledge
		if config.DB.Where("stripe_checkout_session_id = ?", s.ID).First(&pledge).Error != nil {
			break
		}
		if full, err := foundationFetchSession(s.ID, pledge.StripeAccountID); err == nil {
			foundationApplySession(&pledge, full)
		}

	case "checkout.session.expired":
		var s stripe.CheckoutSession
		if json.Unmarshal(event.Data.Raw, &s) == nil {
			config.DB.Model(&models.FoundationPledge{}).
				Where("stripe_checkout_session_id = ? AND status = ?", s.ID, models.FoundationPledgePending).
				Update("status", models.FoundationPledgeExpired)
		}

	case "invoice.paid", "invoice.payment_succeeded":
		var inv stripe.Invoice
		if json.Unmarshal(event.Data.Raw, &inv) != nil || inv.Subscription == nil {
			break
		}
		var pledge models.FoundationPledge
		if config.DB.Where("stripe_subscription_id = ?", inv.Subscription.ID).First(&pledge).Error != nil {
			break // el primer cobro puede llegar antes que checkout.session.completed
		}
		if inv.AmountPaid > 0 {
			foundationRecordPayment(&pledge, float64(inv.AmountPaid)/100, inv.ID, "", time.Now())
		}
		updates := map[string]interface{}{}
		if pledge.Status == models.FoundationPledgePastDue || pledge.Status == models.FoundationPledgePending {
			updates["status"] = models.FoundationPledgeActive
		}
		if inv.Lines != nil && len(inv.Lines.Data) > 0 && inv.Lines.Data[0].Period != nil {
			end := time.Unix(inv.Lines.Data[0].Period.End, 0)
			updates["current_period_end"] = &end
		}
		if len(updates) > 0 {
			config.DB.Model(&pledge).Updates(updates)
		}

	case "invoice.payment_failed":
		var inv stripe.Invoice
		if json.Unmarshal(event.Data.Raw, &inv) == nil && inv.Subscription != nil {
			config.DB.Model(&models.FoundationPledge{}).
				Where("stripe_subscription_id = ? AND status = ?", inv.Subscription.ID, models.FoundationPledgeActive).
				Update("status", models.FoundationPledgePastDue)
		}

	case "customer.subscription.updated", "customer.subscription.deleted":
		var sub stripe.Subscription
		if json.Unmarshal(event.Data.Raw, &sub) != nil {
			break
		}
		var pledge models.FoundationPledge
		if config.DB.Where("stripe_subscription_id = ?", sub.ID).First(&pledge).Error == nil {
			foundationApplySubscription(&pledge, &sub)
		}

	case "account.updated":
		var acc stripe.Account
		if json.Unmarshal(event.Data.Raw, &acc) != nil {
			break
		}
		var r models.FoundationRescuer
		if config.DB.Where("stripe_account_id = ?", acc.ID).First(&r).Error == nil {
			foundationApplyAccount(&r, &acc)
		}
	}
	c.JSON(http.StatusOK, gin.H{"received": true})
}
