// ============================================
// USERBAR JAVASCRIPT - FLOATING DESIGN
// ============================================

// ============================================
// IOS MENU — dropdowns estilo iOS 27
// El menú nace del botón (clip-path con resorte), un indicador de
// resorte sigue al cursor o al dedo, y se puede mantener presionado
// el botón y deslizar hasta una opción para elegirla al soltar.
// Lo usan: selector de idioma, menú del avatar y notificaciones.
// (Mismo módulo que navbar.js; si ya existe en la página no se redefine.)
// ============================================

(function initIOSMenus() {
    if (window.IOSMenu) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
    const lerp = (a, b, t) => a + (b - a) * t;
    const instances = [];

    // ---------- Motor de resortes compartido ----------
    const springs = [];
    const spring = (v = 0, k = 420, d = 32, eps = 0.1) => {
        const s = { v, vel: 0, t: v, k, d, eps, free: false };
        springs.push(s);
        return s;
    };
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
        instances.forEach((i) => i.render());
        if (springs.every(atRest)) {
            springs.forEach((s) => { s.v = s.t; s.vel = 0; });
            instances.forEach((i) => i.render());
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

    let scrubbing = false;
    document.addEventListener('touchmove', (e) => { if (scrubbing) e.preventDefault(); }, { passive: false });

    // origin: elemento desde donde crece el menú (por defecto el botón).
    // En el userbar el menú de la cuenta crece desde toda la píldora.
    function create({ trigger, menu, itemSelector = null, hover = false, portal = false, origin = null, onOpenChange = () => {} }) {
        if (!trigger || !menu) return null;
        menu.classList.add('ios-menu');

        // portal: el menú vive en <body> con posición fija (para abrirlo desde dentro
        // de un contenedor con scroll, como el panel del menú móvil)
        if (portal) {
            document.body.appendChild(menu);
            menu.style.position = 'fixed';
            menu.style.right = 'auto';
            menu.style.zIndex = '10002';
        }
        function place() {
            if (!portal) return;
            const a = trigger.getBoundingClientRect();
            const w = menu.offsetWidth, h = menu.offsetHeight;
            let top = a.bottom + 8;
            if (top + h > window.innerHeight - 12 && a.top - 8 - h > 12) top = a.top - 8 - h;
            const left = clamp(a.right - w, 12, window.innerWidth - w - 12);
            menu.style.top = `${Math.max(12, top)}px`;
            menu.style.left = `${left}px`;
        }
        // Cerrado: además de visibility se recorta por completo, porque un hijo
        // con visibility: visible en línea (p. ej. el nombre del usuario) se seguiría viendo
        const CLOSED_CLIP = 'inset(50% 50% 50% 50%)';
        menu.style.visibility = 'hidden';
        menu.style.clipPath = CLOSED_CLIP;

        let ind = null;
        if (itemSelector) {
            ind = document.createElement('div');
            ind.className = 'ios-menu-ind';
            ind.setAttribute('aria-hidden', 'true');
            menu.prepend(ind);
        }

        const P = spring(0, 380, 28, 0.001);
        const X = spring(), Y = spring(), W = spring(), H = spring();
        const V = spring(0, 600, 44, 0.001);
        const L = spring(0, 450, 26, 0.001);

        // pinned: se abrió con clic/toque, así que salir con el cursor no lo cierra
        let isOpen = false, pinned = false, hl = -1, g = null, suppressClick = false, menuRadius = 16, leaveTimer = null;

        const items = () => itemSelector
            ? [...menu.querySelectorAll(itemSelector)].filter((el) => el.offsetParent !== null)
            : [];

        // Posición relativa al menú (el menú no se escala, solo se recorta)
        function rectOf(el) {
            const m = menu.getBoundingClientRect(), r = el.getBoundingClientRect();
            return {
                x: r.left - m.left - menu.clientLeft,
                y: r.top - m.top - menu.clientTop + menu.scrollTop,
                w: r.width, h: r.height,
            };
        }
        function hitTest(x, y) {
            return items().findIndex((el) => {
                const r = el.getBoundingClientRect();
                return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
            });
        }

        function render() {
            const p = P.v, pc = clamp(p);
            if (p < 0.002 && P.t === 0) {
                menu.style.visibility = 'hidden';
                menu.style.clipPath = CLOSED_CLIP;
                trigger.style.opacity = '';
            } else {
                menu.style.visibility = 'visible';
                menu.style.setProperty('--ios-p', pc.toFixed(3));
                if (isOpen && atRest(P)) {
                    // Abierto y quieto: sin recorte para que se vea la sombra del menú
                    menu.style.clipPath = 'none';
                } else {
                    const a = (origin || trigger).getBoundingClientRect(), c = menu.getBoundingClientRect();
                    const t = lerp(a.top - c.top, 0, p), l = lerp(a.left - c.left, 0, p);
                    const r = lerp(c.right - a.right, 0, p), b = lerp(c.bottom - a.bottom, 0, p);
                    menu.style.clipPath = `inset(${t}px ${r}px ${b}px ${l}px round ${lerp(a.height / 2, menuRadius, pc)}px)`;
                }
            }
            if (ind) {
                const st = Math.min(Math.abs(Y.vel) / 1600, 0.25);
                const lift = 1 + L.v * 0.05;
                ind.style.width = `${W.v}px`;
                ind.style.height = `${H.v}px`;
                ind.style.opacity = clamp(V.v);
                ind.style.transform = `translate(${X.v}px, ${Y.v}px) scale(${(1 - st * 0.15) * lift}, ${(1 + st) * lift})`;
            }
        }

        function highlight(i, { focus = false } = {}) {
            hl = i;
            const list = items();
            list.forEach((el, j) => el.classList.toggle('is-hover', j === i));
            if (!ind) return;
            if (i < 0) { V.t = 0; kick(); return; }
            const r = rectOf(list[i]);
            X.t = r.x; Y.t = r.y; W.t = r.w; H.t = r.h; V.t = 1;
            if (V.v < 0.05) { X.v = r.x; Y.v = r.y; W.v = r.w; H.v = r.h; }
            if (focus) list[i].focus({ preventScroll: true });
            kick();
        }

        function open({ keyboard = false, pin = false } = {}) {
            clearTimeout(leaveTimer);
            if (pin) pinned = true;
            if (isOpen) return;
            instances.forEach((o) => { if (o !== api && o.isOpen()) o.close(); });
            isOpen = true;
            menuRadius = parseFloat(getComputedStyle(menu).borderTopLeftRadius) || 16;
            place();
            onOpenChange(true);
            trigger.setAttribute('aria-expanded', 'true');
            V.v = V.t = 0; hl = -1;
            P.t = 1;
            render();
            if (keyboard) requestAnimationFrame(() => highlight(0, { focus: true }));
            kick();
        }

        function close({ returnFocus = false } = {}) {
            clearTimeout(leaveTimer);
            if (!isOpen) return;
            isOpen = false;
            pinned = false;
            P.t = 0; V.t = 0; L.t = 0;
            X.free = Y.free = false;
            if (ind) ind.classList.remove('lifted');
            items().forEach((el) => el.classList.remove('is-hover'));
            onOpenChange(false);
            trigger.setAttribute('aria-expanded', 'false');
            if (returnFocus) trigger.focus({ preventScroll: true });
            kick();
        }

        // Elegir una opción: rebote, se dispara su clic real y se cierra
        function activate(i, { viaScrub = false } = {}) {
            const el = items()[i];
            if (!el) return;
            el.classList.remove('ios-bounce'); void el.offsetWidth; el.classList.add('ios-bounce');
            if (navigator.vibrate) navigator.vibrate(8);
            if (viaScrub) {
                suppressClick = true;
                setTimeout(() => { el.click(); suppressClick = false; }, 120);
            }
            setTimeout(() => close(), 160);
        }

        // ---------- Gestos ----------
        trigger.setAttribute('aria-haspopup', 'menu');
        trigger.setAttribute('aria-expanded', 'false');

        trigger.addEventListener('pointerdown', (e) => {
            if (e.button > 0) return;
            const wasOpen = isOpen && pinned;
            if (!isOpen) open();
            pinned = true;
            g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t: performance.now(), mode: null, from: 'trigger', wasOpen };
        });
        // Clic de teclado (Enter/Espacio)
        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            if (e.detail === 0) { if (isOpen) close({ returnFocus: true }); else { open({ keyboard: true }); pinned = true; } }
        });
        trigger.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); open({ keyboard: true }); pinned = true; }
        });

        menu.addEventListener('pointerdown', (e) => {
            if (e.button > 0) return;
            const item = hitTest(e.clientX, e.clientY);
            g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t: performance.now(), mode: null, from: 'menu', item };
            if (item >= 0) highlight(item);
        });
        menu.addEventListener('dragstart', (e) => e.preventDefault());
        menu.addEventListener('contextmenu', (e) => { if (g && g.mode) e.preventDefault(); });

        window.addEventListener('pointermove', (e) => {
            if (!isOpen) return;
            if (!g) {
                if (e.pointerType === 'mouse' && itemSelector) {
                    const i = hitTest(e.clientX, e.clientY);
                    if (i !== hl) highlight(i);
                }
                return;
            }
            if (e.pointerId !== g.id || !itemSelector) return;
            if (!g.mode) {
                if (Math.hypot(e.clientX - g.x0, e.clientY - g.y0) < 8) return;
                g.mode = 'scrub';
                scrubbing = true;
                X.free = Y.free = true;
                L.t = 1;
                ind.classList.add('lifted');
            }
            const now = performance.now(), dt = Math.max((now - g.t) / 1000, 0.001);
            g.t = now;
            const i = hitTest(e.clientX, e.clientY);
            if (i !== hl) {
                hl = i;
                const list = items();
                list.forEach((el, j) => el.classList.toggle('is-hover', j === i));
                if (i >= 0) {
                    const r = rectOf(list[i]);
                    W.t = r.w; H.t = r.h; V.t = 1;
                    if (V.v < 0.05) { W.v = r.w; H.v = r.h; }
                    if (navigator.vibrate) navigator.vibrate(4);
                } else V.t = 0;
            }
            // La lente sigue al dedo con resistencia en los bordes
            const m = menu.getBoundingClientRect();
            const rub = (v, lo, hi) => v < lo ? lo - Math.sqrt(lo - v) * 2 : v > hi ? hi + Math.sqrt(v - hi) * 2 : v;
            const x = rub(e.clientX - m.left - W.v / 2, 4, m.width - W.v - 4);
            const y = rub(e.clientY - m.top - H.v / 2 + menu.scrollTop, 4, menu.scrollHeight - H.v - 4);
            if (V.v < 0.05) { X.v = x; Y.v = y; }
            Y.vel = (y - Y.v) / dt;
            X.v = x; Y.v = y;
            kick();
        });

        function endGesture(e) {
            if (!g || e.pointerId !== g.id) return;
            const i = hitTest(e.clientX, e.clientY);
            const wasScrub = g.mode === 'scrub';
            scrubbing = false;
            X.free = Y.free = false;
            L.t = 0;
            if (ind) ind.classList.remove('lifted');
            if (e.type === 'pointerup') {
                if (wasScrub) {
                    if (i >= 0) { highlight(i); activate(i, { viaScrub: true }); }
                    else close();
                } else if (g.from === 'trigger' && g.wasOpen) {
                    close();
                } else if (g.from === 'menu' && i >= 0 && i === g.item) {
                    activate(i);   // el clic real del navegador hace la acción
                }
            }
            if (isOpen && hl >= 0 && !wasScrub) highlight(hl);
            g = null;
            kick();
        }
        window.addEventListener('pointerup', endGesture);
        window.addEventListener('pointercancel', endGesture);

        // Evita el doble clic cuando la opción ya se activó al arrastrar
        menu.addEventListener('click', (e) => {
            if (suppressClick && e.isTrusted) { e.preventDefault(); e.stopPropagation(); }
        }, true);

        // Escritorio: abrir al pasar el cursor (avatar y notificaciones)
        if (hover) {
            const enter = (e) => { if (e.pointerType === 'mouse') { clearTimeout(leaveTimer); open(); } };
            const leave = (e) => {
                if (e.pointerType !== 'mouse' || g || pinned) return;
                clearTimeout(leaveTimer);
                leaveTimer = setTimeout(() => close(), 160);
            };
            trigger.addEventListener('pointerenter', enter);
            trigger.addEventListener('pointerleave', leave);
            menu.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') clearTimeout(leaveTimer); });
            menu.addEventListener('pointerleave', leave);
        }

        // Tocar fuera cierra
        document.addEventListener('pointerdown', (e) => {
            if (isOpen && !menu.contains(e.target) && !trigger.contains(e.target)) close();
        }, true);

        // Teclado dentro del menú
        menu.addEventListener('keydown', (e) => {
            const list = items();
            if (!list.length) { if (e.key === 'Escape') close({ returnFocus: true }); return; }
            if (e.key === 'ArrowDown') { e.preventDefault(); highlight(hl < 0 ? 0 : (hl + 1) % list.length, { focus: true }); }
            if (e.key === 'ArrowUp') { e.preventDefault(); highlight(hl <= 0 ? list.length - 1 : hl - 1, { focus: true }); }
            if (e.key === 'Escape') { e.preventDefault(); close({ returnFocus: true }); }
            if (e.key === 'Tab') close();
        });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen) close({ returnFocus: true }); });
        window.addEventListener('scroll', () => { if (isOpen && !g) close(); }, { passive: true });
        window.addEventListener('resize', () => { if (isOpen) close(); });

        const api = { open, close, isOpen: () => isOpen, render };
        instances.push(api);
        return api;
    }

    window.IOSMenu = { create, closeAll: () => instances.forEach((i) => i.close()) };
})();


// Re-traduce el giro de negocio mostrado (solo en frontend) cuando cambia
// el idioma. El dato crudo (lastRawBusinessType) nunca se toca ni se
// vuelve a pedir al backend, solo se recalcula su etiqueta traducida.
document.addEventListener('attomos:langchange', function () {
    const userRoleElement = document.getElementById('userRole');
    if (userRoleElement && lastRawBusinessType !== null) {
        userRoleElement.textContent = getBusinessTypeLabel(lastRawBusinessType) || 'Negocio';
    }
});

document.addEventListener('DOMContentLoaded', function() {
    console.log('👤 Userbar flotante cargado correctamente');
    
    initUserbar();
    initNotifications();
    initUserDropdown();
    
    console.log('✅ Userbar funcionalidades inicializadas');
});

// ============================================
// INICIALIZAR USERBAR CON DATOS DE USUARIO
// ============================================

async function initUserbar() {
    // Render from cache immediately to avoid flash of placeholder text
    const cached = localStorage.getItem('userData');
    if (cached) {
        try {
            const cachedData = JSON.parse(cached);
            updateUserbarUI(cachedData);
            // Aplicar lógica de menú con businessType cacheado
            applyBusinessTypeMenu(cachedData.businessType);
        } catch(e) {}
    }

    try {
        const response = await fetch('/api/me', {
            method: 'GET',
            credentials: 'include'
        });

        if (response.ok) {
            const data = await response.json();
            const user = { ...data.user };
            updateUserbarUI(user);

            // ── Segunda llamada: obtener giro real de MyBusinessInfo ──────────
            // User.businessType (tabla users) es el del registro y nunca se
            // actualiza cuando el usuario cambia el giro en "Mi Negocio".
            // MyBusinessInfo.businessType es la fuente de verdad real.
            try {
                const bizRes = await fetch('/api/my-business', { credentials: 'include' });
                if (bizRes.ok) {
                    const bizData   = await bizRes.json();
                    const branch    = bizData.activeBranch || bizData.defaultBranch;
                    // El handler devuelve business.type = el value del select ("gorditas", etc.)
                    const realType  = branch?.business?.type
                                   || branch?.business?.typeName
                                   || branch?.businessType
                                   || '';
                    if (realType) {
                        user.businessType = realType;
                        // Actualizar el rol mostrado en el dropdown
                        const roleEl = document.getElementById('userRole');
                        if (roleEl) {
                            roleEl.textContent    = getBusinessTypeLabel(realType);
                            roleEl.style.visibility = 'visible';
                        }
                    }
                }
            } catch (_) {
                // Falla silenciosamente; usa User.businessType como fallback
            }

            // Guardar en cache con el giro actualizado
            localStorage.setItem('userData', JSON.stringify(user));
            // Aplicar lógica de menú con el giro definitivo
            applyBusinessTypeMenu(user.businessType);

        } else {
            if (response.status === 401) {
                window.location.href = '/login';
            }
        }
    } catch (error) {
        console.error('❌ Error cargando datos de usuario:', error);
    }
}

// ============================================
// LÓGICA DE MENÚ SEGÚN GIRO (Citas vs Pedidos)
// ============================================

var GIROS_COMIDA = ['pizzeria','pizza','mariscos','gorditas','restaurante',
                      'taqueria','tacos','hamburguesas','sushi','comida'];

function getLang() {
    return localStorage.getItem('attomos_lang') || localStorage.getItem('lang') || 'es';
}
function t(key, fallback) {
    return window.Translations?.dict?.[getLang()]?.[key] || fallback;
}

function applyBusinessTypeMenu(businessType) {
    const bt     = (businessType || '').toLowerCase();
    const isFood = GIROS_COMIDA.some(g => bt.includes(g));

    const citasItem   = document.getElementById('dropdownCitasItem');
    const pedidosItem = document.getElementById('dropdownPedidosItem');

    if (citasItem)   citasItem.style.display   = isFood ? 'none' : '';
    if (pedidosItem) pedidosItem.style.display  = isFood ? ''     : 'none';
}

// ============================================
// ACTUALIZAR UI DEL USERBAR
// ============================================

let lastRawBusinessType = null;

function updateUserbarUI(user) {
    const userNameElement = document.getElementById('userName');
    if (userNameElement) {
        const businessName = user.firstName || user.company || 'Mi Empresa';
        userNameElement.textContent = businessName;
        userNameElement.style.visibility = 'visible';
    }

    const userRoleElement = document.getElementById('userRole');
    if (userRoleElement) {
        lastRawBusinessType = user.businessType || null; // el dato crudo del backend nunca cambia
        const businessType = getBusinessTypeLabel(lastRawBusinessType) || 'Negocio';
        userRoleElement.textContent = businessType;
        userRoleElement.style.visibility = 'visible';
    }

    const userPlanElement = document.getElementById('userPlan');
    if (userPlanElement && user.currentPlan) {
        userPlanElement.textContent = getPlanName(user.currentPlan);
    }

    const userInitialsElement = document.getElementById('userInitials');
    const userAvatarImg = document.getElementById('userAvatarImg');
    
    if (user.profileImage && userAvatarImg) {
        userAvatarImg.src = user.profileImage;
        userAvatarImg.style.display = 'block';
        if (userInitialsElement) userInitialsElement.style.display = 'none';
        userAvatarImg.style.visibility = 'visible';
    } else if (userInitialsElement) {
        const name = user.firstName || user.company || 'Usuario';
        const initials = name.split(' ')
            .map(word => word[0])
            .join('')
            .toUpperCase()
            .substring(0, 2);
        userInitialsElement.textContent = initials;
        userInitialsElement.style.visibility = 'visible';
    }

    localStorage.setItem('userData', JSON.stringify(user));
}

// ============================================
// OBTENER NOMBRE DEL PLAN
// ============================================

function getPlanName(planId) {
    // Los nombres de plan son universales (siempre en inglés) en el userbar,
    // independientemente del idioma de la interfaz — mismo criterio que
    // Proton/Neutron en /plans, pero aquí simplificado: nunca se traducen.
    const planNames = {
        'gratuito': 'Free Plan',
        'proton': 'Proton',
        'neutron': 'Neutron',
        'electron': 'Electron',
        'pending': 'Payment Pending'
    };
    return planNames[planId] || 'Free Plan';
}

// ============================================
// MAPEO DE TIPOS DE NEGOCIO A ETIQUETAS
// ============================================

function getBusinessTypeLabel(businessType) {
    // Mapa de "giro" crudo (tal como lo guarda el backend, sin tocarlo nunca)
    // a una key de traducción. Varias variantes de un mismo giro comparten
    // la misma etiqueta traducida (ej. 'pizzeria' y 'pizza' → biz_type_pizzeria).
    const businessTypeKeys = {
        // Salud
        'clinica-dental': 'biz_type_clinica_dental',
        'consultorio':    'biz_type_consultorio',
        'veterinaria':    'biz_type_veterinaria',
        // Belleza
        'peluqueria':     'biz_type_peluqueria',
        'spa':            'biz_type_spa',
        'estetica':       'biz_type_estetica',
        // Comida
        'restaurante':    'biz_type_restaurante',
        'pizzeria':       'biz_type_pizzeria',
        'pizza':          'biz_type_pizzeria',
        'mariscos':       'biz_type_mariscos',
        'gorditas':       'biz_type_gorditas',
        'taqueria':       'biz_type_taqueria',
        'tacos':          'biz_type_taqueria',
        'hamburguesas':   'biz_type_hamburguesas',
        'sushi':          'biz_type_sushi',
        'comida':         'biz_type_restaurante',
        // Otros
        'escuela':        'biz_type_escuela',
        'gym':            'biz_type_gym',
        'hotel':          'biz_type_hotel',
        'tienda':         'biz_type_tienda',
        'agencia':        'biz_type_agencia',
        'otro':           'biz_type_otro',
    };
    // Fallback en español (por si falta la traducción o el idioma es es)
    const businessTypesEs = {
        'clinica-dental': 'Clínica Dental', 'consultorio': 'Consultorio Médico', 'veterinaria': 'Veterinaria',
        'peluqueria': 'Peluquería', 'spa': 'Spa & Wellness', 'estetica': 'Estética',
        'restaurante': 'Restaurante', 'pizzeria': 'Pizzería', 'pizza': 'Pizzería',
        'mariscos': 'Mariscos', 'gorditas': 'Gorditas', 'taqueria': 'Taquería', 'tacos': 'Taquería',
        'hamburguesas': 'Hamburguesas', 'sushi': 'Sushi', 'comida': 'Restaurante',
        'escuela': 'Educación', 'gym': 'Gimnasio', 'hotel': 'Hotel', 'tienda': 'Tienda',
        'agencia': 'Agencia', 'otro': 'Otro',
    };

    const key = businessTypeKeys[businessType];
    const fallback = businessTypesEs[businessType] || businessType || 'Negocio';
    return key ? t(key, fallback) : fallback;
}

// ============================================
// NOTIFICACIONES
// ============================================

async function loadAppointmentNotifications() {
    try {
        const res = await fetch('/api/appointments', { credentials: 'include' });
        if (!res.ok) return [];
        const data = await res.json();
        return data.appointments || [];
    } catch (e) {
        console.error('Error cargando citas para notificaciones:', e);
        return [];
    }
}

function buildNotificationsFromAppointments(appointments) {
    const notifications = [];
    const now = new Date();

    const pad = n => String(n).padStart(2, '0');
    const todayStr    = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
    const tomorrowD   = new Date(now); tomorrowD.setDate(tomorrowD.getDate() + 1);
    const tomorrowStr = `${tomorrowD.getFullYear()}-${pad(tomorrowD.getMonth()+1)}-${pad(tomorrowD.getDate())}`;

    const active = appointments.filter(a => a.status !== 'cancelled');

    const todayAppts = active.filter(a => a.date === todayStr);
    todayAppts.forEach(a => {
        const [h, m] = a.time.split(':').map(Number);
        const apptTime = new Date(now);
        apptTime.setHours(h, m, 0, 0);
        const diffMin = (apptTime - now) / 60000;

        if (diffMin > 0 && diffMin <= 60) {
            notifications.push({
                type: 'urgent',
                text: `⏰ Cita con <strong>${a.client}</strong> en ${Math.round(diffMin)} min (${a.time})`,
                time: 'En breve',
                unread: true
            });
        } else if (diffMin > 60) {
            notifications.push({
                type: 'appointment',
                text: `📅 <strong>${a.client}</strong> — ${a.service} a las ${a.time}`,
                time: 'Hoy',
                unread: true
            });
        }
    });

    const tomorrowAppts = active.filter(a => a.date === tomorrowStr);
    if (tomorrowAppts.length > 0) {
        const s = tomorrowAppts.length;
        notifications.push({
            type: 'warning',
            text: `Tienes <strong>${s} cita${s > 1 ? 's' : ''}</strong> programada${s > 1 ? 's' : ''} para mañana`,
            time: 'Mañana',
            unread: true
        });
    }

    return notifications;
}

function renderNotifications(notifications) {
    const list  = document.getElementById('notificationList');
    const badge = document.getElementById('notificationBadge');
    if (!list) return;

    if (notifications.length === 0) {
        list.innerHTML = `
            <div style="padding:32px 20px;text-align:center;color:#9ca3af;">
                <svg viewBox="0 0 24 24" style="width:40px;height:40px;stroke:#d1d5db;stroke-width:1.5;fill:none;margin:0 auto 12px;display:block;">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                    <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                </svg>
                <div style="font-size:14px;font-weight:500;">Sin notificaciones</div>
                <div style="font-size:12px;margin-top:4px;">No hay citas próximas</div>
            </div>`;
        if (badge) badge.classList.add('hidden');
        return;
    }

    const icons = {
        urgent: `<svg viewBox="0 0 24 24" style="width:20px;height:20px;stroke:currentColor;stroke-width:2;fill:none;">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" x2="12" y1="8" y2="12"/>
                    <line x1="12" x2="12.01" y1="16" y2="16"/>
                 </svg>`,
        appointment: `<svg viewBox="0 0 24 24" style="width:20px;height:20px;stroke:currentColor;stroke-width:2;fill:none;">
                        <rect width="18" height="18" x="3" y="4" rx="2" ry="2"/>
                        <line x1="16" x2="16" y1="2" y2="6"/>
                        <line x1="8" x2="8" y1="2" y2="6"/>
                        <line x1="3" x2="21" y1="10" y2="10"/>
                      </svg>`,
        warning: `<svg viewBox="0 0 24 24" style="width:20px;height:20px;stroke:currentColor;stroke-width:2;fill:none;">
                    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
                    <line x1="12" x2="12" y1="9" y2="13"/>
                    <line x1="12" x2="12.01" y1="17" y2="17"/>
                  </svg>`
    };

    list.innerHTML = notifications.map((n, idx) => `
        <div class="notification-item ${n.unread ? 'unread' : ''}" data-idx="${idx}">
            <div class="notification-content">
                <div class="notification-icon">${icons[n.type] || icons.appointment}</div>
                <div class="notification-body">
                    <div class="notification-text">${n.text}</div>
                    <div class="notification-time">${n.time}</div>
                </div>
                <button class="notif-dismiss-btn" data-idx="${idx}" title="Eliminar">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            </div>
        </div>`).join('');

    list.querySelectorAll('.notif-dismiss-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.dataset.idx);
            const item = list.querySelector(`.notification-item[data-idx="${idx}"]`);
            if (item) {
                item.style.transition = 'all 0.25s ease';
                item.style.opacity = '0';
                item.style.transform = 'translateX(20px)';
                item.style.maxHeight = item.offsetHeight + 'px';
                setTimeout(() => {
                    item.style.maxHeight = '0';
                    item.style.marginBottom = '0';
                    item.style.padding = '0';
                    setTimeout(() => {
                        notifications.splice(idx, 1);
                        renderNotifications(notifications);
                    }, 200);
                }, 200);
            }
        });
    });

    const unreadCount = notifications.filter(n => n.unread).length;
    if (badge) {
        if (unreadCount > 0) {
            badge.textContent = unreadCount > 9 ? '9+' : unreadCount;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }
}

function initNotifications() {
    const notificationBtn   = document.getElementById('notificationBtn');
    const notificationPanel = document.getElementById('notificationPanel');
    const markAllBtn        = document.getElementById('markAllBtn');
    const notificationBadge = document.getElementById('notificationBadge');

    if (!notificationBtn || !notificationPanel) return;

    loadAppointmentNotifications().then(appointments => {
        const notifications = buildNotificationsFromAppointments(appointments);
        renderNotifications(notifications);
    });

    setInterval(() => {
        loadAppointmentNotifications().then(appointments => {
            const notifications = buildNotificationsFromAppointments(appointments);
            renderNotifications(notifications);
        });
    }, 5 * 60 * 1000);

    // Panel estilo iOS: crece desde la campana con resorte.
    // Hover en escritorio; tocar en pantallas táctiles.
    const controlBar = document.querySelector('.control-bar');
    window.IOSMenu.create({
        trigger: notificationBtn,
        menu: notificationPanel,
        hover: true,
        onOpenChange: (open) => {
            notificationPanel.classList.toggle('is-open', open);
            if (controlBar) controlBar.classList.toggle('menu-open', open);
        },
    });

    if (markAllBtn) {
        markAllBtn.addEventListener('click', () => {
            document.querySelectorAll('.notification-item.unread').forEach(item => {
                item.classList.remove('unread');
            });
            if (notificationBadge) notificationBadge.classList.add('hidden');
        });
    }

    document.querySelectorAll('.notification-item').forEach(item => {
        item.addEventListener('click', function() {
            if (this.classList.contains('unread')) {
                this.classList.remove('unread');
                updateBadgeCount();
            }
        });
    });

    function updateBadgeCount() {
        const unreadCount = document.querySelectorAll('.notification-item.unread').length;
        if (notificationBadge) {
            if (unreadCount > 0) {
                notificationBadge.textContent = unreadCount;
                notificationBadge.classList.remove('hidden');
            } else {
                notificationBadge.classList.add('hidden');
            }
        }
    }
}

// ============================================
// USER DROPDOWN
// ============================================

function initUserDropdown() {
    const userAvatar    = document.getElementById('userAvatar');
    const userDropdown  = document.getElementById('userDropdown');
    const logoContainer = document.getElementById('logoContainer');
    const controlBar    = document.querySelector('.control-bar');

    if (!userAvatar || !userDropdown) return;

    // Estilo iOS: la tarjeta de la cuenta crece desde la píldora del userbar.
    // Hover en escritorio; en táctil se toca, o se mantiene y se desliza
    // hasta una opción para elegirla al soltar.
    userAvatar.setAttribute('tabindex', '0');
    userAvatar.setAttribute('role', 'button');
    userAvatar.setAttribute('aria-label', 'Menú de la cuenta');
    const menu = window.IOSMenu.create({
        trigger: userAvatar,
        menu: userDropdown,
        origin: controlBar,
        itemSelector: '.dropdown-menu-button',
        hover: true,
        onOpenChange: (open) => {
            userDropdown.classList.toggle('is-open', open);
            if (controlBar) controlBar.classList.toggle('menu-open', open);
        },
    });
    userAvatar.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            menu.isOpen() ? menu.close() : menu.open({ keyboard: true, pin: true });
        }
    });

    if (logoContainer) {
        logoContainer.addEventListener('click', () => {
            window.location.href = '/';
        });
    }
}

// ============================================
// LOGOUT
// ============================================

function setupLogout() {
    const userbarLogoutBtn = document.getElementById('userbarLogoutBtn');
    if (!userbarLogoutBtn) return;

    userbarLogoutBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        try {
            const response = await fetch('/api/logout', {
                method: 'POST',
                credentials: 'include'
            });
            if (response.ok) {
                localStorage.removeItem('sidebarPinned');
                localStorage.removeItem('userData');
                window.location.href = '/login';
            } else {
                showToast('Error al cerrar sesión. Por favor intenta de nuevo.', 'error');
            }
        } catch (error) {
            showToast('Error al cerrar sesión. Por favor intenta de nuevo.', 'error');
        }
    });
}

document.addEventListener('DOMContentLoaded', setupLogout);

// ============================================
// FUNCIONES DE UTILIDAD
// ============================================

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    const colors = { info: '#06b6d4', error: '#ef4444', success: '#10b981' };
    toast.style.cssText = `
        position: fixed; top: 24px; right: 24px;
        background: ${colors[type] || colors.info};
        color: white; padding: 16px 24px; border-radius: 12px;
        box-shadow: 0 10px 25px rgba(0,0,0,0.3);
        z-index: 10000; max-width: 400px;
        font-size: 14px; font-weight: 500;`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(20px)';
        setTimeout(() => document.body.removeChild(toast), 300);
    }, 4000);
}

function getUserData() {
    const userData = localStorage.getItem('userData');
    return userData ? JSON.parse(userData) : null;
}

function updateUserData(key, value) {
    const userData = getUserData();
    if (userData) {
        userData[key] = value;
        localStorage.setItem('userData', JSON.stringify(userData));
        updateUserbarUI(userData);
        applyBusinessTypeMenu(userData.businessType);
    }
}

window.userbarUtils = {
    getUserData, updateUserData, updateUserbarUI,
    getBusinessTypeLabel, getPlanName, showToast,
    applyBusinessTypeMenu
};