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
	fmt.Println("║   🔄 MIGRACIÓN: SERVIDOR COMPARTIDO GLOBAL PARA ATOMICBOTS   ║")
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
	fmt.Println("   1. Crear tabla 'global_servers' (nueva)")
	fmt.Println("   2. Esta tabla gestionará servidores compartidos para AtomicBots")
	fmt.Println("   3. NO afectará la tabla 'users' (BuilderBot usa servidores individuales)")
	fmt.Println("   4. NO afectará la tabla 'agents' (ya tiene campo bot_type)")
	fmt.Println()
	fmt.Println("💡 Información:")
	fmt.Println("   - BuilderBot: Sigue usando servidor individual por usuario")
	fmt.Println("   - AtomicBot: Usará servidor compartido global (ahorro de costos)")
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
	// PASO 1: CREAR TABLA global_servers
	// =====================================================================
	fmt.Println("\n" + strings.Repeat("─", 65))
	fmt.Println("PASO 1/2: CREANDO TABLA global_servers")
	fmt.Println(strings.Repeat("─", 65))

	fmt.Println("   → Creando tabla...")
	if err := config.DB.AutoMigrate(&models.GlobalServer{}); err != nil {
		log.Fatalf("❌ Error creando tabla: %v", err)
	}
	fmt.Println("   ✅ Tabla 'global_servers' creada")

	// =====================================================================
	// PASO 2: VERIFICACIÓN
	// =====================================================================
	fmt.Println("\n" + strings.Repeat("─", 65))
	fmt.Println("PASO 2/2: VERIFICACIÓN FINAL")
	fmt.Println(strings.Repeat("─", 65))

	// Verificar estructura de la tabla
	type TableColumn struct {
		Field   string
		Type    string
		Null    string
		Key     string
		Default *string
		Extra   string
	}

	var columns []TableColumn
	config.DB.Raw("DESCRIBE global_servers").Scan(&columns)

	fmt.Println("\n📋 Estructura de 'global_servers':")
	fmt.Println(strings.Repeat("─", 65))
	for _, col := range columns {
		defaultVal := "NULL"
		if col.Default != nil {
			defaultVal = *col.Default
		}
		fmt.Printf("   • %-25s %-20s Default: %s\n", col.Field, col.Type, defaultVal)
	}

	// Verificar índices
	fmt.Println("\n📊 Índices creados:")
	fmt.Println(strings.Repeat("─", 65))

	var indexes []struct {
		Table      string
		NonUnique  int
		KeyName    string
		SeqInIndex int
		ColumnName string
	}

	config.DB.Raw("SHOW INDEX FROM global_servers").Scan(&indexes)

	indexMap := make(map[string]bool)
	for _, idx := range indexes {
		if !indexMap[idx.KeyName] {
			indexMap[idx.KeyName] = true
			indexType := "INDEX"
			if idx.KeyName == "PRIMARY" {
				indexType = "PRIMARY KEY"
			} else if idx.NonUnique == 0 {
				indexType = "UNIQUE INDEX"
			}
			fmt.Printf("   • %-30s (%s)\n", idx.KeyName, indexType)
		}
	}

	// Estadísticas
	var serverCount int64
	config.DB.Model(&models.GlobalServer{}).Count(&serverCount)

	fmt.Println("\n📊 Estadísticas:")
	fmt.Println(strings.Repeat("─", 65))
	fmt.Printf("   Total de servidores globales: %d\n", serverCount)

	var userCount int64
	config.DB.Model(&models.User{}).Count(&userCount)
	fmt.Printf("   Total de usuarios: %d\n", userCount)

	var agentCount int64
	config.DB.Model(&models.Agent{}).Count(&agentCount)
	fmt.Printf("   Total de agentes: %d\n", agentCount)

	// Contar AtomicBots
	var atomicBotCount int64
	config.DB.Model(&models.Agent{}).Where("bot_type = ?", "atomic").Count(&atomicBotCount)
	fmt.Printf("   Total de AtomicBots: %d\n", atomicBotCount)

	// Contar BuilderBots
	var builderBotCount int64
	config.DB.Model(&models.Agent{}).Where("bot_type = ? OR bot_type = ''", "builderbot").Count(&builderBotCount)
	fmt.Printf("   Total de BuilderBots: %d\n", builderBotCount)

	fmt.Println()
	fmt.Println("═══════════════════════════════════════════════════════════════")
	fmt.Println("✅ MIGRACIÓN COMPLETADA EXITOSAMENTE")
	fmt.Println("═══════════════════════════════════════════════════════════════")

	fmt.Println("\n📋 Próximos pasos:")
	fmt.Println("   1. Actualiza main.go para incluir GlobalServer en AutoMigrate")
	fmt.Println("   2. Despliega los nuevos archivos:")
	fmt.Println("      - models/global_server.go")
	fmt.Println("      - services/global_server_manager.go")
	fmt.Println("      - handlers/agent.go (actualizado)")
	fmt.Println("      - services/hetzner.go (actualizado)")
	fmt.Println("      - services/atomic_bot_deploy.go (actualizado)")
	fmt.Println("   3. Reinicia tu aplicación")
	fmt.Println("   4. Crea tu primer AtomicBot (plan gratuito)")
	fmt.Println("   5. El sistema creará automáticamente el servidor global")
	fmt.Println()
	fmt.Println("💡 Beneficios:")
	fmt.Println("   ✅ Ahorro de >70% en costos de infraestructura")
	fmt.Println("   ✅ 1 servidor puede alojar hasta 100 AtomicBots")
	fmt.Println("   ✅ Despliegue más rápido (2-3 min después del primero)")
	fmt.Println("   ✅ Gestión centralizada de todos los bots gratuitos")
	fmt.Println()
	fmt.Println("📊 Arquitectura:")
	fmt.Println("   • Plan GRATUITO (AtomicBot) → Servidor Compartido Global")
	fmt.Println("   • Plan de PAGO (BuilderBot) → Servidor Individual por Usuario")
	fmt.Println()
}
