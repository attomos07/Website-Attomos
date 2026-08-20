package main

import (
	"bytes"
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"atomic-whatsapp-web/src"

	"github.com/joho/godotenv"
	_ "github.com/mattn/go-sqlite3"
	"github.com/mdp/qrterminal/v3"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
)

var globalClient *whatsmeow.Client

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

	// Cargar configuración del negocio (desde el backend de Attomos, ya no
	// de un archivo local — ver LoadBusinessConfig en config.go)
	log.Println("🏢 Cargando configuración del negocio...")
	if err := src.LoadBusinessConfig(); err != nil {
		log.Printf("⚠️  Error cargando configuración del negocio: %v\n", err)
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

	// Modo gubernamental
	if src.IsAgencyMode() {
		log.Println("🏛️  Modo gubernamental — inicializando AgencyBot...")
		if err := src.InitAgencyBot(); err != nil {
			log.Printf("⚠️  AgencyBot: %v\n", err)
		}
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

	// Cargar inventario/endpoint conectado vía API Explorer (si el negocio
	// configuró uno desde el panel) y refrescarlo cada 5 min en segundo plano.
	log.Println("🔌 Cargando inventario de API Explorer...")
	src.StartAPIExplorerPolling()

	// Refrescar la config del negocio (giro, nombre, horario, servicios...)
	// cada 5 min como respaldo — el aviso normal llega al instante por
	// WebSocket cuando guardas en Mi Negocio (ver crm_bridge.go).
	src.StartBusinessConfigPolling()

	// Conectar con el CRM en vivo (hub del backend) — reporta cada mensaje y
	// permite que un humano tome la conversación desde el CRM. Se reconecta
	// solo si se cae; no bloquea el arranque si no está configurado.
	src.InitCRMBridge()

	// Reporta métricas de recursos (CPU, RAM, goroutines, disco) al panel
	// superadmin cada minuto, por el mismo WebSocket del CRM — ver metrics.go.
	src.StartMetricsReporting()

	// Iniciar watchdog para recargar configuración
	go configWatchdog()

	// Configurar logger de WhatsApp
	dbLog := waLog.Stdout("Database", "INFO", true)

	// Crear contexto
	ctx := context.Background()

	// Obtener ruta de la base de datos
	dbFile := os.Getenv("DATABASE_FILE")
	if dbFile == "" {
		dbFile = "whatsapp.db"
	}

	log.Printf("\n📁 Base de datos: %s", dbFile)

	// Crear contenedor de store SQLite
	container, err := sqlstore.New(ctx, "sqlite3", fmt.Sprintf("file:%s?_foreign_keys=on", dbFile), dbLog)
	if err != nil {
		log.Fatalf("❌ Error creando store: %v", err)
	}

	// Si no hay dispositivos, crear uno nuevo
	deviceStore, err := container.GetFirstDevice(ctx)
	if err != nil {
		log.Fatalf("❌ Error obteniendo dispositivo: %v", err)
	}

	clientLog := waLog.Stdout("Client", "INFO", true)
	client := whatsmeow.NewClient(deviceStore, clientLog)
	globalClient = client

	// Configurar cliente global
	src.SetClient(client)

	// ── Servidor HTTP de control interno ──────────────────────────────────
	// Permite llamar /logout desde el backend antes de un redeploy
	botHTTPPort := os.Getenv("BOT_HTTP_PORT")
	if botHTTPPort == "" {
		botHTTPPort = "3999"
	}
	go func() {
		mux := http.NewServeMux()
		mux.HandleFunc("/logout", func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPost {
				http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
				return
			}
			log.Println("🚪 Logout solicitado — desconectando de WhatsApp...")
			if globalClient != nil && globalClient.IsConnected() {
				globalClient.Logout(context.Background())
				log.Println("✅ Logout completado — sesión invalidada en WhatsApp")
			}
			w.WriteHeader(http.StatusOK)
			w.Write([]byte("ok"))
			go func() {
				time.Sleep(500 * time.Millisecond)
				os.Exit(0) // systemd reiniciará si es necesario
			}()
		})
		mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte("ok"))
		})
		log.Printf("🌐 Bot HTTP server en :%s", botHTTPPort)
		http.ListenAndServe(":"+botHTTPPort, mux)
	}()

	// Registrar manejador de eventos
	client.AddEventHandler(func(evt interface{}) {
		handleEvents(evt, client)
	})

	log.Println("\n📱 Conectando a WhatsApp...")
	log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

	// Si no está conectado, mostrar QR
	if client.Store.ID == nil {
		qrChan, _ := client.GetQRChannel(context.Background())
		err = client.Connect()
		if err != nil {
			log.Fatalf("❌ Error conectando: %v", err)
		}

		// ✅ FIX: Dar tiempo al WebSocket para estabilizarse antes de mostrar el QR
		time.Sleep(500 * time.Millisecond)

		fmt.Println("\n📱 Escanea este código QR con tu WhatsApp:")
		fmt.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

		// Limpiar archivos de estado previos
		os.Remove(qrFilePath())
		os.Remove(connectedFilePath())

		for evt := range qrChan {
			if evt.Event == "code" {
				// Escribir QR ASCII al archivo dedicado (más confiable que parsear logs)
				var buf bytes.Buffer
				qrterminal.GenerateHalfBlock(evt.Code, qrterminal.L, &buf)
				os.WriteFile(qrFilePath(), buf.Bytes(), 0644)

				// Mostrar en stdout (log) también
				qrterminal.GenerateHalfBlock(evt.Code, qrterminal.L, os.Stdout)
				fmt.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
				fmt.Println("⏳ Esperando escaneo... (El QR se actualiza automáticamente)")
			} else {
				log.Printf("📱 Estado de login: %s\n", evt.Event)
			}
		}
		// QR scaneado o expirado — limpiar archivo QR
		os.Remove(qrFilePath())
	} else {
		err = client.Connect()
		if err != nil {
			log.Fatalf("❌ Error conectando: %v", err)
		}
	}

	// Mostrar estado final
	printFinalStatus(geminiStatus, sheetsStatus, calendarStatus)

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

	fmt.Println("\n👋 Desconectando bot...")
	client.Disconnect()
}

// qrFilePath retorna la ruta del archivo QR para este agente
func qrFilePath() string {
	agentID := os.Getenv("AGENT_ID")
	if agentID == "" {
		agentID = "0"
	}
	return fmt.Sprintf("/tmp/atomic-bot-%s-qr.txt", agentID)
}

// connectedFilePath retorna la ruta del marker de conexión para este agente
func connectedFilePath() string {
	agentID := os.Getenv("AGENT_ID")
	if agentID == "" {
		agentID = "0"
	}
	return fmt.Sprintf("/tmp/atomic-bot-%s-connected.txt", agentID)
}

// Banner del bot
func printBanner() {
	banner := `
╔═══════════════════════════════════════════════════════╗
║                                                       ║
║        🤖 AtomicBot WhatsApp - Attomos Edition       ║
║                                                       ║
║          Bot Inteligente con IA para Negocios        ║
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
		"AGENT_ID":           "ID del Agente",
		"GEMINI_API_KEY":     "Gemini AI",
		"SPREADSHEETID":      "Google Sheets",
		"GOOGLE_CALENDAR_ID": "Google Calendar",
		"DATABASE_FILE":      "Base de Datos",
	}

	for env, description := range vars {
		value := os.Getenv(env)
		if value != "" {
			masked := maskValue(value)
			log.Printf("✅ %-20s: %s (%s)\n", env, masked, description)
		} else {
			log.Printf("⚠️  %-20s: No configurada (%s)\n", env, description)
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
func printFinalStatus(gemini, sheets, calendar string) {
	fmt.Println("\n╔═══════════════════════════════════════════════════════╗")
	fmt.Println("║              ✅ BOT CONECTADO EXITOSAMENTE            ║")
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
	fmt.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

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

	fmt.Println("\n⏳ Bot en espera de mensajes de WhatsApp...")
	fmt.Println("💡 Presiona Ctrl+C para detener el bot")
}

// Watchdog para recargar configuración automáticamente
func configWatchdog() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	lastEnvMod := getFileModTime(".env")
	lastGoogleMod := getFileModTime("google.json")

	for range ticker.C {
		// Nota: business_config.json ya NO se vigila aquí — la config del
		// negocio se refresca vía LoadBusinessConfig() (HTTP al backend),
		// disparado por WebSocket al instante o por StartBusinessConfigPolling()
		// cada 5 min como respaldo. Ver config.go.

		// Verificar si .env cambió
		currentEnvMod := getFileModTime(".env")
		if currentEnvMod != lastEnvMod {
			log.Println("\n🔄 Detectado cambio en .env, recargando configuración...")
			if err := godotenv.Load(); err == nil {
				log.Println("✅ Configuración recargada")

				// Siempre re-inicializar para aplicar nuevas keys/IDs
				if err := src.InitGemini(); err == nil {
					log.Println("✅ Gemini AI ahora está disponible")
				}

				if err := src.InitSheets(); err == nil {
					log.Println("✅ Google Sheets ahora está disponible")
				}

				if err := src.InitCalendar(); err == nil {
					log.Println("✅ Google Calendar ahora está disponible")
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

// Manejador de eventos mejorado con detección de desconexión
func handleEvents(evt interface{}, client *whatsmeow.Client) {
	switch v := evt.(type) {
	case *events.Message:
		if src.IsAgencyMode() {
			src.HandleAgencyMessage(v, client)
		} else {
			src.HandleMessage(v, client)
		}

	case *events.Receipt:
		if v.Type == events.ReceiptTypeRead || v.Type == events.ReceiptTypeReadSelf {
			log.Printf("✓✓ Mensaje leído: %s\n", v.MessageIDs[0])
		}

	case *events.Connected:
		log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
		log.Println("🟢 WHATSAPP CONECTADO")
		log.Println("WHATSAPP_SESSION_ACTIVE") // sentinel único para detección en logs
		log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
		log.Println("✅ El bot está listo para recibir mensajes")
		// Marcar conexión en archivo — método primario de detección de estado
		os.WriteFile(connectedFilePath(), []byte("connected"), 0644)
		os.Remove(qrFilePath())

	case *events.Disconnected:
		log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
		log.Println("🔴 WHATSAPP DESCONECTADO")
		log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
		log.Println("⚠️  Dispositivo desvinculado de WhatsApp")
		log.Println("💡 El sistema está esperando nueva conexión...")
		os.Remove(connectedFilePath())

	case *events.LoggedOut:
		log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
		log.Println("🚪 SESIÓN CERRADA - LOGOUT DETECTADO")
		log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

		// ✅ FIX: Si Store.ID es nil, el LoggedOut viene de un fallo de pairing
		// (no de una sesión activa desvinculada). En ese caso NO limpiar ni salir,
		// porque el proceso de QR sigue corriendo y puede reintentar.
		if client.Store.ID == nil {
			log.Println("⚠️  Fallo durante pairing inicial - ignorando LoggedOut")
			log.Println("💡 El QR se regenerará automáticamente, intenta escanear de nuevo")
			return
		}

		// Solo para sesiones ya establecidas: limpiar DB y reiniciar
		log.Println("⚠️  El dispositivo fue desvinculado de WhatsApp")
		log.Println("🔄 Limpiando sesión y preparando para nueva conexión...")
		os.Remove(connectedFilePath())

		go func() {
			time.Sleep(2 * time.Second)

			dbFile := os.Getenv("DATABASE_FILE")
			if dbFile == "" {
				dbFile = "whatsapp.db"
			}

			log.Println("🗑️  Eliminando base de datos de sesión...")
			if err := os.Remove(dbFile); err != nil {
				log.Printf("⚠️  No se pudo eliminar la base de datos: %v\n", err)
			} else {
				log.Println("✅ Base de datos eliminada")
				log.Println("🔄 El bot se reiniciará automáticamente por systemd")
				log.Println("📱 Escanea el nuevo código QR cuando aparezca")
			}

			// Salir para que systemd reinicie el servicio
			os.Exit(0)
		}()

	case *events.StreamReplaced:
		log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
		log.Println("🔄 STREAM REEMPLAZADO")
		log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
		log.Println("⚠️  WhatsApp se conectó desde otro dispositivo")
		log.Println("🔄 Reconectando...")
	}
}
