// ============================================
// SIDEBAR JAVASCRIPT
// Envuelto en IIFE para aislar todas las
// variables del scope global y evitar colisiones
// con userbar.js u otros scripts en la misma página.
// ============================================

(function () {

    // Guard: si el sidebar no está en esta página, no hacer nada
    if (!document.getElementById('sidebar')) return;

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
            .replace(/[\u0300-\u036f]/g, '')
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
    const sidebar         = document.getElementById('sidebar');
    const mobileMenuBtn   = document.getElementById('mobileMenuBtn');
    const mobileOverlay   = document.getElementById('mobileOverlay');
    const messagesLink    = document.getElementById('messagesLink');
    const messagesText    = messagesLink?.querySelector('.messages-text');
    const messagesLoading = messagesLink?.querySelector('.messages-loading');
    const crmItem         = document.getElementById('crmMenuItem');
    const buttons         = document.querySelectorAll('.icon-button');
    let   isMobile        = window.innerWidth <= 768;

    // ✅ CRM: disponible para todos los planes desde el arranque, incluido
    // el plan gratuito. Antes solo se agregaba por defecto con plan Proton;
    // esto es un display explícito, no depende de checkUserPlan() ni de que
    // el fetch a /api/me responda (incluso si falla, el CRM sigue visible).
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
        toast.style.cssText = 'position:fixed;top:24px;right:24px;background:#06b6d4;color:white;padding:16px 24px;border-radius:12px;box-shadow:0 10px 25px rgba(6,182,212,0.25);z-index:10000;max-width:400px;';
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
                const isClinic = TIPOS_CLINICA.some(t => normalizeStr(userBizType).includes(normalizeStr(t)));
                const isSalon  = TIPOS_PELUQUERIA.some(t => normalizeStr(userBizType).includes(normalizeStr(t)));
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
        }
    }

    // ── Página activa ────────────────────────────────────────────────
    function setActivePage() {
        const currentPath = window.location.pathname;
        buttons.forEach(button => {
            button.classList.remove('active');
            const buttonPath = button.getAttribute('href');
            if (buttonPath && currentPath.includes(buttonPath) && buttonPath !== '#')
                button.classList.add('active');
        });
    }

    // ── Sidebar móvil ────────────────────────────────────────────────
    function openMobileSidebar() {
        sidebar.classList.add('mobile-active');
        mobileOverlay.classList.add('active');
        mobileMenuBtn.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
    function closeMobileSidebar() {
        sidebar.classList.remove('mobile-active');
        mobileOverlay.classList.remove('active');
        mobileMenuBtn.classList.remove('active');
        document.body.style.overflow = '';
    }

    // ── Event listeners (con guards por si el elemento no existe) ────
    mobileMenuBtn?.addEventListener('click', () => {
        sidebar.classList.contains('mobile-active') ? closeMobileSidebar() : openMobileSidebar();
    });
    mobileOverlay?.addEventListener('click', closeMobileSidebar);

    window.addEventListener('resize', () => {
        const wasMobile = isMobile;
        isMobile = window.innerWidth <= 768;
        if (wasMobile && !isMobile) closeMobileSidebar();
    });

    document.getElementById('logoutBtn')?.addEventListener('click', async () => {
        try {
            const response = await fetch('/api/logout', { method: 'POST', credentials: 'include' });
            if (response.ok) window.location.href = '/login';
        } catch (error) { console.error('Error:', error); }
    });

    // ── Init ─────────────────────────────────────────────────────────
    setActivePage();
    checkUserPlan();

})();