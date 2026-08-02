package services

import (
	"context"
	"fmt"
	"log"
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
//
// Configurado para consumir la menor memoria posible: no necesitamos ver
// nada (solo leer texto), así que desactivamos carga de imágenes y otras
// cosas que no usamos — importante porque un contenedor de Railway con RAM
// limitada puede matar a Chromium si intenta cargar fotos en alta
// resolución de varias tarjetas de golpe (típico en páginas de listado).
func NewHeadlessBrowser(parent context.Context) (context.Context, context.CancelFunc) {
	chromeOutput := &chromedpLogWriter{prefix: "🌐 [chromium stdout/stderr] "}
	allocCtx, cancelAlloc := chromedp.NewExecAllocator(parent, append(
		chromedp.DefaultExecAllocatorOptions[:],
		chromedp.Flag("headless", true),
		chromedp.Flag("disable-gpu", true),
		chromedp.Flag("no-sandbox", true), // necesario corriendo como root en el contenedor de Railway
		chromedp.Flag("disable-dev-shm-usage", true),
		// disable-hang-monitor: evita que Chrome mate por su cuenta una
		// pestaña que considera "no responde" — pasa con páginas muy pesadas
		// (472 tarjetas renderizando de golpe) aunque no sea un crash real ni
		// falta de memoria. Es el flag estándar que usan Puppeteer/Playwright
		// para scraping justamente por esto.
		chromedp.Flag("disable-hang-monitor", true),
		chromedp.Flag("disable-extensions", true),
		chromedp.Flag("disable-background-networking", true),
		chromedp.Flag("disable-default-apps", true),
		chromedp.Flag("disable-sync", true),
		chromedp.Flag("mute-audio", true),
		chromedp.Flag("no-first-run", true),
		chromedp.Flag("metrics-recording-only", true),
		chromedp.CombinedOutput(chromeOutput), // captura stdout/stderr crudo del proceso de Chromium — suele traer el motivo real de un crash
	)...)

	browserCtx, cancelBrowser := chromedp.NewContext(allocCtx,
		// Sin esto, cuando el navegador se cae por dentro (crash, error de
		// red, lo que sea) solo vemos "context canceled" del lado de Go, sin
		// ninguna pista de la causa real. Con esto, chromedp manda esos
		// detalles internos a nuestro log.
		chromedp.WithErrorf(func(format string, args ...interface{}) {
			log.Printf("🔴 [chromedp] "+format, args...)
		}),
	)

	cancel := func() {
		cancelBrowser()
		cancelAlloc()
	}
	return browserCtx, cancel
}

// chromedpLogWriter adapta un io.Writer (lo que pide CombinedOutput) para
// que la salida del proceso de Chromium vaya al log del servidor.
type chromedpLogWriter struct {
	prefix string
}

func (w *chromedpLogWriter) Write(p []byte) (int, error) {
	log.Printf("%s%s", w.prefix, strings.TrimRight(string(p), "\n"))
	return len(p), nil
}

func buildVehicleData(pageURL string, raw jsExtractResult) *VehicleWebsiteData {
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
	return data
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

	data := buildVehicleData(pageURL, raw)
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

	navCtx, cancelNav := context.WithTimeout(browserCtx, 60*time.Second)
	navErr := chromedp.Run(navCtx,
		chromedp.EmulateViewport(1280, 1024),
		chromedp.Navigate(listingURL),
		chromedp.WaitVisible(`body`, chromedp.ByQuery),
		// una página de listado con cientos de tarjetas tarda mucho más en
		// asentarse que la ficha de un solo vehículo — le damos más margen
		// antes de tocarla, para no interrumpir un render todavía en curso.
		chromedp.Sleep(12*time.Second),
	)
	cancelNav()
	if navErr != nil {
		return nil, fmt.Errorf("chromedp (listado): %w", navErr)
	}

	seen := map[string]bool{}
	const maxScrolls = 20
	stableRounds := 0
	for i := 0; i < maxScrolls && stableRounds < 2; i++ {
		roundCtx, cancelRound := context.WithTimeout(browserCtx, 15*time.Second)

		var links []string
		if err := chromedp.Run(roundCtx, chromedp.Evaluate(jsExtractListingLinks, &links)); err != nil {
			cancelRound()
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
		_ = chromedp.Run(roundCtx, chromedp.Evaluate(jsClickLoadMore, &clicked))
		_ = chromedp.Run(roundCtx,
			chromedp.KeyEvent(`End`),
			chromedp.Sleep(1500*time.Millisecond),
		)
		cancelRound()
	}

	urls := make([]string, 0, len(seen))
	for href := range seen {
		abs := *base
		abs.Path = href
		abs.RawQuery = ""
		urls = append(urls, abs.String())
	}
	// Nota: a propósito NO es un error devolver 0 URLs aquí — algunos sitios
	// (como uno basado en <button onClick> en vez de <a href>) simplemente no
	// tienen hrefs que encontrar. El caller (ScrapeAllVehicles) decide si cae
	// al método de clics en ese caso.
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

// ScrapeAllVehicles recorre la página de listado y scrapea cada vehículo
// que encuentre, reutilizando el mismo navegador (mucho más rápido que abrir
// un Chrome por vehículo). Primero intenta el método rápido (leer hrefs
// reales del HTML) — funciona en sitios donde las tarjetas son <a href>
// normales. Si no encuentra ninguno (p.ej. el sitio navega con
// onClick+router en vez de links reales, como Gran Auto Seminuevos), cae
// automáticamente al método de clics: le da clic a cada botón "Ver", lee la
// URL resultante, extrae los datos ahí mismo, y regresa al listado.
//
// maxVehicles limita cuántos procesa como máximo (protección ante listados
// enormes o loops infinitos de scroll) — 0 usa un default razonable.
func ScrapeAllVehicles(parentCtx context.Context, listingURL string, maxVehicles int, onProgress func(done, total int)) ([]VehicleScrapeOutcome, error) {
	if maxVehicles <= 0 {
		maxVehicles = 500
	}

	browserCtx, cancel := NewHeadlessBrowser(parentCtx)
	defer cancel()

	urls, err := ScrapeVehicleListing(browserCtx, listingURL)
	if err != nil {
		// reintento con un Chromium nuevo — un crash del navegador (p.ej. por
		// memoria) deja el contexto anterior inservible, así que no vale la
		// pena reintentar sobre el mismo browserCtx.
		cancel()
		browserCtx, cancel = NewHeadlessBrowser(parentCtx)
		urls, err = ScrapeVehicleListing(browserCtx, listingURL)
		if err != nil {
			cancel()
			return nil, fmt.Errorf("%w (falló también en el reintento)", err)
		}
	}
	defer cancel()

	if len(urls) > 0 {
		if len(urls) > maxVehicles {
			urls = urls[:maxVehicles]
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

	// No se encontraron hrefs reales — caer al método de clics.
	return scrapeAllVehiclesByClicking(browserCtx, listingURL, maxVehicles, onProgress)
}

// jsClickNextUnvisited busca, entre las tarjetas visibles en este momento,
// la primera cuyo botón "Ver" no se haya clickeado todavía en esta sesión
// (lo recuerda en window.__attomosScraped, que persiste entre navegaciones
// de cliente porque Next.js no recarga la página completa). Usa el texto
// completo de la tarjeta como identidad — no depende de ningún atributo o
// clase CSS específica, así que sobrevive a cambios de estilo del sitio.
const jsClickNextUnvisited = `
(() => {
	window.__attomosScraped = window.__attomosScraped || new Set();
	const buttons = Array.from(document.querySelectorAll('button, a')).filter(el => (el.textContent || '').trim() === 'Ver');
	for (const btn of buttons) {
		let card = btn;
		for (let i = 0; i < 6 && card.parentElement; i++) card = card.parentElement;
		const key = (card.innerText || btn.outerHTML).replace(/\s+/g, ' ').trim();
		if (!key || window.__attomosScraped.has(key)) continue;
		window.__attomosScraped.add(key);
		btn.scrollIntoView({block: 'center'});
		btn.click();
		return key;
	}
	return null;
})()
`

// scrapeAllVehiclesByClicking recorre el listado dándole clic a cada tarjeta
// (para sitios sin hrefs reales), extrae los datos de la página de detalle a
// la que navega, y regresa al listado para seguir con la siguiente. Cuando
// ya no encuentra tarjetas sin visitar, intenta cargar más (scroll / botón
// "cargar más") antes de darse por vencido.
func scrapeAllVehiclesByClicking(browserCtx context.Context, listingURL string, maxVehicles int, onProgress func(done, total int)) ([]VehicleScrapeOutcome, error) {
	navCtx, cancelNav := context.WithTimeout(browserCtx, 60*time.Second)
	err := chromedp.Run(navCtx,
		chromedp.EmulateViewport(1280, 1024),
		chromedp.Navigate(listingURL),
		chromedp.WaitVisible(`body`, chromedp.ByQuery),
		chromedp.Sleep(12*time.Second),
	)
	cancelNav()
	if err != nil {
		return nil, fmt.Errorf("chromedp (listado): %w", err)
	}

	var results []VehicleScrapeOutcome
	consecutiveEmpty := 0
	for len(results) < maxVehicles && consecutiveEmpty < 3 {
		var clickedKey *string
		clickCtx, cancelClick := context.WithTimeout(browserCtx, 10*time.Second)
		clickErr := chromedp.Run(clickCtx, chromedp.Evaluate(jsClickNextUnvisited, &clickedKey))
		cancelClick()
		if clickErr != nil {
			// un fallo puntual de evaluate no debería tumbar todo el lote —
			// lo tratamos como "no encontró nada esta vuelta" y seguimos
			clickedKey = nil
		}

		if clickedKey == nil {
			// no hay tarjetas nuevas visibles — intentamos cargar más
			scrollCtx, cancelScroll := context.WithTimeout(browserCtx, 15*time.Second)
			var loadedMore bool
			_ = chromedp.Run(scrollCtx, chromedp.Evaluate(jsClickLoadMore, &loadedMore))
			_ = chromedp.Run(scrollCtx, chromedp.KeyEvent(`End`), chromedp.Sleep(2*time.Second))
			cancelScroll()
			consecutiveEmpty++
			continue
		}
		consecutiveEmpty = 0

		waitCtx, cancelWait := context.WithTimeout(browserCtx, 15*time.Second)
		var currentURL string
		_ = chromedp.Run(waitCtx, chromedp.Sleep(2500*time.Millisecond), chromedp.Location(&currentURL))
		cancelWait()

		outcome := VehicleScrapeOutcome{URL: currentURL}
		if currentURL == "" || currentURL == listingURL || !strings.Contains(currentURL, "/inventory/") {
			outcome.Error = "el clic en \"Ver\" no navegó a una ficha de vehículo"
		} else {
			var raw jsExtractResult
			extractCtx, cancelExtract := context.WithTimeout(browserCtx, 15*time.Second)
			extractErr := chromedp.Run(extractCtx, chromedp.Evaluate(jsExtractSpecs, &raw))
			cancelExtract()
			if extractErr != nil {
				outcome.Error = extractErr.Error()
			} else {
				data := buildVehicleData(currentURL, raw)
				if data.Year == "" && data.Mileage == "" && data.Color == "" {
					outcome.Error = "no se encontraron specs reconocibles en la ficha"
				} else {
					outcome.Vehicle = data
				}
			}
		}
		results = append(results, outcome)
		if onProgress != nil {
			onProgress(len(results), maxVehicles)
		}

		backCtx, cancelBack := context.WithTimeout(browserCtx, 15*time.Second)
		_ = chromedp.Run(backCtx, chromedp.NavigateBack(), chromedp.Sleep(2500*time.Millisecond))
		cancelBack()
	}

	if len(results) == 0 {
		return nil, fmt.Errorf("no se pudo hacer clic en ningún vehículo del listado (¿cambió el HTML del sitio?)")
	}
	return results, nil
}
