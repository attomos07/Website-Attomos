/* equipo.js — Usuarios (cuentas del equipo, ópticas). API: /api/equipo */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var ROLE_HINTS = {
    recepcion: 'Citas, punto de venta, ventas y corte de caja',
    optometria: 'Examen de la vista, historial, órdenes y garantías',
    laboratorio: 'Tablero de trabajos del laboratorio',
    inventario: 'Artículos, departamentos, ajustes y movimientos'
  };
  var state = { list: [], roles: [], filter: '', q: '', editing: null };
  var loginUrl = location.origin + '/equipo/login';

  function tr(key, fallback) {
    try {
      var lang = localStorage.getItem('attomos_lang') || localStorage.getItem('lang') || 'es';
      return (window.Translations && window.Translations.dict && window.Translations.dict[lang] && window.Translations.dict[lang][key]) || fallback;
    } catch (_) { return fallback; }
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function initials(n) {
    return (n || '?').trim().split(/\s+/).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase();
  }
  function roleLabel(k) {
    var r = state.roles.find(function (x) { return x.key === k; });
    return tr('staff_role_' + k, r ? r.label : k);
  }
  function fmtLast(iso) {
    if (!iso) return tr('staff_never', 'Nunca');
    var d = new Date(iso), now = new Date();
    var mins = Math.round((now - d) / 60000);
    if (mins < 1) return tr('staff_now', 'Ahora');
    if (mins < 60) return 'Hace ' + mins + ' min';
    var sameDay = d.toDateString() === now.toDateString();
    var hm = d.toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' });
    if (sameDay) return 'Hoy, ' + hm;
    var y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'Ayer, ' + hm;
    return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
  }
  async function api(method, url, body) {
    var res = await fetch(url, {
      method: method, credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(data.error || 'No se pudo completar. Intenta de nuevo.');
    return data;
  }

  /* ---------- modales (mismo patrón que Inventario) ---------- */
  function openModal(id) {
    var ov = $(id);
    ov.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeModal(ov) {
    ov.classList.remove('open');
    if (!document.querySelector('.admin-modal-overlay.open')) document.body.style.overflow = '';
  }
  document.addEventListener('click', function (e) {
    var close = e.target.closest('[data-close-modal]');
    if (close) { closeModal(close.closest('.admin-modal-overlay')); return; }
    if (e.target.classList && e.target.classList.contains('admin-modal-overlay') && e.target.classList.contains('open')) closeModal(e.target);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var open = document.querySelectorAll('.admin-modal-overlay.open');
    if (open.length) closeModal(open[open.length - 1]);
  });

  /* ---------- lista ---------- */
  function visible() {
    var q = state.q.toLowerCase();
    return state.list.filter(function (u) {
      if (state.filter && u.roles.indexOf(state.filter) < 0) return false;
      if (q && (u.name + ' ' + u.username).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }
  function renderStats() {
    $('eqStTotal').textContent = state.list.length;
    $('eqStActive').textContent = state.list.filter(function (u) { return u.active; }).length;
    ['recepcion', 'optometria', 'laboratorio', 'inventario'].forEach(function (k) {
      var el = $('eqSt_' + k);
      if (el) el.textContent = state.list.filter(function (u) { return u.roles.indexOf(k) >= 0; }).length;
    });
  }
  function render() {
    renderStats();
    var rows = visible();
    var body = $('eqBody');
    $('eqEmpty').hidden = state.list.length > 0;
    body.innerHTML = rows.map(function (u, i) {
      return '<tr data-id="' + u.id + '" class="' + (u.active ? '' : 'is-off') + '" style="--i:' + i + '">' +
        '<td><div class="eq-user"><span class="eq-avatar">' + esc(initials(u.name)) + '</span><div>' +
          '<div class="eq-user-name">' + esc(u.name) + '</div><div class="eq-user-login">@' + esc(u.username) + '</div></div></div></td>' +
        '<td><div class="eq-role-chips">' + u.roles.map(function (r) { return '<span class="eq-role r-' + r + '">' + esc(roleLabel(r)) + '</span>'; }).join('') + '</div></td>' +
        '<td><span class="eq-last">' + esc(fmtLast(u.lastLoginAt)) + '</span></td>' +
        '<td><span class="eq-status' + (u.active ? '' : ' is-off') + '">' + (u.active ? tr('staff_active', 'Activa') : tr('staff_inactive', 'Desactivada')) + '</span></td>' +
        '<td><button type="button" class="eq-edit" data-edit="' + u.id + '" title="Editar" aria-label="Editar">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button></td>' +
        '</tr>';
    }).join('') + (state.list.length && !rows.length
      ? '<tr><td colspan="5" class="inv-empty">' + esc(tr('staff_no_match', 'Nadie coincide con la búsqueda.')) + '</td></tr>' : '');
  }
  async function load() {
    try {
      var data = await api('GET', '/api/equipo');
      state.list = data.usuarios || [];
      state.roles = data.roles || [];
      render();
    } catch (err) {
      $('eqBody').innerHTML = '<tr><td colspan="5" class="inv-empty">' + esc(err.message) + '</td></tr>';
    }
  }

  $('eqBody').addEventListener('click', function (e) {
    var tr_ = e.target.closest('tr[data-id]');
    if (tr_) openForm(state.list.find(function (u) { return String(u.id) === tr_.dataset.id; }));
  });
  $('eqSearch').addEventListener('input', function () { state.q = this.value.trim(); render(); });
  $('eqFilter').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-role]');
    if (!b) return;
    this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('is-on', x === b); });
    state.filter = b.dataset.role;
    render();
  });

  /* ---------- alta / cambios ---------- */
  function renderRoleOptions(selected) {
    $('eqRoles').innerHTML = state.roles.map(function (r, i) {
      var on = selected.indexOf(r.key) >= 0;
      return '<label class="eq-role-opt' + (on ? ' is-on' : '') + '" style="--i:' + i + '">' +
        '<input type="checkbox" value="' + r.key + '"' + (on ? ' checked' : '') + '>' +
        '<span class="inv-check-box"></span><span><strong>' + esc(roleLabel(r.key)) + '</strong>' +
        '<small>' + esc(tr('staff_role_hint_' + r.key, ROLE_HINTS[r.key] || '')) + '</small></span></label>';
    }).join('');
  }
  $('eqRoles').addEventListener('change', function (e) {
    var opt = e.target.closest('.eq-role-opt');
    if (opt) opt.classList.toggle('is-on', e.target.checked);
  });

  function genPassword() {
    var abc = 'abcdefghjkmnpqrstuvwxyz', num = '23456789', all = abc + abc.toUpperCase() + num;
    var a = new Uint32Array(8);
    (window.crypto || window.msCrypto).getRandomValues(a);
    var out = '';
    for (var i = 0; i < 8; i++) out += all[a[i] % all.length];
    return out.slice(0, 7) + num[a[0] % num.length];
  }
  $('eqPwGen').addEventListener('click', function () {
    var pw = $('eqPw');
    pw.value = genPassword();
    pw.type = 'text';
    this.classList.remove('spin'); void this.offsetWidth; this.classList.add('spin');
  });
  $('eqPwEye').addEventListener('click', function () {
    var pw = $('eqPw');
    pw.type = pw.type === 'password' ? 'text' : 'password';
  });
  $('eqName').addEventListener('input', function () {
    // Sugiere el usuario a partir del nombre (solo en altas y si no lo han tocado)
    if (state.editing || $('eqUser').dataset.touched) return;
    var base = this.value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().split(/\s+/).filter(Boolean);
    $('eqUser').value = base.length ? (base[0] + (base[1] ? '.' + base[1] : '')).replace(/[^a-z0-9._-]/g, '').slice(0, 40) : '';
  });
  $('eqUser').addEventListener('input', function () {
    this.dataset.touched = '1';
    var v = this.value.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9._-]/g, '');
    if (v !== this.value) this.value = v;
  });

  function openForm(u) {
    state.editing = u || null;
    $('eqTitle').textContent = u ? tr('staff_edit_title', 'Editar usuario') : tr('staff_new', 'Nuevo usuario');
    $('eqName').value = u ? u.name : '';
    $('eqUser').value = u ? u.username : '';
    delete $('eqUser').dataset.touched;
    $('eqPw').value = '';
    $('eqPw').type = 'password';
    $('eqPw').placeholder = u ? tr('staff_pw_keep', 'Déjala vacía para no cambiarla') : tr('staff_pw_min', 'Mínimo 6 caracteres');
    $('eqPwHint').textContent = u ? tr('staff_pw_optional', '(opcional)') : '';
    $('eqActive').checked = u ? u.active : true;
    $('eqActiveWrap').hidden = !u;
    $('eqDelete').hidden = !u;
    $('eqError').textContent = '';
    renderRoleOptions(u ? u.roles : []);
    openModal('eqModal');
    setTimeout(function () { $('eqName').focus(); }, 200);
  }
  $('eqNew').addEventListener('click', function () { openForm(null); });
  $('eqEmptyNew').addEventListener('click', function () { openForm(null); });

  $('eqForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var u = state.editing;
    var body = {
      name: $('eqName').value.trim(),
      username: $('eqUser').value.trim(),
      password: $('eqPw').value,
      roles: [].map.call($('eqRoles').querySelectorAll('input:checked'), function (i) { return i.value; }),
      active: $('eqActive').checked
    };
    var err = !body.name ? tr('staff_err_name', 'Escribe su nombre.')
      : !/^[a-z0-9][a-z0-9._-]{2,39}$/.test(body.username) ? tr('staff_err_user', 'El usuario debe tener de 3 a 40 letras o números, sin espacios.')
      : (!u && body.password.length < 6) || (u && body.password && body.password.length < 6) ? tr('staff_err_pw', 'La contraseña debe tener al menos 6 caracteres.')
      : !body.roles.length ? tr('staff_err_roles', 'Elige al menos un rol.') : '';
    if (err) { $('eqError').textContent = err; return; }
    var btn = $('eqSave');
    btn.disabled = true;
    $('eqError').textContent = '';
    try {
      await api(u ? 'PUT' : 'POST', u ? '/api/equipo/' + u.id : '/api/equipo', body);
      closeModal($('eqModal'));
      await load();
      if (!u || body.password) showDone(body.username, body.password);
    } catch (ex) {
      $('eqError').textContent = ex.message;
    } finally {
      btn.disabled = false;
    }
  });

  function showDone(user, pw) {
    $('eqDoneUrl').textContent = loginUrl.replace(/^https?:\/\//, '');
    $('eqDoneUser').textContent = user;
    $('eqDonePw').textContent = pw;
    openModal('eqDoneModal');
  }
  function copy(text, btn) {
    var done = function () {
      var old = btn.textContent;
      btn.textContent = tr('staff_copied', '¡Copiado!');
      setTimeout(function () { btn.textContent = old; }, 1400);
    };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, done);
    else done();
  }
  $('eqDoneCopy').addEventListener('click', function () {
    copy('Entra en: ' + loginUrl + '\nUsuario: ' + $('eqDoneUser').textContent + '\nContraseña: ' + $('eqDonePw').textContent, this);
  });
  $('eqLoginUrl').textContent = loginUrl.replace(/^https?:\/\//, '');
  $('eqCopy').addEventListener('click', function () { copy(loginUrl, this); });

  /* ---------- baja ---------- */
  $('eqDelete').addEventListener('click', function () {
    var u = state.editing;
    if (!u) return;
    $('eqDelText').innerHTML = '¿Eliminar la cuenta de <strong>' + esc(u.name) + '</strong> (@' + esc(u.username) + ')? Ya no podrá entrar. Lo que hizo (ventas, exámenes, pasos del laboratorio) se queda con su nombre.';
    $('eqDelError').textContent = '';
    openModal('eqDelModal');
  });
  $('eqDelOk').addEventListener('click', async function () {
    var u = state.editing;
    if (!u) return;
    this.disabled = true;
    try {
      await api('DELETE', '/api/equipo/' + u.id);
      closeModal($('eqDelModal'));
      closeModal($('eqModal'));
      state.editing = null;
      await load();
    } catch (ex) {
      $('eqDelError').textContent = ex.message;
    } finally {
      this.disabled = false;
    }
  });

  load();
})();