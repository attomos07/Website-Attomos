package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"orbital-meta-whatsapp/src"

	"github.com/joho/godotenv"
	_ "github.com/mattn/go-sqlite3"
)

func main() {
	// Configurar logs con timestamps
	log.SetFlags(log.Ldate | log.Ltime | log.Lmicroseconds)
	log.SetOutput(os.Stdout)

	printBanner()

	// Cargar variables de entorno
	log.Println("📋 Cargando configuración...")
	if err := godotenv.Load(); err != nil {
		log.Println("ℹ️  Archivo .env no encontrado, usando variables de entorno del sistema")
	} else {
		log.Println("✅ Archivo .env cargado correctamente")
	}
	log.Println("")

	// Cargar configuración del negocio
	log.Println("🏢 Cargando configuración del negocio...")
	if err := src.LoadBusinessConfig(); err != nil {
		log.Printf("⚠️  Error cargando business_config.json: %v\n", err)
		log.Println("💡 El bot continuará con configuración por defecto")
	} else {
		log.Println("✅ Configuración del negocio cargada correctamente")
		if src.BusinessCfg != nil {
			log.Printf("   📝 Negocio: %s\n", src.BusinessCfg.AgentName)
			log.Printf("   🏪 Tipo: %s\n", src.BusinessCfg.BusinessType)
		}
	}
	log.Println("")

	// Mostrar estado de configuración
	showConfigurationStatus()

	// Inicializar servicios
	log.Println("")
	log.Println("╔══════════════════════════════════════════════════════╗")
	log.Println("║                                                      ║")
	log.Println("║              INICIALIZANDO SERVICIOS                 ║")
	log.Println("║                                                      ║")
	log.Println("╚══════════════════════════════════════════════════════╝")
	log.Println("")

	// Inicializar Gemini AI
	geminiStatus := "❌ No disponible"
	log.Println("🤖 Inicializando Gemini AI...")
	if err := src.InitGemini(); err != nil {
		log.Printf("⚠️  Gemini AI no disponible: %v\n", err)
		log.Println("💡 El bot funcionará con respuestas básicas (sin IA)")
	} else {
		geminiStatus = "✅ Conectado"
		log.Println("✅ Gemini AI inicializado correctamente")
	}

	// Inicializar Google Sheets
	sheetsStatus := "❌ No disponible"
	sheetsErr := src.InitSheets()
	if sheetsErr != nil {
		log.Printf("❌ Google Sheets NO disponible: %v\n", sheetsErr)
		log.Println("💡 Las citas NO se guardarán en Sheets")
		sheetsStatus = "❌ No disponible"
	} else {
		sheetsStatus = "✅ Conectado"
		log.Println("✅ Google Sheets disponible")
	}

	// Inicializar Google Calendar
	calendarStatus := "❌ No disponible"
	calendarErr := src.InitCalendar()
	if calendarErr != nil {
		log.Printf("❌ Google Calendar NO disponible: %v\n", calendarErr)
		log.Println("💡 Las citas NO se crearán en Calendar")
		calendarStatus = "❌ No disponible"
	} else {
		calendarStatus = "✅ Conectado"
		log.Println("✅ Google Calendar disponible")
	}

	// Cargar configuración de pagos del bot (SPEI + Stripe Connect)
	log.Println("💳 Cargando configuración de pagos...")
	if err := src.LoadPaymentConfig(); err != nil {
		log.Printf("⚠️  Pagos no disponibles: %v\n", err)
	} else if src.HasPaymentMethods() {
		log.Println("✅ Métodos de pago configurados")
	} else {
		log.Println("ℹ️  No hay métodos de pago configurados en este negocio")
	}

	// Iniciar watchdog para recargar configuración
	go configWatchdog()

	// Inicializar Meta WhatsApp Client
	log.Println("\n📱 Inicializando Meta WhatsApp Client...")
	log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

	ctx := context.Background()
	client, err := src.NewMetaClient(ctx)
	if err != nil {
		log.Fatalf("❌ Error inicializando Meta Client: %v", err)
	}

	// Configurar cliente global
	src.SetClient(client)

	// Verificar estado de Meta
	metaStatus := "⚠️  Esperando credenciales"
	if client.IsConfigured() {
		metaStatus = "✅ Configurado"
	}

	// Iniciar webhook server
	log.Println("\n🌐 Iniciando servidor webhook...")
	go src.StartWebhookServer(client)

	// Mostrar estado final
	printFinalStatus(geminiStatus, sheetsStatus, calendarStatus, metaStatus)

	// Crear calendario semanal si está habilitado
	if src.IsSheetsEnabled() {
		log.Println("\n📅 Configurando calendario semanal...")
		if err := src.InitializeWeeklyCalendar(); err != nil {
			log.Printf("⚠️  No se pudo inicializar calendario semanal: %v\n", err)
		} else {
			log.Println("✅ Calendario semanal configurado")
		}
	}

	// Mantener el programa corriendo
	c := make(chan os.Signal, 1)
	signal.Notify(c, os.Interrupt, syscall.SIGTERM)
	<-c

	fmt.Println("\n👋 Deteniendo bot...")
	client.Close()
}

// Banner del bot
func printBanner() {
	banner := `
╔═══════════════════════════════════════════════════════╗
║                                                       ║
║      🚀 OrbitalBot WhatsApp - Attomos Edition        ║
║                                                       ║
║      Bot Inteligente con Meta Business API           ║
║                                                       ║
╚═══════════════════════════════════════════════════════╝
`
	fmt.Println(banner)
}

// Mostrar estado de configuración
func showConfigurationStatus() {
	log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
	log.Println("📊 VERIFICACIÓN DE ARCHIVOS")
	log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

	// Verificar .env
	if _, err := os.Stat(".env"); err == nil {
		log.Println("✅ Archivo .env: Encontrado")
	} else {
		log.Println("⚠️  Archivo .env: No encontrado")
		log.Println("   💡 Crea un archivo .env para configurar el bot")
	}

	// Verificar google.json
	if info, err := os.Stat("google.json"); err == nil {
		log.Printf("✅ Archivo google.json: Encontrado (%d bytes)\n", info.Size())
	} else {
		log.Println("⚠️  Archivo google.json: No encontrado")
		log.Println("   💡 Necesario para Google Sheets y Calendar")
	}

	// Verificar business_config.json
	if info, err := os.Stat("business_config.json"); err == nil {
		log.Printf("✅ Archivo business_config.json: Encontrado (%d bytes)\n", info.Size())
	} else {
		log.Println("⚠️  Archivo business_config.json: No encontrado")
	}

	log.Println("")
	log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
	log.Println("🔑 VARIABLES DE ENTORNO")
	log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

	// Verificar variables de entorno
	vars := map[string]string{
		"AGENT_ID":             "ID del Agente",
		"META_ACCESS_TOKEN":    "Meta Access Token",
		"META_PHONE_NUMBER_ID": "Meta Phone Number ID",
		"META_WABA_ID":         "Meta WABA ID",
		"WEBHOOK_VERIFY_TOKEN": "Webhook Verify Token",
		"PORT":                 "Puerto del Webhook",
		"GEMINI_API_KEY":       "Gemini AI",
		"SPREADSHEETID":        "Google Sheets",
		"GOOGLE_CALENDAR_ID":   "Google Calendar",
	}

	for env, description := range vars {
		value := os.Getenv(env)
		if value != "" {
			masked := maskValue(value)
			log.Printf("✅ %-25s: %s (%s)\n", env, masked, description)
		} else {
			log.Printf("⚠️  %-25s: No configurada (%s)\n", env, description)
		}
	}
}

// Enmascarar valores sensibles
func maskValue(value string) string {
	if len(value) <= 8 {
		return "***"
	}
	return value[:4] + "..." + value[len(value)-4:]
}

// Mostrar estado final
func printFinalStatus(gemini, sheets, calendar, meta string) {
	fmt.Println("\n╔═══════════════════════════════════════════════════════╗")

	if meta == "✅ Configurado" {
		fmt.Println("║           ✅ BOT CONECTADO EXITOSAMENTE               ║")
	} else {
		fmt.Println("║          ⚠️  BOT EN MODO ESPERA                       ║")
	}

	fmt.Println("╚═══════════════════════════════════════════════════════╝")

	if src.BusinessCfg != nil {
		fmt.Printf("\n🏢 Negocio: %s\n", src.BusinessCfg.AgentName)
		fmt.Printf("📱 Tipo: %s\n", src.BusinessCfg.BusinessType)
	}

	fmt.Println("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
	fmt.Println("📊 ESTADO DE SERVICIOS")
	fmt.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
	fmt.Printf("🧠 Gemini AI:        %s\n", gemini)
	fmt.Printf("📊 Google Sheets:    %s\n", sheets)
	fmt.Printf("📅 Google Calendar:  %s\n", calendar)
	fmt.Printf("🚀 Meta API:         %s\n", meta)
	fmt.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

	if meta == "⚠️  Esperando credenciales" {
		fmt.Println("\n╔═══════════════════════════════════════════════════════╗")
		fmt.Println("║              ⚠️  ACCIÓN REQUERIDA                     ║")
		fmt.Println("╚═══════════════════════════════════════════════════════╝")
		fmt.Println("")
		fmt.Println("🔧 El bot está esperando credenciales de Meta WhatsApp")
		fmt.Println("")
		fmt.Println("📋 Para activar el bot:")
		fmt.Println("   1. Ve a Attomos → Integraciones")
		fmt.Println("   2. Selecciona este agente")
		fmt.Println("   3. Configura las credenciales de Meta WhatsApp")
		fmt.Println("")
		fmt.Println("🔗 Obtén tus credenciales en:")
		fmt.Println("   https://developers.facebook.com/apps")
		fmt.Println("")
		fmt.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
	}

	// Advertencias si hay servicios deshabilitados
	if sheets == "❌ No disponible" || calendar == "❌ No disponible" {
		fmt.Println("\n⚠️  ADVERTENCIA:")
		if sheets == "❌ No disponible" {
			fmt.Println("   📊 Google Sheets deshabilitado - Las citas NO se guardarán")
		}
		if calendar == "❌ No disponible" {
			fmt.Println("   📅 Google Calendar deshabilitado - Los eventos NO se crearán")
		}
		fmt.Println("\n💡 SOLUCIÓN:")
		fmt.Println("   1. Verifica que google.json exista y tenga credenciales válidas")
		fmt.Println("   2. Verifica que SPREADSHEETID y GOOGLE_CALENDAR_ID estén en .env")
		fmt.Println("   3. Verifica que el token no esté expirado")
		fmt.Println("   4. Revisa los logs arriba para más detalles")
	}

	if meta == "✅ Configurado" {
		fmt.Println("\n📱 Esperando mensajes de WhatsApp vía Meta API...")
	} else {
		fmt.Println("\n⏳ Servidor webhook activo - Esperando credenciales...")
	}

	fmt.Println("🌐 Webhook activo en el puerto configurado")
	fmt.Println("💡 Presiona Ctrl+C para detener el bot")
}

// Watchdog para recargar configuración automáticamente
func configWatchdog() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	lastEnvMod := getFileModTime(".env")
	lastGoogleMod := getFileModTime("google.json")
	lastConfigMod := getFileModTime("business_config.json")

	for range ticker.C {
		// Verificar si business_config.json cambió
		currentConfigMod := getFileModTime("business_config.json")
		if currentConfigMod != lastConfigMod {
			log.Println("\n🔄 Detectado cambio en business_config.json, recargando...")
			if err := src.LoadBusinessConfig(); err == nil {
				log.Println("✅ Configuración del negocio recargada")
			}
			lastConfigMod = currentConfigMod
		}

		// Verificar si .env cambió
		currentEnvMod := getFileModTime(".env")
		if currentEnvMod != lastEnvMod {
			log.Println("\n🔄 Detectado cambio en .env, recargando configuración...")
			if err := godotenv.Load(); err == nil {
				log.Println("✅ Configuración recargada")

				if !src.IsGeminiEnabled() {
					if err := src.InitGemini(); err == nil {
						log.Println("✅ Gemini AI ahora está disponible")
					}
				}

				if !src.IsSheetsEnabled() {
					if err := src.InitSheets(); err == nil {
						log.Println("✅ Google Sheets ahora está disponible")
					}
				}

				if !src.IsCalendarEnabled() {
					if err := src.InitCalendar(); err == nil {
						log.Println("✅ Google Calendar ahora está disponible")
					}
				}

				// Verificar si ahora hay credenciales de Meta
				client := src.GetClient()
				if client != nil && !client.IsConfigured() {
					ctx := context.Background()
					newClient, err := src.NewMetaClient(ctx)
					if err == nil && newClient.IsConfigured() {
						src.SetClient(newClient)
						log.Println("✅ Credenciales de Meta detectadas - Bot ahora activo")
					}
				}
			}
			lastEnvMod = currentEnvMod
		}

		// Verificar si google.json cambió
		currentGoogleMod := getFileModTime("google.json")
		if currentGoogleMod != lastGoogleMod {
			log.Println("\n🔄 Detectado cambio en google.json, recargando servicios...")

			if !src.IsSheetsEnabled() {
				if err := src.InitSheets(); err == nil {
					log.Println("✅ Google Sheets ahora está disponible")
				}
			}

			if !src.IsCalendarEnabled() {
				if err := src.InitCalendar(); err == nil {
					log.Println("✅ Google Calendar ahora está disponible")
				}
			}

			lastGoogleMod = currentGoogleMod
		}
	}
}

// Obtener tiempo de modificación de archivo
func getFileModTime(filename string) time.Time {
	info, err := os.Stat(filename)
	if err != nil {
		return time.Time{}
	}
	return info.ModTime()
}
