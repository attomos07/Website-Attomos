// ============================================
// Recover Password Page — JavaScript (solo vista)
// Flujo: correo -> código de 4 dígitos -> nueva contraseña -> éxito
// Sin conexión a backend todavía — solo navegación entre estados.
// ============================================

// ── Estados (secciones) ──────────────────────
const formState      = document.getElementById('formState');
const codeState       = document.getElementById('codeState');
const passwordState   = document.getElementById('passwordState');
const successState    = document.getElementById('successState');

function showState(stateEl) {
    [formState, codeState, passwordState, successState].forEach(el => {
        el.classList.add('hidden-state');
        el.style.display = 'none';
    });
    stateEl.classList.remove('hidden-state');
    stateEl.style.display = 'block';
}

// Guarda el email a través del flujo (solo para mostrarlo en pantalla)
let recoveryEmail = '';
let resendTimerInterval = null;

// ============================================
// Estado 1: Formulario de correo
// ============================================
const form       = document.getElementById('recoverForm');
const errorMsg   = document.getElementById('errorMsg');
const errorText  = document.getElementById('errorText');
const emailInput = document.getElementById('emailInput');

form.addEventListener('submit', (e) => {
    e.preventDefault();

    const email = emailInput.value.trim();

    errorMsg.style.display = 'none';
    emailInput.classList.remove('error');

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        emailInput.classList.add('error');
        errorText.textContent = 'Por favor ingresa un correo electrónico válido.';
        errorMsg.style.display = 'flex';
        return;
    }

    recoveryEmail = email;
    document.getElementById('codeSentEmail').textContent = email;
    enterCodeState();
});

emailInput.addEventListener('input', () => {
    emailInput.classList.remove('error');
    errorMsg.style.display = 'none';
});

// ============================================
// Estado 2: Código de 4 dígitos
// ============================================
const codeForm        = document.getElementById('codeForm');
const codeInputs       = Array.from(document.querySelectorAll('.code-input'));
const codeErrorMsg     = document.getElementById('codeErrorMsg');
const codeErrorText    = document.getElementById('codeErrorText');
const resendLink       = document.getElementById('resendLink');
const resendTimerEl    = document.getElementById('resendTimer');
const backToEmailLink  = document.getElementById('backToEmailLink');

function enterCodeState() {
    showState(codeState);
    clearCodeInputs();
    codeInputs[0].focus();
    startResendTimer(60);
}

function clearCodeInputs() {
    codeInputs.forEach(inp => {
        inp.value = '';
        inp.classList.remove('filled', 'error');
    });
}

function getCodeValue() {
    return codeInputs.map(inp => inp.value).join('');
}

// Solo permite dígitos, auto-avanza al siguiente input
codeInputs.forEach((input, idx) => {
    input.addEventListener('input', (e) => {
        codeErrorMsg.style.display = 'none';
        codeInputs.forEach(i => i.classList.remove('error'));

        // Filtrar solo dígitos (soporta cuando el usuario escribe/pega más de 1 char)
        const digits = e.target.value.replace(/\D/g, '');

        if (digits.length > 1) {
            // El usuario pegó o escribió varios dígitos en una sola casilla
            distributeDigits(digits, idx);
            return;
        }

        e.target.value = digits;
        e.target.classList.toggle('filled', digits.length === 1);

        if (digits.length === 1 && idx < codeInputs.length - 1) {
            codeInputs[idx + 1].focus();
        }

        maybeAutoSubmit();
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !input.value && idx > 0) {
            codeInputs[idx - 1].focus();
            codeInputs[idx - 1].value = '';
            codeInputs[idx - 1].classList.remove('filled');
            e.preventDefault();
        } else if (e.key === 'ArrowLeft' && idx > 0) {
            codeInputs[idx - 1].focus();
            e.preventDefault();
        } else if (e.key === 'ArrowRight' && idx < codeInputs.length - 1) {
            codeInputs[idx + 1].focus();
            e.preventDefault();
        }
    });

    // Pegar el código completo en cualquier casilla
    input.addEventListener('paste', (e) => {
        e.preventDefault();
        const pasted = (e.clipboardData || window.clipboardData).getData('text');
        const digits = pasted.replace(/\D/g, '');
        if (!digits) return;
        distributeDigits(digits, idx);
    });

    // Seleccionar todo el texto al hacer foco, para que escribir/pegar reemplace
    input.addEventListener('focus', () => {
        input.select();
    });
});

// Distribuye una cadena de dígitos entre las casillas, comenzando en startIdx
// (o desde el inicio si vienen suficientes dígitos para llenar todo el código)
function distributeDigits(digits, startIdx) {
    const chars = digits.split('');

    // Si se pegan 4 o más dígitos, siempre llenamos desde la primera casilla
    const from = chars.length >= codeInputs.length ? 0 : startIdx;

    let charIndex = 0;
    for (let i = from; i < codeInputs.length && charIndex < chars.length; i++) {
        codeInputs[i].value = chars[charIndex];
        codeInputs[i].classList.add('filled');
        charIndex++;
    }

    // Enfocar la siguiente casilla vacía, o la última si todo quedó lleno
    const nextEmpty = codeInputs.findIndex(inp => !inp.value);
    if (nextEmpty === -1) {
        codeInputs[codeInputs.length - 1].focus();
    } else {
        codeInputs[nextEmpty].focus();
    }

    maybeAutoSubmit();
}

// Auto-envía en cuanto las 4 casillas están llenas
function maybeAutoSubmit() {
    if (getCodeValue().length === codeInputs.length) {
        codeForm.requestSubmit();
    }
}

codeForm.addEventListener('submit', (e) => {
    e.preventDefault();

    const code = getCodeValue();
    codeErrorMsg.style.display = 'none';
    codeInputs.forEach(i => i.classList.remove('error'));

    if (code.length !== codeInputs.length) {
        codeErrorText.textContent = 'Ingresa el código completo de 4 dígitos.';
        codeErrorMsg.style.display = 'flex';
        return;
    }

    // Vista solamente: pasa directo a la pantalla de nueva contraseña
    showState(passwordState);
    document.getElementById('newPasswordInput').focus();
});

// Reenviar código (solo vista: reinicia el temporizador)
resendLink.addEventListener('click', (e) => {
    e.preventDefault();
    if (resendLink.classList.contains('disabled')) return;

    clearCodeInputs();
    codeInputs[0].focus();
    startResendTimer(60);
});

function startResendTimer(seconds) {
    let remaining = seconds;
    resendLink.classList.add('disabled');
    resendTimerEl.textContent = `(${remaining}s)`;

    clearInterval(resendTimerInterval);
    resendTimerInterval = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
            clearInterval(resendTimerInterval);
            resendTimerEl.textContent = '';
            resendLink.classList.remove('disabled');
        } else {
            resendTimerEl.textContent = `(${remaining}s)`;
        }
    }, 1000);
}

// Volver a cambiar el correo
backToEmailLink.addEventListener('click', (e) => {
    e.preventDefault();
    clearInterval(resendTimerInterval);
    resendTimerEl.textContent = '';
    showState(formState);
    emailInput.focus();
});

// ============================================
// Estado 3: Nueva contraseña
// ============================================
const passwordForm         = document.getElementById('passwordForm');
const newPasswordInput     = document.getElementById('newPasswordInput');
const confirmPasswordInput = document.getElementById('confirmPasswordInput');
const passwordErrorMsg     = document.getElementById('passwordErrorMsg');
const passwordErrorText    = document.getElementById('passwordErrorText');

[newPasswordInput, confirmPasswordInput].forEach(inp => {
    inp.addEventListener('input', () => {
        inp.classList.remove('error');
        passwordErrorMsg.style.display = 'none';
    });
});

passwordForm.addEventListener('submit', (e) => {
    e.preventDefault();

    const password = newPasswordInput.value;
    const confirm  = confirmPasswordInput.value;

    passwordErrorMsg.style.display = 'none';
    newPasswordInput.classList.remove('error');
    confirmPasswordInput.classList.remove('error');

    if (password.length < 8) {
        newPasswordInput.classList.add('error');
        passwordErrorText.textContent = 'La contraseña debe tener al menos 8 caracteres.';
        passwordErrorMsg.style.display = 'flex';
        return;
    }

    if (password !== confirm) {
        confirmPasswordInput.classList.add('error');
        passwordErrorText.textContent = 'Las contraseñas no coinciden.';
        passwordErrorMsg.style.display = 'flex';
        return;
    }

    // Vista solamente: pasa directo a la pantalla de éxito
    showState(successState);
});