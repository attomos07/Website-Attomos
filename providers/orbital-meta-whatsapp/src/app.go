package src

import (
	"fmt"
	"log"
	"regexp"
	"strings"
	"sync"
	"time"
)

// UserState estado del usuario
type UserState struct {
	IsScheduling        bool
	IsCancelling        bool
	IsAskingForEmail    bool
	Step                int
	Data                map[string]string
	ConversationHistory []string
	LastMessageTime     int64
}

var (
	userStates = make(map[string]*UserState)
	stateMutex sync.RWMutex
)

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

// ProcessMessage procesa un mensaje entrante y retorna la respuesta
func ProcessMessage(messageText, phoneNumber, senderName string) string {
	state := GetUserState(phoneNumber)
	state.LastMessageTime = time.Now().Unix()

	log.Println("╔════════════════════════════════════════╗")
	log.Println("║     PROCESANDO MENSAJE                 ║")
	log.Println("╚════════════════════════════════════════╝")
	log.Printf("📊 Estado del usuario %s:", senderName)
	log.Printf("   🔄 isScheduling: %v", state.IsScheduling)
	log.Printf("   🚫 isCancelling: %v", state.IsCancelling)
	log.Printf("   📧 isAskingForEmail: %v", state.IsAskingForEmail)
	log.Printf("   📋 Datos recopilados: %v", state.Data)
	log.Printf("   📝 Pasos completados: %d", state.Step)

	// Agregar al historial
	state.ConversationHistory = append(state.ConversationHistory, "Usuario: "+messageText)

	// Construir historial de conversación como string
	historyStr := strings.Join(state.ConversationHistory, "\n")

	// --- FLUJO DE EMAIL ---
	if state.IsAskingForEmail {
		log.Println("📧 CONTINUANDO FLUJO DE EMAIL")
		return processEmailReminderResponse(state, messageText, phoneNumber)
	}

	// --- FLUJO DE CANCELACIÓN ---
	messageLower := strings.ToLower(messageText)
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

	if wantsToCancelAppointment && !state.IsCancelling {
		log.Println("🚫 INICIANDO PROCESO DE CANCELACIÓN")
		return startCancellationFlow(state, messageText, senderName)
	}

	if state.IsCancelling {
		log.Println("🚫 CONTINUANDO PROCESO DE CANCELACIÓN")
		return continueCancellationFlow(state, messageText, phoneNumber, senderName)
	}

	// --- FLUJO DE AGENDAMIENTO ACTIVO ---
	if state.IsScheduling {
		log.Println("📅 CONTINUANDO FLUJO DE AGENDAMIENTO")
		return continueAppointmentFlow(state, messageText, phoneNumber, senderName, historyStr)
	}

	// --- ANÁLISIS CON GEMINI ---
	log.Println("🔍 Analizando intención con Gemini...")
	analysis, err := AnalyzeForAppointment(messageText, historyStr, false)
	if err != nil {
		log.Printf("⚠️  Error en análisis: %v", err)
	}

	if analysis != nil && analysis.WantsToSchedule && analysis.Confidence > 0.6 {
		log.Printf("✅ Usuario quiere agendar (confidence: %.2f)", analysis.Confidence)
		return startAppointmentFlow(state, messageText, phoneNumber, senderName, analysis, historyStr)
	}

	// --- CONVERSACIÓN NORMAL ---
	log.Println("💬 Procesando como conversación normal")
	return handleNormalConversation(state, messageText, phoneNumber, senderName, historyStr)
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
func continueCancellationFlow(state *UserState, message, _, userName string) string {
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

	if IsSheetsEnabled() {
		err := CancelAppointmentInSheets(userName, appointmentDateTime)
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

// startAppointmentFlow inicia el flujo de agendamiento con datos pre-extraídos
func startAppointmentFlow(state *UserState, messageText, phoneNumber, senderName string, analysis *AppointmentAnalysis, historyStr string) string {
	log.Println("╔════════════════════════════════════════╗")
	log.Println("║   INICIANDO FLUJO DE AGENDAMIENTO      ║")
	log.Println("╚════════════════════════════════════════╝")

	state.IsScheduling = true
	state.Step = 1

	// Pre-cargar datos extraídos por Gemini
	if analysis != nil && analysis.ExtractedData != nil {
		for k, v := range analysis.ExtractedData {
			if v != "" && v != "null" {
				state.Data[k] = v
				log.Printf("   📥 Dato pre-cargado: %s = %s", k, v)
			}
		}
	}

	// Asegurar que el teléfono esté guardado
	state.Data["telefono"] = cleanPhoneNumber(phoneNumber)

	// Preguntar por los datos que faltan
	return continueAppointmentFlow(state, messageText, phoneNumber, senderName, historyStr)
}

// continueAppointmentFlow continúa el flujo de agendamiento
func continueAppointmentFlow(state *UserState, messageText, phoneNumber, senderName, historyStr string) string {
	log.Println("📅 CONTINUANDO FLUJO DE AGENDAMIENTO")
	log.Printf("   Datos actuales: %v", state.Data)

	// Intentar extraer datos del mensaje actual con Gemini
	if messageText != "" && state.Step > 1 {
		analysis, err := AnalyzeForAppointment(messageText, historyStr, true)
		if err == nil && analysis != nil && analysis.ExtractedData != nil {
			for k, v := range analysis.ExtractedData {
				if v != "" && v != "null" && state.Data[k] == "" {
					state.Data[k] = v
					log.Printf("   📥 Dato extraído: %s = %s", k, v)
				}
			}
		}
	}

	state.Step++

	// Verificar qué datos faltan
	missing := getMissingData(state.Data)

	if len(missing) == 0 {
		// Tenemos todo, guardar la cita
		return saveAppointment(state, phoneNumber, senderName)
	}

	// Pedir el primer dato que falta
	nextField := missing[0]
	return askForField(nextField, state, senderName, historyStr)
}

// getMissingData retorna los campos que faltan
func getMissingData(data map[string]string) []string {
	var missing []string

	if data["nombre"] == "" {
		missing = append(missing, "nombre")
	}
	if data["servicio"] == "" {
		missing = append(missing, "servicio")
	}

	// Solo pedir barbero si hay más de 1 worker configurado
	if BusinessCfg != nil && len(BusinessCfg.Workers) > 1 {
		if data["barbero"] == "" {
			missing = append(missing, "barbero")
		}
	}

	if data["fecha"] == "" {
		missing = append(missing, "fecha")
	}
	if data["hora"] == "" {
		missing = append(missing, "hora")
	}

	return missing
}

// askForField genera el mensaje apropiado para pedir un campo
func askForField(field string, state *UserState, _, historyStr string) string {
	log.Printf("❓ Pidiendo campo: %s", field)

	switch field {
	case "nombre":
		msg := "¡Con gusto! Para agendar tu cita, ¿cuál es tu nombre completo?"
		if geminiEnabled {
			if resp, err := Chat("El usuario quiere agendar una cita. Pide su nombre de manera amigable.", "¿cómo te llamas?", historyStr); err == nil && resp != "" {
				msg = resp
			}
		}
		state.ConversationHistory = append(state.ConversationHistory, "Asistente: "+msg)
		return msg

	case "servicio":
		servicesList := ""
		if BusinessCfg != nil && len(BusinessCfg.Services) > 0 {
			for i, s := range BusinessCfg.Services {
				if s.Price > 0 {
					servicesList += fmt.Sprintf("\n%d. %s - $%.0f", i+1, s.Title, s.Price)
				} else {
					servicesList += fmt.Sprintf("\n%d. %s", i+1, s.Title)
				}
			}
		}
		msg := fmt.Sprintf("¿Qué servicio deseas?\n%s", servicesList)
		state.ConversationHistory = append(state.ConversationHistory, "Asistente: "+msg)
		return msg

	case "barbero":
		workersList := ""
		if BusinessCfg != nil && len(BusinessCfg.Workers) > 0 {
			for i, w := range BusinessCfg.Workers {
				workersList += fmt.Sprintf("\n%d. %s", i+1, w.Name)
			}
		}
		msg := fmt.Sprintf("¿Con quién deseas tu cita?%s", workersList)
		state.ConversationHistory = append(state.ConversationHistory, "Asistente: "+msg)
		return msg

	case "fecha":
		msg := "¿Para qué fecha deseas tu cita? (puedes decir 'mañana', 'lunes', o una fecha como 15/01/2026)"
		state.ConversationHistory = append(state.ConversationHistory, "Asistente: "+msg)
		return msg

	case "hora":
		horariosStr := strings.Join(HORARIOS, ", ")
		msg := fmt.Sprintf("¿A qué hora? Horarios disponibles:\n%s", horariosStr)
		state.ConversationHistory = append(state.ConversationHistory, "Asistente: "+msg)
		return msg
	}

	return "¿Puedes darme más información?"
}

// saveAppointment guarda la cita con todos los datos recopilados
func saveAppointment(state *UserState, phoneNumber, senderName string) string {
	log.Println("💾 GUARDANDO CITA")
	log.Printf("   Datos: %v", state.Data)

	// Normalizar datos
	diaSemana, fechaExacta, err := ConvertirFechaADia(state.Data["fecha"])
	if err != nil {
		log.Printf("❌ Error convirtiendo fecha: %v", err)
		state.IsScheduling = false
		state.Data = make(map[string]string)
		return "❌ Hubo un problema con la fecha. ¿Puedes intentarlo de nuevo?"
	}

	horaNormalizada, err := NormalizarHora(state.Data["hora"])
	if err != nil {
		log.Printf("❌ Error normalizando hora: %v", err)
		// Intentar con hora tal cual
		horaNormalizada = state.Data["hora"]
	}

	state.Data["fechaExacta"] = fechaExacta
	state.Data["diaSemana"] = diaSemana
	state.Data["hora"] = horaNormalizada
	state.Data["telefono"] = cleanPhoneNumber(phoneNumber)

	if state.Data["nombre"] == "" {
		state.Data["nombre"] = senderName
	}

	log.Printf("   📅 Fecha exacta: %s (%s)", fechaExacta, diaSemana)
	log.Printf("   ⏰ Hora normalizada: %s", horaNormalizada)

	// Guardar en Google Sheets
	if IsSheetsEnabled() {
		err := SaveAppointmentToSheets(
			state.Data["nombre"],
			state.Data["telefono"],
			fechaExacta,
			horaNormalizada,
			state.Data["servicio"],
			state.Data["barbero"],
		)
		if err != nil {
			log.Printf("❌ Error guardando en Sheets: %v", err)
		} else {
			log.Printf("✅ Cita guardada en Google Sheets")
		}
	}

	// Crear evento en Google Calendar
	if IsCalendarEnabled() {
		_, err := CreateCalendarEvent(state.Data)
		if err != nil {
			log.Printf("❌ Error creando evento en Calendar: %v", err)
		} else {
			log.Printf("✅ Evento creado en Google Calendar")
		}
	}

	// Preguntar por email para recordatorio
	emailQuestion := askForEmailReminder(state, senderName)

	// Construir mensaje de confirmación
	confirmMsg := generateConfirmationMessage(state.Data, senderName)

	// ── Agregar opciones de pago si el negocio las tiene configuradas ─────
	if HasPaymentMethods() {
		servicio := state.Data["servicio"]
		precio := GetServicePrice(servicio)
		paymentMsg := BuildPaymentMessage(servicio, precio)
		if paymentMsg != "" {
			log.Println("💳 [Payments] Agregando opciones de pago al mensaje")
			confirmMsg += "\n\n" + paymentMsg
		}
	}

	// Limpiar estado de agendamiento (pero mantener isAskingForEmail)
	state.IsScheduling = false

	// Si preguntamos por email, enviar confirmación + pregunta
	if emailQuestion != "" {
		state.ConversationHistory = append(state.ConversationHistory, "Asistente: "+confirmMsg)
		return confirmMsg + "\n\n" + emailQuestion
	}

	state.Data = make(map[string]string)
	state.ConversationHistory = append(state.ConversationHistory, "Asistente: "+confirmMsg)
	return confirmMsg
}

// askForEmailReminder pregunta si quiere recordatorio por email
func askForEmailReminder(state *UserState, _ string) string {
	if !IsCalendarEnabled() {
		return ""
	}

	state.IsAskingForEmail = true
	msg := "📧 ¿Te gustaría recibir un recordatorio por email? Si es así, escribe tu correo electrónico (o escribe 'no' para omitir)."
	return msg
}

// processEmailReminderResponse procesa la respuesta del email
func processEmailReminderResponse(state *UserState, message, _ string) string {
	state.IsAskingForEmail = false

	messageLower := strings.ToLower(strings.TrimSpace(message))

	// Si dice no o algo negativo
	if messageLower == "no" || messageLower == "no gracias" || messageLower == "omitir" || messageLower == "skip" {
		log.Println("📧 Usuario no quiere recordatorio por email")
		state.Data = make(map[string]string)
		return "¡Perfecto! Tu cita está confirmada. ¿Hay algo más en lo que pueda ayudarte?"
	}

	// Intentar extraer email
	email := ExtractEmailFromMessage(message)
	if email == "" || !isValidEmail(message) {
		// Verificar si el mensaje completo es un email
		if isValidEmail(messageLower) {
			email = messageLower
		}
	}

	if email != "" {
		state.Data["email"] = email
		log.Printf("📧 Email guardado: %s", email)

		// Actualizar evento en Calendar con email si existe
		// (El evento ya fue creado, aquí solo confirmamos)

		state.Data = make(map[string]string)
		return fmt.Sprintf("✅ ¡Listo! Te enviaremos un recordatorio a *%s*. ¿Puedo ayudarte en algo más?", email)
	}

	// No parece un email válido, ignorar y continuar
	state.Data = make(map[string]string)
	return "¡Perfecto! Tu cita está confirmada. ¿Hay algo más en lo que pueda ayudarte?"
}

// isValidEmail verifica si un string es un email válido
func isValidEmail(email string) bool {
	emailRegex := regexp.MustCompile(`^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$`)
	return emailRegex.MatchString(strings.TrimSpace(email))
}

// generateConfirmationMessage genera el mensaje de confirmación
func generateConfirmationMessage(data map[string]string, _ string) string {
	// Intentar generar con Gemini
	if geminiEnabled {
		prompt := fmt.Sprintf("Genera un mensaje de confirmación de cita amigable y breve para %s. Fecha: %s (%s), Hora: %s, Servicio: %s",
			data["nombre"],
			data["fechaExacta"],
			data["diaSemana"],
			data["hora"],
			data["servicio"],
		)
		if resp, err := Chat(prompt, "confirmar cita", ""); err == nil && resp != "" {
			return resp
		}
	}

	// Fallback manual
	msg := fmt.Sprintf(`✅ *¡Cita agendada exitosamente!*

👤 *Cliente:* %s
💼 *Servicio:* %s
📅 *Fecha:* %s (%s)
🕐 *Hora:* %s`,
		data["nombre"],
		data["servicio"],
		data["fechaExacta"],
		data["diaSemana"],
		data["hora"],
	)

	if data["barbero"] != "" {
		msg += fmt.Sprintf("\n💈 *Con:* %s", data["barbero"])
	}

	msg += "\n\n¡Te esperamos! 😊"
	return msg
}

// handleNormalConversation maneja conversaciones normales con contexto
func handleNormalConversation(state *UserState, messageText, _, senderName, historyStr string) string {
	log.Println("💬 CONVERSACIÓN NORMAL")

	normalizedMessage := strings.ToLower(strings.TrimSpace(messageText))

	// Detectar contexto específico sin Gemini
	if !geminiEnabled {
		return handleWithoutGemini(normalizedMessage, senderName)
	}

	// Determinar contexto para el prompt
	promptContext := "conversación general sobre el negocio"

	if ContainsKeywords(normalizedMessage, []string{"servicio", "tratamiento", "precio", "costo", "cuánto", "cuanto"}) {
		promptContext = "el usuario pregunta sobre servicios o precios"
	} else if ContainsKeywords(normalizedMessage, []string{"horario", "hora", "abre", "cierra", "atienden"}) {
		promptContext = "el usuario pregunta sobre horarios"
	} else if ContainsKeywords(normalizedMessage, []string{"ubicación", "ubicacion", "dirección", "direccion", "donde", "dónde"}) {
		promptContext = "el usuario pregunta sobre ubicación"
	} else if IsGreeting(normalizedMessage) {
		promptContext = "saludo inicial del cliente"
	}

	response, err := Chat(promptContext, messageText, historyStr)
	if err != nil || response == "" {
		log.Printf("⚠️  Error con Gemini: %v, usando fallback", err)
		return handleWithoutGemini(normalizedMessage, senderName)
	}

	state.ConversationHistory = append(state.ConversationHistory, "Asistente: "+response)
	return response
}

// handleWithoutGemini maneja mensajes sin IA disponible
func handleWithoutGemini(normalizedMessage, senderName string) string {
	config := GetBusinessConfig()

	if IsGreeting(normalizedMessage) {
		if config != nil {
			return fmt.Sprintf("¡Hola %s! 👋 Bienvenido a *%s*. ¿En qué puedo ayudarte?\n\n• Servicios\n• Horarios\n• Ubicación\n• Agendar cita", senderName, config.AgentName)
		}
		return fmt.Sprintf("¡Hola %s! 👋 ¿En qué puedo ayudarte?", senderName)
	}

	if ContainsKeywords(normalizedMessage, []string{"servicio", "tratamiento"}) {
		if config != nil && len(config.Services) > 0 {
			var sb strings.Builder
			sb.WriteString("💼 *Nuestros servicios:*\n")
			for _, s := range config.Services {
				if s.Price > 0 {
					sb.WriteString(fmt.Sprintf("• %s - $%.0f\n", s.Title, s.Price))
				} else {
					sb.WriteString(fmt.Sprintf("• %s\n", s.Title))
				}
			}
			return sb.String()
		}
	}

	if ContainsKeywords(normalizedMessage, []string{"horario", "hora", "abre", "cierra"}) {
		if config != nil {
			return fmt.Sprintf("🕐 *Horarios:*\n%s", config.BusinessHours)
		}
	}

	if ContainsKeywords(normalizedMessage, []string{"ubicación", "ubicacion", "dirección", "donde"}) {
		if config != nil && config.Address != "" {
			resp := fmt.Sprintf("📍 *Dirección:*\n%s", config.Address)
			if config.GoogleMapsLink != "" {
				resp += fmt.Sprintf("\n\n🗺 %s", config.GoogleMapsLink)
			}
			return resp
		}
	}

	return fmt.Sprintf("Lo siento %s, no entendí tu mensaje. Escribe *\"Ayuda\"* para ver las opciones disponibles.", senderName)
}

// cleanPhoneNumber limpia y formatea el número de teléfono de Meta WhatsApp
func cleanPhoneNumber(phoneNumber string) string {
	// Los números de Meta WhatsApp vienen directamente como número (sin @s.whatsapp.net)
	// Ejemplo: 5216621234567

	log.Printf("🔍 Limpiando número: %s", phoneNumber)

	// Extraer solo los dígitos
	cleaned := ""
	for _, char := range phoneNumber {
		if char >= '0' && char <= '9' {
			cleaned += string(char)
		}
	}

	log.Printf("   Solo dígitos: %s", cleaned)

	if len(cleaned) < 10 {
		log.Printf("⚠️  Número de teléfono inválido (muy corto): %s", cleaned)
		return cleaned
	}

	// Números mexicanos con prefijo 521 (13 dígitos): quitar el "1" intermedio
	if len(cleaned) == 13 && strings.HasPrefix(cleaned, "521") {
		cleaned = "52" + cleaned[3:]
		log.Printf("✅ Prefijo 521 normalizado a 52: %s", cleaned)
		return cleaned
	}

	// 12 dígitos con prefijo 52 → correcto
	if len(cleaned) == 12 && strings.HasPrefix(cleaned, "52") {
		log.Printf("✅ Número con código de país 52: %s", cleaned)
		return cleaned
	}

	// 10 dígitos → agregar 52
	if len(cleaned) == 10 {
		cleaned = "52" + cleaned
		log.Printf("✅ Código de país 52 agregado: %s", cleaned)
		return cleaned
	}

	// Otro caso: tomar últimos 10 + agregar 52
	if len(cleaned) > 10 {
		cleaned = "52" + cleaned[len(cleaned)-10:]
		log.Printf("✅ Número normalizado (últimos 10): %s", cleaned)
	}

	log.Printf("📞 Número limpio final: %s", cleaned)
	return cleaned
}
