package handlers

import (
	"context"
	"fmt"
	"io"
	"net/http"
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
		PhotoColumn string `json:"photo_column"`
		AlbumColumn string `json:"album_column"`
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

	if err := config.DB.Save(agent).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "No se pudo guardar la configuración"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"photo_column": agent.InventoryPhotoColumn,
		"album_column": agent.InventoryAlbumColumn,
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
	result, err := h.sheetsService.UploadPhotosToRow(
		ctx, agent.GoogleToken, agent.InventorySheetID,
		rowNumber, agent.InventoryPhotoColumn, agent.InventoryAlbumColumn,
		folderLabel, photos,
	)
	if err != nil {
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
