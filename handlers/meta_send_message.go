package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"attomos/config"
	"attomos/models"

	"github.com/gin-gonic/gin"
)

// Versión de la Graph API usada para enviar mensajes desde el panel.
const metaSendAPIVersion = "v22.0"

var nonDigits = regexp.MustCompile(`\D`)

// SendMetaTestMessage envía un mensaje desde el número de WhatsApp Business
// del agente usando la WhatsApp Cloud API (POST /{phone-number-id}/messages).
//
// Sirve para que el cliente compruebe su conexión y es el flujo que se
// muestra en el video de App Review del permiso whatsapp_business_messaging.
//
// Body:
//
//	{ "to": "526621234567", "type": "template" | "text",
//	  "templateName": "mi_plantilla", "languageCode": "en_US",
//	  "headerParams": ["..."], "bodyParams": ["...", "..."], "text": "..." }
func SendMetaTestMessage(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}
	user := userInterface.(*models.User)

	agentID, err := strconv.ParseUint(c.Param("agent_id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID de agente inválido"})
		return
	}

	var agent models.Agent
	if err := config.DB.Where("id = ? AND user_id = ?", agentID, user.ID).First(&agent).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Agente no encontrado"})
		return
	}

	if agent.MetaAccessToken == "" || agent.MetaPhoneNumberID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "El agente no tiene WhatsApp Business (Meta) conectado"})
		return
	}

	var req struct {
		To           string   `json:"to"`
		Type         string   `json:"type"`
		TemplateName string   `json:"templateName"`
		LanguageCode string   `json:"languageCode"`
		HeaderParams []string `json:"headerParams"`
		BodyParams   []string `json:"bodyParams"`
		Text         string   `json:"text"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos inválidos: " + err.Error()})
		return
	}

	to := nonDigits.ReplaceAllString(req.To, "")
	if len(to) < 8 || len(to) > 15 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Número inválido. Usa formato internacional, ej. 526621234567"})
		return
	}

	payload := map[string]interface{}{
		"messaging_product": "whatsapp",
		"recipient_type":    "individual",
		"to":                to,
	}

	switch strings.ToLower(req.Type) {
	case "text":
		text := strings.TrimSpace(req.Text)
		if text == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "El mensaje no puede estar vacío"})
			return
		}
		payload["type"] = "text"
		payload["text"] = map[string]interface{}{"preview_url": false, "body": text}
	default:
		name := strings.TrimSpace(req.TemplateName)
		if name == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Elige una plantilla"})
			return
		}
		lang := strings.TrimSpace(req.LanguageCode)
		if lang == "" {
			lang = "en_US"
		}
		template := map[string]interface{}{
			"name":     name,
			"language": map[string]string{"code": lang},
		}
		var components []map[string]interface{}
		if params := buildTextParams(req.HeaderParams); len(params) > 0 {
			components = append(components, map[string]interface{}{"type": "header", "parameters": params})
		}
		if params := buildTextParams(req.BodyParams); len(params) > 0 {
			components = append(components, map[string]interface{}{"type": "body", "parameters": params})
		}
		if len(components) > 0 {
			template["components"] = components
		}
		payload["type"] = "template"
		payload["template"] = template
	}

	body, _ := json.Marshal(payload)
	endpoint := fmt.Sprintf("https://graph.facebook.com/%s/%s/messages", metaSendAPIVersion, agent.MetaPhoneNumberID)

	httpReq, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "No se pudo crear la petición"})
		return
	}
	httpReq.Header.Set("Authorization", "Bearer "+agent.MetaAccessToken)
	httpReq.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		log.Printf("❌ [Agent %d] Error enviando mensaje por Cloud API: %v", agent.ID, err)
		c.JSON(http.StatusBadGateway, gin.H{"error": "No se pudo contactar a la API de WhatsApp"})
		return
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	var metaResp interface{}
	if err := json.Unmarshal(respBody, &metaResp); err != nil {
		metaResp = string(respBody)
	}

	// Lo que se muestra en el panel (el token nunca sale del servidor).
	requestInfo := gin.H{
		"method":   "POST",
		"endpoint": endpoint,
		"body":     payload,
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		log.Printf("⚠️  [Agent %d] Cloud API respondió %d: %s", agent.ID, resp.StatusCode, string(respBody))
		errMsg := "La API de WhatsApp rechazó el mensaje"
		if m, ok := metaResp.(map[string]interface{}); ok {
			if e, ok := m["error"].(map[string]interface{}); ok {
				if msg, ok := e["message"].(string); ok && msg != "" {
					errMsg = msg
				}
			}
		}
		c.JSON(resp.StatusCode, gin.H{
			"success":  false,
			"error":    errMsg,
			"request":  requestInfo,
			"response": metaResp,
		})
		return
	}

	log.Printf("✅ [Agent %d] Mensaje enviado por Cloud API a %s", agent.ID, maskSensitiveValue(to))
	c.JSON(http.StatusOK, gin.H{
		"success":  true,
		"request":  requestInfo,
		"response": metaResp,
	})
}

// fetchMetaPhoneNumberInfo valida un token + phone_number_id contra la Graph
// API y devuelve el número visible y el nombre verificado del negocio.
func fetchMetaPhoneNumberInfo(accessToken, phoneNumberID string) (string, string, error) {
	endpoint := fmt.Sprintf("https://graph.facebook.com/%s/%s?fields=display_phone_number,verified_name", metaSendAPIVersion, phoneNumberID)
	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return "", "", err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", "", fmt.Errorf("no se pudo contactar a Meta: %w", err)
	}
	defer resp.Body.Close()

	var data struct {
		DisplayPhoneNumber string `json:"display_phone_number"`
		VerifiedName       string `json:"verified_name"`
		Error              *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	body, _ := io.ReadAll(resp.Body)
	if err := json.Unmarshal(body, &data); err != nil {
		return "", "", fmt.Errorf("respuesta inválida de Meta (HTTP %d)", resp.StatusCode)
	}
	if resp.StatusCode != http.StatusOK || data.Error != nil {
		if data.Error != nil && data.Error.Message != "" {
			return "", "", fmt.Errorf("%s", data.Error.Message)
		}
		return "", "", fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return data.DisplayPhoneNumber, data.VerifiedName, nil
}

// buildTextParams convierte los valores de las variables {{n}} en parámetros
// de tipo texto para la Cloud API.
func buildTextParams(values []string) []map[string]interface{} {
	params := make([]map[string]interface{}, 0, len(values))
	for _, v := range values {
		params = append(params, map[string]interface{}{"type": "text", "text": strings.TrimSpace(v)})
	}
	return params
}

var templateVarRe = regexp.MustCompile(`\{\{\s*(\d+)\s*\}\}`)

// countTemplateVars regresa cuántas variables posicionales {{n}} tiene un texto.
func countTemplateVars(text string) int {
	max := 0
	for _, m := range templateVarRe.FindAllStringSubmatch(text, -1) {
		if n, err := strconv.Atoi(m[1]); err == nil && n > max {
			max = n
		}
	}
	return max
}

// ListMetaTemplates regresa las plantillas APROBADAS del WABA del agente,
// listas para elegir en el panel (nombre, idioma, texto y nº de variables).
// GET /api/meta/templates/:agent_id
func ListMetaTemplates(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}
	user := userInterface.(*models.User)

	agentID, err := strconv.ParseUint(c.Param("agent_id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID de agente inválido"})
		return
	}

	var agent models.Agent
	if err := config.DB.Where("id = ? AND user_id = ?", agentID, user.ID).First(&agent).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Agente no encontrado"})
		return
	}
	if agent.MetaAccessToken == "" || agent.MetaWABAID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "El agente no tiene WhatsApp Business (Meta) conectado"})
		return
	}

	endpoint := fmt.Sprintf(
		"https://graph.facebook.com/%s/%s/message_templates?status=APPROVED&limit=100&fields=name,language,category,status,components",
		metaSendAPIVersion, agent.MetaWABAID,
	)
	httpReq, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "No se pudo crear la petición"})
		return
	}
	httpReq.Header.Set("Authorization", "Bearer "+agent.MetaAccessToken)

	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "No se pudo contactar a la API de WhatsApp"})
		return
	}
	defer resp.Body.Close()

	var data struct {
		Data []struct {
			Name       string `json:"name"`
			Language   string `json:"language"`
			Category   string `json:"category"`
			Components []struct {
				Type   string `json:"type"`
				Format string `json:"format"`
				Text   string `json:"text"`
			} `json:"components"`
		} `json:"data"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	respBody, _ := io.ReadAll(resp.Body)
	if err := json.Unmarshal(respBody, &data); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "Respuesta inválida de Meta"})
		return
	}
	if resp.StatusCode != http.StatusOK || data.Error != nil {
		msg := fmt.Sprintf("HTTP %d", resp.StatusCode)
		if data.Error != nil && data.Error.Message != "" {
			msg = data.Error.Message
		}
		c.JSON(resp.StatusCode, gin.H{"error": msg})
		return
	}

	templates := make([]gin.H, 0, len(data.Data))
	for _, tpl := range data.Data {
		item := gin.H{
			"name":         tpl.Name,
			"language":     tpl.Language,
			"category":     tpl.Category,
			"headerText":   "",
			"headerParams": 0,
			"bodyText":     "",
			"bodyParams":   0,
			"supported":    true,
		}
		for _, comp := range tpl.Components {
			switch strings.ToUpper(comp.Type) {
			case "HEADER":
				if strings.ToUpper(comp.Format) == "TEXT" {
					item["headerText"] = comp.Text
					item["headerParams"] = countTemplateVars(comp.Text)
				} else if comp.Format != "" {
					// Encabezados con imagen/video/documento aún no se soportan aquí
					item["supported"] = false
				}
			case "BODY":
				item["bodyText"] = comp.Text
				item["bodyParams"] = countTemplateVars(comp.Text)
			}
		}
		templates = append(templates, item)
	}

	c.JSON(http.StatusOK, gin.H{"templates": templates})
}
