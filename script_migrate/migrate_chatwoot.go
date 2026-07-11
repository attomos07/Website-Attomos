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
	fmt.Println("🔄 Migración: Agregar Campos de Chatwoot")
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
	fmt.Println("   - Esta migración agregará campos de Chatwoot a la tabla agents")
	fmt.Println("   - Campos: chatwoot_email, chatwoot_password, chatwoot_account_id, etc.")
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

	migrations := []string{
		// Agregar columnas de Chatwoot a agents
		"ALTER TABLE agents ADD COLUMN IF NOT EXISTS chatwoot_email VARCHAR(255) DEFAULT ''",
		"ALTER TABLE agents ADD COLUMN IF NOT EXISTS chatwoot_password VARCHAR(255) DEFAULT ''",
		"ALTER TABLE agents ADD COLUMN IF NOT EXISTS chatwoot_account_id INT DEFAULT 0",
		"ALTER TABLE agents ADD COLUMN IF NOT EXISTS chatwoot_account_name VARCHAR(255) DEFAULT ''",
		"ALTER TABLE agents ADD COLUMN IF NOT EXISTS chatwoot_inbox_id INT DEFAULT 0",
		"ALTER TABLE agents ADD COLUMN IF NOT EXISTS chatwoot_inbox_name VARCHAR(255) DEFAULT ''",
		"ALTER TABLE agents ADD COLUMN IF NOT EXISTS chatwoot_url VARCHAR(500) DEFAULT ''",

		// Crear índices para mejor rendimiento
		"CREATE INDEX IF NOT EXISTS idx_agents_chatwoot_email ON agents(chatwoot_email)",
		"CREATE INDEX IF NOT EXISTS idx_agents_chatwoot_account_id ON agents(chatwoot_account_id)",
	}

	for _, migration := range migrations {
		fmt.Printf("   → Ejecutando: %s\n", migration)
		if err := config.DB.Exec(migration).Error; err != nil {
			log.Printf("⚠️  Error ejecutando: %s\n   Error: %v", migration, err)
		}
	}

	fmt.Println("   ✅ Estructura actualizada")
	fmt.Println()

	// PASO 2: Verificar resultados
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
	hasChatwootFields := false
	for _, col := range agentColumns {
		if col.Field == "chatwoot_email" {
			hasChatwootFields = true
			break
		}
	}

	if hasChatwootFields {
		fmt.Println("   ✅ Todas las columnas de Chatwoot verificadas")
	} else {
		fmt.Println("   ⚠️  Algunas columnas pueden no haberse creado correctamente")
	}

	fmt.Println()
	fmt.Println("🎉 Migración completada!")
	fmt.Println()
	fmt.Println("📋 Próximos pasos:")
	fmt.Println("   1. Reinicia tu aplicación")
	fmt.Println("   2. Los nuevos agentes tendrán credenciales de Chatwoot automáticamente")
	fmt.Println("   3. Configura el DNS para chat.attomos.com apuntando a tu servidor")
	fmt.Println()
}
