package foundation

import (
	"math"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"

	"attomos/config"
	"attomos/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// =============================================================================
// ATTOMOS FOUNDATION — perfil de rescatista, planes y listados
// =============================================================================

var foundationCountries = map[string]bool{"México": true, "Venezuela": true, "Ecuador": true}

const (
	foundationMaxPlans     = 12
	foundationMaxSuggested = 6
)

// foundationMinAmount mínimo que acepta la pasarela por cobro.
func foundationMinAmount(currency string) float64 {
	if currency == "MXN" {
		return 10 // Stripe MX: mínimo $10 MXN
	}
	return 1
}

func foundationImgURL(fileID string) string {
	if fileID == "" {
		return ""
	}
	return "/foundation/img/" + fileID
}

func idStr(id uint) string { return strconv.FormatUint(uint64(id), 10) }

func round2(v float64) float64 { return math.Round(v*100) / 100 }

func foundationPlanJSON(p *models.FoundationPlan) gin.H {
	return gin.H{
		"id":          idStr(p.ID),
		"name":        p.Name,
		"amount":      p.Amount,
		"description": p.Description,
		"perks":       p.PerkList(),
		"featured":    p.Featured,
	}
}

// foundationRescuerJSON forma que consume el frontend (foundation-*.js).
func foundationRescuerJSON(r *models.FoundationRescuer, private bool) gin.H {
	plans := make([]gin.H, 0, len(r.Plans))
	sort.SliceStable(r.Plans, func(i, j int) bool { return r.Plans[i].Amount < r.Plans[j].Amount })
	for i := range r.Plans {
		plans = append(plans, foundationPlanJSON(&r.Plans[i]))
	}
	methods := make([]gin.H, 0, len(r.PayoutMethods))
	for i := range r.PayoutMethods {
		methods = append(methods, foundationPayoutJSON(&r.PayoutMethods[i]))
	}
	cur := r.Currency()
	out := gin.H{
		"id":           idStr(r.ID),
		"slug":         r.Slug,
		"name":         r.Name,
		"city":         r.City,
		"country":      r.Country,
		"bio":          r.Bio,
		"avatar":       foundationImgURL(r.AvatarFileID),
		"avatarFileId": r.AvatarFileID,
		"socials": gin.H{
			"instagram": r.Instagram,
			"facebook":  r.Facebook,
			"tiktok":    r.TikTok,
			"whatsapp":  r.WhatsApp,
		},
		"currency":           cur,
		"plans":              plans,
		"allowCustomMonthly": r.AllowCustomMonthly,
		"minCustomMonthly":   r.MinCustomMonthly,
		"oneTime": gin.H{
			"enabled":     r.OneTimeEnabled,
			"suggested":   r.Suggested(),
			"allowCustom": r.OneTimeAllowCustom,
			"min":         r.OneTimeMin,
		},
		"published":     r.Published,
		"payoutMethods": methods,
		"payments": gin.H{
			"provider":  r.PaymentProvider(),
			"ready":     r.PaymentsReady(),
			"manual":    len(methods) > 0,
			"minAmount": foundationMinAmount(cur),
		},
	}
	if private {
		out["stripe"] = gin.H{
			"connected":      r.StripeAccountID != "",
			"status":         r.StripeStatus,
			"chargesEnabled": r.StripeChargesEnabled,
			"payoutsEnabled": r.StripePayoutsEnabled,
		}
		out["drive"] = gin.H{
			"connected": r.GoogleToken != "",
			"email":     r.GoogleEmail,
			"issue":     r.DriveIssue,
		}
	}
	return out
}

func foundationLoadRescuer(q *gorm.DB) *gorm.DB {
	return q.Preload("Plans").Preload("PayoutMethods", func(db *gorm.DB) *gorm.DB { return db.Order("sort_order ASC, id ASC") })
}

// ─── Público ─────────────────────────────────────────────────────────────────

// GET /api/foundation/rescuers?q=
func FoundationListRescuers(c *gin.Context) {
	var list []models.FoundationRescuer
	q := foundationLoadRescuer(config.DB.Where("published = ?", true))
	if s := strings.TrimSpace(c.Query("q")); s != "" {
		like := "%" + s + "%"
		q = q.Where("name LIKE ? OR city LIKE ? OR country LIKE ?", like, like, like)
	}
	q.Order("updated_at DESC").Limit(300).Find(&list)
	out := make([]gin.H, 0, len(list))
	for i := range list {
		out = append(out, foundationRescuerJSON(&list[i], false))
	}
	c.JSON(http.StatusOK, gin.H{"rescuers": out})
}

// GET /api/foundation/rescuers/:slug — publicado, o la dueña aunque no lo esté
func FoundationGetRescuer(c *gin.Context) {
	var r models.FoundationRescuer
	if err := foundationLoadRescuer(config.DB.Where("slug = ?", c.Param("slug"))).First(&r).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "No encontramos esta página"})
		return
	}
	u := foundationCurrentUser(c)
	isOwner := u != nil && u.ID == r.UserID
	if !r.Published && !isOwner {
		c.JSON(http.StatusNotFound, gin.H{"error": "No encontramos esta página"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"rescuer": foundationRescuerJSON(&r, false), "isOwner": isOwner})
}

// ─── Panel de la rescatista ──────────────────────────────────────────────────

// GET /api/foundation/rescuer
func FoundationGetMyRescuer(c *gin.Context) {
	r := foundationRescuerFromCtx(c)
	foundationLoadRescuer(config.DB).First(r, r.ID)
	c.JSON(http.StatusOK, gin.H{"rescuer": foundationRescuerJSON(r, true)})
}

type foundationRescuerReq struct {
	Name               string    `json:"name"`
	Slug               string    `json:"slug"`
	City               string    `json:"city"`
	Country            string    `json:"country"`
	Bio                string    `json:"bio"`
	AvatarFileID       string    `json:"avatarFileId"`
	Instagram          string    `json:"instagram"`
	Facebook           string    `json:"facebook"`
	TikTok             string    `json:"tiktok"`
	WhatsApp           string    `json:"whatsapp"`
	AllowCustomMonthly bool      `json:"allowCustomMonthly"`
	MinCustomMonthly   float64   `json:"minCustomMonthly"`
	OneTimeEnabled     bool      `json:"oneTimeEnabled"`
	OneTimeSuggested   []float64 `json:"oneTimeSuggested"`
	OneTimeAllowCustom bool      `json:"oneTimeAllowCustom"`
	OneTimeMin         float64   `json:"oneTimeMin"`
	Published          bool      `json:"published"`
}

var foundationSlugValid = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

func badReq(c *gin.Context, msg string, field string) {
	c.JSON(http.StatusBadRequest, gin.H{"error": msg, "field": field})
}

func runeLen(s string) int { return utf8.RuneCountInString(s) }

// PUT /api/foundation/rescuer
func FoundationUpdateMyRescuer(c *gin.Context) {
	r := foundationRescuerFromCtx(c)
	var req foundationRescuerReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badReq(c, "Datos inválidos", "")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	req.Slug = strings.TrimSpace(strings.ToLower(req.Slug))
	req.City = strings.TrimSpace(req.City)
	req.Bio = strings.TrimSpace(req.Bio)

	if runeLen(req.Name) < 2 || runeLen(req.Name) > 60 {
		badReq(c, "Escribe el nombre de tu rescate", "name")
		return
	}
	if !foundationSlugValid.MatchString(req.Slug) || len(req.Slug) > 48 {
		badReq(c, "La dirección solo puede tener letras minúsculas, números y guiones", "slug")
		return
	}
	var taken int64
	config.DB.Model(&models.FoundationRescuer{}).Where("slug = ? AND id <> ?", req.Slug, r.ID).Count(&taken)
	if taken > 0 {
		badReq(c, "Esa dirección ya la usa otro rescatista", "slug")
		return
	}
	if !foundationCountries[req.Country] {
		badReq(c, "Por ahora solo México, Venezuela y Ecuador", "country")
		return
	}
	if req.Country != r.Country {
		var active int64
		config.DB.Model(&models.FoundationPledge{}).
			Where("rescuer_id = ? AND status IN ?", r.ID, []string{models.FoundationPledgeActive, models.FoundationPledgeCanceling, models.FoundationPledgePastDue}).
			Count(&active)
		if active > 0 {
			badReq(c, "No puedes cambiar de país mientras tengas suscripciones activas", "country")
			return
		}
		if r.StripeAccountID != "" && req.Country != "México" {
			badReq(c, "Desconecta Stripe antes de cambiar a Venezuela", "country")
			return
		}
	}
	if runeLen(req.City) > 120 || runeLen(req.Bio) > 600 {
		badReq(c, "Texto demasiado largo", "bio")
		return
	}
	for _, s := range []string{req.Instagram, req.TikTok, req.WhatsApp} {
		if runeLen(s) > 120 {
			badReq(c, "Revisa tus redes sociales", "socials")
			return
		}
	}
	if runeLen(req.Facebook) > 255 {
		badReq(c, "Revisa tus redes sociales", "socials")
		return
	}

	cur := (&models.FoundationRescuer{Country: req.Country}).Currency()
	min := foundationMinAmount(cur)
	req.MinCustomMonthly = round2(req.MinCustomMonthly)
	req.OneTimeMin = round2(req.OneTimeMin)
	if req.AllowCustomMonthly && req.MinCustomMonthly < min {
		badReq(c, "El monto mínimo mensual debe ser de al menos $"+strconv.FormatFloat(min, 'f', -1, 64)+" "+cur, "minCustomMonthly")
		return
	}
	if req.OneTimeEnabled && req.OneTimeMin < min {
		badReq(c, "El monto mínimo de donación única debe ser de al menos $"+strconv.FormatFloat(min, 'f', -1, 64)+" "+cur, "oneTimeMin")
		return
	}
	if len(req.OneTimeSuggested) > foundationMaxSuggested {
		badReq(c, "Máximo 6 montos sugeridos", "oneTimeSuggested")
		return
	}
	seen := map[float64]bool{}
	sugg := make([]float64, 0, len(req.OneTimeSuggested))
	for _, v := range req.OneTimeSuggested {
		v = round2(v)
		if v < min || v > 1000000 || seen[v] {
			badReq(c, "Revisa los montos sugeridos", "oneTimeSuggested")
			return
		}
		seen[v] = true
		sugg = append(sugg, v)
	}
	sort.Float64s(sugg)
	if req.OneTimeEnabled && !req.OneTimeAllowCustom && len(sugg) == 0 {
		badReq(c, "Agrega al menos un monto sugerido o permite otro monto", "oneTimeSuggested")
		return
	}

	// La foto debe haberla subido Attomos al Drive de esta rescatista
	if req.AvatarFileID != "" && req.AvatarFileID != r.AvatarFileID && !foundationDriveOwns(r, req.AvatarFileID) {
		badReq(c, "No encontramos esa foto en tu Drive. Súbela de nuevo.", "photo")
		return
	}

	r.Name, r.Slug, r.City, r.Country, r.Bio = req.Name, req.Slug, foundationCanonicalCity(req.Country, req.City), req.Country, req.Bio
	r.AvatarFileID = req.AvatarFileID
	r.Instagram, r.Facebook = strings.TrimSpace(req.Instagram), strings.TrimSpace(req.Facebook)
	r.TikTok, r.WhatsApp = strings.TrimSpace(req.TikTok), strings.TrimSpace(req.WhatsApp)
	r.AllowCustomMonthly, r.MinCustomMonthly = req.AllowCustomMonthly, req.MinCustomMonthly
	r.OneTimeEnabled, r.OneTimeAllowCustom, r.OneTimeMin = req.OneTimeEnabled, req.OneTimeAllowCustom, req.OneTimeMin
	r.SetSuggested(sugg)
	r.Published = req.Published

	if err := config.DB.Omit("Plans", "PayoutMethods").Save(r).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "No se pudieron guardar los cambios"})
		return
	}
	foundationLoadRescuer(config.DB).First(r, r.ID)
	c.JSON(http.StatusOK, gin.H{"rescuer": foundationRescuerJSON(r, true)})
}

// ─── Planes ──────────────────────────────────────────────────────────────────

type foundationPlanReq struct {
	Name        string   `json:"name"`
	Amount      float64  `json:"amount"`
	Description string   `json:"description"`
	Perks       []string `json:"perks"`
	Featured    bool     `json:"featured"`
}

func (req *foundationPlanReq) validate(r *models.FoundationRescuer) string {
	req.Name = strings.TrimSpace(req.Name)
	req.Description = strings.TrimSpace(req.Description)
	req.Amount = round2(req.Amount)
	if runeLen(req.Name) < 2 || runeLen(req.Name) > 40 {
		return "Ponle nombre al plan"
	}
	min := foundationMinAmount(r.Currency())
	if req.Amount < min || req.Amount > 1000000 {
		return "El monto debe ser de al menos $" + strconv.FormatFloat(min, 'f', -1, 64) + " " + r.Currency()
	}
	if runeLen(req.Description) > 200 {
		return "La descripción es muy larga"
	}
	perks := make([]string, 0, len(req.Perks))
	for _, p := range req.Perks {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if runeLen(p) > 60 {
			return "Cada beneficio debe tener máximo 60 caracteres"
		}
		perks = append(perks, p)
	}
	if len(perks) > 6 {
		return "Máximo 6 beneficios"
	}
	req.Perks = perks
	return ""
}

func foundationSavePlan(c *gin.Context, r *models.FoundationRescuer, plan *models.FoundationPlan, req *foundationPlanReq) {
	plan.Name, plan.Amount, plan.Description, plan.Featured = req.Name, req.Amount, req.Description, req.Featured
	plan.SetPerks(req.Perks)
	err := config.DB.Transaction(func(tx *gorm.DB) error {
		if req.Featured {
			if err := tx.Model(&models.FoundationPlan{}).Where("rescuer_id = ?", r.ID).Update("featured", false).Error; err != nil {
				return err
			}
		}
		return tx.Save(plan).Error
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "No se pudo guardar el plan"})
		return
	}
	foundationLoadRescuer(config.DB).First(r, r.ID)
	c.JSON(http.StatusOK, gin.H{"plan": foundationPlanJSON(plan), "rescuer": foundationRescuerJSON(r, true)})
}

// POST /api/foundation/plans
func FoundationCreatePlan(c *gin.Context) {
	r := foundationRescuerFromCtx(c)
	var req foundationPlanReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badReq(c, "Datos inválidos", "")
		return
	}
	if msg := req.validate(r); msg != "" {
		badReq(c, msg, "")
		return
	}
	var count int64
	config.DB.Model(&models.FoundationPlan{}).Where("rescuer_id = ?", r.ID).Count(&count)
	if count >= foundationMaxPlans {
		badReq(c, "Máximo 12 planes", "")
		return
	}
	foundationSavePlan(c, r, &models.FoundationPlan{RescuerID: r.ID}, &req)
}

// PUT /api/foundation/plans/:id
func FoundationUpdatePlan(c *gin.Context) {
	r := foundationRescuerFromCtx(c)
	var plan models.FoundationPlan
	if err := config.DB.Where("id = ? AND rescuer_id = ?", c.Param("id"), r.ID).First(&plan).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Plan no encontrado"})
		return
	}
	var req foundationPlanReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badReq(c, "Datos inválidos", "")
		return
	}
	if msg := req.validate(r); msg != "" {
		badReq(c, msg, "")
		return
	}
	foundationSavePlan(c, r, &plan, &req)
}

// DELETE /api/foundation/plans/:id — las suscripciones ya creadas siguen
// cobrándose (el precio vive en Stripe); solo deja de ofrecerse.
func FoundationDeletePlan(c *gin.Context) {
	r := foundationRescuerFromCtx(c)
	res := config.DB.Where("id = ? AND rescuer_id = ?", c.Param("id"), r.ID).Delete(&models.FoundationPlan{})
	if res.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Plan no encontrado"})
		return
	}
	foundationLoadRescuer(config.DB).First(r, r.ID)
	c.JSON(http.StatusOK, gin.H{"ok": true, "rescuer": foundationRescuerJSON(r, true)})
}

// ─── Aportes ─────────────────────────────────────────────────────────────────

var foundationLiveStatuses = []string{models.FoundationPledgeActive, models.FoundationPledgeCanceling, models.FoundationPledgePastDue, models.FoundationPledgePaid}

func foundationPledgeJSON(p *models.FoundationPledge, donorName, rescuerName, rescuerSlug string) gin.H {
	return gin.H{
		"id":               idStr(p.ID),
		"type":             p.Type,
		"amount":           p.Amount,
		"currency":         p.Currency,
		"status":           p.Status,
		"planName":         p.PlanName,
		"donorName":        donorName,
		"rescuerName":      rescuerName,
		"rescuerSlug":      rescuerSlug,
		"totalPaid":        p.TotalPaid,
		"paymentsCount":    p.PaymentsCount,
		"lastPaidAt":       p.LastPaidAt,
		"currentPeriodEnd": p.CurrentPeriodEnd,
		"canceledAt":       p.CanceledAt,
		"createdAt":        p.CreatedAt.UnixMilli(),
	}
}

// GET /api/foundation/rescuer/pledges — aportes recibidos + estadísticas
func FoundationRescuerPledges(c *gin.Context) {
	r := foundationRescuerFromCtx(c)
	var pledges []models.FoundationPledge
	config.DB.Where("rescuer_id = ? AND status IN ?", r.ID, foundationLiveStatuses).
		Order("created_at DESC").Limit(500).Find(&pledges)

	donorIDs := make([]uint, 0, len(pledges))
	for _, p := range pledges {
		donorIDs = append(donorIDs, p.DonorID)
	}
	names := map[uint]string{}
	if len(donorIDs) > 0 {
		var users []models.FoundationUser
		config.DB.Select("id, name").Where("id IN ?", donorIDs).Find(&users)
		for _, u := range users {
			names[u.ID] = u.Name
		}
	}

	var subs int
	var monthly float64
	out := make([]gin.H, 0, len(pledges))
	for i := range pledges {
		p := &pledges[i]
		if p.IsMonthly() && (p.Status == models.FoundationPledgeActive || p.Status == models.FoundationPledgeCanceling) {
			monthly += p.Amount
			subs++
		}
		out = append(out, foundationPledgeJSON(p, names[p.DonorID], r.Name, r.Slug))
	}
	var received, oneTime float64
	config.DB.Model(&models.FoundationPayment{}).Where("rescuer_id = ?", r.ID).Select("COALESCE(SUM(amount),0)").Scan(&received)
	config.DB.Model(&models.FoundationPledge{}).Where("rescuer_id = ? AND type = ? AND status = ?", r.ID, models.FoundationPledgeOneTime, models.FoundationPledgePaid).
		Select("COALESCE(SUM(amount),0)").Scan(&oneTime)

	c.JSON(http.StatusOK, gin.H{
		"pledges": out,
		"stats": gin.H{
			"subscribers": subs,
			"monthly":     round2(monthly),
			"oneTime":     round2(oneTime),
			"received":    round2(received),
			"currency":    r.Currency(),
		},
	})
}

// GET /api/foundation/pledges — mis aportes (donador)
func FoundationMyPledges(c *gin.Context) {
	u := foundationCurrentUser(c)
	var pledges []models.FoundationPledge
	config.DB.Where("donor_id = ? AND status <> ? AND status <> ?", u.ID, models.FoundationPledgePending, models.FoundationPledgeExpired).
		Order("created_at DESC").Limit(500).Find(&pledges)
	ids := make([]uint, 0, len(pledges))
	for _, p := range pledges {
		ids = append(ids, p.RescuerID)
	}
	type rs struct {
		ID   uint
		Name string
		Slug string
	}
	rmap := map[uint]rs{}
	if len(ids) > 0 {
		var list []models.FoundationRescuer
		config.DB.Select("id, name, slug").Where("id IN ?", ids).Find(&list)
		for _, r := range list {
			rmap[r.ID] = rs{r.ID, r.Name, r.Slug}
		}
	}
	out := make([]gin.H, 0, len(pledges))
	for i := range pledges {
		p := &pledges[i]
		r := rmap[p.RescuerID]
		out = append(out, foundationPledgeJSON(p, u.Name, r.Name, r.Slug))
	}
	c.JSON(http.StatusOK, gin.H{"pledges": out})
}
