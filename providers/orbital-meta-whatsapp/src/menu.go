package src

// menu.go — Modo con botones (sin IA) para WhatsApp Business.
//
// Para negocios que no pagan IA: el cliente navega tocando opciones en
// vez de platicar. Se activa si el agente tiene responseMode "buttons" o
// si no hay API key de Gemini (en vez de contestar "no entendí").
//
// Menú principal (lista):
//   Servicios y precios · Horarios · Ubicación · Agendar cita ·
//   Estado de mis lentes (ópticas) · Hablar con una persona
//
// Agendar: servicio → día → hora → nombre → confirmar. Los días y horas
// vienen de GET /api/bot/availability (mismas reglas que el servidor usa
// al guardar), y la cita se guarda con POST /api/bot/appointments; si el
// servidor la rechaza (alguien ganó la hora), se vuelven a ofrecer horas.
//
// Ids de las opciones: "m:<opción>", "svc:<i>", "svcp:<pág>", "day:<fecha>",
// "tm:<HH:MM>", "tmp:<pág>", "nm:wa|other", "ok:yes|change|cancel".

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ButtonsModeActive — ¿contestar con el menú de botones?
func ButtonsModeActive() bool {
	cfg := GetBusinessConfig()
	if cfg != nil {
		switch strings.ToLower(strings.TrimSpace(cfg.ResponseMode)) {
		case "buttons":
			return true
		case "ai":
			return !geminiEnabled // eligió IA pero no hay key: mejor el menú
		}
	}
	return !geminiEnabled
}

// ── Estado por cliente ─────────────────────────────────────────────

type menuState struct {
	Step      string // "", "name_text"
	Service   string
	Date      string // YYYY-MM-DD
	DateLabel string
	Time      string // HH:MM
	Name      string
	Updated   time.Time
}

var (
	menuStates   = map[string]*menuState{}
	menuStatesMu sync.Mutex
)

const menuStateTTL = 30 * time.Minute

func getMenuState(phone string) *menuState {
	menuStatesMu.Lock()
	defer menuStatesMu.Unlock()
	st, ok := menuStates[phone]
	if !ok || time.Since(st.Updated) > menuStateTTL {
		st = &menuState{}
		menuStates[phone] = st
	}
	st.Updated = time.Now()
	return st
}

func resetMenuState(phone string) {
	menuStatesMu.Lock()
	delete(menuStates, phone)
	menuStatesMu.Unlock()
}

// ── Envío (y aviso al CRM en vivo) ─────────────────────────────────

type menuOut struct {
	c     *MetaClient
	phone string
	name  string
}

func (o menuOut) report(text string, err error) {
	if err != nil {
		log.Printf("❌ [Menú] Error enviando a %s: %v", o.phone, err)
		return
	}
	log.Printf("✅ [Menú] Enviado: %s", truncateString(strings.ReplaceAll(text, "\n", " "), 100))
	NotifyCRM("out", o.phone, o.name, text, "bot")
}

func (o menuOut) text(body string) {
	o.report(body, o.c.SendMessage(o.phone, body))
}

func (o menuOut) buttons(body string, b ...MenuButton) {
	o.report(body, o.c.SendButtons(o.phone, body, b))
}

func (o menuOut) list(header, body, button string, rows []MenuRow) {
	o.report(body, o.c.SendList(o.phone, header, body, button, rows))
}

var (
	btnMenu = MenuButton{ID: "m:menu", Title: "Menú"}
	btnBook = MenuButton{ID: "m:book", Title: "Agendar cita"}
)

// ── Entrada ────────────────────────────────────────────────────────

// HandleMenuMessage contesta un mensaje en modo con botones. replyID es el
// id de la opción que tocó ("" si escribió texto).
func HandleMenuMessage(c *MetaClient, phone, name, text, replyID string) {
	o := menuOut{c: c, phone: phone, name: name}
	st := getMenuState(phone)
	log.Printf("🔘 [Menú] %s → id=%q texto=%q paso=%q", phone, replyID, text, st.Step)

	if replyID == "" {
		menuFreeText(o, st, text)
		return
	}

	key, arg := replyID, ""
	if i := strings.Index(replyID, ":"); i >= 0 {
		key, arg = replyID[:i], replyID[i+1:]
	}
	switch key {
	case "m":
		menuOption(o, st, arg)
	case "svc":
		i, _ := strconv.Atoi(arg)
		svcs := menuServices()
		if i < 0 || i >= len(svcs) {
			menuServiceList(o, 0)
			return
		}
		st.Service = svcs[i].Title
		menuDayList(o, st)
	case "svcp":
		p, _ := strconv.Atoi(arg)
		menuServiceList(o, p)
	case "day":
		st.Date, st.Time = arg, ""
		menuTimeList(o, st, 0, "")
	case "tmp":
		p, _ := strconv.Atoi(arg)
		menuTimeList(o, st, p, "")
	case "tm":
		if st.Date == "" {
			menuDayList(o, st)
			return
		}
		st.Time = arg
		menuAskName(o, st)
	case "nm":
		if arg == "wa" && strings.TrimSpace(o.name) != "" {
			st.Name = strings.TrimSpace(o.name)
			menuConfirm(o, st)
			return
		}
		st.Step = "name_text"
		o.text("✍️ Escríbeme el nombre para la cita.")
	case "ok":
		switch arg {
		case "yes":
			menuSave(o, st)
		case "change":
			st.Date, st.Time = "", ""
			menuDayList(o, st)
		default:
			resetMenuState(phone)
			o.buttons("Listo, no agendé nada. ¿Te ayudo con algo más?", btnMenu)
		}
	default:
		menuMain(o, "")
	}
}

// menuFreeText — escribió en vez de tocar una opción.
func menuFreeText(o menuOut, st *menuState, text string) {
	t := strings.TrimSpace(text)
	if st.Step == "name_text" && t != "" {
		st.Step = ""
		st.Name = clip(t, 60)
		menuConfirm(o, st)
		return
	}
	// Ópticas: "¿ya están mis lentes?" o la clave de rastreo
	if reply, ok := tryLensStatusReply(GetUserState(o.phone), t, o.phone); ok {
		o.buttons(reply, btnMenu)
		return
	}
	n := strings.ToLower(NormalizeText(t))
	switch {
	case ContainsKeywords(n, []string{"cita", "agendar", "reservar", "apartar"}):
		menuOption(o, st, "book")
	case ContainsKeywords(n, []string{"horario", "abren", "cierran", "abierto"}):
		menuOption(o, st, "hours")
	case ContainsKeywords(n, []string{"ubicacion", "ubicación", "direccion", "dirección", "donde", "dónde"}):
		menuOption(o, st, "location")
	case ContainsKeywords(n, []string{"precio", "servicio", "costo", "cuanto", "cuánto"}):
		menuOption(o, st, "services")
	case ContainsKeywords(n, []string{"persona", "humano", "asesor", "agente"}):
		menuOption(o, st, "human")
	default:
		menuMain(o, "")
	}
}

// menuOption — opción del menú principal.
func menuOption(o menuOut, st *menuState, opt string) {
	cfg := GetBusinessConfig()
	switch opt {
	case "services":
		o.buttons(menuServicesText(), btnBook, btnMenu)
	case "hours":
		o.buttons(menuHoursText(), btnBook, btnMenu)
	case "location":
		o.buttons(menuLocationText(), btnMenu)
	case "book":
		st.Step, st.Service, st.Date, st.Time = "", "", "", ""
		if len(menuServices()) > 0 {
			menuServiceList(o, 0)
		} else {
			menuDayList(o, st)
		}
	case "lens":
		if reply, ok := tryLensStatusReply(GetUserState(o.phone), "ya estan mis lentes", o.phone); ok {
			o.buttons(reply, btnMenu)
		} else {
			o.buttons("Mándame la clave de rastreo de tu ticket (empieza con *AT*) y te digo cómo va tu pedido 👓.", btnMenu)
		}
	case "human":
		SetHumanControlled(o.phone)
		biz := "el negocio"
		if cfg != nil && cfg.AgentName != "" {
			biz = cfg.AgentName
		}
		o.text(fmt.Sprintf("👤 Listo, le aviso al equipo de %s. En un momento te atiende una persona por aquí.", biz))
	default:
		menuMain(o, "")
	}
}

// menuMain — menú principal.
func menuMain(o menuOut, intro string) {
	cfg := GetBusinessConfig()
	if intro == "" {
		hi := "¡Hola"
		if n := strings.TrimSpace(o.name); n != "" && n != "Cliente" {
			hi += " " + strings.Fields(n)[0]
		}
		biz := ""
		if cfg != nil && cfg.AgentName != "" {
			biz = " de *" + cfg.AgentName + "*"
		}
		intro = hi + "! 👋 Soy el asistente" + biz + ".\n\nToca *Ver opciones* y elige lo que necesitas."
	}
	rows := []MenuRow{}
	if len(menuServices()) > 0 {
		rows = append(rows, MenuRow{ID: "m:services", Title: "💼 Servicios y precios", Description: "Lo que ofrecemos y cuánto cuesta"})
	}
	rows = append(rows,
		MenuRow{ID: "m:hours", Title: "🕐 Horarios", Description: "Días y horas que abrimos"},
		MenuRow{ID: "m:location", Title: "📍 Ubicación", Description: "Dirección y mapa"},
		MenuRow{ID: "m:book", Title: "📅 Agendar cita", Description: "Elige día y hora disponibles"},
	)
	if isOpticaMode() {
		rows = append(rows, MenuRow{ID: "m:lens", Title: "👓 Estado de mis lentes", Description: "En qué paso va tu pedido"})
	}
	rows = append(rows, MenuRow{ID: "m:human", Title: "👤 Hablar con alguien", Description: "Te atiende una persona del equipo"})
	o.list("", intro, "Ver opciones", rows)
}

// ── Información ────────────────────────────────────────────────────

func menuServices() []Service {
	cfg := GetBusinessConfig()
	if cfg == nil {
		return nil
	}
	out := make([]Service, 0, len(cfg.Services))
	for _, s := range cfg.Services {
		if strings.TrimSpace(s.Title) != "" {
			out = append(out, s)
		}
	}
	return out
}

func menuPrice(p float64) string {
	if p <= 0 {
		return ""
	}
	if p == float64(int64(p)) {
		return fmt.Sprintf("$%d", int64(p))
	}
	return fmt.Sprintf("$%.2f", p)
}

func menuServicesText() string {
	svcs := menuServices()
	if len(svcs) == 0 {
		return "Por ahora no tengo la lista de servicios. Toca *Menú* para ver otras opciones o pide hablar con alguien."
	}
	var b strings.Builder
	b.WriteString("💼 *Servicios*\n")
	for _, s := range svcs {
		b.WriteString("\n• *" + s.Title + "*")
		if p := menuPrice(s.Price); p != "" {
			b.WriteString(" — " + p)
		}
		if s.Duration > 0 {
			b.WriteString(" (" + FormatDuration(s.Duration) + ")")
		}
		if d := strings.TrimSpace(s.Description); d != "" {
			b.WriteString("\n  " + clip(d, 120))
		}
	}
	return clip(b.String(), 1024)
}

var menuWeek = []struct {
	name string
	get  func(*Schedule) *DaySchedule
}{
	{"Lunes", func(s *Schedule) *DaySchedule { return s.Monday }},
	{"Martes", func(s *Schedule) *DaySchedule { return s.Tuesday }},
	{"Miércoles", func(s *Schedule) *DaySchedule { return s.Wednesday }},
	{"Jueves", func(s *Schedule) *DaySchedule { return s.Thursday }},
	{"Viernes", func(s *Schedule) *DaySchedule { return s.Friday }},
	{"Sábado", func(s *Schedule) *DaySchedule { return s.Saturday }},
	{"Domingo", func(s *Schedule) *DaySchedule { return s.Sunday }},
}

func menuHoursText() string {
	cfg := GetBusinessConfig()
	if cfg == nil {
		return "Por ahora no tengo los horarios. Toca *Menú* para ver otras opciones."
	}
	var b strings.Builder
	b.WriteString("🕐 *Horarios*\n")
	hasAny := false
	for _, d := range menuWeek {
		ds := d.get(&cfg.Schedule)
		if ds != nil && ds.Open != "" && ds.Close != "" {
			hasAny = true
			b.WriteString(fmt.Sprintf("\n%s: %s a %s", d.name, bookingHora12(ds.Open), bookingHora12(ds.Close)))
		} else {
			b.WriteString(fmt.Sprintf("\n%s: cerrado", d.name))
		}
	}
	if !hasAny {
		if strings.TrimSpace(cfg.BusinessHours) != "" {
			return "🕐 *Horarios*\n" + cfg.BusinessHours
		}
		return "Por ahora no tengo los horarios. Toca *Menú* para ver otras opciones."
	}
	return b.String()
}

func menuLocationText() string {
	cfg := GetBusinessConfig()
	if cfg == nil {
		return "Por ahora no tengo la dirección. Toca *Menú* para ver otras opciones."
	}
	l := cfg.Location
	street := strings.TrimSpace(strings.TrimSpace(l.Address + " " + l.Number))
	parts := []string{}
	for _, p := range []string{street, l.Neighborhood, l.City, l.State} {
		if p = strings.TrimSpace(p); p != "" {
			parts = append(parts, p)
		}
	}
	addr := strings.Join(parts, ", ")
	if l.PostalCode != "" && addr != "" {
		addr += " C.P. " + l.PostalCode
	}
	if addr == "" {
		addr = strings.TrimSpace(cfg.Address)
	}
	if addr == "" {
		return "Por ahora no tengo la dirección. Toca *Menú* para ver otras opciones."
	}
	var b strings.Builder
	b.WriteString("📍 *Ubicación*\n" + addr)
	if l.BetweenStreets != "" {
		b.WriteString("\nEntre " + l.BetweenStreets)
	}
	if l.Instructions != "" {
		b.WriteString("\n" + l.Instructions)
	}
	maps := strings.TrimSpace(l.GoogleMapsURL)
	if maps == "" {
		maps = strings.TrimSpace(cfg.GoogleMapsLink)
	}
	if maps == "" {
		maps = "https://www.google.com/maps/search/?api=1&query=" + url.QueryEscape(addr)
	}
	b.WriteString("\n\n🗺 " + maps)
	return b.String()
}

// ── Agendar ────────────────────────────────────────────────────────

// menuPage — filas de la página p (9 por página + "Ver más").
func menuPage[T any](items []T, p int, row func(i int, it T) MenuRow, moreID func(next int) string) []MenuRow {
	const per = 9
	if len(items) <= 10 {
		p = 0
	}
	start := p * per
	if start >= len(items) {
		start = 0
		p = 0
	}
	rows := []MenuRow{}
	end := len(items)
	if len(items) > 10 {
		end = start + per
		if end > len(items) {
			end = len(items)
		}
	}
	for i := start; i < end; i++ {
		rows = append(rows, row(i, items[i]))
	}
	if len(items) > 10 {
		next := p + 1
		if end >= len(items) {
			next = 0
		}
		label := "➡️ Ver más"
		if next == 0 {
			label = "↩️ Volver al inicio"
		}
		rows = append(rows, MenuRow{ID: moreID(next), Title: label})
	}
	return rows
}

func menuServiceList(o menuOut, p int) {
	svcs := menuServices()
	rows := menuPage(svcs, p, func(i int, s Service) MenuRow {
		desc := menuPrice(s.Price)
		if s.Duration > 0 {
			if desc != "" {
				desc += " · "
			}
			desc += FormatDuration(s.Duration)
		}
		if desc == "" {
			desc = s.Description
		}
		return MenuRow{ID: "svc:" + strconv.Itoa(i), Title: s.Title, Description: desc}
	}, func(n int) string { return "svcp:" + strconv.Itoa(n) })
	o.list("📅 Agendar cita", "¿Qué servicio quieres?", "Ver servicios", rows)
}

type availDay struct {
	Date  string   `json:"date"`
	Label string   `json:"label"`
	Slots []string `json:"slots"`
}

// fetchAvailability — días con horas libres (date = "" → próximos días).
func fetchAvailability(date string) ([]availDay, error) {
	base := os.Getenv("ATTOMOS_API_URL")
	tok := os.Getenv("BOT_API_TOKEN")
	agent := os.Getenv("AGENT_ID")
	if base == "" || tok == "" || agent == "" {
		return nil, fmt.Errorf("ATTOMOS_API_URL, BOT_API_TOKEN o AGENT_ID no configurados")
	}
	q := url.Values{"agentId": {agent}, "days": {"10"}}
	if date != "" {
		q.Set("date", date)
	}
	req, err := http.NewRequest("GET", strings.TrimRight(base, "/")+"/api/bot/availability?"+q.Encode(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+tok)
	resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("availability %d: %s", resp.StatusCode, truncateString(string(body), 200))
	}
	var r struct {
		Days []availDay `json:"days"`
	}
	if err := json.Unmarshal(body, &r); err != nil {
		return nil, err
	}
	return r.Days, nil
}

func menuCap(s string) string {
	r := []rune(s)
	if len(r) == 0 {
		return s
	}
	return strings.ToUpper(string(r[0])) + string(r[1:])
}

func menuDayList(o menuOut, st *menuState) {
	days, err := fetchAvailability("")
	if err != nil {
		log.Printf("⚠️  [Menú] Disponibilidad: %v", err)
		o.buttons("😕 Ahorita no pude revisar la agenda. Intenta en un momento o pide hablar con alguien.", btnMenu, MenuButton{ID: "m:human", Title: "Hablar con alguien"})
		return
	}
	if len(days) == 0 {
		o.buttons("😕 No hay horarios libres en los próximos días. Pide hablar con alguien y te buscamos un espacio.", MenuButton{ID: "m:human", Title: "Hablar con alguien"}, btnMenu)
		return
	}
	rows := make([]MenuRow, 0, len(days))
	for _, d := range days {
		desc := fmt.Sprintf("%d horarios libres", len(d.Slots))
		if len(d.Slots) == 1 {
			desc = "1 horario libre"
		}
		if len(d.Slots) > 0 {
			desc += " · desde " + bookingHora12(d.Slots[0])
		}
		rows = append(rows, MenuRow{ID: "day:" + d.Date, Title: menuCap(d.Label), Description: desc})
	}
	body := "¿Qué día te acomoda?"
	if st.Service != "" {
		body = "*" + st.Service + "*\n\n" + body
	}
	o.list("📅 Agendar cita", body, "Ver días", rows)
}

func menuTimeList(o menuOut, st *menuState, p int, intro string) {
	days, err := fetchAvailability(st.Date)
	if err != nil {
		log.Printf("⚠️  [Menú] Disponibilidad %s: %v", st.Date, err)
		o.buttons("😕 Ahorita no pude revisar la agenda. Intenta en un momento.", btnMenu)
		return
	}
	if len(days) == 0 || len(days[0].Slots) == 0 {
		msg := "😕 Ese día ya no tiene horarios libres. Elige otro:"
		if intro != "" {
			msg = intro + "\n\n" + msg
		}
		o.text(msg)
		st.Date = ""
		menuDayList(o, st)
		return
	}
	st.DateLabel = days[0].Label
	rows := menuPage(days[0].Slots, p, func(_ int, h string) MenuRow {
		return MenuRow{ID: "tm:" + h, Title: bookingHora12(h)}
	}, func(n int) string { return "tmp:" + strconv.Itoa(n) })
	body := "¿A qué hora? (" + days[0].Label + ")"
	if intro != "" {
		body = intro + "\n\n" + body
	}
	o.list("🕐 "+menuCap(days[0].Label), body, "Ver horarios", rows)
}

func menuAskName(o menuOut, st *menuState) {
	n := strings.TrimSpace(o.name)
	if n == "" || n == "Cliente" {
		st.Step = "name_text"
		o.text("✍️ ¿A nombre de quién hago la cita?")
		return
	}
	o.buttons("¿A nombre de quién hago la cita?",
		MenuButton{ID: "nm:wa", Title: clip(n, 20)},
		MenuButton{ID: "nm:other", Title: "Otro nombre"},
	)
}

func menuSummary(st *menuState) string {
	var b strings.Builder
	if st.Service != "" {
		b.WriteString("💼 " + st.Service + "\n")
	}
	b.WriteString("📅 " + menuCap(st.DateLabel) + "\n")
	b.WriteString("🕐 " + bookingHora12(st.Time) + "\n")
	b.WriteString("👤 " + st.Name)
	return b.String()
}

func menuConfirm(o menuOut, st *menuState) {
	if st.Date == "" || st.Time == "" {
		menuDayList(o, st)
		return
	}
	o.buttons("¿Confirmo tu cita?\n\n"+menuSummary(st),
		MenuButton{ID: "ok:yes", Title: "✅ Confirmar"},
		MenuButton{ID: "ok:change", Title: "Cambiar día/hora"},
		MenuButton{ID: "ok:cancel", Title: "Cancelar"},
	)
}

func menuSave(o menuOut, st *menuState) {
	if st.Date == "" || st.Time == "" || st.Name == "" {
		menuOption(o, st, "book")
		return
	}
	payload := BotAppointmentPayload{
		ClientName: st.Name,
		Phone:      cleanPhoneNumber(o.phone),
		Service:    st.Service,
		Date:       st.Date,
		Time:       st.Time,
	}
	if err := SaveAppointmentToBackend(payload); err != nil {
		var rej *BookingRejected
		if errors.As(err, &rej) {
			log.Printf("⚠️  [Menú] El servidor rechazó la cita: %v", rej)
			if rej.Date != "" && rej.Date != st.Date {
				st.Date = rej.Date
			}
			st.Time = ""
			menuTimeList(o, st, 0, "😕 "+rej.Msg)
			return
		}
		log.Printf("❌ [Menú] No se pudo guardar la cita: %v", err)
		o.buttons("😕 No pude registrar tu cita ahorita. Intenta de nuevo en un momento o pide hablar con alguien.",
			MenuButton{ID: "ok:yes", Title: "Reintentar"}, MenuButton{ID: "m:human", Title: "Hablar con alguien"})
		return
	}

	// Igual que el flujo con IA: Sheets y Calendar si están conectados.
	if t, err := time.Parse("2006-01-02", st.Date); err == nil {
		data := map[string]string{
			"nombre":      st.Name,
			"telefono":    payload.Phone,
			"servicio":    st.Service,
			"fecha":       FormatFecha(t),
			"fechaExacta": FormatFecha(t),
			"diaSemana":   GetDayOfWeek(t),
			"hora":        bookingHora12(st.Time),
		}
		if IsSheetsEnabled() {
			if err := SaveAppointmentToSheets(data["nombre"], data["telefono"], data["fechaExacta"], data["hora"], data["servicio"], ""); err != nil {
				log.Printf("❌ [Menú] Sheets: %v", err)
			}
		}
		if IsCalendarEnabled() {
			if _, err := CreateCalendarEvent(data); err != nil {
				log.Printf("❌ [Menú] Calendar: %v", err)
			}
		}
	}

	service := st.Service
	resetMenuState(o.phone)
	o.buttons("✅ *¡Cita agendada!*\n\n"+menuSummary(st)+"\n\nSi necesitas cambiarla, escríbenos por aquí.", btnMenu)
	// Los datos de pago van aparte (pueden pasar del límite de un mensaje con botones).
	if HasPaymentMethods() && service != "" {
		if pm := BuildPaymentMessage(service, GetServicePrice(service), ""); pm != "" {
			o.text(pm)
		}
	}
}
