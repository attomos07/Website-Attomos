// ============================================
// BLOG DETAIL PAGE JAVASCRIPT
// El artículo /blog/<slug> lo pinta el servidor (SEO). Aquí solo se
// agregan las interacciones: progreso de lectura, parallax de portada,
// índice, compartir, revelado al hacer scroll y CTA de WhatsApp.
// ============================================

const WHATSAPP_PHONE = '+528123092839';
const REDUCE_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

document.addEventListener('DOMContentLoaded', function () {
    const root = document.getElementById('blogDetail');
    if (!root) return;

    if (root.classList.contains('is-notfound') || !root.querySelector('.bd-post')) {
        initReveal();
        return;
    }

    const post = {
        slug: root.dataset.slug || '',
        title: root.dataset.title || document.title,
        url: root.dataset.url || window.location.href.split('#')[0].split('?')[0]
    };

    initNavMetrics();
    initReadingProgress();
    initCoverParallax();
    initToc();
    initShare(post);
    initReveal();

    const cta = root.querySelector('.bd-cta-btn');
    if (cta) cta.addEventListener('click', () => openWhatsApp(`¡Hola! Leí el artículo "${post.title}" en su blog y me gustaría saber cómo aplicarlo en mi negocio.`));
});

// ============================================
// NAVBAR METRICS
// Guarda la altura real del navbar fijo en --bd-nav (índice sticky,
// scroll-margin de los títulos y posición de la barra de progreso).
// ============================================
let navBottom = 0;

function measureNav() {
    const nav = document.getElementById('navbar') || document.querySelector('.navbar');
    const bottom = nav ? Math.max(0, Math.round(nav.getBoundingClientRect().bottom)) : 0;
    if (bottom !== navBottom) {
        navBottom = bottom;
        document.documentElement.style.setProperty('--bd-nav', `${bottom}px`);
    }
    return navBottom;
}

function initNavMetrics() {
    measureNav();
    window.addEventListener('resize', measureNav, { passive: true });
    window.addEventListener('load', measureNav);
}

// ============================================
// READING PROGRESS
// ============================================
function initReadingProgress() {
    const wrap = document.getElementById('bdProgress');
    const bar = document.getElementById('bdProgressBar');
    const prose = document.getElementById('bdProse');
    if (!wrap || !bar || !prose) return;

    let ticking = false;

    function update() {
        ticking = false;
        const nav = measureNav();
        const isMobile = window.innerWidth <= 768;
        // En móvil el navbar es una píldora flotante: la barra va en el borde superior
        wrap.style.top = isMobile ? '0px' : `${nav}px`;

        const rect = prose.getBoundingClientRect();
        const start = rect.top - nav;
        const total = rect.height - (window.innerHeight - nav);
        let p = total > 0 ? -start / total : (start < 0 ? 1 : 0);
        p = Math.min(1, Math.max(0, p));
        bar.style.transform = `scaleX(${p.toFixed(4)})`;
        wrap.classList.toggle('is-active', p > 0 && p < 1);
        wrap.classList.toggle('is-done', p >= 1);
    }

    function onScroll() {
        if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    window.addEventListener('load', onScroll);
    update();
}

// ============================================
// COVER PARALLAX
// ============================================
function initCoverParallax() {
    if (REDUCE_MOTION) return;
    const figure = document.querySelector('.bd-cover');
    const img = figure && figure.querySelector('.bd-cover-img');
    if (!img) return;

    let ticking = false;

    function update() {
        ticking = false;
        const rect = figure.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top > window.innerHeight) return;
        const h = rect.height || 1;
        const passed = Math.min(1, Math.max(0, -rect.top / h + 0.15));
        const scale = 1.06 + passed * 0.05;
        const maxShift = h * 0.028;
        const shift = Math.max(-maxShift, Math.min(maxShift, -rect.top * 0.06));
        img.style.transform = `translate3d(0, ${shift.toFixed(2)}px, 0) scale(${scale.toFixed(4)})`;
    }

    window.addEventListener('scroll', () => {
        if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    window.addEventListener('resize', update, { passive: true });
    update();
}

// ============================================
// TABLE OF CONTENTS
// ============================================
function initToc() {
    const toc = document.querySelector('.bd-toc');
    if (!toc) return;

    const toggle = toc.querySelector('.bd-toc-toggle');
    const thumb = toc.querySelector('.bd-toc-thumb');
    const links = Array.from(toc.querySelectorAll('.bd-toc-list a'));
    const headings = links.map(a => document.getElementById(a.dataset.target)).filter(Boolean);
    const mobileQuery = window.matchMedia('(max-width: 1024px)');
    let activeIndex = -2;

    // Plegable en móvil
    toggle.addEventListener('click', () => {
        if (!mobileQuery.matches) return;
        const open = toc.classList.toggle('is-open');
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) requestAnimationFrame(() => placeThumb(true));
    });

    function syncToggleState() {
        if (mobileQuery.matches) {
            toggle.removeAttribute('tabindex');
            toggle.setAttribute('aria-expanded', toc.classList.contains('is-open') ? 'true' : 'false');
        } else {
            toggle.setAttribute('tabindex', '-1');
            toggle.setAttribute('aria-expanded', 'true');
        }
    }
    if (mobileQuery.addEventListener) mobileQuery.addEventListener('change', () => { syncToggleState(); placeThumb(true); });
    syncToggleState();

    // Navegación suave a cada sección
    links.forEach(link => {
        link.addEventListener('click', (e) => {
            const target = document.getElementById(link.dataset.target);
            if (!target) return;
            e.preventDefault();
            target.scrollIntoView({ behavior: REDUCE_MOTION ? 'auto' : 'smooth', block: 'start' });
            if (history.replaceState) history.replaceState(null, '', `#${link.dataset.target}`);
            if (mobileQuery.matches && toc.classList.contains('is-open')) {
                toc.classList.remove('is-open');
                toggle.setAttribute('aria-expanded', 'false');
            }
        });
    });

    function placeThumb(instant) {
        const link = links[activeIndex];
        if (!link) {
            thumb.style.opacity = '0';
            return;
        }
        if (instant) thumb.style.transition = 'none';
        thumb.style.height = `${link.offsetHeight}px`;
        thumb.style.transform = `translateY(${link.offsetTop}px)`;
        thumb.style.opacity = '1';
        if (instant) {
            void thumb.offsetWidth;
            thumb.style.transition = '';
        }
    }

    function updateActive() {
        const line = (navBottom || 0) + Math.min(160, window.innerHeight * 0.25);
        let idx = -1;
        headings.forEach((h, i) => {
            if (h.getBoundingClientRect().top <= line) idx = i;
        });
        // Al final de la página se marca la última sección
        if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4 && headings.length) {
            const lastTop = headings[headings.length - 1].getBoundingClientRect().top;
            if (lastTop < window.innerHeight) idx = headings.length - 1;
        }
        if (idx === activeIndex) return;
        const first = activeIndex === -2;
        activeIndex = idx;
        links.forEach((a, i) => {
            a.classList.toggle('is-active', i === idx);
            if (i === idx) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current');
        });
        placeThumb(first);
    }

    let ticking = false;
    window.addEventListener('scroll', () => {
        if (!ticking) {
            ticking = true;
            requestAnimationFrame(() => { ticking = false; updateActive(); });
        }
    }, { passive: true });
    window.addEventListener('resize', () => placeThumb(true), { passive: true });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => placeThumb(true));
    updateActive();
}

// ============================================
// SHARE
// ============================================
function initShare(post) {
    const url = post.url;
    const text = post.title;
    const shareUrls = {
        whatsapp: `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`,
        x: `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
        linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`
    };

    document.querySelectorAll('[data-share]').forEach(btn => {
        const kind = btn.dataset.share;
        if (shareUrls[kind]) {
            btn.setAttribute('href', shareUrls[kind]);
            return;
        }
        if (kind === 'copy') {
            btn.addEventListener('click', () => copyLink(btn, url));
        }
    });
}

function copyLink(btn, url) {
    const done = () => {
        const label = btn.querySelector('.bd-share-text');
        btn.classList.add('is-copied');
        if (label) label.textContent = '¡Copiado!';
        btn.setAttribute('aria-label', '¡Enlace copiado!');
        clearTimeout(btn._copyTimer);
        btn._copyTimer = setTimeout(() => {
            btn.classList.remove('is-copied');
            if (label) label.textContent = 'Copiar enlace';
            btn.setAttribute('aria-label', 'Copiar enlace');
        }, 1800);
    };

    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(url).then(done).catch(() => fallbackCopy(url) && done());
    } else if (fallbackCopy(url)) {
        done();
    }
}

function fallbackCopy(text) {
    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
    } catch (e) {
        return false;
    }
}

// ============================================
// REVEAL ON SCROLL (títulos, citas, tips, tarjetas)
// ============================================
function initReveal() {
    if (REDUCE_MOTION || !('IntersectionObserver' in window)) return;
    const els = document.querySelectorAll('.bd-prose h2, .bd-prose h3, .bd-quote, .bd-tip, .bd-tags, .bd-endcard, .bd-author-card, .bd-cta-card, .bd-related-head, .bd-rcard');
    if (!els.length) return;

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add('is-in');
            observer.unobserve(entry.target);
        });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

    els.forEach((el, i) => {
        el.classList.add('bd-reveal');
        if (el.classList.contains('bd-rcard')) el.style.setProperty('--rd', `${(i % 3) * 70}ms`);
        observer.observe(el);
    });
}

// ============================================
// WHATSAPP FUNCTION
// ============================================
function openWhatsApp(customMessage) {
    const phoneNumber = WHATSAPP_PHONE.replace(/\D/g, '');
    const message = typeof customMessage === 'string' && customMessage
        ? customMessage
        : '¡Hola! Vi su blog y me gustaría obtener más información sobre chatbots de IA.';
    const whatsappUrl = `https://wa.me/${phoneNumber}?text=${encodeURIComponent(message)}`;

    window.open(whatsappUrl, '_blank');
    console.log('📱 WhatsApp abierto desde artículo del blog');
}