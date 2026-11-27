package src

// crm_store.go — historial de conversaciones del CRM guardado en ESTE
// servidor (Hetzner), junto al bot.
//
// Cada mensaje (cliente, bot o humano desde el CRM) se agrega como una
// línea JSON a crm_history.jsonl en la carpeta del bot (sobrevive a los
// redeploys: el deploy no borra la carpeta). Al abrir el CRM, el backend
// pide el historial por el mismo WebSocket ("history") y el bot contesta
// con los mensajes recientes. Attomos no guarda conversaciones en su base
// de datos.
//
// crm_history.jsonl solo tiene lo reciente (máx. crmStoreMax mensajes de
// los últimos crmStoreDays días), para que el bot arranque y conteste
// rápido. Lo más viejo NO se borra: se mueve a un archivo por mes,
// crm_history-2026-11.jsonl, crm_history-2026-12.jsonl, etc. Eso pasa al
// arrancar y cuando el archivo reciente se llena.

import (
	"bufio"
	"encoding/json"
	"log"
	"os"
	"strings"
	"sync"
	"time"
)

const (
	crmStoreMax   = 20000 // mensajes en el archivo reciente
	crmStoreDays  = 90    // antigüedad máxima en el archivo reciente
	crmStoreSlack = 2000  // cuántos de más se toleran antes de archivar
)

var (
	crmStoreMu     sync.Mutex
	crmStoreEvents []crmEvent
	crmStoreFile   *os.File
	crmStoreOnce   sync.Once
)

func crmStorePath() string {
	if p := os.Getenv("CRM_HISTORY_FILE"); p != "" {
		return p
	}
	return "crm_history.jsonl"
}

// crmArchivePath: crm_history.jsonl → crm_history-2026-11.jsonl
func crmArchivePath(ts int64) string {
	base := strings.TrimSuffix(crmStorePath(), ".jsonl")
	return base + "-" + time.UnixMilli(ts).Format("2006-01") + ".jsonl"
}

// initCRMStore carga el historial reciente del disco (una sola vez).
func initCRMStore() {
	crmStoreOnce.Do(func() {
		path := crmStorePath()
		dirty := false
		if f, err := os.Open(path); err == nil {
			sc := bufio.NewScanner(f)
			sc.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
			for sc.Scan() {
				var e crmEvent
				if json.Unmarshal(sc.Bytes(), &e) != nil || e.Phone == "" {
					dirty = true // línea dañada: se descarta al reescribir
					continue
				}
				crmStoreEvents = append(crmStoreEvents, e)
			}
			f.Close()
		}

		crmStoreMu.Lock()
		if crmArchiveOldLocked() || dirty {
			crmRewriteLocked()
		}
		crmStoreMu.Unlock()

		f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
		if err != nil {
			log.Printf("⚠️  [CRM] No se pudo abrir %s: %v — el historial no se guardará", path, err)
			return
		}
		crmStoreFile = f
		log.Printf("💾 [CRM] Historial local: %d mensajes recientes (%s)", len(crmStoreEvents), path)
	})
}

// crmArchiveOldLocked mueve a los archivos por mes lo que ya no va en el
// reciente. Regresa true si movió algo. Requiere crmStoreMu.
func crmArchiveOldLocked() bool {
	cut := time.Now().AddDate(0, 0, -crmStoreDays).UnixMilli()
	start := 0
	for start < len(crmStoreEvents) &&
		(crmStoreEvents[start].Timestamp < cut || len(crmStoreEvents)-start > crmStoreMax) {
		start++
	}
	if start == 0 {
		return false
	}

	// Agrupar por mes y agregar al final de cada archivo mensual.
	byMonth := map[string][]crmEvent{}
	order := []string{}
	for _, e := range crmStoreEvents[:start] {
		p := crmArchivePath(e.Timestamp)
		if _, ok := byMonth[p]; !ok {
			order = append(order, p)
		}
		byMonth[p] = append(byMonth[p], e)
	}
	for _, p := range order {
		f, err := os.OpenFile(p, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
		if err != nil {
			log.Printf("⚠️  [CRM] No se pudo archivar en %s: %v — se conserva en el reciente", p, err)
			return false
		}
		w := bufio.NewWriter(f)
		enc := json.NewEncoder(w)
		for _, e := range byMonth[p] {
			_ = enc.Encode(e)
		}
		err = w.Flush()
		f.Close()
		if err != nil {
			log.Printf("⚠️  [CRM] Error archivando en %s: %v — se conserva en el reciente", p, err)
			return false
		}
		log.Printf("📦 [CRM] %d mensajes archivados en %s", len(byMonth[p]), p)
	}
	crmStoreEvents = append([]crmEvent(nil), crmStoreEvents[start:]...)
	return true
}

// crmRewriteLocked reescribe el archivo reciente con lo que hay en memoria.
// Requiere crmStoreMu.
func crmRewriteLocked() {
	path := crmStorePath()
	tmp := path + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		log.Printf("⚠️  [CRM] No se pudo reescribir el historial: %v", err)
		return
	}
	w := bufio.NewWriter(f)
	enc := json.NewEncoder(w)
	for _, e := range crmStoreEvents {
		_ = enc.Encode(e)
	}
	w.Flush()
	f.Close()

	if crmStoreFile != nil {
		crmStoreFile.Close()
		crmStoreFile = nil
	}
	if err := os.Rename(tmp, path); err != nil {
		log.Printf("⚠️  [CRM] No se pudo reemplazar el historial: %v", err)
	}
}

// crmStoreAdd guarda un mensaje de la conversación.
func crmStoreAdd(e crmEvent) {
	initCRMStore()
	if e.Phone == "" || e.Text == "" {
		return
	}
	e.Type = "message"
	if e.Timestamp == 0 {
		e.Timestamp = time.Now().UnixMilli()
	}
	crmStoreMu.Lock()
	defer crmStoreMu.Unlock()
	crmStoreEvents = append(crmStoreEvents, e)
	if crmStoreFile != nil {
		if b, err := json.Marshal(e); err == nil {
			if _, err := crmStoreFile.Write(append(b, '\n')); err != nil {
				log.Printf("⚠️  [CRM] Error guardando historial: %v", err)
			}
		}
	}

	// El reciente se llenó: archivar lo viejo sin esperar a un reinicio.
	if len(crmStoreEvents) > crmStoreMax+crmStoreSlack && crmArchiveOldLocked() {
		crmRewriteLocked()
		f, err := os.OpenFile(crmStorePath(), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
		if err != nil {
			log.Printf("⚠️  [CRM] No se pudo reabrir el historial: %v", err)
			return
		}
		crmStoreFile = f
	}
}

// crmStoreRecent regresa los últimos `limit` mensajes (en orden).
func crmStoreRecent(limit int) []crmEvent {
	initCRMStore()
	if limit <= 0 || limit > 5000 {
		limit = 1000
	}
	crmStoreMu.Lock()
	defer crmStoreMu.Unlock()
	n := len(crmStoreEvents)
	if n > limit {
		return append([]crmEvent(nil), crmStoreEvents[n-limit:]...)
	}
	return append([]crmEvent(nil), crmStoreEvents...)
}

// crmSendHistory contesta la petición "history" del backend.
func crmSendHistory(requestID string, limit int) {
	events := crmStoreRecent(limit)
	crmConnMu.Lock()
	conn := crmConn
	var err error
	if conn != nil {
		err = conn.WriteJSON(crmEvent{Type: "history", RequestID: requestID, Events: events, Timestamp: time.Now().UnixMilli()})
	}
	crmConnMu.Unlock()
	if err != nil {
		log.Printf("⚠️  [CRM] Error mandando historial: %v", err)
		return
	}
	log.Printf("📤 [CRM] Historial enviado al CRM (%d mensajes)", len(events))
}
