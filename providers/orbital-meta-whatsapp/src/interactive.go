package src

// interactive.go — Mensajes con botones y listas de WhatsApp Cloud API
// (para el modo sin IA, ver menu.go).
//
// Límites de Meta:
//   - Botones de respuesta: máx. 3, título ≤ 20 caracteres, id ≤ 256.
//   - Lista: máx. 10 filas en total, título de fila ≤ 24, descripción ≤ 72,
//     texto del botón ≤ 20, encabezado ≤ 60, cuerpo ≤ 1024.
// Aquí se recortan los textos para que Meta nunca rechace el mensaje.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// MenuButton botón de respuesta rápida.
type MenuButton struct {
	ID    string
	Title string
}

// MenuRow fila de una lista.
type MenuRow struct {
	ID          string
	Title       string
	Description string
}

// clip recorta a n caracteres (runas), con "…" si se pasa.
func clip(s string, n int) string {
	s = strings.TrimSpace(s)
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	if n <= 1 {
		return string(r[:n])
	}
	return strings.TrimSpace(string(r[:n-1])) + "…"
}

// SendButtons manda un texto con hasta 3 botones.
func (c *MetaClient) SendButtons(to, body string, buttons []MenuButton) error {
	if len(buttons) == 0 {
		return c.SendMessage(to, body)
	}
	if len(buttons) > 3 {
		buttons = buttons[:3]
	}
	btns := make([]map[string]interface{}, 0, len(buttons))
	for _, b := range buttons {
		btns = append(btns, map[string]interface{}{
			"type":  "reply",
			"reply": map[string]string{"id": clip(b.ID, 256), "title": clip(b.Title, 20)},
		})
	}
	return c.sendInteractive(to, map[string]interface{}{
		"type":   "button",
		"body":   map[string]string{"text": clip(body, 1024)},
		"action": map[string]interface{}{"buttons": btns},
	})
}

// SendList manda un texto con un botón que abre una lista (hasta 10 filas).
func (c *MetaClient) SendList(to, header, body, buttonText string, rows []MenuRow) error {
	if len(rows) == 0 {
		return c.SendMessage(to, body)
	}
	if len(rows) > 10 {
		rows = rows[:10]
	}
	list := make([]map[string]string, 0, len(rows))
	for _, r := range rows {
		row := map[string]string{"id": clip(r.ID, 200), "title": clip(r.Title, 24)}
		if d := clip(r.Description, 72); d != "" {
			row["description"] = d
		}
		list = append(list, row)
	}
	inter := map[string]interface{}{
		"type": "list",
		"body": map[string]string{"text": clip(body, 1024)},
		"action": map[string]interface{}{
			"button":   clip(buttonText, 20),
			"sections": []map[string]interface{}{{"title": clip(buttonText, 24), "rows": list}},
		},
	}
	if h := clip(header, 60); h != "" {
		inter["header"] = map[string]string{"type": "text", "text": h}
	}
	return c.sendInteractive(to, inter)
}

func (c *MetaClient) sendInteractive(to string, interactive map[string]interface{}) error {
	if !c.IsConfigured() {
		return fmt.Errorf("cliente Meta no configurado - configura las credenciales en Integraciones")
	}
	url := fmt.Sprintf("https://graph.facebook.com/%s/%s/messages", c.APIVersion, c.PhoneNumberID)
	payload := map[string]interface{}{
		"messaging_product": "whatsapp",
		"recipient_type":    "individual",
		"to":                to,
		"type":              "interactive",
		"interactive":       interactive,
	}
	jsonData, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("error marshaling payload: %w", err)
	}
	req, err := http.NewRequestWithContext(c.ctx, "POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return fmt.Errorf("error creating request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.AccessToken)
	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("error sending request: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("API error (status %d): %s", resp.StatusCode, string(body))
	}
	return nil
}
