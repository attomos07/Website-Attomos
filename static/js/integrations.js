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

// ============================================
// AGENT SELECTOR
// ============================================

async function initAgentSelector() {
    console.log('📊 Cargando agentes...');
    
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
            showNoAgentsState();
            return;
        }

        populateAgentSelector(agents);
        setupAgentSelectorEvents();
        
    } catch (error) {
        console.error('Error cargando agentes:', error);
        showNotification(t('integ_err_load_agents','Error al cargar agentes'), 'error');
        showNoAgentsState();
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
    
    if (grid) grid.style.display = 'grid';
    if (emptyState) emptyState.classList.remove('active');
}

function showNoAgentsState() {
    const grid = document.getElementById('integrationsGrid');
    const emptyState = document.getElementById('emptyState');
    const noAgentsState = document.getElementById('noAgentsState');
    const agentSelector = document.querySelector('.agent-selector');
    
    if (grid) grid.style.display = 'none';
    if (emptyState) emptyState.classList.remove('active');
    if (noAgentsState) noAgentsState.style.display = 'block';
    if (agentSelector) agentSelector.style.display = 'none';
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
                Configurado
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
                Sin configurar
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
    if (!selectedAgentId) {
        showNotification(t('integ_err_select_agent','Por favor selecciona un agente primero'), 'error');
        return;
    }
    
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
    if (!selectedAgentId) {
        showNotification(t('integ_err_select_agent','Por favor selecciona un agente primero'), 'error');
        return;
    }
    
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
                Configurado
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
                Sin configurar
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
    if (!selectedAgentId) {
        showNotification(t('integ_err_select_agent','Por favor selecciona un agente primero'), 'error');
        return;
    }
    
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
    if (!selectedAgentId) {
        showNotification(t('integ_err_select_agent','Por favor selecciona un agente primero'), 'error');
        return;
    }
    
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
    const connectButton = document.getElementById('btnConnectGoogle');
    const disconnectButton = document.getElementById('btnDisconnectGoogle');
    
    if (connectButton) {
        connectButton.addEventListener('click', connectGoogle);
    }
    
    if (disconnectButton) {
        disconnectButton.addEventListener('click', disconnectGoogle);
    }
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
    const statusBadge = document.getElementById('googleStatusBadge');
    const sheetsStatusBadge = document.getElementById('sheetsStatusBadge');
    const connectionInfo = document.getElementById('googleConnectionInfo');
    const sheetsConnectionInfo = document.getElementById('sheetsConnectionInfo');
    const connectActions = document.getElementById('googleConnectActions');
    const manageActions = document.getElementById('googleManageActions');
    
    if (data.connected) {
        // Update status badges
        if (statusBadge) {
            statusBadge.className = 'status-badge connected';
            statusBadge.innerHTML = `
                <span class="status-indicator"></span>
                Conectado
            `;
        }
        
        if (sheetsStatusBadge) {
            sheetsStatusBadge.className = 'status-badge connected';
            sheetsStatusBadge.innerHTML = `
                <span class="status-indicator"></span>
                Conectado
            `;
        }
        
        // Show connection info
        if (connectionInfo) {
            connectionInfo.style.display = 'block';
            
            const calendarLink = document.getElementById('calendarLink');
            const calendarConnectedAt = document.getElementById('calendarConnectedAt');
            
            if (calendarLink && data.calendar_id) {
                const calendarUrl = `https://calendar.google.com/calendar/u/0/r`;
                calendarLink.href = calendarUrl;
            }
            
            if (calendarConnectedAt && data.connected_at) {
                const date = new Date(data.connected_at);
                calendarConnectedAt.textContent = formatDate(date);
            }
        }
        
        if (sheetsConnectionInfo) {
            sheetsConnectionInfo.style.display = 'block';
            
            const sheetLink = document.getElementById('sheetLink');
            const sheetsConnectedAt = document.getElementById('sheetsConnectedAt');
            
            if (sheetLink && data.sheet_id) {
                const sheetUrl = `https://docs.google.com/spreadsheets/d/${data.sheet_id}/edit`;
                sheetLink.href = sheetUrl;
            }
            
            if (sheetsConnectedAt && data.connected_at) {
                const date = new Date(data.connected_at);
                sheetsConnectedAt.textContent = formatDate(date);
            }
        }
        
        // Show manage actions, hide connect actions
        if (connectActions) connectActions.style.display = 'none';
        if (manageActions) manageActions.style.display = 'flex';
        
    } else {
        // Update status badges
        if (statusBadge) {
            statusBadge.className = 'status-badge disconnected';
            statusBadge.innerHTML = `
                <span class="status-indicator"></span>
                No conectado
            `;
        }
        
        if (sheetsStatusBadge) {
            sheetsStatusBadge.className = 'status-badge disconnected';
            sheetsStatusBadge.innerHTML = `
                <span class="status-indicator"></span>
                No conectado
            `;
        }
        
        // Hide connection info
        if (connectionInfo) connectionInfo.style.display = 'none';
        if (sheetsConnectionInfo) sheetsConnectionInfo.style.display = 'none';
        
        // Show connect actions, hide manage actions
        if (connectActions) connectActions.style.display = 'flex';
        if (manageActions) manageActions.style.display = 'none';
        
        // Habilitar el botón de conectar
        const connectButton = document.getElementById('btnConnectGoogle');
        if (connectButton) connectButton.disabled = false;
    }
}

async function connectGoogle() {
    if (!selectedAgentId) {
        showNotification(t('integ_err_select_agent','Por favor selecciona un agente primero'), 'error');
        return;
    }
    
    console.log(`🔗 Iniciando conexión de Google para agente ${selectedAgentId}...`);
    
    try {
        const response = await fetch(`/api/google/connect?agent_id=${selectedAgentId}`, {
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
        
        const pollTimer = setInterval(async () => {
            if (popup.closed) {
                clearInterval(pollTimer);
                console.log('🔄 Ventana OAuth cerrada, verificando estado...');
                
                await new Promise(resolve => setTimeout(resolve, 1000));
                await loadGoogleIntegrationStatus(selectedAgentId);
            }
        }, 500);
        
    } catch (error) {
        console.error('Error conectando Google:', error);
        showNotification(t('integ_err_google_connect','Error al conectar con Google'), 'error');
    }
}

async function disconnectGoogle() {
    if (!selectedAgentId) {
        showNotification(t('integ_err_select_agent','Por favor selecciona un agente primero'), 'error');
        return;
    }
    
    if (!confirm('¿Estás seguro de que quieres desconectar Google? Esto eliminará el acceso a tu calendario y hoja de cálculo.')) {
        return;
    }
    
    console.log(`🔌 Desconectando Google para agente ${selectedAgentId}...`);
    
    const btnDisconnect = document.getElementById('btnDisconnectGoogle');
    const originalText = btnDisconnect.innerHTML;
    
    btnDisconnect.innerHTML = `
        <div class="loading-spinner"></div>
        <span>Desconectando...</span>
    `;
    btnDisconnect.disabled = true;
    
    try {
        const response = await fetch(`/api/google/disconnect/${selectedAgentId}`, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(t('integ_err_google_disconnect','Error al desconectar Google'));
        }

        const data = await response.json();
        console.log('✅ Google desconectado:', data);
        
        showNotification(t('integ_ok_google_disconnect','Google desconectado exitosamente'), 'success');
        await loadGoogleIntegrationStatus(selectedAgentId);
        
    } catch (error) {
        console.error('Error desconectando Google:', error);
        showNotification(t('integ_err_google_disconnect','Error al desconectar Google'), 'error');
        
        btnDisconnect.innerHTML = originalText;
        btnDisconnect.disabled = false;
    }
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
    const anyConfigured = data.speiEnabled || data.stripeEnabled;
    if (mainBadge) {
        if (anyConfigured) {
            mainBadge.className = 'status-badge connected';
            mainBadge.innerHTML = `<span class="status-indicator"></span>${t('integ_status_configured','Configurado')}`;
        } else {
            mainBadge.className = 'status-badge disconnected';
            mainBadge.innerHTML = `<span class="status-indicator"></span>${t('integ_status_without_config','Sin configurar')}`;
        }
    }
}

// ── SPEI: guardar ──────────────────────────────────────────

async function saveSPEIConfig() {
    if (!selectedAgentId) {
        showNotification(t('integ_err_select_agent','Por favor selecciona un agente primero'), 'error');
        return;
    }

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

// ── Stripe Connect: conectar ───────────────────────────────

async function connectStripe() {
    if (!selectedAgentId) {
        showNotification(t('integ_err_select_agent','Por favor selecciona un agente primero'), 'error');
        return;
    }

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
                    .btn-close-onboarding{width:40px!important;height:40px!important;border-radius:50%!important;border:none!important;background:#f3f4f6!important;color:#6b7280!important;cursor:pointer!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;font-size:1.1rem!important;flex-shrink:0!important;transition:all 0.2s!important;}
                    .btn-close-onboarding:hover{background:#fee2e2!important;color:#ef4444!important;}
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

async function saveRepairDeskKey() {
    if (!selectedAgentId) { showNotification(t('integ_err_select_agent','Selecciona un agente primero'), 'error'); return; }
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
    if (!selectedAgentId) { showNotification(t('integ_err_select_agent','Selecciona un agente primero'), 'error'); return; }
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
    if (!selectedAgentId) { showNotification(t('integ_err_select_agent','Selecciona un agente primero'), 'error'); return; }
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
    if (!selectedAgentId) { showNotification(t('integ_err_select_agent','Selecciona un agente primero'), 'error'); return; }
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