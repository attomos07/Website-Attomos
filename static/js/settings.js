// ============================================
// Settings Page — JavaScript
// ============================================

// ─── Helpers ────────────────────────────────
function showMessage(element, duration = 5000) {
    element.style.display = 'flex';
    element.style.animation = 'slideInFromTop 0.5s ease-out';

    setTimeout(() => {
        element.style.animation = 'fadeOut 0.5s ease-out';
        setTimeout(() => {
            element.style.display = 'none';
        }, 500);
    }, duration);
}

// ─── Toggle Password Visibility ─────────────
function togglePassword(inputId, btn) {
    const field = document.getElementById(inputId);
    const icon  = document.getElementById(inputId + 'ToggleIcon');

    if (!field || !icon) return;

    const isPassword = field.type === 'password';
    field.type = isPassword ? 'text' : 'password';

    if (isPassword) {
        // Ojo CERRADO
        icon.setAttribute('viewBox', '0 0 25 24');
        icon.innerHTML = [
            '<path d="M3.5 9.5 Q12.0234 16.5 20.5 9.5"',
            ' stroke="#374151" stroke-width="2.2" stroke-linecap="round" fill="none"/>',
            '<line x1="4.8"  y1="10.8" x2="3.5"  y2="13.5" stroke="#9CA3AF" stroke-width="1.6" stroke-linecap="round"/>',
            '<line x1="8.0"  y1="13.0" x2="7.3"  y2="15.8" stroke="#9CA3AF" stroke-width="1.6" stroke-linecap="round"/>',
            '<line x1="12.0" y1="14.0" x2="12.0" y2="17.0" stroke="#9CA3AF" stroke-width="1.6" stroke-linecap="round"/>',
            '<line x1="16.0" y1="13.0" x2="16.7" y2="15.8" stroke="#9CA3AF" stroke-width="1.6" stroke-linecap="round"/>',
            '<line x1="19.2" y1="10.8" x2="20.5" y2="13.5" stroke="#9CA3AF" stroke-width="1.6" stroke-linecap="round"/>'
        ].join('');
    } else {
        // Ojo ABIERTO
        icon.setAttribute('viewBox', '0 0 25 24');
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

// ─── Password Form ───────────────────────────
document.getElementById('passwordForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword     = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const submitBtn       = e.target.querySelector('button[type="submit"]');
    const successMessage  = document.getElementById('passwordSuccess');
    const errorMessage    = document.getElementById('passwordError');
    const errorText       = document.getElementById('passwordErrorText');

    // Reset mensajes previos
    successMessage.style.display = 'none';
    errorMessage.style.display   = 'none';

    // Validar coincidencia
    if (newPassword !== confirmPassword) {
        errorText.textContent = 'Las contraseñas nuevas no coinciden';
        showMessage(errorMessage);
        return;
    }

    // Validar fortaleza
    const missing = [];
    if (newPassword.length < 8)             missing.push('mínimo 8 caracteres');
    if (!/[A-Z]/.test(newPassword))         missing.push('una mayúscula');
    if (!/[a-z]/.test(newPassword))         missing.push('una minúscula');
    if (!/\d/.test(newPassword))            missing.push('un número');
    if (!/[@$!%*?&#]/.test(newPassword))    missing.push('un símbolo (@$!%*?&#)');

    if (missing.length > 0) {
        errorText.textContent = 'Falta: ' + missing.join(', ');
        showMessage(errorMessage);
        return;
    }

    // Loading state
    submitBtn.classList.add('loading');
    submitBtn.innerHTML = '<i class="lni lni-spinner"></i><span>Actualizando...</span>';

    try {
        const response = await fetch('/api/user/password', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ currentPassword, newPassword })
        });

        const data = await response.json();

        if (response.ok) {
            showMessage(successMessage);
            e.target.reset();
        } else {
            errorText.textContent = data.error || 'Error al actualizar la contraseña';
            showMessage(errorMessage);
        }
    } catch (error) {
        console.error('Error updating password:', error);
        errorText.textContent = 'Ocurrió un error al actualizar la contraseña';
        showMessage(errorMessage);
    } finally {
        submitBtn.classList.remove('loading');
        submitBtn.innerHTML = '<i class="lni lni-checkmark-circle"></i><span>Actualizar Contraseña</span>';
    }
});

// ─── Delete Account Modal ────────────────────
function showDeleteModal() {
    document.getElementById('deleteModal').classList.add('active');
}

function closeDeleteModal() {
    document.getElementById('deleteModal').classList.remove('active');
    document.getElementById('confirmDelete').value = '';
}

async function confirmDelete() {
    const confirmInput = document.getElementById('confirmDelete').value;

    if (confirmInput !== 'ELIMINAR') {
        alert('Por favor escribe ELIMINAR para confirmar');
        return;
    }

    closeDeleteModal();
    showFinalConfirmation();
}

function showFinalConfirmation() {
    document.getElementById('finalConfirmationModal').classList.add('active');
}

function closeFinalConfirmation() {
    document.getElementById('finalConfirmationModal').classList.remove('active');
}

async function executeDelete() {
    closeFinalConfirmation();

    try {
        const response = await fetch('/api/user/account', {
            method: 'DELETE',
            credentials: 'include'
        });

        if (response.ok) {
            showDeleteSuccess();
            setTimeout(() => { window.location.href = '/login'; }, 2000);
        } else {
            const error = await response.json();
            alert(error.error || 'Error al eliminar la cuenta');
        }
    } catch (error) {
        console.error('Error deleting account:', error);
        alert('Ocurrió un error al eliminar la cuenta');
    }
}

function showDeleteSuccess() {
    document.getElementById('deleteSuccessModal').classList.add('active');
}

// ─── Escape key closes modals ────────────────
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeDeleteModal();
        closeFinalConfirmation();
    }
});