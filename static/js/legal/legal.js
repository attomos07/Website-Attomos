// ============================================
// LEGAL PAGES JAVASCRIPT
// ============================================

document.addEventListener('DOMContentLoaded', function() {
    console.log('📄 Legal page cargada correctamente');
    
    initTables();
    initBackToTop();
    initSmoothScroll();
    initReveal();
    initReader();
    initParticles();
    
    console.log('✅ Legal page inicializada');
});

// ============================================
// BACK TO TOP BUTTON
// ============================================
function initBackToTop() {
    const backToTopBtn = document.getElementById('backToTop');
    
    if (!backToTopBtn) return;
    
    window.addEventListener('scroll', () => {
        if (window.scrollY > 300) {
            backToTopBtn.classList.add('visible');
        } else {
            backToTopBtn.classList.remove('visible');
        }
    });
    
    backToTopBtn.addEventListener('click', () => {
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    });
}

// ============================================
// SMOOTH SCROLL FOR ANCHOR LINKS
// ============================================
function initSmoothScroll() {
    const anchorLinks = document.querySelectorAll('a[href^="#"]');
    
    anchorLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            
            const targetId = this.getAttribute('href');
            if (targetId === '#') return;
            
            const targetElement = document.querySelector(targetId);
            if (!targetElement) return;
            
            const offsetTop = targetElement.getBoundingClientRect().top + window.scrollY - 100;
            
            window.scrollTo({
                top: offsetTop,
                behavior: 'smooth'
            });
        });
    });
}

// ============================================
// TABLAS — envoltura para bordes redondeados y scroll lateral en móvil
// ============================================
function initTables() {
    document.querySelectorAll('.data-table').forEach((table) => {
        if (table.parentElement.classList.contains('lg-table-scroll')) return;
        const wrap = document.createElement('div');
        wrap.className = 'lg-table-scroll';
        table.parentNode.insertBefore(wrap, table);
        wrap.appendChild(table);
    });
}

// ============================================
// ENTRADA AL HACER SCROLL — las tarjetas suben con resorte
// ============================================
function initReveal() {
    const items = document.querySelectorAll('.table-of-contents, .legal-section, .contact-section, .legal-container > .highlight-box');
    if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const io = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add('lg-in');
            io.unobserve(entry.target);
        });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.04 });

    items.forEach((el) => {
        // Lo que ya está en pantalla al cargar no se oculta
        if (el.getBoundingClientRect().top < window.innerHeight * 0.92) return;
        el.classList.add('lg-reveal');
        io.observe(el);
    });
}

// ============================================
// CÁPSULA DE LECTURA — estilo iOS 27
// Cristal flotante con anillo de progreso, número y título de la
// sección actual, y botón para volver arriba. También marca la
// sección actual en la tabla de contenidos.
// ============================================
function initReader() {
    const sections = [...document.querySelectorAll('.legal-section[id]')];
    if (!sections.length) return;

    const R = 16, C = 2 * Math.PI * R;
    const reader = document.createElement('div');
    reader.className = 'lg-reader';
    reader.setAttribute('role', 'status');
    reader.innerHTML = `
        <span class="lg-reader-ring" aria-hidden="true">
            <svg viewBox="0 0 38 38"><circle class="track" cx="19" cy="19" r="${R}"/><circle class="bar" cx="19" cy="19" r="${R}" stroke-dasharray="${C}" stroke-dashoffset="${C}"/></svg>
            <span class="lg-reader-num"></span>
        </span>
        <span class="lg-reader-title"></span>
        <button class="lg-reader-btn" type="button" aria-label="Volver arriba">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg>
        </button>`;
    document.body.appendChild(reader);

    const bar = reader.querySelector('.bar');
    const num = reader.querySelector('.lg-reader-num');
    const title = reader.querySelector('.lg-reader-title');
    reader.querySelector('.lg-reader-btn').addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    // La cápsula sustituye al botón flotante original
    const backToTop = document.getElementById('backToTop');
    if (backToTop) backToTop.classList.add('lg-hidden');

    const tocLinks = new Map();
    document.querySelectorAll('.toc-list a[href^="#"]').forEach((a) => tocLinks.set(a.getAttribute('href').slice(1), a));

    const labelOf = (sec) => {
        const h = sec.querySelector('.section-title');
        const n = h?.querySelector('.section-number')?.textContent.trim() || '';
        const text = h ? [...h.childNodes].filter((node) => node.nodeType === 3).map((node) => node.textContent).join(' ').trim() : '';
        return { n, text };
    };

    let current = null, ticking = false;

    function update() {
        ticking = false;
        const y = window.scrollY;
        const content = document.querySelector('.legal-content-section');
        const start = content ? content.offsetTop : 0;
        const end = content ? start + content.offsetHeight - window.innerHeight : document.body.scrollHeight - window.innerHeight;
        const progress = Math.min(1, Math.max(0, (y - start + window.innerHeight * 0.3) / Math.max(1, end - start + window.innerHeight * 0.3)));
        bar.style.strokeDashoffset = C * (1 - progress);

        // Sección actual: la última cuyo inicio ya pasó el tercio superior
        const line = window.innerHeight * 0.35;
        let sec = null;
        for (const s of sections) {
            if (s.getBoundingClientRect().top <= line) sec = s;
            else break;
        }

        const footer = document.querySelector('.footer');
        const nearFooter = footer && footer.getBoundingClientRect().top < window.innerHeight - 40;
        reader.classList.toggle('visible', !!sec && !nearFooter);

        if (sec !== current) {
            if (current) {
                current.classList.remove('is-current');
                tocLinks.get(current.id)?.classList.remove('is-current');
            }
            current = sec;
            if (sec) {
                sec.classList.add('is-current');
                tocLinks.get(sec.id)?.classList.add('is-current');
                const { n, text } = labelOf(sec);
                num.textContent = n;
                title.textContent = text;
                title.classList.remove('swap');
                void title.offsetWidth;
                title.classList.add('swap');
            }
        }
    }

    window.addEventListener('scroll', () => {
        if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    window.addEventListener('resize', update);
    update();
}

// ============================================
// PARTICLES SYSTEM (CIAN COMO EN BLOG)
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
            
            // Colores cian como en blog
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
    
    console.log('✅ Sistema de partículas cian inicializado');
}