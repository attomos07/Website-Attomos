package services

import (
	"context"
	"fmt"
	neturl "net/url"
	"regexp"
	"strings"
	"time"

	"github.com/chromedp/chromedp"
)

// VehicleWebsiteData son los datos de un vehículo extraídos de la página
// pública del cliente (no de Google Sheets ni de la BD de Attomos).
type VehicleWebsiteData struct {
	URL          string            `json:"url"`
	VehicleID    string            `json:"vehicle_id"`
	Year         string            `json:"year"`
	Mileage      string            `json:"mileage"`
	Fuel         string            `json:"fuel"`
	Transmission string            `json:"transmission"`
	Color        string            `json:"color"`
	Location     string            `json:"location"`
	Description  string            `json:"description"`
	Features     []string          `json:"features"`
	RawSpecs     map[string]string `json:"raw_specs"` // por si el sitio trae etiquetas que no mapeamos arriba
}

// jsExtractSpecs corre DENTRO del navegador headless (no en Go) una vez que
// la página ya renderizó. Busca, para cada bloque "etiqueta + valor" del
// grid de especificaciones, el texto de la etiqueta (AÑO, KILOMETRAJE, etc.)
// y toma el <p> hermano como valor — no depende de nombres de clases CSS
// generados (esos sí cambian entre builds de Next.js), solo del texto visible.
const jsExtractSpecs = `
(() => {
	const result = { specs: {}, description: "", features: [], vehicleId: "" };

	// --- specs: cualquier <p> en mayúsculas seguido de un <p> con el valor ---
	document.querySelectorAll('p').forEach(p => {
		const label = (p.textContent || '').trim();
		if (!label || label !== label.toUpperCase() || label.length > 40) return;
		const parent = p.parentElement;
		if (!parent) return;
		const valueEl = parent.querySelector('p:nth-of-type(2)') || p.nextElementSibling;
		if (!valueEl) return;
		const value = (valueEl.textContent || '').trim();
		if (value) result.specs[label] = value;
	});

	// --- ID vehículo: suele ir como "ID VEHÍCULO: XXXXX" en algún nodo de texto ---
	const bodyText = document.body.innerText || '';
	const idMatch = bodyText.match(/ID\s+VEH[IÍ]CULO:?\s*([A-Za-z0-9]+)/i);
	if (idMatch) result.vehicleId = idMatch[1];

	// --- Descripción: heading "Descripción" + contenido del siguiente hermano ---
	const findSectionAfterHeading = (headingText) => {
		const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4'));
		const h = headings.find(el => (el.textContent || '').trim().toLowerCase() === headingText.toLowerCase());
		if (!h) return '';
		let sib = h.nextElementSibling;
		while (sib) {
			const t = (sib.textContent || '').trim();
			if (t) return t;
			sib = sib.nextElementSibling;
		}
		return '';
	};
	result.description = findSectionAfterHeading('Descripción');

	// --- Características: puede ser una lista de <li> o texto plano ---
	const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4'));
	const featHeading = headings.find(el => (el.textContent || '').trim().toLowerCase() === 'características');
	if (featHeading) {
		let sib = featHeading.nextElementSibling;
		while (sib) {
			const items = sib.querySelectorAll('li');
			if (items.length > 0) {
				result.features = Array.from(items).map(li => (li.textContent || '').trim()).filter(Boolean);
				break;
			}
			const t = (sib.textContent || '').trim();
			if (t) { result.features = [t]; break; }
			sib = sib.nextElementSibling;
		}
	}

	return result;
})()
`

type jsExtractResult struct {
	Specs       map[string]string `json:"specs"`
	Description string            `json:"description"`
	Features    []string          `json:"features"`
	VehicleID   string            `json:"vehicleId"`
}

// NewHeadlessBrowser arranca un Chromium headless y devuelve su contexto,
// listo para navegar varias páginas seguidas (mucho más rápido que abrir un
// proceso de Chrome nuevo por cada vehículo). El caller debe llamar la
// función `cancel` devuelta cuando termine.
func NewHeadlessBrowser(parent context.Context) (context.Context, context.CancelFunc) {
	allocCtx, cancelAlloc := chromedp.NewExecAllocator(parent, append(
		chromedp.DefaultExecAllocatorOptions[:],
		chromedp.Flag("headless", true),
		chromedp.Flag("disable-gpu", true),
		chromedp.Flag("no-sandbox", true), // necesario corriendo como root en el contenedor de Railway
		chromedp.Flag("disable-dev-shm-usage", true),
	)...)

	browserCtx, cancelBrowser := chromedp.NewContext(allocCtx)

	cancel := func() {
		cancelBrowser()
		cancelAlloc()
	}
	return browserCtx, cancel
}

// ScrapeVehiclePage abre `pageURL` en un Chrome headless, espera a que el
// contenido cliente-renderizado (Next.js) termine de cargar, y extrae los
// datos del vehículo. Pensado para sitios donde el HTML crudo llega vacío
// (SSR deshabilitado / puro client-side rendering) — si el sitio SÍ trae el
// HTML ya armado, esto igual funciona, solo es más lento que un fetch normal.
//
// browserCtx debe venir de NewHeadlessBrowser — se puede reutilizar el mismo
// para varias URLs seguidas (scraping en lote).
func ScrapeVehiclePage(browserCtx context.Context, pageURL string) (*VehicleWebsiteData, error) {
	timeoutCtx, cancelTimeout := context.WithTimeout(browserCtx, 25*time.Second)
	defer cancelTimeout()

	var raw jsExtractResult
	err := chromedp.Run(timeoutCtx,
		chromedp.Navigate(pageURL),
		// esperamos a que aparezca cualquier <p> en mayúsculas típico del
		// grid de specs — señal de que el JS del cliente ya renderizó.
		chromedp.WaitVisible(`body`, chromedp.ByQuery),
		chromedp.Sleep(3*time.Second), // Next.js CSR necesita un respiro tras el primer render
		chromedp.Evaluate(jsExtractSpecs, &raw),
	)
	if err != nil {
		return nil, fmt.Errorf("chromedp: %w", err)
	}

	data := &VehicleWebsiteData{
		URL:         pageURL,
		VehicleID:   raw.VehicleID,
		Description: raw.Description,
		Features:    raw.Features,
		RawSpecs:    raw.Specs,
	}
	data.Year = pickSpec(raw.Specs, "AÑO", "ANO", "AÑO ")
	data.Mileage = pickSpec(raw.Specs, "KILOMETRAJE", "KM")
	data.Fuel = pickSpec(raw.Specs, "COMBUSTIBLE")
	data.Transmission = pickSpec(raw.Specs, "TRANSMISIÓN", "TRANSMISION")
	data.Color = pickSpec(raw.Specs, "COLOR")
	data.Location = pickSpec(raw.Specs, "UBICACIÓN", "UBICACION")

	if data.Year == "" && data.Mileage == "" && data.Color == "" {
		return nil, fmt.Errorf("no se encontraron specs reconocibles en %s (¿cambió el HTML del sitio?)", pageURL)
	}
	return data, nil
}

// jsExtractListingLinks corre en el navegador sobre la página de listado
// (/inventory) y junta los href de cada tarjeta de vehículo. No depende de
// clases CSS (esas cambian entre builds) — solo del patrón de la URL, que
// Next.js genera igual siempre: /inventory/<id>.
const jsExtractListingLinks = `
(() => {
	const links = Array.from(document.querySelectorAll('a[href]'))
		.map(a => a.getAttribute('href'))
		.filter(href => href && /^\/inventory\/[A-Za-z0-9_-]+$/.test(href));
	return Array.from(new Set(links));
})()
`

// jsClickLoadMore intenta hacer clic en un botón de "cargar/ver más" si
// existe (paginación por botón en vez de scroll infinito). Devuelve true si
// encontró y le dio clic a algo.
const jsClickLoadMore = `
(() => {
	const candidates = Array.from(document.querySelectorAll('button, a'));
	const btn = candidates.find(el => {
		const t = (el.textContent || '').trim().toLowerCase();
		return t.includes('cargar más') || t.includes('ver más') || t.includes('mostrar más');
	});
	if (btn) { btn.click(); return true; }
	return false;
})()
`

// ScrapeVehicleListing abre la página de listado del inventario y devuelve
// las URLs absolutas de cada ficha de vehículo encontrada. Intenta cargar
// más resultados haciendo scroll y buscando un botón "cargar más" hasta
// maxScrolls veces, o hasta que ya no aparezcan links nuevos.
func ScrapeVehicleListing(browserCtx context.Context, listingURL string) ([]string, error) {
	base, err := neturl.Parse(listingURL)
	if err != nil {
		return nil, fmt.Errorf("URL de listado inválida: %w", err)
	}

	timeoutCtx, cancelTimeout := context.WithTimeout(browserCtx, 60*time.Second)
	defer cancelTimeout()

	if err := chromedp.Run(timeoutCtx,
		chromedp.Navigate(listingURL),
		chromedp.WaitVisible(`body`, chromedp.ByQuery),
		chromedp.Sleep(3*time.Second),
	); err != nil {
		return nil, fmt.Errorf("chromedp (listado): %w", err)
	}

	seen := map[string]bool{}
	const maxScrolls = 20
	stableRounds := 0
	for i := 0; i < maxScrolls && stableRounds < 2; i++ {
		var links []string
		if err := chromedp.Run(timeoutCtx, chromedp.Evaluate(jsExtractListingLinks, &links)); err != nil {
			return nil, fmt.Errorf("chromedp (extraer links): %w", err)
		}
		before := len(seen)
		for _, l := range links {
			seen[l] = true
		}
		if len(seen) == before {
			stableRounds++
		} else {
			stableRounds = 0
		}

		var clicked bool
		_ = chromedp.Run(timeoutCtx, chromedp.Evaluate(jsClickLoadMore, &clicked))
		_ = chromedp.Run(timeoutCtx,
			chromedp.KeyEvent(`End`),
			chromedp.Sleep(1500*time.Millisecond),
		)
	}

	urls := make([]string, 0, len(seen))
	for href := range seen {
		abs := *base
		abs.Path = href
		abs.RawQuery = ""
		urls = append(urls, abs.String())
	}
	if len(urls) == 0 {
		return nil, fmt.Errorf("no se encontraron vehículos en %s (¿cambió el HTML del sitio?)", listingURL)
	}
	return urls, nil
}

func pickSpec(specs map[string]string, keys ...string) string {
	for _, k := range keys {
		if v, ok := specs[normalizeLabel(k)]; ok {
			return v
		}
	}
	// intento adicional normalizando también las claves del mapa (por si el
	// sitio manda espacios/acentos ligeramente distintos a los nuestros)
	for label, v := range specs {
		nl := normalizeLabel(label)
		for _, k := range keys {
			if nl == normalizeLabel(k) {
				return v
			}
		}
	}
	return ""
}

var spaceRe = regexp.MustCompile(`\s+`)

func normalizeLabel(s string) string {
	s = strings.ToUpper(strings.TrimSpace(s))
	s = spaceRe.ReplaceAllString(s, " ")
	return s
}

// VehicleScrapeOutcome es el resultado de intentar un vehículo dentro de un
// lote — puede haber fallado individualmente sin tumbar todo el proceso.
type VehicleScrapeOutcome struct {
	URL     string              `json:"url"`
	Vehicle *VehicleWebsiteData `json:"vehicle,omitempty"`
	Error   string              `json:"error,omitempty"`
}

// ScrapeAllVehicles recorre la página de listado, saca todas las URLs de
// vehículo que encuentre, y scrapea cada una reutilizando el mismo navegador
// (mucho más rápido que abrir un Chrome por vehículo). Reporta progreso vía
// onProgress después de cada vehículo procesado (done, total) para que el
// caller pueda ir actualizando un job en curso. Un vehículo que falla no
// detiene el resto — queda registrado en el resultado con su error.
func ScrapeAllVehicles(parentCtx context.Context, listingURL string, onProgress func(done, total int)) ([]VehicleScrapeOutcome, error) {
	browserCtx, cancel := NewHeadlessBrowser(parentCtx)
	defer cancel()

	urls, err := ScrapeVehicleListing(browserCtx, listingURL)
	if err != nil {
		return nil, err
	}

	results := make([]VehicleScrapeOutcome, 0, len(urls))
	for i, u := range urls {
		data, err := ScrapeVehiclePage(browserCtx, u)
		outcome := VehicleScrapeOutcome{URL: u}
		if err != nil {
			outcome.Error = err.Error()
		} else {
			outcome.Vehicle = data
		}
		results = append(results, outcome)
		if onProgress != nil {
			onProgress(i+1, len(urls))
		}
	}
	return results, nil
}
