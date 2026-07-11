package main

import (
	"bufio"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"attomos/config"
	"attomos/models"

	"github.com/joho/godotenv"
)

func main() {
	fmt.Println("╔═══════════════════════════════════════════════════════════════╗")
	fmt.Println("║   🔄 MIGRACIÓN: GCP A TABLA google_cloud_projects            ║")
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
	fmt.Println("   1. Crear tabla 'google_cloud_projects'")
	fmt.Println("   2. Migrar datos de GCP desde 'users' a la nueva tabla")
	fmt.Println("   3. Eliminar columnas antiguas de 'users':")
	fmt.Println("      ❌ gcp_project_id")
	fmt.Println("      ❌ gemini_api_key")
	fmt.Println("      ❌ project_status")
	fmt.Println()
	fmt.Println("⚠️  IMPORTANTE: Haz backup de tu base de datos antes de continuar")
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
	// PASO 1: CREAR TABLA google_cloud_projects
	// =====================================================================
	fmt.Println("\n" + strings.Repeat("─", 65))
	fmt.Println("PASO 1/3: CREANDO TABLA google_cloud_projects")
	fmt.Println(strings.Repeat("─", 65))

	fmt.Println("   → Creando tabla...")
	if err := config.DB.AutoMigrate(&models.GoogleCloudProject{}); err != nil {
		log.Fatalf("❌ Error creando tabla: %v", err)
	}
	fmt.Println("   ✅ Tabla 'google_cloud_projects' creada")

	// =====================================================================
	// PASO 2: MIGRAR DATOS DE users A google_cloud_projects
	// =====================================================================
	fmt.Println("\n" + strings.Repeat("─", 65))
	fmt.Println("PASO 2/3: MIGRANDO DATOS DE USUARIOS")
	fmt.Println(strings.Repeat("─", 65))

	// Estructura temporal para leer datos antiguos
	type OldUserData struct {
		ID            uint
		Email         string
		GCPProjectID  *string `gorm:"column:gcp_project_id"`
		GeminiAPIKey  string  `gorm:"column:gemini_api_key"`
		ProjectStatus string  `gorm:"column:project_status"`
	}

	var oldUsers []OldUserData
	if err := config.DB.Table("users").Find(&oldUsers).Error; err != nil {
		log.Fatalf("❌ Error obteniendo usuarios: %v", err)
	}

	fmt.Printf("   📊 Total de usuarios a procesar: %d\n\n", len(oldUsers))

	migratedCount := 0
	skippedCount := 0
	errorCount := 0

	for _, oldUser := range oldUsers {
		// Solo migrar si tiene datos de GCP
		if oldUser.GCPProjectID == nil || *oldUser.GCPProjectID == "" {
			fmt.Printf("   ⏭️  Usuario %d: Sin proyecto GCP (saltando)\n", oldUser.ID)
			skippedCount++
			continue
		}

		fmt.Printf("   🔄 Migrando usuario %d (%s)...", oldUser.ID, oldUser.Email)

		// Verificar si ya existe el proyecto
		var existingProject models.GoogleCloudProject
		if err := config.DB.Where("user_id = ?", oldUser.ID).First(&existingProject).Error; err == nil {
			fmt.Printf(" ⏭️  Ya existe\n")
			skippedCount++
			continue
		}

		// Crear nuevo registro
		now := time.Now()
		gcpProject := models.GoogleCloudProject{
			UserID:         oldUser.ID,
			ProjectID:      *oldUser.GCPProjectID,
			ProjectName:    fmt.Sprintf("Attomos User %d", oldUser.ID),
			ProjectStatus:  oldUser.ProjectStatus,
			GeminiAPIKey:   oldUser.GeminiAPIKey,
			OrganizationID: os.Getenv("GCP_ORGANIZATION_ID"),
			Location:       "global",
			GCPCreatedAt:   &now,
		}

		// Si el proyecto está listo, marcarlo como tal
		if oldUser.ProjectStatus == "ready" {
			gcpProject.MarkAsReady()
		}

		// Guardar en BD
		if err := config.DB.Create(&gcpProject).Error; err != nil {
			fmt.Printf(" ❌ Error: %v\n", err)
			errorCount++
			continue
		}

		fmt.Printf(" ✅ Migrado\n")
		migratedCount++
	}

	fmt.Printf("\n   📊 Resumen de migración:\n")
	fmt.Printf("      ✅ Migrados: %d\n", migratedCount)
	fmt.Printf("      ⏭️  Saltados: %d\n", skippedCount)
	if errorCount > 0 {
		fmt.Printf("      ❌ Errores: %d\n", errorCount)
	}

	// =====================================================================
	// PASO 3: ELIMINAR COLUMNAS ANTIGUAS DE users
	// =====================================================================
	fmt.Println("\n" + strings.Repeat("─", 65))
	fmt.Println("PASO 3/3: ELIMINANDO COLUMNAS ANTIGUAS DE users")
	fmt.Println(strings.Repeat("─", 65))

	columnsToRemove := []string{
		"gcp_project_id",
		"gemini_api_key",
		"project_status",
	}

	for _, column := range columnsToRemove {
		fmt.Printf("   → Eliminando columna '%s'...", column)

		if !columnExists(column, "users") {
			fmt.Printf(" ⏭️  No existe\n")
			continue
		}

		dropSQL := fmt.Sprintf("ALTER TABLE users DROP COLUMN IF EXISTS %s", column)
		if err := config.DB.Exec(dropSQL).Error; err != nil {
			fmt.Printf(" ❌ Error: %v\n", err)
		} else {
			fmt.Printf(" ✅ Eliminada\n")
		}
	}

	// =====================================================================
	// VERIFICACIÓN FINAL
	// =====================================================================
	fmt.Println("\n" + strings.Repeat("─", 65))
	fmt.Println("VERIFICACIÓN FINAL")
	fmt.Println(strings.Repeat("─", 65))

	var projectCount int64
	config.DB.Model(&models.GoogleCloudProject{}).Count(&projectCount)
	fmt.Printf("   📊 Total proyectos GCP: %d\n", projectCount)

	var userCount int64
	config.DB.Model(&models.User{}).Count(&userCount)
	fmt.Printf("   📊 Total usuarios: %d\n", userCount)

	fmt.Println("\n═══════════════════════════════════════════════════════════════")
	fmt.Println("✅ MIGRACIÓN COMPLETADA EXITOSAMENTE")
	fmt.Println("═══════════════════════════════════════════════════════════════")

	fmt.Println("\n📋 Próximos pasos:")
	fmt.Println("   1. Verifica que la migración fue exitosa")
	fmt.Println("   2. Actualiza tu código para usar GoogleCloudProject")
	fmt.Println("   3. Reinicia tu aplicación")
	fmt.Println("   4. Prueba la creación de nuevos agentes")
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
