package main

import (
	"attomos/services" // Ajusta esta ruta si el paquete services está en una ubicación diferente (ej: github.com/tuusuario/attomos/services)
	"fmt"
)

func main() {
	// Reemplaza estos valores con los reales de tu servidor
	serverIP := "78.47.16.46"                // Ejemplo: "192.168.1.100" o la IP de Hetzner donde está Chatwoot
	userID := uint(1)                        // Ejemplo: el ID del usuario (uint), como en tu config
	serverPassword := "PmFkscTqfCEtvWNEUfL7" // Ejemplo: la contraseña para SSH como root en el servidor

	// Crea la instancia de ChatwootService
	chatwootService := services.NewChatwootService(serverIP, userID, serverPassword)

	// Ejecuta la investigación de onboarding
	err := chatwootService.InvestigateChatwootOnboarding()
	if err != nil {
		fmt.Printf("Error durante la investigación: %v\n", err)
	} else {
		fmt.Println("Investigación completada exitosamente. Revisa la salida en la consola para detalles.")
	}
}
