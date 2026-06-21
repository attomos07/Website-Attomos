// ============================================
// BUSINESS PORTFOLIO JAVASCRIPT
// ============================================

document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 Business Portfolio cargado');
    
    initToggleVisibility();
    initCopyButtons();
    initGenerateToken();
    initFormActions();
    loadSavedConfig();
});

// ============================================
// VERSION SELECTOR - REMOVED
// ============================================

// ============================================
// TOGGLE PASSWORD VISIBILITY
// ============================================

function initToggleVisibility() {
    const toggleButtons = document.querySelectorAll('.toggle-visibility');
    
    toggleButtons.forEach(button => {
        button.addEventListener('click', function() {
            const targetId = this.getAttribute('data-target');
            const input = document.getElementById(targetId);
            const icon = this.querySelector('i');
            
            if (input.type === 'password') {
                input.type = 'text';
                icon.classList.remove('lni-eye');
                icon.classList.add('lni-eye-slash');
            } else {
                input.type = 'password';
                icon.classList.remove('lni-eye-slash');
                icon.classList.add('lni-eye');
            }
        });
    });
}

// ============================================
// COPY TO CLIPBOARD
// ============================================

function initCopyButtons() {
    const copyButtons = document.querySelectorAll('.copy-btn');
    
    copyButtons.forEach(button => {
        button.addEventListener('click', function() {
            const targetId = this.getAttribute('data-copy');
            const input = document.getElementById(targetId);
            const value = input.value;
            
            if (!value) {
                showToast('No hay nada que copiar', 'error');
                return;
            }
            
            navigator.clipboard.writeText(value).then(() => {
                showToast('Copiado al portapapeles', 'success');
                
                // Visual feedback
                const icon = this.querySelector('i');
                icon.classList.remove('lni-copy');
                icon.classList.add('lni-checkmark');
                
                setTimeout(() => {
                    icon.classList.remove('lni-checkmark');
                    icon.classList.add('lni-copy');
                }, 2000);
            }).catch(err => {
                console.error('Error al copiar:', err);
                showToast('Error al copiar', 'error');
            });
        });
    });
}

// ============================================
// GENERATE TOKEN
// ============================================

function initGenerateToken() {
    const generateButtons = document.querySelectorAll('.generate-btn');
    
    generateButtons.forEach(button => {
        button.addEventListener('click', function() {
            const targetId = this.getAttribute('data-generate');
            const input = document.getElementById(targetId);
            
            // Generate random token (32 characters)
            const token = generateRandomToken(32);
            input.value = token;
            
            // Show as text temporarily
            input.type = 'text';
            
            // Visual feedback
            const icon = this.querySelector('i');
            icon.style.animation = 'spin 0.5s ease';
            
            setTimeout(() => {
                icon.style.animation = '';
            }, 500);
            
            showToast('Token generado exitosamente', 'success');
            
            console.log('🔑 Token generado:', token);
        });
    });
}

function generateRandomToken(length) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let token = '';
    for (let i = 0; i < length; i++) {
        token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
}

// ============================================
// FORM ACTIONS
// ============================================

function initFormActions() {
    const btnSave = document.getElementById('btnSave');
    const btnDisconnect = document.getElementById('btnDisconnect');
    
    if (btnSave) {
        btnSave.addEventListener('click', saveConfiguration);
    }
    
    if (btnDisconnect) {
        btnDisconnect.addEventListener('click', disconnectConfiguration);
    }
}

// ============================================
// TEST CONNECTION - REMOVED
// ============================================

// ============================================
// SAVE CONFIGURATION
// ============================================

async function saveConfiguration() {
    const btnSave = document.getElementById('btnSave');
    const originalHTML = btnSave.innerHTML;
    
    // Get values
    const jwtToken = document.getElementById('metaJwtToken').value.trim();
    const numberId = document.getElementById('metaNumberId').value.trim();
    const verifyToken = document.getElementById('metaVerifyToken').value.trim();
    const version = document.getElementById('metaVersion').value;
    
    // Validate
    if (!jwtToken || !numberId || !verifyToken) {
        showToast('Por favor completa todos los campos requeridos', 'error');
        return;
    }
    
    // Show loading
    btnSave.innerHTML = `
        <div class="loading-spinner"></div>
        <span>Guardando...</span>
    `;
    btnSave.classList.add('loading');
    
    const configData = {
        jwt_token: jwtToken,
        number_id: numberId,
        verify_token: verifyToken,
        version: version
    };
    
    console.log('💾 Guardando configuración:', {
        ...configData,
        jwt_token: '***' + jwtToken.slice(-8),
        verify_token: '***' + verifyToken.slice(-8)
    });
    
    try {
        // Save to localStorage (simulated backend)
        localStorage.setItem('meta_whatsapp_config', JSON.stringify({
            ...configData,
            saved_at: new Date().toISOString()
        }));
        
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        // Reset button
        btnSave.innerHTML = originalHTML;
        btnSave.classList.remove('loading');
        
        // Update UI
        updateConnectionStatus(true);
        showStatusPanel(configData);
        
        showToast('✅ Configuración guardada exitosamente', 'success');
        console.log('✅ Configuración guardada');
        
    } catch (error) {
        console.error('Error guardando configuración:', error);
        
        btnSave.innerHTML = originalHTML;
        btnSave.classList.remove('loading');
        
        showToast('❌ Error al guardar la configuración', 'error');
    }
}

// ============================================
// DISCONNECT
// ============================================

async function disconnectConfiguration() {
    if (!confirm('¿Estás seguro de que deseas desconectar WhatsApp Business? Tendrás que volver a configurar.')) {
        return;
    }
    
    const btnDisconnect = document.getElementById('btnDisconnect');
    const originalHTML = btnDisconnect.innerHTML;
    
    btnDisconnect.innerHTML = `
        <div class="loading-spinner" style="border-top-color: #dc2626;"></div>
        <span>Desconectando...</span>
    `;
    btnDisconnect.disabled = true;
    
    try {
        // Remove from localStorage
        localStorage.removeItem('meta_whatsapp_config');
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Reset form
        document.getElementById('metaJwtToken').value = '';
        document.getElementById('metaNumberId').value = '';
        document.getElementById('metaVerifyToken').value = '';
        
        // Update UI
        updateConnectionStatus(false);
        hideStatusPanel();
        
        btnDisconnect.innerHTML = originalHTML;
        btnDisconnect.disabled = false;
        
        showToast('WhatsApp Business desconectado', 'success');
        console.log('🔌 Desconectado');
        
    } catch (error) {
        console.error('Error al desconectar:', error);
        
        btnDisconnect.innerHTML = originalHTML;
        btnDisconnect.disabled = false;
        
        showToast('Error al desconectar', 'error');
    }
}

// ============================================
// UI UPDATES
// ============================================

function updateConnectionStatus(connected) {
    const statusBadge = document.getElementById('connectionStatus');
    
    if (connected) {
        statusBadge.innerHTML = `
            <i class="lni lni-checkmark-circle"></i>
            <span>Configurado</span>
        `;
        statusBadge.classList.add('connected');
    } else {
        statusBadge.innerHTML = `
            <i class="lni lni-close-circle"></i>
            <span>No configurado</span>
        `;
        statusBadge.classList.remove('connected');
    }
}

function showStatusPanel(config) {
    const panel = document.getElementById('statusPanel');
    const configForm = document.querySelector('.config-form');
    
    // Update values
    document.getElementById('savedNumberId').textContent = config.number_id;
    document.getElementById('savedVersion').textContent = config.version;
    
    const now = new Date();
    document.getElementById('savedTimestamp').textContent = now.toLocaleString('es-MX', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
    
    // Show panel, hide form
    panel.style.display = 'block';
    configForm.style.display = 'none';
    
    // Scroll to panel
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideStatusPanel() {
    const panel = document.getElementById('statusPanel');
    const configForm = document.querySelector('.config-form');
    
    panel.style.display = 'none';
    configForm.style.display = 'flex';
}

// ============================================
// LOAD SAVED CONFIG
// ============================================

function loadSavedConfig() {
    const saved = localStorage.getItem('meta_whatsapp_config');
    
    if (!saved) {
        console.log('ℹ️ No hay configuración guardada');
        return;
    }
    
    try {
        const config = JSON.parse(saved);
        
        // Populate form
        document.getElementById('metaJwtToken').value = config.jwt_token;
        document.getElementById('metaNumberId').value = config.number_id;
        document.getElementById('metaVerifyToken').value = config.verify_token;
        document.getElementById('metaVersion').value = config.version;
        
        // Update UI
        updateConnectionStatus(true);
        showStatusPanel(config);
        
        console.log('✅ Configuración cargada:', {
            number_id: config.number_id,
            version: config.version,
            saved_at: config.saved_at
        });
        
    } catch (error) {
        console.error('Error cargando configuración:', error);
        localStorage.removeItem('meta_whatsapp_config');
    }
}

// ============================================
// TOAST NOTIFICATIONS
// ============================================

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let icon = 'information';
    if (type === 'success') icon = 'checkmark-circle';
    if (type === 'error') icon = 'cross-circle';
    
    toast.innerHTML = `
        <i class="lni lni-${icon}"></i>
        <span>${message}</span>
    `;
    
    container.appendChild(toast);
    
    // Animate in
    setTimeout(() => {
        toast.classList.add('show');
    }, 10);
    
    // Remove after 4 seconds
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 4000);
}

// ============================================
// KEYBOARD SHORTCUTS
// ============================================

document.addEventListener('keydown', function(e) {
    // Ctrl/Cmd + S = Save
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveConfiguration();
    }
});

console.log('⌨️ Atajos de teclado:');
console.log('  - Ctrl/Cmd + S: Guardar configuración');