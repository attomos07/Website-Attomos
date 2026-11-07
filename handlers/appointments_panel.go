package handlers

// appointments_panel.go — Mis citas (sidebar → Mis citas), portado de
// Recepción → Citas de Avante Optics: vista Día / Calendario / Tabla,
// periodo, tipos de cita (cómo llegó), crear / editar / reagendar,
// asistió / no asistió, cancelar, datos del cliente, exportar PDF y — solo
// en ópticas — el seguimiento al asistir (¿compró? → próxima revisión).
//
// La página se arma en el servidor (una fila por cita con sus data-*), igual
// que en Avante; el JS (static/js/client/citas.js) trabaja sobre esas filas.
//
//	GET    /appointments                         página
//	POST   /api/citas                            crear cita (desde el panel)
//	PUT    /api/citas/:id                        editar / reagendar
//	PATCH  /api/citas/:id/estado                 {status: verificada|cancelada|asistio|no_asistio|pendiente}
//	DELETE /api/citas/:id
//	GET    /api/citas/etiquetas                  {tags: {"12": "chequeo"}}
//	PUT    /api/citas/:id/etiqueta               {tag}
//	GET    /api/citas/seguimiento                {items: {"12": {compro, meses}}}
//	PUT    /api/citas/:id/seguimiento            {compro, meses} (marca "asistió")
//	GET    /api/citas/horarios                   {open, close, days, capacidad}
//	GET    /api/citas/horarios/ocupadas?fecha=   {ocupadas: ["10:00", …]}
//
// Estados: en la base siguen los de Attomos (pending, confirmed, completed,
// cancelled + no_show); el panel usa los nombres de Avante y aquí se traducen.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"attomos/config"
	"attomos/google"
	"attomos/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

/* ---------------- estados y origen ---------------- */

var citaStatusToPanel = map[models.AppointmentStatus]string{
	models.AppointmentStatusPending:   "pendiente",
	models.AppointmentStatusConfirmed: "verificada",
	models.AppointmentStatusCompleted: "asistio",
	models.AppointmentStatusCancelled: "cancelada",
	models.AppointmentStatusNoShow:    "no_asistio",
}

var citaStatusFromPanel = map[string]models.AppointmentStatus{
	"pendiente":  models.AppointmentStatusPending,
	"verificada": models.AppointmentStatusConfirmed,
	"asistio":    models.AppointmentStatusCompleted,
	"cancelada":  models.AppointmentStatusCancelled,
	"no_asistio": models.AppointmentStatusNoShow,
}

var citaStatusLabel = map[string]string{
	"pendiente":  "Pendiente",
	"verificada": "Por atender",
	"asistio":    "Asistió",
	"cancelada":  "Cancelada",
	"no_asistio": "No asistió",
}

func citaPanelStatus(s models.AppointmentStatus) string {
	if v, ok := citaStatusToPanel[s]; ok {
		return v
	}
	return "pendiente"
}

// citaFromBot: la agendó el bot (directo o por su hoja de Google).
func citaFromBot(a *models.Appointment) bool {
	return a.Source == models.AppointmentSourceAgent || a.Source == models.AppointmentSourceSheets
}

// Etiquetas que se eligen a mano. "bot" es automática (citas del bot).
var citaTags = map[string]bool{"sin_cita": true, "chequeo": true, "telefono": true, "whatsapp": true}

const citaTagBot = "bot"

func citaTagOf(a *models.Appointment) string {
	if a.Tag != "" {
		return a.Tag
	}
	if citaFromBot(a) {
		return citaTagBot
	}
	return ""
}

/* ---------------- página ---------------- */

var citaMesesEs = [...]string{"ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"}

func citaFechaEs(t time.Time) string {
	return fmt.Sprintf("%d %s %d", t.Day(), citaMesesEs[t.Month()-1], t.Year())
}

// CitaRow — una fila de la tabla de Mis citas.
type CitaRow struct {
	ID              uint
	Status          string
	StatusLabel     string
	Date            string
	Time            string
	Nombre          string
	Apellido        string
	Celular         string
	Correo          string
	FechaNacimiento string
	Cuestionario    string
	CancelReason    string
	Origen          string // "web" (bot) | "recepcion" (panel)
	Servicio        string
	Trabajador      string
	Notas           string
	Agente          string
	FechaEs         string
	CreadaEs        string
}

func citaRowOf(a *models.Appointment, agents map[uint]string) CitaRow {
	d := a.Date.In(time.Local)
	origen := "recepcion"
	if citaFromBot(a) {
		origen = "web"
	}
	return CitaRow{
		ID:              a.ID,
		Status:          citaPanelStatus(a.Status),
		StatusLabel:     citaStatusLabel[citaPanelStatus(a.Status)],
		Date:            d.Format("2006-01-02"),
		Time:            d.Format("15:04"),
		Nombre:          strings.TrimSpace(a.ClientFirstName),
		Apellido:        strings.TrimSpace(a.ClientLastName),
		Celular:         a.ClientPhone,
		Correo:          a.ClientEmail,
		FechaNacimiento: a.ClientBirthDate,
		Cuestionario:    a.Questionnaire,
		CancelReason:    a.CancelReason,
		Origen:          origen,
		Servicio:        a.Service,
		Trabajador:      a.Worker,
		Notas:           a.Notes,
		Agente:          agents[a.AgentID],
		FechaEs:         citaFechaEs(d),
		CreadaEs:        citaFechaEs(a.CreatedAt.In(time.Local)),
	}
}

// AppointmentsPage — GET /appointments
func AppointmentsPage(c *gin.Context) {
	uid := invUserID(c)

	// Igual que GET /api/appointments: primero se traen las citas nuevas de
	// las hojas de Google de los agentes conectados.
	var gAgents []models.Agent
	if err := config.DB.Where("user_id = ? AND google_connected = ?", uid, true).Find(&gAgents).Error; err == nil && len(gAgents) > 0 {
		svc := &google.GoogleSheetsService{
			ClientID:     getGoogleClientID(),
			ClientSecret: getGoogleClientSecret(),
			RedirectURL:  getGoogleRedirectURL(),
		}
		syncAppointmentsFromSheets(context.Background(), svc, gAgents, uid)
	}

	agents := map[uint]string{}
	var all []models.Agent
	config.DB.Where("user_id = ?", uid).Select("id, name").Find(&all)
	for _, a := range all {
		agents[a.ID] = a.Name
	}

	var appts []models.Appointment
	dbErr := ""
	if err := config.DB.Where("user_id = ?", uid).Order("date DESC, id DESC").Find(&appts).Error; err != nil {
		log.Printf("citas.Page: %v", err)
		dbErr = "No se pudieron cargar las citas en este momento."
	}
	rows := make([]CitaRow, 0, len(appts))
	for i := range appts {
		rows = append(rows, citaRowOf(&appts[i], agents))
	}

	services, workers := citaCatalog(uid)
	sj, _ := json.Marshal(services)
	wj, _ := json.Marshal(workers)
	c.HTML(http.StatusOK, "appointments.html", gin.H{
		"Citas":        rows,
		"DBError":      dbErr,
		"Optica":       invIsOptica(uid),
		"BusinessName": invBusinessName(uid),
		"ServicesJSON": string(sj),
		"WorkersJSON":  string(wj),
		"Capacidad":    citaCapacity(uid),
	})
}

// citaCatalog — servicios (Inventario → servicios + Mi Negocio) y
// trabajadores de Mi Negocio, para sugerirlos al crear la cita.
func citaCatalog(uid uint) ([]string, []string) {
	seenS, seenW := map[string]bool{}, map[string]bool{}
	var services, workers []string
	add := func(list *[]string, seen map[string]bool, v string) {
		v = strings.TrimSpace(v)
		k := strings.ToLower(v)
		if v == "" || seen[k] {
			return
		}
		seen[k] = true
		*list = append(*list, v)
	}
	var branches []models.MyBusinessInfo
	config.DB.Where("user_id = ?", uid).Order("branch_number ASC").Find(&branches)
	for _, b := range branches {
		for _, s := range b.Services {
			add(&services, seenS, s.Title)
		}
		for _, w := range b.Workers {
			add(&workers, seenW, w.Name)
		}
	}
	if db, err := config.DB.DB(); err == nil {
		if rs, err := db.Query("SELECT descripcion FROM inv_articulos WHERE user_id = ? AND servicio = 1 ORDER BY descripcion LIMIT 200", uid); err == nil {
			for rs.Next() {
				var d string
				if rs.Scan(&d) == nil {
					add(&services, seenS, d)
				}
			}
			rs.Close()
		}
	}
	if services == nil {
		services = []string{}
	}
	if workers == nil {
		workers = []string{}
	}
	return services, workers
}

/* ---------------- horario ---------------- */

// citaCapacity: cuántas citas caben a la misma hora (una por trabajador;
// sin trabajadores dados de alta, una).
func citaCapacity(uid uint) int {
	var b models.MyBusinessInfo
	if err := config.DB.Select("workers").Where("user_id = ?", uid).Order("branch_number ASC").First(&b).Error; err == nil && len(b.Workers) > 1 {
		return len(b.Workers)
	}
	return 1
}

var citaHHMM = regexp.MustCompile(`^([01]\d|2[0-3]):[0-5]\d$`)

// citaHours: primera y última hora para agendar y los días que se abre
// (0 = domingo … 6 = sábado), del horario de Mi Negocio.
func citaHours(uid uint) (string, string, []int) {
	var b models.MyBusinessInfo
	open, close := "", ""
	days := []int{}
	if err := config.DB.Select("schedule").Where("user_id = ?", uid).Order("branch_number ASC").First(&b).Error; err == nil {
		s := b.Schedule
		week := []models.DaySchedule{s.Sunday, s.Monday, s.Tuesday, s.Wednesday, s.Thursday, s.Friday, s.Saturday}
		for i, d := range week {
			if !d.Open || !citaHHMM.MatchString(d.Start) || !citaHHMM.MatchString(d.End) || d.End <= d.Start {
				continue
			}
			days = append(days, i)
			if open == "" || d.Start < open {
				open = d.Start
			}
			if close == "" || d.End > close {
				close = d.End
			}
		}
	}
	if len(days) == 0 {
		return "09:00", "18:30", []int{1, 2, 3, 4, 5, 6}
	}
	// La última cita empieza media hora antes de cerrar.
	if t, err := time.Parse("15:04", close); err == nil {
		last := t.Add(-30 * time.Minute).Format("15:04")
		if last >= open {
			close = last
		}
	}
	return open, close, days
}

// CitasHours — GET /api/citas/horarios
func CitasHours(c *gin.Context) {
	uid := invUserID(c)
	open, close, days := citaHours(uid)
	c.JSON(http.StatusOK, gin.H{"open": open, "close": close, "days": days, "capacidad": citaCapacity(uid)})
}

// citaDayRange: inicio y fin del día "YYYY-MM-DD" en hora local.
func citaDayRange(day string) (time.Time, time.Time, error) {
	d, err := time.ParseInLocation("2006-01-02", day, time.Local)
	if err != nil {
		return d, d, err
	}
	return d, d.AddDate(0, 0, 1), nil
}

// citaSlotCounts: cuántas citas (no canceladas) hay a cada hora de ese día.
func citaSlotCounts(uid uint, day string, exceptID uint) (map[string]int, error) {
	from, to, err := citaDayRange(day)
	if err != nil {
		return nil, err
	}
	var list []models.Appointment
	q := config.DB.Select("id, date, status").
		Where("user_id = ? AND date >= ? AND date < ? AND status NOT IN ?", uid, from, to,
			[]string{string(models.AppointmentStatusCancelled), string(models.AppointmentStatusNoShow)})
	if exceptID > 0 {
		q = q.Where("id <> ?", exceptID)
	}
	if err := q.Find(&list).Error; err != nil {
		return nil, err
	}
	out := map[string]int{}
	for _, a := range list {
		out[a.Date.In(time.Local).Format("15:04")]++
	}
	return out, nil
}

// CitasOccupied — GET /api/citas/horarios/ocupadas?fecha=YYYY-MM-DD
func CitasOccupied(c *gin.Context) {
	uid := invUserID(c)
	counts, err := citaSlotCounts(uid, c.Query("fecha"), 0)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Fecha inválida."})
		return
	}
	capacity := citaCapacity(uid)
	out := []string{}
	for t, n := range counts {
		if n >= capacity {
			out = append(out, t)
		}
	}
	sort.Strings(out)
	c.JSON(http.StatusOK, gin.H{"ocupadas": out})
}

/* ---------------- crear / editar ---------------- */

var (
	citaCelularRe = regexp.MustCompile(`^\+(52|1)\d{10}$`)
	citaEmailRe   = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)
	citaBirthRe   = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
)

type citaInput struct {
	Date            string          `json:"date"`
	Time            string          `json:"time"`
	Nombre          string          `json:"nombre"`
	Apellido        string          `json:"apellido"`
	Celular         string          `json:"celular"`
	Correo          string          `json:"correo"`
	FechaNacimiento string          `json:"fecha_nacimiento"`
	Cuestionario    json.RawMessage `json:"cuestionario"`
	Servicio        string          `json:"servicio"`
	Trabajador      string          `json:"trabajador"`
	Notas           string          `json:"notas"`
	Status          string          `json:"status"`
	Tag             string          `json:"tag"`
}

// validate limpia y revisa lo que manda el panel; regresa la fecha y hora
// ya juntas (hora local).
func (in *citaInput) validate() (time.Time, string) {
	in.Nombre = strings.TrimSpace(in.Nombre)
	in.Apellido = strings.TrimSpace(in.Apellido)
	in.Correo = strings.TrimSpace(in.Correo)
	in.FechaNacimiento = strings.TrimSpace(in.FechaNacimiento)
	in.Servicio = strings.TrimSpace(in.Servicio)
	in.Trabajador = strings.TrimSpace(in.Trabajador)
	in.Notas = strings.TrimSpace(in.Notas)
	switch {
	case in.Nombre == "" || in.Apellido == "":
		return time.Time{}, "Completa nombre y apellido."
	case len(in.Nombre) > 120 || len(in.Apellido) > 120:
		return time.Time{}, "El nombre es demasiado largo."
	case !citaCelularRe.MatchString(in.Celular):
		return time.Time{}, "Número de celular inválido. Debe incluir la lada y 10 dígitos."
	case in.Correo != "" && !citaEmailRe.MatchString(in.Correo):
		return time.Time{}, "El correo no es válido."
	case in.FechaNacimiento != "" && !citaBirthRe.MatchString(in.FechaNacimiento):
		return time.Time{}, "Fecha de nacimiento inválida."
	case !citaHHMM.MatchString(in.Time):
		return time.Time{}, "Hora inválida."
	case len(in.Servicio) > 250 || len(in.Trabajador) > 250 || len(in.Notas) > 2000:
		return time.Time{}, "Algún dato es demasiado largo."
	}
	when, err := time.ParseInLocation("2006-01-02 15:04", in.Date+" "+in.Time, time.Local)
	if err != nil {
		return time.Time{}, "Fecha inválida."
	}
	return when, ""
}

// citaQuestionnaire: el JSON de "¿Cómo nos conoció?" listo para guardar
// ("" = sin respuestas).
func citaQuestionnaire(raw json.RawMessage) (string, string) {
	txt := strings.TrimSpace(string(raw))
	if txt == "" || txt == "null" || txt == "{}" {
		return "", ""
	}
	if len(txt) > 8<<10 {
		return "", "El cuestionario es demasiado largo."
	}
	var obj map[string]interface{}
	if err := json.Unmarshal([]byte(txt), &obj); err != nil {
		return "", "El cuestionario no es válido."
	}
	return txt, ""
}

func citaDayOpen(uid uint, when time.Time) bool {
	_, _, days := citaHours(uid)
	for _, d := range days {
		if int(when.Weekday()) == d {
			return true
		}
	}
	return false
}

func citaSlotFree(uid uint, when time.Time, exceptID uint) (bool, error) {
	counts, err := citaSlotCounts(uid, when.Format("2006-01-02"), exceptID)
	if err != nil {
		return false, err
	}
	return counts[when.Format("15:04")] < citaCapacity(uid), nil
}

func citaFail(c *gin.Context, where string, err error, msg string) {
	log.Printf("citas.%s: %v", where, err)
	c.JSON(http.StatusInternalServerError, gin.H{"error": msg})
}

// CitasCreate — POST /api/citas
func CitasCreate(c *gin.Context) {
	uid := invUserID(c)
	var in citaInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Completa día, hora, nombre, apellido y celular."})
		return
	}
	when, msg := in.validate()
	if msg == "" {
		in.Tag = strings.TrimSpace(in.Tag)
		if in.Tag != "" && !citaTags[in.Tag] {
			msg = "Esa etiqueta no existe."
		}
	}
	q, qmsg := citaQuestionnaire(in.Cuestionario)
	if msg == "" {
		msg = qmsg
	}
	if msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	// "Vino sin cita" se registra aunque ese día no se den citas.
	if in.Tag != "sin_cita" && !citaDayOpen(uid, when) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Ese día no se dan citas. Elige otro día."})
		return
	}
	free, err := citaSlotFree(uid, when, 0)
	if err != nil {
		citaFail(c, "Create", err, "No se pudo verificar el horario.")
		return
	}
	if !free {
		c.JSON(http.StatusConflict, gin.H{"error": "Esa hora ya está ocupada. Elige otra."})
		return
	}
	status := models.AppointmentStatusConfirmed
	if s, ok := citaStatusFromPanel[in.Status]; ok && in.Status != "" {
		status = s
	}
	a := models.Appointment{
		UserID:          uid,
		ClientFirstName: in.Nombre,
		ClientLastName:  in.Apellido,
		ClientPhone:     in.Celular,
		ClientEmail:     in.Correo,
		ClientBirthDate: in.FechaNacimiento,
		Questionnaire:   q,
		Service:         in.Servicio,
		Worker:          in.Trabajador,
		Notes:           in.Notas,
		Date:            when,
		Status:          status,
		Source:          models.AppointmentSourceManual,
		Tag:             in.Tag,
	}
	if err := config.DB.Create(&a).Error; err != nil {
		citaFail(c, "Create", err, "No se pudo crear la cita.")
		return
	}
	c.JSON(http.StatusCreated, gin.H{"message": "Cita creada.", "id": a.ID})
}

// citaGet — la cita del negocio (404 si no es suya o no existe).
func citaGet(c *gin.Context) (*models.Appointment, bool) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Cita inválida."})
		return nil, false
	}
	var a models.Appointment
	if err := config.DB.Where("id = ? AND user_id = ?", id, invUserID(c)).First(&a).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Esa cita ya no existe. Recarga la página."})
		} else {
			citaFail(c, "Get", err, "No se pudo leer la cita.")
		}
		return nil, false
	}
	return &a, true
}

// CitasUpdate — PUT /api/citas/:id (editar datos y/o reagendar)
func CitasUpdate(c *gin.Context) {
	a, ok := citaGet(c)
	if !ok {
		return
	}
	var in citaInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Completa día, hora, nombre, apellido y celular."})
		return
	}
	when, msg := in.validate()
	q, qmsg := citaQuestionnaire(in.Cuestionario)
	if msg == "" {
		msg = qmsg
	}
	if msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	updates := map[string]interface{}{
		"client_first_name": in.Nombre,
		"client_last_name":  in.Apellido,
		"client_phone":      in.Celular,
		"client_email":      in.Correo,
		"client_birth_date": in.FechaNacimiento,
		"questionnaire":     q,
		"service":           in.Servicio,
		"worker":            in.Trabajador,
		"notes":             in.Notas,
	}
	moved := !when.Equal(a.Date.In(time.Local))
	if moved {
		if when.Format("2006-01-02") != a.Date.In(time.Local).Format("2006-01-02") && !citaDayOpen(a.UserID, when) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Ese día no se dan citas. Elige otro día."})
			return
		}
		free, err := citaSlotFree(a.UserID, when, a.ID)
		if err != nil {
			citaFail(c, "Update", err, "No se pudo verificar el horario.")
			return
		}
		if !free {
			c.JSON(http.StatusConflict, gin.H{"error": "Esa hora ya está ocupada. Elige otra."})
			return
		}
		updates["date"] = when
		// Reagendada: si estaba cancelada o no llegó, vuelve a estar por atender.
		if a.Status == models.AppointmentStatusCancelled || a.Status == models.AppointmentStatusNoShow {
			updates["status"] = models.AppointmentStatusConfirmed
			updates["cancel_reason"] = ""
		}
	}
	if err := config.DB.Model(a).Updates(updates).Error; err != nil {
		citaFail(c, "Update", err, "No se pudo guardar la cita.")
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "reagendada": moved})
}

// CitasSetStatus — PATCH /api/citas/:id/estado {status, motivo?}
func CitasSetStatus(c *gin.Context) {
	a, ok := citaGet(c)
	if !ok {
		return
	}
	var body struct {
		Status string `json:"status"`
		Motivo string `json:"motivo"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Estado inválido."})
		return
	}
	st, valid := citaStatusFromPanel[body.Status]
	if !valid {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Estado inválido."})
		return
	}
	updates := map[string]interface{}{"status": st}
	if st == models.AppointmentStatusCancelled {
		m := strings.TrimSpace(body.Motivo)
		if len(m) > 500 {
			m = m[:500]
		}
		updates["cancel_reason"] = m
	}
	if err := config.DB.Model(a).Updates(updates).Error; err != nil {
		citaFail(c, "SetStatus", err, "No se pudo actualizar la cita.")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Cita actualizada."})
}

// CitasDelete — DELETE /api/citas/:id
func CitasDelete(c *gin.Context) {
	a, ok := citaGet(c)
	if !ok {
		return
	}
	if err := config.DB.Delete(a).Error; err != nil {
		citaFail(c, "Delete", err, "No se pudo eliminar la cita.")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Cita eliminada."})
}

/* ---------------- etiquetas ---------------- */

// CitasTags — GET /api/citas/etiquetas
func CitasTags(c *gin.Context) {
	var list []models.Appointment
	if err := config.DB.Select("id, tag, source").Where("user_id = ?", invUserID(c)).Find(&list).Error; err != nil {
		citaFail(c, "Tags", err, "No se pudieron cargar las etiquetas.")
		return
	}
	out := map[string]string{}
	for i := range list {
		if t := citaTagOf(&list[i]); t != "" {
			out[strconv.FormatUint(uint64(list[i].ID), 10)] = t
		}
	}
	c.JSON(http.StatusOK, gin.H{"tags": out})
}

// CitasSetTag — PUT /api/citas/:id/etiqueta {tag}
func CitasSetTag(c *gin.Context) {
	a, ok := citaGet(c)
	if !ok {
		return
	}
	var body struct {
		Tag string `json:"tag"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos inválidos."})
		return
	}
	if body.Tag == citaTagBot {
		body.Tag = ""
	}
	if body.Tag != "" && !citaTags[body.Tag] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Esa etiqueta no existe."})
		return
	}
	if err := config.DB.Model(a).Update("tag", body.Tag).Error; err != nil {
		citaFail(c, "SetTag", err, "No se pudo guardar la etiqueta.")
		return
	}
	a.Tag = body.Tag
	// Al quitarla, una cita del bot regresa a "bot".
	c.JSON(http.StatusOK, gin.H{"ok": true, "tag": citaTagOf(a)})
}

/* ---------------- seguimiento (ópticas) ---------------- */

type citaFollowup struct {
	Compro bool `json:"compro"`
	Meses  int  `json:"meses,omitempty"`
}

// CitasFollowups — GET /api/citas/seguimiento
func CitasFollowups(c *gin.Context) {
	var list []models.Appointment
	if err := config.DB.Select("id, bought, revision_months").
		Where("user_id = ? AND followup_set = ?", invUserID(c), true).Find(&list).Error; err != nil {
		citaFail(c, "Followups", err, "No se pudo cargar el seguimiento de las citas.")
		return
	}
	out := map[string]citaFollowup{}
	for _, a := range list {
		f := citaFollowup{Compro: a.Bought}
		if a.Bought {
			f.Meses = a.RevisionMonths
		}
		out[strconv.FormatUint(uint64(a.ID), 10)] = f
	}
	c.JSON(http.StatusOK, gin.H{"items": out})
}

// CitasSetFollowup — PUT /api/citas/:id/seguimiento {compro, meses}
// También marca la cita como "asistió".
func CitasSetFollowup(c *gin.Context) {
	a, ok := citaGet(c)
	if !ok {
		return
	}
	var body struct {
		Compro *bool `json:"compro"`
		Meses  int   `json:"meses"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.Compro == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Indica si compró o no compró."})
		return
	}
	meses := 0
	if *body.Compro {
		meses = body.Meses
		if meses == 0 {
			meses = 12
		}
		if meses != 3 && meses != 6 && meses != 12 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "La revisión solo puede ser a 3 meses, 6 meses o 1 año."})
			return
		}
	}
	if err := config.DB.Model(a).Updates(map[string]interface{}{
		"followup_set":    true,
		"bought":          *body.Compro,
		"revision_months": meses,
		"status":          models.AppointmentStatusCompleted,
	}).Error; err != nil {
		citaFail(c, "SetFollowup", err, "No se pudo guardar si compró.")
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "item": citaFollowup{Compro: *body.Compro, Meses: meses}})
}
