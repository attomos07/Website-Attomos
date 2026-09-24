// ============================================
// SIDEBAR JAVASCRIPT — estilo iOS 27
// Envuelto en IIFE para aislar todas las variables del scope global y
// evitar colisiones con userbar.js u otros scripts en la misma página.
//
// Escritorio: panel flotante que se contrae a íconos y se expande con el
// botón de arriba (se recuerda la preferencia). Un indicador de resorte
// marca la página actual; mantener y arrastrar sobre la lista lo vuelve
// lente y al soltar navega. Mobile: cajón flotante con resorte que
// también se abre deslizando desde el borde y se cierra arrastrándolo.
// ============================================

(function () {

    // Guard: si el sidebar no está en esta página, no hacer nada
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    function getLang() {
        return localStorage.getItem('attomos_lang') || localStorage.getItem('lang') || 'es';
    }
    function t(key, fallback) {
        return window.Translations?.dict?.[getLang()]?.[key] || fallback;
    }

    // Giros de comida — muestra "Pedidos" en lugar de "Citas"
    const GIROS_COMIDA = ['pizzeria','pizza','mariscos','gorditas','restaurante',
                          'taqueria','tacos','hamburguesas','sushi','comida',
                          'panaderia','panadería','reposteria','repostería',
                          'pasteleria','pastelería',
                          'libreria','librería','libros',
                          'pescaderia','pescadería','marisquería','marisqueria',
                          'ensaladas','ensalada','ensaladería','ensaladeria'];

    // Normaliza acentos y minúsculas para comparaciones robustas
    // "Pizzería" → "pizzeria", "Panadería" → "panaderia", etc.
    function normalizeStr(str) {
        return (str || '')
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .toLowerCase();
    }

    // Aplica visibilidad Citas vs Pedidos según el giro recibido
    function applyFoodLogic(businessType) {
        const bt       = normalizeStr(businessType);
        const isFood   = GIROS_COMIDA.some(g => bt.includes(normalizeStr(g)));
        const apptItem   = document.getElementById('appointmentsMenuItem');
        const ordersItem = document.getElementById('ordersMenuItem');
        if (apptItem)   apptItem.style.display   = isFood ? 'none' : '';
        if (ordersItem) ordersItem.style.display  = isFood ? ''     : 'none';
    }

    // Aplica visibilidad Mi Negocio vs Mi Dependencia según el giro recibido
    // También muestra/oculta el ítem Flujos (solo gubernamental)
    function applyGovLogic(businessType) {
        const isGov      = normalizeStr(businessType).includes('gubernamental');
        const bizItem    = document.getElementById('myBusinessMenuItem');
        const agencyItem = document.getElementById('myAgencyMenuItem');
        const apptItem   = document.getElementById('appointmentsMenuItem');
        const ordersItem = document.getElementById('ordersMenuItem');
        const flowsItem  = document.getElementById('flowsMenuItem');

        if (bizItem)    bizItem.style.display    = isGov ? 'none' : '';
        if (agencyItem) agencyItem.style.display = isGov ? ''     : 'none';
        if (flowsItem)  flowsItem.style.display  = isGov ? ''     : 'none';

        // Para dependencias: ocultar Citas y Pedidos (no aplican)
        if (isGov) {
            if (apptItem)   apptItem.style.display   = 'none';
            if (ordersItem) ordersItem.style.display  = 'none';
        }
    }

    // ── Referencias al DOM ───────────────────────────────────────────
    const scroll          = document.getElementById('sbScroll');
    const indicator       = document.getElementById('sbInd');
    const hoverPill       = document.getElementById('sbHov');
    const toggleBtn       = document.getElementById('sbToggle');
    const searchBox       = document.getElementById('sbSearchBox');
    const searchInput     = document.getElementById('sbSearch');
    const emptyMsg        = document.getElementById('sbEmpty');
    const mobileMenuBtn   = document.getElementById('mobileMenuBtn');
    const mobileOverlay   = document.getElementById('mobileOverlay');
    const messagesLink    = document.getElementById('messagesLink');
    const messagesText    = messagesLink?.querySelector('.messages-text');
    const messagesLoading = messagesLink?.querySelector('.messages-loading');
    const crmItem         = document.getElementById('crmMenuItem');
    const buttons         = sidebar.querySelectorAll('.sb-item');

    // ✅ CRM: disponible para todos los planes desde el arranque, incluido
    // el plan gratuito (incluso si /api/me falla, el CRM sigue visible).
    if (crmItem) crmItem.style.display = '';

    // ── Chatwoot ─────────────────────────────────────────────────────
    async function loadChatwootInfo() {
        if (!messagesLink) return;
        try {
            messagesLink.setAttribute('data-loading', 'true');
            if (messagesText)    messagesText.style.display    = 'none';
            if (messagesLoading) messagesLoading.style.display = 'inline';

            const response = await fetch('/api/chatwoot/info', { method: 'GET', credentials: 'include' });
            if (!response.ok) throw new Error();
            const data = await response.json();

            if (messagesText)    messagesText.style.display    = 'inline';
            if (messagesLoading) messagesLoading.style.display = 'none';
            messagesLink.removeAttribute('data-loading');

            if (data.hasChatwoot && data.chatwootUrl) {
                messagesLink.href   = data.chatwootUrl;
                messagesLink.target = '_blank';
                messagesLink.rel    = 'noopener noreferrer';
                messagesLink.removeAttribute('data-disabled');
            } else {
                messagesLink.href = '#';
                messagesLink.setAttribute('data-disabled', 'true');
                messagesLink.addEventListener('click', (e) => {
                    if (messagesLink.getAttribute('data-disabled') === 'true') {
                        e.preventDefault();
                        showChatwootNotAvailableMessage();
                    }
                });
            }
        } catch (_) {
            if (messagesText)    messagesText.style.display    = 'inline';
            if (messagesLoading) messagesLoading.style.display = 'none';
            messagesLink.removeAttribute('data-loading');
        }
    }

    function showChatwootNotAvailableMessage() {
        const toast = document.createElement('div');
        toast.style.cssText = 'position:fixed;top:24px;right:24px;background:#06b6d4;color:white;padding:16px 24px;border-radius:16px;box-shadow:0 10px 25px rgba(6,182,212,0.25);z-index:10000;max-width:400px;';
        toast.innerHTML = '<div style="display:flex;align-items:center;gap:12px;"><svg style="width:24px;height:24px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg><div><div style="font-weight:600;margin-bottom:4px;">Chatwoot no disponible</div><div style="font-size:14px;opacity:0.9;">Crea tu primer agente para activar mensajes</div></div></div>';
        document.body.appendChild(toast);
        setTimeout(() => document.body.removeChild(toast), 4000);
    }

    // ── Plan y visibilidad de items ──────────────────────────────────
    async function checkUserPlan() {
        try {
            const response = await fetch('/api/me', { credentials: 'include' });
            if (!response.ok) return;

            const data        = await response.json();
            const plan        = data.subscription?.plan || 'gratuito';
            const userBizType = (data.user?.businessType || '').toLowerCase();

            const portfolioItem  = document.getElementById('portfolioMenuItem');
            const myBusinessItem = document.getElementById('myBusinessMenuItem');

            // ✅ FIX: "Mi Negocio" siempre visible, sin importar si tiene agentes
            if (myBusinessItem) myBusinessItem.style.display = '';

            // ✅ CRM: siempre visible, sin importar el plan (incluido gratuito)
            if (crmItem) crmItem.style.display = '';

            // Portfolio y Mensajes según plan
            if (plan === 'gratuito') {
                if (portfolioItem) portfolioItem.style.display = 'none';
                if (messagesLink)  messagesLink.style.display  = 'none';
            } else {
                if (portfolioItem) portfolioItem.style.display = '';
                if (messagesLink)  messagesLink.style.display  = '';
                loadChatwootInfo();
            }

            // Client History según giro
            const clientHistoryItem    = document.getElementById('clientHistoryMenuItem');
            const clientHistoryTooltip = document.getElementById('clientHistoryTooltip');
            const TIPOS_CLINICA    = ['clinica','clínica','dental','medico','médico','salud','veterinaria','odontologia','odontología'];
            const TIPOS_PELUQUERIA = ['peluqueria','peluquería','salon','salón','barberia','barbería','spa','estetica','estética','belleza'];

            if (clientHistoryItem && clientHistoryTooltip) {
                const isClinic = TIPOS_CLINICA.some(tp => normalizeStr(userBizType).includes(normalizeStr(tp)));
                const isSalon  = TIPOS_PELUQUERIA.some(tp => normalizeStr(userBizType).includes(normalizeStr(tp)));
                if (isClinic) {
                    clientHistoryItem.style.display  = '';
                    clientHistoryTooltip.textContent = t('hist_title_clinic', 'Historial Clínico');
                    clientHistoryTooltip.setAttribute('data-translate', 'hist_title_clinic');
                } else if (isSalon) {
                    clientHistoryItem.style.display  = '';
                    clientHistoryTooltip.textContent = t('hist_title_salon', 'Historial de Cliente');
                    clientHistoryTooltip.setAttribute('data-translate', 'hist_title_salon');
                } else {
                    clientHistoryItem.style.display  = 'none';
                }
            }

            // Paso 1: aplicar con User.BusinessType (inmediato, con normalización)
            applyFoodLogic(userBizType);
            applyGovLogic(userBizType);

            // Paso 2: MyBusinessInfo tiene PRIORIDAD (más específico que User.BusinessType)
            try {
                const bizResp = await fetch('/api/my-business', { credentials: 'include' });
                if (bizResp.ok) {
                    const bizData    = await bizResp.json();
                    const branch     = bizData.activeBranch || bizData.defaultBranch;
                    const branchType = branch?.business?.type
                                    || branch?.business?.typeName
                                    || branch?.businessType
                                    || '';
                    if (branchType) applyFoodLogic(branchType);
                    if (branchType) applyGovLogic(branchType);
                }
            } catch (_) {
                // falla silenciosamente
            }

        } catch (error) {
            console.error('Error obteniendo plan del usuario:', error);
        } finally {
            updateGroups();
            retarget();
        }
    }

    // ── Página activa ────────────────────────────────────────────────
    function setActivePage() {
        const currentPath = window.location.pathname;
        buttons.forEach(button => {
            button.classList.remove('active');
            button.removeAttribute('aria-current');
            const buttonPath = button.getAttribute('href');
            if (buttonPath && currentPath.includes(buttonPath) && buttonPath !== '#') {
                button.classList.add('active');
                button.setAttribute('aria-current', 'page');
            }
        });
    }

    // ── Textos que no tienen data-translate ──────────────────────────
    function applyUiTexts() {
        const title = document.getElementById('sbTitle');
        if (title) title.textContent = t('dash_menu', 'Menú');
        if (searchInput) searchInput.placeholder = t('dash_search', 'Buscar');
        if (emptyMsg) emptyMsg.textContent = t('dash_no_results', 'Sin resultados');
        sidebar.querySelectorAll('.sb-group').forEach((gEl) => {
            gEl.textContent = t(gEl.dataset.groupKey, gEl.dataset.groupFallback);
        });
        updateToggleLabel();
    }
    document.addEventListener('attomos:langchange', applyUiTexts);

    // ====================================================================
    // ESTILO iOS 27: resortes, indicador, contraer/expandir, cajón mobile
    // ====================================================================
    const mqMobile = window.matchMedia('(max-width: 768px)');
    const reduce   = window.matchMedia('(prefers-reduced-motion: reduce)');
    const clamp    = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
    const isMobile = () => mqMobile.matches;
    const isExpanded = () => sidebar.classList.contains('expanded');

    // Orden de la entrada escalonada del cajón mobile
    [...scroll.children, ...sidebar.querySelectorAll('.sb-bottom .sb-item')]
        .filter((el) => el !== indicator && el !== hoverPill)
        .forEach((el, i) => el.style.setProperty('--i', i));

    // Motor de resortes
    const springs = [];
    const spring = (v = 0, k = 380, d = 30, eps = 0.1) => {
        const s = { v, vel: 0, t: v, k, d, eps, free: false };
        springs.push(s);
        return s;
    };
    const X = spring(), Y = spring(), W = spring(), H = spring();
    const V = spring(0, 500, 38, 0.001);        // visibilidad del indicador
    const L = spring(0, 450, 26, 0.001);        // lente al arrastrar
    const O = spring(0, 380, 34, 0.001);        // apertura del cajón mobile
    // Resaltado que sigue al cursor
    const HX = spring(0, 520, 36), HY = spring(0, 520, 36), HW = spring(0, 520, 36), HH = spring(0, 520, 36);
    const HV = spring(0, 600, 44, 0.001);

    function step(s, dt) {
        if (s.free) return;
        if (reduce.matches) { s.v = s.t; s.vel = 0; return; }
        s.vel += (-s.k * (s.v - s.t) - s.d * s.vel) * dt;
        s.v += s.vel * dt;
    }
    const atRest = (s) => !s.free && Math.abs(s.v - s.t) < s.eps && Math.abs(s.vel) < s.eps * 5;
    let raf = null, last = 0;
    function tick(now) {
        const dt = Math.min((now - last) / 1000, 1 / 30);
        last = now;
        springs.forEach((s) => step(s, dt));
        render();
        if (springs.every(atRest)) {
            springs.forEach((s) => { s.v = s.t; s.vel = 0; });
            render();
            raf = null;
            return;
        }
        raf = requestAnimationFrame(tick);
    }
    function kick() {
        if (raf) return;
        last = performance.now();
        raf = requestAnimationFrame(tick);
    }

    // Links visibles de la lista (sin "Cerrar sesión", que va abajo)
    const navItems = () => [...scroll.querySelectorAll('.sb-item')].filter((el) => el.offsetParent !== null);
    // Contraído en escritorio el resaltado es un círculo centrado en el ícono;
    // expandido o en mobile es una cápsula del ancho de la fila
    const rectOf = (el) => {
        if (!isMobile() && !sidebar.classList.contains('expanded')) {
            const size = el.offsetHeight;
            return { x: el.offsetLeft + (el.offsetWidth - size) / 2, y: el.offsetTop, w: size, h: size };
        }
        return { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
    };

    function render() {
        const st = Math.min(Math.abs(Y.vel) / 1600, 0.25);
        const lift = 1 + L.v * 0.05;
        indicator.style.width = `${W.v}px`;
        indicator.style.height = `${H.v}px`;
        indicator.style.opacity = clamp(V.v);
        indicator.style.transform = `translate(${X.v}px, ${Y.v}px) scale(${(1 - st * 0.2) * lift}, ${(1 + st) * lift})`;

        if (typeof renderTip === 'function') renderTip();

        if (hoverPill) {
            const hst = Math.min(Math.abs(HY.vel) / 2200, 0.2);
            hoverPill.style.width = `${HW.v}px`;
            hoverPill.style.height = `${HH.v}px`;
            hoverPill.style.opacity = clamp(HV.v);
            hoverPill.style.transform = `translate(${HX.v}px, ${HY.v}px) scale(${1 - hst * 0.2}, ${1 + hst})`;
        }

        if (isMobile()) {
            const w = sidebar.offsetWidth + 24;
            sidebar.style.transform = `translateX(${(O.v - 1) * w}px)`;
            if (mobileOverlay) mobileOverlay.style.opacity = clamp(O.v);
        } else {
            sidebar.style.transform = '';
            if (mobileOverlay) mobileOverlay.style.opacity = '';
        }
    }

    function retarget(snap = false) {
        const el = scroll.querySelector('.sb-item.active');
        if (!el || el.offsetParent === null) { V.t = 0; kick(); return; }
        const r = rectOf(el);
        X.t = r.x; Y.t = r.y; W.t = r.w; H.t = r.h; V.t = 1;
        if (snap || V.v < 0.05) { X.v = r.x; Y.v = r.y; W.v = r.w; H.v = r.h; }
        kick();
    }

    function bounce(el) {
        el.classList.remove('sb-bounce');
        void el.offsetWidth;
        el.classList.add('sb-bounce');
    }

    // ── Etiqueta flotante estilo iOS (escritorio contraído) ─────────
    // Sale de la píldora con resorte, se desliza arriba/abajo siguiendo al
    // cursor, ajusta su ancho al nuevo texto y el texto entra con un
    // pequeño desplazamiento en la dirección del movimiento.
    const tip = document.createElement('div');
    tip.className = 'sb-tip';
    tip.setAttribute('role', 'tooltip');
    tip.innerHTML = '<span class="sb-tip-text"></span>';
    document.body.appendChild(tip);
    const tipText = tip.firstChild;
    const tipMeasure = document.createElement('span');
    tipMeasure.className = 'sb-tip-measure';
    document.body.appendChild(tipMeasure);

    const TIP_H = 32, TIP_PAD = 28;
    const TY = spring(0, 420, 32), TW = spring(0, 420, 34);
    const TV = spring(0, 380, 26, 0.001);
    let tipEl = null, tipLabel = '';

    function labelOf(el) {
        const lbl = el.querySelector('.sb-label');
        return lbl ? lbl.innerText.trim() : '';
    }

    function tipTo(el, text) {
        if (!el || isMobile() || isExpanded() || !text) { hideTip(); return; }
        const r = el.getBoundingClientRect();
        const y = r.top + r.height / 2 - TIP_H / 2;
        tipMeasure.textContent = text;
        const w = tipMeasure.offsetWidth;
        const fromHidden = TV.v < 0.05;

        if (text !== tipLabel) {
            tipLabel = text;
            tipText.textContent = text;
            if (!fromHidden) {
                // El texto nuevo entra desde la dirección hacia donde se mueve el cursor
                tipText.classList.remove('from-up', 'from-down');
                void tipText.offsetWidth;
                tipText.classList.add(y > TY.t ? 'from-down' : 'from-up');
            }
        }
        if (fromHidden) { TY.v = y; TW.v = w; TY.vel = TW.vel = 0; }   // aparece junto al ícono
        tipEl = el;
        TY.t = y; TW.t = w; TV.t = 1;
        tip.style.left = `${sidebar.getBoundingClientRect().right + 12}px`;
        kick();
    }
    function showTip(el) { tipTo(el, el ? labelOf(el) : ''); }
    function hideTip() {
        if (TV.t === 0) return;
        TV.t = 0;
        tipEl = null;
        kick();
    }

    function renderTip() {
        const v = clamp(TV.v);
        if (v < 0.01 && TV.t === 0) { tip.style.visibility = 'hidden'; tipLabel = ''; return; }
        tip.style.visibility = 'visible';
        const st = Math.min(Math.abs(TY.vel) / 2400, 0.18);
        tip.style.width = `${TW.v + TIP_PAD}px`;
        tip.style.opacity = Math.min(1, v * 1.5);
        tip.style.transform = `translate(${(1 - TV.v) * -14}px, ${TY.v}px) scale(${(0.55 + 0.45 * TV.v) * (1 - st * 0.3)}, ${(0.55 + 0.45 * TV.v) * (1 + st)})`;
    }

    // Botón de expandir y lupa también muestran etiqueta
    toggleBtn?.addEventListener('pointerenter', (e) => {
        if (e.pointerType === 'mouse' && !g) tipTo(toggleBtn, toggleBtn.getAttribute('aria-label'));
    });
    searchBox?.addEventListener('pointerenter', (e) => {
        if (e.pointerType === 'mouse' && !g) tipTo(searchBox, searchInput.placeholder);
    });
    sidebar.addEventListener('pointerleave', hideTip);

    // ── Hover que se desliza de opción en opción siguiendo al cursor ──
    let hovered = null;
    function hoverTo(el) {
        if (el === hovered) return;
        hovered = el;
        if (!el) { HV.t = 0; kick(); return; }
        const r = rectOf(el);
        HX.t = r.x; HY.t = r.y; HW.t = r.w; HH.t = r.h; HV.t = 1;
        if (HV.v < 0.05) { HX.v = r.x; HY.v = r.y; HW.v = r.w; HH.v = r.h; }   // aparece en su lugar
        kick();
    }
    scroll.addEventListener('pointermove', (e) => {
        if (e.pointerType !== 'mouse' || isMobile() || g) return;
        const el = navItems().find((it) => {
            const r = it.getBoundingClientRect();
            return e.clientY >= r.top && e.clientY <= r.bottom && e.clientX >= r.left && e.clientX <= r.right;
        }) || null;
        if (el) { hoverTo(el); showTip(el); }     // en los huecos entre opciones se conserva el último
    });
    scroll.addEventListener('pointerleave', () => hoverTo(null));
    scroll.addEventListener('scroll', () => hoverTo(null), { passive: true });
    scroll.addEventListener('scroll', hideTip, { passive: true });

    // ── Contraer / expandir (escritorio) ─────────────────────────────
    function updateToggleLabel() {
        if (!toggleBtn) return;
        const exp = isExpanded();
        toggleBtn.setAttribute('aria-expanded', String(exp));
        toggleBtn.setAttribute('aria-label', exp ? t('dash_collapse_menu', 'Contraer menú') : t('dash_expand_menu', 'Expandir menú'));
    }
    function setExpanded(exp, save = true) {
        sidebar.classList.toggle('expanded', exp);
        updateToggleLabel();
        hideTip();
        if (save) { try { localStorage.setItem('sidebarExpanded', exp ? '1' : '0'); } catch (_) {} }
    }
    try { if (localStorage.getItem('sidebarExpanded') === '1') setExpanded(true, false); } catch (_) {}
    toggleBtn?.addEventListener('click', () => { setExpanded(!isExpanded()); hoverTo(null); });

    // ── Buscador: filtra las opciones del menú ───────────────────────
    function updateGroups() {
        // Un título de grupo se oculta si no le queda ninguna opción visible
        let group = null, hasItems = false;
        const flush = () => { if (group) group.classList.toggle('sb-filtered', !hasItems); };
        [...scroll.children].forEach((el) => {
            if (el.classList.contains('sb-group')) { flush(); group = el; hasItems = false; }
            else if (el.classList.contains('sb-item') && el.style.display !== 'none' && !el.classList.contains('sb-filtered')) hasItems = true;
        });
        flush();
    }
    function filterMenu(q) {
        const n = normalizeStr(q.trim());
        let any = false;
        scroll.querySelectorAll('.sb-item').forEach((el) => {
            const match = !n || normalizeStr(labelOf(el)).includes(n);
            el.classList.toggle('sb-filtered', !match);
            if (match && el.style.display !== 'none') any = true;
        });
        updateGroups();
        if (emptyMsg) emptyMsg.hidden = any;
        retarget(true);
    }
    searchInput?.addEventListener('input', () => filterMenu(searchInput.value));
    searchInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { searchInput.value = ''; filterMenu(''); searchInput.blur(); }
        if (e.key === 'Enter') {
            const first = navItems()[0];
            if (first) { e.preventDefault(); first.click(); }
        }
        if (e.key === 'ArrowDown') { const first = navItems()[0]; if (first) { e.preventDefault(); first.focus(); } }
    });
    // Contraído: tocar la lupa expande el panel y enfoca el buscador
    searchBox?.addEventListener('click', (e) => {
        if (!isMobile() && !isExpanded()) {
            e.preventDefault();
            setExpanded(true);
            setTimeout(() => searchInput.focus(), 260);
        }
    });

    // ── Ir a una página: el indicador llega primero y luego se navega ─
    function goTo(link) {
        buttons.forEach((b) => b.classList.toggle('active', b === link));
        retarget();
        bounce(link);
        if (navigator.vibrate) navigator.vibrate(8);
        const href = link.href;
        setTimeout(() => {
            if (isMobile()) closeMobileSidebar();
            window.location.href = href;
        }, reduce.matches ? 0 : 200);
    }

    // ── Cajón mobile ─────────────────────────────────────────────────
    const isOpen = () => sidebar.classList.contains('mobile-active');

    function openMobileSidebar() {
        O.t = 1;
        sidebar.classList.add('mobile-active');
        sidebar.inert = false;
        mobileOverlay?.classList.add('active');
        mobileMenuBtn?.classList.add('active');
        mobileMenuBtn?.setAttribute('aria-expanded', 'true');
        document.body.style.overflow = 'hidden';
        requestAnimationFrame(() => retarget(true));
        kick();
    }
    function closeMobileSidebar() {
        O.t = 0;
        sidebar.classList.remove('mobile-active');
        if (isMobile()) sidebar.inert = true;
        mobileOverlay?.classList.remove('active');
        mobileMenuBtn?.classList.remove('active');
        mobileMenuBtn?.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
        kick();
    }

    mobileMenuBtn?.addEventListener('click', () => {
        isOpen() ? closeMobileSidebar() : openMobileSidebar();
    });
    mobileOverlay?.addEventListener('click', closeMobileSidebar);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen()) closeMobileSidebar(); });

    mqMobile.addEventListener('change', () => {
        O.v = O.t = 0; O.vel = 0;
        sidebar.classList.remove('mobile-active');
        mobileOverlay?.classList.remove('active');
        mobileMenuBtn?.classList.remove('active');
        document.body.style.overflow = '';
        sidebar.inert = isMobile();
        hideTip();
        render();
        requestAnimationFrame(() => retarget(true));
    });

    // ── Gestos: tocar, arrastrar para recorrer, deslizar el cajón ────
    let g = null, suppressClick = false;

    function begin(e, fromEdge = false) {
        if (e.button > 0) return;
        const inList = !!e.target.closest('.sb-scroll');
        g = { id: e.pointerId, type: e.pointerType, x0: e.clientX, y0: e.clientY, t: performance.now(),
              mode: null, inList, hover: null, base: O.v, edge: fromEdge };
        // En táctil hay que mantener presionado para recorrer; así el scroll sigue funcionando
        if (g.type === 'touch' && inList) g.timer = setTimeout(() => { if (g && !g.mode) startScrub(); }, 300);
    }
    sidebar.addEventListener('pointerdown', (e) => {
        if (e.target.closest('input, .sb-toggle')) return;
        begin(e);
    });
    // Deslizar desde el borde izquierdo abre el cajón en mobile
    document.addEventListener('pointerdown', (e) => {
        if (isMobile() && !isOpen() && e.clientX < 20 && !sidebar.contains(e.target)) begin(e, true);
    });

    function nearest(clientY) {
        let best = null, dist = Infinity;
        navItems().forEach((el) => {
            const r = el.getBoundingClientRect();
            const d = Math.abs(clientY - (r.top + r.height / 2));
            if (d < dist) { dist = d; best = el; }
        });
        return best;
    }

    function startScrub() {
        if (!navItems().length) return;
        g.mode = 'scrub';
        clearTimeout(g.timer);
        hoverTo(null);
        Y.free = true;
        L.t = 1; V.t = 1;
        indicator.classList.add('lifted');
        if (navigator.vibrate) navigator.vibrate(8);
    }

    window.addEventListener('pointermove', (e) => {
        if (!g || e.pointerId !== g.id) return;
        const dx = e.clientX - g.x0, dy = e.clientY - g.y0, dist = Math.hypot(dx, dy);
        if (!g.mode) {
            if (isMobile() && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
                clearTimeout(g.timer);
                g.mode = 'drawer';
                O.free = true;
            } else if (!g.edge && g.inList && g.type !== 'touch' && dist > 6) {
                startScrub();
                if (!g.mode) return;
            } else if (dist > 8) {
                clearTimeout(g.timer);
                g = null;
                return;
            } else return;
        }
        const now = performance.now(), dt = Math.max((now - g.t) / 1000, 0.001);
        g.t = now;

        if (g.mode === 'drawer') {
            const w = sidebar.offsetWidth + 24;
            let v = g.base + dx / w;
            if (v > 1) v = 1 + (v - 1) * 0.15;
            if (v < 0) v = 0;
            O.vel = (v - O.v) / dt;
            O.v = v;
            kick();
            return;
        }

        // Recorrido: la lente sigue al dedo con resistencia en los bordes
        const items = navItems();
        const c = scroll.getBoundingClientRect();
        const first = rectOf(items[0]), lastR = rectOf(items[items.length - 1]);
        let y = e.clientY - c.top + scroll.scrollTop - H.v / 2;
        if (y < first.y) y = first.y - Math.sqrt(first.y - y) * 2;
        if (y > lastR.y) y = lastR.y + Math.sqrt(y - lastR.y) * 2;
        Y.vel = (y - Y.v) / dt;
        Y.v = y;

        const h = nearest(e.clientY);
        if (h && h !== g.hover) {
            g.hover = h;
            items.forEach((el) => el.classList.toggle('sb-hover', el === h));
            const r = rectOf(h);
            X.t = r.x; W.t = r.w; H.t = r.h;
            showTip(h);
            if (navigator.vibrate) navigator.vibrate(4);
        }
        kick();
    });

    function endGesture(e) {
        if (!g || e.pointerId !== g.id) return;
        clearTimeout(g.timer);
        if (g.mode === 'drawer') {
            O.free = false;
            const v = O.vel;
            (v > 1.2 ? true : v < -1.2 ? false : O.v > 0.5) ? openMobileSidebar() : closeMobileSidebar();
        } else if (g.mode === 'scrub') {
            Y.free = false;
            L.t = 0;
            indicator.classList.remove('lifted');
            navItems().forEach((el) => el.classList.remove('sb-hover'));
            hideTip();
            // Soltar lejos del panel cancela el recorrido
            const s = sidebar.getBoundingClientRect();
            const inside = e.clientX > s.left - 40 && e.clientX < s.right + 40 && e.clientY > s.top - 40 && e.clientY < s.bottom + 40;
            const h = inside ? g.hover : null;
            if (e.type === 'pointerup' && h) {
                h.click();                       // pasa por el mismo manejo que un clic normal
                suppressClick = true;            // evita el clic nativo que llega después
                setTimeout(() => { suppressClick = false; }, 60);
            } else retarget();
        }
        g = null;
        kick();
    }
    window.addEventListener('pointerup', endGesture);
    window.addEventListener('pointercancel', endGesture);
    document.addEventListener('touchmove', (e) => { if (g && g.mode) e.preventDefault(); }, { passive: false });
    sidebar.addEventListener('contextmenu', (e) => { if (g && g.mode) e.preventDefault(); });
    sidebar.addEventListener('dragstart', (e) => e.preventDefault());

    // Clic en un link: animar antes de navegar (salvo enlaces externos,
    // deshabilitados o con Ctrl/Cmd, que siguen su comportamiento normal)
    sidebar.addEventListener('click', (e) => {
        if (suppressClick && e.isTrusted) { e.preventDefault(); e.stopImmediatePropagation(); return; }
        const link = e.target.closest('a.sb-item');
        if (!link || e.defaultPrevented) return;
        const href = link.getAttribute('href');
        if (!href || href === '#' || link.target === '_blank' || link.getAttribute('data-disabled') === 'true') return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        goTo(link);
    });

    // Teclado: flechas para moverse entre opciones
    scroll.addEventListener('keydown', (e) => {
        const items = navItems(), i = items.indexOf(document.activeElement);
        if (i < 0) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); items[Math.min(i + 1, items.length - 1)].focus(); }
        if (e.key === 'ArrowUp') { e.preventDefault(); i === 0 ? searchInput?.focus() : items[i - 1].focus(); }
    });

    // Si aparecen u ocultan ítems (plan, giro) o cambia el ancho, el indicador se reacomoda
    if ('ResizeObserver' in window) new ResizeObserver(() => retarget()).observe(sidebar);
    const itemObserver = new MutationObserver(() => { updateGroups(); retarget(); });
    scroll.querySelectorAll('.sb-item').forEach((b) => itemObserver.observe(b, { attributes: true, attributeFilter: ['style'] }));

    // ── Logout ───────────────────────────────────────────────────────
    document.getElementById('logoutBtn')?.addEventListener('click', async () => {
        try {
            const response = await fetch('/api/logout', { method: 'POST', credentials: 'include' });
            if (response.ok) window.location.href = '/login';
        } catch (error) { console.error('Error:', error); }
    });

    // ── Init ─────────────────────────────────────────────────────────
    setActivePage();
    applyUiTexts();
    updateGroups();
    sidebar.inert = isMobile();
    render();
    requestAnimationFrame(() => retarget(true));
    checkUserPlan();

})();