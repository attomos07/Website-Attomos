package handlers

// live.go — Tiempo real del panel (Recepción, Optometría, Laboratorio,
// Inventario, Mis citas). Como en Avante: en cuanto algo cambia, cada
// pantalla abierta del MISMO negocio (dueño y su equipo) recibe un aviso y
// vuelve a pedir sus datos, sin esperar el minuto.
//
//	GET /api/live   Server-Sent Events: "change" {topic, at}
//
// El aviso no trae datos (cada página vuelve a pedir lo suyo con sus
// permisos). Los avisos los manda LiveNotify(...) en los grupos de rutas
// que modifican algo, y LivePublish desde el código (p. ej. el bot agenda).
//
// Vive en memoria del proceso (igual que el CRM en vivo): con una sola
// instancia funciona perfecto. Si un día hay varias réplicas, cada una
// avisaría solo a sus conexiones; ahí haría falta Redis pub/sub. Las
// páginas siguen recargando cada minuto por si se pierde un aviso.

import (
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

type liveEvent struct {
	Topic string `json:"topic"`
	At    int64  `json:"at"`
}

type liveHub struct {
	mu   sync.RWMutex
	subs map[uint]map[chan liveEvent]struct{}
}

var live = &liveHub{subs: map[uint]map[chan liveEvent]struct{}{}}

func (h *liveHub) subscribe(owner uint) chan liveEvent {
	ch := make(chan liveEvent, 16)
	h.mu.Lock()
	if h.subs[owner] == nil {
		h.subs[owner] = map[chan liveEvent]struct{}{}
	}
	h.subs[owner][ch] = struct{}{}
	h.mu.Unlock()
	return ch
}

func (h *liveHub) unsubscribe(owner uint, ch chan liveEvent) {
	h.mu.Lock()
	if set := h.subs[owner]; set != nil {
		delete(set, ch)
		if len(set) == 0 {
			delete(h.subs, owner)
		}
	}
	h.mu.Unlock()
}

// LivePublish avisa a todas las pantallas abiertas de ese negocio. Si una
// conexión está saturada se brinca (no bloquea a nadie).
func LivePublish(owner uint, topics ...string) {
	if owner == 0 {
		return
	}
	h := live
	h.mu.RLock()
	defer h.mu.RUnlock()
	now := time.Now().UnixMilli()
	for ch := range h.subs[owner] {
		for _, t := range topics {
			select {
			case ch <- liveEvent{Topic: t, At: now}:
			default:
			}
		}
	}
}

// LiveNotify — middleware para los grupos de rutas: si la petición cambió
// algo (no es GET) y salió bien, avisa con esos temas.
func LiveNotify(topics ...string) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Next()
		if c.Request.Method == http.MethodGet || c.Request.Method == http.MethodHead {
			return
		}
		if s := c.Writer.Status(); s >= 200 && s < 400 {
			LivePublish(invUserID(c), topics...)
		}
	}
}

// LiveStream — GET /api/live
func LiveStream(c *gin.Context) {
	owner := invUserID(c)
	if owner == 0 {
		c.Status(http.StatusUnauthorized)
		return
	}
	ch := live.subscribe(owner)
	defer live.unsubscribe(owner, ch)

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")
	c.SSEvent("hello", gin.H{"t": time.Now().Unix()})
	c.Writer.Flush()

	ctx := c.Request.Context()
	ticker := time.NewTicker(25 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case ev := <-ch:
			c.SSEvent("change", ev)
			c.Writer.Flush()
		case <-ticker.C:
			// keep-alive para que los proxies (Railway) no corten la conexión
			c.SSEvent("ping", gin.H{"t": time.Now().Unix()})
			c.Writer.Flush()
		}
	}
}
