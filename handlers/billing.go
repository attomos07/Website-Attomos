package handlers

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"attomos/config"
	"attomos/models"

	"cloud.google.com/go/bigquery"
	"github.com/gin-gonic/gin"
	"google.golang.org/api/iterator"
	"google.golang.org/api/option"
)

type BillingResponse struct {
	Summary  BillingSummary  `json:"summary"`
	Timeline BillingTimeline `json:"timeline"`
}

type BillingSummary struct {
	Cost     float64 `json:"cost"`
	Currency string  `json:"currency"`
}

type BillingTimeline struct {
	Labels []string  `json:"labels"`
	Costs  []float64 `json:"costs"`
}

type DailyCostRow struct {
	Date string  `bigquery:"date"`
	Cost float64 `bigquery:"cost"`
}

// GetBillingData obtiene los costos REALES desde BigQuery
func GetBillingData(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "No autenticado",
		})
		return
	}

	user := userInterface.(*models.User)

	// Precargar proyecto GCP
	var gcpProject models.GoogleCloudProject
	err := config.DB.Where("user_id = ?", user.ID).First(&gcpProject).Error

	if err != nil || gcpProject.ProjectID == "" {
		c.JSON(http.StatusOK, generateEmptyBillingData(28))
		return
	}

	daysParam := c.DefaultQuery("days", "28")
	days, err := strconv.Atoi(daysParam)
	if err != nil || days <= 0 {
		days = 28
	}

	// Obtener datos REALES de BigQuery
	billingData, err := fetchBillingFromBigQuery(gcpProject.ProjectID, days)
	if err != nil {
		log.Printf("⚠️ [User %d] No se pueden obtener costos de BigQuery: %v", user.ID, err)
		log.Printf("ℹ️ Asegúrate de haber configurado Billing Export a BigQuery")

		// Retornar ceros si no hay billing export configurado
		c.JSON(http.StatusOK, generateEmptyBillingData(days))
		return
	}

	c.JSON(http.StatusOK, billingData)
}

// fetchBillingFromBigQuery consulta BigQuery para obtener costos del proyecto
func fetchBillingFromBigQuery(projectID string, days int) (*BillingResponse, error) {
	ctx := context.Background()

	// Configuración de BigQuery
	bigqueryProjectID := os.Getenv("GCP_BIGQUERY_PROJECT_ID")
	if bigqueryProjectID == "" {
		bigqueryProjectID = "attomos-billing" // Proyecto donde está el dataset de billing
	}

	datasetID := os.Getenv("GCP_BILLING_DATASET_ID")
	if datasetID == "" {
		datasetID = "billing_export" // Dataset por defecto
	}

	tableID := os.Getenv("GCP_BILLING_TABLE_ID")
	if tableID == "" {
		tableID = "gcp_billing_export_v1_*" // Tabla por defecto (wildcard)
	}

	// Obtener credenciales
	credOption, err := getCredentialsOption()
	if err != nil {
		return nil, fmt.Errorf("error obteniendo credenciales: %v", err)
	}

	// Crear cliente de BigQuery
	client, err := bigquery.NewClient(ctx, bigqueryProjectID, credOption)
	if err != nil {
		return nil, fmt.Errorf("error creando cliente BigQuery: %v", err)
	}
	defer client.Close()

	// Calcular fechas
	endDate := time.Now()
	startDate := endDate.AddDate(0, 0, -days)

	// Query SQL para obtener costos por día
	queryStr := fmt.Sprintf(`
		SELECT 
			DATE(usage_start_time) as date,
			SUM(cost) as cost
		FROM `+"`%s.%s.%s`"+`
		WHERE project.id = @projectID
		AND DATE(usage_start_time) >= @startDate
		AND DATE(usage_start_time) <= @endDate
		GROUP BY DATE(usage_start_time)
		ORDER BY date ASC
	`, bigqueryProjectID, datasetID, tableID)

	q := client.Query(queryStr)
	q.Parameters = []bigquery.QueryParameter{
		{
			Name:  "projectID",
			Value: projectID,
		},
		{
			Name:  "startDate",
			Value: startDate.Format("2006-01-02"),
		},
		{
			Name:  "endDate",
			Value: endDate.Format("2006-01-02"),
		},
	}

	// Ejecutar query
	it, err := q.Read(ctx)
	if err != nil {
		return nil, fmt.Errorf("error ejecutando query: %v", err)
	}

	// Leer resultados
	dailyCosts := make(map[string]float64)
	totalCost := 0.0

	for {
		var row DailyCostRow
		err := it.Next(&row)
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("error leyendo resultados: %v", err)
		}

		dailyCosts[row.Date] = row.Cost
		totalCost += row.Cost
	}

	// Construir timeline con acumulado
	labels := []string{}
	costs := []float64{}
	accumulated := 0.0

	for d := startDate; d.Before(endDate) || d.Equal(endDate); d = d.AddDate(0, 0, 1) {
		dateKey := d.Format("2006-01-02")
		displayDate := d.Format("Jan 02")

		labels = append(labels, displayDate)

		if cost, exists := dailyCosts[dateKey]; exists {
			accumulated += cost
		}

		costs = append(costs, accumulated)
	}

	log.Printf("✅ [Project %s] Costos obtenidos de BigQuery: $%.2f USD", projectID, totalCost)

	return &BillingResponse{
		Summary: BillingSummary{
			Cost:     totalCost,
			Currency: "USD",
		},
		Timeline: BillingTimeline{
			Labels: labels,
			Costs:  costs,
		},
	}, nil
}

// generateEmptyBillingData genera datos en cero
func generateEmptyBillingData(days int) *BillingResponse {
	labels := []string{}
	costs := []float64{}

	endDate := time.Now()
	startDate := endDate.AddDate(0, 0, -days)

	for d := startDate; d.Before(endDate) || d.Equal(endDate); d = d.AddDate(0, 0, 1) {
		dateStr := d.Format("Jan 02")
		labels = append(labels, dateStr)
		costs = append(costs, 0)
	}

	return &BillingResponse{
		Summary: BillingSummary{
			Cost:     0,
			Currency: "USD",
		},
		Timeline: BillingTimeline{
			Labels: labels,
			Costs:  costs,
		},
	}
}

// getCredentialsOption obtiene credenciales de GCP
func getCredentialsOption() (option.ClientOption, error) {
	jsonContent := os.Getenv("GCP_SERVICE_ACCOUNT_JSON")
	if jsonContent != "" {
		tmpFile, err := os.CreateTemp("", "gcp-*.json")
		if err != nil {
			return nil, err
		}

		if _, err := tmpFile.Write([]byte(jsonContent)); err != nil {
			tmpFile.Close()
			os.Remove(tmpFile.Name())
			return nil, err
		}

		tmpFileName := tmpFile.Name()
		tmpFile.Close()

		return option.WithCredentialsFile(tmpFileName), nil
	}

	credPath := os.Getenv("GCP_SERVICE_ACCOUNT_PATH")
	if credPath == "" {
		credPath = "./credentials/service-account.json"
	}

	if _, err := os.Stat(credPath); os.IsNotExist(err) {
		return nil, fmt.Errorf("credenciales no encontradas")
	}

	return option.WithCredentialsFile(credPath), nil
}
