/* citas-compartir.js — Recepción → Citas → ⚙ "Compartir con tus clientes".
   Ligas públicas: la página para agendar (/agendar/:id) y el rastreo de
   pedidos (/rastreo). Copiar, abrir, mandar por WhatsApp y código QR.
   API: GET /api/citas/compartir (handlers/booking.go) */
(function () {
  'use strict';
  var btn = document.getElementById('citasShareBtn');
  var ov = document.getElementById('citasShareOverlay');
  if (!btn || !ov) return;
  var list = document.getElementById('citasShareList');
  var data = null;

  var IC = {
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18M9 15l2 2 4-4"/></svg>',
    track: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>',
    wa: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.2-.2-.5-.3Z"/></svg>',
    qr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>'
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function open() {
    ov.classList.add('open');
    document.body.style.overflow = 'hidden';
    if (!data) load();
  }
  function close() {
    ov.classList.remove('open');
    if (!document.querySelector('.admin-modal-overlay.open')) document.body.style.overflow = '';
  }
  btn.addEventListener('click', open);
  ov.addEventListener('click', function (e) {
    if (e.target === ov || e.target.closest('[data-cs-close]')) close();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && ov.classList.contains('open')) close(); });

  async function load() {
    try {
      var r = await fetch('/api/citas/compartir', { credentials: 'include' });
      data = await r.json();
      if (!r.ok) throw new Error(data.error || 'No se pudieron cargar las ligas.');
      paint();
    } catch (e) {
      data = null;
      list.innerHTML = '<p class="cs-intro">' + esc(e.message) + '</p>';
    }
  }

  function paint() {
    var neg = data.negocio || 'nuestro negocio';
    var items = [
      { key: 'agendar', ic: IC.cal, title: 'Página para agendar',
        desc: 'Tus clientes eligen servicio, día y hora. La cita te llega aquí como Pendiente con la etiqueta «Por la web».',
        url: data.agendar, msg: '¡Hola! Agenda tu cita en ' + neg + ' aquí: ' + data.agendar },
      { key: 'rastreo', ic: IC.track, title: 'Rastreo de pedidos',
        desc: data.optica ? 'Tus clientes ven en qué paso del laboratorio van sus lentes con la clave AT de su ticket.' : 'Tus clientes ven cómo va su pedido con la clave de su ticket.',
        url: data.rastreo, msg: (data.optica ? 'Revisa cómo van tus lentes' : 'Revisa cómo va tu pedido') + ' en ' + neg + ' con la clave de tu ticket: ' + data.rastreo }
    ];
    list.innerHTML = items.map(function (it, i) {
      return '<section class="cs-item" data-key="' + it.key + '" style="--i:' + i + '">' +
        '<div class="cs-item-head"><span class="cs-ic cs-ic-' + it.key + '">' + it.ic + '</span>' +
          '<div><strong>' + it.title + '</strong><small>' + esc(it.desc) + '</small></div></div>' +
        '<div class="cs-url"><span>' + esc(it.url.replace(/^https?:\/\//, '')) + '</span>' +
          '<button type="button" class="cs-copy" data-act="copy" title="Copiar liga" aria-label="Copiar liga">' + IC.copy + '</button></div>' +
        '<div class="cs-actions">' +
          '<a class="cs-act" href="' + esc(it.url) + '" target="_blank" rel="noopener">' + IC.open + '<span>Abrir</span></a>' +
          '<a class="cs-act cs-act-wa" href="https://wa.me/?text=' + encodeURIComponent(it.msg) + '" target="_blank" rel="noopener">' + IC.wa + '<span>WhatsApp</span></a>' +
          '<button type="button" class="cs-act" data-act="qr">' + IC.qr + '<span>Código QR</span></button>' +
        '</div>' +
        '<div class="cs-qr" hidden><div class="cs-qr-box"></div>' +
          '<button type="button" class="cs-act" data-act="qr-down">' + IC.down + '<span>Descargar QR</span></button></div>' +
        '</section>';
    }).join('');
    list.querySelectorAll('.cs-item').forEach(function (el, i) { el._item = items[i]; });
  }

  list.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var sec = b.closest('.cs-item'), it = sec._item;
    if (b.dataset.act === 'copy') {
      var done = function () {
        b.innerHTML = IC.ok; b.classList.add('is-ok');
        setTimeout(function () { b.innerHTML = IC.copy; b.classList.remove('is-ok'); }, 1500);
      };
      if (navigator.clipboard) navigator.clipboard.writeText(it.url).then(done, done); else done();
    } else if (b.dataset.act === 'qr') {
      var box = sec.querySelector('.cs-qr');
      box.hidden = !box.hidden;
      b.classList.toggle('is-on', !box.hidden);
      if (!box.hidden) drawQR(sec.querySelector('.cs-qr-box'), it.url);
    } else if (b.dataset.act === 'qr-down') {
      var img = sec.querySelector('.cs-qr-box img, .cs-qr-box canvas');
      if (!img) return;
      var a = document.createElement('a');
      a.href = img.tagName === 'CANVAS' ? img.toDataURL('image/png') : img.src;
      a.download = (it.key === 'agendar' ? 'qr-agendar' : 'qr-rastreo') + '.png';
      document.body.appendChild(a); a.click(); a.remove();
    }
  });

  // QR: qrcodejs se carga solo la primera vez que se pide.
  var qrLib = null;
  function loadQR() {
    if (window.QRCode) return Promise.resolve();
    if (qrLib) return qrLib;
    qrLib = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
      s.onload = res; s.onerror = function () { qrLib = null; rej(); };
      document.head.appendChild(s);
    });
    return qrLib;
  }
  function drawQR(box, url) {
    if (box.dataset.done) return;
    box.innerHTML = '<span class="cs-qr-wait"></span>';
    loadQR().then(function () {
      box.innerHTML = '';
      new window.QRCode(box, { text: url, width: 220, height: 220, colorDark: '#0f172a', colorLight: '#ffffff', correctLevel: window.QRCode.CorrectLevel.M });
      box.dataset.done = '1';
    }).catch(function () {
      box.innerHTML = '<p class="cs-intro">No se pudo generar el QR. Revisa tu conexión.</p>';
    });
  }
})();