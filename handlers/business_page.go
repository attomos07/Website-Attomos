package handlers

// business_page.go — Página pública del negocio y cuentas de sus clientes.
//
// Con lo que el negocio llenó en Mi Negocio se arma su página:
// attomos.com/n/<slug> (logo, portada, descripción, servicios, horario,
// días cerrados, ubicación con mapa, contacto, redes y su equipo), con una
// barra de navegación propia del negocio. Desde ahí sus clientes agendan,
// crean su cuenta (como en Avante) y en "Mis citas" ven, reagendan o
// cancelan su cita sin llamar.
//
//	GET  /n/:slug                    página del negocio
//	GET  /n/:slug/agendar            agendar (la misma de /agendar/:id)
//	GET  /n/:slug/entrar             iniciar sesión (cliente)
//	GET  /n/:slug/registro           crear cuenta (cliente)
//	GET  /n/:slug/mis-citas          mis citas (pide sesión)
//	POST /api/n/:slug/registro       {nombre, apellido, correo, celular, fechaNacimiento, password, reclamos[]}
//	POST /api/n/:slug/entrar         {correo, password, reclamos[]}
//	POST /api/n/:slug/salir
//	GET  /api/n/:slug/yo
//	GET  /api/n/:slug/mis-citas
//	POST /api/n/:slug/mis-citas/:id/cancelar   {motivo}
//	POST /api/n/:slug/mis-citas/:id/reagendar  {date, time}
//
// La sesión del cliente es una cookie firmada por negocio (att_cli_<id>):
// no se mezcla con la del panel (auth_token) ni con la de otros negocios.

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"html/template"
	"log"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"attomos/config"
	"attomos/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const customerSessionDays = 60

/* ---------------- sesión del cliente ---------------- */

func customerSecret() []byte {
	s := os.Getenv("JWT_SECRET")
	if s == "" {
		s = "attomos-clientes"
	}
	return []byte("cliente:" + s)
}

func customerSign(parts ...string) string {
	m := hmac.New(sha256.New, customerSecret())
	m.Write([]byte(strings.Join(parts, ".")))
	return hex.EncodeToString(m.Sum(nil))[:40]
}

func customerCookieName(owner uint) string { return "att_cli_" + strconv.FormatUint(uint64(owner), 10) }

func customerSetSession(c *gin.Context, owner, cid uint) {
	exp := strconv.FormatInt(time.Now().Add(customerSessionDays*24*time.Hour).Unix(), 10)
	id := strconv.FormatUint(uint64(cid), 10)
	val := id + "." + exp + "." + customerSign(strconv.FormatUint(uint64(owner), 10), id, exp)
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(customerCookieName(owner), val, customerSessionDays*86400, "/", "", c.Request.TLS != nil || strings.EqualFold(c.GetHeader("X-Forwarded-Proto"), "https"), true)
}

func customerClearSession(c *gin.Context, owner uint) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(customerCookieName(owner), "", -1, "/", "", false, true)
}

// customerFromCookie — el cliente con sesión en ESTE negocio (nil si no hay).
func customerFromCookie(c *gin.Context, owner uint) *models.Customer {
	raw, err := c.Cookie(customerCookieName(owner))
	if err != nil || raw == "" {
		return nil
	}
	p := strings.Split(raw, ".")
	if len(p) != 3 || !hmac.Equal([]byte(p[2]), []byte(customerSign(strconv.FormatUint(uint64(owner), 10), p[0], p[1]))) {
		return nil
	}
	exp, _ := strconv.ParseInt(p[1], 10, 64)
	if time.Now().Unix() > exp {
		return nil
	}
	id, _ := strconv.ParseUint(p[0], 10, 64)
	cu, err := models.GetCustomer(owner, uint(id))
	if err != nil {
		return nil
	}
	return cu
}

// Reclamo: al agendar como invitado se entrega una firma de la cita; si
// luego crea su cuenta o entra, esa cita pasa a su cuenta.
func bookingClaimToken(owner, apptID uint) string {
	return strconv.FormatUint(uint64(apptID), 10) + "." + customerSign("reclamo", strconv.FormatUint(uint64(owner), 10), strconv.FormatUint(uint64(apptID), 10))
}

func customerClaim(owner, cid uint, tokens []string) {
	for i, t := range tokens {
		if i >= 10 {
			break
		}
		p := strings.SplitN(t, ".", 2)
		if len(p) != 2 {
			continue
		}
		id, err := strconv.ParseUint(p[0], 10, 64)
		if err != nil || !hmac.Equal([]byte(t), []byte(bookingClaimToken(owner, uint(id)))) {
			continue
		}
		config.DB.Model(&models.Appointment{}).
			Where("id = ? AND user_id = ? AND customer_id = 0", id, owner).
			UpdateColumn("customer_id", cid)
	}
}

/* ---------------- negocio por slug ---------------- */

type negocioCtx struct {
	Owner  *models.User
	Branch *models.MyBusinessInfo
	Slug   string
	Nombre string
}

func negocioBySlug(c *gin.Context) *negocioCtx {
	owner := models.OwnerBySlug(c.Param("slug"))
	if owner == 0 {
		return nil
	}
	var u models.User
	if err := config.DB.Select("id, company, business_type").First(&u, owner).Error; err != nil {
		return nil
	}
	return &negocioCtx{Owner: &u, Branch: bookingBranch(owner), Slug: strings.ToLower(c.Param("slug")), Nombre: invBusinessName(owner)}
}

// negocioNav — datos de la barra de navegación del negocio.
func negocioNav(n *negocioCtx, cu *models.Customer, active string) gin.H {
	nav := gin.H{"Slug": n.Slug, "Nombre": n.Nombre, "Active": active, "Inicial": negocioInitial(n.Nombre)}
	if n.Branch != nil {
		nav["Logo"] = n.Branch.LogoURL
	}
	if cu != nil {
		nav["Cliente"] = strings.Fields(cu.Nombre + " x")[0]
	}
	return nav
}

func negocioInitial(s string) string {
	for _, r := range strings.TrimSpace(s) {
		return strings.ToUpper(string(r))
	}
	return "·"
}

func negocioNotFound(c *gin.Context) {
	c.HTML(http.StatusNotFound, "negocio.html", gin.H{"NotFound": true})
}

/* ---------------- página del negocio ---------------- */

var negocioTypeLabels = map[string]string{
	"optica": "Óptica", "clinica-dental": "Clínica dental", "peluqueria": "Peluquería y estética", "automotriz": "Automotriz",
	"pizzeria": "Pizzería", "libreria": "Librería", "restaurante": "Restaurante", "panaderia": "Panadería y repostería",
	"ensaladas": "Ensaladas", "gorditas": "Gorditas", "mariscos": "Mariscos",
}

var (
	negDias     = []string{"Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"}
	negMeses    = []string{"enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"}
	negDigits   = regexp.MustCompile(`\D`)
	negDaysKeys = map[string]int{"domingo": 0, "lunes": 1, "martes": 2, "miercoles": 3, "miércoles": 3, "jueves": 4, "viernes": 5, "sabado": 6, "sábado": 6,
		"sunday": 0, "monday": 1, "tuesday": 2, "wednesday": 3, "thursday": 4, "friday": 5, "saturday": 6}
)

func neg12h(hm string) string {
	t, err := time.Parse("15:04", hm)
	if err != nil {
		return hm
	}
	h := t.Hour() % 12
	if h == 0 {
		h = 12
	}
	suf := "am"
	if t.Hour() >= 12 {
		suf = "pm"
	}
	if t.Minute() == 0 {
		return fmt.Sprintf("%d %s", h, suf)
	}
	return fmt.Sprintf("%d:%02d %s", h, t.Minute(), suf)
}

func negMoney(v float64) string {
	if v == float64(int64(v)) {
		s := strconv.FormatInt(int64(v), 10)
		for i := len(s) - 3; i > 0; i -= 3 {
			s = s[:i] + "," + s[i:]
		}
		return "$" + s
	}
	return "$" + strconv.FormatFloat(v, 'f', 2, 64)
}

func negURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if !strings.HasPrefix(raw, "http://") && !strings.HasPrefix(raw, "https://") {
		raw = "https://" + raw
	}
	if u, err := url.Parse(raw); err != nil || u.Host == "" {
		return ""
	}
	return raw
}

// negSocial — usuario o liga de una red → liga completa.
func negSocial(raw, base string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if strings.Contains(raw, ".") && (strings.Contains(raw, "/") || strings.HasPrefix(raw, "www")) {
		return negURL(raw)
	}
	return base + strings.TrimPrefix(raw, "@")
}

func negAddress(b *models.MyBusinessInfo) (string, string) {
	if b == nil {
		return "", ""
	}
	l := b.Location
	line1 := strings.TrimSpace(l.Address + " " + l.Number)
	parts := []string{}
	for _, p := range []string{line1, l.Neighborhood, strings.TrimSpace(l.PostalCode + " " + l.City), l.State} {
		if p = strings.TrimSpace(p); p != "" {
			parts = append(parts, p)
		}
	}
	full := strings.Join(parts, ", ")
	between := ""
	if s := strings.TrimSpace(l.BetweenStreets); s != "" {
		between = "Entre " + s
	}
	return full, between
}

// Los textos van en español; los campos crudos (PromoKind, Dow, Start…)
// los usa negocio-i18n.js para mostrarlos en el idioma del visitante.
type negService struct {
	Titulo, Descripcion, Imagen, Precio, Antes, Promo string
	PromoKind, PromoEnd, PromoDows                    string // days | until | promo
	Agotado                                           bool
}

type negDay struct {
	Dia, Horas string
	Dow        int
	Start, End string
	Hoy        bool
	Cerrado    bool
}

// NegocioPage — GET /n/:slug
func NegocioPage(c *gin.Context) {
	n := negocioBySlug(c)
	if n == nil {
		negocioNotFound(c)
		return
	}
	b := n.Branch
	cu := customerFromCookie(c, n.Owner.ID)
	data := gin.H{"Nav": negocioNav(n, cu, "inicio"), "Nombre": n.Nombre, "OwnerID": n.Owner.ID}

	tipo := n.Owner.BusinessType
	if b != nil && b.BusinessType != "" {
		tipo = b.BusinessType
	}
	if l, ok := negocioTypeLabels[strings.ToLower(tipo)]; ok {
		data["Tipo"] = l
		data["TipoKey"] = strings.ToLower(tipo)
	} else if tipo != "" {
		data["Tipo"] = strings.ToUpper(tipo[:1]) + strings.ReplaceAll(tipo[1:], "-", " ")
	}
	if b == nil {
		c.HTML(http.StatusOK, "negocio.html", data)
		return
	}
	data["Logo"] = b.LogoURL
	data["Banner"] = b.BannerURL
	data["Menu"] = negURL(b.MenuURL)
	if strings.HasPrefix(b.MenuURL, "/") {
		data["Menu"] = b.MenuURL
	}
	data["Descripcion"] = strings.TrimSpace(b.Description)

	// Contacto
	if tel := negDigits.ReplaceAllString(b.PhoneNumber, ""); len(tel) >= 10 {
		local := tel[len(tel)-10:]
		data["Telefono"] = local[:3] + " " + local[3:6] + " " + local[6:]
		data["TelLink"] = template.URL("tel:+52" + local)
		data["WhatsApp"] = "https://wa.me/52" + local + "?text=" + url.QueryEscape("¡Hola "+n.Nombre+"! Vi su página y quiero información.")
	}
	data["Correo"] = strings.TrimSpace(b.Email)
	if w := negURL(b.Website); w != "" {
		data["Web"] = w
		data["WebLabel"] = strings.TrimSuffix(strings.TrimPrefix(strings.TrimPrefix(w, "https://"), "http://"), "/")
	}
	redes := []gin.H{}
	for _, r := range []struct{ key, label, val, base string }{
		{"facebook", "Facebook", b.SocialMedia.Facebook, "https://facebook.com/"},
		{"instagram", "Instagram", b.SocialMedia.Instagram, "https://instagram.com/"},
		{"x", "X", b.SocialMedia.Twitter, "https://x.com/"},
		{"linkedin", "LinkedIn", b.SocialMedia.LinkedIn, "https://linkedin.com/company/"},
	} {
		if u := negSocial(r.val, r.base); u != "" {
			redes = append(redes, gin.H{"Key": r.key, "Label": r.label, "URL": u})
		}
	}
	data["Redes"] = redes

	// Ubicación
	dir, entre := negAddress(b)
	data["Direccion"], data["Entre"] = dir, entre
	data["EntreCalles"] = strings.TrimSpace(b.Location.BetweenStreets)
	if dir != "" {
		q := url.QueryEscape(n.Nombre + ", " + dir)
		data["MapaEmbed"] = template.URL("https://www.google.com/maps?q=" + q + "&output=embed")
		data["MapaLink"] = "https://www.google.com/maps/search/?api=1&query=" + q
	}

	// Servicios
	servs := []negService{}
	for _, s := range b.Services {
		if strings.TrimSpace(s.Title) == "" {
			continue
		}
		sv := negService{Titulo: s.Title, Descripcion: strings.TrimSpace(s.Description), Agotado: (s.StockQty != nil && *s.StockQty <= 0) || (!s.InStock && s.StockQty != nil)}
		if len(s.ImageUrls) > 0 {
			sv.Imagen = s.ImageUrls[0]
		} else {
			sv.Imagen = s.ImageURL
		}
		if s.PriceType == "promo" && s.PromoPrice > 0 {
			sv.Precio = negMoney(s.PromoPrice)
			if s.OriginalPrice > s.PromoPrice {
				sv.Antes = negMoney(s.OriginalPrice)
			}
			sv.Promo, sv.PromoKind = "Promoción", "promo"
			switch {
			case s.PromoPeriodType == "days" && len(s.PromoDays) > 0:
				sv.Promo, sv.PromoKind = "Promo los "+strings.Join(s.PromoDays, ", "), "days"
				dows := []string{}
				for _, d := range s.PromoDays {
					if i, ok := negDaysKeys[strings.ToLower(strings.TrimSpace(d))]; ok {
						dows = append(dows, strconv.Itoa(i))
					}
				}
				sv.PromoDows = strings.Join(dows, ",")
			case s.PromoPeriodType == "range" && s.PromoDateEnd != "":
				if t, err := time.Parse("2006-01-02", s.PromoDateEnd); err == nil {
					sv.Promo = fmt.Sprintf("Promo hasta el %d de %s", t.Day(), negMeses[t.Month()-1])
					sv.PromoKind, sv.PromoEnd = "until", s.PromoDateEnd
				}
			}
		} else if s.Price > 0 {
			sv.Precio = negMoney(s.Price)
		}
		servs = append(servs, sv)
	}
	data["Servicios"] = servs

	// Horario (lunes a domingo) y si está abierto ahora
	now := time.Now().In(time.Local)
	s := b.Schedule
	week := []models.DaySchedule{s.Sunday, s.Monday, s.Tuesday, s.Wednesday, s.Thursday, s.Friday, s.Saturday}
	dias := []negDay{}
	anyOpen := false
	for _, i := range []int{1, 2, 3, 4, 5, 6, 0} {
		d := week[i]
		row := negDay{Dia: negDias[i], Dow: i, Hoy: i == int(now.Weekday())}
		if d.Open && citaHHMM.MatchString(d.Start) && citaHHMM.MatchString(d.End) {
			row.Horas = neg12h(d.Start) + " – " + neg12h(d.End)
			row.Start, row.End = d.Start, d.End
			anyOpen = true
		} else {
			row.Horas, row.Cerrado = "Cerrado", true
		}
		dias = append(dias, row)
	}
	if anyOpen {
		data["Horario"] = dias
		today := week[now.Weekday()]
		hm := now.Format("15:04")
		closedToday := bookingIsClosed(b, now.Format("2006-01-02"))
		switch {
		case closedToday:
			data["Estado"], data["Abierto"], data["EstadoKind"] = "Hoy cerramos", false, "closed_today"
		case today.Open && hm >= today.Start && hm < today.End:
			data["Estado"], data["Abierto"] = "Abierto · cierra a las "+neg12h(today.End), true
			data["EstadoKind"], data["EstadoTime"] = "open_until", today.End
		case today.Open && hm < today.Start:
			data["Estado"], data["Abierto"] = "Cerrado · abre hoy a las "+neg12h(today.Start), false
			data["EstadoKind"], data["EstadoTime"] = "opens_today", today.Start
		default:
			for k := 1; k <= 7; k++ {
				nd := now.AddDate(0, 0, k)
				if d := week[nd.Weekday()]; d.Open && citaHHMM.MatchString(d.Start) && !bookingIsClosed(b, nd.Format("2006-01-02")) {
					when, kind := "el "+strings.ToLower(negDias[nd.Weekday()]), "opens_day"
					if k == 1 {
						when, kind = "mañana", "opens_tomorrow"
					}
					data["Estado"] = "Cerrado · abre " + when + " a las " + neg12h(d.Start)
					data["EstadoKind"], data["EstadoTime"], data["EstadoDow"] = kind, d.Start, int(nd.Weekday())
					break
				}
			}
			data["Abierto"] = false
		}
	}
	cerr := []gin.H{}
	for i, d := range bookingClosedDays(b) {
		if i >= 6 {
			break
		}
		t, _ := time.ParseInLocation("2006-01-02", d.Fecha, time.Local)
		cerr = append(cerr, gin.H{"Fecha": fmt.Sprintf("%s %d de %s", strings.ToLower(negDias[t.Weekday()]), t.Day(), negMeses[t.Month()-1]), "ISO": d.Fecha, "Motivo": d.Motivo})
	}
	data["Cerrados"] = cerr

	// Equipo
	equipo := []gin.H{}
	for _, w := range b.Workers {
		if strings.TrimSpace(w.Name) == "" {
			continue
		}
		dias, dows := []string{}, []string{}
		for _, d := range w.Days {
			if i, ok := negDaysKeys[strings.ToLower(strings.TrimSpace(d))]; ok {
				dias = append(dias, string([]rune(negDias[i])[:3]))
				dows = append(dows, strconv.Itoa(i))
			}
		}
		h, st, en := "", "", ""
		if citaHHMM.MatchString(w.StartTime) && citaHHMM.MatchString(w.EndTime) {
			h, st, en = neg12h(w.StartTime)+" – "+neg12h(w.EndTime), w.StartTime, w.EndTime
		}
		equipo = append(equipo, gin.H{"Nombre": w.Name, "Inicial": negocioInitial(w.Name), "Dias": strings.Join(dias, " · "), "Dows": strings.Join(dows, ","), "Horas": h, "Start": st, "End": en})
	}
	data["Equipo"] = equipo

	// Otras sucursales
	var others []models.MyBusinessInfo
	config.DB.Where("user_id = ? AND id <> ?", n.Owner.ID, b.ID).Order("branch_number ASC").Find(&others)
	sucs := []gin.H{}
	for i := range others {
		d, _ := negAddress(&others[i])
		if d == "" {
			continue
		}
		suc := gin.H{"Nombre": others[i].BranchName, "Direccion": d,
			"Mapa": "https://www.google.com/maps/search/?api=1&query=" + url.QueryEscape(n.Nombre+", "+d)}
		if tel := negDigits.ReplaceAllString(others[i].PhoneNumber, ""); len(tel) >= 10 {
			l := tel[len(tel)-10:]
			suc["Telefono"], suc["TelLink"] = l[:3]+" "+l[3:6]+" "+l[6:], template.URL("tel:+52"+l)
		}
		sucs = append(sucs, suc)
	}
	data["Sucursales"] = sucs
	c.HTML(http.StatusOK, "negocio.html", data)
}

// NegocioAgendarPage — GET /n/:slug/agendar (la misma página de /agendar/:id).
func NegocioAgendarPage(c *gin.Context) {
	n := negocioBySlug(c)
	if n == nil {
		c.HTML(http.StatusNotFound, "agendar-cita.html", gin.H{"NotFound": true})
		return
	}
	cu := customerFromCookie(c, n.Owner.ID)
	c.HTML(http.StatusOK, "agendar-cita.html", gin.H{"ID": n.Owner.ID, "Negocio": n.Nombre, "Slug": n.Slug, "Nav": negocioNav(n, cu, "agendar")})
}

// NegocioAuthPage — GET /n/:slug/entrar y /n/:slug/registro
func NegocioAuthPage(mode string) gin.HandlerFunc {
	return func(c *gin.Context) {
		n := negocioBySlug(c)
		if n == nil {
			negocioNotFound(c)
			return
		}
		next := c.Query("sig")
		if next != "agendar" {
			next = "mis-citas"
		}
		if cu := customerFromCookie(c, n.Owner.ID); cu != nil {
			c.Redirect(http.StatusFound, "/n/"+n.Slug+"/"+next)
			return
		}
		data := gin.H{"Nav": negocioNav(n, nil, mode), "Mode": mode, "Slug": n.Slug, "OwnerID": n.Owner.ID, "Nombre": n.Nombre, "Next": next}
		if n.Branch != nil {
			data["Logo"] = n.Branch.LogoURL
			dir, _ := negAddress(n.Branch)
			data["Direccion"] = dir
		}
		c.HTML(http.StatusOK, "negocio-cuenta.html", data)
	}
}

// NegocioMisCitasPage — GET /n/:slug/mis-citas
func NegocioMisCitasPage(c *gin.Context) {
	n := negocioBySlug(c)
	if n == nil {
		negocioNotFound(c)
		return
	}
	cu := customerFromCookie(c, n.Owner.ID)
	if cu == nil {
		c.Redirect(http.StatusFound, "/n/"+n.Slug+"/entrar")
		return
	}
	data := gin.H{"Nav": negocioNav(n, cu, "mis-citas"), "Slug": n.Slug, "OwnerID": n.Owner.ID, "Nombre": n.Nombre,
		"Cliente": strings.TrimSpace(cu.Nombre + " " + cu.Apellido), "Correo": cu.Correo}
	if n.Branch != nil {
		data["Telefono"] = n.Branch.PhoneNumber
	}
	c.HTML(http.StatusOK, "negocio-mis-citas.html", data)
}

/* ---------------- API: cuenta ---------------- */

// Freno a contraseñas: 10 intentos fallidos por IP cada 15 minutos.
var (
	custMu    sync.Mutex
	custFails = map[string][]time.Time{}
)

func customerBlocked(ip string) bool {
	custMu.Lock()
	defer custMu.Unlock()
	cut := time.Now().Add(-15 * time.Minute)
	keep := custFails[ip][:0]
	for _, t := range custFails[ip] {
		if t.After(cut) {
			keep = append(keep, t)
		}
	}
	custFails[ip] = keep
	return len(keep) >= 10
}

func customerFail(ip string) {
	custMu.Lock()
	custFails[ip] = append(custFails[ip], time.Now())
	custMu.Unlock()
}

var custEmailRe = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)

func customerJSON(cu *models.Customer) gin.H {
	cel := strings.TrimPrefix(cu.Celular, "+52")
	return gin.H{"id": cu.ID, "nombre": cu.Nombre, "apellido": cu.Apellido, "correo": cu.Correo, "celular": cel, "fechaNacimiento": cu.FechaNacimiento}
}

func negocioAPI(c *gin.Context) *negocioCtx {
	n := negocioBySlug(c)
	if n == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Este negocio ya no existe."})
	}
	return n
}

// CustomerRegister — POST /api/n/:slug/registro
func CustomerRegister(c *gin.Context) {
	n := negocioAPI(c)
	if n == nil {
		return
	}
	var in struct {
		Nombre          string   `json:"nombre"`
		Apellido        string   `json:"apellido"`
		Correo          string   `json:"correo"`
		Celular         string   `json:"celular"`
		FechaNacimiento string   `json:"fechaNacimiento"`
		Password        string   `json:"password"`
		Reclamos        []string `json:"reclamos"`
		Website         string   `json:"website"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Revisa tus datos."})
		return
	}
	if strings.TrimSpace(in.Website) != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Revisa tus datos."})
		return
	}
	if customerBlocked(c.ClientIP()) {
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "Demasiados intentos. Espera unos minutos."})
		return
	}
	in.Nombre, in.Apellido = bookingCut(strings.TrimSpace(in.Nombre), 120), bookingCut(strings.TrimSpace(in.Apellido), 120)
	cel := negDigits.ReplaceAllString(in.Celular, "")
	if len(cel) > 10 {
		cel = cel[len(cel)-10:]
	}
	in.Correo = strings.ToLower(strings.TrimSpace(in.Correo))
	switch {
	case len([]rune(in.Nombre)) < 2 || len([]rune(in.Apellido)) < 2:
		c.JSON(http.StatusBadRequest, gin.H{"error": "Escribe tu nombre y apellido."})
		return
	case !custEmailRe.MatchString(in.Correo) || len(in.Correo) > 200:
		c.JSON(http.StatusBadRequest, gin.H{"error": "Escribe un correo válido."})
		return
	case len(cel) != 10:
		c.JSON(http.StatusBadRequest, gin.H{"error": "Escribe tu celular a 10 dígitos."})
		return
	case len(in.Password) < 8 || len(in.Password) > 72:
		c.JSON(http.StatusBadRequest, gin.H{"error": "La contraseña debe tener al menos 8 caracteres."})
		return
	}
	if t, err := time.Parse("2006-01-02", in.FechaNacimiento); err != nil || t.After(time.Now()) || t.Year() < 1900 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Elige tu fecha de nacimiento."})
		return
	}
	cu := &models.Customer{OwnerID: n.Owner.ID, Nombre: in.Nombre, Apellido: in.Apellido, Correo: in.Correo, Celular: "+52" + cel, FechaNacimiento: in.FechaNacimiento}
	if err := cu.SetPassword(in.Password); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "No se pudo crear tu cuenta. Intenta de nuevo."})
		return
	}
	if err := models.CreateCustomer(cu); err != nil {
		if errors.Is(err, models.ErrCustomerExists) {
			c.JSON(http.StatusConflict, gin.H{"error": "Ya hay una cuenta con ese correo. Inicia sesión.", "existe": true})
			return
		}
		log.Printf("CustomerRegister: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "No se pudo crear tu cuenta. Intenta de nuevo."})
		return
	}
	customerClaim(n.Owner.ID, cu.ID, in.Reclamos)
	models.TouchCustomerLogin(cu)
	customerSetSession(c, n.Owner.ID, cu.ID)
	c.JSON(http.StatusCreated, gin.H{"ok": true, "cliente": customerJSON(cu)})
}

// CustomerLogin — POST /api/n/:slug/entrar
func CustomerLogin(c *gin.Context) {
	n := negocioAPI(c)
	if n == nil {
		return
	}
	var in struct {
		Correo   string   `json:"correo"`
		Password string   `json:"password"`
		Reclamos []string `json:"reclamos"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || strings.TrimSpace(in.Correo) == "" || in.Password == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Escribe tu correo y tu contraseña."})
		return
	}
	ip := c.ClientIP()
	if customerBlocked(ip) {
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "Demasiados intentos. Espera unos minutos."})
		return
	}
	cu, err := models.GetCustomerByEmail(n.Owner.ID, in.Correo)
	if err != nil || !cu.CheckPassword(in.Password) {
		customerFail(ip)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Correo o contraseña incorrectos."})
		return
	}
	customerClaim(n.Owner.ID, cu.ID, in.Reclamos)
	models.TouchCustomerLogin(cu)
	customerSetSession(c, n.Owner.ID, cu.ID)
	c.JSON(http.StatusOK, gin.H{"ok": true, "cliente": customerJSON(cu)})
}

// CustomerLogout — POST /api/n/:slug/salir
func CustomerLogout(c *gin.Context) {
	n := negocioAPI(c)
	if n == nil {
		return
	}
	customerClearSession(c, n.Owner.ID)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// CustomerMe — GET /api/n/:slug/yo
func CustomerMe(c *gin.Context) {
	n := negocioAPI(c)
	if n == nil {
		return
	}
	cu := customerFromCookie(c, n.Owner.ID)
	if cu == nil {
		c.JSON(http.StatusOK, gin.H{"cliente": nil})
		return
	}
	c.JSON(http.StatusOK, gin.H{"cliente": customerJSON(cu)})
}

/* ---------------- API: mis citas ---------------- */

func customerAPI(c *gin.Context) (*negocioCtx, *models.Customer) {
	n := negocioAPI(c)
	if n == nil {
		return nil, nil
	}
	cu := customerFromCookie(c, n.Owner.ID)
	if cu == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Tu sesión terminó. Vuelve a iniciar sesión.", "sesion": false})
		return nil, nil
	}
	return n, cu
}

func myCitaJSON(a models.Appointment) gin.H {
	d := a.Date.In(time.Local)
	st := string(a.Status)
	futura := d.After(time.Now())
	activa := a.Status == models.AppointmentStatusPending || a.Status == models.AppointmentStatusConfirmed
	return gin.H{
		"id": a.ID, "date": d.Format("2006-01-02"), "time": d.Format("15:04"), "status": st,
		"cancelReason": a.CancelReason, "servicio": a.Service, "creada": a.CreatedAt,
		"puedeCambiar": futura && activa && d.After(time.Now().Add(bookingMinLead)),
		"proxima":      futura && activa,
	}
}

func myCita(c *gin.Context, owner, cid uint) *models.Appointment {
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	var a models.Appointment
	if err := config.DB.Where("id = ? AND user_id = ? AND customer_id = ?", id, owner, cid).First(&a).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "No se encontró esa cita en tu cuenta."})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "No se pudo cargar tu cita."})
		}
		return nil
	}
	return &a
}

// MyCitasList — GET /api/n/:slug/mis-citas
func MyCitasList(c *gin.Context) {
	n, cu := customerAPI(c)
	if cu == nil {
		return
	}
	var list []models.Appointment
	if err := config.DB.Where("user_id = ? AND customer_id = ?", n.Owner.ID, cu.ID).Order("date DESC").Limit(100).Find(&list).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "No se pudieron cargar tus citas."})
		return
	}
	out := make([]gin.H, 0, len(list))
	for _, a := range list {
		out = append(out, myCitaJSON(a))
	}
	c.JSON(http.StatusOK, gin.H{"citas": out, "cliente": customerJSON(cu)})
}

// MyCitaCancel — POST /api/n/:slug/mis-citas/:id/cancelar
func MyCitaCancel(c *gin.Context) {
	n, cu := customerAPI(c)
	if cu == nil {
		return
	}
	var in struct {
		Motivo string `json:"motivo"`
	}
	_ = c.ShouldBindJSON(&in)
	motivo := bookingCut(strings.TrimSpace(in.Motivo), 400)
	if len([]rune(motivo)) < 3 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Cuéntanos brevemente por qué cancelas."})
		return
	}
	a := myCita(c, n.Owner.ID, cu.ID)
	if a == nil {
		return
	}
	if j := myCitaJSON(*a); j["puedeCambiar"] != true {
		c.JSON(http.StatusConflict, gin.H{"error": "Esta cita ya no se puede cancelar desde aquí. Comunícate con el negocio."})
		return
	}
	err := config.DB.Model(a).Updates(map[string]interface{}{"status": models.AppointmentStatusCancelled, "cancel_reason": "Cancelada por el cliente: " + motivo}).Error
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "No se pudo cancelar. Intenta de nuevo."})
		return
	}
	LivePublish(n.Owner.ID, "citas", "optometria")
	log.Printf("📅 [Mis citas] Cliente %d canceló la cita %d (negocio %d)", cu.ID, a.ID, n.Owner.ID)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// MyCitaReschedule — POST /api/n/:slug/mis-citas/:id/reagendar
func MyCitaReschedule(c *gin.Context) {
	n, cu := customerAPI(c)
	if cu == nil {
		return
	}
	var in struct {
		Date string `json:"date"`
		Time string `json:"time"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Elige un día y una hora."})
		return
	}
	a := myCita(c, n.Owner.ID, cu.ID)
	if a == nil {
		return
	}
	if j := myCitaJSON(*a); j["puedeCambiar"] != true {
		c.JSON(http.StatusConflict, gin.H{"error": "Esta cita ya no se puede cambiar desde aquí. Comunícate con el negocio."})
		return
	}
	when, err := time.ParseInLocation("2006-01-02 15:04", in.Date+" "+in.Time, time.Local)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Elige un día y una hora."})
		return
	}
	if msg := bookingSlotProblem(n.Owner.ID, when, in.Date, in.Time); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	free, err := citaSlotFree(n.Owner.ID, when, a.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "No se pudo verificar el horario. Intenta de nuevo."})
		return
	}
	if !free {
		c.JSON(http.StatusConflict, gin.H{"error": "Alguien acaba de apartar esa hora. Elige otra.", "ocupada": true})
		return
	}
	// Vuelve a "Pendiente" para que el negocio confirme el nuevo horario.
	if err := config.DB.Model(a).Updates(map[string]interface{}{"date": when, "status": models.AppointmentStatusPending}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "No se pudo reagendar. Intenta de nuevo."})
		return
	}
	LivePublish(n.Owner.ID, "citas", "optometria")
	log.Printf("📅 [Mis citas] Cliente %d reagendó la cita %d → %s %s", cu.ID, a.ID, in.Date, in.Time)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
