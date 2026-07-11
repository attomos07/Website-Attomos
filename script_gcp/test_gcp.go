package main

import (
	"fmt"
	"log"
	"os"

	"attomos/services"

	"github.com/joho/godotenv"
)

func main() {
	fmt.Println("🧪 Test de Google Cloud Automation")
	fmt.Println("=====================================\n")

	// Cargar variables de entorno
	if err := godotenv.Load(); err != nil {
		log.Println("⚠️  Advertencia: No se encontró archivo .env")
	}

	// Verificar variables de entorno
	fmt.Println("📋 Verificando variables de entorno...")

	orgID := os.Getenv("GCP_ORGANIZATION_ID")
	billingID := os.Getenv("GCP_BILLING_ACCOUNT_ID")
	jsonCred := os.Getenv("GCP_SERVICE_ACCOUNT_JSON")
	pathCred := os.Getenv("GCP_SERVICE_ACCOUNT_PATH")

	if orgID == "" {
		log.Fatal("❌ Falta variable: GCP_ORGANIZATION_ID")
	}
	fmt.Printf("✅ Organization ID: %s\n", orgID)

	if billingID == "" {
		log.Fatal("❌ Falta variable: GCP_BILLING_ACCOUNT_ID")
	}
	fmt.Printf("✅ Billing Account ID: %s\n", billingID)

	if jsonCred != "" {
		fmt.Printf("✅ Credenciales desde variable de entorno (JSON, %d chars)\n", len(jsonCred))
	} else if pathCred != "" {
		fmt.Printf("✅ Credenciales desde archivo: %s\n", pathCred)
	} else {
		log.Fatal("❌ Falta credenciales (GCP_SERVICE_ACCOUNT_JSON o GCP_SERVICE_ACCOUNT_PATH)")
	}

	fmt.Println("\n🔄 Inicializando Google Cloud Automation...")

	// Inicializar servicio
	gca, err := services.NewGoogleCloudAutomation()
	if err != nil {
		log.Fatalf("❌ Error inicializando: %v", err)
	}

	fmt.Println("✅ Conexión exitosa a Google Cloud!")
	fmt.Println("\n📊 Información:")
	fmt.Printf("   Organization: %s\n", orgID)
	fmt.Printf("   Billing Account: %s\n", billingID)
	fmt.Println("\n🎉 Todo está configurado correctamente!")
	fmt.Println("\n💡 Siguiente paso:")
	fmt.Println("   1. Ejecuta tu backend: go run main.go")
	fmt.Println("   2. Registra un usuario de prueba")
	fmt.Println("   3. Observa los logs de creación del proyecto")

	// Test opcional: crear un proyecto de prueba
	fmt.Println("\n❓ ¿Quieres crear un proyecto de prueba? (y/n)")
	var response string
	fmt.Scanln(&response)

	if response == "y" || response == "Y" {
		fmt.Println("\n🚀 Creando proyecto de prueba...")

		projectID, apiKey, err := gca.CreateProjectForUser(999, "test@example.com")
		if err != nil {
			log.Fatalf("❌ Error creando proyecto de prueba: %v", err)
		}

		fmt.Println("\n🎉 ¡Proyecto de prueba creado exitosamente!")
		fmt.Printf("   Project ID: %s\n", projectID)
		fmt.Printf("   API Key: %s...\n", apiKey[:20])
		fmt.Println("\n⚠️  IMPORTANTE: Elimina este proyecto manualmente desde Google Cloud Console")
		fmt.Printf("   URL: https://console.cloud.google.com/home/dashboard?project=%s\n", projectID)
	}
}
