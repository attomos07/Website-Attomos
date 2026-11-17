package middleware

import (
	"net/http"
	"strings"

	"attomos/models"

	"attomos/auth"

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
		claims, err := auth.ValidateToken(token)
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

		// Cuenta del equipo (recepción, optometría…): trabaja en el negocio
		// del dueño (user.ID = dueño) pero solo puede abrir lo de sus roles.
		// Se revisa en la base en cada petición, así que si el dueño la
		// desactiva, la borra o le quita un rol, aplica al instante.
		if claims.StaffID > 0 {
			staff, err := models.GetActiveStaff(claims.UserID, claims.StaffID)
			if err != nil {
				c.SetCookie("auth_token", "", -1, "/", "", false, true)
				if !strings.HasPrefix(c.Request.URL.Path, "/api/") {
					c.Redirect(http.StatusFound, "/equipo/login")
				} else {
					c.JSON(http.StatusUnauthorized, gin.H{"error": "Tu cuenta ya no está activa. Pide acceso al dueño del negocio."})
				}
				c.Abort()
				return
			}
			if !staff.StaffCanAccess(c.Request.Method, c.Request.URL.Path) {
				if !strings.HasPrefix(c.Request.URL.Path, "/api/") && c.Request.Method == http.MethodGet {
					c.Redirect(http.StatusFound, staff.Home())
				} else {
					c.JSON(http.StatusForbidden, gin.H{"error": "Tu usuario no tiene permiso para esto."})
				}
				c.Abort()
				return
			}
			c.Set("staff", staff)
		}

		// Establecer usuario en el contexto
		c.Set("user", user)
		c.Set("userId", user.ID)

		c.Next()
	}
}
