package services

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

type CloudflareService struct {
	apiToken string
	zoneID   string
	client   *http.Client
}

type CloudflareDNSRecord struct {
	ID      string `json:"id,omitempty"`
	Type    string `json:"type"`
	Name    string `json:"name"`
	Content string `json:"content"`
	TTL     int    `json:"ttl"`
	Proxied bool   `json:"proxied"`
}

type CloudflareResponse struct {
	Success bool                  `json:"success"`
	Errors  []CloudflareError     `json:"errors"`
	Result  []CloudflareDNSRecord `json:"result,omitempty"`
}

type CloudflareError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type CloudflareSingleResponse struct {
	Success bool                `json:"success"`
	Errors  []CloudflareError   `json:"errors"`
	Result  CloudflareDNSRecord `json:"result,omitempty"`
}

// NewCloudflareService crea una nueva instancia del servicio
func NewCloudflareService() (*CloudflareService, error) {
	apiToken := os.Getenv("CLOUDFLARE_API_TOKEN")
	if apiToken == "" {
		return nil, fmt.Errorf("CLOUDFLARE_API_TOKEN no está configurado")
	}

	zoneID := os.Getenv("CLOUDFLARE_ZONE_ID")
	if zoneID == "" {
		return nil, fmt.Errorf("CLOUDFLARE_ZONE_ID no está configurado")
	}

	return &CloudflareService{
		apiToken: apiToken,
		zoneID:   zoneID,
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}, nil
}

// CreateOrUpdateChatwootDNS crea o actualiza el registro DNS para el Chatwoot del usuario
func (c *CloudflareService) CreateOrUpdateChatwootDNS(serverIP string, userID uint) error {
	fmt.Println("\n╔═══════════════════════════════════════════════════════════════╗")
	fmt.Println("║           🌐 CONFIGURANDO DNS EN CLOUDFLARE                    ║")
	fmt.Println("╚═══════════════════════════════════════════════════════════════╝")

	// Subdominio único por usuario: chat-user123.attomos.com
	recordName := fmt.Sprintf("chat-user%d.attomos.com", userID)

	fmt.Printf("📍 Buscando registro DNS existente: %s\n", recordName)

	// 1. Buscar si ya existe el registro
	existingRecord, err := c.findDNSRecord(recordName)
	if err != nil {
		return fmt.Errorf("error buscando registro DNS: %v", err)
	}

	// 2. Si existe, actualizarlo. Si no, crearlo.
	if existingRecord != nil {
		fmt.Printf("🔄 Actualizando registro existente (ID: %s)\n", existingRecord.ID)
		fmt.Printf("   IP anterior: %s → Nueva IP: %s\n", existingRecord.Content, serverIP)

		if err := c.updateDNSRecord(existingRecord.ID, recordName, serverIP); err != nil {
			return fmt.Errorf("error actualizando registro DNS: %v", err)
		}

		fmt.Println("✅ Registro DNS actualizado exitosamente")
	} else {
		fmt.Printf("➕ Creando nuevo registro DNS\n")
		fmt.Printf("   Nombre: %s\n", recordName)
		fmt.Printf("   IP: %s\n", serverIP)

		if err := c.createDNSRecord(recordName, serverIP); err != nil {
			return fmt.Errorf("error creando registro DNS: %v", err)
		}

		fmt.Println("✅ Registro DNS creado exitosamente")
	}

	fmt.Println("\n📋 Información del DNS:")
	fmt.Printf("   🌐 Dominio: %s\n", recordName)
	fmt.Printf("   📍 IP: %s\n", serverIP)
	fmt.Printf("   🔒 Proxy: Activado (Cloudflare)\n")
	fmt.Printf("   ⏱️  TTL: Auto\n")
	fmt.Println("\n💡 El DNS puede tomar 1-5 minutos en propagarse")

	return nil
}

// findDNSRecord busca un registro DNS por nombre
func (c *CloudflareService) findDNSRecord(name string) (*CloudflareDNSRecord, error) {
	url := fmt.Sprintf("https://api.cloudflare.com/client/v4/zones/%s/dns_records?type=A&name=%s", c.zoneID, name)

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+c.apiToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("error HTTP %d: %s", resp.StatusCode, string(body))
	}

	var cfResp CloudflareResponse
	if err := json.Unmarshal(body, &cfResp); err != nil {
		return nil, err
	}

	if !cfResp.Success {
		if len(cfResp.Errors) > 0 {
			return nil, fmt.Errorf("error de Cloudflare: %s", cfResp.Errors[0].Message)
		}
		return nil, fmt.Errorf("error desconocido de Cloudflare")
	}

	if len(cfResp.Result) > 0 {
		return &cfResp.Result[0], nil
	}

	return nil, nil
}

// createDNSRecord crea un nuevo registro DNS tipo A
func (c *CloudflareService) createDNSRecord(name, ip string) error {
	url := fmt.Sprintf("https://api.cloudflare.com/client/v4/zones/%s/dns_records", c.zoneID)

	record := CloudflareDNSRecord{
		Type:    "A",
		Name:    name,
		Content: ip,
		TTL:     1,    // Auto
		Proxied: true, // Con proxy de Cloudflare
	}

	jsonData, err := json.Marshal(record)
	if err != nil {
		return err
	}

	req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return err
	}

	req.Header.Set("Authorization", "Bearer "+c.apiToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return fmt.Errorf("error HTTP %d: %s", resp.StatusCode, string(body))
	}

	var cfResp CloudflareSingleResponse
	if err := json.Unmarshal(body, &cfResp); err != nil {
		return err
	}

	if !cfResp.Success {
		if len(cfResp.Errors) > 0 {
			return fmt.Errorf("error de Cloudflare: %s", cfResp.Errors[0].Message)
		}
		return fmt.Errorf("error desconocido de Cloudflare")
	}

	return nil
}

// updateDNSRecord actualiza un registro DNS existente
func (c *CloudflareService) updateDNSRecord(recordID, recordName, ip string) error {
	url := fmt.Sprintf("https://api.cloudflare.com/client/v4/zones/%s/dns_records/%s", c.zoneID, recordID)

	record := CloudflareDNSRecord{
		Type:    "A",
		Name:    recordName,
		Content: ip,
		TTL:     1,
		Proxied: true,
	}

	jsonData, err := json.Marshal(record)
	if err != nil {
		return err
	}

	req, err := http.NewRequest("PUT", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return err
	}

	req.Header.Set("Authorization", "Bearer "+c.apiToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("error HTTP %d: %s", resp.StatusCode, string(body))
	}

	var cfResp CloudflareSingleResponse
	if err := json.Unmarshal(body, &cfResp); err != nil {
		return err
	}

	if !cfResp.Success {
		if len(cfResp.Errors) > 0 {
			return fmt.Errorf("error de Cloudflare: %s", cfResp.Errors[0].Message)
		}
		return fmt.Errorf("error desconocido de Cloudflare")
	}

	return nil
}

// DeleteDNSRecord elimina un registro DNS
func (c *CloudflareService) DeleteDNSRecord(name string) error {
	// Buscar el registro
	record, err := c.findDNSRecord(name)
	if err != nil {
		return err
	}

	if record == nil {
		return fmt.Errorf("registro DNS no encontrado: %s", name)
	}

	// Eliminar
	url := fmt.Sprintf("https://api.cloudflare.com/client/v4/zones/%s/dns_records/%s", c.zoneID, record.ID)

	req, err := http.NewRequest("DELETE", url, nil)
	if err != nil {
		return err
	}

	req.Header.Set("Authorization", "Bearer "+c.apiToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("error HTTP %d: %s", resp.StatusCode, string(body))
	}

	return nil
}

// DeleteChatwootDNS elimina el registro DNS de Chatwoot del usuario
func (c *CloudflareService) DeleteChatwootDNS(userID uint) error {
	recordName := fmt.Sprintf("chat-user%d.attomos.com", userID)
	return c.DeleteDNSRecord(recordName)
}

// GetDNSRecordIP obtiene la IP actual de un registro DNS
func (c *CloudflareService) GetDNSRecordIP(name string) (string, error) {
	record, err := c.findDNSRecord(name)
	if err != nil {
		return "", err
	}

	if record == nil {
		return "", fmt.Errorf("registro DNS no encontrado: %s", name)
	}

	return record.Content, nil
}
