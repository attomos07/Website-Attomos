package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	"google.golang.org/api/drive/v3"
	"google.golang.org/api/googleapi"
	"google.golang.org/api/option"
	"google.golang.org/api/sheets/v4"
)

// =============================================================================
// SUBIDA DE FOTOS A UNA FILA CONOCIDA (sin IA — la fila ya se sabe de
// antemano porque el usuario le dio clic a esa celda puntual).
//
// Mismo esquema de carpetas que el Apps Script del cliente:
//   "Fotos Inventario (Sheets)" (raíz) > subcarpeta por unidad
// Las columnas donde se escribe el resultado (=IMAGE / =HYPERLINK) son las
// que el usuario haya configurado — nunca asumidas por nombre.
// =============================================================================

const inventoryDriveFolderName = "Fotos Inventario (Sheets)"

// UploadedPhoto es una foto ya leída en memoria, lista para subir.
type UploadedPhoto struct {
	Bytes    []byte
	FileName string
	MimeType string
}

// UploadPhotosResult es lo que se le devuelve al frontend tras subir.
type UploadPhotosResult struct {
	Row       int    `json:"row"`
	Count     int    `json:"count"`
	FolderURL string `json:"folderUrl"`
	FirstURL  string `json:"firstPhotoUrl"`
}

func (s *GoogleSheetsService) createDriveService(ctx context.Context, tokenJSON string) (*drive.Service, error) {
	var token oauth2.Token
	if err := json.Unmarshal([]byte(tokenJSON), &token); err != nil {
		return nil, fmt.Errorf("error parsing token: %w", err)
	}
	cfg := &oauth2.Config{
		ClientID:     s.ClientID,
		ClientSecret: s.ClientSecret,
		RedirectURL:  s.RedirectURL,
		Scopes:       []string{"https://www.googleapis.com/auth/drive.file"},
		Endpoint:     google.Endpoint,
	}
	client := cfg.Client(ctx, &token)
	service, err := drive.NewService(ctx, option.WithHTTPClient(client))
	if err != nil {
		return nil, fmt.Errorf("error creando servicio Drive: %w", err)
	}
	return service, nil
}

func getOrCreateDriveFolder(driveService *drive.Service, name, parentID string) (*drive.File, error) {
	q := fmt.Sprintf("name = '%s' and mimeType = 'application/vnd.google-apps.folder' and trashed = false", escapeDriveQuery(name))
	if parentID != "" {
		q += fmt.Sprintf(" and '%s' in parents", parentID)
	}
	res, err := driveService.Files.List().Q(q).Fields("files(id, name, webViewLink)").Do()
	if err != nil {
		return nil, fmt.Errorf("error buscando carpeta en Drive: %w", err)
	}
	if len(res.Files) > 0 {
		return res.Files[0], nil
	}

	folder := &drive.File{Name: name, MimeType: "application/vnd.google-apps.folder"}
	if parentID != "" {
		folder.Parents = []string{parentID}
	}
	created, err := driveService.Files.Create(folder).Fields("id, name, webViewLink").Do()
	if err != nil {
		return nil, fmt.Errorf("error creando carpeta en Drive: %w", err)
	}
	return created, nil
}

func escapeDriveQuery(s string) string {
	return strings.ReplaceAll(s, "'", "\\'")
}

func inventoryColumnLetter(index int) string {
	n := index + 1
	letter := ""
	for n > 0 {
		rem := (n - 1) % 26
		letter = string(rune('A'+rem)) + letter
		n = (n - 1) / 26
	}
	return letter
}

func indexOfHeader(headers []interface{}, name string) int {
	for i, h := range headers {
		if strings.TrimSpace(fmt.Sprintf("%v", h)) == name {
			return i
		}
	}
	return -1
}

// UploadPhotosToRow sube una o varias fotos a Drive para una fila YA
// CONOCIDA (no requiere detección de VIN por IA) y escribe las fórmulas
// resultantes en las columnas de Foto/Álbum configuradas por el usuario.
func (s *GoogleSheetsService) UploadPhotosToRow(
	ctx context.Context,
	tokenJSON, spreadsheetID string,
	rowNumber int,
	photoColumn, albumColumn string,
	folderLabel string,
	photos []UploadedPhoto,
) (*UploadPhotosResult, error) {
	if len(photos) == 0 {
		return nil, fmt.Errorf("no se recibió ninguna foto")
	}
	if photoColumn == "" {
		return nil, fmt.Errorf("no se ha configurado la columna de fotos")
	}

	sheetsSvc, err := s.CreateSheetsService(ctx, tokenJSON)
	if err != nil {
		return nil, err
	}
	driveSvc, err := s.createDriveService(ctx, tokenJSON)
	if err != nil {
		return nil, err
	}

	sheetTitle, err := s.getFirstSheetTitle(ctx, tokenJSON, spreadsheetID)
	if err != nil {
		return nil, err
	}

	headerResp, err := sheetsSvc.Spreadsheets.Values.Get(spreadsheetID, fmt.Sprintf("'%s'!A1:Z1", sheetTitle)).Do()
	if err != nil {
		return nil, fmt.Errorf("error leyendo encabezados: %w", err)
	}
	if len(headerResp.Values) == 0 {
		return nil, fmt.Errorf("la hoja no tiene encabezados")
	}
	headers := headerResp.Values[0]

	photoColIdx := indexOfHeader(headers, photoColumn)
	if photoColIdx == -1 {
		return nil, fmt.Errorf("no se encontró la columna de fotos configurada (%s)", photoColumn)
	}
	albumColIdx := -1
	if albumColumn != "" {
		albumColIdx = indexOfHeader(headers, albumColumn)
	}

	rootFolder, err := getOrCreateDriveFolder(driveSvc, inventoryDriveFolderName, "")
	if err != nil {
		return nil, err
	}
	subfolder, err := getOrCreateDriveFolder(driveSvc, folderLabel, rootFolder.Id)
	if err != nil {
		return nil, err
	}

	var firstURL string
	for i, p := range photos {
		file := &drive.File{Name: p.FileName, Parents: []string{subfolder.Id}}
		created, err := driveSvc.Files.Create(file).
			Media(bytes.NewReader(p.Bytes), googleapi.ContentType(p.MimeType)).
			Fields("id").Do()
		if err != nil {
			return nil, fmt.Errorf("error subiendo foto a Drive: %w", err)
		}
		if _, err := driveSvc.Permissions.Create(created.Id, &drive.Permission{Type: "anyone", Role: "reader"}).Do(); err != nil {
			return nil, fmt.Errorf("error compartiendo foto: %w", err)
		}
		if i == 0 {
			firstURL = "https://drive.google.com/uc?id=" + created.Id
		}
	}

	photoCell := fmt.Sprintf("'%s'!%s%d", sheetTitle, inventoryColumnLetter(photoColIdx), rowNumber)
	_, err = sheetsSvc.Spreadsheets.Values.Update(spreadsheetID, photoCell, &sheets.ValueRange{
		Values: [][]interface{}{{fmt.Sprintf(`=IMAGE("%s")`, firstURL)}},
	}).ValueInputOption("USER_ENTERED").Do()
	if err != nil {
		return nil, fmt.Errorf("error escribiendo la foto en la hoja: %w", err)
	}

	folderURL := subfolder.WebViewLink
	if albumColIdx != -1 {
		albumCell := fmt.Sprintf("'%s'!%s%d", sheetTitle, inventoryColumnLetter(albumColIdx), rowNumber)
		label := fmt.Sprintf("Ver fotos (%d)", len(photos))
		_, err = sheetsSvc.Spreadsheets.Values.Update(spreadsheetID, albumCell, &sheets.ValueRange{
			Values: [][]interface{}{{fmt.Sprintf(`=HYPERLINK("%s","%s")`, folderURL, label)}},
		}).ValueInputOption("USER_ENTERED").Do()
		if err != nil {
			return nil, fmt.Errorf("error escribiendo el álbum en la hoja: %w", err)
		}
	}

	return &UploadPhotosResult{
		Row:       rowNumber,
		Count:     len(photos),
		FolderURL: folderURL,
		FirstURL:  firstURL,
	}, nil
}
