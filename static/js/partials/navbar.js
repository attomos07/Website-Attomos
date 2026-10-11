// ============================================
// NAVBAR MOBILE MENU - iOS Style & Active Logic
// En mobile la barra es una píldora flotante que crece hasta
// convertirse en el panel del menú, con un indicador de resorte
// que marca la página actual y se puede arrastrar entre opciones.
// ============================================

document.addEventListener('DOMContentLoaded', function () {
    console.log('🔧 Navbar: Inicializando...');

    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const navMenu = document.getElementById('navMenu');
    const navbar = document.getElementById('navbar');

    if (!mobileMenuBtn || !navMenu) {
        console.error('❌ Error: No se encontraron los elementos del DOM');
        return;
    }

    // --- 1. ESTADO ACTIVO (antes del menú, para que el indicador sepa dónde empezar) ---
    setActiveNavLink();

    // --- 2. MENÚ MÓVIL CON RESORTE ---
    initMobileMenu(navbar, navMenu, mobileMenuBtn);

    // --- 2b. PÍLDORA LÍQUIDA DE ESCRITORIO ---
    initDesktopGlide(navMenu);

    // --- 3. EFECTO SCROLL (sombra) ---
    window.addEventListener('scroll', () => {
        if (navbar) {
            window.scrollY > 10
                ? navbar.classList.add('scrolled')
                : navbar.classList.remove('scrolled');
        }
    }, { passive: true });

    console.log('✅ Navbar: Inicializado correctamente');
});

function initMobileMenu(navbar, navMenu, mobileMenuBtn) {
    const body = document.body;
    const mq = window.matchMedia('(max-width: 768px)');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
    const lerp = (a, b, t) => a + (b - a) * t;

    // Indicador (li decorativo para que el <ul> siga siendo válido) y fondo oscuro
    const indicator = document.createElement('li');
    indicator.className = 'nav-indicator';
    indicator.setAttribute('aria-hidden', 'true');
    navMenu.prepend(indicator);

    const scrim = document.createElement('div');
    scrim.className = 'nav-scrim';
    body.appendChild(scrim);

    // Orden de la entrada escalonada
    navMenu.querySelectorAll('.nav-item').forEach((li, i) => li.style.setProperty('--i', i));

    // Solo los links de sección (sin los botones de sesión)
    const links = () => [...navMenu.querySelectorAll('.nav-link:not(.nav-login):not(.nav-cta)')];

    // ---------- Motor de resortes ----------
    const springs = [];
    const spring = (v = 0, k = 380, d = 30, eps = 0.1) => {
        const s = { v, vel: 0, t: v, k, d, eps, free: false };
        springs.push(s);
        return s;
    };
    const P = spring(0, 300, 25, 0.001);          // apertura: 0 = píldora, 1 = panel
    const HIDE = spring(0, 320, 30, 0.5);         // barra oculta al bajar
    const X = spring(), Y = spring(), W = spring(), H = spring();
    const V = spring(0, 500, 38, 0.001);          // visibilidad del indicador
    const L = spring(0, 450, 26, 0.001);          // lente al arrastrar

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

    function clearInline() {
        navbar.style.transform = '';
        navMenu.style.visibility = '';
        navMenu.style.clipPath = '';
        scrim.style.opacity = '';
    }

    function render() {
        if (!mq.matches) { clearInline(); return; }

        // Un transform en .navbar volvería relativo el panel fixed, así que solo se aplica al ocultarla
        navbar.style.transform = HIDE.v > 0.5 ? `translateY(${-HIDE.v}px)` : '';

        const p = P.v, pc = clamp(p);
        if (p < 0.002 && P.t === 0) {
            navMenu.style.visibility = 'hidden';
            navMenu.style.clipPath = '';
            scrim.style.opacity = 0;
        } else {
            // La píldora crece hasta el tamaño del panel
            const a = navbar.getBoundingClientRect(), c = navMenu.getBoundingClientRect();
            const t = lerp(a.top - c.top, 0, p);
            const l = lerp(a.left - c.left, 0, p);
            const r = lerp(c.right - a.right, 0, p);
            const b = lerp(c.bottom - a.bottom, 0, p);
            navMenu.style.visibility = 'visible';
            navMenu.style.clipPath = `inset(${t}px ${r}px ${b}px ${l}px round ${lerp(a.height / 2, 28, pc)}px)`;
            scrim.style.opacity = pc;
        }

        const st = Math.min(Math.abs(Y.vel) / 1600, 0.25);
        const lift = 1 + L.v * 0.05;
        indicator.style.width = `${W.v}px`;
        indicator.style.height = `${H.v}px`;
        indicator.style.opacity = clamp(V.v);
        indicator.style.transform = `translate(${X.v}px, ${Y.v}px) scale(${(1 - st * 0.15) * lift}, ${(1 + st) * lift})`;
    }

    // ---------- Indicador ----------
    // offsetLeft/Top no se ven afectados por la animación de entrada de los items
    function rectOf(link) {
        const li = link.closest('.nav-item');
        return { x: li.offsetLeft + link.offsetLeft, y: li.offsetTop + link.offsetTop, w: link.offsetWidth, h: link.offsetHeight };
    }
    function retarget(snap = false) {
        const el = links().find((a) => a.classList.contains('active'));
        if (!el) { V.t = 0; kick(); return; }
        const r = rectOf(el);
        X.t = r.x; Y.t = r.y; W.t = r.w; H.t = r.h; V.t = 1;
        if (snap || V.v < 0.05) { X.v = r.x; Y.v = r.y; W.v = r.w; H.v = r.h; }
        kick();
    }

    // ---------- Abrir / cerrar ----------
    const isOpen = () => navMenu.classList.contains('active');

    function openMobileMenu() {
        if (!mq.matches) return;
        if (window.IOSMenu) window.IOSMenu.closeAll();
        HIDE.v = HIDE.t = 0; HIDE.vel = 0;
        navbar.style.transform = '';
        P.t = 1;
        mobileMenuBtn.classList.add('active');
        navMenu.classList.add('active');
        navbar.classList.add('menu-is-open');
        body.classList.add('menu-open');
        scrim.classList.add('on');
        mobileMenuBtn.setAttribute('aria-expanded', 'true');
        requestAnimationFrame(() => retarget(true));
        kick();
    }

    function closeMobileMenu() {
        if (window.IOSMenu) window.IOSMenu.closeAll();
        P.t = 0;
        mobileMenuBtn.classList.remove('active');
        navMenu.classList.remove('active');
        navbar.classList.remove('menu-is-open');
        body.classList.remove('menu-open');
        scrim.classList.remove('on');
        mobileMenuBtn.setAttribute('aria-expanded', 'false');
        kick();
    }

    mobileMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        isOpen() ? closeMobileMenu() : openMobileMenu();
    });
    scrim.addEventListener('click', closeMobileMenu);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isOpen()) {
            closeMobileMenu();
            mobileMenuBtn.focus();
        }
    });

    // Al pasar a desktop se cierra y se limpian los estilos en línea
    mq.addEventListener('change', () => {
        if (!mq.matches) {
            closeMobileMenu();
            P.v = P.t = 0; HIDE.v = HIDE.t = 0;
            clearInline();
        }
    });

    // ---------- Ir a una página: el indicador llega primero y luego se navega ----------
    function navigateTo(link) {
        links().forEach((a) => a.classList.toggle('active', a === link));
        retarget();
        link.classList.remove('bounce');
        void link.offsetWidth;
        link.classList.add('bounce');
        if (navigator.vibrate) navigator.vibrate(8);
        const href = link.href;
        setTimeout(() => {
            closeMobileMenu();
            window.location.href = href;
        }, reduce.matches ? 0 : 220);
    }

    // ---------- Gestos: tocar, o mantener y arrastrar para recorrer ----------
    let g = null, suppressClick = false;

    navMenu.addEventListener('pointerdown', (e) => {
        if (!mq.matches || e.button > 0) return;
        const link = e.target.closest('.nav-link');
        if (link && link.matches('.nav-login, .nav-cta')) return;
        if (e.target.closest('.nav-lang-row')) return;
        g = { id: e.pointerId, type: e.pointerType, x0: e.clientX, y0: e.clientY, t: performance.now(), mode: null, hover: null };
        // En pantallas táctiles hay que mantener presionado; así el scroll normal sigue funcionando
        if (g.type === 'touch') g.timer = setTimeout(() => { if (g && !g.mode) startScrub(); }, 280);
    });

    function nearest(clientY) {
        let best = null, dist = Infinity;
        links().forEach((a) => {
            const r = a.getBoundingClientRect();
            const d = Math.abs(clientY - (r.top + r.height / 2));
            if (d < dist) { dist = d; best = a; }
        });
        return best;
    }

    function startScrub() {
        g.mode = 'scrub';
        clearTimeout(g.timer);
        Y.free = true;
        L.t = 1;
        V.t = 1;
        indicator.classList.add('lifted');
        if (navigator.vibrate) navigator.vibrate(8);
    }

    window.addEventListener('pointermove', (e) => {
        if (!g || e.pointerId !== g.id) return;
        const dist = Math.hypot(e.clientX - g.x0, e.clientY - g.y0);
        if (!g.mode) {
            if (g.type !== 'touch' && dist > 6) startScrub();
            else if (dist > 8) { clearTimeout(g.timer); g = null; return; }
            else return;
        }
        const now = performance.now(), dt = Math.max((now - g.t) / 1000, 0.001);
        g.t = now;

        const ls = links();
        const c = navMenu.getBoundingClientRect();
        const first = rectOf(ls[0]), lastR = rectOf(ls[ls.length - 1]);
        let y = e.clientY - c.top + navMenu.scrollTop - H.v / 2;
        if (y < first.y) y = first.y - Math.sqrt(first.y - y) * 2;       // resistencia elástica
        if (y > lastR.y) y = lastR.y + Math.sqrt(y - lastR.y) * 2;
        Y.vel = (y - Y.v) / dt;
        Y.v = y;

        const h = nearest(e.clientY);
        if (h && h !== g.hover) {
            g.hover = h;
            ls.forEach((a) => a.classList.toggle('is-hover', a === h));
            const r = rectOf(h);
            X.t = r.x; W.t = r.w; H.t = r.h;
            if (navigator.vibrate) navigator.vibrate(4);
        }
        kick();
    });

    function endGesture(e) {
        if (!g || e.pointerId !== g.id) return;
        clearTimeout(g.timer);
        if (g.mode === 'scrub') {
            Y.free = false;
            L.t = 0;
            indicator.classList.remove('lifted');
            links().forEach((a) => a.classList.remove('is-hover'));
            suppressClick = true;
            setTimeout(() => { suppressClick = false; }, 60);
            const h = g.hover || nearest(e.clientY);
            if (e.type === 'pointerup' && h) navigateTo(h);
            else retarget();
        }
        g = null;
        kick();
    }
    window.addEventListener('pointerup', endGesture);
    window.addEventListener('pointercancel', endGesture);

    document.addEventListener('touchmove', (e) => { if (g && g.mode) e.preventDefault(); }, { passive: false });
    navMenu.addEventListener('contextmenu', (e) => { if (g && g.mode) e.preventDefault(); });
    // Evita que el navegador arrastre el link (cancelaría el gesto con el ratón)
    navMenu.addEventListener('dragstart', (e) => { if (mq.matches) e.preventDefault(); });

    // Clic normal (y teclado). Los botones de sesión navegan sin interceptar.
    navMenu.addEventListener('click', (e) => {
        const link = e.target.closest('.nav-link');
        if (!link || !mq.matches || !isOpen()) return;
        if (suppressClick) { e.preventDefault(); return; }
        if (link.matches('.nav-login, .nav-cta')) { setTimeout(closeMobileMenu, 150); return; }
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        navigateTo(link);
    });

    // ---------- La barra se oculta al bajar y reaparece al subir ----------
    let lastY = window.scrollY, ticking = false;
    window.addEventListener('scroll', () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
            const y = window.scrollY, dy = y - lastY;
            if (mq.matches && !isOpen()) {
                if (dy > 6 && y > 80) HIDE.t = 90;
                else if (dy < -6 || y < 80) HIDE.t = 0;
                kick();
            }
            lastY = y;
            ticking = false;
        });
    }, { passive: true });
    navbar.addEventListener('focusin', () => { HIDE.t = 0; kick(); });

    // Si el panel cambia de tamaño (p. ej. aparecen los botones de sesión), el indicador lo sigue
    if ('ResizeObserver' in window) new ResizeObserver(() => { if (isOpen()) retarget(); }).observe(navMenu);

    render();
}

// ============================================
// PÍLDORA LÍQUIDA (escritorio) — estilo iOS 27
// Una gota de cristal cian sigue al cursor entre los enlaces con
// resorte: se estira según su velocidad, se aplasta al presionar y
// al llegar a su destino un destello cruza el cristal. Al hacer clic
// el texto da un pequeño rebote y la gota se queda en la nueva sección.
// Sustituye la línea bajo el texto.
// ============================================
function initDesktopGlide(navMenu) {
    const mq = window.matchMedia('(min-width: 769px)');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

    const glide = document.createElement('li');
    glide.className = 'nav-glide';
    glide.setAttribute('aria-hidden', 'true');
    glide.innerHTML = '<span class="nav-glide-shine"></span>';
    navMenu.appendChild(glide);
    navMenu.classList.add('has-glide');

    const links = () => [...navMenu.querySelectorAll('.nav-item:not(.mobile-only):not(.mobile-lang-item) > .nav-link')];

    // ---------- Resortes ----------
    const springs = [];
    const spring = (v = 0, k = 420, d = 32, eps = 0.1) => {
        const s = { v, vel: 0, t: v, k, d, eps };
        springs.push(s);
        return s;
    };
    const X = spring(), Y = spring(), W = spring(), H = spring();
    const O = spring(0, 520, 40, 0.002);         // opacidad
    const S = spring(1, 650, 26, 0.0005);        // presión

    function step(s, dt) {
        if (reduce.matches) { s.v = s.t; s.vel = 0; return; }
        s.vel += (-s.k * (s.v - s.t) - s.d * s.vel) * dt;
        s.v += s.vel * dt;
    }
    const atRest = (s) => Math.abs(s.v - s.t) < s.eps && Math.abs(s.vel) < s.eps * 5;

    let raf = null, last = 0, travelling = false;
    function tick(now) {
        const dt = Math.min((now - last) / 1000, 1 / 30);
        last = now;
        springs.forEach((s) => step(s, dt));
        render();
        if (travelling && Math.abs(X.v - X.t) < 1.5 && Math.abs(X.vel) < 60) {
            travelling = false;
            shine();
        }
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

    function render() {
        if (!mq.matches) { glide.style.opacity = '0'; return; }
        // Estiramiento líquido según la velocidad horizontal
        const stretch = clamp(Math.abs(X.vel) / 5000, 0, 0.22);
        glide.style.width = `${Math.max(0, W.v)}px`;
        glide.style.height = `${Math.max(0, H.v)}px`;
        glide.style.opacity = clamp(O.v, 0, 1);
        glide.style.transform =
            `translate(${X.v}px, ${Y.v}px) scale(${(1 + stretch) * S.v}, ${(1 - stretch * 0.45) * S.v})`;
    }

    function shine() {
        if (reduce.matches) return;
        glide.classList.remove('shine');
        void glide.offsetWidth;
        glide.classList.add('shine');
    }

    let hover = null;
    const activeLink = () => links().find((a) => a.classList.contains('active')) || null;

    function retarget(snap = false) {
        const target = hover || activeLink();
        navMenu.classList.toggle('is-hovering', !!hover && hover !== activeLink());
        if (!target) { O.t = 0; kick(); return; }
        const wasHidden = O.v < 0.05;
        const nx = target.offsetLeft, ny = target.offsetTop;
        const nw = target.offsetWidth, nh = target.offsetHeight;
        // Si estaba oculta, aparece directamente en su sitio
        const jump = snap || wasHidden;
        [[X, nx], [Y, ny], [W, nw], [H, nh]].forEach(([s, v]) => {
            s.t = v;
            if (jump) { s.v = v; s.vel = 0; }
        });
        if (!jump && Math.abs(X.v - nx) > 2) travelling = true;
        O.t = 1;
        kick();
    }

    // ---------- Cursor ----------
    navMenu.addEventListener('pointerover', (e) => {
        if (!mq.matches || e.pointerType === 'touch') return;
        const link = e.target.closest('.nav-link');
        if (!link || !links().includes(link) || link === hover) return;
        hover = link;
        retarget();
    });
    navMenu.addEventListener('pointerleave', () => {
        if (!mq.matches) return;
        hover = null;
        S.t = 1;
        retarget();
    });

    // ---------- Presionar: la gota se aplasta ----------
    navMenu.addEventListener('pointerdown', (e) => {
        if (!mq.matches || e.button > 0) return;
        const link = e.target.closest('.nav-link');
        if (!link || !links().includes(link)) return;
        hover = link;
        retarget();
        S.t = 0.9;
        kick();
    });
    const release = () => { if (S.t !== 1) { S.t = 1; kick(); } };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);

    // ---------- Seleccionar: rebote del texto y luego navegar ----------
    navMenu.addEventListener('click', (e) => {
        if (!mq.matches) return;
        const link = e.target.closest('.nav-link');
        if (!link || !links().includes(link)) return;
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button > 0) return;
        if (link.target && link.target !== '_self') return;
        const isCurrent = link.classList.contains('active');
        links().forEach((a) => a.classList.toggle('active', a === link));
        hover = null;
        retarget();
        shine();
        link.classList.remove('is-selecting');
        void link.offsetWidth;
        link.classList.add('is-selecting');
        if (isCurrent || reduce.matches) return;
        e.preventDefault();
        const href = link.href;
        setTimeout(() => { window.location.href = href; }, 260);
    });
    navMenu.addEventListener('animationend', (e) => {
        if (e.animationName === 'navGlideJelly') e.target.closest('.nav-link')?.classList.remove('is-selecting');
    });

    // ---------- Cambios de tamaño (idioma, fuentes, ventana) ----------
    if ('ResizeObserver' in window) {
        const ro = new ResizeObserver(() => retarget(true));
        links().forEach((a) => ro.observe(a));
    } else {
        window.addEventListener('resize', () => retarget(true));
    }
    mq.addEventListener?.('change', () => retarget(true));
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => retarget(true));

    retarget(true);
}

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
// IOS MENU — dropdowns estilo iOS 27
// El menú nace del botón (clip-path con resorte), un indicador de
// resorte sigue al cursor o al dedo, y se puede mantener presionado
// el botón y deslizar hasta una opción para elegirla al soltar.
// Lo usan: selector de idioma, menú del avatar y notificaciones.
// ============================================

(function initIOSMenus() {
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

    function create({ trigger, menu, itemSelector = null, hover = false, portal = false, onOpenChange = () => {} }) {
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
                    const a = trigger.getBoundingClientRect(), c = menu.getBoundingClientRect();
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

    // ── Dropdown del avatar (estilo iOS: hover en escritorio, tocar o arrastrar en mobile) ──
    function _initDropdown() {
        const avatar   = document.getElementById('userAvatar');
        const dropdown = document.getElementById('userDropdown');
        if (!avatar || !dropdown || !window.IOSMenu) return;

        avatar.setAttribute('tabindex', '0');
        avatar.setAttribute('role', 'button');
        avatar.setAttribute('aria-label', 'Menú de la cuenta');
        const menu = window.IOSMenu.create({
            trigger: avatar,
            menu: dropdown,
            itemSelector: '.dropdown-menu-button',
            hover: true,
            onOpenChange: (open) => dropdown.classList.toggle('is-open', open),
        });
        avatar.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); menu.isOpen() ? menu.close() : menu.open({ keyboard: true, pin: true }); }
        });
    }

    // ── Notificaciones (hover desktop + tap mobile) ─────────────────
    function _initNotifications() {
        const btn   = document.getElementById('notificationBtn');
        const panel = document.getElementById('notificationPanel');
        if (!btn || !panel) return;

        // Panel con la misma animación iOS (sin indicador: son avisos, no opciones)
        if (window.IOSMenu) {
            window.IOSMenu.create({
                trigger: btn,
                menu: panel,
                hover: true,
                onOpenChange: (open) => panel.classList.toggle('is-open', open),
            });
        }
        btn.setAttribute('aria-label', 'Notificaciones');

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
        if (!selector || !trigger || !dropdown || !window.IOSMenu) return;

        // Menú estilo iOS: tocar para abrir, o mantener y deslizar hasta el idioma
        window.IOSMenu.create({
            trigger,
            menu: dropdown,
            itemSelector: '.lang-option',
            portal: selectorId === 'langSelectorMobile',
            onOpenChange: (open) => {
                selector.classList.toggle('open', open);
                dropdown.classList.toggle('is-open', open);
            },
        });

        dropdown.querySelectorAll('.lang-option').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const lang = btn.dataset.lang;
                if (window.Translations) {
                    window.Translations.apply(lang);
                }
                // Sincronizar ambos selectores
                syncActiveOption(lang);
            });
        });
    }

    function syncActiveOption(lang) {
        // Usar FLAG_SVG y LANG_META de Translations si están disponibles
        const FLAG_SVG  = (window.Translations && window.Translations.FLAG_SVG)  || {};
        const LANG_META = (window.Translations && window.Translations.LANG_META) || {};
        const meta = LANG_META[lang] || {};
        const labelHtml = (FLAG_SVG[lang] || '') + ' ' + (meta.code || lang.toUpperCase());

        // Labels — innerHTML para poder meter el SVG
        const desk = document.getElementById('langTriggerLabel');
        if (desk) desk.innerHTML = labelHtml;
        // En el menú móvil hay espacio: se muestra el nombre completo del idioma
        const mob = document.getElementById('langTriggerLabelMobile');
        const opt = document.querySelector(`#langDropdownMobile .lang-option[data-lang="${lang}"]`);
        if (mob) mob.innerHTML = opt ? opt.innerHTML : labelHtml;

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