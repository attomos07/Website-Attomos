package handlers

// bot_business_config_handler.go — GET /api/bot/business-config/:agent_id
//
// El bot lo llama al arrancar y luego cada 5 min (polling de respaldo) o al
// recibir "refresh_business_config" por el WebSocket del CRM bridge — ver
// src.StartBusinessConfigPolling() y crm_bridge.go en el repo del bot.
//
// Mismo patrón de auth que /api/bot/orders (orders.go) y
// /api/bot/api-explorer/:agent_id: Authorization: Bearer BOT_API_TOKEN.
// Servidor-a-servidor, nunca se expone al navegador.
//
// Registrar junto a las demás rutas /api/bot/* en tu main.go:
//   router.GET("/api/bot/business-config/:agent_id", handlers.GetBotBusinessConfig)

import (
	"net/http"
	"os"
	"strconv"

	"attomos/config"
	"attomos/models"

	"attomos/bots"
	"github.com/gin-gonic/gin"
)

// GetBotBusinessConfig sirve el business_config del agente para que lo
// consuma el bot directamente (reemplaza el business_config.json que antes
// se escribía por SFTP en el deploy/UpdateBusinessConfig).
func GetBotBusinessConfig(c *gin.Context) {
	botToken := os.Getenv("BOT_API_TOKEN")
	if botToken == "" || c.GetHeader("Authorization") != "Bearer "+botToken {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Token inválido"})
		return
	}

	agentIDParam := c.Param("agent_id")
	agentID, err := strconv.ParseUint(agentIDParam, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "agent_id inválido"})
		return
	}

	var agent models.Agent
	if err := config.DB.First(&agent, uint(agentID)).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "agente no encontrado"})
		return
	}

	// Sucursal vinculada (fuente de verdad del negocio), si existe —
	// mismo criterio que ya usaba generateBusinessConfig.
	var branch *models.MyBusinessInfo
	if agent.BranchID > 0 {
		var b models.MyBusinessInfo
		if err := config.DB.First(&b, agent.BranchID).Error; err == nil {
			branch = &b
		}
	}

	businessConfig := bots.GenerateBusinessConfig(&agent, branch)
	c.JSON(http.StatusOK, businessConfig)
}
