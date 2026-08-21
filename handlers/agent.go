package handlers

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"net/http"
	"strings"
	"time"

	"attomos/config"
	"attomos/models"
	"attomos/services"

	"github.com/gin-gonic/gin"
)

type CreateAgentRequest struct {
	Name         string             `json:"name"`
	PhoneNumber  string             `json:"phoneNumber"`
	BusinessType string             `json:"businessType"`
	MetaDocument string             `json:"metaDocument"`
	BranchID     uint               `json:"branchId"`
	Social       string             `json:"social"` // "whatsapp" | "telegram" | "meta" | ...
	Config       models.AgentConfig `json:"config"`
}

// CreateAgent crea un nuevo agente
func CreateAgent(c *gin.Context) {
	bodyBytes, _ := ioutil.ReadAll(c.Request.Body)
	log.Printf("🔍 [DEBUG] Payload completo recibido:\n%s", string(bodyBytes))
	c.Request.Body = ioutil.NopCloser(bytes.NewBuffer(bodyBytes))

	var req CreateAgentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		log.Printf("❌ Error al parsear JSON: %v", err)
		if jsonErr, ok := err.(*json.UnmarshalTypeError); ok {
			log.Printf("❌ [DEBUG] Campo problemático: %s", jsonErr.Field)
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos inválidos", "details": err.Error()})
		return
	}

	if req.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "El nombre del agente es requerido"})
		return
	}

	log.Printf("📋 [CreateAgent] Name=%s Phone=%s BusinessType=%s Social=%s",
		req.Name, req.PhoneNumber, req.BusinessType, req.Social)

	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}
	user := userInterface.(*models.User)

	// Obtener o crear suscripción activa
	var subscription models.Subscription
	err := config.DB.Where("user_id = ? AND status IN (?)", user.ID, []string{"active", "trialing"}).First(&subscription).Error
	if err != nil {
		log.Printf("⚠️  [User %d] Sin suscripción activa, creando plan gratuito...", user.ID)
		now := time.Now()
		oneYearLater := now.AddDate(1, 0, 0)
		subscription = models.Subscription{
			UserID:             user.ID,
			Plan:               "gratuito",
			BillingCycle:       "monthly",
			Status:             "active",
			CurrentPeriodStart: &now,
			CurrentPeriodEnd:   &oneYearLater,
			Amount:             0,
			Currency:           "mxn",
		}
		subscription.SetPlanLimits()
		if err := config.DB.Create(&subscription).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al verificar suscripción"})
			return
		}
	}

	// ── Determinar botType según la plataforma seleccionada ──────────────────
	var botType string
	switch strings.ToLower(req.Social) {
	case "whatsapp":
		botType = "atomic"
		log.Printf("📋 [User %d] social=whatsapp → AtomicBot (WhatsApp Web)", user.ID)
	case "telegram":
		botType = "telegram"
		log.Printf("📋 [User %d] social=telegram → TelegramBot", user.ID)
	default:
		// meta, facebook, instagram, etc. → OrbitalBot
		// Plan gratuito sin social especificado → AtomicBot por defecto
		if subscription.Plan == "gratuito" && req.Social == "" {
			botType = "atomic"
			log.Printf("📋 [User %d] Plan gratuito sin social → AtomicBot", user.ID)
		} else {
			botType = "orbital"
			log.Printf("📋 [User %d] social=%s → OrbitalBot", user.ID, req.Social)
		}
	}

	// ── Para Telegram: si no viene phoneNumber, tomar el de la sucursal ──────
	// El campo phoneNumber se reutiliza para el TELEGRAM_BOT_TOKEN.
	// Si el usuario no lo llenó en el onboarding, usamos el teléfono de la
	// sucursal como fallback para que el .env no quede vacío.
	if botType == "telegram" && req.PhoneNumber == "" && req.BranchID > 0 {
		var branch models.MyBusinessInfo
		if err := config.DB.First(&branch, req.BranchID).Error; err == nil && branch.PhoneNumber != "" {
			req.PhoneNumber = branch.PhoneNumber
			log.Printf("📋 [User %d] Telegram sin token — usando teléfono de sucursal: %s", user.ID, req.PhoneNumber)
		} else if user.PhoneNumber != "" {
			// Fallback al teléfono del usuario registrado
			req.PhoneNumber = user.PhoneNumber
			log.Printf("📋 [User %d] Telegram sin token — usando teléfono del usuario: %s", user.ID, req.PhoneNumber)
		}
	}

	if req.BusinessType == "" {
		req.BusinessType = user.BusinessType
	}

	var agentCount int64
	config.DB.Model(&models.Agent{}).Where("user_id = ?", user.ID).Count(&agentCount)

	maxAgents := int64(5)
	if agentCount >= maxAgents {
		c.JSON(http.StatusForbidden, gin.H{
			"error":   "Límite alcanzado",
			"message": fmt.Sprintf("Has alcanzado el límite de %d agentes.", maxAgents),
		})
		return
	}

	// Procesar documento Meta (si existe)
	var metaDocFilename string
	var docData []byte
	if req.MetaDocument != "" {
		base64Data := req.MetaDocument
		if idx := strings.Index(base64Data, ","); idx != -1 {
			base64Data = base64Data[idx+1:]
		}
		var err error
		docData, err = base64.StdEncoding.DecodeString(base64Data)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Error al procesar el documento"})
			return
		}
		metaDocFilename = fmt.Sprintf("user_%d_%d_%s.pdf", user.ID, time.Now().Unix(), sanitizeFilename(req.Name))
		log.Printf("✅ Documento: %s (%d bytes)", metaDocFilename, len(docData))
	}

	nextPort := 3001 + int(agentCount)

	agent := models.Agent{
		UserID:       user.ID,
		Name:         req.Name,
		PhoneNumber:  req.PhoneNumber,
		BusinessType: req.BusinessType,
		MetaDocument: metaDocFilename,
		BranchID:     req.BranchID,
		Config:       req.Config,
		Port:         nextPort,
		DeployStatus: "pending",
		IsActive:     false,
		BotType:      botType,
	}

	if err := config.DB.Create(&agent).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al crear el agente"})
		return
	}

	log.Printf("✅ Agente creado en BD: ID=%d Port=%d BotType=%s", agent.ID, agent.Port, agent.BotType)

	// Sincronizar servicios/trabajadores/festivos → my_business_info
	if req.BranchID > 0 {
		if isGovBusinessType(req.BusinessType) {
			go syncOnboardingToAgency(user.ID, req.BranchID, req.Config)
		} else {
			go syncOnboardingToBranch(req.BranchID, req.Config)
		}
	}

	// Respuesta inmediata — el deploy ocurre de forma asíncrona
	c.JSON(http.StatusAccepted, gin.H{
		"message": "Agente en proceso de creación",
		"agent":   agent,
		"status":  "pending",
	})

	// ── PROCESO ASÍNCRONO DE DEPLOY ──────────────────────────────────────────
	go func() {
		log.Println("\n" + strings.Repeat("═", 80))
		log.Printf("║ %s ║", centerText("🚀 INICIO DE PROCESO DE CREACIÓN", 76))
		log.Printf("║ %s ║", centerText(fmt.Sprintf("Agente ID: %d | Usuario ID: %d | Tipo: %s", agent.ID, user.ID, agent.BotType), 76))
		log.Println(strings.Repeat("═", 80))

		config.DB.Preload("GoogleCloudProject").First(&user, user.ID)
		isFirstAgent := agentCount == 0

		if agent.IsAtomicBot() {
			// ────────────────────────────────────────────────────────────────
			// ATOMIC BOT (WhatsApp Web) — servidor compartido global
			// ────────────────────────────────────────────────────────────────
			log.Println("\n" + strings.Repeat("═", 80))
			log.Printf("║ %s ║", centerText("DESPLIEGUE DE ATOMIC BOT (GO)", 76))
			log.Println(strings.Repeat("═", 80))

			serverManager := services.GetGlobalServerManager()
			globalServer, err := serverManager.GetOrCreateAtomicBotsServer()
			if err != nil {
				log.Printf("❌ [Agent %d] Error obteniendo servidor compartido: %v", agent.ID, err)
				agent.DeployStatus = "error"
				config.DB.Model(&agent).Updates(map[string]interface{}{"deploy_status": agent.DeployStatus})
				return
			}

			if globalServer.Status == "initializing" {
				log.Printf("⏳ [Agent %d] Servidor compartido inicializándose, esperando...", agent.ID)
				timeout := time.After(20 * time.Minute)
				ticker := time.NewTicker(30 * time.Second)
				defer ticker.Stop()
				for {
					select {
					case <-timeout:
						log.Printf("❌ [Agent %d] Timeout esperando servidor compartido", agent.ID)
						agent.DeployStatus = "error"
						config.DB.Model(&agent).Updates(map[string]interface{}{"deploy_status": agent.DeployStatus})
						return
					case <-ticker.C:
						updatedServer, err := serverManager.GetServerStatus(globalServer.ID)
						if err != nil {
							continue
						}
						if updatedServer.IsReady() {
							globalServer = updatedServer
							goto AtomicServerReady
						}
						log.Printf("⏳ [Agent %d] Servidor aún inicializando...", agent.ID)
					}
				}
			}

		AtomicServerReady:
			if !globalServer.IsReady() {
				log.Printf("❌ [Agent %d] Servidor compartido no está listo (Status: %s)", agent.ID, globalServer.Status)
				agent.DeployStatus = "error"
				config.DB.Model(&agent).Updates(map[string]interface{}{"deploy_status": agent.DeployStatus})
				return
			}

			assignedPort, err := serverManager.AssignPortToAgent(globalServer)
			if err != nil {
				log.Printf("❌ [Agent %d] Error asignando puerto: %v", agent.ID, err)
				agent.DeployStatus = "error"
				config.DB.Model(&agent).Updates(map[string]interface{}{"deploy_status": agent.DeployStatus})
				return
			}
			agent.Port = assignedPort
			config.DB.Model(&agent).Updates(map[string]interface{}{"port": agent.Port})

			log.Printf("✅ [Agent %d] Servidor compartido: IP=%s Puerto=%d", agent.ID, globalServer.IPAddress, assignedPort)

			agent.DeployStatus = "deploying"
			config.DB.Model(&agent).Updates(map[string]interface{}{"deploy_status": agent.DeployStatus})

			atomicService := services.NewAtomicBotDeployService(globalServer.IPAddress, globalServer.RootPassword)

			maxRetries := 10
			retryDelay := 10 * time.Second
			var connectErr error
			for attempt := 1; attempt <= maxRetries; attempt++ {
				log.Printf("🔌 [Agent %d] Intento SSH %d/%d...", agent.ID, attempt, maxRetries)
				connectErr = atomicService.Connect()
				if connectErr == nil {
					log.Printf("✅ [Agent %d] Conectado al servidor compartido", agent.ID)
					break
				}
				if attempt < maxRetries {
					log.Printf("⚠️  Reintentando en %v...", retryDelay)
					time.Sleep(retryDelay)
				}
			}
			if connectErr != nil {
				log.Printf("❌ [Agent %d] No se pudo conectar: %v", agent.ID, connectErr)
				agent.DeployStatus = "error"
				config.DB.Model(&agent).Updates(map[string]interface{}{"deploy_status": agent.DeployStatus})
				serverManager.ReleaseAgentPort(globalServer)
				return
			}
			defer atomicService.Close()

			geminiAPIKey := user.GetGeminiAPIKey()
			var googleCredentials []byte
			if agent.GoogleConnected && agent.GoogleToken != "" {
				googleCredentials = []byte(agent.GoogleToken)
			}

			var branch *models.MyBusinessInfo
			if agent.BranchID > 0 {
				var b models.MyBusinessInfo
				if err := config.DB.First(&b, agent.BranchID).Error; err == nil {
					branch = &b
					log.Printf("📋 [Agent %d] Sucursal: %s (ID %d)", agent.ID, b.BranchName, b.ID)
				}
			}

			if err := atomicService.DeployAtomicBot(&agent, branch, geminiAPIKey, googleCredentials); err != nil {
				log.Printf("❌ [Agent %d] Error desplegando AtomicBot: %v", agent.ID, err)
				agent.DeployStatus = "error"
				config.DB.Model(&agent).Updates(map[string]interface{}{"deploy_status": agent.DeployStatus})
				serverManager.ReleaseAgentPort(globalServer)
				return
			}

			agent.IsActive = true
			agent.DeployStatus = "running"
			config.DB.Model(&agent).Updates(map[string]interface{}{"is_active": agent.IsActive, "deploy_status": agent.DeployStatus})
			log.Printf("🎉 [Agent %d] ATOMIC BOT DESPLEGADO EXITOSAMENTE | IP=%s Puerto=%d", agent.ID, globalServer.IPAddress, agent.Port)

		} else if agent.IsTelegramBot() {
			// ────────────────────────────────────────────────────────────────
			// TELEGRAM BOT — servidor compartido global (igual que AtomicBot)
			// ────────────────────────────────────────────────────────────────
			log.Println("\n" + strings.Repeat("═", 80))
			log.Printf("║ %s ║", centerText("DESPLIEGUE DE TELEGRAM BOT", 76))
			log.Println(strings.Repeat("═", 80))

			serverManager := services.GetGlobalServerManager()
			globalServer, err := serverManager.GetOrCreateAtomicBotsServer()
			if err != nil {
				log.Printf("❌ [Agent %d] Error obteniendo servidor compartido: %v", agent.ID, err)
				agent.DeployStatus = "error"
				config.DB.Model(&agent).Updates(map[string]interface{}{"deploy_status": agent.DeployStatus})
				return
			}

			if globalServer.Status == "initializing" {
				log.Printf("⏳ [Agent %d] Servidor compartido inicializándose...", agent.ID)
				timeout := time.After(20 * time.Minute)
				ticker := time.NewTicker(30 * time.Second)
				defer ticker.Stop()
				for {
					select {
					case <-timeout:
						log.Printf("❌ [Agent %d] Timeout esperando servidor compartido", agent.ID)
						agent.DeployStatus = "error"
						config.DB.Model(&agent).Updates(map[string]interface{}{"deploy_status": agent.DeployStatus})
						return
					case <-ticker.C:
						updatedServer, err := serverManager.GetServerStatus(globalServer.ID)
						if err != nil {
							continue
						}
						if updatedServer.IsReady() {
							globalServer = updatedServer
							goto TelegramServerReady
						}
					}
				}
			}

		TelegramServerReady:
			if !globalServer.IsReady() {
				log.Printf("❌ [Agent %d] Servidor compartido no está listo", agent.ID)
				agent.DeployStatus = "error"
				config.DB.Model(&agent).Updates(map[string]interface{}{"deploy_status": agent.DeployStatus})
				return
			}

			assignedPort, err := serverManager.AssignPortToAgent(globalServer)
			if err != nil {
				log.Printf("❌ [Agent %d] Error asignando puerto: %v", agent.ID, err)
				agent.DeployStatus = "error"
				config.DB.Model(&agent).Updates(map[string]interface{}{"deploy_status": agent.DeployStatus})
				return
			}
			agent.Port = assignedPort
			config.DB.Model(&agent).Updates(map[string]interface{}{"port": agent.Port})

			log.Printf("✅ [Agent %d] Puerto asignado: %d en %s", agent.ID, assignedPort, globalServer.IPAddress)

			agent.DeployStatus = "deploying"
			config.DB.Model(&agent).Updates(map[string]interface{}{"deploy_status": agent.DeployStatus})

			telegramService := services.NewTelegramBotDeployService(globalServer.IPAddress, globalServer.RootPassword)

			maxRetries := 10
			retryDelay := 10 * time.Second
			var connectErr error
			for attempt := 1; attempt <= maxRetries; attempt++ {
				log.Printf("🔌 [Agent %d] Intento SSH %d/%d...", agent.ID, attempt, maxRetries)
				connectErr = telegramService.Connect()
				if connectErr == nil {
					log.Printf("✅ [Agent %d] Conectado al servidor compartido", agent.ID)
					break
				}
				if attempt < maxRetries {
					log.Printf("⚠️  Reintentando en %v...", retryDelay)
					time.Sleep(retryDelay)
				}
			}
			if connectErr != nil {
				log.Printf("❌ [Agent %d] No se pudo conectar: %v", agent.ID, connectErr)
				agent.DeployStatus = "error"
				config.DB.Model(&agent).Updates(map[string]interface{}{"deploy_status": agent.DeployStatus})
				serverManager.ReleaseAgentPort(globalServer)
				return
			}
			defer telegramService.Close()

			geminiAPIKey := user.GetGeminiAPIKey()
			var googleCredentials []byte
			if agent.GoogleConnected && agent.GoogleToken != "" {
				googleCredentials = []byte(agent.GoogleToken)
			}

			var branch *models.MyBusinessInfo
			if agent.BranchID > 0 {
				var b models.MyBusinessInfo
				if err := config.DB.First(&b, agent.BranchID).Error; err == nil {
					branch = &b
					log.Printf("📋 [Agent %d] Sucursal: %s (ID %d)", agent.ID, b.BranchName, b.ID)
				}
			}

			if err := telegramService.DeployTelegramBot(&agent, branch, geminiAPIKey, googleCredentials); err != nil {
				log.Printf("❌ [Agent %d] Error desplegando TelegramBot: %v", agent.ID, err)
				agent.DeployStatus = "error"
				config.DB.Model(&agent).Updates(map[string]interface{}{"deploy_status": agent.DeployStatus})
				serverManager.ReleaseAgentPort(globalServer)
				return
			}

			agent.IsActive = true
			agent.DeployStatus = "running"
			config.DB.Model(&agent).Updates(map[string]interface{}{"is_active": agent.IsActive, "deploy_status": agent.DeployStatus})

			log.Printf("🎉 [Agent %d] TELEGRAM BOT DESPLEGADO EXITOSAMENTE", agent.ID)
			log.Printf("   - Servidor Compartido: %s", globalServer.IPAddress)
			log.Printf("   - Puerto: %d", agent.Port)
			log.Printf("   - Token: %s", agent.PhoneNumber)

		} else {
			// ────────────────────────────────────────────────────────────────
			// ORBITAL BOT (Meta API) — servidor por usuario
			// ────────────────────────────────────────────────────────────────
			log.Println("\n" + strings.Repeat("═", 80))
			log.Printf("║ %s ║", centerText("DESPLIEGUE DE ORBITAL BOT (GO + META API)", 76))
			log.Println(strings.Repeat("═", 80))

			// PASO 1: GCP si primer agente
			if isFirstAgent {
				log.Printf("🎉 [User %d] Primer agente — verificando proyecto GCP", user.ID)
				var gcpProject models.GoogleCloudProject
				err := config.DB.Where("user_id = ?", user.ID).First(&gcpProject).Error

				alreadyUsable := err == nil && (gcpProject.ProjectStatus == "ready" || gcpProject.ProjectStatus == "manual")

				if alreadyUsable {
					// Ya hay una key utilizable — o bien el usuario indicó
					// en el modal de Planes que ya tiene su propia API key
					// (ver select_plan.go, que deja ProjectStatus="manual"
					// en ese caso), o el proyecto GCP real ya se había
					// creado antes. En ambos casos NO llamamos a
					// gca.CreateProjectForUser — eso es justamente lo que
					// evita que el GCP corra cuando el usuario no lo necesita.
					log.Printf("✅ [User %d] Ya hay una API key utilizable (status=%s) — se omite creación de proyecto GCP", user.ID, gcpProject.ProjectStatus)
				} else {
					if err != nil {
						gcpProject = models.GoogleCloudProject{UserID: user.ID, ProjectStatus: "creating"}
						config.DB.Create(&gcpProject)
					} else {
						gcpProject.MarkAsCreating()
						config.DB.Save(&gcpProject)
					}

					gca, gcaErr := services.NewGoogleCloudAutomation()
					if gcaErr != nil {
						log.Printf("⚠️ [User %d] GCP no disponible (NO CRÍTICO): %v", user.ID, gcaErr)
						gcpProject.MarkAsError()
						config.DB.Save(&gcpProject)
					} else {
						projectID, apiKey, createErr := gca.CreateProjectForUser(user.ID, user.Email)
						if createErr != nil {
							log.Printf("⚠️ [User %d] Error creando GCP (NO CRÍTICO): %v", user.ID, createErr)
							gcpProject.MarkAsError()
							config.DB.Save(&gcpProject)
						} else {
							gcpProject.ProjectID = projectID
							gcpProject.ProjectName = fmt.Sprintf("Attomos User %d", user.ID)
							gcpProject.GeminiAPIKey = apiKey
							gcpProject.MarkAsReady()
							config.DB.Save(&gcpProject)
							log.Printf("🎉 [User %d] Proyecto GCP listo: %s", user.ID, projectID)
						}
					}
				}
			}

			// PASO 2: Obtener o crear servidor del usuario
			var existingAgent models.Agent
			hasExistingServer := config.DB.Where("user_id = ? AND server_id > 0 AND bot_type = ?", user.ID, "orbital").
				First(&existingAgent).Error == nil

			if hasExistingServer {
				log.Printf("✅ [Agent %d] Reutilizando servidor existente: %s", agent.ID, existingAgent.ServerIP)
				agent.ServerID = existingAgent.ServerID
				agent.ServerIP = existingAgent.ServerIP
				agent.ServerPassword = existingAgent.ServerPassword
				agent.ServerStatus = "ready"
				config.DB.Model(&agent).Updates(map[string]interface{}{"server_id": agent.ServerID, "server_ip": agent.ServerIP, "server_password": agent.ServerPassword, "server_status": agent.ServerStatus})
			} else {
				log.Printf("🖥️  [Agent %d] Creando servidor para el usuario...", agent.ID)
				agent.ServerStatus = "creating"
				config.DB.Model(&agent).Updates(map[string]interface{}{"server_status": agent.ServerStatus})

				hetznerService, err := services.NewHetznerService()
				if err != nil {
					log.Printf("❌ [Agent %d] Error Hetzner: %v", agent.ID, err)
					agent.ServerStatus = "error"
					agent.DeployStatus = "error"
					config.DB.Model(&agent).Updates(map[string]interface{}{"server_status": agent.ServerStatus, "deploy_status": agent.DeployStatus})
					return
				}

				serverName := fmt.Sprintf("attomos-user-%d", user.ID)
				serverResp, err := hetznerService.CreateServer(serverName, user.ID)
				if err != nil {
					log.Printf("❌ [Agent %d] Error creando servidor: %v", agent.ID, err)
					agent.ServerStatus = "error"
					agent.DeployStatus = "error"
					config.DB.Model(&agent).Updates(map[string]interface{}{"server_status": agent.ServerStatus, "deploy_status": agent.DeployStatus})
					return
				}

				agent.ServerID = serverResp.Server.ID
				agent.ServerIP = serverResp.Server.PublicNet.IPv4.IP
				agent.ServerPassword = serverResp.RootPassword
				agent.ServerStatus = "provisioning"
				config.DB.Model(&agent).Updates(map[string]interface{}{"server_id": agent.ServerID, "server_ip": agent.ServerIP, "server_password": agent.ServerPassword, "server_status": agent.ServerStatus})

				if err := hetznerService.WaitForServer(serverResp.Server.ID, 5*time.Minute); err != nil {
					log.Printf("❌ [Agent %d] Timeout servidor: %v", agent.ID, err)
					agent.ServerStatus = "error"
					agent.DeployStatus = "error"
					config.DB.Model(&agent).Updates(map[string]interface{}{"server_status": agent.ServerStatus, "deploy_status": agent.DeployStatus})
					return
				}

				agent.ServerStatus = "initializing"
				config.DB.Model(&agent).Updates(map[string]interface{}{"server_status": agent.ServerStatus})
				go hetznerService.MonitorCloudInitLogs(agent.ServerIP, agent.ServerPassword, 10*time.Minute)
			}

			// PASO 3: Cloudflare DNS
			cloudflareService, err := services.NewCloudflareService()
			if err != nil {
				log.Printf("⚠️  [Agent %d] Cloudflare no configurado (NO CRÍTICO): %v", agent.ID, err)
			} else {
				if err := cloudflareService.CreateOrUpdateChatwootDNS(agent.ServerIP, user.ID); err != nil {
					log.Printf("⚠️  [Agent %d] Error DNS (NO CRÍTICO): %v", agent.ID, err)
				} else {
					log.Printf("✅ [Agent %d] DNS configurado", agent.ID)
				}
			}

			// PASO 4: Chatwoot
			chatwootService := services.NewChatwootService(agent.ServerIP, user.ID, agent.ServerPassword)
			credentials, err := chatwootService.CreateAccountAndUser(user, &agent)
			if err != nil {
				log.Printf("⚠️ [Agent %d] Chatwoot (NO CRÍTICO): %v", agent.ID, err)
			} else {
				agent.ChatwootEmail = credentials.Email
				agent.ChatwootPassword = credentials.Password
				agent.ChatwootAccountID = credentials.AccountID
				agent.ChatwootAccountName = credentials.AccountName
				agent.ChatwootInboxID = credentials.InboxID
				agent.ChatwootInboxName = credentials.InboxName
				agent.ChatwootURL = credentials.ChatwootURL
				config.DB.Model(&agent).Updates(map[string]interface{}{"chatwoot_email": agent.ChatwootEmail, "chatwoot_password": agent.ChatwootPassword, "chatwoot_account_id": agent.ChatwootAccountID, "chatwoot_account_name": agent.ChatwootAccountName, "chatwoot_inbox_id": agent.ChatwootInboxID, "chatwoot_inbox_name": agent.ChatwootInboxName, "chatwoot_url": agent.ChatwootURL})
				log.Printf("✅ [Agent %d] Chatwoot: %s", agent.ID, credentials.ChatwootURL)
			}

			// PASO 5: Desplegar OrbitalBot
			agent.DeployStatus = "deploying"
			config.DB.Model(&agent).Updates(map[string]interface{}{"deploy_status": agent.DeployStatus})

			orbitalService := services.NewOrbitalBotDeployService(agent.ServerIP, agent.ServerPassword)

			maxRetries := 30
			retryDelay := 10 * time.Second
			var connectErr error
			for attempt := 1; attempt <= maxRetries; attempt++ {
				log.Printf("🔌 [Agent %d] Intento SSH %d/%d...", agent.ID, attempt, maxRetries)
				connectErr = orbitalService.Connect()
				if connectErr == nil {
					break
				}
				if attempt < maxRetries {
					time.Sleep(retryDelay)
				}
			}
			if connectErr != nil {
				log.Printf("❌ [Agent %d] No se pudo conectar: %v", agent.ID, connectErr)
				agent.DeployStatus = "error"
				agent.ServerStatus = "error"
				config.DB.Model(&agent).Updates(map[string]interface{}{"deploy_status": agent.DeployStatus, "server_status": agent.ServerStatus})
				return
			}
			defer orbitalService.Close()

			geminiAPIKey := user.GetGeminiAPIKey()
			var googleCredentials []byte
			if agent.GoogleConnected && agent.GoogleToken != "" {
				googleCredentials = []byte(agent.GoogleToken)
			}

			if err := orbitalService.DeployOrbitalBot(&agent, geminiAPIKey, googleCredentials); err != nil {
				log.Printf("❌ [Agent %d] Error desplegando OrbitalBot: %v", agent.ID, err)
				agent.DeployStatus = "error"
				config.DB.Model(&agent).Updates(map[string]interface{}{"deploy_status": agent.DeployStatus})
				return
			}

			agent.IsActive = true
			agent.DeployStatus = "running"
			agent.ServerStatus = "ready"
			config.DB.Model(&agent).Updates(map[string]interface{}{"is_active": agent.IsActive, "deploy_status": agent.DeployStatus, "server_status": agent.ServerStatus})
			log.Printf("🎉 [Agent %d] ORBITAL BOT DESPLEGADO EXITOSAMENTE | IP=%s Puerto=%d", agent.ID, agent.ServerIP, agent.Port)
		}
	}()
}

// GetAgents obtiene todos los agentes del usuario
func GetAgents(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}
	user := userInterface.(*models.User)

	var agents []models.Agent
	if err := config.DB.Where("user_id = ?", user.ID).Find(&agents).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error obteniendo agentes"})
		return
	}

	response := make([]gin.H, len(agents))
	for i, agent := range agents {
		agentData := gin.H{
			"id":            agent.ID,
			"name":          agent.Name,
			"phoneNumber":   agent.PhoneNumber,
			"businessType":  agent.BusinessType,
			"branchId":      agent.BranchID,
			"port":          agent.Port,
			"deployStatus":  agent.DeployStatus,
			"isActive":      agent.IsActive,
			"botType":       agent.BotType,
			"config":        agent.Config,
			"createdAt":     agent.CreatedAt,
			"chatwootUrl":   agent.ChatwootURL,
			"chatwootEmail": agent.ChatwootEmail,
		}
		if agent.HasOwnServer() {
			agentData["serverIp"] = agent.ServerIP
			agentData["serverStatus"] = agent.ServerStatus
		}
		if agent.IsAtomicBot() {
			agentData["whatsappConnected"] = agent.WhatsappConnected
		}
		response[i] = agentData
	}

	c.JSON(http.StatusOK, gin.H{"agents": response})
}

// GetAgent obtiene un agente específico
func GetAgent(c *gin.Context) {
	agentID := c.Param("id")
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}
	user := userInterface.(*models.User)

	var agent models.Agent
	if err := config.DB.Where("id = ? AND user_id = ?", agentID, user.ID).First(&agent).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Agente no encontrado"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"agent": agent})
}

// UpdateAgent actualiza un agente
func UpdateAgent(c *gin.Context) {
	agentID := c.Param("id")
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}
	user := userInterface.(*models.User)

	var agent models.Agent
	if err := config.DB.Where("id = ? AND user_id = ?", agentID, user.ID).First(&agent).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Agente no encontrado"})
		return
	}

	type UpdateRequest struct {
		Name        string             `json:"name"`
		PhoneNumber string             `json:"phoneNumber"`
		Config      models.AgentConfig `json:"config"`
	}
	var req UpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos inválidos"})
		return
	}

	if req.Name != "" {
		agent.Name = req.Name
	}

	// El teléfono sí se sobreescribe siempre (incluso si viene vacío), para
	// permitir quitar un número personalizado y volver a "usar el registrado"
	// — mismo criterio que CreateAgent.
	agent.PhoneNumber = req.PhoneNumber

	// El config se guarda completo siempre que venga en el body — antes solo
	// se guardaba si cambiaba el mensaje de bienvenida o los servicios, lo
	// que perdía cambios de tono, idiomas, horario, personal, etc.
	agent.Config = req.Config

	// Updates() parcial (solo estas 3 columnas) en vez de Save() del struct
	// completo: el agente puede seguir desplegándose en segundo plano (la
	// goroutine de CreateAgent tarda hasta ~20 min) o tener otra integración
	// (ej. inventario de Sheets) recién conectada — un Save() del struct
	// completo pisaría esos campos con lo que había al momento de leer aquí.
	if err := config.DB.Model(&agent).Updates(map[string]interface{}{
		"name":         agent.Name,
		"phone_number": agent.PhoneNumber,
		"config":       agent.Config,
	}).Error; err != nil {
		log.Printf("❌ [Agent %s] Error guardando actualización: %v", agentID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al actualizar el agente"})
		return
	}

	// Reflejar los cambios de horario/servicios/personal en la sucursal
	// asociada, igual que hace CreateAgent al crear el agente.
	if agent.BranchID > 0 {
		if isGovBusinessType(agent.BusinessType) {
			go syncOnboardingToAgency(user.ID, agent.BranchID, agent.Config)
		} else {
			go syncOnboardingToBranch(agent.BranchID, agent.Config)
		}
	}

	log.Printf("✅ [Agent %s] Actualizado por user %d", agentID, user.ID)

	c.JSON(http.StatusOK, gin.H{"message": "Agente actualizado exitosamente", "agent": agent})
}

// ToggleAgentStatus activa/desactiva un agente
func ToggleAgentStatus(c *gin.Context) {
	agentID := c.Param("id")
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}
	user := userInterface.(*models.User)

	var agent models.Agent
	if err := config.DB.Where("id = ? AND user_id = ?", agentID, user.ID).First(&agent).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Agente no encontrado"})
		return
	}
	agent.IsActive = !agent.IsActive
	if err := config.DB.Model(&agent).Update("is_active", agent.IsActive).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al cambiar estado"})
		return
	}
	status := "desactivado"
	if agent.IsActive {
		status = "activado"
	}
	c.JSON(http.StatusOK, gin.H{"message": fmt.Sprintf("Agente %s exitosamente", status), "agent": agent})
}

// DeleteAgent elimina un agente
func DeleteAgent(c *gin.Context) {
	agentID := c.Param("id")
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}
	user := userInterface.(*models.User)

	var agent models.Agent
	if err := config.DB.Where("id = ? AND user_id = ?", agentID, user.ID).First(&agent).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Agente no encontrado"})
		return
	}

	// Detener bot en el servidor correspondiente
	go func() {
		if agent.IsAtomicBot() {
			// AtomicBot — servidor compartido global
			serverManager := services.GetGlobalServerManager()
			servers, err := serverManager.ListAllServers()
			if err != nil || len(servers) == 0 {
				log.Printf("⚠️  [Agent %d] No se encontró servidor compartido", agent.ID)
				return
			}
			globalServer := servers[0]
			atomicService := services.NewAtomicBotDeployService(globalServer.IPAddress, globalServer.RootPassword)
			if err := atomicService.Connect(); err != nil {
				log.Printf("⚠️  [Agent %d] Error conectando: %v", agent.ID, err)
				return
			}
			defer atomicService.Close()
			if err := atomicService.StopBot(agent.ID); err != nil {
				log.Printf("⚠️  [Agent %d] Error deteniendo AtomicBot: %v", agent.ID, err)
			} else {
				log.Printf("✅ [Agent %d] AtomicBot detenido", agent.ID)
				serverManager.ReleaseAgentPort(&globalServer)
			}

		} else if agent.IsTelegramBot() {
			// TelegramBot — servidor compartido global
			serverManager := services.GetGlobalServerManager()
			servers, err := serverManager.ListAllServers()
			if err != nil || len(servers) == 0 {
				log.Printf("⚠️  [Agent %d] No se encontró servidor compartido", agent.ID)
				return
			}
			globalServer := servers[0]
			telegramService := services.NewTelegramBotDeployService(globalServer.IPAddress, globalServer.RootPassword)
			if err := telegramService.Connect(); err != nil {
				log.Printf("⚠️  [Agent %d] Error conectando: %v", agent.ID, err)
				return
			}
			defer telegramService.Close()
			if err := telegramService.StopBot(agent.ID); err != nil {
				log.Printf("⚠️  [Agent %d] Error deteniendo TelegramBot: %v", agent.ID, err)
			} else {
				log.Printf("✅ [Agent %d] TelegramBot detenido del servidor compartido", agent.ID)
				serverManager.ReleaseAgentPort(&globalServer)
			}

		} else {
			// OrbitalBot — servidor del usuario
			if agent.HasOwnServer() {
				orbitalService := services.NewOrbitalBotDeployService(agent.ServerIP, agent.ServerPassword)
				if err := orbitalService.Connect(); err != nil {
					log.Printf("⚠️  [Agent %d] Error conectando: %v", agent.ID, err)
					return
				}
				defer orbitalService.Close()
				if err := orbitalService.StopAndRemoveBot(agent.ID); err != nil {
					log.Printf("⚠️  [Agent %d] Error eliminando OrbitalBot: %v", agent.ID, err)
				} else {
					log.Printf("✅ [Agent %d] OrbitalBot eliminado", agent.ID)
				}

				// Verificar si el usuario tiene más agentes en este servidor
				var otherAgents int64
				config.DB.Model(&models.Agent{}).
					Where("user_id = ? AND server_id = ? AND id != ?", user.ID, agent.ServerID, agent.ID).
					Count(&otherAgents)

				if otherAgents == 0 {
					log.Printf("🗑️  [Agent %d] Último agente — eliminando servidor Hetzner...", agent.ID)
					hetznerService, err := services.NewHetznerService()
					if err == nil {
						if err := hetznerService.DeleteServer(agent.ServerID); err != nil {
							log.Printf("⚠️  [Agent %d] Error eliminando servidor: %v", agent.ID, err)
						} else {
							log.Printf("✅ [Agent %d] Servidor eliminado: ID=%d", agent.ID, agent.ServerID)
						}
					}
				} else {
					log.Printf("ℹ️  [Agent %d] Servidor conservado (%d agentes restantes)", agent.ID, otherAgents)
				}
			}
		}
	}()

	if err := config.DB.Delete(&agent).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al eliminar el agente"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Agente eliminado exitosamente"})
}

// ResetAgentSession elimina sesión WhatsApp y regenera QR (solo AtomicBot)
func ResetAgentSession(c *gin.Context) {
	agentID := c.Param("id")
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}
	user := userInterface.(*models.User)

	var agent models.Agent
	if err := config.DB.Where("id = ? AND user_id = ?", agentID, user.ID).First(&agent).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Agente no encontrado"})
		return
	}
	if !agent.IsAtomicBot() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Solo disponible para AtomicBot"})
		return
	}

	config.DB.Model(&agent).Updates(map[string]interface{}{
		"deploy_status":      "deploying",
		"is_active":          false,
		"whatsapp_connected": false,
	})
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "Redeploy iniciado, generando nuevo QR..."})

	go func() {
		serverManager := services.GetGlobalServerManager()
		servers, err := serverManager.ListAllServers()
		if err != nil || len(servers) == 0 {
			config.DB.Model(&agent).Update("deploy_status", "error")
			return
		}
		globalServer := servers[0]
		atomicService := services.NewAtomicBotDeployService(globalServer.IPAddress, globalServer.RootPassword)
		if err := atomicService.Connect(); err != nil {
			config.DB.Model(&agent).Update("deploy_status", "error")
			return
		}
		defer atomicService.Close()

		atomicService.StopBot(agent.ID)
		time.Sleep(2 * time.Second)

		botDir := fmt.Sprintf("/home/user_%d/atomic-bot", agent.UserID)
		dbFile := fmt.Sprintf("%s/whatsapp-%d.db", botDir, agent.ID)
		sshClient := atomicService.GetSSHClient()
		if sshClient != nil {
			if sess, err := sshClient.NewSession(); err == nil {
				sess.CombinedOutput(fmt.Sprintf("rm -f %s %s-shm %s-wal", dbFile, dbFile, dbFile))
				sess.Close()
			}
			logFile := fmt.Sprintf("/var/log/atomic-bot-%d.log", agent.ID)
			if sess, err := sshClient.NewSession(); err == nil {
				sess.CombinedOutput(fmt.Sprintf("truncate -s 0 %s 2>/dev/null || true", logFile))
				sess.Close()
			}
		}

		atomicService.RestartBot(agent.ID)
		config.DB.Model(&agent).Updates(map[string]interface{}{
			"deploy_status": "running",
			"is_active":     true,
		})
		log.Printf("✅ [Agent %d] Sesión reseteada", agent.ID)
	}()
}

// GetAgentQRCode obtiene el QR del agente (solo AtomicBot)
func GetAgentQRCode(c *gin.Context) {
	agentID := c.Param("id")
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}
	user := userInterface.(*models.User)

	var agent models.Agent
	if err := config.DB.Where("id = ? AND user_id = ?", agentID, user.ID).First(&agent).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Agente no encontrado"})
		return
	}
	if !agent.IsAtomicBot() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "QR code no disponible", "message": "Este agente no usa WhatsApp Web"})
		return
	}

	serverManager := services.GetGlobalServerManager()
	servers, err := serverManager.ListAllServers()
	if err != nil || len(servers) == 0 {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "No se encontró servidor compartido"})
		return
	}

	globalServer := servers[0]
	atomicService := services.NewAtomicBotDeployService(globalServer.IPAddress, globalServer.RootPassword)
	if err := atomicService.Connect(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "No se pudo conectar al servidor"})
		return
	}
	defer atomicService.Close()

	qrCode, connected, err := atomicService.GetQRCodeFromLogs(agent.ID)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"connected": false, "qrCode": nil, "message": "Esperando QR code..."})
		return
	}
	if connected {
		if !agent.WhatsappConnected {
			config.DB.Model(&agent).Update("whatsapp_connected", true)
		}
		c.JSON(http.StatusOK, gin.H{"connected": true, "qrCode": nil, "message": "WhatsApp conectado exitosamente"})
		return
	}
	if qrCode != "" {
		c.JSON(http.StatusOK, gin.H{"connected": false, "qrCode": qrCode, "message": "Escanea el código QR"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"connected": false, "qrCode": nil, "message": "Generando QR code..."})
}

// RedeployAgent hace redeploy completo de un AtomicBot
func RedeployAgent(c *gin.Context) {
	agentID := c.Param("id")
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}
	user := userInterface.(*models.User)

	var agent models.Agent
	if err := config.DB.Where("id = ? AND user_id = ?", agentID, user.ID).First(&agent).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Agente no encontrado"})
		return
	}
	if !agent.IsAtomicBot() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Redeploy solo disponible para AtomicBot"})
		return
	}

	config.DB.Model(&agent).Updates(map[string]interface{}{"deploy_status": "deploying", "is_active": false, "whatsapp_connected": false})

	go func() {
		serverManager := services.GetGlobalServerManager()
		servers, err := serverManager.ListAllServers()
		if err != nil || len(servers) == 0 {
			config.DB.Model(&agent).Update("deploy_status", "error")
			return
		}
		globalServer := servers[0]
		atomicService := services.NewAtomicBotDeployService(globalServer.IPAddress, globalServer.RootPassword)
		if err := atomicService.Connect(); err != nil {
			config.DB.Model(&agent).Update("deploy_status", "error")
			return
		}
		defer atomicService.Close()

		atomicService.StopBot(agent.ID)
		botDir := fmt.Sprintf("/home/user_%d/atomic-bot", agent.UserID)
		dbFile := fmt.Sprintf("%s/whatsapp-%d.db", botDir, agent.ID)
		sshClient := atomicService.GetSSHClient()
		if sshClient != nil {
			if sess, err := sshClient.NewSession(); err == nil {
				sess.CombinedOutput(fmt.Sprintf("rm -f %s %s-shm %s-wal", dbFile, dbFile, dbFile))
				sess.Close()
			}
			logFile := fmt.Sprintf("/var/log/atomic-bot-%d.log", agent.ID)
			if sess, err := sshClient.NewSession(); err == nil {
				sess.CombinedOutput(fmt.Sprintf("truncate -s 0 %s 2>/dev/null || true", logFile))
				sess.Close()
			}
		}

		var branch *models.MyBusinessInfo
		if agent.BranchID > 0 {
			var b models.MyBusinessInfo
			if err := config.DB.First(&b, agent.BranchID).Error; err == nil {
				branch = &b
			}
		}
		atomicService.UpdateBusinessConfig(&agent, branch)

		var freshAgent models.Agent
		if err := config.DB.First(&freshAgent, agent.ID).Error; err == nil {
			var u models.User
			if err := config.DB.First(&u, freshAgent.UserID).Error; err == nil {
				if key := u.GetGeminiAPIKey(); key != "" {
					atomicService.UpdateGeminiAPIKey(&freshAgent, key)
				}
			}
			atomicService.UpdatePaymentConfig(&freshAgent)
		}

		atomicService.TransferBotFiles(agent.UserID, botDir)
		atomicService.CompileBotOnServer(agent.UserID, botDir)
		atomicService.RestartBot(agent.ID)

		config.DB.Model(&agent).Updates(map[string]interface{}{"deploy_status": "running", "is_active": true})
		log.Printf("✅ [Agent %d] Redeploy completado", agent.ID)
	}()

	c.JSON(http.StatusOK, gin.H{"success": true, "message": "Redeploy iniciado."})
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func sanitizeFilename(name string) string {
	name = strings.ToLower(name)
	name = strings.ReplaceAll(name, " ", "_")
	name = strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_' || r == '-' {
			return r
		}
		return -1
	}, name)
	return name
}

func centerText(text string, width int) string {
	if len(text) >= width {
		return text[:width]
	}
	padding := (width - len(text)) / 2
	return strings.Repeat(" ", padding) + text + strings.Repeat(" ", width-len(text)-padding)
}

func syncOnboardingToBranch(branchID uint, cfg models.AgentConfig) {
	var branch models.MyBusinessInfo
	if err := config.DB.First(&branch, branchID).Error; err != nil {
		log.Printf("⚠️  [SyncBranch] No se encontró sucursal %d: %v", branchID, err)
		return
	}
	updated := false
	if len(cfg.Services) > 0 {
		newServices := make(models.BranchServices, len(cfg.Services))
		for i, s := range cfg.Services {
			newServices[i] = models.BranchService{
				Title:           s.Title,
				Description:     s.Description,
				PriceType:       s.PriceType,
				Price:           parseFlexibleFloat(string(s.Price)),
				OriginalPrice:   parseFlexibleFloatPtr(s.OriginalPrice),
				PromoPrice:      parseFlexibleFloatPtr(s.PromoPrice),
				ImageUrls:       s.ImageUrls,
				PromoPeriodType: s.PromoPeriodType,
				PromoDays:       s.PromoDays,
				PromoDateStart:  s.PromoDateStart,
				PromoDateEnd:    s.PromoDateEnd,
			}
		}
		branch.Services = newServices
		updated = true
	}
	if len(cfg.Workers) > 0 {
		newWorkers := make(models.BranchWorkers, len(cfg.Workers))
		for i, w := range cfg.Workers {
			newWorkers[i] = models.BranchWorker{Name: w.Name, StartTime: w.StartTime, EndTime: w.EndTime, Days: w.Days}
		}
		branch.Workers = newWorkers
		updated = true
	}
	if len(cfg.Holidays) > 0 {
		newHolidays := make(models.BusinessHolidays, len(cfg.Holidays))
		for i, h := range cfg.Holidays {
			newHolidays[i] = models.Holiday{Date: h.Date, Name: h.Name}
		}
		branch.Holidays = newHolidays
		updated = true
	}
	if updated {
		if err := config.DB.Save(&branch).Error; err != nil {
			log.Printf("❌ [SyncBranch] Error guardando: %v", err)
		} else {
			log.Printf("✅ [SyncBranch] Sucursal %d actualizada", branchID)
		}
	}
}

func parseFlexibleFloat(s string) float64 {
	if s == "" {
		return 0
	}
	var f float64
	fmt.Sscanf(s, "%f", &f)
	return f
}

func parseFlexibleFloatPtr(s *models.FlexibleString) float64 {
	if s == nil {
		return 0
	}
	return parseFlexibleFloat(string(*s))
}
