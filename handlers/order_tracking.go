package handlers

// order_tracking.go — página pública de Rastreo: el cliente escribe su
// clave (sale en el ticket o se la manda el negocio) y ve cómo va su pedido.
//
//	GET /rastreo?pedido=AT7K3P9Q        página
//	GET /api/rastreo?pedido=AT7K3P9Q    datos (sin teléfonos ni datos privados)

import (
	"errors"
	"log"
	"net/http"

	"attomos/models"

	"github.com/gin-gonic/gin"
)

// TrackingPage — GET /rastreo
func TrackingPage(c *gin.Context) {
	c.HTML(http.StatusOK, "rastreo-pedido.html", gin.H{"Code": models.NormalizeTrackingCode(c.Query("pedido"))})
}

// TrackingAPI — GET /api/rastreo?pedido=
func TrackingAPI(c *gin.Context) {
	o, err := models.TrackOrder(c.Query("pedido"))
	if errors.Is(err, models.ErrTrackingNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "No encontramos un pedido con esa clave. Revísala en tu ticket."})
		return
	}
	if err != nil {
		log.Printf("rastreo: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "No se pudo consultar el pedido. Intenta de nuevo."})
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, o)
}
