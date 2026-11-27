package handlers

import (
	"log"
	"net/http"

	"attomos/config"
	"attomos/models"

	"attomos/bots"

	"github.com/gin-gonic/gin"
)

type SaveGeminiKeyRequest struct {
	APIKey string `json:"apiKey" binding:"required"`
}

// SaveGeminiKey guarda la API Key de Gemini en el .env del bot.
// OrbitalBot: además se guarda en el GoogleCloudProject del usuario (estado
// "manual"), que es de donde la toman el despliegue y el redeploy. Antes
// OrbitalBot solo la recibía del proyecto de GCP automático; si ese falló, el
// bot quedaba sin IA y no había forma de ponerla.
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

	if !agent.IsAtomicBot() && !agent.IsOrbitalBot() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Este tipo de agente no usa esta clave."})
		return
	}

	var req SaveGeminiKeyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos inválidos", "details": err.Error()})
		return
	}

	validPrefix := (len(req.APIKey) >= 6 && req.APIKey[:6] == "AIzaSy") ||
		(len(req.APIKey) >= 2 && req.APIKey[:2] == "AQ")

	if len(req.APIKey) < 30 || !validPrefix {
		c.JSON(http.StatusBadRequest, gin.H{"error": "API Key inválida. Debe comenzar con 'AIzaSy' o 'AQ'"})
		return
	}

	log.Printf("💾 [Agent %d] Guardando Gemini API Key...", agent.ID)

	if agent.IsOrbitalBot() {
		saveUserGeminiKey(user.ID, req.APIKey)
		if err := orbitalSetGeminiKey(&agent, req.APIKey); err != nil {
			log.Printf("❌ [Agent %d] Error actualizando API Key: %v", agent.ID, err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "La clave se guardó, pero no se pudo poner en el bot. Haz Redeploy del agente."})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "message": "API Key guardada exitosamente"})
		return
	}

	serverManager := bots.GetGlobalServerManager()
	servers, err := serverManager.ListAllServers()
	if err != nil || len(servers) == 0 {
		log.Printf("❌ [Agent %d] No se encontró servidor compartido", agent.ID)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Servidor compartido no disponible"})
		return
	}

	globalServer := servers[0]
	atomicService := bots.NewAtomicBotDeployService(globalServer.IPAddress, globalServer.RootPassword)
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

	if agent.IsOrbitalBot() {
		saveUserGeminiKey(user.ID, "")
		if err := orbitalSetGeminiKey(&agent, ""); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Error eliminando API Key del servidor"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "message": "API Key eliminada exitosamente"})
		return
	}
	if !agent.IsAtomicBot() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Este tipo de agente no usa esta clave."})
		return
	}

	log.Printf("🗑️  [Agent %d] Eliminando Gemini API Key...", agent.ID)

	serverManager := bots.GetGlobalServerManager()
	servers, err := serverManager.ListAllServers()
	if err != nil || len(servers) == 0 {
		log.Printf("❌ [Agent %d] No se encontró servidor compartido", agent.ID)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Servidor compartido no disponible"})
		return
	}

	globalServer := servers[0]
	atomicService := bots.NewAtomicBotDeployService(globalServer.IPAddress, globalServer.RootPassword)
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

	// OrbitalBot: la clave del usuario (proyecto de GCP automático o la que
	// puso a mano).
	if agent.IsOrbitalBot() {
		var gcp models.GoogleCloudProject
		has := config.DB.Where("user_id = ?", user.ID).First(&gcp).Error == nil && gcp.GeminiAPIKey != ""
		c.JSON(http.StatusOK, gin.H{"has_api_key": has})
		return
	}
	if !agent.IsAtomicBot() {
		c.JSON(http.StatusOK, gin.H{"has_api_key": true})
		return
	}

	// AtomicBot: verificar .env en servidor compartido
	serverManager := bots.GetGlobalServerManager()
	servers, err := serverManager.ListAllServers()
	if err != nil || len(servers) == 0 {
		c.JSON(http.StatusOK, gin.H{"has_api_key": false})
		return
	}

	globalServer := servers[0]
	atomicService := bots.NewAtomicBotDeployService(globalServer.IPAddress, globalServer.RootPassword)
	if err := atomicService.Connect(); err != nil {
		c.JSON(http.StatusOK, gin.H{"has_api_key": false})
		return
	}
	defer atomicService.Close()

	c.JSON(http.StatusOK, gin.H{
		"has_api_key": atomicService.CheckGeminiAPIKey(&agent),
	})
}

// saveUserGeminiKey guarda la clave en el GoogleCloudProject del usuario
// (estado "manual" = la puso el usuario; así el alta de agentes no intenta
// crear el proyecto de GCP automático).
func saveUserGeminiKey(userID uint, key string) {
	var gcp models.GoogleCloudProject
	if err := config.DB.Where("user_id = ?", userID).First(&gcp).Error; err != nil {
		gcp = models.GoogleCloudProject{UserID: userID}
	}
	gcp.GeminiAPIKey = key
	if key != "" {
		gcp.ProjectStatus = "manual"
	}
	if gcp.ID == 0 {
		config.DB.Create(&gcp)
	} else {
		config.DB.Save(&gcp)
	}
}

// orbitalSetGeminiKey pone la clave en el .env del OrbitalBot (su servidor
// propio) y lo reinicia.
func orbitalSetGeminiKey(agent *models.Agent, key string) error {
	if agent.ServerIP == "" || agent.ServerPassword == "" {
		return nil // aún sin servidor: la toma al desplegarse
	}
	svc := bots.NewOrbitalBotDeployService(agent.ServerIP, agent.ServerPassword)
	if err := svc.Connect(); err != nil {
		return err
	}
	defer svc.Close()
	return svc.UpdateGeminiAPIKey(agent, key)
}
