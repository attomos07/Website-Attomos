package handlers

import (
	"log"
	"strings"

	"attomos/config"
	"attomos/models"
)

// syncOnboardingToAgency sincroniza los datos del onboarding hacia my_agency_info.
// Se llama en goroutine desde CreateAgent cuando businessType contiene "gubernamental".
// Equivalente gubernamental de syncOnboardingToBranch.
func syncOnboardingToAgency(userID, branchID uint, cfg models.AgentConfig) {
	var office models.MyAgencyInfo
	if err := config.DB.Where("id = ? AND user_id = ?", branchID, userID).
		First(&office).Error; err != nil {
		log.Printf("⚠️  [SyncAgency] Oficina %d no encontrada para user %d: %v", branchID, userID, err)
		return
	}

	updated := false

	// Cursos — los servicios del onboarding se mapean como AgencyCursos
	if len(cfg.Services) > 0 {
		cursos := make(models.AgencyCursos, 0, len(cfg.Services))
		for _, s := range cfg.Services {
			if s.Title == "" {
				continue
			}
			cursos = append(cursos, models.AgencyCurso{
				Title:       s.Title,
				Description: s.Description,
				Disponible:  true,
				Modalidad:   "presencial",
				ImageUrls:   s.ImageUrls,
			})
		}
		if len(cursos) > 0 {
			office.Cursos = cursos
			updated = true
			log.Printf("✅ [SyncAgency] %d curso(s) sincronizados → oficina %d", len(cursos), branchID)
		}
	}

	// Días inhábiles
	if len(cfg.Holidays) > 0 {
		holidays := make(models.BusinessHolidays, 0, len(cfg.Holidays))
		for _, h := range cfg.Holidays {
			holidays = append(holidays, models.Holiday{Date: h.Date, Name: h.Name})
		}
		office.Holidays = holidays
		updated = true
		log.Printf("✅ [SyncAgency] %d día(s) inhábil(es) sincronizados → oficina %d", len(holidays), branchID)
	}

	// Horario
	if cfg.Schedule.Monday.Start != "" {
		office.Schedule = models.BusinessSchedule{
			Monday:    models.DaySchedule{Open: cfg.Schedule.Monday.Open, Start: cfg.Schedule.Monday.Start, End: cfg.Schedule.Monday.End},
			Tuesday:   models.DaySchedule{Open: cfg.Schedule.Tuesday.Open, Start: cfg.Schedule.Tuesday.Start, End: cfg.Schedule.Tuesday.End},
			Wednesday: models.DaySchedule{Open: cfg.Schedule.Wednesday.Open, Start: cfg.Schedule.Wednesday.Start, End: cfg.Schedule.Wednesday.End},
			Thursday:  models.DaySchedule{Open: cfg.Schedule.Thursday.Open, Start: cfg.Schedule.Thursday.Start, End: cfg.Schedule.Thursday.End},
			Friday:    models.DaySchedule{Open: cfg.Schedule.Friday.Open, Start: cfg.Schedule.Friday.Start, End: cfg.Schedule.Friday.End},
			Saturday:  models.DaySchedule{Open: cfg.Schedule.Saturday.Open, Start: cfg.Schedule.Saturday.Start, End: cfg.Schedule.Saturday.End},
			Sunday:    models.DaySchedule{Open: cfg.Schedule.Sunday.Open, Start: cfg.Schedule.Sunday.Start, End: cfg.Schedule.Sunday.End},
			Timezone:  "America/Hermosillo",
		}
		updated = true
		log.Printf("✅ [SyncAgency] Horario sincronizado → oficina %d", branchID)
	}

	// Info del agente (descripción, web, email) si vienen en el onboarding
	if cfg.BusinessInfo.Description != "" && office.Description == "" {
		office.Description = cfg.BusinessInfo.Description
		updated = true
	}
	if cfg.BusinessInfo.Email != "" && office.Email == "" {
		office.Email = cfg.BusinessInfo.Email
		updated = true
	}
	if cfg.BusinessInfo.Website != "" && office.Website == "" {
		office.Website = cfg.BusinessInfo.Website
		updated = true
	}

	// Ubicación
	if cfg.Location.Address != "" && office.Location.Address == "" {
		office.Location = models.AgencyLocation{
			Address: cfg.Location.Address,
			City:    cfg.Location.City,
			State:   cfg.Location.State,
		}
		updated = true
		log.Printf("✅ [SyncAgency] Ubicación sincronizada → oficina %d", branchID)
	}

	// Redes sociales
	if cfg.SocialMedia.Facebook != "" || cfg.SocialMedia.Instagram != "" {
		office.SocialMedia = models.AgencySocialMedia{
			Facebook:  cfg.SocialMedia.Facebook,
			Instagram: cfg.SocialMedia.Instagram,
			Twitter:   cfg.SocialMedia.Twitter,
			LinkedIn:  cfg.SocialMedia.LinkedIn,
		}
		updated = true
		log.Printf("✅ [SyncAgency] Redes sociales sincronizadas → oficina %d", branchID)
	}

	if updated {
		if err := config.DB.Save(&office).Error; err != nil {
			log.Printf("❌ [SyncAgency] Error guardando oficina %d: %v", branchID, err)
		} else {
			log.Printf("✅ [SyncAgency] Oficina %d actualizada exitosamente", branchID)
		}
	}
}

// isGovBusinessType retorna true si el businessType es gubernamental.
func isGovBusinessType(businessType string) bool {
	return strings.Contains(strings.ToLower(businessType), "gubernamental")
}
