package src

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
)

// StartWebhookServer inicia el servidor webhook
func StartWebhookServer(client *MetaClient) {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	verifyToken := os.Getenv("WEBHOOK_VERIFY_TOKEN")
	if verifyToken == "" {
		log.Fatal("❌ WEBHOOK_VERIFY_TOKEN no está configurado")
	}

	// 🔧 NUEVO: Soporte para rutas por agente /webhook/meta/{agentId}
	http.HandleFunc("/webhook/meta/", func(w http.ResponseWriter, r *http.Request) {
		handleWebhookWithAgent(w, r, client, verifyToken)
	})

	// Mantener ruta original /webhook por compatibilidad
	http.HandleFunc("/webhook", func(w http.ResponseWriter, r *http.Request) {
		handleWebhook(w, r, client, verifyToken)
	})

	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		// Health check mejorado que indica el estado del cliente
		status := "waiting_credentials"
		if client.IsConfigured() {
			status = "ready"
		}

		response := map[string]string{
			"status":      "ok",
			"meta_status": status,
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(response)
	})

	http.HandleFunc("/status", func(w http.ResponseWriter, r *http.Request) {
		// Endpoint de estado detallado
		response := map[string]interface{}{
			"bot_running":     true,
			"meta_configured": client.IsConfigured(),
			"port":            port,
		}

		if client.IsConfigured() {
			response["phone_number_id"] = maskSensitiveData(client.PhoneNumberID)
			response["waba_id"] = maskSensitiveData(client.WABAID)
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(response)
	})

	log.Printf("🌐 Servidor webhook iniciado en puerto %s", port)
	log.Printf("📡 Endpoint por agente: http://localhost:%s/webhook/meta/{agentId}", port)
	log.Printf("📡 Endpoint general: http://localhost:%s/webhook", port)
	log.Printf("💚 Health check: http://localhost:%s/health", port)
	log.Printf("📊 Status: http://localhost:%s/status", port)

	if !client.IsConfigured() {
		log.Println("")
		log.Println("⚠️  El servidor está esperando credenciales de Meta")
		log.Println("💡 Configúralas en la página de Integraciones de Attomos")
	}

	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatalf("❌ Error iniciando servidor: %v", err)
	}
}

// handleWebhookWithAgent maneja las peticiones del webhook con ID de agente
func handleWebhookWithAgent(w http.ResponseWriter, r *http.Request, client *MetaClient, verifyToken string) {
	// Extraer agent ID de la URL
	path := r.URL.Path
	parts := strings.Split(strings.Trim(path, "/"), "/")

	var agentID string
	if len(parts) >= 3 {
		agentID = parts[2] // /webhook/meta/{agentId}
	}

	// Verificar que el agentID del ambiente coincida (opcional - seguridad extra)
	envAgentID := os.Getenv("AGENT_ID")
	if envAgentID != "" && agentID != "" && agentID != envAgentID {
		log.Printf("⚠️  Agent ID en URL (%s) no coincide con AGENT_ID del ambiente (%s)", agentID, envAgentID)
		// Nota: Por ahora solo logueamos, pero podrías rechazar la petición aquí
	}

	log.Printf("📍 Webhook recibido para agente: %s", agentID)

	// GET: Verificación del webhook
	if r.Method == http.MethodGet {
		handleWebhookVerification(w, r, verifyToken, agentID)
		return
	}

	// POST: Mensajes entrantes
	if r.Method == http.MethodPost {
		handleIncomingMessage(w, r, client, agentID)
		return
	}

	w.WriteHeader(http.StatusMethodNotAllowed)
}

// handleWebhook maneja las peticiones del webhook (ruta original sin agentId)
func handleWebhook(w http.ResponseWriter, r *http.Request, client *MetaClient, verifyToken string) {
	// GET: Verificación del webhook
	if r.Method == http.MethodGet {
		handleWebhookVerification(w, r, verifyToken, "")
		return
	}

	// POST: Mensajes entrantes
	if r.Method == http.MethodPost {
		handleIncomingMessage(w, r, client, "")
		return
	}

	w.WriteHeader(http.StatusMethodNotAllowed)
}

// handleWebhookVerification maneja la verificación inicial del webhook
func handleWebhookVerification(w http.ResponseWriter, r *http.Request, verifyToken string, agentID string) {
	mode := r.URL.Query().Get("hub.mode")
	token := r.URL.Query().Get("hub.verify_token")
	challenge := r.URL.Query().Get("hub.challenge")

	log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
	log.Println("🔐 VERIFICACIÓN DE WEBHOOK")
	log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
	if agentID != "" {
		log.Printf("   🤖 Agent ID: %s", agentID)
	}
	log.Printf("   Mode: %s", mode)
	log.Printf("   Token: %s", maskSensitiveData(token))
	log.Printf("   Challenge: %s", challenge)

	if mode == "subscribe" && token == verifyToken {
		log.Println("✅ Token verificado correctamente")
		if agentID != "" {
			log.Printf("✅ Webhook configurado para agente: %s", agentID)
		}
		log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(challenge))
		return
	}

	log.Println("❌ Token de verificación inválido")
	log.Printf("   Esperado: %s", maskSensitiveData(verifyToken))
	log.Printf("   Recibido: %s", maskSensitiveData(token))
	log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
	w.WriteHeader(http.StatusForbidden)
	w.Write([]byte("Forbidden"))
}

// handleIncomingMessage maneja los mensajes entrantes
func handleIncomingMessage(w http.ResponseWriter, r *http.Request, client *MetaClient, agentID string) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		log.Printf("❌ Error leyendo body: %v", err)
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	// 🔧 CAMBIO: Verificar si el cliente tiene credenciales antes de procesar
	if !client.IsConfigured() {
		log.Println("")
		log.Println("⚠️  ═══════════════════════════════════════════════════")
		log.Println("⚠️  MENSAJE RECIBIDO - CREDENCIALES NO CONFIGURADAS")
		log.Println("⚠️  ═══════════════════════════════════════════════════")
		log.Println("")
		if agentID != "" {
			log.Printf("🤖 Agent ID: %s\n", agentID)
		}
		log.Println("📨 Se recibió un mensaje pero el bot no puede responder")
		log.Println("💡 Configura las credenciales de Meta en Integraciones")
		log.Println("")
		log.Printf("📋 Payload recibido (primeros 200 chars):\n%s\n", truncateString(string(body), 200))

		// Responder OK a Meta para evitar reintentos
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
		return
	}

	var payload MetaWebhookPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		log.Printf("❌ Error parseando JSON: %v", err)
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	// Responder inmediatamente a Meta (200 OK)
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("OK"))

	// Procesar mensajes en goroutine
	go processWebhookPayload(&payload, client, agentID)
}

// processWebhookPayload procesa el payload del webhook
func processWebhookPayload(payload *MetaWebhookPayload, client *MetaClient, agentID string) {
	if payload.Object != "whatsapp_business_account" {
		return
	}

	for _, entry := range payload.Entry {
		for _, change := range entry.Changes {
			if change.Field != "messages" {
				continue
			}

			// Procesar mensajes
			for _, message := range change.Value.Messages {
				processMessage(&message, &change.Value, client, agentID)
			}

			// Procesar estados (opcional - para logs)
			for _, status := range change.Value.Statuses {
				processStatus(&status)
			}
		}
	}
}

// processMessage procesa un mensaje individual
func processMessage(message *struct {
	From      string `json:"from"`
	ID        string `json:"id"`
	Timestamp string `json:"timestamp"`
	Type      string `json:"type"`
	Text      struct {
		Body string `json:"body"`
	} `json:"text"`
}, value *struct {
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
}, client *MetaClient, agentID string) {

	// Solo procesar mensajes de texto
	if message.Type != "text" {
		log.Printf("ℹ️  Mensaje de tipo '%s' ignorado", message.Type)
		return
	}

	phoneNumber := message.From
	messageText := message.Text.Body
	messageID := message.ID

	// Obtener nombre del contacto
	senderName := "Cliente"
	if len(value.Contacts) > 0 {
		senderName = value.Contacts[0].Profile.Name
	}

	log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
	log.Printf("📨 MENSAJE RECIBIDO")
	if agentID != "" {
		log.Printf("   🤖 Agent ID: %s", agentID)
	}
	log.Printf("   👤 De: %s (%s)", senderName, phoneNumber)
	log.Printf("   💬 Texto: %s", messageText)
	log.Printf("   🆔 Message ID: %s", messageID)
	log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

	// Marcar como leído
	if err := client.MarkAsRead(messageID); err != nil {
		log.Printf("⚠️  Error marcando mensaje como leído: %v", err)
	}

	// Procesar mensaje (usar la misma lógica de AtomicBot)
	response := ProcessMessage(messageText, phoneNumber, senderName)

	// Enviar respuesta
	if response != "" {
		log.Printf("📤 ENVIANDO RESPUESTA a %s...", senderName)
		if err := client.SendMessage(phoneNumber, response); err != nil {
			log.Printf("❌ ERROR enviando mensaje: %v", err)
		} else {
			log.Printf("✅ RESPUESTA ENVIADA correctamente")
			log.Printf("   📝 Contenido: %s", truncateString(response, 100))
		}
	} else {
		log.Printf("⚠️  No se generó respuesta para este mensaje")
	}
	log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
}

// processStatus procesa actualizaciones de estado de mensajes
func processStatus(status *struct {
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
}) {
	statusMap := map[string]string{
		"sent":      "✓ Enviado",
		"delivered": "✓✓ Entregado",
		"read":      "✓✓ Leído",
		"failed":    "❌ Fallido",
	}

	statusEmoji := statusMap[status.Status]
	if statusEmoji == "" {
		statusEmoji = fmt.Sprintf("ℹ️  %s", status.Status)
	}

	log.Printf("%s Mensaje %s - Destinatario: %s", statusEmoji, status.ID[:8], status.RecipientID)
}

// truncateString trunca un string a una longitud máxima
func truncateString(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}
