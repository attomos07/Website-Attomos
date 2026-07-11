package main

import (
	"bufio"
	"database/sql"
	"fmt"
	"log"
	"os"
	"strings"

	"attomos/config"

	"github.com/joho/godotenv"
)

func main() {
	fmt.Println("╔═══════════════════════════════════════════════════════════════╗")
	fmt.Println("║     🗑️  MIGRACIÓN: RESET COMPLETO DE TABLAS                  ║")
	fmt.Println("╚═══════════════════════════════════════════════════════════════╝")
	fmt.Println()

	if err := godotenv.Load(); err != nil {
		log.Println("⚠️  Advertencia: No se encontró archivo .env")
	}

	fmt.Println("📡 Conectando a la base de datos...")
	config.ConnectDatabase()
	fmt.Println("✅ Conectado\n")

	fmt.Println("⚠️  ADVERTENCIA: Esta operación es IRREVERSIBLE.")
	fmt.Println("   Se eliminarán TODOS los datos de las siguientes tablas:")
	fmt.Println()
	fmt.Println("     • invoices")
	fmt.Println("     • appointments")
	fmt.Println("     • payments")
	fmt.Println("     • subscriptions")
	fmt.Println("     • agents")
	fmt.Println("     • my_business_info")
	fmt.Println("     • global_servers")
	fmt.Println("     • google_cloud_projects")
	fmt.Println("     • users")
	fmt.Println()
	fmt.Println("   Los contadores AUTO_INCREMENT se reiniciarán a 1.")
	fmt.Println()
	fmt.Print("¿Confirmas que deseas borrar TODO? (escribe 'BORRAR TODO' para continuar): ")

	reader := bufio.NewReader(os.Stdin)
	confirm, _ := reader.ReadString('\n')
	if strings.TrimSpace(confirm) != "BORRAR TODO" {
		fmt.Println("❌ Operación cancelada")
		return
	}

	fmt.Println()
	fmt.Println("═══════════════════════════════════════════════════════════════")

	db, err := config.DB.DB()
	if err != nil {
		log.Fatalf("❌ Error obteniendo instancia de DB: %v", err)
	}

	// ─────────────────────────────────────────────────────────────────
	// PASO 1: Deshabilitar foreign key checks
	// ─────────────────────────────────────────────────────────────────
	printStep(1, 4, "DESHABILITANDO FOREIGN KEY CHECKS")

	if _, err := db.Exec("SET FOREIGN_KEY_CHECKS = 0"); err != nil {
		log.Fatalf("❌ Error deshabilitando FK checks: %v", err)
	}
	fmt.Println("   ✅ Foreign key checks deshabilitados")

	// ─────────────────────────────────────────────────────────────────
	// PASO 2: TRUNCATE de cada tabla (borra datos y resetea contador)
	// ─────────────────────────────────────────────────────────────────
	printStep(2, 4, "LIMPIANDO TABLAS Y REINICIANDO CONTADORES")

	// Orden: primero las que tienen FKs hacia otras, luego las padres
	tables := []string{
		"invoices",
		"appointments",
		"payments",
		"subscriptions",
		"agents",
		"my_business_info",
		"global_servers",
		"google_cloud_projects",
		"users",
	}

	for _, table := range tables {
		if !tableExists(db, table) {
			fmt.Printf("   ⏭️  Tabla '%s' no existe (saltando)\n", table)
			continue
		}

		fmt.Printf("   → Limpiando tabla '%s'...", table)
		if _, err := db.Exec(fmt.Sprintf("TRUNCATE TABLE `%s`", table)); err != nil {
			fmt.Printf(" ❌\n")
			log.Fatalf("      Error: %v", err)
		}
		fmt.Printf(" ✅\n")
	}

	// ─────────────────────────────────────────────────────────────────
	// PASO 3: Rehabilitar foreign key checks
	// ─────────────────────────────────────────────────────────────────
	printStep(3, 4, "REHABILITANDO FOREIGN KEY CHECKS")

	if _, err := db.Exec("SET FOREIGN_KEY_CHECKS = 1"); err != nil {
		log.Fatalf("❌ Error rehabilitando FK checks: %v", err)
	}
	fmt.Println("   ✅ Foreign key checks rehabilitados")

	// ─────────────────────────────────────────────────────────────────
	// PASO 4: Verificación final
	// ─────────────────────────────────────────────────────────────────
	printStep(4, 4, "VERIFICACIÓN FINAL")

	allEmpty := true
	for _, table := range tables {
		if !tableExists(db, table) {
			continue
		}

		var count int64
		if err := db.QueryRow(fmt.Sprintf("SELECT COUNT(*) FROM `%s`", table)).Scan(&count); err != nil {
			fmt.Printf("   ⚠️  No se pudo verificar '%s': %v\n", table, err)
			continue
		}

		var autoInc sql.NullInt64
		db.QueryRow(`
			SELECT AUTO_INCREMENT 
			FROM information_schema.TABLES 
			WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
		`, table).Scan(&autoInc)

		nextID := int64(1)
		if autoInc.Valid {
			nextID = autoInc.Int64
		}

		status := "✅"
		if count > 0 {
			status = "⚠️ "
			allEmpty = false
		}
		fmt.Printf("   %s %-25s  registros: %-5d  próximo ID: %d\n", status, table, count, nextID)
	}

	fmt.Println()
	fmt.Println("═══════════════════════════════════════════════════════════════")
	if allEmpty {
		fmt.Println("✅ RESET COMPLETADO — todas las tablas están vacías y los")
		fmt.Println("   contadores AUTO_INCREMENT reiniciados en 1.")
	} else {
		fmt.Println("⚠️  RESET COMPLETADO CON ADVERTENCIAS — algunas tablas aún")
		fmt.Println("   contienen registros. Revisa los errores anteriores.")
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

func tableExists(db *sql.DB, tableName string) bool {
	var count int64
	db.QueryRow(`
		SELECT COUNT(*) FROM information_schema.TABLES 
		WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
	`, tableName).Scan(&count)
	return count > 0
}
