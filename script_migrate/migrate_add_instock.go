//go:build ignore
// +build ignore

package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"

	"attomos/config"

	"github.com/joho/godotenv"
)

func main() {
	fmt.Println("╔═══════════════════════════════════════════════════════════════╗")
	fmt.Println("║     📦 MIGRACIÓN: AGREGAR inStock A SERVICIOS                ║")
	fmt.Println("╚═══════════════════════════════════════════════════════════════╝")
	fmt.Println()

	if err := godotenv.Load(); err != nil {
		log.Println("⚠️  Advertencia: No se encontró archivo .env")
	}

	fmt.Println("📡 Conectando a la base de datos...")
	config.ConnectDatabase()
	fmt.Println("✅ Conectado\n")

	fmt.Println("📋 Esta migración hará lo siguiente:")
	fmt.Println("   1. Leer todos los registros de my_business_info")
	fmt.Println("   2. Agregar el campo 'inStock: true' a cada servicio que no lo tenga")
	fmt.Println("   3. Guardar los registros actualizados")
	fmt.Println()
	fmt.Println("   ℹ️  Motivo: se agregó el campo InStock a BranchService.")
	fmt.Println("      Los registros existentes no tienen ese campo en el JSON,")
	fmt.Println("      esta migración lo agrega con valor true (en existencia).")
	fmt.Println()
	fmt.Print("¿Continuar? (escribe 'SI' para continuar): ")

	reader := bufio.NewReader(os.Stdin)
	confirm, _ := reader.ReadString('\n')
	if strings.TrimSpace(strings.ToUpper(confirm)) != "SI" {
		fmt.Println("❌ Migración cancelada")
		return
	}

	// ─────────────────────────────────────────────────────────────────
	// PASO 1: Leer todos los registros
	// ─────────────────────────────────────────────────────────────────
	printStep(1, 3, "LEYENDO REGISTROS DE my_business_info")

	type RawRow struct {
		ID       uint
		Services []byte
	}

	var rows []RawRow
	if err := config.DB.Raw("SELECT id, services FROM my_business_info WHERE services IS NOT NULL AND services != '[]' AND services != 'null'").
		Scan(&rows).Error; err != nil {
		log.Fatalf("❌ Error leyendo registros: %v", err)
	}

	fmt.Printf("   Registros encontrados: %d\n", len(rows))

	if len(rows) == 0 {
		fmt.Println("   ✅ No hay registros con servicios. Nada que migrar.")
		printFinal(0)
		return
	}

	// ─────────────────────────────────────────────────────────────────
	// PASO 2: Agregar inStock a cada servicio
	// ─────────────────────────────────────────────────────────────────
	printStep(2, 3, "ACTUALIZANDO SERVICIOS")

	updated := 0
	skipped := 0

	for _, row := range rows {
		// Parsear el JSON de servicios como array de mapas genéricos
		var services []map[string]interface{}
		if err := json.Unmarshal(row.Services, &services); err != nil {
			fmt.Printf("   ⚠️  ID=%d: error parseando JSON (%v), saltando\n", row.ID, err)
			skipped++
			continue
		}

		needsUpdate := false
		for i, svc := range services {
			if _, exists := svc["inStock"]; !exists {
				services[i]["inStock"] = true
				needsUpdate = true
			}
		}

		if !needsUpdate {
			fmt.Printf("   ✅ ID=%d: ya tiene inStock — saltando\n", row.ID)
			skipped++
			continue
		}

		newJSON, err := json.Marshal(services)
		if err != nil {
			fmt.Printf("   ⚠️  ID=%d: error serializando JSON (%v), saltando\n", row.ID, err)
			skipped++
			continue
		}

		if err := config.DB.Exec(
			"UPDATE my_business_info SET services = ? WHERE id = ?",
			string(newJSON), row.ID,
		).Error; err != nil {
			fmt.Printf("   ❌ ID=%d: error actualizando (%v)\n", row.ID, err)
			skipped++
			continue
		}

		fmt.Printf("   ✅ ID=%d: %d servicio(s) actualizados\n", row.ID, len(services))
		updated++
	}

	// ─────────────────────────────────────────────────────────────────
	// PASO 3: Verificación
	// ─────────────────────────────────────────────────────────────────
	printStep(3, 3, "VERIFICACIÓN FINAL")
	printFinal(updated)

	fmt.Printf("   Actualizados: %d\n", updated)
	fmt.Printf("   Saltados:     %d\n", skipped)
}

func printFinal(updated int) {
	fmt.Println()
	fmt.Println("═══════════════════════════════════════════════════════════════")
	if updated > 0 {
		fmt.Printf("✅ LISTO — %d registros migrados correctamente\n", updated)
	} else {
		fmt.Println("✅ LISTO — no fue necesario actualizar ningún registro")
	}
	fmt.Println("   Reinicia el servidor Go con: go run main.go")
	fmt.Println("═══════════════════════════════════════════════════════════════")
	fmt.Println()
}

func printStep(n, total int, title string) {
	fmt.Printf("\n%s\n", strings.Repeat("─", 65))
	fmt.Printf("PASO %d/%d: %s\n", n, total, title)
	fmt.Println(strings.Repeat("─", 65))
}
