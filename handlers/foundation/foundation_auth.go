package foundation

import (
	"errors"
	"net/http"
	"net/mail"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"attomos/config"
	"attomos/models"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"gorm.io/gorm"
)

// =============================================================================
// ATTOMOS FOUNDATION — autenticación propia (cookie af_token)
// Usa JWT_SECRET pero con audience "foundation", así un token del panel B2B
// de Attomos no sirve aquí y viceversa.
// =============================================================================

const (
	foundationCookie   = "af_token"
	foundationAudience = "attomos-foundation"
	foundationTokenTTL = 30 * 24 * time.Hour
)

type foundationClaims struct {
	UserID uint   `json:"uid"`
	Role   string `json:"role"`
	jwt.RegisteredClaims
}

func foundationSecret() ([]byte, error) {
	s := os.Getenv("JWT_SECRET")
	if s == "" {
		return nil, errors.New("JWT_SECRET no está configurado")
	}
	return []byte(s), nil
}

func foundationIssueToken(u *models.FoundationUser) (string, error) {
	secret, err := foundationSecret()
	if err != nil {
		return "", err
	}
	now := time.Now()
	claims := foundationClaims{
		UserID: u.ID,
		Role:   u.Role,
		RegisteredClaims: jwt.RegisteredClaims{
			Audience:  jwt.ClaimStrings{foundationAudience},
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(foundationTokenTTL)),
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(secret)
}

func foundationParseToken(raw string) (*foundationClaims, error) {
	secret, err := foundationSecret()
	if err != nil {
		return nil, err
	}
	claims := &foundationClaims{}
	_, err = jwt.ParseWithClaims(raw, claims, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("método de firma inválido")
		}
		return secret, nil
	}, jwt.WithAudience(foundationAudience))
	if err != nil {
		return nil, err
	}
	return claims, nil
}

func foundationSetCookie(c *gin.Context, token string, maxAge int) {
	secure := strings.HasPrefix(os.Getenv("BASE_URL"), "https://") || c.Request.TLS != nil
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(foundationCookie, token, maxAge, "/", "", secure, true)
}

// foundationCurrentUser usuario de la sesión o nil (sin abortar).
func foundationCurrentUser(c *gin.Context) *models.FoundationUser {
	if u, ok := c.Get("foundationUser"); ok {
		return u.(*models.FoundationUser)
	}
	raw, err := c.Cookie(foundationCookie)
	if err != nil || raw == "" {
		return nil
	}
	claims, err := foundationParseToken(raw)
	if err != nil {
		return nil
	}
	var u models.FoundationUser
	if err := config.DB.First(&u, claims.UserID).Error; err != nil {
		return nil
	}
	c.Set("foundationUser", &u)
	return &u
}

// FoundationAuthRequired middleware para la API privada.
func FoundationAuthRequired() gin.HandlerFunc {
	return func(c *gin.Context) {
		if foundationCurrentUser(c) == nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Inicia sesión para continuar"})
			return
		}
		c.Next()
	}
}

// FoundationRescuerRequired además exige rol rescatista y carga su perfil.
func FoundationRescuerRequired() gin.HandlerFunc {
	return func(c *gin.Context) {
		u := foundationCurrentUser(c)
		if u == nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Inicia sesión para continuar"})
			return
		}
		if u.Role != models.FoundationRoleRescuer {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Solo para rescatistas"})
			return
		}
		var r models.FoundationRescuer
		if err := config.DB.Where("user_id = ?", u.ID).First(&r).Error; err != nil {
			c.AbortWithStatusJSON(http.StatusNotFound, gin.H{"error": "No encontramos tu perfil de rescatista"})
			return
		}
		c.Set("foundationRescuer", &r)
		c.Next()
	}
}

func foundationRescuerFromCtx(c *gin.Context) *models.FoundationRescuer {
	r, _ := c.Get("foundationRescuer")
	return r.(*models.FoundationRescuer)
}

func foundationUserJSON(u *models.FoundationUser) gin.H {
	return gin.H{"id": u.ID, "name": u.Name, "email": u.Email, "role": u.Role}
}

// ─── Registro / login ────────────────────────────────────────────────────────

var foundationSlugRe = regexp.MustCompile(`[^a-z0-9]+`)

func foundationSlugify(s string) string {
	repl := strings.NewReplacer("á", "a", "é", "e", "í", "i", "ó", "o", "ú", "u", "ü", "u", "ñ", "n",
		"Á", "a", "É", "e", "Í", "i", "Ó", "o", "Ú", "u", "Ü", "u", "Ñ", "n")
	s = strings.ToLower(repl.Replace(strings.TrimSpace(s)))
	s = strings.Trim(foundationSlugRe.ReplaceAllString(s, "-"), "-")
	if len(s) > 48 {
		s = strings.Trim(s[:48], "-")
	}
	if s == "" {
		s = "rescatista"
	}
	return s
}

func foundationUniqueSlug(tx *gorm.DB, base string, exceptID uint) string {
	slug := base
	for n := 2; ; n++ {
		var count int64
		q := tx.Model(&models.FoundationRescuer{}).Where("slug = ?", slug)
		if exceptID != 0 {
			q = q.Where("id <> ?", exceptID)
		}
		q.Count(&count)
		if count == 0 || n > 200 {
			return slug
		}
		slug = base + "-" + strconv.Itoa(n)
	}
}

// POST /api/foundation/auth/register
func FoundationRegister(c *gin.Context) {
	var req struct {
		Name     string `json:"name"`
		Email    string `json:"email"`
		Password string `json:"password"`
		Role     string `json:"role"`
		Country  string `json:"country"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos inválidos"})
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	if utf8.RuneCountInString(req.Name) < 2 || utf8.RuneCountInString(req.Name) > 120 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Escribe tu nombre"})
		return
	}
	if _, err := mail.ParseAddress(req.Email); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Escribe un correo válido"})
		return
	}
	if len(req.Password) < 8 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "La contraseña debe tener al menos 8 caracteres"})
		return
	}
	if req.Role != models.FoundationRoleRescuer {
		req.Role = models.FoundationRoleDonor
	}

	var exists int64
	config.DB.Model(&models.FoundationUser{}).Where("email = ?", req.Email).Count(&exists)
	if exists > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "Ya existe una cuenta con ese correo"})
		return
	}

	user := models.FoundationUser{Name: req.Name, Email: req.Email, Role: req.Role}
	if err := user.HashPassword(req.Password); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "No se pudo crear la cuenta"})
		return
	}

	err := config.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&user).Error; err != nil {
			return err
		}
		if user.Role != models.FoundationRoleRescuer {
			return nil
		}
		country := "México"
		if req.Country == "Venezuela" {
			country = "Venezuela"
		}
		r := models.FoundationRescuer{
			UserID:             user.ID,
			Name:               req.Name,
			Slug:               foundationUniqueSlug(tx, foundationSlugify(req.Name), 0),
			Country:            country,
			AllowCustomMonthly: true,
			OneTimeEnabled:     true,
			OneTimeAllowCustom: true,
		}
		foundationApplyCountryDefaults(&r)
		return tx.Create(&r).Error
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "No se pudo crear la cuenta"})
		return
	}

	token, err := foundationIssueToken(&user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "No se pudo iniciar sesión"})
		return
	}
	foundationSetCookie(c, token, int(foundationTokenTTL.Seconds()))
	c.JSON(http.StatusCreated, gin.H{"user": foundationUserJSON(&user)})
}

// foundationApplyCountryDefaults montos por defecto según la moneda.
func foundationApplyCountryDefaults(r *models.FoundationRescuer) {
	if r.Currency() == "USD" {
		r.MinCustomMonthly, r.OneTimeMin = 3, 1
		r.SetSuggested([]float64{10, 20, 50})
	} else {
		r.MinCustomMonthly, r.OneTimeMin = 50, 20
		r.SetSuggested([]float64{100, 200, 500})
	}
}

// POST /api/foundation/auth/login
func FoundationLogin(c *gin.Context) {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos inválidos"})
		return
	}
	var user models.FoundationUser
	email := strings.ToLower(strings.TrimSpace(req.Email))
	if err := config.DB.Where("email = ?", email).First(&user).Error; err != nil || !user.CheckPassword(req.Password) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Correo o contraseña incorrectos"})
		return
	}
	token, err := foundationIssueToken(&user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "No se pudo iniciar sesión"})
		return
	}
	foundationSetCookie(c, token, int(foundationTokenTTL.Seconds()))
	c.JSON(http.StatusOK, gin.H{"user": foundationUserJSON(&user)})
}

// POST /api/foundation/auth/logout
func FoundationLogout(c *gin.Context) {
	foundationSetCookie(c, "", -1)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// GET /api/foundation/auth/me — 200 con user (o user:null si no hay sesión)
func FoundationMe(c *gin.Context) {
	u := foundationCurrentUser(c)
	if u == nil {
		c.JSON(http.StatusOK, gin.H{"user": nil})
		return
	}
	c.JSON(http.StatusOK, gin.H{"user": foundationUserJSON(u)})
}

// PATCH /api/foundation/auth/me — cambiar nombre
func FoundationUpdateMe(c *gin.Context) {
	u := foundationCurrentUser(c)
	var req struct {
		Name string `json:"name"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos inválidos"})
		return
	}
	name := strings.TrimSpace(req.Name)
	if utf8.RuneCountInString(name) < 2 || utf8.RuneCountInString(name) > 120 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Escribe tu nombre"})
		return
	}
	config.DB.Model(u).Update("name", name)
	u.Name = name
	c.JSON(http.StatusOK, gin.H{"user": foundationUserJSON(u)})
}

// foundationPageGuard protege /foundation/panel desde el servidor.
func foundationPageGuard(c *gin.Context) bool {
	if foundationCurrentUser(c) != nil {
		return true
	}
	c.Redirect(http.StatusFound, "/foundation/login?next=/foundation/panel")
	return false
}
