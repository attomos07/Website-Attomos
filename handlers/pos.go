package handlers

// pos.go — Punto de venta (sidebar → Punto de venta), portado del Punto de
// venta de Avante Optics. 3 pestañas: Punto de venta, Ventas y Corte de caja.
//
//	GET  /pos                                  → /pos/punto-de-venta
//	GET  /pos/punto-de-venta | /pos/consultas | /pos/ventas | /pos/corte-de-caja | /pos/plantillas
//
//	GET    /api/pos/inventario?q=              buscar en el Inventario (para vender)
//	GET    /api/pos/clientes?q=                buscar clientes (con su saldo)
//	GET    /api/pos/clientes/siguiente         siguiente No. de cliente
//	POST   /api/pos/clientes                   nuevo cliente
//	PUT    /api/pos/clientes/:id               editar cliente
//	GET    /api/pos/clientes/:id/creditos      créditos y abonos del cliente
//	GET    /api/pos/clientes/:id/ultima-venta  último ticket del cliente
//	GET    /api/pos/ventas?desde=&hasta=&q=&estado=
//	GET    /api/pos/ventas/:id                 detalle (id = folio del ticket)
//	POST   /api/pos/ventas                     cobrar (descuenta inventario)
//	POST   /api/pos/ventas/:id/cancelar        {motivo}
//	POST   /api/pos/creditos/:id/abonos        abonar a un crédito
//	DELETE /api/pos/abonos/:id                 cancelar un abono (mismo día)
//	GET/PUT /api/pos/ticket-plantilla          plantilla del ticket
//
// Corte de caja: ver pos_caja.go. Ticket digital (público): pos_ticket.go.

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"attomos/config"
	"attomos/models"

	"github.com/gin-gonic/gin"
)

var (
	posNumeroRe  = regexp.MustCompile(`^[A-Za-z0-9-]{1,20}$`)
	posCelularRe = regexp.MustCompile(`^\d{10}$`)
	posDateRe    = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
)

// posCashier — quien cobra (hoy el dueño; con empleados, el empleado).
func posCashier(c *gin.Context) string { return invUser(c) }

func posID(c *gin.Context) (int64, bool) { return invID(c) }

func posFail(c *gin.Context, where string, err error, msg string) {
	log.Printf("pos.%s: %v", where, err)
	c.JSON(http.StatusInternalServerError, gin.H{"error": msg})
}

/* ---------------- datos del negocio para el ticket ---------------- */

// posBusiness — encabezado por defecto del ticket (sale de Mi Negocio,
// sucursal principal). El negocio lo puede cambiar con la plantilla.
type posBusiness struct {
	Nombre    string `json:"nombre"`
	Direccion string `json:"direccion"`
	Ciudad    string `json:"ciudad"`
	CP        string `json:"cp"`
	Correo    string `json:"correo"`
	Telefono  string `json:"telefono"`
	Logo      string `json:"logo"`
}

func posBusinessInfo(userID uint) posBusiness {
	out := posBusiness{Nombre: invBusinessName(userID)}
	var b models.MyBusinessInfo
	if err := config.DB.Where("user_id = ?", userID).Order("branch_number ASC").First(&b).Error; err == nil {
		l := b.Location
		dir := strings.TrimSpace(strings.Join(strings.Fields(l.Address+" "+l.Number), " "))
		if l.Neighborhood != "" {
			dir = strings.TrimSpace(dir + " " + l.Neighborhood)
		}
		ciudad := l.City
		if l.State != "" {
			if ciudad != "" {
				ciudad += ", "
			}
			ciudad += l.State
		}
		out.Direccion, out.Ciudad, out.CP = dir, ciudad, l.PostalCode
		out.Correo, out.Telefono, out.Logo = b.Email, b.PhoneNumber, b.LogoURL
	}
	return out
}

/* ---------------- páginas ---------------- */

func posPage(tab string) gin.HandlerFunc {
	return func(c *gin.Context) {
		uid := invUserID(c)
		biz, _ := json.Marshal(posBusinessInfo(uid))
		c.HTML(http.StatusOK, "pos.html", gin.H{
			"PosTab":      tab,
			"Caja":        models.CajaDefault,
			"VeCalculado": cajaVeCalculado(c),
			// Sin empleados todavía: no hay permiso de "recepción ve lo
			// calculado" que configurar (el dueño siempre lo ve).
			"EsAdmin":     false,
			"StaffName":   posCashier(c),
			"MailFrom":    mailService().From(),
			"MailEnabled": mailService().Enabled(),
			"BizJSON":     string(biz),
			"Optica":      invIsOptica(uid),
		})
	}
}

var (
	PosSalePage  = posPage("punto-de-venta")
	PosSalesPage = posPage("ventas")
	PosCajaPage  = posPage("corte-de-caja")
	// Consultas: precio y existencia para el mostrador (usa /api/pos/inventario).
	PosConsultasPage = posPage("consultas")
	// Plantillas: editor del ticket (usa /api/pos/ticket-plantilla).
	PosPlantillasPage = posPage("plantillas")
)

/* ---------------- inventario ---------------- */

// PosSearchInventory — GET /api/pos/inventario?q=
func PosSearchInventory(c *gin.Context) {
	items, err := models.SearchPosInventory(invUserID(c), c.Query("q"), 300)
	if err != nil {
		posFail(c, "SearchInventory", err, "No se pudo buscar en el inventario.")
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

/* ---------------- clientes ---------------- */

// PosListClients — GET /api/pos/clientes?q=
func PosListClients(c *gin.Context) {
	items, err := models.ListPosClients(invUserID(c), c.Query("q"), 60)
	if err != nil {
		posFail(c, "ListClients", err, "No se pudieron cargar los clientes.")
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "hoy": models.PosToday()})
}

// PosNextClientNumero — GET /api/pos/clientes/siguiente
func PosNextClientNumero(c *gin.Context) {
	n, err := models.NextPosClientNumero(invUserID(c))
	if err != nil {
		log.Printf("pos.NextClientNumero: %v", err)
	}
	c.JSON(http.StatusOK, gin.H{"numero": n})
}

type posClientInput struct {
	Numero        string  `json:"numero"`
	Clave         string  `json:"clave"`
	Nombre        string  `json:"nombre"`
	Celular       string  `json:"celular"`
	Representante string  `json:"representante"`
	Dias          int     `json:"dias"`
	Limite        float64 `json:"limite"`
}

func bindPosClient(c *gin.Context) (models.PosClient, bool) {
	var in posClientInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos inválidos."})
		return models.PosClient{}, false
	}
	in.Numero = strings.TrimSpace(in.Numero)
	in.Nombre = strings.Join(strings.Fields(in.Nombre), " ")
	in.Clave = strings.ToUpper(strings.TrimSpace(in.Clave))
	in.Celular = strings.TrimSpace(in.Celular)
	bad := func(msg string) (models.PosClient, bool) {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return models.PosClient{}, false
	}
	switch {
	case !posNumeroRe.MatchString(in.Numero):
		return bad("El No. de cliente solo puede llevar letras, números y guiones.")
	case in.Nombre == "" || len([]rune(in.Nombre)) > 120:
		return bad("Escribe el nombre del cliente.")
	case len([]rune(in.Clave)) > 30:
		return bad("La clave es muy larga.")
	case in.Celular != "" && !posCelularRe.MatchString(in.Celular):
		return bad("El celular debe tener 10 dígitos.")
	case in.Dias < 0 || in.Dias > 365 || in.Limite < 0 || in.Limite > 99999999:
		return bad("Revisa los días y el límite de crédito.")
	}
	rep := strings.TrimSpace(in.Representante)
	if len([]rune(rep)) > 120 {
		rep = string([]rune(rep)[:120])
	}
	return models.PosClient{
		Numero: in.Numero, Clave: in.Clave, Nombre: in.Nombre, Celular: in.Celular,
		Representante: rep, DiasCredito: in.Dias, LimiteCredito: in.Limite,
	}, true
}

// PosCreateClient — POST /api/pos/clientes
func PosCreateClient(c *gin.Context) {
	in, ok := bindPosClient(c)
	if !ok {
		return
	}
	cl, err := models.CreatePosClient(invUserID(c), in, posCashier(c))
	if errors.Is(err, models.ErrPosClientDuplicate) {
		c.JSON(http.StatusConflict, gin.H{"error": "Ya existe el cliente No. " + in.Numero + "."})
		return
	}
	if err != nil {
		posFail(c, "CreateClient", err, "No se pudo guardar el cliente.")
		return
	}
	c.JSON(http.StatusCreated, gin.H{"item": cl})
}

// PosUpdateClient — PUT /api/pos/clientes/:id
func PosUpdateClient(c *gin.Context) {
	id, ok := posID(c)
	if !ok {
		return
	}
	in, ok := bindPosClient(c)
	if !ok {
		return
	}
	cl, err := models.UpdatePosClient(invUserID(c), id, in)
	switch {
	case errors.Is(err, models.ErrPosClientDuplicate):
		c.JSON(http.StatusConflict, gin.H{"error": "Ya existe otro cliente con el No. " + in.Numero + "."})
	case errors.Is(err, models.ErrPosClientNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "Ese cliente ya no existe."})
	case err != nil:
		posFail(c, "UpdateClient", err, "No se pudieron guardar los cambios.")
	default:
		c.JSON(http.StatusOK, gin.H{"item": cl})
	}
}

// PosClientCredits — GET /api/pos/clientes/:id/creditos
func PosClientCredits(c *gin.Context) {
	id, ok := posID(c)
	if !ok {
		return
	}
	uid := invUserID(c)
	cl, err := models.GetPosClient(uid, id)
	if errors.Is(err, models.ErrPosClientNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "Ese cliente ya no existe."})
		return
	}
	if err != nil {
		posFail(c, "ClientCredits", err, "No se pudo cargar el cliente.")
		return
	}
	credits, err := models.ListPosClientCredits(uid, id)
	if err != nil {
		posFail(c, "ClientCredits", err, "No se pudieron cargar los créditos.")
		return
	}
	c.JSON(http.StatusOK, gin.H{"cliente": cl, "creditos": credits, "hoy": models.PosToday()})
}

// PosClientLastSale — GET /api/pos/clientes/:id/ultima-venta
func PosClientLastSale(c *gin.Context) {
	id, ok := posID(c)
	if !ok {
		return
	}
	d, err := models.LastPosSaleOfClient(invUserID(c), id)
	if errors.Is(err, models.ErrPosSaleNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "Este cliente todavía no tiene ventas."})
		return
	}
	if err != nil {
		posFail(c, "ClientLastSale", err, "No se pudo cargar su última venta.")
		return
	}
	c.JSON(http.StatusOK, gin.H{"venta": d})
}

/* ---------------- ventas ---------------- */

// PosCreateSale — POST /api/pos/ventas
func PosCreateSale(c *gin.Context) {
	var in struct {
		ClientID   int64                `json:"client_id"`
		Items      []models.PosSaleItem `json:"productos"`
		Pagos      models.PosPayments   `json:"pagos"`
		Referencia string               `json:"referencia"`
		Propina    float64              `json:"propina"`
		PropinaFP  string               `json:"propina_forma"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || len(in.Items) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "La venta no trae productos."})
		return
	}
	if len(in.Items) > 300 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Son demasiados renglones para una sola venta."})
		return
	}
	for _, it := range in.Items {
		if it.Cantidad > 100000 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Revisa las cantidades."})
			return
		}
	}
	ref := strings.TrimSpace(in.Referencia)
	if len(ref) > 80 {
		ref = ref[:80]
	}
	uid := invUserID(c)
	sale, err := models.CreatePosSale(uid, models.PosSale{
		ClientID: in.ClientID, Cajero: posCashier(c), Items: in.Items, Pagos: in.Pagos, Referencia: ref,
		Propina: in.Propina, PropinaForma: in.PropinaFP,
	})
	if err != nil {
		var se *models.PosStockError
		switch {
		case errors.As(err, &se):
			c.JSON(http.StatusConflict, gin.H{"error": "Solo hay " + strconv.Itoa(se.Disponible) + " en existencia de " + se.Descripcion + "."})
		case errors.Is(err, models.ErrPosClientNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "Ese cliente ya no existe."})
		case errors.Is(err, models.ErrPosCreditLimit):
			c.JSON(http.StatusBadRequest, gin.H{"error": "El crédito pasa del límite del cliente (" + strings.TrimPrefix(err.Error(), models.ErrPosCreditLimit.Error()+": ") + ")."})
		case strings.HasPrefix(err.Error(), "tarjeta") || strings.HasPrefix(err.Error(), "falta") ||
			strings.HasPrefix(err.Error(), "para dejar") || strings.HasPrefix(err.Error(), "un producto") ||
			strings.HasPrefix(err.Error(), "la propina"):
			msg := err.Error()
			c.JSON(http.StatusBadRequest, gin.H{"error": strings.ToUpper(msg[:1]) + msg[1:] + "."})
		default:
			posFail(c, "CreateSale", err, "No se pudo guardar la venta. Intenta de nuevo.")
		}
		return
	}
	// La existencia cambió: los bots ofrecen el catálogo del Inventario.
	invNotifyBots(uid)
	c.JSON(http.StatusCreated, gin.H{"venta": sale})
}

// PosListSales — GET /api/pos/ventas?desde=&hasta=&q=&estado= (sin fechas: hoy)
func PosListSales(c *gin.Context) {
	f := models.PosSalesFilter{Desde: c.Query("desde"), Hasta: c.Query("hasta"), Q: c.Query("q"), Estado: c.Query("estado")}
	if f.Desde == "" && f.Hasta == "" {
		f.Desde, f.Hasta = models.PosToday(), models.PosToday()
	}
	if (f.Desde != "" && !posDateRe.MatchString(f.Desde)) || (f.Hasta != "" && !posDateRe.MatchString(f.Hasta)) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Fechas inválidas."})
		return
	}
	items, totals, err := models.ListPosSales(invUserID(c), f, 1000)
	if err != nil {
		posFail(c, "ListSales", err, "No se pudieron cargar las ventas.")
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "totales": totals, "hoy": models.PosToday(), "desde": f.Desde, "hasta": f.Hasta})
}

// PosGetSale — GET /api/pos/ventas/:id (id = folio del ticket)
func PosGetSale(c *gin.Context) {
	folio, ok := posID(c)
	if !ok {
		return
	}
	uid := invUserID(c)
	d, err := models.GetPosSale(uid, folio)
	if errors.Is(err, models.ErrPosSaleNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "No existe el ticket " + strconv.FormatInt(folio, 10) + "."})
		return
	}
	if err != nil {
		posFail(c, "GetSale", err, "No se pudo cargar la venta.")
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"venta":       d,
		"ticket_url":  TicketPublicPath(uid, d.Folio),
		"cliente_tel": models.PosClientPhone(uid, d.ClientID),
	})
}

// PosCancelSale — POST /api/pos/ventas/:id/cancelar {motivo}
func PosCancelSale(c *gin.Context) {
	folio, ok := posID(c)
	if !ok {
		return
	}
	var in struct {
		Motivo string `json:"motivo"`
	}
	_ = c.ShouldBindJSON(&in)
	uid := invUserID(c)
	err := models.CancelPosSale(uid, folio, posCashier(c), in.Motivo)
	switch {
	case errors.Is(err, models.ErrPosSaleNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "No existe ese ticket."})
	case errors.Is(err, models.ErrPosVentaCancelada), errors.Is(err, models.ErrPosVentaConAbonos), errors.Is(err, models.ErrPosMotivoRequerido):
		msg := err.Error()
		c.JSON(http.StatusBadRequest, gin.H{"error": strings.ToUpper(msg[:1]) + msg[1:] + "."})
	case err != nil:
		posFail(c, "CancelSale", err, "No se pudo cancelar la venta.")
	default:
		invNotifyBots(uid)
		c.JSON(http.StatusOK, gin.H{"ok": true})
	}
}

/* ---------------- créditos y abonos ---------------- */

// PosAddPayment — POST /api/pos/creditos/:id/abonos
func PosAddPayment(c *gin.Context) {
	id, ok := posID(c)
	if !ok {
		return
	}
	var in struct {
		Monto      float64 `json:"monto"`
		FormaPago  string  `json:"forma_pago"`
		Referencia string  `json:"referencia"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.Monto <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Escribe cuánto abona."})
		return
	}
	if !models.IsPosFormaPago(in.FormaPago) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Elige la forma de pago."})
		return
	}
	ref := strings.TrimSpace(in.Referencia)
	if len(ref) > 80 {
		ref = ref[:80]
	}
	r, err := models.AddPosCreditPayment(invUserID(c), id, in.Monto, in.FormaPago, ref, posCashier(c))
	switch {
	case errors.Is(err, models.ErrPosCreditNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "Ese crédito ya no existe."})
	case errors.Is(err, models.ErrPosPaymentTooBig):
		c.JSON(http.StatusBadRequest, gin.H{"error": "El abono no puede ser mayor que el saldo."})
	case err != nil:
		posFail(c, "AddPayment", err, "No se pudo guardar el abono.")
	default:
		c.JSON(http.StatusCreated, r)
	}
}

// PosCancelPayment — DELETE /api/pos/abonos/:id
func PosCancelPayment(c *gin.Context) {
	id, ok := posID(c)
	if !ok {
		return
	}
	r, err := models.CancelPosCreditPayment(invUserID(c), id, posCashier(c))
	switch {
	case errors.Is(err, models.ErrPosPaymentNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "Ese abono ya no existe."})
	case errors.Is(err, models.ErrPosPaymentNotToday):
		c.JSON(http.StatusBadRequest, gin.H{"error": "Solo se pueden cancelar abonos del mismo día."})
	case errors.Is(err, models.ErrPosPaymentCancelled):
		c.JSON(http.StatusBadRequest, gin.H{"error": "Ese abono ya estaba cancelado."})
	case err != nil:
		posFail(c, "CancelPayment", err, "No se pudo cancelar el abono.")
	default:
		c.JSON(http.StatusOK, r)
	}
}

/* ---------------- plantilla del ticket ---------------- */

const posTicketTemplateMax = 200 << 10

// PosGetTicketTemplate — GET /api/pos/ticket-plantilla
func PosGetTicketTemplate(c *gin.Context) {
	data, by, at, err := models.GetPosTicketTemplate(invUserID(c))
	if err != nil {
		posFail(c, "GetTicketTemplate", err, "No se pudo cargar la plantilla del ticket.")
		return
	}
	if data == "" {
		c.JSON(http.StatusOK, gin.H{"data": nil})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": json.RawMessage(data), "updated_at": at, "updated_by": by})
}

// PosSaveTicketTemplate — PUT /api/pos/ticket-plantilla {data:{…}}
func PosSaveTicketTemplate(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, posTicketTemplateMax+1024)
	var body struct {
		Data json.RawMessage `json:"data"`
	}
	var probe map[string]interface{}
	if err := c.ShouldBindJSON(&body); err != nil || len(body.Data) == 0 || json.Unmarshal(body.Data, &probe) != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "La plantilla no es válida."})
		return
	}
	if len(body.Data) > posTicketTemplateMax {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "La plantilla es demasiado grande."})
		return
	}
	if err := models.SavePosTicketTemplate(invUserID(c), string(body.Data), posCashier(c)); err != nil {
		posFail(c, "SaveTicketTemplate", err, "No se pudo guardar la plantilla.")
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
