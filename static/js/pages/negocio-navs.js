/* negocio-nav.js — menú móvil, sección activa y cerrar sesión del cliente. */
(function () {
  'use strict';
  var nb = document.getElementById('nb');
  if (!nb) return;
  var slug = nb.dataset.slug, burger = document.getElementById('nbBurger'), sheet = document.getElementById('nbSheet');
  function setOpen(on) {
    nb.classList.toggle('is-open', on);
    sheet.hidden = !on;
    burger.setAttribute('aria-expanded', on ? 'true' : 'false');
  }
  burger.addEventListener('click', function () { setOpen(sheet.hidden); });
  sheet.addEventListener('click', function (e) { if (e.target.closest('a')) setOpen(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setOpen(false); });

  document.querySelectorAll('[data-nb-salir]').forEach(function (b) {
    b.addEventListener('click', async function () {
      b.disabled = true;
      try { await fetch('/api/n/' + slug + '/salir', { method: 'POST' }); } catch (_) {}
      location.href = '/n/' + slug;
    });
  });

  // Sección visible → resaltada (solo en la página del negocio).
  var links = nb.querySelectorAll('.nb-links a[data-sec]');
  if (!('IntersectionObserver' in window) || !document.getElementById('servicios') && !document.getElementById('horario')) return;
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      links.forEach(function (a) { a.classList.toggle('is-on', a.dataset.sec === en.target.id); });
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  ['servicios', 'horario', 'ubicacion', 'contacto'].forEach(function (id) { var el = document.getElementById(id); if (el) io.observe(el); });
})();