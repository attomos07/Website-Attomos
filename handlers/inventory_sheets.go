package handlers

import (
	"context"
	"crypto/rand"
	"encoding/hex"
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
		log.Printf("⚠️ [getAgentForUser] sin usuario en contexto (no autenticado) — path=%s", c.Request.URL.Path)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return nil, nil, false
	}
	user := userInterface.(*models.User)

	agentID := c.Param("agent_id")
	var agent models.Agent
	if err := config.DB.Where("id = ? AND user_id = ?", agentID, user.ID).First(&agent).Error; err != nil {
		log.Printf("⚠️ [getAgentForUser] agente no encontrado — agent_id=%s user_id=%d err=%v", agentID, user.ID, err)
		c.JSON(http.StatusNotFound, gin.H{"error": "Agente no encontrado"})
		return nil, nil, false
	}
	return &agent, user, true
}

// GetInventorySheetStatus — GET /api/inventory-sheets/status/:agent_id
func (h *GoogleIntegrationHandler) GetInventorySheetStatus(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
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
		resp["title_column"] = agent.InventoryTitleColumn
		resp["description_column"] = agent.InventoryDescriptionColumn
		resp["original_price_column"] = agent.InventoryOriginalPriceColumn
		resp["promo_price_column"] = agent.InventoryPromoPriceColumn
		resp["vin_column"] = agent.InventoryVinColumn
		resp["new_arrival_column"] = agent.InventoryNewArrivalColumn
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

	// Notificaciones push de Drive ("tiempo real"): si falla, no bloquea la
	// conexión — el polling que ya existe (frontend cada 45s / al abrir la
	// vista) sigue funcionando como respaldo.
	if err := h.ensureInventoryWatch(agent); err != nil {
		log.Printf("⚠️  [Agent %d] no se pudo suscribir a notificaciones de Drive: %v", agent.ID, err)
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

	h.stopInventoryWatch(agent) // best-effort, no bloquea la desconexión

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
	c.Header("Cache-Control", "no-store")

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
	log.Printf("📄 [Agent %d] rows: leídas %d filas de la hoja %s en %s", agent.ID, len(data.Rows), agent.InventorySheetID, time.Now().Format("15:04:05"))
	if len(data.Rows) > 0 {
		var preview []string
		for _, cell := range data.Rows[0].Cells {
			preview = append(preview, cell.Text)
		}
		log.Printf("📄 [Agent %d] rows: fila 2 tal como la trajo Google ahora mismo: %v", agent.ID, preview)
	}

	resp := gin.H{
		"headers":   data.Headers,
		"rows":      data.Rows,
		"last_sync": time.Now().Format(time.RFC3339),
	}

	// Sincroniza el catálogo de Mi Negocio automáticamente en cada lectura de
	// la hoja (al abrir la vista o al darle "Actualizar") — así los cambios
	// hechos directo en Sheets se reflejan solos, sin tener que volver a
	// tocar el modal de columnas. Reutiliza los datos que ya se acaban de
	// leer (no vuelve a llamar a la API de Sheets).
	if agent.InventoryTitleColumn != "" {
		count, syncErr := h.syncInventoryToCatalogWithData(agent, data)
		if syncErr != nil {
			log.Printf("⚠️  [Agent %d] auto-sync del catálogo falló: %v", agent.ID, syncErr)
			resp["catalog_sync_error"] = syncErr.Error()
		} else {
			resp["synced_products"] = count
		}
	}

	c.JSON(http.StatusOK, resp)
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
		PhotoColumn         string   `json:"photo_column"`
		AlbumColumn         string   `json:"album_column"`
		FileNameColumns     []string `json:"file_name_columns"`
		TitleColumn         string   `json:"title_column"`
		DescriptionColumn   string   `json:"description_column"`
		OriginalPriceColumn string   `json:"original_price_column"`
		PromoPriceColumn    string   `json:"promo_price_column"`
		VinColumn           string   `json:"vin_column"`
		NewArrivalColumn    string   `json:"new_arrival_column"`
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
	agent.InventoryTitleColumn = strings.TrimSpace(body.TitleColumn)
	agent.InventoryDescriptionColumn = strings.TrimSpace(body.DescriptionColumn)
	agent.InventoryOriginalPriceColumn = strings.TrimSpace(body.OriginalPriceColumn)
	agent.InventoryPromoPriceColumn = strings.TrimSpace(body.PromoPriceColumn)
	agent.InventoryVinColumn = strings.TrimSpace(body.VinColumn)
	agent.InventoryNewArrivalColumn = strings.TrimSpace(body.NewArrivalColumn)

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

	resp := gin.H{
		"photo_column":          agent.InventoryPhotoColumn,
		"album_column":          agent.InventoryAlbumColumn,
		"file_name_columns":     splitFileNameColumns(agent.InventoryFileNameColumns),
		"title_column":          agent.InventoryTitleColumn,
		"description_column":    agent.InventoryDescriptionColumn,
		"original_price_column": agent.InventoryOriginalPriceColumn,
		"promo_price_column":    agent.InventoryPromoPriceColumn,
		"vin_column":            agent.InventoryVinColumn,
		"new_arrival_column":    agent.InventoryNewArrivalColumn,
	}

	// "Al asignarlos debería vincularse automáticamente": si ya quedó
	// configurado el título, sincroniza de una vez con Mi Negocio.
	if agent.InventoryTitleColumn != "" {
		count, err := h.syncInventoryToCatalog(context.Background(), agent)
		if err != nil {
			log.Printf("⚠️  [Agent %d] error sincronizando catálogo tras guardar columnas: %v", agent.ID, err)
			resp["sync_error"] = err.Error()
		} else {
			resp["synced_products"] = count
		}
	}

	c.JSON(http.StatusOK, resp)
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
// Body: {"api_key": "..."}  (Google emite keys con distintos prefijos —
// AIza..., AQ...., etc. — no validamos formato, solo longitud)
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
		log.Printf("⚠️ [Agent %d] SetInventoryGeminiKey: JSON inválido — err=%v", agent.ID, err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos inválidos"})
		return
	}
	key := strings.TrimSpace(body.APIKey)
	// Nota: Google emite API keys con más de un formato de prefijo (AIza...,
	// AQ...., y potencialmente otros a futuro) — no hay un prefijo fijo y
	// confiable en el que validar, así que solo chequeamos un rango de
	// longitud razonable y dejamos que la propia llamada a Gemini sea la
	// que confirme si la key es válida o no.
	safeSnippet := key
	if len(key) > 10 {
		safeSnippet = key[:6] + "…" + key[len(key)-4:]
	}
	if len(key) < 15 || len(key) > 150 {
		log.Printf("⚠️ [Agent %d] SetInventoryGeminiKey: key rechazada — len=%d snippet=%q", agent.ID, len(key), safeSnippet)
		c.JSON(http.StatusBadRequest, gin.H{"error": "API Key inválida (longitud fuera de rango)"})
		return
	}
	log.Printf("ℹ️ [Agent %d] SetInventoryGeminiKey: key aceptada — len=%d snippet=%q", agent.ID, len(key), safeSnippet)

	agent.InventoryGeminiAPIKey = key
	if err := config.DB.Save(agent).Error; err != nil {
		log.Printf("❌ [Agent %d] SetInventoryGeminiKey: error al guardar en DB — err=%v", agent.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "No se pudo guardar la API Key"})
		return
	}

	log.Printf("✅ [Agent %d] SetInventoryGeminiKey: key propia guardada", agent.ID)
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
		log.Printf("❌ [Agent %d] RemoveInventoryGeminiKey: error al guardar en DB — err=%v", agent.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "No se pudo quitar la API Key"})
		return
	}

	log.Printf("✅ [Agent %d] RemoveInventoryGeminiKey: key propia eliminada", agent.ID)
	c.JSON(http.StatusOK, gin.H{"success": true, "has_own_gemini_key": false})
}

// syncInventoryToCatalog lee la hoja y arma/actualiza los productos de Mi
// Negocio a partir de las columnas que el usuario vinculó (título, descripción,
// foto, precio original, precio promoción). SOLO toca los productos marcados
// como venidos del inventario (FromSheetRow > 0) — los agregados a mano en Mi
// Negocio (FromSheetRow == 0) se conservan tal cual, nunca se tocan ni se borran.
func (h *GoogleIntegrationHandler) syncInventoryToCatalog(ctx context.Context, agent *models.Agent) (int, error) {
	if agent.InventoryTitleColumn == "" {
		return 0, nil // no vinculado todavía, no hace nada
	}
	if !agent.InventorySheetConnected || agent.InventorySheetID == "" || agent.GoogleToken == "" {
		return 0, fmt.Errorf("la hoja de inventario no está conectada")
	}

	data, err := h.sheetsService.GetInventorySheetData(ctx, agent.GoogleToken, agent.InventorySheetID)
	if err != nil {
		return 0, err
	}
	return h.syncInventoryToCatalogWithData(agent, data)
}

// syncInventoryToCatalogWithData hace el mismo trabajo que syncInventoryToCatalog
// pero reutilizando datos de la hoja ya leídos (para no volver a llamar a la
// API de Sheets cuando quien llama ya los tiene, ej. GetInventorySheetRows).
func (h *GoogleIntegrationHandler) syncInventoryToCatalogWithData(agent *models.Agent, data *services.InventorySheetData) (int, error) {
	if agent.InventoryTitleColumn == "" {
		return 0, nil
	}
	if agent.BranchID == 0 {
		return 0, fmt.Errorf("este agente no tiene una sucursal (Mi Negocio) vinculada")
	}

	var branch models.MyBusinessInfo
	if err := config.DB.Where("id = ? AND user_id = ?", agent.BranchID, agent.UserID).First(&branch).Error; err != nil {
		return 0, fmt.Errorf("no se encontró la sucursal vinculada a este agente: %w", err)
	}

	colIdx := map[string]int{}
	for i, hdr := range data.Headers {
		colIdx[hdr] = i
	}
	titleIdx, hasTitle := colIdx[agent.InventoryTitleColumn]
	if !hasTitle {
		return 0, fmt.Errorf("no se encontró la columna de título (%s)", agent.InventoryTitleColumn)
	}
	descIdx, hasDesc := colIdx[agent.InventoryDescriptionColumn]
	photoIdx, hasPhoto := colIdx[agent.InventoryPhotoColumn]
	origIdx, hasOrig := colIdx[agent.InventoryOriginalPriceColumn]
	promoIdx, hasPromo := colIdx[agent.InventoryPromoPriceColumn]

	cellText := func(row services.InventoryRow, idx int, ok bool) string {
		if !ok || idx >= len(row.Cells) {
			return ""
		}
		return row.Cells[idx].Text
	}

	newServices := []models.BranchService{}
	for _, row := range data.Rows {
		title := cellText(row, titleIdx, hasTitle)
		if title == "" {
			continue // sin título no se puede armar un producto para esta fila
		}

		svc := models.BranchService{Title: title, FromSheetRow: row.Row}
		if hasDesc {
			svc.Description = cellText(row, descIdx, hasDesc)
		}
		if hasPhoto && photoIdx < len(row.Cells) && row.Cells[photoIdx].Kind == "image" && row.Cells[photoIdx].URL != "" {
			svc.ImageURL = row.Cells[photoIdx].URL
			svc.ImageUrls = []string{row.Cells[photoIdx].URL}
		}

		orig := parsePriceText(cellText(row, origIdx, hasOrig))
		promo := parsePriceText(cellText(row, promoIdx, hasPromo))
		svc.OriginalPrice = orig
		svc.PromoPrice = promo
		switch {
		case orig > 0 && promo > 0:
			svc.PriceType = "promo"
			svc.Price = promo
		case promo > 0:
			svc.PriceType = "promo"
			svc.Price = promo
		case orig > 0:
			svc.PriceType = "normal"
			svc.Price = orig
		default:
			svc.PriceType = "normal"
			svc.Price = 0
		}

		newServices = append(newServices, svc)
	}

	kept := models.BranchServices{}
	for _, s := range branch.Services {
		if s.FromSheetRow == 0 {
			kept = append(kept, s)
		}
	}
	branch.Services = append(kept, newServices...)

	if err := config.DB.Save(&branch).Error; err != nil {
		return 0, fmt.Errorf("no se pudo guardar el catálogo: %w", err)
	}

	// Empuja el business_config.json actualizado a los AtomicBots conectados
	// a esta sucursal — igual que hace SaveMyBusiness al guardar desde la UI.
	syncAtomicBots(&branch)

	return len(newServices), nil
}

// parsePriceText interpreta un valor de celda como precio (acepta "$479,900.00",
// "479900", "233" — quita símbolo de moneda y separador de miles). Si no se
// puede interpretar, devuelve 0 (no rompe la sincronización por un precio raro).
func parsePriceText(s string) float64 {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0
	}
	cleaner := strings.NewReplacer("$", "", ",", "", " ", "")
	v, err := strconv.ParseFloat(cleaner.Replace(s), 64)
	if err != nil {
		return 0
	}
	return v
}

// SyncInventoryProducts — POST /api/inventory-sheets/sync-products/:agent_id
// Re-sincroniza manualmente (por si cambiaste datos en la hoja y no quieres
// esperar al próximo guardado de columnas).
func (h *GoogleIntegrationHandler) SyncInventoryProducts(c *gin.Context) {
	agent, _, ok := h.getAgentForUser(c)
	if !ok {
		return
	}
	if agent.InventoryTitleColumn == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Primero elige qué columna es el título del producto"})
		return
	}

	count, err := h.syncInventoryToCatalog(context.Background(), agent)
	if err != nil {
		log.Printf("❌ [Agent %d] sync-products: %v", agent.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"synced_products": count})
}

// =============================================================================
// NOTIFICACIONES PUSH DE DRIVE (opción "tiempo real")
// =============================================================================

func generateRandomHex(nBytes int) (string, error) {
	b := make([]byte, nBytes)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// ensureInventoryWatch crea (o renueva) la suscripción push de Drive para la
// hoja conectada de este agente. No es fatal si falla — el polling que ya
// existe en el frontend sigue funcionando como respaldo.
func (h *GoogleIntegrationHandler) ensureInventoryWatch(agent *models.Agent) error {
	if !agent.InventorySheetConnected || agent.InventorySheetID == "" || agent.GoogleToken == "" {
		return nil
	}

	baseURL := strings.TrimRight(os.Getenv("BASE_URL"), "/")
	if baseURL == "" {
		return fmt.Errorf("falta configurar BASE_URL en el servidor (ej. https://attomos.com)")
	}

	channelID, err := generateRandomHex(16)
	if err != nil {
		return err
	}
	token, err := generateRandomHex(24)
	if err != nil {
		return err
	}
	webhookURL := fmt.Sprintf("%s/webhook/drive-inventory/%d", baseURL, agent.ID)

	result, err := h.sheetsService.WatchSpreadsheetFile(context.Background(), agent.GoogleToken, agent.InventorySheetID, channelID, webhookURL, token)
	if err != nil {
		return err
	}

	// Si ya había una suscripción anterior activa para esta hoja, la cancelamos
	// (Google no lo hace solo — si no, se quedaría avisando de más).
	if agent.InventoryWatchChannelID != "" && agent.InventoryWatchChannelID != result.ChannelID {
		_ = h.sheetsService.StopWatchChannel(context.Background(), agent.GoogleToken, agent.InventoryWatchChannelID, agent.InventoryWatchResourceID)
	}

	agent.InventoryWatchChannelID = result.ChannelID
	agent.InventoryWatchResourceID = result.ResourceID
	agent.InventoryWatchToken = token
	agent.InventoryWatchExpiresAt = &result.Expiration

	if err := config.DB.Save(agent).Error; err != nil {
		return fmt.Errorf("no se pudo guardar la suscripción: %w", err)
	}

	log.Printf("🔔 [Agent %d] suscripción push de Drive activa (vence %s)", agent.ID, result.Expiration.Format("2006-01-02 15:04"))
	return nil
}

// stopInventoryWatch cancela la suscripción activa (best-effort).
func (h *GoogleIntegrationHandler) stopInventoryWatch(agent *models.Agent) {
	if agent.InventoryWatchChannelID == "" || agent.GoogleToken == "" {
		return
	}
	if err := h.sheetsService.StopWatchChannel(context.Background(), agent.GoogleToken, agent.InventoryWatchChannelID, agent.InventoryWatchResourceID); err != nil {
		log.Printf("⚠️  [Agent %d] no se pudo cancelar la suscripción de Drive: %v", agent.ID, err)
	}
	agent.InventoryWatchChannelID = ""
	agent.InventoryWatchResourceID = ""
	agent.InventoryWatchToken = ""
	agent.InventoryWatchExpiresAt = nil
}

// InventoryWebhook — POST /webhook/drive-inventory/:agent_id  (PÚBLICO, sin
// AuthRequired — lo llama Google, no un usuario con sesión). Se verifica con
// el canal + token que se guardaron al crear la suscripción, no con un login.
func (h *GoogleIntegrationHandler) InventoryWebhook(c *gin.Context) {
	agentID := c.Param("agent_id")

	var agent models.Agent
	if err := config.DB.Where("id = ?", agentID).First(&agent).Error; err != nil {
		c.Status(http.StatusNotFound)
		return
	}

	channelID := c.GetHeader("X-Goog-Channel-ID")
	resourceState := c.GetHeader("X-Goog-Resource-State")
	token := c.GetHeader("X-Goog-Channel-Token")

	if channelID == "" || channelID != agent.InventoryWatchChannelID || token != agent.InventoryWatchToken {
		// Canal/token que no coincide con lo que guardamos — se ignora (puede
		// ser una suscripción vieja ya reemplazada). Igual respondemos 200
		// para que Google no reintente indefinidamente.
		c.Status(http.StatusOK)
		return
	}

	// Google espera un ack rápido — respondemos ya y hacemos el trabajo aparte.
	c.Status(http.StatusOK)

	if resourceState == "sync" {
		return // primer mensaje al crear el canal, no es un cambio real todavía
	}
	if !agent.InventorySheetConnected || agent.InventorySheetID == "" || agent.GoogleToken == "" {
		return
	}

	log.Printf("🔔 [Agent %d] webhook de Drive: cambio detectado en la hoja (%s)", agent.ID, resourceState)

	go func(a models.Agent) {
		data, err := h.sheetsService.GetInventorySheetData(context.Background(), a.GoogleToken, a.InventorySheetID)
		if err != nil {
			log.Printf("❌ [Agent %d] webhook: error leyendo la hoja: %v", a.ID, err)
			return
		}
		if a.InventoryTitleColumn != "" {
			if _, err := h.syncInventoryToCatalogWithData(&a, data); err != nil {
				log.Printf("❌ [Agent %d] webhook: error sincronizando catálogo: %v", a.ID, err)
			}
		}
	}(agent)
}

// RenewExpiringInventoryWatches revisa qué agentes tienen su suscripción por
// vencer pronto (o sin suscripción todavía) y la renueva. Pensado para
// correr cada pocas horas desde main.go — ver ese archivo.
func (h *GoogleIntegrationHandler) RenewExpiringInventoryWatches() {
	var agents []models.Agent
	soon := time.Now().Add(24 * time.Hour)
	err := config.DB.
		Where("inventory_sheet_connected = ? AND (inventory_watch_expires_at IS NULL OR inventory_watch_expires_at < ?)", true, soon).
		Find(&agents).Error
	if err != nil {
		log.Printf("❌ renovación de suscripciones de inventario: error consultando agentes: %v", err)
		return
	}
	for i := range agents {
		if err := h.ensureInventoryWatch(&agents[i]); err != nil {
			log.Printf("⚠️  [Agent %d] no se pudo renovar la suscripción de Drive: %v", agents[i].ID, err)
		}
	}
}

// BulkUpdateInventoryFromFile — POST /api/inventory-sheets/bulk-update/:agent_id
// multipart/form-data: file=<archivo .xlsx>
// Compara el archivo contra la hoja por VIN: actualiza lo que coincide,
// agrega lo nuevo, y marca en verde (solo esa celda) lo agregado en esta
// corrida en la columna de nuevas llegadas. Lo que ya no aparece en el
// archivo no se toca — no hay marca de "vendido" en este flujo.
func (h *GoogleIntegrationHandler) BulkUpdateInventoryFromFile(c *gin.Context) {
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
	if agent.InventoryVinColumn == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Primero configura cuál es la columna de VIN"})
		return
	}

	fileHeader, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No se recibió ningún archivo"})
		return
	}
	if !strings.HasSuffix(strings.ToLower(fileHeader.Filename), ".xlsx") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Por ahora solo se admite Excel (.xlsx). PDF todavía no está soportado."})
		return
	}

	f, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No se pudo abrir el archivo"})
		return
	}
	fileBytes, err := io.ReadAll(f)
	f.Close()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No se pudo leer el archivo"})
		return
	}

	headers, rows, err := services.ParseXLSXRows(fileBytes)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx := context.Background()
	result, err := h.sheetsService.BulkUpdateInventoryFromFile(
		ctx, agent.GoogleToken, agent.InventorySheetID,
		headers, rows,
		agent.InventoryVinColumn, agent.InventoryNewArrivalColumn,
	)
	if err != nil {
		log.Printf("❌ [Agent %d] bulk-update: %v", agent.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	log.Printf("✅ [Agent %d] bulk-update: %d actualizados, %d agregados, %d nuevas llegadas",
		agent.ID, result.Updated, result.Added, result.NewArrivals)

	c.JSON(http.StatusOK, result)
}
