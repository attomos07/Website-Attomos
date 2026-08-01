package handlers

import (
	"context"
	"log"
	"net/http"
	"net/url"
	"sync"
	"time"

	"attomos/services"

	"github.com/gin-gonic/gin"
)

// ScrapeVehicleFromWebsite — GET /api/inventory-website/:agent_id/scrape?url=...
// Abre la URL de un vehículo en el sitio público del cliente (pensado para
// sitios Next.js con contenido renderizado en cliente, donde un fetch normal
// solo trae el HTML vacío) y devuelve las specs extraídas.
func (h *GoogleIntegrationHandler) ScrapeVehicleFromWebsite(c *gin.Context) {
	agent, _, ok := h.getAgentForUser(c)
	if !ok {
		return
	}

	rawURL := c.Query("url")
	if rawURL == "" {
		log.Printf("⚠️ [Agent %d] ScrapeVehicleFromWebsite: falta el parámetro url", agent.ID)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Falta la URL del vehículo"})
		return
	}
	if _, err := validateHTTPURL(rawURL); err != nil {
		log.Printf("⚠️ [Agent %d] ScrapeVehicleFromWebsite: URL inválida — url=%q err=%v", agent.ID, rawURL, err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "URL inválida"})
		return
	}

	log.Printf("🌐 [Agent %d] ScrapeVehicleFromWebsite: iniciando scrape — url=%s", agent.ID, rawURL)

	scrapeCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	browserCtx, cancelBrowser := services.NewHeadlessBrowser(scrapeCtx)
	defer cancelBrowser()

	start := time.Now()
	data, err := services.ScrapeVehiclePage(browserCtx, rawURL)
	if err != nil {
		log.Printf("❌ [Agent %d] ScrapeVehicleFromWebsite: falló tras %s — url=%s err=%v", agent.ID, time.Since(start), rawURL, err)
		c.JSON(http.StatusBadGateway, gin.H{"error": "No se pudo extraer la información del sitio: " + err.Error()})
		return
	}

	log.Printf("✅ [Agent %d] ScrapeVehicleFromWebsite: ok en %s — año=%s km=%s color=%s", agent.ID, time.Since(start), data.Year, data.Mileage, data.Color)
	c.JSON(http.StatusOK, gin.H{"success": true, "vehicle": data})
}

func validateHTTPURL(raw string) (*url.URL, error) {
	parsed, err := url.ParseRequestURI(raw)
	if err != nil {
		return nil, err
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, err
	}
	return parsed, nil
}

/* ============================================
   SCRAPING EN LOTE (todo el inventario del sitio)
   ============================================
   Recorrer decenas de vehículos con un navegador headless puede tardar
   varios minutos — demasiado para que quede colgada una sola petición HTTP
   (y Railway/el proxy de por medio podrían cortarla). Por eso esto corre
   como un job en background: el POST lo arranca y responde de inmediato con
   un job_id, y el frontend consulta el progreso con GET .../status.

   Nota: el estado vive en memoria del proceso (no en la base de datos) —
   si el servidor se reinicia a la mitad, el job se pierde y hay que
   volver a arrancarlo. Solo se permite un job a la vez por agente.
*/

type websiteScrapeJob struct {
	Status    string                          `json:"status"` // "running" | "done" | "error"
	Done      int                             `json:"done"`
	Total     int                             `json:"total"`
	Results   []services.VehicleScrapeOutcome `json:"results,omitempty"`
	Error     string                          `json:"error,omitempty"`
	StartedAt time.Time                       `json:"started_at"`
}

var (
	websiteScrapeJobsMu sync.Mutex
	websiteScrapeJobs   = map[uint]*websiteScrapeJob{} // key: agent.ID
)

// StartScrapeAllVehicles — POST /api/inventory-website/:agent_id/scrape-all?url=...
// Arranca (si no hay uno ya corriendo para este agente) un job en background
// que recorre el listado completo del sitio y scrapea cada vehículo.
func (h *GoogleIntegrationHandler) StartScrapeAllVehicles(c *gin.Context) {
	agent, _, ok := h.getAgentForUser(c)
	if !ok {
		return
	}

	rawURL := c.Query("url")
	if rawURL == "" {
		log.Printf("⚠️ [Agent %d] StartScrapeAllVehicles: falta el parámetro url", agent.ID)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Falta la URL del listado de inventario"})
		return
	}
	if _, err := validateHTTPURL(rawURL); err != nil {
		log.Printf("⚠️ [Agent %d] StartScrapeAllVehicles: URL inválida — url=%q err=%v", agent.ID, rawURL, err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "URL inválida"})
		return
	}

	websiteScrapeJobsMu.Lock()
	if existing, ok := websiteScrapeJobs[agent.ID]; ok && existing.Status == "running" {
		websiteScrapeJobsMu.Unlock()
		log.Printf("⚠️ [Agent %d] StartScrapeAllVehicles: ya hay un job corriendo (done=%d/%d)", agent.ID, existing.Done, existing.Total)
		c.JSON(http.StatusConflict, gin.H{"error": "Ya hay una extracción en curso", "job": existing})
		return
	}
	job := &websiteScrapeJob{Status: "running", StartedAt: time.Now()}
	websiteScrapeJobs[agent.ID] = job
	websiteScrapeJobsMu.Unlock()

	log.Printf("🌐 [Agent %d] StartScrapeAllVehicles: iniciando lote — listado=%s", agent.ID, rawURL)

	go func(agentID uint, listingURL string) {
		// Job independiente de la petición HTTP original (que ya respondió) —
		// se le da su propio límite de tiempo generoso en vez de heredar el
		// contexto de la request, que se cancela apenas Gin devuelve la respuesta.
		bgCtx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
		defer cancel()

		results, err := services.ScrapeAllVehicles(bgCtx, listingURL, func(done, total int) {
			websiteScrapeJobsMu.Lock()
			if j, ok := websiteScrapeJobs[agentID]; ok {
				j.Done = done
				j.Total = total
			}
			websiteScrapeJobsMu.Unlock()
			log.Printf("🌐 [Agent %d] StartScrapeAllVehicles: progreso %d/%d", agentID, done, total)
		})

		websiteScrapeJobsMu.Lock()
		defer websiteScrapeJobsMu.Unlock()
		j, ok := websiteScrapeJobs[agentID]
		if !ok {
			return
		}
		if err != nil {
			log.Printf("❌ [Agent %d] StartScrapeAllVehicles: falló — err=%v", agentID, err)
			j.Status = "error"
			j.Error = err.Error()
			return
		}
		okCount := 0
		for _, r := range results {
			if r.Vehicle != nil {
				okCount++
			}
		}
		log.Printf("✅ [Agent %d] StartScrapeAllVehicles: terminado — %d/%d vehículos extraídos con éxito", agentID, okCount, len(results))
		j.Status = "done"
		j.Results = results
	}(agent.ID, rawURL)

	c.JSON(http.StatusAccepted, gin.H{"success": true, "job": job})
}

// GetScrapeAllStatus — GET /api/inventory-website/:agent_id/scrape-all/status
// Devuelve el progreso/resultado actual del job de scraping en lote de este agente.
func (h *GoogleIntegrationHandler) GetScrapeAllStatus(c *gin.Context) {
	agent, _, ok := h.getAgentForUser(c)
	if !ok {
		return
	}

	websiteScrapeJobsMu.Lock()
	job, ok := websiteScrapeJobs[agent.ID]
	websiteScrapeJobsMu.Unlock()

	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "No hay ninguna extracción en curso ni reciente"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "job": job})
}
