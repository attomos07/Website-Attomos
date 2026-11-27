package handlers

// newsletter.go — suscripción al newsletter del blog (formulario de /blog y
// de cada artículo), baja con un clic y el envío de un artículo a todos
// los suscriptores desde el panel admin.

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"html"
	"log"
	"net/http"
	"net/mail"
	"strings"
	"sync"
	"time"

	"attomos/config"
	"attomos/mailer"
	"attomos/models"

	"github.com/gin-gonic/gin"
)

func newsletterToken() string {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// Límite sencillo por IP para que no llenen la lista con bots.
var (
	nlHits   = map[string][]time.Time{}
	nlHitsMu sync.Mutex
)

func nlAllowed(ip string) bool {
	nlHitsMu.Lock()
	defer nlHitsMu.Unlock()
	now := time.Now()
	var keep []time.Time
	for _, t := range nlHits[ip] {
		if now.Sub(t) < 10*time.Minute {
			keep = append(keep, t)
		}
	}
	if len(keep) >= 5 {
		nlHits[ip] = keep
		return false
	}
	nlHits[ip] = append(keep, now)
	return true
}

// NewsletterSubscribe — POST /api/newsletter/subscribe {email, source}
func NewsletterSubscribe(c *gin.Context) {
	var req struct {
		Email   string `json:"email"`
		Source  string `json:"source"`
		Website string `json:"website"` // campo trampa: las personas no lo ven
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Escribe tu correo."})
		return
	}
	if req.Website != "" {
		c.JSON(http.StatusOK, gin.H{"ok": true, "message": "¡Listo! Ya estás suscrito."})
		return
	}
	email := strings.ToLower(strings.TrimSpace(req.Email))
	addr, err := mail.ParseAddress(email)
	if err != nil || addr.Address != email || !strings.Contains(email[strings.LastIndex(email, "@")+1:], ".") || len(email) > 190 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Ese correo no parece válido."})
		return
	}
	if !nlAllowed(c.ClientIP()) {
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "Demasiados intentos. Espera unos minutos."})
		return
	}
	source := strings.TrimSpace(req.Source)
	if len(source) > 60 {
		source = source[:60]
	}

	var sub models.NewsletterSubscriber
	if config.DB.Where("email = ?", email).First(&sub).Error == nil {
		if sub.Status == "activo" {
			c.JSON(http.StatusOK, gin.H{"ok": true, "message": "Ya estabas suscrito. ¡Gracias!"})
			return
		}
		config.DB.Model(&sub).Updates(map[string]interface{}{"status": "activo", "unsubscribed_at": nil})
	} else {
		sub = models.NewsletterSubscriber{Email: email, Token: newsletterToken(), Status: "activo", Source: source}
		if err := config.DB.Create(&sub).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "No se pudo guardar tu correo. Intenta de nuevo."})
			return
		}
	}

	base := bookingBaseURL(c)
	go func(s models.NewsletterSubscriber) {
		ms := mailer.NewEmailService()
		if !ms.Enabled() {
			return
		}
		body := nlEmailLayout(base, s.Token,
			`<h1 style="margin:0 0 12px;font-size:22px;color:#0f172a">¡Gracias por suscribirte!</h1>
			<p style="margin:0 0 16px;color:#334155;line-height:1.6">Te vamos a mandar los artículos nuevos del blog de Attomos: chatbots, inteligencia artificial y automatización para tu negocio.</p>
			<a href="`+base+`/blog" style="display:inline-block;background:#06b6d4;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600">Ir al blog</a>`)
		if err := ms.SendWithAttachments([]string{s.Email}, nil, "Bienvenido al blog de Attomos", body, nil); err != nil {
			log.Printf("⚠️  [Newsletter] Bienvenida a %s: %v", s.Email, err)
		}
	}(sub)

	c.JSON(http.StatusOK, gin.H{"ok": true, "message": "¡Listo! Ya estás suscrito."})
}

// NewsletterUnsubscribe — GET /newsletter/baja?token=...
func NewsletterUnsubscribe(c *gin.Context) {
	tok := strings.TrimSpace(c.Query("token"))
	msg := "El enlace no es válido o ya expiró."
	if tok != "" {
		var sub models.NewsletterSubscriber
		if config.DB.Where("token = ?", tok).First(&sub).Error == nil {
			now := time.Now()
			config.DB.Model(&sub).Updates(map[string]interface{}{"status": "baja", "unsubscribed_at": &now})
			msg = "Listo, " + html.EscapeString(sub.Email) + " ya no recibirá el newsletter."
		}
	}
	c.Header("Content-Type", "text/html; charset=utf-8")
	c.String(http.StatusOK, `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Newsletter - Attomos</title><meta name="robots" content="noindex"></head>
<body style="margin:0;font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f8fafc;display:grid;place-items:center;min-height:100vh">
<div style="background:#fff;border:1px solid #e5e7eb;border-radius:20px;padding:36px 32px;max-width:420px;text-align:center;box-shadow:0 10px 30px rgba(15,23,42,.06)">
<img src="/static/images/attomos-favicon.png" alt="" width="48" height="48"><h1 style="font-size:20px;color:#0f172a">Newsletter</h1>
<p style="color:#475569;line-height:1.6">%s</p><a href="/blog" style="color:#0891b2;font-weight:600">Volver al blog</a></div></body></html>`, msg)
}

// nlEmailLayout — marco común de los correos del newsletter.
func nlEmailLayout(base, token, inner string) string {
	return `<!DOCTYPE html><html><body style="margin:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:28px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:18px;overflow:hidden">
<tr><td style="padding:22px 28px;border-bottom:1px solid #e5e7eb"><img src="` + base + `/static/images/attomos-logo.png" alt="Attomos" height="34" style="display:block"></td></tr>
<tr><td style="padding:28px">` + inner + `</td></tr>
<tr><td style="padding:18px 28px;background:#f8fafc;color:#94a3b8;font-size:12px;line-height:1.6">
Recibes este correo porque te suscribiste al blog de Attomos.<br>
<a href="` + base + `/newsletter/baja?token=` + token + `" style="color:#64748b">Darme de baja</a></td></tr>
</table></td></tr></table></body></html>`
}

// nlSending — evita mandar el mismo artículo dos veces al mismo tiempo.
var nlSending sync.Map

// sendPostToSubscribers manda un artículo a todos los suscriptores activos
// (uno por uno, para que cada quien reciba su propio enlace de baja).
func sendPostToSubscribers(base string, p models.BlogPost) (int, error) {
	ms := mailer.NewEmailService()
	if !ms.Enabled() {
		return 0, fmt.Errorf("el correo no está configurado en el servidor (SMTP)")
	}
	if _, busy := nlSending.LoadOrStore(p.ID, true); busy {
		return 0, fmt.Errorf("este artículo ya se está enviando")
	}
	var subs []models.NewsletterSubscriber
	config.DB.Where("status = ?", "activo").Find(&subs)
	if len(subs) == 0 {
		nlSending.Delete(p.ID)
		return 0, fmt.Errorf("todavía no hay suscriptores")
	}
	card := blogToCard(&p)
	cover := card.Cover
	if strings.HasPrefix(cover, "/") {
		cover = base + cover
	}
	link := base + card.URL
	inner := `<img src="` + html.EscapeString(cover) + `" alt="" width="504" style="width:100%;max-width:504px;border-radius:12px;display:block;margin:0 0 18px">
<p style="margin:0 0 6px;color:#0891b2;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.04em">` + html.EscapeString(card.CategoryName) + `</p>
<h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#0f172a">` + html.EscapeString(card.Title) + `</h1>
<p style="margin:0 0 20px;color:#334155;line-height:1.6">` + html.EscapeString(card.Excerpt) + `</p>
<a href="` + link + `" style="display:inline-block;background:#06b6d4;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600">Leer artículo</a>`

	go func() {
		defer nlSending.Delete(p.ID)
		sent := 0
		for _, s := range subs {
			if err := ms.SendWithAttachments([]string{s.Email}, nil, card.Title, nlEmailLayout(base, s.Token, inner), nil); err != nil {
				log.Printf("⚠️  [Newsletter] %s: %v", s.Email, err)
				continue
			}
			sent++
			time.Sleep(400 * time.Millisecond) // no saturar el SMTP
		}
		log.Printf("📨 [Newsletter] \"%s\" enviado a %d de %d suscriptores", card.Title, sent, len(subs))
	}()
	now := time.Now()
	config.DB.Model(&models.BlogPost{}).Where("id = ?", p.ID).Update("newsletter_at", &now)
	return len(subs), nil
}
