/* bitacora.js — Bitácora del equipo (/bitacora, solo el dueño).
   API: GET /api/bitacora (lista) y /api/bitacora/personas (resumen).
   En vivo: AttomosLive topic "bitacora" + revisión cada 30 s.
   Textos: translations.js (bit_*); se vuelve a pintar al cambiar de idioma.
   Las descripciones vienen del servidor tal como se guardaron (en español). */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  if (!$('bitPage')) return;

  const LOCALES = { es: 'es-MX', en: 'en-US', ru: 'ru-RU', uz: 'uz-UZ', ja: 'ja-JP', zh: 'zh-CN', fr: 'fr-FR', pt: 'pt-BR', de: 'de-DE', ko: 'ko-KR' };
  function lang() { try { return localStorage.getItem('attomos_lang') || localStorage.getItem('lang') || 'es'; } catch (_) { return 'es'; } }
  function locale() { return LOCALES[lang()] || 'es-MX'; }
  function t(key, vars) {
    const D = (window.Translations && window.Translations.dict) || {};
    let s = (D[lang()] && D[lang()][key]) || (D.es && D.es[key]) || key;
    if (vars) Object.keys(vars).forEach((k) => { s = s.split('{' + k + '}').join(vars[k]); });
    return s;
  }
  const ROLE_KEYS = { dueno: 'bit_owner', recepcion: 'staff_role_recepcion', caja: 'bit_area_caja', optometria: 'staff_role_optometria', lab: 'staff_role_laboratorio', laboratorio: 'staff_role_laboratorio', inventario: 'staff_role_inventario' };
  // El servidor guarda al dueño como "Dueño (Negocio)": se muestra en el idioma elegido.
  const actorName = (name, staffId) => (staffId ? name : String(name || t('bit_owner')).replace(/^Dueño/, t('bit_owner')));
  const AREA_KEYS = { pos: 'staff_role_recepcion', caja: 'bit_area_caja', lab: 'staff_role_laboratorio', optometria: 'staff_role_optometria', citas: 'bit_area_citas', inventario: 'staff_role_inventario', equipo: 'dash_nav_staff', sesion: 'bit_k_session' };
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
    if (!r.ok) throw new Error(d.error || t('bit_load_err'));
    return d;
  }

  /* ---------- personas ---------- */
  function initials(name) {
    const w = String(name || '?').replace(/\(.*?\)/g, '').trim().split(/\s+/).filter(Boolean);
    return ((w[0] || '?')[0] + (w[1] ? w[1][0] : '')).toUpperCase();
  }
  function rolesText(p) {
    if (p.key === 'dueno') return t('bit_owner');
    const r = String(p.roles || '').split(',').filter(Boolean).map((x) => (ROLE_KEYS[x] ? t(ROLE_KEYS[x]) : x));
    return (r.join(' · ') || t('bit_no_role')) + (p.active === false ? ' · ' + t('bit_disabled') : '');
  }
  async function loadPeople() {
    try {
      const d = await getJSON('/api/bitacora/personas?' + baseParams());
      state.people = d.personas || [];
      const tot = d.totales || {};
      $('bitStAcc').textContent = (tot.acciones || 0).toLocaleString(locale());
      $('bitStSes').textContent = (tot.sesiones || 0).toLocaleString(locale());
      $('bitStFail').textContent = (tot.fallidas || 0).toLocaleString(locale());
      $('bitStPeople').textContent = state.people.filter((p) => (p.acciones || 0) + (p.sesiones || 0) > 0).length;
      renderPeople();
    } catch (e) {
      $('bitPeopleSub').textContent = e.message;
    }
  }
  function renderPeople() {
    const total = state.people.reduce((n, p) => n + (p.acciones || 0) + (p.sesiones || 0), 0);
    const rows = [{ key: '', name: t('bit_all'), sub: t('bit_all_sub'), n: total, all: true }].concat(
      state.people.map((p) => ({ key: p.key, name: actorName(p.name, p.staffId), sub: rolesText(p), n: (p.acciones || 0) + (p.sesiones || 0), owner: p.key === 'dueno', off: p.active === false }))
    );
    const nAcc = state.people.length - 1;
    $('bitPeopleSub').textContent = nAcc > 0 ? t(nAcc === 1 ? 'bit_accounts_one' : 'bit_accounts_many', { n: nAcc }) : t('bit_no_accounts');
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
  const fmtTime = (d) => (lang() === 'es'
    ? d.toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s?([ap])\.?\s?m\.?/i, (_, x) => ' ' + x.toLowerCase() + 'm')
    : d.toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' }));
  function dayLabel(d) {
    const t0 = startOfDay(new Date()), x = startOfDay(d);
    const diff = Math.round((t0 - x) / 86400000);
    if (diff === 0) return t('bit_today');
    if (diff === 1) return t('bit_yesterday');
    return d.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long', year: x.getFullYear() === t0.getFullYear() ? undefined : 'numeric' });
  }
  function iconKey(it) {
    if (!it.ok) return 'fail';
    if (it.kind === 'sesion') return it.action === 'sesion.cierre' ? 'salir' : 'sesion';
    return it.area;
  }
  function rowHTML(it, i, isNew) {
    const d = new Date(it.createdAt);
    const who = actorName(it.actor, it.staffId);
    const area = AREA_KEYS[it.area] ? t(AREA_KEYS[it.area]) : '';
    return `<div class="bit-row${it.ok ? '' : ' is-fail'}${isNew ? ' is-new' : ''}" style="--i:${Math.min(i, 20)}" data-id="${it.id}">
      <span class="bit-time">${esc(fmtTime(d))}</span>
      <span class="bit-ic a-${esc(it.kind === 'sesion' ? 'sesion' : it.area)}">${svg(iconKey(it))}</span>
      <div class="bit-body-txt">
        <div class="bit-desc"><b>${esc(who)}</b> — ${esc(it.description)}</div>
        <div class="bit-meta">${area ? `<span class="bit-tag">${esc(area)}</span>` : ''}${it.ok ? '' : `<span class="bit-tag fail">${esc(t('bit_failed_tag'))}</span>`}<span>${esc(d.toLocaleDateString(locale(), { day: 'numeric', month: 'short' }))}</span></div>
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
    if (!state.items.length) empty.textContent = t(state.q || state.kind || state.area || state.person ? 'bit_empty_filter' : 'bit_empty');
    $('bitMore').hidden = !state.hasMore;
    const p = state.people.find((x) => x.key === state.person);
    $('bitFeedTitle').textContent = p ? t('bit_feed_of', { name: actorName(p.name, p.staffId) }) : t('bit_feed_all');
    $('bitFeedSub').textContent = state.items.length ? t(state.items.length === 1 && !state.hasMore ? 'bit_moves_one' : 'bit_moves_many', { n: state.items.length + (state.hasMore ? '+' : '') }) : '';
  }
  async function loadList() {
    const seq = ++state.seq;
    $('bitEmpty').hidden = false;
    $('bitEmpty').textContent = t('bit_loading');
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
    btn.textContent = t('bit_loading');
    try {
      const p = listParams();
      p.set('antes_id', last.id);
      const d = await getJSON('/api/bitacora?' + p);
      state.items = state.items.concat(d.items || []);
      state.hasMore = !!d.hasMore;
      render();
    } catch (_) {}
    btn.disabled = false;
    btn.textContent = t('bit_more');
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
    $('bitLiveLabel').textContent = t(state.live ? 'bit_live' : 'bit_paused');
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

  // Cambio de idioma: repintar lo que arma este archivo.
  document.addEventListener('attomos:langchange', () => {
    paintLive();
    renderPeople();
    render();
    if (!state.items.length && $('bitEmpty').textContent) $('bitEmpty').textContent = t(state.q || state.kind || state.area || state.person ? 'bit_empty_filter' : 'bit_empty');
  });

  $('bitPeopleSub').textContent = t('bit_loading');
  $('bitFeedSub').textContent = t('bit_loading');
  $('bitEmpty').textContent = t('bit_loading');
  paintLive();
  reloadAll();
})();