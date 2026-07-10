package main

import (
	"log"
	"os"
	"path/filepath"

	"attomos/config"
	"attomos/handlers"
	"attomos/middleware"
	"attomos/models"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
)

// getTemplateFiles obtiene todos los archivos de template de los patrones dados
func getTemplateFiles(patterns ...string) []string {
	var files []string
	for _, pattern := range patterns {
		matches, err := filepath.Glob(pattern)
		if err != nil {
			log.Printf("Error buscando templates con patrón %s: %v", pattern, err)
			continue
		}
		files = append(files, matches...)
	}
	return files
}

func main() {
	// Cargar variables de entorno
	if err := godotenv.Load(); err != nil {
		log.Println("⚠️  Advertencia: No se encontró archivo .env")
	}

	// Conectar a la base de datos
	config.ConnectDatabase()

	// Migrar modelos
	if err := config.DB.AutoMigrate(
		&models.User{},
		&models.Agent{},
		&models.Subscription{},
		&models.Payment{},
		&models.GoogleCloudProject{},
		&models.GlobalServer{},          // ← Servidor compartido global para AtomicBots
		&models.Appointment{},           // ← Citas (manual + Google Sheets + agente)
		&models.MyBusinessInfo{},        // ← Perfil de negocio del usuario
		&models.Invoice{},               // ← Solicitudes de factura
		&models.PaymentConfig{},         // ← Config de pagos del bot (CLABE + Stripe Connect)
		&models.Order{},                 // ← Pedidos (giros de comida: pizzería, mariscos, etc.)
		&models.MyAgencyInfo{},          // ← Perfil de dependencia gubernamental
		&models.AgencyInscription{},     // ← Inscripciones ciudadanas a cursos
		&models.ClickPaymeTransaction{}, // ← Transacciones Click/Payme (Uzbekistán, Telegram)
		&handlers.Flow{},                // ← Flujos de automatización (gubernamental)
		&handlers.FlowOption{},          // ← Opciones de respuesta de cada flujo
	); err != nil {
		log.Fatal("❌ Error en migración:", err)
	}

	log.Println("✅ Base de datos conectada y migrada")

	// ============================================
	// INICIALIZAR GOOGLE OAUTH
	// ============================================
	if err := handlers.InitGoogleOAuth(); err != nil {
		log.Printf("⚠️  Google OAuth no inicializado: %v", err)
		log.Println("ℹ️  El login/registro con Google no estará disponible")
	} else {
		log.Println("✅ Google OAuth inicializado correctamente")
	}

	// ============================================
	// INICIALIZAR GOOGLE INTEGRATION (Calendar & Sheets)
	// ============================================
	googleIntegrationHandler, err := handlers.NewGoogleIntegrationHandler()
	if err != nil {
		log.Printf("⚠️  Google Integration no inicializado: %v", err)
		log.Println("ℹ️  La integración de Calendar y Sheets no estará disponible")
	} else {
		log.Println("✅ Google Integration inicializado correctamente")
	}

	// ============================================
	// INICIALIZAR META WHATSAPP HANDLER
	// ============================================
	metaWhatsAppHandler, err := handlers.NewMetaWhatsAppHandler()
	if err != nil {
		log.Printf("⚠️  Meta WhatsApp no inicializado: %v", err)
		log.Println("ℹ️  La integración de WhatsApp Business no estará disponible")
		log.Println("💡 Verifica que tengas configuradas las variables:")
		log.Println("   - META_APP_ID")
		log.Println("   - META_APP_SECRET")
		log.Println("   - META_REDIRECT_URL")
	} else {
		log.Println("✅ Meta WhatsApp Handler inicializado correctamente")
	}

	// Configurar Gin
	if os.Getenv("ENVIRONMENT") == "production" {
		gin.SetMode(gin.ReleaseMode)
	}

	router := gin.Default()

	// CORS
	allowedOrigins := []string{"http://localhost:3000", "http://localhost:8080"}

	// Agregar FRONTEND_URL si existe
	if frontendURL := os.Getenv("FRONTEND_URL"); frontendURL != "" {
		allowedOrigins = append(allowedOrigins, frontendURL)
	}

	router.Use(cors.New(cors.Config{
		AllowOrigins:     allowedOrigins,
		AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: true,
	}))

	// Servir archivos estáticos
	router.Static("/static", "./static")

	// Cargar templates de múltiples directorios
	templates := []string{
		"templates/*.html",
		"templates/auth/*.html",
		"templates/partials/*.html",
		"templates/legal/*.html",
		"templates/admin/*.html",
		"templates/ninda/*.html",
		"templates/agency/*.html",
		"templates/flows/*.html",
	}
	router.LoadHTMLFiles(getTemplateFiles(templates...)...)

	// ============================================
	// RUTAS PÚBLICAS
	// ============================================

	// Landing page con precios de Stripe
	router.GET("/", handlers.GetIndexPage)

	// Autenticación tradicional
	router.POST("/api/register", handlers.Register)
	router.POST("/api/login", handlers.Login)
	router.POST("/api/logout", handlers.Logout)

	// Plans Data API - Obtener datos de planes dinámicamente (PÚBLICO)
	router.GET("/api/plans-data", handlers.GetPlansDataAPI)

	// ============================================
	// GOOGLE OAUTH ROUTES
	// ============================================
	router.GET("/api/auth/google/login", handlers.GoogleLogin)
	router.GET("/api/auth/google/callback", handlers.GoogleCallback)

	// ============================================
	// 💳 STRIPE WEBHOOK (PÚBLICO — sin auth)
	// ============================================
	router.POST("/webhook/stripe", handlers.StripeWebhookHandler)
	log.Println("✅ Stripe Webhook configurado en: /webhook/stripe")

	router.POST("/webhook/click/:branch_id", handlers.ClickWebhookHandler)
	router.POST("/webhook/payme/:branch_id", handlers.PaymeWebhookHandler)
	log.Println("✅ Click/Payme Webhooks configurados en: /webhook/click/:branch_id y /webhook/payme/:branch_id")

	// ============================================
	// 🔧 WEBHOOK PROXY - Meta WhatsApp (PÚBLICO)
	// ============================================
	// IMPORTANTE: Estas rutas DEBEN ser públicas porque Meta las llama directamente
	router.GET("/webhook/meta/:agent_id", handlers.WebhookProxy)
	router.POST("/webhook/meta/:agent_id", handlers.WebhookProxy)
	log.Println("✅ Webhook Proxy configurado en: /webhook/meta/:agent_id")

	// ============================================
	// 🛒 NINDA — Marketplace público (sin auth)
	// ============================================
	// Páginas HTML
	router.GET("/ninda", handlers.GetNindaDirectory)
	router.GET("/ninda/map", handlers.GetNindaMap)
	router.GET("/ninda/login", handlers.GetNindaLogin)
	router.GET("/ninda/register", handlers.GetNindaRegister)
	router.GET("/ninda/:branch_id", handlers.GetNindaStore)
	// API pública
	router.GET("/api/ninda/stores", handlers.APIGetStores)
	router.GET("/api/ninda/stores/:branch_id", handlers.APIGetStore)
	router.POST("/api/ninda/checkout", handlers.APICreateCheckout)
	router.POST("/api/ninda/confirm", handlers.APIConfirmOrder)
	log.Println("✅ Ninda Marketplace configurado en: /ninda")

	// ============================================
	// RUTAS PROTEGIDAS (API)
	// ============================================

	protected := router.Group("/api")
	protected.Use(middleware.AuthRequired())
	{
		// Usuario
		protected.GET("/me", handlers.GetCurrentUser)
		protected.GET("/project-status", handlers.GetProjectStatus)
		protected.PUT("/user/password", handlers.UpdatePassword)
		protected.DELETE("/user/account", handlers.DeleteAccount)

		// Agentes
		protected.POST("/agents", handlers.CreateAgent)
		protected.GET("/agents", handlers.GetAgents)
		protected.GET("/agents/:id", handlers.GetAgent)
		protected.GET("/agents/:id/qr", handlers.GetAgentQRCode)
		protected.GET("/agents/:id/logs", handlers.GetAgentLogs)
		protected.GET("/agents/:id/logs/stream", handlers.StreamAgentLogs)
		protected.PUT("/agents/:id", handlers.UpdateAgent)
		protected.DELETE("/agents/:id", handlers.DeleteAgent)
		protected.PATCH("/agents/:id/toggle", handlers.ToggleAgentStatus)
		protected.POST("/agents/:id/redeploy", handlers.RedeployAgent)
		protected.POST("/agents/:id/reset-session", handlers.ResetAgentSession)

		// Mi Negocio / Sucursales
		protected.GET("/my-business", handlers.GetMyBusiness)
		protected.POST("/my-business", handlers.SaveMyBusiness)
		protected.GET("/my-business/:id", handlers.GetBranch)
		protected.POST("/my-business/branch", handlers.CreateBranch)
		protected.DELETE("/my-business/branch/:id", handlers.DeleteBranch)

		// Mi Dependencia / Oficinas gubernamentales
		protected.GET("/my-agency", handlers.GetMyAgency)
		protected.POST("/my-agency", handlers.SaveMyAgency)
		protected.GET("/my-agency/:id", handlers.GetAgencyOffice)
		protected.POST("/my-agency/office", handlers.CreateAgencyOffice)
		protected.DELETE("/my-agency/office/:id", handlers.DeleteAgencyOffice)

		// Upload de imágenes para servicios/productos
		protected.POST("/upload/service-image", handlers.UploadServiceImage)
		protected.POST("/upload/menu", handlers.UploadMenu)

		// ============================================
		// ⭐ APPOINTMENTS - CRUD completo (BD + Sheets sync)
		// ============================================
		protected.GET("/appointments", handlers.GetAppointments)
		protected.POST("/appointments", handlers.CreateManualAppointment)
		protected.PATCH("/appointments/:id/status", handlers.UpdateAppointmentStatus)
		protected.DELETE("/appointments/:id", handlers.DeleteAppointment)

		// ============================================
		// 🍕 ORDERS — Pedidos (giros de comida)
		// ============================================
		protected.GET("/orders", handlers.GetOrders)
		protected.POST("/orders", handlers.CreateOrder)
		protected.PATCH("/orders/:id/status", handlers.UpdateOrderStatus)
		protected.DELETE("/orders/:id", handlers.DeleteOrder)

		// Bot endpoints (no requieren JWT, usan BOT_API_TOKEN)
		router.POST("/api/bot/orders", handlers.CreateBotOrder)
		router.POST("/api/bot/appointments", handlers.CreateBotAppointment)

		// ============================================
		// 🔀 FLOWS — Flujos de automatización (gubernamental)
		// ============================================
		flowHandler := handlers.NewFlowHandler(config.DB)
		protected.GET("/flows", flowHandler.ListFlows)
		protected.POST("/flows", flowHandler.CreateFlow)
		protected.PUT("/flows/:id", flowHandler.UpdateFlow)
		protected.DELETE("/flows/:id", flowHandler.DeleteFlow)
		protected.POST("/flows/:id/toggle", flowHandler.ToggleFlow)

		// Client History
		protected.GET("/client-history", handlers.GetHistorial)
		protected.GET("/client-history/client/:phone", handlers.GetHistorialCliente)

		// Services Statistics
		protected.GET("/services/statistics", handlers.GetServicesDashboardStats)

		// Billing GCP (costos BigQuery)
		protected.GET("/billing/data", handlers.GetBillingData)

		// Billing Suscripciones y Pagos Stripe
		protected.GET("/billing/info", handlers.GetBillingInfo)
		protected.GET("/billing/payments", handlers.GetBillingPayments)
		protected.POST("/billing/cancel", handlers.CancelSubscription)

		// Payment Methods
		protected.GET("/billing/payment-methods", handlers.GetPaymentMethods)
		protected.POST("/billing/payment-methods", handlers.AddPaymentMethod)
		protected.PUT("/billing/payment-methods/:id", handlers.UpdatePaymentMethod)
		protected.POST("/billing/payment-methods/:id/default", handlers.SetDefaultPaymentMethod)
		protected.DELETE("/billing/payment-methods/:id", handlers.DeletePaymentMethod)

		// Chatwoot
		protected.GET("/chatwoot/info", handlers.GetChatwootInfo)

		// Stripe - Pagos de suscripción Attomos
		protected.POST("/stripe/checkout", handlers.CreateCheckoutSession)
		protected.POST("/stripe/confirm", handlers.ConfirmPayment)
		protected.GET("/stripe/public-key", handlers.GetStripePublicKey)

		// Recibos PDF
		protected.GET("/billing/receipt/:id", handlers.GetReceiptPDF)

		// Select Plan
		protected.POST("/select-plan", handlers.SelectPlan)

		// ============================================
		// GOOGLE INTEGRATION - Calendar & Sheets
		// ============================================
		if googleIntegrationHandler != nil {
			protected.GET("/google/connect", googleIntegrationHandler.InitiateGoogleIntegration)
			protected.GET("/google/callback", googleIntegrationHandler.HandleGoogleCallback)
			protected.GET("/google/status/:agent_id", googleIntegrationHandler.GetIntegrationStatus)
			protected.POST("/google/disconnect/:agent_id", googleIntegrationHandler.DisconnectGoogle)
			protected.POST("/google/appointments", googleIntegrationHandler.CreateAppointment)
		}

		// ============================================
		// GEMINI AI INTEGRATION
		// ============================================
		protected.POST("/gemini/save-key/:agent_id", handlers.SaveGeminiKey)
		protected.DELETE("/gemini/remove-key/:agent_id", handlers.RemoveGeminiKey)
		protected.GET("/gemini/status/:agent_id", handlers.GetGeminiStatus)

		// ============================================
		// META WHATSAPP BUSINESS API - CREDENTIALS
		// ============================================
		protected.GET("/meta/credentials/status/:agent_id", handlers.GetMetaCredentialsStatus)
		protected.POST("/meta/credentials/save/:agent_id", handlers.SaveMetaCredentials)
		protected.DELETE("/meta/credentials/remove/:agent_id", handlers.RemoveMetaCredentials)

		// ============================================
		// 💳 PAYMENT CONFIG - Pasarela de pagos del bot (CLABE + Stripe Connect + Click/Payme)
		// ============================================
		protected.GET("/payment-config/:branch_id", handlers.GetPaymentConfig)
		protected.POST("/payment-config/spei/:branch_id", handlers.SaveSPEIConfig)
		protected.DELETE("/payment-config/spei/:branch_id", handlers.RemoveSPEIConfig)
		protected.POST("/payment-config/stripe/connect/:branch_id", handlers.InitiateStripeConnect)
		protected.DELETE("/payment-config/stripe/:branch_id", handlers.DisconnectStripeConnect)
		protected.POST("/payment-config/click/:branch_id", handlers.SaveClickConfig)
		protected.DELETE("/payment-config/click/:branch_id", handlers.RemoveClickConfig)
		protected.POST("/payment-config/payme/:branch_id", handlers.SavePaymeConfig)
		protected.DELETE("/payment-config/payme/:branch_id", handlers.RemovePaymeConfig)
		protected.PATCH("/payment-config/settings/:branch_id", handlers.UpdatePaymentSettings)

		// ============================================
		// META WHATSAPP BUSINESS INTEGRATION (OAuth)
		// ============================================
		if metaWhatsAppHandler != nil {
			protected.GET("/meta/connect", metaWhatsAppHandler.InitiateConnection)
			router.GET("/api/meta/callback", metaWhatsAppHandler.HandleCallback)
			protected.GET("/meta/status/:agent_id", metaWhatsAppHandler.GetConnectionStatus)
			protected.POST("/meta/disconnect/:agent_id", metaWhatsAppHandler.DisconnectWhatsApp)
		}
	}

	// Callback de Stripe Connect (redirect desde Stripe, sin JWT)
	router.GET("/api/payment-config/stripe/callback", handlers.HandleStripeConnectCallback)

	// Bot Payment Link — autenticado con BOT_API_TOKEN (no JWT)
	router.POST("/api/payment-config/stripe/payment-link", handlers.CreateBotPaymentLink)
	router.GET("/api/payment-config/bot/:branch_id", handlers.GetBotPaymentConfig)

	// Bot Gubernamental — autenticado con BOT_API_TOKEN (no JWT)
	router.GET("/api/bot/agency-config/:branchId", handlers.GetAgencyConfigForBot)
	router.POST("/api/bot/inscriptions", handlers.SaveInscription)
	router.POST("/api/bot/quota-filled", handlers.QuotaFilled)

	// Proxy de imágenes — sirve recursos de Hetzner por HTTPS para evitar mixed content
	router.GET("/api/uploads/proxy", handlers.ProxyUpload)

	// ============================================
	// PÁGINAS WEB
	// ============================================

	router.GET("/select-plan", middleware.AuthRequired(), handlers.GetSelectPlanPage)

	router.GET("/dashboard", middleware.AuthRequired(), func(c *gin.Context) {
		c.HTML(200, "dashboard.html", nil)
	})

	router.GET("/my-agents", middleware.AuthRequired(), func(c *gin.Context) {
		c.HTML(200, "my-agents.html", nil)
	})

	router.GET("/agents/:id", middleware.AuthRequired(), func(c *gin.Context) {
		c.HTML(200, "agent-details.html", nil)
	})

	router.GET("/appointments", middleware.AuthRequired(), func(c *gin.Context) {
		c.HTML(200, "appointments.html", nil)
	})

	router.GET("/orders", middleware.AuthRequired(), func(c *gin.Context) {
		c.HTML(200, "orders.html", nil)
	})

	router.GET("/client-history", middleware.AuthRequired(), func(c *gin.Context) {
		c.HTML(200, "client_history.html", nil)
	})

	router.GET("/integrations", middleware.AuthRequired(), func(c *gin.Context) {
		c.HTML(200, "integrations.html", nil)
	})

	router.GET("/business-portfolio", middleware.AuthRequired(), func(c *gin.Context) {
		c.HTML(200, "business-portfolio.html", nil)
	})

	router.GET("/login", func(c *gin.Context) {
		c.HTML(200, "login.html", gin.H{
			"title": "Attomos",
		})
	})

	router.GET("/register", func(c *gin.Context) {
		c.HTML(200, "register.html", gin.H{
			"title": "Attomos",
		})
	})

	router.GET("/agents", func(c *gin.Context) {
		c.HTML(200, "agents.html", gin.H{
			"title": "Agentes - Attomos",
		})
	})

	router.GET("/blog", func(c *gin.Context) {
		c.HTML(200, "blog.html", gin.H{
			"title": "Blog - Attomos",
		})
	})

	router.GET("/pricing", func(c *gin.Context) {
		c.HTML(200, "pricing.html", gin.H{
			"title": "Precios - Attomos",
		})
	})

	router.GET("/contact", func(c *gin.Context) {
		c.HTML(200, "contact.html", gin.H{
			"title": "Contacto - Attomos",
		})
	})

	// ============================================
	// PÁGINAS LEGALES
	// ============================================
	router.GET("/terms", func(c *gin.Context) {
		c.HTML(200, "terms.html", gin.H{
			"title": "Términos y Condiciones - Attomos",
		})
	})

	router.GET("/privacy", func(c *gin.Context) {
		c.HTML(200, "privacy.html", gin.H{
			"title": "Política de Privacidad - Attomos",
		})
	})

	// ============================================
	// PÁGINAS PROTEGIDAS
	// ============================================

	router.GET("/onboarding", middleware.AuthRequired(), func(c *gin.Context) {
		c.HTML(200, "onboarding.html", nil)
	})

	router.GET("/billing", middleware.AuthRequired(), func(c *gin.Context) {
		c.HTML(200, "billing.html", nil)
	})

	router.GET("/billing/payment-method", middleware.AuthRequired(), handlers.GetPaymentMethodPage)

	router.GET("/plans", middleware.AuthRequired(), handlers.GetPlansPage)

	router.GET("/checkout", middleware.AuthRequired(), func(c *gin.Context) {
		c.HTML(200, "checkout.html", nil)
	})

	router.GET("/settings", middleware.AuthRequired(), func(c *gin.Context) {
		c.HTML(200, "settings.html", nil)
	})

	router.GET("/my-business", middleware.AuthRequired(), func(c *gin.Context) {
		c.HTML(200, "my-business.html", nil)
	})

	router.GET("/my-agency", middleware.AuthRequired(), func(c *gin.Context) {
		c.HTML(200, "my-agency.html", nil)
	})

	router.GET("/flows", middleware.AuthRequired(), func(c *gin.Context) {
		c.HTML(200, "flows.html", nil)
	})

	router.GET("/notifications", middleware.AuthRequired(), func(c *gin.Context) {
		c.HTML(200, "notifications.html", nil)
	})

	// ============================================
	// RECOVER PASSWORD (PÚBLICAS — sin autenticación)
	// ============================================
	router.GET("/recover-password", func(c *gin.Context) {
		c.HTML(200, "recover-password.html", gin.H{
			"title": "Recuperar Contraseña - Attomos",
		})
	})

	// API — el usuario no está autenticado, va fuera del grupo protected
	router.POST("/api/user/password-reset", handlers.RequestPasswordReset)

	// ============================================
	// ADMIN PANEL
	// ============================================

	// Login público del admin
	router.GET("/admin/login", func(c *gin.Context) {
		c.HTML(200, "admin/login.html", gin.H{
			"title": "Admin — Attomos",
		})
	})
	router.POST("/admin/api/login", handlers.AdminLogin)

	// Rutas protegidas del admin
	adminGroup := router.Group("/admin")
	adminGroup.Use(middleware.AdminRequired())
	{
		adminGroup.GET("/database-admin", func(c *gin.Context) {
			c.HTML(200, "admin-database", nil)
		})
		adminGroup.GET("/invoices", func(c *gin.Context) {
			c.HTML(200, "admin-invoices", nil)
		})
		adminGroup.GET("/sellers", func(c *gin.Context) {
			c.HTML(200, "admin-sellers", nil)
		})
		adminGroup.GET("/api/invoices", handlers.AdminGetInvoices)
		adminGroup.PATCH("/api/invoices/:id", handlers.AdminUpdateInvoiceStatus)
		adminGroup.POST("/api/logout", handlers.AdminLogout)
		adminGroup.GET("/api/companies", handlers.AdminGetCompanies)
		adminGroup.POST("/api/companies", handlers.AdminCreateCompany)
		adminGroup.PUT("/api/companies/:id/plan", handlers.AdminUpdateCompanyPlan)
	}

	// ============================================
	// HEALTH CHECK
	// ============================================

	router.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{
			"status":  "ok",
			"message": "Attomos API is running",
		})
	})

	// ============================================
	// INICIAR SERVIDOR
	// ============================================

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Println("╔══════════════════════════════════════════════════════════╗")
	log.Printf("║ 🚀 Servidor Attomos iniciado exitosamente               ║")
	log.Printf("║ 📍 Puerto: %s                                           ║", port)
	log.Printf("║ 🌐 URL Local: http://localhost:%s                       ║", port)
	log.Println("║                                                          ║")
	log.Println("║ 📊 Arquitectura de Bots:                                 ║")
	log.Println("║    • Plan GRATUITO  → AtomicBot (Go + WhatsApp Web)     ║")
	log.Println("║    • Plan de PAGO   → OrbitalBot (Go + Meta API)        ║")
	log.Println("║                                                          ║")
	log.Println("║ 🔧 Tecnología:                                           ║")
	log.Println("║    • AtomicBot:  Servidor Compartido (€5/mes total)     ║")
	log.Println("║    • OrbitalBot: Servidor Individual (€5/mes c/u)       ║")
	log.Println("║                                                          ║")
	log.Println("║ ✅ Funcionalidades:                                      ║")
	log.Println("║    • Appointments integrado con Google Sheets           ║")
	log.Println("║    • Auto-actualización cada 30 segundos                ║")
	log.Println("║    • Webhook Proxy para Meta WhatsApp (OrbitalBot)      ║")
	log.Println("║    • Páginas legales: Términos y Privacidad             ║")
	log.Println("║    • 🛒 Ninda Marketplace en: /ninda                    ║")
	log.Println("║    • 🍕 Orders en: /orders (giros de comida)            ║")
	log.Println("╚══════════════════════════════════════════════════════════╝")

	if err := router.Run(":" + port); err != nil {
		log.Fatal("❌ Error al iniciar servidor:", err)
	}
}
