package src

// telegram.go — capa de transporte para Telegram.
// Recibe updates del bot, extrae texto/foto/documento,
// delega en ProcessMessage (idéntico al de WhatsApp) y
// envía la respuesta usando la API de Telegram.
//
// Diferencias clave vs WhatsApp:
//   - Los mensajes de grupos sí se manejan (el bot responde cuando lo mencionan o recibe /comando)
//   - Los archivos se envían con SendPhoto / SendDocument de tgbotapi
//   - El chat ID es int64, no un JID
//   - El markdown de WhatsApp (*negrita*) se convierte a HTML de Telegram (<b>negrita</b>)

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	tgbotapi "github.com/go-telegram-bot-api/telegram-bot-api/v5"
)

// ── Deduplicación de mensajes ────────────────────────────────────────────────

var (
	tgProcessedMsgs   = make(map[int]int64) // updateID → timestamp
	tgProcessedMsgsMu sync.Mutex
)

func isTelegramDuplicate(updateID int) bool {
	tgProcessedMsgsMu.Lock()
	defer tgProcessedMsgsMu.Unlock()

	now := time.Now().Unix()
	for id, ts := range tgProcessedMsgs {
		if now-ts > 60 {
			delete(tgProcessedMsgs, id)
		}
	}
	if _, seen := tgProcessedMsgs[updateID]; seen {
		return true
	}
	tgProcessedMsgs[updateID] = now
	return false
}

// ── Handler principal ────────────────────────────────────────────────────────

// HandleTelegramUpdate es llamado desde main.go en una goroutine por cada update.
func HandleTelegramUpdate(bot *tgbotapi.BotAPI, update tgbotapi.Update) {
	// Solo procesar mensajes de texto (y caption de fotos/docs)
	if update.Message == nil {
		return
	}

	if isTelegramDuplicate(update.UpdateID) {
		log.Printf("⚠️  Update duplicado ignorado: %d", update.UpdateID)
		return
	}

	msg := update.Message
	chatID := msg.Chat.ID
	userID := fmt.Sprintf("%d", msg.From.ID)
	userName := msg.From.FirstName
	if msg.From.LastName != "" {
		userName += " " + msg.From.LastName
	}
	if userName == "" {
		userName = "Cliente"
	}

	// En grupos solo responder cuando el bot es mencionado o hay comando
	if msg.Chat.IsGroup() || msg.Chat.IsSuperGroup() {
		if !isBotMentioned(bot, msg) && !msg.IsCommand() {
			return
		}
	}

	// ── Nota de voz: transcribir con Gemini y procesar como si fuera texto ───
	if msg.Voice != nil {
		handleTelegramVoice(bot, msg, chatID, userID, userName)
		return
	}

	// ── Archivo de audio (música, nota grabada reenviada, etc.) ──────────────
	if msg.Audio != nil {
		handleTelegramAudio(bot, msg, chatID, userID, userName)
		return
	}

	// ── Foto: analizarla con Gemini Vision y responder directamente ──────────
	if len(msg.Photo) > 0 {
		handleTelegramPhoto(bot, msg, chatID, userID, userName)
		return
	}

	// Extraer texto del mensaje
	text := extractMessageText(msg)
	if text == "" {
		return
	}

	log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
	log.Printf("📨 MENSAJE TELEGRAM")
	log.Printf("   👤 De: %s (%s)", userName, userID)
	log.Printf("   💬 Texto: %s", text)
	log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

	// Indicador de "escribiendo..."
	sendChatAction(bot, chatID, tgbotapi.ChatTyping)

	respondToTelegramText(bot, chatID, userID, userName, text)
}

// respondToTelegramText corre el pipeline normal (ProcessMessage/ProcessAgencyMessage)
// sobre un texto y envía la respuesta, incluyendo la intercepción de SEND_MENU
// y SEND_PHOTOS. Se usa tanto para mensajes escritos como para notas de voz o
// audios ya transcritos — así agendar, pedidos, cancelaciones, etc. funcionan
// igual sin importar si el cliente escribió o habló.
func respondToTelegramText(bot *tgbotapi.BotAPI, chatID int64, userID, userName, text string) {
	// Delegar en el núcleo compartido con WhatsApp
	var response string
	if IsAgencyMode() {
		response = ProcessAgencyMessage(text, userID, userName)
	} else {
		response = ProcessMessage(text, userID, userName)
	}

	// ── Interceptar tags especiales de media ─────────────────────────────

	// SEND_MENU
	if strings.Contains(response, "SEND_MENU") {
		handleSendMenu(bot, chatID)
		log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
		return
	}

	// SEND_PHOTOS:<título>
	if idx := strings.Index(response, "SEND_PHOTOS:"); idx != -1 {
		raw := response[idx+len("SEND_PHOTOS:"):]
		end := len(raw)
		for i, ch := range raw {
			if ch == '\n' || ch == '\r' {
				end = i
				break
			}
		}
		serviceTitle := strings.TrimSpace(raw[:end])
		handleSendPhotos(bot, chatID, serviceTitle)
		log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
		return
	}

	// Limpiar formato y enviar
	response = whatsappToTelegramMarkdown(response)

	if response != "" {
		sendTelegramMessage(bot, chatID, response)
	}
	log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
}

// downloadTelegramFile obtiene la URL directa de un archivo de Telegram
// (foto, nota de voz, audio, documento) y descarga sus bytes.
func downloadTelegramFile(bot *tgbotapi.BotAPI, fileID string) ([]byte, error) {
	fileURL, err := bot.GetFileDirectURL(fileID)
	if err != nil {
		return nil, fmt.Errorf("error obteniendo URL del archivo: %w", err)
	}

	resp, err := http.Get(fileURL) //nolint:noctx
	if err != nil {
		return nil, fmt.Errorf("error descargando archivo: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("descarga retornó status %d", resp.StatusCode)
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("error leyendo bytes del archivo: %w", err)
	}

	return data, nil
}

// handleTelegramVoice descarga una nota de voz de Telegram, la transcribe con
// Gemini y continúa el flujo normal como si el cliente hubiera escrito el texto.
func handleTelegramVoice(bot *tgbotapi.BotAPI, msg *tgbotapi.Message, chatID int64, userID, userName string) {
	log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
	log.Printf("🎙️  NOTA DE VOZ RECIBIDA de %s (%s)", userName, userID)
	log.Printf("   ⏱️  Duración: %ds", msg.Voice.Duration)

	sendChatAction(bot, chatID, tgbotapi.ChatTyping)

	audioBytes, err := downloadTelegramFile(bot, msg.Voice.FileID)
	if err != nil {
		log.Printf("❌ Error descargando nota de voz: %v", err)
		sendTelegramMessage(bot, chatID, "No pude escuchar tu audio 😕 ¿Puedes escribirme tu mensaje?")
		log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
		return
	}

	mimeType := msg.Voice.MimeType
	if mimeType == "" {
		mimeType = "audio/ogg"
	}

	log.Printf("   📦 Tamaño: %d bytes | MIME: %s", len(audioBytes), mimeType)

	transcribed, err := TranscribeAudio(audioBytes, mimeType)
	if err != nil || strings.TrimSpace(transcribed) == "" {
		log.Printf("❌ Error transcribiendo audio: %v", err)
		sendTelegramMessage(bot, chatID, "No logré entender bien tu audio 😕 ¿Me lo puedes escribir?")
		log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
		return
	}

	log.Printf("   📝 Transcripción: %s", transcribed)
	log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

	sendChatAction(bot, chatID, tgbotapi.ChatTyping)
	respondToTelegramText(bot, chatID, userID, userName, transcribed)
}

// handleTelegramAudio es igual a handleTelegramVoice pero para archivos de
// audio "normales" (music/Audio de Telegram, en vez de una nota de voz).
func handleTelegramAudio(bot *tgbotapi.BotAPI, msg *tgbotapi.Message, chatID int64, userID, userName string) {
	log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
	log.Printf("🎵 AUDIO RECIBIDO de %s (%s)", userName, userID)
	log.Printf("   ⏱️  Duración: %ds", msg.Audio.Duration)

	sendChatAction(bot, chatID, tgbotapi.ChatTyping)

	audioBytes, err := downloadTelegramFile(bot, msg.Audio.FileID)
	if err != nil {
		log.Printf("❌ Error descargando audio: %v", err)
		sendTelegramMessage(bot, chatID, "No pude escuchar tu audio 😕 ¿Puedes escribirme tu mensaje?")
		log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
		return
	}

	mimeType := msg.Audio.MimeType
	if mimeType == "" {
		mimeType = "audio/mpeg"
	}

	log.Printf("   📦 Tamaño: %d bytes | MIME: %s", len(audioBytes), mimeType)

	transcribed, err := TranscribeAudio(audioBytes, mimeType)
	if err != nil || strings.TrimSpace(transcribed) == "" {
		log.Printf("❌ Error transcribiendo audio: %v", err)
		sendTelegramMessage(bot, chatID, "No logré entender bien tu audio 😕 ¿Me lo puedes escribir?")
		log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
		return
	}

	log.Printf("   📝 Transcripción: %s", transcribed)
	log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

	sendChatAction(bot, chatID, tgbotapi.ChatTyping)
	respondToTelegramText(bot, chatID, userID, userName, transcribed)
}

// handleTelegramPhoto descarga la foto de mayor resolución enviada, la analiza
// con Gemini Vision usando el contexto/catálogo del negocio y responde
// directamente (ej. "¿venden esto?" con una foto adjunta).
func handleTelegramPhoto(bot *tgbotapi.BotAPI, msg *tgbotapi.Message, chatID int64, userID, userName string) {
	log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
	log.Printf("🖼️  IMAGEN RECIBIDA de %s (%s)", userName, userID)

	caption := msg.Caption
	log.Printf("   💬 Caption: %s", caption)

	sendChatAction(bot, chatID, tgbotapi.ChatTyping)

	// Telegram manda varias resoluciones de la misma foto — la última es la de mayor tamaño
	photo := msg.Photo[len(msg.Photo)-1]

	imageBytes, err := downloadTelegramFile(bot, photo.FileID)
	if err != nil {
		log.Printf("❌ Error descargando imagen: %v", err)
		sendTelegramMessage(bot, chatID, "No pude abrir tu imagen 😕 ¿Puedes reenviarla?")
		log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
		return
	}

	// Telegram siempre re-comprime las fotos a JPEG
	mimeType := "image/jpeg"

	log.Printf("   📦 Tamaño: %d bytes | MIME: %s", len(imageBytes), mimeType)

	state := GetUserState(userID)
	state.LastMessageTime = time.Now().Unix()

	question := caption
	if question == "" {
		question = "El cliente envió esta imagen sin comentario. Descríbela brevemente y pregunta en qué le puedes ayudar respecto a ella."
	}

	answer, err := AnalyzeImage(imageBytes, mimeType, question, joinHistory(state.ConversationHistory))
	if err != nil {
		log.Printf("❌ Error analizando imagen con Gemini: %v", err)
		sendTelegramMessage(bot, chatID, "Recibí tu imagen pero no pude analizarla en este momento 😕 ¿Puedes describirme lo que necesitas?")
		log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
		return
	}

	// Guardar en el historial para mantener contexto en la conversación
	histEntry := "Usuario: [envió una imagen]"
	if caption != "" {
		histEntry += " " + caption
	}
	state.ConversationHistory = append(state.ConversationHistory, histEntry)
	state.ConversationHistory = append(state.ConversationHistory, "Asistente: "+answer)

	answer = whatsappToTelegramMarkdown(answer)

	log.Printf("📤 ENVIANDO RESPUESTA DE IMAGEN a %s...", userName)
	sendTelegramMessage(bot, chatID, answer)
	log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
}

// ── Helpers de envío ─────────────────────────────────────────────────────────

// sendTelegramMessage envía un mensaje de texto con HTML parse mode.
func sendTelegramMessage(bot *tgbotapi.BotAPI, chatID int64, text string) {
	msg := tgbotapi.NewMessage(chatID, text)
	msg.ParseMode = tgbotapi.ModeHTML

	_, err := bot.Send(msg)
	if err != nil {
		// Si falla HTML, intentar sin formato
		log.Printf("⚠️  Error enviando HTML, reintentando sin formato: %v", err)
		msg2 := tgbotapi.NewMessage(chatID, stripHTML(text))
		if _, err2 := bot.Send(msg2); err2 != nil {
			log.Printf("❌ Error enviando mensaje: %v", err2)
		}
	} else {
		log.Printf("✅ Mensaje enviado a chat %d", chatID)
	}
}

// sendChatAction envía acción de "escribiendo..." o "enviando foto..."
func sendChatAction(bot *tgbotapi.BotAPI, chatID int64, action string) {
	ca := tgbotapi.NewChatAction(chatID, action)
	bot.Send(ca)
}

// handleSendMenu envía el menú como foto o documento, igual que WhatsApp.
func handleSendMenu(bot *tgbotapi.BotAPI, chatID int64) {
	if BusinessCfg == nil || BusinessCfg.MenuUrl == "" {
		// Sin URL: enviar menú en texto
		text := whatsappToTelegramMarkdown(buildMenuResponse())
		sendTelegramMessage(bot, chatID, text)
		return
	}

	menuURL := BusinessCfg.MenuUrl
	urlLower := strings.ToLower(menuURL)
	caption := "Menú - " + BusinessCfg.AgentName

	sendChatAction(bot, chatID, tgbotapi.ChatUploadDocument)

	if strings.HasSuffix(urlLower, ".pdf") {
		doc := tgbotapi.NewDocument(chatID, tgbotapi.FileURL(menuURL))
		doc.Caption = caption
		if _, err := bot.Send(doc); err != nil {
			log.Printf("❌ Error enviando menú PDF: %v — enviando link", err)
			sendTelegramMessage(bot, chatID, "📋 Aquí está nuestro menú: "+menuURL)
		} else {
			log.Println("✅ Menú PDF enviado")
		}
		return
	}

	// Imagen
	for _, ext := range []string{".jpg", ".jpeg", ".png", ".webp"} {
		if strings.HasSuffix(urlLower, ext) {
			photo := tgbotapi.NewPhoto(chatID, tgbotapi.FileURL(menuURL))
			photo.Caption = caption
			if _, err := bot.Send(photo); err != nil {
				log.Printf("❌ Error enviando menú imagen: %v — enviando link", err)
				sendTelegramMessage(bot, chatID, "🖼️ Aquí está nuestro menú: "+menuURL)
			} else {
				log.Println("✅ Menú imagen enviado")
			}
			return
		}
	}

	// URL sin extensión reconocida — enviar como link
	sendTelegramMessage(bot, chatID, "📋 Aquí está nuestro menú: "+menuURL)
}

// handleSendPhotos envía las fotos de un servicio.
func handleSendPhotos(bot *tgbotapi.BotAPI, chatID int64, serviceTitle string) {
	if BusinessCfg == nil {
		sendTelegramMessage(bot, chatID, "No encontré fotos de ese producto.")
		return
	}

	var matched *Service
	queryNorm := normalizeStr(serviceTitle)

	for i := range BusinessCfg.Services {
		if strings.EqualFold(strings.TrimSpace(BusinessCfg.Services[i].Title), serviceTitle) {
			matched = &BusinessCfg.Services[i]
			break
		}
	}
	if matched == nil {
		for i := range BusinessCfg.Services {
			titleNorm := normalizeStr(BusinessCfg.Services[i].Title)
			if strings.Contains(titleNorm, queryNorm) || strings.Contains(queryNorm, titleNorm) {
				matched = &BusinessCfg.Services[i]
				break
			}
		}
	}

	if matched == nil || len(matched.ImageUrls) == 0 {
		log.Printf("⚠️  Servicio '%s' no encontrado o sin fotos", serviceTitle)
		sendTelegramMessage(bot, chatID, "No encontré fotos de ese producto. ¿Puedes ser más específico?")
		return
	}

	sendChatAction(bot, chatID, tgbotapi.ChatUploadPhoto)

	if len(matched.ImageUrls) == 1 {
		photo := tgbotapi.NewPhoto(chatID, tgbotapi.FileURL(matched.ImageUrls[0]))
		photo.Caption = matched.Title
		if _, err := bot.Send(photo); err != nil {
			log.Printf("❌ Error enviando foto: %v", err)
		}
		return
	}

	// Múltiples fotos → media group
	mediaGroup := make([]interface{}, 0, len(matched.ImageUrls))
	for i, imgURL := range matched.ImageUrls {
		photo := tgbotapi.NewInputMediaPhoto(tgbotapi.FileURL(imgURL))
		if i == 0 {
			photo.Caption = matched.Title
		}
		mediaGroup = append(mediaGroup, photo)
	}

	mg := tgbotapi.NewMediaGroup(chatID, mediaGroup)
	if _, err := bot.Send(mg); err != nil {
		log.Printf("❌ Error enviando media group: %v — enviando una por una", err)
		for _, imgURL := range matched.ImageUrls {
			photo := tgbotapi.NewPhoto(chatID, tgbotapi.FileURL(imgURL))
			bot.Send(photo)
			time.Sleep(300 * time.Millisecond)
		}
	} else {
		log.Printf("✅ %d fotos de '%s' enviadas", len(matched.ImageUrls), matched.Title)
	}
}

// ── Conversión de formatos ────────────────────────────────────────────────────

// whatsappToTelegramMarkdown convierte el formato WhatsApp (*bold*, _italic_)
// a HTML de Telegram (<b>bold</b>, <i>italic</i>) y escapa caracteres peligrosos.
func whatsappToTelegramMarkdown(text string) string {
	// Primero escapar < y > literales que no sean nuestros tags
	// (hacemos la conversión antes para poder usar < > libremente)
	var sb strings.Builder
	lines := strings.Split(text, "\n")

	for i, line := range lines {
		line = convertWALine(line)
		sb.WriteString(line)
		if i < len(lines)-1 {
			sb.WriteString("\n")
		}
	}
	return sb.String()
}

func convertWALine(line string) string {
	// Escapar & < > que no son nuestros tags
	line = strings.ReplaceAll(line, "&", "&amp;")
	// *texto* → <b>texto</b>
	line = convertInlineFormat(line, "*", "<b>", "</b>")
	// _texto_ → <i>texto</i>
	line = convertInlineFormat(line, "_", "<i>", "</i>")
	// ~texto~ → <s>texto</s>
	line = convertInlineFormat(line, "~", "<s>", "</s>")
	// `texto` → <code>texto</code>
	line = convertInlineFormat(line, "`", "<code>", "</code>")
	return line
}

func convertInlineFormat(s, marker, open, close string) string {
	result := ""
	remaining := s
	for {
		idx1 := strings.Index(remaining, marker)
		if idx1 == -1 {
			result += remaining
			break
		}
		idx2 := strings.Index(remaining[idx1+len(marker):], marker)
		if idx2 == -1 {
			result += remaining
			break
		}
		idx2 += idx1 + len(marker)
		inner := remaining[idx1+len(marker) : idx2]
		result += remaining[:idx1] + open + inner + close
		remaining = remaining[idx2+len(marker):]
	}
	return result
}

// stripHTML elimina tags HTML básicos para fallback sin formato.
func stripHTML(s string) string {
	replacer := strings.NewReplacer(
		"<b>", "", "</b>", "",
		"<i>", "", "</i>", "",
		"<s>", "", "</s>", "",
		"<code>", "", "</code>", "",
		"&amp;", "&",
	)
	return replacer.Replace(s)
}

// ── Helpers de mensaje ────────────────────────────────────────────────────────

// extractMessageText saca el texto de un mensaje (texto, caption de foto/doc, o comando).
func extractMessageText(msg *tgbotapi.Message) string {
	if msg.Text != "" {
		// Si es un comando, quitar el prefijo /comando@bot
		if msg.IsCommand() {
			return handleCommand(msg)
		}
		return msg.Text
	}
	if msg.Caption != "" {
		return msg.Caption
	}
	return ""
}

// handleCommand convierte comandos de Telegram en texto natural.
func handleCommand(msg *tgbotapi.Message) string {
	switch msg.Command() {
	case "start", "hola":
		return "hola"
	case "menu", "catalogo":
		return "quiero ver el menú"
	case "cita", "agendar":
		return "quiero agendar una cita"
	case "cancelar":
		return "cancelar cita"
	case "horario", "horarios":
		return "¿cuál es su horario?"
	case "ubicacion", "direccion":
		return "¿dónde están ubicados?"
	case "servicios", "precios":
		return "¿qué servicios tienen y cuánto cuestan?"
	case "help", "ayuda":
		return "¿en qué me puedes ayudar?"
	default:
		// Comando desconocido → pasar como texto natural
		args := msg.CommandArguments()
		if args != "" {
			return args
		}
		return msg.Text
	}
}

// isBotMentioned verifica si el bot fue mencionado en un mensaje de grupo.
func isBotMentioned(bot *tgbotapi.BotAPI, msg *tgbotapi.Message) bool {
	if msg.Text == "" {
		return false
	}
	mention := "@" + bot.Self.UserName
	return strings.Contains(msg.Text, mention)
}

// ── SendImage/SendDocument para uso externo (compatibilidad con src/) ────────

// TelegramSendImage descarga una imagen y la envía a Telegram.
// Equivalente a SendImage en utils.go para WhatsApp.
func TelegramSendImage(bot *tgbotapi.BotAPI, chatID int64, imageURL string, caption string) error {
	resp, err := http.Get(imageURL) //nolint:noctx
	if err != nil {
		return fmt.Errorf("error descargando imagen: %w", err)
	}
	defer resp.Body.Close()

	photo := tgbotapi.NewPhoto(chatID, tgbotapi.FileURL(imageURL))
	photo.Caption = caption
	_, err = bot.Send(photo)
	return err
}

// TelegramSendDocument envía un documento (PDF, etc.) a Telegram.
func TelegramSendDocument(bot *tgbotapi.BotAPI, chatID int64, fileURL string, fileName string, caption string) error {
	doc := tgbotapi.NewDocument(chatID, tgbotapi.FileURL(fileURL))
	doc.Caption = caption
	_, err := bot.Send(doc)
	return err
}
