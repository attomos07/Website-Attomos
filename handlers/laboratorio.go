package handlers

// laboratorio.go — Laboratorio (sidebar → Laboratorio, solo ópticas).
// Portado de Avante: tablero de trabajos por paso (arrastrar, avanzar,
// escáner con la clave del ticket), detalle con historial y notas y
// trabajo nuevo con un producto del inventario.
//
//	GET   /laboratorio
//	GET   /api/laboratorio/pedidos
//	POST  /api/laboratorio/pedidos            trabajo nuevo (descuenta del inventario)
//	PATCH /api/laboratorio/pedidos/:id/estado {status: paso | "ready"}
//	PUT   /api/laboratorio/pedidos/:id/notas  {notes}
//	PUT   /api/laboratorio/pedidos/:id/externo {externo}
//	GET   /api/laboratorio/pedidos/:id/historial
//	POST  /api/laboratorio/listos             {status}: toda la columna → Listo para recoger
//	POST  /api/laboratorio/escanear           {code}: el trabajo pasa al siguiente paso
//	GET   /api/laboratorio/inventario       productos para "Nuevo trabajo" (sin costos)

import (
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"

	"attomos/config"
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
	list, err := models.ListLabOrders(invUserID(c))
	if err != nil {
		labFail(c, "ListOrders", err, "No se pudieron cargar los trabajos.")
		return
	}
	c.JSON(http.StatusOK, gin.H{"pedidos": list, "estados": models.LabSteps()})
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

// LabReadyColumn — POST /api/laboratorio/listos {status}
func LabReadyColumn(c *gin.Context) {
	var in struct {
		Status string `json:"status"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || models.LabStepLabel(in.Status) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Columna inválida."})
		return
	}
	n, err := models.ReadyLabColumn(invUserID(c), in.Status, posCashier(c))
	if err != nil {
		labFail(c, "ReadyColumn", err, "No se pudo actualizar la columna.")
		return
	}
	c.JSON(http.StatusOK, gin.H{"listos": n})
}

// LabCreateOrder — POST /api/laboratorio/pedidos
func LabCreateOrder(c *gin.Context) {
	var in models.LabOrderInput
	if err := c.ShouldBindJSON(&in); err != nil || in.InventoryID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Elige un producto del inventario."})
		return
	}
	in.CustomerName = strings.TrimSpace(in.CustomerName)
	if in.CustomerName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Escribe el nombre del cliente."})
		return
	}
	if in.Quantity > 999 {
		in.Quantity = 999
	}
	for _, s := range []*string{&in.CustomerName, &in.RxOD, &in.RxOI} {
		*s = strings.TrimSpace(*s)
		if r := []rune(*s); len(r) > 120 {
			*s = string(r[:120])
		}
	}
	in.Notes = strings.TrimSpace(in.Notes)
	if r := []rune(in.Notes); len(r) > 500 {
		in.Notes = string(r[:500])
	}
	uid := invUserID(c)
	o, err := models.NewLabOrder(uid, in)
	if errors.Is(err, models.ErrLabItemNotFound) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Ese producto ya no está en el inventario."})
		return
	}
	if err != nil {
		labFail(c, "CreateOrder", err, "No se pudo crear el trabajo.")
		return
	}
	if err := config.DB.Create(o).Error; err != nil {
		labFail(c, "CreateOrder", err, "No se pudo crear el trabajo.")
		return
	}
	models.LogOrderStatus(uid, o.ID, string(o.Status), models.LabStepRecibido, posCashier(c))
	// Descuenta del Inventario (kárdex "pedido").
	orderApplyStock(o, "Laboratorio")
	c.JSON(http.StatusCreated, gin.H{"id": o.ID, "orderCode": o.TrackingCode})
}

type labInvItem struct {
	ID           int64   `json:"id"`
	Clave        string  `json:"clave"`
	Descripcion  string  `json:"descripcion"`
	Departamento string  `json:"departamento"`
	Categoria    string  `json:"categoria"`
	Existencia   int     `json:"existencia"`
	Minimo       int     `json:"minimo"`
	Precio       float64 `json:"precio"`
	Servicio     bool    `json:"servicio"`
	Localizacion string  `json:"localizacion"`
}

// LabInventario — GET /api/laboratorio/inventario (sin costos)
func LabInventario(c *gin.Context) {
	list, err := models.ListInvItems(invUserID(c))
	if err != nil {
		labFail(c, "Inventario", err, "No se pudo cargar el inventario.")
		return
	}
	out := make([]labInvItem, 0, len(list))
	for _, a := range list {
		out = append(out, labInvItem{
			ID: a.ID, Clave: a.Clave, Descripcion: a.Descripcion, Departamento: a.Departamento,
			Categoria: a.Categoria, Existencia: a.Existencia, Minimo: a.Minimo, Precio: a.Precio1,
			Servicio: a.Servicio, Localizacion: a.Localizacion,
		})
	}
	c.JSON(http.StatusOK, out)
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
