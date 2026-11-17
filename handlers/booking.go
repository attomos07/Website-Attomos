package handlers

// booking.go — Página pública para agendar (/agendar/:id). El cliente del
// negocio elige día y hora, deja sus datos y contesta las preguntas
// rápidas (las mismas de Avante en ópticas); la cita cae en Recepción →
// Citas como "Pendiente" con la etiqueta "Por la web" para que el negocio
// la confirme. Usa el mismo horario y los mismos espacios (uno por
// trabajador) que "Nueva cita" del panel.
//
//	GET  /agendar/:id                     página (id = negocio)
//	GET  /api/agendar/:id                 negocio y horario
//	GET  /api/agendar/:id/ocupadas?fecha= horas llenas de ese día
//	POST /api/agendar/:id                 agenda la cita
//	GET  /api/citas/compartir             (panel) ligas para compartir

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"attomos/config"
	"attomos/models"

	"github.com/gin-gonic/gin"
)

const (
	bookingMaxDays   = 60 // hasta cuántos días adelante se puede agendar
	bookingMinLead   = 30 * time.Minute
	bookingMaxFuture = 2 // citas por la web pendientes por celular
)

// bookingOwner — el negocio de la liga (nil si no existe).
func bookingOwner(c *gin.Context) *models.User {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		return nil
	}
	var u models.User
	if err := config.DB.Select("id, company, business_type").First(&u, id).Error; err != nil {
		return nil
	}
	return &u
}

func bookingBranch(uid uint) *models.MyBusinessInfo {
	var b models.MyBusinessInfo
	if err := config.DB.Where("user_id = ?", uid).Order("branch_number ASC").First(&b).Error; err != nil {
		return nil
	}
	return &b
}

// bookingBaseURL — dominio público (BASE_URL o el de la petición).
func bookingBaseURL(c *gin.Context) string {
	if b := strings.TrimRight(os.Getenv("BASE_URL"), "/"); b != "" {
		return b
	}
	scheme := "https"
	if c.Request.TLS == nil && !strings.EqualFold(c.GetHeader("X-Forwarded-Proto"), "https") {
		scheme = "http"
	}
	return scheme + "://" + c.Request.Host
}

type bookingClosed struct {
	Fecha  string `json:"fecha"`
	Motivo string `json:"motivo,omitempty"`
}

// bookingHolidayMD — mes y día de un día cerrado de Mi Negocio. Se guarda
// como "AAAA-MM-DD" (el año es el de cuando se guardó) o "DD/MM"; en los
// dos casos se repite cada año.
func bookingHolidayMD(raw string) (int, int, bool) {
	raw = strings.TrimSpace(raw)
	var m, d int
	if p := strings.Split(raw, "-"); len(p) == 3 {
		m, _ = strconv.Atoi(p[1])
		d, _ = strconv.Atoi(strings.TrimSpace(p[2])[:minInt(2, len(strings.TrimSpace(p[2])))])
	} else if p := strings.Split(raw, "/"); len(p) >= 2 {
		d, _ = strconv.Atoi(strings.TrimSpace(p[0]))
		m, _ = strconv.Atoi(strings.TrimSpace(p[1]))
	}
	if m < 1 || m > 12 || d < 1 || d > 31 {
		return 0, 0, false
	}
	return m, d, true
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// bookingClosedDays — días cerrados de Mi Negocio (se repiten cada año)
// que caen de hoy a los próximos bookingMaxDays días.
func bookingClosedDays(b *models.MyBusinessInfo) []bookingClosed {
	out := []bookingClosed{}
	if b == nil {
		return out
	}
	now := time.Now().In(time.Local)
	today := now.Format("2006-01-02")
	limit := now.AddDate(0, 0, bookingMaxDays+1).Format("2006-01-02")
	seen := map[string]bool{}
	for _, h := range b.Holidays {
		m, d, ok := bookingHolidayMD(h.Date)
		if !ok {
			continue
		}
		for _, y := range []int{now.Year(), now.Year() + 1} {
			t := time.Date(y, time.Month(m), d, 0, 0, 0, 0, time.Local)
			if t.Day() != d { // 29 de febrero en año no bisiesto
				continue
			}
			f := t.Format("2006-01-02")
			if f < today || f > limit || seen[f] {
				continue
			}
			seen[f] = true
			out = append(out, bookingClosed{Fecha: f, Motivo: bookingCut(strings.TrimSpace(h.Name), 80)})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Fecha < out[j].Fecha })
	return out
}

func bookingIsClosed(b *models.MyBusinessInfo, day string) bool {
	for _, d := range bookingClosedDays(b) {
		if d.Fecha == day {
			return true
		}
	}
	return false
}

// bookingDayHours — primera y última hora para empezar cita de cada día
// (0 = domingo), del horario de Mi Negocio. Sin horario: el general.
func bookingDayHours(uid uint, b *models.MyBusinessInfo) map[int][2]string {
	out := map[int][2]string{}
	if b != nil {
		s := b.Schedule
		week := []models.DaySchedule{s.Sunday, s.Monday, s.Tuesday, s.Wednesday, s.Thursday, s.Friday, s.Saturday}
		for i, d := range week {
			if !d.Open || !citaHHMM.MatchString(d.Start) || !citaHHMM.MatchString(d.End) || d.End <= d.Start {
				continue
			}
			last := d.End
			if t, err := time.Parse("15:04", d.End); err == nil {
				if l := t.Add(-30 * time.Minute).Format("15:04"); l >= d.Start {
					last = l
				}
			}
			out[i] = [2]string{d.Start, last}
		}
	}
	if len(out) == 0 {
		open, close, days := citaHours(uid)
		for _, d := range days {
			out[d] = [2]string{open, close}
		}
	}
	return out
}

/* ---------------- página ---------------- */

// BookingPage — GET /agendar/:id
func BookingPage(c *gin.Context) {
	u := bookingOwner(c)
	if u == nil {
		c.HTML(http.StatusNotFound, "agendar-cita.html", gin.H{"NotFound": true})
		return
	}
	c.HTML(http.StatusOK, "agendar-cita.html", gin.H{"ID": u.ID, "Negocio": invBusinessName(u.ID)})
}

// BookingInfo — GET /api/agendar/:id
func BookingInfo(c *gin.Context) {
	u := bookingOwner(c)
	if u == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Esta liga para agendar ya no existe."})
		return
	}
	b := bookingBranch(u.ID)
	open, close, days := citaHours(u.ID)
	horario := map[string][2]string{}
	for d, h := range bookingDayHours(u.ID, b) {
		horario[strconv.Itoa(d)] = h
	}

	neg := gin.H{"nombre": invBusinessName(u.ID), "optica": isOpticaType(u.BusinessType)}
	if b != nil {
		neg["logo"] = b.LogoURL
		neg["telefono"] = b.PhoneNumber
		addr := []string{}
		for _, p := range []string{strings.TrimSpace(b.Location.Address + " " + b.Location.Number), b.Location.Neighborhood, b.Location.City} {
			if strings.TrimSpace(p) != "" {
				addr = append(addr, strings.TrimSpace(p))
			}
		}
		neg["direccion"] = strings.Join(addr, ", ")
		if neg["optica"] == false {
			neg["optica"] = isOpticaType(b.BusinessType)
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"negocio":  neg,
		"open":     open,
		"close":    close,
		"days":     days,
		"horario":  horario, // por día: [primera, última] hora para empezar
		"cerrados": bookingClosedDays(b),
		"maxDias":  bookingMaxDays,
		"hoy":      time.Now().In(time.Local).Format("2006-01-02"),
		"ahora":    time.Now().In(time.Local).Format("15:04"),
	})
}

// BookingOccupied — GET /api/agendar/:id/ocupadas?fecha=YYYY-MM-DD
func BookingOccupied(c *gin.Context) {
	u := bookingOwner(c)
	if u == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Esta liga para agendar ya no existe."})
		return
	}
	counts, err := citaSlotCounts(u.ID, c.Query("fecha"), 0)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Fecha inválida."})
		return
	}
	capacity := citaCapacity(u.ID)
	out := []string{}
	for t, n := range counts {
		if n >= capacity {
			out = append(out, t)
		}
	}
	sort.Strings(out)
	c.JSON(http.StatusOK, gin.H{"ocupadas": out, "cerrado": bookingIsClosed(bookingBranch(u.ID), c.Query("fecha"))})
}

/* ---------------- agendar ---------------- */

// Freno contra abusos: 6 citas por IP cada hora.
var (
	bookingMu   sync.Mutex
	bookingHits = map[string][]time.Time{}
)

func bookingTooMany(ip string) bool {
	bookingMu.Lock()
	defer bookingMu.Unlock()
	cutoff := time.Now().Add(-time.Hour)
	keep := bookingHits[ip][:0]
	for _, t := range bookingHits[ip] {
		if t.After(cutoff) {
			keep = append(keep, t)
		}
	}
	bookingHits[ip] = keep
	return len(keep) >= 6
}

func bookingHit(ip string) {
	bookingMu.Lock()
	bookingHits[ip] = append(bookingHits[ip], time.Now())
	bookingMu.Unlock()
}

var bookingHalfHour = regexp.MustCompile(`^\d{2}:(00|30)$`)

type bookingInput struct {
	citaInput
	Website string `json:"website"` // trampa para bots: siempre vacío
}

// BookingCreate — POST /api/agendar/:id
func BookingCreate(c *gin.Context) {
	u := bookingOwner(c)
	if u == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Esta liga para agendar ya no existe."})
		return
	}
	var in bookingInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Completa día, hora, nombre, apellido y celular."})
		return
	}
	if strings.TrimSpace(in.Website) != "" {
		// Bot de spam: se le contesta como si todo saliera bien.
		c.JSON(http.StatusCreated, gin.H{"ok": true})
		return
	}
	ip := c.ClientIP()
	if bookingTooMany(ip) {
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "Ya agendaste varias citas. Si necesitas otra, comunícate con el negocio."})
		return
	}
	in.Tag, in.Status, in.Trabajador, in.Servicio = "", "", "", ""
	when, msg := in.validate()
	q, qmsg := citaQuestionnaire(in.Cuestionario)
	if msg == "" {
		msg = qmsg
	}
	if msg == "" {
		in.Notas = bookingCut(in.Notas, 500)
		now := time.Now().In(time.Local)
		dh, dayOK := bookingDayHours(u.ID, bookingBranch(u.ID))[int(when.Weekday())]
		hm := when.Format("15:04")
		switch {
		case !dayOK:
			msg = "Ese día no se dan citas. Elige otro día."
		case !bookingHalfHour.MatchString(in.Time) || hm < dh[0] || hm > dh[1]:
			msg = "Esa hora no está disponible. Elige otra."
		case when.Before(now.Add(bookingMinLead)):
			msg = "Esa hora ya pasó. Elige otra."
		case when.After(now.AddDate(0, 0, bookingMaxDays+1)):
			msg = fmt.Sprintf("Solo se puede agendar con %d días de anticipación.", bookingMaxDays)
		case !citaDayOpen(u.ID, when) || bookingIsClosed(bookingBranch(u.ID), in.Date):
			msg = "Ese día no se dan citas. Elige otro día."
		}
	}
	if msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}

	// Un mismo celular no puede apartar muchas horas.
	var pend int64
	config.DB.Model(&models.Appointment{}).
		Where("user_id = ? AND client_phone = ? AND source = ? AND date >= ? AND status IN ?", u.ID, in.Celular, models.AppointmentSourceWeb, time.Now(),
			[]models.AppointmentStatus{models.AppointmentStatusPending, models.AppointmentStatusConfirmed}).
		Count(&pend)
	if pend >= bookingMaxFuture {
		c.JSON(http.StatusConflict, gin.H{"error": "Ya tienes citas agendadas con este número. Si quieres cambiarlas, comunícate con el negocio."})
		return
	}
	free, err := citaSlotFree(u.ID, when, 0)
	if err != nil {
		citaFail(c, "BookingCreate", err, "No se pudo verificar el horario. Intenta de nuevo.")
		return
	}
	if !free {
		c.JSON(http.StatusConflict, gin.H{"error": "Alguien acaba de apartar esa hora. Elige otra.", "ocupada": true})
		return
	}
	a := models.Appointment{
		UserID:          u.ID,
		ClientFirstName: in.Nombre,
		ClientLastName:  in.Apellido,
		ClientPhone:     in.Celular,
		ClientEmail:     in.Correo,
		ClientBirthDate: in.FechaNacimiento,
		Questionnaire:   q,
		Notes:           in.Notas,
		Date:            when,
		Status:          models.AppointmentStatusPending,
		Source:          models.AppointmentSourceWeb,
		// Etiqueta automática "Por la web" (citaTagOf, por el Source).
	}
	if err := config.DB.Create(&a).Error; err != nil {
		citaFail(c, "BookingCreate", err, "No se pudo agendar. Intenta de nuevo.")
		return
	}
	bookingHit(ip)
	LivePublish(u.ID, "citas", "optometria")
	log.Printf("📅 [Agendar] Cita web ID=%d negocio=%d %s %s", a.ID, u.ID, in.Date, in.Time)
	c.JSON(http.StatusCreated, gin.H{"ok": true, "id": a.ID})
}

/* ---------------- panel: compartir ---------------- */

// CitasShareLinks — GET /api/citas/compartir
func CitasShareLinks(c *gin.Context) {
	uid := invUserID(c)
	base := bookingBaseURL(c)
	c.JSON(http.StatusOK, gin.H{
		"negocio": invBusinessName(uid),
		"agendar": fmt.Sprintf("%s/agendar/%d", base, uid),
		"rastreo": base + "/rastreo",
		"optica":  invIsOptica(uid),
	})
}

func bookingCut(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		return strings.TrimSpace(string(r[:n])) + "…"
	}
	return s
}
