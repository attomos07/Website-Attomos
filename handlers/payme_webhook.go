package handlers

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"attomos/config"
	"attomos/models"

	"github.com/gin-gonic/gin"
)

// ============================================================
// Payme webhook — JSON-RPC 2.0 sobre HTTP Basic Auth
// https://developer.help.paycom.uz (Merchant API)
// ============================================================

// Códigos de error estándar de Payme
const (
	paymeErrInvalidAmount       = -31001
	paymeErrTransNotFound       = -31003
	paymeErrCantCancel          = -31007
	paymeErrCantPerform         = -31008
	paymeErrAuthFailed          = -32504
	paymeErrOrderNotFound       = -31050
	paymeErrAlreadyExistsFailed = -31051 // uso interno, no estándar de Payme
	paymeErrInternal            = -32400
)

type paymeRPCRequest struct {
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
	ID     interface{}     `json:"id"`
}

type paymeRPCError struct {
	Code    int         `json:"code"`
	Message interface{} `json:"message"`
	Data    string      `json:"data,omitempty"`
}

func paymeErrorMsg(ru, en, uz string) map[string]string {
	return map[string]string{"ru": ru, "en": en, "uz": uz}
}

// PaymeWebhookHandler despacha los métodos JSON-RPC de Payme.
// Ruta: POST /webhook/payme/:branch_id  (PÚBLICA — sin middleware de auth de usuario)
func PaymeWebhookHandler(c *gin.Context) {
	branchIDStr := c.Param("branch_id")
	branchID, err := strconv.ParseUint(branchIDStr, 10, 64)
	if err != nil {
		writePaymeError(c, nil, http.StatusOK, paymeErrInternal, paymeErrorMsg("branch_id inválido", "invalid branch_id", "branch_id noto'g'ri"))
		return
	}

	var cfg models.PaymentConfig
	if err := config.DB.Where("branch_id = ? AND payme_enabled = ?", branchID, true).First(&cfg).Error; err != nil {
		writePaymeError(c, nil, http.StatusOK, paymeErrOrderNotFound, paymeErrorMsg("Sucursal no configurada", "Branch not configured", "Filial sozlanmagan"))
		return
	}

	// ── Verificar Basic Auth: login "Paycom", password = PaymeSecretKey (Cassa key) ──
	if !verifyPaymeAuth(c, cfg.PaymeSecretKey) {
		writePaymeError(c, nil, http.StatusOK, paymeErrAuthFailed, paymeErrorMsg("No autorizado", "Insufficient privileges", "Ruxsat yo'q"))
		return
	}

	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		writePaymeError(c, nil, http.StatusOK, paymeErrInternal, paymeErrorMsg("Error leyendo body", "Error reading body", "Xato"))
		return
	}

	var req paymeRPCRequest
	if err := json.Unmarshal(body, &req); err != nil {
		writePaymeError(c, nil, http.StatusOK, paymeErrInternal, paymeErrorMsg("JSON inválido", "Invalid JSON", "Noto'g'ri JSON"))
		return
	}

	log.Printf("📨 [Payme] branch=%d method=%s", branchID, req.Method)

	switch req.Method {
	case "CheckPerformTransaction":
		handleCheckPerformTransaction(c, uint(branchID), req)
	case "CreateTransaction":
		handleCreateTransaction(c, uint(branchID), req)
	case "PerformTransaction":
		handlePerformTransaction(c, req)
	case "CancelTransaction":
		handleCancelTransaction(c, req)
	case "CheckTransaction":
		handleCheckTransaction(c, req)
	case "GetStatement":
		handleGetStatement(c, uint(branchID), req)
	default:
		writePaymeError(c, req.ID, http.StatusOK, paymeErrInternal, paymeErrorMsg("Método no soportado", "Method not found", "Metod topilmadi"))
	}
}

// ── Auth ──────────────────────────────────────────────────────────────────────

func verifyPaymeAuth(c *gin.Context, secretKey string) bool {
	auth := c.GetHeader("Authorization")
	if !strings.HasPrefix(auth, "Basic ") {
		return false
	}
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(auth, "Basic "))
	if err != nil {
		return false
	}
	parts := strings.SplitN(string(decoded), ":", 2)
	if len(parts) != 2 {
		return false
	}
	// Payme siempre manda login "Paycom"; el password es la Cassa key (secret)
	return parts[0] == "Paycom" && parts[1] == secretKey && secretKey != ""
}

// ── Params compartidos ────────────────────────────────────────────────────────

type paymeAccount struct {
	OrderID string `json:"order_id"`
}

type paymeCheckPerformParams struct {
	Amount  int64        `json:"amount"` // en tiyin
	Account paymeAccount `json:"account"`
}

type paymeCreateParams struct {
	ID      string       `json:"id"` // ID de transacción de Payme
	Time    int64        `json:"time"`
	Amount  int64        `json:"amount"`
	Account paymeAccount `json:"account"`
}

type paymePerformParams struct {
	ID string `json:"id"`
}

type paymeCancelParams struct {
	ID     string `json:"id"`
	Reason int    `json:"reason"`
}

type paymeStatementParams struct {
	From int64 `json:"from"`
	To   int64 `json:"to"`
}

// ── CheckPerformTransaction ────────────────────────────────────────────────────
// Payme pregunta si puede crear la transacción (el pedido existe, monto correcto).
func handleCheckPerformTransaction(c *gin.Context, branchID uint, req paymeRPCRequest) {
	var p paymeCheckPerformParams
	if err := json.Unmarshal(req.Params, &p); err != nil {
		writePaymeError(c, req.ID, http.StatusOK, paymeErrInternal, paymeErrorMsg("Parámetros inválidos", "Invalid params", "Noto'g'ri parametrlar"))
		return
	}

	if p.Account.OrderID == "" {
		writePaymeError(c, req.ID, http.StatusOK, paymeErrOrderNotFound, paymeErrorMsg("Pedido no encontrado", "Order not found", "Buyurtma topilmadi"))
		return
	}

	// TODO: una vez conectado el modelo de Order/Appointment, validar aquí que
	// p.Account.OrderID exista de verdad y que el monto (p.Amount en tiyin)
	// coincida con el total real del pedido. Por ahora solo validamos formato.
	if p.Amount <= 0 {
		writePaymeError(c, req.ID, http.StatusOK, paymeErrInvalidAmount, paymeErrorMsg("Monto inválido", "Invalid amount", "Noto'g'ri summa"))
		return
	}

	c.JSON(http.StatusOK, gin.H{"result": gin.H{"allow": true}})
}

// ── CreateTransaction ──────────────────────────────────────────────────────────
// Idempotente: si Payme reintenta con el mismo id, debe devolver el mismo estado.
func handleCreateTransaction(c *gin.Context, branchID uint, req paymeRPCRequest) {
	var p paymeCreateParams
	if err := json.Unmarshal(req.Params, &p); err != nil {
		writePaymeError(c, req.ID, http.StatusOK, paymeErrInternal, paymeErrorMsg("Parámetros inválidos", "Invalid params", "Noto'g'ri parametrlar"))
		return
	}

	// ── Idempotencia: ¿ya existe esta transacción de Payme? ──────────────────
	var existing models.ClickPaymeTransaction
	err := config.DB.Where("provider = ? AND provider_trans_id = ?", "payme", p.ID).First(&existing).Error
	if err == nil {
		if existing.State != 1 {
			writePaymeError(c, req.ID, http.StatusOK, paymeErrCantPerform, paymeErrorMsg("No se puede crear: ya procesada", "Unable to perform operation", "Amalni bajarib bo'lmaydi"))
			return
		}
		c.JSON(http.StatusOK, gin.H{"result": gin.H{
			"create_time": existing.CreatedAtProvider.UnixMilli(),
			"transaction": strconv.Itoa(int(existing.ID)),
			"state":       1,
		}})
		return
	}

	// ── ¿Ya existe una transacción PERFORMADA para este order_id con otro trans id? ──
	// Payme no permite dos transacciones activas para la misma cuenta/orden.
	var activeForOrder models.ClickPaymeTransaction
	if config.DB.Where("provider = ? AND merchant_trans_id = ? AND state IN ?", "payme", p.Account.OrderID, []int{1, 2}).
		First(&activeForOrder).Error == nil {
		writePaymeError(c, req.ID, http.StatusOK, paymeErrCantPerform, paymeErrorMsg("Ya existe una transacción para este pedido", "Transaction already exists for this order", "Ushbu buyurtma uchun tranzaksiya mavjud"))
		return
	}

	tx := models.ClickPaymeTransaction{
		Provider:          "payme",
		BranchID:          branchID,
		MerchantTransID:   p.Account.OrderID,
		ProviderTransID:   p.ID,
		Amount:            float64(p.Amount) / 100.0, // tiyin → UZS
		State:             1,
		CreatedAtProvider: time.Now(),
	}
	if err := config.DB.Create(&tx).Error; err != nil {
		log.Printf("❌ [Payme] Error creando transacción: %v", err)
		writePaymeError(c, req.ID, http.StatusOK, paymeErrInternal, paymeErrorMsg("Error interno", "Internal error", "Ichki xato"))
		return
	}

	log.Printf("✅ [Payme] CreateTransaction OK — tx local #%d | order_id=%s", tx.ID, p.Account.OrderID)

	c.JSON(http.StatusOK, gin.H{"result": gin.H{
		"create_time": tx.CreatedAtProvider.UnixMilli(),
		"transaction": strconv.Itoa(int(tx.ID)),
		"state":       1,
	}})
}

// ── PerformTransaction ───────────────────────────────────────────────────────
// Confirma el pago — aquí es cuando el dinero ya está entregado.
func handlePerformTransaction(c *gin.Context, req paymeRPCRequest) {
	var p paymePerformParams
	if err := json.Unmarshal(req.Params, &p); err != nil {
		writePaymeError(c, req.ID, http.StatusOK, paymeErrInternal, paymeErrorMsg("Parámetros inválidos", "Invalid params", "Noto'g'ri parametrlar"))
		return
	}

	var tx models.ClickPaymeTransaction
	if err := config.DB.Where("provider = ? AND provider_trans_id = ?", "payme", p.ID).First(&tx).Error; err != nil {
		writePaymeError(c, req.ID, http.StatusOK, paymeErrTransNotFound, paymeErrorMsg("Transacción no encontrada", "Transaction not found", "Tranzaksiya topilmadi"))
		return
	}

	// Idempotencia
	if tx.State == 2 {
		c.JSON(http.StatusOK, gin.H{"result": gin.H{
			"transaction":  strconv.Itoa(int(tx.ID)),
			"perform_time": tx.PerformedAt.UnixMilli(),
			"state":        2,
		}})
		return
	}

	if tx.State != 1 {
		writePaymeError(c, req.ID, http.StatusOK, paymeErrCantPerform, paymeErrorMsg("No se puede completar", "Unable to perform operation", "Amalni bajarib bo'lmaydi"))
		return
	}

	now := time.Now()
	tx.State = 2
	tx.PerformedAt = &now
	config.DB.Save(&tx)

	log.Printf("🎉 [Payme] Pago completado — tx local #%d | order_id=%s | $%.2f UZS",
		tx.ID, tx.MerchantTransID, tx.Amount)

	// TODO: enganchar con Order/Appointment real (igual que en Click)
	markOrderPaidByReference(tx.MerchantTransID, tx.Amount, "payme")

	c.JSON(http.StatusOK, gin.H{"result": gin.H{
		"transaction":  strconv.Itoa(int(tx.ID)),
		"perform_time": now.UnixMilli(),
		"state":        2,
	}})
}

// ── CancelTransaction ─────────────────────────────────────────────────────────
func handleCancelTransaction(c *gin.Context, req paymeRPCRequest) {
	var p paymeCancelParams
	if err := json.Unmarshal(req.Params, &p); err != nil {
		writePaymeError(c, req.ID, http.StatusOK, paymeErrInternal, paymeErrorMsg("Parámetros inválidos", "Invalid params", "Noto'g'ri parametrlar"))
		return
	}

	var tx models.ClickPaymeTransaction
	if err := config.DB.Where("provider = ? AND provider_trans_id = ?", "payme", p.ID).First(&tx).Error; err != nil {
		writePaymeError(c, req.ID, http.StatusOK, paymeErrTransNotFound, paymeErrorMsg("Transacción no encontrada", "Transaction not found", "Tranzaksiya topilmadi"))
		return
	}

	now := time.Now()
	newState := -1
	if tx.State == 2 {
		newState = -2 // cancelada después de completada = reembolso
	}

	if tx.State != -1 && tx.State != -2 {
		tx.State = newState
		tx.CancelledAt = &now
		tx.CancelReason = p.Reason
		config.DB.Save(&tx)
		log.Printf("🚫 [Payme] Transacción cancelada — tx local #%d | reason=%d", tx.ID, p.Reason)
	}

	c.JSON(http.StatusOK, gin.H{"result": gin.H{
		"transaction": strconv.Itoa(int(tx.ID)),
		"cancel_time": tx.CancelledAt.UnixMilli(),
		"state":       tx.State,
	}})
}

// ── CheckTransaction ──────────────────────────────────────────────────────────
func handleCheckTransaction(c *gin.Context, req paymeRPCRequest) {
	var p paymePerformParams
	if err := json.Unmarshal(req.Params, &p); err != nil {
		writePaymeError(c, req.ID, http.StatusOK, paymeErrInternal, paymeErrorMsg("Parámetros inválidos", "Invalid params", "Noto'g'ri parametrlar"))
		return
	}

	var tx models.ClickPaymeTransaction
	if err := config.DB.Where("provider = ? AND provider_trans_id = ?", "payme", p.ID).First(&tx).Error; err != nil {
		writePaymeError(c, req.ID, http.StatusOK, paymeErrTransNotFound, paymeErrorMsg("Transacción no encontrada", "Transaction not found", "Tranzaksiya topilmadi"))
		return
	}

	result := gin.H{
		"create_time": tx.CreatedAtProvider.UnixMilli(),
		"transaction": strconv.Itoa(int(tx.ID)),
		"state":       tx.State,
		"reason":      nil,
	}
	if tx.PerformedAt != nil {
		result["perform_time"] = tx.PerformedAt.UnixMilli()
	} else {
		result["perform_time"] = 0
	}
	if tx.CancelledAt != nil {
		result["cancel_time"] = tx.CancelledAt.UnixMilli()
		result["reason"] = tx.CancelReason
	} else {
		result["cancel_time"] = 0
	}

	c.JSON(http.StatusOK, gin.H{"result": result})
}

// ── GetStatement ──────────────────────────────────────────────────────────────
func handleGetStatement(c *gin.Context, branchID uint, req paymeRPCRequest) {
	var p paymeStatementParams
	if err := json.Unmarshal(req.Params, &p); err != nil {
		writePaymeError(c, req.ID, http.StatusOK, paymeErrInternal, paymeErrorMsg("Parámetros inválidos", "Invalid params", "Noto'g'ri parametrlar"))
		return
	}

	fromT := time.UnixMilli(p.From)
	toT := time.UnixMilli(p.To)

	var txs []models.ClickPaymeTransaction
	config.DB.Where("provider = ? AND branch_id = ? AND created_at_provider BETWEEN ? AND ?",
		"payme", branchID, fromT, toT).Find(&txs)

	transactions := make([]gin.H, 0, len(txs))
	for _, tx := range txs {
		item := gin.H{
			"id":          tx.ProviderTransID,
			"time":        tx.CreatedAtProvider.UnixMilli(),
			"amount":      int64(tx.Amount * 100),
			"account":     gin.H{"order_id": tx.MerchantTransID},
			"create_time": tx.CreatedAtProvider.UnixMilli(),
			"state":       tx.State,
			"reason":      nil,
		}
		if tx.PerformedAt != nil {
			item["perform_time"] = tx.PerformedAt.UnixMilli()
		} else {
			item["perform_time"] = 0
		}
		if tx.CancelledAt != nil {
			item["cancel_time"] = tx.CancelledAt.UnixMilli()
			item["reason"] = tx.CancelReason
		} else {
			item["cancel_time"] = 0
		}
		transactions = append(transactions, item)
	}

	c.JSON(http.StatusOK, gin.H{"result": gin.H{"transactions": transactions}})
}

// ── Helper de error JSON-RPC ────────────────────────────────────────────────────
func writePaymeError(c *gin.Context, id interface{}, httpStatus, code int, message map[string]string) {
	c.JSON(httpStatus, gin.H{
		"error": paymeRPCError{Code: code, Message: message},
		"id":    id,
	})
}
