package handlers

// appointment_bot_rules.go — Reglas del servidor para las citas que agenda
// el bot (POST /api/bot/appointments). Antes se guardaba lo que mandara la
// IA; ahora se revisa aquí, igual que en Mis citas:
//
//   - Fecha y hora válidas, en los horarios de 30 min del día (como el
//     selector de Mis citas): de la hora de abrir hasta media hora antes
//     de cerrar, con el horario de ESE día de la semana.
//   - Que no sea un día cerrado ni un día festivo de Mi Negocio.
//   - Que no sea una hora que ya pasó, con la hora del NEGOCIO (su zona
//     horaria de Mi Negocio), no la del servidor.
//   - Que la hora no esté llena (una cita por trabajador; sin trabajadores,
//     una).
//   - Si el mismo celular ya tiene cita a esa hora, no se duplica (el bot
//     a veces reintenta): se regresa la que ya existe.
//
// Cuando algo no se puede, responde 409/422 con:
//   { "success": false, "code": "...", "error": "texto para el cliente",
//     "suggestions": ["10:30", "11:00", …], "date": "YYYY-MM-DD" }
// para que el bot le ofrezca al cliente otras horas.
//
// Las citas se siguen guardando como "hora de pared" en time.Local, igual
// que las del panel (Mis citas lee y escribe así), para que se vean a la
// misma hora en los dos lados. Lo único que usa la zona del negocio es el
// "ahora" (para saber si ya pasó y qué es hoy).

import (
	"fmt"
	"strconv"
	"strings"
	"time"
	_ "time/tzdata" // zonas horarias dentro del binario (el contenedor puede no traerlas)

	"attomos/config"
	"attomos/models"
)

const botDefaultTZ = "America/Mexico_City"

// botCitaError: por qué no se pudo agendar (para el bot).
type botCitaError struct {
	Status      int
	Code        string
	Msg         string
	Date        string
	Suggestions []string
}

// botBranch: la sucursal del agente (o la primera del negocio).
func botBranch(agent *models.Agent, uid uint) *models.MyBusinessInfo {
	var b models.MyBusinessInfo
	if agent != nil && agent.BranchID > 0 {
		if err := config.DB.Where("id = ? AND user_id = ?", agent.BranchID, uid).First(&b).Error; err == nil {
			return &b
		}
	}
	if err := config.DB.Where("user_id = ?", uid).Order("branch_number ASC").First(&b).Error; err == nil {
		return &b
	}
	return nil
}

// botBusinessNow: la fecha y hora actuales en la zona del negocio, como
// "hora de pared" en time.Local (para compararla con las citas).
func botBusinessNow(b *models.MyBusinessInfo) time.Time {
	tz := ""
	if b != nil {
		tz = strings.TrimSpace(b.Schedule.Timezone)
	}
	loc, err := time.LoadLocation(tz)
	if tz == "" || err != nil {
		loc, _ = time.LoadLocation(botDefaultTZ)
	}
	if loc == nil {
		loc = time.Local
	}
	n := time.Now().In(loc)
	return time.Date(n.Year(), n.Month(), n.Day(), n.Hour(), n.Minute(), 0, 0, time.Local)
}

// botDaySchedule: horario de ese día de la semana (open = false si cierra).
func botDaySchedule(b *models.MyBusinessInfo, wd time.Weekday) (open bool, start, end string) {
	if b == nil {
		// Sin Mi Negocio: el mismo horario por defecto que Mis citas.
		if wd == time.Sunday {
			return false, "", ""
		}
		return true, "09:00", "19:00"
	}
	s := b.Schedule
	week := []models.DaySchedule{s.Sunday, s.Monday, s.Tuesday, s.Wednesday, s.Thursday, s.Friday, s.Saturday}
	d := week[int(wd)]
	if !d.Open || !citaHHMM.MatchString(d.Start) || !citaHHMM.MatchString(d.End) || d.End <= d.Start {
		return false, "", ""
	}
	return true, d.Start, d.End
}

// botHoliday: el nombre del día festivo si esa fecha lo es ("" = no).
// Mi Negocio los guarda como "DD/MM" (cada año); también se aceptan
// "YYYY-MM-DD" viejos.
func botHoliday(b *models.MyBusinessInfo, day time.Time) (string, bool) {
	if b == nil {
		return "", false
	}
	for _, h := range b.Holidays {
		p := strings.FieldsFunc(strings.TrimSpace(h.Date), func(r rune) bool { return r == '/' || r == '-' })
		var y, m, d int
		switch len(p) {
		case 2: // DD/MM
			d, _ = strconv.Atoi(p[0])
			m, _ = strconv.Atoi(p[1])
		case 3: // YYYY-MM-DD
			y, _ = strconv.Atoi(p[0])
			m, _ = strconv.Atoi(p[1])
			d, _ = strconv.Atoi(p[2])
		default:
			continue
		}
		if d == day.Day() && m == int(day.Month()) && (y == 0 || y == day.Year()) {
			name := strings.TrimSpace(h.Name)
			if name == "" {
				name = "día festivo"
			}
			return name, true
		}
	}
	return "", false
}

// botDaySlots: las horas de 30 min de ese día (la última, media hora antes
// de cerrar), como en el selector de Mis citas.
func botDaySlots(start, end string) []string {
	s, err1 := time.Parse("15:04", start)
	e, err2 := time.Parse("15:04", end)
	if err1 != nil || err2 != nil {
		return nil
	}
	last := e.Add(-30 * time.Minute)
	if last.Before(s) {
		last = s
	}
	var out []string
	for t := s; !t.After(last); t = t.Add(30 * time.Minute) {
		out = append(out, t.Format("15:04"))
	}
	return out
}

// botFreeSlots: horas libres de ese día que aún no pasan (máx. n).
func botFreeSlots(uid uint, b *models.MyBusinessInfo, day time.Time, now time.Time, n int) []string {
	if _, hol := botHoliday(b, day); hol {
		return []string{}
	}
	open, start, end := botDaySchedule(b, day.Weekday())
	if !open {
		return []string{}
	}
	dayStr := day.Format("2006-01-02")
	counts, err := citaSlotCounts(uid, dayStr, 0)
	if err != nil {
		return []string{}
	}
	capacity := citaCapacity(uid)
	out := []string{}
	for _, t := range botDaySlots(start, end) {
		when, err := time.ParseInLocation("2006-01-02 15:04", dayStr+" "+t, time.Local)
		if err != nil || !when.After(now) || counts[t] >= capacity {
			continue
		}
		out = append(out, t)
		if len(out) >= n {
			break
		}
	}
	return out
}

// botNextOpenDay: el siguiente día (desde from) con horas libres, para
// sugerirlo cuando ese día no se puede. "" = ninguno en 30 días.
func botNextOpenDay(uid uint, b *models.MyBusinessInfo, from, now time.Time) (string, []string) {
	d := time.Date(from.Year(), from.Month(), from.Day(), 0, 0, 0, 0, time.Local)
	for i := 0; i < 30; i++ {
		if s := botFreeSlots(uid, b, d, now, 6); len(s) > 0 {
			return d.Format("2006-01-02"), s
		}
		d = d.AddDate(0, 0, 1)
	}
	return "", []string{}
}

var botDiasES = []string{"domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"}

// botCheckCita revisa fecha/hora. Regresa la fecha lista para guardar o
// por qué no se puede.
func botCheckCita(uid uint, agent *models.Agent, date, hhmm string) (time.Time, *botCitaError) {
	date, hhmm = strings.TrimSpace(date), strings.TrimSpace(hhmm)
	// "9:30" → "09:30"
	if len(hhmm) == 4 && hhmm[1] == ':' {
		hhmm = "0" + hhmm
	}
	b := botBranch(agent, uid)
	now := botBusinessNow(b)

	if !citaHHMM.MatchString(hhmm) {
		return time.Time{}, &botCitaError{Status: 422, Code: "invalid_time", Msg: "La hora no es válida. Usa el formato HH:MM (por ejemplo 10:30)."}
	}
	when, err := time.ParseInLocation("2006-01-02 15:04", date+" "+hhmm, time.Local)
	if err != nil {
		return time.Time{}, &botCitaError{Status: 422, Code: "invalid_date", Msg: "La fecha no es válida. Usa el formato AAAA-MM-DD."}
	}
	day := time.Date(when.Year(), when.Month(), when.Day(), 0, 0, 0, 0, time.Local)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.Local)

	// Ya pasó.
	if !when.After(now) {
		e := &botCitaError{Status: 422, Code: "past", Date: date,
			Msg: fmt.Sprintf("Esa fecha y hora ya pasaron (hoy es %s %s, %s). Elige otra.", botDiasES[now.Weekday()], now.Format("02/01/2006"), now.Format("15:04"))}
		if day.Equal(today) {
			e.Suggestions = botFreeSlots(uid, b, day, now, 6)
		}
		if len(e.Suggestions) == 0 {
			e.Date, e.Suggestions = botNextOpenDay(uid, b, today, now)
		}
		return time.Time{}, e
	}
	if day.After(today.AddDate(1, 0, 0)) {
		return time.Time{}, &botCitaError{Status: 422, Code: "too_far", Msg: "Solo se agenda con hasta un año de anticipación."}
	}

	// Día festivo.
	if name, hol := botHoliday(b, day); hol {
		d, s := botNextOpenDay(uid, b, day.AddDate(0, 0, 1), now)
		return time.Time{}, &botCitaError{Status: 422, Code: "holiday", Date: d, Suggestions: s,
			Msg: fmt.Sprintf("Ese día (%s) está cerrado por %s.", day.Format("02/01"), name)}
	}

	// Día cerrado.
	open, start, end := botDaySchedule(b, day.Weekday())
	if !open {
		d, s := botNextOpenDay(uid, b, day.AddDate(0, 0, 1), now)
		return time.Time{}, &botCitaError{Status: 422, Code: "closed_day", Date: d, Suggestions: s,
			Msg: fmt.Sprintf("Los %s no se dan citas.", botDiasES[day.Weekday()])}
	}

	// Fuera del horario o fuera de los horarios de 30 min.
	slots := botDaySlots(start, end)
	inSlots := false
	for _, t := range slots {
		if t == hhmm {
			inSlots = true
			break
		}
	}
	if !inSlots {
		e := &botCitaError{Status: 422, Code: "outside_hours", Date: date,
			Suggestions: botFreeSlots(uid, b, day, now, 6)}
		if len(slots) > 0 && (hhmm < slots[0] || hhmm > slots[len(slots)-1]) {
			e.Msg = fmt.Sprintf("Ese día se dan citas de %s a %s.", slots[0], slots[len(slots)-1])
		} else {
			e.Msg = "Las citas son cada media hora (por ejemplo 10:00 o 10:30)."
		}
		if len(e.Suggestions) == 0 {
			e.Date, e.Suggestions = botNextOpenDay(uid, b, day.AddDate(0, 0, 1), now)
		}
		return time.Time{}, e
	}

	// Hora llena.
	free, err := citaSlotFree(uid, when, 0)
	if err != nil {
		return time.Time{}, &botCitaError{Status: 500, Code: "error", Msg: "No se pudo revisar el horario. Intenta de nuevo."}
	}
	if !free {
		e := &botCitaError{Status: 409, Code: "slot_taken", Date: date,
			Msg: "Esa hora ya está ocupada.", Suggestions: botFreeSlots(uid, b, day, now, 6)}
		if len(e.Suggestions) == 0 {
			e.Msg = "Ese día ya no hay horas libres."
			e.Date, e.Suggestions = botNextOpenDay(uid, b, day.AddDate(0, 0, 1), now)
		}
		return time.Time{}, e
	}
	return when, nil
}

// botExistingCita: la cita que ese mismo celular ya tiene a esa hora (el
// bot reintentó). nil = no hay.
func botExistingCita(uid uint, phone string, when time.Time) *models.Appointment {
	tail := botDigits(phone)
	if len(tail) > 10 {
		tail = tail[len(tail)-10:]
	}
	if len(tail) < 10 {
		return nil
	}
	var list []models.Appointment
	if err := config.DB.Where("user_id = ? AND date = ? AND status <> ? AND client_phone LIKE ?",
		uid, when, models.AppointmentStatusCancelled, "%"+tail).Find(&list).Error; err != nil {
		return nil
	}
	if len(list) == 0 {
		return nil
	}
	return &list[0]
}
