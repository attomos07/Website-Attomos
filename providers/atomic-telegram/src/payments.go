package src

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
)

// PaymentConfig configuración de pagos leída desde la API de Attomos
type PaymentConfig struct {
	Configured                bool   `json:"configured"`
	SPEIEnabled               bool   `json:"speiEnabled"`
	CLABENumber               string `json:"clabeNumber"`
	BankName                  string `json:"bankName"`
	AccountName               string `json:"accountName"`
	StripeEnabled             bool   `json:"stripeEnabled"`
	StripeAccountID           string `json:"stripeAccountId"`
	StripeAccountStatus       string `json:"stripeAccountStatus"`
	StripeChargesEnabled      bool   `json:"stripeChargesEnabled"`
	PaymentRequiredForBooking bool   `json:"paymentRequiredForBooking"`

	// ── Click y Payme (Uzbekistán, exclusivo Telegram) ──────────────────────
	// A diferencia de Stripe, estos NO requieren llamada al backend para
	// generar el link: se arma en memoria con datos no-secretos.
	ClickEnabled    bool   `json:"clickEnabled"`
	ClickMerchantID string `json:"clickMerchantId"`
	ClickServiceID  string `json:"clickServiceId"`
	PaymeEnabled    bool   `json:"paymeEnabled"`
	PaymeMerchantID string `json:"paymeMerchantId"`

	// Currency indica la moneda del negocio ("MXN" por defecto, "UZS" para
	// negocios de Uzbekistán). Controla qué métodos y formato de monto se usan.
	Currency string `json:"currency"`
}

// paymentConfigCache caché en memoria para no llamar la API en cada mensaje
var paymentConfigCache *PaymentConfig

// LoadPaymentConfig carga la config de pagos desde la API de Attomos.
func LoadPaymentConfig() error {
	attomosURL := os.Getenv("ATTOMOS_API_URL")
	botToken := os.Getenv("BOT_API_TOKEN")
	branchID := os.Getenv("BRANCH_ID")

	if attomosURL == "" || botToken == "" || branchID == "" {
		log.Println("⚠️  [Payments] ATTOMOS_API_URL, BOT_API_TOKEN o BRANCH_ID no configurados — pagos deshabilitados")
		paymentConfigCache = &PaymentConfig{}
		return nil
	}

	reqURL := fmt.Sprintf("%s/api/payment-config/bot/%s", attomosURL, branchID)
	req, err := http.NewRequest("GET", reqURL, nil)
	if err != nil {
		return fmt.Errorf("error creando request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+botToken)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("error llamando API de pagos: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	var cfg PaymentConfig
	if err := json.Unmarshal(body, &cfg); err != nil {
		return fmt.Errorf("error parseando respuesta de pagos: %w", err)
	}

	paymentConfigCache = &cfg

	log.Println("✅ [Payments] Configuración de pagos cargada:")
	log.Printf("   💳 SPEI habilitado:   %v", cfg.SPEIEnabled)
	log.Printf("   💳 Stripe habilitado: %v", cfg.StripeEnabled)
	if cfg.SPEIEnabled {
		log.Printf("   🏦 CLABE: %s", cfg.CLABENumber)
	}
	if cfg.StripeEnabled {
		log.Printf("   🟣 Stripe status: %s", cfg.StripeAccountStatus)
	}

	return nil
}

// GetPaymentConfig retorna la configuración cacheada (nunca nil)
func GetPaymentConfig() *PaymentConfig {
	if paymentConfigCache == nil {
		return &PaymentConfig{}
	}
	return paymentConfigCache
}

// HasPaymentMethods indica si hay al menos un método de pago configurado
func HasPaymentMethods() bool {
	cfg := GetPaymentConfig()
	return cfg.SPEIEnabled ||
		(cfg.StripeEnabled && cfg.StripeChargesEnabled) ||
		(cfg.ClickEnabled && cfg.ClickMerchantID != "" && cfg.ClickServiceID != "") ||
		(cfg.PaymeEnabled && cfg.PaymeMerchantID != "")
}

// isUZS indica si el negocio opera en soum uzbeko. Por defecto (Currency
// vacío) se asume MXN para no romper negocios existentes en México.
func isUZS() bool {
	return strings.EqualFold(GetPaymentConfig().Currency, "UZS")
}

// currencySuffix devuelve el sufijo de moneda a mostrar en los mensajes.
func currencySuffix() string {
	if isUZS() {
		return "UZS"
	}
	return "MXN"
}

// BuildClickURL arma la URL de pago de Click sin llamar al backend —
// service_id/merchant_id no son secretos, se cachean igual que la CLABE.
// orderID debe ser una referencia única (idealmente el ID real del
// pedido/cita en el backend) para que el webhook pueda reconciliar el pago.
func BuildClickURL(orderID string, amount float64) string {
	cfg := GetPaymentConfig()
	if !cfg.ClickEnabled || cfg.ClickMerchantID == "" || cfg.ClickServiceID == "" {
		return ""
	}
	attomosURL := os.Getenv("ATTOMOS_API_URL")
	branchID := os.Getenv("BRANCH_ID")
	returnURL := ""
	if attomosURL != "" && branchID != "" {
		returnURL = fmt.Sprintf("%s/ninda/%s?paid=1", attomosURL, branchID)
	}
	v := url.Values{}
	v.Set("service_id", cfg.ClickServiceID)
	v.Set("merchant_id", cfg.ClickMerchantID)
	v.Set("amount", fmt.Sprintf("%.2f", amount))
	v.Set("transaction_param", orderID)
	if returnURL != "" {
		v.Set("return_url", returnURL)
	}
	return "https://my.click.uz/services/pay?" + v.Encode()
}

// BuildPaymeURL arma la URL de pago de Payme. El SDK de Payme espera el
// monto en tiyin (1 UZS = 100 tiyin), codificado en base64 dentro del path.
func BuildPaymeURL(orderID string, amount float64) string {
	cfg := GetPaymentConfig()
	if !cfg.PaymeEnabled || cfg.PaymeMerchantID == "" {
		return ""
	}
	amountTiyin := int64(amount * 100)
	raw := fmt.Sprintf("m=%s;ac.order_id=%s;a=%d", cfg.PaymeMerchantID, orderID, amountTiyin)
	encoded := base64.StdEncoding.EncodeToString([]byte(raw))
	return "https://checkout.paycom.uz/" + encoded
}

// BuildClickPaymeMessage construye el bloque de texto con los links de
// Click y/o Payme para un pedido/cita. orderID es la referencia de
// transacción (usar el ID real del backend cuando esté disponible).
func BuildClickPaymeMessage(orderID string, amount float64) string {
	cfg := GetPaymentConfig()
	hasClick := cfg.ClickEnabled && cfg.ClickMerchantID != "" && cfg.ClickServiceID != ""
	hasPayme := cfg.PaymeEnabled && cfg.PaymeMerchantID != ""

	if !hasClick && !hasPayme {
		return ""
	}

	var sb strings.Builder
	if hasClick {
		clickURL := BuildClickURL(orderID, amount)
		if clickURL != "" {
			sb.WriteString("🔵 *Pagar con Click*\n")
			sb.WriteString(fmt.Sprintf("   👉 %s\n", clickURL))
		}
	}
	if hasClick && hasPayme {
		sb.WriteString("\n")
	}
	if hasPayme {
		paymeURL := BuildPaymeURL(orderID, amount)
		if paymeURL != "" {
			sb.WriteString("🟢 *Pagar con Payme*\n")
			sb.WriteString(fmt.Sprintf("   👉 %s\n", paymeURL))
		}
	}
	return sb.String()
}

// formatOrderRef arma la referencia de transacción que viaja en el link de
// pago Click/Payme, en formato "order-{id}" o "appt-{id}". El backend
// (markOrderPaidByReference) la parsea para saber qué registro actualizar
// cuando el webhook confirma el pago.
func formatOrderRef(kind string, id uint) string {
	return fmt.Sprintf("%s-%d", kind, id)
}

// AskPaymentMethod construye la pregunta de método de pago según lo que tiene configurado el negocio.
// Siempre incluye efectivo + los métodos digitales activos.
func AskPaymentMethod() string {
	cfg := GetPaymentConfig()
	hasSPEI := cfg.SPEIEnabled && cfg.CLABENumber != ""
	hasStripe := cfg.StripeEnabled && cfg.StripeChargesEnabled
	hasClick := cfg.ClickEnabled && cfg.ClickMerchantID != "" && cfg.ClickServiceID != ""
	hasPayme := cfg.PaymeEnabled && cfg.PaymeMerchantID != ""

	var sb strings.Builder
	sb.WriteString("💳 ¿Cómo deseas pagar?\n\n")
	sb.WriteString("• 💵 *Efectivo*\n")
	if hasStripe {
		sb.WriteString("• 💳 *Tarjeta* (pago en línea)\n")
	}
	if hasSPEI {
		sb.WriteString("• 🏦 *Transferencia SPEI*\n")
	}
	if hasClick {
		sb.WriteString("• 🔵 *Click*\n")
	}
	if hasPayme {
		sb.WriteString("• 🟢 *Payme*\n")
	}
	return strings.TrimRight(sb.String(), "\n")
}

// BuildPaymentMessage construye el mensaje de pago para el cliente.
//
// orderRef es la referencia real del pedido/cita ("order-42" / "appt-17"),
// generada con formatOrderRef() a partir del ID que devolvió el backend al
// guardar el registro. Se usa para los links de Click/Payme. Si viene vacío,
// esos links no se generan (evita referencias huérfanas que el webhook no
// pueda reconciliar).
//
// paymentMethod indica el método que el usuario ya eligió:
//   - "efectivo"       → mensaje de confirmación en efectivo, sin links
//   - "tarjeta"        → solo muestra el link de Ninda (Stripe)
//   - "transferencia"  → solo muestra los datos SPEI
//   - "click"          → solo muestra el link de Click
//   - "payme"          → solo muestra el link de Payme
//   - ""               → muestra todos los métodos disponibles (usado en flujo de citas)
func BuildPaymentMessage(servicio string, precio float64, paymentMethod string, orderRef string) string {
	cfg := GetPaymentConfig()

	hasSPEI := cfg.SPEIEnabled && cfg.CLABENumber != ""
	hasTakeApp := cfg.StripeEnabled && cfg.StripeChargesEnabled
	hasClick := cfg.ClickEnabled && cfg.ClickMerchantID != "" && cfg.ClickServiceID != ""
	hasPayme := cfg.PaymeEnabled && cfg.PaymeMerchantID != ""

	attomosURL := os.Getenv("ATTOMOS_API_URL")
	branchID := os.Getenv("BRANCH_ID")

	// ── Efectivo: mensaje corto, sin opciones digitales ─────────────────────
	if paymentMethod == "efectivo" {
		return "💵 *Pago en efectivo confirmado.* ¡Te esperamos pronto! 🙌"
	}

	// ── Validar que haya algo que mostrar ────────────────────────────────────
	showSPEI := hasSPEI && (paymentMethod == "" || paymentMethod == "transferencia")
	showStripe := hasTakeApp && (paymentMethod == "" || paymentMethod == "tarjeta")
	showClick := hasClick && (paymentMethod == "" || paymentMethod == "click")
	showPayme := hasPayme && (paymentMethod == "" || paymentMethod == "payme")

	if !showSPEI && !showStripe && !showClick && !showPayme {
		return ""
	}

	var sb strings.Builder
	sb.WriteString("\n💳 *Opciones de pago*\n")
	sb.WriteString("━━━━━━━━━━━━━━━━━━━━━━\n")

	if precio > 0 {
		sb.WriteString(fmt.Sprintf("💰 *Total:* $%.0f %s\n\n", precio, currencySuffix()))
	}

	// ── SPEI ─────────────────────────────────────────────────────────────────
	if showSPEI {
		sb.WriteString("🏦 *Transferencia SPEI*\n")
		sb.WriteString(fmt.Sprintf("   CLABE: `%s`\n", cfg.CLABENumber))
		if cfg.BankName != "" {
			sb.WriteString(fmt.Sprintf("   Banco: %s\n", cfg.BankName))
		}
		if cfg.AccountName != "" {
			sb.WriteString(fmt.Sprintf("   A nombre de: %s\n", cfg.AccountName))
		}
	}

	if showSPEI && (showStripe || showClick || showPayme) {
		sb.WriteString("\n")
	}

	// ── Tarjeta vía Ninda ────────────────────────────────────────────────────
	if showStripe && attomosURL != "" && branchID != "" {
		nindaURL := fmt.Sprintf(
			"%s/ninda/%s?item=%s",
			attomosURL,
			branchID,
			url.QueryEscape(servicio),
		)
		sb.WriteString("💳 *Pagar con tarjeta*\n")
		sb.WriteString(fmt.Sprintf("   👉 %s\n", nindaURL))
	}

	if (showStripe) && (showClick || showPayme) {
		sb.WriteString("\n")
	}

	// ── Click / Payme (Uzbekistán) ──────────────────────────────────────────
	if (showClick || showPayme) && orderRef != "" {
		if showClick {
			if clickURL := BuildClickURL(orderRef, precio); clickURL != "" {
				sb.WriteString("🔵 *Pagar con Click*\n")
				sb.WriteString(fmt.Sprintf("   👉 %s\n", clickURL))
			}
		}
		if showClick && showPayme {
			sb.WriteString("\n")
		}
		if showPayme {
			if paymeURL := BuildPaymeURL(orderRef, precio); paymeURL != "" {
				sb.WriteString("🟢 *Pagar con Payme*\n")
				sb.WriteString(fmt.Sprintf("   👉 %s\n", paymeURL))
			}
		}
	}

	sb.WriteString("━━━━━━━━━━━━━━━━━━━━━━\n")

	// Footer contextual: "cita" para servicios, "pedido" para comida
	if isPizzeriaMode() {
		sb.WriteString("_Puedes pagar antes o al momento de recoger_ 😊")
	} else {
		sb.WriteString("_Puedes pagar antes o después de tu cita_ 😊")
	}

	return sb.String()
}

// GetServicePrice busca el precio de un servicio en BusinessCfg.
func GetServicePrice(serviceName string) float64 {
	if BusinessCfg == nil {
		return 0
	}
	serviceNameLower := strings.ToLower(strings.TrimSpace(serviceName))
	for _, svc := range BusinessCfg.Services {
		if strings.ToLower(strings.TrimSpace(svc.Title)) == serviceNameLower {
			if svc.Price > 0 {
				return svc.Price
			}
		}
	}
	return 0
}

// BotCheckoutItem representa un ítem del carrito para el checkout del bot
type BotCheckoutItem struct {
	ServiceIndex int     `json:"serviceIndex"`
	Title        string  `json:"title"`
	Price        float64 `json:"price"`
	Quantity     int     `json:"quantity"`
}

// CreateBotCheckoutURL llama al backend de Attomos para crear un Stripe Payment Link
// con URL corta (buy.stripe.com/xxx) — sin caracteres especiales que rompan el link
// en WhatsApp mobile.
func CreateBotCheckoutURL(customerName, customerPhone string, items []OrderItem) (string, error) {
	attomosURL := os.Getenv("ATTOMOS_API_URL")
	branchID := os.Getenv("BRANCH_ID")
	botToken := os.Getenv("BOT_API_TOKEN")

	if attomosURL == "" || branchID == "" || botToken == "" {
		return "", fmt.Errorf("ATTOMOS_API_URL, BRANCH_ID o BOT_API_TOKEN no configurados")
	}

	// Calcular total y construir descripción del pedido
	total := 0.0
	itemNames := make([]string, 0, len(items))
	for _, item := range items {
		total += item.Price * float64(item.Quantity)
		if item.Quantity > 1 {
			itemNames = append(itemNames, fmt.Sprintf("%dx %s", item.Quantity, item.Title))
		} else {
			itemNames = append(itemNames, item.Title)
		}
	}

	serviceName := strings.Join(itemNames, ", ")
	if len(serviceName) > 80 {
		serviceName = serviceName[:77] + "..."
	}

	// Llamar al endpoint de Payment Link (URL corta sin # ni %2F)
	reqBody := map[string]interface{}{
		"serviceName": serviceName,
		"amount":      total,
		"branchId":    branchID,
	}

	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("error serializando request: %w", err)
	}

	req, err := http.NewRequest("POST", attomosURL+"/api/payment-config/stripe/payment-link", bytes.NewBuffer(bodyBytes))
	if err != nil {
		return "", fmt.Errorf("error creando request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+botToken)

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("error llamando API de payment link: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("API retornó %d: %s", resp.StatusCode, string(respBody))
	}

	var result map[string]interface{}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return "", fmt.Errorf("error parseando respuesta: %w", err)
	}

	paymentURL, ok := result["url"].(string)
	if !ok || paymentURL == "" {
		return "", fmt.Errorf("respuesta sin url")
	}

	log.Printf("✅ [BotPaymentLink] Link creado: %s", paymentURL)
	return paymentURL, nil
}

// BuildStripeOnlyMessage construye el mensaje con el link directo de Stripe Checkout.
// Usado cuando el cliente ya eligió "tarjeta" y se generó la sesión exitosamente.
func BuildStripeOnlyMessage(checkoutURL string, precio float64) string {
	var sb strings.Builder
	sb.WriteString("\n💳 *Pago con tarjeta*\n")
	sb.WriteString("━━━━━━━━━━━━━━━━━━━━━━\n")
	if precio > 0 {
		sb.WriteString(fmt.Sprintf("💰 *Total:* $%.0f %s\n\n", precio, currencySuffix()))
	}
	sb.WriteString("👉 " + checkoutURL + "\n")
	sb.WriteString("━━━━━━━━━━━━━━━━━━━━━━\n")
	sb.WriteString("_El link expira en 24 horas_ ⏱️")
	return sb.String()
}

// BotAppointmentPayload datos de la cita para enviar al backend
type BotAppointmentPayload struct {
	AgentID    uint   `json:"agentId"`
	UserID     uint   `json:"userId"`
	ClientName string `json:"clientName"`
	Phone      string `json:"phone"`
	Service    string `json:"service"`
	Worker     string `json:"worker"`
	Date       string `json:"date"` // YYYY-MM-DD
	Time       string `json:"time"` // HH:MM
	Notes      string `json:"notes"`
}

// SaveAppointmentToBackend guarda la cita en la BD de Attomos vía API REST.
// Se llama siempre al confirmar una cita, independientemente de si Google Sheets
// está conectado o no. Así la cita aparece en el panel de Mis Citas.
// Devuelve el ID real de la cita creada (para usarlo como referencia en
// links de pago Click/Payme) o error.
func SaveAppointmentToBackend(payload BotAppointmentPayload) (uint, error) {
	attomosURL := os.Getenv("ATTOMOS_API_URL")
	botToken := os.Getenv("BOT_API_TOKEN")

	if attomosURL == "" || botToken == "" {
		return 0, fmt.Errorf("ATTOMOS_API_URL o BOT_API_TOKEN no configurados")
	}

	// Leer agentID y userID desde el entorno si no vienen en el payload
	if payload.AgentID == 0 {
		fmt.Sscanf(os.Getenv("AGENT_ID"), "%d", &payload.AgentID)
	}

	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return 0, fmt.Errorf("error serializando cita: %w", err)
	}

	req, err := http.NewRequest("POST", attomosURL+"/api/bot/appointments", bytes.NewBuffer(bodyBytes))
	if err != nil {
		return 0, fmt.Errorf("error creando request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+botToken)

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return 0, fmt.Errorf("error llamando API: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("API retornó %d: %s", resp.StatusCode, string(respBody))
	}

	var result struct {
		ID uint `json:"id"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		log.Printf("⚠️  [Backend] Cita guardada pero no se pudo leer el ID: %v", err)
		return 0, nil
	}

	log.Printf("✅ [Backend] Cita guardada en BD: %s", string(respBody))
	return result.ID, nil
}
