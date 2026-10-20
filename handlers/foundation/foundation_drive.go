package foundation

import (
	"container/list"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"attomos/config"
	"attomos/models"

	"attomos/google"
	"github.com/gin-gonic/gin"
)

// =============================================================================
// ATTOMOS FOUNDATION — foto de perfil en el Google Drive de la rescatista
//
// La foto NO se guarda en el servidor. Se sube al Drive de la rescatista
// (carpeta "Attomos Foundation") y se sirve por /foundation/img/:fileId con
// caché agresiva:
//   - Navegador / CDN: Cache-Control 1 año + immutable (el fileId nunca cambia
//     de contenido; una foto nueva = fileId nuevo).
//   - Memoria del servidor: LRU (FOUNDATION_IMG_CACHE_MB, 256 MB por defecto)
//     que se precalienta en la revisión periódica. Si la rescatista borra la
//     foto de su Drive, se sigue sirviendo desde aquí mientras siga en memoria.
//   - Si Drive falla y no está en memoria: dibujo de respaldo con caché corta.
// Una revisión cada 6 h detecta si la foto está en la papelera o si se
// desconectó el Drive y deja un aviso en el panel de la rescatista.
// =============================================================================

const (
	foundationMaxUpload   = 5 << 20 // 5 MB
	foundationImgMaxAge   = 31536000
	foundationCheckEvery  = 6 * time.Hour
	foundationStateCookie = "af_g_state"
)

var (
	foundationDriveSvc  *google.FoundationDrive
	foundationDriveErr  error
	foundationDriveOnce sync.Once
)

func foundationDrive() (*google.FoundationDrive, error) {
	foundationDriveOnce.Do(func() {
		foundationDriveSvc, foundationDriveErr = google.NewFoundationDrive()
		if foundationDriveErr != nil {
			log.Printf("⚠️  [Foundation] Drive deshabilitado: %v", foundationDriveErr)
		}
	})
	return foundationDriveSvc, foundationDriveErr
}

// ─── Caché LRU en memoria ────────────────────────────────────────────────────

type foundationImg struct {
	key  string
	data []byte
	mime string
}

type foundationImgCache struct {
	mu    sync.Mutex
	max   int
	size  int
	ll    *list.List
	items map[string]*list.Element
}

var foundationCache = newFoundationImgCache()

func newFoundationImgCache() *foundationImgCache {
	mb := 256
	if v, err := strconv.Atoi(os.Getenv("FOUNDATION_IMG_CACHE_MB")); err == nil && v > 0 {
		mb = v
	}
	return &foundationImgCache{max: mb << 20, ll: list.New(), items: map[string]*list.Element{}}
}

func (c *foundationImgCache) get(key string) (*foundationImg, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if el, ok := c.items[key]; ok {
		c.ll.MoveToFront(el)
		return el.Value.(*foundationImg), true
	}
	return nil, false
}

func (c *foundationImgCache) has(key string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	_, ok := c.items[key]
	return ok
}

func (c *foundationImgCache) put(key string, data []byte, mime string) {
	if len(data) > c.max/4 {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if el, ok := c.items[key]; ok {
		c.size -= len(el.Value.(*foundationImg).data)
		el.Value = &foundationImg{key, data, mime}
		c.size += len(data)
		c.ll.MoveToFront(el)
	} else {
		c.items[key] = c.ll.PushFront(&foundationImg{key, data, mime})
		c.size += len(data)
	}
	for c.size > c.max && c.ll.Len() > 0 {
		last := c.ll.Back()
		img := last.Value.(*foundationImg)
		c.ll.Remove(last)
		delete(c.items, img.key)
		c.size -= len(img.data)
	}
}

// ─── Helpers de sesión de Drive ──────────────────────────────────────────────

// foundationDriveSession abre Drive con el token de la rescatista y guarda el
// token si Google lo renovó.
func foundationDriveSession(r *models.FoundationRescuer) (*google.FoundationDriveSession, func(), error) {
	d, err := foundationDrive()
	if err != nil {
		return nil, func() {}, err
	}
	ctx, cancel := google.FoundationDriveTimeout()
	s, err := d.Session(ctx, r.GoogleToken)
	if err != nil {
		cancel()
		return nil, func() {}, err
	}
	done := func() {
		if t := s.NewToken(); t != "" {
			r.GoogleToken = t
			config.DB.Model(&models.FoundationRescuer{}).Where("id = ?", r.ID).Update("google_token", t)
		}
		cancel()
	}
	return s, done, nil
}

func foundationSetDriveIssue(rescuerID uint, issue string) {
	now := time.Now()
	config.DB.Model(&models.FoundationRescuer{}).Where("id = ?", rescuerID).
		Updates(map[string]interface{}{"drive_issue": issue, "drive_checked_at": &now})
}

// foundationDriveOwns true si el archivo lo subió Attomos para esta rescatista.
func foundationDriveOwns(r *models.FoundationRescuer, fileID string) bool {
	var count int64
	config.DB.Model(&models.FoundationFile{}).Where("file_id = ? AND rescuer_id = ?", fileID, r.ID).Count(&count)
	return count > 0
}

// ─── Conectar / desconectar Google Drive ─────────────────────────────────────

// GET /api/foundation/google/connect → { authUrl }
func FoundationDriveConnect(c *gin.Context) {
	d, err := foundationDrive()
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Google Drive no está configurado en el servidor"})
		return
	}
	r := foundationRescuerFromCtx(c)
	nonce := make([]byte, 16)
	_, _ = rand.Read(nonce)
	state := fmt.Sprintf("%d.%s", r.ID, hex.EncodeToString(nonce))
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(foundationStateCookie, state, 600, "/", "", strings.HasPrefix(os.Getenv("BASE_URL"), "https://"), true)
	c.JSON(http.StatusOK, gin.H{"authUrl": d.AuthURL(state)})
}

// GET /api/foundation/google/callback (redirect de Google, abre en popup)
func FoundationDriveCallback(c *gin.Context) {
	fail := func(code string) { foundationOAuthPopup(c, false, code) }
	d, err := foundationDrive()
	if err != nil {
		fail("not_configured")
		return
	}
	if e := c.Query("error"); e != "" {
		fail("denied")
		return
	}
	state := c.Query("state")
	saved, _ := c.Cookie(foundationStateCookie)
	c.SetCookie(foundationStateCookie, "", -1, "/", "", false, true)
	if state == "" || state != saved {
		fail("invalid_state")
		return
	}
	u := foundationCurrentUser(c)
	if u == nil {
		fail("no_session")
		return
	}
	var r models.FoundationRescuer
	rid, _ := strconv.Atoi(strings.SplitN(state, ".", 2)[0])
	if err := config.DB.Where("id = ? AND user_id = ?", rid, u.ID).First(&r).Error; err != nil {
		fail("not_found")
		return
	}

	ctx, cancel := google.FoundationDriveTimeout()
	defer cancel()
	tokenJSON, tok, err := d.Exchange(ctx, c.Query("code"))
	if err != nil {
		log.Printf("❌ [Foundation] Error intercambiando código de Google: %v", err)
		fail("token_exchange_failed")
		return
	}
	// Conservar el refresh token anterior si Google no manda uno nuevo
	if tok.RefreshToken == "" && r.GoogleToken != "" {
		var old struct {
			RefreshToken string `json:"refresh_token"`
		}
		_ = json.Unmarshal([]byte(r.GoogleToken), &old)
		tok.RefreshToken = old.RefreshToken
		b, _ := json.Marshal(tok)
		tokenJSON = string(b)
	}
	r.GoogleToken = tokenJSON
	r.GoogleEmail = d.Email(ctx, tok)

	s, done, err := foundationDriveSession(&r)
	if err != nil {
		fail("drive_error")
		return
	}
	folder, err := s.EnsureFolder(r.DriveFolderID)
	done()
	if err != nil {
		log.Printf("❌ [Foundation] Error creando carpeta en Drive: %v", err)
		fail("folder_error")
		return
	}
	now := time.Now()
	config.DB.Model(&models.FoundationRescuer{}).Where("id = ?", r.ID).Updates(map[string]interface{}{
		"google_token":       r.GoogleToken,
		"google_email":       r.GoogleEmail,
		"drive_folder_id":    folder,
		"drive_connected_at": &now,
		"drive_issue":        "",
	})
	log.Printf("✅ [Foundation] Drive conectado para rescatista %d (%s)", r.ID, r.GoogleEmail)
	foundationOAuthPopup(c, true, "")
}

// DELETE /api/foundation/google
func FoundationDriveDisconnect(c *gin.Context) {
	r := foundationRescuerFromCtx(c)
	config.DB.Model(&models.FoundationRescuer{}).Where("id = ?", r.ID).Updates(map[string]interface{}{
		"google_token": "", "google_email": "", "drive_folder_id": "", "drive_connected_at": nil, "drive_issue": "",
	})
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func foundationOAuthPopup(c *gin.Context, ok bool, code string) {
	payload, _ := json.Marshal(gin.H{"type": "af-google", "success": ok, "error": code})
	msg := "Listo, tu Google Drive quedó conectado. Esta ventana se cerrará sola."
	if !ok {
		msg = "No se pudo conectar Google Drive. Esta ventana se cerrará sola."
	}
	html := fmt.Sprintf(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Google Drive</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;color:#334155;text-align:center;padding:24px">
<div><p>%s</p><p style="font-size:14px"><a href="/foundation/panel#cuenta" style="color:#0891b2">Volver a mi panel</a></p></div>
<script>(function(){var p=%s;try{if(window.opener&&!window.opener.closed){window.opener.postMessage(p,window.location.origin);window.close();return;}}catch(e){}
setTimeout(function(){location.href='/foundation/panel#cuenta';},1200);})();</script></body></html>`, msg, string(payload))
	c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(html))
}

// ─── Subir foto ──────────────────────────────────────────────────────────────

// POST /api/foundation/upload (multipart: file) — foto de perfil
func FoundationUploadImage(c *gin.Context) {
	r := foundationRescuerFromCtx(c)
	if r.GoogleToken == "" {
		c.JSON(http.StatusConflict, gin.H{"error": "Conecta tu Google Drive para subir tu foto", "code": "drive_required"})
		return
	}
	fh, err := c.FormFile("file")
	if err != nil {
		badReq(c, "Elige una imagen", "file")
		return
	}
	if fh.Size > foundationMaxUpload {
		badReq(c, "La imagen pesa más de 5 MB", "file")
		return
	}
	f, err := fh.Open()
	if err != nil {
		badReq(c, "No se pudo leer la imagen", "file")
		return
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, foundationMaxUpload+1))
	if err != nil || len(data) == 0 || len(data) > foundationMaxUpload {
		badReq(c, "No se pudo leer la imagen", "file")
		return
	}
	mime := http.DetectContentType(data)
	ext := map[string]string{"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}[mime]
	if ext == "" {
		badReq(c, "Usa una imagen JPG, PNG o WebP", "file")
		return
	}

	s, done, err := foundationDriveSession(r)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "No pudimos conectar con tu Google Drive", "code": "drive_error"})
		return
	}
	defer done()
	folder, err := s.EnsureFolder(r.DriveFolderID)
	if err != nil {
		if google.IsFoundationAuthRevoked(err) {
			foundationSetDriveIssue(r.ID, "Se desconectó tu Google Drive. Vuelve a conectarlo.")
			c.JSON(http.StatusConflict, gin.H{"error": "Se desconectó tu Google Drive. Vuelve a conectarlo.", "code": "drive_required"})
			return
		}
		c.JSON(http.StatusBadGateway, gin.H{"error": "No pudimos preparar tu carpeta en Drive"})
		return
	}
	if folder != r.DriveFolderID {
		config.DB.Model(&models.FoundationRescuer{}).Where("id = ?", r.ID).Update("drive_folder_id", folder)
	}
	fileID, err := s.Upload(folder, "Foto de perfil"+ext, mime, data)
	if err != nil {
		log.Printf("❌ [Foundation] Error subiendo a Drive (rescatista %d): %v", r.ID, err)
		c.JSON(http.StatusBadGateway, gin.H{"error": "No se pudo subir la foto a tu Drive"})
		return
	}
	config.DB.Create(&models.FoundationFile{FileID: fileID, RescuerID: r.ID, Kind: "avatar", MimeType: mime, Size: len(data)})
	foundationCache.put(fileID, data, mime)
	c.JSON(http.StatusOK, gin.H{"fileId": fileID, "url": foundationImgURL(fileID)})
}

// ─── Servir foto ─────────────────────────────────────────────────────────────

const foundationPlaceholderSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe4e1"/><stop offset="1" stop-color="#fecaca"/></linearGradient></defs><rect width="400" height="300" fill="url(#g)"/><g fill="#f04f5f" fill-opacity=".45"><circle cx="160" cy="130" r="14"/><circle cx="185" cy="105" r="14"/><circle cx="215" cy="105" r="14"/><circle cx="240" cy="130" r="14"/><path d="M170 185c0-18 13-32 30-32s30 14 30 32c0 12-13 18-30 18s-30-6-30-18Z"/></g></svg>`

// GET /foundation/img/:fileId
func FoundationServeImage(c *gin.Context) {
	fileID := c.Param("fileId")
	if fileID == "" || len(fileID) > 120 {
		c.Status(http.StatusNotFound)
		return
	}
	etag := `"` + fileID + `"`
	if c.GetHeader("If-None-Match") == etag {
		c.Header("Cache-Control", fmt.Sprintf("public, max-age=%d, immutable", foundationImgMaxAge))
		c.Status(http.StatusNotModified)
		return
	}
	serve := func(img *foundationImg) {
		c.Header("Cache-Control", fmt.Sprintf("public, max-age=%d, immutable, stale-if-error=%d", foundationImgMaxAge, foundationImgMaxAge))
		c.Header("ETag", etag)
		c.Data(http.StatusOK, img.mime, img.data)
	}
	if img, ok := foundationCache.get(fileID); ok {
		serve(img)
		return
	}

	var file models.FoundationFile
	var r models.FoundationRescuer
	if config.DB.Where("file_id = ?", fileID).First(&file).Error != nil || config.DB.First(&r, file.RescuerID).Error != nil {
		foundationPlaceholder(c, http.StatusNotFound)
		return
	}
	data, mime, err := foundationFetch(&r, fileID)
	if err != nil {
		foundationPlaceholder(c, http.StatusOK)
		return
	}
	serve(&foundationImg{fileID, data, mime})
}

func foundationPlaceholder(c *gin.Context, status int) {
	c.Header("Cache-Control", "public, max-age=300")
	c.Data(status, "image/svg+xml", []byte(foundationPlaceholderSVG))
}

// foundationFetch baja la foto de Drive, la guarda en memoria y deja aviso si
// está en la papelera o ya no existe.
func foundationFetch(r *models.FoundationRescuer, fileID string) ([]byte, string, error) {
	if r.GoogleToken == "" {
		return nil, "", errors.New("drive desconectado")
	}
	s, done, err := foundationDriveSession(r)
	if err != nil {
		return nil, "", err
	}
	defer done()
	data, mime, trashed, err := s.Download(fileID, foundationMaxUpload)
	if err != nil {
		if google.IsFoundationAuthRevoked(err) {
			foundationSetDriveIssue(r.ID, foundationIssueRevoked)
		} else if errors.Is(err, google.ErrFoundationDriveGone) {
			foundationSetDriveIssue(r.ID, foundationIssueGone)
		}
		return nil, "", err
	}
	if trashed {
		foundationSetDriveIssue(r.ID, foundationIssueTrashed)
	}
	foundationCache.put(fileID, data, mime)
	return data, mime, nil
}

// ─── Revisión periódica ──────────────────────────────────────────────────────

const (
	foundationIssueRevoked = "Se desconectó tu Google Drive. Vuelve a conectarlo para que tu foto siga visible."
	foundationIssueGone    = "Borraste tu foto de perfil de la carpeta \"Attomos Foundation\" en Drive. Súbela de nuevo desde tu panel."
	foundationIssueTrashed = "Tu foto de perfil está en la papelera de Drive. Restáurala antes de 30 días para que no se pierda."
)

// StartFoundationDriveChecker revisa cada 6 h las fotos de perfil: precalienta
// la caché y avisa si alguna está en la papelera o ya no existe.
func StartFoundationDriveChecker() {
	if _, err := foundationDrive(); err != nil {
		return
	}
	go func() {
		time.Sleep(2 * time.Minute)
		for {
			foundationCheckAll()
			time.Sleep(foundationCheckEvery)
		}
	}()
}

func foundationCheckAll() {
	var rescuers []models.FoundationRescuer
	config.DB.Where("google_token <> '' AND avatar_file_id <> ''").Find(&rescuers)
	for i := range rescuers {
		foundationCheckRescuer(&rescuers[i])
	}
}

func foundationCheckRescuer(r *models.FoundationRescuer) {
	s, done, err := foundationDriveSession(r)
	if err != nil {
		return
	}
	defer done()
	issue := ""
	if foundationCache.has(r.AvatarFileID) {
		st, err := s.State(r.AvatarFileID)
		switch {
		case err != nil && google.IsFoundationAuthRevoked(err):
			issue = foundationIssueRevoked
		case err == nil && !st.Exists:
			issue = foundationIssueGone
		case err == nil && st.Trashed:
			issue = foundationIssueTrashed
		}
	} else {
		data, mime, trashed, err := s.Download(r.AvatarFileID, foundationMaxUpload)
		switch {
		case err != nil && google.IsFoundationAuthRevoked(err):
			issue = foundationIssueRevoked
		case errors.Is(err, google.ErrFoundationDriveGone):
			issue = foundationIssueGone
		case err == nil:
			foundationCache.put(r.AvatarFileID, data, mime)
			if trashed {
				issue = foundationIssueTrashed
			}
		}
	}
	foundationSetDriveIssue(r.ID, issue)
}
