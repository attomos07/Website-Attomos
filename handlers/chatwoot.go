package handlers

import (
	"net/http"

	"attomos/config"
	"attomos/models"

	"github.com/gin-gonic/gin"
)

// GetChatwootInfo obtiene la información de Chatwoot del primer agente del usuario
func GetChatwootInfo(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "No autenticado",
		})
		return
	}

	user := userInterface.(*models.User)

	// Buscar el primer agente con Chatwoot configurado
	var agent models.Agent
	result := config.DB.Where("user_id = ? AND chatwoot_url != '' AND chatwoot_url IS NOT NULL", user.ID).
		Order("created_at ASC").
		First(&agent)

	// Si no hay agentes con Chatwoot configurado
	if result.Error != nil {
		c.JSON(http.StatusOK, gin.H{
			"hasChatwoot": false,
			"chatwootUrl": "",
		})
		return
	}

	// Si hay Chatwoot configurado
	c.JSON(http.StatusOK, gin.H{
		"hasChatwoot": true,
		"chatwootUrl": agent.ChatwootURL,
	})
}
