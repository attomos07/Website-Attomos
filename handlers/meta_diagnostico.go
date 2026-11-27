package handlers

// meta_diagnostico.go — ¿Por qué el bot de WhatsApp Business (OrbitalBot)
// no contesta?
//
//   GET /api/meta/diagnostico/:agent_id   (con sesión; abrir en el navegador)
//
// Revisa, en orden, cada eslabón entre el celular del cliente y el bot:
//   1. Credenciales: Meta acepta el token y el Phone Number ID.
//   2. Suscripción: la cuenta de WhatsApp (WABA) tiene suscrita la app de
//      Attomos (si no, Meta no manda NINGÚN mensaje). Con ?arreglar=1 la
//      suscribe.
//   3. Webhooks: cuándo llegó el último aviso de Meta a Attomos para este
//      agente (desde que arrancó Attomos).
//   4. Bot: el OrbitalBot responde en su servidor (/health).
// Y regresa qué hacer en cada caso que falle.
//
// Además, al guardar credenciales (SaveMetaCredentials) se suscribe la WABA
// sola (metaSubscribeWABA), para que nadie tenga que hacerlo a mano.

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"

	"attomos/config"
	"attomos/models"

	"github.com/gin-gonic/gin"
)

/* ---------- último webhook recibido por agente (en memoria) ---------- */

var metaLastHook = struct {
	sync.RWMutex
	at map[uint]time.Time
	n  map[uint]int
}{at: map[uint]time.Time{}, n: map[uint]int{}}

// metaNoteWebhook: llegó un aviso de Meta para ese agente.
func metaNoteWebhook(agentID uint) {
	metaLastHook.Lock()
	metaLastHook.at[agentID] = time.Now()
	metaLastHook.n[agentID]++
	metaLastHook.Unlock()
}

/* ---------- suscripción de la WABA a la app ---------- */

// metaSubscribeWABA: POST /{waba}/subscribed_apps con el token del cliente.
func metaSubscribeWABA(accessToken, wabaID string) error {
	req, err := http.NewRequest(http.MethodPost, fmt.Sprintf("https://graph.facebook.com/%s/%s/subscribed_apps", metaSendAPIVersion, wabaID), nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("Meta respondió %d: %s", resp.StatusCode, string(b))
	}
	return nil
}

type metaSubscribedApp struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// metaListSubscribedApps: GET /{waba}/subscribed_apps.
func metaListSubscribedApps(accessToken, wabaID string) ([]metaSubscribedApp, error) {
	req, err := http.NewRequest(http.MethodGet, fmt.Sprintf("https://graph.facebook.com/%s/%s/subscribed_apps", metaSendAPIVersion, wabaID), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var out struct {
		Data []struct {
			WhatsAppBusinessAPIData metaSubscribedApp `json:"whatsapp_business_api_data"`
		} `json:"data"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	if out.Error != nil {
		return nil, fmt.Errorf("%s", out.Error.Message)
	}
	apps := make([]metaSubscribedApp, 0, len(out.Data))
	for _, d := range out.Data {
		apps = append(apps, d.WhatsAppBusinessAPIData)
	}
	return apps, nil
}

/* ---------- diagnóstico ---------- */

type metaCheck struct {
	Paso    string `json:"paso"`
	OK      bool   `json:"ok"`
	Detalle string `json:"detalle"`
	Arreglo string `json:"arreglo,omitempty"`
}

// MetaDiagnostico — GET /api/meta/diagnostico/:agent_id[?arreglar=1]
func MetaDiagnostico(c *gin.Context) {
	userI, ok := c.Get("user")
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}
	user := userI.(*models.User)
	id, _ := strconv.ParseUint(c.Param("agent_id"), 10, 32)
	var agent models.Agent
	if err := config.DB.Where("id = ? AND user_id = ?", id, user.ID).First(&agent).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Agente no encontrado"})
		return
	}
	if !agent.IsOrbitalBot() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Este diagnóstico es para agentes de WhatsApp Business (Meta)."})
		return
	}
	fix := c.Query("arreglar") == "1"
	var checks []metaCheck

	// 1. Credenciales
	if agent.MetaAccessToken == "" || agent.MetaPhoneNumberID == "" || agent.MetaWABAID == "" {
		checks = append(checks, metaCheck{Paso: "1. Credenciales", OK: false, Detalle: "Faltan el token, el Phone Number ID o el WABA ID.",
			Arreglo: "En el agente → Actualizar credenciales."})
	} else if num, name, err := fetchMetaPhoneNumberInfo(agent.MetaAccessToken, agent.MetaPhoneNumberID); err != nil {
		checks = append(checks, metaCheck{Paso: "1. Credenciales", OK: false, Detalle: "Meta rechaza el token: " + err.Error(),
			Arreglo: "El token venció o no tiene permisos. Genera uno permanente (Usuario del sistema con whatsapp_business_messaging y whatsapp_business_management) y ponlo en Actualizar credenciales."})
	} else {
		checks = append(checks, metaCheck{Paso: "1. Credenciales", OK: true, Detalle: fmt.Sprintf("Token válido · %s (%s)", num, name)})
	}

	// 2. Suscripción WABA ↔ app
	if agent.MetaAccessToken != "" && agent.MetaWABAID != "" {
		apps, err := metaListSubscribedApps(agent.MetaAccessToken, agent.MetaWABAID)
		appID := os.Getenv("META_APP_ID")
		has := false
		names := []string{}
		for _, a := range apps {
			names = append(names, fmt.Sprintf("%s (%s)", a.Name, a.ID))
			if a.ID == appID || appID == "" {
				has = true
			}
		}
		switch {
		case err != nil:
			checks = append(checks, metaCheck{Paso: "2. Suscripción de la WABA a la app", OK: false, Detalle: "No se pudo consultar: " + err.Error()})
		case !has && fix:
			if err := metaSubscribeWABA(agent.MetaAccessToken, agent.MetaWABAID); err != nil {
				checks = append(checks, metaCheck{Paso: "2. Suscripción de la WABA a la app", OK: false, Detalle: "No se pudo suscribir: " + err.Error()})
			} else {
				checks = append(checks, metaCheck{Paso: "2. Suscripción de la WABA a la app", OK: true, Detalle: "No estaba suscrita; se suscribió ahora ✅. Vuelve a mandar un mensaje."})
			}
		case !has:
			checks = append(checks, metaCheck{Paso: "2. Suscripción de la WABA a la app", OK: false,
				Detalle: fmt.Sprintf("La app de Attomos no está suscrita a esta WABA (suscritas: %v). Meta no manda ningún mensaje así.", names),
				Arreglo: "Abre esta misma URL con ?arreglar=1 al final."})
		default:
			checks = append(checks, metaCheck{Paso: "2. Suscripción de la WABA a la app", OK: true, Detalle: fmt.Sprintf("Suscrita: %v", names)})
		}
	}

	// 3. Webhooks recibidos
	metaLastHook.RLock()
	last, n := metaLastHook.at[agent.ID], metaLastHook.n[agent.ID]
	metaLastHook.RUnlock()
	if n == 0 {
		checks = append(checks, metaCheck{Paso: "3. Mensajes que llegan de Meta", OK: false,
			Detalle: "Desde que arrancó Attomos no ha llegado ningún aviso de Meta para este agente.",
			Arreglo: fmt.Sprintf("En Meta for Developers → tu app → WhatsApp → Configuración: URL %s/webhook/meta/%d (o la del webhook de la app, /webhook/meta-app), token %s, y suscribe el campo \"messages\". Si es el número de prueba, agrega tu celular en API Setup → \"Para\".",
				os.Getenv("BASE_URL"), agent.ID, generateWebhookVerifyToken(agent.ID))})
	} else {
		checks = append(checks, metaCheck{Paso: "3. Mensajes que llegan de Meta", OK: true,
			Detalle: fmt.Sprintf("%d aviso(s); el último hace %s.", n, time.Since(last).Round(time.Second))})
	}

	// 4. Bot en su servidor
	if agent.ServerIP == "" || agent.Port == 0 {
		checks = append(checks, metaCheck{Paso: "4. Bot", OK: false, Detalle: "El agente no tiene servidor/puerto asignado.", Arreglo: "Haz Redeploy."})
	} else {
		resp, err := (&http.Client{Timeout: 6 * time.Second}).Get(fmt.Sprintf("http://%s:%d/health", agent.ServerIP, agent.Port))
		if err != nil {
			checks = append(checks, metaCheck{Paso: "4. Bot", OK: false, Detalle: "El bot no responde: " + err.Error(), Arreglo: "Haz Redeploy y revisa sus logs."})
		} else {
			resp.Body.Close()
			checks = append(checks, metaCheck{Paso: "4. Bot", OK: resp.StatusCode == http.StatusOK, Detalle: fmt.Sprintf("El bot responde (%d).", resp.StatusCode)})
		}
	}

	todo := true
	for _, ch := range checks {
		if !ch.OK {
			todo = false
		}
	}
	c.JSON(http.StatusOK, gin.H{"agente": agent.ID, "todoBien": todo, "revisiones": checks})
}

// metaAutoSubscribe: al guardar credenciales, suscribe la WABA a la app.
func metaAutoSubscribe(agentID uint, accessToken, wabaID string) {
	if err := metaSubscribeWABA(accessToken, wabaID); err != nil {
		log.Printf("⚠️  [Agent %d] No se pudo suscribir la WABA %s a la app: %v", agentID, wabaID, err)
		return
	}
	log.Printf("✅ [Agent %d] WABA %s suscrita a los webhooks de la app", agentID, wabaID)
}
