package handlers

// gemini_auto.go — API key de Gemini automática (proyecto de Google Cloud
// por usuario) para WhatsApp Business (Orbital).
//
// Antes solo se intentaba al crear el PRIMER agente del usuario y, si la
// key fallaba, el proyecto quedaba "ready" sin key: nunca se reintentaba.
// ensureUserGeminiKey se usa al crear cualquier agente Orbital, al hacer
// Redeploy y desde el diagnóstico (?arreglar=1); solo crea algo si falta.

import (
	"fmt"
	"log"
	"sync"
	"time"

	"attomos/config"
	"attomos/google"
	"attomos/models"
)

var gcpEnsureMu sync.Mutex

// ensureUserGeminiKey regresa la API key del usuario; si no tiene, crea (o
// reutiliza) su proyecto de Google Cloud y la genera. Tarda hasta un par de
// minutos: llamarla en segundo plano.
func ensureUserGeminiKey(userID uint, email string) (string, error) {
	gcpEnsureMu.Lock()
	defer gcpEnsureMu.Unlock()

	var p models.GoogleCloudProject
	found := config.DB.Where("user_id = ?", userID).First(&p).Error == nil
	if found && p.GeminiAPIKey != "" {
		return p.GeminiAPIKey, nil
	}
	if found && p.ProjectStatus == "manual" {
		// Eligió en Planes poner su propia key: no se crea nada.
		return "", fmt.Errorf("el usuario eligió poner su propia API key (Integraciones)")
	}

	if !found {
		p = models.GoogleCloudProject{UserID: userID}
	}
	if p.ProjectID == "" {
		// Mismo id que usa CreateProjectForUser (y evita choques del índice
		// único con ids vacíos).
		p.ProjectID = fmt.Sprintf("attomos-user-%d", userID)
	}
	p.ProjectName = fmt.Sprintf("Attomos User %d", userID)
	p.MarkAsCreating()
	if found {
		config.DB.Save(&p)
	} else if err := config.DB.Create(&p).Error; err != nil {
		return "", fmt.Errorf("no se pudo registrar el proyecto: %v", err)
	}

	fail := func(err error) (string, error) {
		p.MarkAsError()
		config.DB.Save(&p)
		log.Printf("⚠️ [User %d] Gemini automática: %v", userID, err)
		return "", err
	}

	gca, err := google.NewGoogleCloudAutomation()
	if err != nil {
		return fail(fmt.Errorf("Google Cloud no disponible: %v", err))
	}
	projectID, apiKey, err := gca.CreateProjectForUser(userID, email)
	if projectID != "" {
		p.ProjectID = projectID
	}
	if err != nil {
		return fail(err)
	}
	if apiKey == "" {
		return fail(fmt.Errorf("Google Cloud no regresó la API key"))
	}
	p.GeminiAPIKey = apiKey
	now := time.Now()
	if p.GCPCreatedAt == nil {
		p.GCPCreatedAt = &now
	}
	p.MarkAsReady()
	config.DB.Save(&p)
	log.Printf("🎉 [User %d] API key de Gemini lista (proyecto %s)", userID, p.ProjectID)
	return apiKey, nil
}
