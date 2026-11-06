package handlers

// inventory_adjustment_public.go — reporte de un ajuste de inventario para
// compartir por WhatsApp o correo: /inventory/ajuste/<id>/<firma>. La firma
// (HMAC con JWT_SECRET) evita que alguien vea ajustes de otros negocios
// cambiando el número. No muestra costos, solo cantidades.

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"attomos/models"

	"github.com/gin-gonic/gin"
)

func adjustmentSecret() []byte {
	s := os.Getenv("JWT_SECRET")
	if s == "" {
		s = "cambia-esto-por-una-clave-larga-y-aleatoria-en-produccion"
	}
	return []byte("inv-ajuste:" + s)
}

// AdjustmentSig — firma corta del id interno del ajuste.
func AdjustmentSig(id int64) string {
	m := hmac.New(sha256.New, adjustmentSecret())
	m.Write([]byte(strconv.FormatInt(id, 10)))
	return hex.EncodeToString(m.Sum(nil))[:20]
}

// AdjustmentPublicPath — "/inventory/ajuste/12/abcd…"
func AdjustmentPublicPath(id int64) string {
	return "/inventory/ajuste/" + strconv.FormatInt(id, 10) + "/" + AdjustmentSig(id)
}

var adjTypes = map[string]string{"fisico": "Inventario físico", "entrada": "Entrada", "salida": "Salida", "fijar": "Existencia fijada"}

var adjMonths = []string{"enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"}

func adjDateTime(s string) string {
	t, err := time.Parse("2006-01-02T15:04:05", s)
	if err != nil {
		return s
	}
	h, ampm := t.Hour(), "a. m."
	if h >= 12 {
		ampm = "p. m."
	}
	if h%12 == 0 {
		h = 12
	} else {
		h = h % 12
	}
	return strconv.Itoa(t.Day()) + " de " + adjMonths[t.Month()-1] + " de " + strconv.Itoa(t.Year()) + ", " + strconv.Itoa(h) + ":" + t.Format("04") + " " + ampm
}

type adjLineView struct {
	models.InvAdjustmentLine
	DiffTxt string
	Class   string
}

// PublicAdjustmentPage — GET /inventory/ajuste/:id/:sig
func PublicAdjustmentPage(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 || !hmac.Equal([]byte(c.Param("sig")), []byte(AdjustmentSig(id))) {
		c.String(http.StatusNotFound, "Ajuste no encontrado.")
		return
	}
	d, owner, err := models.GetInvAdjustmentByID(id)
	if errors.Is(err, models.ErrInvAdjustmentMissing) {
		c.String(http.StatusNotFound, "Ajuste no encontrado.")
		return
	}
	if err != nil {
		c.String(http.StatusInternalServerError, "No se pudo cargar el ajuste.")
		return
	}
	lines := make([]adjLineView, 0, len(d.Lineas))
	for _, l := range d.Lineas {
		v := adjLineView{InvAdjustmentLine: l, DiffTxt: strconv.Itoa(l.Diferencia), Class: "is-zero"}
		if l.Diferencia > 0 {
			v.DiffTxt, v.Class = "+"+v.DiffTxt, "is-up"
		} else if l.Diferencia < 0 {
			v.DiffTxt, v.Class = strings.Replace(v.DiffTxt, "-", "−", 1), "is-down"
		}
		lines = append(lines, v)
	}
	tipo := adjTypes[d.Tipo]
	if tipo == "" {
		tipo = d.Tipo
	}
	c.Header("X-Robots-Tag", "noindex")
	c.Header("Referrer-Policy", "no-referrer")
	c.HTML(http.StatusOK, "inventory-adjustment-public.html", gin.H{
		"A":        d,
		"Tipo":     tipo,
		"Fecha":    adjDateTime(d.Fecha),
		"Lineas":   lines,
		"Business": invBusinessName(owner),
	})
}
