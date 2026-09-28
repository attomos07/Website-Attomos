package src

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"time"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	"google.golang.org/api/calendar/v3"
	"google.golang.org/api/option"
)

var calendarService *calendar.Service
var calendarID string
var calendarEnabled bool

// InitCalendar inicializa el servicio de Google Calendar usando OAuth token (google.json)
func InitCalendar() error {
	calendarID = os.Getenv("GOOGLE_CALENDAR_ID")
	if calendarID == "" {
		calendarEnabled = false
		return fmt.Errorf("GOOGLE_CALENDAR_ID no configurado")
	}

	if _, err := os.Stat("google.json"); os.IsNotExist(err) {
		calendarEnabled = false
		return fmt.Errorf("archivo google.json no encontrado")
	}

	tokenJSON, err := os.ReadFile("google.json")
	if err != nil {
		calendarEnabled = false
		return fmt.Errorf("error leyendo google.json: %w", err)
	}

	var token oauth2.Token
	if err := json.Unmarshal(tokenJSON, &token); err != nil {
		calendarEnabled = false
		return fmt.Errorf("error parseando token de google.json: %w", err)
	}

	if token.AccessToken == "" {
		calendarEnabled = false
		return fmt.Errorf("token no contiene access_token válido")
	}

	// Log del estado del token
	if !token.Expiry.IsZero() {
		timeUntilExpiry := time.Until(token.Expiry)
		if timeUntilExpiry < 0 {
			log.Printf("   ⚠️  Token de Calendar expirado hace: %v", -timeUntilExpiry)
			if token.RefreshToken != "" {
				log.Println("   ℹ️  Hay refresh_token - se renovará automáticamente")
			}
		} else {
			log.Printf("   ✅ Token de Calendar válido por: %v", timeUntilExpiry)
		}
	}

	ctx := context.Background()

	// Usar oauth2.Config.Client para habilitar auto-refresh del token
	config := &oauth2.Config{
		Scopes:   []string{calendar.CalendarScope},
		Endpoint: google.Endpoint,
	}

	client := config.Client(ctx, &token)

	srv, err := calendar.NewService(ctx, option.WithHTTPClient(client))
	if err != nil {
		calendarEnabled = false
		return fmt.Errorf("error creando servicio Calendar: %w", err)
	}

	// Probar acceso real
	log.Println("   🧪 Probando acceso a Google Calendar...")
	_, testErr := srv.CalendarList.Get(calendarID).Do()
	if testErr != nil {
		log.Printf("   ⚠️  No se pudo acceder al calendario '%s': %v", calendarID, testErr)
		log.Println("   💡 Verifica que GOOGLE_CALENDAR_ID sea correcto")
		log.Println("   ℹ️  Intentando continuar de todas formas...")
	} else {
		log.Printf("   ✅ Acceso al calendario verificado: %s", calendarID)
	}

	calendarService = srv
	calendarEnabled = true

	log.Println("✅ Google Calendar inicializado correctamente")
	return nil
}

// IsCalendarEnabled verifica si Calendar está habilitado
func IsCalendarEnabled() bool {
	return calendarEnabled
}

// CreateCalendarEvent crea un evento en Google Calendar a partir de un mapa de datos
// Firma compatible con AtomicBot: CreateCalendarEvent(data map[string]string)
func CreateCalendarEvent(data map[string]string) (*calendar.Event, error) {
	if !calendarEnabled {
		log.Println("⚠️  Google Calendar NO HABILITADO - Saltando creación de evento")
		return nil, nil
	}

	log.Println("")
	log.Println("╔════════════════════════════════════════════════════════╗")
	log.Println("║      📅 CREANDO EVENTO EN GOOGLE CALENDAR              ║")
	log.Println("╚════════════════════════════════════════════════════════╝")
	log.Println("")

	log.Println("📋 DATOS RECIBIDOS PARA CREAR EVENTO:")
	log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
	for key, value := range data {
		log.Printf("   %s: %s\n", key, value)
	}
	log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

	// Parsear fecha
	log.Println("🔄 PASO 1: Parseando fecha...")
	fechaObj, err := ParseFecha(data["fechaExacta"])
	if err != nil {
		log.Printf("❌ ERROR parseando fecha: %v\n", err)
		return nil, fmt.Errorf("error parseando fecha: %w", err)
	}
	log.Printf("✅ Fecha parseada: %s\n", fechaObj.Format("02/01/2006"))

	// Convertir hora a 24h
	log.Println("🔄 PASO 2: Convirtiendo hora a formato 24h...")
	horas, minutos, err := ConvertirHoraA24h(data["hora"])
	if err != nil {
		log.Printf("❌ ERROR convirtiendo hora '%s': %v\n", data["hora"], err)
		return nil, fmt.Errorf("error convirtiendo hora: %w", err)
	}
	log.Printf("✅ Hora convertida: %d:%02d\n", horas, minutos)

	// Crear fecha de inicio con zona horaria correcta
	log.Println("🔄 PASO 3: Creando fecha de inicio...")
	location, locErr := time.LoadLocation(GetTimezone())
	if locErr != nil {
		log.Printf("⚠️  No se pudo cargar timezone '%s', usando Local: %v\n", GetTimezone(), locErr)
		location = time.Local
	}

	startDate := time.Date(
		fechaObj.Year(), fechaObj.Month(), fechaObj.Day(),
		horas, minutos, 0, 0, location,
	)
	endDate := startDate.Add(time.Hour)

	log.Printf("✅ Inicio: %s\n", startDate.Format("02/01/2006 15:04 MST"))
	log.Printf("✅ Fin:    %s\n", endDate.Format("02/01/2006 15:04 MST"))

	// Construir descripción
	description := fmt.Sprintf(
		"Cliente: %s\nTeléfono: %s\nServicio: %s",
		data["nombre"], data["telefono"], data["servicio"],
	)
	if data["barbero"] != "" {
		description += fmt.Sprintf("\nBarbero/Trabajador: %s", data["barbero"])
	}
	description += "\n\nAgendado mediante WhatsApp Bot (Attomos)"

	title := fmt.Sprintf("✂️ %s - %s", data["servicio"], data["nombre"])

	log.Println("🔄 PASO 4: Construyendo objeto del evento...")
	event := &calendar.Event{
		Summary:     title,
		Description: description,
		Start: &calendar.EventDateTime{
			DateTime: startDate.Format(time.RFC3339),
			TimeZone: GetTimezone(),
		},
		End: &calendar.EventDateTime{
			DateTime: endDate.Format(time.RFC3339),
			TimeZone: GetTimezone(),
		},
		ColorId: "9", // Azul
		Reminders: &calendar.EventReminders{
			UseDefault: false,
			Overrides: []*calendar.EventReminder{
				{Method: "email", Minutes: 1440}, // 1 día antes
				{Method: "popup", Minutes: 60},   // 1 hora antes
				{Method: "popup", Minutes: 10},   // 10 minutos antes
			},
			ForceSendFields: []string{"UseDefault"},
		},
		Status:       "confirmed",
		Transparency: "opaque",
	}

	// Agregar invitado si proporcionó email
	if data["email"] != "" {
		log.Printf("   📧 Agregando attendee: %s\n", data["email"])
		event.Attendees = []*calendar.EventAttendee{
			{
				Email:          data["email"],
				DisplayName:    data["nombre"],
				ResponseStatus: "needsAction",
			},
		}
		guestsFalse := false
		event.GuestsCanSeeOtherGuests = &guestsFalse
	}

	log.Printf("   📝 Título: %s\n", event.Summary)
	log.Printf("   📍 Calendar ID: %s\n", calendarID)

	log.Println("🔄 PASO 5: Enviando evento a Google Calendar API...")
	createdEvent, err := calendarService.Events.Insert(calendarID, event).Do()
	if err != nil {
		log.Printf("❌ ERROR CREANDO EVENTO: %v\n", err)
		return nil, fmt.Errorf("error creando evento en Calendar: %w", err)
	}

	log.Println("")
	log.Println("╔════════════════════════════════════════════════════════╗")
	log.Println("║     ✅ EVENTO CREADO EN CALENDAR EXITOSAMENTE          ║")
	log.Println("╚════════════════════════════════════════════════════════╝")
	log.Printf("   🆔 Event ID: %s\n", createdEvent.Id)
	log.Printf("   📝 Título: %s\n", createdEvent.Summary)
	log.Printf("   🔗 Link: %s\n", createdEvent.HtmlLink)
	if data["email"] != "" {
		log.Printf("   📧 Invitación enviada a: %s\n", data["email"])
	}
	log.Println("")

	return createdEvent, nil
}

// GetUpcomingAppointments obtiene las próximas citas (próximos 7 días)
func GetUpcomingAppointments() ([]*calendar.Event, error) {
	if !calendarEnabled {
		return nil, fmt.Errorf("Google Calendar no habilitado")
	}

	now := time.Now()
	weekFromNow := now.AddDate(0, 0, 7)

	log.Printf("📅 Obteniendo citas desde %s hasta %s\n",
		now.Format("02/01/2006"), weekFromNow.Format("02/01/2006"))

	events, err := calendarService.Events.List(calendarID).
		TimeMin(now.Format(time.RFC3339)).
		TimeMax(weekFromNow.Format(time.RFC3339)).
		SingleEvents(true).
		OrderBy("startTime").
		Q("✂️").
		Do()

	if err != nil {
		log.Printf("❌ Error obteniendo citas: %v\n", err)
		return nil, fmt.Errorf("error obteniendo citas: %w", err)
	}

	log.Printf("✅ Se encontraron %d citas\n", len(events.Items))
	return events.Items, nil
}

// GetUpcomingEvents obtiene los próximos eventos (compatible con versión anterior)
func GetUpcomingEvents(maxResults int) ([]*calendar.Event, error) {
	if !calendarEnabled {
		return nil, fmt.Errorf("Google Calendar no habilitado")
	}

	now := time.Now().Format(time.RFC3339)

	events, err := calendarService.Events.List(calendarID).
		ShowDeleted(false).
		SingleEvents(true).
		TimeMin(now).
		MaxResults(int64(maxResults)).
		OrderBy("startTime").
		Do()

	if err != nil {
		return nil, fmt.Errorf("error obteniendo eventos: %w", err)
	}

	return events.Items, nil
}

// SearchEventsByPatient busca eventos por nombre de cliente
func SearchEventsByPatient(nombre string) ([]*calendar.Event, error) {
	if !calendarEnabled {
		return nil, fmt.Errorf("Google Calendar no habilitado")
	}

	now := time.Now()
	threeMonthsLater := now.AddDate(0, 3, 0)

	log.Printf("🔍 Buscando eventos para cliente: %s\n", nombre)

	events, err := calendarService.Events.List(calendarID).
		TimeMin(now.Format(time.RFC3339)).
		TimeMax(threeMonthsLater.Format(time.RFC3339)).
		SingleEvents(true).
		OrderBy("startTime").
		Q(nombre).
		Do()

	if err != nil {
		log.Printf("❌ Error buscando eventos: %v\n", err)
		return nil, fmt.Errorf("error buscando eventos: %w", err)
	}

	log.Printf("✅ Se encontraron %d eventos para %s\n", len(events.Items), nombre)
	return events.Items, nil
}

// DeleteEvent elimina un evento de Google Calendar
func DeleteEvent(eventID string) error {
	if !calendarEnabled {
		return fmt.Errorf("Google Calendar no habilitado")
	}

	err := calendarService.Events.Delete(calendarID, eventID).Do()
	if err != nil {
		return fmt.Errorf("error eliminando evento: %w", err)
	}

	log.Printf("✅ Evento eliminado: %s", eventID)
	return nil
}

// UpdateEvent actualiza un evento existente
func UpdateEvent(eventID, title, description string, startTime time.Time, durationMinutes int) error {
	if !calendarEnabled {
		return fmt.Errorf("Google Calendar no habilitado")
	}

	endTime := startTime.Add(time.Duration(durationMinutes) * time.Minute)

	event, err := calendarService.Events.Get(calendarID, eventID).Do()
	if err != nil {
		return fmt.Errorf("error obteniendo evento: %w", err)
	}

	event.Summary = title
	event.Description = description
	event.Start.DateTime = startTime.Format(time.RFC3339)
	event.End.DateTime = endTime.Format(time.RFC3339)

	_, err = calendarService.Events.Update(calendarID, eventID, event).Do()
	if err != nil {
		return fmt.Errorf("error actualizando evento: %w", err)
	}

	log.Printf("✅ Evento actualizado: %s", eventID)
	return nil
}

// FindEventByDate busca eventos en una fecha específica
func FindEventByDate(date time.Time) ([]*calendar.Event, error) {
	if !calendarEnabled {
		return nil, fmt.Errorf("Google Calendar no habilitado")
	}

	startOfDay := time.Date(date.Year(), date.Month(), date.Day(), 0, 0, 0, 0, date.Location())
	endOfDay := startOfDay.Add(24 * time.Hour)

	events, err := calendarService.Events.List(calendarID).
		ShowDeleted(false).
		SingleEvents(true).
		TimeMin(startOfDay.Format(time.RFC3339)).
		TimeMax(endOfDay.Format(time.RFC3339)).
		OrderBy("startTime").
		Do()

	if err != nil {
		return nil, fmt.Errorf("error buscando eventos: %w", err)
	}

	return events.Items, nil
}

// GetCalendarInfo obtiene información del calendario
func GetCalendarInfo() (*calendar.Calendar, error) {
	if !calendarEnabled {
		return nil, fmt.Errorf("Google Calendar no habilitado")
	}

	cal, err := calendarService.Calendars.Get(calendarID).Do()
	if err != nil {
		return nil, fmt.Errorf("error obteniendo información del calendario: %w", err)
	}

	return cal, nil
}
