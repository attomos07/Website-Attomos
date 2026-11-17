package handlers

// bot_lab_status.go — El agente de WhatsApp contesta "¿ya están mis
// lentes?": busca los trabajos del cliente en el laboratorio por su número
// de WhatsApp (o por su clave de rastreo) y dice en qué paso van, igual que
// la página de Rastreo.
//
//	GET /api/bot/lab-status?agentId=12&phone=5216621234567[&code=AT7K3P9Q]
//	Authorization: Bearer BOT_API_TOKEN
//
// Solo regresa lo que ya ve el cliente en Rastreo (sin precios, sin datos
// de otros clientes): clave, estatus, paso, fecha de entrega y productos.

import (
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"attomos/config"
	"attomos/models"

	"github.com/gin-gonic/gin"
)

type botLabJob struct {
	Code      string   `json:"code"`
	Estatus   string   `json:"estatus"`
	Hint      string   `json:"hint"`
	Paso      string   `json:"paso,omitempty"`
	Listo     bool     `json:"listo"`
	Entregado bool     `json:"entregado"`
	Entrega   string   `json:"entrega,omitempty"` // "viernes 20 de noviembre"
	Express   bool     `json:"express"`
	Fecha     string   `json:"fecha"`
	Productos []string `json:"productos"`
	Rastreo   string   `json:"rastreo,omitempty"`
}

func botDigits(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	d := b.String()
	if len(d) > 10 {
		d = d[len(d)-10:]
	}
	return d
}

var botMeses = []string{"enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"}
var botDias = []string{"domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"}

func botFecha(t time.Time) string {
	return botDias[t.Weekday()] + " " + strconv.Itoa(t.Day()) + " de " + botMeses[t.Month()-1]
}

// BotLabStatus — GET /api/bot/lab-status
func BotLabStatus(c *gin.Context) {
	tok := os.Getenv("BOT_API_TOKEN")
	if tok == "" || c.GetHeader("Authorization") != "Bearer "+tok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	var agent models.Agent
	if err := config.DB.Select("id, user_id").First(&agent, c.Query("agentId")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "agent not found"})
		return
	}
	owner := agent.UserID
	code := models.NormalizeTrackingCode(c.Query("code"))
	phone := botDigits(c.Query("phone"))

	var list []models.Order
	q := config.DB.Where("user_id = ? AND deleted_at IS NULL", owner)
	switch {
	case len(code) >= 4:
		q = q.Where("tracking_code = ?", code)
	case len(phone) >= 7:
		// Activos, o entregados / cancelados en los últimos 10 días.
		q = q.Where("client_phone <> '' AND created_at >= ?", time.Now().AddDate(0, 0, -180)).
			Where("status IN ? OR updated_at >= ?", []models.OrderStatus{models.OrderStatusPending, models.OrderStatusConfirmed, models.OrderStatusPreparing, models.OrderStatusReady}, time.Now().AddDate(0, 0, -10))
	default:
		c.JSON(http.StatusOK, gin.H{"found": false, "trabajos": []botLabJob{}})
		return
	}
	if err := q.Order("created_at DESC").Limit(200).Find(&list).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db"})
		return
	}

	labels := map[string]models.OrderStatusInfo{}
	for _, s := range models.OrderStatusList(true) {
		labels[s.Key] = s
	}
	base := strings.TrimRight(os.Getenv("BASE_URL"), "/")
	out := []botLabJob{}
	for i := range list {
		o := &list[i]
		if len(code) < 4 && botDigits(o.ClientPhone) != phone {
			continue
		}
		info := labels[string(o.Status)]
		j := botLabJob{
			Code: o.TrackingCode, Estatus: info.Label, Hint: info.Hint,
			Listo: o.Status == models.OrderStatusReady, Entregado: o.Status == models.OrderStatusDelivered,
			Express: o.LabExpress, Fecha: botFecha(o.CreatedAt.In(posLocation())), Productos: []string{},
		}
		j.Paso = models.LabStepLabelOf(o)
		if o.LabEntrega != nil && (o.Status == models.OrderStatusConfirmed || o.Status == models.OrderStatusPreparing) {
			j.Entrega = botFecha(*o.LabEntrega)
		}
		for _, it := range o.Items {
			if strings.TrimSpace(it.Name) != "" {
				j.Productos = append(j.Productos, it.Name)
			}
		}
		if base != "" && o.TrackingCode != "" {
			j.Rastreo = base + "/rastreo?pedido=" + o.TrackingCode
		}
		out = append(out, j)
		if len(out) >= 5 {
			break
		}
	}
	c.JSON(http.StatusOK, gin.H{"found": len(out) > 0, "trabajos": out})
}
