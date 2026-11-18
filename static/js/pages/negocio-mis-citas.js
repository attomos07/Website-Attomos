/* negocio-mis-citas.js — Mis citas del cliente (/n/:slug/mis-citas).
   Reagendar abre la página de agendar en modo cambio (?reagendar=<id>);
   cancelar pide un motivo. API: handlers/business_page.go */
(function () {
  'use strict';
  var app = document.getElementById('mcApp');
  if (!app) return;
  var slug = app.dataset.slug, API = '/api/n/' + slug + '/mis-citas';
  var $ = function (id) { return document.getElementById(id); };
  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var MESES_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  var STATUS = { pending: 'Por confirmar', confirmed: 'Confirmada', completed: 'Atendida', cancelled: 'Cancelada', no_show: 'No asististe' };
  var citas = [], tab = 'proximas', cancelId = 0;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function parse(d) { var p = d.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function to12(t) { var p = t.split(':'), h = +p[0]; return (h % 12 || 12) + ':' + p[1] + ' ' + (h >= 12 ? 'pm' : 'am'); }
  function longDate(c) { var d = parse(c.date); return DIAS[d.getDay()] + ' ' + d.getDate() + ' de ' + MESES_L[d.getMonth()]; }
  function toast(msg) {
    var t = $('mcToast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { t.classList.remove('show'); }, 3200);
  }

  async function load() {
    try {
      var r = await fetch(API, { headers: { Accept: 'application/json' } });
      var d = await r.json().catch(function () { return {}; });
      if (r.status === 401) { location.href = '/n/' + slug + '/entrar'; return; }
      if (!r.ok) throw new Error(d.error || 'No se pudieron cargar tus citas.');
      citas = d.citas || [];
      stats();
      render();
    } catch (e) {
      $('mcList').innerHTML = '';
      $('mcEmpty').hidden = false;
      $('mcEmptyTxt').textContent = e.message;
    }
  }

  function stats() {
    var next = citas.filter(function (c) { return c.proxima; }).sort(function (a, b) { return (a.date + a.time).localeCompare(b.date + b.time); });
    $('mcStNext').textContent = next.length;
    $('mcStTotal').textContent = citas.length;
    $('mcStWhen').textContent = next.length ? longDate(next[0]).replace(/^./, function (x) { return x.toUpperCase(); }) + ' · ' + to12(next[0].time) : 'Sin citas próximas';
  }

  function render() {
    var list = citas.filter(function (c) { return tab === 'proximas' ? c.proxima : !c.proxima; });
    if (tab === 'proximas') list.sort(function (a, b) { return (a.date + a.time).localeCompare(b.date + b.time); });
    $('mcEmpty').hidden = list.length > 0;
    $('mcEmptyTxt').textContent = tab === 'proximas'
      ? 'No tienes citas próximas. Agenda una y aparecerá aquí para que la puedas cambiar o cancelar.'
      : 'Aquí verás tus citas anteriores y las que canceles.';
    $('mcList').innerHTML = list.map(function (c, i) {
      var d = parse(c.date), off = c.status === 'cancelled' || !c.proxima;
      var acts = c.puedeCambiar
        ? '<div class="mc-actions"><a class="mc-btn mc-btn-ghost mc-btn-sm" href="/n/' + slug + '/agendar?reagendar=' + c.id + '">Reagendar</a>' +
          '<button type="button" class="mc-btn mc-btn-ghost mc-btn-sm" data-cancel="' + c.id + '">Cancelar</button></div>'
        : '';
      var reason = c.status === 'cancelled' && c.cancelReason ? '<p class="mc-reason">' + esc(c.cancelReason) + '</p>' : '';
      var hint = c.status === 'pending' && c.proxima ? '<span>· ' + esc('Te confirmarán pronto') + '</span>' : '';
      return '<article class="mc-item' + (off ? ' is-off' : '') + '" style="--i:' + i + '">' +
        '<div class="mc-date"><small>' + MESES[d.getMonth()] + '</small><strong>' + d.getDate() + '</strong><small>' + DIAS[d.getDay()].slice(0, 3) + '</small></div>' +
        '<div class="mc-info"><h3>' + esc(longDate(c)) + ' · ' + to12(c.time) + '</h3>' +
          '<div class="mc-meta"><span class="mc-status st-' + esc(c.status) + '"><i></i>' + esc(STATUS[c.status] || c.status) + '</span>' + hint +
          (c.servicio ? '<span>· ' + esc(c.servicio) + '</span>' : '') + '</div>' + reason + '</div>' +
        acts + '</article>';
    }).join('');
  }

  document.querySelector('.mc-tabs').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-tab]');
    if (!b) return;
    tab = b.dataset.tab;
    this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('is-on', x === b); });
    this.classList.toggle('is-right', tab === 'anteriores');
    render();
  });

  /* ---------- cancelar ---------- */
  var ov = $('mcCancel');
  function openCancel(id) {
    var c = citas.filter(function (x) { return x.id === id; })[0];
    if (!c) return;
    cancelId = id;
    $('mcCancelWhen').textContent = longDate(c) + ' a las ' + to12(c.time);
    $('mcMotivo').value = '';
    $('mcCancelError').textContent = '';
    $('mcReasons').querySelectorAll('button').forEach(function (b) { b.classList.remove('is-on'); });
    $('mcCancelMove').href = '/n/' + slug + '/agendar?reagendar=' + id;
    ov.classList.add('open');
    ov.setAttribute('aria-hidden', 'false');
  }
  function closeCancel() { ov.classList.remove('open'); ov.setAttribute('aria-hidden', 'true'); }
  $('mcList').addEventListener('click', function (e) {
    var b = e.target.closest('[data-cancel]');
    if (b) openCancel(+b.dataset.cancel);
  });
  ov.addEventListener('click', function (e) { if (e.target === ov || e.target.closest('[data-close]')) closeCancel(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeCancel(); });
  $('mcReasons').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('is-on', x === b); });
    $('mcMotivo').value = b.textContent;
    $('mcCancelError').textContent = '';
  });
  $('mcCancelOk').addEventListener('click', async function () {
    var motivo = $('mcMotivo').value.trim(), btn = this;
    if (motivo.length < 3) { $('mcCancelError').textContent = 'Elige o escribe el motivo.'; $('mcMotivo').focus(); return; }
    btn.disabled = true;
    try {
      var r = await fetch(API + '/' + cancelId + '/cancelar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ motivo: motivo }) });
      var d = await r.json().catch(function () { return {}; });
      if (!r.ok) throw new Error(d.error || 'No se pudo cancelar.');
      closeCancel();
      toast('Tu cita quedó cancelada.');
      load();
    } catch (e) {
      $('mcCancelError').textContent = e.message;
    }
    btn.disabled = false;
  });

  // Viene de reagendar: aviso.
  try {
    var q = new URLSearchParams(location.search);
    if (q.get('ok') === 'reagendada') { toast('¡Listo! Tu cita cambió de horario.'); history.replaceState(null, '', location.pathname); }
  } catch (_) {}

  load();
})();