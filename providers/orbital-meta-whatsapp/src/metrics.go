package src

// metrics.go — recolecta métricas básicas de recursos de ESTE proceso (CPU%,
// memoria RSS real, goroutines, disco libre) y las manda periódicamente al
// backend por el mismo WebSocket del CRM bridge (crm_bridge.go) — sin abrir
// puertos nuevos, sin que el backend tenga que hacer SSH al servidor para
// consultarlas.
//
// Lectura directa de /proc — sin dependencias externas (gopsutil, etc.).
// Solo funciona en Linux, que es donde corre el bot en producción de todas
// formas.

import (
	"os"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

// BotMetrics es lo que se manda al backend — misma forma que
// handlers.BotMetrics del lado del backend (crm_hub.go). Si agregas un
// campo aquí, agrégalo también allá.
type BotMetrics struct {
	CPUPercent    float64 `json:"cpuPercent"`
	MemRSSMB      float64 `json:"memRssMb"`
	Goroutines    int     `json:"goroutines"`
	UptimeSeconds int64   `json:"uptimeSeconds"`
	DBSizeMB      float64 `json:"dbSizeMb"`
	DiskFreeGB    float64 `json:"diskFreeGb"`
}

const metricsReportInterval = 60 * time.Second

// clockTicksPerSec (USER_HZ) — 100 es el valor estándar en prácticamente
// todos los kernels Linux x86_64/arm64 modernos. Evita depender de
// cgo/sysconf solo para leer esto.
const clockTicksPerSec = 100.0

var (
	processStartTime = time.Now()

	cpuSampleMu    sync.Mutex
	lastCPUTicks   float64
	lastSampleTime time.Time
)

// StartMetricsReporting arranca el reporte periódico de métricas al
// backend. Llamar una vez desde main.go, después de InitCRMBridge().
func StartMetricsReporting() {
	go func() {
		// Primera muestra de CPU solo establece la base de comparación —
		// el primer % real sale hasta la siguiente vuelta del ticker.
		sampleCPUTicks()

		ticker := time.NewTicker(metricsReportInterval)
		defer ticker.Stop()
		for range ticker.C {
			NotifyMetrics(collectMetrics())
		}
	}()
}

func collectMetrics() BotMetrics {
	return BotMetrics{
		CPUPercent:    cpuPercent(),
		MemRSSMB:      memRSSMB(),
		Goroutines:    runtime.NumGoroutine(),
		UptimeSeconds: int64(time.Since(processStartTime).Seconds()),
		DBSizeMB:      0, // OrbitalBot no mantiene sesión local tipo whatsapp.db (usa Meta Cloud API)
		DiskFreeGB:    diskFreeGB("."),
	}
}

// sampleCPUTicks lee utime+stime de /proc/self/stat (tiempo de CPU
// acumulado, en "ticks") junto con la hora actual.
func sampleCPUTicks() (ticks float64, when time.Time) {
	when = time.Now()
	data, err := os.ReadFile("/proc/self/stat")
	if err != nil {
		return 0, when
	}
	// El campo 2 (comm) puede traer espacios si el nombre del proceso los
	// tiene — viene entre paréntesis. Cortamos justo después del ")" para
	// no descuadrar el índice de los campos numéricos de ahí en adelante.
	content := string(data)
	closeParen := strings.LastIndex(content, ")")
	if closeParen == -1 || closeParen+2 >= len(content) {
		return 0, when
	}
	fields := strings.Fields(content[closeParen+2:])
	// A partir de aquí, field[0] es el campo 3 (state) del formato real de
	// /proc/pid/stat — utime es el campo 14 → índice 11 en este slice
	// recortado; stime es el campo 15 → índice 12.
	if len(fields) < 13 {
		return 0, when
	}
	utime, _ := strconv.ParseFloat(fields[11], 64)
	stime, _ := strconv.ParseFloat(fields[12], 64)
	return utime + stime, when
}

// cpuPercent calcula el % de CPU usado desde la última muestra (delta de
// ticks de CPU / delta de tiempo real transcurrido). La primera llamada
// después de arrancar el bot no tiene con qué comparar y da 0.
func cpuPercent() float64 {
	cpuSampleMu.Lock()
	defer cpuSampleMu.Unlock()

	ticks, now := sampleCPUTicks()
	if lastSampleTime.IsZero() {
		lastCPUTicks, lastSampleTime = ticks, now
		return 0
	}

	elapsedSec := now.Sub(lastSampleTime).Seconds()
	deltaTicks := ticks - lastCPUTicks
	lastCPUTicks, lastSampleTime = ticks, now

	if elapsedSec <= 0 || deltaTicks < 0 {
		return 0
	}
	pct := (deltaTicks / clockTicksPerSec / elapsedSec) * 100
	if pct < 0 {
		pct = 0
	}
	return pct
}

// memRSSMB lee la memoria RSS real del proceso desde /proc/self/status —
// más precisa que runtime.ReadMemStats, que solo ve el heap de Go y
// subestima el uso real (stack, buffers de red del cliente HTTP, etc.).
func memRSSMB() float64 {
	data, err := os.ReadFile("/proc/self/status")
	if err != nil {
		return 0
	}
	for _, line := range strings.Split(string(data), "\n") {
		if strings.HasPrefix(line, "VmRSS:") {
			fields := strings.Fields(line)
			if len(fields) >= 2 {
				kb, _ := strconv.ParseFloat(fields[1], 64)
				return kb / 1024
			}
		}
	}
	return 0
}

// diskFreeGB — implementación real (Linux) en metrics_disk_linux.go y stub
// (cualquier otro SO, ej. Windows en desarrollo local) en
// metrics_disk_other.go — ver esos archivos.
