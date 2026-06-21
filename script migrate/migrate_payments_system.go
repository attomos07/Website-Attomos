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
	fmt.Println("║     🔄 MIGRACIÓN: SISTEMA DE PAGOS Y SUSCRIPCIONES           ║")
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

	fmt.Println("⚠️  IMPORTANTE:")
	fmt.Println("   Esta migración realizará los siguientes cambios:")
	fmt.Println("   1. Crear tabla 'subscriptions' (nueva)")
	fmt.Println("   2. Crear tabla 'payments' (nueva)")
	fmt.Println("   3. Migrar datos de 'users' a 'subscriptions'")
	fmt.Println("   4. Eliminar campos obsoletos de 'users'")
	fmt.Println()
	fmt.Println("   ⚠️  ADVERTENCIA: Este proceso es IRREVERSIBLE")
	fmt.Println("   ⚠️  Asegúrate de tener un BACKUP de tu base de datos")
	fmt.Println()
	fmt.Print("¿Continuar? (escribe 'SI CONFIRMO' para continuar): ")

	reader := bufio.NewReader(os.Stdin)
	confirmation, _ := reader.ReadString('\n')
	confirmation = strings.TrimSpace(confirmation)

	if confirmation != "SI CONFIRMO" {
		fmt.Println("❌ Migración cancelada")
		return
	}

	fmt.Println()
	fmt.Println("═══════════════════════════════════════════════════════════════")
	fmt.Println("INICIANDO MIGRACIÓN")
	fmt.Println("═══════════════════════════════════════════════════════════════")

	// =====================================================================
	// PASO 1: CREAR TABLAS NUEVAS
	// =====================================================================
	fmt.Println("\n" + strings.Repeat("─", 65))
	fmt.Println("PASO 1/4: CREANDO TABLAS NUEVAS")
	fmt.Println(strings.Repeat("─", 65))

	fmt.Println("   → Creando tabla 'subscriptions'...")
	if err := config.DB.AutoMigrate(&models.Subscription{}); err != nil {
		log.Fatalf("❌ Error creando tabla subscriptions: %v", err)
	}
	fmt.Println("   ✅ Tabla 'subscriptions' creada")

	fmt.Println("   → Creando tabla 'payments'...")
	if err := config.DB.AutoMigrate(&models.Payment{}); err != nil {
		log.Fatalf("❌ Error creando tabla payments: %v", err)
	}
	fmt.Println("   ✅ Tabla 'payments' creada")

	// =====================================================================
	// PASO 2: MIGRAR DATOS DE USERS A SUBSCRIPTIONS
	// =====================================================================
	fmt.Println("\n" + strings.Repeat("─", 65))
	fmt.Println("PASO 2/4: MIGRANDO DATOS DE USUARIOS")
	fmt.Println(strings.Repeat("─", 65))

	// Obtener todos los usuarios
	var users []models.User
	if err := config.DB.Find(&users).Error; err != nil {
		log.Fatalf("❌ Error obteniendo usuarios: %v", err)
	}

	fmt.Printf("   📊 Total de usuarios a migrar: %d\n\n", len(users))

	migratedCount := 0
	errorCount := 0

	for _, user := range users {
		fmt.Printf("   🔄 Migrando usuario ID=%d (%s)...", user.ID, user.Email)

		// Verificar si ya existe una suscripción para este usuario
		var existingSubscription models.Subscription
		if err := config.DB.Where("user_id = ?", user.ID).First(&existingSubscription).Error; err == nil {
			fmt.Printf(" ⏭️  Ya existe (saltando)\n")
			continue
		}

		// Crear nueva suscripción con plan gratuito por defecto
		now := time.Now()
		trialEnd := now.AddDate(0, 0, 30)

		subscription := models.Subscription{
			UserID:             user.ID,
			Plan:               "gratuito",
			Status:             "trialing",
			BillingCycle:       "monthly",
			Currency:           "mxn",
			TrialStart:         &now,
			TrialEnd:           &trialEnd,
			CurrentPeriodStart: &now,
			CurrentPeriodEnd:   &trialEnd,
		}

		// Configurar límites según el plan
		subscription.SetPlanLimits()

		// Guardar suscripción
		if err := config.DB.Create(&subscription).Error; err != nil {
			fmt.Printf(" ❌ Error: %v\n", err)
			errorCount++
			continue
		}

		fmt.Printf(" ✅ Migrado (plan gratuito con 30 días de prueba)\n")
		migratedCount++
	}

	fmt.Printf("\n   📊 Resumen de migración:\n")
	fmt.Printf("      ✅ Migrados exitosamente: %d\n", migratedCount)
	if errorCount > 0 {
		fmt.Printf("      ❌ Errores: %d\n", errorCount)
	}

	// =====================================================================
	// PASO 3: ELIMINAR COLUMNAS OBSOLETAS DE USERS
	// =====================================================================
	fmt.Println("\n" + strings.Repeat("─", 65))
	fmt.Println("PASO 3/4: LIMPIANDO TABLA USERS")
	fmt.Println(strings.Repeat("─", 65))

	columnsToRemove := []string{
		"stripe_customer_id",
		"stripe_subscription_id",
		"subscription_status",
		"subscription_plan",
		"current_period_end",
	}

	for _, column := range columnsToRemove {
		fmt.Printf("   → Eliminando columna '%s'...", column)

		// Verificar si la columna existe
		if !columnExists(column, "users") {
			fmt.Printf(" ⏭️  No existe (saltando)\n")
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
	// PASO 4: VERIFICACIÓN FINAL
	// =====================================================================
	fmt.Println("\n" + strings.Repeat("─", 65))
	fmt.Println("PASO 4/4: VERIFICACIÓN FINAL")
	fmt.Println(strings.Repeat("─", 65))

	// Verificar tablas
	var subscriptionCount int64
	config.DB.Model(&models.Subscription{}).Count(&subscriptionCount)
	fmt.Printf("   📊 Total de suscripciones: %d\n", subscriptionCount)

	var paymentCount int64
	config.DB.Model(&models.Payment{}).Count(&paymentCount)
	fmt.Printf("   📊 Total de pagos: %d\n", paymentCount)

	var userCount int64
	config.DB.Model(&models.User{}).Count(&userCount)
	fmt.Printf("   📊 Total de usuarios: %d\n", userCount)

	fmt.Println("\n═══════════════════════════════════════════════════════════════")
	fmt.Println("✅ MIGRACIÓN COMPLETADA EXITOSAMENTE")
	fmt.Println("═══════════════════════════════════════════════════════════════")

	fmt.Println("\n📋 Próximos pasos:")
	fmt.Println("   1. Actualiza models/user.go (eliminar campos obsoletos)")
	fmt.Println("   2. Actualiza handlers que usen subscriptionPlan, etc.")
	fmt.Println("   3. Prueba el sistema de suscripciones")
	fmt.Println("   4. Implementa la lógica de limits y usage tracking")
	fmt.Println()
	fmt.Println("💡 Estructura nueva:")
	fmt.Println("   • users: Solo datos del usuario")
	fmt.Println("   • subscriptions: Toda la info de suscripciones")
	fmt.Println("   • payments: Historial completo de pagos")
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
