package src

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/google/generative-ai-go/genai"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/types/events"
)

// OrderItem representa un producto en el carrito
type OrderItem struct {
	Title    string
	Quantity int
	Price    float64
}

// UserState estado del usuario
type UserState struct {
	IsScheduling        bool
	IsCancelling        bool
	IsAskingForEmail    bool
	IsOrdering          bool
	Step                int
	Data                map[string]string
	Cart                []OrderItem
	ConversationHistory []string
	LastMessageTime     int64
}

var (
	userStates = make(map[string]*UserState)
	stateMutex sync.RWMutex

	// processedMsgs evita procesar el mismo mensaje dos veces
	// (whatsmeow puede disparar el evento duplicado por retries de WebSocket)
	processedMsgs   = make(map[string]int64) // messageID → timestamp unix
	processedMsgsMu sync.Mutex
)

// isDuplicateMessage retorna true si el messageID ya fue procesado en los últimos 10 segundos.
func isDuplicateMessage(msgID string) bool {
	processedMsgsMu.Lock()
	defer processedMsgsMu.Unlock()

	now := time.Now().Unix()

	// Limpiar entradas viejas (> 60s) para no crecer indefinidamente
	for id, ts := range processedMsgs {
		if now-ts > 60 {
			delete(processedMsgs, id)
		}
	}

	if _, seen := processedMsgs[msgID]; seen {
		return true
	}
	processedMsgs[msgID] = now
	return false
}

// GetUserState obtiene o crea el estado de un usuario
func GetUserState(userID string) *UserState {
	stateMutex.Lock()
	defer stateMutex.Unlock()

	if state, exists := userStates[userID]; exists {
		return state
	}

	state := &UserState{
		IsScheduling:        false,
		IsCancelling:        false,
		IsAskingForEmail:    false,
		Step:                0,
		Data:                make(map[string]string),
		ConversationHistory: []string{},
		LastMessageTime:     time.Now().Unix(),
	}

	userStates[userID] = state
	return state
}

// ClearUserState limpia el estado de un usuario
func ClearUserState(userID string) {
	stateMutex.Lock()
	defer stateMutex.Unlock()
	delete(userStates, userID)
}

// HandleMessage maneja los mensajes entrantes
func HandleMessage(msg *events.Message, client *whatsmeow.Client) {
	// Ignorar mensajes propios
	if msg.Info.IsFromMe {
		return
	}

	// Ignorar mensajes de grupos
	if msg.Info.IsGroup {
		return
	}

	// Deduplicar: ignorar si ya procesamos este mensaje (whatsmeow puede enviarlo dos veces)
	if isDuplicateMessage(msg.Info.ID) {
		log.Printf("⚠️  Mensaje duplicado ignorado: %s", msg.Info.ID)
		return
	}

	phoneNumber := msg.Info.Chat.User
	senderName := msg.Info.PushName
	if senderName == "" {
		senderName = "Cliente"
	}

	// Obtener texto del mensaje
	var messageText string
	if msg.Message.GetConversation() != "" {
		messageText = msg.Message.GetConversation()
	} else if msg.Message.GetExtendedTextMessage() != nil {
		messageText = msg.Message.GetExtendedTextMessage().GetText()
	}

	if messageText == "" {
		return
	}

	log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
	log.Printf("📨 MENSAJE RECIBIDO")
	log.Printf("   👤 De: %s (%s)", senderName, phoneNumber)
	log.Printf("   💬 Texto: %s", messageText)
	log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

	// Procesar mensaje — Gemini es quien decide qué hacer
	response := ProcessMessage(messageText, phoneNumber, senderName)

	// ── Interceptar SEND_MENU: Gemini decidió enviar el menú como archivo ───
	// Necesitamos el JID aquí para poder enviar imagen/documento.
	if strings.Contains(response, "SEND_MENU") {
		if BusinessCfg != nil && BusinessCfg.MenuUrl != "" {
			menuURL := BusinessCfg.MenuUrl
			urlLower := strings.ToLower(menuURL)
			menuFileName := "Menú - " + BusinessCfg.AgentName
			var sendErr error
			if strings.HasSuffix(urlLower, ".pdf") {
				sendErr = SendDocument(msg.Info.Chat, menuURL, menuFileName+".pdf", "")
			} else {
				for _, e := range []string{".jpg", ".jpeg", ".png", ".webp"} {
					if strings.HasSuffix(urlLower, e) {
						menuFileName += e
						break
					}
				}
				sendErr = SendImage(msg.Info.Chat, menuURL, "")
			}
			if sendErr != nil {
				log.Printf("❌ Error enviando menú: %v", sendErr)
				SendMessage(msg.Info.Chat, "Aquí te lo dejo: "+menuURL)
			} else {
				log.Printf("✅ Menú enviado como archivo")
			}
		} else {
			// No hay MenuUrl — enviar el menú en texto
			SendMessage(msg.Info.Chat, buildMenuResponse())
		}
		log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
		return
	}

	// ── Interceptar SEND_PHOTOS: Gemini solicita enviar fotos de un producto ─
	if idx := strings.Index(response, "SEND_PHOTOS:"); idx != -1 {
		raw := response[idx+len("SEND_PHOTOS:"):]
		end := len(raw)
		for i, ch := range raw {
			if ch == '\n' || ch == '\r' || ch == '🌽' || ch == '🍕' || ch == '✅' {
				end = i
				break
			}
		}
		serviceTitle := strings.TrimSpace(raw[:end])
		log.Printf("📸 Gemini solicita fotos del servicio: %s", serviceTitle)
		sent := false
		if BusinessCfg != nil {
			var matched *Service
			queryNorm := normalizeStr(serviceTitle)

			// 1. Coincidencia exacta (case-insensitive)
			for i := range BusinessCfg.Services {
				if strings.EqualFold(strings.TrimSpace(BusinessCfg.Services[i].Title), serviceTitle) {
					matched = &BusinessCfg.Services[i]
					break
				}
			}
			// 2. Fuzzy: el título normalizado contiene la query o viceversa
			if matched == nil {
				for i := range BusinessCfg.Services {
					titleNorm := normalizeStr(BusinessCfg.Services[i].Title)
					if strings.Contains(titleNorm, queryNorm) || strings.Contains(queryNorm, titleNorm) {
						matched = &BusinessCfg.Services[i]
						break
					}
				}
			}

			if matched != nil && len(matched.ImageUrls) > 0 {
				for _, imgURL := range matched.ImageUrls {
					if err := SendImage(msg.Info.Chat, imgURL, ""); err != nil {
						log.Printf("❌ Error enviando foto de servicio: %v", err)
					}
				}
				log.Printf("✅ Fotos de '%s' enviadas (%d imágenes)", matched.Title, len(matched.ImageUrls))
				sent = true
			}
		}
		if !sent {
			log.Printf("⚠️  Servicio '%s' no encontrado o sin fotos", serviceTitle)
			SendMessage(msg.Info.Chat, "No encontré fotos de ese producto. ¿Puedes ser más específico?")
		}
		log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
		return
	}

	// Limpiar formato markdown de Gemini
	response = strings.ReplaceAll(response, "**", "*")
	response = cleanBoldSpaces(response)

	// Enviar respuesta
	if response != "" {
		log.Printf("📤 ENVIANDO RESPUESTA a %s...", senderName)
		if err := SendMessage(msg.Info.Chat, response); err != nil {
			log.Printf("❌ ERROR enviando mensaje: %v", err)
		} else {
			log.Printf("✅ RESPUESTA ENVIADA correctamente")
			log.Printf("   📝 Contenido: %s", response)
		}
	} else {
		log.Printf("⚠️  No se generó respuesta para este mensaje")
	}
	log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
}

// ProcessMessage procesa un mensaje y genera respuesta usando Gemini
func ProcessMessage(message, userID, userName string) string {
	t0Total := time.Now()
	state := GetUserState(userID)
	state.LastMessageTime = time.Now().Unix()

	log.Println("╔════════════════════════════════════════╗")
	log.Println("║     PROCESANDO MENSAJE                 ║")
	log.Println("╚════════════════════════════════════════╝")
	log.Printf("📊 Estado del usuario %s:", userName)
	log.Printf("   🔄 isScheduling: %v", state.IsScheduling)
	log.Printf("   🚫 isCancelling: %v", state.IsCancelling)
	log.Printf("   📋 Datos recopilados: %v", state.Data)
	log.Printf("   📝 Pasos completados: %d", state.Step)

	// Agregar al historial
	state.ConversationHistory = append(state.ConversationHistory, "Usuario: "+message)

	messageLower := strings.ToLower(message)

	// Detectar intención de cancelar cita
	cancelKeywords := []string{
		"cancelar cita", "cancel appointment", "eliminar cita",
		"borrar cita", "anular cita", "quiero cancelar", "necesito cancelar",
	}
	wantsToCancelAppointment := false
	for _, keyword := range cancelKeywords {
		if strings.Contains(messageLower, keyword) {
			wantsToCancelAppointment = true
			log.Printf("🚫 KEYWORD DE CANCELACIÓN DETECTADO: %s\n", keyword)
			break
		}
	}

	// Si está en flujo de email para recordatorio, procesarlo primero
	if state.IsAskingForEmail {
		log.Println("📧 PROCESANDO RESPUESTA DE RECORDATORIO POR EMAIL")
		return processEmailReminderResponse(state, message, userID)
	}

	// Flujo de pedido (pizzeria / comida)
	if isPizzeriaMode() {
		if state.IsOrdering {
			log.Println("🍕 CONTINUANDO FLUJO DE PEDIDO")
			return continueOrderFlow(state, message, userID, userName)
		}
		// Detectar intención de ordenar — Gemini también puede iniciarlo,
		// pero estas keywords son señales claras de pedido inmediato.
		orderKeywords := []string{
			"quiero", "dame", "me das", "pedido", "ordenar", "pedir",
			"quiero pedir", "quiero ordenar", "me pones", "ponme",
			"una pizza", "dos pizzas", "una gordita", "dos gorditas",
			"para llevar", "a domicilio", "para comer",
		}
		wantsToOrder := false
		for _, kw := range orderKeywords {
			if strings.Contains(messageLower, kw) {
				wantsToOrder = true
				break
			}
		}
		if wantsToOrder {
			log.Println("🍕 INICIANDO FLUJO DE PEDIDO")
			return startOrderFlow(state, message, userName)
		}
	}

	// Flujo de agendamiento automotriz (visita al concesionario / taller)
	if isAutomotrizMode() {
		autoKeywords := []string{
			"visita", "visitar", "agendar visita", "agendar cita",
			"ver el auto", "ver el carro", "ver los autos", "ver los carros",
			"prueba de manejo", "test drive",
			"quiero ir", "quiero visitar", "quiero ver",
			"ir al concesionario", "ir a la agencia",
			"revisión", "revision", "mantenimiento",
			"llevar el carro", "llevar el auto", "llevar mi carro", "llevar mi auto",
		}
		wantsAutoAppointment := false
		for _, kw := range autoKeywords {
			if strings.Contains(messageLower, kw) {
				wantsAutoAppointment = true
				break
			}
		}
		if wantsAutoAppointment && !state.IsScheduling {
			log.Println("🚗 INICIANDO FLUJO DE AGENDAMIENTO AUTOMOTRIZ")
			return startAutoAppointmentFlow(state, message, userName)
		}
	}

	// Si quiere cancelar y no está cancelando
	if wantsToCancelAppointment && !state.IsCancelling {
		log.Println("🚫 INICIANDO PROCESO DE CANCELACIÓN")
		return startCancellationFlow(state, message, userName)
	}

	// Si está cancelando, continuar
	if state.IsCancelling {
		log.Println("🚫 CONTINUANDO PROCESO DE CANCELACIÓN")
		return continueCancellationFlow(state, message, userID, userName)
	}

	// Analizar intención usando Gemini
	log.Println("🔍 Analizando intención del mensaje...")
	analysis, err := AnalyzeForAppointment(
		message,
		joinHistory(state.ConversationHistory),
		state.IsScheduling,
	)
	if err != nil {
		log.Printf("⚠️  Error en análisis: %v", err)
		log.Println("📞 Usando conversación normal como fallback")
		return handleNormalConversation(message, state)
	}

	log.Printf("✅ Análisis completado:")
	log.Printf("   🎯 Quiere agendar: %v", analysis.WantsToSchedule)
	log.Printf("   📊 Confianza: %.2f", analysis.Confidence)
	log.Printf("   📋 Datos extraídos: %v", analysis.ExtractedData)

	// Si quiere agendar y no está agendando
	if analysis.WantsToSchedule && !state.IsScheduling {
		log.Println("🎯 INICIANDO PROCESO DE AGENDAMIENTO")
		return startAppointmentFlow(state, analysis, message)
	}

	// Si está agendando, continuar
	if state.IsScheduling {
		if state.Data["_mode"] == "automotriz" {
			log.Println("🚗 CONTINUANDO FLUJO AUTOMOTRIZ")
			return continueAutoAppointmentFlow(state, message, userID)
		}
		log.Println("📝 CONTINUANDO PROCESO DE AGENDAMIENTO")
		return continueAppointmentFlow(state, analysis, message, userID)
	}

	// Conversación normal — Gemini al mando
	log.Println("💬 CONVERSACIÓN NORMAL — Gemini decide")
	result := handleNormalConversation(message, state)
	log.Printf("⏱️  [Total] Mensaje procesado en: %dms", time.Since(t0Total).Milliseconds())
	return result
}

// startCancellationFlow inicia el flujo de cancelación de citas
func startCancellationFlow(state *UserState, message, userName string) string {
	log.Println("╔════════════════════════════════════════╗")
	log.Println("║  INICIANDO FLUJO DE CANCELACIÓN        ║")
	log.Println("╚════════════════════════════════════════╝")

	state.IsCancelling = true
	state.Step = 1

	dateRegex := regexp.MustCompile(`(\d{1,2})/(\d{1,2})/(\d{4})`)
	timeRegex := regexp.MustCompile(`(\d{1,2}):(\d{2})`)

	dateMatch := dateRegex.FindStringSubmatch(message)
	timeMatch := timeRegex.FindStringSubmatch(message)

	if len(dateMatch) >= 4 && len(timeMatch) >= 3 {
		state.Data["fecha_cancelar"] = fmt.Sprintf("%s/%s/%s", dateMatch[1], dateMatch[2], dateMatch[3])
		state.Data["hora_cancelar"] = fmt.Sprintf("%s:%s", timeMatch[1], timeMatch[2])
		log.Printf("✅ Fecha y hora extraídas: %s %s\n", state.Data["fecha_cancelar"], state.Data["hora_cancelar"])
		return processCancellation(state, userName)
	}

	response := fmt.Sprintf(`Para cancelar tu cita, %s, necesito los siguientes datos:

📅 *Fecha de tu cita:* DD/MM/YYYY
🕐 *Hora de tu cita:* HH:MM

Ejemplo: "Cancelar cita 15/01/2026 10:30"

Por favor envíame los datos de la cita que deseas cancelar.`, userName)

	state.ConversationHistory = append(state.ConversationHistory, "Asistente: "+response)
	return response
}

// continueCancellationFlow continúa el flujo de cancelación
func continueCancellationFlow(state *UserState, message string, _ string, userName string) string {
	log.Println("╔════════════════════════════════════════╗")
	log.Println("║  CONTINUANDO FLUJO DE CANCELACIÓN      ║")
	log.Println("╚════════════════════════════════════════╝")

	dateRegex := regexp.MustCompile(`(\d{1,2})/(\d{1,2})/(\d{4})`)
	timeRegex := regexp.MustCompile(`(\d{1,2}):(\d{2})`)

	dateMatch := dateRegex.FindStringSubmatch(message)
	timeMatch := timeRegex.FindStringSubmatch(message)

	if len(dateMatch) >= 4 {
		state.Data["fecha_cancelar"] = fmt.Sprintf("%s/%s/%s", dateMatch[1], dateMatch[2], dateMatch[3])
		log.Printf("✅ Fecha extraída: %s\n", state.Data["fecha_cancelar"])
	}

	if len(timeMatch) >= 3 {
		state.Data["hora_cancelar"] = fmt.Sprintf("%s:%s", timeMatch[1], timeMatch[2])
		log.Printf("✅ Hora extraída: %s\n", state.Data["hora_cancelar"])
	}

	if state.Data["fecha_cancelar"] != "" && state.Data["hora_cancelar"] != "" {
		return processCancellation(state, userName)
	}

	if state.Data["fecha_cancelar"] == "" {
		return "Por favor, indícame la *fecha* de tu cita (DD/MM/YYYY):"
	}

	if state.Data["hora_cancelar"] == "" {
		return "Por favor, indícame la *hora* de tu cita (HH:MM):"
	}

	return "Por favor, envíame la fecha y hora de tu cita en el formato: DD/MM/YYYY HH:MM"
}

// processCancellation procesa la cancelación de la cita
func processCancellation(state *UserState, userName string) string {
	log.Println("🚫 PROCESANDO CANCELACIÓN DE CITA")

	fecha := state.Data["fecha_cancelar"]
	hora := state.Data["hora_cancelar"]

	log.Printf("   Fecha: %s\n", fecha)
	log.Printf("   Hora: %s\n", hora)

	fechaHoraStr := fmt.Sprintf("%s %s", fecha, hora)
	appointmentDateTime, err := time.Parse("02/01/2006 15:04", fechaHoraStr)
	if err != nil {
		log.Printf("❌ Error parseando fecha/hora: %v\n", err)
		state.IsCancelling = false
		return "❌ Formato de fecha/hora inválido. Por favor usa el formato: DD/MM/YYYY HH:MM"
	}

	telefono := ""
	if state.Data["telefono"] != "" {
		telefono = state.Data["telefono"]
	}

	if IsSheetsEnabled() {
		err := CancelAppointmentByClient(userName, telefono, appointmentDateTime)
		if err != nil {
			log.Printf("❌ Error cancelando en Sheets: %v", err)
			state.IsCancelling = false
			return fmt.Sprintf(`❌ No encontré una cita agendada para:

📅 *Fecha:* %s
🕐 *Hora:* %s

Por favor verifica los datos y vuelve a intentar.`,
				appointmentDateTime.Format("02/01/2006"),
				appointmentDateTime.Format("15:04"))
		} else {
			log.Printf("✅ Cita cancelada en Google Sheets")
		}
	}

	if IsCalendarEnabled() {
		events, err := SearchEventsByPatient(userName)
		if err == nil && len(events) > 0 {
			for _, event := range events {
				if event.Start != nil && event.Start.DateTime != "" {
					eventTime, _ := time.Parse(time.RFC3339, event.Start.DateTime)
					if eventTime.Format("02/01/2006 15:04") == appointmentDateTime.Format("02/01/2006 15:04") {
						log.Printf("✅ Evento encontrado en Calendar para cancelación")
						break
					}
				}
			}
		}
	}

	state.IsCancelling = false
	state.Data = make(map[string]string)

	return fmt.Sprintf(`✅ *Cita cancelada exitosamente*

👤 *Cliente:* %s
📅 *Fecha:* %s
🕐 *Hora:* %s

Tu cita ha sido cancelada. Si deseas reagendar, házmelo saber.

¿Puedo ayudarte en algo más?`,
		userName,
		appointmentDateTime.Format("02/01/2006"),
		appointmentDateTime.Format("15:04"))
}

func startAppointmentFlow(state *UserState, analysis *AppointmentAnalysis, message string) string {
	log.Println("╔════════════════════════════════════════╗")
	log.Println("║  INICIANDO FLUJO DE AGENDAMIENTO       ║")
	log.Println("╚════════════════════════════════════════╝")

	state.IsScheduling = true
	state.Step = 1

	if analysis.ExtractedData != nil {
		log.Println("📋 Extrayendo datos del mensaje inicial:")
		for key, value := range analysis.ExtractedData {
			if value != "" && value != "null" {
				state.Data[key] = value
				log.Printf("   ✅ %s = %s", key, value)
			}
		}
	}

	missingData := getMissingData(state.Data)
	log.Printf("📊 Datos completos: %v", state.Data)
	log.Printf("❓ Datos faltantes: %v", missingData)

	var promptContext string
	if len(missingData) > 0 {
		promptContext = fmt.Sprintf("El cliente quiere agendar una cita. Ya tenemos: %v. Pide SOLO el siguiente dato: %s. NO pidas teléfono. Sé breve (1-2 líneas).",
			state.Data,
			missingData[0],
		)
	} else {
		promptContext = "Confirma todos los datos antes de guardar: " + fmt.Sprintf("%v", state.Data)
	}

	response, err := Chat(promptContext, message, joinHistory(state.ConversationHistory))
	if err != nil {
		log.Printf("❌ Error en chat: %v", err)
		return "¡Perfecto! Vamos a agendar tu cita. ¿Cuál es tu nombre completo?"
	}

	state.ConversationHistory = append(state.ConversationHistory, "Asistente: "+response)
	return response
}

func continueAppointmentFlow(state *UserState, analysis *AppointmentAnalysis, message, userID string) string {
	log.Println("╔════════════════════════════════════════╗")
	log.Println("║  CONTINUANDO FLUJO DE AGENDAMIENTO     ║")
	log.Println("╚════════════════════════════════════════╝")

	state.Data["userID"] = userID

	if analysis.ExtractedData != nil {
		log.Println("📋 Extrayendo datos del mensaje actual:")
		for key, value := range analysis.ExtractedData {
			if value != "" && value != "null" {
				state.Data[key] = value
				log.Printf("   ✅ %s = %s", key, value)
			}
		}
	}

	missingData := getMissingData(state.Data)
	log.Printf("📋 Datos actuales: %v", state.Data)
	log.Printf("❓ Datos faltantes: %v", missingData)

	if len(missingData) > 0 {
		log.Printf("⚠️  Faltan %d datos, solicitando: %s", len(missingData), missingData[0])

		promptContext := fmt.Sprintf(
			"Estamos agendando una cita. Datos ya recopilados: %v. Pide ÚNICAMENTE: %s. NO repitas preguntas. NO pidas teléfono. 1-2 líneas máximo.",
			state.Data,
			missingData[0],
		)

		response, err := Chat(promptContext, message, joinHistory(state.ConversationHistory))
		if err != nil {
			return fmt.Sprintf("Por favor, dime tu %s:", missingData[0])
		}

		state.ConversationHistory = append(state.ConversationHistory, "Asistente: "+response)
		return response
	}

	log.Println("🎉 TODOS LOS DATOS COMPLETOS - PREGUNTANDO POR RECORDATORIO")
	return askForEmailReminder(state)
}

// askForEmailReminder pregunta al cliente si desea un recordatorio por email
func askForEmailReminder(state *UserState) string {
	state.IsAskingForEmail = true
	state.Data["email_step"] = "asking"

	nombre := state.Data["nombre"]
	if nombre == "" {
		nombre = "cliente"
	}

	// Icono y etiqueta según modo
	servicioIcon := "✂️"
	workerLabel := "💈 *Con:*"
	if state.Data["_mode"] == "automotriz" {
		servicioIcon = "🚗"
		workerLabel = "👤 *Asesor:*"
	}

	response := fmt.Sprintf(`📋 *Resumen de tu cita:*

👤 *Nombre:* %s
%s *Servicio:* %s
📅 *Fecha:* %s
🕐 *Hora:* %s`,
		state.Data["nombre"],
		servicioIcon,
		state.Data["servicio"],
		state.Data["fecha"],
		state.Data["hora"],
	)

	if state.Data["barbero"] != "" {
		response += fmt.Sprintf("\n%s %s", workerLabel, state.Data["barbero"])
	}

	response += `

¿Te gustaría recibir un recordatorio por correo electrónico? 📧

Responde *sí* para agregar tu email, o *no* para continuar sin recordatorio.`

	return response
}

// processEmailReminderResponse procesa la respuesta del cliente sobre el recordatorio
func processEmailReminderResponse(state *UserState, message string, _ string) string {
	userID := state.Data["userID"]
	msgLower := strings.ToLower(strings.TrimSpace(message))

	emailStep := state.Data["email_step"]

	if emailStep == "asking" {
		quiereSi := []string{"si", "sí", "yes", "claro", "ok", "dale", "va", "quiero", "porfa", "por favor", "ándale", "andale"}
		quiereNo := []string{"no", "nel", "nope", "sin recordatorio", "no gracias", "no quiero"}

		for _, kw := range quiereSi {
			if strings.Contains(msgLower, kw) {
				log.Println("📧 Cliente QUIERE recordatorio por email - pidiendo correo")
				state.Data["email_step"] = "waiting_email"
				return "¡Perfecto! 📧 Por favor escribe tu correo electrónico:"
			}
		}

		for _, kw := range quiereNo {
			if strings.Contains(msgLower, kw) {
				log.Println("📧 Cliente NO quiere recordatorio - guardando cita sin email")
				state.IsAskingForEmail = false
				delete(state.Data, "email_step")
				return saveAppointment(state, userID)
			}
		}

		return "No entendí tu respuesta 😅\n\n¿Quieres recibir un recordatorio por correo electrónico?\nResponde *sí* o *no*."
	}

	if emailStep == "waiting_email" {
		email := strings.TrimSpace(message)

		if isValidEmail(email) {
			log.Printf("📧 Email recibido y válido: %s", email)
			state.Data["email"] = email
			state.IsAskingForEmail = false
			delete(state.Data, "email_step")
			return saveAppointment(state, userID)
		}

		log.Printf("⚠️  Email inválido recibido: %s", email)
		return "Ese correo no parece válido 🤔\n\nPor favor escribe un correo electrónico válido (ejemplo: nombre@gmail.com):"
	}

	state.IsAskingForEmail = false
	delete(state.Data, "email_step")
	return saveAppointment(state, userID)
}

// isValidEmail valida formato básico de email
func isValidEmail(email string) bool {
	atIdx := strings.Index(email, "@")
	if atIdx < 1 {
		return false
	}
	domain := email[atIdx+1:]
	dotIdx := strings.LastIndex(domain, ".")
	if dotIdx < 1 || dotIdx == len(domain)-1 {
		return false
	}
	return true
}

func saveAppointment(state *UserState, userID string) string {
	log.Println("")
	log.Println("╔════════════════════════════════════════════════════════╗")
	log.Println("║                                                        ║")
	log.Println("║          🎯 GUARDANDO CITA - INICIO                    ║")
	log.Println("║                                                        ║")
	log.Println("╚════════════════════════════════════════════════════════╝")

	telefono := cleanPhoneNumber(userID)
	log.Printf("📞 Teléfono procesado: %s → %s", userID, telefono)

	log.Println("📅 Procesando fecha...")
	_, fechaExacta, err := ConvertirFechaADia(state.Data["fecha"])
	if err != nil {
		log.Printf("❌ ERROR convirtiendo fecha '%s': %v", state.Data["fecha"], err)
		fechaExacta = state.Data["fecha"]
	} else {
		log.Printf("✅ Fecha convertida: %s → %s", state.Data["fecha"], fechaExacta)
	}

	log.Println("⏰ Procesando hora...")
	horaNormalizada, err := NormalizarHora(state.Data["hora"])
	if err != nil {
		log.Printf("❌ ERROR normalizando hora '%s': %v", state.Data["hora"], err)
		horaNormalizada = state.Data["hora"]
	} else {
		log.Printf("✅ Hora normalizada: %s → %s", state.Data["hora"], horaNormalizada)
	}

	appointmentData := map[string]string{
		"nombre":      state.Data["nombre"],
		"telefono":    telefono,
		"servicio":    state.Data["servicio"],
		"barbero":     state.Data["barbero"],
		"fecha":       state.Data["fecha"],
		"fechaExacta": fechaExacta,
		"hora":        horaNormalizada,
		"email":       state.Data["email"],
	}

	log.Println("")
	log.Println("📋 DATOS DE LA CITA A GUARDAR:")
	log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
	for key, value := range appointmentData {
		log.Printf("   %s: %s", key, value)
	}
	log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
	log.Println("")

	log.Println("📊 PASO 1/2: Guardando en Google Sheets...")
	sheetsErr := SaveAppointmentToSheets(
		appointmentData["nombre"],
		appointmentData["telefono"],
		appointmentData["fechaExacta"],
		appointmentData["hora"],
		appointmentData["servicio"],
		appointmentData["barbero"],
	)
	if sheetsErr != nil {
		log.Printf("❌ ERROR guardando en Sheets: %v", sheetsErr)
	} else {
		log.Println("✅ GUARDADO EN SHEETS EXITOSO")
	}

	log.Println("")
	log.Println("📅 PASO 2/2: Creando evento en Google Calendar...")
	calendarEvent, calendarErr := CreateCalendarEvent(appointmentData)
	if calendarErr != nil {
		log.Printf("❌ ERROR creando evento en Calendar: %v", calendarErr)
	} else {
		log.Println("✅ EVENTO EN CALENDAR CREADO EXITOSO")
		if calendarEvent != nil {
			log.Printf("   🔗 Link: %s", calendarEvent.HtmlLink)
		}
	}

	log.Println("")
	log.Println("╔════════════════════════════════════════════════════════╗")
	log.Println("║          ✅ GUARDADO COMPLETADO                        ║")
	log.Println("╚════════════════════════════════════════════════════════╝")

	if sheetsErr != nil || calendarErr != nil {
		log.Println("⚠️  RESUMEN DE ERRORES:")
		if sheetsErr != nil {
			log.Printf("   📊 Sheets: %v", sheetsErr)
		}
		if calendarErr != nil {
			log.Printf("   📅 Calendar: %v", calendarErr)
		}
	} else {
		log.Println("🎉 CITA GUARDADA EXITOSAMENTE EN AMBOS SERVICIOS")
	}
	log.Println("")

	log.Println("📤 PASO 3/3: Guardando cita en backend de Attomos...")
	backendPayload := BotAppointmentPayload{
		ClientName: appointmentData["nombre"],
		Phone:      appointmentData["telefono"],
		Service:    appointmentData["servicio"],
		Worker:     appointmentData["barbero"],
		Date:       appointmentData["fechaExacta"],
		Time:       appointmentData["hora"],
		Notes:      appointmentData["email"],
	}
	if len(backendPayload.Date) == 10 {
		parts := strings.Split(backendPayload.Date, "/")
		if len(parts) == 3 {
			backendPayload.Date = parts[2] + "-" + parts[1] + "-" + parts[0]
		}
	}
	if h, m, err := ConvertirHoraA24h(backendPayload.Time); err == nil {
		backendPayload.Time = fmt.Sprintf("%02d:%02d", h, m)
	}

	if backendErr := SaveAppointmentToBackend(backendPayload); backendErr != nil {
		log.Printf("⚠️  [Backend] No se pudo guardar cita en Attomos: %v", backendErr)
	} else {
		log.Println("✅ [Backend] Cita guardada correctamente en panel de Attomos")
	}

	confirmation := generateConfirmationMessage(state.Data, fechaExacta, horaNormalizada)

	log.Println("✅ Mensaje de confirmación generado")
	log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
	log.Println("")

	if HasPaymentMethods() {
		servicio := state.Data["servicio"]
		precio := GetServicePrice(servicio)
		paymentMsg := BuildPaymentMessage(servicio, precio, "")
		if paymentMsg != "" {
			log.Println("💳 [Payments] Agregando opciones de pago al mensaje de confirmación")
			confirmation += "\n\n" + paymentMsg
		}
	}

	state.IsScheduling = false
	state.Data = make(map[string]string)

	return confirmation
}

func generateConfirmationMessage(data map[string]string, fechaExacta, horaNormalizada string) string {
	if geminiEnabled && BusinessCfg != nil {
		promptContext := fmt.Sprintf(`Genera un mensaje de confirmación de cita breve y profesional.

Datos de la cita:
- Nombre: %s
- Servicio: %s
- Fecha: %s
- Hora: %s
- Negocio: %s

Incluye:
- Confirmación entusiasta
- Resumen de los datos
- Agradecimiento
- Un emoji apropiado

Máximo 4-5 líneas.`,
			data["nombre"],
			data["servicio"],
			fechaExacta,
			horaNormalizada,
			BusinessCfg.AgentName)

		response, err := Chat(promptContext, "Confirmar cita", "")
		if err == nil && response != "" {
			return response
		}
	}

	confirmation := "¡Perfecto! 🎉 Tu cita ha sido agendada exitosamente.\n\n"
	confirmation += "📋 Resumen:\n"
	confirmation += fmt.Sprintf("👤 %s\n", data["nombre"])
	confirmation += fmt.Sprintf("✂️ %s\n", data["servicio"])
	if data["barbero"] != "" {
		confirmation += fmt.Sprintf("💈 Con: %s\n", data["barbero"])
	}
	confirmation += fmt.Sprintf("📅 %s a las %s\n\n", fechaExacta, horaNormalizada)
	confirmation += "¡Te esperamos! 😊"

	return confirmation
}

// isPizzeriaMode detecta si el negocio es de comida
func isPizzeriaMode() bool {
	if BusinessCfg == nil {
		return false
	}
	foodTypes := []string{
		"pizzeria", "pizza", "gorditas", "gordita", "restaurante", "comida",
		"taqueria", "tacos", "panaderia", "panadería", "reposteria", "repostería",
		"pasteleria", "pastelería", "libreria", "librería", "pescaderia", "pescadería",
		"ensaladas", "ensalada", "ensaladería", "ensaladeria",
		"mariscos", "marisco", "seafood", "cevicheria", "cevichería",
	}
	bt := strings.ToLower(BusinessCfg.BusinessType)
	for _, ft := range foodTypes {
		if strings.Contains(bt, ft) {
			return true
		}
	}
	return false
}

// isAutomotrizMode detecta si el negocio es automotriz (agendamiento de visita al concesionario / taller)
func isAutomotrizMode() bool {
	if BusinessCfg == nil {
		return false
	}
	autoTypes := []string{"automotriz", "concesionario", "agencia", "taller", "refaccionaria", "mecanico", "mecánico"}
	bt := strings.ToLower(BusinessCfg.BusinessType)
	for _, at := range autoTypes {
		if strings.Contains(bt, at) {
			return true
		}
	}
	return false
}

func startOrderFlow(state *UserState, message, userName string) string {
	state.IsOrdering = true
	state.Step = 1
	state.Cart = []OrderItem{}
	state.Data["userName"] = userName
	parseCartFromMessage(state, message)
	if len(state.Cart) > 0 {
		state.Step = 2
		response := buildCartSummary(state) + "\n\n" + "¿Cómo lo prefieres? 😊\n\n🛵 A domicilio\n🏪 Recoger en local\n🍽️ Comer aquí"
		state.ConversationHistory = append(state.ConversationHistory, "Asistente: "+response)
		return response
	}
	// Gemini responde cuando el mensaje no tiene productos detectables
	response, err := Chat(
		"El cliente quiere hacer un pedido pero no especificó qué productos quiere. Muéstrale el catálogo disponible y pregúntale qué desea ordenar.",
		message,
		joinHistory(state.ConversationHistory),
	)
	if err != nil {
		response = buildMenuResponse()
	}
	state.ConversationHistory = append(state.ConversationHistory, "Asistente: "+response)
	return response
}

func continueOrderFlow(state *UserState, message, userID, userName string) string {
	msgL := strings.ToLower(message)

	// Detectar cancelación del pedido
	if strings.Contains(msgL, "cancelar") || strings.Contains(msgL, "olvida") || strings.Contains(msgL, "no quiero") {
		state.IsOrdering = false
		state.Cart = []OrderItem{}
		state.Data = make(map[string]string)
		return "Entendido, pedido cancelado. ¿En qué más te puedo ayudar? 😊"
	}

	switch state.Step {
	case 1:
		// Intentar detectar productos en el mensaje
		parseCartFromMessage(state, message)
		if len(state.Cart) == 0 {
			// Gemini responde cuando no detecta productos
			response, err := Chat(
				"El cliente está en flujo de pedido pero su mensaje no especificó productos del catálogo claramente. Responde de forma natural, recuérdale qué opciones hay disponibles y pregúntale qué desea ordenar.",
				message,
				joinHistory(state.ConversationHistory),
			)
			if err != nil {
				response = buildMenuResponse()
			}
			state.ConversationHistory = append(state.ConversationHistory, "Asistente: "+response)
			return response
		}
		state.Step = 2
		response := buildCartSummary(state) + "\n\n" + "¿Cómo lo prefieres? 😊\n\n🛵 A domicilio\n🏪 Recoger en local\n🍽️ Comer aquí"
		state.ConversationHistory = append(state.ConversationHistory, "Asistente: "+response)
		return response

	case 2:
		// Detectar tipo de entrega con keywords claras
		if strings.Contains(msgL, "domicilio") || strings.Contains(msgL, "delivery") || strings.Contains(msgL, "a mi casa") || strings.Contains(msgL, "llevar") {
			state.Data["deliveryType"] = "domicilio"
			state.Step = 3
			response := "Perfecto! 🛵 ¿Cuál es tu dirección de entrega?"
			state.ConversationHistory = append(state.ConversationHistory, "Asistente: "+response)
			return response
		} else if strings.Contains(msgL, "recoger") || strings.Contains(msgL, "paso") || strings.Contains(msgL, "pick") {
			state.Data["deliveryType"] = "llevar"
			state.Step = 4
			return confirmOrder(state, userID, userName)
		} else if strings.Contains(msgL, "aqui") || strings.Contains(msgL, "aquí") || strings.Contains(msgL, "local") || strings.Contains(msgL, "mesa") || strings.Contains(msgL, "comer") {
			state.Data["deliveryType"] = "dine_in"
			state.Step = 4
			return confirmOrder(state, userID, userName)
		}
		// Gemini interpreta respuestas ambiguas sobre tipo de entrega
		response, err := Chat(
			"El cliente debe elegir cómo recibir su pedido: a domicilio, recoger en local, o comer en el local. Su mensaje fue ambiguo. Pregúntale de nuevo de forma natural y amigable, listando las opciones.",
			message,
			joinHistory(state.ConversationHistory),
		)
		if err != nil {
			response = "¿Cómo lo prefieres? 😊\n\n🛵 A domicilio\n🏪 Recoger en local\n🍽️ Comer aquí"
		}
		state.ConversationHistory = append(state.ConversationHistory, "Asistente: "+response)
		return response

	case 3:
		state.Data["deliveryAddress"] = message
		state.Step = 4
		return confirmOrder(state, userID, userName)

	default:
		state.IsOrdering = false
		return handleNormalConversation(message, state)
	}
}

func confirmOrder(state *UserState, userID, userName string) string {
	deliveryType := state.Data["deliveryType"]
	address := state.Data["deliveryAddress"]
	var sb strings.Builder
	sb.WriteString("🧾 *Resumen de tu pedido:*\n\n")
	total := 0.0
	for _, item := range state.Cart {
		sb.WriteString(fmt.Sprintf("• %dx %s — $%.0f\n", item.Quantity, item.Title, item.Price*float64(item.Quantity)))
		total += item.Price * float64(item.Quantity)
	}
	sb.WriteString(fmt.Sprintf("\n💰 *Total: $%.0f MXN*\n", total))
	switch deliveryType {
	case "domicilio":
		if address != "" {
			sb.WriteString(fmt.Sprintf("🛵 *Entrega a domicilio:* %s\n", address))
		} else {
			sb.WriteString("🛵 *Entrega a domicilio*\n")
		}
	case "dine_in":
		sb.WriteString("🍽️ *Para comer en el local*\n")
	default:
		sb.WriteString("🏪 *Recoger en local*\n")
	}
	sb.WriteString(fmt.Sprintf("👤 *Cliente:* %s\n", userName))

	if HasPaymentMethods() && len(state.Cart) > 0 {
		cfg := GetPaymentConfig()
		hasStripe := cfg.StripeEnabled && cfg.StripeChargesEnabled
		hasSPEI := cfg.SPEIEnabled && cfg.CLABENumber != ""

		sb.WriteString("\n\n💳 *Opciones de pago*\n")
		sb.WriteString("━━━━━━━━━━━━━━━━━━━━━━\n")
		sb.WriteString(fmt.Sprintf("💰 *Total:* $%.0f MXN\n\n", total))

		if hasSPEI {
			sb.WriteString("🏦 *Transferencia SPEI*\n")
			sb.WriteString(fmt.Sprintf("   CLABE: %s\n", cfg.CLABENumber))
			if cfg.BankName != "" {
				sb.WriteString(fmt.Sprintf("   Banco: %s\n", cfg.BankName))
			}
			if cfg.AccountName != "" {
				sb.WriteString(fmt.Sprintf("   A nombre de: %s\n", cfg.AccountName))
			}
		}

		if hasStripe {
			if hasSPEI {
				sb.WriteString("\n")
			}
			checkoutURL, err := CreateBotCheckoutURL(userName, userID, state.Cart)
			if err != nil {
				log.Printf("⚠️  [confirmOrder] Error generando link de pago: %v", err)
			} else {
				sb.WriteString("💳 *Pagar con tarjeta*\n")
				sb.WriteString(fmt.Sprintf("   👉 %s\n", checkoutURL))
			}
		}

		sb.WriteString("━━━━━━━━━━━━━━━━━━━━━━\n")
		sb.WriteString("_Puedes pagar antes o al momento de recoger_ 😊")
	}
	sb.WriteString("\n\n" + "Pedido recibido! Nos pondremos en contacto pronto. 🙌")

	// Guardar pedido en Attomos
	orderItems := make([]map[string]interface{}, 0, len(state.Cart))
	for _, item := range state.Cart {
		orderItems = append(orderItems, map[string]interface{}{
			"title":    item.Title,
			"quantity": item.Quantity,
			"price":    item.Price,
		})
	}
	orderType := deliveryType
	if orderType == "llevar" {
		orderType = "pickup"
	}
	if orderType == "domicilio" {
		orderType = "delivery"
	}
	go SaveOrderToBackend(BotOrderPayload{
		ClientName:      userName,
		ClientPhone:     userID,
		Items:           orderItems,
		Total:           total,
		OrderType:       orderType,
		DeliveryAddress: address,
		Status:          "pending",
	})

	state.IsOrdering = false
	state.Cart = []OrderItem{}
	state.Data = make(map[string]string)
	response := sb.String()
	state.ConversationHistory = append(state.ConversationHistory, "Asistente: "+response)
	return response
}

// extractQuantity detecta la cantidad en un mensaje en lenguaje natural.
func extractQuantity(msgL string) int {
	for _, pair := range []struct {
		word string
		n    int
	}{
		{"10", 10}, {"9", 9}, {"8", 8}, {"7", 7}, {"6", 6},
		{"5", 5}, {"4", 4}, {"3", 3}, {"2", 2},
	} {
		if strings.Contains(msgL, pair.word) {
			return pair.n
		}
	}
	for _, pair := range []struct {
		word string
		n    int
	}{
		{"diez", 10}, {"nueve", 9}, {"ocho", 8}, {"siete", 7}, {"seis", 6},
		{"cinco", 5}, {"cuatro", 4}, {"tres", 3}, {"dos", 2},
		{"una", 1}, {"uno", 1}, {"un", 1},
	} {
		if strings.Contains(msgL, pair.word) {
			return pair.n
		}
	}
	return 1
}

func parseCartFromMessage(state *UserState, message string) {
	if BusinessCfg == nil || len(BusinessCfg.Services) == 0 {
		return
	}

	// Intentar con Gemini primero
	if geminiEnabled {
		items, err := extractCartWithGemini(message)
		if err == nil && len(items) > 0 {
			for _, item := range items {
				alreadyIn := false
				for i, existing := range state.Cart {
					if strings.EqualFold(existing.Title, item.Title) {
						state.Cart[i].Quantity += item.Quantity
						alreadyIn = true
						break
					}
				}
				if !alreadyIn {
					state.Cart = append(state.Cart, item)
				}
			}
			return
		}
		if err != nil {
			log.Printf("⚠️  [Cart] Gemini falló, usando fallback: %v", err)
		}
	}

	// Fallback: match exacto del título completo
	msgL := normalizeStr(message)
	for _, svc := range BusinessCfg.Services {
		if !svc.InStock {
			continue
		}
		titleL := normalizeStr(svc.Title)
		if !strings.Contains(msgL, titleL) {
			continue
		}
		qty := extractQuantity(msgL)
		price := effectivePrice(svc)
		alreadyIn := false
		for i, item := range state.Cart {
			if strings.EqualFold(item.Title, svc.Title) {
				state.Cart[i].Quantity += qty
				alreadyIn = true
				break
			}
		}
		if !alreadyIn {
			state.Cart = append(state.Cart, OrderItem{Title: svc.Title, Quantity: qty, Price: price})
		}
	}
}

// extractCartWithGemini usa Gemini para identificar qué productos del catálogo
// pidió el cliente y en qué cantidad, tolerando errores ortográficos y variaciones.
func extractCartWithGemini(message string) ([]OrderItem, error) {
	if BusinessCfg == nil || len(BusinessCfg.Services) == 0 {
		return nil, fmt.Errorf("sin catálogo")
	}

	catalog := ""
	for i, svc := range BusinessCfg.Services {
		price := effectivePrice(svc)
		catalog += fmt.Sprintf("%d. %s ($%.0f)\n", i+1, svc.Title, price)
	}

	prompt := fmt.Sprintf(`Eres un sistema de detección de pedidos. Dado el siguiente catálogo y mensaje del cliente, identifica qué productos pidió y en qué cantidad.

CATÁLOGO:
%s

MENSAJE DEL CLIENTE: "%s"

REGLAS:
- Solo incluye productos que el cliente mencionó explícitamente
- Usa el nombre EXACTO del catálogo
- Si el cliente no pidió ningún producto del catálogo, devuelve un array vacío
- Tolera errores ortográficos (ej: "peperroni" = "pepperoni")
- Si no se especifica cantidad, asume 1

RESPONDE ÚNICAMENTE con un JSON válido, sin texto adicional:
[{"title": "Nombre exacto del producto", "quantity": 1, "price": 0.0}]

Si no hay productos: []`, catalog, message)

	ctx := context.Background()
	resp, err := geminiModel.GenerateContent(ctx, genai.Text(prompt))
	if err != nil {
		return nil, fmt.Errorf("error Gemini: %w", err)
	}

	if resp == nil || len(resp.Candidates) == 0 {
		return nil, fmt.Errorf("sin respuesta")
	}

	var responseText string
	for _, cand := range resp.Candidates {
		if cand.Content != nil {
			for _, part := range cand.Content.Parts {
				responseText += fmt.Sprintf("%v", part)
			}
		}
	}

	jsonStart := strings.Index(responseText, "[")
	jsonEnd := strings.LastIndex(responseText, "]")
	if jsonStart == -1 || jsonEnd == -1 {
		return nil, fmt.Errorf("JSON no encontrado en respuesta")
	}
	jsonStr := responseText[jsonStart : jsonEnd+1]

	type geminiItem struct {
		Title    string  `json:"title"`
		Quantity int     `json:"quantity"`
		Price    float64 `json:"price"`
	}

	var geminiItems []geminiItem
	if err := json.Unmarshal([]byte(jsonStr), &geminiItems); err != nil {
		return nil, fmt.Errorf("error parseando JSON: %w", err)
	}

	items := make([]OrderItem, 0, len(geminiItems))
	for _, gi := range geminiItems {
		if gi.Quantity <= 0 {
			gi.Quantity = 1
		}
		price := 0.0
		var matchedSvc *Service
		giNorm := normalizeStr(strings.TrimSpace(gi.Title))
		for i := range BusinessCfg.Services {
			svcNorm := normalizeStr(strings.TrimSpace(BusinessCfg.Services[i].Title))
			if svcNorm == giNorm {
				matchedSvc = &BusinessCfg.Services[i]
				price = effectivePrice(*matchedSvc)
				break
			}
		}
		if matchedSvc == nil {
			log.Printf("⚠️  [Cart] Producto no encontrado en catálogo: %s — omitiendo", gi.Title)
			continue
		}
		if !matchedSvc.InStock {
			log.Printf("⚠️  [Cart] Producto agotado ignorado: %s", gi.Title)
			continue
		}
		realTitle := matchedSvc.Title
		items = append(items, OrderItem{Title: realTitle, Quantity: gi.Quantity, Price: price})
		log.Printf("✅ [Cart] Gemini detectó: %dx %s ($%.0f)", gi.Quantity, realTitle, price)
	}

	return items, nil
}

func buildCartSummary(state *UserState) string {
	if len(state.Cart) == 0 {
		return "No hay productos en tu pedido."
	}
	var sb strings.Builder
	sb.WriteString("🛒 *Tu pedido:*\n")
	total := 0.0
	for _, item := range state.Cart {
		sb.WriteString(fmt.Sprintf("  • %dx %s — $%.0f\n", item.Quantity, item.Title, item.Price*float64(item.Quantity)))
		total += item.Price * float64(item.Quantity)
	}
	sb.WriteString(fmt.Sprintf("💰 Subtotal: $%.0f MXN", total))
	return sb.String()
}

// effectivePrice devuelve el precio a cobrar de un servicio,
// priorizando PromoPrice si está en promoción, con fallback a OriginalPrice.
func effectivePrice(svc Service) float64 {
	if svc.PriceType == "promotion" && svc.PromoPrice > 0 {
		return svc.PromoPrice
	}
	if svc.Price > 0 {
		return svc.Price
	}
	if svc.OriginalPrice > 0 {
		return svc.OriginalPrice
	}
	return 0
}

func buildMenuResponse() string {
	if BusinessCfg == nil || len(BusinessCfg.Services) == 0 {
		return "¿Qué te gustaría ordenar?"
	}
	var sb strings.Builder
	var lines []string
	for _, svc := range BusinessCfg.Services {
		if !svc.InStock {
			continue
		}
		price := effectivePrice(svc)
		if price == 0 {
			lines = append(lines, fmt.Sprintf("• *%s* — Gratis", svc.Title))
		} else if svc.PriceType == "promotion" && svc.OriginalPrice > 0 {
			lines = append(lines, fmt.Sprintf("• *%s* — ~$%.0f~ $%.0f MXN 🔥", svc.Title, svc.OriginalPrice, price))
		} else {
			lines = append(lines, fmt.Sprintf("• *%s* — $%.0f MXN", svc.Title, price))
		}
	}
	if len(lines) == 0 {
		return "Lo sentimos, no tenemos productos disponibles en este momento. 😔"
	}
	sb.WriteString("¿Qué deseas ordenar? 😋 Tenemos:\n\n")
	for _, line := range lines {
		sb.WriteString(line + "\n")
	}
	sb.WriteString("\n¿Cuánto quieres ordenar?")
	return sb.String()
}

func handleNormalConversation(message string, state *UserState) string {
	log.Println("💬 Gemini maneja la conversación")

	// Dar contexto según el tema detectado para mejorar la respuesta
	var promptContext string
	messageLower := strings.ToLower(message)

	if strings.Contains(messageLower, "servicio") || strings.Contains(messageLower, "precio") ||
		strings.Contains(messageLower, "cuanto cuesta") || strings.Contains(messageLower, "costo") ||
		strings.Contains(messageLower, "tienen") || strings.Contains(messageLower, "venden") ||
		strings.Contains(messageLower, "que ofrecen") || strings.Contains(messageLower, "que hay") {
		promptContext = "El cliente pregunta sobre productos, servicios o precios. Proporciona información detallada y clara del catálogo disponible."
	} else if strings.Contains(messageLower, "horario") || strings.Contains(messageLower, "abren") ||
		strings.Contains(messageLower, "cierran") || strings.Contains(messageLower, "atienden") {
		promptContext = "El cliente pregunta sobre horarios. Proporciona los horarios de atención claramente."
	} else if strings.Contains(messageLower, "donde") || strings.Contains(messageLower, "ubicacion") ||
		strings.Contains(messageLower, "direccion") || strings.Contains(messageLower, "como llegar") {
		promptContext = "El cliente pregunta sobre ubicación. Proporciona la dirección completa y referencias útiles."
	} else if strings.Contains(messageLower, "hola") || strings.Contains(messageLower, "buenos") ||
		strings.Contains(messageLower, "buenas") {
		return GenerateWelcomeMessage()
	} else {
		promptContext = "Responde de manera útil y natural según la información del negocio. Si el cliente no está siendo claro, pregúntale amablemente en qué le puedes ayudar."
	}

	response, err := Chat(promptContext, message, joinHistory(state.ConversationHistory))
	if err != nil {
		log.Printf("❌ Error en Gemini: %v", err)
		return "Disculpa, ¿podrías repetir tu pregunta?"
	}

	state.ConversationHistory = append(state.ConversationHistory, "Asistente: "+response)
	return response
}

// startAutoAppointmentFlow inicia el flujo de agendamiento de visita automotriz
func startAutoAppointmentFlow(state *UserState, message, userName string) string {
	log.Println("╔════════════════════════════════════════╗")
	log.Println("║  INICIANDO FLUJO AUTOMOTRIZ             ║")
	log.Println("╚════════════════════════════════════════╝")

	state.IsScheduling = true
	state.Step = 1
	state.Data["userName"] = userName
	state.Data["_mode"] = "automotriz"

	// Pre-detectar tipo de visita desde el mensaje inicial
	msgLower := strings.ToLower(message)
	if strings.Contains(msgLower, "prueba") || strings.Contains(msgLower, "test drive") {
		state.Data["servicio"] = "Prueba de manejo"
	} else if strings.Contains(msgLower, "mantenimiento") || strings.Contains(msgLower, "revisión") || strings.Contains(msgLower, "revision") {
		state.Data["servicio"] = "Servicio / Mantenimiento"
	}
	// "visita", "ver autos", etc. → NO pre-llenar → presentamos opciones abajo

	state.ConversationHistory = append(state.ConversationHistory, "Asistente: [inicio flujo automotriz]")
	return autoNextStep(state)
}

// autoNextStep avanza al siguiente paso del flujo automotriz de forma determinista,
// sin pasar por Gemini para recolectar datos — así el bot nunca hace preguntas confusas.
func autoNextStep(state *UserState) string {
	// Paso 1: nombre
	if state.Data["nombre"] == "" {
		return "¡Claro! 🚗 Para agendar tu visita, ¿cuál es tu nombre completo?"
	}

	// Paso 2: tipo de visita (menú claro si no fue detectado en el mensaje inicial)
	if state.Data["servicio"] == "" {
		return fmt.Sprintf("Hola *%s* 👋 ¿Qué tipo de visita deseas agendar?\n\n"+
			"1️⃣ Prueba de manejo\n"+
			"2️⃣ Servicio / Mantenimiento\n\n"+
			"Responde con el número o el nombre de la opción 😊",
			state.Data["nombre"])
	}

	// Paso 3: fecha Y hora juntas
	if state.Data["fecha"] == "" || state.Data["hora"] == "" {
		// Construir hint de horario completo desde BusinessCfg
		horarioHint := "ej: mañana a las 10 AM, lunes 25/06 a las 3 PM"
		if BusinessCfg != nil {
			type dayEntry struct {
				name string
				d    DaySchedule
			}
			allDays := []dayEntry{
				{"Lun", BusinessCfg.Schedule.Monday},
				{"Mar", BusinessCfg.Schedule.Tuesday},
				{"Mié", BusinessCfg.Schedule.Wednesday},
				{"Jue", BusinessCfg.Schedule.Thursday},
				{"Vie", BusinessCfg.Schedule.Friday},
				{"Sáb", BusinessCfg.Schedule.Saturday},
				{"Dom", BusinessCfg.Schedule.Sunday},
			}

			// Agrupar días consecutivos con el mismo horario
			type grupo struct {
				inicio, fin string
				start, end  string
			}
			var grupos []grupo
			for _, day := range allDays {
				if !day.d.Open || day.d.Start == "" || day.d.End == "" {
					continue
				}
				if len(grupos) > 0 {
					last := &grupos[len(grupos)-1]
					if last.start == day.d.Start && last.end == day.d.End {
						last.fin = day.name
						continue
					}
				}
				grupos = append(grupos, grupo{day.name, day.name, day.d.Start, day.d.End})
			}

			if len(grupos) > 0 {
				var sb strings.Builder
				for _, g := range grupos {
					if g.inicio == g.fin {
						sb.WriteString(fmt.Sprintf("%s: %s–%s  ", g.inicio, g.start, g.end))
					} else {
						sb.WriteString(fmt.Sprintf("%s a %s: %s–%s  ", g.inicio, g.fin, g.start, g.end))
					}
				}
				horarioHint = strings.TrimSpace(sb.String())
			}
		}
		return fmt.Sprintf("📅 ¿Cuándo te gustaría visitarnos?\n\n🕐 *Horario:* %s\n\n_ej: mañana a las 10 AM_", horarioHint)
	}

	// Paso 5: asesor (solo si hay más de uno)
	if BusinessCfg != nil && len(BusinessCfg.Workers) > 1 && state.Data["barbero"] == "" {
		var asesores strings.Builder
		for i, w := range BusinessCfg.Workers {
			asesores.WriteString(fmt.Sprintf("%d️⃣ %s\n", i+1, w.Name))
		}
		return fmt.Sprintf("👤 ¿Con qué asesor prefieres tu cita?\n\n%s\nResponde con el número o escribe *cualquiera* si no tienes preferencia.",
			asesores.String())
	}

	// Todos los datos completos → resumen + email
	return askForEmailReminder(state)
}

// continueAutoAppointmentFlow procesa la respuesta del cliente en cada paso del flujo automotriz
func continueAutoAppointmentFlow(state *UserState, message, userID string) string {
	log.Println("🚗 CONTINUANDO FLUJO AUTOMOTRIZ")
	// Asegurar que userID esté siempre guardado en state.Data
	if userID != "" {
		state.Data["userID"] = userID
	}
	msgLower := strings.ToLower(strings.TrimSpace(message))

	// Paso 1: capturar nombre
	if state.Data["nombre"] == "" {
		state.Data["nombre"] = strings.TrimSpace(message)
		log.Printf("   ✅ nombre: %s", state.Data["nombre"])
		return autoNextStep(state)
	}

	// Paso 2: capturar tipo de visita
	if state.Data["servicio"] == "" {
		switch {
		case msgLower == "1" || strings.Contains(msgLower, "prueba") || strings.Contains(msgLower, "test"):
			state.Data["servicio"] = "Prueba de manejo"
		case msgLower == "2" || strings.Contains(msgLower, "mantenimiento") || strings.Contains(msgLower, "servicio") || strings.Contains(msgLower, "revisión"):
			state.Data["servicio"] = "Servicio / Mantenimiento"
		default:
			return "Por favor elige una opción:\n\n1️⃣ Prueba de manejo\n2️⃣ Servicio / Mantenimiento"
		}
		log.Printf("   ✅ servicio: %s", state.Data["servicio"])
		return autoNextStep(state)
	}

	// Paso 3: capturar fecha + hora del mismo mensaje
	if state.Data["fecha"] == "" || state.Data["hora"] == "" {
		// Regex que captura hora solo cuando va precedida de "a las", "las", "a las", espacio o inicio
		// y seguida de AM/PM o formato HH:MM — evita capturar números en palabras como "Mañana"
		horaRegex := regexp.MustCompile(`(?i)(?:a\s+las\s+|las\s+|@\s*)(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)`)
		horaMatch := horaRegex.FindStringSubmatch(message)

		// Fallback: número suelto con AM/PM sin prefijo "a las"
		if horaMatch == nil {
			horaRegex = regexp.MustCompile(`(?i)(?:^|\s)(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)`)
			horaMatch = horaRegex.FindStringSubmatch(message)
		}

		hora := ""
		if len(horaMatch) >= 4 {
			h := horaMatch[1]
			m := "00"
			if horaMatch[2] != "" {
				m = horaMatch[2]
			}
			ampm := strings.ToLower(horaMatch[3])
			if ampm == "pm" || ampm == "p.m." {
				hora = h + ":" + m + " PM"
			} else {
				hora = h + ":" + m + " AM"
			}
		}

		// Validar que la hora esté dentro del horario del negocio
		if hora != "" && BusinessCfg != nil {
			hNum, _, _ := ConvertirHoraA24h(hora)
			openH, closeH := 9, 20
			days := []DaySchedule{
				BusinessCfg.Schedule.Monday, BusinessCfg.Schedule.Tuesday,
				BusinessCfg.Schedule.Wednesday, BusinessCfg.Schedule.Thursday,
				BusinessCfg.Schedule.Friday, BusinessCfg.Schedule.Saturday,
			}
			for _, d := range days {
				if d.Open && d.Start != "" && d.End != "" {
					fmt.Sscanf(d.Start, "%d:", &openH)
					fmt.Sscanf(d.End, "%d:", &closeH)
					break
				}
			}
			if hNum < openH || hNum >= closeH {
				return fmt.Sprintf("⚠️ Ese horario está fuera de nuestra atención.\n\nAtendemos de *%d:00* a *%d:00*. ¿A qué hora prefieres?", openH, closeH)
			}
		}

		// Extraer fecha: remover solo la parte de hora del mensaje (no todo el regex)
		fecha := horaRegex.ReplaceAllString(message, "")
		// Limpiar conectores que puedan quedar al final
		fecha = regexp.MustCompile(`(?i)\s*(a\s+las?|las?|@)\s*$`).ReplaceAllString(fecha, "")
		fecha = strings.TrimSpace(fecha)
		if fecha == "" {
			fecha = message
		}

		if hora == "" {
			// Solo vino fecha, pedir hora
			state.Data["fecha"] = strings.TrimSpace(message)
			return fmt.Sprintf("📅 Fecha: *%s* ✅\n\n🕐 ¿A qué hora te queda mejor?", state.Data["fecha"])
		}

		state.Data["fecha"] = strings.TrimSpace(fecha)
		state.Data["hora"] = hora
		log.Printf("   ✅ fecha: %s | hora: %s", state.Data["fecha"], state.Data["hora"])
		return autoNextStep(state)
	}

	// Paso 5: capturar asesor (si aplica)
	if BusinessCfg != nil && len(BusinessCfg.Workers) > 1 && state.Data["barbero"] == "" {
		if msgLower == "cualquiera" || strings.Contains(msgLower, "cualquier") || strings.Contains(msgLower, "no importa") {
			state.Data["barbero"] = "Cualquier asesor disponible"
		} else {
			// Intentar match por número o nombre
			for i, w := range BusinessCfg.Workers {
				if msgLower == fmt.Sprintf("%d", i+1) || strings.Contains(msgLower, strings.ToLower(w.Name)) {
					state.Data["barbero"] = w.Name
					break
				}
			}
			if state.Data["barbero"] == "" {
				state.Data["barbero"] = strings.TrimSpace(message)
			}
		}
		log.Printf("   ✅ asesor: %s", state.Data["barbero"])
		return autoNextStep(state)
	}

	// Si llegamos aquí ya estamos en el paso de email/confirmación
	return autoNextStep(state)
}

func getMissingData(data map[string]string) []string {
	required := []string{"nombre", "servicio", "fecha", "hora"}
	var missing []string

	if BusinessCfg != nil && len(BusinessCfg.Workers) > 1 {
		required = append(required, "barbero")
	}

	for _, field := range required {
		if data[field] == "" {
			missing = append(missing, field)
		}
	}

	return missing
}

func joinHistory(history []string) string {
	result := ""
	maxHistory := 10
	startIdx := 0
	if len(history) > maxHistory {
		startIdx = len(history) - maxHistory
	}

	for i := startIdx; i < len(history); i++ {
		result += history[i] + "\n"
	}
	return result
}

// cleanPhoneNumber limpia el número de teléfono de WhatsApp Web
func cleanPhoneNumber(userID string) string {
	log.Printf("🔍 Limpiando número: %s", userID)

	parts := strings.Split(userID, "@")
	phoneNumber := parts[0]
	log.Printf("   Después de split: %s", phoneNumber)

	cleaned := ""
	for _, char := range phoneNumber {
		if char >= '0' && char <= '9' {
			cleaned += string(char)
		}
	}
	log.Printf("   Solo dígitos: %s (len=%d)", cleaned, len(cleaned))

	if len(cleaned) < 10 {
		log.Printf("⚠️  Número muy corto, retornando tal cual: %s", cleaned)
		return cleaned
	}

	if len(cleaned) == 13 && strings.HasPrefix(cleaned, "521") {
		fixed := "52" + cleaned[3:]
		log.Printf("✅ Corregido 521→52 (13 dígitos): %s → %s", cleaned, fixed)
		return fixed
	}

	if len(cleaned) == 12 && strings.HasPrefix(cleaned, "52") {
		log.Printf("✅ Número correcto (12 dígitos): %s", cleaned)
		return cleaned
	}

	if len(cleaned) == 10 {
		fixed := "52" + cleaned
		log.Printf("✅ Agregado prefijo 52 (10 dígitos): %s → %s", cleaned, fixed)
		return fixed
	}

	local := cleaned[len(cleaned)-10:]
	fixed := "52" + local
	log.Printf("⚠️  Longitud inusual (%d dígitos), tomando últimos 10: %s → %s", len(cleaned), cleaned, fixed)
	return fixed
}

// cleanBoldSpaces elimina espacios internos en negritas WhatsApp (*texto*)
func cleanBoldSpaces(s string) string {
	lines := strings.Split(s, "\n")
	for i, line := range lines {
		for strings.Contains(line, " *") {
			prev := line
			line = strings.ReplaceAll(line, " *\n", "*\n")
			line = strings.ReplaceAll(line, " * ", "* ")
			line = strings.ReplaceAll(line, " *—", "*—")
			line = strings.ReplaceAll(line, " *$", "*")
			if line == prev {
				break
			}
		}
		lines[i] = line
	}
	return strings.Join(lines, "\n")
}

// normalizeStr convierte a minúsculas y elimina acentos para comparación fuzzy
func normalizeStr(s string) string {
	s = strings.ToLower(s)
	replacer := strings.NewReplacer(
		"á", "a", "é", "e", "í", "i", "ó", "o", "ú", "u",
		"à", "a", "è", "e", "ì", "i", "ò", "o", "ù", "u",
		"ä", "a", "ë", "e", "ï", "i", "ö", "o", "ü", "u",
		"ñ", "n",
	)
	return replacer.Replace(s)
}

// ============================================
// MODO GUBERNAMENTAL — FLUJO DE INSCRIPCIÓN
// ============================================

// CitizenState estado del flujo de inscripción de un ciudadano
type CitizenState struct {
	IsRegistering       bool
	Step                int
	Data                map[string]string
	ConversationHistory []string
	LastMessageTime     int64
}

var citizenStates = make(map[string]*CitizenState)

func GetCitizenState(userID string) *CitizenState {
	stateMutex.Lock()
	defer stateMutex.Unlock()
	if s, ok := citizenStates[userID]; ok {
		return s
	}
	s := &CitizenState{Data: make(map[string]string), LastMessageTime: time.Now().Unix()}
	citizenStates[userID] = s
	return s
}

func ClearCitizenState(userID string) {
	stateMutex.Lock()
	defer stateMutex.Unlock()
	delete(citizenStates, userID)
}

// HandleAgencyMessage es el handler de WhatsApp para modo gubernamental.
func HandleAgencyMessage(msg *events.Message, client *whatsmeow.Client) {
	if msg.Info.IsFromMe || msg.Info.IsGroup {
		return
	}
	if isDuplicateMessage(msg.Info.ID) {
		return
	}

	phone := msg.Info.Chat.User
	name := msg.Info.PushName
	if name == "" {
		name = "Ciudadano"
	}

	var text string
	if msg.Message.GetConversation() != "" {
		text = msg.Message.GetConversation()
	} else if msg.Message.GetExtendedTextMessage() != nil {
		text = msg.Message.GetExtendedTextMessage().GetText()
	}
	if text == "" {
		return
	}

	log.Printf("🏛️  [AGENCIA] %s: %s", name, text)

	state := GetCitizenState(phone)
	var response string

	// Confirmación final de inscripción
	if state.IsRegistering && state.Step == 10 {
		response = handleAgencyConfirmation(state, text, phone)
	} else {
		response = ProcessAgencyMessage(text, phone, name)
	}

	response = strings.ReplaceAll(response, "**", "*")
	if response != "" {
		if err := SendMessage(msg.Info.Chat, response); err != nil {
			log.Printf("❌ [Agency] Error enviando: %v", err)
		}
	}
}

// ProcessAgencyMessage procesa un mensaje en modo gubernamental.
func ProcessAgencyMessage(message, userID, userName string) string {
	state := GetCitizenState(userID)
	state.LastMessageTime = time.Now().Unix()
	state.ConversationHistory = append(state.ConversationHistory, "Ciudadano: "+message)
	if len(state.ConversationHistory) > 20 {
		state.ConversationHistory = state.ConversationHistory[10:]
	}
	msgLower := strings.ToLower(strings.TrimSpace(message))

	// Cancelar
	if msgLower == "cancelar" || msgLower == "salir" || msgLower == "reset" {
		ClearCitizenState(userID)
		return "Entendido, proceso cancelado. ¿En qué más puedo ayudarte?"
	}

	// Flujo activo
	if state.IsRegistering {
		return continueAgencyRegistration(state, message, userID, userName)
	}

	// Intención de inscripción
	if agencyWantsRegister(msgLower) {
		return startAgencyRegistration(state, message)
	}

	// Consulta de cupos
	if agencyAsksCupos(msgLower) {
		return buildAgencyCuposMsg()
	}

	// Curso específico mencionado
	if c := FindCourse(message); c != nil && len(message) > 4 {
		return buildAgencyCourseDetail(c)
	}

	// Saludo → bienvenida
	if strings.Contains(msgLower, "hola") || strings.Contains(msgLower, "buenos") {
		return buildAgencyWelcome(userName)
	}

	// Gemini con contexto gubernamental
	history := joinHistory(state.ConversationHistory)
	resp, err := Chat(GetAgencySystemPrompt(), message, history)
	if err != nil || resp == "" {
		resp = buildAgencyWelcome(userName)
	}
	state.ConversationHistory = append(state.ConversationHistory, "Asistente: "+resp)
	return resp
}

// ── Detección de intenciones ───────────────────────────────────────────────

func agencyWantsRegister(msg string) bool {
	for _, k := range []string{"inscrib", "registrar", "registro", "quiero el curso",
		"quiero tomar", "participar", "anotarme", "apuntar", "como me inscribo"} {
		if strings.Contains(msg, k) {
			return true
		}
	}
	return false
}

func agencyAsksCupos(msg string) bool {
	for _, k := range []string{"cupo", "lugar", "disponible", "hay espacio", "quedan", "lleno"} {
		if strings.Contains(msg, k) {
			return true
		}
	}
	return false
}

// ── Flujo de inscripción ───────────────────────────────────────────────────

func startAgencyRegistration(state *CitizenState, message string) string {
	state.IsRegistering = true
	state.Step = 0
	state.Data = make(map[string]string)

	// Detectar curso en el mensaje inicial
	if c := FindCourse(message); c != nil {
		if !c.Disponible {
			state.IsRegistering = false
			return fmt.Sprintf("❌ El curso *%s* no tiene cupos disponibles.\n\n%s", c.Title, buildAgencyCuposMsg())
		}
		state.Data["curso"] = c.Title
		if c.Sede != "" {
			state.Data["sede"] = c.Sede
		}
		return fmt.Sprintf("📚 *Curso:* %s\n\n¿Cuál es tu nombre completo?", c.Title)
	}
	return buildAgencyCourseListMsg()
}

func continueAgencyRegistration(state *CitizenState, message, userID, _ string) string {
	msgLower := strings.ToLower(strings.TrimSpace(message))

	// Paso 0: selección de curso
	if state.Data["curso"] == "" {
		available := GetAgencyCourseAvailable()
		for i, c := range available {
			if msgLower == fmt.Sprintf("%d", i+1) || strings.Contains(normalizeStr(message), normalizeStr(c.Title)) {
				if !c.Disponible {
					return fmt.Sprintf("❌ *%s* sin cupos.\n\n%s", c.Title, buildAgencyCourseListMsg())
				}
				state.Data["curso"] = c.Title
				if c.Sede != "" {
					state.Data["sede"] = c.Sede
				}
				return fmt.Sprintf("📚 *Curso:* %s\n\n¿Cuál es tu nombre completo?", c.Title)
			}
		}
		return "No encontré ese curso.\n\n" + buildAgencyCourseListMsg()
	}

	// Paso 1: nombre
	if state.Data["nombre"] == "" {
		if len(strings.TrimSpace(message)) < 2 {
			return "Por favor ingresa tu nombre completo."
		}
		state.Data["nombre"] = strings.TrimSpace(message)
		// Teléfono automático del WhatsApp
		state.Data["telefono"] = cleanPhoneNumber(userID)
		return "📧 ¿Cuál es tu correo electrónico? (escribe *sin correo* si no tienes)"
	}

	// Paso 2: email
	if state.Data["email"] == "" {
		if strings.Contains(msgLower, "sin correo") || strings.Contains(msgLower, "no tengo") || msgLower == "no" {
			state.Data["email"] = ""
		} else if strings.Contains(message, "@") {
			state.Data["email"] = strings.TrimSpace(message)
		} else {
			return "Por favor escribe tu email o responde *sin correo*."
		}

		// Sede si hay más de una
		if len(AgencyCfg.Sedes) > 1 && state.Data["sede"] == "" {
			return buildAgencySedeMsg()
		}
		state.Step = 10
		return buildAgencyRegistrationSummary(state) + "\n\n¿Confirmas tu inscripción? Responde *sí* o *no*."
	}

	// Paso 3: sede
	if state.Data["sede"] == "" && len(AgencyCfg.Sedes) > 1 {
		for i, s := range AgencyCfg.Sedes {
			if msgLower == fmt.Sprintf("%d", i+1) || strings.Contains(normalizeStr(message), normalizeStr(s.Nombre)) {
				state.Data["sede"] = s.Nombre
				state.Step = 10
				return buildAgencyRegistrationSummary(state) + "\n\n¿Confirmas tu inscripción? Responde *sí* o *no*."
			}
		}
		return "Por favor elige una sede:\n\n" + buildAgencySedeMsg()
	}

	// Confirmación
	state.Step = 10
	return buildAgencyRegistrationSummary(state) + "\n\n¿Confirmas tu inscripción? Responde *sí* o *no*."
}

func handleAgencyConfirmation(state *CitizenState, message, userID string) string {
	msgLower := strings.ToLower(strings.TrimSpace(message))
	yesWords := []string{"si", "sí", "yes", "claro", "confirmo", "ok", "dale", "adelante"}
	for _, w := range yesWords {
		if strings.Contains(msgLower, w) {
			return saveAgencyRegistration(state, userID)
		}
	}
	noWords := []string{"no", "cancelar", "nop"}
	for _, w := range noWords {
		if msgLower == w {
			ClearCitizenState(userID)
			return "Inscripción cancelada. ¿Puedo ayudarte en algo más?"
		}
	}
	return "Por favor responde *sí* para confirmar o *no* para cancelar."
}

func saveAgencyRegistration(state *CitizenState, userID string) string {
	ins := &InscripcionData{
		Nombre:    state.Data["nombre"],
		Telefono:  state.Data["telefono"],
		Email:     state.Data["email"],
		Curso:     state.Data["curso"],
		Sede:      agencySedeOrDefault(state.Data["sede"]),
		Modalidad: agencyGetCourseModalidad(state.Data["curso"]),
		Fecha:     time.Now().Format("02/01/2006 15:04"),
		Estado:    "confirmado",
	}

	if IsSheetsEnabled() {
		if err := SaveInscripcionToSheets(ins); err != nil {
			log.Printf("⚠️  [Agency] Sheets: %v", err)
		}
	}
	go SaveInscriptionToBackend(ins, userID)

	cuposMsg := ""
	if c := FindCourse(ins.Curso); c != nil && c.Cupos != "" && c.Cupos != "0" {
		cuposMsg = fmt.Sprintf("\n📊 Cupos restantes: *%s*", c.Cupos)
	}

	ClearCitizenState(userID)
	return fmt.Sprintf("✅ *¡Inscripción confirmada!*\n\n👤 *Nombre:* %s\n📚 *Curso:* %s\n📍 *Sede:* %s\n📅 *Registrado:* %s%s\n\nRecibirás más información próximamente. ¿Tienes alguna otra pregunta?",
		ins.Nombre, ins.Curso, ins.Sede, ins.Fecha, cuposMsg)
}

// ── Mensajes de respuesta ──────────────────────────────────────────────────

func buildAgencyWelcome(userName string) string {
	dep := ""
	if AgencyCfg != nil {
		dep = AgencyCfg.DepAcronym
	}
	if dep == "" {
		dep = "la dependencia"
	}
	return fmt.Sprintf("Hola, bienvenido/a a *%s* 🏛️\n\nPuedo ayudarte con:\n• 📚 Ver cursos disponibles\n• ✏️ Inscribirte a un curso\n• 📅 Horarios de atención\n• 📍 Ubicación y sedes\n\n¿En qué te puedo ayudar?", dep)
}

func buildAgencyCuposMsg() string {
	if AgencyCfg == nil || len(AgencyCfg.Cursos) == 0 {
		return "No hay cursos configurados."
	}
	var sb strings.Builder
	sb.WriteString("📚 *Disponibilidad de cursos:*\n\n")
	for _, c := range AgencyCfg.Cursos {
		if c.Disponible {
			cupos := ""
			if c.Cupos != "" && c.Cupos != "0" {
				cupos = fmt.Sprintf(" (%s lugares)", c.Cupos)
			}
			sb.WriteString(fmt.Sprintf("✅ *%s*%s\n", c.Title, cupos))
		} else {
			sb.WriteString(fmt.Sprintf("❌ *%s* — Sin cupos\n", c.Title))
		}
	}
	sb.WriteString("\nEscribe *inscribirme* para registrarte.")
	return sb.String()
}

func buildAgencyCourseDetail(c *AgencyCourse) string {
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("📚 *%s*\n\n", c.Title))
	if c.Description != "" {
		desc := strings.ReplaceAll(c.Description, "<br>", " ")
		desc = strings.ReplaceAll(desc, "</p>", " ")
		desc = strings.ReplaceAll(desc, "<p>", "")
		sb.WriteString(strings.TrimSpace(desc) + "\n\n")
	}
	modMap := map[string]string{"presencial": "Presencial 🏫", "en-linea": "En línea 💻", "hibrido": "Híbrido 🔀"}
	mod := modMap[c.Modalidad]
	if mod == "" {
		mod = c.Modalidad
	}
	sb.WriteString(fmt.Sprintf("📍 *Modalidad:* %s\n", mod))
	if c.Sede != "" {
		sb.WriteString(fmt.Sprintf("🏢 *Sede:* %s\n", c.Sede))
	}
	if c.FechaInicio != "" {
		sb.WriteString(fmt.Sprintf("📅 *Periodo:* %s → %s\n", c.FechaInicio, c.FechaFin))
	}
	if c.Disponible {
		label := "Disponible"
		if c.Cupos != "" && c.Cupos != "0" {
			label = c.Cupos + " lugares"
		}
		sb.WriteString(fmt.Sprintf("✅ *Cupos:* %s\n\n", label))
		sb.WriteString("¿Te gustaría inscribirte? Responde *inscribirme* o *sí*.")
	} else {
		sb.WriteString("❌ *Sin cupos disponibles* en este momento.")
	}
	return sb.String()
}

func buildAgencyCourseListMsg() string {
	available := GetAgencyCourseAvailable()
	if len(available) == 0 {
		return "❌ No hay cursos disponibles en este momento."
	}
	var sb strings.Builder
	sb.WriteString("📚 *Cursos disponibles:*\n\n")
	for i, c := range available {
		cupos := ""
		if c.Cupos != "" && c.Cupos != "0" {
			cupos = fmt.Sprintf(" — %s cupos", c.Cupos)
		}
		sb.WriteString(fmt.Sprintf("%d️⃣ *%s*%s\n", i+1, c.Title, cupos))
	}
	sb.WriteString("\nElige un número o escribe el nombre del curso:")
	return sb.String()
}

func buildAgencySedeMsg() string {
	if AgencyCfg == nil {
		return ""
	}
	var sb strings.Builder
	sb.WriteString("📍 *¿En qué sede deseas tomar el curso?*\n\n")
	for i, s := range AgencyCfg.Sedes {
		sb.WriteString(fmt.Sprintf("%d️⃣ *%s*\n   %s\n", i+1, s.Nombre, s.Direccion))
	}
	return sb.String()
}

func buildAgencyRegistrationSummary(state *CitizenState) string {
	email := state.Data["email"]
	if email == "" {
		email = "No proporcionado"
	}
	return fmt.Sprintf("📋 *Resumen de inscripción:*\n\n👤 *Nombre:* %s\n📱 *WhatsApp:* %s\n📧 *Email:* %s\n📚 *Curso:* %s\n📍 *Sede:* %s",
		state.Data["nombre"], state.Data["telefono"], email,
		state.Data["curso"], agencySedeOrDefault(state.Data["sede"]))
}

func agencySedeOrDefault(sede string) string {
	if sede != "" {
		return sede
	}
	if AgencyCfg != nil && AgencyCfg.Address != "" {
		return AgencyCfg.Address
	}
	return "Oficinas principales"
}

func agencyGetCourseModalidad(courseTitle string) string {
	if c := FindCourse(courseTitle); c != nil {
		return c.Modalidad
	}
	return "presencial"
}
