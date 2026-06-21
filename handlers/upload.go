package handlers

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"attomos/config"
	"attomos/models"
	"attomos/services"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

// UploadServiceImage recibe una imagen, la sube vía SFTP al servidor Hetzner
// correcto y devuelve la URL pública. No guarda nada en disco local (Railway).
//
// POST /api/upload/service-image?branch_id={id}
//
// Lógica de selección de servidor:
//  1. Si el usuario tiene un agente OrbitalBot con ese branch_id → usar su servidor
//  2. Si tiene cualquier agente OrbitalBot → usar el servidor de ese agente
//  3. Si NO tiene agentes aún (onboarding) o tiene AtomicBot → servidor global AtomicBot
//     3a. Si el servidor global existe y está listo → subir directo
//     3b. Si NO existe o está inicializando → crearlo y esperar (bloqueante, máx 35 min)
func UploadServiceImage(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}
	user := userInterface.(*models.User)

	branchIDStr := c.Query("branch_id")
	imageType := c.Query("type") // "logo", "banner" o vacío para servicio

	file, header, err := c.Request.FormFile("image")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No se recibió ninguna imagen"})
		return
	}
	defer file.Close()

	if header.Size > 5*1024*1024 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "La imagen no debe superar 5 MB"})
		return
	}

	ext, err := validateServiceImageExt(header.Filename)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	fileBytes, err := io.ReadAll(file)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error leyendo imagen"})
		return
	}

	// Nombre único para el archivo
	prefix := "svc"
	if imageType == "logo" {
		prefix = "logo"
	} else if imageType == "banner" {
		prefix = "banner"
	}
	filename := fmt.Sprintf("%s_%s_%d%s", prefix, uuid.New().String()[:8], time.Now().Unix(), ext)

	// ── Buscar agente OrbitalBot del usuario ─────────────────────────
	// Solo usamos OrbitalBot para subir imágenes a su servidor individual.
	// AtomicBot y onboarding usan siempre el servidor global.
	var orbitalAgent *models.Agent

	if branchIDStr != "" {
		var a models.Agent
		if config.DB.Where("user_id = ? AND branch_id = ? AND bot_type = ?", user.ID, branchIDStr, "orbital").
			First(&a).Error == nil {
			orbitalAgent = &a
		}
	}

	if orbitalAgent == nil {
		var a models.Agent
		if config.DB.Where("user_id = ? AND bot_type = ?", user.ID, "orbital").
			Order("created_at desc").First(&a).Error == nil {
			orbitalAgent = &a
		}
	}

	// ── Subir imagen ─────────────────────────────────────────────────
	var publicURL string

	if orbitalAgent != nil && orbitalAgent.ServerIP != "" {
		// ── Ruta OrbitalBot: servidor individual del agente ──────────
		remotePath := fmt.Sprintf("/var/www/uploads/branch_%s", branchIDStr)
		remoteFile := remotePath + "/" + filename

		if err := uploadViaSFTP(orbitalAgent.ServerIP, orbitalAgent.ServerPassword,
			remotePath, remoteFile, fileBytes); err != nil {
			log.Printf("❌ [Upload] SFTP OrbitalBot user=%d: %v", user.ID, err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Error subiendo imagen al servidor"})
			return
		}

		internalPath := fmt.Sprintf("/branch_%s/%s", branchIDStr, filename)
		baseURL := os.Getenv("BASE_URL")
		if baseURL == "" {
			baseURL = "http://localhost:8080"
		}
		publicURL = fmt.Sprintf("%s/api/uploads/proxy?server=%s&port=8080&path=%s",
			baseURL, orbitalAgent.ServerIP, internalPath)

	} else {
		// ── Ruta AtomicBot / onboarding: servidor global compartido ──
		globalServer, err := resolveGlobalServer()
		if err != nil {
			log.Printf("❌ [Upload] No se pudo obtener servidor global para user=%d: %v", user.ID, err)
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": "El servidor de imágenes está iniciando. Intenta de nuevo en unos minutos.",
			})
			return
		}

		remotePath := fmt.Sprintf("/var/www/uploads/user_%d/branch_%s", user.ID, branchIDStr)
		remoteFile := remotePath + "/" + filename

		if err := uploadViaSFTP(globalServer.IPAddress, globalServer.RootPassword,
			remotePath, remoteFile, fileBytes); err != nil {
			log.Printf("❌ [Upload] SFTP global server user=%d: %v", user.ID, err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Error subiendo imagen al servidor"})
			return
		}

		internalPath := fmt.Sprintf("/user_%d/branch_%s/%s", user.ID, branchIDStr, filename)
		baseURL := os.Getenv("BASE_URL")
		if baseURL == "" {
			baseURL = "http://localhost:8080"
		}
		publicURL = fmt.Sprintf("%s/api/uploads/proxy?server=%s&path=%s",
			baseURL, globalServer.IPAddress, internalPath)
	}

	log.Printf("✅ [Upload] user=%d branch=%s → %s", user.ID, branchIDStr, publicURL)
	c.JSON(http.StatusOK, gin.H{"url": publicURL})
}

// resolveGlobalServer devuelve el servidor global listo para subir imágenes.
// Si existe y está ready → lo devuelve de inmediato.
// Si no existe o está inicializando → lo crea (o espera) de forma bloqueante.
// Timeout máximo: 35 minutos (el cloud-init del servidor tarda ~25-30 min).
func resolveGlobalServer() (*models.GlobalServer, error) {
	// Intento rápido: ¿ya hay uno listo?
	var existing models.GlobalServer
	if err := config.DB.
		Where("purpose = ? AND status = ?", "atomic-bots", "ready").
		Order("current_agents ASC").
		First(&existing).Error; err == nil {
		return &existing, nil
	}

	// No hay ninguno listo → delegar al manager (crea si hace falta) y esperar
	log.Printf("⏳ [Upload] Servidor global no disponible — iniciando creación y espera bloqueante...")
	return services.GetGlobalServerManager().GetOrCreateReadyServer(35 * time.Minute)
}

// uploadViaSFTP conecta por SSH/SFTP, crea el directorio y sube el archivo en memoria.
func uploadViaSFTP(serverIP, password, remotePath, remoteFile string, data []byte) error {
	sshConfig := &ssh.ClientConfig{
		User:            "root",
		Auth:            []ssh.AuthMethod{ssh.Password(password)},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         30 * time.Second,
	}

	sshClient, err := ssh.Dial("tcp", serverIP+":22", sshConfig)
	if err != nil {
		return fmt.Errorf("SSH %s: %w", serverIP, err)
	}
	defer sshClient.Close()

	sftpClient, err := sftp.NewClient(sshClient)
	if err != nil {
		return fmt.Errorf("SFTP init: %w", err)
	}
	defer sftpClient.Close()

	if err := sftpClient.MkdirAll(remotePath); err != nil {
		return fmt.Errorf("mkdir %s: %w", remotePath, err)
	}

	f, err := sftpClient.Create(remoteFile)
	if err != nil {
		return fmt.Errorf("create %s: %w", remoteFile, err)
	}
	defer f.Close()

	if _, err := f.Write(data); err != nil {
		return fmt.Errorf("write: %w", err)
	}

	return nil
}

// validateServiceImageExt valida la extensión del archivo.
func validateServiceImageExt(filename string) (string, error) {
	allowed := map[string]bool{
		".jpg": true, ".jpeg": true,
		".png": true, ".webp": true, ".gif": true,
	}
	ext := strings.ToLower(filepath.Ext(filename))
	if !allowed[ext] {
		return "", fmt.Errorf("formato no permitido: %s — usa jpg, png, webp o gif", ext)
	}
	return ext, nil
}

// UploadMenu recibe un PDF o imagen de menú, lo sube vía SFTP al servidor Hetzner
// y devuelve la URL pública.
//
// POST /api/upload/menu?branch_id={id}
func UploadMenu(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}
	user := userInterface.(*models.User)

	branchIDStr := c.Query("branch_id")

	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No se recibió ningún archivo"})
		return
	}
	defer file.Close()

	if header.Size > 10*1024*1024 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "El archivo no debe superar 10 MB"})
		return
	}

	ext, err := validateMenuExt(header.Filename)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	fileBytes, err := io.ReadAll(file)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error leyendo archivo"})
		return
	}

	filename := fmt.Sprintf("menu_%s_%d%s", uuid.New().String()[:8], time.Now().Unix(), ext)

	// Usar servidor global para todos los menús
	globalServer, err := resolveGlobalServer()
	if err != nil {
		log.Printf("❌ [UploadMenu] No se pudo obtener servidor global para user=%d: %v", user.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "El servidor está iniciando. Intenta de nuevo en unos minutos.",
		})
		return
	}

	remotePath := fmt.Sprintf("/var/www/uploads/user_%d/branch_%s/menu", user.ID, branchIDStr)
	remoteFile := remotePath + "/" + filename

	if err := uploadViaSFTP(globalServer.IPAddress, globalServer.RootPassword,
		remotePath, remoteFile, fileBytes); err != nil {
		log.Printf("❌ [UploadMenu] SFTP user=%d: %v", user.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error subiendo archivo al servidor"})
		return
	}

	internalPath := fmt.Sprintf("/user_%d/branch_%s/menu/%s", user.ID, branchIDStr, filename)
	baseURL := os.Getenv("BASE_URL")
	if baseURL == "" {
		baseURL = "http://localhost:8080"
	}
	publicURL := fmt.Sprintf("%s/api/uploads/proxy?server=%s&path=%s",
		baseURL, globalServer.IPAddress, internalPath)

	log.Printf("✅ [UploadMenu] user=%d branch=%s → %s", user.ID, branchIDStr, publicURL)
	c.JSON(http.StatusOK, gin.H{"url": publicURL})
}

// validateMenuExt valida que sea PDF o imagen.
func validateMenuExt(filename string) (string, error) {
	allowed := map[string]bool{
		".pdf": true, ".jpg": true, ".jpeg": true,
		".png": true, ".webp": true,
	}
	ext := strings.ToLower(filepath.Ext(filename))
	if !allowed[ext] {
		return "", fmt.Errorf("formato no permitido: %s — usa pdf, jpg, png o webp", ext)
	}
	return ext, nil
}

// ProxyUpload sirve imágenes/archivos desde el servidor Hetzner a través del backend.
// Esto evita el problema de mixed content (HTTP desde página HTTPS).
//
// GET /api/uploads/proxy?server={ip}&path={/user_1/branch_2/img.jpg}&port={80}
func ProxyUpload(c *gin.Context) {
	server := c.Query("server")
	path := c.Query("path")
	port := c.DefaultQuery("port", "80")

	if server == "" || path == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "server y path son requeridos"})
		return
	}

	// Validar que la ruta sea segura (solo /uploads/...)
	cleanPath := filepath.Clean(path)
	if !strings.HasPrefix(cleanPath, "/") {
		cleanPath = "/" + cleanPath
	}

	internalURL := fmt.Sprintf("http://%s:%s/uploads%s", server, port, cleanPath)
	log.Printf("🖼️  [Proxy] %s", internalURL)

	resp, err := http.Get(internalURL)
	if err != nil {
		log.Printf("❌ [Proxy] Error fetching %s: %v", internalURL, err)
		c.JSON(http.StatusBadGateway, gin.H{"error": "No se pudo obtener la imagen"})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		c.Status(resp.StatusCode)
		return
	}

	contentType := resp.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	// Cache de 30 días
	c.Header("Cache-Control", "public, max-age=2592000")
	c.Header("Content-Type", contentType)
	c.Status(http.StatusOK)
	io.Copy(c.Writer, resp.Body)
}

// ProxyUploadURL construye la URL del proxy para una URL interna de Hetzner.
// Útil cuando se necesita convertir URLs antiguas (http://IP/uploads/...) al proxy.
func ProxyUploadURL(internalURL string) string {
	baseURL := os.Getenv("BASE_URL")
	if baseURL == "" {
		return internalURL
	}
	return fmt.Sprintf("%s/api/uploads/proxy?url=%s", baseURL, url.QueryEscape(internalURL))
}
