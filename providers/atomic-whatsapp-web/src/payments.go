package src

import (
	"bytes"
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
	return cfg.SPEIEnabled || (cfg.StripeEnabled && cfg.StripeChargesEnabled)
}

// AskPaymentMethod construye la pregunta de método de pago según lo que tiene configurado el negocio.
// Siempre incluye efectivo + los métodos digitales activos.
func AskPaymentMethod() string {
	cfg := GetPaymentConfig()
	hasSPEI := cfg.SPEIEnabled && cfg.CLABENumber != ""
	hasStripe := cfg.StripeEnabled && cfg.StripeChargesEnabled

	var sb strings.Builder
	sb.WriteString("💳 ¿Cómo deseas pagar?\n\n")
	sb.WriteString("• 💵 *Efectivo*\n")
	if hasStripe {
		sb.WriteString("• 💳 *Tarjeta* (pago en línea)\n")
	}
	if hasSPEI {
		sb.WriteString("• 🏦 *Transferencia SPEI*\n")
	}
	return strings.TrimRight(sb.String(), "\n")
}

// BuildPaymentMessage construye el mensaje de pago para el cliente.
//
// paymentMethod indica el método que el usuario ya eligió:
//   - "efectivo"       → mensaje de confirmación en efectivo, sin links
//   - "tarjeta"        → solo muestra el link de Ninda (Stripe)
//   - "transferencia"  → solo muestra los datos SPEI
//   - ""               → muestra todos los métodos disponibles (usado en flujo de citas)
func BuildPaymentMessage(servicio string, precio float64, paymentMethod string) string {
	cfg := GetPaymentConfig()

	hasSPEI := cfg.SPEIEnabled && cfg.CLABENumber != ""
	hasTakeApp := cfg.StripeEnabled && cfg.StripeChargesEnabled

	attomosURL := os.Getenv("ATTOMOS_API_URL")
	branchID := os.Getenv("BRANCH_ID")

	// ── Efectivo: mensaje corto, sin opciones digitales ─────────────────────
	if paymentMethod == "efectivo" {
		return "💵 *Pago en efectivo confirmado.* ¡Te esperamos pronto! 🙌"
	}

	// ── Validar que haya algo que mostrar ────────────────────────────────────
	showSPEI := hasSPEI && (paymentMethod == "" || paymentMethod == "transferencia")
	showStripe := hasTakeApp && (paymentMethod == "" || paymentMethod == "tarjeta")

	if !showSPEI && !showStripe {
		return ""
	}

	var sb strings.Builder
	sb.WriteString("\n💳 *Opciones de pago*\n")
	sb.WriteString("━━━━━━━━━━━━━━━━━━━━━━\n")

	if precio > 0 {
		sb.WriteString(fmt.Sprintf("💰 *Total:* $%.0f MXN\n\n", precio))
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

	if showSPEI && showStripe {
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
		sb.WriteString(fmt.Sprintf("💰 *Total:* $%.0f MXN\n\n", precio))
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
func SaveAppointmentToBackend(payload BotAppointmentPayload) error {
	attomosURL := os.Getenv("ATTOMOS_API_URL")
	botToken := os.Getenv("BOT_API_TOKEN")

	if attomosURL == "" || botToken == "" {
		return fmt.Errorf("ATTOMOS_API_URL o BOT_API_TOKEN no configurados")
	}

	// Leer agentID y userID desde el entorno si no vienen en el payload
	if payload.AgentID == 0 {
		fmt.Sscanf(os.Getenv("AGENT_ID"), "%d", &payload.AgentID)
	}

	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("error serializando cita: %w", err)
	}

	req, err := http.NewRequest("POST", attomosURL+"/api/bot/appointments", bytes.NewBuffer(bodyBytes))
	if err != nil {
		return fmt.Errorf("error creando request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+botToken)

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("error llamando API: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("API retornó %d: %s", resp.StatusCode, string(respBody))
	}

	log.Printf("✅ [Backend] Cita guardada en BD: %s", string(respBody))
	return nil
}
