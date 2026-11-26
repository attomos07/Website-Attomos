package models

// pos_perfil.go — Punto de venta ligado a Mis citas y a Optometría
// (portado de Avante, sin Clarito+):
//   - Citas de hoy: se elige al que llegó y se traen su nombre, celular,
//     correo y fecha de nacimiento.
//   - Al cobrar, la cita de ese cliente queda "Asistió · Compró".
//   - Perfil del cliente: sus datos, sus compras y (ópticas) sus exámenes
//     de la vista agrupados por año.
//   - Ventas por material (reporte PDF de Ventas, ópticas): ARMT / ARZL y
//     su subidentificador.

import (
	"regexp"
	"sort"
	"strings"
	"time"

	"attomos/config"
)

/* ---------- Citas de hoy ---------- */

type PosCitaHoy struct {
	ID         int64  `json:"id"`
	Hora       string `json:"hora"`
	Nombre     string `json:"nombre"`
	Celular    string `json:"celular"` // 10 dígitos
	Correo     string `json:"correo"`
	Nacimiento string `json:"nacimiento"`
	Status     string `json:"status"`
	Compro     bool   `json:"compro"`
	ClientID   int64  `json:"client_id,omitempty"` // cliente del Punto de venta con ese celular o nombre
}

func posDayBounds() (time.Time, time.Time) {
	now := time.Now().In(posLoc)
	from := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, posLoc)
	return from, from.AddDate(0, 0, 1)
}

// ListPosCitasHoy: las citas de hoy del negocio (sin las canceladas), por hora.
func ListPosCitasHoy(userID uint) ([]PosCitaHoy, error) {
	from, to := posDayBounds()
	var list []Appointment
	if err := config.DB.Where("user_id = ? AND date >= ? AND date < ? AND status <> ?", userID, from, to, AppointmentStatusCancelled).
		Order("date ASC, id ASC").Find(&list).Error; err != nil {
		return nil, err
	}
	out := make([]PosCitaHoy, 0, len(list))
	for _, a := range list {
		nac := a.ClientBirthDate
		if len(nac) > 10 {
			nac = nac[:10]
		}
		out = append(out, PosCitaHoy{
			ID: int64(a.ID), Hora: a.Date.In(posLoc).Format("15:04"),
			Nombre:  strings.Join(strings.Fields(a.ClientFirstName+" "+a.ClientLastName), " "),
			Celular: phoneTail(a.ClientPhone), Correo: strings.TrimSpace(a.ClientEmail), Nacimiento: nac,
			Status: string(a.Status), Compro: a.FollowupSet && a.Bought,
		})
	}
	for i := range out {
		out[i].ClientID = findPosClientFor(userID, out[i].Nombre, out[i].Celular)
	}
	return out, nil
}

// findPosClientFor: el cliente del Punto de venta con ese celular (o, si
// no, con el mismo nombre). 0 = no hay.
func findPosClientFor(userID uint, nombre, celular string) int64 {
	var id int64
	if cel := phoneTail(celular); len(cel) == 10 {
		if posDB().QueryRow(`SELECT id FROM pos_clients WHERE user_id = ? AND celular = ? ORDER BY id DESC LIMIT 1`, userID, cel).Scan(&id) == nil {
			return id
		}
	}
	want := NormalizePatientName(nombre)
	if want == "" {
		return 0
	}
	first := strings.Fields(want)[0]
	rows, err := posDB().Query(`SELECT id, nombre FROM pos_clients WHERE user_id = ? AND LOWER(nombre) LIKE ? ORDER BY id DESC`,
		userID, "%"+strings.NewReplacer(`\`, `\\`, "%", `\%`, "_", `\_`).Replace(first)+"%")
	if err != nil {
		return 0
	}
	defer rows.Close()
	for rows.Next() {
		var n string
		if rows.Scan(&id, &n) == nil && NormalizePatientName(n) == want {
			return id
		}
	}
	_ = rows.Err() // si falló a medias, simplemente no se encontró
	return 0
}

// MarkCitaCompro: la venta se liga a la cita de hoy del cliente y en Mis
// citas queda "Asistió · Compró" (revisión en 1 año, o la que ya tenía).
// citaID = la que se eligió en el Punto de venta; si es 0 se busca la cita
// de hoy con el celular o el nombre del cliente. Regresa el id de la cita
// (0 = no había).
func MarkCitaCompro(userID uint, saleID, citaID, clientID int64) int64 {
	if citaID <= 0 && clientID > 0 {
		var nombre, celular string
		if posDB().QueryRow(`SELECT nombre, celular FROM pos_clients WHERE id = ? AND user_id = ?`, clientID, userID).Scan(&nombre, &celular) != nil {
			return 0
		}
		citas, err := ListPosCitasHoy(userID)
		if err != nil {
			return 0
		}
		cel, want := phoneTail(celular), NormalizePatientName(nombre)
		for _, c := range citas {
			if c.Compro {
				continue
			}
			if (len(cel) == 10 && c.Celular == cel) || (want != "" && NormalizePatientName(c.Nombre) == want) {
				citaID = c.ID
				break
			}
		}
	}
	if citaID <= 0 {
		return 0
	}
	var a Appointment
	if err := config.DB.Where("id = ? AND user_id = ?", citaID, userID).First(&a).Error; err != nil {
		return 0
	}
	if a.Status == AppointmentStatusCancelled {
		return 0
	}
	meses := 12
	if a.RevisionMonths == 3 || a.RevisionMonths == 6 || a.RevisionMonths == 12 {
		meses = a.RevisionMonths
	}
	if err := config.DB.Model(&a).Updates(map[string]interface{}{
		"followup_set":    true,
		"bought":          true,
		"revision_months": meses,
		"status":          AppointmentStatusCompleted,
	}).Error; err != nil {
		return 0
	}
	if saleID > 0 {
		_, _ = posDB().Exec(`UPDATE pos_sales SET cita_id = ? WHERE id = ? AND user_id = ?`, citaID, saleID, userID)
	}
	return citaID
}

/* ---------- Perfil del cliente ---------- */

type PosPerfilVenta struct {
	Folio     int64   `json:"folio"`
	Fecha     string  `json:"fecha"`
	Total     float64 `json:"total"`
	Credito   float64 `json:"credito"`
	Productos string  `json:"productos"`
	Cancelada bool    `json:"cancelada"`
}

type PosPerfilExamen struct {
	ID    int64     `json:"id"`
	Fecha time.Time `json:"fecha"`
	Por   string    `json:"por"`
}

type PosPerfil struct {
	Cliente      *PosClient        `json:"cliente"`
	Ventas       []PosPerfilVenta  `json:"ventas"`
	TotalCompras float64           `json:"total_compras"`
	Optica       bool              `json:"optica"`
	Examenes     []PosPerfilExamen `json:"examenes"`
	PacienteKey  string            `json:"paciente_key"`
	Revision     string            `json:"revision"`       // "YYYY-MM-DD" de su próxima revisión ("" = sin exámenes)
	RevisionMes  int               `json:"revision_meses"` // cada cuánto
	Citas        int               `json:"citas"`
}

// GetPosPerfil: datos, compras y (ópticas) exámenes de la vista del cliente.
func GetPosPerfil(userID uint, clientID int64, optica bool) (*PosPerfil, error) {
	cl, err := GetPosClient(userID, clientID)
	if err != nil {
		return nil, err
	}
	p := &PosPerfil{Cliente: cl, Ventas: []PosPerfilVenta{}, Examenes: []PosPerfilExamen{}, Optica: optica}

	rows, err := posDB().Query(`SELECT s.folio, DATE_FORMAT(s.created_at, '%Y-%m-%dT%H:%i:%s'), s.total, s.credito,
			COALESCE(GROUP_CONCAT(CONCAT(i.cantidad, ' × ', i.descripcion) ORDER BY i.id SEPARATOR ' · '), ''), s.cancelada
		FROM pos_sales s LEFT JOIN pos_sale_items i ON i.sale_id = s.id
		WHERE s.user_id = ? AND s.client_id = ? GROUP BY s.id ORDER BY s.created_at DESC, s.id DESC LIMIT 200`, userID, clientID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var v PosPerfilVenta
		if err := rows.Scan(&v.Folio, &v.Fecha, &v.Total, &v.Credito, &v.Productos, &v.Cancelada); err != nil {
			rows.Close()
			return nil, err
		}
		if !v.Cancelada {
			p.TotalCompras += v.Total
		}
		p.Ventas = append(p.Ventas, v)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	p.TotalCompras = round2(p.TotalCompras)

	// Exámenes de la vista: el paciente del Historial clínico ligado a
	// este cliente, o con su mismo nombre, o con su celular.
	if optica {
		if exams, err := ListEyeExamsLite(userID); err == nil {
			cel, want := phoneTail(cl.Celular), NormalizePatientName(cl.Nombre)
			var best *PatientSummary
			for _, g := range groupPatients(userID, exams) {
				if g.UserID == clientID {
					best = g
					break
				}
				if want != "" && NormalizePatientName(g.Name) == want && (best == nil || best.UserID != clientID) {
					best = g
					continue
				}
				if best == nil && len(cel) == 10 && phoneTail(g.Phone) == cel {
					best = g
				}
			}
			if best != nil {
				applyRevisionMonths(userID, []*PatientSummary{best})
				p.PacienteKey = best.Key
				p.RevisionMes = best.RevisionMeses
				if !best.NextRevision.IsZero() {
					p.Revision = best.NextRevision.In(posLoc).Format("2006-01-02")
				}
				ids := map[int64]bool{}
				for _, id := range best.examIDs {
					ids[id] = true
				}
				for _, e := range exams {
					if ids[e.ID] {
						p.Examenes = append(p.Examenes, PosPerfilExamen{ID: e.ID, Fecha: e.CreatedAt, Por: e.CreatedByName})
					}
				}
			}
		}
	}

	if cel := phoneTail(cl.Celular); len(cel) == 10 {
		var n int64
		config.DB.Model(&Appointment{}).Where("user_id = ? AND client_phone LIKE ? AND status <> ?", userID, "%"+cel, AppointmentStatusCancelled).Count(&n)
		p.Citas = int(n)
	}
	return p, nil
}

/* ---------- Ventas por material (ópticas) ---------- */

type PosVentaMaterial struct {
	Identificador    string  `json:"identificador"`
	Subidentificador string  `json:"subidentificador"`
	Piezas           int     `json:"piezas"`
	Importe          float64 `json:"importe"`
	Ventas           int     `json:"ventas"` // tickets distintos
}

var posClaveIdentRe = regexp.MustCompile(`^(ARMT|ARZL)-`)

// ListPosVentasPorMaterial: piezas e importe por identificador (ARMT metal
// / ARZL pasta) y subidentificador del material del armazón. El material
// de cada artículo es el primero que tiene; si ya no está en la lista, el
// identificador sale de la clave. Lo que no tiene material no entra.
func ListPosVentasPorMaterial(userID uint, desde, hasta string) ([]PosVentaMaterial, error) {
	where := []string{"s.user_id = ?", "s.cancelada = 0", "i.materiales <> ''"}
	args := []interface{}{userID}
	if desde != "" {
		where = append(where, "s.created_at >= ?")
		args = append(args, desde)
	}
	if hasta != "" {
		where = append(where, "s.created_at < DATE_ADD(?, INTERVAL 1 DAY)")
		args = append(args, hasta)
	}
	rows, err := posDB().Query(`SELECT s.id, it.cantidad, it.importe, i.materiales, COALESCE(i.clave, it.clave, '')
		FROM pos_sale_items it
		JOIN pos_sales s ON s.id = it.sale_id
		JOIN inv_articulos i ON i.id = it.inventory_id AND i.user_id = s.user_id
		WHERE `+strings.Join(where, " AND "), args...)
	if err != nil {
		return nil, err
	}
	type line struct {
		sale    int64
		cant    int
		importe float64
		mat     string
		clave   string
	}
	var lines []line
	for rows.Next() {
		var l line
		var mats string
		if err := rows.Scan(&l.sale, &l.cant, &l.importe, &mats, &l.clave); err != nil {
			rows.Close()
			return nil, err
		}
		if ms := splitInvList(mats); len(ms) > 0 {
			l.mat = ms[0]
		}
		lines = append(lines, l)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	mats, _ := ListInvMaterials(userID)
	byName := map[string]InvMaterial{}
	for _, m := range mats {
		byName[strings.ToLower(m.Nombre)] = m
	}
	agg := map[string]*PosVentaMaterial{}
	tickets := map[string]map[int64]bool{}
	for _, l := range lines {
		if l.mat == "" {
			continue
		}
		m, ok := byName[strings.ToLower(l.mat)]
		ident, sub := m.Identificador, m.Subidentificador
		if !ok || ident == "" {
			if x := posClaveIdentRe.FindStringSubmatch(strings.ToUpper(l.clave)); x != nil {
				ident = x[1]
			}
		}
		if ident == "" {
			ident = "—"
		}
		if sub == "" {
			sub = "Sin subidentificador"
		}
		k := ident + "|" + sub
		if agg[k] == nil {
			agg[k] = &PosVentaMaterial{Identificador: ident, Subidentificador: sub}
			tickets[k] = map[int64]bool{}
		}
		agg[k].Piezas += l.cant
		agg[k].Importe += l.importe
		tickets[k][l.sale] = true
	}
	out := make([]PosVentaMaterial, 0, len(agg))
	for k, v := range agg {
		v.Importe = round2(v.Importe)
		v.Ventas = len(tickets[k])
		out = append(out, *v)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Piezas != out[j].Piezas {
			return out[i].Piezas > out[j].Piezas
		}
		return out[i].Importe > out[j].Importe
	})
	return out, nil
}
