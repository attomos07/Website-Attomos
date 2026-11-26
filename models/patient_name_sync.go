package models

// patient_name_sync.go — Optometría corrige el nombre del paciente (a
// veces en la cita solo se apunta un nombre y un apellido). Si el examen
// salió de una cita, el nombre nuevo también se pone en:
//   - la cita de la que salió el examen y las demás citas de esa misma
//     persona (mismo celular y mismo nombre de antes);
//   - el cliente del Punto de venta con ese celular y ese nombre de antes.
// Solo se toca lo que tiene el mismo celular Y el mismo nombre anterior,
// para no cambiarle el nombre a otro familiar que comparte el celular.
// (Portado de Avante; aquí todo va filtrado por el negocio.)

import (
	"strings"
	"unicode"

	"attomos/config"
)

// NameSyncPreview: lo que se cambiaría en Mis citas y en el Punto de venta.
type NameSyncPreview struct {
	Changes  bool   `json:"changes"`  // el nombre de la cita es distinto al del examen
	Old      string `json:"old"`      // nombre como está en la cita
	Nombre   string `json:"nombre"`   // sugerencia: nombre(s)
	Apellido string `json:"apellido"` // sugerencia: apellidos
	Citas    int    `json:"citas"`    // citas que cambian (incluye la de este examen)
	Clientes int    `json:"clientes"` // clientes del Punto de venta que cambian
}

func cleanName(s string) string { return strings.Join(strings.Fields(s), " ") }

var nameParticles = map[string]bool{"de": true, "del": true, "la": true, "las": true, "los": true, "y": true, "san": true, "santa": true, "van": true, "von": true, "mc": true}

// SplitFullName separa "Juan Carlos Pérez López" en nombre(s) y apellidos
// (los dos últimos; "de la Cruz" cuenta como uno). Con dos palabras: una
// y una. Es solo la sugerencia: se corrige en el aviso si no quedó bien.
func SplitFullName(full string) (nombre, apellido string) {
	w := strings.Fields(cleanName(full))
	if len(w) <= 1 {
		return strings.Join(w, " "), ""
	}
	start := len(w)
	for units := 0; units < 2 && start > 1; units++ {
		i := start - 1
		for i > 1 && nameParticles[strings.ToLower(w[i-1])] {
			i--
		}
		start = i
	}
	return strings.Join(w[:start], " "), strings.Join(w[start:], " ")
}

// titleIfShouting: "JUAN PÉREZ" → "Juan Pérez"; si ya trae minúsculas se
// deja como lo escribieron.
func titleIfShouting(s string) string {
	if s != strings.ToUpper(s) {
		return s
	}
	out := []rune(strings.ToLower(s))
	up := true
	for i, r := range out {
		if up && unicode.IsLetter(r) {
			out[i] = unicode.ToUpper(r)
		}
		up = r == ' ' || r == '-'
	}
	res := " " + string(out) + " "
	for p := range nameParticles {
		t := strings.ToUpper(p[:1]) + p[1:]
		res = strings.ReplaceAll(res, " "+t+" ", " "+p+" ")
	}
	res = strings.TrimSpace(res)
	if res != "" {
		r := []rune(res)
		r[0] = unicode.ToUpper(r[0])
		res = string(r)
	}
	return res
}

func nameSyncAppt(userID uint, apptID int64) (*Appointment, error) {
	if apptID <= 0 {
		return nil, nil
	}
	var a Appointment
	if err := config.DB.Where("id = ? AND user_id = ?", apptID, userID).First(&a).Error; err != nil {
		return nil, err
	}
	return &a, nil
}

// PreviewNameSync dice qué cambiaría si el examen de la cita apptID queda
// con el nombre full.
func PreviewNameSync(userID uint, apptID int64, full string) (*NameSyncPreview, error) {
	a, err := nameSyncAppt(userID, apptID)
	if err != nil || a == nil {
		return &NameSyncPreview{}, nil
	}
	full = cleanName(full)
	old := cleanName(a.ClientFirstName + " " + a.ClientLastName)
	nom, ape := SplitFullName(titleIfShouting(full))
	p := &NameSyncPreview{Old: old, Nombre: nom, Apellido: ape}
	// Mismo texto (aunque cambien mayúsculas) = nada que cambiar.
	if full == "" || strings.EqualFold(full, old) {
		return p, nil
	}
	p.Changes = true
	p.Citas = len(sameNameAppts(userID, a, old))
	p.Clientes = len(sameNameClients(userID, a.ClientPhone, old))
	return p, nil
}

// sameNameAppts: la cita y las demás de esa persona (mismo celular y mismo
// nombre de antes).
func sameNameAppts(userID uint, a *Appointment, old string) []uint {
	ids := []uint{a.ID}
	cel := phoneTail(a.ClientPhone)
	if len(cel) < 10 || old == "" {
		return ids
	}
	var list []Appointment
	config.DB.Select("id, client_first_name, client_last_name, client_phone").
		Where("user_id = ? AND id <> ? AND client_phone LIKE ?", userID, a.ID, "%"+cel).Find(&list)
	for _, x := range list {
		if phoneTail(x.ClientPhone) == cel && cleanName(x.ClientFirstName+" "+x.ClientLastName) == old {
			ids = append(ids, x.ID)
		}
	}
	return ids
}

type nameSyncClient struct {
	id     int64
	nombre string
}

func sameNameClients(userID uint, phone, old string) []nameSyncClient {
	cel := phoneTail(phone)
	if len(cel) < 10 || old == "" {
		return nil
	}
	rows, err := posDB().Query(`SELECT id, nombre FROM pos_clients WHERE user_id = ? AND RIGHT(celular, 10) = ?`, userID, cel)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []nameSyncClient
	for rows.Next() {
		var x nameSyncClient
		if rows.Scan(&x.id, &x.nombre) == nil && strings.EqualFold(cleanName(x.nombre), old) {
			out = append(out, x)
		}
	}
	if rows.Err() != nil {
		return nil
	}
	return out
}

// ApplyNameSync pone nombre/apellido en la cita apptID y en lo demás de esa
// misma persona (ver arriba). Regresa cuántas citas y clientes cambió.
func ApplyNameSync(userID uint, apptID int64, nombre, apellido string) (citas, clientes int, err error) {
	nombre, apellido = cleanName(nombre), cleanName(apellido)
	if nombre == "" {
		return 0, 0, nil
	}
	if len([]rune(nombre)) > 120 {
		nombre = string([]rune(nombre)[:120])
	}
	if len([]rune(apellido)) > 120 {
		apellido = string([]rune(apellido)[:120])
	}
	a, err := nameSyncAppt(userID, apptID)
	if err != nil || a == nil {
		return 0, 0, err
	}
	old := cleanName(a.ClientFirstName + " " + a.ClientLastName)
	full := cleanName(nombre + " " + apellido)
	if old == full && cleanName(a.ClientFirstName) == nombre {
		return 0, 0, nil
	}
	ids := sameNameAppts(userID, a, old)
	res := config.DB.Model(&Appointment{}).Where("user_id = ? AND id IN ?", userID, ids).
		Updates(map[string]interface{}{"client_first_name": nombre, "client_last_name": apellido})
	if res.Error != nil {
		return 0, 0, res.Error
	}
	citas = int(res.RowsAffected)

	for _, x := range sameNameClients(userID, a.ClientPhone, old) {
		v := full
		if x.nombre == strings.ToUpper(x.nombre) { // el Punto de venta lo tenía en mayúsculas
			v = strings.ToUpper(full)
		}
		if _, err := posDB().Exec(`UPDATE pos_clients SET nombre = ? WHERE id = ? AND user_id = ?`, v, x.id, userID); err == nil {
			clientes++
		}
	}
	return citas, clientes, nil
}
