package handlers

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"attomos/config"
	"attomos/models"

	"github.com/gin-gonic/gin"
)

// Webhook de la app de Meta de Attomos (Tech Provider).
//
// Es el webhook a nivel APP: Meta manda aquí los eventos de TODAS las
// cuentas de WhatsApp (WABA) conectadas a la app de Attomos. Cada cambio
// trae metadata.phone_number_id: se busca el agente OrbitalBot con ese
// número y se le reenvía SOLO su parte del evento a http://IP:PUERTO/webhook
// (el mismo endpoint que usa webhook_proxy.go).
//
// Convive con webhook_proxy.go (/webhook/meta/:agent_id), que es el
// webhook POR AGENTE: reenvía al OrbitalBot de cada cliente y el bot
// responde el handshake con su propio WEBHOOK_VERIFY_TOKEN. Este archivo
// es el webhook único de la app, el que pide el panel de Meta.
//
// Variables de entorno:
//
//	META_APP_WEBHOOK_VERIFY_TOKEN — texto que tú inventas y pones IGUAL
//	    en el campo "Token de verificación" del panel de Meta.
//	META_TECH_APP_SECRET — (opcional) "Clave secreta de la app" de Attomos
//	    (Configuración > Básica). Si no está, se usa META_APP_SECRET (hoy es
//	    la misma app). Con cualquiera de las dos se valida la firma
//	    X-Hub-Signature-256 de cada POST.

// VerifyMetaAppWebhook responde al handshake que Meta hace al presionar
// "Verificar y guardar": GET con hub.mode, hub.verify_token y
// hub.challenge. Regresa el challenge en texto plano solo si el token
// coincide.
// GET /webhook/meta-app
func VerifyMetaAppWebhook(c *gin.Context) {
	mode := c.Query("hub.mode")
	token := c.Query("hub.verify_token")
	challenge := c.Query("hub.challenge")
	expected := os.Getenv("META_APP_WEBHOOK_VERIFY_TOKEN")

	if mode == "subscribe" && expected != "" && token == expected {
		log.Println("[meta-webhook] verificación exitosa")
		c.String(http.StatusOK, challenge)
		return
	}

	log.Println("[meta-webhook] verificación rechazada (token no coincide)")
	c.Status(http.StatusForbidden)
}

// ReceiveMetaAppWebhook recibe los eventos reales (mensajes entrantes,
// estados de mensajes, cambios de plantillas, etc.). Responde 200 rápido
// siempre que el cuerpo sea válido; si Meta no recibe 200 reintenta y
// eventualmente desactiva el webhook.
// POST /webhook/meta-app
func ReceiveMetaAppWebhook(c *gin.Context) {
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		log.Println("[meta-webhook] error leyendo body:", err)
		c.Status(http.StatusOK)
		return
	}

	secret := os.Getenv("META_TECH_APP_SECRET")
	if secret == "" {
		secret = os.Getenv("META_APP_SECRET")
	}
	if secret != "" {
		if !validMetaSignature(body, c.GetHeader("X-Hub-Signature-256"), secret) {
			log.Println("[meta-webhook] firma inválida, evento descartado")
			c.Status(http.StatusUnauthorized)
			return
		}
	}

	// Responder 200 de inmediato; el reenvío a los bots va en segundo plano
	c.Status(http.StatusOK)
	go routeMetaAppEvent(body)
}

// ============================================================================
// RUTEO POR phone_number_id → OrbitalBot de cada agente
// ============================================================================

type metaAppPayload struct {
	Object string `json:"object"`
	Entry  []struct {
		ID      string            `json:"id"`
		Changes []json.RawMessage `json:"changes"`
	} `json:"entry"`
}

type metaAppChange struct {
	Field string `json:"field"`
	Value struct {
		Metadata struct {
			PhoneNumberID string `json:"phone_number_id"`
		} `json:"metadata"`
	} `json:"value"`
}

// metaAppEntryOut es el entry filtrado que se manda a cada bot
type metaAppEntryOut struct {
	ID      string            `json:"id"`
	Changes []json.RawMessage `json:"changes"`
}

var metaRouteClient = &http.Client{Timeout: 15 * time.Second}

func routeMetaAppEvent(body []byte) {
	var payload metaAppPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		log.Printf("[meta-webhook] JSON inválido: %v", err)
		return
	}
	if payload.Object != "whatsapp_business_account" {
		log.Printf("[meta-webhook] objeto %q ignorado", payload.Object)
		return
	}

	// phone_number_id → entries con solo los cambios de ese número
	byPhone := map[string][]metaAppEntryOut{}
	for _, entry := range payload.Entry {
		perPhone := map[string][]json.RawMessage{}
		for _, raw := range entry.Changes {
			var ch metaAppChange
			if err := json.Unmarshal(raw, &ch); err != nil {
				continue
			}
			phoneID := ch.Value.Metadata.PhoneNumberID
			if phoneID == "" {
				// Eventos de cuenta/plantillas (sin número): solo se registran
				log.Printf("[meta-webhook] evento %q del WABA %s (sin número, no se reenvía)", ch.Field, entry.ID)
				continue
			}
			perPhone[phoneID] = append(perPhone[phoneID], raw)
		}
		for phoneID, changes := range perPhone {
			byPhone[phoneID] = append(byPhone[phoneID], metaAppEntryOut{ID: entry.ID, Changes: changes})
		}
	}

	for phoneID, entries := range byPhone {
		forwardToAgentBot(phoneID, payload.Object, entries)
	}
}

func forwardToAgentBot(phoneNumberID, object string, entries []metaAppEntryOut) {
	var agent models.Agent
	err := config.DB.
		Where("meta_phone_number_id = ? AND bot_type = ?", phoneNumberID, "orbital").
		Order("updated_at DESC").
		First(&agent).Error
	if err != nil {
		log.Printf("[meta-webhook] ⚠️  ningún agente OrbitalBot tiene el número %s", phoneNumberID)
		return
	}
	if agent.ServerIP == "" || agent.Port == 0 {
		log.Printf("[meta-webhook] ⚠️  agente %d sin servidor/puerto asignado", agent.ID)
		return
	}
	if agent.ServerStatus != "" && agent.ServerStatus != "ready" {
		log.Printf("[meta-webhook] ⚠️  servidor del agente %d no está listo (status: %s)", agent.ID, agent.ServerStatus)
		return
	}

	out, _ := json.Marshal(map[string]interface{}{
		"object": object,
		"entry":  entries,
	})

	botURL := fmt.Sprintf("http://%s:%d/webhook", agent.ServerIP, agent.Port)
	req, err := http.NewRequest(http.MethodPost, botURL, bytes.NewReader(out))
	if err != nil {
		log.Printf("[meta-webhook] ❌ agente %d: %v", agent.ID, err)
		return
	}
	req.Header.Set("Content-Type", "application/json")

	start := time.Now()
	resp, err := metaRouteClient.Do(req)
	if err != nil {
		log.Printf("[meta-webhook] ❌ agente %d inalcanzable (%s): %v", agent.ID, botURL, err)
		return
	}
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()

	log.Printf("[meta-webhook] ✅ evento → agente %d (%s) HTTP %d en %v",
		agent.ID, maskSensitiveData(phoneNumberID), resp.StatusCode, time.Since(start).Round(time.Millisecond))
}

func validMetaSignature(body []byte, header, secret string) bool {
	const prefix = "sha256="
	if !strings.HasPrefix(header, prefix) {
		return false
	}
	got, err := hex.DecodeString(strings.TrimPrefix(header, prefix))
	if err != nil {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	return hmac.Equal(got, mac.Sum(nil))
}
