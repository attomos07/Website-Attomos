package handlers

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"time"

	"attomos/config"
	"attomos/models"
	"attomos/services"
	"attomos/utils"

	"github.com/gin-gonic/gin"
)

var googleOAuthService *services.GoogleOAuthService

// InitGoogleOAuth inicializa el servicio de OAuth de Google
func InitGoogleOAuth() error {
	service, err := services.NewGoogleOAuthService()
	if err != nil {
		return err
	}
	googleOAuthService = service
	log.Println("✅ Google OAuth inicializado")
	return nil
}

// GoogleLogin redirige al usuario a la página de login de Google
func GoogleLogin(c *gin.Context) {
	if googleOAuthService == nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Servicio de Google OAuth no inicializado",
		})
		return
	}

	// Generar token de estado para CSRF protection
	state := services.GenerateStateToken()

	// Guardar state en cookie (temporal, 5 minutos)
	c.SetCookie("oauth_state", state, 300, "/", "", false, true)

	// Obtener URL de autenticación de Google
	authURL := googleOAuthService.GetAuthURL(state)

	// Redirigir a Google
	c.Redirect(http.StatusTemporaryRedirect, authURL)
}

// GoogleCallback maneja el callback de Google después de la autenticación
func GoogleCallback(c *gin.Context) {
	if googleOAuthService == nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Servicio de Google OAuth no inicializado",
		})
		return
	}

	// Verificar state (CSRF protection)
	state := c.Query("state")
	savedState, err := c.Cookie("oauth_state")
	if err != nil || state != savedState {
		log.Printf("❌ Error de validación de state: state=%s, savedState=%s", state, savedState)
		c.Redirect(http.StatusTemporaryRedirect, "/login?error=invalid_state")
		return
	}

	// Limpiar cookie de state
	c.SetCookie("oauth_state", "", -1, "/", "", false, true)

	// Obtener código de autorización
	code := c.Query("code")
	if code == "" {
		log.Println("❌ No se recibió código de autorización")
		c.Redirect(http.StatusTemporaryRedirect, "/login?error=no_code")
		return
	}

	// Intercambiar código por token
	ctx := context.Background()
	token, err := googleOAuthService.ExchangeCode(ctx, code)
	if err != nil {
		log.Printf("❌ Error intercambiando código: %v", err)
		c.Redirect(http.StatusTemporaryRedirect, "/login?error=token_exchange_failed")
		return
	}

	// Obtener información del usuario
	userInfo, err := googleOAuthService.GetUserInfo(ctx, token)
	if err != nil {
		log.Printf("❌ Error obteniendo info del usuario: %v", err)
		c.Redirect(http.StatusTemporaryRedirect, "/login?error=user_info_failed")
		return
	}

	log.Printf("✅ Usuario de Google autenticado: %s (%s)", userInfo.Name, userInfo.Email)

	// Verificar si el usuario ya existe
	var user models.User
	result := config.DB.Preload("GoogleCloudProject").Where("email = ?", userInfo.Email).First(&user)

	if result.Error != nil {
		// Usuario no existe, crear cuenta nueva
		user = models.User{
			Email:        userInfo.Email,
			Company:      userInfo.Name, // Usar nombre completo como company
			BusinessType: "otro",
			BusinessSize: "microempresa", // Valor por defecto
			PhoneNumber:  "",
		}

		// Generar contraseña aleatoria (no será usada, pero es requerida)
		randomPassword := fmt.Sprintf("google_%d", time.Now().UnixNano())
		if err := user.HashPassword(randomPassword); err != nil {
			log.Printf("❌ Error hasheando contraseña: %v", err)
			c.Redirect(http.StatusTemporaryRedirect, "/login?error=password_hash_failed")
			return
		}

		// Guardar usuario en BD
		if err := config.DB.Create(&user).Error; err != nil {
			log.Printf("❌ Error creando usuario: %v", err)
			c.Redirect(http.StatusTemporaryRedirect, "/login?error=user_creation_failed")
			return
		}

		// Crear suscripción básica
		now := time.Now()
		trialEnd := now.AddDate(0, 0, 30)
		subscription := models.Subscription{
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
		config.DB.Create(&subscription)

		log.Printf("✅ [User %d] Nuevo usuario creado desde Google: %s", user.ID, user.Email)
	} else {
		log.Printf("✅ [User %d] Usuario existente autenticado desde Google: %s", user.ID, user.Email)
	}

	// Generar token JWT
	jwtToken, err := utils.GenerateToken(user.ID, user.Email)
	if err != nil {
		log.Printf("❌ Error generando token: %v", err)
		c.Redirect(http.StatusTemporaryRedirect, "/login?error=token_generation_failed")
		return
	}

	// Establecer cookie de autenticación
	c.SetCookie("auth_token", jwtToken, 3600*24, "/", "", false, true)

	// Redirigir al dashboard
	c.Redirect(http.StatusTemporaryRedirect, "/dashboard")
}
