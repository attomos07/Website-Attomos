package models

// inventory_pro.go — lo que se agregó al Inventario después del port
// inicial (traído de Avante Optics, adaptado a multi-negocio con user_id):
//
//   - Ópticas: código de color (01, 02…) e identificador de material
//     (ARMT metal / ARZL pasta) para la clave automática del armazón
//     (ARZL-GUE-2702-07), subidentificador del material (ACETATO, TR90…)
//     para el reporte de Ventas, y quitar colores / materiales de la lista.
//   - Precio y promoción (% en el Punto de venta) por categoría o material,
//     con reglas que también se aplican a los artículos nuevos.
//   - Eliminar varios artículos de un jalón (solo el dueño).
//   - Eliminar movimientos del kárdex (solo el dueño) y el registro de lo
//     que se borró (Movimientos → «Borrados»).

import (
	"database/sql"
	"errors"
	"fmt"
	"log"
	"regexp"
	"strconv"
	"strings"
	"time"
)

/* =========================================================
   TABLAS NUEVAS (AutoMigrate, ver InventoryModels)
   ========================================================= */

// InventoryRuleRecord — "mismo precio" o "promoción" para una categoría o
// un material, que también se aplica a los artículos que se den de alta
// después.
type InventoryRuleRecord struct {
	ID        int64     `gorm:"primaryKey;autoIncrement"`
	UserID    uint      `gorm:"not null;uniqueIndex:uq_inv_regla,priority:1"`
	Tipo      string    `gorm:"size:10;not null;uniqueIndex:uq_inv_regla,priority:2"` // precio | promo
	Campo     string    `gorm:"size:12;not null;uniqueIndex:uq_inv_regla,priority:3"` // categoria | material
	Valor     string    `gorm:"size:60;not null;uniqueIndex:uq_inv_regla,priority:4"` // id de la categoría o nombre del material
	Monto     float64   `gorm:"type:decimal(10,2);not null;default:0"`
	Usuario   string    `gorm:"size:120;not null;default:''"`
	CreatedAt time.Time `gorm:"type:datetime"`
}

func (InventoryRuleRecord) TableName() string { return "inv_reglas" }

// InventoryMovDeletedRecord — copia de cada movimiento del kárdex que se
// borró, con quién, cuándo y si se deshizo la existencia.
type InventoryMovDeletedRecord struct {
	ID                int64     `gorm:"primaryKey;autoIncrement"`
	UserID            uint      `gorm:"not null;index:idx_inv_borr_fecha,priority:1"`
	Lote              string    `gorm:"size:24;not null;index"`
	MovID             int64     `gorm:"not null;default:0"`
	ItemID            int64     `gorm:"not null;default:0;index"`
	Clave             string    `gorm:"size:60;not null;default:''"`
	Descripcion       string    `gorm:"size:255;not null;default:''"`
	Tipo              string    `gorm:"size:20;not null"`
	Cantidad          int       `gorm:"not null;default:0"`
	ExistenciaAntes   int       `gorm:"not null;default:0"`
	ExistenciaDespues int       `gorm:"not null;default:0"`
	Comentario        string    `gorm:"size:255;not null;default:''"`
	Usuario           string    `gorm:"size:120;not null;default:''"`
	MovFecha          *string   `gorm:"type:datetime"`
	ExistHoy          *int      // existencia del artículo antes de borrar
	ExistQueda        *int      // con cuánta quedó
	Revertido         bool      `gorm:"not null;default:false"`
	BorradoPor        string    `gorm:"size:120;not null;default:''"`
	BorradoDesde      string    `gorm:"size:20;not null;default:''"`
	BorradoAt         time.Time `gorm:"type:datetime;index:idx_inv_borr_fecha,priority:2"`
}

func (InventoryMovDeletedRecord) TableName() string { return "inv_mov_borrados" }

/* =========================================================
   CÓDIGOS DE COLOR (clave automática del armazón)
   ========================================================= */

var (
	ErrInvColorNotFound    = errors.New("color no encontrado")
	ErrInvMaterialNotFound = errors.New("material no encontrado")
	ErrInvGroupInvalid     = errors.New("grupo inválido")
)

// nextInvColorCode: el siguiente código libre del negocio ("01", "02"…;
// de 100 en adelante ya son 3 dígitos). Los códigos de colores que se
// borraron no se vuelven a dar.
func nextInvColorCode(userID uint) string {
	db := invDB()
	var max int
	if err := db.QueryRow(`SELECT COALESCE(MAX(CAST(codigo AS UNSIGNED)), 0) FROM inv_colores WHERE user_id = ? AND codigo <> ''`, userID).Scan(&max); err != nil {
		return ""
	}
	var used int
	_ = db.QueryRow(`SELECT color_codigo_max FROM inv_settings WHERE user_id = ?`, userID).Scan(&used)
	if used > max {
		max = used
	}
	return fmt.Sprintf("%02d", max+1)
}

// fillInvColorCodes le da su código a los colores que todavía no tienen
// (la paleta de inicio y los colores de antes de la clave automática), en
// el orden de la paleta.
func fillInvColorCodes(userID uint) {
	db := invDB()
	rows, err := db.Query(`SELECT id FROM inv_colores WHERE user_id = ? AND codigo = '' ORDER BY orden, id`, userID)
	if err != nil {
		return
	}
	var ids []int64
	for rows.Next() {
		var id int64
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	rows.Close()
	for _, id := range ids {
		code := nextInvColorCode(userID)
		if code == "" {
			return
		}
		if _, err := db.Exec(`UPDATE inv_colores SET codigo = ? WHERE id = ? AND user_id = ?`, code, id, userID); err != nil {
			log.Printf("inventario: no se pudo dar código al color %d: %v", id, err)
			return
		}
	}
}

// DeleteInvColor lo quita de la paleta. Los artículos que ya lo tienen lo
// conservan (se guarda por nombre) y su código no se le vuelve a dar a
// otro color.
func DeleteInvColor(userID uint, id int64) error {
	db := invDB()
	var codigo string
	err := db.QueryRow(`SELECT codigo FROM inv_colores WHERE id = ? AND user_id = ?`, id, userID).Scan(&codigo)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrInvColorNotFound
	}
	if err != nil {
		return err
	}
	if n, _ := strconv.Atoi(codigo); n > 0 {
		_, _ = db.Exec(`INSERT INTO inv_settings (user_id, seeded_at, color_codigo_max) VALUES (?, ?, ?)
			ON DUPLICATE KEY UPDATE color_codigo_max = GREATEST(color_codigo_max, VALUES(color_codigo_max))`, userID, invNow(), n)
	}
	_, err = db.Exec(`DELETE FROM inv_colores WHERE id = ? AND user_id = ?`, id, userID)
	return err
}

/* =========================================================
   MATERIALES: identificador (ARMT / ARZL) y subidentificador
   ========================================================= */

var invMetalRe = regexp.MustCompile(`(?i)metal|titan|acero|alumin|inox|monel|memoria`)

// InvMaterialIdentGuess: ARMT si el nombre suena a metal, ARZL si no.
func InvMaterialIdentGuess(nombre string) string {
	if invMetalRe.MatchString(nombre) {
		return "ARMT"
	}
	return "ARZL"
}

// fillInvMaterialIdents: los materiales que ya estaban (o los de inicio)
// toman ARMT si son metálicos y ARZL si no.
func fillInvMaterialIdents(userID uint) {
	db := invDB()
	rows, err := db.Query(`SELECT id, nombre FROM inv_materiales WHERE user_id = ? AND identificador = ''`, userID)
	if err != nil {
		return
	}
	type m struct {
		id     int64
		nombre string
	}
	var list []m
	for rows.Next() {
		var x m
		if rows.Scan(&x.id, &x.nombre) == nil {
			list = append(list, x)
		}
	}
	rows.Close()
	for _, x := range list {
		_, _ = db.Exec(`UPDATE inv_materiales SET identificador = ? WHERE id = ? AND user_id = ?`, InvMaterialIdentGuess(x.nombre), x.id, userID)
	}
}

// UpdateInvMaterial cambia su identificador (ARMT/ARZL) y subidentificador.
func UpdateInvMaterial(userID uint, id int64, identificador, sub string) (*InvMaterial, error) {
	db := invDB()
	var m InvMaterial
	err := db.QueryRow(`SELECT id, nombre FROM inv_materiales WHERE id = ? AND user_id = ?`, id, userID).Scan(&m.ID, &m.Nombre)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrInvMaterialNotFound
	}
	if err != nil {
		return nil, err
	}
	if _, err := db.Exec(`UPDATE inv_materiales SET identificador = ?, subidentificador = ? WHERE id = ? AND user_id = ?`, identificador, sub, id, userID); err != nil {
		return nil, err
	}
	m.Identificador, m.Subidentificador = identificador, sub
	return &m, nil
}

// DeleteInvMaterial lo quita de la lista. Los artículos que ya lo tienen
// lo conservan (se guarda por nombre).
func DeleteInvMaterial(userID uint, id int64) error {
	res, err := invDB().Exec(`DELETE FROM inv_materiales WHERE id = ? AND user_id = ?`, id, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrInvMaterialNotFound
	}
	return nil
}

/* =========================================================
   PRECIO Y PROMOCIÓN POR GRUPO (Inventario → Artículos)
   "Todos los de la categoría LÍNEA valen $500" o "20 % de promoción a
   todos los de acetato": se aplica de una vez a los artículos que ya
   están y, si se marca, queda como regla para los que se den de alta
   después (inv_reglas).
   ========================================================= */

const (
	InvRulePrice = "precio"
	InvRulePromo = "promo"

	InvFieldCategory = "categoria"
	InvFieldMaterial = "material"
)

type InvRule struct {
	ID        int64   `json:"id"`
	Tipo      string  `json:"tipo"`  // precio | promo
	Campo     string  `json:"campo"` // categoria | material
	Valor     string  `json:"valor"` // id de la categoría o nombre del material
	Etiqueta  string  `json:"etiqueta"`
	Monto     float64 `json:"monto"`
	Usuario   string  `json:"usuario"`
	CreatedAt string  `json:"created_at"`
}

// invGroupWhere: el filtro SQL de los artículos de esa categoría o material.
func invGroupWhere(userID uint, campo, valor string) (string, []interface{}, error) {
	switch campo {
	case InvFieldCategory:
		id, err := strconv.ParseInt(valor, 10, 64)
		if err != nil || id <= 0 {
			return "", nil, ErrInvGroupInvalid
		}
		return "user_id = ? AND categoria_id = ?", []interface{}{userID, id}, nil
	case InvFieldMaterial:
		v := strings.TrimSpace(valor)
		if v == "" || strings.Contains(v, ",") {
			return "", nil, ErrInvGroupInvalid
		}
		// materiales se guarda "Metal,Acetato": se busca el nombre completo.
		return "user_id = ? AND CONCAT(',', LOWER(materiales), ',') LIKE CONCAT('%,', LOWER(?), ',%')", []interface{}{userID, v}, nil
	}
	return "", nil, ErrInvGroupInvalid
}

// ApplyInvGroup aplica la acción a todos los artículos del grupo y regresa
// cuántos cambiaron. accion: precio | promo | quitar_promo.
// recordar = también para los que se den de alta después (regla).
func ApplyInvGroup(userID uint, campo, valor, accion string, monto float64, recordar bool, usuario string) (int64, error) {
	where, args, err := invGroupWhere(userID, campo, valor)
	if err != nil {
		return 0, err
	}
	var set string
	var setArgs []interface{}
	tipo := ""
	switch accion {
	case "precio":
		set, setArgs, tipo = "precio_1 = ?, updated_at = ?", []interface{}{invRound2(monto), invNow()}, InvRulePrice
	case "promo":
		set, setArgs, tipo = "promo_pct = ?, updated_at = ?", []interface{}{invRound2(monto), invNow()}, InvRulePromo
	case "quitar_promo":
		set, setArgs = "promo_pct = 0, updated_at = ?", []interface{}{invNow()}
	default:
		return 0, errors.New("acción inválida")
	}
	tx, err := invDB().Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	res, err := tx.Exec("UPDATE inv_articulos SET "+set+" WHERE "+where, append(setArgs, args...)...)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	valor = strings.TrimSpace(valor)
	switch {
	case accion == "quitar_promo":
		if _, err := tx.Exec(`DELETE FROM inv_reglas WHERE user_id = ? AND tipo = ? AND campo = ? AND LOWER(valor) = LOWER(?)`, userID, InvRulePromo, campo, valor); err != nil {
			return 0, err
		}
	case recordar:
		if _, err := tx.Exec(
			`INSERT INTO inv_reglas (user_id, tipo, campo, valor, monto, usuario, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
			 ON DUPLICATE KEY UPDATE monto = VALUES(monto), usuario = VALUES(usuario), created_at = VALUES(created_at)`,
			userID, tipo, campo, valor, invRound2(monto), usuario, invNow(),
		); err != nil {
			return 0, err
		}
	default:
		// Aplicado solo a los que ya están: si había regla de ese tipo para el
		// grupo, se quita (si no, los nuevos tomarían el valor viejo).
		if _, err := tx.Exec(`DELETE FROM inv_reglas WHERE user_id = ? AND tipo = ? AND campo = ? AND LOWER(valor) = LOWER(?)`, userID, tipo, campo, valor); err != nil {
			return 0, err
		}
	}
	return n, tx.Commit()
}

// ListInvRules: las reglas vigentes del negocio, con el nombre de la categoría.
func ListInvRules(userID uint) ([]InvRule, error) {
	rows, err := invDB().Query(`
		SELECT r.id, r.tipo, r.campo, r.valor, COALESCE(c.nombre, r.valor), r.monto, r.usuario,
		       COALESCE(DATE_FORMAT(r.created_at, '%Y-%m-%dT%H:%i:%s'), '')
		FROM inv_reglas r
		LEFT JOIN inv_categorias c ON r.campo = 'categoria' AND c.id = r.valor AND c.user_id = r.user_id
		WHERE r.user_id = ?
		ORDER BY r.tipo, r.campo, r.valor`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []InvRule{}
	for rows.Next() {
		var r InvRule
		if err := rows.Scan(&r.ID, &r.Tipo, &r.Campo, &r.Valor, &r.Etiqueta, &r.Monto, &r.Usuario, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// DeleteInvRule quita la regla (los artículos se quedan como están).
func DeleteInvRule(userID uint, id int64) error {
	_, err := invDB().Exec(`DELETE FROM inv_reglas WHERE id = ? AND user_id = ?`, id, userID)
	return err
}

// invRuleApplies: ¿la regla es para la categoría o algún material del artículo?
func invRuleApplies(r InvRule, a InvItem) bool {
	switch r.Campo {
	case InvFieldCategory:
		return a.CategoriaID > 0 && r.Valor == strconv.FormatInt(a.CategoriaID, 10)
	case InvFieldMaterial:
		for _, m := range a.Materiales {
			if strings.EqualFold(strings.TrimSpace(m), r.Valor) {
				return true
			}
		}
	}
	return false
}

// invPromoFromRules: la promoción más alta que le toca al artículo nuevo.
func invPromoFromRules(userID uint, a InvItem) float64 {
	rs, err := ListInvRules(userID)
	if err != nil {
		return 0
	}
	best := 0.0
	for _, r := range rs {
		if r.Tipo == InvRulePromo && invRuleApplies(r, a) && r.Monto > best {
			best = r.Monto
		}
	}
	return best
}

/* =========================================================
   ELIMINAR VARIOS ARTÍCULOS (solo el dueño)
   ========================================================= */

// DeleteInvItemsBulk borra definitivamente varios artículos de un jalón
// (Inventario → seleccionar → Eliminar). A diferencia de DeleteInvItem, NO
// pide existencia en 0: el artículo desaparece con todo y su existencia.
// Se borran sus fotos; los movimientos del kárdex se conservan. Regresa
// cuántos se borraron y las llaves de las fotos a quitar del bucket.
func DeleteInvItemsBulk(userID uint, ids []int64) (int, []string, error) {
	if len(ids) == 0 {
		return 0, nil, nil
	}
	ph := strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",")
	args := []interface{}{userID}
	for _, id := range ids {
		args = append(args, id)
	}
	var keys []string
	for _, id := range ids {
		keys = append(keys, InvPhotoKeysOfItem(userID, id)...)
	}
	tx, err := invDB().Begin()
	if err != nil {
		return 0, nil, err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM inv_fotos WHERE user_id = ? AND item_id IN (`+ph+`)`, args...); err != nil {
		return 0, nil, err
	}
	res, err := tx.Exec(`DELETE FROM inv_articulos WHERE user_id = ? AND id IN (`+ph+`)`, args...)
	if err != nil {
		return 0, nil, err
	}
	n, _ := res.RowsAffected()
	if err := tx.Commit(); err != nil {
		return 0, nil, err
	}
	return int(n), keys, nil
}

/* =========================================================
   ELIMINAR MOVIMIENTOS DEL KÁRDEX (solo el dueño)
   ========================================================= */

var ErrInvMovFromSale = errors.New("los movimientos de ventas y pedidos no se borran aquí: cancela la venta o el pedido")

type InvMovDeleteResult struct {
	Eliminados int  `json:"eliminados"`
	Articulos  int  `json:"articulos"` // artículos a los que se les corrigió la existencia
	Revertido  bool `json:"revertido"`
}

// DeleteInvMovements borra definitivamente movimientos del kárdex (para
// quitar pruebas). Con revertir=true también deshace lo que hizo cada
// movimiento en la existencia (una entrada de +5 resta 5, una salida de −3
// suma 3). Los folios de ajuste que se quedan sin movimientos también se
// borran.
//
// A diferencia de Avante, aquí NO se borran tickets: los movimientos de
// ventas y pedidos no se pueden borrar (se cancela la venta o el pedido).
//
// Todo va en una sola transacción: si un artículo quedaría en negativo,
// no se borra nada. Antes de borrar queda una copia en inv_mov_borrados.
func DeleteInvMovements(userID uint, ids []int64, revertir bool, quien string) (*InvMovDeleteResult, error) {
	out := &InvMovDeleteResult{Revertido: revertir}
	if len(ids) == 0 {
		return out, nil
	}
	tx, err := invDB().Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	ph := strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",")
	args := []interface{}{userID}
	for _, id := range ids {
		args = append(args, id)
	}
	rows, err := tx.Query(`SELECT id, item_id, tipo, cantidad, COALESCE(ajuste_id, 0) FROM inv_movimientos
		WHERE user_id = ? AND id IN (`+ph+`) FOR UPDATE`, args...)
	if err != nil {
		return nil, err
	}
	porArticulo := map[int64]int{} // item_id → suma de cantidades a deshacer
	ajustes := map[int64]bool{}
	found := []interface{}{}
	for rows.Next() {
		var id, item, aj int64
		var tipo string
		var cant int
		if err := rows.Scan(&id, &item, &tipo, &cant, &aj); err != nil {
			rows.Close()
			return nil, err
		}
		if tipo == InvMovSale || tipo == InvMovOrder {
			rows.Close()
			return nil, ErrInvMovFromSale
		}
		found = append(found, id)
		porArticulo[item] += cant
		if aj > 0 {
			ajustes[aj] = true
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(found) == 0 {
		return out, nil
	}

	// Antes de borrar: copia de lo que se va a quitar, con quién y cuándo.
	lote := logInvMovDeleted(tx, userID, found, revertir, quien, "movimientos")

	if revertir {
		for item, cant := range porArticulo {
			if cant == 0 {
				continue
			}
			var actual int
			var desc string
			var servicio bool
			err := tx.QueryRow("SELECT existencia, descripcion, servicio FROM inv_articulos WHERE id = ? AND user_id = ? FOR UPDATE", item, userID).Scan(&actual, &desc, &servicio)
			if errors.Is(err, sql.ErrNoRows) || servicio {
				continue // artículo eliminado o servicio: no hay existencia que corregir
			}
			if err != nil {
				return nil, err
			}
			nueva := actual - cant
			if nueva < 0 {
				return nil, fmt.Errorf("«%s» quedaría con existencia %d (hoy tiene %d). Quita ese movimiento de la selección o bórralo sin regresar la existencia", desc, nueva, actual)
			}
			if _, err := tx.Exec("UPDATE inv_articulos SET existencia = ?, updated_at = ? WHERE id = ? AND user_id = ?", nueva, invNow(), item, userID); err != nil {
				return nil, err
			}
			out.Articulos++
		}
	}

	// Con qué existencia quedó cada artículo.
	if lote != "" {
		_, _ = tx.Exec(`UPDATE inv_mov_borrados b JOIN inv_articulos i ON i.id = b.item_id AND i.user_id = b.user_id
			SET b.exist_queda = i.existencia WHERE b.user_id = ? AND b.lote = ?`, userID, lote)
	}

	ph = strings.TrimSuffix(strings.Repeat("?,", len(found)), ",")
	res, err := tx.Exec("DELETE FROM inv_movimientos WHERE user_id = ? AND id IN ("+ph+")", append([]interface{}{userID}, found...)...)
	if err != nil {
		return nil, err
	}
	n, _ := res.RowsAffected()
	out.Eliminados = int(n)

	// Folios de ajuste que se quedaron sin movimientos.
	for aj := range ajustes {
		var left int
		if err := tx.QueryRow("SELECT COUNT(*) FROM inv_movimientos WHERE ajuste_id = ?", aj).Scan(&left); err == nil && left == 0 {
			_, _ = tx.Exec("DELETE FROM inv_ajustes WHERE id = ? AND user_id = ?", aj, userID)
		}
	}
	return out, tx.Commit()
}

// logInvMovDeleted copia (dentro de la misma transacción, antes de borrar)
// los movimientos que se van a quitar. Regresa el lote ("" si no se pudo
// guardar: el borrado sigue igual).
func logInvMovDeleted(tx *sql.Tx, userID uint, movs []interface{}, revertir bool, quien, desde string) string {
	lote := strconv.FormatInt(time.Now().UnixNano(), 36)
	ph := strings.TrimSuffix(strings.Repeat("?,", len(movs)), ",")
	args := append([]interface{}{lote, revertir, quien, desde, invNow(), userID}, movs...)
	if _, err := tx.Exec(`INSERT INTO inv_mov_borrados
		(user_id, lote, mov_id, item_id, clave, descripcion, tipo, cantidad, existencia_antes, existencia_despues,
		 comentario, usuario, mov_fecha, exist_hoy, revertido, borrado_por, borrado_desde, borrado_at)
		SELECT m.user_id, ?, m.id, m.item_id, COALESCE(i.clave, ''), COALESCE(i.descripcion, ''), m.tipo, m.cantidad,
		       m.existencia_antes, m.existencia_despues, m.comentario, m.usuario, m.created_at,
		       i.existencia, ?, ?, ?, ?
		FROM inv_movimientos m LEFT JOIN inv_articulos i ON i.id = m.item_id
		WHERE m.user_id = ? AND m.id IN (`+ph+`)`, args...); err != nil {
		log.Printf("inventario: no se pudo guardar el registro de movimientos borrados: %v", err)
		return ""
	}
	return lote
}

type InvMovDeletedRow struct {
	MovID       int64  `json:"mov_id"`
	ItemID      int64  `json:"item_id"`
	Clave       string `json:"clave"`
	Descripcion string `json:"descripcion"`
	Tipo        string `json:"tipo"`
	Cantidad    int    `json:"cantidad"`
	Antes       int    `json:"antes"`
	Despues     int    `json:"despues"`
	Comentario  string `json:"comentario"`
	Usuario     string `json:"usuario"`
	Fecha       string `json:"fecha,omitempty"` // cuándo se hizo el movimiento
	ExistHoy    *int   `json:"exist_hoy,omitempty"`
	ExistQueda  *int   `json:"exist_queda,omitempty"`
}

// InvMovDeletedBatch: un borrado (lo que se quitó de un jalón).
type InvMovDeletedBatch struct {
	Lote      string             `json:"lote"`
	Fecha     string             `json:"fecha"`
	Por       string             `json:"por"`
	Desde     string             `json:"desde"` // movimientos
	Revertido bool               `json:"revertido"`
	Movs      []InvMovDeletedRow `json:"movimientos"`
}

// ListInvMovDeleted: los borrados más recientes primero (q filtra por
// clave, descripción o quién borró).
func ListInvMovDeleted(userID uint, q string, limit int) ([]InvMovDeletedBatch, error) {
	if limit <= 0 || limit > 200 {
		limit = 60
	}
	db := invDB()
	where, args := "WHERE user_id = ?", []interface{}{userID}
	if q = strings.ToLower(strings.TrimSpace(q)); q != "" {
		like := "%" + q + "%"
		where += ` AND lote IN (SELECT lote FROM inv_mov_borrados WHERE user_id = ? AND (LOWER(clave) LIKE ? OR LOWER(descripcion) LIKE ? OR LOWER(borrado_por) LIKE ?))`
		args = append(args, userID, like, like, like)
	}
	// Primero los lotes, luego sus renglones.
	rows, err := db.Query(`SELECT lote, DATE_FORMAT(MAX(borrado_at), '%Y-%m-%dT%H:%i:%s'), MAX(borrado_por), MAX(borrado_desde), MAX(revertido)
		FROM inv_mov_borrados `+where+` GROUP BY lote ORDER BY MAX(borrado_at) DESC, MAX(id) DESC LIMIT `+strconv.Itoa(limit), args...)
	if err != nil {
		return nil, err
	}
	out := []InvMovDeletedBatch{}
	idx := map[string]int{}
	for rows.Next() {
		var l InvMovDeletedBatch
		if err := rows.Scan(&l.Lote, &l.Fecha, &l.Por, &l.Desde, &l.Revertido); err != nil {
			rows.Close()
			return nil, err
		}
		l.Movs = []InvMovDeletedRow{}
		idx[l.Lote] = len(out)
		out = append(out, l)
	}
	rows.Close()
	if len(out) == 0 {
		return out, nil
	}
	lotes := []interface{}{userID}
	for _, l := range out {
		lotes = append(lotes, l.Lote)
	}
	ph := strings.TrimSuffix(strings.Repeat("?,", len(out)), ",")
	rows, err = db.Query(`SELECT lote, mov_id, item_id, clave, descripcion, tipo, cantidad, existencia_antes, existencia_despues,
			comentario, usuario, COALESCE(DATE_FORMAT(mov_fecha, '%Y-%m-%dT%H:%i:%s'), ''), exist_hoy, exist_queda
		FROM inv_mov_borrados WHERE user_id = ? AND lote IN (`+ph+`) ORDER BY id`, lotes...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var lote string
		var r InvMovDeletedRow
		var hoy, queda sql.NullInt64
		if err := rows.Scan(&lote, &r.MovID, &r.ItemID, &r.Clave, &r.Descripcion, &r.Tipo, &r.Cantidad, &r.Antes, &r.Despues,
			&r.Comentario, &r.Usuario, &r.Fecha, &hoy, &queda); err != nil {
			return nil, err
		}
		if hoy.Valid {
			v := int(hoy.Int64)
			r.ExistHoy = &v
		}
		if queda.Valid {
			v := int(queda.Int64)
			r.ExistQueda = &v
		}
		if i, ok := idx[lote]; ok {
			out[i].Movs = append(out[i].Movs, r)
		}
	}
	return out, rows.Err()
}
