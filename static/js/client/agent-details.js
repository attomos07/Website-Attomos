// Agent Details Page functionality

function getLang() {
    return localStorage.getItem('attomos_lang') || localStorage.getItem('lang') || 'es';
}
function t(key, fallback) {
    return window.Translations?.dict?.[getLang()]?.[key] || fallback;
}

// Re-renderiza todo (info básica, configuración, horario, personal) cuando
// cambia el idioma, usando los datos del agente ya cargados en memoria —
// sin esto, el texto se queda "pegado" en el idioma que estaba activo la
// primera vez que cargó la página, porque estos campos se pintan una sola
// vez al hacer el fetch inicial, no en cada cambio de idioma.
document.addEventListener('attomos:langchange', function () {
    if (agent) renderAgentDetails(agent);
});

let agentId = null;
let agent = null;
let qrPollInterval = null;
let isConnected = false;

// Initialize page
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 Agent Details JS loaded');
    
    // Extract agent ID from URL: /agents/{id}
    const pathParts = window.location.pathname.split('/');
    agentId = pathParts[pathParts.length - 1];
    
    if (!agentId || agentId === 'agents') {
        console.error('❌ No agent ID found in URL');
        window.location.href = '/my-agents';
        return;
    }
    
    console.log('📋 Agent ID:', agentId);
    loadAgentDetails(); // startQRPolling se llama dentro, una vez que agent está cargado
});

// Load agent details
async function loadAgentDetails() {
    try {
        const response = await fetch(`/api/agents/${agentId}`, {
            credentials: 'include'
        });

        if (!response.ok) {
            throw new Error('Error loading agent details');
        }

        const data = await response.json();
        agent = data.agent;
        
        console.log('📊 Agent data:', agent);
        
        renderAgentDetails(agent);
        
        // Cargar QR inmediatamente y arrancar el polling continuo
        // (se hace aquí porque agent ya está cargado)
        loadQRCode();
        startQRPolling();
        loadMetaConnection();
    } catch (error) {
        console.error('❌ Error:', error);
        alert('Error loading agent details');
        window.location.href = '/my-agents';
    }
}

// Render agent details
function renderAgentDetails(agent) {
    // Header
    document.getElementById('agentName').textContent = agent.name;
    document.getElementById('agentId').textContent = `ID: ${agent.id}`;
    renderPlatformBadge(agent);
    updateStatusBadge(agent);
    
    // Toggle button
    const toggleIcon = document.getElementById('toggleIcon');
    const toggleText = document.getElementById('toggleText');
    if (agent.isActive) {
        toggleIcon.className = 'lni lni-pause';
        toggleText.textContent = window.Translations?.dict?.[getLang()]?.ad_pause || 'Pausar';
    } else {
        toggleIcon.className = 'lni lni-play';
        toggleText.textContent = window.Translations?.dict?.[getLang()]?.ad_activate || 'Activar';
    }
    
    // Enviar mensaje por WhatsApp Cloud API (solo agentes con Meta conectado)
    renderSendTestSection(agent);

    // Basic Info
    document.getElementById('infoName').textContent = agent.name;

    // Teléfono: en el plan Gratuito (WhatsApp Web / QR con whatsmeow) nunca
    // hay un número dado de alta — no es un error, es el diseño. Solo
    // WhatsApp Business (Meta API, Protón+) y Telegram usan un número/token
    // real, y ahí sí "No configurado" indica algo pendiente.
    const botTypeForPhone = (agent.botType || '').toLowerCase();
    const isWhatsAppWebAgent = botTypeForPhone === 'atomic';
    document.getElementById('infoPhone').textContent = agent.phoneNumber
        || (isWhatsAppWebAgent
            ? (window.Translations?.dict?.[getLang()]?.ad_whatsapp_web_number || 'WhatsApp Web')
            : (window.Translations?.dict?.[getLang()]?.ad_not_configured || 'No configurado'));

    document.getElementById('infoBusinessType').textContent = formatBusinessType(agent.businessType);
    document.getElementById('infoPort').textContent = agent.port || '--';
    
    // Configuration
    if (agent.config) {
        document.getElementById('configTone').textContent = formatTone(agent.config.tone);
        
        const languages = [...(agent.config.languages || []), ...(agent.config.additionalLanguages || [])];
        document.getElementById('configLanguages').textContent = languages.length > 0 
            ? languages.map(formatLanguageName).join(', ') 
            : (window.Translations?.dict?.[getLang()]?.ad_not_configured || 'No configurado');
        
        // "Mensaje de Bienvenida": si el tono es Personalizado, mostrar la
        // descripción de personalidad que se escribió ahí (antes se quedaba
        // vacía porque customTone y welcomeMessage son campos distintos).
        const isCustomToneDescription = agent.config.tone === 'custom' && !!agent.config.customTone;
        const descriptionText = isCustomToneDescription
            ? stripHtml(agent.config.customTone)
            : agent.config.welcomeMessage;
        document.getElementById('configWelcome').textContent =
            descriptionText || (window.Translations?.dict?.[getLang()]?.ad_not_configured || 'No configurado');

        const welcomeLabel = document.getElementById('configWelcomeLabel');
        if (welcomeLabel) {
            welcomeLabel.textContent = isCustomToneDescription
                ? t('ad_personality_desc_label', 'Descripción de Personalidad')
                : t('ad_welcome_label', 'Mensaje de Bienvenida');
        }
        
        // Schedule
        renderSchedule(agent.config.schedule);
        
        // Services
        renderServices(agent.config.services);
        
        // Workers
        renderWorkers(agent.config.workers);
    }
}

// Quita etiquetas HTML del editor enriquecido de "tono personalizado" para
// mostrarlo como texto plano en el resumen de detalles.
function stripHtml(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html || '';
    return (tmp.textContent || tmp.innerText || '').trim();
}

// Nombre completo del idioma a partir de su código (mismos idiomas que
// ofrece el onboarding: es, en, fr, pt, de, it, zh, además de ru/uz/ja/ko
// por si vienen de otras partes de la app).
function formatLanguageName(code) {
    const names = {
        es: t('lang_name_es', 'Español'),
        en: t('lang_name_en', 'Inglés'),
        fr: t('lang_name_fr', 'Francés'),
        pt: t('lang_name_pt', 'Portugués'),
        de: t('lang_name_de', 'Alemán'),
        it: t('lang_name_it', 'Italiano'),
        zh: t('lang_name_zh', 'Chino'),
        ru: t('lang_name_ru', 'Ruso'),
        uz: t('lang_name_uz', 'Uzbeko'),
        ja: t('lang_name_ja', 'Japonés'),
        ko: t('lang_name_ko', 'Coreano'),
    };
    return names[(code || '').toLowerCase()] || code;
}

// Update status badge
function updateStatusBadge(agent) {
    const statusBadge = document.getElementById('agentStatus');
    statusBadge.className = 'status-badge';
    
    if (agent.deployStatus === 'running' && agent.isActive) {
        statusBadge.classList.add('active');
        statusBadge.innerHTML = `<span class="status-dot"></span><span>${window.Translations?.dict?.[getLang()]?.ad_status_active || 'Activo'}</span>`;
    } else if (agent.deployStatus === 'pending' || agent.deployStatus === 'deploying') {
        statusBadge.classList.add('pending');
        statusBadge.innerHTML = `<span class="status-dot"></span><span>${window.Translations?.dict?.[getLang()]?.ad_status_deploying || 'Desplegando'}</span>`;
    } else if (agent.deployStatus === 'error') {
        statusBadge.classList.add('inactive');
        statusBadge.innerHTML = `<span class="status-dot"></span><span>${window.Translations?.dict?.[getLang()]?.ad_status_error || 'Error'}</span>`;
    } else {
        statusBadge.classList.add('inactive');
        statusBadge.innerHTML = `<span class="status-dot"></span><span>${window.Translations?.dict?.[getLang()]?.ad_status_inactive || 'Inactivo'}</span>`;
    }
}

// Load QR Code
async function loadQRCode() {
    // Only load QR for atomic bots (WhatsApp Web)
    if (agent.botType !== 'atomic') {
        // qrSection is already hidden by default in HTML, nothing to do
        return;
    }
    
    // It IS atomic: show qrSection and switch to 2-column layout
    const qrSection = document.getElementById('qrSection');
    if (qrSection) qrSection.style.display = '';
    const detailsGrid = document.getElementById('detailsGrid') || document.querySelector('.details-grid');
    if (detailsGrid) detailsGrid.classList.remove('no-qr');
    
    try {
        const response = await fetch(`/api/agents/${agentId}/qr`, {
            credentials: 'include'
        });

        const data = await response.json();
        
        if (response.ok && data.qrCode) {
            console.log('📱 QR code received');
            // No está conectado, hay QR
            if (isConnected) {
                console.log('⚠️  Estado cambió de conectado a desconectado');
                isConnected = false;
            }
            displayQRCode(data.qrCode);
        } else if (data.connected) {
            console.log('✅ WhatsApp connected');
            // Está conectado
            if (!isConnected) {
                console.log('🎉 Bot se conectó exitosamente');
                isConnected = true;
            }
            displayConnectedMessage();
        } else {
            // Bot is starting, disconnected, or waiting for QR
            const message = data.message || data.error || 'Iniciando bot, esperando código QR...';
            console.log('⏳ Waiting:', message);
            
            // Marcar como no conectado
            if (isConnected) {
                console.log('⚠️  Estado cambió de conectado a desconectado');
                isConnected = false;
            }
            
            // Detectar si fue desconectado
            if (message.toLowerCase().includes('desconectado') || 
                message.toLowerCase().includes('reconexión') ||
                message.toLowerCase().includes('desvinculado')) {
                displayDisconnectedMessage(message);
            } else {
                displayQRLoading(message);
            }
        }
    } catch (error) {
        console.error('❌ Error loading QR:', error);
        displayQRError();
    }
}

// Display QR Code
function displayQRCode(qrCode) {
    const qrContainer = document.getElementById('qrContainer');
    qrContainer.innerHTML = `
        <div class="qr-code">
            <pre>${escapeHtml(qrCode)}</pre>
        </div>
        <div style="text-align: center; max-width: 400px;">
            <p style="font-size: 1.1rem; font-weight: 600; color: #1a1a1a; margin: 0 0 1rem 0; font-family: 'Inter', sans-serif;">
                Escanea este código QR con WhatsApp
            </p>
            <div class="qr-info">
                <i class="lni lni-timer"></i>
                <span>El código QR se actualiza automáticamente</span>
            </div>
        </div>
    `;
}

// Display disconnected message
function displayDisconnectedMessage(message) {
    const qrContainer = document.getElementById('qrContainer');
    qrContainer.innerHTML = `
        <div class="qr-disconnected">
            <div class="disconnected-icon">
                <i class="lni lni-unlink"></i>
            </div>
            <h3>WhatsApp Desconectado</h3>
            <p>${escapeHtml(message)}</p>
            <div style="margin-top: 1.5rem; padding: 1rem; background: rgba(251, 191, 36, 0.1); border: 1px solid rgba(251, 191, 36, 0.3); border-radius: 10px;">
                <p style="margin: 0; color: #92400e; font-size: 0.9rem; line-height: 1.6;">
                    <strong>💡 El bot se reiniciará automáticamente</strong><br>
                    Espera unos segundos y un nuevo código QR aparecerá
                </p>
            </div>
        </div>
    `;
}

// Display connected message
function displayConnectedMessage() {
    const qrContainer = document.getElementById('qrContainer');
    qrContainer.innerHTML = `
        <div class="qr-connected">
            <div class="connected-icon">
                <i class="lni lni-checkmark-circle"></i>
            </div>
            <h3>${t('ad_qr_connected_title', '¡WhatsApp Conectado!')}</h3>
            <p>${t('ad_qr_connected_desc', 'Tu bot está conectado y funcionando')}</p>
            <div style="margin-top: 1rem; padding: 0.75rem; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 8px;">
                <p style="margin: 0; color: #065f46; font-size: 0.85rem;">
                    <i class="lni lni-information"></i>
                    ${t('ad_qr_monitoring', 'Monitoreando conexión cada 15 segundos')}
                </p>
            </div>
        </div>
    `;
}

// Display QR loading state
function displayQRLoading(message) {
    const qrContainer = document.getElementById('qrContainer');

    // El backend manda el mensaje en inglés o español según cómo se generó;
    // lo normalizamos a una key de traducción y mostramos en el idioma activo.
    let translatedMessage = message;
    let statusClass = 'loading';
    let icon = 'lni-hourglass';

    const lower = (message || '').toLowerCase();
    if (lower.includes('starting') || lower.includes('iniciando')) {
        translatedMessage = t('ad_qr_starting', 'Iniciando bot, esperando código QR...');
        icon = 'lni-rocket';
        statusClass = 'starting';
    } else if (lower.includes('waiting') || lower.includes('esperando')) {
        translatedMessage = t('ad_qr_waiting', 'Esperando código QR...');
        icon = 'lni-timer';
        statusClass = 'waiting';
    }

    qrContainer.innerHTML = `
        <div class="qr-loading ${statusClass}">
            <div class="loading-spinner"></div>
            <i class="lni ${icon}" style="font-size: 2rem; color: #06b6d4; margin-top: 1rem;"></i>
            <p>${escapeHtml(translatedMessage)}</p>
            <small style="color: #9ca3af; margin-top: 0.5rem;">
                ${t('ad_qr_5to15', 'Esto usualmente toma 5-15 segundos')}
            </small>
        </div>
    `;
}

// Display QR error
function displayQRError() {
    const qrContainer = document.getElementById('qrContainer');
    qrContainer.innerHTML = `
        <div class="qr-error">
            <i class="lni lni-warning"></i>
            <p>${t('ad_qr_error', 'No se pudo cargar el código QR')}</p>
            <button class="btn-secondary btn-sm" onclick="loadQRCode()">
                <i class="lni lni-reload"></i>
                ${t('hist_retry', 'Reintentar')}
            </button>
        </div>
    `;
}

// Start QR polling with adaptive interval
function startQRPolling() {
    // Only poll if atomic bot
    if (!agent || agent.botType !== 'atomic') return;
    
    let pollCount = 0;
    
    // Función para determinar el intervalo de polling
    const getInterval = () => {
        if (isConnected) {
            // Si está conectado, hacer polling cada 15 segundos para detectar desconexiones
            return 15000;
        } else if (pollCount <= 10) {
            // Al inicio (primeros 10 intentos), polling rápido cada 3 segundos
            return 3000;
        } else {
            // Después, cada 5 segundos
            return 5000;
        }
    };
    
    const poll = () => {
        pollCount++;
        
        qrPollInterval = setTimeout(async () => {
            await loadQRCode();
            
            // Continuar polling siempre (incluso cuando está conectado)
            // para detectar desconexiones
            poll();
        }, getInterval());
    };
    
    // Iniciar el polling
    poll();
    
    console.log('🔄 QR polling iniciado');
}

// Stop QR polling
function stopQRPolling() {
    if (qrPollInterval) {
        clearTimeout(qrPollInterval);
        qrPollInterval = null;
        console.log('⏸️  QR polling stopped');
    }
}

// Render schedule
function renderSchedule(schedule) {
    if (!schedule) {
        document.getElementById('scheduleGrid').innerHTML = `<p class="no-data">${window.Translations?.dict?.[getLang()]?.ad_no_schedule || 'No hay horario configurado'}</p>`;
        return;
    }
    
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const dayNames = {
        monday: t('ad_day_monday', 'Lunes'),
        tuesday: t('ad_day_tuesday', 'Martes'),
        wednesday: t('ad_day_wednesday', 'Miércoles'),
        thursday: t('ad_day_thursday', 'Jueves'),
        friday: t('ad_day_friday', 'Viernes'),
        saturday: t('ad_day_saturday', 'Sábado'),
        sunday: t('ad_day_sunday', 'Domingo')
    };
    
    const scheduleHTML = days.map(day => {
        const daySchedule = schedule[day];
        if (!daySchedule) return '';
        
        return `
            <div class="schedule-item">
                <div class="schedule-day">${dayNames[day]}</div>
                <div class="schedule-time">
                    ${daySchedule.open 
                        ? `${daySchedule.start} - ${daySchedule.end}`
                        : `<span class="closed">${t('ad_closed', 'Cerrado')}</span>`
                    }
                </div>
            </div>
        `;
    }).join('');
    
    document.getElementById('scheduleGrid').innerHTML = scheduleHTML || `<p class="no-data">${window.Translations?.dict?.[getLang()]?.ad_no_schedule || 'No hay horario configurado'}</p>`;
}

// Render services
function renderServices(services) {
    if (!services || services.length === 0) {
        document.getElementById('servicesList').innerHTML = `<p class="no-data">${window.Translations?.dict?.[getLang()]?.ad_no_services || 'No hay servicios configurados'}</p>`;
        return;
    }
    
    const servicesHTML = services.map(service => `
        <div class="service-item">
            <div class="service-header">
                <h4>${escapeHtml(service.title)}</h4>
                <span class="service-price">${formatPrice(service)}</span>
            </div>
            <p class="service-description">${escapeHtml(service.description)}</p>
        </div>
    `).join('');
    
    document.getElementById('servicesList').innerHTML = servicesHTML;
}

// Render workers
function renderWorkers(workers) {
    if (!workers || workers.length === 0) {
        document.getElementById('workersList').innerHTML = `<p class="no-data">${window.Translations?.dict?.[getLang()]?.ad_no_workers || 'No hay personal configurado'}</p>`;
        return;
    }
    
    const workersHTML = workers.map(worker => `
        <div class="worker-item">
            <div class="worker-header">
                <div class="worker-avatar">
                    <i class="lni lni-user"></i>
                </div>
                <div class="worker-info">
                    <h4>${escapeHtml(worker.name)}</h4>
                    <p class="worker-schedule">${worker.startTime} - ${worker.endTime}</p>
                </div>
            </div>
            <div class="worker-days">
                ${formatWorkDays(worker.days)}
            </div>
        </div>
    `).join('');
    
    document.getElementById('workersList').innerHTML = workersHTML;
}

// Format price based on price type
function formatPrice(service) {
    if (service.priceType === 'promo' && service.promoPrice) {
        return `<del>$${service.price}</del> $${service.promoPrice}`;
    }
    return `$${service.price}`;
}

// Format work days
function formatWorkDays(days) {
    if (!days || days.length === 0) return window.Translations?.dict?.[getLang()]?.ad_not_configured || 'Sin días configurados';
    
    const dayAbbr = {
        monday: t('ad_day_short_monday', 'Lun'),
        tuesday: t('ad_day_short_tuesday', 'Mar'),
        wednesday: t('ad_day_short_wednesday', 'Mié'),
        thursday: t('ad_day_short_thursday', 'Jue'),
        friday: t('ad_day_short_friday', 'Vie'),
        saturday: t('ad_day_short_saturday', 'Sáb'),
        sunday: t('ad_day_short_sunday', 'Dom')
    };
    
    return days.map(day => `<span class="day-badge">${dayAbbr[day] || day}</span>`).join('');
}

// Format business type — traducción solo en frontend (mismo criterio que
// el userbar), el valor crudo del backend nunca se toca.
function formatBusinessType(type) {
    if (!type) return t('ad_not_configured', 'No especificado');
    const key = 'biz_type_' + type.replace(/-/g, '_');
    const translated = t(key, null);
    if (translated) return translated;
    // Fallback genérico si no hay key para ese giro específico
    return type.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

// Format tone
function formatTone(tone) {
    if (!tone) return t('ad_not_configured', 'No especificado');
    const tones = {
        formal: t('ad_tone_formal', 'Formal'),
        friendly: t('ad_tone_friendly', 'Amigable'),
        casual: t('ad_tone_casual', 'Casual'),
        custom: t('ad_tone_custom', 'Personalizado')
    };
    return tones[tone] || tone.charAt(0).toUpperCase() + tone.slice(1);
}

// Editar agente — abre el mismo modal de onboarding (crear/editar) que
// "Mis Agentes", precargado con los datos de este agente. La lógica de
// precarga vive en onboarding.js/my-agents.js para no duplicar toda esa
// infraestructura aquí.
function editAgent() {
    if (!agentId) return;
    window.location.href = `/my-agents?editAgent=${encodeURIComponent(agentId)}`;
}

// Toggle agent status
function toggleAgentStatus() {
    if (!agent) return;

    const isPausing = agent.isActive;
    const actionWord = isPausing ? t('ad_confirm_pause', 'pausar') : t('ad_confirm_activate', 'activar');
    const actionTitle = isPausing ? t('ad_pause', 'Pausar') : t('ad_activate', 'Activar');

    showConfirmModal({
        type: 'warning',
        icon: isPausing ? 'lni-pause' : 'lni-play',
        title: t('agents_toggle_title', '¿{action} Agente?').replace('{action}', actionTitle),
        message: t('agents_pause_msg', 'Estás a punto de {action} el agente "{name}"')
            .replace('{action}', actionWord).replace('{name}', `<strong>${escapeHtml(agent.name)}</strong>`),
        list: isPausing ? [
            t('agents_pause_list1', 'El agente dejará de responder mensajes'),
            t('agents_pause_list2', 'Los clientes no recibirán atención automática'),
            t('agents_pause_list3', 'Puedes reactivarlo cuando quieras')
        ] : [
            t('agents_activate_list1', 'El agente volverá a responder mensajes'),
            t('agents_activate_list2', 'Se reanudará la atención automática'),
            t('agents_activate_list3', 'Los clientes podrán interactuar nuevamente')
        ],
        confirmText: t('agents_action_agent_btn', '{action} Agente').replace('{action}', actionTitle),
        confirmClass: 'warning',
        onConfirm: async () => {
            const response = await fetch(`/api/agents/${agentId}/toggle`, {
                method: 'PATCH',
                credentials: 'include'
            });

            if (!response.ok) {
                throw new Error('Error cambiando estado del agente');
            }

            await loadAgentDetails();
            const pastWord = isPausing ? t('ad_agent_paused', 'pausado') : t('ad_agent_activated', 'activado');
            if (typeof showNotification === 'function') {
                showNotification(`✅ ${t('ad_agent_word', 'Agente')} ${pastWord} ${t('ad_successfully', 'exitosamente')}`, 'success');
            }
        }
    });
}

// Modal de confirmación (mismo diseño que "Mis Agentes" — ver my-agents.js)
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
                        <span>${t('agents_cancel', 'Cancelar')}</span>
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
        this.innerHTML = `<div class="loading-spinner-small"></div><span>${t('agents_processing', 'Procesando...')}</span>`;
        this.disabled = true;

        try {
            await onConfirm();
            closeConfirmModal();
        } catch (error) {
            console.error('Error en confirmación:', error);
            alert(t('ad_toggle_error', 'Error cambiando el estado del agente. Por favor intenta de nuevo.'));
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

// Escape HTML
function escapeHtml(text) {
    if (!text) return '';
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return String(text).replace(/[&<>"']/g, m => map[m]);
}

// Cleanup on page unload
window.addEventListener('beforeunload', function() {
    stopQRPolling();
});
// ============================================
// Capa iOS 27 — detalles de interacción (no cambia la lógica de arriba)
// ============================================
(function () {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Las filas del horario y las tarjetas de servicios/personal entran en cascada
    function cascade(container, selector) {
        if (!container || reduce) return;
        container.querySelectorAll(selector).forEach((el, i) => {
            el.style.animationDelay = (i * 40) + 'ms';
        });
    }
    ['scheduleGrid', 'servicesList', 'workersList'].forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        new MutationObserver(() => cascade(el, '.schedule-item, .service-item, .worker-item')).observe(el, { childList: true });
    });

    // Pausar/Activar: el botón se aplasta como gelatina al tocarlo
    document.addEventListener('pointerdown', (e) => {
        const btn = e.target.closest('.agent-actions .btn-secondary');
        if (!btn || reduce) return;
        btn.classList.remove('ios-squish'); void btn.offsetWidth; btn.classList.add('ios-squish');
    });
})();
// ============================================
// Enviar mensaje (WhatsApp Cloud API)
// ============================================
let sendTestType = 'template';

function renderSendTestSection(agent) {
    const section = document.getElementById('sendTestSection');
    if (!section) return;
    const hasMeta = (agent.botType || '').toLowerCase() === 'orbital'
        && (!!agent.metaConnected || !!agent.metaPhoneNumberId);
    section.style.display = hasMeta ? '' : 'none';
    if (!hasMeta) return;

    const from = document.getElementById('sendTestFrom');
    const number = agent.metaDisplayNumber || agent.phoneNumber || '';
    const name = agent.metaVerifiedName || '';
    from.textContent = number
        ? `${t('ad_st_from', 'Desde')}: ${name ? name + ' · ' : ''}${number}`
        : '';
}

function setSendTestType(type) {
    sendTestType = type === 'text' ? 'text' : 'template';
    document.querySelectorAll('.send-test-toggle button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.type === sendTestType);
    });
    document.getElementById('sendTestTemplateFields').style.display = sendTestType === 'template' ? '' : 'none';
    document.getElementById('sendTestTextField').style.display = sendTestType === 'text' ? '' : 'none';
}

async function sendTestMessage(event) {
    event.preventDefault();
    const btn = document.getElementById('sendTestBtn');
    const btnLabel = btn.querySelector('span');
    const originalLabel = btnLabel.textContent;

    const payload = {
        to: document.getElementById('sendTestTo').value.trim(),
        type: sendTestType,
        templateName: document.getElementById('sendTestTemplate').value.trim(),
        languageCode: document.getElementById('sendTestLang').value.trim(),
        text: document.getElementById('sendTestText').value.trim(),
    };

    btn.disabled = true;
    btnLabel.textContent = t('ad_st_sending', 'Enviando...');

    let data = null;
    try {
        const response = await fetch(`/api/meta/send-test/${agentId}`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) {
            throw new Error(data.error || `HTTP ${response.status}`);
        }
        const msgId = data.response?.messages?.[0]?.id;
        showSendTestResult(true, `${t('ad_st_ok', 'Mensaje enviado correctamente')}${msgId ? ' · ID: ' + msgId : ''}`, data);
    } catch (error) {
        showSendTestResult(false, `${t('ad_st_error', 'No se pudo enviar')}: ${error.message}`, data);
    } finally {
        btn.disabled = false;
        btnLabel.textContent = originalLabel;
    }
}

function showSendTestResult(ok, message, data) {
    const result = document.getElementById('sendTestResult');
    const status = document.getElementById('sendTestStatus');
    result.style.display = '';
    status.className = 'send-test-status ' + (ok ? 'success' : 'error');
    status.textContent = message;

    const req = data?.request;
    document.getElementById('sendTestRequest').textContent = req
        ? `${req.method} ${req.endpoint}\nAuthorization: Bearer ••••••••\nContent-Type: application/json\n\n${JSON.stringify(req.body, null, 2)}`
        : '--';
    document.getElementById('sendTestResponse').textContent = data?.response
        ? JSON.stringify(data.response, null, 2)
        : '--';
}

// ============================================
// Conexión WhatsApp Business (Meta) — OrbitalBot
// ============================================
async function loadMetaConnection() {
    const section = document.getElementById('metaConnSection');
    if (!section) return;
    if ((agent.botType || '').toLowerCase() !== 'orbital') {
        section.style.display = 'none';
        return;
    }
    section.style.display = '';

    const params = new URLSearchParams(window.location.search);
    if (params.get('success') === 'whatsapp_connected') {
        showMetaStatus(true, t('ad_meta_connected_ok', 'WhatsApp Business conectado correctamente'));
        history.replaceState(null, '', window.location.pathname);
    }

    try {
        const response = await fetch(`/api/meta/credentials/status/${agentId}`, { credentials: 'include' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        renderMetaConnection(data);
    } catch (error) {
        console.error('❌ Error cargando estado de Meta:', error);
        renderMetaConnection({});
    }
}

function renderMetaConnection(data) {
    const connected = !!data.has_credentials && !!data.connected;
    const badge = document.getElementById('metaConnBadge');
    badge.classList.toggle('connected', connected);
    badge.textContent = connected
        ? t('ad_meta_connected', 'Conectado')
        : t('ad_meta_not_connected', 'Sin conectar');

    document.getElementById('metaConnSetup').style.display = connected ? 'none' : '';
    document.getElementById('metaConnInfo').style.display = connected ? '' : 'none';
    document.getElementById('metaCancelEditBtn').style.display = 'none';

    document.getElementById('metaInfoNumber').textContent = data.displayNumber || data.display_number || '--';
    document.getElementById('metaInfoName').textContent = data.verifiedName || data.verified_name || '--';
    document.getElementById('metaWebhookUrl').textContent = data.webhookUrl || `${window.location.origin}/webhook/meta/${agentId}`;
    document.getElementById('metaVerifyTokenValue').textContent = data.webhookVerifyToken || '--';

    // Mantener el objeto agent sincronizado para la tarjeta de envío
    agent.metaConnected = connected;
    agent.metaPhoneNumberId = connected ? (data.phoneNumberId || agent.metaPhoneNumberId) : '';
    agent.metaDisplayNumber = data.displayNumber || '';
    agent.metaVerifiedName = data.verifiedName || '';
    renderSendTestSection(agent);
}

function showMetaStatus(ok, message) {
    const el = document.getElementById('metaConnStatus');
    if (!el) return;
    el.className = 'send-test-status ' + (ok ? 'success' : 'error');
    el.textContent = message;
    el.style.display = '';
}

async function connectMetaWithFacebook() {
    const btn = document.getElementById('metaFbBtn');
    btn.disabled = true;
    try {
        const response = await fetch(`/api/meta/connect?agent_id=${agentId}`, { credentials: 'include' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.auth_url) {
            throw new Error(data.error || t('ad_meta_fb_unavailable', 'La conexión con Facebook no está disponible. Usa tus credenciales.'));
        }
        window.location.href = data.auth_url;
    } catch (error) {
        showMetaStatus(false, error.message);
        btn.disabled = false;
    }
}

async function saveMetaCredentials(event) {
    event.preventDefault();
    const btn = document.getElementById('metaSaveBtn');
    const label = btn.querySelector('span');
    const original = label.textContent;
    btn.disabled = true;
    label.textContent = t('ad_meta_validating', 'Validando...');

    try {
        const response = await fetch(`/api/meta/credentials/save/${agentId}`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                phoneNumberId: document.getElementById('metaPhoneId').value.trim(),
                wabaId: document.getElementById('metaWaba').value.trim(),
                accessToken: document.getElementById('metaToken').value.trim(),
            }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) throw new Error(data.error || `HTTP ${response.status}`);

        document.getElementById('metaToken').value = '';
        showMetaStatus(true, t('ad_meta_saved', 'Credenciales guardadas. El bot se está reiniciando con tu número.'));
        await loadMetaConnection();
    } catch (error) {
        showMetaStatus(false, `${t('ad_meta_save_error', 'No se pudieron guardar')}: ${error.message}`);
    } finally {
        btn.disabled = false;
        label.textContent = original;
    }
}

function editMetaCredentials() {
    document.getElementById('metaConnInfo').style.display = 'none';
    document.getElementById('metaConnSetup').style.display = '';
    document.getElementById('metaCancelEditBtn').style.display = '';
}

function cancelMetaEdit() {
    document.getElementById('metaConnSetup').style.display = 'none';
    document.getElementById('metaConnInfo').style.display = '';
    document.getElementById('metaCancelEditBtn').style.display = 'none';
}

async function disconnectMeta() {
    if (!confirm(t('ad_meta_disconnect_confirm', '¿Desconectar WhatsApp Business de este agente?'))) return;
    try {
        const response = await fetch(`/api/meta/credentials/remove/${agentId}`, {
            method: 'DELETE',
            credentials: 'include',
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        showMetaStatus(true, t('ad_meta_disconnected', 'WhatsApp Business desconectado'));
        await loadMetaConnection();
    } catch (error) {
        showMetaStatus(false, error.message);
    }
}

async function copyMetaValue(elementId, btn) {
    const text = document.getElementById(elementId).textContent.trim();
    if (!text || text === '--') return;
    try {
        await navigator.clipboard.writeText(text);
        const icon = btn.querySelector('i');
        icon.className = 'lni lni-checkmark';
        setTimeout(() => { icon.className = 'lni lni-copy'; }, 1500);
    } catch (e) {
        console.error('No se pudo copiar', e);
    }
}

// Badge de plataforma del encabezado (misma lógica que getPlatformBadge en my-agents.js)
function renderPlatformBadge(agent) {
    const botType = (agent.botType || '').toLowerCase();
    const icon = document.querySelector('#agentPlatform i');
    const name = document.getElementById('agentPlatformName');
    if (!icon || !name) return;

    if (botType === 'telegram') {
        icon.className = 'lni lni-telegram-original';
        name.textContent = 'Telegram';
    } else if (botType === 'orbital' || botType === 'builderbot') {
        icon.className = 'lni lni-whatsapp';
        name.textContent = 'WhatsApp Business';
    } else {
        icon.className = 'lni lni-whatsapp';
        name.textContent = 'WhatsApp';
    }
}