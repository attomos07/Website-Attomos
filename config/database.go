package config

import (
	"fmt"
	"log"
	"net/url"
	"os"
	"strings"
	"time"

	"gorm.io/driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var DB *gorm.DB

func ConnectDatabase() {
	var dsn string

	// Intentar con MYSQL_PUBLIC_URL primero (Railway)
	publicURL := os.Getenv("MYSQL_PUBLIC_URL")

	if publicURL != "" {
		// Parsear la URL de MySQL
		parsedURL, err := url.Parse(publicURL)
		if err != nil {
			log.Fatal("Error al parsear MYSQL_PUBLIC_URL:", err)
		}

		// Extraer componentes
		password, _ := parsedURL.User.Password()
		username := parsedURL.User.Username()
		host := parsedURL.Hostname()
		port := parsedURL.Port()
		database := strings.TrimPrefix(parsedURL.Path, "/")

		// Construir DSN en el formato correcto
		dsn = fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?charset=utf8mb4&parseTime=True&loc=Local",
			username, password, host, port, database)
	} else {
		// Construcción manual (desarrollo local)
		host := os.Getenv("MYSQL_HOST")
		port := os.Getenv("MYSQL_PORT")
		database := os.Getenv("MYSQL_DATABASE")
		user := os.Getenv("MYSQL_USER")
		password := os.Getenv("MYSQL_PASSWORD")

		dsn = fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?charset=utf8mb4&parseTime=True&loc=Local",
			user, password, host, port, database)
	}

	// Logger: solo imprime queries lentas (> 50ms) y errores
	slowLogger := logger.New(
		log.New(os.Stdout, "\r\n[DB] ", log.LstdFlags),
		logger.Config{
			SlowThreshold:             50 * time.Millisecond,
			LogLevel:                  logger.Warn,
			IgnoreRecordNotFoundError: true,
			Colorful:                  true,
		},
	)

	// Conectar a la base de datos
	db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{
		Logger: slowLogger,
	})

	if err != nil {
		log.Fatal("Error al conectar con la base de datos:", err)
	}

	// ── Connection Pool ──────────────────────────────────────────────────────
	// Sin esto GORM abre una conexión nueva por cada query (~200ms en Railway)
	sqlDB, err := db.DB()
	if err != nil {
		log.Fatal("Error al obtener instancia sql.DB:", err)
	}

	sqlDB.SetMaxOpenConns(25)                 // máximo de conexiones abiertas simultáneas
	sqlDB.SetMaxIdleConns(10)                 // conexiones que se mantienen listas en el pool
	sqlDB.SetConnMaxLifetime(5 * time.Minute) // reutilizar conexión máximo 5 min
	sqlDB.SetConnMaxIdleTime(2 * time.Minute) // cerrar conexión idle después de 2 min

	DB = db
	log.Println("✅ Conexión exitosa con MySQL (pool: 10 idle / 25 max)")
}

func GetDB() *gorm.DB {
	return DB
}
