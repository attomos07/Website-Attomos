// Agent Details Page functionality

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
        toggleText.textContent = 'Pausar';
    } else {
        toggleIcon.className = 'lni lni-play';
        toggleText.textContent = 'Activar';
    }
    
    // Basic Info
    document.getElementById('infoName').textContent = agent.name;
    document.getElementById('infoPhone').textContent = agent.phoneNumber || 'No configurado';
    document.getElementById('infoBusinessType').textContent = formatBusinessType(agent.businessType);
    document.getElementById('infoPort').textContent = agent.port || '--';
    
    // Configuration
    if (agent.config) {
        document.getElementById('configTone').textContent = formatTone(agent.config.tone);
        
        const languages = [...(agent.config.languages || []), ...(agent.config.additionalLanguages || [])];
        document.getElementById('configLanguages').textContent = languages.length > 0 
            ? languages.join(', ') 
            : 'No configurado';
        
        document.getElementById('configWelcome').textContent = 
            agent.config.welcomeMessage || 'No hay mensaje de bienvenida configurado';
        
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
        statusBadge.innerHTML = '<span class="status-dot"></span><span>Activo</span>';
    } else if (agent.deployStatus === 'pending' || agent.deployStatus === 'deploying') {
        statusBadge.classList.add('pending');
        statusBadge.innerHTML = '<span class="status-dot"></span><span>Desplegando</span>';
    } else if (agent.deployStatus === 'error') {
        statusBadge.classList.add('inactive');
        statusBadge.innerHTML = '<span class="status-dot"></span><span>Error</span>';
    } else {
        statusBadge.classList.add('inactive');
        statusBadge.innerHTML = '<span class="status-dot"></span><span>Inactivo</span>';
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
            <h3>¡WhatsApp Conectado!</h3>
            <p>Tu bot está conectado y funcionando</p>
            <div style="margin-top: 1rem; padding: 0.75rem; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 8px;">
                <p style="margin: 0; color: #065f46; font-size: 0.85rem;">
                    <i class="lni lni-information"></i>
                    Monitoreando conexión cada 15 segundos
                </p>
            </div>
        </div>
    `;
}

// Display QR loading state
function displayQRLoading(message) {
    const qrContainer = document.getElementById('qrContainer');
    
    // Traducir mensajes al español
    const translations = {
        'Starting bot, waiting for QR code...': 'Iniciando bot, esperando código QR...',
        'Waiting for QR code...': 'Esperando código QR...',
        'bot iniciando, esperando código QR': 'Bot iniciando, esperando código QR...',
        'This usually takes 5-15 seconds': 'Esto usualmente toma 5-15 segundos'
    };
    
    let translatedMessage = message;
    for (const [eng, esp] of Object.entries(translations)) {
        if (message.toLowerCase().includes(eng.toLowerCase())) {
            translatedMessage = esp;
            break;
        }
    }
    
    // Determinar el ícono y color según el mensaje
    let icon = 'lni-hourglass';
    let statusClass = 'loading';
    
    if (translatedMessage.toLowerCase().includes('iniciando')) {
        icon = 'lni-rocket';
        statusClass = 'starting';
    } else if (translatedMessage.toLowerCase().includes('esperando')) {
        icon = 'lni-timer';
        statusClass = 'waiting';
    }
    
    qrContainer.innerHTML = `
        <div class="qr-loading ${statusClass}">
            <div class="loading-spinner"></div>
            <i class="lni ${icon}" style="font-size: 2rem; color: #06b6d4; margin-top: 1rem;"></i>
            <p>${escapeHtml(translatedMessage)}</p>
            <small style="color: #9ca3af; margin-top: 0.5rem;">
                Esto usualmente toma 5-15 segundos
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
            <p>No se pudo cargar el código QR</p>
            <button class="btn-secondary btn-sm" onclick="loadQRCode()">
                <i class="lni lni-reload"></i>
                Reintentar
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
        document.getElementById('scheduleGrid').innerHTML = '<p class="no-data">No hay horario configurado</p>';
        return;
    }
    
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const dayNames = {
        monday: 'Lunes',
        tuesday: 'Martes',
        wednesday: 'Miércoles',
        thursday: 'Jueves',
        friday: 'Viernes',
        saturday: 'Sábado',
        sunday: 'Domingo'
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
                        : '<span class="closed">Cerrado</span>'
                    }
                </div>
            </div>
        `;
    }).join('');
    
    document.getElementById('scheduleGrid').innerHTML = scheduleHTML || '<p class="no-data">No hay horario configurado</p>';
}

// Render services
function renderServices(services) {
    if (!services || services.length === 0) {
        document.getElementById('servicesList').innerHTML = '<p class="no-data">No hay servicios configurados</p>';
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
        document.getElementById('workersList').innerHTML = '<p class="no-data">No hay personal configurado</p>';
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
    if (!days || days.length === 0) return 'Sin días configurados';
    
    const dayAbbr = {
        monday: 'Lun',
        tuesday: 'Mar',
        wednesday: 'Mié',
        thursday: 'Jue',
        friday: 'Vie',
        saturday: 'Sáb',
        sunday: 'Dom'
    };
    
    return days.map(day => `<span class="day-badge">${dayAbbr[day] || day}</span>`).join('');
}

// Format business type
function formatBusinessType(type) {
    if (!type) return 'No especificado';
    return type.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

// Format tone
function formatTone(tone) {
    if (!tone) return 'No especificado';
    const tones = {
        formal: 'Formal',
        friendly: 'Amigable',
        casual: 'Casual'
    };
    return tones[tone] || tone.charAt(0).toUpperCase() + tone.slice(1);
}

// Toggle agent status
async function toggleAgentStatus() {
    if (!agent) return;
    
    const action = agent.isActive ? 'pausar' : 'activar';
    
    if (!confirm(`¿Estás seguro de que quieres ${action} este agente?`)) {
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
        alert(`Agente ${action === 'pausar' ? 'pausado' : 'activado'} exitosamente`);
    } catch (error) {
        console.error('❌ Error:', error);
        alert('Error cambiando el estado del agente. Por favor intenta de nuevo.');
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