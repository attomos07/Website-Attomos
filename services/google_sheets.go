package services

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	"google.golang.org/api/calendar/v3"
	"google.golang.org/api/option"
	"google.golang.org/api/sheets/v4"
)

type GoogleSheetsService struct {
	ClientID     string
	ClientSecret string
	RedirectURL  string
}

// GetOAuthConfig retorna la configuración de OAuth2 para Google Sheets y Calendar
func (s *GoogleSheetsService) GetOAuthConfig() *oauth2.Config {
	return &oauth2.Config{
		ClientID:     s.ClientID,
		ClientSecret: s.ClientSecret,
		RedirectURL:  s.RedirectURL,
		Scopes: []string{
			sheets.SpreadsheetsScope, // Acceso completo a Sheets
			calendar.CalendarScope,   // Acceso completo a Calendar
		},
		Endpoint: google.Endpoint,
	}
}

// GetAuthURL genera la URL de autorización de Google
func (s *GoogleSheetsService) GetAuthURL(state string) string {
	config := s.GetOAuthConfig()
	return config.AuthCodeURL(state, oauth2.AccessTypeOffline, oauth2.ApprovalForce)
}

// ExchangeCode intercambia el código de autorización por tokens
func (s *GoogleSheetsService) ExchangeCode(ctx context.Context, code string) (*oauth2.Token, error) {
	config := s.GetOAuthConfig()
	token, err := config.Exchange(ctx, code)
	if err != nil {
		return nil, fmt.Errorf("error exchanging code: %w", err)
	}
	return token, nil
}

// CreateSheetsService crea un servicio de Sheets con los tokens del usuario
func (s *GoogleSheetsService) CreateSheetsService(ctx context.Context, tokenJSON string) (*sheets.Service, error) {
	var token oauth2.Token
	if err := json.Unmarshal([]byte(tokenJSON), &token); err != nil {
		return nil, fmt.Errorf("error parsing token: %w", err)
	}

	config := s.GetOAuthConfig()
	client := config.Client(ctx, &token)

	service, err := sheets.NewService(ctx, option.WithHTTPClient(client))
	if err != nil {
		return nil, fmt.Errorf("error creating sheets service: %w", err)
	}

	return service, nil
}

// CreateSpreadsheet crea una nueva hoja de cálculo para el agente con formato de calendario semanal
func (s *GoogleSheetsService) CreateSpreadsheet(ctx context.Context, tokenJSON, agentName string, schedule Schedule) (string, error) {
	service, err := s.CreateSheetsService(ctx, tokenJSON)
	if err != nil {
		return "", err
	}

	spreadsheetTitle := fmt.Sprintf("Attomos - Citas de %s", agentName)

	spreadsheet := &sheets.Spreadsheet{
		Properties: &sheets.SpreadsheetProperties{
			Title:    spreadsheetTitle,
			TimeZone: "America/Mexico_City",
			Locale:   "es_MX",
		},
		Sheets: []*sheets.Sheet{
			{
				Properties: &sheets.SheetProperties{
					Title: "Calendario",
					GridProperties: &sheets.GridProperties{
						FrozenRowCount:    1,
						FrozenColumnCount: 1,
					},
				},
			},
		},
	}

	created, err := service.Spreadsheets.Create(spreadsheet).Do()
	if err != nil {
		return "", fmt.Errorf("error creating spreadsheet: %w", err)
	}

	// Configurar el calendario semanal con los horarios del agente
	err = s.SetupWeeklyCalendar(ctx, tokenJSON, created.SpreadsheetId, schedule)
	if err != nil {
		return "", fmt.Errorf("error setting up weekly calendar: %w", err)
	}

	return created.SpreadsheetId, nil
}

// SetupWeeklyCalendar configura el formato de calendario semanal usando los horarios del agente
func (s *GoogleSheetsService) SetupWeeklyCalendar(ctx context.Context, tokenJSON, spreadsheetID string, schedule Schedule) error {
	service, err := s.CreateSheetsService(ctx, tokenJSON)
	if err != nil {
		return err
	}

	// Obtener el spreadsheet para conseguir el sheetId correcto
	spreadsheet, err := service.Spreadsheets.Get(spreadsheetID).Do()
	if err != nil {
		return fmt.Errorf("error getting spreadsheet: %w", err)
	}

	if len(spreadsheet.Sheets) == 0 {
		return fmt.Errorf("spreadsheet has no sheets")
	}

	sheetId := spreadsheet.Sheets[0].Properties.SheetId

	// PASO 1: Configurar encabezados (Hora y días de la semana)
	headers := []interface{}{
		"Hora",
		"Lunes",
		"Martes",
		"Miércoles",
		"Jueves",
		"Viernes",
		"Sábado",
		"Domingo",
	}

	headerRange := &sheets.ValueRange{
		Values: [][]interface{}{headers},
	}

	_, err = service.Spreadsheets.Values.Update(
		spreadsheetID,
		"Calendario!A1:H1",
		headerRange,
	).ValueInputOption("RAW").Do()

	if err != nil {
		return fmt.Errorf("error updating headers: %w", err)
	}

	// PASO 2: Determinar horarios basados en el schedule del agente
	startHour, endHour := getBusinessHours(schedule)

	log.Printf("📅 Configurando calendario con horarios: %d:00 - %d:00", startHour, endHour)

	timeSlots := [][]interface{}{}
	for hour := startHour; hour <= endHour; hour++ {
		var timeStr string
		if hour < 12 {
			timeStr = fmt.Sprintf("%d:00 AM", hour)
		} else if hour == 12 {
			timeStr = "12:00 PM"
		} else {
			timeStr = fmt.Sprintf("%d:00 PM", hour-12)
		}
		timeSlots = append(timeSlots, []interface{}{timeStr})
	}

	// Calcular la última fila basada en la cantidad de horarios
	lastRow := 1 + len(timeSlots)
	rangeName := fmt.Sprintf("Calendario!A2:A%d", lastRow)

	timeSlotsRange := &sheets.ValueRange{
		Values: timeSlots,
	}

	_, err = service.Spreadsheets.Values.Update(
		spreadsheetID,
		rangeName,
		timeSlotsRange,
	).ValueInputOption("RAW").Do()

	if err != nil {
		return fmt.Errorf("error updating time slots: %w", err)
	}

	// PASO 3: Aplicar formato
	requests := []*sheets.Request{
		// Formato de encabezados (negrita y fondo gris)
		{
			RepeatCell: &sheets.RepeatCellRequest{
				Range: &sheets.GridRange{
					SheetId:       sheetId,
					StartRowIndex: 0,
					EndRowIndex:   1,
				},
				Cell: &sheets.CellData{
					UserEnteredFormat: &sheets.CellFormat{
						BackgroundColor: &sheets.Color{
							Red:   0.9,
							Green: 0.9,
							Blue:  0.9,
						},
						TextFormat: &sheets.TextFormat{
							Bold:     true,
							FontSize: 11,
						},
						HorizontalAlignment: "CENTER",
						VerticalAlignment:   "MIDDLE",
					},
				},
				Fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)",
			},
		},
		// Formato de columna de horas (negrita) - SOLO hasta la última fila de horarios
		{
			RepeatCell: &sheets.RepeatCellRequest{
				Range: &sheets.GridRange{
					SheetId:          sheetId,
					StartRowIndex:    1,
					EndRowIndex:      int64(lastRow), // ✅ FIX: Solo hasta la última fila de horarios
					StartColumnIndex: 0,
					EndColumnIndex:   1,
				},
				Cell: &sheets.CellData{
					UserEnteredFormat: &sheets.CellFormat{
						BackgroundColor: &sheets.Color{
							Red:   0.95,
							Green: 0.95,
							Blue:  0.95,
						},
						TextFormat: &sheets.TextFormat{
							Bold:     true,
							FontSize: 10,
						},
						HorizontalAlignment: "CENTER",
						VerticalAlignment:   "MIDDLE",
					},
				},
				Fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)",
			},
		},
		// Ajustar ancho de columnas
		{
			UpdateDimensionProperties: &sheets.UpdateDimensionPropertiesRequest{
				Range: &sheets.DimensionRange{
					SheetId:    sheetId,
					Dimension:  "COLUMNS",
					StartIndex: 0,
					EndIndex:   1, // Columna A (Hora)
				},
				Properties: &sheets.DimensionProperties{
					PixelSize: 100,
				},
				Fields: "pixelSize",
			},
		},
		{
			UpdateDimensionProperties: &sheets.UpdateDimensionPropertiesRequest{
				Range: &sheets.DimensionRange{
					SheetId:    sheetId,
					Dimension:  "COLUMNS",
					StartIndex: 1,
					EndIndex:   8, // Columnas B-H (días)
				},
				Properties: &sheets.DimensionProperties{
					PixelSize: 180,
				},
				Fields: "pixelSize",
			},
		},
		// Ajustar altura de filas - dinámico basado en horarios
		{
			UpdateDimensionProperties: &sheets.UpdateDimensionPropertiesRequest{
				Range: &sheets.DimensionRange{
					SheetId:    sheetId,
					Dimension:  "ROWS",
					StartIndex: 1,
					EndIndex:   int64(lastRow), // ✅ Dinámico
				},
				Properties: &sheets.DimensionProperties{
					PixelSize: 100,
				},
				Fields: "pixelSize",
			},
		},
		// Bordes para toda la tabla - dinámico basado en horarios
		{
			UpdateBorders: &sheets.UpdateBordersRequest{
				Range: &sheets.GridRange{
					SheetId:          sheetId,
					StartRowIndex:    0,
					EndRowIndex:      int64(lastRow), // ✅ Dinámico
					StartColumnIndex: 0,
					EndColumnIndex:   8,
				},
				Top: &sheets.Border{
					Style: "SOLID",
					Width: 1,
					Color: &sheets.Color{Red: 0.8, Green: 0.8, Blue: 0.8},
				},
				Bottom: &sheets.Border{
					Style: "SOLID",
					Width: 1,
					Color: &sheets.Color{Red: 0.8, Green: 0.8, Blue: 0.8},
				},
				Left: &sheets.Border{
					Style: "SOLID",
					Width: 1,
					Color: &sheets.Color{Red: 0.8, Green: 0.8, Blue: 0.8},
				},
				Right: &sheets.Border{
					Style: "SOLID",
					Width: 1,
					Color: &sheets.Color{Red: 0.8, Green: 0.8, Blue: 0.8},
				},
				InnerHorizontal: &sheets.Border{
					Style: "SOLID",
					Width: 1,
					Color: &sheets.Color{Red: 0.9, Green: 0.9, Blue: 0.9},
				},
				InnerVertical: &sheets.Border{
					Style: "SOLID",
					Width: 1,
					Color: &sheets.Color{Red: 0.9, Green: 0.9, Blue: 0.9},
				},
			},
		},
		// Alineación vertical en el medio para celdas de datos - SOLO celdas de días
		{
			RepeatCell: &sheets.RepeatCellRequest{
				Range: &sheets.GridRange{
					SheetId:          sheetId,
					StartRowIndex:    1,
					EndRowIndex:      int64(lastRow), // ✅ FIX: Solo hasta la última fila de horarios
					StartColumnIndex: 1,
					EndColumnIndex:   8,
				},
				Cell: &sheets.CellData{
					UserEnteredFormat: &sheets.CellFormat{
						VerticalAlignment:   "TOP",
						HorizontalAlignment: "LEFT",
						WrapStrategy:        "WRAP",
					},
				},
				Fields: "userEnteredFormat(verticalAlignment,horizontalAlignment,wrapStrategy)",
			},
		},
	}

	batchUpdate := &sheets.BatchUpdateSpreadsheetRequest{
		Requests: requests,
	}

	_, err = service.Spreadsheets.BatchUpdate(spreadsheetID, batchUpdate).Do()
	if err != nil {
		return fmt.Errorf("error formatting calendar: %w", err)
	}

	log.Printf("✅ Calendario configurado con %d horarios (%d:00 - %d:00)", len(timeSlots), startHour, endHour)
	return nil
}

// getBusinessHours determina los horarios de negocio basándose en el schedule del agente
func getBusinessHours(schedule Schedule) (int, int) {
	// Por defecto 9 AM - 7 PM
	startHour := 9
	endHour := 19

	// Revisar todos los días para encontrar el horario más amplio
	days := []DaySchedule{
		schedule.Monday,
		schedule.Tuesday,
		schedule.Wednesday,
		schedule.Thursday,
		schedule.Friday,
		schedule.Saturday,
		schedule.Sunday,
	}

	for _, day := range days {
		if day.Open && day.Start != "" && day.End != "" {
			// Parsear hora de inicio
			var startH int
			fmt.Sscanf(day.Start, "%d:", &startH)
			if startH > 0 && startH < startHour {
				startHour = startH
			}

			// Parsear hora de cierre
			var endH int
			fmt.Sscanf(day.End, "%d:", &endH)
			if endH > endHour {
				endHour = endH
			}
		}
	}

	// Asegurar que sea un rango válido
	if startHour >= endHour {
		startHour = 9
		endHour = 19
	}

	return startHour, endHour
}

// AddAppointment agrega una nueva cita a la hoja de calendario
func (s *GoogleSheetsService) AddAppointment(ctx context.Context, tokenJSON, spreadsheetID string, appointment AppointmentData) error {
	service, err := s.CreateSheetsService(ctx, tokenJSON)
	if err != nil {
		return err
	}

	// Parsear la fecha para obtener el día de la semana
	appointmentDate, err := time.Parse("2006-01-02", appointment.Date)
	if err != nil {
		return fmt.Errorf("error parsing date: %w", err)
	}

	// Determinar la columna según el día de la semana
	// Lunes=1, Martes=2, Miércoles=3, Jueves=4, Viernes=5, Sábado=6, Domingo=0
	weekday := int(appointmentDate.Weekday())
	var columnLetter string

	switch weekday {
	case 0: // Domingo
		columnLetter = "H"
	case 1: // Lunes
		columnLetter = "B"
	case 2: // Martes
		columnLetter = "C"
	case 3: // Miércoles
		columnLetter = "D"
	case 4: // Jueves
		columnLetter = "E"
	case 5: // Viernes
		columnLetter = "F"
	case 6: // Sábado
		columnLetter = "G"
	}

	// Parsear la hora para obtener la fila
	appointmentTime, err := time.Parse("15:04", appointment.StartTime)
	if err != nil {
		return fmt.Errorf("error parsing time: %w", err)
	}

	// Determinar la fila según la hora (9:00 AM = fila 2, 10:00 AM = fila 3, etc.)
	hour := appointmentTime.Hour()
	row := hour - 9 + 2 // 9:00 AM está en la fila 2

	if row < 2 || row > 12 {
		return fmt.Errorf("hora fuera del rango del calendario (9:00 AM - 7:00 PM)")
	}

	// Construir el contenido de la celda con emojis e iconos
	cellContent := fmt.Sprintf("👤 %s\n📞 %s\n✂️ %s",
		appointment.ClientName,
		appointment.ClientPhone,
		appointment.Description,
	)

	// Si hay trabajador/barbero, agregarlo
	if appointment.WorkerName != "" {
		cellContent += fmt.Sprintf("\n👨‍💼 Barbero: %s", appointment.WorkerName)
	}

	// Agregar fecha
	cellContent += fmt.Sprintf("\n📅 %s", appointment.Date)

	// Actualizar la celda
	cellRange := fmt.Sprintf("Calendario!%s%d", columnLetter, row)

	valueRange := &sheets.ValueRange{
		Values: [][]interface{}{{cellContent}},
	}

	_, err = service.Spreadsheets.Values.Update(
		spreadsheetID,
		cellRange,
		valueRange,
	).ValueInputOption("RAW").Do()

	if err != nil {
		return fmt.Errorf("error adding appointment to calendar: %w", err)
	}

	// Aplicar color de fondo a la celda para destacarla
	spreadsheet, err := service.Spreadsheets.Get(spreadsheetID).Do()
	if err != nil {
		return fmt.Errorf("error getting spreadsheet: %w", err)
	}

	sheetId := spreadsheet.Sheets[0].Properties.SheetId

	// Convertir letra de columna a índice (B=1, C=2, etc.)
	columnIndex := int(columnLetter[0]) - 'A'

	requests := []*sheets.Request{
		{
			RepeatCell: &sheets.RepeatCellRequest{
				Range: &sheets.GridRange{
					SheetId:          sheetId,
					StartRowIndex:    int64(row - 1),
					EndRowIndex:      int64(row),
					StartColumnIndex: int64(columnIndex),
					EndColumnIndex:   int64(columnIndex + 1),
				},
				Cell: &sheets.CellData{
					UserEnteredFormat: &sheets.CellFormat{
						BackgroundColor: &sheets.Color{
							Red:   0.85,
							Green: 0.95,
							Blue:  1.0,
						},
						TextFormat: &sheets.TextFormat{
							FontSize: 9,
						},
					},
				},
				Fields: "userEnteredFormat(backgroundColor,textFormat)",
			},
		},
	}

	batchUpdate := &sheets.BatchUpdateSpreadsheetRequest{
		Requests: requests,
	}

	_, err = service.Spreadsheets.BatchUpdate(spreadsheetID, batchUpdate).Do()
	if err != nil {
		return fmt.Errorf("error formatting appointment cell: %w", err)
	}

	return nil
}

// UpdateAppointment actualiza una cita existente en la hoja
func (s *GoogleSheetsService) UpdateAppointment(ctx context.Context, tokenJSON, spreadsheetID, eventID string, appointment AppointmentData) error {
	// Por ahora, eliminar la cita anterior y agregar la nueva
	// Esto puede mejorarse con un sistema de búsqueda más robusto
	return s.AddAppointment(ctx, tokenJSON, spreadsheetID, appointment)
}

// DeleteAppointment elimina una cita del calendario (limpia la celda)
func (s *GoogleSheetsService) DeleteAppointment(ctx context.Context, tokenJSON, spreadsheetID, eventID string) error {
	// Buscar la celda que contiene este eventID y limpiarla
	// Por simplicidad, esto requeriría recorrer todas las celdas
	// Por ahora retornamos sin error

	return nil
}

// GetAppointments obtiene todas las citas del calendario
func (s *GoogleSheetsService) GetAppointments(ctx context.Context, tokenJSON, spreadsheetID string) ([]AppointmentData, error) {
	service, err := s.CreateSheetsService(ctx, tokenJSON)
	if err != nil {
		return nil, err
	}

	resp, err := service.Spreadsheets.Values.Get(spreadsheetID, "Calendario!B2:H12").Do()
	if err != nil {
		return nil, fmt.Errorf("error reading appointments: %w", err)
	}

	var appointments []AppointmentData

	// Recorrer todas las celdas y extraer citas
	for _, row := range resp.Values {
		for _, cell := range row {
			if cell != nil && cell != "" {
				cellStr := fmt.Sprintf("%v", cell)
				if cellStr != "" {
					// Parsear la información de la celda
					appointment := AppointmentData{
						// Aquí podrías parsear el contenido si es necesario
						Description: cellStr,
					}
					appointments = append(appointments, appointment)
				}
			}
		}
	}

	return appointments, nil
}

// AppointmentData representa los datos de una cita en la hoja
type AppointmentData struct {
	EventID     string
	Date        string
	StartTime   string
	EndTime     string
	ClientName  string
	ClientEmail string
	ClientPhone string
	Description string
	Status      string
	WorkerName  string // Nuevo campo para el nombre del trabajador/barbero
}

// RefreshToken refresca el token de acceso si ha expirado
func (s *GoogleSheetsService) RefreshToken(ctx context.Context, tokenJSON string) (string, error) {
	var token oauth2.Token
	if err := json.Unmarshal([]byte(tokenJSON), &token); err != nil {
		return "", fmt.Errorf("error parsing token: %w", err)
	}

	config := s.GetOAuthConfig()
	tokenSource := config.TokenSource(ctx, &token)

	newToken, err := tokenSource.Token()
	if err != nil {
		return "", fmt.Errorf("error refreshing token: %w", err)
	}

	newTokenJSON, err := json.Marshal(newToken)
	if err != nil {
		return "", fmt.Errorf("error marshaling token: %w", err)
	}

	return string(newTokenJSON), nil
}

// =============================================================================
// PIZZERÍA — Hoja de pedidos
// =============================================================================
// Por qué NO se necesita Google Calendar para pizzerías:
// Los pedidos son INMEDIATOS (30-45 min). No hay citas que agendar en slots de
// tiempo. Lo que el dueño necesita es un tracker de pedidos en tiempo real con
// estados. Google Sheets cubre esto sin complejidad extra.
// =============================================================================

// CreateSpreadsheetForBusinessType es el punto de entrada unificado.
//   - "pizzeria" → hoja de pedidos + menú  (needsCalendar = false)
//   - resto      → calendario semanal de citas (needsCalendar = true)
//
// Uso en el handler de creación de agente:
//
//	spreadsheetID, needsCalendar, err := sheetsService.CreateSpreadsheetForBusinessType(
//	    ctx, tokenJSON, agentName, agent.BusinessType, schedule)
//	if needsCalendar {
//	    calendarID, err = calendarService.CreateCalendar(ctx, tokenJSON, agentName)
//	}
func (s *GoogleSheetsService) CreateSpreadsheetForBusinessType(
	ctx context.Context,
	tokenJSON, agentName, businessType string,
	schedule Schedule,
) (spreadsheetID string, needsCalendar bool, err error) {
	switch businessType {
	case "pizzeria":
		id, e := s.CreatePizzeriaSpreadsheet(ctx, tokenJSON, agentName)
		return id, false, e
	default:
		id, e := s.CreateSpreadsheet(ctx, tokenJSON, agentName, schedule)
		return id, true, e
	}
}

// CreatePizzeriaSpreadsheet crea un Google Spreadsheet con dos hojas:
//   - "Pedidos": tracker con número, cliente, productos, total y estado desplegable
//   - "Menú":    catálogo con precio normal, precio promo y disponibilidad
func (s *GoogleSheetsService) CreatePizzeriaSpreadsheet(ctx context.Context, tokenJSON, agentName string) (string, error) {
	service, err := s.CreateSheetsService(ctx, tokenJSON)
	if err != nil {
		return "", err
	}

	created, err := service.Spreadsheets.Create(&sheets.Spreadsheet{
		Properties: &sheets.SpreadsheetProperties{
			Title:    fmt.Sprintf("Attomos - Pedidos de %s", agentName),
			TimeZone: "America/Mexico_City",
			Locale:   "es_MX",
		},
		Sheets: []*sheets.Sheet{
			{Properties: &sheets.SheetProperties{
				Title:          "Pedidos",
				GridProperties: &sheets.GridProperties{FrozenRowCount: 1},
			}},
			{Properties: &sheets.SheetProperties{
				Title:          "Menú",
				GridProperties: &sheets.GridProperties{FrozenRowCount: 1},
			}},
		},
	}).Do()
	if err != nil {
		return "", fmt.Errorf("error creating pizzeria spreadsheet: %w", err)
	}

	if err := s.setupPizzeriaSheets(ctx, tokenJSON, created.SpreadsheetId, created.Sheets); err != nil {
		return "", fmt.Errorf("error setting up pizzeria sheets: %w", err)
	}

	log.Printf("✅ Hoja de pedidos para pizzería creada: %s", created.SpreadsheetId)
	return created.SpreadsheetId, nil
}

// setupPizzeriaSheets escribe encabezados, aplica formato rojo-tomate,
// configura validaciones desplegables y ajusta anchos de columna.
func (s *GoogleSheetsService) setupPizzeriaSheets(
	ctx context.Context,
	tokenJSON, spreadsheetID string,
	sheetList []*sheets.Sheet,
) error {
	service, err := s.CreateSheetsService(ctx, tokenJSON)
	if err != nil {
		return err
	}

	pedidosID := sheetList[0].Properties.SheetId
	menuID := sheetList[1].Properties.SheetId

	// ── Encabezados ──────────────────────────────────────────────────────────
	if _, err = service.Spreadsheets.Values.Update(
		spreadsheetID, "Pedidos!A1:J1",
		&sheets.ValueRange{Values: [][]interface{}{{
			"# Pedido", "Fecha", "Hora", "Cliente", "Teléfono",
			"Tipo / Dirección", "Productos", "Total ($)", "Estado", "Notas",
		}}},
	).ValueInputOption("RAW").Do(); err != nil {
		return fmt.Errorf("pedidos headers: %w", err)
	}

	if _, err = service.Spreadsheets.Values.Update(
		spreadsheetID, "Menú!A1:F1",
		&sheets.ValueRange{Values: [][]interface{}{{
			"Categoría", "Producto", "Descripción",
			"Precio ($)", "Precio Promo ($)", "Disponible",
		}}},
	).ValueInputOption("RAW").Do(); err != nil {
		return fmt.Errorf("menu headers: %w", err)
	}

	// ── Helpers ───────────────────────────────────────────────────────────────
	redHeader := func(sid int64, cols int64) *sheets.Request {
		return &sheets.Request{RepeatCell: &sheets.RepeatCellRequest{
			Range: &sheets.GridRange{
				SheetId: sid, StartRowIndex: 0, EndRowIndex: 1,
				StartColumnIndex: 0, EndColumnIndex: cols,
			},
			Cell: &sheets.CellData{UserEnteredFormat: &sheets.CellFormat{
				BackgroundColor: &sheets.Color{Red: 0.84, Green: 0.18, Blue: 0.15},
				TextFormat: &sheets.TextFormat{
					Bold:            true,
					ForegroundColor: &sheets.Color{Red: 1, Green: 1, Blue: 1},
					FontSize:        10,
				},
				HorizontalAlignment: "CENTER",
				VerticalAlignment:   "MIDDLE",
			}},
			Fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)",
		}}
	}

	colW := func(sid, start, end, px int64) *sheets.Request {
		return &sheets.Request{UpdateDimensionProperties: &sheets.UpdateDimensionPropertiesRequest{
			Range: &sheets.DimensionRange{
				SheetId: sid, Dimension: "COLUMNS",
				StartIndex: start, EndIndex: end,
			},
			Properties: &sheets.DimensionProperties{PixelSize: px},
			Fields:     "pixelSize",
		}}
	}

	dropdown := func(sid, startRow, endRow, startCol, endCol int64, values ...string) *sheets.Request {
		cvs := make([]*sheets.ConditionValue, len(values))
		for i, v := range values {
			cvs[i] = &sheets.ConditionValue{UserEnteredValue: v}
		}
		return &sheets.Request{SetDataValidation: &sheets.SetDataValidationRequest{
			Range: &sheets.GridRange{
				SheetId:       sid,
				StartRowIndex: startRow, EndRowIndex: endRow,
				StartColumnIndex: startCol, EndColumnIndex: endCol,
			},
			Rule: &sheets.DataValidationRule{
				Condition:    &sheets.BooleanCondition{Type: "ONE_OF_LIST", Values: cvs},
				ShowCustomUi: true,
			},
		}}
	}

	requests := []*sheets.Request{
		// Encabezados rojo-tomate
		redHeader(pedidosID, 10),
		redHeader(menuID, 6),
		// Estado desplegable — col I (índice 8)
		dropdown(pedidosID, 1, 1000, 8, 9,
			"🟡 Recibido", "🔵 En preparación", "🟠 En camino", "✅ Entregado", "❌ Cancelado"),
		// Disponible desplegable — col F (índice 5)
		dropdown(menuID, 1, 500, 5, 6, "✅ Sí", "❌ No"),
		// Anchos Pedidos
		colW(pedidosID, 0, 1, 80),
		colW(pedidosID, 1, 2, 105),
		colW(pedidosID, 2, 3, 80),
		colW(pedidosID, 3, 4, 160),
		colW(pedidosID, 4, 5, 130),
		colW(pedidosID, 5, 6, 200),
		colW(pedidosID, 6, 7, 260),
		colW(pedidosID, 7, 8, 90),
		colW(pedidosID, 8, 9, 150),
		colW(pedidosID, 9, 10, 200),
		// Anchos Menú
		colW(menuID, 0, 1, 130),
		colW(menuID, 1, 2, 200),
		colW(menuID, 2, 3, 250),
		colW(menuID, 3, 4, 100),
		colW(menuID, 4, 5, 120),
		colW(menuID, 5, 6, 90),
	}

	if _, err = service.Spreadsheets.BatchUpdate(
		spreadsheetID,
		&sheets.BatchUpdateSpreadsheetRequest{Requests: requests},
	).Do(); err != nil {
		return fmt.Errorf("error formatting pizzeria sheets: %w", err)
	}

	log.Printf("✅ Hojas de pizzería configuradas (Pedidos + Menú con desplegables)")
	return nil
}

// AddOrder registra un pedido en la hoja "Pedidos" con estado inicial "🟡 Recibido".
// Llamar desde el bot cuando el cliente confirma su pedido por WhatsApp.
func (s *GoogleSheetsService) AddOrder(ctx context.Context, tokenJSON, spreadsheetID string, order OrderData) error {
	service, err := s.CreateSheetsService(ctx, tokenJSON)
	if err != nil {
		return err
	}

	_, err = service.Spreadsheets.Values.Append(
		spreadsheetID, "Pedidos!A:J",
		&sheets.ValueRange{Values: [][]interface{}{{
			order.OrderNumber,
			order.Date,
			order.Time,
			order.ClientName,
			order.ClientPhone,
			order.DeliveryType,
			order.Items,
			order.Total,
			"🟡 Recibido",
			order.Notes,
		}}},
	).ValueInputOption("USER_ENTERED").InsertDataOption("INSERT_ROWS").Do()
	if err != nil {
		return fmt.Errorf("error adding order: %w", err)
	}
	return nil
}

// OrderData representa un pedido de pizzería capturado por el bot de WhatsApp.
type OrderData struct {
	OrderNumber  int
	Date         string // "2025-06-15"
	Time         string // "14:30"
	ClientName   string
	ClientPhone  string
	DeliveryType string // "Domicilio: Blvd. X 123" | "Para llevar"
	Items        string // "1x Pizza Hawaiana L, 2x Refresco 600ml"
	Total        float64
	Notes        string
}

// Helper function
func getStringValue(row []interface{}, index int) string {
	if index < len(row) && row[index] != nil {
		return fmt.Sprintf("%v", row[index])
	}
	return ""
}
