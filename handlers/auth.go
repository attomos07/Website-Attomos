package handlers

import (
	"log"
	"net/http"
	"strings"

	"attomos/config"
	"attomos/models"
	"attomos/utils"

	"github.com/gin-gonic/gin"
)

type RegisterRequest struct {
	BusinessName string `json:"businessName" binding:"required"`
	PhoneNumber  string `json:"phoneNumber" binding:"required"`
	Email        string `json:"email" binding:"required,email"`
	Password     string `json:"password" binding:"required,min=8"`
	BusinessType string `json:"businessType" binding:"required"`
	BusinessSize string `json:"businessSize" binding:"required"`
}

type LoginRequest struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required"`
}

// Register registra un nuevo usuario
func Register(c *gin.Context) {
	var req RegisterRequest

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "Datos inválidos",
			"details": err.Error(),
		})
		return
	}

	// Limpiar y validar datos
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	req.PhoneNumber = strings.TrimSpace(req.PhoneNumber)
	req.BusinessName = strings.TrimSpace(req.BusinessName)
	req.BusinessType = strings.TrimSpace(req.BusinessType)
	req.BusinessSize = strings.TrimSpace(req.BusinessSize)

	validSizes := map[string]bool{
		"microempresa": true,
		"pequena":      true,
		"mediana":      true,
		"grande":       true,
	}

	if !validSizes[req.BusinessSize] {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Tamaño de empresa no válido. Valores permitidos: microempresa, pequena, mediana, grande",
		})
		return
	}

	// Verificar si el email ya existe
	var existingUser models.User
	if err := config.DB.Where("email = ?", req.Email).First(&existingUser).Error; err == nil {
		c.JSON(http.StatusConflict, gin.H{
			"error": "Este email ya está registrado",
		})
		return
	}

	// Crear usuario
	user := models.User{
		Email:        req.Email,
		Company:      req.BusinessName,
		BusinessType: req.BusinessType,
		BusinessSize: req.BusinessSize,
		PhoneNumber:  req.PhoneNumber,
	}

	if err := user.HashPassword(req.Password); err != nil {
		log.Printf("❌ Error al hashear contraseña: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Error al procesar la contraseña",
		})
		return
	}

	if err := config.DB.Create(&user).Error; err != nil {
		log.Printf("❌ Error creando usuario: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Error al crear la cuenta",
		})
		return
	}

	log.Printf("✅ [User %d] Usuario creado exitosamente: %s (Tel: %s, Negocio: %s, Tamaño: %s)",
		user.ID, user.Email, user.PhoneNumber, user.Company, user.BusinessSize)

	// ============================================================
	// NUEVO: Crear perfil de negocio automáticamente al registrar
	// ============================================================
	businessInfo := models.MyBusinessInfo{
		UserID:       user.ID,
		BranchNumber: 1,
		BranchName:   "Sucursal 1",
		BusinessName: req.BusinessName,
		BusinessType: req.BusinessType,
		BusinessSize: req.BusinessSize,
		PhoneNumber:  req.PhoneNumber,
		Schedule: models.BusinessSchedule{
			Monday:    models.DaySchedule{Open: true, Start: "09:00", End: "20:00"},
			Tuesday:   models.DaySchedule{Open: true, Start: "09:00", End: "20:00"},
			Wednesday: models.DaySchedule{Open: true, Start: "09:00", End: "20:00"},
			Thursday:  models.DaySchedule{Open: true, Start: "09:00", End: "20:00"},
			Friday:    models.DaySchedule{Open: true, Start: "09:00", End: "20:00"},
			Saturday:  models.DaySchedule{Open: true, Start: "09:00", End: "14:00"},
			Sunday:    models.DaySchedule{Open: false, Start: "09:00", End: "14:00"},
			Timezone:  "America/Hermosillo",
		},
	}

	if err := config.DB.Create(&businessInfo).Error; err != nil {
		// No es crítico, solo loggear — el usuario ya fue creado
		log.Printf("⚠️  [User %d] Error creando perfil de negocio (no crítico): %v", user.ID, err)
	} else {
		log.Printf("✅ [User %d] Perfil de negocio creado: %s (%s)", user.ID, req.BusinessName, req.BusinessType)
	}
	// ============================================================

	token, err := utils.GenerateToken(user.ID, user.Email)
	if err != nil {
		log.Printf("❌ Error generando token: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Error al generar token",
		})
		return
	}

	c.SetCookie("auth_token", token, 3600*24, "/", "", false, true)

	c.JSON(http.StatusCreated, gin.H{
		"message":  "Cuenta creada exitosamente",
		"token":    token,
		"redirect": "/select-plan",
		"user": gin.H{
			"id":           user.ID,
			"email":        user.Email,
			"company":      user.Company,
			"businessType": user.BusinessType,
			"businessSize": user.BusinessSize,
			"phoneNumber":  user.PhoneNumber,
		},
		"info": "Selecciona tu plan para continuar",
	})
}

// Login autentica un usuario
func Login(c *gin.Context) {
	var req LoginRequest

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "Datos inválidos",
			"details": err.Error(),
		})
		return
	}

	req.Email = strings.ToLower(strings.TrimSpace(req.Email))

	var user models.User
	if err := config.DB.Preload("GoogleCloudProject").Where("email = ?", req.Email).First(&user).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "Credenciales inválidas",
		})
		return
	}

	if !user.CheckPassword(req.Password) {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "Credenciales inválidas",
		})
		return
	}

	token, err := utils.GenerateToken(user.ID, user.Email)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Error al generar token",
		})
		return
	}

	c.SetCookie("auth_token", token, 3600*24, "/", "", false, true)

	c.JSON(http.StatusOK, gin.H{
		"message": "Inicio de sesión exitoso",
		"token":   token,
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

// Logout cierra la sesión del usuario
func Logout(c *gin.Context) {
	c.SetCookie("auth_token", "", -1, "/", "", false, true)
	c.JSON(http.StatusOK, gin.H{
		"message": "Sesión cerrada exitosamente",
	})
}

// GetCurrentUser obtiene la información del usuario actual
func GetCurrentUser(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}

	// El middleware solo pone ID y Email desde el JWT.
	// Aquí hacemos UNA sola query con todo lo que necesitamos.
	userFromCtx := userInterface.(*models.User)
	var user models.User
	if err := config.DB.Preload("GoogleCloudProject").First(&user, userFromCtx.ID).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Usuario no encontrado"})
		return
	}

	var subscription models.Subscription
	currentPlan := "gratuito"
	if err := config.DB.Where("user_id = ?", user.ID).First(&subscription).Error; err == nil {
		if subscription.Plan != "" && subscription.Plan != "pending" {
			currentPlan = subscription.Plan
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"user": gin.H{
			"id":            user.ID,
			"email":         user.Email,
			"company":       user.Company,
			"businessType":  user.BusinessType,
			"businessSize":  user.BusinessSize,
			"phoneNumber":   user.PhoneNumber,
			"projectStatus": user.GetGCPProjectStatus(),
			"currentPlan":   currentPlan,
		},
	})
}

// GetProjectStatus retorna el estado del proyecto GCP del usuario
func GetProjectStatus(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}

	user := userInterface.(*models.User)

	var gcpProject models.GoogleCloudProject
	err := config.DB.Where("user_id = ?", user.ID).First(&gcpProject).Error

	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"projectStatus": "pending",
			"hasProject":    false,
			"hasAPIKey":     false,
			"ready":         false,
			"message":       "Tu proyecto de Google Cloud se creará cuando crees tu primer agente",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"projectStatus": gcpProject.ProjectStatus,
		"hasProject":    gcpProject.ProjectID != "",
		"hasAPIKey":     gcpProject.GeminiAPIKey != "",
		"ready":         gcpProject.IsReady(),
		"message":       gcpProject.GetStatusMessage(),
	})
}
