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
	fmt.Println("║     🏪 MIGRACIÓN: SOPORTE MULTI-SUCURSAL                     ║")
	fmt.Println("╚═══════════════════════════════════════════════════════════════╝")
	fmt.Println()

	if err := godotenv.Load(); err != nil {
		log.Println("⚠️  Advertencia: No se encontró archivo .env")
	}

	fmt.Println("📡 Conectando a la base de datos...")
	config.ConnectDatabase()
	fmt.Println("✅ Conectado\n")

	fmt.Println("📋 Esta migración hará lo siguiente:")
	fmt.Println("   1. Eliminar la foreign key constraint de user_id")
	fmt.Println("   2. Convertir el índice unique en índice normal (permite múltiples sucursales por usuario)")
	fmt.Println("   3. Re-crear la foreign key constraint")
	fmt.Println("   4. Agregar columnas: branch_number, branch_name, phone_number, services, workers")
	fmt.Println("   5. Poblar branch_number=1 y branch_name='Sucursal 1' en registros existentes")
	fmt.Println("   6. Poblar phone_number desde la tabla users donde sea posible")
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
	// PASO 1: Obtener nombre de la FK constraint
	// ─────────────────────────────────────────────────────────────────
	printStep(1, 6, "BUSCANDO FOREIGN KEY CONSTRAINT")

	fkName := getFKName()
	if fkName == "" {
		fmt.Println("   ℹ️  No se encontró FK constraint (puede que ya esté limpio)")
	} else {
		fmt.Printf("   ✅ FK encontrada: %s\n", fkName)
	}

	// ─────────────────────────────────────────────────────────────────
	// PASO 2: Eliminar FK y convertir índice unique → normal
	// ─────────────────────────────────────────────────────────────────
	printStep(2, 6, "CONVIRTIENDO ÍNDICE UNIQUE → NORMAL")

	if fkName != "" {
		fmt.Printf("   → Eliminando FK: %s...\n", fkName)
		if err := config.DB.Exec(fmt.Sprintf("ALTER TABLE my_business_info DROP FOREIGN KEY `%s`", fkName)).Error; err != nil {
			log.Fatalf("❌ Error eliminando FK: %v", err)
		}
		fmt.Println("   ✅ FK eliminada")
	}

	// Verificar si el índice es unique
	if isUniqueIndex("idx_my_business_info_user_id", "my_business_info") {
		fmt.Println("   → Eliminando índice unique...")
		if err := config.DB.Exec("ALTER TABLE my_business_info DROP INDEX `idx_my_business_info_user_id`").Error; err != nil {
			log.Fatalf("❌ Error eliminando índice: %v", err)
		}
		fmt.Println("   → Creando índice normal...")
		if err := config.DB.Exec("ALTER TABLE my_business_info ADD INDEX `idx_my_business_info_user_id` (user_id)").Error; err != nil {
			log.Fatalf("❌ Error creando índice: %v", err)
		}
		fmt.Println("   ✅ Índice convertido a non-unique")
	} else {
		fmt.Println("   ⏭️  Índice ya es non-unique (saltando)")
	}

	// Re-crear FK
	fmt.Println("   → Re-creando foreign key constraint...")
	if err := config.DB.Exec(`
		ALTER TABLE my_business_info 
		ADD CONSTRAINT fk_my_business_info_user 
		FOREIGN KEY (user_id) REFERENCES users(id)
	`).Error; err != nil {
		// Si ya existe, no es error crítico
		fmt.Printf("   ⚠️  FK no re-creada (puede ya existir): %v\n", err)
	} else {
		fmt.Println("   ✅ FK re-creada")
	}

	// ─────────────────────────────────────────────────────────────────
	// PASO 3: Agregar columnas nuevas
	// ─────────────────────────────────────────────────────────────────
	printStep(3, 6, "AGREGANDO COLUMNAS NUEVAS")

	type newCol struct {
		name       string
		definition string
		after      string
	}

	cols := []newCol{
		{"branch_number", "INT NOT NULL DEFAULT 1", "user_id"},
		{"branch_name", "VARCHAR(255) DEFAULT 'Sucursal 1'", "branch_number"},
		{"phone_number", "VARCHAR(50) DEFAULT ''", "email"},
		{"services", "JSON", "workers"}, // se agrega al final si workers no existe aún
		{"workers", "JSON", "services"},
	}

	// Orden correcto de creación
	orderedCols := []newCol{
		{"branch_number", "INT NOT NULL DEFAULT 1", "user_id"},
		{"branch_name", "VARCHAR(255) DEFAULT 'Sucursal 1'", "branch_number"},
		{"phone_number", "VARCHAR(50) DEFAULT ''", "email"},
		{"services", "JSON", "website"},
		{"workers", "JSON", "services"},
	}
	_ = cols // evitar unused

	for _, col := range orderedCols {
		if columnExists(col.name, "my_business_info") {
			fmt.Printf("   ⏭️  Columna '%s' ya existe (saltando)\n", col.name)
			continue
		}
		fmt.Printf("   → Agregando columna '%s'...\n", col.name)
		sql := fmt.Sprintf(
			"ALTER TABLE my_business_info ADD COLUMN `%s` %s AFTER `%s`",
			col.name, col.definition, col.after,
		)
		if err := config.DB.Exec(sql).Error; err != nil {
			// Si el AFTER falla (columna no existe), agregar al final
			sql2 := fmt.Sprintf("ALTER TABLE my_business_info ADD COLUMN `%s` %s", col.name, col.definition)
			if err2 := config.DB.Exec(sql2).Error; err2 != nil {
				log.Fatalf("❌ Error agregando columna '%s': %v", col.name, err2)
			}
		}
		fmt.Printf("   ✅ Columna '%s' agregada\n", col.name)
	}

	// ─────────────────────────────────────────────────────────────────
	// PASO 4: Poblar branch_number y branch_name en registros existentes
	// ─────────────────────────────────────────────────────────────────
	printStep(4, 6, "POBLANDO branch_number Y branch_name")

	var sinBranch int64
	config.DB.Raw("SELECT COUNT(*) FROM my_business_info WHERE branch_number = 0 OR branch_number IS NULL").Scan(&sinBranch)

	if sinBranch > 0 {
		fmt.Printf("   → Actualizando %d registros con branch_number=1...\n", sinBranch)
		if err := config.DB.Exec(`
			UPDATE my_business_info 
			SET branch_number = 1, branch_name = 'Sucursal 1'
			WHERE branch_number = 0 OR branch_number IS NULL
		`).Error; err != nil {
			log.Fatalf("❌ Error actualizando branch_number: %v", err)
		}
		fmt.Printf("   ✅ %d registros actualizados\n", sinBranch)
	} else {
		fmt.Println("   ⏭️  Todos los registros ya tienen branch_number")
	}

	// ─────────────────────────────────────────────────────────────────
	// PASO 5: Poblar phone_number desde users
	// ─────────────────────────────────────────────────────────────────
	printStep(5, 6, "POBLANDO phone_number DESDE TABLA users")

	var sinTelefono int64
	config.DB.Raw("SELECT COUNT(*) FROM my_business_info WHERE phone_number = '' OR phone_number IS NULL").Scan(&sinTelefono)

	if sinTelefono > 0 {
		fmt.Printf("   → Copiando teléfono a %d registros...\n", sinTelefono)
		if err := config.DB.Exec(`
			UPDATE my_business_info b
			JOIN users u ON u.id = b.user_id
			SET b.phone_number = u.phone_number
			WHERE (b.phone_number = '' OR b.phone_number IS NULL)
			  AND u.phone_number != ''
		`).Error; err != nil {
			log.Printf("   ⚠️  Error copiando teléfonos: %v", err)
		} else {
			fmt.Println("   ✅ Teléfonos copiados desde users")
		}
	} else {
		fmt.Println("   ⏭️  phone_number ya está poblado")
	}

	// ─────────────────────────────────────────────────────────────────
	// PASO 6: Verificación final
	// ─────────────────────────────────────────────────────────────────
	printStep(6, 6, "VERIFICACIÓN FINAL")

	type TableColumn struct {
		Field   string
		Type    string
		Null    string
		Key     string
		Default *string
		Extra   string
	}

	checkCols := []string{"branch_number", "branch_name", "phone_number", "services", "workers"}
	allOk := true
	for _, col := range checkCols {
		if columnExists(col, "my_business_info") {
			fmt.Printf("   ✅ Columna presente: %s\n", col)
		} else {
			fmt.Printf("   ❌ Columna FALTANTE: %s\n", col)
			allOk = false
		}
	}

	// Estadísticas
	var total int64
	config.DB.Raw("SELECT COUNT(*) FROM my_business_info").Scan(&total)
	fmt.Printf("\n   📊 Total de registros en my_business_info: %d\n", total)

	var conBranch int64
	config.DB.Raw("SELECT COUNT(*) FROM my_business_info WHERE branch_number > 0").Scan(&conBranch)
	fmt.Printf("   📊 Registros con branch_number asignado: %d\n", conBranch)

	fmt.Println()
	fmt.Println("═══════════════════════════════════════════════════════════════")
	if allOk {
		fmt.Println("✅ MIGRACIÓN COMPLETADA EXITOSAMENTE")
		fmt.Println()
		fmt.Println("   Ya puedes iniciar la aplicación con: go run main.go")
	} else {
		fmt.Println("⚠️  MIGRACIÓN COMPLETADA CON ADVERTENCIAS — revisar columnas faltantes")
	}
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

func isUniqueIndex(indexName, tableName string) bool {
	var nonUnique int
	config.DB.Raw(`
		SELECT NON_UNIQUE FROM information_schema.STATISTICS 
		WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
		LIMIT 1
	`, tableName, indexName).Scan(&nonUnique)
	return nonUnique == 0
}

func getFKName() string {
	var name string
	config.DB.Raw(`
		SELECT CONSTRAINT_NAME 
		FROM information_schema.KEY_COLUMN_USAGE 
		WHERE TABLE_SCHEMA = DATABASE()
		  AND TABLE_NAME = 'my_business_info' 
		  AND COLUMN_NAME = 'user_id' 
		  AND REFERENCED_TABLE_NAME = 'users'
		LIMIT 1
	`).Scan(&name)
	return name
}
