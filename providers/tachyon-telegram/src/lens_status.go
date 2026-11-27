package src

// lens_status.go — Ópticas: el cliente pregunta "¿ya están mis lentes?" y
// el agente contesta con el paso del laboratorio, igual que la página de
// Rastreo. Busca sus trabajos por su número de WhatsApp o por la clave de
// rastreo del ticket (AT + 6 letras/números):
//
//	GET {ATTOMOS_API_URL}/api/bot/lab-status?agentId=..&phone=..&code=..
//	Authorization: Bearer BOT_API_TOKEN
//
// La respuesta se arma aquí (sin Gemini) para que nunca invente un estatus.

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"
)

type lensJob struct {
	Code      string   `json:"code"`
	Estatus   string   `json:"estatus"`
	Hint      string   `json:"hint"`
	Paso      string   `json:"paso"`
	Listo     bool     `json:"listo"`
	Entregado bool     `json:"entregado"`
	Entrega   string   `json:"entrega"`
	Express   bool     `json:"express"`
	Fecha     string   `json:"fecha"`
	Productos []string `json:"productos"`
	Rastreo   string   `json:"rastreo"`
}

var lensCodeRe = regexp.MustCompile(`(?i)\bAT[\s-]?([A-Z0-9]{6})\b`)

// isOpticaMode — el negocio es una óptica.
func isOpticaMode() bool {
	if BusinessCfg == nil {
		return false
	}
	bt := strings.ToLower(BusinessCfg.BusinessType)
	return strings.Contains(bt, "optica") || strings.Contains(bt, "óptica") || strings.Contains(bt, "optic")
}

// lensStatusIntent — ¿pregunta por sus lentes / su pedido? Regresa la clave
// de rastreo si la escribió.
func lensStatusIntent(message string) (code string, ok bool) {
	if m := lensCodeRe.FindStringSubmatch(strings.ToUpper(message)); m != nil {
		return "AT" + m[1], true
	}
	t := strings.ToLower(message)
	r := strings.NewReplacer("á", "a", "é", "e", "í", "i", "ó", "o", "ú", "u", "¿", "", "?", "")
	t = r.Replace(t)
	things := []string{"mis lentes", "mis anteojos", "mis gafas", "mis micas", "mis lentes de contacto",
		"mi pedido", "mi orden", "mi trabajo", "mis armazones", "mi armazon", "los lentes", "mis lentillas"}
	status := []string{"ya estan", "ya esta", "estan listos", "esta listo", "listos", "listo", "como van", "como va",
		"cuando", "estatus", "status", "estado", "avance", "ya puedo", "recoger", "pasar por", "falta", "tardan", "tarda"}
	if strings.Contains(t, "rastreo") || strings.Contains(t, "rastrear") || strings.Contains(t, "estado de mi") || strings.Contains(t, "estatus de mi") {
		return "", true
	}
	hasThing := false
	for _, k := range things {
		if strings.Contains(t, k) {
			hasThing = true
			break
		}
	}
	if !hasThing {
		return "", false
	}
	for _, k := range status {
		if strings.Contains(t, k) {
			return "", true
		}
	}
	return "", false
}

func fetchLensStatus(phone, code string) ([]lensJob, error) {
	base := strings.TrimRight(os.Getenv("ATTOMOS_API_URL"), "/")
	token := os.Getenv("BOT_API_TOKEN")
	agentID := os.Getenv("AGENT_ID")
	if base == "" || token == "" || agentID == "" {
		return nil, fmt.Errorf("ATTOMOS_API_URL, BOT_API_TOKEN o AGENT_ID no configurados")
	}
	q := url.Values{}
	q.Set("agentId", agentID)
	if phone != "" {
		q.Set("phone", phone)
	}
	if code != "" {
		q.Set("code", code)
	}
	req, err := http.NewRequest("GET", base+"/api/bot/lab-status?"+q.Encode(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	client := &http.Client{Timeout: 8 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API %d: %s", resp.StatusCode, string(body))
	}
	var out struct {
		Trabajos []lensJob `json:"trabajos"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, err
	}
	return out.Trabajos, nil
}

func lensJobText(j lensJob) string {
	var b strings.Builder
	what := "Tu pedido"
	if len(j.Productos) > 0 {
		what = "Tu pedido (" + strings.Join(j.Productos, ", ") + ")"
	}
	fmt.Fprintf(&b, "🔎 *%s*", j.Code)
	if j.Fecha != "" {
		fmt.Fprintf(&b, " · %s", j.Fecha)
	}
	b.WriteString("\n")
	switch {
	case j.Entregado:
		fmt.Fprintf(&b, "✅ %s ya se entregó.", what)
	case j.Listo:
		fmt.Fprintf(&b, "🎉 ¡%s ya está listo! Puedes pasar a recogerlo.", what)
	case j.Paso != "":
		fmt.Fprintf(&b, "🧪 %s está en el laboratorio: *%s*.", what, j.Paso)
	case j.Estatus != "":
		fmt.Fprintf(&b, "📋 %s: *%s*. %s", what, j.Estatus, j.Hint)
	}
	if j.Entrega != "" && !j.Listo && !j.Entregado {
		fmt.Fprintf(&b, "\n📅 Entrega estimada: %s.", j.Entrega)
	}
	if j.Express && !j.Listo && !j.Entregado {
		b.WriteString("\n⚡ Va como express.")
	}
	if j.Rastreo != "" {
		fmt.Fprintf(&b, "\n🔗 Síguelo aquí: %s", j.Rastreo)
	}
	return b.String()
}

// tryLensStatusReply — si es óptica y el cliente pregunta por sus lentes,
// regresa la respuesta lista. phone = su número (vacío si el canal no lo da).
func tryLensStatusReply(state *UserState, message, phone string) (string, bool) {
	if !isOpticaMode() {
		return "", false
	}
	code, ok := lensStatusIntent(message)
	if !ok {
		return "", false
	}
	log.Printf("👓 [Lentes] Consulta de estatus (clave=%q)", code)
	jobs, err := fetchLensStatus(phone, code)
	var reply string
	switch {
	case err != nil:
		log.Printf("⚠️  [Lentes] %v", err)
		reply = "Ahorita no pude consultar el laboratorio 😕. Si tienes a la mano la clave de rastreo de tu ticket (empieza con AT), mándamela y lo reviso, o en un momento te confirmamos."
	case len(jobs) == 0 && code != "":
		reply = fmt.Sprintf("No encontré ningún pedido con la clave *%s* 🤔. Revísala en tu ticket (son las letras AT y 6 letras o números) y mándamela de nuevo.", code)
	case len(jobs) == 0:
		reply = "No encontré pedidos a tu número 🤔. ¿Me compartes la clave de rastreo de tu ticket? Empieza con *AT* (por ejemplo AT7K3P9Q)."
	default:
		parts := make([]string, 0, len(jobs))
		for _, j := range jobs {
			parts = append(parts, lensJobText(j))
		}
		intro := "Esto es lo que tengo de tu pedido 👓:\n\n"
		if len(jobs) > 1 {
			intro = "Tienes " + fmt.Sprint(len(jobs)) + " pedidos 👓:\n\n"
		}
		reply = intro + strings.Join(parts, "\n\n")
	}
	state.ConversationHistory = append(state.ConversationHistory, "Asistente: "+reply)
	return reply, true
}
