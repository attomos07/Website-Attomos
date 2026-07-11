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
	fmt.Println("🔄 Migración: Servidor Compartido por Usuario")
	fmt.Println("================================================\n")

	// Cargar variables de entorno
	if err := godotenv.Load(); err != nil {
		log.Println("⚠️  Advertencia: No se encontró archivo .env")
	}

	// Conectar a la base de datos
	fmt.Println("📡 Conectando a la base de datos...")
	config.ConnectDatabase()
	fmt.Println("✅ Conectado a la base de datos\n")

	fmt.Println("⚠️  IMPORTANTE:")
	fmt.Println("   - Esta migración modificará la estructura de las tablas")
	fmt.Println("   - Se agregarán columnas para servidor compartido en users")
	fmt.Println("   - Se eliminarán columnas individuales de servidor en agents")
	fmt.Println("   - Se agregarán columnas de puerto y estado de despliegue en agents")
	fmt.Println()
	fmt.Print("¿Continuar? (s/n): ")

	reader := bufio.NewReader(os.Stdin)
	confirmation, _ := reader.ReadString('\n')
	confirmation = strings.TrimSpace(strings.ToLower(confirmation))

	if confirmation != "s" && confirmation != "si" {
		fmt.Println("❌ Migración cancelada")
		return
	}

	fmt.Println()
	fmt.Println("📝 Ejecutando migración SQL...")

	// PASO 1: Agregar columnas a users para servidor compartido
	fmt.Println("   → Agregando columnas de servidor compartido a 'users'...")

	migrations := []string{
		// Agregar columnas de servidor compartido a users
		"ALTER TABLE users ADD COLUMN IF NOT EXISTS shared_server_id INT DEFAULT 0",
		"ALTER TABLE users ADD COLUMN IF NOT EXISTS shared_server_ip VARCHAR(50) DEFAULT ''",
		"ALTER TABLE users ADD COLUMN IF NOT EXISTS shared_server_password VARCHAR(255) DEFAULT ''",
		"ALTER TABLE users ADD COLUMN IF NOT EXISTS shared_server_status VARCHAR(50) DEFAULT 'pending'",

		// Eliminar columnas viejas de agents (si existen)
		"ALTER TABLE agents DROP COLUMN IF EXISTS server_id",
		"ALTER TABLE agents DROP COLUMN IF EXISTS server_ip",
		"ALTER TABLE agents DROP COLUMN IF EXISTS server_status",

		// Agregar nuevas columnas a agents
		"ALTER TABLE agents ADD COLUMN IF NOT EXISTS port INT DEFAULT 0",
		"ALTER TABLE agents ADD COLUMN IF NOT EXISTS deploy_status VARCHAR(50) DEFAULT 'pending'",

		// Crear índices para mejor rendimiento
		"CREATE INDEX IF NOT EXISTS idx_agents_user_id ON agents(user_id)",
		"CREATE INDEX IF NOT EXISTS idx_agents_deploy_status ON agents(deploy_status)",
		"CREATE INDEX IF NOT EXISTS idx_users_shared_server_status ON users(shared_server_status)",
	}

	for _, migration := range migrations {
		if err := config.DB.Exec(migration).Error; err != nil {
			log.Printf("⚠️  Error ejecutando: %s\n   Error: %v", migration, err)
		}
	}

	fmt.Println("   ✅ Estructura actualizada")
	fmt.Println()

	// PASO 2: Verificar resultados
	fmt.Println("🔍 Verificando migración...")

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

	var agentColumns []TableColumn
	config.DB.Raw("DESCRIBE agents").Scan(&agentColumns)

	// Verificar columnas nuevas en users
	hasSharedServer := false
	for _, col := range userColumns {
		if col.Field == "shared_server_id" {
			hasSharedServer = true
			break
		}
	}

	// Verificar columnas nuevas en agents
	hasPort := false
	for _, col := range agentColumns {
		if col.Field == "port" {
			hasPort = true
			break
		}
	}

	if hasSharedServer && hasPort {
		fmt.Println("   ✅ Todas las columnas nuevas verificadas")
	} else {
		fmt.Println("   ⚠️  Algunas columnas pueden no haberse creado correctamente")
	}

	fmt.Println()

	// PASO 3: Mostrar estadísticas
	fmt.Println("📊 Estadísticas actuales:")

	var userCount int64
	config.DB.Model(&models.User{}).Count(&userCount)
	fmt.Printf("   📊 Total de usuarios: %d\n", userCount)

	var agentCount int64
	config.DB.Model(&models.Agent{}).Count(&agentCount)
	fmt.Printf("   📊 Total de agentes: %d\n", agentCount)

	fmt.Println()
	fmt.Println("🎉 Migración completada!")
	fmt.Println()
	fmt.Println("📋 Próximos pasos:")
	fmt.Println("   1. Revisa la estructura de las tablas")
	fmt.Println("   2. Los servidores existentes deben eliminarse manualmente de Hetzner")
	fmt.Println("   3. Reinicia tu aplicación")
	fmt.Println("   4. Los nuevos agentes usarán el servidor compartido")
	fmt.Println()
	fmt.Println("💡 Nota:")
	fmt.Println("   - Cada usuario tendrá UN servidor compartido")
	fmt.Println("   - Todos sus agentes se desplegarán en puertos diferentes (3001, 3002, 3003...)")
	fmt.Println("   - Esto reduce costos y mejora la eficiencia")
}
