package handlers

import (
	"log"
	"net/http"

	"attomos/config"
	"attomos/models"

	"github.com/gin-gonic/gin"
)

// ServiceStat represents a service with its request count
type ServiceStat struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

// ServicesStatisticsResponse is the response for the services statistics endpoint
type ServicesStatisticsResponse struct {
	MostRequested  []ServiceStat `json:"mostRequested"`
	LeastRequested []ServiceStat `json:"leastRequested"`
	Total          int           `json:"total"`
}

// GetServicesStatistics returns the most and least requested services
// calculated from the appointments table for the authenticated user.
// It queries the `service` field, groups by name, and counts occurrences.
func GetServicesDashboardStats(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	user := userInterface.(*models.User)

	// ── Query: group appointments by service name, count occurrences ──
	type serviceCount struct {
		Service string
		Count   int
	}

	var results []serviceCount
	err := config.DB.
		Model(&models.Appointment{}).
		Select("service, COUNT(*) as count").
		Where("user_id = ? AND service != '' AND service IS NOT NULL", user.ID).
		Group("service").
		Order("count DESC").
		Scan(&results).Error

	if err != nil {
		log.Printf("❌ [User %d] Error fetching service stats: %v", user.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error fetching service statistics"})
		return
	}

	if len(results) == 0 {
		c.JSON(http.StatusOK, ServicesStatisticsResponse{
			MostRequested:  []ServiceStat{},
			LeastRequested: []ServiceStat{},
			Total:          0,
		})
		return
	}

	// ── Build full list ───────────────────────────────────────────
	all := make([]ServiceStat, len(results))
	total := 0
	for i, r := range results {
		all[i] = ServiceStat{Name: r.Service, Count: r.Count}
		total += r.Count
	}

	// ── Top 5 most requested (already sorted DESC) ────────────────
	topN := 5
	if len(all) < topN {
		topN = len(all)
	}
	mostRequested := all[:topN]

	// ── Bottom 5 least requested (reverse the tail) ───────────────
	leastN := 5
	if len(all) < leastN {
		leastN = len(all)
	}
	tail := all[len(all)-leastN:]
	leastRequested := make([]ServiceStat, leastN)
	for i, s := range tail {
		leastRequested[leastN-1-i] = s
	}

	// If all services fit in top 5, least = same reversed
	if len(all) <= 5 {
		leastRequested = make([]ServiceStat, len(all))
		for i, s := range all {
			leastRequested[len(all)-1-i] = s
		}
	}

	log.Printf("✅ [User %d] Service stats: %d unique services, %d total appointments", user.ID, len(all), total)

	c.JSON(http.StatusOK, ServicesStatisticsResponse{
		MostRequested:  mostRequested,
		LeastRequested: leastRequested,
		Total:          total,
	})
}
