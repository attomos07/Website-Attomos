package comy

// comy_catalog.go — el catálogo de Comy sale del Inventario del negocio
// (precio 1, fotos, existencia), igual que el que ofrecen los bots. Si el
// negocio todavía no tiene artículos en Inventario, se usan los servicios
// de Mi Negocio como antes.
//
// Al pagar, los precios y la existencia se toman del servidor (no del
// navegador) y, al confirmar el pago, se abre el pedido en Mis ventas y se
// descuenta del Inventario.

import (
	"fmt"
	"log"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"attomos/config"
	"attomos/models"
	"attomos/realtime"

	"github.com/gin-gonic/gin"
)

const comyMaxItems = 400

// comyProduct — un producto de la tienda.
type comyProduct struct {
	Index         int      `json:"index"`
	ItemID        int64    `json:"itemId"` // 0 = servicio de Mi Negocio (sin inventario)
	Title         string   `json:"title"`
	Description   string   `json:"description"`
	Price         float64  `json:"price"`
	OriginalPrice float64  `json:"originalPrice"`
	PromoPrice    float64  `json:"promoPrice"`
	PriceType     string   `json:"priceType"`
	Images        []string `json:"images"`
	PromoDays     []string `json:"promoDays"`
	Stock         int      `json:"stock"` // -1 = sin control (servicio)
	Available     bool     `json:"available"`
}

func comyPhotoURL(key string) string {
	base := strings.TrimRight(os.Getenv("BASE_URL"), "/")
	return base + "/api/uploads/bucket?key=" + url.QueryEscape(key)
}

// comyCatalog — productos de la sucursal. fromInventory = vienen del Inventario.
func comyCatalog(b models.MyBusinessInfo) (out []comyProduct, fromInventory bool) {
	if b.UserID > 0 {
		if items, err := models.ListInvItemsForBot(b.UserID, comyMaxItems); err == nil && len(items) > 0 {
			for i, it := range items {
				var det []string
				if it.Categoria != "" {
					det = append(det, it.Categoria)
				} else if it.Depto != "" && it.Depto != "SIN DEFINIR" {
					det = append(det, it.Depto)
				}
				if it.Color != "" {
					det = append(det, "Color "+strings.ToLower(strings.Join(append([]string{it.Color}, it.Extras...), "/")))
				}
				if len(it.Materiales) > 0 {
					det = append(det, strings.Join(it.Materiales, ", "))
				}
				imgs := make([]string, 0, len(it.PhotoKeys))
				for _, k := range it.PhotoKeys {
					imgs = append(imgs, comyPhotoURL(k))
				}
				stock := it.Existencia
				if it.Servicio {
					stock = -1
				}
				out = append(out, comyProduct{
					Index: i, ItemID: it.ID, Title: it.Descripcion, Description: strings.Join(det, " · "),
					Price: it.Precio, PriceType: "normal", Images: imgs, PromoDays: []string{},
					Stock: stock, Available: it.Servicio || it.Existencia > 0,
				})
			}
			return out, true
		}
	}
	for i, svc := range b.Services {
		imgs := svc.ImageUrls
		if len(imgs) == 0 && svc.ImageURL != "" {
			imgs = []string{svc.ImageURL}
		}
		if imgs == nil {
			imgs = []string{}
		}
		price := svc.Price
		if svc.PriceType == "promotion" && svc.PromoPrice > 0 {
			price = svc.PromoPrice
		}
		stock, avail := -1, true
		if svc.StockQty != nil {
			stock = *svc.StockQty
			avail = stock > 0
		}
		out = append(out, comyProduct{
			Index: i, Title: svc.Title, Description: svc.Description, Price: price,
			OriginalPrice: svc.OriginalPrice, PromoPrice: svc.PromoPrice, PriceType: svc.PriceType,
			Images: imgs, PromoDays: svc.PromoDays, Stock: stock, Available: avail,
		})
	}
	return out, false
}

// comyLine — un renglón del carrito ya revisado contra el servidor.
type comyLine struct {
	ItemID   int64
	Index    int
	Title    string
	Price    float64
	Quantity int
}

// comyResolveCart revisa el carrito: precio y nombre del servidor, que el
// producto exista y que alcance la existencia. Regresa un mensaje si algo
// no está bien.
func comyResolveCart(b models.MyBusinessInfo, items []NindaCartItem) ([]comyLine, string) {
	if len(items) == 0 {
		return nil, "El carrito está vacío."
	}
	if len(items) > 100 {
		return nil, "Son demasiados productos para un solo pedido."
	}
	catalog, fromInv := comyCatalog(b)
	byID := map[int64]comyProduct{}
	for _, p := range catalog {
		if p.ItemID > 0 {
			byID[p.ItemID] = p
		}
	}
	want := map[int64]int{}
	out := make([]comyLine, 0, len(items))
	for _, it := range items {
		q := it.Quantity
		if q <= 0 {
			q = 1
		}
		if q > 999 {
			return nil, "Revisa las cantidades."
		}
		var p comyProduct
		ok := false
		if it.ItemID > 0 {
			p, ok = byID[it.ItemID]
		} else if !fromInv && it.ServiceIndex >= 0 && it.ServiceIndex < len(catalog) {
			p, ok = catalog[it.ServiceIndex], true
		}
		if !ok {
			return nil, fmt.Sprintf("«%s» ya no está disponible. Recarga la página.", it.Title)
		}
		if p.Price <= 0 {
			return nil, fmt.Sprintf("«%s» no tiene precio. Recarga la página.", p.Title)
		}
		if p.ItemID > 0 && p.Stock >= 0 {
			want[p.ItemID] += q
			if want[p.ItemID] > p.Stock {
				if p.Stock <= 0 {
					return nil, fmt.Sprintf("«%s» se agotó.", p.Title)
				}
				return nil, fmt.Sprintf("Solo quedan %d de «%s».", p.Stock, p.Title)
			}
		}
		out = append(out, comyLine{ItemID: p.ItemID, Index: p.Index, Title: p.Title, Price: p.Price, Quantity: q})
	}
	return out, ""
}

// comyCartMeta — el carrito en corto para la metadata de Stripe
// ("i12x2,s3x1"; máx. 500 caracteres).
func comyCartMeta(lines []comyLine) string {
	parts := make([]string, 0, len(lines))
	for _, l := range lines {
		if l.ItemID > 0 {
			parts = append(parts, fmt.Sprintf("i%dx%d", l.ItemID, l.Quantity))
		} else {
			parts = append(parts, fmt.Sprintf("s%dx%d", l.Index, l.Quantity))
		}
	}
	s := strings.Join(parts, ",")
	if len(s) > 500 {
		s = s[:strings.LastIndex(s[:500], ",")]
	}
	return s
}

// comyOrderItems arma los renglones del pedido a partir de la metadata.
func comyOrderItems(b models.MyBusinessInfo, meta string) models.OrderItems {
	catalog, _ := comyCatalog(b)
	byID := map[int64]comyProduct{}
	for _, p := range catalog {
		if p.ItemID > 0 {
			byID[p.ItemID] = p
		}
	}
	var out models.OrderItems
	for _, part := range strings.Split(meta, ",") {
		x := strings.LastIndex(part, "x")
		if len(part) < 2 || x < 2 {
			continue
		}
		n, err1 := strconv.ParseInt(part[1:x], 10, 64)
		q, err2 := strconv.Atoi(part[x+1:])
		if err1 != nil || err2 != nil || q <= 0 {
			continue
		}
		switch part[0] {
		case 'i':
			p, ok := byID[n]
			title := "Artículo"
			price := 0.0
			if ok {
				title, price = p.Title, p.Price
			}
			out = append(out, models.OrderItem{Name: title, Quantity: q, Price: price, ItemID: n})
		case 's':
			if int(n) >= 0 && int(n) < len(b.Services) {
				svc := b.Services[n]
				price := svc.Price
				if svc.PriceType == "promotion" && svc.PromoPrice > 0 {
					price = svc.PromoPrice
				}
				out = append(out, models.OrderItem{Name: svc.Title, Quantity: q, Price: price})
			}
		}
	}
	return out
}

// comyProductsJSON — para las respuestas de la API.
func comyProductsJSON(list []comyProduct) []gin.H {
	out := make([]gin.H, 0, len(list))
	for _, p := range list {
		out = append(out, gin.H{
			"index": p.Index, "itemId": p.ItemID, "title": p.Title, "description": p.Description,
			"price": p.Price, "originalPrice": p.OriginalPrice, "promoPrice": p.PromoPrice,
			"priceType": p.PriceType, "images": p.Images, "promoDays": p.PromoDays,
			"stock": p.Stock, "available": p.Available,
		})
	}
	return out
}

// comyRegisterOrder abre el pedido pagado en Mis ventas (si no existe ya
// para esa sesión de pago) y descuenta del Inventario. Regresa su clave de
// rastreo ("" si no se pudo).
func comyRegisterOrder(branchID uint, sessionID string, meta map[string]string, total float64) string {
	var existing models.Order
	if err := config.DB.Select("id, tracking_code").Where("external_ref = ?", sessionID).First(&existing).Error; err == nil {
		return existing.TrackingCode
	}
	var b models.MyBusinessInfo
	if err := config.DB.First(&b, branchID).Error; err != nil {
		log.Printf("comy: pedido de la sesión %s: sucursal %d: %v", sessionID, branchID, err)
		return ""
	}
	items := comyOrderItems(b, meta["cart"])
	code, err := models.NewTrackingCode()
	if err != nil {
		log.Printf("comy: clave de rastreo: %v", err)
	}
	now := time.Now()
	o := models.Order{
		UserID:        b.UserID,
		ClientName:    strings.TrimSpace(meta["customer_name"]),
		ClientPhone:   strings.TrimSpace(meta["customer_phone"]),
		Items:         items,
		Total:         total,
		Notes:         strings.TrimSpace(meta["notes"]),
		OrderType:     models.OrderTypePickup,
		Status:        models.OrderStatusConfirmed,
		Source:        models.OrderSourceNinda,
		PaymentMethod: "card",
		Paid:          true,
		PaidAt:        &now,
		TrackingCode:  code,
		ExternalRef:   sessionID,
	}
	if o.ClientName == "" {
		o.ClientName = "Cliente de Comy"
	}
	if err := config.DB.Create(&o).Error; err != nil {
		log.Printf("comy: guardar pedido de la sesión %s: %v", sessionID, err)
		return ""
	}
	applied, err := models.ApplyOrderStock(o.UserID, o.ID, o.Items, "Comy")
	if err != nil {
		log.Printf("comy: inventario del pedido %d: %v", o.ID, err)
	}
	config.DB.Model(&o).Updates(map[string]interface{}{"items": o.Items, "stock_applied": applied})
	if applied {
		// Los bots ofrecen el catálogo del Inventario: que lo refresquen.
		go func(uid uint) {
			var agents []models.Agent
			if err := config.DB.Select("id").Where("user_id = ? AND is_active = ?", uid, true).Find(&agents).Error; err != nil {
				return
			}
			for _, a := range agents {
				realtime.CRMHub.SendToBot(a.ID, realtime.CRMSendCommand{Type: "refresh_business_config"})
			}
		}(o.UserID)
	}
	return o.TrackingCode
}
