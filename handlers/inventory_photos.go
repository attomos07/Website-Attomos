package handlers

// inventory_photos.go — fotos de los artículos del Inventario. El navegador
// ya las reduce antes de subirlas; aquí solo se valida que sean imágenes y
// que no pesen de más. Se guardan en el bucket de Railway (privado) y se
// sirven por /media/inventario/foto/:fotoId solo al dueño del artículo.

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"time"

	"attomos/models"
	"attomos/storage"

	"github.com/gin-gonic/gin"
)

const invPhotoMax = 8 << 20

var invPhotoExt = map[string]string{
	"image/jpeg": ".jpg",
	"image/png":  ".png",
	"image/webp": ".webp",
}

func invPhotoID(c *gin.Context) (int64, bool) {
	id, err := strconv.ParseInt(c.Param("fotoId"), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Foto inválida."})
		return 0, false
	}
	return id, true
}

// InvUploadPhotos — POST /api/inventario/articulos/:id/fotos (multipart "files")
func InvUploadPhotos(c *gin.Context) {
	id, ok := invID(c)
	if !ok {
		return
	}
	uid := invUserID(c)
	if !storage.BucketReady() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "El almacenamiento de archivos no está disponible."})
		return
	}
	if _, err := models.GetInvItem(uid, id); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Ese artículo ya no existe."})
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, int64(models.MaxInvPhotos)*invPhotoMax+(1<<20))
	form, err := c.MultipartForm()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No llegaron las fotos (máximo 8 MB cada una)."})
		return
	}
	files := form.File["files"]
	if len(files) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Elige al menos una foto."})
		return
	}
	n, err := models.CountInvPhotos(uid, id)
	if err != nil {
		invFail(c, "CountPhotos", err, "No se pudieron subir las fotos.")
		return
	}
	if n+len(files) > models.MaxInvPhotos {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Cada artículo puede tener hasta %d fotos (ya tiene %d).", models.MaxInvPhotos, n)})
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	for _, fh := range files {
		if fh.Size > invPhotoMax {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "Una foto pesa más de 8 MB."})
			return
		}
		f, err := fh.Open()
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "No se pudo leer una foto."})
			return
		}
		content, err := io.ReadAll(f)
		f.Close()
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "No se pudo leer una foto."})
			return
		}
		ctype := http.DetectContentType(content)
		ext, ok := invPhotoExt[ctype]
		if !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Solo se aceptan fotos JPG, PNG o WEBP."})
			return
		}
		key := fmt.Sprintf("user_%d/inventario/fotos/%d-%d%s", uid, id, time.Now().UnixNano(), ext)
		if err := storage.UploadObject(ctx, key, content, ctype); err != nil {
			invFail(c, "UploadPhoto", err, "No se pudo subir la foto.")
			return
		}
		if _, err := models.AddInvPhoto(uid, id, key, ctype); err != nil {
			storage.DeleteObject(ctx, key)
			invFail(c, "AddPhoto", err, "No se pudo guardar la foto.")
			return
		}
	}
	photos, _ := models.ListInvPhotos(uid, id)
	invNotifyBots(uid)
	c.JSON(http.StatusOK, gin.H{"ok": true, "fotos": photos})
}

// InvDeletePhoto — DELETE /api/inventario/fotos/:fotoId
func InvDeletePhoto(c *gin.Context) {
	fid, ok := invPhotoID(c)
	if !ok {
		return
	}
	uid := invUserID(c)
	f, err := models.GetInvPhoto(uid, fid)
	if errors.Is(err, models.ErrInvPhotoNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "Esa foto ya no existe."})
		return
	}
	if err != nil {
		invFail(c, "GetPhoto", err, "No se pudo borrar la foto.")
		return
	}
	if err := models.DeleteInvPhoto(uid, fid); err != nil {
		invFail(c, "DeletePhoto", err, "No se pudo borrar la foto.")
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := storage.DeleteObject(ctx, f.ObjectKey); err != nil {
		log.Println("inventario.DeletePhoto bucket:", err)
	}
	photos, _ := models.ListInvPhotos(uid, f.ItemID)
	invNotifyBots(uid)
	c.JSON(http.StatusOK, gin.H{"ok": true, "fotos": photos})
}

// InvPhotoMain — POST /api/inventario/fotos/:fotoId/principal
func InvPhotoMain(c *gin.Context) {
	fid, ok := invPhotoID(c)
	if !ok {
		return
	}
	uid := invUserID(c)
	f, err := models.GetInvPhoto(uid, fid)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Esa foto ya no existe."})
		return
	}
	if err := models.SetInvPhotoMain(uid, fid); err != nil {
		invFail(c, "PhotoMain", err, "No se pudo cambiar la foto principal.")
		return
	}
	photos, _ := models.ListInvPhotos(uid, f.ItemID)
	invNotifyBots(uid)
	c.JSON(http.StatusOK, gin.H{"ok": true, "fotos": photos})
}

// InvListPhotos — GET /api/inventario/articulos/:id/fotos
func InvListPhotos(c *gin.Context) {
	id, ok := invID(c)
	if !ok {
		return
	}
	photos, err := models.ListInvPhotos(invUserID(c), id)
	if err != nil {
		invFail(c, "ListPhotos", err, "No se pudieron cargar las fotos.")
		return
	}
	c.JSON(http.StatusOK, gin.H{"fotos": photos})
}

// ServeInvPhoto — GET /media/inventario/foto/:fotoId (la imagen, con sesión)
func ServeInvPhoto(c *gin.Context) {
	fid, err := strconv.ParseInt(c.Param("fotoId"), 10, 64)
	if err != nil || fid <= 0 {
		c.Status(http.StatusNotFound)
		return
	}
	f, err := models.GetInvPhoto(invUserID(c), fid)
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	body, ctype, err := storage.GetObject(c.Request.Context(), f.ObjectKey)
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	defer body.Close()
	if ctype == "" {
		ctype = f.CType
	}
	// Cada foto tiene su propio id: si se cambia, es otro id.
	c.Header("Cache-Control", "private, max-age=2592000, immutable")
	c.DataFromReader(http.StatusOK, -1, ctype, body, nil)
}

// invDeletePhotoFiles borra del bucket las fotos de un artículo eliminado.
func invDeletePhotoFiles(keys []string) {
	if len(keys) == 0 {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		for _, k := range keys {
			storage.DeleteObject(ctx, k)
		}
	}()
}
