package handlers

import (
	"crypto/md5"
	"encoding/hex"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"

	"attomos/config"
	"attomos/models"

	"github.com/gin-gonic/gin"
)

// ============================================================
// Click.uz webhook — códigos de error estándar del protocolo
// https://docs.click.uz (Merchant API)
// ============================================================
const (
	clickErrSuccess         = 0
	clickErrSignFailed      = -1
	clickErrAlreadyPaid     = -4
	clickErrTransNotFound   = -5
	clickErrIncorrectAmount = -2
	clickErrActionNotFound  = -3
	clickErrTransCancelled  = -9
	clickErrBadRequest      = -8
)

// clickRequest representa el body que Click envía (form-urlencoded).
// action=0 → Prepare, action=1 → Complete
type clickRequest struct {
	ClickTransID      string `form:"click_trans_id"`
	ServiceID         string `form:"service_id"`
	ClickPaydocID     string `form:"click_paydoc_id"`
	MerchantTransID   string `form:"merchant_trans_id"`
	MerchantPrepareID string `form:"merchant_prepare_id"`
	Amount            string `form:"amount"`
	Action            string `form:"action"`
	Error             string `form:"error"`
	ErrorNote         string `form:"error_note"`
	SignTime          string `form:"sign_time"`
	SignString        string `form:"sign_string"`
}

// ClickWebhookHandler recibe las notificaciones de Click (Prepare y Complete).
// Ruta: POST /webhook/click/:branch_id  (PÚBLICA — sin middleware de auth de usuario)
func ClickWebhookHandler(c *gin.Context) {
	branchIDStr := c.Param("branch_id")
	branchID, err := strconv.ParseUint(branchIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": clickErrBadRequest, "error_note": "branch_id inválido"})
		return
	}

	var req clickRequest
	if err := c.ShouldBind(&req); err != nil {
		log.Printf("❌ [Click] Error parseando request: %v", err)
		c.JSON(http.StatusOK, gin.H{"error": clickErrBadRequest, "error_note": "Datos inválidos"})
		return
	}

	log.Printf("📨 [Click] branch=%d action=%s trans_id=%s merchant_trans_id=%s amount=%s",
		branchID, req.Action, req.ClickTransID, req.MerchantTransID, req.Amount)

	// ── Cargar config de pagos de la sucursal (para el secret key) ──────────
	var cfg models.PaymentConfig
	if err := config.DB.Where("branch_id = ? AND click_enabled = ?", branchID, true).First(&cfg).Error; err != nil {
		log.Printf("❌ [Click] Sucursal %d sin Click configurado", branchID)
		c.JSON(http.StatusOK, gin.H{"error": clickErrTransNotFound, "error_note": "Sucursal no configurada"})
		return
	}

	action, _ := strconv.Atoi(req.Action)

	// ── Verificar firma MD5 ───────────────────────────────────────────────────
	var expectedSign string
	if action == 0 {
		// Prepare: click_trans_id + service_id + SECRET_KEY + merchant_trans_id + amount + action + sign_time
		raw := req.ClickTransID + req.ServiceID + cfg.ClickSecretKey + req.MerchantTransID + req.Amount + req.Action + req.SignTime
		expectedSign = md5Hex(raw)
	} else {
		// Complete: click_trans_id + service_id + SECRET_KEY + merchant_trans_id + merchant_prepare_id + amount + action + sign_time
		raw := req.ClickTransID + req.ServiceID + cfg.ClickSecretKey + req.MerchantTransID + req.MerchantPrepareID + req.Amount + req.Action + req.SignTime
		expectedSign = md5Hex(raw)
	}

	if expectedSign != req.SignString {
		log.Printf("❌ [Click] Firma inválida para trans_id=%s", req.ClickTransID)
		c.JSON(http.StatusOK, gin.H{
			"click_trans_id":    req.ClickTransID,
			"merchant_trans_id": req.MerchantTransID,
			"error":             clickErrSignFailed,
			"error_note":        "SIGN CHECK FAILED",
		})
		return
	}

	amount, _ := strconv.ParseFloat(req.Amount, 64)

	switch action {
	case 0: // ── Prepare ──────────────────────────────────────────────────────
		handleClickPrepare(c, uint(branchID), req, amount)
	case 1: // ── Complete ─────────────────────────────────────────────────────
		handleClickComplete(c, uint(branchID), req, amount)
	default:
		c.JSON(http.StatusOK, gin.H{
			"click_trans_id":    req.ClickTransID,
			"merchant_trans_id": req.MerchantTransID,
			"error":             clickErrActionNotFound,
			"error_note":        "Acción no reconocida",
		})
	}
}

func handleClickPrepare(c *gin.Context, branchID uint, req clickRequest, amount float64) {
	// Idempotencia: si ya existe una transacción con este click_trans_id, reusarla
	var existing models.ClickPaymeTransaction
	err := config.DB.Where("provider = ? AND provider_trans_id = ?", "click", req.ClickTransID).First(&existing).Error
	if err == nil {
		c.JSON(http.StatusOK, gin.H{
			"click_trans_id":      req.ClickTransID,
			"merchant_trans_id":   req.MerchantTransID,
			"merchant_prepare_id": existing.ID,
			"error":               clickErrSuccess,
			"error_note":          "Success",
		})
		return
	}

	tx := models.ClickPaymeTransaction{
		Provider:          "click",
		BranchID:          branchID,
		MerchantTransID:   req.MerchantTransID,
		ProviderTransID:   req.ClickTransID,
		Amount:            amount,
		State:             1,
		CreatedAtProvider: time.Now(),
	}
	if err := config.DB.Create(&tx).Error; err != nil {
		log.Printf("❌ [Click] Error creando transacción: %v", err)
		c.JSON(http.StatusOK, gin.H{"error": clickErrBadRequest, "error_note": "Error interno"})
		return
	}

	log.Printf("✅ [Click] Prepare OK — tx local #%d | merchant_trans_id=%s", tx.ID, req.MerchantTransID)

	// merchant_prepare_id: usamos el ID local de la transacción, Click nos lo
	// regresará en el Complete para validar la secuencia.
	c.JSON(http.StatusOK, gin.H{
		"click_trans_id":      req.ClickTransID,
		"merchant_trans_id":   req.MerchantTransID,
		"merchant_prepare_id": tx.ID,
		"error":               clickErrSuccess,
		"error_note":          "Success",
	})
}

func handleClickComplete(c *gin.Context, branchID uint, req clickRequest, amount float64) {
	var tx models.ClickPaymeTransaction
	if err := config.DB.Where("provider = ? AND provider_trans_id = ?", "click", req.ClickTransID).First(&tx).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{
			"click_trans_id":    req.ClickTransID,
			"merchant_trans_id": req.MerchantTransID,
			"error":             clickErrTransNotFound,
			"error_note":        "Transacción no encontrada (falta Prepare)",
		})
		return
	}

	// Verificar que el merchant_prepare_id coincida (evita completar una transacción ajena)
	expectedPrepareID := fmt.Sprintf("%d", tx.ID)
	if req.MerchantPrepareID != expectedPrepareID {
		c.JSON(http.StatusOK, gin.H{
			"click_trans_id":    req.ClickTransID,
			"merchant_trans_id": req.MerchantTransID,
			"error":             clickErrTransNotFound,
			"error_note":        "merchant_prepare_id no coincide",
		})
		return
	}

	// Si Click reporta error (pago cancelado del lado del usuario)
	if errCode, _ := strconv.Atoi(req.Error); errCode < 0 {
		now := time.Now()
		tx.State = -1
		tx.CancelledAt = &now
		tx.CancelReason = errCode
		config.DB.Save(&tx)

		c.JSON(http.StatusOK, gin.H{
			"click_trans_id":    req.ClickTransID,
			"merchant_trans_id": req.MerchantTransID,
			"error":             clickErrTransCancelled,
			"error_note":        "Transacción cancelada",
		})
		return
	}

	// Idempotencia: si ya estaba completada, responder success sin reprocesar
	if tx.State == 2 {
		c.JSON(http.StatusOK, gin.H{
			"click_trans_id":      req.ClickTransID,
			"merchant_trans_id":   req.MerchantTransID,
			"merchant_confirm_id": tx.ID,
			"error":               clickErrSuccess,
			"error_note":          "Success",
		})
		return
	}

	if amount != tx.Amount {
		c.JSON(http.StatusOK, gin.H{
			"click_trans_id":    req.ClickTransID,
			"merchant_trans_id": req.MerchantTransID,
			"error":             clickErrIncorrectAmount,
			"error_note":        "Monto no coincide",
		})
		return
	}

	now := time.Now()
	tx.State = 2
	tx.PerformedAt = &now
	config.DB.Save(&tx)

	log.Printf("🎉 [Click] Pago completado — tx local #%d | merchant_trans_id=%s | $%.2f UZS",
		tx.ID, tx.MerchantTransID, tx.Amount)

	// ── Enganche con pedido/cita real ────────────────────────────────────────
	// TODO: una vez conectados los modelos de Order/Appointment, marcar como
	// pagado aquí usando tx.MerchantTransID como referencia, y setear
	// tx.OrderMarkedPaid = true.
	markOrderPaidByReference(tx.MerchantTransID, tx.Amount, "click")

	c.JSON(http.StatusOK, gin.H{
		"click_trans_id":      req.ClickTransID,
		"merchant_trans_id":   req.MerchantTransID,
		"merchant_confirm_id": tx.ID,
		"error":               clickErrSuccess,
		"error_note":          "Success",
	})
}

func md5Hex(s string) string {
	h := md5.Sum([]byte(s))
	return hex.EncodeToString(h[:])
}
