/* =========================================================
   Pestañas de sección (Inventario · Punto de venta)
   Cambiar de pestaña ya NO recarga la página:
   - La primera vez que abres una pestaña se trae su HTML, se pone en
     lugar del contenido actual y se arranca solo su módulo (se vuelve a
     correr el script de la página marcado con data-subnav-page; cada
     módulo solo arranca si su pestaña está en pantalla).
   - La pestaña que dejas se guarda tal cual (filtros, carrito, lo que
     estabas escribiendo). Al regresar aparece al instante y recibe el
     evento "subnav:show" en su <main> para actualizar sus datos.
   - La pastilla cian se desliza de una pestaña a otra con resorte y el
     contenido entra hacia el lado de la pestaña elegida.
   - Atrás / Adelante del navegador cambian de pestaña igual.
   Si algo falla, se navega normal (recarga), como antes.
   Usa .inv-seg-glow / .has-glow de inventory.css.
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

  /* ---------------------------------------------------------
     Pastilla de cada barra de pestañas
     --------------------------------------------------------- */
  function setup(nav) {
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

    // Aparece la barra (al cargar o al regresar a esta pestaña).
    // Si venimos de otra pestaña del mismo grupo, la pastilla sale de ahí.
    function arrive() {
      var on = current();
      var idx = links.indexOf(on);
      var prev = read();
      write(null);
      var fresh = prev && prev.group === group && Date.now() - prev.t < 6000 && prev.idx !== idx && prev.idx >= 0;
      var page = nav.closest('main') || document.querySelector('main');
      if (on && fresh && !reduce) {
        var from = links[prev.idx];
        put(from ? rectOf(from) : prev.r, false);
        requestAnimationFrame(function () { requestAnimationFrame(function () { place(true); }); });
        if (nav.scrollWidth > nav.clientWidth) on.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
        if (page) {
          page.classList.remove('subnav-leave', 'to-left', 'to-right');
          page.classList.add('subnav-enter', idx > prev.idx ? 'from-right' : 'from-left');
          setTimeout(function () { page.classList.remove('subnav-enter', 'from-right', 'from-left'); }, 800);
        }
      } else {
        if (page) page.classList.remove('subnav-leave', 'to-left', 'to-right');
        place(false);
        if (on && nav.scrollWidth > nav.clientWidth) on.scrollIntoView({ block: 'nearest', inline: 'center' });
      }
    }
    nav._arrive = arrive;

    window.addEventListener('resize', function () { if (nav.isConnected) place(false); });
    if (window.ResizeObserver) new ResizeObserver(function () { if (nav.isConnected) place(false); }).observe(nav);

    // Traer la pestaña antes de hacer clic (al pasar el cursor).
    nav.addEventListener('pointerover', function (e) {
      var a = e.target.closest('a');
      if (a && canSoft) prefetch(a.href);
    });

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
      if (!reduce) {
        put(rectOf(a), true);
        links.forEach(function (l) { l.classList.toggle('is-on', l === a); });
        if (page) page.classList.add('subnav-leave', links.indexOf(a) > idx ? 'to-left' : 'to-right');
      }
      go(a.href, true, reduce ? 0 : 170);
    });

    arrive();
  }

  /* ---------------------------------------------------------
     Cambio de pestaña sin recargar
     --------------------------------------------------------- */
  var cache = {};     // ruta → { inner, outer, title, scroll }
  var pending = {};   // ruta → Promise<Document>
  var busy = false;
  var shown = '';     // ruta de la pestaña que está en pantalla

  function wrapper(doc) { return doc.querySelector('.content-wrapper'); }

  // Lo que cambia entre pestañas: el contenido de .content-wrapper y los
  // modales que la plantilla pone después de .app-container.
  function partsOf(doc) {
    var cw = wrapper(doc), app = doc.querySelector('.app-container');
    if (!cw || !app) return null;
    var inner = Array.prototype.slice.call(cw.childNodes);
    var outer = [];
    for (var n = app.nextSibling; n; n = n.nextSibling) {
      if (n.nodeType === 1 && n.tagName === 'SCRIPT') break;
      outer.push(n);
    }
    return { inner: inner, outer: outer };
  }

  function prefetch(href) {
    var p = pathOf(href);
    if (!p || cache[p] || pending[p] || p === here()) return pending[p];
    pending[p] = fetch(href, { credentials: 'same-origin', headers: { Accept: 'text/html' } })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        // ¿Nos mandó a otra parte (sesión vencida)? Navegación normal.
        if (r.redirected && pathOf(r.url) !== p) throw new Error('redirect');
        return r.text();
      })
      .then(function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        if (!wrapper(doc)) throw new Error('sin contenido');
        return doc;
      });
    pending[p].catch(function () { delete pending[p]; });
    return pending[p];
  }

  function park() {
    var parts = partsOf(document);
    if (!parts) return null;
    var cw = wrapper(document);
    var saved = { inner: parts.inner, outer: parts.outer, title: document.title, scroll: cw.scrollTop };
    parts.inner.concat(parts.outer).forEach(function (n) {
      if (n.nodeType === 1) {
        n.setAttribute('data-subnav-parked', '');
        n.classList.remove('subnav-leave', 'to-left', 'to-right');
      }
      if (n.parentNode) n.parentNode.removeChild(n);
    });
    // Un modal abierto no se queda bloqueando el scroll de la otra pestaña.
    document.body.style.overflow = '';
    return saved;
  }

  function mount(saved) {
    var cw = wrapper(document), app = document.querySelector('.app-container');
    saved.inner.forEach(function (n) {
      if (n.nodeType === 1) n.removeAttribute('data-subnav-parked');
      cw.appendChild(n);
    });
    var ref = app.nextSibling;
    saved.outer.forEach(function (n) {
      if (n.nodeType === 1) n.removeAttribute('data-subnav-parked');
      app.parentNode.insertBefore(n, ref);
    });
    document.title = saved.title;
    cw.scrollTop = saved.scroll || 0;
  }

  function adopt(doc) {
    var parts = partsOf(doc);
    return {
      inner: parts.inner.map(function (n) { return document.adoptNode(n); }),
      outer: parts.outer.map(function (n) { return document.adoptNode(n); }),
      title: doc.title,
      scroll: 0,
    };
  }

  // Corre otra vez el script de la página para que arranque el módulo de
  // la pestaña nueva (los demás no arrancan: su pestaña no está en pantalla).
  function boot() {
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
  }

  function newNav() { return document.querySelector('.content-wrapper nav.inv-subnav'); }

  function go(href, push, delay) {
    var p = pathOf(href);
    if (!p) { location.href = href; return; }
    busy = true;
    var loading = cache[p] ? Promise.resolve(null) : prefetch(href);
    var wait = new Promise(function (r) { setTimeout(r, delay || 0); });
    Promise.all([loading, wait]).then(function (res) {
      var doc = res[0];
      // Con Atrás/Adelante la dirección ya cambió: se usa la pestaña en pantalla.
      var from = shown || here();
      var saved = park();
      if (!saved) throw new Error('sin contenido');
      cache[from] = saved;
      if (push) history.pushState({ subnav: p }, '', href);
      shown = p;
      var main;
      if (cache[p]) {
        var back = cache[p];
        delete cache[p];
        mount(back);
        var nav = newNav();
        if (nav && nav._arrive) nav._arrive();
        main = document.querySelector('.content-wrapper main');
        if (main) main.dispatchEvent(new CustomEvent('subnav:show', { detail: { path: p } }));
        busy = false;
        return;
      }
      delete pending[p];
      mount(adopt(doc));
      var nav2 = newNav();
      if (nav2) setup(nav2);
      return boot().then(function () { busy = false; });
    }).catch(function () {
      busy = false;
      location.href = href;
    });
  }

  // Atrás / Adelante
  window.addEventListener('popstate', function () {
    var p = here();
    var nav = newNav();
    if (!nav) { location.reload(); return; }
    var links = Array.prototype.slice.call(nav.querySelectorAll(':scope > a'));
    var target = links.filter(function (l) { return pathOf(l.href) === p; })[0];
    if (!target) { location.reload(); return; }
    var on = nav.querySelector(':scope > a.is-on');
    write({ group: nav.getAttribute('aria-label') || 'nav', idx: links.indexOf(on), r: null, t: Date.now() });
    go(location.href, false, 0);
  });

  function init() {
    if (canSoft) {
      // /pos → /pos/punto-de-venta: la dirección queda igual que el enlace de la pestaña.
      var on = document.querySelector('nav.inv-subnav > a.is-on');
      var url = on && pathOf(on.href) !== here() ? on.href.split('#')[0] + location.search : location.href;
      try { history.replaceState({ subnav: pathOf(url) }, '', url); } catch (e) {}
    }
    shown = here();
    document.querySelectorAll('nav.inv-subnav').forEach(setup);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  // Al regresar con "Atrás" desde otra página (guardada en memoria), quita la salida.
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    busy = false;
    shown = here();
    document.querySelectorAll('main.subnav-leave').forEach(function (m) { m.classList.remove('subnav-leave', 'to-left', 'to-right'); });
    document.querySelectorAll('nav.inv-subnav').forEach(function (nav) { if (nav._arrive) nav._arrive(); });
  });
})();