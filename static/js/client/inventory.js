/* =========================================================
   INVENTARIO — Attomos (sidebar → Inventario)
   Portado del panel de Inventario de Avante Optics. Todo en un archivo;
   cada módulo solo arranca si su pestaña está en la página:
     Inv (común) · InvLabels (etiquetas) · Artículos · Departamentos ·
     Ajustes · Conteo con escáner · Movimientos
   ========================================================= */

/* ---------------------------------------------------------------- inventory-common.js */
/* =========================================================
   INVENTARIO — utilidades compartidas por las páginas del panel
   (Artículos, Departamentos, Ajustes, Movimientos).
   window.Inv = { $, esc, norm, mxn, num, round2, api, toast,
                  openModal, closeModal, fecha, fechaHora, hoyISO,
                  periodo, datePicker, debounce }
   ========================================================= */
window.Inv = (function () {
  var mxn = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2 });
  var numFmt = new Intl.NumberFormat('es-MX');
  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
  function num(n) { return numFmt.format(Number(n) || 0); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function hoyISO() { return iso(new Date()); }

  // "2026-10-06T13:05:00" → "6 oct 2026"
  function fecha(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
    return m ? Number(m[3]) + ' ' + MESES[Number(m[2]) - 1] + ' ' + m[1] : '—';
  }
  // → "6 oct 2026 · 1:05 p. m."
  function fechaHora(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(s || '');
    if (!m) return fecha(s);
    var h = Number(m[4]), ap = h >= 12 ? 'p. m.' : 'a. m.';
    h = h % 12 || 12;
    return fecha(s) + ' · ' + h + ':' + m[5] + ' ' + ap;
  }

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

  var toastEl = null;
  function toast(msg, kind) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'inv-toast'; toastEl.setAttribute('role', 'status'); document.body.appendChild(toastEl); }
    toastEl.textContent = msg;
    toastEl.classList.toggle('is-error', kind === 'error');
    toastEl.classList.remove('is-on'); void toastEl.offsetWidth; toastEl.classList.add('is-on');
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(function () { toastEl.classList.remove('is-on'); }, kind === 'error' ? 4200 : 2800);
  }

  function openModal(ov) {
    ov.classList.add('open');
    document.body.style.overflow = 'hidden';
    var body = ov.querySelector('.admin-modal-body');
    if (body) body.scrollTop = 0;
  }
  function closeModal(ov) {
    ov.classList.remove('open');
    if (!document.querySelector('.admin-modal-overlay.open')) document.body.style.overflow = '';
  }
  // Clic afuera / X / Esc cierran cualquier modal del panel.
  document.addEventListener('click', function (e) {
    var close = e.target.closest('[data-close-modal]');
    if (close) { closeModal(close.closest('.admin-modal-overlay')); return; }
    if (e.target.classList && e.target.classList.contains('admin-modal-overlay') && e.target.classList.contains('open')) closeModal(e.target);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var open = document.querySelectorAll('.admin-modal-overlay.open');
    if (open.length) closeModal(open[open.length - 1]);
  });

  function debounce(fn, ms) {
    var t;
    return function () { var a = arguments, self = this; clearTimeout(t); t = setTimeout(function () { fn.apply(self, a); }, ms); };
  }

  // Periodo → [desde, hasta] (YYYY-MM-DD). "todo" = ['', ''].
  function periodo(p, desde, hasta) {
    var t = new Date(); t = new Date(t.getFullYear(), t.getMonth(), t.getDate());
    function add(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
    switch (p) {
      case 'hoy': return [iso(t), iso(t)];
      case 'ayer': return [iso(add(t, -1)), iso(add(t, -1))];
      case '7d': return [iso(add(t, -6)), iso(t)];
      case '30d': return [iso(add(t, -29)), iso(t)];
      case 'mes': return [iso(new Date(t.getFullYear(), t.getMonth(), 1)), iso(t)];
      case 'mespasado': return [iso(new Date(t.getFullYear(), t.getMonth() - 1, 1)), iso(new Date(t.getFullYear(), t.getMonth(), 0))];
      case 'rango': {
        var a = desde || iso(t), b = hasta || iso(t);
        return a > b ? [b, a] : [a, b];
      }
      default: return ['', ''];
    }
  }

  /* ---------- calendario (el mismo .cb-datepicker de "Crear cita") ----------
     Inv.datePicker(contenedor, { value, onChange, alignEnd }) → { get, set } */
  var openPickers = [];
  document.addEventListener('click', function () { openPickers.forEach(function (p) { p.classList.remove('is-open'); }); });
  function datePicker(host, opts) {
    opts = opts || {};
    var value = opts.value || '';
    host.innerHTML =
      '<div class="cb-datepicker cf-dp' + (opts.alignEnd ? ' cf-dp--end' : '') + '">' +
        '<button type="button" class="cb-datepicker-trigger">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>' +
          '<span class="cb-datepicker-value">dd/mm/aaaa</span>' +
          '<svg class="cf-dp-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>' +
        '</button>' +
        '<div class="cb-datepicker-menu">' +
          '<div class="cb-datepicker-nav">' +
            '<button type="button" data-nav="-1" aria-label="Mes anterior"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg></button>' +
            '<span class="cf-dp-month">—</span>' +
            '<button type="button" data-nav="1" aria-label="Mes siguiente"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg></button>' +
          '</div>' +
          '<div class="cb-datepicker-weekdays"><span>do</span><span>lu</span><span>ma</span><span>mi</span><span>ju</span><span>vi</span><span>sá</span></div>' +
          '<div class="cb-datepicker-grid"></div>' +
          '<div class="cb-datepicker-actions"><button type="button" data-act="hoy">Hoy</button></div>' +
        '</div>' +
      '</div>';
    var picker = host.firstChild;
    openPickers.push(picker);
    var valueEl = picker.querySelector('.cb-datepicker-value');
    var monthEl = picker.querySelector('.cf-dp-month');
    var grid = picker.querySelector('.cb-datepicker-grid');
    var vy, vm;
    function label() {
      if (!value) { valueEl.textContent = 'dd/mm/aaaa'; return; }
      var p = value.split('-');
      valueEl.textContent = p[2] + '/' + p[1] + '/' + p[0];
    }
    function render() {
      var name = MESES_LARGOS[vm];
      monthEl.textContent = name.charAt(0).toUpperCase() + name.slice(1) + ' de ' + vy;
      var first = new Date(vy, vm, 1).getDay();
      var dim = new Date(vy, vm + 1, 0).getDate();
      var dimPrev = new Date(vy, vm, 0).getDate();
      var cells = Math.ceil((first + dim) / 7) * 7;
      var today = hoyISO();
      var range = opts.range ? opts.range() : null;
      var html = '';
      for (var i = 0; i < cells; i++) {
        var d, y = vy, m = vm, out = false;
        if (i < first) { d = dimPrev - (first - 1 - i); m -= 1; out = true; }
        else if (i >= first + dim) { d = i - (first + dim) + 1; m += 1; out = true; }
        else d = i - first + 1;
        var ci = iso(new Date(y, m, d));
        var cls = 'cb-datepicker-day';
        if (out) cls += ' is-outside';
        if (ci === today) cls += ' is-today';
        if (ci === value) cls += ' is-selected';
        else if (range && range[0] && range[1] && ci > range[0] && ci < range[1]) cls += ' is-inrange';
        html += '<button type="button" class="' + cls + '" data-iso="' + ci + '">' + d + '</button>';
      }
      grid.innerHTML = html;
    }
    function set(v, silent) {
      value = v || '';
      label();
      if (!silent && opts.onChange) opts.onChange(value);
    }
    picker.addEventListener('click', function (e) { e.stopPropagation(); });
    picker.querySelector('.cb-datepicker-trigger').addEventListener('click', function () {
      if (picker.classList.contains('is-open')) { picker.classList.remove('is-open'); return; }
      openPickers.forEach(function (p) { p.classList.remove('is-open'); });
      var base = value ? value.split('-').map(Number) : null, t = new Date();
      vy = base ? base[0] : t.getFullYear();
      vm = base ? base[1] - 1 : t.getMonth();
      render();
      picker.classList.add('is-open');
    });
    picker.querySelectorAll('[data-nav]').forEach(function (b) {
      b.addEventListener('click', function () {
        vm += Number(b.getAttribute('data-nav'));
        if (vm < 0) { vm = 11; vy -= 1; }
        if (vm > 11) { vm = 0; vy += 1; }
        render();
      });
    });
    picker.querySelector('[data-act="hoy"]').addEventListener('click', function () { set(hoyISO()); picker.classList.remove('is-open'); });
    grid.addEventListener('click', function (e) {
      var day = e.target.closest('.cb-datepicker-day');
      if (!day) return;
      set(day.getAttribute('data-iso'));
      picker.classList.remove('is-open');
    });
    label();
    return { get: function () { return value; }, set: function (v) { set(v, true); } };
  }

  /* ---------- dropdown animado (el mismo .admin-role-select de Crear cita) ----------
     Inv.select(contenedor, { options: [{value, label, hint}], value, placeholder, onChange })
       → { get, set(value, silent), setOptions(options) } */
  var openSelects = [];
  document.addEventListener('click', function () { openSelects.forEach(function (s) { s.classList.remove('is-open'); }); });
  function select(host, opts) {
    opts = opts || {};
    var options = opts.options || [];
    var value = opts.value == null ? '' : String(opts.value);
    host.innerHTML =
      '<div class="admin-role-select inv-select">' +
        '<button type="button" class="admin-role-select-btn" aria-haspopup="listbox"><span class="inv-select-label"></span>' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg></button>' +
        '<div class="admin-role-select-menu inv-select-menu" role="listbox"></div>' +
      '</div>';
    var wrap = host.firstChild, btn = wrap.firstChild, menu = wrap.lastChild, lbl = btn.querySelector('.inv-select-label');
    openSelects.push(wrap);
    function render() {
      menu.innerHTML = options.map(function (o) {
        var on = String(o.value) === value;
        return '<button type="button" class="admin-role-option' + (on ? ' active' : '') + (o.action ? ' inv-select-action' : '') + '" role="option" aria-selected="' + on + '" data-value="' + esc(o.value) + '">' +
          esc(o.label) + (o.hint ? '<small>' + esc(o.hint) + '</small>' : '') + '</button>';
      }).join('');
      var cur = options.filter(function (o) { return String(o.value) === value; })[0];
      lbl.textContent = cur ? cur.label : (opts.placeholder || 'Elegir…');
      lbl.classList.toggle('is-placeholder', !cur);
    }
    wrap.addEventListener('click', function (e) { e.stopPropagation(); });
    btn.addEventListener('click', function () {
      var open = !wrap.classList.contains('is-open');
      openSelects.forEach(function (s) { s.classList.remove('is-open'); });
      openPickers.forEach(function (p) { p.classList.remove('is-open'); });
      wrap.classList.toggle('is-open', open);
      if (open) { var a = menu.querySelector('.active'); if (a) menu.scrollTop = a.offsetTop - 40; }
    });
    menu.addEventListener('click', function (e) {
      var o = e.target.closest('.admin-role-option');
      if (!o) return;
      wrap.classList.remove('is-open');
      var v = o.getAttribute('data-value');
      var opt = options.filter(function (x) { return String(x.value) === v; })[0];
      if (opt && opt.action) { opt.action(); return; }
      value = v; render();
      if (opts.onChange) opts.onChange(value);
    });
    render();
    return {
      get: function () { return value; },
      set: function (v, silent) { value = v == null ? '' : String(v); render(); if (!silent && opts.onChange) opts.onChange(value); },
      setOptions: function (o) { options = o || []; render(); }
    };
  }

  // Dónde vive el panel (/inventory) y si quien lo usa puede ver/poner el
  // precio de compra (hoy el dueño del negocio; después, según el empleado).
  var pageEl = document.querySelector('[data-inv-base]');
  var base = (pageEl && pageEl.getAttribute('data-inv-base')) || '/inventory';
  var canCost = !!(pageEl && pageEl.getAttribute('data-can-cost') === '1');
  // Attomos: giro óptica (armazón, mica, color, material) y nombre del
  // negocio para los reportes (PDF / Excel / WhatsApp).
  var optica = !!(pageEl && pageEl.getAttribute('data-optica') === '1');
  var biz = (pageEl && pageEl.getAttribute('data-business')) || 'Attomos';

  // Números de rastreo por pieza (AVT000123): en Avante ya no se generan y
  // en Attomos no existen, así que nunca se buscan.
  function isRastreo(s) { return false; }
  function lookupRastreo(num) {
    return api('/api/inventario/rastreo/' + encodeURIComponent(String(num).trim().toUpperCase()));
  }

  /* ---------- botones segmentados (.inv-seg): el fondo azul se desliza
     al botón activo, igual que las pestañas del artículo y "Día /
     Calendario / Tabla" de Citas. Funciona con cualquier código que solo
     cambie la clase is-on de los botones (o de los <a>). ---------- */
  function segGlow(seg) {
    if (!seg || seg._glow) return;
    var glow = document.createElement('span');
    glow.className = 'inv-seg-glow';
    glow.setAttribute('aria-hidden', 'true');
    seg.insertBefore(glow, seg.firstChild);
    seg._glow = glow;
    seg.classList.add('has-glow');
    var first = true;
    function place() {
      var on = seg.querySelector(':scope > .is-on');
      if (!on || !on.offsetWidth) { glow.style.opacity = '0'; return; }
      if (first) glow.style.transition = 'none';
      glow.style.opacity = '1';
      glow.style.width = on.offsetWidth + 'px';
      glow.style.height = on.offsetHeight + 'px';
      glow.style.transform = 'translate(' + on.offsetLeft + 'px,' + on.offsetTop + 'px)';
      if (first) { void glow.offsetWidth; glow.style.transition = ''; first = false; }
    }
    seg._place = place;
    new MutationObserver(place).observe(seg, { subtree: true, attributes: true, attributeFilter: ['class'] });
    if (window.ResizeObserver) new ResizeObserver(place).observe(seg);
    window.addEventListener('resize', place);
    place();
  }
  function segGlowAll(root) {
    (root || document).querySelectorAll('.inv-seg').forEach(segGlow);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { segGlowAll(); });
  else setTimeout(segGlowAll, 0);

  // Librerías para exportar (PDF / Excel), solo cuando se usan.
  var LIBS = {
    xlsx: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
    jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    autotable: 'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.4/dist/jspdf.plugin.autotable.min.js'
  };
  var libP = {};
  function lib(name) {
    if (name === 'jspdf' && window.jspdf && window.jspdf.jsPDF) return Promise.resolve();
    if (name === 'xlsx' && window.XLSX) return Promise.resolve();
    if (!libP[name]) libP[name] = new Promise(function (ok, fail) {
      var sc = document.createElement('script');
      sc.src = LIBS[name]; sc.onload = ok;
      sc.onerror = function () { delete libP[name]; fail(new Error('No se pudo cargar la herramienta para exportar. Revisa tu internet.')); };
      document.head.appendChild(sc);
    });
    return libP[name];
  }
  function pdfLibs() { return lib('jspdf').then(function () { return lib('autotable'); }); }
  function ahoraLocal() { var d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19); }

  return {
    lib: lib, pdfLibs: pdfLibs, ahoraLocal: ahoraLocal, segGlow: segGlow, segGlowAll: segGlowAll,
    isRastreo: isRastreo, lookupRastreo: lookupRastreo,
    base: base, canCost: canCost, optica: optica, biz: biz,
    select: select,
    $: $, esc: esc, norm: norm, mxn: mxn, num: num, round2: round2, api: api, toast: toast,
    openModal: openModal, closeModal: closeModal, fecha: fecha, fechaHora: fechaHora,
    hoyISO: hoyISO, iso: iso, periodo: periodo, datePicker: datePicker, debounce: debounce
  };
})();
/* ---------------------------------------------------------------- labels.js */
/* =========================================================
   INVENTARIO — impresión directa de ETIQUETAS (precio grande + código de barras)
   Igual que el ticket: se manda por el programa local de impresión (127.0.0.1:17771)
   (127.0.0.1:17771) directo a la impresora de etiquetas, sin diálogo.

   Las impresoras de etiquetas no entienden imágenes como las ticketeras:
   hablan su propio "idioma" de comandos. Se soportan los 3 más comunes:
     · TSPL — TSC, Xprinter (XP-360B/365B/420B…), 3nStar, Rongta, Beeprt…
     · ZPL  — Zebra (ZD220, ZD230, GC420, GK420…)
     · EPL  — Zebra viejitas (LP2824, TLP2844…)
   La de Avante Optics es la SICAR EVA58 (etiqueta y ticket, 58 mm, 203 dpi):
   habla TSPL en modo etiqueta y ESC/POS en modo ticket. Área útil 56 mm.
   Lo elegido se guarda en ESTA compu (localStorage, 'attomos.etiquetadora').

   window.InvLabels = { config, setConfig, status, print, test, guess }
   ========================================================= */
window.InvLabels = (function () {
  var AGENT = 'http://127.0.0.1:17771';
  var KEY = 'attomos.etiquetadora';
  var DEF = { printer: '', lang: 'tspl', w: 50, h: 25, gap: 2, enabled: true, priceImg: true };

  function config() {
    var c = {};
    try { c = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { c = {}; }
    var out = {};
    Object.keys(DEF).forEach(function (k) { out[k] = c[k] != null ? c[k] : DEF[k]; });
    out.w = Number(out.w) || DEF.w; out.h = Number(out.h) || DEF.h; out.gap = Number(out.gap); if (isNaN(out.gap)) out.gap = DEF.gap;
    return out;
  }
  function setConfig(c) {
    var next = config();
    Object.keys(c || {}).forEach(function (k) { if (k in DEF) next[k] = c[k]; });
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch (e) {}
    return next;
  }

  function agentFetch(path, opts, ms) {
    opts = opts || {};
    var ctrl = window.AbortController ? new AbortController() : null;
    var t = ctrl ? setTimeout(function () { ctrl.abort(); }, ms || 2500) : null;
    var init = { method: opts.method || 'GET', mode: 'cors', cache: 'no-store', targetAddressSpace: 'loopback' };
    if (ctrl) init.signal = ctrl.signal;
    if (opts.body) { init.headers = { 'Content-Type': 'application/json' }; init.body = opts.body; }
    return fetch(AGENT + path, init).then(function (r) {
      if (t) clearTimeout(t);
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok || d.ok === false) throw new Error(d.error || 'El programa respondió con error ' + r.status);
        return d;
      });
    }, function (err) {
      if (t) clearTimeout(t);
      var e = new Error('No se encontró el programa de impresión en esta compu');
      e.offline = true; e.cause = err;
      throw e;
    });
  }
  // {ok, printers:[], default} o null si el programa no está abierto.
  function status() { return agentFetch('/status', null, 1500).catch(function () { return null; }); }

  // SICAR EVA58 (= MPRINT LP58 EVA): 58 mm de papel, 56 mm de impresión.
  function isEva(name) { return /eva ?-?58|lp ?-?58/i.test(name || ''); }
  // Parece impresora de etiquetas por el nombre (para sugerirla primero).
  function looksLikeLabel(name) {
    return /eva ?-?58|lp ?-?58|zebra|\bzd\d{3}|\bgc4\d\d|\bgk4\d\d|\bgx4\d\d|lp ?28|tlp|\btsc\b|\bttp|\bte2\d\d|xp-?(3|4)\d\db|xprinter|label|etiq|3nstar|\bltt|rongta|beeprt|godex|argox/i.test(name || '');
  }
  // Idioma probable según la marca.
  function guess(name) {
    if (isEva(name)) return 'tspl';
    if (/lp ?28|tlp ?28/i.test(name || '')) return 'epl';
    if (/zebra|\bzd\d{3}|\bgc4\d\d|\bgk4\d\d|\bgx4\d\d/i.test(name || '')) return 'zpl';
    return 'tspl';
  }

  /* ---------- armar comandos ---------- */
  // Las etiquetadoras no traen acentos en su letra interna: se quitan.
  function plain(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ñ/g, 'n').replace(/Ñ/g, 'N')
      .replace(/[^\x20-\x7E]/g, ' ').replace(/[\^~]/g, '').replace(/"/g, "'").replace(/\s+/g, ' ').trim();
  }
  function cut(s, n) { s = plain(s); return s.length > n ? s.slice(0, n - 1) + '.' : s; }

  // Ancho del código 128 (en puntos) para centrarlo.
  function c128Width(text, narrow) { return (11 * (text.length + 3) + 2) * narrow; }

  // Precio para la etiqueta: sin centavos si son .00 ("$1,250"), para que
  // quepa en letra grande.
  function priceText(v) {
    var n = Number(v) || 0, cents = Math.round(n * 100) % 100 !== 0;
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 });
  }

  // Dibuja el precio en negritas, lo más grande que quepa en (ancho × alto)
  // puntos, y lo convierte a la imagen de 1 bit que entiende TSPL (BITMAP):
  // bit 0 = punto negro, bit 1 = blanco. Regresa {x, wb, h, data} o null.
  function priceBitmap(text, W, maxH) {
    try {
      if (typeof document === 'undefined') return null;
      var cv = document.createElement('canvas'), ctx = cv.getContext('2d');
      var font = function (px) { return '900 ' + px + 'px Arial, Helvetica, sans-serif'; };
      var size = Math.round(maxH * 1.5), m, tw, th;
      for (; size > 12; size -= 2) {
        ctx.font = font(size);
        m = ctx.measureText(text);
        tw = Math.ceil((m.actualBoundingBoxLeft || 0) + (m.actualBoundingBoxRight || m.width)) + 4;
        th = Math.ceil((m.actualBoundingBoxAscent || size * 0.75) + (m.actualBoundingBoxDescent || size * 0.18)) + 4;
        if (tw <= W - 12 && th <= maxH) break;
      }
      var wb = Math.ceil(tw / 8), w = wb * 8, h = th;
      cv.width = w; cv.height = h;
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      ctx.font = font(size); ctx.fillStyle = '#000'; ctx.strokeStyle = '#000'; ctx.lineWidth = Math.max(1, Math.round(size / 28));
      var bx = 2 + (m.actualBoundingBoxLeft || 0), by = 2 + (m.actualBoundingBoxAscent || size * 0.75);
      ctx.fillText(text, bx, by); ctx.strokeText(text, bx, by);
      var px = ctx.getImageData(0, 0, w, h).data, out = '';
      for (var y = 0; y < h; y++) {
        for (var xb = 0; xb < wb; xb++) {
          var byte = 0;
          for (var bit = 0; bit < 8; bit++) {
            var i = (y * w + xb * 8 + bit) * 4;
            var dark = (px[i] + px[i + 1] + px[i + 2]) / 3 < 140;
            if (!dark) byte |= (0x80 >> bit);
          }
          out += String.fromCharCode(byte);
        }
      }
      return { x: Math.max(0, Math.round((W - w) / 2)), wb: wb, h: h, data: out };
    } catch (e) { return null; }
  }

  // labels: [{code, desc, price, sub}]  ·  203 dpi = 8 puntos por mm
  //   code  → lo que lleva el código de barras (la clave del artículo;
  //           el Punto de venta lo encuentra al escanearlo)
  //   price → número; se imprime GRANDE para que se vea de lejos
  // (También acepta el formato viejo {numero, desc, linea}.)
  function norm(l) {
    return {
      code: plain(l.code || l.numero || '').replace(/\s/g, ''),
      desc: l.desc || '',
      price: l.price != null ? priceText(l.price) : '',
      sub: l.sub != null ? l.sub : (l.price != null ? '' : (l.linea || ''))
    };
  }
  function build(cfg, labels) {
    // La EVA58 no imprime en el último milímetro de cada lado: se centra en 56 mm.
    var W = Math.round((isEva(cfg.printer) ? Math.min(cfg.w, 56) : cfg.w) * 8), H = Math.round(cfg.h * 8);
    var maxChars = Math.max(10, Math.floor((W - 16) / 12));
    // Alturas: descripción arriba, PRECIO grande, código de barras y la clave abajo.
    var descY = Math.max(4, Math.round(H * 0.035));
    var priceY = descY + 24;
    var out = '';
    if (cfg.lang === 'zpl') {
      labels.map(norm).forEach(function (l) {
        var ph = Math.max(40, Math.min(Math.round(H * 0.45), H - priceY - 58));
        while (ph > 30 && l.price.length * ph * 0.56 > W - 12) ph -= 4;
        var bcY = priceY + ph + 6, bh = Math.max(26, Math.min(Math.round(H * 0.28), H - bcY - 30));
        var narrow = c128Width(l.code, 2) <= W - 16 ? 2 : 1;
        var x = Math.max(0, Math.round((W - c128Width(l.code, narrow)) / 2));
        out += '^XA^CI28^PW' + W + '^LL' + H + '^LH0,0' +
          '^FO0,' + descY + '^FB' + W + ',1,0,C^A0N,22,20^FD' + cut(l.desc, maxChars) + '^FS' +
          (l.price ? '^FO0,' + priceY + '^FB' + W + ',1,0,C^A0N,' + ph + ',' + Math.round(ph * 0.92) + '^FD' + l.price + '^FS' : '') +
          '^FO' + x + ',' + bcY + '^BY' + narrow + '^BCN,' + bh + ',N,N,N^FD' + l.code + '^FS' +
          '^FO0,' + (bcY + bh + 4) + '^FB' + W + ',1,0,C^A0N,20,18^FD' + cut(l.code + (l.sub ? '  ' + l.sub : ''), maxChars + 4) + '^FS' +
          '^PQ1^XZ\n';
      });
      return out;
    }
    if (cfg.lang === 'epl') {
      out += 'N\nq' + W + '\nQ' + H + ',' + Math.round(cfg.gap * 8) + '\n';
      labels.map(norm).forEach(function (l) {
        // Fuente 5 = 32×48 (la más grande); si no cabe, la 4 (14×24) al doble.
        var pf = 5, pmx = 2, cw = 64, ch = 96;
        if (l.price.length * cw > W - 12 || H - (priceY + ch + 6) < 52) { pmx = 1; cw = 32; ch = 48; }
        if (l.price.length * cw > W - 12) { pf = 4; pmx = 2; cw = 28; ch = 48; }
        if (l.price.length * cw > W - 12) { pf = 4; pmx = 1; cw = 14; ch = 24; }
        var bcY = priceY + ch + 6, bh = Math.max(26, Math.min(Math.round(H * 0.28), H - bcY - 26));
        var narrow = c128Width(l.code, 2) <= W - 16 ? 2 : 1;
        var x = Math.max(0, Math.round((W - c128Width(l.code, narrow)) / 2));
        var d = cut(l.desc, maxChars), c = cut(l.code + (l.sub ? '  ' + l.sub : ''), maxChars + 4);
        out += 'N\n' +
          'A' + Math.max(4, Math.round((W - d.length * 10) / 2)) + ',' + descY + ',0,2,1,1,N,"' + d + '"\n' +
          (l.price ? 'A' + Math.max(4, Math.round((W - l.price.length * cw) / 2)) + ',' + priceY + ',0,' + pf + ',' + pmx + ',' + pmx + ',N,"' + l.price + '"\n' : '') +
          'B' + x + ',' + bcY + ',0,1,' + narrow + ',' + (narrow * 2) + ',' + bh + ',N,"' + l.code + '"\n' +
          'A' + Math.max(4, Math.round((W - c.length * 10) / 2)) + ',' + (bcY + bh + 4) + ',0,2,1,1,N,"' + c + '"\n' +
          'P1\n';
      });
      return out;
    }
    // TSPL (SICAR EVA58, TSC, Xprinter, 3nStar…)
    // Muchas TSPL económicas (como la EVA58) NO agrandan su letra interna
    // aunque se les pida: por eso el precio se manda como IMAGEN (BITMAP),
    // dibujado en negritas del tamaño que quepa. Descripción, código de
    // barras y clave siguen con los comandos normales (salen nítidos).
    out += 'SIZE ' + cfg.w + ' mm,' + cfg.h + ' mm\r\nGAP ' + cfg.gap + ' mm,0 mm\r\nDIRECTION 1\r\nREFERENCE 0,0\r\nCODEPAGE 1252\r\n';
    labels.map(norm).forEach(function (l) {
      // Código de barras de ~6.5 mm de alto (52 puntos en 25 mm): fácil para escáneres económicos.
      var codeH = 22, bh = Math.max(48, Math.round(H * 0.26));
      var bcY = H - 4 - codeH - bh;
      var pTop = descY + 24, pH = Math.max(24, bcY - 6 - pTop);
      var narrow = c128Width(l.code, 2) <= W - 16 ? 2 : 1;
      var x = Math.max(0, Math.round((W - c128Width(l.code, narrow)) / 2));
      var d = cut(l.desc, maxChars), c = cut(l.code + (l.sub ? '  ' + l.sub : ''), maxChars + 4);
      var price = '';
      if (l.price) {
        var bmp = cfg.priceImg !== false ? priceBitmap(l.price, W, pH) : null;
        if (bmp) {
          price = 'BITMAP ' + bmp.x + ',' + pTop + ',' + bmp.wb + ',' + bmp.h + ',0,' + bmp.data + '\r\n';
        } else {
          // Sin imagen: letra interna más grande (fuente 5) por si la impresora sí la escala.
          var pw = l.price.length * 32, px = Math.max(4, Math.round((W - pw) / 2));
          price = 'TEXT ' + px + ',' + pTop + ',"5",0,1,1,"' + l.price + '"\r\nTEXT ' + (px + 1) + ',' + pTop + ',"5",0,1,1,"' + l.price + '"\r\n';
        }
      }
      out += 'CLS\r\n' +
        'TEXT ' + Math.max(4, Math.round((W - d.length * 12) / 2)) + ',' + descY + ',"2",0,1,1,"' + d + '"\r\n' +
        price +
        'BARCODE ' + x + ',' + bcY + ',"128",' + bh + ',0,0,' + narrow + ',' + narrow + ',"' + l.code + '"\r\n' +
        'TEXT ' + Math.max(4, Math.round((W - c.length * 12) / 2)) + ',' + (bcY + bh + 3) + ',"2",0,1,1,"' + c + '"\r\n' +
        'PRINT 1,1\r\n';
    });
    return out;
  }

  function toBase64(str) {
    var bytes = new Uint8Array(str.length);
    for (var i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i) & 0xFF;
    var bin = '', CH = 0x8000;
    for (var j = 0; j < bytes.length; j += CH) bin += String.fromCharCode.apply(null, bytes.subarray(j, j + CH));
    return btoa(bin);
  }

  // Manda las etiquetas a la impresora configurada (en bloques de 50).
  function print(labels, cfg) {
    cfg = cfg || config();
    if (!cfg.printer) return Promise.reject(new Error('Elige la impresora de etiquetas'));
    var chunks = [];
    for (var i = 0; i < labels.length; i += 50) chunks.push(labels.slice(i, i + 50));
    return chunks.reduce(function (p, chunk, k) {
      return p.then(function () {
        return agentFetch('/print', {
          method: 'POST',
          body: JSON.stringify({ printer: cfg.printer, name: 'Etiquetas ' + (k + 1) + '/' + chunks.length, data: toBase64(build(cfg, chunk)) })
        }, 15000);
      });
    }, Promise.resolve());
  }
  function test(cfg) {
    return print([{ code: 'PRUEBA01', desc: 'Prueba de etiqueta', price: 1250 }], cfg);
  }

  return { config: config, setConfig: setConfig, status: status, print: print, test: test, guess: guess, looksLikeLabel: looksLikeLabel, isEva: isEva, build: build, priceText: priceText, priceBitmap: priceBitmap };
})();
/* ---------------------------------------------------------------- items.js */
/* =========================================================
   INVENTARIO → Artículos (como el catálogo de artículos de SICAR)
     GET    /api/inventario/articulos            → { items, departamentos }
     POST   /api/inventario/articulos            agregar
     PUT    /api/inventario/articulos/:id        editar (no cambia existencia)
     DELETE /api/inventario/articulos/:id        eliminar (existencia 0)
     POST   /api/inventario/articulos/:id/ajustar  { modo, cantidad, comentario }
     POST   /api/inventario/categorias           nueva categoría
   Atajos: F2 buscar · F3 agregar · F4 editar · F5 recargar ·
           F6 eliminar · F8 ajustar · F9 clonar · ↑/↓ moverse · Enter editar
   ========================================================= */
(function () {
  var I = window.Inv;
  if (!I || !I.$('invArticulos')) return;
  var $ = I.$, esc = I.esc, mxn = I.mxn;

  var PAGE = 60;
  var UNIDADES = ['PZA', 'PAR', 'CAJA', 'PAQ', 'JGO', 'KIT', 'ML', 'SERV'];
  var items = [], deps = [], byId = {};
  var filtered = [], page = 1, selectedId = null;
  var f = { q: '', dep: '', cat: '', estado: '' };
  var loading = false;

  /* ---------- estado de existencia ---------- */
  function estadoOf(a) {
    if (a.servicio) return 'servicio';
    if (a.existencia <= 0) return 'agotado';
    if (a.minimo > 0 && a.existencia <= a.minimo) return 'bajo';
    if (a.maximo > 0 && a.existencia > a.maximo) return 'sobre';
    return 'ok';
  }
  function utilidad(compra, precio) {
    if (!(compra > 0) || !(precio > 0)) return null;
    return (precio / compra - 1) * 100;
  }

  /* ---------- carga ---------- */
  function load(keepSelection) {
    if (loading) return Promise.resolve();
    loading = true;
    $('invBody').classList.add('is-loading');
    return I.api('/api/inventario/articulos').then(function (d) {
      items = d.items || [];
      deps = d.departamentos || [];
      byId = {};
      items.forEach(function (a) { byId[a.id] = a; });
      if (!keepSelection || !byId[selectedId]) selectedId = null;
      buildFilterSelects();
      renderStats();
      apply(true);
    }).catch(function (err) {
      $('invCaption').textContent = err.message;
      I.toast(err.message, 'error');
    }).finally(function () {
      loading = false;
      $('invBody').classList.remove('is-loading');
    });
  }

  function renderStats() {
    var piezas = 0, costo = 0, venta = 0, bajo = 0, agot = 0, arts = 0;
    items.forEach(function (a) {
      arts++;
      var st = estadoOf(a);
      if (st === 'bajo') bajo++;
      if (st === 'agotado') agot++;
      if (!a.servicio && a.existencia > 0) {
        piezas += a.existencia;
        costo += a.existencia * a.precio_compra;
        venta += a.existencia * a.precio_1;
      }
    });
    $('stArticulos').textContent = I.num(arts);
    $('stPiezas').textContent = I.num(piezas);
    if ($('stCosto')) $('stCosto').textContent = mxn.format(costo);
    $('stVenta').textContent = mxn.format(venta);
    $('stBajo').textContent = I.num(bajo);
    $('stAgotados').textContent = I.num(agot);
  }

  /* ---------- filtros ---------- */
  var depSel = I.select($('fDepartamento'), { placeholder: 'Todos los departamentos', onChange: function (v) { f.dep = v; f.cat = ''; buildCatFilter(); apply(); } });
  var catSel = I.select($('fCategoria'), { placeholder: 'Todas las categorías', onChange: function (v) { f.cat = v; apply(); } });
  function buildFilterSelects() {
    depSel.setOptions([{ value: '', label: 'Todos los departamentos' }].concat(deps.map(function (d) {
      return { value: String(d.id), label: d.nombre, hint: d.articulos + (d.articulos === 1 ? ' artículo' : ' artículos') };
    })));
    if (f.dep && !deps.some(function (d) { return String(d.id) === f.dep; })) f.dep = '';
    depSel.set(f.dep, true);
    buildCatFilter();
  }
  function buildCatFilter() {
    var dep = deps.filter(function (d) { return String(d.id) === f.dep; })[0];
    var cats = [];
    (dep ? [dep] : deps).forEach(function (d) {
      d.categorias.forEach(function (c) { cats.push({ id: c.id, nombre: c.nombre, articulos: c.articulos, dep: d.nombre }); });
    });
    catSel.setOptions([{ value: '', label: 'Todas las categorías' }].concat(cats.map(function (c) {
      return { value: String(c.id), label: c.nombre, hint: dep ? c.articulos + ' art.' : c.dep };
    })));
    if (f.cat && !cats.some(function (c) { return String(c.id) === f.cat; })) f.cat = '';
    catSel.set(f.cat, true);
  }
  $('invSearch').addEventListener('input', I.debounce(function () {
    var v = this.value.trim();
    // Si escanean / escriben un número de rastreo (AVT000123) se busca su artículo.
    if (I.isRastreo(v)) { findRastreo(v); return; }
    f.q = this.value; apply();
  }, 120));
  function findRastreo(num) {
    I.lookupRastreo(num).then(function (d) {
      if (!d.articulo || !byId[d.articulo.id]) { I.toast(num.toUpperCase() + ' es de un artículo que ya no existe.', 'error'); return; }
      $('invSearch').value = ''; f.q = '';
      selectedId = d.articulo.id;
      apply(); revealSelected();
      var p = d.pieza, st = { disponible: 'disponible', vendida: 'vendida' + (p.venta_id ? ' (ticket ' + p.venta_id + ')' : ''), baja: 'dada de baja' }[p.estado] || p.estado;
      I.toast(p.numero + ' · ' + d.articulo.descripcion + ' · ' + st + '.');
    }).catch(function (e) { I.toast(e.message, 'error'); });
  }
  $('fEstado').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-estado]');
    if (!b) return;
    setEstado(b.getAttribute('data-estado'));
  });
  function setEstado(v) {
    f.estado = v;
    Array.prototype.forEach.call($('fEstado').querySelectorAll('button'), function (x) { x.classList.toggle('is-on', x.getAttribute('data-estado') === v); });
    apply();
  }
  document.querySelectorAll('[data-goto]').forEach(function (b) {
    b.addEventListener('click', function () {
      setEstado(f.estado === b.getAttribute('data-goto') ? '' : b.getAttribute('data-goto'));
      $('invTable').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  });

  function apply(keepPage) {
    var words = I.norm(f.q).split(/\s+/).filter(Boolean);
    filtered = items.filter(function (a) {
      if (f.dep && String(a.departamento_id) !== f.dep) return false;
      if (f.cat && String(a.categoria_id) !== f.cat) return false;
      if (f.estado && estadoOf(a) !== f.estado) return false;
      if (words.length) {
        var hay = I.norm(a.clave + ' ' + a.clave_alterna + ' ' + a.descripcion + ' ' + a.localizacion + ' ' + (a.color_principal || '') + ' ' + (a.colores_extra || []).join(' ') + ' ' + tipoNombre(a.tipo_armazon || '') + ' ' + (a.materiales || []).join(' '));
        for (var i = 0; i < words.length; i++) if (hay.indexOf(words[i]) === -1) return false;
      }
      return true;
    });
    // Coincidencia exacta de clave primero (como escanear el código).
    if (words.length === 1) {
      var w = words[0];
      filtered.sort(function (x, y) {
        var ex = I.norm(x.clave) === w || I.norm(x.clave_alterna) === w ? 0 : 1;
        var ey = I.norm(y.clave) === w || I.norm(y.clave_alterna) === w ? 0 : 1;
        return ex - ey;
      });
    }
    if (!keepPage) page = 1;
    var pages = Math.max(1, Math.ceil(filtered.length / PAGE));
    if (page > pages) page = pages;
    // Si lo elegido ya no se ve, se elige el primero.
    if (!filtered.some(function (a) { return a.id === selectedId; })) selectedId = filtered.length ? filtered[0].id : null;
    render();
  }

  /* ---------- tabla ---------- */
  function existCell(a) {
    if (a.servicio) return '<span class="inv-exist is-serv" title="Servicio">Serv.</span>';
    var st = estadoOf(a);
    var cls = st === 'agotado' ? ' is-out' : st === 'bajo' ? ' is-low' : st === 'sobre' ? ' is-over' : '';
    var title = st === 'agotado' ? 'Agotado' : st === 'bajo' ? 'Bajo mínimo (' + a.minimo + ')' : st === 'sobre' ? 'Sobre máximo (' + a.maximo + ')' : '';
    return '<span class="inv-exist' + cls + '"' + (title ? ' title="' + title + '"' : '') + '>' + I.num(a.existencia) + '</span>';
  }
  function render() {
    var total = filtered.length;
    var pages = Math.max(1, Math.ceil(total / PAGE));
    var start = (page - 1) * PAGE;
    var rows = filtered.slice(start, start + PAGE);
    $('invBody').innerHTML = rows.map(function (a, i) {
      return '<tr data-id="' + a.id + '" class="' + (a.id === selectedId ? 'is-selected' : '') + '" style="--i:' + Math.min(i, 20) + '" tabindex="-1">' +
        '<td class="inv-cell-art"><div class="inv-art-line">' +
          (a.foto ? '<img class="inv-thumb" src="' + esc(a.foto) + '" alt="" loading="lazy">' : '<span class="inv-thumb is-empty" aria-hidden="true"></span>') +
          '<div><span class="inv-clave">' + esc(a.clave || '—') + (a.clave_alterna ? '<em> / ' + esc(a.clave_alterna) + '</em>' : '') + '</span>' +
          '<strong>' + esc(a.descripcion) + '</strong></div></div></td>' +
        '<td class="c-dep"><span>' + esc(a.departamento || 'Sin departamento') + '</span>' + (a.categoria ? '<small>' + esc(a.categoria) + '</small>' : '') + '</td>' +
        '<td class="num">' + existCell(a) + '</td>' +
        '<td class="num inv-price">' + mxn.format(a.precio_1) + '</td>' +
      '</tr>';
    }).join('');
    var empty = $('invEmpty');
    empty.hidden = total > 0;
    if (!total) empty.textContent = items.length ? 'No hay artículos con esos filtros.' : 'Todavía no hay artículos. Agrega el primero con «Agregar» (F3).';
    $('invCaption').textContent = total === items.length
      ? I.num(total) + (total === 1 ? ' artículo' : ' artículos')
      : I.num(total) + ' de ' + I.num(items.length) + ' artículos';
    $('invPager').hidden = pages <= 1;
    $('pgLabel').textContent = 'Página ' + page + ' de ' + pages;
    $('pgPrev').disabled = page <= 1;
    $('pgNext').disabled = page >= pages;
    renderDetail();
  }
  $('pgPrev').addEventListener('click', function () { if (page > 1) { page--; render(); } });
  $('pgNext').addEventListener('click', function () { page++; render(); });

  $('invBody').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    select(Number(tr.getAttribute('data-id')));
    if (window.matchMedia('(max-width: 1000px)').matches) openSheet();
  });
  $('invBody').addEventListener('dblclick', function (e) {
    var tr = e.target.closest('tr[data-id]');
    if (tr) openEdit(byId[Number(tr.getAttribute('data-id'))]);
  });
  function select(id) {
    selectedId = id;
    Array.prototype.forEach.call($('invBody').querySelectorAll('tr'), function (tr) {
      tr.classList.toggle('is-selected', Number(tr.getAttribute('data-id')) === id);
    });
    renderDetail();
  }
  function moveSelection(delta) {
    if (!filtered.length) return;
    var idx = filtered.findIndex(function (a) { return a.id === selectedId; });
    idx = Math.max(0, Math.min(filtered.length - 1, (idx < 0 ? 0 : idx + delta)));
    var newPage = Math.floor(idx / PAGE) + 1;
    selectedId = filtered[idx].id;
    if (newPage !== page) { page = newPage; render(); } else select(selectedId);
    var tr = $('invBody').querySelector('tr.is-selected');
    if (tr) tr.scrollIntoView({ block: 'nearest' });
  }

  /* ---------- artículo seleccionado ---------- */
  function current() { return selectedId ? byId[selectedId] : null; }
  function renderDetail() {
    var a = current();
    ['tbEditar', 'tbEliminar', 'tbAjustar', 'tbClonar'].forEach(function (id) { $(id).disabled = !a; });
    $('tbAjustar').disabled = !a || a.servicio;
    $('tbEtiquetas').disabled = !a;
    var kx = $('tbKardex');
    kx.href = a ? I.base + '/movimientos?item=' + a.id : I.base + '/movimientos';
    kx.setAttribute('aria-disabled', a ? 'false' : 'true');
    $('invDetailEmpty').hidden = !!a;
    var body = $('invDetailBody');
    body.hidden = !a;
    if (!a) return;
    var st = estadoOf(a);
    var stLabel = { servicio: 'Servicio', agotado: 'Agotado', bajo: 'Bajo mínimo', sobre: 'Sobre máximo', ok: 'En existencia' }[st];
    var u1 = I.canCost ? utilidad(a.precio_compra, a.precio_1) : null;
    var bar = '';
    if (!a.servicio && (a.minimo > 0 || a.maximo > 0)) {
      var top = Math.max(a.maximo || 0, a.minimo * 2 || 0, a.existencia, 1);
      var pct = Math.max(0, Math.min(100, a.existencia / top * 100));
      var minPct = a.minimo > 0 ? Math.min(100, a.minimo / top * 100) : null;
      bar = '<div class="inv-stockbar is-' + st + '"><i style="width:' + pct + '%"></i>' +
        (minPct != null ? '<b style="left:' + minPct + '%" title="Mínimo ' + a.minimo + '"></b>' : '') + '</div>' +
        '<div class="inv-stockbar-legend"><span>Mín. ' + (a.minimo || '—') + '</span><span>Máx. ' + (a.maximo || '—') + '</span></div>';
    }
    var otros = [2, 3, 4].filter(function (n) { return a['precio_' + n] > 0; }).map(function (n) {
      var m = a['mayoreo_' + n];
      var g = I.canCost && a.precio_compra > 0 ? a['precio_' + n] - a.precio_compra : null;
      return '<div class="inv-d-row"><span>Precio ' + n + (m > 0 ? ' <small>desde ' + m + ' ' + esc(a.unidad_venta.toLowerCase()) + '</small>' : '') + '</span><strong>' + mxn.format(a['precio_' + n]) +
        (g != null ? ' <small class="inv-d-gan' + (g < 0 ? ' is-neg' : '') + '">' + (g >= 0 ? '+' : '−') + mxn.format(Math.abs(g)) + '</small>' : '') + '</strong></div>';
    }).join('');
    // Solo admin: utilidad y ganancia por producto.
    var profit = '';
    if (I.canCost) {
      if (a.precio_compra > 0 && a.precio_1 > 0) {
        var gan = a.precio_1 - a.precio_compra;
        var margen = gan / a.precio_1 * 100;
        var neg = gan < 0 ? ' is-neg' : '';
        var sg = function (v) { return (v >= 0 ? '+' : '−') + mxn.format(Math.abs(v)); };
        profit = '<div class="inv-d-profit' + neg + '">' +
          '<div class="inv-d-profit-main"><small>Ganancia por ' + esc(!a.unidad_venta || /^(pza|pz|pieza)$/i.test(a.unidad_venta) ? 'pieza' : a.unidad_venta.toLowerCase()) + '</small><strong>' + sg(gan) + '</strong></div>' +
          '<div class="inv-d-profit-grid">' +
            '<div><small>Utilidad</small><strong>' + (u1 >= 0 ? '+' : '') + I.round2(u1).toFixed(1) + ' %</strong><em>sobre costo</em></div>' +
            '<div><small>Margen</small><strong>' + I.round2(margen).toFixed(1) + ' %</strong><em>sobre venta</em></div>' +
            (!a.servicio && a.existencia > 0 ? '<div class="is-wide"><small>Ganancia de la existencia</small><strong>' + sg(gan * a.existencia) + '</strong><em>' + I.num(a.existencia) + ' × ' + mxn.format(gan) + '</em></div>' : '') +
          '</div>' +
        '</div>';
      } else {
        profit = '<div class="inv-d-profit is-empty"><small>Utilidad y ganancia</small><span>Captura el precio de compra para ver cuánto se gana por este artículo.</span></div>';
      }
    }
    body.innerHTML =
      '<button type="button" class="inv-sheet-close" data-sheet-close aria-label="Cerrar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>' +
      (a.foto ? '<button type="button" class="inv-d-photo" data-act="fotos" title="Ver / cambiar fotos"><img src="' + esc(a.foto) + '" alt=""></button>' : '') +
      '<small class="inv-d-kicker">Artículo seleccionado</small>' +
      '<h2 class="inv-d-title">' + esc(a.descripcion) + '</h2>' +
      '<p class="inv-d-claves"><span>' + esc(a.clave || '—') + '</span>' + (a.clave_alterna ? '<span>' + esc(a.clave_alterna) + '</span>' : '') + '</p>' +
      '<div class="inv-d-price"><small>Precio de venta' + (a.iva ? ' (con IVA)' : '') + '</small><strong>' + mxn.format(a.precio_1) + '</strong>' +
        (u1 != null ? '<span class="inv-d-util">' + (u1 >= 0 ? '+' : '') + I.round2(u1).toFixed(1) + ' % sobre costo</span>' : '') + '</div>' +
      '<div class="inv-d-stock is-' + st + '">' +
        '<div><small>Cantidad disponible</small><strong>' + (a.servicio ? '—' : I.num(a.existencia)) + '</strong><em>' + esc(a.unidad_venta) + '</em></div>' +
        '<span class="inv-d-chip is-' + st + '">' + stLabel + '</span>' +
      '</div>' + bar + profit +
      '<div class="inv-d-rows">' +
        '<div class="inv-d-row"><span>Departamento</span><strong>' + esc(a.departamento || '—') + '</strong></div>' +
        '<div class="inv-d-row"><span>Categoría</span><strong>' + esc(a.categoria || '—') + '</strong></div>' +
        '<div class="inv-d-row"><span>Localización</span><strong>' + esc(a.localizacion || '—') + '</strong></div>' +
        (a.tipo_armazon ? '<div class="inv-d-row"><span>Tipo de armazón</span><strong>' + esc(tipoNombre(a.tipo_armazon)) + '</strong></div>' : '') +
        (a.materiales && a.materiales.length ? '<div class="inv-d-row"><span>Material</span><strong>' + esc(matsTxt(a.materiales)) + '</strong></div>' : '') +
        (a.mica_tipo ? '<div class="inv-d-row"><span>Mica</span><strong>' + esc(MICA_TXT[a.mica_tipo] || a.mica_tipo) + '</strong></div>' : '') +
        (a.color_principal ? '<div class="inv-d-row"><span>Color</span><strong class="inv-d-color"><i style="' + swatchStyle([a.color_principal].concat(a.colores_extra || [])) + '"></i>' + esc(colorTxt(a.color_principal, a.colores_extra || [])) + '</strong></div>' : '') +
        (I.canCost ? '<div class="inv-d-row"><span>Precio de compra</span><strong>' + mxn.format(a.precio_compra) + '</strong></div>' : '') +
        otros +
        (a.factor > 1 || a.unidad_compra !== a.unidad_venta ? '<div class="inv-d-row"><span>Compra / venta</span><strong>1 ' + esc(a.unidad_compra) + ' = ' + I.num(a.factor) + ' ' + esc(a.unidad_venta) + '</strong></div>' : '') +
      '</div>' +
      '<div class="inv-d-actions">' +
        (a.servicio ? '' : '<button type="button" class="btn solid small" data-act="ajustar">Ajustar existencia</button>') +
        '<button type="button" class="btn small" data-act="etiquetas">Imprimir etiquetas</button>' +
        '<a class="btn small" href="' + I.base + '/movimientos?item=' + a.id + '">Ver movimientos</a>' +
        '<button type="button" class="btn small" data-act="fotos">' + (a.foto ? 'Fotos' : 'Agregar fotos') + '</button>' +
      '</div>';
  }
  $('invDetailBody').addEventListener('click', function (e) {
    if (e.target.closest('[data-sheet-close]')) { closeSheet(); return; }
    var b = e.target.closest('[data-act]');
    if (b && b.getAttribute('data-act') === 'ajustar') { closeSheet(); openAjuste(current()); }
    if (b && b.getAttribute('data-act') === 'rastreo') { closeSheet(); openRastreo(current()); }
    if (b && b.getAttribute('data-act') === 'etiquetas') { closeSheet(); openEtiquetas(current()); }
    if (b && b.getAttribute('data-act') === 'fotos') { closeSheet(); openEdit(current()); setTab('fotos'); }
  });
  // Celular: el detalle sale como hoja desde abajo.
  var backdrop = document.createElement('div');
  backdrop.className = 'inv-sheet-backdrop';
  document.body.appendChild(backdrop);
  backdrop.addEventListener('click', closeSheet);
  function openSheet() { $('invDetail').classList.add('is-sheet-open'); backdrop.classList.add('is-on'); }
  function closeSheet() { $('invDetail').classList.remove('is-sheet-open'); backdrop.classList.remove('is-on'); }

  /* =======================================================
     MODAL: agregar / editar / clonar
     ======================================================= */
  var artModal = $('artModal'), artForm = $('artForm');
  var editing = null; // artículo que se edita (null = nuevo)
  var formDep = '', formCat = '';
  var aDep = I.select($('aDepartamento'), { placeholder: 'Sin departamento', onChange: function (v) { formDep = v; formCat = ''; buildFormCats(); } });
  var aCat = I.select($('aCategoria'), { placeholder: 'Sin categoría', onChange: function (v) { formCat = v; } });
  var unitOpts = UNIDADES.map(function (u) { return { value: u, label: u }; });
  var aUC = I.select($('aUCompra'), { options: unitOpts, value: 'PZA' });
  var aUV = I.select($('aUVenta'), { options: unitOpts, value: 'PZA' });

  /* ---------- Armazón: tipo (estilos del probador virtual) y color ---------- */
  var tiposArm = [], colores = [], formTipo = '', colPrin = '', colExtra = [], formMica = '', newColor = '';
  var materiales = [], formMats = [], newMat = '';
  function matsTxt(list) { return list.length > 1 ? list.slice(0, -1).join(', ') + ' y ' + list[list.length - 1] : (list[0] || ''); }
  function renderMats() {
    var list = materiales.map(function (m) { return m.nombre; });
    formMats.forEach(function (n) { if (!list.some(function (x) { return x.toLowerCase() === n.toLowerCase(); })) list.push(n); });
    $('aMats').innerHTML = list.map(function (n) {
      var i = formMats.map(function (x) { return x.toLowerCase(); }).indexOf(n.toLowerCase());
      var nuevo = newMat && n.toLowerCase() === newMat.toLowerCase();
      return '<button type="button" class="inv-sw inv-mat' + (i >= 0 ? ' is-main' : '') + (nuevo ? ' is-new' : '') + '" data-mat="' + esc(n) + '">' +
        '<i>' + (i >= 0 ? '✓' : '') + '</i><span>' + esc(n) + '</span></button>';
    }).join('') + '<button type="button" class="inv-sw is-add" data-mat-new title="Agregar un material"><i>+</i><span>Nuevo</span></button>';
    newMat = '';
  }
  $('aMats').addEventListener('click', function (e) {
    if (e.target.closest('[data-mat-new]')) { $('aMatNew').hidden = false; $('aMatName').focus(); return; }
    var b = e.target.closest('[data-mat]');
    if (!b) return;
    var n = b.getAttribute('data-mat'), i = formMats.map(function (x) { return x.toLowerCase(); }).indexOf(n.toLowerCase());
    if (i >= 0) formMats.splice(i, 1);
    else if (formMats.length < 4) formMats.push(n);
    else { I.toast('Máximo 4 materiales.', 'error'); return; }
    renderMats();
  });
  function closeMatNew() {
    var box = $('aMatNew');
    if (box.hidden) return;
    box.classList.add('is-closing');
    setTimeout(function () { box.hidden = true; box.classList.remove('is-closing'); $('aMatName').value = ''; }, 200);
  }
  $('aMatCancel').addEventListener('click', closeMatNew);
  $('aMatName').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); $('aMatAdd').click(); } });
  $('aMatAdd').addEventListener('click', function () {
    var name = $('aMatName').value.trim(), btn = this;
    if (!name) { $('aMatName').focus(); return; }
    btn.disabled = true;
    I.api('/api/inventario/materiales', { method: 'POST', body: { nombre: name } }).then(function (d) {
      materiales.push(d.item);
      newMat = d.item.nombre;
      if (formMats.length < 4) formMats.push(d.item.nombre);
      closeMatNew();
      renderMats();
      I.toast('Material «' + d.item.nombre + '» agregado a la lista.');
    }).catch(function (err) { I.toast(err.message, 'error'); })
      .finally(function () { btn.disabled = false; });
  });
  var MICA_TXT = { oftalmico: 'Oftálmico', sol: 'De sol' };
  function setMica(v) {
    formMica = v || '';
    Array.prototype.forEach.call($('aMica').querySelectorAll('button[data-mica]'), function (b) {
      var on = b.getAttribute('data-mica') === formMica;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }
  $('aMica').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-mica]');
    if (b) setMica(b.getAttribute('data-mica'));
  });
  var aTipo = I.select($('aTipoArm'), { placeholder: 'Sin tipo', onChange: function (v) { formTipo = v; } });
  function tipoNombre(slug) { var t = tiposArm.filter(function (x) { return x.slug === slug; })[0]; return t ? t.nombre : (slug ? slug + ' (ya no está en la lista)' : ''); }
  function buildTipos() {
    var opts = [{ value: '', label: 'Sin tipo' }].concat(tiposArm.map(function (t) { return { value: t.slug, label: t.nombre }; }));
    if (formTipo && !tiposArm.some(function (t) { return t.slug === formTipo; })) opts.push({ value: formTipo, label: tipoNombre(formTipo) });
    aTipo.setOptions(opts);
    aTipo.set(formTipo, true);
  }
  function loadArmazonData() {
    // Solo ópticas: tipos de armazón, paleta de colores y materiales.
    if (!I.optica) return Promise.resolve();
    return Promise.all([
      I.api('/api/inventario/tipos-armazon').then(function (d) { tiposArm = d.items || []; }).catch(function () {}),
      I.api('/api/inventario/colores').then(function (d) { colores = d.items || []; }).catch(function () {}),
      I.api('/api/inventario/materiales').then(function (d) { materiales = d.items || []; }).catch(function () {})
    ]).then(function () { buildTipos(); renderPalette(); renderMats(); if (current()) renderDetail(); });
  }
  function hexOf(name) { var c = colores.filter(function (x) { return x.nombre.toLowerCase() === String(name).toLowerCase(); })[0]; return c ? c.hex : '#9aa0bb'; }
  // Muestra redonda: un color o la combinación en rebanadas.
  function swatchStyle(list) {
    if (!list.length) return '';
    if (list.length === 1) return 'background:' + hexOf(list[0]);
    var step = 100 / list.length;
    return 'background:conic-gradient(' + list.map(function (n, i) { return hexOf(n) + ' ' + (i * step) + '% ' + ((i + 1) * step) + '%'; }).join(',') + ')';
  }
  function colorTxt(p, ex) {
    if (!p) return '';
    return p + (ex.length ? ' con ' + (ex.length === 2 ? ex[0] + ' y ' + ex[1] : ex[0]) : '');
  }
  function renderPalette() {
    var all = [colPrin].concat(colExtra).filter(Boolean);
    // Colores guardados que ya no están en la paleta también se muestran.
    var list = colores.slice();
    all.forEach(function (n) { if (!list.some(function (c) { return c.nombre.toLowerCase() === n.toLowerCase(); })) list.push({ nombre: n, hex: '#9aa0bb' }); });
    $('aPalette').innerHTML = list.map(function (c) {
      var isP = colPrin && c.nombre.toLowerCase() === colPrin.toLowerCase();
      var xi = colExtra.map(function (x) { return x.toLowerCase(); }).indexOf(c.nombre.toLowerCase());
      var nuevo = newColor && c.nombre.toLowerCase() === newColor.toLowerCase();
      return '<button type="button" class="inv-sw' + (isP ? ' is-main' : xi >= 0 ? ' is-extra' : '') + (nuevo ? ' is-new' : '') + '" data-color="' + esc(c.nombre) + '" title="' + esc(c.nombre) + '">' +
        '<i style="background:' + esc(c.hex) + '"></i><span>' + esc(c.nombre) + '</span>' +
        (isP ? '<b>1</b>' : xi >= 0 ? '<b>' + (xi + 2) + '</b>' : '') + '</button>';
    }).join('') + '<button type="button" class="inv-sw is-add" data-color-new title="Agregar un color"><i>+</i><span>Nuevo</span></button>';
    newColor = '';
    var sumEl = $('aColorSum');
    sumEl.classList.remove('is-swap'); void sumEl.offsetWidth; sumEl.classList.add('is-swap');
    $('aColorSum').innerHTML = colPrin
      ? '<span class="inv-sw-big" style="' + swatchStyle(all) + '"></span><span><strong>' + esc(colorTxt(colPrin, colExtra)) + '</strong><small>' + (colExtra.length ? 'Combinado' : 'Un solo color') + ' · toca un color para quitarlo</small></span>'
      : '<span class="inv-sw-big is-empty"></span><span><strong>Sin color</strong><small>Toca el color principal; si es combinado, toca hasta 2 más.</small></span>';
  }
  $('aPalette').addEventListener('click', function (e) {
    if (e.target.closest('[data-color-new]')) { $('aColorNew').hidden = false; $('aColorName').focus(); return; }
    var b = e.target.closest('[data-color]');
    if (!b) return;
    var n = b.getAttribute('data-color'), low = n.toLowerCase();
    var xi = colExtra.map(function (x) { return x.toLowerCase(); }).indexOf(low);
    if (colPrin && colPrin.toLowerCase() === low) { colPrin = colExtra.shift() || ''; }
    else if (xi >= 0) { colExtra.splice(xi, 1); }
    else if (!colPrin) { colPrin = n; }
    else if (colExtra.length < 2) { colExtra.push(n); }
    else { I.toast('Máximo 2 colores además del principal. Quita uno para cambiarlo.', 'error'); return; }
    renderPalette();
  });
  $('aColorCancel').addEventListener('click', function () { closeColorNew(); });
  // El cuadro de "color nuevo" se abre y se cierra con animación.
  function closeColorNew() {
    var box = $('aColorNew');
    if (box.hidden) return;
    box.classList.add('is-closing');
    setTimeout(function () { box.hidden = true; box.classList.remove('is-closing'); $('aColorName').value = ''; }, 200);
  }
  $('aColorName').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); $('aColorAdd').click(); } });
  $('aColorAdd').addEventListener('click', function () {
    var name = $('aColorName').value.trim(), btn = this;
    if (!name) { $('aColorName').focus(); return; }
    btn.disabled = true;
    I.api('/api/inventario/colores', { method: 'POST', body: { nombre: name, hex: $('aColorHex').value } }).then(function (d) {
      colores.push(d.item);
      newColor = d.item.nombre;
      if (!colPrin) colPrin = d.item.nombre; else if (colExtra.length < 2) colExtra.push(d.item.nombre);
      closeColorNew();
      renderPalette();
      I.toast('Color «' + d.item.nombre + '» agregado a la lista.');
    }).catch(function (err) { I.toast(err.message, 'error'); })
      .finally(function () { btn.disabled = false; });
  });

  function buildFormDeps() {
    aDep.setOptions([{ value: '', label: 'Sin departamento' }].concat(deps.map(function (d) { return { value: String(d.id), label: d.nombre }; })));
    aDep.set(formDep, true);
    buildFormCats();
  }
  function buildFormCats() {
    var dep = deps.filter(function (d) { return String(d.id) === formDep; })[0];
    var opts = [{ value: '', label: 'Sin categoría' }];
    if (dep) opts = opts.concat(dep.categorias.map(function (c) { return { value: String(c.id), label: c.nombre }; }));
    opts.push({ value: '__new', label: '+ Nueva categoría…', action: function () { openCatModal(formDep); } });
    aCat.setOptions(opts);
    aCat.set(formCat, true);
  }

  // Tabs
  var tabs = artModal.querySelectorAll('.inv-tab');
  function setTab(name) {
    tabs.forEach(function (t) { t.classList.toggle('is-on', t.getAttribute('data-tab') === name); });
    artModal.querySelectorAll('.inv-tabpane').forEach(function (p) { p.classList.toggle('is-on', p.getAttribute('data-pane') === name); });
    var on = artModal.querySelector('.inv-tab.is-on'), glow = $('artTabsGlow');
    if (on && glow) { glow.style.width = on.offsetWidth + 'px'; glow.style.transform = 'translateX(' + on.offsetLeft + 'px)'; }
  }
  tabs.forEach(function (t) { t.addEventListener('click', function () { setTab(t.getAttribute('data-tab')); }); });

  // Precios 1 a 4: % utilidad ↔ precio de venta neto
  var pricesEl = $('aPrices');
  pricesEl.classList.toggle('is-nocost', !I.canCost);
  pricesEl.innerHTML = [1, 2, 3, 4].map(function (n) {
    return '<div class="inv-price-row' + (n === 1 ? ' is-main' : '') + '" data-n="' + n + '">' +
      '<div class="inv-price-name"><strong>Precio ' + n + '</strong><small>' + (n === 1 ? 'Público' : 'Mayoreo / especial') + '</small></div>' +
      (I.canCost ? '<label class="inv-price-field"><span>% Utilidad</span><span class="inv-pct"><input type="number" step="0.01" inputmode="decimal" data-util placeholder="0"><em>%</em></span></label>' : '') +
      '<label class="inv-price-field"><span>Precio venta neto</span><span class="inv-money"><span>$</span><input type="number" min="0" step="0.01" inputmode="decimal" data-precio placeholder="0.00"></span></label>' +
      (n === 1 ? '<div class="inv-price-field is-static"><span>Sin IVA</span><b data-siniva>$0.00</b></div>'
               : '<label class="inv-price-field"><span>Desde (piezas)</span><input type="number" min="0" step="1" inputmode="numeric" data-mayoreo placeholder="0"></label>') +
    '</div>';
  }).join('');
  function priceRow(n) { return pricesEl.querySelector('[data-n="' + n + '"]'); }
  // Solo el admin pone el precio de compra (sin él no hay % de utilidad).
  function compra() { return $('aCompra') ? (parseFloat($('aCompra').value) || 0) : 0; }
  function syncSinIva() {
    var p = parseFloat(priceRow(1).querySelector('[data-precio]').value) || 0;
    priceRow(1).querySelector('[data-siniva]').textContent = mxn.format($('aIva').checked ? p / 1.16 : p);
  }
  function utilFromPrice(row) {
    var p = parseFloat(row.querySelector('[data-precio]').value);
    var u = utilidad(compra(), p);
    var uIn = row.querySelector('[data-util]');
    if (uIn) uIn.value = u == null ? '' : I.round2(u);
  }
  pricesEl.addEventListener('input', function (e) {
    var row = e.target.closest('.inv-price-row');
    if (!row) return;
    if (e.target.hasAttribute('data-util')) {
      var u = parseFloat(e.target.value);
      if (compra() > 0 && !isNaN(u)) row.querySelector('[data-precio]').value = I.round2(compra() * (1 + u / 100)).toFixed(2);
    } else if (e.target.hasAttribute('data-precio')) {
      utilFromPrice(row);
    }
    syncSinIva();
  });
  if ($('aCompra')) $('aCompra').addEventListener('input', function () {
    [1, 2, 3, 4].forEach(function (n) { utilFromPrice(priceRow(n)); });
    pricesEl.classList.toggle('no-cost', !(compra() > 0));
  });
  $('aIva').addEventListener('change', syncSinIva);

  function syncServicio() {
    var s = $('aServicio').checked;
    ['aExistencia', 'aMinimo', 'aMaximo'].forEach(function (id) { $(id).disabled = s || (id === 'aExistencia' && !!editing); });
    if (s) { $('aExistencia').value = ''; }
    // Attomos: no hay claves de rastreo por compra; la opción no se muestra.
    $('aSinRastreoWrap').hidden = true;
  }
  $('aServicio').addEventListener('change', syncServicio);
  ['aClave', 'aClaveAlt'].forEach(function (id) {
    $(id).addEventListener('input', function () {
      var pos = this.selectionStart;
      this.value = this.value.toUpperCase().replace(/\s/g, '-').replace(/[^A-Z0-9./-]/g, '');
      try { this.setSelectionRange(pos, pos); } catch (e) {}
    });
  });

  /* ---------- Fotos del artículo ----------
     Editando: cada cambio se guarda al momento.
     Agregando / clonando: se quedan en espera y se suben al guardar. */
  var MAX_FOTOS = 6;
  var fotosSaved = [], fotosQueue = [], fotosBusy = false;
  var fotosEl = $('aFotos'), fotoInput = $('aFotoInput');
  var ICON_STAR = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z"/></svg>';
  var ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';

  function fotosCount() { return fotosSaved.length + fotosQueue.length; }
  function renderFotos() {
    var html = fotosSaved.map(function (fo, i) {
      return '<figure class="inv-foto' + (i === 0 ? ' is-main' : '') + '" data-foto="' + fo.id + '">' +
        '<img src="' + esc(fo.url) + '" alt="" loading="lazy">' +
        (i === 0 ? '<span class="inv-foto-badge">Principal</span>'
          : '<button type="button" class="inv-foto-btn is-star" data-foto-main title="Hacer principal" aria-label="Hacer principal">' + ICON_STAR + '</button>') +
        '<button type="button" class="inv-foto-btn is-del" data-foto-del title="Quitar foto" aria-label="Quitar foto">' + ICON_X + '</button>' +
      '</figure>';
    }).join('') + fotosQueue.map(function (q, i) {
      var main = !fotosSaved.length && i === 0;
      return '<figure class="inv-foto is-queued' + (main ? ' is-main' : '') + '" data-queue="' + i + '">' +
        '<img src="' + q.url + '" alt="">' +
        (main ? '<span class="inv-foto-badge">Principal</span>'
          : '<button type="button" class="inv-foto-btn is-star" data-foto-main title="Hacer principal" aria-label="Hacer principal">' + ICON_STAR + '</button>') +
        '<button type="button" class="inv-foto-btn is-del" data-foto-del title="Quitar foto" aria-label="Quitar foto">' + ICON_X + '</button>' +
        '<span class="inv-foto-wait">Se sube al guardar</span>' +
      '</figure>';
    }).join('');
    if (fotosCount() < MAX_FOTOS) {
      html += '<button type="button" class="inv-foto-add" data-foto-add' + (fotosBusy ? ' disabled' : '') + '>' +
        (fotosBusy ? '<span class="inv-foto-spin"></span><span>Subiendo…</span>'
          : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>' +
            '<span>' + (fotosCount() ? 'Agregar foto' : 'Subir fotos') + '</span><small>' + fotosCount() + ' de ' + MAX_FOTOS + '</small>') +
      '</button>';
    }
    fotosEl.innerHTML = html;
    var cnt = $('aFotosCount');
    cnt.hidden = !fotosCount();
    cnt.textContent = fotosCount();
  }
  function clearQueue() {
    fotosQueue.forEach(function (q) { try { URL.revokeObjectURL(q.url); } catch (e) {} });
    fotosQueue = [];
  }
  function resetFotos(a, mode) {
    clearQueue();
    fotosSaved = [];
    fotosBusy = false;
    renderFotos();
    if (mode === 'edit' && a) {
      I.api('/api/inventario/articulos/' + a.id + '/fotos').then(function (d) {
        if (editing && editing.id === a.id) { fotosSaved = d.fotos || []; renderFotos(); }
      }).catch(function () {});
    }
  }

  // Reduce la foto en el navegador (máx. 1600 px, JPEG) antes de subirla.
  function shrink(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var MAX = 1600, w = img.naturalWidth, h = img.naturalHeight;
        var k = Math.min(1, MAX / Math.max(w, h));
        if (k === 1 && file.size < 900 * 1024 && /^image\/(jpeg|png|webp)$/.test(file.type)) { resolve(file); return; }
        var cv = document.createElement('canvas');
        cv.width = Math.round(w * k); cv.height = Math.round(h * k);
        var ctx = cv.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.drawImage(img, 0, 0, cv.width, cv.height);
        cv.toBlob(function (b) { b ? resolve(b) : reject(new Error('No se pudo leer la foto.')); }, 'image/jpeg', 0.86);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('«' + file.name + '» no es una foto que se pueda abrir (usa JPG, PNG o WEBP).')); };
      img.src = url;
    });
  }
  function uploadFotos(itemId, blobs) {
    var fd = new FormData();
    blobs.forEach(function (b, i) { fd.append('files', b, 'foto-' + (i + 1) + '.jpg'); });
    return fetch('/api/inventario/articulos/' + itemId + '/fotos', { method: 'POST', body: fd, credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          if (!r.ok) throw new Error(d.error || 'No se pudieron subir las fotos.');
          return d;
        });
      });
  }
  // Refleja la foto principal en la lista sin recargar todo.
  function syncMainFoto(itemId) {
    var a = byId[itemId];
    if (!a) return;
    a.foto = fotosSaved.length ? fotosSaved[0].url : '';
    render();
  }

  fotosEl.addEventListener('click', function (e) {
    if (e.target.closest('[data-foto-add]')) { fotoInput.click(); return; }
    var fig = e.target.closest('figure');
    if (!fig) return;
    var isDel = !!e.target.closest('[data-foto-del]'), isMain = !!e.target.closest('[data-foto-main]');
    if (!isDel && !isMain) return;
    if (fig.hasAttribute('data-queue')) {
      var qi = Number(fig.getAttribute('data-queue'));
      var q = fotosQueue.splice(qi, 1)[0];
      if (isDel) { try { URL.revokeObjectURL(q.url); } catch (e2) {} }
      else fotosQueue.unshift(q);
      renderFotos();
      return;
    }
    var fid = Number(fig.getAttribute('data-foto'));
    if (!editing) return;
    var itemId = editing.id;
    fig.classList.add('is-busy');
    var req = isDel
      ? I.api('/api/inventario/fotos/' + fid, { method: 'DELETE' })
      : I.api('/api/inventario/fotos/' + fid + '/principal', { method: 'POST' });
    req.then(function (d) {
      fotosSaved = d.fotos || [];
      renderFotos();
      syncMainFoto(itemId);
      I.toast(isDel ? 'Foto quitada.' : 'Foto principal cambiada.');
    }).catch(function (err) {
      fig.classList.remove('is-busy');
      I.toast(err.message, 'error');
    });
  });

  fotoInput.addEventListener('change', function () {
    var files = Array.prototype.slice.call(fotoInput.files || []);
    fotoInput.value = '';
    addFotoFiles(files);
  });

  // Arrastrar y soltar fotos en la pestaña Fotos.
  var fotosPane = fotosEl.closest('[data-pane="fotos"]') || fotosEl, dragDepth = 0;
  function hasFiles(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') !== -1; }
  fotosPane.addEventListener('dragenter', function (e) {
    if (!hasFiles(e)) return;
    e.preventDefault(); dragDepth++;
    fotosPane.classList.add('is-drop');
  });
  fotosPane.addEventListener('dragover', function (e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = fotosBusy || fotosCount() >= MAX_FOTOS ? 'none' : 'copy';
  });
  fotosPane.addEventListener('dragleave', function (e) {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) fotosPane.classList.remove('is-drop');
  });
  fotosPane.addEventListener('drop', function (e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0; fotosPane.classList.remove('is-drop');
    if (fotosBusy) return;
    if (fotosCount() >= MAX_FOTOS) { I.toast('Ya tiene ' + MAX_FOTOS + ' fotos (el máximo). Quita una para agregar otra.', 'error'); return; }
    var files = Array.prototype.filter.call(e.dataTransfer.files || [], function (f) { return /^image\//.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name); });
    if (!files.length) { I.toast('Suelta fotos (JPG, PNG o WEBP).', 'error'); return; }
    addFotoFiles(files);
  });
  // Que una foto soltada fuera de la zona no abra la imagen en el navegador.
  ['dragover', 'drop'].forEach(function (ev) {
    window.addEventListener(ev, function (e) { if (hasFiles(e) && !e.target.closest('[data-pane="fotos"]')) e.preventDefault(); });
  });

  function addFotoFiles(files) {
    if (!files.length) return;
    var room = MAX_FOTOS - fotosCount();
    if (files.length > room) {
      I.toast('Solo caben ' + room + (room === 1 ? ' foto más' : ' fotos más') + ' (máximo ' + MAX_FOTOS + ').', 'error');
      files = files.slice(0, room);
    }
    if (!files.length) return;
    fotosBusy = true; renderFotos();
    Promise.all(files.map(shrink)).then(function (blobs) {
      if (!editing) {
        blobs.forEach(function (b) { fotosQueue.push({ blob: b, url: URL.createObjectURL(b) }); });
        return;
      }
      var itemId = editing.id;
      return uploadFotos(itemId, blobs).then(function (d) {
        fotosSaved = d.fotos || [];
        syncMainFoto(itemId);
        I.toast(blobs.length === 1 ? 'Foto agregada.' : blobs.length + ' fotos agregadas.');
      });
    }).catch(function (err) {
      I.toast(err.message, 'error');
    }).finally(function () {
      fotosBusy = false; renderFotos();
    });
  }

  function fillForm(a, mode) {
    artForm.reset();
    $('artError').textContent = '';
    $('aClave').value = mode === 'clone' ? '' : (a ? a.clave : '');
    $('aClaveAlt').value = a ? a.clave_alterna : '';
    $('aDesc').value = a ? a.descripcion : '';
    formDep = a && a.departamento_id ? String(a.departamento_id) : '';
    formCat = a && a.categoria_id ? String(a.categoria_id) : '';
    buildFormDeps();
    aUC.set(a ? a.unidad_compra : 'PZA', true);
    aUV.set(a ? a.unidad_venta : 'PZA', true);
    $('aFactor').value = a ? (a.factor || 1) : 1;
    $('aServicio').checked = !!(a && a.servicio);
    $('aSinRastreo').checked = !!(a && a.sin_rastreo);
    if ($('aCompra')) $('aCompra').value = a && a.precio_compra ? a.precio_compra.toFixed(2) : '';
    $('aIva').checked = a ? !!a.iva : true;
    [1, 2, 3, 4].forEach(function (n) {
      var row = priceRow(n), p = a ? a['precio_' + n] : 0;
      row.querySelector('[data-precio]').value = p > 0 ? p.toFixed(2) : '';
      if (n > 1) row.querySelector('[data-mayoreo]').value = a && a['mayoreo_' + n] ? a['mayoreo_' + n] : '';
      utilFromPrice(row);
    });
    pricesEl.classList.toggle('no-cost', !(compra() > 0));
    syncSinIva();
    var isEdit = mode === 'edit';
    $('aExistencia').value = isEdit ? a.existencia : '';
    $('aExistField').querySelector('span').textContent = isEdit ? 'Existencia actual' : 'Existencia inicial';
    $('aExistHint').hidden = !isEdit;
    $('aMinimo').value = a && a.minimo ? a.minimo : '';
    $('aMaximo').value = a && a.maximo ? a.maximo : '';
    $('aLocal').value = a ? a.localizacion : '';
    formTipo = a ? (a.tipo_armazon || '') : '';
    colPrin = a ? (a.color_principal || '') : '';
    colExtra = a && a.colores_extra ? a.colores_extra.slice(0, 2) : [];
    setMica(a ? (a.mica_tipo || '') : '');
    formMats = a && a.materiales ? a.materiales.slice(0, 4) : [];
    $('aMatNew').hidden = true;
    renderMats();
    $('aColorNew').hidden = true;
    buildTipos(); renderPalette();
    syncServicio();
    resetFotos(a, mode);
  }
  function openAdd() { editing = null; $('artTitle').textContent = 'Agregar artículo'; fillForm(null, 'add'); openArt(); }
  function openEdit(a) { if (!a) return; editing = a; $('artTitle').textContent = 'Editar artículo'; fillForm(a, 'edit'); openArt(); }
  function openClone(a) { if (!a) return; editing = null; $('artTitle').textContent = 'Clonar «' + a.descripcion + '»'; fillForm(a, 'clone'); openArt(); }
  function openArt() {
    loadArmazonData();
    I.openModal(artModal);
    setTab('general');
    setTimeout(function () { (editing ? $('aDesc') : $('aClave')).focus(); }, 80);
  }

  function intVal(id) { var v = parseInt($(id).value, 10); return isNaN(v) ? 0 : v; }
  artForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var err = $('artError');
    var body = {
      clave: $('aClave').value.trim(),
      clave_alterna: $('aClaveAlt').value.trim(),
      descripcion: $('aDesc').value.trim().replace(/\s+/g, ' '),
      departamento_id: Number(formDep) || 0,
      categoria_id: Number(formCat) || 0,
      unidad_compra: aUC.get(),
      unidad_venta: aUV.get(),
      factor: parseFloat($('aFactor').value) || 1,
      servicio: $('aServicio').checked,
      iva: $('aIva').checked,
      precio_compra: I.round2(compra()),
      existencia: editing ? 0 : intVal('aExistencia'),
      minimo: intVal('aMinimo'),
      maximo: intVal('aMaximo'),
      localizacion: $('aLocal').value.trim(),
      tipo_armazon: formTipo,
      color_principal: colPrin,
      colores_extra: colExtra.slice(),
      mica_tipo: formMica,
      materiales: formMats.slice()
    };
    [1, 2, 3, 4].forEach(function (n) {
      var row = priceRow(n);
      body['precio_' + n] = I.round2(parseFloat(row.querySelector('[data-precio]').value) || 0);
      if (n > 1) body['mayoreo_' + n] = parseInt(row.querySelector('[data-mayoreo]').value, 10) || 0;
    });
    function bad(msg, tab, field) { err.textContent = msg; setTab(tab); if (field) setTimeout(function () { $(field).focus(); }, 60); }
    if (!body.clave) return bad('Escribe la clave del artículo.', 'general', 'aClave');
    if (!body.descripcion) return bad('Escribe la descripción del artículo.', 'general', 'aDesc');
    if (body.precio_1 <= 0 && !body.servicio) return bad('Escribe el precio de venta (precio 1).', 'precios');
    if (body.maximo > 0 && body.minimo > body.maximo) return bad('El mínimo no puede ser mayor que el máximo.', 'inventario', 'aMinimo');
    if (body.existencia < 0) return bad('La existencia no puede ser negativa.', 'inventario', 'aExistencia');
    var btn = $('artSave');
    btn.disabled = true; btn.textContent = 'Guardando…'; err.textContent = '';
    var req = editing
      ? I.api('/api/inventario/articulos/' + editing.id, { method: 'PUT', body: body })
      : I.api('/api/inventario/articulos', { method: 'POST', body: body });
    req.then(function (d) {
      // Fotos en espera (artículo nuevo): se suben ya con su id.
      if (editing || !fotosQueue.length) return d;
      btn.textContent = 'Subiendo fotos…';
      return uploadFotos(d.item.id, fotosQueue.map(function (q) { return q.blob; })).then(function () {
        clearQueue();
        return d;
      }).catch(function (e3) {
        d.fotoError = 'El artículo se guardó, pero las fotos no: ' + e3.message + ' Ábrelo con Editar para subirlas.';
        clearQueue();
        return d;
      });
    }).then(function (d) {
      I.closeModal(artModal);
      if (d.fotoError) I.toast(d.fotoError, 'error');
      else I.toast(editing ? 'Se guardaron los cambios de ' + d.item.descripcion + '.' : 'Artículo ' + d.item.clave + ' agregado.');
      selectedId = d.item.id;
      return load(true).then(function () {
        revealSelected();
        // Recién dado de alta con existencia: se ofrecen sus etiquetas.
        if (!editing && !d.item.servicio && d.item.existencia > 0) openEtiquetas(byId[d.item.id], d.item.existencia, 'Se agregó con ' + I.num(d.item.existencia) + ' en existencia: ¿imprimes sus etiquetas?');
      });
    }).catch(function (e2) {
      err.textContent = e2.message;
    }).finally(function () {
      btn.disabled = false; btn.textContent = 'Guardar';
    });
  });
  // Después de guardar: que el artículo se vea en la lista aunque haya filtros.
  function revealSelected() {
    var idx = filtered.findIndex(function (a) { return a.id === selectedId; });
    if (idx === -1 && byId[selectedId]) {
      f.q = ''; $('invSearch').value = ''; f.dep = ''; f.cat = ''; f.estado = '';
      depSel.set('', true); buildCatFilter(); setEstado('');
      idx = filtered.findIndex(function (a) { return a.id === selectedId; });
    }
    if (idx >= 0) {
      page = Math.floor(idx / PAGE) + 1;
      render();
      var tr = $('invBody').querySelector('tr.is-selected');
      if (tr) tr.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  /* ---------- nueva categoría (desde el formulario) ---------- */
  var catModal = $('catModal');
  var cDep = I.select($('cDepartamento'), { placeholder: 'Elige el departamento' });
  function openCatModal(depId) {
    cDep.setOptions(deps.map(function (d) { return { value: String(d.id), label: d.nombre }; }));
    cDep.set(depId || '', true);
    $('catForm').reset();
    $('catError').textContent = '';
    I.openModal(catModal);
    setTimeout(function () { $('cNombre').focus(); }, 80);
  }
  $('catForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var body = { departamento_id: Number(cDep.get()) || 0, nombre: $('cNombre').value.trim(), comision: parseFloat($('cComision').value) || 0 };
    if (!body.departamento_id) { $('catError').textContent = 'Elige el departamento.'; return; }
    if (!body.nombre) { $('catError').textContent = 'Escribe el nombre de la categoría.'; $('cNombre').focus(); return; }
    var btn = $('catSave'); btn.disabled = true;
    I.api('/api/inventario/categorias', { method: 'POST', body: body }).then(function (d) {
      return I.api('/api/inventario/departamentos').then(function (r) {
        deps = r.departamentos || [];
        buildFilterSelects();
        formDep = String(body.departamento_id);
        formCat = String(d.categoria.id);
        buildFormDeps();
        I.closeModal(catModal);
        I.toast('Categoría ' + d.categoria.nombre + ' creada.');
      });
    }).catch(function (e2) { $('catError').textContent = e2.message; })
      .finally(function () { btn.disabled = false; });
  });

  /* =======================================================
     MODAL: ajustar existencia
     ======================================================= */
  var ajModal = $('ajModal'), ajArt = null, ajModo = 'entrada';
  var MOTIVOS = {
    entrada: ['Compra a proveedor', 'Devolución de cliente', 'Traspaso', 'Regalo de proveedor'],
    salida: ['Merma / dañado', 'Garantía', 'Uso interno', 'Traspaso'],
    fijar: ['Conteo físico', 'Corrección de existencia']
  };
  function ajCantidad() { var v = parseInt($('ajCantidad').value, 10); return isNaN(v) ? 0 : v; }
  function ajRender() {
    Array.prototype.forEach.call($('ajModo').querySelectorAll('button'), function (b) {
      var on = b.getAttribute('data-modo') === ajModo;
      b.classList.toggle('is-on', on); b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    $('ajCantLabel').textContent = ajModo === 'entrada' ? 'Piezas que entran' : ajModo === 'salida' ? 'Piezas que salen' : 'Existencia real';
    var cur = ajArt ? ajArt.existencia : 0, q = ajCantidad();
    var nueva = ajModo === 'entrada' ? cur + q : ajModo === 'salida' ? cur - q : q;
    var out = $('ajNueva');
    out.textContent = I.num(nueva);
    out.parentNode.classList.toggle('is-bad', nueva < 0);
    out.parentNode.classList.toggle('is-up', nueva > cur);
    out.parentNode.classList.toggle('is-down', nueva < cur && nueva >= 0);
    $('ajMotivos').innerHTML = MOTIVOS[ajModo].map(function (m) { return '<button type="button" data-m="' + esc(m) + '">' + esc(m) + '</button>'; }).join('');
    syncMotivoChips();
    $('ajSave').disabled = nueva < 0 || (ajModo !== 'fijar' && q <= 0) || (ajModo === 'fijar' && $('ajCantidad').value === '');
  }
  function syncMotivoChips() {
    var c = $('ajComentario').value.trim();
    Array.prototype.forEach.call($('ajMotivos').querySelectorAll('button'), function (b) { b.classList.toggle('is-on', c.indexOf(b.getAttribute('data-m')) === 0); });
  }
  function openAjuste(a) {
    if (!a || a.servicio) return;
    ajArt = a; ajModo = 'entrada';
    $('ajForm').reset();
    $('ajError').textContent = '';
    $('ajDesc').textContent = a.descripcion;
    $('ajClave').textContent = a.clave + (a.localizacion ? ' · ' + a.localizacion : '');
    $('ajActual').textContent = I.num(a.existencia);
    ajRender();
    I.openModal(ajModal);
    setTimeout(function () { $('ajCantidad').focus(); }, 80);
  }
  $('ajModo').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-modo]');
    if (!b) return;
    ajModo = b.getAttribute('data-modo');
    $('ajComentario').value = '';
    if (ajModo === 'fijar' && ajArt && $('ajCantidad').value === '') $('ajCantidad').value = ajArt.existencia;
    ajRender();
    $('ajCantidad').focus();
  });
  $('ajCantidad').addEventListener('input', ajRender);
  $('ajComentario').addEventListener('input', syncMotivoChips);
  $('ajMotivos').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-m]');
    if (!b) return;
    var m = b.getAttribute('data-m'), c = $('ajComentario').value.trim();
    var rest = c;
    MOTIVOS[ajModo].forEach(function (x) { if (rest.indexOf(x) === 0) rest = rest.slice(x.length).replace(/^\s*[·:-]\s*/, ''); });
    $('ajComentario').value = b.classList.contains('is-on') ? rest : m + (rest ? ' · ' + rest : '');
    syncMotivoChips();
  });
  $('ajForm').addEventListener('submit', function (e) {
    e.preventDefault();
    if ($('ajSave').disabled || !ajArt) return;
    var btn = $('ajSave'); btn.disabled = true; btn.textContent = 'Guardando…';
    I.api('/api/inventario/articulos/' + ajArt.id + '/ajustar', { method: 'POST', body: { modo: ajModo, cantidad: ajCantidad(), comentario: $('ajComentario').value.trim() } })
      .then(function (d) {
        var a = d.ajuste.articulo;
        var entro = a.existencia - (ajArt ? ajArt.existencia : a.existencia);
        I.closeModal(ajModal);
        I.toast('Ajuste #' + d.ajuste.folio + ': ' + a.descripcion + ' quedó en ' + I.num(a.existencia) + '.');
        var i = items.findIndex(function (x) { return x.id === a.id; });
        if (i >= 0) items[i] = a;
        byId[a.id] = a;
        renderStats();
        apply(true);
        // Entró mercancía: se ofrecen las etiquetas de lo que entró.
        if (entro > 0) openEtiquetas(a, entro, 'Entraron ' + I.num(entro) + ': ¿imprimes sus etiquetas?');
      })
      .catch(function (e2) { $('ajError').textContent = e2.message; })
      .finally(function () { btn.textContent = 'Guardar ajuste'; ajRender(); });
  });

  /* =======================================================
     ELIMINAR
     ======================================================= */
  var delModal = $('delModal'), delArt = null;
  function openDelete(a) {
    if (!a) return;
    delArt = a;
    $('delError').textContent = '';
    var blocked = !a.servicio && a.existencia !== 0;
    $('delText').innerHTML = blocked
      ? 'No se puede eliminar <strong>' + esc(a.descripcion) + '</strong>: todavía tiene <strong>' + I.num(a.existencia) + '</strong> en existencia. Primero haz una salida con <strong>Ajustar (F8)</strong> para dejarla en 0.'
      : '¿Eliminar <strong>' + esc(a.descripcion) + '</strong> (' + esc(a.clave) + ')? Sus movimientos pasados se conservan.';
    var ok = $('delOk');
    ok.textContent = blocked ? 'Ajustar existencia' : 'Sí, eliminar';
    ok.classList.toggle('inv-btn-danger', !blocked);
    ok.setAttribute('data-blocked', blocked ? '1' : '');
    I.openModal(delModal);
  }
  $('delOk').addEventListener('click', function () {
    if (!delArt) return;
    if (this.getAttribute('data-blocked')) { I.closeModal(delModal); openAjuste(delArt); return; }
    var btn = this; btn.disabled = true;
    I.api('/api/inventario/articulos/' + delArt.id, { method: 'DELETE' }).then(function () {
      I.closeModal(delModal);
      I.toast('Artículo ' + delArt.clave + ' eliminado.');
      selectedId = null;
      return load(false);
    }).catch(function (e2) { $('delError').textContent = e2.message; })
      .finally(function () { btn.disabled = false; });
  });

  /* =======================================================
     NÚMEROS DE RASTREO (uno por pieza: AVT000001…)
     ======================================================= */
  var rsModal = $('rsModal'), rsArt = null, rsEstado = 'disponible', rsItems = [], rsNuevos = {};
  var RS_LABEL = { disponible: 'Disponible', vendida: 'Vendida', baja: 'Baja' };
  function openRastreo(a, nuevos) {
    if (!a) return;
    rsArt = a; rsEstado = 'disponible'; rsNuevos = {};
    (nuevos || []).forEach(function (n) { rsNuevos[n] = true; });
    $('rsTitle').textContent = nuevos && nuevos.length ? 'Se generaron ' + nuevos.length + ' números de rastreo' : 'Números de rastreo';
    $('rsDesc').textContent = a.descripcion;
    $('rsClave').textContent = a.clave;
    $('rsSearch').value = '';
    I.openModal(rsModal);
    loadRastreo();
  }
  function loadRastreo() {
    $('rsList').innerHTML = '<p class="inv-empty">Cargando…</p>';
    I.api('/api/inventario/articulos/' + rsArt.id + '/rastreo').then(function (d) {
      rsItems = d.items || [];
      var t = d.totales || {};
      $('rsChips').querySelector('[data-e="disponible"] b').textContent = t.disponibles || 0;
      $('rsChips').querySelector('[data-e="vendida"] b').textContent = t.vendidas || 0;
      $('rsChips').querySelector('[data-e="baja"] b').textContent = t.bajas || 0;
      $('rsChips').querySelector('[data-e=""] b').textContent = (t.disponibles || 0) + (t.vendidas || 0) + (t.bajas || 0);
      renderRastreo();
    }).catch(function (e) { $('rsList').innerHTML = '<p class="inv-empty">' + esc(e.message) + '</p>'; });
  }
  function rsFiltered() {
    var q = $('rsSearch').value.trim().toUpperCase();
    return rsItems.filter(function (p) {
      if (rsEstado && p.estado !== rsEstado) return false;
      return !q || p.numero.indexOf(q) !== -1;
    });
  }
  function renderRastreo() {
    Array.prototype.forEach.call($('rsChips').querySelectorAll('button'), function (b) { b.classList.toggle('is-on', b.getAttribute('data-e') === rsEstado); });
    var list = rsFiltered();
    $('rsCount').textContent = list.length + (list.length === 1 ? ' número' : ' números');
    $('rsPrint').disabled = !list.length;
    $('rsCopy').disabled = !list.length;
    if (!list.length) { $('rsList').innerHTML = '<p class="inv-empty">No hay números ' + (rsEstado ? RS_LABEL[rsEstado].toLowerCase().replace(/a$/, 'as').replace(/e$/, 'es') + ' ' : '') + 'para este artículo.</p>'; return; }
    $('rsList').innerHTML = list.map(function (p, i) {
      var sal = p.estado === 'vendida' ? (p.venta_id ? 'Ticket ' + p.venta_id : 'Vendida') : p.estado === 'baja' ? (p.salida_ajuste_id ? 'Ajuste #' + p.salida_ajuste_id : 'Baja') : '';
      return '<div class="inv-rs-item is-' + p.estado + (rsNuevos[p.numero] ? ' is-new' : '') + '" style="--i:' + Math.min(i, 30) + '">' +
        '<strong>' + esc(p.numero) + '</strong>' +
        '<span class="inv-rs-meta"><span class="inv-rs-st">' + RS_LABEL[p.estado] + '</span>' + (rsNuevos[p.numero] ? '<em>Nuevo</em>' : '') + '</span>' +
        '<small>Alta ' + esc(I.fecha(p.created_at)) + (sal ? ' · ' + esc(sal) + (p.salida_at ? ' ' + esc(I.fecha(p.salida_at)) : '') : '') + '</small>' +
      '</div>';
    }).join('');
  }
  $('rsChips').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-e]');
    if (!b) return;
    rsEstado = b.getAttribute('data-e');
    renderRastreo();
  });
  $('rsSearch').addEventListener('input', renderRastreo);
  $('rsCopy').addEventListener('click', function () {
    var txt = rsFiltered().map(function (p) { return p.numero; }).join('\n');
    var done = function () { I.toast('Se copiaron ' + rsFiltered().length + ' números.'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, function () { fallbackCopy(txt); done(); });
    else { fallbackCopy(txt); done(); }
  });
  function fallbackCopy(txt) {
    var ta = document.createElement('textarea'); ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} ta.remove();
  }
  /* ---------- etiquetas: directo a la etiquetadora (programa de impresión local) ---------- */
  var L = window.InvLabels;
  function labelsOf(list) {
    return list.map(function (p) { return { code: p.numero, desc: rsArt.descripcion, price: rsArt.precio_1, sub: rsArt.clave }; });
  }
  function syncLblName() {
    var c = L ? L.config() : null;
    var t = c && c.printer ? c.printer + ' · ' + c.lang.toUpperCase() : 'Impresora de etiquetas';
    $('rsLblName').textContent = t;
    $('etqLblName').textContent = t;
  }
  $('rsPrint').addEventListener('click', function () {
    var list = rsFiltered();
    if (!list.length || !rsArt) return;
    var cfg = L ? L.config() : null;
    if (!cfg || !cfg.printer || !cfg.enabled) {
      I.toast('Elige la impresora de etiquetas para imprimir directo. Mientras, se abrió la vista previa.');
      previewLabels(labelsOf(list));
      return;
    }
    var btn = this; btn.disabled = true; btn.textContent = 'Imprimiendo…';
    L.print(labelsOf(list), cfg).then(function () {
      I.toast('Se mandaron ' + list.length + (list.length === 1 ? ' etiqueta' : ' etiquetas') + ' a ' + cfg.printer + '.');
    }, function (err) {
      I.toast((err.offline ? 'El programa de impresión no está abierto en esta compu.' : 'No se pudo imprimir directo: ' + err.message + '.') + ' Se abrió la vista previa.', 'error');
      previewLabels(labelsOf(list));
    }).finally(function () { btn.disabled = false; btn.textContent = 'Imprimir etiquetas'; });
  });
  $('rsPreview').addEventListener('click', function () { var l = rsFiltered(); if (l.length) previewLabels(labelsOf(l)); });

  /* ---------- etiquetas del artículo (botón Etiquetas / F7) ----------
     La etiqueta lleva la descripción, el PRECIO en grande, el código de
     barras de la clave (el Punto de venta lo encuentra al escanearlo) y la
     clave abajo. Ya no depende de los números de rastreo. */
  var etqModal = $('etqModal'), etqArt = null, etqMax = 0;
  function etqCode(a) { return String(a.clave || a.clave_alterna || ('ART' + a.id)).toUpperCase().replace(/\s+/g, ''); }
  function etqLabels(a, n) {
    var one = { code: etqCode(a), desc: a.descripcion, price: a.precio_1, sub: '' };
    var out = []; for (var i = 0; i < n; i++) out.push(one);
    return out;
  }
  function etqQty() { return Math.max(1, Math.min(500, parseInt($('etqQty').value, 10) || 1)); }
  function openEtiquetas(a, qty, note) {
    if (!a) return;
    etqArt = a; etqMax = a.servicio ? 0 : Math.max(0, a.existencia || 0);
    $('etqDesc').textContent = a.descripcion;
    $('etqClave').textContent = etqCode(a);
    $('etqNote').hidden = !note; $('etqNote').textContent = note || '';
    $('etqQty').value = Math.max(1, Math.min(500, qty || 1));
    $('etqAll').hidden = !(etqMax > 1);
    $('etqAll').textContent = 'Una por pieza (' + I.num(etqMax) + ')';
    $('etqError').textContent = '';
    var c = L ? L.config() : { w: 50, h: 25 };
    var lbl = $('etqLbl');
    lbl.style.aspectRatio = c.w + ' / ' + c.h;
    $('etqSize').textContent = 'Etiqueta de ' + c.w + ' × ' + c.h + ' mm';
    $('etqLblDesc').textContent = a.descripcion;
    $('etqLblPrice').textContent = L ? L.priceText(a.precio_1) : mxn.format(a.precio_1);
    $('etqLblCode').textContent = etqCode(a);
    drawBars($('etqLblBc'), etqCode(a));
    syncLblName();
    I.openModal(etqModal);
  }
  // Barras de muestra (la imagen real la hace la impresora).
  function drawBars(svgEl, text) {
    var x = 0, out = '', seed = 0;
    for (var i = 0; i < text.length; i++) seed = (seed * 31 + text.charCodeAt(i)) % 9973;
    while (x < 100) {
      seed = (seed * 9301 + 49297) % 233280;
      var w = 0.6 + (seed % 3) * 0.6;
      out += '<rect x="' + x.toFixed(2) + '" y="0" width="' + w.toFixed(2) + '" height="20"/>';
      x += w + 0.6 + ((seed >> 3) % 2) * 0.7;
    }
    svgEl.innerHTML = out;
  }
  $('etqModal').querySelector('.inv-etq-qty').addEventListener('click', function (e) {
    var b = e.target.closest('[data-step]');
    if (b) { $('etqQty').value = Math.max(1, Math.min(500, etqQty() + Number(b.getAttribute('data-step')))); }
  });
  $('etqAll').addEventListener('click', function () { $('etqQty').value = Math.min(500, etqMax); });
  $('etqLblCfg').addEventListener('click', openLblCfg);
  $('etqPreview').addEventListener('click', function () { if (etqArt) previewLabels(etqLabels(etqArt, etqQty())); });
  $('etqPrint').addEventListener('click', function () {
    if (!etqArt) return;
    var n = etqQty(), labels = etqLabels(etqArt, n);
    var cfg = L ? L.config() : null;
    if (!cfg || !cfg.printer || !cfg.enabled) {
      I.toast('Elige la impresora de etiquetas para imprimir directo. Mientras, se abrió la vista previa.');
      previewLabels(labels);
      return;
    }
    var btn = this; btn.disabled = true; btn.textContent = 'Imprimiendo…'; $('etqError').textContent = '';
    L.print(labels, cfg).then(function () {
      I.closeModal(etqModal);
      I.toast('Se mandaron ' + n + (n === 1 ? ' etiqueta' : ' etiquetas') + ' a ' + cfg.printer + '.');
    }, function (err) {
      $('etqError').textContent = err.offline ? 'El programa de impresión no está abierto en esta compu. Se abrió la vista previa.' : 'No se pudo imprimir directo: ' + err.message;
      previewLabels(labels);
    }).finally(function () { btn.disabled = false; btn.textContent = 'Imprimir'; });
  });

  // Configurar la etiquetadora (se guarda en esta compu).
  var lblModal = $('lblModal'), lblLang = 'tspl', lblPrinters = [];
  var LANG_HINT = {
    tspl: 'SICAR EVA58, TSC, Xprinter (XP-360B, XP-365B, XP-420B), 3nStar, Rongta, Beeprt y la mayoría de las genéricas.',
    zpl: 'Zebra (ZD220, ZD230, ZD410, GC420, GK420, GX420).',
    epl: 'Zebra viejitas (LP2824, TLP2844). Si con ZPL no imprime, prueba esta.'
  };
  var lblSel = I.select($('lblPrinter'), { placeholder: 'Elige la impresora', onChange: function (v) {
    if (v && L) {
      lblLang = L.guess(v);
      // SICAR EVA58: el rollo es de 58 mm como máximo.
      if (L.isEva(v) && (parseFloat($('lblW').value) || 0) > 58) $('lblW').value = 50;
      syncLang();
    }
  } });
  function syncLang() {
    Array.prototype.forEach.call($('lblLang').querySelectorAll('button'), function (b) { b.classList.toggle('is-on', b.getAttribute('data-lang') === lblLang); });
    var eva = L && L.isEva(lblSel.get());
    $('lblLangHint').textContent = eva
      ? 'SICAR EVA58: usa TSPL y debe estar en modo etiqueta (en modo ticket imprime los comandos como texto). Rollo de hasta 58 mm.'
      : LANG_HINT[lblLang];
  }
  $('lblLang').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-lang]');
    if (b) { lblLang = b.getAttribute('data-lang'); syncLang(); }
  });
  function openLblCfg() {
    if (!L) return;
    var c = L.config();
    lblLang = c.lang; syncLang();
    $('lblW').value = c.w; $('lblH').value = c.h; $('lblGap').value = c.gap;
    $('lblDirect').checked = !!c.enabled;
    $('lblPriceImg').checked = c.priceImg !== false;
    $('lblError').textContent = '';
    lblSel.setOptions(c.printer ? [{ value: c.printer, label: c.printer }] : []);
    lblSel.set(c.printer, true); syncLang();
    var st = $('lblStatus');
    st.className = 'inv-lbl-status'; st.textContent = 'Buscando el programa de impresión…';
    I.openModal(lblModal);
    L.status().then(function (s) {
      if (!s) {
        st.className = 'inv-lbl-status is-off';
        st.innerHTML = '<strong>El programa de impresión no está abierto en esta compu.</strong> Ábrelo y vuelve a abrir esta ventana. Mientras, puedes imprimir con «Vista previa».';
        return;
      }
      lblPrinters = s.printers || [];
      var sorted = lblPrinters.slice().sort(function (a, b) { return (L.looksLikeLabel(b) ? 1 : 0) - (L.looksLikeLabel(a) ? 1 : 0); });
      lblSel.setOptions(sorted.map(function (p) { return { value: p, label: p, hint: L.looksLikeLabel(p) ? 'etiquetas' : (p === s.default ? 'predeterminada' : '') }; }));
      var cur = c.printer && lblPrinters.indexOf(c.printer) !== -1 ? c.printer : (sorted.filter(L.looksLikeLabel)[0] || '');
      lblSel.set(cur, true);
      if (!c.printer && cur) lblLang = L.guess(cur);
      syncLang();
      st.className = 'inv-lbl-status is-on';
      st.innerHTML = '<strong>Programa de impresión conectado.</strong> ' + lblPrinters.length + (lblPrinters.length === 1 ? ' impresora encontrada.' : ' impresoras encontradas.');
    });
  }
  function readLblForm() {
    return {
      printer: lblSel.get(), lang: lblLang,
      w: Math.min(L && L.isEva(lblSel.get()) ? 58 : 110, Math.max(20, parseFloat($('lblW').value) || 50)),
      h: Math.min(100, Math.max(10, parseFloat($('lblH').value) || 25)),
      gap: Math.min(10, Math.max(0, parseFloat($('lblGap').value) || 0)),
      enabled: $('lblDirect').checked,
      priceImg: $('lblPriceImg').checked
    };
  }
  $('rsLblCfg').addEventListener('click', openLblCfg);
  $('lblSave').addEventListener('click', function () {
    var c = readLblForm();
    if (c.enabled && !c.printer) { $('lblError').textContent = 'Elige la impresora de etiquetas.'; return; }
    L.setConfig(c); syncLblName();
    I.closeModal(lblModal);
    I.toast(c.printer ? 'Las etiquetas se imprimirán en ' + c.printer + '.' : 'Se guardó.');
  });
  $('lblTest').addEventListener('click', function () {
    var c = readLblForm();
    if (!c.printer) { $('lblError').textContent = 'Elige la impresora de etiquetas.'; return; }
    var btn = this; btn.disabled = true; $('lblError').textContent = '';
    L.test(c).then(function () { I.toast('Se mandó una etiqueta de prueba a ' + c.printer + '.'); },
      function (err) { $('lblError').textContent = err.message; })
      .finally(function () { btn.disabled = false; });
  });
  syncLblName();

  // Vista previa en una ventana (también sirve para imprimir en hoja normal).
  // labels: [{code, desc, price, sub}] — el precio va GRANDE.
  function previewLabels(labels) {
    if (!labels.length) return;
    var w = window.open('', '_blank', 'width=900,height=700');
    if (!w) { I.toast('Permite las ventanas emergentes para imprimir las etiquetas.', 'error'); return; }
    var c = L ? L.config() : { w: 50, h: 25 };
    var title = esc(labels[0].desc);
    var pt = function (v) { return L ? L.priceText(v) : mxn.format(v); };
    w.document.write('<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Etiquetas · ' + title + '</title>' +
      '<style>@page{margin:8mm}body{font-family:Arial,sans-serif;margin:0}' +
      '.grid{display:grid;grid-template-columns:repeat(auto-fill,' + c.w + 'mm);gap:3mm}' +
      '.lbl{width:' + c.w + 'mm;height:' + c.h + 'mm;box-sizing:border-box;border:1px dashed #bbb;padding:1mm 2mm;display:flex;flex-direction:column;align-items:center;justify-content:space-between;overflow:hidden;page-break-inside:avoid}' +
      '.d{font-size:7pt;font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;line-height:1.1}' +
      '.p{font-size:' + Math.max(16, Math.round(c.h * 0.95)) + 'pt;font-weight:900;line-height:1;letter-spacing:-.5px}' +
      '.c{font-family:monospace;font-size:7.5pt;font-weight:bold;letter-spacing:.5px;line-height:1}svg{width:100%;height:' + Math.max(5, Math.round(c.h * 0.24)) + 'mm}' +
      '@media print{.lbl{border-color:transparent}.bar{display:none}}' +
      '.bar{padding:10px;font-size:13px;display:flex;gap:10px;align-items:center}.bar button{padding:8px 14px;font-size:13px;cursor:pointer}</style></head><body>' +
      '<div class="bar"><button onclick="window.print()">Imprimir</button><span>' + labels.length + (labels.length === 1 ? ' etiqueta · ' : ' etiquetas · ') + title + '</span></div><div class="grid">' +
      labels.map(function (l) {
        return '<div class="lbl"><div class="d">' + esc(l.desc) + '</div><div class="p">' + esc(pt(l.price)) + '</div><svg class="bc" data-v="' + esc(l.code) + '"></svg><div class="c">' + esc(l.code) + (l.sub ? ' · ' + esc(l.sub) : '') + '</div></div>';
      }).join('') +
      '</div><script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>' +
      '<script>window.addEventListener("load",function(){document.querySelectorAll(".bc").forEach(function(s){try{JsBarcode(s,s.getAttribute("data-v"),{format:"CODE128",height:34,margin:0,displayValue:false})}catch(e){}});});<\/script>' +
      '</body></html>');
    w.document.close();
  }

  /* ---------- barra de acciones y atajos ---------- */
  $('tbAgregar').addEventListener('click', openAdd);
  $('tbEditar').addEventListener('click', function () { openEdit(current()); });
  $('tbRecargar').addEventListener('click', function () { load(true).then(function () { I.toast('Inventario actualizado.'); }); });
  $('tbEliminar').addEventListener('click', function () { openDelete(current()); });
  $('tbAjustar').addEventListener('click', function () { openAjuste(current()); });
  $('tbClonar').addEventListener('click', function () { openClone(current()); });
  $('tbEtiquetas').addEventListener('click', function () { openEtiquetas(current()); });

  document.addEventListener('keydown', function (e) {
    var modal = document.querySelector('.admin-modal-overlay.open');
    var keys = { F2: 1, F3: 1, F4: 1, F5: 1, F6: 1, F7: 1, F8: 1, F9: 1 };
    if (keys[e.key]) {
      if (modal) { if (e.key === 'F5') e.preventDefault(); return; }
      e.preventDefault();
      if (e.key === 'F2') { $('invSearch').focus(); $('invSearch').select(); }
      if (e.key === 'F3') openAdd();
      if (e.key === 'F4') openEdit(current());
      if (e.key === 'F5') $('tbRecargar').click();
      if (e.key === 'F6') openDelete(current());
      if (e.key === 'F7') openEtiquetas(current());
      if (e.key === 'F8') openAjuste(current());
      if (e.key === 'F9') openClone(current());
      return;
    }
    if (modal) return;
    var t = e.target, typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && t.id !== 'invSearch';
    if (typing) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSelection(1); }
    if (e.key === 'ArrowUp') { e.preventDefault(); moveSelection(-1); }
    if (e.key === 'Enter' && t.id === 'invSearch') { e.preventDefault(); if (current()) openEdit(current()); }
  });

  // ?q= en la URL (p. ej. desde otra página)
  try {
    var sp = new URLSearchParams(location.search);
    var q = sp.get('q');
    if (q) { $('invSearch').value = q; f.q = q; }
    if (sp.get('dep')) f.dep = sp.get('dep');
    if (sp.get('cat')) f.cat = sp.get('cat');
  } catch (e) {}
  load(false);
  loadArmazonData();
})();
/* ---------------------------------------------------------------- departments.js */
/* =========================================================
   INVENTARIO → Departamentos y categorías
     GET    /api/inventario/departamentos     → { departamentos: [{…, categorias: […]}] }
     POST   /api/inventario/departamentos     { nombre }
     PUT    /api/inventario/departamentos/:id { nombre }
     DELETE /api/inventario/departamentos/:id (sin artículos)
     POST   /api/inventario/categorias        { departamento_id, nombre, comision }
     PUT    /api/inventario/categorias/:id    { departamento_id, nombre, comision }
     DELETE /api/inventario/categorias/:id    (sin artículos)
   ========================================================= */
(function () {
  var I = window.Inv;
  if (!I || !I.$('invDepartamentos')) return;
  var $ = I.$, esc = I.esc;

  var deps = [], selected = null, editDep = null, editCat = null;
  var PENCIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
  var TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';
  var MOVE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/></svg>';
  var OK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
  var CANCEL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';

  function load(selectId) {
    return I.api('/api/inventario/departamentos').then(function (d) {
      deps = d.departamentos || [];
      if (selectId != null) selected = selectId;
      if (!deps.some(function (x) { return x.id === selected; })) selected = deps.length ? deps[0].id : null;
      renderDeps(); renderCats();
    }).catch(function (e) {
      $('depList').innerHTML = '<p class="inv-empty">' + esc(e.message) + '</p>';
    });
  }
  function dep() { return deps.filter(function (x) { return x.id === selected; })[0] || null; }
  function initials(n) { return String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join(''); }

  /* ---------- departamentos ---------- */
  function renderDeps() {
    $('depCount').textContent = deps.length + (deps.length === 1 ? ' departamento' : ' departamentos');
    if (!deps.length) { $('depList').innerHTML = '<p class="inv-empty">Todavía no hay departamentos.</p>'; return; }
    $('depList').innerHTML = deps.map(function (d, i) {
      if (editDep === d.id) {
        return '<div class="inv-dep-item is-editing" data-id="' + d.id + '" style="--i:' + i + '">' +
          '<form class="inv-inline-edit" data-form="dep" style="flex:1">' +
            '<input type="text" maxlength="60" value="' + esc(d.nombre) + '" aria-label="Nombre del departamento">' +
            '<button type="submit" class="inv-icon-btn" title="Guardar">' + OK + '</button>' +
            '<button type="button" class="inv-icon-btn" data-act="cancel" title="Cancelar">' + CANCEL + '</button>' +
          '</form></div>';
      }
      return '<div class="inv-dep-item' + (d.id === selected ? ' is-on' : '') + '" data-id="' + d.id + '" style="--i:' + i + '" role="button" tabindex="0">' +
        '<span class="inv-dep-ico">' + esc(initials(d.nombre)) + '</span>' +
        '<span class="inv-dep-txt"><strong>' + esc(d.nombre) + '</strong><small>' + d.categorias.length + (d.categorias.length === 1 ? ' categoría' : ' categorías') + ' · ' + d.articulos + (d.articulos === 1 ? ' artículo' : ' artículos') + '</small></span>' +
        '<button type="button" class="inv-icon-btn" data-act="edit" title="Cambiar nombre">' + PENCIL + '</button>' +
        '<button type="button" class="inv-icon-btn is-danger" data-act="del" title="Borrar">' + TRASH + '</button>' +
      '</div>';
    }).join('');
    var inp = $('depList').querySelector('.is-editing input');
    if (inp) { inp.focus(); inp.select(); }
  }
  $('depList').addEventListener('click', function (e) {
    var item = e.target.closest('.inv-dep-item');
    if (!item) return;
    var id = Number(item.getAttribute('data-id'));
    var act = e.target.closest('[data-act]');
    if (act) {
      var a = act.getAttribute('data-act');
      if (a === 'edit') { editDep = id; renderDeps(); }
      if (a === 'cancel') { editDep = null; renderDeps(); }
      if (a === 'del') askDelete('dep', deps.filter(function (x) { return x.id === id; })[0]);
      return;
    }
    if (item.classList.contains('is-editing')) return;
    selected = id; editCat = null;
    renderDeps(); renderCats();
  });
  $('depList').addEventListener('keydown', function (e) {
    var item = e.target.closest('.inv-dep-item');
    if (item && (e.key === 'Enter' || e.key === ' ') && e.target === item) { e.preventDefault(); item.click(); }
    if (e.key === 'Escape' && editDep) { editDep = null; renderDeps(); }
  });
  $('depList').addEventListener('submit', function (e) {
    e.preventDefault();
    var input = e.target.querySelector('input');
    var nombre = input.value.trim();
    if (!nombre) { input.focus(); return; }
    I.api('/api/inventario/departamentos/' + editDep, { method: 'PUT', body: { nombre: nombre } })
      .then(function (d) { editDep = null; I.toast('Departamento ' + d.nombre + ' guardado.'); return load(); })
      .catch(function (err) { I.toast(err.message, 'error'); input.focus(); });
  });
  $('depForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var nombre = $('depNombre').value.trim();
    if (!nombre) { $('depNombre').focus(); return; }
    I.api('/api/inventario/departamentos', { method: 'POST', body: { nombre: nombre } })
      .then(function (d) { $('depNombre').value = ''; I.toast('Departamento ' + d.nombre + ' creado.'); return load(d.id); })
      .then(function () { $('catNombre').focus(); })
      .catch(function (err) { I.toast(err.message, 'error'); });
  });

  /* ---------- categorías ---------- */
  function renderCats() {
    var d = dep();
    $('catForm').hidden = !d;
    $('catVerArts').hidden = !d;
    if (!d) {
      $('catHead').textContent = 'Categorías';
      $('catSub').textContent = '';
      $('catBody').innerHTML = '';
      $('catEmpty').hidden = false;
      $('catEmpty').textContent = 'Crea un departamento para agregarle categorías.';
      return;
    }
    $('catHead').textContent = d.nombre;
    $('catSub').textContent = d.categorias.length + (d.categorias.length === 1 ? ' categoría' : ' categorías');
    $('catVerArts').href = I.base + '/articulos?dep=' + d.id;
    $('catEmpty').hidden = d.categorias.length > 0;
    $('catEmpty').textContent = 'Este departamento todavía no tiene categorías. Agrega la primera arriba.';
    $('catBody').innerHTML = d.categorias.map(function (c, i) {
      if (editCat === c.id) {
        return '<tr data-id="' + c.id + '" style="--i:' + i + '"><td colspan="4">' +
          '<form class="inv-inline-edit" data-form="cat">' +
            '<input type="text" maxlength="60" value="' + esc(c.nombre) + '" data-f="nombre" aria-label="Nombre">' +
            '<input type="number" class="is-num" min="0" max="100" step="0.01" value="' + (c.comision || '') + '" placeholder="Comisión %" data-f="comision" aria-label="Comisión">' +
            '<button type="submit" class="inv-icon-btn" title="Guardar">' + OK + '</button>' +
            '<button type="button" class="inv-icon-btn" data-act="cancel" title="Cancelar">' + CANCEL + '</button>' +
          '</form></td></tr>';
      }
      return '<tr data-id="' + c.id + '" style="--i:' + i + '">' +
        '<td><strong>' + esc(c.nombre) + '</strong></td>' +
        '<td class="num">' + (c.comision ? I.round2(c.comision) + ' %' : '<span class="inv-muted">—</span>') + '</td>' +
        '<td class="num">' + (c.articulos ? '<a href="' + I.base + '/articulos?dep=' + d.id + '&amp;cat=' + c.id + '">' + c.articulos + '</a>' : '<span class="inv-muted">0</span>') + '</td>' +
        '<td class="act">' +
          '<button type="button" class="inv-icon-btn" data-act="edit" title="Editar">' + PENCIL + '</button>' +
          (deps.length > 1 ? '<button type="button" class="inv-icon-btn" data-act="move" title="Mover a otro departamento">' + MOVE + '</button>' : '') +
          '<button type="button" class="inv-icon-btn is-danger" data-act="del" title="Borrar">' + TRASH + '</button>' +
        '</td></tr>';
    }).join('');
    var inp = $('catBody').querySelector('input[data-f="nombre"]');
    if (inp) { inp.focus(); inp.select(); }
  }
  function catById(id) { var d = dep(); return d ? d.categorias.filter(function (c) { return c.id === id; })[0] : null; }
  $('catBody').addEventListener('click', function (e) {
    var act = e.target.closest('[data-act]');
    if (!act) return;
    var id = Number(act.closest('tr').getAttribute('data-id'));
    var a = act.getAttribute('data-act');
    if (a === 'edit') { editCat = id; renderCats(); }
    if (a === 'cancel') { editCat = null; renderCats(); }
    if (a === 'del') askDelete('cat', catById(id));
    if (a === 'move') openMove(catById(id));
  });
  $('catBody').addEventListener('keydown', function (e) { if (e.key === 'Escape' && editCat) { editCat = null; renderCats(); } });
  $('catBody').addEventListener('submit', function (e) {
    e.preventDefault();
    var c = catById(editCat);
    if (!c) return;
    var nombre = e.target.querySelector('[data-f="nombre"]').value.trim();
    var comision = parseFloat(e.target.querySelector('[data-f="comision"]').value) || 0;
    saveCat(c, { departamento_id: c.departamento_id, nombre: nombre, comision: comision }).then(function (ok) { if (ok) editCat = null; });
  });
  function saveCat(c, body) {
    return I.api('/api/inventario/categorias/' + c.id, { method: 'PUT', body: body })
      .then(function (d) { I.toast('Categoría ' + d.categoria.nombre + ' guardada.'); editCat = null; return load().then(function () { return true; }); })
      .catch(function (err) { I.toast(err.message, 'error'); return false; });
  }
  $('catForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var d = dep();
    var nombre = $('catNombre').value.trim();
    if (!d) return;
    if (!nombre) { $('catNombre').focus(); return; }
    I.api('/api/inventario/categorias', { method: 'POST', body: { departamento_id: d.id, nombre: nombre, comision: parseFloat($('catComision').value) || 0 } })
      .then(function (r) {
        $('catNombre').value = ''; $('catComision').value = '';
        I.toast('Categoría ' + r.categoria.nombre + ' agregada a ' + d.nombre + '.');
        return load();
      })
      .then(function () { $('catNombre').focus(); })
      .catch(function (err) { I.toast(err.message, 'error'); });
  });

  /* ---------- mover categoría ---------- */
  var moving = null;
  var moveSel = I.select($('moveDep'), { placeholder: 'Elige el departamento' });
  function openMove(c) {
    if (!c) return;
    moving = c;
    var d = dep();
    $('moveText').innerHTML = 'La categoría <strong>' + esc(c.nombre) + '</strong>' + (c.articulos ? ' y sus <strong>' + c.articulos + '</strong> artículos' : '') + ' pasan de <strong>' + esc(d.nombre) + '</strong> a:';
    moveSel.setOptions(deps.filter(function (x) { return x.id !== d.id; }).map(function (x) { return { value: String(x.id), label: x.nombre }; }));
    moveSel.set('', true);
    $('moveError').textContent = '';
    I.openModal($('moveModal'));
  }
  $('moveOk').addEventListener('click', function () {
    var to = Number(moveSel.get());
    if (!to) { $('moveError').textContent = 'Elige a qué departamento.'; return; }
    var btn = this; btn.disabled = true;
    saveCat(moving, { departamento_id: to, nombre: moving.nombre, comision: moving.comision }).then(function (ok) {
      btn.disabled = false;
      if (ok) { I.closeModal($('moveModal')); selected = to; load(to); }
    });
  });

  /* ---------- borrar ---------- */
  var del = null;
  function askDelete(kind, obj) {
    if (!obj) return;
    del = { kind: kind, obj: obj };
    $('delError').textContent = '';
    $('delTitle').textContent = kind === 'dep' ? 'Borrar departamento' : 'Borrar categoría';
    var blocked = obj.articulos > 0;
    var cats = kind === 'dep' ? obj.categorias.length : 0;
    $('delText').innerHTML = blocked
      ? 'No se puede borrar <strong>' + esc(obj.nombre) + '</strong>: tiene <strong>' + obj.articulos + '</strong> ' + (obj.articulos === 1 ? 'artículo' : 'artículos') + '. Primero cámbialos de ' + (kind === 'dep' ? 'departamento' : 'categoría') + ' (en Artículos → Editar).'
      : '¿Borrar <strong>' + esc(obj.nombre) + '</strong>?' + (cats ? ' También se borran sus ' + cats + ' categorías (no tienen artículos).' : '');
    $('delOk').hidden = blocked;
    I.openModal($('delModal'));
  }
  $('delOk').addEventListener('click', function () {
    if (!del) return;
    var btn = this; btn.disabled = true;
    var url = del.kind === 'dep' ? '/api/inventario/departamentos/' + del.obj.id : '/api/inventario/categorias/' + del.obj.id;
    I.api(url, { method: 'DELETE' }).then(function () {
      I.closeModal($('delModal'));
      I.toast((del.kind === 'dep' ? 'Departamento ' : 'Categoría ') + del.obj.nombre + ' borrado.');
      return load();
    }).catch(function (err) { $('delError').textContent = err.message; })
      .finally(function () { btn.disabled = false; });
  });

  ['depNombre', 'catNombre'].forEach(function (id) {
    $(id).addEventListener('input', function () {
      var p = this.selectionStart; this.value = this.value.toUpperCase();
      try { this.setSelectionRange(p, p); } catch (e) {}
    });
  });

  load();
})();
/* ---------------------------------------------------------------- adjustments.js */
/* =========================================================
   INVENTARIO → Ajustes de inventario (inventario físico, como SICAR)
     GET  /api/inventario/articulos            catálogo para buscar
     POST /api/inventario/ajustes              { comentario, lineas: [{item_id, contado}] }
     GET  /api/inventario/ajustes?desde&hasta  folios
     GET  /api/inventario/ajustes/:id          detalle
   El conteo en curso se guarda en este navegador (por si se recarga la
   página a la mitad del conteo).
   Además: elegir cuáles artículos se ajustan (casillas), hoja de conteo
   para imprimir, y en cada ajuste: Excel, PDF, imprimir, WhatsApp, correo
   y «Por ajustar» (lo que no se contó).
   ========================================================= */
(function () {
  var I = window.Inv;
  if (!I || !I.$('invAjustes')) return;
  var $ = I.$, esc = I.esc;
  var DRAFT = 'attomosInvConteo';
  var TIPOS = { fisico: 'Inventario físico', entrada: 'Entrada', salida: 'Salida', fijar: 'Existencia fijada' };

  var items = [], byId = {}, deps = [];
  var lines = []; // [{ id, contado: '' | número }]

  /* ---------- modo ---------- */
  var mode = 'nuevo';
  function setMode(m) {
    mode = m;
    Array.prototype.forEach.call($('ajMode').querySelectorAll('button'), function (b) { b.classList.toggle('is-on', b.getAttribute('data-mode') === m); });
    $('paneNuevo').hidden = m !== 'nuevo';
    $('paneConsultar').hidden = m !== 'consultar';
    if ($('paneEscaner')) $('paneEscaner').hidden = m !== 'escaner';
    if (m === 'consultar') loadAjustes();
    if (m === 'escaner' && window.InvEscaner) window.InvEscaner.show();
    try { localStorage.setItem('attomosInvAjMode', m === 'consultar' ? 'nuevo' : m); } catch (e) {}
  }
  $('ajMode').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-mode]');
    if (b) setMode(b.getAttribute('data-mode'));
  });

  /* ---------- catálogo ---------- */
  function loadCatalog() {
    return I.api('/api/inventario/articulos').then(function (d) {
      items = (d.items || []).filter(function (a) { return !a.servicio; });
      deps = d.departamentos || [];
      byId = {};
      items.forEach(function (a) { byId[a.id] = a; });
      lines = lines.filter(function (l) { return byId[l.id]; });
      buildBulk();
      renderLines();
    }).catch(function (e) { I.toast(e.message, 'error'); });
  }

  /* ---------- buscador para agregar ---------- */
  var pick = $('pick'), pickInput = $('pickInput'), pickRes = $('pickResults'), hl = 0, results = [];
  function search(q) {
    var words = I.norm(q).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    var exact = [], rest = [];
    items.forEach(function (a) {
      var hay = I.norm(a.clave + ' ' + a.clave_alterna + ' ' + a.descripcion);
      for (var i = 0; i < words.length; i++) if (hay.indexOf(words[i]) === -1) return;
      (words.length === 1 && (I.norm(a.clave) === words[0] || I.norm(a.clave_alterna) === words[0]) ? exact : rest).push(a);
    });
    return exact.concat(rest).slice(0, 30);
  }
  function renderPick() {
    var q = pickInput.value.trim();
    results = search(q);
    if (!q) { pick.classList.remove('is-open'); return; }
    hl = Math.min(hl, Math.max(0, results.length - 1));
    pickRes.innerHTML = results.length ? results.map(function (a, i) {
      var added = lines.some(function (l) { return l.id === a.id; });
      return '<button type="button" class="inv-pick-opt' + (i === hl ? ' is-hl' : '') + (added ? ' is-added' : '') + '" data-id="' + a.id + '">' +
        '<span><small>' + esc(a.clave) + '</small><strong>' + esc(a.descripcion) + '</strong></span>' +
        '<em>' + (added ? 'Ya está en el conteo' : 'Hay ' + I.num(a.existencia)) + '</em></button>';
    }).join('') : '<p class="inv-pick-none">No hay artículos con «' + esc(q) + '».</p>';
    pick.classList.add('is-open');
  }
  pickInput.addEventListener('input', function () { hl = 0; renderPick(); });
  pickInput.addEventListener('focus', function () { if (pickInput.value.trim()) renderPick(); });
  pickInput.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); hl = Math.min(results.length - 1, hl + 1); renderPick(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); hl = Math.max(0, hl - 1); renderPick(); }
    if (e.key === 'Enter') {
      e.preventDefault();
      var v = pickInput.value.trim();
      // Número de rastreo escaneado (AVT000123): cuenta 1 de su artículo.
      if (I.isRastreo(v)) {
        I.lookupRastreo(v).then(function (d) {
          if (!d.articulo || !byId[d.articulo.id]) { I.toast(v.toUpperCase() + ': su artículo ya no existe o es servicio.', 'error'); return; }
          if (d.pieza.estado !== 'disponible') I.toast(d.pieza.numero + ' aparece como ' + (d.pieza.estado === 'vendida' ? 'vendida' : 'dada de baja') + '; revisa esa pieza.', 'error');
          addLine(d.articulo.id, true);
        }).catch(function (err) { I.toast(err.message, 'error'); });
        return;
      }
      if (results[hl]) addLine(results[hl].id, true);
    }
    if (e.key === 'Escape') { pick.classList.remove('is-open'); }
  });
  pickRes.addEventListener('mousedown', function (e) { e.preventDefault(); });
  pickRes.addEventListener('click', function (e) {
    var o = e.target.closest('.inv-pick-opt');
    if (o) addLine(Number(o.getAttribute('data-id')), true);
  });
  document.addEventListener('click', function (e) { if (!e.target.closest('#pick')) pick.classList.remove('is-open'); });

  // Agregar al conteo. Si ya estaba, se suma 1 a lo contado (como al
  // escanear varias veces el mismo código) y se enfoca su casilla.
  function addLine(id, fromSearch) {
    var l = lines.filter(function (x) { return x.id === id; })[0];
    if (l) {
      if (fromSearch) l.contado = (Number(l.contado) || 0) + 1;
    } else {
      l = { id: id, contado: fromSearch ? 1 : '' };
      lines.unshift(l);
    }
    if (fromSearch) { pickInput.value = ''; pick.classList.remove('is-open'); }
    save(); renderLines();
    var inp = $('cntBody').querySelector('input[data-id="' + id + '"]');
    if (inp && fromSearch) { inp.closest('tr').classList.add('is-flash'); }
    if (fromSearch) pickInput.focus();
  }

  /* ---------- agregar todos (por departamento / categoría) ---------- */
  var bDep = '', bCat = '';
  var bulkDep = I.select($('bulkDep'), { placeholder: 'Todos los departamentos', onChange: function (v) { bDep = v; bCat = ''; buildBulkCats(); } });
  var bulkCat = I.select($('bulkCat'), { placeholder: 'Todas las categorías', onChange: function (v) { bCat = v; } });
  function buildBulk() {
    bulkDep.setOptions([{ value: '', label: 'Todos los departamentos' }].concat(deps.map(function (d) { return { value: String(d.id), label: d.nombre }; })));
    bulkDep.set(bDep, true);
    buildBulkCats();
  }
  function buildBulkCats() {
    var d = deps.filter(function (x) { return String(x.id) === bDep; })[0];
    bulkCat.setOptions([{ value: '', label: 'Todas las categorías' }].concat(d ? d.categorias.map(function (c) { return { value: String(c.id), label: c.nombre }; }) : []));
    bulkCat.set(bCat, true);
  }
  $('bulkAdd').addEventListener('click', function () {
    var add = items.filter(function (a) {
      if (bDep && String(a.departamento_id) !== bDep) return false;
      if (bCat && String(a.categoria_id) !== bCat) return false;
      return !lines.some(function (l) { return l.id === a.id; });
    });
    if (!add.length) { I.toast('Esos artículos ya están en el conteo.'); return; }
    add.sort(function (x, y) { return x.descripcion < y.descripcion ? -1 : 1; });
    lines = lines.concat(add.map(function (a) { return { id: a.id, contado: '' }; }));
    save(); renderLines();
    I.toast('Se agregaron ' + add.length + ' artículos. Escribe cuántos contaste de cada uno.');
  });

  /* ---------- tabla del conteo ---------- */
  function diffOf(l) {
    if (l.contado === '' || l.contado == null) return null;
    return Number(l.contado) - byId[l.id].existencia;
  }
  function diffHTML(d) {
    if (d == null) return '<span class="inv-muted">Sin contar</span>';
    var cls = d > 0 ? 'is-up' : d < 0 ? 'is-down' : 'is-zero';
    return '<span class="inv-diff ' + cls + '">' + (d > 0 ? '+' : '') + I.num(d) + '</span>';
  }
  function renderLines() {
    $('cntEmpty').hidden = lines.length > 0;
    $('cntBody').innerHTML = lines.map(function (l, i) {
      var a = byId[l.id];
      var on = l.sel !== false;
      return '<tr data-id="' + a.id + '" class="' + (on ? '' : 'is-off') + '" style="--i:' + Math.min(i, 20) + '">' +
        '<td class="c-sel"><label class="inv-sel" title="' + (on ? 'Se ajusta' : 'No se ajusta (se queda en el conteo)') + '"><input type="checkbox" class="inv-sel-input" data-id="' + a.id + '"' + (on ? ' checked' : '') + '><span class="inv-check-box"></span></label></td>' +
        '<td class="inv-cell-art"><span class="inv-clave">' + esc(a.clave) + (a.localizacion ? '<em> · ' + esc(a.localizacion) + '</em>' : '') + '</span><strong>' + esc(a.descripcion) + '</strong><small class="inv-m-only">En sistema: ' + I.num(a.existencia) + '</small></td>' +
        '<td class="num c-sis">' + I.num(a.existencia) + '</td>' +
        '<td class="num"><input type="number" min="0" step="1" inputmode="numeric" class="inv-count-input' + (l.contado === '' ? ' is-empty' : '') + '" data-id="' + a.id + '" value="' + esc(l.contado) + '" placeholder="—" aria-label="Contado de ' + esc(a.descripcion) + '"></td>' +
        '<td class="num" data-diff>' + diffHTML(diffOf(l)) + '</td>' +
        '<td class="num"><button type="button" class="inv-icon-btn is-danger" data-remove title="Quitar del conteo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button></td>' +
      '</tr>';
    }).join('');
    renderSum();
  }
  function isSel(l) { return l.sel !== false; }
  // Solo cuentan los marcados para aplicar; los demás se quedan en el conteo.
  function totals() {
    var t = { n: 0, sin: 0, up: 0, down: 0, cambian: 0, fuera: 0 };
    lines.forEach(function (l) {
      if (!isSel(l)) { t.fuera++; return; }
      t.n++;
      var d = diffOf(l);
      if (d == null) { t.sin++; return; }
      if (d > 0) t.up += d;
      if (d < 0) t.down -= d;
      if (d !== 0) t.cambian++;
    });
    return t;
  }
  function sumHTML(t) {
    return '<span><b>' + I.num(t.n) + '</b> ' + (t.n === 1 ? 'artículo' : 'artículos') + '</span>' +
      (t.sin ? '<span><b>' + I.num(t.sin) + '</b> sin contar</span>' : '') +
      '<span class="is-up">Sobrantes <b>+' + I.num(t.up) + '</b></span>' +
      '<span class="is-down">Faltantes <b>−' + I.num(t.down) + '</b></span>';
  }
  function renderSum() {
    var t = totals();
    $('cntSum').innerHTML = lines.length ? sumHTML(t) + (t.fuera ? '<span class="is-off">' + I.num(t.fuera) + ' sin marcar</span>' : '') : '';
    $('cntCaption').textContent = lines.length ? (t.cambian ? t.cambian + (t.cambian === 1 ? ' artículo cambia' : ' artículos cambian') + ' su existencia' : 'Ningún artículo cambia todavía') +
      (t.fuera ? ' · ' + t.fuera + (t.fuera === 1 ? ' no se ajusta' : ' no se ajustan') : '') : '';
    var btn = $('cntApply');
    btn.disabled = !t.n || t.sin > 0;
    btn.title = t.sin ? 'Faltan ' + t.sin + ' por contar' : '';
    btn.textContent = !lines.length ? 'Aplicar ajuste' : !t.n ? 'Marca qué ajustar' : t.sin ? 'Faltan ' + t.sin + ' por contar' : (t.fuera ? 'Aplicar ' + t.n + ' de ' + lines.length : 'Aplicar ajuste');
    $('cntClear').disabled = !lines.length;
    $('cntSelQuick').hidden = !lines.length;
    var all = $('cntSelAll');
    all.checked = lines.length > 0 && !t.fuera;
    all.indeterminate = t.fuera > 0 && t.fuera < lines.length;
  }
  function setSel(id, on) {
    var l = lines.filter(function (x) { return x.id === id; })[0];
    if (!l) return;
    if (on) delete l.sel; else l.sel = false;
    var tr = $('cntBody').querySelector('tr[data-id="' + id + '"]');
    if (tr) {
      tr.classList.toggle('is-off', !on);
      var cb = tr.querySelector('.inv-sel-input'); if (cb) cb.checked = on;
    }
  }
  $('cntBody').addEventListener('change', function (e) {
    var cb = e.target.closest('.inv-sel-input');
    if (!cb) return;
    setSel(Number(cb.getAttribute('data-id')), cb.checked);
    save(); renderSum();
  });
  $('cntSelAll').addEventListener('change', function () {
    var on = this.checked;
    lines.forEach(function (l) { setSel(l.id, on); });
    save(); renderSum();
  });
  $('cntSelQuick').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-sel]');
    if (!b) return;
    var m = b.getAttribute('data-sel');
    lines.forEach(function (l) {
      var d = diffOf(l);
      setSel(l.id, m === 'todos' || (m === 'diferencia' && d != null && d !== 0));
    });
    b.classList.remove('is-pop'); void b.offsetWidth; b.classList.add('is-pop');
    save(); renderSum();
  });
  $('cntBody').addEventListener('input', function (e) {
    var inp = e.target.closest('.inv-count-input');
    if (!inp) return;
    var id = Number(inp.getAttribute('data-id'));
    var l = lines.filter(function (x) { return x.id === id; })[0];
    var v = inp.value.replace(/[^\d]/g, '');
    if (v !== inp.value) inp.value = v;
    l.contado = v === '' ? '' : Number(v);
    inp.classList.toggle('is-empty', v === '');
    inp.closest('tr').querySelector('[data-diff]').innerHTML = diffHTML(diffOf(l));
    save(); renderSum();
  });
  $('cntBody').addEventListener('keydown', function (e) {
    var inp = e.target.closest('.inv-count-input');
    if (!inp || (e.key !== 'Enter' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    e.preventDefault();
    var all = Array.prototype.slice.call($('cntBody').querySelectorAll('.inv-count-input'));
    var i = all.indexOf(inp) + (e.key === 'ArrowUp' ? -1 : 1);
    if (all[i]) { all[i].focus(); all[i].select(); } else if (e.key === 'Enter') pickInput.focus();
  });
  $('cntBody').addEventListener('click', function (e) {
    var rm = e.target.closest('[data-remove]');
    if (!rm) return;
    var id = Number(rm.closest('tr').getAttribute('data-id'));
    lines = lines.filter(function (l) { return l.id !== id; });
    save(); renderLines();
  });
  // Vaciar: hay que tocarlo dos veces (para no perder un conteo por error).
  var clearTimer = null;
  $('cntClear').addEventListener('click', function () {
    var btn = this;
    if (!lines.length) return;
    if (!btn.classList.contains('is-confirm')) {
      btn.classList.add('is-confirm');
      btn.lastChild.textContent = '¿Seguro? Toca otra vez';
      clearTimeout(clearTimer);
      clearTimer = setTimeout(function () { btn.classList.remove('is-confirm'); btn.lastChild.textContent = 'Vaciar'; }, 3000);
      return;
    }
    clearTimeout(clearTimer);
    btn.classList.remove('is-confirm'); btn.lastChild.textContent = 'Vaciar';
    lines = []; $('cntComentario').value = ''; save(); renderLines();
    I.toast('Se vació el conteo.');
  });
  $('cntComentario').addEventListener('input', save);

  function save() {
    try { localStorage.setItem(DRAFT, JSON.stringify({ lines: lines, comentario: $('cntComentario').value })); } catch (e) {}
  }
  function restore() {
    try {
      var d = JSON.parse(localStorage.getItem(DRAFT) || 'null');
      if (d && Array.isArray(d.lines)) {
        lines = d.lines.filter(function (l) { return l && l.id; });
        $('cntComentario').value = d.comentario || '';
      }
    } catch (e) {}
  }

  /* ---------- aplicar ---------- */
  $('cntApply').addEventListener('click', function () {
    var t = totals();
    if (!t.n || t.sin) return;
    $('confirmText').innerHTML = (t.cambian
      ? 'Las existencias de <strong>' + t.cambian + '</strong> ' + (t.cambian === 1 ? 'artículo' : 'artículos') + ' quedan en lo que contaste. Los demás marcados se registran como contados sin diferencia.'
      : 'Ningún artículo cambia: todo coincide con el sistema. Igual queda registrado el conteo.') +
      (t.fuera ? '<br><br><strong>' + t.fuera + '</strong> ' + (t.fuera === 1 ? 'artículo sin marcar no se ajusta' : 'artículos sin marcar no se ajustan') + ' y se ' + (t.fuera === 1 ? 'queda' : 'quedan') + ' en el conteo.' : '');
    $('confirmSum').innerHTML = sumHTML(t);
    $('confirmError').textContent = '';
    I.openModal($('confirmModal'));
  });
  $('confirmOk').addEventListener('click', function () {
    var btn = this; btn.disabled = true; btn.textContent = 'Aplicando…';
    var body = { comentario: $('cntComentario').value.trim(), lineas: lines.filter(isSel).map(function (l) { return { item_id: l.id, contado: Number(l.contado) }; }) };
    I.api('/api/inventario/ajustes', { method: 'POST', body: body }).then(function (d) {
      I.closeModal($('confirmModal'));
      // Los que no se marcaron se quedan en el conteo para después.
      lines = lines.filter(function (l) { return !isSel(l); });
      if (!lines.length) $('cntComentario').value = '';
      save();
      I.toast('Ajuste #' + d.ajuste.folio + ' aplicado: ' + d.ajuste.cambiados + ' de ' + d.ajuste.articulos + ' artículos cambiaron.');
      return loadCatalog().then(function () { openDetail(d.ajuste.folio); });
    }).catch(function (e) { $('confirmError').textContent = e.message; })
      .finally(function () { btn.disabled = false; btn.textContent = 'Sí, aplicar'; });
  });

  /* =======================================================
     CONSULTAR AJUSTES
     ======================================================= */
  var per = 'mes';
  var dpDesde = I.datePicker($('perDesde'), { onChange: loadAjustes, range: function () { return [dpDesde.get(), dpHasta.get()]; } });
  var dpHasta = I.datePicker($('perHasta'), { onChange: loadAjustes, alignEnd: true, range: function () { return [dpDesde.get(), dpHasta.get()]; } });
  $('perSeg').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-p]');
    if (!b) return;
    per = b.getAttribute('data-p');
    Array.prototype.forEach.call($('perSeg').querySelectorAll('button'), function (x) { x.classList.toggle('is-on', x === b); });
    $('perRange').hidden = per !== 'rango';
    if (per === 'rango' && !dpDesde.get()) { var r = I.periodo('mes'); dpDesde.set(r[0]); dpHasta.set(r[1]); }
    loadAjustes();
  });
  var ajReq = 0;
  function loadAjustes() {
    var r = I.periodo(per, dpDesde.get(), dpHasta.get());
    var my = ++ajReq;
    $('ajBody').classList.add('is-loading');
    I.api('/api/inventario/ajustes?desde=' + r[0] + '&hasta=' + r[1]).then(function (d) {
      if (my !== ajReq) return;
      var rows = d.items || [];
      $('ajCaption').textContent = (r[0] === r[1] ? I.fecha(r[0]) : I.fecha(r[0]) + ' – ' + I.fecha(r[1])) + ' · ' + rows.length + (rows.length === 1 ? ' ajuste' : ' ajustes');
      $('ajEmpty').hidden = rows.length > 0;
      $('ajEmpty').textContent = 'No hay ajustes en este periodo.';
      $('ajBody').innerHTML = rows.map(function (a, i) {
        return '<tr data-folio="' + a.folio + '" style="--i:' + Math.min(i, 20) + '">' +
          '<td><strong>#' + a.folio + '</strong></td>' +
          '<td>' + esc(I.fechaHora(a.fecha)) + '</td>' +
          '<td><span class="inv-chip t-' + esc(a.tipo) + '">' + esc(TIPOS[a.tipo] || a.tipo) + '</span></td>' +
          '<td class="num">' + I.num(a.articulos) + (a.cambiados !== a.articulos ? ' <span class="inv-muted">(' + a.cambiados + ' cambian)</span>' : '') + '</td>' +
          '<td class="num">' + (a.sobrantes ? '<span class="inv-qty is-up">+' + I.num(a.sobrantes) + '</span>' : '<span class="inv-muted">0</span>') + '</td>' +
          '<td class="num">' + (a.faltantes ? '<span class="inv-qty is-down">−' + I.num(a.faltantes) + '</span>' : '<span class="inv-muted">0</span>') + '</td>' +
          '<td>' + esc(a.usuario || '—') + '</td>' +
          '<td>' + (a.comentario ? esc(a.comentario) : '<span class="inv-muted">—</span>') + '</td>' +
        '</tr>';
      }).join('');
    }).catch(function (e) { $('ajCaption').textContent = e.message; })
      .finally(function () { $('ajBody').classList.remove('is-loading'); });
  }
  $('ajBody').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-folio]');
    if (tr) openDetail(Number(tr.getAttribute('data-folio')));
  });

  function openDetail(folio) {
    $('detTitle').textContent = 'Ajuste #' + folio;
    $('detBody').innerHTML = '<p class="inv-empty">Cargando…</p>';
    I.openModal($('detModal'));
    I.api('/api/inventario/ajustes/' + folio).then(function (d) {
      var a = d.ajuste;
      $('detBody').innerHTML =
        '<div class="inv-d-head">' +
          '<div><small>Fecha</small><strong>' + esc(I.fechaHora(a.fecha)) + '</strong></div>' +
          '<div><small>Tipo</small><strong><span class="inv-chip t-' + esc(a.tipo) + '">' + esc(TIPOS[a.tipo] || a.tipo) + '</span></strong></div>' +
          '<div><small>Hizo el ajuste</small><strong>' + esc(a.usuario || '—') + '</strong></div>' +
          '<div><small>Comentario</small><strong>' + esc(a.comentario || '—') + '</strong></div>' +
        '</div>' +
        '<div class="inv-count-sum" style="margin-bottom:12px">' + sumHTML({ n: a.articulos, sin: 0, up: a.sobrantes, down: a.faltantes }) + '</div>' +
        '<div class="inv-table-wrap is-auto"><table class="inv-mini-table"><thead><tr><th>Artículo</th><th class="num">Antes</th><th class="num">Después</th><th class="num">Diferencia</th></tr></thead><tbody>' +
        a.lineas.map(function (l, i) {
          return '<tr style="--i:' + Math.min(i, 20) + '"><td><span class="inv-clave">' + esc(l.clave) + '</span><strong>' + esc(l.descripcion) + '</strong></td>' +
            '<td class="num">' + I.num(l.antes) + '</td><td class="num">' + I.num(l.despues) + '</td><td class="num">' + diffHTML(l.diferencia) + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<div class="inv-det-tools" id="detTools">' +
          '<button type="button" class="inv-btn-ghost" data-ex="xlsx">' + ICONS.xlsx + 'Excel</button>' +
          '<button type="button" class="inv-btn-ghost" data-ex="pdf">' + ICONS.pdf + 'PDF</button>' +
          '<button type="button" class="inv-btn-ghost" data-ex="print">' + ICONS.print + 'Imprimir</button>' +
          '<button type="button" class="inv-btn-ghost is-wa" data-ex="wa">' + ICONS.wa + 'WhatsApp</button>' +
          '<button type="button" class="inv-btn-ghost" data-ex="mail">' + ICONS.mail + 'Correo</button>' +
          '<button type="button" class="inv-btn-ghost is-por" data-ex="por">' + ICONS.list + 'Por ajustar</button>' +
        '</div>' +
        '<div class="inv-share" id="detShare" hidden></div>' +
        '<div class="inv-por" id="detPor" hidden></div>' +
        '<div class="staff-form-actions"><button type="button" class="btn solid small" data-close-modal>Cerrar</button></div>';
      curAj = a; curShare = d.share ? location.origin + d.share : '';
    }).catch(function (e) { $('detBody').innerHTML = '<p class="inv-empty">' + esc(e.message) + '</p>'; });
  }
  var curAj = null, curShare = '';

  /* =======================================================
     EXPORTAR / COMPARTIR / POR AJUSTAR / HOJA DE CONTEO
     ======================================================= */
  var ICONS = {
    xlsx: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13l4 5M12 13l-4 5"/></svg>',
    pdf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M12 18v-6M9 15l3 3 3-3"/></svg>',
    print: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>',
    wa: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.4a.5.5 0 0 0 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .1-1.2c0-.1-.2-.2-.4-.3z"/></svg>',
    mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6h11M9 12h11M9 18h11"/><path d="m3 6 1 1 2-2M3 12l1 1 2-2"/><circle cx="4.5" cy="18" r="1.2"/></svg>'
  };

  // Librerías (las mismas que ya usa recepción para exportar), solo al usarlas.
  var LIBS = {
    xlsx: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
    jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    autotable: 'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.4/dist/jspdf.plugin.autotable.min.js',
    barcode: 'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js'
  };
  var libP = {};
  function lib(name) {
    if (!libP[name]) libP[name] = new Promise(function (ok, fail) {
      var sc = document.createElement('script');
      sc.src = LIBS[name]; sc.onload = ok;
      sc.onerror = function () { delete libP[name]; fail(new Error('No se pudo cargar la herramienta para exportar. Revisa tu internet.')); };
      document.head.appendChild(sc);
    });
    return libP[name];
  }
  function pdfLibs() { return lib('jspdf').then(function () { return lib('autotable'); }); }
  function signed(d) { return d > 0 ? '+' + d : d < 0 ? '−' + Math.abs(d) : '0'; }
  // El PDF usa la letra estándar (sin "−"): ahí va el guion normal.
  function signedPdf(d) { return d > 0 ? '+' + d : d < 0 ? '-' + Math.abs(d) : '0'; }
  function ahoraLocal() { var d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19); }
  function hoyTxt() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function tipoTxt(a) { return TIPOS[a.tipo] || a.tipo; }

  /* ---------- Excel ---------- */
  function xlsxDownload(name, sheets) {
    return lib('xlsx').then(function () {
      var wb = XLSX.utils.book_new();
      sheets.forEach(function (sh) {
        var ws = XLSX.utils.aoa_to_sheet(sh.rows);
        ws['!cols'] = sh.cols.map(function (w) { return { wch: w }; });
        XLSX.utils.book_append_sheet(wb, ws, sh.name.slice(0, 31));
      });
      XLSX.writeFile(wb, name);
    });
  }
  function ajusteXlsx(a) {
    var rows = [
      [I.biz + ' · Ajuste de inventario #' + a.folio],
      ['Fecha', I.fechaHora(a.fecha)], ['Tipo', tipoTxt(a)], ['Hizo el ajuste', a.usuario || '—'], ['Comentario', a.comentario || '—'],
      ['Artículos', a.articulos, 'Cambiaron', a.cambiados, 'Sobrantes', a.sobrantes, 'Faltantes', a.faltantes],
      [],
      ['Clave', 'Descripción', 'Antes', 'Contado', 'Diferencia']
    ].concat(a.lineas.map(function (l) { return [l.clave, l.descripcion, l.antes, l.despues, l.diferencia]; }));
    return xlsxDownload('ajuste-' + a.folio + '.xlsx', [{ name: 'Ajuste ' + a.folio, rows: rows, cols: [16, 46, 10, 10, 12, 10, 12, 10] }]);
  }

  /* ---------- PDF ---------- */
  function pdfDoc(title, meta, head, body, colorCol) {
    var doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'letter' });
    var W = doc.internal.pageSize.getWidth();
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(16, 19, 46);
    doc.text(title, 40, 50);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(93, 99, 128);
    doc.text(I.biz + ' · generado el ' + I.fechaHora(ahoraLocal()), W - 40, 50, { align: 'right' });
    var y = 74;
    meta.forEach(function (m) {
      doc.setFont('helvetica', 'bold'); doc.setTextColor(16, 19, 46); doc.text(m[0] + ':', 40, y);
      doc.setFont('helvetica', 'normal'); doc.text(String(m[1]), 140, y, { maxWidth: W - 180 });
      y += 15;
    });
    doc.autoTable({
      startY: y + 6, head: [head], body: body, margin: { left: 40, right: 40 },
      styles: { fontSize: 9, cellPadding: 5, textColor: [16, 19, 46] },
      headStyles: { fillColor: [6, 182, 212], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [236, 254, 255] },
      columnStyles: head.reduce(function (o, h, i) { if (i >= 2 && h !== 'Departamento' && h !== 'Localización') o[i] = { halign: 'right' }; return o; }, {}),
      didParseCell: function (data) {
        var h = head[data.column.index];
        if (data.section === 'head' && data.column.index >= 2 && h !== 'Departamento' && h !== 'Localización') data.cell.styles.halign = 'right';
        if (colorCol != null && data.section === 'body' && data.column.index === colorCol) {
          var v = String(data.cell.raw || '');
          if (v.charAt(0) === '+') { data.cell.styles.textColor = [15, 138, 75]; data.cell.styles.fontStyle = 'bold'; }
          else if (v.charAt(0) === '-') { data.cell.styles.textColor = [198, 40, 40]; data.cell.styles.fontStyle = 'bold'; }
        }
      },
      didDrawPage: function () {
        doc.setFontSize(8); doc.setTextColor(150);
        doc.text('Página ' + doc.internal.getNumberOfPages(), W - 40, doc.internal.pageSize.getHeight() - 20, { align: 'right' });
      }
    });
    return doc;
  }
  function ajustePdf(a) {
    return pdfLibs().then(function () {
      return pdfDoc('Ajuste de inventario #' + a.folio, [
        ['Fecha', I.fechaHora(a.fecha)], ['Tipo', tipoTxt(a)], ['Hizo el ajuste', a.usuario || '—'], ['Comentario', a.comentario || '—'],
        ['Resumen', a.articulos + ' artículos · ' + a.cambiados + ' cambiaron · sobrantes +' + a.sobrantes + ' · faltantes -' + a.faltantes]
      ], ['Clave', 'Descripción', 'Antes', 'Contado', 'Diferencia'],
      a.lineas.map(function (l) { return [l.clave, l.descripcion, l.antes, l.despues, signedPdf(l.diferencia)]; }), 4);
    });
  }

  /* ---------- imprimir (ventana aparte) ---------- */
  // w: ventana ya abierta (se abre al tocar el botón, antes de esperar algo,
  // para que el navegador no la bloquee).
  function printWindow(title, html, w) {
    w = w || window.open('', '_blank');
    if (!w) { I.toast('Permite las ventanas emergentes para imprimir.', 'error'); return; }
    w.document.write('<!doctype html><html lang="es"><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>' +
      'body{font-family:Arial,Helvetica,sans-serif;color:#10132e;margin:24px}h1{font-size:18px;margin:0 0 4px}.sub{color:#5d6380;font-size:12px;margin:0 0 14px}' +
      '.meta{display:flex;flex-wrap:wrap;gap:6px 22px;font-size:12px;margin-bottom:12px}.meta b{color:#5d6380;font-weight:600}' +
      'table{width:100%;border-collapse:collapse;font-size:11.5px}th{text-align:left;background:#06b6d4;color:#fff;padding:6px 8px;font-size:10.5px;text-transform:uppercase;letter-spacing:.04em}' +
      'td{padding:6px 8px;border-bottom:1px solid #dfe2ee;vertical-align:middle}tr:nth-child(even) td{background:#f5f7ff}.n{text-align:right;white-space:nowrap}' +
      '.up{color:#0f8a4b;font-weight:700}.down{color:#c62828;font-weight:700}.k{font-family:monospace;font-weight:700;font-size:11px}.box{width:70px;height:22px;border:1.5px solid #9aa0bb;border-radius:4px}' +
      '.bc{height:30px;width:auto;max-width:230px}.bar{position:sticky;top:0;background:#fff;padding:8px 0 12px;display:flex;gap:10px;align-items:center}.bar button{padding:8px 16px;border-radius:100px;border:0;background:#06b6d4;color:#fff;font-weight:700;cursor:pointer}' +
      '@media print{.bar{display:none}body{margin:10mm}tr{page-break-inside:avoid}th{-webkit-print-color-adjust:exact;print-color-adjust:exact}}' +
      '</style></head><body><div class="bar"><button onclick="window.print()">Imprimir</button><span>' + esc(title) + '</span></div>' + html + '</body></html>');
    w.document.close();
    setTimeout(function () { try { w.focus(); w.print(); } catch (e) {} }, 350);
  }
  function ajustePrint(a) {
    printWindow('Ajuste #' + a.folio,
      '<h1>Ajuste de inventario #' + a.folio + '</h1><p class="sub">' + esc(I.biz) + ' · ' + esc(I.fechaHora(a.fecha)) + '</p>' +
      '<div class="meta"><span><b>Tipo:</b> ' + esc(tipoTxt(a)) + '</span><span><b>Hizo el ajuste:</b> ' + esc(a.usuario || '—') + '</span><span><b>Comentario:</b> ' + esc(a.comentario || '—') + '</span>' +
      '<span><b>Artículos:</b> ' + a.articulos + '</span><span class="up">Sobrantes +' + a.sobrantes + '</span><span class="down">Faltantes −' + a.faltantes + '</span></div>' +
      '<table><thead><tr><th>Clave</th><th>Descripción</th><th class="n">Antes</th><th class="n">Contado</th><th class="n">Diferencia</th></tr></thead><tbody>' +
      a.lineas.map(function (l) {
        return '<tr><td class="k">' + esc(l.clave) + '</td><td>' + esc(l.descripcion) + '</td><td class="n">' + l.antes + '</td><td class="n">' + l.despues + '</td><td class="n ' + (l.diferencia > 0 ? 'up' : l.diferencia < 0 ? 'down' : '') + '">' + signed(l.diferencia) + '</td></tr>';
      }).join('') + '</tbody></table>');
  }

  /* ---------- WhatsApp / correo ---------- */
  function shareText(a) {
    var cambios = a.lineas.filter(function (l) { return l.diferencia; }).slice(0, 8).map(function (l) {
      return '• ' + l.descripcion + ': ' + signed(l.diferencia);
    });
    var mas = a.lineas.filter(function (l) { return l.diferencia; }).length - cambios.length;
    return 'Ajuste de inventario #' + a.folio + ' · ' + I.biz + '\n' +
      I.fechaHora(a.fecha) + (a.usuario ? ' · ' + a.usuario : '') + '\n' +
      a.articulos + ' artículos contados · ' + a.cambiados + ' cambiaron\n' +
      'Sobrantes +' + a.sobrantes + ' · Faltantes −' + a.faltantes +
      (a.comentario ? '\nComentario: ' + a.comentario : '') +
      (cambios.length ? '\n\n' + cambios.join('\n') + (mas > 0 ? '\n…y ' + mas + ' más' : '') : '') +
      (curShare ? '\n\nVer el reporte completo: ' + curShare : '');
  }
  function canSharePdf() {
    try { return !!(navigator.canShare && navigator.canShare({ files: [new File(['x'], 'x.pdf', { type: 'application/pdf' })] })); } catch (e) { return false; }
  }
  function openShare(kind) {
    var box = $('detShare'), por = $('detPor');
    por.hidden = true;
    if (!box.hidden && box.getAttribute('data-kind') === kind) { box.hidden = true; return; }
    box.setAttribute('data-kind', kind);
    var wa = kind === 'wa';
    box.innerHTML =
      '<div class="inv-share-head">' + (wa ? ICONS.wa : ICONS.mail) + '<strong>' + (wa ? 'Mandar por WhatsApp' : 'Mandar por correo') + '</strong></div>' +
      '<p class="inv-share-help">' + (wa
        ? 'Se abre WhatsApp con el resumen y la liga del reporte (se puede ver e imprimir desde el celular). Deja el número vacío para elegir el contacto en WhatsApp.'
        : 'Se abre tu correo con el resumen y la liga del reporte. Si quieres el archivo, descarga el PDF y adjúntalo.') + '</p>' +
      '<div class="inv-share-row">' +
        (wa ? '<span class="inv-share-lada">+52</span><input type="tel" id="shareTo" maxlength="10" inputmode="numeric" placeholder="10 dígitos (opcional)">'
            : '<input type="email" id="shareTo" placeholder="correo@ejemplo.com (opcional)">') +
        '<button type="button" class="btn solid small" id="shareGo">' + (wa ? 'Abrir WhatsApp' : 'Abrir correo') + '</button>' +
        (canSharePdf() ? '<button type="button" class="inv-btn-ghost" id="sharePdf">' + ICONS.pdf + 'Compartir el PDF</button>' : '') +
      '</div><p class="staff-error" id="shareErr"></p>';
    box.hidden = false;
    box.classList.remove('is-in'); void box.offsetWidth; box.classList.add('is-in');
    var to = $('shareTo');
    try { to.value = localStorage.getItem(wa ? 'attomosAjWa' : 'attomosAjMail') || ''; } catch (e) {}
    if (wa) to.addEventListener('input', function () { this.value = this.value.replace(/\D/g, '').slice(0, 10); });
    to.focus();
    $('shareGo').addEventListener('click', function () {
      var v = to.value.trim();
      $('shareErr').textContent = '';
      if (wa && v && v.length !== 10) { $('shareErr').textContent = 'El celular debe tener 10 dígitos.'; return; }
      if (!wa && v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { $('shareErr').textContent = 'Revisa el correo.'; return; }
      try { localStorage.setItem(wa ? 'attomosAjWa' : 'attomosAjMail', v); } catch (e) {}
      var txt = shareText(curAj);
      if (wa) window.open('https://wa.me/' + (v ? '52' + v : '') + '?text=' + encodeURIComponent(txt), '_blank', 'noopener');
      else location.href = 'mailto:' + encodeURIComponent(v) + '?subject=' + encodeURIComponent('Ajuste de inventario #' + curAj.folio + ' · ' + I.biz) + '&body=' + encodeURIComponent(txt);
    });
    if ($('sharePdf')) $('sharePdf').addEventListener('click', function () {
      var btn = this; btn.disabled = true;
      ajustePdf(curAj).then(function (doc) {
        var file = new File([doc.output('blob')], 'ajuste-' + curAj.folio + '.pdf', { type: 'application/pdf' });
        return navigator.share({ files: [file], title: 'Ajuste #' + curAj.folio, text: 'Ajuste de inventario #' + curAj.folio + ' · ' + I.biz });
      }).catch(function (err) { if (err && err.name !== 'AbortError') I.toast(err.message || 'No se pudo compartir.', 'error'); })
        .finally(function () { btn.disabled = false; });
    });
  }

  /* ---------- Por ajustar: lo que NO se contó en este ajuste ---------- */
  var porSoloDeps = true;
  function porList(a) {
    var contados = {}, depsAj = {};
    a.lineas.forEach(function (l) {
      contados[l.item_id] = true;
      var it = byId[l.item_id]; if (it) depsAj[it.departamento_id || 0] = true;
    });
    return items.filter(function (it) {
      if (contados[it.id]) return false;
      return !porSoloDeps || depsAj[it.departamento_id || 0];
    }).sort(function (x, y) {
      return (x.departamento || '').localeCompare(y.departamento || '') || (x.descripcion || '').localeCompare(y.descripcion || '');
    });
  }
  function renderPor() {
    var a = curAj, list = porList(a), box = $('detPor');
    box.innerHTML =
      '<div class="inv-share-head">' + ICONS.list + '<strong>Por ajustar</strong><span class="inv-por-n">' + list.length + '</span></div>' +
      '<p class="inv-share-help">Artículos que <strong>no se contaron</strong> en el ajuste #' + a.folio + '. La existencia es la de hoy.</p>' +
      '<div class="inv-por-tools">' +
        '<div class="inv-seg" id="porScope"><button type="button" data-s="deps" class="' + (porSoloDeps ? 'is-on' : '') + '">Departamentos contados</button><button type="button" data-s="todos" class="' + (porSoloDeps ? '' : 'is-on') + '">Todo</button></div>' +
        '<div class="inv-por-ex">' +
          '<button type="button" class="inv-btn-ghost" data-por="xlsx"' + (list.length ? '' : ' disabled') + '>' + ICONS.xlsx + 'Excel</button>' +
          '<button type="button" class="inv-btn-ghost" data-por="pdf"' + (list.length ? '' : ' disabled') + '>' + ICONS.pdf + 'PDF</button>' +
          '<button type="button" class="inv-btn-ghost" data-por="print"' + (list.length ? '' : ' disabled') + '>' + ICONS.print + 'Imprimir</button>' +
          '<button type="button" class="btn solid small" data-por="contar"' + (list.length ? '' : ' disabled') + '>Contarlos ahora</button>' +
        '</div>' +
      '</div>' +
      (list.length
        ? '<div class="inv-table-wrap is-auto inv-por-table"><table class="inv-mini-table"><thead><tr><th>Artículo</th><th>Departamento</th><th class="num">En sistema</th></tr></thead><tbody>' +
          list.slice(0, 300).map(function (it, i) {
            return '<tr style="--i:' + Math.min(i, 20) + '"><td><span class="inv-clave">' + esc(it.clave) + (it.localizacion ? '<em> · ' + esc(it.localizacion) + '</em>' : '') + '</span><strong>' + esc(it.descripcion) + '</strong></td><td>' + esc(it.departamento || '—') + '</td><td class="num">' + I.num(it.existencia) + '</td></tr>';
          }).join('') + '</tbody></table>' + (list.length > 300 ? '<p class="inv-muted" style="padding:8px 4px">…y ' + (list.length - 300) + ' más (salen todos en Excel, PDF e Imprimir).</p>' : '') + '</div>'
        : '<p class="inv-empty">Se contó todo' + (porSoloDeps ? ' lo de esos departamentos' : ' el inventario') + '. 🎉</p>');
  }
  function porRows(list) { return list.map(function (it) { return [it.clave, it.descripcion, it.departamento || '—', it.localizacion || '—', it.existencia]; }); }
  $('detBody').addEventListener('click', function (e) {
    var b = e.target.closest('[data-ex]');
    if (b && curAj) {
      var k = b.getAttribute('data-ex');
      if (k === 'wa' || k === 'mail') { openShare(k); return; }
      if (k === 'por') {
        $('detShare').hidden = true;
        var box = $('detPor');
        if (!box.hidden) { box.hidden = true; return; }
        renderPor(); box.hidden = false;
        box.classList.remove('is-in'); void box.offsetWidth; box.classList.add('is-in');
        box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        return;
      }
      b.disabled = true;
      var p = k === 'xlsx' ? ajusteXlsx(curAj) : k === 'pdf' ? ajustePdf(curAj).then(function (doc) { doc.save('ajuste-' + curAj.folio + '.pdf'); }) : Promise.resolve(ajustePrint(curAj));
      p.catch(function (err) { I.toast(err.message, 'error'); }).finally(function () { b.disabled = false; });
      return;
    }
    var sc = e.target.closest('#porScope button[data-s]');
    if (sc) { porSoloDeps = sc.getAttribute('data-s') === 'deps'; renderPor(); return; }
    var pb = e.target.closest('[data-por]');
    if (pb && curAj) {
      var kind = pb.getAttribute('data-por'), list = porList(curAj);
      if (kind === 'contar') {
        var nuevos = list.filter(function (it) { return !lines.some(function (l) { return l.id === it.id; }); });
        if (!nuevos.length) { I.toast('Esos artículos ya están en el conteo en curso.'); return; }
        lines = lines.concat(nuevos.map(function (it) { return { id: it.id, contado: '' }; }));
        save(); renderLines();
        I.closeModal($('detModal')); setMode('nuevo');
        I.toast('Se agregaron ' + nuevos.length + ' artículos al conteo. Escribe cuántos contaste de cada uno.');
        return;
      }
      var title = 'Por ajustar · ajuste #' + curAj.folio;
      var head = ['Clave', 'Descripción', 'Departamento', 'Localización', 'En sistema'];
      if (kind === 'xlsx') {
        xlsxDownload('por-ajustar-' + curAj.folio + '.xlsx', [{ name: 'Por ajustar', cols: [16, 46, 20, 16, 12], rows: [[title], ['Artículos que no se contaron · ' + list.length], [], head].concat(porRows(list)) }])
          .catch(function (err) { I.toast(err.message, 'error'); });
      } else if (kind === 'pdf') {
        pdfLibs().then(function () {
          pdfDoc('Por ajustar', [['Ajuste', '#' + curAj.folio + ' · ' + I.fechaHora(curAj.fecha)], ['Artículos sin contar', list.length], ['Alcance', porSoloDeps ? 'Departamentos contados' : 'Todo el inventario']], head, porRows(list), null)
            .save('por-ajustar-' + curAj.folio + '.pdf');
        }).catch(function (err) { I.toast(err.message, 'error'); });
      } else {
        printWindow(title, '<h1>Por ajustar</h1><p class="sub">Artículos que no se contaron en el ajuste #' + curAj.folio + ' · ' + list.length + '</p>' +
          '<table><thead><tr><th>Clave</th><th>Descripción</th><th>Departamento</th><th>Localización</th><th class="n">En sistema</th></tr></thead><tbody>' +
          list.map(function (it) { return '<tr><td class="k">' + esc(it.clave) + '</td><td>' + esc(it.descripcion) + '</td><td>' + esc(it.departamento || '—') + '</td><td>' + esc(it.localizacion || '—') + '</td><td class="n">' + it.existencia + '</td></tr>'; }).join('') +
          '</tbody></table>');
      }
    }
  });

  /* ---------- Hoja de conteo (para contar a mano) ---------- */
  var hFuente = 'depto', hOrden = 'localizacion', hDep = '', hCat = '';
  var hojaDep = I.select($('hojaDep'), { placeholder: 'Todos los departamentos', onChange: function (v) { hDep = v; hCat = ''; buildHojaCats(); hojaCount(); } });
  var hojaCat = I.select($('hojaCat'), { placeholder: 'Todas las categorías', onChange: function (v) { hCat = v; hojaCount(); } });
  function buildHojaCats() {
    var d = deps.filter(function (x) { return String(x.id) === hDep; })[0];
    hojaCat.setOptions([{ value: '', label: 'Todas las categorías' }].concat(d ? d.categorias.map(function (c) { return { value: String(c.id), label: c.nombre }; }) : []));
    hojaCat.set(hCat, true);
  }
  function hojaItems() {
    var list = hFuente === 'conteo'
      ? lines.map(function (l) { return byId[l.id]; }).filter(Boolean)
      : items.filter(function (a) { return (!hDep || String(a.departamento_id) === hDep) && (!hCat || String(a.categoria_id) === hCat); });
    var key = hOrden;
    return list.slice().sort(function (x, y) {
      var a = String(x[key] || ''), b = String(y[key] || '');
      if (key === 'localizacion' && !a !== !b) return a ? -1 : 1; // sin localización al final
      return a.localeCompare(b, 'es', { numeric: true }) || (x.descripcion || '').localeCompare(y.descripcion || '');
    });
  }
  function hojaCount() {
    var n = hojaItems().length;
    $('hojaCount').textContent = n ? n + (n === 1 ? ' artículo' : ' artículos') + ' en la hoja.' : 'No hay artículos con esos filtros.';
    $('hojaPrint').disabled = !n;
  }
  function segPick(host, attr, cb) {
    host.addEventListener('click', function (e) {
      var b = e.target.closest('button[' + attr + ']');
      if (!b || b.disabled) return;
      host.querySelectorAll('button').forEach(function (x) { x.classList.toggle('is-on', x === b); });
      cb(b.getAttribute(attr));
    });
  }
  segPick($('hojaFuente'), 'data-f', function (v) { hFuente = v; $('hojaDeptoRow').hidden = v !== 'depto'; hojaCount(); });
  segPick($('hojaOrden'), 'data-o', function (v) { hOrden = v; });
  $('hojaOpen').addEventListener('click', function () {
    hojaDep.setOptions([{ value: '', label: 'Todos los departamentos' }].concat(deps.map(function (d) { return { value: String(d.id), label: d.nombre }; })));
    if (!hDep && bDep) { hDep = bDep; hCat = bCat; }
    hojaDep.set(hDep, true); buildHojaCats();
    var conteoBtn = $('hojaFuente').querySelector('[data-f="conteo"]');
    conteoBtn.disabled = !lines.length;
    conteoBtn.textContent = lines.length ? 'Los del conteo (' + lines.length + ')' : 'Los del conteo';
    if (!lines.length && hFuente === 'conteo') $('hojaFuente').querySelector('[data-f="depto"]').click();
    hojaCount();
    I.openModal($('hojaModal'));
  });
  // Código de barras como SVG (se dibuja aquí y se pasa a la ventana de impresión).
  function barcodeSVG(text) {
    try {
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      window.JsBarcode(svg, text, { format: 'CODE128', width: 1.3, height: 30, margin: 0, displayValue: false });
      svg.setAttribute('class', 'bc');
      return svg.outerHTML;
    } catch (e) { return ''; }
  }
  $('hojaPrint').addEventListener('click', function () {
    var list = hojaItems(), barras = $('hojaBarras').checked, exist = $('hojaExist').checked;
    var w = window.open('', '_blank');
    if (!w) { I.toast('Permite las ventanas emergentes para imprimir.', 'error'); return; }
    w.document.write('<p style="font-family:Arial;padding:20px;color:#5d6380">Preparando la hoja…</p>');
    (barras ? lib('barcode') : Promise.resolve()).then(function () { buildHoja(w, list, barras, exist); })
      .catch(function (err) { buildHoja(w, list, false, exist); I.toast(err.message + ' Se imprimió sin códigos de barras.', 'error'); });
    I.closeModal($('hojaModal'));
  });
  function buildHoja(w, list, barras, exist) {
    var dep = deps.filter(function (x) { return String(x.id) === hDep; })[0];
    var alcance = hFuente === 'conteo' ? 'Artículos del conteo en curso' : (dep ? dep.nombre : 'Todos los departamentos');
    var html = '<h1>Hoja de conteo</h1><p class="sub">' + esc(I.biz) + ' · ' + esc(alcance) + ' · ' + list.length + ' artículos · ' + esc(I.fecha(hoyTxt())) + '</p>' +
      '<div class="meta"><span><b>Contó:</b> ______________________</span><span><b>Revisó:</b> ______________________</span></div>' +
      '<table><thead><tr><th>#</th><th>Clave</th><th>Descripción</th><th>Localización</th>' + (exist ? '<th class="n">Sistema</th>' : '') + (barras ? '<th>Código</th>' : '') + '<th class="n">Contado</th></tr></thead><tbody>' +
      list.map(function (a, i) {
        return '<tr><td>' + (i + 1) + '</td><td class="k">' + esc(a.clave) + '</td><td>' + esc(a.descripcion) + '</td><td>' + esc(a.localizacion || '—') + '</td>' +
          (exist ? '<td class="n">' + a.existencia + '</td>' : '') +
          (barras ? '<td>' + barcodeSVG(a.clave) + '</td>' : '') +
          '<td class="n"><div class="box" style="margin-left:auto"></div></td></tr>';
      }).join('') + '</tbody></table>';
    w.document.open();
    printWindow('Hoja de conteo', html, w);
  }

  // Para el conteo con escáner (conteo-escaner.js): usa el mismo catálogo
  // y, al terminar, pasa lo contado a la captura de aquí para aplicarlo.
  window.InvAjustes = {
    catalog: function () { return { items: items, byId: byId, deps: deps }; },
    reload: loadCatalog,
    hasLines: function () { return lines.length > 0; },
    setLines: function (list, comentario) {
      lines = list.map(function (l) { return { id: l.id, contado: l.contado }; }).filter(function (l) { return byId[l.id]; });
      $('cntComentario').value = comentario || '';
      save(); renderLines(); setMode('nuevo');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    setMode: function (m) { setMode(m); }
  };

  // ?folio=N abre ese ajuste (desde Movimientos)
  restore();
  loadCatalog().then(function () {
    try {
      var f = new URLSearchParams(location.search).get('folio');
      if (f) { setMode('consultar'); openDetail(Number(f)); }
      else if (localStorage.getItem('attomosInvAjMode') === 'escaner') setMode('escaner');
    } catch (e) {}
  });
})();
/* ---------------------------------------------------------------- scanner-count.js */
/* =========================================================
   INVENTARIO → Ajustes → Conteo con escáner
   1) Comenzar: qué se va a contar (todo o un departamento / categoría).
   2) Escanear: cada etiqueta suma 1 pieza a su artículo. El código de
      la etiqueta es la clave del artículo (o un número AVT de rastreo).
      Si el escáner cambia el guion por otro símbolo (distribución del
      teclado), igual se reconoce: se comparan solo letras y números.
   3) Comparar con el sistema: faltantes, sobrantes y los que coinciden.
      «Pasar al ajuste» lleva lo contado a la Captura manual para
      aplicarlo con el mismo flujo de siempre (folio, PDF, etc.).
   El conteo se guarda en este navegador: si se recarga la página o se
   cierra, sigue donde se quedó.
   Usa window.Inv (inventario-comun.js) y window.InvAjustes (ajustes.js).
   ========================================================= */
window.InvEscaner = (function () {
  var I = window.Inv, A = window.InvAjustes;
  if (!I || !A || !I.$('paneEscaner')) return null;
  var $ = I.$, esc = I.esc;
  var KEY = 'attomosInvEscaneo';

  // s: el conteo en curso (null = no hay)
  //   { inicio, alcance:{dep, cat, label}, ciego, comentario, counts:{id:n},
  //     log:[id…] (para deshacer), unknown:{codigo:n}, fase:'run'|'cmp' }
  var s = null;
  var index = {};            // código normalizado → id
  var startDep = '', startCat = '', alcanceTipo = 'todo';
  var cmpFiltro = 'dif';

  function cat() { return A.catalog(); }
  function codeKey(v) { return I.norm(v).toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function buildIndex() {
    index = {};
    cat().items.forEach(function (a) {
      [a.clave, a.clave_alterna].forEach(function (c) {
        var k = codeKey(c);
        if (k && !(k in index)) index[k] = a.id;
      });
    });
  }
  function save() { try { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); } catch (e) {} }
  function load() {
    try {
      var d = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (d && d.counts) { d.log = d.log || []; d.unknown = d.unknown || {}; s = d; }
    } catch (e) { s = null; }
  }

  /* ---------- alcance ---------- */
  function inScope(a, al) {
    al = al || (s && s.alcance) || { dep: startDep, cat: startCat };
    if (!a || a.servicio) return false;
    if (al.dep && String(a.departamento_id) !== String(al.dep)) return false;
    if (al.cat && String(a.categoria_id) !== String(al.cat)) return false;
    return true;
  }
  function scopeItems(al) { return cat().items.filter(function (a) { return inScope(a, al); }); }
  function alcanceLabel(dep, catId) {
    if (!dep) return 'Todo el inventario';
    var d = cat().deps.filter(function (x) { return String(x.id) === String(dep); })[0];
    var c = d && catId ? (d.categorias || []).filter(function (x) { return String(x.id) === String(catId); })[0] : null;
    return (d ? d.nombre : 'Departamento') + (c ? ' · ' + c.nombre : '');
  }
  function piezas(list) { return list.reduce(function (t, a) { return t + Math.max(0, Number(a.existencia) || 0); }, 0); }

  /* =======================================================
     1) COMENZAR
     ======================================================= */
  var selDep = I.select($('scnDep'), { placeholder: 'Elige el departamento', onChange: function (v) { startDep = v; startCat = ''; buildCats(); startInfo(); } });
  var selCat = I.select($('scnCat'), { placeholder: 'Todas las categorías', onChange: function (v) { startCat = v; startInfo(); } });
  function buildDeps() {
    selDep.setOptions([{ value: '', label: 'Elige el departamento' }].concat(cat().deps.map(function (d) { return { value: String(d.id), label: d.nombre }; })));
    selDep.set(startDep, true);
    buildCats();
  }
  function buildCats() {
    var d = cat().deps.filter(function (x) { return String(x.id) === startDep; })[0];
    selCat.setOptions([{ value: '', label: 'Todas las categorías' }].concat(d ? (d.categorias || []).map(function (c) { return { value: String(c.id), label: c.nombre }; }) : []));
    selCat.set(startCat, true);
  }
  $('scnAlcance').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-a]');
    if (!b) return;
    alcanceTipo = b.getAttribute('data-a');
    Array.prototype.forEach.call(this.querySelectorAll('button'), function (x) { x.classList.toggle('is-on', x === b); });
    $('scnDeptoRow').hidden = alcanceTipo !== 'depto';
    if (alcanceTipo === 'todo') { startDep = ''; startCat = ''; selDep.set('', true); buildCats(); }
    startInfo();
  });
  function startInfo() {
    var dep = alcanceTipo === 'depto' ? startDep : '';
    var list = scopeItems({ dep: dep, cat: dep ? startCat : '' });
    var conPzs = list.filter(function (a) { return (Number(a.existencia) || 0) > 0; }).length;
    var btn = $('scnBegin');
    if (alcanceTipo === 'depto' && !startDep) {
      $('scnStartInfo').textContent = 'Elige el departamento que vas a contar.';
      btn.disabled = true; return;
    }
    if (!list.length) { $('scnStartInfo').textContent = 'No hay artículos en ' + alcanceLabel(dep, startCat) + '.'; btn.disabled = true; return; }
    $('scnStartInfo').innerHTML = 'Se van a comparar <b>' + I.num(list.length) + '</b> artículos de <b>' + esc(alcanceLabel(dep, startCat)) + '</b> · el sistema dice que hay <b>' +
      I.num(piezas(list)) + '</b> piezas en <b>' + I.num(conPzs) + '</b> artículos.';
    btn.disabled = false;
  }
  $('scnBegin').addEventListener('click', function () {
    var dep = alcanceTipo === 'depto' ? startDep : '';
    s = {
      inicio: I.ahoraLocal(), alcance: { dep: dep, cat: dep ? startCat : '', label: alcanceLabel(dep, startCat) },
      ciego: $('scnCiego').checked, comentario: $('scnComentario').value.trim(),
      counts: {}, log: [], unknown: {}, fase: 'run'
    };
    save(); render();
    I.toast('Conteo iniciado. Escanea la primera etiqueta.');
  });

  /* =======================================================
     2) ESCANEAR
     ======================================================= */
  var input = $('scnInput');
  // Sonido corto: agudo = se contó, grave = no se reconoció.
  var actx = null;
  function beep(ok) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      var o = actx.createOscillator(), g = actx.createGain();
      o.type = 'sine'; o.frequency.value = ok ? 1250 : 260;
      g.gain.setValueAtTime(0.0001, actx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.2, actx.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + (ok ? 0.09 : 0.28));
      o.connect(g); g.connect(actx.destination);
      o.start(); o.stop(actx.currentTime + (ok ? 0.1 : 0.3));
    } catch (e) { /* sin sonido */ }
  }

  function processCode(raw) {
    var v = String(raw || '').trim();
    input.value = '';
    if (!v || !s) return;
    if (I.isRastreo(v)) {
      I.lookupRastreo(v).then(function (d) {
        if (!d.articulo || !cat().byId[d.articulo.id]) { addUnknown(v.toUpperCase(), 'Su artículo ya no existe'); return; }
        count(d.articulo.id, v.toUpperCase());
      }).catch(function () { addUnknown(v.toUpperCase()); });
      return;
    }
    var id = index[codeKey(v)];
    if (!id) { addUnknown(v); return; }
    count(id, v);
  }
  function count(id, code) {
    s.counts[id] = (s.counts[id] || 0) + 1;
    s.log.push(id);
    if (s.log.length > 300) s.log.shift();
    save();
    beep(true);
    var a = cat().byId[id];
    showLast(a, s.counts[id], !inScope(a));
    renderRun(id);
  }
  function addUnknown(code, why) {
    s.unknown[code] = (s.unknown[code] || 0) + 1;
    save();
    beep(false);
    var el = $('scnLast');
    el.hidden = false;
    el.className = 'scn-last is-error';
    el.innerHTML = '<div class="scn-last-main"><small>Código no reconocido</small><strong>' + esc(code) + '</strong>' +
      '<span>' + esc(why || 'No es la clave de ningún artículo. Se apartó en «No reconocidos» para revisarlo.') + '</span></div>';
    pop(el);
    renderUnknown($('scnUnknown'));
  }
  function showLast(a, n, fuera) {
    var el = $('scnLast');
    el.hidden = false;
    el.className = 'scn-last' + (fuera ? ' is-warn' : '');
    var sis = Number(a.existencia) || 0;
    el.innerHTML = '<div class="scn-last-main"><small>' + esc(a.clave) + (a.localizacion ? ' · ' + esc(a.localizacion) : '') + '</small><strong>' + esc(a.descripcion) + '</strong>' +
      (fuera ? '<span>No es de ' + esc(s.alcance.label) + '; se cuenta igual.</span>' : '') + '</div>' +
      '<div class="scn-last-n"><b>' + I.num(n) + '</b><small>' + (n === 1 ? 'contada' : 'contadas') + (s.ciego ? '' : ' de ' + I.num(sis)) + '</small></div>';
    pop(el);
  }
  function pop(el) { el.classList.remove('is-pop'); void el.offsetWidth; el.classList.add('is-pop'); }

  // El escáner "teclea" muy rápido y casi siempre manda Enter al final.
  // Si no manda Enter, se toma el código cuando deja de teclear.
  var firstT = 0, lastT = 0, idle = null;
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      clearTimeout(idle);
      processCode(input.value);
    }
  });
  input.addEventListener('input', function () {
    var now = Date.now();
    if (!input.value || now - lastT > 400) firstT = now;
    lastT = now;
    clearTimeout(idle);
    idle = setTimeout(function () {
      var v = input.value.trim();
      if (v.length < 3) return;
      var avg = (lastT - firstT) / Math.max(1, v.length - 1);
      if (avg < 45) processCode(v); // escaneado (una persona no teclea tan rápido)
    }, 120);
  });

  // Estado del escáner: listo cuando el cuadro tiene el foco.
  function syncStatus() {
    var on = document.activeElement === input;
    var st = $('scnStatus');
    st.classList.toggle('is-off', !on);
    st.lastChild.textContent = on ? 'Escáner listo' : 'Toca aquí para seguir escaneando';
  }
  input.addEventListener('focus', syncStatus);
  input.addEventListener('blur', function () { setTimeout(syncStatus, 0); });
  $('scnStatus').addEventListener('click', function () { input.focus(); });
  // Un clic en cualquier parte "vacía" del panel regresa el foco al escáner.
  $('scnRun').addEventListener('click', function (e) {
    if (e.target.closest('button, input, a, label, .inv-select')) return;
    input.focus();
  });

  $('scnUndo').addEventListener('click', function () {
    if (!s || !s.log.length) return;
    var id = s.log.pop();
    s.counts[id] = Math.max(0, (s.counts[id] || 0) - 1);
    if (!s.counts[id]) delete s.counts[id];
    save(); renderRun();
    var a = cat().byId[id];
    I.toast('Se quitó 1 de ' + (a ? a.descripcion : 'ese artículo') + '.');
    input.focus();
  });
  // +/− a mano en la lista
  $('scnBody').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-step]');
    if (!b || !s) return;
    var id = Number(b.closest('tr').getAttribute('data-id'));
    var step = Number(b.getAttribute('data-step'));
    s.counts[id] = Math.max(0, (s.counts[id] || 0) + step);
    if (step > 0) s.log.push(id);
    if (!s.counts[id]) delete s.counts[id];
    save(); renderRun(id);
  });

  function renderRun(flashId) {
    var by = cat().byId;
    var ids = Object.keys(s.counts).map(Number).filter(function (id) { return by[id]; });
    // Lo último escaneado arriba.
    var order = {};
    s.log.forEach(function (id, i) { order[id] = i; });
    ids.sort(function (x, y) { return (order[y] != null ? order[y] : -1) - (order[x] != null ? order[x] : -1); });
    $('scnEmpty').hidden = ids.length > 0;
    $('paneEscaner').classList.toggle('is-ciego', !!s.ciego);
    $('scnBody').innerHTML = ids.map(function (id, i) {
      var a = by[id], n = s.counts[id], sis = Number(a.existencia) || 0, fuera = !inScope(a);
      return '<tr data-id="' + id + '" class="' + (id === flashId ? 'is-flash' : '') + '" style="--i:' + Math.min(i, 20) + '">' +
        '<td class="inv-cell-art"><span class="inv-clave">' + esc(a.clave) + (a.localizacion ? '<em> · ' + esc(a.localizacion) + '</em>' : '') + '</span><strong>' + esc(a.descripcion) + '</strong>' +
          (fuera ? '<small class="scn-fuera">Fuera de ' + esc(s.alcance.label) + '</small>' : '') + '</td>' +
        '<td class="num scn-col-sis">' + I.num(sis) + '</td>' +
        '<td class="num"><b class="scn-n">' + I.num(n) + '</b></td>' +
        '<td class="num"><span class="scn-steps"><button type="button" data-step="-1" title="Quitar 1" aria-label="Quitar 1">−</button><button type="button" data-step="1" title="Sumar 1" aria-label="Sumar 1">+</button></span></td>' +
      '</tr>';
    }).join('');
    var scope = scopeItems();
    var esperadas = piezas(scope);
    var contadas = 0, arts = 0;
    scope.forEach(function (a) { if (s.counts[a.id]) { contadas += s.counts[a.id]; arts++; } });
    var total = Object.keys(s.counts).reduce(function (t, k) { return t + s.counts[k]; }, 0);
    var pct = esperadas ? Math.min(100, Math.round(contadas * 100 / esperadas)) : 0;
    $('scnBar').style.width = (s.ciego ? 0 : pct) + '%';
    $('scnProgress').classList.toggle('is-ciego', !!s.ciego);
    $('scnProgTxt').innerHTML = '<b>' + I.num(total) + '</b> ' + (total === 1 ? 'pieza escaneada' : 'piezas escaneadas') + ' · <b>' + I.num(ids.length) + '</b> ' + (ids.length === 1 ? 'artículo' : 'artículos') +
      (s.ciego ? '' : ' · ' + pct + '% de las ' + I.num(esperadas) + ' piezas que dice el sistema');
    $('scnUndo').disabled = !s.log.length;
    $('scnFinish').disabled = !total && !Object.keys(s.unknown).length;
    $('scnAlcanceTxt').innerHTML = '<b>' + esc(s.alcance.label) + '</b> · inició ' + esc(I.fechaHora(s.inicio)) + (s.ciego ? ' · a ciegas' : '');
    renderUnknown($('scnUnknown'));
  }
  function renderUnknown(box) {
    var codes = Object.keys(s.unknown || {});
    box.hidden = !codes.length;
    if (!codes.length) { box.innerHTML = ''; return; }
    box.innerHTML = '<div class="scn-unknown-head"><b>No reconocidos (' + codes.length + ')</b><span>Etiquetas que no son la clave de ningún artículo. Revisa si están mal impresas o si falta dar de alta el artículo.</span></div>' +
      '<div class="scn-unknown-list">' + codes.map(function (c) {
        return '<span class="scn-code"><code>' + esc(c) + '</code>' + (s.unknown[c] > 1 ? '<em>×' + s.unknown[c] + '</em>' : '') +
          '<button type="button" data-unk="' + esc(c) + '" title="Quitar" aria-label="Quitar">×</button></span>';
      }).join('') + '</div>';
  }
  function onUnknownClick(e) {
    var b = e.target.closest('[data-unk]');
    if (!b || !s) return;
    delete s.unknown[b.getAttribute('data-unk')];
    save();
    if (s.fase === 'cmp') renderCmp(); else renderRun();
  }
  $('scnUnknown').addEventListener('click', onUnknownClick);
  $('scnCmpUnknown').addEventListener('click', onUnknownClick);

  function discard() {
    if (!s) return;
    var btn = this;
    if (!btn.classList.contains('is-confirm')) {
      btn.classList.add('is-confirm');
      var old = btn.lastChild.textContent;
      btn.lastChild.textContent = '¿Seguro? Toca otra vez';
      setTimeout(function () { btn.classList.remove('is-confirm'); btn.lastChild.textContent = old; }, 3000);
      return;
    }
    btn.classList.remove('is-confirm');
    btn.lastChild.textContent = 'Descartar conteo';
    s = null; save(); render();
    I.toast('Se descartó el conteo.');
  }
  $('scnDiscard').addEventListener('click', discard);
  $('scnDiscard2').addEventListener('click', discard);

  /* =======================================================
     3) COMPARAR CON EL SISTEMA
     ======================================================= */
  $('scnFinish').addEventListener('click', function () {
    var btn = this;
    btn.disabled = true; btn.textContent = 'Comparando…';
    // Existencias al momento (pudo haber ventas mientras se contaba).
    Promise.resolve(A.reload()).then(function () {
      buildIndex();
      s.fase = 'cmp'; s.fin = I.ahoraLocal();
      save(); render();
    }).finally(function () { btn.textContent = 'Terminar y comparar'; btn.disabled = false; });
  });
  $('scnBack').addEventListener('click', function () { s.fase = 'run'; save(); render(); input.focus(); });

  // Renglones de la comparación: los del alcance (con algo en sistema o
  // contados) + lo que se escaneó fuera del alcance.
  function cmpRows() {
    var by = cat().byId, rows = [], seen = {};
    function push(a) {
      if (seen[a.id]) return;
      seen[a.id] = true;
      var sis = Number(a.existencia) || 0, n = s.counts[a.id] || 0;
      if (sis <= 0 && !n) return;
      var d = n - Math.max(0, sis);
      rows.push({ a: a, sis: sis, n: n, d: d, st: d < 0 ? 'falta' : d > 0 ? 'sobra' : 'ok', fuera: !inScope(a) });
    }
    scopeItems().forEach(push);
    Object.keys(s.counts).forEach(function (id) { if (by[id]) push(by[id]); });
    var rank = { falta: 0, sobra: 1, ok: 2 };
    rows.sort(function (x, y) {
      return rank[x.st] - rank[y.st] || Math.abs(y.d) - Math.abs(x.d) || (x.a.descripcion < y.a.descripcion ? -1 : 1);
    });
    return rows;
  }
  function cmpTotals(rows) {
    var t = { ok: 0, falta: 0, sobra: 0, pzFalta: 0, pzSobra: 0, sis: 0, n: 0 };
    rows.forEach(function (r) {
      t[r.st]++;
      if (r.d < 0) t.pzFalta -= r.d;
      if (r.d > 0) t.pzSobra += r.d;
      t.sis += Math.max(0, r.sis); t.n += r.n;
    });
    return t;
  }
  function diffHTML(d) {
    var cls = d > 0 ? 'is-up' : d < 0 ? 'is-down' : 'is-zero';
    return '<span class="inv-diff ' + cls + '">' + (d > 0 ? '+' : d < 0 ? '−' : '') + I.num(Math.abs(d)) + '</span>';
  }
  function renderCmp() {
    var rows = cmpRows(), t = cmpTotals(rows);
    var unk = Object.keys(s.unknown || {}).length;
    $('scnCmpSub').innerHTML = esc(s.alcance.label) + ' · ' + esc(I.fechaHora(s.inicio)) + ' a ' + esc(I.fechaHora(s.fin || I.ahoraLocal())) +
      ' · sistema <b>' + I.num(t.sis) + '</b> piezas, contadas <b>' + I.num(t.n) + '</b>';
    $('scnCmpStats').innerHTML =
      '<button type="button" class="inv-stat" data-f="ok"><small>Coinciden</small><strong>' + I.num(t.ok) + '</strong></button>' +
      '<button type="button" class="inv-stat is-danger" data-f="falta"><small>Faltantes</small><strong>' + I.num(t.falta) + ' <em>· −' + I.num(t.pzFalta) + ' pzs</em></strong></button>' +
      '<button type="button" class="inv-stat is-up" data-f="sobra"><small>Sobrantes</small><strong>' + I.num(t.sobra) + ' <em>· +' + I.num(t.pzSobra) + ' pzs</em></strong></button>' +
      '<div class="inv-stat' + (unk ? ' is-warn' : '') + '"><small>No reconocidos</small><strong>' + I.num(unk) + '</strong></div>';
    var list = rows.filter(function (r) {
      return cmpFiltro === 'todo' || (cmpFiltro === 'dif' ? r.st !== 'ok' : r.st === cmpFiltro);
    });
    Array.prototype.forEach.call($('scnCmpFiltro').querySelectorAll('button'), function (b) { b.classList.toggle('is-on', b.getAttribute('data-f') === cmpFiltro); });
    $('scnCmpEmpty').hidden = list.length > 0;
    $('scnCmpEmpty').textContent = cmpFiltro === 'dif' ? '¡Todo coincide con el sistema!' : 'No hay artículos aquí.';
    $('scnCmpBody').innerHTML = list.map(function (r, i) {
      var a = r.a;
      return '<tr class="scn-row-' + r.st + '" style="--i:' + Math.min(i, 20) + '">' +
        '<td class="inv-cell-art"><span class="inv-clave">' + esc(a.clave) + (a.localizacion ? '<em> · ' + esc(a.localizacion) + '</em>' : '') + '</span><strong>' + esc(a.descripcion) + '</strong>' +
          (r.n === 0 ? '<small class="scn-fuera is-down">No se escaneó ninguna</small>' : r.fuera ? '<small class="scn-fuera">Fuera de ' + esc(s.alcance.label) + '</small>' : '') + '</td>' +
        '<td class="num">' + I.num(r.sis) + '</td>' +
        '<td class="num"><b>' + I.num(r.n) + '</b></td>' +
        '<td class="num">' + diffHTML(r.d) + '</td>' +
      '</tr>';
    }).join('');
    renderUnknown($('scnCmpUnknown'));
  }
  $('scnCmpFiltro').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-f]');
    if (b) { cmpFiltro = b.getAttribute('data-f'); renderCmp(); }
  });
  $('scnCmpStats').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-f]');
    if (b) { cmpFiltro = b.getAttribute('data-f'); renderCmp(); }
  });

  // Pasar al ajuste: todos los renglones de la comparación (los que
  // coinciden también, así quedan registrados como contados).
  $('scnToAjuste').addEventListener('click', function () {
    var rows = cmpRows();
    if (!rows.length) { I.toast('No hay nada que pasar al ajuste.'); return; }
    var go = function () {
      var com = s.comentario || ('Conteo con escáner · ' + s.alcance.label);
      A.setLines(rows.map(function (r) { return { id: r.a.id, contado: r.n }; }), com);
      s = null; save();
      render();
      I.toast('Se pasaron ' + rows.length + ' artículos a la captura. Revisa y toca «Aplicar ajuste».');
    };
    if (A.hasLines() && !this.classList.contains('is-confirm')) {
      var btn = this;
      btn.classList.add('is-confirm');
      btn.textContent = 'Ya hay una captura manual: toca otra vez para reemplazarla';
      setTimeout(function () { btn.classList.remove('is-confirm'); btn.textContent = 'Pasar al ajuste'; }, 4000);
      return;
    }
    this.classList.remove('is-confirm'); this.textContent = 'Pasar al ajuste';
    go();
  });

  /* ---------- PDF de la comparación ---------- */
  $('scnPdf').addEventListener('click', function () {
    var btn = this, rows = cmpRows(), t = cmpTotals(rows);
    btn.disabled = true;
    I.pdfLibs().then(function () {
      var doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'letter' });
      var W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
      doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(16, 19, 46);
      doc.text('Conteo físico: comparación con el sistema', 40, 48);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(93, 99, 128);
      doc.text(I.biz + ' · generado el ' + I.fechaHora(I.ahoraLocal()), 40, 62);
      var quien = (document.querySelector('.userbar-name') || {}).textContent || '';
      var meta = [
        ['Qué se contó', s.alcance.label],
        ['Inició', I.fechaHora(s.inicio)], ['Terminó', I.fechaHora(s.fin || I.ahoraLocal())],
        ['Contó', quien.trim() || '—'], ['Comentario', s.comentario || '—'],
        ['Resumen', 'Sistema ' + t.sis + ' pzs · contadas ' + t.n + ' pzs · coinciden ' + t.ok + ' · faltantes ' + t.falta + ' (-' + t.pzFalta + ' pzs) · sobrantes ' + t.sobra + ' (+' + t.pzSobra + ' pzs)']
      ];
      var y = 84;
      meta.forEach(function (m) {
        doc.setFont('helvetica', 'bold'); doc.setTextColor(16, 19, 46); doc.setFontSize(9.5); doc.text(m[0] + ':', 40, y);
        doc.setFont('helvetica', 'normal'); doc.text(String(m[1]), 130, y, { maxWidth: W - 170 });
        y += 14;
      });
      var ST = { falta: 'Faltante', sobra: 'Sobrante', ok: 'Coincide' };
      doc.autoTable({
        startY: y + 8,
        head: [['Clave', 'Descripción', 'Estado', 'Sistema', 'Contadas', 'Diferencia']],
        body: rows.map(function (r) { return [r.a.clave, r.a.descripcion, ST[r.st], String(r.sis), String(r.n), r.d > 0 ? '+' + r.d : r.d < 0 ? '-' + Math.abs(r.d) : '0']; }),
        margin: { left: 40, right: 40 },
        styles: { fontSize: 8.5, cellPadding: 4, textColor: [16, 19, 46] },
        headStyles: { fillColor: [6, 182, 212], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [236, 254, 255] },
        columnStyles: { 0: { cellWidth: 80 }, 2: { cellWidth: 60 }, 3: { halign: 'right', cellWidth: 50 }, 4: { halign: 'right', cellWidth: 54 }, 5: { halign: 'right', cellWidth: 58 } },
        didParseCell: function (data) {
          if (data.section === 'head' && data.column.index >= 3) data.cell.styles.halign = 'right';
          if (data.section === 'body' && (data.column.index === 5 || data.column.index === 2)) {
            var st = rows[data.row.index] && rows[data.row.index].st;
            if (st === 'falta') { data.cell.styles.textColor = [198, 40, 40]; data.cell.styles.fontStyle = 'bold'; }
            if (st === 'sobra') { data.cell.styles.textColor = [15, 138, 75]; data.cell.styles.fontStyle = 'bold'; }
          }
        },
        didDrawPage: function () {
          doc.setFontSize(8); doc.setTextColor(150);
          doc.text('Página ' + doc.internal.getNumberOfPages(), W - 40, H - 18, { align: 'right' });
        }
      });
      var codes = Object.keys(s.unknown || {});
      if (codes.length) {
        doc.autoTable({
          startY: doc.lastAutoTable.finalY + 18,
          head: [['Códigos no reconocidos', 'Veces']],
          body: codes.map(function (c) { return [c, String(s.unknown[c])]; }),
          margin: { left: 40, right: 40 },
          styles: { fontSize: 8.5, cellPadding: 4 },
          headStyles: { fillColor: [180, 120, 20], textColor: 255, fontStyle: 'bold' },
          columnStyles: { 1: { halign: 'right', cellWidth: 60 } }
        });
      }
      doc.save('conteo-fisico-' + String(s.inicio).slice(0, 10) + '.pdf');
    }).catch(function (e) { I.toast(e.message, 'error'); })
      .finally(function () { btn.disabled = false; });
  });

  /* ---------- pantalla ---------- */
  function render() {
    var fase = s ? s.fase : 'start';
    $('scnStart').hidden = fase !== 'start';
    $('scnRun').hidden = fase !== 'run';
    $('scnCmp').hidden = fase !== 'cmp';
    if (fase === 'start') { buildDeps(); startInfo(); }
    if (fase === 'run') { renderRun(); setTimeout(function () { input.focus(); syncStatus(); }, 50); }
    if (fase === 'cmp') renderCmp();
  }
  var ready = false;
  function show() {
    if (ready) { render(); return; }
    var c = cat();
    (c.items.length ? Promise.resolve() : Promise.resolve(A.reload())).then(function () {
      ready = true; buildIndex(); render();
    });
  }

  load();
  return { show: show };
})();
/* ---------------------------------------------------------------- movements.js */
/* =========================================================
   INVENTARIO → Movimientos (kárdex)
     GET /api/inventario/movimientos?item=&desde=&hasta=&tipo=&q=
         → { items, totales: {movimientos, entradas, salidas}, articulo? }
     GET /api/inventario/articulos  (para sugerir artículos al buscar)
   ?item=ID abre el kárdex de ese artículo (desde Artículos).
   ========================================================= */
(function () {
  var I = window.Inv;
  if (!I || !I.$('invMovimientos')) return;
  var $ = I.$, esc = I.esc;
  var TIPOS = { venta: 'Venta', entrada: 'Entrada', salida: 'Salida', ajuste: 'Ajuste', inicial: 'Alta' };

  var f = { item: 0, q: '', tipo: '', per: '30d' };
  var arts = [];
  try {
    var sp = new URLSearchParams(location.search);
    if (sp.get('item')) { f.item = Number(sp.get('item')) || 0; f.per = 'todo'; }
  } catch (e) {}

  /* ---------- periodo ---------- */
  var dpDesde = I.datePicker($('perDesde'), { onChange: load, range: function () { return [dpDesde.get(), dpHasta.get()]; } });
  var dpHasta = I.datePicker($('perHasta'), { onChange: load, alignEnd: true, range: function () { return [dpDesde.get(), dpHasta.get()]; } });
  function syncPer() {
    Array.prototype.forEach.call($('perSeg').querySelectorAll('button'), function (x) { x.classList.toggle('is-on', x.getAttribute('data-p') === f.per); });
    $('perRange').hidden = f.per !== 'rango';
  }
  $('perSeg').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-p]');
    if (!b) return;
    f.per = b.getAttribute('data-p');
    if (f.per === 'rango' && !dpDesde.get()) { var r = I.periodo('30d'); dpDesde.set(r[0]); dpHasta.set(r[1]); }
    syncPer(); load();
  });
  $('mvTipo').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-tipo]');
    if (!b) return;
    f.tipo = b.getAttribute('data-tipo');
    Array.prototype.forEach.call($('mvTipo').querySelectorAll('button'), function (x) { x.classList.toggle('is-on', x === b); });
    load();
  });

  /* ---------- buscador: sugiere artículos; Enter busca texto ---------- */
  var pick = $('pick'), input = $('mvSearch'), res = $('pickResults'), hl = -1, results = [];
  function suggest() {
    var words = I.norm(input.value).split(/\s+/).filter(Boolean);
    if (!words.length || !arts.length) { pick.classList.remove('is-open'); return; }
    results = arts.filter(function (a) {
      var hay = I.norm(a.clave + ' ' + a.clave_alterna + ' ' + a.descripcion);
      return words.every(function (w) { return hay.indexOf(w) !== -1; });
    }).slice(0, 8);
    if (!results.length) { pick.classList.remove('is-open'); return; }
    res.innerHTML = '<p class="inv-pick-none" style="text-align:left;padding:6px 10px">Ver el kárdex de un artículo (Enter busca el texto en todos):</p>' +
      results.map(function (a, i) {
        return '<button type="button" class="inv-pick-opt' + (i === hl ? ' is-hl' : '') + '" data-id="' + a.id + '"><span><small>' + esc(a.clave) + '</small><strong>' + esc(a.descripcion) + '</strong></span><em>Hay ' + I.num(a.existencia) + '</em></button>';
      }).join('');
    pick.classList.add('is-open');
  }
  input.addEventListener('input', I.debounce(function () {
    hl = -1; suggest();
    f.q = input.value.trim();
    load();
  }, 250));
  input.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); hl = Math.min(results.length - 1, hl + 1); suggest(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); hl = Math.max(-1, hl - 1); suggest(); }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (hl >= 0 && results[hl]) chooseItem(results[hl].id);
      else { pick.classList.remove('is-open'); f.q = input.value.trim(); load(); }
    }
    if (e.key === 'Escape') pick.classList.remove('is-open');
  });
  res.addEventListener('mousedown', function (e) { e.preventDefault(); });
  res.addEventListener('click', function (e) {
    var o = e.target.closest('.inv-pick-opt');
    if (o) chooseItem(Number(o.getAttribute('data-id')));
  });
  document.addEventListener('click', function (e) { if (!e.target.closest('#pick')) pick.classList.remove('is-open'); });
  function chooseItem(id) {
    f.item = id; f.q = ''; input.value = '';
    pick.classList.remove('is-open');
    if (f.per !== 'todo' && f.per !== 'rango') { f.per = 'todo'; syncPer(); }
    syncUrl(); load();
  }
  function clearItem() { f.item = 0; syncUrl(); load(); }
  function syncUrl() {
    try { history.replaceState(null, '', f.item ? '?item=' + f.item : location.pathname); } catch (e) {}
  }

  /* ---------- carga ---------- */
  var req = 0;
  function load() {
    var p = I.periodo(f.per, dpDesde.get(), dpHasta.get());
    var qs = [];
    if (f.item) qs.push('item=' + f.item);
    if (f.tipo) qs.push('tipo=' + encodeURIComponent(f.tipo));
    if (f.q) qs.push('q=' + encodeURIComponent(f.q));
    if (p[0]) qs.push('desde=' + p[0] + '&hasta=' + p[1]);
    var my = ++req;
    $('mvBody').classList.add('is-loading');
    I.api('/api/inventario/movimientos?' + qs.join('&')).then(function (d) {
      if (my !== req) return;
      render(d, p);
    }).catch(function (e) {
      if (my === req) $('mvCaption').textContent = e.message;
    }).finally(function () { if (my === req) $('mvBody').classList.remove('is-loading'); });
  }

  function refHTML(m) {
    if (m.venta_id) return '<span>Ticket ' + m.venta_id + '</span>';
    if (m.ajuste_id) return '<a href="' + I.base + '/ajustes?folio=' + m.ajuste_id + '">Ajuste #' + m.ajuste_id + '</a>';
    return '';
  }
  function render(d, p) {
    var items = d.items || [], t = d.totales || {};
    $('stMovs').textContent = I.num(t.movimientos || 0);
    $('stIn').textContent = '+' + I.num(t.entradas || 0);
    $('stOut').textContent = '−' + I.num(t.salidas || 0);

    var kx = $('kxArt');
    var a = d.articulo;
    kx.hidden = !(f.item && a);
    if (f.item && a) {
      kx.innerHTML =
        '<div><small>' + esc(a.clave) + (a.clave_alterna ? ' · ' + esc(a.clave_alterna) : '') + '</small><strong>' + esc(a.descripcion) + '</strong>' +
          '<button type="button" class="inv-kx-clear" id="kxClear">Ver todos los artículos</button></div>' +
        '<div class="inv-kx-num"><small>Existencia hoy</small><br><b>' + I.num(a.existencia) + '</b></div>' +
        '<div class="inv-kx-num"><small>Precio</small><br><b>' + I.mxn.format(a.precio_1) + '</b></div>';
      $('kxClear').addEventListener('click', clearItem);
    }

    var when = !p[0] ? 'Todas las fechas' : p[0] === p[1] ? I.fecha(p[0]) : I.fecha(p[0]) + ' – ' + I.fecha(p[1]);
    $('mvCaption').textContent = when + ' · ' + I.num(items.length) + (items.length === 1 ? ' movimiento' : ' movimientos') + (items.length >= 1000 ? ' (se muestran los 1,000 más recientes)' : '');
    $('mvEmpty').hidden = items.length > 0;
    $('mvEmpty').textContent = 'No hay movimientos con estos filtros.';
    $('mvBody').innerHTML = items.map(function (m, i) {
      var up = m.cantidad > 0;
      var ref = refHTML(m);
      return '<tr style="--i:' + Math.min(i, 20) + '">' +
        '<td class="inv-nowrap">' + esc(I.fechaHora(m.fecha)) + '</td>' +
        '<td class="inv-cell-art">' + (f.item ? '' : '<button type="button" class="inv-link-art" data-item="' + m.item_id + '">') +
          '<span class="inv-clave">' + esc(m.clave) + '</span><strong>' + esc(m.descripcion) + '</strong>' + (f.item ? '' : '</button>') + '</td>' +
        '<td><span class="inv-chip t-' + esc(m.tipo) + '">' + esc(TIPOS[m.tipo] || m.tipo) + '</span>' + (ref ? '<small class="inv-ref">' + ref + '</small>' : '') + '</td>' +
        '<td class="num"><span class="inv-qty ' + (up ? 'is-up' : 'is-down') + '">' + (up ? '+' : '−') + I.num(Math.abs(m.cantidad)) + '</span></td>' +
        '<td class="num inv-nowrap"><span class="inv-muted">' + I.num(m.antes) + ' →</span> <strong>' + I.num(m.despues) + '</strong></td>' +
        '<td>' + esc(m.usuario || '—') + '</td>' +
        '<td>' + (m.comentario && m.comentario !== 'Ticket ' + m.venta_id ? esc(m.comentario) : '<span class="inv-muted">—</span>') + '</td>' +
      '</tr>';
    }).join('');
  }
  $('mvBody').addEventListener('click', function (e) {
    var b = e.target.closest('[data-item]');
    if (b) chooseItem(Number(b.getAttribute('data-item')));
  });

  /* =======================================================
     REPORTE (PDF / Excel) con los mismos filtros de la pantalla.
     Pide todo el periodo (hasta 10,000 movimientos), no solo los
     1,000 que se muestran.
     ======================================================= */
  function filtrosTxt(p, d) {
    var a = d.articulo;
    return [
      ['Periodo', !p[0] ? 'Todas las fechas' : p[0] === p[1] ? I.fecha(p[0]) : I.fecha(p[0]) + ' al ' + I.fecha(p[1])],
      ['Tipo', f.tipo ? (TIPOS[f.tipo] || f.tipo) : 'Todos'],
      ['Artículo', f.item && a ? a.clave + ' · ' + a.descripcion : 'Todos'],
      ['Búsqueda', f.q || '—']
    ];
  }
  function porTipo(items) {
    var out = {};
    items.forEach(function (m) {
      var t = out[m.tipo] || (out[m.tipo] = { n: 0, in: 0, out: 0 });
      t.n++;
      if (m.cantidad > 0) t.in += m.cantidad; else t.out -= m.cantidad;
    });
    return Object.keys(TIPOS).filter(function (k) { return out[k]; }).map(function (k) {
      var t = out[k];
      return TIPOS[k] + ': ' + t.n + (t.in ? ' (+' + t.in + ')' : '') + (t.out ? ' (-' + t.out + ')' : '');
    }).join(' · ');
  }
  function signedPdf(n) { return n > 0 ? '+' + n : n < 0 ? '-' + Math.abs(n) : '0'; }
  function refTxt(m) { return m.venta_id ? 'Ticket ' + m.venta_id : m.ajuste_id ? 'Ajuste #' + m.ajuste_id : ''; }
  function comentarioTxt(m) { return m.comentario && m.comentario !== 'Ticket ' + m.venta_id ? m.comentario : ''; }
  function fileStamp(p) { return p[0] ? (p[0] === p[1] ? p[0] : p[0] + '_a_' + p[1]) : 'todo'; }

  function fetchReporte() {
    var p = I.periodo(f.per, dpDesde.get(), dpHasta.get());
    var qs = ['reporte=1'];
    if (f.item) qs.push('item=' + f.item);
    if (f.tipo) qs.push('tipo=' + encodeURIComponent(f.tipo));
    if (f.q) qs.push('q=' + encodeURIComponent(f.q));
    if (p[0]) qs.push('desde=' + p[0] + '&hasta=' + p[1]);
    return I.api('/api/inventario/movimientos?' + qs.join('&')).then(function (d) { return { d: d, p: p }; });
  }
  function busy(btn, on, txt) {
    btn.disabled = on;
    btn.lastChild.textContent = on ? 'Generando…' : txt;
  }

  $('mvPdf').addEventListener('click', function () {
    var btn = this;
    busy(btn, true);
    Promise.all([fetchReporte(), I.pdfLibs()]).then(function (r) {
      var d = r[0].d, p = r[0].p, items = d.items || [], t = d.totales || {};
      if (!items.length) { I.toast('No hay movimientos con estos filtros.'); return; }
      var doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
      var W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
      doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.setTextColor(16, 19, 46);
      doc.text('Reporte de movimientos de inventario', 36, 46);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(93, 99, 128);
      doc.text(I.biz + ' · generado el ' + I.fechaHora(I.ahoraLocal()), W - 36, 46, { align: 'right' });
      var y = 70;
      filtrosTxt(p, d).forEach(function (m) {
        doc.setFont('helvetica', 'bold'); doc.setTextColor(16, 19, 46); doc.text(m[0] + ':', 36, y);
        doc.setFont('helvetica', 'normal'); doc.text(String(m[1]), 110, y, { maxWidth: W - 160 });
        y += 14;
      });
      // Totales en recuadros
      y += 6;
      var boxes = [['Movimientos', I.num(t.movimientos || items.length)], ['Entraron', '+' + I.num(t.entradas || 0)], ['Salieron', '-' + I.num(t.salidas || 0)]];
      var bw = 150;
      boxes.forEach(function (b, i) {
        var x = 36 + i * (bw + 10);
        doc.setDrawColor(223, 226, 238); doc.setFillColor(245, 247, 255);
        doc.roundedRect(x, y, bw, 40, 6, 6, 'FD');
        doc.setFontSize(8.5); doc.setTextColor(93, 99, 128); doc.setFont('helvetica', 'normal');
        doc.text(b[0].toUpperCase(), x + 10, y + 14);
        doc.setFontSize(14); doc.setFont('helvetica', 'bold');
        doc.setTextColor.apply(doc, i === 1 ? [15, 138, 75] : i === 2 ? [198, 40, 40] : [16, 19, 46]);
        doc.text(b[1], x + 10, y + 32);
      });
      y += 52;
      doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(93, 99, 128);
      doc.text('Por tipo: ' + porTipo(items), 36, y, { maxWidth: W - 72 });
      if (items.length >= 10000) { y += 12; doc.setTextColor(198, 40, 40); doc.text('Se incluyen los 10,000 movimientos más recientes del periodo.', 36, y); }
      doc.autoTable({
        startY: y + 12,
        head: [['Fecha', 'Clave', 'Descripción', 'Movimiento', 'Cantidad', 'Antes', 'Después', 'Usuario', 'Comentario']],
        body: items.map(function (m) {
          var ref = refTxt(m);
          return [I.fechaHora(m.fecha), m.clave, m.descripcion, (TIPOS[m.tipo] || m.tipo) + (ref ? '\n' + ref : ''),
            signedPdf(m.cantidad), String(m.antes), String(m.despues), m.usuario || '—', comentarioTxt(m) || '—'];
        }),
        margin: { left: 36, right: 36 },
        styles: { fontSize: 8, cellPadding: 4, textColor: [16, 19, 46], overflow: 'linebreak' },
        headStyles: { fillColor: [6, 182, 212], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [236, 254, 255] },
        columnStyles: { 0: { cellWidth: 92 }, 1: { cellWidth: 70 }, 2: { cellWidth: 150 }, 3: { cellWidth: 66 }, 4: { halign: 'right', cellWidth: 50 }, 5: { halign: 'right', cellWidth: 42 }, 6: { halign: 'right', cellWidth: 46 }, 7: { cellWidth: 70 } },
        didParseCell: function (data) {
          if (data.section === 'head' && data.column.index >= 4 && data.column.index <= 6) data.cell.styles.halign = 'right';
          if (data.section === 'body' && data.column.index === 4) {
            var v = String(data.cell.raw || '');
            data.cell.styles.fontStyle = 'bold';
            data.cell.styles.textColor = v.charAt(0) === '+' ? [15, 138, 75] : [198, 40, 40];
          }
        },
        didDrawPage: function () {
          doc.setFontSize(8); doc.setTextColor(150);
          doc.text('Página ' + doc.internal.getNumberOfPages(), W - 36, H - 18, { align: 'right' });
        }
      });
      doc.save('movimientos-' + fileStamp(p) + '.pdf');
    }).catch(function (e) { I.toast(e.message, 'error'); })
      .finally(function () { busy(btn, false, 'Reporte PDF'); });
  });

  $('mvXlsx').addEventListener('click', function () {
    var btn = this;
    busy(btn, true);
    Promise.all([fetchReporte(), I.lib('xlsx')]).then(function (r) {
      var d = r[0].d, p = r[0].p, items = d.items || [], t = d.totales || {};
      if (!items.length) { I.toast('No hay movimientos con estos filtros.'); return; }
      var rows = [['Reporte de movimientos de inventario · ' + I.biz]].concat(filtrosTxt(p, d)).concat([
        ['Movimientos', t.movimientos || items.length], ['Entraron', t.entradas || 0], ['Salieron', t.salidas || 0], [],
        ['Fecha', 'Clave', 'Descripción', 'Movimiento', 'Referencia', 'Cantidad', 'Antes', 'Después', 'Usuario', 'Comentario']
      ]).concat(items.map(function (m) {
        return [I.fechaHora(m.fecha), m.clave, m.descripcion, TIPOS[m.tipo] || m.tipo, refTxt(m), m.cantidad, m.antes, m.despues, m.usuario || '', comentarioTxt(m)];
      }));
      var ws = window.XLSX.utils.aoa_to_sheet(rows);
      ws['!cols'] = [22, 16, 44, 12, 14, 10, 10, 10, 18, 40].map(function (w) { return { wch: w }; });
      var wb = window.XLSX.utils.book_new();
      window.XLSX.utils.book_append_sheet(wb, ws, 'Movimientos');
      window.XLSX.writeFile(wb, 'movimientos-' + fileStamp(p) + '.xlsx');
    }).catch(function (e) { I.toast(e.message, 'error'); })
      .finally(function () { busy(btn, false, 'Excel'); });
  });

  syncPer();
  I.api('/api/inventario/articulos').then(function (d) { arts = d.items || []; }).catch(function () {});
  load();
})();