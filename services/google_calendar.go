package services

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	"google.golang.org/api/calendar/v3"
	"google.golang.org/api/option"
	"google.golang.org/api/sheets/v4"
)

type GoogleCalendarService struct {
	ClientID     string
	ClientSecret string
	RedirectURL  string
}

// GetOAuthConfig retorna la configuración de OAuth2 para Google Calendar y Sheets
func (s *GoogleCalendarService) GetOAuthConfig() *oauth2.Config {
	return &oauth2.Config{
		ClientID:     s.ClientID,
		ClientSecret: s.ClientSecret,
		RedirectURL:  s.RedirectURL,
		Scopes: []string{
			calendar.CalendarScope,                           // Acceso completo a Calendar
			sheets.SpreadsheetsScope,                         // Acceso completo a Sheets
			"https://www.googleapis.com/auth/userinfo.email", // Email del usuario
			"https://www.googleapis.com/auth/drive.file",     // ← NUEVO: Modificar archivos creados por la app
		},
		Endpoint: google.Endpoint,
	}
}

// GetAuthURL genera la URL de autorización de Google
func (s *GoogleCalendarService) GetAuthURL(state string) string {
	config := s.GetOAuthConfig()
	return config.AuthCodeURL(state, oauth2.AccessTypeOffline, oauth2.ApprovalForce)
}

// ExchangeCode intercambia el código de autorización por tokens
func (s *GoogleCalendarService) ExchangeCode(ctx context.Context, code string) (*oauth2.Token, error) {
	config := s.GetOAuthConfig()
	token, err := config.Exchange(ctx, code)
	if err != nil {
		return nil, fmt.Errorf("error exchanging code: %w", err)
	}
	return token, nil
}

// GetUserEmail obtiene el email del usuario de Google usando el token
func (s *GoogleCalendarService) GetUserEmail(ctx context.Context, tokenJSON string) (string, error) {
	var token oauth2.Token
	if err := json.Unmarshal([]byte(tokenJSON), &token); err != nil {
		return "", fmt.Errorf("error parsing token: %w", err)
	}

	config := s.GetOAuthConfig()
	client := config.Client(ctx, &token)

	// Llamar a la API de userinfo de Google
	resp, err := client.Get("https://www.googleapis.com/oauth2/v2/userinfo")
	if err != nil {
		return "", fmt.Errorf("error getting user info: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("error HTTP %d: %s", resp.StatusCode, string(body))
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("error reading response: %w", err)
	}

	var userInfo struct {
		Email string `json:"email"`
	}

	if err := json.Unmarshal(body, &userInfo); err != nil {
		return "", fmt.Errorf("error parsing user info: %w", err)
	}

	if userInfo.Email == "" {
		return "", fmt.Errorf("email not found in user info")
	}

	return userInfo.Email, nil
}

// CreateCalendarService crea un servicio de Calendar con los tokens del usuario
func (s *GoogleCalendarService) CreateCalendarService(ctx context.Context, tokenJSON string) (*calendar.Service, error) {
	var token oauth2.Token
	if err := json.Unmarshal([]byte(tokenJSON), &token); err != nil {
		return nil, fmt.Errorf("error parsing token: %w", err)
	}

	config := s.GetOAuthConfig()
	client := config.Client(ctx, &token)

	service, err := calendar.NewService(ctx, option.WithHTTPClient(client))
	if err != nil {
		return nil, fmt.Errorf("error creating calendar service: %w", err)
	}

	return service, nil
}

// CreateCalendar crea un nuevo calendario para el agente
func (s *GoogleCalendarService) CreateCalendar(ctx context.Context, tokenJSON, agentName string) (string, error) {
	service, err := s.CreateCalendarService(ctx, tokenJSON)
	if err != nil {
		return "", err
	}

	calendarName := fmt.Sprintf("Attomos - %s", agentName)

	newCalendar := &calendar.Calendar{
		Summary:     calendarName,
		Description: fmt.Sprintf("Calendario de citas para el agente %s (generado por Attomos)", agentName),
		TimeZone:    "America/Mexico_City",
	}

	createdCalendar, err := service.Calendars.Insert(newCalendar).Do()
	if err != nil {
		return "", fmt.Errorf("error creating calendar: %w", err)
	}

	return createdCalendar.Id, nil
}

// CreateEvent crea un evento en el calendario del usuario
func (s *GoogleCalendarService) CreateEvent(ctx context.Context, tokenJSON, calendarID string, eventData EventData) (string, error) {
	service, err := s.CreateCalendarService(ctx, tokenJSON)
	if err != nil {
		return "", err
	}

	event := &calendar.Event{
		Summary:     eventData.Title,
		Description: eventData.Description,
		Start: &calendar.EventDateTime{
			DateTime: eventData.StartTime.Format(time.RFC3339),
			TimeZone: "America/Mexico_City",
		},
		End: &calendar.EventDateTime{
			DateTime: eventData.EndTime.Format(time.RFC3339),
			TimeZone: "America/Mexico_City",
		},
		Attendees: []*calendar.EventAttendee{
			{Email: eventData.ClientEmail},
		},
		Reminders: &calendar.EventReminders{
			UseDefault: false,
			Overrides: []*calendar.EventReminder{
				{Method: "email", Minutes: 1440}, // 24 horas antes
				{Method: "popup", Minutes: 60},   // 1 hora antes
			},
		},
	}

	if eventData.ClientPhone != "" {
		event.Description += fmt.Sprintf("\n\nTeléfono: %s", eventData.ClientPhone)
	}

	createdEvent, err := service.Events.Insert(calendarID, event).SendNotifications(true).Do()
	if err != nil {
		return "", fmt.Errorf("error creating event: %w", err)
	}

	return createdEvent.Id, nil
}

// UpdateEvent actualiza un evento existente
func (s *GoogleCalendarService) UpdateEvent(ctx context.Context, tokenJSON, calendarID, eventID string, eventData EventData) error {
	service, err := s.CreateCalendarService(ctx, tokenJSON)
	if err != nil {
		return err
	}

	event, err := service.Events.Get(calendarID, eventID).Do()
	if err != nil {
		return fmt.Errorf("error getting event: %w", err)
	}

	event.Summary = eventData.Title
	event.Description = eventData.Description
	event.Start.DateTime = eventData.StartTime.Format(time.RFC3339)
	event.End.DateTime = eventData.EndTime.Format(time.RFC3339)

	_, err = service.Events.Update(calendarID, eventID, event).SendNotifications(true).Do()
	if err != nil {
		return fmt.Errorf("error updating event: %w", err)
	}

	return nil
}

// DeleteEvent elimina un evento del calendario
func (s *GoogleCalendarService) DeleteEvent(ctx context.Context, tokenJSON, calendarID, eventID string) error {
	service, err := s.CreateCalendarService(ctx, tokenJSON)
	if err != nil {
		return err
	}

	err = service.Events.Delete(calendarID, eventID).SendNotifications(true).Do()
	if err != nil {
		return fmt.Errorf("error deleting event: %w", err)
	}

	return nil
}

// GetEvents obtiene los eventos del calendario en un rango de fechas
func (s *GoogleCalendarService) GetEvents(ctx context.Context, tokenJSON, calendarID string, startDate, endDate time.Time) ([]*calendar.Event, error) {
	service, err := s.CreateCalendarService(ctx, tokenJSON)
	if err != nil {
		return nil, err
	}

	events, err := service.Events.List(calendarID).
		TimeMin(startDate.Format(time.RFC3339)).
		TimeMax(endDate.Format(time.RFC3339)).
		SingleEvents(true).
		OrderBy("startTime").
		Do()

	if err != nil {
		return nil, fmt.Errorf("error getting events: %w", err)
	}

	return events.Items, nil
}

// EventData representa los datos necesarios para crear un evento
type EventData struct {
	Title       string
	Description string
	StartTime   time.Time
	EndTime     time.Time
	ClientEmail string
	ClientPhone string
}

// RefreshToken refresca el token de acceso si ha expirado
func (s *GoogleCalendarService) RefreshToken(ctx context.Context, tokenJSON string) (string, error) {
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
