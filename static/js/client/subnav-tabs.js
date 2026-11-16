/* =========================================================
   Pestañas de sección (Inventario · Punto de venta · Laboratorio)
   Cada pestaña es otra página. Para que se sienta como una sola:
   - La pastilla cian se desliza desde la pestaña de la que vienes
     hasta la nueva (se guarda dónde estaba al hacer clic).
   - El contenido entra deslizándose hacia el lado de la pestaña
     (a la derecha si avanzas, a la izquierda si regresas).
   Usa .inv-seg-glow / .has-glow de inventory.css.
   ========================================================= */
(function () {
  'use strict';
  var KEY = 'attomos.subnav';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function read() { try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
  function write(v) { try { sessionStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} }

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
    var on = nav.querySelector(':scope > a.is-on');
    var idx = links.indexOf(on);

    function rectOf(el) { return { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight }; }
    function put(r, animate) {
      if (!animate) glow.style.transition = 'none';
      glow.style.opacity = '1';
      glow.style.width = r.w + 'px';
      glow.style.height = r.h + 'px';
      glow.style.transform = 'translate(' + r.x + 'px,' + r.y + 'px)';
      if (!animate) { void glow.offsetWidth; glow.style.transition = ''; }
    }
    function place(animate) { if (on && on.offsetWidth) put(rectOf(on), animate); }

    // ¿Venimos de otra pestaña del mismo grupo? Arranca donde estaba.
    var prev = read();
    write(null);
    var fresh = prev && prev.group === group && Date.now() - prev.t < 4000 && prev.idx !== idx && prev.idx >= 0;
    if (on && fresh && !reduce) {
      var from = links[prev.idx];
      put(from ? rectOf(from) : prev.r, false);
      requestAnimationFrame(function () { requestAnimationFrame(function () { place(true); }); });
      // Asegura que la pestaña nueva se vea (en celular la barra se desliza).
      if (nav.scrollWidth > nav.clientWidth) on.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
      var page = nav.closest('main') || document.querySelector('main');
      if (page) {
        page.classList.add('subnav-enter', idx > prev.idx ? 'from-right' : 'from-left');
        setTimeout(function () { page.classList.remove('subnav-enter', 'from-right', 'from-left'); }, 700);
      }
    } else {
      place(false);
      if (on && nav.scrollWidth > nav.clientWidth) on.scrollIntoView({ block: 'nearest', inline: 'center' });
    }
    window.addEventListener('resize', function () { place(false); });
    if (window.ResizeObserver) new ResizeObserver(function () { place(false); }).observe(nav);

    // Al hacer clic: la pastilla se va hacia la pestaña y se recuerda de dónde salió.
    nav.addEventListener('click', function (e) {
      var a = e.target.closest('a');
      if (!a || a === on || e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) return;
      write({ group: group, idx: idx, r: on ? rectOf(on) : null, t: Date.now() });
      if (reduce) return;
      e.preventDefault();
      put(rectOf(a), true);
      links.forEach(function (l) { l.classList.toggle('is-on', l === a); });
      var page = nav.closest('main');
      if (page) page.classList.add('subnav-leave', links.indexOf(a) > idx ? 'to-left' : 'to-right');
      setTimeout(function () { window.location.href = a.href; }, 170);
    });
  }

  function init() { document.querySelectorAll('nav.inv-subnav').forEach(setup); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  // Al regresar con "Atrás" (página guardada en memoria), quita la salida.
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    document.querySelectorAll('main.subnav-leave').forEach(function (m) { m.classList.remove('subnav-leave', 'to-left', 'to-right'); });
    document.querySelectorAll('nav.inv-subnav').forEach(function (nav) {
      var links = nav.querySelectorAll(':scope > a');
      links.forEach(function (l) { l.classList.toggle('is-on', l.getAttribute('href') === location.pathname); });
    });
  });
})();