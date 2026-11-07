package models

// pos.go — Punto de venta (sidebar → Punto de venta), portado del Punto de
// venta de Avante Optics (recepción): clientes, ventas, créditos y abonos.
//
// Crédito = lo que el cliente queda a deber de una venta (deja un anticipo
// y paga el resto después); cada pago posterior es un abono.
//
// Diferencias con Avante:
//   - Multi-negocio: todas las tablas llevan user_id (el dueño) y cada
//     consulta filtra por él.
//   - Cada negocio tiene su propio consecutivo de tickets (pos_sales.folio);
//     el id interno solo se usa para ligar tablas.
//   - Los productos salen del Inventario de Attomos (inv_articulos):
//     precio = precio 1, existencia = existencia. Cada venta descuenta la
//     existencia y queda en el kárdex como "venta".
//   - Sin pedido de laboratorio ni números de rastreo (se dejó para después).

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

/* =========================================================
   TABLAS (AutoMigrate)
   ========================================================= */

type PosClientRecord struct {
	ID            int64     `gorm:"primaryKey;autoIncrement"`
	UserID        uint      `gorm:"not null;uniqueIndex:uq_pos_cli_num,priority:1;index:idx_pos_cli_nombre,priority:1"`
	Numero        string    `gorm:"size:20;not null;uniqueIndex:uq_pos_cli_num,priority:2"`
	Clave         string    `gorm:"size:30;not null;default:''"`
	Nombre        string    `gorm:"size:120;not null;index:idx_pos_cli_nombre,priority:2"`
	Celular       string    `gorm:"size:20;not null;default:''"`
	Representante string    `gorm:"size:120;not null;default:''"`
	DiasCredito   int       `gorm:"not null;default:0"`
	LimiteCredito float64   `gorm:"type:decimal(12,2);not null;default:0"`
	CreatedBy     string    `gorm:"size:120;not null;default:''"`
	CreatedAt     time.Time `gorm:"type:datetime"`
}

func (PosClientRecord) TableName() string { return "pos_clients" }

type PosSaleRecord struct {
	ID            int64      `gorm:"primaryKey;autoIncrement"`
	UserID        uint       `gorm:"not null;uniqueIndex:uq_pos_sale_folio,priority:1;index:idx_pos_sale_fecha,priority:1"`
	Folio         int64      `gorm:"not null;uniqueIndex:uq_pos_sale_folio,priority:2"`
	ClientID      *int64     `gorm:"index"`
	Cliente       string     `gorm:"size:120;not null;default:''"`
	Cajero        string     `gorm:"size:120;not null;default:''"`
	Subtotal      float64    `gorm:"type:decimal(12,2);not null;default:0"`
	Descuento     float64    `gorm:"type:decimal(12,2);not null;default:0"`
	Total         float64    `gorm:"type:decimal(12,2);not null;default:0"`
	Efectivo      float64    `gorm:"type:decimal(12,2);not null;default:0"`
	Tarjeta       float64    `gorm:"type:decimal(12,2);not null;default:0"`
	Transferencia float64    `gorm:"type:decimal(12,2);not null;default:0"`
	Vales         float64    `gorm:"type:decimal(12,2);not null;default:0"`
	Cheque        float64    `gorm:"type:decimal(12,2);not null;default:0"`
	Credito       float64    `gorm:"type:decimal(12,2);not null;default:0"`
	Cambio        float64    `gorm:"type:decimal(12,2);not null;default:0"`
	Referencia    string     `gorm:"size:80;not null;default:''"`
	Propina       float64    `gorm:"type:decimal(12,2);not null;default:0"`
	PropinaForma  string     `gorm:"size:20;not null;default:''"`
	Cancelada     bool       `gorm:"not null;default:false"`
	CanceladaAt   *time.Time `gorm:"type:datetime"`
	CanceladaPor  string     `gorm:"size:120;not null;default:''"`
	CancelMotivo  string     `gorm:"size:200;not null;default:''"`
	CreatedAt     time.Time  `gorm:"type:datetime;index:idx_pos_sale_fecha,priority:2"`
}

func (PosSaleRecord) TableName() string { return "pos_sales" }

type PosSaleItemRecord struct {
	ID          int64   `gorm:"primaryKey;autoIncrement"`
	SaleID      int64   `gorm:"not null;index"`
	InventoryID *int64  `gorm:"index"`
	Clave       string  `gorm:"size:60;not null;default:''"`
	Descripcion string  `gorm:"size:200;not null"`
	Cantidad    int     `gorm:"not null;default:1"`
	Precio      float64 `gorm:"type:decimal(12,2);not null;default:0"`
	Descuento   float64 `gorm:"type:decimal(5,2);not null;default:0"`
	Importe     float64 `gorm:"type:decimal(12,2);not null;default:0"`
}

func (PosSaleItemRecord) TableName() string { return "pos_sale_items" }

type PosCreditRecord struct {
	ID        int64      `gorm:"primaryKey;autoIncrement"`
	UserID    uint       `gorm:"not null;index"`
	SaleID    int64      `gorm:"not null;uniqueIndex"`
	ClientID  int64      `gorm:"not null;index:idx_pos_cred_cli,priority:1"`
	Monto     float64    `gorm:"type:decimal(12,2);not null;default:0"`
	Saldo     float64    `gorm:"type:decimal(12,2);not null;default:0;index:idx_pos_cred_cli,priority:2"`
	Fecha     time.Time  `gorm:"type:date;not null"`
	Vence     *time.Time `gorm:"type:date"`
	CreatedAt time.Time  `gorm:"type:datetime"`
}

func (PosCreditRecord) TableName() string { return "pos_credits" }

type PosCreditPaymentRecord struct {
	ID           int64      `gorm:"primaryKey;autoIncrement"`
	UserID       uint       `gorm:"not null;index"`
	CreditID     int64      `gorm:"not null;index"`
	ClientID     int64      `gorm:"not null;index"`
	Monto        float64    `gorm:"type:decimal(12,2);not null;default:0"`
	FormaPago    string     `gorm:"size:20;not null;default:'efectivo'"`
	Referencia   string     `gorm:"size:80;not null;default:''"`
	Cajero       string     `gorm:"size:120;not null;default:''"`
	Fecha        time.Time  `gorm:"type:date;not null"`
	CreatedAt    time.Time  `gorm:"type:datetime"`
	Cancelado    bool       `gorm:"not null;default:false"`
	CanceladoPor string     `gorm:"size:120;not null;default:''"`
	CanceladoAt  *time.Time `gorm:"type:datetime"`
}

func (PosCreditPaymentRecord) TableName() string { return "pos_credit_payments" }

type PosTicketTemplateRecord struct {
	UserID    uint      `gorm:"primaryKey;autoIncrement:false"`
	Data      string    `gorm:"type:longtext;not null"`
	UpdatedBy string    `gorm:"size:120;not null;default:''"`
	UpdatedAt time.Time `gorm:"type:datetime"`
}

func (PosTicketTemplateRecord) TableName() string { return "pos_ticket_templates" }

// PosModels — para el AutoMigrate de main.go (incluye las de Corte de caja).
func PosModels() []interface{} {
	return []interface{}{
		&PosClientRecord{}, &PosSaleRecord{}, &PosSaleItemRecord{}, &PosCreditRecord{},
		&PosCreditPaymentRecord{}, &PosTicketTemplateRecord{},
		&CajaCorteRecord{}, &CajaMovimientoRecord{}, &CajaPropinaCorteRecord{},
	}
}

/* =========================================================
   UTILIDADES
   ========================================================= */

var (
	ErrPosClientDuplicate  = errors.New("ya existe un cliente con ese número")
	ErrPosClientNotFound   = errors.New("cliente no encontrado")
	ErrPosCreditNotFound   = errors.New("crédito no encontrado")
	ErrPosPaymentNotFound  = errors.New("abono no encontrado")
	ErrPosCreditLimit      = errors.New("el crédito pasa del límite del cliente")
	ErrPosPaymentTooBig    = errors.New("el abono es mayor que el saldo")
	ErrPosPaymentNotToday  = errors.New("solo se pueden cancelar abonos del mismo día")
	ErrPosPaymentCancelled = errors.New("ese abono ya estaba cancelado")
	ErrPosSaleNotFound     = errors.New("venta no encontrada")
)

// posLoc: misma zona que el Inventario (Hermosillo).
var posLoc = invLoc

// PosToday — fecha de hoy ("YYYY-MM-DD").
func PosToday() string { return time.Now().In(posLoc).Format("2006-01-02") }

func posNow() string { return time.Now().In(posLoc).Format("2006-01-02 15:04:05") }

func round2(v float64) float64 { return invRound2(v) }

func posDB() *sql.DB { return invDB() }

func cut(s string, n int) string {
	if r := []rune(s); len(r) > n {
		return string(r[:n])
	}
	return s
}

/* =========================================================
   CLIENTES
   ========================================================= */

type PosClient struct {
	ID            int64   `json:"id"`
	Numero        string  `json:"numero"`
	Clave         string  `json:"clave"`
	Nombre        string  `json:"nombre"`
	Celular       string  `json:"celular"`
	Representante string  `json:"representante"`
	DiasCredito   int     `json:"dias"`
	LimiteCredito float64 `json:"limite"`
	// Calculados a partir de sus créditos abiertos:
	Saldo        float64 `json:"saldo"`
	SaldoVencido float64 `json:"saldo_vencido"`
	ProximoVence string  `json:"proximo_vence"`
	Creditos     int     `json:"creditos"`
}

const posClientSelect = `
	SELECT c.id, c.numero, c.clave, c.nombre, c.celular, c.representante, c.dias_credito, c.limite_credito,
	       COALESCE(SUM(cr.saldo), 0),
	       COALESCE(SUM(CASE WHEN cr.vence IS NOT NULL AND cr.vence < ? THEN cr.saldo ELSE 0 END), 0),
	       COALESCE(DATE_FORMAT(MIN(cr.vence), '%Y-%m-%d'), ''),
	       COUNT(cr.id)
	FROM pos_clients c
	LEFT JOIN pos_credits cr ON cr.client_id = c.id AND cr.saldo > 0`

func scanPosClient(sc interface{ Scan(...interface{}) error }) (PosClient, error) {
	var c PosClient
	err := sc.Scan(&c.ID, &c.Numero, &c.Clave, &c.Nombre, &c.Celular, &c.Representante, &c.DiasCredito, &c.LimiteCredito,
		&c.Saldo, &c.SaldoVencido, &c.ProximoVence, &c.Creditos)
	c.Saldo, c.SaldoVencido = round2(c.Saldo), round2(c.SaldoVencido)
	return c, err
}

// ListPosClients busca clientes por número, clave, nombre o celular. Sin
// búsqueda regresa primero a los que deben algo y luego los más recientes.
func ListPosClients(userID uint, q string, limit int) ([]PosClient, error) {
	if limit <= 0 || limit > 200 {
		limit = 60
	}
	args := []interface{}{PosToday(), userID}
	where := []string{"c.user_id = ?"}
	for _, w := range strings.Fields(strings.ToLower(q)) {
		like := "%" + strings.NewReplacer(`\`, `\\`, "%", `\%`, "_", `\_`).Replace(w) + "%"
		where = append(where, "(LOWER(c.nombre) LIKE ? OR c.numero LIKE ? OR LOWER(c.clave) LIKE ? OR c.celular LIKE ?)")
		args = append(args, like, like, like, like)
	}
	query := posClientSelect + " WHERE " + strings.Join(where, " AND ") +
		" GROUP BY c.id ORDER BY (COALESCE(SUM(cr.saldo),0) > 0) DESC, c.clave <> '' DESC, c.id DESC LIMIT ?"
	args = append(args, limit)

	rows, err := posDB().Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PosClient{}
	for rows.Next() {
		c, err := scanPosClient(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// GetPosClient trae un cliente del negocio con su saldo.
func GetPosClient(userID uint, id int64) (*PosClient, error) {
	c, err := scanPosClient(posDB().QueryRow(posClientSelect+" WHERE c.user_id = ? AND c.id = ? GROUP BY c.id", PosToday(), userID, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrPosClientNotFound
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// NextPosClientNumero sugiere el siguiente No. de cliente del negocio.
func NextPosClientNumero(userID uint) (string, error) {
	var max sql.NullInt64
	err := posDB().QueryRow("SELECT MAX(CAST(numero AS UNSIGNED)) FROM pos_clients WHERE user_id = ? AND numero REGEXP '^[0-9]+$'", userID).Scan(&max)
	if err != nil {
		return "1", err
	}
	return fmt.Sprint(max.Int64 + 1), nil
}

// CreatePosClient guarda un cliente nuevo.
func CreatePosClient(userID uint, c PosClient, createdBy string) (*PosClient, error) {
	res, err := posDB().Exec(
		`INSERT INTO pos_clients (user_id, numero, clave, nombre, celular, representante, dias_credito, limite_credito, created_by, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		userID, c.Numero, c.Clave, c.Nombre, c.Celular, c.Representante, c.DiasCredito, round2(c.LimiteCredito), createdBy, posNow(),
	)
	if err != nil {
		if isInvDuplicateKey(err) {
			return nil, ErrPosClientDuplicate
		}
		return nil, err
	}
	id, _ := res.LastInsertId()
	return GetPosClient(userID, id)
}

// UpdatePosClient cambia los datos de un cliente. Las ventas guardan el
// nombre que tenía el cliente al momento de venderle.
func UpdatePosClient(userID uint, id int64, c PosClient) (*PosClient, error) {
	if _, err := GetPosClient(userID, id); err != nil {
		return nil, err
	}
	_, err := posDB().Exec(
		`UPDATE pos_clients SET numero = ?, clave = ?, nombre = ?, celular = ?, representante = ?,
		        dias_credito = ?, limite_credito = ?
		 WHERE id = ? AND user_id = ?`,
		c.Numero, c.Clave, c.Nombre, c.Celular, c.Representante, c.DiasCredito, round2(c.LimiteCredito), id, userID,
	)
	if err != nil {
		if isInvDuplicateKey(err) {
			return nil, ErrPosClientDuplicate
		}
		return nil, err
	}
	return GetPosClient(userID, id)
}

// PosClientPhone — celular del cliente (para mandarle su ticket por WhatsApp).
func PosClientPhone(userID uint, clientID int64) string {
	if clientID <= 0 {
		return ""
	}
	var tel string
	_ = posDB().QueryRow("SELECT celular FROM pos_clients WHERE id = ? AND user_id = ?", clientID, userID).Scan(&tel)
	return tel
}

/* =========================================================
   BÚSQUEDA EN EL INVENTARIO (para armar la venta)
   ========================================================= */

// PosInventoryItem — un artículo como lo usa el Punto de venta.
type PosInventoryItem struct {
	ID             int64   `json:"id"`
	Clave          string  `json:"clave"`
	Descripcion    string  `json:"descripcion"`
	PrecioVenta    float64 `json:"precio_venta"`
	CantidadActual int     `json:"cantidad_actual"`
	Servicio       bool    `json:"servicio"`
	Foto           string  `json:"foto"`
}

// SearchPosInventory busca por clave, clave alterna (código de barras) o
// descripción (todas las palabras deben aparecer).
func SearchPosInventory(userID uint, q string, limit int) ([]PosInventoryItem, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	where := []string{"i.user_id = ?"}
	args := []interface{}{userID}
	n := 0
	for _, w := range strings.Fields(strings.TrimSpace(q)) {
		if len([]rune(w)) > 60 {
			w = string([]rune(w)[:60])
		}
		w = strings.NewReplacer(`\`, `\\`, "%", `\%`, "_", `\_`).Replace(w)
		where = append(where, "(i.descripcion LIKE ? OR i.clave LIKE ? OR i.clave_alterna LIKE ?)")
		args = append(args, "%"+w+"%", "%"+w+"%", "%"+w+"%")
		if n++; n == 8 {
			break
		}
	}
	query := "SELECT i.id, i.clave, i.descripcion, i.precio_1, i.existencia, i.servicio, COALESCE(" + invPhotoMainSQL + ", 0) FROM inv_articulos i WHERE " +
		strings.Join(where, " AND ") + " ORDER BY i.descripcion ASC LIMIT ?"
	args = append(args, limit)
	rows, err := posDB().Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PosInventoryItem{}
	for rows.Next() {
		var it PosInventoryItem
		var fotoID int64
		if err := rows.Scan(&it.ID, &it.Clave, &it.Descripcion, &it.PrecioVenta, &it.CantidadActual, &it.Servicio, &fotoID); err != nil {
			return nil, err
		}
		it.Foto = InvPhotoURL(fotoID)
		out = append(out, it)
	}
	return out, rows.Err()
}

/* =========================================================
   VENTAS
   ========================================================= */

type PosSaleItem struct {
	InventoryID int64    `json:"inventory_id"`
	Clave       string   `json:"clave"`
	Descripcion string   `json:"descripcion"`
	Cantidad    int      `json:"cantidad"`
	Precio      float64  `json:"precio"`
	Descuento   float64  `json:"descuento"` // %
	Importe     float64  `json:"importe"`
	Rastreo     []string `json:"rastreo,omitempty"` // (sin uso en Attomos)
}

type PosPayments struct {
	Efectivo      float64 `json:"efectivo"`
	Tarjeta       float64 `json:"tarjeta"`
	Transferencia float64 `json:"transferencia"`
	Vales         float64 `json:"vales"`
	Cheque        float64 `json:"cheque"`
	Credito       float64 `json:"credito"`
}

type PosSale struct {
	ID           int64         `json:"-"`     // id interno
	Folio        int64         `json:"folio"` // ticket del negocio
	ClientID     int64         `json:"client_id,omitempty"`
	Cliente      string        `json:"cliente"`
	Cajero       string        `json:"cajero"`
	Subtotal     float64       `json:"subtotal"`
	Descuento    float64       `json:"descuento"`
	Total        float64       `json:"total"`
	Pagos        PosPayments   `json:"pagos"`
	Cambio       float64       `json:"cambio"`
	Referencia   string        `json:"referencia"`
	Items        []PosSaleItem `json:"productos"`
	CreatedAt    time.Time     `json:"fecha"`
	Propina      float64       `json:"propina"`
	PropinaForma string        `json:"propina_forma"`
	CreditID     int64         `json:"credit_id,omitempty"`
	Vence        string        `json:"vence,omitempty"`
	// Ópticas: pedido con su clave de rastreo (se abre al cobrar).
	Pedido *PosPedido `json:"pedido,omitempty"`
}

// PosStockError: no alcanzó la existencia de un producto.
type PosStockError struct {
	Descripcion string
	Disponible  int
}

func (e *PosStockError) Error() string {
	return fmt.Sprintf("solo hay %d en existencia de %s", e.Disponible, e.Descripcion)
}

// CreatePosSale guarda la venta en una sola transacción: descuenta el
// inventario (y lo deja en el kárdex), guarda el ticket con sus productos
// y, si quedó algo a crédito, abre el crédito del cliente (revisando su
// límite). Los importes se recalculan aquí; no se confía en el navegador.
func CreatePosSale(userID uint, s PosSale) (*PosSale, error) {
	tx, err := posDB().Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var subtotal, total float64
	stocks := make([]int, len(s.Items)) // existencia antes de vender (kárdex); -1 = servicio
	for i := range s.Items {
		it := &s.Items[i]
		var desc, clave string
		var precio float64
		var stock int
		var servicio bool
		err := tx.QueryRow("SELECT descripcion, clave, precio_1, existencia, servicio FROM inv_articulos WHERE id = ? AND user_id = ? FOR UPDATE", it.InventoryID, userID).
			Scan(&desc, &clave, &precio, &stock, &servicio)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("un producto de la venta ya no existe en el inventario")
		}
		if err != nil {
			return nil, err
		}
		if it.Cantidad <= 0 {
			it.Cantidad = 1
		}
		// Si el mismo artículo viene en dos renglones, cuenta lo ya apartado.
		apartado := 0
		for j := 0; j < i; j++ {
			if s.Items[j].InventoryID == it.InventoryID {
				apartado += s.Items[j].Cantidad
			}
		}
		if !servicio && stock-apartado < it.Cantidad {
			return nil, &PosStockError{Descripcion: desc, Disponible: stock - apartado}
		}
		if it.Descuento < 0 {
			it.Descuento = 0
		}
		if it.Descuento > 100 {
			it.Descuento = 100
		}
		it.Descripcion, it.Clave, it.Precio = desc, clave, round2(precio)
		it.Importe = round2(it.Precio * float64(it.Cantidad) * (1 - it.Descuento/100))
		subtotal += it.Precio * float64(it.Cantidad)
		total += it.Importe
		if servicio {
			stocks[i] = -1
			continue
		}
		if _, err := tx.Exec("UPDATE inv_articulos SET existencia = existencia - ?, updated_at = ? WHERE id = ? AND user_id = ?", it.Cantidad, posNow(), it.InventoryID, userID); err != nil {
			return nil, err
		}
		stocks[i] = stock - apartado
	}
	s.Subtotal, s.Total = round2(subtotal), round2(total)
	s.Descuento = round2(s.Subtotal - s.Total)

	p := &s.Pagos
	for _, v := range []*float64{&p.Efectivo, &p.Tarjeta, &p.Transferencia, &p.Vales, &p.Cheque, &p.Credito} {
		if *v < 0 {
			*v = 0
		}
		*v = round2(*v)
	}
	noCash := round2(p.Tarjeta + p.Transferencia + p.Vales + p.Cheque + p.Credito)
	if noCash > s.Total {
		return nil, fmt.Errorf("tarjeta, transferencia, vales, cheque y crédito no pueden pasar del total (solo el efectivo da cambio)")
	}
	paid := round2(noCash + p.Efectivo)
	if paid < s.Total {
		return nil, fmt.Errorf("falta cobrar %.2f", round2(s.Total-paid))
	}
	s.Cambio = round2(paid - s.Total)
	s.Propina = round2(s.Propina)
	if s.Propina < 0 || s.Propina > 100000 {
		return nil, fmt.Errorf("la propina no es válida")
	}
	switch s.PropinaForma {
	case "efectivo", "tarjeta", "transferencia", "vales", "cheque":
	default:
		s.PropinaForma = "efectivo"
	}
	if s.Propina == 0 {
		s.PropinaForma = ""
	}

	// Cliente y crédito
	var client *PosClient
	if s.ClientID > 0 {
		var c PosClient
		err := tx.QueryRow("SELECT id, nombre, dias_credito, limite_credito FROM pos_clients WHERE id = ? AND user_id = ? FOR UPDATE", s.ClientID, userID).
			Scan(&c.ID, &c.Nombre, &c.DiasCredito, &c.LimiteCredito)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrPosClientNotFound
		}
		if err != nil {
			return nil, err
		}
		client = &c
		s.Cliente = c.Nombre
	}
	if p.Credito > 0 {
		if client == nil {
			return nil, fmt.Errorf("para dejar algo a crédito elige un cliente")
		}
		if client.LimiteCredito > 0 {
			var saldo float64
			if err := tx.QueryRow("SELECT COALESCE(SUM(saldo),0) FROM pos_credits WHERE client_id = ? AND saldo > 0", client.ID).Scan(&saldo); err != nil {
				return nil, err
			}
			if round2(saldo+p.Credito) > round2(client.LimiteCredito) {
				return nil, fmt.Errorf("%w: le quedan %.2f disponibles", ErrPosCreditLimit, round2(client.LimiteCredito-saldo))
			}
		}
	}
	if s.Cliente == "" {
		s.Cliente = "PÚBLICO EN GENERAL"
	}

	// Folio: consecutivo del negocio.
	if err := tx.QueryRow("SELECT COALESCE(MAX(folio), 0) + 1 FROM pos_sales WHERE user_id = ? FOR UPDATE", userID).Scan(&s.Folio); err != nil {
		return nil, err
	}
	var clientArg interface{}
	if client != nil {
		clientArg = client.ID
	}
	now := posNow()
	res, err := tx.Exec(
		`INSERT INTO pos_sales (user_id, folio, client_id, cliente, cajero, subtotal, descuento, total, efectivo, tarjeta, transferencia, vales, cheque, credito, cambio, referencia, propina, propina_forma, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		userID, s.Folio, clientArg, s.Cliente, s.Cajero, s.Subtotal, s.Descuento, s.Total,
		p.Efectivo, p.Tarjeta, p.Transferencia, p.Vales, p.Cheque, p.Credito, s.Cambio, s.Referencia, s.Propina, s.PropinaForma, now,
	)
	if err != nil {
		return nil, err
	}
	s.ID, _ = res.LastInsertId()
	for i, it := range s.Items {
		if _, err := tx.Exec(
			`INSERT INTO pos_sale_items (sale_id, inventory_id, clave, descripcion, cantidad, precio, descuento, importe) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			s.ID, it.InventoryID, it.Clave, it.Descripcion, it.Cantidad, it.Precio, it.Descuento, it.Importe,
		); err != nil {
			return nil, err
		}
		if stocks[i] < 0 {
			continue // servicio: no lleva existencia ni kárdex
		}
		// Kárdex (Inventario → Movimientos): salida por venta.
		if _, err := tx.Exec(
			`INSERT INTO inv_movimientos (user_id, item_id, tipo, cantidad, existencia_antes, existencia_despues, venta_id, comentario, usuario, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			userID, it.InventoryID, InvMovSale, -it.Cantidad, stocks[i], stocks[i]-it.Cantidad, s.ID, fmt.Sprintf("Ticket %d", s.Folio), s.Cajero, now,
		); err != nil {
			return nil, err
		}
	}

	if p.Credito > 0 {
		hoy := time.Now().In(posLoc)
		var venceArg interface{}
		if client.DiasCredito > 0 {
			s.Vence = hoy.AddDate(0, 0, client.DiasCredito).Format("2006-01-02")
			venceArg = s.Vence
		}
		res, err := tx.Exec(
			"INSERT INTO pos_credits (user_id, sale_id, client_id, monto, saldo, fecha, vence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
			userID, s.ID, client.ID, p.Credito, p.Credito, hoy.Format("2006-01-02"), venceArg, now,
		)
		if err != nil {
			return nil, err
		}
		s.CreditID, _ = res.LastInsertId()
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	s.CreatedAt = time.Now().In(posLoc)
	return &s, nil
}

/* =========================================================
   CRÉDITOS Y ABONOS
   ========================================================= */

type PosCreditPayment struct {
	ID         int64   `json:"id"`
	CreditID   int64   `json:"credit_id"`
	Monto      float64 `json:"monto"`
	FormaPago  string  `json:"forma_pago"`
	Referencia string  `json:"referencia"`
	Cajero     string  `json:"cajero"`
	Fecha      string  `json:"fecha"`
	CreatedAt  string  `json:"created_at"`
	Cancelado  bool    `json:"cancelado"`
	CancelPor  string  `json:"cancelado_por,omitempty"`
	Cancelable bool    `json:"cancelable"`
}

type PosCredit struct {
	ID        int64              `json:"id"`
	Folio     int64              `json:"folio"` // ticket de la venta
	Fecha     string             `json:"fecha"`
	Vence     string             `json:"vence"`
	Monto     float64            `json:"monto"`
	Abonado   float64            `json:"abonado"`
	Saldo     float64            `json:"saldo"`
	Vencido   bool               `json:"vencido"`
	Productos string             `json:"productos"`
	Abonos    []PosCreditPayment `json:"abonos"`
}

const posPaymentSelect = `SELECT id, credit_id, monto, forma_pago, referencia, cajero, DATE_FORMAT(fecha, '%Y-%m-%d'),
	DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s'), cancelado, cancelado_por FROM pos_credit_payments`

func scanPosPayment(sc interface{ Scan(...interface{}) error }, today string) (PosCreditPayment, error) {
	var p PosCreditPayment
	err := sc.Scan(&p.ID, &p.CreditID, &p.Monto, &p.FormaPago, &p.Referencia, &p.Cajero, &p.Fecha, &p.CreatedAt, &p.Cancelado, &p.CancelPor)
	p.Cancelable = !p.Cancelado && p.Fecha == today
	return p, err
}

// ListPosClientCredits: créditos del cliente (con saldo primero) y sus abonos.
func ListPosClientCredits(userID uint, clientID int64) ([]PosCredit, error) {
	today := PosToday()
	db := posDB()
	rows, err := db.Query(`
		SELECT cr.id, s.folio, DATE_FORMAT(cr.fecha, '%Y-%m-%d'), COALESCE(DATE_FORMAT(cr.vence, '%Y-%m-%d'), ''), cr.monto, cr.saldo,
		       COALESCE((SELECT GROUP_CONCAT(CONCAT(i.cantidad, ' × ', i.descripcion) SEPARATOR ' · ') FROM pos_sale_items i WHERE i.sale_id = cr.sale_id), '')
		FROM pos_credits cr JOIN pos_sales s ON s.id = cr.sale_id
		WHERE cr.user_id = ? AND cr.client_id = ?
		ORDER BY (cr.saldo > 0) DESC, cr.fecha DESC, cr.id DESC`, userID, clientID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PosCredit{}
	idx := map[int64]int{}
	for rows.Next() {
		var c PosCredit
		if err := rows.Scan(&c.ID, &c.Folio, &c.Fecha, &c.Vence, &c.Monto, &c.Saldo, &c.Productos); err != nil {
			return nil, err
		}
		c.Saldo = round2(c.Saldo)
		c.Abonado = round2(c.Monto - c.Saldo)
		c.Vencido = c.Saldo > 0 && c.Vence != "" && c.Vence < today
		c.Abonos = []PosCreditPayment{}
		idx[c.ID] = len(out)
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return out, nil
	}
	prow, err := db.Query(posPaymentSelect+" WHERE user_id = ? AND client_id = ? ORDER BY id DESC", userID, clientID)
	if err != nil {
		return nil, err
	}
	defer prow.Close()
	for prow.Next() {
		p, err := scanPosPayment(prow, today)
		if err != nil {
			return nil, err
		}
		if i, ok := idx[p.CreditID]; ok {
			out[i].Abonos = append(out[i].Abonos, p)
		}
	}
	return out, prow.Err()
}

var posFormasPago = map[string]bool{"efectivo": true, "tarjeta": true, "transferencia": true, "vales": true, "cheque": true}

// IsPosFormaPago indica si la forma de pago de un abono es válida.
func IsPosFormaPago(f string) bool { return posFormasPago[f] }

// PosPaymentResult: lo que regresa un abono (para el recibo).
type PosPaymentResult struct {
	Payment       PosCreditPayment `json:"abono"`
	Folio         int64            `json:"folio"`
	ClientID      int64            `json:"client_id"`
	Cliente       string           `json:"cliente"`
	SaldoAnterior float64          `json:"saldo_anterior"`
	SaldoNuevo    float64          `json:"saldo_nuevo"`
}

// AddPosCreditPayment registra un abono a un crédito y baja su saldo.
func AddPosCreditPayment(userID uint, creditID int64, monto float64, forma, referencia, cajero string) (*PosPaymentResult, error) {
	monto = round2(monto)
	tx, err := posDB().Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var r PosPaymentResult
	err = tx.QueryRow(`SELECT s.folio, cr.client_id, cr.saldo, c.nombre FROM pos_credits cr
		JOIN pos_clients c ON c.id = cr.client_id
		JOIN pos_sales s ON s.id = cr.sale_id
		WHERE cr.id = ? AND cr.user_id = ? FOR UPDATE`, creditID, userID).
		Scan(&r.Folio, &r.ClientID, &r.SaldoAnterior, &r.Cliente)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrPosCreditNotFound
	}
	if err != nil {
		return nil, err
	}
	r.SaldoAnterior = round2(r.SaldoAnterior)
	if monto > r.SaldoAnterior {
		return nil, ErrPosPaymentTooBig
	}
	r.SaldoNuevo = round2(r.SaldoAnterior - monto)
	today := PosToday()
	res, err := tx.Exec(
		"INSERT INTO pos_credit_payments (user_id, credit_id, client_id, monto, forma_pago, referencia, cajero, fecha, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
		userID, creditID, r.ClientID, monto, forma, referencia, cajero, today, posNow(),
	)
	if err != nil {
		return nil, err
	}
	if _, err := tx.Exec("UPDATE pos_credits SET saldo = ? WHERE id = ?", r.SaldoNuevo, creditID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	r.Payment = PosCreditPayment{ID: id, CreditID: creditID, Monto: monto, FormaPago: forma, Referencia: referencia, Cajero: cajero,
		Fecha: today, CreatedAt: time.Now().In(posLoc).Format("2006-01-02T15:04:05"), Cancelable: true}
	return &r, nil
}

// CancelPosCreditPayment cancela un abono del mismo día y regresa el monto
// al saldo del crédito.
func CancelPosCreditPayment(userID uint, paymentID int64, by string) (*PosPaymentResult, error) {
	tx, err := posDB().Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var r PosPaymentResult
	var p PosCreditPayment
	err = tx.QueryRow(`SELECT id, credit_id, client_id, monto, forma_pago, DATE_FORMAT(fecha, '%Y-%m-%d'), cancelado
		FROM pos_credit_payments WHERE id = ? AND user_id = ? FOR UPDATE`, paymentID, userID).
		Scan(&p.ID, &p.CreditID, &r.ClientID, &p.Monto, &p.FormaPago, &p.Fecha, &p.Cancelado)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrPosPaymentNotFound
	}
	if err != nil {
		return nil, err
	}
	if p.Cancelado {
		return nil, ErrPosPaymentCancelled
	}
	if p.Fecha != PosToday() {
		return nil, ErrPosPaymentNotToday
	}
	if err := tx.QueryRow(`SELECT s.folio, cr.saldo, c.nombre FROM pos_credits cr
		JOIN pos_clients c ON c.id = cr.client_id JOIN pos_sales s ON s.id = cr.sale_id
		WHERE cr.id = ? FOR UPDATE`, p.CreditID).Scan(&r.Folio, &r.SaldoAnterior, &r.Cliente); err != nil {
		return nil, err
	}
	r.SaldoNuevo = round2(r.SaldoAnterior + p.Monto)
	if _, err := tx.Exec("UPDATE pos_credit_payments SET cancelado = 1, cancelado_por = ?, cancelado_at = ? WHERE id = ?", by, posNow(), paymentID); err != nil {
		return nil, err
	}
	if _, err := tx.Exec("UPDATE pos_credits SET saldo = ? WHERE id = ?", r.SaldoNuevo, p.CreditID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	p.Cancelado, p.CancelPor = true, by
	r.Payment = p
	return &r, nil
}

/* =========================================================
   VENTAS: listado y detalle
   ========================================================= */

// PosSaleRow: una venta en la tabla de Ventas.
type PosSaleRow struct {
	ID            int64   `json:"-"`
	Folio         int64   `json:"folio"`
	Fecha         string  `json:"fecha"`
	ClientID      int64   `json:"client_id,omitempty"`
	Cliente       string  `json:"cliente"`
	Cajero        string  `json:"cajero"`
	Articulos     int     `json:"articulos"`
	Total         float64 `json:"total"`
	Efectivo      float64 `json:"efectivo"` // lo que se quedó en caja (ya sin el cambio)
	Tarjeta       float64 `json:"tarjeta"`
	Transferencia float64 `json:"transferencia"`
	Vales         float64 `json:"vales"`
	Cheque        float64 `json:"cheque"`
	Pagado        float64 `json:"pagado"`
	Credito       float64 `json:"credito"`
	Abonado       float64 `json:"abonado"`
	Saldo         float64 `json:"saldo"`
	Vence         string  `json:"vence"`
	Estado        string  `json:"estado"` // pagada | debe | vencida | cancelada
	PedidoCode    string  `json:"pedido_code"`
	PedidoStatus  string  `json:"pedido_status"`
	Cancelada     bool    `json:"cancelada"`
	CanceladaAt   string  `json:"cancelada_at,omitempty"`
	CanceladaPor  string  `json:"cancelada_por,omitempty"`
	CancelMotivo  string  `json:"cancel_motivo,omitempty"`
	Propina       float64 `json:"propina"`
	PropinaForma  string  `json:"propina_forma,omitempty"`
}

type PosSalesFilter struct {
	Desde, Hasta string
	Q            string
	Estado       string
}

type PosSalesTotals struct {
	Ventas        int     `json:"ventas"`
	Total         float64 `json:"total"`
	Efectivo      float64 `json:"efectivo"`
	Tarjeta       float64 `json:"tarjeta"`
	Transferencia float64 `json:"transferencia"`
	Otros         float64 `json:"otros"`
	Pagado        float64 `json:"pagado"`
	Credito       float64 `json:"credito"`
	Saldo         float64 `json:"saldo"`
	Canceladas    int     `json:"canceladas"`
}

const posEstadoExpr = `CASE WHEN s.cancelada = 1 THEN 'cancelada' WHEN COALESCE(cr.saldo,0) <= 0 THEN 'pagada'
	WHEN cr.vence IS NOT NULL AND cr.vence < ? THEN 'vencida' ELSE 'debe' END`

const posSaleRowSelect = `SELECT s.id, s.folio, DATE_FORMAT(s.created_at, '%Y-%m-%dT%H:%i:%s'), COALESCE(s.client_id, 0), s.cliente, s.cajero,
		COALESCE((SELECT SUM(i.cantidad) FROM pos_sale_items i WHERE i.sale_id = s.id), 0),
		s.total, s.efectivo - s.cambio, s.tarjeta, s.transferencia, s.vales, s.cheque, s.credito,
		COALESCE(cr.saldo, 0), COALESCE(DATE_FORMAT(cr.vence, '%Y-%m-%d'), ''), ` + posEstadoExpr + `,
		s.cancelada, COALESCE(DATE_FORMAT(s.cancelada_at, '%Y-%m-%dT%H:%i:%s'), ''), s.cancelada_por, s.cancel_motivo, s.propina, s.propina_forma,
		COALESCE((SELECT o.tracking_code FROM orders o WHERE o.pos_sale_id = s.id AND o.user_id = s.user_id AND o.deleted_at IS NULL ORDER BY o.id LIMIT 1), ''),
		COALESCE((SELECT o.status FROM orders o WHERE o.pos_sale_id = s.id AND o.user_id = s.user_id AND o.deleted_at IS NULL ORDER BY o.id LIMIT 1), '')
	FROM pos_sales s LEFT JOIN pos_credits cr ON cr.sale_id = s.id`

func scanPosSaleRow(sc interface{ Scan(...interface{}) error }) (PosSaleRow, error) {
	var r PosSaleRow
	err := sc.Scan(&r.ID, &r.Folio, &r.Fecha, &r.ClientID, &r.Cliente, &r.Cajero, &r.Articulos,
		&r.Total, &r.Efectivo, &r.Tarjeta, &r.Transferencia, &r.Vales, &r.Cheque, &r.Credito,
		&r.Saldo, &r.Vence, &r.Estado,
		&r.Cancelada, &r.CanceladaAt, &r.CanceladaPor, &r.CancelMotivo, &r.Propina, &r.PropinaForma,
		&r.PedidoCode, &r.PedidoStatus)
	r.Efectivo = round2(r.Efectivo)
	r.Pagado = round2(r.Total - r.Credito)
	r.Saldo = round2(r.Saldo)
	r.Abonado = round2(r.Credito - r.Saldo)
	return r, err
}

// ListPosSales regresa las ventas del periodo (más nuevas primero).
func ListPosSales(userID uint, f PosSalesFilter, limit int) ([]PosSaleRow, PosSalesTotals, error) {
	if limit <= 0 || limit > 1000 {
		limit = 500
	}
	today := PosToday()
	query := posSaleRowSelect + " WHERE s.user_id = ?"
	args := []interface{}{today, userID}
	if f.Desde != "" {
		query += " AND s.created_at >= ?"
		args = append(args, f.Desde+" 00:00:00")
	}
	if f.Hasta != "" {
		query += " AND s.created_at <= ?"
		args = append(args, f.Hasta+" 23:59:59")
	}
	for _, w := range strings.Fields(strings.ToLower(f.Q)) {
		like := "%" + strings.NewReplacer(`\`, `\\`, "%", `\%`, "_", `\_`).Replace(w) + "%"
		query += " AND (LOWER(s.cliente) LIKE ? OR CAST(s.folio AS CHAR) LIKE ? OR LOWER(s.cajero) LIKE ?" +
			" OR EXISTS (SELECT 1 FROM orders o WHERE o.pos_sale_id = s.id AND o.user_id = s.user_id AND LOWER(o.tracking_code) LIKE ?))"
		args = append(args, like, like, like, like)
	}
	if f.Estado == "pagada" || f.Estado == "debe" || f.Estado == "vencida" || f.Estado == "cancelada" {
		query += " AND (" + posEstadoExpr + ") = ?"
		args = append(args, today, f.Estado)
	}
	query += " ORDER BY s.folio DESC LIMIT ?"
	args = append(args, limit)

	rows, err := posDB().Query(query, args...)
	if err != nil {
		return nil, PosSalesTotals{}, err
	}
	defer rows.Close()
	out := []PosSaleRow{}
	var t PosSalesTotals
	for rows.Next() {
		r, err := scanPosSaleRow(rows)
		if err != nil {
			return nil, t, err
		}
		out = append(out, r)
		if r.Cancelada {
			t.Canceladas++
			continue
		}
		t.Ventas++
		t.Total += r.Total
		t.Efectivo += r.Efectivo
		t.Tarjeta += r.Tarjeta
		t.Transferencia += r.Transferencia
		t.Otros += r.Vales + r.Cheque
		t.Pagado += r.Pagado
		t.Credito += r.Credito
		t.Saldo += r.Saldo
	}
	for _, v := range []*float64{&t.Total, &t.Efectivo, &t.Tarjeta, &t.Transferencia, &t.Otros, &t.Pagado, &t.Credito, &t.Saldo} {
		*v = round2(*v)
	}
	return out, t, rows.Err()
}

// PosSaleDetail: una venta con sus productos, pagos y abonos.
type PosSaleDetail struct {
	PosSaleRow
	Subtotal         float64            `json:"subtotal"`
	Descuento        float64            `json:"descuento"`
	Cambio           float64            `json:"cambio"`
	EfectivoRecibido float64            `json:"efectivo_recibido"`
	Referencia       string             `json:"referencia"`
	Productos        []PosSaleItem      `json:"productos"`
	CreditID         int64              `json:"credit_id,omitempty"`
	Abonos           []PosCreditPayment `json:"abonos"`
}

// LastPosSaleOfClient — la venta más reciente del cliente.
func LastPosSaleOfClient(userID uint, clientID int64) (*PosSaleDetail, error) {
	var folio int64
	err := posDB().QueryRow("SELECT folio FROM pos_sales WHERE user_id = ? AND client_id = ? ORDER BY created_at DESC, id DESC LIMIT 1", userID, clientID).Scan(&folio)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrPosSaleNotFound
	}
	if err != nil {
		return nil, err
	}
	return GetPosSale(userID, folio)
}

// GetPosSale trae el detalle de una venta (por folio del negocio).
func GetPosSale(userID uint, folio int64) (*PosSaleDetail, error) {
	db := posDB()
	row, err := scanPosSaleRow(db.QueryRow(posSaleRowSelect+" WHERE s.user_id = ? AND s.folio = ?", PosToday(), userID, folio))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrPosSaleNotFound
	}
	if err != nil {
		return nil, err
	}
	d := &PosSaleDetail{PosSaleRow: row, Productos: []PosSaleItem{}, Abonos: []PosCreditPayment{}}
	if err := db.QueryRow("SELECT subtotal, descuento, cambio, efectivo, referencia FROM pos_sales WHERE id = ?", row.ID).
		Scan(&d.Subtotal, &d.Descuento, &d.Cambio, &d.EfectivoRecibido, &d.Referencia); err != nil {
		return nil, err
	}
	irows, err := db.Query("SELECT COALESCE(inventory_id,0), clave, descripcion, cantidad, precio, descuento, importe FROM pos_sale_items WHERE sale_id = ? ORDER BY id", row.ID)
	if err != nil {
		return nil, err
	}
	for irows.Next() {
		var it PosSaleItem
		if err := irows.Scan(&it.InventoryID, &it.Clave, &it.Descripcion, &it.Cantidad, &it.Precio, &it.Descuento, &it.Importe); err != nil {
			irows.Close()
			return nil, err
		}
		d.Productos = append(d.Productos, it)
	}
	irows.Close()
	var creditID sql.NullInt64
	_ = db.QueryRow("SELECT id FROM pos_credits WHERE sale_id = ?", row.ID).Scan(&creditID)
	if creditID.Valid {
		d.CreditID = creditID.Int64
		today := PosToday()
		prows, err := db.Query(posPaymentSelect+" WHERE credit_id = ? ORDER BY id DESC", d.CreditID)
		if err != nil {
			return nil, err
		}
		defer prows.Close()
		for prows.Next() {
			p, err := scanPosPayment(prows, today)
			if err != nil {
				return nil, err
			}
			d.Abonos = append(d.Abonos, p)
		}
	}
	return d, nil
}

/* =========================================================
   CANCELAR UNA VENTA
   ========================================================= */

var (
	ErrPosVentaCancelada  = errors.New("esa venta ya estaba cancelada")
	ErrPosVentaConAbonos  = errors.New("esa venta tiene abonos: primero cancela los abonos en Punto de venta → Créditos y abonos")
	ErrPosMotivoRequerido = errors.New("escribe el motivo de la cancelación")
)

// CancelPosSale cancela la venta:
//   - regresa al inventario lo que se vendió, con su renglón en el kárdex;
//   - el crédito de esa venta queda en 0 (si tenía abonos vivos, primero
//     hay que cancelarlos);
//   - el dinero sale de la caja en el corte en el que se cancela.
func CancelPosSale(userID uint, folio int64, por, motivo string) error {
	motivo = cut(strings.TrimSpace(motivo), 200)
	if motivo == "" {
		return ErrPosMotivoRequerido
	}
	tx, err := posDB().Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var id int64
	var cancelada bool
	err = tx.QueryRow("SELECT id, cancelada FROM pos_sales WHERE user_id = ? AND folio = ? FOR UPDATE", userID, folio).Scan(&id, &cancelada)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrPosSaleNotFound
	}
	if err != nil {
		return err
	}
	if cancelada {
		return ErrPosVentaCancelada
	}
	var abonos int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM pos_credit_payments p JOIN pos_credits cr ON cr.id = p.credit_id
		WHERE cr.sale_id = ? AND p.cancelado = 0`, id).Scan(&abonos); err != nil {
		return err
	}
	if abonos > 0 {
		return ErrPosVentaConAbonos
	}
	now := posNow()

	rows, err := tx.Query(`SELECT it.inventory_id, it.cantidad FROM pos_sale_items it
		JOIN inv_articulos inv ON inv.id = it.inventory_id
		WHERE it.sale_id = ? AND inv.servicio = 0 AND inv.user_id = ?`, id, userID)
	if err != nil {
		return err
	}
	type back struct {
		id   int64
		cant int
	}
	var items []back
	for rows.Next() {
		var b back
		if err := rows.Scan(&b.id, &b.cant); err != nil {
			rows.Close()
			return err
		}
		items = append(items, b)
	}
	rows.Close()
	for _, b := range items {
		var antes int
		if err := tx.QueryRow("SELECT existencia FROM inv_articulos WHERE id = ? FOR UPDATE", b.id).Scan(&antes); err != nil {
			return err
		}
		if _, err := tx.Exec("UPDATE inv_articulos SET existencia = existencia + ?, updated_at = ? WHERE id = ?", b.cant, now, b.id); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO inv_movimientos (user_id, item_id, tipo, cantidad, existencia_antes, existencia_despues, venta_id, comentario, usuario, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, userID, b.id, InvMovIn, b.cant, antes, antes+b.cant, id,
			fmt.Sprintf("Cancelación del ticket %d", folio), por, now); err != nil {
			return err
		}
	}
	if _, err := tx.Exec("UPDATE pos_credits SET saldo = 0 WHERE sale_id = ?", id); err != nil {
		return err
	}
	if _, err := tx.Exec("UPDATE pos_sales SET cancelada = 1, cancelada_at = ?, cancelada_por = ?, cancel_motivo = ? WHERE id = ?",
		now, por, motivo, id); err != nil {
		return err
	}
	return tx.Commit()
}

/* =========================================================
   PLANTILLA DEL TICKET (la usa ticket-render en el navegador)
   ========================================================= */

// GetPosTicketTemplate — JSON de la plantilla guardada ("" = la de fábrica).
func GetPosTicketTemplate(userID uint) (data, updatedBy, updatedAt string, err error) {
	err = posDB().QueryRow("SELECT data, updated_by, DATE_FORMAT(updated_at, '%Y-%m-%dT%H:%i:%s') FROM pos_ticket_templates WHERE user_id = ?", userID).
		Scan(&data, &updatedBy, &updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return "", "", "", nil
	}
	return
}

// SavePosTicketTemplate crea o reemplaza la plantilla del negocio.
func SavePosTicketTemplate(userID uint, data, by string) error {
	_, err := posDB().Exec(`INSERT INTO pos_ticket_templates (user_id, data, updated_by, updated_at) VALUES (?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE data = VALUES(data), updated_by = VALUES(updated_by), updated_at = VALUES(updated_at)`,
		userID, data, by, posNow())
	return err
}
