package src

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"time"
)

// ============================================
// INSCRIPTIONS BOT — Dependencias Gubernamentales
// Equivalente a orders_bot.go pero para el
// flujo de inscripción a cursos institucionales.
// ============================================

// InscriptionPayload datos de la inscripción para enviar al backend
type InscriptionPayload struct {
	AgentID   uint   `json:"agentId"`
	Nombre    string `json:"nombre"`
	Telefono  string `json:"telefono"`
	Email     string `json:"email"`
	Curso     string `json:"curso"`
	Sede      string `json:"sede"`
	Modalidad string `json:"modalidad"`
	Fecha     string `json:"fecha"`
	Estado    string `json:"estado"`
}

// SaveInscriptionToBackend guarda la inscripción en la BD de Attomos vía API REST.
// Se llama siempre al confirmar una inscripción; así aparece en el tab Base de Datos
// del panel Mi Dependencia.
func SaveInscriptionToBackend(ins *InscripcionData, userID string) {
	attomosURL := os.Getenv("ATTOMOS_API_URL")
	botToken   := os.Getenv("BOT_API_TOKEN")
	if attomosURL == "" || botToken == "" {
		log.Println("⚠️  [Inscriptions] ATTOMOS_API_URL o BOT_API_TOKEN no configurados")
		return
	}

	agentID := uint(0)
	fmt.Sscanf(os.Getenv("AGENT_ID"), "%d", &agentID)

	payload := InscriptionPayload{
		AgentID:   agentID,
		Nombre:    ins.Nombre,
		Telefono:  ins.Telefono,
		Email:     ins.Email,
		Curso:     ins.Curso,
		Sede:      ins.Sede,
		Modalidad: ins.Modalidad,
		Fecha:     ins.Fecha,
		Estado:    ins.Estado,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		log.Printf("❌ [Inscriptions] Error serializando: %v", err)
		return
	}

	req, err := http.NewRequest("POST", attomosURL+"/api/bot/inscriptions", bytes.NewBuffer(body))
	if err != nil {
		log.Printf("❌ [Inscriptions] Error creando request: %v", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+botToken)

	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		log.Printf("❌ [Inscriptions] Error llamando API: %v", err)
		return
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		log.Printf("⚠️  [Inscriptions] API retornó %d: %s", resp.StatusCode, respBody)
		return
	}

	log.Printf("✅ [Inscriptions] Inscripción guardada: %s → %s", ins.Nombre, ins.Curso)
}

// NotifyQuotaFilled notifica al backend que un curso llenó sus cupos.
// El backend actualiza my_agency_info → cursos (Disponible = false)
// y el panel Base de Datos refleja el cambio automáticamente.
func NotifyQuotaFilled(courseTitle string) {
	attomosURL := os.Getenv("ATTOMOS_API_URL")
	botToken   := os.Getenv("BOT_API_TOKEN")
	if attomosURL == "" || botToken == "" {
		return
	}

	payload := map[string]string{
		"curso":    courseTitle,
		"branchId": os.Getenv("BRANCH_ID"),
	}
	body, _ := json.Marshal(payload)

	req, err := http.NewRequest("POST", attomosURL+"/api/bot/quota-filled", bytes.NewBuffer(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+botToken)

	resp, err := (&http.Client{Timeout: 8 * time.Second}).Do(req)
	if err != nil {
		log.Printf("⚠️  [Inscriptions] quota-filled error: %v", err)
		return
	}
	defer resp.Body.Close()
	log.Printf("🔔 [Inscriptions] Cupo agotado notificado: '%s' (status %d)", courseTitle, resp.StatusCode)
}

// FetchAgencyConfig obtiene la configuración actualizada de la dependencia
// desde el backend de Attomos y actualiza AgencyCfg en memoria.
func FetchAgencyConfig() error {
	attomosURL := os.Getenv("ATTOMOS_API_URL")
	botToken   := os.Getenv("BOT_API_TOKEN")
	branchID   := os.Getenv("BRANCH_ID")
	if attomosURL == "" || botToken == "" || branchID == "" {
		return fmt.Errorf("ATTOMOS_API_URL, BOT_API_TOKEN o BRANCH_ID no configurados")
	}

	req, err := http.NewRequest("GET",
		fmt.Sprintf("%s/api/bot/agency-config/%s", attomosURL, branchID), nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+botToken)

	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("backend retornó %d", resp.StatusCode)
	}

	var cfg AgencyConfig
	if err := json.Unmarshal(body, &cfg); err != nil {
		return fmt.Errorf("error parseando config: %w", err)
	}

	AgencyCfg = &cfg
	log.Printf("🔄 [Inscriptions] Config actualizada: %d cursos, %d sedes",
		len(cfg.Cursos), len(cfg.Sedes))
	return nil
}

// StartQuotaPolling inicia un goroutine que sincroniza cupos desde Sheets
// cada N minutos para que el bot siempre tenga datos frescos.
func StartQuotaPolling(intervalMinutes int) {
	if intervalMinutes <= 0 {
		intervalMinutes = 5
	}
	go func() {
		ticker := time.NewTicker(time.Duration(intervalMinutes) * time.Minute)
		defer ticker.Stop()
		log.Printf("🔄 [Inscriptions] Polling de cupos cada %d min", intervalMinutes)
		for range ticker.C {
			if err := GetCuposFromSheet(); err != nil {
				log.Printf("⚠️  [Inscriptions] Error actualizando cupos: %v", err)
			}
		}
	}()
}

// InitAgencyBot inicializa todo lo necesario para el modo gubernamental.
// Se llama desde main.go después de InitSheets() cuando IsAgencyMode() == true.
func InitAgencyBot() error {
	log.Println("")
	log.Println("╔════════════════════════════════════════════════════════╗")
	log.Println("║          🏛️  INICIALIZANDO BOT GUBERNAMENTAL          ║")
	log.Println("╚════════════════════════════════════════════════════════╝")

	// 1. Cargar config local como base
	if err := LoadAgencyConfig(); err != nil {
		log.Printf("   ⚠️  Config local no encontrada: %v", err)
		if err2 := FetchAgencyConfig(); err2 != nil {
			return fmt.Errorf("no se pudo cargar config gubernamental: %w", err2)
		}
	} else {
		// Enriquecer con datos frescos del backend en background
		go func() {
			if err := FetchAgencyConfig(); err != nil {
				log.Printf("   ⚠️  Config backend no disponible, usando local: %v", err)
			}
		}()
	}

	log.Printf("   ✅ Dependencia: %s (%s)", AgencyCfg.DepName, AgencyCfg.DepAcronym)
	log.Printf("   📚 Cursos: %d | Sedes: %d", len(AgencyCfg.Cursos), len(AgencyCfg.Sedes))

	// 2. Inicializar hojas gubernamentales
	if IsSheetsEnabled() {
		if err := InitAgencySheets(); err != nil {
			log.Printf("   ⚠️  Sheets gubernamental: %v", err)
		} else {
			GetCuposFromSheet()
			log.Println("   ✅ Google Sheets gubernamental listo")
		}
	}

	// 3. Polling de cupos cada 5 min
	StartQuotaPolling(5)
	log.Println("   ✅ Polling de cupos iniciado")

	log.Println("╔════════════════════════════════════════════════════════╗")
	log.Println("║     ✅ BOT GUBERNAMENTAL LISTO                        ║")
	log.Println("╚════════════════════════════════════════════════════════╝")
	log.Println("")
	return nil
}