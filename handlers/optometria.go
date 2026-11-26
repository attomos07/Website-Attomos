package handlers

// optometria.go — Optometría (sidebar → Optometría, solo ópticas).
// Portado del panel del optometrista de Avante. Pestañas:
//
//	GET /optometria                       → /optometria/examen-vista
//	GET /optometria/examen-vista          Examen de la vista (citas de hoy, exámenes)
//	GET /optometria/historial-clinico     Historial clínico (por paciente)
//	GET /optometria/ordenes-lab           Orden de laboratorio (+ ventas por hacer orden)
//	GET /optometria/garantias             Garantía / reparación
//	GET /optometria/plantilla-examen      Plantilla de examen (editor visual)
//	GET /optometria/nuevo?doc=&edit=&examId=&pedido=   Llenar examen / orden / garantía
//
// API (/api/optometria):
//
//	GET    /plantillas · /plantillas/activa · /plantillas/laboratorio · /plantillas/garantia · /plantillas/:id
//	POST   /plantillas · PUT /plantillas/:id · POST /plantillas/:id/activar · DELETE /plantillas/:id
//	GET    /examenes[?lite=1|?paciente=] · /examenes/:id
//	POST   /examenes · PUT /examenes/:id · DELETE /examenes/:id
//	GET    /pacientes?q= · /pacientes/directorio · /pacientes/ficha?key=
//	PUT    /pacientes/antecedentes
//	GET    /ordenes-lab[?examId=&kind=] · /ordenes-lab/siguiente-folio · /ordenes-lab/:id
//	POST   /ordenes-lab · PUT /ordenes-lab/:id · DELETE /ordenes-lab/:id
//	GET    /garantias/resumen
//	GET    /ventas-pendientes · POST /ventas-pendientes/:id/sin-orden
//	GET    /citas-hoy

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"attomos/config"
	"attomos/models"

	"github.com/gin-gonic/gin"
)

/* ---------------- páginas ---------------- */

func optEnsureTemplates(uid uint) {
	b := posBusinessInfo(uid)
	dir := strings.TrimSpace(strings.Join(nonEmptyStr(b.Direccion, b.Ciudad), ", "))
	tel := ""
	if b.Telefono != "" {
		tel = "Tel. " + b.Telefono
	}
	models.EnsureOptTemplates(uid, models.OptBizInfo{Name: b.Nombre, Logo: b.Logo, Address: dir, Phone: tel})
}

func nonEmptyStr(v ...string) []string {
	out := []string{}
	for _, s := range v {
		if s = strings.TrimSpace(s); s != "" {
			out = append(out, s)
		}
	}
	return out
}

func optPage(tab string) gin.HandlerFunc {
	return func(c *gin.Context) {
		uid := invUserID(c)
		optEnsureTemplates(uid)
		c.HTML(http.StatusOK, "optometria.html", gin.H{
			"OptTab":    tab,
			"Optica":    invIsOptica(uid),
			"StaffName": posCashier(c),
		})
	}
}

var (
	OptExamPage      = optPage("examen-vista")
	OptHistorialPage = optPage("historial-clinico")
	OptOrdenesPage   = optPage("ordenes-lab")
	OptGarantiasPage = optPage("garantias")
	OptPlantillaPage = optPage("plantilla-examen")
)

// OptNuevoPage — GET /optometria/nuevo?doc=laboratorio|garantia
func OptNuevoPage(c *gin.Context) {
	uid := invUserID(c)
	optEnsureTemplates(uid)
	doc := c.Query("doc")
	if !models.IsOptDocKind(doc) {
		doc = ""
	}
	c.HTML(http.StatusOK, "optometria-nuevo.html", gin.H{
		"Doc":       doc,
		"Optica":    invIsOptica(uid),
		"StaffName": posCashier(c),
	})
}

// OptExamRedirect — GET /optometria/examen/:id → Examen de la vista con
// ese examen abierto en el modal (?ver=).
func OptExamRedirect(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		c.Redirect(http.StatusFound, "/optometria/examen-vista")
		return
	}
	q := "?ver=" + strconv.FormatInt(id, 10)
	if a := c.Query("action"); a == "pdf" || a == "print" {
		q += "&action=" + a
	}
	c.Redirect(http.StatusFound, "/optometria/examen-vista"+q)
}

/* ---------------- utilidades ---------------- */

func optID(c *gin.Context) (int64, bool) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Dato inválido."})
		return 0, false
	}
	return id, true
}

func optFail(c *gin.Context, where string, err error, msg string) {
	log.Printf("optometria.%s: %v", where, err)
	c.JSON(http.StatusInternalServerError, gin.H{"error": msg})
}

func optTrim(s string, n int) string {
	s = strings.TrimSpace(s)
	if r := []rune(s); len(r) > n {
		return string(r[:n])
	}
	return s
}

/* ---------------- plantillas ---------------- */

// OptListTemplates — GET /api/optometria/plantillas
func OptListTemplates(c *gin.Context) {
	uid := invUserID(c)
	optEnsureTemplates(uid)
	list, err := models.ListExamTemplates(uid)
	if err != nil {
		optFail(c, "ListTemplates", err, "No se pudieron cargar las plantillas.")
		return
	}
	c.JSON(http.StatusOK, list)
}

// OptActiveTemplate — GET /api/optometria/plantillas/activa
func OptActiveTemplate(c *gin.Context) {
	uid := invUserID(c)
	optEnsureTemplates(uid)
	t, err := models.GetActiveExamTemplate(uid)
	if errors.Is(err, models.ErrExamTemplateNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "No hay ninguna plantilla activa."})
		return
	}
	if err != nil {
		optFail(c, "ActiveTemplate", err, "No se pudo cargar la plantilla.")
		return
	}
	c.JSON(http.StatusOK, t)
}

func optKindTemplate(kind string) gin.HandlerFunc {
	return func(c *gin.Context) {
		uid := invUserID(c)
		optEnsureTemplates(uid)
		t, err := models.GetExamTemplateByKind(uid, kind)
		if errors.Is(err, models.ErrExamTemplateNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "No hay plantilla de ese tipo."})
			return
		}
		if err != nil {
			optFail(c, "KindTemplate", err, "No se pudo cargar la plantilla.")
			return
		}
		c.JSON(http.StatusOK, t)
	}
}

var (
	OptLabTemplate      = optKindTemplate(models.OptKindLab)
	OptGarantiaTemplate = optKindTemplate(models.OptKindGarantia)
)

// OptGetTemplate — GET /api/optometria/plantillas/:id
func OptGetTemplate(c *gin.Context) {
	id, ok := optID(c)
	if !ok {
		return
	}
	t, err := models.GetExamTemplate(invUserID(c), id)
	if errors.Is(err, models.ErrExamTemplateNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "Plantilla no encontrada."})
		return
	}
	if err != nil {
		optFail(c, "GetTemplate", err, "No se pudo cargar la plantilla.")
		return
	}
	c.JSON(http.StatusOK, t)
}

type optTemplateInput struct {
	Name     string          `json:"name"`
	CanvasW  int             `json:"canvasW"`
	CanvasH  int             `json:"canvasH"`
	Elements json.RawMessage `json:"elements"`
}

func (in *optTemplateInput) clean() string {
	in.Name = optTrim(in.Name, 120)
	if in.Name == "" {
		in.Name = "Formato de examen"
	}
	if in.CanvasW < 200 || in.CanvasW > 3000 {
		in.CanvasW = 816
	}
	if in.CanvasH < 200 || in.CanvasH > 5000 {
		in.CanvasH = 1056
	}
	var arr []json.RawMessage
	if len(in.Elements) == 0 || json.Unmarshal(in.Elements, &arr) != nil {
		return "Los elementos de la plantilla no son válidos."
	}
	return ""
}

// OptCreateTemplate — POST /api/optometria/plantillas
func OptCreateTemplate(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 12<<20)
	var in optTemplateInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos de la plantilla inválidos (¿imagen muy pesada?)."})
		return
	}
	if msg := in.clean(); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	t, err := models.CreateExamTemplate(invUserID(c), in.Name, in.CanvasW, in.CanvasH, in.Elements)
	if err != nil {
		optFail(c, "CreateTemplate", err, "No se pudo guardar la plantilla.")
		return
	}
	c.JSON(http.StatusCreated, t)
}

// OptUpdateTemplate — PUT /api/optometria/plantillas/:id
func OptUpdateTemplate(c *gin.Context) {
	id, ok := optID(c)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 12<<20)
	var in optTemplateInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos de la plantilla inválidos (¿imagen muy pesada?)."})
		return
	}
	if msg := in.clean(); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	uid := invUserID(c)
	if err := models.UpdateExamTemplate(uid, id, in.Name, in.CanvasW, in.CanvasH, in.Elements); err != nil {
		if errors.Is(err, models.ErrExamTemplateNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Esa plantilla ya no existe."})
			return
		}
		optFail(c, "UpdateTemplate", err, "No se pudo guardar la plantilla.")
		return
	}
	t, _ := models.GetExamTemplate(uid, id)
	c.JSON(http.StatusOK, t)
}

// OptActivateTemplate — POST /api/optometria/plantillas/:id/activar
func OptActivateTemplate(c *gin.Context) {
	id, ok := optID(c)
	if !ok {
		return
	}
	if err := models.SetActiveExamTemplate(invUserID(c), id); err != nil {
		if errors.Is(err, models.ErrExamTemplateNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Esa plantilla ya no existe."})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": "Solo se activan las plantillas de examen (no las de laboratorio ni garantía)."})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// OptDeleteTemplate — DELETE /api/optometria/plantillas/:id
func OptDeleteTemplate(c *gin.Context) {
	id, ok := optID(c)
	if !ok {
		return
	}
	if err := models.DeleteExamTemplate(invUserID(c), id); err != nil {
		if errors.Is(err, models.ErrExamTemplateNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Esa plantilla ya no existe."})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": "Esa es la única plantilla de su tipo: edítala en lugar de borrarla."})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

/* ---------------- exámenes ---------------- */

type optExamInput struct {
	TemplateID    int64           `json:"templateId"`
	PatientName   string          `json:"patientName"`
	PatientPhone  string          `json:"patientPhone"`
	Data          json.RawMessage `json:"data"`
	UserID        int64           `json:"userId"`        // cliente del Punto de venta (0 = sin ligar)
	AppointmentID int64           `json:"appointmentId"` // 0 = sin cita
	// SyncName: se corrigió el nombre y se aceptó el aviso de que también
	// cambia en Mis citas y en el Punto de venta.
	SyncName *struct {
		Nombre   string `json:"nombre"`
		Apellido string `json:"apellido"`
	} `json:"syncName"`
}

// optApplyNameSync pone el nombre corregido en la cita y en el cliente.
func optApplyNameSync(uid uint, apptID int64, in optExamInput) {
	if in.SyncName == nil || apptID <= 0 {
		return
	}
	citas, clientes, err := models.ApplyNameSync(uid, apptID, in.SyncName.Nombre, in.SyncName.Apellido)
	if err != nil {
		log.Printf("optometria: no se pudo pasar el nombre a la cita #%d: %v", apptID, err)
		return
	}
	if citas+clientes > 0 {
		LivePublish(uid, "citas", "pos")
	}
}

// OptPreviewNameSync — GET /api/optometria/cambio-nombre?citaId=&nombre=
// Para el aviso antes de guardar: si el nombre del examen es distinto al
// de la cita, qué se cambiaría en Mis citas y en el Punto de venta.
func OptPreviewNameSync(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Query("citaId"), 10, 64)
	if id <= 0 {
		c.JSON(http.StatusOK, models.NameSyncPreview{})
		return
	}
	p, err := models.PreviewNameSync(invUserID(c), id, c.Query("nombre"))
	if err != nil {
		optFail(c, "PreviewNameSync", err, "No se pudo revisar el nombre.")
		return
	}
	c.JSON(http.StatusOK, p)
}

func (in *optExamInput) clean() string {
	in.PatientName = optTrim(in.PatientName, 160)
	in.PatientPhone = optTrim(in.PatientPhone, 40)
	if in.PatientName == "" {
		return "Escribe el nombre del paciente."
	}
	if len(in.Data) == 0 || !json.Valid(in.Data) {
		return "Datos de examen inválidos."
	}
	return ""
}

// OptCreateExam — POST /api/optometria/examenes
func OptCreateExam(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20)
	var in optExamInput
	if err := c.ShouldBindJSON(&in); err != nil || in.TemplateID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos de examen inválidos."})
		return
	}
	if msg := in.clean(); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	uid := invUserID(c)
	if _, err := models.GetExamTemplate(uid, in.TemplateID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Esa plantilla ya no existe."})
		return
	}
	e, err := models.CreateEyeExam(uid, in.TemplateID, in.PatientName, in.PatientPhone, in.Data, posCashier(c), in.UserID, in.AppointmentID)
	if err != nil {
		optFail(c, "CreateExam", err, "No se pudo guardar el examen.")
		return
	}
	optApplyNameSync(uid, in.AppointmentID, in)
	// La cita de la que salió queda como "asistió".
	models.MarkAppointmentAttended(uid, in.AppointmentID)
	c.JSON(http.StatusCreated, e)
}

// OptUpdateExam — PUT /api/optometria/examenes/:id
func OptUpdateExam(c *gin.Context) {
	id, ok := optID(c)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20)
	var in optExamInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos de examen inválidos."})
		return
	}
	if msg := in.clean(); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	uid := invUserID(c)
	if _, err := models.GetEyeExam(uid, id); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Ese examen ya no existe."})
		return
	}
	e, err := models.UpdateEyeExam(uid, id, in.PatientName, in.PatientPhone, in.Data, in.UserID, posCashier(c))
	if err != nil {
		optFail(c, "UpdateExam", err, "No se pudieron guardar los cambios.")
		return
	}
	// La cita es la del examen guardado (no la que mande el navegador).
	optApplyNameSync(uid, e.AppointmentID, in)
	c.JSON(http.StatusOK, e)
}

// OptListExams — GET /api/optometria/examenes[?lite=1|?paciente=]
func OptListExams(c *gin.Context) {
	uid := invUserID(c)
	c.Header("Cache-Control", "no-store")
	if c.Query("lite") == "1" {
		list, err := models.ListEyeExamsLite(uid)
		if err != nil {
			optFail(c, "ListExamsLite", err, "No se pudieron cargar los exámenes.")
			return
		}
		c.JSON(http.StatusOK, list)
		return
	}
	list, err := models.ListEyeExams(uid, c.Query("paciente"))
	if err != nil {
		optFail(c, "ListExams", err, "No se pudieron cargar los exámenes.")
		return
	}
	c.JSON(http.StatusOK, list)
}

// OptGetExam — GET /api/optometria/examenes/:id
func OptGetExam(c *gin.Context) {
	id, ok := optID(c)
	if !ok {
		return
	}
	uid := invUserID(c)
	e, err := models.GetEyeExam(uid, id)
	if errors.Is(err, models.ErrEyeExamNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "Examen no encontrado."})
		return
	}
	if err != nil {
		optFail(c, "GetExam", err, "No se pudo cargar el examen.")
		return
	}
	one := []models.EyeExam{*e}
	models.AttachNextVisits(uid, one)
	c.JSON(http.StatusOK, one[0])
}

// OptDeleteExam — DELETE /api/optometria/examenes/:id
func OptDeleteExam(c *gin.Context) {
	id, ok := optID(c)
	if !ok {
		return
	}
	if err := models.DeleteEyeExam(invUserID(c), id); err != nil {
		if errors.Is(err, models.ErrEyeExamNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Examen no encontrado."})
			return
		}
		optFail(c, "DeleteExam", err, "No se pudo eliminar el examen.")
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

/* ---------------- pacientes ---------------- */

// OptSearchPatients — GET /api/optometria/pacientes?q=
func OptSearchPatients(c *gin.Context) {
	list, err := models.SearchPatients(invUserID(c), c.Query("q"))
	if err != nil {
		optFail(c, "SearchPatients", err, "No se pudo buscar al paciente.")
		return
	}
	c.JSON(http.StatusOK, list)
}

// OptPatientDirectory — GET /api/optometria/pacientes/directorio
func OptPatientDirectory(c *gin.Context) {
	list, err := models.ListPatientSummaries(invUserID(c))
	if err != nil {
		optFail(c, "PatientDirectory", err, "No se pudo cargar el directorio de pacientes.")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, list)
}

// OptPatientFile — GET /api/optometria/pacientes/ficha?key=u:12 | n:juan perez
func OptPatientFile(c *gin.Context) {
	uid := invUserID(c)
	key := strings.TrimSpace(c.Query("key"))
	if !models.ValidPatientKey(key) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Paciente inválido."})
		return
	}
	p, exams, err := models.GetPatientFile(uid, key)
	if errors.Is(err, models.ErrPatientNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "No se encontró al paciente."})
		return
	}
	if err != nil {
		optFail(c, "PatientFile", err, "No se pudo cargar la ficha.")
		return
	}
	models.AttachNextVisits(uid, exams)
	if len(exams) > 0 && exams[0].ProximaCita != nil {
		if t, err := time.ParseInLocation("2006-01-02", exams[0].ProximaCita.Fecha, time.Local); err == nil {
			p.RevisionMeses = exams[0].ProximaCita.Meses
			p.NextRevision = t.Add(12 * time.Hour)
		}
	}
	templates := map[string]*models.ExamTemplate{}
	addTpl := func(id int64) {
		k := strconv.FormatInt(id, 10)
		if _, done := templates[k]; done {
			return
		}
		t, err := models.GetExamTemplate(uid, id)
		if err != nil {
			templates[k] = nil
			return
		}
		templates[k] = t
	}
	examIDs := make([]int64, 0, len(exams))
	for _, e := range exams {
		addTpl(e.TemplateID)
		examIDs = append(examIDs, e.ID)
	}
	ante := models.GetPatientAntecedentes(uid, key, "n:"+models.NormalizePatientName(p.Name))
	sheets, err := models.ListSheetsForPatient(uid, p.UserID, p.Name, examIDs)
	if err != nil {
		log.Printf("optometria.PatientFile hojas: %v", err)
		sheets = []models.LabOrderSheet{}
	}
	for _, s := range sheets {
		addTpl(s.TemplateID)
	}
	c.JSON(http.StatusOK, gin.H{"patient": p, "exams": exams, "templates": templates, "antecedentes": ante, "sheets": sheets})
}

// OptSaveAntecedentes — PUT /api/optometria/pacientes/antecedentes
func OptSaveAntecedentes(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
	var in struct {
		Key  string          `json:"key"`
		Name string          `json:"name"`
		Data json.RawMessage `json:"data"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || !models.ValidPatientKey(in.Key) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos inválidos."})
		return
	}
	var obj map[string]interface{}
	if len(in.Data) == 0 || json.Unmarshal(in.Data, &obj) != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Antecedentes inválidos."})
		return
	}
	by := posCashier(c)
	if err := models.SetPatientAntecedentes(invUserID(c), in.Key, optTrim(in.Name, 190), in.Data, by); err != nil {
		optFail(c, "SaveAntecedentes", err, "No se pudieron guardar los antecedentes.")
		return
	}
	now := time.Now()
	c.JSON(http.StatusOK, models.PatientAntecedentes{Data: in.Data, UpdatedBy: by, UpdatedAt: &now})
}

/* ---------------- orden de laboratorio y garantía ---------------- */

type optSheetInput struct {
	Kind         string          `json:"kind"`
	ExamID       int64           `json:"examId"`
	TemplateID   int64           `json:"templateId"`
	PatientName  string          `json:"patientName"`
	PatientPhone string          `json:"patientPhone"`
	UserID       int64           `json:"userId"`
	Data         json.RawMessage `json:"data"`
	// Desde una venta del Punto de venta: el trabajo (pedido) al que se liga.
	PedidoID int64 `json:"pedidoId"`
}

// OptCreateSheet — POST /api/optometria/ordenes-lab
func OptCreateSheet(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20)
	var in optSheetInput
	if err := c.ShouldBindJSON(&in); err != nil || in.TemplateID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos de la hoja inválidos."})
		return
	}
	if in.Kind == "" {
		in.Kind = models.OptKindLab
	}
	if !models.IsOptDocKind(in.Kind) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Tipo de hoja inválido."})
		return
	}
	if len(in.Data) > 0 && !json.Valid(in.Data) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos de la hoja inválidos."})
		return
	}
	uid := invUserID(c)
	if _, err := models.GetExamTemplate(uid, in.TemplateID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Esa plantilla ya no existe."})
		return
	}
	by := posCashier(c)
	s, err := models.CreateLabSheet(uid, in.Kind, in.ExamID, in.TemplateID, optTrim(in.PatientName, 160), optTrim(in.PatientPhone, 40), in.UserID, in.Data, by)
	if err != nil {
		optFail(c, "CreateSheet", err, "No se pudo guardar la hoja.")
		return
	}
	if in.Kind == models.OptKindLab {
		linked := false
		if in.PedidoID > 0 {
			if err := models.LinkSaleOrderToSheet(uid, in.PedidoID, s.ID); err == nil {
				linked = true
			} else {
				log.Printf("optometria.CreateSheet: ligar al pedido %d: %v", in.PedidoID, err)
			}
		}
		// Sin venta: la orden le llega igual al laboratorio como trabajo propio.
		if !linked {
			if err := models.CreateDirectLabJob(uid, s, by); err != nil {
				log.Printf("optometria.CreateSheet: trabajo sin venta: %v", err)
			}
		}
	}
	c.JSON(http.StatusCreated, s)
}

// OptUpdateSheet — PUT /api/optometria/ordenes-lab/:id
func OptUpdateSheet(c *gin.Context) {
	id, ok := optID(c)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20)
	var in optSheetInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos de la hoja inválidos."})
		return
	}
	if len(in.Data) > 0 && !json.Valid(in.Data) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos de la hoja inválidos."})
		return
	}
	uid := invUserID(c)
	s, err := models.UpdateLabSheet(uid, id, optTrim(in.PatientName, 160), optTrim(in.PatientPhone, 40), in.UserID, in.Data, posCashier(c))
	if err != nil {
		if errors.Is(err, models.ErrLabSheetNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Esa hoja ya no existe."})
			return
		}
		optFail(c, "UpdateSheet", err, "No se pudieron guardar los cambios.")
		return
	}
	if s.Kind == models.OptKindLab {
		models.SyncDirectLabJob(uid, s.ID, s.PatientName, s.PatientPhone)
	}
	c.JSON(http.StatusOK, s)
}

// OptListSheets — GET /api/optometria/ordenes-lab[?examId=&kind=]
func OptListSheets(c *gin.Context) {
	examID, _ := strconv.ParseInt(c.Query("examId"), 10, 64)
	kind := c.Query("kind")
	if !models.IsOptDocKind(kind) {
		kind = ""
	}
	list, err := models.ListLabSheets(invUserID(c), examID, kind)
	if err != nil {
		optFail(c, "ListSheets", err, "No se pudieron cargar las hojas.")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, list)
}

// OptGetSheet — GET /api/optometria/ordenes-lab/:id
func OptGetSheet(c *gin.Context) {
	id, ok := optID(c)
	if !ok {
		return
	}
	s, err := models.GetLabSheet(invUserID(c), id)
	if errors.Is(err, models.ErrLabSheetNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "Esa hoja ya no existe."})
		return
	}
	if err != nil {
		optFail(c, "GetSheet", err, "No se pudo cargar la hoja.")
		return
	}
	c.JSON(http.StatusOK, s)
}

// OptDeleteSheet — DELETE /api/optometria/ordenes-lab/:id
func OptDeleteSheet(c *gin.Context) {
	id, ok := optID(c)
	if !ok {
		return
	}
	if err := models.DeleteLabSheet(invUserID(c), id); err != nil {
		if errors.Is(err, models.ErrLabSheetNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Esa hoja ya no existe."})
			return
		}
		optFail(c, "DeleteSheet", err, "No se pudo eliminar.")
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// OptNextFolio — GET /api/optometria/ordenes-lab/siguiente-folio
func OptNextFolio(c *gin.Context) {
	n, err := models.NextLabFolio(invUserID(c))
	if err != nil {
		optFail(c, "NextFolio", err, "No se pudo calcular el número.")
		return
	}
	c.JSON(http.StatusOK, gin.H{"folio": n})
}

// OptGarantiasResumen — GET /api/optometria/garantias/resumen (mes en curso)
func OptGarantiasResumen(c *gin.Context) {
	now := time.Now().In(posLocation())
	from := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	r, err := models.GetGarantiasResumen(invUserID(c), from, from.AddDate(0, 1, 0))
	if err != nil {
		optFail(c, "GarantiasResumen", err, "No se pudieron calcular las garantías.")
		return
	}
	c.JSON(http.StatusOK, gin.H{"mes": from.Format("2006-01"), "total": r.Total, "reparaciones": r.Reparaciones, "porOptometrista": r.PorOptometrista})
}

func posLocation() *time.Location {
	if l, err := time.LoadLocation("America/Hermosillo"); err == nil {
		return l
	}
	return time.FixedZone("MST", -7*3600)
}

/* ---------------- ventas por hacer orden ---------------- */

// OptVentasPendientes — GET /api/optometria/ventas-pendientes
func OptVentasPendientes(c *gin.Context) {
	uid := invUserID(c)
	list, err := models.ListVentasPendientesOrden(uid)
	if err != nil {
		optFail(c, "VentasPendientes", err, "No se pudieron cargar las ventas.")
		return
	}
	for i := range list {
		list[i].TicketPath = TicketPublicPath(uid, list[i].Folio)
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"ventas": list})
}

// OptVentaSinOrden — POST /api/optometria/ventas-pendientes/:id/sin-orden
func OptVentaSinOrden(c *gin.Context) {
	id, ok := optID(c)
	if !ok {
		return
	}
	if err := models.MarkPedidoSinHoja(invUserID(c), id); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Esa venta ya no está pendiente."})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

/* ---------------- citas de hoy ---------------- */

type optCitaHoy struct {
	ID       uint   `json:"id"`
	Nombre   string `json:"nombre"`
	Apellido string `json:"apellido"`
	Celular  string `json:"celular"`
	Date     string `json:"date"`
	Time     string `json:"time"`
	Status   string `json:"status"`
	Servicio string `json:"servicio"`
}

// OptCitasHoy — GET /api/optometria/citas-hoy: las citas de hoy (Mis citas).
func OptCitasHoy(c *gin.Context) {
	uid := invUserID(c)
	loc := posLocation()
	now := time.Now().In(loc)
	from := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	var list []models.Appointment
	if err := config.DB.Where("user_id = ? AND date >= ? AND date < ? AND status <> ?", uid, from, from.AddDate(0, 0, 1), models.AppointmentStatusCancelled).
		Order("date ASC").Find(&list).Error; err != nil {
		optFail(c, "CitasHoy", err, "No se pudieron cargar las citas.")
		return
	}
	out := make([]optCitaHoy, 0, len(list))
	for _, a := range list {
		d := a.Date.In(loc)
		out = append(out, optCitaHoy{ID: a.ID, Nombre: a.ClientFirstName, Apellido: a.ClientLastName, Celular: a.ClientPhone,
			Date: d.Format("2006-01-02"), Time: d.Format("15:04"), Status: citaPanelStatus(a.Status), Servicio: a.Service})
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"citas": out})
}

/* ---------------- laboratorio: la orden de cada trabajo ---------------- */

// LabGetHoja — GET /api/laboratorio/hojas/:id
func LabGetHoja(c *gin.Context) {
	id, ok := optID(c)
	if !ok {
		return
	}
	h, t, err := models.GetLabHojaFull(invUserID(c), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Esa orden de laboratorio ya no existe."})
		return
	}
	c.JSON(http.StatusOK, gin.H{"hoja": h, "plantilla": t})
}

// LabSearchHojas — GET /api/laboratorio/hojas?q=
func LabSearchHojas(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"hojas": models.SearchLabHojas(invUserID(c), c.Query("q"), 40)})
}

// LabLinkHoja — PUT /api/laboratorio/pedidos/:id/hoja {sheetId} (0 = automática)
func LabLinkHoja(c *gin.Context) {
	id, ok := labID(c)
	if !ok {
		return
	}
	var in struct {
		SheetID int64 `json:"sheetId"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos inválidos."})
		return
	}
	err := models.SetOrderLabHoja(invUserID(c), id, in.SheetID)
	switch {
	case errors.Is(err, models.ErrLabSheetNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "Esa orden de laboratorio ya no existe."})
	case err != nil:
		labFail(c, "LinkHoja", err, "No se pudo ligar la orden.")
	default:
		c.JSON(http.StatusOK, gin.H{"ok": true})
	}
}
