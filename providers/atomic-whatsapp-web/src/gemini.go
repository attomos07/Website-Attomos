package src

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/google/generative-ai-go/genai"
	"google.golang.org/api/option"
)

var geminiClient *genai.Client
var geminiModel *genai.GenerativeModel
var geminiEnabled bool

// AppointmentAnalysis estructura para análisis de agendamiento
type AppointmentAnalysis struct {
	WantsToSchedule bool              `json:"wantsToSchedule"`
	ExtractedData   map[string]string `json:"extractedData"`
	Confidence      float64           `json:"confidence"`
}

// InitGemini inicializa el cliente de Gemini AI
func InitGemini() error {
	log.Println("🔧 Intentando inicializar Gemini AI...")

	apiKey := os.Getenv("GEMINI_API_KEY")
	if apiKey == "" {
		geminiEnabled = false
		log.Println("❌ GEMINI_API_KEY no está configurada en el .env")
		return fmt.Errorf("GEMINI_API_KEY no configurada")
	}

	if !strings.HasPrefix(apiKey, "AIzaSy") {
		geminiEnabled = false
		log.Printf("❌ GEMINI_API_KEY tiene formato inválido (debe comenzar con 'AIzaSy'): %s...\n", apiKey[:10])
		return fmt.Errorf("GEMINI_API_KEY tiene formato inválido")
	}

	log.Printf("✅ GEMINI_API_KEY encontrada: %s...%s\n", apiKey[:10], apiKey[len(apiKey)-4:])

	ctx := context.Background()
	client, err := genai.NewClient(ctx, option.WithAPIKey(apiKey))
	if err != nil {
		geminiEnabled = false
		log.Printf("❌ Error creando cliente Gemini: %v\n", err)
		return fmt.Errorf("error creando cliente Gemini: %w", err)
	}

	geminiClient = client
	geminiModel = client.GenerativeModel("gemini-2.5-flash-lite")

	geminiModel.SetTemperature(0.7)
	geminiModel.SetMaxOutputTokens(1024)
	geminiModel.SetTopP(0.9)
	geminiModel.SetTopK(40)

	log.Println("🧪 Probando conexión con Gemini...")
	testResp, err := geminiModel.GenerateContent(ctx, genai.Text("Di 'OK' si funcionas correctamente"))
	if err != nil {
		geminiEnabled = false
		log.Printf("❌ Error en prueba de Gemini: %v\n", err)
		return fmt.Errorf("error en prueba de Gemini: %w", err)
	}

	if testResp == nil || len(testResp.Candidates) == 0 {
		geminiEnabled = false
		log.Println("❌ Gemini no retornó respuesta en prueba")
		return fmt.Errorf("Gemini no retornó respuesta")
	}

	geminiEnabled = true
	log.Println("✅ Gemini AI inicializado y verificado correctamente")
	log.Println("📊 Modelo: gemini-2.5-flash-lite")
	log.Println("🎯 Temperatura: 0.7")
	log.Println("📝 Max Tokens: 1024")

	return nil
}

// IsGeminiEnabled verifica si Gemini está habilitado
func IsGeminiEnabled() bool {
	return geminiEnabled
}

// Chat función principal para chatear con Gemini usando configuración dinámica
func Chat(promptContext, userMessage, conversationHistory string) (string, error) {
	if !geminiEnabled {
		log.Println("⚠️  Chat llamado pero Gemini no está habilitado")
		return "", fmt.Errorf("Gemini no está habilitado")
	}

	if geminiClient == nil {
		log.Println("❌ geminiClient es nil")
		return "", fmt.Errorf("Gemini no inicializado")
	}

	log.Printf("💬 Generando respuesta con Gemini...\n")
	log.Printf("   📝 Mensaje del usuario: %s\n", userMessage)
	log.Printf("   🎯 Contexto: %s\n", promptContext)

	ctx := context.Background()

	systemPrompt := GetSystemPrompt()

	// ── Construir reglas de media (fotos y menú) ─────────────────────────────
	mediaCatalog := ""
	if BusinessCfg != nil {
		// Fotos de servicios/productos
		photosSection := ""
		for _, svc := range BusinessCfg.Services {
			if len(svc.ImageUrls) > 0 {
				photosSection += fmt.Sprintf("  - %s\n", svc.Title)
			}
		}
		if photosSection != "" {
			mediaCatalog += "\nSERVICIOS/PRODUCTOS CON FOTOS DISPONIBLES:\n" + photosSection
			mediaCatalog += "\n⚠️ REGLA ABSOLUTA DE FOTOS (NO IGNORAR): Si el cliente pide ver fotos, imágenes o cómo se ve alguno de los productos/servicios de la lista anterior, tu ÚNICA respuesta permitida es exactamente:\nSEND_PHOTOS:TituloExactoDelServicio\nDonde TituloExactoDelServicio es el título tal como aparece en la lista. NO agregues explicación, emojis ni texto adicional antes o después.\n"
		}

		// Menú como archivo (PDF o imagen)
		if BusinessCfg.MenuUrl != "" {
			mediaCatalog += `
⚠️ REGLA ABSOLUTA DE MENÚ (OBLIGATORIA, NO IGNORAR):
Este negocio tiene un menú en imagen/PDF disponible.
Si el cliente pide VER el menú, la carta, fotos del menú, el PDF, o dice frases como:
"puedo ver el menú", "mándame el menú", "foto del menú", "tienen menú en foto",
"menú foto", "foto", "imagen del menú", o cualquier variación similar,
tu ÚNICA respuesta permitida es exactamente esta palabra, sin nada más:
SEND_MENU
NO listes productos. NO expliques. NO agregues texto antes ni después. Solo escribe: SEND_MENU
`
		}
	}

	// ── Catálogo del API Explorer (endpoint externo conectado por el cliente) ──
	apiExplorerCatalog := GetAPIExplorerContext(userMessage)

	// ── Construir prompt completo ─────────────────────────────────────────────
	fullPrompt := fmt.Sprintf(`%s
%s
%s
HISTORIAL DE CONVERSACIÓN:
%s

CONTEXTO ADICIONAL: %s

MENSAJE DEL CLIENTE: %s

INSTRUCCIONES:
- Responde de manera natural basándote en la información del negocio
- Máximo 3-4 líneas de respuesta
- Sé útil y directo
- Si no sabes algo, dilo claramente
- IMPORTANTE: Si el cliente pregunta qué productos, servicios, pizzas, platillos, libros o items tienen disponibles, SIEMPRE responde en formato lista con viñetas (•), NO en párrafo corrido
- Usa *nombre* para poner en negrita los nombres de productos en la lista

RESPUESTA:`,
		systemPrompt,
		mediaCatalog,
		apiExplorerCatalog,
		conversationHistory,
		promptContext,
		userMessage)

	log.Println("🚀 Enviando petición a Gemini...")
	t0Chat := time.Now()

	resp, err := geminiModel.GenerateContent(ctx, genai.Text(fullPrompt))
	chatLatency := time.Since(t0Chat)
	log.Printf("⏱️  [Chat] Gemini tardó: %dms", chatLatency.Milliseconds())

	if err != nil {
		log.Printf("❌ Error generando respuesta de Gemini: %v\n", err)
		return "", fmt.Errorf("error generando respuesta: %w", err)
	}

	if resp == nil {
		log.Println("❌ Gemini retornó respuesta nula")
		return "¿Podrías repetir eso?", nil
	}

	if len(resp.Candidates) == 0 {
		log.Println("❌ Gemini retornó 0 candidatos")
		return "¿Podrías repetir eso?", nil
	}

	var answer strings.Builder
	for _, cand := range resp.Candidates {
		if cand.Content != nil {
			for _, part := range cand.Content.Parts {
				answer.WriteString(fmt.Sprintf("%v", part))
			}
		}
	}

	result := strings.TrimSpace(answer.String())

	if len(result) > 500 {
		result = result[:450] + "..."
	}

	if result == "" {
		log.Println("❌ Gemini generó respuesta vacía")
		return "¿Podrías repetir eso?", nil
	}

	log.Printf("✅ Respuesta de Gemini generada: %s\n", result)
	return result, nil
}

// AnalyzeForAppointment analiza si el mensaje indica intención de agendamiento
func AnalyzeForAppointment(message, conversationHistory string, isCurrentlyScheduling bool) (*AppointmentAnalysis, error) {
	if !geminiEnabled {
		log.Println("⚠️  AnalyzeForAppointment: Gemini no habilitado, usando fallback")
		return fallbackAnalysis(message), nil
	}

	if geminiClient == nil {
		log.Println("❌ AnalyzeForAppointment: geminiClient es nil, usando fallback")
		return fallbackAnalysis(message), nil
	}

	log.Printf("🔍 Analizando mensaje para agendamiento: %s\n", message)

	ctx := context.Background()

	servicesInfo := ""
	if BusinessCfg != nil && len(BusinessCfg.Services) > 0 {
		servicesInfo = "SERVICIOS DISPONIBLES:\n"
		for _, service := range BusinessCfg.Services {
			servicesInfo += fmt.Sprintf("- %s\n", service.Title)
		}
	}

	workersInfo := ""
	if BusinessCfg != nil && len(BusinessCfg.Workers) > 0 {
		workersInfo = "PERSONAL DISPONIBLE:\n"
		for _, worker := range BusinessCfg.Workers {
			workersInfo += fmt.Sprintf("- %s\n", worker.Name)
		}
	}

	analysisPrompt := fmt.Sprintf(`Analiza este mensaje y extrae información de agendamiento.

%s

%s

PALABRAS CLAVE DE AGENDAMIENTO:
- agendar, cita, turno, reservar, apartar
- cuando, horario, disponible, puede

HISTORIAL:
%s

MENSAJE: "%s"

¿YA ESTÁ AGENDANDO?: %v

EXTRAE SOLO LO QUE ESTÁ EN EL MENSAJE:
- nombre (nombre completo del cliente)
- servicio (debe ser uno de los servicios listados arriba)
- barbero/trabajador (si lo menciona, debe ser uno de los listados arriba)
- fecha (DD/MM/YYYY o "mañana", "lunes", etc.)
- hora (HH:MM o "mañana", "tarde")

NO extraigas teléfonos.

RESPONDE EN JSON:
{
    "wantsToSchedule": true/false,
    "extractedData": {
        "nombre": "nombre o null",
        "servicio": "servicio o null",
        "barbero": "barbero o null",
        "fecha": "fecha o null",
        "hora": "hora o null"
    },
    "confidence": 0.0-1.0
}`,
		servicesInfo,
		workersInfo,
		conversationHistory,
		message,
		isCurrentlyScheduling)

	log.Println("🚀 Enviando análisis a Gemini...")
	t0Analyze := time.Now()

	resp, err := geminiModel.GenerateContent(ctx, genai.Text(analysisPrompt))
	analyzeLatency := time.Since(t0Analyze)
	log.Printf("⏱️  [Analyze] Gemini tardó: %dms", analyzeLatency.Milliseconds())

	if err != nil {
		log.Printf("⚠️  Error en análisis de Gemini: %v, usando fallback\n", err)
		return fallbackAnalysis(message), nil
	}

	if resp == nil || len(resp.Candidates) == 0 {
		log.Println("⚠️  Gemini no retornó candidatos en análisis, usando fallback")
		return fallbackAnalysis(message), nil
	}

	var responseText string
	for _, cand := range resp.Candidates {
		if cand.Content != nil {
			for _, part := range cand.Content.Parts {
				responseText += fmt.Sprintf("%v", part)
			}
		}
	}

	log.Printf("📄 Respuesta de análisis de Gemini:\n%s\n", responseText)

	jsonStart := strings.Index(responseText, "{")
	jsonEnd := strings.LastIndex(responseText, "}")

	if jsonStart == -1 || jsonEnd == -1 {
		log.Printf("⚠️  No se pudo extraer JSON de la respuesta, usando fallback\n")
		return fallbackAnalysis(message), nil
	}

	jsonStr := responseText[jsonStart : jsonEnd+1]
	log.Printf("📊 JSON extraído: %s\n", jsonStr)

	var analysis AppointmentAnalysis
	if err := json.Unmarshal([]byte(jsonStr), &analysis); err != nil {
		log.Printf("⚠️  Error parseando JSON: %v, usando fallback\n", err)
		log.Printf("   JSON que falló: %s\n", jsonStr)
		return fallbackAnalysis(message), nil
	}

	if analysis.ExtractedData == nil {
		analysis.ExtractedData = make(map[string]string)
	}

	log.Printf("✅ Análisis completado: wantsToSchedule=%v, confidence=%.2f, data=%v\n",
		analysis.WantsToSchedule,
		analysis.Confidence,
		analysis.ExtractedData)

	return &analysis, nil
}

// TranscribeAudio transcribe una nota de voz de WhatsApp a texto usando Gemini.
// Se usa como paso previo: el texto resultante se procesa exactamente igual que
// si el cliente lo hubiera escrito, así todos los flujos existentes (agendar,
// pedidos, cancelaciones, etc.) funcionan también cuando el cliente manda audio.
func TranscribeAudio(audioBytes []byte, mimeType string) (string, error) {
	if !geminiEnabled {
		log.Println("⚠️  TranscribeAudio llamado pero Gemini no está habilitado")
		return "", fmt.Errorf("Gemini no está habilitado")
	}

	if geminiClient == nil {
		log.Println("❌ TranscribeAudio: geminiClient es nil")
		return "", fmt.Errorf("Gemini no inicializado")
	}

	log.Printf("🎙️  Transcribiendo nota de voz con Gemini (%d bytes, %s)...\n", len(audioBytes), mimeType)

	ctx := context.Background()

	prompt := `Transcribe este audio de WhatsApp a texto, tal como lo diría la persona que habla.

REGLAS:
- Devuelve ÚNICAMENTE la transcripción del audio, sin comillas, sin explicaciones, sin comentarios adicionales.
- Transcribe en el mismo idioma en el que habla la persona.
- Si el audio no contiene voz humana entendible (silencio, puro ruido, música sin letra, etc.), responde EXACTAMENTE esto y nada más: SIN_AUDIO_VALIDO

TRANSCRIPCIÓN:`

	t0 := time.Now()
	resp, err := geminiModel.GenerateContent(ctx,
		genai.Blob{MIMEType: mimeType, Data: audioBytes},
		genai.Text(prompt),
	)
	latency := time.Since(t0)
	log.Printf("⏱️  [TranscribeAudio] Gemini tardó: %dms", latency.Milliseconds())

	if err != nil {
		log.Printf("❌ Error transcribiendo audio: %v\n", err)
		return "", fmt.Errorf("error transcribiendo audio: %w", err)
	}

	if resp == nil || len(resp.Candidates) == 0 {
		log.Println("❌ Gemini no retornó candidatos en transcripción")
		return "", fmt.Errorf("Gemini no retornó transcripción")
	}

	var sb strings.Builder
	for _, cand := range resp.Candidates {
		if cand.Content != nil {
			for _, part := range cand.Content.Parts {
				sb.WriteString(fmt.Sprintf("%v", part))
			}
		}
	}

	text := strings.TrimSpace(sb.String())

	if text == "" || strings.Contains(text, "SIN_AUDIO_VALIDO") {
		log.Println("⚠️  El audio no contiene voz entendible")
		return "", fmt.Errorf("audio sin voz entendible")
	}

	log.Printf("✅ Transcripción generada: %s\n", text)
	return text, nil
}

// AnalyzeImage analiza una imagen enviada por el cliente (ej. foto de un
// producto, de un auto, de un platillo, de un comprobante de pago, etc.)
// usando Gemini Vision y responde de forma natural comparándola contra el
// catálogo/servicios del negocio cuando aplica.
func AnalyzeImage(imageBytes []byte, mimeType, question, conversationHistory string) (string, error) {
	if !geminiEnabled {
		log.Println("⚠️  AnalyzeImage llamado pero Gemini no está habilitado")
		return "", fmt.Errorf("Gemini no está habilitado")
	}

	if geminiClient == nil {
		log.Println("❌ AnalyzeImage: geminiClient es nil")
		return "", fmt.Errorf("Gemini no inicializado")
	}

	log.Printf("🖼️  Analizando imagen con Gemini Vision (%d bytes, %s)...\n", len(imageBytes), mimeType)
	log.Printf("   💬 Pregunta/caption del cliente: %s\n", question)

	ctx := context.Background()
	systemPrompt := GetSystemPrompt()

	// Catálogo del negocio para poder comparar la imagen contra lo que se ofrece
	catalogInfo := ""
	if BusinessCfg != nil && len(BusinessCfg.Services) > 0 {
		catalogInfo = "CATÁLOGO / SERVICIOS / PRODUCTOS DEL NEGOCIO:\n"
		for _, svc := range BusinessCfg.Services {
			catalogInfo += fmt.Sprintf("- %s", svc.Title)
			if svc.Price > 0 {
				catalogInfo += fmt.Sprintf(" ($%.0f MXN)", svc.Price)
			}
			catalogInfo += "\n"
		}
	}

	fullPrompt := fmt.Sprintf(`%s
%s
HISTORIAL DE CONVERSACIÓN:
%s

El cliente envió una imagen y escribió junto a ella: "%s"

INSTRUCCIONES:
- Observa la imagen con atención. Puede ser un producto, un vehículo, un platillo, un comprobante de pago, una foto de referencia, etc.
- Si el cliente pregunta si tienes ese producto/artículo/vehículo/platillo, compara lo que ves en la imagen contra el catálogo del negocio y responde con honestidad: di si tienes exactamente eso, algo similar, o si no lo manejas.
- Si mencionas una coincidencia, usa el nombre EXACTO tal como aparece en el catálogo.
- Si no hay forma de saber con certeza si hay coincidencia exacta, dilo claramente y ofrece la opción más parecida.
- NUNCA inventes productos, modelos o servicios que no estén en el catálogo.
- Máximo 3-4 líneas de respuesta.
- Sé natural, directo y útil, en el mismo tono del negocio.

RESPUESTA:`,
		systemPrompt,
		catalogInfo,
		conversationHistory,
		question)

	t0 := time.Now()
	resp, err := geminiModel.GenerateContent(ctx,
		genai.Blob{MIMEType: mimeType, Data: imageBytes},
		genai.Text(fullPrompt),
	)
	latency := time.Since(t0)
	log.Printf("⏱️  [AnalyzeImage] Gemini tardó: %dms", latency.Milliseconds())

	if err != nil {
		log.Printf("❌ Error analizando imagen: %v\n", err)
		return "", fmt.Errorf("error analizando imagen: %w", err)
	}

	if resp == nil || len(resp.Candidates) == 0 {
		log.Println("❌ Gemini no retornó candidatos en análisis de imagen")
		return "", fmt.Errorf("Gemini no retornó análisis de imagen")
	}

	var sb strings.Builder
	for _, cand := range resp.Candidates {
		if cand.Content != nil {
			for _, part := range cand.Content.Parts {
				sb.WriteString(fmt.Sprintf("%v", part))
			}
		}
	}

	result := strings.TrimSpace(sb.String())

	if len(result) > 500 {
		result = result[:450] + "..."
	}

	if result == "" {
		log.Println("❌ Gemini generó respuesta vacía para la imagen")
		return "Recibí tu imagen, pero no logré identificar bien de qué se trata. ¿Puedes contarme un poco más? 🙂", nil
	}

	log.Printf("✅ Análisis de imagen generado: %s\n", result)
	return result, nil
}

// fallbackAnalysis análisis simple sin Gemini
func fallbackAnalysis(message string) *AppointmentAnalysis {
	log.Println("🔄 Usando análisis fallback (sin Gemini)")

	lowerMessage := strings.ToLower(message)
	keywords := []string{"cita", "agendar", "turno", "reservar", "apartar"}

	wantsToSchedule := false
	for _, keyword := range keywords {
		if strings.Contains(lowerMessage, keyword) {
			wantsToSchedule = true
			log.Printf("   ✅ Palabra clave encontrada: %s\n", keyword)
			break
		}
	}

	result := &AppointmentAnalysis{
		WantsToSchedule: wantsToSchedule,
		ExtractedData:   make(map[string]string),
		Confidence:      0.6,
	}

	log.Printf("   📊 Resultado fallback: wantsToSchedule=%v\n", wantsToSchedule)
	return result
}

// CheckGeminiHealth verifica que Gemini esté funcionando
func CheckGeminiHealth() bool {
	if !geminiEnabled {
		log.Println("⚠️  CheckGeminiHealth: Gemini no está habilitado")
		return false
	}

	if geminiClient == nil {
		log.Println("❌ CheckGeminiHealth: geminiClient es nil")
		return false
	}

	log.Println("🏥 Verificando salud de Gemini...")

	ctx := context.Background()
	resp, err := geminiModel.GenerateContent(ctx, genai.Text("test"))

	if err != nil {
		log.Printf("❌ Health check falló: %v\n", err)
		return false
	}

	if resp == nil || len(resp.Candidates) == 0 {
		log.Println("❌ Health check: sin respuesta")
		return false
	}

	log.Println("✅ Gemini está funcionando correctamente")
	return true
}

// GenerateWelcomeMessage genera un mensaje de bienvenida personalizado
func GenerateWelcomeMessage() string {
	if BusinessCfg == nil {
		log.Println("⚠️  BusinessCfg es nil, usando mensaje genérico")
		return "¡Hola! ¿En qué puedo ayudarte hoy?"
	}

	if geminiEnabled && geminiClient != nil {
		log.Println("💬 Generando mensaje de bienvenida con Gemini...")

		ctx := context.Background()
		var prompt string
		if isPizzeriaMode() {
			prompt = fmt.Sprintf(`Genera un mensaje de bienvenida MUY BREVE (1-2 líneas máximo) para %s, un negocio tipo %s.

Reglas ESTRICTAS:
- Solo saludo + invitación a pedir o preguntar por el menú/catálogo
- NO listes productos ni precios
- NO uses párrafos largos
- Usa UN emoji acorde al tipo de negocio (ej: 📚 para librería, 🍕 para pizzería, 🐟 para pescadería, 🥐 para panadería)
- NO uses 🍔 si no es hamburguesas
- Tono: %s

RESPONDE SOLO CON EL MENSAJE, SIN EXPLICACIONES.`,
				BusinessCfg.AgentName,
				BusinessCfg.BusinessType,
				BusinessCfg.Personality.Tone)
		} else {
			prompt = fmt.Sprintf(`Genera un mensaje de bienvenida breve (2-3 líneas) para %s, un %s.

Incluye:
- Saludo amigable
- Mención de que pueden preguntar sobre servicios, horarios o agendar cita
- Un emoji apropiado

Tono: %s

RESPONDE SOLO CON EL MENSAJE, SIN EXPLICACIONES.`,
				BusinessCfg.AgentName,
				BusinessCfg.BusinessType,
				BusinessCfg.Personality.Tone)
		}

		resp, err := geminiModel.GenerateContent(ctx, genai.Text(prompt))
		if err == nil && resp != nil && len(resp.Candidates) > 0 {
			var msg strings.Builder
			for _, cand := range resp.Candidates {
				if cand.Content != nil {
					for _, part := range cand.Content.Parts {
						msg.WriteString(fmt.Sprintf("%v", part))
					}
				}
			}
			if msg.Len() > 0 {
				result := strings.TrimSpace(msg.String())
				log.Printf("✅ Mensaje de bienvenida generado: %s\n", result)
				return result
			}
		} else {
			log.Printf("⚠️  Error generando mensaje de bienvenida: %v\n", err)
		}
	} else {
		log.Println("⚠️  Gemini no disponible para generar mensaje de bienvenida")
	}

	var defaultMsg string
	if isPizzeriaMode() {
		defaultMsg = fmt.Sprintf("¡Hola! Bienvenido a %s 👋\n\nPuedes ver nuestro menú o hacer tu pedido directamente. ¿Qué se te antoja hoy? 😋",
			BusinessCfg.AgentName)
	} else {
		defaultMsg = fmt.Sprintf("¡Hola! Bienvenido a %s 👋\n\nPuedo ayudarte con información sobre nuestros servicios, horarios o agendar una cita. ¿En qué te puedo ayudar?",
			BusinessCfg.AgentName)
	}

	log.Printf("📝 Usando mensaje de bienvenida por defecto\n")
	return defaultMsg
}
