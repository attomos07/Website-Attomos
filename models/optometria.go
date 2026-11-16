package models

// optometria.go — Optometría (sidebar → Optometría, solo ópticas).
// Portado del panel del optometrista de Avante Optics:
//
//   - Plantillas: el formato de la historia clínica (editor visual) y los
//     de la orden de laboratorio y la garantía / reparación (kind).
//   - Exámenes de la vista: cada historia clínica llenada.
//   - Hojas (orden de laboratorio y garantía): se llenan aparte; la orden
//     de laboratorio lleva Nº automático y le llega al Laboratorio.
//   - Historial clínico: los exámenes agrupados por paciente, con sus
//     antecedentes.
//
// Diferencias con Avante:
//   - Multi-negocio: todo lleva user_id (el dueño) y cada consulta filtra
//     por él. El Nº de la orden de laboratorio es por negocio.
//   - El "paciente con cuenta" es un cliente del Punto de venta
//     (pos_clients); en JSON se sigue llamando userId para no cambiar el
//     frontend. Su key en el historial es "u:<id del cliente>".
//   - Las plantillas de fábrica se crean solas la primera vez, con el
//     nombre y el logo del negocio.

import (
	"database/sql"
	"encoding/json"
	"errors"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"attomos/config"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

/* =========================================================
   TABLAS (AutoMigrate)
   ========================================================= */

type OptExamTemplateRecord struct {
	ID        int64     `gorm:"primaryKey;autoIncrement"`
	UserID    uint      `gorm:"not null;index"`
	Name      string    `gorm:"size:120;not null;default:''"`
	CanvasW   int       `gorm:"not null;default:816"`
	CanvasH   int       `gorm:"not null;default:1056"`
	Elements  string    `gorm:"type:longtext;not null"`
	IsActive  bool      `gorm:"not null;default:false"`
	Kind      string    `gorm:"size:20;not null;default:''"` // "" historia clínica | laboratorio | garantia
	CreatedAt time.Time `gorm:"type:datetime"`
	UpdatedAt time.Time `gorm:"type:datetime"`
}

func (OptExamTemplateRecord) TableName() string { return "opt_exam_templates" }

type OptEyeExamRecord struct {
	ID            int64      `gorm:"primaryKey;autoIncrement"`
	UserID        uint       `gorm:"not null;index:idx_opt_exam_user,priority:1"`
	TemplateID    int64      `gorm:"not null"`
	PatientName   string     `gorm:"size:160;not null;default:''"`
	PatientPhone  string     `gorm:"size:40;not null;default:''"`
	Data          string     `gorm:"type:longtext;not null"`
	CreatedByName string     `gorm:"size:120;not null;default:''"`
	ClientID      *int64     `gorm:"index"`
	AppointmentID *int64     `gorm:"index"`
	CreatedAt     time.Time  `gorm:"type:datetime;index:idx_opt_exam_user,priority:2"`
	UpdatedAt     *time.Time `gorm:"type:datetime"`
	UpdatedByName string     `gorm:"size:120;not null;default:''"`
}

func (OptEyeExamRecord) TableName() string { return "opt_eye_exams" }

type OptLabSheetRecord struct {
	ID            int64      `gorm:"primaryKey;autoIncrement"`
	UserID        uint       `gorm:"not null;uniqueIndex:uq_opt_sheet_folio,priority:1;index:idx_opt_sheet_user,priority:1"`
	Kind          string     `gorm:"size:20;not null;default:'laboratorio';uniqueIndex:uq_opt_sheet_folio,priority:2"`
	Folio         *int       `gorm:"uniqueIndex:uq_opt_sheet_folio,priority:3"`
	ExamID        *int64     `gorm:"index"`
	TemplateID    int64      `gorm:"not null"`
	PatientName   string     `gorm:"size:160;not null;default:''"`
	PatientPhone  string     `gorm:"size:40;not null;default:''"`
	ClientID      *int64     `gorm:"index"`
	Data          string     `gorm:"type:longtext;not null"`
	CreatedByName string     `gorm:"size:120;not null;default:''"`
	CreatedAt     time.Time  `gorm:"type:datetime;index:idx_opt_sheet_user,priority:2"`
	UpdatedAt     *time.Time `gorm:"type:datetime"`
	UpdatedByName string     `gorm:"size:120;not null;default:''"`
}

func (OptLabSheetRecord) TableName() string { return "opt_lab_sheets" }

type OptAntecedentesRecord struct {
	UserID      uint      `gorm:"primaryKey;autoIncrement:false"`
	PatientKey  string    `gorm:"primaryKey;size:190"`
	PatientName string    `gorm:"size:190;not null;default:''"`
	Data        string    `gorm:"type:text;not null"`
	UpdatedBy   string    `gorm:"size:120;not null;default:''"`
	UpdatedAt   time.Time `gorm:"type:datetime"`
}

func (OptAntecedentesRecord) TableName() string { return "opt_antecedentes" }

// OptometriaModels — para el AutoMigrate de main.go.
func OptometriaModels() []interface{} {
	return []interface{}{&OptExamTemplateRecord{}, &OptEyeExamRecord{}, &OptLabSheetRecord{}, &OptAntecedentesRecord{}}
}

/* =========================================================
   PLANTILLAS
   ========================================================= */

const (
	OptKindHistoria = ""
	OptKindLab      = "laboratorio"
	OptKindGarantia = "garantia"
)

// IsOptDocKind — tipos de hoja que se llenan aparte del examen.
func IsOptDocKind(kind string) bool { return kind == OptKindLab || kind == OptKindGarantia }

type ExamTemplate struct {
	ID        int64           `json:"id"`
	Name      string          `json:"name"`
	CanvasW   int             `json:"canvasW"`
	CanvasH   int             `json:"canvasH"`
	Elements  json.RawMessage `json:"elements"`
	IsActive  bool            `json:"isActive"`
	Kind      string          `json:"kind"`
	CreatedAt time.Time       `json:"createdAt"`
	UpdatedAt time.Time       `json:"updatedAt"`
}

var (
	ErrExamTemplateNotFound = errors.New("plantilla no encontrada")
	ErrEyeExamNotFound      = errors.New("examen no encontrado")
	ErrLabSheetNotFound     = errors.New("hoja no encontrada")
	ErrPatientNotFound      = errors.New("paciente no encontrado")
)

func rawJSON(s, fallback string) json.RawMessage {
	if strings.TrimSpace(s) == "" || !json.Valid([]byte(s)) {
		return json.RawMessage(fallback)
	}
	return json.RawMessage(s)
}

func toExamTemplate(r *OptExamTemplateRecord) *ExamTemplate {
	return &ExamTemplate{ID: r.ID, Name: r.Name, CanvasW: r.CanvasW, CanvasH: r.CanvasH,
		Elements: rawJSON(r.Elements, "[]"), IsActive: r.IsActive, Kind: r.Kind, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt}
}

// ListExamTemplates — todas las plantillas del negocio, la más reciente primero.
func ListExamTemplates(userID uint) ([]ExamTemplate, error) {
	var rows []OptExamTemplateRecord
	if err := config.DB.Where("user_id = ?", userID).Order("updated_at DESC, id DESC").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]ExamTemplate, 0, len(rows))
	for i := range rows {
		out = append(out, *toExamTemplate(&rows[i]))
	}
	return out, nil
}

// GetExamTemplate — una plantilla del negocio.
func GetExamTemplate(userID uint, id int64) (*ExamTemplate, error) {
	var r OptExamTemplateRecord
	if err := config.DB.Where("id = ? AND user_id = ?", id, userID).First(&r).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrExamTemplateNotFound
		}
		return nil, err
	}
	return toExamTemplate(&r), nil
}

// GetActiveExamTemplate — la historia clínica que usa "Nuevo examen".
func GetActiveExamTemplate(userID uint) (*ExamTemplate, error) {
	var r OptExamTemplateRecord
	err := config.DB.Where("user_id = ? AND is_active = ? AND kind = ''", userID, true).Order("updated_at DESC").First(&r).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrExamTemplateNotFound
	}
	if err != nil {
		return nil, err
	}
	return toExamTemplate(&r), nil
}

// GetExamTemplateByKind — la plantilla de la orden de laboratorio o de la
// garantía (la más reciente si hubiera varias).
func GetExamTemplateByKind(userID uint, kind string) (*ExamTemplate, error) {
	var r OptExamTemplateRecord
	err := config.DB.Where("user_id = ? AND kind = ?", userID, kind).Order("updated_at DESC, id DESC").First(&r).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrExamTemplateNotFound
	}
	if err != nil {
		return nil, err
	}
	return toExamTemplate(&r), nil
}

// CreateExamTemplate — plantilla nueva (historia clínica).
func CreateExamTemplate(userID uint, name string, w, h int, elements json.RawMessage) (*ExamTemplate, error) {
	r := OptExamTemplateRecord{UserID: userID, Name: cut(name, 120), CanvasW: w, CanvasH: h, Elements: string(elements)}
	if err := config.DB.Create(&r).Error; err != nil {
		return nil, err
	}
	return toExamTemplate(&r), nil
}

// UpdateExamTemplate — "Guardar" del editor (el tipo no cambia).
func UpdateExamTemplate(userID uint, id int64, name string, w, h int, elements json.RawMessage) error {
	res := config.DB.Model(&OptExamTemplateRecord{}).Where("id = ? AND user_id = ?", id, userID).
		Updates(map[string]interface{}{"name": cut(name, 120), "canvas_w": w, "canvas_h": h, "elements": string(elements), "updated_at": time.Now()})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrExamTemplateNotFound
	}
	return nil
}

// SetActiveExamTemplate — solo una historia clínica activa a la vez. Las
// de laboratorio y garantía no se activan.
func SetActiveExamTemplate(userID uint, id int64) error {
	t, err := GetExamTemplate(userID, id)
	if err != nil {
		return err
	}
	if t.Kind != "" {
		return errors.New("esa plantilla no es de examen")
	}
	return config.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&OptExamTemplateRecord{}).Where("user_id = ? AND is_active = ?", userID, true).Update("is_active", false).Error; err != nil {
			return err
		}
		return tx.Model(&OptExamTemplateRecord{}).Where("id = ? AND user_id = ?", id, userID).Update("is_active", true).Error
	})
}

// DeleteExamTemplate — borra una plantilla (las de laboratorio y garantía
// se pueden editar pero no borrar: sin ellas no se podrían llenar hojas).
func DeleteExamTemplate(userID uint, id int64) error {
	t, err := GetExamTemplate(userID, id)
	if err != nil {
		return err
	}
	if t.Kind != "" {
		var n int64
		config.DB.Model(&OptExamTemplateRecord{}).Where("user_id = ? AND kind = ?", userID, t.Kind).Count(&n)
		if n <= 1 {
			return errors.New("es la única plantilla de ese tipo")
		}
	}
	return config.DB.Where("id = ? AND user_id = ?", id, userID).Delete(&OptExamTemplateRecord{}).Error
}

/* ---------- plantillas de fábrica ---------- */

type optEl map[string]interface{}

func optLabel(id string, x, y, w, h, fs int, text string) optEl {
	return optEl{"id": id, "type": "text", "x": x, "y": y, "w": w, "h": h, "fontSize": fs, "text": text, "align": "left"}
}
func optField(id string, x, y, w, h, fs int, key string) optEl {
	return optEl{"id": id, "type": "text", "x": x, "y": y, "w": w, "h": h, "fontSize": fs, "text": "", "fieldKey": key}
}
func optTitle(id string, x, y, w, h, fs int, text string) optEl {
	return optEl{"id": id, "type": "title", "x": x, "y": y, "w": w, "h": h, "fontSize": fs, "text": text, "align": "left"}
}
func optTable(id string, x, y, w, h, rows, cols int, rowLabels, prefixes []string, headers ...string) optEl {
	el := optEl{"id": id, "type": "table", "x": x, "y": y, "w": w, "h": h, "rows": rows, "cols": cols, "headers": headers, "rowLabels": rowLabels}
	if prefixes != nil {
		el["cellPrefixes"] = prefixes
	}
	return el
}
func optLine(id string, x, y, w int) optEl {
	return optEl{"id": id, "type": "line", "x": x, "y": y, "w": w, "h": 2}
}
func optChoice(id string, x, y, w, h, fs int, key, label string, multi bool, column bool, options ...string) optEl {
	el := optEl{"id": id, "type": "choice", "x": x, "y": y, "w": w, "h": h, "fontSize": fs, "fieldKey": key, "label": label, "options": options}
	if multi {
		el["multi"] = true
	}
	if column {
		el["direction"] = "column"
	}
	return el
}

// Encabezado de cada hoja: el logo del negocio (si tiene) y su nombre.
func optHeader(biz, logo string, sub string) []optEl {
	x := 60
	out := []optEl{}
	if logo != "" {
		out = append(out, optEl{"id": "lg", "type": "image", "x": 60, "y": 34, "w": 64, "h": 64, "src": logo})
		x = 136
	}
	out = append(out, optTitle("tt", x, 38, 400, 30, 20, strings.ToUpper(biz)))
	if sub != "" {
		out = append(out, optLabel("st_sub", x, 70, 360, 20, 12, sub))
	}
	return out
}

// Historia clínica (réplica del formato de papel de Avante, sin su marca).
func optHistoriaElements(biz, logo string) []optEl {
	els := []optEl{}
	tx := 40
	if logo != "" {
		els = append(els, optEl{"id": "logo", "type": "image", "x": 40, "y": 30, "w": 70, "h": 70, "src": logo})
		tx = 160
	}
	els = append(els,
		optTitle("titulo", tx, 30, 440, 36, 26, "HISTORIA CLÍNICA"),
		optLabel("l_negocio", tx, 66, 440, 20, 11, strings.ToUpper(biz)),
		optLabel("l_fecha", tx, 92, 55, 22, 12, "FECHA"),
		optField("f_fecha", tx+60, 92, 145, 22, 12, "fecha"),
		optLabel("l_tel", tx+220, 92, 40, 22, 12, "TEL"),
		optField("f_tel", tx+265, 92, 175, 22, 12, "telefono"),
		optLabel("l_nombre", 40, 127, 75, 22, 12, "NOMBRE"),
		optField("f_nombre", 120, 127, 650, 22, 12, "nombre"),
		optLabel("l_molestias", 40, 157, 165, 22, 12, "MOLESTIAS OCULARES"),
		optField("f_molestias", 210, 157, 560, 22, 12, "molestias_oculares"),
		optLabel("l_dolor", 40, 184, 145, 22, 12, "DOLOR DE CABEZA"),
		optField("f_dolor", 190, 184, 130, 22, 12, "dolor_cabeza"),
		optLabel("l_cuando", 330, 184, 70, 22, 12, "CUANDO"),
		optField("f_cuando", 405, 184, 365, 22, 12, "cuando"),
		optLabel("l_lloran", 40, 211, 155, 22, 12, "SUS OJOS LE LLORAN"),
		optField("f_lloran", 200, 211, 190, 22, 12, "ojos_lloran"),
		optLabel("l_arden", 400, 211, 75, 22, 12, "LE ARDEN"),
		optField("f_arden", 480, 211, 290, 22, 12, "ojos_arden"),
		optLabel("l_comezon", 40, 238, 80, 22, 12, "COMEZÓN"),
		optField("f_comezon", 125, 238, 140, 22, 12, "comezon"),
		optLabel("l_legana", 280, 238, 65, 22, 12, "LEGAÑA"),
		optField("f_legana", 350, 238, 130, 22, 12, "legana"),
		optLabel("l_luz", 495, 238, 165, 22, 12, "MOLESTIAS A LA LUZ"),
		optField("f_luz", 665, 238, 115, 22, 12, "molestias_luz"),
		optLabel("l_solar", 40, 265, 160, 22, 12, "SOLAR O ARTIFICIAL"),
		optField("f_solar", 205, 265, 300, 22, 12, "solar_artificial"),
		optLabel("l_enfermedades", 40, 293, 310, 22, 10, "ENFERMEDADES QUE PADEZCA QUE PUEDAN AFECTAR SU VISTA"),
		optField("f_enfermedades", 360, 293, 420, 22, 12, "enfermedades"),
		optLabel("l_ultimo", 40, 321, 290, 22, 10, "HACE CUÁNTO SE HIZO EL ÚLTIMO EXAMEN DE LA VISTA"),
		optField("f_ultimo", 340, 321, 440, 22, 12, "ultimo_examen"),
		optLabel("l_recomendaron", 40, 347, 170, 22, 12, "QUÉ LE RECOMENDARON"),
		optField("f_recomendaron", 215, 347, 565, 22, 12, "recomendaron"),
		optLabel("l_resultados", 40, 386, 175, 22, 12, "QUÉ RESULTADOS OBTUVO"),
		optField("f_resultados", 220, 386, 430, 22, 12, "resultados"),
		optLabel("l_edad", 660, 386, 45, 22, 12, "EDAD"),
		optField("f_edad", 710, 386, 70, 22, 12, "edad"),
		optLabel("l_ocupacion", 40, 413, 90, 22, 12, "OCUPACIÓN"),
		optField("f_ocupacion", 135, 413, 250, 22, 12, "ocupacion"),
		optLabel("l_pasatiempo", 400, 413, 100, 22, 12, "PASATIEMPO"),
		optField("f_pasatiempo", 505, 413, 275, 22, 12, "pasatiempo"),
		optTitle("t_agudeza", 300, 448, 220, 24, 16, "AGUDEZA VISUAL"),
		optTable("tb_agudeza", 40, 478, 380, 100, 3, 3, []string{"OD", "OI", "AO"}, []string{"20/", "20/", "20/"}, "S/C", "A/E", "C/C"),
		optTable("tb_queratometria", 440, 478, 340, 100, 3, 1, []string{"OD", "OI", "OBS"}, nil, "Queratometría"),
		optTitle("t_rxant", 340, 596, 160, 22, 15, "RX ANTERIOR"),
		optTable("tb_rxant", 40, 622, 740, 75, 2, 6, []string{"OD", "OI"}, nil, "ESF", "CIL", "EJE", "ADD", "DI", "OBSERVACIONES"),
		optTitle("t_rxact", 345, 715, 150, 22, 15, "RX ACTUAL"),
		optTable("tb_rxact", 40, 741, 740, 75, 2, 7, []string{"OD", "OI"}, nil, "ESF", "CIL", "EJE", "ADD", "DI", "ALT/OBL", "AV"),
		optTitle("t_rxlc", 290, 834, 260, 22, 15, "RX DE LENTE DE CONTACTO"),
		optTable("tb_rxlc", 40, 860, 740, 75, 2, 6, []string{"OD", "OI"}, nil, "ESF", "CIL", "EJE", "C.B.", "DIAM", "TIPO L/C"),
		optLabel("l_diagnostico", 40, 953, 155, 22, 12, "DIAGNÓSTICO/OBS:"),
		optField("f_diagnostico", 200, 953, 580, 22, 12, "diagnostico"),
		optLabel("l_arm", 40, 990, 165, 22, 12, "ARM. RECOMENDADO"),
		optField("f_arm", 210, 990, 570, 22, 12, "arm_recomendado"),
		optLabel("l_cristal", 40, 1020, 140, 22, 12, "TIPO DE CRISTAL"),
		optField("f_cristal", 185, 1020, 595, 22, 12, "tipo_cristal"),
	)
	return els
}

// Orden de laboratorio (la hoja que se manda al laboratorio).
func optLabElements(biz, logo string) []optEl {
	els := optHeader(biz, logo, "ORDEN DE LABORATORIO")
	els = append(els,
		optLabel("st_folio", 60, 112, 34, 22, 15, "Nº"),
		optField("f_folio", 94, 112, 140, 22, 13, "folio"),
		optLabel("st_date", 520, 44, 60, 22, 13, "Fecha:"),
		optField("f_fecha", 580, 44, 176, 22, 13, "fecha"),
		optLabel("st_tel", 520, 78, 60, 22, 13, "Tel.:"),
		optField("f_tel", 580, 78, 176, 22, 13, "telefono"),
		optLabel("st_pat", 60, 152, 90, 22, 13, "Paciente:"),
		optField("f_pat", 150, 152, 606, 22, 13, "nombre"),
		optLabel("st_si", 60, 184, 190, 22, 13, "Instrucciones especiales:"),
		optField("f_si1", 252, 184, 504, 22, 13, "instrucciones"),
		optField("f_si2", 60, 216, 696, 22, 13, "instrucciones2"),
		optTable("rx", 60, 258, 696, 92, 2, 5, []string{"OD", "OI"}, []string{"", "", "", "", ""}, "ESF", "CIL", "EJE", "PRISMA", "BASE"),
		optTable("add", 60, 364, 560, 92, 2, 5, []string{"OD", "OI"}, []string{"", "", "", "", ""}, "ADD", "ALTURA", "DESCENTRADO", "DIP LEJOS", "DIP CERCA"),
		optLabel("st_tint", 634, 364, 122, 20, 13, "TINTE"),
		optChoice("c_tint", 634, 388, 122, 66, 13, "tinte", "Tinte", false, true, "SÓLIDO", "DEGRADADO"),
		optTable("frame", 60, 470, 420, 62, 1, 4, []string{""}, []string{"", "", "", ""}, "CALIBRE", "PUENTE", "VERTICAL", "DIAG. MAYOR"),
		optLabel("st_frame", 60, 548, 90, 24, 13, "ARMAZÓN"),
		optChoice("c_frame", 150, 548, 330, 24, 13, "armazon", "Armazón", false, false, "PASTA", "METAL", "AL AIRE"),
		optLabel("st_cut", 60, 582, 90, 24, 13, "LENTE"),
		optChoice("c_cut", 150, 582, 330, 24, 13, "corte", "Cortado / sin cortar", false, false, "CORTADO", "SIN CORTAR"),
		optLabel("st_mat", 60, 622, 170, 20, 12, "MATERIAL"),
		optChoice("c_mat", 60, 644, 170, 186, 13, "material", "Material", true, true, "CR-39", "ALTO ÍNDICE", "POLICARBONATO", "FOTOCROMÁTICO", "CRISTAL", "OTRO"),
		optLabel("st_type", 246, 622, 234, 20, 12, "TIPO DE LENTE"),
		optChoice("c_type", 246, 644, 234, 140, 13, "tipo_lente", "Tipo de lente", false, false, "MONOFOCAL", "BIFOCAL FT", "BIFOCAL INVISIBLE", "PROGRESIVO", "OCUPACIONAL"),
		optLabel("st_other", 246, 798, 64, 22, 13, "OTRO"),
		optField("f_other", 310, 798, 170, 22, 13, "tipo_otro"),
		optChoice("c_extras", 500, 470, 116, 300, 12, "extras", "Tratamientos", true, true, "Antirreflejante", "Filtro azul", "Tinte", "Antirrayas", "UV", "Prisma", "Envío", "Otro"),
		optLabel("st_obs", 60, 850, 696, 22, 13, "OBSERVACIONES"),
		optField("f_obs", 60, 876, 696, 22, 13, "observaciones"),
		optLine("ln_foot", 60, 920, 696),
		optLabel("st_foot", 60, 928, 696, 30, 9, "Los lentes resistentes al impacto no son irrompibles. Revise la graduación antes de entregar."),
	)
	return els
}

// Garantía / solicitud de reparación.
func optGarantiaElements(biz, logo, dir, tel string) []optEl {
	els := optHeader(biz, logo, "SOLICITUD DE REPARACIÓN / GARANTÍA")
	x := 60
	if logo != "" {
		x = 136
	}
	contact := strings.TrimSpace(strings.Join(nonEmpty(dir, tel), " · "))
	if contact != "" {
		els = append(els, optLabel("st_dir", x, 94, 440, 16, 9, contact))
	}
	els = append(els,
		optLabel("st_folio", 588, 40, 34, 22, 15, "Nº"),
		optField("f_folio", 622, 40, 134, 22, 13, "folio"),
		optLabel("st_tipo", 588, 74, 168, 18, 11, "TIPO"),
		optChoice("c_tipo", 588, 94, 168, 46, 13, "tipo", "Tipo", false, true, "GARANTÍA", "REPARACIÓN"),
		optLine("ln1", 60, 148, 696),
		optLabel("st_datos", 60, 156, 696, 20, 13, "DATOS DEL CLIENTE"),
		optLabel("st_nom", 60, 188, 80, 22, 12, "NOMBRE:"),
		optField("f_nom", 140, 188, 616, 22, 13, "nombre"),
		optLabel("st_dir2", 60, 220, 90, 22, 12, "DIRECCIÓN:"),
		optField("f_dir", 150, 220, 366, 22, 13, "direccion"),
		optLabel("st_fecha", 528, 220, 60, 22, 12, "FECHA:"),
		optField("f_fecha", 588, 220, 168, 22, 13, "fecha"),
		optLabel("st_mail", 60, 252, 130, 22, 12, "CORREO:"),
		optField("f_mail", 190, 252, 326, 22, 13, "correo"),
		optLabel("st_tel", 528, 252, 40, 22, 12, "TEL.:"),
		optField("f_tel", 568, 252, 188, 22, 13, "telefono"),
		optLabel("st_req", 60, 292, 696, 20, 12, "REQUISITO: PRESENTAR COMPROBANTE DE COMPRA PARA GARANTÍA"),
		optLabel("st_comp", 60, 320, 210, 24, 12, "COMPROBANTE DE COMPRA:"),
		optChoice("c_comp", 270, 320, 330, 24, 13, "comprobante", "Comprobante de compra", false, false, "PRESENTADO", "NO PRESENTADO"),
		optLine("ln2", 60, 360, 696),
		optLabel("st_opt", 60, 368, 696, 20, 13, "PARA SER LLENADO POR LA ÓPTICA"),
		optLabel("st_rec", 60, 390, 696, 20, 11, "AL RECIBIR SE IDENTIFICAN RAYADURAS O DESPERFECTOS DONDE SE INDICA"),
		optEl{"id": "img_lentes", "type": "image", "x": 248, "y": 414, "w": 320, "h": 112, "src": "/static/images/lentes-garantia.svg"},
		optLabel("st_desp", 60, 538, 190, 22, 12, "RAYADURAS / DESPERFECTOS:"),
		optField("f_desp", 250, 538, 506, 22, 13, "desperfectos"),
		optLabel("st_serv", 60, 574, 696, 22, 12, "SERVICIO DE REPARACIÓN SOLICITADO Y CARACTERÍSTICAS DEL LENTE:"),
		optField("f_serv1", 60, 600, 696, 22, 13, "servicio"),
		optField("f_serv2", 60, 632, 696, 22, 13, "servicio2"),
		optLabel("st_obs", 60, 676, 150, 22, 12, "OBSERVACIONES:"),
		optField("f_obs1", 60, 704, 696, 22, 13, "observaciones"),
		optField("f_obs2", 60, 736, 696, 22, 13, "observaciones2"),
		optLabel("st_costo", 528, 676, 70, 22, 12, "COSTO $"),
		optField("f_costo", 598, 676, 158, 22, 13, "costo"),
		optLine("ln_firma", 60, 850, 320),
		optLabel("st_firma", 60, 856, 320, 30, 9, "ENTIENDO, ACEPTO Y ASUMO LOS RIESGOS Y CONDICIONES DE REPARACIÓN"),
		optField("f_recibido", 436, 826, 320, 22, 13, "recibido_por"),
		optLabel("st_recibido", 436, 856, 320, 20, 10, "RECIBIDO POR"),
		optLabel("st_nota", 60, 900, 696, 22, 11, "NOTA: PARA RECOGER SU LENTE ES INDISPENSABLE PRESENTAR ESTE COMPROBANTE"),
	)
	return els
}

func nonEmpty(v ...string) []string {
	out := []string{}
	for _, s := range v {
		if s = strings.TrimSpace(s); s != "" {
			out = append(out, s)
		}
	}
	return out
}

// OptBizInfo — lo del negocio que va en las plantillas de fábrica.
type OptBizInfo struct {
	Name, Logo, Address, Phone string
}

// EnsureOptTemplates crea las tres plantillas de fábrica la primera vez
// (o la que falte: historia clínica, orden de laboratorio, garantía).
func EnsureOptTemplates(userID uint, biz OptBizInfo) {
	if userID == 0 {
		return
	}
	if strings.TrimSpace(biz.Name) == "" {
		biz.Name = "Óptica"
	}
	type have struct{ Kind string }
	var kinds []have
	config.DB.Model(&OptExamTemplateRecord{}).Select("DISTINCT kind").Where("user_id = ?", userID).Scan(&kinds)
	got := map[string]bool{}
	for _, k := range kinds {
		got[k.Kind] = true
	}
	mk := func(kind, name string, els []optEl, active bool) {
		if got[kind] {
			return
		}
		b, err := json.Marshal(els)
		if err != nil {
			return
		}
		config.DB.Create(&OptExamTemplateRecord{UserID: userID, Name: name, CanvasW: 816, CanvasH: 1056, Elements: string(b), IsActive: active, Kind: kind})
	}
	mk(OptKindHistoria, "Historia clínica", optHistoriaElements(biz.Name, biz.Logo), true)
	mk(OptKindLab, "Orden de laboratorio", optLabElements(biz.Name, biz.Logo), false)
	mk(OptKindGarantia, "Garantía / Solicitud de reparación", optGarantiaElements(biz.Name, biz.Logo, biz.Address, biz.Phone), false)
}

/* =========================================================
   EXÁMENES
   ========================================================= */

// ExamNextVisit — la revisión que programó recepción al marcar la cita
// como "Asistió · compró" (3, 6 o 12 meses).
type ExamNextVisit struct {
	Fecha         string `json:"fecha"` // YYYY-MM-DD
	Meses         int    `json:"meses"`
	AppointmentID int64  `json:"appointmentId"`
}

type EyeExam struct {
	ID            int64           `json:"id"`
	TemplateID    int64           `json:"templateId"`
	PatientName   string          `json:"patientName"`
	PatientPhone  string          `json:"patientPhone"`
	Data          json.RawMessage `json:"data"`
	CreatedByName string          `json:"createdByName"`
	UserID        int64           `json:"userId,omitempty"` // cliente del Punto de venta (0 = sin ligar)
	AppointmentID int64           `json:"appointmentId,omitempty"`
	CreatedAt     time.Time       `json:"createdAt"`
	UpdatedAt     *time.Time      `json:"updatedAt,omitempty"`
	UpdatedByName string          `json:"updatedByName,omitempty"`
	ProximaCita   *ExamNextVisit  `json:"proximaCita,omitempty"`
}

// EyeExamLite — sin los resultados (contadores y directorio).
type EyeExamLite struct {
	ID            int64     `json:"id"`
	PatientName   string    `json:"patientName"`
	PatientPhone  string    `json:"patientPhone"`
	CreatedByName string    `json:"createdByName"`
	UserID        int64     `json:"userId,omitempty"`
	AppointmentID int64     `json:"appointmentId,omitempty"`
	CreatedAt     time.Time `json:"createdAt"`
}

func i64(p *int64) int64 {
	if p == nil {
		return 0
	}
	return *p
}
func ptr64(v int64) *int64 {
	if v <= 0 {
		return nil
	}
	return &v
}

func toEyeExam(r *OptEyeExamRecord) EyeExam {
	return EyeExam{ID: r.ID, TemplateID: r.TemplateID, PatientName: r.PatientName, PatientPhone: r.PatientPhone,
		Data: rawJSON(r.Data, `{"fields":{},"tables":{}}`), CreatedByName: r.CreatedByName, UserID: i64(r.ClientID),
		AppointmentID: i64(r.AppointmentID), CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt, UpdatedByName: r.UpdatedByName}
}

// CreateEyeExam guarda una historia clínica llenada.
func CreateEyeExam(userID uint, templateID int64, name, phone string, data json.RawMessage, by string, clientID, apptID int64) (*EyeExam, error) {
	if !optClientOK(userID, clientID) {
		clientID = 0
	}
	r := OptEyeExamRecord{UserID: userID, TemplateID: templateID, PatientName: cut(name, 160), PatientPhone: cut(phone, 40),
		Data: string(data), CreatedByName: cut(by, 120), ClientID: ptr64(clientID), AppointmentID: ptr64(apptID), CreatedAt: time.Now()}
	if err := config.DB.Create(&r).Error; err != nil {
		return nil, err
	}
	e := toEyeExam(&r)
	return &e, nil
}

// UpdateEyeExam — Editar: plantilla, quién lo hizo y cuándo no cambian.
func UpdateEyeExam(userID uint, id int64, name, phone string, data json.RawMessage, clientID int64, by string) (*EyeExam, error) {
	upd := map[string]interface{}{"patient_name": cut(name, 160), "patient_phone": cut(phone, 40), "data": string(data),
		"updated_at": time.Now(), "updated_by_name": cut(by, 120)}
	if clientID > 0 && optClientOK(userID, clientID) {
		upd["client_id"] = clientID
	}
	res := config.DB.Model(&OptEyeExamRecord{}).Where("id = ? AND user_id = ?", id, userID).Updates(upd)
	if res.Error != nil {
		return nil, res.Error
	}
	return GetEyeExam(userID, id)
}

// GetEyeExam — un examen con sus resultados.
func GetEyeExam(userID uint, id int64) (*EyeExam, error) {
	var r OptEyeExamRecord
	if err := config.DB.Where("id = ? AND user_id = ?", id, userID).First(&r).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrEyeExamNotFound
		}
		return nil, err
	}
	e := toEyeExam(&r)
	return &e, nil
}

// ListEyeExams — con resultados; term filtra por nombre del paciente.
func ListEyeExams(userID uint, term string) ([]EyeExam, error) {
	q := config.DB.Where("user_id = ?", userID)
	if term = strings.TrimSpace(term); term != "" {
		q = q.Where("patient_name LIKE ?", "%"+term+"%")
	}
	var rows []OptEyeExamRecord
	if err := q.Order("created_at DESC, id DESC").Limit(1000).Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]EyeExam, 0, len(rows))
	for i := range rows {
		out = append(out, toEyeExam(&rows[i]))
	}
	return out, nil
}

// ListEyeExamsLite — todos, sin resultados, el más reciente primero.
func ListEyeExamsLite(userID uint) ([]EyeExamLite, error) {
	var rows []OptEyeExamRecord
	if err := config.DB.Select("id, patient_name, patient_phone, created_by_name, client_id, appointment_id, created_at").
		Where("user_id = ?", userID).Order("created_at DESC, id DESC").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]EyeExamLite, 0, len(rows))
	for _, r := range rows {
		out = append(out, EyeExamLite{ID: r.ID, PatientName: r.PatientName, PatientPhone: r.PatientPhone, CreatedByName: r.CreatedByName,
			UserID: i64(r.ClientID), AppointmentID: i64(r.AppointmentID), CreatedAt: r.CreatedAt})
	}
	return out, nil
}

func getEyeExamsByIDs(userID uint, ids []int64) ([]EyeExam, error) {
	out := []EyeExam{}
	if len(ids) == 0 {
		return out, nil
	}
	var rows []OptEyeExamRecord
	if err := config.DB.Where("user_id = ? AND id IN ?", userID, ids).Order("created_at DESC, id DESC").Find(&rows).Error; err != nil {
		return nil, err
	}
	for i := range rows {
		out = append(out, toEyeExam(&rows[i]))
	}
	return out, nil
}

// DeleteEyeExam — borra un examen.
func DeleteEyeExam(userID uint, id int64) error {
	res := config.DB.Where("id = ? AND user_id = ?", id, userID).Delete(&OptEyeExamRecord{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrEyeExamNotFound
	}
	return nil
}

// MarkAppointmentAttended — al guardar el examen de una cita pendiente o
// confirmada, la cita queda como "asistió".
func MarkAppointmentAttended(userID uint, apptID int64) bool {
	if apptID <= 0 {
		return false
	}
	res := config.DB.Model(&Appointment{}).
		Where("id = ? AND user_id = ? AND status IN ?", apptID, userID, []AppointmentStatus{AppointmentStatusPending, AppointmentStatusConfirmed}).
		Update("status", AppointmentStatusCompleted)
	return res.Error == nil && res.RowsAffected > 0
}

/* ---------- pacientes (clientes del Punto de venta) ---------- */

// PatientMatch — lo mínimo para el autocompletado del campo NOMBRE.
type PatientMatch struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Phone string `json:"phone"`
}

// optClientOK: el cliente es de este negocio.
func optClientOK(userID uint, clientID int64) bool {
	if clientID <= 0 {
		return false
	}
	var n int64
	config.DB.Table("pos_clients").Where("id = ? AND user_id = ?", clientID, userID).Count(&n)
	return n > 0
}

// SearchPatients busca clientes del Punto de venta por nombre o celular.
func SearchPatients(userID uint, term string) ([]PatientMatch, error) {
	term = strings.TrimSpace(term)
	out := []PatientMatch{}
	if len([]rune(term)) < 2 {
		return out, nil
	}
	like := "%" + term + "%"
	rows, err := invDB().Query(`SELECT id, nombre, celular FROM pos_clients
		WHERE user_id = ? AND (nombre LIKE ? OR celular LIKE ?) AND LOWER(nombre) NOT LIKE '%publico en general%' AND LOWER(nombre) NOT LIKE '%público en general%'
		ORDER BY nombre LIMIT 8`, userID, like, like)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var p PatientMatch
		if err := rows.Scan(&p.ID, &p.Name, &p.Phone); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

/* ---------- próxima revisión (de la cita) ---------- */

func phoneTail(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	d := b.String()
	if len(d) > 10 {
		d = d[len(d)-10:]
	}
	return d
}

type optApptFollow struct {
	id     int64
	date   time.Time
	nombre string
	phone  string
	meses  int
}

// optFollowups — las citas marcadas "Asistió · compró" con meses de revisión.
func optFollowups(userID uint) (map[int64]optApptFollow, map[string][]optApptFollow) {
	byID := map[int64]optApptFollow{}
	byDay := map[string][]optApptFollow{}
	var list []Appointment
	if err := config.DB.Select("id, date, client_first_name, client_last_name, client_phone, revision_months").
		Where("user_id = ? AND followup_set = ? AND bought = ? AND revision_months > 0", userID, true, true).Find(&list).Error; err != nil {
		return byID, byDay
	}
	for _, a := range list {
		f := optApptFollow{id: int64(a.ID), date: a.Date.In(invLoc), nombre: NormalizePatientName(a.ClientFirstName + " " + a.ClientLastName),
			phone: phoneTail(a.ClientPhone), meses: a.RevisionMonths}
		byID[f.id] = f
		day := f.date.Format("2006-01-02")
		byDay[day] = append(byDay[day], f)
	}
	return byID, byDay
}

// AttachNextVisits llena ProximaCita en los exámenes que tengan una.
func AttachNextVisits(userID uint, exams []EyeExam) {
	if len(exams) == 0 {
		return
	}
	byID, byDay := optFollowups(userID)
	if len(byID) == 0 {
		return
	}
	for i := range exams {
		e := &exams[i]
		a, ok := byID[e.AppointmentID]
		if !ok {
			day := e.CreatedAt.In(invLoc).Format("2006-01-02")
			name, phone := NormalizePatientName(e.PatientName), phoneTail(e.PatientPhone)
			for _, c := range byDay[day] {
				if (len(phone) >= 7 && c.phone == phone) || (name != "" && c.nombre == name) {
					a, ok = c, true
					break
				}
			}
		}
		if !ok {
			continue
		}
		d := time.Date(a.date.Year(), a.date.Month(), a.date.Day(), 12, 0, 0, 0, time.UTC).AddDate(0, a.meses, 0)
		e.ProximaCita = &ExamNextVisit{Fecha: d.Format("2006-01-02"), Meses: a.meses, AppointmentID: a.id}
	}
}

/* =========================================================
   HISTORIAL CLÍNICO — por paciente
   ========================================================= */

// PatientSummary — una fila del directorio.
type PatientSummary struct {
	Key           string    `json:"key"`
	Name          string    `json:"name"`
	Phone         string    `json:"phone"`
	UserID        int64     `json:"userId,omitempty"`
	Exams         int       `json:"exams"`
	FirstAt       time.Time `json:"firstAt"`
	LastAt        time.Time `json:"lastAt"`
	LastBy        string    `json:"lastBy"`
	LastExamID    int64     `json:"lastExamId"`
	RevisionMeses int       `json:"revisionMeses"`
	NextRevision  time.Time `json:"nextRevision"`

	lastApptID int64
	examIDs    []int64
	names      []string
}

var patientKeyRe = regexp.MustCompile(`^(u:[0-9]{1,18}|n:.{2,180})$`)

// ValidPatientKey revisa la forma de la key que manda el frontend.
func ValidPatientKey(key string) bool { return patientKeyRe.MatchString(key) }

var accentFold = strings.NewReplacer(
	"á", "a", "à", "a", "ä", "a", "â", "a", "ã", "a",
	"é", "e", "è", "e", "ë", "e", "ê", "e",
	"í", "i", "ì", "i", "ï", "i", "î", "i",
	"ó", "o", "ò", "o", "ö", "o", "ô", "o", "õ", "o",
	"ú", "u", "ù", "u", "ü", "u", "û", "u",
	"ñ", "n", "ç", "c",
)

// NormalizePatientName: minúsculas, sin acentos y con espacios sencillos.
func NormalizePatientName(s string) string {
	s = accentFold.Replace(strings.ToLower(strings.TrimSpace(s)))
	return strings.Join(strings.Fields(s), " ")
}

func groupPatients(userID uint, exams []EyeExamLite) []*PatientSummary {
	userByName := map[string]map[int64]bool{}
	for _, e := range exams {
		if e.UserID > 0 {
			n := NormalizePatientName(e.PatientName)
			if userByName[n] == nil {
				userByName[n] = map[int64]bool{}
			}
			userByName[n][e.UserID] = true
		}
	}
	groups := map[string]*PatientSummary{}
	order := []string{}
	for _, e := range exams {
		key := ""
		if e.UserID > 0 {
			key = "u:" + strconv.FormatInt(e.UserID, 10)
		} else {
			n := NormalizePatientName(e.PatientName)
			if n == "" {
				continue
			}
			if us := userByName[n]; len(us) == 1 {
				for id := range us {
					key = "u:" + strconv.FormatInt(id, 10)
				}
			} else {
				key = "n:" + n
			}
		}
		g := groups[key]
		if g == nil {
			g = &PatientSummary{Key: key, Name: strings.TrimSpace(e.PatientName), LastAt: e.CreatedAt, LastBy: e.CreatedByName,
				LastExamID: e.ID, lastApptID: e.AppointmentID}
			if strings.HasPrefix(key, "u:") {
				g.UserID, _ = strconv.ParseInt(key[2:], 10, 64)
			}
			groups[key] = g
			order = append(order, key)
		}
		g.names = append(g.names, e.PatientName)
		if g.Phone == "" && strings.TrimSpace(e.PatientPhone) != "" {
			g.Phone = strings.TrimSpace(e.PatientPhone)
		}
		g.Exams++
		g.FirstAt = e.CreatedAt
		g.examIDs = append(g.examIDs, e.ID)
	}
	out := make([]*PatientSummary, 0, len(order))
	for _, k := range order {
		g := groups[k]
		g.Name = bestName(g.names)
		out = append(out, g)
	}
	applyClientNames(userID, out)
	return out
}

func bestName(names []string) string {
	best, bestScore := "", -1
	for _, n := range names {
		n = strings.Join(strings.Fields(n), " ")
		score := 0
		for _, r := range n {
			if r > 127 {
				score++
			}
		}
		if score > bestScore {
			best, bestScore = n, score
		}
	}
	return best
}

// applyClientNames: si está ligado a un cliente, se usa su nombre.
func applyClientNames(userID uint, list []*PatientSummary) {
	ids := []interface{}{userID}
	ph := []string{}
	byID := map[int64]*PatientSummary{}
	for _, p := range list {
		if p.UserID > 0 {
			ids = append(ids, p.UserID)
			ph = append(ph, "?")
			byID[p.UserID] = p
		}
	}
	if len(ph) == 0 {
		return
	}
	rows, err := invDB().Query(`SELECT id, nombre, celular FROM pos_clients WHERE user_id = ? AND id IN (`+strings.Join(ph, ",")+`)`, ids...)
	if err != nil {
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var name, phone string
		if rows.Scan(&id, &name, &phone) != nil {
			continue
		}
		if p := byID[id]; p != nil {
			if n := strings.TrimSpace(name); n != "" {
				p.Name = n
			}
			if p.Phone == "" {
				p.Phone = strings.TrimSpace(phone)
			}
		}
	}
}

// applyRevisionMonths: cada cuánto le toca la revisión (la de la cita
// marcada "compró" o, si no hay, 12 meses).
func applyRevisionMonths(userID uint, list []*PatientSummary) {
	byID, _ := optFollowups(userID)
	for _, p := range list {
		p.RevisionMeses = 12
		if a, ok := byID[p.lastApptID]; ok && (a.meses == 3 || a.meses == 6 || a.meses == 12) {
			p.RevisionMeses = a.meses
		}
		p.NextRevision = p.LastAt.AddDate(0, p.RevisionMeses, 0)
	}
}

// ListPatientSummaries — directorio, el de visita más reciente primero.
func ListPatientSummaries(userID uint) ([]PatientSummary, error) {
	exams, err := ListEyeExamsLite(userID)
	if err != nil {
		return nil, err
	}
	groups := groupPatients(userID, exams)
	applyRevisionMonths(userID, groups)
	sort.SliceStable(groups, func(i, j int) bool { return groups[i].LastAt.After(groups[j].LastAt) })
	out := make([]PatientSummary, len(groups))
	for i, g := range groups {
		out[i] = *g
	}
	return out, nil
}

// GetPatientFile — resumen y exámenes completos de un paciente.
func GetPatientFile(userID uint, key string) (*PatientSummary, []EyeExam, error) {
	exams, err := ListEyeExamsLite(userID)
	if err != nil {
		return nil, nil, err
	}
	for _, g := range groupPatients(userID, exams) {
		if g.Key == key {
			applyRevisionMonths(userID, []*PatientSummary{g})
			full, err := getEyeExamsByIDs(userID, g.examIDs)
			if err != nil {
				return nil, nil, err
			}
			return g, full, nil
		}
	}
	if strings.HasPrefix(key, "u:") {
		id, _ := strconv.ParseInt(key[2:], 10, 64)
		var name, phone string
		err := invDB().QueryRow(`SELECT nombre, celular FROM pos_clients WHERE id = ? AND user_id = ?`, id, userID).Scan(&name, &phone)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil, ErrPatientNotFound
		}
		if err != nil {
			return nil, nil, err
		}
		return &PatientSummary{Key: key, Name: name, Phone: phone, UserID: id, RevisionMeses: 12}, []EyeExam{}, nil
	}
	return nil, nil, ErrPatientNotFound
}

/* ---------- antecedentes ---------- */

type PatientAntecedentes struct {
	Data      json.RawMessage `json:"data"`
	UpdatedBy string          `json:"updatedBy"`
	UpdatedAt *time.Time      `json:"updatedAt,omitempty"`
}

// GetPatientAntecedentes busca por la primera key que tenga algo.
func GetPatientAntecedentes(userID uint, keys ...string) *PatientAntecedentes {
	for _, k := range keys {
		if k == "" {
			continue
		}
		var r OptAntecedentesRecord
		if err := config.DB.Where("user_id = ? AND patient_key = ?", userID, k).First(&r).Error; err == nil {
			at := r.UpdatedAt
			return &PatientAntecedentes{Data: rawJSON(r.Data, "{}"), UpdatedBy: r.UpdatedBy, UpdatedAt: &at}
		}
	}
	return &PatientAntecedentes{Data: json.RawMessage(`{}`)}
}

// SetPatientAntecedentes guarda (o reemplaza) los antecedentes.
func SetPatientAntecedentes(userID uint, key, name string, data json.RawMessage, by string) error {
	r := OptAntecedentesRecord{UserID: userID, PatientKey: key, PatientName: cut(name, 190), Data: string(data), UpdatedBy: cut(by, 120), UpdatedAt: time.Now()}
	return config.DB.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "user_id"}, {Name: "patient_key"}},
		DoUpdates: clause.AssignmentColumns([]string{"patient_name", "data", "updated_by", "updated_at"}),
	}).Create(&r).Error
}

/* =========================================================
   HOJAS: ORDEN DE LABORATORIO Y GARANTÍA
   ========================================================= */

type LabOrderSheet struct {
	ID            int64           `json:"id"`
	Kind          string          `json:"kind"`
	Folio         *int            `json:"folio,omitempty"`
	ExamID        *int64          `json:"examId,omitempty"`
	TemplateID    int64           `json:"templateId"`
	PatientName   string          `json:"patientName"`
	PatientPhone  string          `json:"patientPhone"`
	UserID        *int64          `json:"userId,omitempty"`
	Data          json.RawMessage `json:"data"`
	CreatedByName string          `json:"createdByName"`
	CreatedAt     time.Time       `json:"createdAt"`
	UpdatedAt     *time.Time      `json:"updatedAt,omitempty"`
	UpdatedByName string          `json:"updatedByName,omitempty"`
}

func toLabSheet(r *OptLabSheetRecord) LabOrderSheet {
	return LabOrderSheet{ID: r.ID, Kind: r.Kind, Folio: r.Folio, ExamID: r.ExamID, TemplateID: r.TemplateID,
		PatientName: r.PatientName, PatientPhone: r.PatientPhone, UserID: r.ClientID, Data: rawJSON(r.Data, `{"fields":{},"tables":{}}`),
		CreatedByName: r.CreatedByName, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt, UpdatedByName: r.UpdatedByName}
}

// NextLabFolio — el Nº que le toca a la siguiente orden de laboratorio.
func NextLabFolio(userID uint) (int, error) {
	var n int
	err := invDB().QueryRow("SELECT COALESCE(MAX(folio), 0) + 1 FROM opt_lab_sheets WHERE user_id = ? AND kind = ?", userID, OptKindLab).Scan(&n)
	return n, err
}

// withFolio pone el Nº en la hoja (data.fields.folio).
func withFolio(data json.RawMessage, n int) json.RawMessage {
	var m map[string]interface{}
	if json.Unmarshal(data, &m) != nil || m == nil {
		m = map[string]interface{}{}
	}
	fields, _ := m["fields"].(map[string]interface{})
	if fields == nil {
		fields = map[string]interface{}{}
	}
	fields["folio"] = strconv.Itoa(n)
	m["fields"] = fields
	out, err := json.Marshal(m)
	if err != nil {
		return data
	}
	return out
}

// CreateLabSheet guarda una orden o garantía llenada. La orden lleva Nº
// automático (si dos se guardan al mismo tiempo, el índice único hace que
// una reintente con el que sigue).
func CreateLabSheet(userID uint, kind string, examID, templateID int64, name, phone string, clientID int64, data json.RawMessage, by string) (*LabOrderSheet, error) {
	if len(data) == 0 {
		data = json.RawMessage(`{}`)
	}
	if !optClientOK(userID, clientID) {
		clientID = 0
	}
	if examID > 0 {
		if _, err := GetEyeExam(userID, examID); err != nil {
			examID = 0
		}
	}
	for attempt := 0; attempt < 6; attempt++ {
		r := OptLabSheetRecord{UserID: userID, Kind: kind, ExamID: ptr64(examID), TemplateID: templateID, PatientName: cut(name, 160),
			PatientPhone: cut(phone, 40), ClientID: ptr64(clientID), Data: string(data), CreatedByName: cut(by, 120), CreatedAt: time.Now()}
		if kind == OptKindLab {
			n, err := NextLabFolio(userID)
			if err != nil {
				return nil, err
			}
			r.Folio = &n
			r.Data = string(withFolio(data, n))
		}
		if err := config.DB.Create(&r).Error; err != nil {
			if r.Folio != nil && (strings.Contains(err.Error(), "1062") || strings.Contains(err.Error(), "Duplicate")) {
				continue
			}
			return nil, err
		}
		s := toLabSheet(&r)
		return &s, nil
	}
	return nil, errors.New("no se pudo asignar el número de la orden")
}

// UpdateLabSheet — Editar (conserva tipo, Nº, plantilla y quién la hizo).
func UpdateLabSheet(userID uint, id int64, name, phone string, clientID int64, data json.RawMessage, by string) (*LabOrderSheet, error) {
	cur, err := GetLabSheet(userID, id)
	if err != nil {
		return nil, err
	}
	if len(data) == 0 {
		data = json.RawMessage(`{}`)
	}
	if cur.Kind == OptKindLab && cur.Folio != nil {
		data = withFolio(data, *cur.Folio)
	}
	upd := map[string]interface{}{"patient_name": cut(name, 160), "patient_phone": cut(phone, 40), "data": string(data),
		"updated_at": time.Now(), "updated_by_name": cut(by, 120)}
	if clientID > 0 && optClientOK(userID, clientID) {
		upd["client_id"] = clientID
	}
	if err := config.DB.Model(&OptLabSheetRecord{}).Where("id = ? AND user_id = ?", id, userID).Updates(upd).Error; err != nil {
		return nil, err
	}
	return GetLabSheet(userID, id)
}

// GetLabSheet — una hoja del negocio.
func GetLabSheet(userID uint, id int64) (*LabOrderSheet, error) {
	var r OptLabSheetRecord
	if err := config.DB.Where("id = ? AND user_id = ?", id, userID).First(&r).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrLabSheetNotFound
		}
		return nil, err
	}
	s := toLabSheet(&r)
	return &s, nil
}

// ListLabSheets — la más reciente primero; examID y kind filtran.
func ListLabSheets(userID uint, examID int64, kind string) ([]LabOrderSheet, error) {
	q := config.DB.Where("user_id = ?", userID)
	if examID > 0 {
		q = q.Where("exam_id = ?", examID)
	}
	if kind != "" {
		q = q.Where("kind = ?", kind)
	}
	var rows []OptLabSheetRecord
	if err := q.Order("created_at DESC, id DESC").Limit(500).Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]LabOrderSheet, 0, len(rows))
	for i := range rows {
		out = append(out, toLabSheet(&rows[i]))
	}
	return out, nil
}

// DeleteLabSheet — borra una hoja (y el trabajo que salió de ella sin venta).
func DeleteLabSheet(userID uint, id int64) error {
	res := config.DB.Where("id = ? AND user_id = ?", id, userID).Delete(&OptLabSheetRecord{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrLabSheetNotFound
	}
	config.DB.Where("user_id = ? AND lab_sheet_id = ? AND lab_directo = ?", userID, id, true).Delete(&Order{})
	config.DB.Model(&Order{}).Where("user_id = ? AND lab_sheet_id = ?", userID, id).Update("lab_sheet_id", nil)
	return nil
}

// GarantiasResumen — garantías del mes (las marcadas REPARACIÓN aparte).
type GarantiasResumen struct {
	Total           int            `json:"total"`
	Reparaciones    int            `json:"reparaciones"`
	PorOptometrista map[string]int `json:"porOptometrista"`
}

func GetGarantiasResumen(userID uint, from, to time.Time) (*GarantiasResumen, error) {
	var rows []OptLabSheetRecord
	if err := config.DB.Select("created_by_name, data").Where("user_id = ? AND kind = ? AND created_at >= ? AND created_at < ?", userID, OptKindGarantia, from, to).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	out := &GarantiasResumen{PorOptometrista: map[string]int{}}
	for _, r := range rows {
		if isReparacion([]byte(r.Data)) {
			out.Reparaciones++
			continue
		}
		out.Total++
		who := r.CreatedByName
		if who == "" {
			who = "Sin nombre"
		}
		out.PorOptometrista[who]++
	}
	return out, nil
}

func isReparacion(raw []byte) bool {
	var d struct {
		Fields map[string]string `json:"fields"`
	}
	if json.Unmarshal(raw, &d) != nil {
		return false
	}
	t := strings.ToUpper(d.Fields["tipo"])
	return strings.Contains(t, "REPARACI") && !strings.Contains(t, "GARANT")
}

// ListSheetsForPatient — las órdenes y garantías de un paciente (por su
// cliente, por sus exámenes o por su nombre).
func ListSheetsForPatient(userID uint, clientID int64, name string, examIDs []int64) ([]LabOrderSheet, error) {
	norm := NormalizePatientName(name)
	q := config.DB.Where("user_id = ?", userID)
	conds := []string{}
	args := []interface{}{}
	if clientID > 0 {
		conds = append(conds, "client_id = ?")
		args = append(args, clientID)
	}
	if len(examIDs) > 0 {
		conds = append(conds, "exam_id IN ?")
		args = append(args, examIDs)
	}
	if first := strings.Fields(strings.TrimSpace(name)); len(first) > 0 {
		conds = append(conds, "patient_name LIKE ?")
		args = append(args, "%"+first[0]+"%")
	}
	out := []LabOrderSheet{}
	if len(conds) == 0 {
		return out, nil
	}
	var rows []OptLabSheetRecord
	if err := q.Where("("+strings.Join(conds, " OR ")+")", args...).Order("created_at DESC, id DESC").Limit(300).Find(&rows).Error; err != nil {
		return nil, err
	}
	inExam := map[int64]bool{}
	for _, id := range examIDs {
		inExam[id] = true
	}
	for i := range rows {
		s := toLabSheet(&rows[i])
		if (clientID > 0 && s.UserID != nil && *s.UserID == clientID) || (s.ExamID != nil && inExam[*s.ExamID]) ||
			(norm != "" && NormalizePatientName(s.PatientName) == norm) {
			out = append(out, s)
		}
	}
	return out, nil
}

/* =========================================================
   PUNTO DE VENTA → OPTOMETRÍA → LABORATORIO
   ========================================================= */

// LabHojaRef — lo que el tablero del laboratorio necesita de la orden.
type LabHojaRef struct {
	ID      int64     `json:"id"`
	Folio   int       `json:"folio,omitempty"`
	Fecha   time.Time `json:"fecha"`
	Patient string    `json:"paciente"`
	Auto    bool      `json:"auto"` // encontrada sola (no ligada a mano)
}

type labHojaRow struct {
	ref   LabHojaRef
	name  string
	phone string
}

func labHojasAll(userID uint) []labHojaRow {
	var rows []OptLabSheetRecord
	if err := config.DB.Select("id, folio, patient_name, patient_phone, created_at").
		Where("user_id = ? AND kind = ?", userID, OptKindLab).Order("created_at DESC, id DESC").Limit(3000).Find(&rows).Error; err != nil {
		return nil
	}
	out := make([]labHojaRow, 0, len(rows))
	for _, r := range rows {
		h := labHojaRow{ref: LabHojaRef{ID: r.ID, Fecha: r.CreatedAt, Patient: r.PatientName}, name: NormalizePatientName(r.PatientName), phone: phoneTail(r.PatientPhone)}
		if r.Folio != nil {
			h.ref.Folio = *r.Folio
		}
		out = append(out, h)
	}
	return out
}

// labOrderHojaInfo — lo que se necesita de cada pedido para buscar su hoja.
type labOrderHojaInfo struct {
	SheetID   int64
	Directo   bool
	Name      string
	Phone     string
	CreatedAt time.Time
}

// matchLabHojas — la orden de laboratorio de cada pedido: la ligada o,
// si no tiene, la más reciente del mismo cliente (mismo celular o nombre)
// hecha antes del trabajo (o hasta 3 días después) y no más de 120 días antes.
func matchLabHojas(userID uint, orders []labOrderHojaInfo) []*LabHojaRef {
	out := make([]*LabHojaRef, len(orders))
	if len(orders) == 0 {
		return out
	}
	hojas := labHojasAll(userID)
	if len(hojas) == 0 {
		return out
	}
	byID := map[int64]labHojaRow{}
	for _, h := range hojas {
		byID[h.ref.ID] = h
	}
	propias := map[int64]bool{}
	for _, o := range orders {
		if o.Directo && o.SheetID > 0 {
			propias[o.SheetID] = true
		}
	}
	for i, o := range orders {
		if o.SheetID > 0 {
			if h, ok := byID[o.SheetID]; ok {
				r := h.ref
				out[i] = &r
			}
			continue
		}
		name := NormalizePatientName(o.Name)
		if strings.Contains(name, "publico en general") {
			name = ""
		}
		phone := phoneTail(o.Phone)
		if name == "" && len(phone) < 7 {
			continue
		}
		hi, lo := o.CreatedAt.Add(72*time.Hour), o.CreatedAt.Add(-120*24*time.Hour)
		for _, h := range hojas {
			if propias[h.ref.ID] || h.ref.Fecha.After(hi) || h.ref.Fecha.Before(lo) {
				continue
			}
			if (len(phone) >= 7 && h.phone == phone) || (name != "" && h.name == name) {
				r := h.ref
				r.Auto = true
				out[i] = &r
				break
			}
		}
	}
	return out
}

// SearchLabHojas — órdenes de laboratorio recientes (para ligarlas a mano).
func SearchLabHojas(userID uint, q string, limit int) []LabHojaRef {
	q = NormalizePatientName(q)
	out := []LabHojaRef{}
	for _, h := range labHojasAll(userID) {
		if q != "" && !strings.Contains(h.name, q) && !strings.Contains(h.phone, q) && strconv.Itoa(h.ref.Folio) != strings.TrimPrefix(q, "n") {
			continue
		}
		out = append(out, h.ref)
		if len(out) >= limit {
			break
		}
	}
	return out
}

// SetOrderLabHoja liga (sheetID > 0) o desliga (0 = volver a la
// automática) la orden de laboratorio de un trabajo.
func SetOrderLabHoja(userID, orderID uint, sheetID int64) error {
	if _, err := labGetOrder(userID, orderID); err != nil {
		return err
	}
	var v interface{}
	if sheetID > 0 {
		s, err := GetLabSheet(userID, sheetID)
		if err != nil || s.Kind != OptKindLab {
			return ErrLabSheetNotFound
		}
		v = sheetID
	}
	return config.DB.Model(&Order{}).Where("id = ? AND user_id = ?", orderID, userID).Update("lab_sheet_id", v).Error
}

// GetLabHojaFull — la orden con su plantilla (para dibujarla).
func GetLabHojaFull(userID uint, id int64) (*LabOrderSheet, *ExamTemplate, error) {
	h, err := GetLabSheet(userID, id)
	if err != nil {
		return nil, nil, err
	}
	if h.Kind != OptKindLab {
		return nil, nil, ErrLabSheetNotFound
	}
	t, _ := GetExamTemplate(userID, h.TemplateID)
	return h, t, nil
}

// LinkSaleOrderToSheet — la orden se hizo desde una venta: su trabajo
// (pedido) queda ligado a ella.
func LinkSaleOrderToSheet(userID uint, orderID int64, sheetID int64) error {
	res := config.DB.Model(&Order{}).Where("id = ? AND user_id = ? AND pos_sale_id IS NOT NULL", orderID, userID).Update("lab_sheet_id", sheetID)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrLabOrderNotFound
	}
	return nil
}

// CreateDirectLabJob — orden de laboratorio hecha SIN venta: le llega al
// laboratorio como trabajo propio (sin clave de rastreo).
func CreateDirectLabJob(userID uint, sheet *LabOrderSheet, by string) error {
	sid := sheet.ID
	name := strings.TrimSpace(sheet.PatientName)
	if name == "" {
		name = "Paciente sin nombre"
	}
	o := Order{
		UserID:      userID,
		ClientName:  cut(name, 255),
		ClientPhone: cut(sheet.PatientPhone, 50),
		Items:       OrderItems{{Name: "Orden de laboratorio", Quantity: 1}},
		OrderType:   OrderTypeLocalPickup,
		Status:      OrderStatusConfirmed,
		Source:      OrderSourceLab,
		LabStep:     LabStepRecibido,
		LabSheetID:  &sid,
		LabDirecto:  true,
	}
	if sheet.Folio != nil {
		o.Notes = "Orden de laboratorio Nº " + strconv.Itoa(*sheet.Folio)
	}
	if err := config.DB.Create(&o).Error; err != nil {
		return err
	}
	LogOrderStatus(userID, o.ID, string(o.Status), LabStepRecibido, by)
	return nil
}

// SyncDirectLabJob — al editar la orden, su trabajo toma el nombre nuevo.
func SyncDirectLabJob(userID uint, sheetID int64, name, phone string) {
	config.DB.Model(&Order{}).Where("user_id = ? AND lab_sheet_id = ? AND lab_directo = ?", userID, sheetID, true).
		Updates(map[string]interface{}{"client_name": cut(strings.TrimSpace(name), 255), "client_phone": cut(phone, 50)})
}

// VentaPendienteOrden — una venta del Punto de venta con trabajo que
// todavía no tiene orden de laboratorio.
type VentaPendienteOrden struct {
	PedidoID   uint      `json:"pedidoId"`
	Code       string    `json:"code"`
	Folio      int64     `json:"folio"`
	Cliente    string    `json:"cliente"`
	Celular    string    `json:"celular"`
	Productos  []string  `json:"productos"`
	Total      float64   `json:"total"`
	Cajero     string    `json:"cajero"`
	Fecha      time.Time `json:"fecha"`
	TicketPath string    `json:"ticketPath"`
}

// ListVentasPendientesOrden — ventas (no canceladas, de los últimos 60
// días) cuyo trabajo no tiene orden de laboratorio (ni ligada ni
// encontrada por nombre / celular) ni se marcó "no lleva orden".
func ListVentasPendientesOrden(userID uint) ([]VentaPendienteOrden, error) {
	var list []Order
	if err := config.DB.Where("user_id = ? AND pos_sale_id IS NOT NULL AND lab_sheet_id IS NULL AND lab_sin_hoja = ? AND status <> ? AND created_at >= ?",
		userID, false, OrderStatusCancelled, time.Now().AddDate(0, 0, -60)).Order("created_at DESC").Limit(200).Find(&list).Error; err != nil {
		return nil, err
	}
	info := make([]labOrderHojaInfo, len(list))
	for i, o := range list {
		info[i] = labOrderHojaInfo{Name: o.ClientName, Phone: o.ClientPhone, CreatedAt: o.CreatedAt}
	}
	auto := matchLabHojas(userID, info)
	out := []VentaPendienteOrden{}
	for i, o := range list {
		if auto[i] != nil || o.PosSaleID == nil {
			continue
		}
		v := VentaPendienteOrden{PedidoID: o.ID, Code: o.TrackingCode}
		var clientID sql.NullInt64
		var cancelada bool
		if err := invDB().QueryRow(`SELECT folio, cliente, client_id, total, cajero, created_at, cancelada FROM pos_sales WHERE id = ? AND user_id = ?`,
			*o.PosSaleID, userID).Scan(&v.Folio, &v.Cliente, &clientID, &v.Total, &v.Cajero, &v.Fecha, &cancelada); err != nil || cancelada {
			continue
		}
		if clientID.Valid {
			v.Celular = PosClientPhone(userID, clientID.Int64)
		}
		rows, err := invDB().Query(`SELECT cantidad, descripcion FROM pos_sale_items WHERE sale_id = ? ORDER BY id`, *o.PosSaleID)
		if err == nil {
			for rows.Next() {
				var q int
				var d string
				if rows.Scan(&q, &d) == nil {
					if q > 1 {
						d = strconv.Itoa(q) + " × " + d
					}
					v.Productos = append(v.Productos, d)
				}
			}
			rows.Close()
		}
		out = append(out, v)
	}
	return out, nil
}

// MarkPedidoSinHoja — la venta no lleva orden de laboratorio.
func MarkPedidoSinHoja(userID uint, orderID int64) error {
	res := config.DB.Model(&Order{}).Where("id = ? AND user_id = ? AND pos_sale_id IS NOT NULL", orderID, userID).Update("lab_sin_hoja", true)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrLabOrderNotFound
	}
	return nil
}
