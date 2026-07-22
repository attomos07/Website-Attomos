package services

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	"google.golang.org/api/sheets/v4"
)

// =============================================================================
// INVENTARIO (visualizador genérico de Google Sheets)
// =============================================================================
//
// Esta integración es para cualquier giro de negocio: NO asume nombres de
// columna ni una plantilla fija (nada de "VIN", "Marca", "Kilometraje"...).
// Simplemente lee la hoja tal cual está — la fila 1 son los encabezados que
// el cliente ya tenga, sean cuales sean, y de ahí para abajo son datos.
//
// Lo único que interpretamos por TIPO de celda (no por nombre de columna):
//   - Fórmula =IMAGE("url")            → se muestra como miniatura
//   - Fórmula =HYPERLINK("url";"texto") → se muestra como link
//   - Checkbox (true/false)            → se muestra como checkbox de SOLO
//     LECTURA (nunca escribimos: no sabemos si esa hoja tiene un Apps Script
//     propio con un trigger onEdit colgado de esa columna, como en el caso
//     de inventarios de autos)
//   - Número                            → alineado a la derecha
//   - Todo lo demás                     → texto tal cual
// =============================================================================

// InventoryCell es una celda ya clasificada, lista para pintar en el frontend.
type InventoryCell struct {
	Kind string `json:"kind"`           // "text" | "number" | "boolean" | "image" | "link"
	Text string `json:"text,omitempty"` // texto a mostrar (o el label del link)
	URL  string `json:"url,omitempty"`  // para "image" y "link"
	Bool bool   `json:"bool,omitempty"` // para "boolean"
}

// InventoryRow es una fila de datos (fila real >= 2 de la hoja).
type InventoryRow struct {
	Row   int             `json:"row"`
	Cells []InventoryCell `json:"cells"`
}

// InventorySheetData es la hoja completa: encabezados tal cual los escribió
// el cliente (en el orden real de sus columnas) + las filas de datos.
type InventorySheetData struct {
	Headers []string       `json:"headers"`
	Rows    []InventoryRow `json:"rows"`
}

var (
	// =IMAGE("https://drive.google.com/uc?id=...")
	invImageFormulaRe = regexp.MustCompile(`(?i)IMAGE\(\s*"([^"]+)"`)
	// =HYPERLINK("https://...";"Ver fotos (12)")  — separador "," o ";" según idioma
	invHyperlinkFormulaRe = regexp.MustCompile(`(?i)HYPERLINK\(\s*"([^"]+)"\s*[,;]\s*"([^"]*)"`)
)

// getFirstSheetTitle obtiene el título de la primera pestaña del spreadsheet
// (no asumimos ningún nombre: cada cliente la puede llamar distinto).
func (s *GoogleSheetsService) getFirstSheetTitle(ctx context.Context, tokenJSON, spreadsheetID string) (string, error) {
	service, err := s.CreateSheetsService(ctx, tokenJSON)
	if err != nil {
		return "", err
	}
	sp, err := service.Spreadsheets.Get(spreadsheetID).Do()
	if err != nil {
		return "", fmt.Errorf("error obteniendo spreadsheet: %w", err)
	}
	if len(sp.Sheets) == 0 {
		return "", fmt.Errorf("el spreadsheet no tiene hojas")
	}
	return sp.Sheets[0].Properties.Title, nil
}

// ValidateSpreadsheetAccess confirma que el token puede leer ese spreadsheet.
// Se usa al conectar, para no guardar un ID inválido o sin permisos.
func (s *GoogleSheetsService) ValidateSpreadsheetAccess(ctx context.Context, tokenJSON, spreadsheetID string) error {
	_, err := s.getFirstSheetTitle(ctx, tokenJSON, spreadsheetID)
	return err
}

// classifyCell decide cómo mostrar una celda según su TIPO real, nunca según
// en qué columna está.
func classifyCell(raw interface{}) InventoryCell {
	switch v := raw.(type) {
	case nil:
		return InventoryCell{Kind: "text", Text: ""}
	case bool:
		return InventoryCell{Kind: "boolean", Bool: v}
	case float64:
		return InventoryCell{Kind: "number", Text: fmt.Sprintf("%v", v)}
	case string:
		if m := invImageFormulaRe.FindStringSubmatch(v); m != nil {
			return InventoryCell{Kind: "image", URL: m[1]}
		}
		if m := invHyperlinkFormulaRe.FindStringSubmatch(v); m != nil {
			return InventoryCell{Kind: "link", URL: m[1], Text: m[2]}
		}
		return InventoryCell{Kind: "text", Text: strings.TrimSpace(v)}
	default:
		return InventoryCell{Kind: "text", Text: strings.TrimSpace(fmt.Sprintf("%v", v))}
	}
}

// GetInventorySheetData lee la hoja completa (encabezados + filas) sin
// asumir ninguna columna en particular. Usa ValueRenderOption("FORMULA")
// porque las celdas con =IMAGE(...) / =HYPERLINK(...) necesitan el texto de
// la fórmula para sacar la URL real — para el resto de celdas (texto,
// números, checkboxes) ese render option no cambia nada.
func (s *GoogleSheetsService) GetInventorySheetData(ctx context.Context, tokenJSON, spreadsheetID string) (*InventorySheetData, error) {
	service, err := s.CreateSheetsService(ctx, tokenJSON)
	if err != nil {
		return nil, err
	}

	sheetTitle, err := s.getFirstSheetTitle(ctx, tokenJSON, spreadsheetID)
	if err != nil {
		return nil, err
	}
	rangeName := fmt.Sprintf("'%s'!A1:Z2000", sheetTitle)

	resp, err := service.Spreadsheets.Values.Get(spreadsheetID, rangeName).
		ValueRenderOption("FORMULA").Do()
	if err != nil {
		return nil, fmt.Errorf("error leyendo la hoja: %w", err)
	}
	if len(resp.Values) == 0 {
		return &InventorySheetData{Headers: []string{}, Rows: []InventoryRow{}}, nil
	}

	headers := make([]string, len(resp.Values[0]))
	for i, h := range resp.Values[0] {
		headers[i] = strings.TrimSpace(fmt.Sprintf("%v", h))
	}
	numCols := len(headers)

	rows := []InventoryRow{}
	for i := 1; i < len(resp.Values); i++ {
		raw := resp.Values[i]
		if rowIsBlank(raw) {
			continue // separador vacío en la hoja: se ignora
		}

		cells := make([]InventoryCell, numCols)
		for c := 0; c < numCols; c++ {
			if c < len(raw) {
				cells[c] = classifyCell(raw[c])
			} else {
				cells[c] = InventoryCell{Kind: "text", Text: ""}
			}
		}

		rows = append(rows, InventoryRow{
			Row:   i + 1, // fila 1 = encabezados, la primera fila de datos es la 2
			Cells: cells,
		})
	}

	return &InventorySheetData{Headers: headers, Rows: rows}, nil
}

func rowIsBlank(row []interface{}) bool {
	for _, v := range row {
		if v != nil && strings.TrimSpace(fmt.Sprintf("%v", v)) != "" {
			return false
		}
	}
	return true
}

// UpdateCellValue edita una celda de datos (texto/número) y lo refleja
// directo en la hoja real. Se ubica la columna por el texto del encabezado,
// nunca por posición fija. USER_ENTERED para que Sheets interprete el valor
// igual que si el usuario lo hubiera tecleado ahí mismo (números, %, etc.).
//
// A propósito NO se usa para columnas de tipo checkbox/fórmula: esas se
// manejan aparte (el checkbox se deja de solo lectura por el riesgo de
// disparar triggers propios del cliente; Foto/Álbum se manejan vía el flujo
// de subida de fotos, no edición directa de texto).
func (s *GoogleSheetsService) UpdateCellValue(ctx context.Context, tokenJSON, spreadsheetID string, rowNumber int, columnHeader, value string) error {
	sheetsSvc, err := s.CreateSheetsService(ctx, tokenJSON)
	if err != nil {
		return err
	}

	sheetTitle, err := s.getFirstSheetTitle(ctx, tokenJSON, spreadsheetID)
	if err != nil {
		return err
	}

	headerResp, err := sheetsSvc.Spreadsheets.Values.Get(spreadsheetID, fmt.Sprintf("'%s'!A1:Z1", sheetTitle)).Do()
	if err != nil {
		return fmt.Errorf("error leyendo encabezados: %w", err)
	}
	if len(headerResp.Values) == 0 {
		return fmt.Errorf("la hoja no tiene encabezados")
	}

	colIdx := indexOfHeader(headerResp.Values[0], columnHeader)
	if colIdx == -1 {
		return fmt.Errorf("no se encontró la columna %q", columnHeader)
	}

	cellRange := fmt.Sprintf("'%s'!%s%d", sheetTitle, inventoryColumnLetter(colIdx), rowNumber)
	_, err = sheetsSvc.Spreadsheets.Values.Update(spreadsheetID, cellRange, &sheets.ValueRange{
		Values: [][]interface{}{{value}},
	}).ValueInputOption("USER_ENTERED").Do()
	if err != nil {
		return fmt.Errorf("error escribiendo en la hoja: %w", err)
	}

	return nil
}
