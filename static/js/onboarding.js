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

// NOTA: este archivo NO define showNotification() a propósito. dashboard.js,
// my-agents.js e integrations.js ya tienen cada uno su propia versión (la de
// my-agents.js envuelve el toast real de Sileo). Como onboarding.js se carga
// dinámicamente ENCIMA de esas páginas, si yo declarara aquí mi propia
// función `showNotification` (aunque fuera para verse igual), pisaría
// silenciosamente la de la página — que es justo lo que pasaba: al abrir el
// modal se perdía el toast de Sileo y aparecía un cuadro verde genérico en
// su lugar. Todo el código de este archivo ya llama con
// `if (typeof showNotification === 'function') showNotification(...)`,
// así que sin una definición propia usa automáticamente la de la página.

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

// Resuelve el branch_id real de la sucursal (mismo criterio que ya usa
// my-business.js: activeBranch.id si existe, o 0 si solo hay defaultBranch)
// — se cachea en window.agentData.branchId para no repetir el fetch y para
// que createAgent() también use el branch_id correcto en vez de 0 fijo.
async function _obResolveBranchId() {
    if (window.agentData && window.agentData.branchId) return window.agentData.branchId;
    let branchId = 0;
    try {
        const resp = await fetch('/api/my-business', { credentials: 'include' });
        if (resp.ok) {
            const data = await resp.json();
            if (data.activeBranch && data.activeBranch.id) {
                branchId = data.activeBranch.id;
            } else if (data.defaultBranch) {
                branchId = 0;
            }
        }
    } catch (e) {
        console.warn('No se pudo resolver branchId, usando 0:', e);
    }
    window.agentData = window.agentData || {};
    window.agentData.branchId = branchId;
    return branchId;
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

        // Se resuelve el branch_id real (activeBranch.id, o 0 si solo hay
        // defaultBranch) — antes iba fijo en 0, lo que podía subir el menú a
        // una sucursal equivocada si el negocio ya tenía una sucursal real.
        const branchIdForUpload = await _obResolveBranchId();
        const resp = await fetch(`/api/upload/menu?branch_id=${branchIdForUpload}`, {
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

// ============================================
// RESUMEN DE CONFIGURACIÓN (step3)
// _modalGoToResumen() (en dashboard.js/my-agents.js/integrations.js) ya
// llamaba a collectFormData() y generateSummary() antes de mostrar el
// resumen, pero ninguna de las dos existía en ningún archivo — por eso el
// recuadro de "Resumen de Configuración" siempre salía vacío.
// ============================================

function collectFormData() {
    window.agentData = window.agentData || {};
    const d = window.agentData;
    d.config = d.config || {};

    // Info. Negocio (precargada/solo lectura desde Mi Negocio)
    d.businessName = document.getElementById('businessNameInput')?.value || d.businessName || '';
    d.businessDesc = document.getElementById('businessDescInput')?.value || d.businessDesc || '';
    d.website = document.getElementById('websiteInput')?.value || d.website || '';
    d.emailContact = document.getElementById('emailContactInput')?.value || d.emailContact || '';

    // Info. Básica
    const agentNameInput = document.getElementById('agentName');
    if (agentNameInput) d.name = agentNameInput.value;
    const phoneToggle = document.getElementById('phoneToggle');
    if (phoneToggle) d.useDifferentPhone = phoneToggle.checked;
    if (d.useDifferentPhone) {
        const cc = document.getElementById('countryCode')?.value || '';
        const num = document.getElementById('phoneNumber')?.value || '';
        d.phoneNumber = (cc + num).trim();
    }
    d.config.additionalLanguages = Array.from(document.querySelectorAll('input[name="additionalLanguage"]:checked')).map(el => el.value);

    // Personalidad
    const toneChecked = document.querySelector('input[name="tone"]:checked');
    if (toneChecked) d.config.tone = toneChecked.value;
    const editorContent = document.getElementById('editorContent');
    if (editorContent) d.config.customTone = editorContent.innerText.trim();

    // Horarios
    const days = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
    d.config.schedule = d.config.schedule || {};
    days.forEach(day => {
        const toggle = document.getElementById(`${day}Toggle`);
        if (!toggle) return;
        d.config.schedule[day] = {
            open: toggle.checked,
            start: document.getElementById(`${day}Start`)?.value || '09:00',
            end: document.getElementById(`${day}End`)?.value || '18:00',
        };
    });

    // Días festivos
    d.config.holidays = Array.from(document.querySelectorAll('#holidaysList .holiday-item')).map(item => ({
        date: item.querySelector('.holiday-date')?.value || '',
        name: item.querySelector('.holiday-name')?.value || '',
    })).filter(h => h.date || h.name);

    // Servicios / Productos
    d.config.services = Array.from(document.querySelectorAll('#servicesList .service-item')).map(item => {
        const isPromo = !!item.querySelector('.price-type-option[data-type="promo"]')?.classList.contains('active');
        return {
            title: item.querySelector('.service-title')?.value || '',
            price: item.querySelector('.service-price')?.value || '',
            priceType: isPromo ? 'promo' : 'normal',
            originalPrice: item.querySelector('.service-price-original')?.value || '',
            promoPrice: item.querySelector('.service-price-promo')?.value || '',
            description: item.querySelector('.service-editor-content')?.innerText.trim() || '',
        };
    }).filter(s => s.title);

    // Trabajadores
    d.config.workers = Array.from(document.querySelectorAll('#workersList .worker-item')).map(item => ({
        name: item.querySelector('.worker-name')?.value || '',
        days: Array.from(item.querySelectorAll('.availability-day input:checked')).map(el => el.value),
        start: item.querySelector('.worker-start')?.value || '',
        end: item.querySelector('.worker-end')?.value || '',
    })).filter(w => w.name);

    // Menú / catálogo
    d.config.menuUrl = document.getElementById('ob-menuUrlInput')?.value || d.config.menuUrl || '';

    return d;
}

function generateSummary() {
    const container = document.getElementById('summaryContainer');
    if (!container) return;
    const d = window.agentData || {};
    const cfg = d.config || {};

    const DAY_LABELS = {
        monday: t('day_monday','Lunes'), tuesday: t('day_tuesday','Martes'),
        wednesday: t('day_wednesday','Miércoles'), thursday: t('day_thursday','Jueves'),
        friday: t('day_friday','Viernes'), saturday: t('day_saturday','Sábado'),
        sunday: t('day_sunday','Domingo'),
    };
    const TONE_LABELS = {
        formal: t('onb_tone_formal_title','Formal'),
        friendly: t('onb_tone_friendly_title','Amigable'),
        casual: t('onb_tone_casual_title','Casual'),
        custom: t('onb_tone_custom_title','Personalizado'),
    };

    function esc(s) { return (s === undefined || s === null ? '' : String(s)).replace(/</g, '&lt;'); }
    function item(label, value) {
        return `<div class="summary-item"><span class="summary-label">${esc(label)}</span><span class="summary-value">${esc(value) || '—'}</span></div>`;
    }

    let html = '';

    html += `<div class="summary-section">
        <div class="summary-section-title"><i class="lni lni-share-alt"></i>${t('onb_sum_social','Canal')}</div>
        ${item(t('onb_sum_social_type','Red social'), (window.selectedSocial || d.social || '').toUpperCase())}
    </div>`;

    html += `<div class="summary-section">
        <div class="summary-section-title"><i class="lni lni-information"></i>${t('onb_tab_basic','Info. Básica')}</div>
        ${item(t('onb_basic_agent_name_label','Nombre del Agente'), d.name)}
        ${d.useDifferentPhone ? item(t('onb_sum_phone','Teléfono'), d.phoneNumber) : ''}
        ${cfg.additionalLanguages?.length ? item(t('onb_lang_additional_label','Idiomas adicionales'), cfg.additionalLanguages.join(', ')) : ''}
    </div>`;

    if (d.businessName || d.businessDesc || d.website || d.emailContact) {
        html += `<div class="summary-section">
            <div class="summary-section-title"><i class="lni lni-briefcase"></i>${t('onb_sec_business','Información del Negocio')}</div>
            ${d.businessName ? item(t('onb_biz_name_label','Nombre del Negocio'), d.businessName) : ''}
            ${d.website ? item(t('onb_biz_website_label','Sitio Web'), d.website) : ''}
            ${d.emailContact ? item(t('onb_biz_email_label','Email de Contacto'), d.emailContact) : ''}
        </div>`;
    }

    html += `<div class="summary-section">
        <div class="summary-section-title"><i class="lni lni-comments"></i>${t('onb_sec_personality','Personalidad del Agente')}</div>
        ${item(t('onb_pers_tone_label','Tono de Conversación'), TONE_LABELS[cfg.tone] || cfg.tone)}
        ${cfg.tone === 'custom' && cfg.customTone ? item(t('onb_tone_custom_editor_label','Personalizado'), cfg.customTone) : ''}
    </div>`;

    if (cfg.schedule && Object.keys(cfg.schedule).length) {
        const lis = Object.keys(cfg.schedule).map(day => {
            const s = cfg.schedule[day];
            return `<li>${esc(DAY_LABELS[day] || day)}: ${s.open ? `${esc(s.start)} – ${esc(s.end)}` : t('onb_sum_closed','Cerrado')}</li>`;
        }).join('');
        html += `<div class="summary-section">
            <div class="summary-section-title"><i class="lni lni-calendar"></i>${t('onb_tab_schedule','Horarios')}</div>
            <ul class="summary-list">${lis}</ul>
        </div>`;
    }

    if (cfg.holidays?.length) {
        const lis = cfg.holidays.map(h => `<li>${esc(h.date)} — ${esc(h.name)}</li>`).join('');
        html += `<div class="summary-section">
            <div class="summary-section-title"><i class="lni lni-gift"></i>${t('onb_tab_holidays','Días Festivos')}</div>
            <ul class="summary-list">${lis}</ul>
        </div>`;
    }

    if (cfg.services?.length) {
        const lis = cfg.services.map(s => `<li>${esc(s.title)}${s.price ? ` — $${esc(s.price)}` : ''}</li>`).join('');
        html += `<div class="summary-section">
            <div class="summary-section-title"><i class="lni lni-package"></i>${t('onb_tab_services','Servicios / Productos')}</div>
            <ul class="summary-list">${lis}</ul>
        </div>`;
    }

    if (cfg.workers?.length) {
        const lis = cfg.workers.map(w => `<li>${esc(w.name)} — ${esc(w.start)} a ${esc(w.end)}</li>`).join('');
        html += `<div class="summary-section">
            <div class="summary-section-title"><i class="lni lni-users"></i>${t('onb_tab_workers','Trabajadores')}</div>
            <ul class="summary-list">${lis}</ul>
        </div>`;
    }

    if (cfg.menuUrl) {
        html += `<div class="summary-section">
            <div class="summary-section-title"><i class="lni lni-files"></i>${t('onb_sec_menu','Menú')}</div>
            ${item(t('onb_sum_menu_file','Archivo'), t('onb_sum_menu_uploaded','Subido correctamente'))}
        </div>`;
    }

    container.innerHTML = html || `<p style="text-align:center;color:#9ca3af;padding:2rem;">${t('onb_sum_empty','No hay información para mostrar todavía.')}</p>`;
}

// ============================================
// CREAR AGENTE (POST real)
// Contrato confirmado contra agent.go (CreateAgentRequest) y
// models/agent.go (AgentConfig/Service/Staff/Holiday/BusinessProfileInfo).
// Antes createAgent() se llamaba (envuelta varias veces en cada página) pero
// nunca existía en ningún archivo — el botón no hacía nada más que loguear
// "createAgent no definida".
// menuUrl NO se manda: AgentConfig no tiene ese campo, así que aunque se
// suba el archivo en el wizard, hoy no hay dónde persistirlo al crear el
// agente (el upload en sí sí funciona, solo no viaja en este payload).
// ============================================

async function createAgent() {
    if (typeof collectFormData === 'function') collectFormData();
    const d = window.agentData || {};
    const cfg = d.config || {};

    const name = (d.name || '').trim();
    if (!name) {
        if (typeof showNotification === 'function') showNotification(t('onb_err_name_required','Ingresa el nombre del agente'), 'error');
        if (typeof window._modalGoToSection === 'function') window._modalGoToSection('section-basic');
        return;
    }

    const branchId = await _obResolveBranchId();

    const payload = {
        name,
        phoneNumber: d.useDifferentPhone ? (d.phoneNumber || '') : '',
        businessType: d.businessType || '',
        branchId,
        social: (window.selectedSocial || d.social || '').toLowerCase(),
        config: {
            tone: cfg.tone || 'formal',
            customTone: cfg.tone === 'custom' ? (cfg.customTone || '') : '',
            additionalLanguages: cfg.additionalLanguages || [],
            specialInstructions: cfg.specialInstructions || '',
            schedule: cfg.schedule ? {
                monday:    cfg.schedule.monday    || { open: true,  start: '09:00', end: '18:00' },
                tuesday:   cfg.schedule.tuesday   || { open: true,  start: '09:00', end: '18:00' },
                wednesday: cfg.schedule.wednesday || { open: true,  start: '09:00', end: '18:00' },
                thursday:  cfg.schedule.thursday  || { open: true,  start: '09:00', end: '18:00' },
                friday:    cfg.schedule.friday    || { open: true,  start: '09:00', end: '18:00' },
                saturday:  cfg.schedule.saturday  || { open: false, start: '09:00', end: '14:00' },
                sunday:    cfg.schedule.sunday    || { open: false, start: '09:00', end: '14:00' },
            } : undefined,
            holidays: (cfg.holidays || []).map(h => ({ date: h.date, name: h.name })),
            services: (cfg.services || []).map(s => ({
                title: s.title,
                description: s.description || '',
                priceType: s.priceType || 'normal',
                price: s.price || '',
                originalPrice: s.originalPrice || null,
                promoPrice: s.promoPrice || null,
            })),
            workers: (cfg.workers || []).map(w => ({
                name: w.name,
                startTime: w.start || '',
                endTime: w.end || '',
                days: w.days || [],
            })),
            businessInfo: {
                description: d.businessDesc || '',
                website: d.website || '',
                email: d.emailContact || '',
            },
        },
    };

    const btn = document.getElementById('btnCreateAgent');
    const origHTML = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<div class="loading-spinner"></div><span>${t('onb_creating','Creando...')}</span>`;
    }

    try {
        const res = await fetch('/api/agents', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.message || data.error || t('onb_err_create','Error al crear el agente'));
        }

        if (typeof showNotification === 'function') {
            showNotification(t('onb_ok_created','¡Agente creado! Desplegando…'), 'success');
        }
        if (typeof closeOnboardingModal === 'function') closeOnboardingModal();

        const createdAgent = data.agent;
        if (createdAgent && createdAgent.id && typeof watchAgentDeployment === 'function') {
            watchAgentDeployment(createdAgent.id, createdAgent.name || name);
        }

        // Refrescar la lista/estadísticas de agentes en la página que esté activa
        if (typeof loadAgents === 'function') loadAgents();
        else if (typeof loadAgentStats === 'function') loadAgentStats();
        else if (typeof initAgentSelector === 'function') initAgentSelector();

    } catch (err) {
        console.error('❌ Error creando agente:', err);
        if (typeof showNotification === 'function') {
            showNotification(err.message || t('onb_err_create','Error al crear el agente'), 'error');
        }
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = origHTML; }
    }
}

// ============================================
// MODAL DE PROGRESO ("Creando tu Agente") + POLLING DE QR
// my-agents.js/my-business.js ya llaman a ensureModalsExist(),
// startQRPolling() y watchAgentRedeploy() (typeof === 'function', por eso
// nunca tronaban) esperando que onboarding.js las provea — igual que
// createAgent(), nunca existieron. Se agregan aquí. Se construyen con HTML
// propio (no dependen de #creatingModal/#successModal de onboarding.html,
// porque estas deben poder abrirse incluso con el wizard cerrado — ej. al
// detectar un WhatsApp sin vincular desde la tabla de Mis Agentes).
// ============================================

let _obDeployPollTimer = null;
let _obQRPollTimer = null;

function ensureModalsExist() {
    if (!document.getElementById('onboarding-css')) {
        const link = document.createElement('link');
        link.id = 'onboarding-css'; link.rel = 'stylesheet';
        link.href = '/static/css/onboarding.css';
        document.head.appendChild(link);
    }
    if (!document.getElementById('ob-modals-style')) {
        const style = document.createElement('style');
        style.id = 'ob-modals-style';
        style.textContent = `
            .ob-spinner{width:36px;height:36px;border:3px solid #e5e7eb;border-top-color:#06b6d4;border-radius:50%;animation:ob-spin .8s linear infinite;margin:0 auto;}
            @keyframes ob-spin{to{transform:rotate(360deg);}}
            .btn-close-onboarding{width:40px;height:40px;border-radius:50%;border:none;background:#f3f4f6;color:#6b7280;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0;transition:all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);}
            .btn-close-onboarding:hover{background:#fee2e2;color:#ef4444;transform:rotate(90deg) scale(1.1);box-shadow:0 4px 12px rgba(239, 68, 68, 0.2);}
            .btn-close-onboarding i{transition:all 0.3s ease;}
            .btn-close-onboarding:hover i{transform:scale(1.2);}
        `;
        document.head.appendChild(style);
    }
    if (!document.getElementById('agentCreatingModal')) {
        const div = document.createElement('div');
        div.id = 'agentCreatingModal';
        div.className = 'overlay creating-modal';
        div.innerHTML = `
            <div class="creating-content">
                <div class="creating-icon-wrapper">
                    <div class="creating-icon"><i class="lni lni-bot"></i></div>
                    <div class="pulse-ring"></div><div class="pulse-ring"></div><div class="pulse-ring"></div>
                </div>
                <h2 class="creating-title">${t('onb_creating_title','Creando tu Agente')}</h2>
                <p class="creating-subtitle">${t('onb_creating_subtitle','Configurando infraestructura y desplegando el bot')}</p>
                <div class="agent-info">
                    <div class="agent-info-label">${t('onb_creating_agent_label','Agente')}</div>
                    <div class="agent-info-value" id="agentCreatingName">—</div>
                </div>
                <div class="status-info">
                    <div class="current-status">
                        <i class="lni lni-cog status-icon"></i>
                        <span class="status-text" id="agentCreatingStatusText">${t('onb_creating_starting','Iniciando...')}</span>
                    </div>
                </div>
                <div class="creating-note">
                    <div class="creating-note-icon"><i class="lni lni-information"></i></div>
                    <p class="creating-note-text">${t('onb_creating_note','Este proceso puede tardar unos minutos.')}</p>
                </div>
            </div>
        `;
        document.body.appendChild(div);
    }
    if (!document.getElementById('agentQRModal')) {
        const div = document.createElement('div');
        div.id = 'agentQRModal';
        div.className = 'overlay creating-modal';
        div.innerHTML = `
            <div class="creating-content" style="max-width:520px;position:relative;">
                <button type="button" id="btnCloseQRModal" class="btn-close-onboarding" style="position:absolute;top:1rem;right:1rem;">
                    <i class="lni lni-close"></i>
                </button>
                <h2 class="creating-title" style="font-size:1.4rem;">${t('onb_qr_title','Vincula tu WhatsApp')}</h2>
                <p class="creating-subtitle" id="agentQRAgentName">—</p>
                <div id="agentQRImageWrap" style="display:flex;justify-content:center;align-items:center;min-height:260px;padding:1rem;overflow-x:auto;"></div>
                <p class="creating-note-text" style="text-align:center;">${t('onb_qr_help','Abre WhatsApp en tu teléfono → Dispositivos vinculados → Vincular un dispositivo, y escanea este código.')}</p>
            </div>
        `;
        document.body.appendChild(div);
        document.getElementById('btnCloseQRModal').addEventListener('click', () => {
            div.classList.remove('show');
            _obStopQRPolling();
        });
    }
}

function _obShowCreatingModal(agentName) {
    ensureModalsExist();
    const modal = document.getElementById('agentCreatingModal');
    const nameEl = document.getElementById('agentCreatingName');
    const statusEl = document.getElementById('agentCreatingStatusText');
    if (nameEl) nameEl.textContent = agentName || '';
    if (statusEl) statusEl.textContent = t('onb_creating_starting','Iniciando...');
    if (modal) modal.classList.add('show');
}

function _obHideCreatingModal() {
    const modal = document.getElementById('agentCreatingModal');
    if (modal) modal.classList.remove('show');
}

// Sondea /api/agents hasta que el deployStatus del agente sea 'running' (o
// 'error'). Al terminar bien: si es AtomicBot pasa automáticamente al QR;
// si no, solo notifica.
async function watchAgentDeployment(agentId, agentName) {
    _obShowCreatingModal(agentName);
    if (_obDeployPollTimer) clearInterval(_obDeployPollTimer);

    const poll = async () => {
        try {
            const res = await fetch('/api/agents', { credentials: 'include' });
            if (!res.ok) return;
            const data = await res.json();
            const agent = (data.agents || []).find(a => a.id === agentId);
            if (!agent) return;

            const statusEl = document.getElementById('agentCreatingStatusText');
            if (agent.deployStatus === 'running') {
                clearInterval(_obDeployPollTimer);
                _obDeployPollTimer = null;
                _obHideCreatingModal();
                if (agent.botType === 'atomic') {
                    startQRPolling(agentId, agentName);
                } else if (typeof showNotification === 'function') {
                    showNotification(t('onb_ok_deployed','¡Agente desplegado y listo!'), 'success');
                }
                if (typeof loadAgents === 'function') loadAgents();
            } else if (agent.deployStatus === 'error') {
                clearInterval(_obDeployPollTimer);
                _obDeployPollTimer = null;
                _obHideCreatingModal();
                if (typeof showNotification === 'function') {
                    showNotification(t('onb_err_deploy','Hubo un error desplegando el agente'), 'error');
                }
            } else if (statusEl) {
                statusEl.textContent = agent.deployStatus === 'deploying'
                    ? t('onb_creating_deploying','Desplegando bot...')
                    : t('onb_creating_pending','Preparando servidor...');
            }
        } catch (e) {
            console.warn('Error consultando estado del agente:', e);
        }
    };
    poll();
    _obDeployPollTimer = setInterval(poll, 3000);
}

// Redeploy manual (botón en Mis Agentes) usa el mismo modal/polling que la
// creación inicial — el usuario lo pidió a propósito, tiene sentido verlo.
function watchAgentRedeploy(agentId, agentName) {
    return watchAgentDeployment(agentId, agentName);
}

// Variante SOLO para el auto-redeploy silencioso de Mi Negocio al guardar
// ("sin pedir confirmación") — ahí el modal grande se siente pesado para
// algo que no pediste explícitamente, así que usa el toast de Sileo con
// progreso en su lugar. Si el bot es WhatsApp, al terminar sí abre el modal
// de QR (eso no cabe en un toast). my-business.js debe llamar a ESTA
// función, no a watchAgentRedeploy.
function watchAgentRedeployToast(agentId, agentName) {
    if (typeof Sileo === 'undefined' || typeof Sileo.progress !== 'function') {
        // Sin Sileo (o sin la versión nueva con barra de progreso) disponible
        // en esta página, se usa el modal como respaldo.
        return watchAgentDeployment(agentId, agentName);
    }

    const handle = Sileo.progress({
        title: t('onb_redeploy_loading_title','Actualizando agente'),
        state: 'info',
        initialText: t('onb_redeploy_step_pending','Preparando servidor...'),
    });
    handle.setProgress(10);

    let pollTimer = null;
    const STEP_PCT = {
        pending: 20,
        deploying: 65,
        running: 100,
    };
    const STEP_TEXT = {
        pending: () => t('onb_redeploy_step_pending','Preparando servidor...'),
        deploying: () => t('onb_redeploy_step_deploying','Desplegando bot...'),
        running: () => t('onb_redeploy_step_running','¡Listo!'),
    };

    const p = new Promise((resolve, reject) => {
        const poll = async () => {
            try {
                const res = await fetch('/api/agents', { credentials: 'include' });
                if (!res.ok) return;
                const data = await res.json();
                const agent = (data.agents || []).find(a => a.id === agentId);
                if (!agent) return;

                const pct = STEP_PCT[agent.deployStatus];
                const textFn = STEP_TEXT[agent.deployStatus];
                if (pct !== undefined) handle.setProgress(pct, textFn ? textFn() : undefined);

                if (agent.deployStatus === 'running') {
                    clearInterval(pollTimer);
                    resolve(agent);
                } else if (agent.deployStatus === 'error') {
                    clearInterval(pollTimer);
                    reject(new Error(t('onb_err_deploy','Hubo un error desplegando el agente')));
                }
            } catch (e) {
                console.warn('Error consultando estado del redeploy:', e);
            }
        };
        pollTimer = setInterval(poll, 3000);
        poll();
    });

    p.then((agent) => {
        handle.complete({
            title: t('onb_redeploy_success_title','Agente actualizado'),
            description: (agent && agent.botType === 'atomic')
                ? t('onb_redeploy_success_qr','Escanea el nuevo QR para reconectar WhatsApp')
                : t('onb_redeploy_success_desc','Los cambios ya están activos'),
        });
        if (typeof loadAgents === 'function') loadAgents();
        if (agent && agent.botType === 'atomic') startQRPolling(agentId, agentName);
    }).catch((err) => {
        handle.fail({
            title: t('onb_redeploy_error_title','Error al actualizar'),
            description: (err && err.message) || t('onb_err_deploy','Hubo un error desplegando el agente'),
        });
    });

    return p;
}

function _obStopQRPolling() {
    if (_obQRPollTimer) { clearInterval(_obQRPollTimer); _obQRPollTimer = null; }
}

async function startQRPolling(agentId, agentName) {
    ensureModalsExist();
    const modal = document.getElementById('agentQRModal');
    const nameEl = document.getElementById('agentQRAgentName');
    const wrap = document.getElementById('agentQRImageWrap');
    if (nameEl) nameEl.textContent = agentName || '';
    if (wrap) wrap.innerHTML = '<div class="ob-spinner"></div>';
    if (modal) modal.classList.add('show');

    _obStopQRPolling();
    let lastRawQR = null;
    const poll = async () => {
        try {
            const res = await fetch(`/api/agents/${agentId}/qr`, { credentials: 'include' });
            if (!res.ok) return;
            const data = await res.json();
            if (!wrap) return;

            if (data.connected) {
                _obStopQRPolling();
                wrap.innerHTML = `<div style="text-align:center;"><i class="lni lni-checkmark-circle" style="font-size:3rem;color:#10b981;"></i><p style="margin-top:1rem;font-weight:600;">${t('onb_qr_connected','¡WhatsApp conectado exitosamente!')}</p></div>`;
                if (typeof showNotification === 'function') showNotification(t('onb_qr_connected','¡WhatsApp conectado exitosamente!'), 'success');
                if (typeof loadAgents === 'function') loadAgents();
                setTimeout(() => modal.classList.remove('show'), 2500);
            } else if (data.qrCode) {
                if (data.qrCode === lastRawQR) return; // mismo código que ya está dibujado, no repintar
                lastRawQR = data.qrCode;

                const looksLikeImage = data.qrCode.startsWith('data:') || data.qrCode.startsWith('http');
                if (looksLikeImage) {
                    wrap.innerHTML = `<img src="${data.qrCode}" alt="QR" style="max-width:260px;width:100%;border-radius:12px;">`;
                } else {
                    // El backend manda el QR ya "dibujado" como ASCII art
                    // (bloques Unicode █▄▀▌ — ver GetQRCodeFromLogs en
                    // atomic_bot_deploy.go), no el string crudo a codificar.
                    // Se muestra tal cual en monoespaciada, no se genera nada.
                    const escaped = data.qrCode
                        .replace(/&/g, '&amp;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;');
                    wrap.innerHTML = `<div style="background:white;padding:24px;display:inline-block;border-radius:8px;"><pre style="font-family:'Courier New',monospace;font-size:6px;line-height:1;letter-spacing:0;white-space:pre;margin:0;background:white;color:black;">${escaped}</pre></div>`;
                }
            } else {
                wrap.innerHTML = `<div style="text-align:center;color:#6b7280;"><div class="ob-spinner"></div><p style="margin-top:0.75rem;">${t('onb_qr_generating','Generando código QR...')}</p></div>`;
            }
        } catch (e) {
            console.warn('Error consultando QR:', e);
        }
    };
    poll();
    _obQRPollTimer = setInterval(poll, 3000);
}