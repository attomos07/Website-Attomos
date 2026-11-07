package models

// inventory.go — Inventario (portado del panel de Inventario de Avante Optics,
// que a su vez imita el módulo de inventario de SICAR):
//
//   - Artículos con departamento/categoría, 4 precios con mayoreo, existencia,
//     mínimo/máximo, localización y fotos.
//   - Ajustes de existencia (entrada, salida, fijar, inventario físico), cada
//     uno con su folio (consecutivo POR NEGOCIO).
//   - Kárdex: cada cambio de existencia queda en inv_movimientos.
//   - Solo giro "optica": tipo de armazón, mica (oftálmico / de sol), color(es)
//     y material(es) del armazón.
//
// Diferencia con Avante: Attomos es multi-negocio, así que TODAS las tablas
// llevan user_id (el dueño que se registró) y cada consulta filtra por él.
// Las tablas las crea AutoMigrate con los structs *Record de abajo; la lógica
// usa SQL directo (igual que en Avante) sobre el *sql.DB de GORM.

import (
	"database/sql"
	"errors"
	"fmt"
	"log"
	"math"
	"strings"
	"time"

	"attomos/config"
)

/* =========================================================
   TABLAS (AutoMigrate)
   ========================================================= */

type InventorySettingsRecord struct {
	UserID   uint      `gorm:"primaryKey;autoIncrement:false"`
	SeededAt time.Time `gorm:"type:datetime"`
}

func (InventorySettingsRecord) TableName() string { return "inv_settings" }

type InventoryItemRecord struct {
	ID             int64     `gorm:"primaryKey;autoIncrement"`
	UserID         uint      `gorm:"not null;uniqueIndex:uq_inv_art_clave,priority:1;index:idx_inv_art_user"`
	Clave          string    `gorm:"size:60;not null;uniqueIndex:uq_inv_art_clave,priority:2"`
	ClaveAlterna   string    `gorm:"size:60;not null;default:''"`
	Descripcion    string    `gorm:"size:200;not null"`
	DepartamentoID *int64    `gorm:"index"`
	CategoriaID    *int64    `gorm:"index"`
	UnidadCompra   string    `gorm:"size:12;not null;default:'PZA'"`
	UnidadVenta    string    `gorm:"size:12;not null;default:'PZA'"`
	Factor         float64   `gorm:"type:decimal(10,3);not null;default:1"`
	Servicio       bool      `gorm:"not null;default:false"`
	IVA            bool      `gorm:"column:iva;not null;default:true"`
	PrecioCompra   float64   `gorm:"type:decimal(12,2);not null;default:0"`
	Precio1        float64   `gorm:"column:precio_1;type:decimal(12,2);not null;default:0"`
	Precio2        float64   `gorm:"column:precio_2;type:decimal(12,2);not null;default:0"`
	Precio3        float64   `gorm:"column:precio_3;type:decimal(12,2);not null;default:0"`
	Precio4        float64   `gorm:"column:precio_4;type:decimal(12,2);not null;default:0"`
	Mayoreo2       int       `gorm:"column:mayoreo_2;not null;default:0"`
	Mayoreo3       int       `gorm:"column:mayoreo_3;not null;default:0"`
	Mayoreo4       int       `gorm:"column:mayoreo_4;not null;default:0"`
	Existencia     int       `gorm:"not null;default:0"`
	InvMinimo      int       `gorm:"not null;default:0"`
	InvMaximo      int       `gorm:"not null;default:0"`
	Localizacion   string    `gorm:"size:60;not null;default:''"`
	TipoArmazon    string    `gorm:"size:60;not null;default:''"`
	ColorPrincipal string    `gorm:"size:40;not null;default:''"`
	ColoresExtra   string    `gorm:"size:120;not null;default:''"`
	MicaTipo       string    `gorm:"size:12;not null;default:''"`
	Materiales     string    `gorm:"size:160;not null;default:''"`
	CreatedAt      time.Time `gorm:"type:datetime"`
	UpdatedAt      time.Time `gorm:"type:datetime"`
}

func (InventoryItemRecord) TableName() string { return "inv_articulos" }

type InventoryDepartmentRecord struct {
	ID        int64     `gorm:"primaryKey;autoIncrement"`
	UserID    uint      `gorm:"not null;uniqueIndex:uq_inv_dep,priority:1"`
	Nombre    string    `gorm:"size:60;not null;uniqueIndex:uq_inv_dep,priority:2"`
	CreatedAt time.Time `gorm:"type:datetime"`
}

func (InventoryDepartmentRecord) TableName() string { return "inv_departamentos" }

type InventoryCategoryRecord struct {
	ID             int64     `gorm:"primaryKey;autoIncrement"`
	UserID         uint      `gorm:"not null;index"`
	DepartamentoID int64     `gorm:"not null;uniqueIndex:uq_inv_cat,priority:1"`
	Nombre         string    `gorm:"size:60;not null;uniqueIndex:uq_inv_cat,priority:2"`
	Comision       float64   `gorm:"type:decimal(5,2);not null;default:0"`
	CreatedAt      time.Time `gorm:"type:datetime"`
}

func (InventoryCategoryRecord) TableName() string { return "inv_categorias" }

type InventoryAdjustmentRecord struct {
	ID         int64     `gorm:"primaryKey;autoIncrement"`
	UserID     uint      `gorm:"not null;uniqueIndex:uq_inv_aj_folio,priority:1;index:idx_inv_aj_fecha,priority:1"`
	Folio      int64     `gorm:"not null;uniqueIndex:uq_inv_aj_folio,priority:2"`
	Tipo       string    `gorm:"size:12;not null;default:'fisico'"`
	Comentario string    `gorm:"size:255;not null;default:''"`
	Usuario    string    `gorm:"size:120;not null;default:''"`
	Articulos  int       `gorm:"not null;default:0"`
	CreatedAt  time.Time `gorm:"type:datetime;index:idx_inv_aj_fecha,priority:2"`
}

func (InventoryAdjustmentRecord) TableName() string { return "inv_ajustes" }

type InventoryMovementRecord struct {
	ID                int64  `gorm:"primaryKey;autoIncrement"`
	UserID            uint   `gorm:"not null;index:idx_inv_mov_fecha,priority:1"`
	ItemID            int64  `gorm:"not null;index:idx_inv_mov_item"`
	Tipo              string `gorm:"size:20;not null"`
	Cantidad          int    `gorm:"not null;default:0"`
	ExistenciaAntes   int    `gorm:"not null;default:0"`
	ExistenciaDespues int    `gorm:"not null;default:0"`
	AjusteID          *int64 `gorm:"index"`
	VentaID           *int64
	Comentario        string    `gorm:"size:255;not null;default:''"`
	Usuario           string    `gorm:"size:120;not null;default:''"`
	CreatedAt         time.Time `gorm:"type:datetime;index:idx_inv_mov_fecha,priority:2"`
}

func (InventoryMovementRecord) TableName() string { return "inv_movimientos" }

type InventoryPhotoRecord struct {
	ID        int64     `gorm:"primaryKey;autoIncrement"`
	UserID    uint      `gorm:"not null;index"`
	ItemID    int64     `gorm:"not null;index:idx_inv_fotos_item,priority:1"`
	ObjectKey string    `gorm:"size:255;not null"`
	CType     string    `gorm:"column:ctype;size:40;not null;default:'image/jpeg'"`
	Orden     int       `gorm:"not null;default:0;index:idx_inv_fotos_item,priority:2"`
	CreatedAt time.Time `gorm:"type:datetime"`
}

func (InventoryPhotoRecord) TableName() string { return "inv_fotos" }

// Solo giro "optica": paleta de colores, materiales y tipos de armazón.
type InventoryColorRecord struct {
	ID     int64  `gorm:"primaryKey;autoIncrement"`
	UserID uint   `gorm:"not null;uniqueIndex:uq_inv_color,priority:1"`
	Nombre string `gorm:"size:30;not null;uniqueIndex:uq_inv_color,priority:2"`
	Hex    string `gorm:"size:7;not null;default:'#888888'"`
	Orden  int    `gorm:"not null;default:0"`
}

func (InventoryColorRecord) TableName() string { return "inv_colores" }

type InventoryMaterialRecord struct {
	ID     int64  `gorm:"primaryKey;autoIncrement"`
	UserID uint   `gorm:"not null;uniqueIndex:uq_inv_material,priority:1"`
	Nombre string `gorm:"size:30;not null;uniqueIndex:uq_inv_material,priority:2"`
	Orden  int    `gorm:"not null;default:0"`
}

func (InventoryMaterialRecord) TableName() string { return "inv_materiales" }

type InventoryFrameTypeRecord struct {
	ID     int64  `gorm:"primaryKey;autoIncrement"`
	UserID uint   `gorm:"not null;uniqueIndex:uq_inv_tipo_arm,priority:1"`
	Slug   string `gorm:"size:60;not null;uniqueIndex:uq_inv_tipo_arm,priority:2"`
	Nombre string `gorm:"size:60;not null"`
	Orden  int    `gorm:"not null;default:0"`
}

func (InventoryFrameTypeRecord) TableName() string { return "inv_tipos_armazon" }

// InventoryModels — para el AutoMigrate de main.go.
func InventoryModels() []interface{} {
	return []interface{}{
		&InventorySettingsRecord{}, &InventoryItemRecord{}, &InventoryDepartmentRecord{},
		&InventoryCategoryRecord{}, &InventoryAdjustmentRecord{}, &InventoryMovementRecord{},
		&InventoryPhotoRecord{}, &InventoryColorRecord{}, &InventoryMaterialRecord{},
		&InventoryFrameTypeRecord{},
	}
}

/* =========================================================
   UTILIDADES
   ========================================================= */

var (
	ErrInvItemNotFound      = errors.New("artículo no encontrado")
	ErrInvClaveTaken        = errors.New("ya existe un artículo con esa clave")
	ErrInvHasStock          = errors.New("el artículo todavía tiene existencia")
	ErrInvDeptNotFound      = errors.New("departamento no encontrado")
	ErrInvDeptDuplicate     = errors.New("ya existe un departamento con ese nombre")
	ErrInvDeptInUse         = errors.New("el departamento tiene artículos")
	ErrInvCatNotFound       = errors.New("categoría no encontrada")
	ErrInvCatDuplicate      = errors.New("ya existe esa categoría en el departamento")
	ErrInvCatInUse          = errors.New("la categoría tiene artículos")
	ErrInvNotEnoughStock    = errors.New("no hay tantas piezas en existencia")
	ErrInvAdjustmentMissing = errors.New("ajuste no encontrado")
	ErrInvService           = errors.New("los servicios no llevan existencia")
	ErrInvPhotoNotFound     = errors.New("foto no encontrada")
	ErrInvColorTaken        = errors.New("ese color ya existe")
	ErrInvMaterialTaken     = errors.New("ese material ya existe")
)

// Tipos de movimiento del kárdex.
const (
	InvMovInitial = "inicial" // existencia con la que se dio de alta
	InvMovIn      = "entrada" // Ajustar → entrada (compra, devolución…)
	InvMovOut     = "salida"  // Ajustar → salida (merma, dañado…)
	InvMovAdjust  = "ajuste"  // inventario físico / fijar existencia
	InvMovSale    = "venta"   // venta (para cuando se conecte un punto de venta)
)

// MaxInvPhotos — fotos por artículo.
const MaxInvPhotos = 6

// invLoc: fechas del inventario ("hoy", folios) en hora de Hermosillo,
// aunque el servidor (Railway) esté en UTC — igual que en Avante.
var invLoc = func() *time.Location {
	if l, err := time.LoadLocation("America/Hermosillo"); err == nil {
		return l
	}
	return time.FixedZone("MST", -7*3600)
}()

func invNow() string { return time.Now().In(invLoc).Format("2006-01-02 15:04:05") }

// InvToday — fecha de hoy ("YYYY-MM-DD").
func InvToday() string { return time.Now().In(invLoc).Format("2006-01-02") }

func invRound2(v float64) float64 { return math.Round(v*100) / 100 }

func invDB() *sql.DB {
	d, err := config.DB.DB()
	if err != nil {
		log.Printf("inventario: sin conexión a la base de datos: %v", err)
	}
	return d
}

func isInvDuplicateKey(err error) bool {
	return err != nil && strings.Contains(err.Error(), "1062")
}

func nullInvID(id int64) interface{} {
	if id <= 0 {
		return nil
	}
	return id
}

// NormalizeInvClave deja la clave en mayúsculas, sin espacios a los lados y
// con guiones en vez de espacios ("lnt gss flow" → "LNT-GSS-FLOW").
func NormalizeInvClave(c string) string {
	c = strings.ToUpper(strings.TrimSpace(c))
	return strings.Join(strings.Fields(c), "-")
}

// NormalizeInvName deja nombres de departamento/categoría en mayúsculas y
// sin espacios de más (como en SICAR).
func NormalizeInvName(s string) string {
	return strings.ToUpper(strings.Join(strings.Fields(s), " "))
}

// splitInvList: "Rojo,Negro" → ["Rojo","Negro"] (vacío → []).
func splitInvList(s string) []string {
	out := []string{}
	for _, c := range strings.Split(s, ",") {
		if c = strings.TrimSpace(c); c != "" {
			out = append(out, c)
		}
	}
	return out
}

// CleanInvMaterials deja la lista sin vacíos ni repetidos (máximo 4).
func CleanInvMaterials(in []string) ([]string, bool) {
	out := []string{}
	for _, m := range in {
		m = strings.Join(strings.Fields(strings.ReplaceAll(m, ",", " ")), " ")
		if m == "" {
			continue
		}
		if len([]rune(m)) > 30 {
			return nil, false
		}
		dup := false
		for _, x := range out {
			if strings.EqualFold(x, m) {
				dup = true
			}
		}
		if !dup {
			out = append(out, m)
		}
	}
	return out, len(out) <= 4
}

/* =========================================================
   DATOS INICIALES (una sola vez por negocio)
   ========================================================= */

var (
	invDefaultDepartments = []string{"SIN DEFINIR"}
	// Ópticas: los mismos departamentos con los que arrancó Avante (SICAR).
	invOpticsDepartments = []string{"SIN DEFINIR", "ECONOMICO", "LINEA", "MARCAS", "MICAS", "PAQUETE"}
)

// EnsureInventorySeed crea los departamentos de inicio la primera vez que
// el negocio abre su inventario. Si después los borra, no vuelven a salir.
func EnsureInventorySeed(userID uint, optica bool) {
	db := invDB()
	if db == nil {
		return
	}
	var n int
	if err := db.QueryRow("SELECT COUNT(*) FROM inv_settings WHERE user_id = ?", userID).Scan(&n); err != nil || n > 0 {
		return
	}
	if _, err := db.Exec("INSERT IGNORE INTO inv_settings (user_id, seeded_at) VALUES (?, ?)", userID, invNow()); err != nil {
		log.Printf("inventario: no se pudo marcar el inicio del usuario %d: %v", userID, err)
		return
	}
	deps := invDefaultDepartments
	if optica {
		deps = invOpticsDepartments
	}
	for _, d := range deps {
		if _, err := db.Exec("INSERT IGNORE INTO inv_departamentos (user_id, nombre, created_at) VALUES (?, ?, ?)", userID, d, invNow()); err != nil {
			log.Printf("inventario: no se pudo crear el departamento %s: %v", d, err)
		}
	}
}

/* =========================================================
   ARTÍCULOS
   ========================================================= */

type InvItem struct {
	ID             int64   `json:"id"`
	Clave          string  `json:"clave"`
	ClaveAlterna   string  `json:"clave_alterna"`
	Descripcion    string  `json:"descripcion"`
	DepartamentoID int64   `json:"departamento_id"`
	Departamento   string  `json:"departamento"`
	CategoriaID    int64   `json:"categoria_id"`
	Categoria      string  `json:"categoria"`
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
	// Solo ópticas: tipo de armazón (slug), color principal y hasta 2 más
	// si es combinado, mica ("oftalmico" | "sol" | "") y materiales.
	TipoArmazon    string   `json:"tipo_armazon"`
	ColorPrincipal string   `json:"color_principal"`
	ColoresExtra   []string `json:"colores_extra"`
	MicaTipo       string   `json:"mica_tipo"`
	Materiales     []string `json:"materiales"`
	UpdatedAt      string   `json:"updated_at"`
	// Foto principal (URL) y, al traer uno solo, todas sus fotos.
	Foto  string     `json:"foto"`
	Fotos []InvPhoto `json:"fotos,omitempty"`
}

// invPhotoMainSQL — subconsulta con el id de la foto principal de i.id.
const invPhotoMainSQL = "(SELECT f.id FROM inv_fotos f WHERE f.item_id = i.id ORDER BY f.orden ASC, f.id ASC LIMIT 1)"

const invItemSelect = `
	SELECT i.id, i.clave, i.clave_alterna, i.descripcion,
	       COALESCE(i.departamento_id, 0), COALESCE(d.nombre, ''),
	       COALESCE(i.categoria_id, 0), COALESCE(c.nombre, ''),
	       i.unidad_compra, i.unidad_venta, i.factor, i.servicio, i.iva,
	       i.precio_compra, i.precio_1, i.precio_2, i.precio_3, i.precio_4,
	       i.mayoreo_2, i.mayoreo_3, i.mayoreo_4,
	       i.existencia, i.inv_minimo, i.inv_maximo, i.localizacion,
	       i.tipo_armazon, i.color_principal, i.colores_extra, i.mica_tipo, i.materiales,
	       COALESCE(DATE_FORMAT(i.updated_at, '%Y-%m-%dT%H:%i:%s'), ''),
	       COALESCE(` + invPhotoMainSQL + `, 0)
	FROM inv_articulos i
	LEFT JOIN inv_departamentos d ON d.id = i.departamento_id
	LEFT JOIN inv_categorias c ON c.id = i.categoria_id`

func scanInvItem(sc interface{ Scan(...interface{}) error }) (InvItem, error) {
	var a InvItem
	var photoID int64
	var extra, mats string
	err := sc.Scan(&a.ID, &a.Clave, &a.ClaveAlterna, &a.Descripcion,
		&a.DepartamentoID, &a.Departamento, &a.CategoriaID, &a.Categoria,
		&a.UnidadCompra, &a.UnidadVenta, &a.Factor, &a.Servicio, &a.IVA,
		&a.PrecioCompra, &a.Precio1, &a.Precio2, &a.Precio3, &a.Precio4,
		&a.Mayoreo2, &a.Mayoreo3, &a.Mayoreo4,
		&a.Existencia, &a.Minimo, &a.Maximo, &a.Localizacion,
		&a.TipoArmazon, &a.ColorPrincipal, &extra, &a.MicaTipo, &mats, &a.UpdatedAt, &photoID)
	a.Foto = InvPhotoURL(photoID)
	a.ColoresExtra = splitInvList(extra)
	a.Materiales = splitInvList(mats)
	return a, err
}

// ListInvItems regresa todo el catálogo del negocio (la página filtra y
// pagina en el navegador: así buscar es instantáneo).
func ListInvItems(userID uint) ([]InvItem, error) {
	rows, err := invDB().Query(invItemSelect+" WHERE i.user_id = ? ORDER BY i.descripcion ASC, i.id ASC", userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []InvItem{}
	for rows.Next() {
		a, err := scanInvItem(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// GetInvItem trae un artículo del negocio.
func GetInvItem(userID uint, id int64) (*InvItem, error) {
	a, err := scanInvItem(invDB().QueryRow(invItemSelect+" WHERE i.user_id = ? AND i.id = ?", userID, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrInvItemNotFound
	}
	if err != nil {
		return nil, err
	}
	return &a, nil
}

// checkInvClassification confirma que el departamento exista (y sea del
// negocio) y que la categoría sea de ese departamento. Si la categoría se
// manda sin departamento, se toma el de la categoría.
func checkInvClassification(userID uint, a *InvItem) error {
	db := invDB()
	if a.CategoriaID > 0 {
		var dep int64
		err := db.QueryRow("SELECT departamento_id FROM inv_categorias WHERE id = ? AND user_id = ?", a.CategoriaID, userID).Scan(&dep)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrInvCatNotFound
		}
		if err != nil {
			return err
		}
		if a.DepartamentoID <= 0 {
			a.DepartamentoID = dep
		} else if a.DepartamentoID != dep {
			return fmt.Errorf("esa categoría no es del departamento elegido")
		}
	}
	if a.DepartamentoID > 0 {
		var n int
		if err := db.QueryRow("SELECT COUNT(*) FROM inv_departamentos WHERE id = ? AND user_id = ?", a.DepartamentoID, userID).Scan(&n); err != nil {
			return err
		}
		if n == 0 {
			return ErrInvDeptNotFound
		}
	}
	return nil
}

// CreateInvItem da de alta un artículo. La existencia con la que se crea
// queda en el kárdex como "inventario inicial".
func CreateInvItem(userID uint, a InvItem, usuario string) (*InvItem, error) {
	if err := checkInvClassification(userID, &a); err != nil {
		return nil, err
	}
	if a.Servicio {
		a.Existencia = 0
	}
	tx, err := invDB().Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	now := invNow()
	res, err := tx.Exec(
		`INSERT INTO inv_articulos
		   (user_id, clave, clave_alterna, descripcion, departamento_id, categoria_id, unidad_compra, unidad_venta, factor,
		    servicio, iva, precio_compra, precio_1, precio_2, precio_3, precio_4, mayoreo_2, mayoreo_3, mayoreo_4,
		    existencia, inv_minimo, inv_maximo, localizacion,
		    tipo_armazon, color_principal, colores_extra, mica_tipo, materiales, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		userID, NormalizeInvClave(a.Clave), a.ClaveAlterna, a.Descripcion, nullInvID(a.DepartamentoID), nullInvID(a.CategoriaID),
		a.UnidadCompra, a.UnidadVenta, a.Factor, a.Servicio, a.IVA,
		invRound2(a.PrecioCompra), invRound2(a.Precio1), invRound2(a.Precio2), invRound2(a.Precio3), invRound2(a.Precio4),
		a.Mayoreo2, a.Mayoreo3, a.Mayoreo4,
		a.Existencia, a.Minimo, a.Maximo, a.Localizacion,
		a.TipoArmazon, a.ColorPrincipal, strings.Join(a.ColoresExtra, ","), a.MicaTipo, strings.Join(a.Materiales, ","), now, now,
	)
	if isInvDuplicateKey(err) {
		return nil, ErrInvClaveTaken
	}
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	if a.Existencia != 0 {
		if _, err := tx.Exec(
			`INSERT INTO inv_movimientos (user_id, item_id, tipo, cantidad, existencia_antes, existencia_despues, comentario, usuario, created_at)
			 VALUES (?, ?, ?, ?, 0, ?, 'Alta del artículo', ?, ?)`,
			userID, id, InvMovInitial, a.Existencia, a.Existencia, usuario, now,
		); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return GetInvItem(userID, id)
}

// UpdateInvItem guarda los datos del artículo. La existencia NO se cambia
// aquí (como en SICAR): eso se hace con Ajustar, para que quede en el kárdex.
//
// keepCost = true deja el precio de compra que ya tenía (para cuando haya
// empleados que no deben ver/cambiar el costo; el dueño sí puede).
func UpdateInvItem(userID uint, a InvItem, keepCost bool) (*InvItem, error) {
	if err := checkInvClassification(userID, &a); err != nil {
		return nil, err
	}
	cur, err := GetInvItem(userID, a.ID)
	if err != nil {
		return nil, err
	}
	if keepCost {
		a.PrecioCompra = cur.PrecioCompra
	}
	if a.Servicio && cur.Existencia != 0 {
		return nil, fmt.Errorf("para marcarlo como servicio primero deja su existencia en 0 (Ajustar)")
	}
	_, err = invDB().Exec(
		`UPDATE inv_articulos SET
		   clave = ?, clave_alterna = ?, descripcion = ?, departamento_id = ?, categoria_id = ?,
		   unidad_compra = ?, unidad_venta = ?, factor = ?, servicio = ?, iva = ?,
		   precio_compra = ?, precio_1 = ?, precio_2 = ?, precio_3 = ?, precio_4 = ?,
		   mayoreo_2 = ?, mayoreo_3 = ?, mayoreo_4 = ?, inv_minimo = ?, inv_maximo = ?, localizacion = ?,
		   tipo_armazon = ?, color_principal = ?, colores_extra = ?, mica_tipo = ?, materiales = ?, updated_at = ?
		 WHERE id = ? AND user_id = ?`,
		NormalizeInvClave(a.Clave), a.ClaveAlterna, a.Descripcion, nullInvID(a.DepartamentoID), nullInvID(a.CategoriaID),
		a.UnidadCompra, a.UnidadVenta, a.Factor, a.Servicio, a.IVA,
		invRound2(a.PrecioCompra), invRound2(a.Precio1), invRound2(a.Precio2), invRound2(a.Precio3), invRound2(a.Precio4),
		a.Mayoreo2, a.Mayoreo3, a.Mayoreo4, a.Minimo, a.Maximo, a.Localizacion,
		a.TipoArmazon, a.ColorPrincipal, strings.Join(a.ColoresExtra, ","), a.MicaTipo, strings.Join(a.Materiales, ","), invNow(),
		a.ID, userID,
	)
	if isInvDuplicateKey(err) {
		return nil, ErrInvClaveTaken
	}
	if err != nil {
		return nil, err
	}
	return GetInvItem(userID, a.ID)
}

// DeleteInvItem elimina un artículo. Como en SICAR, solo si su existencia
// está en 0. Sus movimientos del kárdex se conservan.
func DeleteInvItem(userID uint, id int64) error {
	a, err := GetInvItem(userID, id)
	if err != nil {
		return err
	}
	if a.Existencia != 0 {
		return ErrInvHasStock
	}
	db := invDB()
	_, err = db.Exec("DELETE FROM inv_articulos WHERE id = ? AND user_id = ?", id, userID)
	if err == nil {
		db.Exec("DELETE FROM inv_fotos WHERE item_id = ? AND user_id = ?", id, userID)
	}
	return err
}

/* =========================================================
   AJUSTES DE EXISTENCIA
   ========================================================= */

// InvAdjustResult — lo que regresa un ajuste aplicado.
type InvAdjustResult struct {
	Folio     int64    `json:"folio"`
	Articulo  *InvItem `json:"articulo,omitempty"`
	Cambiados int      `json:"cambiados"`
	Articulos int      `json:"articulos"`
	Bajas     int      `json:"bajas,omitempty"`
}

// newInvAdjustment crea el folio (consecutivo del negocio) dentro de tx.
// Regresa (id interno, folio).
func newInvAdjustment(tx *sql.Tx, userID uint, tipo, comentario, usuario string, articulos int, now string) (int64, int64, error) {
	var folio int64
	if err := tx.QueryRow("SELECT COALESCE(MAX(folio), 0) + 1 FROM inv_ajustes WHERE user_id = ? FOR UPDATE", userID).Scan(&folio); err != nil {
		return 0, 0, err
	}
	res, err := tx.Exec("INSERT INTO inv_ajustes (user_id, folio, tipo, comentario, usuario, articulos, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
		userID, folio, tipo, comentario, usuario, articulos, now)
	if err != nil {
		return 0, 0, err
	}
	id, _ := res.LastInsertId()
	return id, folio, nil
}

// AdjustInvItem hace un ajuste a un solo artículo (botón Ajustar):
//
//	modo "entrada": suma la cantidad (compra, devolución…)
//	modo "salida":  resta la cantidad (merma, dañado…)
//	modo "fijar":   la existencia queda en la cantidad escrita
func AdjustInvItem(userID uint, itemID int64, modo string, cantidad int, comentario, usuario string) (*InvAdjustResult, error) {
	tx, err := invDB().Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var antes int
	var servicio bool
	err = tx.QueryRow("SELECT existencia, servicio FROM inv_articulos WHERE id = ? AND user_id = ? FOR UPDATE", itemID, userID).Scan(&antes, &servicio)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrInvItemNotFound
	}
	if err != nil {
		return nil, err
	}
	if servicio {
		return nil, ErrInvService
	}

	var despues int
	tipoMov, tipoAjuste := InvMovAdjust, "fijar"
	switch modo {
	case "entrada":
		despues, tipoMov, tipoAjuste = antes+cantidad, InvMovIn, "entrada"
	case "salida":
		despues, tipoMov, tipoAjuste = antes-cantidad, InvMovOut, "salida"
		if despues < 0 {
			return nil, fmt.Errorf("%w: hay %d", ErrInvNotEnoughStock, antes)
		}
	default:
		despues = cantidad
	}
	diff := despues - antes

	now := invNow()
	ajID, folio, err := newInvAdjustment(tx, userID, tipoAjuste, comentario, usuario, 1, now)
	if err != nil {
		return nil, err
	}
	if _, err := tx.Exec("UPDATE inv_articulos SET existencia = ?, updated_at = ? WHERE id = ? AND user_id = ?", despues, now, itemID, userID); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(
		`INSERT INTO inv_movimientos (user_id, item_id, tipo, cantidad, existencia_antes, existencia_despues, ajuste_id, comentario, usuario, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		userID, itemID, tipoMov, diff, antes, despues, ajID, comentario, usuario, now,
	); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	a, err := GetInvItem(userID, itemID)
	if err != nil {
		return nil, err
	}
	r := &InvAdjustResult{Folio: folio, Articulo: a, Articulos: 1}
	if diff != 0 {
		r.Cambiados = 1
	}
	if diff < 0 {
		r.Bajas = -diff
	}
	return r, nil
}

// InvCount — una línea del inventario físico: lo que se contó.
type InvCount struct {
	ItemID  int64 `json:"item_id"`
	Contado int   `json:"contado"`
}

// ApplyPhysicalCount aplica un conteo físico (Ajustes de inventario): la
// existencia de cada artículo queda en lo que se contó. Todas las líneas
// quedan en el folio (también las que no cambiaron, con diferencia 0) para
// poder consultar el conteo completo.
func ApplyPhysicalCount(userID uint, lines []InvCount, comentario, usuario string) (*InvAdjustResult, error) {
	tx, err := invDB().Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	now := invNow()
	ajID, folio, err := newInvAdjustment(tx, userID, "fisico", comentario, usuario, len(lines), now)
	if err != nil {
		return nil, err
	}
	cambiados := 0
	seen := map[int64]bool{}
	out := &InvAdjustResult{}
	for _, l := range lines {
		if seen[l.ItemID] {
			continue
		}
		seen[l.ItemID] = true
		var antes int
		var desc string
		var servicio bool
		err := tx.QueryRow("SELECT existencia, descripcion, servicio FROM inv_articulos WHERE id = ? AND user_id = ? FOR UPDATE", l.ItemID, userID).Scan(&antes, &desc, &servicio)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("un artículo del conteo ya no existe; quítalo y vuelve a intentar")
		}
		if err != nil {
			return nil, err
		}
		if servicio {
			return nil, fmt.Errorf("«%s» es servicio y no lleva existencia; quítalo del conteo", desc)
		}
		diff := l.Contado - antes
		if diff != 0 {
			cambiados++
			if _, err := tx.Exec("UPDATE inv_articulos SET existencia = ?, updated_at = ? WHERE id = ? AND user_id = ?", l.Contado, now, l.ItemID, userID); err != nil {
				return nil, err
			}
		}
		if _, err := tx.Exec(
			`INSERT INTO inv_movimientos (user_id, item_id, tipo, cantidad, existencia_antes, existencia_despues, ajuste_id, comentario, usuario, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			userID, l.ItemID, InvMovAdjust, diff, antes, l.Contado, ajID, comentario, usuario, now,
		); err != nil {
			return nil, err
		}
		if diff < 0 {
			out.Bajas -= diff
		}
	}
	if _, err := tx.Exec("UPDATE inv_ajustes SET articulos = ? WHERE id = ?", len(seen), ajID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	out.Folio, out.Cambiados, out.Articulos = folio, cambiados, len(seen)
	return out, nil
}

// InvAdjustmentRow — un folio de ajuste en la lista.
type InvAdjustmentRow struct {
	ID         int64  `json:"-"` // id interno (para la liga pública firmada)
	Folio      int64  `json:"folio"`
	Tipo       string `json:"tipo"`
	Fecha      string `json:"fecha"`
	Comentario string `json:"comentario"`
	Usuario    string `json:"usuario"`
	Articulos  int    `json:"articulos"`
	Cambiados  int    `json:"cambiados"`
	Sobrantes  int    `json:"sobrantes"` // piezas que se sumaron
	Faltantes  int    `json:"faltantes"` // piezas que se restaron (positivo)
}

const invAdjustmentSelect = `
	SELECT a.id, a.folio, a.tipo, DATE_FORMAT(a.created_at, '%Y-%m-%dT%H:%i:%s'), a.comentario, a.usuario, a.articulos,
	       COALESCE(SUM(m.cantidad <> 0), 0),
	       COALESCE(SUM(CASE WHEN m.cantidad > 0 THEN m.cantidad ELSE 0 END), 0),
	       COALESCE(SUM(CASE WHEN m.cantidad < 0 THEN -m.cantidad ELSE 0 END), 0)
	FROM inv_ajustes a
	LEFT JOIN inv_movimientos m ON m.ajuste_id = a.id`

func scanInvAdjustment(sc interface{ Scan(...interface{}) error }) (InvAdjustmentRow, error) {
	var r InvAdjustmentRow
	err := sc.Scan(&r.ID, &r.Folio, &r.Tipo, &r.Fecha, &r.Comentario, &r.Usuario, &r.Articulos, &r.Cambiados, &r.Sobrantes, &r.Faltantes)
	return r, err
}

// ListInvAdjustments — ajustes entre dos fechas (YYYY-MM-DD, incluidas).
func ListInvAdjustments(userID uint, desde, hasta string) ([]InvAdjustmentRow, error) {
	rows, err := invDB().Query(invAdjustmentSelect+`
		WHERE a.user_id = ? AND a.created_at >= ? AND a.created_at < DATE_ADD(?, INTERVAL 1 DAY)
		GROUP BY a.id ORDER BY a.id DESC LIMIT 500`, userID, desde, hasta)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []InvAdjustmentRow{}
	for rows.Next() {
		r, err := scanInvAdjustment(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// InvAdjustmentLine — un artículo dentro de un ajuste.
type InvAdjustmentLine struct {
	ItemID      int64  `json:"item_id"`
	Clave       string `json:"clave"`
	Descripcion string `json:"descripcion"`
	Antes       int    `json:"antes"`
	Despues     int    `json:"despues"`
	Diferencia  int    `json:"diferencia"`
}

// InvAdjustmentDetail — un folio con sus artículos.
type InvAdjustmentDetail struct {
	InvAdjustmentRow
	Lineas []InvAdjustmentLine `json:"lineas"`
}

func loadInvAdjustment(r InvAdjustmentRow, err error) (*InvAdjustmentDetail, error) {
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrInvAdjustmentMissing
	}
	if err != nil {
		return nil, err
	}
	d := &InvAdjustmentDetail{InvAdjustmentRow: r, Lineas: []InvAdjustmentLine{}}
	rows, err := invDB().Query(`
		SELECT m.item_id, COALESCE(i.clave, ''), COALESCE(i.descripcion, '(artículo eliminado)'),
		       m.existencia_antes, m.existencia_despues, m.cantidad
		FROM inv_movimientos m
		LEFT JOIN inv_articulos i ON i.id = m.item_id
		WHERE m.ajuste_id = ?
		ORDER BY (m.cantidad = 0), i.descripcion`, r.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var l InvAdjustmentLine
		if err := rows.Scan(&l.ItemID, &l.Clave, &l.Descripcion, &l.Antes, &l.Despues, &l.Diferencia); err != nil {
			return nil, err
		}
		d.Lineas = append(d.Lineas, l)
	}
	return d, rows.Err()
}

// GetInvAdjustment trae un ajuste (por su folio del negocio) con sus artículos.
func GetInvAdjustment(userID uint, folio int64) (*InvAdjustmentDetail, error) {
	return loadInvAdjustment(scanInvAdjustment(invDB().QueryRow(invAdjustmentSelect+" WHERE a.user_id = ? AND a.folio = ? GROUP BY a.id", userID, folio)))
}

// GetInvAdjustmentByID trae un ajuste por su id interno (liga pública firmada).
// Regresa también el dueño, para poner el nombre del negocio en el reporte.
func GetInvAdjustmentByID(id int64) (*InvAdjustmentDetail, uint, error) {
	var owner uint
	if err := invDB().QueryRow("SELECT user_id FROM inv_ajustes WHERE id = ?", id).Scan(&owner); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, 0, ErrInvAdjustmentMissing
		}
		return nil, 0, err
	}
	d, err := loadInvAdjustment(scanInvAdjustment(invDB().QueryRow(invAdjustmentSelect+" WHERE a.id = ? GROUP BY a.id", id)))
	return d, owner, err
}

/* =========================================================
   KÁRDEX (movimientos)
   ========================================================= */

type InvMovement struct {
	ID          int64  `json:"id"`
	Fecha       string `json:"fecha"`
	ItemID      int64  `json:"item_id"`
	Clave       string `json:"clave"`
	Descripcion string `json:"descripcion"`
	Tipo        string `json:"tipo"`
	Cantidad    int    `json:"cantidad"`
	Antes       int    `json:"antes"`
	Despues     int    `json:"despues"`
	AjusteID    int64  `json:"ajuste_id,omitempty"` // folio del ajuste (el que ve el negocio)
	VentaID     int64  `json:"venta_id,omitempty"`  // folio del ticket (Punto de venta)
	Comentario  string `json:"comentario"`
	Usuario     string `json:"usuario"`
}

type InvMovementFilter struct {
	ItemID int64
	Desde  string // YYYY-MM-DD
	Hasta  string
	Tipo   string
	Q      string
}

type InvMovementTotals struct {
	Movimientos int `json:"movimientos"`
	Entradas    int `json:"entradas"` // piezas que entraron
	Salidas     int `json:"salidas"`  // piezas que salieron (positivo)
}

// ListInvMovements — el kárdex con filtros. Las líneas con cantidad 0
// (artículos contados sin diferencia) no se muestran aquí.
func ListInvMovements(userID uint, f InvMovementFilter, limit int) ([]InvMovement, InvMovementTotals, error) {
	if limit <= 0 || limit > 10000 {
		limit = 1000
	}
	where := []string{"m.user_id = ?", "m.cantidad <> 0"}
	args := []interface{}{userID}
	if f.ItemID > 0 {
		where = append(where, "m.item_id = ?")
		args = append(args, f.ItemID)
	}
	if f.Desde != "" {
		where = append(where, "m.created_at >= ?")
		args = append(args, f.Desde)
	}
	if f.Hasta != "" {
		where = append(where, "m.created_at < DATE_ADD(?, INTERVAL 1 DAY)")
		args = append(args, f.Hasta)
	}
	if f.Tipo != "" {
		where = append(where, "m.tipo = ?")
		args = append(args, f.Tipo)
	}
	for _, w := range strings.Fields(strings.ToLower(f.Q)) {
		like := "%" + strings.NewReplacer(`\`, `\\`, "%", `\%`, "_", `\_`).Replace(w) + "%"
		where = append(where, "(LOWER(COALESCE(i.descripcion,'')) LIKE ? OR LOWER(COALESCE(i.clave,'')) LIKE ? OR LOWER(m.comentario) LIKE ? OR LOWER(m.usuario) LIKE ?)")
		args = append(args, like, like, like, like)
	}
	cond := " WHERE " + strings.Join(where, " AND ")
	from := " FROM inv_movimientos m LEFT JOIN inv_articulos i ON i.id = m.item_id LEFT JOIN inv_ajustes a ON a.id = m.ajuste_id LEFT JOIN pos_sales ps ON ps.id = m.venta_id"

	db := invDB()
	var t InvMovementTotals
	if err := db.QueryRow(`SELECT COUNT(*),
		COALESCE(SUM(CASE WHEN m.cantidad > 0 THEN m.cantidad ELSE 0 END), 0),
		COALESCE(SUM(CASE WHEN m.cantidad < 0 THEN -m.cantidad ELSE 0 END), 0)`+from+cond, args...).
		Scan(&t.Movimientos, &t.Entradas, &t.Salidas); err != nil {
		return nil, t, err
	}

	rows, err := db.Query(`
		SELECT m.id, DATE_FORMAT(m.created_at, '%Y-%m-%dT%H:%i:%s'), m.item_id,
		       COALESCE(i.clave, ''), COALESCE(i.descripcion, '(artículo eliminado)'),
		       m.tipo, m.cantidad, m.existencia_antes, m.existencia_despues,
		       COALESCE(a.folio, 0), COALESCE(ps.folio, 0), m.comentario, m.usuario`+from+cond+`
		ORDER BY m.created_at DESC, m.id DESC LIMIT ?`, append(args, limit)...)
	if err != nil {
		return nil, t, err
	}
	defer rows.Close()
	out := []InvMovement{}
	for rows.Next() {
		var m InvMovement
		if err := rows.Scan(&m.ID, &m.Fecha, &m.ItemID, &m.Clave, &m.Descripcion, &m.Tipo, &m.Cantidad,
			&m.Antes, &m.Despues, &m.AjusteID, &m.VentaID, &m.Comentario, &m.Usuario); err != nil {
			return nil, t, err
		}
		out = append(out, m)
	}
	return out, t, rows.Err()
}

/* =========================================================
   DEPARTAMENTOS Y CATEGORÍAS
   ========================================================= */

type InvCategory struct {
	ID             int64   `json:"id"`
	DepartamentoID int64   `json:"departamento_id"`
	Nombre         string  `json:"nombre"`
	Comision       float64 `json:"comision"`
	Articulos      int     `json:"articulos"`
}

type InvDepartment struct {
	ID         int64         `json:"id"`
	Nombre     string        `json:"nombre"`
	Articulos  int           `json:"articulos"`
	Categorias []InvCategory `json:"categorias"`
}

// ListInvDepartments — departamentos con sus categorías y cuántos
// artículos tiene cada uno.
func ListInvDepartments(userID uint) ([]InvDepartment, error) {
	db := invDB()
	rows, err := db.Query(`
		SELECT d.id, d.nombre, (SELECT COUNT(*) FROM inv_articulos i WHERE i.departamento_id = d.id)
		FROM inv_departamentos d WHERE d.user_id = ? ORDER BY d.nombre`, userID)
	if err != nil {
		return nil, err
	}
	out := []InvDepartment{}
	idx := map[int64]int{}
	for rows.Next() {
		var d InvDepartment
		if err := rows.Scan(&d.ID, &d.Nombre, &d.Articulos); err != nil {
			rows.Close()
			return nil, err
		}
		d.Categorias = []InvCategory{}
		idx[d.ID] = len(out)
		out = append(out, d)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	crows, err := db.Query(`
		SELECT c.id, c.departamento_id, c.nombre, c.comision,
		       (SELECT COUNT(*) FROM inv_articulos i WHERE i.categoria_id = c.id)
		FROM inv_categorias c WHERE c.user_id = ? ORDER BY c.nombre`, userID)
	if err != nil {
		return nil, err
	}
	defer crows.Close()
	for crows.Next() {
		var c InvCategory
		if err := crows.Scan(&c.ID, &c.DepartamentoID, &c.Nombre, &c.Comision, &c.Articulos); err != nil {
			return nil, err
		}
		if i, ok := idx[c.DepartamentoID]; ok {
			out[i].Categorias = append(out[i].Categorias, c)
		}
	}
	return out, crows.Err()
}

func invDeptExists(userID uint, id int64) (bool, error) {
	var n int
	err := invDB().QueryRow("SELECT COUNT(*) FROM inv_departamentos WHERE id = ? AND user_id = ?", id, userID).Scan(&n)
	return n > 0, err
}

func CreateInvDepartment(userID uint, nombre string) (int64, error) {
	res, err := invDB().Exec("INSERT INTO inv_departamentos (user_id, nombre, created_at) VALUES (?, ?, ?)", userID, nombre, invNow())
	if isInvDuplicateKey(err) {
		return 0, ErrInvDeptDuplicate
	}
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func RenameInvDepartment(userID uint, id int64, nombre string) error {
	ok, err := invDeptExists(userID, id)
	if err != nil {
		return err
	}
	if !ok {
		return ErrInvDeptNotFound
	}
	_, err = invDB().Exec("UPDATE inv_departamentos SET nombre = ? WHERE id = ? AND user_id = ?", nombre, id, userID)
	if isInvDuplicateKey(err) {
		return ErrInvDeptDuplicate
	}
	return err
}

// DeleteInvDepartment borra el departamento y sus categorías, solo si
// ningún artículo lo usa.
func DeleteInvDepartment(userID uint, id int64) error {
	db := invDB()
	var n int
	if err := db.QueryRow("SELECT COUNT(*) FROM inv_articulos WHERE departamento_id = ? AND user_id = ?", id, userID).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return fmt.Errorf("%w (%d)", ErrInvDeptInUse, n)
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	res, err := tx.Exec("DELETE FROM inv_departamentos WHERE id = ? AND user_id = ?", id, userID)
	if err != nil {
		return err
	}
	if k, _ := res.RowsAffected(); k == 0 {
		return ErrInvDeptNotFound
	}
	if _, err := tx.Exec("DELETE FROM inv_categorias WHERE departamento_id = ? AND user_id = ?", id, userID); err != nil {
		return err
	}
	return tx.Commit()
}

func CreateInvCategory(userID uint, c InvCategory) (int64, error) {
	ok, err := invDeptExists(userID, c.DepartamentoID)
	if err != nil {
		return 0, err
	}
	if !ok {
		return 0, ErrInvDeptNotFound
	}
	res, err := invDB().Exec("INSERT INTO inv_categorias (user_id, departamento_id, nombre, comision, created_at) VALUES (?, ?, ?, ?, ?)",
		userID, c.DepartamentoID, c.Nombre, invRound2(c.Comision), invNow())
	if isInvDuplicateKey(err) {
		return 0, ErrInvCatDuplicate
	}
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// UpdateInvCategory cambia nombre, comisión o departamento. Si cambia de
// departamento, sus artículos se mueven con ella.
func UpdateInvCategory(userID uint, c InvCategory) error {
	ok, err := invDeptExists(userID, c.DepartamentoID)
	if err != nil {
		return err
	}
	if !ok {
		return ErrInvDeptNotFound
	}
	db := invDB()
	var e int
	if err := db.QueryRow("SELECT COUNT(*) FROM inv_categorias WHERE id = ? AND user_id = ?", c.ID, userID).Scan(&e); err != nil {
		return err
	}
	if e == 0 {
		return ErrInvCatNotFound
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	_, err = tx.Exec("UPDATE inv_categorias SET departamento_id = ?, nombre = ?, comision = ? WHERE id = ? AND user_id = ?",
		c.DepartamentoID, c.Nombre, invRound2(c.Comision), c.ID, userID)
	if isInvDuplicateKey(err) {
		return ErrInvCatDuplicate
	}
	if err != nil {
		return err
	}
	if _, err := tx.Exec("UPDATE inv_articulos SET departamento_id = ? WHERE categoria_id = ? AND user_id = ?", c.DepartamentoID, c.ID, userID); err != nil {
		return err
	}
	return tx.Commit()
}

// DeleteInvCategory borra la categoría si ningún artículo la usa.
func DeleteInvCategory(userID uint, id int64) error {
	db := invDB()
	var n int
	if err := db.QueryRow("SELECT COUNT(*) FROM inv_articulos WHERE categoria_id = ? AND user_id = ?", id, userID).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return fmt.Errorf("%w (%d)", ErrInvCatInUse, n)
	}
	res, err := db.Exec("DELETE FROM inv_categorias WHERE id = ? AND user_id = ?", id, userID)
	if err != nil {
		return err
	}
	if k, _ := res.RowsAffected(); k == 0 {
		return ErrInvCatNotFound
	}
	return nil
}

/* =========================================================
   FOTOS
   ========================================================= */

// InvPhoto — una foto de un artículo.
type InvPhoto struct {
	ID        int64  `json:"id"`
	ItemID    int64  `json:"item_id"`
	ObjectKey string `json:"-"`
	CType     string `json:"-"`
	URL       string `json:"url"`
	Principal bool   `json:"principal"`
}

// InvPhotoURL — dónde se ve la foto (la sirve el backend, con sesión).
func InvPhotoURL(id int64) string {
	if id <= 0 {
		return ""
	}
	return fmt.Sprintf("/media/inventario/foto/%d", id)
}

// ListInvPhotos — fotos de un artículo, la principal primero.
func ListInvPhotos(userID uint, itemID int64) ([]InvPhoto, error) {
	rows, err := invDB().Query("SELECT id, item_id, object_key, ctype FROM inv_fotos WHERE item_id = ? AND user_id = ? ORDER BY orden ASC, id ASC", itemID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []InvPhoto{}
	for rows.Next() {
		var f InvPhoto
		if err := rows.Scan(&f.ID, &f.ItemID, &f.ObjectKey, &f.CType); err != nil {
			return nil, err
		}
		f.URL = InvPhotoURL(f.ID)
		f.Principal = len(out) == 0
		out = append(out, f)
	}
	return out, rows.Err()
}

// CountInvPhotos — cuántas fotos tiene.
func CountInvPhotos(userID uint, itemID int64) (int, error) {
	var n int
	err := invDB().QueryRow("SELECT COUNT(*) FROM inv_fotos WHERE item_id = ? AND user_id = ?", itemID, userID).Scan(&n)
	return n, err
}

// AddInvPhoto registra una foto ya subida al bucket (va al final).
func AddInvPhoto(userID uint, itemID int64, key, ctype string) (*InvPhoto, error) {
	db := invDB()
	var orden int
	if err := db.QueryRow("SELECT COALESCE(MAX(orden), -1) + 1 FROM inv_fotos WHERE item_id = ? AND user_id = ?", itemID, userID).Scan(&orden); err != nil {
		return nil, err
	}
	res, err := db.Exec("INSERT INTO inv_fotos (user_id, item_id, object_key, ctype, orden, created_at) VALUES (?, ?, ?, ?, ?, ?)", userID, itemID, key, ctype, orden, invNow())
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return &InvPhoto{ID: id, ItemID: itemID, ObjectKey: key, CType: ctype, URL: InvPhotoURL(id)}, nil
}

// GetInvPhoto — una foto del negocio.
func GetInvPhoto(userID uint, id int64) (*InvPhoto, error) {
	var f InvPhoto
	err := invDB().QueryRow("SELECT id, item_id, object_key, ctype FROM inv_fotos WHERE id = ? AND user_id = ?", id, userID).Scan(&f.ID, &f.ItemID, &f.ObjectKey, &f.CType)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrInvPhotoNotFound
	}
	if err != nil {
		return nil, err
	}
	f.URL = InvPhotoURL(f.ID)
	return &f, nil
}

// DeleteInvPhoto borra el registro (el archivo lo borra el handler).
func DeleteInvPhoto(userID uint, id int64) error {
	_, err := invDB().Exec("DELETE FROM inv_fotos WHERE id = ? AND user_id = ?", id, userID)
	return err
}

// SetInvPhotoMain pone esa foto primero.
func SetInvPhotoMain(userID uint, id int64) error {
	f, err := GetInvPhoto(userID, id)
	if err != nil {
		return err
	}
	db := invDB()
	var minOrden int
	if err := db.QueryRow("SELECT COALESCE(MIN(orden), 0) FROM inv_fotos WHERE item_id = ? AND user_id = ?", f.ItemID, userID).Scan(&minOrden); err != nil {
		return err
	}
	_, err = db.Exec("UPDATE inv_fotos SET orden = ? WHERE id = ? AND user_id = ?", minOrden-1, id, userID)
	return err
}

// InvPhotoKeysOfItem — llaves en el bucket (para borrarlas con el artículo).
func InvPhotoKeysOfItem(userID uint, itemID int64) []string {
	rows, err := invDB().Query("SELECT object_key FROM inv_fotos WHERE item_id = ? AND user_id = ?", itemID, userID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var keys []string
	for rows.Next() {
		var k string
		if rows.Scan(&k) == nil {
			keys = append(keys, k)
		}
	}
	return keys
}

/* =========================================================
   ÓPTICAS: colores, materiales y tipos de armazón
   ========================================================= */

type InvColor struct {
	ID     int64  `json:"id"`
	Nombre string `json:"nombre"`
	Hex    string `json:"hex"`
}

type InvMaterial struct {
	ID     int64  `json:"id"`
	Nombre string `json:"nombre"`
}

type InvFrameType struct {
	ID     int64  `json:"id"`
	Slug   string `json:"slug"`
	Nombre string `json:"nombre"`
	Orden  int    `json:"orden"`
}

var invSeedColors = [][2]string{
	{"Negro", "#1c1c22"}, {"Carey", "#6e4a2a"}, {"Café", "#7a5230"}, {"Dorado", "#c9a24b"},
	{"Plateado", "#b8bcc6"}, {"Gris", "#7d8290"}, {"Blanco", "#f4f4f2"}, {"Transparente", "#dfe8f3"},
	{"Rojo", "#c62828"}, {"Vino", "#7b1f3a"}, {"Rosa", "#e88aa8"}, {"Azul", "#1d4ed8"},
	{"Azul marino", "#1f2a5c"}, {"Verde", "#2e7d4f"}, {"Morado", "#6b3fa0"}, {"Nude", "#d9b8a0"},
	{"Amarillo", "#e3b505"}, {"Naranja", "#e3742a"},
}

var invSeedMaterials = []string{
	"Metal", "Acetato", "Pasta", "TR90", "Titanio", "Acero inoxidable", "Aluminio",
	"Plástico", "Policarbonato", "Madera", "Fibra de carbono",
}

var invSeedFrameTypes = [][2]string{
	{"clasico", "Clásico"}, {"redondo", "Redondo"}, {"aviador", "Aviador"}, {"cateye", "Cat-eye"},
	{"rectangular", "Rectangular"}, {"cuadrado", "Cuadrado"}, {"ovalado", "Ovalado"},
	{"al-aire", "Al aire"}, {"semi-al-aire", "Semi al aire"}, {"deportivo", "Deportivo"},
}

// ensureOpticsSeed llena la paleta, materiales y tipos de armazón la primera
// vez que la óptica los pide (cada tabla por separado, solo si está vacía).
func ensureOpticsSeed(userID uint, table string) {
	db := invDB()
	var n int
	if err := db.QueryRow("SELECT COUNT(*) FROM "+table+" WHERE user_id = ?", userID).Scan(&n); err != nil || n > 0 {
		return
	}
	switch table {
	case "inv_colores":
		for i, c := range invSeedColors {
			db.Exec("INSERT IGNORE INTO inv_colores (user_id, nombre, hex, orden) VALUES (?, ?, ?, ?)", userID, c[0], c[1], i+1)
		}
	case "inv_materiales":
		for i, m := range invSeedMaterials {
			db.Exec("INSERT IGNORE INTO inv_materiales (user_id, nombre, orden) VALUES (?, ?, ?)", userID, m, i+1)
		}
	case "inv_tipos_armazon":
		for i, t := range invSeedFrameTypes {
			db.Exec("INSERT IGNORE INTO inv_tipos_armazon (user_id, slug, nombre, orden) VALUES (?, ?, ?, ?)", userID, t[0], t[1], i+1)
		}
	}
}

func ListInvColors(userID uint) ([]InvColor, error) {
	ensureOpticsSeed(userID, "inv_colores")
	rows, err := invDB().Query(`SELECT id, nombre, hex FROM inv_colores WHERE user_id = ? ORDER BY orden, nombre`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []InvColor{}
	for rows.Next() {
		var c InvColor
		if err := rows.Scan(&c.ID, &c.Nombre, &c.Hex); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// CreateInvColor agrega un color al final de la paleta.
func CreateInvColor(userID uint, nombre, hex string) (*InvColor, error) {
	db := invDB()
	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM inv_colores WHERE user_id = ? AND LOWER(nombre) = LOWER(?)`, userID, nombre).Scan(&n); err != nil {
		return nil, err
	}
	if n > 0 {
		return nil, ErrInvColorTaken
	}
	var orden int
	_ = db.QueryRow(`SELECT COALESCE(MAX(orden), 0) + 1 FROM inv_colores WHERE user_id = ?`, userID).Scan(&orden)
	res, err := db.Exec(`INSERT INTO inv_colores (user_id, nombre, hex, orden) VALUES (?, ?, ?, ?)`, userID, nombre, hex, orden)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return &InvColor{ID: id, Nombre: nombre, Hex: hex}, nil
}

func ListInvMaterials(userID uint) ([]InvMaterial, error) {
	ensureOpticsSeed(userID, "inv_materiales")
	rows, err := invDB().Query(`SELECT id, nombre FROM inv_materiales WHERE user_id = ? ORDER BY orden, nombre`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []InvMaterial{}
	for rows.Next() {
		var m InvMaterial
		if err := rows.Scan(&m.ID, &m.Nombre); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func CreateInvMaterial(userID uint, nombre string) (*InvMaterial, error) {
	db := invDB()
	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM inv_materiales WHERE user_id = ? AND LOWER(nombre) = LOWER(?)`, userID, nombre).Scan(&n); err != nil {
		return nil, err
	}
	if n > 0 {
		return nil, ErrInvMaterialTaken
	}
	var orden int
	_ = db.QueryRow(`SELECT COALESCE(MAX(orden), 0) + 1 FROM inv_materiales WHERE user_id = ?`, userID).Scan(&orden)
	res, err := db.Exec(`INSERT INTO inv_materiales (user_id, nombre, orden) VALUES (?, ?, ?)`, userID, nombre, orden)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return &InvMaterial{ID: id, Nombre: nombre}, nil
}

func ListInvFrameTypes(userID uint) ([]InvFrameType, error) {
	ensureOpticsSeed(userID, "inv_tipos_armazon")
	rows, err := invDB().Query(`SELECT id, slug, nombre, orden FROM inv_tipos_armazon WHERE user_id = ? ORDER BY orden, id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []InvFrameType{}
	for rows.Next() {
		var t InvFrameType
		if err := rows.Scan(&t.ID, &t.Slug, &t.Nombre, &t.Orden); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// InvFrameTypeExists: ¿el negocio tiene ese tipo de armazón?
func InvFrameTypeExists(userID uint, slug string) bool {
	var n int
	if err := invDB().QueryRow(`SELECT COUNT(*) FROM inv_tipos_armazon WHERE user_id = ? AND slug = ?`, userID, slug).Scan(&n); err != nil {
		return false
	}
	return n > 0
}

/* =========================================================
   BOTS: el catálogo del Inventario para el business_config
   ========================================================= */

// InvBotItem — un artículo como lo necesita el bot (sin costos).
type InvBotItem struct {
	ID          int64
	Clave       string
	Descripcion string
	Depto       string
	Categoria   string
	Servicio    bool
	Precio      float64
	Existencia  int
	// Solo ópticas
	TipoArmazon string
	Color       string
	Extras      []string
	MicaTipo    string
	Materiales  []string
	PhotoKeys   []string // llaves en el bucket, la principal primero
}

// ListInvItemsForBot — artículos con precio para que el bot los ofrezca
// (los que tienen precio 1 en 0 se omiten). Máximo limit artículos,
// primero los que hay en existencia y los servicios.
func ListInvItemsForBot(userID uint, limit int) ([]InvBotItem, error) {
	db := invDB()
	if db == nil {
		return nil, errors.New("sin base de datos")
	}
	if limit <= 0 {
		limit = 500
	}
	rows, err := db.Query(`
		SELECT i.id, i.clave, i.descripcion, COALESCE(d.nombre, ''), COALESCE(c.nombre, ''),
		       i.servicio, i.precio_1, i.existencia,
		       COALESCE(t.nombre, i.tipo_armazon), i.color_principal, i.colores_extra, i.mica_tipo, i.materiales
		FROM inv_articulos i
		LEFT JOIN inv_departamentos d ON d.id = i.departamento_id
		LEFT JOIN inv_categorias c ON c.id = i.categoria_id
		LEFT JOIN inv_tipos_armazon t ON t.user_id = i.user_id AND t.slug = i.tipo_armazon
		WHERE i.user_id = ? AND i.precio_1 > 0
		ORDER BY (i.servicio = 0 AND i.existencia <= 0), i.descripcion
		LIMIT ?`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []InvBotItem{}
	idx := map[int64]int{}
	for rows.Next() {
		var it InvBotItem
		var extras, mats string
		if err := rows.Scan(&it.ID, &it.Clave, &it.Descripcion, &it.Depto, &it.Categoria,
			&it.Servicio, &it.Precio, &it.Existencia,
			&it.TipoArmazon, &it.Color, &extras, &it.MicaTipo, &mats); err != nil {
			return nil, err
		}
		it.Extras, it.Materiales = splitInvList(extras), splitInvList(mats)
		idx[it.ID] = len(out)
		out = append(out, it)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return out, nil
	}
	prow, err := db.Query("SELECT item_id, object_key FROM inv_fotos WHERE user_id = ? ORDER BY item_id, orden, id", userID)
	if err != nil {
		return out, nil // sin fotos, pero con catálogo
	}
	defer prow.Close()
	for prow.Next() {
		var id int64
		var key string
		if prow.Scan(&id, &key) == nil {
			if i, ok := idx[id]; ok {
				out[i].PhotoKeys = append(out[i].PhotoKeys, key)
			}
		}
	}
	return out, nil
}
