package foundation

import (
	"net/http"
	"regexp"
	"sort"
	"strings"
	"unicode"

	"attomos/config"
	"attomos/models"

	"github.com/gin-gonic/gin"
	"golang.org/x/text/unicode/norm"
)

// =============================================================================
// ATTOMOS FOUNDATION — datos para transferencias y catálogo de ciudades
//
// Transferencias: la rescatista publica sus cuentas (banco, Pago Móvil, Zelle,
// PayPal, Binance, Zinli u otro). El donador copia los datos y paga directo;
// Attomos no procesa ese dinero.
//
// Ciudades: el dropdown se alimenta solo con las ciudades que ya registraron
// otras rescatistas, más una lista base por país.
// =============================================================================

const foundationMaxPayout = 10

var foundationPayoutKinds = map[string]bool{
	"bank": true, "pago_movil": true, "zelle": true, "paypal": true, "binance": true, "zinli": true, "other": true,
}

var foundationAccountTypes = map[string]bool{"ahorros": true, "corriente": true, "clabe": true, "tarjeta": true, "otra": true}

var (
	foundationDigitsRe  = regexp.MustCompile(`^[0-9][0-9 \-]{4,38}[0-9]$`)
	foundationBankCode  = regexp.MustCompile(`^[0-9]{4}$`)
	foundationPhoneRe   = regexp.MustCompile(`^\+?[0-9 \-]{7,20}$`)
	foundationHolderIDs = regexp.MustCompile(`^[A-Za-z0-9 .\-]{3,40}$`)
)

func foundationPayoutJSON(m *models.FoundationPayoutMethod) gin.H {
	return gin.H{
		"id":            idStr(m.ID),
		"kind":          m.Kind,
		"country":       m.Country,
		"bankName":      m.BankName,
		"bankCode":      m.BankCode,
		"accountType":   m.AccountType,
		"accountNumber": m.AccountNumber,
		"holderName":    m.HolderName,
		"holderId":      m.HolderID,
		"phone":         m.Phone,
		"handle":        m.Handle,
		"note":          m.Note,
	}
}

type foundationPayoutReq struct {
	Kind          string `json:"kind"`
	Country       string `json:"country"`
	BankName      string `json:"bankName"`
	BankCode      string `json:"bankCode"`
	AccountType   string `json:"accountType"`
	AccountNumber string `json:"accountNumber"`
	HolderName    string `json:"holderName"`
	HolderID      string `json:"holderId"`
	Phone         string `json:"phone"`
	Handle        string `json:"handle"`
	Note          string `json:"note"`
}

// validate limpia y valida según el tipo. Devuelve (mensaje, campo).
func (q *foundationPayoutReq) validate() (string, string) {
	t := strings.TrimSpace
	q.Kind, q.Country, q.BankName, q.BankCode = t(q.Kind), t(q.Country), t(q.BankName), t(q.BankCode)
	q.AccountType, q.AccountNumber, q.HolderName, q.HolderID = t(q.AccountType), t(q.AccountNumber), t(q.HolderName), t(q.HolderID)
	q.Phone, q.Handle, q.Note = t(q.Phone), t(q.Handle), t(q.Note)

	if !foundationPayoutKinds[q.Kind] {
		return "Elige el tipo de método", "kind"
	}
	if runeLen(q.Country) > 40 || runeLen(q.BankName) > 80 || runeLen(q.HolderName) > 120 || runeLen(q.Handle) > 160 || runeLen(q.Note) > 300 {
		return "Algún dato es demasiado largo", ""
	}
	if q.HolderID != "" && !foundationHolderIDs.MatchString(q.HolderID) {
		return "Revisa el documento del titular", "holderId"
	}
	switch q.Kind {
	case "bank":
		if runeLen(q.BankName) < 2 {
			return "Escribe el nombre del banco", "bankName"
		}
		if !foundationAccountTypes[q.AccountType] {
			q.AccountType = "ahorros"
		}
		if !foundationDigitsRe.MatchString(q.AccountNumber) {
			return "Escribe un número de cuenta válido (solo números)", "accountNumber"
		}
		if q.AccountType == "clabe" && len(strings.NewReplacer(" ", "", "-", "").Replace(q.AccountNumber)) != 18 {
			return "La CLABE debe tener 18 dígitos", "accountNumber"
		}
		if runeLen(q.HolderName) < 3 {
			return "Escribe el nombre del titular", "holderName"
		}
		q.BankCode, q.Phone, q.Handle = "", "", ""
	case "pago_movil":
		if !foundationBankCode.MatchString(q.BankCode) {
			return "Elige el banco", "bankCode"
		}
		if !foundationPhoneRe.MatchString(q.Phone) {
			return "Escribe el teléfono del Pago Móvil", "phone"
		}
		if q.HolderID == "" {
			return "Escribe la cédula del titular", "holderId"
		}
		q.Country, q.AccountType, q.AccountNumber, q.Handle = "Venezuela", "", "", ""
	case "zelle", "zinli", "paypal", "binance":
		if runeLen(q.Handle) < 3 {
			msg := map[string]string{
				"zelle":   "Escribe el correo o teléfono de Zelle",
				"zinli":   "Escribe el correo o teléfono de Zinli",
				"paypal":  "Escribe tu correo de PayPal o tu enlace paypal.me",
				"binance": "Escribe tu Binance Pay ID o tu correo",
			}[q.Kind]
			return msg, "handle"
		}
		q.BankName, q.BankCode, q.AccountType, q.AccountNumber, q.Phone = "", "", "", "", ""
	case "other":
		if runeLen(q.BankName) < 2 {
			return "Escribe el nombre del método", "bankName"
		}
		if runeLen(q.Note) < 3 {
			return "Escribe los datos para recibir el pago", "note"
		}
	}
	return "", ""
}

func (q *foundationPayoutReq) apply(m *models.FoundationPayoutMethod) {
	m.Kind, m.Country, m.BankName, m.BankCode = q.Kind, q.Country, q.BankName, q.BankCode
	m.AccountType, m.AccountNumber, m.HolderName, m.HolderID = q.AccountType, q.AccountNumber, q.HolderName, q.HolderID
	m.Phone, m.Handle, m.Note = q.Phone, q.Handle, q.Note
}

func foundationPayoutResponse(c *gin.Context, r *models.FoundationRescuer) {
	foundationLoadRescuer(config.DB).First(r, r.ID)
	c.JSON(http.StatusOK, gin.H{"rescuer": foundationRescuerJSON(r, true)})
}

// POST /api/foundation/payout-methods
func FoundationCreatePayout(c *gin.Context) {
	r := foundationRescuerFromCtx(c)
	var q foundationPayoutReq
	if err := c.ShouldBindJSON(&q); err != nil {
		badReq(c, "Datos inválidos", "")
		return
	}
	if msg, field := q.validate(); msg != "" {
		badReq(c, msg, field)
		return
	}
	var count int64
	config.DB.Model(&models.FoundationPayoutMethod{}).Where("rescuer_id = ?", r.ID).Count(&count)
	if count >= foundationMaxPayout {
		badReq(c, "Máximo 10 métodos de transferencia", "")
		return
	}
	m := models.FoundationPayoutMethod{RescuerID: r.ID, SortOrder: int(count)}
	q.apply(&m)
	if err := config.DB.Create(&m).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "No se pudo guardar"})
		return
	}
	foundationPayoutResponse(c, r)
}

// PUT /api/foundation/payout-methods/:id
func FoundationUpdatePayout(c *gin.Context) {
	r := foundationRescuerFromCtx(c)
	var m models.FoundationPayoutMethod
	if err := config.DB.Where("id = ? AND rescuer_id = ?", c.Param("id"), r.ID).First(&m).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "No encontramos ese método"})
		return
	}
	var q foundationPayoutReq
	if err := c.ShouldBindJSON(&q); err != nil {
		badReq(c, "Datos inválidos", "")
		return
	}
	if msg, field := q.validate(); msg != "" {
		badReq(c, msg, field)
		return
	}
	q.apply(&m)
	if err := config.DB.Save(&m).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "No se pudo guardar"})
		return
	}
	foundationPayoutResponse(c, r)
}

// DELETE /api/foundation/payout-methods/:id
func FoundationDeletePayout(c *gin.Context) {
	r := foundationRescuerFromCtx(c)
	res := config.DB.Where("id = ? AND rescuer_id = ?", c.Param("id"), r.ID).Delete(&models.FoundationPayoutMethod{})
	if res.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "No encontramos ese método"})
		return
	}
	foundationPayoutResponse(c, r)
}

// ─── Ciudades ────────────────────────────────────────────────────────────────

// Lista base: se completa sola con las ciudades que registran las rescatistas.
var foundationSeedCities = map[string][]string{
	"México": {"Ciudad de México", "Guadalajara", "Monterrey", "Puebla", "Tijuana", "León", "Mérida", "Hermosillo",
		"Querétaro", "Chihuahua", "Culiacán", "Toluca", "Cancún", "Aguascalientes", "Morelia", "Saltillo", "Mexicali",
		"San Luis Potosí", "Veracruz", "Oaxaca", "Ciudad Obregón", "Torreón", "Mazatlán", "Acapulco", "Tuxtla Gutiérrez"},
	"Venezuela": {"Caracas", "Maracaibo", "Valencia", "Barquisimeto", "Maracay", "Ciudad Guayana", "Barcelona",
		"Maturín", "Mérida", "San Cristóbal", "Cumaná", "Puerto La Cruz", "Barinas", "Los Teques", "Punto Fijo"},
	"Ecuador": {"Quito", "Guayaquil", "Cuenca", "Santo Domingo", "Machala", "Manta", "Portoviejo", "Ambato", "Loja",
		"Riobamba", "Ibarra", "Esmeraldas", "Quevedo", "Latacunga", "Milagro"},
}

// foundationCityKey clave para comparar sin acentos, mayúsculas ni espacios extra.
func foundationCityKey(s string) string {
	t := norm.NFD.String(strings.ToLower(strings.TrimSpace(s)))
	var b strings.Builder
	space := false
	for _, r := range t {
		if unicode.Is(unicode.Mn, r) {
			continue
		}
		if unicode.IsSpace(r) {
			if !space {
				b.WriteRune(' ')
			}
			space = true
			continue
		}
		space = false
		b.WriteRune(r)
	}
	return b.String()
}

// foundationTidyCity limpia espacios y pone mayúscula inicial si viene todo
// en minúsculas o mayúsculas ("hermosillo" → "Hermosillo").
func foundationTidyCity(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	if s == "" || (s != strings.ToLower(s) && s != strings.ToUpper(s)) {
		return s
	}
	small := map[string]bool{"de": true, "del": true, "la": true, "las": true, "los": true, "y": true, "el": true}
	words := strings.Split(strings.ToLower(s), " ")
	for i, w := range words {
		if i > 0 && small[w] {
			continue
		}
		rs := []rune(w)
		if len(rs) > 0 {
			rs[0] = unicode.ToUpper(rs[0])
		}
		words[i] = string(rs)
	}
	return strings.Join(words, " ")
}

// foundationCitiesFor ciudades conocidas del país: registradas (más usadas
// primero) + base. Sin duplicados por acentos/mayúsculas.
func foundationCitiesFor(country string) []string {
	type row struct {
		City string
		N    int
	}
	var rows []row
	config.DB.Model(&models.FoundationRescuer{}).
		Select("city, COUNT(*) AS n").
		Where("country = ? AND city <> ''", country).
		Group("city").Order("n DESC").Limit(500).Scan(&rows)
	seen := map[string]bool{}
	out := []string{}
	add := func(c string) {
		k := foundationCityKey(c)
		if k == "" || seen[k] {
			return
		}
		seen[k] = true
		out = append(out, c)
	}
	for _, r := range rows {
		add(r.City)
	}
	base := append([]string{}, foundationSeedCities[country]...)
	sort.Strings(base)
	for _, c := range base {
		add(c)
	}
	return out
}

// foundationCanonicalCity usa la ortografía ya registrada si existe.
func foundationCanonicalCity(country, city string) string {
	city = foundationTidyCity(city)
	if city == "" {
		return ""
	}
	k := foundationCityKey(city)
	for _, c := range foundationCitiesFor(country) {
		if foundationCityKey(c) == k {
			return c
		}
	}
	return city
}

// GET /api/foundation/cities?country=México
func FoundationCities(c *gin.Context) {
	country := c.Query("country")
	if !foundationCountries[country] {
		country = "México"
	}
	c.Header("Cache-Control", "public, max-age=300")
	c.JSON(http.StatusOK, gin.H{"country": country, "cities": foundationCitiesFor(country)})
}
