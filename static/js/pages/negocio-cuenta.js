/* negocio-cuenta.js — Entrar / Crear cuenta del cliente (/n/:slug/entrar,
   /n/:slug/registro). Al entrar, las citas que agendó en este navegador
   como invitado pasan a su cuenta (reclamos guardados por agendar-cita.js).
   API: handlers/business_page.go */
(function () {
  'use strict';
  var app = document.getElementById('authApp');
  if (!app) return;
  var slug = app.dataset.slug, owner = app.dataset.owner, next = app.dataset.next || 'mis-citas';
  var $ = function (id) { return document.getElementById(id); };
  var CLAIMS = 'attReclamos:' + owner;

  function claims() {
    try { return JSON.parse(localStorage.getItem(CLAIMS) || '[]').slice(-10); } catch (_) { return []; }
  }
  function clearClaims() { try { localStorage.removeItem(CLAIMS); } catch (_) {} }

  // Ojo de las contraseñas
  document.querySelectorAll('.field-toggle').forEach(function (b) {
    b.addEventListener('click', function () {
      var inp = b.parentElement.querySelector('input');
      var show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      b.setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña');
      b.style.color = show ? 'var(--blue-600)' : '';
    });
  });

  function invalid(id, on) {
    var f = $(id).closest('.field');
    f.classList.toggle('invalid', !!on);
    return !on;
  }
  document.querySelectorAll('.field input').forEach(function (i) {
    i.addEventListener('input', function () { i.closest('.field').classList.remove('invalid'); $('authError').textContent = ''; });
  });

  async function send(url, body) {
    var btn = $('authSubmit');
    btn.disabled = true;
    try {
      var r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      var d = await r.json().catch(function () { return {}; });
      if (r.ok) {
        clearClaims();
        location.href = '/n/' + slug + '/' + next;
        return;
      }
      var msg = d.error || 'Algo salió mal. Intenta de nuevo.';
      if (d.existe) {
        $('authError').innerHTML = '';
        $('authError').append(msg + ' ');
        var a = document.createElement('a');
        a.href = '/n/' + slug + '/entrar' + (next === 'agendar' ? '?sig=agendar' : '');
        a.textContent = 'Ir a iniciar sesión';
        $('authError').append(a);
      } else {
        $('authError').textContent = msg;
      }
    } catch (_) {
      $('authError').textContent = 'Sin conexión. Revisa tu internet e intenta de nuevo.';
    }
    btn.disabled = false;
  }

  /* ---------- registro ---------- */
  var reg = $('registerForm');
  if (reg) {
    var cel = $('regCelular');
    cel.addEventListener('input', function () { cel.value = cel.value.replace(/\D/g, '').slice(0, 10); });
    var nac = $('regNacimiento');
    var t = new Date();
    nac.max = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
    // Viene de agendar como invitado: sus datos ya los escribió.
    try {
      var last = JSON.parse(sessionStorage.getItem('attContacto:' + owner) || 'null');
      if (last) {
        $('regNombre').value = last.nombre || ''; $('regApellido').value = last.apellido || '';
        $('regEmail').value = last.correo || ''; cel.value = String(last.celular || '').replace(/^\+52/, '');
        nac.value = last.fechaNacimiento || '';
      }
    } catch (_) {}

    var pw = $('regPassword');
    pw.addEventListener('input', function () {
      var v = pw.value, score = 0;
      if (v.length >= 8) score++;
      if (/[a-zA-Z]/.test(v) && /\d/.test(v)) score++;
      if (v.length >= 12 || /[^a-zA-Z0-9]/.test(v)) score++;
      var colors = ['#D14343', '#f59e0b', '#16a34a'];
      $('pwStrength').querySelectorAll('span').forEach(function (s, i) { s.style.background = i < score ? colors[score - 1] : ''; });
      $('pwStrengthLabel').textContent = !v ? 'Usa al menos 8 caracteres, con letras y números.' : ['Muy corta', 'Débil', 'Buena', 'Muy segura'][score];
    });

    reg.addEventListener('submit', function (e) {
      e.preventDefault();
      var ok = true;
      ok = invalid('regNombre', $('regNombre').value.trim().length < 2) && ok;
      ok = invalid('regApellido', $('regApellido').value.trim().length < 2) && ok;
      ok = invalid('regEmail', !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test($('regEmail').value.trim())) && ok;
      ok = invalid('regCelular', !/^\d{10}$/.test(cel.value)) && ok;
      ok = invalid('regNacimiento', !nac.value || nac.value > nac.max) && ok;
      ok = invalid('regPassword', pw.value.length < 8) && ok;
      ok = invalid('regPassword2', !$('regPassword2').value || $('regPassword2').value !== pw.value) && ok;
      if (!ok) { var f = reg.querySelector('.field.invalid input'); if (f) f.focus(); return; }
      send('/api/n/' + slug + '/registro', {
        nombre: $('regNombre').value.trim(), apellido: $('regApellido').value.trim(), correo: $('regEmail').value.trim(),
        celular: cel.value, fechaNacimiento: nac.value, password: pw.value, reclamos: claims(), website: $('regWebsite').value
      });
    });
  }

  /* ---------- entrar ---------- */
  var login = $('loginForm');
  if (login) {
    login.addEventListener('submit', function (e) {
      e.preventDefault();
      var ok = invalid('loginEmail', !$('loginEmail').value.trim());
      ok = invalid('loginPassword', !$('loginPassword').value) && ok;
      if (!ok) return;
      send('/api/n/' + slug + '/entrar', { correo: $('loginEmail').value.trim(), password: $('loginPassword').value, reclamos: claims() });
    });
  }
})();