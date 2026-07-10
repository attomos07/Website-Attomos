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
    
    // Basic Info
    document.getElementById('infoName').textContent = agent.name;
    document.getElementById('infoPhone').textContent = agent.phoneNumber || (window.Translations?.dict?.[getLang()]?.ad_not_configured || 'No configurado');
    document.getElementById('infoBusinessType').textContent = formatBusinessType(agent.businessType);
    document.getElementById('infoPort').textContent = agent.port || '--';
    
    // Configuration
    if (agent.config) {
        document.getElementById('configTone').textContent = formatTone(agent.config.tone);
        
        const languages = [...(agent.config.languages || []), ...(agent.config.additionalLanguages || [])];
        document.getElementById('configLanguages').textContent = languages.length > 0 
            ? languages.join(', ') 
            : (window.Translations?.dict?.[getLang()]?.ad_not_configured || 'No configurado');
        
        document.getElementById('configWelcome').textContent = 
            agent.config.welcomeMessage || (window.Translations?.dict?.[getLang()]?.ad_not_configured || 'No configurado');
        
        // Schedule
        renderSchedule(agent.config.schedule);
        
        // Services
        renderServices(agent.config.services);
        
        // Workers
        renderWorkers(agent.config.workers);
    }
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
        casual: t('ad_tone_casual', 'Casual')
    };
    return tones[tone] || tone.charAt(0).toUpperCase() + tone.slice(1);
}

// Toggle agent status
async function toggleAgentStatus() {
    if (!agent) return;
    
    const isPausing = agent.isActive;
    const actionWord = isPausing ? t('ad_confirm_pause', 'pausar') : t('ad_confirm_activate', 'activar');
    const confirmMsg = t('ad_confirm_action', '¿Estás seguro de que quieres {action} este agente?').replace('{action}', actionWord);

    if (!confirm(confirmMsg)) {
        return;
    }
    
    try {
        const response = await fetch(`/api/agents/${agentId}/toggle`, {
            method: 'PATCH',
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error('Error cambiando estado del agente');
        }
        
        await loadAgentDetails();
        const pastWord = isPausing ? t('ad_agent_paused', 'pausado') : t('ad_agent_activated', 'activado');
        alert(`${t('ad_agent_word', 'Agente')} ${pastWord} ${t('ad_successfully', 'exitosamente')}`);
    } catch (error) {
        console.error('❌ Error:', error);
        alert(t('ad_toggle_error', 'Error cambiando el estado del agente. Por favor intenta de nuevo.'));
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