package handlers

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"log"

	"attomos/config"
	"attomos/models"
	"attomos/services"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ============================================================
// GetMyBusiness - Lista todas las sucursales del usuario
// ============================================================
func GetMyBusiness(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}
	user := userInterface.(*models.User)

	var branches []models.MyBusinessInfo
	err := config.DB.Where("user_id = ?", user.ID).Order("branch_number asc").Find(&branches).Error
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al obtener sucursales"})
		return
	}

	// Si no tiene ninguna, devolver una respuesta vacía base
	if len(branches) == 0 {
		c.JSON(http.StatusOK, gin.H{
			"branches":      []gin.H{},
			"activeBranch":  nil,
			"defaultBranch": buildEmptyBranchResponse(user, 1),
		})
		return
	}

	branchList := make([]gin.H, len(branches))
	for i, b := range branches {
		branchList[i] = gin.H{
			"id":           b.ID,
			"branchNumber": b.BranchNumber,
			"branchName":   b.BranchName,
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"branches":     branchList,
		"activeBranch": buildBranchResponse(&branches[0]),
	})
}

// ============================================================
// GetBranch - Obtiene una sucursal específica por ID
// ============================================================
func GetBranch(c *gin.Context) {
	branchID := c.Param("id")
	userInterface, _ := c.Get("user")
	user := userInterface.(*models.User)

	var branch models.MyBusinessInfo
	if err := config.DB.Where("id = ? AND user_id = ?", branchID, user.ID).First(&branch).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Sucursal no encontrada"})
		return
	}

	c.JSON(http.StatusOK, buildBranchResponse(&branch))
}

// ============================================================
// SaveMyBusiness - Guarda/actualiza una sucursal
// ============================================================
func SaveMyBusiness(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}
	user := userInterface.(*models.User)

	var req BranchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos inválidos: " + err.Error()})
		return
	}

	var branch models.MyBusinessInfo

	// Si viene branch_id en el body, actualizar esa sucursal
	if req.BranchID > 0 {
		if err := config.DB.Where("id = ? AND user_id = ?", req.BranchID, user.ID).First(&branch).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Sucursal no encontrada"})
			return
		}
	} else {
		// Crear o actualizar la primera sucursal (compatibilidad)
		err := config.DB.Where("user_id = ?", user.ID).Order("branch_number asc").First(&branch).Error
		if err == gorm.ErrRecordNotFound {
			var maxNum int
			config.DB.Model(&models.MyBusinessInfo{}).Where("user_id = ?", user.ID).Select("COALESCE(MAX(branch_number), 0)").Scan(&maxNum)
			branch = models.MyBusinessInfo{
				UserID:       user.ID,
				BranchNumber: maxNum + 1,
			}
		} else if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al buscar sucursal"})
			return
		}
	}

	// Mapear datos del request al modelo
	mapRequestToBranch(&branch, req, user)

	// Auto-generar nombre desde dirección
	branch.UpdateBranchName()

	if branch.ID == 0 {
		if err := config.DB.Create(&branch).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al crear sucursal: " + err.Error()})
			return
		}
	} else {
		if err := config.DB.Save(&branch).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al guardar sucursal: " + err.Error()})
			return
		}
	}

	// Sincronizar business_config.json en bots atómicos vinculados a esta sucursal
	syncAtomicBots(&branch)

	c.JSON(http.StatusOK, gin.H{
		"success":    true,
		"message":    "Sucursal guardada exitosamente",
		"branch":     buildBranchResponse(&branch),
		"branchName": branch.BranchName,
	})
}

// syncAtomicBots actualiza el business_config.json de todos los AtomicBots
// vinculados a la sucursal guardada, en goroutines para no bloquear la respuesta.
func syncAtomicBots(branch *models.MyBusinessInfo) {
	var agents []models.Agent
	if err := config.DB.Where(
		"branch_id = ? AND bot_type = ? AND server_ip != '' AND is_active = ?",
		branch.ID, "atomic", true,
	).Find(&agents).Error; err != nil || len(agents) == 0 {
		return
	}

	log.Printf("🔄 [SyncBots] Sincronizando %d bot(s) atómico(s) para sucursal %d...", len(agents), branch.ID)

	for _, agent := range agents {
		go func(a models.Agent) {
			svc := services.NewAtomicBotDeployService(a.ServerIP, a.ServerPassword)
			if err := svc.Connect(); err != nil {
				log.Printf("⚠️  [SyncBots] No se pudo conectar al servidor del agente %d: %v", a.ID, err)
				return
			}
			defer svc.Close()
			if err := svc.UpdateBusinessConfig(&a, branch); err != nil {
				log.Printf("⚠️  [SyncBots] Error actualizando config del agente %d: %v", a.ID, err)
			} else {
				log.Printf("✅ [SyncBots] Agente %d actualizado con datos de sucursal %d", a.ID, branch.ID)
			}
		}(agent)
	}
}

// ============================================================
// CreateBranch - Crea una nueva sucursal
// ============================================================
func CreateBranch(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}
	user := userInterface.(*models.User)

	// Contar sucursales actuales para asignar número
	var count int64
	config.DB.Model(&models.MyBusinessInfo{}).Where("user_id = ?", user.ID).Count(&count)

	// Obtener datos del negocio de la primera sucursal para heredar nombre/tipo
	var firstBranch models.MyBusinessInfo
	config.DB.Where("user_id = ?", user.ID).Order("branch_number asc").First(&firstBranch)

	newBranch := models.MyBusinessInfo{
		UserID:       user.ID,
		BranchNumber: int(count) + 1,
		BranchName:   fmt.Sprintf("Sucursal %d", count+1),
		BusinessName: firstBranch.BusinessName,
		BusinessType: firstBranch.BusinessType,
		BusinessSize: firstBranch.BusinessSize,
		Schedule: models.BusinessSchedule{
			Monday:    models.DaySchedule{Open: true, Start: "09:00", End: "20:00"},
			Tuesday:   models.DaySchedule{Open: true, Start: "09:00", End: "20:00"},
			Wednesday: models.DaySchedule{Open: true, Start: "09:00", End: "20:00"},
			Thursday:  models.DaySchedule{Open: true, Start: "09:00", End: "20:00"},
			Friday:    models.DaySchedule{Open: true, Start: "09:00", End: "20:00"},
			Saturday:  models.DaySchedule{Open: true, Start: "09:00", End: "14:00"},
			Sunday:    models.DaySchedule{Open: false, Start: "09:00", End: "14:00"},
			Timezone:  "America/Hermosillo",
		},
	}

	if err := config.DB.Create(&newBranch).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al crear sucursal"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"success": true,
		"message": "Sucursal creada exitosamente",
		"branch":  buildBranchResponse(&newBranch),
	})
}

// ============================================================
// DeleteBranch - Elimina una sucursal (no la primera)
// ============================================================
func DeleteBranch(c *gin.Context) {
	branchID := c.Param("id")
	userInterface, _ := c.Get("user")
	user := userInterface.(*models.User)

	var branch models.MyBusinessInfo
	if err := config.DB.Where("id = ? AND user_id = ?", branchID, user.ID).First(&branch).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Sucursal no encontrada"})
		return
	}

	if branch.BranchNumber == 1 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No puedes eliminar la sucursal principal"})
		return
	}

	if err := config.DB.Delete(&branch).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al eliminar sucursal"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "message": "Sucursal eliminada"})
}

// ============================================================
// syncAgentsWithBranch — DEPRECADO
// Los agentes ya no duplican datos del negocio en su config.
// La fuente de verdad es my_business_info via agents.branch_id.
func syncAgentsWithBranch(_ uint, _ uint, _ BranchRequest) {}

// syncAgentsWithBusiness — DEPRECADO
func syncAgentsWithBusiness(_ uint, _ ProfileRequest) {}

// ============================================================
// Helpers
// ============================================================

func mapRequestToBranch(branch *models.MyBusinessInfo, req BranchRequest, user *models.User) {
	branch.BusinessName = req.Business.Name
	branch.BusinessType = req.Business.Type
	branch.Description = req.Business.Description
	branch.Website = req.Business.Website
	branch.Email = req.Business.Email
	branch.PhoneNumber = req.PhoneNumber
	if req.Business.LogoURL != "" {
		branch.LogoURL = req.Business.LogoURL
	}
	if req.Business.BannerURL != "" {
		branch.BannerURL = req.Business.BannerURL
	}
	if req.Business.MenuURL != "" {
		branch.MenuURL = req.Business.MenuURL
	}

	branch.Location = models.BusinessLocation{
		Address:        req.Location.Address,
		BetweenStreets: req.Location.BetweenStreets,
		Number:         req.Location.Number,
		Neighborhood:   req.Location.Neighborhood,
		City:           req.Location.City,
		State:          req.Location.State,
		Country:        req.Location.Country,
		PostalCode:     req.Location.PostalCode,
	}

	branch.SocialMedia = models.BusinessSocialMedia{
		Facebook:  req.Social.Facebook,
		Instagram: req.Social.Instagram,
		Twitter:   req.Social.Twitter,
		LinkedIn:  req.Social.LinkedIn,
	}

	branch.Schedule = models.BusinessSchedule{
		Monday:    models.DaySchedule{Open: req.Schedule.Monday.IsOpen, Start: req.Schedule.Monday.Open, End: req.Schedule.Monday.Close},
		Tuesday:   models.DaySchedule{Open: req.Schedule.Tuesday.IsOpen, Start: req.Schedule.Tuesday.Open, End: req.Schedule.Tuesday.Close},
		Wednesday: models.DaySchedule{Open: req.Schedule.Wednesday.IsOpen, Start: req.Schedule.Wednesday.Open, End: req.Schedule.Wednesday.Close},
		Thursday:  models.DaySchedule{Open: req.Schedule.Thursday.IsOpen, Start: req.Schedule.Thursday.Open, End: req.Schedule.Thursday.Close},
		Friday:    models.DaySchedule{Open: req.Schedule.Friday.IsOpen, Start: req.Schedule.Friday.Open, End: req.Schedule.Friday.Close},
		Saturday:  models.DaySchedule{Open: req.Schedule.Saturday.IsOpen, Start: req.Schedule.Saturday.Open, End: req.Schedule.Saturday.Close},
		Sunday:    models.DaySchedule{Open: req.Schedule.Sunday.IsOpen, Start: req.Schedule.Sunday.Open, End: req.Schedule.Sunday.Close},
		Timezone:  "America/Hermosillo",
	}

	holidays := make(models.BusinessHolidays, len(req.Holidays))
	for i, h := range req.Holidays {
		year := time.Now().Year()
		holidays[i] = models.Holiday{
			Date: fmt.Sprintf("%d-%s-%s", year, h.Month, h.Day),
			Name: h.Name,
		}
	}
	branch.Holidays = holidays

	// ── Servicios: incluye imageUrl y promoPeriod ───────────────────────────
	branchServices := make(models.BranchServices, len(req.Services))
	for i, s := range req.Services {
		branchServices[i] = models.BranchService{
			Title:           s.Title,
			Description:     s.Description,
			PriceType:       s.PriceType,
			Price:           s.Price,
			OriginalPrice:   s.OriginalPrice,
			PromoPrice:      s.PromoPrice,
			ImageURL:        s.ImageURL,
			ImageUrls:       s.ImageUrls,
			PromoPeriodType: s.PromoPeriodType,
			PromoDays:       s.PromoDays,
			PromoDateStart:  s.PromoDateStart,
			PromoDateEnd:    s.PromoDateEnd,
			InStock:         s.InStock,
			StockQty:        s.StockQty,
		}
	}
	branch.Services = branchServices

	workers := make(models.BranchWorkers, len(req.Workers))
	for i, w := range req.Workers {
		workers[i] = models.BranchWorker{
			Name:      w.Name,
			StartTime: w.StartTime,
			EndTime:   w.EndTime,
			Days:      w.Days,
		}
	}
	branch.Workers = workers
}

func buildBranchResponse(b *models.MyBusinessInfo) gin.H {
	holidays := make([]gin.H, len(b.Holidays))
	for i, h := range b.Holidays {
		month, day := parseDate(h.Date)
		holidays[i] = gin.H{"month": month, "day": day, "name": h.Name, "date": fmt.Sprintf("%s/%s", day, month)}
	}

	// ── Servicios: incluye imageUrl y promoPeriod en la respuesta ───────────
	svcList := make([]gin.H, len(b.Services))
	for i, s := range b.Services {
		svcList[i] = gin.H{
			"title":           s.Title,
			"description":     s.Description,
			"priceType":       s.PriceType,
			"price":           s.Price,
			"originalPrice":   s.OriginalPrice,
			"promoPrice":      s.PromoPrice,
			"imageUrl":        s.ImageURL,
			"imageUrls":       s.ImageUrls,
			"promoPeriodType": s.PromoPeriodType,
			"promoDays":       s.PromoDays,
			"promoDateStart":  s.PromoDateStart,
			"promoDateEnd":    s.PromoDateEnd,
			"inStock":         s.InStock,
			"stockQty":        s.StockQty,
		}
	}

	workers := make([]gin.H, len(b.Workers))
	for i, w := range b.Workers {
		workers[i] = gin.H{"name": w.Name, "startTime": w.StartTime, "endTime": w.EndTime, "days": w.Days}
	}

	return gin.H{
		"id":           b.ID,
		"branchNumber": b.BranchNumber,
		"branchName":   b.BranchName,
		"business": gin.H{
			"name": b.BusinessName, "type": b.BusinessType,
			"typeName": getTypeName(b.BusinessType), "size": b.BusinessSize,
			"description": b.Description, "website": b.Website, "email": b.Email,
			"logoUrl": b.LogoURL, "bannerUrl": b.BannerURL, "menuUrl": b.MenuURL,
		},
		"phoneNumber": b.PhoneNumber,
		"schedule": gin.H{
			"monday": dayToFrontend(b.Schedule.Monday), "tuesday": dayToFrontend(b.Schedule.Tuesday),
			"wednesday": dayToFrontend(b.Schedule.Wednesday), "thursday": dayToFrontend(b.Schedule.Thursday),
			"friday": dayToFrontend(b.Schedule.Friday), "saturday": dayToFrontend(b.Schedule.Saturday),
			"sunday": dayToFrontend(b.Schedule.Sunday),
		},
		"holidays": holidays,
		"location": gin.H{
			"address": b.Location.Address, "betweenStreets": b.Location.BetweenStreets,
			"number": b.Location.Number, "neighborhood": b.Location.Neighborhood,
			"city": b.Location.City, "state": b.Location.State,
			"country": b.Location.Country, "postalCode": b.Location.PostalCode,
		},
		"social": gin.H{
			"facebook": b.SocialMedia.Facebook, "instagram": b.SocialMedia.Instagram,
			"twitter": b.SocialMedia.Twitter, "linkedin": b.SocialMedia.LinkedIn,
		},
		"services": svcList,
		"workers":  workers,
	}
}

func buildEmptyBranchResponse(user *models.User, num int) gin.H {
	defaultDay := gin.H{"isOpen": true, "open": "09:00", "close": "20:00"}
	return gin.H{
		"id": 0, "branchNumber": num, "branchName": fmt.Sprintf("Sucursal %d", num),
		"business": gin.H{
			"name": user.Company, "type": user.BusinessType,
			"typeName": getTypeName(user.BusinessType), "size": user.BusinessSize,
			"description": "", "website": "", "email": "",
		},
		"phoneNumber": user.PhoneNumber,
		"schedule": gin.H{
			"monday": defaultDay, "tuesday": defaultDay, "wednesday": defaultDay,
			"thursday": defaultDay, "friday": defaultDay, "saturday": defaultDay,
			"sunday": gin.H{"isOpen": false, "open": "09:00", "close": "20:00"},
		},
		"holidays": []gin.H{}, "services": []gin.H{}, "workers": []gin.H{},
		"location": gin.H{
			"address": "", "betweenStreets": "", "number": "", "neighborhood": "",
			"city": "", "state": "", "country": "", "postalCode": "",
		},
		"social": gin.H{"facebook": "", "instagram": "", "twitter": "", "linkedin": ""},
	}
}

func dayToFrontend(day models.DaySchedule) gin.H {
	return gin.H{"isOpen": day.Open, "open": day.Start, "close": day.End}
}

func parseDate(date string) (month, day string) {
	parts := strings.Split(date, "-")
	if len(parts) == 3 {
		return parts[1], parts[2]
	}
	return "01", "01"
}

func getTypeName(code string) string {
	types := map[string]string{
		"clinica-dental": "Clínica Dental", "peluqueria": "Peluquería / Salón de Belleza",
		"restaurante": "Restaurante", "pizzeria": "Pizzería",
		"panaderia": "Panadería / Repostería", "libreria": "Librería", "pescaderia": "Pescadería / Marisquería",
		"ensaladas": "Ensaladas",
	}
	if name, ok := types[code]; ok {
		return name
	}
	return code
}

// ============================================================
// Structs de request
// ============================================================

type BranchRequest struct {
	BranchID    uint          `json:"branchId"`
	PhoneNumber string        `json:"phoneNumber"`
	Business    BusinessInfo  `json:"business"`
	Schedule    ScheduleInfo  `json:"schedule"`
	Holidays    []HolidayInfo `json:"holidays"`
	Location    LocationInfo  `json:"location"`
	Social      SocialInfo    `json:"social"`
	Services    []ServiceInfo `json:"services"`
	Workers     []WorkerInfo  `json:"workers"`
}

type ProfileRequest struct {
	Business BusinessInfo  `json:"business"`
	Schedule ScheduleInfo  `json:"schedule"`
	Holidays []HolidayInfo `json:"holidays"`
	Location LocationInfo  `json:"location"`
	Social   SocialInfo    `json:"social"`
}

type BusinessInfo struct {
	Name        string `json:"name"`
	Type        string `json:"type"`
	Description string `json:"description"`
	Website     string `json:"website"`
	Email       string `json:"email"`
	LogoURL     string `json:"logoUrl"`
	BannerURL   string `json:"bannerUrl"`
	MenuURL     string `json:"menuUrl"`
}

type ScheduleInfo struct {
	Monday    DayScheduleInfo `json:"monday"`
	Tuesday   DayScheduleInfo `json:"tuesday"`
	Wednesday DayScheduleInfo `json:"wednesday"`
	Thursday  DayScheduleInfo `json:"thursday"`
	Friday    DayScheduleInfo `json:"friday"`
	Saturday  DayScheduleInfo `json:"saturday"`
	Sunday    DayScheduleInfo `json:"sunday"`
}

type DayScheduleInfo struct {
	IsOpen bool   `json:"isOpen"`
	Open   string `json:"open"`
	Close  string `json:"close"`
}

type HolidayInfo struct {
	Month string `json:"month"`
	Day   string `json:"day"`
	Name  string `json:"name"`
	Date  string `json:"date"`
}

type LocationInfo struct {
	Address        string `json:"address"`
	BetweenStreets string `json:"betweenStreets"`
	Number         string `json:"number"`
	Neighborhood   string `json:"neighborhood"`
	City           string `json:"city"`
	State          string `json:"state"`
	Country        string `json:"country"`
	PostalCode     string `json:"postalCode"`
}

type SocialInfo struct {
	Facebook  string `json:"facebook"`
	Instagram string `json:"instagram"`
	Twitter   string `json:"twitter"`
	LinkedIn  string `json:"linkedin"`
}

// ServiceInfo — incluye imageUrl y campos de periodo de promoción
type ServiceInfo struct {
	Title           string   `json:"title"`
	Description     string   `json:"description"`
	PriceType       string   `json:"priceType"`
	Price           float64  `json:"price"`
	OriginalPrice   float64  `json:"originalPrice"`
	PromoPrice      float64  `json:"promoPrice"`
	ImageURL        string   `json:"imageUrl"`
	ImageUrls       []string `json:"imageUrls"`
	PromoPeriodType string   `json:"promoPeriodType"` // "days" | "range" | ""
	PromoDays       []string `json:"promoDays"`       // ["lunes","martes",...]
	PromoDateStart  string   `json:"promoDateStart"`  // "2025-01-15"
	PromoDateEnd    string   `json:"promoDateEnd"`    // "2025-02-28"
	InStock         bool     `json:"inStock"`
	StockQty        *int     `json:"stockQty"`
}

type WorkerInfo struct {
	Name      string   `json:"name"`
	StartTime string   `json:"startTime"`
	EndTime   string   `json:"endTime"`
	Days      []string `json:"days"`
}

// Para evitar "declared but not used"
var _ = strconv.Itoa
