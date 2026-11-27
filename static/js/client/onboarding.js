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

// ============================================
// FUENTES DE VERDAD (reestructuración del wizard)
//   - Mi Negocio  → nombre, giro, ubicación, redes, horario, festivos,
//                   trabajadores, imágenes y menú.
//   - Inventario  → productos Y servicios (artículo con "Servicio" marcado);
//                   el bot los recibe vía GenerateBusinessConfig.
//   - Agente      → solo plataforma, nombre/teléfono/idiomas y personalidad.
// Para negocios el wizard ya NO captura ni reenvía horario/festivos/
// servicios/trabajadores: en el resumen se muestra un checklist de lo que
// el agente va a saber, con ligas a Mi Negocio / Inventario. El modo
// gobierno (Dependencia, Cursos, etc.) sigue con sus secciones de siempre.
// ============================================

function _obIsGov() {
    if (typeof window._obIsGovModal === 'boolean') return window._obIsGovModal;
    return (window.agentData?.businessType || '').toLowerCase().includes('gubernamental');
}

// DÍAS FESTIVOS / SERVICIOS (wizard del agente — hoy solo los usa el modo gobierno)
// reinitializeOnboardingEvents() (aquí y en dashboard.js/my-agents.js/integrations.js)
// siempre llamó a initializeHolidays/initializeServices de forma
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

// ============================================
// PERSONALIDAD DEL AGENTE (tono + editor de tono personalizado)
// ============================================

function initializeToneSelection() {
    const options = document.querySelectorAll('.tone-radio-option');
    const customEditor = document.getElementById('customToneEditor');
    if (!options.length) return;

    // Cada grupo (tono / modo de respuesta) marca solo sus opciones.
    function applySelection(value, name) {
        name = name || 'tone';
        options.forEach(opt => {
            const input = opt.querySelector('input[type="radio"]');
            if (!input || input.name !== name) return;
            opt.classList.toggle('selected', input.value === value);
        });
        if (name === 'tone' && customEditor) customEditor.classList.toggle('show', value === 'custom');
    }

    options.forEach(opt => {
        const input = opt.querySelector('input[type="radio"]');
        if (!input || input.dataset.obWired) return;
        input.dataset.obWired = '1';
        input.addEventListener('change', () => applySelection(input.value, input.name));
    });

    const checked = document.querySelector('input[name="tone"]:checked');
    applySelection(checked ? checked.value : 'formal', 'tone');
    const mode = document.querySelector('input[name="responseMode"]:checked');
    applySelection(mode ? mode.value : 'ai', 'responseMode');

    // Las páginas (dashboard/my-agents/integrations) solo llaman a
    // initializeToneSelection, así que el uploader de estilo se engancha aquí.
    initializeStyleSample();
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
// ESTILO DE RESPUESTA (.txt con conversaciones reales)
// El negocio sube un chat exportado de WhatsApp (o texto libre) y el agente
// imita cómo contestan. Todo se procesa aquí en el navegador: se detectan
// los participantes, el usuario elige quién es él, se ocultan nombres de
// clientes, teléfonos y correos, y se guarda un extracto (máx.
// STYLE_SAMPLE_MAX caracteres, lo más reciente) en agentData.config.styleSample.
// El backend lo vuelve a recortar (bots.clampStyleSample) y el bot lo pega
// en el prompt de personalidad como guía de estilo.
// ============================================

const STYLE_SAMPLE_MAX = 6000;
const STYLE_FILE_MAX_MB = 5;

// Android: "25/11/26, 16:47 - Nombre: mensaje"
// iPhone:  "[25/11/26, 4:47:12 p.m.] Nombre: mensaje"
const _OB_WA_LINE = /^‎?\[?(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?(?:[\s  ]?[ap]\.?[\s  ]?m\.?)?)\]?\s*(?:[-–]\s*)?([^:]{1,60}?):\s?(.*)$/i;
const _OB_WA_SKIP = /(<multimedia omitido>|<media omitted>|archivo adjunto|attached|imagen omitida|image omitted|sticker omitido|sticker omitted|audio omitido|audio omitted|video omitido|video omitted|se eliminó este mensaje|this message was deleted|eliminaste este mensaje|you deleted this message|mensaje editado|<se editó este mensaje>|null$)/i;
// Renglón que empieza con fecha/hora pero sin "Nombre:" = aviso del sistema (cifrado, grupo, etc.)
const _OB_WA_DATE = /^\u200e?\[?\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4},?\s+\d{1,2}:\d{2}/;

let _obStyleState = null; // { name, kind:'whatsapp'|'text', messages, senders, me, raw }

function _obMaskPrivate(text) {
    return text
        .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[correo]')
        .replace(/(\+?\d[\d\s().-]{7,}\d)/g, '[teléfono]');
}

function _obParseWhatsApp(raw) {
    const lines = raw.replace(/\r\n?/g, '\n').split('\n');
    const msgs = [];
    let matched = 0;
    for (const line of lines) {
        const m = line.match(_OB_WA_LINE);
        if (m) {
            matched++;
            msgs.push({ sender: m[3].replace(/^‎/, '').trim(), text: m[4] });
        } else if (_OB_WA_DATE.test(line)) {
            continue; // aviso del sistema: no se pega al mensaje anterior
        } else if (msgs.length && line.trim()) {
            msgs[msgs.length - 1].text += '\n' + line; // mensaje de varias líneas
        }
    }
    // Se considera chat de WhatsApp si la mayoría de los renglones con texto lo parecen
    const nonEmpty = lines.filter(l => l.trim()).length || 1;
    if (matched < 4 || matched / nonEmpty < 0.3) return null;

    const clean = msgs
        .map(m => ({ sender: m.sender, text: m.text.replace(/‎/g, '').trim() }))
        .filter(m => m.text && !_OB_WA_SKIP.test(m.text));

    const counts = {}, chars = {};
    clean.forEach(m => {
        counts[m.sender] = (counts[m.sender] || 0) + 1;
        chars[m.sender] = (chars[m.sender] || 0) + m.text.length;
    });
    // Orden por cuánto escribe cada quien: el negocio suele contestar más
    // largo que el cliente, así el primero es la mejor suposición de "tú".
    const senders = Object.keys(counts)
        .sort((a, b) => chars[b] - chars[a])
        .map(n => ({ name: n, count: counts[n] }));
    if (!senders.length) return null;
    return { messages: clean, senders };
}

// Arma el extracto "Cliente: … / Negocio: …" desde lo más reciente hacia
// atrás hasta llenar STYLE_SAMPLE_MAX, sin nombres de clientes.
function _obBuildStyleSample(state) {
    if (state.kind === 'text') {
        const txt = _obMaskPrivate(state.raw.trim());
        return txt.length > STYLE_SAMPLE_MAX ? txt.slice(-STYLE_SAMPLE_MAX) : txt;
    }
    const turns = [];
    state.messages.forEach(m => {
        const role = m.sender === state.me ? 'Negocio' : 'Cliente';
        const last = turns[turns.length - 1];
        if (last && last.role === role) last.text += '\n' + m.text;
        else turns.push({ role, text: m.text });
    });
    const blocks = turns.map(tn => `${tn.role}: ${_obMaskPrivate(tn.text)}`);
    const out = [];
    let size = 0;
    for (let i = blocks.length - 1; i >= 0; i--) {
        if (size + blocks[i].length + 2 > STYLE_SAMPLE_MAX) break;
        out.unshift(blocks[i]);
        size += blocks[i].length + 2;
    }
    // Que no empiece a media respuesta del negocio sin la pregunta del cliente
    while (out.length > 1 && out[0].startsWith('Negocio:') && out.length < blocks.length) out.shift();
    return out.join('\n\n');
}

function _obStyleStats(state, sample) {
    if (state.kind === 'text') {
        return t('onb_style_stats_text', 'Texto libre · {n} caracteres').replace('{n}', sample.length.toLocaleString());
    }
    const mine = (sample.match(/^Negocio:/gm) || []).length;
    return t('onb_style_stats_wa', 'Chat de WhatsApp · {n} respuestas tuyas como ejemplo').replace('{n}', mine);
}

function _obApplyStyleState() {
    const card = document.getElementById('styleFileCard');
    const placeholder = document.getElementById('styleUploadPlaceholder');
    window.agentData = window.agentData || {};
    const cfg = (window.agentData.config = window.agentData.config || {});

    if (!_obStyleState) {
        if (card) card.hidden = true;
        if (placeholder) placeholder.hidden = false;
        delete cfg.styleSample;
        delete cfg.styleSampleName;
        return;
    }

    const sample = _obBuildStyleSample(_obStyleState);
    cfg.styleSample = sample;
    cfg.styleSampleName = _obStyleState.name;

    if (placeholder) placeholder.hidden = true;
    if (card) card.hidden = false;
    document.getElementById('styleFileName').textContent = _obStyleState.name;
    document.getElementById('styleFileStats').textContent = _obStyleStats(_obStyleState, sample);
    document.getElementById('stylePreview').textContent = sample || t('onb_style_empty', 'No se encontraron mensajes tuyos en este chat.');

    const wrap = document.getElementById('styleSenderWrap');
    const opts = document.getElementById('styleSenderOptions');
    if (_obStyleState.kind === 'whatsapp' && _obStyleState.senders.length > 1) {
        wrap.hidden = false;
        opts.innerHTML = '';
        _obStyleState.senders.slice(0, 6).forEach(s => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'style-sender-chip' + (s.name === _obStyleState.me ? ' is-on' : '');
            b.innerHTML = `<span>${_obEsc(s.name)}</span><small>${s.count}</small>`;
            b.addEventListener('click', () => { _obStyleState.me = s.name; _obApplyStyleState(); });
            opts.appendChild(b);
        });
    } else if (wrap) {
        wrap.hidden = true;
    }
}

async function _obHandleStyleFile(file) {
    if (!file) return;
    const isTxt = /\.txt$/i.test(file.name) || file.type === 'text/plain';
    if (!isTxt) {
        if (typeof showNotification === 'function') showNotification(t('onb_style_err_type', 'Sube un archivo .txt'), 'error');
        return;
    }
    if (file.size > STYLE_FILE_MAX_MB * 1024 * 1024) {
        if (typeof showNotification === 'function') showNotification(t('onb_style_err_size', `El archivo supera ${STYLE_FILE_MAX_MB}MB`), 'error');
        return;
    }
    const raw = await file.text();
    const wa = _obParseWhatsApp(raw);
    if (wa) {
        // Por defecto "tú" = quien más escribe (ver _obParseWhatsApp); el
        // usuario lo puede cambiar con los chips.
        _obStyleState = { name: file.name, kind: 'whatsapp', messages: wa.messages, senders: wa.senders, me: wa.senders[0].name };
    } else {
        _obStyleState = { name: file.name, kind: 'text', raw };
    }
    _obApplyStyleState();
}

function initializeStyleSample() {
    const area = document.getElementById('styleUploadArea');
    const input = document.getElementById('styleFileInput');
    const placeholder = document.getElementById('styleUploadPlaceholder');
    if (!area || !input || area.dataset.obWired) return;
    area.dataset.obWired = '1';

    placeholder?.addEventListener('click', () => input.click());
    input.addEventListener('change', () => { _obHandleStyleFile(input.files[0]); input.value = ''; });
    area.addEventListener('dragover', e => { e.preventDefault(); area.classList.add('is-drag'); });
    area.addEventListener('dragleave', () => area.classList.remove('is-drag'));
    area.addEventListener('drop', e => {
        e.preventDefault();
        area.classList.remove('is-drag');
        _obHandleStyleFile(e.dataTransfer.files[0]);
    });
    document.getElementById('styleFileRemove')?.addEventListener('click', () => {
        _obStyleState = null;
        _obApplyStyleState();
    });

    // Si el wizard se vuelve a abrir con un extracto ya cargado, se muestra
    const cfg = window.agentData?.config;
    if (cfg?.styleSample && !_obStyleState) {
        _obStyleState = { name: cfg.styleSampleName || 'estilo.txt', kind: 'text', raw: cfg.styleSample };
        _obApplyStyleState();
    }
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
// SUCURSAL (branch_id real para crear el agente)
// ============================================

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

// ============================================
// RESUMEN DE CONFIGURACIÓN (step3)
// _modalGoToResumen() (en dashboard.js/my-agents.js/integrations.js) llama
// a collectFormData() y generateSummary() antes de mostrar el resumen.
// En negocios, arriba del resumen va el checklist "Lo que sabrá tu agente"
// (ver _obLoadReadiness / _obRenderReadiness más abajo).
// ============================================

function collectFormData() {
    window.agentData = window.agentData || {};
    const d = window.agentData;
    d.config = d.config || {};

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
    const modeChecked = document.querySelector('input[name="responseMode"]:checked');
    if (modeChecked) d.config.responseMode = modeChecked.value;
    const editorContent = document.getElementById('editorContent');
    if (editorContent) d.config.customTone = editorContent.innerText.trim();

    // Negocios: todo lo demás vive en Mi Negocio / Inventario — no se lee
    // de las secciones ocultas del wizard (si no, se mandarían los valores
    // por defecto del HTML y pisarían la sucursal).
    if (!_obIsGov()) {
        delete d.config.schedule;
        d.config.holidays = [];
        d.config.services = [];
        d.config.workers = [];
        return d;
    }

    // ── Solo modo gobierno ─────────────────────────────────────────────
    d.businessName = document.getElementById('businessNameInput')?.value || d.businessName || '';
    d.businessDesc = document.getElementById('businessDescInput')?.value || d.businessDesc || '';
    d.website = document.getElementById('websiteInput')?.value || d.website || '';
    d.emailContact = document.getElementById('emailContactInput')?.value || d.emailContact || '';

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

    d.config.holidays = Array.from(document.querySelectorAll('#holidaysList .holiday-item')).map(item => ({
        date: item.querySelector('.holiday-date')?.value || '',
        name: item.querySelector('.holiday-name')?.value || '',
    })).filter(h => h.date || h.name);

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

    d.config.workers = [];
    return d;
}

function _obEsc(s) {
    return (s === undefined || s === null ? '' : String(s))
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function generateSummary() {
    const container = document.getElementById('summaryContainer');
    if (!container) return;
    const d = window.agentData || {};
    const cfg = d.config || {};
    const gov = _obIsGov();

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

    const esc = _obEsc;
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

    html += `<div class="summary-section">
        <div class="summary-section-title"><i class="lni lni-comments"></i>${t('onb_sec_personality','Personalidad del Agente')}</div>
        ${item(t('onb_pers_tone_label','Tono de Conversación'), TONE_LABELS[cfg.tone] || cfg.tone)}
        ${cfg.tone === 'custom' && cfg.customTone ? item(t('onb_tone_custom_editor_label','Personalizado'), cfg.customTone) : ''}
        ${item('Modo de respuesta', cfg.responseMode === 'buttons' ? 'Con botones (sin IA)' : 'Con IA')}
        ${cfg.styleSample ? item(t('onb_style_summary','Estilo de respuesta'), cfg.styleSampleName || '.txt') : ''}
    </div>`;

    if (gov) {
        if (d.businessName || d.website || d.emailContact) {
            html += `<div class="summary-section">
                <div class="summary-section-title"><i class="lni lni-government"></i>${t('onb_tab_agency','Dependencia')}</div>
                ${d.businessName ? item(t('onb_biz_name_label','Nombre'), d.businessName) : ''}
                ${d.website ? item(t('onb_biz_website_label','Sitio Web'), d.website) : ''}
                ${d.emailContact ? item(t('onb_biz_email_label','Email de Contacto'), d.emailContact) : ''}
            </div>`;
        }
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
                <div class="summary-section-title"><i class="lni lni-gift"></i>${t('onb_tab_holidays_gov','Días Inhábiles')}</div>
                <ul class="summary-list">${lis}</ul>
            </div>`;
        }
        if (cfg.services?.length) {
            const lis = cfg.services.map(s => `<li>${esc(s.title)}${s.price ? ` — $${esc(s.price)}` : ''}</li>`).join('');
            html += `<div class="summary-section">
                <div class="summary-section-title"><i class="lni lni-graduation"></i>${t('onb_tab_courses','Cursos')}</div>
                <ul class="summary-list">${lis}</ul>
            </div>`;
        }
    }

    container.innerHTML = html;

    const readiness = document.getElementById('readinessContainer');
    if (readiness) {
        readiness.hidden = gov;
        if (!gov) _obRefreshReadiness();
        else _obSetCreateEnabled(true);
    }
}

// ============================================
// CHECKLIST "LO QUE SABRÁ TU AGENTE" (solo negocios)
// Lee /api/my-business y /api/inventario/articulos. Lo obligatorio (negocio
// guardado + horario) bloquea "Crear Agente": sin sucursal guardada el
// agente se crearía con branch_id 0 y GenerateBusinessConfig no tendría de
// dónde sacar nombre, horario ni ubicación.
// ============================================

let _obReadiness = null;
let _obReadinessFocusWired = false;

async function _obLoadReadiness() {
    const get = (url) => fetch(url, { credentials: 'include' })
        .then(r => (r.ok ? r.json() : null))
        .catch(() => null);
    const [biz, inv] = await Promise.all([get('/api/my-business'), get('/api/inventario/articulos')]);

    const b = biz?.activeBranch || null;
    const bizName = b?.business?.name || '';
    const openDays = b ? Object.values(b.schedule || {}).filter(day => day && day.isOpen).length : 0;
    const loc = b?.location || {};
    const locText = [loc.address, loc.number].filter(Boolean).join(' ') + (loc.city ? `${loc.address ? ', ' : ''}${loc.city}` : '');
    const workers = Array.isArray(b?.workers) ? b.workers.length : 0;
    const menuUrl = b?.business?.menuUrl || '';

    const offered = (inv?.items || []).filter(i => Number(i.precio_1) > 0 && !i.venta_oculta);
    const nSvc = offered.filter(i => i.servicio).length;
    const nProd = offered.length - nSvc;

    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

    const items = [
        {
            key: 'business', level: 'required', icon: 'lni-briefcase',
            title: t('onb_rd_business', 'Información del negocio'),
            ok: !!(b && b.id && bizName),
            okText: [bizName, b?.business?.typeName].filter(Boolean).join(' · '),
            missingText: t('onb_rd_business_missing', 'Guarda nombre y giro de tu negocio en Mi Negocio'),
            href: '/my-business',
        },
        {
            key: 'schedule', level: 'required', icon: 'lni-calendar',
            title: t('onb_rd_schedule', 'Horario de atención'),
            ok: !!(b && b.id) && openDays > 0,
            okText: plural(openDays, t('onb_rd_day', 'día abierto'), t('onb_rd_days', 'días abiertos')) + t('onb_rd_week', ' a la semana'),
            missingText: t('onb_rd_schedule_missing', 'Indica qué días y a qué hora atiendes'),
            href: '/my-business',
        },
        {
            key: 'inventory', level: 'recommended', icon: 'lni-package',
            title: t('onb_rd_inventory', 'Productos y servicios'),
            ok: offered.length > 0,
            okText: `${plural(nProd, t('onb_rd_product', 'producto'), t('onb_rd_products', 'productos'))} · ${plural(nSvc, t('onb_rd_service', 'servicio'), t('onb_rd_services', 'servicios'))}`,
            missingText: inv
                ? t('onb_rd_inventory_missing', 'Sin artículos con precio: el agente no podrá ofrecer ni cobrar nada')
                : t('onb_rd_inventory_error', 'No se pudo consultar el Inventario'),
            href: '/inventory/articulos',
        },
        {
            key: 'location', level: 'recommended', icon: 'lni-map-marker',
            title: t('onb_rd_location', 'Ubicación'),
            ok: !!(loc.address || loc.city),
            okText: locText,
            missingText: t('onb_rd_location_missing', 'Para que el agente pueda decir dónde estás'),
            href: '/my-business',
        },
        {
            key: 'workers', level: 'optional', icon: 'lni-users',
            title: t('onb_rd_workers', 'Trabajadores'),
            ok: workers > 0,
            okText: plural(workers, t('onb_rd_worker', 'persona'), t('onb_rd_workers_n', 'personas')),
            missingText: t('onb_rd_workers_missing', 'Para agendar citas con alguien en específico'),
            href: '/my-business',
        },
        {
            key: 'menu', level: 'optional', icon: 'lni-files',
            title: t('onb_rd_menu', 'Menú o catálogo'),
            ok: !!menuUrl,
            okText: t('onb_rd_menu_ok', 'Archivo subido'),
            missingText: t('onb_rd_menu_missing', 'PDF o imagen que el agente puede compartir'),
            href: '/my-business',
        },
    ];

    // Datos que createAgent() necesita y antes salían de las secciones ocultas
    window.agentData = window.agentData || {};
    if (b && b.id) window.agentData.branchId = b.id;
    if (!window.agentData.businessType && b?.business?.type) window.agentData.businessType = String(b.business.type).toLowerCase();

    _obReadiness = {
        items,
        ready: items.filter(i => i.level === 'required').every(i => i.ok),
    };
    return _obReadiness;
}

function _obRenderReadiness(state) {
    const box = document.getElementById('readinessContainer');
    if (!box) return;
    if (!state) {
        box.innerHTML = `<div class="readiness-loading"><div class="ob-spinner"></div><span>${t('onb_rd_loading', 'Revisando tu negocio…')}</span></div>`;
        return;
    }
    const LEVEL = {
        required: t('onb_rd_required', 'Obligatorio'),
        recommended: t('onb_rd_recommended', 'Recomendado'),
        optional: t('onb_rd_optional', 'Opcional'),
    };
    const done = state.items.filter(i => i.ok).length;
    const rows = state.items.map(i => {
        const cls = i.ok ? 'is-ok' : (i.level === 'required' ? 'is-missing' : (i.level === 'recommended' ? 'is-warn' : 'is-optional'));
        const statusIcon = i.ok ? 'lni-checkmark' : (i.level === 'required' ? 'lni-close' : (i.level === 'recommended' ? 'lni-warning' : 'lni-plus'));
        const action = i.ok
            ? `<a class="readiness-link" href="${i.href}" target="_blank" rel="noopener">${t('onb_rd_edit', 'Editar')}</a>`
            : (i.level === 'required'
                ? `<a class="readiness-link is-cta" href="${i.href}" target="_blank" rel="noopener">${t('onb_rd_complete', 'Completar')} <i class="lni lni-arrow-right"></i></a>`
                : `<a class="readiness-link is-soft" href="${i.href}" target="_blank" rel="noopener">${t('onb_rd_add', 'Agregar')} <i class="lni lni-arrow-right"></i></a>`);
        return `<li class="readiness-item ${cls}">
            <span class="readiness-status"><i class="lni ${statusIcon}"></i></span>
            <span class="readiness-icon"><i class="lni ${i.icon}"></i></span>
            <span class="readiness-body">
                <span class="readiness-title">${_obEsc(i.title)}${i.ok ? '' : `<span class="readiness-badge">${LEVEL[i.level]}</span>`}</span>
                <span class="readiness-detail">${_obEsc(i.ok ? i.okText : i.missingText)}</span>
            </span>
            ${action}
        </li>`;
    }).join('');

    box.innerHTML = `
        <div class="readiness-head">
            <div>
                <h3 class="readiness-heading"><i class="lni lni-bot"></i>${t('onb_rd_title', 'Lo que sabrá tu agente')}</h3>
                <p class="readiness-sub">${t('onb_rd_sub', 'El agente toma esta información de Mi Negocio e Inventario. Para cambiar algo, edítalo ahí.')}</p>
            </div>
            <button type="button" class="readiness-refresh" id="btnReadinessRefresh" title="${t('onb_rd_refresh', 'Actualizar')}">
                <i class="lni lni-reload"></i><span>${done}/${state.items.length}</span>
            </button>
        </div>
        <ul class="readiness-list">${rows}</ul>
        ${state.ready ? '' : `<div class="readiness-alert"><i class="lni lni-lock-alt"></i>${t('onb_rd_blocked', 'Completa lo obligatorio para poder crear tu agente.')}</div>`}
    `;
    box.querySelector('#btnReadinessRefresh')?.addEventListener('click', () => _obRefreshReadiness());
}

function _obSetCreateEnabled(enabled) {
    const btn = document.getElementById('btnCreateAgent');
    if (btn) btn.disabled = !enabled;
}

async function _obRefreshReadiness() {
    _obRenderReadiness(null);
    _obSetCreateEnabled(false);
    const state = await _obLoadReadiness();
    _obRenderReadiness(state);
    _obSetCreateEnabled(state.ready);

    // Las ligas abren Mi Negocio / Inventario en otra pestaña: al regresar
    // se vuelve a revisar solo, sin que el usuario tenga que dar clic.
    if (!_obReadinessFocusWired) {
        _obReadinessFocusWired = true;
        window.addEventListener('focus', () => {
            const step3 = document.getElementById('step3');
            const box = document.getElementById('readinessContainer');
            if (step3?.classList.contains('active') && box && !box.hidden) _obRefreshReadiness();
        });
    }
}

// ============================================
// CREAR AGENTE (POST real)
// Contrato confirmado contra agent.go (CreateAgentRequest) y
// models/agent.go (AgentConfig/Service/Staff/Holiday/BusinessProfileInfo).
// En negocios solo viajan nombre, teléfono, plataforma y personalidad: el
// resto lo arma GenerateBusinessConfig desde la sucursal (Mi Negocio) y el
// Inventario. Horario/festivos/servicios/trabajadores solo se mandan en
// modo gobierno (los sincroniza syncOnboardingToAgency).
// ============================================

async function createAgent() {
    if (typeof collectFormData === 'function') collectFormData();
    const d = window.agentData || {};
    const cfg = d.config || {};
    const gov = _obIsGov();

    const name = (d.name || '').trim();
    if (!name) {
        if (typeof showNotification === 'function') showNotification(t('onb_err_name_required','Ingresa el nombre del agente'), 'error');
        if (typeof window._modalGoToSection === 'function') window._modalGoToSection('section-basic');
        return;
    }

    if (!gov) {
        const state = await _obLoadReadiness();
        _obRenderReadiness(state);
        if (!state.ready) {
            _obSetCreateEnabled(false);
            if (typeof showNotification === 'function') showNotification(t('onb_rd_blocked', 'Completa lo obligatorio para poder crear tu agente.'), 'error');
            return;
        }
    }

    const branchId = await _obResolveBranchId();

    const payload = {
        name,
        phoneNumber: d.useDifferentPhone ? (d.phoneNumber || '') : '',
        businessType: d.businessType || '',
        branchId,
        social: (window.selectedSocial || d.social || '').toLowerCase(),
        // Telegram: el bot creado con "Conectar Telegram" (código; el token
        // nunca pasa por el navegador) o, plan B, el token de @BotFather.
        telegramConnectCode: ((window.selectedSocial || d.social || '').toLowerCase() === 'telegram')
            ? ((window.agentData || {}).telegramConnectCode || d.telegramConnectCode || '')
            : '',
        telegramToken: ((window.selectedSocial || d.social || '').toLowerCase() === 'telegram' && !((window.agentData || {}).telegramConnectCode))
            ? ((document.getElementById('telegramBotToken') || {}).value || d.telegramToken || '').replace(/\s+/g, '')
            : '',
        config: {
            tone: cfg.tone || 'formal',
            customTone: cfg.tone === 'custom' ? (cfg.customTone || '') : '',
            responseMode: cfg.responseMode || 'ai',
            additionalLanguages: cfg.additionalLanguages || [],
            specialInstructions: cfg.specialInstructions || '',
            styleSample: cfg.styleSample || '',
            styleSampleName: cfg.styleSample ? (cfg.styleSampleName || '') : '',
        },
    };

    if (gov) {
        Object.assign(payload.config, {
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
            businessInfo: {
                description: d.businessDesc || '',
                website: d.website || '',
                email: d.emailContact || '',
            },
        });
    }

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
            // Telegram: el bot del negocio (para abrirlo y probarlo).
            if (data.telegramBot && !((window.agentData || {}).telegramConnectCode)) {
                setTimeout(function () {
                    showNotification(t('onb_tg_ready', 'Tu bot de Telegram es') + ' ' + data.telegramBot + ' — t.me/' + String(data.telegramBot).replace(/^@/, ''), 'success');
                }, 1800);
            }
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
        link.href = '/static/css/client/onboarding.css';
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
// ============================================
// CAPA iOS 27 — pestañas de sección con la misma cápsula de Mi Negocio
// La barra #sectionNavigation la pintan dashboard.js / my-agents.js /
// integrations.js / my-business.js; aquí solo se le agrega la cápsula cian
// que usan las pestañas de Mi Negocio (mismos resortes, sin rebote de
// gelatina) hasta la pestaña activa. No toca la lógica de navegación.
// ============================================
(function () {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const wired = new WeakSet();

    function wire(nav) {
        if (!nav || wired.has(nav)) return;
        wired.add(nav);
        nav.classList.add('ob-seg');
        const thumb = document.createElement('span');
        thumb.className = 'ob-seg-thumb';
        thumb.setAttribute('aria-hidden', 'true');
        // Estilos esenciales en línea: funciona aunque el navegador tenga en
        // caché un onboarding.css anterior (las páginas lo inyectan sin versión)
        Object.assign(thumb.style, {
            position: 'absolute', top: '5px', bottom: '5px', left: '0', zIndex: '0',
            borderRadius: '999px', background: '#06b6d4', pointerEvents: 'none',
            boxShadow: '0 3px 8px rgba(6, 182, 212, 0.3), 0 1px 1px rgba(15, 23, 42, 0.04)',
            willChange: 'transform, width', opacity: '0',
        });
        if (getComputedStyle(nav).position === 'static') nav.style.position = 'relative';

        // Resortes: posición, ancho y escala (al presionar)
        const X = { v: 0, vel: 0, t: 0 }, W = { v: 0, vel: 0, t: 0 }, S = { v: 1, vel: 0, t: 1 };
        let raf = 0, last = 0, ready = false;
        const step = (s, k, d, dt) => { const a = -k * (s.v - s.t) - d * s.vel; s.vel += a * dt; s.v += s.vel * dt; };
        const atRest = (s, eps) => Math.abs(s.v - s.t) < eps && Math.abs(s.vel) < eps * 10;

        function render() {
            if (!ready) { thumb.style.opacity = '0'; return; }
            // Igual que las pestañas de Mi Negocio: se estira un poco mientras viaja
            const st = Math.min(Math.abs(X.vel) / 3000, 0.1);
            thumb.style.opacity = '1';
            thumb.style.width = `${W.v}px`;
            thumb.style.transform = `translateX(${X.v}px) scale(${S.v}, ${S.v * (1 - st)})`;
        }
        function tick(now) {
            const dt = Math.min((now - last) / 1000, 1 / 30); last = now;
            step(X, 420, 30, dt); step(W, 420, 30, dt); step(S, 600, 30, dt);
            render();
            if (atRest(X, 0.3) && atRest(W, 0.3) && atRest(S, 0.002)) { X.v = X.t; W.v = W.t; S.v = S.t; X.vel = W.vel = S.vel = 0; render(); raf = 0; return; }
            raf = requestAnimationFrame(tick);
        }
        function kick() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); } }

        function place(snap) {
            if (thumb.parentNode !== nav) nav.prepend(thumb);
            const a = nav.querySelector('.section-nav-btn.active');
            if (!a || !nav.offsetWidth) { ready = false; render(); return; }
            X.t = a.offsetLeft; W.t = a.offsetWidth;
            if (snap || !ready || reduce.matches) { X.v = X.t; W.v = W.t; X.vel = W.vel = 0; }
            ready = true;
            render();
            if (!reduce.matches) kick();
            // Mantiene visible la pestaña activa dentro del riel con scroll
            const pad = 16;
            if (a.offsetLeft < nav.scrollLeft + pad || a.offsetLeft + a.offsetWidth > nav.scrollLeft + nav.clientWidth - pad) {
                nav.scrollTo({ left: a.offsetLeft - nav.clientWidth / 2 + a.offsetWidth / 2, behavior: reduce.matches ? 'auto' : 'smooth' });
            }
        }

        nav.addEventListener('pointerdown', (e) => {
            if (e.target.closest('.section-nav-btn.active')) { S.t = 0.94; kick(); }
        });
        const release = () => { S.t = 1; kick(); };
        ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => nav.addEventListener(ev, release));

        // Se reacomoda cuando cambia la pestaña activa o se vuelven a pintar los botones
        let pending = false;
        new MutationObserver(() => {
            if (pending) return;
            pending = true;
            requestAnimationFrame(() => { pending = false; place(false); });
        }).observe(nav, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
        if (window.ResizeObserver) new ResizeObserver(() => place(true)).observe(nav);
        place(true);
    }

    // Las páginas que abren el asistente como modal inyectan onboarding.css sin
    // versión; se cambia por la versión actual para no quedarse con la de caché.
    const OB_CSS_VERSION = '7';
    function freshCss() {
        document.querySelectorAll('link[rel="stylesheet"][href*="/static/css/client/onboarding.css"]').forEach((l) => {
            const href = l.getAttribute('href');
            if (href.includes('v=' + OB_CSS_VERSION)) return;
            l.setAttribute('href', '/static/css/client/onboarding.css?v=' + OB_CSS_VERSION);
        });
    }
    function scan() {
        freshCss();
        document.querySelectorAll('#sectionNavigation, .section-navigation').forEach(wire);
    }
    // El wizard puede inyectarse después (modal en Dashboard, Mis Agentes, etc.)
    function start() {
        scan();
        new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();

// ============================================================================
// iOS PICKERS — selector de hora (ruedas) y de fecha (calendario) con resortes
// Mismo diseño y animación que Mi Negocio, empaquetado para usarse en
// cualquier página (modal de onboarding en Mis Agentes, Dashboard, etc.).
//
// - El <input type="time|date"> original se queda en el DOM (oculto) y sigue
//   guardando el valor HH:MM / AAAA-MM-DD, así que la lógica que lo lee no cambia.
// - Si otro script escribe input.value o input.disabled, el picker se actualiza.
// - Los popovers van en <body> con position:fixed para que no los recorte
//   el overflow de .content-card ni el scroll del modal.
// - Clases con prefijo iosp- para no chocar con onboarding.css.
//
// Se aplica solo a:
//   .schedule-day input.time-input, input[data-ios-time]
//   input.holiday-date, input[data-ios-date]
// API: window.IOSPickers.enhance(root)
// ============================================================================
(function () {
    if (window.IOSPickers) return;

    const TIME_SEL = '.schedule-day input.time-input, input[data-ios-time]';
    const DATE_SEL = 'input.holiday-date, input[data-ios-date]';
    const ITEM_H = 36;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
    const lerp = (a, b, t) => a + (b - a) * t;
    const SUPPORTS_LINEAR = window.CSS && CSS.supports('animation-timing-function', 'linear(0, 1)');
    const SPRING = SUPPORTS_LINEAR
        ? 'linear(0, 0.04, 0.139, 0.271, 0.416, 0.56, 0.691, 0.805, 0.897, 0.969, 1.021, 1.055, 1.074, 1.082, 1.081, 1.075, 1.065, 1.053, 1.041, 1.03, 1.02, 1.011, 1.005, 1, 0.996, 0.994, 0.993, 0.993, 0.994, 0.994, 0.995, 0.996, 0.997, 0.998, 0.999, 0.999, 1, 1, 1, 1.001, 1.001, 1.001, 1.001, 1, 1, 1, 1, 1, 1)'
        : 'cubic-bezier(0.34, 1.35, 0.64, 1)';

    const tr = (key, fallback) => (typeof window.t === 'function' ? window.t(key, fallback) : fallback);

    // ------------------------------------------------------------------------
    // Motor de resortes
    // ------------------------------------------------------------------------
    const springs = [];
    const renderers = new Set();
    function spring(v = 0, k = 380, d = 30, eps = 0.1) {
        const s = { v, vel: 0, t: v, k, d, eps };
        springs.push(s);
        return s;
    }
    const atRest = (s) => Math.abs(s.v - s.t) < s.eps && Math.abs(s.vel) < s.eps * 5;
    let raf = 0, last = 0;
    function tick(now) {
        const dt = Math.min((now - last) / 1000, 1 / 30);
        last = now;
        springs.forEach((s) => {
            if (reduce.matches) { s.v = s.t; s.vel = 0; return; }
            s.vel += (-s.k * (s.v - s.t) - s.d * s.vel) * dt;
            s.v += s.vel * dt;
        });
        renderers.forEach((r) => r());
        if (springs.every(atRest)) {
            springs.forEach((s) => { s.v = s.t; s.vel = 0; });
            renderers.forEach((r) => r());
            raf = 0;
            return;
        }
        raf = requestAnimationFrame(tick);
    }
    function kick() {
        if (raf) return;
        last = performance.now();
        raf = requestAnimationFrame(tick);
    }

    // ------------------------------------------------------------------------
    // Input nativo: escribir sin disparar el setter interceptado y vigilar
    // cambios de value/disabled hechos por otros scripts.
    // ------------------------------------------------------------------------
    const VALUE = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    const DISABLED = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'disabled');

    function watchNative(input, onChange) {
        Object.defineProperty(input, 'value', {
            configurable: true,
            get() { return VALUE.get.call(this); },
            set(v) { VALUE.set.call(this, v); onChange(); },
        });
        Object.defineProperty(input, 'disabled', {
            configurable: true,
            get() { return DISABLED.get.call(this); },
            set(v) { DISABLED.set.call(this, v); onChange(); },
        });
        new MutationObserver(onChange).observe(input, { attributes: true, attributeFilter: ['disabled', 'value'] });
    }

    function writeNative(input, v) {
        VALUE.set.call(input, v);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // ------------------------------------------------------------------------
    // Popover compartido: crece desde el campo con un recorte animado
    // ------------------------------------------------------------------------
    const popovers = new Set();

    function createPopover(className) {
        const pop = document.createElement('div');
        pop.className = `iosp-pop ${className}`;
        pop.setAttribute('role', 'dialog');
        pop.style.visibility = 'hidden';
        pop.style.clipPath = 'inset(50% 50% 50% 50%)';
        document.body.appendChild(pop);

        const P = spring(0, 380, 28, 0.001);
        const state = { open: false, anchor: null, onClose: null };

        function place() {
            const a = state.anchor;
            if (!a || !a.isConnected) return;
            const r = a.getBoundingClientRect();
            const w = pop.offsetWidth, h = pop.offsetHeight;
            const gap = 8, vw = window.innerWidth, vh = window.innerHeight;
            let top = r.bottom + gap;
            if (top + h > vh - gap && r.top - gap - h > gap) top = r.top - gap - h;
            const left = clamp(r.left, gap, Math.max(gap, vw - w - gap));
            pop.style.top = `${Math.round(top)}px`;
            pop.style.left = `${Math.round(left)}px`;
        }

        function render() {
            const p = P.v, pc = clamp(p);
            if (p < 0.002 && P.t === 0) {
                pop.style.visibility = 'hidden';
                pop.style.clipPath = 'inset(50% 50% 50% 50%)';
                return;
            }
            pop.style.visibility = 'visible';
            pop.style.setProperty('--iosp-p', pc.toFixed(3));
            if (state.open && atRest(P)) { pop.style.clipPath = 'none'; return; }
            const a = state.anchor && state.anchor.isConnected ? state.anchor.getBoundingClientRect() : null;
            const m = pop.getBoundingClientRect();
            if (!a) { pop.style.clipPath = `inset(0 round 20px)`; pop.style.opacity = pc; return; }
            const W = m.width, H = m.height;
            const t = clamp(a.top - m.top, 0, H), b = clamp(m.bottom - a.bottom, 0, H);
            const l = clamp(a.left - m.left, 0, W), r = clamp(m.right - a.right, 0, W);
            pop.style.clipPath = `inset(${lerp(t, 0, p)}px ${lerp(r, 0, p)}px ${lerp(b, 0, p)}px ${lerp(l, 0, p)}px round ${lerp(a.height / 2, 20, pc)}px)`;
        }
        renderers.add(render);

        const api = {
            el: pop,
            get open() { return state.open; },
            get anchor() { return state.anchor; },
            show(anchor, onClose) {
                popovers.forEach((o) => o !== api && o.hide());
                if (state.open && state.anchor !== anchor) state.onClose && state.onClose();
                state.anchor = anchor;
                state.onClose = onClose;
                state.open = true;
                place();
                P.t = 1;
                render();
                kick();
            },
            hide() {
                if (!state.open) return;
                state.open = false;
                const cb = state.onClose;
                state.onClose = null;
                P.t = 0;
                render();
                kick();
                cb && cb();
            },
            place,
            contains: (n) => pop.contains(n) || (state.anchor && state.anchor.contains(n)),
        };
        popovers.add(api);
        return api;
    }

    document.addEventListener('pointerdown', (e) => {
        popovers.forEach((p) => { if (p.open && !p.contains(e.target)) p.hide(); });
    }, true);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') popovers.forEach((p) => p.hide());
    });
    function reposition(e) {
        popovers.forEach((p) => {
            if (!p.open) return;
            if (e && e.target && p.el.contains(e.target)) return;   // scroll de las ruedas
            const a = p.anchor;
            if (!a || !a.isConnected) { p.hide(); return; }
            const r = a.getBoundingClientRect();
            if (r.bottom < 0 || r.top > window.innerHeight) { p.hide(); return; }
            p.place();
        });
    }
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);

    // ========================================================================
    // SELECTOR DE HORA — tres ruedas (Hora | Min | Periodo)
    // ========================================================================
    const HOURS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
    const BASE_MINUTES = ['00', '15', '30', '45'];
    const PERIODS = ['AM', 'PM'];

    function to12(v) {
        const m = /^(\d{1,2}):(\d{2})/.exec(v || '');
        if (!m) return null;
        const h = +m[1];
        return { h: String(h % 12 === 0 ? 12 : h % 12).padStart(2, '0'), m: m[2], p: h >= 12 ? 'PM' : 'AM' };
    }
    function to24(h, m, p) {
        let x = parseInt(h, 10);
        if (p === 'AM' && x === 12) x = 0;
        if (p === 'PM' && x !== 12) x += 12;
        return `${String(x).padStart(2, '0')}:${m}`;
    }

    let timePop = null;
    let timeTarget = null;   // { input, trigger, refresh }
    const wheels = {};

    function buildTimePop() {
        timePop = createPopover('iosp-time-pop');
        timePop.el.innerHTML = `
            <div class="iosp-time-cols">
                <div class="iosp-time-col"><div class="iosp-time-title">${tr('onb_time_hour', 'Hora')}</div><div class="iosp-wheel" data-k="h"></div></div>
                <div class="iosp-time-col"><div class="iosp-time-title">${tr('onb_time_min', 'Min')}</div><div class="iosp-wheel" data-k="m"></div></div>
                <div class="iosp-time-col"><div class="iosp-time-title">${tr('onb_time_period', 'Periodo')}</div><div class="iosp-wheel" data-k="p"></div></div>
            </div>`;
        timePop.el.querySelectorAll('.iosp-wheel').forEach((scroll) => {
            const k = scroll.dataset.k;
            const w = wheels[k] = { scroll, items: [], value: null, timer: null, syncing: false };

            w.setItems = (list) => {
                if (w.items.join() === list.join()) return;
                w.items = list.slice();
                scroll.innerHTML = list.map((v) => `<div class="iosp-opt" data-v="${v}">${v}</div>`).join('');
            };
            w.paint = () => {
                const st = scroll.scrollTop;
                [...scroll.children].forEach((o, i) => {
                    const dd = (i * ITEM_H - st) / ITEM_H;
                    if (Math.abs(dd) > 4) { o.style.opacity = 0; return; }
                    o.style.transform = `perspective(320px) rotateX(${-dd * 22}deg)`;
                    o.style.opacity = Math.max(0.28, 1 - Math.abs(dd) * 0.3);
                    o.classList.toggle('is-sel', Math.abs(dd) < 0.5);
                });
            };
            w.sync = (v) => {
                w.value = v;
                w.syncing = true;
                const i = Math.max(0, w.items.indexOf(v));
                scroll.scrollTop = i * ITEM_H;
                w.paint();
                requestAnimationFrame(() => requestAnimationFrame(() => { w.syncing = false; }));
            };
            const settle = () => {
                if (w.syncing) return;
                const i = clamp(Math.round(scroll.scrollTop / ITEM_H), 0, w.items.length - 1);
                const v = w.items[i];
                if (v === undefined || v === w.value) return;
                w.value = v;
                if (navigator.vibrate) { try { navigator.vibrate(4); } catch (e) { /* sin vibración */ } }
                commitTime();
            };
            scroll.addEventListener('scroll', () => {
                w.paint();
                clearTimeout(w.timer);
                w.timer = setTimeout(settle, 110);
            }, { passive: true });
            scroll.addEventListener('click', (e) => {
                const o = e.target.closest('.iosp-opt');
                if (!o) return;
                const i = [...scroll.children].indexOf(o);
                scroll.scrollTo({ top: i * ITEM_H, behavior: reduce.matches ? 'auto' : 'smooth' });
            });
        });
    }

    function commitTime() {
        if (!timeTarget) return;
        const v = to24(wheels.h.value, wheels.m.value, wheels.p.value);
        if (v !== timeTarget.input.value) writeNative(timeTarget.input, v);
        timeTarget.refresh();
    }

    function openTime(target) {
        if (!timePop) buildTimePop();
        if (timePop.open && timeTarget === target) { timePop.hide(); return; }
        timeTarget = target;
        const t = to12(target.input.value) || to12(target.fallback) || { h: '09', m: '00', p: 'AM' };
        const mins = BASE_MINUTES.includes(t.m) ? BASE_MINUTES : [...BASE_MINUTES, t.m].sort();
        wheels.h.setItems(HOURS);
        wheels.m.setItems(mins);
        wheels.p.setItems(PERIODS);
        target.trigger.classList.add('is-open');
        timePop.show(target.trigger, () => {
            target.trigger.classList.remove('is-open');
            if (timeTarget === target) timeTarget = null;
        });
        wheels.h.sync(t.h); wheels.m.sync(t.m); wheels.p.sync(t.p);
    }

    function enhanceTime(input) {
        if (input.dataset.iospDone) return;
        input.dataset.iospDone = '1';
        const fallback = input.getAttribute('value') || '09:00';

        const wrap = document.createElement('div');
        wrap.className = 'iosp-time';
        input.parentNode.insertBefore(wrap, input);
        wrap.innerHTML = `
            <button type="button" class="iosp-trigger" aria-haspopup="dialog">
                <span class="iosp-value"></span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
            </button>`;
        wrap.appendChild(input);
        input.classList.add('iosp-native');
        input.tabIndex = -1;

        const trigger = wrap.querySelector('.iosp-trigger');
        const valueEl = wrap.querySelector('.iosp-value');
        const target = {
            input, trigger, fallback,
            refresh() {
                const t = to12(input.value);
                valueEl.textContent = t ? `${t.h}:${t.m} ${t.p}` : '--:--';
                trigger.disabled = input.disabled;
                wrap.classList.toggle('is-disabled', input.disabled);
                if (input.disabled && timeTarget === target) timePop.hide();
            },
        };
        trigger.addEventListener('click', () => { if (!input.disabled) openTime(target); });
        watchNative(input, () => target.refresh());
        target.refresh();
    }

    // ========================================================================
    // SELECTOR DE FECHA — calendario con cápsula que salta al día elegido
    // ========================================================================
    const LOCALE = (document.documentElement.lang || 'es').toLowerCase();
    const pad2 = (n) => String(n).padStart(2, '0');
    const toISO = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const fromISO = (s) => {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
        return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
    };
    const fmtValue = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' });
    const fmtTitle = new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric' });
    const WEEK = Array.from({ length: 7 }, (_, i) =>
        new Intl.DateTimeFormat(LOCALE, { weekday: 'narrow' }).format(new Date(2024, 0, 1 + i)));   // 1 ene 2024 = lunes
    const CAL_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="4"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>';
    const CHEV = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;

    let datePop = null, dateTarget = null, view = new Date();
    let grid, titleEl, selEl;
    const SX = spring(0, 520, 34), SY = spring(0, 520, 34), SS = spring(0, 600, 30, 0.001);

    function buildDatePop() {
        datePop = createPopover('iosp-date-pop');
        datePop.el.innerHTML = `
            <div class="iosp-date-head">
                <span class="iosp-date-title"></span>
                <button type="button" class="iosp-date-nav" data-step="-1" aria-label="${tr('onb_prev_month', 'Mes anterior')}">${CHEV('M15 18l-6-6 6-6')}</button>
                <button type="button" class="iosp-date-nav" data-step="1" aria-label="${tr('onb_next_month', 'Mes siguiente')}">${CHEV('M9 18l6-6-6-6')}</button>
            </div>
            <div class="iosp-date-week">${WEEK.map((w) => `<span>${w}</span>`).join('')}</div>
            <div class="iosp-date-grid"><span class="iosp-date-sel" aria-hidden="true"></span></div>
            <div class="iosp-date-foot">
                <button type="button" class="iosp-date-clear">${tr('onb_date_clear', 'Borrar')}</button>
                <button type="button" class="iosp-date-today">${tr('onb_date_today', 'Hoy')}</button>
            </div>`;
        grid = datePop.el.querySelector('.iosp-date-grid');
        titleEl = datePop.el.querySelector('.iosp-date-title');
        selEl = datePop.el.querySelector('.iosp-date-sel');

        renderers.add(() => {
            selEl.style.opacity = clamp(SS.v);
            selEl.style.transform = `translate(${SX.v}px, ${SY.v}px) scale(${Math.max(0, SS.v)})`;
        });

        datePop.el.querySelectorAll('.iosp-date-nav').forEach((b) => b.addEventListener('click', () => stepMonth(+b.dataset.step)));
        grid.addEventListener('click', (e) => {
            const b = e.target.closest('.iosp-date-day[data-iso]');
            if (!b || b.disabled) return;
            grid.querySelectorAll('.is-selected').forEach((x) => x.classList.remove('is-selected'));
            b.classList.add('is-selected');
            placeSel(false);
            setDate(b.dataset.iso);
            setTimeout(() => datePop.hide(), 260);   // deja ver el cambio antes de cerrar
        });
        datePop.el.querySelector('.iosp-date-today').addEventListener('click', () => {
            const t = new Date();
            view = new Date(t.getFullYear(), t.getMonth(), 1);
            setDate(toISO(t));
            buildMonth(0);
            setTimeout(() => datePop.hide(), 260);
        });
        datePop.el.querySelector('.iosp-date-clear').addEventListener('click', () => { setDate(''); datePop.hide(); });

        // Deslizar a los lados cambia de mes
        let sx = null;
        grid.addEventListener('pointerdown', (e) => { sx = e.clientX; });
        grid.addEventListener('pointerup', (e) => {
            if (sx === null) return;
            const dx = e.clientX - sx; sx = null;
            if (Math.abs(dx) > 45) stepMonth(dx < 0 ? 1 : -1);
        });
    }

    function buildMonth(dir) {
        const tt = fmtTitle.format(view);
        titleEl.textContent = tt.charAt(0).toUpperCase() + tt.slice(1);
        grid.querySelectorAll('.iosp-date-day').forEach((b) => b.remove());
        const first = new Date(view.getFullYear(), view.getMonth(), 1);
        const lead = (first.getDay() + 6) % 7;   // semana inicia en lunes
        const days = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
        const todayISO = toISO(new Date());
        const selISO = dateTarget ? dateTarget.input.value : '';
        const frag = document.createDocumentFragment();
        for (let i = 0; i < lead; i++) {
            const s = document.createElement('span');
            s.className = 'iosp-date-day is-pad';
            frag.appendChild(s);
        }
        for (let d = 1; d <= days; d++) {
            const iso = toISO(new Date(view.getFullYear(), view.getMonth(), d));
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'iosp-date-day';
            b.textContent = d;
            b.dataset.iso = iso;
            if (iso === todayISO) b.classList.add('is-today');
            if (iso === selISO) b.classList.add('is-selected');
            frag.appendChild(b);
        }
        grid.appendChild(frag);
        placeSel(true);
        if (dir && !reduce.matches && grid.animate) {
            grid.animate(
                [{ transform: `translateX(${dir * 28}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }],
                { duration: 480, easing: SPRING }
            );
        }
    }

    function placeSel(snap) {
        const b = grid.querySelector('.iosp-date-day.is-selected');
        if (!b) { SS.t = 0; if (snap) SS.v = 0; kick(); return; }
        SX.t = b.offsetLeft; SY.t = b.offsetTop; SS.t = 1;
        if (snap || SS.v < 0.05) { SX.v = SX.t; SY.v = SY.t; SX.vel = SY.vel = 0; }
        if (snap && SS.v < 0.05) SS.v = 0.4;   // pequeño "pop" al aparecer
        kick();
    }

    function stepMonth(dir) {
        view = new Date(view.getFullYear(), view.getMonth() + dir, 1);
        buildMonth(dir);
    }

    function setDate(iso) {
        if (!dateTarget) return;
        writeNative(dateTarget.input, iso);
        dateTarget.refresh();
    }

    function openDate(target) {
        if (!datePop) buildDatePop();
        if (datePop.open && dateTarget === target) { datePop.hide(); return; }
        dateTarget = target;
        const d = fromISO(target.input.value) || new Date();
        view = new Date(d.getFullYear(), d.getMonth(), 1);
        buildMonth(0);
        target.wrap.classList.add('is-open');
        datePop.show(target.trigger, () => {
            target.wrap.classList.remove('is-open');
            if (dateTarget === target) dateTarget = null;
        });
    }

    function enhanceDate(input) {
        if (input.dataset.iospDone) return;
        input.dataset.iospDone = '1';

        const wrap = document.createElement('div');
        wrap.className = 'iosp-date';
        input.parentNode.insertBefore(wrap, input);
        wrap.innerHTML = `
            <button type="button" class="iosp-trigger iosp-date-trigger" aria-haspopup="dialog">
                ${CAL_ICON}<span class="iosp-value"></span>
            </button>`;
        wrap.appendChild(input);
        input.classList.add('iosp-native');
        input.tabIndex = -1;

        const trigger = wrap.querySelector('.iosp-trigger');
        const valueEl = wrap.querySelector('.iosp-value');
        const placeholder = input.dataset.placeholder || tr('onb_date_placeholder', 'Seleccionar fecha');
        const target = {
            input, trigger, wrap,
            refresh() {
                const d = fromISO(input.value);
                valueEl.textContent = d ? fmtValue.format(d) : placeholder;
                trigger.classList.toggle('is-empty', !d);
                trigger.disabled = input.disabled;
                if (input.disabled && dateTarget === target) datePop.hide();
            },
        };
        trigger.addEventListener('click', () => { if (!input.disabled) openDate(target); });
        watchNative(input, () => target.refresh());
        target.refresh();
    }

    // ------------------------------------------------------------------------
    // Arranque: inputs actuales + los que se agreguen después (modal, filas nuevas)
    // ------------------------------------------------------------------------
    function enhance(root = document) {
        if (!root || !root.querySelectorAll) return;
        root.querySelectorAll(TIME_SEL).forEach(enhanceTime);
        root.querySelectorAll(DATE_SEL).forEach(enhanceDate);
    }

    let pending = false;
    function schedule() {
        if (pending) return;
        pending = true;
        requestAnimationFrame(() => { pending = false; enhance(document); });
    }

    function start() {
        enhance(document);
        new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    }

    window.IOSPickers = { enhance };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();