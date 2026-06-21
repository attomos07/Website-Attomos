package handlers

import (
	"attomos/config"
	"attomos/models"
	"bytes"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
)

// WebhookProxy redirige las peticiones de webhook de Meta hacia el servidor del bot correspondiente
func WebhookProxy(c *gin.Context) {
	agentIDStr := c.Param("agent_id")

	// Convertir agent_id a int
	agentID, err := strconv.Atoi(agentIDStr)
	if err != nil {
		log.Printf("❌ [Webhook Proxy] Agent ID inválido: %s", agentIDStr)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid agent ID"})
		return
	}

	// Log detallado de la petición
	log.Printf("🔀 [Webhook Proxy] Petición recibida:")
	log.Printf("   📍 Method: %s", c.Request.Method)
	log.Printf("   🤖 Agent ID: %d", agentID)
	log.Printf("   🌐 Remote IP: %s", c.ClientIP())
	log.Printf("   📋 Query Params: %v", c.Request.URL.RawQuery)

	// Obtener información del agente desde la base de datos
	var agent models.Agent
	if err := config.DB.Where("id = ?", agentID).First(&agent).Error; err != nil {
		log.Printf("❌ [Webhook Proxy] Agente %d no encontrado en BD", agentID)
		c.JSON(http.StatusNotFound, gin.H{"error": "Agent not found"})
		return
	}

	// Verificar que sea un OrbitalBot
	if agent.BotType != "orbital" {
		log.Printf("❌ [Webhook Proxy] Agente %d no es OrbitalBot (tipo: %s)", agentID, agent.BotType)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid bot type - only OrbitalBot agents support Meta webhooks"})
		return
	}

	// Verificar que el servidor esté listo
	if agent.ServerStatus != "ready" {
		log.Printf("⚠️  [Webhook Proxy] Servidor del agente %d no está listo (status: %s)", agentID, agent.ServerStatus)
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error":  "Bot server not ready",
			"status": agent.ServerStatus,
			"hint":   "Wait for the server to be ready. Check agent status in dashboard.",
		})
		return
	}

	if agent.ServerIP == "" {
		log.Printf("⚠️  [Webhook Proxy] Agente %d no tiene IP de servidor asignada", agentID)
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Bot server IP not configured"})
		return
	}

	// Construir URL del bot en Hetzner
	// El bot OrbitalBot escucha en el puerto configurado en la base de datos (dinámico)
	// Nota: El bot usa la ruta /webhook (sin /meta/{agentId})
	botURL := fmt.Sprintf("http://%s:%d/webhook", agent.ServerIP, agent.Port)

	log.Printf("🎯 [Webhook Proxy] Redirigiendo a bot:")
	log.Printf("   🌐 Bot URL: %s", botURL)
	log.Printf("   📡 Server IP: %s", agent.ServerIP)
	log.Printf("   🔌 Port: %d", agent.Port)
	log.Printf("   🔢 Agent ID: %d", agentID)

	// Crear cliente HTTP con timeout adecuado
	client := &http.Client{
		Timeout: 30 * time.Second,
		Transport: &http.Transport{
			MaxIdleConns:        100,
			MaxIdleConnsPerHost: 10,
			IdleConnTimeout:     90 * time.Second,
		},
	}

	// Leer el body de la petición original
	bodyBytes, err := io.ReadAll(c.Request.Body)
	if err != nil {
		log.Printf("❌ [Webhook Proxy] Error leyendo request body: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error reading request body"})
		return
	}

	// Log del body para debugging (solo para GET de verificación)
	if c.Request.Method == "GET" {
		log.Printf("   📋 Verificación de webhook (GET)")
		log.Printf("   🔑 Query params: %s", c.Request.URL.RawQuery)
	} else if c.Request.Method == "POST" {
		log.Printf("   📨 Mensaje entrante (POST)")
		log.Printf("   📦 Body size: %d bytes", len(bodyBytes))
	}

	// Crear nueva petición hacia el bot
	var req *http.Request
	if len(bodyBytes) > 0 {
		req, err = http.NewRequest(c.Request.Method, botURL, io.NopCloser(bytes.NewBuffer(bodyBytes)))
	} else {
		req, err = http.NewRequest(c.Request.Method, botURL, nil)
	}

	if err != nil {
		log.Printf("❌ [Webhook Proxy] Error creando request: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Proxy error creating request"})
		return
	}

	// Copiar headers importantes de la petición original
	headersToProxy := []string{
		"Content-Type",
		"User-Agent",
		"X-Hub-Signature-256",
		"X-Hub-Signature",
	}

	for _, header := range headersToProxy {
		if value := c.GetHeader(header); value != "" {
			req.Header.Set(header, value)
			log.Printf("   📌 Header: %s = %s", header, maskSensitiveData(value))
		}
	}

	// Copiar query parameters (MUY IMPORTANTE para la verificación de Meta)
	req.URL.RawQuery = c.Request.URL.RawQuery

	// Realizar la petición al bot
	startTime := time.Now()
	resp, err := client.Do(req)
	duration := time.Since(startTime)

	if err != nil {
		log.Printf("❌ [Webhook Proxy] Error comunicando con bot: %v", err)
		log.Printf("   ⏱️  Tiempo transcurrido: %v", duration)
		c.JSON(http.StatusBadGateway, gin.H{
			"error": "Bot server unreachable",
			"hint":  "The bot server might be down or unreachable. Check server status.",
		})
		return
	}
	defer resp.Body.Close()

	// Leer respuesta del bot
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("❌ [Webhook Proxy] Error leyendo respuesta del bot: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error reading bot response"})
		return
	}

	// Log de la respuesta
	log.Printf("✅ [Webhook Proxy] Respuesta del bot:")
	log.Printf("   📊 Status: %d %s", resp.StatusCode, http.StatusText(resp.StatusCode))
	log.Printf("   ⏱️  Duración: %v", duration)
	log.Printf("   📦 Response size: %d bytes", len(responseBody))

	// Si es una verificación exitosa, loguear más detalles
	if c.Request.Method == "GET" && resp.StatusCode == http.StatusOK {
		log.Printf("   ✅ Webhook verificado exitosamente")
		log.Printf("   🎯 Challenge response: %s", string(responseBody))
	}

	// Copiar headers de respuesta importantes
	headersToReturn := []string{
		"Content-Type",
		"Content-Length",
	}

	for _, header := range headersToReturn {
		if value := resp.Header.Get(header); value != "" {
			c.Header(header, value)
		}
	}

	// Enviar respuesta al cliente (Meta)
	c.Data(resp.StatusCode, resp.Header.Get("Content-Type"), responseBody)

	log.Printf("🏁 [Webhook Proxy] Petición completada para agente %d", agentID)
}

// maskSensitiveData enmascara datos sensibles para logs
func maskSensitiveData(data string) string {
	if len(data) <= 8 {
		return "***"
	}
	if len(data) > 20 {
		return data[:8] + "..." + data[len(data)-4:]
	}
	return data[:4] + "..." + data[len(data)-4:]
}
