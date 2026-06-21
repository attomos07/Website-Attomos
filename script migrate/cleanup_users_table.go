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
	fmt.Println("║     🧹 LIMPIEZA: ELIMINAR COLUMNAS OBSOLETAS DE USERS        ║")
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

	fmt.Println("📋 Esta migración eliminará las siguientes columnas de 'users':")
	fmt.Println("   ❌ stripe_customer_id")
	fmt.Println("   ❌ stripe_subscription_id")
	fmt.Println("   ❌ subscription_status")
	fmt.Println("   ❌ subscription_plan")
	fmt.Println("   ❌ current_period_end")
	fmt.Println("   ❌ has_selected_plan")
	fmt.Println("   ❌ trial_ends_at")
	fmt.Println()
	fmt.Println("💡 Estos datos ahora están en la tabla 'subscriptions'")
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
	fmt.Println("INICIANDO LIMPIEZA")
	fmt.Println("═══════════════════════════════════════════════════════════════")

	// Verificar que la tabla subscriptions existe
	fmt.Println("\n🔍 Verificando que tabla 'subscriptions' existe...")
	var subCount int64
	config.DB.Model(&models.Subscription{}).Count(&subCount)
	fmt.Printf("✅ Tabla subscriptions existe con %d registros\n", subCount)

	// Lista de columnas a eliminar
	columnsToRemove := []string{
		"stripe_customer_id",
		"stripe_subscription_id",
		"subscription_status",
		"subscription_plan",
		"current_period_end",
		"has_selected_plan",
		"trial_ends_at",
	}

	fmt.Println("\n📝 Eliminando columnas obsoletas...")
	fmt.Println(strings.Repeat("─", 65))

	successCount := 0
	skipCount := 0
	errorCount := 0

	for _, column := range columnsToRemove {
		fmt.Printf("   → Procesando: %s... ", column)

		// Verificar si la columna existe
		if !columnExists(column, "users") {
			fmt.Printf("⏭️  No existe (saltando)\n")
			skipCount++
			continue
		}

		// Eliminar la columna
		dropSQL := fmt.Sprintf("ALTER TABLE users DROP COLUMN %s", column)
		if err := config.DB.Exec(dropSQL).Error; err != nil {
			fmt.Printf("❌ Error: %v\n", err)
			errorCount++
		} else {
			fmt.Printf("✅ Eliminada\n")
			successCount++
		}
	}

	// Resumen
	fmt.Println(strings.Repeat("─", 65))
	fmt.Printf("\n📊 Resumen:\n")
	fmt.Printf("   ✅ Eliminadas exitosamente: %d\n", successCount)
	fmt.Printf("   ⏭️  Saltadas (no existían): %d\n", skipCount)
	if errorCount > 0 {
		fmt.Printf("   ❌ Errores: %d\n", errorCount)
	}

	// Verificación final
	fmt.Println("\n🔍 Verificando estructura actual de 'users'...")

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

	fmt.Println("\n📋 Columnas actuales en 'users':")
	for _, col := range userColumns {
		fmt.Printf("   • %s (%s)\n", col.Field, col.Type)
	}

	// Verificar que no queden columnas obsoletas
	hasObsoleteColumns := false
	for _, col := range userColumns {
		for _, obsolete := range columnsToRemove {
			if col.Field == obsolete {
				hasObsoleteColumns = true
				fmt.Printf("   ⚠️  Columna obsoleta todavía presente: %s\n", obsolete)
			}
		}
	}

	fmt.Println()
	if !hasObsoleteColumns {
		fmt.Println("═══════════════════════════════════════════════════════════════")
		fmt.Println("✅ LIMPIEZA COMPLETADA EXITOSAMENTE")
		fmt.Println("═══════════════════════════════════════════════════════════════")
		fmt.Println()
		fmt.Println("📋 Próximos pasos:")
		fmt.Println("   1. Reinicia tu aplicación")
		fmt.Println("   2. Intenta seleccionar un plan nuevamente")
		fmt.Println("   3. El error de JSON debería estar resuelto")
		fmt.Println()
		fmt.Println("💡 Ahora la información de suscripciones está en:")
		fmt.Println("   • Tabla: subscriptions")
		fmt.Println("   • Campo metadata permite NULL o JSON válido")
	} else {
		fmt.Println("⚠️  Todavía quedan columnas obsoletas. Intenta ejecutar manualmente:")
		fmt.Println()
		for _, col := range columnsToRemove {
			fmt.Printf("   ALTER TABLE users DROP COLUMN IF EXISTS %s;\n", col)
		}
	}
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
