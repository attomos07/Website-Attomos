package models

// laboratorio.go — Laboratorio (ópticas), portado de Avante.
//
// El tablero acomoda los pedidos confirmados por paso: A autorizar → En
// proceso → Corte → Control de calidad. "A autorizar" (clave "recibido") =
// estatus confirmed; los demás =
// estatus preparing ("En laboratorio") con su LabStep. Al terminar, el
// trabajo pasa a "Listo para recoger" (ready) y sale del tablero. El cliente
// ve el paso en /rastreo.

import (
	"errors"
	"strconv"
	"strings"
	"time"

	"attomos/config"

	"gorm.io/gorm"
)

/* ---------------- pasos del tablero ---------------- */

type LabStepInfo struct {
	Key       string `json:"key"`
	Label     string `json:"label"`
	Color     string `json:"color"`
	SortOrder int    `json:"sortOrder"`
	ID        int    `json:"id"`
}

const (
	LabStepRecibido = "recibido"
	LabStepProceso  = "en_proceso"
	LabStepCorte    = "corte"
	LabStepCalidad  = "control_calidad"
)

var labSteps = []LabStepInfo{
	{ID: 1, SortOrder: 1, Key: LabStepRecibido, Label: "A autorizar", Color: "#2563eb"},
	{ID: 2, SortOrder: 2, Key: LabStepProceso, Label: "En proceso", Color: "#ea580c"},
	{ID: 3, SortOrder: 3, Key: LabStepCorte, Label: "Corte", Color: "#7c3aed"},
	{ID: 4, SortOrder: 4, Key: LabStepCalidad, Label: "Control de calidad", Color: "#0891b2"},
}

// LabSteps — los pasos del tablero, en orden.
func LabSteps() []LabStepInfo { return append([]LabStepInfo(nil), labSteps...) }

// LabStepLabel — nombre del paso ("" si no existe).
func LabStepLabel(key string) string {
	for _, s := range labSteps {
		if s.Key == key {
			return s.Label
		}
	}
	return ""
}

// labStepOf — en qué columna va el pedido.
func labStepOf(o *Order) string {
	if o.Status == OrderStatusPreparing {
		if o.LabStep != "" && o.LabStep != LabStepRecibido && LabStepLabel(o.LabStep) != "" {
			return o.LabStep
		}
		return LabStepProceso
	}
	return LabStepRecibido
}

// LabStepLabelOf — el paso del tablero en que va el trabajo, como lo ve el
// cliente en Rastreo ("" si no está en laboratorio).
func LabStepLabelOf(o *Order) string {
	if o.Status != OrderStatusPreparing {
		return ""
	}
	return LabStepLabel(labStepOf(o))
}

/* ---------------- historial ---------------- */

// OrderStatusLog — cada cambio de estatus / paso de un pedido.
type OrderStatusLog struct {
	ID        uint      `gorm:"primaryKey" json:"-"`
	UserID    uint      `gorm:"not null;index" json:"-"`
	OrderID   uint      `gorm:"not null;index" json:"-"`
	Status    string    `gorm:"size:30" json:"status"`
	LabStep   string    `gorm:"size:30" json:"labStep"`
	By        string    `gorm:"size:120" json:"by"`
	CreatedAt time.Time `json:"at"`
}

func (OrderStatusLog) TableName() string { return "order_status_logs" }

// LogOrderStatus guarda un cambio (no falla la operación si no se puede).
func LogOrderStatus(userID, orderID uint, status, step, by string) {
	config.DB.Create(&OrderStatusLog{UserID: userID, OrderID: orderID, Status: status, LabStep: step, By: cut(by, 120)})
}

// ListOrderLogs — historial del pedido, el más reciente primero.
func ListOrderLogs(userID, orderID uint) ([]OrderStatusLog, error) {
	var out []OrderStatusLog
	err := config.DB.Where("user_id = ? AND order_id = ?", userID, orderID).Order("id DESC").Limit(100).Find(&out).Error
	return out, err
}

/* ---------------- trabajos ---------------- */

// LabOrder — lo que ve el tablero de cada trabajo.
type LabOrder struct {
	ID           uint       `json:"id"`
	OrderCode    string     `json:"orderCode"`
	ProductName  string     `json:"productName"`
	Quantity     int        `json:"quantity"`
	Total        float64    `json:"total"`
	RxOD         string     `json:"rxOD"`
	RxOI         string     `json:"rxOI"`
	CustomerName string     `json:"customerName"`
	Status       string     `json:"status"` // paso del tablero
	CreatedAt    time.Time  `json:"createdAt"`
	Clave        string     `json:"clave,omitempty"`
	Existencia   *int       `json:"existencia,omitempty"`
	Items        []string   `json:"items"`
	LabNotes     string     `json:"labNotes"`
	Notes        string     `json:"notes"`
	Origen       string     `json:"origen"` // sucursal | linea | laboratorio | panel
	Externo      bool       `json:"externo"`
	LastBy       string     `json:"lastBy,omitempty"`
	LastAt       *time.Time `json:"lastAt,omitempty"`
	Limpio       bool       `json:"limpio,omitempty"` // el laboratorio lo limpió de su columna
	Entrega      string     `json:"entrega"`          // fecha estimada "AAAA-MM-DD" ("" = sin fecha)
	Express      bool       `json:"express"`          // lente express (por ahora solo la etiqueta)
	// Optometría: la orden de laboratorio (hoja) del trabajo.
	Hoja      *LabHojaRef `json:"hoja,omitempty"`
	PosSaleID int64       `json:"posSaleId,omitempty"`
	SinHoja   bool        `json:"sinHoja,omitempty"` // el optometrista dijo que no lleva orden
	Directo   bool        `json:"directo,omitempty"` // salió de una orden hecha sin venta
}

func labOrigen(src OrderSource) string {
	switch src {
	case OrderSourcePOS:
		return "sucursal"
	case OrderSourceAgent, OrderSourceNinda:
		return "linea"
	case OrderSourceLab:
		return "laboratorio"
	}
	return "panel"
}

// ListLabOrders — los trabajos del tablero (confirmados o en laboratorio,
// que lleven algún producto que no sea servicio). Los que el laboratorio
// limpió de su columna solo vienen con limpios = true; limpiosN cuenta
// cuántos hay.
func ListLabOrders(userID uint, limpios bool) (out []LabOrder, limpiosN int, err error) {
	all, err := listLabOrders(userID)
	if err != nil {
		return nil, 0, err
	}
	out = make([]LabOrder, 0, len(all))
	for _, o := range all {
		if o.Limpio {
			limpiosN++
			if !limpios {
				continue
			}
		}
		out = append(out, o)
	}
	return out, limpiosN, nil
}

func listLabOrders(userID uint) ([]LabOrder, error) {
	var list []Order
	if err := config.DB.Where("user_id = ? AND status IN ?", userID,
		[]string{string(OrderStatusConfirmed), string(OrderStatusPreparing)}).
		Order("created_at DESC").Limit(500).Find(&list).Error; err != nil {
		return nil, err
	}
	// Artículos del inventario que aparecen (clave, existencia, ¿servicio?).
	type invInfo struct {
		clave    string
		stock    int
		servicio bool
	}
	ids := map[int64]bool{}
	for _, o := range list {
		for _, it := range o.Items {
			if it.ItemID > 0 {
				ids[it.ItemID] = true
			}
		}
	}
	inv := map[int64]invInfo{}
	if len(ids) > 0 {
		keys := make([]interface{}, 0, len(ids)+1)
		keys = append(keys, userID)
		ph := make([]string, 0, len(ids))
		for id := range ids {
			keys = append(keys, id)
			ph = append(ph, "?")
		}
		rows, err := invDB().Query("SELECT id, clave, existencia, servicio FROM inv_articulos WHERE user_id = ? AND id IN ("+strings.Join(ph, ",")+")", keys...)
		if err == nil {
			for rows.Next() {
				var id int64
				var x invInfo
				if rows.Scan(&id, &x.clave, &x.stock, &x.servicio) == nil {
					inv[id] = x
				}
			}
			rows.Close()
		}
	}
	// Último cambio de cada pedido.
	last := map[uint]OrderStatusLog{}
	if len(list) > 0 {
		oids := make([]uint, 0, len(list))
		for _, o := range list {
			oids = append(oids, o.ID)
		}
		var logs []OrderStatusLog
		config.DB.Where("user_id = ? AND id IN (SELECT MAX(id) FROM order_status_logs WHERE user_id = ? AND order_id IN ? GROUP BY order_id)", userID, userID, oids).Find(&logs)
		for _, l := range logs {
			last[l.OrderID] = l
		}
	}

	out := make([]LabOrder, 0, len(list))
	hojaInfo := make([]labOrderHojaInfo, 0, len(list))
	for i := range list {
		o := &list[i]
		// Solo servicios (ej. examen de la vista): no va al laboratorio.
		onlyServices := len(o.Items) > 0
		for _, it := range o.Items {
			x, ok := inv[it.ItemID]
			if it.ItemID <= 0 || !ok || !x.servicio {
				onlyServices = false
				break
			}
		}
		if onlyServices {
			continue
		}
		lo := LabOrder{
			ID: o.ID, OrderCode: o.TrackingCode, Total: o.Total, RxOD: o.RxOD, RxOI: o.RxOI,
			CustomerName: o.ClientName, Status: labStepOf(o), CreatedAt: o.CreatedAt,
			LabNotes: o.LabNotes, Notes: o.Notes, Origen: labOrigen(o.Source), Externo: o.LabExterno, Items: []string{},
			Limpio: o.LabLimpio, Express: o.LabExpress, SinHoja: o.LabSinHoja, Directo: o.LabDirecto,
		}
		if o.PosSaleID != nil {
			lo.PosSaleID = *o.PosSaleID
		}
		if o.LabDirecto {
			lo.Origen = "optometria"
		}
		hojaInfo = append(hojaInfo, labOrderHojaInfo{SheetID: i64(o.LabSheetID), Directo: o.LabDirecto, Name: o.ClientName, Phone: o.ClientPhone, CreatedAt: o.CreatedAt})
		if o.LabEntrega != nil {
			lo.Entrega = o.LabEntrega.Format("2006-01-02")
		}
		for j, it := range o.Items {
			q := it.Quantity
			if q <= 0 {
				q = 1
			}
			if j == 0 {
				lo.ProductName, lo.Quantity = it.Name, q
				if x, ok := inv[it.ItemID]; ok && it.ItemID > 0 {
					lo.Clave = x.clave
					st := x.stock
					lo.Existencia = &st
				}
			}
			lo.Items = append(lo.Items, it.Name)
		}
		if len(o.Items) > 1 {
			lo.ProductName += " + " + plural(len(o.Items)-1, "otro", "otros")
		}
		if lo.ProductName == "" {
			lo.ProductName = "Pedido sin productos"
		}
		if l, ok := last[o.ID]; ok {
			at := l.CreatedAt
			lo.LastBy, lo.LastAt = l.By, &at
		}
		out = append(out, lo)
	}
	// La orden de laboratorio de cada trabajo (ligada o encontrada sola).
	for i, h := range matchLabHojas(userID, hojaInfo) {
		out[i].Hoja = h
	}
	return out, nil
}

func plural(n int, one, many string) string {
	if n == 1 {
		return "1 " + one
	}
	return strconv.Itoa(n) + " " + many
}

var ErrLabOrderNotFound = errors.New("ese trabajo ya no existe")

func labGetOrder(userID, id uint) (*Order, error) {
	var o Order
	if err := config.DB.Where("id = ? AND user_id = ?", id, userID).First(&o).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrLabOrderNotFound
		}
		return nil, err
	}
	return &o, nil
}

// SetLabStep mueve el trabajo a un paso del tablero, o a "ready" (Listo
// para recoger: sale del tablero).
func SetLabStep(userID, id uint, step, by string) (*Order, error) {
	o, err := labGetOrder(userID, id)
	if err != nil {
		return nil, err
	}
	upd := map[string]interface{}{"lab_limpio": false} // al moverlo vuelve al tablero
	switch {
	case step == string(OrderStatusReady):
		upd["status"] = OrderStatusReady
	case step == LabStepRecibido:
		upd["status"], upd["lab_step"] = OrderStatusConfirmed, LabStepRecibido
	case LabStepLabel(step) != "":
		upd["status"], upd["lab_step"] = OrderStatusPreparing, step
	default:
		return nil, errors.New("ese paso no existe")
	}
	if err := config.DB.Model(o).Updates(upd).Error; err != nil {
		return nil, err
	}
	LogOrderStatus(userID, o.ID, string(o.Status), step, by)
	return o, nil
}

// ClearLabColumn — "Limpiar columna": los trabajos de ese paso salen del
// tablero del laboratorio (no se borran ni cambian de paso).
func ClearLabColumn(userID uint, step string) (int, error) {
	list, err := listLabOrders(userID)
	if err != nil {
		return 0, err
	}
	var ids []uint
	for _, o := range list {
		if o.Status == step && !o.Limpio {
			ids = append(ids, o.ID)
		}
	}
	if len(ids) == 0 {
		return 0, nil
	}
	res := config.DB.Model(&Order{}).Where("user_id = ? AND id IN ?", userID, ids).Update("lab_limpio", true)
	return int(res.RowsAffected), res.Error
}

// SetLabEntrega — fecha estimada de entrega ("AAAA-MM-DD"; "" la quita).
func SetLabEntrega(userID, id uint, date string) error {
	if _, err := labGetOrder(userID, id); err != nil {
		return err
	}
	var v interface{}
	if date != "" {
		t, err := time.ParseInLocation("2006-01-02", date, time.Local)
		if err != nil {
			return err
		}
		v = t
	}
	return config.DB.Model(&Order{}).Where("id = ? AND user_id = ?", id, userID).Update("lab_entrega", v).Error
}

// SetLabExpress — marca o desmarca el trabajo como lente express.
func SetLabExpress(userID, id uint, on bool) error {
	if _, err := labGetOrder(userID, id); err != nil {
		return err
	}
	return config.DB.Model(&Order{}).Where("id = ? AND user_id = ?", id, userID).Update("lab_express", on).Error
}

// SetLabNotes / SetLabExterno — datos del laboratorio.
func SetLabNotes(userID, id uint, notes string) error {
	res := config.DB.Model(&Order{}).Where("id = ? AND user_id = ?", id, userID).Update("lab_notes", notes)
	if res.Error == nil && res.RowsAffected == 0 {
		if _, err := labGetOrder(userID, id); err != nil {
			return err
		}
	}
	return res.Error
}

func SetLabExterno(userID, id uint, on bool) error {
	if _, err := labGetOrder(userID, id); err != nil {
		return err
	}
	return config.DB.Model(&Order{}).Where("id = ? AND user_id = ?", id, userID).Update("lab_externo", on).Error
}

// FindLabOrderByCode — para el escáner (la clave del ticket).
func FindLabOrderByCode(userID uint, code string) (*LabOrder, error) {
	code = NormalizeTrackingCode(code)
	list, err := listLabOrders(userID)
	if err != nil {
		return nil, err
	}
	for i := range list {
		if list[i].OrderCode != "" && NormalizeTrackingCode(list[i].OrderCode) == code {
			return &list[i], nil
		}
	}
	return nil, ErrLabOrderNotFound
}
