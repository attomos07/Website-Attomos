package storage

// bucket.go — subida de fotos/menús del negocio al bucket de Attomos en Railway.
//
// Antes: SFTP a un servidor Hetzner (global compartido de AtomicBot o
// individual de OrbitalBot), servido después vía ProxyUpload para evitar
// mixed-content (HTTP del servidor detrás de HTTPS del sitio).
//
// Ahora: sube al bucket de Attomos en Railway (S3-compatible, credenciales
// en BUCKET_ENDPOINT / BUCKET_ACCESS_KEY_ID / BUCKET_SECRET_ACCESS_KEY /
// BUCKET_NAME / BUCKET_REGION / BUCKET_URL_STYLE — mismo estilo de nombres
// que ya usas en Avante — ver la pestaña "Credentials" del bucket en Railway). Los Buckets de Railway son
// PRIVADOS por diseño (no hay URL pública ni bucket público), así que se
// sigue sirviendo el archivo a través del backend — mismo patrón que
// ProxyUpload de antes, solo que ahora hace GetObject al bucket en vez de
// un GET HTTP al servidor Hetzner. Esto también significa que ya NO
// depende de qué tipo de bot (AtomicBot/OrbitalBot) ni de si su servidor
// está listo — un único bucket compartido para todas las sucursales del
// usuario, sin tocar Hetzner en absoluto.
//
// NOTA: cada entorno (Avante Optics, Attomos, etc.) tiene su PROPIO bucket
// de Railway — este archivo solo lee las credenciales del bucket configurado
// en las variables de entorno de ESTE servicio (el backend de Attomos), no
// hay nada hardcodeado de qué bucket es.

import (
	"bytes"
	"context"
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

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/pkg/sftp"     // usado solo por uploadViaSFTP, que se deja sin llamar (legacy) por si algo más del paquete lo referencia
	"golang.org/x/crypto/ssh" // idem
)

// getBucketClient arma el cliente S3 apuntando al bucket de Railway a
// partir de las credenciales que Railway inyecta como variables de entorno.
//
// IMPORTANTE: se toma el set COMPLETO de un solo estilo (BUCKET_* o AWS_*),
// nunca mezclado campo por campo — mezclar el access key de un set con el
// secret key del otro produce SignatureDoesNotMatch (403) porque nunca
// coinciden como pareja real, aunque cada variable individual "exista".
// Se prueba primero el set BUCKET_* (tu convención en Avante); si
// BUCKET_ACCESS_KEY_ID no está, se usa el set AWS_* completo en su lugar.
func getBucketClient() (*s3.Client, string, error) {
	var endpoint, accessKey, secretKey, bucket, region, urlStyle string

	switch {
	case os.Getenv("BUCKET_ACCESS_KEY_ID") != "":
		endpoint = os.Getenv("BUCKET_ENDPOINT")
		accessKey = os.Getenv("BUCKET_ACCESS_KEY_ID")
		secretKey = os.Getenv("BUCKET_SECRET_ACCESS_KEY")
		bucket = os.Getenv("BUCKET_NAME")
		region = os.Getenv("BUCKET_REGION")
		urlStyle = os.Getenv("BUCKET_URL_STYLE")
	case os.Getenv("AWS_ACCESS_KEY_ID") != "":
		endpoint = os.Getenv("AWS_ENDPOINT_URL")
		accessKey = os.Getenv("AWS_ACCESS_KEY_ID")
		secretKey = os.Getenv("AWS_SECRET_ACCESS_KEY")
		bucket = os.Getenv("AWS_S3_BUCKET_NAME")
		region = os.Getenv("AWS_DEFAULT_REGION")
		urlStyle = os.Getenv("AWS_S3_URL_STYLE")
	default:
		return nil, "", fmt.Errorf("variables del bucket no configuradas (falta BUCKET_ACCESS_KEY_ID o AWS_ACCESS_KEY_ID)")
	}

	if region == "" {
		region = "auto"
	}

	if endpoint == "" || accessKey == "" || secretKey == "" || bucket == "" {
		return nil, "", fmt.Errorf("variables del bucket incompletas — revisa que el set elegido (BUCKET_* o AWS_*) tenga las 4: endpoint, access key, secret key y nombre del bucket, sin mezclar con el otro set")
	}

	usePathStyle := strings.EqualFold(urlStyle, "path")

	cfg := aws.Config{
		Region:      region,
		Credentials: credentials.NewStaticCredentialsProvider(accessKey, secretKey, ""),
	}

	client := s3.NewFromConfig(cfg, func(o *s3.Options) {
		o.BaseEndpoint = aws.String(endpoint)
		o.UsePathStyle = usePathStyle
	})

	return client, bucket, nil
}

// firstNonEmptyEnv: ya NO se usa en getBucketClient (que ahora toma el set
// completo de un solo estilo para evitar mezclar credenciales — ver arriba).
// Se deja por si sirve para otra cosa; bórrala si no la necesitas.
func firstNonEmptyEnv(names ...string) string {
	for _, n := range names {
		if v := os.Getenv(n); v != "" {
			return v
		}
	}
	return ""
}

// uploadToBucket sube el archivo al bucket bajo la key indicada.
func uploadToBucket(key string, data []byte, contentType string) error {
	client, bucket, err := getBucketClient()
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	_, err = client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(bucket),
		Key:         aws.String(key),
		Body:        bytes.NewReader(data),
		ContentType: aws.String(contentType),
	})
	if err != nil {
		return fmt.Errorf("PutObject %s: %w", key, err)
	}
	return nil
}

// bucketPublicURL construye la URL (de tu propio backend, no del bucket —
// el bucket es privado) que sirve el archivo vía ProxyBucketFile.
func bucketPublicURL(key string) string {
	baseURL := os.Getenv("BASE_URL")
	if baseURL == "" {
		baseURL = "http://localhost:8080"
	}
	return fmt.Sprintf("%s/api/uploads/bucket?key=%s", baseURL, url.QueryEscape(key))
}

// contentTypeByExt devuelve un Content-Type razonable según la extensión —
// el bucket no lo adivina solo, hay que mandarlo explícito en el PutObject.
func contentTypeByExt(ext string) string {
	switch strings.ToLower(ext) {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".webp":
		return "image/webp"
	case ".gif":
		return "image/gif"
	case ".pdf":
		return "application/pdf"
	default:
		return "application/octet-stream"
	}
}

// UploadServiceImage recibe una imagen y la sube al bucket de Attomos en
// Railway (S3-compatible). Ya no hay lógica de selección de servidor
// Hetzner (OrbitalBot vs AtomicBot vs global) — un único bucket compartido
// para todas las sucursales del usuario, sin importar el tipo de bot.
//
// POST /api/upload/service-image?branch_id={id}
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

	// Misma estructura de rutas que antes (user_X/branch_Y/archivo), ahora
	// como key del bucket en vez de ruta de disco.
	key := fmt.Sprintf("user_%d/branch_%s/%s", user.ID, branchIDStr, filename)

	if err := uploadToBucket(key, fileBytes, contentTypeByExt(ext)); err != nil {
		log.Printf("❌ [Upload] Bucket user=%d: %v", user.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error subiendo imagen al bucket"})
		return
	}

	publicURL := bucketPublicURL(key)
	log.Printf("✅ [Upload] user=%d branch=%s → %s", user.ID, branchIDStr, publicURL)
	c.JSON(http.StatusOK, gin.H{"url": publicURL})
}

// resolveGlobalServer, uploadViaSFTP: se dejan tal cual (ya NO se usan para
// imágenes) por si otro archivo del paquete handlers los sigue usando para
// el deploy/hosting real del bot en Hetzner, que es un asunto aparte del
// almacenamiento de archivos.

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

// UploadMenu recibe un PDF o imagen de menú y lo sube al bucket de Attomos
// en Railway (mismo mecanismo que UploadServiceImage).
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

	key := fmt.Sprintf("user_%d/branch_%s/menu/%s", user.ID, branchIDStr, filename)

	if err := uploadToBucket(key, fileBytes, contentTypeByExt(ext)); err != nil {
		log.Printf("❌ [UploadMenu] Bucket user=%d: %v", user.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error subiendo archivo al bucket"})
		return
	}

	publicURL := bucketPublicURL(key)
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

// ProxyUpload sirve imágenes/archivos desde el servidor Hetzner a través del
// backend. Se deja intacto por compatibilidad: URLs guardadas antes de este
// cambio (branch.LogoURL, etc. con ?server=...) siguen funcionando. Nada
// nuevo se sube por esta vía — ver UploadServiceImage/UploadMenu (bucket).
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

// ProxyBucketFile sirve un archivo del bucket privado de Railway a través
// del backend. Los Buckets de Railway son privados por diseño (no hay URL
// pública ni bucket público — confirmado en la doc oficial), así que TODO
// archivo subido por UploadServiceImage/UploadMenu se sirve por aquí,
// haciendo GetObject en el bucket y transmitiendo los bytes — mismo rol que
// ProxyUpload cumplía para Hetzner, pero contra el bucket S3-compatible.
//
// GET /api/uploads/bucket?key=user_1/branch_2/logo_xxxxx.png
func ProxyBucketFile(c *gin.Context) {
	key := c.Query("key")
	if key == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "key es requerido"})
		return
	}

	client, bucket, err := getBucketClient()
	if err != nil {
		log.Printf("❌ [ProxyBucketFile] %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Bucket no configurado"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()

	out, err := client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		log.Printf("❌ [ProxyBucketFile] GetObject %s: %v", key, err)
		c.JSON(http.StatusNotFound, gin.H{"error": "Archivo no encontrado"})
		return
	}
	defer out.Body.Close()

	contentType := "application/octet-stream"
	if out.ContentType != nil && *out.ContentType != "" {
		contentType = *out.ContentType
	}

	// Cache de 30 días — igual que ProxyUpload
	c.Header("Cache-Control", "public, max-age=2592000")
	c.Header("Content-Type", contentType)
	c.Status(http.StatusOK)
	io.Copy(c.Writer, out.Body)
}
