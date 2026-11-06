package src

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"

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

	// Validar formato de API Key
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

	// Configurar parámetros del modelo
	geminiModel.SetTemperature(0.7)
	geminiModel.SetMaxOutputTokens(1024)
	geminiModel.SetTopP(0.9)
	geminiModel.SetTopK(40)

	// Hacer una prueba rápida
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

// Chat función principal para chatear con Gemini usando configuración dinámica del negocio
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

	// Obtener el prompt del sistema desde la configuración del negocio
	systemPrompt := GetSystemPrompt()

	// Construir prompt completo
	fullPrompt := fmt.Sprintf(`%s

HISTORIAL DE CONVERSACIÓN:
%s

CONTEXTO ADICIONAL: %s

MENSAJE DEL CLIENTE: %s

INSTRUCCIONES:
- Responde de manera natural basándote en la información del negocio
- Máximo 3-4 líneas de respuesta
- Sé útil y directo
- Si no sabes algo, dilo claramente

RESPUESTA:`,
		systemPrompt,
		conversationHistory,
		promptContext,
		userMessage)

	log.Println("🚀 Enviando petición a Gemini...")

	resp, err := geminiModel.GenerateContent(ctx, genai.Text(fullPrompt))
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

// GenerateResponse genera una respuesta usando Gemini (alias de compatibilidad)
func GenerateResponse(prompt string) (string, error) {
	return Chat("respuesta directa", prompt, "")
}

// GenerateSmartResponse genera respuesta inteligente con contexto del negocio (alias de compatibilidad)
func GenerateSmartResponse(message, senderName, businessContext string) (string, error) {
	return Chat(businessContext, message, "")
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

	// Obtener servicios disponibles
	servicesInfo := ""
	if BusinessCfg != nil && len(BusinessCfg.Services) > 0 {
		servicesInfo = "SERVICIOS DISPONIBLES:\n"
		for _, service := range BusinessCfg.Services {
			servicesInfo += fmt.Sprintf("- %s\n", service.Title)
		}
	}

	// Obtener trabajadores disponibles
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

	resp, err := geminiModel.GenerateContent(ctx, genai.Text(analysisPrompt))
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
		prompt := fmt.Sprintf(`Genera un mensaje de bienvenida breve (2-3 líneas) para %s, un %s.

Incluye:
- Saludo amigable
- Mención de que pueden preguntar sobre servicios, horarios o agendar cita
- Un emoji apropiado

Tono: %s

RESPONDE SOLO CON EL MENSAJE, SIN EXPLICACIONES.`,
			BusinessCfg.AgentName,
			BusinessCfg.BusinessType,
			BusinessCfg.Personality.Tone)

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

	defaultMsg := fmt.Sprintf("¡Hola! Bienvenido a %s 👋\n\nPuedo ayudarte con información sobre nuestros servicios, horarios o agendar una cita. ¿En qué te puedo ayudar?",
		BusinessCfg.AgentName)

	log.Printf("📝 Usando mensaje de bienvenida por defecto\n")
	return defaultMsg
}

// CloseGemini cierra el cliente de Gemini
func CloseGemini() {
	if geminiClient != nil {
		geminiClient.Close()
		log.Println("👋 Cliente Gemini cerrado")
	}
}
