package middleware

import (
	"crypto/sha256"
	"fmt"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
)

func getAdminSessionToken() string {
	secret := os.Getenv("ADMIN_SESSION_SECRET")
	if secret == "" {
		secret = "attomos-admin-fallback-secret"
	}
	h := sha256.Sum256([]byte(secret))
	return fmt.Sprintf("%x", h)
}

// AdminRequired verifica que la sesión de admin esté activa (cookie "admin_session")
func AdminRequired() gin.HandlerFunc {
	return func(c *gin.Context) {
		token, err := c.Cookie("admin_session")
		if err != nil || token == "" {
			c.Redirect(http.StatusFound, "/admin/login")
			c.Abort()
			return
		}

		// Validar que el token sea el que generamos al hacer login
		expected := getAdminSessionToken()
		if token != expected {
			c.SetCookie("admin_session", "", -1, "/", "", false, true)
			c.Redirect(http.StatusFound, "/admin/login")
			c.Abort()
			return
		}

		c.Next()
	}
}
