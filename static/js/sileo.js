/* ════════════════════════════════════════════════════════════════
   CONSTANTS  (src/constants.ts)
════════════════════════════════════════════════════════════════ */
const HEIGHT            = 40;
const WIDTH             = 350;
const ROUNDNESS         = 18;
const BLUR_RATIO        = 0.5;
const PILL_PADDING      = 10;
const MIN_EXPAND_RATIO  = 2.25;
const DURATION_MS       = 600;
const DURATION_S        = DURATION_MS / 1000;
const DEFAULT_DURATION  = 6000;
const EXIT_DURATION     = DEFAULT_DURATION * 0.1;
const AUTO_EXPAND_DLY   = DEFAULT_DURATION * 0.025;
const AUTO_COLLAPSE_DLY = DEFAULT_DURATION - 2000;
const SWAP_COLLAPSE_MS  = 200;
const HEADER_EXIT_MS    = DURATION_MS * 0.7;
const SWIPE_DISMISS     = 30;
const SWIPE_MAX         = 20;

/* Spring config */
const SPRING           = { type: 'spring', bounce: 0.25, duration: DURATION_S };
const SPRING_NO_BOUNCE = { type: 'spring', bounce: 0,    duration: DURATION_S };

/* Motion API — resolved lazily so CDN is guaranteed loaded */
function getAnimate() {
  if (typeof Motion !== 'undefined' && Motion.animate) return Motion.animate;
  throw new Error('Motion library not loaded');
}

/* ════════════════════════════════════════════════════════════════
   SVG ICONS
════════════════════════════════════════════════════════════════ */
const ICONS = {
  success: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`,
  error:   `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
  warning: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>`,
  info:    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m4.93 4.93 4.24 4.24"/><path d="m14.83 9.17 4.24-4.24"/><path d="m14.83 14.83 4.24 4.24"/><path d="m9.17 14.83-4.24 4.24"/><circle cx="12" cy="12" r="4"/></svg>`,
  action:  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>`,
  loading: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`,
};

/* ════════════════════════════════════════════════════════════════
   GLOBAL STORE
════════════════════════════════════════════════════════════════ */
let idCounter = 0;
const genId = () => `${++idCounter}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;

const store = {
  toasts: [],
  listeners: new Set(),
  emit()       { this.listeners.forEach(fn => fn([...this.toasts])); },
  update(fn)   { this.toasts = fn(this.toasts); this.emit(); }
};

/* ════════════════════════════════════════════════════════════════
   TOAST OPERATIONS
════════════════════════════════════════════════════════════════ */
function createToast(opts) {
  const id  = opts.id || 'sileo-default';
  const dur = (opts.duration !== undefined) ? opts.duration : DEFAULT_DURATION;
  const auto = (opts.autopilot !== false && dur)
    ? { expandDelayMs: Math.min(dur, AUTO_EXPAND_DLY), collapseDelayMs: Math.min(dur, AUTO_COLLAPSE_DLY) }
    : {};

  const item = {
    fill: '#ffffff',  /* PATCHED: light fill for white theme */
    ...opts,
    id,
    instanceId: genId(),
    duration: dur,
    autoExpandDelayMs:   auto.expandDelayMs,
    autoCollapseDelayMs: auto.collapseDelayMs,
  };

  const prev = store.toasts.find(t => t.id === id && !t.exiting);
  if (prev) {
    store.update(p => p.map(t => t.id === id ? item : t));
  } else {
    store.update(p => [...p.filter(t => t.id !== id), item]);
  }
  return { id, duration: dur };
}

function updateToast(id, opts) {
  const ex = store.toasts.find(t => t.id === id);
  if (!ex) return;
  const dur = (opts.duration !== undefined) ? opts.duration : DEFAULT_DURATION;
  const auto = (opts.autopilot !== false && dur)
    ? { expandDelayMs: Math.min(dur, AUTO_EXPAND_DLY), collapseDelayMs: Math.min(dur, AUTO_COLLAPSE_DLY) }
    : {};
  const item = {
    fill: '#ffffff',  /* PATCHED: light fill */
    ...ex, ...opts, id,
    instanceId: genId(),
    duration: dur,
    autoExpandDelayMs:   auto.expandDelayMs,
    autoCollapseDelayMs: auto.collapseDelayMs,
  };
  store.update(p => p.map(t => t.id === id ? item : t));
}

function dismissToast(id) {
  const item = store.toasts.find(t => t.id === id);
  if (!item || item.exiting) return;
  store.update(p => p.map(t => t.id === id ? { ...t, exiting: true } : t));
  setTimeout(() => store.update(p => p.filter(t => t.id !== id)), EXIT_DURATION);
}

/* ════════════════════════════════════════════════════════════════
   PUBLIC API
════════════════════════════════════════════════════════════════ */
const Sileo = {
  show:    o => createToast(o).id,
  success: o => createToast({ ...o, state: 'success' }).id,
  error:   o => createToast({ ...o, state: 'error'   }).id,
  warning: o => createToast({ ...o, state: 'warning' }).id,
  info:    o => createToast({ ...o, state: 'info'    }).id,
  action:  o => createToast({ ...o, state: 'action'  }).id,
  dismiss: dismissToast,

  promise(promise, opts) {
    const { id } = createToast({ ...opts.loading, state: 'loading', duration: null });
    const p = typeof promise === 'function' ? promise() : promise;
    p.then(data => {
      const s = typeof opts.success === 'function' ? opts.success(data) : opts.success;
      updateToast(id, { ...s, state: 'success', id });
    }).catch(err => {
      const e = typeof opts.error === 'function' ? opts.error(err) : opts.error;
      updateToast(id, { ...e, state: 'error', id });
    });
    return p;
  }
};

/* ════════════════════════════════════════════════════════════════
   RENDERER — initialized after DOM is ready
════════════════════════════════════════════════════════════════ */
let vp;
const instances = new Map();
let hovered = false;
let activeId;
const dismissTimers = new Map();

function initRenderer() {
  vp = document.getElementById('sileo-vp');

  store.listeners.add(toasts => {
    let latestId;
    for (let i = toasts.length - 1; i >= 0; i--) {
      if (!toasts[i].exiting) { latestId = toasts[i].id; break; }
    }
    if (!activeId || !toasts.find(t => t.id === activeId && !t.exiting)) {
      activeId = latestId;
    }

    for (const [id, inst] of instances) {
      if (!toasts.find(t => t.id === id)) {
        inst.el.remove();
        clearInstTimers(inst);
        instances.delete(id);
      }
    }

    toasts.forEach(item => {
      if (!instances.has(item.id)) buildDom(item);
      syncDom(item, latestId);
    });
  });

  store.listeners.add(toasts => {
    toasts.forEach(item => {
      if (!item.exiting && !dismissTimers.has(item.id)) {
        const inst = instances.get(item.id);
        if (inst && inst.applied === item.instanceId) scheduleDismiss(item);
      }
    });
  });
}

/* ────────────────────────────────────────────────────────────────
   BUILD DOM
──────────────────────────────────────────────────────────────── */
function buildDom(item) {
  const blur     = ROUNDNESS * BLUR_RATIO;
  const filterId = `gooey-${item.id}`;
  const fill     = item.fill || '#ffffff';  /* PATCHED: light default */

  const el = document.createElement('div');
  el.className = 'sileo-toast';
  el.setAttribute('data-state', item.state || 'success');
  el.setAttribute('role', 'status');

  el.innerHTML = `
    <div class="sileo-canvas">
      <svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" style="overflow:visible">
        <defs>
          <filter id="${filterId}" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
            <feGaussianBlur in="SourceGraphic" stdDeviation="${blur}" result="blur"/>
            <feColorMatrix in="blur" mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -10" result="goo"/>
            <feComposite in="SourceGraphic" in2="goo" operator="atop"/>
          </filter>
          <filter id="${filterId}-border" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
            <feGaussianBlur in="SourceGraphic" stdDeviation="${blur}" result="blur"/>
            <feColorMatrix in="blur" mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -10" result="goo"/>
            <feComposite in="SourceGraphic" in2="goo" operator="atop" result="merged"/>
            <feMorphology in="merged" operator="dilate" radius="2" result="thick"/>
            <feComposite in="thick" in2="merged" operator="out" result="ring"/>
            <feFlood class="border-flood" flood-color="white" flood-opacity="1" result="color"/>
            <feComposite in="color" in2="ring" operator="in"/>
          </filter>
        </defs>
        <g class="border-group" style="filter:url(#${filterId}-border); pointer-events:none">
          <rect class="pill-border"
            x="0" y="0"
            width="${HEIGHT}" height="${HEIGHT}"
            rx="${ROUNDNESS}" ry="${ROUNDNESS}"
            fill="white" stroke-width="0"/>
          <rect class="body-border"
            x="0" y="${HEIGHT}"
            width="${WIDTH}" height="0"
            rx="${ROUNDNESS}" ry="${ROUNDNESS}"
            fill="white" stroke-width="0" opacity="0"/>
        </g>
        <g style="filter:url(#${filterId})">
          <rect class="pill"
            x="0" y="0"
            width="${HEIGHT}" height="${HEIGHT}"
            rx="${ROUNDNESS}" ry="${ROUNDNESS}"
            fill="${fill}"/>
          <rect class="body"
            x="0" y="${HEIGHT}"
            width="${WIDTH}" height="0"
            rx="${ROUNDNESS}" ry="${ROUNDNESS}"
            fill="${fill}"
            opacity="0"/>
        </g>
      </svg>
    </div>

    <div class="sileo-header">
      <div class="sileo-header-stack">
        <div class="sileo-header-inner current" data-hkey="">
          <div class="sileo-badge c-${item.state||'success'}"></div>
          <span class="sileo-title c-${item.state||'success'}"></span>
        </div>
      </div>
    </div>

    <div class="sileo-content">
      <div class="sileo-description"></div>
    </div>
  `;

  vp.appendChild(el);

  /* Set initial border flood color */
  const _stateColors = {
    success: 'oklch(0.723 0.219 142.136)',
    error:   'oklch(0.637 0.237 25.331)',
    warning: 'oklch(0.795 0.184 86.047)',
    info:    'oklch(0.685 0.169 237.323)',
    action:  'oklch(0.623 0.214 259.815)',
    loading: 'oklch(0.556 0 0)',
  };
  const _flood = el.querySelector('.border-flood');
  if (_flood) _flood.setAttribute('flood-color', _stateColors[item.state||'success'] || _stateColors.success);

  const inst = {
    el, filterId, fill,
    pillWidth: 0,
    contentHeight: 0,
    open: false,
    pointerStart: null,
    applied: item.instanceId,
    view: { ...item },
    pendingView: null,
    timers: { expand: null, collapse: null, swap: null, header: null },
    pillAnim: null,
    bodyAnim: null,
  };
  instances.set(item.id, inst);

  applyHeader(inst, item.state || 'success', item.title || item.state || 'success', item.icon);
  applyDescription(inst, item);
  measurePill(inst);

  el.addEventListener('mouseenter', () => {
    if (!hovered) { hovered = true; pauseAll(); }
    activeId = item.id;
    if (inst.view.state !== 'loading' && inst.contentHeight > 0) expand(inst);
  });
  el.addEventListener('mouseleave', () => {
    if (hovered) { hovered = false; resumeAll(); }
    collapse(inst);
  });

  el.addEventListener('pointerdown', e => onPointerDown(e, item.id, inst));

  requestAnimationFrame(() => {
    el.classList.add('ready');
    requestAnimationFrame(() => measurePill(inst));
  });
}

/* ────────────────────────────────────────────────────────────────
   SYNC DOM
──────────────────────────────────────────────────────────────── */
function syncDom(item, latestId) {
  const inst = instances.get(item.id);
  if (!inst) return;
  const el = inst.el;

  if (item.exiting && !el.classList.contains('exiting')) {
    collapse(inst);
    clearInstTimers(inst);
    requestAnimationFrame(() => el.classList.add('exiting'));
    return;
  }

  if (inst.applied !== item.instanceId) {
    if (inst.open) {
      inst.pendingView = item;
      collapse(inst);
      clearTimeout(inst.timers.swap);
      inst.timers.swap = setTimeout(() => {
        if (!inst.pendingView) return;
        applyView(inst, inst.pendingView);
        inst.pendingView = null;
        inst.applied = item.instanceId;
        setupAutopilot(inst);
        scheduleDismiss(item);
      }, SWAP_COLLAPSE_MS);
    } else {
      applyView(inst, item);
      inst.applied = item.instanceId;
      setupAutopilot(inst);
      scheduleDismiss(item);
    }
  }

  const canExpand = !activeId || activeId === item.id;
  if (!canExpand) collapse(inst);
}

/* ────────────────────────────────────────────────────────────────
   APPLY VIEW
──────────────────────────────────────────────────────────────── */
function applyView(inst, item) {
  const state = item.state || 'success';
  const fill  = item.fill  || '#ffffff';  /* PATCHED: light default */
  inst.view = { ...item };
  inst.fill = fill;
  inst.el.setAttribute('data-state', state);

  inst.el.querySelector('.pill').setAttribute('fill', fill);
  inst.el.querySelector('.body').setAttribute('fill', fill);

  /* Update border flood color to match state */
  const stateColors = {
    success: 'oklch(0.723 0.219 142.136)',
    error:   'oklch(0.637 0.237 25.331)',
    warning: 'oklch(0.795 0.184 86.047)',
    info:    'oklch(0.685 0.169 237.323)',
    action:  'oklch(0.623 0.214 259.815)',
    loading: 'oklch(0.556 0 0)',
  };
  const flood = inst.el.querySelector('.border-flood');
  if (flood) flood.setAttribute('flood-color', stateColors[state] || stateColors.success);

  applyHeader(inst, state, item.title || state, item.icon);
  applyDescription(inst, item);

  requestAnimationFrame(() => {
    measurePill(inst);
    measureContent(inst);
  });
}

/* ────────────────────────────────────────────────────────────────
   HEADER MORPH
──────────────────────────────────────────────────────────────── */
function applyHeader(inst, state, title, icon) {
  const stack   = inst.el.querySelector('.sileo-header-stack');
  const current = stack.querySelector('.current');
  const hkey    = `${state}::${title}`;

  if (current && current.dataset.hkey === hkey) {
    current.querySelector('.sileo-badge').className = `sileo-badge c-${state}`;
    current.querySelector('.sileo-badge').innerHTML = icon !== undefined ? (icon||'') : ICONS[state]||'';
    current.querySelector('.sileo-title').className = `sileo-title c-${state}`;
    current.querySelector('.sileo-title').textContent = title;
    return;
  }

  if (current) {
    const oldPrev = stack.querySelector('.prev');
    if (oldPrev) oldPrev.remove();
    current.classList.replace('current', 'prev');
    clearTimeout(inst.timers.header);
    inst.timers.header = setTimeout(() => stack.querySelector('.prev')?.remove(), HEADER_EXIT_MS);
  }

  const div = document.createElement('div');
  div.className = 'sileo-header-inner current';
  div.dataset.hkey = hkey;

  const badge = document.createElement('div');
  badge.className = `sileo-badge c-${state}`;
  badge.innerHTML = icon !== undefined ? (icon||'') : ICONS[state]||'';

  const titleEl = document.createElement('span');
  titleEl.className = `sileo-title c-${state}`;
  titleEl.textContent = title;

  div.append(badge, titleEl);
  stack.appendChild(div);

  requestAnimationFrame(() => measurePill(inst));
}

/* ────────────────────────────────────────────────────────────────
   DESCRIPTION
──────────────────────────────────────────────────────────────── */
function applyDescription(inst, item) {
  const desc    = inst.el.querySelector('.sileo-description');
  const content = inst.el.querySelector('.sileo-content');
  desc.innerHTML = '';

  const hasDesc = !!(item.description || item.button);
  content.style.display = hasDesc ? '' : 'none';
  if (!hasDesc) { inst.contentHeight = 0; return; }

  if (item.description) {
    if (typeof item.description === 'string') {
      const p = document.createElement('p');
      p.style.margin = '0';
      p.textContent = item.description;
      desc.appendChild(p);
    } else {
      desc.appendChild(item.description);
    }
  }

  if (item.button) {
    const a = document.createElement('a');
    a.href = '#';
    a.className = `sileo-action-btn c-${item.state||'success'}`;
    a.style.setProperty('--_c', `var(--c-${item.state||'success'})`);
    a.textContent = item.button.title;
    a.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); item.button.onClick(); });
    desc.appendChild(a);
  }

  measureContent(inst);
}

/* ────────────────────────────────────────────────────────────────
   MEASUREMENTS
──────────────────────────────────────────────────────────────── */
function measurePill(inst) {
  const inner  = inst.el.querySelector('.sileo-header-inner.current');
  const header = inst.el.querySelector('.sileo-header');
  if (!inner || !header) return;
  const cs  = getComputedStyle(header);
  const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
  const w   = inner.scrollWidth + pad + PILL_PADDING;
  if (w > PILL_PADDING) {
    inst.pillWidth = w;
    syncGeometry(inst);
  }
}

function measureContent(inst) {
  const desc = inst.el.querySelector('.sileo-description');
  if (!desc) return;
  inst.contentHeight = desc.scrollHeight;
}

/* ────────────────────────────────────────────────────────────────
   GEOMETRY
──────────────────────────────────────────────────────────────── */
function syncGeometry(inst, first) {
  const pill       = inst.el.querySelector('.pill');
  const body       = inst.el.querySelector('.body');
  const pillBorder = inst.el.querySelector('.pill-border');
  const bodyBorder = inst.el.querySelector('.body-border');
  const svg        = inst.el.querySelector('svg');
  if (!pill || !body || !svg) return;

  const pw    = Math.max(inst.pillWidth || HEIGHT, HEIGHT);
  const blur  = ROUNDNESS * BLUR_RATIO;
  const pillH = inst.open ? HEIGHT + blur * 3 : HEIGHT;

  const pillX = (WIDTH - pw) / 2;

  const minExp    = HEIGHT * MIN_EXPAND_RATIO;
  const hasDesc   = inst.contentHeight > 0;
  const rawExp    = hasDesc ? Math.max(minExp, HEIGHT + inst.contentHeight) : minExp;
  const bodyH     = inst.open ? Math.max(0, rawExp - HEIGHT) : 0;
  const toastH    = inst.open ? rawExp : HEIGHT;
  const svgH      = inst.open ? rawExp : HEIGHT;

  svg.setAttribute('height', svgH);
  svg.setAttribute('viewBox', `0 0 ${WIDTH} ${svgH}`);

  inst.el.style.setProperty('--_h', `${toastH}px`);

  inst.el.style.setProperty('--_px', `${pillX}px`);
  inst.el.style.setProperty('--_pw', `${pw}px`);
  const scale = inst.open ? 0.9 : 1;
  const ty    = inst.open ? 3 : 0;
  inst.el.style.setProperty('--_ht', `translateY(${ty}px) scale(${scale})`);

  const content = inst.el.querySelector('.sileo-content');
  if (content) content.classList.toggle('visible', inst.open);

  const animate = getAnimate();

  if (inst.pillAnim) inst.pillAnim.stop();
  inst.pillAnim = animate(
    pill,
    { x: pillX, width: pw, height: pillH },
    first ? { duration: 0 } : SPRING
  );

  if (inst.bodyAnim) inst.bodyAnim.stop();
  inst.bodyAnim = animate(
    body,
    { height: bodyH, opacity: inst.open ? 1 : 0 },
    first ? { duration: 0 } : (inst.open ? SPRING : SPRING_NO_BOUNCE)
  );

  /* Animate border rects in sync */
  if (pillBorder) {
    animate(pillBorder, { x: pillX, width: pw, height: pillH }, first ? { duration: 0 } : SPRING);
  }
  if (bodyBorder) {
    animate(bodyBorder, { height: bodyH, opacity: inst.open ? 1 : 0 }, first ? { duration: 0 } : (inst.open ? SPRING : SPRING_NO_BOUNCE));
  }
}

/* ────────────────────────────────────────────────────────────────
   EXPAND / COLLAPSE
──────────────────────────────────────────────────────────────── */
function expand(inst) {
  if (inst.open) return;
  if (!inst.contentHeight) measureContent(inst);
  inst.open = true;
  syncGeometry(inst);
}

function collapse(inst) {
  if (!inst.open) return;
  inst.open = false;
  syncGeometry(inst);
}

/* ────────────────────────────────────────────────────────────────
   AUTOPILOT
──────────────────────────────────────────────────────────────── */
function setupAutopilot(inst) {
  clearTimeout(inst.timers.expand);
  clearTimeout(inst.timers.collapse);
  const item = inst.view;
  if (item.state === 'loading') return;
  if (!inst.contentHeight) measureContent(inst);
  if (!inst.contentHeight) return;
  if (!item.autoExpandDelayMs && !item.autoCollapseDelayMs) return;

  const expDly = item.autoExpandDelayMs || 0;
  const colDly = item.autoCollapseDelayMs || 0;

  if (expDly > 0) {
    inst.timers.expand = setTimeout(() => expand(inst), expDly);
  } else {
    expand(inst);
  }
  if (colDly > 0) {
    inst.timers.collapse = setTimeout(() => collapse(inst), colDly);
  }
}

/* ────────────────────────────────────────────────────────────────
   DISMISS TIMERS
──────────────────────────────────────────────────────────────── */
function scheduleDismiss(item) {
  clearTimeout(dismissTimers.get(item.id));
  const dur = item.duration;
  if (dur === null || dur === undefined || dur <= 0) return;
  dismissTimers.set(item.id, setTimeout(() => dismissToast(item.id), dur));
}

function pauseAll() {
  for (const [id, t] of dismissTimers) { clearTimeout(t); dismissTimers.delete(id); }
}

function resumeAll() {
  store.toasts.forEach(item => { if (!item.exiting) scheduleDismiss(item); });
}

function clearInstTimers(inst) {
  Object.values(inst.timers).forEach(t => clearTimeout(t));
  if (inst.pillAnim) inst.pillAnim.stop();
  if (inst.bodyAnim) inst.bodyAnim.stop();
}

/* ════════════════════════════════════════════════════════════════
   SWIPE DISMISS
════════════════════════════════════════════════════════════════ */
function onPointerDown(e, id, inst) {
  if (e.target.closest('.sileo-action-btn')) return;
  inst.pointerStart = e.clientY;
  e.currentTarget.setPointerCapture(e.pointerId);

  function onMove(ev) {
    const dy = ev.clientY - inst.pointerStart;
    const sign = dy > 0 ? 1 : -1;
    const clamped = Math.min(Math.abs(dy), SWIPE_MAX) * sign;
    inst.el.style.transform = `translateZ(0) translateY(${clamped}px) scale(1)`;
  }
  function onUp(ev) {
    const dy = ev.clientY - inst.pointerStart;
    inst.pointerStart = null;
    inst.el.style.transform = '';
    inst.el.removeEventListener('pointermove', onMove);
    inst.el.removeEventListener('pointerup',   onUp);
    if (Math.abs(dy) > SWIPE_DISMISS) dismissToast(id);
  }
  inst.el.addEventListener('pointermove', onMove, { passive: true });
  inst.el.addEventListener('pointerup',   onUp,   { passive: true });
}

/* ════════════════════════════════════════════════════════════════
   DEMO HELPERS
════════════════════════════════════════════════════════════════ */
function demoLoading() {
  const id = 'demo-loading';
  Sileo.show({ id, state: 'loading', title: 'Uploading file...', duration: null });
  setTimeout(() => {
    updateToast(id, {
      id, state: 'success', title: 'Upload Complete',
      description: 'Your file has been saved to the cloud successfully.'
    });
    scheduleDismiss({ id, duration: DEFAULT_DURATION });
  }, 2500);
}

function demoPromise() {
  Sileo.promise(
    () => new Promise((res, rej) =>
      Math.random() > 0.35
        ? setTimeout(res, 2200, { name: 'report.pdf' })
        : setTimeout(rej, 2200, new Error('Network timeout'))
    ),
    {
      loading: { title: 'Generating report...' },
      success: d   => ({ title: 'Report Ready',  description: `${d.name} is ready to download.` }),
      error:   err => ({ title: 'Export Failed', description: err.message }),
    }
  );
}

function demoBooking() {
  const planeIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>
  </svg>`;

  const flightDetails = document.createElement('div');
  flightDetails.style.cssText = 'padding:1rem 0 0.5rem; font-family: -apple-system, sans-serif;';
  flightDetails.innerHTML = `
    <style>
      .flight-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:1.25rem; }
      .airline-logo { font-weight:700; font-size:.75rem; letter-spacing:.05em; color:#f4f4f5; display:flex; align-items:center; gap:.35rem; }
      .airline-logo svg { width:14px; height:14px; fill:#f4f4f5; }
      .flight-number { font-size:.7rem; color:#71717a; font-weight:500; }
      .flight-route { display:flex; align-items:center; justify-content:space-between; margin-bottom:1.25rem; position:relative; }
      .airport { font-size:1.75rem; font-weight:700; color:#f4f4f5; letter-spacing:-.02em; }
      .flight-path { flex:1; margin:0 1.5rem; position:relative; height:2px; }
      .flight-line { position:absolute; top:0; left:0; right:0; height:2px;
        background: repeating-linear-gradient(to right, #3f3f46 0px, #3f3f46 6px, transparent 6px, transparent 12px); }
      .plane-icon { position:absolute; top:50%; left:0; transform:translate(-50%,-50%);
        animation:fly 3s ease-in-out infinite; color:var(--c-success); filter:drop-shadow(0 0 4px rgba(76,175,80,.3)); }
      .plane-icon svg { width:18px; height:18px; transform:rotate(-45deg); }
      @keyframes fly { 0%,100% { left:0%; } 50% { left:100%; } }
    </style>
    <div class="flight-header">
      <div class="airline-logo">
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <path d="M8 12h8M12 8v8" stroke="#18181b" stroke-width="2"/>
        </svg>
        UNITED
      </div>
      <div class="flight-number">PNR EC2QW4</div>
    </div>
    <div class="flight-route">
      <div class="airport">DEL</div>
      <div class="flight-path">
        <div class="flight-line"></div>
        <div class="plane-icon">${planeIcon}</div>
      </div>
      <div class="airport">SFO</div>
    </div>
  `;

  const viewBtn = document.createElement('a');
  viewBtn.href = '#';
  viewBtn.className = `sileo-action-btn c-success`;
  viewBtn.style.cssText = '--_c: var(--c-success); width:100%; justify-content:center; margin-top:0.5rem;';
  viewBtn.textContent = 'View Details';
  viewBtn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); alert('Opening flight details...'); });
  flightDetails.appendChild(viewBtn);

  Sileo.promise(
    () => new Promise(res => setTimeout(res, 1800)),
    {
      loading: { title: 'Confirming booking...', icon: planeIcon },
      success: () => ({ title: 'Booking Confirmed', description: flightDetails, icon: planeIcon }),
      error:   err => ({ title: 'Booking Failed', description: err.message })
    }
  );
}

/* ════════════════════════════════════════════════════════════════
   BUTTON WIRING  (replaces inline onclick handlers)
════════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  initRenderer();

  document.querySelectorAll('[data-demo]').forEach(btn => {
    btn.addEventListener('click', () => {
      switch (btn.dataset.demo) {
        case 'success':
          Sileo.success({ title: 'Changes Saved', description: 'Changes saved successfully to the database. Please refresh the page to see the changes.' });
          break;
        case 'error':
          Sileo.error({ title: 'Something Went Wrong', description: "We're having trouble saving your changes to the server. Please try again in a few minutes." });
          break;
        case 'warning':
          Sileo.warning({ title: 'Storage Almost Full', description: "You've used 95% of your available storage. Please upgrade your plan to continue." });
          break;
        case 'info':
          Sileo.info({ title: 'New Update Available', description: "Version 3.1.0 is ready. Check the changelog for what's new." });
          break;
        case 'action':
          Sileo.action({ title: 'Undo Delete', description: 'The file was permanently moved to trash.', button: { title: 'Undo', onClick: () => alert('Undone!') } });
          break;
        case 'loading':  demoLoading();  break;
        case 'promise':  demoPromise();  break;
        case 'booking':  demoBooking();  break;
        case 'upload':   demoUpload();   break;
      }
    });
  });
});

function demoUpload() {
  const id = 'upload-progress';

  const progressContainer = document.createElement('div');
  const progressWrapper   = document.createElement('div');
  progressWrapper.className = 'sileo-progress';

  const progressBar = document.createElement('div');
  progressBar.className = 'sileo-progress-bar c-info';
  progressBar.style.setProperty('--_c', 'var(--c-info)');
  progressBar.style.width = '0%';
  progressWrapper.appendChild(progressBar);

  const progressText = document.createElement('div');
  progressText.className = 'sileo-progress-text';
  progressText.textContent = '0% uploaded';

  progressContainer.appendChild(progressWrapper);
  progressContainer.appendChild(progressText);

  Sileo.show({
    id,
    state: 'info',
    title: 'Uploading presentation.pdf',
    description: progressContainer,
    duration: null,
    autopilot: false
  });

  setTimeout(() => {
    const inst = instances.get(id);
    if (inst) expand(inst);
  }, 100);

  let progress = 0;
  const interval = setInterval(() => {
    progress += Math.random() * 12 + 3;
    if (progress > 100) progress = 100;

    progressBar.style.width = `${progress}%`;
    progressText.textContent = `${Math.round(progress)}% uploaded`;

    if (progress >= 100) {
      clearInterval(interval);
      setTimeout(() => {
        updateToast(id, {
          id,
          state: 'success',
          title: 'Upload Complete',
          description: 'presentation.pdf has been uploaded successfully.'
        });
        scheduleDismiss({ id, duration: DEFAULT_DURATION });
      }, 300);
    }
  }, 200);
}