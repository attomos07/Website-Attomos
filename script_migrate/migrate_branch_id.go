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
	fmt.Println("╔═══════════════════════════════════════════════════════════════╗")
	fmt.Println("║     🔗 MIGRACIÓN: BRANCH_ID EN AGENTES                       ║")
	fmt.Println("╚═══════════════════════════════════════════════════════════════╝")
	fmt.Println()

	if err := godotenv.Load(); err != nil {
		log.Println("⚠️  Advertencia: No se encontró archivo .env")
	}

	fmt.Println("📡 Conectando a la base de datos...")
	config.ConnectDatabase()
	fmt.Println("✅ Conectado\n")

	fmt.Println("📋 Esta migración hará lo siguiente:")
	fmt.Println("   1. Detectar tipo de my_business_info.id y usar el mismo en branch_id")
	fmt.Println("   2. Agregar columna branch_id a agents (si no existe)")
	fmt.Println("   3. Crear índice idx_agents_branch_id (si no existe)")
	fmt.Println("   4. Vincular agentes existentes a su primera sucursal")
	fmt.Println("   5. Verificación final")
	fmt.Println()
	fmt.Print("¿Continuar? (escribe 'SI' para continuar): ")

	reader := bufio.NewReader(os.Stdin)
	confirm, _ := reader.ReadString('\n')
	if strings.TrimSpace(strings.ToUpper(confirm)) != "SI" {
		fmt.Println("❌ Migración cancelada")
		return
	}

	fmt.Println()
	fmt.Println("═══════════════════════════════════════════════════════════════")

	// ─────────────────────────────────────────────────────────────────
	// PASO 1: Detectar tipo de my_business_info.id
	// ─────────────────────────────────────────────────────────────────
	printStep(1, 5, "DETECTANDO TIPO DE my_business_info.id")

	var colType string
	config.DB.Raw(`
		SELECT COLUMN_TYPE FROM information_schema.COLUMNS
		WHERE TABLE_SCHEMA = DATABASE()
		  AND TABLE_NAME   = 'my_business_info'
		  AND COLUMN_NAME  = 'id'
		LIMIT 1
	`).Scan(&colType)

	if colType == "" {
		log.Fatal("❌ No se pudo obtener el tipo de my_business_info.id")
	}
	fmt.Printf("   ✅ my_business_info.id es: %s\n", colType)

	// Usar el mismo tipo para branch_id (sin AUTO_INCREMENT ni PRIMARY KEY)
	branchColDef := colType + " NOT NULL DEFAULT 0"
	fmt.Printf("   → branch_id se creará como: %s\n", branchColDef)

	// ─────────────────────────────────────────────────────────────────
	// PASO 2: Agregar columna branch_id
	// ─────────────────────────────────────────────────────────────────
	printStep(2, 5, "AGREGANDO COLUMNA branch_id A agents")

	if columnExists("branch_id", "agents") {
		fmt.Println("   ⏭️  Columna branch_id ya existe (saltando)")
	} else {
		fmt.Println("   → Agregando columna branch_id...")
		sql := fmt.Sprintf(
			"ALTER TABLE agents ADD COLUMN `branch_id` %s AFTER `user_id`",
			branchColDef,
		)
		if err := config.DB.Exec(sql).Error; err != nil {
			log.Fatalf("❌ Error agregando columna branch_id: %v", err)
		}
		fmt.Println("   ✅ Columna branch_id agregada")
	}

	// ─────────────────────────────────────────────────────────────────
	// PASO 3: Crear índice
	// ─────────────────────────────────────────────────────────────────
	printStep(3, 5, "CREANDO ÍNDICE idx_agents_branch_id")

	if indexExists("idx_agents_branch_id", "agents") {
		fmt.Println("   ⏭️  Índice ya existe (saltando)")
	} else {
		fmt.Println("   → Creando índice...")
		if err := config.DB.Exec(`ALTER TABLE agents ADD INDEX idx_agents_branch_id (branch_id)`).Error; err != nil {
			log.Fatalf("❌ Error creando índice: %v", err)
		}
		fmt.Println("   ✅ Índice creado")
	}

	// ─────────────────────────────────────────────────────────────────
	// PASO 4: Vincular agentes existentes a su primera sucursal
	// ─────────────────────────────────────────────────────────────────
	printStep(4, 5, "VINCULANDO AGENTES EXISTENTES A SU SUCURSAL")

	var sinVincular int64
	config.DB.Raw(`SELECT COUNT(*) FROM agents WHERE branch_id = 0`).Scan(&sinVincular)

	if sinVincular == 0 {
		fmt.Println("   ⏭️  Todos los agentes ya tienen branch_id asignado")
	} else {
		fmt.Printf("   → %d agentes sin branch_id, buscando sucursales...\n", sinVincular)

		result := config.DB.Exec(`
			UPDATE agents a
			JOIN (
				SELECT user_id, MIN(id) AS first_branch_id
				FROM my_business_info
				WHERE deleted_at IS NULL
				GROUP BY user_id
			) b ON b.user_id = a.user_id
			SET a.branch_id = b.first_branch_id
			WHERE a.branch_id = 0
		`)
		if result.Error != nil {
			log.Fatalf("❌ Error vinculando agentes: %v", result.Error)
		}
		fmt.Printf("   ✅ %d agentes vinculados a su primera sucursal\n", result.RowsAffected)

		var sinSucursal int64
		config.DB.Raw(`SELECT COUNT(*) FROM agents WHERE branch_id = 0`).Scan(&sinSucursal)
		if sinSucursal > 0 {
			fmt.Printf("   ⚠️  %d agentes cuyo usuario aún no tiene My Business (branch_id=0)\n", sinSucursal)
			fmt.Println("      → Se vincularán cuando el usuario complete My Business")
		}
	}

	// ─────────────────────────────────────────────────────────────────
	// PASO 5: Verificación final
	// ─────────────────────────────────────────────────────────────────
	printStep(5, 5, "VERIFICACIÓN FINAL")

	if columnExists("branch_id", "agents") {
		fmt.Println("   ✅ Columna branch_id presente en agents")
	} else {
		fmt.Println("   ❌ Columna branch_id FALTANTE")
	}

	if indexExists("idx_agents_branch_id", "agents") {
		fmt.Println("   ✅ Índice idx_agents_branch_id presente")
	} else {
		fmt.Println("   ❌ Índice FALTANTE")
	}

	var totalAgents, vinculados, sinVincularFinal int64
	config.DB.Raw(`SELECT COUNT(*) FROM agents`).Scan(&totalAgents)
	config.DB.Raw(`SELECT COUNT(*) FROM agents WHERE branch_id > 0`).Scan(&vinculados)
	config.DB.Raw(`SELECT COUNT(*) FROM agents WHERE branch_id = 0`).Scan(&sinVincularFinal)

	fmt.Printf("\n   📊 Total de agentes:           %d\n", totalAgents)
	fmt.Printf("   📊 Agentes con branch_id:      %d\n", vinculados)
	fmt.Printf("   📊 Agentes sin branch_id (0):  %d\n", sinVincularFinal)

	fmt.Println()
	fmt.Println("═══════════════════════════════════════════════════════════════")
	fmt.Println("✅ MIGRACIÓN COMPLETADA EXITOSAMENTE")
	fmt.Println()
	fmt.Println("   Nota: FK constraint omitida intencionalmente.")
	fmt.Println("   La relación se mantiene a nivel de aplicación (GORM).")
	fmt.Println("═══════════════════════════════════════════════════════════════")
	fmt.Println()
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

func printStep(n, total int, title string) {
	fmt.Printf("\n%s\n", strings.Repeat("─", 65))
	fmt.Printf("PASO %d/%d: %s\n", n, total, title)
	fmt.Println(strings.Repeat("─", 65))
}

func columnExists(columnName, tableName string) bool {
	var count int64
	config.DB.Raw(`
		SELECT COUNT(*) FROM information_schema.COLUMNS
		WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
	`, tableName, columnName).Scan(&count)
	return count > 0
}

func indexExists(indexName, tableName string) bool {
	var count int64
	config.DB.Raw(`
		SELECT COUNT(*) FROM information_schema.STATISTICS
		WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
	`, tableName, indexName).Scan(&count)
	return count > 0
}
