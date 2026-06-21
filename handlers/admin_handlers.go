package handlers

import (
	"crypto/sha256"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"attomos/config"
	"attomos/models"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
)

func getAdminSessionToken() string {
	secret := os.Getenv("ADMIN_SESSION_SECRET")
	if secret == "" {
		secret = "attomos-admin-fallback-secret"
	}
	h := sha256.Sum256([]byte(secret))
	return fmt.Sprintf("%x", h)
}

// AdminLogin — POST /admin/api/login
func AdminLogin(c *gin.Context) {
	var body struct {
		Identifier string `json:"identifier"`
		Password   string `json:"password"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos inválidos."})
		return
	}

	adminUser := os.Getenv("ADMIN_USERNAME")
	adminPass := os.Getenv("ADMIN_PASSWORD")

	if adminUser == "" || adminPass == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Administrador no configurado."})
		return
	}

	if body.Identifier != adminUser || body.Password != adminPass {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Credenciales incorrectas."})
		return
	}

	c.SetCookie(
		"admin_session",
		getAdminSessionToken(),
		int(8*time.Hour/time.Second),
		"/",
		"",
		os.Getenv("ENVIRONMENT") == "production",
		true,
	)

	c.JSON(http.StatusOK, gin.H{"success": true})
}

// AdminLogout — POST /admin/api/logout
func AdminLogout(c *gin.Context) {
	c.SetCookie("admin_session", "", -1, "/", "", false, true)
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// AdminCreateCompany — POST /admin/api/companies
// Body: { email, password, company, phoneNumber, businessType, businessSize, plan }
func AdminCreateCompany(c *gin.Context) {
	var body struct {
		Email        string `json:"email"`
		Password     string `json:"password"`
		Company      string `json:"company"`
		PhoneNumber  string `json:"phoneNumber"`
		BusinessType string `json:"businessType"`
		BusinessSize string `json:"businessSize"`
		Plan         string `json:"plan"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos inválidos."})
		return
	}

	body.Email = strings.TrimSpace(strings.ToLower(body.Email))
	body.Company = strings.TrimSpace(body.Company)

	if body.Email == "" || !strings.Contains(body.Email, "@") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Email inválido."})
		return
	}
	if len(body.Password) < 8 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Contraseña debe tener al menos 8 caracteres."})
		return
	}
	if body.Company == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Nombre del negocio requerido."})
		return
	}

	// Check duplicate email
	var existing models.User
	if err := config.DB.Where("email = ? AND deleted_at IS NULL", body.Email).First(&existing).Error; err == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "Ya existe un usuario con ese email."})
		return
	}

	// Hash password
	hashed, err := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al procesar contraseña."})
		return
	}

	// Create user
	user := models.User{
		Email:        body.Email,
		Password:     string(hashed),
		Company:      body.Company,
		PhoneNumber:  body.PhoneNumber,
		BusinessType: body.BusinessType,
		BusinessSize: body.BusinessSize,
	}
	if err := config.DB.Create(&user).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al crear usuario."})
		return
	}

	// Determine plan
	plan := body.Plan
	validPlans := map[string]bool{"gratuito": true, "proton": true, "neutron": true, "electron": true}
	if !validPlans[plan] {
		plan = "gratuito"
	}

	// Create subscription
	sub := models.Subscription{
		UserID: user.ID,
		Plan:   plan,
		Status: "active",
	}
	if plan != "gratuito" {
		sub.BillingCycle = "monthly"
		now := time.Now()
		end := now.AddDate(0, 1, 0)
		sub.CurrentPeriodStart = &now
		sub.CurrentPeriodEnd = &end
	}
	sub.SetPlanLimits()
	config.DB.Create(&sub)

	c.JSON(http.StatusCreated, gin.H{
		"success": true,
		"userId":  user.ID,
		"message": fmt.Sprintf("Empresa '%s' creada con plan %s.", body.Company, plan),
	})
}

// AdminUpdateCompanyPlan — PUT /admin/api/companies/:id/plan
// Body: { plan }
func AdminUpdateCompanyPlan(c *gin.Context) {
	userIDStr := c.Param("id")
	userID, err := strconv.ParseUint(userIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID inválido."})
		return
	}

	var body struct {
		Plan string `json:"plan"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos inválidos."})
		return
	}

	validPlans := map[string]bool{"gratuito": true, "proton": true, "neutron": true, "electron": true}
	if !validPlans[body.Plan] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Plan inválido."})
		return
	}

	// Upsert subscription
	var sub models.Subscription
	err = config.DB.Where("user_id = ?", userID).First(&sub).Error
	now := time.Now()

	if err != nil {
		// No subscription exists — create
		sub = models.Subscription{
			UserID:        uint(userID),
			Plan:          body.Plan,
			Status:        "active",
			PlanChangedAt: &now,
		}
		if body.Plan != "gratuito" {
			end := now.AddDate(0, 1, 0)
			sub.CurrentPeriodStart = &now
			sub.CurrentPeriodEnd = &end
			sub.BillingCycle = "monthly"
		}
		sub.SetPlanLimits()
		config.DB.Create(&sub)
	} else {
		sub.Plan = body.Plan
		sub.Status = "active"
		sub.PlanChangedAt = &now
		if body.Plan != "gratuito" && (sub.CurrentPeriodEnd == nil || time.Now().After(*sub.CurrentPeriodEnd)) {
			end := now.AddDate(0, 1, 0)
			sub.CurrentPeriodStart = &now
			sub.CurrentPeriodEnd = &end
			if sub.BillingCycle == "" {
				sub.BillingCycle = "monthly"
			}
		}
		sub.SetPlanLimits()
		config.DB.Save(&sub)
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": fmt.Sprintf("Plan actualizado a %s.", body.Plan),
	})
}

func AdminGetCompanies(c *gin.Context) {

	type CompanyRow struct {
		BranchID      uint                    `gorm:"column:branch_id"`
		BusinessName  string                  `gorm:"column:business_name"`
		BusinessType  string                  `gorm:"column:business_type"`
		BusinessSize  string                  `gorm:"column:business_size"`
		PhoneNumber   string                  `gorm:"column:phone_number"`
		Location      models.BusinessLocation `gorm:"column:location"`
		UserID        uint                    `gorm:"column:user_id"`
		Email         string                  `gorm:"column:email"`
		Company       string                  `gorm:"column:company"`
		UserCreatedAt time.Time               `gorm:"column:user_created_at"`
	}

	var rows []CompanyRow
	result := config.DB.
		Table("my_business_info b").
		Select(`b.id AS branch_id, b.business_name, b.business_type, b.business_size,
			b.phone_number, b.location,
			u.id AS user_id, u.email, u.company, u.created_at AS user_created_at`).
		Joins("JOIN users u ON u.id = b.user_id").
		Where("b.branch_number = 1 AND b.deleted_at IS NULL AND u.deleted_at IS NULL").
		Order("u.created_at DESC").
		Scan(&rows)

	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al obtener empresas."})
		return
	}

	// Obtener planes desde subscriptions (LEFT JOIN por si no tienen suscripción)
	type SubRow struct {
		UserID uint   `gorm:"column:user_id"`
		Plan   string `gorm:"column:plan"`
		Status string `gorm:"column:status"`
	}
	var subs []SubRow
	config.DB.Table("subscriptions").
		Select("user_id, plan, status").
		Where("status = 'active'").
		Scan(&subs)

	// Mapa userID → plan
	planMap := make(map[uint]string)
	for _, s := range subs {
		planMap[s.UserID] = s.Plan
	}

	companies := make([]gin.H, len(rows))
	for i, r := range rows {
		plan := planMap[r.UserID]
		if plan == "" {
			plan = "gratuito"
		}
		companies[i] = gin.H{
			"id":           r.UserID,
			"branchId":     r.BranchID,
			"businessName": r.BusinessName,
			"businessType": r.BusinessType,
			"businessSize": r.BusinessSize,
			"phoneNumber":  r.PhoneNumber,
			"city":         r.Location.City,
			"email":        r.Email,
			"company":      r.Company,
			"plan":         plan,
			"createdAt":    r.UserCreatedAt,
			"status":       "active",
		}
	}

	// Stats
	var totalCount int64
	config.DB.Model(&models.User{}).Where("deleted_at IS NULL").Count(&totalCount)

	var paidCount int64
	config.DB.Table("subscriptions").Where("status = 'active' AND plan NOT IN ?", []string{"gratuito", ""}).Count(&paidCount)

	firstOfMonth := time.Now().Truncate(24*time.Hour).AddDate(0, 0, -time.Now().Day()+1)
	var newCount int64
	config.DB.Model(&models.User{}).Where("created_at >= ? AND deleted_at IS NULL", firstOfMonth).Count(&newCount)

	c.JSON(http.StatusOK, gin.H{
		"companies": companies,
		"stats": gin.H{
			"total":  totalCount,
			"active": totalCount, // sin last_login_at usamos total como fallback
			"paid":   paidCount,
			"new":    newCount,
		},
	})
}
