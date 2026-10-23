package google

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	apikeys "google.golang.org/api/apikeys/v2"
	cloudbilling "google.golang.org/api/cloudbilling/v1"
	cloudresourcemanager "google.golang.org/api/cloudresourcemanager/v3"
	"google.golang.org/api/option"
	serviceusage "google.golang.org/api/serviceusage/v1"
)

type GoogleCloudAutomation struct {
	ctx              context.Context
	projectsService  *cloudresourcemanager.ProjectsService
	servicesService  *serviceusage.Service
	apiKeysService   *apikeys.Service
	billingService   *cloudbilling.APIService
	organizationID   string
	billingAccountID string
}

// getCredentialsOption obtiene las credenciales según el entorno
func getCredentialsOption() (option.ClientOption, error) {
	// Prioridad 1: JSON completo en variable (Railway/producción)
	jsonContent := os.Getenv("GCP_SERVICE_ACCOUNT_JSON")
	if jsonContent != "" {
		log.Printf("📋 Usando credenciales desde variable de entorno (%d bytes)", len(jsonContent))

		// Crear archivo temporal
		tmpFile, err := os.CreateTemp("", "gcp-*.json")
		if err != nil {
			return nil, fmt.Errorf("error creando archivo temporal: %v", err)
		}

		// Escribir contenido JSON al archivo temporal
		if _, err := tmpFile.Write([]byte(jsonContent)); err != nil {
			tmpFile.Close()
			os.Remove(tmpFile.Name())
			return nil, fmt.Errorf("error escribiendo credenciales: %v", err)
		}

		// Cerrar el archivo antes de usarlo
		tmpFileName := tmpFile.Name()
		tmpFile.Close()

		log.Printf("✅ Archivo temporal creado: %s", tmpFileName)

		// Devolver opción con el path del archivo temporal
		return option.WithCredentialsFile(tmpFileName), nil
	}

	// Prioridad 2: Path a archivo (desarrollo local)
	credPath := os.Getenv("GCP_SERVICE_ACCOUNT_PATH")
	if credPath == "" {
		credPath = "./credentials/service-account.json"
	}

	log.Printf("📁 Usando credenciales desde archivo: %s", credPath)

	// Verificar que existe
	if _, err := os.Stat(credPath); os.IsNotExist(err) {
		return nil, fmt.Errorf("archivo de credenciales no encontrado: %s", credPath)
	}

	return option.WithCredentialsFile(credPath), nil
}

// NewGoogleCloudAutomation inicializa el servicio de automatización
func NewGoogleCloudAutomation() (*GoogleCloudAutomation, error) {
	ctx := context.Background()

	orgID := os.Getenv("GCP_ORGANIZATION_ID")
	billingID := os.Getenv("GCP_BILLING_ACCOUNT_ID")

	if orgID == "" {
		return nil, fmt.Errorf("falta variable: GCP_ORGANIZATION_ID")
	}
	if billingID == "" {
		return nil, fmt.Errorf("falta variable: GCP_BILLING_ACCOUNT_ID")
	}

	credOption, err := getCredentialsOption()
	if err != nil {
		return nil, fmt.Errorf("error obteniendo credenciales: %v", err)
	}

	// Resource Manager (crear/gestionar proyectos)
	rmService, err := cloudresourcemanager.NewService(ctx, credOption)
	if err != nil {
		return nil, fmt.Errorf("error creando resource manager: %v", err)
	}

	// Service Usage (habilitar APIs)
	suService, err := serviceusage.NewService(ctx, credOption)
	if err != nil {
		return nil, fmt.Errorf("error creando service usage: %v", err)
	}

	// API Keys (crear API keys)
	akService, err := apikeys.NewService(ctx, credOption)
	if err != nil {
		return nil, fmt.Errorf("error creando api keys: %v", err)
	}

	// Billing (vincular billing)
	billService, err := cloudbilling.NewService(ctx, credOption)
	if err != nil {
		return nil, fmt.Errorf("error creando billing: %v", err)
	}

	log.Println("✅ Google Cloud Automation inicializado")

	return &GoogleCloudAutomation{
		ctx:              ctx,
		projectsService:  rmService.Projects,
		servicesService:  suService,
		apiKeysService:   akService,
		billingService:   billService,
		organizationID:   orgID,
		billingAccountID: billingID,
	}, nil
}

// CreateProjectForUser crea un proyecto completo de GCP para un usuario
func (gca *GoogleCloudAutomation) CreateProjectForUser(userID uint, userEmail string) (string, string, error) {
	projectID := fmt.Sprintf("attomos-user-%d", userID)

	log.Printf("📄 [User %d] Iniciando creación de proyecto: %s", userID, projectID)

	// 1. Crear proyecto
	project := &cloudresourcemanager.Project{
		ProjectId:   projectID,
		DisplayName: fmt.Sprintf("Attomos User %d", userID),
		Parent:      fmt.Sprintf("organizations/%s", gca.organizationID),
		Labels: map[string]string{
			"user-id":     fmt.Sprintf("%d", userID),
			"environment": "production",
			"managed-by":  "attomos",
		},
	}

	_, err := gca.projectsService.Create(project).Do()
	if err != nil {
		if !isAlreadyExistsError(err) {
			log.Printf("⚠️ [User %d] Error creando proyecto (continuando sin GCP): %v", userID, err)
			return "", "", fmt.Errorf("error creando proyecto: %v", err)
		}
		// El proyecto ya existe (p. ej. la BD perdió el estado o se reintentó
		// el primer agente): reutilizarlo en lugar de quedarse sin API key.
		log.Printf("♻️ [User %d] El proyecto %s ya existe — se reutiliza", userID, projectID)
	} else {
		log.Printf("✅ [User %d] Proyecto creado: %s", userID, projectID)
	}

	// 2. Esperar a que esté activo
	if err := gca.waitForProjectReady(projectID, userID); err != nil {
		log.Printf("⚠️ [User %d] Proyecto no está listo (continuando): %v", userID, err)
		return projectID, "", err
	}

	// 3. Vincular billing (NO BLOQUEANTE)
	if err := gca.linkBilling(projectID, userID); err != nil {
		log.Printf("⚠️ [User %d] Error vinculando billing (NO CRÍTICO): %v", userID, err)
		// NO RETORNAR - CONTINUAR
	}

	// 4. Habilitar APIs necesarias (NO BLOQUEANTE)
	if err := gca.enableAPIs(projectID, userID); err != nil {
		log.Printf("⚠️ [User %d] Error habilitando APIs (NO CRÍTICO): %v", userID, err)
		// NO RETORNAR - CONTINUAR
	}

	// 5. Obtener (o crear) API Key de Gemini (NO BLOQUEANTE)
	apiKey, err := gca.getOrCreateAPIKey(projectID, userID)
	if err != nil {
		log.Printf("⚠️ [User %d] Error creando API Key (NO CRÍTICO): %v", userID, err)
		log.Printf("ℹ️ [User %d] Puedes crear la API Key manualmente en Google Cloud Console", userID)
		// NO RETORNAR - CONTINUAR SIN API KEY
		return projectID, "", nil
	}

	log.Printf("🎉 [User %d] Proyecto completo con API Key", userID)

	return projectID, apiKey, nil
}

// waitForProjectReady espera a que el proyecto esté activo
func (gca *GoogleCloudAutomation) waitForProjectReady(projectID string, userID uint) error {
	log.Printf("⏳ [User %d] Esperando que proyecto esté activo...", userID)

	maxRetries := 30
	for i := 0; i < maxRetries; i++ {
		proj, err := gca.projectsService.Get(fmt.Sprintf("projects/%s", projectID)).Do()

		if err == nil && proj.State == "ACTIVE" {
			log.Printf("✅ [User %d] Proyecto activo", userID)
			return nil
		}

		if err != nil {
			log.Printf("⚠️ [User %d] Error verificando proyecto (intento %d/%d): %v", userID, i+1, maxRetries, err)
		}

		if i < maxRetries-1 {
			time.Sleep(2 * time.Second)
		}
	}

	return fmt.Errorf("timeout esperando que proyecto esté activo")
}

// linkBilling vincula el billing account al proyecto
func (gca *GoogleCloudAutomation) linkBilling(projectID string, userID uint) error {
	log.Printf("💳 [User %d] Vinculando billing account...", userID)

	billingInfo := &cloudbilling.ProjectBillingInfo{
		BillingAccountName: fmt.Sprintf("billingAccounts/%s", gca.billingAccountID),
	}

	projectName := fmt.Sprintf("projects/%s", projectID)
	projectsService := cloudbilling.NewProjectsService(gca.billingService)
	_, err := projectsService.UpdateBillingInfo(projectName, billingInfo).Do()

	if err != nil {
		log.Printf("⚠️ [User %d] Error vinculando billing (NO CRÍTICO): %v", userID, err)
		return fmt.Errorf("error vinculando billing: %v", err)
	}

	log.Printf("✅ [User %d] Billing vinculado", userID)
	return nil
}

// enableAPIs habilita las APIs necesarias
func (gca *GoogleCloudAutomation) enableAPIs(projectID string, userID uint) error {
	log.Printf("🔌 [User %d] Habilitando APIs...", userID)

	apis := []string{
		"generativelanguage.googleapis.com", // Gemini API
	}

	hasErrors := false
	for _, api := range apis {
		serviceName := fmt.Sprintf("projects/%s/services/%s", projectID, api)

		_, err := gca.servicesService.Services.Enable(serviceName,
			&serviceusage.EnableServiceRequest{}).Do()

		if err != nil && !isAlreadyEnabledError(err) {
			log.Printf("⚠️ [User %d] Error habilitando %s (NO CRÍTICO): %v", userID, api, err)
			hasErrors = true
		}
	}

	if !hasErrors {
		// Esperar a que las APIs estén completamente activas
		time.Sleep(10 * time.Second)
		log.Printf("✅ [User %d] APIs habilitadas", userID)
	} else {
		log.Printf("⚠️ [User %d] Algunas APIs no se habilitaron (puedes hacerlo manualmente)", userID)
	}

	return nil
}

// createAPIKey crea una API Key de Gemini
func (gca *GoogleCloudAutomation) createAPIKey(projectID string, userID uint) (string, error) {
	log.Printf("🔑 [User %d] Creando API Key...", userID)

	parent := fmt.Sprintf("projects/%s/locations/global", projectID)

	keyRequest := &apikeys.V2Key{
		DisplayName: fmt.Sprintf("Attomos User %d - Gemini Key", userID),
		Restrictions: &apikeys.V2Restrictions{
			ApiTargets: []*apikeys.V2ApiTarget{
				{
					Service: "generativelanguage.googleapis.com",
				},
			},
		},
	}

	// Crear la key
	op, err := gca.apiKeysService.Projects.Locations.Keys.Create(parent, keyRequest).Do()
	if err != nil {
		log.Printf("⚠️ [User %d] Error creando API key (NO CRÍTICO): %v", userID, err)
		return "", fmt.Errorf("error creando API key: %v", err)
	}

	// Obtener el nombre de la key desde los metadatos de la operación
	var keyName string
	if len(op.Response) > 0 {
		var responseData map[string]interface{}
		if err := json.Unmarshal(op.Response, &responseData); err == nil {
			if name, ok := responseData["name"].(string); ok {
				keyName = name
			}
		}
	}

	// Si no pudimos obtener el nombre de la respuesta, intentar construirlo
	if keyName == "" {
		// Listar las keys del proyecto para obtener la más reciente
		log.Printf("⏳ [User %d] Buscando API Key creada...", userID)
		time.Sleep(3 * time.Second) // Breve espera para que se cree

		listResp, err := gca.apiKeysService.Projects.Locations.Keys.List(parent).Do()
		if err != nil {
			log.Printf("⚠️ [User %d] Error listando API keys (NO CRÍTICO): %v", userID, err)
			return "", fmt.Errorf("error listando API keys: %v", err)
		}

		if len(listResp.Keys) == 0 {
			log.Printf("⚠️ [User %d] No se encontró ninguna API key después de crearla", userID)
			return "", fmt.Errorf("no se encontró ninguna API key después de crearla")
		}

		// Obtener la última key (la más reciente)
		keyName = listResp.Keys[len(listResp.Keys)-1].Name
	}

	log.Printf("🔑 [User %d] Obteniendo KeyString para: %s", userID, keyName)

	// Usar GetKeyString para obtener el valor de la API Key
	keyStringResp, err := gca.apiKeysService.Projects.Locations.Keys.GetKeyString(keyName).Do()
	if err != nil {
		log.Printf("⚠️ [User %d] Error obteniendo KeyString (NO CRÍTICO): %v", userID, err)
		return "", fmt.Errorf("error obteniendo KeyString: %v", err)
	}

	if keyStringResp.KeyString == "" {
		log.Printf("⚠️ [User %d] La API key fue creada pero no tiene KeyString", userID)
		return "", fmt.Errorf("la API key fue creada pero no tiene KeyString")
	}

	log.Printf("✅ [User %d] API Key creada exitosamente", userID)

	return keyStringResp.KeyString, nil
}

// DeleteProject elimina un proyecto (cuando se elimina el usuario)
func (gca *GoogleCloudAutomation) DeleteProject(projectID string) error {
	log.Printf("🗑️ Eliminando proyecto: %s", projectID)

	projectName := fmt.Sprintf("projects/%s", projectID)
	_, err := gca.projectsService.Delete(projectName).Do()

	if err != nil {
		return fmt.Errorf("error eliminando proyecto: %v", err)
	}

	log.Printf("✅ Proyecto %s marcado para eliminación", projectID)
	return nil
}

// getOrCreateAPIKey reutiliza la API key de Gemini que Attomos ya creó en el
// proyecto (por DisplayName) y solo crea una nueva si no existe.
func (gca *GoogleCloudAutomation) getOrCreateAPIKey(projectID string, userID uint) (string, error) {
	parent := fmt.Sprintf("projects/%s/locations/global", projectID)
	displayName := fmt.Sprintf("Attomos User %d - Gemini Key", userID)

	listResp, err := gca.apiKeysService.Projects.Locations.Keys.List(parent).Do()
	if err == nil {
		for _, key := range listResp.Keys {
			if key.DisplayName != displayName || key.DeleteTime != "" {
				continue
			}
			keyStringResp, err := gca.apiKeysService.Projects.Locations.Keys.GetKeyString(key.Name).Do()
			if err == nil && keyStringResp.KeyString != "" {
				log.Printf("♻️ [User %d] Reutilizando API Key existente: %s", userID, key.Name)
				return keyStringResp.KeyString, nil
			}
		}
	} else {
		log.Printf("⚠️ [User %d] No se pudieron listar API keys (se intentará crear una): %v", userID, err)
	}

	return gca.createAPIKey(projectID, userID)
}

// Helper functions

func isAlreadyExistsError(err error) bool {
	if err == nil {
		return false
	}
	errStr := strings.ToLower(err.Error())
	return strings.Contains(errStr, "alreadyexists") ||
		strings.Contains(errStr, "already exists") ||
		strings.Contains(errStr, "error 409")
}

func isAlreadyEnabledError(err error) bool {
	if err == nil {
		return false
	}
	errStr := strings.ToLower(err.Error())
	return strings.Contains(errStr, "already enabled") ||
		strings.Contains(errStr, "already_exists")
}
