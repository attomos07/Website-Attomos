/* =========================================================
   OPTOMETRÍA → Orden de laboratorio: "Ventas por hacer orden"
   Portado de Avante. Lo que se vendió en Recepción (Punto de venta),
   con su ticket digital. Desde aquí se hace la orden de laboratorio de
   esa venta; al guardarla, el trabajo le llega solo al Laboratorio.
     GET  /api/optometria/ventas-pendientes
     POST /api/optometria/ventas-pendientes/:id/sin-orden
   Se recarga al mostrarse la pestaña y cada minuto mientras se ve.
   ========================================================= */
(function () {
  'use strict';
  var panel = document.getElementById('vpPanel');
  if (!panel || panel._booted) return;
  panel._booted = true;
  var ROOT = panel.closest('main') || panel;
  var listEl = document.getElementById('vpList');
  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var mxn = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function cuando(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    var hoy = new Date(), ayer = new Date(); ayer.setDate(hoy.getDate() - 1);
    var h = d.toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' });
    if (d.toDateString() === hoy.toDateString()) return 'Hoy · ' + h;
    if (d.toDateString() === ayer.toDateString()) return 'Ayer · ' + h;
    return d.getDate() + ' ' + MESES[d.getMonth()] + ' · ' + h;
  }
  function publico(n) { return /p[uú]blico en general/i.test(n || ''); }

  var last = '';
  function render(list) {
    var key = JSON.stringify(list);
    if (key === last) return; // sin cambios: no se vuelve a dibujar (ni se repite la animación)
    last = key;
    panel.hidden = !list.length;
    document.getElementById('vpCount').textContent = list.length;
    listEl.innerHTML = list.map(function (v, i) {
      var q = new URLSearchParams({ doc: 'laboratorio', pedido: v.pedidoId });
      if (!publico(v.cliente)) { q.set('nombre', v.cliente); if (v.celular) q.set('telefono', v.celular); }
      return '<article class="vp-item" style="--i:' + Math.min(i, 10) + '">' +
        '<div class="vp-main">' +
          '<div class="vp-top"><strong>Ticket ' + v.folio + '</strong>' + (v.code ? '<span class="vp-code">' + esc(v.code) + '</span>' : '') + '<span class="vp-when">' + cuando(v.fecha) + '</span></div>' +
          '<div class="vp-client">' + esc(v.cliente || 'Público en general') + (v.celular ? ' <small>' + esc(v.celular) + '</small>' : '') + '</div>' +
          '<div class="vp-prods">' + (v.productos || []).map(esc).join(' · ') + '</div>' +
          '<div class="vp-meta">' + mxn.format(v.total || 0) + (v.cajero ? ' · vendió ' + esc(v.cajero) : '') + '</div>' +
        '</div>' +
        '<div class="vp-actions">' +
          '<button type="button" class="btn small" data-ticket="' + esc(v.ticketPath) + '" data-folio="' + v.folio + '">Ver ticket</button>' +
          '<a class="btn small solid" href="/optometria/nuevo?' + q.toString() + '">Hacer orden de laboratorio</a>' +
          '<button type="button" class="vp-skip" data-skip="' + v.pedidoId + '" title="Esta venta no necesita orden: el trabajo pasa al laboratorio sin hoja">No lleva orden</button>' +
        '</div>' +
      '</article>';
    }).join('');
  }

  function load() {
    return fetch('/api/optometria/ventas-pendientes', { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
      .then(function (d) { render(d.ventas || []); })
      .catch(function () {});
  }
  load();
  setInterval(function () { if (ROOT.offsetParent) load(); }, 60000);
  ROOT.addEventListener('subnav:show', load);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && ROOT.offsetParent) load(); });

  var ov = document.getElementById('vpTicketOv'), frame = document.getElementById('vpTicketFrame');
  // Cierra con animación (la tarjeta baja y se desvanece).
  function closeTicket() {
    if (!ov || ov.hidden || ov.classList.contains('is-closing')) return;
    ov.classList.add('is-closing');
    setTimeout(function () { ov.hidden = true; ov.classList.remove('is-closing'); frame.src = 'about:blank'; document.body.style.overflow = ''; }, 220);
  }
  if (ov) {
    document.getElementById('vpTicketClose').addEventListener('click', closeTicket);
    ov.addEventListener('click', function (e) { if (e.target === ov) closeTicket(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !ov.hidden) closeTicket(); });
  }

  listEl.addEventListener('click', function (e) {
    var t = e.target.closest('[data-ticket]');
    if (t && ov) {
      document.getElementById('vpTicketTitle').textContent = 'Ticket ' + t.dataset.folio;
      frame.src = t.dataset.ticket;
      ov.hidden = false;
      document.body.style.overflow = 'hidden';
      return;
    }
    var sk = e.target.closest('[data-skip]');
    if (!sk) return;
    // Primer toque: pide confirmar ahí mismo; el segundo (en 4 s) lo guarda.
    if (!sk.classList.contains('is-confirm')) {
      sk.classList.add('is-confirm');
      sk.dataset.txt = sk.textContent;
      sk.textContent = '¿Seguro? Toca otra vez';
      clearTimeout(sk._t);
      sk._t = setTimeout(function () { sk.classList.remove('is-confirm'); sk.textContent = sk.dataset.txt; }, 4000);
      return;
    }
    clearTimeout(sk._t);
    sk.disabled = true;
    var item = sk.closest('.vp-item');
    fetch('/api/optometria/ventas-pendientes/' + sk.dataset.skip + '/sin-orden', { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error(); })
      .then(function () {
        if (item) item.classList.add('is-leaving');
        setTimeout(load, 260);
      })
      .catch(function () {
        sk.disabled = false;
        sk.classList.remove('is-confirm');
        sk.textContent = 'No se pudo guardar · reintentar';
      });
  });
})();
