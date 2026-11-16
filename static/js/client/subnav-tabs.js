/* =========================================================
   Pestañas de sección (Inventario · Punto de venta)
   Cambiar de pestaña se siente como una sola página:
   - Al cargar, en cuanto el navegador está libre, se traen las demás
     pestañas y se arrancan escondidas (se vuelve a correr el script de la
     página marcado con data-subnav-page; cada módulo arranca una sola vez).
     Así ya tienen sus datos cuando las abres: el cambio es instantáneo.
   - Las pestañas se quedan en la página (ocultas), con sus filtros, el
     carrito o lo que estabas escribiendo. Al mostrarse reciben el evento
     "subnav:show" en su <main> y actualizan sus datos en silencio.
   - La pastilla cian se desliza de una pestaña a otra con resorte y el
     contenido entra hacia el lado de la pestaña elegida.
   - Atrás / Adelante del navegador cambian de pestaña igual.
   Si algo falla, se navega normal (recarga), como antes.
   Usa .inv-seg-glow / .has-glow y [data-subnav-off] de inventory.css.
   ========================================================= */
(function () {
  'use strict';
  var KEY = 'attomos.subnav';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var canSoft = !!(window.fetch && window.DOMParser && window.history && history.pushState);

  function read() { try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
  function write(v) { try { sessionStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} }
  function pathOf(href) { try { return new URL(href, location.href).pathname.replace(/\/+$/, '') || '/'; } catch (e) { return ''; } }
  function here() { return pathOf(location.href); }

  var tabs = {};      // ruta → { inner: [nodos], main, title, scroll }
  var pending = {};   // ruta → Promise<Document>
  var shown = '';     // ruta de la pestaña en pantalla
  var busy = false;

  function wrapper() { return document.querySelector('.content-wrapper'); }
  function visibleNav() {
    var t = tabs[shown];
    return t && t.main ? t.main.querySelector('nav.inv-subnav') : document.querySelector('.content-wrapper nav.inv-subnav');
  }

  /* ---------------------------------------------------------
     Pastilla de cada barra de pestañas
     --------------------------------------------------------- */
  function setup(nav, quiet) {
    if (nav._glow) return;
    var links = Array.prototype.slice.call(nav.querySelectorAll(':scope > a'));
    if (!links.length) return;
    var glow = document.createElement('span');
    glow.className = 'inv-seg-glow';
    glow.setAttribute('aria-hidden', 'true');
    nav.insertBefore(glow, nav.firstChild);
    nav._glow = glow;
    nav.classList.add('has-glow');
    var group = nav.getAttribute('aria-label') || 'nav';

    function current() {
      var p = here();
      var on = links.filter(function (l) { return pathOf(l.href) === p; })[0] || nav.querySelector(':scope > a.is-on');
      links.forEach(function (l) { l.classList.toggle('is-on', l === on); });
      return on;
    }
    function rectOf(el) { return { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight }; }
    function put(r, animate) {
      if (!r) return;
      if (!animate) glow.style.transition = 'none';
      glow.style.opacity = '1';
      glow.style.width = r.w + 'px';
      glow.style.height = r.h + 'px';
      glow.style.transform = 'translate(' + r.x + 'px,' + r.y + 'px)';
      if (!animate) { void glow.offsetWidth; glow.style.transition = ''; }
    }
    function place(animate) {
      var on = nav.querySelector(':scope > a.is-on');
      if (on && on.offsetWidth) put(rectOf(on), animate);
    }

    // Aparece la barra (al cargar o al mostrar esta pestaña). Si venimos de
    // otra pestaña del mismo grupo, la pastilla sale de ahí.
    function arrive() {
      var on = current();
      var idx = links.indexOf(on);
      var prev = read();
      write(null);
      var fresh = prev && prev.group === group && Date.now() - prev.t < 6000 && prev.idx !== idx && prev.idx >= 0;
      var page = nav.closest('main') || document.querySelector('main');
      if (on && fresh && !reduce) {
        var from = links[prev.idx];
        put(from && from.offsetWidth ? rectOf(from) : prev.r, false);
        requestAnimationFrame(function () { requestAnimationFrame(function () { place(true); }); });
        if (nav.scrollWidth > nav.clientWidth) on.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
        if (page) {
          page.classList.remove('subnav-leave', 'to-left', 'to-right', 'subnav-enter', 'from-right', 'from-left');
          void page.offsetWidth;
          page.classList.add('subnav-enter', idx > prev.idx ? 'from-right' : 'from-left');
          clearTimeout(page._enterT);
          page._enterT = setTimeout(function () { page.classList.remove('subnav-enter', 'from-right', 'from-left'); }, 800);
        }
      } else {
        if (page) page.classList.remove('subnav-leave', 'to-left', 'to-right');
        place(false);
        if (on && nav.scrollWidth > nav.clientWidth) on.scrollIntoView({ block: 'nearest', inline: 'center' });
      }
    }
    nav._arrive = arrive;
    nav._links = links;

    window.addEventListener('resize', function () { if (nav.offsetParent) place(false); });
    if (window.ResizeObserver) new ResizeObserver(function () { if (nav.offsetParent) place(false); }).observe(nav);

    // Al hacer clic: la pastilla se va hacia la pestaña y se recuerda de dónde salió.
    nav.addEventListener('click', function (e) {
      var a = e.target.closest('a');
      var on = nav.querySelector(':scope > a.is-on');
      if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) return;
      e.preventDefault();
      if (a === on || busy) return;
      var idx = links.indexOf(on);
      write({ group: group, idx: idx, r: on ? rectOf(on) : null, t: Date.now() });
      if (!canSoft) { window.location.href = a.href; return; }
      var page = nav.closest('main');
      var ready = !!tabs[pathOf(a.href)];
      if (!reduce) {
        put(rectOf(a), true);
        links.forEach(function (l) { l.classList.toggle('is-on', l === a); });
        if (page) page.classList.add('subnav-leave', links.indexOf(a) > idx ? 'to-left' : 'to-right');
      }
      // Ya cargada: cambio casi inmediato; si no, se espera a que llegue.
      go(a.href, true, reduce ? 0 : (ready ? 120 : 170));
    });

    if (!quiet) arrive();
  }

  /* ---------------------------------------------------------
     Pestañas en la página
     --------------------------------------------------------- */

  // Lo que cambia entre pestañas: el contenido de .content-wrapper. Los
  // modales de cada pestaña (después de .app-container) se quedan siempre.
  function partsOf(doc) {
    var cw = doc.querySelector('.content-wrapper'), app = doc.querySelector('.app-container');
    if (!cw || !app) return null;
    var inner = Array.prototype.slice.call(cw.childNodes);
    var outer = [];
    for (var n = app.nextSibling; n; n = n.nextSibling) {
      if (n.nodeType === 1 && n.tagName === 'SCRIPT') break;
      outer.push(n);
    }
    return { inner: inner, outer: outer };
  }

  function register(path, inner, title) {
    var main = null;
    inner.forEach(function (n) { if (!main && n.nodeType === 1) main = n.tagName === 'MAIN' ? n : n.querySelector('main'); });
    tabs[path] = { inner: inner, main: main, title: title, scroll: 0 };
    return tabs[path];
  }

  function setOff(t, off) {
    t.inner.forEach(function (n) {
      if (n.nodeType !== 1) return;
      if (off) n.setAttribute('data-subnav-off', ''); else n.removeAttribute('data-subnav-off');
    });
  }

  function prefetch(href) {
    var p = pathOf(href);
    if (!p || tabs[p]) return Promise.resolve(null);
    if (pending[p]) return pending[p];
    pending[p] = fetch(href, { credentials: 'same-origin', headers: { Accept: 'text/html' } })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        if (r.redirected && pathOf(r.url) !== p) throw new Error('redirect'); // sesión vencida
        return r.text();
      })
      .then(function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        if (!doc.querySelector('.content-wrapper')) throw new Error('sin contenido');
        return doc;
      });
    pending[p].catch(function () { delete pending[p]; });
    return pending[p];
  }

  // Pone una pestaña traída en la página, escondida.
  function mount(path, doc) {
    if (tabs[path]) return tabs[path];
    var parts = partsOf(doc);
    var cw = wrapper(), app = document.querySelector('.app-container');
    var inner = parts.inner.map(function (n) { return document.adoptNode(n); });
    var t = register(path, inner, doc.title);
    setOff(t, true);
    inner.forEach(function (n) { cw.appendChild(n); });
    // Modales: van junto a los de las otras pestañas (antes de los <script>).
    var ref = document.querySelector('body > script');
    parts.outer.forEach(function (n) { document.body.insertBefore(document.adoptNode(n), ref || null); });
    var nav = t.main && t.main.querySelector('nav.inv-subnav');
    if (nav) setup(nav, true);
    return t;
  }

  // Corre otra vez el script de la página: arrancan los módulos de las
  // pestañas recién puestas (los que ya estaban no se repiten).
  var booting = Promise.resolve();
  function boot() {
    booting = booting.then(function () {
      var list = Array.prototype.slice.call(document.querySelectorAll('script[data-subnav-page]'));
      return list.reduce(function (chain, old) {
        return chain.then(function () {
          return new Promise(function (resolve) {
            var s = document.createElement('script');
            s.src = old.src;
            s.onload = s.onerror = function () { resolve(); s.remove(); };
            document.body.appendChild(s);
          });
        });
      }, Promise.resolve());
    });
    return booting;
  }

  function show(path, push, href) {
    var from = tabs[shown], to = tabs[path];
    var cw = wrapper();
    if (from && from !== to) {
      from.scroll = cw.scrollTop;
      setOff(from, true);
      if (from.main) from.main.classList.remove('subnav-leave', 'to-left', 'to-right');
    }
    document.body.style.overflow = '';
    setOff(to, false);
    if (push) history.pushState({ subnav: path }, '', href);
    shown = path;
    document.title = to.title || document.title;
    cw.scrollTop = to.scroll || 0;
    var nav = to.main && to.main.querySelector('nav.inv-subnav');
    if (nav) { if (!nav._glow) setup(nav); else nav._arrive(); }
    if (to.main) to.main.dispatchEvent(new CustomEvent('subnav:show', { detail: { path: path } }));
  }

  function go(href, push, delay) {
    var p = pathOf(href);
    if (!p) { location.href = href; return; }
    busy = true;
    var wait = new Promise(function (r) { setTimeout(r, delay || 0); });
    var ready = tabs[p] ? Promise.resolve() : prefetch(href).then(function (doc) {
      if (!doc) return;
      mount(p, doc);
      return boot();
    });
    Promise.all([ready, wait]).then(function () {
      if (!tabs[p]) throw new Error('sin pestaña');
      show(p, push, href);
      busy = false;
    }).catch(function () {
      busy = false;
      location.href = href;
    });
  }

  // Trae y arranca las demás pestañas en cuanto el navegador está libre.
  function preload() {
    var nav = visibleNav();
    if (!nav || !canSoft) return;
    var hrefs = Array.prototype.slice.call(nav.querySelectorAll(':scope > a'))
      .map(function (a) { return a.href; })
      .filter(function (h) { return !tabs[pathOf(h)]; });
    if (!hrefs.length) return;
    // De una en una, para no competir con lo que carga la pestaña actual.
    hrefs.reduce(function (chain, h) {
      return chain.then(function () {
        return prefetch(h).then(function (doc) { if (doc) mount(pathOf(h), doc); }).catch(function () {});
      });
    }, Promise.resolve()).then(function () { return boot(); });
  }

  // Atrás / Adelante
  window.addEventListener('popstate', function () {
    var p = here();
    var nav = visibleNav();
    if (!nav || !nav._links) { location.reload(); return; }
    var target = nav._links.filter(function (l) { return pathOf(l.href) === p; })[0];
    if (!target) { location.reload(); return; }
    var on = nav.querySelector(':scope > a.is-on');
    write({ group: nav.getAttribute('aria-label') || 'nav', idx: nav._links.indexOf(on), r: null, t: Date.now() });
    go(location.href, false, 0);
  });

  function init() {
    var nav = document.querySelector('.content-wrapper nav.inv-subnav');
    if (canSoft && nav) {
      // /pos → /pos/punto-de-venta: la dirección queda igual que el enlace de la pestaña.
      var on = nav.querySelector(':scope > a.is-on');
      var url = on && pathOf(on.href) !== here() ? on.href.split('#')[0] + location.search : location.href;
      try { history.replaceState({ subnav: pathOf(url) }, '', url); } catch (e) {}
      var parts = partsOf(document);
      if (parts) register(here(), parts.inner, document.title);
    }
    shown = here();
    document.querySelectorAll('nav.inv-subnav').forEach(function (n) { setup(n); });
    if (canSoft && nav) {
      var start = function () {
        if (window.requestIdleCallback) requestIdleCallback(preload, { timeout: 2500 });
        else setTimeout(preload, 1200);
      };
      if (document.readyState === 'complete') setTimeout(start, 600);
      else window.addEventListener('load', function () { setTimeout(start, 600); });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  // Al regresar con "Atrás" desde otra página (guardada en memoria), quita la salida.
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    busy = false;
    document.querySelectorAll('main.subnav-leave').forEach(function (m) { m.classList.remove('subnav-leave', 'to-left', 'to-right'); });
    var nav = visibleNav();
    if (nav && nav._arrive) nav._arrive();
  });
})();