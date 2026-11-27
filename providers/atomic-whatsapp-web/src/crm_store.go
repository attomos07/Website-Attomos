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
// Límites: se conservan los últimos crmStoreMax mensajes de los últimos
// crmStoreDays días; al arrancar se compacta el archivo.

import (
	"bufio"
	"encoding/json"
	"log"
	"os"
	"sync"
	"time"
)

const (
	crmStoreMax  = 20000
	crmStoreDays = 90
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

// initCRMStore carga el historial del disco (una sola vez).
func initCRMStore() {
	crmStoreOnce.Do(func() {
		path := crmStorePath()
		cut := time.Now().AddDate(0, 0, -crmStoreDays).UnixMilli()
		loaded, trimmed := 0, false

		if f, err := os.Open(path); err == nil {
			sc := bufio.NewScanner(f)
			sc.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
			for sc.Scan() {
				var e crmEvent
				if json.Unmarshal(sc.Bytes(), &e) != nil || e.Phone == "" {
					trimmed = true
					continue
				}
				if e.Timestamp < cut {
					trimmed = true
					continue
				}
				crmStoreEvents = append(crmStoreEvents, e)
				loaded++
			}
			f.Close()
		}
		if len(crmStoreEvents) > crmStoreMax {
			crmStoreEvents = append([]crmEvent(nil), crmStoreEvents[len(crmStoreEvents)-crmStoreMax:]...)
			trimmed = true
		}

		// Compactar: reescribir solo lo que se conserva.
		if trimmed {
			tmp := path + ".tmp"
			if f, err := os.Create(tmp); err == nil {
				w := bufio.NewWriter(f)
				enc := json.NewEncoder(w)
				for _, e := range crmStoreEvents {
					_ = enc.Encode(e)
				}
				w.Flush()
				f.Close()
				_ = os.Rename(tmp, path)
			}
		}

		f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
		if err != nil {
			log.Printf("⚠️  [CRM] No se pudo abrir %s: %v — el historial no se guardará", path, err)
			return
		}
		crmStoreFile = f
		log.Printf("💾 [CRM] Historial local: %d mensajes (%s)", len(crmStoreEvents), path)
	})
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
	if len(crmStoreEvents) > crmStoreMax+crmStoreMax/10 {
		crmStoreEvents = append([]crmEvent(nil), crmStoreEvents[len(crmStoreEvents)-crmStoreMax:]...)
	}
	if crmStoreFile != nil {
		if b, err := json.Marshal(e); err == nil {
			if _, err := crmStoreFile.Write(append(b, '\n')); err != nil {
				log.Printf("⚠️  [CRM] Error guardando historial: %v", err)
			}
		}
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
