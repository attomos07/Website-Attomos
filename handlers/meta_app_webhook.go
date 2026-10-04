package handlers

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
)

// Webhook de la app de Meta de Attomos (Tech Provider).
//
// Es el webhook a nivel APP: Meta manda aquí los eventos de TODAS las
// cuentas de WhatsApp (WABA) conectadas a la app de Attomos. Por ahora
// solo cumple el handshake y registra los eventos en el log; el ruteo
// por phone_number_id hacia cada agente/OrbitalBot va después.
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
//	META_TECH_APP_SECRET — (opcional) "Clave secreta de la app" de la app
//	    Tech Provider de Attomos (Configuración > Básica). Si está
//	    definida, se valida la firma X-Hub-Signature-256 de cada POST; si
//	    no, se omite la validación. Es DISTINTA de META_APP_SECRET, que
//	    pertenece a la otra app de Meta que usa el OAuth de meta_whatsapp.go.

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

	if secret := os.Getenv("META_TECH_APP_SECRET"); secret != "" {
		if !validMetaSignature(body, c.GetHeader("X-Hub-Signature-256"), secret) {
			log.Println("[meta-webhook] firma inválida, evento descartado")
			c.Status(http.StatusUnauthorized)
			return
		}
	}

	log.Println("[meta-webhook] evento recibido:", string(body))
	c.Status(http.StatusOK)
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
