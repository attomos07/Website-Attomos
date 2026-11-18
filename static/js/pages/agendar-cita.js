/* agendar-cita.js — Página pública para agendar (/agendar/:id).
   Mismo flujo que /agendar de Avante: día → hora (en la misma tarjeta) →
   Tus datos → preguntas paso a paso → cita agendada.
   Con cuenta del cliente (/n/:slug), "Tus datos" llega lleno. Con
   ?reagendar=<id> solo se elige el nuevo día y hora de esa cita.
   API: handlers/booking.go y handlers/business_page.go */
(function () {
  'use strict';

  var app = document.getElementById('agApp');
  if (!app) return;
  var API = '/api/agendar/' + app.dataset.id;
  var SLUG = app.dataset.slug || '', CLAIMS = 'attReclamos:' + app.dataset.id;
  var reschedId = +(new URLSearchParams(location.search).get('reagendar') || 0), resched = null;
  var $ = function (id) { return document.getElementById(id); };

  var MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var WEEKDAYS_FULL = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO'];
  var DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  var CHECK = '<svg class="qopt-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
  var HOUR_CHECK = '<svg class="appt-hour-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

  /* Preguntas rápidas — las mismas de Avante. Se guardan con las mismas
     claves que ya lee "Ver cliente" en Citas. Si el negocio no es óptica,
     solo se pregunta cómo se enteró. */
  var COMO = { step: 'como', type: 'radio', name: 'como_se_entero', cls: 'qopt-list qopt-list--2col', required: true,
    title: '¿Cómo te enteraste de nosotros?', hint: 'Elige una opción.',
    opts: [['facebook', 'Facebook'], ['instagram', 'Instagram'], ['television', 'Televisión'], ['tiktok', 'TikTok'],
      ['sitio_web', 'Sitio web'], ['google_maps', 'Google Maps'], ['familiares', 'Familiares'], ['amigos', 'Amigos'],
      ['recomendado', 'Me recomendaron'], ['casualidad', 'Pasé por casualidad'], ['recurrente', 'Ya soy cliente']] };
  var Q_OPTICA = [
    { type: 'radio', name: 'ultimo_examen', required: true, title: '¿Hace cuánto fue tu último examen de la vista?', hint: 'Elige una opción.',
      opts: [['menos_6_meses', 'Menos de 6 meses'], ['6_meses_1_anio', 'Entre 6 meses y 1 año'], ['1_2_anios', 'Entre 1 y 2 años'], ['mas_2_anios', 'Más de 2 años'], ['nunca', 'Nunca me he hecho uno']] },
    { step: 'lentes', type: 'groups', title: '¿Usas lentes actualmente?', hint: 'Responde las dos.',
      groups: [{ name: 'lentes_armazon', label: 'Lentes de armazón', opts: [['si', 'Sí'], ['no', 'No']] },
               { name: 'lentes_contacto', label: 'Lentes de contacto', opts: [['si', 'Sí'], ['no', 'No']] }] },
    { type: 'radio', name: 'usa_gotitas', cls: 'qopt-row', required: true, title: '¿Usas gotitas para los ojos?', hint: 'Como tratamiento o para resequedad.',
      opts: [['si', 'Sí'], ['no', 'No']] },
    { type: 'check', name: 'problemas', title: '¿Tienes alguno de estos problemas en tus ojos?', hint: 'Puedes elegir varias, o ninguna.',
      opts: [['fatiga_visual', 'Fatiga visual', 'al trabajar con la computadora'], ['mala_vision_lejana', 'Mala visión lejana'], ['mala_vision_cercana', 'Mala visión cercana'],
        ['sensibilidad_luz_solar', 'Sensibilidad a la luz solar'], ['sensibilidad_luz_artificial', 'Sensibilidad a la luz artificial']] },
    { type: 'check', name: 'enfermedades', title: '¿Padeces alguna de estas enfermedades?', hint: 'Puedes elegir varias, o ninguna.',
      opts: [['diabetes', 'Diabetes'], ['hipertension', 'Hipertensión'], ['cirugias_oculares', 'Cirugías oculares']] },
    COMO,
    { type: 'radio', name: 'procedencia', required: true, empresa: true, title: '¿Vienes de parte de alguna empresa?', hint: 'Elige una opción.',
      opts: [['empresa', 'De una empresa'], ['ninguna', 'Ninguna, vengo por mi cuenta']] }
  ];

  var info = null, viewDate = null, selectedDate = '', selectedTime = null, occupiedHours = [];
  var contactData = null, questions = [], questIndex = 0, sending = false, doneOK = false;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseISO(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function to12h(t) {
    var p = t.split(':'), h = +p[0];
    return (h % 12 || 12) + ':' + p[1] + ' ' + (h >= 12 ? 'PM' : 'AM');
  }
  function formatSelectedDate(s) { var d = parseISO(s); return DIAS[d.getDay()] + ' ' + d.getDate() + ' de ' + MONTHS[d.getMonth()]; }
  function animate(el) { el.classList.remove('is-animating'); void el.offsetWidth; el.classList.add('is-animating'); }

  /* ---------------- carga ---------------- */
  async function load() {
    try {
      var r = await fetch(API);
      var d = await r.json();
      if (!r.ok) throw new Error(d.error || 'No se pudo cargar.');
      info = d;
      var n = d.negocio || {};
      if (n.nombre) $('agName').textContent = n.nombre;
      if (n.logo) $('agLogo').innerHTML = '<img src="' + esc(n.logo) + '" alt="' + esc(n.nombre || '') + '">';
      else $('agLogo').querySelector('span').textContent = (n.nombre || '·').trim().charAt(0).toUpperCase();
      if (n.direccion) { $('apptDetailAddress').textContent = n.direccion; $('apptAddrRow').hidden = false; }
      questions = n.optica ? Q_OPTICA : [COMO];
      paintQuestions();
      if (d.cliente) prefill(d.cliente);
      if (reschedId && SLUG) await loadResched(!!d.cliente);
      var hoy = parseISO(d.hoy);
      viewDate = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
      renderCalendar(0);
    } catch (e) {
      $('apptDayGrid').innerHTML = '<p class="appt-hour-empty">' + esc(e.message) + ' Recarga la página.</p>';
    }
  }

  /* ---------------- cuenta del cliente ---------------- */
  function prefill(c) {
    $('apptNombre').value = c.nombre || '';
    $('apptApellido').value = c.apellido || '';
    $('apptCelular').value = c.celular || '';
    $('apptCorreo').value = c.correo || '';
    if (c.fechaNacimiento) birthPicker.set(c.fechaNacimiento);
    var note = document.createElement('p');
    note.className = 'ag-logged';
    note.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/></svg>' +
      '<span>Llenamos tus datos con tu cuenta. Tu cita aparecerá en «Mis citas».</span>';
    var form = $('apptContactForm');
    form.insertBefore(note, form.firstChild);
  }
  async function loadResched(logged) {
    if (!logged) { location.href = '/n/' + SLUG + '/entrar'; return; }
    var box = $('agResched');
    try {
      var r = await fetch('/api/n/' + SLUG + '/mis-citas');
      var d = await r.json();
      var c = (d.citas || []).filter(function (x) { return x.id === reschedId; })[0];
      if (!c || !c.puedeCambiar) throw new Error('Esta cita ya no se puede cambiar desde aquí.');
      resched = c;
      $('agLead').textContent = 'Elige el nuevo día y la nueva hora para tu cita.';
      box.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>' +
        '<span>Cambiando tu cita del <b>' + esc(formatSelectedDate(c.date)) + '</b> a las <b>' + to12h(c.time) + '</b></span>';
      $('apptSubmit').textContent = 'Confirmar cambio';
    } catch (e) {
      box.textContent = e.message || 'No encontramos esa cita en tu cuenta.';
      reschedId = 0;
    }
    box.hidden = false;
  }
  async function doResched() {
    if (sending) return;
    sending = true;
    var btn = $('apptSubmit');
    btn.disabled = true;
    btn.textContent = 'Guardando…';
    try {
      var r = await fetch('/api/n/' + SLUG + '/mis-citas/' + resched.id + '/reagendar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: selectedDate, time: selectedTime })
      });
      var d = await r.json().catch(function () { return {}; });
      if (r.ok) {
        doneOK = 'resched';
        openApptModal('¡Cita reagendada!', 'Tu cita ahora es el ' + formatSelectedDate(selectedDate) + ' a las ' + to12h(selectedTime) +
          '. ' + ((info.negocio || {}).nombre || 'El negocio') + ' te confirmará el nuevo horario.', true);
      } else if (d.ocupada) {
        selectedTime = null;
        $('apptDetailTime').textContent = 'Por definir';
        loadOccupiedHours(selectedDate).then(renderHours);
        openApptModal('Esa hora ya se ocupó', 'Justo se agendó esa hora — elige otra disponible.', false);
      } else {
        openApptModal('No se pudo cambiar', d.error || 'Intenta de nuevo en un momento.', false);
      }
    } catch (_) {
      openApptModal('Sin conexión', 'Revisa tu internet e intenta de nuevo.', false);
    }
    sending = false;
    btn.disabled = false;
    btn.textContent = 'Confirmar cambio';
  }

  /* ---------------- calendario (iOS 27) ---------------- */
  function closedReason(s) {
    var c = (info.cerrados || []).filter(function (x) { return x.fecha === s; })[0];
    return c ? (c.motivo || '') : null;
  }
  function dayState(d) {
    var s = iso(d);
    if (s < info.hoy) return 'past';
    var max = parseISO(info.hoy); max.setDate(max.getDate() + info.maxDias);
    if (d > max) return 'far';
    if (closedReason(s) !== null) return 'closed-date';
    if (!(info.horario || {})[String(d.getDay())]) return 'closed';
    if (s === info.hoy && !hourSlots(s).length) return 'past';
    return 'ok';
  }
  function renderCalendar(dir) {
    var v = viewDate;
    $('agMonth').textContent = MONTHS[v.getMonth()];
    $('agYear').textContent = v.getFullYear();
    var hoy = parseISO(info.hoy), max = parseISO(info.hoy); max.setDate(max.getDate() + info.maxDias);
    $('agPrev').disabled = v.getFullYear() === hoy.getFullYear() && v.getMonth() === hoy.getMonth();
    $('agNext').disabled = new Date(v.getFullYear(), v.getMonth() + 1, 1) > max;
    var first = v.getDay(), total = new Date(v.getFullYear(), v.getMonth() + 1, 0).getDate();
    var html = '', i = 0;
    for (var p = 0; p < first; p++) html += '<span class="appt-day empty"></span>';
    for (var n = 1; n <= total; n++) {
      var d = new Date(v.getFullYear(), v.getMonth(), n), s = iso(d), st = dayState(d);
      var cls = 'appt-day' + (s === info.hoy ? ' today' : '') + (s === selectedDate ? ' selected' : '') +
        (st === 'closed' ? ' closed' : '') + (st === 'closed-date' ? ' closed-date' : '');
      var title = st === 'closed-date' ? 'Cerrado' : st === 'closed' ? 'Ese día no se dan citas' : '';
      html += '<button type="button" class="' + cls + '" data-d="' + s + '" data-st="' + st + '" style="--i:' + (i++) + '"' +
        (st === 'ok' || st === 'closed-date' ? '' : ' disabled') + (title ? ' title="' + title + '"' : '') + '>' + n + '</button>';
    }
    var g = $('apptDayGrid');
    g.innerHTML = html;
    g.classList.remove('slide-l', 'slide-r');
    if (dir) { void g.offsetWidth; g.classList.add(dir > 0 ? 'slide-l' : 'slide-r'); }
    $('apptClosedNotes').hidden = true;
  }
  $('agPrev').onclick = function () { viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1); renderCalendar(-1); };
  $('agNext').onclick = function () { viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1); renderCalendar(1); };
  $('apptDayGrid').onclick = function (e) {
    var b = e.target.closest('.appt-day[data-d]');
    if (!b || b.disabled) return;
    if (b.dataset.st === 'closed-date') {
      var why = closedReason(b.dataset.d), box = $('apptClosedNotes');
      box.innerHTML = '<p class="appt-closed-note">' + esc(capitalize(formatSelectedDate(b.dataset.d))) + ': estaremos cerrados' + (why ? ' (' + esc(why) + ')' : '') + '.</p>';
      box.hidden = false;
      return;
    }
    selectDay(b.dataset.d);
  };
  (function () { // deslizar el mes con el dedo
    var x0 = null, g = $('apptDayGrid');
    g.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    g.addEventListener('touchend', function (e) {
      if (x0 == null) return;
      var dx = e.changedTouches[0].clientX - x0; x0 = null;
      if (Math.abs(dx) < 50) return;
      var btn = dx < 0 ? $('agNext') : $('agPrev');
      if (!btn.disabled) btn.click();
    });
  })();

  function selectDay(s) {
    var d = parseISO(s);
    selectedDate = s;
    selectedTime = null;
    $('apptDayNum').textContent = d.getDate();
    $('apptWeekday').textContent = WEEKDAYS_FULL[d.getDay()];
    $('apptSideMonthYear').textContent = capitalize(MONTHS[d.getMonth()]) + ' ' + d.getFullYear();
    $('apptDetailTime').textContent = 'Por definir';
    ['apptDayNum', 'apptWeekday', 'apptSideMonthYear'].forEach(function (id) { animate($(id)); });
    showHourView();
  }
  function showView(id, back) {
    ['apptDayView', 'apptHourView'].forEach(function (v) { $(v).classList.remove('active', 'is-back'); });
    var el = $(id);
    if (back) el.classList.add('is-back');
    void el.offsetWidth;
    el.classList.add('active');
  }
  async function showHourView() {
    $('apptHourDateLabel').textContent = formatSelectedDate(selectedDate);
    $('apptHourGrid').innerHTML = '';
    showView('apptHourView');
    $('apptHourGrid').classList.add('loading');
    await loadOccupiedHours(selectedDate);
    $('apptHourGrid').classList.remove('loading');
    renderHours();
  }
  $('apptBack').addEventListener('click', function () { showView('apptDayView', true); renderCalendar(0); });

  /* ---------------- horas (como Avante: AM / PM) ---------------- */
  function hourSlots(day) {
    var out = [], h = (info.horario || {})[String(parseISO(day).getDay())];
    if (!h) return out;
    var a = h[0].split(':'), b = h[1].split(':');
    var m = Math.ceil((+a[0] * 60 + +a[1]) / 30) * 30, end = +b[0] * 60 + +b[1], minNow = -1;
    if (day === info.hoy) { var n = info.ahora.split(':'); minNow = +n[0] * 60 + +n[1] + 30; }
    for (; m <= end; m += 30) if (m >= minNow) out.push(pad(Math.floor(m / 60)) + ':' + pad(m % 60));
    return out;
  }
  async function loadOccupiedHours(day) {
    try {
      var r = await fetch(API + '/ocupadas?fecha=' + day + (resched ? '&excepto=' + resched.id : ''));
      var d = await r.json();
      occupiedHours = r.ok ? (d.ocupadas || []) : [];
    } catch (e) { occupiedHours = []; }
  }
  function renderHours() {
    var grid = $('apptHourGrid'), slots = hourSlots(selectedDate);
    if (!slots.filter(function (t) { return occupiedHours.indexOf(t) < 0; }).length) {
      grid.innerHTML = '<p class="appt-hour-empty">Ya no quedan horas este día.<br>Toca «Volver» y elige otro.</p>';
      return;
    }
    grid.innerHTML = slots.map(function (t) {
      var busy = occupiedHours.indexOf(t) >= 0;
      return '<button type="button" class="appt-hour' + (selectedTime === t ? ' active' : '') + (busy ? ' occupied' : '') + '" data-t="' + t + '"' +
        (busy ? ' disabled title="Esta hora ya está ocupada"' : '') + '>' + HOUR_CHECK + '<span class="appt-hour-label">' + to12h(t) + '</span></button>';
    }).join('');
  }
  $('apptHourGrid').addEventListener('click', function (e) {
    var b = e.target.closest('.appt-hour');
    if (!b || b.disabled) return;
    selectedTime = b.dataset.t;
    $('apptDetailTime').textContent = to12h(selectedTime);
    animate($('apptDetailTime'));
    this.querySelectorAll('.appt-hour').forEach(function (x) { x.classList.remove('active'); });
    b.classList.add('active');
  });

  /* ---------------- modales ---------------- */
  function openModal(id) { $(id).classList.add('open'); document.body.style.overflow = 'hidden'; }
  function closeModal(id) {
    $(id).classList.remove('open');
    if (!document.querySelector('.modal-overlay.open')) document.body.style.overflow = '';
  }
  // Clic afuera NO cierra (para no perder lo llenado): solo rebota.
  document.querySelectorAll('.modal-overlay').forEach(function (ov) {
    ov.addEventListener('click', function (e) {
      if (e.target !== ov) return;
      var card = ov.querySelector('.modal-card');
      card.classList.remove('is-bump'); void card.offsetWidth; card.classList.add('is-bump');
    });
  });
  function openApptModal(title, text, ok, alt) {
    var a = $('apptModalAlt');
    a.hidden = !alt;
    if (alt) { a.textContent = alt.text; a.href = alt.href; }
    $('apptModalTitle').textContent = title;
    $('apptModalText').textContent = text;
    var ic = document.querySelector('#apptModalOverlay .modal-icon');
    ic.classList.toggle('is-warn', !ok);
    ic.innerHTML = ok
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 7v6M12 17h.01"/></svg>';
    openModal('apptModalOverlay');
  }
  function closeApptModal() {
    closeModal('apptModalOverlay');
    if (doneOK === 'resched') location.href = '/n/' + SLUG + '/mis-citas?ok=reagendada';
    else if (doneOK) location.reload();
  }
  $('apptModalClose').addEventListener('click', closeApptModal);
  $('apptModalOk').addEventListener('click', closeApptModal);
  $('apptContactModalClose').addEventListener('click', function () { closeModal('apptContactModalOverlay'); });
  $('apptQuestModalClose').addEventListener('click', function () { closeModal('apptQuestModalOverlay'); });

  $('apptSubmit').addEventListener('click', function () {
    if (!selectedDate || !selectedTime) {
      openApptModal('Elige una hora', 'Por favor selecciona un día y una hora antes de confirmar.', false);
      return;
    }
    if (resched) { doResched(); return; }
    $('apptContactError').textContent = '';
    openModal('apptContactModalOverlay');
  });

  /* ---------------- fecha de nacimiento (selector de Avante) ---------------- */
  var birthPicker = (function () {
    var wrap = $('apptNacimientoPicker'), trigger = $('apptNacimientoBtn'), label = $('apptNacimientoLabel');
    var menu = $('apptNacimientoMenu'), prevBtn = $('apptNacimientoPrev'), nextBtn = $('apptNacimientoNext');
    var monthYearBtn = $('apptNacimientoMonthYear'), yearsEl = $('apptNacimientoYears'), daysEl = $('apptNacimientoDays');
    var grid = $('apptNacimientoGrid'), clearBtn = $('apptNacimientoClear'), hidden = $('apptNacimiento');
    var today = new Date();
    var isoYMD = function (y, m, d) { return y + '-' + pad(m + 1) + '-' + pad(d); };
    var todayISO = isoYMD(today.getFullYear(), today.getMonth(), today.getDate());
    var viewY = today.getFullYear() - 25, viewM = 0, showingYears = false;

    function setLabel() {
      if (hidden.value) {
        var p = hidden.value.split('-');
        label.textContent = p[2] + '/' + p[1] + '/' + p[0];
        label.classList.remove('is-placeholder');
      } else {
        label.textContent = 'dd/mm/aaaa';
        label.classList.add('is-placeholder');
      }
    }
    function renderDays() {
      monthYearBtn.textContent = capitalize(MONTHS[viewM]) + ' ' + viewY;
      var first = new Date(viewY, viewM, 1).getDay(), inMonth = new Date(viewY, viewM + 1, 0).getDate(), html = '';
      for (var i = 0; i < first; i++) html += '<span class="appt-datepicker-day is-empty"></span>';
      for (var d = 1; d <= inMonth; d++) {
        var v = isoYMD(viewY, viewM, d), cls = 'appt-datepicker-day';
        if (v === hidden.value) cls += ' is-selected';
        if (v === todayISO) cls += ' is-today';
        html += '<button type="button" class="' + cls + '" data-iso="' + v + '"' + (v > todayISO ? ' disabled' : '') + '>' + d + '</button>';
      }
      grid.innerHTML = html;
      nextBtn.disabled = isoYMD(viewY, viewM, 1) >= isoYMD(today.getFullYear(), today.getMonth(), 1);
      grid.classList.remove('is-anim'); void grid.offsetWidth; grid.classList.add('is-anim');
    }
    function renderYears() {
      var html = '';
      for (var y = today.getFullYear(); y >= today.getFullYear() - 100; y--) {
        html += '<button type="button" class="appt-datepicker-year' + (y === viewY ? ' is-active' : '') + '" data-year="' + y + '">' + y + '</button>';
      }
      yearsEl.innerHTML = html;
      var active = yearsEl.querySelector('.is-active');
      if (active) yearsEl.scrollTop = active.offsetTop - yearsEl.clientHeight / 2 + active.offsetHeight / 2;
    }
    function setYearsMode(on) {
      showingYears = on;
      yearsEl.hidden = !on;
      daysEl.hidden = on;
      prevBtn.style.visibility = nextBtn.style.visibility = on ? 'hidden' : '';
      monthYearBtn.classList.toggle('is-open', on);
      monthYearBtn.textContent = on ? 'Elige el año' : capitalize(MONTHS[viewM]) + ' ' + viewY;
      if (on) renderYears(); else renderDays();
    }
    function open() {
      if (hidden.value) {
        var p = hidden.value.split('-').map(Number);
        viewY = p[0]; viewM = p[1] - 1;
        setYearsMode(false);
      } else {
        setYearsMode(true);
      }
      wrap.classList.add('is-open');
      trigger.setAttribute('aria-expanded', 'true');
    }
    function close() {
      wrap.classList.remove('is-open');
      trigger.setAttribute('aria-expanded', 'false');
    }
    trigger.addEventListener('click', function (e) { e.stopPropagation(); wrap.classList.contains('is-open') ? close() : open(); });
    menu.addEventListener('click', function (e) { e.stopPropagation(); });
    document.addEventListener('click', close);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    prevBtn.addEventListener('click', function () { viewM--; if (viewM < 0) { viewM = 11; viewY--; } renderDays(); });
    nextBtn.addEventListener('click', function () { viewM++; if (viewM > 11) { viewM = 0; viewY++; } renderDays(); });
    monthYearBtn.addEventListener('click', function () { setYearsMode(!showingYears); });
    yearsEl.addEventListener('click', function (e) {
      var b = e.target.closest('[data-year]');
      if (!b) return;
      viewY = Number(b.dataset.year);
      if (isoYMD(viewY, viewM, 1) > todayISO) viewM = today.getMonth();
      setYearsMode(false);
    });
    grid.addEventListener('click', function (e) {
      var b = e.target.closest('[data-iso]');
      if (!b || b.disabled) return;
      hidden.value = b.dataset.iso;
      setLabel();
      $('apptContactError').textContent = '';
      renderDays();
      setTimeout(close, 140);
    });
    clearBtn.addEventListener('click', function () { hidden.value = ''; setLabel(); setYearsMode(true); });
    return { value: function () { return hidden.value; }, set: function (v) { hidden.value = v; setLabel(); } };
  })();

  /* ---------------- 1 · tus datos ---------------- */
  $('apptCelular').addEventListener('input', function () { this.value = this.value.replace(/\D/g, '').slice(0, 10); });
  $('apptContactForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var nombre = $('apptNombre').value.trim(), apellido = $('apptApellido').value.trim();
    var cel = $('apptCelular').value.trim(), correo = $('apptCorreo').value.trim();
    var err = $('apptContactError');
    if (!nombre || !apellido) { err.textContent = 'Completa tu nombre y apellido.'; return; }
    if (!/^\d{10}$/.test(cel)) { err.textContent = 'Ingresa un celular a 10 dígitos.'; return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) { err.textContent = 'Ingresa un correo válido.'; return; }
    var nac = birthPicker.value();
    if (!nac) { err.textContent = 'Elige tu fecha de nacimiento.'; return; }
    err.textContent = '';
    contactData = { nombre: nombre, apellido: apellido, celular: '+52' + cel, correo: correo, fechaNacimiento: nac, website: $('apptWebsite').value };
    closeModal('apptContactModalOverlay');
    $('apptQuestForm').reset();
    syncEmpresaField();
    showQuestStep(0);
    openModal('apptQuestModalOverlay');
  });

  /* ---------------- 2 · preguntas (paso a paso, como Avante) ---------------- */
  function optHTML(type, name, o) {
    return '<label class="qopt"><input type="' + type + '" name="' + name + '" value="' + o[0] + '"><span class="qopt-box">' +
      '<span class="qopt-text">' + esc(o[1]) + (o[2] ? '<small>' + esc(o[2]) + '</small>' : '') + '</span>' + CHECK + '</span></label>';
  }
  function paintQuestions() {
    $('questSteps').innerHTML = questions.map(function (q, k) {
      var body;
      if (q.type === 'groups') {
        body = q.groups.map(function (g) {
          return '<div class="qopt-group"><span class="qopt-group-label">' + esc(g.label) + '</span><div class="qopt-row">' +
            g.opts.map(function (o) { return optHTML('radio', g.name, o); }).join('') + '</div></div>';
        }).join('');
      } else {
        body = '<div class="' + (q.cls || 'qopt-list') + '">' + q.opts.map(function (o) {
          return optHTML(q.type === 'check' ? 'checkbox' : 'radio', q.name, o);
        }).join('') + '</div>';
      }
      if (q.empresa) {
        body += '<div class="quest-empresa" id="questEmpresaWrap" aria-hidden="true"><div class="modal-field">' +
          '<label for="questEmpresa">¿De qué empresa?</label>' +
          '<input type="text" id="questEmpresa" name="empresa" maxlength="120" placeholder="Nombre de la empresa" autocomplete="organization" tabindex="-1"></div></div>';
      }
      return '<section class="quest-step" data-k="' + k + '"><h3>' + esc(q.title) + '</h3><p class="quest-step-hint">' + esc(q.hint) + '</p>' + body + '</section>';
    }).join('');
    var emp = $('questEmpresa');
    if (emp) {
      emp.addEventListener('input', function () { $('apptQuestError').textContent = ''; });
      emp.addEventListener('keydown', function (e) { if (e.key === 'Enter') e.preventDefault(); });
    }
  }
  function empresaSelected() {
    var el = document.querySelector('#apptQuestForm input[name="procedencia"]:checked');
    return !!el && el.value === 'empresa';
  }
  function syncEmpresaField() {
    var wrap = $('questEmpresaWrap'), inp = $('questEmpresa');
    if (!wrap) return;
    var on = empresaSelected();
    wrap.classList.toggle('is-open', on);
    wrap.setAttribute('aria-hidden', on ? 'false' : 'true');
    inp.tabIndex = on ? 0 : -1;
    if (on) setTimeout(function () { inp.focus(); }, 260);
  }
  function stepValid(k) {
    var q = questions[k], f = $('apptQuestForm');
    if (q.type === 'groups') return q.groups.every(function (g) { return f.querySelector('input[name="' + g.name + '"]:checked'); });
    if (q.required && !f.querySelector('input[name="' + q.name + '"]:checked')) return false;
    if (q.empresa && empresaSelected() && !$('questEmpresa').value.trim()) return false;
    return true;
  }
  function showQuestStep(i, back) {
    questIndex = Math.max(0, Math.min(i, questions.length - 1));
    document.querySelectorAll('#questSteps .quest-step').forEach(function (el, k) {
      el.classList.toggle('is-active', k === questIndex);
      el.classList.toggle('is-back', k === questIndex && !!back);
    });
    var last = questIndex === questions.length - 1;
    $('questCount').textContent = 'Paso ' + (questIndex + 1) + ' de ' + questions.length;
    $('questProgressBar').style.width = ((questIndex + 1) / questions.length * 100) + '%';
    $('questBack').hidden = questIndex === 0;
    $('questNext').hidden = last;
    $('apptQuestSubmit').hidden = !last;
    $('apptQuestError').textContent = '';
    $('apptQuestModalOverlay').scrollTop = 0;
  }
  function stepError(k) {
    var q = questions[k];
    return q.type === 'groups' ? 'Responde las dos preguntas para continuar.'
      : (q.empresa && empresaSelected()) ? 'Escribe el nombre de la empresa.'
      : 'Elige una opción para continuar.';
  }
  $('questNext').addEventListener('click', function () {
    if (!stepValid(questIndex)) { $('apptQuestError').textContent = stepError(questIndex); return; }
    showQuestStep(questIndex + 1);
  });
  $('questBack').addEventListener('click', function () { showQuestStep(questIndex - 1, true); });
  // Elegir una opción NO avanza sola (igual que Avante): solo con "Siguiente".
  $('apptQuestForm').addEventListener('change', function (e) {
    $('apptQuestError').textContent = '';
    if (e.target.name === 'procedencia') syncEmpresaField();
  });
  $('apptQuestForm').addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || e.target.tagName === 'BUTTON') return;
    e.preventDefault();
    if (!$('questNext').hidden) $('questNext').click(); else $('apptQuestSubmit').click();
  });

  function answers() {
    var f = $('apptQuestForm'), out = {};
    var val = function (n) { var el = f.querySelector('input[name="' + n + '"]:checked'); return el ? el.value : ''; };
    questions.forEach(function (q) {
      if (q.type === 'groups') q.groups.forEach(function (g) { out[g.name] = val(g.name); });
      else if (q.type === 'check') out[q.name] = [].map.call(f.querySelectorAll('input[name="' + q.name + '"]:checked'), function (i) { return i.value; });
      else out[q.name] = val(q.name);
    });
    if ('procedencia' in out) out.empresa = empresaSelected() ? $('questEmpresa').value.trim() : '';
    return out;
  }

  /* ---------------- agendar ---------------- */
  $('apptQuestForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    for (var k = 0; k < questions.length; k++) {
      if (!stepValid(k)) { showQuestStep(k, true); $('apptQuestError').textContent = k === questIndex ? stepError(k) : 'Te faltó responder esta pregunta.'; return; }
    }
    if (sending) return;
    sending = true;
    var btn = $('apptQuestSubmit');
    btn.disabled = true;
    btn.textContent = 'Agendando...';
    var c = contactData;
    try {
      var r = await fetch(API, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: selectedDate, time: selectedTime, nombre: c.nombre, apellido: c.apellido, celular: c.celular,
          correo: c.correo, fecha_nacimiento: c.fechaNacimiento, cuestionario: answers(), website: c.website
        })
      });
      var d = await r.json().catch(function () { return {}; });
      closeModal('apptQuestModalOverlay');
      if (r.ok) {
        doneOK = true;
        var neg = (info.negocio || {}).nombre || 'el negocio', alt = null;
        if (d.reclamo) { // si luego crea su cuenta, esta cita pasa a "Mis citas"
          try {
            var cl = JSON.parse(localStorage.getItem(CLAIMS) || '[]');
            cl.push(d.reclamo);
            localStorage.setItem(CLAIMS, JSON.stringify(cl.slice(-10)));
          } catch (_) {}
        }
        try { if (!d.cuenta) sessionStorage.setItem('attContacto:' + app.dataset.id, JSON.stringify(c)); } catch (_) {}
        if (SLUG) alt = d.cuenta ? { text: 'Ver mis citas', href: '/n/' + SLUG + '/mis-citas' }
          : { text: 'Crea tu cuenta para cambiar o cancelar tu cita sin llamar', href: '/n/' + SLUG + '/registro' };
        openApptModal('¡Cita agendada!', 'Tu cita quedó agendada para el ' + formatSelectedDate(selectedDate) + ' a las ' + to12h(selectedTime) +
          '. ' + neg + ' te confirmará por WhatsApp. ¡Te esperamos!', true, alt);
      } else if (d.ocupada) {
        selectedTime = null;
        $('apptDetailTime').textContent = 'Por definir';
        loadOccupiedHours(selectedDate).then(renderHours);
        openApptModal('Esa hora ya se ocupó', 'Justo se agendó esa hora — elige otra disponible.', false);
      } else {
        openApptModal('No se pudo agendar', d.error || 'Intenta de nuevo en un momento.', false);
      }
    } catch (ex) {
      closeModal('apptQuestModalOverlay');
      openApptModal('Sin conexión', 'Revisa tu internet e intenta de nuevo.', false);
    } finally {
      sending = false;
      btn.disabled = false;
      btn.textContent = 'Agendar cita';
    }
  });

  load();
})();