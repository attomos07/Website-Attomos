package handlers

// agent_response_mode.go — Cambiar entre IA y botones desde Detalles del
// agente, sin tocar nombre, teléfono ni el resto de la configuración.
//
//	PUT /api/agents/:id/response-mode   {"mode": "ai" | "buttons"}
//
// El bot toma el cambio al instante (refresh_business_config por el CRM
// bridge) o, si no está conectado, en su siguiente recarga (≤ 5 min).

import (
	"net/http"

	"attomos/config"
	"attomos/models"
	"attomos/realtime"

	"github.com/gin-gonic/gin"
)

func SetAgentResponseMode(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}
	user := userInterface.(*models.User)

	var req struct {
		Mode string `json:"mode"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || (req.Mode != "ai" && req.Mode != "buttons") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "El modo debe ser \"ai\" o \"buttons\""})
		return
	}

	var agent models.Agent
	if err := config.DB.Where("id = ? AND user_id = ?", c.Param("id"), user.ID).First(&agent).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Agente no encontrado"})
		return
	}
	agent.Config.ResponseMode = req.Mode
	if err := config.DB.Model(&agent).Update("config", agent.Config).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "No se pudo guardar"})
		return
	}
	live := realtime.CRMHub.SendToBot(agent.ID, realtime.CRMSendCommand{Type: "refresh_business_config"})

	// Para avisar en la página si eligió IA pero no hay clave de Gemini.
	var fu models.User
	hasKey := config.DB.Preload("GoogleCloudProject").First(&fu, user.ID).Error == nil && fu.GetGeminiAPIKey() != ""

	c.JSON(http.StatusOK, gin.H{"success": true, "mode": req.Mode, "applied": live, "hasGeminiKey": hasKey})
}
