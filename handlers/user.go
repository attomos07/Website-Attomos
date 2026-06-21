package handlers

import (
	"fmt"
	"log"
	"net/http"

	"attomos/config"
	"attomos/models"
	"attomos/services"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
)

type UpdatePasswordRequest struct {
	CurrentPassword string `json:"currentPassword" binding:"required"`
	NewPassword     string `json:"newPassword" binding:"required,min=8"`
}

// UpdatePassword actualiza la contraseña del usuario
func UpdatePassword(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "No autenticado",
		})
		return
	}

	user := userInterface.(*models.User)

	var req UpdatePasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "Datos inválidos",
			"details": err.Error(),
		})
		return
	}

	// Verificar contraseña actual
	if !user.CheckPassword(req.CurrentPassword) {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "Contraseña actual incorrecta",
		})
		return
	}

	// Hashear nueva contraseña
	if err := user.HashPassword(req.NewPassword); err != nil {
		log.Printf("❌ Error hasheando contraseña: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Error al actualizar contraseña",
		})
		return
	}

	// Guardar en BD
	if err := config.DB.Save(&user).Error; err != nil {
		log.Printf("❌ Error guardando usuario: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Error al actualizar contraseña",
		})
		return
	}

	log.Printf("✅ [User %d] Contraseña actualizada exitosamente", user.ID)

	c.JSON(http.StatusOK, gin.H{
		"message": "Contraseña actualizada exitosamente",
	})
}

// DeleteAccount elimina completamente la cuenta del usuario
func DeleteAccount(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "No autenticado",
		})
		return
	}

	user := userInterface.(*models.User)

	log.Printf("🗑️  [User %d] Iniciando eliminación de cuenta: %s", user.ID, user.Email)

	// ==================== PASO 1: Eliminar Agentes ====================
	log.Printf("📋 [User %d] PASO 1/4: Eliminando agentes...", user.ID)

	var agents []models.Agent
	if err := config.DB.Where("user_id = ?", user.ID).Find(&agents).Error; err != nil {
		log.Printf("❌ [User %d] Error obteniendo agentes: %v", user.ID, err)
	}

	// Eliminar agentes de BD
	if err := config.DB.Where("user_id = ?", user.ID).Delete(&models.Agent{}).Error; err != nil {
		log.Printf("❌ [User %d] Error eliminando agentes de BD: %v", user.ID, err)
	} else {
		log.Printf("✅ [User %d] %d agentes eliminados de BD", user.ID, len(agents))
	}

	// ==================== PASO 2: Eliminar Suscripciones y Pagos ====================
	log.Printf("📋 [User %d] PASO 2/4: Eliminando suscripciones y pagos...", user.ID)

	// Cancelar suscripciones en Stripe (si existen)
	var subscriptions []models.Subscription
	if err := config.DB.Where("user_id = ?", user.ID).Find(&subscriptions).Error; err != nil {
		log.Printf("❌ [User %d] Error obteniendo suscripciones: %v", user.ID, err)
	}

	for _, sub := range subscriptions {
		if sub.StripeSubscriptionID != "" {
			stripeService, err := services.NewStripeService()
			if err != nil {
				log.Printf("⚠️  [User %d] Error inicializando Stripe: %v", user.ID, err)
				continue
			}

			_, err = stripeService.CancelSubscription(sub.StripeSubscriptionID)
			if err != nil {
				log.Printf("⚠️  [User %d] Error cancelando suscripción Stripe %s: %v",
					user.ID, sub.StripeSubscriptionID, err)
			} else {
				log.Printf("✅ [User %d] Suscripción Stripe cancelada: %s", user.ID, sub.StripeSubscriptionID)
			}
		}
	}

	// Eliminar suscripciones de BD
	if err := config.DB.Where("user_id = ?", user.ID).Delete(&models.Subscription{}).Error; err != nil {
		log.Printf("❌ [User %d] Error eliminando suscripciones: %v", user.ID, err)
	} else {
		log.Printf("✅ [User %d] Suscripciones eliminadas de BD", user.ID)
	}

	// Eliminar pagos
	if err := config.DB.Where("user_id = ?", user.ID).Delete(&models.Payment{}).Error; err != nil {
		log.Printf("❌ [User %d] Error eliminando pagos: %v", user.ID, err)
	} else {
		log.Printf("✅ [User %d] Pagos eliminados de BD", user.ID)
	}

	// ==================== PASO 3: Eliminar Proyecto GCP ====================
	log.Printf("📋 [User %d] PASO 3/4: Eliminando proyecto Google Cloud...", user.ID)

	var gcpProject models.GoogleCloudProject
	err := config.DB.Where("user_id = ?", user.ID).First(&gcpProject).Error

	if err == nil && gcpProject.ProjectID != "" {
		// Eliminar proyecto de GCP
		gcpService, err := services.NewGoogleCloudAutomation()
		if err != nil {
			log.Printf("⚠️  [User %d] Error inicializando GCP: %v", user.ID, err)
		} else {
			if err := gcpService.DeleteProject(gcpProject.ProjectID); err != nil {
				log.Printf("⚠️  [User %d] Error eliminando proyecto GCP %s: %v",
					user.ID, gcpProject.ProjectID, err)
			} else {
				log.Printf("✅ [User %d] Proyecto GCP eliminado: %s", user.ID, gcpProject.ProjectID)
			}
		}

		// Eliminar registro de BD (hard delete)
		if err := config.DB.Unscoped().Where("user_id = ?", user.ID).Delete(&models.GoogleCloudProject{}).Error; err != nil {
			log.Printf("❌ [User %d] Error eliminando GoogleCloudProject de BD: %v", user.ID, err)
		} else {
			log.Printf("✅ [User %d] GoogleCloudProject eliminado de BD", user.ID)
		}
	} else {
		log.Printf("ℹ️  [User %d] Sin proyecto GCP que eliminar", user.ID)
	}

	// ==================== PASO 4: Eliminar Usuario ====================
	log.Printf("📋 [User %d] PASO 4/4: Eliminando usuario...", user.ID)

	if err := config.DB.Delete(&user).Error; err != nil {
		log.Printf("❌ [User %d] Error eliminando usuario: %v", user.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Error al eliminar la cuenta",
		})
		return
	}

	log.Printf("✅ [User %d] Usuario eliminado exitosamente", user.ID)

	// Limpiar cookie
	c.SetCookie("auth_token", "", -1, "/", "", false, true)

	log.Printf("🎉 [User %d] Cuenta eliminada completamente: %s", user.ID, user.Email)

	c.JSON(http.StatusOK, gin.H{
		"message": "Cuenta eliminada exitosamente",
	})
}

// GetUserProfile obtiene el perfil del usuario
func GetUserProfile(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "No autenticado",
		})
		return
	}

	user := userInterface.(*models.User)

	// Precargar proyecto GCP
	config.DB.Preload("GoogleCloudProject").First(&user, user.ID)

	// Obtener estadísticas
	var agentCount int64
	config.DB.Model(&models.Agent{}).Where("user_id = ?", user.ID).Count(&agentCount)

	var activeSubscription models.Subscription
	hasActiveSubscription := config.DB.Where("user_id = ? AND status IN (?)",
		user.ID, []string{"active", "trialing"}).First(&activeSubscription).Error == nil

	c.JSON(http.StatusOK, gin.H{
		"user": gin.H{
			"id":           user.ID,
			"email":        user.Email,
			"company":      user.Company,
			"businessType": user.BusinessType,
			"businessSize": user.BusinessSize,
			"phoneNumber":  user.PhoneNumber,
			"createdAt":    user.CreatedAt,
		},
		"stats": gin.H{
			"agentCount": agentCount,
		},
		"subscription": gin.H{
			"hasActive": hasActiveSubscription,
		},
		"googleCloud": gin.H{
			"hasProject":    user.HasGoogleCloudProject(),
			"projectStatus": user.GetGCPProjectStatus(),
			"hasAPIKey":     user.GetGeminiAPIKey() != "",
		},
	})
}

// UpdateUserProfile actualiza el perfil del usuario
func UpdateUserProfile(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "No autenticado",
		})
		return
	}

	user := userInterface.(*models.User)

	type UpdateProfileRequest struct {
		Company      string `json:"company"`
		BusinessType string `json:"businessType"`
		BusinessSize string `json:"businessSize"`
		PhoneNumber  string `json:"phoneNumber"`
	}

	var req UpdateProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "Datos inválidos",
			"details": err.Error(),
		})
		return
	}

	// Actualizar campos si no están vacíos
	if req.Company != "" {
		user.Company = req.Company
	}
	if req.BusinessType != "" {
		user.BusinessType = req.BusinessType
	}
	if req.BusinessSize != "" {
		// Validar businessSize
		validSizes := map[string]bool{
			"microempresa": true,
			"pequena":      true,
			"mediana":      true,
			"grande":       true,
		}
		if validSizes[req.BusinessSize] {
			user.BusinessSize = req.BusinessSize
		}
	}
	if req.PhoneNumber != "" {
		user.PhoneNumber = req.PhoneNumber
	}

	// Guardar en BD
	if err := config.DB.Save(&user).Error; err != nil {
		log.Printf("❌ [User %d] Error actualizando perfil: %v", user.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Error al actualizar perfil",
		})
		return
	}

	log.Printf("✅ [User %d] Perfil actualizado exitosamente", user.ID)

	c.JSON(http.StatusOK, gin.H{
		"message": "Perfil actualizado exitosamente",
		"user": gin.H{
			"id":           user.ID,
			"email":        user.Email,
			"company":      user.Company,
			"businessType": user.BusinessType,
			"businessSize": user.BusinessSize,
			"phoneNumber":  user.PhoneNumber,
		},
	})
}

// VerifyPassword verifica si una contraseña es correcta
func VerifyPassword(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "No autenticado",
		})
		return
	}

	user := userInterface.(*models.User)

	type VerifyPasswordRequest struct {
		Password string `json:"password" binding:"required"`
	}

	var req VerifyPasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Contraseña requerida",
		})
		return
	}

	// Verificar contraseña
	err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password))
	valid := err == nil

	c.JSON(http.StatusOK, gin.H{
		"valid": valid,
	})
}

// RequestPasswordReset solicita un restablecimiento de contraseña
func RequestPasswordReset(c *gin.Context) {
	type ResetRequest struct {
		Email string `json:"email" binding:"required,email"`
	}

	var req ResetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Email inválido",
		})
		return
	}

	var user models.User
	if err := config.DB.Where("email = ?", req.Email).First(&user).Error; err != nil {
		// No revelar si el email existe o no (seguridad)
		c.JSON(http.StatusOK, gin.H{
			"message": "Si el email existe, recibirás instrucciones para restablecer tu contraseña",
		})
		return
	}

	// TODO: Implementar envío de email con token de restablecimiento
	log.Printf("📧 [User %d] Solicitud de restablecimiento de contraseña: %s", user.ID, user.Email)

	c.JSON(http.StatusOK, gin.H{
		"message": "Si el email existe, recibirás instrucciones para restablecer tu contraseña",
	})
}

// ResetPassword restablece la contraseña con un token
func ResetPassword(c *gin.Context) {
	type ResetPasswordRequest struct {
		Token       string `json:"token" binding:"required"`
		NewPassword string `json:"newPassword" binding:"required,min=8"`
	}

	var req ResetPasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Datos inválidos",
		})
		return
	}

	// TODO: Implementar validación de token y actualización de contraseña
	log.Printf("🔐 Intento de restablecimiento de contraseña con token: %s", req.Token)

	c.JSON(http.StatusNotImplemented, gin.H{
		"error": "Funcionalidad no implementada aún",
	})
}

// GetServerInfo obtiene información básica del usuario (compatibilidad)
func GetServerInfo(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "No autenticado",
		})
		return
	}

	user := userInterface.(*models.User)

	c.JSON(http.StatusOK, gin.H{
		"server": gin.H{
			"id":       0,
			"ip":       "",
			"status":   "not_applicable",
			"hasSSH":   false,
			"sshUser":  "",
			"endpoint": fmt.Sprintf("https://api.attomos.com/user/%d", user.ID),
		},
	})
}
