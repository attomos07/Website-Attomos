package handlers

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"attomos/config"
	"attomos/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ============================================================
// GetMyAgency — lista todas las oficinas del usuario
// ============================================================

func GetMyAgency(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}
	user := userInterface.(*models.User)

	var offices []models.MyAgencyInfo
	if err := config.DB.Where("user_id = ?", user.ID).
		Order("office_number asc").Find(&offices).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al obtener oficinas"})
		return
	}

	if len(offices) == 0 {
		c.JSON(http.StatusOK, gin.H{
			"offices":       []gin.H{},
			"activeBranch":  nil,
			"defaultBranch": buildEmptyOfficeResponse(user, 1),
		})
		return
	}

	officeList := make([]gin.H, len(offices))
	for i, o := range offices {
		officeList[i] = gin.H{
			"id":           o.ID,
			"officeNumber": o.OfficeNumber,
			"officeName":   o.OfficeName,
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"offices":      officeList,
		"activeBranch": buildOfficeResponse(&offices[0]),
	})
}

// ============================================================
// GetAgencyOffice — obtiene una oficina específica por ID
// ============================================================

func GetAgencyOffice(c *gin.Context) {
	officeID := c.Param("id")
	userInterface, _ := c.Get("user")
	user := userInterface.(*models.User)

	var office models.MyAgencyInfo
	if err := config.DB.Where("id = ? AND user_id = ?", officeID, user.ID).
		First(&office).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Oficina no encontrada"})
		return
	}

	c.JSON(http.StatusOK, buildOfficeResponse(&office))
}

// ============================================================
// SaveMyAgency — guarda/actualiza una oficina
// ============================================================

func SaveMyAgency(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}
	user := userInterface.(*models.User)

	var req AgencyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos inválidos: " + err.Error()})
		return
	}

	var office models.MyAgencyInfo

	if req.BranchID > 0 {
		if err := config.DB.Where("id = ? AND user_id = ?", req.BranchID, user.ID).
			First(&office).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Oficina no encontrada"})
			return
		}
	} else {
		err := config.DB.Where("user_id = ?", user.ID).
			Order("office_number asc").First(&office).Error
		if err == gorm.ErrRecordNotFound {
			var maxNum int
			config.DB.Model(&models.MyAgencyInfo{}).
				Where("user_id = ?", user.ID).
				Select("COALESCE(MAX(office_number), 0)").Scan(&maxNum)
			office = models.MyAgencyInfo{
				UserID:       user.ID,
				OfficeNumber: maxNum + 1,
			}
		} else if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al buscar oficina"})
			return
		}
	}

	mapRequestToOffice(&office, req)
	office.UpdateOfficeName()

	if office.ID == 0 {
		if err := config.DB.Create(&office).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al crear oficina: " + err.Error()})
			return
		}
	} else {
		if err := config.DB.Save(&office).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al guardar oficina: " + err.Error()})
			return
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"success":    true,
		"message":    "Oficina guardada exitosamente",
		"branch":     buildOfficeResponse(&office),
		"officeName": office.OfficeName,
	})
}

// ============================================================
// CreateAgencyOffice — crea una nueva oficina/módulo
// ============================================================

func CreateAgencyOffice(c *gin.Context) {
	userInterface, exists := c.Get("user")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}
	user := userInterface.(*models.User)

	var count int64
	config.DB.Model(&models.MyAgencyInfo{}).Where("user_id = ?", user.ID).Count(&count)

	// Heredar nombre de la primera oficina
	var firstOffice models.MyAgencyInfo
	config.DB.Where("user_id = ?", user.ID).Order("office_number asc").First(&firstOffice)

	newOffice := models.MyAgencyInfo{
		UserID:       user.ID,
		OfficeNumber: int(count) + 1,
		OfficeName:   fmt.Sprintf("Oficina %d", count+1),
		DepName:      firstOffice.DepName,
		DepAcronym:   firstOffice.DepAcronym,
		GovLevel:     firstOffice.GovLevel,
		Schedule: models.BusinessSchedule{
			Monday:    models.DaySchedule{Open: true, Start: "08:00", End: "15:00"},
			Tuesday:   models.DaySchedule{Open: true, Start: "08:00", End: "15:00"},
			Wednesday: models.DaySchedule{Open: true, Start: "08:00", End: "15:00"},
			Thursday:  models.DaySchedule{Open: true, Start: "08:00", End: "15:00"},
			Friday:    models.DaySchedule{Open: true, Start: "08:00", End: "15:00"},
			Saturday:  models.DaySchedule{Open: false, Start: "08:00", End: "13:00"},
			Sunday:    models.DaySchedule{Open: false, Start: "08:00", End: "13:00"},
			Timezone:  "America/Hermosillo",
		},
	}

	if err := config.DB.Create(&newOffice).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al crear oficina"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"success": true,
		"message": "Oficina creada exitosamente",
		"branch":  buildOfficeResponse(&newOffice),
	})
}

// ============================================================
// DeleteAgencyOffice — elimina una oficina (no la principal)
// ============================================================

func DeleteAgencyOffice(c *gin.Context) {
	officeID := c.Param("id")
	userInterface, _ := c.Get("user")
	user := userInterface.(*models.User)

	var office models.MyAgencyInfo
	if err := config.DB.Where("id = ? AND user_id = ?", officeID, user.ID).
		First(&office).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Oficina no encontrada"})
		return
	}

	if office.OfficeNumber == 1 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No puedes eliminar la oficina principal"})
		return
	}

	if err := config.DB.Delete(&office).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al eliminar oficina"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "message": "Oficina eliminada"})
}

// ============================================================
// Helpers
// ============================================================

// mapRequestToOffice aplica los datos del request al modelo.
func mapRequestToOffice(office *models.MyAgencyInfo, req AgencyRequest) {
	office.DepName = req.DepName
	office.DepAcronym = req.DepAcronym
	office.DepArea = req.DepArea
	office.DepParent = req.DepParent
	office.GovLevel = req.GovLevel
	office.RFC = req.RFC
	office.Description = req.Description
	office.Website = req.Website
	office.Email = req.Email
	office.PhoneNumber = req.PhoneNumber

	if req.BannerURL != "" {
		office.BannerURL = req.BannerURL
	}
	if req.LogoURL != "" {
		office.LogoURL = req.LogoURL
	}

	office.Location = models.AgencyLocation{
		Address:  req.Address,
		City:     req.City,
		State:    req.State,
		Country:  req.Country,
		MapsLink: req.MapsLink,
	}

	office.SocialMedia = models.AgencySocialMedia{
		Facebook:  req.Facebook,
		Instagram: req.Instagram,
		Twitter:   req.Twitter,
		YouTube:   req.YouTube,
		LinkedIn:  req.LinkedIn,
	}

	// Schedule: el JS envía un array [{day, open, start, end}]
	office.Schedule = mapAgencySchedule(req.Schedule)

	// Días inhábiles
	holidays := make(models.BusinessHolidays, 0, len(req.Holidays))
	for _, h := range req.Holidays {
		if h.Day == "" {
			continue
		}
		year := time.Now().Year()
		holidays = append(holidays, models.Holiday{
			Date: fmt.Sprintf("%d-%s-%s", year, h.Month, h.Day),
			Name: h.Description,
		})
	}
	office.Holidays = holidays

	// Cursos
	cursos := make(models.AgencyCursos, 0, len(req.Cursos))
	for _, cur := range req.Cursos {
		if cur.Title == "" {
			continue
		}
		imgs := cur.ImageUrls
		if imgs == nil {
			imgs = []string{}
		}
		cursos = append(cursos, models.AgencyCurso{
			Title:       cur.Title,
			Description: cur.Description,
			Disponible:  cur.Disponible,
			Cupos:       cur.Cupos,
			Modalidad:   cur.Modalidad,
			FechaInicio: cur.FechaInicio,
			FechaFin:    cur.FechaFin,
			ImageUrls:   imgs,
		})
	}
	office.Cursos = cursos
}

// mapAgencySchedule convierte el array del frontend al struct BusinessSchedule.
func mapAgencySchedule(items []AgencyScheduleItem) models.BusinessSchedule {
	sched := models.BusinessSchedule{
		Timezone:  "America/Hermosillo",
		Monday:    models.DaySchedule{Open: true, Start: "08:00", End: "15:00"},
		Tuesday:   models.DaySchedule{Open: true, Start: "08:00", End: "15:00"},
		Wednesday: models.DaySchedule{Open: true, Start: "08:00", End: "15:00"},
		Thursday:  models.DaySchedule{Open: true, Start: "08:00", End: "15:00"},
		Friday:    models.DaySchedule{Open: true, Start: "08:00", End: "15:00"},
		Saturday:  models.DaySchedule{Open: false, Start: "08:00", End: "13:00"},
		Sunday:    models.DaySchedule{Open: false, Start: "08:00", End: "13:00"},
	}
	for _, item := range items {
		day := models.DaySchedule{Open: item.Open, Start: item.Start, End: item.End}
		switch item.Day {
		case "monday":
			sched.Monday = day
		case "tuesday":
			sched.Tuesday = day
		case "wednesday":
			sched.Wednesday = day
		case "thursday":
			sched.Thursday = day
		case "friday":
			sched.Friday = day
		case "saturday":
			sched.Saturday = day
		case "sunday":
			sched.Sunday = day
		}
	}
	return sched
}

func buildOfficeResponse(o *models.MyAgencyInfo) gin.H {
	holidays := make([]gin.H, len(o.Holidays))
	for i, h := range o.Holidays {
		month, day := parseDate(h.Date)
		holidays[i] = gin.H{
			"month":       month,
			"day":         day,
			"description": h.Name,
			"date":        fmt.Sprintf("%s/%s", day, month),
		}
	}

	cursos := make([]gin.H, len(o.Cursos))
	for i, c := range o.Cursos {
		imgs := c.ImageUrls
		if imgs == nil {
			imgs = []string{}
		}
		cursos[i] = gin.H{
			"title":       c.Title,
			"description": c.Description,
			"disponible":  c.Disponible,
			"cupos":       c.Cupos,
			"modalidad":   c.Modalidad,
			"fechaInicio": c.FechaInicio,
			"fechaFin":    c.FechaFin,
			"imageUrls":   imgs,
		}
	}

	return gin.H{
		"id":           o.ID,
		"officeNumber": o.OfficeNumber,
		"officeName":   o.OfficeName,
		"name":         o.OfficeName, // alias para que el JS lo use en branchDropdownLabel
		// Datos institucionales
		"depName":     o.DepName,
		"depAcronym":  o.DepAcronym,
		"depArea":     o.DepArea,
		"depParent":   o.DepParent,
		"govLevel":    o.GovLevel,
		"rfc":         o.RFC,
		"description": o.Description,
		"website":     o.Website,
		"email":       o.Email,
		"phoneNumber": o.PhoneNumber,
		"bannerUrl":   o.BannerURL,
		"logoUrl":     o.LogoURL,
		// Ubicación
		"address":  o.Location.Address,
		"city":     o.Location.City,
		"state":    o.Location.State,
		"country":  o.Location.Country,
		"mapsLink": o.Location.MapsLink,
		// Redes sociales
		"facebook":  o.SocialMedia.Facebook,
		"instagram": o.SocialMedia.Instagram,
		"twitter":   o.SocialMedia.Twitter,
		"youtube":   o.SocialMedia.YouTube,
		"linkedin":  o.SocialMedia.LinkedIn,
		// Horario
		"schedule": gin.H{
			"monday":    dayToFrontend(o.Schedule.Monday),
			"tuesday":   dayToFrontend(o.Schedule.Tuesday),
			"wednesday": dayToFrontend(o.Schedule.Wednesday),
			"thursday":  dayToFrontend(o.Schedule.Thursday),
			"friday":    dayToFrontend(o.Schedule.Friday),
			"saturday":  dayToFrontend(o.Schedule.Saturday),
			"sunday":    dayToFrontend(o.Schedule.Sunday),
		},
		"holidays": holidays,
		"cursos":   cursos,
	}
}

func buildEmptyOfficeResponse(user *models.User, num int) gin.H {
	defaultDay := gin.H{"isOpen": true, "open": "08:00", "close": "15:00"}
	defaultDayClosed := gin.H{"isOpen": false, "open": "08:00", "close": "13:00"}
	return gin.H{
		"id": 0, "officeNumber": num,
		"officeName": fmt.Sprintf("Oficina %d", num), "name": fmt.Sprintf("Oficina %d", num),
		"depName": "", "depAcronym": "", "depArea": "", "depParent": "",
		"govLevel": "", "rfc": "", "description": "", "website": "",
		"email": user.Email, "phoneNumber": user.PhoneNumber,
		"bannerUrl": "", "logoUrl": "",
		"address": "", "city": "", "state": "", "country": "", "mapsLink": "",
		"facebook": "", "instagram": "", "twitter": "", "youtube": "", "linkedin": "",
		"schedule": gin.H{
			"monday": defaultDay, "tuesday": defaultDay, "wednesday": defaultDay,
			"thursday": defaultDay, "friday": defaultDay,
			"saturday": defaultDayClosed, "sunday": defaultDayClosed,
		},
		"holidays": []gin.H{},
		"cursos":   []gin.H{},
	}
}

// ============================================================
// Structs de request
// ============================================================

type AgencyRequest struct {
	BranchID    uint   `json:"branchId"`
	DepName     string `json:"depName"`
	DepAcronym  string `json:"depAcronym"`
	DepArea     string `json:"depArea"`
	DepParent   string `json:"depParent"`
	GovLevel    string `json:"govLevel"`
	RFC         string `json:"rfc"`
	Description string `json:"description"`
	Website     string `json:"website"`
	Email       string `json:"email"`
	PhoneNumber string `json:"phoneNumber"`
	BannerURL   string `json:"bannerUrl"`
	LogoURL     string `json:"logoUrl"`
	// Ubicación (plana, sin struct anidado)
	Address  string `json:"address"`
	City     string `json:"city"`
	State    string `json:"state"`
	Country  string `json:"country"`
	MapsLink string `json:"mapsLink"`
	// Redes
	Facebook  string `json:"facebook"`
	Instagram string `json:"instagram"`
	Twitter   string `json:"twitter"`
	YouTube   string `json:"youtube"`
	LinkedIn  string `json:"linkedin"`
	// Colecciones
	Schedule []AgencyScheduleItem `json:"schedule"`
	Holidays []AgencyHolidayInfo  `json:"holidays"`
	Cursos   []CursoInfo          `json:"cursos"`
}

// AgencyScheduleItem — formato de array que envía el JS
type AgencyScheduleItem struct {
	Day   string `json:"day"` // "monday" | "tuesday" | ...
	Open  bool   `json:"open"`
	Start string `json:"start"` // "HH:MM"
	End   string `json:"end"`   // "HH:MM"
}

type AgencyHolidayInfo struct {
	Month       string `json:"month"`
	Day         string `json:"day"`
	Description string `json:"description"`
}

type CursoInfo struct {
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Disponible  bool     `json:"disponible"`
	Cupos       string   `json:"cupos"`
	Modalidad   string   `json:"modalidad"`
	FechaInicio string   `json:"fechaInicio"`
	FechaFin    string   `json:"fechaFin"`
	ImageUrls   []string `json:"imageUrls"`
}

// ============================================================
// BOT ENDPOINTS — usados por inscriptions.go del AtomicBot
// ============================================================

// GetAgencyConfigForBot — GET /api/bot/agency-config/:branchId
// Retorna la configuración completa de la dependencia para que el bot
// la cargue como AgencyConfig en memoria.
func GetAgencyConfigForBot(c *gin.Context) {
	branchID := c.Param("branchId")

	// Autenticar por BOT_API_TOKEN (header Authorization: Bearer <token>)
	botToken := c.GetHeader("Authorization")
	if botToken == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Token requerido"})
		return
	}

	var office models.MyAgencyInfo
	if err := config.DB.Where("id = ?", branchID).First(&office).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Oficina no encontrada"})
		return
	}

	// Construir AgencyConfig compatible con el struct del bot
	c.JSON(http.StatusOK, gin.H{
		"agentName":   office.DepAcronym,
		"depName":     office.DepName,
		"depAcronym":  office.DepAcronym,
		"depArea":     office.DepArea,
		"depParent":   office.DepParent,
		"govLevel":    office.GovLevel,
		"rfc":         office.RFC,
		"description": office.Description,
		"website":     office.Website,
		"email":       office.Email,
		"phoneNumber": office.PhoneNumber,
		"address":     office.Location.Address,
		"city":        office.Location.City,
		"state":       office.Location.State,
		"mapsLink":    office.Location.MapsLink,
		"socialMedia": gin.H{
			"facebook":  office.SocialMedia.Facebook,
			"instagram": office.SocialMedia.Instagram,
			"twitter":   office.SocialMedia.Twitter,
			"youtube":   office.SocialMedia.YouTube,
			"linkedin":  office.SocialMedia.LinkedIn,
		},
		"personality": gin.H{"tone": "formal"},
		"schedule": gin.H{
			"monday":    dayToFrontend(office.Schedule.Monday),
			"tuesday":   dayToFrontend(office.Schedule.Tuesday),
			"wednesday": dayToFrontend(office.Schedule.Wednesday),
			"thursday":  dayToFrontend(office.Schedule.Thursday),
			"friday":    dayToFrontend(office.Schedule.Friday),
			"saturday":  dayToFrontend(office.Schedule.Saturday),
			"sunday":    dayToFrontend(office.Schedule.Sunday),
		},
		"holidays": buildHolidaysForBot(office.Holidays),
		"cursos":   buildCursosForBot(office.Cursos),
		"sedes":    []gin.H{},
	})
}

// SaveInscription — POST /api/bot/inscriptions
// Guarda la inscripción de un ciudadano a un curso y decrementa el cupo.
func SaveInscription(c *gin.Context) {
	botToken := c.GetHeader("Authorization")
	if botToken == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Token requerido"})
		return
	}

	var req struct {
		AgentID   uint   `json:"agentId"`
		Nombre    string `json:"nombre"`
		Telefono  string `json:"telefono"`
		Email     string `json:"email"`
		Curso     string `json:"curso"`
		Sede      string `json:"sede"`
		Modalidad string `json:"modalidad"`
		Fecha     string `json:"fecha"`
		Estado    string `json:"estado"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos inválidos"})
		return
	}

	// Obtener userID del agente
	var agent models.Agent
	userID := uint(0)
	if err := config.DB.First(&agent, req.AgentID).Error; err == nil {
		userID = agent.UserID
	}

	inscription := models.AgencyInscription{
		AgentID:   req.AgentID,
		UserID:    userID,
		Nombre:    req.Nombre,
		Telefono:  req.Telefono,
		Email:     req.Email,
		Curso:     req.Curso,
		Sede:      req.Sede,
		Modalidad: req.Modalidad,
		Fecha:     req.Fecha,
		Estado:    req.Estado,
	}
	if inscription.Estado == "" {
		inscription.Estado = "confirmado"
	}

	if err := config.DB.Create(&inscription).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error guardando inscripción"})
		return
	}

	// Decrementar cupo en my_agency_info
	if req.Curso != "" && agent.BranchID > 0 {
		go decrementAgencyCupo(agent.BranchID, req.Curso)
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "Inscripción guardada",
		"id":      inscription.ID,
	})
}

// QuotaFilled — POST /api/bot/quota-filled
// Marca un curso como sin cupos en my_agency_info.
func QuotaFilled(c *gin.Context) {
	botToken := c.GetHeader("Authorization")
	if botToken == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Token requerido"})
		return
	}

	var req struct {
		Curso    string `json:"curso"`
		BranchID string `json:"branchId"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Curso == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos inválidos"})
		return
	}

	var office models.MyAgencyInfo
	if err := config.DB.Where("id = ?", req.BranchID).First(&office).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Oficina no encontrada"})
		return
	}

	updated := false
	for i := range office.Cursos {
		if strings.EqualFold(office.Cursos[i].Title, req.Curso) {
			office.Cursos[i].Disponible = false
			office.Cursos[i].Cupos = "0"
			updated = true
			break
		}
	}

	if updated {
		config.DB.Save(&office)
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "updated": updated})
}

// ── Helpers internos ──────────────────────────────────────────────────────

func decrementAgencyCupo(branchID uint, courseTitle string) {
	var office models.MyAgencyInfo
	if err := config.DB.First(&office, branchID).Error; err != nil {
		return
	}
	for i := range office.Cursos {
		if strings.EqualFold(office.Cursos[i].Title, courseTitle) {
			cupos := 0
			fmt.Sscanf(office.Cursos[i].Cupos, "%d", &cupos)
			if cupos > 0 {
				cupos--
				office.Cursos[i].Cupos = fmt.Sprintf("%d", cupos)
				if cupos == 0 {
					office.Cursos[i].Disponible = false
				}
			}
			config.DB.Save(&office)
			break
		}
	}
}

func buildHolidaysForBot(holidays models.BusinessHolidays) []gin.H {
	out := make([]gin.H, 0, len(holidays))
	for _, h := range holidays {
		out = append(out, gin.H{"date": h.Date, "name": h.Name})
	}
	return out
}

func buildCursosForBot(cursos models.AgencyCursos) []gin.H {
	out := make([]gin.H, 0, len(cursos))
	for _, c := range cursos {
		imgs := c.ImageUrls
		if imgs == nil {
			imgs = []string{}
		}
		out = append(out, gin.H{
			"title":       c.Title,
			"description": c.Description,
			"disponible":  c.Disponible,
			"cupos":       c.Cupos,
			"modalidad":   c.Modalidad,
			"fechaInicio": c.FechaInicio,
			"fechaFin":    c.FechaFin,
			"imageUrls":   imgs,
		})
	}
	return out
}
