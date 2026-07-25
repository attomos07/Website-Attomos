// ============================================
// INTEGRATIONS JAVASCRIPT - ACTUALIZADO CON WEBHOOK AUTOMÁTICO
// ============================================

function getLang() { return localStorage.getItem('attomos_lang') || localStorage.getItem('lang') || 'es'; }
function t(key, fallback) { return window.Translations?.dict?.[getLang()]?.[key] || fallback; }

document.addEventListener('DOMContentLoaded', function() {
    console.log('🔧 Integrations JS cargado correctamente');
    
    initAgentSelector();
    initGoogleIntegration();
    initGeminiIntegration();
    initMetaIntegration();
    initPaymentsIntegration();
    initRepairDeskIntegration();
    initSoftRestaurantIntegration();
    detectGubernamental();
    
    console.log('✅ Integrations funcionalidades inicializadas');
});

// ============================================
// RE-TRADUCIR BADGES DE ESTADO AL CAMBIAR DE IDIOMA
// Los badges se pintan una sola vez en el idioma activo al conectar/
// desconectar; si el usuario cambia de idioma después sin disparar
// esa acción, este listener actualiza el texto sin volver a pedir
// datos al servidor ni reengachar los botones (evita listeners duplicados).
// ============================================
const STATUS_BADGE_KEY_MAP = {
    metaStatusBadge:            { connected: 'integ_status_configured', disconnected: 'integ_status_not_configured' },
    geminiStatusBadge:          { connected: 'integ_status_configured', disconnected: 'integ_status_not_configured' },
    googleStatusBadge:          { connected: 'integ_status_connected',  disconnected: 'integ_status_disconnected' },
    sheetsStatusBadge:          { connected: 'integ_status_connected',  disconnected: 'integ_status_disconnected' },
    speiStatusBadge:            { connected: 'integ_status_configured', disconnected: 'integ_status_not_configured' },
    stripeConnectStatusBadge:   { connected: 'integ_status_connected',  disconnected: 'integ_status_disconnected' },
    paymentsStatusBadge:        { connected: 'integ_status_configured', disconnected: 'integ_status_without_config' },
    repairDeskStatusBadge:      { connected: 'integ_status_connected',  disconnected: 'integ_status_disconnected' },
    sheetsInventoryStatusBadge: { connected: 'integ_status_connected',  disconnected: 'integ_status_disconnected' },
    srStatusBadge:               { connected: 'integ_status_connected',  disconnected: 'integ_status_disconnected' },
};

function refreshIntegrationBadgesLanguage() {
    Object.keys(STATUS_BADGE_KEY_MAP).forEach(id => {
        const badge = document.getElementById(id);
        if (!badge) return;
        const state = badge.classList.contains('connected') ? 'connected' : 'disconnected';
        const key = STATUS_BADGE_KEY_MAP[id][state];
        const fallback = badge.textContent.trim();
        badge.innerHTML = `<span class="status-indicator"></span>${t(key, fallback)}`;
    });
}

document.addEventListener('attomos:langchange', refreshIntegrationBadgesLanguage);

// ============================================
// DETECCIÓN GUBERNAMENTAL
// ============================================

async function detectGubernamental() {
    try {
        const res  = await fetch('/api/me', { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        const biz  = (data.user?.businessType || '').toLowerCase();
        if (biz.includes('gubernamental')) applyGovContext();
    } catch {}
}

function applyGovContext() {
    // Sheets
    toggleGovBusiness('.sheets-desc-business', '.sheets-desc-gov');
    toggleGovBusiness('.sheets-feat-business', '.sheets-feat-gov');
    toggleGovBusiness('.sheets-cols-business', '.sheets-cols-gov');
    toggleGovBusiness('.sheets-link-label-business', '.sheets-link-label-gov');
    // Calendar
    toggleGovBusiness('.cal-desc-business', '.cal-desc-gov');
    toggleGovBusiness('.cal-feat-business', '.cal-feat-gov');
    toggleGovBusiness('.cal-btn-business',  '.cal-btn-gov');
}

function toggleGovBusiness(bizSel, govSel) {
    document.querySelectorAll(bizSel).forEach(el => el.style.display = 'none');
    document.querySelectorAll(govSel).forEach(el => el.style.display = '');
}

// ============================================
// GLOBAL STATE
// ============================================

let selectedAgentId = null;
let selectedAgent = null;
let agents = [];

// Guard compartido para todas las acciones de guardar/conectar que requieren
// un agente. Da un mensaje distinto según el caso: si el usuario no tiene
// ningún agente creado, lo manda a crear uno; si ya tiene pero no eligió,
// le pide que seleccione. Las tarjetas de integración siempre se ven todas
// desde que entras a la página — esto solo bloquea la ACCIÓN, no la vista.
function requireAgentSelected() {
    if (selectedAgentId) return true;
    if (agents.length === 0) {
        showNotification(t('integ_err_create_agent_first', 'Primero crea un agente para poder conectar integraciones'), 'error');
    } else {
        showNotification(t('integ_err_select_agent', 'Por favor selecciona un agente primero'), 'error');
    }
    return false;
}

// ============================================
// AGENT SELECTOR
// ============================================

async function initAgentSelector() {
    console.log('📊 Cargando agentes...');

    // Las tarjetas de integración se ven todas desde el inicio, sin
    // importar si hay agentes o no — solo GUARDAR/CONECTAR requiere
    // haber elegido un agente (ver requireAgentSelected()).
    showIntegrationsGrid();

    try {
        const response = await fetch('/api/agents', {
            method: 'GET',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(t('integ_err_load_agents','Error al cargar agentes'));
        }

        const data = await response.json();
        agents = data.agents || [];

        console.log(`✅ ${agents.length} agentes cargados`, agents);

        if (agents.length === 0) {
            showNoAgentsBanner();
            return;
        }

        hideNoAgentsBanner();
        populateAgentSelector(agents);
        setupAgentSelectorEvents();

    } catch (error) {
        console.error('Error cargando agentes:', error);
        showNotification(t('integ_err_load_agents','Error al cargar agentes'), 'error');
    }
}

function populateAgentSelector(agents) {
    const optionsContainer = document.getElementById('agentSelectOptions');
    if (!optionsContainer) return;
    
    optionsContainer.innerHTML = '';
    
    agents.forEach(agent => {
        const option = document.createElement('div');
        option.className = 'select-option';
        option.setAttribute('data-agent-id', agent.id);
        option.setAttribute('data-bot-type', agent.botType);
        option.textContent = agent.name;
        optionsContainer.appendChild(option);
    });
}

function setupAgentSelectorEvents() {
    const selectWrapper = document.getElementById('agentSelect');
    const selectDisplay = document.getElementById('agentSelectDisplay');
    const dropdown = document.getElementById('agentSelectDropdown');
    const options = document.querySelectorAll('.select-option');
    
    if (!selectWrapper || !selectDisplay || !dropdown) return;
    
    selectDisplay.addEventListener('click', function(e) {
        e.stopPropagation();
        toggleAgentDropdown();
    });
    
    options.forEach(option => {
        option.addEventListener('click', function(e) {
            e.stopPropagation();
            selectAgent(this);
        });
    });
    
    document.addEventListener('click', function(e) {
        if (!selectWrapper.contains(e.target)) {
            closeAgentDropdown();
        }
    });
}

function toggleAgentDropdown() {
    const selectWrapper = document.getElementById('agentSelect');
    const isActive = selectWrapper.classList.contains('active');
    
    if (isActive) {
        closeAgentDropdown();
    } else {
        openAgentDropdown();
    }
}

function openAgentDropdown() {
    const selectWrapper = document.getElementById('agentSelect');
    selectWrapper.classList.add('active');
}

function closeAgentDropdown() {
    const selectWrapper = document.getElementById('agentSelect');
    selectWrapper.classList.remove('active');
}

async function selectAgent(option) {
    const agentId = option.getAttribute('data-agent-id');
    const botType = option.getAttribute('data-bot-type');
    const agentName = option.textContent;
    
    selectedAgentId = parseInt(agentId);
    selectedAgent = agents.find(a => a.id === selectedAgentId);
    
    const selectDisplay = document.getElementById('agentSelectDisplay');
    selectDisplay.textContent = agentName;
    selectDisplay.removeAttribute('data-translate'); // ya no es el placeholder — no debe re-traducirse al cambiar idioma
    
    const allOptions = document.querySelectorAll('.select-option');
    allOptions.forEach(opt => opt.classList.remove('selected'));
    option.classList.add('selected');
    
    closeAgentDropdown();
    
    console.log(`✅ Agente seleccionado: ${agentName} (ID: ${agentId}, Tipo: ${botType})`);
    
    showIntegrationsGrid();
    
    // Mostrar/ocultar tarjetas según el tipo de bot
    showIntegrationsByBotType(botType);
    
    // 🔧 NUEVO: Mostrar webhook URL inmediatamente si es OrbitalBot
    if (botType === 'orbital') {
        updateWebhookUrl(selectedAgentId);
    }
    
    // Load integration statuses
    await loadGoogleIntegrationStatus(selectedAgentId);

    // Cargar config de pagos (disponible para todos los bots)
    const branchId = selectedAgent && selectedAgent.branchId ? selectedAgent.branchId : null;
    if (branchId) await loadPaymentConfig(branchId);

    // RepairDesk: disponible para todos los bots
    await loadRepairDeskStatus(selectedAgentId);

    // Sheets Inventarios (VIN + fotos vía IA): disponible para todos los bots
    await loadInventorySheetStatus(selectedAgentId);

    // SoftRestaurant: disponible para todos los bots
    await loadSoftRestaurantStatus(selectedAgentId);
    
    if (botType === 'atomic') {
        await loadGeminiStatus(selectedAgentId);
    } else if (botType === 'orbital') {
        await loadMetaCredentialsStatus(selectedAgentId);
    }
}

function showIntegrationsByBotType(botType) {
    const geminiCard         = document.getElementById('geminiCard');
    const metaCard           = document.getElementById('metaCard');
    const paymentsCard       = document.getElementById('paymentsCard');
    const repairDeskCard     = document.getElementById('repairDeskCard');
    const softRestaurantCard = document.getElementById('softRestaurantCard');

    if (botType === 'atomic') {
        if (geminiCard) geminiCard.style.display = 'block';
        if (metaCard)   metaCard.style.display   = 'none';
    } else if (botType === 'orbital') {
        if (geminiCard) geminiCard.style.display = 'none';
        if (metaCard)   metaCard.style.display   = 'block';
    }
    if (paymentsCard)       paymentsCard.style.display       = 'block';
    if (repairDeskCard)     repairDeskCard.style.display     = 'block';
    if (softRestaurantCard) softRestaurantCard.style.display = 'block';
}

function showIntegrationsGrid() {
    const grid = document.getElementById('integrationsGrid');
    const emptyState = document.getElementById('emptyState');

    // El grid ya es visible por CSS (display:grid) desde que carga la
    // página — esto solo se asegura de que ningún estado previo lo haya
    // ocultado, y muestra TODAS las tarjetas por defecto (Gemini y Meta
    // incluidas) hasta que se sepa el tipo de bot del agente elegido.
    if (grid) grid.style.display = 'grid';
    if (emptyState) emptyState.classList.remove('active');

    const geminiCard = document.getElementById('geminiCard');
    const metaCard = document.getElementById('metaCard');
    if (geminiCard) geminiCard.style.display = 'block';
    if (metaCard) metaCard.style.display = 'block';
}

function showNoAgentsBanner() {
    const banner = document.getElementById('noAgentsBanner');
    const agentSelector = document.querySelector('.agent-selector');
    if (banner) banner.style.display = 'flex';
    // No hay agentes que elegir — ocultamos el selector (vacío) pero
    // dejamos las tarjetas de integración visibles debajo del banner.
    if (agentSelector) agentSelector.style.display = 'none';
}

function hideNoAgentsBanner() {
    const banner = document.getElementById('noAgentsBanner');
    const agentSelector = document.querySelector('.agent-selector');
    if (banner) banner.style.display = 'none';
    if (agentSelector) agentSelector.style.display = 'block';
}

// ============================================
// META WHATSAPP INTEGRATION
// ============================================

function initMetaIntegration() {
    const toggleToken = document.getElementById('toggleMetaToken');
    const toggleVerify = document.getElementById('toggleMetaVerify');
    const saveButton = document.getElementById('btnSaveMetaCredentials');
    const updateButton = document.getElementById('btnUpdateMetaCredentials');
    const removeButton = document.getElementById('btnRemoveMetaCredentials');
    
    if (toggleToken) {
        toggleToken.addEventListener('click', () => toggleMetaVisibility('metaAccessToken', 'toggleMetaToken'));
    }
    
    if (toggleVerify) {
        toggleVerify.addEventListener('click', () => toggleMetaVisibility('metaVerifyToken', 'toggleMetaVerify'));
    }
    
    // Enable save button when all fields have content
    const inputs = ['metaPhoneNumberId', 'metaAccessToken', 'metaWabaId', 'metaVerifyToken'];
    inputs.forEach(inputId => {
        const input = document.getElementById(inputId);
        if (input) {
            input.addEventListener('input', function() {
                if (saveButton) {
                    const allFilled = inputs.every(id => {
                        const el = document.getElementById(id);
                        return el && el.value.trim();
                    });
                    saveButton.disabled = !allFilled;
                }
            });
        }
    });
    
    if (saveButton) {
        saveButton.addEventListener('click', saveMetaCredentials);
    }
    
    if (updateButton) {
        updateButton.addEventListener('click', enableMetaEdit);
    }
    
    if (removeButton) {
        removeButton.addEventListener('click', removeMetaCredentials);
    }
}

function toggleMetaVisibility(inputId, buttonId) {
    const input = document.getElementById(inputId);
    const button = document.getElementById(buttonId);
    
    if (!input || !button) return;
    
    const icon = button.querySelector('i');
    
    if (input.type === 'password') {
        input.type = 'text';
        icon.className = 'lni lni-eye-slash';
    } else {
        input.type = 'password';
        icon.className = 'lni lni-eye';
    }
}

async function loadMetaCredentialsStatus(agentId) {
    if (!agentId) {
        console.warn('⚠️ No agent ID provided for Meta credentials status');
        return;
    }
    
    console.log(`🔍 Cargando estado de credenciales Meta para agente ${agentId}...`);
    
    try {
        const response = await fetch(`/api/meta/credentials/status/${agentId}`, {
            method: 'GET',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error('Error al cargar estado de credenciales');
        }

        const data = await response.json();
        console.log('✅ Estado de credenciales Meta recibido:', data);
        
        updateMetaCredentialsUI(data);
        
    } catch (error) {
        console.error('Error cargando estado de credenciales Meta:', error);
    }
}

function updateMetaCredentialsUI(data) {
    const statusBadge = document.getElementById('metaStatusBadge');
    const inputs = {
        phoneNumberId: document.getElementById('metaPhoneNumberId'),
        accessToken: document.getElementById('metaAccessToken'),
        wabaId: document.getElementById('metaWabaId'),
        verifyToken: document.getElementById('metaVerifyToken')
    };
    
    const toggleButtons = {
        token: document.getElementById('toggleMetaToken'),
        verify: document.getElementById('toggleMetaVerify')
    };
    
    const saveActions = document.getElementById('metaActions');
    const manageActions = document.getElementById('metaManageActions');
    const connectionInfo = document.getElementById('metaConnectionInfo');
    
    if (data.has_credentials && data.connected) {
        // Credenciales configuradas
        if (statusBadge) {
            statusBadge.className = 'status-badge connected';
            statusBadge.innerHTML = `
                <span class="status-indicator"></span>
                ${t('integ_status_configured','Configurado')}
            `;
        }
        
        // Disable inputs y mostrar valores enmascarados
        Object.values(inputs).forEach(input => {
            if (input) {
                input.value = '••••••••••••••••';
                input.disabled = true;
            }
        });
        
        Object.values(toggleButtons).forEach(btn => {
            if (btn) btn.disabled = true;
        });
        
        if (connectionInfo) {
            connectionInfo.style.display = 'block';
            
            const phoneNumber = document.getElementById('metaDisplayNumber');
            const verifiedName = document.getElementById('metaVerifiedName');
            const connectedAt = document.getElementById('metaConnectedAt');
            
            if (phoneNumber && data.display_number) {
                phoneNumber.textContent = data.display_number;
            }
            
            if (verifiedName && data.verified_name) {
                verifiedName.textContent = data.verified_name;
            }
            
            if (connectedAt && data.connected_at) {
                const date = new Date(data.connected_at);
                connectedAt.textContent = formatDate(date);
            }
        }
        
        if (saveActions) saveActions.style.display = 'none';
        if (manageActions) manageActions.style.display = 'flex';
        
        // 🔧 NUEVO: SIEMPRE mostrar Webhook URL para OrbitalBot
        if (data.bot_type === 'orbital') {
            updateWebhookUrl(selectedAgentId);
        }
        
    } else {
        // Sin credenciales
        if (statusBadge) {
            statusBadge.className = 'status-badge disconnected';
            statusBadge.innerHTML = `
                <span class="status-indicator"></span>
                ${t('integ_status_not_configured','Sin configurar')}
            `;
        }
        
        Object.values(inputs).forEach(input => {
            if (input) {
                input.value = '';
                input.disabled = false;
            }
        });
        
        Object.values(toggleButtons).forEach(btn => {
            if (btn) btn.disabled = false;
        });
        
        if (connectionInfo) connectionInfo.style.display = 'none';
        if (saveActions) saveActions.style.display = 'flex';
        if (manageActions) manageActions.style.display = 'none';
        
        // 🔧 NUEVO: TAMBIÉN mostrar Webhook URL para OrbitalBot (aunque no tenga credenciales)
        if (data.bot_type === 'orbital') {
            updateWebhookUrl(selectedAgentId);
        }
    }
}

async function saveMetaCredentials() {
    if (!requireAgentSelected()) return;
    
    const phoneNumberId = document.getElementById('metaPhoneNumberId').value.trim();
    const accessToken = document.getElementById('metaAccessToken').value.trim();
    const wabaId = document.getElementById('metaWabaId').value.trim();
    const verifyToken = document.getElementById('metaVerifyToken').value.trim();
    
    if (!phoneNumberId || !accessToken || !wabaId || !verifyToken) {
        showNotification(t('integ_err_fill_fields','Por favor completa todos los campos'), 'error');
        return;
    }
    
    console.log(`💾 Guardando credenciales de Meta para agente ${selectedAgentId}...`);
    
    const btnSave = document.getElementById('btnSaveMetaCredentials');
    const originalText = btnSave.innerHTML;
    
    btnSave.innerHTML = `
        <div class="loading-spinner"></div>
        <span>Guardando...</span>
    `;
    btnSave.disabled = true;
    
    try {
        const response = await fetch(`/api/meta/credentials/save/${selectedAgentId}`, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                phone_number_id: phoneNumberId,
                access_token: accessToken,
                waba_id: wabaId,
                verify_token: verifyToken
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Error al guardar credenciales');
        }

        const data = await response.json();
        console.log('✅ Credenciales guardadas:', data);
        
        showNotification(t('integ_ok_credentials_saved','Credenciales guardadas exitosamente'), 'success');
        await loadMetaCredentialsStatus(selectedAgentId);
        
    } catch (error) {
        console.error('Error guardando credenciales Meta:', error);
        showNotification(error.message || t('integ_err_save_credentials','Error al guardar credenciales'), 'error');
        
        btnSave.innerHTML = originalText;
        btnSave.disabled = false;
    }
}

function enableMetaEdit() {
    const inputs = {
        phoneNumberId: document.getElementById('metaPhoneNumberId'),
        accessToken: document.getElementById('metaAccessToken'),
        wabaId: document.getElementById('metaWabaId'),
        verifyToken: document.getElementById('metaVerifyToken')
    };
    
    const toggleButtons = {
        token: document.getElementById('toggleMetaToken'),
        verify: document.getElementById('toggleMetaVerify')
    };
    
    const saveActions = document.getElementById('metaActions');
    const manageActions = document.getElementById('metaManageActions');
    const connectionInfo = document.getElementById('metaConnectionInfo');
    
    Object.values(inputs).forEach(input => {
        if (input) {
            input.value = '';
            input.disabled = false;
        }
    });
    
    Object.values(toggleButtons).forEach(btn => {
        if (btn) btn.disabled = false;
    });
    
    if (connectionInfo) connectionInfo.style.display = 'none';
    if (saveActions) saveActions.style.display = 'flex';
    if (manageActions) manageActions.style.display = 'none';
    
    // 🔧 MODIFICADO: NO ocultar webhook URL - debe permanecer visible siempre
    // La URL del webhook debe estar visible en todo momento para OrbitalBot
    
    if (inputs.phoneNumberId) inputs.phoneNumberId.focus();
}

async function removeMetaCredentials() {
    if (!requireAgentSelected()) return;
    
    if (!confirm('¿Estás seguro de que quieres eliminar las credenciales de Meta WhatsApp? Esto desconectará tu bot.')) {
        return;
    }
    
    console.log(`🗑️ Eliminando credenciales de Meta para agente ${selectedAgentId}...`);
    
    const btnRemove = document.getElementById('btnRemoveMetaCredentials');
    const originalText = btnRemove.innerHTML;
    
    btnRemove.innerHTML = `
        <div class="loading-spinner"></div>
        <span>Eliminando...</span>
    `;
    btnRemove.disabled = true;
    
    try {
        const response = await fetch(`/api/meta/credentials/remove/${selectedAgentId}`, {
            method: 'DELETE',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(t('integ_err_remove_credentials','Error al eliminar credenciales'));
        }

        const data = await response.json();
        console.log('✅ Credenciales eliminadas:', data);
        
        showNotification(t('integ_ok_credentials_removed','Credenciales eliminadas exitosamente'), 'success');
        await loadMetaCredentialsStatus(selectedAgentId);
        
    } catch (error) {
        console.error('Error eliminando credenciales Meta:', error);
        showNotification(t('integ_err_remove_credentials','Error al eliminar credenciales'), 'error');
        
        btnRemove.innerHTML = originalText;
        btnRemove.disabled = false;
    }
}

// ============================================
// 🔧 NUEVAS FUNCIONES: WEBHOOK URL
// ============================================

function updateWebhookUrl(agentId) {
    const webhookUrlCode = document.getElementById('webhookUrl');
    const copyButton = document.getElementById('btnCopyWebhook');
    
    if (!webhookUrlCode || !copyButton) return;
    
    // Construir la URL del webhook
    const baseUrl = window.location.origin;
    const webhookUrl = `${baseUrl}/webhook/meta/${agentId}`;
    
    webhookUrlCode.textContent = webhookUrl;
    copyButton.style.display = 'inline-flex';
    
    // Agregar event listener al botón de copiar si no existe
    if (!copyButton.dataset.listenerAdded) {
        copyButton.addEventListener('click', function() {
            copyWebhookUrl(webhookUrl, this);
        });
        copyButton.dataset.listenerAdded = 'true';
    }
}

function copyWebhookUrl(url, button) {
    navigator.clipboard.writeText(url).then(() => {
        const originalHTML = button.innerHTML;
        button.classList.add('copied');
        button.innerHTML = `
            <i class="lni lni-checkmark"></i>
            Copiado
        `;
        
        setTimeout(() => {
            button.classList.remove('copied');
            button.innerHTML = originalHTML;
        }, 2000);
        
        showNotification(t('integ_ok_webhook_copied','URL del webhook copiada al portapapeles'), 'success');
    }).catch(err => {
        console.error('Error al copiar:', err);
        showNotification(t('integ_err_copy','Error al copiar URL'), 'error');
    });
}

// ============================================
// GEMINI AI INTEGRATION
// ============================================

function initGeminiIntegration() {
    const saveButton = document.getElementById('btnSaveGeminiKey');
    const removeButton = document.getElementById('btnRemoveGeminiKey');
    const updateButton = document.getElementById('btnUpdateGeminiKey');
    const toggleButton = document.getElementById('toggleGeminiKey');
    const apiKeyInput = document.getElementById('geminiApiKey');
    
    if (toggleButton) {
        toggleButton.addEventListener('click', () => {
            const icon = toggleButton.querySelector('i');
            if (apiKeyInput.type === 'password') {
                apiKeyInput.type = 'text';
                icon.className = 'lni lni-eye-slash';
            } else {
                apiKeyInput.type = 'password';
                icon.className = 'lni lni-eye';
            }
        });
    }
    
    if (apiKeyInput) {
        apiKeyInput.addEventListener('input', function() {
            if (saveButton) {
                saveButton.disabled = !this.value.trim();
            }
        });
    }
    
    if (saveButton) {
        saveButton.addEventListener('click', saveGeminiKey);
    }
    
    if (updateButton) {
        updateButton.addEventListener('click', enableGeminiEdit);
    }
    
    if (removeButton) {
        removeButton.addEventListener('click', removeGeminiKey);
    }
}

function enableGeminiEdit() {
    const apiKeyInput = document.getElementById('geminiApiKey');
    const toggleButton = document.getElementById('toggleGeminiKey');
    const saveActions = document.getElementById('geminiActions');
    const manageActions = document.getElementById('geminiManageActions');
    const connectionInfo = document.getElementById('geminiConnectionInfo');
    
    if (apiKeyInput) { apiKeyInput.value = ''; apiKeyInput.disabled = false; apiKeyInput.focus(); }
    if (toggleButton) toggleButton.disabled = false;
    if (connectionInfo) connectionInfo.style.display = 'none';
    if (saveActions) saveActions.style.display = 'flex';
    if (manageActions) manageActions.style.display = 'none';
}

async function loadGeminiStatus(agentId) {
    if (!agentId) {
        console.warn('⚠️ No agent ID provided for Gemini status');
        return;
    }
    
    console.log(`🔍 Cargando estado de Gemini para agente ${agentId}...`);
    
    try {
        const response = await fetch(`/api/gemini/status/${agentId}`, {
            method: 'GET',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error('Error al cargar estado de Gemini');
        }

        const data = await response.json();
        console.log('✅ Estado de Gemini recibido:', data);
        
        updateGeminiUI(data);
        
    } catch (error) {
        console.error('Error cargando estado de Gemini:', error);
    }
}

function updateGeminiUI(data) {
    const statusBadge = document.getElementById('geminiStatusBadge');
    const apiKeyInput = document.getElementById('geminiApiKey');
    const toggleButton = document.getElementById('toggleGeminiKey');
    const saveActions = document.getElementById('geminiActions');
    const manageActions = document.getElementById('geminiManageActions');
    const connectionInfo = document.getElementById('geminiConnectionInfo');
    
    if (data.has_key && data.configured) {
        // API Key configurada
        if (statusBadge) {
            statusBadge.className = 'status-badge connected';
            statusBadge.innerHTML = `
                <span class="status-indicator"></span>
                ${t('integ_status_configured','Configurado')}
            `;
        }
        
        if (apiKeyInput) {
            apiKeyInput.value = '••••••••••••••••••••••••••••••••';
            apiKeyInput.disabled = true;
        }
        
        if (toggleButton) toggleButton.disabled = true;
        if (connectionInfo) connectionInfo.style.display = 'block';
        if (saveActions) saveActions.style.display = 'none';
        if (manageActions) manageActions.style.display = 'flex';
        
    } else {
        // Sin API Key
        if (statusBadge) {
            statusBadge.className = 'status-badge disconnected';
            statusBadge.innerHTML = `
                <span class="status-indicator"></span>
                ${t('integ_status_not_configured','Sin configurar')}
            `;
        }
        
        if (apiKeyInput) {
            apiKeyInput.value = '';
            apiKeyInput.disabled = false;
        }
        
        if (toggleButton) toggleButton.disabled = false;
        if (connectionInfo) connectionInfo.style.display = 'none';
        if (saveActions) saveActions.style.display = 'flex';
        if (manageActions) manageActions.style.display = 'none';
    }
}

async function saveGeminiKey() {
    if (!requireAgentSelected()) return;
    
    const apiKey = document.getElementById('geminiApiKey').value.trim();
    
    if (!apiKey) {
        showNotification(t('integ_err_invalid_apikey','Por favor ingresa una API Key válida'), 'error');
        return;
    }
    
    console.log(`💾 Guardando Gemini API Key para agente ${selectedAgentId}...`);
    
    const btnSave = document.getElementById('btnSaveGeminiKey');
    const originalText = btnSave.innerHTML;
    
    btnSave.innerHTML = `
        <div class="loading-spinner"></div>
        <span>Guardando...</span>
    `;
    btnSave.disabled = true;
    
    try {
        const response = await fetch(`/api/gemini/save-key/${selectedAgentId}`, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                apiKey: apiKey
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Error al guardar API Key');
        }

        const data = await response.json();
        console.log('✅ Gemini API Key guardada:', data);
        
        showNotification(t('integ_ok_apikey_saved','API Key guardada exitosamente'), 'success');
        await loadGeminiStatus(selectedAgentId);
        
    } catch (error) {
        console.error('Error guardando Gemini API Key:', error);
        showNotification(error.message || t('integ_err_save_apikey','Error al guardar API Key'), 'error');
        
        btnSave.innerHTML = originalText;
        btnSave.disabled = false;
    }
}

async function removeGeminiKey() {
    if (!requireAgentSelected()) return;
    
    if (!confirm('¿Estás seguro de que quieres eliminar la Gemini API Key?')) {
        return;
    }
    
    console.log(`🗑️ Eliminando Gemini API Key para agente ${selectedAgentId}...`);
    
    const btnRemove = document.getElementById('btnRemoveGeminiKey');
    const originalText = btnRemove.innerHTML;
    
    btnRemove.innerHTML = `
        <div class="loading-spinner"></div>
        <span>Eliminando...</span>
    `;
    btnRemove.disabled = true;
    
    try {
        const response = await fetch(`/api/gemini/remove-key/${selectedAgentId}`, {
            method: 'DELETE',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(t('integ_err_remove_apikey','Error al eliminar API Key'));
        }

        const data = await response.json();
        console.log('✅ Gemini API Key eliminada:', data);
        
        showNotification(t('integ_ok_apikey_removed','API Key eliminada exitosamente'), 'success');
        await loadGeminiStatus(selectedAgentId);
        
    } catch (error) {
        console.error('Error eliminando Gemini API Key:', error);
        showNotification(t('integ_err_remove_apikey','Error al eliminar API Key'), 'error');
        
        btnRemove.innerHTML = originalText;
        btnRemove.disabled = false;
    }
}

// ============================================
// GOOGLE INTEGRATION (CALENDAR & SHEETS)
// ============================================

function initGoogleIntegration() {
    document.getElementById('btnConnectGoogle')?.addEventListener('click', () => connectGoogleService('calendar'));
    document.getElementById('btnDisconnectGoogle')?.addEventListener('click', () => disconnectGoogleService('calendar'));
    document.getElementById('btnReconnectGoogle')?.addEventListener('click', () => reconnectGoogleService('calendar'));

    document.getElementById('btnConnectSheets')?.addEventListener('click', () => connectGoogleService('sheets'));
    document.getElementById('btnDisconnectSheets')?.addEventListener('click', () => disconnectGoogleService('sheets'));
    document.getElementById('btnReconnectSheets')?.addEventListener('click', () => reconnectGoogleService('sheets'));

    // Escuchar el resultado del popup de OAuth (más rápido que esperar al
    // polling de popup.closed; el polling sigue como respaldo).
    window.addEventListener('message', (event) => {
        if (event.origin !== window.location.origin) return;
        if (!event.data || event.data.type !== 'google-oauth-result') return;

        if (event.data.success) {
            const label = event.data.service === 'sheets' ? 'Google Sheets' : 'Google Calendar';
            showNotification(`${label} conectado exitosamente`, 'success');
        } else {
            showNotification(t('integ_err_google_connect', 'Error al conectar con Google'), 'error');
        }
        if (selectedAgentId) loadGoogleIntegrationStatus(selectedAgentId);
    });
}

async function loadGoogleIntegrationStatus(agentId) {
    if (!agentId) {
        console.warn('⚠️ No agent ID provided for Google integration status');
        return;
    }

    console.log(`🔍 Cargando estado de Google para agente ${agentId}...`);

    try {
        const response = await fetch(`/api/google/status/${agentId}`, {
            method: 'GET',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error('Error al cargar estado de Google');
        }

        const data = await response.json();
        console.log('✅ Estado de Google recibido:', data);

        updateGoogleIntegrationUI(data);

    } catch (error) {
        console.error('Error cargando estado de Google:', error);
    }
}

function updateGoogleIntegrationUI(data) {
    // ── Calendar ─────────────────────────────────────────────────────────
    updateGoogleServiceCardUI({
        connected: data.calendar_connected,
        connectedAt: data.calendar_connected_at,
        statusBadgeId: 'googleStatusBadge',
        connectionInfoId: 'googleConnectionInfo',
        connectActionsId: 'googleConnectActions',
        manageActionsId: 'googleManageActions',
        connectButtonId: 'btnConnectGoogle',
        connectedAtElId: 'calendarConnectedAt',
        linkElId: 'calendarLink',
        linkUrl: data.calendar_url,
    });

    // ── Sheets ───────────────────────────────────────────────────────────
    updateGoogleServiceCardUI({
        connected: data.sheets_connected,
        connectedAt: data.sheets_connected_at,
        statusBadgeId: 'sheetsStatusBadge',
        connectionInfoId: 'sheetsConnectionInfo',
        connectActionsId: 'sheetsConnectActions',
        manageActionsId: 'sheetsManageActions',
        connectButtonId: 'btnConnectSheets',
        connectedAtElId: 'sheetsConnectedAt',
        linkElId: 'sheetLink',
        linkUrl: data.sheet_url,
    });
}

// Actualiza una tarjeta de servicio de Google (Calendar o Sheets) — misma
// lógica para ambas, solo cambian los IDs de los elementos del DOM.
function updateGoogleServiceCardUI(cfg) {
    const statusBadge = document.getElementById(cfg.statusBadgeId);
    const connectionInfo = document.getElementById(cfg.connectionInfoId);
    const connectActions = document.getElementById(cfg.connectActionsId);
    const manageActions = document.getElementById(cfg.manageActionsId);

    if (cfg.connected) {
        if (statusBadge) {
            statusBadge.className = 'status-badge connected';
            statusBadge.innerHTML = `
                <span class="status-indicator"></span>
                ${t('integ_status_connected','Conectado')}
            `;
        }

        if (connectionInfo) {
            connectionInfo.style.display = 'block';

            const linkEl = document.getElementById(cfg.linkElId);
            if (linkEl && cfg.linkUrl) linkEl.href = cfg.linkUrl;

            const connectedAtEl = document.getElementById(cfg.connectedAtElId);
            if (connectedAtEl && cfg.connectedAt) {
                connectedAtEl.textContent = formatDate(new Date(cfg.connectedAt));
            }
        }

        if (connectActions) connectActions.style.display = 'none';
        if (manageActions) manageActions.style.display = 'flex';

    } else {
        if (statusBadge) {
            statusBadge.className = 'status-badge disconnected';
            statusBadge.innerHTML = `
                <span class="status-indicator"></span>
                ${t('integ_status_disconnected','No conectado')}
            `;
        }

        if (connectionInfo) connectionInfo.style.display = 'none';
        if (connectActions) connectActions.style.display = 'flex';
        if (manageActions) manageActions.style.display = 'none';

        const connectButton = document.getElementById(cfg.connectButtonId);
        if (connectButton) connectButton.disabled = false;
    }
}

// service: 'calendar' | 'sheets'
async function connectGoogleService(service) {
    if (!requireAgentSelected()) return;

    console.log(`🔗 Iniciando conexión de Google ${service} para agente ${selectedAgentId}...`);

    try {
        const response = await fetch(`/api/google/connect?agent_id=${selectedAgentId}&service=${service}`, {
            method: 'GET',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error('Error al obtener URL de autorización');
        }

        const data = await response.json();

        // El backend ya tenía un token de Google (del otro servicio) y creó
        // el recurso directo, sin necesidad de mostrarle nada a Google otra vez.
        if (data.direct) {
            if (data.success) {
                if (!data.already_connected) {
                    const label = service === 'sheets' ? 'Google Sheets' : 'Google Calendar';
                    showNotification(`${label} conectado exitosamente`, 'success');
                }
                await loadGoogleIntegrationStatus(selectedAgentId);
            } else {
                showNotification(t('integ_err_google_connect', 'Error al conectar con Google'), 'error');
            }
            return;
        }

        if (!data.auth_url) {
            throw new Error('No se recibió URL de autorización');
        }

        const width = 600;
        const height = 700;
        const left = (window.screen.width - width) / 2;
        const top = (window.screen.height - height) / 2;

        const popup = window.open(
            data.auth_url,
            'GoogleOAuth',
            `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
        );

        if (!popup) {
            showNotification(t('integ_err_popups','Por favor permite ventanas emergentes para continuar'), 'error');
            return;
        }

        // El popup se cierra solo al terminar (avisa por postMessage arriba);
        // este polling queda como respaldo por si el postMessage no llega.
        const pollTimer = setInterval(async () => {
            if (popup.closed) {
                clearInterval(pollTimer);
                console.log('🔄 Ventana OAuth cerrada, verificando estado...');

                await new Promise(resolve => setTimeout(resolve, 1000));
                await loadGoogleIntegrationStatus(selectedAgentId);
            }
        }, 500);

    } catch (error) {
        console.error(`Error conectando Google ${service}:`, error);
        showNotification(t('integ_err_google_connect','Error al conectar con Google'), 'error');
    }
}

// service: 'calendar' | 'sheets'
async function disconnectGoogleService(service) {
    if (!requireAgentSelected()) return;

    const label = service === 'sheets' ? 'Google Sheets' : 'Google Calendar';
    if (!confirm(`¿Estás seguro de que quieres desconectar ${label}?`)) {
        return;
    }

    console.log(`🔌 Desconectando ${service} para agente ${selectedAgentId}...`);

    const btnDisconnectId = service === 'sheets' ? 'btnDisconnectSheets' : 'btnDisconnectGoogle';
    const btnDisconnect = document.getElementById(btnDisconnectId);
    const originalText = btnDisconnect?.innerHTML;

    if (btnDisconnect) {
        btnDisconnect.innerHTML = `
            <div class="loading-spinner"></div>
            <span>Desconectando...</span>
        `;
        btnDisconnect.disabled = true;
    }

    try {
        const response = await fetch(`/api/google/disconnect/${selectedAgentId}`, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ service })
        });

        if (!response.ok) {
            throw new Error(t('integ_err_google_disconnect','Error al desconectar Google'));
        }

        const data = await response.json();
        console.log('✅ Google desconectado:', data);

        showNotification(`${label} desconectado exitosamente`, 'success');
        await loadGoogleIntegrationStatus(selectedAgentId);

    } catch (error) {
        console.error(`Error desconectando ${service}:`, error);
        showNotification(t('integ_err_google_disconnect','Error al desconectar Google'), 'error');

        if (btnDisconnect) {
            btnDisconnect.innerHTML = originalText;
            btnDisconnect.disabled = false;
        }
    }
}

// "Reconectar" = desconectar y volver a conectar de una — útil si el token
// quedó en mal estado (revocado desde la cuenta de Google, etc.)
async function reconnectGoogleService(service) {
    if (!requireAgentSelected()) return;

    try {
        await fetch(`/api/google/disconnect/${selectedAgentId}`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ service })
        });
    } catch (error) {
        console.error(`Error al desconectar ${service} antes de reconectar:`, error);
    }

    await connectGoogleService(service);
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

function formatDate(date) {
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) return 'Hace un momento';
    if (diff < 3600000) {
        const minutes = Math.floor(diff / 60000);
        return `Hace ${minutes} minuto${minutes > 1 ? 's' : ''}`;
    }
    if (diff < 86400000) {
        const hours = Math.floor(diff / 3600000);
        return `Hace ${hours} hora${hours > 1 ? 's' : ''}`;
    }
    if (diff < 604800000) {
        const days = Math.floor(diff / 86400000);
        return `Hace ${days} día${days > 1 ? 's' : ''}`;
    }
    
    const options = { year: 'numeric', month: 'short', day: 'numeric' };
    return date.toLocaleDateString('es-MX', options);
}

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
const style = document.createElement('style');
style.textContent = `
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
document.head.appendChild(style);


// ============================================
// PAYMENTS INTEGRATION
// Agregar al final de integrations.js (antes del console.log final)
// ============================================

// ── Inicialización ──────────────────────────────────────────

function initPaymentsIntegration() {
    // SPEI
    const clabeInput = document.getElementById('clabeNumber');
    const btnSaveSPEI = document.getElementById('btnSaveSPEI');
    const btnEditSPEI = document.getElementById('btnEditSPEI');
    const btnRemoveSPEI = document.getElementById('btnRemoveSPEI');

    if (clabeInput) {
        clabeInput.addEventListener('input', function() {
            // Solo permitir dígitos
            this.value = this.value.replace(/\D/g, '').slice(0, 18);
            if (btnSaveSPEI) {
                btnSaveSPEI.disabled = this.value.length !== 18;
            }
        });
    }

    if (btnSaveSPEI) btnSaveSPEI.addEventListener('click', saveSPEIConfig);
    if (btnEditSPEI) btnEditSPEI.addEventListener('click', enableSPEIEdit);
    if (btnRemoveSPEI) btnRemoveSPEI.addEventListener('click', removeSPEIConfig);

    // Stripe Connect
    const btnConnectStripe = document.getElementById('btnConnectStripe');
    const btnDisconnectStripe = document.getElementById('btnDisconnectStripe');

    if (btnConnectStripe) btnConnectStripe.addEventListener('click', connectStripe);
    if (btnDisconnectStripe) btnDisconnectStripe.addEventListener('click', disconnectStripe);

    // Revisar si venimos de un redirect de Stripe
    checkStripeRedirect();

    // Click (Uzbekistán)
    const btnSaveClick = document.getElementById('btnSaveClick');
    const btnEditClick = document.getElementById('btnEditClick');
    const btnRemoveClick = document.getElementById('btnRemoveClick');
    const toggleClickSecret = document.getElementById('toggleClickSecret');
    initToggleVisibility(toggleClickSecret, 'clickSecretKey');
    initClickInputValidation();
    if (btnSaveClick) btnSaveClick.addEventListener('click', saveClickConfig);
    if (btnEditClick) btnEditClick.addEventListener('click', enableClickEdit);
    if (btnRemoveClick) btnRemoveClick.addEventListener('click', removeClickConfig);

    // Payme (Uzbekistán)
    const btnSavePayme = document.getElementById('btnSavePayme');
    const btnEditPayme = document.getElementById('btnEditPayme');
    const btnRemovePayme = document.getElementById('btnRemovePayme');
    const togglePaymeSecret = document.getElementById('togglePaymeSecret');
    initToggleVisibility(togglePaymeSecret, 'paymeSecretKey');
    initPaymeInputValidation();
    if (btnSavePayme) btnSavePayme.addEventListener('click', savePaymeConfig);
    if (btnEditPayme) btnEditPayme.addEventListener('click', enablePaymeEdit);
    if (btnRemovePayme) btnRemovePayme.addEventListener('click', removePaymeConfig);
}

// Helper reutilizable para el botón de mostrar/ocultar contraseña (mismo
// patrón que ya usa Gemini/RepairDesk) — evita duplicar el listener 4 veces.
function initToggleVisibility(toggleButton, inputId) {
    if (!toggleButton) return;
    const input = document.getElementById(inputId);
    if (!input) return;
    toggleButton.addEventListener('click', () => {
        const icon = toggleButton.querySelector('i');
        if (input.type === 'password') {
            input.type = 'text';
            icon.className = 'lni lni-eye-slash';
        } else {
            input.type = 'password';
            icon.className = 'lni lni-eye';
        }
    });
}

// Habilita el botón de guardar de Click solo cuando los 3 campos tienen datos
function initClickInputValidation() {
    const merchantInput = document.getElementById('clickMerchantId');
    const serviceInput = document.getElementById('clickServiceId');
    const secretInput = document.getElementById('clickSecretKey');
    const btnSaveClick = document.getElementById('btnSaveClick');
    if (!merchantInput || !serviceInput || !secretInput || !btnSaveClick) return;

    const checkValid = () => {
        btnSaveClick.disabled = !(merchantInput.value.trim() && serviceInput.value.trim() && secretInput.value.trim());
    };
    [merchantInput, serviceInput, secretInput].forEach(el => el.addEventListener('input', checkValid));
}

// Habilita el botón de guardar de Payme solo cuando ambos campos tienen datos
function initPaymeInputValidation() {
    const merchantInput = document.getElementById('paymeMerchantId');
    const secretInput = document.getElementById('paymeSecretKey');
    const btnSavePayme = document.getElementById('btnSavePayme');
    if (!merchantInput || !secretInput || !btnSavePayme) return;

    const checkValid = () => {
        btnSavePayme.disabled = !(merchantInput.value.trim() && secretInput.value.trim());
    };
    [merchantInput, secretInput].forEach(el => el.addEventListener('input', checkValid));
}

// ── Cargar estado de pagos ──────────────────────────────────

async function loadPaymentConfig(branchId) {
    if (!branchId) return;
    console.log(`💳 Cargando config de pagos para sucursal ${branchId}...`);

    try {
        const res = await fetch(`/api/payment-config/${branchId}`, {
            credentials: 'include'
        });
        if (!res.ok) throw new Error('Error cargando config de pagos');
        const data = await res.json();
        console.log('✅ Config de pagos:', data);
        updatePaymentsUI(data);
    } catch (err) {
        console.error('Error cargando pagos:', err);
    }
}

function updateClickPaymeUI(data) {
    // ── Click ─────────────────────────────────────────────────
    const clickStatusBadge = document.getElementById('clickStatusBadge');
    const clickConnectionInfo = document.getElementById('clickConnectionInfo');
    const clickSaveActions = document.getElementById('clickSaveActions');
    const clickManageActions = document.getElementById('clickManageActions');
    const clickForm = document.getElementById('clickForm');

    const merchantInput = document.getElementById('clickMerchantId');
    const serviceInput = document.getElementById('clickServiceId');
    const secretInput = document.getElementById('clickSecretKey');
    [merchantInput, serviceInput, secretInput].forEach(el => { if (el) el.disabled = false; });

    if (data.clickEnabled && data.clickMerchantId) {
        if (clickStatusBadge) {
            clickStatusBadge.className = 'status-badge connected';
            clickStatusBadge.innerHTML = `<span class="status-indicator"></span>${t('integ_status_configured','Configurado')}`;
        }
        if (clickConnectionInfo) {
            clickConnectionInfo.style.display = 'block';
            const displayMerchant = document.getElementById('clickDisplayMerchant');
            const displayService = document.getElementById('clickDisplayService');
            if (displayMerchant) displayMerchant.textContent = data.clickMerchantId;
            if (displayService) displayService.textContent = data.clickServiceId || '—';
        }
        if (clickForm) clickForm.style.display = 'none';
        if (clickSaveActions) clickSaveActions.style.display = 'none';
        if (clickManageActions) clickManageActions.style.display = 'flex';
    } else {
        if (clickStatusBadge) {
            clickStatusBadge.className = 'status-badge disconnected';
            clickStatusBadge.innerHTML = `<span class="status-indicator"></span>${t('integ_status_not_configured','No configurado')}`;
        }
        if (clickConnectionInfo) clickConnectionInfo.style.display = 'none';
        if (clickForm) clickForm.style.display = 'block';
        if (clickSaveActions) clickSaveActions.style.display = 'flex';
        if (clickManageActions) clickManageActions.style.display = 'none';
    }

    // ── Payme ─────────────────────────────────────────────────
    const paymeStatusBadge = document.getElementById('paymeStatusBadge');
    const paymeConnectionInfo = document.getElementById('paymeConnectionInfo');
    const paymeSaveActions = document.getElementById('paymeSaveActions');
    const paymeManageActions = document.getElementById('paymeManageActions');
    const paymeForm = document.getElementById('paymeForm');

    const paymeMerchantInput = document.getElementById('paymeMerchantId');
    const paymeSecretInput = document.getElementById('paymeSecretKey');
    [paymeMerchantInput, paymeSecretInput].forEach(el => { if (el) el.disabled = false; });

    if (data.paymeEnabled && data.paymeMerchantId) {
        if (paymeStatusBadge) {
            paymeStatusBadge.className = 'status-badge connected';
            paymeStatusBadge.innerHTML = `<span class="status-indicator"></span>${t('integ_status_configured','Configurado')}`;
        }
        if (paymeConnectionInfo) {
            paymeConnectionInfo.style.display = 'block';
            const displayMerchant = document.getElementById('paymeDisplayMerchant');
            if (displayMerchant) displayMerchant.textContent = data.paymeMerchantId;
        }
        if (paymeForm) paymeForm.style.display = 'none';
        if (paymeSaveActions) paymeSaveActions.style.display = 'none';
        if (paymeManageActions) paymeManageActions.style.display = 'flex';
    } else {
        if (paymeStatusBadge) {
            paymeStatusBadge.className = 'status-badge disconnected';
            paymeStatusBadge.innerHTML = `<span class="status-indicator"></span>${t('integ_status_not_configured','No configurado')}`;
        }
        if (paymeConnectionInfo) paymeConnectionInfo.style.display = 'none';
        if (paymeForm) paymeForm.style.display = 'block';
        if (paymeSaveActions) paymeSaveActions.style.display = 'flex';
        if (paymeManageActions) paymeManageActions.style.display = 'none';
    }
}

function updatePaymentsUI(data) {
    // Habilitar botones ahora que hay un agente seleccionado
    const btnSaveSPEI = document.getElementById('btnSaveSPEI');
    const btnConnectStripe = document.getElementById('btnConnectStripe');
    const clabeInput = document.getElementById('clabeNumber');
    const bankInput = document.getElementById('bankName');
    const accountInput = document.getElementById('accountName');

    if (clabeInput) clabeInput.disabled = false;
    if (bankInput) bankInput.disabled = false;
    if (accountInput) accountInput.disabled = false;
    if (btnConnectStripe) btnConnectStripe.disabled = false;

    // ── SPEI ──────────────────────────────────────────────────
    const speiStatusBadge = document.getElementById('speiStatusBadge');
    const speiConnectionInfo = document.getElementById('speiConnectionInfo');
    const speiSaveActions = document.getElementById('speiSaveActions');
    const speiManageActions = document.getElementById('speiManageActions');

    if (data.speiEnabled && data.clabeNumber) {
        if (speiStatusBadge) {
            speiStatusBadge.className = 'status-badge connected';
            speiStatusBadge.innerHTML = `<span class="status-indicator"></span>${t('integ_status_configured','Configurado')}`;
        }
        if (speiConnectionInfo) {
            speiConnectionInfo.style.display = 'block';
            const displayClabe = document.getElementById('speiDisplayClabe');
            const displayBank = document.getElementById('speiDisplayBank');
            const displayName = document.getElementById('speiDisplayName');
            if (displayClabe) displayClabe.textContent = data.clabeNumber;
            if (displayBank) displayBank.textContent = data.bankName || '—';
            if (displayName) displayName.textContent = data.accountName || '—';
        }
        // Ocultar form, mostrar manage
        const speiForm = document.getElementById('speiForm');
        if (speiForm) speiForm.style.display = 'none';
        if (speiSaveActions) speiSaveActions.style.display = 'none';
        if (speiManageActions) speiManageActions.style.display = 'flex';
    } else {
        if (speiStatusBadge) {
            speiStatusBadge.className = 'status-badge disconnected';
            speiStatusBadge.innerHTML = `<span class="status-indicator"></span>${t('integ_status_not_configured','No configurado')}`;
        }
        if (speiConnectionInfo) speiConnectionInfo.style.display = 'none';
        const speiForm = document.getElementById('speiForm');
        if (speiForm) speiForm.style.display = 'block';
        if (speiSaveActions) speiSaveActions.style.display = 'flex';
        if (speiManageActions) speiManageActions.style.display = 'none';
    }

    // ── Stripe Connect ─────────────────────────────────────────
    const stripeStatusBadge = document.getElementById('stripeConnectStatusBadge');
    const stripeConnectInfo = document.getElementById('stripeConnectInfo');
    const stripeConnectActions = document.getElementById('stripeConnectActions');
    const stripeManageActions = document.getElementById('stripeManageActions');

    if (data.stripeEnabled) {
        if (stripeStatusBadge) {
            stripeStatusBadge.className = 'status-badge connected';
            stripeStatusBadge.innerHTML = `<span class="status-indicator"></span>${t('integ_status_connected','Conectado')}`;
        }
        if (stripeConnectInfo) {
            stripeConnectInfo.style.display = 'block';
            const statusEl = document.getElementById('stripeConnectStatus');
            const chargesEl = document.getElementById('stripeChargesStatus');
            const payoutsEl = document.getElementById('stripePayoutsStatus');

            const statusMap = {
                active: '✅ Activo',
                pending: '⏳ Pendiente de verificación',
                pending_verification: '⏳ En revisión',
                restricted: '⚠️ Restringido'
            };
            if (statusEl) statusEl.textContent = statusMap[data.stripeAccountStatus] || data.stripeAccountStatus;
            if (chargesEl) chargesEl.textContent = data.stripeChargesEnabled ? t('integ_stripe_enabled','✅ Habilitados') : t('integ_stripe_pending','⏳ Pendiente');
            if (payoutsEl) payoutsEl.textContent = data.stripePayoutsEnabled ? t('integ_stripe_enabled','✅ Habilitados') : t('integ_stripe_pending','⏳ Pendiente');
        }
        if (stripeConnectActions) stripeConnectActions.style.display = 'none';
        if (stripeManageActions) stripeManageActions.style.display = 'flex';
    } else {
        if (stripeStatusBadge) {
            stripeStatusBadge.className = 'status-badge disconnected';
            stripeStatusBadge.innerHTML = `<span class="status-indicator"></span>${t('integ_status_disconnected','No conectado')}`;
        }
        if (stripeConnectInfo) stripeConnectInfo.style.display = 'none';
        if (stripeConnectActions) stripeConnectActions.style.display = 'flex';
        if (stripeManageActions) stripeManageActions.style.display = 'none';
    }

    // ── Badge general ─────────────────────────────────────────
    const mainBadge = document.getElementById('paymentsStatusBadge');
    const anyConfigured = data.speiEnabled || data.stripeEnabled || data.clickEnabled || data.paymeEnabled;
    if (mainBadge) {
        if (anyConfigured) {
            mainBadge.className = 'status-badge connected';
            mainBadge.innerHTML = `<span class="status-indicator"></span>${t('integ_status_configured','Configurado')}`;
        } else {
            mainBadge.className = 'status-badge disconnected';
            mainBadge.innerHTML = `<span class="status-indicator"></span>${t('integ_status_without_config','Sin configurar')}`;
        }
    }

    updateClickPaymeUI(data);
}

// ── SPEI: guardar ──────────────────────────────────────────

async function saveSPEIConfig() {
    if (!requireAgentSelected()) return;

    const clabe = document.getElementById('clabeNumber').value.trim();
    const bank = document.getElementById('bankName').value.trim();
    const accountName = document.getElementById('accountName').value.trim();

    if (clabe.length !== 18) {
        showNotification(t('integ_err_clabe_length','La CLABE debe tener exactamente 18 dígitos'), 'error');
        return;
    }

    // Obtener branch_id del agente seleccionado
    const branchId = await getBranchIdForAgent(selectedAgentId);
    if (!branchId) return;

    const btn = document.getElementById('btnSaveSPEI');
    const orig = btn.innerHTML;
    btn.innerHTML = `<div class="loading-spinner"></div><span>${t('integ_loading_saving','Guardando...')}</span>`;
    btn.disabled = true;

    try {
        const res = await fetch(`/api/payment-config/spei/${branchId}`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                clabeNumber: clabe,
                bankName: bank,
                accountName: accountName,
                enabled: true
            })
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Error al guardar');
        }
        showNotification(t('integ_ok_clabe_saved','CLABE guardada exitosamente'), 'success');
        await loadPaymentConfig(branchId);
    } catch (err) {
        showNotification(err.message, 'error');
        btn.innerHTML = orig;
        btn.disabled = false;
    }
}

// ── SPEI: editar ───────────────────────────────────────────

function enableSPEIEdit() {
    const speiForm = document.getElementById('speiForm');
    const speiConnectionInfo = document.getElementById('speiConnectionInfo');
    const speiSaveActions = document.getElementById('speiSaveActions');
    const speiManageActions = document.getElementById('speiManageActions');
    const clabeInput = document.getElementById('clabeNumber');

    if (speiForm) speiForm.style.display = 'block';
    if (speiConnectionInfo) speiConnectionInfo.style.display = 'none';
    if (speiSaveActions) speiSaveActions.style.display = 'flex';
    if (speiManageActions) speiManageActions.style.display = 'none';

    if (clabeInput) {
        clabeInput.value = '';
        clabeInput.disabled = false;
        clabeInput.focus();
    }
    ['bankName', 'accountName'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.value = ''; el.disabled = false; }
    });

    const btnSaveSPEI = document.getElementById('btnSaveSPEI');
    if (btnSaveSPEI) btnSaveSPEI.disabled = true;
}

// ── SPEI: eliminar ─────────────────────────────────────────

async function removeSPEIConfig() {
    if (!selectedAgentId) return;
    if (!confirm('¿Eliminar la configuración SPEI? El bot ya no podrá ofrecer transferencias.')) return;

    const branchId = await getBranchIdForAgent(selectedAgentId);
    if (!branchId) return;

    const btn = document.getElementById('btnRemoveSPEI');
    const orig = btn.innerHTML;
    btn.innerHTML = `<div class="loading-spinner"></div><span>${t('integ_loading_deleting','Eliminando...')}</span>`;
    btn.disabled = true;

    try {
        const res = await fetch(`/api/payment-config/spei/${branchId}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        if (!res.ok) throw new Error('Error al eliminar');
        showNotification(t('integ_ok_spei_removed','Configuración SPEI eliminada'), 'success');
        await loadPaymentConfig(branchId);
    } catch (err) {
        showNotification(t('integ_err_spei_remove','Error al eliminar SPEI'), 'error');
        btn.innerHTML = orig;
        btn.disabled = false;
    }
}

// ── Click: guardar ─────────────────────────────────────────

async function saveClickConfig() {
    if (!requireAgentSelected()) return;

    const merchantId = document.getElementById('clickMerchantId').value.trim();
    const serviceId = document.getElementById('clickServiceId').value.trim();
    const secretKey = document.getElementById('clickSecretKey').value.trim();

    if (!merchantId || !serviceId || !secretKey) {
        showNotification(t('integ_err_fill_fields','Completa todos los campos'), 'error');
        return;
    }

    const branchId = await getBranchIdForAgent(selectedAgentId);
    if (!branchId) return;

    const btn = document.getElementById('btnSaveClick');
    const orig = btn.innerHTML;
    btn.innerHTML = `<div class="loading-spinner"></div><span>${t('integ_loading_saving','Guardando...')}</span>`;
    btn.disabled = true;

    try {
        const res = await fetch(`/api/payment-config/click/${branchId}`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                merchantId: merchantId,
                serviceId: serviceId,
                secretKey: secretKey,
                enabled: true
            })
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Error al guardar');
        }
        showNotification(t('integ_click_ok_saved','Click guardado exitosamente'), 'success');
        await loadPaymentConfig(branchId);
    } catch (err) {
        showNotification(err.message, 'error');
        btn.innerHTML = orig;
        btn.disabled = false;
    }
}

// ── Click: editar ──────────────────────────────────────────

function enableClickEdit() {
    const clickForm = document.getElementById('clickForm');
    const clickConnectionInfo = document.getElementById('clickConnectionInfo');
    const clickSaveActions = document.getElementById('clickSaveActions');
    const clickManageActions = document.getElementById('clickManageActions');

    if (clickForm) clickForm.style.display = 'block';
    if (clickConnectionInfo) clickConnectionInfo.style.display = 'none';
    if (clickSaveActions) clickSaveActions.style.display = 'flex';
    if (clickManageActions) clickManageActions.style.display = 'none';

    ['clickMerchantId', 'clickServiceId', 'clickSecretKey'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.value = ''; el.disabled = false; }
    });
    document.getElementById('clickMerchantId')?.focus();

    const btnSaveClick = document.getElementById('btnSaveClick');
    if (btnSaveClick) btnSaveClick.disabled = true;
}

// ── Click: eliminar ────────────────────────────────────────

async function removeClickConfig() {
    if (!selectedAgentId) return;
    if (!confirm(t('integ_click_confirm_remove', '¿Eliminar la configuración de Click? El bot ya no podrá ofrecer este método de pago.'))) return;

    const branchId = await getBranchIdForAgent(selectedAgentId);
    if (!branchId) return;

    const btn = document.getElementById('btnRemoveClick');
    const orig = btn.innerHTML;
    btn.innerHTML = `<div class="loading-spinner"></div><span>${t('integ_loading_deleting','Eliminando...')}</span>`;
    btn.disabled = true;

    try {
        const res = await fetch(`/api/payment-config/click/${branchId}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        if (!res.ok) throw new Error('Error al eliminar');
        showNotification(t('integ_click_ok_removed','Configuración de Click eliminada'), 'success');
        await loadPaymentConfig(branchId);
    } catch (err) {
        showNotification(t('integ_click_err_remove','Error al eliminar Click'), 'error');
        btn.innerHTML = orig;
        btn.disabled = false;
    }
}

// ── Payme: guardar ─────────────────────────────────────────

async function savePaymeConfig() {
    if (!requireAgentSelected()) return;

    const merchantId = document.getElementById('paymeMerchantId').value.trim();
    const secretKey = document.getElementById('paymeSecretKey').value.trim();

    if (!merchantId || !secretKey) {
        showNotification(t('integ_err_fill_fields','Completa todos los campos'), 'error');
        return;
    }

    const branchId = await getBranchIdForAgent(selectedAgentId);
    if (!branchId) return;

    const btn = document.getElementById('btnSavePayme');
    const orig = btn.innerHTML;
    btn.innerHTML = `<div class="loading-spinner"></div><span>${t('integ_loading_saving','Guardando...')}</span>`;
    btn.disabled = true;

    try {
        const res = await fetch(`/api/payment-config/payme/${branchId}`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                merchantId: merchantId,
                secretKey: secretKey,
                enabled: true
            })
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Error al guardar');
        }
        showNotification(t('integ_payme_ok_saved','Payme guardado exitosamente'), 'success');
        await loadPaymentConfig(branchId);
    } catch (err) {
        showNotification(err.message, 'error');
        btn.innerHTML = orig;
        btn.disabled = false;
    }
}

// ── Payme: editar ──────────────────────────────────────────

function enablePaymeEdit() {
    const paymeForm = document.getElementById('paymeForm');
    const paymeConnectionInfo = document.getElementById('paymeConnectionInfo');
    const paymeSaveActions = document.getElementById('paymeSaveActions');
    const paymeManageActions = document.getElementById('paymeManageActions');

    if (paymeForm) paymeForm.style.display = 'block';
    if (paymeConnectionInfo) paymeConnectionInfo.style.display = 'none';
    if (paymeSaveActions) paymeSaveActions.style.display = 'flex';
    if (paymeManageActions) paymeManageActions.style.display = 'none';

    ['paymeMerchantId', 'paymeSecretKey'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.value = ''; el.disabled = false; }
    });
    document.getElementById('paymeMerchantId')?.focus();

    const btnSavePayme = document.getElementById('btnSavePayme');
    if (btnSavePayme) btnSavePayme.disabled = true;
}

// ── Payme: eliminar ────────────────────────────────────────

async function removePaymeConfig() {
    if (!selectedAgentId) return;
    if (!confirm(t('integ_payme_confirm_remove', '¿Eliminar la configuración de Payme? El bot ya no podrá ofrecer este método de pago.'))) return;

    const branchId = await getBranchIdForAgent(selectedAgentId);
    if (!branchId) return;

    const btn = document.getElementById('btnRemovePayme');
    const orig = btn.innerHTML;
    btn.innerHTML = `<div class="loading-spinner"></div><span>${t('integ_loading_deleting','Eliminando...')}</span>`;
    btn.disabled = true;

    try {
        const res = await fetch(`/api/payment-config/payme/${branchId}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        if (!res.ok) throw new Error('Error al eliminar');
        showNotification(t('integ_payme_ok_removed','Configuración de Payme eliminada'), 'success');
        await loadPaymentConfig(branchId);
    } catch (err) {
        showNotification(t('integ_payme_err_remove','Error al eliminar Payme'), 'error');
        btn.innerHTML = orig;
        btn.disabled = false;
    }
}

// ── Stripe Connect: conectar ───────────────────────────────

async function connectStripe() {
    if (!requireAgentSelected()) return;

    const branchId = await getBranchIdForAgent(selectedAgentId);
    if (!branchId) return;

    const btn = document.getElementById('btnConnectStripe');
    const orig = btn.innerHTML;
    btn.innerHTML = `<div class="loading-spinner"></div><span>${t('integ_loading_starting','Iniciando...')}</span>`;
    btn.disabled = true;

    try {
        const res = await fetch(`/api/payment-config/stripe/connect/${branchId}`, {
            method: 'POST',
            credentials: 'include'
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Error al iniciar Stripe Connect');
        }
        const data = await res.json();

        if (data.onboardingUrl) {
            // Abrir en ventana nueva — Stripe tiene su propio flujo
            const w = window.open(data.onboardingUrl, 'StripeConnect', 'width=600,height=700,resizable=yes,scrollbars=yes');

            if (!w) {
                showNotification(t('integ_err_popups','Permite ventanas emergentes para continuar'), 'error');
                btn.innerHTML = orig;
                btn.disabled = false;
                return;
            }

            // Polling hasta que cierre la ventana
            const poll = setInterval(async () => {
                if (w.closed) {
                    clearInterval(poll);
                    await new Promise(r => setTimeout(r, 1500));
                    await loadPaymentConfig(branchId);
                    btn.innerHTML = orig;
                    btn.disabled = false;
                }
            }, 800);
        }
    } catch (err) {
        showNotification(err.message, 'error');
        btn.innerHTML = orig;
        btn.disabled = false;
    }
}

// ── Stripe Connect: desconectar ────────────────────────────

async function disconnectStripe() {
    if (!selectedAgentId) return;
    if (!confirm('¿Desconectar Stripe? El bot ya no podrá generar links de pago con tarjeta.')) return;

    const branchId = await getBranchIdForAgent(selectedAgentId);
    if (!branchId) return;

    const btn = document.getElementById('btnDisconnectStripe');
    const orig = btn.innerHTML;
    btn.innerHTML = `<div class="loading-spinner"></div><span>${t('integ_loading_disconnecting','Desconectando...')}</span>`;
    btn.disabled = true;

    try {
        const res = await fetch(`/api/payment-config/stripe/${branchId}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        if (!res.ok) throw new Error(t('integ_err_stripe_disconnect','Error al desconectar Stripe'));
        showNotification(t('integ_ok_stripe_disconnect','Stripe desconectado exitosamente'), 'success');
        await loadPaymentConfig(branchId);
    } catch (err) {
        showNotification(t('integ_err_stripe_disconnect','Error al desconectar Stripe'), 'error');
        btn.innerHTML = orig;
        btn.disabled = false;
    }
}

// ── Helper: obtener branch_id del agente seleccionado ──────

async function getBranchIdForAgent(agentId) {
    // El agente tiene branchId — lo buscamos en el array de agents ya cargado
    const agent = agents.find(a => a.id === agentId);
    if (agent && agent.branchId) return agent.branchId;

    // Fallback: pedir al servidor
    try {
        const res = await fetch(`/api/agents/${agentId}`, { credentials: 'include' });
        if (res.ok) {
            const data = await res.json();
            return data.branchId || data.branch_id || null;
        }
    } catch (e) {
        console.error('No se pudo obtener branchId:', e);
    }

    showNotification(t('integ_err_stripe_branch','No se pudo determinar la sucursal del agente'), 'error');
    return null;
}

// ── Revisar redirect de Stripe al cargar la página ─────────

function checkStripeRedirect() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('stripe_success')) {
        showNotification(t('integ_ok_stripe_connected','✅ Stripe conectado exitosamente'), 'success');
        // Limpiar params de la URL
        window.history.replaceState({}, '', '/integrations');
    } else if (params.get('stripe_error')) {
        showNotification(t('integ_err_stripe_connect','Error al conectar con Stripe. Intenta de nuevo.'), 'error');
        window.history.replaceState({}, '', '/integrations');
    } else if (params.get('stripe_refresh')) {
        showNotification(t('integ_err_stripe_expired','El onboarding de Stripe expiró. Por favor reconecta.'), 'error');
        window.history.replaceState({}, '', '/integrations');
    }
}


console.log('🎯 Integrations ready!');

// ============================================
// ONBOARDING MODAL (adaptado de my-agents.js)
// ============================================

let _onboardingHTMLCache = null;
let _onboardingScriptLoaded = false;

function openOnboardingModal() {
    let modal = document.getElementById('onboardingModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'onboardingModal';
        modal.className = 'onboarding-modal';
        modal.innerHTML = `
            <div class="onboarding-overlay" onclick="closeOnboardingModal()"></div>
            <div class="onboarding-modal-content">
                <div class="onboarding-modal-header">
                    <h2 class="onboarding-modal-title">
                        <i class="lni lni-rocket"></i>
                        Crear Nuevo Agente
                    </h2>
                    <button class="btn-close-onboarding" onclick="closeOnboardingModal()">
                        <i class="lni lni-close"></i>
                    </button>
                </div>
                <div class="onboarding-modal-body" id="onboardingModalBody">
                    <div style="display:flex;justify-content:center;align-items:center;padding:3rem;">
                        <div class="loading-spinner"></div>
                        <div class="loading-text" style="margin-left:1rem;">Cargando formulario...</div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    modal.classList.add('active');
    loadOnboardingContent();
}

function closeOnboardingModal() {
    const modal = document.getElementById('onboardingModal');
    if (modal) {
        modal.classList.remove('active');
        setTimeout(() => { if (typeof initAgentSelector === 'function') initAgentSelector(); }, 300);
    }
}

async function loadOnboardingContent() {
    const modalBody = document.getElementById('onboardingModalBody');
    if (!modalBody) return;
    try {
        let rawHtml;
        if (_onboardingHTMLCache) {
            rawHtml = _onboardingHTMLCache;
        } else {
            const response = await fetch('/onboarding', { credentials: 'include' });
            if (!response.ok) throw new Error('Error al cargar onboarding');
            rawHtml = await response.text();
            _onboardingHTMLCache = rawHtml;
        }
        const parser = new DOMParser();
        const doc = parser.parseFromString(rawHtml, 'text/html');
        const mainContainer = doc.querySelector('.main-container');
        if (mainContainer) {
            modalBody.innerHTML = mainContainer.innerHTML;
            // Re-apply translations to the newly injected onboarding content
            if (window.Translations) window.Translations.apply(getLang());
            if (window.renderLangFlags) window.renderLangFlags();

            if (!document.getElementById('onboarding-css')) {
                const link = document.createElement('link');
                link.id = 'onboarding-css'; link.rel = 'stylesheet';
                link.href = '/static/css/onboarding.css';
                document.head.appendChild(link);
            }
            if (!document.getElementById('onboarding-modal-fixes')) {
                const fix = document.createElement('style');
                fix.id = 'onboarding-modal-fixes';
                fix.textContent = `
                    .section-nav-btn.completed:hover{background:#d1fae5!important;color:#10b981!important;border-color:#10b981!important;box-shadow:0 4px 12px rgba(16,185,129,.2)!important;}
                    .section-nav-btn.completed:hover i{color:#10b981!important;}
                    #onboardingModalBody .progress-wrapper,#onboardingModalBody .progress-header,#onboardingModalBody #progressPercentage,#onboardingModalBody .progress-dots{display:none!important;}
                    .onboarding-modal-header{display:flex!important;align-items:center!important;justify-content:space-between!important;padding:1rem 1.5rem!important;border-bottom:1px solid #eef2f7!important;position:sticky!important;top:0!important;background:white!important;z-index:10!important;flex-direction:row!important;}
                    .onboarding-modal-title{display:inline-flex!important;align-items:center!important;gap:0.6rem!important;font-weight:800!important;font-size:1.1rem!important;color:#0f172a!important;margin:0!important;flex:1!important;}
                    .btn-close-onboarding{width:40px!important;height:40px!important;border-radius:50%!important;border:none!important;background:#f3f4f6!important;color:#6b7280!important;cursor:pointer!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;font-size:1.1rem!important;flex-shrink:0!important;transition:all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)!important;}
                    .btn-close-onboarding:hover{background:#fee2e2!important;color:#ef4444!important;transform:rotate(90deg) scale(1.1)!important;box-shadow:0 4px 12px rgba(239, 68, 68, 0.2)!important;}
                    .btn-close-onboarding i{transition:all 0.3s ease!important;}
                    .btn-close-onboarding:hover i{transform:scale(1.2)!important;}
                    #onboardingModalBody .main-container,#onboardingModalBody .onboarding-container{padding-top:0!important;margin-top:0!important;}
                    #onboardingModalBody .step2-header,#onboardingModalBody .step-header{padding-top:1rem!important;}
                    .readonly-notice{display:flex;align-items:center;gap:8px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 14px;font-size:0.82rem;color:#15803d;margin-bottom:16px;}
                    .readonly-notice i{font-size:1rem;flex-shrink:0;}
                    .readonly-notice a{color:#0891b2;text-decoration:underline;}
                    .form-input[readonly]:not(.form-select){background:#f8fafc;color:#64748b;cursor:not-allowed;border-color:#e2e8f0;}
                `;
                document.head.appendChild(fix);
            }
            if (!_onboardingScriptLoaded) {
                const script = document.createElement('script');
                script.src = '/static/js/onboarding.js?v=' + Date.now();
                script.onload = () => { _onboardingScriptLoaded = true;
                    // Re-apply translations after onboarding script loaded
                    if (window.Translations) window.Translations.apply(getLang());
            if (window.renderLangFlags) window.renderLangFlags();
                    setTimeout(() => {
                        var _origCreateAgent = window.createAgent;
                        window.createAgent = function() {
                            if (typeof collectFormData === 'function') collectFormData();
                            var nombre = ((window.agentData && window.agentData.name) ? window.agentData.name : '').trim();
                            if (!nombre) { var inp = document.getElementById('agentName'); if (inp) nombre = inp.value.trim(); }
                            if (!nombre) {
                                alert('Por favor ingresa el nombre del agente en la sección "Info. Básica".');
                                if (typeof window._modalGoToSection === 'function') window._modalGoToSection('section-basic');
                                return;
                            }
                            if (window.agentData) window.agentData.name = nombre;
                            console.log('[integrations] createAgent validado — nombre:', nombre);
                            if (typeof _origCreateAgent === 'function') _origCreateAgent();
                        };
                    }, 100);
                    setTimeout(() => reinitializeOnboardingEvents(), 50); };
                document.body.appendChild(script);
            } else {
                if (window.Translations) window.Translations.apply(getLang());
            if (window.renderLangFlags) window.renderLangFlags();
                setTimeout(() => {
                    var _origCA = window.createAgent;
                    window.createAgent = function() {
                        if (typeof collectFormData === 'function') collectFormData();
                        var nombre = ((window.agentData && window.agentData.name) ? window.agentData.name : '').trim();
                        if (!nombre) { var inp = document.getElementById('agentName'); if (inp) nombre = inp.value.trim(); }
                        if (!nombre) {
                            alert('Por favor ingresa el nombre del agente en la sección "Info. Básica".');
                            if (typeof window._modalGoToSection === 'function') window._modalGoToSection('section-basic');
                            return;
                        }
                        if (window.agentData) window.agentData.name = nombre;
                        if (typeof _origCA === 'function') _origCA();
                    };
                }, 100);
                setTimeout(() => reinitializeOnboardingEvents(), 20);
            }
        } else {
            throw new Error('No se encontró .main-container');
        }
    } catch (error) {
        console.error('❌ Error cargando onboarding:', error);
        modalBody.innerHTML = `
            <div style="text-align:center;padding:3rem;">
                <i class="lni lni-warning" style="font-size:3rem;color:#ef4444;"></i>
                <h3 style="margin:1rem 0;color:#1a1a1a;">Error al cargar el formulario</h3>
                <p style="color:#6b7280;margin-bottom:1.5rem;">Por favor, intenta de nuevo</p>
                <button class="btn-primary" onclick="loadOnboardingContent()">
                    <i class="lni lni-reload"></i><span>Reintentar</span>
                </button>
            </div>`;
    }
}

async function reinitializeOnboardingEvents() {
    console.log('🔄 Reinicializando modal del agente (integrations)');

    if (typeof window.agentData !== 'undefined') window.agentData = (typeof defaultAgentData === 'function') ? defaultAgentData() : {};
    if (typeof window.currentSection !== 'undefined') window.currentSection = 1;

    const modal = document.getElementById('onboardingModal');
    const modalContent = modal?.querySelector('.onboarding-modal-content');
    if (modalContent) { modalContent.style.maxWidth = '1100px'; modalContent.style.width = '95vw'; modalContent.style.maxHeight = '90vh'; modalContent.style.overflow = 'hidden'; }
    const modalBody = document.getElementById('onboardingModalBody');
    if (modalBody) { modalBody.style.maxHeight = '82vh'; modalBody.style.overflowY = 'auto'; modalBody.scrollTop = 0; }

    document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
    const step1 = document.getElementById('step1');
    const step2 = document.getElementById('step2');
    // Mostrar step1 (selección de red social) primero
    if (step1) { step1.classList.add('active'); step1.style.display = ''; }
    if (step2) { step2.classList.remove('active'); step2.style.display = 'none'; }
    // Ocultar nav de secciones hasta que se complete step1
    const sectionNavEl = document.getElementById('sectionNavigation');
    if (sectionNavEl) sectionNavEl.style.display = 'none';

    // ── Habilitar Continuar al seleccionar red social (SINCRÓNICO, antes de cualquier await) ──
    (function setupSocialSelectionEarly() {
        function _enableContinuarEarly(value) {
            try { window.selectedSocial = value; } catch(e) {}
            try { window.agentData = window.agentData || {}; window.agentData.social = value; } catch(e) {}
            var btn = document.getElementById('btnStep1');
            if (btn) { btn.disabled = false; btn.removeAttribute('disabled'); }
        }
        document.querySelectorAll('input[name="social"]').forEach(function(radio) {
            radio.addEventListener('change', function() { _enableContinuarEarly(this.value); });
        });
        document.querySelectorAll('.social-card').forEach(function(label) {
            label.addEventListener('click', function() {
                var radio = label.querySelector('input[type="radio"]');
                if (radio && !radio.disabled) {
                    setTimeout(function() { _enableContinuarEarly(radio.value); }, 10);
                }
            });
        });
    })();

    const AGENT_SECTIONS_BUSINESS = [
        { id:1, containerId:'section-business',    name:() => t('onb_tab_business','Info. Negocio'),   icon:'lni-briefcase' },
        { id:2, containerId:'section-basic',       name:() => t('onb_tab_basic','Info. Básica'),    icon:'lni-information' },
        { id:5, containerId:'section-personality', name:() => t('onb_tab_personality','Personalidad'),    icon:'lni-comments' },
        { id:6, containerId:'section-schedule',    name:() => t('onb_tab_schedule','Horarios'),        icon:'lni-calendar' },
        { id:7, containerId:'section-holidays',    name:() => t('onb_tab_holidays','Días Festivos'),   icon:'lni-gift' },
        { id:8, containerId:'section-services',    name:() => t('onb_tab_services','Servicios / Productos'),       icon:'lni-package' },
        { id:9, containerId:'section-menu',        name:() => t('onb_sec_menu','Menú'),            icon:'lni-files' },
        { id:10,containerId:'section-workers',     name:() => t('onb_tab_workers','Trabajadores'),    icon:'lni-users' },
    ];
    const AGENT_SECTIONS_GOV = [
        { id:1, containerId:'section-business',    name:() => t('onb_tab_agency','Dependencia'),     icon:'lni-government' },
        { id:2, containerId:'section-basic',       name:() => t('onb_tab_basic','Info. Básica'),    icon:'lni-information' },
        { id:3, containerId:'section-location',    name:() => t('onb_tab_location','Ubicación'),       icon:'lni-map-marker' },
        { id:4, containerId:'section-social',      name:() => t('onb_tab_social','Redes Sociales'),  icon:'lni-share-alt' },
        { id:5, containerId:'section-personality', name:() => t('onb_tab_personality','Personalidad'),    icon:'lni-comments' },
        { id:6, containerId:'section-schedule',    name:() => t('onb_tab_schedule','Horarios'),        icon:'lni-calendar' },
        { id:7, containerId:'section-holidays',    name:() => t('onb_tab_holidays_gov','Días Inhábiles'),  icon:'lni-gift' },
        { id:8, containerId:'section-services',    name:() => t('onb_tab_courses','Cursos'),          icon:'lni-graduation' },
    ];

    // Detectar modo gobierno antes de construir la navegación
    let _isGovModal = false;
    try {
        const _meCheck = await fetch('/api/me', { credentials: 'include' });
        if (_meCheck.ok) {
            const _meCheckData = await _meCheck.json();
            _isGovModal = (_meCheckData.user?.businessType || '').toLowerCase().includes('gubernamental') ||
                          !!_meCheckData.user?.isGovernment ||
                          _meCheckData.user?.userType === 'government';
        }
    } catch (_) {}

    // Ocultar secciones que no aplican para gobierno
    if (_isGovModal) {
        const menuSec    = document.getElementById('section-menu');
        const workersSec = document.getElementById('section-workers');
        if (menuSec)    menuSec.style.display    = 'none';
        if (workersSec) workersSec.style.display = 'none';
    }

    let AGENT_SECTIONS = _isGovModal ? AGENT_SECTIONS_GOV : AGENT_SECTIONS_BUSINESS;
    const AGENT_IDS = AGENT_SECTIONS.map(s => s.containerId);

    ['section-location','section-social'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.classList.remove('active'); el.style.display = 'none'; }
    });

    if (typeof initializeRichEditor === 'function') initializeRichEditor();
    if (typeof initializePhoneToggle === 'function') initializePhoneToggle();
    if (typeof initializeSchedule === 'function') initializeSchedule();
    if (typeof initializeHolidays === 'function') initializeHolidays();
    if (typeof initializeServices === 'function') initializeServices();
    if (typeof initializeWorkers === 'function') initializeWorkers();
    if (typeof initializeMenu === 'function') initializeMenu();
    if (typeof initializeLocationDropdowns === 'function') initializeLocationDropdowns();
    if (typeof initializeSocialMediaInputs === 'function') initializeSocialMediaInputs();
    if (typeof initializeBusinessTypeSelect === 'function') initializeBusinessTypeSelect();
    if (typeof initializeToneSelection === 'function') initializeToneSelection();
    if (typeof initializeLanguageSelection === 'function') initializeLanguageSelection();
    setTimeout(() => {
        if (typeof fetchUserData === 'function') fetchUserData();
        if (typeof initBusinessTimePickers === 'function') initBusinessTimePickers();
        if (typeof initHolidayDatePickers === 'function') initHolidayDatePickers();
        if (typeof initWorkerTimePickers === 'function') initWorkerTimePickers();
        // Cargar bizType y aplicar labels del giro
        (async () => {
            try {
                let bizType = '';
                const meResp = await fetch('/api/me', { credentials: 'include' });
                if (meResp.ok) {
                    const meData = await meResp.json();
                    bizType = (meData.user?.businessType || '').toLowerCase();
                }
                // Si es gubernamental, fetchUserData ya llamará applyGovernmentMode
                if (bizType.includes('gubernamental')) {
                    if (window.agentData) window.agentData.businessType = bizType;
                    // applyGovernmentMode ya fue llamado arriba, no repetir
                    return;
                }
                const bizResp = await fetch('/api/my-business', { credentials: 'include' });
                if (bizResp.ok) {
                    const bizData = await bizResp.json();
                    const branch = bizData.activeBranch || bizData.defaultBranch;
                    const branchType = (branch?.business?.type || branch?.business?.typeName || '').toLowerCase();
                    if (branchType) bizType = branchType;
                }
                if (bizType) {
                    if (window.agentData) window.agentData.businessType = bizType;
                    if (typeof updateSectionLabels === 'function') updateSectionLabels(bizType);
                }
            } catch (_) {}
        })();
    }, 100);

    const sectionNav = document.getElementById('sectionNavigation');
    if (sectionNav) {
        sectionNav.innerHTML = '';
        sectionNav.style.justifyContent = 'center';
        sectionNav.style.flexWrap = 'wrap';
        sectionNav.style.gap = '0.5rem';
        AGENT_SECTIONS.forEach(sec => {
            const btn = document.createElement('button');
            btn.type = 'button'; btn.className = 'section-nav-btn'; btn.dataset.sectionId = sec.id;
            btn.innerHTML = `<i class="lni ${sec.icon}"></i><span>${typeof sec.name === "function" ? sec.name() : sec.name}</span>`;
            btn.addEventListener('click', () => window._modalGoToSection(sec.containerId));
            sectionNav.appendChild(btn);
        });
        const resumenBtn = document.createElement('button');
        resumenBtn.type = 'button'; resumenBtn.id = 'modal-resumen-tab'; resumenBtn.className = 'section-nav-btn';
        resumenBtn.innerHTML = `<i class="lni lni-checkmark-circle"></i><span>${t('integ_onb_resume','Resumen')}</span>`;
        resumenBtn.addEventListener('click', () => window._modalGoToResumen());
        sectionNav.appendChild(resumenBtn);
    }

    window._modalGoToSection = function(targetId) {
        AGENT_IDS.forEach(id => { const el = document.getElementById(id); if (el) { el.classList.remove('active'); el.style.display = 'none'; } });
        document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
        if (step1) step1.style.display = 'none';
        if (step2) { step2.classList.add('active'); step2.style.display = ''; }
        const target = document.getElementById(targetId);
        if (target) { target.style.display = ''; target.classList.add('active'); }
        const currentIdx = AGENT_SECTIONS.findIndex(s => s.containerId === targetId);
        document.querySelectorAll('#sectionNavigation .section-nav-btn').forEach(btn => {
            btn.classList.remove('active', 'completed');
            const sid = parseInt(btn.dataset.sectionId);
            const sec = AGENT_SECTIONS.find(s => s.id === sid);
            if (!sec) return;
            const idx = AGENT_SECTIONS.indexOf(sec);
            if (idx === currentIdx) btn.classList.add('active');
            else if (idx < currentIdx) btn.classList.add('completed');
        });
        const el = document.getElementById(targetId);
        if (el) el.querySelectorAll('.btn-prev-section').forEach(b => { b.style.display = currentIdx === 0 ? 'none' : 'flex'; });
        if (typeof window.updateProgressBar === 'function') window.updateProgressBar();
        if (modalBody) modalBody.scrollTop = 0;
    };

    window._modalGoToResumen = function() {
        AGENT_IDS.forEach(id => { const el = document.getElementById(id); if (el) { el.classList.remove('active'); el.style.display = 'none'; } });
        document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
        if (step1) step1.style.display = 'none';
        const step3 = document.getElementById('step3');
        if (step3) { step3.classList.add('active'); step3.style.display = ''; }
        document.querySelectorAll('#sectionNavigation .section-nav-btn').forEach(b => {
            b.classList.remove('active', 'completed');
            if (b.id === 'modal-resumen-tab') b.classList.add('active');
            else b.classList.add('completed');
        });
        if (typeof collectFormData === 'function') collectFormData();
        if (typeof generateSummary === 'function') generateSummary();
        if (typeof window.updateProgressBar === 'function') window.updateProgressBar();
        if (modalBody) modalBody.scrollTop = 0;
    };

    setTimeout(() => {
        AGENT_SECTIONS.forEach((sec, idx) => {
            const el = document.getElementById(sec.containerId);
            if (!el) return;
            const prevSec = AGENT_SECTIONS[idx - 1], nextSec = AGENT_SECTIONS[idx + 1];
            el.querySelectorAll('.btn-prev-section').forEach(btn => {
                btn.style.display = idx === 0 ? 'none' : 'flex';
                if (prevSec) btn.onclick = (e) => { e.stopPropagation(); window._modalGoToSection(prevSec.containerId); };
            });
            el.querySelectorAll('.btn-next-section,[class*="next"]').forEach(btn => {
                btn.onclick = (e) => { e.stopPropagation(); nextSec ? window._modalGoToSection(nextSec.containerId) : window._modalGoToResumen(); };
            });
        });
        const b3 = document.getElementById('btnBackStep3');
        if (b3) { const last = AGENT_SECTIONS[AGENT_SECTIONS.length - 1]; b3.onclick = (e) => { e.stopPropagation(); window._modalGoToSection(last.containerId); }; }

        const btnSubmit = document.getElementById('btnCreateAgent');
        if (btnSubmit) {
            const btnClone = btnSubmit.cloneNode(true);
            btnSubmit.parentNode.replaceChild(btnClone, btnSubmit);
            btnClone.addEventListener('click', () => { if (typeof createAgent === 'function') createAgent(); });
            console.log('✅ [integrations] Listener de btnCreateAgent registrado');
        }
        // Parchar navigateToSection para que use _modalGoToSection en el modal.
        // Esto resuelve el conflicto de raíz: rebuildSectionNav (llamado por
        // applyGovernmentMode) crea botones con navigateToSection, pero en el
        // modal necesitamos que use style.display (no solo classList).
        window.navigateToSection = function(sectionId) {
            const sec = AGENT_SECTIONS.find(s => s.id === sectionId);
            if (sec && typeof window._modalGoToSection === 'function') {
                window._modalGoToSection(sec.containerId);
            }
        };

        // Aplicar modo gobierno DESPUÉS de construir nav y _modalGoToSection
        if (_isGovModal && typeof applyGovernmentMode === 'function') {
            try {
                applyGovernmentMode();
                // applyGovernmentMode llama rebuildSectionNav con listeners de
                // navigateToSection — como ya está parcheado arriba, funciona
                // correctamente con _modalGoToSection.
            } catch (_) {}
        }
    }, 150);

    // Hook btnStep1 (Continuar de Red Social) → mostrar step2 + sectionNav
    const btnStep1El = document.getElementById('btnStep1');
    if (btnStep1El) {
        const btnStep1Clone = btnStep1El.cloneNode(true);
        btnStep1El.parentNode.replaceChild(btnStep1Clone, btnStep1El);
        btnStep1Clone.addEventListener('click', () => {
            if (step1) { step1.classList.remove('active'); step1.style.display = 'none'; }
            if (step2) { step2.classList.add('active'); step2.style.display = ''; }
            const nav = document.getElementById('sectionNavigation');
            if (nav) nav.style.display = '';
            window._modalGoToSection('section-basic');
        });
        console.log('✅ [integrations] Hook btnStep1 registrado');
    }

    // Listeners en los radios de red social

    // ── Social radio: event delegation robusta sobre step1 ──────────────────
    const _step1El = document.getElementById('step1');
    if (_step1El) {
        _step1El.addEventListener('change', function(e) {
            if (e.target && e.target.name === 'social') {
                if (window.agentData) window.agentData.social = e.target.value;
                const btn = document.getElementById('btnStep1');
                if (btn) btn.disabled = false;
            }
        });
    }
    // También llamar initializeSocialSelection si ya está disponible
    if (typeof initializeSocialSelection === 'function') initializeSocialSelection();
    // Si ya hay radio pre-seleccionado, habilitar botón de inmediato
    const preSelected = document.querySelector('input[name="social"]:checked');
    if (preSelected) {
        if (typeof selectedSocial !== 'undefined') selectedSocial = preSelected.value;
        if (typeof agentData !== 'undefined') agentData.social = preSelected.value;
        const btnPre = document.getElementById('btnStep1');
        if (btnPre) { btnPre.disabled = false; console.log('✅ [integrations] btnStep1 habilitado por pre-selección:', preSelected.value); }
    }

    if (typeof updateProgressBar === 'function') updateProgressBar();
}

window.reinitializeOnboardingEvents = reinitializeOnboardingEvents;

// ============================================
// REPAIRDESK INTEGRATION
// ============================================

function initRepairDeskIntegration() {
    const toggleBtn   = document.getElementById('toggleRepairDeskKey');
    const apiKeyInput = document.getElementById('repairDeskApiKey');
    const saveBtn     = document.getElementById('btnSaveRepairDesk');
    const syncBtn     = document.getElementById('btnSyncRepairDesk');
    const updateBtn   = document.getElementById('btnUpdateRepairDesk');
    const disconnBtn  = document.getElementById('btnDisconnectRepairDesk');

    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            if (!apiKeyInput) return;
            const icon = toggleBtn.querySelector('i');
            if (apiKeyInput.type === 'password') {
                apiKeyInput.type = 'text';
                icon.className = 'lni lni-eye-slash';
            } else {
                apiKeyInput.type = 'password';
                icon.className = 'lni lni-eye';
            }
        });
    }

    if (apiKeyInput) {
        apiKeyInput.addEventListener('input', () => {
            if (saveBtn) saveBtn.disabled = !apiKeyInput.value.trim();
        });
    }

    if (saveBtn)    saveBtn.addEventListener('click',    saveRepairDeskKey);
    if (syncBtn)    syncBtn.addEventListener('click',    syncRepairDeskNow);
    if (updateBtn)  updateBtn.addEventListener('click',  enableRepairDeskEdit);
    if (disconnBtn) disconnBtn.addEventListener('click', disconnectRepairDesk);
}

async function loadRepairDeskStatus(agentId) {
    if (!agentId) return;
    try {
        const res  = await fetch(`/api/repairdesk/status/${agentId}`, { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        updateRepairDeskUI(data);
    } catch (e) {
        console.error('RepairDesk status error:', e);
    }
}

function updateRepairDeskUI(data) {
    const badge       = document.getElementById('repairDeskStatusBadge');
    const form        = document.getElementById('repairDeskForm');
    const connInfo    = document.getElementById('repairDeskConnectionInfo');
    const saveActions = document.getElementById('repairDeskActions');
    const mgmtActions = document.getElementById('repairDeskManageActions');
    const lastSync    = document.getElementById('repairDeskLastSync');
    const apiInput    = document.getElementById('repairDeskApiKey');
    const toggleBtn   = document.getElementById('toggleRepairDeskKey');

    if (data.connected) {
        if (badge) {
            badge.className = 'status-badge connected';
            badge.innerHTML = `<span class="status-indicator"></span>${t('integ_status_connected','Conectado')}`;
        }
        if (apiInput)   { apiInput.value = '••••••••••••••••••••••'; apiInput.disabled = true; }
        if (toggleBtn)  toggleBtn.disabled = true;
        if (lastSync && data.last_sync) {
            lastSync.textContent = formatDate(new Date(data.last_sync));
        }
        if (form)        form.style.display        = 'block';
        if (connInfo)    connInfo.style.display     = 'block';
        if (saveActions) saveActions.style.display  = 'none';
        if (mgmtActions) mgmtActions.style.display  = 'flex';
    } else {
        if (badge) {
            badge.className = 'status-badge disconnected';
            badge.innerHTML = `<span class="status-indicator"></span>${t('integ_status_disconnected','No conectado')}`;
        }
        if (apiInput)   { apiInput.value = ''; apiInput.disabled = false; }
        if (toggleBtn)  toggleBtn.disabled = false;
        if (connInfo)    connInfo.style.display     = 'none';
        if (form)        form.style.display         = 'block';
        if (saveActions) saveActions.style.display  = 'flex';
        if (mgmtActions) mgmtActions.style.display  = 'none';

        const saveBtn = document.getElementById('btnSaveRepairDesk');
        if (saveBtn)    saveBtn.disabled = true;
    }
}

// ============================================
// SHEETS INVENTARIOS (VIN + fotos vía IA)
// Esta card es un launcher hacia /inventory: el formulario para pegar el
// enlace de la hoja y la tabla en vivo viven ahí, no aquí. Aquí solo se
// refleja si ya está conectada o no.
// ============================================

async function loadInventorySheetStatus(agentId) {
    if (!agentId) return;
    try {
        const res = await fetch(`/api/inventory-sheets/status/${agentId}`, { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        updateInventorySheetCardUI(data);
    } catch (e) {
        console.error('Inventory sheet status error:', e);
    }
}

function updateInventorySheetCardUI(data) {
    const badge   = document.getElementById('sheetsInventoryStatusBadge');
    const btnText = document.getElementById('sheetsInventoryBtnText');

    if (data.connected) {
        if (badge) {
            badge.className = 'status-badge connected';
            badge.innerHTML = `<span class="status-indicator"></span>${t('integ_status_connected', 'Conectado')}`;
        }
        if (btnText) btnText.textContent = t('integ_inv_btn_view', 'Ver Inventario');
    } else {
        if (badge) {
            badge.className = 'status-badge disconnected';
            badge.innerHTML = `<span class="status-indicator"></span>${t('integ_status_disconnected', 'No conectado')}`;
        }
        if (btnText) btnText.textContent = t('integ_inv_btn_connect', 'Conectar Inventario');
    }
}

async function saveRepairDeskKey() {
    if (!requireAgentSelected()) return;
    const apiKey = document.getElementById('repairDeskApiKey')?.value.trim();
    if (!apiKey)  { showNotification(t('integ_err_rd_apikey','Ingresa tu API Key de RepairDesk'), 'error'); return; }

    const btn = document.getElementById('btnSaveRepairDesk');
    const orig = btn.innerHTML;
    btn.innerHTML = `<div class="loading-spinner"></div><span>${t('integ_loading_connecting','Conectando...')}</span>`;
    btn.disabled = true;

    try {
        const res = await fetch(`/api/repairdesk/connect/${selectedAgentId}`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: apiKey })
        });
        if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Error al conectar'); }
        showNotification(t('integ_ok_rd_connected','RepairDesk conectado exitosamente'), 'success');
        await loadRepairDeskStatus(selectedAgentId);
        // Disparar sync inicial para reflejar inventario en My Business
        syncRepairDeskNow();
    } catch (err) {
        showNotification(err.message || t('integ_err_rd_connect','Error al conectar RepairDesk'), 'error');
        btn.innerHTML = orig;
        btn.disabled = false;
    }
}

async function syncRepairDeskNow() {
    if (!requireAgentSelected()) return;
    const btn = document.getElementById('btnSyncRepairDesk');
    if (btn) { if (btn) { btn.innerHTML = `<div class="loading-spinner"></div><span>${t('integ_loading_syncing','Sincronizando...')}</span>` ; btn.disabled = true; }; btn.disabled = true; }

    try {
        const res = await fetch(`/api/repairdesk/sync/${selectedAgentId}`, {
            method: 'POST',
            credentials: 'include'
        });
        if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Error al sincronizar'); }
        const data = await res.json();
        showNotification(`${t('integ_ok_rd_synced','Inventario sincronizado')}: ${data.synced_count ?? ''} ${t('integ_ok_rd_synced_count','productos')}`, 'success');
        await loadRepairDeskStatus(selectedAgentId);
    } catch (err) {
        showNotification(err.message || t('integ_err_rd_sync','Error al sincronizar'), 'error');
    } finally {
        if (btn) { btn.innerHTML = `<i class="lni lni-reload"></i> ${t('integ_rd_sync','Sincronizar ahora')}`; btn.disabled = false; }
    }
}

function enableRepairDeskEdit() {
    const apiInput   = document.getElementById('repairDeskApiKey');
    const toggleBtn  = document.getElementById('toggleRepairDeskKey');
    const saveActions = document.getElementById('repairDeskActions');
    const mgmtActions = document.getElementById('repairDeskManageActions');
    const connInfo    = document.getElementById('repairDeskConnectionInfo');
    const saveBtn     = document.getElementById('btnSaveRepairDesk');

    if (apiInput)    { apiInput.value = ''; apiInput.disabled = false; apiInput.focus(); }
    if (toggleBtn)   toggleBtn.disabled = false;
    if (connInfo)    connInfo.style.display  = 'none';
    if (saveActions) saveActions.style.display = 'flex';
    if (mgmtActions) mgmtActions.style.display = 'none';
    if (saveBtn)     saveBtn.disabled = true;
}

async function disconnectRepairDesk() {
    if (!selectedAgentId) return;
    if (!confirm('¿Desconectar RepairDesk? Se dejará de sincronizar el inventario.')) return;

    try {
        const res = await fetch(`/api/repairdesk/disconnect/${selectedAgentId}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        if (!res.ok) { const e = await res.json(); throw new Error(e.error || t('integ_err_sr_disconnect','Error al desconectar')); }
        showNotification(t('integ_ok_rd_disconnect','RepairDesk desconectado'), 'success');
        updateRepairDeskUI({ connected: false });
    } catch (err) {
        showNotification(err.message || t('integ_err_rd_disconnect',t('integ_err_sr_disconnect','Error al desconectar')), 'error');
    }
}
// ============================================
// SOFTRESTAURANT INTEGRATION
// ============================================

function initSoftRestaurantIntegration() {
    // Eye toggle
    const toggleBtn = document.getElementById('toggleSrKey');
    const keyInput  = document.getElementById('srApiKey');
    if (toggleBtn && keyInput) {
        toggleBtn.addEventListener('click', () => {
            const icon = toggleBtn.querySelector('i');
            if (keyInput.type === 'password') { keyInput.type = 'text'; icon.className = 'lni lni-eye-slash'; }
            else                              { keyInput.type = 'password'; icon.className = 'lni lni-eye'; }
        });
    }

    // Enable save when URL has value
    const urlInput = document.getElementById('srApiUrl');
    if (urlInput) {
        urlInput.addEventListener('input', () => {
            const saveBtn = document.getElementById('btnSaveSr');
            const testBtn = document.getElementById('btnSrTest');
            const hasVal  = urlInput.value.trim().length > 0;
            if (saveBtn) saveBtn.disabled = !hasVal;
            if (testBtn) testBtn.disabled = !hasVal;
        });
    }

    document.getElementById('btnSrTest')?.addEventListener('click', () => srTestConnection(false));
    document.getElementById('btnSaveSr')?.addEventListener('click', srSaveConfig);
    document.getElementById('btnSrTestConnected')?.addEventListener('click', () => srTestConnection(true));
    document.getElementById('btnEditSr')?.addEventListener('click', srEnableEdit);
    document.getElementById('btnDisconnectSr')?.addEventListener('click', srDisconnect);
}

async function loadSoftRestaurantStatus(agentId) {
    if (!agentId) return;
    try {
        const res  = await fetch(`/api/softrestaurant/status/${agentId}`, { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        updateSoftRestaurantUI(data);
    } catch (e) {
        console.warn('SR status error:', e);
    }
}

function updateSoftRestaurantUI(data) {
    const badge       = document.getElementById('srStatusBadge');
    const connInfo    = document.getElementById('srConnectionInfo');
    const saveActions = document.getElementById('srSaveActions');
    const mgmtActions = document.getElementById('srManageActions');
    const urlInput    = document.getElementById('srApiUrl');
    const keyInput    = document.getElementById('srApiKey');
    const toggleBtn   = document.getElementById('toggleSrKey');
    const timeoutIn   = document.getElementById('srTimeout');
    const autoSendIn  = document.getElementById('srAutoSend');
    const syncStatusIn= document.getElementById('srSyncStatus');
    const displayUrl  = document.getElementById('srDisplayUrl');
    const lastPush    = document.getElementById('srLastPush');

    if (data.connected) {
        if (badge) { badge.className = 'status-badge connected'; badge.innerHTML = `<span class="status-indicator"></span>${t('integ_status_connected','Conectado')}`; }
        if (urlInput)    { urlInput.value = data.url || ''; urlInput.disabled = true; }
        if (keyInput)    { keyInput.value = '••••••••••••••••••••'; keyInput.disabled = true; }
        if (toggleBtn)   toggleBtn.disabled = true;
        if (timeoutIn)   { timeoutIn.value = data.timeout || 10; timeoutIn.disabled = true; }
        if (autoSendIn)  { autoSendIn.checked = data.auto_send !== false; autoSendIn.disabled = true; }
        if (syncStatusIn){ syncStatusIn.checked = !!data.sync_status; syncStatusIn.disabled = true; }
        if (displayUrl)  displayUrl.textContent = data.url || '—';
        if (lastPush && data.last_push) lastPush.textContent = formatDate(new Date(data.last_push));
        if (connInfo)    connInfo.style.display  = 'block';
        if (saveActions) saveActions.style.display = 'none';
        if (mgmtActions) mgmtActions.style.display = 'flex';
    } else {
        if (badge) { badge.className = 'status-badge disconnected'; badge.innerHTML = `<span class="status-indicator"></span>${t('integ_status_disconnected','No conectado')}`; }
        if (urlInput)    { urlInput.value = data.url || ''; urlInput.disabled = false; }
        if (keyInput)    { keyInput.value = ''; keyInput.disabled = false; }
        if (toggleBtn)   toggleBtn.disabled = false;
        if (timeoutIn)   { timeoutIn.value = data.timeout || 10; timeoutIn.disabled = false; }
        if (autoSendIn)  { autoSendIn.checked = data.auto_send !== false; autoSendIn.disabled = false; }
        if (syncStatusIn){ syncStatusIn.checked = !!data.sync_status; syncStatusIn.disabled = false; }
        if (connInfo)    connInfo.style.display  = 'none';
        if (saveActions) saveActions.style.display = 'flex';
        if (mgmtActions) mgmtActions.style.display = 'none';
        // Re-evaluar botones
        const hasUrl = (urlInput?.value || '').trim().length > 0;
        const saveBtn = document.getElementById('btnSaveSr');
        const testBtn = document.getElementById('btnSrTest');
        if (saveBtn) saveBtn.disabled = !hasUrl;
        if (testBtn) testBtn.disabled = !hasUrl;
    }
    srHideTestResult();
}

async function srTestConnection(isConnected) {
    if (!requireAgentSelected()) return;
    const url    = document.getElementById('srApiUrl')?.value.trim();
    const apiKey = document.getElementById('srApiKey')?.value.trim();
    if (!url) { showNotification(t('integ_err_sr_url','Ingresa la URL de la API local'), 'error'); return; }

    const btnId  = isConnected ? 'btnSrTestConnected' : 'btnSrTest';
    const btn    = document.getElementById(btnId);
    const orig   = btn?.innerHTML;
    if (btn) { btn.innerHTML = `<div class="loading-spinner"></div><span>${t('integ_loading_testing','Probando...')}</span>`; btn.disabled = true; }
    srHideTestResult();

    try {
        const res = await fetch(`/api/softrestaurant/test/${selectedAgentId}`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, api_key: apiKey && !apiKey.startsWith('•') ? apiKey : undefined }),
        });
        const data = await res.json();
        if (res.ok && data.ok) {
            srShowTestResult('ok', `✓ Conexión exitosa${data.version ? ' · Versión: ' + data.version : ''}`);
        } else {
            srShowTestResult('err', `✗ ${data.error || 'No se pudo conectar con SoftRestaurant'}`);
        }
    } catch (e) {
        srShowTestResult('err', '✗ Error de red: ' + e.message);
    } finally {
        if (btn) { btn.innerHTML = orig; btn.disabled = false; }
    }
}

function srShowTestResult(type, msg) {
    const el = document.getElementById('srTestResultInline');
    if (!el) return;
    el.style.display = 'block';
    el.className = `sr-test-result-inline sr-result-${type}`;
    el.textContent = msg;
}
function srHideTestResult() {
    const el = document.getElementById('srTestResultInline');
    if (el) el.style.display = 'none';
}

async function srSaveConfig() {
    if (!requireAgentSelected()) return;
    const url      = document.getElementById('srApiUrl')?.value.trim();
    const apiKeyRaw= document.getElementById('srApiKey')?.value.trim();
    const timeout  = parseInt(document.getElementById('srTimeout')?.value) || 10;
    const autoSend = document.getElementById('srAutoSend')?.checked ?? true;
    const syncStat = document.getElementById('srSyncStatus')?.checked ?? false;

    if (!url) { showNotification(t('integ_err_sr_url','Ingresa la URL de la API local'), 'error'); return; }

    const payload = { url, timeout, auto_send: autoSend, sync_status: syncStat };
    if (apiKeyRaw && !apiKeyRaw.startsWith('•')) payload.api_key = apiKeyRaw;

    const btn  = document.getElementById('btnSaveSr');
    const orig = btn?.innerHTML;
    if (btn) { btn.innerHTML = `<div class="loading-spinner"></div><span>${t('integ_loading_saving','Guardando...')}</span>`; btn.disabled = true; }

    try {
        const res = await fetch(`/api/softrestaurant/config/${selectedAgentId}`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Error al guardar'); }
        showNotification(t('integ_ok_sr_connected','SoftRestaurant conectado'), 'success');
        await loadSoftRestaurantStatus(selectedAgentId);
    } catch (err) {
        showNotification(err.message || t('integ_err_sr_save','Error al guardar'), 'error');
        if (btn) { btn.innerHTML = orig; btn.disabled = false; }
    }
}

function srEnableEdit() {
    const urlInput    = document.getElementById('srApiUrl');
    const keyInput    = document.getElementById('srApiKey');
    const toggleBtn   = document.getElementById('toggleSrKey');
    const timeoutIn   = document.getElementById('srTimeout');
    const autoSendIn  = document.getElementById('srAutoSend');
    const syncStatusIn= document.getElementById('srSyncStatus');
    const connInfo    = document.getElementById('srConnectionInfo');
    const saveActions = document.getElementById('srSaveActions');
    const mgmtActions = document.getElementById('srManageActions');
    const saveBtn     = document.getElementById('btnSaveSr');
    const testBtn     = document.getElementById('btnSrTest');

    if (urlInput)    { urlInput.disabled = false; }
    if (keyInput)    { keyInput.value = ''; keyInput.disabled = false; keyInput.focus(); }
    if (toggleBtn)   toggleBtn.disabled = false;
    if (timeoutIn)   timeoutIn.disabled = false;
    if (autoSendIn)  autoSendIn.disabled = false;
    if (syncStatusIn)syncStatusIn.disabled = false;
    if (connInfo)    connInfo.style.display  = 'none';
    if (saveActions) saveActions.style.display = 'flex';
    if (mgmtActions) mgmtActions.style.display = 'none';
    if (saveBtn)     saveBtn.disabled = false;
    if (testBtn)     testBtn.disabled = false;
    srHideTestResult();
}

async function srDisconnect() {
    if (!selectedAgentId) return;
    if (!confirm('¿Desconectar SoftRestaurant? Los pedidos nuevos ya no se enviarán automáticamente.')) return;
    try {
        const res = await fetch(`/api/softrestaurant/config/${selectedAgentId}`, {
            method: 'DELETE', credentials: 'include'
        });
        if (!res.ok) throw new Error();
        showNotification(t('integ_ok_sr_disconnect','SoftRestaurant desconectado'), 'success');
        updateSoftRestaurantUI({ connected: false });
    } catch {
        showNotification(t('integ_err_sr_disconnect','Error al desconectar'), 'error');
    }
}
// ============================================
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