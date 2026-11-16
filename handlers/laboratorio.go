package handlers

// laboratorio.go — Laboratorio (sidebar → Laboratorio, solo ópticas).
// Portado de Avante: tablero de trabajos por paso (arrastrar, avanzar,
// escáner con la clave del ticket), detalle con historial, notas, entrega
// estimada y lente express. Los trabajos llegan del Punto de venta (como en
// Avante: ya no se dan de alta aquí).
//
//	GET   /laboratorio
//	GET   /api/laboratorio/pedidos?limpios=1     (limpios = incluir los limpiados)
//	PATCH /api/laboratorio/pedidos/:id/estado    {status: paso | "ready"}
//	PUT   /api/laboratorio/pedidos/:id/notas     {notes}
//	PUT   /api/laboratorio/pedidos/:id/externo   {externo}
//	PUT   /api/laboratorio/pedidos/:id/entrega   {entrega: "AAAA-MM-DD" | ""}
//	PUT   /api/laboratorio/pedidos/:id/express   {express}
//	GET   /api/laboratorio/pedidos/:id/historial
//	POST  /api/laboratorio/limpiar               {status}: limpia la última columna (no se borra nada)
//	POST  /api/laboratorio/escanear              {code}: el trabajo pasa al siguiente paso

import (
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"attomos/models"

	"github.com/gin-gonic/gin"
)

// LabPage — GET /laboratorio: el tablero de trabajos.
func LabPage(c *gin.Context) {
	c.HTML(http.StatusOK, "laboratorio.html", gin.H{
		"Optica":    invIsOptica(invUserID(c)),
		"StaffName": posCashier(c),
	})
}

func labID(c *gin.Context) (uint, bool) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Trabajo inválido."})
		return 0, false
	}
	return uint(id), true
}

func labFail(c *gin.Context, where string, err error, msg string) {
	if errors.Is(err, models.ErrLabOrderNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "Ese trabajo ya no existe."})
		return
	}
	log.Printf("laboratorio.%s: %v", where, err)
	c.JSON(http.StatusInternalServerError, gin.H{"error": msg})
}

// LabListOrders — GET /api/laboratorio/pedidos
func LabListOrders(c *gin.Context) {
	list, limpios, err := models.ListLabOrders(invUserID(c), c.Query("limpios") == "1")
	if err != nil {
		labFail(c, "ListOrders", err, "No se pudieron cargar los trabajos.")
		return
	}
	c.JSON(http.StatusOK, gin.H{"pedidos": list, "estados": models.LabSteps(), "limpios": limpios})
}

// LabSetStatus — PATCH /api/laboratorio/pedidos/:id/estado
func LabSetStatus(c *gin.Context) {
	id, ok := labID(c)
	if !ok {
		return
	}
	var in struct {
		Status string `json:"status"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || strings.TrimSpace(in.Status) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Paso inválido."})
		return
	}
	if _, err := models.SetLabStep(invUserID(c), id, strings.TrimSpace(in.Status), posCashier(c)); err != nil {
		if err.Error() == "ese paso no existe" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Ese paso no existe."})
			return
		}
		labFail(c, "SetStatus", err, "No se pudo cambiar el paso.")
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// LabSetNotes — PUT /api/laboratorio/pedidos/:id/notas
func LabSetNotes(c *gin.Context) {
	id, ok := labID(c)
	if !ok {
		return
	}
	var in struct {
		Notes string `json:"notes"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos inválidos."})
		return
	}
	notes := strings.TrimSpace(in.Notes)
	if r := []rune(notes); len(r) > 500 {
		notes = string(r[:500])
	}
	if err := models.SetLabNotes(invUserID(c), id, notes); err != nil {
		labFail(c, "SetNotes", err, "No se pudieron guardar las notas.")
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "notes": notes})
}

// LabSetExterno — PUT /api/laboratorio/pedidos/:id/externo
func LabSetExterno(c *gin.Context) {
	id, ok := labID(c)
	if !ok {
		return
	}
	var in struct {
		Externo bool `json:"externo"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos inválidos."})
		return
	}
	if err := models.SetLabExterno(invUserID(c), id, in.Externo); err != nil {
		labFail(c, "SetExterno", err, "No se pudo guardar.")
		return
	}
	c.JSON(http.StatusOK, gin.H{"externo": in.Externo})
}

// LabOrderHistory — GET /api/laboratorio/pedidos/:id/historial
func LabOrderHistory(c *gin.Context) {
	id, ok := labID(c)
	if !ok {
		return
	}
	list, err := models.ListOrderLogs(invUserID(c), id)
	if err != nil {
		labFail(c, "History", err, "No se pudo cargar el historial.")
		return
	}
	// El tablero pinta el paso (o el estatus si salió del laboratorio).
	out := make([]gin.H, 0, len(list))
	for _, l := range list {
		key := l.LabStep
		if key == "" {
			key = l.Status
		}
		out = append(out, gin.H{"status": key, "by": l.By, "at": l.CreatedAt})
	}
	c.JSON(http.StatusOK, out)
}

// LabClearColumn — POST /api/laboratorio/limpiar {status}
// Solo la última columna (Control de calidad): sus trabajos salen del
// tablero sin borrarse ni cambiar de paso ("Ver limpiados" los muestra).
func LabClearColumn(c *gin.Context) {
	var in struct {
		Status string `json:"status"`
	}
	steps := models.LabSteps()
	if err := c.ShouldBindJSON(&in); err != nil || len(steps) == 0 || strings.TrimSpace(in.Status) != steps[len(steps)-1].Key {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Solo se puede limpiar la columna de " + steps[len(steps)-1].Label + "."})
		return
	}
	n, err := models.ClearLabColumn(invUserID(c), strings.TrimSpace(in.Status))
	if err != nil {
		labFail(c, "ClearColumn", err, "No se pudo limpiar la columna.")
		return
	}
	c.JSON(http.StatusOK, gin.H{"limpiados": n})
}

// LabSetEntrega — PUT /api/laboratorio/pedidos/:id/entrega {entrega}
// Fecha estimada de entrega de ese trabajo (una por lente, a mano).
func LabSetEntrega(c *gin.Context) {
	id, ok := labID(c)
	if !ok {
		return
	}
	var in struct {
		Entrega string `json:"entrega"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos inválidos."})
		return
	}
	date := strings.TrimSpace(in.Entrega)
	if date != "" {
		d, err := time.Parse("2006-01-02", date)
		if err != nil || d.Year() < 2000 || d.Year() > 2100 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Fecha inválida."})
			return
		}
	}
	if err := models.SetLabEntrega(invUserID(c), id, date); err != nil {
		labFail(c, "SetEntrega", err, "No se pudo guardar.")
		return
	}
	c.JSON(http.StatusOK, gin.H{"entrega": date})
}

// LabSetExpress — PUT /api/laboratorio/pedidos/:id/express {express}
// Por ahora solo la etiqueta «Express» en la tarjeta.
func LabSetExpress(c *gin.Context) {
	id, ok := labID(c)
	if !ok {
		return
	}
	var in struct {
		Express bool `json:"express"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos inválidos."})
		return
	}
	if err := models.SetLabExpress(invUserID(c), id, in.Express); err != nil {
		labFail(c, "SetExpress", err, "No se pudo guardar.")
		return
	}
	c.JSON(http.StatusOK, gin.H{"express": in.Express})
}

// LabScan — POST /api/laboratorio/escanear {code}
// El escáner lee la clave del ticket y el trabajo pasa al siguiente paso.
// En Control de calidad, el siguiente es "Listo para recoger".
func LabScan(c *gin.Context) {
	var in struct {
		Code string `json:"code"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || strings.TrimSpace(in.Code) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No se leyó ningún código."})
		return
	}
	uid := invUserID(c)
	o, err := models.FindLabOrderByCode(uid, in.Code)
	if errors.Is(err, models.ErrLabOrderNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "No hay ningún trabajo en el laboratorio con la clave " + models.NormalizeTrackingCode(in.Code) + "."})
		return
	}
	if err != nil {
		labFail(c, "Scan", err, "No se pudieron cargar los trabajos.")
		return
	}
	steps := models.LabSteps()
	cur := -1
	for i, s := range steps {
		if s.Key == o.Status {
			cur = i
		}
	}
	next, label := string(models.OrderStatusReady), "Listo para recoger"
	if cur >= 0 && cur < len(steps)-1 {
		next, label = steps[cur+1].Key, steps[cur+1].Label
	}
	if _, err := models.SetLabStep(uid, o.ID, next, posCashier(c)); err != nil {
		labFail(c, "Scan", err, "No se pudo cambiar el paso.")
		return
	}
	prev := ""
	if cur >= 0 {
		prev = steps[cur].Label
	}
	c.JSON(http.StatusOK, gin.H{"id": o.ID, "code": o.OrderCode, "cliente": o.CustomerName, "from": prev, "status": next, "label": label})
}
