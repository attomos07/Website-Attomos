// ============================================
// Recover Password Page — JavaScript
// Flujo: correo -> código de 4 dígitos -> nueva contraseña -> éxito
// Conectado a:
//   POST /api/user/password-reset          {email}
//   POST /api/user/password-reset/verify   {email, code}   -> {resetToken}
//   POST /api/user/password-reset/confirm  {resetToken, newPassword}
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

// Se guardan a través del flujo
let recoveryEmail = '';
let resetToken    = '';
let resendTimerInterval = null;

// Helper genérico para poner un botón en estado "cargando"
function setBtnLoading(btn, iconEl, textEl, loadingText) {
    btn.disabled = true;
    iconEl.dataset.prevClass = iconEl.className;
    iconEl.className = 'lni lni-spinner-arrow';
    textEl.dataset.prevText = textEl.textContent;
    textEl.textContent = loadingText;
}
function clearBtnLoading(btn, iconEl, textEl) {
    btn.disabled = false;
    if (iconEl.dataset.prevClass) iconEl.className = iconEl.dataset.prevClass;
    if (textEl.dataset.prevText) textEl.textContent = textEl.dataset.prevText;
}

// ============================================
// Estado 1: Formulario de correo
// ============================================
const form       = document.getElementById('recoverForm');
const errorMsg   = document.getElementById('errorMsg');
const errorText  = document.getElementById('errorText');
const emailInput = document.getElementById('emailInput');
const submitBtn  = document.getElementById('submitBtn');
const btnIcon    = document.getElementById('btnIcon');
const btnText    = document.getElementById('btnText');

// Pide el código al backend. El backend siempre responde "éxito genérico"
// exista o no el correo (para no revelar si una cuenta existe).
async function requestResetCode(email) {
    const resp = await fetch('/api/user/password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
        throw new Error(data.error || 'No se pudo enviar el código. Inténtalo de nuevo.');
    }
    return data;
}

form.addEventListener('submit', async (e) => {
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

    setBtnLoading(submitBtn, btnIcon, btnText, 'Enviando...');

    try {
        await requestResetCode(email);
        recoveryEmail = email;
        document.getElementById('codeSentEmail').textContent = email;
        enterCodeState();
    } catch (err) {
        errorText.textContent = err.message;
        errorMsg.style.display = 'flex';
    } finally {
        clearBtnLoading(submitBtn, btnIcon, btnText);
    }
});

emailInput.addEventListener('input', () => {
    emailInput.classList.remove('error');
    errorMsg.style.display = 'none';
});

// ============================================
// Estado 2: Código de 4 dígitos
// ============================================
const codeForm         = document.getElementById('codeForm');
const codeInputs       = Array.from(document.querySelectorAll('.code-input'));
const codeErrorMsg     = document.getElementById('codeErrorMsg');
const codeErrorText    = document.getElementById('codeErrorText');
const codeSubmitBtn    = document.getElementById('codeSubmitBtn');
const codeBtnIcon      = document.getElementById('codeBtnIcon');
const codeBtnText      = document.getElementById('codeBtnText');
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

codeForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const code = getCodeValue();
    codeErrorMsg.style.display = 'none';
    codeInputs.forEach(i => i.classList.remove('error'));

    if (code.length !== codeInputs.length) {
        codeErrorText.textContent = 'Ingresa el código completo de 4 dígitos.';
        codeErrorMsg.style.display = 'flex';
        return;
    }

    setBtnLoading(codeSubmitBtn, codeBtnIcon, codeBtnText, 'Verificando...');

    try {
        const resp = await fetch('/api/user/password-reset/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: recoveryEmail, code })
        });
        const data = await resp.json().catch(() => ({}));

        if (!resp.ok) {
            throw new Error(data.error || 'Código incorrecto. Inténtalo de nuevo.');
        }

        resetToken = data.resetToken;
        clearInterval(resendTimerInterval);
        showState(passwordState);
        document.getElementById('newPasswordInput').focus();
    } catch (err) {
        codeInputs.forEach(i => i.classList.add('error'));
        codeErrorText.textContent = err.message;
        codeErrorMsg.style.display = 'flex';
    } finally {
        clearBtnLoading(codeSubmitBtn, codeBtnIcon, codeBtnText);
    }
});

// Reenviar código
resendLink.addEventListener('click', async (e) => {
    e.preventDefault();
    if (resendLink.classList.contains('disabled')) return;

    resendLink.classList.add('disabled');
    try {
        await requestResetCode(recoveryEmail);
        clearCodeInputs();
        codeErrorMsg.style.display = 'none';
        codeInputs[0].focus();
    } catch (err) {
        codeErrorText.textContent = err.message;
        codeErrorMsg.style.display = 'flex';
    } finally {
        startResendTimer(60);
    }
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
const passwordSubmitBtn    = document.getElementById('passwordSubmitBtn');
const passwordBtnIcon      = document.getElementById('passwordBtnIcon');
const passwordBtnText      = document.getElementById('passwordBtnText');

[newPasswordInput, confirmPasswordInput].forEach(inp => {
    inp.addEventListener('input', () => {
        inp.classList.remove('error');
        passwordErrorMsg.style.display = 'none';
    });
});

passwordForm.addEventListener('submit', async (e) => {
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

    setBtnLoading(passwordSubmitBtn, passwordBtnIcon, passwordBtnText, 'Actualizando...');

    try {
        const resp = await fetch('/api/user/password-reset/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ resetToken, newPassword: password })
        });
        const data = await resp.json().catch(() => ({}));

        if (!resp.ok) {
            throw new Error(data.error || 'Ocurrió un error al actualizar la contraseña.');
        }

        showState(successState);
    } catch (err) {
        passwordErrorText.textContent = err.message;
        passwordErrorMsg.style.display = 'flex';
    } finally {
        clearBtnLoading(passwordSubmitBtn, passwordBtnIcon, passwordBtnText);
    }
});