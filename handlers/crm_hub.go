package handlers

// crm_hub.go — puente en tiempo real entre el bot de WhatsApp (uno por
// agente) y las pestañas del CRM abiertas en el navegador.
//
// Flujo:
//   Bot        --WS-->   Hub (este archivo)   --SSE-->   Navegador (crm.js)
//   Navegador  --POST /send-->   Hub   --WS-->   Bot
//
// No hay persistencia todavía (a propósito, por ahora): el historial vive
// solo mientras el bot y el CRM están conectados. Cuando agregues guardado
// en Hetzner, este hub es el lugar natural para además escribir cada evento
// a esa fuente antes o después de repartirlo.

import (
	"log"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"

	"attomos/config"
	"attomos/models"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

// CRMEvent es el mensaje que viaja tanto bot→hub como hub→navegador.
type CRMEvent struct {
	Type        string `json:"type"`                // "message"
	Direction   string `json:"direction,omitempty"` // "in" (cliente) | "out" (bot/humano)
	From        string `json:"from,omitempty"`      // "customer" | "bot" | "human"
	Phone       string `json:"phone"`
	ContactName string `json:"contactName,omitempty"`
	Text        string `json:"text"`
	Timestamp   int64  `json:"timestamp"`
}

// crmSendCommand es lo que el hub manda AL bot: enviar un mensaje, o pausar
// / reanudar las respuestas automáticas para un número (botón "Tomar
// control" del CRM).
type crmSendCommand struct {
	Type  string `json:"type"` // "send" | "pause" | "resume"
	Phone string `json:"phone"`
	Text  string `json:"text,omitempty"`
}

type crmHub struct {
	mu   sync.RWMutex
	bots map[uint]*websocket.Conn        // agentID → conexión del bot
	subs map[uint]map[chan CRMEvent]bool // agentID → suscriptores SSE (pestañas del CRM)
}

// CRMHub es el hub global del proceso — un único backend maneja todos los
// agentes, cada uno con su propia entrada en los mapas de arriba.
var CRMHub = &crmHub{
	bots: make(map[uint]*websocket.Conn),
	subs: make(map[uint]map[chan CRMEvent]bool),
}

func (h *crmHub) registerBot(agentID uint, conn *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if old, ok := h.bots[agentID]; ok {
		old.Close()
	}
	h.bots[agentID] = conn
}

func (h *crmHub) unregisterBot(agentID uint, conn *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if current, ok := h.bots[agentID]; ok && current == conn {
		delete(h.bots, agentID)
	}
}

func (h *crmHub) subscribe(agentID uint) chan CRMEvent {
	ch := make(chan CRMEvent, 32)
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.subs[agentID] == nil {
		h.subs[agentID] = make(map[chan CRMEvent]bool)
	}
	h.subs[agentID][ch] = true
	return ch
}

func (h *crmHub) unsubscribe(agentID uint, ch chan CRMEvent) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if subs, ok := h.subs[agentID]; ok {
		delete(subs, ch)
	}
	close(ch)
}

func (h *crmHub) broadcast(agentID uint, evt CRMEvent) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for ch := range h.subs[agentID] {
		select {
		case ch <- evt:
		default:
			log.Printf("⚠️  [CRM] Suscriptor del agente %d con buffer lleno, evento descartado", agentID)
		}
	}
}

func (h *crmHub) sendToBot(agentID uint, cmd crmSendCommand) bool {
	h.mu.RLock()
	conn, ok := h.bots[agentID]
	h.mu.RUnlock()
	if !ok {
		return false
	}
	if err := conn.WriteJSON(cmd); err != nil {
		log.Printf("❌ [CRM] Error enviando comando al bot del agente %d: %v", agentID, err)
		return false
	}
	return true
}

func (h *crmHub) isBotConnected(agentID uint) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	_, ok := h.bots[agentID]
	return ok
}

var crmUpgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	CheckOrigin:     func(r *http.Request) bool { return true }, // el bot no manda Origin de navegador
}

// ============================================
// Endpoint del BOT — GET /ws/bot/crm?agentId=123
// Autenticación: header "Authorization: Bearer <BOT_API_TOKEN>", igual que
// el resto de endpoints /api/bot/* (ver orders_bot.go / payments.go del bot).
// Se registra en main.go SIN middleware.AuthRequired() (no es un usuario).
// ============================================
func BotCRMSocket(c *gin.Context) {
	expectedToken := os.Getenv("BOT_API_TOKEN")
	authHeader := c.GetHeader("Authorization")
	if expectedToken == "" || authHeader != "Bearer "+expectedToken {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "token inválido"})
		return
	}

	agentID64, err := strconv.ParseUint(c.Query("agentId"), 10, 64)
	if err != nil || agentID64 == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "agentId inválido"})
		return
	}
	agentID := uint(agentID64)

	conn, err := crmUpgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("❌ [CRM] Error actualizando a WebSocket (agente %d): %v", agentID, err)
		return
	}

	CRMHub.registerBot(agentID, conn)
	log.Printf("🔌 [CRM] Bot del agente %d conectado al hub", agentID)

	defer func() {
		CRMHub.unregisterBot(agentID, conn)
		conn.Close()
		log.Printf("🔌 [CRM] Bot del agente %d desconectado del hub", agentID)
	}()

	conn.SetReadDeadline(time.Now().Add(90 * time.Second))
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(90 * time.Second))
		return nil
	})

	for {
		var evt CRMEvent
		if err := conn.ReadJSON(&evt); err != nil {
			break
		}
		evt.Type = "message"
		if evt.Timestamp == 0 {
			evt.Timestamp = time.Now().UnixMilli()
		}
		CRMHub.broadcast(agentID, evt)
	}
}

// ============================================
// Endpoint del CRM (navegador) — GET /api/agents/:id/crm/stream
// Server-Sent Events: el navegador recibe cada mensaje en vivo.
// Se registra en main.go DENTRO del grupo protected (middleware.AuthRequired()).
// ============================================
func StreamAgentCRM(c *gin.Context) {
	agentID, agent, ok := loadOwnedAgentForCRM(c)
	if !ok {
		return
	}

	ch := CRMHub.subscribe(agentID)
	defer CRMHub.unsubscribe(agentID, ch)

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no") // por si hay nginx/proxy enfrente

	// Evento inicial con el estado de conexión del bot, para que el CRM
	// pueda mostrar "bot conectado" / "bot desconectado".
	c.SSEvent("status", gin.H{
		"botConnected": CRMHub.isBotConnected(agentID),
		"agentId":      agentID,
		"phoneNumber":  agent.PhoneNumber,
	})
	c.Writer.Flush()

	notify := c.Writer.CloseNotify()
	ticker := time.NewTicker(25 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-notify:
			return
		case evt, open := <-ch:
			if !open {
				return
			}
			c.SSEvent("message", evt)
			c.Writer.Flush()
		case <-ticker.C:
			// keep-alive para que proxies (Railway incluido) no cierren la conexión
			c.SSEvent("ping", gin.H{"t": time.Now().Unix()})
			c.Writer.Flush()
		}
	}
}

// ============================================
// Endpoint del CRM (navegador) — POST /api/agents/:id/crm/send
// El humano contesta desde el CRM — se reenvía al bot conectado.
// ============================================
func SendCRMMessage(c *gin.Context) {
	agentID, _, ok := loadOwnedAgentForCRM(c)
	if !ok {
		return
	}

	var body struct {
		Phone string `json:"phone" binding:"required"`
		Text  string `json:"text" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "phone y text son requeridos"})
		return
	}

	sent := CRMHub.sendToBot(agentID, crmSendCommand{Type: "send", Phone: body.Phone, Text: body.Text})
	if !sent {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "el bot de este agente no está conectado ahora mismo"})
		return
	}

	// Optimista: mostramos el mensaje en todas las pestañas del CRM de una
	// vez, sin esperar a que el bot confirme el envío por WhatsApp.
	CRMHub.broadcast(agentID, CRMEvent{
		Type:      "message",
		Direction: "out",
		From:      "human",
		Phone:     body.Phone,
		Text:      body.Text,
		Timestamp: time.Now().UnixMilli(),
	})

	c.JSON(http.StatusOK, gin.H{"success": true})
}

// ============================================
// Endpoint del CRM (navegador) — POST /api/agents/:id/crm/control
// Botón "Tomar control" / "Dejar control a la IA" del CRM: pausa o reanuda
// las respuestas automáticas del bot para un número, sin necesidad de
// mandar un mensaje.
// ============================================
func ControlCRMConversation(c *gin.Context) {
	agentID, _, ok := loadOwnedAgentForCRM(c)
	if !ok {
		return
	}

	var body struct {
		Phone  string `json:"phone" binding:"required"`
		Action string `json:"action" binding:"required"` // "pause" | "resume"
	}
	if err := c.ShouldBindJSON(&body); err != nil || (body.Action != "pause" && body.Action != "resume") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "phone y action ('pause'|'resume') son requeridos"})
		return
	}

	sent := CRMHub.sendToBot(agentID, crmSendCommand{Type: body.Action, Phone: body.Phone})
	if !sent {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "el bot de este agente no está conectado ahora mismo"})
		return
	}

	CRMHub.broadcast(agentID, CRMEvent{
		Type:      "control",
		Phone:     body.Phone,
		Text:      body.Action,
		Timestamp: time.Now().UnixMilli(),
	})

	c.JSON(http.StatusOK, gin.H{"success": true})
}

// loadOwnedAgentForCRM valida que el usuario autenticado sea dueño del :id
// de la URL — mismo patrón que GetAgent/UpdateAgent/ToggleAgentStatus en tu
// handlers/agent.go: c.Get("user") + Where("id = ? AND user_id = ?", ...).
func loadOwnedAgentForCRM(c *gin.Context) (uint, *models.Agent, bool) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return 0, nil, false
	}
	user := userInterface.(*models.User)

	agentIDStr := c.Param("id")

	var agent models.Agent
	if err := config.DB.Where("id = ? AND user_id = ?", agentIDStr, user.ID).First(&agent).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Agente no encontrado"})
		return 0, nil, false
	}

	return agent.ID, &agent, true
}
