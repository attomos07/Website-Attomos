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
	fmt.Println("🔄 Migración: Agregar Campos de Meta WhatsApp a Users")
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
	fmt.Println("   - Esta migración agregará campos de Meta WhatsApp a la tabla users")
	fmt.Println("   - Campos: meta_access_token, meta_waba_id, meta_phone_number_id, etc.")
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
		config.DB.Raw("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = ?", columnName).Scan(&count)
		return count > 0
	}

	// Función helper para verificar si un índice existe
	indexExists := func(indexName string) bool {
		var count int64
		config.DB.Raw("SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND INDEX_NAME = ?", indexName).Scan(&count)
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
			Name:  "meta_access_token",
			Query: "ALTER TABLE users ADD COLUMN meta_access_token TEXT",
			Check: func() bool { return columnExists("meta_access_token") },
		},
		{
			Name:  "meta_waba_id",
			Query: "ALTER TABLE users ADD COLUMN meta_waba_id VARCHAR(255)",
			Check: func() bool { return columnExists("meta_waba_id") },
		},
		{
			Name:  "meta_phone_number_id",
			Query: "ALTER TABLE users ADD COLUMN meta_phone_number_id VARCHAR(255)",
			Check: func() bool { return columnExists("meta_phone_number_id") },
		},
		{
			Name:  "meta_display_number",
			Query: "ALTER TABLE users ADD COLUMN meta_display_number VARCHAR(50)",
			Check: func() bool { return columnExists("meta_display_number") },
		},
		{
			Name:  "meta_verified_name",
			Query: "ALTER TABLE users ADD COLUMN meta_verified_name VARCHAR(255)",
			Check: func() bool { return columnExists("meta_verified_name") },
		},
		{
			Name:  "meta_connected",
			Query: "ALTER TABLE users ADD COLUMN meta_connected BOOLEAN DEFAULT FALSE",
			Check: func() bool { return columnExists("meta_connected") },
		},
		{
			Name:  "meta_connected_at",
			Query: "ALTER TABLE users ADD COLUMN meta_connected_at TIMESTAMP NULL",
			Check: func() bool { return columnExists("meta_connected_at") },
		},
		{
			Name:  "meta_token_expires_at",
			Query: "ALTER TABLE users ADD COLUMN meta_token_expires_at TIMESTAMP NULL",
			Check: func() bool { return columnExists("meta_token_expires_at") },
		},
		{
			Name:  "idx_users_meta_connected",
			Query: "CREATE INDEX idx_users_meta_connected ON users(meta_connected)",
			Check: func() bool { return indexExists("idx_users_meta_connected") },
		},
		{
			Name:  "idx_users_meta_phone_number_id",
			Query: "CREATE INDEX idx_users_meta_phone_number_id ON users(meta_phone_number_id)",
			Check: func() bool { return indexExists("idx_users_meta_phone_number_id") },
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

	var userColumns []TableColumn
	config.DB.Raw("DESCRIBE users").Scan(&userColumns)

	// Verificar columnas nuevas
	requiredColumns := []string{
		"meta_access_token",
		"meta_waba_id",
		"meta_phone_number_id",
		"meta_display_number",
		"meta_verified_name",
		"meta_connected",
		"meta_connected_at",
		"meta_token_expires_at",
	}

	allPresent := true
	for _, reqCol := range requiredColumns {
		found := false
		for _, col := range userColumns {
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
	fmt.Println("   1. Configura las credenciales de Meta en .env:")
	fmt.Println("      - META_APP_ID")
	fmt.Println("      - META_APP_SECRET")
	fmt.Println("      - META_REDIRECT_URL")
	fmt.Println("   2. Crea una App en Meta for Developers (developers.facebook.com)")
	fmt.Println("   3. Habilita WhatsApp Business API en tu App de Meta")
	fmt.Println("   4. Reinicia tu aplicación: go run main.go")
	fmt.Println("   5. Los usuarios podrán conectar WhatsApp desde Business Portfolio")
}
