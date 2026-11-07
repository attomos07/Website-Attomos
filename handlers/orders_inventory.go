package handlers

// orders_inventory.go — los pedidos (bot, Comy, Mis ventas) descuentan del
// Inventario y lo regresan si se cancelan o se borran. Los pedidos que abre
// el Punto de venta (clave de rastreo de ópticas) no tocan el inventario:
// la venta ya lo descontó.

import (
	"log"

	"attomos/config"
	"attomos/models"
)

// orderNewTrackingCode — clave de rastreo nueva ("" si no se pudo).
func orderNewTrackingCode() string {
	code, err := models.NewTrackingCode()
	if err != nil {
		log.Printf("pedidos: clave de rastreo: %v", err)
		return ""
	}
	return code
}

// orderApplyStock descuenta lo del pedido (si no se había descontado).
func orderApplyStock(o *models.Order, usuario string) {
	if o == nil || o.Source == models.OrderSourcePOS || o.StockApplied || o.Status == models.OrderStatusCancelled {
		return
	}
	applied, err := models.ApplyOrderStock(o.UserID, o.ID, o.Items, usuario)
	if err != nil {
		log.Printf("pedidos: inventario del pedido %d: %v", o.ID, err)
		return
	}
	o.StockApplied = applied
	if err := config.DB.Model(o).Updates(map[string]interface{}{"items": o.Items, "stock_applied": applied}).Error; err != nil {
		log.Printf("pedidos: guardar pedido %d: %v", o.ID, err)
	}
	if applied {
		invNotifyBots(o.UserID)
	}
}

// orderReturnStock regresa al Inventario lo que el pedido había descontado.
func orderReturnStock(o *models.Order, motivo, usuario string) {
	if o == nil || !o.StockApplied {
		return
	}
	if err := models.ReturnOrderStock(o.UserID, o.ID, o.Items, motivo, usuario); err != nil {
		log.Printf("pedidos: regresar inventario del pedido %d: %v", o.ID, err)
		return
	}
	o.StockApplied = false
	if err := config.DB.Model(o).Updates(map[string]interface{}{"items": o.Items, "stock_applied": false}).Error; err != nil {
		log.Printf("pedidos: guardar pedido %d: %v", o.ID, err)
	}
	invNotifyBots(o.UserID)
}
