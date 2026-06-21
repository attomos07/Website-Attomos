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
	fmt.Println("║     ➕ MIGRACIÓN: AGREGAR COLUMNA business_size              ║")
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
	fmt.Println("   1. Agregar columna 'business_size' a tabla 'users'")
	fmt.Println("   2. Crear índice para búsquedas optimizadas")
	fmt.Println("   3. (Opcional) Actualizar registros existentes")
	fmt.Println()
	fmt.Println("💡 Valores válidos para business_size:")
	fmt.Println("   • microempresa - Microempresa (1-10 empleados)")
	fmt.Println("   • pequena      - Pequeña Empresa (11-50 empleados)")
	fmt.Println("   • mediana      - Mediana Empresa (51-250 empleados)")
	fmt.Println("   • grande       - Gran Empresa (250+ empleados)")
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
	// PASO 1: VERIFICAR SI LA COLUMNA YA EXISTE
	// =====================================================================
	fmt.Println("\n" + strings.Repeat("─", 65))
	fmt.Println("PASO 1/4: VERIFICANDO ESTRUCTURA ACTUAL")
	fmt.Println(strings.Repeat("─", 65))

	if columnExists("business_size", "users") {
		fmt.Println("⚠️  La columna 'business_size' ya existe en la tabla users")
		fmt.Print("\n¿Deseas continuar de todos modos? (escribe 'SI' para continuar): ")

		confirmation2, _ := reader.ReadString('\n')
		confirmation2 = strings.TrimSpace(strings.ToUpper(confirmation2))

		if confirmation2 != "SI" {
			fmt.Println("❌ Migración cancelada")
			return
		}
	} else {
		fmt.Println("✅ Columna 'business_size' no existe - procederemos a crearla")
	}

	// =====================================================================
	// PASO 2: AGREGAR COLUMNA business_size
	// =====================================================================
	fmt.Println("\n" + strings.Repeat("─", 65))
	fmt.Println("PASO 2/4: AGREGANDO COLUMNA business_size")
	fmt.Println(strings.Repeat("─", 65))

	if !columnExists("business_size", "users") {
		fmt.Println("   → Agregando columna business_size...")

		// Agregar columna después de business_type
		alterSQL := `
			ALTER TABLE users 
			ADD COLUMN business_size VARCHAR(50) DEFAULT '' 
			AFTER business_type
		`

		if err := config.DB.Exec(alterSQL).Error; err != nil {
			log.Fatalf("❌ Error agregando columna: %v", err)
		}

		fmt.Println("   ✅ Columna 'business_size' agregada exitosamente")
	} else {
		fmt.Println("   ⏭️  Columna ya existe (saltando)")
	}

	// =====================================================================
	// PASO 3: CREAR ÍNDICE
	// =====================================================================
	fmt.Println("\n" + strings.Repeat("─", 65))
	fmt.Println("PASO 3/4: CREANDO ÍNDICE")
	fmt.Println(strings.Repeat("─", 65))

	if !indexExists("idx_users_business_size", "users") {
		fmt.Println("   → Creando índice idx_users_business_size...")

		indexSQL := `CREATE INDEX idx_users_business_size ON users(business_size)`

		if err := config.DB.Exec(indexSQL).Error; err != nil {
			log.Printf("⚠️  Error creando índice: %v", err)
		} else {
			fmt.Println("   ✅ Índice creado exitosamente")
		}
	} else {
		fmt.Println("   ⏭️  Índice ya existe (saltando)")
	}

	// =====================================================================
	// PASO 4: ACTUALIZAR REGISTROS EXISTENTES (OPCIONAL)
	// =====================================================================
	fmt.Println("\n" + strings.Repeat("─", 65))
	fmt.Println("PASO 4/4: ACTUALIZAR REGISTROS EXISTENTES")
	fmt.Println(strings.Repeat("─", 65))

	// Contar usuarios sin business_size
	var usersWithoutSize int64
	config.DB.Model(&models.User{}).Where("business_size = '' OR business_size IS NULL").Count(&usersWithoutSize)

	if usersWithoutSize > 0 {
		fmt.Printf("\n   📊 Encontrados %d usuarios sin tamaño de empresa definido\n", usersWithoutSize)
		fmt.Print("\n   ¿Deseas asignarles 'microempresa' por defecto? (escribe 'SI' para continuar): ")

		confirmation3, _ := reader.ReadString('\n')
		confirmation3 = strings.TrimSpace(strings.ToUpper(confirmation3))

		if confirmation3 == "SI" {
			fmt.Println("\n   → Actualizando usuarios existentes...")

			updateSQL := `
				UPDATE users 
				SET business_size = 'microempresa' 
				WHERE business_size = '' OR business_size IS NULL
			`

			if err := config.DB.Exec(updateSQL).Error; err != nil {
				log.Printf("⚠️  Error actualizando usuarios: %v", err)
			} else {
				fmt.Printf("   ✅ %d usuarios actualizados con 'microempresa'\n", usersWithoutSize)
			}
		} else {
			fmt.Println("   ⏭️  Actualización de usuarios omitida")
		}
	} else {
		fmt.Println("   ℹ️  No hay usuarios que necesiten actualización")
	}

	// =====================================================================
	// VERIFICACIÓN FINAL
	// =====================================================================
	fmt.Println("\n" + strings.Repeat("─", 65))
	fmt.Println("VERIFICACIÓN FINAL")
	fmt.Println(strings.Repeat("─", 65))

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

	// Verificar que business_size existe
	hasBusinessSize := false
	for _, col := range userColumns {
		if col.Field == "business_size" {
			hasBusinessSize = true
			fmt.Printf("   ✅ Columna encontrada: %s (%s)\n", col.Field, col.Type)
			break
		}
	}

	if !hasBusinessSize {
		fmt.Println("   ❌ Error: Columna business_size no encontrada después de la migración")
	}

	// Verificar índice
	if indexExists("idx_users_business_size", "users") {
		fmt.Println("   ✅ Índice encontrado: idx_users_business_size")
	}

	// Estadísticas
	var totalUsers int64
	config.DB.Model(&models.User{}).Count(&totalUsers)

	var usersWithSize int64
	config.DB.Model(&models.User{}).Where("business_size != '' AND business_size IS NOT NULL").Count(&usersWithSize)

	fmt.Printf("\n   📊 Estadísticas:\n")
	fmt.Printf("      • Total de usuarios: %d\n", totalUsers)
	fmt.Printf("      • Usuarios con tamaño definido: %d\n", usersWithSize)
	fmt.Printf("      • Usuarios sin tamaño: %d\n", totalUsers-usersWithSize)

	// Resumen por tamaño
	fmt.Println("\n   📊 Distribución por tamaño de empresa:")

	sizes := []struct {
		Name  string
		Value string
	}{
		{"Microempresas", "microempresa"},
		{"Pequeñas", "pequena"},
		{"Medianas", "mediana"},
		{"Grandes", "grande"},
	}

	for _, size := range sizes {
		var count int64
		config.DB.Model(&models.User{}).Where("business_size = ?", size.Value).Count(&count)
		if count > 0 {
			fmt.Printf("      • %s: %d\n", size.Name, count)
		}
	}

	fmt.Println()
	fmt.Println("═══════════════════════════════════════════════════════════════")
	fmt.Println("✅ MIGRACIÓN COMPLETADA EXITOSAMENTE")
	fmt.Println("═══════════════════════════════════════════════════════════════")

	fmt.Println("\n📋 Próximos pasos:")
	fmt.Println("   1. Actualizar models/user.go - Agregar campo BusinessSize")
	fmt.Println("   2. Actualizar handlers/auth.go - Agregar BusinessSize en RegisterRequest")
	fmt.Println("   3. Actualizar templates/auth/register.html - Agregar select de tamaño")
	fmt.Println("   4. Actualizar static/js/auth/register.js - Agregar validación")
	fmt.Println("   5. Reiniciar la aplicación")
	fmt.Println()
	fmt.Println("💡 Valores válidos para business_size:")
	fmt.Println("   • microempresa - Microempresa (1-10 empleados)")
	fmt.Println("   • pequena      - Pequeña Empresa (11-50 empleados)")
	fmt.Println("   • mediana      - Mediana Empresa (51-250 empleados)")
	fmt.Println("   • grande       - Gran Empresa (250+ empleados)")
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
