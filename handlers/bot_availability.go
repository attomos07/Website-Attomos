package handlers

// bot_availability.go — Días y horas libres para el menú con botones del
// bot (modo sin IA). Usa las mismas reglas que CreateBotAppointment
// (horario de Mi Negocio, festivos, horas que ya pasaron y cupo), así lo
// que el cliente ve en la lista es lo que el servidor va a aceptar.
//
//	GET /api/bot/availability?agentId=70[&days=7][&date=2026-11-28]
//	Authorization: Bearer BOT_API_TOKEN
//
// Sin date: los próximos `days` días abiertos que tengan horas libres
// (máx. 10, lo que cabe en una lista de WhatsApp).
// Con date: todas las horas libres de ese día.

import (
	"net/http"
	"os"
	"strconv"
	"time"

	"attomos/config"
	"attomos/models"

	"github.com/gin-gonic/gin"
)

type botAvailDay struct {
	Date  string   `json:"date"`  // YYYY-MM-DD
	Label string   `json:"label"` // "sábado 28 de noviembre"
	Slots []string `json:"slots"` // "HH:MM"
}

// BotAvailability — GET /api/bot/availability
func BotAvailability(c *gin.Context) {
	tok := os.Getenv("BOT_API_TOKEN")
	if tok == "" || c.GetHeader("Authorization") != "Bearer "+tok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	var agent models.Agent
	if err := config.DB.Select("id, user_id, branch_id").First(&agent, c.Query("agentId")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "agent not found"})
		return
	}
	uid := agent.UserID
	b := botBranch(&agent, uid)
	now := botBusinessNow(b)

	if ds := c.Query("date"); ds != "" {
		day, err := time.ParseInLocation("2006-01-02", ds, time.Local)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "date debe ser YYYY-MM-DD"})
			return
		}
		day = time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, time.Local)
		c.JSON(http.StatusOK, gin.H{"days": []botAvailDay{{
			Date: ds, Label: botFecha(day), Slots: botFreeSlots(uid, b, day, now, 100),
		}}})
		return
	}

	want, _ := strconv.Atoi(c.DefaultQuery("days", "7"))
	if want < 1 || want > 10 {
		want = 7
	}
	out := []botAvailDay{}
	d := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.Local)
	for i := 0; i < 45 && len(out) < want; i++ {
		if s := botFreeSlots(uid, b, d, now, 100); len(s) > 0 {
			out = append(out, botAvailDay{Date: d.Format("2006-01-02"), Label: botFecha(d), Slots: s})
		}
		d = d.AddDate(0, 0, 1)
	}
	c.JSON(http.StatusOK, gin.H{"days": out})
}
