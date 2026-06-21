// ============================================
// Recover Password Page — JavaScript
// ============================================

const form       = document.getElementById('recoverForm');
const submitBtn  = document.getElementById('submitBtn');
const btnIcon    = document.getElementById('btnIcon');
const btnText    = document.getElementById('btnText');
const errorMsg   = document.getElementById('errorMsg');
const errorText  = document.getElementById('errorText');
const emailInput = document.getElementById('emailInput');

// ─── Submit ──────────────────────────────────
form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = emailInput.value.trim();

    // Reset estado
    errorMsg.style.display = 'none';
    emailInput.classList.remove('error');

    // Validar email
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        emailInput.classList.add('error');
        errorText.textContent = 'Por favor ingresa un correo electrónico válido.';
        errorMsg.style.display = 'flex';
        return;
    }

    // Loading state
    submitBtn.disabled    = true;
    btnIcon.className     = 'lni lni-spinner spinning';
    btnText.textContent   = 'Enviando...';

    try {
        const response = await fetch('/api/user/password-reset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ email })
        });

        const data = await response.json();

        if (response.ok) {
            document.getElementById('sentToEmail').textContent = email;
            document.getElementById('formState').style.display   = 'none';
            document.getElementById('successState').style.display = 'block';
        } else {
            errorText.textContent   = data.error || 'No pudimos enviar el correo. Inténtalo de nuevo.';
            errorMsg.style.display  = 'flex';
        }
    } catch (err) {
        console.error('Error:', err);
        errorText.textContent  = 'Error de conexión. Verifica tu internet e inténtalo de nuevo.';
        errorMsg.style.display = 'flex';
    } finally {
        submitBtn.disabled  = false;
        btnIcon.className   = 'lni lni-envelope';
        btnText.textContent = 'Enviar correo de recuperación';
    }
});

// ─── Limpiar error al escribir ───────────────
emailInput.addEventListener('input', () => {
    emailInput.classList.remove('error');
    errorMsg.style.display = 'none';
});