// ============================================
// BILLING - HISTORIAL DE PAGOS + SUSCRIPCIÓN DINÁMICA
// ============================================

function getLang() {
    return localStorage.getItem('attomos_lang') || localStorage.getItem('lang') || 'es';
}
function t(key, fallback) {
    return window.Translations?.dict?.[getLang()]?.[key] || fallback;
}

const PAGE_SIZE = 7;
let allPayments = [];
let currentPage = 1;
let subscriptionData = null;

document.addEventListener('DOMContentLoaded', function() {
    loadBillingInfo();
    loadPayments();

    // Re-render dynamic content when language changes
    if (window.Translations) {
        const _orig = window.Translations.apply.bind(window.Translations);
        window.Translations.apply = function(lang) {
            _orig(lang);
            if (subscriptionData) renderSubscriptionCard(subscriptionData);
            if (allPayments.length) renderTable();
        };
    }
});

// ============================================
// SUSCRIPCIÓN ACTUAL
// ============================================

async function loadBillingInfo() {
    try {
        const response = await fetch('/api/billing/info', { credentials: 'include' });
        if (!response.ok) throw new Error('Error cargando info de facturación');
        const data = await response.json();
        subscriptionData = data;
        renderSubscriptionCard(data);
    } catch (error) {
        console.error('Error cargando billing info:', error);
    }
}

function planDisplayName(planKey) {
    const map = {
        gratuito: t('billing_plan_gratuito', 'Gratuito (Prueba)'),
        proton:   t('billing_plan_proton', 'Protón'),
        neutron:  t('billing_plan_neutron', 'Neutrón'),
        electron: t('billing_plan_electron', 'Electrón'),
        pending:  t('billing_plan_pending', 'Sin plan'),
    };
    return map[planKey] || planKey;
}

function statusDisplayText(status) {
    const map = {
        active:   t('billing_status_active', 'Activa'),
        trialing: t('billing_status_trialing', 'Prueba'),
        canceled: t('billing_status_canceled', 'Cancelada'),
        past_due: t('billing_status_pastdue', 'Vencida'),
    };
    return map[status] || t('billing_status_inactive', 'Inactiva');
}

function cycleDisplayText(cycle) {
    return cycle === 'annual' ? t('billing_annual', 'Anual') : t('billing_monthly', 'Mensual');
}

function formatISODate(iso) {
    if (!iso) return '';
    let d = new Date(iso);
    // If not valid ISO, try parsing Spanish format "D de Monthname, YYYY"
    if (isNaN(d.getTime())) {
        const sm = {enero:0,febrero:1,marzo:2,abril:3,mayo:4,junio:5,julio:6,agosto:7,septiembre:8,octubre:9,noviembre:10,diciembre:11};
        const m = iso.match(/(\d+)\s+de\s+(\w+),?\s+(\d{4})/i);
        if (m && sm[m[2].toLowerCase()] !== undefined) {
            d = new Date(parseInt(m[3]), sm[m[2].toLowerCase()], parseInt(m[1]));
        }
    }
    if (isNaN(d.getTime())) return iso; // fallback: return as-is
    const localeMap = { es:'es-MX', en:'en-US', ru:'ru-RU', uz:'uz-UZ', ja:'ja-JP', zh:'zh-CN', fr:'fr-FR', pt:'pt-BR', de:'de-DE', ko:'ko-KR' };
    return d.toLocaleDateString(localeMap[getLang()] || 'es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatPrice(amount, currency) {
    if (!amount) return '';
    const cur = (currency || 'mxn').toUpperCase();
    return `$${amount.toFixed(2)} ${cur}`;
}

function renderSubscriptionCard(data) {
    const { hasPlan, subscription: sub } = data;

    // Status badge
    const statusEl = document.getElementById('subscriptionStatus');
    if (statusEl) {
        statusEl.textContent = sub
            ? statusDisplayText(sub.status) || sub.statusDisplay || t('billing_no_plan','Sin plan')
            : t('billing_no_plan', 'Sin plan');
        statusEl.className = 'subscription-status ' + (sub ? sub.statusClass : 'inactive');
    }

    if (!hasPlan || !sub) {
        document.getElementById('subPlanRow').innerHTML    = `<span class="info-label">${t('billing_label_plan','Plan:')}</span><span class="info-value">${t('billing_no_active_plan','Sin plan activo')}</span>`;
        document.getElementById('subPriceRow').innerHTML   = '';
        document.getElementById('subNextRow').innerHTML    = '';
        document.getElementById('subMethodRow').innerHTML  = '';
        document.getElementById('cancelBtn').style.display = 'none';
        return;
    }

    // Plan
    const planName = sub.plan ? planDisplayName(sub.plan) : (sub.planDisplay || '');
    const cycleName = sub.billingCycle ? cycleDisplayText(sub.billingCycle) : (sub.cycleDisplay || '');
    setInfoRow('subPlanRow', t('billing_label_plan','Plan:'), `<strong>${planName}</strong> &nbsp;<span style="font-size:0.75rem;color:#6b7280;">(${cycleName})</span>`);

    // Precio
    const isFreeField = sub.isFree ?? (sub.plan === 'gratuito');
    if (isFreeField) {
        setInfoRow('subPriceRow', t('billing_label_price','Precio:'), t('billing_free','Gratis'));
    } else if (sub.priceAmount) {
        const periodSuffix = sub.billingCycle === 'annual' ? t('billing_per_year','/ año') : t('billing_per_month','/ mes');
        setInfoRow('subPriceRow', t('billing_label_price','Precio:'), `${formatPrice(sub.priceAmount, sub.priceCurrency)} ${periodSuffix}`);
    } else if (sub.priceDisplay) {
        // backward-compat: old backend already formatted the price string
        setInfoRow('subPriceRow', t('billing_label_price','Precio:'), sub.priceDisplay);
    } else {
        document.getElementById('subPriceRow').style.display = 'none';
    }

    // Próximo cobro / vencimiento
    const nextDate = sub.currentPeriodEnd ? formatISODate(sub.currentPeriodEnd) : (sub.nextBilling || '');
    if (nextDate) {
        const label = sub.isTrial ? t('billing_trial_end','Fin de prueba:') : t('billing_label_next','Próximo cobro:');
        const suffix = sub.cancelAtPeriodEnd
            ? ` <span style="color:#ef4444;font-size:0.8rem;">(${t('billing_cancel_pending','cancelación pendiente')})</span>`
            : '';
        setInfoRow('subNextRow', label, nextDate + suffix);
    } else {
        document.getElementById('subNextRow').style.display = 'none';
    }

    // Días restantes info
    if (sub.daysRemaining !== undefined && sub.daysRemaining <= 7) {
        setInfoRow('subNextRow', t('billing_expires_in','Vence en:'), `<span style="color:#f59e0b;font-weight:600;">${sub.daysRemaining} ${t('billing_days','días')}</span>`);
    }

    // Botón cancelar
    const cancelBtn = document.getElementById('cancelBtn');
    if (cancelBtn) {
        const isFree = sub.isFree ?? (sub.plan === 'gratuito');
        if (sub.cancelAtPeriodEnd || isFree) {
            cancelBtn.style.display = 'none';
        } else {
            cancelBtn.style.display = '';
        }
    }
}

function setInfoRow(rowId, label, valueHtml) {
    const el = document.getElementById(rowId);
    if (el) {
        el.innerHTML = `<span class="info-label">${label}</span><span class="info-value">${valueHtml}</span>`;
        el.style.display = '';
    }
}

// ============================================
// HISTORIAL DE PAGOS
// ============================================

async function loadPayments() {
    try {
        const response = await fetch('/api/billing/payments', { credentials: 'include' });
        if (response.ok) {
            const data = await response.json();
            allPayments = data.payments || [];
        } else {
            allPayments = [];
        }
    } catch (error) {
        allPayments = [];
    }
    renderTable();
}

function renderTable() {
    const tbody = document.getElementById('paymentsTableBody');
    const emptyState = document.getElementById('emptyState');
    const paginationWrapper = document.getElementById('paginationWrapper');

    if (!allPayments.length) {
        tbody.innerHTML = '';
        emptyState.style.display = 'block';
        paginationWrapper.style.display = 'none';
        return;
    }

    emptyState.style.display = 'none';
    const totalPages = Math.ceil(allPayments.length / PAGE_SIZE);
    if (currentPage > totalPages) currentPage = totalPages;

    const start = (currentPage - 1) * PAGE_SIZE;
    const pageItems = allPayments.slice(start, start + PAGE_SIZE);

    const statusBadge = (s) => {
        const map = {
            succeeded: `<span class="badge-invoiced-yes">${t('billing_status_completed','✓ Completado')}</span>`,
            failed:    `<span class="badge-invoiced-no">${t('billing_status_failed','✕ Fallido')}</span>`,
            pending:   `<span style="color:#f59e0b;font-weight:600;">${t('billing_status_pending','⏳ Pendiente')}</span>`,
            refunded:  `<span style="color:#8b5cf6;font-weight:600;">${t('billing_status_refunded','↩ Reembolsado')}</span>`,
        };
        return map[s] || `<span>${s}</span>`;
    };

    const monthKeys = ['month_jan','month_feb','month_mar','month_apr','month_may','month_jun',
                        'month_jul','month_aug','month_sep','month_oct','month_nov','month_dec'];
    const monthName = (iso) => {
        if (!iso) return '';
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        return t(monthKeys[d.getMonth()], '');
    };
    const shortDate = (iso) => {
        if (!iso) return '';
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        const localeMap = { es:'es-MX', en:'en-US', ru:'ru-RU', uz:'uz-UZ', ja:'ja-JP', zh:'zh-CN', fr:'fr-FR', pt:'pt-BR', de:'de-DE', ko:'ko-KR' };
        return d.toLocaleDateString(localeMap[getLang()] || 'es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
    };

    tbody.innerHTML = pageItems.map(p => `
        <tr>
            <td data-label="${t('billing_th_payment_id','ID de Pago')}"><span class="pay-id" title="${p.paymentId}">...${p.paymentId.slice(-8)}</span></td>
            <td data-label="${t('billing_th_receipt_id','ID de Recibo')}"><span class="receipt-id">${p.receiptId}</span></td>
            <td data-label="${t('billing_th_sub','Suscripción')}"><span class="pay-subscription">${planDisplayName(p.plan)}</span></td>
            <td data-label="${t('billing_th_month','Mes')}">${monthName(p.paymentDate)}</td>
            <td data-label="${t('billing_th_date','Fecha')}">${shortDate(p.paymentDate)}</td>
            <td data-label="${t('billing_th_amount','Cantidad')}"><span class="pay-amount">${p.amount}</span></td>
            <td data-label="${t('billing_th_status','Estado')}">${statusBadge(p.status)}</td>
            <td><button class="row-menu-btn" onclick="openRowMenu(this, '${p.paymentId}', '${p.chargeId || ''}', ${p.id || 0})">⋮</button></td>
        </tr>
    `).join('');

    if (totalPages > 1) {
        paginationWrapper.style.display = 'flex';
        renderPagination(totalPages);
    } else {
        paginationWrapper.style.display = 'none';
    }
}

function renderPagination(totalPages) {
    const pageNumbers = document.getElementById('pageNumbers');
    document.getElementById('prevBtn').disabled = currentPage === 1;
    document.getElementById('nextBtn').disabled = currentPage === totalPages;
    let html = '';
    for (let i = 1; i <= totalPages; i++) {
        html += `<button class="page-number ${i === currentPage ? 'active' : ''}" onclick="goToPage(${i})">${i}</button>`;
    }
    pageNumbers.innerHTML = html;
}

function changePage(delta) {
    const totalPages = Math.ceil(allPayments.length / PAGE_SIZE);
    const next = currentPage + delta;
    if (next >= 1 && next <= totalPages) { currentPage = next; renderTable(); }
}

function goToPage(page) { currentPage = page; renderTable(); }

// ============================================
// MENÚ DE FILA
// ============================================

function openRowMenu(btn, paymentId, chargeId, dbId) {
    document.querySelectorAll('.row-context-menu').forEach(m => m.remove());
    const menu = document.createElement('div');
    menu.className = 'row-context-menu';
    menu.innerHTML = `
        <button onclick="copyPaymentId('${paymentId}')"><i class="lni lni-files"></i> ${t('billing_copy_id','Copiar ID')}</button>
        ${dbId ? `<button onclick="downloadReceipt(${dbId})"><i class="lni lni-download"></i> ${t('billing_download_receipt','Descargar recibo PDF')}</button>` : ''}
    `;
    const rect = btn.getBoundingClientRect();
    const menuLeft = Math.max(8, rect.left - 140);
    menu.style.cssText = `position:fixed;top:${rect.bottom+4}px;left:${menuLeft}px;background:white;border:1px solid #e5e7eb;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,0.12);padding:0.5rem;z-index:9999;min-width:180px;`;
    menu.querySelectorAll('button').forEach(b => {
        b.style.cssText = 'display:flex;align-items:center;gap:0.5rem;width:100%;padding:0.625rem 0.75rem;background:none;border:none;border-radius:8px;font-size:0.875rem;font-weight:500;color:#374151;cursor:pointer;text-align:left;';
        b.addEventListener('mouseenter', () => b.style.background = '#f3f4f6');
        b.addEventListener('mouseleave', () => b.style.background = 'none');
    });
    document.body.appendChild(menu);
    setTimeout(() => {
        document.addEventListener('click', function closeMenu(e) {
            if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', closeMenu); }
        });
    }, 10);
}

function copyPaymentId(id) {
    navigator.clipboard.writeText(id).then(() => showNotification(t('billing_id_copied','ID copiado al portapapeles'), 'success'));
    document.querySelectorAll('.row-context-menu').forEach(m => m.remove());
}

function downloadReceipt(dbId) {
    document.querySelectorAll('.row-context-menu').forEach(m => m.remove());
    showNotification(t('billing_generating_receipt','Generando recibo...'), 'info');
    window.location.href = `/api/billing/receipt/${dbId}`;
}

// ============================================
// CANCELAR SUSCRIPCIÓN
// ============================================

function cancelSubscription() {
    showConfirmModal({
        type: 'danger',
        icon: 'lni-warning',
        title: t('billing_cancel_title','¿Cancelar Suscripción?'),
        message: t('billing_cancel_msg','Estás a punto de cancelar tu suscripción activa.'),
        list: [
            t('billing_cancel_item1','Mantendrás acceso hasta el fin del período actual'),
            t('billing_cancel_item2','No se realizarán más cobros automáticos'),
            t('billing_cancel_item3','Podrás reactivar tu plan en cualquier momento')
        ],
        confirmText: t('billing_cancel_confirm','Sí, cancelar'),
        confirmClass: 'danger',
        onConfirm: async () => {
            const response = await fetch('/api/billing/cancel', {
                method: 'POST',
                credentials: 'include'
            });
            const data = await response.json();
            if (response.ok) {
                showNotification(t('billing_cancel_success','Suscripción cancelada. Acceso activo hasta fin del período.'), 'success');
                setTimeout(() => loadBillingInfo(), 1000);
            } else {
                throw new Error(data.error || t('billing_cancel_error','Error al cancelar'));
            }
        }
    });
}

// ============================================
// MODAL DE CONFIRMACIÓN (idéntico a my-agents)
// ============================================

function showConfirmModal(options) {
    const {
        type = 'warning',
        icon = 'lni-warning',
        title = '¿Estás seguro?',
        message = '',
        list = [],
        confirmText = 'Confirmar',
        confirmClass = 'danger',
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
                <div class="confirm-icon ${type}">
                    <i class="lni ${icon}"></i>
                </div>
                <h3 class="confirm-title">${title}</h3>
                <p class="confirm-message">${message}</p>
            </div>
            <div class="confirm-body">
                ${list.length > 0 ? `
                    <div class="confirm-list">
                        ${list.map(item => `
                            <div class="confirm-list-item">
                                <i class="lni lni-close"></i>
                                <span>${item}</span>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}
                <div class="confirm-actions">
                    <button class="btn-confirm-cancel" onclick="closeConfirmModal()">
                        <i class="lni lni-close"></i>
                        <span>${t('billing_modal_back','Volver')}</span>
                    </button>
                    <button class="btn-confirm-action ${confirmClass}" id="confirmActionBtn">
                        <i class="lni lni-checkmark"></i>
                        <span>${confirmText}</span>
                    </button>
                </div>
            </div>
        </div>
    `;

    modal.classList.add('active');

    document.getElementById('confirmActionBtn').addEventListener('click', async function () {
        this.innerHTML = `<div class="loading-spinner-small"></div><span>${t('billing_modal_processing','Procesando...')}</span>`;
        this.disabled = true;
        try {
            await onConfirm();
            closeConfirmModal();
        } catch (error) {
            showNotification(error.message || t('billing_modal_generic_error','Error al procesar'), 'error');
            this.disabled = false;
            this.innerHTML = `<i class="lni lni-checkmark"></i><span>${confirmText}</span>`;
        }
    });
}

function closeConfirmModal() {
    const modal = document.getElementById('confirmModal');
    if (modal) {
        modal.classList.remove('active');
        setTimeout(() => modal.remove(), 300);
    }
}

// ============================================
// NOTIFICACIONES
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

if (!document.getElementById('notification-styles')) {
    const style = document.createElement('style');
    style.id = 'notification-styles';
    style.textContent = `
        .notification { position:fixed;top:20px;right:20px;background:white;padding:1rem 1.5rem;border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,0.15);display:flex;align-items:center;gap:0.75rem;z-index:10000;transform:translateX(400px);transition:transform 0.3s ease;border-left:4px solid #06b6d4;font-weight:600;color:#1a1a1a;font-size:0.9rem; }
        .notification.active { transform:translateX(0); }
        .notification-success { border-left-color:#10b981; }
        .notification-success i { color:#10b981;font-size:22px; }
        .notification-error { border-left-color:#ef4444; }
        .notification-error i { color:#ef4444;font-size:22px; }
        .notification-info { border-left-color:#06b6d4; }
        .notification-info i { color:#06b6d4;font-size:22px; }
    `;
    document.head.appendChild(style);
}

// ============================================================================
// CAPA iOS 27 — Facturación
// Entrada escalonada, filas que suben, menú de fila con resorte y cápsula
// que sigue al cursor, estado que "rebota" al cambiar y modal con salida.
// No cambia la lógica de arriba.
// ============================================================================
(function () {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
    const SPRING = (window.CSS && CSS.supports('animation-timing-function', 'linear(0, 1)'))
        ? 'linear(0, 0.04, 0.139, 0.271, 0.416, 0.56, 0.691, 0.805, 0.897, 0.969, 1.021, 1.055, 1.074, 1.082, 1.081, 1.075, 1.065, 1.053, 1.041, 1.03, 1.02, 1.011, 1.005, 1, 0.996, 0.994, 0.993, 0.993, 0.994, 0.994, 0.995, 0.996, 0.997, 0.998, 0.999, 0.999, 1, 1, 1, 1.001, 1.001, 1.001, 1.001, 1, 1, 1, 1, 1, 1)'
        : 'cubic-bezier(0.34, 1.35, 0.64, 1)';

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
    // 1. ENTRADA DE LA PÁGINA
    // ====================================================================
    function pageEntrance() {
        let i = 0;
        [
            document.querySelector('.page-header'),
            document.querySelector('.subscription-card'),
            document.getElementById('paymentsTableContainer'),
        ].forEach((el) => {
            if (!el) return;
            el.style.setProperty('--i', i++);
            el.classList.add('ios-in');
        });
        document.addEventListener('animationend', (e) => {
            if (e.animationName === 'iosRiseMove' && e.target.classList.contains('ios-in')) {
                e.target.classList.remove('ios-in');
            }
        });
    }

    // Filas de pagos: entran escalonadas cada vez que se pinta una página
    function watchRows() {
        const tbody = document.getElementById('paymentsTableBody');
        if (!tbody) return;
        const tag = () => {
            let n = 0;
            tbody.querySelectorAll('tr:not(.ios-row)').forEach((tr) => {
                tr.style.setProperty('--r', n++);
                tr.classList.add('ios-row');
            });
        };
        new MutationObserver(tag).observe(tbody, { childList: true });
        tag();
    }

    // El estado de la suscripción "rebota" cuando cambia
    function watchStatus() {
        const el = document.getElementById('subscriptionStatus');
        if (!el || !el.animate) return;
        let prev = el.className;
        new MutationObserver(() => {
            if (el.className === prev) return;
            prev = el.className;
            if (reduce.matches) return;
            el.animate(
                [{ transform: 'scale(0.6)', opacity: 0 }, { transform: 'none', opacity: 1 }],
                { duration: 650, easing: SPRING }
            );
        }).observe(el, { attributes: true, attributeFilter: ['class'] });
    }

    // ====================================================================
    // 2. MENÚ DE FILA (⋮): se despliega con resorte desde el botón y una
    // cápsula sigue al cursor entre las opciones
    // ====================================================================
    function enhanceMenu(menu) {
        if (menu.__ios) return;
        menu.__ios = true;
        menu.classList.add('ios-ctx');

        const ind = document.createElement('span');
        ind.className = 'ios-ctx-ind';
        ind.setAttribute('aria-hidden', 'true');
        menu.prepend(ind);

        const Y = spring(0, 520, 36), H = spring(0, 520, 36), V = spring(0, 600, 44, 0.001);
        let hovered = null;
        function render() {
            const st = Math.min(Math.abs(Y.vel) / 1800, 0.2);
            ind.style.height = `${H.v}px`;
            ind.style.opacity = clamp(V.v);
            ind.style.transform = `translateY(${Y.v}px) scale(${1 - st * 0.2}, ${1 + st})`;
        }
        renderers.add(render);
        function hoverTo(el) {
            if (el === hovered) return;
            hovered = el;
            if (!el) { V.t = 0; kick(); return; }
            Y.t = el.offsetTop; H.t = el.offsetHeight; V.t = 1;
            if (V.v < 0.05) { Y.v = Y.t; H.v = H.t; }
            kick();
        }
        menu.addEventListener('pointermove', (e) => {
            const b = e.target.closest('button');
            if (b) hoverTo(b);
        });
        menu.addEventListener('pointerleave', () => hoverTo(null));

        if (!reduce.matches && menu.animate) {
            menu.animate(
                [
                    { clipPath: 'inset(0 0 calc(100% - 36px) calc(100% - 36px) round 18px)', opacity: 0.4 },
                    { clipPath: 'inset(0 0 0 0 round 20px)', opacity: 1 },
                ],
                { duration: 520, easing: SPRING }
            );
            menu.querySelectorAll('button').forEach((b, i) => {
                b.animate(
                    [{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }],
                    { duration: 380, delay: 40 + i * 30, easing: 'cubic-bezier(0.34, 1.35, 0.64, 1)', fill: 'backwards' }
                );
            });
        }

        // Salida animada: la lógica original llama a menu.remove()
        const nativeRemove = menu.remove.bind(menu);
        let leaving = false;
        menu.remove = function () {
            if (leaving) return;
            leaving = true;
            renderers.delete(render);
            [Y, H, V].forEach((s) => springs.delete(s));
            if (reduce.matches || !menu.animate) { nativeRemove(); return; }
            menu.style.pointerEvents = 'none';
            const a = menu.animate(
                [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.94) translateY(-4px)' }],
                { duration: 160, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' }
            );
            a.onfinish = nativeRemove;
        };
    }

    function watchMenus() {
        new MutationObserver((records) => {
            records.forEach((r) => r.addedNodes.forEach((n) => {
                if (n.nodeType === 1 && n.classList.contains('row-context-menu')) enhanceMenu(n);
            }));
        }).observe(document.body, { childList: true });
    }

    // ====================================================================
    // 3. MODAL DE CONFIRMACIÓN: salida animada y Esc para cerrar
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
        if (document.querySelector('#confirmModal.active')) window.closeConfirmModal();
        document.querySelectorAll('.row-context-menu').forEach((m) => m.remove());
    });

    function init() {
        pageEntrance();
        watchRows();
        watchStatus();
        watchMenus();
        wrapConfirmClose();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();