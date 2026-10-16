package handlers

import (
	"log"

	"github.com/gin-gonic/gin"
)

// RegisterFoundationRoutes páginas + API de Attomos Foundation.
func RegisterFoundationRoutes(router *gin.Engine) {
	// ── Páginas ──────────────────────────────────────────────────────────────
	router.GET("/foundation", func(c *gin.Context) { c.HTML(200, "foundation/home.html", nil) })
	router.GET("/foundation/login", func(c *gin.Context) { c.HTML(200, "foundation/login.html", nil) })
	router.GET("/foundation/register", func(c *gin.Context) { c.HTML(200, "foundation/register.html", nil) })
	router.GET("/foundation/panel", func(c *gin.Context) {
		if foundationPageGuard(c) {
			c.HTML(200, "foundation/panel.html", nil)
		}
	})
	explore := func(mode, title, desc string) gin.HandlerFunc {
		return func(c *gin.Context) {
			c.HTML(200, "foundation/explore.html", gin.H{"Mode": mode, "Title": title, "Description": desc})
		}
	}
	router.GET("/foundation/rescatistas", explore("rescatistas", "Rescatistas", "Suscríbete cada mes a un rescatista independiente."))
	router.GET("/foundation/donar", explore("donar", "Donación única", "Dona una sola vez a un rescatista independiente."))
	router.GET("/foundation/r/:slug", func(c *gin.Context) {
		c.HTML(200, "foundation/rescuer.html", gin.H{"Slug": c.Param("slug")})
	})
	router.GET("/foundation/img/:fileId", FoundationServeImage)

	// ── Webhook de Stripe Connect ────────────────────────────────────────────
	router.POST("/webhook/stripe/foundation", FoundationStripeWebhook)

	api := router.Group("/api/foundation")

	// Público
	api.POST("/auth/register", FoundationRegister)
	api.POST("/auth/login", FoundationLogin)
	api.POST("/auth/logout", FoundationLogout)
	api.GET("/auth/me", FoundationMe)
	api.GET("/rescuers", FoundationListRescuers)
	api.GET("/rescuers/:slug", FoundationGetRescuer)

	// Con sesión (donador o rescatista)
	user := api.Group("", FoundationAuthRequired())
	user.PATCH("/auth/me", FoundationUpdateMe)
	user.POST("/checkout", FoundationCreateCheckout)
	user.POST("/checkout/confirm", FoundationConfirmCheckout)
	user.GET("/pledges", FoundationMyPledges)
	user.POST("/pledges/:id/cancel", FoundationCancelPledge)

	// Solo rescatista
	res := api.Group("", FoundationRescuerRequired())
	res.GET("/rescuer", FoundationGetMyRescuer)
	res.PUT("/rescuer", FoundationUpdateMyRescuer)
	res.GET("/rescuer/pledges", FoundationRescuerPledges)
	res.POST("/plans", FoundationCreatePlan)
	res.PUT("/plans/:id", FoundationUpdatePlan)
	res.DELETE("/plans/:id", FoundationDeletePlan)
	res.POST("/upload", FoundationUploadImage)
	res.GET("/google/connect", FoundationDriveConnect)
	res.DELETE("/google", FoundationDriveDisconnect)
	res.POST("/stripe/connect", FoundationStripeConnect)
	res.GET("/stripe/refresh", FoundationStripeRefresh)
	res.GET("/stripe/return", FoundationStripeReturn)
	res.GET("/stripe/status", FoundationStripeStatus)
	res.POST("/stripe/dashboard", FoundationStripeDashboard)

	// Callback de Google (redirect en popup; valida sesión y state adentro)
	api.GET("/google/callback", FoundationDriveCallback)

	StartFoundationDriveChecker()
	log.Println("✅ Attomos Foundation configurado en: /foundation (API /api/foundation)")
}
