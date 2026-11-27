package src

// booking_guard.go — Qué hacer cuando Attomos NO acepta la cita.
//
// El servidor (POST /api/bot/appointments) ahora revisa el horario de ese
// día, los días festivos, que la hora no haya pasado (hora del negocio) y
// que no esté llena. Si no se puede, responde 409/422 con:
//   { "code": "...", "error": "texto", "date": "YYYY-MM-DD",
//     "suggestions": ["10:30", "11:00", …] }
// Aquí se convierte en un mensaje para el cliente con las horas libres y
// se borran la hora (y la fecha, si hay que cambiar de día) para que el
// flujo de agendamiento las vuelva a pedir. La cita NO se confirma ni se
// guarda en Sheets/Calendar hasta que el servidor la acepte.

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// BookingRejected: el servidor no aceptó la cita.
type BookingRejected struct {
	Status      int
	Code        string   `json:"code"`
	Msg         string   `json:"error"`
	Date        string   `json:"date"`
	Suggestions []string `json:"suggestions"`
}

func (e *BookingRejected) Error() string {
	return fmt.Sprintf("cita rechazada (%d %s): %s", e.Status, e.Code, e.Msg)
}

// parseBookingResponse: error para una respuesta que no es 200. Los 409 y
// 422 son rechazos de negocio (*BookingRejected); lo demás, error normal.
func parseBookingResponse(status int, body []byte) error {
	if status == 409 || status == 422 {
		var r BookingRejected
		if json.Unmarshal(body, &r) == nil && r.Msg != "" {
			r.Status = status
			return &r
		}
	}
	return fmt.Errorf("API retornó %d: %s", status, string(body))
}

var bookingDias = []string{"domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"}

// bookingDayLabel: "2026-11-28" → "sábado 28/11".
func bookingDayLabel(iso string) string {
	t, err := time.Parse("2006-01-02", iso)
	if err != nil {
		return iso
	}
	return fmt.Sprintf("%s %s", bookingDias[t.Weekday()], t.Format("02/01"))
}

// bookingHora12: "16:30" → "4:30 PM".
func bookingHora12(hhmm string) string {
	t, err := time.Parse("15:04", hhmm)
	if err != nil {
		return hhmm
	}
	return t.Format("3:04 PM")
}

// handleBookingRejection deja el estado listo para volver a pedir la hora
// (o el día) y regresa el mensaje para el cliente. requestedDate es la
// fecha que se mandó (YYYY-MM-DD).
func handleBookingRejection(state *UserState, e *BookingRejected, requestedDate string) string {
	otherDay := e.Date != "" && e.Date != requestedDate
	delete(state.Data, "hora")
	if otherDay || e.Code == "holiday" || e.Code == "closed_day" || e.Code == "past" && otherDay {
		delete(state.Data, "fecha")
		delete(state.Data, "fechaExacta")
		delete(state.Data, "diaSemana")
	}
	state.Data["_retry"] = "1" // al completar de nuevo, se guarda sin volver a preguntar el correo
	state.IsScheduling = true
	state.IsAskingForEmail = false

	var b strings.Builder
	b.WriteString("😕 " + e.Msg)
	if len(e.Suggestions) > 0 {
		horas := make([]string, 0, len(e.Suggestions))
		for _, h := range e.Suggestions {
			horas = append(horas, bookingHora12(h))
		}
		day := requestedDate
		if e.Date != "" {
			day = e.Date
		}
		b.WriteString(fmt.Sprintf("\n\n🕐 Horas libres el %s: %s.", bookingDayLabel(day), strings.Join(horas, ", ")))
		if otherDay {
			b.WriteString("\n\n¿Te acomoda ese día? Dime el día y la hora que prefieres.")
		} else {
			b.WriteString("\n\n¿Cuál te acomoda?")
		}
	} else {
		b.WriteString("\n\n¿Qué otro día y hora te acomodan?")
	}
	state.ConversationHistory = append(state.ConversationHistory, "Asistente: "+b.String())
	return b.String()
}
