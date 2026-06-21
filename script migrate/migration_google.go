package main

import (
	"bufio"
	"fmt"
	"log"
	"os"
	"strings"

	"attomos/config"

	"github.com/joho/godotenv"
)

func main() {
	fmt.Println("🔄 Migración: Integración de Google Calendar y Sheets")
	fmt.Println("================================================\n")

	// Cargar variables de entorno
	if err := godotenv.Load(); err != nil {
		log.Println("⚠️  Advertencia: No se encontró archivo .env")
	}

	// Conectar a la base de datos
	fmt.Println("📡 Conectando a la base de datos...")
	config.ConnectDatabase()
	fmt.Println("✅ Conectado a la base de datos\n")

	fmt.Println("⚠️  IMPORTANTE:")
	fmt.Println("   - Esta migración agregará columnas para Google Calendar y Sheets")
	fmt.Println("   - Se agregarán campos: google_token, google_calendar_id, google_sheet_id")
	fmt.Println("   - Se agregarán campos: google_connected, google_connected_at")
	fmt.Println()
	fmt.Print("¿Continuar? (s/n): ")

	reader := bufio.NewReader(os.Stdin)
	confirmation, _ := reader.ReadString('\n')
	confirmation = strings.TrimSpace(strings.ToLower(confirmation))

	if confirmation != "s" && confirmation != "si" {
		fmt.Println("❌ Migración cancelada")
		return
	}

	fmt.Println()
	fmt.Println("📝 Ejecutando migración SQL...")

	// Función helper para verificar si una columna existe
	columnExists := func(columnName string) bool {
		var count int64
		config.DB.Raw("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'agents' AND COLUMN_NAME = ?", columnName).Scan(&count)
		return count > 0
	}

	// Función helper para verificar si un índice existe
	indexExists := func(indexName string) bool {
		var count int64
		config.DB.Raw("SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'agents' AND INDEX_NAME = ?", indexName).Scan(&count)
		return count > 0
	}

	// Agregar columnas solo si no existen
	type Migration struct {
		Name  string
		Query string
		Check func() bool
	}

	migrations := []Migration{
		{
			Name:  "google_token",
			Query: "ALTER TABLE agents ADD COLUMN google_token TEXT",
			Check: func() bool { return columnExists("google_token") },
		},
		{
			Name:  "google_calendar_id",
			Query: "ALTER TABLE agents ADD COLUMN google_calendar_id VARCHAR(500)",
			Check: func() bool { return columnExists("google_calendar_id") },
		},
		{
			Name:  "google_sheet_id",
			Query: "ALTER TABLE agents ADD COLUMN google_sheet_id VARCHAR(500)",
			Check: func() bool { return columnExists("google_sheet_id") },
		},
		{
			Name:  "google_connected",
			Query: "ALTER TABLE agents ADD COLUMN google_connected BOOLEAN DEFAULT FALSE",
			Check: func() bool { return columnExists("google_connected") },
		},
		{
			Name:  "google_connected_at",
			Query: "ALTER TABLE agents ADD COLUMN google_connected_at TIMESTAMP NULL",
			Check: func() bool { return columnExists("google_connected_at") },
		},
		{
			Name:  "idx_agents_google_connected",
			Query: "CREATE INDEX idx_agents_google_connected ON agents(google_connected)",
			Check: func() bool { return indexExists("idx_agents_google_connected") },
		},
		{
			Name:  "idx_agents_google_calendar_id",
			Query: "CREATE INDEX idx_agents_google_calendar_id ON agents(google_calendar_id)",
			Check: func() bool { return indexExists("idx_agents_google_calendar_id") },
		},
		{
			Name:  "idx_agents_google_sheet_id",
			Query: "CREATE INDEX idx_agents_google_sheet_id ON agents(google_sheet_id)",
			Check: func() bool { return indexExists("idx_agents_google_sheet_id") },
		},
	}

	for _, migration := range migrations {
		if migration.Check() {
			fmt.Printf("   ⏭️  Saltando: %s (ya existe)\n", migration.Name)
			continue
		}

		fmt.Printf("   → Ejecutando: %s\n", migration.Query)
		if err := config.DB.Exec(migration.Query).Error; err != nil {
			log.Printf("❌ Error en %s: %v\n", migration.Name, err)
		} else {
			fmt.Printf("   ✅ %s agregado\n", migration.Name)
		}
	}

	fmt.Println()
	fmt.Println("   ✅ Estructura actualizada\n")

	// Verificar resultados
	fmt.Println("🔍 Verificando migración...")

	type TableColumn struct {
		Field   string
		Type    string
		Null    string
		Key     string
		Default *string
		Extra   string
	}

	var agentColumns []TableColumn
	config.DB.Raw("DESCRIBE agents").Scan(&agentColumns)

	// Verificar columnas nuevas
	requiredColumns := []string{
		"google_token",
		"google_calendar_id",
		"google_sheet_id",
		"google_connected",
		"google_connected_at",
	}

	allPresent := true
	for _, reqCol := range requiredColumns {
		found := false
		for _, col := range agentColumns {
			if col.Field == reqCol {
				found = true
				fmt.Printf("   ✓ %s presente\n", reqCol)
				break
			}
		}
		if !found {
			fmt.Printf("   ✗ %s NO ENCONTRADA\n", reqCol)
			allPresent = false
		}
	}

	fmt.Println()

	if allPresent {
		fmt.Println("✅ Todas las columnas nuevas verificadas")
	} else {
		fmt.Println("⚠️  Algunas columnas pueden no haberse creado correctamente")
		fmt.Println("💡 Esto puede deberse a permisos de la base de datos o conflictos")
	}

	fmt.Println()
	fmt.Println("🎉 Migración completada!")
	fmt.Println()
	fmt.Println("📋 Próximos pasos:")
	fmt.Println("   1. Configura las credenciales de Google OAuth en .env:")
	fmt.Println("      - GOOGLE_CLIENT_ID")
	fmt.Println("      - GOOGLE_CLIENT_SECRET")
	fmt.Println("      - GOOGLE_REDIRECT_URL")
	fmt.Println("   2. Habilita Google Calendar API y Google Sheets API en Google Cloud Console")
	fmt.Println("   3. Reinicia tu aplicación: go run main.go")
	fmt.Println("   4. Visita: http://localhost:8080/test-google")
	fmt.Println("   5. Los usuarios podrán conectar Google Calendar y Sheets desde el dashboard")
}
