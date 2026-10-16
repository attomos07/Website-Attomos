/* ==========================================================================
   Attomos Foundation — núcleo compartido
   - AF.api / AF.store: llamadas a /api/foundation/... (backend Go)
   - AF.session: sesión del usuario (cookie httpOnly af_token)
   - Utilidades de UI estilo iOS 27: toasts, control segmentado con cápsula
     (mismos resortes que las pestañas de Mi Negocio), dropdown iOS,
     navbar público y sidebar del panel.
   ========================================================================== */
(function () {
    'use strict';

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    // ------------------------------------------------------------------
    // Utilidades
    // ------------------------------------------------------------------
    const uid = (p = 'id') => p + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const money = (n, cur = 'MXN') => {
        const v = Number(n) || 0;
        const str = new Intl.NumberFormat('es-MX', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(v);
        return cur ? `$${str} ${cur}` : `$${str}`;
    };
    const slugify = (s) => String(s || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'rescatista';
    const initials = (s) => String(s || '?').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

    /** Reduce una imagen a JPEG (Blob) antes de subirla, para no gastar Drive. */
    function readImage(file, max = 600, quality = 0.86) {
        return new Promise((resolve, reject) => {
            if (!file || !/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type || 'image/jpeg')) { reject(new Error('Elige una imagen (JPG, PNG o WebP)')); return; }
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo abrir la imagen')); };
            img.onload = () => {
                const k = Math.min(1, max / Math.max(img.width, img.height));
                const c = document.createElement('canvas');
                c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
                const ctx = c.getContext('2d');
                ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
                ctx.drawImage(img, 0, 0, c.width, c.height);
                URL.revokeObjectURL(url);
                c.toBlob((blob) => blob ? resolve(blob) : reject(new Error('No se pudo procesar la imagen')), 'image/jpeg', quality);
            };
            img.src = url;
        });
    }

    // ------------------------------------------------------------------
    // API (/api/foundation)
    // ------------------------------------------------------------------
    async function api(path, { method = 'GET', body, form } = {}) {
        const opts = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
        if (form) opts.body = form;
        else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
        let res;
        try { res = await fetch('/api/foundation' + path, opts); }
        catch (_) { const e = new Error('Sin conexión. Revisa tu internet e intenta de nuevo.'); e.status = 0; throw e; }
        let data = null;
        try { data = await res.json(); } catch (_) { data = null; }
        if (!res.ok) {
            const e = new Error((data && data.error) || 'Algo salió mal. Intenta de nuevo.');
            e.status = res.status; e.code = data && data.code; e.field = data && data.field;
            throw e;
        }
        return data || {};
    }

    const store = {
        register: (data) => api('/auth/register', { method: 'POST', body: data }).then((d) => d.user),
        login: (email, password) => api('/auth/login', { method: 'POST', body: { email, password } }).then((d) => d.user),
        updateMe: (name) => api('/auth/me', { method: 'PATCH', body: { name } }).then((d) => d.user),

        rescuers: (q = '') => api('/rescuers' + (q ? '?q=' + encodeURIComponent(q) : '')).then((d) => d.rescuers || []),
        rescuer: (slug) => api('/rescuers/' + encodeURIComponent(slug)),

        myRescuer: () => api('/rescuer').then((d) => d.rescuer),
        saveRescuer: (payload) => api('/rescuer', { method: 'PUT', body: payload }).then((d) => d.rescuer),
        rescuerPledges: () => api('/rescuer/pledges'),
        createPlan: (p) => api('/plans', { method: 'POST', body: p }),
        updatePlan: (id, p) => api('/plans/' + id, { method: 'PUT', body: p }),
        deletePlan: (id) => api('/plans/' + id, { method: 'DELETE' }),
        /** Sube la foto de perfil al Drive de la rescatista. */
        upload(blob) {
            const f = new FormData();
            f.append('file', blob, 'perfil.jpg');
            return api('/upload', { method: 'POST', form: f });
        },

        driveConnect: () => api('/google/connect').then((d) => d.authUrl),
        driveDisconnect: () => api('/google', { method: 'DELETE' }),
        stripeConnect: () => api('/stripe/connect', { method: 'POST' }).then((d) => d.url),
        stripeStatus: () => api('/stripe/status').then((d) => d.stripe),
        stripeDashboard: () => api('/stripe/dashboard', { method: 'POST' }).then((d) => d.url),

        checkout: (payload) => api('/checkout', { method: 'POST', body: payload }),
        confirm: (sessionId) => api('/checkout/confirm', { method: 'POST', body: { sessionId } }).then((d) => d.pledge),
        myPledges: () => api('/pledges').then((d) => d.pledges || []),
        cancelPledge: (id) => api('/pledges/' + id + '/cancel', { method: 'POST' }).then((d) => d.pledge),
    };

    let mePromise = null;
    const session = {
        /** Usuario de la sesión o null (se pide una vez por página). */
        get(force) {
            if (!mePromise || force) mePromise = api('/auth/me').then((d) => d.user || null).catch(() => null);
            return mePromise;
        },
        async logout(to = '/foundation') {
            try { await api('/auth/logout', { method: 'POST' }); } catch (_) { /* igual salimos */ }
            mePromise = Promise.resolve(null);
            location.href = to;
        },
    };

    // ------------------------------------------------------------------
    // Toasts
    // ------------------------------------------------------------------
    function toast(msg, type = 'ok') {
        let host = document.getElementById('afToasts');
        if (!host) {
            host = document.createElement('div');
            host.id = 'afToasts';
            host.className = 'af-toasts';
            host.setAttribute('aria-live', 'polite');
            document.body.appendChild(host);
        }
        const el = document.createElement('div');
        el.className = `af-toast is-${type}`;
        const icon = type === 'error'
            ? '<path d="M12 8v5M12 16.5v.5"/><circle cx="12" cy="12" r="9"/>'
            : type === 'info'
                ? '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.5"/>'
                : '<path d="M5 12.5l4.5 4.5L19 7.5"/>';
        el.innerHTML = `<span class="af-toast-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${icon}</svg></span><span>${esc(msg)}</span>`;
        host.appendChild(el);
        setTimeout(() => {
            el.classList.add('is-out');
            el.addEventListener('animationend', () => el.remove(), { once: true });
            setTimeout(() => el.remove(), 600);
        }, 2800);
    }

    // ------------------------------------------------------------------
    // Motor de resortes (mismos valores que las pestañas de Mi Negocio)
    // ------------------------------------------------------------------
    const springs = new Set();
    const renderers = new Set();
    let raf = null, last = 0;
    const spring = (v = 0, k = 420, d = 30, eps = 0.1) => { const s = { v, vel: 0, t: v, k, d, eps }; springs.add(s); return s; };
    function step(s, dt) {
        if (reduceMotion.matches) { s.v = s.t; s.vel = 0; return; }
        s.vel += (-s.k * (s.v - s.t) - s.d * s.vel) * dt;
        s.v += s.vel * dt;
    }
    const atRest = (s) => Math.abs(s.v - s.t) < s.eps && Math.abs(s.vel) < s.eps * 5;
    function tick(now) {
        const dt = Math.min((now - last) / 1000, 1 / 30);
        last = now;
        springs.forEach((s) => step(s, dt));
        renderers.forEach((r) => r());
        if ([...springs].every(atRest)) {
            springs.forEach((s) => { s.v = s.t; s.vel = 0; });
            renderers.forEach((r) => r());
            raf = null; return;
        }
        raf = requestAnimationFrame(tick);
    }
    function kick() { if (raf) return; last = performance.now(); raf = requestAnimationFrame(tick); }

    /**
     * Control segmentado: cápsula cian que viaja hasta la opción activa
     * (horizontal o vertical). `itemSel` son los botones; la clase activa es
     * `is-active`. Devuelve { place(snap) }.
     */
    function segmented(container, { itemSel = '.af-seg-btn', vertical = false } = {}) {
        if (!container || container._afSeg) return container && container._afSeg;
        container.classList.add('af-seg-host');
        const thumb = document.createElement('span');
        thumb.className = 'af-seg-thumb';
        thumb.setAttribute('aria-hidden', 'true');
        container.prepend(thumb);
        const P = spring(0), L = spring(0), S = spring(1, 600, 30, 0.001);
        let ready = false;

        function render() {
            if (!ready) { thumb.style.opacity = 0; return; }
            const st = Math.min(Math.abs(P.vel) / 3000, 0.1);
            thumb.style.opacity = 1;
            if (vertical) {
                thumb.style.height = `${L.v}px`;
                thumb.style.transform = `translateY(${P.v}px) scale(${S.v * (1 - st)}, ${S.v})`;
            } else {
                thumb.style.width = `${L.v}px`;
                thumb.style.transform = `translateX(${P.v}px) scale(${S.v}, ${S.v * (1 - st)})`;
            }
        }
        renderers.add(render);

        function place(snap) {
            const a = container.querySelector(itemSel + '.is-active');
            if (!a || !container.offsetWidth || a.offsetParent === null) { ready = false; render(); return; }
            P.t = vertical ? a.offsetTop : a.offsetLeft;
            L.t = vertical ? a.offsetHeight : a.offsetWidth;
            if (vertical) { thumb.style.left = `${a.offsetLeft}px`; thumb.style.width = `${a.offsetWidth}px`; }
            else { thumb.style.top = `${a.offsetTop}px`; thumb.style.height = `${a.offsetHeight}px`; }
            if (snap || !ready) { P.v = P.t; L.v = L.t; P.vel = L.vel = 0; }
            ready = true;
            render();
            kick();
        }
        container.addEventListener('pointerdown', (e) => {
            if (e.target.closest(itemSel + '.is-active')) { S.t = 0.94; kick(); }
        });
        const release = () => { S.t = 1; kick(); };
        ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => container.addEventListener(ev, release));
        if (window.ResizeObserver) new ResizeObserver(() => place(true)).observe(container);
        new MutationObserver(() => requestAnimationFrame(() => place(false)))
            .observe(container, { subtree: true, attributes: true, attributeFilter: ['class'] });
        place(true);
        container._afSeg = { place };
        return container._afSeg;
    }

    // ------------------------------------------------------------------
    // Dropdown iOS sobre un <select> nativo (el select sigue siendo la
    // fuente de verdad: .value y el evento change funcionan igual)
    // ------------------------------------------------------------------
    const openMenus = new Set();
    function iosSelect(select) {
        if (!select || select._afSelect) return;
        select._afSelect = true;
        select.classList.add('af-native-select');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'af-select-btn';
        btn.setAttribute('aria-haspopup', 'listbox');
        btn.setAttribute('aria-expanded', 'false');
        if (select.id) btn.id = select.id + 'Btn';
        btn.innerHTML = '<span class="af-select-label"></span><svg class="af-select-chev" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2 4l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        select.insertAdjacentElement('afterend', btn);
        const label = btn.querySelector('.af-select-label');

        const menu = document.createElement('div');
        menu.className = 'af-menu';
        menu.setAttribute('role', 'listbox');
        menu.innerHTML = '<span class="af-menu-ind" aria-hidden="true"></span><div class="af-menu-list"></div>';
        document.body.appendChild(menu);
        const list = menu.querySelector('.af-menu-list');
        const ind = menu.querySelector('.af-menu-ind');
        let open = false, hl = -1;

        const sync = () => {
            const o = select.options[select.selectedIndex];
            label.textContent = o ? o.textContent.trim() : '';
            btn.classList.toggle('is-placeholder', !o || o.value === '');
        };
        const items = () => [...list.children];
        function build() {
            list.innerHTML = [...select.options].map((o, i) => o.disabled && o.value === ''
                ? ''
                : `<button type="button" class="af-menu-opt${i === select.selectedIndex ? ' is-selected' : ''}" data-i="${i}" role="option">${esc(o.textContent.trim())}</button>`).join('');
        }
        function highlight(i, snap) {
            const el = list.querySelector(`[data-i="${i}"]`);
            hl = i;
            items().forEach((x) => x.classList.toggle('is-hover', x === el));
            if (!el) { ind.style.opacity = 0; return; }
            if (snap) ind.style.transition = 'none';
            ind.style.opacity = 1;
            ind.style.height = `${el.offsetHeight}px`;
            ind.style.transform = `translateY(${el.offsetTop - list.scrollTop + list.offsetTop}px)`;
            if (snap) { void ind.offsetWidth; ind.style.transition = ''; }
        }
        function place() {
            const r = btn.getBoundingClientRect();
            const w = Math.max(r.width, 180);
            menu.style.width = `${w}px`;
            const h = Math.min(menu.scrollHeight, 320);
            let top = r.bottom + 8, origin = 'top';
            if (top + h > window.innerHeight - 12 && r.top - h - 8 > 12) { top = r.top - h - 8; origin = 'bottom'; }
            const left = Math.min(Math.max(r.left, 12), window.innerWidth - w - 12);
            menu.style.top = `${top}px`;
            menu.style.left = `${left}px`;
            menu.style.transformOrigin = `${r.left + r.width / 2 - left}px ${origin}`;
        }
        function show() {
            openMenus.forEach((m) => m !== api && m.close());
            build();
            open = true;
            menu.classList.add('is-open'); btn.classList.add('is-open');
            btn.setAttribute('aria-expanded', 'true');
            place();
            const el = list.querySelector(`[data-i="${select.selectedIndex}"]`);
            if (el) list.scrollTop = Math.max(0, el.offsetTop - list.clientHeight / 2 + el.offsetHeight / 2);
            requestAnimationFrame(() => highlight(select.selectedIndex, true));
        }
        function close(focus) {
            if (!open) return;
            open = false;
            menu.classList.remove('is-open'); btn.classList.remove('is-open');
            btn.setAttribute('aria-expanded', 'false');
            if (focus) btn.focus({ preventScroll: true });
        }
        function choose(i) {
            const el = list.querySelector(`[data-i="${i}"]`);
            if (!el) return;
            el.classList.remove('is-bounce'); void el.offsetWidth; el.classList.add('is-bounce');
            if (select.selectedIndex !== i) {
                select.selectedIndex = i;
                select.dispatchEvent(new Event('change', { bubbles: true }));
            }
            sync();
            setTimeout(() => close(true), reduceMotion.matches ? 0 : 140);
        }
        btn.addEventListener('click', () => (open ? close() : show()));
        btn.addEventListener('keydown', (e) => {
            if (!open && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); show(); }
        });
        list.addEventListener('pointermove', (e) => {
            const el = e.target.closest('.af-menu-opt');
            if (el && +el.dataset.i !== hl) highlight(+el.dataset.i);
        });
        list.addEventListener('scroll', () => highlight(hl, true));
        list.addEventListener('click', (e) => { const el = e.target.closest('.af-menu-opt'); if (el) choose(+el.dataset.i); });
        document.addEventListener('keydown', (e) => {
            if (!open) return;
            const idx = items().map((x) => +x.dataset.i);
            const pos = idx.indexOf(hl);
            if (e.key === 'Escape') { e.preventDefault(); close(true); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); highlight(idx[Math.min(idx.length - 1, pos + 1)]); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(idx[Math.max(0, pos - 1)]); }
            else if (e.key === 'Enter') { e.preventDefault(); choose(hl); }
            else if (e.key === 'Tab') close();
        });
        document.addEventListener('pointerdown', (e) => { if (open && !menu.contains(e.target) && !btn.contains(e.target)) close(); }, true);
        window.addEventListener('resize', () => close());
        document.addEventListener('scroll', (e) => { if (open && !menu.contains(e.target)) close(); }, true);
        select.addEventListener('change', sync);
        new MutationObserver(sync).observe(select, { childList: true, subtree: true });
        const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
        Object.defineProperty(select, 'value', {
            configurable: true,
            get() { return desc.get.call(this); },
            set(v) { desc.set.call(this, v); sync(); },
        });
        sync();
        const api = { close };
        openMenus.add(api);
    }

    // ------------------------------------------------------------------
    // Navbar público
    // ------------------------------------------------------------------
    async function initNavbar() {
        const nav = document.getElementById('afNavbar');
        if (!nav) return;
        const user = await session.get();
        const guest = nav.querySelector('[data-af-guest]');
        const logged = nav.querySelector('[data-af-user]');
        if (user) {
            guest && guest.setAttribute('hidden', '');
            if (logged) {
                logged.removeAttribute('hidden');
                const av = logged.querySelector('.af-nav-avatar');
                if (av) av.textContent = initials(user.name);
                const nm = logged.querySelector('.af-nav-username');
                if (nm) nm.textContent = user.name.split(' ')[0];
            }
            nav.querySelectorAll('[data-af-guest-only]').forEach((el) => el.setAttribute('hidden', ''));
        } else {
            logged && logged.setAttribute('hidden', '');
        }

        // Link activo + cápsula que sigue al cursor
        const links = nav.querySelector('.af-nav-links');
        if (links) {
            const path = location.pathname.replace(/\/+$/, '') || '/';
            let best = null;
            links.querySelectorAll('.af-nav-link').forEach((a) => {
                const h = a.getAttribute('href').replace(/\/+$/, '');
                if (path === h || (h !== '/foundation' && path.startsWith(h + '/'))) best = a;
            });
            if (!best && path === '/foundation') best = links.querySelector('[href="/foundation"]');
            if (best) best.classList.add('is-active');
            const seg = segmented(links, { itemSel: '.af-nav-link' });
            links.addEventListener('pointerover', (e) => {
                const a = e.target.closest('.af-nav-link');
                if (!a || window.innerWidth <= 860) return;
                links.querySelectorAll('.af-nav-link').forEach((x) => x.classList.toggle('is-active', x === a));
            });
            links.addEventListener('pointerleave', () => {
                if (window.innerWidth <= 860) return;
                links.querySelectorAll('.af-nav-link').forEach((x) => x.classList.toggle('is-active', x === best));
                if (!best) seg && seg.place(false);
            });
        }

        // Menú móvil
        const burger = nav.querySelector('.af-burger');
        if (burger) {
            burger.addEventListener('click', () => {
                const open = !nav.classList.contains('is-menu-open');
                nav.classList.toggle('is-menu-open', open);
                burger.setAttribute('aria-expanded', String(open));
                document.body.classList.toggle('af-lock', open);
            });
            nav.querySelectorAll('.af-nav-links a, .af-nav-actions a').forEach((a) => a.addEventListener('click', () => {
                nav.classList.remove('is-menu-open'); document.body.classList.remove('af-lock');
            }));
        }

        const onScroll = () => nav.classList.toggle('is-scrolled', window.scrollY > 8);
        window.addEventListener('scroll', onScroll, { passive: true });
        onScroll();

        nav.querySelectorAll('[data-af-logout]').forEach((b) => b.addEventListener('click', (e) => {
            e.preventDefault(); session.logout('/foundation');
        }));
    }

    // ------------------------------------------------------------------
    // Sidebar del panel
    // ------------------------------------------------------------------
    function initSidebar({ role, user, onNavigate } = {}) {
        const side = document.getElementById('afSidebar');
        if (!side) return null;
        side.querySelectorAll('[data-role]').forEach((el) => {
            if (el.dataset.role !== role) el.remove();
        });
        const list = side.querySelector('.af-side-list');
        const tabbar = document.getElementById('afTabbar');
        if (tabbar) tabbar.querySelectorAll('[data-role]').forEach((el) => { if (el.dataset.role !== role) el.remove(); });
        const segSide = segmented(list, { itemSel: '.af-side-link', vertical: true });
        const segTab = tabbar ? segmented(tabbar, { itemSel: '.af-tab-link' }) : null;

        function setActive(view) {
            [side, tabbar].forEach((root) => root && root.querySelectorAll('[data-view]').forEach((a) => {
                a.classList.toggle('is-active', a.dataset.view === view);
                if (a.dataset.view === view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
            }));
        }
        [side, tabbar].forEach((root) => root && root.addEventListener('click', (e) => {
            const a = e.target.closest('[data-view]');
            if (!a) return;
            e.preventDefault();
            setActive(a.dataset.view);
            onNavigate && onNavigate(a.dataset.view);
        }));
        side.querySelectorAll('[data-af-logout]').forEach((b) => b.addEventListener('click', (e) => {
            e.preventDefault(); onNavigate && onNavigate('__logout');
        }));
        if (user) {
            const av = side.querySelector('.af-side-avatar');
            if (av) av.textContent = initials(user.name);
            const nm = side.querySelector('.af-side-name');
            if (nm) nm.textContent = user.name;
            const rl = side.querySelector('.af-side-role');
            if (rl) rl.textContent = user.role === 'rescuer' ? 'Rescatista' : 'Donador';
        }
        return { setActive, refresh: () => { segSide && segSide.place(true); segTab && segTab.place(true); } };
    }

    // Botones: ondita al tocar
    document.addEventListener('pointerdown', (e) => {
        const b = e.target.closest('.af-btn, .af-chip, .af-amount');
        if (!b || reduceMotion.matches || b.disabled) return;
        const r = b.getBoundingClientRect();
        const dot = document.createElement('span');
        dot.className = 'af-ripple';
        dot.style.left = (e.clientX - r.left) + 'px';
        dot.style.top = (e.clientY - r.top) + 'px';
        b.appendChild(dot);
        dot.addEventListener('animationend', () => dot.remove(), { once: true });
    });

    // ------------------------------------------------------------------
    // Piezas de UI compartidas (inicio, listas, panel)
    // ------------------------------------------------------------------
    const PIN = '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/></svg>';
    function avatarHtml(r, cls = '') {
        return `<span class="af-avatar ${cls}">${r.avatar ? `<img src="${esc(r.avatar)}" alt="">` : esc(initials(r.name))}</span>`;
    }
    function rescuerCard(r, i = 0, href) {
        const tags = [];
        if ((r.plans || []).length || r.allowCustomMonthly) tags.push('<span class="af-badge">Suscripción mensual</span>');
        if (r.oneTime && r.oneTime.enabled) tags.push('<span class="af-badge is-coral">Donación única</span>');
        const from = (r.plans || []).length ? Math.min(...r.plans.map((p) => p.amount)) : (r.allowCustomMonthly ? r.minCustomMonthly : 0);
        return `<a class="af-rcard af-in" style="--i:${i}" href="${href || `/foundation/r/${encodeURIComponent(r.slug)}`}">
            <div class="af-rcard-head">
                ${avatarHtml(r)}
                <div class="af-rcard-title">
                    <h3>${esc(r.name || 'Rescatista')}</h3>
                    ${r.city || r.country ? `<span class="af-rcard-city">${PIN}${esc([r.city, r.country].filter(Boolean).join(' · '))}</span>` : ''}
                </div>
            </div>
            <p class="af-rcard-bio">${esc(r.bio || 'Rescatista independiente de gatos y perros.')}</p>
            <div class="af-rcard-foot">
                <div class="af-rcard-tags">${tags.join('')}</div>
                ${from ? `<span class="af-rcard-from">Desde <strong>${money(from, r.currency || 'MXN')}</strong>/mes</span>` : ''}
            </div>
        </a>`;
    }
    const PLEDGE_TYPES = { subscription: 'Suscripción mensual', one_time: 'Donación única' };
    const fmtDate = (v) => {
        if (!v) return '';
        const d = new Date(typeof v === 'number' ? v : Date.parse(v));
        return isNaN(d) ? '' : d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
    };
    function pledgeStatus(p) {
        switch (p.status) {
            case 'active': return ['Activa', 'is-green'];
            case 'canceling': return [p.currentPeriodEnd ? `Termina el ${fmtDate(p.currentPeriodEnd)}` : 'Se cancela', 'is-gray'];
            case 'past_due': return ['Pago rechazado', 'is-coral'];
            case 'canceled': return ['Cancelada', 'is-gray'];
            case 'paid': return ['Pagada', 'is-green'];
            default: return ['Pendiente', 'is-gray'];
        }
    }
    function pledgeRow(p, i = 0, { who = 'rescuer' } = {}) {
        const ic = p.type === 'subscription'
            ? '<span class="af-ic"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18"/></svg></span>'
            : '<span class="af-ic is-coral"><svg viewBox="0 0 24 24"><path d="M12 21s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6-8 11-8 11Z"/></svg></span>';
        const what = p.type === 'subscription' ? (p.planName ? `Plan ${p.planName}` : 'Monto libre') : 'Donación única';
        const title = who === 'donor' ? `${p.rescuerName} · ${what}` : `${p.donorName || 'Donador'} · ${what}`;
        const st = pledgeStatus(p);
        const monthly = p.type !== 'one_time';
        const canCancel = who === 'donor' && monthly && (p.status === 'active' || p.status === 'past_due');
        const meta = [PLEDGE_TYPES[p.type] || '', fmtDate(p.createdAt)];
        if (monthly && p.paymentsCount > 1) meta.push(`${p.paymentsCount} pagos`);
        return `<div class="af-pledge" style="--i:${i}">${ic}
            <div class="af-pledge-text"><strong>${who === 'donor' && p.rescuerSlug ? `<a href="/foundation/r/${encodeURIComponent(p.rescuerSlug)}" style="color:inherit;text-decoration:none">${esc(title)}</a>` : esc(title)}</strong><span>${esc(meta.filter(Boolean).join(' · '))} · <span class="af-badge ${st[1]}" style="padding:2px 8px;font-size:11px">${esc(st[0])}</span></span></div>
            <span class="af-price">${money(p.amount, '')}<small>${esc(p.currency || 'MXN')}${monthly ? '/mes' : ''}</small></span>
            ${canCancel ? `<button type="button" class="af-icon-btn is-danger" data-cancel-pledge="${esc(p.id)}" aria-label="Cancelar" title="Cancelar"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>` : ''}
        </div>`;
    }

    window.AF = {
        api, store, session, toast, segmented, iosSelect, initNavbar, initSidebar, readImage, uid, esc, money, slugify, initials, fmtDate,
        ui: { avatarHtml, rescuerCard, pledgeRow, pledgeStatus, PLEDGE_TYPES },
    };
    document.addEventListener('DOMContentLoaded', initNavbar);
})();