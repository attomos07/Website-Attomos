// ============================================
// CHECKOUT JAVASCRIPT - INTEGRACIÓN STRIPE REAL CON PRECIOS DINÁMICOS
// ============================================

let STRIPE_PUBLISHABLE_KEY = '';
let plansData = null;
let selectedPlanData = null;
let currentBillingPeriod = 'monthly';

// Mapeo de códigos de país a códigos telefónicos
const COUNTRY_PHONE_CODES = {
    'MX': '+52',
    'US': '+1',
    'CA': '+1',
    'ES': '+34',
    'AR': '+54',
    'CO': '+57',
    'CL': '+56',
    'PE': '+51'
};

document.addEventListener('DOMContentLoaded', async function() {
    console.log('🛒 Checkout page loaded');
    
    // Cargar clave pública de Stripe desde el backend
    await loadStripePublicKey();
    
    // Cargar datos de planes desde la API
    await loadPlansData();
    
    initLogoAnimation();
    initPaymentMethodToggle();
    initCountryDropdown();
    initStripeElements();
    initFormValidation();
    initPaymentForm();
    
    // Cargar detalles del plan seleccionado (ahora con precios reales)
    loadPlanDetails();
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
            throw new Error('Error al cargar los datos de los planes');
        }
        
        plansData = data.plans;
        console.log('✅ Datos de planes cargados:', plansData);
        
    } catch (error) {
        console.error('❌ Error cargando planes:', error);
        // Si falla, usar precios de respaldo
        plansData = getFallbackPlansData();
    }
}

// ============================================
// DATOS DE RESPALDO SI LA API FALLA
// ============================================

function getFallbackPlansData() {
    return [
        {
            id: 'gratuito',
            name: 'Gratuito',
            displayName: 'Plan Gratuito',
            monthly: { amount: 0, currency: 'MXN' },
            annual: { amount: 0, currency: 'MXN' },
            isFree: true
        },
        {
            id: 'proton',
            name: 'Protón',
            displayName: 'Plan Protón',
            monthly: { amount: 149, currency: 'MXN' },
            annual: { amount: 119, currency: 'MXN' }
        },
        {
            id: 'neutron',
            name: 'Neutrón',
            displayName: 'Plan Neutrón',
            monthly: { amount: 349, currency: 'MXN' },
            annual: { amount: 279, currency: 'MXN' }
        },
        {
            id: 'electron',
            name: 'Electrón',
            displayName: 'Plan Electrón',
            monthly: { amount: 749, currency: 'MXN' },
            annual: { amount: 599, currency: 'MXN' }
        }
    ];
}

// ============================================
// CARGAR CLAVE PÚBLICA DE STRIPE
// ============================================

async function loadStripePublicKey() {
    try {
        const response = await fetch('/api/stripe/public-key', {
            credentials: 'include'
        });
        
        if (response.ok) {
            const data = await response.json();
            STRIPE_PUBLISHABLE_KEY = data.publicKey;
            console.log('✅ Stripe public key loaded');
        } else {
            console.error('❌ Error loading Stripe key');
            alert('Error al configurar el sistema de pagos. Por favor recarga la página.');
        }
    } catch (error) {
        console.error('❌ Error:', error);
        alert('Error de conexión. Por favor recarga la página.');
    }
}

// ============================================
// LOGO ANIMATION - ATTMOS
// ============================================

function initLogoAnimation() {
    const lettering = function(el, optionalArg) {
        const text = el.innerHTML;
        const arg = optionalArg || "char";
        const size = window.getComputedStyle(el).getPropertyValue("font-size").substring(0, 2);
        
        if (el.classList.contains('fallback')) return;
        
        if (el.parentNode.getAttribute('aria-hidden') === null) {
            const clone = el.cloneNode(true);
            clone.classList.add('fallback');
            el.setAttribute('aria-hidden', 'true');
            clone.classList.add('hide');
            el.parentNode.insertBefore(clone, el.nextSibling);
        }
        
        el.innerHTML = "";
        
        if (arg === "char") {
            for (let i = 0; i < text.length; i++) {
                const span = document.createElement("span");
                span.innerHTML = text[i];
                if (text[i] == " ") {
                    span.style.margin = "0 " + (size / 10) + "px";
                }
                span.classList.add("char" + (i + 1));
                el.appendChild(span);
            }
        }
    };

    const h1 = document.querySelector(".logo-container h1");
    if (h1) {
        lettering(h1);
    }

    const ring = document.querySelector("path#ring");
    const path = "M45,145 c-50,-10 -60,-40 10,-35 c95,8 150,50 51,46";
    const base = document.querySelector('circle#base');
    const second = document.querySelector('path#second');
    const third = document.querySelector('path#third');

    if (base) {
        base.setAttribute('cx', 80);
        base.setAttribute('cy', 135);
        base.setAttribute('r', 35);
    }

    if (ring) ring.setAttribute('d', path);
    if (second) second.setAttribute('d', path);
    if (third) third.setAttribute('d', path);

    const animate = function() {
        if (ring) ring.classList.add('animate');
        if (second) second.classList.add('animate');
        if (third) third.classList.add('animate');
    };

    setTimeout(animate, 100);
}

// ============================================
// CUSTOM COUNTRY DROPDOWN
// ============================================

function initCountryDropdown() {
    const selectWrapper = document.querySelector('.country-select-wrapper');
    const selectInput = document.getElementById('country');
    const dropdown = document.getElementById('countryDropdown');
    const optionsContainer = document.getElementById('countryOptionsContainer');
    const options = optionsContainer.querySelectorAll('.select-option');
    const phoneCodeInput = document.getElementById('phoneCode');
    const countryCodeInput = document.getElementById('countryCode');
    
    if (!selectWrapper || !selectInput || !dropdown) {
        console.warn('⚠️ Country select elements no encontrados');
        return;
    }

    updatePhoneCode('MX', '+52');

    selectInput.addEventListener('click', function(e) {
        e.stopPropagation();
        toggleDropdown();
    });

    options.forEach(option => {
        option.addEventListener('click', function(e) {
            e.stopPropagation();
            selectOption(this);
        });
    });

    document.addEventListener('click', function(e) {
        if (!selectWrapper.contains(e.target)) {
            closeDropdown();
        }
    });

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && selectWrapper.classList.contains('active')) {
            closeDropdown();
        }
    });

    function toggleDropdown() {
        const isActive = selectWrapper.classList.contains('active');
        
        if (isActive) {
            closeDropdown();
        } else {
            openDropdown();
        }
    }

    function openDropdown() {
        selectWrapper.classList.add('active');
        selectInput.classList.add('active');
        
        const visibleOptions = optionsContainer.querySelectorAll('.select-option:not(.hidden)');
        visibleOptions.forEach((option, index) => {
            option.style.animation = 'none';
            setTimeout(() => {
                option.style.animation = '';
            }, 10);
        });

        console.log('🌍 Dropdown de países abierto');
    }

    function closeDropdown() {
        selectWrapper.classList.remove('active');
        selectInput.classList.remove('active');
    }

    function selectOption(option) {
        const value = option.getAttribute('data-value');
        const flag = option.getAttribute('data-flag');
        const code = option.getAttribute('data-code');
        const name = option.getAttribute('data-name');

        selectInput.value = `${flag} ${name}`;
        
        if (countryCodeInput) {
            countryCodeInput.value = value;
        }

        updatePhoneCode(value, code);

        options.forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');

        clearError(selectInput);
        closeDropdown();
        checkFormCompletion();

        console.log(`✅ País seleccionado: ${name} (${value}) - Código: ${code}`);
    }
    
    function updatePhoneCode(countryCode, manualCode = null) {
        if (phoneCodeInput) {
            const code = manualCode || COUNTRY_PHONE_CODES[countryCode] || '+52';
            phoneCodeInput.value = code;
            console.log(`📱 Código telefónico actualizado: ${code}`);
        }
    }

    console.log('✅ Country dropdown inicializado');
}

// ============================================
// PAYMENT METHOD TOGGLE
// ============================================

function initPaymentMethodToggle() {
    const methodOptions = document.querySelectorAll('.payment-method-option');
    const cardDetails = document.getElementById('cardDetails');
    const paypalDetails = document.getElementById('paypalDetails');

    methodOptions.forEach(option => {
        option.addEventListener('click', function() {
            methodOptions.forEach(opt => opt.classList.remove('active'));
            this.classList.add('active');

            const radio = this.querySelector('input[type="radio"]');
            radio.checked = true;

            if (radio.value === 'card') {
                cardDetails.style.display = 'block';
                paypalDetails.style.display = 'none';
            } else {
                cardDetails.style.display = 'none';
                paypalDetails.style.display = 'block';
            }
        });
    });
}

// ============================================
// STRIPE ELEMENTS INITIALIZATION
// ============================================

let stripe;
let cardElement;
let cardData = {
    complete: false,
    empty: true
};

function initStripeElements() {
    if (!STRIPE_PUBLISHABLE_KEY) {
        console.error('❌ Stripe key not loaded yet');
        setTimeout(initStripeElements, 500);
        return;
    }

    stripe = Stripe(STRIPE_PUBLISHABLE_KEY);
    
    const elements = stripe.elements({
        appearance: {
            theme: 'stripe',
            variables: {
                colorPrimary: '#06b6d4',
                colorBackground: '#ffffff',
                colorText: '#1a1a1a',
                colorDanger: '#ef4444',
                fontFamily: 'Inter, sans-serif',
                spacingUnit: '4px',
                borderRadius: '10px'
            }
        }
    });

    cardElement = elements.create('card', {
        style: {
            base: {
                fontSize: '16px',
                color: '#1a1a1a',
                fontFamily: 'Inter, sans-serif',
                '::placeholder': {
                    color: '#9ca3af'
                }
            },
            invalid: {
                color: '#ef4444'
            }
        }
    });

    cardElement.mount('#card-element');

    const stripeContainer = document.getElementById('stripe-container');
    const errorElement = document.getElementById('card-errors');

    cardElement.on('focus', () => {
        stripeContainer.classList.add('focused');
        stripeContainer.classList.remove('error');
    });

    cardElement.on('blur', () => {
        stripeContainer.classList.remove('focused');
    });

    cardElement.on('change', (event) => {
        cardData.complete = event.complete || false;
        cardData.empty = event.empty !== false;

        if (event.error) {
            errorElement.innerHTML = `<i class="lni lni-warning"></i> ${event.error.message}`;
            errorElement.classList.add('active');
            stripeContainer.classList.add('error');
        } else {
            errorElement.textContent = '';
            errorElement.classList.remove('active');
            stripeContainer.classList.remove('error');
        }

        checkFormCompletion();
    });

    console.log('✅ Stripe Elements initialized');
}

// ============================================
// FORM VALIDATION
// ============================================

function initFormValidation() {
    const inputs = document.querySelectorAll('.form-input, .form-select');

    inputs.forEach(input => {
        input.addEventListener('blur', function() {
            if (this.hasAttribute('required')) {
                validateInput(this);
            }
        });

        input.addEventListener('input', function() {
            if (this.classList.contains('error')) {
                validateInput(this);
            }
            checkFormCompletion();
        });
    });
}

function validateInput(input) {
    const value = input.value.trim();
    
    if (input.hasAttribute('required') && !value) {
        showError(input, 'Este campo es obligatorio');
        return false;
    }

    if (input.type === 'email' && value) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(value)) {
            showError(input, 'Email inválido');
            return false;
        }
    }

    clearError(input);
    return true;
}

function showError(input, message) {
    input.classList.add('error');
    
    const errorMsg = input.parentElement.querySelector('.error-message');
    if (errorMsg) {
        errorMsg.innerHTML = `<i class="lni lni-warning"></i> ${message}`;
        errorMsg.classList.add('active');
    }
    
    setTimeout(() => {
        input.classList.remove('error');
    }, 500);
    
    setTimeout(() => {
        if (!input.value.trim() && input.hasAttribute('required')) {
            input.classList.add('error');
        }
    }, 510);
}

function clearError(input) {
    input.classList.remove('error');
    
    const errorMsg = input.parentElement.querySelector('.error-message');
    if (errorMsg) {
        errorMsg.classList.remove('active');
    }
}

function checkFormCompletion() {
    const fullName = document.getElementById('fullName')?.value.trim();
    const email = document.getElementById('email')?.value.trim();
    const countryCode = document.getElementById('countryCode')?.value;
    const postalCode = document.getElementById('postalCode')?.value.trim();
    
    const submitButton = document.getElementById('submitButton');
    
    const isFormComplete = fullName && email && countryCode && postalCode && cardData.complete;
    
    if (submitButton) {
        submitButton.disabled = !isFormComplete;
    }
    
    return isFormComplete;
}

// ============================================
// FORM SUBMISSION CON INTEGRACIÓN REAL
// ============================================

function initPaymentForm() {
    const form = document.getElementById('paymentForm');
    
    if (form) {
        form.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            console.log('📝 Form submitted');
            
            const requiredInputs = form.querySelectorAll('[required]');
            let isValid = true;
            let firstErrorField = null;
            
            requiredInputs.forEach(input => {
                if (input.type !== 'checkbox' && input.type !== 'hidden' && !validateInput(input)) {
                    isValid = false;
                    if (!firstErrorField) {
                        firstErrorField = input;
                    }
                }
            });
            
            if (!isValid) {
                alert('Por favor completa todos los campos requeridos correctamente.');
                if (firstErrorField) {
                    firstErrorField.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    firstErrorField.focus();
                }
                return;
            }
            
            if (!cardData.complete) {
                alert('Por favor completa los datos de tu tarjeta.');
                const stripeContainer = document.getElementById('stripe-container');
                stripeContainer.classList.add('error');
                setTimeout(() => {
                    stripeContainer.classList.remove('error');
                }, 500);
                return;
            }
            
            showProcessingModal();
            
            await processPayment();
        });
    }
}

async function processPayment() {
    try {
        console.log('💳 Processing payment...');
        
        // Obtener datos del formulario
        const fullName = document.getElementById('fullName').value.trim();
        const email = document.getElementById('email').value.trim();
        const phoneCode = document.getElementById('phoneCode')?.value.trim() || '';
        const phone = document.getElementById('phone')?.value.trim() || '';
        const fullPhone = phoneCode && phone ? phoneCode + phone.replace(/\s/g, '') : '';
        const countryCode = document.getElementById('countryCode')?.value || 'MX';
        const postalCode = document.getElementById('postalCode').value.trim();
        
        const urlParams = new URLSearchParams(window.location.search);
        const plan = urlParams.get('plan') || 'neutron';
        const billingPeriod = urlParams.get('billing') || 'monthly';
        
        // Crear checkout session en el backend
        console.log('📤 Creating checkout session...');
        const checkoutResponse = await fetch('/api/stripe/checkout', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({
                fullName,
                email,
                phone: fullPhone,
                countryCode,
                postalCode,
                plan,
                billingPeriod
            })
        });
        
        if (!checkoutResponse.ok) {
            const error = await checkoutResponse.json();
            throw new Error(error.error || 'Error al crear sesión de pago');
        }
        
        const checkoutData = await checkoutResponse.json();
        console.log('✅ Checkout session created:', checkoutData);
        
        // Confirmar pago con Stripe
        console.log('💳 Confirming payment with Stripe...');
        const { error: confirmError, paymentIntent: confirmedPI } = await stripe.confirmCardPayment(
            checkoutData.clientSecret,
            {
                payment_method: {
                    card: cardElement,
                    billing_details: {
                        name: fullName,
                        email: email,
                        phone: fullPhone,
                        address: {
                            country: countryCode,
                            postal_code: postalCode
                        }
                    }
                }
            }
        );
        
        if (confirmError) {
            hideProcessingModal();
            console.error('❌ Payment error:', confirmError);
            alert(`Error: ${confirmError.message}`);
            return;
        }

        // Usar el ID real del paymentIntent confirmado
        const confirmedPaymentIntentId = confirmedPI
            ? confirmedPI.id
            : checkoutData.clientSecret.split('_secret_')[0];

        console.log('✅ Payment confirmed with Stripe');
        
        // Confirmar pago en el backend
        const confirmResponse = await fetch('/api/stripe/confirm', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({
                paymentIntentId: confirmedPaymentIntentId,
                plan,
                billingPeriod,
                invoice: (() => {
                    const cb = document.getElementById('requiresInvoice');
                    if (!cb || !cb.checked) return null;
                    return {
                        requiresInvoice: true,
                        razonSocial:     document.getElementById('razonSocial')?.value.trim()     || '',
                        rfc:             document.getElementById('rfc')?.value.trim().toUpperCase() || '',
                        direccionFiscal: document.getElementById('direccionFiscal')?.value.trim() || '',
                        codigoPostal:    document.getElementById('codigoPostal')?.value.trim()    || '',
                        emailFactura:    document.getElementById('emailFactura')?.value.trim()    || '',
                        usoCfdi:         document.getElementById('usoCfdi')?.value                || '',
                        regimenFiscal:   document.getElementById('regimenFiscal')?.value          || '',
                    };
                })()
            })
        });
        
        if (!confirmResponse.ok) {
            throw new Error('Error al confirmar pago en el servidor');
        }
        
        console.log('✅ Payment confirmed on backend');
        
        hideProcessingModal();
        showSuccessModal();
        
    } catch (error) {
        console.error('❌ Payment error:', error);
        hideProcessingModal();
        alert(`Error procesando el pago: ${error.message}`);
    }
}

// ============================================
// MODALS
// ============================================

function showProcessingModal() {
    const modal = document.getElementById('processingModal');
    if (modal) {
        modal.classList.add('show');
        document.body.style.overflow = 'hidden';
    }
}

function hideProcessingModal() {
    const modal = document.getElementById('processingModal');
    if (modal) {
        modal.classList.remove('show');
        document.body.style.overflow = '';
    }
}

function showSuccessModal() {
    const modal = document.getElementById('successModal');
    if (modal) {
        modal.classList.add('show');
        document.body.style.overflow = 'hidden';
    }
}

// ============================================
// LOAD PLAN DETAILS CON PRECIOS REALES
// ============================================

function loadPlanDetails() {
    const urlParams = new URLSearchParams(window.location.search);
    const planId = urlParams.get('plan') || 'neutron';
    const billingPeriod = urlParams.get('billing') || 'monthly';
    
    currentBillingPeriod = billingPeriod;
    
    // Buscar el plan en los datos cargados
    if (!plansData) {
        console.warn('⚠️ Plans data not loaded yet, using fallback');
        plansData = getFallbackPlansData();
    }
    
    selectedPlanData = plansData.find(p => p.id === planId);
    
    if (!selectedPlanData) {
        console.warn(`⚠️ Plan ${planId} not found, using fallback`);
        selectedPlanData = plansData.find(p => p.id === 'neutron') || plansData[1];
    }
    
    console.log('📋 Selected plan data:', selectedPlanData);
    
    // Actualizar nombre del plan
    const planNameElement = document.getElementById('selectedPlanName');
    if (planNameElement) {
        planNameElement.textContent = selectedPlanData.displayName || selectedPlanData.name;
    }
    
    // Actualizar período de facturación
    const billingPeriodElement = document.getElementById('billingPeriod');
    if (billingPeriodElement) {
        billingPeriodElement.textContent = billingPeriod === 'annual' ? 'Anual' : 'Mensual';
    }
    
    // Obtener precio según el período
    const priceData = billingPeriod === 'annual' 
        ? selectedPlanData.annual 
        : selectedPlanData.monthly;
    
    const subtotal = priceData.amount || 0;
    const currency = priceData.currency || 'MXN';
    
    // IVA incluido en el precio — no se suma
    const total = subtotal;

    // Actualizar elementos de precio
    const subtotalElement = document.getElementById('subtotal');
    const totalElement = document.getElementById('total');

    if (subtotalElement) {
        subtotalElement.textContent = `$${subtotal.toFixed(2)} ${currency}`;
    }
    if (totalElement) {
        totalElement.textContent = `$${total.toFixed(2)} ${currency}`;
    }
    
    // Actualizar features si existen en los datos
    if (selectedPlanData.features) {
        const featuresList = document.getElementById('planFeatures');
        if (featuresList) {
            featuresList.innerHTML = selectedPlanData.features.map(feature => {
                // Remover marcadores de check/cross si existen
                const cleanFeature = feature.replace(/^[✓✗]\s*/, '');
                return `
                    <li>
                        <i class="lni lni-checkmark-circle"></i>
                        <span>${cleanFeature}</span>
                    </li>
                `;
            }).join('');
        }
    }
    
    console.log(`📋 Plan details loaded: ${selectedPlanData.name}`);
    console.log(`💰 Subtotal: $${subtotal.toFixed(2)} ${currency}`);
    // IVA incluido en precio — removido
    console.log(`💳 Total: $${total.toFixed(2)} ${currency}`);
}

// ============================================
// KEYBOARD NAVIGATION
// ============================================

document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        hideProcessingModal();
    }
});

document.querySelectorAll('.form-input, .form-select').forEach(input => {
    input.addEventListener('keypress', function(e) {
        if (e.key === 'Enter' && this.tagName !== 'TEXTAREA') {
            e.preventDefault();
            const formInputs = Array.from(document.querySelectorAll('.form-input, .form-select'));
            const currentIndex = formInputs.indexOf(this);
            if (currentIndex < formInputs.length - 1) {
                formInputs[currentIndex + 1].focus();
            }
        }
    });
});

console.log('✅ Checkout JS initialized');
console.log('🔒 Security: PCI compliant payment processing');
console.log('💳 Stripe integration: READY');
console.log('💰 Dynamic pricing: ENABLED');
// ============================================
// FACTURACIÓN - NUEVOS CAMPOS
// ============================================

function initBillingFields() {
    const checkbox = document.getElementById('requiresInvoice');
    const billingFields = document.getElementById('billingFields');
    if (!checkbox || !billingFields) return;

    checkbox.addEventListener('change', function() {
        if (this.checked) {
            billingFields.classList.add('open');
        } else {
            billingFields.classList.remove('open');
            // Clear values when hidden
            ['razonSocial','rfc','direccionFiscal','codigoPostal','emailFactura'].forEach(id => {
                const el = document.getElementById(id);
                if (el) { el.value = ''; el.classList.remove('error'); }
            });
            ['usoCfdi','regimenFiscal'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = '';
            });
            document.getElementById('usoCfdi-selected').textContent = 'Seleccionar uso';
            document.getElementById('regimenFiscal-selected').textContent = 'Seleccionar régimen';
        }
        checkFormCompletion();
    });

    // RFC uppercase
    const rfcInput = document.getElementById('rfc');
    if (rfcInput) {
        rfcInput.addEventListener('input', function() {
            this.value = this.value.toUpperCase();
        });
    }

    // Código postal solo números
    const cpInput = document.getElementById('codigoPostal');
    if (cpInput) {
        cpInput.addEventListener('input', function() {
            this.value = this.value.replace(/[^0-9]/g, '');
        });
    }

    // Attach blur validation to billing inputs
    const billingInputs = ['razonSocial', 'rfc', 'direccionFiscal', 'codigoPostal', 'emailFactura'];
    billingInputs.forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener('blur', () => { checkFormCompletion(); });
            input.addEventListener('input', () => { checkFormCompletion(); });
        }
    });

    // Init CFDI dropdowns
    initCfdiSelect('usoCfdi-trigger', 'usoCfdi-dropdown', 'usoCfdi-selected', 'usoCfdi');
    initCfdiSelect('regimenFiscal-trigger', 'regimenFiscal-dropdown', 'regimenFiscal-selected', 'regimenFiscal');

    console.log('✅ Billing fields initialized');
}

function initCfdiSelect(triggerId, dropdownId, selectedId, inputId) {
    const trigger = document.getElementById(triggerId);
    const dropdown = document.getElementById(dropdownId);
    const selectedEl = document.getElementById(selectedId);
    const input = document.getElementById(inputId);
    if (!trigger || !dropdown || !selectedEl || !input) return;

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = dropdown.classList.contains('open');
        // Close all other dropdowns
        document.querySelectorAll('.cfdi-select-dropdown.open').forEach(d => {
            d.classList.remove('open');
            d.previousElementSibling?.classList.remove('open');
        });
        if (!isOpen) {
            dropdown.classList.add('open');
            trigger.classList.add('open');
        }
    });

    trigger.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); trigger.click(); }
    });

    dropdown.querySelectorAll('.cfdi-option').forEach(option => {
        option.addEventListener('click', () => {
            const value = option.dataset.value;
            const text = option.textContent.trim();
            selectedEl.textContent = text;
            input.value = value;
            dropdown.querySelectorAll('.cfdi-option').forEach(o => o.classList.remove('selected'));
            if (value) option.classList.add('selected');
            trigger.classList.remove('open');
            dropdown.classList.remove('open');
            checkFormCompletion();
        });
    });

    document.addEventListener('click', (e) => {
        if (!trigger.contains(e.target) && !dropdown.contains(e.target)) {
            trigger.classList.remove('open');
            dropdown.classList.remove('open');
        }
    });
}

// ============================================
// CUPÓN DE DESCUENTO
// ============================================

const couponState = {
    applied: false,
    discountAmount: 0,
    originalAmount: 0,
    finalAmount: 0
};

function initCoupon() {
    const applyBtn = document.getElementById('apply-coupon');
    const removeBtn = document.getElementById('remove-coupon');
    const couponInput = document.getElementById('coupon-code');
    if (!applyBtn || !couponInput) return;

    applyBtn.addEventListener('click', () => applyCoupon());
    couponInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') applyCoupon();
    });
    if (removeBtn) removeBtn.addEventListener('click', removeCoupon);
}

async function applyCoupon() {
    const code = document.getElementById('coupon-code')?.value.trim();
    if (!code) {
        showCouponResult('Ingresa un código de descuento', 'error');
        return;
    }

    const applyBtn = document.getElementById('apply-coupon');
    if (applyBtn) applyBtn.disabled = true;
    showCouponResult('Validando...', 'loading');

    try {
        const urlParams = new URLSearchParams(window.location.search);
        const plan = urlParams.get('plan') || 'neutron';
        const period = urlParams.get('billing') || 'monthly';

        const res = await fetch('/api/billing/validate-coupon', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ coupon_code: code, plan, period })
        });

        const result = await res.json();

        if (result.success) {
            couponState.applied = true;
            couponState.discountAmount = result.discount_amount || 0;
            couponState.finalAmount = result.final_amount || couponState.originalAmount;

            document.getElementById('coupon-input-container').style.display = 'none';
            document.getElementById('discount-breakdown').style.display = 'block';

            const nameEl = document.getElementById('coupon-name');
            if (nameEl) nameEl.textContent = result.coupon_name || 'Cupón aplicado';

            showCouponResult(`¡Cupón aplicado! ${result.discount_text || ''}`, 'success');
            updatePriceDisplay();
        } else {
            showCouponResult(result.error || 'Código inválido', 'error');
        }
    } catch (err) {
        showCouponResult('Error al validar el código. Intenta de nuevo.', 'error');
    } finally {
        if (applyBtn) applyBtn.disabled = false;
    }
}

function removeCoupon() {
    couponState.applied = false;
    couponState.discountAmount = 0;
    couponState.finalAmount = couponState.originalAmount;

    document.getElementById('coupon-input-container').style.display = 'block';
    document.getElementById('discount-breakdown').style.display = 'none';
    document.getElementById('coupon-result').style.display = 'none';

    const codeInput = document.getElementById('coupon-code');
    if (codeInput) codeInput.value = '';

    updatePriceDisplay();
}

function showCouponResult(message, type) {
    const el = document.getElementById('coupon-result');
    if (!el) return;
    const icons = { success: 'lni-checkmark-circle', error: 'lni-warning', loading: 'lni-spinner' };
    el.className = `coupon-result ${type}`;
    el.innerHTML = `<i class="lni ${icons[type] || 'lni-information'}"></i> ${message}`;
    el.style.display = 'flex';
    if (type === 'success') {
        setTimeout(() => { el.style.display = 'none'; }, 3000);
    }
}

function updatePriceDisplay() {
    const subtotalEl = document.getElementById('subtotal');
    const discountLine = document.getElementById('discount-line');
    const discountSummaryEl = document.getElementById('discount-summary');
    const totalEl = document.getElementById('total');

    if (!subtotalEl || !totalEl) return;

    // Parse current subtotal
    const subtotalText = subtotalEl.textContent.replace(/[^0-9.]/g, '');
    const subtotal = parseFloat(subtotalText) || couponState.originalAmount;
    const currency = subtotalEl.textContent.includes('MXN') ? 'MXN' : '';

    const taxRate = 0.16;

    if (couponState.applied && couponState.discountAmount > 0) {
        const discounted = subtotal - (couponState.discountAmount / 100);
        const tax = discounted * taxRate;
        const total = discounted + tax;

        if (discountLine) discountLine.style.display = 'flex';
        if (discountSummaryEl) discountSummaryEl.textContent = `-$${(couponState.discountAmount / 100).toFixed(2)} ${currency}`;
        totalEl.textContent = `$${total.toFixed(2)} ${currency}`;
    } else {
        const tax = subtotal * taxRate;
        const total = subtotal + tax;
        if (discountLine) discountLine.style.display = 'none';
        totalEl.textContent = `$${total.toFixed(2)} ${currency}`;
    }
}

// ============================================
// PATCH checkFormCompletion para incluir campos nuevos
// ============================================
const _originalCheckFormCompletion = checkFormCompletion;
checkFormCompletion = function() {
    const result = _originalCheckFormCompletion();

    // Validar campos de facturación si están activos
    const checkbox = document.getElementById('requiresInvoice');
    if (checkbox && checkbox.checked) {
        const required = ['razonSocial', 'rfc', 'direccionFiscal', 'codigoPostal', 'emailFactura', 'usoCfdi', 'regimenFiscal'];
        const allFilled = required.every(id => {
            const el = document.getElementById(id);
            return el && el.value.trim().length > 0;
        });
        if (!allFilled) {
            const submitButton = document.getElementById('submitButton');
            if (submitButton) submitButton.disabled = true;
            return false;
        }
    }
    return result;
};

// Inicializar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', function() {
    initBillingFields();
    initCoupon();
});