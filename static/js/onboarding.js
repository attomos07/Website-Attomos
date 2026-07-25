// ============================================
// ONBOARDING.JS — wizard de creación/edición de agente
// (Antes tenía pegado, sin usar, todo el código de integrations.js:
// Meta, Gemini, Google, Pagos, RepairDesk, SoftRestaurant, selector de
// agente. Ninguno de esos IDs existe en onboarding.html — era código
// muerto y, peor, declaraba `agents`/`selectedAgentId`/etc. a nivel de
// archivo, lo que chocaba con los `let` del mismo nombre en
// dashboard.js/my-agents.js/integrations.js y tumbaba TODO este script
// con un SyntaxError cada vez que se inyectaba en esas páginas. Se quitó
// por completo — solo queda lo que el wizard realmente usa.)
// ============================================

function getLang() { return localStorage.getItem('attomos_lang') || localStorage.getItem('lang') || 'es'; }
function t(key, fallback) { return window.Translations?.dict?.[getLang()]?.[key] || fallback; }

// ============================================
// NOTIFICATION SYSTEM
// ============================================

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.style.cssText = `
        position: fixed;
        top: 100px;
        right: 20px;
        background: ${type === 'success' ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)'};
        color: white;
        padding: 1rem 1.5rem;
        border-radius: 12px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
        font-weight: 600;
        z-index: 10000;
        animation: slideInRight 0.4s ease;
        min-width: 300px;
        display: flex;
        align-items: center;
        gap: 0.75rem;
    `;
    
    const icon = type === 'success' ? '✓' : '✕';
    notification.innerHTML = `
        <span style="font-size: 1.25rem;">${icon}</span>
        <span>${message}</span>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOutRight 0.4s ease';
        setTimeout(() => notification.remove(), 400);
    }, 3000);
}

// Add CSS for animations
const _obAnimStyle = document.createElement('style');
_obAnimStyle.textContent = `
    @keyframes slideInRight {
        from {
            transform: translateX(400px);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOutRight {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(400px);
            opacity: 0;
        }
    }
`;
document.head.appendChild(_obAnimStyle);

// DÍAS FESTIVOS / SERVICIOS / TRABAJADORES (wizard del agente)
// reinitializeOnboardingEvents() (aquí y en dashboard.js/my-agents.js/integrations.js)
// siempre llamó a initializeHolidays/initializeServices/initializeWorkers de forma
// defensiva (typeof === 'function') pero esas funciones nunca existieron en ningún
// archivo — por eso los botones "Agregar" no hacían nada. Se agregan aquí: como
// onboarding.js se carga (directo o inyectado dinámicamente) en las 4 superficies
// antes de llamar reinitializeOnboardingEvents, quedan disponibles en las 4 sin
// tocar los otros archivos. No se reutilizan los nombres de my-business.js
// (addServiceItem, addWorkerItem, addHoliday, removeItem, etc.) porque my-business.js
// también carga onboarding.js dinámicamente (para el modal de QR) — usar los mismos
// nombres globales pisaría las funciones reales de Mi Negocio si ambos scripts
// conviven en la página.
// ============================================

function initializeHolidays() {
    const btn = document.getElementById('addHolidayBtn');
    if (!btn || btn.dataset.obWired) return;
    btn.dataset.obWired = '1';
    btn.addEventListener('click', () => _obAddHolidayRow());
}

function _obAddHolidayRow(data) {
    const list = document.getElementById('holidaysList');
    if (!list) return;
    const row = document.createElement('div');
    row.className = 'holiday-item';
    row.innerHTML = `
        <input type="date" class="form-input holiday-date" value="${data?.date || ''}">
        <input type="text" class="form-input holiday-name" placeholder="${t('onb_hol_name_ph','Nombre del día festivo')}" value="${(data?.name || '').replace(/"/g, '&quot;')}">
        <button type="button" class="btn-remove-holiday" title="${t('onb_remove_item','Eliminar')}">
            <i class="lni lni-trash-can"></i>
        </button>
    `;
    row.querySelector('.btn-remove-holiday').addEventListener('click', () => row.remove());
    list.appendChild(row);
}

function initializeServices() {
    const btn = document.getElementById('addServiceBtn');
    if (!btn || btn.dataset.obWired) return;
    btn.dataset.obWired = '1';
    btn.addEventListener('click', () => _obAddServiceRow());
}

function _obRenumberServices() {
    const list = document.getElementById('servicesList');
    if (!list) return;
    list.querySelectorAll('.service-item .service-number').forEach((el, idx) => {
        el.textContent = `${t('onb_svc_label','Servicio')} #${idx + 1}`;
    });
}

function _obAddServiceRow(data) {
    const list = document.getElementById('servicesList');
    if (!list) return;
    const isPromo = data?.priceType === 'promo';
    const item = document.createElement('div');
    item.className = 'service-item';
    item.innerHTML = `
        <div class="service-header">
            <span class="service-number"></span>
            <button type="button" class="btn-remove-service" title="${t('onb_remove_item','Eliminar')}">
                <i class="lni lni-trash-can"></i>
            </button>
        </div>
        <div class="service-fields">
            <input type="text" class="form-input service-title" placeholder="${t('onb_svc_name_ph','Nombre del servicio o producto')}" value="${(data?.title || '').replace(/"/g, '&quot;')}">
            <div class="price-input-wrapper">
                <span class="price-currency">$</span>
                <input type="number" min="0" step="0.01" class="form-input price-input service-price" placeholder="${t('onb_svc_price_ph','Precio')}" value="${data?.price ?? ''}">
            </div>
            <div class="price-type-selector">
                <div class="price-type-option${isPromo ? '' : ' active'}" data-type="normal">${t('onb_svc_price_normal','Precio normal')}</div>
                <div class="price-type-option${isPromo ? ' active' : ''}" data-type="promo">${t('onb_svc_price_promo','En promoción')}</div>
            </div>
            <div class="promotion-prices${isPromo ? ' show' : ''}">
                <input type="number" min="0" step="0.01" class="form-input service-price-original" placeholder="${t('onb_svc_price_original','Precio original')}" value="${data?.originalPrice ?? ''}">
                <input type="number" min="0" step="0.01" class="form-input service-price-promo" placeholder="${t('onb_svc_price_promo_val','Precio en promoción')}" value="${data?.promoPrice ?? ''}">
            </div>
            <div class="service-description-editor">
                <div class="service-editor-toolbar">
                    <button type="button" class="service-editor-btn" data-cmd="bold" title="${t('onb_editor_bold','Negrita')}"><i class="lni lni-text-format"></i></button>
                    <button type="button" class="service-editor-btn" data-cmd="italic" title="${t('onb_editor_italic','Cursiva')}"><i class="lni lni-italic"></i></button>
                    <button type="button" class="service-editor-btn" data-cmd="insertUnorderedList" title="${t('onb_editor_list','Lista')}"><i class="lni lni-list"></i></button>
                </div>
                <div class="service-editor-content" contenteditable="true" data-placeholder="${t('onb_svc_desc_ph','Descripción (opcional)')}">${data?.description || ''}</div>
            </div>
        </div>
    `;
    item.querySelector('.btn-remove-service').addEventListener('click', () => { item.remove(); _obRenumberServices(); });
    const options = item.querySelectorAll('.price-type-option');
    const promoBox = item.querySelector('.promotion-prices');
    options.forEach(opt => {
        opt.addEventListener('click', () => {
            options.forEach(o => o.classList.remove('active'));
            opt.classList.add('active');
            promoBox.classList.toggle('show', opt.dataset.type === 'promo');
        });
    });
    item.querySelectorAll('.service-editor-btn').forEach(tbtn => {
        tbtn.addEventListener('click', () => {
            item.querySelector('.service-editor-content').focus();
            document.execCommand(tbtn.dataset.cmd, false, null);
        });
    });
    list.appendChild(item);
    _obRenumberServices();
}

function initializeWorkers() {
    const btn = document.getElementById('addWorkerBtn');
    if (!btn || btn.dataset.obWired) return;
    btn.dataset.obWired = '1';
    btn.addEventListener('click', () => _obAddWorkerRow());
}

function _obRenumberWorkers() {
    const list = document.getElementById('workersList');
    if (!list) return;
    list.querySelectorAll('.worker-item .worker-number').forEach((el, idx) => {
        el.textContent = `${t('onb_wkr_label','Trabajador')} #${idx + 1}`;
    });
}

function _obAddWorkerRow(data) {
    const list = document.getElementById('workersList');
    if (!list) return;
    // Declarado local (no a nivel de archivo) a propósito: este mismo bloque
    // se duplica en onboarding.js/dashboard.js/my-agents.js/integrations.js —
    // un const/let a nivel de archivo repetido en 2 scripts que conviven en
    // la misma página revienta con "Identifier ya declarado" (SyntaxError),
    // igual que pasó con STATUS_BADGE_KEY_MAP. Dentro de una función no hay ese riesgo.
    const weekDays = [
        { key: 'monday',    label: () => t('day_monday','Lunes') },
        { key: 'tuesday',   label: () => t('day_tuesday','Martes') },
        { key: 'wednesday', label: () => t('day_wednesday','Miércoles') },
        { key: 'thursday',  label: () => t('day_thursday','Jueves') },
        { key: 'friday',    label: () => t('day_friday','Viernes') },
        { key: 'saturday',  label: () => t('day_saturday','Sábado') },
        { key: 'sunday',    label: () => t('day_sunday','Domingo') },
    ];
    const checkedDays = data?.days || ['monday','tuesday','wednesday','thursday','friday'];
    const daysHTML = weekDays.map(d => `
        <label class="availability-day">
            <input type="checkbox" value="${d.key}" ${checkedDays.includes(d.key) ? 'checked' : ''}>
            <span>${d.label()}</span>
        </label>
    `).join('');
    const item = document.createElement('div');
    item.className = 'worker-item';
    item.innerHTML = `
        <div class="worker-header">
            <span class="worker-number"></span>
            <button type="button" class="btn-remove-worker" title="${t('onb_remove_item','Eliminar')}">
                <i class="lni lni-trash-can"></i>
            </button>
        </div>
        <div class="worker-fields">
            <input type="text" class="form-input worker-name" placeholder="${t('onb_wkr_name_ph','Nombre del trabajador')}" value="${(data?.name || '').replace(/"/g, '&quot;')}">
            <div class="worker-availability">
                <div class="availability-title">${t('onb_wkr_availability','Disponibilidad')}</div>
                <div class="availability-grid">${daysHTML}</div>
            </div>
            <div class="worker-hours">
                <input type="time" class="form-input worker-start" value="${data?.startTime || '09:00'}">
                <input type="time" class="form-input worker-end" value="${data?.endTime || '18:00'}">
            </div>
        </div>
    `;
    item.querySelector('.btn-remove-worker').addEventListener('click', () => { item.remove(); _obRenumberWorkers(); });
    list.appendChild(item);
    _obRenumberWorkers();
}

// ============================================
// PERSONALIDAD DEL AGENTE (tono + editor de tono personalizado)
// ============================================

function initializeToneSelection() {
    const options = document.querySelectorAll('.tone-radio-option');
    const customEditor = document.getElementById('customToneEditor');
    if (!options.length) return;

    function applySelection(value) {
        options.forEach(opt => {
            const input = opt.querySelector('input[type="radio"]');
            opt.classList.toggle('selected', !!input && input.value === value);
        });
        if (customEditor) customEditor.classList.toggle('show', value === 'custom');
    }

    options.forEach(opt => {
        const input = opt.querySelector('input[type="radio"]');
        if (!input || input.dataset.obWired) return;
        input.dataset.obWired = '1';
        input.addEventListener('change', () => applySelection(input.value));
    });

    const checked = document.querySelector('input[name="tone"]:checked');
    applySelection(checked ? checked.value : 'formal');
}

function initializeRichEditor() {
    const content = document.getElementById('editorContent');
    if (!content) return;
    const buttons = {
        boldBtn: 'bold',
        italicBtn: 'italic',
        underlineBtn: 'underline',
        listBtn: 'insertUnorderedList',
    };
    Object.keys(buttons).forEach(id => {
        const btn = document.getElementById(id);
        if (!btn || btn.dataset.obWired) return;
        btn.dataset.obWired = '1';
        btn.addEventListener('click', () => {
            content.focus();
            document.execCommand(buttons[id], false, null);
        });
    });
}

// ============================================
// HORARIOS DE ATENCIÓN (activar/desactivar día)
// ============================================

function initializeSchedule() {
    const days = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
    days.forEach(day => {
        const toggle = document.getElementById(`${day}Toggle`);
        const dayRow = document.querySelector(`.schedule-day[data-day="${day}"]`);
        const startInput = document.getElementById(`${day}Start`);
        const endInput = document.getElementById(`${day}End`);
        if (!toggle || toggle.dataset.obWired) return;
        toggle.dataset.obWired = '1';

        function applyState() {
            const open = toggle.checked;
            if (dayRow) dayRow.classList.toggle('closed', !open);
            if (startInput) startInput.disabled = !open;
            if (endInput) endInput.disabled = !open;
        }
        toggle.addEventListener('change', applyState);
        applyState();
    });
}

// ============================================
// MENÚ / CATÁLOGO (subir PDF o imagen)
// Reutiliza el mismo endpoint que ya usa Mi Negocio (/api/upload/menu) — los
// IDs aquí van prefijados "ob-" (ya venían así en onboarding.html) para no
// chocar con los de my-business.html si ambos scripts llegan a convivir.
// ============================================

function initializeMenu() {
    const area = document.getElementById('ob-menuUploadArea');
    const fileInput = document.getElementById('ob-menuFileInput');
    const placeholder = document.getElementById('ob-menuUploadPlaceholder');
    const btnRemove = document.getElementById('ob-btnRemoveMenu');
    if (!area || !fileInput || area.dataset.obWired) return;
    area.dataset.obWired = '1';

    placeholder?.addEventListener('click', () => fileInput.click());

    area.addEventListener('dragover', e => { e.preventDefault(); area.classList.add('menu-drag-over'); });
    area.addEventListener('dragleave', () => area.classList.remove('menu-drag-over'));
    area.addEventListener('drop', e => {
        e.preventDefault();
        area.classList.remove('menu-drag-over');
        const file = e.dataTransfer.files[0];
        if (file) _obHandleMenuFile(file);
    });

    fileInput.addEventListener('change', () => {
        if (fileInput.files[0]) _obHandleMenuFile(fileInput.files[0]);
    });

    btnRemove?.addEventListener('click', () => {
        document.getElementById('ob-menuUrlInput').value = '';
        document.getElementById('ob-menuFilePreview').style.display = 'none';
        document.getElementById('ob-menuUploadPlaceholder').style.display = '';
        const v = document.getElementById('ob-menuFileViewer');
        if (v) { v.style.display = 'none'; v.innerHTML = ''; }
        fileInput.value = '';
    });
}

async function _obHandleMenuFile(file) {
    const maxMB = 10;
    if (file.size > maxMB * 1024 * 1024) {
        if (typeof showNotification === 'function') showNotification(`El archivo supera ${maxMB}MB`, 'error');
        return;
    }

    const isPdf = file.type === 'application/pdf';
    document.getElementById('ob-menuFileIcon').className = isPdf ? 'lni lni-files' : 'lni lni-image';
    document.getElementById('ob-menuFileName').textContent = file.name;
    document.getElementById('ob-menuFileSize').textContent = (file.size / 1024).toFixed(0) + ' KB';
    document.getElementById('ob-menuUploadPlaceholder').style.display = 'none';
    document.getElementById('ob-menuFilePreview').style.display = '';

    const viewer = document.getElementById('ob-menuFileViewer');
    const localUrl = URL.createObjectURL(file);
    if (viewer) {
        viewer.style.display = '';
        viewer.innerHTML = isPdf
            ? `<iframe src="${localUrl}" style="width:100%;height:260px;border:none;"></iframe>`
            : `<img src="${localUrl}" style="max-width:100%;border-radius:8px;">`;
    }

    const progress = document.getElementById('ob-menuUploadProgress');
    const bar = document.getElementById('ob-menuProgressBar');
    if (progress) progress.style.display = '';
    if (bar) bar.style.width = '0%';

    try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('type', isPdf ? 'pdf' : 'image');

        let pct = 0;
        const tick = setInterval(() => {
            pct = Math.min(pct + 10, 85);
            if (bar) bar.style.width = pct + '%';
        }, 150);

        // Todavía no existe el agente/sucursal en este punto del wizard —
        // branch_id=0, igual que el fallback que ya usa Mi Negocio cuando
        // no hay sucursal activa.
        const resp = await fetch('/api/upload/menu?branch_id=0', {
            method: 'POST',
            credentials: 'include',
            body: formData
        });

        clearInterval(tick);
        if (!resp.ok) throw new Error('Error al subir el menú');
        const data = await resp.json();
        const url = data.url || data.menuUrl || '';

        if (bar) bar.style.width = '100%';
        const urlInput = document.getElementById('ob-menuUrlInput');
        if (urlInput) urlInput.value = url;
        setTimeout(() => { if (progress) progress.style.display = 'none'; }, 500);
        if (typeof showNotification === 'function') showNotification(t('onb_menu_uploaded','Menú subido correctamente'), 'success');
    } catch (err) {
        console.error('❌ Error subiendo menú (onboarding):', err);
        if (progress) progress.style.display = 'none';
        document.getElementById('ob-menuFilePreview').style.display = 'none';
        document.getElementById('ob-menuUploadPlaceholder').style.display = '';
        if (typeof showNotification === 'function') showNotification(t('onb_menu_upload_error','Error al subir el menú'), 'error');
    }
}