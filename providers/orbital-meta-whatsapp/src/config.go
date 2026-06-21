package src

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"sync"
)

// ─────────────────────────────────────────────
//   ESTRUCTURAS COMPLETAS (sincronizadas con AtomicBot)
// ─────────────────────────────────────────────

// Personality configuración de personalidad del agente
type Personality struct {
	Tone        string `json:"tone"`
	Style       string `json:"style"`
	Language    string `json:"language"`
	CustomRules string `json:"customRules"`
}

// DaySchedule horario de un día específico
type DaySchedule struct {
	Open  string `json:"open"`
	Close string `json:"close"`
}

// Schedule horario semanal del negocio
type Schedule struct {
	Monday    *DaySchedule `json:"monday"`
	Tuesday   *DaySchedule `json:"tuesday"`
	Wednesday *DaySchedule `json:"wednesday"`
	Thursday  *DaySchedule `json:"thursday"`
	Friday    *DaySchedule `json:"friday"`
	Saturday  *DaySchedule `json:"saturday"`
	Sunday    *DaySchedule `json:"sunday"`
}

// Holiday día festivo o de cierre especial
type Holiday struct {
	Date        string `json:"date"`
	Description string `json:"description"`
}

// Service representa un servicio ofrecido por el negocio
type Service struct {
	Title       string  `json:"title"`
	Description string  `json:"description"`
	Duration    int     `json:"duration"` // en minutos
	Price       float64 `json:"price"`
}

// Worker representa un trabajador/empleado del negocio
type Worker struct {
	Name        string `json:"name"`
	Specialty   string `json:"specialty"`
	Description string `json:"description"`
}

// Location información de ubicación del negocio
type Location struct {
	Address       string `json:"address"`
	GoogleMapsURL string `json:"googleMapsUrl"`
	City          string `json:"city"`
	State         string `json:"state"`
	Instructions  string `json:"instructions"`
}

// SocialMedia redes sociales del negocio
type SocialMedia struct {
	Instagram string `json:"instagram"`
	Facebook  string `json:"facebook"`
	TikTok    string `json:"tiktok"`
	Twitter   string `json:"twitter"`
	Website   string `json:"website"`
}

// BusinessConfig contiene la configuración completa del negocio
type BusinessConfig struct {
	// Identificación
	AgentName    string `json:"agentName"`
	BusinessType string `json:"businessType"`
	PhoneNumber  string `json:"phoneNumber"`
	Timezone     string `json:"timezone"`

	// Personalidad del agente
	Personality Personality `json:"personality"`

	// Horarios
	Schedule Schedule  `json:"schedule"`
	Holidays []Holiday `json:"holidays"`

	// Servicios y personal
	Services []Service `json:"services"`
	Workers  []Worker  `json:"workers"`

	// Ubicación
	Location Location `json:"location"`

	// Redes sociales
	SocialMedia SocialMedia `json:"socialMedia"`

	// Campos legacy para compatibilidad con código existente
	Address                    string `json:"address"`
	BusinessHours              string `json:"business_hours"`
	GoogleMapsLink             string `json:"google_maps_link"`
	DefaultAppointmentDuration int    `json:"default_appointment_duration"`
	WelcomeMessage             string `json:"welcome_message"`
	AutoResponseEnabled        bool   `json:"auto_response_enabled"`
}

var (
	businessConfig *BusinessConfig
	configMutex    sync.RWMutex
	BusinessCfg    *BusinessConfig // Exportada para uso en main.go y otros archivos
)

// LoadBusinessConfig carga la configuración del negocio desde JSON
func LoadBusinessConfig() error {
	filePath := os.Getenv("BUSINESS_CONFIG_FILE")
	if filePath == "" {
		filePath = "business_config.json"
	}
	log.Printf("📂 Cargando configuración desde: %s", filePath)

	file, err := os.ReadFile(filePath)
	if err != nil {
		return fmt.Errorf("error leyendo archivo de configuración: %w", err)
	}

	var config BusinessConfig
	if err := json.Unmarshal(file, &config); err != nil {
		return fmt.Errorf("error parseando JSON: %w", err)
	}

	// Compatibilidad: si address está en Location pero no en legacy, copiar
	if config.Address == "" && config.Location.Address != "" {
		config.Address = config.Location.Address
	}
	if config.GoogleMapsLink == "" && config.Location.GoogleMapsURL != "" {
		config.GoogleMapsLink = config.Location.GoogleMapsURL
	}

	configMutex.Lock()
	businessConfig = &config
	BusinessCfg = &config
	configMutex.Unlock()

	log.Println("✅ Configuración del negocio cargada:")
	log.Printf("   📛 Nombre: %s", config.AgentName)
	log.Printf("   🏪 Tipo: %s", config.BusinessType)
	log.Printf("   📞 Teléfono: %s", config.PhoneNumber)
	log.Printf("   💼 Servicios: %d configurados", len(config.Services))
	log.Printf("   👥 Trabajadores: %d configurados", len(config.Workers))
	log.Printf("   🤖 Tono: %s", config.Personality.Tone)

	return nil
}

// GetBusinessConfig obtiene la configuración actual (thread-safe)
func GetBusinessConfig() *BusinessConfig {
	configMutex.RLock()
	defer configMutex.RUnlock()
	return businessConfig
}

// SetBusinessConfig establece una nueva configuración (thread-safe)
func SetBusinessConfig(config *BusinessConfig) {
	configMutex.Lock()
	businessConfig = config
	BusinessCfg = config
	configMutex.Unlock()
	log.Println("✅ Configuración del negocio actualizada")
}

// ReloadBusinessConfig recarga la configuración desde el archivo
func ReloadBusinessConfig() error {
	log.Println("🔄 Recargando configuración del negocio...")
	if err := LoadBusinessConfig(); err != nil {
		return err
	}
	log.Println("✅ Configuración recargada exitosamente")
	return nil
}

// GetTimezone retorna la zona horaria configurada con fallback
func GetTimezone() string {
	if businessConfig != nil && businessConfig.Timezone != "" {
		return businessConfig.Timezone
	}
	return "America/Hermosillo"
}

// ─────────────────────────────────────────────
//   HORARIOS (calculados desde Schedule del negocio)
// ─────────────────────────────────────────────

// HORARIOS lista de horarios disponibles del negocio
var HORARIOS = []string{
	"9:00 AM", "9:30 AM",
	"10:00 AM", "10:30 AM",
	"11:00 AM", "11:30 AM",
	"12:00 PM", "12:30 PM",
	"1:00 PM", "1:30 PM",
	"2:00 PM", "2:30 PM",
	"3:00 PM", "3:30 PM",
	"4:00 PM", "4:30 PM",
	"5:00 PM", "5:30 PM",
	"6:00 PM", "6:30 PM",
	"7:00 PM",
}

// getHorarios retorna los horarios disponibles del negocio (calculados desde config o fallback)
func getHorarios() []string {
	if businessConfig != nil {
		// Si hay Schedule configurado, generar horarios dinámicamente
		// (por simplicidad usamos HORARIOS fijo por ahora)
		return HORARIOS
	}
	return HORARIOS
}

// COLUMNAS_DIAS mapeo de día de la semana a columna de Sheets
var COLUMNAS_DIAS = map[string]string{
	"lunes":     "B",
	"martes":    "C",
	"miércoles": "D",
	"miercoles": "D",
	"jueves":    "E",
	"viernes":   "F",
	"sábado":    "G",
	"sabado":    "G",
	"domingo":   "H",
}

// GetFilaHora obtiene el número de fila en Sheets para una hora dada
func GetFilaHora(hora string) int {
	for i, h := range HORARIOS {
		if h == hora {
			return i + 2 // Fila 2 = primer horario (fila 1 es encabezado)
		}
	}
	return -1
}

// ─────────────────────────────────────────────
//   PROMPTS DEL SISTEMA (para Gemini)
// ─────────────────────────────────────────────

// GetBusinessInfoPrompt genera el prompt con información del negocio
func GetBusinessInfoPrompt() string {
	if businessConfig == nil {
		return "Eres un asistente virtual de un negocio."
	}

	var info string
	info += fmt.Sprintf("NEGOCIO: %s\n", businessConfig.AgentName)
	info += fmt.Sprintf("TIPO: %s\n", businessConfig.BusinessType)

	if businessConfig.Address != "" {
		info += fmt.Sprintf("DIRECCIÓN: %s\n", businessConfig.Address)
	} else if businessConfig.Location.Address != "" {
		info += fmt.Sprintf("DIRECCIÓN: %s\n", businessConfig.Location.Address)
	}

	if businessConfig.BusinessHours != "" {
		info += fmt.Sprintf("HORARIOS: %s\n", businessConfig.BusinessHours)
	}

	if len(businessConfig.Services) > 0 {
		info += "\nSERVICIOS:\n"
		for _, s := range businessConfig.Services {
			if s.Price > 0 {
				info += fmt.Sprintf("  - %s: $%.0f\n", s.Title, s.Price)
			} else {
				info += fmt.Sprintf("  - %s\n", s.Title)
			}
		}
	}

	if len(businessConfig.Workers) > 0 {
		info += "\nPERSONAL:\n"
		for _, w := range businessConfig.Workers {
			info += fmt.Sprintf("  - %s", w.Name)
			if w.Specialty != "" {
				info += fmt.Sprintf(" (%s)", w.Specialty)
			}
			info += "\n"
		}
	}

	if businessConfig.SocialMedia.Instagram != "" {
		info += fmt.Sprintf("INSTAGRAM: %s\n", businessConfig.SocialMedia.Instagram)
	}

	return info
}

// GetPersonalityPrompt genera el prompt de personalidad del agente
func GetPersonalityPrompt() string {
	if businessConfig == nil {
		return "Eres un asistente virtual amigable y profesional."
	}

	tone := businessConfig.Personality.Tone
	if tone == "" {
		tone = "amigable y profesional"
	}

	style := businessConfig.Personality.Style
	if style == "" {
		style = "conversacional"
	}

	prompt := fmt.Sprintf("Eres el asistente virtual de %s. Tu tono es %s y tu estilo es %s.",
		businessConfig.AgentName, tone, style)

	if businessConfig.Personality.CustomRules != "" {
		prompt += fmt.Sprintf(" %s", businessConfig.Personality.CustomRules)
	}

	return prompt
}

// GetSystemPrompt genera el prompt completo del sistema
func GetSystemPrompt() string {
	personalityPrompt := GetPersonalityPrompt()
	businessInfo := GetBusinessInfoPrompt()

	return fmt.Sprintf(`%s

INFORMACIÓN DEL NEGOCIO:
%s

INSTRUCCIONES:
- Responde SIEMPRE en español
- Sé conciso (máximo 3-4 líneas por respuesta)
- Si el cliente quiere agendar, ayúdalo a recopilar: nombre, servicio, fecha y hora
- Si preguntan por precios o servicios, muestra la información disponible
- Si preguntan por ubicación, proporciona la dirección
- No inventes información que no esté en los datos del negocio`,
		personalityPrompt,
		businessInfo,
	)
}

// ─────────────────────────────────────────────
//   HELPERS DE COMPATIBILIDAD
// ─────────────────────────────────────────────

// ValidateConfig valida que la configuración sea válida
func ValidateConfig(config *BusinessConfig) error {
	if config.AgentName == "" {
		return fmt.Errorf("el nombre del negocio no puede estar vacío")
	}
	if len(config.Services) == 0 {
		log.Println("⚠️  Advertencia: No hay servicios configurados")
	}
	return nil
}

// GetServiceByName busca un servicio por nombre (compatibilidad)
func GetServiceByName(name string) (*Service, error) {
	config := GetBusinessConfig()
	if config == nil {
		return nil, fmt.Errorf("configuración no cargada")
	}
	for _, service := range config.Services {
		if service.Title == name {
			return &service, nil
		}
	}
	return nil, fmt.Errorf("servicio no encontrado: %s", name)
}
