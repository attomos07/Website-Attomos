package src

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	"google.golang.org/api/option"
	"google.golang.org/api/sheets/v4"
)

var (
	sheetsService *sheets.Service
	spreadsheetID string
	sheetsEnabled bool
)

// InitSheets inicializa el servicio de Google Sheets usando OAuth token (google.json)
func InitSheets() error {
	log.Println("")
	log.Println("╔══════════════════════════════════════════════════════╗")
	log.Println("║              📊 INICIANDO GOOGLE SHEETS              ║")
	log.Println("╚══════════════════════════════════════════════════════╝")
	log.Println("")

	// Paso 1: Verificar SPREADSHEETID
	spreadsheetID = os.Getenv("SPREADSHEETID")
	if spreadsheetID == "" {
		sheetsEnabled = false
		log.Println("⚠️  SPREADSHEETID no configurado en .env")
		log.Println("💡 Google Sheets deshabilitado")
		return fmt.Errorf("SPREADSHEETID no configurado")
	}
	log.Printf("✅ SPREADSHEETID: %s\n", maskSensitiveData(spreadsheetID))

	// Paso 2: Verificar archivo google.json
	if _, err := os.Stat("google.json"); os.IsNotExist(err) {
		sheetsEnabled = false
		log.Println("❌ Archivo google.json NO encontrado")
		return fmt.Errorf("archivo google.json no encontrado")
	}
	log.Println("✅ Archivo google.json encontrado")

	// Paso 3: Leer google.json
	credBytes, err := os.ReadFile("google.json")
	if err != nil {
		sheetsEnabled = false
		log.Printf("❌ Error leyendo google.json: %v\n", err)
		return err
	}

	// Paso 4: Parsear token OAuth
	var token oauth2.Token
	if err := json.Unmarshal(credBytes, &token); err != nil {
		sheetsEnabled = false
		log.Printf("❌ Error parseando token: %v\n", err)
		return err
	}
	log.Println("✅ Token OAuth parseado correctamente")

	// Log del estado del token
	if !token.Expiry.IsZero() {
		timeUntilExpiry := time.Until(token.Expiry)
		if timeUntilExpiry < 0 {
			log.Printf("   ⚠️  Token expirado hace: %v", -timeUntilExpiry)
			if token.RefreshToken != "" {
				log.Println("   ℹ️  Hay refresh_token - se renovará automáticamente")
			}
		} else {
			log.Printf("   ✅ Token válido por: %v", timeUntilExpiry)
		}
	}

	// Paso 5: Crear cliente OAuth con auto-refresh
	config := &oauth2.Config{
		Scopes:   []string{sheets.SpreadsheetsScope},
		Endpoint: google.Endpoint,
	}

	ctx := context.Background()
	client := config.Client(ctx, &token)

	// Paso 6: Crear servicio de Sheets
	srv, err := sheets.NewService(ctx, option.WithHTTPClient(client))
	if err != nil {
		sheetsEnabled = false
		log.Printf("❌ Error creando servicio Sheets: %v\n", err)
		return err
	}

	sheetsService = srv

	// Paso 7: Probar acceso al spreadsheet
	log.Println("🧪 Probando acceso al Spreadsheet...")
	_, testErr := srv.Spreadsheets.Get(spreadsheetID).Do()
	if testErr != nil {
		sheetsEnabled = false
		log.Printf("❌ Error accediendo al Spreadsheet: %v\n", testErr)
		return testErr
	}
	log.Println("✅ Acceso al Spreadsheet verificado")

	sheetsEnabled = true

	log.Println("")
	log.Println("╔══════════════════════════════════════════════════════╗")
	log.Println("║        ✅ GOOGLE SHEETS INICIALIZADO                 ║")
	log.Println("╚══════════════════════════════════════════════════════╝")
	log.Println("")

	return nil
}

// IsSheetsEnabled verifica si Google Sheets está habilitado
func IsSheetsEnabled() bool {
	return sheetsEnabled && sheetsService != nil && spreadsheetID != ""
}

// SaveAppointmentToSheets guarda una cita en Google Sheets (formato calendario compatible con AtomicBot)
// Recibe: nombre, telefono, fecha (DD/MM/YYYY), hora (HH:MM AM/PM), servicio, trabajador
func SaveAppointmentToSheets(nombre, telefono, fecha, hora, servicio, trabajador string) error {
	if !sheetsEnabled || sheetsService == nil {
		return fmt.Errorf("Google Sheets no está habilitado")
	}

	log.Println("")
	log.Println("📊 GUARDANDO CITA EN GOOGLE SHEETS")
	log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
	log.Printf("   👤 Cliente: %s\n", nombre)
	log.Printf("   📞 Teléfono: %s\n", telefono)
	log.Printf("   📅 Fecha: %s\n", fecha)
	log.Printf("   ⏰ Hora: %s\n", hora)
	log.Printf("   💼 Servicio: %s\n", servicio)
	log.Printf("   👷 Trabajador: %s\n", trabajador)
	log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

	// Parsear la fecha para obtener el día de la semana
	fechaObj, err := ParseFecha(fecha)
	if err != nil {
		log.Printf("❌ Error parseando fecha '%s': %v\n", fecha, err)
		return fmt.Errorf("error parseando fecha: %w", err)
	}

	// Obtener columna según día de la semana
	diaSemana := strings.ToLower(GetDayOfWeek(fechaObj))
	columnLetter, ok := COLUMNAS_DIAS[diaSemana]
	if !ok {
		log.Printf("❌ Día de semana no reconocido: %s\n", diaSemana)
		return fmt.Errorf("día de semana no reconocido: %s", diaSemana)
	}

	log.Printf("   📅 Día de la semana: %s → Columna %s\n", diaSemana, columnLetter)

	// Obtener fila según hora
	row := GetFilaHora(hora)
	if row == -1 {
		// Intentar con hora tal cual si no está en HORARIOS exactamente
		log.Printf("⚠️  Hora '%s' no encontrada en HORARIOS exactos, usando fila por hora\n", hora)
		// Parsear hora manualmente
		horas, _, parseErr := ConvertirHoraA24h(hora)
		if parseErr == nil {
			row = horas - 9 + 2 // 9 AM = fila 2
		}
		if row < 2 || row > 12 {
			return fmt.Errorf("hora fuera del rango del calendario (9:00 AM - 7:00 PM): %s", hora)
		}
	}

	log.Printf("   📍 Columna: %s, Fila: %d\n", columnLetter, row)

	// Construir contenido de la celda
	cellContent := fmt.Sprintf("👤 %s\n📞 %s\n✂️ %s",
		nombre, telefono, servicio)
	if trabajador != "" {
		cellContent += fmt.Sprintf("\n💈 %s", trabajador)
	}
	cellContent += fmt.Sprintf("\n📅 %s", fecha)

	// Rango de la celda (ej: "Calendario!C5")
	cellRange := fmt.Sprintf("Calendario!%s%d", columnLetter, row)

	log.Printf("   📝 Escribiendo en celda: %s\n", cellRange)
	log.Printf("   📄 Contenido:\n%s\n", cellContent)

	valueRange := &sheets.ValueRange{
		Values: [][]interface{}{{cellContent}},
	}

	_, err = sheetsService.Spreadsheets.Values.Update(
		spreadsheetID,
		cellRange,
		valueRange,
	).ValueInputOption("RAW").Do()

	if err != nil {
		log.Printf("❌ Error guardando en Sheets: %v\n", err)
		return err
	}

	log.Println("✅ CITA GUARDADA EN SHEETS EXITOSAMENTE")
	log.Println("")

	return nil
}

// SaveAppointment guarda una cita simple (compatibilidad con versión anterior de OrbitalBot)
func SaveAppointment(clientName, phoneNumber string, appointmentTime time.Time) error {
	fecha := appointmentTime.Format("02/01/2006")
	hora := appointmentTime.Format("3:04 PM")

	return SaveAppointmentToSheets(clientName, phoneNumber, fecha, hora, "Cita agendada", "")
}

// CancelAppointmentInSheets cancela una cita en Google Sheets
func CancelAppointmentInSheets(clientName string, appointmentTime time.Time) error {
	if !sheetsEnabled || sheetsService == nil {
		return fmt.Errorf("Google Sheets no está habilitado")
	}

	log.Println("")
	log.Println("🚫 CANCELANDO CITA EN GOOGLE SHEETS")
	log.Printf("   Cliente: %s\n", clientName)
	log.Printf("   Fecha/Hora: %s\n", appointmentTime.Format("02/01/2006 15:04"))

	// Determinar columna según día de la semana
	diaSemana := strings.ToLower(GetDayOfWeek(appointmentTime))
	columnLetter, ok := COLUMNAS_DIAS[diaSemana]
	if !ok {
		return fmt.Errorf("día de semana no reconocido: %s", diaSemana)
	}

	// Determinar fila según hora
	hour := appointmentTime.Hour()
	row := hour - 9 + 2

	if row < 2 || row > 12 {
		return fmt.Errorf("hora fuera del rango del calendario (9:00 AM - 7:00 PM)")
	}

	cellRange := fmt.Sprintf("Calendario!%s%d", columnLetter, row)

	// Leer contenido actual
	resp, err := sheetsService.Spreadsheets.Values.Get(spreadsheetID, cellRange).Do()
	if err != nil {
		return fmt.Errorf("error leyendo celda: %w", err)
	}

	if len(resp.Values) == 0 || len(resp.Values[0]) == 0 {
		return fmt.Errorf("no hay cita agendada en ese horario")
	}

	currentContent := fmt.Sprintf("%v", resp.Values[0][0])

	// Verificar que la cita pertenezca al cliente
	if !strings.Contains(currentContent, clientName) {
		return fmt.Errorf("la cita en ese horario no corresponde a %s", clientName)
	}

	log.Printf("   📋 Contenido actual: %s\n", currentContent)

	// Limpiar la celda
	valueRange := &sheets.ValueRange{
		Values: [][]interface{}{{""}},
	}

	_, err = sheetsService.Spreadsheets.Values.Update(
		spreadsheetID,
		cellRange,
		valueRange,
	).ValueInputOption("RAW").Do()

	if err != nil {
		log.Printf("❌ Error cancelando en Sheets: %v\n", err)
		return err
	}

	log.Println("✅ CITA CANCELADA EN SHEETS EXITOSAMENTE")
	log.Println("")

	return nil
}

// CancelAppointmentByClient cancela una cita buscando por nombre y fecha
// Compatible con AtomicBot
func CancelAppointmentByClient(clientName, phoneNumber string, appointmentDate time.Time) error {
	return CancelAppointmentInSheets(clientName, appointmentDate)
}

// FindAppointmentByClient busca una cita específica de un cliente
func FindAppointmentByClient(clientName string, appointmentTime time.Time) (bool, error) {
	if !sheetsEnabled || sheetsService == nil {
		return false, fmt.Errorf("Google Sheets no está habilitado")
	}

	diaSemana := strings.ToLower(GetDayOfWeek(appointmentTime))
	columnLetter, ok := COLUMNAS_DIAS[diaSemana]
	if !ok {
		return false, fmt.Errorf("día de semana no reconocido: %s", diaSemana)
	}

	hour := appointmentTime.Hour()
	row := hour - 9 + 2

	cellRange := fmt.Sprintf("Calendario!%s%d", columnLetter, row)
	resp, err := sheetsService.Spreadsheets.Values.Get(spreadsheetID, cellRange).Do()
	if err != nil {
		return false, fmt.Errorf("error leyendo celda: %w", err)
	}

	if len(resp.Values) == 0 || len(resp.Values[0]) == 0 {
		return false, nil
	}

	cellContent := fmt.Sprintf("%v", resp.Values[0][0])
	return strings.Contains(cellContent, clientName), nil
}

// InitializeWeeklyCalendar crea/resetea el calendario semanal en Sheets
func InitializeWeeklyCalendar() error {
	if sheetsService == nil {
		return fmt.Errorf("Google Sheets no está inicializado")
	}

	log.Println("📅 Inicializando calendario semanal...")

	headers := []interface{}{"Hora", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"}

	var rows [][]interface{}
	rows = append(rows, headers)

	for hour := 9; hour <= 19; hour++ {
		var ampm string
		displayHour := hour
		if hour < 12 {
			ampm = "AM"
		} else {
			ampm = "PM"
			if hour > 12 {
				displayHour = hour - 12
			}
		}

		row := []interface{}{fmt.Sprintf("%d:00 %s", displayHour, ampm)}
		for i := 0; i < 7; i++ {
			row = append(row, "")
		}
		rows = append(rows, row)
	}

	valueRange := &sheets.ValueRange{
		Values: rows,
	}

	_, err := sheetsService.Spreadsheets.Values.Update(
		spreadsheetID,
		"Calendario!A1:H12",
		valueRange,
	).ValueInputOption("USER_ENTERED").Do()

	if err != nil {
		return fmt.Errorf("error inicializando calendario: %w", err)
	}

	log.Println("✅ Calendario semanal inicializado")
	return nil
}

// GetAppointments obtiene las citas guardadas
func GetAppointments() ([][]interface{}, error) {
	if sheetsService == nil {
		return nil, fmt.Errorf("Google Sheets no está inicializado")
	}

	resp, err := sheetsService.Spreadsheets.Values.Get(spreadsheetID, "Calendario!B2:H12").Do()
	if err != nil {
		return nil, fmt.Errorf("error obteniendo citas: %w", err)
	}

	return resp.Values, nil
}

// ClearAppointmentCell limpia una celda específica del calendario
func ClearAppointmentCell(appointmentTime time.Time) error {
	if !sheetsEnabled || sheetsService == nil {
		return fmt.Errorf("Google Sheets no está habilitado")
	}

	diaSemana := strings.ToLower(GetDayOfWeek(appointmentTime))
	columnLetter, ok := COLUMNAS_DIAS[diaSemana]
	if !ok {
		return fmt.Errorf("día de semana no reconocido: %s", diaSemana)
	}

	hour := appointmentTime.Hour()
	row := hour - 9 + 2

	cellRange := fmt.Sprintf("Calendario!%s%d", columnLetter, row)

	valueRange := &sheets.ValueRange{
		Values: [][]interface{}{{""}},
	}

	_, err := sheetsService.Spreadsheets.Values.Update(
		spreadsheetID,
		cellRange,
		valueRange,
	).ValueInputOption("RAW").Do()

	if err != nil {
		return fmt.Errorf("error limpiando celda: %w", err)
	}

	log.Println("✅ Celda de cita limpiada del calendario")
	return nil
}

// ClearCancelledAppointment alias para compatibilidad
func ClearCancelledAppointment(appointmentTime time.Time) error {
	return ClearAppointmentCell(appointmentTime)
}
