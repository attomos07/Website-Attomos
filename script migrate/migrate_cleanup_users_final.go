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
	fmt.Println("║  🧹 LIMPIEZA DEFINITIVA: ELIMINAR COLUMNAS OBSOLETAS         ║")
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

	// Mostrar columnas actuales ANTES de la migración
	fmt.Println("📋 COLUMNAS ACTUALES EN 'users':")
	fmt.Println(strings.Repeat("─", 65))
	showCurrentColumns()

	fmt.Println()
	fmt.Println("❌ COLUMNAS QUE SE ELIMINARÁN:")
	fmt.Println(strings.Repeat("─", 65))
	fmt.Println()
	fmt.Println("   📱 Meta WhatsApp (8 columnas):")
	fmt.Println("      • meta_access_token")
	fmt.Println("      • meta_waba_id")
	fmt.Println("      • meta_phone_number_id")
	fmt.Println("      • meta_display_number")
	fmt.Println("      • meta_verified_name")
	fmt.Println("      • meta_connected")
	fmt.Println("      • meta_connected_at")
	fmt.Println("      • meta_token_expires_at")
	fmt.Println()
	fmt.Println("   🖥️  Servidor Compartido (4 columnas):")
	fmt.Println("      • shared_server_id")
	fmt.Println("      • shared_server_ip")
	fmt.Println("      • shared_server_password")
	fmt.Println("      • shared_server_status")
	fmt.Println()
	fmt.Println("   👤 Nombres (2 columnas):")
	fmt.Println("      • first_name")
	fmt.Println("      • last_name")
	fmt.Println()
	fmt.Println("⚠️  TOTAL: 14 columnas serán eliminadas")
	fmt.Println()
	fmt.Print("¿Continuar? (escribe 'SI ELIMINAR' para confirmar): ")

	reader := bufio.NewReader(os.Stdin)
	confirmation, _ := reader.ReadString('\n')
	confirmation = strings.TrimSpace(confirmation)

	if confirmation != "SI ELIMINAR" {
		fmt.Println("❌ Migración cancelada")
		return
	}

	fmt.Println()
	fmt.Println("═══════════════════════════════════════════════════════════════")
	fmt.Println("INICIANDO ELIMINACIÓN")
	fmt.Println("═══════════════════════════════════════════════════════════════")

	// Lista de columnas a eliminar
	columnsToRemove := []string{
		// Meta WhatsApp
		"meta_access_token",
		"meta_waba_id",
		"meta_phone_number_id",
		"meta_display_number",
		"meta_verified_name",
		"meta_connected",
		"meta_connected_at",
		"meta_token_expires_at",
		// Servidor Compartido
		"shared_server_id",
		"shared_server_ip",
		"shared_server_password",
		"shared_server_status",
		// Nombres
		"first_name",
		"last_name",
	}

	fmt.Println()
	fmt.Println("📝 Eliminando columnas...")
	fmt.Println(strings.Repeat("─", 65))

	successCount := 0
	skipCount := 0
	errorCount := 0

	for i, column := range columnsToRemove {
		fmt.Printf("   [%2d/14] %-30s ", i+1, column)

		// Verificar si la columna existe
		if !columnExists(column, "users") {
			fmt.Printf("⏭️  No existe\n")
			skipCount++
			continue
		}

		// Intentar eliminar con DROP COLUMN (sin IF EXISTS para forzar error si falla)
		dropSQL := fmt.Sprintf("ALTER TABLE users DROP COLUMN `%s`", column)
		if err := config.DB.Exec(dropSQL).Error; err != nil {
			fmt.Printf("❌ Error\n")
			fmt.Printf("        └─ %v\n", err)
			errorCount++

			// Intentar método alternativo
			fmt.Printf("        └─ Intentando método alternativo...\n")
			altDropSQL := fmt.Sprintf("ALTER TABLE users DROP `%s`", column)
			if err := config.DB.Exec(altDropSQL).Error; err != nil {
				fmt.Printf("        └─ ❌ Falló también\n")
			} else {
				fmt.Printf("        └─ ✅ Eliminada con método alternativo\n")
				successCount++
			}
		} else {
			fmt.Printf("✅ Eliminada\n")
			successCount++
		}
	}

	// Eliminar índices relacionados
	fmt.Println()
	fmt.Println("📝 Eliminando índices obsoletos...")
	fmt.Println(strings.Repeat("─", 65))

	indicesToRemove := []string{
		"idx_users_meta_connected",
		"idx_users_meta_phone_number_id",
		"idx_users_shared_server_status",
		"idx_users_business_size",
	}

	for _, index := range indicesToRemove {
		fmt.Printf("   → %-40s ", index)

		if !indexExists(index, "users") {
			fmt.Printf("⏭️  No existe\n")
			continue
		}

		dropIndexSQL := fmt.Sprintf("DROP INDEX `%s` ON users", index)
		if err := config.DB.Exec(dropIndexSQL).Error; err != nil {
			fmt.Printf("⚠️  Error: %v\n", err)
		} else {
			fmt.Printf("✅ Eliminado\n")
		}
	}

	// Resumen
	fmt.Println()
	fmt.Println(strings.Repeat("─", 65))
	fmt.Printf("\n📊 RESUMEN:\n")
	fmt.Printf("   ✅ Eliminadas exitosamente: %d columnas\n", successCount)
	fmt.Printf("   ⏭️  Saltadas (no existían): %d columnas\n", skipCount)
	if errorCount > 0 {
		fmt.Printf("   ❌ Errores: %d columnas\n", errorCount)
		fmt.Println()
		fmt.Println("⚠️  ATENCIÓN: Hubo errores al eliminar algunas columnas")
		fmt.Println("   Revisa los mensajes de error arriba para más detalles")
	}

	// Verificación final
	fmt.Println()
	fmt.Println("═══════════════════════════════════════════════════════════════")
	fmt.Println("VERIFICACIÓN FINAL")
	fmt.Println("═══════════════════════════════════════════════════════════════")

	fmt.Println()
	fmt.Println("📋 COLUMNAS RESTANTES EN 'users':")
	fmt.Println(strings.Repeat("─", 65))
	showCurrentColumns()

	// Verificar que no queden columnas obsoletas
	fmt.Println()
	remainingObsolete := checkRemainingObsoleteColumns(columnsToRemove)

	fmt.Println()
	if len(remainingObsolete) == 0 {
		fmt.Println("═══════════════════════════════════════════════════════════════")
		fmt.Println("✅ LIMPIEZA COMPLETADA EXITOSAMENTE")
		fmt.Println("═══════════════════════════════════════════════════════════════")
		fmt.Println()
		fmt.Println("🎉 Todas las columnas obsoletas han sido eliminadas")
		fmt.Println()
		fmt.Println("📋 Próximos pasos:")
		fmt.Println("   1. ✅ Actualiza models/user.go (elimina campos obsoletos)")
		fmt.Println("   2. ✅ Actualiza handlers/auth.go (elimina referencias)")
		fmt.Println("   3. ✅ Actualiza handlers/user.go (elimina referencias)")
		fmt.Println("   4. 🔄 Reinicia tu aplicación")
		fmt.Println("   5. ✅ Verifica que todo funcione correctamente")
	} else {
		fmt.Println("═══════════════════════════════════════════════════════════════")
		fmt.Println("⚠️  LIMPIEZA INCOMPLETA")
		fmt.Println("═══════════════════════════════════════════════════════════════")
		fmt.Println()
		fmt.Printf("❌ Quedan %d columnas obsoletas sin eliminar:\n", len(remainingObsolete))
		for _, col := range remainingObsolete {
			fmt.Printf("   • %s\n", col)
		}
		fmt.Println()
		fmt.Println("💡 Intenta ejecutar manualmente en MySQL:")
		fmt.Println()
		for _, col := range remainingObsolete {
			fmt.Printf("   ALTER TABLE users DROP COLUMN `%s`;\n", col)
		}
		fmt.Println()
		fmt.Println("O conéctate directamente a MySQL y ejecuta:")
		fmt.Println("   USE tu_base_de_datos;")
		for _, col := range remainingObsolete {
			fmt.Printf("   ALTER TABLE users DROP COLUMN IF EXISTS `%s`;\n", col)
		}
	}

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

// showCurrentColumns muestra todas las columnas actuales de la tabla users
func showCurrentColumns() {
	type TableColumn struct {
		Field   string
		Type    string
		Null    string
		Key     string
		Default *string
		Extra   string
	}

	var columns []TableColumn
	config.DB.Raw("DESCRIBE users").Scan(&columns)

	for _, col := range columns {
		keyIndicator := "   "
		if col.Key == "PRI" {
			keyIndicator = "🔑 "
		} else if col.Key == "MUL" {
			keyIndicator = "📇 "
		}
		fmt.Printf("   %s %-30s %s\n", keyIndicator, col.Field, col.Type)
	}

	fmt.Printf("\n   Total: %d columnas\n", len(columns))
}

// checkRemainingObsoleteColumns verifica si quedan columnas obsoletas
func checkRemainingObsoleteColumns(obsoleteColumns []string) []string {
	var remaining []string

	type TableColumn struct {
		Field string
	}

	var columns []TableColumn
	config.DB.Raw("SELECT COLUMN_NAME as Field FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'").Scan(&columns)

	for _, col := range columns {
		for _, obsolete := range obsoleteColumns {
			if col.Field == obsolete {
				remaining = append(remaining, col.Field)
				fmt.Printf("   ⚠️  Columna obsoleta aún presente: %s\n", obsolete)
			}
		}
	}

	if len(remaining) == 0 {
		fmt.Println("   ✅ No quedan columnas obsoletas")
	}

	return remaining
}
