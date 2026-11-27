package models

import "time"

// ============================================
// BLOG (attomos.com/blog)
// Los artículos se escriben desde el panel admin (/admin/blog).
// ============================================

// BlogCategory — categoría del blog (IA, Automatización, ...).
type BlogCategory struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Name      string    `gorm:"size:100;not null" json:"name"`
	Slug      string    `gorm:"size:100;uniqueIndex;not null" json:"slug"`
	Icon      string    `gorm:"size:60" json:"icon"` // clase de LineIcons, ej. "lni-brain"
	SortOrder int       `gorm:"default:0" json:"sortOrder"`
	CreatedAt time.Time `json:"createdAt"`
}

func (BlogCategory) TableName() string { return "blog_categories" }

// BlogTag — etiqueta libre de un artículo.
type BlogTag struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Name      string    `gorm:"size:100;not null" json:"name"`
	Slug      string    `gorm:"size:100;uniqueIndex;not null" json:"slug"`
	CreatedAt time.Time `json:"createdAt"`
}

func (BlogTag) TableName() string { return "blog_tags" }

// BlogPost — artículo del blog.
//
// Status: "borrador" | "publicado". Un artículo "publicado" con
// PublishedAt en el futuro está programado: aparece solo cuando llega
// la fecha.
type BlogPost struct {
	ID              uint          `gorm:"primaryKey" json:"id"`
	Slug            string        `gorm:"size:160;uniqueIndex;not null" json:"slug"`
	Title           string        `gorm:"size:255;not null" json:"title"`
	Excerpt         string        `gorm:"type:text" json:"excerpt"`
	Content         string        `gorm:"type:longtext" json:"content"` // HTML del editor del admin
	CoverKey        string        `gorm:"size:255" json:"coverKey"`     // archivo en el bucket (blog/<key>)
	CoverURL        string        `gorm:"size:600" json:"coverUrl"`     // portada externa (artículos iniciales)
	CoverAlt        string        `gorm:"size:255" json:"coverAlt"`
	CategoryID      *uint         `gorm:"index" json:"categoryId"`
	Category        *BlogCategory `gorm:"foreignKey:CategoryID" json:"category,omitempty"`
	Tags            []BlogTag     `gorm:"many2many:blog_post_tags;" json:"tags"`
	Author          string        `gorm:"size:120" json:"author"`
	AuthorRole      string        `gorm:"size:120" json:"authorRole"`
	Status          string        `gorm:"size:20;index;default:borrador" json:"status"`
	Featured        bool          `gorm:"default:false" json:"featured"`
	PublishedAt     time.Time     `gorm:"index" json:"publishedAt"`
	MetaDescription string        `gorm:"size:300" json:"metaDescription"`
	Views           int           `gorm:"default:0" json:"views"`
	CreatedAt       time.Time     `json:"createdAt"`
	UpdatedAt       time.Time     `json:"updatedAt"`
}

func (BlogPost) TableName() string { return "blog_posts" }

// CoverSrc — URL de la portada para <img>.
func (p *BlogPost) CoverSrc() string {
	if p.CoverKey != "" {
		return "/media/blog/" + p.CoverKey
	}
	return p.CoverURL
}

// DisplayStatus — borrador | programado | publicado.
func (p *BlogPost) DisplayStatus() string {
	if p.Status != "publicado" {
		return "borrador"
	}
	if time.Now().Before(p.PublishedAt) {
		return "programado"
	}
	return "publicado"
}
