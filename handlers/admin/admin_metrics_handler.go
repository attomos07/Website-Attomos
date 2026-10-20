package admin

// admin_metrics_handler.go — panel superadmin: métricas de recursos en vivo
// de todos los bots (CPU, RAM, goroutines, tamaño de sesión, disco),
// recolectadas vía el WebSocket del CRM (ver crm_hub.go y, del lado del
// bot, crm_bridge.go + metrics.go). No requiere SSH ni tocar Hetzner: el
// bot manda sus propias métricas, el hub las guarda en memoria, este
// endpoint solo las lee y las cruza con el nombre del agente/negocio.

import (
	"net/http"
	"sort"

	"attomos/config"
	"attomos/models"

	"attomos/realtime"
	"github.com/gin-gonic/gin"
)

// AdminBotMetricsRow es una fila de la tabla del panel — un bot.
type AdminBotMetricsRow struct {
	AgentID       uint    `json:"agentId"`
	AgentName     string  `json:"agentName"`
	BusinessName  string  `json:"businessName"`
	BotType       string  `json:"botType"`
	ServerIP      string  `json:"serverIp,omitempty"` // solo OrbitalBot (servidor propio)
	Connected     bool    `json:"connected"`
	HasMetrics    bool    `json:"hasMetrics"` // false = nunca reportó (bot viejo/recién creado)
	CPUPercent    float64 `json:"cpuPercent"`
	MemRSSMB      float64 `json:"memRssMb"`
	Goroutines    int     `json:"goroutines"`
	UptimeSeconds int64   `json:"uptimeSeconds"`
	DBSizeMB      float64 `json:"dbSizeMb"`
	DiskFreeGB    float64 `json:"diskFreeGb"`
	LastUpdated   int64   `json:"lastUpdated"` // unix ms, 0 si nunca reportó
}

// GetAdminMetrics regresa una fila por cada agente con bot (AtomicBot,
// OrbitalBot o TelegramBot) que exista en la plataforma, con sus últimas
// métricas conocidas — para que el panel muestre también los que están
// desconectados o nunca han reportado, no solo los que sí.
//
// GET /admin/api/metrics — protegido por middleware.AdminRequired(), mismo
// grupo que /admin/api/companies.
func GetAdminMetrics(c *gin.Context) {
	snapshots := realtime.CRMHub.GetAllMetrics()

	var agents []models.Agent
	config.DB.Find(&agents)

	var branches []models.MyBusinessInfo
	config.DB.Find(&branches)
	branchByID := make(map[uint]models.MyBusinessInfo, len(branches))
	for _, b := range branches {
		branchByID[b.ID] = b
	}

	rows := make([]AdminBotMetricsRow, 0, len(agents))
	for _, agent := range agents {
		businessName := agent.Name
		if agent.BranchID > 0 {
			if b, ok := branchByID[agent.BranchID]; ok && b.BusinessName != "" {
				businessName = b.BusinessName
			}
		}

		row := AdminBotMetricsRow{
			AgentID:      agent.ID,
			AgentName:    agent.Name,
			BusinessName: businessName,
			BotType:      agent.BotType,
			ServerIP:     agent.ServerIP,
			Connected:    realtime.CRMHub.IsBotConnected(agent.ID),
		}

		if snap, ok := snapshots[agent.ID]; ok {
			row.HasMetrics = true
			row.CPUPercent = snap.CPUPercent
			row.MemRSSMB = snap.MemRSSMB
			row.Goroutines = snap.Goroutines
			row.UptimeSeconds = snap.UptimeSeconds
			row.DBSizeMB = snap.DBSizeMB
			row.DiskFreeGB = snap.DiskFreeGB
			row.LastUpdated = snap.UpdatedAt
		}

		rows = append(rows, row)
	}

	// Conectados primero, y entre ellos el que más CPU está usando arriba
	// (lo más probable que quieras revisar primero).
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].Connected != rows[j].Connected {
			return rows[i].Connected
		}
		return rows[i].CPUPercent > rows[j].CPUPercent
	})

	connectedCount := 0
	var totalCPU, totalMemMB float64
	for _, r := range rows {
		if r.Connected {
			connectedCount++
			totalCPU += r.CPUPercent
			totalMemMB += r.MemRSSMB
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"agents": rows,
		"summary": gin.H{
			"total":       len(rows),
			"connected":   connectedCount,
			"totalCpuPct": totalCPU,
			"totalMemMb":  totalMemMB,
		},
	})
}
