package src

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/types"
	"golang.org/x/text/runes"
	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"
	"google.golang.org/protobuf/proto"

	waProto "go.mau.fi/whatsmeow/binary/proto"
)

var client *whatsmeow.Client

// SetClient configura el cliente global de WhatsApp
func SetClient(c *whatsmeow.Client) {
	client = c
}

// SendMessage envía un mensaje de texto a un chat
func SendMessage(jid types.JID, text string) error {
	if client == nil {
		return fmt.Errorf("cliente no configurado")
	}

	msg := &waProto.Message{
		Conversation: proto.String(text),
	}

	_, err := client.SendMessage(context.Background(), jid, msg)
	return err
}

// SendImage descarga una imagen desde url y la envía al chat con un caption opcional.
func SendImage(jid types.JID, imageURL string, caption string) error {
	if client == nil {
		return fmt.Errorf("cliente no configurado")
	}

	data, mimeType, err := downloadMedia(imageURL)
	if err != nil {
		return fmt.Errorf("error descargando imagen: %w", err)
	}

	uploaded, err := client.Upload(context.Background(), data, whatsmeow.MediaImage)
	if err != nil {
		return fmt.Errorf("error subiendo imagen a WhatsApp: %w", err)
	}

	msg := &waProto.Message{
		ImageMessage: &waProto.ImageMessage{
			Caption:       proto.String(caption),
			Mimetype:      proto.String(mimeType),
			URL:           proto.String(uploaded.URL),
			DirectPath:    proto.String(uploaded.DirectPath),
			MediaKey:      uploaded.MediaKey,
			FileEncSHA256: uploaded.FileEncSHA256,
			FileSHA256:    uploaded.FileSHA256,
			FileLength:    proto.Uint64(uploaded.FileLength),
		},
	}

	_, err = client.SendMessage(context.Background(), jid, msg)
	return err
}

// SendDocument descarga un archivo desde url y lo envía como documento al chat.
func SendDocument(jid types.JID, fileURL string, fileName string, caption string) error {
	if client == nil {
		return fmt.Errorf("cliente no configurado")
	}

	data, mimeType, err := downloadMedia(fileURL)
	if err != nil {
		return fmt.Errorf("error descargando documento: %w", err)
	}

	uploaded, err := client.Upload(context.Background(), data, whatsmeow.MediaDocument)
	if err != nil {
		return fmt.Errorf("error subiendo documento a WhatsApp: %w", err)
	}

	msg := &waProto.Message{
		DocumentMessage: &waProto.DocumentMessage{
			Title:         proto.String(fileName),
			Caption:       proto.String(caption),
			Mimetype:      proto.String(mimeType),
			URL:           proto.String(uploaded.URL),
			DirectPath:    proto.String(uploaded.DirectPath),
			MediaKey:      uploaded.MediaKey,
			FileEncSHA256: uploaded.FileEncSHA256,
			FileSHA256:    uploaded.FileSHA256,
			FileLength:    proto.Uint64(uploaded.FileLength),
		},
	}

	_, err = client.SendMessage(context.Background(), jid, msg)
	return err
}

// downloadMedia descarga bytes desde una URL HTTP y detecta el MIME type.
func downloadMedia(url string) ([]byte, string, error) {
	resp, err := http.Get(url) //nolint:noctx
	if err != nil {
		return nil, "", fmt.Errorf("GET %s: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("GET %s: status %d", url, resp.StatusCode)
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, "", fmt.Errorf("leyendo body: %w", err)
	}

	mimeType := resp.Header.Get("Content-Type")
	if mimeType == "" {
		// Detectar por extensión
		urlLower := strings.ToLower(url)
		switch {
		case strings.HasSuffix(urlLower, ".pdf"):
			mimeType = "application/pdf"
		case strings.HasSuffix(urlLower, ".png"):
			mimeType = "image/png"
		case strings.HasSuffix(urlLower, ".webp"):
			mimeType = "image/webp"
		default:
			mimeType = "image/jpeg"
		}
	}

	return data, mimeType, nil
}

// NormalizeText normaliza texto quitando acentos y convirtiendo a minúsculas
func NormalizeText(text string) string {
	text = strings.ToLower(text)
	t := transform.Chain(norm.NFD, runes.Remove(runes.In(unicode.Mn)), norm.NFC)
	result, _, _ := transform.String(t, text)
	return strings.TrimSpace(result)
}

// ContainsKeywords verifica si el texto contiene alguna palabra clave
func ContainsKeywords(text string, keywords []string) bool {
	text = NormalizeText(text)
	for _, keyword := range keywords {
		if strings.Contains(text, NormalizeText(keyword)) {
			return true
		}
	}
	return false
}

// IsGreeting verifica si el mensaje es un saludo
func IsGreeting(text string) bool {
	greetings := []string{
		"hola", "buenos dias", "buenas tardes", "buenas noches",
		"hey", "hi", "hello", "saludos", "que tal",
	}
	return ContainsKeywords(text, greetings)
}

// GetDayOfWeek obtiene el día de la semana en español
func GetDayOfWeek(fecha time.Time) string {
	dias := []string{"domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"}
	return dias[fecha.Weekday()]
}

// ParseFecha parsea una fecha en formato DD/MM/YYYY
func ParseFecha(fechaStr string) (time.Time, error) {
	// Limpiar espacios
	fechaStr = strings.TrimSpace(fechaStr)

	// Intentar formato DD/MM/YYYY
	layout := "02/01/2006"
	fecha, err := time.Parse(layout, fechaStr)
	if err != nil {
		// Intentar formato D/M/YYYY o DD/M/YYYY o D/MM/YYYY
		partes := strings.Split(fechaStr, "/")
		if len(partes) == 3 {
			dia, err1 := strconv.Atoi(partes[0])
			mes, err2 := strconv.Atoi(partes[1])
			año, err3 := strconv.Atoi(partes[2])

			if err1 == nil && err2 == nil && err3 == nil {
				// Validar rangos
				if dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12 && año >= 2000 {
					fecha = time.Date(año, time.Month(mes), dia, 0, 0, 0, 0, time.Local)
					return fecha, nil
				}
			}
		}
		return time.Time{}, fmt.Errorf("formato de fecha inválido: %s (use DD/MM/YYYY)", fechaStr)
	}

	return fecha, nil
}

// FormatFecha formatea una fecha a DD/MM/YYYY
func FormatFecha(fecha time.Time) string {
	return fecha.Format("02/01/2006")
}

// normalizeDateFormat convierte fechas relativas y días de la semana a formato YYYY-MM-DD
func normalizeDateFormat(dateStr string) (string, error) {
	dateStr = strings.ToLower(strings.TrimSpace(dateStr))

	// Obtener fecha actual en zona horaria de México
	location, err := time.LoadLocation(GetTimezone())
	if err != nil {
		location = time.UTC
	}
	now := time.Now().In(location)

	// 1. Fechas relativas
	switch dateStr {
	case "hoy":
		return now.Format("2006-01-02"), nil

	case "mañana", "manana":
		return now.AddDate(0, 0, 1).Format("2006-01-02"), nil

	case "pasado mañana", "pasado manana":
		return now.AddDate(0, 0, 2).Format("2006-01-02"), nil
	}

	// 2. Días de la semana
	diasSemana := map[string]time.Weekday{
		"lunes":     time.Monday,
		"martes":    time.Tuesday,
		"miércoles": time.Wednesday,
		"miercoles": time.Wednesday,
		"jueves":    time.Thursday,
		"viernes":   time.Friday,
		"sábado":    time.Saturday,
		"sabado":    time.Saturday,
		"domingo":   time.Sunday,
	}

	if targetWeekday, ok := diasSemana[dateStr]; ok {
		currentWeekday := now.Weekday()
		daysUntil := int(targetWeekday - currentWeekday)

		// Si el día ya pasó esta semana, ir a la próxima semana
		if daysUntil <= 0 {
			daysUntil += 7
		}

		targetDate := now.AddDate(0, 0, daysUntil)
		return targetDate.Format("2006-01-02"), nil
	}

	// 3. Formato DD/MM/YYYY o DD/MM
	if strings.Contains(dateStr, "/") {
		parts := strings.Split(dateStr, "/")

		if len(parts) == 2 {
			// Formato DD/MM (asume año actual)
			day := parts[0]
			month := parts[1]
			year := fmt.Sprintf("%d", now.Year())

			parsedDate, err := time.Parse("02/01/2006", fmt.Sprintf("%s/%s/%s", day, month, year))
			if err != nil {
				return "", fmt.Errorf("formato de fecha inválido: %s (use DD/MM/YYYY)", dateStr)
			}

			// Si la fecha ya pasó este año, usar el próximo año
			if parsedDate.Before(now) {
				parsedDate = parsedDate.AddDate(1, 0, 0)
			}

			return parsedDate.Format("2006-01-02"), nil
		}

		if len(parts) == 3 {
			// Formato DD/MM/YYYY
			parsedDate, err := time.Parse("02/01/2006", dateStr)
			if err != nil {
				return "", fmt.Errorf("formato de fecha inválido: %s (use DD/MM/YYYY)", dateStr)
			}
			return parsedDate.Format("2006-01-02"), nil
		}
	}

	// 4. Si ya está en formato YYYY-MM-DD, retornarlo
	if _, err := time.Parse("2006-01-02", dateStr); err == nil {
		return dateStr, nil
	}

	return "", fmt.Errorf("formato de fecha no reconocido: '%s'. Use un día de la semana (lunes, martes, etc.) o formato DD/MM/YYYY", dateStr)
}

// ConvertirFechaADia convierte una fecha a día de la semana y calcula la fecha exacta
func ConvertirFechaADia(fecha string) (string, string, error) {
	// Primero normalizar a formato YYYY-MM-DD
	fechaNormalizada, err := normalizeDateFormat(fecha)
	if err != nil {
		return "", "", err
	}

	// Parsear la fecha normalizada
	fechaObj, err := time.Parse("2006-01-02", fechaNormalizada)
	if err != nil {
		return "", "", fmt.Errorf("error parseando fecha normalizada: %w", err)
	}

	// Obtener día de la semana
	diaSemana := GetDayOfWeek(fechaObj)

	// Retornar formato DD/MM/YYYY
	fechaFormateada := FormatFecha(fechaObj)

	return diaSemana, fechaFormateada, nil
}

// CalcularFechaDelDia calcula la fecha exacta del próximo día especificado
func CalcularFechaDelDia(diaSemana string) string {
	hoy := time.Now()

	diasSemanaNum := map[string]time.Weekday{
		"domingo":   time.Sunday,
		"lunes":     time.Monday,
		"martes":    time.Tuesday,
		"miércoles": time.Wednesday,
		"miercoles": time.Wednesday,
		"jueves":    time.Thursday,
		"viernes":   time.Friday,
		"sábado":    time.Saturday,
		"sabado":    time.Saturday,
	}

	diaObjetivo, exists := diasSemanaNum[NormalizeText(diaSemana)]
	if !exists {
		// Fallback: retornar fecha de hoy
		return FormatFecha(hoy)
	}

	diaActual := hoy.Weekday()

	// Calcular días hasta el objetivo
	diasHastaObjetivo := int(diaObjetivo - diaActual)

	// Si el día ya pasó esta semana, programar para la próxima semana
	if diasHastaObjetivo <= 0 {
		diasHastaObjetivo += 7
	}

	fechaObjetivo := hoy.AddDate(0, 0, diasHastaObjetivo)
	return FormatFecha(fechaObjetivo)
}

// NormalizarHora normaliza una hora al formato del calendario
func NormalizarHora(hora string) (string, error) {
	horaLower := NormalizeText(hora)

	// Extraer números de la hora
	re := regexp.MustCompile(`(\d+)`)
	matches := re.FindAllString(horaLower, -1)

	var numeroHora int
	var minutos int = 0

	if len(matches) > 0 {
		num, _ := strconv.Atoi(matches[0])
		numeroHora = num

		// Si hay minutos especificados
		if len(matches) > 1 {
			min, _ := strconv.Atoi(matches[1])
			minutos = min
		}
	}

	// Detectar si es AM o PM
	esPM := strings.Contains(horaLower, "tarde") ||
		strings.Contains(horaLower, "pm") ||
		strings.Contains(horaLower, "noche")

	esAM := strings.Contains(horaLower, "mañana") ||
		strings.Contains(horaLower, "manana") ||
		strings.Contains(horaLower, "am") ||
		strings.Contains(horaLower, "madrugada")

	// Ajustar para formato 12h
	if numeroHora > 0 {
		// Si es PM y no es 12
		if esPM && numeroHora < 12 {
			numeroHora += 12
		}
		// Si es AM y es 12
		if esAM && numeroHora == 12 {
			numeroHora = 0
		}

		// Convertir a formato de 12h con AM/PM
		var horaFormateada string
		if numeroHora == 0 {
			horaFormateada = fmt.Sprintf("12:%02d AM", minutos)
		} else if numeroHora < 12 {
			horaFormateada = fmt.Sprintf("%d:%02d AM", numeroHora, minutos)
		} else if numeroHora == 12 {
			horaFormateada = fmt.Sprintf("12:%02d PM", minutos)
		} else {
			horaFormateada = fmt.Sprintf("%d:%02d PM", numeroHora-12, minutos)
		}

		// Buscar coincidencia exacta en HORARIOS
		for _, h := range HORARIOS {
			if h == horaFormateada {
				return h, nil
			}
			// Buscar coincidencia aproximada (misma hora, diferentes minutos)
			if strings.HasPrefix(h, fmt.Sprintf("%d:", numeroHora%12)) ||
				strings.HasPrefix(h, fmt.Sprintf("%d:", (numeroHora%12)+12)) {
				return h, nil
			}
		}
	}

	// Conversiones directas comunes
	conversiones := map[string]string{
		"9":               "9:00 AM",
		"10":              "10:00 AM",
		"11":              "11:00 AM",
		"12":              "12:00 PM",
		"13":              "1:00 PM",
		"14":              "2:00 PM",
		"15":              "3:00 PM",
		"16":              "4:00 PM",
		"17":              "5:00 PM",
		"18":              "6:00 PM",
		"19":              "7:00 PM",
		"9 am":            "9:00 AM",
		"10 am":           "10:00 AM",
		"11 am":           "11:00 AM",
		"12 pm":           "12:00 PM",
		"1 pm":            "1:00 PM",
		"2 pm":            "2:00 PM",
		"3 pm":            "3:00 PM",
		"4 pm":            "4:00 PM",
		"5 pm":            "5:00 PM",
		"6 pm":            "6:00 PM",
		"7 pm":            "7:00 PM",
		"9 de la mañana":  "9:00 AM",
		"9 de la manana":  "9:00 AM",
		"10 de la mañana": "10:00 AM",
		"10 de la manana": "10:00 AM",
		"11 de la mañana": "11:00 AM",
		"11 de la manana": "11:00 AM",
		"12 del dia":      "12:00 PM",
		"1 de la tarde":   "1:00 PM",
		"2 de la tarde":   "2:00 PM",
		"3 de la tarde":   "3:00 PM",
		"4 de la tarde":   "4:00 PM",
		"5 de la tarde":   "5:00 PM",
		"6 de la tarde":   "6:00 PM",
		"7 de la tarde":   "7:00 PM",
		"7 de la noche":   "7:00 PM",
		"mañana":          "10:00 AM",
		"manana":          "10:00 AM",
		"tarde":           "3:00 PM",
		"en la mañana":    "10:00 AM",
		"en la manana":    "10:00 AM",
		"en la tarde":     "3:00 PM",
		"por la mañana":   "10:00 AM",
		"por la manana":   "10:00 AM",
		"por la tarde":    "3:00 PM",
	}

	if normalized, exists := conversiones[horaLower]; exists {
		return normalized, nil
	}

	// Buscar en horarios disponibles por coincidencia parcial
	for _, h := range HORARIOS {
		if strings.Contains(horaLower, strings.ToLower(h)) ||
			strings.Contains(NormalizeText(h), horaLower) {
			return h, nil
		}
	}

	return "", fmt.Errorf("hora no válida: '%s'. Horas disponibles: %v", hora, HORARIOS)
}

// ConvertirHoraA24h convierte hora de formato 12h a 24h
func ConvertirHoraA24h(hora string) (int, int, error) {
	// Limpiar hora
	hora = strings.TrimSpace(hora)

	var horas, minutos int
	var periodo string

	// Intentar parsear formato "HH:MM AM/PM"
	_, err := fmt.Sscanf(hora, "%d:%d %s", &horas, &minutos, &periodo)
	if err != nil {
		// Intentar formato "H:MM AM/PM"
		_, err = fmt.Sscanf(hora, "%d:%d%s", &horas, &minutos, &periodo)
		if err != nil {
			return 0, 0, fmt.Errorf("formato de hora inválido: %s", hora)
		}
	}

	periodo = strings.ToUpper(strings.TrimSpace(periodo))

	// Convertir a 24h
	if periodo == "PM" && horas != 12 {
		horas += 12
	} else if periodo == "AM" && horas == 12 {
		horas = 0
	}

	// Validar rangos
	if horas < 0 || horas > 23 || minutos < 0 || minutos > 59 {
		return 0, 0, fmt.Errorf("hora fuera de rango: %d:%d", horas, minutos)
	}

	return horas, minutos, nil
}

// GetNearestAvailableTime obtiene la hora disponible más cercana
func GetNearestAvailableTime(horaDeseada string) (string, error) {
	// Intentar normalizar la hora deseada
	horaNormalizada, err := NormalizarHora(horaDeseada)
	if err == nil {
		return horaNormalizada, nil
	}

	// Si no se puede normalizar, retornar la primera hora disponible
	if len(HORARIOS) > 0 {
		return HORARIOS[0], nil
	}

	return "", fmt.Errorf("no hay horarios disponibles")
}

// ValidateDateInFuture verifica que una fecha sea en el futuro
func ValidateDateInFuture(fechaStr string) error {
	fecha, err := ParseFecha(fechaStr)
	if err != nil {
		return err
	}

	hoy := time.Now()
	hoy = time.Date(hoy.Year(), hoy.Month(), hoy.Day(), 0, 0, 0, 0, hoy.Location())

	if fecha.Before(hoy) {
		return fmt.Errorf("la fecha debe ser hoy o en el futuro")
	}

	return nil
}

// GetWeekdayInSpanish convierte time.Weekday a español
func GetWeekdayInSpanish(weekday time.Weekday) string {
	dias := map[time.Weekday]string{
		time.Sunday:    "domingo",
		time.Monday:    "lunes",
		time.Tuesday:   "martes",
		time.Wednesday: "miércoles",
		time.Thursday:  "jueves",
		time.Friday:    "viernes",
		time.Saturday:  "sábado",
	}
	return dias[weekday]
}

// ParseHumanDate parsea fechas en lenguaje natural
func ParseHumanDate(texto string) (string, error) {
	// Usar normalizeDateFormat para obtener formato YYYY-MM-DD
	fechaNormalizada, err := normalizeDateFormat(texto)
	if err != nil {
		return "", err
	}

	// Convertir a DD/MM/YYYY
	fechaObj, err := time.Parse("2006-01-02", fechaNormalizada)
	if err != nil {
		return "", err
	}

	return FormatFecha(fechaObj), nil
}
