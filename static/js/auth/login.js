// ============================================
// LOGIN JAVASCRIPT - CON API REAL Y GOOGLE OAUTH
// ============================================

document.addEventListener('DOMContentLoaded', function () {
    console.log('🔐 Login JS cargado correctamente');

    // Inicializar funcionalidades
    initLoginValidation();
    // initPasswordToggle();  <--- ELIMINADO: Ya lo manejas con el onclick en el HTML
    initLoginForm();
    initSocialLogin();
    checkURLParams();

    console.log('✅ Login funcionalidades inicializadas');
});

// ============================================
// VERIFICAR PARÁMETROS DE URL (ERRORES DE OAUTH)
// ============================================

function checkURLParams() {
    const urlParams = new URLSearchParams(window.location.search);
    const error = urlParams.get('error');

    if (error) {
        let errorMessage = 'Error en autenticación con Google';

        switch (error) {
            case 'invalid_state':
                errorMessage = 'Error de seguridad. Por favor intenta de nuevo.';
                break;
            case 'no_code':
                errorMessage = 'No se recibió autorización de Google';
                break;
            case 'token_exchange_failed':
                errorMessage = 'Error al procesar la autenticación';
                break;
            case 'user_info_failed':
                errorMessage = 'No se pudo obtener tu información de Google';
                break;
            case 'user_creation_failed':
                errorMessage = 'Error al crear tu cuenta';
                break;
            case 'token_generation_failed':
                errorMessage = 'Error al iniciar sesión';
                break;
        }

        showNotificationIOS(errorMessage, 'error');
        window.history.replaceState({}, document.title, window.location.pathname);
    }
}

// ============================================
// VALIDACIÓN ESPECÍFICA DEL LOGIN
// ============================================

function initLoginValidation() {
    const loginForm = document.getElementById('loginForm');
    if (!loginForm) return;

    const inputs = loginForm.querySelectorAll('.form-input');

    inputs.forEach(input => {
        input.addEventListener('blur', function () {
            validateLoginField(this);
        });

        input.addEventListener('input', function () {
            clearFieldError(this);
        });
    });
}

function validateLoginField(field) {
    const fieldName = field.name || field.id;
    const value = field.value.trim();
    let isValid = true;
    let errorMessage = '';

    clearFieldError(field);

    switch (fieldName) {
        case 'email':
            if (!value) {
                errorMessage = 'El email es requerido';
                isValid = false;
            } else if (!isValidEmail(value)) {
                errorMessage = 'Ingresa un email válido';
                isValid = false;
            }
            break;

        case 'password':
            if (!value) {
                errorMessage = 'La contraseña es requerida';
                isValid = false;
            } else if (value.length < 6) {
                errorMessage = 'La contraseña debe tener al menos 6 caracteres';
                isValid = false;
            }
            break;
    }

    if (!isValid) {
        showFieldError(field, errorMessage);
    } else {
        showFieldSuccess(field);
    }

    return isValid;
}


// Esta función es llamada directamente desde el HTML con onclick="togglePassword('password')"
function togglePassword(fieldId) {
    const field = document.getElementById(fieldId);
    const icon = document.getElementById(fieldId + 'ToggleIcon');

    if (!field || !icon) return;

    const isPassword = field.type === 'password';
    field.type = isPassword ? 'text' : 'password';

    if (isPassword) {
        // Ojo CERRADO: arco oscuro + pestañas grises hacia abajo
        icon.innerHTML = [
            '<path d="M3.5 9.5 Q12.0234 16.5 20.5 9.5"',
            ' stroke="#374151" stroke-width="2.2" stroke-linecap="round" fill="none"/>',
            '<line x1="4.8" y1="10.8" x2="3.5" y2="13.5"',
            ' stroke="#9CA3AF" stroke-width="1.6" stroke-linecap="round"/>',
            '<line x1="8.0" y1="13.0" x2="7.3" y2="15.8"',
            ' stroke="#9CA3AF" stroke-width="1.6" stroke-linecap="round"/>',
            '<line x1="12.0" y1="14.0" x2="12.0" y2="17.0"',
            ' stroke="#9CA3AF" stroke-width="1.6" stroke-linecap="round"/>',
            '<line x1="16.0" y1="13.0" x2="16.7" y2="15.8"',
            ' stroke="#9CA3AF" stroke-width="1.6" stroke-linecap="round"/>',
            '<line x1="19.2" y1="10.8" x2="20.5" y2="13.5"',
            ' stroke="#9CA3AF" stroke-width="1.6" stroke-linecap="round"/>'
        ].join('');
    } else {
        // Ojo ABIERTO: SVG original del usuario
        icon.innerHTML = [
            '<path fill-rule="evenodd" clip-rule="evenodd"',
            ' d="M12.0234 7.625C9.60719 7.625 7.64844 9.58375 7.64844 12C7.64844 14.4162',
            ' 9.60719 16.375 12.0234 16.375C14.4397 16.375 16.3984 14.4162 16.3984 12C16.3984',
            ' 9.58375 14.4397 7.625 12.0234 7.625ZM9.14844 12C9.14844 10.4122 10.4356 9.125',
            ' 12.0234 9.125C13.6113 9.125 14.8984 10.4122 14.8984 12C14.8984 13.5878 13.6113',
            ' 14.875 12.0234 14.875C10.4356 14.875 9.14844 13.5878 9.14844 12Z" fill="#9CA3AF"/>',
            '<path fill-rule="evenodd" clip-rule="evenodd"',
            ' d="M12.0234 4.5C7.71145 4.5 3.99772 7.05632 2.30101 10.7351C1.93091 11.5375',
            ' 1.93091 12.4627 2.30101 13.2652C3.99772 16.9439 7.71145 19.5002 12.0234 19.5002C',
            '16.3353 19.5002 20.049 16.9439 21.7458 13.2652C22.1159 12.4627 22.1159 11.5375',
            ' 21.7458 10.7351C20.049 7.05633 16.3353 4.5 12.0234 4.5ZM3.66311 11.3633C5.12472',
            ' 8.19429 8.32017 6 12.0234 6C15.7266 6 18.922 8.19429 20.3836 11.3633C20.5699',
            ' 11.7671 20.5699 12.2331 20.3836 12.6369C18.922 15.8059 15.7266 18.0002 12.0234',
            ' 18.0002C8.32017 18.0002 5.12472 15.8059 3.66311 12.6369C3.47688 12.2331 3.47688',
            ' 11.7671 3.66311 11.3633Z" fill="#9CA3AF"/>'
        ].join('');
    }
}

// ============================================
// MANEJO DEL FORMULARIO DE LOGIN
// ============================================

function initLoginForm() {
    const loginForm = document.getElementById('loginForm');
    if (!loginForm) return;

    loginForm.addEventListener('submit', handleLoginSubmit);

}

async function handleLoginSubmit(e) {
    e.preventDefault();

    const form = e.target;
    const formData = new FormData(form);

    let isValid = true;
    const requiredFields = ['email', 'password'];

    requiredFields.forEach(fieldName => {
        const field = form.querySelector(`[name="${fieldName}"]`);
        if (field && !validateLoginField(field)) {
            isValid = false;
        }
    });

    if (!isValid) {
        showNotificationIOS('Por favor corrige los errores en el formulario', 'error');
        const firstError = form.querySelector('.form-input.error');
        if (firstError) {
            firstError.focus();
        }
        return;
    }

    const data = {
        email: formData.get('email'),
        password: formData.get('password')
    };

    const submitBtn = form.querySelector('.auth-btn');
    setButtonLoading(submitBtn, true);

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data),
            credentials: 'include'
        });

        const result = await response.json();

        if (response.ok) {
            handleLoginSuccess(result);
        } else {
            handleLoginError(result.error || 'Error al iniciar sesión');
            setButtonLoading(submitBtn, false);
        }
    } catch (error) {
        console.error('Error en login:', error);
        handleLoginError('Error de conexión. Intenta de nuevo.');
        setButtonLoading(submitBtn, false);
    }
}

function handleLoginSuccess(data) {
    console.log('Login exitoso:', data);
    showNotificationIOS('¡Inicio de sesión exitoso!', 'success');

    trackLoginEvent('login_success', { method: 'email' });

    setTimeout(() => {
        // Redirigir según lo que diga el backend o por defecto al dashboard
        window.location.href = data.redirect || '/dashboard';
    }, 1500);
}

function handleLoginError(message) {
    showNotificationIOS(message, 'error');

    trackLoginEvent('login_error', {
        method: 'email',
        error: message
    });

    const passwordField = document.getElementById('password');
    if (passwordField) {
        passwordField.select();
        passwordField.focus();
    }
}

// ============================================
// LOGIN SOCIAL - GOOGLE OAUTH
// ============================================

function initSocialLogin() {
    console.log('🔗 Social login inicializado');
}

function loginWithGoogle() {
    showNotificationIOS('Redirigiendo a Google...', 'info');
    trackLoginEvent('social_login_attempt', { provider: 'google' });
    window.location.href = '/api/auth/google/login';
}

function loginWithFacebook() {
    showNotificationIOS('Redirigiendo a Facebook...', 'info');
    trackLoginEvent('social_login_attempt', { provider: 'facebook' });
    setTimeout(() => {
        showNotificationIOS('Funcionalidad en desarrollo', 'warning');
    }, 1000);
}

// ============================================
// FUNCIONES DE UTILIDAD
// ============================================

function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

function showFieldError(field, message) {
    field.classList.add('error');
    field.classList.remove('success');

    const errorElement = document.getElementById(field.name + 'Error') ||
        document.getElementById(field.id + 'Error');

    if (errorElement) {
        errorElement.textContent = message;
        errorElement.classList.add('show');
    }
}

function showFieldSuccess(field) {
    field.classList.add('success');
    field.classList.remove('error');
}

function clearFieldError(field) {
    field.classList.remove('error', 'success');
    const errorElement = document.getElementById(field.name + 'Error') ||
        document.getElementById(field.id + 'Error');

    if (errorElement) {
        errorElement.textContent = '';
        errorElement.classList.remove('show');
    }
}

function setButtonLoading(button, isLoading) {
    const btnText = button.querySelector('.btn-text');
    const btnLoading = button.querySelector('.btn-loading');

    if (isLoading) {
        button.disabled = true;
        btnText.style.display = 'none';
        btnLoading.style.display = 'flex';
    } else {
        button.disabled = false;
        btnText.style.display = 'block';
        btnLoading.style.display = 'none';
    }
}

// ============================================
// SISTEMA DE NOTIFICACIONES ESTILO iOS
// ============================================

function showNotificationIOS(message, type = 'info') {
    if (!document.getElementById('notification-ios-styles')) {
        addNotificationIOSStyles();
    }

    let container = document.getElementById('notification-ios-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'notification-ios-container';
        document.body.appendChild(container);
    }

    const notification = document.createElement('div');
    notification.className = `notification-ios notification-ios-${type}`;

    const iconHTML = getNotificationIconHTML(type);

    notification.innerHTML = `
        <div class="notification-ios-content">
            <div class="notification-ios-icon">${iconHTML}</div>
            <span class="notification-ios-message">${message}</span>
        </div>
    `;

    container.appendChild(notification);
    void notification.offsetWidth;

    requestAnimationFrame(() => {
        notification.classList.add('notification-ios-show');
    });

    setTimeout(() => {
        notification.classList.remove('notification-ios-show');
        notification.classList.add('notification-ios-hide');
        setTimeout(() => {
            if (notification.parentElement) {
                notification.parentElement.removeChild(notification);
            }
        }, 500);
    }, 2500);
}

function getNotificationIconHTML(type) {
    const icons = {
        success: `
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" fill="white"/>
                <path d="M9 12l2 2 4-4" stroke="#10B981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        `,
        error: `
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" fill="white"/>
                <path d="M15 9l-6 6M9 9l6 6" stroke="#EF4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        `,
        warning: `
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" fill="white"/>
                <path d="M12 8v4M12 16h.01" stroke="#F59E0B" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        `,
        info: `
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" fill="white"/>
                <path d="M12 16v-4M12 8h.01" stroke="#06B6D4" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        `
    };
    return icons[type] || icons.info;
}

function addNotificationIOSStyles() {
    const styles = document.createElement('style');
    styles.id = 'notification-ios-styles';
    styles.textContent = `
        /* Contenedor CENTRADO en la parte superior */
        #notification-ios-container {
            position: fixed;
            top: 25px;
            left: 0;
            right: 0;
            z-index: 10000;
            pointer-events: none;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 12px;
        }
        
        /* Estilo Base de la Tarjeta */
        .notification-ios {
            background: #10B981;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
            border-radius: 50px;
            padding: 16px 30px; 
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            will-change: transform, opacity;
            pointer-events: auto;
            min-width: auto;
            max-width: 90%;
            opacity: 0;
            transform: translateY(-60px);
        }
        
        /* Variantes de Color */
        .notification-ios-success { background: rgba(16, 185, 129, 0.92); }
        .notification-ios-error { background: rgba(239, 68, 68, 0.92); }
        .notification-ios-warning { background: rgba(245, 158, 11, 0.92); }
        .notification-ios-info { background: rgba(6, 182, 212, 0.92); }
        
        /* Layout Interno */
        .notification-ios-content {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 14px; 
        }
        
        .notification-ios-icon {
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 30px; 
            height: 30px;
            background: rgba(255,255,255,0.2);
            border-radius: 50%;
            padding: 5px;
        }

        .notification-ios-icon svg {
            width: 100%;
            height: 100%;
        }
        
        .notification-ios-message {
            color: white;
            font-weight: 600;
            font-size: 16px; 
            line-height: 1.4;
            white-space: nowrap;
        }
        
        /* Animacion de ENTRADA */
        @keyframes notificationSlideInDown {
            0% { 
                opacity: 0; 
                transform: translateY(-60px) scale(0.9); 
            }
            60% { 
                opacity: 1; 
                transform: translateY(5px) scale(1.03);
            }
            100% { 
                opacity: 1; 
                transform: translateY(0) scale(1); 
            }
        }
        
        /* Animacion de SALIDA */
        @keyframes notificationFadeDownOut {
            0% { 
                opacity: 1; 
                transform: translateY(0) scale(1); 
            }
            100% { 
                opacity: 0; 
                transform: translateY(30px) scale(0.95);
            }
        }
        
        /* Animacion del Icono */
        @keyframes iconPop {
            0% { transform: scale(0.5); opacity: 0; }
            50% { transform: scale(1.2); }
            100% { transform: scale(1); opacity: 1; }
        }
        
        /* Clases de estado */
        .notification-ios-show {
            animation: notificationSlideInDown 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;
        }
        
        .notification-ios-show .notification-ios-icon {
            animation: iconPop 0.4s 0.1s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }
        
        .notification-ios-hide {
            animation: notificationFadeDownOut 0.4s cubic-bezier(0.55, 0.085, 0.68, 0.53) forwards;
        }
        
        /* Responsive */
        @media (max-width: 480px) {
            #notification-ios-container {
                top: 15px;
            }
            .notification-ios { 
                padding: 14px 20px;
                border-radius: 30px;
            }
            .notification-ios-message {
                white-space: normal;
                font-size: 14px; 
                text-align: center;
            }
            .notification-ios-icon {
                width: 26px;
                height: 26px;
            }
        }
`;
    document.head.appendChild(styles);
}

// ============================================
// ANALYTICS Y TRACKING
// ============================================

function trackLoginEvent(event, data = {}) {
    console.log(`📊 Login Event: ${event}`, data);
    if (typeof gtag !== 'undefined') {
        gtag('event', event, {
            event_category: 'authentication',
            page_title: 'Login',
            ...data
        });
    }
}

// ============================================
// MANEJO DE ERRORES
// ============================================

window.addEventListener('error', function (e) {
    console.error('Error en login.js:', e.error);
    showNotificationIOS('Ocurrió un error inesperado. Por favor recarga la página.', 'error');
    trackLoginEvent('login_javascript_error', {
        message: e.error?.message || 'Unknown error'
    });
});

// ============================================
// KEYBOARD SHORTCUTS
// ============================================

document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.classList.contains('form-input')) {
        const form = e.target.closest('form');
        if (form) {
            e.preventDefault();
            form.querySelector('.auth-btn').click();
        }
    }
    if (e.key === 'Escape') {
        const loginForm = document.getElementById('loginForm');
        if (loginForm) {
            loginForm.reset();
            const errorElements = loginForm.querySelectorAll('.form-error.show');
            errorElements.forEach(error => error.classList.remove('show'));
            const inputs = loginForm.querySelectorAll('.form-input');
            inputs.forEach(input => input.classList.remove('error', 'success'));
        }
    }
});