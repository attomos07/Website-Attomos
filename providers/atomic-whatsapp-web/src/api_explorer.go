package src

// api_explorer.go — el bot lee el inventario/endpoint externo que el cliente
// conectó desde el panel (tab "API Explorer" dentro de Inventario) y lo mete
// al contexto de Gemini para poder responder preguntas sobre esos datos
// (disponibilidad, precio, características, lo que sea que traiga ese JSON).
//
// El bot NUNCA llama directo al endpoint externo del cliente ni conoce su
// API key: le pide los datos ya resueltos al backend de Attomos
// (GET /api/bot/api-explorer/:agent_id), que es quien hace el proxy real.
// Mismo patrón de auth que orders_bot.go / payments.go / inscriptions.go:
// Authorization: Bearer BOT_API_TOKEN.

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"
)

type apiExplorerCache struct {
	mu          sync.RWMutex
	connected   bool
	items       []map[string]interface{}
	lastFetched time.Time
	lastError   string
}

var apxCache = &apiExplorerCache{}

const apiExplorerRefreshInterval = 5 * time.Minute
const apiExplorerMaxItemsInPrompt = 40 // no saturar el prompt si el catálogo es grande
const apiExplorerMaxFieldLen = 150     // recorta valores largos (descripciones, JSON anidado, etc.)

var apxImageFieldRe = regexp.MustCompile(`(?i)foto|imagen|image|photo|picture|thumbnail|avatar|logo|banner`)
var apxImageURLRe = regexp.MustCompile(`(?i)\.(jpe?g|png|gif|webp|avif|bmp)(\?.*)?$`)

// FetchAPIExplorerData jala el inventario conectado desde el backend de
// Attomos y lo guarda en caché en memoria. Se puede llamar manualmente
// (ej. al conectar por primera vez) además del polling automático.
func FetchAPIExplorerData() error {
	attomosURL := os.Getenv("ATTOMOS_API_URL")
	botToken := os.Getenv("BOT_API_TOKEN")
	agentID := os.Getenv("AGENT_ID")
	if attomosURL == "" || botToken == "" || agentID == "" {
		return fmt.Errorf("ATTOMOS_API_URL, BOT_API_TOKEN o AGENT_ID no configurados")
	}

	req, err := http.NewRequest("GET", fmt.Sprintf("%s/api/bot/api-explorer/%s", attomosURL, agentID), nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+botToken)

	resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		apxCache.mu.Lock()
		apxCache.lastError = err.Error()
		apxCache.mu.Unlock()
		return fmt.Errorf("error llamando API Explorer: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		apxCache.mu.Lock()
		apxCache.lastError = fmt.Sprintf("backend retornó %d", resp.StatusCode)
		apxCache.mu.Unlock()
		return fmt.Errorf("backend retornó %d: %s", resp.StatusCode, body)
	}

	var result struct {
		Connected bool        `json:"connected"`
		Ok        bool        `json:"ok"`
		Error     string      `json:"error"`
		Data      interface{} `json:"data"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return fmt.Errorf("error parseando respuesta: %w", err)
	}

	apxCache.mu.Lock()
	defer apxCache.mu.Unlock()

	apxCache.connected = result.Connected
	apxCache.lastFetched = time.Now()

	if !result.Connected {
		apxCache.items = nil
		apxCache.lastError = ""
		return nil
	}
	if !result.Ok {
		apxCache.items = nil
		apxCache.lastError = result.Error
		log.Printf("⚠️  [APIExplorer] El endpoint externo respondió con error: %s", result.Error)
		return nil
	}

	apxCache.items = extractAPXItems(result.Data)
	apxCache.lastError = ""
	log.Printf("✅ [APIExplorer] %d elemento(s) cargado(s) desde el endpoint conectado", len(apxCache.items))
	return nil
}

// extractAPXItems busca el arreglo de "filas" dentro de la respuesta del
// endpoint externo, sin asumir el nombre de la llave (mismo criterio que usa
// el frontend en apxExtractRows) — cada cliente puede tener su propio esquema.
func extractAPXItems(data interface{}) []map[string]interface{} {
	toItems := func(arr []interface{}) []map[string]interface{} {
		items := make([]map[string]interface{}, 0, len(arr))
		for _, v := range arr {
			if m, ok := v.(map[string]interface{}); ok {
				items = append(items, m)
			}
		}
		return items
	}

	if arr, ok := data.([]interface{}); ok {
		return toItems(arr)
	}
	obj, ok := data.(map[string]interface{})
	if !ok {
		return nil
	}

	preferredKeys := []string{"vehiculos", "items", "rows", "results", "records", "productos", "products", "autos", "list", "data"}
	for _, k := range preferredKeys {
		if arr, ok := obj[k].([]interface{}); ok {
			return toItems(arr)
		}
	}
	for _, v := range obj {
		if arr, ok := v.([]interface{}); ok {
			return toItems(arr)
		}
	}
	return nil
}

// IsAPIExplorerConnected indica si hay un endpoint conectado con datos en caché.
func IsAPIExplorerConnected() bool {
	apxCache.mu.RLock()
	defer apxCache.mu.RUnlock()
	return apxCache.connected && len(apxCache.items) > 0
}

func apxLooksLikeImage(v interface{}) bool {
	s, ok := v.(string)
	if !ok {
		return false
	}
	return apxImageURLRe.MatchString(s) || strings.HasPrefix(s, "data:image")
}

// apxFormatFieldValue recorta/aplana un valor para que quepa en una línea del
// prompt sin desperdiciar tokens en URLs de imagen o blobs largos.
func apxFormatFieldValue(key string, v interface{}) string {
	if v == nil {
		return ""
	}
	if apxLooksLikeImage(v) || apxImageFieldRe.MatchString(key) {
		return "(tiene foto)"
	}
	s := fmt.Sprintf("%v", v)
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	if len(s) > apiExplorerMaxFieldLen {
		s = s[:apiExplorerMaxFieldLen] + "…"
	}
	return s
}

// GetAPIExplorerContext arma el bloque de texto para inyectar en el prompt de
// Gemini con los datos del endpoint conectado. Vacío si no hay nada conectado
// (así no se agrega ruido al prompt cuando el negocio no usa esta función).
func GetAPIExplorerContext() string {
	apxCache.mu.RLock()
	defer apxCache.mu.RUnlock()

	if !apxCache.connected || len(apxCache.items) == 0 {
		return ""
	}

	items := apxCache.items
	truncated := false
	if len(items) > apiExplorerMaxItemsInPrompt {
		items = items[:apiExplorerMaxItemsInPrompt]
		truncated = true
	}

	var sb strings.Builder
	sb.WriteString("\nINVENTARIO / DATOS CONECTADOS (API Explorer):\n")
	for i, item := range items {
		var parts []string
		for k, v := range item {
			fv := apxFormatFieldValue(k, v)
			if fv == "" {
				continue
			}
			parts = append(parts, fmt.Sprintf("%s: %s", k, fv))
		}
		sb.WriteString(fmt.Sprintf("%d. %s\n", i+1, strings.Join(parts, " | ")))
	}
	if truncated {
		sb.WriteString(fmt.Sprintf("(...hay más elementos disponibles; se muestran los primeros %d)\n", apiExplorerMaxItemsInPrompt))
	}
	sb.WriteString("Usa esta información para responder preguntas del cliente sobre disponibilidad, precio, características, etc. Si pregunta por algo que NO aparece en esta lista, dilo claramente — no inventes datos.\n")

	return sb.String()
}

// StartAPIExplorerPolling carga el inventario al arrancar y lo refresca cada
// apiExplorerRefreshInterval en segundo plano, para que el bot responda con
// datos frescos sin que cada mensaje del cliente tenga que esperar la
// llamada HTTP al backend.
func StartAPIExplorerPolling() {
	go func() {
		if err := FetchAPIExplorerData(); err != nil {
			log.Printf("ℹ️  [APIExplorer] Sin datos por ahora: %v", err)
		}
		ticker := time.NewTicker(apiExplorerRefreshInterval)
		defer ticker.Stop()
		for range ticker.C {
			if err := FetchAPIExplorerData(); err != nil {
				log.Printf("⚠️  [APIExplorer] Error refrescando: %v", err)
			}
		}
	}()
}
