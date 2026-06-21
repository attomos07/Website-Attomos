// ============================================
// PAYMENT METHOD - ATTOMOS
// ============================================

let paymentMethods = [];
let activeMethodId = null;
let stripeInstance  = null;

document.addEventListener('DOMContentLoaded', async function () {
    populateYears();
    loadPaymentMethods();
    initCardLivePreview();
    await initStripe();
});

// ============================================
// INIT STRIPE
// ============================================
async function initStripe() {
    try {
        const res = await fetch('/api/stripe/public-key', { credentials: 'include' });
        const data = await res.json();
        if (data.publicKey) {
            stripeInstance = Stripe(data.publicKey);
        }
    } catch (e) {
        console.error('Error inicializando Stripe:', e);
    }
}

// ============================================
// POPULATE YEAR SELECT
// ============================================
function populateYears() {
    const yearSelect = document.getElementById('fieldExpYear');
    const currentYear = new Date().getFullYear();
    for (let y = currentYear; y <= currentYear + 12; y++) {
        const opt = document.createElement('option');
        opt.value = String(y);
        opt.textContent = String(y);
        yearSelect.appendChild(opt);
    }
}

// ============================================
// LOAD PAYMENT METHODS
// ============================================
async function loadPaymentMethods() {
    try {
        const res = await fetch('/api/billing/payment-methods', { credentials: 'include' });
        if (!res.ok) throw new Error('Error cargando métodos');
        const data = await res.json();
        paymentMethods = data.methods || [];
        activeMethodId = data.defaultMethodId || null;
    } catch (e) {
        console.error('Error:', e);
        paymentMethods = [];
    }

    document.getElementById('pmLoading').style.display = 'none';
    document.getElementById('pmGrid').style.display = 'grid';

    renderMethods();
    renderActiveCard();
}

// ============================================
// RENDER METHODS LIST
// ============================================
function renderMethods() {
    const list = document.getElementById('methodsList');
    const section = document.getElementById('savedMethodsSection');

    if (!paymentMethods.length) {
        list.innerHTML = '<p class="methods-empty">No hay tarjetas guardadas. Agrega una usando el formulario.</p>';
        showNoCard();
        return;
    }

    list.innerHTML = paymentMethods.map(m => `
        <div class="method-item ${m.id === activeMethodId ? 'is-default' : ''}"
             onclick="selectCard('${m.id}')">
            <div class="method-brand-icon">
                ${getBrandIconHTML(m.brand)}
            </div>
            <div class="method-info">
                <div class="method-number">•••• •••• •••• ${m.last4}</div>
                <div class="method-meta">${capitalizeFirst(m.brand)} · Expira ${m.expMonth}/${String(m.expYear).slice(-2)}</div>
            </div>
            ${m.id === activeMethodId ? '<span class="method-default-badge"><i class="lni lni-checkmark-circle"></i> Principal</span>' : ''}
            <div class="method-actions" onclick="event.stopPropagation()">
                ${m.id !== activeMethodId ? `
                <button class="method-action-btn" title="Usar como principal" onclick="setDefaultMethod('${m.id}')">
                    <i class="lni lni-checkmark-circle"></i>
                </button>` : ''}
                <button class="method-action-btn" title="Editar" onclick="editMethod('${m.id}')">
                    <i class="lni lni-pencil"></i>
                </button>
                <button class="method-action-btn danger" title="Eliminar" onclick="confirmDeleteMethod('${m.id}')">
                    <i class="lni lni-trash-can"></i>
                </button>
            </div>
        </div>
    `).join('');

    // Add card button
    list.innerHTML += `
        <button class="btn-add-card" onclick="resetForm()">
            <i class="lni lni-plus-circle"></i>
            <span>Agregar otra tarjeta</span>
        </button>
    `;
}

// ============================================
// RENDER ACTIVE CARD (3D visual)
// ============================================
function renderActiveCard() {
    const m = paymentMethods.find(m => m.id === activeMethodId) || paymentMethods[0];

    if (!m) {
        showNoCard();
        return;
    }

    document.getElementById('cardWrapper').style.display = 'block';
    document.getElementById('noCardState').style.display = 'none';

    document.getElementById('cardDisplayNumber').textContent = `•••• •••• •••• ${m.last4}`;
    document.getElementById('cardDisplayHolder').textContent = (m.holderName || 'TITULAR').toUpperCase();
    document.getElementById('cardDisplayExpiry').textContent = `${m.expMonth}/${String(m.expYear).slice(-2)}`;
    document.getElementById('cardDisplayCvc').textContent = '•••';

    updateCardBrand(m.brand, 'cardBrandLogo');
    updateCardGradient(m.brand);
}

function showNoCard() {
    document.getElementById('cardWrapper').style.display = 'none';
    document.getElementById('noCardState').style.display = 'block';
}

// ============================================
// CARD BRAND HELPERS
// ============================================
function detectBrand(number) {
    const n = number.replace(/\s/g, '');
    if (/^4/.test(n)) return 'visa';
    if (/^5[1-5]/.test(n) || /^2[2-7]/.test(n)) return 'mastercard';
    if (/^3[47]/.test(n)) return 'amex';
    if (/^6/.test(n)) return 'discover';
    return 'generic';
}

function getBrandIconHTML(brand) {
    if (brand === 'visa') return `<svg viewBox="0 0 780 500"><path fill="#1A1F71" d="M293.2,348.7l33.4-195.7h53.4l-33.4,195.7H293.2z"/><path fill="#1A1F71" d="M539.8,157.3c-10.6-3.9-27.2-8.2-47.9-8.2c-52.8,0-90,26.5-90.3,64.4c-0.3,28,26.5,43.6,46.7,52.9c20.7,9.5,27.7,15.6,27.6,24.1c-0.1,13-16.6,19-31.9,19c-21.3,0-32.6-3-50.2-10.3l-6.9-3.1l-7.5,43.5c12.5,5.4,35.5,10.2,59.4,10.4c56.1,0,92.4-26.2,92.8-66.8c0.2-22.2-14-39.1-44.6-53.1c-18.6-9-30-15-29.9-24.2c0-8.1,9.6-16.8,30.5-16.8c17.4-0.3,30,3.5,39.8,7.4l4.8,2.2L539.8,157.3z"/><path fill="#1A1F71" d="M661.3,152.9h-41.3c-12.8,0-22.3,3.5-27.9,16.2L513.6,348.7h56l11.2-29.3h68.4l6.5,29.3H704L661.3,152.9z M595.2,279.4c4.4-11.3,21.3-54.8,21.3-54.8c-0.3,0.5,4.4-11.4,7.1-18.7l3.6,16.9c0,0,10.2,46.4,12.3,56.7H595.2z"/><path fill="#1A1F71" d="M240.4,152.9l-52.3,133.5l-5.6-27.2c-9.7-31.2-40-65-73.8-81.9l47.9,171.4h56.4l83.8-195.7H240.4z"/><path fill="#F2AE14" d="M140.4,152.9H56.7l-0.7,3.9c65.1,15.7,108.2,53.6,126.1,99.1l-18.2-87.1C161.1,156.6,151.9,153.3,140.4,152.9z"/></svg>`;
    if (brand === 'mastercard') return `<svg viewBox="0 0 131.39 86.9"><circle cx="43.45" cy="43.45" r="43.45" fill="#EB001B"/><circle cx="87.94" cy="43.45" r="43.45" fill="#F79E1B"/></svg>`;
    if (brand === 'amex') return `<svg viewBox="0 0 60 40" fill="none"><rect width="60" height="40" rx="4" fill="#007BC1"/><text x="30" y="27" text-anchor="middle" fill="white" font-size="13" font-weight="bold" font-family="Arial">AMEX</text></svg>`;
    return `<i class="lni lni-credit-cards"></i>`;
}

function updateCardBrand(brand, containerId = 'cardBrandLogo') {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.querySelector('.brand-visa')?.style && (container.querySelector('.brand-visa').style.display = brand === 'visa' ? 'block' : 'none');
    container.querySelector('.brand-mastercard')?.style && (container.querySelector('.brand-mastercard').style.display = brand === 'mastercard' ? 'block' : 'none');
    container.querySelector('.brand-amex')?.style && (container.querySelector('.brand-amex').style.display = brand === 'amex' ? 'block' : 'none');
    const generic = container.querySelector('.brand-generic');
    if (generic) generic.style.display = (!brand || brand === 'generic' || brand === 'discover') ? 'flex' : 'none';
}

function updateCardGradient(brand) {
    const front = document.querySelector('.card-front');
    if (!front) return;
    const gradients = {
        visa:       'linear-gradient(135deg, #0f172a 0%, #1e3a5f 40%, #0284c7 100%)',
        mastercard: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 40%, #c41e3a 100%)',
        amex:       'linear-gradient(135deg, #0f2027 0%, #203a43 40%, #2c5364 100%)',
        generic:    'linear-gradient(135deg, #1a1a2e 0%, #16213e 60%, #4b0082 100%)',
    };
    front.style.background = gradients[brand] || gradients.generic;
}

function capitalizeFirst(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

// ============================================
// LIVE PREVIEW (form → card visual)
// ============================================
function initCardLivePreview() {
    const numInput    = document.getElementById('fieldCardNumber');
    const holderInput = document.getElementById('fieldCardHolder');
    const monthSel    = document.getElementById('fieldExpMonth');
    const yearSel     = document.getElementById('fieldExpYear');
    const cvcInput    = document.getElementById('fieldCvc');
    const creditCard  = document.getElementById('creditCard');

    // Format card number with spaces
    numInput.addEventListener('input', function () {
        let val = this.value.replace(/\D/g, '').slice(0, 16);
        this.value = val.match(/.{1,4}/g)?.join(' ') || val;

        const brand = detectBrand(val);
        updateCardBrand(brand, 'cardBrandLogo');
        updateCardGradient(brand);

        // Show last4 on card
        const last4 = val.slice(-4).padStart(4, '•');
        const masked = val.length > 0
            ? `•••• •••• •••• ${last4}`
            : '•••• •••• •••• ••••';
        document.getElementById('cardDisplayNumber').textContent =
            val.length >= 4 ? masked : '•••• •••• •••• ••••';

        // Brand badge
        const badge = document.getElementById('fieldBrandBadge');
        if (brand !== 'generic' && val.length >= 4) {
            badge.style.display = 'flex';
            document.getElementById('fieldBrandText').textContent = capitalizeFirst(brand);
        } else {
            badge.style.display = 'none';
        }
    });

    holderInput.addEventListener('input', function () {
        document.getElementById('cardDisplayHolder').textContent =
            this.value.toUpperCase() || 'NOMBRE TITULAR';
    });

    monthSel.addEventListener('change', updateExpiryDisplay);
    yearSel.addEventListener('change',  updateExpiryDisplay);

    // CVC — flip card
    cvcInput.addEventListener('focus', () => {
        creditCard.classList.add('flipped');
        document.getElementById('cardDisplayCvc').textContent = cvcInput.value || '•••';
    });
    cvcInput.addEventListener('blur', () => {
        creditCard.classList.remove('flipped');
    });
    cvcInput.addEventListener('input', function () {
        this.value = this.value.replace(/\D/g, '').slice(0, 4);
        document.getElementById('cardDisplayCvc').textContent = this.value || '•••';
    });

    // Click card to flip
    document.getElementById('creditCard').addEventListener('click', function (e) {
        if (!e.target.closest('button')) {
            this.classList.toggle('flipped');
        }
    });
}

function updateExpiryDisplay() {
    const m = document.getElementById('fieldExpMonth').value;
    const y = document.getElementById('fieldExpYear').value;
    document.getElementById('cardDisplayExpiry').textContent =
        m && y ? `${m}/${String(y).slice(-2)}` : 'MM/AA';
}

// ============================================
// SELECT CARD (highlight in list)
// ============================================
function selectCard(id) {
    document.querySelectorAll('.method-item').forEach(el => el.classList.remove('selected'));
    const el = document.querySelector(`.method-item[onclick*="${id}"]`);
    if (el) el.classList.add('selected');

    // Update card visual
    const m = paymentMethods.find(p => p.id === id);
    if (m) {
        document.getElementById('cardDisplayNumber').textContent = `•••• •••• •••• ${m.last4}`;
        document.getElementById('cardDisplayHolder').textContent = (m.holderName || '').toUpperCase();
        document.getElementById('cardDisplayExpiry').textContent = `${m.expMonth}/${String(m.expYear).slice(-2)}`;
        updateCardBrand(m.brand, 'cardBrandLogo');
        updateCardGradient(m.brand);
        document.getElementById('cardWrapper').style.display = 'block';
        document.getElementById('noCardState').style.display = 'none';
    }
}

// ============================================
// CVC TOGGLE
// ============================================
function toggleCvcVisibility() {
    const input = document.getElementById('fieldCvc');
    const icon  = document.getElementById('cvcEyeIcon');
    if (input.type === 'password') {
        input.type = 'text';
        icon.className = 'lni lni-eye-slash';
    } else {
        input.type = 'password';
        icon.className = 'lni lni-eye';
    }
}

function toggleCvcHint() {
    const hint = document.getElementById('cvcHint');
    hint.style.display = hint.style.display === 'none' ? 'flex' : 'none';
}

// ============================================
// FORM: SAVE CARD
// ============================================
async function saveCard() {
    const number    = document.getElementById('fieldCardNumber').value.replace(/\s/g, '');
    const holder    = document.getElementById('fieldCardHolder').value.trim();
    const expMonth  = document.getElementById('fieldExpMonth').value;
    const expYear   = document.getElementById('fieldExpYear').value;
    const cvc       = document.getElementById('fieldCvc').value.trim();
    const setDefault= document.getElementById('fieldSetDefault').checked;
    const editingId = document.getElementById('editingMethodId').value;

    // Validation
    let hasError = false;
    const clearError = (id) => document.getElementById(id).classList.remove('error');
    const setError = (id) => { document.getElementById(id).classList.add('error'); hasError = true; };

    clearError('fieldCardNumber'); clearError('fieldCardHolder');
    clearError('fieldExpMonth');   clearError('fieldExpYear');
    clearError('fieldCvc');

    if (!editingId) {
        if (!number || number.length < 13) { setError('fieldCardNumber'); }
        if (!cvc || cvc.length < 3)        { setError('fieldCvc'); }
    }
    if (!holder)                           { setError('fieldCardHolder'); }
    if (!expMonth)                         { setError('fieldExpMonth'); }
    if (!expYear)                          { setError('fieldExpYear'); }

    if (hasError) {
        showNotification('Por favor completa todos los campos correctamente', 'error');
        return;
    }

    const btn     = document.getElementById('btnSaveCard');
    const btnText = document.getElementById('btnSaveText');
    btn.disabled  = true;
    btnText.textContent = 'Guardando...';
    btn.querySelector('i').className = 'lni lni-reload';

    try {
        let url, method, payload;

        if (!editingId) {
            // ── NUEVA TARJETA: tokenizar con Stripe primero ──
            if (!stripeInstance) {
                throw new Error('Stripe no está inicializado. Recarga la página.');
            }

            const { paymentMethod, error: stripeError } = await stripeInstance.createPaymentMethod({
                type: 'card',
                card: {
                    number,
                    exp_month: parseInt(expMonth),
                    exp_year:  parseInt(expYear),
                    cvc,
                },
                billing_details: { name: holder },
            });

            if (stripeError) {
                throw new Error(stripeError.message);
            }

            payload = {
                paymentMethodId: paymentMethod.id,
                setDefault,
            };
            url    = '/api/billing/payment-methods';
            method = 'POST';

        } else {
            // ── EDITAR TARJETA EXISTENTE: solo actualizar datos no sensibles ──
            payload = {
                holderName: holder,
                expMonth,
                expYear,
                setDefault,
            };
            url    = `/api/billing/payment-methods/${editingId}`;
            method = 'PUT';
        }

        const res  = await fetch(url, {
            method,
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || 'Error guardando tarjeta');

        showNotification(
            editingId ? 'Tarjeta actualizada correctamente' : 'Tarjeta guardada correctamente',
            'success'
        );
        resetForm();
        await loadPaymentMethods();

    } catch (e) {
        showNotification(e.message, 'error');
    } finally {
        btn.disabled = false;
        btnText.textContent = document.getElementById('editingMethodId').value ? 'Actualizar Tarjeta' : 'Guardar Tarjeta';
        btn.querySelector('i').className = 'lni lni-lock';
    }
}

// ============================================
// FORM: EDIT METHOD
// ============================================
function editMethod(id) {
    const m = paymentMethods.find(p => p.id === id);
    if (!m) return;

    document.getElementById('editingMethodId').value = id;
    document.getElementById('formTitle').textContent    = 'Editar Tarjeta';
    document.getElementById('formSubtitle').textContent = `•••• •••• •••• ${m.last4}`;
    document.getElementById('btnSaveText').textContent  = 'Actualizar Tarjeta';
    document.getElementById('btnCancelForm').style.display = 'flex';

    // Hide number & cvc fields (can't re-enter full number for security)
    document.getElementById('fieldCardNumber').closest('.field-group').style.display = 'none';
    document.getElementById('fieldCvc').closest('.field-group').style.display       = 'none';

    document.getElementById('fieldCardHolder').value = m.holderName || '';
    document.getElementById('fieldExpMonth').value   = m.expMonth || '';
    document.getElementById('fieldExpYear').value    = m.expYear  || '';
    document.getElementById('fieldSetDefault').checked = m.id === activeMethodId;

    // Scroll to form
    document.getElementById('formCard').scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Update card visual to this card
    selectCard(id);
}

// ============================================
// FORM: RESET
// ============================================
function resetForm() {
    document.getElementById('editingMethodId').value   = '';
    document.getElementById('formTitle').textContent   = 'Agregar Tarjeta';
    document.getElementById('formSubtitle').textContent= 'Tus datos están cifrados y seguros';
    document.getElementById('btnSaveText').textContent = 'Guardar Tarjeta';
    document.getElementById('btnCancelForm').style.display = 'none';

    document.getElementById('fieldCardNumber').closest('.field-group').style.display = '';
    document.getElementById('fieldCvc').closest('.field-group').style.display        = '';

    document.getElementById('fieldCardNumber').value = '';
    document.getElementById('fieldCardHolder').value = '';
    document.getElementById('fieldExpMonth').value   = '';
    document.getElementById('fieldExpYear').value    = '';
    document.getElementById('fieldCvc').value        = '';
    document.getElementById('fieldSetDefault').checked = true;
    document.getElementById('fieldBrandBadge').style.display = 'none';

    // Reset card preview
    document.getElementById('cardDisplayNumber').textContent = '•••• •••• •••• ••••';
    document.getElementById('cardDisplayHolder').textContent = 'NOMBRE TITULAR';
    document.getElementById('cardDisplayExpiry').textContent = 'MM/AA';
    updateCardBrand('generic', 'cardBrandLogo');
    document.querySelector('.card-front').style.background =
        'linear-gradient(135deg, #0f172a 0%, #1e3a5f 40%, #0284c7 100%)';

    // Remove error classes
    ['fieldCardNumber','fieldCardHolder','fieldExpMonth','fieldExpYear','fieldCvc'].forEach(
        id => document.getElementById(id).classList.remove('error')
    );

    document.getElementById('formCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function cancelForm() { resetForm(); }

// ============================================
// SET DEFAULT METHOD
// ============================================
async function setDefaultMethod(id) {
    try {
        const res = await fetch(`/api/billing/payment-methods/${id}/default`, {
            method: 'POST', credentials: 'include'
        });
        if (!res.ok) throw new Error('Error');
        showNotification('Tarjeta principal actualizada', 'success');
        await loadPaymentMethods();
    } catch (e) {
        showNotification('Error al actualizar tarjeta principal', 'error');
    }
}

// ============================================
// DELETE METHOD
// ============================================
function confirmDeleteMethod(id) {
    const m = paymentMethods.find(p => p.id === id);
    if (!m) return;

    showConfirmModal({
        type: 'danger',
        icon: 'lni-trash-can',
        title: '¿Eliminar Tarjeta?',
        message: `Eliminarás la tarjeta que termina en <strong>${m.last4}</strong>.`,
        list: [
            'Esta acción no se puede deshacer',
            m.id === activeMethodId ? 'Es tu tarjeta principal de cobro' : '',
        ].filter(Boolean),
        confirmText: 'Eliminar Tarjeta',
        confirmClass: 'danger',
        onConfirm: () => deleteMethod(id),
    });
}

async function deleteMethod(id) {
    const res = await fetch(`/api/billing/payment-methods/${id}`, {
        method: 'DELETE', credentials: 'include'
    });
    if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Error al eliminar');
    }
    showNotification('Tarjeta eliminada correctamente', 'success');
    await loadPaymentMethods();
}

// ============================================
// CONFIRM MODAL (same as my-agents)
// ============================================
function showConfirmModal(options) {
    const {
        type = 'warning', icon = 'lni-warning',
        title = '¿Estás seguro?', message = '',
        list = [], confirmText = 'Confirmar', confirmClass = 'danger',
        onConfirm = () => {}
    } = options;

    let modal = document.getElementById('confirmModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'confirmModal';
        modal.className = 'confirm-modal';
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <div class="confirm-overlay" onclick="closeConfirmModal()"></div>
        <div class="confirm-content">
            <div class="confirm-header">
                <div class="confirm-icon ${type}"><i class="lni ${icon}"></i></div>
                <h3 class="confirm-title">${title}</h3>
                <p class="confirm-message">${message}</p>
            </div>
            <div class="confirm-body">
                ${list.length ? `<div class="confirm-list">${list.map(i => `<div class="confirm-list-item"><i class="lni lni-close"></i><span>${i}</span></div>`).join('')}</div>` : ''}
                <div class="confirm-actions">
                    <button class="btn-confirm-cancel" onclick="closeConfirmModal()">
                        <i class="lni lni-close"></i><span>Cancelar</span>
                    </button>
                    <button class="btn-confirm-action ${confirmClass}" id="confirmActionBtn">
                        <i class="lni lni-checkmark"></i><span>${confirmText}</span>
                    </button>
                </div>
            </div>
        </div>`;

    modal.classList.add('active');

    document.getElementById('confirmActionBtn').addEventListener('click', async function () {
        this.innerHTML = `<div class="loading-spinner-small"></div><span>Procesando...</span>`;
        this.disabled = true;
        try {
            await onConfirm();
            closeConfirmModal();
        } catch (err) {
            showNotification(err.message || 'Error', 'error');
            this.disabled = false;
            this.innerHTML = `<i class="lni lni-checkmark"></i><span>${confirmText}</span>`;
        }
    });
}

function closeConfirmModal() {
    const m = document.getElementById('confirmModal');
    if (m) { m.classList.remove('active'); setTimeout(() => m.innerHTML = '', 300); }
}

// ============================================
// NOTIFICATIONS
// ============================================
function showNotification(message, type = 'info') {
    const n = document.createElement('div');
    n.className = `notification notification-${type}`;
    const icon = type === 'success' ? 'checkmark-circle' : type === 'error' ? 'warning' : 'information';
    n.innerHTML = `<i class="lni lni-${icon}"></i><span>${message}</span>`;
    document.body.appendChild(n);
    setTimeout(() => n.classList.add('active'), 10);
    setTimeout(() => { n.classList.remove('active'); setTimeout(() => n.remove(), 300); }, 3500);
}