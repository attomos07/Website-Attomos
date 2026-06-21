package src

// app.go — núcleo de lógica de negocio.
// Idéntico al de WhatsApp excepto:
//   - Sin imports de whatsmeow (la capa de transporte está en telegram.go)
//   - HandleMessage y HandleAgencyMessage se remueven (están en telegram.go)
//   - Todo lo demás (estados, Gemini, citas, pedidos, modo gubernamental) es igual.

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

	processedMsgs   = make(map[string]int64)
	processedMsgsMu sync.Mutex
)

func isDuplicateMessage(msgID string) bool {
	processedMsgsMu.Lock()
	defer processedMsgsMu.Unlock()

	now := time.Now().Unix()
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

// ProcessMessage procesa un mensaje y genera respuesta usando Gemini.
// Llamado tanto por WhatsApp como por Telegram — sin dependencias de transporte.
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
			break
		}
	}

	// Email reminder flow
	if state.IsAskingForEmail {
		return processEmailReminderResponse(state, message, userID)
	}

	// Flujo de pedido (comida)
	if isPizzeriaMode() {
		if state.IsOrdering {
			return continueOrderFlow(state, message, userID, userName)
		}
		orderKeywords := []string{
			"quiero", "dame", "me das", "pedido", "ordenar", "pedir",
			"quiero pedir", "quiero ordenar", "me pones", "ponme",
			"una pizza", "dos pizzas", "una gordita", "dos gorditas",
			"para llevar", "a domicilio", "para comer",
		}
		for _, kw := range orderKeywords {
			if strings.Contains(messageLower, kw) {
				return startOrderFlow(state, message, userName)
			}
		}
	}

	// Flujo automotriz
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
		for _, kw := range autoKeywords {
			if strings.Contains(messageLower, kw) && !state.IsScheduling {
				return startAutoAppointmentFlow(state, message, userName)
			}
		}
	}

	// Cancelación de cita
	if wantsToCancelAppointment && !state.IsCancelling {
		return startCancellationFlow(state, message, userName)
	}
	if state.IsCancelling {
		return continueCancellationFlow(state, message, userID, userName)
	}

	// Análisis con Gemini
	analysis, err := AnalyzeForAppointment(message, joinHistory(state.ConversationHistory), state.IsScheduling)
	if err != nil {
		log.Printf("⚠️  Error en análisis: %v", err)
		return handleNormalConversation(message, state)
	}

	if analysis.WantsToSchedule && !state.IsScheduling {
		return startAppointmentFlow(state, analysis, message)
	}
	if state.IsScheduling {
		if state.Data["_mode"] == "automotriz" {
			return continueAutoAppointmentFlow(state, message, userID)
		}
		return continueAppointmentFlow(state, analysis, message, userID)
	}

	result := handleNormalConversation(message, state)
	log.Printf("⏱️  [Total] Mensaje procesado en: %dms", time.Since(t0Total).Milliseconds())
	return result
}

// ── Cancelación ───────────────────────────────────────────────────────────────

func startCancellationFlow(state *UserState, message, userName string) string {
	state.IsCancelling = true
	state.Step = 1

	dateRegex := regexp.MustCompile(`(\d{1,2})/(\d{1,2})/(\d{4})`)
	timeRegex := regexp.MustCompile(`(\d{1,2}):(\d{2})`)

	dateMatch := dateRegex.FindStringSubmatch(message)
	timeMatch := timeRegex.FindStringSubmatch(message)

	if len(dateMatch) >= 4 && len(timeMatch) >= 3 {
		state.Data["fecha_cancelar"] = fmt.Sprintf("%s/%s/%s", dateMatch[1], dateMatch[2], dateMatch[3])
		state.Data["hora_cancelar"] = fmt.Sprintf("%s:%s", timeMatch[1], timeMatch[2])
		return processCancellation(state, userName)
	}

	response := fmt.Sprintf(`Para cancelar tu cita, %s, necesito los siguientes datos:

📅 <b>Fecha de tu cita:</b> DD/MM/YYYY
🕐 <b>Hora de tu cita:</b> HH:MM

Ejemplo: "Cancelar cita 15/01/2026 10:30"`, userName)

	state.ConversationHistory = append(state.ConversationHistory, "Asistente: "+response)
	return response
}

func continueCancellationFlow(state *UserState, message, _ string, userName string) string {
	dateRegex := regexp.MustCompile(`(\d{1,2})/(\d{1,2})/(\d{4})`)
	timeRegex := regexp.MustCompile(`(\d{1,2}):(\d{2})`)

	dateMatch := dateRegex.FindStringSubmatch(message)
	timeMatch := timeRegex.FindStringSubmatch(message)

	if len(dateMatch) >= 4 {
		state.Data["fecha_cancelar"] = fmt.Sprintf("%s/%s/%s", dateMatch[1], dateMatch[2], dateMatch[3])
	}
	if len(timeMatch) >= 3 {
		state.Data["hora_cancelar"] = fmt.Sprintf("%s:%s", timeMatch[1], timeMatch[2])
	}

	if state.Data["fecha_cancelar"] != "" && state.Data["hora_cancelar"] != "" {
		return processCancellation(state, userName)
	}
	if state.Data["fecha_cancelar"] == "" {
		return "Por favor, indícame la <b>fecha</b> de tu cita (DD/MM/YYYY):"
	}
	return "Por favor, indícame la <b>hora</b> de tu cita (HH:MM):"
}

func processCancellation(state *UserState, userName string) string {
	fecha := state.Data["fecha_cancelar"]
	hora := state.Data["hora_cancelar"]

	fechaHoraStr := fmt.Sprintf("%s %s", fecha, hora)
	appointmentDateTime, err := time.Parse("02/01/2006 15:04", fechaHoraStr)
	if err != nil {
		state.IsCancelling = false
		return "❌ Formato de fecha/hora inválido. Por favor usa el formato: DD/MM/YYYY HH:MM"
	}

	telefono := state.Data["telefono"]

	if IsSheetsEnabled() {
		if err := CancelAppointmentByClient(userName, telefono, appointmentDateTime); err != nil {
			log.Printf("❌ Error cancelando en Sheets: %v", err)
			state.IsCancelling = false
			return fmt.Sprintf(`❌ No encontré una cita agendada para:

📅 <b>Fecha:</b> %s
🕐 <b>Hora:</b> %s

Por favor verifica los datos y vuelve a intentar.`,
				appointmentDateTime.Format("02/01/2006"),
				appointmentDateTime.Format("15:04"))
		}
	}

	state.IsCancelling = false
	state.Data = make(map[string]string)

	return fmt.Sprintf(`✅ <b>Cita cancelada exitosamente</b>

👤 <b>Cliente:</b> %s
📅 <b>Fecha:</b> %s
🕐 <b>Hora:</b> %s

Tu cita ha sido cancelada. Si deseas reagendar, házmelo saber.

¿Puedo ayudarte en algo más?`,
		userName,
		appointmentDateTime.Format("02/01/2006"),
		appointmentDateTime.Format("15:04"))
}

// ── Agendamiento ──────────────────────────────────────────────────────────────

func startAppointmentFlow(state *UserState, analysis *AppointmentAnalysis, message string) string {
	state.IsScheduling = true
	state.Step = 1

	if analysis.ExtractedData != nil {
		for key, value := range analysis.ExtractedData {
			if value != "" && value != "null" {
				state.Data[key] = value
			}
		}
	}

	missingData := getMissingData(state.Data)

	var promptContext string
	if len(missingData) > 0 {
		promptContext = fmt.Sprintf("El cliente quiere agendar una cita. Ya tenemos: %v. Pide SOLO el siguiente dato: %s. NO pidas teléfono. Sé breve (1-2 líneas).",
			state.Data, missingData[0])
	} else {
		promptContext = "Confirma todos los datos antes de guardar: " + fmt.Sprintf("%v", state.Data)
	}

	response, err := Chat(promptContext, message, joinHistory(state.ConversationHistory))
	if err != nil {
		return "¡Perfecto! Vamos a agendar tu cita. ¿Cuál es tu nombre completo?"
	}
	state.ConversationHistory = append(state.ConversationHistory, "Asistente: "+response)
	return response
}

func continueAppointmentFlow(state *UserState, analysis *AppointmentAnalysis, message, userID string) string {
	state.Data["userID"] = userID

	if analysis.ExtractedData != nil {
		for key, value := range analysis.ExtractedData {
			if value != "" && value != "null" {
				state.Data[key] = value
			}
		}
	}

	missingData := getMissingData(state.Data)

	if len(missingData) > 0 {
		promptContext := fmt.Sprintf(
			"Estamos agendando una cita. Datos ya recopilados: %v. Pide ÚNICAMENTE: %s. NO repitas preguntas. NO pidas teléfono. 1-2 líneas máximo.",
			state.Data, missingData[0])
		response, err := Chat(promptContext, message, joinHistory(state.ConversationHistory))
		if err != nil {
			return fmt.Sprintf("Por favor, dime tu %s:", missingData[0])
		}
		state.ConversationHistory = append(state.ConversationHistory, "Asistente: "+response)
		return response
	}

	return askForEmailReminder(state)
}

func askForEmailReminder(state *UserState) string {
	state.IsAskingForEmail = true
	state.Data["email_step"] = "asking"

	servicioIcon := "✂️"
	workerLabel := "💈 <b>Con:</b>"
	if state.Data["_mode"] == "automotriz" {
		servicioIcon = "🚗"
		workerLabel = "👤 <b>Asesor:</b>"
	}

	response := fmt.Sprintf(`📋 <b>Resumen de tu cita:</b>

👤 <b>Nombre:</b> %s
%s <b>Servicio:</b> %s
📅 <b>Fecha:</b> %s
🕐 <b>Hora:</b> %s`,
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

Responde <b>sí</b> para agregar tu email, o <b>no</b> para continuar sin recordatorio.`

	return response
}

func processEmailReminderResponse(state *UserState, message, _ string) string {
	userID := state.Data["userID"]
	msgLower := strings.ToLower(strings.TrimSpace(message))
	emailStep := state.Data["email_step"]

	if emailStep == "asking" {
		for _, kw := range []string{"si", "sí", "yes", "claro", "ok", "dale", "va", "quiero", "porfa", "por favor", "ándale", "andale"} {
			if strings.Contains(msgLower, kw) {
				state.Data["email_step"] = "waiting_email"
				return "¡Perfecto! 📧 Por favor escribe tu correo electrónico:"
			}
		}
		for _, kw := range []string{"no", "nel", "nope", "sin recordatorio", "no gracias", "no quiero"} {
			if strings.Contains(msgLower, kw) {
				state.IsAskingForEmail = false
				delete(state.Data, "email_step")
				return saveAppointment(state, userID)
			}
		}
		return "No entendí tu respuesta 😅\n\n¿Quieres recibir un recordatorio por correo electrónico?\nResponde <b>sí</b> o <b>no</b>."
	}

	if emailStep == "waiting_email" {
		email := strings.TrimSpace(message)
		if isValidEmail(email) {
			state.Data["email"] = email
			state.IsAskingForEmail = false
			delete(state.Data, "email_step")
			return saveAppointment(state, userID)
		}
		return "Ese correo no parece válido 🤔\n\nPor favor escribe un correo electrónico válido (ejemplo: nombre@gmail.com):"
	}

	state.IsAskingForEmail = false
	delete(state.Data, "email_step")
	return saveAppointment(state, userID)
}

func isValidEmail(email string) bool {
	atIdx := strings.Index(email, "@")
	if atIdx < 1 {
		return false
	}
	domain := email[atIdx+1:]
	dotIdx := strings.LastIndex(domain, ".")
	return dotIdx >= 1 && dotIdx != len(domain)-1
}

func saveAppointment(state *UserState, userID string) string {
	log.Println("🎯 GUARDANDO CITA")

	telefono := cleanPhoneNumber(userID)

	_, fechaExacta, err := ConvertirFechaADia(state.Data["fecha"])
	if err != nil {
		fechaExacta = state.Data["fecha"]
	}

	horaNormalizada, err := NormalizarHora(state.Data["hora"])
	if err != nil {
		horaNormalizada = state.Data["hora"]
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

	// Google Sheets
	sheetsErr := SaveAppointmentToSheets(
		appointmentData["nombre"],
		appointmentData["telefono"],
		appointmentData["fechaExacta"],
		appointmentData["hora"],
		appointmentData["servicio"],
		appointmentData["barbero"],
	)
	if sheetsErr != nil {
		log.Printf("❌ Sheets: %v", sheetsErr)
	}

	// Google Calendar
	calendarEvent, calendarErr := CreateCalendarEvent(appointmentData)
	if calendarErr != nil {
		log.Printf("❌ Calendar: %v", calendarErr)
	} else if calendarEvent != nil {
		log.Printf("✅ Calendar event: %s", calendarEvent.HtmlLink)
	}

	// Backend Attomos
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
		log.Printf("⚠️  Backend: %v", backendErr)
	}

	confirmation := generateConfirmationMessage(state.Data, fechaExacta, horaNormalizada)

	if HasPaymentMethods() {
		servicio := state.Data["servicio"]
		precio := GetServicePrice(servicio)
		paymentMsg := BuildPaymentMessage(servicio, precio, "")
		if paymentMsg != "" {
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

Incluye confirmación entusiasta, resumen de datos, agradecimiento y un emoji. Máximo 4-5 líneas.`,
			data["nombre"], data["servicio"], fechaExacta, horaNormalizada, BusinessCfg.AgentName)

		response, err := Chat(promptContext, "Confirmar cita", "")
		if err == nil && response != "" {
			return response
		}
	}

	confirmation := "¡Perfecto! 🎉 Tu cita ha sido agendada exitosamente.\n\n"
	confirmation += "📋 Resumen:\n"
	confirmation += fmt.Sprintf("👤 %s\n✂️ %s\n", data["nombre"], data["servicio"])
	if data["barbero"] != "" {
		confirmation += fmt.Sprintf("💈 Con: %s\n", data["barbero"])
	}
	confirmation += fmt.Sprintf("📅 %s a las %s\n\n¡Te esperamos! 😊", fechaExacta, horaNormalizada)
	return confirmation
}

// ── Detección de modo ─────────────────────────────────────────────────────────

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

// ── Flujo de pedidos ──────────────────────────────────────────────────────────

func startOrderFlow(state *UserState, message, userName string) string {
	state.IsOrdering = true
	state.Step = 1
	state.Cart = []OrderItem{}
	state.Data["userName"] = userName
	parseCartFromMessage(state, message)
	if len(state.Cart) > 0 {
		state.Step = 2
		response := buildCartSummary(state) + "\n\n¿Cómo lo prefieres? 😊\n\n🛵 A domicilio\n🏪 Recoger en local\n🍽️ Comer aquí"
		state.ConversationHistory = append(state.ConversationHistory, "Asistente: "+response)
		return response
	}
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

	if strings.Contains(msgL, "cancelar") || strings.Contains(msgL, "olvida") || strings.Contains(msgL, "no quiero") {
		state.IsOrdering = false
		state.Cart = []OrderItem{}
		state.Data = make(map[string]string)
		return "Entendido, pedido cancelado. ¿En qué más te puedo ayudar? 😊"
	}

	switch state.Step {
	case 1:
		parseCartFromMessage(state, message)
		if len(state.Cart) == 0 {
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
		response := buildCartSummary(state) + "\n\n¿Cómo lo prefieres? 😊\n\n🛵 A domicilio\n🏪 Recoger en local\n🍽️ Comer aquí"
		state.ConversationHistory = append(state.ConversationHistory, "Asistente: "+response)
		return response

	case 2:
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
	sb.WriteString("🧾 <b>Resumen de tu pedido:</b>\n\n")
	total := 0.0
	for _, item := range state.Cart {
		sb.WriteString(fmt.Sprintf("• %dx %s — $%.0f\n", item.Quantity, item.Title, item.Price*float64(item.Quantity)))
		total += item.Price * float64(item.Quantity)
	}
	sb.WriteString(fmt.Sprintf("\n💰 <b>Total: $%.0f MXN</b>\n", total))
	switch deliveryType {
	case "domicilio":
		if address != "" {
			sb.WriteString(fmt.Sprintf("🛵 <b>Entrega a domicilio:</b> %s\n", address))
		} else {
			sb.WriteString("🛵 <b>Entrega a domicilio</b>\n")
		}
	case "dine_in":
		sb.WriteString("🍽️ <b>Para comer en el local</b>\n")
	default:
		sb.WriteString("🏪 <b>Recoger en local</b>\n")
	}
	sb.WriteString(fmt.Sprintf("👤 <b>Cliente:</b> %s\n", userName))

	if HasPaymentMethods() && len(state.Cart) > 0 {
		cfg := GetPaymentConfig()
		hasStripe := cfg.StripeEnabled && cfg.StripeChargesEnabled
		hasSPEI := cfg.SPEIEnabled && cfg.CLABENumber != ""

		sb.WriteString("\n\n💳 <b>Opciones de pago</b>\n")
		sb.WriteString("━━━━━━━━━━━━━━━━━━━━━━\n")
		sb.WriteString(fmt.Sprintf("💰 <b>Total:</b> $%.0f MXN\n\n", total))

		if hasSPEI {
			sb.WriteString("🏦 <b>Transferencia SPEI</b>\n")
			sb.WriteString(fmt.Sprintf("   CLABE: <code>%s</code>\n", cfg.CLABENumber))
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
				log.Printf("⚠️  Error generando link de pago: %v", err)
			} else {
				sb.WriteString("💳 <b>Pagar con tarjeta</b>\n")
				sb.WriteString(fmt.Sprintf("   👉 %s\n", checkoutURL))
			}
		}
		sb.WriteString("━━━━━━━━━━━━━━━━━━━━━━\n")
	}
	sb.WriteString("\n\n¡Pedido recibido! Nos pondremos en contacto pronto. 🙌")

	// Guardar pedido en backend
	orderItems := make([]map[string]interface{}, 0, len(state.Cart))
	for _, item := range state.Cart {
		orderItems = append(orderItems, map[string]interface{}{
			"title": item.Title, "quantity": item.Quantity, "price": item.Price,
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
		ClientName: userName, ClientPhone: userID, Items: orderItems,
		Total: total, OrderType: orderType, DeliveryAddress: address, Status: "pending",
	})

	state.IsOrdering = false
	state.Cart = []OrderItem{}
	state.Data = make(map[string]string)
	response := sb.String()
	state.ConversationHistory = append(state.ConversationHistory, "Asistente: "+response)
	return response
}

// ── Carrito ───────────────────────────────────────────────────────────────────

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
	}
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
- Tolera errores ortográficos
- Si no se especifica cantidad, asume 1

RESPONDE ÚNICAMENTE con JSON válido:
[{"title": "Nombre exacto del producto", "quantity": 1, "price": 0.0}]

Si no hay productos: []`, catalog, message)

	ctx := context.Background()
	resp, err := geminiModel.GenerateContent(ctx, genai.Text(prompt))
	if err != nil {
		return nil, err
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
		return nil, fmt.Errorf("JSON no encontrado")
	}

	type geminiItem struct {
		Title    string  `json:"title"`
		Quantity int     `json:"quantity"`
		Price    float64 `json:"price"`
	}
	var geminiItems []geminiItem
	if err := json.Unmarshal([]byte(responseText[jsonStart:jsonEnd+1]), &geminiItems); err != nil {
		return nil, err
	}

	items := make([]OrderItem, 0, len(geminiItems))
	for _, gi := range geminiItems {
		if gi.Quantity <= 0 {
			gi.Quantity = 1
		}
		giNorm := normalizeStr(strings.TrimSpace(gi.Title))
		var matchedSvc *Service
		for i := range BusinessCfg.Services {
			if normalizeStr(strings.TrimSpace(BusinessCfg.Services[i].Title)) == giNorm {
				matchedSvc = &BusinessCfg.Services[i]
				break
			}
		}
		if matchedSvc == nil || !matchedSvc.InStock {
			continue
		}
		items = append(items, OrderItem{Title: matchedSvc.Title, Quantity: gi.Quantity, Price: effectivePrice(*matchedSvc)})
	}
	return items, nil
}

func buildCartSummary(state *UserState) string {
	if len(state.Cart) == 0 {
		return "No hay productos en tu pedido."
	}
	var sb strings.Builder
	sb.WriteString("🛒 <b>Tu pedido:</b>\n")
	total := 0.0
	for _, item := range state.Cart {
		sb.WriteString(fmt.Sprintf("  • %dx %s — $%.0f\n", item.Quantity, item.Title, item.Price*float64(item.Quantity)))
		total += item.Price * float64(item.Quantity)
	}
	sb.WriteString(fmt.Sprintf("💰 Subtotal: $%.0f MXN", total))
	return sb.String()
}

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
			lines = append(lines, fmt.Sprintf("• <b>%s</b> — Gratis", svc.Title))
		} else if svc.PriceType == "promotion" && svc.OriginalPrice > 0 {
			lines = append(lines, fmt.Sprintf("• <b>%s</b> — <s>$%.0f</s> $%.0f MXN 🔥", svc.Title, svc.OriginalPrice, price))
		} else {
			lines = append(lines, fmt.Sprintf("• <b>%s</b> — $%.0f MXN", svc.Title, price))
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

// ── Conversación normal ───────────────────────────────────────────────────────

func handleNormalConversation(message string, state *UserState) string {
	var promptContext string
	messageLower := strings.ToLower(message)

	if strings.Contains(messageLower, "servicio") || strings.Contains(messageLower, "precio") ||
		strings.Contains(messageLower, "cuanto cuesta") || strings.Contains(messageLower, "costo") {
		promptContext = "El cliente pregunta sobre productos, servicios o precios. Proporciona información detallada y clara del catálogo disponible."
	} else if strings.Contains(messageLower, "horario") || strings.Contains(messageLower, "abren") {
		promptContext = "El cliente pregunta sobre horarios. Proporciona los horarios de atención claramente."
	} else if strings.Contains(messageLower, "donde") || strings.Contains(messageLower, "ubicacion") || strings.Contains(messageLower, "direccion") {
		promptContext = "El cliente pregunta sobre ubicación. Proporciona la dirección completa y referencias útiles."
	} else if strings.Contains(messageLower, "hola") || strings.Contains(messageLower, "buenos") || strings.Contains(messageLower, "buenas") {
		return GenerateWelcomeMessage()
	} else {
		promptContext = "Responde de manera útil y natural según la información del negocio."
	}

	response, err := Chat(promptContext, message, joinHistory(state.ConversationHistory))
	if err != nil {
		return "Disculpa, ¿podrías repetir tu pregunta?"
	}
	state.ConversationHistory = append(state.ConversationHistory, "Asistente: "+response)
	return response
}

// ── Flujo automotriz ──────────────────────────────────────────────────────────

func startAutoAppointmentFlow(state *UserState, message, userName string) string {
	state.IsScheduling = true
	state.Step = 1
	state.Data["userName"] = userName
	state.Data["_mode"] = "automotriz"

	msgLower := strings.ToLower(message)
	if strings.Contains(msgLower, "prueba") || strings.Contains(msgLower, "test drive") {
		state.Data["servicio"] = "Prueba de manejo"
	} else if strings.Contains(msgLower, "mantenimiento") || strings.Contains(msgLower, "revisión") || strings.Contains(msgLower, "revision") {
		state.Data["servicio"] = "Servicio / Mantenimiento"
	}

	return autoNextStep(state)
}

func autoNextStep(state *UserState) string {
	if state.Data["nombre"] == "" {
		return "¡Claro! 🚗 Para agendar tu visita, ¿cuál es tu nombre completo?"
	}
	if state.Data["servicio"] == "" {
		return fmt.Sprintf("Hola <b>%s</b> 👋 ¿Qué tipo de visita deseas agendar?\n\n1️⃣ Prueba de manejo\n2️⃣ Servicio / Mantenimiento\n\nResponde con el número o el nombre de la opción 😊",
			state.Data["nombre"])
	}
	if state.Data["fecha"] == "" || state.Data["hora"] == "" {
		horarioHint := "ej: mañana a las 10 AM, lunes 25/06 a las 3 PM"
		if BusinessCfg != nil {
			type dayEntry struct {
				name string
				d    DaySchedule
			}
			allDays := []dayEntry{
				{"Lun", BusinessCfg.Schedule.Monday}, {"Mar", BusinessCfg.Schedule.Tuesday},
				{"Mié", BusinessCfg.Schedule.Wednesday}, {"Jue", BusinessCfg.Schedule.Thursday},
				{"Vie", BusinessCfg.Schedule.Friday}, {"Sáb", BusinessCfg.Schedule.Saturday},
				{"Dom", BusinessCfg.Schedule.Sunday},
			}
			type grupo struct{ inicio, fin, start, end string }
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
		return fmt.Sprintf("📅 ¿Cuándo te gustaría visitarnos?\n\n🕐 <b>Horario:</b> %s\n\n<i>ej: mañana a las 10 AM</i>", horarioHint)
	}
	if BusinessCfg != nil && len(BusinessCfg.Workers) > 1 && state.Data["barbero"] == "" {
		var asesores strings.Builder
		for i, w := range BusinessCfg.Workers {
			asesores.WriteString(fmt.Sprintf("%d️⃣ %s\n", i+1, w.Name))
		}
		return fmt.Sprintf("👤 ¿Con qué asesor prefieres tu cita?\n\n%s\nResponde con el número o escribe <b>cualquiera</b> si no tienes preferencia.", asesores.String())
	}
	return askForEmailReminder(state)
}

func continueAutoAppointmentFlow(state *UserState, message, userID string) string {
	if userID != "" {
		state.Data["userID"] = userID
	}
	msgLower := strings.ToLower(strings.TrimSpace(message))

	if state.Data["nombre"] == "" {
		state.Data["nombre"] = strings.TrimSpace(message)
		return autoNextStep(state)
	}
	if state.Data["servicio"] == "" {
		switch {
		case msgLower == "1" || strings.Contains(msgLower, "prueba") || strings.Contains(msgLower, "test"):
			state.Data["servicio"] = "Prueba de manejo"
		case msgLower == "2" || strings.Contains(msgLower, "mantenimiento") || strings.Contains(msgLower, "servicio") || strings.Contains(msgLower, "revisión"):
			state.Data["servicio"] = "Servicio / Mantenimiento"
		default:
			return "Por favor elige una opción:\n\n1️⃣ Prueba de manejo\n2️⃣ Servicio / Mantenimiento"
		}
		return autoNextStep(state)
	}
	if state.Data["fecha"] == "" || state.Data["hora"] == "" {
		horaRegex := regexp.MustCompile(`(?i)(?:a\s+las\s+|las\s+|@\s*)(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)`)
		horaMatch := horaRegex.FindStringSubmatch(message)
		if horaMatch == nil {
			horaRegex = regexp.MustCompile(`(?i)(?:^|\s)(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)`)
			horaMatch = horaRegex.FindStringSubmatch(message)
		}
		hora := ""
		if len(horaMatch) >= 4 {
			h, m := horaMatch[1], "00"
			if horaMatch[2] != "" {
				m = horaMatch[2]
			}
			if strings.ToLower(horaMatch[3]) == "pm" || strings.ToLower(horaMatch[3]) == "p.m." {
				hora = h + ":" + m + " PM"
			} else {
				hora = h + ":" + m + " AM"
			}
		}
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
				return fmt.Sprintf("⚠️ Ese horario está fuera de nuestra atención.\n\nAtendemos de <b>%d:00</b> a <b>%d:00</b>. ¿A qué hora prefieres?", openH, closeH)
			}
		}
		fecha := horaRegex.ReplaceAllString(message, "")
		fecha = regexp.MustCompile(`(?i)\s*(a\s+las?|las?|@)\s*$`).ReplaceAllString(fecha, "")
		fecha = strings.TrimSpace(fecha)
		if fecha == "" {
			fecha = message
		}
		if hora == "" {
			state.Data["fecha"] = strings.TrimSpace(message)
			return fmt.Sprintf("📅 Fecha: <b>%s</b> ✅\n\n🕐 ¿A qué hora te queda mejor?", state.Data["fecha"])
		}
		state.Data["fecha"] = strings.TrimSpace(fecha)
		state.Data["hora"] = hora
		return autoNextStep(state)
	}
	if BusinessCfg != nil && len(BusinessCfg.Workers) > 1 && state.Data["barbero"] == "" {
		if msgLower == "cualquiera" || strings.Contains(msgLower, "cualquier") || strings.Contains(msgLower, "no importa") {
			state.Data["barbero"] = "Cualquier asesor disponible"
		} else {
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
		return autoNextStep(state)
	}
	return autoNextStep(state)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func getMissingData(data map[string]string) []string {
	required := []string{"nombre", "servicio", "fecha", "hora"}
	if BusinessCfg != nil && len(BusinessCfg.Workers) > 1 {
		required = append(required, "barbero")
	}
	var missing []string
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

func cleanPhoneNumber(userID string) string {
	parts := strings.Split(userID, "@")
	phoneNumber := parts[0]
	cleaned := ""
	for _, char := range phoneNumber {
		if char >= '0' && char <= '9' {
			cleaned += string(char)
		}
	}
	// Para Telegram: el userID es un número entero, no un teléfono
	// Retornamos tal cual si no es un número de teléfono reconocible
	if len(cleaned) < 10 {
		return cleaned
	}
	if len(cleaned) == 13 && strings.HasPrefix(cleaned, "521") {
		return "52" + cleaned[3:]
	}
	if len(cleaned) == 12 && strings.HasPrefix(cleaned, "52") {
		return cleaned
	}
	if len(cleaned) == 10 {
		return "52" + cleaned
	}
	return cleaned
}

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

// ── Modo gubernamental ────────────────────────────────────────────────────────

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

func ProcessAgencyMessage(message, userID, userName string) string {
	state := GetCitizenState(userID)
	state.LastMessageTime = time.Now().Unix()
	state.ConversationHistory = append(state.ConversationHistory, "Ciudadano: "+message)
	if len(state.ConversationHistory) > 20 {
		state.ConversationHistory = state.ConversationHistory[10:]
	}
	msgLower := strings.ToLower(strings.TrimSpace(message))

	if msgLower == "cancelar" || msgLower == "salir" || msgLower == "reset" {
		ClearCitizenState(userID)
		return "Entendido, proceso cancelado. ¿En qué más puedo ayudarte?"
	}

	if state.IsRegistering && state.Step == 10 {
		return handleAgencyConfirmation(state, message, userID)
	}

	if state.IsRegistering {
		return continueAgencyRegistration(state, message, userID, userName)
	}
	if agencyWantsRegister(msgLower) {
		return startAgencyRegistration(state, message)
	}
	if agencyAsksCupos(msgLower) {
		return buildAgencyCuposMsg()
	}
	if c := FindCourse(message); c != nil && len(message) > 4 {
		return buildAgencyCourseDetail(c)
	}
	if strings.Contains(msgLower, "hola") || strings.Contains(msgLower, "buenos") {
		return buildAgencyWelcome(userName)
	}

	resp, err := Chat(GetAgencySystemPrompt(), message, joinHistory(state.ConversationHistory))
	if err != nil || resp == "" {
		resp = buildAgencyWelcome(userName)
	}
	state.ConversationHistory = append(state.ConversationHistory, "Asistente: "+resp)
	return resp
}

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

func startAgencyRegistration(state *CitizenState, message string) string {
	state.IsRegistering = true
	state.Step = 0
	state.Data = make(map[string]string)
	if c := FindCourse(message); c != nil {
		if !c.Disponible {
			state.IsRegistering = false
			return fmt.Sprintf("❌ El curso <b>%s</b> no tiene cupos disponibles.\n\n%s", c.Title, buildAgencyCuposMsg())
		}
		state.Data["curso"] = c.Title
		if c.Sede != "" {
			state.Data["sede"] = c.Sede
		}
		return fmt.Sprintf("📚 <b>Curso:</b> %s\n\n¿Cuál es tu nombre completo?", c.Title)
	}
	return buildAgencyCourseListMsg()
}

func continueAgencyRegistration(state *CitizenState, message, userID, _ string) string {
	msgLower := strings.ToLower(strings.TrimSpace(message))
	if state.Data["curso"] == "" {
		available := GetAgencyCourseAvailable()
		for i, c := range available {
			if msgLower == fmt.Sprintf("%d", i+1) || strings.Contains(normalizeStr(message), normalizeStr(c.Title)) {
				if !c.Disponible {
					return fmt.Sprintf("❌ <b>%s</b> sin cupos.\n\n%s", c.Title, buildAgencyCourseListMsg())
				}
				state.Data["curso"] = c.Title
				if c.Sede != "" {
					state.Data["sede"] = c.Sede
				}
				return fmt.Sprintf("📚 <b>Curso:</b> %s\n\n¿Cuál es tu nombre completo?", c.Title)
			}
		}
		return "No encontré ese curso.\n\n" + buildAgencyCourseListMsg()
	}
	if state.Data["nombre"] == "" {
		if len(strings.TrimSpace(message)) < 2 {
			return "Por favor ingresa tu nombre completo."
		}
		state.Data["nombre"] = strings.TrimSpace(message)
		state.Data["telefono"] = cleanPhoneNumber(userID)
		return "📧 ¿Cuál es tu correo electrónico? (escribe <b>sin correo</b> si no tienes)"
	}
	if state.Data["email"] == "" {
		if strings.Contains(msgLower, "sin correo") || strings.Contains(msgLower, "no tengo") || msgLower == "no" {
			state.Data["email"] = ""
		} else if strings.Contains(message, "@") {
			state.Data["email"] = strings.TrimSpace(message)
		} else {
			return "Por favor escribe tu email o responde <b>sin correo</b>."
		}
		if len(AgencyCfg.Sedes) > 1 && state.Data["sede"] == "" {
			return buildAgencySedeMsg()
		}
		state.Step = 10
		return buildAgencyRegistrationSummary(state) + "\n\n¿Confirmas tu inscripción? Responde <b>sí</b> o <b>no</b>."
	}
	if state.Data["sede"] == "" && len(AgencyCfg.Sedes) > 1 {
		for i, s := range AgencyCfg.Sedes {
			if msgLower == fmt.Sprintf("%d", i+1) || strings.Contains(normalizeStr(message), normalizeStr(s.Nombre)) {
				state.Data["sede"] = s.Nombre
				state.Step = 10
				return buildAgencyRegistrationSummary(state) + "\n\n¿Confirmas tu inscripción? Responde <b>sí</b> o <b>no</b>."
			}
		}
		return "Por favor elige una sede:\n\n" + buildAgencySedeMsg()
	}
	state.Step = 10
	return buildAgencyRegistrationSummary(state) + "\n\n¿Confirmas tu inscripción? Responde <b>sí</b> o <b>no</b>."
}

func handleAgencyConfirmation(state *CitizenState, message, userID string) string {
	msgLower := strings.ToLower(strings.TrimSpace(message))
	for _, w := range []string{"si", "sí", "yes", "claro", "confirmo", "ok", "dale", "adelante"} {
		if strings.Contains(msgLower, w) {
			return saveAgencyRegistration(state, userID)
		}
	}
	for _, w := range []string{"no", "cancelar", "nop"} {
		if msgLower == w {
			ClearCitizenState(userID)
			return "Inscripción cancelada. ¿Puedo ayudarte en algo más?"
		}
	}
	return "Por favor responde <b>sí</b> para confirmar o <b>no</b> para cancelar."
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
		cuposMsg = fmt.Sprintf("\n📊 Cupos restantes: <b>%s</b>", c.Cupos)
	}

	ClearCitizenState(userID)
	return fmt.Sprintf("✅ <b>¡Inscripción confirmada!</b>\n\n👤 <b>Nombre:</b> %s\n📚 <b>Curso:</b> %s\n📍 <b>Sede:</b> %s\n📅 <b>Registrado:</b> %s%s\n\nRecibirás más información próximamente. ¿Tienes alguna otra pregunta?",
		ins.Nombre, ins.Curso, ins.Sede, ins.Fecha, cuposMsg)
}

func buildAgencyWelcome(userName string) string {
	dep := ""
	if AgencyCfg != nil {
		dep = AgencyCfg.DepAcronym
	}
	if dep == "" {
		dep = "la dependencia"
	}
	return fmt.Sprintf("Hola, bienvenido/a a <b>%s</b> 🏛️\n\nPuedo ayudarte con:\n• 📚 Ver cursos disponibles\n• ✏️ Inscribirte a un curso\n• 📅 Horarios de atención\n• 📍 Ubicación y sedes\n\n¿En qué te puedo ayudar?", dep)
}

func buildAgencyCuposMsg() string {
	if AgencyCfg == nil || len(AgencyCfg.Cursos) == 0 {
		return "No hay cursos configurados."
	}
	var sb strings.Builder
	sb.WriteString("📚 <b>Disponibilidad de cursos:</b>\n\n")
	for _, c := range AgencyCfg.Cursos {
		if c.Disponible {
			cupos := ""
			if c.Cupos != "" && c.Cupos != "0" {
				cupos = fmt.Sprintf(" (%s lugares)", c.Cupos)
			}
			sb.WriteString(fmt.Sprintf("✅ <b>%s</b>%s\n", c.Title, cupos))
		} else {
			sb.WriteString(fmt.Sprintf("❌ <b>%s</b> — Sin cupos\n", c.Title))
		}
	}
	sb.WriteString("\nEscribe <b>inscribirme</b> para registrarte.")
	return sb.String()
}

func buildAgencyCourseDetail(c *AgencyCourse) string {
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("📚 <b>%s</b>\n\n", c.Title))
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
	sb.WriteString(fmt.Sprintf("📍 <b>Modalidad:</b> %s\n", mod))
	if c.Sede != "" {
		sb.WriteString(fmt.Sprintf("🏢 <b>Sede:</b> %s\n", c.Sede))
	}
	if c.FechaInicio != "" {
		sb.WriteString(fmt.Sprintf("📅 <b>Periodo:</b> %s → %s\n", c.FechaInicio, c.FechaFin))
	}
	if c.Disponible {
		label := "Disponible"
		if c.Cupos != "" && c.Cupos != "0" {
			label = c.Cupos + " lugares"
		}
		sb.WriteString(fmt.Sprintf("✅ <b>Cupos:</b> %s\n\n", label))
		sb.WriteString("¿Te gustaría inscribirte? Responde <b>inscribirme</b> o <b>sí</b>.")
	} else {
		sb.WriteString("❌ <b>Sin cupos disponibles</b> en este momento.")
	}
	return sb.String()
}

func buildAgencyCourseListMsg() string {
	available := GetAgencyCourseAvailable()
	if len(available) == 0 {
		return "❌ No hay cursos disponibles en este momento."
	}
	var sb strings.Builder
	sb.WriteString("📚 <b>Cursos disponibles:</b>\n\n")
	for i, c := range available {
		cupos := ""
		if c.Cupos != "" && c.Cupos != "0" {
			cupos = fmt.Sprintf(" — %s cupos", c.Cupos)
		}
		sb.WriteString(fmt.Sprintf("%d️⃣ <b>%s</b>%s\n", i+1, c.Title, cupos))
	}
	sb.WriteString("\nElige un número o escribe el nombre del curso:")
	return sb.String()
}

func buildAgencySedeMsg() string {
	if AgencyCfg == nil {
		return ""
	}
	var sb strings.Builder
	sb.WriteString("📍 <b>¿En qué sede deseas tomar el curso?</b>\n\n")
	for i, s := range AgencyCfg.Sedes {
		sb.WriteString(fmt.Sprintf("%d️⃣ <b>%s</b>\n   %s\n", i+1, s.Nombre, s.Direccion))
	}
	return sb.String()
}

func buildAgencyRegistrationSummary(state *CitizenState) string {
	email := state.Data["email"]
	if email == "" {
		email = "No proporcionado"
	}
	return fmt.Sprintf("📋 <b>Resumen de inscripción:</b>\n\n👤 <b>Nombre:</b> %s\n📱 <b>Telegram:</b> %s\n📧 <b>Email:</b> %s\n📚 <b>Curso:</b> %s\n📍 <b>Sede:</b> %s",
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
