package handlers

import (
	"log"
	"strconv"
	"strings"

	"attomos/config"
	"attomos/models"
)

// markOrderPaidByReference se llama cuando Click o Payme confirman un pago
// exitoso. orderRef tiene el formato "order-{id}" o "appt-{id}" — generado
// por el bot con el ID real que el backend le devolvió al crear el pedido/cita
// (ver buildOrderReference en el bot). amount está en UZS, provider es
// "click"|"payme".
func markOrderPaidByReference(orderRef string, amount float64, provider string) {
	kind, idStr, ok := strings.Cut(orderRef, "-")
	if !ok {
		log.Printf("⚠️  [%s] Referencia con formato inesperado: '%s' — no se pudo marcar como pagado", provider, orderRef)
		return
	}

	id, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil {
		log.Printf("⚠️  [%s] Referencia con ID inválido: '%s'", provider, orderRef)
		return
	}

	switch kind {
	case "order":
		var order models.Order
		if err := config.DB.First(&order, id).Error; err != nil {
			log.Printf("⚠️  [%s] Pedido #%d no encontrado (ref=%s)", provider, id, orderRef)
			return
		}
		if order.Paid {
			log.Printf("ℹ️  [%s] Pedido #%d ya estaba marcado como pagado", provider, id)
			return
		}
		order.MarkPaid(provider)
		if err := config.DB.Save(&order).Error; err != nil {
			log.Printf("❌ [%s] Error marcando pedido #%d como pagado: %v", provider, id, err)
			return
		}
		log.Printf("✅ [%s] Pedido #%d marcado como PAGADO ($%.2f UZS)", provider, id, amount)

	case "appt":
		var appt models.Appointment
		if err := config.DB.First(&appt, id).Error; err != nil {
			log.Printf("⚠️  [%s] Cita #%d no encontrada (ref=%s)", provider, id, orderRef)
			return
		}
		if appt.Paid {
			log.Printf("ℹ️  [%s] Cita #%d ya estaba marcada como pagada", provider, id)
			return
		}
		appt.MarkPaid(provider)
		if err := config.DB.Save(&appt).Error; err != nil {
			log.Printf("❌ [%s] Error marcando cita #%d como pagada: %v", provider, id, err)
			return
		}
		log.Printf("✅ [%s] Cita #%d marcada como PAGADA ($%.2f UZS)", provider, id, amount)

	default:
		log.Printf("⚠️  [%s] Tipo de referencia desconocido: '%s' (ref=%s)", provider, kind, orderRef)
	}
}
