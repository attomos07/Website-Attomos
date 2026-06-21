// ============================================
// SELECT PLAN JS - MANEJO DE SELECCIÓN DE PLANES
// ============================================

let currentBillingCycle = 'monthly';
let plansData = null;

// ============================================
// INICIALIZACIÓN
// ============================================

document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 Select Plan JS cargado correctamente');
    
    initBillingToggle();
    initBillingOptions();
    loadPlansData();
    
    console.log('✅ Select Plan funcionalidades inicializadas');
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
        
        // Renderizar los planes en la página
        renderPlans();
        
    } catch (error) {
        console.error('❌ Error cargando planes:', error);
        // Mantener los planes estáticos del HTML si falla la carga
    }
}

// ============================================
// RENDERIZAR PLANES DINÁMICAMENTE
// ============================================

function renderPlans() {
    if (!plansData) return;
    
    const plansGrid = document.querySelector('.plans-grid');
    if (!plansGrid) return;
    
    plansGrid.innerHTML = '';
    
    plansData.forEach(plan => {
        const planCard = createPlanCard(plan);
        plansGrid.appendChild(planCard);
    });
    
    // Actualizar precios según el ciclo actual
    updatePrices();
}

// ============================================
// CREAR TARJETA DE PLAN
// ============================================

function createPlanCard(plan) {
    const card = document.createElement('div');
    card.className = 'plan-card';
    
    // Agregar clases especiales
    if (plan.isFree) {
        card.classList.add('free-trial');
    }
    if (plan.popular) {
        card.classList.add('featured');
    }
    
    // Badge
    let badgeHTML = '';
    if (plan.badge) {
        badgeHTML = `<div class="plan-badge ${plan.badgeClass || ''}">${plan.badge}</div>`;
    }
    
    // Header
    const monthlyPrice = plan.monthly.amount || 0;
    const annualPrice = plan.annual.amount || 0;
    
    const headerHTML = `
        <div class="plan-header">
            <h2>${plan.displayName || plan.name}</h2>
            <div class="plan-price">
                <span class="price" data-monthly="${monthlyPrice}" data-annual="${annualPrice}">$${monthlyPrice}</span>
                <span class="period">/ mes</span>
            </div>
            <p class="plan-subtitle">${plan.subtitle || plan.description}</p>
        </div>
    `;
    
    // Features
    const featuresHTML = plan.features.map(feature => {
        const isDisabled = feature.startsWith('✗') || feature.startsWith('Sin ');
        const icon = isDisabled ? '✗' : '✓';
        const iconClass = isDisabled ? 'disabled' : '';
        const featureText = feature.replace(/^[✓✗]\s*/, '');
        
        return `<li><span class="icon ${iconClass}">${icon}</span> ${featureText}</li>`;
    }).join('');
    
    // Button
    const buttonText = plan.isFree ? 'Comenzar Gratis' : `Seleccionar ${plan.displayName || plan.name}`;
    const buttonAction = plan.isFree 
        ? `selectPlan('${plan.id}', 'monthly')` 
        : `selectPlan('${plan.id}', getCurrentBillingCycle())`;
    
    const buttonHTML = `
        <button class="plan-button primary" onclick="${buttonAction}">
            ${buttonText}
        </button>
    `;
    
    // Ensamblar la tarjeta
    card.innerHTML = `
        ${badgeHTML}
        ${headerHTML}
        <ul class="plan-features">
            ${featuresHTML}
        </ul>
        ${buttonHTML}
    `;
    
    return card;
}

// ============================================
// TOGGLE DE FACTURACIÓN
// ============================================

function initBillingToggle() {
    const billingToggle = document.getElementById('billingToggle');
    
    if (billingToggle) {
        billingToggle.addEventListener('change', function() {
            currentBillingCycle = this.checked ? 'annual' : 'monthly';
            updatePrices();
            updateBillingOptionsState();
        });
    }
}

// ============================================
// OPCIONES DE FACTURACIÓN CLICKEABLES
// ============================================

function initBillingOptions() {
    const billingOptions = document.querySelectorAll('.billing-option');
    
    billingOptions.forEach(option => {
        option.addEventListener('click', function() {
            const cycle = this.getAttribute('data-cycle');
            
            if (cycle === 'annual' && currentBillingCycle === 'monthly') {
                document.getElementById('billingToggle').checked = true;
                currentBillingCycle = 'annual';
                updatePrices();
                updateBillingOptionsState();
            } else if (cycle === 'monthly' && currentBillingCycle === 'annual') {
                document.getElementById('billingToggle').checked = false;
                currentBillingCycle = 'monthly';
                updatePrices();
                updateBillingOptionsState();
            }
        });
    });
}

// ============================================
// ACTUALIZAR ESTADO VISUAL DE OPCIONES
// ============================================

function updateBillingOptionsState() {
    const billingOptions = document.querySelectorAll('.billing-option');
    
    billingOptions.forEach(option => {
        const cycle = option.getAttribute('data-cycle');
        
        if (cycle === currentBillingCycle) {
            option.classList.add('active');
        } else {
            option.classList.remove('active');
        }
    });
}

// ============================================
// OBTENER CICLO DE FACTURACIÓN ACTUAL
// ============================================

function getCurrentBillingCycle() {
    return currentBillingCycle;
}

// ============================================
// ACTUALIZAR PRECIOS SEGÚN EL CICLO
// ============================================

function updatePrices() {
    const priceElements = document.querySelectorAll('.plan-price .price[data-monthly]');
    const periodElements = document.querySelectorAll('.plan-price .period');
    
    priceElements.forEach(element => {
        const monthlyPrice = element.getAttribute('data-monthly');
        const annualPrice = element.getAttribute('data-annual');
        
        if (currentBillingCycle === 'annual') {
            element.textContent = '$' + annualPrice;
        } else {
            element.textContent = '$' + monthlyPrice;
        }
    });
    
    // Actualizar texto del período
    periodElements.forEach(element => {
        if (currentBillingCycle === 'annual') {
            element.textContent = '/ año';
        } else {
            element.textContent = '/ mes';
        }
    });
}

// ============================================
// SELECCIÓN DE PLAN
// ============================================

async function selectPlan(plan, billingCycle) {
    console.log(`Seleccionando plan: ${plan} (${billingCycle})`);
    
    // Mostrar modal de carga
    const planName = plan.charAt(0).toUpperCase() + plan.slice(1);
    showLoading(`Activando plan ${planName}...`);
    
    try {
        const response = await fetch('/api/select-plan', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({
                plan: plan,
                billingCycle: billingCycle
            })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Error al seleccionar el plan');
        }
        
        console.log('✅ Plan seleccionado exitosamente:', data);
        
        // Si es plan gratuito, mostrar mensaje de éxito
        if (data.trial) {
            updateLoadingMessage('¡Plan gratuito activado! Redirigiendo al dashboard...');
        } else {
            updateLoadingMessage('Redirigiendo a checkout seguro...');
        }
        
        // Redirigir después de 1.5 segundos
        setTimeout(() => {
            window.location.href = data.redirectTo;
        }, 1500);
        
    } catch (error) {
        console.error('❌ Error:', error);
        hideLoading();
        showErrorModal(error.message);
    }
}

// ============================================
// MODAL DE CARGA
// ============================================

function showLoading(message) {
    const modal = document.getElementById('loadingModal');
    const messageElement = document.getElementById('loadingMessage');
    
    if (modal && messageElement) {
        messageElement.textContent = message;
        modal.style.display = 'flex';
    }
}

function updateLoadingMessage(message) {
    const messageElement = document.getElementById('loadingMessage');
    if (messageElement) {
        messageElement.textContent = message;
    }
}

function hideLoading() {
    const modal = document.getElementById('loadingModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// ============================================
// MODAL DE ERROR
// ============================================

function showErrorModal(message) {
    // Crear modal de error si no existe
    let errorModal = document.getElementById('errorModal');
    
    if (!errorModal) {
        errorModal = document.createElement('div');
        errorModal.id = 'errorModal';
        errorModal.className = 'modal';
        errorModal.innerHTML = `
            <div class="modal-content">
                <div style="font-size: 3rem; margin-bottom: 1rem;">⚠️</div>
                <p id="errorMessage" style="font-size: 1.125rem; color: #ef4444; font-weight: 600; margin-bottom: 1.5rem;"></p>
                <button onclick="hideErrorModal()" style="
                    padding: 0.75rem 2rem;
                    background: linear-gradient(135deg, #06b6d4 0%, #0891b2 100%);
                    color: white;
                    border: none;
                    border-radius: 10px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.3s ease;
                ">Entendido</button>
            </div>
        `;
        document.body.appendChild(errorModal);
    }
    
    const errorMessage = document.getElementById('errorMessage');
    if (errorMessage) {
        errorMessage.textContent = message;
    }
    
    errorModal.style.display = 'flex';
}

function hideErrorModal() {
    const errorModal = document.getElementById('errorModal');
    if (errorModal) {
        errorModal.style.display = 'none';
    }
}

// ============================================
// ANALYTICS Y TRACKING
// ============================================

function trackPlanSelection(plan, billingCycle) {
    console.log(`📊 Plan Selected: ${plan} (${billingCycle})`);
    
    if (typeof gtag !== 'undefined') {
        gtag('event', 'select_plan', {
            event_category: 'onboarding',
            plan_name: plan,
            billing_cycle: billingCycle,
            page_title: 'Select Plan'
        });
    }
}

// ============================================
// MANEJO DE ERRORES
// ============================================

window.addEventListener('error', function(e) {
    console.error('Error en select-plan.js:', e.error);
    hideLoading();
    showErrorModal('Ocurrió un error inesperado. Por favor recarga la página.');
});