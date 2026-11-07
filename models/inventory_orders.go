package models

// inventory_orders.go — Pedidos ↔ Inventario y clave de rastreo.
//
//   - Los pedidos (del bot, de Comy o capturados en Mis ventas) descuentan
//     del Inventario lo que llevan y lo dejan en el kárdex (tipo "pedido").
//     Cada renglón se liga al artículo por su id (Comy) o por su nombre /
//     clave (bot y panel). Si se cancela o se borra el pedido, regresa.
//   - Clave de rastreo: cada pedido lleva una (AT + 6 letras/números) con la
//     que el cliente consulta cómo va en /rastreo.
//   - Ópticas: cada venta del Punto de venta que lleva productos (no
//     servicios ni artículos marcados "sin clave de rastreo") abre un pedido
//     con su clave, igual que en Avante. Ese pedido NO toca el inventario
//     (la venta ya lo descontó).

import (
	"crypto/rand"
	"database/sql"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	"attomos/config"

	"gorm.io/gorm"
)

/* =========================================================
   INVENTARIO DE LOS PEDIDOS
   ========================================================= */

// invFindForOrder busca (y bloquea) el artículo de un renglón del pedido.
func invFindForOrder(tx *sql.Tx, userID uint, it OrderItem) (id int64, desc string, stock int, servicio bool, err error) {
	if it.ItemID > 0 {
		err = tx.QueryRow("SELECT id, descripcion, existencia, servicio FROM inv_articulos WHERE id = ? AND user_id = ? FOR UPDATE", it.ItemID, userID).
			Scan(&id, &desc, &stock, &servicio)
		if err == nil || !errors.Is(err, sql.ErrNoRows) {
			return
		}
	}
	name := strings.Join(strings.Fields(it.Name), " ")
	if name == "" {
		return 0, "", 0, false, sql.ErrNoRows
	}
	err = tx.QueryRow(`SELECT id, descripcion, existencia, servicio FROM inv_articulos
		WHERE user_id = ? AND (UPPER(descripcion) = UPPER(?) OR clave = ? OR (clave_alterna <> '' AND clave_alterna = ?))
		ORDER BY servicio ASC, id ASC LIMIT 1 FOR UPDATE`, userID, name, NormalizeInvClave(name), NormalizeInvClave(name)).
		Scan(&id, &desc, &stock, &servicio)
	return
}

// ApplyOrderStock descuenta del Inventario lo que lleva el pedido. Llena
// ItemID y StockOut de cada renglón. No deja la existencia en negativo: si
// no alcanza, descuenta lo que hay y lo anota en el kárdex. Regresa si se
// descontó algo.
func ApplyOrderStock(userID uint, orderID uint, items OrderItems, usuario string) (bool, error) {
	db := invDB()
	if db == nil || len(items) == 0 {
		return false, nil
	}
	tx, err := db.Begin()
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	now := invNow()
	applied := false
	for i := range items {
		it := &items[i]
		it.StockOut = 0
		q := it.Quantity
		if q <= 0 {
			q = 1
		}
		id, _, stock, servicio, err := invFindForOrder(tx, userID, *it)
		if errors.Is(err, sql.ErrNoRows) {
			continue // no está en el inventario: no se descuenta nada
		}
		if err != nil {
			return false, err
		}
		it.ItemID = id
		if servicio {
			continue
		}
		out := q
		if stock < out {
			out = stock
		}
		if out <= 0 {
			continue
		}
		coment := fmt.Sprintf("Pedido #%d", orderID)
		if out < q {
			coment += fmt.Sprintf(" (faltaron %d)", q-out)
		}
		if _, err := tx.Exec("UPDATE inv_articulos SET existencia = existencia - ?, updated_at = ? WHERE id = ? AND user_id = ?", out, now, id, userID); err != nil {
			return false, err
		}
		if _, err := tx.Exec(
			`INSERT INTO inv_movimientos (user_id, item_id, tipo, cantidad, existencia_antes, existencia_despues, comentario, usuario, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			userID, id, InvMovOrder, -out, stock, stock-out, cut(coment, 255), cut(usuario, 120), now,
		); err != nil {
			return false, err
		}
		it.StockOut = out
		applied = true
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	return applied, nil
}

// ReturnOrderStock regresa al Inventario lo que el pedido había descontado
// (al cancelarlo o borrarlo).
func ReturnOrderStock(userID uint, orderID uint, items OrderItems, motivo, usuario string) error {
	db := invDB()
	if db == nil {
		return nil
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	now := invNow()
	for i := range items {
		it := &items[i]
		if it.ItemID <= 0 || it.StockOut <= 0 {
			continue
		}
		var stock int
		err := tx.QueryRow("SELECT existencia FROM inv_articulos WHERE id = ? AND user_id = ? FOR UPDATE", it.ItemID, userID).Scan(&stock)
		if errors.Is(err, sql.ErrNoRows) {
			it.StockOut = 0
			continue
		}
		if err != nil {
			return err
		}
		if _, err := tx.Exec("UPDATE inv_articulos SET existencia = existencia + ?, updated_at = ? WHERE id = ? AND user_id = ?", it.StockOut, now, it.ItemID, userID); err != nil {
			return err
		}
		if _, err := tx.Exec(
			`INSERT INTO inv_movimientos (user_id, item_id, tipo, cantidad, existencia_antes, existencia_despues, comentario, usuario, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			userID, it.ItemID, InvMovOrder, it.StockOut, stock, stock+it.StockOut, cut(fmt.Sprintf("Pedido #%d %s", orderID, motivo), 255), cut(usuario, 120), now,
		); err != nil {
			return err
		}
		it.StockOut = 0
	}
	return tx.Commit()
}

/* =========================================================
   CLAVE DE RASTREO
   ========================================================= */

const trackingAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

// NewTrackingCode — clave nueva (AT + 6), que no use ningún otro pedido.
func NewTrackingCode() (string, error) {
	for try := 0; try < 20; try++ {
		b := make([]byte, 6)
		for i := range b {
			n, err := rand.Int(rand.Reader, big.NewInt(int64(len(trackingAlphabet))))
			if err != nil {
				return "", err
			}
			b[i] = trackingAlphabet[n.Int64()]
		}
		code := "AT" + string(b)
		var n int64
		if err := config.DB.Model(&Order{}).Unscoped().Where("tracking_code = ?", code).Count(&n).Error; err != nil {
			return "", err
		}
		if n == 0 {
			return code, nil
		}
	}
	return "", errors.New("no se pudo generar la clave de rastreo")
}

// NormalizeTrackingCode — mayúsculas y solo letras/números (el escáner o el
// cliente pueden escribir "at-7k3p9q").
func NormalizeTrackingCode(s string) string {
	var b strings.Builder
	for _, r := range strings.ToUpper(s) {
		if (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		}
	}
	return b.String()
}

/* =========================================================
   ESTATUS DE LOS PEDIDOS (Mis ventas · Ventas · Rastreo)
   ========================================================= */

type OrderStatusInfo struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Color string `json:"color"`
	Hint  string `json:"hint,omitempty"`
}

// OrderStatusList — los estatus en orden, con nombres según el giro.
func OrderStatusList(optica bool) []OrderStatusInfo {
	prep, prepHint := "En preparación", "Estamos preparando tu pedido."
	ready, readyHint := "Listo", "Tu pedido está listo."
	if optica {
		prep, prepHint = "En laboratorio", "Tus lentes se están fabricando."
		ready, readyHint = "Listo para recoger", "Ya puedes pasar por tus lentes."
	}
	return []OrderStatusInfo{
		{Key: string(OrderStatusPending), Label: "Pendiente", Color: "#d97706", Hint: "Recibimos tu pedido; falta confirmarlo."},
		{Key: string(OrderStatusConfirmed), Label: "Recibido", Color: "#2563eb", Hint: "Tu pedido está confirmado."},
		{Key: string(OrderStatusPreparing), Label: prep, Color: "#7c3aed", Hint: prepHint},
		{Key: string(OrderStatusReady), Label: ready, Color: "#0891b2", Hint: readyHint},
		{Key: string(OrderStatusDelivered), Label: "Entregado", Color: "#16a34a", Hint: "¡Listo! Ya se entregó."},
		{Key: string(OrderStatusCancelled), Label: "Cancelado", Color: "#dc2626", Hint: "Este pedido se canceló."},
	}
}

// IsOrderStatusKey — ¿es un estatus válido?
func IsOrderStatusKey(k string) bool {
	for _, s := range OrderStatusList(false) {
		if s.Key == k {
			return true
		}
	}
	return false
}

/* =========================================================
   PEDIDO DE UNA VENTA DEL PUNTO DE VENTA (ópticas)
   ========================================================= */

// PosPedido — el pedido de una venta.
type PosPedido struct {
	ID     uint   `json:"id"`
	Code   string `json:"code"`
	Status string `json:"status"`
}

var ErrPosPedidoSinProductos = errors.New("esta venta solo tiene servicios o artículos sin clave de rastreo: no lleva pedido")

// GetPosPedido — el pedido de esa venta (nil si no tiene). saleID = id interno.
func GetPosPedido(userID uint, saleID int64) (*PosPedido, error) {
	var o Order
	err := config.DB.Select("id, tracking_code, status").Where("user_id = ? AND pos_sale_id = ?", userID, saleID).Order("id").First(&o).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &PosPedido{ID: o.ID, Code: o.TrackingCode, Status: string(o.Status)}, nil
}

// PosSaleInternalID — id interno de la venta a partir de su folio.
func PosSaleInternalID(userID uint, folio int64) (int64, error) {
	var id int64
	err := posDB().QueryRow("SELECT id FROM pos_sales WHERE user_id = ? AND folio = ?", userID, folio).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrPosSaleNotFound
	}
	return id, err
}

// CreatePosPedido abre el pedido de la venta (si ya tiene, regresa ese).
func CreatePosPedido(userID uint, saleID int64) (*PosPedido, error) {
	if p, err := GetPosPedido(userID, saleID); err != nil || p != nil {
		return p, err
	}
	db := posDB()
	var folio int64
	var cliente string
	var clientID sql.NullInt64
	if err := db.QueryRow("SELECT folio, cliente, client_id FROM pos_sales WHERE id = ? AND user_id = ?", saleID, userID).Scan(&folio, &cliente, &clientID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrPosSaleNotFound
		}
		return nil, err
	}
	rows, err := db.Query(`
		SELECT COALESCE(it.inventory_id, 0), it.descripcion, it.cantidad, it.precio, it.importe
		FROM pos_sale_items it
		LEFT JOIN inv_articulos inv ON inv.id = it.inventory_id
		WHERE it.sale_id = ? AND COALESCE(inv.servicio, 0) = 0 AND COALESCE(inv.sin_rastreo, 0) = 0
		ORDER BY it.id`, saleID)
	if err != nil {
		return nil, err
	}
	var items OrderItems
	total := 0.0
	for rows.Next() {
		var it OrderItem
		var imp float64
		if err := rows.Scan(&it.ItemID, &it.Name, &it.Quantity, &it.Price, &imp); err != nil {
			rows.Close()
			return nil, err
		}
		items = append(items, it)
		total += imp
	}
	rows.Close()
	if len(items) == 0 {
		return nil, ErrPosPedidoSinProductos
	}
	code, err := NewTrackingCode()
	if err != nil {
		return nil, err
	}
	phone := ""
	if clientID.Valid {
		phone = PosClientPhone(userID, clientID.Int64)
	}
	sid := saleID
	o := Order{
		UserID:        userID,
		ClientName:    cut(cliente, 255),
		ClientPhone:   phone,
		Items:         items,
		Total:         round2(total),
		Notes:         fmt.Sprintf("Ticket %d", folio),
		OrderType:     OrderTypeLocalPickup,
		Status:        OrderStatusConfirmed,
		Source:        OrderSourcePOS,
		PaymentMethod: "pos",
		Paid:          true,
		TrackingCode:  code,
		PosSaleID:     &sid,
	}
	if err := config.DB.Create(&o).Error; err != nil {
		return nil, err
	}
	return &PosPedido{ID: o.ID, Code: code, Status: string(o.Status)}, nil
}

// SetPosPedidoStatus cambia el estatus del pedido de la venta.
func SetPosPedidoStatus(userID uint, saleID int64, status string) (*PosPedido, error) {
	p, err := GetPosPedido(userID, saleID)
	if err != nil {
		return nil, err
	}
	if p == nil {
		return nil, ErrPosSaleNotFound
	}
	if err := config.DB.Model(&Order{}).Where("id = ? AND user_id = ?", p.ID, userID).Update("status", status).Error; err != nil {
		return nil, err
	}
	p.Status = status
	return p, nil
}

// CancelPosPedido — al cancelar la venta, su pedido también se cancela.
func CancelPosPedido(userID uint, saleID int64) {
	config.DB.Model(&Order{}).Where("user_id = ? AND pos_sale_id = ?", userID, saleID).Update("status", OrderStatusCancelled)
}

/* =========================================================
   RASTREO PÚBLICO
   ========================================================= */

// TrackedOrder — lo que ve el cliente en /rastreo (sin datos privados).
type TrackedOrder struct {
	Code      string            `json:"code"`
	Status    string            `json:"status"`
	Cliente   string            `json:"cliente"` // solo el primer nombre
	Items     []TrackedItem     `json:"items"`
	Total     float64           `json:"total"`
	Tipo      string            `json:"tipo"`
	CreatedAt time.Time         `json:"created_at"`
	UpdatedAt time.Time         `json:"updated_at"`
	Estatus   []OrderStatusInfo `json:"estatus"`
	Negocio   TrackedBusiness   `json:"negocio"`
}

type TrackedItem struct {
	Name     string `json:"name"`
	Quantity int    `json:"quantity"`
}

type TrackedBusiness struct {
	Nombre   string `json:"nombre"`
	Logo     string `json:"logo"`
	Telefono string `json:"telefono"`
	Ciudad   string `json:"ciudad"`
}

var ErrTrackingNotFound = errors.New("pedido no encontrado")

// TrackOrder busca un pedido por su clave de rastreo.
func TrackOrder(code string) (*TrackedOrder, error) {
	code = NormalizeTrackingCode(code)
	if len(code) < 4 {
		return nil, ErrTrackingNotFound
	}
	var o Order
	if err := config.DB.Where("tracking_code = ?", code).First(&o).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrTrackingNotFound
		}
		return nil, err
	}
	first := strings.Fields(o.ClientName)
	cliente := ""
	if len(first) > 0 && !strings.EqualFold(first[0], "público") && !strings.EqualFold(first[0], "publico") {
		cliente = first[0]
	}
	out := &TrackedOrder{
		Code: o.TrackingCode, Status: string(o.Status), Cliente: cliente, Total: o.Total,
		Tipo: string(o.OrderType), CreatedAt: o.CreatedAt, UpdatedAt: o.UpdatedAt, Items: []TrackedItem{},
	}
	for _, it := range o.Items {
		out.Items = append(out.Items, TrackedItem{Name: it.Name, Quantity: it.Quantity})
	}
	var b MyBusinessInfo
	optica := false
	if err := config.DB.Where("user_id = ?", o.UserID).Order("branch_number ASC").First(&b).Error; err == nil {
		out.Negocio = TrackedBusiness{Nombre: b.BusinessName, Logo: b.LogoURL, Telefono: b.PhoneNumber, Ciudad: b.Location.City}
		bt := strings.ToLower(strings.TrimSpace(b.BusinessType))
		optica = bt == "optica" || bt == "óptica"
	}
	var u User
	if err := config.DB.Select("id, business_type, company").First(&u, o.UserID).Error; err == nil {
		bt := strings.ToLower(strings.TrimSpace(u.BusinessType))
		optica = optica || bt == "optica" || bt == "óptica"
		if out.Negocio.Nombre == "" {
			out.Negocio.Nombre = u.Company
		}
	}
	out.Estatus = OrderStatusList(optica)
	return out, nil
}
