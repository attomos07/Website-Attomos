package src

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
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
// Se llama una vez al inicio del bot (o cuando se detecta cambio en config).
func LoadPaymentConfig() error {
	attomosURL := os.Getenv("ATTOMOS_API_URL")
	botToken := os.Getenv("BOT_API_TOKEN")
	branchID := os.Getenv("BRANCH_ID")

	if attomosURL == "" || botToken == "" || branchID == "" {
		log.Println("⚠️  [Payments] ATTOMOS_API_URL, BOT_API_TOKEN o BRANCH_ID no configurados — pagos deshabilitados")
		paymentConfigCache = &PaymentConfig{}
		return nil
	}

	url := fmt.Sprintf("%s/api/payment-config/%s", attomosURL, branchID)
	req, err := http.NewRequest("GET", url, nil)
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

// BuildPaymentMessage construye el mensaje de opciones de pago para el cliente.
// Se llama cuando se confirma la cita, antes de despedirse.
func BuildPaymentMessage(servicio string, precio float64) string {
	cfg := GetPaymentConfig()

	hasSPEI := cfg.SPEIEnabled && cfg.CLABENumber != ""
	hasStripe := cfg.StripeEnabled && cfg.StripeChargesEnabled

	if !hasSPEI && !hasStripe {
		return ""
	}

	var sb strings.Builder

	sb.WriteString("\n💳 *Opciones de pago*\n")
	sb.WriteString("━━━━━━━━━━━━━━━━━━━━━━\n")

	if precio > 0 {
		sb.WriteString(fmt.Sprintf("💰 *Total:* $%.0f MXN\n\n", precio))
	}

	if hasSPEI {
		sb.WriteString("🏦 *Transferencia SPEI*\n")
		sb.WriteString(fmt.Sprintf("   CLABE: `%s`\n", cfg.CLABENumber))
		if cfg.BankName != "" {
			sb.WriteString(fmt.Sprintf("   Banco: %s\n", cfg.BankName))
		}
		if cfg.AccountName != "" {
			sb.WriteString(fmt.Sprintf("   A nombre de: %s\n", cfg.AccountName))
		}
	}

	if hasSPEI && hasStripe {
		sb.WriteString("\n")
	}

	if hasStripe {
		// Generar Payment Link de Stripe
		link, err := CreateStripePaymentLink(servicio, precio)
		if err != nil {
			log.Printf("⚠️  [Payments] Error generando link Stripe: %v", err)
		} else if link != "" {
			sb.WriteString("💳 *Tarjeta de crédito/débito*\n")
			sb.WriteString(fmt.Sprintf("   👉 %s\n", link))
		}
	}

	sb.WriteString("━━━━━━━━━━━━━━━━━━━━━━\n")
	sb.WriteString("_Puedes pagar antes o después de tu cita_ 😊")

	return sb.String()
}

// ─── Stripe Payment Link ───────────────────────────────────────────────────

// stripePaymentLinkRequest cuerpo de la petición a la API de Attomos
// para crear un Stripe Payment Link.
type stripePaymentLinkRequest struct {
	ServiceName string  `json:"serviceName"`
	Amount      float64 `json:"amount"` // en MXN
	BranchID    string  `json:"branchId"`
}

type stripePaymentLinkResponse struct {
	URL   string `json:"url"`
	Error string `json:"error"`
}

// CreateStripePaymentLink crea un Payment Link de Stripe vía la API de Attomos.
// Retorna la URL del link o "" si falla.
func CreateStripePaymentLink(serviceName string, amount float64) (string, error) {
	attomosURL := os.Getenv("ATTOMOS_API_URL")
	botToken := os.Getenv("BOT_API_TOKEN")
	branchID := os.Getenv("BRANCH_ID")

	if attomosURL == "" || botToken == "" || branchID == "" {
		return "", fmt.Errorf("variables de entorno no configuradas")
	}

	if amount <= 0 {
		// Sin precio definido, crear link genérico sin monto fijo
		amount = 0
	}

	payload := stripePaymentLinkRequest{
		ServiceName: serviceName,
		Amount:      amount,
		BranchID:    branchID,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("error serializando payload: %w", err)
	}

	url := fmt.Sprintf("%s/api/payment-config/stripe/payment-link", attomosURL)
	req, err := http.NewRequest("POST", url, bytes.NewBuffer(body))
	if err != nil {
		return "", fmt.Errorf("error creando request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+botToken)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("error llamando API: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	var linkResp stripePaymentLinkResponse
	if err := json.Unmarshal(respBody, &linkResp); err != nil {
		return "", fmt.Errorf("error parseando respuesta: %w", err)
	}

	if linkResp.Error != "" {
		return "", fmt.Errorf("error del servidor: %s", linkResp.Error)
	}

	log.Printf("✅ [Payments] Stripe Payment Link generado: %s", linkResp.URL)
	return linkResp.URL, nil
}

// GetServicePrice busca el precio de un servicio en BusinessCfg.
// Retorna 0 si no se encuentra o si el precio es variable.
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
