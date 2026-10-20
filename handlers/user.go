package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"strings"
	"time"

	"attomos/config"
	"attomos/models"

	"attomos/google"
	"attomos/mailer"
	"attomos/payments"
	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

type UpdatePasswordRequest struct {
	NewPassword string `json:"newPassword" binding:"required,min=8"`
}

// UpdatePassword actualiza la contraseña del usuario.
// NOTA: por decisión de producto, ya NO se exige la contraseña actual —
// el usuario ya está autenticado (cookie de sesión) al llegar a este
// endpoint, así que basta con eso para permitirle cambiarla. Esto cubre
// el caso de clientes que perdieron su contraseña y no hay forma de
// verificarla de otra manera.
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
			stripeService, err := payments.NewStripeService()
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
		gcpService, err := google.NewGoogleCloudAutomation()
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

// UpdateEmailRequest payload para cambiar el correo del usuario
type UpdateEmailRequest struct {
	NewEmail string `json:"newEmail" binding:"required,email"`
}

// UpdateEmail actualiza el correo con el que el usuario inicia sesión.
// Al igual que UpdatePassword, no exige contraseña actual: basta con la
// sesión autenticada.
func UpdateEmail(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "No autenticado",
		})
		return
	}

	user := userInterface.(*models.User)

	var req UpdateEmailRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "Correo inválido",
			"details": err.Error(),
		})
		return
	}

	newEmail := strings.ToLower(strings.TrimSpace(req.NewEmail))

	if newEmail == strings.ToLower(user.Email) {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Ese ya es tu correo actual",
		})
		return
	}

	// Verificar que el correo no esté en uso por otro usuario (Email tiene uniqueIndex en BD)
	var existing models.User
	err := config.DB.Where("email = ? AND id != ?", newEmail, user.ID).First(&existing).Error
	if err == nil {
		c.JSON(http.StatusConflict, gin.H{
			"error": "Ese correo ya está en uso por otra cuenta",
		})
		return
	} else if err != gorm.ErrRecordNotFound {
		log.Printf("❌ [User %d] Error verificando correo duplicado: %v", user.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Error al actualizar correo",
		})
		return
	}

	oldEmail := user.Email
	user.Email = newEmail

	if err := config.DB.Save(&user).Error; err != nil {
		log.Printf("❌ [User %d] Error guardando nuevo correo: %v", user.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Error al actualizar correo",
		})
		return
	}

	log.Printf("✅ [User %d] Correo actualizado: %s → %s", user.ID, oldEmail, newEmail)

	c.JSON(http.StatusOK, gin.H{
		"message": "Correo actualizado exitosamente",
		"email":   user.Email,
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

// ============================================
// RECUPERACIÓN DE CONTRASEÑA (código de 4 dígitos por correo)
// ============================================

func generateResetCode() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(10000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%04d", n.Int64()), nil
}

func generateResetToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// RequestPasswordReset genera un código de 4 dígitos, lo guarda hasheado y
// lo envía por correo (Zoho SMTP). Nunca revela si el correo existe o no.
func RequestPasswordReset(c *gin.Context) {
	type ResetRequest struct {
		Email string `json:"email" binding:"required,email"`
	}

	var req ResetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Correo inválido",
		})
		return
	}

	genericResp := gin.H{
		"message": "Si el correo existe, te enviamos un código de verificación",
	}

	email := strings.ToLower(strings.TrimSpace(req.Email))

	var user models.User
	if err := config.DB.Where("email = ?", email).First(&user).Error; err != nil {
		// No revelar si el correo existe o no (seguridad)
		c.JSON(http.StatusOK, genericResp)
		return
	}

	// Debounce: si ya se pidió un código hace menos de 60s, no reenviar
	// (evita spam y coincide con el temporizador de "Reenviar" del frontend)
	var recent models.PasswordReset
	cutoff := time.Now().Add(-60 * time.Second)
	if err := config.DB.Where("user_id = ? AND created_at > ?", user.ID, cutoff).
		Order("created_at DESC").First(&recent).Error; err == nil {
		c.JSON(http.StatusOK, genericResp)
		return
	}

	code, err := generateResetCode()
	if err != nil {
		log.Printf("❌ Error generando código de reset: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al generar código"})
		return
	}

	codeHash, err := bcrypt.GenerateFromPassword([]byte(code), bcrypt.DefaultCost)
	if err != nil {
		log.Printf("❌ Error hasheando código de reset: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al generar código"})
		return
	}

	// Invalidar códigos previos sin usar de este usuario
	config.DB.Where("user_id = ? AND verified = ?", user.ID, false).Delete(&models.PasswordReset{})

	pr := models.PasswordReset{
		UserID:    user.ID,
		Email:     user.Email,
		CodeHash:  string(codeHash),
		ExpiresAt: time.Now().Add(30 * time.Minute),
	}
	if err := config.DB.Create(&pr).Error; err != nil {
		log.Printf("❌ Error guardando código de reset: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al generar código"})
		return
	}

	emailService := mailer.NewEmailService()
	if err := emailService.SendPasswordResetCode(user.Email, code); err != nil {
		log.Printf("❌ [User %d] Error enviando correo de recuperación: %v", user.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "No se pudo enviar el correo, intenta de nuevo en unos minutos",
		})
		return
	}

	log.Printf("📧 [User %d] Código de recuperación enviado a %s", user.ID, user.Email)
	c.JSON(http.StatusOK, genericResp)
}

// VerifyPasswordResetCode valida el código de 4 dígitos y, si es correcto,
// entrega un token de un solo uso (válido 10 min) para completar el cambio.
func VerifyPasswordResetCode(c *gin.Context) {
	type VerifyRequest struct {
		Email string `json:"email" binding:"required,email"`
		Code  string `json:"code" binding:"required,len=4"`
	}

	var req VerifyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Ingresa el código completo de 4 dígitos"})
		return
	}

	email := strings.ToLower(strings.TrimSpace(req.Email))

	var pr models.PasswordReset
	err := config.DB.Where("email = ? AND verified = ?", email, false).
		Order("created_at DESC").First(&pr).Error
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Código inválido o expirado, solicita uno nuevo"})
		return
	}

	if time.Now().After(pr.ExpiresAt) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "El código expiró, solicita uno nuevo"})
		return
	}

	if pr.Attempts >= 5 {
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "Demasiados intentos fallidos, solicita un nuevo código"})
		return
	}

	if bcrypt.CompareHashAndPassword([]byte(pr.CodeHash), []byte(req.Code)) != nil {
		pr.Attempts++
		config.DB.Save(&pr)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Código incorrecto"})
		return
	}

	token, err := generateResetToken()
	if err != nil {
		log.Printf("❌ Error generando token de reset: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al verificar código"})
		return
	}

	pr.Verified = true
	pr.Token = token
	pr.ExpiresAt = time.Now().Add(10 * time.Minute) // ventana corta para completar el cambio de contraseña
	if err := config.DB.Save(&pr).Error; err != nil {
		log.Printf("❌ Error guardando verificación de código: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al verificar código"})
		return
	}

	log.Printf("✅ [User %d] Código de recuperación verificado", pr.UserID)

	c.JSON(http.StatusOK, gin.H{
		"message":    "Código verificado",
		"resetToken": token,
	})
}

// ResetPassword completa la recuperación: valida el resetToken emitido por
// VerifyPasswordResetCode y actualiza la contraseña del usuario.
func ResetPassword(c *gin.Context) {
	type ResetPasswordRequest struct {
		ResetToken  string `json:"resetToken" binding:"required"`
		NewPassword string `json:"newPassword" binding:"required,min=8"`
	}

	var req ResetPasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos inválidos"})
		return
	}

	var pr models.PasswordReset
	if err := config.DB.Where("token = ? AND verified = ?", req.ResetToken, true).First(&pr).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "El enlace de recuperación es inválido, solicita uno nuevo"})
		return
	}

	if time.Now().After(pr.ExpiresAt) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "El enlace de recuperación expiró, solicita uno nuevo"})
		return
	}

	var user models.User
	if err := config.DB.First(&user, pr.UserID).Error; err != nil {
		log.Printf("❌ Error obteniendo usuario %d para reset: %v", pr.UserID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al actualizar contraseña"})
		return
	}

	if err := user.HashPassword(req.NewPassword); err != nil {
		log.Printf("❌ Error hasheando nueva contraseña: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al actualizar contraseña"})
		return
	}

	if err := config.DB.Save(&user).Error; err != nil {
		log.Printf("❌ Error guardando nueva contraseña: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al actualizar contraseña"})
		return
	}

	// Invalidar cualquier código/token pendiente de este usuario
	config.DB.Where("user_id = ?", user.ID).Delete(&models.PasswordReset{})

	log.Printf("✅ [User %d] Contraseña restablecida vía recuperación por correo", user.ID)

	c.JSON(http.StatusOK, gin.H{
		"message": "Contraseña actualizada exitosamente",
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
