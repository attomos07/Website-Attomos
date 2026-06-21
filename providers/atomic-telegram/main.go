package main

import (
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"atomic-telegram/src"

	tgbotapi "github.com/go-telegram-bot-api/telegram-bot-api/v5"
	"github.com/joho/godotenv"
)

func main() {
	log.SetFlags(log.Ldate | log.Ltime | log.Lmicroseconds)
	log.SetOutput(os.Stdout)

	printBanner()

	// Cargar variables de entorno
	log.Println("📋 Cargando configuración...")
	if err := godotenv.Load(); err != nil {
		log.Println("ℹ️  Archivo .env no encontrado, usando variables del sistema")
	} else {
		log.Println("✅ Archivo .env cargado")
	}

	// Cargar configuración del negocio
	log.Println("🏢 Cargando configuración del negocio...")
	if err := src.LoadBusinessConfig(); err != nil {
		log.Printf("⚠️  Error cargando business_config.json: %v", err)
		log.Println("💡 El bot continuará con configuración por defecto")
	} else {
		log.Println("✅ Configuración del negocio cargada")
		if src.BusinessCfg != nil {
			log.Printf("   📝 Negocio: %s", src.BusinessCfg.AgentName)
			log.Printf("   🏪 Tipo: %s", src.BusinessCfg.BusinessType)
		}
	}

	// ── Inicializar servicios ──────────────────────────────────────────────
	log.Println("")
	log.Println("╔══════════════════════════════════════════════════════╗")
	log.Println("║              INICIALIZANDO SERVICIOS                 ║")
	log.Println("╚══════════════════════════════════════════════════════╝")

	// Gemini AI
	geminiStatus := "❌ No disponible"
	if err := src.InitGemini(); err != nil {
		log.Printf("⚠️  Gemini no disponible: %v", err)
	} else {
		geminiStatus = "✅ Conectado"
	}

	// Google Sheets
	sheetsStatus := "❌ No disponible"
	if err := src.InitSheets(); err != nil {
		log.Printf("⚠️  Google Sheets no disponible: %v", err)
	} else {
		sheetsStatus = "✅ Conectado"
	}

	// Modo gubernamental
	if src.IsAgencyMode() {
		log.Println("🏛️  Modo gubernamental — inicializando AgencyBot...")
		if err := src.InitAgencyBot(); err != nil {
			log.Printf("⚠️  AgencyBot: %v", err)
		}
	}

	// Google Calendar
	calendarStatus := "❌ No disponible"
	if err := src.InitCalendar(); err != nil {
		log.Printf("⚠️  Google Calendar no disponible: %v", err)
	} else {
		calendarStatus = "✅ Conectado"
	}

	// Pagos
	log.Println("💳 Cargando configuración de pagos...")
	if err := src.LoadPaymentConfig(); err != nil {
		log.Printf("⚠️  Pagos no disponibles: %v", err)
	} else if src.HasPaymentMethods() {
		log.Println("✅ Métodos de pago configurados")
	}

	// Watchdog de configuración
	go configWatchdog()

	// Calendario semanal
	if src.IsSheetsEnabled() {
		if err := src.InitializeWeeklyCalendar(); err != nil {
			log.Printf("⚠️  Calendario semanal: %v", err)
		} else {
			log.Println("✅ Calendario semanal configurado")
		}
	}

	// ── Bot de Telegram ────────────────────────────────────────────────────
	botToken := os.Getenv("TELEGRAM_BOT_TOKEN")
	if botToken == "" {
		log.Fatal("❌ TELEGRAM_BOT_TOKEN no configurado en .env")
	}

	bot, err := tgbotapi.NewBotAPI(botToken)
	if err != nil {
		log.Fatalf("❌ Error creando bot de Telegram: %v", err)
	}

	bot.Debug = os.Getenv("DEBUG") == "true"
	log.Printf("✅ Bot de Telegram conectado como @%s", bot.Self.UserName)

	printFinalStatus(geminiStatus, sheetsStatus, calendarStatus, bot.Self.UserName)

	// Configurar updates
	u := tgbotapi.NewUpdate(0)
	u.Timeout = 60
	updates := bot.GetUpdatesChan(u)

	// Señal de cierre
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)

	log.Println("⏳ Bot en espera de mensajes de Telegram...")
	log.Println("💡 Presiona Ctrl+C para detener")

	for {
		select {
		case update := <-updates:
			go src.HandleTelegramUpdate(bot, update)
		case <-sigCh:
			fmt.Println("\n👋 Deteniendo bot de Telegram...")
			return
		}
	}
}

func printBanner() {
	fmt.Println(`
╔═══════════════════════════════════════════════════════╗
║                                                       ║
║      🤖 AtomicBot Telegram - Attomos Edition         ║
║                                                       ║
║        Bot Inteligente con IA para Negocios          ║
║                                                       ║
╚═══════════════════════════════════════════════════════╝`)
}

func printFinalStatus(gemini, sheets, calendar, username string) {
	fmt.Println("\n╔═══════════════════════════════════════════════════════╗")
	fmt.Println("║           ✅ BOT TELEGRAM CONECTADO                   ║")
	fmt.Println("╚═══════════════════════════════════════════════════════╝")
	fmt.Printf("\n🤖 Usuario: @%s\n", username)
	if src.BusinessCfg != nil {
		fmt.Printf("🏢 Negocio: %s\n", src.BusinessCfg.AgentName)
		fmt.Printf("📱 Tipo: %s\n", src.BusinessCfg.BusinessType)
	}
	fmt.Println("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
	fmt.Println("📊 ESTADO DE SERVICIOS")
	fmt.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
	fmt.Printf("🧠 Gemini AI:        %s\n", gemini)
	fmt.Printf("📊 Google Sheets:    %s\n", sheets)
	fmt.Printf("📅 Google Calendar:  %s\n", calendar)
	fmt.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
}

func configWatchdog() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	lastConfigMod := getFileModTime("business_config.json")
	lastEnvMod := getFileModTime(".env")
	lastGoogleMod := getFileModTime("google.json")

	for range ticker.C {
		if m := getFileModTime("business_config.json"); m != lastConfigMod {
			log.Println("🔄 business_config.json cambiado, recargando...")
			src.LoadBusinessConfig()
			lastConfigMod = m
		}
		if m := getFileModTime(".env"); m != lastEnvMod {
			log.Println("🔄 .env cambiado, recargando...")
			godotenv.Load()
			src.InitGemini()
			src.InitSheets()
			src.InitCalendar()
			lastEnvMod = m
		}
		if m := getFileModTime("google.json"); m != lastGoogleMod {
			log.Println("🔄 google.json cambiado, recargando servicios Google...")
			if !src.IsSheetsEnabled() {
				src.InitSheets()
			}
			if !src.IsCalendarEnabled() {
				src.InitCalendar()
			}
			lastGoogleMod = m
		}
	}
}

func getFileModTime(filename string) time.Time {
	info, err := os.Stat(filename)
	if err != nil {
		return time.Time{}
	}
	return info.ModTime()
}
