package handlers

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"attomos/config"
	"attomos/models"
	"attomos/services"

	"github.com/gin-gonic/gin"
)

// =============================================================================
// INVENTARIO — conexión a cualquier hoja de Google Sheets del cliente, como
// visualizador genérico (sirve para cualquier giro: no asume columnas fijas).
// Son métodos de GoogleIntegrationHandler porque reutilizan el mismo
// sheetsService que ya usa la integración de Sheets para citas.
//
// IMPORTANTE — requiere 3 campos nuevos en models.Agent (mismo patrón que
// GoogleSheetID / GoogleSheetsConnected / GoogleSheetsConnectedAt, que ya
// existen para la hoja de citas). Ya agregados en agent.go:
//
//	InventorySheetID          string
//	InventorySheetConnected   bool
//	InventorySheetConnectedAt *time.Time
//
// =============================================================================

var spreadsheetIDFromURLRe = regexp.MustCompile(`/d/([a-zA-Z0-9-_]+)`)

// extractSpreadsheetID acepta tanto la URL completa como el ID pelón.
func extractSpreadsheetID(input string) string {
	input = strings.TrimSpace(input)
	if m := spreadsheetIDFromURLRe.FindStringSubmatch(input); m != nil {
		return m[1]
	}
	return input
}

func spreadsheetURL(id string) string {
	if id == "" {
		return ""
	}
	return "https://docs.google.com/spreadsheets/d/" + id + "/edit"
}

// splitFileNameColumns separa la lista guardada como "Marca,Vehículo" en
// ["Marca", "Vehículo"]. Ignora espacios y entradas vacías.
func splitFileNameColumns(stored string) []string {
	if strings.TrimSpace(stored) == "" {
		return nil
	}
	parts := strings.Split(stored, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

// getAgentForUser obtiene el agente verificando que pertenece al usuario autenticado.
func (h *GoogleIntegrationHandler) getAgentForUser(c *gin.Context) (*models.Agent, *models.User, bool) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return nil, nil, false
	}
	user := userInterface.(*models.User)

	agentID := c.Param("agent_id")
	var agent models.Agent
	if err := config.DB.Where("id = ? AND user_id = ?", agentID, user.ID).First(&agent).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Agente no encontrado"})
		return nil, nil, false
	}
	return &agent, user, true
}

// GetInventorySheetStatus — GET /api/inventory-sheets/status/:agent_id
func (h *GoogleIntegrationHandler) GetInventorySheetStatus(c *gin.Context) {
	agent, _, ok := h.getAgentForUser(c)
	if !ok {
		return
	}

	resp := gin.H{"connected": agent.InventorySheetConnected}
	if agent.InventorySheetConnected {
		resp["spreadsheet_id"] = agent.InventorySheetID
		resp["spreadsheet_url"] = spreadsheetURL(agent.InventorySheetID)
		if agent.InventorySheetConnectedAt != nil {
			resp["connected_at"] = agent.InventorySheetConnectedAt.Format(time.RFC3339)
		}
		resp["photo_column"] = agent.InventoryPhotoColumn
		resp["album_column"] = agent.InventoryAlbumColumn
		resp["has_own_gemini_key"] = agent.InventoryGeminiAPIKey != ""
		resp["has_shared_gemini_key"] = os.Getenv("GEMINI_VISION_API_KEY") != ""
		resp["file_name_columns"] = splitFileNameColumns(agent.InventoryFileNameColumns)
	}
	c.JSON(http.StatusOK, resp)
}

// ConnectInventorySheet — POST /api/inventory-sheets/connect/:agent_id
// Body: {"spreadsheet_url": "<enlace o ID de la hoja>"}
func (h *GoogleIntegrationHandler) ConnectInventorySheet(c *gin.Context) {
	agent, _, ok := h.getAgentForUser(c)
	if !ok {
		return
	}

	var body struct {
		SpreadsheetURL string `json:"spreadsheet_url"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || strings.TrimSpace(body.SpreadsheetURL) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Falta el enlace o ID de la hoja"})
		return
	}

	if agent.GoogleToken == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Primero conecta tu cuenta de Google desde Integraciones (Google Sheets o Calendar) antes de vincular el inventario.",
		})
		return
	}

	spreadsheetID := extractSpreadsheetID(body.SpreadsheetURL)

	ctx := context.Background()
	if err := h.sheetsService.ValidateSpreadsheetAccess(ctx, agent.GoogleToken, spreadsheetID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "No se pudo acceder a esa hoja. Verifica el enlace y que tu cuenta de Google tenga permiso para verla.",
		})
		return
	}

	now := time.Now()
	agent.InventorySheetID = spreadsheetID
	agent.InventorySheetConnected = true
	agent.InventorySheetConnectedAt = &now

	if err := config.DB.Save(agent).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "No se pudo guardar la conexión"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"connected":       true,
		"spreadsheet_id":  agent.InventorySheetID,
		"spreadsheet_url": spreadsheetURL(agent.InventorySheetID),
		"connected_at":    now.Format(time.RFC3339),
	})
}

// DisconnectInventorySheet — POST /api/inventory-sheets/disconnect/:agent_id
func (h *GoogleIntegrationHandler) DisconnectInventorySheet(c *gin.Context) {
	agent, _, ok := h.getAgentForUser(c)
	if !ok {
		return
	}

	agent.InventorySheetID = ""
	agent.InventorySheetConnected = false
	agent.InventorySheetConnectedAt = nil

	if err := config.DB.Save(agent).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "No se pudo desconectar"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// GetInventorySheetRows — GET /api/inventory-sheets/rows/:agent_id
func (h *GoogleIntegrationHandler) GetInventorySheetRows(c *gin.Context) {
	agent, _, ok := h.getAgentForUser(c)
	if !ok {
		return
	}

	if !agent.InventorySheetConnected || agent.InventorySheetID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No hay una hoja de inventario conectada"})
		return
	}
	if agent.GoogleToken == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "La conexión con Google se perdió, vuelve a conectarla desde Integraciones"})
		return
	}

	ctx := context.Background()
	data, err := h.sheetsService.GetInventorySheetData(ctx, agent.GoogleToken, agent.InventorySheetID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "No se pudo leer la hoja: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"headers":   data.Headers,
		"rows":      data.Rows,
		"last_sync": time.Now().Format(time.RFC3339),
	})
}

// SetInventoryColumns — POST /api/inventory-sheets/columns/:agent_id
// Body: {"photo_column": "<encabezado exacto>", "album_column": "<encabezado exacto, opcional>"}
// El usuario elige de las columnas reales de SU hoja — nunca se asume un nombre.
func (h *GoogleIntegrationHandler) SetInventoryColumns(c *gin.Context) {
	agent, _, ok := h.getAgentForUser(c)
	if !ok {
		return
	}

	var body struct {
		PhotoColumn     string   `json:"photo_column"`
		AlbumColumn     string   `json:"album_column"`
		FileNameColumns []string `json:"file_name_columns"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos inválidos"})
		return
	}
	if strings.TrimSpace(body.PhotoColumn) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Elige qué columna es la de fotos"})
		return
	}

	agent.InventoryPhotoColumn = strings.TrimSpace(body.PhotoColumn)
	agent.InventoryAlbumColumn = strings.TrimSpace(body.AlbumColumn)

	cleanCols := make([]string, 0, len(body.FileNameColumns))
	for _, col := range body.FileNameColumns {
		col = strings.TrimSpace(col)
		if col != "" {
			cleanCols = append(cleanCols, col)
		}
	}
	agent.InventoryFileNameColumns = strings.Join(cleanCols, ",")

	if err := config.DB.Save(agent).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "No se pudo guardar la configuración"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"photo_column":      agent.InventoryPhotoColumn,
		"album_column":      agent.InventoryAlbumColumn,
		"file_name_columns": splitFileNameColumns(agent.InventoryFileNameColumns),
	})
}

// UploadInventoryRowPhotos — POST /api/inventory-sheets/upload/:agent_id
// multipart/form-data: row=<int fila real de la hoja>, folder_label=<opcional>, photos=[archivos]
// Sube a Drive y escribe =IMAGE()/=HYPERLINK() en las columnas configuradas.
// No usa IA: la fila ya se conoce porque el usuario le dio clic a esa celda.
func (h *GoogleIntegrationHandler) UploadInventoryRowPhotos(c *gin.Context) {
	agent, _, ok := h.getAgentForUser(c)
	if !ok {
		return
	}

	if !agent.InventorySheetConnected || agent.InventorySheetID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No hay una hoja de inventario conectada"})
		return
	}
	if agent.InventoryPhotoColumn == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Primero configura en qué columna van las fotos"})
		return
	}
	if agent.GoogleToken == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "La conexión con Google se perdió, vuelve a conectarla desde Integraciones"})
		return
	}

	rowNumber, err := strconv.Atoi(c.PostForm("row"))
	if err != nil || rowNumber < 2 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Fila inválida"})
		return
	}
	folderLabel := strings.TrimSpace(c.PostForm("folder_label"))
	if folderLabel == "" {
		folderLabel = fmt.Sprintf("Fila %d", rowNumber)
	}

	form, err := c.MultipartForm()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No se recibieron archivos"})
		return
	}
	fileHeaders := form.File["photos"]
	if len(fileHeaders) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Selecciona al menos una foto"})
		return
	}

	photos := make([]services.UploadedPhoto, 0, len(fileHeaders))
	for _, fh := range fileHeaders {
		f, err := fh.Open()
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "No se pudo leer una de las fotos"})
			return
		}
		data, err := io.ReadAll(f)
		f.Close()
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "No se pudo leer una de las fotos"})
			return
		}
		mimeType := fh.Header.Get("Content-Type")
		if mimeType == "" {
			mimeType = "image/jpeg"
		}
		photos = append(photos, services.UploadedPhoto{Bytes: data, FileName: fh.Filename, MimeType: mimeType})
	}

	ctx := context.Background()
	nameLabel, err := h.sheetsService.BuildRowLabel(ctx, agent.GoogleToken, agent.InventorySheetID, rowNumber, splitFileNameColumns(agent.InventoryFileNameColumns))
	if err != nil {
		log.Printf("⚠️  [Agent %d] upload: no se pudo armar la etiqueta de nombrado (fila %d): %v", agent.ID, rowNumber, err)
		nameLabel = "" // no bloquea la subida, solo se queda sin etiqueta bonita
	}

	result, err := h.sheetsService.UploadPhotosToRow(
		ctx, agent.GoogleToken, agent.InventorySheetID,
		rowNumber, agent.InventoryPhotoColumn, agent.InventoryAlbumColumn,
		folderLabel, nameLabel, photos,
	)
	if err != nil {
		log.Printf("❌ [Agent %d] upload (fila %d, %d foto(s)): %v", agent.ID, rowNumber, len(photos), err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "No se pudieron subir las fotos: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, result)
}

// UpdateInventoryCell — PATCH /api/inventory-sheets/cell/:agent_id
// Body: {"row": 3, "column": "<encabezado exacto>", "value": "texto nuevo"}
// Edición directa desde la tabla de Attomos → se refleja en la hoja real.
func (h *GoogleIntegrationHandler) UpdateInventoryCell(c *gin.Context) {
	agent, _, ok := h.getAgentForUser(c)
	if !ok {
		return
	}

	if !agent.InventorySheetConnected || agent.InventorySheetID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No hay una hoja de inventario conectada"})
		return
	}
	if agent.GoogleToken == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "La conexión con Google se perdió, vuelve a conectarla desde Integraciones"})
		return
	}

	var body struct {
		Row    int    `json:"row"`
		Column string `json:"column"`
		Value  string `json:"value"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.Row < 2 || strings.TrimSpace(body.Column) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos inválidos"})
		return
	}

	ctx := context.Background()
	if err := h.sheetsService.UpdateCellValue(ctx, agent.GoogleToken, agent.InventorySheetID, body.Row, body.Column, body.Value); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "No se pudo guardar el cambio: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

// DetectAndUploadInventoryPhotos — POST /api/inventory-sheets/detect-upload/:agent_id
// multipart/form-data: photos=[archivos]. La IA lee el VIN de las fotos (igual
// que el Apps Script del cliente: analiza cada una hasta encontrar un VIN
// válido) y busca sola la fila correspondiente — no hace falta indicarla.
func (h *GoogleIntegrationHandler) DetectAndUploadInventoryPhotos(c *gin.Context) {
	agent, _, ok := h.getAgentForUser(c)
	if !ok {
		return
	}

	if !agent.InventorySheetConnected || agent.InventorySheetID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No hay una hoja de inventario conectada"})
		return
	}
	if agent.InventoryPhotoColumn == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Primero configura en qué columna van las fotos"})
		return
	}
	if agent.GoogleToken == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "La conexión con Google se perdió, vuelve a conectarla desde Integraciones"})
		return
	}

	form, err := c.MultipartForm()
	if err != nil {
		log.Printf("❌ [Agent %d] detect-upload: error leyendo multipart form: %v", agent.ID, err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "No se recibieron archivos"})
		return
	}
	fileHeaders := form.File["photos"]
	if len(fileHeaders) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Selecciona al menos una foto"})
		return
	}

	photos := make([]services.UploadedPhoto, 0, len(fileHeaders))
	for _, fh := range fileHeaders {
		f, err := fh.Open()
		if err != nil {
			log.Printf("❌ [Agent %d] detect-upload: error abriendo %s: %v", agent.ID, fh.Filename, err)
			c.JSON(http.StatusBadRequest, gin.H{"error": "No se pudo leer una de las fotos"})
			return
		}
		data, err := io.ReadAll(f)
		f.Close()
		if err != nil {
			log.Printf("❌ [Agent %d] detect-upload: error leyendo %s: %v", agent.ID, fh.Filename, err)
			c.JSON(http.StatusBadRequest, gin.H{"error": "No se pudo leer una de las fotos"})
			return
		}
		mimeType := fh.Header.Get("Content-Type")
		if mimeType == "" {
			mimeType = "image/jpeg"
		}
		photos = append(photos, services.UploadedPhoto{Bytes: data, FileName: fh.Filename, MimeType: mimeType})
	}
	log.Printf("📸 [Agent %d] detect-upload: %d foto(s) recibida(s)", agent.ID, len(photos))

	uploadCtx := context.Background()

	geminiKey := agent.InventoryGeminiAPIKey
	keySource := "propia del agente"
	if geminiKey == "" {
		geminiKey = os.Getenv("GEMINI_VISION_API_KEY")
		keySource = "fallback compartido"
	}
	if geminiKey == "" {
		log.Printf("❌ [Agent %d] detect-upload: no hay API Key de Gemini configurada (ni propia ni compartida)", agent.ID)
		c.JSON(http.StatusBadRequest, gin.H{"error": "No hay una API Key de Gemini configurada. Configúrala en Integraciones o pídele al administrador que active el fallback compartido."})
		return
	}
	log.Printf("🔑 [Agent %d] detect-upload: usando key %s", agent.ID, keySource)

	// Analiza CADA foto (no se detiene en la primera que traiga VIN) — así
	// sabemos cuál(es) mostrar el VIN para nombrarlas distinto de las demás,
	// igual que hace el Apps Script del cliente.
	type analyzedPhoto struct {
		idx     int
		vin     string
		matches bool
	}
	analyzed := make([]analyzedPhoto, len(photos))
	var vin string
	for i, p := range photos {
		detected, err := services.ExtractVINFromPhoto(uploadCtx, geminiKey, p.Bytes, p.MimeType)
		if err != nil {
			log.Printf("❌ [Agent %d] detect-upload: error de Gemini en foto %d (%s): %v", agent.ID, i+1, p.FileName, err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Error consultando la IA: " + err.Error()})
			return
		}
		log.Printf("🔍 [Agent %d] detect-upload: foto %d (%s) → VIN detectado: %q", agent.ID, i+1, p.FileName, detected)
		analyzed[i] = analyzedPhoto{idx: i, vin: detected}
		if detected != "" && vin == "" {
			vin = detected // el primer VIN legible es el que se usa para buscar la fila
		}
	}
	if vin == "" {
		log.Printf("⚠️  [Agent %d] detect-upload: ninguna foto trajo un VIN legible", agent.ID)
		c.JSON(http.StatusBadRequest, gin.H{"error": "No se pudo leer un VIN válido en ninguna foto. Intenta con una imagen más clara del VIN."})
		return
	}
	for _, a := range analyzed {
		if a.vin != "" && strings.EqualFold(strings.TrimSpace(a.vin), strings.TrimSpace(vin)) {
			photos[a.idx].MatchesVIN = true
		}
	}

	rowNumber, err := h.sheetsService.FindRowByVIN(uploadCtx, agent.GoogleToken, agent.InventorySheetID, vin)
	if err != nil {
		log.Printf("❌ [Agent %d] detect-upload: error buscando VIN %s en la hoja: %v", agent.ID, vin, err)
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if rowNumber == 0 {
		log.Printf("⚠️  [Agent %d] detect-upload: VIN %s no encontrado en la hoja", agent.ID, vin)
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("El VIN %s no se encontró en el inventario. Verifica que ya exista esa unidad en la hoja.", vin)})
		return
	}
	log.Printf("✅ [Agent %d] detect-upload: VIN %s encontrado en la fila %d", agent.ID, vin, rowNumber)

	nameLabel, err := h.sheetsService.BuildRowLabel(uploadCtx, agent.GoogleToken, agent.InventorySheetID, rowNumber, splitFileNameColumns(agent.InventoryFileNameColumns))
	if err != nil {
		log.Printf("⚠️  [Agent %d] detect-upload: no se pudo armar la etiqueta de nombrado (fila %d): %v", agent.ID, rowNumber, err)
		nameLabel = ""
	}

	result, err := h.sheetsService.UploadPhotosToRow(
		uploadCtx, agent.GoogleToken, agent.InventorySheetID,
		rowNumber, agent.InventoryPhotoColumn, agent.InventoryAlbumColumn,
		vin, nameLabel, photos,
	)
	if err != nil {
		log.Printf("❌ [Agent %d] detect-upload: error subiendo fotos a Drive/Sheets (fila %d): %v", agent.ID, rowNumber, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "No se pudieron subir las fotos: " + err.Error()})
		return
	}
	log.Printf("✅ [Agent %d] detect-upload: %d foto(s) subida(s) a la fila %d", agent.ID, result.Count, result.Row)

	c.JSON(http.StatusOK, gin.H{
		"vin":        vin,
		"row":        result.Row,
		"count":      result.Count,
		"folder_url": result.FolderURL,
	})
}

// SetInventoryGeminiKey — POST /api/inventory-sheets/gemini-key/:agent_id
// Body: {"api_key": "AIzaSy..."}
// API Key de Gemini PROPIA de este cliente para la detección de VIN — no
// toca ni depende de la que usa su bot (esa vive en el servidor/GCP).
func (h *GoogleIntegrationHandler) SetInventoryGeminiKey(c *gin.Context) {
	agent, _, ok := h.getAgentForUser(c)
	if !ok {
		return
	}

	var body struct {
		APIKey string `json:"api_key"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos inválidos"})
		return
	}
	key := strings.TrimSpace(body.APIKey)
	if len(key) < 30 || !strings.HasPrefix(key, "AIzaSy") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "API Key inválida. Debe comenzar con 'AIzaSy'"})
		return
	}

	agent.InventoryGeminiAPIKey = key
	if err := config.DB.Save(agent).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "No se pudo guardar la API Key"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "has_own_gemini_key": true})
}

// RemoveInventoryGeminiKey — POST /api/inventory-sheets/gemini-key/:agent_id/remove
func (h *GoogleIntegrationHandler) RemoveInventoryGeminiKey(c *gin.Context) {
	agent, _, ok := h.getAgentForUser(c)
	if !ok {
		return
	}

	agent.InventoryGeminiAPIKey = ""
	if err := config.DB.Save(agent).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "No se pudo quitar la API Key"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "has_own_gemini_key": false})
}
