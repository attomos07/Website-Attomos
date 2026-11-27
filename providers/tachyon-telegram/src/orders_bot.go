package src

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
)

// BotOrderPayload datos del pedido para enviar al backend de Attomos
type BotOrderPayload struct {
	AgentID         uint                     `json:"agentId"`
	ClientName      string                   `json:"clientName"`
	ClientPhone     string                   `json:"clientPhone"`
	Items           []map[string]interface{} `json:"items"`
	Total           float64                  `json:"total"`
	OrderType       string                   `json:"orderType"`
	DeliveryAddress string                   `json:"deliveryAddress"`
	Status          string                   `json:"status"`
}

// SaveOrderToBackend guarda el pedido del bot en la BD de Attomos vía API REST.
// Devuelve el ID real del pedido creado (CreateBotOrder en el backend ya
// responde con "id": order.ID) para usarlo como referencia en los links de
// pago de Click/Payme.
func SaveOrderToBackend(payload BotOrderPayload) (uint, error) {
	attomosURL := os.Getenv("ATTOMOS_API_URL")
	botToken := os.Getenv("BOT_API_TOKEN")
	if attomosURL == "" || botToken == "" {
		return 0, fmt.Errorf("ATTOMOS_API_URL o BOT_API_TOKEN no configurados")
	}

	// Inyectar AgentID desde env si no viene
	if payload.AgentID == 0 {
		fmt.Sscanf(os.Getenv("AGENT_ID"), "%d", &payload.AgentID)
	}

	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return 0, fmt.Errorf("error serializando pedido: %w", err)
	}

	req, err := http.NewRequest("POST", attomosURL+"/api/bot/orders", bytes.NewBuffer(bodyBytes))
	if err != nil {
		return 0, fmt.Errorf("error creando request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+botToken)

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return 0, fmt.Errorf("error llamando API: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("API retornó %d: %s", resp.StatusCode, string(respBody))
	}

	var result struct {
		ID uint `json:"id"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		log.Printf("⚠️  [Backend] Pedido guardado pero no se pudo leer el ID: %v", err)
		return 0, nil
	}

	log.Printf("✅ [Backend] Pedido guardado en BD: %s", string(respBody))
	return result.ID, nil
}
