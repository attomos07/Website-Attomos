package handlers

// pos_ticket.go — ticket digital: el cliente lo abre desde el enlace que le
// manda el negocio por WhatsApp (/pos/ticket/<negocio>/<folio>/<firma>).
// La firma (HMAC con JWT_SECRET) evita que alguien vea otros tickets
// cambiando los números.

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"strconv"

	"attomos/models"

	"github.com/gin-gonic/gin"
)

func ticketSecret() []byte {
	s := os.Getenv("JWT_SECRET")
	if s == "" {
		s = "cambia-esto-por-una-clave-larga-y-aleatoria-en-produccion"
	}
	return []byte("ticket-digital:" + s)
}

// TicketSig — firma corta de negocio + folio.
func TicketSig(userID uint, folio int64) string {
	m := hmac.New(sha256.New, ticketSecret())
	m.Write([]byte(strconv.FormatUint(uint64(userID), 10) + ":" + strconv.FormatInt(folio, 10)))
	return hex.EncodeToString(m.Sum(nil))[:20]
}

// TicketPublicPath — "/pos/ticket/7/123/abcd…"
func TicketPublicPath(userID uint, folio int64) string {
	return "/pos/ticket/" + strconv.FormatUint(uint64(userID), 10) + "/" + strconv.FormatInt(folio, 10) + "/" + TicketSig(userID, folio)
}

func ticketFromParams(c *gin.Context) (uint, int64, bool) {
	uid, err1 := strconv.ParseUint(c.Param("uid"), 10, 64)
	folio, err2 := strconv.ParseInt(c.Param("folio"), 10, 64)
	if err1 != nil || err2 != nil || uid == 0 || folio <= 0 {
		return 0, 0, false
	}
	return uint(uid), folio, hmac.Equal([]byte(c.Param("sig")), []byte(TicketSig(uint(uid), folio)))
}

// PublicTicketPage — GET /pos/ticket/:uid/:folio/:sig
func PublicTicketPage(c *gin.Context) {
	uid, folio, ok := ticketFromParams(c)
	if !ok {
		c.String(http.StatusNotFound, "Ticket no encontrado.")
		return
	}
	biz := posBusinessInfo(uid)
	c.Header("X-Robots-Tag", "noindex")
	c.Header("Referrer-Policy", "no-referrer")
	c.HTML(http.StatusOK, "pos-ticket-public.html", gin.H{
		"UID":      uid,
		"Folio":    folio,
		"Sig":      c.Param("sig"),
		"Business": biz.Nombre,
		"Logo":     biz.Logo,
	})
}

type publicTicketItem struct {
	Descripcion string  `json:"descripcion"`
	Cantidad    int     `json:"cantidad"`
	Precio      float64 `json:"precio"`
	Descuento   float64 `json:"descuento"`
}

// PublicTicketData — GET /api/pos-ticket/:uid/:folio/:sig
// Lo mínimo para dibujar el ticket (sin teléfonos ni datos internos).
func PublicTicketData(c *gin.Context) {
	uid, folio, ok := ticketFromParams(c)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "Ticket no encontrado."})
		return
	}
	d, err := models.GetPosSale(uid, folio)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Ticket no encontrado."})
		return
	}
	items := make([]publicTicketItem, 0, len(d.Productos))
	for _, p := range d.Productos {
		items = append(items, publicTicketItem{p.Descripcion, p.Cantidad, p.Precio, p.Descuento})
	}
	var tpl json.RawMessage
	if data, _, _, err := models.GetPosTicketTemplate(uid); err == nil && data != "" {
		tpl = json.RawMessage(data)
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{
		"plantilla": tpl,
		"negocio":   posBusinessInfo(uid),
		"venta": gin.H{
			"folio":     d.Folio,
			"fecha":     d.Fecha,
			"cliente":   d.Cliente,
			"cajero":    d.Cajero,
			"productos": items,
			"pagos": gin.H{
				"efectivo": d.EfectivoRecibido, "tarjeta": d.Tarjeta, "transferencia": d.Transferencia,
				"vales": d.Vales, "cheque": d.Cheque, "credito": d.Credito,
			},
			"cambio":    d.Cambio,
			"total":     d.Total,
			"vence":     d.Vence,
			"cancelada": d.Cancelada,
		},
	})
}
