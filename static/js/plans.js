// Plans page functionality

document.addEventListener('DOMContentLoaded', function() {
    const billingToggle = document.getElementById('billingToggle');
    const priceAmounts = document.querySelectorAll('.price-amount');
    const pricePeriods = document.querySelectorAll('.price-period');

    // Toggle between monthly and annual billing
    if (billingToggle) {
        billingToggle.addEventListener('change', function() {
            const isAnnual = this.checked;
            
            priceAmounts.forEach(priceElement => {
                const monthly = priceElement.getAttribute('data-monthly');
                const annual = priceElement.getAttribute('data-annual');
                
                if (monthly && annual) {
                    if (isAnnual) {
                        // Mostrar precio anual (ya con descuento del 20%)
                        priceElement.textContent = '$' + annual;
                    } else {
                        // Mostrar precio mensual
                        priceElement.textContent = '$' + monthly;
                    }
                }
            });

            // Actualizar el texto del período
            pricePeriods.forEach(period => {
                if (isAnnual) {
                    period.textContent = '/ año';
                } else {
                    period.textContent = '/ mes';
                }
            });
        });
    }

    // Handle plan button clicks
    const planButtons = document.querySelectorAll('.plan-button');
    planButtons.forEach(button => {
        button.addEventListener('click', function() {
            if (this.classList.contains('upgrade') || this.classList.contains('free-trial')) {
                const plan = this.closest('.pricing-card').getAttribute('data-plan');
                handleUpgrade(plan);
            } else if (this.classList.contains('secondary')) {
                handleContactSales();
            }
        });
    });

    // Animación de entrada para filas de la comparison table
    const tableRows = document.querySelectorAll('.comparison-table tbody tr');
    if (tableRows.length) {
        const rowObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('animate-in');
                    rowObserver.unobserve(entry.target);
                }
            });
        }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

        tableRows.forEach(row => rowObserver.observe(row));
    }

    // Handle FAQ accordion
    const faqItems = document.querySelectorAll('.faq-item');
    faqItems.forEach(item => {
        const question = item.querySelector('.faq-question');
        
        question.addEventListener('click', function() {
            // Toggle active class
            const isActive = item.classList.contains('active');
            
            // Close all other FAQs with smooth animation
            faqItems.forEach(otherItem => {
                if (otherItem !== item && otherItem.classList.contains('active')) {
                    otherItem.classList.remove('active');
                }
            });
            
            // Toggle current FAQ
            if (isActive) {
                item.classList.remove('active');
            } else {
                item.classList.add('active');
            }
        });
    });
});

function handleUpgrade(plan) {
    console.log('Upgrading to plan:', plan);
    
    // Si es el plan gratuito, ir directo a select-plan
    if (plan === 'gratuito') {
        window.location.href = '/select-plan';
        return;
    }
    
    // Detectar si está en modo anual
    const billingToggle = document.getElementById('billingToggle');
    const isAnnual = billingToggle ? billingToggle.checked : false;
    const billingPeriod = isAnnual ? 'annual' : 'monthly';
    
    // Redirigir con parámetros de plan y período
    window.location.href = `/checkout?plan=${plan}&billing=${billingPeriod}`;
}

function handleContactSales() {
    console.log('Contact sales clicked');
    
    // Redirigir a formulario de contacto o abrir modal
    window.location.href = '/contact-sales';
}