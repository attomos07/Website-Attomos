// ============================================
// CONTACT.JS - FUNCIONALIDADES ESPECÍFICAS
// ============================================

document.addEventListener('DOMContentLoaded', function() {
    console.log('📞 Contact page loaded');
    
    // Inicializar todas las funcionalidades
    initParticles();
    initContactMethods();
    initSectionFadeIn('.contact-methods-section, .contact-form-section, .map-section');
    initContactForm();
    initMapFunctionality();
    initConsultationCard();
    
    console.log('✅ Contact functionality initialized');
});

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
                'rgba(34, 211, 238, ',
                'rgba(103, 232, 249, ',
                'rgba(34, 211, 238, ',
                'rgba(103, 232, 249, '
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
                    
                    ctx.strokeStyle = `rgba(34, 211, 238, ${opacity * 0.4})`;
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
// CONTACT METHODS INTERACTIONS
// ============================================
function initContactMethods() {
    const contactMethods = document.querySelectorAll('.contact-method-card');
    
    if (contactMethods.length === 0) return;
    
    contactMethods.forEach(method => {
        method.addEventListener('mouseenter', function() {
            this.classList.add('hovered');
            
            const icon = this.querySelector('.method-icon');
            if (icon) {
                icon.style.transform = 'scale(1.1) rotate(5deg)';
            }
        });
        
        method.addEventListener('mouseleave', function() {
            this.classList.remove('hovered');
            
            const icon = this.querySelector('.method-icon');
            if (icon) {
                icon.style.transform = 'scale(1) rotate(0deg)';
            }
        });
    });
    
    initContactButtons();
}

// ============================================
// CONTACT BUTTONS FUNCTIONALITY
// ============================================
function initContactButtons() {
    const whatsappBtns = document.querySelectorAll('.method-link[href*="wa.me"]');
    whatsappBtns.forEach(btn => {
        btn.addEventListener('click', function(e) {
            animateButton(this);
            trackContactAction('whatsapp', 'button_click');
        });
    });
    
    const emailBtns = document.querySelectorAll('.method-link[href^="mailto"]');
    emailBtns.forEach(btn => {
        btn.addEventListener('click', function(e) {
            animateButton(this);
            trackContactAction('email', 'button_click');
        });
    });
    
    const phoneBtns = document.querySelectorAll('.method-link[href^="tel"]');
    phoneBtns.forEach(btn => {
        btn.addEventListener('click', function(e) {
            animateButton(this);
            trackContactAction('phone', 'button_click');
        });
    });
}

// ============================================
// CONTACT FORM FUNCTIONALITY
// ============================================
function initContactForm() {
    const contactForm = document.getElementById('contactForm');
    
    if (!contactForm) return;
    
    initFormValidation(contactForm);
    
    contactForm.addEventListener('submit', function(e) {
        e.preventDefault();
        
        if (validateForm(this)) {
            processContactForm(this);
        }
    });
}

// ============================================
// FORM VALIDATION
// ============================================
function initFormValidation(form) {
    const requiredFields = form.querySelectorAll('input[required], textarea[required]');
    
    requiredFields.forEach(field => {
        field.addEventListener('blur', function() {
            validateField(this);
        });
        
        field.addEventListener('input', function() {
            if (this.classList.contains('error')) {
                this.classList.remove('error');
                clearFieldError(this);
            }
        });
    });
    
    const emailField = form.querySelector('input[type="email"]');
    if (emailField) {
        emailField.addEventListener('blur', function() {
            validateEmail(this);
        });
    }
}

function validateField(field) {
    const value = field.value.trim();
    
    if (field.hasAttribute('required') && !value) {
        showFieldError(field, 'Este campo es obligatorio');
        return false;
    }
    
    if (field.type === 'email' && value) {
        return validateEmail(field);
    }
    
    clearFieldError(field);
    return true;
}

function validateEmail(field) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const isValid = emailRegex.test(field.value);
    
    if (!isValid) {
        showFieldError(field, 'Por favor ingrese un email válido');
        return false;
    }
    
    clearFieldError(field);
    return true;
}

function validateForm(form) {
    const requiredFields = form.querySelectorAll('input[required], textarea[required]');
    let isValid = true;
    
    requiredFields.forEach(field => {
        if (!validateField(field)) {
            isValid = false;
        }
    });
    
    return isValid;
}

function showFieldError(field, message) {
    field.classList.add('error');
    
    clearFieldError(field);
    
    const errorDiv = document.createElement('div');
    errorDiv.className = 'field-error';
    errorDiv.textContent = message;
    
    field.parentNode.insertBefore(errorDiv, field.nextSibling);
}

function clearFieldError(field) {
    const errorDiv = field.parentNode.querySelector('.field-error');
    if (errorDiv) {
        errorDiv.remove();
    }
}

// ============================================
// FORM PROCESSING
// ============================================
function processContactForm(form) {
    const formData = new FormData(form);
    const data = Object.fromEntries(formData);
    
    const submitBtn = form.querySelector('.submit-btn');
    const originalText = submitBtn.textContent;
    submitBtn.innerHTML = '<i class="lni lni-spinner-arrow"></i> Enviando...';
    submitBtn.disabled = true;
    
    const whatsappMessage = createWhatsAppMessage(data);
    
    setTimeout(() => {
        trackFormSubmission(data);
        
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
        
        showSuccessMessage();
        
        openWhatsAppWithMessage(whatsappMessage);
        
        form.reset();
        
    }, 1500);
}

function createWhatsAppMessage(data) {
    let message = `¡Hola! Me interesa información sobre sus chatbots.\n\n`;
    message += `*Información de Contacto:*\n`;
    message += `• Nombre: ${data.name}\n`;
    message += `• Email: ${data.email}\n`;
    if (data.phone) message += `• Teléfono: ${data.phoneCode ? data.phoneCode + ' ' : ''}${data.phone}\n`;
    if (data.company) message += `• Empresa: ${data.company}\n`;
    if (data.subject) message += `• Asunto: ${data.subject}\n`;
    
    message += `\n*Mensaje:*\n${data.message}`;
    
    return message;
}

// ============================================
// MAP FUNCTIONALITY
// ============================================
function initMapFunctionality() {
    const mapContainer = document.querySelector('.map-container');
    
    if (mapContainer) {
        mapContainer.addEventListener('mouseenter', function() {
            this.style.transform = 'scale(1.02)';
        });
        
        mapContainer.addEventListener('mouseleave', function() {
            this.style.transform = 'scale(1)';
        });
    }
}

function openMap() {
    const mapsURL = 'https://www.google.com/maps/search/?api=1&query=Hermosillo,+Sonora,+Mexico';
    window.open(mapsURL, '_blank');
    
    trackContactAction('map', 'open_location');
}

// ============================================
// CONSULTATION CARD
// ============================================
function initConsultationCard() {
    const consultationBtns = document.querySelectorAll('.consultation-btn');
    
    consultationBtns.forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.preventDefault();
            
            animateButton(this);
            trackContactAction('consultation', 'request');
            
            const message = '¡Hola! Me gustaría agendar la consultoría gratuita de 30 minutos que ofrecen. ¿Qué disponibilidad tienen?';
            openWhatsAppWithMessage(message);
        });
    });
}

// ============================================
// UTILITY FUNCTIONS
// ============================================
function animateButton(button) {
    button.style.transform = 'scale(0.95)';
    setTimeout(() => {
        button.style.transform = 'scale(1)';
    }, 150);
}

function showSuccessMessage() {
    const successDiv = document.createElement('div');
    successDiv.className = 'success-message';
    successDiv.innerHTML = `
        <div class="success-content">
            <i class="lni lni-checkmark-circle"></i>
            <div>
                <h3>¡Mensaje enviado!</h3>
                <p>Te contactaremos pronto por WhatsApp</p>
            </div>
        </div>
    `;
    
    document.body.appendChild(successDiv);
    
    setTimeout(() => {
        successDiv.classList.add('show');
    }, 100);
    
    setTimeout(() => {
        successDiv.classList.remove('show');
        setTimeout(() => {
            successDiv.remove();
        }, 300);
    }, 5000);
}

function openWhatsAppWithMessage(customMessage) {
    const phoneNumber = '526623710899';
    const encodedMessage = encodeURIComponent(customMessage);
    const whatsappURL = `https://wa.me/${phoneNumber}?text=${encodedMessage}`;
    window.open(whatsappURL, '_blank');
}

function openWhatsApp() {
    const message = '¡Hola! Me gustaría obtener más información sobre los chatbots de IA.';
    openWhatsAppWithMessage(message);
}

// ============================================
// ANALYTICS Y TRACKING
// ============================================
function trackContactAction(type, action) {
    console.log(`Contact action: ${type} - ${action}`);
    
    if (typeof gtag !== 'undefined') {
        gtag('event', 'contact_action', {
            'action_type': type,
            'action_name': action,
            'event_category': 'contact',
            'event_label': `${type}-${action}`
        });
    }
}

function trackFormSubmission(data) {
    console.log('Form submitted:', data);
    
    if (typeof gtag !== 'undefined') {
        gtag('event', 'form_submission', {
            'form_type': 'contact',
            'subject': data.subject || 'not_specified',
            'event_category': 'conversion',
            'event_label': 'contact_form'
        });
    }
}

console.log('📞 Contact.js loaded successfully');

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

// ============================================================================
// MENÚ iOS 27 — motor común para el selector de Asunto y el de lada
// ============================================================================
const IOSPick = (function () {
    const CHEV = '<svg class="ios-pick-chev" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2 4l4 4 4-4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    let current = null;

    function close(instant) {
        if (!current) return;
        const { menu, trigger } = current;
        current = null;
        trigger.classList.remove('is-open');
        trigger.setAttribute('aria-expanded', 'false');
        if (instant) { menu.remove(); return; }
        menu.classList.add('is-closing');
        setTimeout(() => menu.remove(), 180);
    }

    function open(trigger, items, onPick) {
        if (current && current.trigger === trigger) { close(); return; }
        close(true);
        const menu = document.createElement('div');
        menu.className = 'ios-pick-menu';
        menu.setAttribute('role', 'listbox');
        menu.innerHTML = '<div class="ios-pick-lens" aria-hidden="true"></div>' + items.map((it, i) =>
            `<button type="button" role="option" class="ios-pick-opt${it.selected ? ' is-selected' : ''}${it.placeholder ? ' is-placeholder' : ''}" data-i="${i}" style="--i:${i}" aria-selected="${!!it.selected}">${it.html}</button>`
        ).join('');
        document.body.appendChild(menu);

        const r = trigger.getBoundingClientRect();
        menu.style.minWidth = `${Math.max(220, r.width)}px`;
        const w = menu.offsetWidth, h = menu.offsetHeight;
        const left = Math.min(Math.max(12, r.left), window.innerWidth - w - 12);
        let top = r.bottom + 8, oy = '0%';
        if (top + h > window.innerHeight - 12 && r.top - h - 8 > 12) { top = r.top - h - 8; oy = '100%'; }
        menu.style.left = `${left}px`;
        menu.style.top = `${Math.max(12, top)}px`;
        menu.style.setProperty('--ox', `${Math.min(Math.max(r.left + 30 - left, 0), w)}px`);
        menu.style.setProperty('--oy', oy);

        const lens = menu.querySelector('.ios-pick-lens');
        const opts = [...menu.querySelectorAll('.ios-pick-opt')];
        let hi = Math.max(0, items.findIndex((it) => it.selected));
        function light(i, scroll) {
            hi = i;
            const o = opts[i];
            if (!o) return;
            lens.style.height = `${o.offsetHeight}px`;
            lens.style.transform = `translateY(${o.offsetTop}px)`;
            lens.style.opacity = '1';
            if (scroll) o.scrollIntoView({ block: 'nearest' });
        }
        lens.style.transition = 'none';
        light(hi, true);
        requestAnimationFrame(() => { lens.style.transition = ''; });

        menu.addEventListener('pointermove', (e) => {
            const o = e.target.closest('.ios-pick-opt');
            if (o) light(+o.dataset.i);
        });
        menu.addEventListener('click', (e) => {
            const o = e.target.closest('.ios-pick-opt');
            if (!o) return;
            o.classList.add('is-selected');
            if (navigator.vibrate) navigator.vibrate(6);
            onPick(+o.dataset.i);
            setTimeout(() => close(), 120);
        });

        trigger.classList.add('is-open');
        trigger.setAttribute('aria-expanded', 'true');
        current = { menu, trigger, opts, light: (d) => light(Math.min(opts.length - 1, Math.max(0, hi + d)), true), pick: () => opts[hi] && opts[hi].click() };
    }

    document.addEventListener('pointerdown', (e) => {
        if (current && !current.menu.contains(e.target) && !current.trigger.contains(e.target)) close();
    }, true);
    document.addEventListener('keydown', (e) => {
        if (!current) return;
        if (e.key === 'Escape') { e.preventDefault(); const t = current.trigger; close(); t.focus(); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); current.light(1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); current.light(-1); }
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); current.pick(); }
        else if (e.key === 'Tab') close();
    }, true);
    window.addEventListener('resize', () => close(true));
    document.addEventListener('scroll', (e) => { if (current && !current.menu.contains(e.target)) close(true); }, true);

    function bump(el, cls) {
        el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
    }

    // Convierte un <select> en el menú iOS sin quitarlo del formulario
    function select(sel, opts = {}) {
        if (!sel || sel.dataset.iosPick) return;
        sel.dataset.iosPick = '1';
        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'ios-pick-trigger';
        trigger.setAttribute('aria-haspopup', 'listbox');
        trigger.setAttribute('aria-expanded', 'false');
        if (sel.id) {
            const lbl = document.querySelector(`label[for="${sel.id}"]`);
            if (lbl) { lbl.addEventListener('click', (e) => { e.preventDefault(); trigger.focus(); }); trigger.setAttribute('aria-label', lbl.textContent.trim()); }
        }
        trigger.innerHTML = `<span class="ios-pick-label"></span>${CHEV}`;
        sel.classList.add('ios-pick-native');
        sel.tabIndex = -1;
        sel.setAttribute('aria-hidden', 'true');
        sel.after(trigger);
        const label = trigger.querySelector('.ios-pick-label');

        function sync(animate) {
            const o = sel.options[sel.selectedIndex];
            const text = o ? o.textContent.trim() : '';
            if (animate && label.textContent !== text) bump(label, 'swap');
            label.textContent = text;
            trigger.classList.toggle('is-placeholder', !sel.value);
        }
        trigger.addEventListener('click', () => {
            const items = [...sel.options].map((o) => ({ html: `<span>${o.textContent.trim()}</span>`, selected: o.selected && !!o.value, placeholder: !o.value }));
            open(trigger, items, (i) => {
                sel.selectedIndex = i;
                sel.dispatchEvent(new Event('input', { bubbles: true }));
                sel.dispatchEvent(new Event('change', { bubbles: true }));
                trigger.classList.remove('error');
                trigger.parentNode.querySelector('.field-error.ios-pick-error')?.remove();
                sync(true);
            });
        });
        trigger.addEventListener('keydown', (e) => {
            if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !trigger.classList.contains('is-open')) { e.preventDefault(); trigger.click(); }
        });
        // Si el campo es obligatorio y está vacío, el aviso sale en el botón visible
        sel.addEventListener('invalid', (e) => {
            e.preventDefault();
            bump(trigger, 'error');
            if (opts.errorText && !trigger.parentNode.querySelector('.ios-pick-error')) {
                const err = document.createElement('div');
                err.className = 'field-error ios-pick-error';
                err.textContent = opts.errorText;
                trigger.after(err);
            }
            trigger.focus();
        });
        sel.addEventListener('change', () => sync(false));
        // Las traducciones cambian el texto de las opciones
        new MutationObserver(() => sync(false)).observe(sel, { subtree: true, childList: true, characterData: true });
        sel.form?.addEventListener('reset', () => setTimeout(() => sync(false)));
        sync(false);
        return trigger;
    }

    return { open, close, select, bump, CHEV };
})();

// ============================================================================
// LADA — selector de código de país con las banderas del userbar
// ============================================================================
const IOSLada = (function () {
    const F = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 14" width="22" height="15">${body}</svg>`;
    const COUNTRIES = [
        { iso: 'MX', name: 'México', code: '+52', flag: F('<rect width="20" height="14" fill="#fff"/><rect width="6.67" height="14" fill="#006847"/><rect x="13.33" width="6.67" height="14" fill="#CE1126"/><circle cx="10" cy="7" r="1.8" fill="#8B4513" opacity="0.6"/>') },
        { iso: 'GB', name: 'Reino Unido', code: '+44', flag: F('<rect width="20" height="14" fill="#012169"/><path d="M0,0 L20,14 M20,0 L0,14" stroke="#fff" stroke-width="2.8"/><path d="M0,0 L20,14 M20,0 L0,14" stroke="#C8102E" stroke-width="1.6"/><path d="M10,0 V14 M0,7 H20" stroke="#fff" stroke-width="4"/><path d="M10,0 V14 M0,7 H20" stroke="#C8102E" stroke-width="2.4"/>') },
        { iso: 'RU', name: 'Rusia', code: '+7', flag: F('<rect width="20" height="14" fill="#fff"/><rect y="4.67" width="20" height="4.66" fill="#0035A9"/><rect y="9.33" width="20" height="4.67" fill="#D52B1E"/>') },
        { iso: 'UZ', name: 'Uzbekistán', code: '+998', flag: F('<rect width="20" height="14" fill="#1EB53A"/><rect width="20" height="4.67" fill="#009FCA"/><rect y="9.33" width="20" height="4.67" fill="#009FCA"/><rect y="4.67" width="20" height="4.66" fill="#fff"/>') },
        { iso: 'JP', name: 'Japón', code: '+81', flag: F('<rect width="20" height="14" fill="#fff"/><circle cx="10" cy="7" r="4" fill="#BC002D"/>') },
        { iso: 'CN', name: 'China', code: '+86', flag: F('<rect width="20" height="14" fill="#DE2910"/><polygon points="3,1 3.6,2.9 5.6,2.9 4,4 4.6,5.9 3,4.8 1.4,5.9 2,4 0.4,2.9 2.4,2.9" transform="translate(0.5,0.5) scale(0.95)" fill="#FFDE00"/>') },
        { iso: 'FR', name: 'Francia', code: '+33', flag: F('<rect width="20" height="14" fill="#ED2939"/><rect width="13.33" height="14" fill="#fff"/><rect width="6.67" height="14" fill="#002395"/>') },
        { iso: 'BR', name: 'Brasil', code: '+55', flag: F('<rect width="20" height="14" fill="#009C3B"/><polygon points="10,2 19,7 10,12 1,7" fill="#FEDD00"/><circle cx="10" cy="7" r="3" fill="#003087"/><path d="M7,7.8 Q10,6 13,7.8" stroke="#fff" stroke-width="0.9" fill="none"/>') },
        { iso: 'DE', name: 'Alemania', code: '+49', flag: F('<rect width="20" height="14" fill="#FFCE00"/><rect width="20" height="9.33" fill="#DD0000"/><rect width="20" height="4.67" fill="#000"/>') },
        { iso: 'KR', name: 'Corea del Sur', code: '+82', flag: F('<rect width="20" height="14" fill="#fff"/><circle cx="10" cy="7" r="3.5" fill="#C60C30"/><path d="M10,3.5 A3.5,3.5 0 0,1 10,10.5" fill="#003478"/>') },
    ];

    // input: el campo que guarda el código (+52); mount: dónde va el botón
    function attach(input, mount) {
        if (!input || input.dataset.iosLada) return;
        input.dataset.iosLada = '1';
        if (!input.value) input.value = '+52';
        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'ios-pick-trigger ios-lada-trigger';
        trigger.setAttribute('aria-haspopup', 'listbox');
        trigger.setAttribute('aria-label', 'Código de país');
        trigger.innerHTML = `<span class="ios-flag"></span><span class="ios-pick-label"></span>${IOSPick.CHEV}`;
        if (input.type !== 'hidden') { input.classList.add('ios-pick-native'); input.tabIndex = -1; input.setAttribute('aria-hidden', 'true'); }
        mount.appendChild(trigger);
        const flag = trigger.querySelector('.ios-flag');
        const label = trigger.querySelector('.ios-pick-label');

        const find = () => COUNTRIES.find((c) => c.code === input.value.replace(/\s/g, '')) || null;
        function sync(animate) {
            const c = find();
            flag.innerHTML = c ? c.flag : '';
            flag.style.display = c ? '' : 'none';
            if (animate) { IOSPick.bump(flag, 'flip'); IOSPick.bump(label, 'swap'); }
            label.textContent = input.value || '+52';
        }
        trigger.addEventListener('click', () => {
            const cur = find();
            IOSPick.open(trigger, COUNTRIES.map((c) => ({
                html: `<span class="ios-flag">${c.flag}</span><span>${c.name}</span><span class="ios-pick-code">${c.code}</span>`,
                selected: c === cur,
            })), (i) => {
                input.value = COUNTRIES[i].code;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                input.dispatchEvent(new Event('blur'));
                sync(true);
            });
        });
        trigger.addEventListener('keydown', (e) => {
            if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !trigger.classList.contains('is-open')) { e.preventDefault(); trigger.click(); }
        });
        input.addEventListener('change', () => sync(false));
        input.form?.addEventListener('reset', () => setTimeout(() => { input.value = '+52'; sync(false); }));
        sync(false);
        return trigger;
    }

    return { attach, COUNTRIES };
})();

// Asunto y lada con el menú iOS
document.addEventListener('DOMContentLoaded', function () {
    IOSPick.select(document.getElementById('subject'), { errorText: 'Selecciona un asunto' });
    const code = document.getElementById('phoneCode');
    const phone = document.getElementById('phone');
    if (code && phone) IOSLada.attach(code, phone.parentElement);
});

// Las traducciones de la tarjeta de información traen saltos "<br>" que se
// insertan como texto: se convierten en saltos de línea reales (con el texto escapado)
(function () {
    const esc = (s) => s.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
    function fix(p) {
        if (p.children.length || !/<br\s*\/?>/i.test(p.textContent)) return;
        p.innerHTML = p.textContent.split(/<br\s*\/?>/i).map(esc).join('<br>');
    }
    document.querySelectorAll('.info-content p').forEach((p) => {
        fix(p);
        new MutationObserver(() => fix(p)).observe(p, { childList: true, characterData: true, subtree: true });
    });
})();