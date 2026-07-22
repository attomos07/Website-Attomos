package services

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"strings"
)

// =============================================================================
// GEMINI VISION — detección de VIN en fotos, para el botón "Subir foto (IA)"
// del inventario. Usa una API Key propia de Attomos (server-side), NO la del
// bot de cada cliente (esa vive en el .env del servidor compartido vía SSH,
// o en GCP para OrbitalBot — ninguna de las dos es viable de reutilizar aquí
// sin acoplar esta función a la infraestructura del bot).
//
// Requiere la variable de entorno GEMINI_VISION_API_KEY en el backend.
// =============================================================================

const geminiVisionModel = "gemini-3.5-flash" // no "-lite": la lectura de VIN en fotos angulares/con reflejo necesita más capacidad — el Apps Script del cliente ya usa este mismo modelo

var vinPatternRe = regexp.MustCompile(`(?i)\b[A-HJ-NPR-Z0-9]{17}\b`)

// ExtractVINFromPhoto le pide a Gemini que lea el VIN visible en una foto
// (mismo criterio que ya usa el Apps Script del cliente: 17 caracteres
// alfanuméricos, sin I/O/Q). Devuelve "" (sin error) si no logra leer uno.
// apiKey la resuelve quien llama (primero la propia del agente, si la
// configuró; si no, el fallback compartido GEMINI_VISION_API_KEY).
func ExtractVINFromPhoto(ctx context.Context, apiKey string, imageBytes []byte, mimeType string) (string, error) {
	if apiKey == "" {
		return "", fmt.Errorf("no hay una API Key de Gemini configurada")
	}

	prompt := "Esta es una foto de un vehículo con su VIN (Vehicle Identification Number) visible, " +
		"generalmente en una etiqueta, parabrisas o placa metálica. El VIN tiene exactamente 17 " +
		"caracteres alfanuméricos (nunca usa las letras I, O, Q). Responde ÚNICAMENTE con el VIN, " +
		"sin texto adicional, sin explicaciones, sin comillas. Si no puedes leer un VIN claro y " +
		"completo de 17 caracteres, responde exactamente: NONE"

	payload := map[string]interface{}{
		"contents": []map[string]interface{}{
			{
				"parts": []map[string]interface{}{
					{"text": prompt},
					{"inline_data": map[string]string{
						"mime_type": mimeType,
						"data":      base64.StdEncoding.EncodeToString(imageBytes),
					}},
				},
			},
		},
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("error preparando la solicitud a Gemini: %w", err)
	}

	url := fmt.Sprintf("https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent?key=%s", geminiVisionModel, apiKey)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("error llamando a Gemini: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("error leyendo respuesta de Gemini: %w", err)
	}

	var parsed struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return "", fmt.Errorf("error interpretando la respuesta de Gemini: %w", err)
	}
	if parsed.Error != nil {
		return "", fmt.Errorf("Gemini: %s", parsed.Error.Message)
	}
	if len(parsed.Candidates) == 0 || len(parsed.Candidates[0].Content.Parts) == 0 {
		return "", nil
	}

	var text strings.Builder
	for _, p := range parsed.Candidates[0].Content.Parts {
		text.WriteString(p.Text)
		text.WriteString(" ")
	}
	clean := strings.ToUpper(strings.TrimSpace(text.String()))
	log.Printf("🤖 Gemini (%s) respondió: %q", geminiVisionModel, clean)

	if clean == "" || clean == "NONE" {
		return "", nil
	}

	match := vinPatternRe.FindString(clean)
	if match == "" {
		log.Printf("⚠️  Gemini respondió texto pero no matcheó el patrón de VIN (17 caracteres, sin I/O/Q): %q", clean)
	}
	return match, nil
}
