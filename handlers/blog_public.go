package handlers

// blog_public.go — páginas públicas del blog (/blog y /blog/:slug), las
// imágenes del blog, el sitemap y el feed RSS. Todo se arma en el servidor
// para que Google y las vistas previas al compartir vean el contenido.

import (
	"encoding/json"
	"encoding/xml"
	"fmt"
	"html/template"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"attomos/config"
	"attomos/middleware"
	"attomos/models"
	"attomos/storage"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const blogPerPage = 6

// blogCard — lo que muestran las tarjetas.
type blogCard struct {
	Slug, URL, Title, Excerpt, Cover, CoverAlt string
	CategoryName, CategorySlug, CategoryIcon   string
	Date, ISODate, ReadTime                    string
	Author, AuthorRole, AuthorInitials         string
}

type blogCatLink struct {
	Name, Slug, Icon, URL string
	Active                bool
}

type blogPageLink struct {
	N      int
	URL    string
	Active bool
	Gap    bool
}

func blogPublishedQ() *gorm.DB {
	return config.DB.Model(&models.BlogPost{}).
		Where("status = ? AND published_at <= ?", "publicado", time.Now())
}

func blogToCard(p *models.BlogPost) blogCard {
	c := blogCard{
		Slug: p.Slug, URL: "/blog/" + url.PathEscape(p.Slug), Title: p.Title, Excerpt: p.Excerpt,
		Cover: p.CoverSrc(), CoverAlt: p.CoverAlt,
		Date: blogDateLabel(p.PublishedAt), ISODate: p.PublishedAt.Format(time.RFC3339),
		ReadTime: fmt.Sprintf("%d min lectura", blogReadMinutes(p.Content)),
		Author:   p.Author, AuthorRole: p.AuthorRole, AuthorInitials: blogInitials(p.Author),
		CategoryIcon: "lni-tag",
	}
	if c.Author == "" {
		c.Author = "Equipo Attomos"
		c.AuthorInitials = "EA"
	}
	if c.CoverAlt == "" {
		c.CoverAlt = p.Title
	}
	if c.Excerpt == "" {
		c.Excerpt = blogExcerpt(p.Content, 200)
	}
	if p.Category != nil {
		c.CategoryName, c.CategorySlug = p.Category.Name, p.Category.Slug
		if p.Category.Icon != "" {
			c.CategoryIcon = p.Category.Icon
		}
	}
	return c
}

func blogListURL(cat, q string, page int) string {
	v := url.Values{}
	if cat != "" {
		v.Set("categoria", cat)
	}
	if q != "" {
		v.Set("q", q)
	}
	if page > 1 {
		v.Set("pagina", strconv.Itoa(page))
	}
	if len(v) == 0 {
		return "/blog"
	}
	return "/blog?" + v.Encode()
}

// BlogList — GET /blog[?categoria=ai][&q=texto][&pagina=2]
func BlogList(c *gin.Context) {
	cat := strings.TrimSpace(c.Query("categoria"))
	q := strings.TrimSpace(c.Query("q"))
	page, _ := strconv.Atoi(c.Query("pagina"))
	if page < 1 {
		page = 1
	}

	var cats []models.BlogCategory
	config.DB.Order("sort_order, name").Find(&cats)
	var activeCat *models.BlogCategory
	for i := range cats {
		if cats[i].Slug == cat {
			activeCat = &cats[i]
		}
	}
	if activeCat == nil {
		cat = ""
	}

	// Categorías con al menos un artículo publicado.
	type cnt struct {
		CategoryID uint
		N          int
	}
	var counts []cnt
	blogPublishedQ().Select("category_id, count(*) as n").Group("category_id").Scan(&counts)
	has := map[uint]bool{}
	for _, x := range counts {
		has[x.CategoryID] = true
	}
	catLinks := []blogCatLink{{Name: "Todos", Slug: "", Icon: "lni-grid", URL: blogListURL("", q, 1), Active: cat == ""}}
	for _, ct := range cats {
		if !has[ct.ID] {
			continue
		}
		icon := ct.Icon
		if icon == "" {
			icon = "lni-tag"
		}
		catLinks = append(catLinks, blogCatLink{Name: ct.Name, Slug: ct.Slug, Icon: icon,
			URL: blogListURL(ct.Slug, q, 1), Active: ct.Slug == cat})
	}

	base := blogPublishedQ()
	if activeCat != nil {
		base = base.Where("category_id = ?", activeCat.ID)
	}
	if q != "" {
		like := "%" + q + "%"
		base = base.Where("(title LIKE ? OR excerpt LIKE ? OR content LIKE ?)", like, like, like)
	}

	// Destacado (marcado como tal o el más reciente): va arriba en la
	// primera página sin filtros y nunca se repite en la cuadrícula.
	var featured *blogCard
	if cat == "" && q == "" {
		var f models.BlogPost
		if blogPublishedQ().Preload("Category").Order("featured DESC, published_at DESC").First(&f).Error == nil {
			base = base.Where("id <> ?", f.ID)
			if page == 1 {
				fc := blogToCard(&f)
				featured = &fc
			}
		}
	}

	var total int64
	base.Session(&gorm.Session{}).Count(&total)
	pages := int(math.Ceil(float64(total) / blogPerPage))
	if pages < 1 {
		pages = 1
	}
	if page > pages {
		page = pages
	}
	var posts []models.BlogPost
	base.Preload("Category").Order("published_at DESC").Limit(blogPerPage).Offset((page - 1) * blogPerPage).Find(&posts)
	cards := make([]blogCard, 0, len(posts))
	for i := range posts {
		cards = append(cards, blogToCard(&posts[i]))
	}

	var pageLinks []blogPageLink
	for n := 1; n <= pages; n++ {
		if pages > 7 && n != 1 && n != pages && (n < page-1 || n > page+1) {
			if len(pageLinks) > 0 && !pageLinks[len(pageLinks)-1].Gap {
				pageLinks = append(pageLinks, blogPageLink{Gap: true})
			}
			continue
		}
		pageLinks = append(pageLinks, blogPageLink{N: n, URL: blogListURL(cat, q, n), Active: n == page})
	}
	prevURL, nextURL := "", ""
	if page > 1 {
		prevURL = blogListURL(cat, q, page-1)
	}
	if page < pages {
		nextURL = blogListURL(cat, q, page+1)
	}

	title := "Blog - Attomos"
	if activeCat != nil {
		title = activeCat.Name + " · Blog - Attomos"
	}
	baseURL := bookingBaseURL(c)
	c.HTML(http.StatusOK, "blog.html", gin.H{
		"title":      title,
		"Featured":   featured,
		"Posts":      cards,
		"Categories": catLinks,
		"ActiveCat":  activeCat,
		"Query":      q,
		"Total":      total,
		"Page":       page,
		"Pages":      pages,
		"PageLinks":  pageLinks,
		"ShowPager":  pages > 1,
		"PrevURL":    prevURL,
		"NextURL":    nextURL,
		"Canonical":  baseURL + blogListURL(cat, q, page),
		"BaseURL":    baseURL,
		"Filtered":   cat != "" || q != "",
		"ClearURL":   "/blog",
		"Newsletter": c.Query("newsletter"),
	})
}

// BlogDetail — GET /blog/:slug (con ?vista_previa=1 el admin ve borradores)
func BlogDetail(c *gin.Context) {
	slug := c.Param("slug")
	if slug == "feed.xml" {
		BlogRSS(c)
		return
	}
	preview := c.Query("vista_previa") == "1" && middleware.IsAdmin(c)

	var p models.BlogPost
	q := config.DB.Preload("Category").Preload("Tags").Where("slug = ?", slug)
	if !preview {
		q = q.Where("status = ? AND published_at <= ?", "publicado", time.Now())
	}
	base := bookingBaseURL(c)
	if err := q.First(&p).Error; err != nil {
		var recent []models.BlogPost
		blogPublishedQ().Preload("Category").Order("published_at DESC").Limit(3).Find(&recent)
		cards := make([]blogCard, 0, len(recent))
		for i := range recent {
			cards = append(cards, blogToCard(&recent[i]))
		}
		c.HTML(http.StatusNotFound, "blog-detail.html", gin.H{
			"title": "Artículo no encontrado - Attomos", "NotFound": true, "Related": cards, "BaseURL": base,
		})
		return
	}
	if !preview {
		config.DB.Model(&models.BlogPost{}).Where("id = ?", p.ID).UpdateColumn("views", gorm.Expr("views + 1"))
	}

	card := blogToCard(&p)
	body, toc := blogRenderContent(p.Content)

	// Relacionados: misma categoría primero, luego los más recientes.
	var related []models.BlogPost
	rq := blogPublishedQ().Preload("Category").Where("id <> ?", p.ID)
	if p.CategoryID != nil {
		rq.Session(&gorm.Session{}).Where("category_id = ?", *p.CategoryID).Order("published_at DESC").Limit(3).Find(&related)
	}
	if len(related) < 3 {
		ids := []uint{p.ID}
		for _, r := range related {
			ids = append(ids, r.ID)
		}
		var more []models.BlogPost
		blogPublishedQ().Preload("Category").Where("id NOT IN ?", ids).Order("published_at DESC").
			Limit(3 - len(related)).Find(&more)
		related = append(related, more...)
	}
	rel := make([]blogCard, 0, len(related))
	for i := range related {
		rel = append(rel, blogToCard(&related[i]))
	}

	desc := strings.TrimSpace(p.MetaDescription)
	if desc == "" {
		desc = card.Excerpt
	}
	cover := card.Cover
	if strings.HasPrefix(cover, "/") {
		cover = base + cover
	}
	canonical := base + card.URL
	ld, _ := json.Marshal(map[string]interface{}{
		"@context": "https://schema.org", "@type": "BlogPosting",
		"headline": p.Title, "description": desc, "image": cover,
		"datePublished": p.PublishedAt.Format(time.RFC3339), "dateModified": p.UpdatedAt.Format(time.RFC3339),
		"author":           map[string]string{"@type": "Person", "name": card.Author},
		"publisher":        map[string]interface{}{"@type": "Organization", "name": "Attomos", "logo": map[string]string{"@type": "ImageObject", "url": base + "/static/images/attomos-logo.png"}},
		"mainEntityOfPage": canonical,
	})
	var tags []string
	for _, t := range p.Tags {
		tags = append(tags, t.Name)
	}

	c.HTML(http.StatusOK, "blog-detail.html", gin.H{
		"title":       p.Title + " - Attomos",
		"Post":        card,
		"Body":        body,
		"Toc":         toc,
		"TocCount":    len(toc),
		"Tags":        tags,
		"Related":     rel,
		"Description": desc,
		"Canonical":   canonical,
		"OGImage":     cover,
		"JSONLD":      template.JS(string(ld)),
		"Preview":     preview,
		"Draft":       p.DisplayStatus() != "publicado",
		"BaseURL":     base,
	})
}

// ServeBlogImage — GET /media/blog/:key (portadas e imágenes de artículos)
func ServeBlogImage(c *gin.Context) {
	key := c.Param("key")
	if key == "" || strings.Contains(key, "/") || strings.Contains(key, "..") {
		c.Status(http.StatusNotFound)
		return
	}
	body, ctype, err := storage.GetObject(c.Request.Context(), "blog/"+key)
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	defer body.Close()
	if ctype == "" {
		ctype = "image/jpeg"
	}
	// Cada archivo tiene nombre único: si cambia la imagen, cambia la URL.
	c.Header("Cache-Control", "public, max-age=31536000, immutable")
	c.DataFromReader(http.StatusOK, -1, ctype, body, nil)
}

// ── Sitemap, RSS y robots ────────────────────────────────────────────────

type smURL struct {
	Loc     string `xml:"loc"`
	LastMod string `xml:"lastmod,omitempty"`
}
type smSet struct {
	XMLName xml.Name `xml:"urlset"`
	NS      string   `xml:"xmlns,attr"`
	URLs    []smURL  `xml:"url"`
}

// Sitemap — GET /sitemap.xml (páginas públicas + artículos del blog)
func Sitemap(c *gin.Context) {
	base := bookingBaseURL(c)
	set := smSet{NS: "http://www.sitemaps.org/schemas/sitemap/0.9"}
	for _, p := range []string{"/", "/pricing", "/agents", "/blog", "/contact", "/comy", "/terms", "/privacy"} {
		set.URLs = append(set.URLs, smURL{Loc: base + p})
	}
	var posts []models.BlogPost
	blogPublishedQ().Select("slug, updated_at, published_at").Order("published_at DESC").Find(&posts)
	for _, p := range posts {
		set.URLs = append(set.URLs, smURL{Loc: base + "/blog/" + url.PathEscape(p.Slug), LastMod: p.UpdatedAt.Format("2006-01-02")})
	}
	out, _ := xml.MarshalIndent(set, "", "  ")
	c.Data(http.StatusOK, "application/xml; charset=utf-8", append([]byte(xml.Header), out...))
}

// RobotsTxt — GET /robots.txt
func RobotsTxt(c *gin.Context) {
	base := bookingBaseURL(c)
	c.String(http.StatusOK, "User-agent: *\nDisallow: /admin\nDisallow: /api/\n\nSitemap: %s/sitemap.xml\n", base)
}

type rssItem struct {
	Title       string `xml:"title"`
	Link        string `xml:"link"`
	GUID        string `xml:"guid"`
	PubDate     string `xml:"pubDate"`
	Description string `xml:"description"`
	Category    string `xml:"category,omitempty"`
}
type rssChannel struct {
	Title       string    `xml:"title"`
	Link        string    `xml:"link"`
	Description string    `xml:"description"`
	Language    string    `xml:"language"`
	Items       []rssItem `xml:"item"`
}
type rssDoc struct {
	XMLName xml.Name   `xml:"rss"`
	Version string     `xml:"version,attr"`
	Channel rssChannel `xml:"channel"`
}

// BlogRSS — GET /blog/feed.xml
func BlogRSS(c *gin.Context) {
	base := bookingBaseURL(c)
	var posts []models.BlogPost
	blogPublishedQ().Preload("Category").Order("published_at DESC").Limit(30).Find(&posts)
	ch := rssChannel{Title: "Blog de Attomos", Link: base + "/blog", Language: "es-MX",
		Description: "Chatbots, inteligencia artificial y automatización para negocios."}
	for i := range posts {
		cd := blogToCard(&posts[i])
		ch.Items = append(ch.Items, rssItem{Title: cd.Title, Link: base + cd.URL, GUID: base + cd.URL,
			PubDate: posts[i].PublishedAt.Format(time.RFC1123Z), Description: cd.Excerpt, Category: cd.CategoryName})
	}
	out, _ := xml.MarshalIndent(rssDoc{Version: "2.0", Channel: ch}, "", "  ")
	c.Data(http.StatusOK, "application/rss+xml; charset=utf-8", append([]byte(xml.Header), out...))
}
