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
    if (data.phone) message += `• Teléfono: ${data.phone}\n`;
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