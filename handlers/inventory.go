package handlers

// inventory.go — Inventario (sidebar → Inventario), portado del panel de
// Inventario de Avante Optics. Páginas en /inventory/…, API en /api/inventario/…
// (las mismas rutas de API que en Avante, para reutilizar su JS tal cual):
//
//	GET    /api/inventario/articulos               catálogo completo
//	POST   /api/inventario/articulos               agregar artículo
//	PUT    /api/inventario/articulos/:id           editar artículo (no cambia la existencia)
//	DELETE /api/inventario/articulos/:id           eliminar (solo con existencia 0)
//	POST   /api/inventario/articulos/:id/ajustar   entrada / salida / fijar existencia
//	GET    /api/inventario/departamentos           departamentos con sus categorías
//	POST   /api/inventario/departamentos           nuevo departamento
//	PUT    /api/inventario/departamentos/:id       renombrar
//	DELETE /api/inventario/departamentos/:id       borrar (sin artículos)
//	POST   /api/inventario/categorias              nueva categoría
//	PUT    /api/inventario/categorias/:id          editar categoría
//	DELETE /api/inventario/categorias/:id          borrar (sin artículos)
//	GET    /api/inventario/ajustes?desde=&hasta=   folios de ajuste
//	GET    /api/inventario/ajustes/:id             un ajuste (por folio) con sus artículos
//	POST   /api/inventario/ajustes                 aplicar inventario físico
//	GET    /api/inventario/movimientos?item=&desde=&hasta=&tipo=&q=   kárdex
//	GET    /api/inventario/tipos-armazon | colores | materiales        (solo ópticas)
//
// Todo va filtrado por el usuario de la sesión (el dueño del negocio).

import (
	"errors"
	"log"
	"math"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"attomos/config"
	"attomos/models"
	"attomos/realtime"

	"github.com/gin-gonic/gin"
)

var (
	invClaveRe = regexp.MustCompile(`^[A-Z0-9][A-Z0-9./-]*$`)
	invFechaRe = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	invHexRe   = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)
	invUnidad  = map[string]bool{"PZA": true, "CAJA": true, "PAR": true, "JGO": true, "PAQ": true, "SERV": true, "ML": true, "KIT": true}
)

/* ---------------- sesión y giro ---------------- */

// invUserID — id del dueño del negocio (de la sesión).
func invUserID(c *gin.Context) uint {
	if u, ok := c.Get("user"); ok {
		if user, ok := u.(*models.User); ok && user != nil {
			return user.ID
		}
	}
	return 0
}

// invUser — nombre con el que queda registrado quien hace un movimiento.
// Por ahora es el dueño (empresa o correo); cuando existan empleados, aquí
// irá el nombre del empleado.
func invUser(c *gin.Context) string {
	var u models.User
	if err := config.DB.Select("id, email, company").First(&u, invUserID(c)).Error; err == nil {
		if s := strings.TrimSpace(u.Company); s != "" {
			return s
		}
		return u.Email
	}
	if v, ok := c.Get("user"); ok {
		if user, ok := v.(*models.User); ok {
			return user.Email
		}
	}
	return ""
}

// invBusinessName — nombre del negocio (para reportes).
func invBusinessName(userID uint) string {
	var b models.MyBusinessInfo
	if err := config.DB.Select("business_name").Where("user_id = ? AND business_name <> ''", userID).Order("branch_number ASC").First(&b).Error; err == nil {
		return b.BusinessName
	}
	var u models.User
	if err := config.DB.Select("company").First(&u, userID).Error; err == nil && strings.TrimSpace(u.Company) != "" {
		return u.Company
	}
	return "Attomos"
}

// isOpticaType: el giro de óptica ("optica", también "Óptica").
func isOpticaType(t string) bool {
	t = strings.ToLower(strings.TrimSpace(t))
	return t == "optica" || t == "óptica"
}

// invIsOptica: ¿el negocio es una óptica? Se toma del giro del registro o
// de cualquiera de sus sucursales (Mi Negocio).
func invIsOptica(userID uint) bool {
	var u models.User
	if err := config.DB.Select("id, business_type").First(&u, userID).Error; err == nil && isOpticaType(u.BusinessType) {
		return true
	}
	var n int64
	config.DB.Model(&models.MyBusinessInfo{}).Where("user_id = ? AND LOWER(business_type) IN ('optica','óptica')", userID).Count(&n)
	return n > 0
}

// invCanCost: quién ve y captura el precio de compra (costo). Hoy solo entra
// el dueño, así que siempre puede. Cuando haya empleados, aquí se decide.
func invCanCost(c *gin.Context) bool { return true }

// invHideCost borra el costo de lo que se le manda a quien no puede verlo.
func invHideCost(c *gin.Context, items ...*models.InvItem) {
	if invCanCost(c) {
		return
	}
	for _, a := range items {
		if a != nil {
			a.PrecioCompra = 0
		}
	}
}

// invNotifyBots avisa a los bots activos del negocio que refresquen su
// business_config: el catálogo que ofrecen sale de este Inventario. Si un
// bot no está conectado al hub en ese momento, su polling de 5 min lo
// recoge (mismo criterio que syncAtomicBots en business_handler.go).
func invNotifyBots(userID uint) {
	go func() {
		var agents []models.Agent
		if err := config.DB.Select("id").Where("user_id = ? AND is_active = ?", userID, true).Find(&agents).Error; err != nil {
			return
		}
		for _, a := range agents {
			realtime.CRMHub.SendToBot(a.ID, realtime.CRMSendCommand{Type: "refresh_business_config"})
		}
	}()
}

/* ---------------- páginas ---------------- */

// invPage arma una de las 4 pestañas del Inventario.
func invPage(file, tab string) gin.HandlerFunc {
	return func(c *gin.Context) {
		uid := invUserID(c)
		optica := invIsOptica(uid)
		models.EnsureInventorySeed(uid, optica)
		c.HTML(http.StatusOK, file, gin.H{
			"InvTab":       tab,
			"InvBase":      "/inventory",
			"CanCost":      invCanCost(c),
			"Optica":       optica,
			"BusinessName": invBusinessName(uid),
		})
	}
}

var (
	InventoryItemsPage       = invPage("inventory.html", "articulos")
	InventoryDepartmentsPage = invPage("inventory.html", "departamentos")
	InventoryAdjustmentsPage = invPage("inventory.html", "ajustes")
	InventoryMovementsPage   = invPage("inventory.html", "movimientos")
)

func invID(c *gin.Context) (int64, bool) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Identificador inválido."})
		return 0, false
	}
	return id, true
}

func invFail(c *gin.Context, where string, err error, msg string) {
	log.Printf("inventario.%s: %v", where, err)
	c.JSON(http.StatusInternalServerError, gin.H{"error": msg})
}

/* ---------------- artículos ---------------- */

// InvListItems — GET /api/inventario/articulos
func InvListItems(c *gin.Context) {
	uid := invUserID(c)
	optica := invIsOptica(uid)
	models.EnsureInventorySeed(uid, optica)
	items, err := models.ListInvItems(uid)
	if err != nil {
		invFail(c, "ListItems", err, "No se pudo cargar el inventario.")
		return
	}
	deps, err := models.ListInvDepartments(uid)
	if err != nil {
		invFail(c, "ListItems.deps", err, "No se pudieron cargar los departamentos.")
		return
	}
	for i := range items {
		invHideCost(c, &items[i])
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "departamentos": deps, "can_cost": invCanCost(c), "optica": optica})
}

type invItemBody struct {
	Clave          string  `json:"clave"`
	ClaveAlterna   string  `json:"clave_alterna"`
	Descripcion    string  `json:"descripcion"`
	DepartamentoID int64   `json:"departamento_id"`
	CategoriaID    int64   `json:"categoria_id"`
	UnidadCompra   string  `json:"unidad_compra"`
	UnidadVenta    string  `json:"unidad_venta"`
	Factor         float64 `json:"factor"`
	Servicio       bool    `json:"servicio"`
	IVA            bool    `json:"iva"`
	PrecioCompra   float64 `json:"precio_compra"`
	Precio1        float64 `json:"precio_1"`
	Precio2        float64 `json:"precio_2"`
	Precio3        float64 `json:"precio_3"`
	Precio4        float64 `json:"precio_4"`
	Mayoreo2       int     `json:"mayoreo_2"`
	Mayoreo3       int     `json:"mayoreo_3"`
	Mayoreo4       int     `json:"mayoreo_4"`
	Existencia     int     `json:"existencia"`
	Minimo         int     `json:"minimo"`
	Maximo         int     `json:"maximo"`
	Localizacion   string  `json:"localizacion"`
	// Solo ópticas
	TipoArmazon    string   `json:"tipo_armazon"`
	ColorPrincipal string   `json:"color_principal"`
	ColoresExtra   []string `json:"colores_extra"`
	MicaTipo       string   `json:"mica_tipo"`
	Materiales     []string `json:"materiales"`
}

func invMoneyOK(vs ...float64) bool {
	for _, v := range vs {
		if v < 0 || v > 9999999 || math.IsNaN(v) {
			return false
		}
	}
	return true
}

// bindInvItem lee y valida el artículo. Si algo está mal ya respondió.
func bindInvItem(c *gin.Context, uid uint) (models.InvItem, bool) {
	var b invItemBody
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos inválidos."})
		return models.InvItem{}, false
	}
	bad := func(msg string) (models.InvItem, bool) {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return models.InvItem{}, false
	}
	b.Clave = models.NormalizeInvClave(b.Clave)
	b.ClaveAlterna = models.NormalizeInvClave(b.ClaveAlterna)
	b.Descripcion = strings.Join(strings.Fields(b.Descripcion), " ")
	b.UnidadCompra = strings.ToUpper(strings.TrimSpace(b.UnidadCompra))
	b.UnidadVenta = strings.ToUpper(strings.TrimSpace(b.UnidadVenta))
	b.Localizacion = strings.ToUpper(strings.Join(strings.Fields(b.Localizacion), " "))
	if b.UnidadCompra == "" {
		b.UnidadCompra = "PZA"
	}
	if b.UnidadVenta == "" {
		b.UnidadVenta = "PZA"
	}
	if b.Factor <= 0 {
		b.Factor = 1
	}
	switch {
	case b.Clave == "":
		return bad("Escribe la clave del artículo.")
	case len([]rune(b.Clave)) > 60 || !invClaveRe.MatchString(b.Clave):
		return bad("La clave solo puede llevar letras, números, guiones (-), puntos (.) y diagonales (/).")
	case b.ClaveAlterna != "" && (len([]rune(b.ClaveAlterna)) > 60 || !invClaveRe.MatchString(b.ClaveAlterna)):
		return bad("La clave alterna solo puede llevar letras, números, guiones, puntos y diagonales.")
	case b.Descripcion == "":
		return bad("Escribe la descripción del artículo.")
	case len([]rune(b.Descripcion)) > 200:
		return bad("La descripción es muy larga (máximo 200 caracteres).")
	case !invUnidad[b.UnidadCompra] || !invUnidad[b.UnidadVenta]:
		return bad("Elige una unidad de compra y de venta válida.")
	case b.Factor > 10000:
		return bad("Revisa el factor.")
	case !invMoneyOK(b.PrecioCompra, b.Precio1, b.Precio2, b.Precio3, b.Precio4):
		return bad("Revisa los precios: no pueden ser negativos.")
	case b.Mayoreo2 < 0 || b.Mayoreo3 < 0 || b.Mayoreo4 < 0:
		return bad("Las unidades de mayoreo no pueden ser negativas.")
	case b.Existencia < 0 || b.Existencia > 1000000:
		return bad("Revisa la existencia inicial.")
	case b.Minimo < 0 || b.Maximo < 0:
		return bad("El inventario mínimo y máximo no pueden ser negativos.")
	case b.Maximo > 0 && b.Minimo > b.Maximo:
		return bad("El inventario mínimo no puede ser mayor que el máximo.")
	case len([]rune(b.Localizacion)) > 60:
		return bad("La localización es muy larga (máximo 60 caracteres).")
	}

	a := models.InvItem{
		Clave: b.Clave, ClaveAlterna: b.ClaveAlterna, Descripcion: b.Descripcion,
		DepartamentoID: b.DepartamentoID, CategoriaID: b.CategoriaID,
		UnidadCompra: b.UnidadCompra, UnidadVenta: b.UnidadVenta, Factor: b.Factor,
		Servicio: b.Servicio, IVA: b.IVA,
		PrecioCompra: b.PrecioCompra, Precio1: b.Precio1, Precio2: b.Precio2, Precio3: b.Precio3, Precio4: b.Precio4,
		Mayoreo2: b.Mayoreo2, Mayoreo3: b.Mayoreo3, Mayoreo4: b.Mayoreo4,
		Existencia: b.Existencia, Minimo: b.Minimo, Maximo: b.Maximo, Localizacion: b.Localizacion,
		ColoresExtra: []string{}, Materiales: []string{},
	}

	// Los datos de armazón solo aplican a ópticas; para otros giros se ignoran.
	if !invIsOptica(uid) {
		return a, true
	}
	b.TipoArmazon = strings.TrimSpace(b.TipoArmazon)
	if b.TipoArmazon != "" && !models.InvFrameTypeExists(uid, b.TipoArmazon) {
		return bad("Ese tipo de armazón ya no existe; elige otro.")
	}
	cleanColor := func(s string) string { return strings.Join(strings.Fields(strings.ReplaceAll(s, ",", " ")), " ") }
	b.ColorPrincipal = cleanColor(b.ColorPrincipal)
	extras := []string{}
	for _, col := range b.ColoresExtra {
		col = cleanColor(col)
		if col == "" || strings.EqualFold(col, b.ColorPrincipal) {
			continue
		}
		dup := false
		for _, x := range extras {
			if strings.EqualFold(x, col) {
				dup = true
			}
		}
		if !dup {
			extras = append(extras, col)
		}
	}
	switch {
	case len([]rune(b.ColorPrincipal)) > 30:
		return bad("El nombre del color es muy largo.")
	case len(extras) > 2:
		return bad("La combinación lleva máximo 2 colores además del principal.")
	case len(extras) > 0 && b.ColorPrincipal == "":
		return bad("Elige primero el color principal.")
	case b.MicaTipo != "" && b.MicaTipo != "oftalmico" && b.MicaTipo != "sol":
		return bad("Elige si es oftálmico o de sol.")
	}
	for _, x := range extras {
		if len([]rune(x)) > 30 {
			return bad("El nombre del color es muy largo.")
		}
	}
	mats, okMats := models.CleanInvMaterials(b.Materiales)
	if !okMats {
		return bad("Elige máximo 4 materiales (y nombres cortos).")
	}
	a.TipoArmazon, a.ColorPrincipal, a.ColoresExtra, a.MicaTipo, a.Materiales = b.TipoArmazon, b.ColorPrincipal, extras, b.MicaTipo, mats
	return a, true
}

func invItemErr(c *gin.Context, where string, err error, clave string) {
	switch {
	case errors.Is(err, models.ErrInvClaveTaken):
		c.JSON(http.StatusConflict, gin.H{"error": "Ya existe un artículo con la clave " + clave + "."})
	case errors.Is(err, models.ErrInvItemNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "Ese artículo ya no existe."})
	case errors.Is(err, models.ErrInvDeptNotFound):
		c.JSON(http.StatusBadRequest, gin.H{"error": "Ese departamento ya no existe."})
	case errors.Is(err, models.ErrInvCatNotFound):
		c.JSON(http.StatusBadRequest, gin.H{"error": "Esa categoría ya no existe."})
	case strings.Contains(err.Error(), "categoría no es del departamento"), strings.Contains(err.Error(), "servicio"):
		c.JSON(http.StatusBadRequest, gin.H{"error": strings.ToUpper(err.Error()[:1]) + err.Error()[1:] + "."})
	default:
		invFail(c, where, err, "No se pudo guardar el artículo.")
	}
}

// InvCreateItem — POST /api/inventario/articulos
func InvCreateItem(c *gin.Context) {
	uid := invUserID(c)
	a, ok := bindInvItem(c, uid)
	if !ok {
		return
	}
	if !invCanCost(c) {
		a.PrecioCompra = 0
	}
	item, err := models.CreateInvItem(uid, a, invUser(c))
	if err != nil {
		invItemErr(c, "CreateItem", err, a.Clave)
		return
	}
	invHideCost(c, item)
	invNotifyBots(uid)
	c.JSON(http.StatusCreated, gin.H{"item": item})
}

// InvUpdateItem — PUT /api/inventario/articulos/:id
func InvUpdateItem(c *gin.Context) {
	id, ok := invID(c)
	if !ok {
		return
	}
	uid := invUserID(c)
	a, ok := bindInvItem(c, uid)
	if !ok {
		return
	}
	a.ID = id
	item, err := models.UpdateInvItem(uid, a, !invCanCost(c))
	if err != nil {
		invItemErr(c, "UpdateItem", err, a.Clave)
		return
	}
	invHideCost(c, item)
	invNotifyBots(uid)
	c.JSON(http.StatusOK, gin.H{"item": item})
}

// InvDeleteItem — DELETE /api/inventario/articulos/:id
func InvDeleteItem(c *gin.Context) {
	id, ok := invID(c)
	if !ok {
		return
	}
	uid := invUserID(c)
	photoKeys := models.InvPhotoKeysOfItem(uid, id)
	err := models.DeleteInvItem(uid, id)
	if err == nil {
		invDeletePhotoFiles(photoKeys)
	}
	switch {
	case errors.Is(err, models.ErrInvItemNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "Ese artículo ya no existe."})
	case errors.Is(err, models.ErrInvHasStock):
		c.JSON(http.StatusConflict, gin.H{"error": "Solo se pueden eliminar artículos con existencia 0. Primero haz una salida con Ajustar."})
	case err != nil:
		invFail(c, "DeleteItem", err, "No se pudo eliminar el artículo.")
	default:
		invNotifyBots(uid)
		c.JSON(http.StatusOK, gin.H{"ok": true})
	}
}

// InvAdjustItem — POST /api/inventario/articulos/:id/ajustar
// {modo: "entrada"|"salida"|"fijar", cantidad, comentario}
func InvAdjustItem(c *gin.Context) {
	id, ok := invID(c)
	if !ok {
		return
	}
	var in struct {
		Modo       string `json:"modo"`
		Cantidad   int    `json:"cantidad"`
		Comentario string `json:"comentario"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos inválidos."})
		return
	}
	in.Comentario = strings.Join(strings.Fields(in.Comentario), " ")
	switch {
	case in.Modo != "entrada" && in.Modo != "salida" && in.Modo != "fijar":
		c.JSON(http.StatusBadRequest, gin.H{"error": "Elige si es entrada, salida o fijar existencia."})
		return
	case in.Modo != "fijar" && in.Cantidad <= 0:
		c.JSON(http.StatusBadRequest, gin.H{"error": "Escribe cuántas piezas."})
		return
	case in.Cantidad < 0 || in.Cantidad > 1000000:
		c.JSON(http.StatusBadRequest, gin.H{"error": "Revisa la cantidad."})
		return
	case len([]rune(in.Comentario)) > 250:
		c.JSON(http.StatusBadRequest, gin.H{"error": "El comentario es muy largo."})
		return
	}
	r, err := models.AdjustInvItem(invUserID(c), id, in.Modo, in.Cantidad, in.Comentario, invUser(c))
	switch {
	case errors.Is(err, models.ErrInvItemNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "Ese artículo ya no existe."})
	case errors.Is(err, models.ErrInvService):
		c.JSON(http.StatusBadRequest, gin.H{"error": "Los servicios no llevan existencia."})
	case errors.Is(err, models.ErrInvNotEnoughStock):
		c.JSON(http.StatusConflict, gin.H{"error": "No puedes sacar más piezas de las que hay (" + strings.TrimPrefix(err.Error(), models.ErrInvNotEnoughStock.Error()+": ") + ")."})
	case err != nil:
		invFail(c, "AdjustItem", err, "No se pudo hacer el ajuste.")
	default:
		invNotifyBots(invUserID(c))
		invHideCost(c, r.Articulo)
		c.JSON(http.StatusOK, gin.H{"ajuste": r})
	}
}

/* ---------------- departamentos y categorías ---------------- */

// InvListDepartments — GET /api/inventario/departamentos
func InvListDepartments(c *gin.Context) {
	uid := invUserID(c)
	models.EnsureInventorySeed(uid, invIsOptica(uid))
	deps, err := models.ListInvDepartments(uid)
	if err != nil {
		invFail(c, "ListDepartments", err, "No se pudieron cargar los departamentos.")
		return
	}
	c.JSON(http.StatusOK, gin.H{"departamentos": deps})
}

func invName(c *gin.Context, what string) (string, bool) {
	var in struct {
		Nombre string `json:"nombre"`
	}
	_ = c.ShouldBindJSON(&in)
	n := models.NormalizeInvName(in.Nombre)
	if n == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Escribe el nombre del " + what + "."})
		return "", false
	}
	if len([]rune(n)) > 60 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "El nombre es muy largo (máximo 60 caracteres)."})
		return "", false
	}
	return n, true
}

// InvCreateDepartment — POST /api/inventario/departamentos {nombre}
func InvCreateDepartment(c *gin.Context) {
	n, ok := invName(c, "departamento")
	if !ok {
		return
	}
	id, err := models.CreateInvDepartment(invUserID(c), n)
	if errors.Is(err, models.ErrInvDeptDuplicate) {
		c.JSON(http.StatusConflict, gin.H{"error": "Ya existe el departamento " + n + "."})
		return
	}
	if err != nil {
		invFail(c, "CreateDepartment", err, "No se pudo guardar el departamento.")
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": id, "nombre": n})
}

// InvRenameDepartment — PUT /api/inventario/departamentos/:id {nombre}
func InvRenameDepartment(c *gin.Context) {
	id, ok := invID(c)
	if !ok {
		return
	}
	n, ok := invName(c, "departamento")
	if !ok {
		return
	}
	err := models.RenameInvDepartment(invUserID(c), id, n)
	switch {
	case errors.Is(err, models.ErrInvDeptDuplicate):
		c.JSON(http.StatusConflict, gin.H{"error": "Ya existe el departamento " + n + "."})
	case errors.Is(err, models.ErrInvDeptNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "Ese departamento ya no existe."})
	case err != nil:
		invFail(c, "RenameDepartment", err, "No se pudo guardar el departamento.")
	default:
		c.JSON(http.StatusOK, gin.H{"id": id, "nombre": n})
	}
}

// InvDeleteDepartment — DELETE /api/inventario/departamentos/:id
func InvDeleteDepartment(c *gin.Context) {
	id, ok := invID(c)
	if !ok {
		return
	}
	err := models.DeleteInvDepartment(invUserID(c), id)
	switch {
	case errors.Is(err, models.ErrInvDeptInUse):
		c.JSON(http.StatusConflict, gin.H{"error": "No se puede borrar: hay artículos en este departamento. Muévelos a otro primero."})
	case errors.Is(err, models.ErrInvDeptNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "Ese departamento ya no existe."})
	case err != nil:
		invFail(c, "DeleteDepartment", err, "No se pudo borrar el departamento.")
	default:
		c.JSON(http.StatusOK, gin.H{"ok": true})
	}
}

func bindInvCategory(c *gin.Context) (models.InvCategory, bool) {
	var in struct {
		DepartamentoID int64   `json:"departamento_id"`
		Nombre         string  `json:"nombre"`
		Comision       float64 `json:"comision"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos inválidos."})
		return models.InvCategory{}, false
	}
	n := models.NormalizeInvName(in.Nombre)
	switch {
	case in.DepartamentoID <= 0:
		c.JSON(http.StatusBadRequest, gin.H{"error": "Elige el departamento."})
		return models.InvCategory{}, false
	case n == "":
		c.JSON(http.StatusBadRequest, gin.H{"error": "Escribe el nombre de la categoría."})
		return models.InvCategory{}, false
	case len([]rune(n)) > 60:
		c.JSON(http.StatusBadRequest, gin.H{"error": "El nombre es muy largo (máximo 60 caracteres)."})
		return models.InvCategory{}, false
	case in.Comision < 0 || in.Comision > 100:
		c.JSON(http.StatusBadRequest, gin.H{"error": "La comisión va de 0 a 100 %."})
		return models.InvCategory{}, false
	}
	return models.InvCategory{DepartamentoID: in.DepartamentoID, Nombre: n, Comision: in.Comision}, true
}

func invCategoryErr(c *gin.Context, where string, err error, nombre string) {
	switch {
	case errors.Is(err, models.ErrInvCatDuplicate):
		c.JSON(http.StatusConflict, gin.H{"error": "Ya existe la categoría " + nombre + " en ese departamento."})
	case errors.Is(err, models.ErrInvDeptNotFound):
		c.JSON(http.StatusBadRequest, gin.H{"error": "Ese departamento ya no existe."})
	case errors.Is(err, models.ErrInvCatNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "Esa categoría ya no existe."})
	default:
		invFail(c, where, err, "No se pudo guardar la categoría.")
	}
}

// InvCreateCategory — POST /api/inventario/categorias {departamento_id, nombre, comision}
func InvCreateCategory(c *gin.Context) {
	cat, ok := bindInvCategory(c)
	if !ok {
		return
	}
	id, err := models.CreateInvCategory(invUserID(c), cat)
	if err != nil {
		invCategoryErr(c, "CreateCategory", err, cat.Nombre)
		return
	}
	cat.ID = id
	c.JSON(http.StatusCreated, gin.H{"categoria": cat})
}

// InvUpdateCategory — PUT /api/inventario/categorias/:id
func InvUpdateCategory(c *gin.Context) {
	id, ok := invID(c)
	if !ok {
		return
	}
	cat, ok := bindInvCategory(c)
	if !ok {
		return
	}
	cat.ID = id
	if err := models.UpdateInvCategory(invUserID(c), cat); err != nil {
		invCategoryErr(c, "UpdateCategory", err, cat.Nombre)
		return
	}
	c.JSON(http.StatusOK, gin.H{"categoria": cat})
}

// InvDeleteCategory — DELETE /api/inventario/categorias/:id
func InvDeleteCategory(c *gin.Context) {
	id, ok := invID(c)
	if !ok {
		return
	}
	err := models.DeleteInvCategory(invUserID(c), id)
	switch {
	case errors.Is(err, models.ErrInvCatInUse):
		c.JSON(http.StatusConflict, gin.H{"error": "No se puede borrar: hay artículos en esta categoría. Cámbialos de categoría primero."})
	case errors.Is(err, models.ErrInvCatNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "Esa categoría ya no existe."})
	case err != nil:
		invFail(c, "DeleteCategory", err, "No se pudo borrar la categoría.")
	default:
		c.JSON(http.StatusOK, gin.H{"ok": true})
	}
}

/* ---------------- ajustes (inventario físico) ---------------- */

func invRange(c *gin.Context) (string, string, bool) {
	desde, hasta := c.Query("desde"), c.Query("hasta")
	if desde == "" {
		desde = models.InvToday()
	}
	if hasta == "" {
		hasta = desde
	}
	if !invFechaRe.MatchString(desde) || !invFechaRe.MatchString(hasta) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Fechas inválidas."})
		return "", "", false
	}
	if desde > hasta {
		desde, hasta = hasta, desde
	}
	return desde, hasta, true
}

// InvListAdjustments — GET /api/inventario/ajustes?desde=&hasta=
func InvListAdjustments(c *gin.Context) {
	desde, hasta, ok := invRange(c)
	if !ok {
		return
	}
	items, err := models.ListInvAdjustments(invUserID(c), desde, hasta)
	if err != nil {
		invFail(c, "ListAdjustments", err, "No se pudieron cargar los ajustes.")
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "desde": desde, "hasta": hasta, "hoy": models.InvToday()})
}

// InvGetAdjustment — GET /api/inventario/ajustes/:id (id = folio del negocio)
func InvGetAdjustment(c *gin.Context) {
	folio, ok := invID(c)
	if !ok {
		return
	}
	d, err := models.GetInvAdjustment(invUserID(c), folio)
	if errors.Is(err, models.ErrInvAdjustmentMissing) {
		c.JSON(http.StatusNotFound, gin.H{"error": "No existe el ajuste " + strconv.FormatInt(folio, 10) + "."})
		return
	}
	if err != nil {
		invFail(c, "GetAdjustment", err, "No se pudo cargar el ajuste.")
		return
	}
	// share: liga del reporte para mandarlo por WhatsApp o correo.
	c.JSON(http.StatusOK, gin.H{"ajuste": d, "share": AdjustmentPublicPath(d.ID)})
}

// InvApplyAdjustment — POST /api/inventario/ajustes
// {comentario, lineas: [{item_id, contado}]}
func InvApplyAdjustment(c *gin.Context) {
	var in struct {
		Comentario string            `json:"comentario"`
		Lineas     []models.InvCount `json:"lineas"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos inválidos."})
		return
	}
	in.Comentario = strings.Join(strings.Fields(in.Comentario), " ")
	if len(in.Lineas) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Agrega al menos un artículo al conteo."})
		return
	}
	if len(in.Lineas) > 3000 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Son demasiados artículos para un solo ajuste (máximo 3000)."})
		return
	}
	if len([]rune(in.Comentario)) > 250 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "El comentario es muy largo."})
		return
	}
	for _, l := range in.Lineas {
		if l.ItemID <= 0 || l.Contado < 0 || l.Contado > 1000000 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Revisa las cantidades contadas (no pueden ser negativas)."})
			return
		}
	}
	r, err := models.ApplyPhysicalCount(invUserID(c), in.Lineas, in.Comentario, invUser(c))
	if err != nil {
		if strings.Contains(err.Error(), "quítalo") {
			c.JSON(http.StatusBadRequest, gin.H{"error": strings.ToUpper(err.Error()[:1]) + err.Error()[1:] + "."})
			return
		}
		invFail(c, "ApplyAdjustment", err, "No se pudo aplicar el ajuste.")
		return
	}
	invNotifyBots(invUserID(c))
	c.JSON(http.StatusCreated, gin.H{"ajuste": r})
}

/* ---------------- kárdex ---------------- */

// InvListMovements — GET /api/inventario/movimientos?item=&desde=&hasta=&tipo=&q=
func InvListMovements(c *gin.Context) {
	uid := invUserID(c)
	f := models.InvMovementFilter{Tipo: c.Query("tipo"), Q: strings.TrimSpace(c.Query("q"))}
	if s := c.Query("item"); s != "" {
		id, err := strconv.ParseInt(s, 10, 64)
		if err != nil || id <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Artículo inválido."})
			return
		}
		f.ItemID = id
	}
	switch f.Tipo {
	case "", models.InvMovInitial, models.InvMovIn, models.InvMovOut, models.InvMovAdjust, models.InvMovSale:
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "Tipo de movimiento inválido."})
		return
	}
	if c.Query("desde") != "" || c.Query("hasta") != "" {
		d, h, ok := invRange(c)
		if !ok {
			return
		}
		f.Desde, f.Hasta = d, h
	}
	// El reporte (PDF / Excel) pide todo el periodo: hasta 10,000 renglones.
	limit := 1000
	if c.Query("reporte") == "1" {
		limit = 10000
	}
	items, tot, err := models.ListInvMovements(uid, f, limit)
	if err != nil {
		invFail(c, "ListMovements", err, "No se pudieron cargar los movimientos.")
		return
	}
	resp := gin.H{"items": items, "totales": tot, "hoy": models.InvToday()}
	if f.ItemID > 0 {
		if a, err := models.GetInvItem(uid, f.ItemID); err == nil {
			invHideCost(c, a)
			resp["articulo"] = a
		}
	}
	c.JSON(http.StatusOK, resp)
}

/* ---------------- ópticas: tipos de armazón, colores y materiales ---------------- */

func invOnlyOptica(c *gin.Context) bool {
	if invIsOptica(invUserID(c)) {
		return true
	}
	c.JSON(http.StatusForbidden, gin.H{"error": "Disponible solo para ópticas."})
	return false
}

// InvFrameTypes — GET /api/inventario/tipos-armazon
func InvFrameTypes(c *gin.Context) {
	if !invOnlyOptica(c) {
		return
	}
	items, err := models.ListInvFrameTypes(invUserID(c))
	if err != nil {
		invFail(c, "FrameTypes", err, "No se pudieron cargar los tipos de armazón.")
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

// InvListColors — GET /api/inventario/colores (paleta).
func InvListColors(c *gin.Context) {
	if !invOnlyOptica(c) {
		return
	}
	items, err := models.ListInvColors(invUserID(c))
	if err != nil {
		invFail(c, "ListColors", err, "No se pudieron cargar los colores.")
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func invCapitalize(s string) string {
	if r := []rune(s); len(r) > 0 {
		return strings.ToUpper(string(r[0])) + string(r[1:])
	}
	return s
}

// InvCreateColor — POST /api/inventario/colores {nombre, hex}
func InvCreateColor(c *gin.Context) {
	if !invOnlyOptica(c) {
		return
	}
	var b struct {
		Nombre string `json:"nombre"`
		Hex    string `json:"hex"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos inválidos."})
		return
	}
	nombre := strings.Join(strings.Fields(strings.ReplaceAll(b.Nombre, ",", " ")), " ")
	if nombre == "" || len([]rune(nombre)) > 30 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Escribe el nombre del color (máximo 30 letras)."})
		return
	}
	nombre = invCapitalize(nombre)
	hex := strings.ToLower(strings.TrimSpace(b.Hex))
	if !invHexRe.MatchString(hex) {
		hex = "#888888"
	}
	col, err := models.CreateInvColor(invUserID(c), nombre, hex)
	if errors.Is(err, models.ErrInvColorTaken) {
		c.JSON(http.StatusConflict, gin.H{"error": "El color «" + nombre + "» ya está en la lista."})
		return
	}
	if err != nil {
		invFail(c, "CreateColor", err, "No se pudo agregar el color.")
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "item": col})
}

// InvListMaterials — GET /api/inventario/materiales
func InvListMaterials(c *gin.Context) {
	if !invOnlyOptica(c) {
		return
	}
	items, err := models.ListInvMaterials(invUserID(c))
	if err != nil {
		invFail(c, "ListMaterials", err, "No se pudieron cargar los materiales.")
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

// InvCreateMaterial — POST /api/inventario/materiales {nombre}
func InvCreateMaterial(c *gin.Context) {
	if !invOnlyOptica(c) {
		return
	}
	var b struct {
		Nombre string `json:"nombre"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos inválidos."})
		return
	}
	nombre := strings.Join(strings.Fields(strings.ReplaceAll(b.Nombre, ",", " ")), " ")
	if nombre == "" || len([]rune(nombre)) > 30 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Escribe el nombre del material (máximo 30 letras)."})
		return
	}
	nombre = invCapitalize(nombre)
	m, err := models.CreateInvMaterial(invUserID(c), nombre)
	if errors.Is(err, models.ErrInvMaterialTaken) {
		c.JSON(http.StatusConflict, gin.H{"error": "El material «" + nombre + "» ya está en la lista."})
		return
	}
	if err != nil {
		invFail(c, "CreateMaterial", err, "No se pudo agregar el material.")
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "item": m})
}
