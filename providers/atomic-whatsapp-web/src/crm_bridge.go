package src

// crm_bridge.go — conexión en tiempo real entre este bot y el CRM de Attomos.
//
// El bot abre (y mantiene, con reconexión automática) un WebSocket hacia el
// backend. Cada mensaje entrante del cliente y cada respuesta del bot se
// reporta por ese socket, y el backend las reenvía por SSE a las pestañas del
// CRM abiertas en el navegador. Si un humano contesta desde el CRM, el
// backend manda un comando "send" por el mismo socket, que este archivo
// traduce a un mensaje real de WhatsApp con SendMessage().
//
// No hay persistencia local todavía — es solo un puente en vivo. Cuando
// agregues guardado en este servidor (Hetzner), este es el lugar natural
// para además escribir cada evento a disco/SQLite antes o después de
// mandarlo por el socket.

import (
	"fmt"
	"log"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"go.mau.fi/whatsmeow/types"
)

// crmEvent es lo que el bot manda al backend: un mensaje entrante/saliente,
// o (Type: "metrics") una muestra de recursos del proceso.
type crmEvent struct {
	Type        string      `json:"type,omitempty"` // "message" (default) | "metrics"
	Direction   string      `json:"direction,omitempty"`
	From        string      `json:"from,omitempty"` // "customer" | "bot" | "human"
	Phone       string      `json:"phone,omitempty"`
	ContactName string      `json:"contactName,omitempty"`
	Text        string      `json:"text,omitempty"`
	Timestamp   int64       `json:"timestamp"`
	Metrics     *BotMetrics `json:"metrics,omitempty"`
}

// crmSendCommand es lo que el backend manda AL bot por este mismo socket —
// tanto comandos de conversación (un humano contestando desde el CRM) como
// avisos generales del backend que no son por conversación (ej. "refresca tu
// caché del API Explorer" o "refresca tu business_config"), que por eso no
// traen phone.
type crmSendCommand struct {
	Type  string `json:"type"` // "send" | "pause" | "resume" | "refresh_api_explorer" | "refresh_business_config"
	Phone string `json:"phone,omitempty"`
	Text  string `json:"text,omitempty"`
}

var (
	crmConn      *websocket.Conn
	crmConnMu    sync.Mutex
	crmConnected bool

	humanControlled   = make(map[string]time.Time) // phone → hasta cuándo pausar al bot
	humanControlledMu sync.RWMutex

	// Cuánto tiempo se pausa el bot automático tras una respuesta humana desde el CRM.
	humanTakeoverDuration = 30 * time.Minute
)

// InitCRMBridge conecta con el hub del CRM y se reconecta solo si se cae.
// Llamar una vez desde main.go, junto a los demás Init* (Gemini, Sheets, etc).
func InitCRMBridge() {
	if os.Getenv("ATTOMOS_API_URL") == "" || os.Getenv("BOT_API_TOKEN") == "" || os.Getenv("AGENT_ID") == "" {
		log.Println("⚠️  [CRM] ATTOMOS_API_URL, BOT_API_TOKEN o AGENT_ID no configurados — CRM en vivo deshabilitado")
		return
	}
	go crmConnectLoop()
}

func crmWebsocketURL() (string, error) {
	base := os.Getenv("ATTOMOS_API_URL")
	agentID := os.Getenv("AGENT_ID")

	u, err := url.Parse(base)
	if err != nil {
		return "", fmt.Errorf("ATTOMOS_API_URL inválido: %w", err)
	}
	switch u.Scheme {
	case "https":
		u.Scheme = "wss"
	default:
		u.Scheme = "ws"
	}
	u.Path = "/ws/bot/crm"
	q := u.Query()
	q.Set("agentId", agentID)
	u.RawQuery = q.Encode()
	return u.String(), nil
}

func crmConnectLoop() {
	backoff := 2 * time.Second
	const maxBackoff = 60 * time.Second

	for {
		wsURL, err := crmWebsocketURL()
		if err != nil {
			log.Printf("❌ [CRM] %v", err)
			return
		}

		header := map[string][]string{
			"Authorization": {"Bearer " + os.Getenv("BOT_API_TOKEN")},
		}

		log.Println("🔌 [CRM] Conectando al hub del CRM...")
		conn, _, err := websocket.DefaultDialer.Dial(wsURL, header)
		if err != nil {
			log.Printf("⚠️  [CRM] No se pudo conectar (%v) — reintentando en %v", err, backoff)
			time.Sleep(backoff)
			if backoff < maxBackoff {
				backoff *= 2
			}
			continue
		}

		log.Println("✅ [CRM] Conectado al hub del CRM en tiempo real")
		backoff = 2 * time.Second

		crmConnMu.Lock()
		crmConn = conn
		crmConnected = true
		crmConnMu.Unlock()

		crmReadLoop(conn) // bloquea hasta que se cae la conexión

		crmConnMu.Lock()
		crmConn = nil
		crmConnected = false
		crmConnMu.Unlock()

		log.Println("🔌 [CRM] Desconectado del hub — reintentando en 3s")
		time.Sleep(3 * time.Second)
	}
}

func crmReadLoop(conn *websocket.Conn) {
	for {
		var cmd crmSendCommand
		if err := conn.ReadJSON(&cmd); err != nil {
			return
		}
		switch cmd.Type {
		case "refresh_api_explorer":
			// No trae phone (no es un mensaje de conversación) — se procesa
			// aparte, antes del filtro de "phone vacío" de abajo, que es solo
			// para los comandos que sí son por conversación.
			go func() {
				if err := FetchAPIExplorerData(); err != nil {
					log.Printf("⚠️  [CRM] refresh_api_explorer: %v", err)
				} else {
					log.Println("🔄 [CRM] Inventario de API Explorer refrescado por aviso del backend")
				}
			}()
			continue
		case "refresh_business_config":
			// El backend manda esto justo después de guardar Mi Negocio
			// (fotos, servicios, horario, etc.) o la config del agente, para
			// que el bot tome los cambios sin esperar el polling de 5 min y
			// sin necesidad de redeploy.
			go func() {
				if err := LoadBusinessConfig(); err != nil {
					log.Printf("⚠️  [CRM] refresh_business_config: %v", err)
				} else {
					log.Println("🔄 [CRM] business_config refrescado por aviso del backend")
				}
			}()
			continue
		}

		if cmd.Phone == "" {
			continue
		}
		switch cmd.Type {
		case "send":
			go handleCRMSendCommand(cmd)
		case "pause":
			SetHumanControlled(cmd.Phone)
			log.Printf("⏸️  [CRM] Bot pausado para %s (control tomado desde el CRM)", cmd.Phone)
		case "resume":
			ClearHumanControlled(cmd.Phone)
			log.Printf("▶️  [CRM] Bot reactivado para %s", cmd.Phone)
		}
	}
}

// handleCRMSendCommand ejecuta un envío pedido desde el CRM (un humano
// contestando manualmente) y pausa las respuestas automáticas de Gemini para
// ese número durante humanTakeoverDuration.
func handleCRMSendCommand(cmd crmSendCommand) {
	log.Printf("👤 [CRM] Humano respondiendo a %s: %s", cmd.Phone, cmd.Text)

	jid, err := phoneToJID(cmd.Phone)
	if err != nil {
		log.Printf("❌ [CRM] No se pudo construir el JID de %s: %v", cmd.Phone, err)
		return
	}

	if err := SendMessage(jid, cmd.Text); err != nil {
		log.Printf("❌ [CRM] Error enviando mensaje a %s: %v", cmd.Phone, err)
		return
	}

	SetHumanControlled(cmd.Phone)
	log.Printf("✅ [CRM] Mensaje entregado a %s — bot pausado %v para este número", cmd.Phone, humanTakeoverDuration)
}

// phoneToJID convierte un número tal como lo maneja Attomos (ej. "5216621234567",
// el mismo formato que msg.Info.Chat.User) al JID de WhatsApp correspondiente.
//
// ⚠️ Si en tu CRM/backend guardas los teléfonos con "+" o espacios, este
// helper ya los limpia. Si usas un formato distinto (con "521" vs "52" para
// México, por ejemplo), ajusta aquí.
func phoneToJID(phone string) (types.JID, error) {
	clean := strings.NewReplacer("+", "", " ", "", "-", "").Replace(phone)
	if clean == "" {
		return types.JID{}, fmt.Errorf("número vacío")
	}
	return types.NewJID(clean, types.DefaultUserServer), nil
}

// NotifyCRM reporta un mensaje (entrante o saliente) al CRM en vivo. No
// bloquea ni interrumpe el flujo del bot si el CRM no está conectado en ese
// momento — simplemente nadie lo está viendo en vivo.
//
//	direction:   "in" (mensaje del cliente) | "out" (mensaje hacia el cliente)
//	from:        "customer" | "bot" | "human"
func NotifyCRM(direction, phone, contactName, text, from string) {
	crmConnMu.Lock()
	conn := crmConn
	connected := crmConnected
	crmConnMu.Unlock()

	if !connected || conn == nil {
		return
	}

	evt := crmEvent{
		Type:        "message",
		Direction:   direction,
		From:        from,
		Phone:       phone,
		ContactName: contactName,
		Text:        text,
		Timestamp:   time.Now().UnixMilli(),
	}

	crmConnMu.Lock()
	err := conn.WriteJSON(evt)
	crmConnMu.Unlock()

	if err != nil {
		log.Printf("⚠️  [CRM] Error reportando mensaje: %v", err)
	}
}

// NotifyMetrics manda una muestra de métricas de recursos del bot (CPU,
// RAM, goroutines, disco — ver metrics.go) al hub del CRM, por el mismo
// WebSocket que ya usa NotifyCRM. No bloquea ni interrumpe el bot si el CRM
// no está conectado en ese momento.
func NotifyMetrics(m BotMetrics) {
	crmConnMu.Lock()
	conn := crmConn
	connected := crmConnected
	crmConnMu.Unlock()

	if !connected || conn == nil {
		return
	}

	evt := crmEvent{
		Type:      "metrics",
		Timestamp: time.Now().UnixMilli(),
		Metrics:   &m,
	}

	crmConnMu.Lock()
	err := conn.WriteJSON(evt)
	crmConnMu.Unlock()

	if err != nil {
		log.Printf("⚠️  [CRM] Error reportando métricas: %v", err)
	}
}

// ── Pausa por intervención humana ───────────────────────────────────────────

// SetHumanControlled pausa las respuestas automáticas para ese número durante
// humanTakeoverDuration (se renueva cada vez que el humano vuelve a escribir).
func SetHumanControlled(phone string) {
	humanControlledMu.Lock()
	defer humanControlledMu.Unlock()
	humanControlled[phone] = time.Now().Add(humanTakeoverDuration)
}

// IsHumanControlled indica si un humano tomó esta conversación recientemente
// y el bot debe quedarse callado para ese número.
func IsHumanControlled(phone string) bool {
	humanControlledMu.RLock()
	until, exists := humanControlled[phone]
	humanControlledMu.RUnlock()
	if !exists {
		return false
	}
	if time.Now().After(until) {
		humanControlledMu.Lock()
		delete(humanControlled, phone)
		humanControlledMu.Unlock()
		return false
	}
	return true
}

// ClearHumanControlled le devuelve el control al bot para ese número (útil si
// más adelante agregas un botón "Devolver al bot" en el CRM).
func ClearHumanControlled(phone string) {
	humanControlledMu.Lock()
	defer humanControlledMu.Unlock()
	delete(humanControlled, phone)
}
