// ============================================
// REGISTER JAVASCRIPT - CON TAMAÑO DE NEGOCIO
// ============================================

document.addEventListener('DOMContentLoaded', function () {
    console.log('🚀 Register JS cargado correctamente');

    initRegisterValidation();
    initPasswordStrength();
    initRegisterForm();
    initSocialRegister();
    initAutoFormat();
    initCustomSelect();
    initBusinessSizeSelect();
    initPhoneNumberFormat();
    checkURLParams();

    console.log('✅ Register funcionalidades inicializadas');
});

// ============================================
// VERIFICAR ERRORES DE OAUTH EN URL
// ============================================

function checkURLParams() {
    const urlParams = new URLSearchParams(window.location.search);
    const error = urlParams.get('error');

    const errorMessages = {
        'invalid_state': 'Error de seguridad en la autenticación. Intenta de nuevo.',
        'no_code': 'No se recibió código de autorización de Google.',
        'token_exchange_failed': 'Error al obtener token de Google.',
        'user_info_failed': 'Error al obtener información del usuario.',
        'user_creation_failed': 'Error al crear tu cuenta.',
        'token_generation_failed': 'Error al generar sesión.'
    };

    if (error && errorMessages[error]) {
        showNotificationIOS(errorMessages[error], 'error');
        window.history.replaceState({}, document.title, window.location.pathname);
    }
}

// ============================================
// VALIDACIÓN ESPECÍFICA DEL REGISTRO
// ============================================

function initRegisterValidation() {
    const registerForm = document.getElementById('registerForm');
    if (!registerForm) return;

    const inputs = registerForm.querySelectorAll('.form-input');

    inputs.forEach(input => {
        input.addEventListener('blur', function () {
            validateRegisterField(this);
        });

        input.addEventListener('input', function () {
            clearFieldError(this);

            if (this.id === 'password') {
                updatePasswordStrength(this.value);
            }
        });
    });

    // Limpiar error visual del checkbox al marcarlo
    const termsCheckbox = document.getElementById('terms');
    if (termsCheckbox) {
        termsCheckbox.addEventListener('change', function () {
            const termsLabel = this.closest('.checkbox-container');
            if (termsLabel) termsLabel.classList.remove('checkbox-error');
        });
    }
}

function validateRegisterField(field) {
    const fieldName = field.name || field.id;
    const value = field.value.trim();
    let isValid = true;
    let errorMessage = '';

    clearFieldError(field);

    switch (fieldName) {
        case 'businessName':
            if (!value) {
                errorMessage = 'El nombre del negocio es requerido';
                isValid = false;
            } else if (value.length < 2) {
                errorMessage = 'Debe tener al menos 2 caracteres';
                isValid = false;
            }
            break;

        case 'phoneNumber':
            const phoneCodeField = document.getElementById('phoneCode');
            const phoneCodeValue = phoneCodeField ? phoneCodeField.value.trim() : '';

            if (!phoneCodeValue) {
                errorMessage = 'El código de país es requerido';
                isValid = false;
            } else if (!value) {
                errorMessage = 'El número de teléfono es requerido';
                isValid = false;
            } else if (!isValidPhoneNumber(phoneCodeValue, value)) {
                errorMessage = 'Ingresa un número válido (código: +XX, número: 7-15 dígitos)';
                isValid = false;
            }
            break;

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
            } else if (value.length < 8) {
                errorMessage = 'La contraseña debe tener al menos 8 caracteres';
                isValid = false;
            } else if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(value)) {
                errorMessage = 'Debe contener mayúsculas, minúsculas y números';
                isValid = false;
            }
            break;

        case 'businessType':
        case 'businessSize':
            // Los custom selects guardan la selección en data-value, no en .value
            const customValue = field.getAttribute('data-value') || value;
            if (!customValue) {
                errorMessage = fieldName === 'businessType' ? 'Selecciona el giro de tu negocio' : 'Selecciona el tamaño de tu negocio';
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

// ============================================
// FORMATEO DE NÚMERO DE TELÉFONO CON LADA SEPARADA
// ============================================

function initPhoneNumberFormat() {
    const phoneCodeInput = document.getElementById('phoneCode');
    const phoneNumberInput = document.getElementById('phoneNumber');

    if (!phoneCodeInput || !phoneNumberInput) return;

    phoneCodeInput.addEventListener('focus', function () {
        if (!this.value.startsWith('+')) {
            this.value = '+' + this.value.replace(/\+/g, '');
        }
    });

    phoneCodeInput.addEventListener('input', function (e) {
        let value = this.value;
        value = value.replace(/[^\d+]/g, '');

        if (value.startsWith('+')) {
            value = '+' + value.substring(1).replace(/\+/g, '');
        } else {
            value = '+' + value.replace(/\+/g, '');
        }

        if (value.length > 4) {
            value = value.substring(0, 4);
        }

        this.value = value;
    });

    phoneCodeInput.addEventListener('blur', function () {
        if (this.value === '' || this.value === '+') {
            this.value = '+52';
        }
    });

    phoneNumberInput.addEventListener('input', function (e) {
        let value = this.value.replace(/[^\d\s]/g, '');
        value = value.replace(/\s/g, '');

        if (value.length > 6) {
            value = value.substring(0, 3) + ' ' + value.substring(3, 6) + ' ' + value.substring(6, 10);
        } else if (value.length > 3) {
            value = value.substring(0, 3) + ' ' + value.substring(3);
        }

        this.value = value;
    });

    if (!phoneCodeInput.value) {
        phoneCodeInput.value = '+52';
    }

    console.log('📱 Formateo de número de teléfono con LADA separada inicializado');
}

function isValidPhoneNumber(phoneCode, phoneNumber) {
    const cleanCode = phoneCode.replace(/\s/g, '');
    const codeRegex = /^\+\d{1,3}$/;

    if (!codeRegex.test(cleanCode)) {
        return false;
    }

    const cleanNumber = phoneNumber.replace(/\s/g, '');
    const numberRegex = /^\d{7,15}$/;

    return numberRegex.test(cleanNumber);
}

// ============================================
// PASSWORD STRENGTH METER
// ============================================

function initPasswordStrength() {
    const passwordInput = document.getElementById('password');
    const strengthContainer = document.getElementById('passwordStrength');

    if (passwordInput) {
        passwordInput.addEventListener('input', function () {
            if (this.value) {
                strengthContainer.classList.add('show');
                updatePasswordStrength(this.value);
            } else {
                strengthContainer.classList.remove('show');
            }
        });

        passwordInput.addEventListener('focus', function () {
            if (this.value) {
                strengthContainer.classList.add('show');
            }
        });
    }
}

function updatePasswordStrength(password) {
    const strengthMeterFill = document.getElementById('strengthMeterFill');
    const strengthText = document.getElementById('strengthText');

    if (!password || !strengthMeterFill || !strengthText) {
        return;
    }

    let strength = 0;

    if (password.length >= 8) strength++;
    if (password.length >= 12) strength++;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) strength++;
    if (/\d/.test(password)) strength++;
    if (/[^a-zA-Z0-9]/.test(password)) strength++;

    strengthMeterFill.className = 'strength-meter-fill';
    strengthText.className = 'strength-text';

    if (strength <= 2) {
        strengthMeterFill.classList.add('weak');
        strengthText.classList.add('weak');
        strengthText.textContent = 'Débil';
    } else if (strength <= 3) {
        strengthMeterFill.classList.add('medium');
        strengthText.classList.add('medium');
        strengthText.textContent = 'Media';
    } else {
        strengthMeterFill.classList.add('strong');
        strengthText.classList.add('strong');
        strengthText.textContent = 'Fuerte';
    }
}

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
// MANEJO DEL FORMULARIO DE REGISTRO
// ============================================

function initRegisterForm() {
    const registerForm = document.getElementById('registerForm');
    if (!registerForm) return;

    registerForm.addEventListener('submit', handleRegisterSubmit);
}

async function handleRegisterSubmit(e) {
    e.preventDefault();
    console.log('🟡 [register] Submit disparado');

    const form = e.target;
    const formData = new FormData(form);

    let isValid = true;
    const requiredFields = ['businessName', 'phoneNumber', 'email', 'password', 'businessType', 'businessSize'];

    const phoneCodeField = form.querySelector('#phoneCode');
    if (phoneCodeField && !phoneCodeField.value.trim()) {
        showFieldError(phoneCodeField, 'Código de país requerido');
        isValid = false;
    }

    // Validar cada campo y recopilar cuáles fallaron
    const failedFields = [];
    requiredFields.forEach(fieldName => {
        const field = form.querySelector(`[name="${fieldName}"]`);
        if (field && !validateRegisterField(field)) {
            isValid = false;
            failedFields.push(fieldName + ' (value="' + field.value + '" data-value="' + (field.getAttribute('data-value')||'') + '")');
        }
    });

    if (failedFields.length > 0) {
        console.warn('❌ [register] Campos inválidos:', failedFields);
    }

    const termsCheckbox = document.getElementById('terms');
    if (!termsCheckbox.checked) {
        showNotificationIOS('Debes aceptar los términos y condiciones', 'error');
        // Marcar visualmente el checkbox como error
        const termsLabel = termsCheckbox.closest('.checkbox-container');
        if (termsLabel) termsLabel.classList.add('checkbox-error');
        isValid = false;
    } else {
        const termsLabel = termsCheckbox.closest('.checkbox-container');
        if (termsLabel) termsLabel.classList.remove('checkbox-error');
    }

    if (!isValid) {
        showNotificationIOS('Por favor corrige los errores en el formulario', 'error');
        // Buscar el primer error visible y hacer scroll hacia él
        const firstError = form.querySelector('.form-input.error') ||
                           form.querySelector('.checkbox-error') ||
                           form.querySelector('.form-error.show');
        if (firstError) {
            firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
            if (typeof firstError.focus === 'function') firstError.focus({ preventScroll: true });
        }
        return;
    }

    console.log('🟡 [register] Validación completada, isValid:', isValid);

    const businessTypeInput = document.getElementById('businessType');
    const businessTypeValue = businessTypeInput.getAttribute('data-value') || businessTypeInput.value;

    const businessSizeInput = document.getElementById('businessSize');
    const businessSizeValue = businessSizeInput.getAttribute('data-value') || businessSizeInput.value;

    const phoneCodeElement = document.getElementById('phoneCode');
    const phoneCodeValue = phoneCodeElement.value.trim();
    const phoneNumberValue = formData.get('phoneNumber').replace(/\s/g, '');
    const fullPhoneNumber = phoneCodeValue + phoneNumberValue;

    const data = {
        businessName: formData.get('businessName'),
        phoneNumber: fullPhoneNumber,
        email: formData.get('email'),
        password: formData.get('password'),
        businessType: businessTypeValue,
        businessSize: businessSizeValue
    };

    console.log('📤 Datos a enviar:', { ...data, password: '***' });
    console.log('🟡 [register] Llamando API /api/register...');

    const submitBtn = form.querySelector('.auth-btn') || document.getElementById('registerBtn');
    if (!submitBtn) { console.error('❌ [register] No se encontró el botón de submit'); return; }
    setButtonLoading(submitBtn, true);

    try {
        const response = await fetch('/api/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data),
            credentials: 'include'
        });

        const result = await response.json();
        console.log('🟡 [register] Respuesta API:', response.status, result);

        if (response.ok) {
            handleRegisterSuccess(result);
        } else {
            handleRegisterError(result.error || 'Error al crear la cuenta');
            setButtonLoading(submitBtn, false);
        }
    } catch (error) {
        console.error('Error en registro:', error);
        handleRegisterError('Error de conexión. Intenta de nuevo.');
        setButtonLoading(submitBtn, false);
    }
}

function handleRegisterSuccess(data) {
    console.log('✅ Registro exitoso:', data);

    showNotificationIOS('¡Cuenta creada exitosamente!', 'success');

    trackRegisterEvent('register_success', {
        method: 'email',
        business_type: data.user?.businessType || 'unknown',
        business_size: data.user?.businessSize || 'unknown'
    });

    const redirectUrl = data.redirect || '/dashboard';

    setTimeout(() => {
        window.location.href = redirectUrl;
    }, 1500);
}

function handleRegisterError(message) {
    showNotificationIOS(message, 'error');

    trackRegisterEvent('register_error', {
        method: 'email',
        error: message
    });

    if (message.toLowerCase().includes('email')) {
        const emailField = document.getElementById('email');
        if (emailField) {
            emailField.select();
            emailField.focus();
        }
    }
}

// ============================================
// REGISTRO SOCIAL - GOOGLE OAUTH
// ============================================

function initSocialRegister() {
    console.log('🔗 Social register inicializado');
}

function registerWithGoogle() {
    showNotificationIOS('Redirigiendo a Google...', 'info');
    trackRegisterEvent('social_register_attempt', { provider: 'google' });
    window.location.href = '/api/auth/google/login';
}

function registerWithApple() {
    showNotificationIOS('Redirigiendo a Apple...', 'info');
    trackRegisterEvent('social_register_attempt', { provider: 'apple' });
    setTimeout(() => {
        showNotificationIOS('Funcionalidad en desarrollo', 'warning');
    }, 1000);
}

// ============================================
// CUSTOM SELECT DROPDOWN - GIRO DE NEGOCIO
// ============================================

function initCustomSelect() {
    const selectWrapper = document.querySelector('.custom-select-wrapper');
    const selectInput = document.getElementById('businessType');
    const dropdown = document.getElementById('businessDropdown');
    const searchInput = document.getElementById('businessSearch');
    const optionsContainer = document.getElementById('selectOptionsContainer');
    const options = optionsContainer.querySelectorAll('.select-option');
    const noResults = document.getElementById('selectNoResults');

    if (!selectWrapper || !selectInput || !dropdown) {
        console.warn('⚠️ Custom select elements no encontrados');
        return;
    }

    selectInput.addEventListener('click', function (e) {
        e.stopPropagation();
        toggleDropdown();
    });

    if (searchInput) {
        searchInput.addEventListener('input', function () {
            filterOptions(this.value);
        });

        searchInput.addEventListener('click', function (e) {
            e.stopPropagation();
        });
    }

    options.forEach(option => {
        option.addEventListener('click', function (e) {
            e.stopPropagation();
            selectOption(this);
        });
    });

    document.addEventListener('click', function (e) {
        if (!selectWrapper.contains(e.target)) {
            closeDropdown();
        }
    });

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && selectWrapper.classList.contains('active')) {
            closeDropdown();
        }
    });

    function toggleDropdown() {
        const isActive = selectWrapper.classList.contains('active');
        if (isActive) {
            closeDropdown();
        } else {
            openDropdown();
        }
    }

    function openDropdown() {
        selectWrapper.classList.add('active');
        selectInput.classList.add('active');

        if (searchInput) {
            setTimeout(() => { searchInput.focus(); }, 100);
            searchInput.value = '';
        }
        filterOptions('');
        trackRegisterEvent('business_type_dropdown_opened');
    }

    function closeDropdown() {
        selectWrapper.classList.remove('active');
        selectInput.classList.remove('active');
        if (searchInput) { searchInput.value = ''; }
    }

    function filterOptions(searchTerm) {
        const term = searchTerm.toLowerCase().trim();
        let visibleCount = 0;

        options.forEach(option => {
            const text = option.querySelector('span').textContent.toLowerCase();
            const keywords = option.getAttribute('data-keywords') || '';
            const searchableText = text + ' ' + keywords.toLowerCase();

            if (searchableText.includes(term)) {
                option.classList.remove('hidden');
                visibleCount++;
            } else {
                option.classList.add('hidden');
            }
        });

        if (noResults) {
            if (visibleCount === 0 && term !== '') {
                noResults.style.display = 'block';
                optionsContainer.style.display = 'none';
            } else {
                noResults.style.display = 'none';
                optionsContainer.style.display = 'block';
            }
        }
    }

    function selectOption(option) {
        const value = option.getAttribute('data-value');
        const text = option.querySelector('span').textContent;

        selectInput.value = text;
        selectInput.setAttribute('data-value', value);

        options.forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');

        clearFieldError(selectInput);
        showFieldSuccess(selectInput);
        closeDropdown();

        trackRegisterEvent('business_type_selected', { business_type: value, business_name: text });
        console.log(`✅ Giro seleccionado: ${text} (${value})`);
    }

    console.log('🎯 Custom select con búsqueda inicializado');
}

// ============================================
// CUSTOM SELECT DROPDOWN - TAMAÑO DE NEGOCIO
// ============================================

function initBusinessSizeSelect() {
    const selectWrapper = document.querySelector('#businessSize').closest('.custom-select-wrapper');
    const selectInput = document.getElementById('businessSize');
    const dropdown = document.getElementById('businessSizeDropdown');
    const optionsContainer = document.getElementById('selectSizeOptionsContainer');
    const options = optionsContainer.querySelectorAll('.select-option');

    if (!selectWrapper || !selectInput || !dropdown) {
        console.warn('⚠️ Business size select elements no encontrados');
        return;
    }

    selectInput.addEventListener('click', function (e) {
        e.stopPropagation();
        toggleSizeDropdown();
    });

    options.forEach(option => {
        option.addEventListener('click', function (e) {
            e.stopPropagation();
            selectSizeOption(this);
        });
    });

    document.addEventListener('click', function (e) {
        if (!selectWrapper.contains(e.target)) {
            closeSizeDropdown();
        }
    });

    function toggleSizeDropdown() {
        const isActive = selectWrapper.classList.contains('active');
        if (isActive) { closeSizeDropdown(); } else { openSizeDropdown(); }
    }

    function openSizeDropdown() {
        selectWrapper.classList.add('active');
        selectInput.classList.add('active');
        trackRegisterEvent('business_size_dropdown_opened');
    }

    function closeSizeDropdown() {
        selectWrapper.classList.remove('active');
        selectInput.classList.remove('active');
    }

    function selectSizeOption(option) {
        const value = option.getAttribute('data-value');
        const text = option.querySelector('span').textContent;

        selectInput.value = text;
        selectInput.setAttribute('data-value', value);

        options.forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');

        clearFieldError(selectInput);
        showFieldSuccess(selectInput);
        closeSizeDropdown();

        trackRegisterEvent('business_size_selected', { business_size: value, business_size_name: text });
        console.log(`✅ Tamaño seleccionado: ${text} (${value})`);
    }

    console.log('🎯 Business size select inicializado');
}

// ============================================
// FORMATEO AUTOMÁTICO
// ============================================

function initAutoFormat() {
    const emailInput = document.getElementById('email');
    if (emailInput) {
        emailInput.addEventListener('input', function () {
            this.value = this.value.replace(/\s/g, '').toLowerCase();
        });
    }
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
        .notification-ios-success { background: rgba(16, 185, 129, 0.92); }
        .notification-ios-error { background: rgba(239, 68, 68, 0.92); }
        .notification-ios-warning { background: rgba(245, 158, 11, 0.92); }
        .notification-ios-info { background: rgba(6, 182, 212, 0.92); }
        .notification-ios-content { display: flex; align-items: center; justify-content: center; gap: 14px; }
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
        .notification-ios-icon svg { width: 100%; height: 100%; }
        .notification-ios-message { color: white; font-weight: 600; font-size: 16px; line-height: 1.4; white-space: nowrap; }
        @keyframes notificationSlideInDown {
            0% { opacity: 0; transform: translateY(-60px) scale(0.9); }
            60% { opacity: 1; transform: translateY(5px) scale(1.03); }
            100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes notificationFadeDownOut {
            0% { opacity: 1; transform: translateY(0) scale(1); }
            100% { opacity: 0; transform: translateY(30px) scale(0.95); }
        }
        @keyframes iconPop {
            0% { transform: scale(0.5); opacity: 0; }
            50% { transform: scale(1.2); }
            100% { transform: scale(1); opacity: 1; }
        }
        .notification-ios-show { animation: notificationSlideInDown 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards; }
        .notification-ios-show .notification-ios-icon { animation: iconPop 0.4s 0.1s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
        .notification-ios-hide { animation: notificationFadeDownOut 0.4s cubic-bezier(0.55, 0.085, 0.68, 0.53) forwards; }
        @media (max-width: 480px) {
            #notification-ios-container { top: 15px; }
            .notification-ios { padding: 14px 20px; border-radius: 30px; }
            .notification-ios-message { white-space: normal; font-size: 14px; text-align: center; }
            .notification-ios-icon { width: 26px; height: 26px; }
        }
`;
    document.head.appendChild(styles);
}

// ============================================
// ANALYTICS Y TRACKING
// ============================================

function trackRegisterEvent(event, data = {}) {
    console.log(`📊 Register Event: ${event}`, data);

    if (typeof gtag !== 'undefined') {
        gtag('event', event, {
            event_category: 'authentication',
            page_title: 'Register',
            ...data
        });
    }
}

// ============================================
// MANEJO DE ERRORES
// ============================================

window.addEventListener('error', function (e) {
    console.error('Error en register.js:', e.error);
    showNotificationIOS('Ocurrió un error inesperado. Por favor recarga la página.', 'error');
    trackRegisterEvent('register_javascript_error', {
        message: e.error?.message || 'Unknown error'
    });
});

// ============================================
// KEYBOARD SHORTCUTS
// ============================================

document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.classList.contains('form-input')) {
        const form = e.target.closest('form');
        if (form && e.target.id !== 'businessName') {
            e.preventDefault();
            form.querySelector('.auth-btn').click();
        }
    }

    if (e.key === 'Escape') {
        const registerForm = document.getElementById('registerForm');
        if (registerForm) {
            registerForm.reset();
            const errorElements = registerForm.querySelectorAll('.form-error.show');
            errorElements.forEach(error => error.classList.remove('show'));
            const inputs = registerForm.querySelectorAll('.form-input');
            inputs.forEach(input => input.classList.remove('error', 'success'));
            const strengthContainer = document.getElementById('passwordStrength');
            if (strengthContainer) {
                strengthContainer.classList.remove('show');
            }
        }
    }
});

// ============================================================================
// MENÚ iOS 27 — motor común para el selector de Asunto y el de lada
// ============================================================================
const IOSPick = (function () {
    const CHEV = '<svg class="ios-pick-chev" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2 4l4 4 4-4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    let current = null;

    function close(instant) {
        if (!current) return;
        const { menu, trigger } = current;
        current = null;
        trigger.classList.remove('is-open');
        trigger.setAttribute('aria-expanded', 'false');
        if (instant) { menu.remove(); return; }
        menu.classList.add('is-closing');
        setTimeout(() => menu.remove(), 180);
    }

    function open(trigger, items, onPick) {
        if (current && current.trigger === trigger) { close(); return; }
        close(true);
        const menu = document.createElement('div');
        menu.className = 'ios-pick-menu';
        menu.setAttribute('role', 'listbox');
        menu.innerHTML = '<div class="ios-pick-lens" aria-hidden="true"></div>' + items.map((it, i) =>
            `<button type="button" role="option" class="ios-pick-opt${it.selected ? ' is-selected' : ''}${it.placeholder ? ' is-placeholder' : ''}" data-i="${i}" style="--i:${i}" aria-selected="${!!it.selected}">${it.html}</button>`
        ).join('');
        document.body.appendChild(menu);

        const r = trigger.getBoundingClientRect();
        menu.style.minWidth = `${Math.max(220, r.width)}px`;
        const w = menu.offsetWidth, h = menu.offsetHeight;
        const left = Math.min(Math.max(12, r.left), window.innerWidth - w - 12);
        let top = r.bottom + 8, oy = '0%';
        if (top + h > window.innerHeight - 12 && r.top - h - 8 > 12) { top = r.top - h - 8; oy = '100%'; }
        menu.style.left = `${left}px`;
        menu.style.top = `${Math.max(12, top)}px`;
        menu.style.setProperty('--ox', `${Math.min(Math.max(r.left + 30 - left, 0), w)}px`);
        menu.style.setProperty('--oy', oy);

        const lens = menu.querySelector('.ios-pick-lens');
        const opts = [...menu.querySelectorAll('.ios-pick-opt')];
        let hi = Math.max(0, items.findIndex((it) => it.selected));
        function light(i, scroll) {
            hi = i;
            const o = opts[i];
            if (!o) return;
            lens.style.height = `${o.offsetHeight}px`;
            lens.style.transform = `translateY(${o.offsetTop}px)`;
            lens.style.opacity = '1';
            if (scroll) o.scrollIntoView({ block: 'nearest' });
        }
        lens.style.transition = 'none';
        light(hi, true);
        requestAnimationFrame(() => { lens.style.transition = ''; });

        menu.addEventListener('pointermove', (e) => {
            const o = e.target.closest('.ios-pick-opt');
            if (o) light(+o.dataset.i);
        });
        menu.addEventListener('click', (e) => {
            const o = e.target.closest('.ios-pick-opt');
            if (!o) return;
            o.classList.add('is-selected');
            if (navigator.vibrate) navigator.vibrate(6);
            onPick(+o.dataset.i);
            setTimeout(() => close(), 120);
        });

        trigger.classList.add('is-open');
        trigger.setAttribute('aria-expanded', 'true');
        current = { menu, trigger, opts, light: (d) => light(Math.min(opts.length - 1, Math.max(0, hi + d)), true), pick: () => opts[hi] && opts[hi].click() };
    }

    document.addEventListener('pointerdown', (e) => {
        if (current && !current.menu.contains(e.target) && !current.trigger.contains(e.target)) close();
    }, true);
    document.addEventListener('keydown', (e) => {
        if (!current) return;
        if (e.key === 'Escape') { e.preventDefault(); const t = current.trigger; close(); t.focus(); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); current.light(1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); current.light(-1); }
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); current.pick(); }
        else if (e.key === 'Tab') close();
    }, true);
    window.addEventListener('resize', () => close(true));
    document.addEventListener('scroll', (e) => { if (current && !current.menu.contains(e.target)) close(true); }, true);

    function bump(el, cls) {
        el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
    }

    // Convierte un <select> en el menú iOS sin quitarlo del formulario
    function select(sel, opts = {}) {
        if (!sel || sel.dataset.iosPick) return;
        sel.dataset.iosPick = '1';
        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'ios-pick-trigger';
        trigger.setAttribute('aria-haspopup', 'listbox');
        trigger.setAttribute('aria-expanded', 'false');
        if (sel.id) {
            const lbl = document.querySelector(`label[for="${sel.id}"]`);
            if (lbl) { lbl.addEventListener('click', (e) => { e.preventDefault(); trigger.focus(); }); trigger.setAttribute('aria-label', lbl.textContent.trim()); }
        }
        trigger.innerHTML = `<span class="ios-pick-label"></span>${CHEV}`;
        sel.classList.add('ios-pick-native');
        sel.tabIndex = -1;
        sel.setAttribute('aria-hidden', 'true');
        sel.after(trigger);
        const label = trigger.querySelector('.ios-pick-label');

        function sync(animate) {
            const o = sel.options[sel.selectedIndex];
            const text = o ? o.textContent.trim() : '';
            if (animate && label.textContent !== text) bump(label, 'swap');
            label.textContent = text;
            trigger.classList.toggle('is-placeholder', !sel.value);
        }
        trigger.addEventListener('click', () => {
            const items = [...sel.options].map((o) => ({ html: `<span>${o.textContent.trim()}</span>`, selected: o.selected && !!o.value, placeholder: !o.value }));
            open(trigger, items, (i) => {
                sel.selectedIndex = i;
                sel.dispatchEvent(new Event('input', { bubbles: true }));
                sel.dispatchEvent(new Event('change', { bubbles: true }));
                trigger.classList.remove('error');
                trigger.parentNode.querySelector('.field-error.ios-pick-error')?.remove();
                sync(true);
            });
        });
        trigger.addEventListener('keydown', (e) => {
            if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !trigger.classList.contains('is-open')) { e.preventDefault(); trigger.click(); }
        });
        // Si el campo es obligatorio y está vacío, el aviso sale en el botón visible
        sel.addEventListener('invalid', (e) => {
            e.preventDefault();
            bump(trigger, 'error');
            if (opts.errorText && !trigger.parentNode.querySelector('.ios-pick-error')) {
                const err = document.createElement('div');
                err.className = 'field-error ios-pick-error';
                err.textContent = opts.errorText;
                trigger.after(err);
            }
            trigger.focus();
        });
        sel.addEventListener('change', () => sync(false));
        // Las traducciones cambian el texto de las opciones
        new MutationObserver(() => sync(false)).observe(sel, { subtree: true, childList: true, characterData: true });
        sel.form?.addEventListener('reset', () => setTimeout(() => sync(false)));
        sync(false);
        return trigger;
    }

    return { open, close, select, bump, CHEV };
})();

// ============================================================================
// LADA — selector de código de país con las banderas del userbar
// ============================================================================
const IOSLada = (function () {
    const F = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 14" width="22" height="15">${body}</svg>`;
    const COUNTRIES = [
        { iso: 'MX', name: 'México', code: '+52', flag: F('<rect width="20" height="14" fill="#fff"/><rect width="6.67" height="14" fill="#006847"/><rect x="13.33" width="6.67" height="14" fill="#CE1126"/><circle cx="10" cy="7" r="1.8" fill="#8B4513" opacity="0.6"/>') },
        { iso: 'GB', name: 'Reino Unido', code: '+44', flag: F('<rect width="20" height="14" fill="#012169"/><path d="M0,0 L20,14 M20,0 L0,14" stroke="#fff" stroke-width="2.8"/><path d="M0,0 L20,14 M20,0 L0,14" stroke="#C8102E" stroke-width="1.6"/><path d="M10,0 V14 M0,7 H20" stroke="#fff" stroke-width="4"/><path d="M10,0 V14 M0,7 H20" stroke="#C8102E" stroke-width="2.4"/>') },
        { iso: 'RU', name: 'Rusia', code: '+7', flag: F('<rect width="20" height="14" fill="#fff"/><rect y="4.67" width="20" height="4.66" fill="#0035A9"/><rect y="9.33" width="20" height="4.67" fill="#D52B1E"/>') },
        { iso: 'UZ', name: 'Uzbekistán', code: '+998', flag: F('<rect width="20" height="14" fill="#1EB53A"/><rect width="20" height="4.67" fill="#009FCA"/><rect y="9.33" width="20" height="4.67" fill="#009FCA"/><rect y="4.67" width="20" height="4.66" fill="#fff"/>') },
        { iso: 'JP', name: 'Japón', code: '+81', flag: F('<rect width="20" height="14" fill="#fff"/><circle cx="10" cy="7" r="4" fill="#BC002D"/>') },
        { iso: 'CN', name: 'China', code: '+86', flag: F('<rect width="20" height="14" fill="#DE2910"/><polygon points="3,1 3.6,2.9 5.6,2.9 4,4 4.6,5.9 3,4.8 1.4,5.9 2,4 0.4,2.9 2.4,2.9" transform="translate(0.5,0.5) scale(0.95)" fill="#FFDE00"/>') },
        { iso: 'FR', name: 'Francia', code: '+33', flag: F('<rect width="20" height="14" fill="#ED2939"/><rect width="13.33" height="14" fill="#fff"/><rect width="6.67" height="14" fill="#002395"/>') },
        { iso: 'BR', name: 'Brasil', code: '+55', flag: F('<rect width="20" height="14" fill="#009C3B"/><polygon points="10,2 19,7 10,12 1,7" fill="#FEDD00"/><circle cx="10" cy="7" r="3" fill="#003087"/><path d="M7,7.8 Q10,6 13,7.8" stroke="#fff" stroke-width="0.9" fill="none"/>') },
        { iso: 'DE', name: 'Alemania', code: '+49', flag: F('<rect width="20" height="14" fill="#FFCE00"/><rect width="20" height="9.33" fill="#DD0000"/><rect width="20" height="4.67" fill="#000"/>') },
        { iso: 'KR', name: 'Corea del Sur', code: '+82', flag: F('<rect width="20" height="14" fill="#fff"/><circle cx="10" cy="7" r="3.5" fill="#C60C30"/><path d="M10,3.5 A3.5,3.5 0 0,1 10,10.5" fill="#003478"/>') },
    ];

    // input: el campo que guarda el código (+52); mount: dónde va el botón
    function attach(input, mount) {
        if (!input || input.dataset.iosLada) return;
        input.dataset.iosLada = '1';
        if (!input.value) input.value = '+52';
        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'ios-pick-trigger ios-lada-trigger';
        trigger.setAttribute('aria-haspopup', 'listbox');
        trigger.setAttribute('aria-label', 'Código de país');
        trigger.innerHTML = `<span class="ios-flag"></span><span class="ios-pick-label"></span>${IOSPick.CHEV}`;
        if (input.type !== 'hidden') { input.classList.add('ios-pick-native'); input.tabIndex = -1; input.setAttribute('aria-hidden', 'true'); }
        mount.appendChild(trigger);
        const flag = trigger.querySelector('.ios-flag');
        const label = trigger.querySelector('.ios-pick-label');

        const find = () => COUNTRIES.find((c) => c.code === input.value.replace(/\s/g, '')) || null;
        function sync(animate) {
            const c = find();
            flag.innerHTML = c ? c.flag : '';
            flag.style.display = c ? '' : 'none';
            if (animate) { IOSPick.bump(flag, 'flip'); IOSPick.bump(label, 'swap'); }
            label.textContent = input.value || '+52';
        }
        trigger.addEventListener('click', () => {
            const cur = find();
            IOSPick.open(trigger, COUNTRIES.map((c) => ({
                html: `<span class="ios-flag">${c.flag}</span><span>${c.name}</span><span class="ios-pick-code">${c.code}</span>`,
                selected: c === cur,
            })), (i) => {
                input.value = COUNTRIES[i].code;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                input.dispatchEvent(new Event('blur'));
                sync(true);
            });
        });
        trigger.addEventListener('keydown', (e) => {
            if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !trigger.classList.contains('is-open')) { e.preventDefault(); trigger.click(); }
        });
        input.addEventListener('change', () => sync(false));
        input.form?.addEventListener('reset', () => setTimeout(() => { input.value = '+52'; sync(false); }));
        sync(false);
        return trigger;
    }

    return { attach, COUNTRIES };
})();

// Lada con banderas (mismas del selector de idioma del userbar)
document.addEventListener('DOMContentLoaded', function () {
    const code = document.getElementById('phoneCode');
    const box = code && code.closest('.phone-code-container');
    if (box) { box.classList.add('has-lada'); IOSLada.attach(code, box); }
});