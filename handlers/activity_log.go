package handlers

// activity_log.go — Bitácora del equipo. Cada cambio (POST/PUT/PATCH/
// DELETE) en Recepción, Caja, Laboratorio, Optometría, Citas, Inventario y
// Usuarios queda guardado con quién lo hizo (el dueño o la cuenta del
// equipo), qué hizo en español y si salió bien. También inicios y cierres
// de sesión del equipo y contraseñas equivocadas.
//
//	GET /bitacora                  página (solo el dueño)
//	GET /api/bitacora              registros (filtros, "Cargar más", en vivo)
//	GET /api/bitacora/personas     resumen por persona
//
// ActivityTracker("area") va en cada grupo de rutas de main.go.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"attomos/config"
	"attomos/models"

	"github.com/gin-gonic/gin"
)

// ActivityRetentionDays — lo más viejo se borra solo (una vez al día).
const ActivityRetentionDays = 365

var activityAreaLabels = map[string]string{
	"pos": "Recepción", "caja": "Caja", "lab": "Laboratorio", "optometria": "Optometría",
	"citas": "Citas", "inventario": "Inventario", "equipo": "Usuarios", "sesion": "Sesión",
}

// activityActor — quién está haciendo la petición.
func activityActor(c *gin.Context) (owner uint, staffID uint, name, roles string) {
	owner = invUserID(c)
	if s := currentStaff(c); s != nil {
		return owner, s.ID, s.Name, strings.Join(s.RoleList(), ",")
	}
	return owner, 0, activityOwnerName(owner), "dueno"
}

func activityOwnerName(owner uint) string {
	var u models.User
	if err := config.DB.Select("id, company").First(&u, owner).Error; err == nil && strings.TrimSpace(u.Company) != "" {
		return "Dueño (" + strings.TrimSpace(u.Company) + ")"
	}
	return "Dueño"
}

func saveActivity(a models.ActivityLog) {
	go func() {
		if err := models.InsertActivity(&a); err != nil {
			log.Printf("bitacora: no se pudo guardar: %v", err)
			return
		}
		LivePublish(a.OwnerID, "bitacora") // la página Bitácora abierta lo muestra al momento
	}()
}

/* ---------------- sesión del equipo ---------------- */

// LogStaffSession — "Inició sesión", "Cerró sesión" o contraseña equivocada.
func LogStaffSession(c *gin.Context, s *models.StaffUser, action, desc string, ok bool) {
	if s == nil {
		return
	}
	saveActivity(models.ActivityLog{
		OwnerID: s.OwnerID, StaffID: s.ID, ActorName: s.Name, ActorRoles: strings.Join(s.RoleList(), ","),
		Kind: models.ActivitySession, Area: "sesion", Action: action, Description: desc, OK: ok,
		Method: c.Request.Method, Path: c.Request.URL.Path, Status: c.Writer.Status(), IP: c.ClientIP(),
	})
}

/* ---------------- middleware ---------------- */

type actBodyWriter struct {
	gin.ResponseWriter
	buf *bytes.Buffer
}

func (w actBodyWriter) Write(b []byte) (int, error) {
	if w.buf.Len() < 64<<10 {
		w.buf.Write(b)
	}
	return w.ResponseWriter.Write(b)
}

// ActivityTracker — guarda en la bitácora los cambios de ese grupo.
func ActivityTracker(area string) gin.HandlerFunc {
	return func(c *gin.Context) {
		m := c.Request.Method
		if m == http.MethodGet || m == http.MethodHead || m == http.MethodOptions {
			c.Next()
			return
		}
		var body []byte
		if c.Request.Body != nil && strings.Contains(c.GetHeader("Content-Type"), "json") {
			body, _ = io.ReadAll(io.LimitReader(c.Request.Body, 64<<10))
			c.Request.Body = io.NopCloser(io.MultiReader(bytes.NewReader(body), c.Request.Body))
		}
		owner, staffID, name, roles := activityActor(c)
		if owner == 0 {
			c.Next()
			return
		}
		route := c.FullPath()
		before := activityBefore(owner, route, c.Param("id"))

		w := actBodyWriter{ResponseWriter: c.Writer, buf: &bytes.Buffer{}}
		c.Writer = w
		c.Next()

		status := c.Writer.Status()
		if status == http.StatusUnauthorized {
			return
		}
		var in, out map[string]interface{}
		_ = json.Unmarshal(body, &in)
		_ = json.Unmarshal(w.buf.Bytes(), &out)
		action, done, try := activityDescribe(m, route, c, in, out, before)
		if action == "" {
			return
		}
		a := models.ActivityLog{
			OwnerID: owner, StaffID: staffID, ActorName: name, ActorRoles: roles,
			Kind: models.ActivityAction, Area: area, Action: action, Description: done, OK: status < 400,
			Method: m, Path: c.Request.URL.Path, Status: status, IP: c.ClientIP(),
		}
		if status >= 400 {
			why := actStr(out, "error")
			if why == "" {
				why = http.StatusText(status)
			}
			a.Description = "Intentó " + try + ", pero no se pudo: " + strings.TrimSuffix(why, ".")
		}
		saveActivity(a)
	}
}

/* ---------------- "antes": de quién era ---------------- */

// activityBefore — el nombre de lo que se va a cambiar o borrar, leído
// antes de que el handler lo modifique.
func activityBefore(owner uint, route, rawID string) string {
	id, _ := strconv.ParseInt(rawID, 10, 64)
	if id <= 0 {
		return ""
	}
	switch {
	case strings.HasPrefix(route, "/api/citas/:id"), strings.HasPrefix(route, "/api/appointments/:id"):
		var a models.Appointment
		if config.DB.Select("id, client_first_name, client_last_name, date").Where("id = ? AND user_id = ?", id, owner).First(&a).Error == nil {
			return fmt.Sprintf("la cita de %s (%s)", strings.TrimSpace(a.ClientFirstName+" "+a.ClientLastName), actFecha(a.Date))
		}
		return fmt.Sprintf("la cita #%d", id)
	case strings.HasPrefix(route, "/api/laboratorio/pedidos/:id"):
		var o models.Order
		if config.DB.Select("id, client_name, tracking_code").Where("id = ? AND user_id = ?", id, owner).First(&o).Error == nil {
			s := "el trabajo"
			if o.TrackingCode != "" {
				s += " " + o.TrackingCode
			}
			if o.ClientName != "" {
				s += " de " + o.ClientName
			}
			return s
		}
		return fmt.Sprintf("el trabajo #%d", id)
	case strings.HasPrefix(route, "/api/inventario/articulos/:id"):
		if it, err := models.GetInvItem(owner, id); err == nil {
			return "el artículo «" + it.Descripcion + "»"
		}
		return fmt.Sprintf("el artículo #%d", id)
	case strings.HasPrefix(route, "/api/optometria/examenes/:id"):
		if e, err := models.GetEyeExam(owner, id); err == nil {
			return "el examen de " + actOr(e.PatientName, "un paciente")
		}
		return fmt.Sprintf("el examen #%d", id)
	case strings.HasPrefix(route, "/api/optometria/ordenes-lab/:id"):
		if s, err := models.GetLabSheet(owner, id); err == nil {
			return "la orden de laboratorio de " + actOr(s.PatientName, "un paciente")
		}
		return fmt.Sprintf("la orden de laboratorio #%d", id)
	case strings.HasPrefix(route, "/api/pos/ventas/:id"):
		if v, err := models.GetPosSale(owner, id); err == nil && v.Cliente != "" {
			return fmt.Sprintf("la venta folio %d de %s", id, v.Cliente)
		}
		return fmt.Sprintf("la venta folio %d", id)
	case strings.HasPrefix(route, "/api/equipo/:id"):
		if s, err := models.GetStaff(owner, uint(id)); err == nil {
			return "la cuenta de " + s.Name + " (@" + s.Username + ")"
		}
		return fmt.Sprintf("la cuenta #%d", id)
	}
	return ""
}

/* ---------------- descripciones ---------------- */

var actMeses = []string{"enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"}

func actFecha(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	t = t.In(time.Local)
	return fmt.Sprintf("%d de %s, %s", t.Day(), actMeses[t.Month()-1], t.Format("15:04"))
}

func actStr(m map[string]interface{}, key string) string {
	if m == nil {
		return ""
	}
	if v, ok := m[key]; ok && v != nil {
		switch x := v.(type) {
		case float64:
			return strconv.FormatFloat(x, 'f', -1, 64)
		case string:
			return strings.TrimSpace(x)
		}
	}
	return ""
}

func actSub(m map[string]interface{}, key string) map[string]interface{} {
	if m == nil {
		return nil
	}
	if v, ok := m[key].(map[string]interface{}); ok {
		return v
	}
	return nil
}

func actOr(s, def string) string {
	if strings.TrimSpace(s) == "" {
		return def
	}
	return s
}

func actMoney(s string) string {
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return ""
	}
	return "$" + strconv.FormatFloat(f, 'f', 2, 64)
}

func actCitaStatus(s string) string {
	switch s {
	case "pendiente":
		return "Pendiente"
	case "verificada", "confirmada":
		return "Confirmada"
	case "cancelada":
		return "Cancelada"
	case "asistio":
		return "Asistió"
	case "no_asistio":
		return "No asistió"
	}
	return s
}

func actNombre(in map[string]interface{}) string {
	return strings.TrimSpace(actStr(in, "nombre") + " " + actStr(in, "apellido"))
}

// activityDescribe — (clave, "Hizo…", "hacer…"). Clave vacía = no se guarda.
func activityDescribe(m, route string, c *gin.Context, in, out map[string]interface{}, before string) (string, string, string) {
	b := actOr(before, "un registro")
	key := m + " " + strings.TrimPrefix(route, "/api")
	switch key {
	/* ----- Recepción (Punto de venta) ----- */
	case "POST /pos/ventas":
		v := actSub(out, "venta")
		desc := "una venta"
		if f := actStr(v, "folio"); f != "" {
			desc = "la venta folio " + f
		}
		if cl := actStr(v, "cliente"); cl != "" {
			desc += " a " + cl
		}
		if t := actMoney(actStr(v, "total")); t != "" {
			desc += " por " + t
		}
		return "venta.crear", "Registró " + desc, "registrar una venta"
	case "POST /pos/ventas/:id/cancelar":
		d := "Canceló " + b
		if mo := actStr(in, "motivo"); mo != "" {
			d += " (motivo: " + mo + ")"
		}
		return "venta.cancelar", d, "cancelar " + b
	case "POST /pos/ventas/:id/pedido":
		return "venta.pedido", "Mandó al laboratorio " + b, "mandar al laboratorio " + b
	case "PUT /pos/ventas/:id/pedido/estado":
		return "venta.pedido_estado", "Cambió el estado del pedido de " + b, "cambiar el pedido de " + b
	case "POST /pos/creditos/:id/abonos":
		d := "Registró un abono"
		if mo := actMoney(actStr(in, "monto")); mo != "" {
			d += " de " + mo
		}
		return "abono.crear", d + " al crédito folio " + c.Param("id"), "registrar un abono"
	case "DELETE /pos/abonos/:id":
		return "abono.cancelar", "Canceló el abono #" + c.Param("id"), "cancelar el abono #" + c.Param("id")
	case "POST /pos/clientes":
		return "cliente.crear", "Dio de alta al cliente " + actOr(actStr(in, "nombre"), ""), "dar de alta un cliente"
	case "PUT /pos/clientes/:id":
		return "cliente.editar", "Editó los datos del cliente " + actOr(actStr(in, "nombre"), "#"+c.Param("id")), "editar un cliente"
	case "PUT /pos/ticket-plantilla":
		return "ticket.plantilla", "Cambió el diseño del ticket", "cambiar el diseño del ticket"

	/* ----- Caja ----- */
	case "POST /caja/cortes":
		return "caja.corte", "Hizo el corte de caja", "hacer el corte de caja"
	case "POST /caja/cortes/:id/email":
		return "caja.corte_email", "Envió por correo el corte #" + c.Param("id"), "enviar el corte por correo"
	case "POST /caja/propinas":
		return "caja.propinas", "Guardó las propinas", "guardar las propinas"
	case "POST /caja/movimientos":
		mv := actSub(out, "movimiento")
		tipo := actOr(actStr(mv, "tipo"), actStr(in, "tipo"))
		con := actOr(actStr(mv, "concepto_txt"), actStr(in, "concepto"))
		d := "Registró un movimiento de caja"
		if tipo != "" {
			d = "Registró un " + tipo + " en caja"
		}
		if con != "" {
			d += " (" + con + ")"
		}
		if mo := actMoney(actOr(actStr(mv, "monto"), actStr(in, "monto"))); mo != "" {
			d += " por " + mo
		}
		return "caja.movimiento", d, "registrar un movimiento de caja"
	case "POST /caja/movimientos/:id/cancelar":
		return "caja.movimiento_cancelar", "Canceló el movimiento de caja #" + c.Param("id"), "cancelar un movimiento de caja"
	case "PUT /caja/config":
		return "caja.config", "Cambió la configuración de la caja", "cambiar la configuración de la caja"

	/* ----- Laboratorio ----- */
	case "PATCH /laboratorio/pedidos/:id/estado":
		st := actStr(in, "status")
		paso := models.LabStepLabel(st)
		if paso == "" {
			paso = st
		}
		return "lab.paso", "Movió " + b + " a «" + paso + "»", "mover " + b + " a «" + paso + "»"
	case "PUT /laboratorio/pedidos/:id/notas":
		return "lab.notas", "Escribió notas en " + b, "escribir notas en " + b
	case "PUT /laboratorio/pedidos/:id/externo":
		if in != nil && in["externo"] == false {
			return "lab.externo", "Regresó " + b + " al laboratorio propio", "cambiar el laboratorio de " + b
		}
		return "lab.externo", "Mandó " + b + " a laboratorio externo", "cambiar el laboratorio de " + b
	case "PUT /laboratorio/pedidos/:id/entrega":
		return "lab.entrega", "Cambió la fecha de entrega de " + b, "cambiar la fecha de entrega de " + b
	case "PUT /laboratorio/pedidos/:id/express":
		if in != nil && in["express"] == false {
			return "lab.express", "Quitó el express a " + b, "quitar el express a " + b
		}
		return "lab.express", "Marcó como express " + b, "marcar como express " + b
	case "PUT /laboratorio/pedidos/:id/hoja":
		return "lab.hoja", "Ligó la hoja de laboratorio a " + b, "ligar la hoja a " + b
	case "POST /laboratorio/limpiar":
		return "lab.limpiar", "Limpió una columna del tablero del laboratorio", "limpiar una columna del laboratorio"
	case "POST /laboratorio/escanear":
		return "lab.escanear", "Escaneó un trabajo en el laboratorio", "escanear un trabajo"

	/* ----- Optometría ----- */
	case "POST /optometria/examenes":
		return "examen.crear", "Guardó un examen de la vista de " + actOr(actStr(in, "patientName"), "un paciente"), "guardar un examen"
	case "PUT /optometria/examenes/:id":
		return "examen.editar", "Editó " + b, "editar " + b
	case "DELETE /optometria/examenes/:id":
		return "examen.eliminar", "Eliminó " + b, "eliminar " + b
	case "PUT /optometria/pacientes/antecedentes":
		return "paciente.antecedentes", "Actualizó los antecedentes de " + actOr(actStr(in, "patientName"), "un paciente"), "actualizar antecedentes"
	case "POST /optometria/ordenes-lab":
		return "orden.crear", "Hizo una orden de laboratorio para " + actOr(actStr(in, "patientName"), "un paciente"), "hacer una orden de laboratorio"
	case "PUT /optometria/ordenes-lab/:id":
		return "orden.editar", "Editó " + b, "editar " + b
	case "DELETE /optometria/ordenes-lab/:id":
		return "orden.eliminar", "Eliminó " + b, "eliminar " + b
	case "POST /optometria/ventas-pendientes/:id/sin-orden":
		return "orden.sin_orden", "Marcó la venta folio " + c.Param("id") + " como «no lleva orden»", "marcar una venta sin orden"
	case "POST /optometria/plantillas":
		return "plantilla.crear", "Creó una plantilla de examen", "crear una plantilla"
	case "PUT /optometria/plantillas/:id":
		return "plantilla.editar", "Editó la plantilla de examen #" + c.Param("id"), "editar una plantilla"
	case "POST /optometria/plantillas/:id/activar":
		return "plantilla.activar", "Activó la plantilla de examen #" + c.Param("id"), "activar una plantilla"
	case "DELETE /optometria/plantillas/:id":
		return "plantilla.eliminar", "Eliminó la plantilla de examen #" + c.Param("id"), "eliminar una plantilla"

	/* ----- Citas ----- */
	case "POST /citas", "POST /appointments":
		n := actOr(actNombre(in), actStr(in, "clientName"))
		d := "Agendó una cita para " + actOr(n, "un cliente")
		if f := actStr(in, "date"); f != "" {
			d += " el " + f
			if h := actStr(in, "time"); h != "" {
				d += " a las " + h
			}
		}
		return "cita.crear", d, "agendar una cita"
	case "PUT /citas/:id":
		return "cita.editar", "Editó " + b, "editar " + b
	case "PATCH /citas/:id/estado", "PATCH /appointments/:id/status":
		st := actCitaStatus(actStr(in, "status"))
		return "cita.estado", "Marcó " + b + " como «" + st + "»", "cambiar " + b + " a «" + st + "»"
	case "DELETE /citas/:id", "DELETE /appointments/:id":
		return "cita.eliminar", "Eliminó " + b, "eliminar " + b
	case "PUT /citas/:id/etiqueta":
		return "cita.etiqueta", "Cambió la etiqueta de " + b, "cambiar la etiqueta de " + b
	case "PUT /citas/:id/seguimiento":
		return "cita.seguimiento", "Actualizó el seguimiento de " + b, "actualizar el seguimiento de " + b

	/* ----- Inventario ----- */
	case "POST /inventario/articulos":
		return "articulo.crear", "Dio de alta el artículo «" + actOr(actStr(in, "descripcion"), "sin nombre") + "»", "dar de alta un artículo"
	case "PUT /inventario/articulos/:id":
		return "articulo.editar", "Editó " + b, "editar " + b
	case "DELETE /inventario/articulos/:id":
		return "articulo.eliminar", "Eliminó " + b, "eliminar " + b
	case "POST /inventario/articulos/:id/ajustar":
		d := "Ajustó la existencia de " + b
		if q := actStr(in, "cantidad"); q != "" {
			modo := actStr(in, "modo")
			switch modo {
			case "entrada", "sumar", "agregar":
				d += " (+" + q + ")"
			case "salida", "restar", "quitar":
				d += " (−" + q + ")"
			default:
				d += " (" + q + ")"
			}
		}
		return "articulo.ajuste", d, "ajustar " + b
	case "POST /inventario/articulos/:id/fotos":
		return "articulo.fotos", "Subió fotos a " + b, "subir fotos a " + b
	case "DELETE /inventario/fotos/:fotoId":
		return "articulo.foto_eliminar", "Eliminó una foto de un artículo", "eliminar una foto"
	case "POST /inventario/fotos/:fotoId/principal":
		return "", "", ""
	case "POST /inventario/ajustes":
		return "inventario.ajuste", "Aplicó un ajuste de inventario", "aplicar un ajuste de inventario"
	case "POST /inventario/departamentos":
		return "departamento.crear", "Creó el departamento «" + actStr(in, "nombre") + "»", "crear un departamento"
	case "PUT /inventario/departamentos/:id":
		return "departamento.editar", "Renombró un departamento a «" + actStr(in, "nombre") + "»", "renombrar un departamento"
	case "DELETE /inventario/departamentos/:id":
		return "departamento.eliminar", "Eliminó el departamento #" + c.Param("id"), "eliminar un departamento"
	case "POST /inventario/categorias":
		return "categoria.crear", "Creó la categoría «" + actStr(in, "nombre") + "»", "crear una categoría"
	case "PUT /inventario/categorias/:id":
		return "categoria.editar", "Editó la categoría «" + actStr(in, "nombre") + "»", "editar una categoría"
	case "DELETE /inventario/categorias/:id":
		return "categoria.eliminar", "Eliminó la categoría #" + c.Param("id"), "eliminar una categoría"
	case "POST /inventario/colores":
		return "color.crear", "Agregó el color «" + actStr(in, "nombre") + "»", "agregar un color"
	case "POST /inventario/materiales":
		return "material.crear", "Agregó el material «" + actStr(in, "nombre") + "»", "agregar un material"

	/* ----- Usuarios ----- */
	case "POST /equipo":
		return "usuario.crear", "Creó la cuenta de " + actOr(actStr(in, "name"), "alguien") + " (@" + actStr(in, "username") + ")", "crear una cuenta"
	case "PUT /equipo/:id":
		d := "Editó " + b
		if actStr(in, "password") != "" {
			d += " y le cambió la contraseña"
		}
		if in != nil && in["active"] == false {
			d += " (desactivada)"
		}
		return "usuario.editar", d, "editar " + b
	case "DELETE /equipo/:id":
		return "usuario.eliminar", "Eliminó " + b, "eliminar " + b
	}
	// Cualquier otra cosa del grupo: genérico.
	return "otro", "Hizo un cambio (" + m + " " + route + ")", "hacer un cambio"
}

/* ---------------- página y API ---------------- */

// BitacoraPage — GET /bitacora (solo el dueño).
func BitacoraPage(c *gin.Context) {
	if s := currentStaff(c); s != nil {
		c.Redirect(http.StatusFound, s.Home())
		return
	}
	c.HTML(http.StatusOK, "bitacora.html", gin.H{"Optica": invIsOptica(invUserID(c))})
}

func bitacoraFilter(c *gin.Context) models.ActivityFilter {
	f := models.ActivityFilter{OwnerID: invUserID(c), Person: c.Query("persona"), Kind: c.Query("tipo"), Area: c.Query("area")}
	if _, ok := activityAreaLabels[f.Area]; !ok {
		f.Area = ""
	}
	if d, err := time.Parse(time.RFC3339, c.Query("desde")); err == nil {
		f.From = &d
	}
	if d, err := time.Parse(time.RFC3339, c.Query("hasta")); err == nil {
		f.To = &d
	}
	f.Query = actCutRunes(strings.TrimSpace(c.Query("q")), 100)
	return f
}

func actCutRunes(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		return string(r[:n])
	}
	return s
}

// BitacoraList — GET /api/bitacora
func BitacoraList(c *gin.Context) {
	if !staffOwnerOnly(c) {
		return
	}
	f := bitacoraFilter(c)
	f.BeforeID, _ = strconv.ParseInt(c.Query("antes_id"), 10, 64)
	f.AfterID, _ = strconv.ParseInt(c.Query("despues_id"), 10, 64)
	f.Limit, _ = strconv.Atoi(c.Query("limit"))
	items, more, err := models.ListActivities(f)
	if err != nil {
		log.Printf("bitacora.List: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "No se pudo cargar la bitácora."})
		return
	}
	if items == nil {
		items = []models.ActivityLog{}
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "hasMore": more})
}

// BitacoraPeople — GET /api/bitacora/personas
// Todas las cuentas (aunque no hayan hecho nada en el periodo) y el dueño.
func BitacoraPeople(c *gin.Context) {
	if !staffOwnerOnly(c) {
		return
	}
	f := bitacoraFilter(c)
	stats, err := models.ActivityStatsByPerson(f)
	if err != nil {
		log.Printf("bitacora.People: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "No se pudo cargar el resumen."})
		return
	}
	owner := f.OwnerID
	out := []models.ActivityPersonStats{}
	me := models.ActivityPersonStats{Key: "dueno", Name: activityOwnerName(owner), Roles: "dueno", Active: true}
	if s, ok := stats["dueno"]; ok {
		me.Acciones, me.Sesiones, me.Fallidas, me.LastAt = s.Acciones, s.Sesiones, s.Fallidas, s.LastAt
	}
	out = append(out, me)
	seen := map[string]bool{"dueno": true}
	list, _ := models.ListStaff(owner)
	for _, s := range list {
		k := "staff:" + strconv.FormatUint(uint64(s.ID), 10)
		p := models.ActivityPersonStats{Key: k, StaffID: s.ID, Name: s.Name, Roles: strings.Join(s.RoleList(), ","), Active: s.Active}
		if st, ok := stats[k]; ok {
			p.Acciones, p.Sesiones, p.Fallidas, p.LastAt = st.Acciones, st.Sesiones, st.Fallidas, st.LastAt
		}
		out = append(out, p)
		seen[k] = true
	}
	for k, st := range stats { // cuentas ya eliminadas con actividad en el periodo
		if !seen[k] {
			p := *st
			p.Name = actOr(p.Name, "Cuenta eliminada") + " (eliminada)"
			out = append(out, p)
		}
	}
	var tot models.ActivityPersonStats
	for _, p := range out {
		tot.Acciones += p.Acciones
		tot.Sesiones += p.Sesiones
		tot.Fallidas += p.Fallidas
	}
	c.JSON(http.StatusOK, gin.H{"personas": out, "totales": tot, "areas": activityAreaLabels})
}

// StartActivityJanitor — una vez al día borra lo más viejo.
func StartActivityJanitor() {
	go func() {
		for {
			models.PurgeOldActivities(ActivityRetentionDays)
			time.Sleep(24 * time.Hour)
		}
	}()
}
