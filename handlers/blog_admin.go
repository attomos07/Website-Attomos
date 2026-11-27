package handlers

// blog_admin.go — panel admin del blog (/admin/blog) y del newsletter
// (/admin/newsletter): crear, editar, programar y borrar artículos,
// categorías y etiquetas; subir portadas e imágenes; mandar un artículo a
// los suscriptores y exportar la lista.

import (
	"context"
	"encoding/csv"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"attomos/config"
	"attomos/models"
	"attomos/storage"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type blogAdminRow struct {
	ID                                      uint
	Title, Slug, URL, Cover, CategoryName   string
	CategorySlug, Status, StatusLabel, Date string
	Author                                  string
	Views                                   int
	Featured                                bool
	NewsletterAt                            string
}

var blogStatusLabel = map[string]string{"publicado": "Publicado", "programado": "Programado", "borrador": "Borrador"}

// AdminBlogPage — GET /admin/blog
func AdminBlogPage(c *gin.Context) {
	var posts []models.BlogPost
	config.DB.Preload("Category").Order("published_at DESC, id DESC").Find(&posts)
	rows := make([]blogAdminRow, 0, len(posts))
	counts := map[string]int{}
	for i := range posts {
		p := &posts[i]
		st := p.DisplayStatus()
		counts[st]++
		r := blogAdminRow{ID: p.ID, Title: p.Title, Slug: p.Slug, URL: "/blog/" + p.Slug, Cover: p.CoverSrc(),
			Status: st, StatusLabel: blogStatusLabel[st], Date: blogDateLabel(p.PublishedAt), Author: p.Author,
			Views: p.Views, Featured: p.Featured}
		if st != "publicado" {
			r.URL += "?vista_previa=1"
		}
		if p.Category != nil {
			r.CategoryName, r.CategorySlug = p.Category.Name, p.Category.Slug
		}
		if p.NewsletterAt != nil {
			r.NewsletterAt = blogDateLabel(*p.NewsletterAt)
		}
		rows = append(rows, r)
	}
	var cats []models.BlogCategory
	config.DB.Order("sort_order, name").Find(&cats)
	var tags []models.BlogTag
	config.DB.Order("name").Find(&tags)
	var subs int64
	config.DB.Model(&models.NewsletterSubscriber{}).Where("status = ?", "activo").Count(&subs)

	c.HTML(http.StatusOK, "admin-blog", gin.H{
		"Posts": rows, "Total": len(rows), "Publicados": counts["publicado"], "Programados": counts["programado"],
		"Borradores": counts["borrador"], "Categories": cats, "Tags": tags, "Subscribers": subs,
	})
}

type blogFormView struct {
	ID                                    uint
	Title, Slug, Content, Cover, CoverAlt string
	CategoryID                            uint
	CategoryName                          string
	Author, AuthorRole, Status, MetaDesc  string
	Date, Time                            string
	Featured                              bool
	TagIDs                                map[uint]bool
}

// AdminBlogForm — GET /admin/blog/nuevo y /admin/blog/:id/editar
func AdminBlogForm(c *gin.Context) {
	var cats []models.BlogCategory
	config.DB.Order("sort_order, name").Find(&cats)
	var tags []models.BlogTag
	config.DB.Order("name").Find(&tags)

	now := time.Now().In(blogLoc)
	v := blogFormView{Status: "borrador", Author: "Equipo Attomos", AuthorRole: "Attomos",
		Date: now.Format("2006-01-02"), Time: now.Format("15:04"), TagIDs: map[uint]bool{}}
	editing := false
	if id := c.Param("id"); id != "" {
		var p models.BlogPost
		if err := config.DB.Preload("Tags").Preload("Category").First(&p, id).Error; err != nil {
			c.Redirect(http.StatusFound, "/admin/blog")
			return
		}
		editing = true
		pa := p.PublishedAt.In(blogLoc)
		v = blogFormView{ID: p.ID, Title: p.Title, Slug: p.Slug, Content: p.Content, Cover: p.CoverSrc(),
			CoverAlt: p.CoverAlt, Author: p.Author, AuthorRole: p.AuthorRole, Status: p.Status,
			MetaDesc: p.MetaDescription, Date: pa.Format("2006-01-02"), Time: pa.Format("15:04"),
			Featured: p.Featured, TagIDs: map[uint]bool{}}
		if p.CategoryID != nil {
			v.CategoryID = *p.CategoryID
		}
		if p.Category != nil {
			v.CategoryName = p.Category.Name
		}
		for _, t := range p.Tags {
			v.TagIDs[t.ID] = true
		}
	}
	if v.CategoryName == "" && len(cats) > 0 && v.CategoryID == 0 {
		v.CategoryID, v.CategoryName = cats[0].ID, cats[0].Name
	}
	c.HTML(http.StatusOK, "admin-blog-form", gin.H{"Post": v, "Editing": editing, "Categories": cats, "Tags": tags})
}

var blogImageExt = map[string]string{".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif"}

// blogUpload sube un archivo del form al bucket (blog/<uuid>.<ext>) y
// regresa la clave.
func blogUpload(c *gin.Context, field string) (string, error) {
	fh, err := c.FormFile(field)
	if err != nil {
		return "", nil // sin archivo
	}
	if fh.Size > 8<<20 {
		return "", fmt.Errorf("la imagen pesa más de 8 MB")
	}
	ext := strings.ToLower(filepath.Ext(fh.Filename))
	ctype, ok := blogImageExt[ext]
	if !ok {
		return "", fmt.Errorf("usa una imagen JPG, PNG, WEBP o GIF")
	}
	f, err := fh.Open()
	if err != nil {
		return "", err
	}
	defer f.Close()
	data, err := io.ReadAll(f)
	if err != nil {
		return "", err
	}
	key := uuid.NewString() + ext
	if err := storage.UploadObject(c.Request.Context(), "blog/"+key, data, ctype); err != nil {
		return "", fmt.Errorf("no se pudo subir la imagen: %v", err)
	}
	return key, nil
}

func blogDeleteFile(key string) {
	if key == "" {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		_ = storage.DeleteObject(ctx, "blog/"+key)
	}()
}

// blogUniqueSlug — slug libre (agrega -2, -3... si ya existe).
func blogUniqueSlug(want string, exceptID uint) string {
	base := blogSlugify(want)
	if base == "" {
		base = "articulo"
	}
	slug := base
	for n := 2; ; n++ {
		var cnt int64
		config.DB.Model(&models.BlogPost{}).Where("slug = ? AND id <> ?", slug, exceptID).Count(&cnt)
		if cnt == 0 && slug != "feed.xml" {
			return slug
		}
		slug = fmt.Sprintf("%s-%d", base, n)
	}
}

// AdminBlogSave — POST /admin/api/blog (nuevo) y PUT /admin/api/blog/:id
// (multipart: title, slug, content, category_id, status, date, time,
// author, author_role, meta_description, featured, tags[], cover, cover_alt)
func AdminBlogSave(c *gin.Context) {
	var p models.BlogPost
	editing := c.Param("id") != ""
	if editing {
		if err := config.DB.First(&p, c.Param("id")).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Artículo no encontrado"})
			return
		}
	}
	title := strings.TrimSpace(c.PostForm("title"))
	content := strings.TrimSpace(c.PostForm("content"))
	if title == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Escribe el título."})
		return
	}
	if blogPlainText(content) == "" && !strings.Contains(content, "<img") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Escribe el contenido del artículo."})
		return
	}
	status := c.PostForm("status")
	if status != "publicado" {
		status = "borrador"
	}
	pubAt := time.Now()
	if d, t := c.PostForm("date"), c.PostForm("time"); d != "" {
		if t == "" {
			t = "09:00"
		}
		if v, err := time.ParseInLocation("2006-01-02 15:04", d+" "+t, blogLoc); err == nil {
			pubAt = v
		}
	}

	coverKey, err := blogUpload(c, "cover")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if coverKey == "" && p.CoverKey == "" && p.CoverURL == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Sube una imagen de portada."})
		return
	}

	slugIn := strings.TrimSpace(c.PostForm("slug"))
	if slugIn == "" {
		slugIn = title
	}
	p.Slug = blogUniqueSlug(slugIn, p.ID)
	p.Title = title
	p.Content = content
	p.Excerpt = blogExcerpt(content, 200)
	p.Status = status
	p.PublishedAt = pubAt
	p.Author = strings.TrimSpace(c.PostForm("author"))
	if p.Author == "" {
		p.Author = "Equipo Attomos"
	}
	p.AuthorRole = strings.TrimSpace(c.PostForm("author_role"))
	p.MetaDescription = strings.TrimSpace(c.PostForm("meta_description"))
	if len([]rune(p.MetaDescription)) > 300 {
		p.MetaDescription = string([]rune(p.MetaDescription)[:300])
	}
	p.CoverAlt = strings.TrimSpace(c.PostForm("cover_alt"))
	p.Featured = c.PostForm("featured") == "1"
	if cid, _ := strconv.Atoi(c.PostForm("category_id")); cid > 0 {
		u := uint(cid)
		p.CategoryID = &u
	} else {
		p.CategoryID = nil
	}
	oldKey := ""
	if coverKey != "" {
		oldKey = p.CoverKey
		p.CoverKey, p.CoverURL = coverKey, ""
	}

	var tags []models.BlogTag
	if ids := c.PostFormArray("tags"); len(ids) > 0 {
		config.DB.Where("id IN ?", ids).Find(&tags)
	}

	err = config.DB.Transaction(func(tx *gorm.DB) error {
		if p.Featured {
			// solo un artículo destacado a la vez
			if err := tx.Model(&models.BlogPost{}).Where("id <> ?", p.ID).Update("featured", false).Error; err != nil {
				return err
			}
		}
		if err := tx.Omit("Tags", "Category").Save(&p).Error; err != nil {
			return err
		}
		return tx.Model(&p).Association("Tags").Replace(tags)
	})
	if err != nil {
		if coverKey != "" {
			blogDeleteFile(coverKey)
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "No se pudo guardar el artículo."})
		return
	}
	blogDeleteFile(oldKey)
	c.JSON(http.StatusOK, gin.H{"ok": true, "id": p.ID, "slug": p.Slug, "status": p.DisplayStatus()})
}

// AdminBlogDelete — DELETE /admin/api/blog/:id
func AdminBlogDelete(c *gin.Context) {
	var p models.BlogPost
	if err := config.DB.First(&p, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Artículo no encontrado"})
		return
	}
	config.DB.Model(&p).Association("Tags").Clear()
	if err := config.DB.Delete(&p).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "No se pudo borrar"})
		return
	}
	blogDeleteFile(p.CoverKey)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// AdminBlogUploadImage — POST /admin/api/blog-imagen (imagen dentro del artículo)
func AdminBlogUploadImage(c *gin.Context) {
	key, err := blogUpload(c, "image")
	if err != nil || key == "" {
		msg := "Elige una imagen."
		if err != nil {
			msg = err.Error()
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	c.JSON(http.StatusOK, gin.H{"url": "/media/blog/" + key})
}

// AdminBlogNewsletter — POST /admin/api/blog/:id/newsletter
func AdminBlogNewsletter(c *gin.Context) {
	var p models.BlogPost
	if err := config.DB.Preload("Category").First(&p, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Artículo no encontrado"})
		return
	}
	if p.DisplayStatus() != "publicado" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Publica el artículo antes de mandarlo."})
		return
	}
	n, err := sendPostToSubscribers(bookingBaseURL(c), p)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "count": n})
}

// ── Categorías y etiquetas ──────────────────────────────────────────────

// AdminBlogCategoryCreate — POST /admin/api/blog-categorias {name, icon}
func AdminBlogCategoryCreate(c *gin.Context) {
	var req struct{ Name, Icon string }
	_ = c.ShouldBindJSON(&req)
	name := strings.TrimSpace(req.Name)
	slug := blogSlugify(name)
	if name == "" || slug == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Escribe el nombre de la categoría."})
		return
	}
	icon := strings.TrimSpace(req.Icon)
	if icon == "" || !strings.HasPrefix(icon, "lni-") {
		icon = "lni-tag"
	}
	var max int
	config.DB.Model(&models.BlogCategory{}).Select("COALESCE(MAX(sort_order),0)").Scan(&max)
	cat := models.BlogCategory{Name: name, Slug: slug, Icon: icon, SortOrder: max + 1}
	if err := config.DB.Create(&cat).Error; err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": "Ya existe una categoría con ese nombre."})
		return
	}
	c.JSON(http.StatusOK, cat)
}

// AdminBlogCategoryDelete — DELETE /admin/api/blog-categorias/:id
// (los artículos de esa categoría se quedan sin categoría)
func AdminBlogCategoryDelete(c *gin.Context) {
	id := c.Param("id")
	config.DB.Model(&models.BlogPost{}).Where("category_id = ?", id).Update("category_id", nil)
	config.DB.Delete(&models.BlogCategory{}, id)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// AdminBlogTagCreate — POST /admin/api/blog-etiquetas {name}
func AdminBlogTagCreate(c *gin.Context) {
	var req struct{ Name string }
	_ = c.ShouldBindJSON(&req)
	name := strings.TrimSpace(req.Name)
	slug := blogSlugify(name)
	if name == "" || slug == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Escribe el nombre de la etiqueta."})
		return
	}
	t := models.BlogTag{Name: name, Slug: slug}
	if err := config.DB.Create(&t).Error; err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": "Ya existe esa etiqueta."})
		return
	}
	c.JSON(http.StatusOK, t)
}

// AdminBlogTagDelete — DELETE /admin/api/blog-etiquetas/:id
func AdminBlogTagDelete(c *gin.Context) {
	id := c.Param("id")
	config.DB.Exec("DELETE FROM blog_post_tags WHERE blog_tag_id = ?", id)
	config.DB.Delete(&models.BlogTag{}, id)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ── Newsletter ──────────────────────────────────────────────────────────

type nlRow struct {
	ID                          uint
	Email, Status, Source, Date string
}

// AdminNewsletterPage — GET /admin/newsletter
func AdminNewsletterPage(c *gin.Context) {
	var subs []models.NewsletterSubscriber
	config.DB.Order("created_at DESC").Find(&subs)
	rows := make([]nlRow, 0, len(subs))
	act := 0
	for _, s := range subs {
		if s.Status == "activo" {
			act++
		}
		src := s.Source
		if src == "" {
			src = "blog"
		}
		rows = append(rows, nlRow{ID: s.ID, Email: s.Email, Status: s.Status, Source: src, Date: blogDateLabel(s.CreatedAt)})
	}
	c.HTML(http.StatusOK, "admin-newsletter", gin.H{"Subs": rows, "Total": len(rows), "Activos": act, "Bajas": len(rows) - act})
}

// AdminNewsletterCSV — GET /admin/api/newsletter.csv
func AdminNewsletterCSV(c *gin.Context) {
	var subs []models.NewsletterSubscriber
	config.DB.Order("created_at DESC").Find(&subs)
	c.Header("Content-Type", "text/csv; charset=utf-8")
	c.Header("Content-Disposition", `attachment; filename="newsletter-attomos.csv"`)
	c.Writer.Write([]byte("\xEF\xBB\xBF")) // BOM para que Excel lea acentos
	w := csv.NewWriter(c.Writer)
	_ = w.Write([]string{"correo", "estado", "origen", "fecha"})
	for _, s := range subs {
		_ = w.Write([]string{s.Email, s.Status, s.Source, s.CreatedAt.In(blogLoc).Format("2006-01-02 15:04")})
	}
	w.Flush()
}

// AdminNewsletterDelete — DELETE /admin/api/newsletter/:id
func AdminNewsletterDelete(c *gin.Context) {
	config.DB.Delete(&models.NewsletterSubscriber{}, c.Param("id"))
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
