package handlers

// telegram_manager.go — "Conectar Telegram" sin pasos técnicos.
//
// Usa los Managed Bots de Telegram (Bot API 9.6): Attomos tiene UN bot
// administrador (TELEGRAM_MANAGER_BOT_TOKEN, con "Bot Management Mode"
// activado en el Mini App de @BotFather) y cada negocio crea SU bot desde
// él, con un toque, sin @BotFather ni tokens:
//
//  1. Onboarding → POST /api/telegram/connect → código temporal y enlace
//     https://t.me/<bot administrador>?start=<código> (botón y QR).
//  2. El cliente abre el enlace: el bot administrador recibe "/start
//     <código>", guarda quién es en Telegram y le manda el botón "Crear mi
//     bot" (request_managed_bot) con el nombre y el usuario sugeridos a
//     partir del negocio.
//  3. El cliente confirma en la ventana de Telegram. El bot administrador
//     recibe managed_bot_created / managed_bot, pide el token del bot nuevo
//     (getManagedBotToken) y le pone la descripción del negocio.
//  4. El onboarding consulta GET /api/telegram/connect/:code hasta ver
//     "created" y crea el agente con "telegramConnectCode" (el token nunca
//     pasa por el navegador).
//
// Si después el dueño cambia el token desde Telegram, llega otro
// managed_bot: se toma el token nuevo y se actualiza el bot desplegado.
//
// Variables de entorno:
//   TELEGRAM_MANAGER_BOT_TOKEN  token del bot administrador (obligatoria)
//   TELEGRAM_MANAGER_SECRET     secreto del webhook (opcional; si no, se
//                               deriva del token)
//   BASE_URL                    URL pública de Attomos (para el webhook)

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	"attomos/bots"
	"attomos/config"
	"attomos/models"

	"github.com/gin-gonic/gin"
)

const tgConnectTTL = 2 * time.Hour

var tgManager struct {
	mu       sync.RWMutex
	token    string
	username string // sin @
	secret   string
}

func tgManagerToken() string { return strings.TrimSpace(os.Getenv("TELEGRAM_MANAGER_BOT_TOKEN")) }

func tgManagerSecret() string {
	if s := strings.TrimSpace(os.Getenv("TELEGRAM_MANAGER_SECRET")); s != "" {
		return s
	}
	sum := sha256.Sum256([]byte("attomos-tg-manager:" + tgManagerToken()))
	return hex.EncodeToString(sum[:16])
}

// tgCall llama un método de la Bot API con JSON. out puede ser nil.
func tgCall(token, method string, params interface{}, out interface{}) error {
	body, err := json.Marshal(params)
	if err != nil {
		return err
	}
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Post("https://api.telegram.org/bot"+token+"/"+method, "application/json", bytes.NewReader(body))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	var r struct {
		OK          bool            `json:"ok"`
		Result      json.RawMessage `json:"result"`
		Description string          `json:"description"`
	}
	if err := json.Unmarshal(raw, &r); err != nil {
		return fmt.Errorf("telegram %s: respuesta inválida (%d)", method, resp.StatusCode)
	}
	if !r.OK {
		return fmt.Errorf("telegram %s: %s", method, r.Description)
	}
	if out != nil {
		return json.Unmarshal(r.Result, out)
	}
	return nil
}

// InitTelegramManager: lee el bot administrador y registra su webhook.
// Llamar una vez al arrancar (en segundo plano).
func InitTelegramManager() {
	token := tgManagerToken()
	if token == "" {
		log.Println("ℹ️  Telegram: sin TELEGRAM_MANAGER_BOT_TOKEN — \"Conectar Telegram\" con un toque no está disponible")
		return
	}
	go func() {
		var me struct {
			Username      string `json:"username"`
			CanManageBots bool   `json:"can_manage_bots"`
		}
		var err error
		for i := 0; i < 5; i++ {
			if err = tgCall(token, "getMe", map[string]interface{}{}, &me); err == nil {
				break
			}
			time.Sleep(time.Duration(i+1) * 5 * time.Second)
		}
		if err != nil {
			log.Printf("❌ Telegram: no se pudo leer el bot administrador: %v", err)
			return
		}
		tgManager.mu.Lock()
		tgManager.token, tgManager.username, tgManager.secret = token, me.Username, tgManagerSecret()
		tgManager.mu.Unlock()
		if !me.CanManageBots {
			log.Printf("⚠️  Telegram: @%s no tiene activado \"Bot Management Mode\" (Mini App de @BotFather → tu bot → Settings)", me.Username)
		}

		base := strings.TrimRight(os.Getenv("BASE_URL"), "/")
		if base == "" {
			log.Println("⚠️  Telegram: falta BASE_URL; no se registró el webhook del bot administrador")
			return
		}
		err = tgCall(token, "setWebhook", map[string]interface{}{
			"url":             base + "/api/telegram/manager/webhook",
			"secret_token":    tgManagerSecret(),
			"allowed_updates": []string{"message", "managed_bot"},
		}, nil)
		if err != nil {
			log.Printf("❌ Telegram: no se pudo registrar el webhook: %v", err)
			return
		}
		log.Printf("✅ Telegram: bot administrador @%s listo (webhook registrado)", me.Username)
	}()
}

func tgManagerReady() (token, username string) {
	tgManager.mu.RLock()
	defer tgManager.mu.RUnlock()
	return tgManager.token, tgManager.username
}

func tgNewCode() string {
	b := make([]byte, 18)
	_, _ = rand.Read(b)
	return "c" + base64.RawURLEncoding.EncodeToString(b) // [A-Za-z0-9_-], válido para /start
}

/* ---------------- nombre y usuario sugeridos ---------------- */

var tgUserCleanRe = regexp.MustCompile(`[^a-z0-9]+`)

var tgAccents = strings.NewReplacer("á", "a", "é", "e", "í", "i", "ó", "o", "ú", "u", "ü", "u", "ñ", "n", "à", "a", "è", "e", "ì", "i", "ò", "o", "ù", "u", "&", "y")

// tgSuggestUsername: "Óptica Avante" → "opticaavante_bot" (5-32 caracteres,
// termina en "bot"). El cliente lo puede cambiar en la ventana de Telegram.
func tgSuggestUsername(name string) string {
	t := tgAccents.Replace(strings.ToLower(name))
	s := tgUserCleanRe.ReplaceAllString(t, "")
	if len(s) > 26 {
		s = s[:26]
	}
	if len(s) < 3 {
		s = "minegocio"
	}
	if s[0] >= '0' && s[0] <= '9' {
		s = "n" + s
	}
	return s + "_bot"
}

func tgBusinessName(userID, branchID uint) (string, string) {
	var b models.MyBusinessInfo
	q := config.DB.Where("user_id = ?", userID)
	if branchID > 0 {
		q = q.Where("id = ?", branchID)
	}
	if err := q.Order("branch_number ASC").First(&b).Error; err != nil {
		return "Mi negocio", ""
	}
	name := strings.TrimSpace(b.BusinessName)
	if name == "" {
		name = "Mi negocio"
	}
	return name, strings.TrimSpace(b.Description)
}

/* ---------------- API del panel ---------------- */

// TelegramConnectStart — POST /api/telegram/connect  {branchId}
func TelegramConnectStart(c *gin.Context) {
	userI, ok := c.Get("user")
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}
	user := userI.(*models.User)
	_, mgr := tgManagerReady()
	if mgr == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "La conexión con Telegram no está disponible en este momento.", "manual": true})
		return
	}
	var in struct {
		BranchID uint `json:"branchId"`
	}
	_ = c.ShouldBindJSON(&in)

	rec := models.TelegramConnect{
		Code: tgNewCode(), UserID: user.ID, BranchID: in.BranchID,
		Status: models.TelegramConnectPending, ExpiresAt: time.Now().Add(tgConnectTTL),
	}
	if err := config.DB.Create(&rec).Error; err != nil {
		log.Printf("telegram.connect: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "No se pudo generar el enlace. Intenta de nuevo."})
		return
	}
	name, _ := tgBusinessName(user.ID, in.BranchID)
	c.JSON(http.StatusOK, gin.H{
		"code":              rec.Code,
		"link":              "https://t.me/" + mgr + "?start=" + rec.Code,
		"managerBot":        "@" + mgr,
		"suggestedName":     name,
		"suggestedUsername": "@" + tgSuggestUsername(name),
		"expiresIn":         int(tgConnectTTL.Seconds()),
	})
}

// TelegramConnectStatus — GET /api/telegram/connect/:code
func TelegramConnectStatus(c *gin.Context) {
	userI, ok := c.Get("user")
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No autenticado"})
		return
	}
	user := userI.(*models.User)
	var rec models.TelegramConnect
	if err := config.DB.Where("code = ? AND user_id = ?", c.Param("code"), user.ID).First(&rec).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Ese enlace ya no existe. Vuelve a tocar «Conectar Telegram»."})
		return
	}
	status := rec.Status
	if status != models.TelegramConnectCreated && status != models.TelegramConnectUsed && time.Now().After(rec.ExpiresAt) {
		status = "expired"
	}
	c.Header("Cache-Control", "no-store")
	out := gin.H{"status": status}
	if rec.BotUsername != "" {
		out["botUsername"] = "@" + rec.BotUsername
		out["botName"] = rec.BotName
		out["botLink"] = "https://t.me/" + rec.BotUsername
	}
	c.JSON(http.StatusOK, out)
}

// telegramTokenFromConnect: el token del bot creado con ese código (del
// mismo usuario). Lo usa CreateAgent.
func telegramTokenFromConnect(userID uint, code string) (*models.TelegramConnect, string) {
	var rec models.TelegramConnect
	if err := config.DB.Where("code = ? AND user_id = ?", strings.TrimSpace(code), userID).First(&rec).Error; err != nil {
		return nil, "No encontramos tu bot de Telegram. Vuelve a tocar «Conectar Telegram»."
	}
	if rec.Status == models.TelegramConnectUsed {
		return nil, "Ese bot de Telegram ya está conectado a un agente."
	}
	if rec.Status != models.TelegramConnectCreated || rec.Token == "" {
		return nil, "Todavía no terminas de crear tu bot en Telegram. Abre Telegram y toca «Crear mi bot»."
	}
	return &rec, ""
}

func markTelegramConnectUsed(rec *models.TelegramConnect, agentID uint) {
	if rec == nil {
		return
	}
	config.DB.Model(rec).Updates(map[string]interface{}{"status": models.TelegramConnectUsed, "agent_id": agentID})
}

/* ---------------- webhook del bot administrador ---------------- */

type tgUser struct {
	ID        int64  `json:"id"`
	IsBot     bool   `json:"is_bot"`
	FirstName string `json:"first_name"`
	Username  string `json:"username"`
}

type tgUpdate struct {
	Message *struct {
		Chat struct {
			ID   int64  `json:"id"`
			Type string `json:"type"`
		} `json:"chat"`
		From              *tgUser `json:"from"`
		Text              string  `json:"text"`
		ManagedBotCreated *struct {
			Bot tgUser `json:"bot"`
		} `json:"managed_bot_created"`
	} `json:"message"`
	ManagedBot *struct {
		User tgUser `json:"user"`
		Bot  tgUser `json:"bot"`
	} `json:"managed_bot"`
}

// TelegramManagerWebhook — POST /api/telegram/manager/webhook (Telegram)
func TelegramManagerWebhook(c *gin.Context) {
	token, mgr := tgManagerReady()
	if token == "" || c.GetHeader("X-Telegram-Bot-Api-Secret-Token") != tgManagerSecret() {
		c.Status(http.StatusUnauthorized)
		return
	}
	var u tgUpdate
	if err := c.ShouldBindJSON(&u); err != nil {
		c.Status(http.StatusOK) // a Telegram siempre 200, si no reintenta
		return
	}
	c.Status(http.StatusOK)

	switch {
	case u.Message != nil && u.Message.ManagedBotCreated != nil && u.Message.From != nil:
		go tgOnBotCreated(token, u.Message.From.ID, u.Message.Chat.ID, u.Message.ManagedBotCreated.Bot)
	case u.ManagedBot != nil:
		go tgOnManagedBot(token, u.ManagedBot.User, u.ManagedBot.Bot)
	case u.Message != nil && u.Message.Chat.Type == "private" && u.Message.From != nil:
		go tgOnMessage(token, mgr, u.Message.Chat.ID, u.Message.From.ID, strings.TrimSpace(u.Message.Text))
	}
}

func tgSend(token string, chatID int64, text string, markup interface{}) {
	p := map[string]interface{}{"chat_id": chatID, "text": text, "parse_mode": "HTML", "disable_web_page_preview": true}
	if markup != nil {
		p["reply_markup"] = markup
	}
	if err := tgCall(token, "sendMessage", p, nil); err != nil {
		log.Printf("telegram.manager sendMessage: %v", err)
	}
}

// tgOnMessage: "/start <código>" → botón para crear el bot.
func tgOnMessage(token, mgr string, chatID, fromID int64, text string) {
	if !strings.HasPrefix(text, "/start") {
		tgSend(token, chatID, "Hola 👋 Soy el asistente de <b>Attomos</b> para conectar el bot de Telegram de tu negocio.\n\nPara empezar, entra a tu panel de Attomos → <b>Mis agentes</b> → <b>Crear agente</b> → <b>Telegram</b> y toca <b>Conectar Telegram</b>.", nil)
		return
	}
	code := strings.TrimSpace(strings.TrimPrefix(text, "/start"))
	var rec models.TelegramConnect
	if code == "" || config.DB.Where("code = ?", code).First(&rec).Error != nil {
		tgSend(token, chatID, "Este enlace no es válido. Vuelve a tocar <b>Conectar Telegram</b> en tu panel de Attomos.", nil)
		return
	}
	if rec.Status == models.TelegramConnectCreated || rec.Status == models.TelegramConnectUsed {
		tgSend(token, chatID, fmt.Sprintf("Tu bot <b>@%s</b> ya está conectado ✅. Regresa a Attomos para terminar.", rec.BotUsername), map[string]interface{}{"remove_keyboard": true})
		return
	}
	if time.Now().After(rec.ExpiresAt) {
		tgSend(token, chatID, "Este enlace ya venció ⏰. Vuelve a tocar <b>Conectar Telegram</b> en tu panel de Attomos.", nil)
		return
	}
	config.DB.Model(&rec).Updates(map[string]interface{}{"tg_user_id": fromID, "tg_chat_id": chatID, "status": models.TelegramConnectOpened})

	name, _ := tgBusinessName(rec.UserID, rec.BranchID)
	username := tgSuggestUsername(name)
	keyboard := map[string]interface{}{
		"keyboard": [][]map[string]interface{}{{{
			"text": "🤖 Crear mi bot",
			"request_managed_bot": map[string]interface{}{
				"request_id":         int32(rec.ID % 2147483647),
				"suggested_name":     name,
				"suggested_username": username,
			},
		}}},
		"resize_keyboard":   true,
		"one_time_keyboard": true,
		"is_persistent":     true,
	}
	tgSend(token, chatID, fmt.Sprintf(
		"¡Hola! Vamos a crear el bot de Telegram de <b>%s</b> 🎉\n\n"+
			"1️⃣ Toca el botón <b>🤖 Crear mi bot</b> (abajo).\n"+
			"2️⃣ Revisa el nombre y el usuario (puedes cambiarlos) y confirma.\n\n"+
			"Eso es todo: Attomos lo conecta solo.", tgEsc(name)), keyboard)
	// Por si su Telegram no muestra el botón de abajo: el mismo flujo con un enlace.
	link := fmt.Sprintf("https://t.me/newbot/%s/%s?name=%s", mgr, username, strings.ReplaceAll(urlQueryEscape(name), "%20", "+"))
	tgSend(token, chatID, "¿No ves el botón? Toca aquí 👇", map[string]interface{}{
		"inline_keyboard": [][]map[string]string{{{"text": "Crear mi bot", "url": link}}},
	})
}

// tgOnBotCreated: llegó el bot nuevo en el chat con el cliente.
func tgOnBotCreated(token string, fromID, chatID int64, bot tgUser) {
	var rec models.TelegramConnect
	err := config.DB.Where("tg_chat_id = ? AND status IN ?", chatID, []string{models.TelegramConnectOpened, models.TelegramConnectPending}).
		Order("id DESC").First(&rec).Error
	if err != nil {
		err = config.DB.Where("tg_user_id = ? AND status IN ?", fromID, []string{models.TelegramConnectOpened, models.TelegramConnectPending}).
			Order("id DESC").First(&rec).Error
	}
	if err != nil {
		// Puede que ya se haya guardado por el aviso managed_bot.
		if config.DB.Where("bot_id = ?", bot.ID).First(&rec).Error == nil {
			return
		}
		tgSend(token, chatID, "Tu bot se creó, pero no encontramos tu enlace de Attomos 🤔. Vuelve a tocar <b>Conectar Telegram</b> en tu panel.", map[string]interface{}{"remove_keyboard": true})
		return
	}
	tgSaveCreated(token, &rec, bot)
}

// tgOnManagedBot: bot creado (por el enlace t.me/newbot) o token cambiado.
func tgOnManagedBot(token string, owner tgUser, bot tgUser) {
	// ¿Ya lo conocemos? → cambió el token (o el dueño): actualizarlo.
	var known models.TelegramConnect
	if config.DB.Where("bot_id = ?", bot.ID).First(&known).Error == nil && known.Token != "" {
		var newTok string
		if err := tgCall(token, "getManagedBotToken", map[string]interface{}{"user_id": bot.ID}, &newTok); err != nil || newTok == "" || newTok == known.Token {
			return
		}
		config.DB.Model(&known).Update("token", newTok)
		if known.AgentID > 0 {
			tgRefreshAgentToken(known.AgentID, known.Token, newTok)
		}
		return
	}
	var rec models.TelegramConnect
	if err := config.DB.Where("tg_user_id = ? AND status IN ?", owner.ID, []string{models.TelegramConnectOpened, models.TelegramConnectPending}).
		Order("id DESC").First(&rec).Error; err != nil {
		log.Printf("telegram.manager: bot @%s creado por %d sin enlace de Attomos", bot.Username, owner.ID)
		return
	}
	tgSaveCreated(token, &rec, bot)
}

var tgSaveMu sync.Mutex

func tgSaveCreated(token string, rec *models.TelegramConnect, bot tgUser) {
	tgSaveMu.Lock()
	defer tgSaveMu.Unlock()
	// Los dos avisos (mensaje y managed_bot) pueden llegar juntos.
	var fresh models.TelegramConnect
	if config.DB.First(&fresh, rec.ID).Error == nil && fresh.Status == models.TelegramConnectCreated {
		return
	}
	var botTok string
	if err := tgCall(token, "getManagedBotToken", map[string]interface{}{"user_id": bot.ID}, &botTok); err != nil || botTok == "" {
		log.Printf("❌ telegram.manager getManagedBotToken(@%s): %v", bot.Username, err)
		if rec.TgChatID != 0 {
			tgSend(token, rec.TgChatID, "Tu bot se creó, pero no pudimos conectarlo todavía 😕. Escríbenos a soporte y lo revisamos.", map[string]interface{}{"remove_keyboard": true})
		}
		return
	}
	config.DB.Model(rec).Updates(map[string]interface{}{
		"bot_id": bot.ID, "bot_username": bot.Username, "bot_name": bot.FirstName,
		"token": botTok, "status": models.TelegramConnectCreated,
	})
	log.Printf("✅ telegram.manager: bot @%s creado para el usuario %d", bot.Username, rec.UserID)

	// Descripción del negocio en el perfil del bot (lo que se ve antes de
	// escribirle) — con el token del bot nuevo.
	name, desc := tgBusinessName(rec.UserID, rec.BranchID)
	short := "Asistente de " + name + ". Escríbeme para información, citas y pedidos."
	if r := []rune(short); len(r) > 120 {
		short = string(r[:120])
	}
	long := short
	if desc != "" {
		long = desc + "\n\n" + short
	}
	if r := []rune(long); len(r) > 512 {
		long = string(r[:512])
	}
	_ = tgCall(botTok, "setMyShortDescription", map[string]interface{}{"short_description": short}, nil)
	_ = tgCall(botTok, "setMyDescription", map[string]interface{}{"description": long}, nil)

	if rec.TgChatID != 0 {
		tgSend(token, rec.TgChatID, fmt.Sprintf("¡Listo! ✅ Tu bot <b>@%s</b> quedó conectado.\n\nRegresa a Attomos para terminar; en unos minutos ya contesta solo.", bot.Username),
			map[string]interface{}{"remove_keyboard": true})
	}
}

// tgRefreshAgentToken: el dueño cambió el token desde Telegram → se pone
// en el agente y en el bot desplegado.
func tgRefreshAgentToken(agentID uint, oldTok, newTok string) {
	var agent models.Agent
	if err := config.DB.First(&agent, agentID).Error; err != nil || agent.PhoneNumber != oldTok {
		return
	}
	config.DB.Model(&agent).Update("phone_number", newTok)
	agent.PhoneNumber = newTok
	servers, err := bots.GetGlobalServerManager().ListAllServers()
	if err != nil || len(servers) == 0 {
		return
	}
	svc := bots.NewTelegramBotDeployService(servers[0].IPAddress, servers[0].RootPassword)
	if err := svc.Connect(); err != nil {
		log.Printf("telegram.manager: no se pudo conectar para cambiar el token del agente %d: %v", agentID, err)
		return
	}
	defer svc.Close()
	if err := svc.UpdateBotToken(&agent, newTok); err != nil {
		log.Printf("telegram.manager: no se pudo cambiar el token del agente %d: %v", agentID, err)
	}
}

/* ---------------- utilidades ---------------- */

func tgEsc(s string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;").Replace(s)
}

func urlQueryEscape(s string) string {
	var b strings.Builder
	for _, c := range []byte(s) {
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' || c == '~' {
			b.WriteByte(c)
		} else {
			fmt.Fprintf(&b, "%%%02X", c)
		}
	}
	return b.String()
}
