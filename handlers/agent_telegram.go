package handlers

// agent_telegram.go — Token del bot de Telegram de cada cliente.
//
// Cada negocio crea SU bot con @BotFather (/newbot) y pega el token en el
// onboarding. Aquí se revisa antes de crear el agente:
//   - Que tenga el formato de Telegram (123456789:AA…).
//   - Que Telegram lo reconozca (getMe) — así no se despliega un bot que
//     nunca va a arrancar.
//   - Que no lo esté usando otro agente (Telegram solo deja que UN proceso
//     reciba los mensajes de cada bot).
// El token se guarda en Agent.PhoneNumber (como ya lo leía el deploy) y
// nunca se regresa completo al navegador ni se escribe en los logs.

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"attomos/config"
	"attomos/models"
)

var telegramTokenRe = regexp.MustCompile(`^\d{5,15}:[A-Za-z0-9_-]{30,}$`)

// isTelegramToken: ¿parece un token de @BotFather?
func isTelegramToken(s string) bool { return telegramTokenRe.MatchString(strings.TrimSpace(s)) }

// maskTelegramToken: "123456789:AAH…xYz9" para mostrar o loguear.
func maskTelegramToken(t string) string {
	t = strings.TrimSpace(t)
	i := strings.Index(t, ":")
	if i < 0 || len(t) < i+8 {
		return "•••"
	}
	return t[:i] + ":" + t[i+1:i+4] + "…" + t[len(t)-4:]
}

// agentPublicPhone: lo que se manda al navegador en "phoneNumber". Para
// Telegram es el token, así que va enmascarado.
func agentPublicPhone(a *models.Agent) string {
	if a.IsTelegramBot() {
		if a.PhoneNumber == "" {
			return ""
		}
		return maskTelegramToken(a.PhoneNumber)
	}
	return a.PhoneNumber
}

// checkTelegramToken revisa el token con Telegram y que no esté en uso.
// Regresa el @usuario del bot o un mensaje de error para el cliente.
// exceptAgentID: el agente que se está editando (0 al crear).
func checkTelegramToken(token string, exceptAgentID uint) (string, string) {
	token = strings.TrimSpace(token)
	if token == "" {
		return "", "Pega el token de tu bot de Telegram (te lo da @BotFather al crear el bot con /newbot)."
	}
	if !isTelegramToken(token) {
		return "", "Ese token no tiene el formato de Telegram. Debe verse como 123456789:AAH… (cópialo completo de @BotFather)."
	}

	var n int64
	q := config.DB.Model(&models.Agent{}).Where("bot_type = ? AND phone_number = ?", "telegram", token)
	if exceptAgentID > 0 {
		q = q.Where("id <> ?", exceptAgentID)
	}
	q.Count(&n)
	if n > 0 {
		return "", "Ese bot de Telegram ya está conectado a otro agente. Crea otro bot con @BotFather o usa uno distinto."
	}

	client := &http.Client{Timeout: 8 * time.Second}
	resp, err := client.Get("https://api.telegram.org/bot" + token + "/getMe")
	if err != nil {
		// Telegram no respondió: no se bloquea la creación por eso.
		return "", ""
	}
	defer resp.Body.Close()
	var out struct {
		OK     bool `json:"ok"`
		Result struct {
			Username string `json:"username"`
			IsBot    bool   `json:"is_bot"`
		} `json:"result"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", ""
	}
	if !out.OK || !out.Result.IsBot {
		return "", "Telegram no reconoce ese token. Revisa que lo copiaste completo o genera uno nuevo en @BotFather con /token."
	}
	return "@" + out.Result.Username, ""
}

// telegramBotLink: https://t.me/<usuario> para probar el bot.
func telegramBotLink(username string) string {
	u := strings.TrimPrefix(username, "@")
	if u == "" {
		return ""
	}
	return fmt.Sprintf("https://t.me/%s", u)
}
