package handlers

// blog_common.go — piezas compartidas del blog: slugs, fechas en español,
// procesado del HTML del artículo (índice, citas, tips) y los artículos
// iniciales que se cargan la primera vez.

import (
	"fmt"
	"html"
	"html/template"
	"log"
	"regexp"
	"strings"
	"time"
	"unicode"

	"attomos/config"
	"attomos/models"

	"golang.org/x/text/unicode/norm"
)

var blogMeses = []string{"", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto",
	"Septiembre", "Octubre", "Noviembre", "Diciembre"}

// blogLoc — hora de México para fechas de publicación (el admin escribe en su hora).
var blogLoc = func() *time.Location {
	if l, err := time.LoadLocation("America/Hermosillo"); err == nil {
		return l
	}
	return time.FixedZone("MST", -7*3600)
}()

func blogDateLabel(t time.Time) string {
	t = t.In(blogLoc)
	return fmt.Sprintf("%d %s %d", t.Day(), blogMeses[int(t.Month())], t.Year())
}

var blogTagRe = regexp.MustCompile(`(?s)<[^>]*>`)
var blogSpaceRe = regexp.MustCompile(`\s+`)

// blogPlainText — texto sin etiquetas, con entidades decodificadas.
func blogPlainText(h string) string {
	t := blogTagRe.ReplaceAllString(h, " ")
	t = html.UnescapeString(t)
	return strings.TrimSpace(blogSpaceRe.ReplaceAllString(t, " "))
}

// blogExcerpt — primeras ~max letras del contenido, cortando en palabra.
func blogExcerpt(h string, max int) string {
	t := blogPlainText(h)
	r := []rune(t)
	if len(r) <= max {
		return t
	}
	cut := string(r[:max])
	if i := strings.LastIndex(cut, " "); i > max/2 {
		cut = cut[:i]
	}
	return strings.TrimRight(cut, " ,.;:") + "…"
}

func blogReadMinutes(h string) int {
	w := len(strings.Fields(blogPlainText(h)))
	m := (w + 199) / 200
	if m < 1 {
		m = 1
	}
	return m
}

var blogSlugRe = regexp.MustCompile(`[^a-z0-9]+`)

// blogSlugify — "Cómo crear tu bot" → "como-crear-tu-bot".
func blogSlugify(s string) string {
	s = norm.NFD.String(strings.ToLower(strings.TrimSpace(s)))
	var b strings.Builder
	for _, r := range s {
		if unicode.Is(unicode.Mn, r) {
			continue
		}
		b.WriteRune(r)
	}
	out := strings.Trim(blogSlugRe.ReplaceAllString(b.String(), "-"), "-")
	if len([]rune(out)) > 90 {
		out = strings.Trim(string([]rune(out)[:90]), "-")
	}
	return out
}

func blogInitials(name string) string {
	var out []rune
	for _, w := range strings.Fields(name) {
		for _, r := range w {
			out = append(out, unicode.ToUpper(r))
			break
		}
		if len(out) == 2 {
			break
		}
	}
	if len(out) == 0 {
		return "A"
	}
	return string(out)
}

type blogTocItem struct {
	ID   string
	Text string
}

var (
	blogH2Re    = regexp.MustCompile(`(?is)<h2(\s[^>]*)?>(.*?)</h2>`)
	blogQuoteRe = regexp.MustCompile(`(?i)<blockquote(\s[^>]*)?>`)
	blogTipRe   = regexp.MustCompile(`(?is)<div class="bd-tip"(?:\s+data-title="([^"]*)")?\s*>(.*?)</div>`)
	blogImgRe   = regexp.MustCompile(`(?i)<img\s`)
)

const blogSparkSVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"/></svg>`

// blogRenderContent — el HTML del editor listo para la página pública:
// ids en los <h2> (para el índice "En este artículo"), estilo de citas y
// cajas de tip, imágenes con carga diferida.
func blogRenderContent(content string) (template.HTML, []blogTocItem) {
	var toc []blogTocItem
	used := map[string]int{}
	out := blogH2Re.ReplaceAllStringFunc(content, func(m string) string {
		sub := blogH2Re.FindStringSubmatch(m)
		inner := sub[2]
		text := blogPlainText(inner)
		if text == "" {
			return m
		}
		id := blogSlugify(text)
		if id == "" {
			id = "seccion"
		}
		if n := used[id]; n > 0 {
			used[id] = n + 1
			id = fmt.Sprintf("%s-%d", id, n+1)
		} else {
			used[id] = 1
		}
		toc = append(toc, blogTocItem{ID: id, Text: text})
		return `<h2 id="` + id + `">` + inner + `</h2>`
	})
	out = blogQuoteRe.ReplaceAllStringFunc(out, func(m string) string {
		if strings.Contains(strings.ToLower(m), "class=") {
			return m
		}
		return `<blockquote class="bd-quote">`
	})
	out = blogTipRe.ReplaceAllStringFunc(out, func(m string) string {
		sub := blogTipRe.FindStringSubmatch(m)
		title := sub[1]
		if title == "" {
			title = "Tip"
		}
		body := strings.TrimSpace(sub[2])
		if !strings.HasPrefix(strings.ToLower(body), "<p") {
			body = "<p>" + body + "</p>"
		}
		return `<aside class="bd-tip"><div class="bd-tip-icon">` + blogSparkSVG + `</div><div><div class="bd-tip-title">` +
			title + `</div>` + body + `</div></aside>`
	})
	out = blogImgRe.ReplaceAllString(out, `<img loading="lazy" decoding="async" `)
	return template.HTML(out), toc
}

// ── Artículos iniciales ──────────────────────────────────────────────────

var blogSeedCategories = []models.BlogCategory{
	{Name: "Inteligencia Artificial", Slug: "ai", Icon: "lni-brain", SortOrder: 1},
	{Name: "Automatización", Slug: "automation", Icon: "lni-cog", SortOrder: 2},
	{Name: "Negocios", Slug: "business", Icon: "lni-briefcase", SortOrder: 3},
	{Name: "Tutoriales", Slug: "tutorials", Icon: "lni-book", SortOrder: 4},
}

// EnsureBlogSeed — la primera vez (tabla vacía) crea las categorías base.
// El blog arranca sin artículos: todos se escriben desde /admin/blog.
func EnsureBlogSeed() {
	var nCat int64
	config.DB.Model(&models.BlogCategory{}).Count(&nCat)
	if nCat > 0 {
		return
	}
	for _, cat := range blogSeedCategories {
		c := cat
		config.DB.Create(&c)
	}
	log.Println("📝 [Blog] Categorías iniciales creadas")
}
