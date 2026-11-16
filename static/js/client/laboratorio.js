/* =========================================================
   LABORATORIO — Trabajos
   - Trabajos: los pedidos (los mismos de Mis ventas, Ventas y Rastreo)
     acomodados por paso: A autorizar → En proceso → Corte → Control de
     calidad. Llegan solos del Punto de venta (como en Avante). Se cambian
     de estado arrastrando la tarjeta a otra columna, con "Avanzar" o
     desde el detalle. Vista de Tablero o de Lista.
   - Control de calidad se puede limpiar (salen del tablero sin borrarse);
     "Ver limpiados" los vuelve a mostrar.
   - Cada trabajo: fecha estimada de entrega y etiqueta «Express».
   API: /api/laboratorio/* (handlers/laboratorio.go)
   ========================================================= */
(function () {
  'use strict';
  var page = document.getElementById('labPage');
  if (!page) return;
  var VISTA = 'trabajos';
  function $(id) { return document.getElementById(id); }

  /* ---------- utilidades ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function money(n) { return '$' + Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fecha(iso) { return iso ? new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, '') : '—'; }
  function fechaHora(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }).replace(/\./g, '') + ' ' + d.toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' });
  }
  function hace(iso) {
    if (!iso) return '';
    var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'hace un momento';
    if (s < 3600) return 'hace ' + Math.round(s / 60) + ' min';
    if (s < 86400) return 'hace ' + Math.round(s / 3600) + ' h';
    var d = Math.round(s / 86400);
    return d === 1 ? 'ayer' : 'hace ' + d + ' días';
  }
  function store(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; }
  }
  function api(url, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', headers: { Accept: 'application/json' }, credentials: 'same-origin' };
    if (opts.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    return fetch(url, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (b) {
        if (!r.ok) throw new Error(b.error || 'Algo salió mal. Intenta de nuevo.');
        return b;
      });
    });
  }
  var toastEl;
  function toast(msg, ms) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'lab-toast'; toastEl.setAttribute('role', 'status'); document.body.appendChild(toastEl); }
    toastEl.textContent = msg;
    toastEl.classList.remove('is-on'); void toastEl.offsetWidth; toastEl.classList.add('is-on');
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(function () { toastEl.classList.remove('is-on'); }, ms || 3200);
  }
  function openModal(id) { $(id).classList.add('open'); document.body.style.overflow = 'hidden'; }
  function closeModal(id) {
    $(id).classList.remove('open');
    if (!document.querySelector('.admin-modal-overlay.open')) document.body.style.overflow = '';
  }
  ['labDetail'].forEach(function (p) {
    var ov = $(p + 'Modal');
    ov.addEventListener('click', function (e) { if (e.target === ov) closeModal(p + 'Modal'); });
    $(p + 'Close').addEventListener('click', function () { closeModal(p + 'Modal'); });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    closeStatusMenu();
    ['labDetailModal'].forEach(function (id) { if ($(id).classList.contains('open')) closeModal(id); });
  });
  function trackURL(code) { return window.location.origin + '/rastreo?pedido=' + encodeURIComponent(code); }
  function copyText(text, okMsg) {
    function done() { toast(okMsg || 'Copiado.'); }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
    function fallback() {
      var t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch (e) {} t.remove(); done();
    }
  }

  /* =======================================================
     VISTA: TRABAJOS
     ======================================================= */
  var orders = [], statuses = [];
  var search = '', origen = '', empresaSel = '';
  var IS_ADMIN = false; // "Eliminar definitivamente" (de Avante) no aplica en Attomos
  var EMPRESAS = [];
  var verLimpios = false, limpiosN = 0;
  // "Listo para la entrega" y "Entregado" ya no llegan al laboratorio
  // (los pone recepción), así que no hay nada que ocultar.
  var hideDone = false;
  var view = store('attomosLabView') === 'lista' ? 'lista' : 'tablero';
  var landedId = null;

  function sortedStatuses() { return statuses.slice().sort(function (a, b) { return a.sortOrder - b.sortOrder || a.id - b.id; }); }
  // Cada columna del tablero con su propio color (para distinguirlas de
  // un vistazo), en el orden de los estados.
  var PALETTE = ['#2563eb', '#ea580c', '#7c3aed', '#0891b2', '#16a34a', '#db2777', '#ca8a04', '#dc2626', '#0d9488', '#4f46e5', '#65a30d', '#9333ea'];
  function colorOf(key) {
    var i = sortedStatuses().findIndex(function (s) { return s.key === key; });
    return i < 0 ? '#767b8a' : PALETTE[i % PALETTE.length];
  }
  function origenTxt(o) { return { sucursal: 'Sucursal', linea: 'En línea', laboratorio: 'Laboratorio', panel: 'Mis ventas' }[o.origen] || 'Pedido'; }
  // Las órdenes hechas sin venta no tienen clave de rastreo: se nombran por su Nº.
  function codeOf(o) { return o.orderCode || (o.hoja && o.hoja.folio ? 'Orden Nº ' + o.hoja.folio : '#' + o.id); }
  function convTxt(o) { return ''; }
  function convTag(o) { var t = convTxt(o); return t ? '<span class="lab-conv is-' + esc(o.convenio) + '">' + esc(t) + '</span>' : ''; }
  // La última columna que ve el laboratorio (Control de calidad): esa se puede limpiar.
  function lastKey() { var s = sortedStatuses(); return s.length ? s[s.length - 1].key : ''; }
  function shortCode(o) { return o.orderCode || (o.hoja && o.hoja.folio ? 'Nº ' + o.hoja.folio : '#' + o.id); }
  function statusOf(key) { return statuses.filter(function (s) { return s.key === key; })[0] || null; }
  function doneKey() {
    var s = sortedStatuses();
    var ent = s.filter(function (x) { return /entreg/.test(norm(x.label + ' ' + x.key)); })[0];
    return ent ? ent.key : (s.length ? s[s.length - 1].key : '');
  }
  function nextStatus(key) {
    var s = sortedStatuses();
    var i = s.findIndex(function (x) { return x.key === key; });
    if (i >= 0 && i === s.length - 1) return { key: 'ready', label: 'Listo' };
    return i >= 0 && i < s.length - 1 ? s[i + 1] : null;
  }
  function filtered() {
    var q = norm(search.trim());
    var dk = doneKey();
    return orders.filter(function (o) {
      if (origen && o.origen !== origen) return false;
      if (hideDone && o.status === dk) return false;
      if (!q) return true;
      return norm([codeOf(o), o.customerName, o.productName, (o.items || []).join(' '), o.clave, o.rxOD, o.rxOI, o.labNotes, o.notes, o.express ? 'express' : ''].join(' ')).indexOf(q) !== -1;
    });
  }

  function renderStats() {
    if (!$('labStats')) return;
    var html = '<div class="stat-card-wrap"><div class="stat-card-glow"></div><div class="admin-stat-card"><div class="num">' + orders.length + '</div><div class="label">Trabajos</div></div></div>';
    sortedStatuses().forEach(function (s) {
      var n = orders.filter(function (o) { return o.status === s.key; }).length;
      html += '<div class="stat-card-wrap"><div class="stat-card-glow"></div><div class="admin-stat-card" style="--stat-color:' + esc(s.color) + '"><div class="num">' + n + '</div><div class="label">' + esc(s.label) + '</div></div></div>';
    });
    $('labStats').innerHTML = html;
  }

  function badge(key) {
    var s = statusOf(key);
    return '<span class="lab-badge" style="--badge-color:' + colorOf(key) + '">' + esc(s ? s.label : key) + '</span>';
  }
  function productLine(o) {
    return esc(o.productName) + (o.clave ? ' <span class="lab-muted">· ' + esc(o.clave) + '</span>' : '');
  }
  function rxLine(o) {
    var p = [];
    if (o.rxOD) p.push('OD ' + o.rxOD);
    if (o.rxOI) p.push('OI ' + o.rxOI);
    return p.join(' · ');
  }

  /* ---------- entrega estimada y lente express ----------
     Cada trabajo tiene su propia fecha estimada de entrega (la pone el
     laboratorio a mano) y puede marcarse como «Express». Express por
     ahora es solo la etiqueta: no cambia el orden ni los tiempos. */
  var BOLT_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12z"/></svg>';
  var CLOCK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
  var DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  function isoDay(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function parseDay(iso) { var p = String(iso || '').split('-').map(Number); return p.length === 3 && p[0] ? new Date(p[0], p[1] - 1, p[2]) : null; }
  function todayDay() { var t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); }
  function capFirst(t) { return t.charAt(0).toUpperCase() + t.slice(1); }
  function shortDay(d) { return DIAS[d.getDay()] + ' ' + d.getDate() + ' ' + MESES[d.getMonth()]; }
  // Cuántos días faltan (negativo = ya pasó).
  function daysLeft(iso) { var d = parseDay(iso); return d ? Math.round((d - todayDay()) / 86400000) : null; }
  // "+N días" desde hoy; si cae en domingo se pasa al lunes.
  function plusDays(n) { var d = todayDay(); d.setDate(d.getDate() + n); if (d.getDay() === 0) d.setDate(d.getDate() + 1); return d; }
  function entregaInfo(o) {
    if (!o.entrega) return null;
    var d = parseDay(o.entrega), n = daysLeft(o.entrega);
    if (!d) return null;
    if (n < 0) return { cls: 'is-late', txt: 'Atrasado ' + (n === -1 ? '1 día' : (-n) + ' días'), full: 'Se esperaba el ' + shortDay(d) };
    if (n === 0) return { cls: 'is-today', txt: 'Entrega hoy', full: 'Entrega estimada: hoy, ' + shortDay(d) };
    if (n === 1) return { cls: 'is-soon', txt: 'Entrega mañana', full: 'Entrega estimada: mañana, ' + shortDay(d) };
    return { cls: '', txt: 'Entrega ' + shortDay(d), full: 'Entrega estimada en ' + n + ' días' };
  }
  function entregaTag(o, inline) {
    var e = entregaInfo(o);
    return e ? '<span class="lab-eta ' + e.cls + (inline ? ' is-inline' : '') + '" title="' + esc(e.full) + '">' + CLOCK_ICON + esc(e.txt) + '</span>' : '';
  }
  function expressTag(o, inline) {
    return o.express ? '<span class="lab-express' + (inline ? ' is-inline' : '') + '" title="Lente express">' + BOLT_ICON + 'Express</span>' : '';
  }
  var ETA_CHIPS = [[1, '1 día'], [2, '2 días'], [3, '3 días'], [5, '5 días'], [7, '1 semana'], [14, '2 semanas']];

  var EXT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4M14 4h6v6M10 14 20 4"/></svg>';
  var DOC_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></svg>';
  function hojaBtn(o, big) {
    if (!o.hoja) return '';
    return '<button type="button" class="lab-hoja-btn' + (big ? ' is-big' : '') + '" data-hoja="' + o.hoja.id + '" title="Ver la orden de laboratorio' + (o.hoja.folio ? ' Nº ' + o.hoja.folio : '') + '">' +
      DOC_ICON + '<span>' + (o.directo ? 'Hoja' : (o.hoja.folio ? 'Nº ' + o.hoja.folio : 'Orden')) + '</span></button>';
  }
  function cardHTML(o, i) {
    var nx = nextStatus(o.status);
    var rx = rxLine(o);
    return '<article class="lab-card' + (String(o.id) === String(landedId) ? ' is-landed' : '') + (o.limpio ? ' is-limpio' : '') + (o.express ? ' is-express' : '') + '" draggable="true" data-id="' + o.id + '" tabindex="0" style="--i:' + Math.min(i, 12) + '">' +
      '<div class="lab-card-top"><strong class="lab-code">' + esc(shortCode(o)) + '</strong>' +
        '<span class="lab-card-tags">' + hojaBtn(o) + '<span class="lab-origin is-' + o.origen + '">' + origenTxt(o) + '</span></span></div>' +
      (o.externo ? '<div class="lab-ext-tag" title="Este trabajo está en un laboratorio externo">' + EXT_ICON + 'Laboratorio externo</div>' : '') +
      ((o.convenio || o.limpio) ? '<div class="lab-card-flags">' + convTag(o) + (o.limpio ? '<span class="lab-limpio-tag">Limpiado</span>' : '') + '</div>' : '') +
      '<div class="lab-card-client">' + esc(o.customerName || 'Cliente sin nombre') + '</div>' +
      '<div class="lab-card-prod">' + productLine(o) + (o.quantity > 1 ? ' <span class="lab-qty">×' + o.quantity + '</span>' : '') + '</div>' +
      (rx ? '<div class="lab-card-rx">' + esc(rx) + '</div>' : '') +
      ((o.express || o.entrega) ? '<div class="lab-card-eta">' + expressTag(o) + entregaTag(o) + '</div>' : '') +
      (o.labNotes ? '<div class="lab-card-note" title="' + esc(o.labNotes) + '">' + esc(o.labNotes) + '</div>' : '') +
      '<div class="lab-card-foot"><span>' + (o.lastAt ? esc((o.lastBy || 'Alguien') + ' · ' + hace(o.lastAt)) : fecha(o.createdAt)) + '</span>' +
        '<span class="lab-split">' +
          (nx ? '<button type="button" class="lab-next" data-next="' + esc(nx.key) + '" title="Pasar a ' + esc(nx.label) + '">' + esc(nx.label) +
            ' <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>' : '') +
          '<button type="button" class="lab-next lab-next-menu' + (nx ? '' : ' is-alone') + '" data-status-menu="' + o.id + '" title="Cambiar estatus" aria-label="Cambiar estatus">' +
            (nx ? '' : 'Estatus ') + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg></button>' +
        '</span>' +
      '</div>' +
    '</article>';
  }

  function renderBoard() {
    var list = filtered();
    var dk = doneKey();
    var cols = sortedStatuses().filter(function (s) { return !(hideDone && s.key === dk); });
    var known = {}; statuses.forEach(function (s) { known[s.key] = true; });
    var orphans = list.filter(function (o) { return !known[o.status]; });
    var html = '';
    if (orphans.length) {
      html += '<section class="lab-col" data-status="" style="--col-color:#767b8a"><header class="lab-col-head"><span class="lab-col-dot"></span><strong>Sin estado</strong><span class="lab-col-n">' + orphans.length + '</span></header>' +
        '<div class="lab-col-body">' + orphans.map(cardHTML).join('') + '</div></section>';
    }
    cols.forEach(function (s) {
      var mine = list.filter(function (o) { return o.status === s.key; });
      html += '<section class="lab-col" data-status="' + esc(s.key) + '" style="--col-color:' + colorOf(s.key) + '">' +
        '<header class="lab-col-head"><span class="lab-col-dot"></span><strong>' + esc(s.label) + '</strong><span class="lab-col-n">' + mine.length + '</span></header>' +
        '<div class="lab-col-body">' +
          (s.key === lastKey() && mine.some(function (o) { return !o.limpio; }) ? '<button type="button" class="lab-col-clear" data-clear="' + esc(s.key) + '" title="Quitar del tablero los trabajos de esta columna (no se borran)">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 3 5 5-9 9H7v-5z"/><path d="M3 21h18"/></svg><span>Limpiar columna</span></button>' : '') +
          (mine.length ? mine.map(cardHTML).join('') : '<p class="lab-col-empty">Suelta aquí un trabajo</p>') + '</div>' +
      '</section>';
    });
    $('labBoard').innerHTML = html;
  }

  function renderList() {
    var list = filtered();
    $('labRows').innerHTML = list.map(function (o, i) {
      return '<tr data-id="' + o.id + '" style="--i:' + Math.min(i, 20) + '" class="' + (String(o.id) === String(landedId) ? 'is-landed' : '') + '">' +
        '<td><strong class="lab-code">' + esc(shortCode(o)) + '</strong><div class="lab-muted">' + fecha(o.createdAt) + '</div></td>' +
        '<td>' + esc(o.customerName || 'Cliente sin nombre') + '<div><span class="lab-origin is-' + o.origen + '">' + origenTxt(o) + '</span>' + convTag(o) + hojaBtn(o) + (o.externo ? '<span class="lab-ext-tag is-inline">' + EXT_ICON + 'Externo</span>' : '') + expressTag(o, true) + entregaTag(o, true) + (o.limpio ? '<span class="lab-limpio-tag is-inline">Limpiado</span>' : '') + '</div></td>' +
        '<td>' + productLine(o) + (rxLine(o) ? '<div class="lab-muted">' + esc(rxLine(o)) + '</div>' : '') + '</td>' +
        '<td><button type="button" class="lab-status-btn" data-status-menu="' + o.id + '">' + badge(o.status) +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg></button></td>' +
        '<td class="lab-muted">' + (o.lastAt ? esc((o.lastBy || 'Alguien') + ' · ' + hace(o.lastAt)) : '—') + '</td>' +
        '<td class="lab-row-act"><button type="button" class="btn small" data-open="' + o.id + '">Ver</button></td>' +
      '</tr>';
    }).join('');
  }

  function render() {
    renderStats();
    var list = filtered();
    $('labBoard').hidden = view !== 'tablero';
    $('labList').hidden = view !== 'lista';
    if (view === 'tablero') renderBoard(); else renderList();
    var empty = !orders.length || (!list.length && view === 'lista');
    $('labEmpty').hidden = !empty;
    $('labEmpty').textContent = !orders.length ? 'Todavía no hay trabajos.' : 'Ningún trabajo coincide con la búsqueda.';
    landedId = null;
  }

  function loadOrders(highlight) {
    return api('/api/laboratorio/pedidos' + (verLimpios ? '?limpios=1' : '')).then(function (d) {
      orders = d.pedidos || [];
      statuses = d.estados || [];
      if (d.empresas) EMPRESAS = d.empresas;
      limpiosN = d.limpios || 0;
      if ($('labLimpiosN')) $('labLimpiosN').textContent = limpiosN ? '(' + limpiosN + ')' : '';
      if (highlight) landedId = highlight;
      render();
      if (detailId) refreshDetail();
    }).catch(function (err) {
      $('labEmpty').hidden = false;
      $('labEmpty').textContent = err.message;
    });
  }

  /* ---------- cambiar estado ---------- */
  function setStatus(id, key) {
    var o = orders.filter(function (x) { return String(x.id) === String(id); })[0];
    if (!o || o.status === key) return Promise.resolve();
    var before = o.status;
    var staff = page.dataset.staff || '';
    o.status = key; o.lastBy = staff; o.lastAt = new Date().toISOString(); o.limpio = false;
    landedId = id;
    render();
    if (detailId === String(id)) refreshDetail();
    var s = statusOf(key);
    var gone = key === 'ready';
    if (gone) { orders = orders.filter(function (x) { return x !== o; }); render(); if (detailId === String(id)) { closeModal('labDetailModal'); detailId = null; } }
    return api('/api/laboratorio/pedidos/' + id + '/estado', { method: 'PATCH', body: { status: key } }).then(function () {
      toast(codeOf(o) + ' → ' + (gone ? 'Listo para recoger' : (s ? s.label : key)) + (o.orderCode ? '. Ya se ve en Ventas y en Rastreo.' : '.'));
    }).catch(function (err) {
      if (gone) { orders.push(o); }
      o.status = before;
      render();
      if (detailId === String(id)) refreshDetail();
      toast(err.message);
    });
  }

  /* ---------- arrastrar tarjetas entre columnas ---------- */
  var dragId = null;
  var board = $('labBoard');
  board.addEventListener('dragstart', function (e) {
    var c = e.target.closest('.lab-card');
    if (!c) return;
    dragId = c.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
    c.classList.add('is-dragging');
    board.classList.add('is-dragging');
  });
  board.addEventListener('dragend', function (e) {
    var c = e.target.closest('.lab-card');
    if (c) c.classList.remove('is-dragging');
    board.classList.remove('is-dragging');
    board.querySelectorAll('.lab-col.is-over').forEach(function (x) { x.classList.remove('is-over'); });
    dragId = null;
  });
  board.addEventListener('dragover', function (e) {
    var col = e.target.closest('.lab-col[data-status]');
    if (!col || !dragId || !col.dataset.status) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!col.classList.contains('is-over')) {
      board.querySelectorAll('.lab-col.is-over').forEach(function (x) { x.classList.remove('is-over'); });
      col.classList.add('is-over');
    }
  });
  board.addEventListener('dragleave', function (e) {
    var col = e.target.closest('.lab-col');
    if (col && !col.contains(e.relatedTarget)) col.classList.remove('is-over');
  });
  board.addEventListener('drop', function (e) {
    var col = e.target.closest('.lab-col[data-status]');
    if (!col || !col.dataset.status) return;
    e.preventDefault();
    col.classList.remove('is-over');
    var id = dragId || e.dataTransfer.getData('text/plain');
    dragId = null;
    if (id) setStatus(id, col.dataset.status);
  });
  board.addEventListener('click', function (e) {
    var hj = e.target.closest('[data-hoja]');
    if (hj) { e.stopPropagation(); openHoja(hj.dataset.hoja); return; }
    var sm = e.target.closest('[data-status-menu]');
    if (sm) { e.stopPropagation(); if (menuEl && menuEl._for === sm.dataset.statusMenu) { closeStatusMenu(); return; } openStatusMenu(sm, sm.dataset.statusMenu); return; }
    var nx = e.target.closest('[data-next]');
    var card = e.target.closest('.lab-card');
    if (!card) return;
    if (nx) { e.stopPropagation(); setStatus(card.dataset.id, nx.dataset.next); return; }
    openDetail(card.dataset.id);
  });
  board.addEventListener('keydown', function (e) {
    var card = e.target.closest('.lab-card');
    if (card && (e.key === 'Enter' || e.key === ' ') && e.target === card) { e.preventDefault(); openDetail(card.dataset.id); }
  });

  /* ---------- menú de estados (vista Lista y detalle) ---------- */
  var menuEl = null;
  function closeStatusMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
  function openStatusMenu(anchor, id) {
    closeStatusMenu();
    var o = orders.filter(function (x) { return String(x.id) === String(id); })[0];
    if (!o) return;
    menuEl = document.createElement('div');
    menuEl.className = 'lab-menu';
    menuEl.innerHTML = '<div class="lab-menu-label">Cambiar estado</div>' + sortedStatuses().map(function (s, i) {
      return '<button type="button" data-set="' + esc(s.key) + '" class="' + (s.key === o.status ? 'is-active' : '') + '" style="--i:' + i + '">' +
        '<span class="lab-menu-dot" style="background:' + colorOf(s.key) + '"></span>' + esc(s.label) + '</button>';
    }).join('') + '<button type="button" data-set="ready" style="--i:' + sortedStatuses().length + '"><span class="lab-menu-dot" style="background:#16a34a"></span>Listo para recoger</button>';
    menuEl._for = String(id);
    document.body.appendChild(menuEl);
    var r = anchor.getBoundingClientRect();
    var left = Math.min(window.innerWidth - menuEl.offsetWidth - 10, Math.max(r.left, r.right - menuEl.offsetWidth));
    var top = r.bottom + 6;
    if (top + menuEl.offsetHeight > window.innerHeight - 10) top = Math.max(10, r.top - menuEl.offsetHeight - 6);
    menuEl.style.left = Math.max(10, left) + 'px';
    menuEl.style.top = top + 'px';
    menuEl.addEventListener('click', function (e) {
      var b = e.target.closest('[data-set]');
      if (!b) return;
      closeStatusMenu();
      setStatus(id, b.dataset.set);
    });
  }
  document.addEventListener('click', function (e) {
    if (menuEl && !menuEl.contains(e.target) && !e.target.closest('[data-status-menu]')) closeStatusMenu();
  });
  window.addEventListener('scroll', closeStatusMenu, true);
  $('labRows').addEventListener('click', function (e) {
    var sm = e.target.closest('[data-status-menu]');
    if (sm) { e.stopPropagation(); openStatusMenu(sm, sm.dataset.statusMenu); return; }
    var hj = e.target.closest('[data-hoja]');
    if (hj) { e.stopPropagation(); openHoja(hj.dataset.hoja); return; }
    var op = e.target.closest('[data-open]');
    if (op) { openDetail(op.dataset.open); return; }
    var tr = e.target.closest('tr[data-id]');
    if (tr) openDetail(tr.dataset.id);
  });

  /* ---------- detalle ---------- */
  var detailId = null;
  function openDetail(id) {
    detailId = String(id);
    refreshDetail();
    openModal('labDetailModal');
    loadHistory();
  }
  function refreshDetail() {
    var o = orders.filter(function (x) { return String(x.id) === detailId; })[0];
    if (!o) { closeModal('labDetailModal'); detailId = null; return; }
    $('labDetailTitle').textContent = o.orderCode || (o.directo ? codeOf(o) : 'Pedido #' + o.id);
    $('labDetailSub').textContent = origenTxt(o) + ' · ' + fecha(o.createdAt);
    var steps = sortedStatuses();
    var cur = steps.findIndex(function (s) { return s.key === o.status; });
    var info = [
      ['Cliente', o.customerName || 'Cliente sin nombre'],
      ['Producto', (o.items && o.items.length > 1) ? o.items.join(' · ') : o.productName],
      ['Clave', o.clave || ''],
      ['Existencia', o.existencia != null ? String(o.existencia) : ''],
      ['Cantidad', String(o.quantity || 1)],
      ['Total', o.directo ? '' : money(o.total)],
      ['Notas del pedido', o.notes || ''],
      ['OD', o.rxOD || ''],
      ['OI', o.rxOI || '']
    ].filter(function (r) { return r[1]; });
    var notesOld = $('labNotes') ? $('labNotes').value : null;
    $('labDetailBody').innerHTML =
      '<div class="lab-steps" style="--n:' + Math.max(steps.length, 1) + '">' + steps.map(function (s, i) {
        var cls = cur === -1 ? '' : (i < cur ? 'is-done' : (i === cur ? 'is-current' : ''));
        return '<button type="button" class="lab-step ' + cls + '" data-step="' + esc(s.key) + '" style="--step-color:' + colorOf(s.key) + '" title="Pasar a ' + esc(s.label) + '">' +
          '<span class="lab-step-dot"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>' +
          '<span class="lab-step-label">' + esc(s.label) + '</span></button>';
      }).join('') + '<span class="lab-steps-bar"><span style="width:' + (steps.length > 1 && cur > 0 ? (cur / (steps.length - 1) * 100) : 0) + '%"></span></span></div>' +
      '<p class="lab-hint">Toca un paso para cambiar. El cliente lo ve igual en Rastreo.</p>' +
      '<label class="lab-ext-toggle"><input type="checkbox" id="labExtToggle"' + (o.externo ? ' checked' : '') + '><span class="lab-toggle-track"><span class="lab-toggle-thumb"></span></span>' +
        '<span><strong>Laboratorio externo</strong><small>Márcalo si este trabajo se mandó a otro laboratorio.</small></span></label>' +
      '<label class="lab-ext-toggle lab-express-toggle"><input type="checkbox" id="labExpressToggle"' + (o.express ? ' checked' : '') + '><span class="lab-toggle-track"><span class="lab-toggle-thumb"></span></span>' +
        '<span><strong>' + BOLT_ICON + 'Lente express</strong><small>Por ahora solo marca el trabajo con la etiqueta «Express».</small></span></label>' +
      etaBoxHTML(o) +
      '<dl class="lab-info">' + info.map(function (r) { return '<div><dt>' + r[0] + '</dt><dd>' + esc(r[1]) + '</dd></div>'; }).join('') + '</dl>' +
      '<label class="lab-field lab-notes"><span>Notas del laboratorio</span><textarea id="labNotes" rows="3" maxlength="500" placeholder="Altura, tratamiento, observaciones…">' + esc(notesOld !== null && detailId === String(o.id) && document.activeElement && document.activeElement.id === 'labNotes' ? notesOld : (o.labNotes || '')) + '</textarea></label>' +
      '<div class="lab-detail-actions">' +
        (o.orderCode ? '<button type="button" class="btn small" id="labCopyTrack">Copiar link de rastreo</button>' +
        '<a class="btn small" href="' + esc(trackURL(o.orderCode)) + '" target="_blank" rel="noopener">Ver en Rastreo</a>' : '') +
        '<button type="button" class="btn small" id="labReady">Listo para recoger</button>' +
        '<button type="button" class="btn solid small" id="labNotesSave">Guardar notas</button>' +
      '</div>' +
      (IS_ADMIN ? '<div class="lab-danger"><div><strong>Eliminar definitivamente</strong><small>Para los trabajos de prueba. Se borra del tablero' + (o.orderCode ? ', de Pedidos y de Rastreo' : '') + ' y no se puede deshacer.</small></div>' +
        '<button type="button" class="btn small lab-del-btn" id="labDelete">Eliminar</button></div>' : '') +
      '<div class="lab-history"><h4>Historial</h4><ol id="labHistory"><li class="lab-muted">Cargando…</li></ol></div>';
    $('labDetailBody').querySelectorAll('[data-step]').forEach(function (b) {
      b.addEventListener('click', function () { setStatus(o.id, b.dataset.step).then(loadHistory); });
    });
    if ($('labCopyTrack')) $('labCopyTrack').addEventListener('click', function () { copyText(trackURL(o.orderCode), 'Link de rastreo copiado.'); });
    $('labReady').addEventListener('click', function () { setStatus(o.id, 'ready'); });
    if ($('labDelete')) $('labDelete').addEventListener('click', function () {
      var btn = this;
      if (!btn.classList.contains('is-armed')) {
        btn.classList.add('is-armed'); btn.textContent = '¿Seguro? Eliminar';
        clearTimeout(btn._t); btn._t = setTimeout(function () { btn.classList.remove('is-armed'); btn.textContent = 'Eliminar'; }, 4000);
        return;
      }
      btn.disabled = true;
      api('/api/laboratorio/pedidos/' + o.id, { method: 'DELETE' }).then(function () {
        orders = orders.filter(function (x) { return x.id !== o.id; });
        closeModal('labDetailModal'); detailId = null; render();
        toast(codeOf(o) + ' se eliminó definitivamente.');
      }).catch(function (err) { btn.disabled = false; toast(err.message); });
    });
    wireEtaBox(o);
    $('labExpressToggle').addEventListener('change', function () {
      var on = this.checked, box = this;
      box.disabled = true;
      api('/api/laboratorio/pedidos/' + o.id + '/express', { method: 'PUT', body: { express: on } }).then(function () {
        o.express = on; render();
        toast(on ? codeOf(o) + ' marcado como express.' : 'Se quitó «Express».');
      }).catch(function (err) { box.checked = !on; toast(err.message); }).finally(function () { box.disabled = false; });
    });
    $('labExtToggle').addEventListener('change', function () {
      var on = this.checked, box = this;
      box.disabled = true;
      api('/api/laboratorio/pedidos/' + o.id + '/externo', { method: 'PUT', body: { externo: on } }).then(function () {
        o.externo = on; render();
        toast(on ? codeOf(o) + ' marcado como laboratorio externo.' : 'Se quitó «laboratorio externo».');
      }).catch(function (err) { box.checked = !on; toast(err.message); }).finally(function () { box.disabled = false; });
    });
    $('labNotesSave').addEventListener('click', function () {
      var btn = this; btn.disabled = true;
      api('/api/laboratorio/pedidos/' + o.id + '/notas', { method: 'PUT', body: { notes: $('labNotes').value } }).then(function (r) {
        o.labNotes = r.notes; render(); toast('Notas guardadas.');
      }).catch(function (err) { toast(err.message); }).finally(function () { btn.disabled = false; });
    });
    if (historyCache[detailId]) paintHistory(historyCache[detailId]);
  }
  function etaBoxHTML(o) {
    var e = entregaInfo(o), d = parseDay(o.entrega);
    return '<div class="lab-eta-box" id="labEtaBox">' +
      '<div class="lab-eta-head"><span class="lab-conv-title">¿Cuánto tarda en entregarse?</span>' +
        (e ? '<span class="lab-eta-now ' + e.cls + '">' + CLOCK_ICON + '<strong>' + esc(capFirst(shortDay(d))) + '</strong> · ' +
          esc(e.cls === 'is-late' ? e.txt.toLowerCase() : (e.cls ? e.txt.replace('Entrega ', '') : 'en ' + daysLeft(o.entrega) + ' días')) + '</span>'
          : '<span class="lab-eta-now is-none">Sin fecha</span>') + '</div>' +
      '<div class="lab-conv-chips lab-eta-chips">' + ETA_CHIPS.map(function (c) {
        var iso = isoDay(plusDays(c[0]));
        return '<button type="button" data-eta="' + iso + '" class="' + (o.entrega === iso ? 'is-on' : '') + '" title="' + esc(shortDay(plusDays(c[0]))) + '">' + c[1] + '</button>';
      }).join('') + '</div>' +
      '<div class="lab-eta-row"><label class="lab-eta-date"><span>Otra fecha</span><input type="date" id="labEtaDate" min="' + isoDay(todayDay()) + '" value="' + esc(o.entrega || '') + '"></label>' +
        (o.entrega ? '<button type="button" class="btn small" id="labEtaClear">Quitar fecha</button>' : '') + '</div>' +
      '<small class="lab-eta-hint">Se cuenta desde hoy; si cae en domingo pasa al lunes. Es solo para este trabajo.</small>' +
    '</div>';
  }
  function wireEtaBox(o) {
    function save(iso) {
      if ((o.entrega || '') === iso) return;
      api('/api/laboratorio/pedidos/' + o.id + '/entrega', { method: 'PUT', body: { entrega: iso } }).then(function (r) {
        o.entrega = r.entrega || ''; render(); refreshDetail();
        var d = parseDay(o.entrega);
        toast(d ? codeOf(o) + ': entrega el ' + shortDay(d) + '.' : 'Se quitó la fecha de entrega.');
      }).catch(function (err) { toast(err.message); refreshDetail(); });
    }
    var box = $('labEtaBox');
    if (!box) return;
    box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-eta]');
      if (b) save(b.dataset.eta);
      if (e.target.closest('#labEtaClear')) save('');
    });
    $('labEtaDate').addEventListener('change', function () { if (this.value) save(this.value); });
  }
  var historyCache = {};
  var OUT_LABELS = { pending: 'Pendiente', confirmed: 'A autorizar', preparing: 'En laboratorio', ready: 'Listo para recoger', delivered: 'Entregado', cancelled: 'Cancelado' };
  function paintHistory(list) {
    var el = $('labHistory');
    if (!el) return;
    el.innerHTML = list.length ? list.map(function (h) {
      var s = statusOf(h.status);
      var lbl = s ? s.label : (OUT_LABELS[h.status] || h.status);
      return '<li><span class="lab-menu-dot" style="background:' + (s ? colorOf(h.status) : '#16a34a') + '"></span>' +
        '<span><strong>' + esc(lbl) + '</strong> · ' + esc(h.by || 'Sistema') + '</span><time>' + fechaHora(h.at) + '</time></li>';
    }).join('') : '<li class="lab-muted">Sin cambios registrados todavía.</li>';
  }
  function loadHistory() {
    var id = detailId;
    if (!id) return;
    api('/api/laboratorio/pedidos/' + id + '/historial').then(function (list) {
      historyCache[id] = list || [];
      if (detailId === id) paintHistory(historyCache[id]);
    }).catch(function () {});
  }

  function openHoja() {}

  /* ---------- pantalla completa: solo el tablero ---------- */
  function setFull(on) {
    document.body.classList.toggle('lab-full', on);
    if (on) {
      if (view !== 'tablero') setView('tablero');
      var el = document.documentElement;
      if (el.requestFullscreen && !document.fullscreenElement) el.requestFullscreen().catch(function () {});
    } else if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(function () {});
    }
    store('attomosLabFull', on ? '1' : '0');
  }
  $('labFullBtn').addEventListener('click', function () { setFull(true); });
  $('labFullExit').addEventListener('click', function () { setFull(false); });
  document.addEventListener('fullscreenchange', function () {
    if (!document.fullscreenElement && document.body.classList.contains('lab-full')) setFull(false);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && document.body.classList.contains('lab-full') && !document.querySelector('.admin-modal-overlay.open') && !menuEl) setFull(false);
  });

  /* ---------- filtros y vista ---------- */
  var sw = $('labViewSwitch');
  function setView(v) {
    view = v;
    store('attomosLabView', v);
    sw.classList.toggle('on-lista', v === 'lista');
    sw.querySelectorAll('.view-switch-btn').forEach(function (b) { b.classList.toggle('active', b.dataset.view === v); });
    render();
  }
  sw.addEventListener('click', function (e) { var b = e.target.closest('.view-switch-btn'); if (b && b.dataset.view !== view) setView(b.dataset.view); });
  $('labSearch').addEventListener('input', function () { search = this.value; render(); });

  /* ---------- Escáner de código de barras ----------
     El escáner "teclea" la clave del ticket (AT7K3P9Q) y un Enter. Si no
     se está escribiendo en otro campo, se junta lo que llega rápido y, al
     llegar el Enter, el trabajo pasa al siguiente paso. Si se escanea con
     el cursor en el buscador, también funciona. */
  // Claves de Attomos: AT + 6 letras/números (AT7K3P9Q). Se ignoran
  // guiones o signos que meta el escáner.
  function scanCode(v) {
    var c = String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return /^AT[A-Z0-9]{6}$/.test(c) ? c : '';
  }
  var scanBuf = '', scanLast = 0, scanBusy = false;
  function scanChip(state, txt) {
    var chip = $('labScanChip');
    if (!chip) return;
    chip.className = 'lab-scan-chip' + (state ? ' is-' + state : '');
    $('labScanTxt').textContent = txt || 'Escáner listo';
    clearTimeout(chip._t);
    if (state && state !== 'busy') chip._t = setTimeout(function () { scanChip('', ''); }, 2600);
  }
  function doScan(code) {
    if (scanBusy) return;
    scanBusy = true;
    code = code.toUpperCase();
    scanChip('busy', 'Leyendo ' + code + '…');
    api('/api/laboratorio/escanear', { method: 'POST', body: { code: code } }).then(function (r) {
      if (r.code) code = r.code;
      scanChip('ok', code + ' → ' + r.label);
      toast(code + (r.cliente ? ' · ' + r.cliente : '') + ': ' + (r.from ? r.from + ' → ' : '') + r.label + '.');
      return loadOrders(r.id);
    }).catch(function (err) {
      scanChip('err', 'No se movió');
      toast(err.message);
    }).finally(function () { scanBusy = false; });
  }
  // Se junta lo que llega rápido (el escáner manda cada tecla a pocos ms).
  // Se termina con Enter, con Tab o, si el escáner no manda ninguno de los
  // dos, al dejar de llegar teclas.
  var scanStart = 0, scanIdle = null;
  function scanFinish(t, byEnter) {
    clearTimeout(scanIdle);
    var buf = scanBuf, dur = scanLast - scanStart;
    scanBuf = '';
    var fast = buf.length >= 5 && dur / Math.max(1, buf.length - 1) < 60;
    var fromSearch = t && t.id === 'labSearch';
    var code = scanCode(buf) || (fromSearch && byEnter ? scanCode(t.value) : '');
    if (code && (fast || (fromSearch && byEnter))) {
      if (fromSearch) { t.value = ''; search = ''; render(); }
      doScan(code);
      return true;
    }
    if (fast) {
      scanChip('err', 'Código no reconocido');
      toast('Se leyó "' + buf + '", que no es una clave de rastreo (AT…).');
      return true;
    }
    if (!scanBusy) scanChip('', '');
    return false;
  }
  document.addEventListener('keydown', function (e) {
    if (VISTA !== 'trabajos' || e.ctrlKey || e.metaKey || e.altKey) return;
    var t = e.target, tag = (t && t.tagName) || '';
    var inField = (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) && t.id !== 'labSearch';
    if (inField) return;
    var now = Date.now();
    if (e.key === 'Enter' || e.key === 'Tab') {
      if ((scanBuf || (t && t.id === 'labSearch')) && scanFinish(t, true)) e.preventDefault();
      return;
    }
    if (!e.key || e.key.length !== 1) return;          // Shift, etc.
    if (now - scanLast > 150) { scanBuf = ''; scanStart = now; }
    scanLast = now;
    scanBuf += e.key;
    if (scanBuf.length === 4 && !scanBusy && (now - scanStart) < 240) scanChip('busy', 'Leyendo…');
    clearTimeout(scanIdle);
    scanIdle = setTimeout(function () { if (scanBuf) scanFinish(document.activeElement, false); }, 250);
  }, true);
  // Filtro Todos / De sucursal / Ecommerce: la pastilla azul se desliza
  // al botón elegido y el tablero entra con una transición.
  var seg = $('labOrigen'), segGlow = seg.querySelector('.lab-seg-glow');
  function moveGlow(instant) {
    var on = seg.querySelector('button.is-on');
    if (!on || !segGlow) return;
    if (instant) segGlow.style.transition = 'none';
    segGlow.style.width = on.offsetWidth + 'px';
    segGlow.style.height = on.offsetHeight + 'px';
    segGlow.style.transform = 'translate(' + on.offsetLeft + 'px,' + on.offsetTop + 'px)';
    if (instant) { void segGlow.offsetWidth; segGlow.style.transition = ''; }
  }
  seg.classList.add('has-glow');
  requestAnimationFrame(function () { moveGlow(true); });
  window.addEventListener('resize', function () { moveGlow(true); });
  var empMenu = null;
  function closeEmpMenu() { if (empMenu) { empMenu.remove(); empMenu = null; } var eb = seg.querySelector('.lab-emp-btn'); if (eb) eb.setAttribute('aria-expanded', 'false'); }
  function openEmpMenu(btn) {
    closeEmpMenu();
    empMenu = document.createElement('div');
    empMenu.className = 'lab-menu lab-emp-menu';
    empMenu.innerHTML = '<div class="lab-menu-label">Empresas</div>' +
      [''].concat(EMPRESAS).map(function (e, i) {
        return '<button type="button" data-emp="' + esc(e) + '" class="' + (origen === 'empresa' && empresaSel === e ? 'is-active' : '') + '" style="--i:' + i + '">' + (e ? esc(e) : 'Todas las empresas') + '</button>';
      }).join('');
    document.body.appendChild(empMenu);
    var r = btn.getBoundingClientRect();
    empMenu.style.left = Math.max(10, Math.min(window.innerWidth - empMenu.offsetWidth - 10, r.right - empMenu.offsetWidth)) + 'px';
    empMenu.style.top = (r.bottom + 6) + 'px';
    btn.setAttribute('aria-expanded', 'true');
    empMenu.addEventListener('click', function (e) {
      var x = e.target.closest('[data-emp]');
      if (!x) return;
      empresaSel = x.dataset.emp;
      $('labEmpLabel').textContent = empresaSel || 'Empresas';
      closeEmpMenu();
      pickOrigen(btn);
    });
  }
  document.addEventListener('click', function (e) {
    if (empMenu && !empMenu.contains(e.target) && !e.target.closest('.lab-emp-btn')) closeEmpMenu();
  });
  window.addEventListener('scroll', closeEmpMenu, true);
  seg.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-origen]');
    if (!b) return;
    if (b.classList.contains('is-on')) return;
    pickOrigen(b);
  });
  function pickOrigen(b) {
    origen = b.dataset.origen;
    seg.querySelectorAll('button').forEach(function (x) { x.classList.toggle('is-on', x === b); });
    moveGlow();
    b.classList.remove('is-pop'); void b.offsetWidth; b.classList.add('is-pop');
    var area = view === 'tablero' ? $('labBoard') : $('labList');
    area.classList.remove('is-swap'); void area.offsetWidth; area.classList.add('is-swap');
    render();
  }

  // Limpiar la columna de Control de calidad (no se borran los trabajos).
  $('labBoard').addEventListener('click', function (e) {
    var b = e.target.closest('[data-clear]');
    if (!b) return;
    e.stopPropagation();
    var n = orders.filter(function (o) { return o.status === b.dataset.clear && !o.limpio; }).length;
    if (!b.classList.contains('is-armed')) {
      b.classList.add('is-armed');
      b.querySelector('span').textContent = n === 1 ? '¿Limpiar 1 trabajo? Toca otra vez' : '¿Limpiar ' + n + ' trabajos? Toca otra vez';
      clearTimeout(b._t); b._t = setTimeout(function () { b.classList.remove('is-armed'); b.querySelector('span').textContent = 'Limpiar columna'; }, 4000);
      return;
    }
    b.disabled = true;
    var col = b.closest('.lab-col');
    if (col) col.classList.add('is-clearing');
    api('/api/laboratorio/limpiar', { method: 'POST', body: { status: b.dataset.clear } }).then(function (r) {
      setTimeout(function () {
        loadOrders();
        toast(r.limpiados === 1 ? 'Se limpió 1 trabajo. No se borró: sigue en el sistema.' : 'Se limpiaron ' + r.limpiados + ' trabajos. No se borraron: siguen en el sistema.');
      }, 380);
    }).catch(function (err) { b.disabled = false; if (col) col.classList.remove('is-clearing'); toast(err.message); });
  });
  if ($('labLimpios')) $('labLimpios').addEventListener('change', function () { verLimpios = this.checked; loadOrders(); });

  $('labRefresh').addEventListener('click', function () {
    this.classList.remove('is-spinning'); void this.offsetWidth; this.classList.add('is-spinning');
    loadOrders();
  });

  setView(view);
  loadOrders();
  // Cada 20 s: así llegan solos los trabajos nuevos (ventas, bot, Comy) y
  // los cambios hechos desde Ventas o Mis ventas.
  setInterval(function () { if (!document.hidden && !dragId && !menuEl) loadOrders(); }, 20000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && !dragId && !menuEl) loadOrders(); });
  if (window.feather) feather.replace();
})();