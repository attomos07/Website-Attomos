package handlers

import (
	"log"
	"net/http"

	"attomos/config"
	"attomos/models"
	"attomos/services"

	"github.com/gin-gonic/gin"
)

type SaveGeminiKeyRequest struct {
	APIKey string `json:"apiKey" binding:"required"`
}

// SaveGeminiKey guarda la API Key de Gemini en el .env del bot (solo AtomicBot).
// OrbitalBot recibe la key de GCP en el momento del deploy; no se gestiona aquí.
func SaveGeminiKey(c *gin.Context) {
	agentID := c.Param("agent_id")

	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}
	user := userInterface.(*models.User)

	var agent models.Agent
	if err := config.DB.Where("id = ? AND user_id = ?", agentID, user.ID).First(&agent).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Agente no encontrado"})
		return
	}

	if !agent.IsAtomicBot() {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "OrbitalBot gestiona Gemini automáticamente vía GCP. No se puede actualizar manualmente.",
		})
		return
	}

	var req SaveGeminiKeyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos inválidos", "details": err.Error()})
		return
	}

	if len(req.APIKey) < 30 || req.APIKey[:6] != "AIzaSy" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "API Key inválida. Debe comenzar con 'AIzaSy'"})
		return
	}

	log.Printf("💾 [Agent %d] Guardando Gemini API Key...", agent.ID)

	serverManager := services.GetGlobalServerManager()
	servers, err := serverManager.ListAllServers()
	if err != nil || len(servers) == 0 {
		log.Printf("❌ [Agent %d] No se encontró servidor compartido", agent.ID)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Servidor compartido no disponible"})
		return
	}

	globalServer := servers[0]
	atomicService := services.NewAtomicBotDeployService(globalServer.IPAddress, globalServer.RootPassword)
	if err := atomicService.Connect(); err != nil {
		log.Printf("❌ [Agent %d] Error conectando a servidor: %v", agent.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error conectando al servidor"})
		return
	}
	defer atomicService.Close()

	if err := atomicService.UpdateGeminiAPIKey(&agent, req.APIKey); err != nil {
		log.Printf("❌ [Agent %d] Error actualizando API Key: %v", agent.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error guardando API Key en el servidor"})
		return
	}

	log.Printf("✅ [Agent %d] Gemini API Key guardada exitosamente", agent.ID)
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "API Key guardada exitosamente"})
}

// RemoveGeminiKey elimina la API Key de Gemini del .env del bot (solo AtomicBot).
func RemoveGeminiKey(c *gin.Context) {
	agentID := c.Param("agent_id")

	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}
	user := userInterface.(*models.User)

	var agent models.Agent
	if err := config.DB.Where("id = ? AND user_id = ?", agentID, user.ID).First(&agent).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Agente no encontrado"})
		return
	}

	if !agent.IsAtomicBot() {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "OrbitalBot gestiona Gemini automáticamente vía GCP. No se puede eliminar manualmente.",
		})
		return
	}

	log.Printf("🗑️  [Agent %d] Eliminando Gemini API Key...", agent.ID)

	serverManager := services.GetGlobalServerManager()
	servers, err := serverManager.ListAllServers()
	if err != nil || len(servers) == 0 {
		log.Printf("❌ [Agent %d] No se encontró servidor compartido", agent.ID)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Servidor compartido no disponible"})
		return
	}

	globalServer := servers[0]
	atomicService := services.NewAtomicBotDeployService(globalServer.IPAddress, globalServer.RootPassword)
	if err := atomicService.Connect(); err != nil {
		log.Printf("❌ [Agent %d] Error conectando a servidor: %v", agent.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error conectando al servidor"})
		return
	}
	defer atomicService.Close()

	if err := atomicService.UpdateGeminiAPIKey(&agent, ""); err != nil {
		log.Printf("❌ [Agent %d] Error eliminando API Key: %v", agent.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error eliminando API Key del servidor"})
		return
	}

	log.Printf("✅ [Agent %d] Gemini API Key eliminada exitosamente", agent.ID)
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "API Key eliminada exitosamente"})
}

// GetGeminiStatus retorna si el agente tiene Gemini configurado.
// OrbitalBot siempre retorna true (la key viene del deploy vía GCP).
// AtomicBot verifica el .env en el servidor compartido.
func GetGeminiStatus(c *gin.Context) {
	agentID := c.Param("agent_id")

	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}
	user := userInterface.(*models.User)

	var agent models.Agent
	if err := config.DB.Where("id = ? AND user_id = ?", agentID, user.ID).First(&agent).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Agente no encontrado"})
		return
	}

	// OrbitalBot siempre tiene Gemini (se configura en el deploy vía GCP)
	if !agent.IsAtomicBot() {
		c.JSON(http.StatusOK, gin.H{"has_api_key": true})
		return
	}

	// AtomicBot: verificar .env en servidor compartido
	serverManager := services.GetGlobalServerManager()
	servers, err := serverManager.ListAllServers()
	if err != nil || len(servers) == 0 {
		c.JSON(http.StatusOK, gin.H{"has_api_key": false})
		return
	}

	globalServer := servers[0]
	atomicService := services.NewAtomicBotDeployService(globalServer.IPAddress, globalServer.RootPassword)
	if err := atomicService.Connect(); err != nil {
		c.JSON(http.StatusOK, gin.H{"has_api_key": false})
		return
	}
	defer atomicService.Close()

	c.JSON(http.StatusOK, gin.H{
		"has_api_key": atomicService.CheckGeminiAPIKey(&agent),
	})
}
