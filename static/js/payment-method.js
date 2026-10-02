// ============================================
// PAYMENT METHOD - ATTOMOS
// ============================================

function getLang() { return localStorage.getItem('attomos_lang') || localStorage.getItem('lang') || 'es'; }
function t(key, fallback) { return window.Translations?.dict?.[getLang()]?.[key] || fallback; }

function populateMonths() {
    const monthSel = document.getElementById('fieldExpMonth');
    if (!monthSel) return;
    const saved = monthSel.value;
    const monthKeys = ['month_jan','month_feb','month_mar','month_apr','month_may','month_jun',
                       'month_jul','month_aug','month_sep','month_oct','month_nov','month_dec'];
    const fallbacks = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    monthSel.innerHTML = '<option value="">MM</option>';
    monthKeys.forEach((key, i) => {
        const opt = document.createElement('option');
        opt.value = String(i + 1).padStart(2, '0');
        opt.textContent = `${opt.value} - ${t(key, fallbacks[i])}`;
        monthSel.appendChild(opt);
    });
    if (saved) monthSel.value = saved;
}

let paymentMethods = [];
let activeMethodId = null;
let stripeInstance  = null;

document.addEventListener('DOMContentLoaded', async function () {
    populateYears();

    // Set up language change hook FIRST (before any async operations)
    function reRenderDynamic() {
        populateMonths();
        renderMethodsList();
        const editingId = document.getElementById('editingMethodId')?.value;
        const formTitle = document.getElementById('formTitle');
        const btnSaveText = document.getElementById('btnSaveText');
        if (formTitle) formTitle.textContent = editingId ? t('pm_edit_card','Editar Tarjeta') : t('pm_add_card','Agregar Tarjeta');
        if (btnSaveText) btnSaveText.textContent = editingId ? t('pm_update_card','Actualizar Tarjeta') : t('pm_save_card','Guardar Tarjeta');
    }
    if (window.Translations) {
        const _orig = window.Translations.apply.bind(window.Translations);
        window.Translations.apply = function(lang) { _orig(lang); reRenderDynamic(); };
    }
    // Backup: catch language stored in localStorage by userbar
    document.addEventListener('attomos:langchange', reRenderDynamic);
    document.addEventListener('click', (e) => {
        if (e.target.closest?.('[data-lang]')) setTimeout(reRenderDynamic, 50);
    });

    loadPaymentMethods();
    initCardLivePreview();
    await initStripe();
    populateMonths();
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
function populateMonths() {
    const monthSel = document.getElementById('fieldExpMonth');
    if (!monthSel) return;
    const saved = monthSel.value;
    const monthKeys = ['month_jan','month_feb','month_mar','month_apr','month_may','month_jun',
                       'month_jul','month_aug','month_sep','month_oct','month_nov','month_dec'];
    const fallbacks = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    monthSel.innerHTML = '<option value="">MM</option>';
    monthKeys.forEach((key, i) => {
        const opt = document.createElement('option');
        opt.value = String(i + 1).padStart(2, '0');
        opt.textContent = `${opt.value} - ${t(key, fallbacks[i])}`;
        monthSel.appendChild(opt);
    });
    if (saved) monthSel.value = saved;
}

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
        list.innerHTML = `<p class="pm-empty-methods">${t('pm_no_cards','No hay tarjetas guardadas. Agrega una usando el formulario.')}</p>`;
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
            ${m.id === activeMethodId ? `<span class="method-default-badge"><i class="lni lni-checkmark-circle"></i> ${t('pm_badge_main','Principal')}</span>` : ''}
            <div class="method-actions" onclick="event.stopPropagation()">
                ${m.id !== activeMethodId ? `
                <button class="method-action-btn" title="Usar como principal" onclick="setDefaultMethod('${m.id}')">
                    <i class="lni lni-checkmark-circle"></i>
                </button>` : ''}
                <button class="method-action-btn" title="${t('pm_tooltip_edit','Editar')}" onclick="editMethod('${m.id}')">
                    <i class="lni lni-pencil"></i>
                </button>
                <button class="method-action-btn danger" title="${t('pm_tooltip_delete','Eliminar')}" onclick="confirmDeleteMethod('${m.id}')">
                    <i class="lni lni-trash-can"></i>
                </button>
            </div>
        </div>
    `).join('');

    // Add card button
    list.innerHTML += `
        <button class="btn-add-card" onclick="resetForm()">
            <i class="lni lni-plus-circle"></i>
            <span>${t('pm_add_another','Agregar otra tarjeta')}</span>
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
        showNotification(t('pm_validation_error','Por favor completa todos los campos correctamente'), 'error');
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
                throw new Error(t('pm_stripe_not_init','Stripe no está inicializado. Recarga la página.'));
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

        if (!res.ok) throw new Error(data.error || t('pm_save_error','Error guardando tarjeta'));

        showNotification(editingId ? t('pm_updated_ok','Tarjeta actualizada correctamente') : t('pm_saved_ok','Tarjeta guardada correctamente'), 'success');
        resetForm();
        await loadPaymentMethods();

    } catch (e) {
        showNotification(e.message, 'error');
    } finally {
        btn.disabled = false;
        btnText.textContent = document.getElementById('editingMethodId').value ? t('pm_update_card','Actualizar Tarjeta') : t('pm_save_card','Guardar Tarjeta');
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
    document.getElementById('formTitle').textContent    = t('pm_edit_card','Editar Tarjeta');
    document.getElementById('formSubtitle').textContent = `•••• •••• •••• ${m.last4}`;
    document.getElementById('btnSaveText').textContent  = t('pm_update_card','Actualizar Tarjeta');
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
    document.getElementById('formTitle').textContent   = t('pm_add_card','Agregar Tarjeta');
    document.getElementById('formSubtitle').textContent= 'Tus datos están cifrados y seguros';
    document.getElementById('btnSaveText').textContent = t('pm_save_card','Guardar Tarjeta');
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
        showNotification(t('pm_default_ok','Tarjeta principal actualizada'), 'success');
        await loadPaymentMethods();
    } catch (e) {
        showNotification(t('pm_default_error','Error al actualizar tarjeta principal'), 'error');
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
        title: t('pm_delete_title','¿Eliminar Tarjeta?'),
        message: `${t('pm_delete_msg_pre','Eliminarás la tarjeta que termina en')} <strong>${m.last4}</strong>.`,
        list: [
            'Esta acción no se puede deshacer',
            m.id === activeMethodId ? t('pm_delete_main_warn','Es tu tarjeta principal de cobro') : '',
        ].filter(Boolean),
        confirmText: t('pm_delete_confirm','Eliminar Tarjeta'),
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
        throw new Error(d.error || t('pm_delete_error','Error al eliminar'));
    }
    showNotification(t('pm_deleted_ok','Tarjeta eliminada correctamente'), 'success');
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
                        <i class="lni lni-close"></i><span>${t('pm_modal_cancel','Cancelar')}</span>
                    </button>
                    <button class="btn-confirm-action ${confirmClass}" id="confirmActionBtn">
                        <i class="lni lni-checkmark"></i><span>${confirmText}</span>
                    </button>
                </div>
            </div>
        </div>`;

    modal.classList.add('active');

    document.getElementById('confirmActionBtn').addEventListener('click', async function () {
        this.innerHTML = `<div class="loading-spinner-small"></div><span>${t('pm_processing','Procesando...')}</span>`;
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

// ============================================================================
// CAPA iOS 27 — Método de pago
// Entrada escalonada, tarjeta que se inclina con el cursor y gira con
// resorte, selects de mes/año estilo iOS, tarjetas guardadas escalonadas y
// modal con salida. Los <select> originales siguen siendo la fuente de verdad.
// ============================================================================
(function () {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
    const lerp = (a, b, t) => a + (b - a) * t;
    const CLOSED_CLIP = 'inset(50% 50% 50% 50%)';
    const CHEVRON = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    // --- Motor de resortes ---
    const springs = new Set();
    const renderers = new Set();
    const spring = (v = 0, k = 380, d = 30, eps = 0.1) => {
        const s = { v, vel: 0, t: v, k, d, eps };
        springs.add(s);
        return s;
    };
    const atRest = (s) => Math.abs(s.v - s.t) < s.eps && Math.abs(s.vel) < s.eps * 5;
    let raf = null, last = 0;
    function tick(now) {
        const dt = Math.min((now - last) / 1000, 1 / 30);
        last = now;
        springs.forEach((s) => {
            if (reduce.matches) { s.v = s.t; s.vel = 0; return; }
            s.vel += (-s.k * (s.v - s.t) - s.d * s.vel) * dt;
            s.v += s.vel * dt;
        });
        renderers.forEach((r) => r());
        if ([...springs].every(atRest)) {
            springs.forEach((s) => { s.v = s.t; s.vel = 0; });
            renderers.forEach((r) => r());
            raf = null;
            return;
        }
        raf = requestAnimationFrame(tick);
    }
    function kick() {
        if (raf) return;
        last = performance.now();
        raf = requestAnimationFrame(tick);
    }

    // ====================================================================
    // 1. ENTRADA
    // El encabezado entra de inmediato; las tarjetas cuando termina la carga.
    // ====================================================================
    function rise(elements, startAt = 0) {
        let i = startAt;
        elements.forEach((el) => {
            if (!el) return;
            el.style.setProperty('--i', i++);
            el.classList.add('ios-in');
        });
    }

    function pageEntrance() {
        rise([document.querySelector('.page-header')]);
        document.addEventListener('animationend', (e) => {
            if (e.animationName === 'iosRiseMove' && e.target.classList.contains('ios-in')) {
                e.target.classList.remove('ios-in');
            }
        });

        const grid = document.getElementById('pmGrid');
        if (!grid) return;
        let shown = false;
        const reveal = () => {
            if (shown || grid.style.display === 'none') return;
            shown = true;
            rise([
                document.querySelector('.card-visual-section'),
                document.querySelector('.form-card'),
                document.querySelector('.saved-methods-section'),
            ], 1);
        };
        const mo = new MutationObserver(() => { reveal(); if (shown) mo.disconnect(); });
        mo.observe(grid, { attributes: true, attributeFilter: ['style'] });
        reveal();
    }

    // Tarjetas guardadas: entran escalonadas cada vez que se pinta la lista
    function watchMethods() {
        const list = document.getElementById('methodsList');
        if (!list) return;
        const tag = () => {
            let n = 0;
            list.querySelectorAll(':scope > .method-item:not(.ios-row), :scope > .btn-add-card:not(.ios-row), :scope > .pm-empty-methods:not(.ios-row)').forEach((el) => {
                el.style.setProperty('--r', n++);
                el.classList.add('ios-row');
            });
        };
        new MutationObserver(tag).observe(list, { childList: true });
        tag();
    }

    // ====================================================================
    // 2. TARJETA: se inclina siguiendo al cursor (el giro lo hace el CSS)
    // ====================================================================
    function cardTilt() {
        const wrapper = document.getElementById('cardWrapper');
        if (!wrapper) return;
        const RX = spring(0, 260, 22, 0.01), RY = spring(0, 260, 22, 0.01), S = spring(1, 300, 24, 0.0005);
        function render() {
            if (Math.abs(RX.v) < 0.01 && Math.abs(RY.v) < 0.01 && Math.abs(S.v - 1) < 0.0005) {
                wrapper.style.transform = '';
                return;
            }
            wrapper.style.transform = `perspective(900px) rotateX(${RX.v}deg) rotateY(${RY.v}deg) scale(${S.v})`;
        }
        renderers.add(render);
        wrapper.addEventListener('pointermove', (e) => {
            if (e.pointerType !== 'mouse' || reduce.matches) return;
            const card = document.getElementById('creditCard');
            const r = (card || wrapper).getBoundingClientRect();
            const px = clamp((e.clientX - r.left) / r.width) - 0.5;
            const py = clamp((e.clientY - r.top) / r.height) - 0.5;
            RX.t = -py * 10;
            RY.t = px * 12;
            S.t = 1.02;
            kick();
        });
        wrapper.addEventListener('pointerleave', () => { RX.t = 0; RY.t = 0; S.t = 1; kick(); });
        wrapper.addEventListener('pointerdown', () => { S.t = 0.98; kick(); });
        wrapper.addEventListener('pointerup', () => { S.t = 1.02; kick(); });
    }

    // ====================================================================
    // 3. SELECTS DE MES Y AÑO estilo iOS
    // ====================================================================
    const selects = new Set();

    function iosSelect(select) {
        if (!select || select.dataset.iosSelect) return null;
        select.dataset.iosSelect = '1';

        const wrap = document.createElement('div');
        wrap.className = 'ios-select';
        select.parentNode.insertBefore(wrap, select);
        wrap.appendChild(select);
        select.classList.add('ios-select-native');
        select.tabIndex = -1;

        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'ios-select-trigger';
        trigger.setAttribute('aria-haspopup', 'listbox');
        trigger.innerHTML = `<span class="ios-select-label"></span>${CHEVRON}`;
        const label = trigger.querySelector('.ios-select-label');

        const menu = document.createElement('div');
        menu.className = 'ios-select-menu';
        menu.setAttribute('role', 'listbox');
        menu.style.visibility = 'hidden';
        menu.style.clipPath = CLOSED_CLIP;
        const ind = document.createElement('span');
        ind.className = 'ios-select-ind';
        ind.setAttribute('aria-hidden', 'true');

        wrap.append(trigger, menu);

        const P = spring(0, 400, 30, 0.001);
        const X = spring(0, 520, 36), Y = spring(0, 520, 36), W = spring(0, 520, 36), H = spring(0, 520, 36);
        const V = spring(0, 600, 44, 0.001);
        let open = false, hovered = null;

        function paintLabel() {
            const opt = select.options[select.selectedIndex];
            label.textContent = opt ? opt.textContent.trim() : '';
            trigger.classList.toggle('is-placeholder', !select.value);
        }

        function syncError() {
            const has = select.classList.contains('error');
            if (trigger.classList.contains('error') !== has) trigger.classList.toggle('error', has);
        }

        function buildOptions() {
            menu.innerHTML = '';
            menu.appendChild(ind);
            [...select.options].forEach((o) => {
                if (!o.value) return;   // el "MM" / "AAAA" vacío no se ofrece
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'ios-select-option';
                b.setAttribute('role', 'option');
                b.dataset.value = o.value;
                b.textContent = o.textContent.trim();
                if (o.value === select.value) { b.classList.add('selected'); b.setAttribute('aria-selected', 'true'); }
                menu.appendChild(b);
            });
        }

        function render() {
            const p = P.v, pc = clamp(p);
            if (p < 0.002 && P.t === 0) {
                menu.style.visibility = 'hidden';
                menu.style.clipPath = CLOSED_CLIP;
            } else {
                menu.style.visibility = 'visible';
                menu.style.setProperty('--ios-p', pc.toFixed(3));
                if (open && atRest(P)) menu.style.clipPath = 'none';
                else {
                    const a = trigger.getBoundingClientRect(), c = menu.getBoundingClientRect();
                    const t = lerp(a.top - c.top, 0, p), l = lerp(a.left - c.left, 0, p);
                    const r = lerp(c.right - a.right, 0, p), b = lerp(c.bottom - a.bottom, 0, p);
                    menu.style.clipPath = `inset(${t}px ${r}px ${b}px ${l}px round ${lerp(a.height / 2, 20, pc)}px)`;
                }
            }
            const st = Math.min(Math.abs(Y.vel) / 1800, 0.2);
            ind.style.width = `${W.v}px`;
            ind.style.height = `${H.v}px`;
            ind.style.opacity = clamp(V.v);
            ind.style.transform = `translate(${X.v}px, ${Y.v}px) scale(${1 - st * 0.2}, ${1 + st})`;
        }
        renderers.add(render);

        function hoverTo(el) {
            if (el === hovered) return;
            if (hovered) hovered.classList.remove('ios-hover');
            hovered = el;
            if (!el) { V.t = 0; kick(); return; }
            el.classList.add('ios-hover');
            X.t = el.offsetLeft; Y.t = el.offsetTop; W.t = el.offsetWidth; H.t = el.offsetHeight; V.t = 1;
            if (V.v < 0.05) { X.v = X.t; Y.v = Y.t; W.v = W.t; H.v = H.t; }
            kick();
        }

        function setOpen(v) {
            if (v === open) return;
            open = v;
            wrap.classList.toggle('is-open', v);
            trigger.setAttribute('aria-expanded', v);
            // La tarjeta del formulario queda por encima de lo demás mientras está abierto
            const host = wrap.closest('.form-card');
            if (host) host.classList.toggle('ios-dd-host', v || [...selects].some((s) => s !== api && s.isOpen()));
            if (v) {
                selects.forEach((s) => s !== api && s.close());
                buildOptions();
                // Se abre hacia arriba si abajo no cabe
                wrap.classList.remove('ios-up');
                const r = menu.getBoundingClientRect();
                if (r.bottom > window.innerHeight - 12 && trigger.getBoundingClientRect().top - r.height > 12) {
                    wrap.classList.add('ios-up');
                }
                // La opción elegida queda a la vista
                const sel = menu.querySelector('.ios-select-option.selected');
                menu.scrollTop = sel ? Math.max(0, sel.offsetTop - menu.clientHeight / 2 + sel.offsetHeight / 2) : 0;
                V.v = V.t = 0; hovered = null;
                P.t = 1;
                if (!reduce.matches && menu.animate) {
                    menu.querySelectorAll('.ios-select-option').forEach((it, i) => {
                        it.animate(
                            [{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }],
                            { duration: 380, delay: 30 + Math.min(i, 12) * 16, easing: 'cubic-bezier(0.34, 1.35, 0.64, 1)', fill: 'backwards' }
                        );
                    });
                }
            } else {
                P.t = 0;
                hoverTo(null);
            }
            render();
            kick();
        }

        function choose(value) {
            if (select.value !== value) {
                select.value = value;
                select.dispatchEvent(new Event('change', { bubbles: true }));
            }
            paintLabel();
            menu.querySelectorAll('.ios-select-option').forEach((b) => {
                const on = b.dataset.value === value;
                b.classList.toggle('selected', on);
                b.setAttribute('aria-selected', on);
            });
            setTimeout(() => setOpen(false), 160);   // deja ver la palomita antes de cerrar
        }

        trigger.addEventListener('click', () => setOpen(!open));
        menu.addEventListener('pointermove', (e) => {
            const el = e.target.closest('.ios-select-option');
            if (el) hoverTo(el);
        });
        menu.addEventListener('pointerleave', () => hoverTo(null));
        menu.addEventListener('scroll', () => hoverTo(null), { passive: true });
        menu.addEventListener('click', (e) => {
            const b = e.target.closest('.ios-select-option');
            if (b) choose(b.dataset.value);
        });
        // populateMonths() reconstruye las opciones al cambiar idioma
        new MutationObserver(paintLabel).observe(select, { subtree: true, childList: true, characterData: true });
        // saveCard() marca errores en el <select>: se reflejan en el botón
        new MutationObserver(syncError).observe(select, { attributes: true, attributeFilter: ['class'] });
        select.addEventListener('change', paintLabel);

        const api = {
            close: () => setOpen(false),
            isOpen: () => open,
            contains: (n) => wrap.contains(n),
            refresh: () => { paintLabel(); syncError(); },
        };
        selects.add(api);
        paintLabel();
        syncError();
        render();
        return api;
    }

    document.addEventListener('pointerdown', (e) => {
        selects.forEach((s) => { if (!s.contains(e.target)) s.close(); });
    });
    window.addEventListener('resize', () => renderers.forEach((r) => r()));

    // editMethod() y resetForm() cambian el valor sin disparar "change":
    // después de llamarlas se repintan los botones
    function wrapRefresh(name) {
        const orig = window[name];
        if (typeof orig !== 'function' || orig.__ios) return;
        const wrapped = function () {
            const out = orig.apply(this, arguments);
            selects.forEach((s) => s.refresh());
            return out;
        };
        wrapped.__ios = true;
        window[name] = wrapped;
    }

    // ====================================================================
    // 4. MODAL DE CONFIRMACIÓN: salida animada y Esc para cerrar
    // ====================================================================
    function wrapConfirmClose() {
        const orig = window.closeConfirmModal;
        if (typeof orig !== 'function' || orig.__ios) return;
        const wrapped = function () {
            const args = arguments, self = this;
            const modal = document.getElementById('confirmModal');
            if (!modal || !modal.classList.contains('active') || modal.classList.contains('ios-closing') || reduce.matches) {
                orig.apply(self, args);
                return;
            }
            modal.classList.add('ios-closing');
            setTimeout(() => {
                modal.classList.remove('ios-closing');
                orig.apply(self, args);
            }, 230);
        };
        wrapped.__ios = true;
        window.closeConfirmModal = wrapped;
    }

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        selects.forEach((s) => s.close());
        if (document.querySelector('#confirmModal.active')) window.closeConfirmModal();
    });

    function init() {
        pageEntrance();
        watchMethods();
        cardTilt();
        iosSelect(document.getElementById('fieldExpMonth'));
        iosSelect(document.getElementById('fieldExpYear'));
        wrapRefresh('editMethod');
        wrapRefresh('resetForm');
        wrapRefresh('cancelForm');
        wrapConfirmClose();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();