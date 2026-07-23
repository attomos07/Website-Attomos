package services

import (
	"bytes"
	"context"
	"fmt"
	"strings"

	"github.com/xuri/excelize/v2"
	"google.golang.org/api/sheets/v4"
)

// =============================================================================
// ACTUALIZAR DESDE ARCHIVO (Excel) — mismo comportamiento que el botón
// "Actualizar desde archivo (Excel/PDF)" que el cliente ya tenía en su Apps
// Script, pero disparado desde Attomos y con columnas configurables (no
// asumimos VIN/Estatus en una posición fija — cada cliente elige las suyas).
//
// PDF no está soportado aquí todavía: el Apps Script lo resuelve gratis
// convirtiendo el PDF a Google Doc con OCR vía Drive; replicar eso en Go
// necesitaría un servicio de OCR aparte.
// =============================================================================

// ParseXLSXRows lee un archivo .xlsx y regresa sus encabezados (fila 1) y
// las filas de datos como texto plano.
func ParseXLSXRows(fileBytes []byte) ([]string, [][]string, error) {
	f, err := excelize.OpenReader(bytes.NewReader(fileBytes))
	if err != nil {
		return nil, nil, fmt.Errorf("no se pudo abrir el archivo Excel: %w", err)
	}
	defer f.Close()

	sheetName := f.GetSheetName(0)
	if sheetName == "" {
		return nil, nil, fmt.Errorf("el archivo no tiene hojas")
	}

	grid, err := f.GetRows(sheetName)
	if err != nil {
		return nil, nil, fmt.Errorf("error leyendo el archivo Excel: %w", err)
	}
	if len(grid) < 1 {
		return nil, nil, fmt.Errorf("el archivo está vacío")
	}

	headers := grid[0]
	var rows [][]string
	if len(grid) > 1 {
		rows = grid[1:]
	}
	return headers, rows, nil
}

// BulkUpdateResult resume lo que pasó al comparar el archivo contra la hoja.
type BulkUpdateResult struct {
	Updated     int `json:"updated"`
	Added       int `json:"added"`
	NewArrivals int `json:"newArrivals"`
}

func (s *GoogleSheetsService) getSheetIDAndTitle(ctx context.Context, tokenJSON, spreadsheetID string) (int64, string, error) {
	svc, err := s.CreateSheetsService(ctx, tokenJSON)
	if err != nil {
		return 0, "", err
	}
	sp, err := svc.Spreadsheets.Get(spreadsheetID).Do()
	if err != nil {
		return 0, "", fmt.Errorf("error obteniendo spreadsheet: %w", err)
	}
	if len(sp.Sheets) == 0 {
		return 0, "", fmt.Errorf("el spreadsheet no tiene hojas")
	}
	return sp.Sheets[0].Properties.SheetId, sp.Sheets[0].Properties.Title, nil
}

// BulkUpdateInventoryFromFile compara un archivo (ya parseado) contra la hoja
// conectada, usando vinColumn para identificar cada fila:
//   - VIN que ya existía   -> actualiza esa fila con los valores del archivo
//     (solo las columnas que el archivo también trae; lo demás no se toca).
//   - VIN nuevo             -> se agrega como fila nueva al final.
//   - VIN que ya no aparece -> no se toca. No hay ningún estatus/marca de
//     "vendido" en este flujo.
//
// Si hay columna de "nuevas llegadas" configurada: se limpia esa columna
// completa primero, y solo las filas agregadas en ESTA corrida se marcan en
// verde — igual que en el Apps Script.
func (s *GoogleSheetsService) BulkUpdateInventoryFromFile(
	ctx context.Context, tokenJSON, spreadsheetID string,
	uploadedHeaders []string, uploadedRows [][]string,
	vinColumn, newArrivalColumn string,
) (*BulkUpdateResult, error) {
	if vinColumn == "" {
		return nil, fmt.Errorf("no se ha configurado la columna de VIN")
	}

	svc, err := s.CreateSheetsService(ctx, tokenJSON)
	if err != nil {
		return nil, err
	}
	sheetID, sheetTitle, err := s.getSheetIDAndTitle(ctx, tokenJSON, spreadsheetID)
	if err != nil {
		return nil, err
	}

	current, err := s.GetInventorySheetData(ctx, tokenJSON, spreadsheetID)
	if err != nil {
		return nil, err
	}

	destColIdx := map[string]int{}
	for i, h := range current.Headers {
		destColIdx[h] = i
	}
	vinDestIdx, ok := destColIdx[vinColumn]
	if !ok {
		return nil, fmt.Errorf("la hoja no tiene la columna de VIN configurada (%s)", vinColumn)
	}

	vinToRow := map[string]int{}
	for _, row := range current.Rows {
		if vinDestIdx < len(row.Cells) {
			vin := strings.ToUpper(strings.TrimSpace(row.Cells[vinDestIdx].Text))
			if vin != "" {
				vinToRow[vin] = row.Row
			}
		}
	}

	uploadedColIdx := map[string]int{}
	for i, h := range uploadedHeaders {
		uploadedColIdx[strings.TrimSpace(h)] = i
	}
	vinUploadIdx, ok := uploadedColIdx[vinColumn]
	if !ok {
		return nil, fmt.Errorf("el archivo no tiene una columna llamada \"%s\"", vinColumn)
	}

	getUploaded := func(row []string, header string) string {
		idx, ok := uploadedColIdx[header]
		if !ok || idx >= len(row) {
			return ""
		}
		return strings.TrimSpace(row[idx])
	}

	var cellUpdates []*sheets.ValueRange
	var appendRows [][]interface{}
	updated, added := 0, 0

	for _, row := range uploadedRows {
		if vinUploadIdx >= len(row) {
			continue
		}
		vin := strings.ToUpper(strings.TrimSpace(row[vinUploadIdx]))
		if vin == "" {
			continue
		}

		if destRow, exists := vinToRow[vin]; exists {
			for _, h := range uploadedHeaders {
				h = strings.TrimSpace(h)
				if h == "" || h == vinColumn {
					continue
				}
				destIdx, ok := destColIdx[h]
				if !ok {
					continue // esa columna del archivo no existe en la hoja destino, se ignora
				}
				val := getUploaded(row, h)
				if val == "" {
					continue // no pisa con vacío lo que ya había
				}
				cellUpdates = append(cellUpdates, &sheets.ValueRange{
					Range:  fmt.Sprintf("'%s'!%s%d", sheetTitle, inventoryColumnLetter(destIdx), destRow),
					Values: [][]interface{}{{val}},
				})
			}
			updated++
		} else {
			newRow := make([]interface{}, len(current.Headers))
			for i, h := range current.Headers {
				newRow[i] = getUploaded(row, h)
			}
			appendRows = append(appendRows, newRow)
			added++
		}
	}

	if len(cellUpdates) > 0 {
		if _, err := svc.Spreadsheets.Values.BatchUpdate(spreadsheetID, &sheets.BatchUpdateValuesRequest{
			ValueInputOption: "USER_ENTERED",
			Data:             cellUpdates,
		}).Do(); err != nil {
			return nil, fmt.Errorf("error actualizando filas existentes: %w", err)
		}
	}

	firstNewRow := 0
	if len(appendRows) > 0 {
		lastRowBefore := 1
		if len(current.Rows) > 0 {
			lastRowBefore = current.Rows[len(current.Rows)-1].Row
		}
		firstNewRow = lastRowBefore + 1
		if _, err := svc.Spreadsheets.Values.Update(
			spreadsheetID, fmt.Sprintf("'%s'!A%d", sheetTitle, firstNewRow),
			&sheets.ValueRange{Values: appendRows},
		).ValueInputOption("USER_ENTERED").Do(); err != nil {
			return nil, fmt.Errorf("error agregando filas nuevas: %w", err)
		}
	}

	newArrivals := 0
	if newArrivalColumn != "" {
		newArrivals, err = s.markNewArrivalsInSheet(svc, spreadsheetID, sheetID, sheetTitle, current.Headers, newArrivalColumn, firstNewRow, len(appendRows))
		if err != nil {
			return nil, err
		}
	}

	return &BulkUpdateResult{Updated: updated, Added: added, NewArrivals: newArrivals}, nil
}

// markNewArrivalsInSheet limpia (texto + color) toda la columna de nuevas
// llegadas y marca en verde solo el rango de filas nuevas indicado — mismo
// criterio que el menú de Apps Script: la marca de la corrida anterior
// desaparece cada vez que se vuelve a subir un archivo.
func (s *GoogleSheetsService) markNewArrivalsInSheet(
	svc *sheets.Service, spreadsheetID string, sheetID int64, sheetTitle string,
	headers []string, columnHeader string, firstNewRow, newRowCount int,
) (int, error) {
	colIdx := -1
	for i, h := range headers {
		if h == columnHeader {
			colIdx = i
			break
		}
	}
	if colIdx == -1 {
		return 0, nil // la columna no existe todavía en la hoja destino
	}

	colData, err := svc.Spreadsheets.Values.Get(spreadsheetID, fmt.Sprintf("'%s'!A:A", sheetTitle)).Do()
	if err != nil {
		return 0, fmt.Errorf("error leyendo el largo de la hoja: %w", err)
	}
	totalRows := len(colData.Values)
	if totalRows < 2 {
		return 0, nil
	}

	requests := []*sheets.Request{
		{ // 1) Limpia toda la columna (texto + color de fondo)
			RepeatCell: &sheets.RepeatCellRequest{
				Range: &sheets.GridRange{
					SheetId:          sheetID,
					StartRowIndex:    1,
					EndRowIndex:      int64(totalRows),
					StartColumnIndex: int64(colIdx),
					EndColumnIndex:   int64(colIdx + 1),
				},
				Cell: &sheets.CellData{
					UserEnteredValue:  &sheets.ExtendedValue{StringValue: strPtr("")},
					UserEnteredFormat: &sheets.CellFormat{BackgroundColor: &sheets.Color{Red: 1, Green: 1, Blue: 1}},
				},
				Fields: "userEnteredValue,userEnteredFormat.backgroundColor",
			},
		},
	}

	if newRowCount > 0 && firstNewRow > 0 {
		requests = append(requests, &sheets.Request{
			RepeatCell: &sheets.RepeatCellRequest{
				Range: &sheets.GridRange{
					SheetId:          sheetID,
					StartRowIndex:    int64(firstNewRow - 1),
					EndRowIndex:      int64(firstNewRow - 1 + newRowCount),
					StartColumnIndex: int64(colIdx),
					EndColumnIndex:   int64(colIdx + 1),
				},
				Cell: &sheets.CellData{
					UserEnteredValue:  &sheets.ExtendedValue{StringValue: strPtr("Nueva llegada")},
					UserEnteredFormat: &sheets.CellFormat{BackgroundColor: &sheets.Color{Red: 0.85, Green: 0.92, Blue: 0.83}}, // verde claro (mismo tono que #d9ead3)
				},
				Fields: "userEnteredValue,userEnteredFormat.backgroundColor",
			},
		})
	}

	if _, err := svc.Spreadsheets.BatchUpdate(spreadsheetID, &sheets.BatchUpdateSpreadsheetRequest{Requests: requests}).Do(); err != nil {
		return 0, fmt.Errorf("error marcando nuevas llegadas: %w", err)
	}

	return newRowCount, nil
}

func strPtr(s string) *string { return &s }
