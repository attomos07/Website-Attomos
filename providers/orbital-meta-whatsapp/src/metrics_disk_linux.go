//go:build linux

package src

import "syscall"

// diskFreeGB (Linux) regresa el espacio libre en disco real del servidor
// donde corre este proceso.
func diskFreeGB(path string) float64 {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(path, &stat); err != nil {
		return 0
	}
	freeBytes := stat.Bavail * uint64(stat.Bsize)
	return float64(freeBytes) / (1024 * 1024 * 1024)
}
