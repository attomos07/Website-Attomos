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
	fmt.Println("║     🔓 MIGRACIÓN: ELIMINAR FK fk_orders_agent               ║")
	fmt.Println("╚═══════════════════════════════════════════════════════════════╝")
	fmt.Println()

	if err := godotenv.Load(); err != nil {
		log.Println("⚠️  Advertencia: No se encontró archivo .env")
	}

	fmt.Println("📡 Conectando a la base de datos...")
	config.ConnectDatabase()
	fmt.Println("✅ Conectado\n")

	fmt.Println("📋 Esta migración hará lo siguiente:")
	fmt.Println("   1. Detectar todos los FOREIGN KEYs en la tabla orders")
	fmt.Println("   2. Eliminar cualquier FK que referencie a agents.id")
	fmt.Println("   3. Verificación final")
	fmt.Println()
	fmt.Println("   ℹ️  Motivo: pedidos manuales tienen agent_id = 0,")
	fmt.Println("      el FK impide insertar porque 0 no existe en agents.")
	fmt.Println("      La relación se mantiene a nivel de aplicación (GORM).")
	fmt.Println()
	fmt.Print("¿Continuar? (escribe 'SI' para continuar): ")

	reader := bufio.NewReader(os.Stdin)
	confirm, _ := reader.ReadString('\n')
	if strings.TrimSpace(strings.ToUpper(confirm)) != "SI" {
		fmt.Println("❌ Migración cancelada")
		return
	}

	// ─────────────────────────────────────────────────────────────────
	// PASO 1: Detectar FKs en orders
	// ─────────────────────────────────────────────────────────────────
	printStep(1, 3, "DETECTANDO FOREIGN KEYS EN orders")

	type FKInfo struct {
		ConstraintName   string
		ColumnName       string
		ReferencedTable  string
		ReferencedColumn string
	}
	var fks []FKInfo
	config.DB.Raw(`
		SELECT
			kcu.CONSTRAINT_NAME,
			kcu.COLUMN_NAME,
			kcu.REFERENCED_TABLE_NAME  AS ReferencedTable,
			kcu.REFERENCED_COLUMN_NAME AS ReferencedColumn
		FROM information_schema.KEY_COLUMN_USAGE kcu
		JOIN information_schema.TABLE_CONSTRAINTS tc
		  ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
		 AND tc.TABLE_SCHEMA    = kcu.TABLE_SCHEMA
		 AND tc.TABLE_NAME      = kcu.TABLE_NAME
		WHERE kcu.TABLE_SCHEMA  = DATABASE()
		  AND kcu.TABLE_NAME    = 'orders'
		  AND tc.CONSTRAINT_TYPE = 'FOREIGN KEY'
	`).Scan(&fks)

	if len(fks) == 0 {
		fmt.Println("   ✅ No hay foreign keys en orders. Nada que eliminar.")
		printFinal()
		return
	}

	fmt.Printf("   Foreign keys encontrados: %d\n\n", len(fks))
	for _, fk := range fks {
		fmt.Printf("   • %-35s columna=%-15s → %s.%s\n",
			fk.ConstraintName, fk.ColumnName, fk.ReferencedTable, fk.ReferencedColumn)
	}

	// ─────────────────────────────────────────────────────────────────
	// PASO 2: Eliminar todos los FKs de orders
	// ─────────────────────────────────────────────────────────────────
	printStep(2, 3, "ELIMINANDO FOREIGN KEYS")

	for _, fk := range fks {
		fmt.Printf("   → DROP FOREIGN KEY `%s` ... ", fk.ConstraintName)
		sql := fmt.Sprintf(
			"ALTER TABLE orders DROP FOREIGN KEY `%s`",
			fk.ConstraintName,
		)
		if err := config.DB.Exec(sql).Error; err != nil {
			fmt.Printf("❌ ERROR: %v\n", err)
			log.Fatalf("Abortando: %v", err)
		}
		fmt.Println("✅")
	}

	// ─────────────────────────────────────────────────────────────────
	// PASO 3: Verificación
	// ─────────────────────────────────────────────────────────────────
	printStep(3, 3, "VERIFICACIÓN FINAL")
	printFinal()
}

func printFinal() {
	var remaining []struct{ ConstraintName string }
	config.DB.Raw(`
		SELECT kcu.CONSTRAINT_NAME
		FROM information_schema.KEY_COLUMN_USAGE kcu
		JOIN information_schema.TABLE_CONSTRAINTS tc
		  ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
		 AND tc.TABLE_SCHEMA    = kcu.TABLE_SCHEMA
		 AND tc.TABLE_NAME      = kcu.TABLE_NAME
		WHERE kcu.TABLE_SCHEMA   = DATABASE()
		  AND kcu.TABLE_NAME     = 'orders'
		  AND tc.CONSTRAINT_TYPE = 'FOREIGN KEY'
	`).Scan(&remaining)

	if len(remaining) == 0 {
		fmt.Println("   ✅ orders no tiene foreign keys — pedidos manuales funcionarán correctamente")
	} else {
		fmt.Printf("   ⚠️  Quedan %d foreign key(s):\n", len(remaining))
		for _, r := range remaining {
			fmt.Printf("      • %s\n", r.ConstraintName)
		}
	}

	fmt.Println()
	fmt.Println("═══════════════════════════════════════════════════════════════")
	fmt.Println("✅ LISTO — reinicia el servidor Go con: go run main.go")
	fmt.Println("═══════════════════════════════════════════════════════════════")
	fmt.Println()
}

func printStep(n, total int, title string) {
	fmt.Printf("\n%s\n", strings.Repeat("─", 65))
	fmt.Printf("PASO %d/%d: %s\n", n, total, title)
	fmt.Println(strings.Repeat("─", 65))
}
