package handlers

import (
	"log"
	"net/http"
	"time"

	"attomos/config"
	"attomos/models"

	"github.com/gin-gonic/gin"
)

type SelectPlanRequest struct {
	Plan         string `json:"plan" binding:"required"`
	BillingCycle string `json:"billingCycle" binding:"required"`
}

// GetSelectPlanPage renderiza la página de selección de plan
func GetSelectPlanPage(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.Redirect(http.StatusFound, "/login")
		return
	}

	user := userInterface.(*models.User)

	// Verificar si el usuario ya tiene una suscripción activa
	var subscription models.Subscription
	if err := config.DB.Where("user_id = ?", user.ID).First(&subscription).Error; err == nil {
		// Si tiene suscripción y no es pending, redirigir al dashboard
		if subscription.Plan != "" && subscription.Plan != "pending" {
			c.Redirect(http.StatusFound, "/dashboard")
			return
		}
	}

	c.HTML(http.StatusOK, "select-plan.html", gin.H{
		"user": user,
	})
}

// SelectPlan maneja la selección de plan del usuario
func SelectPlan(c *gin.Context) {
	var req SelectPlanRequest

	if err := c.ShouldBindJSON(&req); err != nil {
		log.Printf("❌ Error al parsear JSON: %v", err)
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "Datos inválidos",
			"details": err.Error(),
		})
		return
	}

	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "No autenticado",
		})
		return
	}

	user := userInterface.(*models.User)

	log.Printf("📋 [User %d] Seleccionando plan: %s (%s)", user.ID, req.Plan, req.BillingCycle)

	// Validar que el plan sea válido
	validPlans := []string{"gratuito", "proton", "neutron", "electron"}
	isValidPlan := false
	for _, validPlan := range validPlans {
		if req.Plan == validPlan {
			isValidPlan = true
			break
		}
	}

	if !isValidPlan {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Plan inválido",
		})
		return
	}

	// Validar billing cycle
	if req.BillingCycle != "monthly" && req.BillingCycle != "annual" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Ciclo de facturación inválido",
		})
		return
	}

	// ============================================
	// PLAN GRATUITO - 30 DÍAS DE PRUEBA
	// ============================================
	if req.Plan == "gratuito" {
		now := time.Now()
		trialEnd := now.AddDate(0, 0, 30) // 30 días desde ahora

		// Verificar si ya existe una suscripción
		var subscription models.Subscription
		err := config.DB.Where("user_id = ?", user.ID).First(&subscription).Error

		if err != nil {
			// No existe, crear nueva suscripción
			subscription = models.Subscription{
				UserID:             user.ID,
				Plan:               "gratuito",
				BillingCycle:       "monthly",
				Status:             "trialing",
				TrialStart:         &now,
				TrialEnd:           &trialEnd,
				CurrentPeriodStart: &now,
				CurrentPeriodEnd:   &trialEnd,
				Currency:           "mxn",
			}
			subscription.SetPlanLimits()

			if err := config.DB.Create(&subscription).Error; err != nil {
				log.Printf("❌ Error creando suscripción gratuita: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{
					"error": "Error al activar plan gratuito",
				})
				return
			}
		} else {
			// Ya existe, actualizar
			subscription.Plan = "gratuito"
			subscription.Status = "trialing"
			subscription.TrialStart = &now
			subscription.TrialEnd = &trialEnd
			subscription.CurrentPeriodStart = &now
			subscription.CurrentPeriodEnd = &trialEnd
			subscription.SetPlanLimits()

			if err := config.DB.Save(&subscription).Error; err != nil {
				log.Printf("❌ Error actualizando suscripción gratuita: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{
					"error": "Error al activar plan gratuito",
				})
				return
			}
		}

		log.Printf("✅ [User %d] Plan gratuito activado (30 días de prueba hasta %s)", user.ID, trialEnd.Format("2006-01-02"))

		c.JSON(http.StatusOK, gin.H{
			"success":    true,
			"message":    "Plan gratuito activado exitosamente",
			"plan":       "gratuito",
			"trial":      true,
			"trialEnd":   trialEnd.Format("2006-01-02"),
			"redirectTo": "/dashboard",
		})
		return
	}

	// ============================================
	// PLANES DE PAGO - REDIRIGIR A CHECKOUT
	// ============================================
	log.Printf("💳 [User %d] Redirigiendo a checkout para plan: %s", user.ID, req.Plan)

	c.JSON(http.StatusOK, gin.H{
		"success":    true,
		"message":    "Redirigiendo a checkout",
		"plan":       req.Plan,
		"redirectTo": "/checkout?plan=" + req.Plan + "&billing=" + req.BillingCycle,
	})
}
