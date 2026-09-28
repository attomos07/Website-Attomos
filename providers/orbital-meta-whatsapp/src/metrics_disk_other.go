//go:build !linux

package src

// diskFreeGB (no-Linux) — stub para poder compilar en tu máquina de
// desarrollo (ej. Windows). El bot en producción siempre corre en Linux,
// así que ahí se usa la implementación real de metrics_disk_linux.go — este
// stub nunca se ejecuta fuera de desarrollo local.
func diskFreeGB(path string) float64 {
	return 0
}
