/* =========================================================
   PUNTO DE VENTA — Attomos (sidebar → Punto de venta)
   Portado del Punto de venta de Avante Optics. Todo en un archivo; cada
   módulo solo arranca si su pestaña está en la página:
     AvSelect · AvDate · Punto de venta · Ventas · Corte de caja
   (el ticket vive en pos-ticket-render.js, que también usa el ticket público)
   ========================================================= */
/* Datos del negocio para el ticket (los pone el servidor en data-biz). */
(function () {
  var el = document.querySelector('[data-biz]');
  try { window.POS_BIZ = el ? JSON.parse(el.getAttribute('data-biz') || '{}') : {}; } catch (e) { window.POS_BIZ = {}; }
})();

/* ---------------------------------------------------------------- av-select.js */
/* =========================================================
   AV-SELECT — convierte un <select> en el dropdown animado del
   panel (mismo look que el selector de rol de Base de datos:
   botón con flecha que gira y menú que aparece deslizándose).
   El <select> real se queda escondido adentro y sigue siendo la
   fuente de verdad: el código que ya lee .value o escucha
   "change" no cambia.

   Uso:
     AvSelect.enhance(selectEl)
     AvSelect.enhanceAll(contenedor)   // todos los select[data-av-select]
   Si el código cambia las <option> del select, el menú se
   actualiza solo.
   ========================================================= */
window.AvSelect = (function(){
  var CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
  var CHECK = '<svg class="av-select-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
  var openOne = null;

  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
    });
  }

  function closeAll(except){
    document.querySelectorAll('.av-select.is-open').forEach(function(w){
      if (w !== except){ w.classList.remove('is-open'); w.querySelector('.av-select-btn').setAttribute('aria-expanded', 'false'); }
    });
    if (!except) openOne = null;
  }
  document.addEventListener('click', function(e){ if (!e.target.closest('.av-select')) closeAll(); });
  window.addEventListener('blur', function(){ closeAll(); });

  function enhance(sel){
    if (!sel || sel._av) return sel && sel._av;
    var wrap = document.createElement('div');
    wrap.className = 'av-select';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'av-select-btn';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    if (sel.id) btn.id = sel.id + 'Btn';
    btn.innerHTML = '<span class="av-select-label"></span>' + CHEV;
    var menu = document.createElement('div');
    menu.className = 'av-select-menu';
    menu.setAttribute('role', 'listbox');

    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(btn);
    wrap.appendChild(menu);
    wrap.appendChild(sel);
    sel.classList.add('av-native');
    sel.tabIndex = -1;
    sel.setAttribute('aria-hidden', 'true');

    var active = -1;

    function sync(){
      var opts = Array.prototype.slice.call(sel.options);
      menu.innerHTML = opts.map(function(o, i){
        return '<button type="button" role="option" class="av-select-option' + (o.selected ? ' active' : '') + '" data-i="' + i + '" style="--i:' + Math.min(i, 12) + '"' +
          (o.disabled ? ' disabled' : '') + ' aria-selected="' + (o.selected ? 'true' : 'false') + '"><span>' + esc(o.textContent) + '</span>' + CHECK + '</button>';
      }).join('');
      var cur = sel.options[sel.selectedIndex];
      btn.querySelector('.av-select-label').textContent = cur ? cur.textContent : '';
      wrap.classList.toggle('is-disabled', sel.disabled);
      btn.disabled = sel.disabled;
    }

    function setOpen(on){
      if (on){
        closeAll(wrap);
        // Si abajo no cabe (p. ej. al final de un modal), abre hacia arriba.
        wrap.classList.remove('is-up');
        var r = btn.getBoundingClientRect(), limit = window.innerHeight, top = 0;
        for (var p = wrap.parentElement; p && p !== document.body; p = p.parentElement){
          var ov = getComputedStyle(p).overflowY;
          if (ov === 'auto' || ov === 'scroll' || ov === 'hidden'){ var pr = p.getBoundingClientRect(); limit = Math.min(limit, pr.bottom); top = Math.max(top, pr.top); break; }
        }
        var need = Math.min(280, sel.options.length * 38 + 16);
        if (limit - r.bottom < need + 12 && r.top - top > limit - r.bottom) wrap.classList.add('is-up');
        wrap.classList.add('is-open');
        btn.setAttribute('aria-expanded', 'true');
        openOne = wrap;
        active = sel.selectedIndex;
        highlight();
        var act = menu.querySelector('.av-select-option.active');
        if (act) menu.scrollTop = Math.max(0, act.offsetTop - menu.clientHeight / 2);
      } else {
        wrap.classList.remove('is-open');
        btn.setAttribute('aria-expanded', 'false');
        if (openOne === wrap) openOne = null;
      }
    }
    function highlight(){
      menu.querySelectorAll('.av-select-option').forEach(function(b, i){ b.classList.toggle('is-hover', i === active); });
    }
    function choose(i){
      if (i < 0 || i >= sel.options.length || sel.options[i].disabled) return;
      var changed = sel.selectedIndex !== i;
      sel.selectedIndex = i;
      sync();
      setOpen(false);
      btn.classList.remove('is-picked'); void btn.offsetWidth; btn.classList.add('is-picked');
      if (changed) sel.dispatchEvent(new Event('change', { bubbles: true }));
      btn.focus();
    }

    // preventDefault: el select suele ir dentro de un <label>, y sin
    // esto el navegador "reenvía" el clic al botón y el menú se reabre.
    btn.addEventListener('click', function(e){ e.preventDefault(); setOpen(!wrap.classList.contains('is-open')); });
    menu.addEventListener('click', function(e){
      e.preventDefault();
      var o = e.target.closest('.av-select-option');
      if (o) choose(+o.dataset.i);
    });
    btn.addEventListener('keydown', function(e){
      var open = wrap.classList.contains('is-open');
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp'){
        e.preventDefault();
        if (!open){ setOpen(true); return; }
        var n = sel.options.length, d = e.key === 'ArrowDown' ? 1 : -1;
        for (var k = 0; k < n; k++){ active = (active + d + n) % n; if (!sel.options[active].disabled) break; }
        highlight();
      } else if ((e.key === 'Enter' || e.key === ' ') && open){
        e.preventDefault(); choose(active);
      } else if (e.key === 'Escape' && open){
        e.preventDefault(); setOpen(false);
      }
    });
    sel.addEventListener('change', sync);
    new MutationObserver(sync).observe(sel, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled'] });

    sync();
    sel._av = { wrap: wrap, sync: sync };
    return sel._av;
  }

  function enhanceAll(root){
    (root || document).querySelectorAll('select[data-av-select]').forEach(enhance);
  }

  return { enhance: enhance, enhanceAll: enhanceAll, closeAll: function(){ closeAll(); } };
})();
/* ---------------------------------------------------------------- av-date.js */
/* =========================================================
   AV-DATE — convierte un <input type="date"> en el calendario
   animado del panel (el mismo .cb-datepicker de "Crear cita" y de
   los filtros Desde / Hasta de Citas).
   El <input> real se queda escondido y sigue siendo la fuente de
   verdad: el código que ya lee .value, lo cambia o escucha
   "change" no cambia nada.

   Uso:
     AvDate.enhance(input, { align: 'end' })   // menú pegado a la derecha
     AvDate.pair(desde, hasta)                 // marca el rango entre los dos
     AvDate.enhanceAll(contenedor)             // todos los input[data-av-date]
   Respeta min / max del input. Estilos en citas-recepcion.css.
   ========================================================= */
window.AvDate = (function () {
  'use strict';
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var CAL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>';
  var CARET = '<svg class="cf-dp-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
  var PREV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>';
  var NEXT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>';
  var nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  var open = null;

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; }
  function txt(s) { var d = parse(s); return d ? pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() : 'dd/mm/aaaa'; }

  function closeAll(except) {
    document.querySelectorAll('.av-date.is-open').forEach(function (w) { if (w !== except && w._av) w._av.close(); });
  }
  document.addEventListener('mousedown', function (e) { if (open && !e.target.closest('.av-date')) closeAll(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && open) { e.stopPropagation(); closeAll(); } }, true);
  window.addEventListener('resize', function () { closeAll(); });
  window.addEventListener('scroll', function (e) { if (open && !(e.target && e.target.closest && e.target.closest('.cb-datepicker-menu'))) closeAll(); }, true);

  function enhance(input, opts) {
    if (!input || input._avDate) return input && input._avDate;
    opts = opts || {};
    var wrap = document.createElement('div');
    wrap.className = 'cb-datepicker cf-dp av-date' + (opts.align === 'end' ? ' cf-dp--end' : '');
    wrap.innerHTML =
      '<button type="button" class="cb-datepicker-trigger" aria-haspopup="dialog" aria-expanded="false">' + CAL +
        '<span class="cb-datepicker-value"></span>' + CARET + '</button>' +
      '<div class="cb-datepicker-menu" role="dialog">' +
        '<div class="cb-datepicker-nav"><button type="button" data-nav="-1" aria-label="Mes anterior">' + PREV + '</button>' +
          '<span class="av-date-label"></span><button type="button" data-nav="1" aria-label="Mes siguiente">' + NEXT + '</button></div>' +
        '<div class="cb-datepicker-weekdays"><span>do</span><span>lu</span><span>ma</span><span>mi</span><span>ju</span><span>vi</span><span>sá</span></div>' +
        '<div class="cb-datepicker-grid"></div>' +
        '<div class="cb-datepicker-actions"><button type="button" data-act="hoy">Hoy</button></div>' +
      '</div>';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    input.classList.add('av-date-native');
    input.tabIndex = -1;
    input.setAttribute('aria-hidden', 'true');

    var btn = wrap.querySelector('.cb-datepicker-trigger');
    var menu = wrap.querySelector('.cb-datepicker-menu');
    var grid = wrap.querySelector('.cb-datepicker-grid');
    var label = wrap.querySelector('.av-date-label');
    var valEl = wrap.querySelector('.cb-datepicker-value');
    var view = parse(input.value) || new Date();
    view = new Date(view.getFullYear(), view.getMonth(), 1);
    var api = { wrap: wrap, partner: null, sync: sync, close: close, render: render };
    input._avDate = api;
    wrap._av = api;

    // Si el código cambia input.value, el calendario se entera.
    Object.defineProperty(input, 'value', {
      configurable: true,
      get: function () { return nativeValue.get.call(this); },
      set: function (v) { nativeValue.set.call(this, v); sync(); if (api.partner) api.partner.render(); }
    });

    function sync() {
      var v = input.value;
      valEl.textContent = txt(v);
      wrap.classList.toggle('is-empty', !v);
      wrap.classList.toggle('is-disabled', input.disabled);
      btn.disabled = input.disabled;
      if (wrap.classList.contains('is-open')) render();
    }
    function render() {
      label.textContent = MESES[view.getMonth()] + ' ' + view.getFullYear();
      var first = new Date(view.getFullYear(), view.getMonth(), 1);
      var start = new Date(first); start.setDate(1 - first.getDay());
      var sel = input.value, today = iso(new Date());
      var min = input.min || '', max = input.max || '';
      var other = api.partner ? api.partner.inputValue() : '';
      var lo = sel && other ? (sel < other ? sel : other) : '', hi = sel && other ? (sel < other ? other : sel) : '';
      var html = '';
      for (var i = 0; i < 42; i++) {
        var d = new Date(start); d.setDate(start.getDate() + i);
        var k = iso(d);
        var cls = 'cb-datepicker-day';
        if (d.getMonth() !== view.getMonth()) cls += ' is-outside';
        if (k === today) cls += ' is-today';
        if (k === sel) cls += ' is-selected';
        else if (lo && k > lo && k < hi) cls += ' is-inrange';
        else if (other && k === other) cls += ' is-inrange';
        if ((min && k < min) || (max && k > max)) cls += ' is-disabled';
        html += '<button type="button" class="' + cls + '" data-d="' + k + '" style="--i:' + i + '">' + d.getDate() + '</button>';
      }
      grid.innerHTML = html;
    }
    function place() {
      // Fijo a la ventana: así no lo recorta un modal ni una tabla con scroll.
      var r = btn.getBoundingClientRect();
      var w = Math.min(280, window.innerWidth - 16);
      menu.style.position = 'fixed';
      menu.style.width = w + 'px';
      var left = opts.align === 'end' ? r.right - w : r.left;
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
      menu.style.left = left + 'px';
      menu.style.right = 'auto';
      var h = menu.offsetHeight || 330;
      var up = r.bottom + 8 + h > window.innerHeight && r.top - 8 - h > 0;
      menu.style.top = (up ? r.top - 8 - h : r.bottom + 8) + 'px';
      menu.style.transformOrigin = (up ? 'bottom ' : 'top ') + (opts.align === 'end' ? 'right' : 'left');
      wrap.classList.toggle('is-up', up);
    }
    function openMenu() {
      closeAll(wrap);
      var d = parse(input.value) || (api.partner && parse(api.partner.inputValue())) || new Date();
      view = new Date(d.getFullYear(), d.getMonth(), 1);
      render();
      wrap.classList.add('is-open');
      btn.setAttribute('aria-expanded', 'true');
      place();
      open = wrap;
    }
    function close() {
      wrap.classList.remove('is-open');
      btn.setAttribute('aria-expanded', 'false');
      if (open === wrap) open = null;
    }
    function pick(k) {
      var changed = input.value !== k;
      input.value = k;
      close();
      btn.classList.remove('is-picked'); void btn.offsetWidth; btn.classList.add('is-picked');
      if (changed) {
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      btn.focus();
    }
    api.inputValue = function () { return input.value; };

    // preventDefault: el calendario suele ir dentro de un <label>.
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      if (wrap.classList.contains('is-open')) close(); else openMenu();
    });
    menu.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var nav = e.target.closest('[data-nav]');
      if (nav) {
        view = new Date(view.getFullYear(), view.getMonth() + Number(nav.getAttribute('data-nav')), 1);
        grid.classList.remove('is-slide-l', 'is-slide-r'); void grid.offsetWidth;
        grid.classList.add(nav.getAttribute('data-nav') === '1' ? 'is-slide-l' : 'is-slide-r');
        render();
        return;
      }
      if (e.target.closest('[data-act="hoy"]')) { pick(iso(new Date())); return; }
      var day = e.target.closest('[data-d]');
      if (day && !day.classList.contains('is-disabled')) pick(day.getAttribute('data-d'));
    });
    btn.addEventListener('keydown', function (e) {
      if ((e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') && !wrap.classList.contains('is-open')) { e.preventDefault(); openMenu(); }
    });
    input.addEventListener('change', sync);
    new MutationObserver(sync).observe(input, { attributes: true, attributeFilter: ['disabled', 'min', 'max'] });
    sync();
    return api;
  }

  // Desde / Hasta: cada uno marca el rango hasta la fecha del otro.
  function pair(a, b) {
    var A = enhance(a), B = enhance(b, { align: 'end' });
    if (!A || !B) return;
    A.partner = B; B.partner = A;
  }

  function enhanceAll(root) {
    (root || document).querySelectorAll('input[type="date"][data-av-date]').forEach(function (i) {
      enhance(i, { align: i.getAttribute('data-av-date') === 'end' ? 'end' : '' });
    });
  }

  return { enhance: enhance, pair: pair, enhanceAll: enhanceAll, closeAll: function () { closeAll(); } };
})();
/* ---------------------------------------------------------------- calendarios (Ventas / Corte de caja) */
(function () {
  function $(id) { return document.getElementById(id); }
  if ($('vtPage')) {
    AvDate.pair($('vtDesde'), $('vtHasta'));
    AvDate.enhance($('vtExpDia'));
    AvDate.enhance($('vtExpSemana'));
  }
  if ($('ccPage')) {
    AvDate.pair($('ccMovDesde'), $('ccMovHasta'));
    AvDate.pair($('ccSDesde'), $('ccSHasta'));
  }
})();

/* ---------------------------------------------------------------- punto de venta */
/* =========================================================
   RECEPCIÓN — Punto de venta (como en SICAR)
   · Productos: del inventario (GET /api/pos/inventario).
   · Clientes: /api/pos/clientes (No., clave,
     representante, días y límite de crédito) con lo que deben.
   · Cobrar: efectivo, tarjeta, transferencia, vales, cheque y
     crédito. CRÉDITO = lo que el cliente queda a deber (deja un
     anticipo y paga el resto al recoger sus lentes). No es MSI.
     Al aceptar se guarda la venta y se descuenta el inventario
     (POST /api/pos/ventas).
   · Créditos y abonos (F4): lista de créditos del cliente, sus
     abonos, abonar (F3), saldar total, cancelar abono del día e
     imprimir recibo.
   · Imprime el ticket con la plantilla de Recepción → Plantillas
     (ticket-render.js).
   ========================================================= */
(function () {
  'use strict';
  var page = document.getElementById('posPage');
  if (!page) return;
  var T = window.PosTicket;
  var cajero = page.getAttribute('data-cajero') || '';

  var mxn = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2 });
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
  function initials(name) {
    return String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase();
  }

  /* =======================================================
     PRODUCTOS
     ======================================================= */
  var searchInput = $('posSearch');
  var grid = $('posGrid');
  var products = [];
  var reqId = 0, timer;

  // Los servicios no llevan existencia: siempre se pueden vender.
  var SERV_STOCK = 9999;
  function avail(p) { return p.servicio ? SERV_STOCK : p.cantidad_actual; }
  function stockLabel(n, servicio) {
    if (servicio) return '<span class="pos-stock is-serv">Servicio</span>';
    if (n <= 0) return '<span class="pos-stock is-out">Agotado</span>';
    if (n <= 2) return '<span class="pos-stock is-low">Quedan ' + n + '</span>';
    return '<span class="pos-stock">' + n + ' en existencia</span>';
  }

  function renderProducts() {
    var q = searchInput.value.trim();
    grid.innerHTML = products.map(function (p, i) {
      var inCart = lineOf(p.id);
      var out = avail(p) <= 0;
      return '<button type="button" class="pos-prod' + (out ? ' is-out' : '') + (inCart ? ' in-cart' : '') + '" data-id="' + p.id + '" style="--i:' + Math.min(i, 12) + '"' + (out ? ' aria-disabled="true"' : '') + '>' +
        // Foto principal del artículo (Inventario → Editar → Fotos).
        '<span class="pos-prod-photo" aria-hidden="true">' +
          (p.foto ? '<img src="' + esc(p.foto) + '" alt="" loading="lazy">'
                  : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="14" r="3.5"/><circle cx="18" cy="14" r="3.5"/><path d="M9.5 14h5M2.5 13 4 7h3M21.5 13 20 7h-3"/></svg>') +
          (inCart ? '<span class="pos-prod-qty">' + inCart.cantidad + '</span>' : '') +
        '</span>' +
        '<span class="pos-prod-body">' +
          (p.clave ? '<span class="pos-prod-clave">' + esc(p.clave) + '</span>' : '') +
          '<span class="pos-prod-name">' + esc(p.descripcion) + '</span>' +
          '<span class="pos-prod-foot"><strong>' + mxn.format(p.precio_venta) + '</strong>' + stockLabel(p.cantidad_actual, p.servicio) + '</span>' +
        '</span>' +
      '</button>';
    }).join('');
    $('posCount').textContent = products.length
      ? (products.length === 1 ? '1 producto' : products.length + ' productos') + (q ? ' para «' + q + '»' : '')
      : '';
    var empty = $('posEmpty');
    empty.hidden = products.length > 0;
    if (!products.length) empty.textContent = q ? 'No hay nada en el inventario que coincida con «' + q + '».' : 'El inventario está vacío por ahora.';
  }

  function searchProducts() {
    var q = searchInput.value.trim();
    var my = ++reqId;
    $('posSpinner').hidden = false;
    return fetch('/api/pos/inventario?q=' + encodeURIComponent(q), { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || 'No se pudo buscar.'); return d; }); })
      .then(function (d) {
        if (my !== reqId) return;
        products = (d.items || []).map(function (p) {
          return { id: p.id, clave: p.clave || '', descripcion: p.descripcion || '', precio_venta: Number(p.precio_venta) || 0, cantidad_actual: Number(p.cantidad_actual) || 0, servicio: !!p.servicio, foto: p.foto || '' };
        });
        renderProducts();
      })
      .catch(function (err) {
        if (my !== reqId) return;
        products = [];
        grid.innerHTML = '';
        $('posEmpty').hidden = false;
        $('posEmpty').textContent = err.message || 'No se pudo buscar en el inventario.';
      })
      .finally(function () { if (my === reqId) $('posSpinner').hidden = true; });
  }

  searchInput.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(searchProducts, 220); });
  searchInput.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    clearTimeout(timer);
    searchProducts().then(function () {
      var first = products.filter(function (p) { return avail(p) > 0; })[0];
      if (first) { addToCart(first); searchInput.select(); }
    });
  });
  grid.addEventListener('click', function (e) {
    var b = e.target.closest('.pos-prod');
    if (!b) return;
    var p = products.filter(function (x) { return String(x.id) === b.getAttribute('data-id'); })[0];
    if (!p) return;
    if (avail(p) <= 0) { flash(b); return; }
    addToCart(p);
    b.classList.remove('is-added'); void b.offsetWidth; b.classList.add('is-added');
  });
  function flash(el) { el.classList.remove('is-shake'); void el.offsetWidth; el.classList.add('is-shake'); }

  /* =======================================================
     VENTA (carrito)
     ======================================================= */
  var lines = [];          // { id, clave, descripcion, precio, cantidad, descuento, stock }
  var linesEl = $('posLines');
  var lastAddedId = null;

  function lineOf(id) { return lines.filter(function (l) { return l.id === id; })[0]; }
  function lineImporte(l) { return round2(l.precio * l.cantidad * (1 - (l.descuento || 0) / 100)); }
  function totals() {
    var sub = 0, total = 0, n = 0;
    lines.forEach(function (l) { sub += l.precio * l.cantidad; total += lineImporte(l); n += l.cantidad; });
    return { sub: round2(sub), total: round2(total), desc: round2(sub - total), items: n };
  }

  function addToCart(p) {
    var l = lineOf(p.id);
    if (l) {
      if (l.cantidad >= l.stock) { toast('Solo hay ' + l.stock + ' en existencia de ' + p.descripcion + '.'); return; }
      l.cantidad += 1;
    } else {
      lines.push({ id: p.id, clave: p.clave, descripcion: p.descripcion, precio: p.precio_venta, cantidad: 1, descuento: 0, stock: avail(p), servicio: !!p.servicio });
    }
    lastAddedId = p.id;
    renderCart();
    renderProducts();
  }

  function renderCart() {
    linesEl.innerHTML = lines.map(function (l) {
      return '<div class="pos-line' + (l.id === lastAddedId ? ' is-new' : '') + '" data-id="' + l.id + '">' +
        '<div class="pos-line-top">' +
          '<div class="pos-line-name">' + (l.clave ? '<small>' + esc(l.clave) + '</small>' : '') + '<span>' + esc(l.descripcion) + '</span></div>' +
          '<button type="button" class="pos-line-del" data-act="del" aria-label="Quitar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>' +
        '</div>' +
        '<div class="pos-line-bottom">' +
          '<div class="pos-qty">' +
            '<button type="button" data-act="minus" aria-label="Menos">−</button>' +
            '<input type="number" min="1" max="' + l.stock + '" value="' + l.cantidad + '" data-act="qty" aria-label="Cantidad">' +
            '<button type="button" data-act="plus" aria-label="Más"' + (l.cantidad >= l.stock ? ' disabled' : '') + '>+</button>' +
          '</div>' +
          '<span class="pos-line-unit">× ' + mxn.format(l.precio) + '</span>' +
          '<label class="pos-line-disc" title="Descuento %"><input type="number" min="0" max="100" step="1" value="' + (l.descuento || '') + '" placeholder="0" data-act="disc"><span>%</span></label>' +
          '<strong class="pos-line-total">' + mxn.format(lineImporte(l)) + '</strong>' +
        '</div>' +
      '</div>';
    }).join('');
    lastAddedId = null;
    var t = totals();
    $('posLinesEmpty').hidden = lines.length > 0;
    $('posItems').textContent = t.items;
    $('posSubtotal').textContent = mxn.format(t.sub);
    $('posDescRow').hidden = t.desc <= 0;
    $('posDesc').textContent = '−' + mxn.format(t.desc);
    var totalEl = $('posTotal');
    if (totalEl.textContent !== mxn.format(t.total)) { totalEl.classList.remove('is-bump'); void totalEl.offsetWidth; totalEl.classList.add('is-bump'); }
    totalEl.textContent = mxn.format(t.total);
    $('posMobileBar').hidden = !lines.length;
    $('posMobileCount').textContent = t.items;
    $('posMobileTotal').textContent = mxn.format(t.total);
    $('posPayBtn').disabled = !lines.length;
    $('posClearBtn').disabled = !lines.length;
  }

  linesEl.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b || b.tagName === 'INPUT') return;
    var l = lineOf(Number(b.closest('.pos-line').getAttribute('data-id')));
    if (!l) return;
    var act = b.getAttribute('data-act');
    if (act === 'plus') { if (l.cantidad < l.stock) l.cantidad += 1; }
    if (act === 'minus') { if (l.cantidad > 1) l.cantidad -= 1; else lines = lines.filter(function (x) { return x !== l; }); }
    if (act === 'del') lines = lines.filter(function (x) { return x !== l; });
    renderCart(); renderProducts();
  });
  linesEl.addEventListener('change', function (e) {
    var inp = e.target;
    var l = lineOf(Number(inp.closest('.pos-line').getAttribute('data-id')));
    if (!l) return;
    if (inp.getAttribute('data-act') === 'qty') {
      var q = parseInt(inp.value, 10);
      if (!(q > 0)) q = 1;
      if (q > l.stock) { q = l.stock; toast('Solo hay ' + l.stock + ' en existencia.'); }
      l.cantidad = q;
    }
    if (inp.getAttribute('data-act') === 'disc') {
      var d = parseFloat(inp.value);
      l.descuento = isNaN(d) ? 0 : Math.max(0, Math.min(100, d));
    }
    renderCart(); renderProducts();
  });
  $('posMobileBar').addEventListener('click', function () {
    document.querySelector('.pos-cart').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('posClearBtn').addEventListener('click', function () { lines = []; renderCart(); renderProducts(); });

  /* ---------- aviso corto ---------- */
  var toastEl;
  function toast(msg) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'pos-toast'; document.body.appendChild(toastEl); }
    toastEl.textContent = msg;
    toastEl.classList.remove('is-on'); void toastEl.offsetWidth; toastEl.classList.add('is-on');
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(function () { toastEl.classList.remove('is-on'); }, 2600);
  }

  /* =======================================================
     CLIENTES (guardados en el servidor, con lo que deben)
     ======================================================= */
  var clients = [];   // resultados de la última búsqueda
  var client = null;  // null = Público en general
  var drop = $('posClientDrop');
  var clientSearch = $('posClientSearch');
  var clientReq = 0, clientTimer;
  var HOY = '';

  function api(url, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (opts.body) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    return fetch(url, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) throw new Error(d.error || 'Algo salió mal. Intenta de nuevo.');
        return d;
      });
    });
  }
  function fechaISO(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? m[3] + '/' + m[2] + '/' + m[1] : '—';
  }
  function disponible(c) {
    if (!c || !(c.limite > 0)) return Infinity;
    return round2(c.limite - (c.saldo || 0));
  }

  function renderClient() {
    $('posClientName').textContent = client ? client.nombre : 'Público en general';
    var meta = [];
    if (client) {
      meta.push('No. ' + client.numero);
      if (client.clave) meta.push(client.clave);
      if (client.limite > 0) meta.push('Límite ' + mxn.format(client.limite) + (client.dias ? ' · ' + client.dias + ' días' : ''));
      else if (client.dias) meta.push(client.dias + ' días de crédito');
    }
    $('posClientMeta').textContent = meta.join(' · ');
    $('posClientEdit').hidden = !client;
    $('posClientReprint').hidden = !client;
    var av = $('posClientAvatar');
    av.classList.toggle('is-set', !!client);
    av.classList.toggle('is-vip', !!(client && client.clave));
    if (client) av.textContent = initials(client.nombre) || '?';
    else av.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>';

    // Lo que debe (como el aviso "CRÉDITO VENCIDO" de SICAR)
    var debt = $('posClientDebt');
    var owes = !!(client && client.saldo > 0);
    debt.hidden = !owes;
    if (owes) {
      var vencido = client.saldo_vencido > 0;
      debt.classList.toggle('is-overdue', vencido);
      $('posClientDebtLabel').textContent = vencido ? 'Crédito vencido · debe' : 'Debe' + (client.proximo_vence ? ' · vence ' + fechaISO(client.proximo_vence) : '');
      $('posClientDebtAmount').textContent = mxn.format(client.saldo);
    }
  }

  function renderClientList() {
    var html = '<button type="button" class="pos-client-opt' + (!client ? ' is-active' : '') + '" data-client="">' +
      '<span class="pos-client-avatar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg></span>' +
      '<span><strong>Público en general</strong><small>Sin cliente</small></span></button>';
    html += clients.map(function (c) {
      var debt = c.saldo > 0
        ? '<em class="pos-client-owes' + (c.saldo_vencido > 0 ? ' is-overdue' : '') + '">' + (c.saldo_vencido > 0 ? 'Vencido ' : 'Debe ') + esc(mxn.format(c.saldo)) + '</em>'
        : '';
      return '<button type="button" class="pos-client-opt' + (client && client.id === c.id ? ' is-active' : '') + '" data-client="' + c.id + '">' +
        '<span class="pos-client-avatar is-set' + (c.clave ? ' is-vip' : '') + '">' + esc(initials(c.nombre)) + '</span>' +
        '<span><strong>' + esc(c.nombre) + '</strong><small>No. ' + esc(c.numero) + (c.celular ? ' · ' + esc(c.celular) : '') + '</small></span>' +
        (c.clave ? '<em class="pos-client-tag">' + esc(c.clave) + '</em>' : '') + debt +
      '</button>';
    }).join('');
    var q = clientSearch.value.trim();
    if (!clients.length && q) html += '<p class="pos-client-none">No hay clientes con «' + esc(q) + '».</p>';
    if (!clients.length && !q) html += '<p class="pos-client-none">Todavía no hay clientes. Crea uno con «Nuevo cliente».</p>';
    $('posClientList').innerHTML = html;
  }

  function fetchClients() {
    var my = ++clientReq;
    return api('/api/pos/clientes?q=' + encodeURIComponent(clientSearch.value.trim()))
      .then(function (d) {
        if (my !== clientReq) return;
        HOY = d.hoy || HOY;
        clients = d.items || [];
        renderClientList();
      })
      .catch(function (err) {
        if (my !== clientReq) return;
        clients = [];
        $('posClientList').innerHTML = '<p class="pos-client-none">' + esc(err.message) + '</p>';
      });
  }
  // Vuelve a leer al cliente elegido (su saldo cambia al vender o abonar).
  function refreshClient() {
    if (!client) return Promise.resolve();
    return api('/api/pos/clientes/' + client.id + '/creditos').then(function (d) {
      if (d.cliente && client && d.cliente.id === client.id) { client = d.cliente; renderClient(); }
      return d;
    }).catch(function () {});
  }

  function openDrop() {
    drop.hidden = false;
    $('posClient').classList.add('is-open');
    clientSearch.value = '';
    renderClientList();
    fetchClients();
    setTimeout(function () { clientSearch.focus(); }, 30);
  }
  function closeDrop() { drop.hidden = true; $('posClient').classList.remove('is-open'); }
  $('posClientBtn').addEventListener('click', function (e) { e.stopPropagation(); drop.hidden ? openDrop() : closeDrop(); });
  $('posClientPick').addEventListener('click', function (e) { if (!e.target.closest('#posClientBtn, #posClientEdit') && drop.hidden) openDrop(); });
  clientSearch.addEventListener('input', function () { clearTimeout(clientTimer); clientTimer = setTimeout(fetchClients, 220); });
  clientSearch.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(clientTimer);
      fetchClients().then(function () {
        var first = $('posClientList').querySelector('.pos-client-opt:not([data-client=""])');
        if (first) first.click();
      });
    }
  });
  $('posClientList').addEventListener('click', function (e) {
    var b = e.target.closest('.pos-client-opt');
    if (!b) return;
    var id = Number(b.getAttribute('data-client'));
    client = id ? clients.filter(function (c) { return c.id === id; })[0] || null : null;
    renderClient(); closeDrop();
  });
  document.addEventListener('click', function (e) { if (!drop.hidden && !e.target.closest('#posClient')) closeDrop(); });
  $('posClientDebt').addEventListener('click', function () { openCredits(); });

  /* ---------- modal: nuevo cliente / editar cliente ---------- */
  var clientModal = $('posClientModal');
  var cForm = $('posClientForm');
  var editingClient = null; // cliente que se está editando (null = nuevo)
  function setClientModalMode(edit) {
    $('posClientModalTitle').textContent = edit ? 'Editar cliente' : 'Nuevo cliente';
    cForm.querySelector('[type="submit"]').textContent = edit ? 'Guardar cambios' : 'Guardar cliente';
  }
  function openClientModal(prefillName) {
    closeDrop();
    editingClient = null;
    setClientModalMode(false);
    cForm.reset();
    $('pcNumero').value = '';
    api('/api/pos/clientes/siguiente').then(function (d) {
      if (!$('pcNumero').value) $('pcNumero').value = d.numero || '';
    }).catch(function () {});
    $('pcRepresentante').value = cajero;
    if (prefillName && !/^\d+$/.test(prefillName)) $('pcNombre').value = prefillName;
    if (prefillName && /^\d{10}$/.test(prefillName)) $('pcCelular').value = prefillName;
    $('pcError').textContent = '';
    syncClaveChips();
    openModal(clientModal);
    setTimeout(function () { $('pcNombre').focus(); }, 80);
  }
  $('posClientNew').addEventListener('click', function () { openClientModal(clientSearch.value.trim()); });

  // Editar al cliente elegido: mismos campos, ya llenos.
  function openEditClientModal(c) {
    if (!c) return;
    closeDrop();
    editingClient = c;
    setClientModalMode(true);
    cForm.reset();
    $('pcNumero').value = c.numero || '';
    pcClave.value = c.clave || '';
    $('pcNombre').value = c.nombre || '';
    $('pcCelular').value = c.celular || '';
    $('pcRepresentante').value = c.representante || '';
    $('pcDias').value = c.dias ? String(c.dias) : '';
    $('pcLimite').value = c.limite > 0 ? String(c.limite) : '';
    $('pcError').textContent = '';
    syncClaveChips();
    openModal(clientModal);
    setTimeout(function () { $('pcNombre').focus(); }, 80);
  }
  $('posClientEdit').addEventListener('click', function (e) { e.stopPropagation(); openEditClientModal(client); });
  $('posClientModalClose').addEventListener('click', function () { closeModal(clientModal); });
  $('pcCancel').addEventListener('click', function () { closeModal(clientModal); });

  var pcClave = $('pcClave');
  function syncClaveChips() {
    var v = pcClave.value.trim().toUpperCase();
    $('pcClaveChips').querySelectorAll('button').forEach(function (b) { b.classList.toggle('is-on', b.getAttribute('data-clave') === v); });
  }
  pcClave.addEventListener('input', function () {
    var pos = pcClave.selectionStart;
    pcClave.value = pcClave.value.toUpperCase();
    pcClave.setSelectionRange(pos, pos);
    syncClaveChips();
  });
  $('pcClaveChips').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    pcClave.value = b.classList.contains('is-on') ? '' : b.getAttribute('data-clave');
    syncClaveChips();
  });
  $('pcCelular').addEventListener('input', function () { this.value = this.value.replace(/\D/g, ''); });
  $('pcNumero').addEventListener('input', function () { this.value = this.value.replace(/[^A-Za-z0-9-]/g, ''); });

  cForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var err = $('pcError');
    var body = {
      numero: $('pcNumero').value.trim(),
      clave: pcClave.value.trim().toUpperCase(),
      nombre: $('pcNombre').value.trim().replace(/\s+/g, ' '),
      celular: $('pcCelular').value.trim(),
      representante: $('pcRepresentante').value.trim(),
      dias: parseInt($('pcDias').value, 10) || 0,
      limite: round2(parseFloat($('pcLimite').value) || 0)
    };
    if (!body.numero) { err.textContent = 'Escribe el número de cliente.'; $('pcNumero').focus(); return; }
    if (!body.nombre) { err.textContent = 'Escribe el nombre del cliente.'; $('pcNombre').focus(); return; }
    if (body.celular && body.celular.length !== 10) { err.textContent = 'El celular debe tener 10 dígitos.'; $('pcCelular').focus(); return; }
    if (body.limite < 0 || body.dias < 0) { err.textContent = 'El crédito no puede ser negativo.'; return; }
    var btn = cForm.querySelector('[type="submit"]');
    var editing = editingClient;
    btn.disabled = true; btn.textContent = 'Guardando…';
    err.textContent = '';
    var req = editing
      ? api('/api/pos/clientes/' + editing.id, { method: 'PUT', body: body })
      : api('/api/pos/clientes', { method: 'POST', body: body });
    req.then(function (d) {
      if (editing) {
        // Si es el cliente de la venta (o el de créditos), se actualiza en pantalla.
        if (client && client.id === d.item.id) client = d.item;
        if (crData && crData.cliente && crData.cliente.id === d.item.id) { crData.cliente = d.item; if (crModal.classList.contains('open')) renderCredits(); }
        clients = clients.map(function (c) { return c.id === d.item.id ? d.item : c; });
        renderClient();
        closeModal(clientModal);
        toast('Se guardaron los cambios de ' + d.item.nombre + '.');
      } else {
        client = d.item;
        renderClient();
        closeModal(clientModal);
        toast('Cliente ' + client.nombre + ' creado y seleccionado.');
      }
    }).catch(function (e2) {
      err.textContent = e2.message;
    }).finally(function () {
      btn.disabled = false; btn.textContent = editing ? 'Guardar cambios' : 'Guardar cliente';
    });
  });

  /* =======================================================
     COBRAR
     ======================================================= */
  var payModal = $('posPayModal');
  var payInputs = Array.prototype.slice.call(payModal.querySelectorAll('[data-pay]'));
  var payTotal = 0;
  var lastSale = null;
  var saving = false;

  function payValues() {
    var v = {};
    payInputs.forEach(function (i) { v[i.getAttribute('data-pay')] = round2(parseFloat(i.value) || 0); });
    return v;
  }

  function syncPay() {
    var v = payValues();
    var paid = round2(v.efectivo + v.tarjeta + v.transferencia + v.vales + v.cheque + v.credito);
    var noCash = round2(paid - v.efectivo);
    var falta = round2(payTotal - paid);
    var cambio = falta < 0 ? round2(-falta) : 0;
    $('payPaid').textContent = mxn.format(paid);
    $('payFaltaRow').hidden = falta <= 0;
    $('payFalta').textContent = mxn.format(Math.max(0, falta));
    $('payCambioRow').hidden = cambio <= 0;
    $('payCambio').textContent = mxn.format(cambio);

    var disp = disponible(client);
    var err = '';
    if (noCash > payTotal) err = 'Tarjeta, transferencia, vales, cheque y crédito no pueden pasar del total (solo el efectivo da cambio).';
    else if (v.credito > 0 && !client) err = 'Para dejar algo a crédito elige un cliente.';
    else if (v.credito > 0 && v.credito > disp) err = 'Le quedan ' + mxn.format(Math.max(0, disp)) + ' de crédito disponible a ' + client.nombre + ' (límite ' + mxn.format(client.limite) + ').';
    $('payError').textContent = err;
    $('payAccept').disabled = saving || !!err || falta > 0 || payTotal <= 0;

    var showBox = v.credito > 0 && !!client;
    $('payCreditBox').hidden = !showBox;
    if (client) {
      $('payCreditDias').textContent = client.dias ? client.dias + ' días' : 'Sin plazo';
      $('payCreditLimite').textContent = client.limite > 0 ? mxn.format(client.limite) : 'Sin límite';
      $('payCreditDisp').textContent = client.limite > 0 ? mxn.format(round2(disp - v.credito)) : '—';
      $('payCreditVence').textContent = client.dias ? fechaCorta(addDays(new Date(), client.dias)) : 'Sin fecha';
    }
    var LABELS = { efectivo: 'efectivo', tarjeta: 'tarjeta', transferencia: 'transferencia', vales: 'vales', cheque: 'cheque', credito: 'crédito' };
    $('payRestLabel').textContent = LABELS[lastMethod] || 'efectivo';
    $('payRestBtn').hidden = falta <= 0;
    $('payRestCredit').hidden = falta <= 0 || !client || lastMethod === 'credito';
    return { v: v, paid: paid, falta: falta, cambio: cambio };
  }
  function addDays(d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }
  function fechaCorta(d) { var p = function (n) { return (n < 10 ? '0' : '') + n; }; return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear(); }

  var lastMethod = 'efectivo';
  payInputs.forEach(function (i) {
    i.addEventListener('input', syncPay);
    i.addEventListener('focus', function () { lastMethod = i.getAttribute('data-pay'); syncPay(); });
  });
  function putRest(method) {
    var s = syncPay();
    if (s.falta <= 0) return;
    var inp = payModal.querySelector('[data-pay="' + method + '"]');
    inp.value = round2((parseFloat(inp.value) || 0) + s.falta).toFixed(2);
    lastMethod = method;
    syncPay();
    inp.focus();
  }
  $('payRestBtn').addEventListener('click', function () { putRest(lastMethod); });
  $('payRestCredit').addEventListener('click', function () { putRest('credito'); });

  function openPay() {
    if (!lines.length) return;
    closeDrop();
    payTotal = totals().total;
    $('payTotal').textContent = mxn.format(payTotal);
    $('payLetras').textContent = T ? '(' + T.numeroALetras(payTotal).replace('M.N.', 'MXN') + ')' : '';
    payInputs.forEach(function (i) { i.value = ''; });
    $('payRef').value = '';
    if ($('payPropina')) {
      $('payPropina').value = ''; $('payPropinaForma').value = 'tarjeta';
      if ($('payPropinaForma')._av) $('payPropinaForma')._av.sync();
    }
    var credRow = $('payCreditRow');
    credRow.classList.toggle('is-disabled', !client);
    credRow.querySelector('input').disabled = !client;
    credRow.title = client ? 'Lo que el cliente queda a deber (lo paga después, p. ej. al recoger sus lentes)' : 'Elige un cliente para dejar algo a crédito';
    var warn = $('payDebtWarn');
    warn.hidden = !(client && client.saldo > 0);
    if (client && client.saldo > 0) {
      warn.classList.toggle('is-overdue', client.saldo_vencido > 0);
      warn.textContent = client.saldo_vencido > 0
        ? 'Ojo: ' + client.nombre + ' tiene ' + mxn.format(client.saldo_vencido) + ' de crédito vencido (debe ' + mxn.format(client.saldo) + ' en total).'
        : client.nombre + ' ya debe ' + mxn.format(client.saldo) + ' de otros tickets.';
    }
    lastMethod = 'efectivo';
    saving = false;
    $('payAccept').textContent = 'Aceptar';
    syncPay();
    openModal(payModal);
    setTimeout(function () { payModal.querySelector('[data-pay="efectivo"]').focus(); }, 80);
  }
  $('posPayBtn').addEventListener('click', openPay);
  $('posPayClose').addEventListener('click', function () { if (!saving) closeModal(payModal); });
  $('payCancel').addEventListener('click', function () { if (!saving) closeModal(payModal); });

  $('payAccept').addEventListener('click', function () {
    var s = syncPay();
    if ($('payAccept').disabled || saving) return;
    saving = true;
    $('payAccept').disabled = true;
    $('payAccept').textContent = 'Guardando…';
    var saleClient = client;
    api('/api/pos/ventas', {
      method: 'POST',
      body: {
        client_id: saleClient ? saleClient.id : 0,
        productos: lines.map(function (l) { return { inventory_id: l.id, cantidad: l.cantidad, descuento: l.descuento || 0 }; }),
        pagos: s.v,
        referencia: $('payRef').value.trim(),
        // Propina (aparte del total; la de efectivo no entra al corte de caja).
        propina: $('payPropina') ? Math.round((parseFloat($('payPropina').value) || 0) * 100) / 100 : 0,
        propina_forma: $('payPropinaForma') ? $('payPropinaForma').value : ''
      }
    }).then(function (d) {
      var v = d.venta;
      lastSale = {
        folio: v.folio,
        fecha: new Date(),
        caja: 'Caja 1',
        cliente: v.cliente || 'PÚBLICO EN GENERAL',
        cajero: v.cajero || cajero,
        productos: (v.productos || []).map(function (p) { return { descripcion: p.descripcion, cantidad: p.cantidad, precio: p.precio, descuento: p.descuento || 0, rastreo: p.rastreo || [] }; }),
        pedido: v.pedido && v.pedido.code ? v.pedido.code : '',
        pagos: v.pagos,
        cambio: v.cambio,
        propina: v.propina || 0,
        propina_forma: v.propina_forma || '',
        referencia: v.referencia,
        vencimiento: v.vence || ''
      };
      saving = false;
      closeModal(payModal);
      $('posDoneTitle').textContent = 'Venta guardada · Ticket ' + v.folio;
      $('posDoneText').innerHTML = 'Total <strong>' + mxn.format(v.total) + '</strong>' +
        (v.cambio > 0 ? ' · Cambio <strong>' + mxn.format(v.cambio) + '</strong>' : '') +
        (saleClient ? '<br>' + esc(saleClient.nombre) : '') +
        (v.pedido && v.pedido.code ? '<br>Clave de rastreo <strong>' + esc(v.pedido.code) + '</strong>' : '');
      var cr = v.pagos && v.pagos.credito > 0;
      $('posDoneCredit').hidden = !cr;
      $('posDoneCredits').hidden = !cr;
      if (cr) {
        $('posDoneCredit').innerHTML = 'Queda a deber <strong>' + mxn.format(v.pagos.credito) + '</strong>' +
          (v.vence ? ' · vence el ' + fechaISO(v.vence) : '') + '. Lo abona en «Créditos y abonos».';
      }
      openModal($('posDoneModal'));
      refreshClient();
    }).catch(function (err) {
      saving = false;
      $('payAccept').textContent = 'Aceptar';
      $('payError').textContent = err.message;
      syncPay();
      $('payError').textContent = err.message;
    });
  });

  /* ---------- ticket con la plantilla de Plantillas ---------- */
  var tplCache = null;
  function loadTemplate() {
    if (tplCache) return Promise.resolve(tplCache);
    return fetch('/api/pos/ticket-plantilla', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (d) { tplCache = T.merge(d && d.data); return tplCache; })
      .catch(function () { tplCache = T.defaults(); return tplCache; });
  }
  /* ---------- reimprimir el último ticket del cliente elegido ---------- */
  function saleFecha(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) : new Date();
  }
  var reprintBtn = $('posClientReprint');
  reprintBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (!T || !client || reprintBtn.disabled) return;
    var txt = reprintBtn.querySelector('.pos-client-reprint-txt');
    var label = txt.textContent;
    reprintBtn.disabled = true;
    reprintBtn.classList.add('is-loading');
    txt.textContent = 'Buscando su última venta…';
    Promise.all([api('/api/pos/clientes/' + client.id + '/ultima-venta'), loadTemplate()])
      .then(function (res) {
        var v = res[0].venta, tpl = res[1];
        T.print(tpl, {
          folio: v.folio,
          fecha: saleFecha(v.fecha),
          caja: 'Caja 1',
          cliente: v.cliente,
          cajero: v.cajero || cajero,
          productos: (v.productos || []).map(function (p) { return { descripcion: p.descripcion, cantidad: p.cantidad, precio: p.precio, descuento: p.descuento || 0, rastreo: p.rastreo || [] }; }),
          pedido: v.pedido_code || '',
          pagos: { efectivo: v.efectivo_recibido, tarjeta: v.tarjeta, transferencia: v.transferencia, vales: v.vales, cheque: v.cheque, credito: v.credito },
          cambio: v.cambio,
          referencia: v.referencia,
          vencimiento: v.vence || ''
        });
        toast('Imprimiendo el ticket ' + v.folio + ' del ' + fechaISO(v.fecha) + ' (' + mxn.format(v.total) + ').');
      })
      .catch(function (err) { toast(err.message); })
      .finally(function () {
        reprintBtn.disabled = false;
        reprintBtn.classList.remove('is-loading');
        txt.textContent = label;
      });
  });

  $('posDonePrint').addEventListener('click', function () {
    if (!T || !lastSale) return;
    loadTemplate().then(function (tpl) { T.print(tpl, lastSale); });
  });
  function newSale() {
    closeModal($('posDoneModal'));
    lines = []; client = null; lastSale = null;
    renderCart(); renderClient(); renderProducts();
    searchInput.value = ''; searchProducts();
    searchInput.focus();
  }
  $('posDoneNew').addEventListener('click', newSale);
  $('posDoneCredits').addEventListener('click', function () {
    closeModal($('posDoneModal'));
    lines = []; lastSale = null;
    renderCart(); searchProducts();
    openCredits();
  });

  /* =======================================================
     CRÉDITOS Y ABONOS (como "Lista de créditos del cliente" de SICAR)
     ======================================================= */
  var crModal = $('posCreditsModal');
  var crData = null;      // { cliente, creditos }
  var crSelected = null;  // id del crédito elegido
  var FORMA_LABEL = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', vales: 'Vales', cheque: 'Cheque' };

  function openCredits() {
    if (!client) {
      toast('Primero elige al cliente.');
      openDrop();
      return;
    }
    crSelected = null;
    $('posCreditsTitle').textContent = 'Créditos de ' + client.nombre;
    $('posCrError').textContent = '';
    $('posCrList').innerHTML = '<tr><td colspan="7" class="pos-cr-loading">Cargando…</td></tr>';
    $('posCrAbonos').innerHTML = '';
    openModal(crModal);
    loadCredits();
  }
  function loadCredits() {
    return api('/api/pos/clientes/' + client.id + '/creditos').then(function (d) {
      crData = d;
      if (d.cliente) { client = d.cliente; renderClient(); }
      // Elige el primero con saldo (o el que ya estaba elegido).
      if (!crSelected || !d.creditos.some(function (c) { return c.id === crSelected; })) {
        var first = d.creditos.filter(function (c) { return c.saldo > 0; })[0] || d.creditos[0];
        crSelected = first ? first.id : null;
      }
      renderCredits();
    }).catch(function (err) {
      $('posCrError').textContent = err.message;
      $('posCrList').innerHTML = '';
    });
  }
  function selectedCredit() {
    if (!crData) return null;
    return crData.creditos.filter(function (c) { return c.id === crSelected; })[0] || null;
  }
  function renderCredits() {
    var c = crData.cliente;
    var disp = c.limite > 0 ? round2(c.limite - c.saldo) : null;
    $('posCrSummary').innerHTML =
      '<div class="pos-cr-card' + (c.saldo > 0 ? ' is-owes' : '') + '"><small>Debe</small><strong>' + mxn.format(c.saldo) + '</strong></div>' +
      '<div class="pos-cr-card' + (c.saldo_vencido > 0 ? ' is-overdue' : '') + '"><small>Vencido</small><strong>' + mxn.format(c.saldo_vencido) + '</strong></div>' +
      '<div class="pos-cr-card"><small>Límite</small><strong>' + (c.limite > 0 ? mxn.format(c.limite) : 'Sin límite') + '</strong></div>' +
      '<div class="pos-cr-card"><small>Disponible</small><strong>' + (disp === null ? '—' : mxn.format(Math.max(0, disp))) + '</strong></div>' +
      '<div class="pos-cr-card"><small>Días de crédito</small><strong>' + (c.dias || 0) + '</strong></div>';

    var list = crData.creditos;
    $('posCrEmpty').hidden = list.length > 0;
    $('posCrList').innerHTML = list.map(function (cr) {
      var st = cr.saldo <= 0 ? '<span class="pos-cr-chip is-paid">Pagado</span>'
        : cr.vencido ? '<span class="pos-cr-chip is-overdue">Vencido</span>'
        : '<span class="pos-cr-chip">Pendiente</span>';
      return '<tr class="' + (cr.id === crSelected ? 'is-selected' : '') + (cr.saldo <= 0 ? ' is-paid' : '') + '" data-credit="' + cr.id + '" title="' + esc(cr.productos) + '">' +
        '<td><b>' + cr.folio + '</b></td>' +
        '<td>' + fechaISO(cr.fecha) + '</td>' +
        '<td class="' + (cr.vencido ? 'is-overdue' : '') + '">' + (cr.vence ? fechaISO(cr.vence) : 'Sin fecha') + '</td>' +
        '<td class="num">' + mxn.format(cr.monto) + '</td>' +
        '<td class="num">' + mxn.format(cr.abonado) + '</td>' +
        '<td class="num"><b>' + mxn.format(cr.saldo) + '</b></td>' +
        '<td>' + st + '</td></tr>';
    }).join('');

    var sel = selectedCredit();
    $('posCrAbonar').disabled = !(sel && sel.saldo > 0);
    $('posCrAbonosTitle').textContent = sel ? 'Abonos del ticket ' + sel.folio : 'Abonos';
    var ab = sel ? sel.abonos : [];
    $('posCrAbonosEmpty').hidden = !!(sel && ab.length);
    $('posCrAbonosEmpty').textContent = sel ? 'Todavía no hay abonos a este ticket.' : 'Elige un crédito para ver sus abonos.';
    $('posCrAbonos').innerHTML = ab.map(function (a) {
      var d = new Date(a.created_at);
      var when = fechaISO(a.fecha) + (isNaN(d) ? '' : ' ' + d.toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' }));
      return '<tr class="' + (a.cancelado ? 'is-cancelled' : '') + '" data-abono="' + a.id + '">' +
        '<td>' + esc(when) + '</td>' +
        '<td>' + esc(FORMA_LABEL[a.forma_pago] || a.forma_pago) + (a.cancelado ? ' <span class="pos-cr-chip is-cancelled">Cancelado</span>' : '') + '</td>' +
        '<td>' + esc(a.referencia || '—') + '</td>' +
        '<td>' + esc(a.cajero || '—') + '</td>' +
        '<td class="num"><b>' + mxn.format(a.monto) + '</b></td>' +
        '<td class="pos-cr-actions">' +
          (a.cancelado ? '' : '<button type="button" data-act="recibo" title="Imprimir recibo">Recibo</button>') +
          (a.cancelable ? '<button type="button" data-act="cancelar" class="is-danger" title="Solo los abonos de hoy">Cancelar</button>' : '') +
        '</td></tr>';
    }).join('');
  }
  $('posCrList').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-credit]');
    if (!tr) return;
    crSelected = Number(tr.getAttribute('data-credit'));
    renderCredits();
  });
  $('posCrList').addEventListener('dblclick', function (e) {
    var tr = e.target.closest('tr[data-credit]');
    if (tr && !$('posCrAbonar').disabled) openAbono();
  });
  $('posCrAbonos').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-act]');
    if (!b) return;
    var id = Number(b.closest('tr').getAttribute('data-abono'));
    var sel = selectedCredit();
    var a = sel && sel.abonos.filter(function (x) { return x.id === id; })[0];
    if (!a) return;
    if (b.getAttribute('data-act') === 'recibo') {
      printRecibo({ abono: a, folio: sel.folio, cliente: crData.cliente.nombre, saldo_anterior: null, saldo_nuevo: null });
      return;
    }
    // Cancelar: segundo clic para confirmar.
    if (!b.classList.contains('is-confirm')) {
      b.classList.add('is-confirm');
      b.textContent = '¿Seguro?';
      setTimeout(function () { if (b.isConnected) { b.classList.remove('is-confirm'); b.textContent = 'Cancelar'; } }, 3500);
      return;
    }
    b.disabled = true;
    api('/api/pos/abonos/' + id, { method: 'DELETE' }).then(function (r) {
      toast('Abono cancelado. El saldo del ticket ' + r.folio + ' regresó a ' + mxn.format(r.saldo_nuevo) + '.');
      return loadCredits();
    }).catch(function (err) {
      $('posCrError').textContent = err.message;
      b.disabled = false;
    });
  });
  $('posCreditsBtn').addEventListener('click', openCredits);
  $('posCreditsClose').addEventListener('click', function () { closeModal(crModal); });
  $('posCrAbonar').addEventListener('click', openAbono);

  /* ---------- Abono a crédito ---------- */
  var abModal = $('posAbonoModal');
  var abForm = $('posAbonoForm');
  var abForma = 'efectivo';
  var abResult = null;
  function abSaldo() { var s = selectedCredit(); return s ? s.saldo : 0; }
  function openAbono() {
    var sel = selectedCredit();
    if (!sel || sel.saldo <= 0) return;
    abForm.reset();
    abForm.hidden = false;
    $('posAbonoDone').hidden = true;
    abForma = 'efectivo';
    renderFormas();
    $('posAbonoFolio').textContent = sel.folio;
    $('posAbonoSaldo').textContent = mxn.format(sel.saldo);
    $('posAbonoError').textContent = '';
    syncAbono();
    openModal(abModal);
    setTimeout(function () { $('posAbonoMonto').focus(); }, 80);
  }
  function renderFormas() {
    $('posAbonoFormas').querySelectorAll('button').forEach(function (b) { b.classList.toggle('is-on', b.getAttribute('data-forma') === abForma); });
  }
  function syncAbono() {
    var saldo = abSaldo();
    var m = round2(parseFloat($('posAbonoMonto').value) || 0);
    var after = $('posAbonoAfter');
    var err = '';
    if (m > saldo) err = 'El abono no puede ser mayor que el saldo (' + mxn.format(saldo) + ').';
    $('posAbonoError').textContent = err;
    after.textContent = m > 0 && !err ? (round2(saldo - m) <= 0 ? 'Con este abono el ticket queda pagado.' : 'Después del abono le quedan ' + mxn.format(round2(saldo - m)) + '.') : '';
    after.classList.toggle('is-paid', m > 0 && !err && round2(saldo - m) <= 0);
    $('posAbonoSave').disabled = !!err || m <= 0;
    $('posAbonoSaldar').checked = m > 0 && m === saldo;
  }
  $('posAbonoFormas').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-forma]');
    if (!b) return;
    abForma = b.getAttribute('data-forma');
    renderFormas();
  });
  $('posAbonoMonto').addEventListener('input', syncAbono);
  $('posAbonoSaldar').addEventListener('change', function () {
    $('posAbonoMonto').value = this.checked ? abSaldo().toFixed(2) : '';
    syncAbono();
  });
  abForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var sel = selectedCredit();
    var m = round2(parseFloat($('posAbonoMonto').value) || 0);
    if (!sel || m <= 0 || $('posAbonoSave').disabled) return;
    var btn = $('posAbonoSave');
    btn.disabled = true; btn.textContent = 'Guardando…';
    api('/api/pos/creditos/' + sel.id + '/abonos', {
      method: 'POST',
      body: { monto: m, forma_pago: abForma, referencia: $('posAbonoRef').value.trim() }
    }).then(function (r) {
      abResult = r;
      abForm.hidden = true;
      $('posAbonoDone').hidden = false;
      $('posAbonoDoneText').innerHTML = 'Abonó <strong>' + mxn.format(r.abono.monto) + '</strong> en ' + esc((FORMA_LABEL[r.abono.forma_pago] || '').toLowerCase()) +
        ' al ticket ' + r.folio + '.<br>' + (r.saldo_nuevo <= 0 ? '<strong>El ticket quedó pagado.</strong>' : 'Le quedan <strong>' + mxn.format(r.saldo_nuevo) + '</strong>.');
      loadCredits();
    }).catch(function (err) {
      $('posAbonoError').textContent = err.message;
    }).finally(function () {
      btn.disabled = false; btn.textContent = 'Guardar abono';
    });
  });
  $('posAbonoClose').addEventListener('click', function () { closeModal(abModal); });
  $('posAbonoCancel').addEventListener('click', function () { closeModal(abModal); });
  $('posAbonoOk').addEventListener('click', function () { closeModal(abModal); });
  $('posAbonoPrint').addEventListener('click', function () { if (abResult) printRecibo(abResult); });

  // Recibo de abono con la misma plantilla del ticket (sin pagaré).
  function printRecibo(r) {
    if (!T) return;
    var a = r.abono;
    var forma = {}; forma[a.forma_pago] = a.monto;
    var notas = [];
    if (r.saldo_anterior != null) notas.push(['Saldo anterior', r.saldo_anterior]);
    notas.push(['Abono', a.monto]);
    if (r.saldo_nuevo != null) notas.push(['Saldo pendiente', r.saldo_nuevo]);
    if (a.referencia) notas.push(['Referencia', a.referencia]);
    loadTemplate().then(function (tpl) {
      T.print(tpl, {
        folio: 'AB-' + a.id,
        fecha: a.created_at ? new Date(a.created_at) : new Date(),
        caja: 'Caja 1',
        cliente: r.cliente,
        cajero: a.cajero || cajero,
        productos: [{ descripcion: 'Abono al ticket ' + r.folio, cantidad: 1, precio: a.monto, descuento: 0 }],
        pagos: forma,
        cambio: 0,
        notas: notas,
        sinPagare: true
      });
    });
  }

  /* =======================================================
     MODALES + TECLADO
     ======================================================= */
  function openModal(ov) { ov.classList.add('open'); document.body.style.overflow = 'hidden'; }
  function closeModal(ov) { ov.classList.remove('open'); if (!document.querySelector('.admin-modal-overlay.open')) document.body.style.overflow = ''; }

  document.addEventListener('keydown', function (e) {
    var anyOpen = document.querySelector('.admin-modal-overlay.open');
    if (e.key === 'F2') { e.preventDefault(); if (!anyOpen) { searchInput.focus(); searchInput.select(); } }
    if (e.key === 'F12') { e.preventDefault(); if (!anyOpen) openPay(); }
    if (e.key === 'F4') { e.preventDefault(); if (!anyOpen) openCredits(); }
    if (e.key === 'F3' && crModal.classList.contains('open') && !abModal.classList.contains('open')) { e.preventDefault(); if (!$('posCrAbonar').disabled) openAbono(); }
    if (e.key === 'Escape') {
      if (!drop.hidden) { closeDrop(); return; }
      if (abModal.classList.contains('open')) { closeModal(abModal); return; }
      [clientModal, crModal].forEach(function (m) { if (m.classList.contains('open')) closeModal(m); });
      if (payModal.classList.contains('open') && !saving) closeModal(payModal);
    }
    if (e.key === 'Enter' && payModal.classList.contains('open') && e.target.matches('[data-pay], #payRef') && !$('payAccept').disabled) {
      e.preventDefault(); $('payAccept').click();
    }
  });

  renderClient();
  renderCart();
  searchProducts();
})();

// Forma de la propina: dropdown animado (av-select.js).
if (window.AvSelect) window.AvSelect.enhance(document.getElementById('payPropinaForma'));
/* ---------------------------------------------------------------- ventas */
/* =========================================================
   RECEPCIÓN — Ventas
   Tabla de las ventas del punto de venta:
     GET /api/pos/ventas?desde=&hasta=&q=&estado=
     GET /api/pos/ventas/:folio   (detalle)
   Por cada venta: cuánto pagó en efectivo (ya sin el cambio),
   tarjeta, transferencia y otros (vales + cheque), cuánto quedó a
   crédito (lo que queda a deber), cuánto ha abonado y cuánto debe
   todavía. Clic en una venta = detalle con productos y abonos, y
   se puede reimprimir el ticket.
   ========================================================= */
(function () {
  'use strict';
  var page = document.getElementById('vtPage');
  if (!page) return;
  var T = window.PosTicket;
  var cajero = page.getAttribute('data-cajero') || '';

  var mxn = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2 });
  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var MESES_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var FORMA = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', vales: 'Vales', cheque: 'Cheque' };
  var ESTADO = { pagada: 'Pagada', debe: 'Debe', vencida: 'Vencida', cancelada: 'Cancelada' };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function money(v) { return mxn.format(Number(v) || 0); }
  function moneyCell(v) { return (Number(v) || 0) ? money(v) : '<span class="vt-zero">—</span>'; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseISO(s) { var m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) : null; }
  function fechaCorta(s) { var d = parseISO(s); return d ? d.getDate() + ' ' + MESES[d.getMonth()] + ' ' + d.getFullYear() : '—'; }
  function hora(s) { var d = parseISO(s); return d ? d.toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' }) : ''; }
  function fechaLarga(s) { var d = parseISO(s); return d ? d.getDate() + ' de ' + MESES_L[d.getMonth()] + ' de ' + d.getFullYear() : '—'; }

  function api(url) {
    return fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) throw new Error(d.error || 'No se pudo cargar.');
        return d;
      });
    });
  }

  /* ---------- estatus de los pedidos (los mismos de Laboratorio / Rastreo) ---------- */
  var estatus = {}, estatusList = [];
  // Attomos: todavía sin pedidos de laboratorio (clave de rastreo).
  var estatusReady = Promise.resolve();
  function pedidoChip(code, status) {
    if (!code) return '<span class="vt-zero">—</span>';
    var st = estatus[status] || { label: status || '—', color: '' };
    var col = /^#[0-9a-f]{3,8}$/i.test(st.color || '') ? st.color : '#5b6475';
    return '<span class="vt-ped" style="--c:' + col + '" title="Pedido ' + esc(code) + '"><i></i>' + esc(st.label) + '</span>';
  }

  /* ---------- filtros ---------- */
  var state = { period: 'hoy', desde: '', hasta: '', q: '', estado: '' };
  try {
    var saved = JSON.parse(localStorage.getItem('attomosVentasFiltro') || '{}');
    if (saved.period) state.period = saved.period;
    if (saved.period === 'rango') { state.desde = saved.desde || ''; state.hasta = saved.hasta || ''; }
  } catch (e) { /* sin almacenamiento */ }

  function rangeFor(period) {
    var t = new Date(); t.setHours(0, 0, 0, 0);
    var d1 = new Date(t), d2 = new Date(t);
    if (period === 'ayer') { d1.setDate(d1.getDate() - 1); d2 = new Date(d1); }
    if (period === '7d') d1.setDate(d1.getDate() - 6);
    if (period === 'mes') d1 = new Date(t.getFullYear(), t.getMonth(), 1);
    if (period === 'mespasado') { d1 = new Date(t.getFullYear(), t.getMonth() - 1, 1); d2 = new Date(t.getFullYear(), t.getMonth(), 0); }
    if (period === 'rango') return { desde: state.desde || iso(t), hasta: state.hasta || iso(t) };
    return { desde: iso(d1), hasta: iso(d2) };
  }

  function syncFilters() {
    $('vtPeriod').querySelectorAll('button').forEach(function (b) { b.classList.toggle('is-on', b.getAttribute('data-period') === state.period); });
    $('vtEstado').querySelectorAll('button').forEach(function (b) { b.classList.toggle('is-on', b.getAttribute('data-estado') === state.estado); });
    $('vtRange').hidden = state.period !== 'rango';
    var r = rangeFor(state.period);
    $('vtDesde').value = r.desde; $('vtHasta').value = r.hasta;
    try { localStorage.setItem('attomosVentasFiltro', JSON.stringify({ period: state.period, desde: state.desde, hasta: state.hasta })); } catch (e) {}
  }

  $('vtPeriod').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-period]');
    if (!b) return;
    state.period = b.getAttribute('data-period');
    if (state.period === 'rango' && !state.desde) { var r = rangeFor('mes'); state.desde = r.desde; state.hasta = r.hasta; }
    syncFilters(); load();
  });
  $('vtEstado').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-estado]');
    if (!b) return;
    state.estado = b.getAttribute('data-estado');
    syncFilters(); load();
  });
  ['vtDesde', 'vtHasta'].forEach(function (id) {
    $(id).addEventListener('change', function () {
      state.desde = $('vtDesde').value; state.hasta = $('vtHasta').value;
      if (state.desde && state.hasta && state.desde > state.hasta) { var x = state.desde; state.desde = state.hasta; state.hasta = x; }
      syncFilters(); load();
    });
  });
  var qTimer;
  $('vtSearch').addEventListener('input', function () {
    clearTimeout(qTimer);
    qTimer = setTimeout(function () { state.q = $('vtSearch').value.trim(); load(); }, 250);
  });

  /* ---------- tabla ---------- */
  var items = [];
  var reqId = 0;
  function load() {
    var my = ++reqId;
    var r = rangeFor(state.period);
    var url = '/api/pos/ventas?desde=' + r.desde + '&hasta=' + r.hasta +
      '&q=' + encodeURIComponent(state.q) + '&estado=' + encodeURIComponent(state.estado);
    $('vtBody').classList.add('is-loading');
    return Promise.all([api(url), estatusReady]).then(function (res) {
      var d = res[0];
      if (my !== reqId) return;
      items = d.items || [];
      render(d.totales || {}, r);
    }).catch(function (err) {
      if (my !== reqId) return;
      items = [];
      $('vtBody').innerHTML = '';
      $('vtFoot').hidden = true;
      $('vtEmpty').hidden = false;
      $('vtEmpty').textContent = err.message;
    }).finally(function () { if (my === reqId) $('vtBody').classList.remove('is-loading'); });
  }

  function periodLabel(r) {
    if (r.desde === r.hasta) return fechaLarga(r.desde);
    return fechaCorta(r.desde) + ' – ' + fechaCorta(r.hasta);
  }

  function render(t, r) {
    $('vtStVentas').textContent = t.ventas || 0;
    $('vtStTotal').textContent = money(t.total);
    $('vtStEfectivo').textContent = money(t.efectivo);
    $('vtStOtros').textContent = money((t.tarjeta || 0) + (t.transferencia || 0) + (t.otros || 0));
    $('vtStCredito').textContent = money(t.credito);
    $('vtStSaldo').textContent = money(t.saldo);

    var n = items.length;
    $('vtCaption').textContent = (n === 1 ? '1 venta' : n + ' ventas') + ' · ' + periodLabel(r) +
      (state.estado ? ' · ' + { pagada: 'pagadas', debe: 'con saldo', vencida: 'vencidas', cancelada: 'canceladas' }[state.estado] : '') +
      (t.canceladas && state.estado !== 'cancelada' ? ' · ' + t.canceladas + (t.canceladas === 1 ? ' cancelada (no suma)' : ' canceladas (no suman)') : '') +
      (state.q ? ' · «' + state.q + '»' : '');

    $('vtBody').innerHTML = items.map(function (v, i) {
      return '<tr data-folio="' + v.folio + '" class="' + (v.cancelada ? 'is-cancelada' : '') + '" style="--i:' + Math.min(i, 14) + '">' +
        '<td><b>' + v.folio + '</b></td>' +
        '<td><span class="vt-date">' + fechaCorta(v.fecha) + '</span><small>' + hora(v.fecha) + '</small></td>' +
        '<td class="vt-client">' + esc(v.cliente) + '<small>' + (v.articulos === 1 ? '1 artículo' : (v.articulos || 0) + ' artículos') + (v.cajero ? ' · ' + esc(v.cajero) : '') + '</small></td>' +
        '<td class="num"><b>' + money(v.total) + '</b></td>' +
        '<td class="num vt-cash">' + moneyCell(v.efectivo) + '</td>' +
        '<td class="num">' + moneyCell(v.tarjeta) + '</td>' +
        '<td class="num">' + moneyCell(v.transferencia) + '</td>' +
        '<td class="num c-otros">' + moneyCell((v.vales || 0) + (v.cheque || 0)) + '</td>' +
        '<td class="num">' + money(v.pagado) + '</td>' +
        '<td class="num vt-credit">' + moneyCell(v.credito) + '</td>' +
        '<td class="num">' + moneyCell(v.abonado) + '</td>' +
        '<td class="num vt-owes">' + (v.saldo > 0 ? '<b>' + money(v.saldo) + '</b>' : '<span class="vt-zero">—</span>') + '</td>' +
        '<td><span class="vt-chip is-' + v.estado + '"' + (v.vence && v.saldo > 0 ? ' title="Vence el ' + esc(fechaLarga(v.vence)) + '"' : '') + '>' + (ESTADO[v.estado] || v.estado) + '</span></td>' +
      '</tr>';
    }).join('');

    // "Otros" (vales y cheque) solo aparece si en el periodo hubo alguno.
    $('vtTable').classList.toggle('hide-otros', !(t.otros > 0));
    $('vtFoot').hidden = n === 0;
    if (n) {
      var abonado = items.reduce(function (s, v) { return s + (v.abonado || 0); }, 0);
      $('vtFtTotal').textContent = money(t.total);
      $('vtFtEfectivo').textContent = money(t.efectivo);
      $('vtFtTarjeta').textContent = money(t.tarjeta);
      $('vtFtTransf').textContent = money(t.transferencia);
      $('vtFtOtros').textContent = money(t.otros);
      $('vtFtPagado').textContent = money(t.pagado);
      $('vtFtCredito').textContent = money(t.credito);
      $('vtFtAbonado').textContent = money(abonado);
      $('vtFtSaldo').textContent = money(t.saldo);
    }
    $('vtEmpty').hidden = n > 0;
    if (!n) {
      $('vtEmpty').textContent = state.q || state.estado
        ? 'No hay ventas que coincidan en este periodo.'
        : 'No hay ventas en este periodo. Las ventas del Punto de venta aparecen aquí.';
    }
  }

  /* ---------- detalle ---------- */
  var modal = $('vtDetailModal');
  var current = null;
  function openModal() { modal.classList.add('open'); document.body.style.overflow = 'hidden'; }
  function closeModal() { modal.classList.remove('open'); document.body.style.overflow = ''; }
  $('vtDetailClose').addEventListener('click', closeModal);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && modal.classList.contains('open')) closeModal(); });

  $('vtBody').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-folio]');
    if (!tr) return;
    var folio = tr.getAttribute('data-folio');
    $('vtDetailTitle').textContent = 'Ticket ' + folio;
    $('vtDetailBody').innerHTML = '<p class="vt-empty">Cargando…</p>';
    openModal();
    Promise.all([api('/api/pos/ventas/' + folio), estatusReady]).then(function (res) {
      var d = res[0];
      current = d.venta;
      current._ticketUrl = d.ticket_url || '';
      current._tel = d.cliente_tel || '';
      renderDetail(current);
    }).catch(function (err) {
      $('vtDetailBody').innerHTML = '<p class="vt-empty">' + esc(err.message) + '</p>';
    });
  });

  function renderDetail(v) {
    var pagos = [
      ['Efectivo', v.efectivo_recibido], ['Tarjeta', v.tarjeta], ['Transferencia', v.transferencia],
      ['Vales', v.vales], ['Cheque', v.cheque]
    ].filter(function (p) { return p[1] > 0; });
    var html = '';
    html += '<div class="vt-d-head">' +
      '<div><small>Cliente</small><strong>' + esc(v.cliente) + '</strong></div>' +
      '<div><small>Fecha</small><strong>' + fechaLarga(v.fecha) + ' · ' + hora(v.fecha) + '</strong></div>' +
      '<div><small>Cajero</small><strong>' + esc(v.cajero || '—') + '</strong></div>' +
      '<div><small>Estado</small><strong><span class="vt-chip is-' + v.estado + '">' + (ESTADO[v.estado] || v.estado) + '</span></strong></div>' +
    '</div>';

    html += '<div class="vt-tabs" role="tablist">' +
      '<button type="button" class="is-on" data-vt-tab="detalle">Detalle</button>' +
      '<button type="button" data-vt-tab="ticket">Ticket digital</button>' +
    '</div>';
    html += '<div data-vt-pane="detalle">';

    if (v.cancelada) {
      html += '<div class="vt-cancel-info"><b>Venta cancelada</b> el ' + fechaLarga(v.cancelada_at) + ' · ' + hora(v.cancelada_at) +
        (v.cancelada_por ? ' por ' + esc(v.cancelada_por) : '') + (v.cancel_motivo ? '<br>Motivo: ' + esc(v.cancel_motivo) : '') +
        '<br><small>El dinero salió de la caja en el corte en que se canceló y el inventario regresó.</small></div>';
    }

    // Clave = la del artículo en Inventario. Clave de rastreo = el número
    // AVT de la pieza que se vendió (con ese se consulta el pedido).
    html += '<div class="vt-d-section"><h4>Productos</h4><div class="vt-d-table-wrap"><table class="vt-d-table"><thead><tr><th>Cant.</th><th>Clave</th><th>Descripción</th><th class="num">P. unit.</th><th class="num">Importe</th></tr></thead><tbody>' +
      v.productos.map(function (p) {
        var rs = p.rastreo && p.rastreo.length
          ? p.rastreo.map(function (r) { return '<span class="vt-rs-code">' + esc(r) + '</span>'; }).join('')
          : '<span class="vt-zero" title="Servicio o artículo sin piezas numeradas">—</span>';
        return '<tr><td>' + p.cantidad + '</td>' +
          '<td>' + (p.clave ? '<span class="vt-clave">' + esc(p.clave) + '</span>' : '<span class="vt-zero">—</span>') + '</td>' +
          '<td>' + esc(p.descripcion) + '</td>' +
          '<td class="num">' + money(p.precio) + '</td>' +
          '<td class="num">' + money(p.importe) + (p.descuento ? '<small class="vt-desc">−' + p.descuento + '%</small>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';

    html += '<div class="vt-d-grid">';
    html += '<div class="vt-d-box"><h4>Cobro</h4>' +
      (v.descuento > 0 ? '<div class="vt-d-row"><span>Subtotal</span><span>' + money(v.subtotal) + '</span></div><div class="vt-d-row"><span>Descuento</span><span>−' + money(v.descuento) + '</span></div>' : '') +
      '<div class="vt-d-row is-total"><span>Total</span><strong>' + money(v.total) + '</strong></div>' +
      pagos.map(function (p) { return '<div class="vt-d-row"><span>' + p[0] + '</span><span>' + money(p[1]) + '</span></div>'; }).join('') +
      (v.cambio > 0 ? '<div class="vt-d-row"><span>Cambio</span><span>' + money(v.cambio) + '</span></div>' : '') +
      (v.credito > 0 ? '<div class="vt-d-row is-credit"><span>Quedó a crédito</span><strong>' + money(v.credito) + '</strong></div>' : '') +
      (v.referencia ? '<div class="vt-d-row"><span>Referencia</span><span>' + esc(v.referencia) + '</span></div>' : '') +
    '</div>';

    if (v.credito > 0) {
      html += '<div class="vt-d-box"><h4>Crédito</h4>' +
        '<div class="vt-d-row"><span>Quedó a deber</span><span>' + money(v.credito) + '</span></div>' +
        '<div class="vt-d-row"><span>Abonado</span><span>' + money(v.abonado) + '</span></div>' +
        '<div class="vt-d-row is-owes"><span>Debe</span><strong>' + money(v.saldo) + '</strong></div>' +
        '<div class="vt-d-row"><span>Vence</span><span' + (v.estado === 'vencida' ? ' class="is-overdue"' : '') + '>' + (v.vence ? fechaLarga(v.vence) : 'Sin fecha') + '</span></div>' +
        '<h5>Abonos</h5>' +
        (v.abonos.length ? v.abonos.map(function (a) {
          return '<div class="vt-d-abono' + (a.cancelado ? ' is-cancelled' : '') + '"><span>' + fechaCorta(a.created_at || a.fecha) + ' · ' + hora(a.created_at) + '<small>' + esc(FORMA[a.forma_pago] || a.forma_pago) + (a.referencia ? ' · ' + esc(a.referencia) : '') + (a.cancelado ? ' · cancelado' : '') + '</small></span><b>' + money(a.monto) + '</b></div>';
        }).join('') : '<p class="vt-d-none">Todavía no hay abonos.</p>') +
        (v.saldo > 0 ? '<a class="vt-d-link" href="/pos/punto-de-venta">Para abonar, ve a Punto de venta → Créditos y abonos ›</a>' : '') +
      '</div>';
    }
    html += '</div>';
    html += '</div>'; // detalle
    html += '<div data-vt-pane="ticket" hidden>' +
      '<div class="vt-ticket-wrap"><div class="vt-ticket" id="vtTicketPreview"><p class="vt-empty">Cargando ticket…</p></div></div>' +
      '<p class="vt-ticket-link">' + (v._ticketUrl ? 'Enlace del ticket digital: <a href="' + esc(v._ticketUrl) + '" target="_blank" rel="noopener">abrir</a> · <button type="button" class="vt-linkbtn" id="vtCopyLink">copiar enlace</button>' : '') + '</p>' +
    '</div>';
    html += '<div class="vt-wa">' +
      '<label class="vt-wa-field"><span>WhatsApp del cliente</span><input type="tel" id="vtWaTel" inputmode="tel" maxlength="20" placeholder="10 dígitos" value="' + esc(v._tel || '') + '"></label>' +
      '<button type="button" class="btn small vt-wa-btn" id="vtWaSend">' +
        '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.1 5.1 0 0 0 1.1 2.7 11.6 11.6 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3z"/></svg>' +
        'Enviar ticket por WhatsApp</button>' +
    '</div>';
    if (!v.cancelada) {
      html += '<div class="vt-cancel-box" id="vtCancelBox" hidden>' +
        '<label><span>Motivo de la cancelación</span><input type="text" id="vtCancelMotivo" maxlength="200" placeholder="Ej. el cliente se arrepintió, error al cobrar…"></label>' +
        '<p class="vt-cancel-note">Se regresa al inventario lo vendido, el crédito queda en 0 y el dinero sale de la caja en el siguiente corte.</p>' +
        '<p class="staff-error" id="vtCancelError"></p>' +
        '<div class="vt-cancel-actions"><button type="button" class="btn small" id="vtCancelNo">No cancelar</button><button type="button" class="btn small vt-btn-danger" id="vtCancelYes">Sí, cancelar la venta</button></div>' +
      '</div>';
    }
    html += '<div class="staff-form-actions">' + (v.cancelada ? '' : '<button type="button" class="btn small vt-btn-danger-ghost" id="vtCancelOpen">Cancelar venta</button>') +
      '<button type="button" class="btn small" id="vtReprint">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>' +
      'Reimprimir ticket</button><button type="button" class="btn solid small" id="vtDetailOk">Cerrar</button></div>';
    $('vtDetailBody').innerHTML = html;
    $('vtDetailOk').addEventListener('click', closeModal);
    $('vtReprint').addEventListener('click', reprint);
    $('vtWaSend').addEventListener('click', sendWhatsApp);
    if ($('vtCancelOpen')) {
      $('vtCancelOpen').addEventListener('click', function () {
        $('vtCancelBox').hidden = false;
        $('vtCancelBox').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        setTimeout(function () { $('vtCancelMotivo').focus(); }, 80);
      });
      $('vtCancelNo').addEventListener('click', function () { $('vtCancelBox').hidden = true; });
      $('vtCancelYes').addEventListener('click', function () {
        var motivo = $('vtCancelMotivo').value.trim();
        if (!motivo) { $('vtCancelError').textContent = 'Escribe el motivo de la cancelación.'; $('vtCancelMotivo').focus(); return; }
        var b = this; b.disabled = true; b.textContent = 'Cancelando…';
        send('POST', '/api/pos/ventas/' + v.folio + '/cancelar', { motivo: motivo }).then(function () {
          return api('/api/pos/ventas/' + v.folio);
        }).then(function (d) {
          current = d.venta;
          current._ticketUrl = d.ticket_url || '';
          current._tel = d.cliente_tel || '';
          renderDetail(current);
          load();
        }).catch(function (err) { $('vtCancelError').textContent = err.message; b.disabled = false; b.textContent = 'Sí, cancelar la venta'; });
      });
    }
    var copyBtn = $('vtCopyLink');
    if (copyBtn) copyBtn.addEventListener('click', function () {
      var url = location.origin + v._ticketUrl;
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { copyBtn.textContent = '¡copiado!'; })
        .catch(function () { window.prompt('Copia el enlace del ticket:', url); });
    });
    $('vtDetailBody').querySelector('.vt-tabs').addEventListener('click', function (e) {
      var b = e.target.closest('[data-vt-tab]');
      if (!b) return;
      var tab = b.getAttribute('data-vt-tab');
      this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('is-on', x === b); });
      $('vtDetailBody').querySelectorAll('[data-vt-pane]').forEach(function (p) { p.hidden = p.getAttribute('data-vt-pane') !== tab; });
      if (tab === 'ticket') renderTicketPreview();
    });
    wirePedido();
  }

  /* ---------- pedido (clave de rastreo) ---------- */
  function pedidoBox(v) {
    if (!v.pedido_code) {
      return '<div class="vt-ped-empty"><div><small>Clave de rastreo</small><span>Esta venta no tiene pedido.</span></div>' +
        '<button type="button" class="btn small" id="vtPedCreate">Crear pedido</button></div>';
    }
    var opts = estatusList.map(function (st) {
      return '<option value="' + esc(st.key) + '"' + (st.key === v.pedido_status ? ' selected' : '') + '>' + esc(st.label) + '</option>';
    }).join('');
    if (!estatus[v.pedido_status]) opts = '<option value="' + esc(v.pedido_status) + '" selected>' + esc(v.pedido_status) + '</option>' + opts;
    return '<div class="vt-ped-main"><small>Clave de rastreo</small><strong class="vt-ped-code">' + esc(v.pedido_code) + '</strong>' +
        '<a href="/rastreo?pedido=' + encodeURIComponent(v.pedido_code) + '" target="_blank" rel="noopener">Ver como el cliente ›</a></div>' +
      '<div class="vt-ped-status"><small>Estatus del pedido</small>' + pedidoChip(v.pedido_code, v.pedido_status) +
        '<select id="vtPedStatus" aria-label="Cambiar estatus">' + opts + '</select></div>';
  }
  function wirePedido() {
    var v = current;
    var sel = $('vtPedStatus'), mk = $('vtPedCreate');
    // Estatus del pedido: dropdown animado (av-select.js).
    if (sel && window.AvSelect) window.AvSelect.enhance(sel);
    if (sel) sel.addEventListener('change', function () {
      var val = sel.value;
      sel.disabled = true;
      send('PUT', '/api/pos/ventas/' + v.folio + '/pedido/estado', { status: val }).then(function () {
        v.pedido_status = val;
        $('vtPedido').innerHTML = pedidoBox(v);
        wirePedido();
        updateRow(v);
      }).catch(function (err) { sel.disabled = false; alert(err.message); });
    });
    if (mk) mk.addEventListener('click', function () {
      mk.disabled = true;
      send('POST', '/api/pos/ventas/' + v.folio + '/pedido', {}).then(function (d) {
        v.pedido_code = d.pedido.code;
        v.pedido_status = d.pedido.status;
        $('vtPedido').innerHTML = pedidoBox(v);
        wirePedido();
        updateRow(v);
      }).catch(function (err) { mk.disabled = false; alert(err.message); });
    });
  }
  function updateRow(v) {
    items.forEach(function (it) { if (it.folio === v.folio) { it.pedido_code = v.pedido_code; it.pedido_status = v.pedido_status; } });
    var tr = $('vtBody').querySelector('tr[data-folio="' + v.folio + '"] .vt-ped-cell');
    if (tr) tr.innerHTML = pedidoChip(v.pedido_code, v.pedido_status) + (v.pedido_code ? '<small>' + esc(v.pedido_code) + '</small>' : '');
  }
  function send(method, url, body) {
    return fetch(url, {
      method: method, credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) throw new Error(d.error || 'No se pudo guardar.');
        return d;
      });
    });
  }

  /* ---------- ticket digital + WhatsApp ---------- */
  function ticketVenta(v) {
    return {
      folio: v.folio,
      fecha: parseISO(v.fecha) || new Date(),
      caja: 'Caja 1',
      cliente: v.cliente,
      cajero: v.cajero || cajero,
      productos: v.productos.map(function (p) { return { descripcion: p.descripcion, cantidad: p.cantidad, precio: p.precio, descuento: p.descuento || 0, rastreo: p.rastreo || [] }; }),
      pedido: v.pedido_code || '',
      pagos: { efectivo: v.efectivo_recibido, tarjeta: v.tarjeta, transferencia: v.transferencia, vales: v.vales, cheque: v.cheque, credito: v.credito },
      cambio: v.cambio,
      propina: v.propina || 0,
      propina_forma: v.propina_forma || '',
      referencia: v.referencia,
      vencimiento: v.vence || ''
    };
  }
  function renderTicketPreview() {
    if (!T || !current) return;
    var v = current;
    loadTemplate().then(function (tpl) {
      if (current !== v) return;
      $('vtTicketPreview').innerHTML = T.html(tpl, ticketVenta(v));
    });
  }
  function waNumber(raw) {
    var d = String(raw || '').replace(/\D/g, '');
    if (d.length === 10) return '52' + d;
    if (d.length === 12 && d.indexOf('52') === 0) return d;
    if (d.length === 13 && d.indexOf('521') === 0) return '52' + d.slice(3);
    return d.length >= 11 ? d : '';
  }
  function sendWhatsApp() {
    var v = current;
    if (!v) return;
    var inp = $('vtWaTel');
    var num = waNumber(inp.value);
    if (!num) { inp.focus(); inp.classList.add('is-bad'); setTimeout(function () { inp.classList.remove('is-bad'); }, 1200); return; }
    var nombre = /p[uú]blico en general/i.test(v.cliente || '') ? '' : ' ' + String(v.cliente).split(' ')[0];
    var lines = [
      'Hola' + nombre + ', gracias por tu compra en ' + ((window.POS_BIZ && window.POS_BIZ.nombre) || 'Attomos') + '.',
      'Aquí está tu ticket ' + v.folio + ' por ' + money(v.total) + ':',
      location.origin + (v._ticketUrl || '')
    ];
    if (v.pedido_code) {
      lines.push('', 'Tu clave de rastreo es ' + v.pedido_code + '. Consulta cómo va tu pedido aquí:',
        location.origin + '/rastreo?pedido=' + encodeURIComponent(v.pedido_code));
    }
    window.open('https://wa.me/' + num + '?text=' + encodeURIComponent(lines.join('\n')), '_blank', 'noopener');
  }

  /* ---------- reimprimir con la plantilla de Plantillas ---------- */
  var tplCache = null;
  function loadTemplate() {
    if (tplCache) return Promise.resolve(tplCache);
    return fetch('/api/pos/ticket-plantilla', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (d) { tplCache = T.merge(d && d.data); return tplCache; })
      .catch(function () { tplCache = T.defaults(); return tplCache; });
  }
  function reprint() {
    if (!T || !current) return;
    var v = current;
    loadTemplate().then(function (tpl) { T.print(tpl, ticketVenta(v)); });
  }

  /* =======================================================
     ANIMACIÓN DE LOS FILTROS DE PERIODO
     La pastilla azul se desliza al periodo elegido.
     ======================================================= */
  function glowFor(seg) {
    var g = seg && seg.querySelector('.vt-seg-glow');
    if (!g) return function () {};
    seg.classList.add('has-glow');
    return function (instant) {
      var on = seg.querySelector('button.is-on');
      if (!on) { g.style.opacity = '0'; return; }
      g.style.opacity = '1';
      if (instant) g.style.transition = 'none';
      g.style.width = on.offsetWidth + 'px';
      g.style.height = on.offsetHeight + 'px';
      g.style.transform = 'translate(' + on.offsetLeft + 'px,' + on.offsetTop + 'px)';
      if (instant) { void g.offsetWidth; g.style.transition = ''; }
    };
  }
  var movePeriod = glowFor($('vtPeriod'));
  var firstSync = true;
  var _sync = syncFilters;
  syncFilters = function () {
    _sync();
    movePeriod(firstSync);
    firstSync = false;
  };
  $('vtPeriod').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-period]');
    if (!b) return;
    b.classList.remove('is-pop'); void b.offsetWidth; b.classList.add('is-pop');
    var wrap = document.querySelector('.vt-table-wrap'), stats = $('vtStats');
    [wrap, stats].forEach(function (el) { if (!el) return; el.classList.remove('is-swap'); void el.offsetWidth; el.classList.add('is-swap'); });
  });
  window.addEventListener('resize', function () { movePeriod(true); });

  // Los números del resumen cuentan hasta su nuevo valor.
  var _render = render;
  var lastStats = {};
  render = function (t, r) {
    _render(t, r);
    [['vtStVentas', t.ventas || 0, false], ['vtStTotal', t.total, true], ['vtStEfectivo', t.efectivo, true],
     ['vtStOtros', (t.tarjeta || 0) + (t.transferencia || 0) + (t.otros || 0), true], ['vtStCredito', t.credito, true], ['vtStSaldo', t.saldo, true]]
      .forEach(function (x) { countTo($(x[0]), lastStats[x[0]] || 0, Number(x[1]) || 0, x[2]); lastStats[x[0]] = Number(x[1]) || 0; });
  };
  function countTo(el, from, to, isMoney) {
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches || from === to) { if (el) el.textContent = isMoney ? money(to) : String(Math.round(to)); return; }
    var t0 = performance.now(), dur = 520;
    (function step(now) {
      var k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3), v = from + (to - from) * e;
      el.textContent = isMoney ? money(v) : String(Math.round(v));
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  }

  /* =======================================================
     EXPORTAR REPORTE EN PDF (estadísticas + gráficas)
     ======================================================= */
  var expModal = $('vtExportModal');
  var expTipo = 'dia';
  var moveExp = glowFor($('vtExpTipo'));
  var DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  function d0(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function expRange() {
    var t = d0(new Date());
    if (expTipo === 'dia') { var d = parseISO($('vtExpDia').value) || t; return { desde: iso(d), hasta: iso(d), titulo: 'Reporte del día', sub: DIAS[d.getDay()] + ' ' + fechaLarga(iso(d)) }; }
    if (expTipo === 'semana') {
      var w = parseISO($('vtExpSemana').value) || t;
      var lun = new Date(w); lun.setDate(w.getDate() - ((w.getDay() + 6) % 7));
      var dom = new Date(lun); dom.setDate(lun.getDate() + 6);
      return { desde: iso(lun), hasta: iso(dom), titulo: 'Reporte de la semana', sub: 'del ' + fechaLarga(iso(lun)) + ' al ' + fechaLarga(iso(dom)) };
    }
    if (expTipo === 'mes') {
      var m = /^(\d{4})-(\d{2})$/.exec($('vtExpMes').value || '');
      var y = m ? +m[1] : t.getFullYear(), mo = m ? +m[2] - 1 : t.getMonth();
      var a = new Date(y, mo, 1), z = new Date(y, mo + 1, 0);
      return { desde: iso(a), hasta: iso(z), titulo: 'Reporte del mes', sub: MESES_L[mo] + ' de ' + y };
    }
    var r = rangeFor(state.period);
    return { desde: r.desde, hasta: r.hasta, titulo: 'Reporte de ventas', sub: periodLabel(r) };
  }
  function cap(x) { return x ? x.charAt(0).toUpperCase() + x.slice(1) : x; }
  function syncExp() {
    $('vtExpTipo').querySelectorAll('button').forEach(function (b) { b.classList.toggle('is-on', b.getAttribute('data-tipo') === expTipo); });
    expModal.querySelectorAll('[data-for]').forEach(function (el) { el.hidden = el.getAttribute('data-for') !== expTipo; });
    var r = expRange();
    $('vtExpActual').textContent = 'Lo que está filtrado en la tabla: ' + periodLabel(rangeFor(state.period)) + '.';
    $('vtExpRange').innerHTML = 'Se exporta: <b>' + esc(cap(r.sub)) + '</b>';
    moveExp();
  }
  $('vtExportBtn').addEventListener('click', function () {
    var t = new Date();
    if (!$('vtExpDia').value) $('vtExpDia').value = iso(t);
    if (!$('vtExpSemana').value) $('vtExpSemana').value = iso(t);
    if (!$('vtExpMes').value) $('vtExpMes').value = t.getFullYear() + '-' + pad(t.getMonth() + 1);
    $('vtExpError').textContent = '';
    expModal.classList.add('open'); document.body.style.overflow = 'hidden';
    requestAnimationFrame(function () { moveExp(true); syncExp(); });
  });
  function closeExp() { expModal.classList.remove('open'); document.body.style.overflow = ''; }
  $('vtExportClose').addEventListener('click', closeExp);
  $('vtExpCancel').addEventListener('click', closeExp);
  expModal.addEventListener('click', function (e) { if (e.target === expModal) closeExp(); });
  $('vtExpTipo').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-tipo]');
    if (!b) return;
    expTipo = b.getAttribute('data-tipo');
    b.classList.remove('is-pop'); void b.offsetWidth; b.classList.add('is-pop');
    syncExp();
  });
  ['vtExpDia', 'vtExpSemana', 'vtExpMes'].forEach(function (id) { $(id).addEventListener('change', syncExp); });

  var LIBS = {
    h2c: 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
    jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
  };
  var libP = {};
  function loadLib(src) {
    if (libP[src]) return libP[src];
    libP[src] = new Promise(function (res, rej) {
      var sc = document.createElement('script'); sc.src = src; sc.async = true;
      sc.onload = res; sc.onerror = function () { libP[src] = null; rej(new Error('No se pudo cargar el generador de PDF (¿sin internet?).')); };
      document.head.appendChild(sc);
    });
    return libP[src];
  }

  // Agrupa las ventas: por hora (un día), por día (hasta 62 días) o por mes.
  function buckets(r, list) {
    var a = parseISO(r.desde), z = parseISO(r.hasta), days = Math.round((z - a) / 864e5) + 1;
    var mode = days <= 1 ? 'hora' : days <= 62 ? 'dia' : 'mes';
    var map = {}, order = [];
    function key(d) { return mode === 'hora' ? String(d.getHours()) : mode === 'dia' ? iso(d) : d.getFullYear() + '-' + pad(d.getMonth() + 1); }
    function add(k, label) { if (!map[k]) { map[k] = { k: k, label: label, ventas: 0, total: 0, efectivo: 0, tarjeta: 0, transferencia: 0, otros: 0, credito: 0 }; order.push(k); } }
    if (mode === 'hora') {
      var hs = list.map(function (v) { return (parseISO(v.fecha) || a).getHours(); });
      var h1 = Math.min.apply(null, [9].concat(hs)), h2 = Math.max.apply(null, [19].concat(hs));
      for (var h = h1; h <= h2; h++) add(String(h), ((h % 12) || 12) + (h < 12 ? ' am' : ' pm'));
    } else if (mode === 'dia') {
      for (var d = new Date(a); d <= z; d.setDate(d.getDate() + 1)) add(iso(d), d.getDate() + ' ' + MESES[d.getMonth()]);
    } else {
      for (var m = new Date(a.getFullYear(), a.getMonth(), 1); m <= z; m.setMonth(m.getMonth() + 1)) add(key(m), MESES[m.getMonth()] + ' ' + String(m.getFullYear()).slice(2));
    }
    list.forEach(function (v) {
      if (v.cancelada) return;
      var b = map[key(parseISO(v.fecha) || a)];
      if (!b) return;
      b.ventas++; b.total += v.total; b.efectivo += v.efectivo; b.tarjeta += v.tarjeta; b.transferencia += v.transferencia;
      b.otros += (v.vales || 0) + (v.cheque || 0); b.credito += v.credito;
    });
    var nowK = key(new Date()), rows = order.map(function (k) { return map[k]; });
    if (mode !== 'hora') { var past = true; rows.forEach(function (b) { b.future = !past; if (b.k === nowK) past = false; }); if (past) rows.forEach(function (b) { b.future = false; }); }
    return { mode: mode, rows: rows };
  }

  /* ---------- gráficas (SVG estático para el PDF) ---------- */
  var C = { s1: '#2a78d6', s2: '#eb6834', s3: '#1baf7a', grid: '#e6e6e3', axis: '#b9b8b2', ink: '#0b0b0b', ink2: '#52514e', muted: '#8a8984' };
  function niceMax(v) {
    if (!(v > 0)) return 100;
    var p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }
  function shortMoney(v) {
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(v % 1e6 ? 1 : 0) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(v % 1e3 ? 1 : 0) + 'k';
    return '$' + Math.round(v);
  }
  function frame(W, H, P, max) {
    var out = '', ticks = 4;
    for (var i = 0; i <= ticks; i++) {
      var y = P.t + (H - P.t - P.b) * (1 - i / ticks), v = max * i / ticks;
      out += '<line x1="' + P.l + '" x2="' + (W - P.r) + '" y1="' + y + '" y2="' + y + '" stroke="' + (i ? C.grid : C.axis) + '" stroke-width="1"/>';
      out += '<text x="' + (P.l - 8) + '" y="' + (y + 4) + '" text-anchor="end" font-size="10.5" fill="' + C.ink2 + '">' + shortMoney(v) + '</text>';
    }
    return out;
  }
  function xLabels(rows, W, H, P, xOf) {
    var n = rows.length, every = Math.max(1, Math.ceil(n / 12)), out = '';
    rows.forEach(function (b, i) {
      if (i % every && i !== n - 1) return;
      out += '<text x="' + xOf(i) + '" y="' + (H - P.b + 16) + '" text-anchor="middle" font-size="10.5" fill="' + C.ink2 + '">' + esc(b.label) + '</text>';
    });
    return out;
  }
  function barChart(rows) {
    var W = 720, H = 250, P = { t: 22, r: 12, b: 28, l: 54 };
    var max = niceMax(Math.max.apply(null, rows.map(function (b) { return b.total; }).concat([0])));
    var n = rows.length, slot = (W - P.l - P.r) / n, bw = Math.max(3, Math.min(42, slot - 2));
    var y0 = H - P.b, k = (H - P.t - P.b) / max;
    var best = rows.reduce(function (m, b, i) { return b.total > (rows[m] ? rows[m].total : -1) ? i : m; }, 0);
    var out = frame(W, H, P, max);
    rows.forEach(function (b, i) {
      if (!(b.total > 0)) return;
      var x = P.l + slot * i + (slot - bw) / 2, h = Math.max(1, b.total * k), y = y0 - h, rr = Math.min(4, bw / 2, h);
      out += '<path d="M' + x + ',' + y0 + 'V' + (y + rr) + 'Q' + x + ',' + y + ' ' + (x + rr) + ',' + y + 'H' + (x + bw - rr) + 'Q' + (x + bw) + ',' + y + ' ' + (x + bw) + ',' + (y + rr) + 'V' + y0 + 'Z" fill="' + C.s1 + '"/>';
      if (i === best) out += '<text x="' + (x + bw / 2) + '" y="' + (y - 6) + '" text-anchor="middle" font-size="10.5" font-weight="700" fill="' + C.ink + '">' + money(b.total) + '</text>';
    });
    out += xLabels(rows, W, H, P, function (i) { return P.l + slot * i + slot / 2; });
    return '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" font-family="Public Sans, Arial, sans-serif">' + out + '</svg>';
  }
  function lineChart(rows) {
    var W = 720, H = 250, P = { t: 22, r: 118, b: 28, l: 54 };
    var series = [['efectivo', 'Efectivo', C.s1], ['tarjeta', 'Tarjeta', C.s2], ['transferencia', 'Transferencia', C.s3]];
    var max = niceMax(Math.max.apply(null, [0].concat(rows.map(function (b) { return Math.max(b.efectivo, b.tarjeta, b.transferencia); }))));
    var n = rows.length, y0 = H - P.b, k = (H - P.t - P.b) / max;
    var xOf = function (i) { return n === 1 ? (P.l + (W - P.r)) / 2 : P.l + (W - P.l - P.r) * i / (n - 1); };
    var out = frame(W, H, P, max), ends = [];
    var upto = rows.length;
    for (var j = rows.length - 1; j > 0; j--) { if (rows[j].future) upto = j; else break; }
    series.forEach(function (s) {
      var pts = rows.slice(0, upto).map(function (b, i) { return [xOf(i), y0 - b[s[0]] * k]; });
      out += '<polyline points="' + pts.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ') + '" fill="none" stroke="' + s[2] + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
      if (n <= 16 || upto <= 16) pts.forEach(function (p) { out += '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="4" fill="' + s[2] + '" stroke="#ffffff" stroke-width="2"/>'; });
      var last = pts[pts.length - 1], tot = rows.reduce(function (a, b) { return a + b[s[0]]; }, 0);
      ends.push({ y: last[1], x: last[0], label: s[1], color: s[2], tot: tot });
    });
    // Etiquetas al final de cada línea, sin encimarse.
    ends.sort(function (a, b) { return a.y - b.y; });
    var GAP = 28, lo = P.t + 4, hi = y0 - 10;
    ends.forEach(function (e) { e.ly = Math.max(lo, Math.min(hi, e.y)); });
    for (var i = 1; i < ends.length; i++) if (ends[i].ly - ends[i - 1].ly < GAP) ends[i].ly = ends[i - 1].ly + GAP;
    var over = ends.length ? ends[ends.length - 1].ly - hi : 0;
    if (over > 0) ends.forEach(function (e) { e.ly -= over; });
    var lx = (ends.length ? ends[0].x : W - P.r) + 14;
    ends.forEach(function (e) {
      out += '<path d="M' + (e.x + 5) + ',' + e.y + 'L' + (lx - 4) + ',' + e.ly + '" stroke="' + e.color + '" stroke-width="1" fill="none" opacity=".6"/>';
      out += '<text x="' + lx + '" y="' + (e.ly - 1) + '" font-size="10.5" font-weight="700" fill="' + C.ink + '">' + e.label + '</text>';
      out += '<text x="' + lx + '" y="' + (e.ly + 11) + '" font-size="10" fill="' + C.ink2 + '">' + money(e.tot) + '</text>';
    });
    out += xLabels(rows, W, H, P, xOf);
    var legend = series.map(function (s) { return '<span class="vr-key"><i style="background:' + s[2] + '"></i>' + s[1] + '</span>'; }).join('');
    return '<div class="vr-legend">' + legend + '</div><svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" font-family="Public Sans, Arial, sans-serif">' + out + '</svg>';
  }

  var REPORT_CSS = [
    '.vr{box-sizing:border-box;width:816px;padding:40px 48px 30px;background:#fff;color:#0b0b0b;font-family:"Public Sans",Arial,sans-serif;font-size:12px;}',
    '.vr *{box-sizing:border-box;}',
    '.vr-head{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-bottom:14px;border-bottom:2px solid #0b2aa8;}',
    '.vr-brand{display:flex;align-items:center;gap:10px;}.vr-brand img{width:40px;height:40px;object-fit:contain;}',
    '.vr-brand b{display:block;font-size:15px;color:#0b2aa8;}.vr-brand small{display:block;font-size:11px;color:#52514e;}',
    '.vr-title{text-align:right;}.vr-title h1{margin:0;font-family:Fraunces,Georgia,serif;font-size:22px;font-weight:600;color:#0b0b0b;}',
    '.vr-title p{margin:2px 0 0;font-size:12px;color:#52514e;}',
    '.vr-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:18px 0 6px;}',
    '.vr-kpi{border:1px solid #e6e6e3;border-radius:10px;padding:10px 12px;}',
    '.vr-kpi small{display:block;font-size:9.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#52514e;}',
    '.vr-kpi b{display:block;margin-top:3px;font-size:17px;font-variant-numeric:tabular-nums;color:#0b0b0b;}',
    '.vr-kpi em{display:block;font-style:normal;font-size:10px;color:#52514e;margin-top:2px;}',
    '.vr-kpi.is-main{background:#f2f6fe;border-color:#cfdcf6;}',
    '.vr-up{color:#0b6b0b;font-weight:700;}.vr-down{color:#b42318;font-weight:700;}',
    '.vr-sec{margin-top:18px;}.vr-sec h2{margin:0 0 2px;font-size:13px;font-weight:700;color:#0b0b0b;}',
    '.vr-sec p.vr-note{margin:0 0 8px;font-size:10.5px;color:#52514e;}',
    '.vr-legend{display:flex;gap:16px;margin:0 0 4px 54px;font-size:10.5px;color:#0b0b0b;}',
    '.vr-key{display:inline-flex;align-items:center;gap:6px;}.vr-key i{width:14px;height:3px;border-radius:2px;display:inline-block;}',
    '.vr table{width:100%;border-collapse:collapse;font-size:10.5px;}',
    '.vr th{text-align:right;padding:6px 8px;border-bottom:1px solid #b9b8b2;font-size:9.5px;letter-spacing:.04em;text-transform:uppercase;color:#52514e;}',
    '.vr th:first-child,.vr td:first-child{text-align:left;}',
    '.vr td{text-align:right;padding:5px 8px;border-bottom:1px solid #eeeeec;font-variant-numeric:tabular-nums;}',
    '.vr tfoot td{font-weight:700;border-top:1px solid #b9b8b2;border-bottom:none;}',
    '.vr-two{display:grid;grid-template-columns:1fr 1fr;gap:18px;}',
    '.vr-foot{display:flex;justify-content:space-between;margin-top:18px;padding-top:8px;border-top:1px solid #e6e6e3;font-size:10px;color:#8a8984;}'
  ].join('');

  function pctTxt(now, before) {
    if (!(before > 0)) return '';
    var p = (now - before) / before * 100;
    if (Math.round(p) === 0) return 'igual que el periodo anterior';
    return '<span class="' + (p >= 0 ? 'vr-up' : 'vr-down') + '">' + (p >= 0 ? '▲ ' : '▼ ') + Math.abs(p).toFixed(0) + '%</span> vs. periodo anterior';
  }
  function reportHTML(r, data, prev) {
    var list = data.items || [], t = data.totales || {}, pt = (prev && prev.totales) || {};
    var vivas = list.filter(function (v) { return !v.cancelada; });
    var canc = list.filter(function (v) { return v.cancelada; });
    var bk = buckets(r, list);
    var prom = t.ventas ? t.total / t.ventas : 0;
    var abonado = vivas.reduce(function (a, v) { return a + (v.abonado || 0); }, 0);
    var best = bk.rows.reduce(function (m, b) { return b.total > (m ? m.total : 0) ? b : m; }, null);
    var unidad = bk.mode === 'hora' ? 'hora' : bk.mode === 'dia' ? 'día' : 'mes';
    var cajeros = {};
    vivas.forEach(function (v) { var k = v.cajero || '—'; cajeros[k] = cajeros[k] || { n: 0, total: 0 }; cajeros[k].n++; cajeros[k].total += v.total; });
    var cajList = Object.keys(cajeros).map(function (k) { return [k, cajeros[k]]; }).sort(function (a, b) { return b[1].total - a[1].total; });
    var kpi = function (label, val, sub, cls) { return '<div class="vr-kpi' + (cls ? ' ' + cls : '') + '"><small>' + label + '</small><b>' + val + '</b>' + (sub ? '<em>' + sub + '</em>' : '') + '</div>'; };
    var html = '<div class="vr">' +
      '<div class="vr-head"><div class="vr-brand">' + ((window.POS_BIZ && window.POS_BIZ.logo) ? '<img src="' + esc(window.POS_BIZ.logo) + '" alt="">' : '') + '<div><b>' + esc(((window.POS_BIZ && window.POS_BIZ.nombre) || 'Attomos')) + '</b><small>Punto de venta</small></div></div>' +
        '<div class="vr-title"><h1>' + esc(r.titulo) + '</h1><p>' + esc(cap(r.sub)) + '</p></div></div>' +
      '<div class="vr-kpis">' +
        kpi('Total vendido', money(t.total), pctTxt(t.total, pt.total), 'is-main') +
        kpi('Ventas', String(t.ventas || 0), pctTxt(t.ventas, pt.ventas), 'is-main') +
        kpi('Ticket promedio', money(prom), '') +
        kpi('Mejor ' + unidad, best && best.total > 0 ? esc(best.label) : '—', best && best.total > 0 ? money(best.total) : '') +
        kpi('Efectivo en caja', money(t.efectivo), 'ya sin el cambio') +
        kpi('Tarjeta', money(t.tarjeta), '') +
        kpi('Transferencia', money(t.transferencia), '') +
        kpi('Vales y cheque', money(t.otros), '') +
        kpi('Quedó a crédito', money(t.credito), '') +
        kpi('Abonado', money(abonado), 'de esos créditos') +
        kpi('Todavía deben', money(t.saldo), '') +
        kpi('Canceladas', String(canc.length), canc.length ? money(canc.reduce(function (a, v) { return a + v.total; }, 0)) + ' (no suman)' : '') +
      '</div>' +
      '<div class="vr-sec"><h2>Total vendido por ' + unidad + '</h2><p class="vr-note">Ventas cobradas (sin canceladas). La barra más alta lleva su importe.</p>' + barChart(bk.rows) + '</div>' +
      '<div class="vr-sec"><h2>Cobrado por forma de pago</h2><p class="vr-note">Efectivo, tarjeta y transferencia por ' + unidad + ' (vales, cheque y crédito vienen en la tabla).</p>' + lineChart(bk.rows) + '</div>' +
      '<div class="vr-sec"><h2>Detalle por ' + unidad + '</h2><p class="vr-note">Solo aparecen ' + (bk.mode === 'hora' ? 'las horas' : bk.mode === 'dia' ? 'los días' : 'los meses') + ' con ventas.</p><table><thead><tr><th>' + (bk.mode === 'hora' ? 'Hora' : bk.mode === 'dia' ? 'Día' : 'Mes') + '</th><th>Ventas</th><th>Total</th><th>Efectivo</th><th>Tarjeta</th><th>Transf.</th><th>Vales/cheque</th><th>A crédito</th></tr></thead><tbody>' +
        bk.rows.filter(function (b) { return b.ventas; }).map(function (b) {
          return '<tr><td>' + esc(b.label) + '</td><td>' + b.ventas + '</td><td>' + money(b.total) + '</td><td>' + money(b.efectivo) + '</td><td>' + money(b.tarjeta) + '</td><td>' + money(b.transferencia) + '</td><td>' + money(b.otros) + '</td><td>' + money(b.credito) + '</td></tr>';
        }).join('') +
        '</tbody><tfoot><tr><td>Total</td><td>' + (t.ventas || 0) + '</td><td>' + money(t.total) + '</td><td>' + money(t.efectivo) + '</td><td>' + money(t.tarjeta) + '</td><td>' + money(t.transferencia) + '</td><td>' + money(t.otros) + '</td><td>' + money(t.credito) + '</td></tr></tfoot></table></div>' +
      '<div class="vr-sec"><h2>Ventas por cajero</h2><table><thead><tr><th>Cajero</th><th>Ventas</th><th>Total</th><th>Promedio</th></tr></thead><tbody>' +
        (cajList.length ? cajList.map(function (c) { return '<tr><td>' + esc(c[0]) + '</td><td>' + c[1].n + '</td><td>' + money(c[1].total) + '</td><td>' + money(c[1].total / c[1].n) + '</td></tr>'; }).join('') : '<tr><td colspan="4">Sin ventas en este periodo.</td></tr>') +
        '</tbody></table></div>' +
      '<div class="vr-foot"><span>Del ' + fechaLarga(r.desde) + ' al ' + fechaLarga(r.hasta) + '</span><span>Generado por ' + esc(cajero || 'Punto de venta') + ' · ' + fechaLarga(iso(new Date())) + ' ' + new Date().toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' }) + '</span></div>' +
    '</div>';
    return html;
  }

  function prevRange(r) {
    var a = parseISO(r.desde), z = parseISO(r.hasta);
    if (expTipo === 'mes') { var pa = new Date(a.getFullYear(), a.getMonth() - 1, 1), pz = new Date(a.getFullYear(), a.getMonth(), 0); return { desde: iso(pa), hasta: iso(pz) }; }
    var days = Math.round((z - a) / 864e5) + 1;
    var pz2 = new Date(a); pz2.setDate(a.getDate() - 1);
    var pa2 = new Date(pz2); pa2.setDate(pz2.getDate() - days + 1);
    return { desde: iso(pa2), hasta: iso(pz2) };
  }

  function makePdf(html, name) {
    return Promise.all([loadLib(LIBS.h2c), loadLib(LIBS.jspdf)]).then(function () {
      if (!document.getElementById('vrCss')) { var st = document.createElement('style'); st.id = 'vrCss'; st.textContent = REPORT_CSS; document.head.appendChild(st); }
      var host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:-12000px;top:0;background:#fff;';
      host.innerHTML = html;
      document.body.appendChild(host);
      var el = host.firstChild;
      var imgs = el.querySelectorAll('img');
      return Promise.all(Array.prototype.map.call(imgs, function (im) { return im.complete ? null : new Promise(function (r) { im.onload = im.onerror = r; }); }))
        .then(function () { return document.fonts && document.fonts.ready; })
        .then(function () {
          // Puntos donde se puede cortar la hoja: inicio de cada sección y de cada renglón de tabla.
          var top0 = el.getBoundingClientRect().top;
          el._cuts = Array.prototype.map.call(el.querySelectorAll('.vr-sec, tbody tr:nth-child(n+3), tfoot tr'), function (n) { return n.getBoundingClientRect().top - top0 - 6; });
          return window.html2canvas(el, { scale: 2, backgroundColor: '#ffffff', logging: false });
        })
        .then(function (cv) {
          host.remove();
          var W = 816, H = 1056, k = cv.width / W, margin = Math.round(34 * k), pageH = Math.floor(H * k), y = 0, first = true;
          var pdf = new window.jspdf.jsPDF({ unit: 'px', format: [W, H], orientation: 'portrait', hotfixes: ['px_scaling'] });
          var src = cv.getContext('2d');
          var cuts = (el._cuts || []).map(function (c) { return Math.round(c * k); });
          function cutAt(limit) {
            if (limit >= cv.height) return cv.height;
            // Primero: cortar justo antes de una sección o renglón, para no dejar un título solo.
            var best = -1;
            cuts.forEach(function (c) { if (c <= limit && c > y + pageH * 0.45 && c > best) best = c; });
            if (best > 0) return best;
            for (var yy = limit; yy > limit - Math.round(90 * k); yy--) {
              var row = src.getImageData(0, yy, cv.width, 1).data, blank = true;
              for (var i = 0; i < row.length; i += 16) { if (row[i] < 240 || row[i + 1] < 240 || row[i + 2] < 240) { blank = false; break; } }
              if (blank) return yy;
            }
            return limit;
          }
          while (y < cv.height - 2) {
            var top = first ? 0 : margin;
            var end = cutAt(y + pageH - top - (first ? 0 : margin)), hh = end - y;
            if (hh <= 0) break;
            var part = document.createElement('canvas'); part.width = cv.width; part.height = hh;
            var ctx = part.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, part.width, part.height);
            ctx.drawImage(cv, 0, y, cv.width, hh, 0, 0, cv.width, hh);
            if (!first) pdf.addPage([W, H], 'portrait');
            pdf.addImage(part.toDataURL('image/jpeg', 0.92), 'JPEG', 0, top / k, W, hh / k);
            first = false; y = end;
          }
          pdf.save(name);
        }, function (err) { host.remove(); throw err; });
    });
  }

  $('vtExpGo').addEventListener('click', function () {
    var r = expRange(), pr = prevRange(r), btn = this;
    btn.disabled = true; btn.textContent = 'Generando…'; $('vtExpError').textContent = '';
    var q = function (x) { return api('/api/pos/ventas?desde=' + x.desde + '&hasta=' + x.hasta + '&q=&estado='); };
    Promise.all([q(r), q(pr).catch(function () { return null; })]).then(function (res) {
      var name = 'Ventas ' + (expTipo === 'mes' ? r.sub : r.desde === r.hasta ? r.desde : r.desde + ' a ' + r.hasta) + '.pdf';
      return makePdf(reportHTML(r, res[0], res[1]), name);
    }).then(function () { closeExp(); })
      .catch(function (err) { $('vtExpError').textContent = err.message || 'No se pudo generar el PDF.'; })
      .finally(function () { btn.disabled = false; btn.textContent = 'Descargar PDF'; });
  });
  // Para la vista previa en pruebas.
  window.__vtReport = { html: reportHTML, range: expRange, css: REPORT_CSS };

  syncFilters();
  load();
})();
/* ---------------------------------------------------------------- corte de caja */
/* =========================================================
   RECEPCIÓN → Corte de caja (como SICAR)
   Operaciones:
     Corte (F3)    contado / calculado / diferencia / retiro por corte
                   (+ contador de billetes y monedas, información adicional)
     Propina (F4)  corte de propinas
   Consultas:
     Buscar (F2) · Previa (Ctrl+R) · Excel (Alt+X) · PDF (Alt+P)
     Email (F11) · Imp (Ctrl+P) · Ticket (Alt+T)
     Corte de caja extendido + Detalle de movimientos (buscar y filtrar por
     forma de pago)
   Estado de caja (Recargar F5) y Entradas y salidas de caja.
   API: /api/caja/*
   ========================================================= */
(function () {
  'use strict';
  var page = document.getElementById('ccPage');
  if (!page) return;
  var T = window.PosTicket;
  var VE = page.getAttribute('data-ve') === '1';
  var ADMIN = page.getAttribute('data-admin') === '1';
  var CAJA = page.getAttribute('data-caja') || 'Caja 1';
  var MAIL_ON = page.getAttribute('data-mail') === '1';
  var MAIL_FROM = page.getAttribute('data-mail-from') || '';
  var API = '/api/caja';

  var FORMAS = ['efectivo', 'cheque', 'vales', 'tarjeta', 'transferencia'];
  var FORMA_TXT = { efectivo: 'Efectivo', cheque: 'Cheque', vales: 'Vales', tarjeta: 'Tarjeta', transferencia: 'Transferencia', credito: 'Crédito' };
  var MOV_TXT = {
    VEN: 'Venta', CAN: 'Venta cancelada', ABO: 'Abono', ABC: 'Abono cancelado', PRO: 'Propina', COR: 'Entrada por corte',
    GAS: 'Gasto', COM: 'Compra', PAC: 'Pago a crédito', NCR: 'Nota de crédito', DPR: 'Dev. de proveedor',
    RET: 'Retiro', DEP: 'Depósito', OEN: 'Otra entrada', OSA: 'Otra salida'
  };
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  var mxn = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2 });
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function money(v) { var n = Math.round((Number(v) || 0) * 100) / 100; return (n < 0 ? '-' : '') + mxn.format(Math.abs(n)); }
  function num(v) { return (Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function r2(v) { return Math.round((Number(v) || 0) * 100) / 100; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function parseTS(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) : null;
  }
  function fechaCorta(s) { var d = typeof s === 'string' ? parseTS(s) : s; return d ? pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() : '—'; }
  function hora12(s) {
    var d = typeof s === 'string' ? parseTS(s) : s;
    if (!d) return '—';
    var h = d.getHours(), ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return h + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + ' ' + ap;
  }
  function fechaLarga(s) { var d = typeof s === 'string' ? parseTS(s) : s; return d ? d.getDate() + ' de ' + MESES[d.getMonth()] + ' de ' + d.getFullYear() : '—'; }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function stamp(d) { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + pad(d.getMinutes()); }

  function api(url, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } };
    if (opts.body) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    return fetch(url, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) throw new Error(d.error || 'Algo salió mal. Intenta de nuevo.');
        return d;
      });
    });
  }

  /* ---------- aviso ---------- */
  var toastEl;
  function toast(msg, kind) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'cc-toast'; toastEl.setAttribute('role', 'status'); document.body.appendChild(toastEl); }
    toastEl.textContent = msg;
    toastEl.classList.toggle('is-error', kind === 'error');
    toastEl.classList.remove('is-on'); void toastEl.offsetWidth; toastEl.classList.add('is-on');
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(function () { toastEl.classList.remove('is-on'); }, kind === 'error' ? 4500 : 2800);
  }

  /* ---------- modales ---------- */
  var openStack = [];
  function openModal(m) {
    m.classList.add('open');
    document.body.style.overflow = 'hidden';
    openStack = openStack.filter(function (x) { return x !== m; });
    openStack.push(m);
  }
  function closeModal(m) {
    m.classList.remove('open');
    openStack = openStack.filter(function (x) { return x !== m; });
    if (!openStack.length) document.body.style.overflow = '';
    if (m._onClose) { var f = m._onClose; m._onClose = null; f(); }
  }
  function topModal() { return openStack[openStack.length - 1] || null; }
  document.querySelectorAll('.admin-modal-overlay').forEach(function (m) {
    m.addEventListener('click', function (e) {
      if (e.target === m || e.target.closest('[data-close]')) closeModal(m);
    });
  });

  function confirmBox(text, yes) {
    return new Promise(function (resolve) {
      var m = $('ccConfirmModal');
      $('ccConfirmText').textContent = text;
      $('ccConfirmYes').textContent = yes || 'Sí';
      var done = function (v) { $('ccConfirmYes').onclick = $('ccConfirmNo').onclick = null; m._onClose = null; closeModal(m); resolve(v); };
      $('ccConfirmYes').onclick = function () { done(true); };
      $('ccConfirmNo').onclick = function () { done(false); };
      m._onClose = function () { resolve(false); };
      openModal(m);
      setTimeout(function () { $('ccConfirmYes').focus(); }, 60);
    });
  }

  /* ---------- pestañas ---------- */
  var tab = 'corte';
  function setTab(name) {
    tab = name;
    $('ccTabs').querySelectorAll('button').forEach(function (b) { b.classList.toggle('is-on', b.getAttribute('data-tab') === name); });
    document.querySelectorAll('.cc-pane').forEach(function (p) { p.hidden = p.getAttribute('data-pane') !== name; });
    try { localStorage.setItem('attomosCorteTab', name); } catch (e) {}
    if (name === 'estado') loadEstadoTab();
    if (name === 'movs') loadMovs();
  }
  $('ccTabs').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-tab]');
    if (b) setTab(b.getAttribute('data-tab'));
  });

  // Sin permiso de "calculado": se esconden esas columnas.
  if (!VE) document.body.classList.add('cc-ciego');

  /* =======================================================
     OPERACIONES: estado + último corte
     ======================================================= */
  var estado = null;
  function loadEstado() {
    return api(API + '/estado').then(function (d) {
      estado = d;
      renderUltimo(d.ultimo);
      $('ccDesdeHint').innerHTML = d.ultimo
        ? 'El siguiente corte abarca desde el <b>' + fechaLarga(d.desde) + ' a las ' + hora12(d.desde) + '</b> hasta el momento de guardarlo.'
        : 'Todavía no hay cortes de esta caja: el primero abarca desde <b>hoy a las 00:00</b> hasta el momento de guardarlo.';
      if (VE && d.calculado) {
        $('ccNow').hidden = false;
        var c = d.calculado;
        $('ccNowStats').innerHTML = FORMAS.map(function (f) {
          return '<div class="vt-stat' + (f === 'efectivo' ? ' is-cash' : '') + '"><small>' + FORMA_TXT[f] + '</small><strong>' + money(c[f]) + '</strong></div>';
        }).join('') + '<div class="vt-stat is-total"><small>Total</small><strong>' + money(d.total) + '</strong></div>';
      }
      return d;
    }).catch(function (err) { toast(err.message, 'error'); });
  }
  function renderUltimo(u) {
    $('ccLastCaja').textContent = u ? u.caja : '—';
    $('ccLastUser').textContent = u ? u.usuario : '—';
    $('ccLastFecha').textContent = u ? fechaCorta(u.fecha) : '—';
    $('ccLastHora').textContent = u ? hora12(u.fecha) : '—';
    $('ccLast').classList.toggle('is-set', !!u);
  }

  /* =======================================================
     CORTE (F3)
     ======================================================= */
  var corteModal = $('ccCorteModal');
  var COUNT = ['efectivo', 'cheque', 'vales', 'tarjeta'];
  var CALC_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M8 6h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h8"/></svg>';
  var retiroTouched = {};
  function buildCorteForm() {
    var tb = $('ccCorteTable').querySelector('tbody');
    tb.innerHTML = COUNT.map(function (f) {
      return '<tr data-f="' + f + '"><th>' + FORMA_TXT[f] +
        (f === 'efectivo' ? ' <button type="button" class="cc-calc-btn" data-denom="contado" title="Contar billetes y monedas" aria-label="Contar billetes y monedas">' + CALC_ICON + '</button>' : '') + '</th>' +
        '<td><span class="cc-money"><span>$</span><input type="number" min="0" step="0.01" inputmode="decimal" data-contado="' + f + '" placeholder="0.00"></span></td>' +
        '<td class="cc-ve cc-calc" data-calc="' + f + '">—</td><td class="cc-ve cc-dif" data-dif="' + f + '">—</td></tr>';
    }).join('') +
      '<tr data-f="transferencia" class="is-auto"><th>Transferencia <small>se toma lo registrado</small></th>' +
      '<td class="cc-auto" data-contado-auto="transferencia">$0.00</td><td class="cc-ve cc-calc" data-calc="transferencia">—</td><td class="cc-ve cc-dif" data-dif="transferencia">$0.00</td></tr>';
    $('ccRetiros').innerHTML = COUNT.map(function (f) {
      return '<label class="cc-ret-row"><span>' + FORMA_TXT[f] + ':' +
        (f === 'efectivo' ? ' <button type="button" class="cc-calc-btn" data-denom="retiro" title="Contar billetes y monedas" aria-label="Contar billetes y monedas">' + CALC_ICON + '</button>' : '') + '</span>' +
        '<span class="cc-money"><span>$</span><input type="number" min="0" step="0.01" inputmode="decimal" data-retiro="' + f + '" placeholder="0.00"></span></label>';
    }).join('') +
      '<div class="cc-ret-row is-auto"><span>Transferencia:</span><b data-retiro-auto="transferencia">$0.00</b></div>';
  }
  buildCorteForm();
  function val(sel) { var el = corteModal.querySelector(sel); return el ? r2(parseFloat(el.value) || 0) : 0; }
  function recalcCorte() {
    var calc = (estado && estado.calculado) || null;
    var info = (estado && estado.info) || {};
    var tr = r2(info.transferencias);
    var tc = 0, tcalc = 0, tret = 0, bad = false;
    COUNT.forEach(function (f) {
      var c = val('[data-contado="' + f + '"]');
      var rIn = corteModal.querySelector('[data-retiro="' + f + '"]');
      // Vales, cheque y tarjeta: el retiro sigue a lo contado hasta que lo cambien.
      if (f !== 'efectivo' && !retiroTouched[f]) rIn.value = c ? c.toFixed(2) : '';
      var r = r2(parseFloat(rIn.value) || 0);
      rIn.classList.toggle('is-bad', r > c + 0.001);
      if (r > c + 0.001) bad = true;
      tc += c; tret += r;
      if (calc) {
        var k = r2(calc[f]); tcalc += k;
        corteModal.querySelector('[data-calc="' + f + '"]').textContent = money(k);
        var dif = r2(c - k), el = corteModal.querySelector('[data-dif="' + f + '"]');
        el.textContent = money(dif);
        el.className = 'cc-ve cc-dif' + (dif < 0 ? ' is-neg' : dif > 0 ? ' is-pos' : '');
      }
    });
    corteModal.querySelector('[data-contado-auto="transferencia"]').textContent = money(tr);
    corteModal.querySelector('[data-retiro-auto="transferencia"]').textContent = money(tr);
    if (calc) corteModal.querySelector('[data-calc="transferencia"]').textContent = money(tr);
    tc += tr; tret += tr; tcalc += calc ? tr : 0;
    $('ccTotContado').textContent = money(tc);
    $('ccTotRetiro').textContent = money(tret);
    if (calc) {
      $('ccTotCalc').textContent = money(tcalc);
      var d = r2(tc - tcalc);
      $('ccTotDif').textContent = money(d);
      $('ccTotDif').className = 'cc-ve' + (d < 0 ? ' is-neg' : d > 0 ? ' is-pos' : '');
    }
    $('ccCorteError').textContent = bad ? 'El retiro no puede ser mayor a lo contado.' : '';
    return !bad;
  }
  corteModal.addEventListener('input', function (e) {
    var t = e.target;
    if (t.hasAttribute('data-retiro')) retiroTouched[t.getAttribute('data-retiro')] = true;
    recalcCorte();
  });
  try { $('ccAutoTicket').checked = localStorage.getItem('attomosCorteTicket') === '1'; } catch (e) {}
  $('ccAutoTicket').addEventListener('change', function () { try { localStorage.setItem('attomosCorteTicket', this.checked ? '1' : '0'); } catch (e) {} });

  function openCorte() {
    if (tab !== 'corte') setTab('corte');
    retiroTouched = {};
    corteModal.querySelectorAll('input[type=number]').forEach(function (i) { i.value = ''; i.classList.remove('is-bad'); });
    $('ccCorteError').textContent = '';
    openModal(corteModal);
    loadEstado().then(function () {
      var d = estado || {};
      $('ccCorteDesde').innerHTML = 'Desde <b>' + fechaLarga(d.desde) + ' · ' + hora12(d.desde) + '</b> hasta ahora. Escribe en <b>Contado</b> lo que tienes físicamente.';
      $('ccInfoTr').textContent = money(d.info && d.info.transferencias);
      $('ccInfoAn').textContent = money(d.info && d.info.anticipos);
      $('ccInfoPl').textContent = money(d.info && d.info.pagos_linea);
      recalcCorte();
      setTimeout(function () { corteModal.querySelector('[data-contado="efectivo"]').focus(); }, 60);
    });
  }
  $('ccBtnCorte').addEventListener('click', openCorte);

  $('ccCorteSave').addEventListener('click', function () {
    if (!recalcCorte()) return;
    var body = { contado: {}, retiro: {} };
    COUNT.forEach(function (f) {
      body.contado[f] = val('[data-contado="' + f + '"]');
      body.retiro[f] = val('[data-retiro="' + f + '"]');
    });
    confirmBox('¿Deseas realizar el corte de caja? Ya no se puede deshacer.', 'Sí, hacer el corte').then(function (ok) {
      if (!ok) return;
      var btn = $('ccCorteSave');
      btn.disabled = true; btn.textContent = 'Guardando…';
      api(API + '/cortes', { method: 'POST', body: body }).then(function (d) {
        closeModal(corteModal);
        renderUltimo(d.corte);
        toast('Corte de caja guardado.');
        loadEstado();
        if ($('ccAutoTicket').checked) printTicket(d.corte);
        // Queda seleccionado en Consultas.
        selectCorte(d.corte.id, true);
      }).catch(function (err) {
        $('ccCorteError').textContent = err.message;
      }).finally(function () { btn.disabled = false; btn.textContent = 'Guardar'; });
    });
  });

  /* ---------- contar billetes y monedas ---------- */
  var DENOMS = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5];
  var denomModal = $('ccDenomModal'), denomTarget = null;
  $('ccDenom').innerHTML = DENOMS.map(function (d) {
    return '<label class="cc-denom-row"><span class="cc-denom-face' + (d >= 20 ? ' is-bill' : ' is-coin') + '">$' + (d < 1 ? '0.50' : d) + '</span>' +
      '<span class="cc-denom-x">×</span><input type="number" min="0" step="1" inputmode="numeric" data-denom-v="' + d + '" placeholder="0">' +
      '<b data-denom-sub="' + d + '">$0.00</b></label>';
  }).join('');
  function denomTotal() {
    var t = 0;
    denomModal.querySelectorAll('[data-denom-v]').forEach(function (i) {
      var d = parseFloat(i.getAttribute('data-denom-v')), q = Math.max(0, parseInt(i.value, 10) || 0);
      var sub = r2(d * q); t += sub;
      denomModal.querySelector('[data-denom-sub="' + i.getAttribute('data-denom-v') + '"]').textContent = money(sub);
    });
    $('ccDenomTotal').textContent = money(t);
    return r2(t);
  }
  denomModal.addEventListener('input', denomTotal);
  $('ccDenomClear').addEventListener('click', function () { denomModal.querySelectorAll('[data-denom-v]').forEach(function (i) { i.value = ''; }); denomTotal(); });
  $('ccDenomUse').addEventListener('click', function () {
    var t = denomTotal();
    if (denomTarget) { denomTarget.value = t ? t.toFixed(2) : ''; denomTarget.dispatchEvent(new Event('input', { bubbles: true })); }
    closeModal(denomModal);
  });
  corteModal.addEventListener('click', function (e) {
    var b = e.target.closest('[data-denom]');
    if (!b) return;
    denomTarget = corteModal.querySelector(b.getAttribute('data-denom') === 'retiro' ? '[data-retiro="efectivo"]' : '[data-contado="efectivo"]');
    denomModal.querySelectorAll('[data-denom-v]').forEach(function (i) { i.value = ''; });
    denomTotal();
    openModal(denomModal);
    setTimeout(function () { denomModal.querySelector('[data-denom-v]').focus(); }, 60);
  });

  /* =======================================================
     PROPINA (F4)
     ======================================================= */
  var propModal = $('ccPropModal');
  function openPropina() {
    if (tab !== 'corte') setTab('corte');
    $('ccPropError').textContent = '';
    $('ccPropGrid').innerHTML = '<p class="cc-hint">Cargando…</p>';
    openModal(propModal);
    api(API + '/propinas').then(function (d) {
      var p = d.pendientes || {}, m = p.montos || {};
      $('ccPropDesde').innerHTML = d.ultimo ? 'Propinas desde el último corte de propinas (' + fechaCorta(d.ultimo.hasta) + ' · ' + hora12(d.ultimo.hasta) + ').' : 'Propinas registradas en el Punto de venta que todavía no se reparten.';
      $('ccPropGrid').innerHTML = ['vales', 'tarjeta', 'cheque', 'transferencia'].map(function (f) {
        return '<div class="cc-prop-box"><small>' + FORMA_TXT[f] + '</small><strong>' + num(m[f]) + '</strong></div>';
      }).join('');
      $('ccPropTotal').textContent = num(p.total);
      $('ccPropEf').innerHTML = 'Las propinas en efectivo no se toman en cuenta en el corte' + (p.efectivo > 0 ? ' (en efectivo: <b>' + money(p.efectivo) + '</b>).' : '.');
      $('ccPropLast').textContent = d.ultimo ? 'Último corte de propinas: ' + fechaCorta(d.ultimo.hasta) + ' · ' + hora12(d.ultimo.hasta) + ' · ' + (d.ultimo.usuario || '') + ' · ' + money(d.ultimo.total) : '';
      $('ccPropSave').disabled = !p.ventas;
      if (!p.ventas) $('ccPropError').textContent = 'No hay propinas pendientes de corte. Se registran al cobrar en el Punto de venta (Propina).';
    }).catch(function (err) { $('ccPropGrid').innerHTML = ''; $('ccPropError').textContent = err.message; });
  }
  $('ccBtnPropina').addEventListener('click', openPropina);
  $('ccPropSave').addEventListener('click', function () {
    confirmBox('¿Guardar el corte de propinas?').then(function (ok) {
      if (!ok) return;
      api(API + '/propinas', { method: 'POST', body: {} }).then(function (d) {
        closeModal(propModal);
        toast('Corte de propinas guardado: ' + money(d.corte.total) + ' a repartir.');
      }).catch(function (err) { $('ccPropError').textContent = err.message; });
    });
  });

  /* =======================================================
     CONSULTAR: buscar
     ======================================================= */
  var searchModal = $('ccSearchModal');
  var sState = { page: 1, pages: 1, list: [], sel: null };
  (function () { var t = new Date(), a = new Date(t); a.setDate(a.getDate() - 7); $('ccSDesde').value = iso(a); $('ccSHasta').value = iso(t); })();
  function loadSearch() {
    var url = API + '/cortes?desde=' + $('ccSDesde').value + '&hasta=' + $('ccSHasta').value + '&pagina=' + sState.page;
    $('ccSBody').classList.add('is-loading');
    return api(url).then(function (d) {
      sState.list = d.cortes || []; sState.pages = d.paginas || 1; sState.sel = null;
      $('ccSSelect').disabled = true;
      $('ccSPage').textContent = sState.page; $('ccSPages').textContent = sState.pages;
      $('ccSPrev').disabled = sState.page <= 1; $('ccSNext').disabled = sState.page >= sState.pages;
      $('ccSEmpty').hidden = sState.list.length > 0;
      $('ccSBody').innerHTML = sState.list.map(function (c) {
        return '<tr data-id="' + c.id + '" tabindex="0"><td>' + fechaCorta(c.fecha) + ' ' + hora12(c.fecha) + '</td><td>' + esc(c.caja) + '</td>' +
          '<td class="num">' + num(c.contado) + '</td><td class="num cc-ve">' + num(c.calculado) + '</td>' +
          '<td class="num cc-ve' + (c.diferencia < 0 ? ' is-neg' : '') + '">' + num(c.diferencia) + '</td><td class="num">' + num(c.retirado) + '</td><td>' + esc(c.usuario) + '</td></tr>';
      }).join('');
    }).catch(function (err) { toast(err.message, 'error'); })
      .finally(function () { $('ccSBody').classList.remove('is-loading'); });
  }
  function openSearch() {
    if (tab !== 'consultar') setTab('consultar');
    sState.page = 1;
    openModal(searchModal);
    loadSearch();
  }
  ['ccSDesde', 'ccSHasta'].forEach(function (id) { $(id).addEventListener('change', function () { sState.page = 1; loadSearch(); }); });
  $('ccSReload').addEventListener('click', loadSearch);
  $('ccSPrev').addEventListener('click', function () { if (sState.page > 1) { sState.page--; loadSearch(); } });
  $('ccSNext').addEventListener('click', function () { if (sState.page < sState.pages) { sState.page++; loadSearch(); } });
  function markSel(tr) {
    $('ccSBody').querySelectorAll('tr').forEach(function (x) { x.classList.toggle('is-selected', x === tr); });
    sState.sel = tr ? Number(tr.getAttribute('data-id')) : null;
    $('ccSSelect').disabled = !sState.sel;
  }
  $('ccSBody').addEventListener('click', function (e) { var tr = e.target.closest('tr[data-id]'); if (tr) markSel(tr); });
  $('ccSBody').addEventListener('dblclick', function (e) { var tr = e.target.closest('tr[data-id]'); if (tr) { markSel(tr); pickSearch(); } });
  $('ccSBody').addEventListener('keydown', function (e) {
    var tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    if (e.key === 'Enter') { markSel(tr); pickSearch(); }
    if (e.key === 'ArrowDown' && tr.nextElementSibling) { tr.nextElementSibling.focus(); markSel(tr.nextElementSibling); e.preventDefault(); }
    if (e.key === 'ArrowUp' && tr.previousElementSibling) { tr.previousElementSibling.focus(); markSel(tr.previousElementSibling); e.preventDefault(); }
  });
  $('ccSSelect').addEventListener('click', pickSearch);
  function pickSearch() {
    if (!sState.sel) return;
    closeModal(searchModal);
    selectCorte(sState.sel);
  }

  /* =======================================================
     CONSULTAR: corte seleccionado
     ======================================================= */
  var current = null;
  function selectCorte(id, quiet) {
    return api(API + '/cortes/' + id).then(function (d) {
      current = d.corte;
      renderExt();
      renderDetalle();
      syncTools();
      if (!quiet) toast('Corte del ' + fechaCorta(current.fecha) + ' · ' + hora12(current.fecha) + ' seleccionado.');
    }).catch(function (err) { toast(err.message, 'error'); });
  }
  function syncTools() {
    document.querySelectorAll('.cc-toolbar [data-need]').forEach(function (b) {
      var need = b.getAttribute('data-need');
      b.disabled = !current || (need === 'reporte' && !current.reporte);
    });
  }
  syncTools();

  function field(label, value, cls) { return '<div class="cc-f' + (cls ? ' ' + cls : '') + '"><span>' + label + '</span><b>' + value + '</b></div>'; }
  function seccion(titulo, s, l) {
    // l: etiquetas {a, b, ca, cb}
    return '<div class="cc-sec"><h4>' + titulo + '</h4><div class="cc-sec-grid">' +
      '<div class="cc-col">' + field(l.a, money(s.contado)) + (l.b ? field(l.b, money(s.credito)) : '') + field('Total', money(s.total), 'is-total') + '</div>' +
      '<div class="cc-col">' + field(l.ca, money(s.canceladas)) + (l.cb ? field(l.cb, money(s.credito_canc)) : '') + field('Total', money(s.total_canc), 'is-total') + '</div>' +
      '<div class="cc-col is-dif">' + field('Diferencia', money(s.diferencia), 'is-total') + '</div></div></div>';
  }
  function renderExt() {
    var c = current, box = $('ccExt');
    $('ccExtHint').hidden = !!c;
    if (!c) { box.innerHTML = ''; return; }
    var head = '<div class="cc-sec"><h4>Datos generales</h4><div class="cc-sec-grid">' +
      '<div class="cc-col">' + field('Fecha', fechaCorta(c.fecha)) + field('Hora', hora12(c.fecha)) + field('Usuario', esc(c.usuario)) + field('Caja', esc(c.caja)) + '</div>' +
      '<div class="cc-col">' + field('Contado', money(c.contado)) + (VE ? field('Calculado', money(c.calculado)) + field('Diferencia', money(c.diferencia), c.diferencia < 0 ? 'is-neg' : '') : '') + field('Retirado', money(c.retirado)) + '</div>' +
      '<div class="cc-col">' + field('Periodo', fechaCorta(c.desde) + ' ' + hora12(c.desde) + '<br>a ' + fechaCorta(c.hasta) + ' ' + hora12(c.hasta)) + '</div></div></div>';
    if (!c.reporte) {
      box.innerHTML = head + '<p class="cc-locked">Tu usuario no tiene permiso para ver lo calculado ni el detalle del corte. Pídele al administrador que active «Recepción ve Calculado y Diferencia».</p>';
      return;
    }
    var r = c.reporte, e = r.mov_entradas, s = r.mov_salidas;
    box.innerHTML = head +
      seccion('Datos de las ventas', r.ventas, { a: 'Ventas a contado', b: 'Ventas a crédito', ca: 'Ventas canceladas', cb: 'Ventas a crédito canc.' }) +
      seccion('Datos de las compras', r.compras, { a: 'Compras a contado', b: 'Compras a crédito', ca: 'Compras canceladas', cb: 'Compras a crédito canc.' }) +
      seccion('Datos de los gastos', r.gastos, { a: 'Gastos a contado', b: 'Gastos a crédito', ca: 'Gastos cancelados', cb: 'Gastos a crédito canc.' }) +
      seccion('Datos de las notas de crédito', r.notas_credito, { a: 'Notas de crédito', ca: 'Notas de crédito canc.' }) +
      seccion('Datos de las devoluciones a proveedor', r.dev_proveedor, { a: 'Devoluciones proveedor', ca: 'Devoluciones proveedor canc.' }) +
      '<div class="cc-sec"><h4>Datos de los movimientos (entradas / salidas)</h4><div class="cc-sec-grid">' +
        '<div class="cc-col">' + field('Entradas / ventas', money(e.ventas)) + field('Entradas / créd. recup.', money(e.cred_recup)) + field('Entradas / compras canc.', money(e.compras_canc)) +
          field('Entradas / notas cré. canc.', money(e.notas_cre_canc)) + field('Entradas / movimientos', money(e.movimientos)) + field('Entradas / dev. pro.', money(e.dev_pro)) +
          field('Entradas / gastos canc.', money(e.gastos_canc)) + field('Entradas / propinas', money(e.propinas)) + field('Entradas / por corte', money(e.corte)) + field('Total', money(e.total), 'is-total') + '</div>' +
        '<div class="cc-col">' + field('Salidas / compras', money(s.compras)) + field('Salidas / pago de créd.', money(s.pago_cred)) + field('Salidas / ventas canc.', money(s.ventas_canc)) +
          field('Salidas / notas crédito', money(s.notas_credito)) + field('Salidas / movimientos', money(s.movimientos)) + field('Salidas / dev. pro. canc.', money(s.dev_pro_canc)) +
          field('Salidas / gastos', money(s.gastos)) + field('Salidas / abonos canc.', money(s.abonos_canc)) + field('Total', money(s.total), 'is-total') + '</div>' +
        '<div class="cc-col is-dif">' + field('Diferencia', money(r.mov_diferencia), 'is-total') + '</div></div></div>' +
      '<div class="cc-sec"><h4>Datos generales por tipo de pago</h4>' + tipoPagoTable(c, 'cc-tp') + '</div>';
  }
  function tipoPagoRows(c) {
    var r = c.reporte || {};
    var rows = [['Efectivo', 'efectivo'], ['Cheque', 'cheque'], ['Transferencia', 'transferencia'], ['Vales', 'vales'], ['Tarjeta', 'tarjeta']].map(function (x) {
      var k = c.calculado_fp[x[1]], o = c.contado_fp[x[1]];
      return { label: x[0], calc: k, cont: o, dif: r2(o - k), ret: c.retiro_fp[x[1]] };
    });
    rows.push({ label: 'Anticipo (informativo)', calc: r.anticipos || 0, cont: r.anticipos || 0, dif: 0, ret: 0, info: true });
    rows.push({ label: 'Pagos en línea', calc: r.pagos_linea || 0, cont: r.pagos_linea || 0, dif: 0, ret: 0, info: true });
    return rows;
  }
  function tipoPagoTable(c, cls) {
    var rows = tipoPagoRows(c);
    return '<table class="' + cls + '"><thead><tr><th></th><th>Calculado</th><th>Contado</th><th>Diferencia</th><th>Retirado</th></tr></thead><tbody>' +
      rows.map(function (x) {
        return '<tr' + (x.info ? ' class="is-info"' : '') + '><th>' + x.label + '</th><td>' + money(x.calc) + '</td><td>' + money(x.cont) + '</td><td' + (x.dif < 0 ? ' class="is-neg"' : '') + '>' + money(x.dif) + '</td><td>' + money(x.ret) + '</td></tr>';
      }).join('') +
      '</tbody><tfoot><tr><th>Totales</th><td>' + money(c.calculado) + '</td><td>' + money(c.contado) + '</td><td' + (c.diferencia < 0 ? ' class="is-neg"' : '') + '>' + money(c.diferencia) + '</td><td>' + money(c.retirado) + '</td></tr></tfoot></table>';
  }

  /* ---------- detalle de movimientos ---------- */
  $('ccSubtabs').addEventListener('click', function (e) {
    var b = e.target.closest('[data-sub]');
    if (!b) return;
    var sub = b.getAttribute('data-sub');
    $('ccSubtabs').querySelectorAll('button').forEach(function (x) { x.classList.toggle('is-on', x === b); });
    document.querySelectorAll('[data-subpane]').forEach(function (p) { p.hidden = p.getAttribute('data-subpane') !== sub; });
  });
  function filteredMovs() {
    if (!current || !current.reporte) return [];
    var q = $('ccDetSearch').value.trim().toLowerCase(), fp = $('ccDetFP').value;
    var saldo = 0;
    return (current.reporte.movimientos || []).filter(function (m) {
      if (fp && m.forma !== fp) return false;
      if (q) {
        var hay = [m.comentario, m.folio, m.usuario, m.mov, MOV_TXT[m.mov.replace('-C', '')] || '', m.doc, m.fp].join(' ').toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    }).map(function (m) { saldo = r2(saldo + m.entrada - m.salida); return Object.assign({}, m, { saldo: saldo }); });
  }
  function renderDetalle() {
    var list = filteredMovs();
    var ok = current && current.reporte;
    $('ccDetEmpty').hidden = list.length > 0;
    $('ccDetEmpty').textContent = !current ? 'Selecciona un corte de caja desde Buscar.' : !ok ? 'Tu usuario no tiene permiso para ver el detalle de movimientos.' : 'No hay movimientos con ese filtro.';
    var te = 0, ts = 0;
    $('ccDetBody').innerHTML = list.map(function (m) {
      te += m.entrada; ts += m.salida;
      return '<tr><td><span class="vt-date">' + fechaCorta(m.fecha) + '</span><small>' + hora12(m.fecha) + '</small></td><td class="cc-det-com">' + esc(m.comentario) + '</td>' +
        '<td title="' + esc(MOV_TXT[m.mov.replace('-C', '')] || m.mov) + (m.mov.indexOf('-C') > 0 ? ' (cancelación)' : '') + '"><span class="cc-mov-code">' + esc(m.mov) + '</span></td><td>' + esc(m.doc) + '</td>' +
        '<td class="num">' + esc(m.folio) + '</td><td><span class="cc-fp is-' + esc(m.forma) + '">' + esc(m.fp) + '</span></td><td>' + esc(m.usuario) + '</td>' +
        '<td class="num">' + (m.entrada ? num(m.entrada) : '') + '</td><td class="num">' + (m.salida ? num(m.salida) : '') + '</td><td class="num"><b>' + num(m.saldo) + '</b></td></tr>';
    }).join('');
    $('ccDetTotals').innerHTML = ok
      ? '<span>Total de entradas: <b>' + money(te) + '</b></span><span>Total de salidas: <b>' + money(ts) + '</b></span><span>Diferencia: <b' + (te - ts < 0 ? ' class="is-neg"' : '') + '>' + money(te - ts) + '</b></span>'
      : '';
  }
  $('ccDetSearch').addEventListener('input', renderDetalle);
  $('ccDetFP').addEventListener('change', renderDetalle);

  /* =======================================================
     REPORTE (Previa / Imp / PDF / Excel / Email / Ticket)
     ======================================================= */
  var REPORT_CSS = [
    '.ccr{box-sizing:border-box;width:816px;padding:38px 46px 30px;background:#fff;color:#1d2a44;font-family:"Public Sans",Arial,Helvetica,sans-serif;font-size:11px;}',
    '.ccr *{box-sizing:border-box;}',
    '.ccr h1{margin:0 0 4px;text-align:center;color:#0b3b8c;font-size:17px;font-weight:800;}',
    '.ccr .ccr-sub{text-align:center;color:#5b6475;font-size:10.5px;margin-bottom:10px;}',
    '.ccr table{width:100%;border-collapse:collapse;margin:0 0 6px;}',
    '.ccr .ccr-h th{background:#0b4fa8;color:#fff;font-size:11px;font-weight:700;text-align:center;padding:3px 6px;}',
    '.ccr td{padding:2px 6px;border-bottom:1px dotted #c9d3e6;color:#1f5fbf;font-size:10.5px;}',
    '.ccr td.v{color:#1d2a44;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;}',
    '.ccr tr.t td{color:#0b3b8c;font-weight:800;border-bottom:none;border-top:1px solid #9fb2d6;}',
    '.ccr td.d{background:#eef2f9;color:#0b3b8c;font-weight:800;text-align:right;}',
    '.ccr .ccr-tp th{background:#0b4fa8;color:#fff;font-size:10.5px;padding:3px 6px;text-align:right;}',
    '.ccr .ccr-tp th:first-child{text-align:left;}',
    '.ccr .ccr-tp td{text-align:right;color:#1d2a44;}',
    '.ccr .ccr-tp td:first-child{text-align:left;color:#3b4a66;}',
    '.ccr .ccr-tp tr.i td{color:#8a93a6;font-style:italic;}',
    '.ccr .ccr-tp tr.t td{color:#0b3b8c;font-weight:800;}',
    '.ccr .neg{color:#b42318 !important;}',
    '.ccr .ccr-foot{display:flex;justify-content:space-between;margin-top:14px;padding-top:6px;border-top:1px solid #d5dced;color:#5b6475;font-size:10px;}',
    '.ccr .ccr-movs th{background:#0b4fa8;color:#fff;font-size:9.5px;padding:3px 4px;text-align:left;}',
    '.ccr .ccr-movs td{font-size:9.5px;color:#1d2a44;padding:2px 4px;}',
    '.ccr .ccr-movs td.v{text-align:right;}'
  ].join('');
  function v(n) { var x = r2(n); return '<td class="v' + (x < 0 ? ' neg' : '') + '">' + money(x) + '</td>'; }
  function h(title, cols) { return '<tr class="ccr-h"><th colspan="' + (cols || 5) + '">' + title + '</th></tr>'; }
  function reportHTML(c, withMovs) {
    var r = c.reporte;
    function sec(title, s, la, lb, lca, lcb) {
      var rows = '<tr><td>' + la + '</td>' + v(s.contado) + '<td>' + lca + '</td>' + v(s.canceladas) + '<td></td></tr>';
      if (lb) rows += '<tr><td>' + lb + '</td>' + v(s.credito) + '<td>' + lcb + '</td>' + v(s.credito_canc) + '<td class="d">DIFERENCIA</td></tr>';
      else rows = rows.replace('<td></td></tr>', '<td class="d">DIFERENCIA</td></tr>');
      return h(title) + rows + '<tr class="t"><td>TOTAL:</td>' + v(s.total) + '<td>TOTAL:</td>' + v(s.total_canc) + '<td class="d">' + money(s.diferencia) + '</td></tr>';
    }
    var e = r.mov_entradas, s = r.mov_salidas;
    var pairs = [
      ['ENTRADAS/VENTAS:', e.ventas, 'SALIDAS/COMPRAS:', s.compras],
      ['ENTRADAS/CRÉD. RECUP.:', e.cred_recup, 'SALIDAS/PAGO DE CRÉD.:', s.pago_cred],
      ['ENTRADAS/COMPRAS CANC.:', e.compras_canc, 'SALIDAS/VENTAS CANC.:', s.ventas_canc],
      ['ENTRADAS/NOTAS CRE. CAN.:', e.notas_cre_canc, 'SALIDAS/NOTAS CRÉDITO:', s.notas_credito],
      ['ENTRADAS/MOVIMIENTOS:', e.movimientos, 'SALIDAS/MOVIMIENTOS:', s.movimientos],
      ['ENTRADAS / DEV. PRO.:', e.dev_pro, 'SALIDAS / DEV. PRO. CANC.:', s.dev_pro_canc],
      ['ENTRADAS / GASTOS CANC.:', e.gastos_canc, 'SALIDAS / GASTOS:', s.gastos],
      ['ENTRADAS / PROPINAS:', e.propinas, 'SALIDAS / ABONOS CANC.:', s.abonos_canc],
      ['ENTRADAS / POR CORTE:', e.corte, '', null]
    ];
    var movRows = pairs.map(function (p, i) {
      return '<tr><td>' + p[0] + '</td>' + v(p[1]) + '<td>' + p[2] + '</td>' + (p[3] == null ? '<td></td>' : v(p[3])) + (i === pairs.length - 1 ? '<td class="d">DIFERENCIA</td>' : '<td></td>') + '</tr>';
    }).join('');
    var tp = tipoPagoRows(c).map(function (x) {
      return '<tr' + (x.info ? ' class="i"' : '') + '><td>' + x.label + '</td><td>' + money(x.calc) + '</td><td>' + money(x.cont) + '</td><td' + (x.dif < 0 ? ' class="neg"' : '') + '>' + money(x.dif) + '</td><td>' + money(x.ret) + '</td></tr>';
    }).join('');
    var out = '<div class="ccr"><h1>Reporte de Corte de Caja Extendido</h1>' +
      '<div class="ccr-sub">' + esc(((window.POS_BIZ && window.POS_BIZ.nombre) || 'Attomos')) + ' · ' + esc(c.caja) + ' · del ' + fechaCorta(c.desde) + ' ' + hora12(c.desde) + ' al ' + fechaCorta(c.hasta) + ' ' + hora12(c.hasta) + '</div>' +
      '<table>' + h('Datos Generales') +
        '<tr><td>FECHA:</td><td class="v">' + fechaCorta(c.fecha) + '</td><td>CONTADO:</td>' + v(c.contado) + '<td></td></tr>' +
        '<tr><td>HORA:</td><td class="v">' + hora12(c.fecha) + '</td><td>CALCULADO:</td>' + v(c.calculado) + '<td></td></tr>' +
        '<tr><td>USUARIO:</td><td class="v">' + esc(c.usuario) + '</td><td>DIFERENCIA:</td>' + v(c.diferencia) + '<td></td></tr>' +
        '<tr><td>CAJA:</td><td class="v">' + esc(c.caja) + '</td><td>RETIRADO:</td>' + v(c.retirado) + '<td></td></tr>' +
        sec('Datos de las Ventas', r.ventas, 'VENTAS A CONTADO:', 'VENTAS A CRÉDITO:', 'VENTAS CANCELADAS:', 'VENTAS A CRÉDITO CANC.:') +
        sec('Datos de las Compras', r.compras, 'COMPRAS A CONTADO:', 'COMPRAS A CRÉDITO:', 'COMPRAS CANCELADAS:', 'COMPRAS A CRÉDITO CANC.:') +
        sec('Datos de los Gastos', r.gastos, 'GASTOS A CONTADO:', 'GASTOS A CRÉDITO:', 'GASTOS CANCELADOS:', 'GASTOS A CRÉDITO CANC.:') +
        sec('Datos de las Notas de Crédito', r.notas_credito, 'NOTAS DE CRÉDITO:', '', 'NOTAS DE CRÉDITO CANC.:', '') +
        sec('Datos de las Devoluciones Proveedor', r.dev_proveedor, 'DEVOLUCIONES PRO:', '', 'DEVOLUCIONES PRO CANC.:', '') +
        h('Datos de los Movimientos (Entradas/Salidas)') + movRows +
        '<tr class="t"><td>TOTAL:</td>' + v(e.total) + '<td>TOTAL:</td>' + v(s.total) + '<td class="d">' + money(r.mov_diferencia) + '</td></tr>' +
      '</table>' +
      '<table class="ccr-tp"><thead><tr><th colspan="5" style="text-align:center">Datos Generales por Tipo de Pago</th></tr>' +
        '<tr><th></th><th>CALCULADO</th><th>CONTADO</th><th>DIFERENCIA</th><th>RETIRADO</th></tr></thead><tbody>' + tp +
        '<tr class="t"><td>TOTALES</td><td>' + money(c.calculado) + '</td><td>' + money(c.contado) + '</td><td' + (c.diferencia < 0 ? ' class="neg"' : '') + '>' + money(c.diferencia) + '</td><td>' + money(c.retirado) + '</td></tr></tbody></table>';
    if (withMovs) {
      out += '<table class="ccr-movs"><thead><tr><th colspan="9" style="text-align:center">Detalle de Movimientos</th></tr>' +
        '<tr><th>Fecha</th><th>Comentario / Referencia</th><th>Mov</th><th>Doc</th><th>Folio</th><th>FP</th><th>Usuario</th><th>Entradas</th><th>Salidas</th></tr></thead><tbody>' +
        (r.movimientos || []).map(function (m) {
          return '<tr><td>' + fechaCorta(m.fecha) + ' ' + hora12(m.fecha) + '</td><td>' + esc(m.comentario) + '</td><td>' + esc(m.mov) + '</td><td>' + esc(m.doc) + '</td><td class="v">' + esc(m.folio) + '</td><td>' + esc(m.fp) + '</td><td>' + esc(m.usuario) + '</td><td class="v">' + (m.entrada ? num(m.entrada) : '') + '</td><td class="v">' + (m.salida ? num(m.salida) : '') + '</td></tr>';
        }).join('') + '</tbody></table>';
    }
    out += '<div class="ccr-foot"><span>Corte #' + c.id + '</span><span>Generado por ' + esc(((window.POS_BIZ && window.POS_BIZ.nombre) || 'Attomos')) + '</span><span>' + fechaCorta(new Date()) + ' ' + hora12(new Date()) + '</span></div></div>';
    return out;
  }
  (function () { var st = document.createElement('style'); st.textContent = REPORT_CSS; document.head.appendChild(st); })();

  function needReport() {
    if (!current) { toast('Primero selecciona un corte con Buscar (F2).', 'error'); return false; }
    if (!current.reporte) { toast('Tu usuario no tiene permiso para ver el reporte del corte.', 'error'); return false; }
    return true;
  }

  /* ---------- Previa ---------- */
  var prevModal = $('ccPrevModal');
  function fitPreview() {
    var body = prevModal.querySelector('.cc-prev-body'), doc = $('ccPrevDoc').firstChild, sc = $('ccPrevScale');
    if (!doc) return;
    var w = body.clientWidth - 24, k = Math.min(1, w / 816);
    doc.style.transform = 'scale(' + k + ')'; doc.style.transformOrigin = '0 0';
    sc.style.width = (816 * k) + 'px'; sc.style.height = (doc.offsetHeight * k) + 'px';
  }
  function previa() {
    if (!needReport()) return;
    $('ccPrevDoc').innerHTML = reportHTML(current, true);
    openModal(prevModal);
    requestAnimationFrame(fitPreview);
  }
  window.addEventListener('resize', function () { if (prevModal.classList.contains('open')) fitPreview(); });

  /* ---------- Imprimir (hoja carta) ---------- */
  function imprimir() {
    if (!needReport()) return;
    var old = document.getElementById('ccPrintFrame');
    if (old) old.remove();
    var f = document.createElement('iframe');
    f.id = 'ccPrintFrame';
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:816px;height:10px;border:0;opacity:0;pointer-events:none;';
    document.body.appendChild(f);
    var d = f.contentDocument;
    d.open();
    d.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Corte de caja</title><style>' + REPORT_CSS +
      '@page{size:letter;margin:8mm;}html,body{margin:0;background:#fff;}.ccr{width:100%;padding:0;}*{-webkit-print-color-adjust:exact;print-color-adjust:exact;}</style></head><body>' +
      reportHTML(current, true) + '</body></html>');
    d.close();
    setTimeout(function () { f.contentWindow.focus(); f.contentWindow.print(); }, 150);
  }

  /* ---------- librerías (se cargan solo cuando se ocupan) ---------- */
  var LIBS = {
    xlsx: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
    h2c: 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
    jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
  };
  var loaded = {};
  function loadScript(src) {
    if (loaded[src]) return loaded[src];
    loaded[src] = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = res;
      s.onerror = function () { loaded[src] = null; rej(new Error('No se pudo cargar una librería (¿sin internet?).')); };
      document.head.appendChild(s);
    });
    return loaded[src];
  }
  function fileBase() { return 'Corte de caja ' + (current ? fechaCorta(current.fecha).replace(/\//g, '-') + ' ' + hora12(current.fecha).replace(/:/g, '.').replace(/ /g, '') : stamp()); }

  /* ---------- Excel ---------- */
  function buildWorkbook() {
    var XLSX = window.XLSX, c = current, r = c.reporte;
    var e = r.mov_entradas, s = r.mov_salidas;
    function sec(title, x, la, lb, lca, lcb) {
      var rows = [[title], [la, x.contado, lca, x.canceladas, '']];
      if (lb) rows.push([lb, x.credito, lcb, x.credito_canc, 'Diferencia']);
      else rows[1][4] = 'Diferencia';
      rows.push(['Total', x.total, 'Total', x.total_canc, x.diferencia], []);
      return rows;
    }
    var aoa = [['Reporte de Corte de Caja Extendido'], [((window.POS_BIZ && window.POS_BIZ.nombre) || 'Attomos') + ' · ' + c.caja], [],
      ['Datos generales'],
      ['Fecha', fechaCorta(c.fecha), 'Contado', c.contado], ['Hora', hora12(c.fecha), 'Calculado', c.calculado],
      ['Usuario', c.usuario, 'Diferencia', c.diferencia], ['Caja', c.caja, 'Retirado', c.retirado],
      ['Periodo', fechaCorta(c.desde) + ' ' + hora12(c.desde) + ' a ' + fechaCorta(c.hasta) + ' ' + hora12(c.hasta)], []]
      .concat(sec('Datos de las ventas', r.ventas, 'Ventas a contado', 'Ventas a crédito', 'Ventas canceladas', 'Ventas a crédito canc.'))
      .concat(sec('Datos de las compras', r.compras, 'Compras a contado', 'Compras a crédito', 'Compras canceladas', 'Compras a crédito canc.'))
      .concat(sec('Datos de los gastos', r.gastos, 'Gastos a contado', 'Gastos a crédito', 'Gastos cancelados', 'Gastos a crédito canc.'))
      .concat(sec('Datos de las notas de crédito', r.notas_credito, 'Notas de crédito', '', 'Notas de crédito canc.', ''))
      .concat(sec('Datos de las devoluciones proveedor', r.dev_proveedor, 'Devoluciones pro', '', 'Devoluciones pro canc.', ''))
      .concat([['Datos de los movimientos (entradas/salidas)'],
        ['Entradas/ventas', e.ventas, 'Salidas/compras', s.compras], ['Entradas/créd. recup.', e.cred_recup, 'Salidas/pago de créd.', s.pago_cred],
        ['Entradas/compras canc.', e.compras_canc, 'Salidas/ventas canc.', s.ventas_canc], ['Entradas/notas cre. canc.', e.notas_cre_canc, 'Salidas/notas crédito', s.notas_credito],
        ['Entradas/movimientos', e.movimientos, 'Salidas/movimientos', s.movimientos], ['Entradas/dev. pro.', e.dev_pro, 'Salidas/dev. pro. canc.', s.dev_pro_canc],
        ['Entradas/gastos canc.', e.gastos_canc, 'Salidas/gastos', s.gastos], ['Entradas/propinas', e.propinas, 'Salidas/abonos canc.', s.abonos_canc],
        ['Entradas/por corte', e.corte], ['Total', e.total, 'Total', s.total, 'Diferencia', r.mov_diferencia], [],
        ['Datos generales por tipo de pago'], ['', 'Calculado', 'Contado', 'Diferencia', 'Retirado']])
      .concat(tipoPagoRows(c).map(function (x) { return [x.label, x.calc, x.cont, x.dif, x.ret]; }))
      .concat([['Totales', c.calculado, c.contado, c.diferencia, c.retirado]]);
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 30 }, { wch: 16 }, { wch: 28 }, { wch: 16 }, { wch: 14 }];
    var movs = [['Fecha', 'Hora', 'Comentario / Referencia', 'Mov', 'Doc', 'Folio', 'FP', 'Usuario', 'Entradas', 'Salidas', 'Saldo']]
      .concat((r.movimientos || []).map(function (m) { return [fechaCorta(m.fecha), hora12(m.fecha), m.comentario, m.mov, m.doc, m.folio, m.fp, m.usuario, m.entrada || '', m.salida || '', m.saldo]; }));
    var ws2 = XLSX.utils.aoa_to_sheet(movs);
    ws2['!cols'] = [{ wch: 11 }, { wch: 12 }, { wch: 46 }, { wch: 7 }, { wch: 7 }, { wch: 8 }, { wch: 5 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Corte de caja');
    XLSX.utils.book_append_sheet(wb, ws2, 'Detalle de movimientos');
    return wb;
  }
  function excel() {
    if (!needReport()) return;
    loadScript(LIBS.xlsx).then(function () {
      window.XLSX.writeFile(buildWorkbook(), fileBase() + '.xlsx');
      toast('Excel descargado.');
    }).catch(function (err) { toast(err.message, 'error'); });
  }
  function excelBase64() {
    return loadScript(LIBS.xlsx).then(function () { return window.XLSX.write(buildWorkbook(), { type: 'base64', bookType: 'xlsx' }); });
  }

  /* ---------- PDF ---------- */
  function buildPdf() {
    return Promise.all([loadScript(LIBS.h2c), loadScript(LIBS.jspdf)]).then(function () {
      var host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:-12000px;top:0;background:#fff;';
      host.innerHTML = reportHTML(current, true);
      document.body.appendChild(host);
      var el = host.firstChild;
      return window.html2canvas(el, { scale: 2, backgroundColor: '#ffffff', logging: false }).then(function (cv) {
        host.remove();
        var W = 816, H = 1056, pdf = new window.jspdf.jsPDF({ unit: 'px', format: [W, H], orientation: 'portrait', hotfixes: ['px_scaling'] });
        var k = cv.width / W;                       // px del canvas por px de hoja
        var margin = Math.round(34 * k), pageH = Math.floor(H * k), y = 0, first = true;
        var src = cv.getContext('2d');
        // Corta la hoja en un renglón blanco (para no partir una línea de texto).
        function cutAt(limit) {
          if (limit >= cv.height) return cv.height;
          for (var yy = limit; yy > limit - Math.round(80 * k); yy--) {
            var row = src.getImageData(0, yy, cv.width, 1).data, blank = true;
            for (var i = 0; i < row.length; i += 16) { if (row[i] < 235 || row[i + 1] < 235 || row[i + 2] < 235) { blank = false; break; } }
            if (blank) return yy;
          }
          return limit;
        }
        while (y < cv.height - 2) {
          var top = first ? 0 : margin;
          var end = cutAt(y + pageH - top - (first ? 0 : margin));
          var hh = end - y;
          if (hh <= 0) break;
          var part = document.createElement('canvas');
          part.width = cv.width; part.height = hh;
          var ctx = part.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, part.width, part.height);
          ctx.drawImage(cv, 0, y, cv.width, hh, 0, 0, cv.width, hh);
          if (!first) pdf.addPage([W, H], 'portrait');
          pdf.addImage(part.toDataURL('image/jpeg', 0.92), 'JPEG', 0, top / k, W, hh / k);
          first = false; y = end;
        }
        return pdf;
      }, function (err) { host.remove(); throw err; });
    });
  }
  function pdfDownload() {
    if (!needReport()) return;
    toast('Generando PDF…');
    buildPdf().then(function (pdf) { pdf.save(fileBase() + '.pdf'); toast('PDF descargado.'); })
      .catch(function (err) { toast(err.message || 'No se pudo generar el PDF.', 'error'); });
  }

  /* ---------- Email ---------- */
  var mailModal = $('ccMailModal');
  $('ccMailFrom').textContent = MAIL_FROM || 'El correo del sistema no está configurado';
  function chipsInput(box) {
    var input = box.querySelector('input');
    var list = [];
    function draw() {
      box.querySelectorAll('.cc-chip').forEach(function (x) { x.remove(); });
      list.forEach(function (m, i) {
        var c = document.createElement('span');
        c.className = 'cc-chip';
        c.innerHTML = esc(m) + ' <button type="button" aria-label="Quitar" data-i="' + i + '">×</button>';
        box.insertBefore(c, input);
      });
    }
    function addFrom() {
      input.value.split(/[,;\s]+/).forEach(function (m) {
        m = m.trim();
        if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m) && list.indexOf(m) === -1) list.push(m);
      });
      input.value = '';
      draw();
    }
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ',' || e.key === ';' || e.key === 'Tab' && input.value.trim()) { if (input.value.trim()) { e.preventDefault(); addFrom(); } }
      if (e.key === 'Backspace' && !input.value && list.length) { list.pop(); draw(); }
    });
    input.addEventListener('blur', function () { if (input.value.trim()) addFrom(); });
    box.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-i]');
      if (b) { list.splice(Number(b.getAttribute('data-i')), 1); draw(); } else input.focus();
    });
    return { get: function () { if (input.value.trim()) addFrom(); return list.slice(); }, reset: function () { list = []; input.value = ''; draw(); } };
  }
  var mailTo = chipsInput($('ccMailTo')), mailBcc = chipsInput($('ccMailBcc'));
  mailModal.querySelector('.cc-mail-tabs').addEventListener('click', function (e) {
    var b = e.target.closest('[data-mtab]');
    if (!b) return;
    var t = b.getAttribute('data-mtab');
    this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('is-on', x === b); });
    mailModal.querySelectorAll('[data-mpane]').forEach(function (p) { p.hidden = p.getAttribute('data-mpane') !== t; });
  });
  function email() {
    if (!needReport()) return;
    $('ccMailError').textContent = MAIL_ON ? '' : 'El correo del sistema no está configurado en el servidor (SMTP_USER y SMTP_PASS). Puedes descargar el PDF o el Excel y mandarlo tú.';
    $('ccMailSend').disabled = !MAIL_ON;
    $('ccMailSubject').value = 'Corte de Caja · ' + fechaCorta(current.fecha) + ' ' + hora12(current.fecha);
    openModal(mailModal);
    setTimeout(function () { $('ccMailTo').querySelector('input').focus(); }, 60);
  }
  $('ccMailSend').addEventListener('click', function () {
    var para = mailTo.get(), cco = mailBcc.get();
    if (!para.length) { $('ccMailError').textContent = 'Escribe al menos un correo en «Para».'; return; }
    var btn = this; btn.disabled = true; btn.textContent = 'Preparando…';
    $('ccMailError').textContent = '';
    var jobs = [];
    if ($('ccMailPdf').checked) jobs.push(buildPdf().then(function (pdf) {
      return { nombre: fileBase() + '.pdf', tipo: 'application/pdf', base64: pdf.output('datauristring').split(',')[1] };
    }));
    if ($('ccMailXls').checked) jobs.push(excelBase64().then(function (b64) {
      return { nombre: fileBase() + '.xlsx', tipo: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', base64: b64 };
    }));
    Promise.all(jobs).then(function (adj) {
      btn.textContent = 'Enviando…';
      return api(API + '/cortes/' + current.id + '/email', { method: 'POST', body: {
        para: para, cco: cco, asunto: $('ccMailSubject').value, mensaje: $('ccMailBody').value, adjuntos: adj
      } });
    }).then(function () {
      closeModal(mailModal);
      mailTo.reset(); mailBcc.reset();
      toast('Correo enviado.');
    }).catch(function (err) { $('ccMailError').textContent = err.message; })
      .finally(function () { btn.disabled = !MAIL_ON; btn.textContent = 'Enviar'; });
  });

  /* ---------- Ticket del corte ---------- */
  var tplCache = null;
  function loadTpl() {
    if (tplCache) return Promise.resolve(tplCache);
    return fetch('/api/pos/ticket-plantilla', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (d) { tplCache = T.merge(d && d.data); return tplCache; })
      .catch(function () { tplCache = T.defaults(); return tplCache; });
  }
  function kv(a, b) { return '<div class="tk-kv"><span>' + a + '</span><span>' + b + '</span></div>'; }
  function ticketBody(c, tpl) {
    var e = tpl.encabezado || {}, ve = VE;
    var out = [];
    if (e.nombre) out.push('<div class="tk-c tk-name">' + esc(String(e.nombre).toUpperCase()) + '</div>');
    out.push('<div class="tk-sep"></div><div class="tk-c tk-name">CORTE DE CAJA</div>');
    out.push('<div class="tk-meta"><div><span>No. CORTE:</span> ' + c.id + '</div><div><span>CAJA:</span> ' + esc(c.caja) + '</div>' +
      '<div><span>FECHA:</span> ' + fechaCorta(c.fecha) + '</div><div><span>HORA:</span> ' + hora12(c.fecha) + '</div><div><span>USUARIO:</span> ' + esc(c.usuario) + '</div></div>');
    out.push('<div class="tk-sep"></div><div class="tk-c">DESDE ' + fechaCorta(c.desde) + ' ' + hora12(c.desde) + '</div>');
    ['efectivo', 'cheque', 'vales', 'tarjeta', 'transferencia'].forEach(function (f) {
      var k = c.calculado_fp[f], o = c.contado_fp[f], rr = c.retiro_fp[f];
      if (!k && !o && !rr) return;
      out.push('<div class="tk-sep"></div><div>' + FORMA_TXT[f].toUpperCase() + '</div>');
      out.push(kv('CONTADO:', num(o)));
      if (ve) { out.push(kv('CALCULADO:', num(k))); out.push(kv('DIFERENCIA:', num(r2(o - k)))); }
      out.push(kv('RETIRO:', num(rr)));
    });
    out.push('<div class="tk-sep"></div>');
    out.push('<div class="tk-kv tk-total"><span>TOTAL CONTADO:</span><span>' + num(c.contado) + '</span></div>');
    if (ve) { out.push(kv('TOTAL CALCULADO:', num(c.calculado))); out.push(kv('DIFERENCIA:', num(c.diferencia))); }
    out.push(kv('TOTAL RETIRADO:', num(c.retirado)));
    out.push(kv('QUEDA EN CAJA:', num(r2(c.contado - c.retirado))));
    if (c.reporte) {
      var r = c.reporte;
      out.push('<div class="tk-sep"></div><div class="tk-c">&lt;&lt;&lt;&lt; RESUMEN &gt;&gt;&gt;&gt;</div>');
      out.push(kv('VENTAS (' + r.ventas.cantidad + '):', num(r.ventas.total)));
      if (r.ventas.total_canc) out.push(kv('CANCELADAS:', num(r.ventas.total_canc)));
      out.push(kv('ENTRADAS:', num(r.mov_entradas.total)));
      out.push(kv('SALIDAS:', num(r.mov_salidas.total)));
      if (r.anticipos) out.push(kv('ANTICIPOS:', num(r.anticipos)));
    }
    out.push('<div class="tk-firma"><div class="tk-firma-line"></div><div class="tk-c">' + esc(String(c.usuario || '').toUpperCase()) + '</div><div class="tk-c">FIRMA</div></div>');
    return out.join('');
  }
  function printTicket(c) {
    c = c || current;
    if (!c) { toast('Primero selecciona un corte con Buscar (F2).', 'error'); return; }
    if (!T) return;
    loadTpl().then(function (tpl) { T.print(tpl, { bodyHtml: ticketBody(c, tpl), folio: 'corte ' + c.id }); });
  }

  /* ---------- botones ---------- */
  var ACTS = {
    buscar: openSearch, previa: previa, excel: excel, pdf: pdfDownload, email: email, imprimir: imprimir,
    ticket: function () { printTicket(); }
  };
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (b && ACTS[b.getAttribute('data-act')] && !b.disabled) ACTS[b.getAttribute('data-act')]();
  });

  /* =======================================================
     ESTADO DE CAJA
     ======================================================= */
  var estRows = [];
  function loadEstadoTab() {
    if (!VE) {
      $('ccEstBody').innerHTML = ''; $('ccEstFoot').innerHTML = '';
      $('ccEstEmpty').hidden = false;
      $('ccEstEmpty').textContent = 'Tu usuario no tiene permiso para ver el estado de la caja. Pídele al administrador que active «Recepción ve Calculado y Diferencia».';
      return Promise.resolve();
    }
    $('ccEstBody').classList.add('is-loading');
    return loadEstado().then(function (d) {
      if (!d) return;
      estRows = [{ caja: d.caja, m: d.calculado, total: d.total }];
      $('ccEstUpd').textContent = fechaCorta(new Date()) + ' ' + hora12(new Date());
      renderEstado();
    }).finally(function () { $('ccEstBody').classList.remove('is-loading'); });
  }
  function renderEstado() {
    var q = $('ccEstSearch').value.trim().toLowerCase();
    var rows = estRows.filter(function (r) { return !q || r.caja.toLowerCase().indexOf(q) !== -1; });
    var t = { efectivo: 0, cheque: 0, vales: 0, tarjeta: 0, transferencia: 0, total: 0 };
    $('ccEstBody').innerHTML = rows.map(function (r) {
      FORMAS.forEach(function (f) { t[f] += r.m[f]; }); t.total += r.total;
      return '<tr><td><b>' + esc(r.caja) + '</b></td>' + FORMAS.map(function (f) { return '<td class="num">' + num(r.m[f]) + '</td>'; }).join('') + '<td class="num"><b>' + num(r.total) + '</b></td></tr>';
    }).join('');
    $('ccEstFoot').innerHTML = '<th>Totales</th>' + FORMAS.map(function (f) { return '<td class="num">' + money(t[f]) + '</td>'; }).join('') + '<td class="num"><b>' + money(t.total) + '</b></td>';
    $('ccEstEmpty').hidden = rows.length > 0;
    $('ccEstEmpty').textContent = 'No hay cajas con ese nombre.';
  }
  $('ccEstReload').addEventListener('click', function () { loadEstadoTab().then(function () { toast('Estado de caja actualizado.'); }); });
  $('ccEstSearch').addEventListener('input', renderEstado);

  /* =======================================================
     ENTRADAS Y SALIDAS DE CAJA
     ======================================================= */
  var conceptos = [];
  (function () { var t = iso(new Date()); $('ccMovDesde').value = t; $('ccMovHasta').value = t; })();
  function loadMovs() {
    var d1 = $('ccMovDesde').value, d2 = $('ccMovHasta').value;
    if (d1 && d2 && d1 > d2) { var x = d1; d1 = d2; d2 = x; }
    $('ccMovBody').classList.add('is-loading');
    return api(API + '/movimientos?desde=' + d1 + '&hasta=' + d2).then(function (d) {
      conceptos = d.conceptos || conceptos;
      var list = d.movimientos || [];
      $('ccMovEmpty').hidden = list.length > 0;
      $('ccMovBody').innerHTML = list.map(function (m) {
        return '<tr class="' + (m.cancelado ? 'is-cancelled' : '') + '"><td><span class="vt-date">' + fechaCorta(m.fecha) + '</span><small>' + hora12(m.fecha) + '</small></td>' +
          '<td><span class="cc-tipo is-' + m.tipo + '">' + (m.tipo === 'entrada' ? 'Entrada' : 'Salida') + '</span></td>' +
          '<td>' + esc(m.concepto_txt) + '</td><td>' + (m.forma_pago === 'credito' ? 'A crédito' : FORMA_TXT[m.forma_pago] || m.forma_pago) + '</td>' +
          '<td class="num"><b>' + (m.tipo === 'salida' && m.forma_pago !== 'credito' ? '−' : '') + money(m.monto) + '</b></td>' +
          '<td class="cc-det-com">' + esc(m.comentario) + (m.referencia ? '<small>Ref. ' + esc(m.referencia) + '</small>' : '') + '</td>' +
          '<td>' + esc(m.usuario) + '</td>' +
          '<td>' + (m.cancelado ? '<span class="vt-chip is-cancelada" title="' + esc('Por ' + m.cancelado_por) + '">Cancelado</span>' : (m.en_corte ? '<span class="vt-chip is-pagada">En corte</span>' : '<span class="vt-chip is-debe">Pendiente de corte</span>')) + '</td>' +
          '<td>' + (m.cancelado ? '' : '<button type="button" class="cc-linkbtn" data-cancel-mov="' + m.id + '">Cancelar</button>') + '</td></tr>';
      }).join('');
    }).catch(function (err) { toast(err.message, 'error'); })
      .finally(function () { $('ccMovBody').classList.remove('is-loading'); });
  }
  ['ccMovDesde', 'ccMovHasta'].forEach(function (id) { $(id).addEventListener('change', loadMovs); });
  $('ccMovBody').addEventListener('click', function (e) {
    var b = e.target.closest('[data-cancel-mov]');
    if (!b) return;
    confirmBox('¿Cancelar este movimiento? Se revierte en el siguiente corte de caja.', 'Sí, cancelar').then(function (ok) {
      if (!ok) return;
      api(API + '/movimientos/' + b.getAttribute('data-cancel-mov') + '/cancelar', { method: 'POST', body: {} })
        .then(function () { toast('Movimiento cancelado.'); loadMovs(); loadEstado(); })
        .catch(function (err) { toast(err.message, 'error'); });
    });
  });

  var movModal = $('ccMovModal'), movTipo = 'salida';
  function fillConceptos() {
    var sel = $('ccMovConcepto'), cur = sel.value;
    sel.innerHTML = conceptos.filter(function (c) { return c.tipo === movTipo; }).map(function (c) {
      return '<option value="' + c.key + '">' + esc(c.label) + '</option>';
    }).join('');
    if (cur && sel.querySelector('option[value="' + cur + '"]')) sel.value = cur;
    fillFormas();
  }
  function fillFormas() {
    var c = conceptos.filter(function (x) { return x.key === $('ccMovConcepto').value; })[0] || {};
    var sel = $('ccMovForma'), cur = sel.value || 'efectivo';
    var opts = ['efectivo', 'tarjeta', 'transferencia', 'cheque', 'vales'];
    if (c.credito) opts.push('credito');
    sel.innerHTML = opts.map(function (f) { return '<option value="' + f + '">' + (f === 'credito' ? 'A crédito (no sale de caja)' : FORMA_TXT[f]) + '</option>'; }).join('');
    sel.value = opts.indexOf(cur) !== -1 ? cur : 'efectivo';
    var hints = {
      gasto: 'Gastos del negocio pagados con dinero de la caja (o a crédito).', compra: 'Compras de mercancía o insumos.',
      pago_credito: 'Pago a un proveedor de una compra que quedó a crédito.', nota_credito: 'Dinero que se le regresa a un cliente.',
      retiro: 'Dinero que se saca de la caja (p. ej. para depositar al banco).', otro_salida: 'Cualquier otra salida de dinero.',
      deposito: 'Dinero que se mete a la caja (fondo, cambio…).', dev_proveedor: 'Dinero que regresa un proveedor.', otro_entrada: 'Cualquier otra entrada de dinero.'
    };
    $('ccMovHint').textContent = hints[$('ccMovConcepto').value] || '';
  }
  $('ccMovTipo').addEventListener('click', function (e) {
    var b = e.target.closest('[data-tipo]');
    if (!b) return;
    movTipo = b.getAttribute('data-tipo');
    this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('is-on', x === b); });
    fillConceptos();
  });
  $('ccMovConcepto').addEventListener('change', fillFormas);
  function openMov() {
    if (tab !== 'movs') setTab('movs');
    var go = function () {
      $('ccMovForm').reset(); $('ccMovError').textContent = '';
      fillConceptos();
      openModal(movModal);
      setTimeout(function () { $('ccMovMonto').focus(); }, 60);
    };
    if (conceptos.length) go(); else loadMovs().then(go);
  }
  $('ccMovNew').addEventListener('click', openMov);
  $('ccMovForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var body = {
      concepto: $('ccMovConcepto').value, forma_pago: $('ccMovForma').value,
      monto: r2(parseFloat($('ccMovMonto').value) || 0), comentario: $('ccMovCom').value.trim(), referencia: $('ccMovRef').value.trim()
    };
    if (!(body.monto > 0)) { $('ccMovError').textContent = 'Escribe un monto mayor a cero.'; $('ccMovMonto').focus(); return; }
    var btn = $('ccMovSave'); btn.disabled = true;
    api(API + '/movimientos', { method: 'POST', body: body }).then(function () {
      closeModal(movModal);
      toast((movTipo === 'entrada' ? 'Entrada' : 'Salida') + ' registrada.');
      loadMovs(); loadEstado();
    }).catch(function (err) { $('ccMovError').textContent = err.message; })
      .finally(function () { btn.disabled = false; });
  });

  /* =======================================================
     PERMISO (solo admin)
     ======================================================= */
  if (ADMIN && $('ccPermVe')) {
    api(API + '/config').then(function (d) { $('ccPermVe').checked = !!d.recepcion_ve_calculado; });
    $('ccPermVe').addEventListener('change', function () {
      var on = this.checked;
      api(API + '/config', { method: 'PUT', body: { recepcion_ve_calculado: on } })
        .then(function () { toast(on ? 'Recepción ya ve «Calculado» y «Diferencia».' : 'Recepción cuenta a ciegas (no ve lo calculado).'); })
        .catch(function (err) { toast(err.message, 'error'); $('ccPermVe').checked = !on; });
    });
  }

  /* =======================================================
     ATAJOS DE TECLADO (los de SICAR)
     ======================================================= */
  document.addEventListener('keydown', function (e) {
    var k = e.key, ctrl = e.ctrlKey || e.metaKey, alt = e.altKey;
    var top = topModal();
    if (k === 'Escape' && top) { closeModal(top); return; }
    if (k === 'F5') {
      if (top === searchModal) { e.preventDefault(); loadSearch(); return; }
      if (!top && tab === 'estado') { e.preventDefault(); $('ccEstReload').click(); return; }
      return;
    }
    if (top && top !== prevModal) return; // con un formulario abierto no se disparan atajos
    var lk = (k || '').toLowerCase();
    if (k === 'F3' && !top) { e.preventDefault(); openCorte(); return; }
    if (k === 'F4' && !top) { e.preventDefault(); openPropina(); return; }
    if (k === 'F2' && !top) { e.preventDefault(); openSearch(); return; }
    var inConsulta = tab === 'consultar' || top === prevModal;
    if (!inConsulta) return;
    if (ctrl && !alt && lk === 'r' && !top) { e.preventDefault(); previa(); return; }
    if (alt && !ctrl && (lk === 'x' || e.code === 'KeyX')) { e.preventDefault(); excel(); return; }
    if (alt && !ctrl && (lk === 'p' || e.code === 'KeyP')) { e.preventDefault(); pdfDownload(); return; }
    if (k === 'F11') { e.preventDefault(); email(); return; }
    if (ctrl && !alt && lk === 'p' && current) { e.preventDefault(); imprimir(); return; }
    if (alt && !ctrl && (lk === 't' || e.code === 'KeyT')) { e.preventDefault(); printTicket(); }
  });

  /* ---------- arranque ---------- */
  loadEstado();
  try {
    var saved = localStorage.getItem('attomosCorteTab');
    if (saved && saved !== 'corte' && document.querySelector('[data-pane="' + saved + '"]')) setTab(saved);
  } catch (e) {}
  if (!MAIL_ON) document.querySelectorAll('[data-act="email"]').forEach(function (b) { b.title = 'El correo del sistema no está configurado en el servidor'; });
})();