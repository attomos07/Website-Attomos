package services

// bot_config.go — genera el BusinessConfig que el bot necesita para
// responder (negocio, horario, servicios, ubicación, etc.) como función pura
// (sin SSH/SFTP), para que la pueda usar tanto:
//   - el endpoint GET /api/bot/business-config/:agent_id (bot consultando
//     bajo demanda — ver handlers/bot_business_config.go)
//   - el deploy inicial en atomic_bot_deploy.go, que ya NO escribe
//     business_config.json al servidor: el bot lo consulta él mismo al
//     arrancar (src.StartBusinessConfigPolling) y se refresca solo.
//
// Antes esto vivía como método (s *AtomicBotDeployService) generateBusinessConfig
// en atomic_bot_deploy.go junto con sus helpers convert*; se movió aquí tal
// cual (misma lógica, sin cambios de comportamiento) porque ya no necesita
// nada del servicio SSH/SFTP.

import (
	"attomos/models"
	"fmt"
)

// BusinessConfig estructura que consume el bot (idéntica al struct
// BusinessConfig que ya existe en config.go del bot — mismo JSON).
type BusinessConfig struct {
	AgentName    string `json:"agentName"`
	BusinessType string `json:"businessType"`
	PhoneNumber  string `json:"phoneNumber"`
	Website      string `json:"website,omitempty"`
	Email        string `json:"email,omitempty"`
	Description  string `json:"description,omitempty"`
	// URLs de imágenes y menú — strings, ya sea que vivan en disco local,
	// en un bucket de Railway o donde sea; el bot solo consume la URL.
	MenuUrl     string      `json:"menuUrl,omitempty"`
	LogoUrl     string      `json:"logoUrl,omitempty"`
	BannerUrl   string      `json:"bannerUrl,omitempty"`
	Personality Personality `json:"personality"`
	Schedule    Schedule    `json:"schedule"`
	Holidays    []Holiday   `json:"holidays"`
	Services    []Service   `json:"services"`
	Workers     []Worker    `json:"workers"`
	Location    Location    `json:"location"`
	SocialMedia SocialMedia `json:"socialMedia"`
}

type Personality struct {
	Tone                string   `json:"tone"`
	CustomTone          string   `json:"customTone,omitempty"`
	AdditionalLanguages []string `json:"additionalLanguages"`
}

type Schedule struct {
	Monday    DaySchedule `json:"monday"`
	Tuesday   DaySchedule `json:"tuesday"`
	Wednesday DaySchedule `json:"wednesday"`
	Thursday  DaySchedule `json:"thursday"`
	Friday    DaySchedule `json:"friday"`
	Saturday  DaySchedule `json:"saturday"`
	Sunday    DaySchedule `json:"sunday"`
	Timezone  string      `json:"timezone"`
}

type DaySchedule struct {
	Open  bool   `json:"open"`
	Start string `json:"start"`
	End   string `json:"end"`
}

type Holiday struct {
	Date string `json:"date"`
	Name string `json:"name"`
}

type Service struct {
	Title           string   `json:"title"`
	Description     string   `json:"description"`
	ImageUrls       []string `json:"imageUrls,omitempty"`
	PriceType       string   `json:"priceType"`
	Price           float64  `json:"price,omitempty"`
	OriginalPrice   float64  `json:"originalPrice,omitempty"`
	PromoPrice      float64  `json:"promoPrice,omitempty"`
	PromoPeriodType string   `json:"promoPeriodType,omitempty"`
	PromoDays       []string `json:"promoDays,omitempty"`
	PromoDateStart  string   `json:"promoDateStart,omitempty"`
	PromoDateEnd    string   `json:"promoDateEnd,omitempty"`
	InStock         bool     `json:"inStock"`
}

type Worker struct {
	Name      string   `json:"name"`
	StartTime string   `json:"startTime"`
	EndTime   string   `json:"endTime"`
	Days      []string `json:"days"`
}

type Location struct {
	Address        string `json:"address"`
	Number         string `json:"number"`
	Neighborhood   string `json:"neighborhood"`
	City           string `json:"city"`
	State          string `json:"state"`
	Country        string `json:"country"`
	PostalCode     string `json:"postalCode"`
	BetweenStreets string `json:"betweenStreets"`
}

type SocialMedia struct {
	Facebook  string `json:"facebook"`
	Instagram string `json:"instagram"`
	Twitter   string `json:"twitter"`
	LinkedIn  string `json:"linkedin"`
}

// GenerateBusinessConfig arma el BusinessConfig para un agente a partir de
// su Config legacy y, si hay sucursal vinculada, de MyBusinessInfo como
// fuente de verdad (mismo criterio que ya existía: branch pisa a agent.Config
// campo por campo cuando branch != nil y el campo no está vacío).
func GenerateBusinessConfig(agent *models.Agent, branch *models.MyBusinessInfo) *BusinessConfig {
	config := &BusinessConfig{
		AgentName:    agent.Name,
		BusinessType: agent.BusinessType,
		PhoneNumber:  agent.PhoneNumber,
		Personality: Personality{
			Tone:                agent.Config.Tone,
			CustomTone:          agent.Config.CustomTone,
			AdditionalLanguages: agent.Config.AdditionalLanguages,
		},
		// Fallback: datos legacy del AgentConfig
		Schedule: Schedule{
			Monday:    convertDaySchedule(agent.Config.Schedule.Monday),
			Tuesday:   convertDaySchedule(agent.Config.Schedule.Tuesday),
			Wednesday: convertDaySchedule(agent.Config.Schedule.Wednesday),
			Thursday:  convertDaySchedule(agent.Config.Schedule.Thursday),
			Friday:    convertDaySchedule(agent.Config.Schedule.Friday),
			Saturday:  convertDaySchedule(agent.Config.Schedule.Saturday),
			Sunday:    convertDaySchedule(agent.Config.Schedule.Sunday),
			Timezone:  agent.Config.Schedule.Timezone,
		},
		Holidays:    convertHolidays(agent.Config.Holidays),
		Services:    convertServices(agent.Config.Services),
		Workers:     convertWorkers(agent.Config.Workers),
		Location:    Location{},
		SocialMedia: SocialMedia{},
	}

	// Si hay sucursal vinculada, usar MyBusinessInfo como fuente de verdad
	if branch != nil {
		if branch.BusinessName != "" {
			config.AgentName = branch.BusinessName
		}
		if branch.BusinessType != "" {
			config.BusinessType = branch.BusinessType
		}
		if branch.PhoneNumber != "" {
			config.PhoneNumber = branch.PhoneNumber
		}
		config.Website = branch.Website
		config.Email = branch.Email
		config.Description = branch.Description
		// URLs de imágenes y menú (bucket de Railway o el storage que sea —
		// aquí solo se propaga la URL, el bot nunca toca el binario)
		config.MenuUrl = branch.MenuURL
		config.LogoUrl = branch.LogoURL
		config.BannerUrl = branch.BannerURL

		config.Location = Location{
			Address:        branch.Location.Address,
			Number:         branch.Location.Number,
			Neighborhood:   branch.Location.Neighborhood,
			City:           branch.Location.City,
			State:          branch.Location.State,
			Country:        branch.Location.Country,
			PostalCode:     branch.Location.PostalCode,
			BetweenStreets: branch.Location.BetweenStreets,
		}
		config.SocialMedia = SocialMedia{
			Facebook:  branch.SocialMedia.Facebook,
			Instagram: branch.SocialMedia.Instagram,
			Twitter:   branch.SocialMedia.Twitter,
			LinkedIn:  branch.SocialMedia.LinkedIn,
		}
		config.Schedule = Schedule{
			Monday:    convertDaySchedule2(branch.Schedule.Monday),
			Tuesday:   convertDaySchedule2(branch.Schedule.Tuesday),
			Wednesday: convertDaySchedule2(branch.Schedule.Wednesday),
			Thursday:  convertDaySchedule2(branch.Schedule.Thursday),
			Friday:    convertDaySchedule2(branch.Schedule.Friday),
			Saturday:  convertDaySchedule2(branch.Schedule.Saturday),
			Sunday:    convertDaySchedule2(branch.Schedule.Sunday),
			Timezone:  branch.Schedule.Timezone,
		}
		config.Holidays = convertBranchHolidays(branch.Holidays)
		config.Services = convertBranchServices(branch.Services)
		config.Workers = convertBranchWorkers(branch.Workers)
	}

	return config
}

// ── Helpers de conversión (idénticos a los que ya existían) ────────────────

func convertDaySchedule2(day models.DaySchedule) DaySchedule {
	return DaySchedule{Open: day.Open, Start: day.Start, End: day.End}
}

func convertBranchHolidays(holidays models.BusinessHolidays) []Holiday {
	result := make([]Holiday, len(holidays))
	for i, h := range holidays {
		result[i] = Holiday{Date: h.Date, Name: h.Name}
	}
	return result
}

func convertBranchServices(services models.BranchServices) []Service {
	result := make([]Service, len(services))
	for i, s := range services {
		result[i] = Service{
			Title:           s.Title,
			Description:     s.Description,
			ImageUrls:       s.ImageUrls,
			PriceType:       s.PriceType,
			Price:           s.Price,
			OriginalPrice:   s.OriginalPrice,
			PromoPrice:      s.PromoPrice,
			PromoPeriodType: s.PromoPeriodType,
			PromoDays:       s.PromoDays,
			PromoDateStart:  s.PromoDateStart,
			PromoDateEnd:    s.PromoDateEnd,
			InStock:         s.InStock,
		}
	}
	return result
}

func convertBranchWorkers(workers models.BranchWorkers) []Worker {
	result := make([]Worker, len(workers))
	for i, w := range workers {
		result[i] = Worker{Name: w.Name, StartTime: w.StartTime, EndTime: w.EndTime, Days: w.Days}
	}
	return result
}

func convertDaySchedule(day models.DaySchedule) DaySchedule {
	return DaySchedule{Open: day.Open, Start: day.Start, End: day.End}
}

func convertHolidays(holidays []models.Holiday) []Holiday {
	result := make([]Holiday, len(holidays))
	for i, h := range holidays {
		result[i] = Holiday{Date: h.Date, Name: h.Name}
	}
	return result
}

func convertServices(services []models.Service) []Service {
	result := make([]Service, len(services))
	for i, s := range services {
		service := Service{
			Title:       s.Title,
			Description: s.Description,
			PriceType:   s.PriceType,
		}
		if priceStr := s.Price.String(); priceStr != "" {
			var priceFloat float64
			if _, err := fmt.Sscanf(priceStr, "%f", &priceFloat); err == nil {
				service.Price = priceFloat
			}
		}
		if s.OriginalPrice != nil {
			if origPriceStr := s.OriginalPrice.String(); origPriceStr != "" {
				var origPriceFloat float64
				if _, err := fmt.Sscanf(origPriceStr, "%f", &origPriceFloat); err == nil {
					service.OriginalPrice = origPriceFloat
				}
			}
		}
		if s.PromoPrice != nil {
			if promoPriceStr := s.PromoPrice.String(); promoPriceStr != "" {
				var promoPriceFloat float64
				if _, err := fmt.Sscanf(promoPriceStr, "%f", &promoPriceFloat); err == nil {
					service.PromoPrice = promoPriceFloat
				}
			}
		}
		result[i] = service
	}
	return result
}

func convertWorkers(workers []models.Staff) []Worker {
	result := make([]Worker, len(workers))
	for i, w := range workers {
		result[i] = Worker{Name: w.Name, StartTime: w.StartTime, EndTime: w.EndTime, Days: w.Days}
	}
	return result
}
