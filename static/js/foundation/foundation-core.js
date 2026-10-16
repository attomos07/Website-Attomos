/* ==========================================================================
   Attomos Foundation — núcleo compartido
   - AF.store: datos (por ahora en localStorage; cada método está pensado para
     cambiarse por su endpoint /api/foundation/... cuando exista el backend)
   - AF.session: sesión del usuario
   - Utilidades de UI estilo iOS 27: toasts, control segmentado con cápsula
     (mismos resortes que las pestañas de Mi Negocio), dropdown iOS,
     navbar público y sidebar del panel.
   ========================================================================== */
(function () {
    'use strict';

    const LS_KEY = 'af_db_v1';
    const SESSION_KEY = 'af_session_v1';
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    // ------------------------------------------------------------------
    // Utilidades
    // ------------------------------------------------------------------
    const uid = (p = 'id') => p + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const money = (n, cur = 'USD') => {
        const v = Number(n) || 0;
        const s = new Intl.NumberFormat('es-MX', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(v);
        return `$${s} ${cur}`;
    };
    const slugify = (s) => String(s || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'rescatista';
    const initials = (s) => String(s || '?').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

    /** Reduce una imagen a dataURL JPEG (para no llenar el almacenamiento). */
    function readImage(file, max = 900, quality = 0.82) {
        return new Promise((resolve, reject) => {
            if (!file || !file.type.startsWith('image/')) { reject(new Error('Elige una imagen (JPG, PNG o WebP)')); return; }
            const fr = new FileReader();
            fr.onerror = () => reject(new Error('No se pudo leer la imagen'));
            fr.onload = () => {
                const img = new Image();
                img.onerror = () => reject(new Error('No se pudo abrir la imagen'));
                img.onload = () => {
                    const k = Math.min(1, max / Math.max(img.width, img.height));
                    const c = document.createElement('canvas');
                    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
                    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
                    resolve(c.toDataURL('image/jpeg', quality));
                };
                img.src = fr.result;
            };
            fr.readAsDataURL(file);
        });
    }

    // ------------------------------------------------------------------
    // Datos
    // ------------------------------------------------------------------
    function emptyRescuer(name, ownerId) {
        return {
            id: uid('res'),
            ownerId,
            slug: slugify(name),
            name: name || '',
            city: '',
            country: 'México',
            bio: '',
            avatar: '',
            cover: '',
            socials: { instagram: '', facebook: '', tiktok: '', whatsapp: '' },
            currency: 'USD',
            plans: [],
            allowCustomMonthly: true,
            minCustomMonthly: 3,
            animals: [],
            oneTime: { enabled: true, suggested: [10, 20, 50], allowCustom: true, min: 1 },
            published: false,
            createdAt: Date.now(),
        };
    }

    function demoRescuer() {
        const r = emptyRescuer('Huellitas Hermosillo', 'demo');
        Object.assign(r, {
            id: 'res_demo', slug: 'huellitas-hermosillo', city: 'Hermosillo, Sonora', demo: true, published: true,
            bio: 'Rescatamos perritos y gatitos de la calle, los esterilizamos y les buscamos un hogar. Todo lo que recibimos se va a croquetas, veterinario y medicinas.',
            socials: { instagram: '@huellitashmo', facebook: '', tiktok: '', whatsapp: '' },
            plans: [
                { id: 'pl_1', name: 'Croquetas', amount: 5, description: 'Alimento para un peludo durante una semana.', perks: ['Fotos mensuales de los rescates'], featured: false },
                { id: 'pl_2', name: 'Veterinario', amount: 15, description: 'Ayuda con vacunas y desparasitación.', perks: ['Fotos mensuales', 'Tu nombre en el muro de padrinos'], featured: true },
                { id: 'pl_3', name: 'Ángel guardián', amount: 30, description: 'Cubre una esterilización al mes.', perks: ['Todo lo anterior', 'Videollamada con los rescatados'], featured: false },
            ],
            animals: [
                { id: 'an_1', name: 'Bombón', species: 'gato', sex: 'hembra', age: '2 años', photo: '', story: 'La encontramos bajo un carro con una patita lastimada. Ya está sana y es la más cariñosa.', sponsorAmount: 12, status: 'disponible' },
                { id: 'an_2', name: 'Chispas', species: 'perro', sex: 'macho', age: '8 meses', photo: '', story: 'Cachorro juguetón rescatado de un lote baldío. Necesita sus últimas vacunas.', sponsorAmount: 15, status: 'disponible' },
                { id: 'an_3', name: 'Luna', species: 'perro', sex: 'hembra', age: '5 años', photo: '', story: 'Abuelita tranquila que busca alguien que le dé calor.', sponsorAmount: 10, status: 'apadrinado' },
            ],
        });
        return r;
    }

    function load() {
        let db = null;
        try { db = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (_) { db = null; }
        if (!db || typeof db !== 'object') db = { users: [], rescuers: [], pledges: [] };
        db.users = db.users || []; db.rescuers = db.rescuers || []; db.pledges = db.pledges || [];
        if (!db.rescuers.some((r) => r.demo)) db.rescuers.push(demoRescuer());
        return db;
    }
    function save(db) {
        try { localStorage.setItem(LS_KEY, JSON.stringify(db)); return true; }
        catch (_) { toast('No hay espacio para guardar. Usa fotos más ligeras.', 'error'); return false; }
    }

    const store = {
        // TODO backend: POST /api/foundation/register
        register({ name, email, password, role }) {
            const db = load();
            email = String(email || '').trim().toLowerCase();
            if (db.users.some((u) => u.email === email)) throw new Error('Ya existe una cuenta con ese correo');
            const user = { id: uid('usr'), name: name.trim(), email, password, role, createdAt: Date.now() };
            if (role === 'rescuer') {
                const r = emptyRescuer(name, user.id);
                let base = r.slug, n = 2;
                while (db.rescuers.some((x) => x.slug === r.slug)) r.slug = `${base}-${n++}`;
                db.rescuers.push(r);
                user.rescuerId = r.id;
            }
            db.users.push(user);
            save(db);
            return user;
        },
        // TODO backend: POST /api/foundation/login
        login(email, password) {
            const db = load();
            const u = db.users.find((x) => x.email === String(email || '').trim().toLowerCase());
            if (!u || u.password !== password) throw new Error('Correo o contraseña incorrectos');
            return u;
        },
        user(id) { return load().users.find((u) => u.id === id) || null; },
        // TODO backend: GET /api/foundation/rescuers (solo publicados)
        rescuers({ onlyPublished = true } = {}) {
            return load().rescuers.filter((r) => !onlyPublished || r.published);
        },
        rescuerBySlug(slug) { return load().rescuers.find((r) => r.slug === slug) || null; },
        rescuerById(id) { return load().rescuers.find((r) => r.id === id) || null; },
        // TODO backend: PUT /api/foundation/rescuers/:id
        saveRescuer(rescuer) {
            const db = load();
            const i = db.rescuers.findIndex((r) => r.id === rescuer.id);
            if (i < 0) throw new Error('No se encontró tu perfil de rescatista');
            if (db.rescuers.some((r) => r.slug === rescuer.slug && r.id !== rescuer.id)) throw new Error('Esa dirección ya la usa otro rescatista');
            db.rescuers[i] = rescuer;
            return save(db);
        },
        // Intención de aporte (todavía sin cobro). TODO backend: POST /api/foundation/pledges
        addPledge(pledge) {
            const db = load();
            const p = Object.assign({ id: uid('pg'), createdAt: Date.now(), status: 'pendiente_pago' }, pledge);
            db.pledges.push(p);
            save(db);
            return p;
        },
        pledgesByDonor(userId) { return load().pledges.filter((p) => p.donorId === userId); },
        pledgesByRescuer(rescuerId) { return load().pledges.filter((p) => p.rescuerId === rescuerId); },
    };

    const session = {
        get() {
            const id = localStorage.getItem(SESSION_KEY);
            return id ? store.user(id) : null;
        },
        set(user) { localStorage.setItem(SESSION_KEY, user.id); },
        clear() { localStorage.removeItem(SESSION_KEY); },
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
    function initNavbar() {
        const nav = document.getElementById('afNavbar');
        if (!nav) return;
        const user = session.get();
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
            e.preventDefault(); session.clear(); location.href = '/foundation';
        }));
    }

    // ------------------------------------------------------------------
    // Sidebar del panel
    // ------------------------------------------------------------------
    function initSidebar({ role, onNavigate } = {}) {
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
            e.preventDefault(); session.clear(); location.href = '/foundation/login';
        }));
        const user = session.get();
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
    function petArt(species) {
        return species === 'perro'
            ? '<svg class="af-pet-ph" viewBox="0 0 64 64" fill="currentColor" aria-hidden="true"><path d="M14 14c-4 0-7 6-7 12 0 4 2 6 4 6 3 0 5-4 6-8l1-6c0-2-2-4-4-4Zm36 0c4 0 7 6 7 12 0 4-2 6-4 6-3 0-5-4-6-8l-1-6c0-2 2-4 4-4ZM32 16c-9 0-15 7-15 17 0 11 6 19 15 19s15-8 15-19c0-10-6-17-15-17Zm-6 15a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Zm12 0a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Zm-6 8c2.5 0 4 1.2 4 2.6 0 1.6-2 3.4-4 3.4s-4-1.8-4-3.4c0-1.4 1.5-2.6 4-2.6Z" fill-opacity=".9"/></svg>'
            : '<svg class="af-pet-ph" viewBox="0 0 64 64" fill="currentColor" aria-hidden="true"><path d="M12 8l12 12c2.5-1 5.2-1.5 8-1.5s5.5.5 8 1.5L52 8v22c0 13-9 22-20 22S12 43 12 30V8Zm13 23a2.5 3 0 1 0 0 6 2.5 3 0 0 0 0-6Zm14 0a2.5 3 0 1 0 0 6 2.5 3 0 0 0 0-6Zm-7 9-3 2.5c0 1.4 1.3 2.5 3 2.5s3-1.1 3-2.5L32 40Z" fill-opacity=".9"/></svg>';
    }
    function avatarHtml(r, cls = '') {
        return `<span class="af-avatar ${cls}">${r.avatar ? `<img src="${esc(r.avatar)}" alt="">` : esc(initials(r.name))}</span>`;
    }
    function rescuerCard(r, i = 0) {
        const avail = (r.animals || []).filter((a) => a.status === 'disponible').length;
        const tags = [];
        if ((r.plans || []).length || r.allowCustomMonthly) tags.push('<span class="af-badge">Suscripción</span>');
        if (avail) tags.push(`<span class="af-badge is-coral">${avail} por apadrinar</span>`);
        if (r.oneTime && r.oneTime.enabled) tags.push('<span class="af-badge is-green">Donación única</span>');
        return `<a class="af-rcard af-in" style="--i:${i}" href="/foundation/r/${encodeURIComponent(r.slug)}">
            <div class="af-rcard-cover"${r.cover ? ` style="background-image:url('${esc(r.cover)}')"` : ''}>${avatarHtml(r)}</div>
            <div class="af-rcard-body">
                <h3>${esc(r.name || 'Rescatista')}</h3>
                ${r.city ? `<span class="af-rcard-city">${PIN}${esc(r.city)}</span>` : ''}
                <p class="af-rcard-bio">${esc(r.bio || 'Rescatista independiente.')}</p>
                <div class="af-rcard-tags">${tags.join('')}</div>
            </div>
        </a>`;
    }
    const STATUS = { disponible: ['Disponible', 'is-coral'], apadrinado: ['Con padrino', 'is-green'], adoptado: ['Adoptado', 'is-gray'] };
    function animalCard(a, r, i = 0, { href = true, action = null } = {}) {
        const st = STATUS[a.status] || STATUS.disponible;
        const link = `/foundation/r/${encodeURIComponent(r.slug)}?tab=apadrina&animal=${encodeURIComponent(a.id)}`;
        const cta = a.status === 'disponible'
            ? `<a class="af-btn af-btn-coral af-btn-sm" href="${link}">Apadrinar</a>`
            : `<a class="af-btn af-btn-ghost af-btn-sm" href="${link}">Ver</a>`;
        return `<article class="af-acard af-in" style="--i:${i}" data-animal="${esc(a.id)}">
            <div class="af-acard-photo">${a.photo ? `<img src="${esc(a.photo)}" alt="${esc(a.name)}">` : petArt(a.species)}<span class="af-badge ${st[1]}"><span class="af-dot"></span>${st[0]}</span></div>
            <div class="af-acard-body">
                <h3>${esc(a.name)}</h3>
                <span class="af-acard-meta">${a.species === 'perro' ? 'Perro' : 'Gato'} · ${a.sex === 'macho' ? 'Macho' : 'Hembra'}${a.age ? ' · ' + esc(a.age) : ''}${href ? ` · ${esc(r.name)}` : ''}</span>
                <p class="af-acard-story">${esc(a.story || '')}</p>
                <div class="af-acard-foot"><span class="af-price">${money(a.sponsorAmount, '')}<small>USD/mes</small></span>${action != null ? action : (href ? cta : '')}</div>
            </div>
        </article>`;
    }
    const PLEDGE_TYPES = { subscription: 'Suscripción mensual', sponsor: 'Apadrinamiento', one_time: 'Donación única' };
    function pledgeRow(p, i = 0, { who = 'rescuer' } = {}) {
        const ic = p.type === 'sponsor'
            ? '<span class="af-ic is-coral"><svg viewBox="0 0 24 24"><circle cx="5.5" cy="10" r="2"/><circle cx="9.5" cy="5.5" r="2"/><circle cx="14.5" cy="5.5" r="2"/><circle cx="18.5" cy="10" r="2"/><path d="M8 17.5c0-2.5 1.8-4.5 4-4.5s4 2 4 4.5c0 1.7-1.8 2.5-4 2.5s-4-.8-4-2.5Z"/></svg></span>'
            : p.type === 'subscription'
                ? '<span class="af-ic"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18"/></svg></span>'
                : '<span class="af-ic is-coral"><svg viewBox="0 0 24 24"><path d="M12 21s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6-8 11-8 11Z"/></svg></span>';
        const what = p.type === 'sponsor' ? `Apadrinas a ${p.animalName}` : p.type === 'subscription' ? (p.planName ? `Plan ${p.planName}` : 'Monto libre') : 'Donación única';
        const title = who === 'donor' ? `${p.rescuerName} · ${what}` : `${p.donorName || 'Donador'} · ${what.replace('Apadrinas a', 'Apadrina a')}`;
        const date = new Date(p.createdAt).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
        return `<div class="af-pledge" style="--i:${i}">${ic}
            <div class="af-pledge-text"><strong>${esc(title)}</strong><span>${PLEDGE_TYPES[p.type] || ''} · ${date} · Pago pendiente</span></div>
            <span class="af-price">${money(p.amount, '')}<small>${p.type === 'one_time' ? 'USD' : 'USD/mes'}</small></span>
        </div>`;
    }

    window.AF = {
        store, session, toast, segmented, iosSelect, initNavbar, initSidebar, readImage, uid, esc, money, slugify, initials,
        ui: { petArt, avatarHtml, rescuerCard, animalCard, pledgeRow, PLEDGE_TYPES },
    };
    document.addEventListener('DOMContentLoaded', initNavbar);
})();
