// ============================================
// PRICING.JS - FUNCIONALIDADES COMPLETAS
// ============================================

let plansData = null;

document.addEventListener('DOMContentLoaded', function() {
    console.log('💰 Pricing page loaded');
    
    // Inicializar todas las funcionalidades
    initParticles();
    loadPlansData();
    initBillingToggle();
    initSectionFadeIn('.comparison-section, .pricing-cards-section, .comparison-table-section, .faq-section, .cta-section');
    initPricingAnimations();
    initPricingInteractions();
    initComparisonTable();
    initFAQ();
    initCostCalculator();
    
    console.log('✅ Pricing functionality initialized');
});

// ============================================
// CARGAR DATOS DE PLANES DESDE LA API
// ============================================

async function loadPlansData() {
    try {
        const response = await fetch('/api/plans-data', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (!response.ok || !data.success) {
            console.warn('⚠️ No se pudieron cargar precios de Stripe, usando valores del HTML');
            return;
        }
        
        plansData = data.plans;
        console.log('✅ Datos de planes cargados:', plansData);
        
        // Actualizar precios en las tarjetas existentes
        updatePricingCards();
        
    } catch (error) {
        console.error('❌ Error cargando planes:', error);
        // Mantener los precios estáticos del HTML si falla la carga
    }
}

// ============================================
// ACTUALIZAR TARJETAS DE PRECIOS CON DATOS DE STRIPE
// ============================================

function updatePricingCards() {
    if (!plansData) return;
    
    // Verificar si las cards existen en el DOM
    const existingCards = document.querySelectorAll('.pricing-card');
    
    // Si no hay cards en el HTML, renderizarlas dinámicamente
    if (existingCards.length === 0) {
        console.warn('⚠️ No hay cards en el HTML, renderizando dinámicamente...');
        renderPricingCardsDynamically();
        return;
    }
    
    // Si las cards existen, solo actualizar precios
    plansData.forEach(plan => {
        const planCard = document.querySelector(`.pricing-card[data-plan="${plan.id}"]`);
        if (!planCard) return;
        
        const priceElement = planCard.querySelector('.price-amount');
        if (!priceElement) return;
        
        // Actualizar atributos de precio
        const monthlyPrice = plan.monthly.amount || 0;
        const annualPrice = plan.annual.amount || 0;
        
        priceElement.setAttribute('data-monthly', monthlyPrice);
        priceElement.setAttribute('data-annual', annualPrice);
        
        // Actualizar el texto mostrado según el billing toggle actual
        const billingToggle = document.getElementById('billingToggle');
        const isAnnual = billingToggle && billingToggle.checked;
        
        priceElement.textContent = `${isAnnual ? annualPrice : monthlyPrice}`;
        
        console.log(`💰 Precio actualizado para ${plan.id}: Monthly=${monthlyPrice}, Annual=${annualPrice}`);
    });
}

// ============================================
// RENDERIZAR PRICING CARDS DINÁMICAMENTE
// ============================================

function renderPricingCardsDynamically() {
    if (!plansData || plansData.length === 0) {
        console.error('❌ No hay datos de planes para renderizar');
        return;
    }
    
    const pricingGrid = document.querySelector('.pricing-grid');
    if (!pricingGrid) {
        console.error('❌ No se encontró .pricing-grid');
        return;
    }
    
    console.log(`🎨 Renderizando ${plansData.length} pricing cards dinámicamente...`);
    
    pricingGrid.innerHTML = ''; // Limpiar grid
    
    plansData.forEach(plan => {
        const cardHTML = `
            <div class="pricing-card ${plan.popular ? 'featured' : ''}" data-plan="${plan.id}">
                ${plan.popular ? '<div class="popular-badge">Más Popular</div>' : ''}
                
                <h3 class="plan-name">${plan.name}</h3>
                <div class="plan-price">
                    <span class="price-amount" data-monthly="${plan.monthly.amount}" data-annual="${plan.annual.amount}">$${plan.monthly.amount}</span>
                    <span class="price-period">por mes</span>
                </div>
                <p class="plan-description">${plan.description}</p>
                
                <ul class="plan-features">
                    ${plan.features.map(feature => `
                        <li>
                            <div class="check-icon"><i class="lni lni-checkmark"></i></div>
                            <span>${feature}</span>
                        </li>
                    `).join('')}
                </ul>
                
                ${plan.id === 'electron' 
                    ? '<button class="plan-button secondary" onclick="openWhatsApp()">Contactar Ventas</button>'
                    : '<button class="plan-button primary">Elegir Plan</button>'
                }
            </div>
        `;
        
        pricingGrid.insertAdjacentHTML('beforeend', cardHTML);
    });
    
    console.log('✅ Cards renderizadas dinámicamente');
    
    // Re-inicializar interacciones después de renderizar
    setTimeout(() => {
        initPricingInteractions();
        initPricingAnimations();
    }, 100);
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
// BILLING TOGGLE FUNCTIONALITY
// ============================================
function initBillingToggle() {
    const billingToggle = document.getElementById('billingToggle');
    
    if (!billingToggle) return;
    
    billingToggle.addEventListener('change', function() {
        const isYearly = this.checked;
        const allPrices = document.querySelectorAll('.price-amount');
        
        // Animar cambio de precios
        allPrices.forEach(price => {
            price.style.transform = 'scale(0.8)';
            price.style.opacity = '0.5';
        });
        
        setTimeout(() => {
            allPrices.forEach(price => {
                const monthly = price.getAttribute('data-monthly');
                const annual = price.getAttribute('data-annual');
                
                if (monthly && annual) {
                    price.textContent = isYearly ? `$${annual}` : `$${monthly}`;
                }
                
                price.style.transform = 'scale(1)';
                price.style.opacity = '1';
            });
            
            // Actualizar texto del período
            const periodElements = document.querySelectorAll('.price-period');
            periodElements.forEach(period => {
                period.textContent = isYearly ? 'por año' : 'por mes';
            });
        }, 200);
        
        // Actualizar labels
        const monthlyLabel = document.querySelector('.toggle-label.monthly');
        const annualLabel = document.querySelector('.toggle-label.annual');
        
        if (isYearly) {
            monthlyLabel.style.color = '#6b7280';
            annualLabel.style.color = '#06b6d4';
        } else {
            monthlyLabel.style.color = '#06b6d4';
            annualLabel.style.color = '#6b7280';
        }
        
        trackBillingToggle(isYearly ? 'yearly' : 'monthly');
    });
}

// ============================================
// PRICING ANIMATIONS
// ============================================
function initPricingAnimations() {
    const pricingCards = document.querySelectorAll('.pricing-card');
    const comparisonTable = document.querySelector('.comparison-table');
    
    if (pricingCards.length === 0) {
        console.log('⚠️ No hay cards para animar (se renderizarán dinámicamente)');
        return;
    }
    
    const animationObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                if (entry.target.classList.contains('pricing-card')) {
                    entry.target.classList.add('animate-in');
                } else if (entry.target.classList.contains('comparison-table')) {
                    animateTableRows(entry.target);
                }
            }
        });
    }, {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    });

    pricingCards.forEach((card, index) => {
        card.style.animationDelay = `${index * 100}ms`;
        animationObserver.observe(card);
    });
    
    if (comparisonTable) {
        animationObserver.observe(comparisonTable);
    }
}

function animateTableRows(table) {
    const rows = table.querySelectorAll('tbody tr');
    rows.forEach((row, index) => {
        setTimeout(() => {
            row.classList.add('animate-in');
        }, index * 100);
    });
}

// ============================================
// PRICING PLAN INTERACTIONS
// ============================================
function initPricingInteractions() {
    const planButtons = document.querySelectorAll('.plan-button');
    const pricingCards = document.querySelectorAll('.pricing-card');
    
    planButtons.forEach(button => {
        button.addEventListener('click', function(e) {
            e.preventDefault();
            
            const planCard = this.closest('.pricing-card');
            if (!planCard) return;
            
            const planName = planCard.querySelector('.plan-name')?.textContent || 'Unknown';
            const planPrice = planCard.querySelector('.price-amount')?.textContent || '$0';
            
            this.style.transform = 'scale(0.95)';
            setTimeout(() => {
                this.style.transform = 'scale(1)';
            }, 150);
            
            trackPlanSelection(planName, planPrice);
            
            const buttonText = this.textContent.toLowerCase();
            if (buttonText.includes('contactar')) {
                handleContactSales(planName);
            } else {
                handlePlanSelection(planName, planPrice);
            }
        });
    });
    
    pricingCards.forEach(card => {
        card.addEventListener('mouseenter', function() {
            this.classList.add('hovered');
        });
        
        card.addEventListener('mouseleave', function() {
            this.classList.remove('hovered');
        });
    });
}

function handleContactSales(planName) {
    const message = `¡Hola! Me interesa el plan ${planName} de chatbots. ¿Pueden contactarme para más detalles?`;
    openWhatsAppWithMessage(message);
}

function handlePlanSelection(planName, planPrice) {
    const message = `¡Hola! Me interesa contratar el plan ${planName} (${planPrice}/mes). ¿Pueden darme más información sobre el proceso?`;
    openWhatsAppWithMessage(message);
}

// ============================================
// COMPARISON TABLE
// ============================================
function initComparisonTable() {
    const table = document.querySelector('.comparison-table');
    if (!table) return;
    
    makeTableResponsive(table);
    
    const featureRows = table.querySelectorAll('tbody tr');
    featureRows.forEach(row => {
        row.addEventListener('mouseenter', function() {
            this.classList.add('highlighted');
        });
        
        row.addEventListener('mouseleave', function() {
            this.classList.remove('highlighted');
        });
    });
    
    const headers = table.querySelectorAll('th:not(.feature-column)');
    headers.forEach((header, index) => {
        header.addEventListener('mouseenter', function() {
            highlightColumn(table, index + 1);
        });
        
        header.addEventListener('mouseleave', function() {
            unhighlightColumns(table);
        });
    });
}

function makeTableResponsive(table) {
    const wrapper = table.parentElement;
    if (wrapper && wrapper.classList.contains('comparison-table-wrapper')) {
        
        const scrollIndicator = document.createElement('div');
        scrollIndicator.className = 'scroll-indicator';
        scrollIndicator.textContent = '← Desliza para ver más →';
        wrapper.appendChild(scrollIndicator);
        
        wrapper.addEventListener('scroll', function() {
            const maxScroll = this.scrollWidth - this.clientWidth;
            const currentScroll = this.scrollLeft;
            
            if (currentScroll > 10) {
                scrollIndicator.style.opacity = '0';
            } else {
                scrollIndicator.style.opacity = '1';
            }
        });
    }
}

function highlightColumn(table, columnIndex) {
    const cells = table.querySelectorAll(`td:nth-child(${columnIndex + 1}), th:nth-child(${columnIndex + 1})`);
    cells.forEach(cell => {
        cell.classList.add('column-highlighted');
    });
}

function unhighlightColumns(table) {
    const highlightedCells = table.querySelectorAll('.column-highlighted');
    highlightedCells.forEach(cell => {
        cell.classList.remove('column-highlighted');
    });
}

// ============================================
// FAQ FUNCTIONALITY
// ============================================
function initFAQ() {
    const faqItems = document.querySelectorAll('.faq-item');
    
    faqItems.forEach(item => {
        const question = item.querySelector('.faq-question');
        
        question.addEventListener('click', function() {
            const wasActive = item.classList.contains('active');
            
            faqItems.forEach(otherItem => {
                otherItem.classList.remove('active');
            });
            
            if (!wasActive) {
                item.classList.add('active');
            }
        });
    });
}

// ============================================
// UTILITY FUNCTIONS
// ============================================
function openWhatsAppWithMessage(customMessage) {
    const phoneNumber = '528123092839';
    const encodedMessage = encodeURIComponent(customMessage);
    const whatsappURL = `https://wa.me/${phoneNumber}?text=${encodedMessage}`;
    window.open(whatsappURL, '_blank');
}

function openWhatsApp() {
    const message = '¡Hola! Me gustaría obtener más información sobre los planes de chatbots.';
    openWhatsAppWithMessage(message);
}

// ============================================
// ANALYTICS Y TRACKING
// ============================================
function trackBillingToggle(billingType) {
    console.log(`Billing changed to: ${billingType}`);
    
    if (typeof gtag !== 'undefined') {
        gtag('event', 'billing_toggle', {
            'billing_type': billingType,
            'event_category': 'pricing',
            'event_label': billingType
        });
    }
}

function trackPlanSelection(planName, planPrice) {
    console.log(`Plan selected: ${planName} - ${planPrice}`);
    
    if (typeof gtag !== 'undefined') {
        gtag('event', 'plan_selection', {
            'plan_name': planName,
            'plan_price': planPrice,
            'event_category': 'pricing',
            'event_label': planName
        });
    }
}

console.log('💰 Pricing.js loaded successfully');

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
// COST CALCULATOR
// ============================================

function initCostCalculator() {
    // ── Element refs ──
    const convSlider   = document.getElementById('convSlider');
    const convInput    = document.getElementById('convInput');
    const tokInSlider  = document.getElementById('tokInSlider');
    const tokInInput   = document.getElementById('tokInInput');
    const tokOutSlider = document.getElementById('tokOutSlider');
    const tokOutInput  = document.getElementById('tokOutInput');
    if (!convSlider) return;

    // ── State ──
    let conversations  = 1000;
    const messagesPerConv = 10; // fijo: promedio típico de mensajes por conversación
    let tokIn  = 580;   // tokens entrada por mensaje (cliente + contexto)
    let tokOut = 180;   // tokens salida por mensaje (respuesta bot)

    // Precios Gemini 2.5 Flash-Lite (USD / 1M tokens)
    const PRICE_IN  = 0.10;
    const PRICE_OUT = 0.40;
    const MXN_RATE  = 20;

    function fmt(n) { return Math.round(n).toLocaleString('es-MX'); }

    function updateSliderTrack(slider) {
        const min = parseFloat(slider.min);
        const max = parseFloat(slider.max);
        const val = parseFloat(slider.value);
        const pct = ((val - min) / (max - min)) * 100;
        slider.style.background = `linear-gradient(to right, #06b6d4 ${pct}%, #e5e7eb ${pct}%)`;
    }

    function calculate() {
        const totalInTokens  = tokIn  * messagesPerConv * conversations;
        const totalOutTokens = tokOut * messagesPerConv * conversations;
        const totalTokens    = totalInTokens + totalOutTokens;

        const costIn  = (totalInTokens  / 1_000_000) * PRICE_IN;
        const costOut = (totalOutTokens / 1_000_000) * PRICE_OUT;
        const costUSD = costIn + costOut;
        const costMXN = costUSD * MXN_RATE;

        document.getElementById('resultUSD').textContent     = '$' + costUSD.toFixed(2) + ' USD';
        document.getElementById('resultMXN').textContent     = '≈ $' + costMXN.toFixed(0) + ' MXN';
        document.getElementById('bdInput').textContent       = fmt(totalInTokens / 1000) + 'K';
        document.getElementById('bdInputCost').textContent   = '$' + costIn.toFixed(3) + ' USD';
        document.getElementById('bdOutput').textContent      = fmt(totalOutTokens / 1000) + 'K';
        document.getElementById('bdOutputCost').textContent  = '$' + costOut.toFixed(3) + ' USD';
        document.getElementById('bdTotal').textContent       = fmt(totalTokens / 1000) + 'K';

        // Tier: nivel gratuito Gemini ~500 RPD (conversaciones diarias)
        const dailyConv = conversations / 30;
        const tierEl = document.getElementById('resultTier');
        if (dailyConv <= 500) {
            tierEl.className = 'result-tier';
            tierEl.innerHTML = '<i class="lni lni-gift"></i><span>Este volumen entra en el <strong>nivel gratuito</strong> de Gemini — $0 USD en API</span>';
        } else {
            tierEl.className = 'result-tier paid';
            tierEl.innerHTML = '<i class="lni lni-warning"></i><span>Este volumen requiere el <strong>nivel de pago</strong>. Considera cachear el contexto del negocio.</span>';
        }
    }

    // ── Sync slider ↔ number input ──
    function syncPair(slider, input, setter) {
        slider.addEventListener('input', () => {
            const v = parseInt(slider.value);
            setter(v);
            input.value = v;
            updateSliderTrack(slider);
            calculate();
        });
        input.addEventListener('input', () => {
            let v = parseInt(input.value) || 0;
            if (v < parseInt(slider.min)) v = parseInt(slider.min);
            if (v > parseInt(slider.max)) v = parseInt(slider.max);
            slider.value = v;
            setter(v);
            updateSliderTrack(slider);
            calculate();
        });
        input.addEventListener('blur', () => {
            let v = parseInt(input.value) || parseInt(slider.min);
            if (v < parseInt(slider.min)) v = parseInt(slider.min);
            if (v > parseInt(slider.max)) v = parseInt(slider.max);
            input.value = v;
            slider.value = v;
            setter(v);
            updateSliderTrack(slider);
            calculate();
        });
    }

    syncPair(convSlider,   convInput,   v => { conversations   = v; });
    syncPair(tokInSlider,  tokInInput,  v => { tokIn           = v; });
    syncPair(tokOutSlider, tokOutInput, v => { tokOut          = v; });

    // ── Init slider tracks ──
    updateSliderTrack(convSlider);
    updateSliderTrack(tokInSlider);
    updateSliderTrack(tokOutSlider);

    calculate();
}