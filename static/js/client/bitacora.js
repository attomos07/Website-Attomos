/* bitacora.js — Bitácora del equipo (/bitacora, solo el dueño).
   API: GET /api/bitacora (lista) y /api/bitacora/personas (resumen).
   En vivo: AttomosLive topic "bitacora" + revisión cada 30 s. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  if (!$('bitPage')) return;

  const ROLE_LABELS = { dueno: 'Dueño', recepcion: 'Recepción', caja: 'Caja', optometria: 'Optometría', lab: 'Laboratorio', laboratorio: 'Laboratorio', inventario: 'Inventario' };
  const AREA_LABELS = { pos: 'Recepción', caja: 'Caja', lab: 'Laboratorio', optometria: 'Optometría', citas: 'Citas', inventario: 'Inventario', equipo: 'Usuarios', sesion: 'Sesión' };
  const ICONS = {
    pos: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0"/>',
    caja: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
    lab: '<path d="M9 3h6M10 3v6L4 19a2 2 0 0 0 1.7 3h12.6A2 2 0 0 0 20 19L14 9V3"/><path d="M7 15h10"/>',
    optometria: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    citas: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    inventario: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
    equipo: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    sesion: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5M15 12H3"/>',
    salir: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
    fail: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>',
  };
  const svg = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[k] || ICONS.equipo}</svg>`;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const state = { period: 'hoy', from: null, to: null, person: '', kind: '', area: '', q: '', items: [], hasMore: false, people: [], live: true, loading: false, seq: 0 };
  try { if (localStorage.getItem('bitLive') === '0') state.live = false; } catch (_) {}

  /* ---------- periodo ---------- */
  function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function range() {
    const today = startOfDay(new Date());
    const add = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
    switch (state.period) {
      case 'ayer': return [add(today, -1), today];
      case '7': return [add(today, -6), null];
      case '30': return [add(today, -29), null];
      case 'rango': return [state.from, state.to ? add(state.to, 1) : null];
      default: return [today, null];
    }
  }
  function baseParams() {
    const p = new URLSearchParams();
    const [from, to] = range();
    if (from) p.set('desde', from.toISOString());
    if (to) p.set('hasta', to.toISOString());
    return p;
  }
  function listParams() {
    const p = baseParams();
    if (state.person) p.set('persona', state.person);
    if (state.kind) p.set('tipo', state.kind);
    if (state.area) p.set('area', state.area);
    if (state.q) p.set('q', state.q);
    return p;
  }

  async function getJSON(url) {
    const r = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'No se pudo cargar.');
    return d;
  }

  /* ---------- personas ---------- */
  function initials(name) {
    const w = String(name || '?').replace(/\(.*?\)/g, '').trim().split(/\s+/).filter(Boolean);
    return ((w[0] || '?')[0] + (w[1] ? w[1][0] : '')).toUpperCase();
  }
  function rolesText(p) {
    if (p.key === 'dueno') return 'Dueño';
    const r = String(p.roles || '').split(',').filter(Boolean).map((x) => ROLE_LABELS[x] || x);
    return (r.join(' · ') || 'Sin rol') + (p.active === false ? ' · Desactivado' : '');
  }
  async function loadPeople() {
    try {
      const d = await getJSON('/api/bitacora/personas?' + baseParams());
      state.people = d.personas || [];
      const t = d.totales || {};
      $('bitStAcc').textContent = (t.acciones || 0).toLocaleString('es-MX');
      $('bitStSes').textContent = (t.sesiones || 0).toLocaleString('es-MX');
      $('bitStFail').textContent = (t.fallidas || 0).toLocaleString('es-MX');
      $('bitStPeople').textContent = state.people.filter((p) => (p.acciones || 0) + (p.sesiones || 0) > 0).length;
      renderPeople();
    } catch (e) {
      $('bitPeopleSub').textContent = e.message;
    }
  }
  function renderPeople() {
    const total = state.people.reduce((n, p) => n + (p.acciones || 0) + (p.sesiones || 0), 0);
    const rows = [{ key: '', name: 'Todos', sub: 'Todo el equipo y tú', n: total, all: true }].concat(
      state.people.map((p) => ({ key: p.key, name: p.name, sub: rolesText(p), n: (p.acciones || 0) + (p.sesiones || 0), owner: p.key === 'dueno', off: p.active === false }))
    );
    $('bitPeopleSub').textContent = state.people.length - 1 > 0 ? `${state.people.length - 1} cuenta${state.people.length - 1 === 1 ? '' : 's'} del equipo` : 'Aún no tienes cuentas del equipo';
    $('bitPeople').innerHTML = rows.map((r, i) => `
      <button type="button" role="listitem" class="bit-person${r.key === state.person ? ' is-on' : ''}${r.off ? ' is-off' : ''}" data-key="${esc(r.key)}" style="--i:${i}">
        <span class="bit-ava${r.owner ? ' is-owner' : ''}${r.all ? ' is-all' : ''}">${r.all ? svg('equipo') : esc(initials(r.name))}</span>
        <span class="bit-person-txt"><b>${esc(r.name)}</b><small>${esc(r.sub)}</small></span>
        <span class="bit-count${r.n ? '' : ' zero'}">${r.n}</span>
      </button>`).join('');
  }
  $('bitPeople').addEventListener('click', (e) => {
    const b = e.target.closest('.bit-person');
    if (!b) return;
    state.person = b.dataset.key || '';
    renderPeople();
    loadList();
  });

  /* ---------- lista ---------- */
  const fmtTime = (d) => d.toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s?([ap])\.?\s?m\.?/i, (_, x) => ' ' + x.toLowerCase() + 'm');
  function dayLabel(d) {
    const t = startOfDay(new Date()), x = startOfDay(d);
    const diff = Math.round((t - x) / 86400000);
    if (diff === 0) return 'Hoy';
    if (diff === 1) return 'Ayer';
    return d.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: x.getFullYear() === t.getFullYear() ? undefined : 'numeric' });
  }
  function iconKey(it) {
    if (!it.ok) return 'fail';
    if (it.kind === 'sesion') return it.action === 'sesion.cierre' ? 'salir' : 'sesion';
    return it.area;
  }
  function rowHTML(it, i, isNew) {
    const d = new Date(it.createdAt);
    const who = it.staffId ? it.actor : (it.actor || 'Dueño');
    const area = AREA_LABELS[it.area] || '';
    return `<div class="bit-row${it.ok ? '' : ' is-fail'}${isNew ? ' is-new' : ''}" style="--i:${Math.min(i, 20)}" data-id="${it.id}">
      <span class="bit-time">${esc(fmtTime(d))}</span>
      <span class="bit-ic a-${esc(it.kind === 'sesion' ? 'sesion' : it.area)}">${svg(iconKey(it))}</span>
      <div class="bit-body-txt">
        <div class="bit-desc"><b>${esc(who)}</b> — ${esc(it.description)}</div>
        <div class="bit-meta">${area ? `<span class="bit-tag">${esc(area)}</span>` : ''}${it.ok ? '' : '<span class="bit-tag fail">No se pudo</span>'}<span>${esc(d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }))}</span></div>
      </div>
    </div>`;
  }
  function render(newIds) {
    const tl = $('bitTimeline');
    let html = '', lastDay = '';
    state.items.forEach((it, i) => {
      const lbl = dayLabel(new Date(it.createdAt));
      if (lbl !== lastDay) { html += `<div class="bit-day">${esc(lbl)}</div>`; lastDay = lbl; }
      html += rowHTML(it, i, newIds && newIds.has(it.id));
    });
    tl.innerHTML = html;
    const empty = $('bitEmpty');
    empty.hidden = state.items.length > 0;
    if (!state.items.length) empty.textContent = state.q || state.kind || state.area || state.person ? 'Nada coincide con estos filtros.' : 'Sin movimientos en este periodo.';
    $('bitMore').hidden = !state.hasMore;
    const p = state.people.find((x) => x.key === state.person);
    $('bitFeedTitle').textContent = p ? 'Actividad de ' + p.name : 'Actividad de todos';
    $('bitFeedSub').textContent = state.items.length ? `${state.items.length}${state.hasMore ? '+' : ''} movimiento${state.items.length === 1 ? '' : 's'}` : '';
  }
  async function loadList() {
    const seq = ++state.seq;
    $('bitEmpty').hidden = false;
    $('bitEmpty').textContent = 'Cargando…';
    $('bitTimeline').innerHTML = '';
    $('bitMore').hidden = true;
    try {
      const d = await getJSON('/api/bitacora?' + listParams());
      if (seq !== state.seq) return;
      state.items = d.items || [];
      state.hasMore = !!d.hasMore;
      render();
    } catch (e) {
      if (seq !== state.seq) return;
      $('bitEmpty').textContent = e.message;
    }
  }
  $('bitMore').addEventListener('click', async () => {
    const last = state.items[state.items.length - 1];
    if (!last) return;
    const btn = $('bitMore');
    btn.disabled = true;
    btn.textContent = 'Cargando…';
    try {
      const p = listParams();
      p.set('antes_id', last.id);
      const d = await getJSON('/api/bitacora?' + p);
      state.items = state.items.concat(d.items || []);
      state.hasMore = !!d.hasMore;
      render();
    } catch (_) {}
    btn.disabled = false;
    btn.textContent = 'Cargar más';
  });

  /* ---------- en vivo ---------- */
  async function pullNew() {
    if (!state.live || state.loading || document.hidden) return;
    const [, to] = range();
    if (to && to < new Date()) return; // periodo cerrado (ayer, rango pasado)
    const top = state.items[0];
    state.loading = true;
    try {
      const p = listParams();
      if (top) p.set('despues_id', top.id);
      p.set('limit', '100');
      const d = await getJSON('/api/bitacora?' + p);
      const fresh = (d.items || []).filter((x) => !state.items.some((y) => y.id === x.id));
      if (fresh.length) {
        state.items = fresh.concat(state.items);
        render(new Set(fresh.map((x) => x.id)));
        loadPeople();
      }
    } catch (_) {}
    state.loading = false;
  }
  function paintLive() {
    const b = $('bitLive');
    b.classList.toggle('is-on', state.live);
    b.setAttribute('aria-pressed', state.live ? 'true' : 'false');
    $('bitLiveLabel').textContent = state.live ? 'En vivo' : 'En pausa';
  }
  $('bitLive').addEventListener('click', () => {
    state.live = !state.live;
    try { localStorage.setItem('bitLive', state.live ? '1' : '0'); } catch (_) {}
    paintLive();
    if (state.live) pullNew();
  });
  if (window.AttomosLive) window.AttomosLive.on(['bitacora'], pullNew);
  setInterval(pullNew, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pullNew(); });

  /* ---------- filtros ---------- */
  function chips(id, attr, onPick) {
    $(id).addEventListener('click', (e) => {
      const b = e.target.closest('button[data-' + attr + ']');
      if (!b) return;
      $(id).querySelectorAll('button').forEach((x) => x.classList.toggle('is-on', x === b));
      onPick(b.dataset[attr]);
    });
  }
  function reloadAll() { loadPeople(); loadList(); }
  chips('bitPeriod', 'period', (v) => {
    state.period = v;
    $('bitRange').hidden = v !== 'rango';
    if (v === 'rango') {
      if (!$('bitFrom').value) {
        const t = new Date(), f = new Date();
        f.setDate(f.getDate() - 6);
        const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        $('bitFrom').value = iso(f);
        $('bitTo').value = iso(t);
      }
      applyRange();
      return;
    }
    reloadAll();
  });
  function parseDay(v) { if (!v) return null; const [y, m, d] = v.split('-').map(Number); return new Date(y, m - 1, d); }
  function applyRange() {
    let f = parseDay($('bitFrom').value), t = parseDay($('bitTo').value);
    if (f && t && f > t) { const x = f; f = t; t = x; }
    state.from = f;
    state.to = t;
    reloadAll();
  }
  $('bitRangeApply').addEventListener('click', applyRange);
  chips('bitKinds', 'kind', (v) => { state.kind = v; loadList(); });
  chips('bitAreas', 'area', (v) => { state.area = v; loadList(); });
  let qT = 0;
  $('bitSearch').addEventListener('input', (e) => {
    clearTimeout(qT);
    qT = setTimeout(() => { state.q = e.target.value.trim(); loadList(); }, 280);
  });

  paintLive();
  reloadAll();
})();