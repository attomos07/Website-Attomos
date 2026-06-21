package main

import (
	"bufio"
	"fmt"
	"log"
	"os"
	"strings"

	"attomos/config"
	"attomos/models"

	"github.com/joho/godotenv"
)

func main() {
	fmt.Println("╔═══════════════════════════════════════════════════════════════╗")
	fmt.Println("║  ➕ MIGRACIÓN: AGREGAR CAMPOS DE SERVIDOR A AGENTS          ║")
	fmt.Println("╚═══════════════════════════════════════════════════════════════╝")
	fmt.Println()

	// Cargar variables de entorno
	if err := godotenv.Load(); err != nil {
		log.Println("⚠️  Advertencia: No se encontró archivo .env")
	}

	// Conectar a la base de datos
	fmt.Println("📡 Conectando a la base de datos...")
	config.ConnectDatabase()
	fmt.Println("✅ Conectado a la base de datos\n")

	fmt.Println("📋 Esta migración hará lo siguiente:")
	fmt.Println("   1. Agregar campos de servidor a tabla 'agents':")
	fmt.Println("      • server_id (int) - ID del servidor en Hetzner")
	fmt.Println("      • server_ip (varchar) - IP del servidor")
	fmt.Println("      • server_password (varchar) - Password SSH")
	fmt.Println("      • server_status (varchar) - Estado del servidor")
	fmt.Println()
	fmt.Println("💡 Estos campos son para BuilderBots (plan de pago)")
	fmt.Println("   Cada BuilderBot tendrá su propio servidor individual")
	fmt.Println()
	fmt.Print("¿Continuar? (escribe 'SI' para continuar): ")

	reader := bufio.NewReader(os.Stdin)
	confirmation, _ := reader.ReadString('\n')
	confirmation = strings.TrimSpace(strings.ToUpper(confirmation))

	if confirmation != "SI" {
		fmt.Println("❌ Migración cancelada")
		return
	}

	fmt.Println()
	fmt.Println("═══════════════════════════════════════════════════════════════")
	fmt.Println("INICIANDO MIGRACIÓN")
	fmt.Println("═══════════════════════════════════════════════════════════════")

	// =====================================================================
	// PASO 1: VERIFICAR COLUMNAS EXISTENTES
	// =====================================================================
	fmt.Println("\n" + strings.Repeat("─", 65))
	fmt.Println("PASO 1/3: VERIFICANDO ESTRUCTURA ACTUAL")
	fmt.Println(strings.Repeat("─", 65))

	columnsToAdd := []struct {
		Name       string
		Definition string
	}{
		{"server_id", "ALTER TABLE agents ADD COLUMN server_id INT DEFAULT 0 AFTER bot_type"},
		{"server_ip", "ALTER TABLE agents ADD COLUMN server_ip VARCHAR(50) DEFAULT '' AFTER server_id"},
		{"server_password", "ALTER TABLE agents ADD COLUMN server_password VARCHAR(255) DEFAULT '' AFTER server_ip"},
		{"server_status", "ALTER TABLE agents ADD COLUMN server_status VARCHAR(50) DEFAULT 'pending' AFTER server_password"},
	}

	for _, col := range columnsToAdd {
		if columnExists(col.Name, "agents") {
			fmt.Printf("   ⏭️  Columna '%s' ya existe\n", col.Name)
		} else {
			fmt.Printf("   ℹ️  Columna '%s' será agregada\n", col.Name)
		}
	}

	// =====================================================================
	// PASO 2: AGREGAR COLUMNAS
	// =====================================================================
	fmt.Println("\n" + strings.Repeat("─", 65))
	fmt.Println("PASO 2/3: AGREGANDO COLUMNAS")
	fmt.Println(strings.Repeat("─", 65))

	successCount := 0
	skipCount := 0
	errorCount := 0

	for _, col := range columnsToAdd {
		fmt.Printf("   → Procesando: %s... ", col.Name)

		if columnExists(col.Name, "agents") {
			fmt.Printf("⏭️  Ya existe\n")
			skipCount++
			continue
		}

		if err := config.DB.Exec(col.Definition).Error; err != nil {
			fmt.Printf("❌ Error: %v\n", err)
			errorCount++
		} else {
			fmt.Printf("✅ Agregada\n")
			successCount++
		}
	}

	// =====================================================================
	// PASO 3: CREAR ÍNDICES
	// =====================================================================
	fmt.Println("\n" + strings.Repeat("─", 65))
	fmt.Println("PASO 3/3: CREANDO ÍNDICES")
	fmt.Println(strings.Repeat("─", 65))

	indexes := []struct {
		Name       string
		Definition string
	}{
		{"idx_agents_server_id", "CREATE INDEX idx_agents_server_id ON agents(server_id)"},
		{"idx_agents_server_status", "CREATE INDEX idx_agents_server_status ON agents(server_status)"},
	}

	for _, idx := range indexes {
		fmt.Printf("   → Creando índice: %s... ", idx.Name)

		if indexExists(idx.Name, "agents") {
			fmt.Printf("⏭️  Ya existe\n")
			continue
		}

		if err := config.DB.Exec(idx.Definition).Error; err != nil {
			fmt.Printf("⚠️  Error: %v\n", err)
		} else {
			fmt.Printf("✅ Creado\n")
		}
	}

	// =====================================================================
	// VERIFICACIÓN FINAL
	// =====================================================================
	fmt.Println("\n" + strings.Repeat("─", 65))
	fmt.Println("VERIFICACIÓN FINAL")
	fmt.Println(strings.Repeat("─", 65))

	fmt.Printf("\n   📊 Resumen:\n")
	fmt.Printf("      ✅ Columnas agregadas: %d\n", successCount)
	fmt.Printf("      ⏭️  Columnas saltadas (ya existían): %d\n", skipCount)
	if errorCount > 0 {
		fmt.Printf("      ❌ Errores: %d\n", errorCount)
	}

	// Mostrar estructura final
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

	fmt.Println("\n   📋 Campos de servidor en 'agents':")
	for _, col := range agentColumns {
		if strings.HasPrefix(col.Field, "server_") {
			fmt.Printf("      • %-20s %s\n", col.Field, col.Type)
		}
	}

	// Estadísticas
	var agentCount int64
	config.DB.Model(&models.Agent{}).Count(&agentCount)

	var builderBotCount int64
	config.DB.Model(&models.Agent{}).Where("bot_type = ? OR bot_type = ''", "builderbot").Count(&builderBotCount)

	var atomicBotCount int64
	config.DB.Model(&models.Agent{}).Where("bot_type = ?", "atomic").Count(&atomicBotCount)

	fmt.Printf("\n   📊 Estadísticas:\n")
	fmt.Printf("      • Total de agentes: %d\n", agentCount)
	fmt.Printf("      • BuilderBots (con servidor individual): %d\n", builderBotCount)
	fmt.Printf("      • AtomicBots (servidor compartido global): %d\n", atomicBotCount)

	fmt.Println()
	fmt.Println("═══════════════════════════════════════════════════════════════")
	fmt.Println("✅ MIGRACIÓN COMPLETADA EXITOSAMENTE")
	fmt.Println("═══════════════════════════════════════════════════════════════")

	fmt.Println("\n📋 Próximos pasos:")
	fmt.Println("   1. Actualiza models/agent.go con los nuevos campos")
	fmt.Println("   2. Actualiza handlers/agent.go para usar agent.Server* en lugar de user.SharedServer*")
	fmt.Println("   3. Reinicia tu aplicación")
	fmt.Println("   4. Los nuevos BuilderBots crearán su propio servidor individual")
	fmt.Println()
	fmt.Println("💡 Arquitectura:")
	fmt.Println("   • AtomicBot (Gratuito) → Servidor Compartido Global (/mnt/skills/public)")
	fmt.Println("   • BuilderBot (Pago) → Servidor Individual por Agente")
	fmt.Println()
}

// columnExists verifica si una columna existe en una tabla
func columnExists(columnName, tableName string) bool {
	var count int64
	query := `
		SELECT COUNT(*) 
		FROM information_schema.COLUMNS 
		WHERE TABLE_SCHEMA = DATABASE() 
		AND TABLE_NAME = ? 
		AND COLUMN_NAME = ?
	`
	config.DB.Raw(query, tableName, columnName).Scan(&count)
	return count > 0
}

// indexExists verifica si un índice existe en una tabla
func indexExists(indexName, tableName string) bool {
	var count int64
	query := `
		SELECT COUNT(*) 
		FROM information_schema.STATISTICS 
		WHERE TABLE_SCHEMA = DATABASE() 
		AND TABLE_NAME = ? 
		AND INDEX_NAME = ?
	`
	config.DB.Raw(query, tableName, indexName).Scan(&count)
	return count > 0
}
