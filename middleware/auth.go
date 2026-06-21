package middleware

import (
	"net/http"
	"strings"

	"attomos/models"
	"attomos/utils"

	"github.com/gin-gonic/gin"
)

// AuthRequired middleware que verifica si el usuario está autenticado
func AuthRequired() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Intentar obtener token de la cookie
		token, err := c.Cookie("auth_token")

		// Si no está en cookie, buscar en header Authorization
		if err != nil || token == "" {
			authHeader := c.GetHeader("Authorization")
			if authHeader != "" {
				// Formato: "Bearer <token>"
				parts := strings.Split(authHeader, " ")
				if len(parts) == 2 && parts[0] == "Bearer" {
					token = parts[1]
				}
			}
		}

		// Si no hay token
		if token == "" {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error": "Token de autenticación requerido",
			})
			c.Abort()
			return
		}

		// Validar token — el JWT ya contiene userID y email, no necesitamos ir a DB
		claims, err := utils.ValidateToken(token)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error": "Token inválido o expirado",
			})
			c.Abort()
			return
		}

		// Construir usuario mínimo desde los claims del JWT (sin query a DB)
		user := &models.User{}
		user.ID = claims.UserID
		user.Email = claims.Email

		// Establecer usuario en el contexto
		c.Set("user", user)
		c.Set("userId", user.ID)

		c.Next()
	}
}
