// ============================================
// BLOG DETAIL PAGE JAVASCRIPT
// Pinta el artículo /blog/<slug> a partir de window.BLOG_POSTS
// (blog-posts.js): portada, cuerpo, índice, compartir, progreso
// de lectura, relacionados y CTA de WhatsApp.
// ============================================

const WHATSAPP_PHONE = '+528123092839';
const REDUCE_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

document.addEventListener('DOMContentLoaded', function () {
    const root = document.getElementById('blogDetail');
    if (!root) return;

    const posts = Array.isArray(window.BLOG_POSTS) ? window.BLOG_POSTS : [];
    const slug = getSlugFromLocation();
    const post = posts.find(p => p.slug === slug) || null;

    if (!post) {
        renderNotFound(root, posts);
        console.warn('⚠️ Artículo no encontrado:', slug);
        return;
    }

    renderPost(root, post, posts);
    initNavMetrics();
    initReadingProgress();
    initCoverParallax();
    initToc();
    initShare(post);
    initReveal();

    console.log('✅ Artículo cargado:', post.slug);
});

// ============================================
// HELPERS
// ============================================
function getSlugFromLocation() {
    const parts = window.location.pathname.split('/').filter(Boolean);
    if (parts.length >= 2 && parts[parts.length - 2] === 'blog') {
        try { return decodeURIComponent(parts[parts.length - 1]); } catch (e) { return parts[parts.length - 1]; }
    }
    const params = new URLSearchParams(window.location.search);
    return params.get('post') || '';
}

function escapeHTML(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Escapa y luego convierte **texto** en <strong> (seguro: se aplica sobre texto ya escapado)
function inlineHTML(value) {
    return escapeHTML(value).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

function stripMarks(value) {
    return String(value || '').replace(/\*\*/g, '');
}

function slugify(text) {
    return stripMarks(text)
        .toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 60) || 'seccion';
}

function initials(name) {
    return String(name || '')
        .split(/\s+/).filter(Boolean).slice(0, 2)
        .map(w => w.charAt(0).toUpperCase()).join('');
}

function postUrl(slug) {
    return `/blog/${encodeURIComponent(slug)}`;
}

function canonicalUrl(post) {
    return `${window.location.origin}${postUrl(post.slug)}`;
}

const ICONS = {
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>',
    clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    whatsapp: '<svg viewBox="0 0 24 24" aria-hidden="true" class="fill"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2zm5.8 14.01c-.24.68-1.42 1.32-1.96 1.37-.5.05-1.13.07-1.82-.11-.42-.13-.96-.31-1.65-.61-2.9-1.25-4.79-4.17-4.94-4.36-.14-.19-1.18-1.57-1.18-3s.75-2.13 1.02-2.42c.26-.29.58-.36.77-.36h.55c.18 0 .42-.07.65.5.24.58.82 2.01.89 2.15.07.15.12.32.02.51-.1.19-.14.31-.29.48-.14.17-.3.38-.43.51-.14.14-.29.3-.13.59.17.29.74 1.22 1.58 1.97 1.09.97 2.01 1.27 2.29 1.42.29.14.46.12.62-.07.17-.19.72-.84.91-1.13.19-.29.38-.24.65-.14.26.1 1.68.79 1.97.94.29.14.48.22.55.34.07.12.07.7-.17 1.38z"/></svg>',
    x: '<svg viewBox="0 0 24 24" aria-hidden="true" class="fill"><path d="M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.77L17.75 3zm-1.08 16.17h1.7L7.4 4.74H5.58l11.09 14.43z"/></svg>',
    linkedin: '<svg viewBox="0 0 24 24" aria-hidden="true" class="fill"><path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9.75h4v11.25H3V9.75zm6.5 0h3.83v1.54h.06c.53-1.01 1.84-2.08 3.79-2.08 4.05 0 4.8 2.67 4.8 6.13V21h-4v-5.02c0-1.2-.02-2.74-1.67-2.74-1.67 0-1.93 1.3-1.93 2.65V21h-4V9.75z"/></svg>',
    spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"/></svg>',
    search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>'
};

// ============================================
// RENDER
// ============================================
function renderPost(root, post, posts) {
    document.title = `${post.title} - Attomos`;
    setMetaDescription(post.excerpt);

    // Cuerpo + índice
    const usedIds = {};
    const toc = [];
    const bodyHTML = (post.content || []).map(block => {
        switch (block.type) {
            case 'h2': {
                let id = slugify(block.text);
                if (usedIds[id]) id = `${id}-${++usedIds[id]}`; else usedIds[id] = 1;
                toc.push({ id, text: stripMarks(block.text) });
                return `<h2 id="${escapeHTML(id)}">${inlineHTML(block.text)}</h2>`;
            }
            case 'h3':
                return `<h3>${inlineHTML(block.text)}</h3>`;
            case 'ul':
            case 'ol':
                return `<${block.type}>${(block.items || []).map(i => `<li>${inlineHTML(i)}</li>`).join('')}</${block.type}>`;
            case 'quote':
                return `<blockquote class="bd-quote"><p>${inlineHTML(block.text)}</p>${block.cite ? `<cite>${escapeHTML(block.cite)}</cite>` : ''}</blockquote>`;
            case 'tip':
                return `<aside class="bd-tip"><div class="bd-tip-icon">${ICONS.spark}</div><div><div class="bd-tip-title">${escapeHTML(block.title || 'Tip')}</div><p>${inlineHTML(block.text)}</p></div></aside>`;
            case 'p':
            default:
                return `<p>${inlineHTML(block.text)}</p>`;
        }
    }).join('');

    const author = post.author || { name: 'Attomos', role: '' };
    const authorHTML = `
        <div class="bd-author">
            <div class="bd-avatar" aria-hidden="true">${escapeHTML(initials(author.name))}</div>
            <div class="bd-author-text">
                <div class="bd-author-name">${escapeHTML(author.name)}</div>
                <div class="bd-author-role">${escapeHTML(author.role)}</div>
            </div>
        </div>`;

    const tocHTML = toc.length ? `
        <nav class="bd-toc" aria-label="En este artículo">
            <button type="button" class="bd-toc-toggle" aria-expanded="false" aria-controls="bdTocPanel">
                <span class="bd-toc-heading">En este artículo</span>
                <span class="bd-toc-count">${toc.length} ${toc.length === 1 ? 'sección' : 'secciones'}</span>
                <span class="bd-toc-chevron">${ICONS.chevron}</span>
            </button>
            <div class="bd-toc-panel" id="bdTocPanel">
                <div class="bd-toc-inner">
                    <div class="bd-toc-track">
                        <span class="bd-toc-thumb" aria-hidden="true"></span>
                        <ol class="bd-toc-list">
                            ${toc.map(t => `<li><a href="#${escapeHTML(t.id)}" data-target="${escapeHTML(t.id)}">${escapeHTML(t.text)}</a></li>`).join('')}
                        </ol>
                    </div>
                </div>
            </div>
        </nav>` : '';

    const related = getRelated(post, posts, 3);

    root.innerHTML = `
        <article class="bd-post">
            <header class="bd-hero">
                <div class="bd-hero-top bd-enter" style="--d: 0ms">
                    <a class="bd-back" href="/blog">${ICONS.back}<span>Blog</span></a>
                    <span class="bd-cat">${escapeHTML(post.categoryLabel)}</span>
                </div>
                <h1 class="bd-title bd-enter" style="--d: 60ms">${escapeHTML(post.title)}</h1>
                <p class="bd-dek bd-enter" style="--d: 120ms">${escapeHTML(post.excerpt)}</p>
                <div class="bd-meta bd-enter" style="--d: 180ms">
                    ${authorHTML}
                    <div class="bd-meta-pills">
                        <span class="bd-pill">${ICONS.calendar}<span>${escapeHTML(post.date)}</span></span>
                        <span class="bd-pill">${ICONS.clock}<span>${escapeHTML(post.readTime)}</span></span>
                    </div>
                </div>
            </header>

            <figure class="bd-cover bd-enter" style="--d: 240ms">
                <img class="bd-cover-img" src="${escapeHTML(post.cover)}" alt="${escapeHTML(post.coverAlt || post.title)}" fetchpriority="high" decoding="async">
            </figure>

            <div class="bd-layout">
                <aside class="bd-aside">
                    ${tocHTML}
                    <div class="bd-share bd-share-aside">
                        <div class="bd-share-label">Compartir</div>
                        ${shareButtonsHTML()}
                    </div>
                </aside>

                <div class="bd-body">
                    <div class="bd-prose" id="bdProse">${bodyHTML}</div>

                    <div class="bd-endcard">
                        <div class="bd-endcard-text">
                            <div class="bd-endcard-title">¿Te sirvió este artículo?</div>
                            <div class="bd-endcard-sub">Compártelo con alguien a quien también le pueda ayudar.</div>
                        </div>
                        <div class="bd-share bd-share-end">${shareButtonsHTML()}</div>
                    </div>

                    <div class="bd-author-card">
                        <div class="bd-avatar bd-avatar-lg" aria-hidden="true">${escapeHTML(initials(author.name))}</div>
                        <div>
                            <div class="bd-author-kicker">Escrito por</div>
                            <div class="bd-author-name">${escapeHTML(author.name)}</div>
                            <div class="bd-author-role">${escapeHTML(author.role)}</div>
                        </div>
                    </div>
                </div>
            </div>
        </article>

        ${ctaHTML()}

        ${related.length ? `
        <section class="bd-related" aria-labelledby="bdRelatedTitle">
            <div class="bd-related-head">
                <h2 class="bd-related-title" id="bdRelatedTitle">Artículos relacionados</h2>
                <a class="bd-related-all" href="/blog">Ver todos ${ICONS.arrow}</a>
            </div>
            <div class="bd-related-grid">${related.map(relatedCardHTML).join('')}</div>
        </section>` : ''}
    `;

    root.classList.add('is-ready');

    const cta = root.querySelector('.bd-cta-btn');
    if (cta) cta.addEventListener('click', () => openWhatsApp(`¡Hola! Leí el artículo "${post.title}" en su blog y me gustaría saber cómo aplicarlo en mi negocio.`));
}

function renderNotFound(root, posts) {
    document.title = 'Artículo no encontrado - Attomos';
    const suggestions = posts.slice(0, 3);

    root.innerHTML = `
        <section class="bd-notfound">
            <div class="bd-notfound-card bd-enter" style="--d: 0ms">
                <div class="bd-notfound-icon">${ICONS.search}</div>
                <h1 class="bd-notfound-title">Artículo no encontrado</h1>
                <p class="bd-notfound-text">Es posible que el enlace esté incompleto o que el artículo ya no esté disponible. Te invitamos a explorar el resto de nuestro blog.</p>
                <a class="bd-btn" href="/blog">${ICONS.back}<span>Volver al blog</span></a>
            </div>
        </section>
        ${suggestions.length ? `
        <section class="bd-related" aria-labelledby="bdRelatedTitle">
            <div class="bd-related-head">
                <h2 class="bd-related-title" id="bdRelatedTitle">Artículos recientes</h2>
            </div>
            <div class="bd-related-grid">${suggestions.map(relatedCardHTML).join('')}</div>
        </section>` : ''}
    `;
    root.classList.add('is-ready', 'is-notfound');

    const bar = document.getElementById('bdProgress');
    if (bar) bar.hidden = true;
    initReveal();
}

function shareButtonsHTML() {
    return `
        <button type="button" class="bd-share-btn bd-share-copy" data-share="copy" aria-label="Copiar enlace">
            <span class="bd-share-ico">${ICONS.link}</span>
            <span class="bd-share-ico bd-share-ico-ok">${ICONS.check}</span>
            <span class="bd-share-text">Copiar enlace</span>
        </button>
        <a class="bd-share-btn bd-share-round is-wa" data-share="whatsapp" href="#" target="_blank" rel="noopener" aria-label="Compartir en WhatsApp">${ICONS.whatsapp}</a>
        <a class="bd-share-btn bd-share-round is-x" data-share="x" href="#" target="_blank" rel="noopener" aria-label="Compartir en X">${ICONS.x}</a>
        <a class="bd-share-btn bd-share-round is-in" data-share="linkedin" href="#" target="_blank" rel="noopener" aria-label="Compartir en LinkedIn">${ICONS.linkedin}</a>
    `;
}

function ctaHTML() {
    return `
        <section class="bd-cta">
            <div class="bd-cta-card">
                <div class="bd-cta-kicker">Attomos · Agentes de IA</div>
                <h2 class="bd-cta-title">Pon a trabajar un agente de IA en tu WhatsApp</h2>
                <p class="bd-cta-sub">Responde al instante, agenda citas y toma pedidos las 24 horas, conectado con Google Calendar, Google Sheets y Chatwoot.</p>
                <button type="button" class="bd-cta-btn">
                    ${ICONS.whatsapp}
                    <span>Hablar por WhatsApp</span>
                </button>
            </div>
        </section>`;
}

function relatedCardHTML(p) {
    const thumb = String(p.cover || '').replace(/w=\d+/, 'w=800');
    return `
        <a class="bd-rcard" href="${escapeHTML(postUrl(p.slug))}">
            <div class="bd-rcard-img"><img src="${escapeHTML(thumb)}" alt="${escapeHTML(p.coverAlt || p.title)}" loading="lazy" decoding="async"></div>
            <div class="bd-rcard-body">
                <div class="bd-rcard-meta">
                    <span class="bd-cat bd-cat-sm">${escapeHTML(p.categoryLabel)}</span>
                    <span class="bd-rcard-time">${escapeHTML(p.readTime)}</span>
                </div>
                <h3 class="bd-rcard-title">${escapeHTML(p.title)}</h3>
                <p class="bd-rcard-excerpt">${escapeHTML(p.excerpt)}</p>
                <span class="bd-rcard-link">Leer más ${ICONS.arrow}</span>
            </div>
        </a>`;
}

function getRelated(post, posts, count) {
    const others = posts.filter(p => p.slug !== post.slug);
    const same = others.filter(p => p.category === post.category);
    const rest = others.filter(p => p.category !== post.category);
    return same.concat(rest).slice(0, count);
}

function setMetaDescription(text) {
    let meta = document.querySelector('meta[name="description"]');
    if (!meta) {
        meta = document.createElement('meta');
        meta.name = 'description';
        document.head.appendChild(meta);
    }
    meta.content = stripMarks(text);
}

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
    const url = canonicalUrl(post);
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
    const els = document.querySelectorAll('.bd-prose h2, .bd-prose h3, .bd-quote, .bd-tip, .bd-endcard, .bd-author-card, .bd-cta-card, .bd-related-head, .bd-rcard');
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