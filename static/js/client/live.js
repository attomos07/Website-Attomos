/* live.js — Tiempo real del panel (como Avante): una sola conexión por
   pestaña a /api/live. Cuando alguien del negocio cambia algo (una venta,
   un examen, un paso del laboratorio, una cita, el inventario) el servidor
   avisa con el tema y cada pantalla vuelve a pedir sus datos al instante.

     AttomosLive.on(['lab', 'optometria'], function (topic) { ... });
     AttomosLive.notice('Hay citas nuevas', 'Actualizar', fn);

   Las páginas siguen recargando cada minuto por si se pierde un aviso. */
(function () {
  'use strict';
  if (window.AttomosLive) return;

  var subs = [];
  // Cuándo esta pantalla guardó algo (para no avisarse a sí misma).
  var lastWrite = 0;
  if (window.fetch) {
    var _fetch = window.fetch;
    window.fetch = function (input, init) {
      var m = (init && init.method) || (input && input.method) || 'GET';
      if (String(m).toUpperCase() !== 'GET') lastWrite = Date.now();
      return _fetch.apply(this, arguments);
    };
  }
  var es = null, retry = 1500, wasDown = false;

  function fire(topic) {
    subs.forEach(function (s) {
      if (s.topics.indexOf(topic) < 0 && s.topics.indexOf('*') < 0) return;
      // Varios avisos seguidos (p. ej. una venta toca pos, lab e inventario)
      // se juntan en una sola recarga.
      clearTimeout(s.timer);
      s.timer = setTimeout(function () {
        try { s.fn(topic); } catch (e) { console.error('[live]', e); }
      }, 300);
    });
    try { window.dispatchEvent(new CustomEvent('attomos:live', { detail: { topic: topic } })); } catch (_) {}
  }

  function connect() {
    if (!window.EventSource) return;
    try { es = new EventSource('/api/live', { withCredentials: true }); } catch (_) { return; }
    es.addEventListener('hello', function () {
      retry = 1500;
      // Si se cayó la conexión, pudo haberse perdido un aviso: recarga todo.
      if (wasDown) { wasDown = false; ['pos', 'lab', 'optometria', 'citas', 'inventario'].forEach(fire); }
    });
    es.addEventListener('change', function (e) {
      try { var d = JSON.parse(e.data); if (d && d.topic) fire(d.topic); } catch (_) {}
    });
    es.onerror = function () {
      if (es) es.close();
      es = null;
      wasDown = true;
      setTimeout(connect, retry);
      retry = Math.min(retry * 2, 30000);
    };
  }

  var noticeEl = null;
  function notice(text, action, onClick) {
    if (!noticeEl) {
      noticeEl = document.createElement('div');
      noticeEl.className = 'live-notice';
      noticeEl.setAttribute('role', 'status');
      noticeEl.innerHTML = '<span class="live-notice-dot"></span><span class="live-notice-txt"></span><button type="button" class="live-notice-btn"></button><button type="button" class="live-notice-x" aria-label="Cerrar">×</button>';
      var st = document.createElement('style');
      st.textContent =
        '.live-notice{position:fixed;left:50%;bottom:24px;z-index:9000;display:flex;align-items:center;gap:12px;padding:10px 10px 10px 16px;border-radius:999px;' +
        'background:rgba(17,24,39,.92);color:#fff;font:600 13px/1.2 system-ui,-apple-system,sans-serif;box-shadow:0 18px 40px rgba(15,23,42,.28);' +
        'backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);transform:translate(-50%,140%);opacity:0;transition:transform .5s cubic-bezier(.22,1.4,.36,1),opacity .3s}' +
        '.live-notice.show{transform:translate(-50%,0);opacity:1}' +
        '.live-notice-dot{width:8px;height:8px;border-radius:50%;background:#22d3ee;box-shadow:0 0 0 4px rgba(34,211,238,.25);animation:liveDot 1.6s ease-in-out infinite}' +
        '@keyframes liveDot{50%{box-shadow:0 0 0 7px rgba(34,211,238,0)}}' +
        '.live-notice-btn{border:none;border-radius:999px;background:#06b6d4;color:#fff;font:inherit;padding:8px 14px;cursor:pointer;transition:transform .25s cubic-bezier(.22,1,.36,1),background .2s}' +
        '.live-notice-btn:hover{background:#0891b2;transform:scale(1.04)}.live-notice-btn:active{transform:scale(.95)}' +
        '.live-notice-x{border:none;background:transparent;color:rgba(255,255,255,.6);font-size:18px;line-height:1;cursor:pointer;padding:4px 8px}.live-notice-x:hover{color:#fff}';
      document.head.appendChild(st);
      document.body.appendChild(noticeEl);
      noticeEl.querySelector('.live-notice-x').addEventListener('click', function () { noticeEl.classList.remove('show'); });
    }
    noticeEl.querySelector('.live-notice-txt').textContent = text;
    var btn = noticeEl.querySelector('.live-notice-btn');
    btn.textContent = action || 'Actualizar';
    btn.onclick = function () { noticeEl.classList.remove('show'); if (onClick) onClick(); };
    requestAnimationFrame(function () { noticeEl.classList.add('show'); });
  }

  window.AttomosLive = {
    on: function (topics, fn) { subs.push({ topics: [].concat(topics), fn: fn, timer: 0 }); },
    notice: notice,
    recentWrite: function (ms) { return Date.now() - lastWrite < (ms || 3000); }
  };
  connect();
})();