/* Mis citas (Attomos) — portado de Citas de Recepción de Avante Optics:
   av-date.js + citas-recepcion.js + citas-export.js. */

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

/* Búsqueda de citas: sin acentos, sin importar mayúsculas ni espacios de
   más, y por palabras ("ana ter" encuentra "ANA TERESA DURAN"; antes el
   texto de la fila traía saltos de línea entre nombre y apellido y no
   coincidía). */
function citaNorm(s){
  s = String(s == null ? '' : s).toLowerCase();
  if (s.normalize) s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return s.replace(/\s+/g, ' ').trim();
}
function citaTextMatch(hay, term){
  var words = citaNorm(term).split(' ').filter(Boolean);
  if (!words.length) return true;
  hay = citaNorm(hay);
  for (var i = 0; i < words.length; i++) if (hay.indexOf(words[i]) === -1) return false;
  return true;
}

/* =========================================================
   MIS CITAS — Attomos (sidebar → Mis citas)
   Portado de Recepción → Citas de Avante Optics. Endpoints en
   /api/citas/... (handlers/appointments_panel.go).
   CITAS_OPTICA: el seguimiento al asistir (¿compró? → próxima
   revisión) y el calendario de Revisiones solo salen en ópticas.
   CITAS_CAP: cuántas citas caben a la misma hora (una por trabajador).
   ========================================================= */
window.CITAS_OPTICA = document.body.getAttribute('data-optica') === '1';
window.CITAS_CAP = Math.max(1, parseInt(document.body.getAttribute('data-cap'), 10) || 1);
/* =========================================================
   ETIQUETAS DE CITA — cómo llegó la cita
   (reloj = vino sin cita · corazón = chequeo · teléfono · WhatsApp)
   "bot" es automática: la pone el servidor a las citas que agendó el
   bot. No se elige a mano; si se quita la etiqueta que se le haya
   puesto encima, la cita regresa a "bot".
   Se guardan aparte de la cita:
     GET /api/receptionist/citas/etiquetas      → { tags: { "12": "chequeo" } }
     PUT /api/receptionist/citas/:id/etiqueta   { tag: "chequeo" | "" }
   ========================================================= */
window.CitaTags = (function(){
  var TAGS = {
    bot: { label: 'La agendó el bot', short: 'Bot', auto: true,
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V4M8 4h8M9 14h.01M15 14h.01"/></svg>' },
    sin_cita: { label: 'Vino sin cita', short: 'Sin cita',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>' },
    chequeo: { label: 'Chequeo', short: 'Chequeo',
      icon: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.3 3 4.5 6.7 4.5c2.2 0 3.6 1.2 5.3 3.1 1.7-1.9 3.1-3.1 5.3-3.1 3.7 0 5.8 3.8 4.3 7.3C19.5 16.4 12 21 12 21Z"/></svg>' },
    telefono: { label: 'Agendó por teléfono', short: 'Teléfono',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>' },
    whatsapp: { label: 'Agendó por WhatsApp', short: 'WhatsApp',
      icon: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.2-.2-.5-.3Z"/></svg>' }
  };
  var ORDER = ['sin_cita', 'chequeo', 'telefono', 'whatsapp']; // las que se eligen a mano
  var ALL = ['bot'].concat(ORDER);                          // leyendas y resúmenes
  var byId = {};
  var loaded = false;

  function icon(tag, extra){
    var t = TAGS[tag];
    if (!t) return '';
    return '<i class="cita-tag-ico tag-' + tag + (extra ? ' ' + extra : '') + '" title="' + t.label + '" aria-label="' + t.label + '">' + t.icon + '</i>';
  }
  function pill(tag){
    var t = TAGS[tag];
    if (!t) return '';
    return '<span class="cita-tag-pill tag-' + tag + '" title="' + t.label + '">' + t.icon + '<span>' + t.short + '</span></span>';
  }
  // Botones para elegir (el activo marcado; clic en el activo lo quita)
  function options(active){
    // La automática solo se muestra (sin poder tocarla) cuando la cita la tiene.
    var auto = active === 'bot'
      ? '<button type="button" class="cita-tag-opt tag-bot is-on is-auto" disabled title="Se pone sola cuando tu bot agenda la cita">' +
          TAGS.bot.icon + '<span>Bot · automática</span></button>'
      : '';
    return auto + ORDER.map(function(k){
      var t = TAGS[k];
      return '<button type="button" class="cita-tag-opt tag-' + k + (k === active ? ' is-on' : '') + '" data-tag="' + k + '" aria-pressed="' + (k === active) + '" title="' + t.label + '">' +
        t.icon + '<span>' + t.label + '</span></button>';
    }).join('');
  }
  function load(){
    return fetch('/api/citas/etiquetas', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function(r){ return r.ok ? r.json() : { tags: {} }; })
      .then(function(d){ byId = (d && d.tags) || {}; loaded = true; return byId; })
      .catch(function(){ loaded = true; return byId; });
  }
  function set(id, tag){
    tag = TAGS[tag] ? tag : '';
    return fetch('/api/citas/' + encodeURIComponent(id) + '/etiqueta', {
      method: 'PUT', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ tag: tag })
    }).then(function(r){
      return r.json().catch(function(){ return {}; }).then(function(d){
        if (!r.ok) throw new Error(d.error || 'No se pudo guardar la etiqueta.');
        // El servidor regresa la que quedó (al quitarla, una cita de la
        // del bot vuelve a "bot").
        if (typeof d.tag === 'string') tag = TAGS[d.tag] ? d.tag : '';
        if (tag) byId[String(id)] = tag; else delete byId[String(id)];
        return tag;
      });
    });
  }
  return {
    TAGS: TAGS, ORDER: ORDER, ALL: ALL, icon: icon, pill: pill, options: options, load: load, set: set,
    get: function(id){ return byId[String(id)] || ''; },
    isLoaded: function(){ return loaded; }
  };
})();

/* =========================================================
   SEGUIMIENTO AL ASISTIR — ¿compró? y cada cuánto le toca su
   próxima revisión (3 meses, 6 meses o 1 año). Si no compró, no
   se le programa revisión. Se guarda aparte de la cita:
     GET /api/receptionist/citas/seguimiento
         → { items: { "12": { compro: true, meses: 6 }, "15": { compro: false } } }
     PUT /api/receptionist/citas/:id/seguimiento  { compro, meses }
         (además marca la cita como "asistio" si no lo estaba)
   ========================================================= */
/* =========================================================
   QUIÉN HIZO LA CITA — appointments.origen (data-origen en la fila)
     "web"       → el cliente la hizo él solo desde la página.
     "recepcion" → la agendó recepción desde el panel.
   En "verificada" (por atender) el estado se ve como "Por la web" o
   "Por recepción"; en los demás estados la etiqueta de origen se
   muestra junto al estado. La lógica sigue usando el estado.
   ========================================================= */
window.CitaOrigen = window.CitaOrigen || (function(){
  var LABELS = { pendiente: 'Pendiente', verificada: 'Por el bot', recepcion: 'Desde el panel', cancelada: 'Cancelada', asistio: 'Asistió', no_asistio: 'No asistió' };
  var TITLES = {
    pendiente: 'Falta confirmar la cita',
    verificada: 'La agendó tu bot por WhatsApp',
    recepcion: 'La agendaste desde el panel'
  };
  // Clave para mostrar: "recepcion" si es una verificada hecha por recepción.
  function key(status, origen){ return status === 'verificada' && origen === 'recepcion' ? 'recepcion' : status; }
  function ofRow(row){ return key(row.dataset.status, row.dataset.origen); }
  // Clases del badge: la verificada de recepción lleva las dos.
  function badgeClass(k){ return 'admin-badge ' + (k === 'recepcion' ? 'verificada recepcion' : k); }
  // El origen se queda visible aunque la cita cambie de estado (asistió,
  // no asistió, cancelada…). En "verificada" el propio estado ya lo dice.
  function originKey(row){ return row.dataset.origen === 'recepcion' ? 'recepcion' : 'verificada'; }
  function showOrigin(row){ return row.dataset.status !== 'verificada'; }
  function originHTML(row){
    if (!showOrigin(row)) return '';
    var k = originKey(row);
    return '<span class="' + badgeClass(k) + ' cita-origen-badge" title="' + TITLES[k] + '">' + LABELS[k] + '</span>';
  }
  function paintOrigin(statusEl, row){
    if (!statusEl || !statusEl.parentNode) return;
    var el = document.getElementById('calEventOrigen');
    if (!el) {
      el = document.createElement('span');
      el.id = 'calEventOrigen';
      statusEl.parentNode.insertBefore(el, statusEl);
    }
    var k = originKey(row);
    el.className = badgeClass(k) + ' cita-origen-badge';
    el.textContent = LABELS[k];
    el.title = TITLES[k];
    el.hidden = !showOrigin(row);
    // [hidden] no basta: .admin-badge trae su propio display.
    el.style.display = showOrigin(row) ? '' : 'none';
  }
  return { LABELS: LABELS, TITLES: TITLES, key: key, ofRow: ofRow, badgeClass: badgeClass,
    originKey: originKey, originHTML: originHTML, paintOrigin: paintOrigin,
    label: function(k){ return LABELS[k] || k; }, title: function(k){ return TITLES[k] || ''; } };
})();

window.CitaSeg = (function(){
  var byId = {};
  var MESES_LABEL = { 3: '3 meses', 6: '6 meses', 12: '1 año' };
  function load(){
    return fetch('/api/citas/seguimiento', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function(r){ return r.ok ? r.json() : { items: {} }; })
      .then(function(d){ byId = (d && d.items) || {}; return byId; })
      .catch(function(){ return byId; });
  }
  function set(id, compro, meses){
    var body = compro ? { compro: true, meses: meses || 12 } : { compro: false };
    return fetch('/api/citas/' + encodeURIComponent(id) + '/seguimiento', {
      method: 'PUT', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body)
    }).then(function(r){
      return r.json().catch(function(){ return {}; }).then(function(d){
        if (!r.ok) throw new Error(d.error || 'No se pudo guardar.');
        byId[String(id)] = body;
        return body;
      });
    });
  }
  // "Compró · revisión en 6 meses" / "No compró · sin revisión"
  function label(f){
    if (!f) return '';
    return f.compro ? 'Compró · revisión en ' + (MESES_LABEL[f.meses] || '1 año') : 'No compró · sin revisión';
  }
  return {
    load: load, set: set, label: label, MESES_LABEL: MESES_LABEL,
    get: function(id){ return byId[String(id)] || null; }
  };
})();

/* =========================================================
   CITAS — filtro por fecha + indicadores por tipo de cita
   Va igual en citas.js (Admin) y citas-recepcion.js (Recepción).

   - Periodo (Todas / Hoy / Esta semana / Este mes / Mes pasado /
     Rango): filtra por el DÍA de la cita. Cambia los indicadores
     de estado (totales, verificadas, …), los de tipo y la tabla.
   - Tipo de cita = la etiqueta de "cómo llegó" (vino sin cita,
     chequeo, teléfono, WhatsApp) más "Sitio web", que se pone sola
     a las citas que hizo el cliente en la página. Las que no tienen
     ninguna cuentan como "Sin etiqueta". Clic en un tipo filtra la tabla.

   Recepción ya carga las etiquetas (CitaTags, row.dataset.tag y el
   evento "citatags:change"). En Admin no existe CitaTags: aquí se
   piden a data-tags-url y se pone el ícono junto al estado.

   API para citas.js / citas-recepcion.js:
     CitasFiltro.inRange(row)   → la cita cae en el periodo
     CitasFiltro.matches(row)   → periodo + tipo seleccionado
     CitasFiltro.renderTipos(rows)  → pinta los indicadores de tipo
     CitasFiltro.onChange(fn)   → se llama al cambiar el filtro
   ========================================================= */
window.CitasFiltro = (function(){
  var root = document.getElementById('citasFiltro');
  var tiposEl = document.getElementById('citasTipos');
  var STORE = 'attomosCitasFiltro';

  var TIPOS = {
    bot: { label: 'Bot', title: 'La agendó tu bot (se pone sola)',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V4M8 4h8M9 14h.01M15 14h.01"/></svg>' },
    web: { label: 'Sin etiqueta', title: 'Citas del panel sin marcar cómo llegaron',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>' },
    sin_cita: { label: 'Vino sin cita', title: 'Vino sin cita',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>' },
    chequeo: { label: 'Chequeo', title: 'Chequeo',
      icon: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.3 3 4.5 6.7 4.5c2.2 0 3.6 1.2 5.3 3.1 1.7-1.9 3.1-3.1 5.3-3.1 3.7 0 5.8 3.8 4.3 7.3C19.5 16.4 12 21 12 21Z"/></svg>' },
    telefono: { label: 'Por teléfono', title: 'Agendó por teléfono',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>' },
    whatsapp: { label: 'Por WhatsApp', title: 'Agendó por WhatsApp',
      icon: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.2-.2-.5-.3Z"/></svg>' }
  };
  var ORDER = ['bot', 'sin_cita', 'chequeo', 'telefono', 'whatsapp', 'web'];
  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  var state = { period: 'todas', desde: '', hasta: '', tipo: '' };
  try {
    var saved = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (saved && typeof saved === 'object') {
      state.period = saved.period || 'todas';
      state.desde = saved.desde || '';
      state.hasta = saved.hasta || '';
    }
  } catch (e) {}

  var listeners = [];
  function emit(){ listeners.forEach(function(fn){ try { fn(); } catch (e) {} }); }
  function save(){
    try { localStorage.setItem(STORE, JSON.stringify({ period: state.period, desde: state.desde, hasta: state.hasta })); } catch (e) {}
  }

  /* ---------- fechas ---------- */
  function pad(n){ return (n < 10 ? '0' : '') + n; }
  function iso(d){ return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function addDays(d, n){ var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; }
  function bounds(){
    var t = new Date(); t = new Date(t.getFullYear(), t.getMonth(), t.getDate());
    switch (state.period) {
      case 'hoy': return [iso(t), iso(t)];
      case 'semana': {
        var dow = (t.getDay() + 6) % 7; // lunes = 0
        var lun = addDays(t, -dow);
        return [iso(lun), iso(addDays(lun, 6))];
      }
      case 'mes': return [iso(new Date(t.getFullYear(), t.getMonth(), 1)), iso(new Date(t.getFullYear(), t.getMonth() + 1, 0))];
      case 'mespasado': return [iso(new Date(t.getFullYear(), t.getMonth() - 1, 1)), iso(new Date(t.getFullYear(), t.getMonth(), 0))];
      case 'rango': {
        var a = state.desde, b = state.hasta;
        if (a && b && a > b) { var x = a; a = b; b = x; }
        return [a || '', b || ''];
      }
      default: return ['', ''];
    }
  }
  function fmt(s){
    if (!s) return '';
    var p = s.split('-');
    return Number(p[2]) + ' ' + MESES[Number(p[1]) - 1] + ' ' + p[0];
  }

  function inRange(row){
    var b = bounds();
    var d = row.dataset.date || '';
    if (b[0] && d < b[0]) return false;
    if (b[1] && d > b[1]) return false;
    return true;
  }
  function tipoOf(row){ return TIPOS[row.dataset.tag] ? row.dataset.tag : 'web'; }
  function matches(row){
    if (!inRange(row)) return false;
    return !state.tipo || tipoOf(row) === state.tipo;
  }

  /* ---------- indicadores de tipo ---------- */
  function buildTipos(){
    if (!tiposEl) return;
    tiposEl.innerHTML = ORDER.map(function(k){
      var t = TIPOS[k];
      return '<button type="button" class="cf-tipo tag-' + k + '" data-tipo="' + k + '" title="' + t.title + '" aria-pressed="false">' +
        '<i class="cf-tipo-ico">' + t.icon + '</i>' +
        '<span class="cf-tipo-txt"><strong class="cf-tipo-num">0</strong><small>' + t.label + '</small></span>' +
        '<span class="cf-tipo-pct">0%</span>' +
        '<span class="cf-tipo-bar"><i></i></span>' +
      '</button>';
    }).join('');
    tiposEl.addEventListener('click', function(e){
      var b = e.target.closest('.cf-tipo');
      if (!b) return;
      state.tipo = state.tipo === b.dataset.tipo ? '' : b.dataset.tipo;
      showTable();
      emit();
    });
  }
  function renderTipos(rows){
    if (!tiposEl) return;
    var counts = { bot: 0, web: 0, sin_cita: 0, chequeo: 0, telefono: 0, whatsapp: 0 };
    rows.forEach(function(r){ counts[tipoOf(r)]++; });
    var total = rows.length;
    ORDER.forEach(function(k){
      var b = tiposEl.querySelector('[data-tipo="' + k + '"]');
      if (!b) return;
      var pct = total ? Math.round(counts[k] * 100 / total) : 0;
      b.querySelector('.cf-tipo-num').textContent = counts[k];
      b.querySelector('.cf-tipo-pct').textContent = pct + '%';
      b.querySelector('.cf-tipo-bar i').style.width = pct + '%';
      b.classList.toggle('is-on', state.tipo === k);
      b.classList.toggle('is-zero', counts[k] === 0);
      b.setAttribute('aria-pressed', state.tipo === k ? 'true' : 'false');
    });
    tiposEl.classList.toggle('has-active', !!state.tipo);
    renderCaption(total);
  }

  /* ---------- barra de periodo ---------- */
  var seg = root && root.querySelector('.cf-seg');
  var range = root && root.querySelector('.cf-range');
  var desdeIn = document.getElementById('cfDesde');
  var hastaIn = document.getElementById('cfHasta');
  var caption = document.getElementById('cfCaption');

  function renderBar(){
    if (!seg) return;
    Array.prototype.forEach.call(seg.querySelectorAll('button'), function(b){
      b.classList.toggle('is-on', b.dataset.period === state.period);
    });
    if (range) range.hidden = state.period !== 'rango';
    if (desdeIn) desdeIn.value = state.desde;
    if (hastaIn) hastaIn.value = state.hasta;
    Array.prototype.forEach.call(document.querySelectorAll('.cf-dp'), function(p){ if (p._label) p._label(); });
  }
  function renderCaption(total){
    if (!caption) return;
    var b = bounds();
    var txt;
    if (!b[0] && !b[1]) txt = 'Todas las fechas';
    else if (b[0] === b[1]) txt = fmt(b[0]);
    else if (b[0] && b[1]) txt = fmt(b[0]) + ' – ' + fmt(b[1]);
    else if (b[0]) txt = 'Desde el ' + fmt(b[0]);
    else txt = 'Hasta el ' + fmt(b[1]);
    txt += ' · ' + total + (total === 1 ? ' cita' : ' citas');
    if (state.tipo) txt += ' · tabla filtrada: ' + TIPOS[state.tipo].label.toLowerCase();
    caption.textContent = txt;
  }
  // Al filtrar, se pasa a la vista de tabla (Día y Calendario
  // tienen su propia navegación por fecha).
  function showTable(){
    var tablaBtn = document.querySelector('#citasViewSwitch .view-switch-btn[data-view="tabla"]');
    if (tablaBtn && !tablaBtn.classList.contains('active')) tablaBtn.click();
  }

  if (seg) {
    seg.addEventListener('click', function(e){
      var b = e.target.closest('button[data-period]');
      if (!b) return;
      state.period = b.dataset.period;
      if (state.period === 'rango' && !state.desde && !state.hasta) {
        var t = new Date();
        state.desde = iso(new Date(t.getFullYear(), t.getMonth(), 1));
        state.hasta = iso(t);
      }
      save(); renderBar();
      if (state.period !== 'todas') showTable();
      emit();
    });
  }
  function onDate(){
    state.desde = desdeIn ? desdeIn.value : '';
    state.hasta = hastaIn ? hastaIn.value : '';
    save(); emit();
  }
  desdeIn && desdeIn.addEventListener('change', onDate);
  hastaIn && hastaIn.addEventListener('change', onDate);

  /* ---------- calendarios de Desde / Hasta (mismo picker y animación
     que el de "Crear cita": .cb-datepicker + .is-open) ---------- */
  var MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var dps = Array.prototype.slice.call(document.querySelectorAll('.cf-dp'));
  function closeDps(except){ dps.forEach(function(p){ if (p !== except) p.classList.remove('is-open'); }); }
  dps.forEach(function(picker){
    var input = document.getElementById(picker.dataset.input);
    var trigger = picker.querySelector('.cb-datepicker-trigger');
    var valueEl = picker.querySelector('.cb-datepicker-value');
    var monthEl = picker.querySelector('.cf-dp-month');
    var grid = picker.querySelector('.cb-datepicker-grid');
    var vy, vm;
    function label(){
      var v = input.value;
      if (!v) { valueEl.textContent = 'dd/mm/aaaa'; return; }
      var p = v.split('-');
      valueEl.textContent = p[2] + '/' + p[1] + '/' + p[0];
    }
    function render(){
      monthEl.textContent = MESES_LARGOS[vm].charAt(0).toUpperCase() + MESES_LARGOS[vm].slice(1) + ' de ' + vy;
      var first = new Date(vy, vm, 1).getDay();
      var dim = new Date(vy, vm + 1, 0).getDate();
      var dimPrev = new Date(vy, vm, 0).getDate();
      var cells = Math.ceil((first + dim) / 7) * 7;
      var todayIso = iso(new Date());
      var a = state.desde, b = state.hasta;
      if (a && b && a > b) { var x = a; a = b; b = x; }
      var html = '';
      for (var i = 0; i < cells; i++) {
        var d, y = vy, m = vm, out = false;
        if (i < first) { d = dimPrev - (first - 1 - i); m -= 1; out = true; }
        else if (i >= first + dim) { d = i - (first + dim) + 1; m += 1; out = true; }
        else d = i - first + 1;
        var ci = iso(new Date(y, m, d));
        var cls = 'cb-datepicker-day';
        if (out) cls += ' is-outside';
        if (ci === todayIso) cls += ' is-today';
        if (ci === input.value) cls += ' is-selected';
        else if (a && b && ci > a && ci < b) cls += ' is-inrange';
        html += '<button type="button" class="' + cls + '" data-iso="' + ci + '">' + d + '</button>';
      }
      grid.innerHTML = html;
    }
    function setValue(v){
      input.value = v;
      label();
      input.dispatchEvent(new Event('change'));
    }
    picker.addEventListener('click', function(e){ e.stopPropagation(); });
    trigger.addEventListener('click', function(){
      if (picker.classList.contains('is-open')) { picker.classList.remove('is-open'); return; }
      closeDps(picker);
      var base = input.value ? input.value.split('-').map(Number) : null;
      var t = new Date();
      vy = base ? base[0] : t.getFullYear();
      vm = base ? base[1] - 1 : t.getMonth();
      render();
      picker.classList.add('is-open');
    });
    picker.querySelectorAll('[data-nav]').forEach(function(btn){
      btn.addEventListener('click', function(){
        vm += Number(btn.dataset.nav);
        if (vm < 0) { vm = 11; vy -= 1; }
        if (vm > 11) { vm = 0; vy += 1; }
        render();
      });
    });
    picker.querySelector('[data-act="hoy"]').addEventListener('click', function(){
      setValue(iso(new Date()));
      picker.classList.remove('is-open');
    });
    grid.addEventListener('click', function(e){
      var day = e.target.closest('.cb-datepicker-day');
      if (!day) return;
      setValue(day.dataset.iso);
      picker.classList.remove('is-open');
    });
    picker._label = label;
  });
  document.addEventListener('click', function(){ closeDps(null); });
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape') closeDps(null); });

  buildTipos();
  renderBar();

  /* ---------- etiquetas en Admin (no hay CitaTags) ---------- */
  document.addEventListener('citatags:change', emit);
  var tagsUrl = root && root.dataset.tagsUrl;
  if (tagsUrl && !window.CitaTags) {
    fetch(tagsUrl, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function(r){ return r.ok ? r.json() : { tags: {} }; })
      .then(function(d){
        var tags = (d && d.tags) || {};
        var rows = document.querySelectorAll('#citasTableBody tr[data-id]');
        Array.prototype.forEach.call(rows, function(row){
          var tag = TIPOS[tags[row.dataset.id]] ? tags[row.dataset.id] : '';
          row.dataset.tag = tag;
          var badge = row.querySelector('td .admin-badge');
          if (tag && badge && !badge.parentNode.querySelector('.cita-tag-ico')) {
            badge.insertAdjacentHTML('afterend', '<i class="cita-tag-ico in-table tag-' + tag + '" title="' + TIPOS[tag].title + '">' + TIPOS[tag].icon + '</i>');
          }
        });
        emit();
      })
      .catch(function(){});
  }

  return {
    inRange: inRange,
    matches: matches,
    renderTipos: renderTipos,
    bounds: bounds,
    label: function(){ var b = bounds(); return !b[0] && !b[1] ? 'Todas las fechas' : b[0] === b[1] ? fmt(b[0]) : (fmt(b[0]) || '…') + ' – ' + (fmt(b[1]) || '…'); },
    onChange: function(fn){ listeners.push(fn); },
    TIPOS: TIPOS
  };
})();

(function(){
  var tbody = document.getElementById('citasTableBody');
  if (!tbody) return;

  var allRows = Array.prototype.slice.call(tbody.querySelectorAll('tr[data-id]'));
  var PAGE_SIZE = parseInt(localStorage.getItem('attomosCitasPageSize'), 10) || 8;
  var currentPage = 1;
  var searchTerm = '';

  /* ---------- filtro por periodo / tipo (CitasFiltro, arriba) ---------- */
  var CF = window.CitasFiltro || { inRange: function(){ return true; }, matches: function(){ return true; }, renderTipos: function(){}, onChange: function(){} };

  /* ---------- estadísticas (sobre las citas del periodo elegido) ---------- */
  function renderStats(){
    var periodRows = allRows.filter(CF.inRange);
    CF.renderTipos(periodRows);
    var statRows = periodRows.filter(CF.matches);
    var verificadas = statRows.filter(function(r){ return r.dataset.status === 'verificada'; }).length;
    var canceladas = statRows.filter(function(r){ return r.dataset.status === 'cancelada'; }).length;

    var totalEl = document.getElementById('citasStatTotal');
    var confEl = document.getElementById('citasStatVerificadas');
    var cancEl = document.getElementById('citasStatCanceladas');
    var asistio = statRows.filter(function(r){ return r.dataset.status === 'asistio'; }).length;
    var noAsistio = statRows.filter(function(r){ return r.dataset.status === 'no_asistio'; }).length;
    var asisEl = document.getElementById('citasStatAsistio');
    var noAsisEl = document.getElementById('citasStatNoAsistio');
    if (asisEl) asisEl.textContent = asistio;
    if (noAsisEl) noAsisEl.textContent = noAsistio;
    if (totalEl) totalEl.textContent = statRows.length;
    if (confEl) confEl.textContent = verificadas;
    if (cancEl) cancEl.textContent = canceladas;
  }

  /* ---------- filtro + paginación ---------- */
  function getFiltered(){
    var term = searchTerm.toLowerCase().trim();
    return allRows.filter(function(row){
      if (!CF.matches(row)) return false;
      return term === '' || citaTextMatch(row.textContent + ' ' + (row.dataset.celular || '') + ' ' + (row.dataset.correo || '') + ' ' + (row.dataset.notas || ''), term);
    });
  }
  CF.onChange(function(){ currentPage = 1; renderStats(); renderView(); });

  function renderView(){
    var filtered = getFiltered();
    var total = filtered.length;
    var totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
    var start = (currentPage - 1) * PAGE_SIZE;
    var pageRows = filtered.slice(start, start + PAGE_SIZE);

    allRows.forEach(function(row){ row.style.display = 'none'; });
    pageRows.forEach(function(row){ row.style.display = ''; });

    var footCount = document.getElementById('citasFootCount');
    if (footCount) {
      footCount.textContent = total === 0
        ? 'Mostrando 0 de 0 citas'
        : 'Mostrando ' + (start + 1) + '–' + Math.min(start + PAGE_SIZE, total) + ' de ' + total + ' citas';
    }
    var pagCurrent = document.getElementById('citasPagCurrent');
    if (pagCurrent) pagCurrent.textContent = 'Página ' + currentPage + ' de ' + totalPages;
    var pagPrev = document.getElementById('citasPagPrev');
    var pagNext = document.getElementById('citasPagNext');
    if (pagPrev) pagPrev.disabled = currentPage <= 1;
    if (pagNext) pagNext.disabled = currentPage >= totalPages;

    var emptyEl = document.getElementById('citasEmpty');
    if (emptyEl && allRows.length > 0) {
      emptyEl.style.display = total === 0 ? 'block' : 'none';
      if (total === 0) emptyEl.textContent = 'No hay citas en este periodo o con esa búsqueda.';
    }
  }

  var pagPrevBtn = document.getElementById('citasPagPrev');
  var pagNextBtn = document.getElementById('citasPagNext');
  pagPrevBtn && pagPrevBtn.addEventListener('click', function(){
    if (currentPage > 1) { currentPage -= 1; renderView(); }
  });
  pagNextBtn && pagNextBtn.addEventListener('click', function(){
    currentPage += 1; renderView();
  });

  var searchInput = document.getElementById('citasSearch');
  searchInput && searchInput.addEventListener('input', function(){
    searchTerm = searchInput.value;
    currentPage = 1;
    renderView();
  });

  /* ---------- menú de acciones (3 puntos) ---------- */
  function closeAllMenus(exceptId){
    Array.prototype.slice.call(tbody.querySelectorAll('.row-menu')).forEach(function(menu){
      if (menu.dataset.menuId !== exceptId) {
        menu.classList.remove('is-open', 'is-up');
        var btn = menu.querySelector('.row-menu-btn');
        if (btn) btn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* ---------- Modal: ¿seguro que quieres cancelar la cita? ---------- */
  var cancelOverlay = document.getElementById('cancelCitaModalOverlay');
  var cancelWhoEl = document.getElementById('cancelCitaWho');
  var cancelWhenEl = document.getElementById('cancelCitaWhen');
  var cancelConfirmBtn = document.getElementById('cancelCitaConfirm');
  var pendingCancelId = null;

  function askCancel(id){
    if (!cancelOverlay) { updateStatus(id, 'cancelada'); return; }
    var row = tbody.querySelector('tr[data-id="' + id + '"]');
    var nombre = row && row.dataset.nombre ? row.dataset.nombre.trim() : '';
    var dia = row && row.querySelector('.cita-dia') ? row.querySelector('.cita-dia').textContent.trim() : '';
    var hora = row ? (row.dataset.time || '') : '';
    cancelWhoEl.textContent = nombre || ('la cita #' + id);
    cancelWhenEl.textContent = [dia, hora].filter(Boolean).join(' · ');
    pendingCancelId = id;
    cancelConfirmBtn.disabled = false;
    cancelConfirmBtn.textContent = 'Sí, cancelar';
    cancelOverlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeCancelModal(){
    if (!cancelOverlay) return;
    cancelOverlay.classList.remove('open');
    document.body.style.overflow = '';
    pendingCancelId = null;
  }
  if (cancelOverlay) {
    document.getElementById('cancelCitaModalClose').addEventListener('click', closeCancelModal);
    document.getElementById('cancelCitaBack').addEventListener('click', closeCancelModal);
    cancelOverlay.addEventListener('click', function(e){ if (e.target === cancelOverlay) closeCancelModal(); });
    cancelConfirmBtn.addEventListener('click', function(){
      if (!pendingCancelId) return;
      cancelConfirmBtn.disabled = true;
      cancelConfirmBtn.textContent = 'Cancelando...';
      updateStatus(pendingCancelId, 'cancelada', function(){
        cancelConfirmBtn.disabled = false;
        cancelConfirmBtn.textContent = 'Sí, cancelar';
      });
    });
  }

  function updateStatus(id, status, onFail){
    fetch('/api/citas/' + id + '/estado', {
      method: 'PATCH', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: status })
    }).then(function(res){
      if (res.ok) window.location.reload();
      else if (onFail) onFail();
    }).catch(function(){ if (onFail) onFail(); });
  }

  /* ---------- Modal: Asistió → ¿compró? → próxima revisión ----------
     Sí compró: se elige cuándo le toca volver (3 meses, 6 meses o 1 año,
     por defecto 1 año) y aparece en el calendario en "Revisiones".
     No compró: no se le programa revisión. Guardar también marca la
     cita como "asistio" (PUT .../seguimiento lo hace en el servidor). */
  var asOverlay = document.getElementById('asistioModalOverlay');
  var asId = null, asCompro = null, asMeses = 12, asDate = '', asChequeo = false;
  // Chequeo = ya compró antes: no se pregunta "¿compró?", solo la revisión.
  function esChequeo(id){ return !!(window.CitaTags && CitaTags.get(id) === 'chequeo'); }
  function asAddMonths(iso, months){
    var p = iso.split('-').map(Number);
    var y = p[0], m = p[1] - 1 + months, d = p[2];
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    var last = new Date(y, m + 1, 0).getDate();
    return d > last ? [y, m, last] : [y, m, d];
  }
  function asRender(){
    asOverlay.querySelectorAll('.asistio-opt').forEach(function(b){
      var on = asCompro !== null && b.dataset.compro === (asCompro ? '1' : '0');
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    var wrap = document.getElementById('asistioMesesWrap');
    wrap.hidden = asCompro !== true;
    var step = document.getElementById('asistioComproStep');
    var note = document.getElementById('asistioChequeoNote');
    if (step) step.hidden = asChequeo;
    if (note) note.hidden = !asChequeo;
    asOverlay.querySelectorAll('#asistioMeses button').forEach(function(b){
      var on = Number(b.dataset.meses) === asMeses;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    if (asDate) {
      var due = asAddMonths(asDate, asMeses);
      document.getElementById('asistioDue').textContent = 'Le tocará volver el ' + due[2] + ' de ' + MESES[due[1]] + ' de ' + due[0] + '.';
    }
    document.getElementById('asistioSave').disabled = asCompro === null;
  }
  function openAsistio(id){
    var row = tbody.querySelector('tr[data-id="' + id + '"]');
    // Chequeo: solo se marca que asistió. No se programa revisión (el
    // cliente agenda sus chequeos y se duplicarían las revisiones).
    if (!window.CITAS_OPTICA) { if (!row || row.dataset.status !== 'asistio') updateStatus(id, 'asistio'); return; }
    if (esChequeo(id)) { if (!row || row.dataset.status !== 'asistio') updateStatus(id, 'asistio'); return; }
    if (!row || !asOverlay) { updateStatus(id, 'asistio'); return; }
    var prev = CitaSeg.get(id);
    asId = id;
    asChequeo = esChequeo(id);
    asCompro = asChequeo ? true : (prev ? !!prev.compro : null);
    asMeses = prev && prev.compro && prev.meses ? Number(prev.meses) : 12;
    asDate = row.dataset.date || '';
    var dia = row.querySelector('.cita-dia') ? row.querySelector('.cita-dia').textContent.trim() : asDate;
    document.getElementById('asistioTitle').textContent = asChequeo
      ? (row.dataset.status === 'asistio' ? 'Próxima revisión' : 'Asistió a su chequeo')
      : (row.dataset.status === 'asistio' ? '¿Compró algo?' : 'Asistió a su cita');
    document.getElementById('asistioWho').textContent = (row.dataset.nombre || '').trim() || 'Sin nombre';
    document.getElementById('asistioWhen').textContent = dia + (row.dataset.time ? ' · ' + String(row.dataset.time).slice(0, 5) : '');
    document.getElementById('asistioError').textContent = '';
    var save = document.getElementById('asistioSave');
    save.textContent = 'Guardar';
    asRender();
    asOverlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeAsistio(){
    if (!asOverlay) return;
    asOverlay.classList.remove('open');
    document.body.style.overflow = '';
  }
  if (asOverlay) {
    document.getElementById('asistioCompro').addEventListener('click', function(e){
      var b = e.target.closest('.asistio-opt');
      if (!b) return;
      asCompro = b.dataset.compro === '1';
      asRender();
    });
    document.getElementById('asistioMeses').addEventListener('click', function(e){
      var b = e.target.closest('button[data-meses]');
      if (!b) return;
      asMeses = Number(b.dataset.meses);
      asRender();
    });
    document.getElementById('asistioClose').addEventListener('click', closeAsistio);
    document.getElementById('asistioCancel').addEventListener('click', closeAsistio);
    document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && asOverlay.classList.contains('open')) closeAsistio(); });
    document.getElementById('asistioSave').addEventListener('click', function(){
      if (asCompro === null) return;
      var save = this;
      save.disabled = true;
      save.textContent = 'Guardando...';
      CitaSeg.set(asId, asCompro, asMeses).then(function(){
        window.location.reload();
      }).catch(function(err){
        document.getElementById('asistioError').textContent = err.message || 'No se pudo guardar. Intenta de nuevo.';
        save.disabled = false;
        save.textContent = 'Guardar';
      });
    });
  }

  /* ---------- Modal: ver datos del cliente ---------- */
  var clienteModalOverlay = document.getElementById('clienteDetalleModalOverlay');
  var clienteModalClose = document.getElementById('clienteDetalleModalClose');

  // Etiquetas legibles para las respuestas del cuestionario rápido que
  // llena el cliente en el flujo público (ver appointmentQuestionnaire
  // en handlers/appointments.go) — se guarda como JSON crudo en
  // data-cuestionario, aquí solo se pinta bonito.
  var QUEST_LABELS = {
    ultimo_examen: 'Último examen de la vista',
    lentes_armazon: '¿Usa lentes con armazón?',
    lentes_contacto: '¿Usa lentes de contacto?',
    usa_gotitas: '¿Usa gotas para los ojos?',
    problemas: 'Problemas visuales',
    enfermedades: 'Enfermedades relacionadas',
    como_se_entero: '¿Cómo se enteró de nosotros?',
    procedencia: '¿Viene de parte de?'
  };
  if (!window.CITAS_OPTICA) QUEST_LABELS = { como_se_entero: '¿Cómo se enteró de nosotros?' };

  // Texto que ve el cliente en agendar.html para cada valor guardado.
  var QUEST_VALUE_LABELS = {
    menos_6_meses: 'Menos de 6 meses',
    '6_meses_1_anio': 'Entre 6 meses y 1 año',
    '1_2_anios': 'Entre 1 y 2 años',
    mas_2_anios: 'Más de 2 años',
    nunca: 'Nunca me he hecho uno',
    si: 'Sí',
    no: 'No',
    fatiga_visual: 'Fatiga visual (al trabajar con la computadora)',
    mala_vision_lejana: 'Mala visión lejana',
    mala_vision_cercana: 'Mala visión cercana',
    sensibilidad_luz_solar: 'Sensibilidad a la luz solar',
    sensibilidad_luz_artificial: 'Sensibilidad a la luz artificial',
    diabetes: 'Diabetes',
    hipertension: 'Hipertensión',
    cirugias_oculares: 'Cirugías oculares',
    facebook: 'Facebook',
    instagram: 'Instagram',
    television: 'Televisión',
    tiktok: 'TikTok',
    sitio_web: 'Sitio web',
    whatsapp: 'WhatsApp',
    google_maps: 'Google Maps',
    familiares: 'Familiares',
    amigos: 'Amigos',
    recomendado: 'Me recomendaron',
    casualidad: 'Pasó por casualidad',
    recurrente: 'Cliente recurrente',
    por_empresa: 'Por empresa',
    empresa: 'Una empresa',
    ninguno: 'Ninguno',
    ninguna: 'Ninguna'
  };

  // Traduce un valor crudo; si no está en el mapa, quita guiones bajos
  // y pone mayúscula inicial para que nunca salga "algo_asi".
  function questValueLabel(v) {
    if (v === null || v === undefined) return '';
    var raw = String(v).trim();
    if (!raw) return '';
    var key = raw.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(QUEST_VALUE_LABELS, key)) {
      return QUEST_VALUE_LABELS[key];
    }
    var txt = raw.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
    return txt.charAt(0).toUpperCase() + txt.slice(1);
  }

  function fillClienteField(id, value){
    var el = document.getElementById(id);
    if (!el) return;
    var v = (value || '').trim();
    el.textContent = v || 'No proporcionado';
    el.classList.toggle('is-empty', !v);
  }

  function openClienteModal(id){
    if (!clienteModalOverlay) return;
    var row = tbody.querySelector('tr[data-id="' + id + '"]');
    if (!row) return;

    var nombreCompleto = row.dataset.nombre ? row.dataset.nombre.trim() : '';
    fillClienteField('clienteDetalleNombre', nombreCompleto);
    fillClienteField('clienteDetalleCelular', row.dataset.celular);
    fillClienteField('clienteDetalleCorreo', row.dataset.correo);
    fillClienteField('clienteDetalleNacimiento', row.dataset.fechaNacimiento);
    renderClienteCompro(id, row);

    var questWrap = document.getElementById('clienteDetalleCuestionario');
    var questEmpty = document.getElementById('clienteDetalleCuestionarioEmpty');
    if (questWrap) {
      questWrap.innerHTML = '';
      var raw = row.dataset.cuestionario;
      var parsed = null;
      if (raw) {
        try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
      }
      var hasAnswers = parsed && Object.keys(parsed).some(function(k){
        var v = parsed[k];
        return Array.isArray(v) ? v.length > 0 : !!v;
      });
      if (questEmpty) questEmpty.style.display = hasAnswers ? 'none' : 'block';
      if (hasAnswers) {
        Object.keys(QUEST_LABELS).forEach(function(key){
          if (!(key in parsed)) return;
          var val = parsed[key];
          var text = Array.isArray(val)
            ? (val.map(questValueLabel).filter(Boolean).join(', ') || 'Ninguno')
            : questValueLabel(val);
          // "Empresa" + cuál: "Empresa — Grupo México".
          if (key === 'procedencia') {
            if (val === 'empresa') text = 'Empresa' + (parsed.empresa ? ' — ' + String(parsed.empresa).trim() : '');
            else if (val === 'ninguna') text = 'Ninguna (vino por su cuenta)';
          }
          if (!text) return;
          var item = document.createElement('div');
          item.className = 'cliente-quest-item';
          var label = document.createElement('span');
          label.textContent = QUEST_LABELS[key];
          var strong = document.createElement('strong');
          strong.textContent = text;
          item.appendChild(label);
          item.appendChild(strong);
          questWrap.appendChild(item);
        });
      }
    }

    clienteModalOverlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  /* ¿Compró? — de la cita abierta y de sus otras visitas (mismo celular
     o, si no hay celular, mismo nombre). */
  var COMPRO_MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  function comproInfo(id, status){
    var seg = CitaSeg.get(id);
    if (status !== 'asistio') {
      var st = { no_asistio: 'No asistió', cancelada: 'Cita cancelada', verificada: 'Todavía no asiste', pendiente: 'Todavía no asiste' };
      return { cls: 'is-na', text: st[status] || 'Todavía no asiste' };
    }
    if (esChequeo(id)) {
      return { cls: 'is-chequeo', text: 'Chequeo' + (seg && seg.compro && seg.meses ? ' · revisión en ' + (CitaSeg.MESES_LABEL[seg.meses] || '1 año') : '') };
    }
    if (!seg) return { cls: 'is-missing', text: 'Asistió · no se registró si compró' };
    return seg.compro
      ? { cls: 'is-yes', text: 'Sí compró · revisión en ' + (CitaSeg.MESES_LABEL[seg.meses] || '1 año') }
      : { cls: 'is-no', text: 'No compró' };
  }
  function comproFecha(iso){
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? (+m[3]) + ' ' + COMPRO_MESES[+m[2] - 1] + ' ' + m[1] : '—';
  }
  function renderClienteCompro(id, row){
    var box = document.getElementById('clienteDetalleCompro');
    var info = comproInfo(id, row.dataset.status);
    if (box) {
    box.innerHTML = '';
    var chip = document.createElement('span');
    chip.className = 'cliente-compro-chip ' + info.cls;
    chip.textContent = info.text;
    box.appendChild(chip);
    if (info.cls === 'is-missing' || info.cls === 'is-yes' || info.cls === 'is-no') {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cliente-compro-btn';
      btn.textContent = info.cls === 'is-missing' ? 'Registrar' : 'Cambiar';
      btn.onclick = function(){ closeClienteModal(); openAsistio(id); };
      box.appendChild(btn);
    }
    }
    // Otras visitas del mismo paciente.
    var cel = (row.dataset.celular || '').replace(/\D/g, '').slice(-10);
    var nom = (row.dataset.nombre || '').replace(/\s+/g, ' ').trim().toLowerCase();
    var otras = Array.prototype.filter.call(tbody.querySelectorAll('tr[data-id]'), function(r){
      if (r === row) return false;
      var c = (r.dataset.celular || '').replace(/\D/g, '').slice(-10);
      if (cel) return c === cel;
      return nom && (r.dataset.nombre || '').replace(/\s+/g, ' ').trim().toLowerCase() === nom;
    }).sort(function(a, b){ return (b.dataset.date + b.dataset.time).localeCompare(a.dataset.date + a.dataset.time); });
    var vRow = document.getElementById('clienteDetalleVisitasRow');
    var vBox = document.getElementById('clienteDetalleVisitas');
    if (!vRow || !vBox) return;
    vRow.hidden = !otras.length;
    vBox.innerHTML = '';
    otras.slice(0, 8).forEach(function(r){
      var i = window.CITAS_OPTICA ? comproInfo(r.dataset.id, r.dataset.status)
        : { cls: 'is-na', text: (CitaOrigen.label(r.dataset.status === 'verificada' ? 'verificada' : r.dataset.status) || '') };
      if (!window.CITAS_OPTICA && r.dataset.status === 'verificada') i.text = 'Por atender';
      var it = document.createElement('div');
      it.className = 'cliente-visita';
      var f = document.createElement('span');
      f.textContent = comproFecha(r.dataset.date);
      var c = document.createElement('em');
      c.className = 'cliente-compro-chip ' + i.cls;
      c.textContent = i.text;
      it.appendChild(f); it.appendChild(c);
      vBox.appendChild(it);
    });
    if (otras.length > 8) {
      var more = document.createElement('small');
      more.textContent = 'y ' + (otras.length - 8) + ' más';
      vBox.appendChild(more);
    }
  }
  function closeClienteModal(){
    if (!clienteModalOverlay) return;
    clienteModalOverlay.classList.remove('open');
    document.body.style.overflow = '';
  }
  if (clienteModalOverlay) {
    clienteModalClose && clienteModalClose.addEventListener('click', closeClienteModal);
    clienteModalOverlay.addEventListener('click', function(e){ if (e.target === clienteModalOverlay) closeClienteModal(); });
  }

  /* ---------- Modal: eliminar cita ---------- */
  var deleteOverlay = document.getElementById('deleteCitaModalOverlay');
  var deleteClose = document.getElementById('deleteCitaModalClose');
  var deleteCancel = document.getElementById('deleteCitaCancel');
  var deleteConfirmBtn = document.getElementById('deleteCitaConfirm');
  var deleteWhenEl = document.getElementById('deleteCitaWhen');
  var pendingDeleteId = null;

  function closeDeleteModal(){
    if (!deleteOverlay) return;
    deleteOverlay.classList.remove('open');
    document.body.style.overflow = '';
    pendingDeleteId = null;
  }
  if (deleteOverlay) {
    deleteClose && deleteClose.addEventListener('click', closeDeleteModal);
    deleteCancel && deleteCancel.addEventListener('click', closeDeleteModal);
    deleteOverlay.addEventListener('click', function(e){ if (e.target === deleteOverlay) closeDeleteModal(); });
    deleteConfirmBtn && deleteConfirmBtn.addEventListener('click', function(){
      if (!pendingDeleteId) return;
      deleteConfirmBtn.disabled = true;
      fetch('/api/citas/' + pendingDeleteId, { method: 'DELETE', credentials: 'same-origin' })
        .then(function(res){ if (res.ok) window.location.reload(); })
        .finally(function(){ deleteConfirmBtn.disabled = false; });
    });
  }

  function deleteCita(id){
    if (!deleteOverlay) return;
    var row = tbody.querySelector('tr[data-id="' + id + '"]');
    var when = row ? (row.querySelector('.cita-dia').textContent.trim() + ' · ' + row.dataset.time) : '';
    if (row && row.dataset.nombre) when = row.dataset.nombre.trim() + ' — ' + when;
    if (deleteWhenEl) deleteWhenEl.textContent = when;
    pendingDeleteId = id;
    deleteOverlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  tbody.addEventListener('click', function(e){
    var toggleBtn = e.target.closest('[data-action="toggle-menu"]');
    if (toggleBtn) {
      var menu = toggleBtn.closest('.row-menu');
      var willOpen = !menu.classList.contains('is-open');
      closeAllMenus(willOpen ? menu.dataset.menuId : null);
      menu.classList.remove('is-up');
      menu.classList.toggle('is-open', willOpen);
      toggleBtn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      // Si el menú se sale por abajo de la tabla, se abre hacia arriba.
      if (willOpen) {
        var dd = menu.querySelector('.row-menu-dropdown');
        var wrap = menu.closest('.admin-table-wrap');
        if (dd && wrap) {
          var limit = Math.min(wrap.getBoundingClientRect().bottom, window.innerHeight);
          if (dd.getBoundingClientRect().bottom > limit - 4 && menu.getBoundingClientRect().top - dd.offsetHeight > wrap.getBoundingClientRect().top) menu.classList.add('is-up');
        }
      }
      return;
    }

    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var id = btn.dataset.id;
    if (btn.dataset.action === 'cancel') askCancel(id);
    if (btn.dataset.action === 'asistio') openAsistio(id);
    if (btn.dataset.action === 'no_asistio') updateStatus(id, 'no_asistio');
    if (btn.dataset.action === 'delete') deleteCita(id);
    if (btn.dataset.action === 'cliente') openClienteModal(id);
    if (btn.dataset.action === 'editar' && window.CitasEditar) window.CitasEditar.open(id, 'editar');
    if (btn.dataset.action === 'reagendar' && window.CitasEditar) window.CitasEditar.open(id, 'reagendar');
    closeAllMenus();
  });

  document.addEventListener('click', function(e){
    if (!e.target.closest('.row-menu')) closeAllMenus();
  });

  renderStats();
  renderView();

  /* ---------- etiquetas (cómo llegó la cita) ---------- */
  function applyRowTag(row){
    var tag = CitaTags.get(row.dataset.id);
    row.dataset.tag = tag;
    var cell = row.querySelector('td .admin-badge');
    if (!cell) return;
    var old = cell.parentNode.querySelector('.cita-tag-ico');
    if (old) old.remove();
    if (tag) cell.insertAdjacentHTML('afterend', CitaTags.icon(tag, 'in-table'));
  }
  CitaTags.load().then(function(){
    allRows.forEach(applyRowTag);
    document.dispatchEvent(new CustomEvent('citatags:change'));
    applyPendingTag();
  });
  // Seguimiento (¿compró?): con esto se calculan las "Revisiones".
  CitaSeg.load().then(function(){
    document.dispatchEvent(new CustomEvent('citatags:change'));
  });

  // Etiqueta de una cita recién creada cuyo id no venía en la respuesta.
  function applyPendingTag(){
    var pend = null;
    try { pend = JSON.parse(sessionStorage.getItem('attomosPendingTag') || 'null'); sessionStorage.removeItem('attomosPendingTag'); } catch (e) {}
    if (!pend || Date.now() - pend.at > 120000) return;
    var digits = function(s){ return String(s || '').replace(/\D/g, '').slice(-10); };
    var match = allRows.filter(function(r){
      return r.dataset.date === pend.date && (r.dataset.time || '').slice(0, 5) === pend.time && digits(r.dataset.celular) === digits(pend.celular);
    }).sort(function(a, b){ return Number(b.dataset.id) - Number(a.dataset.id); })[0];
    if (!match) return;
    CitaTags.set(match.dataset.id, pend.tag).then(function(){
      applyRowTag(match);
      document.dispatchEvent(new CustomEvent('citatags:change'));
    }).catch(function(){});
  }

  /* =======================================================
     VISTA DE CALENDARIO (mes, tipo Google Calendar)
     Reutiliza las mismas filas del DOM (allRows) como fuente
     de datos — no pide nada nuevo al servidor.
     ======================================================= */
  var MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

  function eventsFromRows(){
    return allRows.map(function(row){
      return {
        id: row.dataset.id,
        status: row.dataset.status,
        disp: CitaOrigen.ofRow(row),
        date: row.dataset.date,   // "YYYY-MM-DD"
        time: row.dataset.time || '',
        nombre: row.dataset.nombre ? row.dataset.nombre.trim() : '',
        tag: row.dataset.tag || ''
      };
    }).filter(function(ev){ return !!ev.date; });
  }

  var calGrid = document.getElementById('calGrid');
  var calMonthLabel = document.getElementById('calMonthLabel');
  if (calGrid) {
    var today = new Date();
    var viewYear = today.getFullYear();
    var viewMonth = today.getMonth(); // 0-11

    function pad(n){ return String(n).padStart(2, '0'); }
    function isoDate(y, m, d){ return y + '-' + pad(m + 1) + '-' + pad(d); }
    function todayISO(){ var t = new Date(); return isoDate(t.getFullYear(), t.getMonth(), t.getDate()); }

    var byDate = {};

    function renderCalendar(){
      if (remindOn) return renderRemindCalendar();
      var events = eventsFromRows();
      byDate = {};
      events.forEach(function(ev){
        (byDate[ev.date] = byDate[ev.date] || []).push(ev);
      });
      Object.keys(byDate).forEach(function(d){
        byDate[d].sort(function(a, b){ return (a.time || '').localeCompare(b.time || ''); });
      });

      calMonthLabel.textContent = MESES[viewMonth] + ' ' + viewYear;

      var firstOfMonth = new Date(viewYear, viewMonth, 1);
      // Lunes = 0 ... Domingo = 6
      var startOffset = (firstOfMonth.getDay() + 6) % 7;
      var daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
      var daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();
      var totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;
      var todayStr = todayISO();

      var html = '';
      for (var i = 0; i < totalCells; i++) {
        var dayNum, cellYear = viewYear, cellMonth = viewMonth, outside = false;
        if (i < startOffset) {
          dayNum = daysInPrevMonth - (startOffset - 1 - i);
          cellMonth = viewMonth - 1; outside = true;
        } else if (i >= startOffset + daysInMonth) {
          dayNum = i - (startOffset + daysInMonth) + 1;
          cellMonth = viewMonth + 1; outside = true;
        } else {
          dayNum = i - startOffset + 1;
        }
        if (cellMonth < 0) { cellMonth = 11; cellYear -= 1; }
        if (cellMonth > 11) { cellMonth = 0; cellYear += 1; }
        var cellISO = isoDate(cellYear, cellMonth, dayNum);
        var dayEvents = byDate[cellISO] || [];
        var isToday = cellISO === todayStr;

        var closedDay = (window.CitasOpenDays || [1, 2, 3, 4, 5, 6]).indexOf(new Date(cellYear, cellMonth, dayNum).getDay()) === -1;
        html += '<div class="cal-day' + (outside ? ' is-outside' : '') + (isToday ? ' is-today' : '') + (closedDay ? ' is-closed' : '') + '" data-date="' + cellISO + '"' + (closedDay ? ' title="Cerrado: ese día no se dan citas"' : '') + '>';
        html += '<span class="cal-day-num">' + dayNum + '</span>';
        html += '<div class="cal-day-events">';
        var shown = dayEvents.slice(0, 3);
        shown.forEach(function(ev){
          html += '<button type="button" class="cal-event-chip" data-event-id="' + ev.id + '">' +
                  '<i class="cal-dot ' + (ev.disp || ev.status) + '"></i><span class="chip-label">' + (ev.time || '') + '</span>' + (ev.tag ? CitaTags.icon(ev.tag, 'in-chip') : '') + '</button>';
        });
        if (dayEvents.length > 3) {
          html += '<button type="button" class="cal-day-more" data-more-date="' + cellISO + '">+' + (dayEvents.length - 3) + ' más</button>';
        }
        html += '</div></div>';
      }
      calGrid.innerHTML = html;
    }

    document.getElementById('calPrev').addEventListener('click', function(){
      viewMonth -= 1;
      if (viewMonth < 0) { viewMonth = 11; viewYear -= 1; }
      renderCalendar();
    });
    document.getElementById('calNext').addEventListener('click', function(){
      viewMonth += 1;
      if (viewMonth > 11) { viewMonth = 0; viewYear += 1; }
      renderCalendar();
    });
    document.getElementById('calTodayBtn').addEventListener('click', function(){
      var t = new Date();
      viewYear = t.getFullYear(); viewMonth = t.getMonth();
      renderCalendar();
    });

    /* =======================================================
       REVISIÓN ANUAL
       Con el toggle prendido, el calendario deja de mostrar las
       citas y muestra a quién le toca volver: un año después de su
       última cita (asistió o verificada). No sale quien ya tiene
       otra cita agendada de hoy en adelante.
       Todo sale de las mismas filas de la tabla — no pide nada
       nuevo al servidor.
       ======================================================= */
    var REMIND_MONTHS = 12;
    var REMIND_VISIT = { asistio: true, verificada: true };
    var remindToggle = document.getElementById('calRemindToggle');
    var remindCountEl = document.getElementById('calRemindCount');
    var remindBar = document.getElementById('calRemindBar');
    var calView = document.getElementById('citasCalendarView');
    var remindOn = false;
    var reminders = [];      // [{ key, due, last, ... }]
    var remindByKey = {};

    try { remindOn = !!remindToggle && localStorage.getItem('attomosCalRemind') === '1'; } catch (e) {}
    if (remindToggle) remindToggle.checked = remindOn;

    function digitsOf(s){ return String(s || '').replace(/\D/g, ''); }
    function personKey(row){
      var tel = digitsOf(row.dataset.celular).slice(-10);
      if (tel.length === 10) return 'tel:' + tel;
      var mail = (row.dataset.correo || '').trim().toLowerCase();
      if (mail) return 'mail:' + mail;
      var name = (row.dataset.nombre || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
      return name ? 'name:' + name : '';
    }
    // Suma meses a una fecha "YYYY-MM-DD" (29 feb → 28 feb si el año no es bisiesto).
    function addMonthsISO(iso, months){
      var p = iso.split('-').map(Number);
      var y = p[0], m = p[1] - 1 + months, d = p[2];
      y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
      var last = new Date(y, m + 1, 0).getDate();
      return isoDate(y, m, Math.min(d, last));
    }
    function daysBetween(aISO, bISO){
      var a = aISO.split('-').map(Number), b = bISO.split('-').map(Number);
      return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000);
    }
    function fechaLarga(iso){
      var p = iso.split('-').map(Number);
      return p[2] + ' de ' + MESES[p[1] - 1] + ' de ' + p[0];
    }

    function computeReminders(){
      var todayStr = todayISO();
      var people = {};
      allRows.forEach(function(row){
        var date = row.dataset.date;
        var key = personKey(row);
        if (!date || !key) return;
        var st = row.dataset.status;
        var pr = people[key] = people[key] || { key: key, visits: 0, last: null, upcoming: false };
        // Ya tiene otra cita de hoy en adelante → no hay que recordarle.
        if (date >= todayStr && st !== 'cancelada' && st !== 'no_asistio') pr.upcoming = true;
        if (date < todayStr && REMIND_VISIT[st]) {
          pr.visits += 1;
          if (!pr.last || date > pr.last.dataset.date ||
              (date === pr.last.dataset.date && (row.dataset.time || '') > (pr.last.dataset.time || ''))) pr.last = row;
        }
      });
      reminders = [];
      remindByKey = {};
      Object.keys(people).forEach(function(k){
        var pr = people[k];
        if (!pr.last || pr.upcoming) return;
        var row = pr.last;
        // Lo que se registró al marcar "Asistió": si no compró, no se le
        // recuerda; si compró, a los meses que se eligieron (3, 6 o 12).
        // Citas sin ese dato (las de antes): 1 año, como siempre.
        var seg = CitaSeg.get(row.dataset.id);
        if (seg && !seg.compro) return;
        var meses = seg && seg.meses ? Number(seg.meses) : REMIND_MONTHS;
        var due = addMonthsISO(row.dataset.date, meses);
        var tds = row.querySelectorAll('td');
        var r = {
          key: k,
          due: due,
          last: row.dataset.date,
          lastId: row.dataset.id,
          meses: meses,
          visits: pr.visits,
          overdue: due < todayStr,
          nombre: (row.dataset.nombre || '').trim(),
          first: row.dataset.nombreSolo != null ? row.dataset.nombreSolo : (tds[1] ? tds[1].textContent.trim() : ''),
          apellido: row.dataset.apellido != null ? row.dataset.apellido : (tds[2] ? tds[2].textContent.trim() : ''),
          celular: row.dataset.celular || '',
          correo: row.dataset.correo || '',
          nacimiento: row.dataset.fechaNacimiento || ''
        };
        reminders.push(r);
        remindByKey[k] = r;
      });
      reminders.sort(function(a, b){ return a.due.localeCompare(b.due) || a.nombre.localeCompare(b.nombre); });
    }

    function remindMatches(r){
      var term = searchTerm.toLowerCase().trim();
      if (!term) return true;
      return citaTextMatch(r.nombre + ' ' + r.celular + ' ' + r.correo, term);
    }

    function renderRemindCalendar(){
      computeReminders();
      byDate = {};
      reminders.filter(remindMatches).forEach(function(r){ (byDate[r.due] = byDate[r.due] || []).push(r); });
      calMonthLabel.textContent = MESES[viewMonth] + ' ' + viewYear;

      var firstOfMonth = new Date(viewYear, viewMonth, 1);
      var startOffset = (firstOfMonth.getDay() + 6) % 7;
      var daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
      var daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();
      var totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;
      var todayStr = todayISO();
      var monthPrefix = viewYear + '-' + pad(viewMonth + 1) + '-';
      var inMonth = 0, overdueInMonth = 0;

      var html = '';
      for (var i = 0; i < totalCells; i++) {
        var dayNum, cellYear = viewYear, cellMonth = viewMonth, outside = false;
        if (i < startOffset) { dayNum = daysInPrevMonth - (startOffset - 1 - i); cellMonth = viewMonth - 1; outside = true; }
        else if (i >= startOffset + daysInMonth) { dayNum = i - (startOffset + daysInMonth) + 1; cellMonth = viewMonth + 1; outside = true; }
        else { dayNum = i - startOffset + 1; }
        if (cellMonth < 0) { cellMonth = 11; cellYear -= 1; }
        if (cellMonth > 11) { cellMonth = 0; cellYear += 1; }
        var cellISO = isoDate(cellYear, cellMonth, dayNum);
        var list = byDate[cellISO] || [];
        if (!outside) {
          inMonth += list.length;
          overdueInMonth += list.filter(function(r){ return r.overdue; }).length;
        }

        html += '<div class="cal-day is-remind' + (outside ? ' is-outside' : '') + (cellISO === todayStr ? ' is-today' : '') +
                (list.length ? ' has-remind' : '') + '" data-date="' + cellISO + '">';
        html += '<span class="cal-day-num">' + dayNum + '</span>';
        html += '<div class="cal-day-events">';
        list.slice(0, 3).forEach(function(r){
          var cls = r.overdue ? 'remind-overdue' : 'remind';
          html += '<button type="button" class="cal-event-chip cal-remind-chip ' + cls + '" data-remind-key="' + escAttr(r.key) + '" title="' + escAttr(r.nombre) + '">' +
                  '<i class="cal-dot ' + cls + '"></i><span class="chip-label">' + escHtml(r.first || r.nombre) + '</span></button>';
        });
        if (list.length > 3) {
          html += '<button type="button" class="cal-day-more" data-more-date="' + cellISO + '">+' + (list.length - 3) + ' más</button>';
        }
        html += '</div></div>';
      }
      calGrid.innerHTML = html;

      // Resumen del mes
      if (remindBar) {
        var mes = MESES[viewMonth];
        var txt = inMonth === 0
          ? 'Nadie tiene su revisión en ' + mes + '.'
          : (inMonth === 1 ? '1 persona tiene' : inMonth + ' personas tienen') + ' su revisión en ' + mes +
            (overdueInMonth ? ' · ' + (overdueInMonth === 1 ? '1 ya pasó su fecha y no ha agendado' : overdueInMonth + ' ya pasaron su fecha y no han agendado') : '') + '.';
        remindBar.textContent = txt;
      }
      updateRemindCount();
    }

    // Número en el toggle: a cuántos les toca este mes (de hoy a fin de mes) + atrasados del mes.
    function updateRemindCount(){
      if (!remindCountEl) return;
      if (!reminders.length && !remindOn) computeReminders();
      var t = new Date();
      var prefix = t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-';
      var n = reminders.filter(function(r){ return r.due.indexOf(prefix) === 0; }).length;
      remindCountEl.textContent = n;
      remindCountEl.hidden = n === 0;
      remindCountEl.title = n === 1 ? '1 persona tiene su revisión este mes' : n + ' personas tienen su revisión este mes';
    }

    function escHtml(s){ return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
    function escAttr(s){ return escHtml(s).replace(/"/g, '&quot;'); }

    function setRemindMode(on){
      remindOn = !!on;
      try { localStorage.setItem('attomosCalRemind', remindOn ? '1' : '0'); } catch (e) {}
      if (calView) calView.classList.toggle('is-remind-mode', remindOn);
      if (remindBar) remindBar.hidden = !remindOn;
      document.querySelectorAll('.cal-legend').forEach(function(l){
        l.hidden = l.classList.contains('cal-legend--remind') ? !remindOn : remindOn;
      });
      calGrid.classList.remove('cal-mode-swap'); void calGrid.offsetWidth; calGrid.classList.add('cal-mode-swap');
      renderCalendar();
    }
    if (remindToggle) remindToggle.addEventListener('change', function(){ setRemindMode(remindToggle.checked); });
    if (searchInput) searchInput.addEventListener('input', function(){ if (remindOn && calView && !calView.hidden) renderCalendar(); });

    /* ---------- modal de la persona ---------- */
    var remindModal = document.getElementById('remindModalOverlay');
    var remindCurrent = null;
    function openRemindModal(key){
      var r = remindByKey[key];
      if (!r || !remindModal) return;
      remindCurrent = r;
      var todayStr = todayISO();
      var diff = daysBetween(todayStr, r.due);
      var initials = r.nombre.split(/\s+/).filter(Boolean).slice(0, 2).map(function(w){ return w[0]; }).join('').toUpperCase();
      document.getElementById('remindAvatar').textContent = initials || '?';
      document.getElementById('remindName').textContent = r.nombre || 'Sin nombre';
      document.getElementById('remindVisits').textContent = r.visits === 1 ? '1 cita anterior' : r.visits + ' citas anteriores';
      var badge = document.getElementById('remindBadge');
      badge.className = 'remind-when-badge' + (diff < 0 ? ' is-overdue' : (diff === 0 ? ' is-today' : ''));
      badge.textContent = diff === 0 ? 'Le toca hoy'
        : diff === 1 ? 'Le toca mañana'
        : diff > 1 ? 'Le toca en ' + diff + ' días'
        : diff === -1 ? 'Le tocaba ayer' : 'Le tocaba hace ' + (-diff) + ' días';
      document.getElementById('remindDue').textContent = fechaLarga(r.due);
      document.getElementById('remindLast').textContent = fechaLarga(r.last) + ' · Cita #' + r.lastId +
        ' · revisión a ' + (CitaSeg.MESES_LABEL[r.meses] || '1 año');
      document.getElementById('remindPhone').textContent = r.celular || '—';
      document.getElementById('remindMail').textContent = r.correo || '—';
      document.getElementById('remindMailRow').hidden = !r.correo;
      var call = document.getElementById('remindCall');
      var tel = digitsOf(r.celular);
      call.hidden = !tel;
      call.href = tel ? 'tel:+' + (tel.length === 10 ? '52' + tel : tel) : '#';
      remindModal.classList.add('open');
      document.body.style.overflow = 'hidden';
    }
    function closeRemindModal(){
      if (!remindModal) return;
      remindModal.classList.remove('open');
      document.body.style.overflow = '';
    }
    if (remindModal) {
      document.getElementById('remindModalClose').addEventListener('click', closeRemindModal);
      document.getElementById('remindCliente').addEventListener('click', function(){
        if (!remindCurrent) return;
        closeRemindModal();
        openClienteModal(remindCurrent.lastId);
      });
      document.getElementById('remindAgendar').addEventListener('click', function(){
        if (!remindCurrent) return;
        var r = remindCurrent;
        closeRemindModal();
        if (window.CitasCrear) window.CitasCrear.open({
          nombre: r.first, apellido: r.apellido, celular: r.celular, correo: r.correo,
          nacimiento: r.nacimiento, fecha: r.due >= todayISO() ? r.due : ''
        });
      });
      document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && remindModal.classList.contains('open')) closeRemindModal(); });
    }

    // Lista del día (cuando hay más de 3 en un día o se toca el día)
    function openRemindDayModal(cellISO){
      var list = (byDate[cellISO] || []);
      var parts = cellISO.split('-').map(Number);
      dayModalTitle.textContent = 'Revisiones · ' + parts[2] + ' de ' + MESES[parts[1] - 1];
      dayList.innerHTML = list.length ? list.map(function(r){
        var cls = r.overdue ? 'remind-overdue' : 'remind';
        return '<button type="button" class="day-events-item" data-remind-key="' + escAttr(r.key) + '">' +
               '<i class="cal-dot ' + cls + '"></i>' +
               '<span class="day-events-time">' + escHtml(r.nombre || 'Sin nombre') + '</span>' +
               '<span class="day-events-name">Última cita: ' + fechaLarga(r.last) + '</span>' +
               '</button>';
      }).join('') : '<p class="day-view-empty">Nadie tiene su revisión este día.</p>';
      dayModal.classList.add('open');
      document.body.style.overflow = 'hidden';
    }

    /* ---------- modal de detalle al hacer click en un evento ---------- */
    var eventModal = document.getElementById('calEventModalOverlay');
    var eventModalClose = document.getElementById('calEventModalClose');
    function openEventModal(id){
      var row = tbody.querySelector('tr[data-id="' + id + '"]');
      if (!row) return;
      var dia = row.querySelector('.cita-dia') ? row.querySelector('.cita-dia').textContent : '';
      var hora = row.dataset.time || '';
      var status = row.dataset.status;
      var nombre = row.dataset.nombre ? row.dataset.nombre.trim() : '';

      document.getElementById('calEventId').textContent = '#' + id;
      document.getElementById('calEventWhen').textContent = (nombre ? nombre + ' — ' : '') + dia + ' — ' + hora;
      // Renglones ordenados: paciente (con su estado a la derecha), día, hora y celular.
      var nomLimpio = nombre.replace(/\s+/g, ' ');
      document.getElementById('calEventNombre').textContent = nomLimpio || 'Sin nombre';
      document.getElementById('calEventAvatar').textContent = (nomLimpio.split(' ').filter(Boolean).slice(0, 2).map(function(w){ return w.charAt(0); }).join('') || '?').toUpperCase();
      var dParts = (row.dataset.date || '').split('-').map(Number);
      var DSEM = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
      document.getElementById('calEventDia').textContent = dParts.length === 3
        ? DSEM[new Date(dParts[0], dParts[1] - 1, dParts[2]).getDay()] + ' ' + dParts[2] + ' de ' + MESES[dParts[1] - 1] + ' de ' + dParts[0]
        : (dia || '—');
      var hm = /^(\d{1,2}):(\d{2})/.exec(hora);
      document.getElementById('calEventHora').textContent = hm ? (((+hm[1] % 12) || 12) + ':' + hm[2] + (+hm[1] < 12 ? ' a.m.' : ' p.m.')) : (hora || '—');
      var tel = (row.dataset.celular || '').trim();
      document.getElementById('calEventTel').textContent = tel || '—';
      document.getElementById('calEventTelRow').hidden = !tel;
      [['calEventServ', 'servicio'], ['calEventWorker', 'trabajador'], ['calEventNotes', 'notas']].forEach(function(p){
        var v = (row.dataset[p[1]] || '').trim();
        var el = document.getElementById(p[0]);
        if (!el) return;
        el.textContent = v || '—';
        el.parentNode.parentNode.hidden = !v;
      });
      var statusEl = document.getElementById('calEventStatus');
      var stKey = CitaOrigen.ofRow(row);
      statusEl.textContent = CitaOrigen.label(stKey);
      statusEl.className = CitaOrigen.badgeClass(stKey);
      statusEl.title = CitaOrigen.title(stKey);
      CitaOrigen.paintOrigin(statusEl, row);

      var reasonEl = document.getElementById('calEventReason');
      var reason = row.dataset.cancelReason ? row.dataset.cancelReason.trim() : '';
      if (reasonEl) {
        reasonEl.textContent = '';
        if (status === 'cancelada' && reason) {
          var reasonLabel = document.createElement('strong');
          reasonLabel.textContent = 'Motivo de cancelación: ';
          reasonEl.appendChild(reasonLabel);
          reasonEl.appendChild(document.createTextNode(reason));
          reasonEl.hidden = false;
        } else {
          reasonEl.hidden = true;
        }
      }

      renderEventTags(id);

      document.getElementById('calEventCancel').onclick = function(){ closeEventModal(); askCancel(id); };
      document.getElementById('calEventAsistio').onclick = function(){ closeEventModal(); openAsistio(id); };
      var segBox = document.getElementById('calEventSeg');
      if (segBox) {
        var seg = CitaSeg.get(id);
        segBox.hidden = !window.CITAS_OPTICA || status !== 'asistio' || esChequeo(id);
        segBox.classList.toggle('is-missing', !seg);
        var chequeo = esChequeo(id);
        document.getElementById('calEventSegText').textContent = chequeo
          ? (seg && seg.compro ? 'Chequeo · revisión en ' + (CitaSeg.MESES_LABEL[seg.meses] || '1 año') : 'Chequeo · todavía no se eligió su próxima revisión.')
          : (seg ? CitaSeg.label(seg) : '¿Compró algo? Todavía no se registró.');
        document.getElementById('calEventSegBtn').textContent = seg ? 'Cambiar' : 'Registrar';
        document.getElementById('calEventSegBtn').onclick = function(){ closeEventModal(); openAsistio(id); };
      }
      var asistioLbl = document.getElementById('calEventAsistio');
      asistioLbl.lastChild.textContent = status === 'asistio' ? ' Cambiar si compró ' : ' Marcar asistió ';
      // Chequeo que ya asistió: no hay nada que cambiar (no lleva revisión).
      asistioLbl.hidden = status === 'asistio' && (esChequeo(id) || !window.CITAS_OPTICA);
      document.getElementById('calEventNoAsistio').onclick = function(){ updateStatus(id, 'no_asistio'); };
      document.getElementById('calEventCliente').onclick = function(){ closeEventModal(); openClienteModal(id); };
      document.getElementById('calEventEditar').onclick = function(){ closeEventModal(); window.CitasEditar && window.CitasEditar.open(id, 'editar'); };
      document.getElementById('calEventReagendar').onclick = function(){ closeEventModal(); window.CitasEditar && window.CitasEditar.open(id, 'reagendar'); };
      document.getElementById('calEventDelete').onclick = function(){ closeEventModal(); deleteCita(id); };

      eventModal.classList.add('open');
      document.body.style.overflow = 'hidden';
    }
    var eventTagsEl = document.getElementById('calEventTags');
    function renderEventTags(id){
      if (!eventTagsEl) return;
      eventTagsEl.dataset.id = id;
      eventTagsEl.innerHTML = CitaTags.options(CitaTags.get(id));
    }
    eventTagsEl && eventTagsEl.addEventListener('click', function(e){
      var b = e.target.closest('.cita-tag-opt');
      if (!b || eventTagsEl.classList.contains('is-saving')) return;
      var id = eventTagsEl.dataset.id;
      var next = b.classList.contains('is-on') ? '' : b.dataset.tag;
      var prev = CitaTags.get(id);
      eventTagsEl.classList.add('is-saving');
      eventTagsEl.innerHTML = CitaTags.options(next); // se ve al instante
      CitaTags.set(id, next).then(function(){
        eventTagsEl.innerHTML = CitaTags.options(CitaTags.get(id));
        var row = tbody.querySelector('tr[data-id="' + id + '"]');
        if (row) applyRowTag(row);
        document.dispatchEvent(new CustomEvent('citatags:change'));
      }).catch(function(err){
        eventTagsEl.innerHTML = CitaTags.options(prev);
        alert(err.message);
      }).finally(function(){ eventTagsEl.classList.remove('is-saving'); });
    });

    function closeEventModal(){
      eventModal.classList.remove('open');
      document.body.style.overflow = '';
    }
    eventModalClose && eventModalClose.addEventListener('click', closeEventModal);
    eventModal && eventModal.addEventListener('click', function(e){ if (e.target === eventModal) closeEventModal(); });

    var dayModal = document.getElementById('dayEventsModalOverlay');
    var dayModalClose = document.getElementById('dayEventsModalClose');
    var dayModalTitle = document.getElementById('dayEventsModalTitle');
    var dayList = document.getElementById('dayEventsList');

    function openDayModal(cellISO){
      var dayEvents = byDate[cellISO] || [];
      var parts = cellISO.split('-').map(Number);
      dayModalTitle.textContent = parts[2] + ' de ' + MESES[parts[1] - 1] + ' de ' + parts[0];
      dayList.innerHTML = dayEvents.map(function(ev){
        return '<button type="button" class="day-events-item" data-event-id="' + ev.id + '">' +
               '<i class="cal-dot ' + (ev.disp || ev.status) + '"></i>' +
               '<span class="day-events-time">' + (ev.time || '') + '</span>' +
               '<span class="day-events-name">' + (ev.nombre || '') + '</span>' +
               (ev.tag ? CitaTags.icon(ev.tag) : '') +
               '</button>';
      }).join('');
      dayModal.classList.add('open');
      document.body.style.overflow = 'hidden';
    }
    function closeDayModal(){
      dayModal.classList.remove('open');
      document.body.style.overflow = '';
    }
    dayModalClose && dayModalClose.addEventListener('click', closeDayModal);
    dayModal && dayModal.addEventListener('click', function(e){ if (e.target === dayModal) closeDayModal(); });
    dayList && dayList.addEventListener('click', function(e){
      var rem = e.target.closest('[data-remind-key]');
      if (rem) { closeDayModal(); openRemindModal(rem.dataset.remindKey); return; }
      var item = e.target.closest('[data-event-id]');
      if (!item) return;
      closeDayModal();
      openEventModal(item.dataset.eventId);
    });

    /* =======================================================
       VISTA DE DÍA
       Solo las citas del día elegido (hoy por defecto), en orden
       de hora. Flechas para moverse día por día, "Hoy" para
       regresar, y respeta el buscador. Clic en una cita abre el
       mismo modal de detalle que el calendario. También se llega
       aquí dando clic en un día del calendario del mes.
       ======================================================= */
    var DIAS = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
    var STATUS_LABELS = CitaOrigen.LABELS;
    var dvView = document.getElementById('citasDayView');
    var dvLabel = document.getElementById('dayViewLabel');
    var dvToday = document.getElementById('dayViewTodayTag');
    var dvCount = document.getElementById('dayViewCount');
    var dvSummary = document.getElementById('dayViewSummary');
    var dvList = document.getElementById('dayViewList');
    // Al guardar/editar/cambiar estado la página se recarga; sin esto la vista
    // de Día siempre volvía a "hoy". Se recuerda el día que se estaba viendo
    // (solo en esta pestaña y por 30 min, para que al otro día abra en hoy).
    var DV_KEY = 'attomosDayViewDate';
    function loadDvDate(){
      try {
        var s = JSON.parse(sessionStorage.getItem(DV_KEY) || 'null');
        if (s && /^\d{4}-\d{2}-\d{2}$/.test(s.d) && Date.now() - s.at < 30 * 60 * 1000) return s.d;
      } catch (e) {}
      return todayISO();
    }
    function saveDvDate(){
      try { sessionStorage.setItem(DV_KEY, JSON.stringify({ d: dvDate, at: Date.now() })); } catch (e) {}
    }
    var dvDate = loadDvDate();

    function shiftISO(iso, delta){
      var p = iso.split('-').map(Number);
      var d = new Date(p[0], p[1] - 1, p[2] + delta);
      return isoDate(d.getFullYear(), d.getMonth(), d.getDate());
    }
    function nowHHMM(){ var t = new Date(); return pad(t.getHours()) + ':' + pad(t.getMinutes()); }

    // Deslizamiento al cambiar de día: el contenido nuevo entra del
    // lado hacia el que se avanzó (derecha = siguiente, izquierda = anterior).
    function animateDaySwap(dir){
      if (!dir) return;
      var cls = dir > 0 ? 'day-swap-next' : 'day-swap-prev';
      [dvLabel, dvSummary, dvList].forEach(function(el){
        if (!el) return;
        el.classList.remove('day-swap-next', 'day-swap-prev');
        void el.offsetWidth; // reinicia la animación si se pica rápido
        el.classList.add(cls);
      });
    }

    // dir: 1 = día siguiente, -1 = día anterior (para la animación).
    function renderDay(dir){
      if (!dvView) return;
      saveDvDate();
      animateDaySwap(dir);
      var term = searchTerm.toLowerCase().trim();
      // Con algo en el buscador, se busca en TODO el mes (no solo en este día).
      if (term){ renderDaySearch(term); return; }
      dvView.classList.remove('is-searching');
      var rows = allRows.filter(function(r){ return r.dataset.date === dvDate; })
        .sort(function(a, b){ return (a.dataset.time || '').localeCompare(b.dataset.time || ''); });

      var p = dvDate.split('-').map(Number);
      var d = new Date(p[0], p[1] - 1, p[2]);
      var todayStr = todayISO();
      var label = DIAS[d.getDay()] + ' ' + d.getDate() + ' de ' + MESES[d.getMonth()];
      if (d.getFullYear() !== new Date().getFullYear()) label += ' de ' + d.getFullYear();
      dvLabel.textContent = label;
      dvToday.hidden = dvDate !== todayStr;
      dvCount.textContent = rows.length === 1 ? '1 cita' : rows.length + ' citas';

      // Resumen por estado
      dvSummary.innerHTML = '';
      var counts = {};
      // Primero quién hizo la cita (todas las del día), luego el estado.
      var origCounts = {};
      rows.forEach(function(r){ var o = CitaOrigen.originKey(r); origCounts[o] = (origCounts[o] || 0) + 1; });
      ['verificada', 'recepcion'].forEach(function(o){
        if (!origCounts[o]) return;
        var chip = document.createElement('span');
        chip.className = 'day-view-chip';
        chip.title = CitaOrigen.title(o);
        var dot = document.createElement('i');
        dot.className = 'cal-dot ' + o;
        chip.appendChild(dot);
        chip.appendChild(document.createTextNode(origCounts[o] + ' ' + STATUS_LABELS[o].toLowerCase()));
        dvSummary.appendChild(chip);
      });
      rows.forEach(function(r){ var k = r.dataset.status; counts[k] = (counts[k] || 0) + 1; });
      Object.keys(STATUS_LABELS).forEach(function(st){
        if (st === 'verificada' || st === 'recepcion' || st === 'pendiente') return;
        if (!counts[st]) return;
        var chip = document.createElement('span');
        chip.className = 'day-view-chip';
        chip.title = CitaOrigen.title(st);
        var dot = document.createElement('i');
        dot.className = 'cal-dot ' + st;
        chip.appendChild(dot);
        chip.appendChild(document.createTextNode(counts[st] + ' ' + STATUS_LABELS[st].toLowerCase()));
        dvSummary.appendChild(chip);
      });
      var tagCounts = {};
      rows.forEach(function(r){ if (r.dataset.tag) tagCounts[r.dataset.tag] = (tagCounts[r.dataset.tag] || 0) + 1; });
      CitaTags.ALL.forEach(function(k){
        if (!tagCounts[k]) return;
        var chip = document.createElement('span');
        chip.className = 'day-view-chip is-tag';
        chip.innerHTML = CitaTags.icon(k) + tagCounts[k] + ' ' + CitaTags.TAGS[k].short.toLowerCase();
        dvSummary.appendChild(chip);
      });

      dvList.innerHTML = '';
      if (!rows.length) {
        var empty = document.createElement('div');
        empty.className = 'day-view-empty';
        empty.textContent = term ? 'Ninguna cita de este día coincide con tu búsqueda.' : 'No hay citas para este día.';
        dvList.appendChild(empty);
        return;
      }

      // Hoy: las que ya pasaron se ven tenues y se marca la siguiente.
      var isToday = dvDate === todayStr;
      var isPastDay = dvDate < todayStr;
      var now = nowHHMM();
      var nextMarked = false;

      rows.forEach(function(row){
        var st = row.dataset.status;
        var time = row.dataset.time || '';
        var past = isPastDay || (isToday && time < now);
        var item = document.createElement('button');
        item.type = 'button';
        item.className = 'day-item status-' + st + (past ? ' is-past' : '');
        item.dataset.eventId = row.dataset.id;

        var timeEl = document.createElement('span');
        timeEl.className = 'day-item-time';
        timeEl.textContent = time;

        var bar = document.createElement('span');
        bar.className = 'day-item-bar';

        var info = document.createElement('span');
        info.className = 'day-item-info';
        var name = document.createElement('strong');
        name.textContent = (row.dataset.nombre || '').trim() || 'Sin nombre';
        var sub = document.createElement('small');
        var bits = [];
        if (row.dataset.servicio) bits.push(row.dataset.servicio + (row.dataset.trabajador ? ' con ' + row.dataset.trabajador : ''));
        if (row.dataset.celular) bits.push(row.dataset.celular);
        if (row.dataset.correo) bits.push(row.dataset.correo);
        sub.textContent = bits.join(' · ');
        info.appendChild(name);
        if (bits.length) info.appendChild(sub);

        var right = document.createElement('span');
        right.className = 'day-item-right';
        if (isToday && !past && !nextMarked && st !== 'cancelada') {
          nextMarked = true;
          var next = document.createElement('span');
          next.className = 'day-item-next';
          next.textContent = 'Siguiente';
          right.appendChild(next);
        }
        if (row.dataset.tag) right.insertAdjacentHTML('beforeend', CitaTags.pill(row.dataset.tag));
        right.insertAdjacentHTML('beforeend', CitaOrigen.originHTML(row));
        var badge = document.createElement('span');
        badge.className = CitaOrigen.badgeClass(CitaOrigen.ofRow(row));
        badge.textContent = CitaOrigen.label(CitaOrigen.ofRow(row));
        badge.title = CitaOrigen.title(CitaOrigen.ofRow(row));
        right.appendChild(badge);

        item.appendChild(timeEl);
        item.appendChild(bar);
        item.appendChild(info);
        item.appendChild(right);
        dvList.appendChild(item);
      });
    }

    /* ---------- Buscar desde la vista Día: todo el mes ----------
       Recepción suele buscar al cliente estando en "Día"; antes solo se
       buscaba en ese día y no salía. Ahora se busca en el mes del día que
       se está viendo (agrupado por día). Si ese mes no hay, se busca en
       las demás fechas (las más cercanas primero). */
    function searchMatch(r, term){
      if (citaTextMatch(r.textContent + ' ' + (r.dataset.celular || '') + ' ' + (r.dataset.correo || ''), term)) return true;
      var dg = term.replace(/\D/g, '');
      return dg.length >= 4 && (r.dataset.celular || '').replace(/\D/g, '').indexOf(dg) !== -1;
    }
    function renderDaySearch(term){
      dvView.classList.add('is-searching');
      var month = dvDate.slice(0, 7);
      var p = dvDate.split('-').map(Number);
      var monthName = MESES[p[1] - 1] + ' ' + p[0];
      var matches = allRows.filter(function(r){ return searchMatch(r, term); });
      var inMonth = matches.filter(function(r){ return (r.dataset.date || '').slice(0, 7) === month; });
      var others = !inMonth.length;
      var list = others ? matches : inMonth;
      var todayStr = todayISO();
      list = list.slice().sort(function(a, b){
        if (others){
          // las más cercanas a hoy primero
          var da = Math.abs(new Date(a.dataset.date) - new Date(todayStr)), db = Math.abs(new Date(b.dataset.date) - new Date(todayStr));
          if (da !== db) return da - db;
        } else if (a.dataset.date !== b.dataset.date) return a.dataset.date < b.dataset.date ? -1 : 1;
        return (a.dataset.time || '').localeCompare(b.dataset.time || '');
      }).slice(0, 80);

      dvLabel.textContent = others ? 'Búsqueda en todas las fechas' : 'Búsqueda en ' + monthName;
      dvToday.hidden = true;
      dvCount.textContent = (others ? matches.length : inMonth.length) + ((others ? matches.length : inMonth.length) === 1 ? ' resultado' : ' resultados');
      dvSummary.innerHTML = '<span class="day-view-chip is-search">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>' +
        (others ? 'No hay en ' + monthName + '; se muestran otras fechas' : 'Se busca en todo ' + monthName + ', no solo en el día') + '</span>';
      dvList.innerHTML = '';
      if (!list.length){
        var empty = document.createElement('div');
        empty.className = 'day-view-empty';
        empty.textContent = 'Ninguna cita coincide con tu búsqueda.';
        dvList.appendChild(empty);
        return;
      }
      var lastDate = '';
      list.forEach(function(row){
        var dte = row.dataset.date || '';
        if (dte !== lastDate){
          lastDate = dte;
          var dp = dte.split('-').map(Number);
          var dd = new Date(dp[0], dp[1] - 1, dp[2]);
          var head = document.createElement('button');
          head.type = 'button';
          head.className = 'day-search-date' + (dte === todayStr ? ' is-today' : '');
          head.dataset.goDate = dte;
          head.innerHTML = '<span>' + DIAS[dd.getDay()] + ' ' + dd.getDate() + ' de ' + MESES[dd.getMonth()] + (dd.getFullYear() !== new Date().getFullYear() || others ? ' de ' + dd.getFullYear() : '') + (dte === todayStr ? ' · hoy' : '') + '</span><small>Ver ese día →</small>';
          dvList.appendChild(head);
        }
        dvList.appendChild(dayItem(row, dte < todayStr, false));
      });
    }
    // Un renglón de cita (lo usan el día y la búsqueda).
    function dayItem(row, past, isNext){
      var st = row.dataset.status;
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'day-item status-' + st + (past ? ' is-past' : '');
      item.dataset.eventId = row.dataset.id;
      var timeEl = document.createElement('span');
      timeEl.className = 'day-item-time';
      timeEl.textContent = row.dataset.time || '';
      var bar = document.createElement('span');
      bar.className = 'day-item-bar';
      var info = document.createElement('span');
      info.className = 'day-item-info';
      var name = document.createElement('strong');
      name.textContent = (row.dataset.nombre || '').trim() || 'Sin nombre';
      var sub = document.createElement('small');
      var bits = [];
      if (row.dataset.servicio) bits.push(row.dataset.servicio + (row.dataset.trabajador ? ' con ' + row.dataset.trabajador : ''));
      if (row.dataset.celular) bits.push(row.dataset.celular);
      if (row.dataset.correo) bits.push(row.dataset.correo);
      sub.textContent = bits.join(' · ');
      info.appendChild(name);
      if (bits.length) info.appendChild(sub);
      var right = document.createElement('span');
      right.className = 'day-item-right';
      if (isNext){
        var next = document.createElement('span');
        next.className = 'day-item-next';
        next.textContent = 'Siguiente';
        right.appendChild(next);
      }
      if (row.dataset.tag) right.insertAdjacentHTML('beforeend', CitaTags.pill(row.dataset.tag));
      right.insertAdjacentHTML('beforeend', CitaOrigen.originHTML(row));
      var badge = document.createElement('span');
      badge.className = CitaOrigen.badgeClass(CitaOrigen.ofRow(row));
      badge.textContent = CitaOrigen.label(CitaOrigen.ofRow(row));
      badge.title = CitaOrigen.title(CitaOrigen.ofRow(row));
      right.appendChild(badge);
      item.appendChild(timeEl);
      item.appendChild(bar);
      item.appendChild(info);
      item.appendChild(right);
      return item;
    }

    function openDayView(iso){
      dvDate = iso;
      setCitasView('dia');
    }

    if (dvView) {
      document.getElementById('dayViewPrev').addEventListener('click', function(){ dvDate = shiftISO(dvDate, -1); renderDay(-1); });
      document.getElementById('dayViewNext').addEventListener('click', function(){ dvDate = shiftISO(dvDate, 1); renderDay(1); });
      document.getElementById('dayViewTodayBtn').addEventListener('click', function(){
        var t = todayISO();
        var dir = t > dvDate ? 1 : (t < dvDate ? -1 : 0);
        dvDate = t;
        renderDay(dir);
      });
      dvList.addEventListener('click', function(e){
        var go = e.target.closest('[data-go-date]');
        if (go){
          // "Ver ese día": quita la búsqueda y abre el día de la cita.
          var dir = go.dataset.goDate > dvDate ? 1 : (go.dataset.goDate < dvDate ? -1 : 0);
          dvDate = go.dataset.goDate;
          if (searchInput){ searchInput.value = ''; searchTerm = ''; currentPage = 1; renderView(); }
          renderDay(dir);
          return;
        }
        var item = e.target.closest('[data-event-id]');
        if (item) openEventModal(item.dataset.eventId);
      });
      if (searchInput) searchInput.addEventListener('input', function(){ if (!dvView.hidden) renderDay(); });
      // Si la página se queda abierta, refresca "Siguiente" cada minuto.
      setInterval(function(){ if (!dvView.hidden && dvDate === todayISO()) renderDay(); }, 60000);
    }

    calGrid.addEventListener('click', function(e){
      if (remindOn) {
        var rchip = e.target.closest('[data-remind-key]');
        if (rchip) { openRemindModal(rchip.dataset.remindKey); return; }
        var rcell = e.target.closest('.cal-day[data-date]');
        if (rcell && (byDate[rcell.dataset.date] || []).length) {
          var rl = byDate[rcell.dataset.date];
          if (rl.length === 1) openRemindModal(rl[0].key); else openRemindDayModal(rcell.dataset.date);
        }
        return;
      }
      var chip = e.target.closest('[data-event-id]');
      if (chip) { openEventModal(chip.dataset.eventId); return; }
      var more = e.target.closest('[data-more-date]');
      if (more) { openDayModal(more.dataset.moreDate); return; }
      // Clic en cualquier otra parte del día: "Crear cita" con ese día ya
      // elegido. Los días que ya pasaron se abren en la vista de Día.
      var cell = e.target.closest('.cal-day[data-date]');
      if (!cell) return;
      var cp = cell.dataset.date.split('-').map(Number);
      var openDays = window.CitasOpenDays || [1, 2, 3, 4, 5, 6];
      var isOpenDay = openDays.indexOf(new Date(cp[0], cp[1] - 1, cp[2]).getDay()) !== -1;
      if (cell.dataset.date >= todayISO() && isOpenDay && window.CitasCrear) window.CitasCrear.open({ fecha: cell.dataset.date });
      else openDayView(cell.dataset.date);
    });

    var tagLegend = document.getElementById('calTagLegend');
    if (tagLegend) tagLegend.innerHTML = CitaTags.ALL.map(function(k){ return '<span>' + CitaTags.icon(k) + ' ' + CitaTags.TAGS[k].label + '</span>'; }).join('');
    document.addEventListener('citatags:change', function(){
      if (calView && !calView.hidden) renderCalendar();
      if (dvView && !dvView.hidden) renderDay();
    });

    if (remindOn) setRemindMode(true); else { renderCalendar(); updateRemindCount(); }
  }

  /* ---------- switch Día / Calendario / Tabla (Día es la predeterminada) ---------- */
  var viewSwitch = document.getElementById('citasViewSwitch');
  var tableView = document.getElementById('citasTableView');
  var calendarView = document.getElementById('citasCalendarView');
  var dayViewEl = document.getElementById('citasDayView');

  function setCitasView(view){
    if (!viewSwitch) return;
    viewSwitch.querySelectorAll('.view-switch-btn').forEach(function(b){
      b.classList.toggle('active', b.dataset.view === view);
    });
    viewSwitch.classList.toggle('on-calendario', view === 'calendario');
    viewSwitch.classList.toggle('on-tabla', view === 'tabla');
    if (tableView) tableView.hidden = view !== 'tabla';
    if (dayViewEl) dayViewEl.hidden = view !== 'dia';
    if (calendarView) calendarView.hidden = view !== 'calendario';
    if (view === 'calendario' && calGrid) renderCalendar();
    if (view === 'dia' && calGrid) renderDay();
  }

  if (viewSwitch) {
    viewSwitch.addEventListener('click', function(e){
      var btn = e.target.closest('.view-switch-btn');
      if (btn) setCitasView(btn.dataset.view);
    });
    // Pinta la vista con la que arranca la página (la marcada "active" en el HTML).
    var initialBtn = viewSwitch.querySelector('.view-switch-btn.active');
    if (initialBtn && initialBtn.dataset.view === 'dia') setCitasView('dia');
  }
})();

/* ---------- modal: horario de citas (portado de configuracion.js) ---------- */
(function(){
  var openBtn = document.getElementById('horarioBtn');
  var overlay = document.getElementById('horarioModalOverlay');
  var closeBtn = document.getElementById('horarioModalClose');
  var form = document.getElementById('horariosForm');
  if (!openBtn || !overlay || !form) return;

  function openModal(){
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeModal(){
    overlay.classList.remove('open');
    document.body.style.overflow = '';
  }
  openBtn.addEventListener('click', openModal);
  closeBtn && closeBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', function(e){ if (e.target === overlay) closeModal(); });

  var statusEl = document.getElementById('horariosStatus');
  var submitBtn = document.getElementById('horariosSubmit');

  function formatTime12(t){
    var parts = t.split(':').map(Number);
    var h = parts[0], m = parts[1];
    var period = h >= 12 ? 'p.m.' : 'a.m.';
    var hh = h % 12; if (hh === 0) hh = 12;
    return hh + ':' + String(m).padStart(2, '0') + ' ' + period;
  }

  function buildOptions(){
    var opts = [];
    for (var mins = 0; mins < 24 * 60; mins += 30){
      var h = String(Math.floor(mins / 60)).padStart(2, '0');
      var mm = String(mins % 60).padStart(2, '0');
      opts.push(h + ':' + mm);
    }
    return opts;
  }
  var TIME_OPTIONS = buildOptions();

  function initPicker(pickerId, hiddenInputId){
    var picker = document.getElementById(pickerId);
    var hiddenInput = document.getElementById(hiddenInputId);
    if (!picker || !hiddenInput) return;

    var trigger = picker.querySelector('.time-picker-trigger');
    var valueEl = picker.querySelector('.time-picker-value');
    var menu = picker.querySelector('.time-picker-menu');

    menu.innerHTML = TIME_OPTIONS.map(function(t){
      return '<button type="button" class="time-picker-option' + (t === hiddenInput.value ? ' active' : '') + '" data-time="' + t + '">' + formatTime12(t) + '</button>';
    }).join('');

    function setValue(t){
      hiddenInput.value = t;
      valueEl.textContent = formatTime12(t);
      menu.querySelectorAll('.time-picker-option').forEach(function(opt){
        opt.classList.toggle('active', opt.dataset.time === t);
      });
      hiddenInput.dispatchEvent(new Event('change'));
    }
    if (hiddenInput.value) setValue(hiddenInput.value);

    function open(){
      closeAllPickers();
      picker.classList.add('is-open');
      var active = menu.querySelector('.time-picker-option.active');
      if (active) active.scrollIntoView({ block: 'center' });
    }
    function close(){ picker.classList.remove('is-open'); }

    trigger.addEventListener('click', function(e){
      e.stopPropagation();
      picker.classList.contains('is-open') ? close() : open();
    });

    menu.addEventListener('click', function(e){
      var btn = e.target.closest('.time-picker-option');
      if (!btn) return;
      setValue(btn.dataset.time);
      close();
    });
  }

  function closeAllPickers(){
    document.querySelectorAll('.time-picker.is-open').forEach(function(p){ p.classList.remove('is-open'); });
  }
  document.addEventListener('click', closeAllPickers);

  initPicker('agendaOpenPicker', 'agendaOpen');
  initPicker('agendaClosePicker', 'agendaClose');

  function showStatus(text, kind){
    statusEl.textContent = text;
    statusEl.className = 'settings-status show ' + kind;
    setTimeout(function(){ statusEl.classList.remove('show'); }, 3000);
  }

  form.addEventListener('submit', function(e){
    e.preventDefault();
    var openVal = document.getElementById('agendaOpen').value;
    var closeVal = document.getElementById('agendaClose').value;

    if (closeVal <= openVal){
      showStatus('La hora de cierre debe ser después de la de apertura.', 'error');
      return;
    }

    submitBtn.disabled = true;
    fetch('/admin/configuracion/horarios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ open: openVal, close: closeVal })
    })
      .then(function(res){
        if (!res.ok) throw new Error('request failed');
        showStatus('Horario guardado.', 'ok');
      })
      .catch(function(){
        showStatus('No se pudo guardar. Intenta de nuevo.', 'error');
      })
      .finally(function(){
        submitBtn.disabled = false;
      });
  });
})();

/* ---------- pantalla completa: solo tabla/calendario ---------- */
(function(){
  var btn = document.getElementById('citasFocusBtn');
  if (!btn) return;

  var EXPAND_ICON = btn.innerHTML;
  var COLLAPSE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3v3a2 2 0 0 1-2 2H4M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"/></svg>';

  function setFocusMode(on){
    document.body.classList.toggle('citas-focus-mode', on);
    btn.classList.toggle('active', on);
    btn.innerHTML = on ? COLLAPSE_ICON : EXPAND_ICON;
    btn.setAttribute('aria-label', on ? 'Salir de pantalla completa' : 'Pantalla completa');
    btn.setAttribute('title', on ? 'Salir de pantalla completa' : 'Pantalla completa');
    if (window.feather) feather.replace();
  }

  btn.addEventListener('click', function(){
    setFocusMode(!document.body.classList.contains('citas-focus-mode'));
  });

  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape' && document.body.classList.contains('citas-focus-mode')) setFocusMode(false);
  });
})();

/* =========================================================
   MODAL: CREAR CITA (recepción)
   Día → cb-datepicker (calendario), Hora → time-picker, Estado
   inicial → admin-role-select: los tres widgets "animados" que
   ya usa el resto del sitio (crear-blog.js / configuracion.js),
   en vez de <input type=date>/<select> nativos.
   No pide código de verificación — POST /admin/citas
   (CreateAppointmentByStaff) ya está protegido por sesión de
   staff, igual que /admin/citas/:id/estado y DELETE.
   ========================================================= */
(function(){
  var openBtn = document.getElementById('crearCitaBtn');
  var overlay = document.getElementById('crearCitaModalOverlay');
  var closeBtn = document.getElementById('crearCitaModalClose');
  var cancelBtn = document.getElementById('crearCitaCancel');
  var form = document.getElementById('crearCitaForm');
  var errorEl = document.getElementById('crearCitaError');
  var submitBtn = document.getElementById('crearCitaSubmit');
  var dateHidden = document.getElementById('crearCitaDate');
  var timeHidden = document.getElementById('crearCitaTime');
  if (!openBtn || !overlay || !form) return;

  (function fillSuggestions(){
    function fill(id, attr){
      var dl = document.getElementById(id), list = [];
      try { list = JSON.parse(document.body.getAttribute(attr) || '[]') || []; } catch (e) { list = []; }
      if (!dl) return;
      dl.innerHTML = '';
      list.forEach(function(v){ var o = document.createElement('option'); o.value = v; dl.appendChild(o); });
    }
    fill('citaServiciosList', 'data-services');
    fill('citaTrabajadoresList', 'data-workers');
  })();

  var MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  var HOURS = ['09:00','09:30','10:00','10:30','11:00','11:30','12:00','12:30','13:00','13:30','14:00','14:30','15:00','15:30','16:00','16:30'];

  /* Modo del modal: 'create' (Crear cita), 'editar' o 'reagendar'.
     En editar/reagendar, editOrig guarda cómo estaba la cita para no
     contar su propia hora como "Ocupada" y saber si se movió. */
  // Días que se abre (0 = domingo … 6 = sábado), de /api/horarios.
  var OPEN_DAYS = [1, 2, 3, 4, 5, 6];
  var mode = 'create';
  var editId = null;
  var editOrig = null; // { date, time, tag, q, status }

  function toTimeStr(mins){ return String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0'); }
  function toMinutes(t){ var p = t.split(':').map(Number); return p[0] * 60 + p[1]; }
  function to12h(t){
    var p = t.split(':').map(Number), h = p[0], m = p[1];
    var period = h >= 12 ? 'p.m.' : 'a.m.';
    var hh = h % 12; if (hh === 0) hh = 12;
    return hh + ':' + String(m).padStart(2, '0') + ' ' + period;
  }
  function pad(n){ return String(n).padStart(2, '0'); }
  function iso(y, m, d){ return y + '-' + pad(m + 1) + '-' + pad(d); }

  function loadHours(){
    return fetch('/api/citas/horarios', { credentials: 'same-origin' }).then(function(res){
      if (!res.ok) return;
      return res.json();
    }).then(function(data){
      if (data && data.open && data.close) {
        var slots = [];
        for (var m = toMinutes(data.open); m <= toMinutes(data.close); m += 30) slots.push(toTimeStr(m));
        HOURS = slots;
      }
      if (data && Array.isArray(data.days) && data.days.length) OPEN_DAYS = data.days.map(Number);
      window.CitasOpenDays = OPEN_DAYS;
    }).catch(function(){ /* se queda con el horario por defecto */ });
  }

  var today = new Date();
  var todayISO = iso(today.getFullYear(), today.getMonth(), today.getDate());

  /* ---------- widgets compartidos: abrir uno cierra los demás ---------- */
  function closeAllPickers(){
    document.querySelectorAll('#crearCitaForm .time-picker.is-open, #crearCitaForm .cb-datepicker.is-open, #crearCitaForm .staff-lada-select.is-open')
      .forEach(function(p){ p.classList.remove('is-open'); });
  }
  document.addEventListener('click', closeAllPickers);

  /* ---------- Hora: time-picker ---------- */
  var timePicker = document.getElementById('crearCitaTimePicker');
  var timeBtn = document.getElementById('crearCitaTimeBtn');
  var timeLabel = document.getElementById('crearCitaTimeLabel');
  var timeMenu = document.getElementById('crearCitaTimeMenu');

  /* ---------- Horas ocupadas del día elegido ----------
     Se juntan dos fuentes: lo que dice el servidor
     (/api/horarios/ocupadas, lo mismo que usa Agendar) y las citas que
     ya están en esta página (por si la API falla). Las citas canceladas
     no ocupan. Esas horas salen como "Ocupada" y no se pueden elegir;
     si el día es hoy, las horas que ya pasaron tampoco. */
  var occupied = [];
  var occupiedReq = 0;

  function occupiedFromPage(dateISO){
    var count = {};
    Array.prototype.slice.call(document.querySelectorAll('#citasTableBody tr[data-id]'))
      .filter(function(r){ return r.dataset.date === dateISO && r.dataset.status !== 'cancelada' && r.dataset.status !== 'no_asistio' && !(editId && r.dataset.id === String(editId)); })
      .forEach(function(r){ var t = (r.dataset.time || '').slice(0, 5); count[t] = (count[t] || 0) + 1; });
    return Object.keys(count).filter(function(t){ return count[t] >= window.CITAS_CAP; });
  }

  function loadOccupied(dateISO){
    var req = ++occupiedReq;
    occupied = occupiedFromPage(dateISO);
    fillTimeMenu();
    if (!dateISO) return Promise.resolve();
    return fetch('/api/citas/horarios/ocupadas?fecha=' + encodeURIComponent(dateISO), { credentials: 'same-origin' })
      .then(function(res){ return res.ok ? res.json() : null; })
      .then(function(data){
        if (req !== occupiedReq || !data) return;
        (data.ocupadas || []).forEach(function(t){
          t = String(t).slice(0, 5);
          // La propia cita que se está editando no se cuenta como ocupada.
          if (editOrig && dateISO === editOrig.date && t === editOrig.time && window.CITAS_CAP === 1) return;
          if (occupied.indexOf(t) === -1) occupied.push(t);
        });
        fillTimeMenu();
      })
      .catch(function(){ /* se queda con lo de la página */ });
  }

  // ¿Ese día + hora ya pasó? Se PUEDE elegir (para registrar citas que
  // se olvidaron capturar y que les salga su revisión); solo se marca
  // "Ya pasó" y el servidor no le manda WhatsApp al cliente.
  function isPastSlot(t){
    var d = dateHidden.value;
    if (!d) return false;
    if (d < todayISO) return true;
    if (d > todayISO || !t) return false;
    var now = new Date();
    return t < pad(now.getHours()) + ':' + pad(now.getMinutes());
  }
  var pastHint = document.createElement('p');
  pastHint.className = 'crear-cita-tipo-hint';
  pastHint.id = 'crearCitaPastHint';
  pastHint.hidden = true;
  pastHint.textContent = 'Esta cita es de una fecha u hora que ya pasó: se registra tal cual (sirve para capturar citas que se olvidaron).';
  (function(){
    var row = timeBtn.closest('.staff-form-row');
    if (row && row.parentNode) row.parentNode.insertBefore(pastHint, row.nextSibling);
  })();
  function syncPastHint(){
    var t = timeHidden.value;
    pastHint.hidden = !(mode === 'create' && newTag !== 'sin_cita' && dateHidden.value && (dateHidden.value < todayISO || (t && isPastSlot(t))));
  }

  function fillTimeMenu(){
    // Si la hora elegida resultó ocupada (o ya pasó), se quita.
    if (timeHidden.value && occupied.indexOf(timeHidden.value) !== -1) {
      timeHidden.value = '';
      timeLabel.textContent = '—';
      errorEl.textContent = 'Esa hora ya está ocupada, elige otra.';
    }
    timeMenu.innerHTML = HOURS.map(function(t){
      var busy = occupied.indexOf(t) !== -1;
      var past = !busy && isPastSlot(t);
      var cls = 'time-picker-option' + (t === timeHidden.value ? ' active' : '') + (busy ? ' is-occupied' : '') + (past ? ' is-before' : '');
      var tag = busy ? '<small>Ocupada</small>' : (past ? '<small>Ya pasó</small>' : '');
      return '<button type="button" class="' + cls + '" data-time="' + t + '"' + (busy ? ' disabled' : '') + '>' +
        '<span>' + to12h(t) + '</span>' + tag + '</button>';
    }).join('');
  }
  function setTime(t){
    timeHidden.value = t;
    syncPastHint();
    timeLabel.textContent = to12h(t);
    timeMenu.querySelectorAll('.time-picker-option').forEach(function(opt){
      opt.classList.toggle('active', opt.dataset.time === t);
    });
  }
  timeBtn.addEventListener('click', function(e){
    e.stopPropagation();
    if (timePicker.classList.contains('is-open')) { timePicker.classList.remove('is-open'); return; }
    closeAllPickers();
    timePicker.classList.add('is-open');
    var active = timeMenu.querySelector('.time-picker-option.active');
    if (active) active.scrollIntoView({ block: 'center' });
  });
  timeMenu.addEventListener('click', function(e){
    var opt = e.target.closest('.time-picker-option');
    if (!opt || opt.disabled) return;
    errorEl.textContent = '';
    setTime(opt.dataset.time);
    timePicker.classList.remove('is-open');
  });

  /* ---------- Día: cb-datepicker ---------- */
  var datePicker = document.getElementById('crearCitaDatePicker');
  var dateBtn = document.getElementById('crearCitaDateBtn');
  var dateLabel = document.getElementById('crearCitaDateLabel');
  var dateGrid = document.getElementById('crearCitaDateGrid');
  var dateMonthLabel = document.getElementById('crearCitaDateMonthLabel');
  var viewYear, viewMonth;

  function renderDateGrid(){
    dateMonthLabel.textContent = MESES[viewMonth] + ' de ' + viewYear;

    var firstOfMonth = new Date(viewYear, viewMonth, 1);
    var startOffset = firstOfMonth.getDay();
    var daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    var daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();
    var totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;

    var html = '';
    for (var i = 0; i < totalCells; i++) {
      var dayNum, cellYear = viewYear, cellMonth = viewMonth, outside = false;
      if (i < startOffset) { dayNum = daysInPrevMonth - (startOffset - 1 - i); cellMonth -= 1; outside = true; }
      else if (i >= startOffset + daysInMonth) { dayNum = i - (startOffset + daysInMonth) + 1; cellMonth += 1; outside = true; }
      else { dayNum = i - startOffset + 1; }
      if (cellMonth < 0) { cellMonth = 11; cellYear -= 1; }
      if (cellMonth > 11) { cellMonth = 0; cellYear += 1; }
      var cellISO = iso(cellYear, cellMonth, dayNum);
      var cls = 'cb-datepicker-day';
      if (outside) cls += ' is-outside';
      if (cellISO === todayISO) cls += ' is-today';
      if (cellISO === dateHidden.value) cls += ' is-selected';
      var closedDay = OPEN_DAYS.indexOf(new Date(cellYear, cellMonth, dayNum).getDay()) === -1;
      // Los días anteriores sí se pueden elegir (citas que se olvidaron capturar).
      if (closedDay && !(editOrig && cellISO === editOrig.date)) cls += ' is-disabled';
      if (closedDay) cls += ' is-closed';
      html += '<button type="button" class="' + cls + '" data-iso="' + cellISO + '"' + (closedDay ? ' title="Ese día no se dan citas"' : '') + '>' + dayNum + '</button>';
    }
    dateGrid.innerHTML = html;
  }
  function setDate(y, m, d){
    var changed = dateHidden.value !== iso(y, m, d);
    dateHidden.value = iso(y, m, d);
    dateLabel.textContent = pad(d) + '/' + pad(m + 1) + '/' + y;
    if (changed) loadOccupied(dateHidden.value);
    syncPastHint();
  }
  document.getElementById('crearCitaDatePrev').addEventListener('click', function(e){
    e.stopPropagation();
    viewMonth -= 1; if (viewMonth < 0) { viewMonth = 11; viewYear -= 1; } renderDateGrid();
  });
  document.getElementById('crearCitaDateNext').addEventListener('click', function(e){
    e.stopPropagation();
    viewMonth += 1; if (viewMonth > 11) { viewMonth = 0; viewYear += 1; } renderDateGrid();
  });
  document.getElementById('crearCitaDateToday').addEventListener('click', function(e){
    e.stopPropagation();
    viewYear = today.getFullYear(); viewMonth = today.getMonth();
    setDate(today.getFullYear(), today.getMonth(), today.getDate());
    renderDateGrid();
  });
  dateGrid.addEventListener('click', function(e){
    var day = e.target.closest('.cb-datepicker-day');
    if (!day || day.classList.contains('is-disabled')) return;
    var parts = day.dataset.iso.split('-').map(Number);
    setDate(parts[0], parts[1] - 1, parts[2]);
    datePicker.classList.remove('is-open');
    renderDateGrid();
  });
  dateBtn.addEventListener('click', function(e){
    e.stopPropagation();
    if (datePicker.classList.contains('is-open')) { datePicker.classList.remove('is-open'); return; }
    closeAllPickers();
    renderDateGrid();
    datePicker.classList.add('is-open');
  });

  /* ---------- Lada del celular: +52 / +1 ---------- */
  var ladaWrap = document.getElementById('crearCitaLadaWrap');
  var ladaBtn = document.getElementById('crearCitaLadaBtn');
  var ladaLabel = document.getElementById('crearCitaLadaLabel');
  var ladaMenu = document.getElementById('crearCitaLadaMenu');
  var selectedLada = '+52';
  ladaBtn.addEventListener('click', function(e){
    e.stopPropagation();
    if (ladaWrap.classList.contains('is-open')) { ladaWrap.classList.remove('is-open'); return; }
    closeAllPickers();
    ladaWrap.classList.add('is-open');
  });
  ladaMenu.addEventListener('click', function(e){
    var opt = e.target.closest('.admin-role-option');
    if (!opt) return;
    selectedLada = opt.dataset.lada;
    ladaLabel.textContent = selectedLada;
    ladaMenu.querySelectorAll('.admin-role-option').forEach(function(o){ o.classList.toggle('active', o === opt); });
    ladaWrap.classList.remove('is-open');
  });

  /* ---------- Fecha de nacimiento: cb-datepicker con salto rápido de año ---------- */
  var nacPicker = document.getElementById('crearCitaNacimientoPicker');
  var nacBtn = document.getElementById('crearCitaNacimientoBtn');
  var nacLabel = document.getElementById('crearCitaNacimientoLabel');
  var nacGrid = document.getElementById('crearCitaNacimientoGrid');
  var nacHidden = document.getElementById('crearCitaNacimiento');
  var nacYearWrap = document.getElementById('crearCitaNacimientoYearWrap');
  var nacYearBtn = document.getElementById('crearCitaNacimientoMonthYearBtn');
  var nacYearMenu = document.getElementById('crearCitaNacimientoYearMenu');
  var nacViewYear, nacViewMonth;

  function renderNacimientoGrid(){
    nacYearBtn.textContent = MESES[nacViewMonth] + ' de ' + nacViewYear;

    var firstOfMonth = new Date(nacViewYear, nacViewMonth, 1);
    var startOffset = firstOfMonth.getDay();
    var daysInMonth = new Date(nacViewYear, nacViewMonth + 1, 0).getDate();
    var daysInPrevMonth = new Date(nacViewYear, nacViewMonth, 0).getDate();
    var totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;

    var html = '';
    for (var i = 0; i < totalCells; i++) {
      var dayNum, cellYear = nacViewYear, cellMonth = nacViewMonth, outside = false;
      if (i < startOffset) { dayNum = daysInPrevMonth - (startOffset - 1 - i); cellMonth -= 1; outside = true; }
      else if (i >= startOffset + daysInMonth) { dayNum = i - (startOffset + daysInMonth) + 1; cellMonth += 1; outside = true; }
      else { dayNum = i - startOffset + 1; }
      if (cellMonth < 0) { cellMonth = 11; cellYear -= 1; }
      if (cellMonth > 11) { cellMonth = 0; cellYear += 1; }
      var cellISO = iso(cellYear, cellMonth, dayNum);
      var cls = 'cb-datepicker-day';
      if (outside) cls += ' is-outside';
      if (cellISO === todayISO) cls += ' is-today';
      if (cellISO === nacHidden.value) cls += ' is-selected';
      if (cellISO > todayISO) cls += ' is-disabled';
      html += '<button type="button" class="' + cls + '" data-iso="' + cellISO + '">' + dayNum + '</button>';
    }
    nacGrid.innerHTML = html;
  }
  function setNacimiento(y, m, d){
    nacHidden.value = iso(y, m, d);
    nacLabel.value = pad(d) + '/' + pad(m + 1) + '/' + y;
    nacPicker.classList.remove('is-bad');
  }
  // Escribir la fecha a mano: solo números, las diagonales se ponen solas
  // (16101985 → 16/10/1985). Cuando está completa y es válida, se guarda.
  function nacFromText(txt){
    var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(txt.trim());
    if (!m) return null;
    var d = +m[1], mo = +m[2] - 1, y = +m[3];
    var dt = new Date(y, mo, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo || dt.getDate() !== d) return null; // 31/02…
    var isoTxt = iso(y, mo, d);
    if (isoTxt > todayISO || y < today.getFullYear() - 120) return null;
    return { y: y, m: mo, d: d, iso: isoTxt };
  }
  nacLabel.addEventListener('input', function(){
    var digits = nacLabel.value.replace(/\D/g, '').slice(0, 8);
    var out = digits.slice(0, 2) + (digits.length > 2 ? '/' + digits.slice(2, 4) : '') + (digits.length > 4 ? '/' + digits.slice(4) : '');
    if (out !== nacLabel.value) nacLabel.value = out;
    var ok = nacFromText(out);
    nacHidden.value = ok ? ok.iso : '';
    nacPicker.classList.toggle('is-bad', out.length === 10 && !ok);
    if (ok && nacPicker.classList.contains('is-open')){ nacViewYear = ok.y; nacViewMonth = ok.m; renderNacimientoGrid(); }
  });
  nacLabel.addEventListener('blur', function(){
    var v = nacLabel.value.trim();
    nacPicker.classList.toggle('is-bad', !!v && !nacFromText(v));
  });
  nacLabel.addEventListener('keydown', function(e){
    if (e.key === 'Enter'){ e.preventDefault(); nacPicker.classList.remove('is-open'); }
  });
  nacLabel.addEventListener('click', function(e){ e.stopPropagation(); });
  function fillNacYearMenu(){
    var years = [];
    for (var y = today.getFullYear(); y >= today.getFullYear() - 100; y--) years.push(y);
    nacYearMenu.innerHTML = years.map(function(y){
      return '<button type="button" class="time-picker-option' + (y === nacViewYear ? ' active' : '') + '" data-year="' + y + '">' + y + '</button>';
    }).join('');
  }
  nacYearBtn.addEventListener('click', function(e){
    e.stopPropagation();
    if (nacYearWrap.classList.contains('is-open')) { nacYearWrap.classList.remove('is-open'); return; }
    fillNacYearMenu();
    nacYearWrap.classList.add('is-open');
    var active = nacYearMenu.querySelector('.time-picker-option.active');
    if (active) active.scrollIntoView({ block: 'center' });
  });
  nacYearMenu.addEventListener('click', function(e){
    e.stopPropagation();
    var opt = e.target.closest('.time-picker-option');
    if (!opt) return;
    nacViewYear = parseInt(opt.dataset.year, 10);
    nacYearWrap.classList.remove('is-open');
    renderNacimientoGrid();
  });
  document.getElementById('crearCitaNacimientoPrev').addEventListener('click', function(e){
    e.stopPropagation();
    nacYearWrap.classList.remove('is-open');
    nacViewMonth -= 1; if (nacViewMonth < 0) { nacViewMonth = 11; nacViewYear -= 1; } renderNacimientoGrid();
  });
  document.getElementById('crearCitaNacimientoNext').addEventListener('click', function(e){
    e.stopPropagation();
    nacYearWrap.classList.remove('is-open');
    nacViewMonth += 1; if (nacViewMonth > 11) { nacViewMonth = 0; nacViewYear += 1; } renderNacimientoGrid();
  });
  document.getElementById('crearCitaNacimientoClear').addEventListener('click', function(e){
    e.stopPropagation();
    nacHidden.value = '';
    nacLabel.value = '';
    nacPicker.classList.remove('is-bad');
    renderNacimientoGrid();
  });
  nacGrid.addEventListener('click', function(e){
    var day = e.target.closest('.cb-datepicker-day');
    if (!day || day.classList.contains('is-disabled')) return;
    var parts = day.dataset.iso.split('-').map(Number);
    setNacimiento(parts[0], parts[1] - 1, parts[2]);
    nacPicker.classList.remove('is-open');
    renderNacimientoGrid();
  });
  nacBtn.addEventListener('click', function(e){
    e.stopPropagation();
    if (e.target === nacLabel) return; // escribiendo: no abre el calendario
    if (nacPicker.classList.contains('is-open')) { nacPicker.classList.remove('is-open'); return; }
    closeAllPickers();
    nacViewYear = nacHidden.value ? Number(nacHidden.value.split('-')[0]) : today.getFullYear();
    nacViewMonth = nacHidden.value ? Number(nacHidden.value.split('-')[1]) - 1 : today.getMonth();
    renderNacimientoGrid();
    nacPicker.classList.add('is-open');
  });

  /* ---------- ¿Cómo nos conoció? (opcional) ----------
     Mismos valores que en agendar.html, así "Datos del cliente" lo
     muestra igual venga de donde venga. Las preguntas médicas del
     cuestionario ya no se piden aquí (solo las llena el cliente en
     Agendar). Un clic en la opción ya marcada la desmarca. */
  form.addEventListener('mousedown', function(e){
    var chip = e.target.closest('.qchip');
    if (!chip) return;
    var input = chip.querySelector('input[type="radio"]');
    if (input) input.dataset.wasChecked = input.checked ? '1' : '';
  });
  form.addEventListener('click', function(e){
    var chip = e.target.closest('.qchip');
    if (!chip || e.target.tagName !== 'INPUT') return;
    var input = e.target;
    if (input.type === 'radio' && input.dataset.wasChecked === '1') {
      input.checked = false;
      input.dataset.wasChecked = '';
    }
  });

  /* "Empresa" → aparece el campo "¿De qué empresa?" (deslizándose). */
  var empresaWrap = document.getElementById('crearCitaEmpresaWrap');
  var empresaInput = document.getElementById('crearCitaEmpresa');
  function syncEmpresa(noFocus){
    if (!empresaWrap || !empresaInput) return;
    var sel = form.querySelector('input[name="procedencia"]:checked');
    var on = !!sel && sel.value === 'empresa';
    empresaWrap.classList.toggle('is-open', on);
    empresaInput.tabIndex = on ? 0 : -1;
    if (on && noFocus !== true) setTimeout(function(){ empresaInput.focus(); }, 250);
  }

  // Marca en el formulario las respuestas guardadas (editar cita).
  function fillQuestionnaire(q){
    form.querySelectorAll('.qchip input').forEach(function(i){ i.checked = false; i.dataset.wasChecked = ''; });
    if (empresaInput) empresaInput.value = '';
    if (q && typeof q === 'object') {
      Object.keys(q).forEach(function(name){
        var vals = Array.isArray(q[name]) ? q[name] : [q[name]];
        vals.forEach(function(v){
          if (v === null || v === undefined || v === '') return;
          var el = Array.prototype.filter.call(form.querySelectorAll('.qchip input'), function(i){
            return i.name === name && i.value === String(v);
          })[0];
          if (el) el.checked = true;
        });
      });
      if (empresaInput) empresaInput.value = q.empresa ? String(q.empresa) : '';
    }
    syncEmpresa(true);
  }
  form.addEventListener('change', function(e){ if (e.target.name === 'procedencia') syncEmpresa(); });
  // El clic que desmarca un chip no dispara "change": se revisa después del clic.
  form.addEventListener('click', function(e){
    if (e.target.name === 'procedencia') setTimeout(syncEmpresa, 0);
  });

  function collectQuestionnaire(){
    function one(name){
      var el = form.querySelector('input[name="' + name + '"]:checked');
      return el ? el.value : '';
    }
    var q = { como_se_entero: one('como_se_entero') };
    return q.como_se_entero ? q : null;
  }

  /* ---------- Tipo de cita (etiqueta) ---------- */
  var newTag = '';
  var tagsEl = document.getElementById('crearCitaTags');
  var tagHint = document.getElementById('crearCitaTagHint');
  function renderNewTags(){ if (tagsEl) tagsEl.innerHTML = CitaTags.options(newTag); }
  // Vino sin cita: hoy, a la hora libre más cercana a "ahora" (hacia atrás).
  function pickWalkInTime(){
    var now = new Date();
    var nowHM = pad(now.getHours()) + ':' + pad(now.getMinutes());
    var free = HOURS.filter(function(t){ return occupied.indexOf(t) === -1; });
    var before = free.filter(function(t){ return t <= nowHM; });
    var t = before.length ? before[before.length - 1] : free[0];
    if (t) setTime(t);
  }
  tagsEl && tagsEl.addEventListener('click', function(e){
    var b = e.target.closest('.cita-tag-opt');
    if (!b) return;
    newTag = b.classList.contains('is-on') ? '' : b.dataset.tag;
    renderNewTags();
    tagHint.hidden = newTag !== 'sin_cita' || mode !== 'create';
    syncPastHint();
    if (newTag === 'sin_cita' && mode === 'create') {
      viewYear = today.getFullYear(); viewMonth = today.getMonth();
      var p = loadOccupiedFor(today);
      renderDateGrid();
      p.then(pickWalkInTime);
    } else {
      fillTimeMenu();
    }
  });
  function loadOccupiedFor(d){
    var target = iso(d.getFullYear(), d.getMonth(), d.getDate());
    if (dateHidden.value !== target) {
      dateHidden.value = target;
      dateLabel.textContent = pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
    }
    return loadOccupied(target);
  }

  /* ---------- abrir / cerrar el modal ---------- */
  function setMode(m){
    mode = m;
    var titles = { create: 'Crear cita', editar: 'Editar cita', reagendar: 'Reagendar cita' };
    var labels = { create: 'Crear cita', editar: 'Guardar cambios', reagendar: 'Reagendar' };
    document.getElementById('crearCitaTitle').textContent = titles[m] + (m !== 'create' && editId ? ' #' + editId : '');
    submitBtn.textContent = labels[m];
    form.classList.toggle('is-editar', m === 'editar');
    form.classList.toggle('is-reagendar', m === 'reagendar');
    document.getElementById('crearCitaCurrent').hidden = m === 'create';
  }

  function openModal(){
    editId = null;
    editOrig = null;
    setMode('create');
    form.reset();
    newTag = '';
    renderNewTags();
    if (tagHint) tagHint.hidden = true;
    pastHint.hidden = true;
    errorEl.textContent = '';

    viewYear = today.getFullYear();
    viewMonth = today.getMonth();
    timeHidden.value = '';
    timeLabel.textContent = '—';
    dateHidden.value = '';
    // Hoy, o el siguiente día que sí se abre (si hoy es domingo, p. ej.).
    var start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    for (var k = 0; k < 7 && OPEN_DAYS.indexOf(start.getDay()) === -1; k++) start.setDate(start.getDate() + 1);
    viewYear = start.getFullYear(); viewMonth = start.getMonth();
    setDate(start.getFullYear(), start.getMonth(), start.getDate()); // también carga las ocupadas
    renderDateGrid();
    errorEl.textContent = '';

    form.querySelectorAll('.qchip input').forEach(function(i){ i.checked = false; i.dataset.wasChecked = ''; });
    syncEmpresa();

    selectedLada = '+52';
    ladaLabel.textContent = '+52';
    ladaMenu.querySelectorAll('.admin-role-option').forEach(function(o){ o.classList.toggle('active', o.dataset.lada === '+52'); });

    nacHidden.value = '';
    nacLabel.value = '';
    nacPicker.classList.remove('is-bad');

    var body = overlay.querySelector('.admin-modal-body');
    if (body) body.scrollTop = 0; // que no se quede donde iba la vez anterior
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeModal(){
    closeAllPickers();
    overlay.classList.remove('open');
    document.body.style.overflow = '';
  }

  // Lee el horario (y los días que se abre) desde que carga la página,
  // para que el calendario marque los días cerrados.
  loadHours().then(function(){ document.dispatchEvent(new CustomEvent('citatags:change')); });

  openBtn.addEventListener('click', function(){
    loadHours().then(openModal);
  });

  // Pone lada (+52 / +1) y los 10 dígitos a partir de "+526621234567".
  function setCelular(cel){
    var tel = String(cel || '').replace(/\D/g, '');
    var lada = tel.length > 10 ? '+' + tel.slice(0, tel.length - 10) : '+52';
    var opt = ladaMenu.querySelector('.admin-role-option[data-lada="' + lada + '"]');
    if (opt) {
      selectedLada = lada;
      ladaLabel.textContent = lada;
      ladaMenu.querySelectorAll('.admin-role-option').forEach(function(o){ o.classList.toggle('active', o === opt); });
    }
    document.getElementById('crearCitaCelular').value = tel.slice(-10);
  }

  var DIAS = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
  function fechaLargaISO(isoStr){
    var p = isoStr.split('-').map(Number);
    var d = new Date(p[0], p[1] - 1, p[2]);
    var txt = DIAS[d.getDay()] + ' ' + p[2] + ' de ' + MESES[p[1] - 1] + ' de ' + p[0];
    return txt.charAt(0).toUpperCase() + txt.slice(1);
  }

  /* ---------- Editar / Reagendar una cita existente ----------
     Mismo modal que "Crear cita", ya llenado con lo que tiene la cita.
     - editar: todo el formulario (datos, cuestionario, etiqueta y, si
       quieren, también día/hora).
     - reagendar: solo día y hora; hay que elegir una hora nueva.
     Guarda con PUT /admin/citas/:id. Si cambió el día o la hora, el
     servidor la reagenda: revisa que esté libre, la reactiva si estaba
     cancelada o "no asistió" y le avisa al cliente por WhatsApp. */
  function openEdit(id, m){
    var row = document.querySelector('#citasTableBody tr[data-id="' + id + '"]');
    if (!row) return;
    loadHours().then(function(){
      openModal();
      var q = null;
      try { q = row.dataset.cuestionario ? JSON.parse(row.dataset.cuestionario) : null; } catch (e) { q = null; }
      editId = String(id);
      editOrig = {
        date: row.dataset.date,
        time: String(row.dataset.time || '').slice(0, 5),
        tag: (window.CitaTags && CitaTags.get(id)) || '',
        q: q && typeof q === 'object' ? q : null,
        status: row.dataset.status || ''
      };
      setMode(m === 'reagendar' ? 'reagendar' : 'editar');

      // Datos del cliente (data-nombre-solo/-apellido; si faltan, se
      // parte "Nombre Apellido" en el primer espacio).
      var full = String(row.dataset.nombre || '').trim();
      var nom = row.dataset.nombreSolo != null ? row.dataset.nombreSolo : full.split(' ')[0];
      var ape = row.dataset.apellido != null ? row.dataset.apellido : full.split(' ').slice(1).join(' ');
      document.getElementById('crearCitaNombre').value = nom;
      document.getElementById('crearCitaApellido').value = ape;
      document.getElementById('crearCitaCorreo').value = row.dataset.correo || '';
      document.getElementById('crearCitaServicio').value = row.dataset.servicio || '';
      document.getElementById('crearCitaTrabajador').value = row.dataset.trabajador || '';
      document.getElementById('crearCitaNotas').value = row.dataset.notas || '';
      setCelular(row.dataset.celular);
      var n = /^(\d{4})-(\d{2})-(\d{2})$/.exec(row.dataset.fechaNacimiento || '');
      if (n) setNacimiento(+n[1], +n[2] - 1, +n[3]);
      fillQuestionnaire(editOrig.q);
      newTag = editOrig.tag;
      renderNewTags();

      // Día y hora actuales (en reagendar la hora se deja vacía para
      // que elijan la nueva).
      var f = editOrig.date.split('-').map(Number);
      viewYear = f[0]; viewMonth = f[1] - 1;
      setDate(f[0], f[1] - 1, f[2]);
      // Se recalculan las ocupadas ya sabiendo qué cita es (openModal las
      // pidió antes, cuando todavía contaba su propia hora como ocupada).
      loadOccupied(dateHidden.value);
      renderDateGrid();
      if (mode === 'editar' && editOrig.time) setTime(editOrig.time);

      // Aviso de arriba: de quién es y cuándo está ahora.
      document.getElementById('crearCitaCurrentWho').textContent = (full || 'Cita') + ' · ahora:';
      document.getElementById('crearCitaCurrentWhen').textContent = fechaLargaISO(editOrig.date) + (editOrig.time ? ' · ' + to12h(editOrig.time) : '');
      var note = document.getElementById('crearCitaCurrentNote');
      var reactiva = editOrig.status === 'cancelada' || editOrig.status === 'no_asistio';
      note.textContent = mode === 'reagendar'
        ? 'Elige el nuevo día y hora' + (reactiva ? '; la cita vuelve a quedar por atender.' : '.')
        : 'Si cambias el día o la hora, la cita se reagenda.';
      note.hidden = false;
    });
  }
  window.CitasEditar = { open: openEdit };

  // Abrir "Crear cita" ya llenado (lo usa Revisiones del calendario).
  // prefill: { nombre, apellido, celular, correo, nacimiento, fecha }
  window.CitasCrear = {
    open: function(prefill){
      prefill = prefill || {};
      loadHours().then(function(){
        openModal();
        document.getElementById('crearCitaNombre').value = prefill.nombre || '';
        document.getElementById('crearCitaApellido').value = prefill.apellido || '';
        document.getElementById('crearCitaCorreo').value = prefill.correo || '';
        var tel = String(prefill.celular || '').replace(/\D/g, '');
        if (tel.length > 10) {
          var lada = '+' + tel.slice(0, tel.length - 10);
          var opt = ladaMenu.querySelector('.admin-role-option[data-lada="' + lada + '"]');
          if (opt) {
            selectedLada = lada;
            ladaLabel.textContent = lada;
            ladaMenu.querySelectorAll('.admin-role-option').forEach(function(o){ o.classList.toggle('active', o === opt); });
          }
        }
        document.getElementById('crearCitaCelular').value = tel.slice(-10);
        var n = /^(\d{4})-(\d{2})-(\d{2})$/.exec(prefill.nacimiento || '');
        if (n) setNacimiento(+n[1], +n[2] - 1, +n[3]);
        var f = /^(\d{4})-(\d{2})-(\d{2})$/.exec(prefill.fecha || '');
        if (f) {
          viewYear = +f[1]; viewMonth = +f[2] - 1;
          setDate(+f[1], +f[2] - 1, +f[3]);
          renderDateGrid();
        }
      });
    }
  };
  closeBtn && closeBtn.addEventListener('click', closeModal);
  cancelBtn && cancelBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', function(e){ if (e.target === overlay) closeModal(); });

  function saveEdit(payload){
    var id = editId;
    var idleLabel = submitBtn.textContent;
    submitBtn.textContent = mode === 'reagendar' ? 'Reagendando...' : 'Guardando...';
    // El formulario solo trae "¿Cómo nos conoció?": las demás respuestas
    // (las médicas que llenó el cliente en Agendar) se conservan tal cual.
    var merged = Object.assign({}, (editOrig && editOrig.q) || {},
      { como_se_entero: '' }, payload.cuestionario || {});
    var hasAnswers = Object.keys(merged).some(function(k){
      var v = merged[k];
      return Array.isArray(v) ? v.length > 0 : !!v;
    });
    payload.cuestionario = hasAnswers ? merged : null;
    var tagChanged = editOrig && newTag !== editOrig.tag;
    fetch('/api/citas/' + encodeURIComponent(id), {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload)
    }).then(function(res){
      return res.json().catch(function(){ return {}; }).then(function(data){
        if (res.status === 409) {
          loadOccupied(payload.date);
          throw new Error(data.error || 'Esa hora ya está ocupada, elige otra.');
        }
        if (!res.ok) throw new Error(data.error || 'No se pudo guardar la cita.');
        return data;
      });
    }).then(function(){
      if (!tagChanged) return;
      return CitaTags.set(id, newTag).catch(function(){ /* la cita sí se guardó */ });
    }).then(function(){
      window.location.reload();
    }).catch(function(err){
      errorEl.textContent = err.message || 'No se pudo guardar. Intenta de nuevo.';
      submitBtn.disabled = false;
      submitBtn.textContent = idleLabel;
    });
  }

  form.addEventListener('submit', function(e){
    e.preventDefault();

    var nombre = document.getElementById('crearCitaNombre').value.trim();
    var apellido = document.getElementById('crearCitaApellido').value.trim();
    var celularDigits = document.getElementById('crearCitaCelular').value.trim();
    var correo = document.getElementById('crearCitaCorreo').value.trim();
    var servicio = document.getElementById('crearCitaServicio').value.trim();
    var trabajador = document.getElementById('crearCitaTrabajador').value.trim();
    var notas = document.getElementById('crearCitaNotas').value.trim();
    var nacimiento = document.getElementById('crearCitaNacimiento').value;
    var nacTxt = document.getElementById('crearCitaNacimientoLabel').value.trim();
    if (nacTxt && !nacimiento) {
      errorEl.textContent = 'Revisa la fecha de nacimiento: escríbela como dd/mm/aaaa (ej. 16/10/1985).';
      document.getElementById('crearCitaNacimientoPicker').classList.add('is-bad');
      document.getElementById('crearCitaNacimientoLabel').focus();
      return;
    }
    // Si la crea recepción, ya está confirmada: siempre "verificada".
    var status = 'verificada';
    var cuestionario = collectQuestionnaire();

    var date = dateHidden.value;
    var time = timeHidden.value;

    if (!date || !time) { errorEl.textContent = mode === 'reagendar' ? 'Elige el nuevo día y la hora.' : 'Selecciona día y hora.'; return; }
    var dParts = date.split('-').map(Number);
    var movedDay = !editOrig || date !== editOrig.date;
    if (movedDay && !(mode === 'create' && newTag === 'sin_cita') && OPEN_DAYS.indexOf(new Date(dParts[0], dParts[1] - 1, dParts[2]).getDay()) === -1) {
      errorEl.textContent = 'Ese día no se dan citas. Elige otro día.';
      return;
    }
    if (mode === 'reagendar' && editOrig && date === editOrig.date && time === editOrig.time) {
      errorEl.textContent = 'Elige un día u hora diferente a la que ya tiene.';
      return;
    }
    if (occupied.indexOf(time) !== -1) { errorEl.textContent = 'Esa hora ya está ocupada, elige otra.'; return; }
    if (!nombre || !apellido) { errorEl.textContent = 'Completa nombre y apellido.'; return; }
    if (!/^\d{10}$/.test(celularDigits)) { errorEl.textContent = 'Ingresa un celular a 10 dígitos.'; return; }
    if (correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) { errorEl.textContent = 'El correo no es válido.'; return; }

    errorEl.textContent = '';
    submitBtn.disabled = true;

    if (mode !== 'create') {
      saveEdit({
        date: date,
        time: time,
        nombre: nombre,
        apellido: apellido,
        celular: selectedLada + celularDigits,
        correo: correo,
        fecha_nacimiento: nacimiento,
        cuestionario: cuestionario,
        servicio: servicio,
        trabajador: trabajador,
        notas: notas
      });
      return;
    }

    submitBtn.textContent = 'Creando...';

    fetch('/api/citas', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: date,
        time: time,
        nombre: nombre,
        apellido: apellido,
        celular: selectedLada + celularDigits,
        correo: correo,
        fecha_nacimiento: nacimiento,
        status: status,
        cuestionario: cuestionario,
        servicio: servicio,
        trabajador: trabajador,
        notas: notas,
        // Con "Vino sin cita" el servidor no le manda el WhatsApp de
        // "tu cita quedó agendada" (ya está aquí).
        tag: newTag || ''
      })
    }).then(function(res){
      if (res.status === 409) {
        loadOccupied(date); // alguien la ganó: refresca las ocupadas
        return res.json().then(function(data){ throw new Error(data.error || 'Esa hora ya está ocupada.'); });
      }
      if (!res.ok) {
        return res.json().then(function(data){ throw new Error(data.error || 'No se pudo crear la cita.'); });
      }
      if (!newTag) { window.location.reload(); return; }
      // Guarda la etiqueta. Si la respuesta trae el id de la cita nueva se
      // guarda ya; si no, se guarda al recargar (se busca la cita por día,
      // hora y celular).
      return res.json().catch(function(){ return {}; }).then(function(data){
        var newId = data && (data.id || (data.cita && data.cita.id) || (data.appointment && data.appointment.id) || (data.item && data.item.id));
        if (newId) return CitaTags.set(newId, newTag).catch(function(){}).then(function(){ window.location.reload(); });
        try { sessionStorage.setItem('attomosPendingTag', JSON.stringify({ date: date, time: time, celular: selectedLada + celularDigits, tag: newTag, at: Date.now() })); } catch (e) {}
        window.location.reload();
      });
    }).catch(function(err){
      errorEl.textContent = err.message || 'No se pudo crear la cita. Intenta de nuevo.';
    }).finally(function(){
      submitBtn.disabled = false;
      submitBtn.textContent = 'Crear cita';
    });
  });
})();

if (window.feather) feather.replace();

/* Calendarios animados del reporte (Exportar PDF) */
if (window.AvDate) {
  AvDate.enhance(document.getElementById('ceExpDia'));
  AvDate.enhance(document.getElementById('ceExpSemana'));
}

/* =========================================================
   Mis citas — animaciones de filtros y reporte en PDF
   - La pastilla del periodo se desliza al filtro elegido.
   - Los indicadores cuentan hasta su nuevo valor.
   - "Exportar PDF": estadísticas del día, semana o mes con
     gráfica de barras, de líneas y desgloses.
   Usa las filas de la tabla (#citasTableBody) como fuente:
   no pide nada nuevo al servidor.
   ========================================================= */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  var OPTICA = !!window.CITAS_OPTICA;
  var BIZ = document.body.getAttribute('data-biz-name') || 'Attomos';
  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var MESES_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseISO(s) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function fechaLarga(s) { var d = parseISO(s); return d ? d.getDate() + ' de ' + MESES_L[d.getMonth()] + ' de ' + d.getFullYear() : '—'; }
  function cap(x) { return x ? x.charAt(0).toUpperCase() + x.slice(1) : x; }
  function horaTxt(h) { return ((h % 12) || 12) + (h < 12 ? ' am' : ' pm'); }

  /* =======================================================
     ANIMACIÓN DE LOS FILTROS
     ======================================================= */
  function glowFor(seg) {
    var g = seg && seg.querySelector('.cf-seg-glow');
    if (!g) return function () {};
    seg.classList.add('has-glow');
    var move = function (instant) {
      var on = seg.querySelector('button.is-on');
      if (!on || !on.offsetWidth) { g.style.opacity = '0'; return; }
      g.style.opacity = '1';
      if (instant) g.style.transition = 'none';
      g.style.width = on.offsetWidth + 'px';
      g.style.height = on.offsetHeight + 'px';
      g.style.transform = 'translate(' + on.offsetLeft + 'px,' + on.offsetTop + 'px)';
      if (instant) { void g.offsetWidth; g.style.transition = ''; }
    };
    // Quien cambie el botón activo (CitasFiltro u otro), la pastilla lo sigue.
    new MutationObserver(function () { move(); }).observe(seg, { subtree: true, attributes: true, attributeFilter: ['class'] });
    seg.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      b.classList.remove('is-pop'); void b.offsetWidth; b.classList.add('is-pop');
    });
    window.addEventListener('resize', function () { move(true); });
    return move;
  }
  var periodSeg = document.querySelector('#citasFiltro .cf-seg');
  var movePeriod = glowFor(periodSeg);
  requestAnimationFrame(function () { movePeriod(true); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { movePeriod(true); });

  // Al cambiar el filtro, indicadores y tabla entran con transición.
  function swap(el) { if (!el || reduce) return; el.classList.remove('is-swap'); void el.offsetWidth; el.classList.add('is-swap'); }
  if (window.CitasFiltro && window.CitasFiltro.onChange) {
    window.CitasFiltro.onChange(function () {
      swap(document.querySelector('.citas-stats'));
      swap($('citasTipos'));
      var tv = $('citasTableView');
      if (tv && !tv.hidden) swap(tv.querySelector('.admin-table-wrap'));
    });
  }
  var tiposEl = $('citasTipos');
  if (tiposEl) tiposEl.addEventListener('click', function (e) {
    var b = e.target.closest('.cf-tipo');
    if (!b) return;
    b.classList.remove('is-pop'); void b.offsetWidth; b.classList.add('is-pop');
  });

  // Los números de los indicadores cuentan hasta su valor nuevo.
  Array.prototype.forEach.call(document.querySelectorAll('.citas-stats .num'), watchNum);
  if (tiposEl) new MutationObserver(function () {
    Array.prototype.forEach.call(tiposEl.querySelectorAll('.cf-tipo-num'), function (el) { if (!el._watched) watchNum(el); });
  }).observe(tiposEl, { childList: true });
  Array.prototype.forEach.call(document.querySelectorAll('#citasTipos .cf-tipo-num'), watchNum);

  function watchNum(el) {
    el._watched = true;
    el._val = parseInt(el.textContent, 10) || 0;
    new MutationObserver(function () {
      var txt = el.textContent;
      if (el._busy && txt === el._last) return;
      var to = parseInt(txt, 10);
      if (isNaN(to) || to === el._val) return;
      var from = el._busy ? (parseInt(el._last, 10) || 0) : el._val;
      el._val = to;
      if (reduce) return;
      el._busy = true;
      var t0 = performance.now(), dur = 480;
      (function step(now) {
        var k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
        if (el._val !== to) return; // llegó otro valor: esa animación manda
        el._last = String(Math.round(from + (to - from) * e));
        el.textContent = el._last;
        if (k < 1) requestAnimationFrame(step); else el._busy = false;
      })(t0);
    }).observe(el, { childList: true, characterData: true, subtree: true });
  }

  /* =======================================================
     EXPORTAR REPORTE EN PDF
     ======================================================= */
  var modal = $('ceExportModal');
  if (!modal) return;
  var tipo = 'dia';
  var moveExp = glowFor($('ceExpTipo'));

  // ¿Compró? de cada cita que asistió: si / no / sin (no se registró) /
  // chequeo (vino a revisión, no cuenta como venta). "" = no asistió.
  function compraDe(id, status, tag) {
    if (status !== 'asistio') return { k: '' };
    var seg = window.CitaSeg ? window.CitaSeg.get(id) : null;
    var meses = seg && seg.compro && seg.meses ? (window.CitaSeg.MESES_LABEL[seg.meses] || '1 año') : '';
    if (tag === 'chequeo') return { k: 'chequeo', meses: meses };
    if (!seg) return { k: 'sin' };
    return seg.compro ? { k: 'si', meses: meses } : { k: 'no' };
  }
  var COMPRA_TXT = { si: 'Sí compró', no: 'No compró', sin: 'Sin registrar', chequeo: 'Chequeo' };

  function rows() {
    return Array.prototype.map.call(document.querySelectorAll('#citasTableBody tr[data-id]'), function (r) {
      var q = null;
      try { q = r.dataset.cuestionario ? JSON.parse(r.dataset.cuestionario) : null; } catch (e) { q = null; }
      var hm = /^(\d{1,2})/.exec(r.dataset.time || '');
      return {
        id: r.dataset.id, date: r.dataset.date || '', hour: hm ? +hm[1] : null, time: r.dataset.time || '',
        status: r.dataset.status || 'pendiente', tag: r.dataset.tag || '', nombre: (r.dataset.nombre || '').replace(/\s+/g, ' ').trim(),
        como: q && q.como_se_entero ? String(q.como_se_entero) : '', procedencia: q && q.procedencia ? String(q.procedencia) : '',
        celular: (r.dataset.celular || '').trim(),
        compra: compraDe(r.dataset.id, r.dataset.status || 'pendiente', r.dataset.tag || ''),
        origen: r.dataset.origen === 'recepcion' ? 'recepcion' : 'web'
      };
    });
  }

  function expRange() {
    var t = new Date(); t.setHours(0, 0, 0, 0);
    if (tipo === 'dia') { var d = parseISO($('ceExpDia').value) || t; return { desde: iso(d), hasta: iso(d), titulo: 'Reporte de citas del día', sub: DIAS[d.getDay()] + ' ' + fechaLarga(iso(d)) }; }
    if (tipo === 'semana') {
      var w = parseISO($('ceExpSemana').value) || t;
      var lun = new Date(w); lun.setDate(w.getDate() - ((w.getDay() + 6) % 7));
      var dom = new Date(lun); dom.setDate(lun.getDate() + 6);
      return { desde: iso(lun), hasta: iso(dom), titulo: 'Reporte de citas de la semana', sub: 'del ' + fechaLarga(iso(lun)) + ' al ' + fechaLarga(iso(dom)) };
    }
    if (tipo === 'mes') {
      var m = /^(\d{4})-(\d{2})$/.exec($('ceExpMes').value || '');
      var y = m ? +m[1] : t.getFullYear(), mo = m ? +m[2] - 1 : t.getMonth();
      return { desde: iso(new Date(y, mo, 1)), hasta: iso(new Date(y, mo + 1, 0)), titulo: 'Reporte de citas del mes', sub: MESES_L[mo] + ' de ' + y };
    }
    var b = window.CitasFiltro && window.CitasFiltro.bounds ? window.CitasFiltro.bounds() : ['', ''];
    var a = b[0], z = b[1];
    if (!a || !z) {
      var ds = rows().map(function (r) { return r.date; }).filter(Boolean).sort();
      if (!a) a = ds[0] || iso(t);
      if (!z) z = ds[ds.length - 1] || iso(t);
    }
    return { desde: a, hasta: z, titulo: 'Reporte de citas', sub: a === z ? fechaLarga(a) : 'del ' + fechaLarga(a) + ' al ' + fechaLarga(z) };
  }
  function prevRange(r) {
    var a = parseISO(r.desde), z = parseISO(r.hasta);
    if (tipo === 'mes') return { desde: iso(new Date(a.getFullYear(), a.getMonth() - 1, 1)), hasta: iso(new Date(a.getFullYear(), a.getMonth(), 0)) };
    var days = Math.round((z - a) / 864e5) + 1;
    var pz = new Date(a); pz.setDate(a.getDate() - 1);
    var pa = new Date(pz); pa.setDate(pz.getDate() - days + 1);
    return { desde: iso(pa), hasta: iso(pz) };
  }

  function syncExp() {
    $('ceExpTipo').querySelectorAll('button').forEach(function (b) { b.classList.toggle('is-on', b.getAttribute('data-tipo') === tipo); });
    modal.querySelectorAll('[data-for]').forEach(function (el) { el.hidden = el.getAttribute('data-for') !== tipo; });
    var lbl = window.CitasFiltro && window.CitasFiltro.label ? window.CitasFiltro.label() : '';
    $('ceExpActual').textContent = 'Lo que está filtrado arriba en "Periodo": ' + lbl + '.';
    $('ceExpRange').innerHTML = 'Se exporta: <b>' + esc(cap(expRange().sub)) + '</b>';
    moveExp();
  }
  $('ceExportBtn').addEventListener('click', function () {
    var t = new Date();
    if (!$('ceExpDia').value) $('ceExpDia').value = iso(t);
    if (!$('ceExpSemana').value) $('ceExpSemana').value = iso(t);
    if (!$('ceExpMes').value) $('ceExpMes').value = t.getFullYear() + '-' + pad(t.getMonth() + 1);
    $('ceExpError').textContent = '';
    modal.classList.add('open'); document.body.style.overflow = 'hidden';
    syncExp();
    requestAnimationFrame(function () { moveExp(true); });
  });
  function closeExp() { modal.classList.remove('open'); document.body.style.overflow = ''; }
  $('ceExportClose').addEventListener('click', closeExp);
  $('ceExpCancel').addEventListener('click', closeExp);
  modal.addEventListener('click', function (e) { if (e.target === modal) closeExp(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && modal.classList.contains('open')) closeExp(); });
  $('ceExpTipo').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-tipo]');
    if (!b) return;
    tipo = b.getAttribute('data-tipo');
    syncExp();
  });
  ['ceExpDia', 'ceExpSemana', 'ceExpMes'].forEach(function (id) { $(id).addEventListener('change', syncExp); });

  /* ---------- números del reporte ---------- */
  // "pendiente" no se usa en el panel: si llegara a haber, cuenta como por atender.
  var ESTADOS = [['asistio', 'Asistieron'], ['no_asistio', 'No asistieron'], ['cancelada', 'Canceladas'], ['verificada', 'Por atender']];
  var TIPOS = [['bot', 'La agendó el bot'], ['sin_cita', 'Vino sin cita'], ['chequeo', 'Chequeo'], ['telefono', 'Por teléfono'], ['whatsapp', 'Por WhatsApp'], ['web', 'Sin etiqueta']];
  var COMO = { facebook: 'Facebook', instagram: 'Instagram', television: 'Televisión', tiktok: 'TikTok', sitio_web: 'Sitio web', whatsapp: 'WhatsApp', google_maps: 'Google Maps', familiares: 'Familiares', amigos: 'Amigos', recomendado: 'Me recomendaron', casualidad: 'Pasé por casualidad', recurrente: 'Cliente recurrente', por_empresa: 'Por empresa' };

  function inR(r, rg) { return r.date && r.date >= rg.desde && r.date <= rg.hasta; }
  function stats(list) {
    var s = { total: list.length, asistio: 0, no_asistio: 0, cancelada: 0, verificada: 0, pendiente: 0 };
    list.forEach(function (r) { if (s[r.status] != null) s[r.status]++; });
    s.atendidas = s.asistio + s.no_asistio;
    s.compro = 0; s.nocompro = 0; s.sinreg = 0; s.chequeos = 0;
    list.forEach(function (r) {
      var k = r.compra && r.compra.k;
      if (k === 'si') s.compro++; else if (k === 'no') s.nocompro++; else if (k === 'sin') s.sinreg++; else if (k === 'chequeo') s.chequeos++;
    });
    s.conv = (s.compro + s.nocompro) ? s.compro / (s.compro + s.nocompro) * 100 : null;
    s.tasa = s.atendidas ? s.asistio / s.atendidas * 100 : null;
    return s;
  }
  function buckets(rg, list) {
    var a = parseISO(rg.desde), z = parseISO(rg.hasta), days = Math.round((z - a) / 864e5) + 1;
    var mode = days <= 1 ? 'hora' : days <= 62 ? 'dia' : 'mes';
    var map = {}, order = [];
    function key(r) { if (mode === 'hora') return String(r.hour); var d = parseISO(r.date); return mode === 'dia' ? r.date : d.getFullYear() + '-' + pad(d.getMonth() + 1); }
    function add(k, label) { map[k] = { k: k, label: label, total: 0, asistio: 0, no_asistio: 0, cancelada: 0, compro: 0 }; order.push(k); }
    if (mode === 'hora') {
      var hs = list.map(function (r) { return r.hour; }).filter(function (h) { return h != null; });
      var h1 = Math.min.apply(null, [9].concat(hs)), h2 = Math.max.apply(null, [19].concat(hs));
      for (var h = h1; h <= h2; h++) add(String(h), horaTxt(h));
    } else if (mode === 'dia') {
      for (var d = new Date(a); d <= z; d.setDate(d.getDate() + 1)) add(iso(d), d.getDate() + ' ' + MESES[d.getMonth()]);
    } else {
      for (var m = new Date(a.getFullYear(), a.getMonth(), 1); m <= z; m.setMonth(m.getMonth() + 1)) add(m.getFullYear() + '-' + pad(m.getMonth() + 1), MESES[m.getMonth()] + ' ' + String(m.getFullYear()).slice(2));
    }
    list.forEach(function (r) {
      var b = map[key(r)];
      if (!b) return;
      b.total++;
      if (b[r.status] != null) b[r.status]++;
      if (r.compra && r.compra.k === 'si') b.compro++;
    });
    return { mode: mode, rows: order.map(function (k) { return map[k]; }) };
  }

  /* ---------- gráficas (SVG para el PDF) ---------- */
  var C = { s1: '#2a78d6', s2: '#eb6834', s3: '#1baf7a', grid: '#e6e6e3', axis: '#b9b8b2', ink: '#0b0b0b', ink2: '#52514e' };
  function niceMax(v) {
    if (!(v > 0)) return 4;
    if (v <= 4) return 4;
    var p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p;
    var m = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
    return Math.ceil(m / 4) * 4; // 4 divisiones con números enteros
  }
  function frame(W, H, P, max) {
    var out = '';
    for (var i = 0; i <= 4; i++) {
      var y = P.t + (H - P.t - P.b) * (1 - i / 4);
      out += '<line x1="' + P.l + '" x2="' + (W - P.r) + '" y1="' + y + '" y2="' + y + '" stroke="' + (i ? C.grid : C.axis) + '" stroke-width="1"/>';
      out += '<text x="' + (P.l - 8) + '" y="' + (y + 4) + '" text-anchor="end" font-size="10.5" fill="' + C.ink2 + '">' + Math.round(max * i / 4) + '</text>';
    }
    return out;
  }
  function xLabels(rows, H, P, xOf) {
    var n = rows.length, every = Math.max(1, Math.ceil(n / 12)), out = '';
    rows.forEach(function (b, i) {
      if (i % every && i !== n - 1) return;
      out += '<text x="' + xOf(i) + '" y="' + (H - P.b + 16) + '" text-anchor="middle" font-size="10.5" fill="' + C.ink2 + '">' + esc(b.label) + '</text>';
    });
    return out;
  }
  function svg(W, H, inner) { return '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" font-family="Public Sans, Arial, sans-serif">' + inner + '</svg>'; }

  function barChart(rows) {
    var W = 720, H = 240, P = { t: 22, r: 12, b: 28, l: 40 };
    var max = niceMax(Math.max.apply(null, [0].concat(rows.map(function (b) { return b.total; }))));
    var n = rows.length, slot = (W - P.l - P.r) / n, bw = Math.max(3, Math.min(42, slot - 2));
    var y0 = H - P.b, k = (H - P.t - P.b) / max, best = -1, bestV = 0;
    rows.forEach(function (b, i) { if (b.total > bestV) { bestV = b.total; best = i; } });
    var out = frame(W, H, P, max);
    rows.forEach(function (b, i) {
      if (!(b.total > 0)) return;
      var x = P.l + slot * i + (slot - bw) / 2, h = b.total * k, y = y0 - h, rr = Math.min(4, bw / 2, h);
      out += '<path d="M' + x + ',' + y0 + 'V' + (y + rr) + 'Q' + x + ',' + y + ' ' + (x + rr) + ',' + y + 'H' + (x + bw - rr) + 'Q' + (x + bw) + ',' + y + ' ' + (x + bw) + ',' + (y + rr) + 'V' + y0 + 'Z" fill="' + C.s1 + '"/>';
      if (i === best || n <= 14) out += '<text x="' + (x + bw / 2) + '" y="' + (y - 6) + '" text-anchor="middle" font-size="10.5" font-weight="' + (i === best ? 700 : 500) + '" fill="' + (i === best ? C.ink : C.ink2) + '">' + b.total + '</text>';
    });
    out += xLabels(rows, H, P, function (i) { return P.l + slot * i + slot / 2; });
    return svg(W, H, out);
  }
  function lineChart(rows) {
    var W = 720, H = 240, P = { t: 22, r: 118, b: 28, l: 40 };
    var series = [['asistio', 'Asistieron', C.s1], ['no_asistio', 'No asistieron', C.s2], ['cancelada', 'Canceladas', C.s3]];
    var upto = rows.length;
    for (var j = rows.length - 1; j > 0; j--) { if (rows[j].future) upto = j; else break; }
    var max = niceMax(Math.max.apply(null, [0].concat(rows.map(function (b) { return Math.max(b.asistio, b.no_asistio, b.cancelada); }))));
    var n = rows.length, y0 = H - P.b, k = (H - P.t - P.b) / max;
    var xOf = function (i) { return n === 1 ? (P.l + (W - P.r)) / 2 : P.l + (W - P.l - P.r) * i / (n - 1); };
    var out = frame(W, H, P, max), ends = [];
    series.forEach(function (s) {
      var pts = rows.slice(0, upto).map(function (b, i) { return [xOf(i), y0 - b[s[0]] * k]; });
      out += '<polyline points="' + pts.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ') + '" fill="none" stroke="' + s[2] + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
      if (upto <= 16) pts.forEach(function (p) { out += '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="4" fill="' + s[2] + '" stroke="#ffffff" stroke-width="2"/>'; });
      var last = pts[pts.length - 1];
      ends.push({ x: last[0], y: last[1], label: s[1], color: s[2], tot: rows.reduce(function (a, b) { return a + b[s[0]]; }, 0) });
    });
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
      out += '<text x="' + lx + '" y="' + (e.ly + 11) + '" font-size="10" fill="' + C.ink2 + '">' + e.tot + (e.tot === 1 ? ' cita' : ' citas') + '</text>';
    });
    out += xLabels(rows, H, P, xOf);
    var legend = series.map(function (s) { return '<span class="cr-key"><i style="background:' + s[2] + '"></i>' + s[1] + '</span>'; }).join('');
    return '<div class="cr-legend">' + legend + '</div>' + svg(W, H, out);
  }
  // Barras horizontales (HTML) para los desgloses.
  function hbars(items, total) {
    var max = Math.max.apply(null, [1].concat(items.map(function (x) { return x[1]; })));
    return '<div class="cr-hbars">' + items.map(function (x) {
      var pct = total ? Math.round(x[1] * 100 / total) : 0;
      return '<div class="cr-hb"><span class="cr-hb-l">' + esc(x[0]) + '</span><span class="cr-hb-track"><i style="width:' + (x[1] / max * 100).toFixed(1) + '%"></i></span><span class="cr-hb-v"><b>' + x[1] + '</b> · ' + pct + '%</span></div>';
    }).join('') + '</div>';
  }

  var REPORT_CSS = [
    '.cr{box-sizing:border-box;width:816px;padding:40px 48px 30px;background:#fff;color:#0b0b0b;font-family:"Public Sans",Arial,sans-serif;font-size:12px;}',
    '.cr *{box-sizing:border-box;}',
    '.cr-head{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-bottom:14px;border-bottom:2px solid #0b2aa8;}',
    '.cr-brand{display:flex;align-items:center;gap:10px;}.cr-brand img{width:40px;height:40px;object-fit:contain;}',
    '.cr-brand b{display:block;font-size:15px;color:#0b2aa8;}.cr-brand small{display:block;font-size:11px;color:#52514e;}',
    '.cr-title{text-align:right;}.cr-title h1{margin:0;font-family:Fraunces,Georgia,serif;font-size:21px;font-weight:600;color:#0b0b0b;}',
    '.cr-title p{margin:2px 0 0;font-size:12px;color:#52514e;}',
    '.cr-kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin:18px 0 6px;}',
    '.cr-kpi{border:1px solid #e6e6e3;border-radius:10px;padding:10px 12px;}',
    '.cr-kpi small{display:block;font-size:9.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#52514e;}',
    '.cr-kpi b{display:block;margin-top:3px;font-size:17px;font-variant-numeric:tabular-nums;color:#0b0b0b;}',
    '.cr-kpi em{display:block;font-style:normal;font-size:10px;color:#52514e;margin-top:2px;}',
    '.cr-kpi.is-main{background:#f2f6fe;border-color:#cfdcf6;}',
    '.cr-up{color:#0b6b0b;font-weight:700;}.cr-down{color:#b42318;font-weight:700;}',
    '.cr-sec{margin-top:18px;}.cr-sec h2{margin:0 0 2px;font-size:13px;font-weight:700;color:#0b0b0b;}',
    '.cr-note{margin:0 0 8px;font-size:10.5px;color:#52514e;}',
    '.cr-legend{display:flex;gap:16px;margin:0 0 4px 40px;font-size:10.5px;color:#0b0b0b;}',
    '.cr-key{display:inline-flex;align-items:center;gap:6px;}.cr-key i{width:14px;height:3px;border-radius:2px;display:inline-block;}',
    '.cr-two{display:grid;grid-template-columns:1fr 1fr;gap:22px;}',
    '.cr-hbars{display:flex;flex-direction:column;gap:7px;}',
    '.cr-hb{display:grid;grid-template-columns:128px 1fr 66px;align-items:center;gap:8px;font-size:10.5px;}',
    '.cr-hb-l{color:#0b0b0b;}.cr-hb-v{text-align:right;color:#52514e;font-variant-numeric:tabular-nums;}.cr-hb-v b{color:#0b0b0b;}',
    '.cr-hb-track{height:10px;border-radius:0 4px 4px 0;background:#f1f1ef;overflow:hidden;}',
    '.cr-hb-track i{display:block;height:100%;background:#2a78d6;border-radius:0 4px 4px 0;}',
    '.cr table{width:100%;border-collapse:collapse;font-size:10.5px;}',
    '.cr th{text-align:right;padding:6px 8px;border-bottom:1px solid #b9b8b2;font-size:9.5px;letter-spacing:.04em;text-transform:uppercase;color:#52514e;}',
    '.cr th:first-child,.cr td:first-child{text-align:left;}',
    '.cr td{text-align:right;padding:5px 8px;border-bottom:1px solid #eeeeec;font-variant-numeric:tabular-nums;}',
    '.cr tfoot td{font-weight:700;border-top:1px solid #b9b8b2;border-bottom:none;}',
    '.cr-empty{padding:14px;border:1px dashed #d9d9d6;border-radius:10px;color:#52514e;font-size:11px;text-align:center;}',
    '.cr-chip{display:inline-block;padding:2px 8px;border-radius:100px;font-size:9.5px;font-weight:700;}',
    '.cr-chip.is-si{background:#e3f6ea;color:#1f7a4d;}.cr-chip.is-no{background:#fde8e6;color:#b42318;}',
    '.cr-chip.is-sin{background:#fff4dc;color:#8a6a12;}.cr-chip.is-chequeo{background:#eef1ff;color:#0b2aa8;}',
    '.cr td.cr-l, .cr th.cr-l{text-align:left;}',
    '.cr-foot{display:flex;justify-content:space-between;margin-top:18px;padding-top:8px;border-top:1px solid #e6e6e3;font-size:10px;color:#8a8984;}'
  ].join('');

  function pctTxt(now, before) {
    if (!(before > 0)) return '';
    var p = (now - before) / before * 100;
    if (Math.round(p) === 0) return 'igual que el periodo anterior';
    return '<span class="' + (p >= 0 ? 'cr-up' : 'cr-down') + '">' + (p >= 0 ? '▲ ' : '▼ ') + Math.abs(p).toFixed(0) + '%</span> vs. periodo anterior';
  }

  // Lista de pacientes que asistieron, con si compraron.
  function pacientesHTML(list) {
    var asis = list.filter(function (r) { return r.status === 'asistio'; })
      .sort(function (a, b) { return (a.date + a.time).localeCompare(b.date + b.time); });
    if (!asis.length) return '';
    var d = function (x) { var p = parseISO(x); return p ? p.getDate() + ' ' + MESES[p.getMonth()] : '—'; };
    return '<div class="cr-sec"><h2>Pacientes que asistieron</h2><p class="cr-note">Si compraron y cuándo les toca su próxima revisión.</p>' +
      '<table><thead><tr><th class="cr-l">Fecha</th><th class="cr-l">Hora</th><th class="cr-l">Paciente</th><th class="cr-l">¿Compró?</th><th class="cr-l">Próxima revisión</th></tr></thead><tbody>' +
      asis.map(function (r) {
        var k = r.compra.k;
        return '<tr><td class="cr-l">' + d(r.date) + '</td><td class="cr-l">' + esc(r.time) + '</td><td class="cr-l">' + esc(r.nombre || '—') + '</td>' +
          '<td class="cr-l"><span class="cr-chip is-' + k + '">' + COMPRA_TXT[k] + '</span></td><td class="cr-l">' + esc(r.compra.meses ? 'En ' + r.compra.meses : '—') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  // Citas confirmadas que todavía no se marcan (Asistió / No asistió /
  // Cancelada). Las de días que ya pasaron se quedaron sin marcar y hay
  // que corregirlas en el panel; las de hoy en adelante siguen por atender.
  function porAtenderHTML(list) {
    var pend = list.filter(function (r) { return r.status === 'verificada' || r.status === 'pendiente'; })
      .sort(function (a, b) { return (a.date + a.time).localeCompare(b.date + b.time); });
    if (!pend.length) return '';
    var today = iso(new Date());
    var pasadas = pend.filter(function (r) { return r.date < today; }).length;
    var d = function (x) { var p = parseISO(x); return p ? p.getDate() + ' ' + MESES[p.getMonth()] : '—'; };
    var nota = pasadas
      ? (pasadas === 1 ? '1 ya pasó' : pasadas + ' ya pasaron') + ' y ' + (pasadas === 1 ? 'quedó' : 'quedaron') + ' sin marcar: hay que ' + (pasadas === 1 ? 'marcarla' : 'marcarlas') + ' en el panel como Asistió, No asistió o Cancelada.'
      : 'Confirmadas que todavía no llega su día u hora.';
    return '<div class="cr-sec"><h2>Citas por atender</h2><p class="cr-note">' + nota + '</p>' +
      '<table><thead><tr><th class="cr-l">Fecha</th><th class="cr-l">Hora</th><th class="cr-l">Paciente</th><th class="cr-l">Teléfono</th><th class="cr-l">Situación</th></tr></thead><tbody>' +
      pend.map(function (r) {
        var paso = r.date < today;
        return '<tr><td class="cr-l">' + d(r.date) + '</td><td class="cr-l">' + esc(r.time) + '</td><td class="cr-l">' + esc(r.nombre || '—') + '</td>' +
          '<td class="cr-l">' + esc(r.celular || '—') + '</td>' +
          '<td class="cr-l"><span class="cr-chip ' + (paso ? 'is-sin">Sin marcar' : 'is-chequeo">Próxima') + '</span></td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function reportHTML(rg, all) {
    var list = all.filter(function (r) { return inR(r, rg); });
    var prev = all.filter(function (r) { return inR(r, prevRange(rg)); });
    var s = stats(list), ps = stats(prev);
    var bk = buckets(rg, list);
    var today = iso(new Date());
    if (bk.mode === 'dia') bk.rows.forEach(function (b) { b.future = b.k > today; });
    else if (bk.mode === 'mes') bk.rows.forEach(function (b) { b.future = b.k > today.slice(0, 7); });
    var unidad = bk.mode === 'hora' ? 'hora' : bk.mode === 'dia' ? 'día' : 'mes';
    var best = null; bk.rows.forEach(function (b) { if (b.total > (best ? best.total : 0)) best = b; });

    // Horas más pedidas (para cualquier periodo)
    var horas = {};
    list.forEach(function (r) { if (r.hour != null && r.status !== 'cancelada') horas[r.hour] = (horas[r.hour] || 0) + 1; });
    var topHora = Object.keys(horas).sort(function (a, b) { return horas[b] - horas[a]; })[0];

    var porTipo = TIPOS.map(function (t) { return [t[1], list.filter(function (r) { return (r.tag || 'web') === t[0] || (t[0] === 'web' && !TIPOS.some(function (x) { return x[0] === r.tag; })); }).length]; });
    var comoCount = {};
    list.forEach(function (r) { if (r.como) comoCount[r.como] = (comoCount[r.como] || 0) + 1; });
    var conCuest = Object.keys(comoCount).reduce(function (a, k) { return a + comoCount[k]; }, 0);
    var porComo = Object.keys(comoCount).map(function (k) { return [COMO[k] || cap(k.replace(/_/g, ' ')), comoCount[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
    var porEstado = ESTADOS.map(function (e) { return [e[1], e[0] === 'verificada' ? s.verificada + s.pendiente : s[e[0]]]; });

    var sinMarcar = list.filter(function (r) { return (r.status === 'verificada' || r.status === 'pendiente') && r.date < today; }).length;
    var kpi = function (label, val, sub, cls) { return '<div class="cr-kpi' + (cls ? ' ' + cls : '') + '"><small>' + label + '</small><b>' + val + '</b>' + (sub ? '<em>' + sub + '</em>' : '') + '</div>'; };
    var pct = function (n) { return s.total ? Math.round(n * 100 / s.total) + '% del total' : ''; };
    var generado = (document.querySelector('.userbar-name, .user-name') || {}).textContent || BIZ;

    return '<div class="cr">' +
      '<div class="cr-head"><div class="cr-brand"><img src="/static/images/attomos-favicon.png" alt=""><div><b>' + esc(BIZ) + '</b><small>Mis citas</small></div></div>' +
        '<div class="cr-title"><h1>' + esc(rg.titulo) + '</h1><p>' + esc(cap(rg.sub)) + '</p></div></div>' +
      '<div class="cr-kpis">' +
        kpi('Citas totales', String(s.total), pctTxt(s.total, ps.total), 'is-main') +
        kpi('Asistieron', String(s.asistio), pctTxt(s.asistio, ps.asistio), 'is-main') +
        kpi('Tasa de asistencia', s.tasa == null ? '—' : Math.round(s.tasa) + '%', s.atendidas ? 'de ' + s.atendidas + ' que ya se marcaron' : 'aún no se marca ninguna') +
        kpi('Mejor ' + unidad, best ? esc(best.label) : '—', best ? best.total + (best.total === 1 ? ' cita' : ' citas') : '') +
        kpi('No asistieron', String(s.no_asistio), pct(s.no_asistio)) +
        kpi('Canceladas', String(s.cancelada), pct(s.cancelada)) +
        kpi('Por atender', String(s.verificada + s.pendiente), sinMarcar ? (sinMarcar === 1 ? '1 ya pasó sin marcar' : sinMarcar + ' ya pasaron sin marcar') : pct(s.verificada + s.pendiente)) +
        kpi('Hora más pedida', topHora != null ? horaTxt(+topHora) : '—', topHora != null ? horas[topHora] + (horas[topHora] === 1 ? ' cita' : ' citas') : '') +
        (OPTICA ? kpi('Compraron', String(s.compro), s.asistio ? 'de ' + s.asistio + ' que asistieron' : '', 'is-main') +
        kpi('Conversión', s.conv == null ? '—' : Math.round(s.conv) + '%', s.sinreg ? s.sinreg + ' sin registrar' : (s.compro + s.nocompro ? 'de los que se registró' : 'aún no se registra')) : '') +
      '</div>' +
      '<div class="cr-sec"><h2>Citas por ' + unidad + '</h2><p class="cr-note">Todas las citas agendadas, de cualquier estado.</p>' + barChart(bk.rows) + '</div>' +
      '<div class="cr-sec"><h2>Asistencia por ' + unidad + '</h2><p class="cr-note">Cuántos asistieron, cuántos no llegaron y cuántas se cancelaron.</p>' + lineChart(bk.rows) + '</div>' +
      '<div class="cr-sec cr-two">' +
        '<div><h2>Por estado</h2><p class="cr-note">Cómo quedó cada cita del periodo.</p>' + hbars(porEstado, s.total) + '</div>' +
        '<div><h2>Cómo llegaron</h2><p class="cr-note">La etiqueta de la cita.</p>' + hbars(porTipo, s.total) + '</div>' +
      '</div>' +
      '<div class="cr-sec"><h2>¿Quién hizo la cita?</h2><p class="cr-note">Por el bot = la agendó tu bot por WhatsApp. Desde el panel = la capturaste aquí.</p>' +
        hbars([['Por el bot', list.filter(function (r) { return r.origen === 'web'; }).length], ['Desde el panel', list.filter(function (r) { return r.origen === 'recepcion'; }).length]], s.total) + '</div>' +
      '<div class="cr-sec"><h2>¿Cómo nos conocieron?</h2><p class="cr-note">Del cuestionario inicial' + (conCuest ? ' (' + conCuest + ' de ' + s.total + ' lo contestaron)' : '') + '.</p>' +
        (porComo.length ? hbars(porComo, conCuest) : '<div class="cr-empty">Nadie contestó el cuestionario en este periodo.</div>') + '</div>' +
      (OPTICA ? '<div class="cr-sec"><h2>¿Compraron?</h2><p class="cr-note">De los que asistieron. Los chequeos no cuentan como venta.</p>' +
        (s.asistio ? hbars([['Sí compraron', s.compro], ['No compraron', s.nocompro], ['Sin registrar', s.sinreg], ['Chequeos', s.chequeos]], s.asistio) : '<div class="cr-empty">Nadie asistió en este periodo.</div>') + '</div>' : '') +
      porAtenderHTML(list) +
      (OPTICA ? pacientesHTML(list) : '') +
      '<div class="cr-sec"><h2>Detalle por ' + unidad + '</h2><p class="cr-note">Solo aparecen ' + (bk.mode === 'hora' ? 'las horas' : bk.mode === 'dia' ? 'los días' : 'los meses') + ' con citas.</p>' +
        '<table><thead><tr><th>' + cap(unidad) + '</th><th>Citas</th><th>Asistieron</th><th>No asistieron</th><th>Canceladas</th><th>Compraron</th><th>Asistencia</th></tr></thead><tbody>' +
        (bk.rows.filter(function (b) { return b.total; }).map(function (b) {
          var at = b.asistio + b.no_asistio;
          return '<tr><td>' + esc(b.label) + '</td><td>' + b.total + '</td><td>' + b.asistio + '</td><td>' + b.no_asistio + '</td><td>' + b.cancelada + '</td><td>' + b.compro + '</td><td>' + (at ? Math.round(b.asistio * 100 / at) + '%' : '—') + '</td></tr>';
        }).join('') || '<tr><td colspan="7">Sin citas en este periodo.</td></tr>') +
        '</tbody><tfoot><tr><td>Total</td><td>' + s.total + '</td><td>' + s.asistio + '</td><td>' + s.no_asistio + '</td><td>' + s.cancelada + '</td><td>' + s.compro + '</td><td>' + (s.tasa == null ? '—' : Math.round(s.tasa) + '%') + '</td></tr></tfoot></table></div>' +
      '<div class="cr-foot"><span>Del ' + fechaLarga(rg.desde) + ' al ' + fechaLarga(rg.hasta) + '</span><span>Generado por ' + esc(generado.trim()) + ' · ' + fechaLarga(iso(new Date())) + ' ' + new Date().toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' }) + '</span></div>' +
    '</div>';
  }

  /* ---------- PDF ---------- */
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
  function makePdf(html, name) {
    return Promise.all([loadLib(LIBS.h2c), loadLib(LIBS.jspdf)]).then(function () {
      if (!$('crCss')) { var st = document.createElement('style'); st.id = 'crCss'; st.textContent = REPORT_CSS; document.head.appendChild(st); }
      var host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:-12000px;top:0;background:#fff;';
      host.innerHTML = html;
      document.body.appendChild(host);
      var el = host.firstChild;
      return Promise.all(Array.prototype.map.call(el.querySelectorAll('img'), function (im) { return im.complete ? null : new Promise(function (r) { im.onload = im.onerror = r; }); }))
        .then(function () { return document.fonts && document.fonts.ready; })
        .then(function () {
          // Puntos donde se puede cortar la hoja: inicio de cada sección y de cada renglón de tabla.
          var top0 = el.getBoundingClientRect().top;
          el._cuts = Array.prototype.map.call(el.querySelectorAll('.cr-sec, tbody tr:nth-child(n+3), tfoot tr'), function (n) { return n.getBoundingClientRect().top - top0 - 6; });
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

  $('ceExpGo').addEventListener('click', function () {
    var btn = this, rg = expRange();
    btn.disabled = true; btn.textContent = 'Generando…'; $('ceExpError').textContent = '';
    var name = 'Citas ' + BIZ + ' ' + (tipo === 'mes' ? rg.sub : rg.desde === rg.hasta ? rg.desde : rg.desde + ' a ' + rg.hasta) + '.pdf';
    Promise.resolve().then(function () { return makePdf(reportHTML(rg, rows()), name); })
      .then(closeExp)
      .catch(function (err) { $('ceExpError').textContent = (err && err.message) || 'No se pudo generar el PDF.'; })
      .finally(function () { btn.disabled = false; btn.textContent = 'Descargar PDF'; });
  });
})();