// ============================================
// BLOG PAGE JAVASCRIPT
// ============================================

document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 Blog page cargado correctamente');
    
    // Inicializar todas las funcionalidades
    initParticles();
    initCategoryFilters();
    initIOSSegments('.category-filters', '.category-btn');
    initSectionFadeIn('.featured-post-section, .blog-categories-section, .blog-grid-section, .newsletter-section');
    initPagination();
    initNewsletter();
    initPostLinks();
    
    console.log('✅ Todas las funcionalidades de blog inicializadas');
});

// ============================================
// CATEGORY FILTERS
// ============================================
function initCategoryFilters() {
    const categoryBtns = document.querySelectorAll('.category-btn');
    const blogCards = document.querySelectorAll('.blog-card');

    categoryBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            const category = this.getAttribute('data-category');
            
            // Update active button
            categoryBtns.forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            
            // Filter cards
            blogCards.forEach(card => {
                const cardCategory = card.getAttribute('data-category');
                
                if (category === 'all' || cardCategory === category) {
                    card.style.display = 'block';
                    setTimeout(() => {
                        card.style.opacity = '1';
                        card.style.transform = 'translateY(0)';
                    }, 10);
                } else {
                    card.style.opacity = '0';
                    card.style.transform = 'translateY(30px)';
                    setTimeout(() => {
                        card.style.display = 'none';
                    }, 300);
                }
            });
            
            console.log(`🔍 Categoría filtrada: ${category}`);
        });
    });
}

// ============================================
// POST LINKS → /blog/<slug>
// Tarjetas, destacado y sus botones abren el detalle del artículo.
// ============================================
function initPostLinks() {
    const items = document.querySelectorAll('.featured-post[data-slug], .blog-card[data-slug]');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    items.forEach(item => {
        const slug = item.getAttribute('data-slug');
        if (!slug) return;
        const url = `/blog/${encodeURIComponent(slug)}`;
        const titleEl = item.querySelector('.featured-title, .blog-title');

        item.setAttribute('tabindex', '0');
        item.setAttribute('role', 'link');
        if (titleEl) item.setAttribute('aria-label', titleEl.textContent.trim());

        item.addEventListener('click', (e) => {
            // Ctrl/Cmd + clic abre en otra pestaña, como un enlace normal
            if (e.metaKey || e.ctrlKey || e.shiftKey) {
                window.open(url, '_blank');
                return;
            }
            openPost(item, url);
        });

        item.addEventListener('auxclick', (e) => {
            if (e.button === 1) window.open(url, '_blank');
        });

        item.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' || e.target !== item) return;
            e.preventDefault();
            openPost(item, url);
        });
    });

    function openPost(item, url) {
        if (item.dataset.opening) return;
        item.dataset.opening = '1';

        if (reduceMotion || typeof item.animate !== 'function') {
            window.location.href = url;
            return;
        }

        // Pequeña animación de presión antes de navegar
        item.animate(
            [{ transform: 'translateY(-4px) scale(1)' }, { transform: 'translateY(0) scale(0.975)' }],
            { duration: 150, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'forwards' }
        );
        setTimeout(() => { window.location.href = url; }, 150);
    }

    // Al volver con el botón "atrás" (bfcache) la tarjeta regresa a su estado normal
    window.addEventListener('pageshow', (e) => {
        if (!e.persisted) return;
        items.forEach(item => {
            delete item.dataset.opening;
            if (item.getAnimations) item.getAnimations().forEach(a => a.cancel());
        });
    });
}

// ============================================
// PAGINATION
// ============================================
function initPagination() {
    const paginationBtns = document.querySelectorAll('.pagination-btn');
    
    paginationBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            if (this.disabled) return;
            
            paginationBtns.forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            
            // Scroll suave al inicio de los posts
            const blogGrid = document.querySelector('.blog-grid-section');
            if (blogGrid) {
                blogGrid.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
            
            console.log('📄 Página cambiada');
        });
    });
}

// ============================================
// NEWSLETTER FORM
// ============================================
function initNewsletter() {
    const newsletterForm = document.querySelector('.newsletter-form');
    
    if (newsletterForm) {
        newsletterForm.addEventListener('submit', function(e) {
            e.preventDefault();
            
            const emailInput = this.querySelector('.newsletter-input');
            const email = emailInput.value;
            
            console.log('📧 Suscripción newsletter:', email);
            
            // Aquí puedes agregar la lógica para enviar el email al backend
            alert('¡Gracias por suscribirte! Te enviaremos los mejores contenidos.');
            emailInput.value = '';
        });
    }
}

// ============================================
// WHATSAPP FUNCTION
// ============================================
function openWhatsApp() {
    const phoneNumber = '+528123092839';
    const message = '¡Hola! Vi su blog y me gustaría obtener más información sobre chatbots de IA.';
    const encodedMessage = encodeURIComponent(message);
    const whatsappUrl = `https://wa.me/${phoneNumber}?text=${encodedMessage}`;
    
    window.open(whatsappUrl, '_blank');
    
    console.log('📱 WhatsApp abierto desde blog');
}

// ============================================
// PARTICLES SYSTEM
// ============================================
function initParticles() {
    const canvas = document.getElementById('particles-canvas');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    let particles = [];
    let mouse = { x: null, y: null, radius: 150 };

    canvas.width = canvas.parentElement.offsetWidth;
    canvas.height = canvas.parentElement.offsetHeight;

    canvas.parentElement.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        mouse.x = e.clientX - rect.left;
        mouse.y = e.clientY - rect.top;
    });

    canvas.parentElement.addEventListener('mouseout', () => {
        mouse.x = null;
        mouse.y = null;
    });

    window.addEventListener('resize', () => {
        canvas.width = canvas.parentElement.offsetWidth;
        canvas.height = canvas.parentElement.offsetHeight;
        init();
    });

    class Particle {
        constructor(x, y) {
            this.x = x;
            this.y = y;
            this.size = Math.random() * 2.5 + 1.5;
            this.vx = (Math.random() - 0.5) * 0.5;
            this.vy = (Math.random() - 0.5) * 0.5;
            
            const colors = [
                'rgba(6, 182, 212, ',
                'rgba(8, 145, 178, ',
                'rgba(34, 211, 238, ',
                'rgba(14, 165, 233, '
            ];
            this.color = colors[Math.floor(Math.random() * colors.length)];
        }

        draw() {
            ctx.fillStyle = this.color + '0.9)';
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.closePath();
            ctx.fill();
            
            ctx.fillStyle = this.color + '0.5)';
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size + 3, 0, Math.PI * 2);
            ctx.closePath();
            ctx.fill();
        }

        update() {
            this.x += this.vx;
            this.y += this.vy;

            if (this.x < -10) this.x = canvas.width + 10;
            if (this.x > canvas.width + 10) this.x = -10;
            if (this.y < -10) this.y = canvas.height + 10;
            if (this.y > canvas.height + 10) this.y = -10;

            if (mouse.x != null && mouse.y != null) {
                let dx = mouse.x - this.x;
                let dy = mouse.y - this.y;
                let distance = Math.sqrt(dx * dx + dy * dy);

                if (distance < mouse.radius) {
                    let force = (mouse.radius - distance) / mouse.radius;
                    let angle = Math.atan2(dy, dx);
                    this.vx -= Math.cos(angle) * force * 0.3;
                    this.vy -= Math.sin(angle) * force * 0.3;
                }
            }

            const maxSpeed = 1.2;
            const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
            if (speed > maxSpeed) {
                this.vx = (this.vx / speed) * maxSpeed;
                this.vy = (this.vy / speed) * maxSpeed;
            }

            this.vx *= 0.98;
            this.vy *= 0.98;

            if (Math.abs(this.vx) < 0.1) this.vx += (Math.random() - 0.5) * 0.08;
            if (Math.abs(this.vy) < 0.1) this.vy += (Math.random() - 0.5) * 0.08;
        }
    }

    function init() {
        particles = [];
        const numberOfParticles = Math.floor((canvas.width * canvas.height) / 10000);
        
        for (let i = 0; i < numberOfParticles; i++) {
            let x = Math.random() * canvas.width;
            let y = Math.random() * canvas.height;
            particles.push(new Particle(x, y));
        }
    }

    function connect() {
        for (let a = 0; a < particles.length; a++) {
            for (let b = a + 1; b < particles.length; b++) {
                let dx = particles[a].x - particles[b].x;
                let dy = particles[a].y - particles[b].y;
                let distance = Math.sqrt(dx * dx + dy * dy);

                if (distance < 120) {
                    let opacity = 1 - (distance / 120);
                    
                    ctx.strokeStyle = `rgba(6, 182, 212, ${opacity * 0.5})`;
                    ctx.lineWidth = opacity * 2;
                    ctx.beginPath();
                    ctx.moveTo(particles[a].x, particles[a].y);
                    ctx.lineTo(particles[b].x, particles[b].y);
                    ctx.stroke();
                }
            }
        }
    }

    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        for (let i = 0; i < particles.length; i++) {
            particles[i].update();
            particles[i].draw();
        }
        
        connect();
        requestAnimationFrame(animate);
    }

    init();
    animate();
    
    console.log('✅ Sistema de partículas inicializado');
}

// ============================================
// FADE-IN ANIMATION FOR SECTIONS (igual que index.js)
// ============================================
function initSectionFadeIn(selector) {
    const sections = document.querySelectorAll(selector);
    if (!sections.length) return;

    sections.forEach(section => {
        section.style.opacity    = '0';
        section.style.transform  = 'translateY(40px) scale(0.97)';
        section.style.transition = 'opacity 1s cubic-bezier(0.16, 1, 0.3, 1), transform 1s cubic-bezier(0.16, 1, 0.3, 1)';
    });

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity   = '1';
                entry.target.style.transform = 'translateY(0) scale(1)';
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.08, rootMargin: '0px 0px -50px 0px' });

    sections.forEach(s => observer.observe(s));
    console.log('✅ Section fade-in inicializado');
}

// ============================================
// CONTROL SEGMENTADO iOS 27
// Convierte una fila de botones en un control segmentado: una píldora
// cian se desliza con resorte hasta el botón activo. Observa la clase
// .active, así que funciona con la lógica de filtros que ya existe.
// ============================================
function initIOSSegments(containerSelector, itemSelector) {
    document.querySelectorAll(containerSelector).forEach((bar) => {
        if (bar.classList.contains('ios-seg')) return;
        bar.classList.add('ios-seg');

        const thumb = document.createElement('span');
        thumb.className = 'ios-seg-thumb';
        thumb.setAttribute('aria-hidden', 'true');
        bar.prepend(thumb);

        function place(instant = false) {
            const active = bar.querySelector(`${itemSelector}.active`);
            if (!active) { thumb.style.opacity = '0'; return; }
            if (instant) thumb.style.transition = 'none';
            thumb.style.width = `${active.offsetWidth}px`;
            thumb.style.height = `${active.offsetHeight}px`;
            thumb.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
            thumb.style.opacity = '1';
            if (instant) {
                void thumb.offsetWidth;
                thumb.style.transition = '';
            }
            // En móvil la fila se desplaza para dejar visible la opción activa
            if (bar.scrollWidth > bar.clientWidth + 1) {
                const left = active.offsetLeft - (bar.clientWidth - active.offsetWidth) / 2;
                bar.scrollTo({ left, behavior: instant ? 'auto' : 'smooth' });
            }
        }

        new MutationObserver(() => place()).observe(bar, { subtree: true, attributes: true, attributeFilter: ['class'] });
        if ('ResizeObserver' in window) new ResizeObserver(() => place(true)).observe(bar);
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => place(true));
        place(true);
    });
}