package src

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"time"
)

// MetaClient maneja la comunicación con la API de Meta WhatsApp
type MetaClient struct {
	AccessToken   string
	PhoneNumberID string
	WABAID        string
	APIVersion    string
	HTTPClient    *http.Client
	ctx           context.Context
}

// MetaMessage representa un mensaje de WhatsApp de Meta
type MetaMessage struct {
	MessagingProduct string      `json:"messaging_product"`
	RecipientType    string      `json:"recipient_type"`
	To               string      `json:"to"`
	Type             string      `json:"type"`
	Text             *MetaText   `json:"text,omitempty"`
	Template         interface{} `json:"template,omitempty"`
}

// MetaText contenido de texto del mensaje
type MetaText struct {
	PreviewURL bool   `json:"preview_url"`
	Body       string `json:"body"`
}

// MetaWebhookPayload estructura del webhook de Meta
type MetaWebhookPayload struct {
	Object string `json:"object"`
	Entry  []struct {
		ID      string `json:"id"`
		Changes []struct {
			Value struct {
				MessagingProduct string `json:"messaging_product"`
				Metadata         struct {
					DisplayPhoneNumber string `json:"display_phone_number"`
					PhoneNumberID      string `json:"phone_number_id"`
				} `json:"metadata"`
				Contacts []struct {
					Profile struct {
						Name string `json:"name"`
					} `json:"profile"`
					WAID string `json:"wa_id"`
				} `json:"contacts"`
				Messages []struct {
					From      string `json:"from"`
					ID        string `json:"id"`
					Timestamp string `json:"timestamp"`
					Type      string `json:"type"`
					Text      struct {
						Body string `json:"body"`
					} `json:"text"`
				} `json:"messages"`
				Statuses []struct {
					ID           string `json:"id"`
					Status       string `json:"status"`
					Timestamp    string `json:"timestamp"`
					RecipientID  string `json:"recipient_id"`
					Conversation struct {
						ID     string `json:"id"`
						Origin struct {
							Type string `json:"type"`
						} `json:"origin"`
					} `json:"conversation"`
					Pricing struct {
						Billable     bool   `json:"billable"`
						PricingModel string `json:"pricing_model"`
						Category     string `json:"category"`
					} `json:"pricing"`
				} `json:"statuses"`
			} `json:"value"`
			Field string `json:"field"`
		} `json:"changes"`
	} `json:"entry"`
}

var globalMetaClient *MetaClient

// NewMetaClient crea un nuevo cliente de Meta WhatsApp
func NewMetaClient(ctx context.Context) (*MetaClient, error) {
	accessToken := os.Getenv("META_ACCESS_TOKEN")
	phoneNumberID := os.Getenv("META_PHONE_NUMBER_ID")
	wabaID := os.Getenv("META_WABA_ID")

	// 🔧 CAMBIO: Permitir que el bot arranque sin credenciales
	if accessToken == "" || phoneNumberID == "" || wabaID == "" {
		log.Println("")
		log.Println("╔══════════════════════════════════════════════════════╗")
		log.Println("║   ⚠️  CREDENCIALES DE META NO CONFIGURADAS          ║")
		log.Println("╚══════════════════════════════════════════════════════╝")
		log.Println("")
		log.Println("📋 El bot arrancará en MODO ESPERA")
		log.Println("💡 Para activar WhatsApp Business API:")
		log.Println("   1. Ve a la página de Integraciones en Attomos")
		log.Println("   2. Selecciona este agente")
		log.Println("   3. Configura las credenciales de Meta WhatsApp")
		log.Println("")
		log.Println("🔗 Obtén tus credenciales en:")
		log.Println("   https://developers.facebook.com/apps")
		log.Println("")

		// Retornar un cliente vacío que permite arrancar el servidor
		return &MetaClient{
			AccessToken:   "",
			PhoneNumberID: "",
			WABAID:        "",
			APIVersion:    "v21.0",
			HTTPClient: &http.Client{
				Timeout: 30 * time.Second,
			},
			ctx: ctx,
		}, nil
	}

	client := &MetaClient{
		AccessToken:   accessToken,
		PhoneNumberID: phoneNumberID,
		WABAID:        wabaID,
		APIVersion:    "v21.0",
		HTTPClient: &http.Client{
			Timeout: 30 * time.Second,
		},
		ctx: ctx,
	}

	log.Printf("✅ Meta Client inicializado:")
	log.Printf("   📱 Phone Number ID: %s", maskSensitiveData(phoneNumberID))
	log.Printf("   🏢 WABA ID: %s", maskSensitiveData(wabaID))
	log.Printf("   🔑 Access Token: %s", maskSensitiveData(accessToken))
	log.Printf("   📊 API Version: %s", client.APIVersion)

	return client, nil
}

// SetClient configura el cliente global
func SetClient(client *MetaClient) {
	globalMetaClient = client
}

// GetClient retorna el cliente global
func GetClient() *MetaClient {
	return globalMetaClient
}

// IsConfigured verifica si el cliente tiene credenciales configuradas
func (c *MetaClient) IsConfigured() bool {
	return c.AccessToken != "" && c.PhoneNumberID != "" && c.WABAID != ""
}

// SendMessage envía un mensaje de texto a un número de WhatsApp
func (c *MetaClient) SendMessage(to, message string) error {
	// Verificar si el cliente está configurado
	if !c.IsConfigured() {
		return fmt.Errorf("cliente Meta no configurado - configura las credenciales en Integraciones")
	}

	url := fmt.Sprintf("https://graph.facebook.com/%s/%s/messages", c.APIVersion, c.PhoneNumberID)

	payload := MetaMessage{
		MessagingProduct: "whatsapp",
		RecipientType:    "individual",
		To:               to,
		Type:             "text",
		Text: &MetaText{
			PreviewURL: false,
			Body:       message,
		},
	}

	jsonData, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("error marshaling payload: %w", err)
	}

	req, err := http.NewRequestWithContext(c.ctx, "POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return fmt.Errorf("error creating request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.AccessToken)

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("error sending request: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("API error (status %d): %s", resp.StatusCode, string(body))
	}

	log.Printf("✅ Mensaje enviado a %s", to)
	return nil
}

// MetaImageMessage representa un mensaje de imagen de WhatsApp (Meta Cloud API).
// A diferencia de whatsmeow (AtomicBot), que sube el binario de la imagen,
// Meta Cloud API acepta mandarla directo por URL pública — no hace falta
// descargar/subir nada, el link ya viene servido por el bucket.
type MetaImageMessage struct {
	MessagingProduct string     `json:"messaging_product"`
	RecipientType    string     `json:"recipient_type"`
	To               string     `json:"to"`
	Type             string     `json:"type"`
	Image            *MetaImage `json:"image,omitempty"`
}

// MetaImage contenido de imagen del mensaje
type MetaImage struct {
	Link    string `json:"link"`
	Caption string `json:"caption,omitempty"`
}

// SendImage envía una imagen por URL a un número de WhatsApp vía Meta Cloud API.
// Usado por el interceptor de SEND_APX_PHOTOS (ver webhook.go) cuando el
// cliente pide fotos de algún elemento del API Explorer.
func (c *MetaClient) SendImage(to, imageURL, caption string) error {
	if !c.IsConfigured() {
		return fmt.Errorf("cliente Meta no configurado - configura las credenciales en Integraciones")
	}

	url := fmt.Sprintf("https://graph.facebook.com/%s/%s/messages", c.APIVersion, c.PhoneNumberID)

	payload := MetaImageMessage{
		MessagingProduct: "whatsapp",
		RecipientType:    "individual",
		To:               to,
		Type:             "image",
		Image: &MetaImage{
			Link:    imageURL,
			Caption: caption,
		},
	}

	jsonData, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("error marshaling payload: %w", err)
	}

	req, err := http.NewRequestWithContext(c.ctx, "POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return fmt.Errorf("error creating request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.AccessToken)

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("error sending request: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("API error (status %d): %s", resp.StatusCode, string(body))
	}

	log.Printf("✅ Imagen enviada a %s: %s", to, imageURL)
	return nil
}

// SendImageFromBot envía una imagen usando el cliente global (helper, mismo
// patrón que SendMessageFromBot).
func SendImageFromBot(to, imageURL, caption string) error {
	if globalMetaClient == nil {
		return fmt.Errorf("Meta client no está inicializado")
	}
	if !globalMetaClient.IsConfigured() {
		return fmt.Errorf("Meta client no está configurado")
	}
	return globalMetaClient.SendImage(to, imageURL, caption)
}

// MarkAsRead marca un mensaje como leído
func (c *MetaClient) MarkAsRead(messageID string) error {
	// Verificar si el cliente está configurado
	if !c.IsConfigured() {
		return nil // Ignorar silenciosamente si no está configurado
	}

	url := fmt.Sprintf("https://graph.facebook.com/%s/%s/messages", c.APIVersion, c.PhoneNumberID)

	payload := map[string]interface{}{
		"messaging_product": "whatsapp",
		"status":            "read",
		"message_id":        messageID,
	}

	jsonData, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("error marshaling payload: %w", err)
	}

	req, err := http.NewRequestWithContext(c.ctx, "POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return fmt.Errorf("error creating request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.AccessToken)

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("error sending request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("API error (status %d): %s", resp.StatusCode, string(body))
	}

	return nil
}

// GetPhoneNumberInfo obtiene información del número de teléfono
func (c *MetaClient) GetPhoneNumberInfo() (map[string]interface{}, error) {
	// Verificar si el cliente está configurado
	if !c.IsConfigured() {
		return nil, fmt.Errorf("cliente Meta no configurado")
	}

	url := fmt.Sprintf("https://graph.facebook.com/%s/%s", c.APIVersion, c.PhoneNumberID)

	req, err := http.NewRequestWithContext(c.ctx, "GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("error creating request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+c.AccessToken)

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("error sending request: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API error (status %d): %s", resp.StatusCode, string(body))
	}

	var result map[string]interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("error parsing response: %w", err)
	}

	return result, nil
}

// Close cierra el cliente (por compatibilidad con AtomicBot)
func (c *MetaClient) Close() {
	log.Println("👋 Meta Client cerrado")
}

// maskSensitiveData enmascara datos sensibles para logs
func maskSensitiveData(data string) string {
	if len(data) <= 8 {
		return "***"
	}
	return data[:4] + "..." + data[len(data)-4:]
}

// SendMessageFromBot envía mensaje usando el cliente global (helper)
func SendMessageFromBot(to, message string) error {
	if globalMetaClient == nil {
		return fmt.Errorf("Meta client no está inicializado")
	}

	if !globalMetaClient.IsConfigured() {
		return fmt.Errorf("Meta client no está configurado - configura las credenciales en Integraciones")
	}

	return globalMetaClient.SendMessage(to, message)
}
