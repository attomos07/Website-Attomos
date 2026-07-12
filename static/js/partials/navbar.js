// ============================================
// NAVBAR MOBILE MENU - iOS Style & Active Logic
// ============================================

document.addEventListener('DOMContentLoaded', function () {
    console.log('🔧 Navbar: Inicializando...');

    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const navMenu = document.getElementById('navMenu');
    const navbar = document.getElementById('navbar');
    const body = document.body;

    if (!mobileMenuBtn || !navMenu) {
        console.error('❌ Error: No se encontraron los elementos del DOM');
        return;
    }

    // --- 1. GESTIÓN DEL MENÚ MÓVIL (iOS Style) ---

    function openMobileMenu() {
        mobileMenuBtn.classList.add('active');
        navMenu.classList.add('active');
        body.classList.add('menu-open');
        mobileMenuBtn.setAttribute('aria-expanded', 'true');
    }

    function closeMobileMenu() {
        mobileMenuBtn.classList.remove('active');
        navMenu.classList.remove('active');
        body.classList.remove('menu-open');
        mobileMenuBtn.setAttribute('aria-expanded', 'false');
    }

    // Toggle con click
    mobileMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isActive = navMenu.classList.contains('active');
        isActive ? closeMobileMenu() : openMobileMenu();
    });

    // Cerrar al hacer click en un link
    const allLinks = document.querySelectorAll('.nav-link');
    allLinks.forEach(link => {
        link.addEventListener('click', () => {
            // Cerramos con un pequeño delay para dejar que la animación de iOS se aprecie
            setTimeout(closeMobileMenu, 150);
        });
    });

    // Cerrar con tecla ESC
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeMobileMenu();
    });

    // Cerrar al redimensionar (si pasa a desktop)
    window.addEventListener('resize', () => {
        if (window.innerWidth > 768) closeMobileMenu();
    });

    // --- 2. EFECTO SCROLL ---
    window.addEventListener('scroll', () => {
        if (navbar) {
            window.scrollY > 10
                ? navbar.classList.add('scrolled')
                : navbar.classList.remove('scrolled');
        }
    });

    // --- 3. LÓGICA DE ESTADO ACTIVO (FIX: Agentes vs Blog) ---
    setActiveNavLink();

    console.log('✅ Navbar: Inicializado correctamente');
});

function setActiveNavLink() {
    // Obtenemos el pathname y lo normalizamos
    // - minúsculas
    // - sin "/" final
    const currentPath = window.location.pathname
        .toLowerCase()
        .replace(/\/$/, "");

    // Seleccionamos solo los links reales del menú
    const navLinks = document.querySelectorAll(
        '.nav-menu .nav-link:not(.nav-cta):not(.nav-login)'
    );

    let matchFound = false;

    navLinks.forEach(link => {
        // Limpiamos cualquier estado previo
        link.classList.remove('active');

        // Normalizamos el href del link
        const linkHref = link.getAttribute('href')
            .toLowerCase()
            .replace(/\/$/, "");

        // Match exacto: /blog === /blog
        const isExactMatch = currentPath === linkHref;

        // Match por subruta: /blog/post-1 → /blog
        // Excluimos "/" para que no coincida con todo
        const isSubPageMatch =
            linkHref !== "" &&
            linkHref !== "/" &&
            currentPath.startsWith(linkHref + "/");

        if (isExactMatch || isSubPageMatch) {
            link.classList.add('active');
            matchFound = true;
            return; // ⛔ evita que otro link se active
        }
    });

    // Fallback solo para el home real "/"
    if (!matchFound && (currentPath === "" || currentPath === "/")) {
        const homeLink = document.querySelector('.nav-link[href="/"]');
        if (homeLink) {
            homeLink.classList.add('active');
        }
    }
}


// ============================================
// NAVBAR USERBAR — Sesión activa
// ============================================

(function initNavbarUserbar() {

    // ── Helpers de plan y tipo de negocio (idénticos a userbar.js) ──
    const PLAN_NAMES = {
        'gratuito': 'Plan Gratuito', 'proton': 'Plan Protón',
        'neutron': 'Plan Neutrón', 'electron': 'Plan Electrón',
        'pending': 'Pago Pendiente'
    };
    const BUSINESS_TYPES = {
        'clinica-dental': 'Clínica Dental', 'peluqueria': 'Peluquería',
        'restaurante': 'Restaurante', 'pizzeria': 'Pizzería',
        'escuela': 'Educación', 'gym': 'Gimnasio', 'spa': 'Spa & Wellness',
        'consultorio': 'Consultorio Médico', 'veterinaria': 'Veterinaria',
        'hotel': 'Hotel', 'tienda': 'Tienda', 'agencia': 'Agencia', 'otro': 'Otro'
    };

    // ── Mostrar UI de usuario logueado ──────────────────────────────
    function showUserState(user) {
        const guest  = document.getElementById('navAuthGuest');
        const logged = document.getElementById('navAuthUser');

        if (guest)  guest.style.display  = 'none';
        if (logged) logged.style.display = 'flex';

        // Ocultar botones auth del menú mobile: lo controla el CSS vía la clase is-logged-in
        // (evita depender de window.innerWidth, que solo se evalúa una vez al cargar)
        const navbarEl = document.getElementById('navbar');
        if (navbarEl) navbarEl.classList.add('is-logged-in');

        // Nombre
        const nameEl = document.getElementById('userName');
        if (nameEl) nameEl.textContent = user.firstName || user.company || 'Mi Empresa';

        // Rol
        const roleEl = document.getElementById('userRole');
        if (roleEl) roleEl.textContent = BUSINESS_TYPES[user.businessType] || user.businessType || 'Negocio';

        // Plan
        const planEl = document.getElementById('userPlan');
        if (planEl && user.currentPlan) planEl.textContent = PLAN_NAMES[user.currentPlan] || 'Plan Gratuito';

        // Avatar
        const imgEl  = document.getElementById('userAvatarImg');
        const initEl = document.getElementById('userInitials');
        if (user.profileImage && imgEl) {
            imgEl.src = user.profileImage;
            imgEl.style.display = 'block';
            if (initEl) initEl.style.display = 'none';
        } else if (initEl) {
            const name = user.firstName || user.company || 'U';
            initEl.textContent = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
        }

        localStorage.setItem('userData', JSON.stringify(user));

        // Citas vs Pedidos según giro de negocio (igual que userbar y sidebar)
        const GIROS_COMIDA = ['pizzeria','pizza','mariscos','gorditas','restaurante','taqueria','tacos','hamburguesas','sushi','comida'];
        const bizType = (user.businessType || '').toLowerCase();
        const isFood  = GIROS_COMIDA.some(g => bizType.includes(g));
        const citasItem   = document.getElementById('navDropdownCitasItem');
        const pedidosItem = document.getElementById('navDropdownPedidosItem');
        if (citasItem)   citasItem.style.display   = isFood ? 'none' : '';
        if (pedidosItem) pedidosItem.style.display  = isFood ? ''     : 'none';

        // Inicializar interactividad solo una vez
        if (!window._navbarUBInitialized) {
            window._navbarUBInitialized = true;
            _initDropdown();
            _initNotifications();
            _initLogout();
        }
    }

    // ── Mostrar UI de usuario no logueado ───────────────────────────
    function showGuestState() {
        const guest = document.getElementById('navAuthGuest');
        const logged = document.getElementById('navAuthUser');
        if (guest)  guest.style.display = 'flex';
        if (logged) logged.style.display = 'none';

        // Mostrar botones auth del menú mobile: quitamos la clase is-logged-in,
        // el CSS ya se encarga de mostrarlos solo en viewport mobile
        const navbarEl = document.getElementById('navbar');
        if (navbarEl) navbarEl.classList.remove('is-logged-in');

        window._navbarUBInitialized = false;
        localStorage.removeItem('userData');
    }

    // ── Cargar sesión ───────────────────────────────────────────────
    async function loadSession() {
        const cached = localStorage.getItem('userData');

        try {
            const res = await fetch('/api/me', { credentials: 'include' });
            if (res.ok) {
                const data = await res.json();
                showUserState(data.user);
            } else {
                localStorage.removeItem('userData');
                showGuestState();
            }
        } catch(e) {
            // Sin conexión: usar caché solo si existe, si no mostrar guest
            if (cached) {
                try { showUserState(JSON.parse(cached)); } catch(e2) { showGuestState(); }
            } else {
                showGuestState();
            }
        }
    }

    // ── Dropdown (hover desktop + tap mobile) ──────────────────────
    function _initDropdown() {
        const avatar   = document.getElementById('userAvatar');
        const dropdown = document.getElementById('userDropdown');
        if (!avatar || !dropdown) return;

        let hA = false, hD = false;
        const open  = () => dropdown.classList.add('is-open');
        const close = () => setTimeout(() => { if (!hA && !hD) dropdown.classList.remove('is-open'); }, 120);

        // Desktop: hover
        avatar.addEventListener('mouseenter',   () => { hA = true;  open(); });
        avatar.addEventListener('mouseleave',   () => { hA = false; close(); });
        dropdown.addEventListener('mouseenter', () => { hD = true;  open(); });
        dropdown.addEventListener('mouseleave', () => { hD = false; close(); });

        // Mobile: tap toggle
        avatar.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = dropdown.classList.contains('is-open');
            // Cerrar el panel de notificaciones si está abierto
            const panel = document.getElementById('notificationPanel');
            if (panel) panel.classList.remove('is-open');
            isOpen ? dropdown.classList.remove('is-open') : open();
        });

        // Cerrar al hacer click fuera
        document.addEventListener('click', () => dropdown.classList.remove('is-open'));
        dropdown.addEventListener('click', (e) => e.stopPropagation());
    }

    // ── Notificaciones (hover desktop + tap mobile) ─────────────────
    function _initNotifications() {
        const btn   = document.getElementById('notificationBtn');
        const panel = document.getElementById('notificationPanel');
        if (!btn || !panel) return;

        let hB = false, hP = false;
        const openP  = () => panel.classList.add('is-open');
        const closeP = () => setTimeout(() => { if (!hB && !hP) panel.classList.remove('is-open'); }, 120);

        // Desktop: hover
        btn.addEventListener('mouseenter',   () => { hB = true;  openP(); });
        btn.addEventListener('mouseleave',   () => { hB = false; closeP(); });
        panel.addEventListener('mouseenter', () => { hP = true;  openP(); });
        panel.addEventListener('mouseleave', () => { hP = false; closeP(); });

        // Mobile: tap toggle
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = panel.classList.contains('is-open');
            // Cerrar el dropdown del avatar si está abierto
            const dropdown = document.getElementById('userDropdown');
            if (dropdown) dropdown.classList.remove('is-open');
            isOpen ? panel.classList.remove('is-open') : openP();
        });

        // Cerrar al hacer click fuera
        document.addEventListener('click', () => panel.classList.remove('is-open'));
        panel.addEventListener('click', (e) => e.stopPropagation());

        // Marcar todas como leídas
        const markAll = document.getElementById('markAllBtn');
        if (markAll) {
            markAll.addEventListener('click', () => {
                document.querySelectorAll('#notificationList .notification-item.unread')
                    .forEach(i => i.classList.remove('unread'));
                const badge = document.getElementById('notificationBadge');
                if (badge) badge.classList.add('hidden');
            });
        }

        // Cargar citas como notificaciones
        fetch('/api/appointments', { credentials: 'include' })
            .then(r => r.ok ? r.json() : { appointments: [] })
            .then(data => _renderNotifications(_buildNotifications(data.appointments || [])))
            .catch(() => _renderNotifications([]));

        // Refresh cada 5 min
        setInterval(() => {
            fetch('/api/appointments', { credentials: 'include' })
                .then(r => r.ok ? r.json() : { appointments: [] })
                .then(data => _renderNotifications(_buildNotifications(data.appointments || [])))
                .catch(() => {});
        }, 5 * 60 * 1000);
    }

    function _buildNotifications(appointments) {
        const now = new Date();
        const pad = n => String(n).padStart(2, '0');
        const todayStr    = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
        const tomorrowD   = new Date(now); tomorrowD.setDate(tomorrowD.getDate() + 1);
        const tomorrowStr = `${tomorrowD.getFullYear()}-${pad(tomorrowD.getMonth()+1)}-${pad(tomorrowD.getDate())}`;
        const active = appointments.filter(a => a.status !== 'cancelled');
        const notifs = [];

        active.filter(a => a.date === todayStr).forEach(a => {
            const [h,m]    = a.time.split(':').map(Number);
            const apptTime = new Date(now); apptTime.setHours(h,m,0,0);
            const diff     = (apptTime - now) / 60000;
            if (diff > 0 && diff <= 60) {
                notifs.push({ type:'urgent', text:`⏰ Cita con <strong>${a.client}</strong> en ${Math.round(diff)} min (${a.time})`, time:'En breve', unread:true });
            } else if (diff > 60) {
                notifs.push({ type:'appointment', text:`📅 <strong>${a.client}</strong> — ${a.service} a las ${a.time}`, time:'Hoy', unread:true });
            }
        });

        const tomorrow = active.filter(a => a.date === tomorrowStr);
        if (tomorrow.length) {
            notifs.push({ type:'warning', text:`Tienes <strong>${tomorrow.length} cita${tomorrow.length>1?'s':''}</strong> para mañana`, time:'Mañana', unread:true });
        }
        return notifs;
    }

    function _renderNotifications(notifs) {
        const list  = document.getElementById('notificationList');
        const badge = document.getElementById('notificationBadge');
        if (!list) return;

        if (!notifs.length) {
            list.innerHTML = `
                <div style="padding:28px 20px;text-align:center;color:#9ca3af;">
                    <svg viewBox="0 0 24 24" style="width:36px;height:36px;stroke:#d1d5db;stroke-width:1.5;fill:none;margin:0 auto 10px;display:block;">
                        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                        <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                    </svg>
                    <div style="font-size:13px;font-weight:500;">Sin notificaciones</div>
                    <div style="font-size:11px;margin-top:3px;">No hay citas próximas</div>
                </div>`;
            if (badge) badge.classList.add('hidden');
            return;
        }

        list.innerHTML = notifs.map((n, i) => `
            <div class="notification-item ${n.unread?'unread':''}" data-idx="${i}">
                <div class="notification-content">
                    <div class="notification-icon">
                        <svg viewBox="0 0 24 24"><rect width="18" height="18" x="3" y="4" rx="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
                    </div>
                    <div class="notification-body">
                        <div class="notification-text">${n.text}</div>
                        <div class="notification-time">${n.time}</div>
                    </div>
                    <button class="notif-dismiss-btn" data-idx="${i}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>
            </div>`).join('');

        // Dismiss individual
        list.querySelectorAll('.notif-dismiss-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const item = list.querySelector(`.notification-item[data-idx="${btn.dataset.idx}"]`);
                if (item) {
                    item.style.transition = 'opacity 0.2s, transform 0.2s';
                    item.style.opacity = '0';
                    item.style.transform = 'translateX(16px)';
                    setTimeout(() => {
                        notifs.splice(parseInt(btn.dataset.idx), 1);
                        _renderNotifications(notifs);
                    }, 200);
                }
            });
        });

        const unread = notifs.filter(n => n.unread).length;
        if (badge) {
            if (unread > 0) { badge.textContent = unread > 9 ? '9+' : unread; badge.classList.remove('hidden'); }
            else badge.classList.add('hidden');
        }
    }

    // ── Logout ──────────────────────────────────────────────────────
    function _initLogout() {
        const btn = document.getElementById('userbarLogoutBtn');
        if (!btn) return;
        btn.addEventListener('click', async e => {
            e.preventDefault();
            try {
                const res = await fetch('/api/logout', { method:'POST', credentials:'include' });
                if (res.ok) {
                    localStorage.removeItem('userData');
                    window.location.href = '/login';
                }
            } catch(err) { console.error('Error al cerrar sesión:', err); }
        });
    }

    // ── Arrancar cuando el DOM esté listo ───────────────────────────
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadSession);
    } else {
        loadSession();
    }

})();

// ============================================
// LANGUAGE SELECTOR
// ============================================

(function initLangSelector() {
    function setupSelector(selectorId, triggerId, dropdownId, labelId) {
        const selector = document.getElementById(selectorId);
        const trigger  = document.getElementById(triggerId);
        const dropdown = document.getElementById(dropdownId);
        if (!selector || !trigger || !dropdown) return;

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            selector.classList.toggle('open');
        });

        dropdown.querySelectorAll('.lang-option').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const lang = btn.dataset.lang;
                if (window.Translations) {
                    window.Translations.apply(lang);
                }
                selector.classList.remove('open');
                // Sincronizar ambos selectores
                syncActiveOption(lang);
            });
        });

        document.addEventListener('click', () => selector.classList.remove('open'));
        selector.addEventListener('click', (e) => e.stopPropagation());
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') selector.classList.remove('open');
        });
    }

    function syncActiveOption(lang) {
        // Usar FLAG_SVG y LANG_META de Translations si están disponibles
        const FLAG_SVG  = (window.Translations && window.Translations.FLAG_SVG)  || {};
        const LANG_META = (window.Translations && window.Translations.LANG_META) || {};
        const meta = LANG_META[lang] || {};
        const labelHtml = (FLAG_SVG[lang] || '') + ' ' + (meta.code || lang.toUpperCase());

        // Labels — innerHTML para poder meter el SVG
        ['langTriggerLabel', 'langTriggerLabelMobile'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = labelHtml;
        });

        // Active class en todas las opciones de ambos dropdowns
        document.querySelectorAll('#langDropdown .lang-option, #langDropdownMobile .lang-option')
            .forEach(btn => {
                btn.classList.toggle('active', btn.dataset.lang === lang);
            });
    }

    function setup() {
        setupSelector('langSelector',       'langTrigger',       'langDropdown',       'langTriggerLabel');
        setupSelector('langSelectorMobile', 'langTriggerMobile', 'langDropdownMobile', 'langTriggerLabelMobile');

        // Aplicar idioma guardado (si existe) en ambos
        const saved = localStorage.getItem('lang');
        if (saved) syncActiveOption(saved);

        console.log('✅ Lang selector inicializado (desktop + mobile)');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setup);
    } else {
        setup();
    }
})();