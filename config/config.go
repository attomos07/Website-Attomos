package config

import "os"

// GetEnv obtiene una variable de entorno
func GetEnv(key string) string {
	return os.Getenv(key)
}

// GetEnvWithDefault obtiene una variable de entorno con valor por defecto
func GetEnvWithDefault(key, defaultValue string) string {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue
	}
	return value
}
