/* ===========================================================
   Attomos — Entrada del equipo (/equipo/login)
   POST /api/equipo/login {usuario, password} → cookie httpOnly y la
   primera página de su rol (handlers.StaffLogin). Mismo diseño y ojo
   animado que el login del panel de Avante.
   =========================================================== */

// Si antes entró el dueño en esta compu, que no se asome su menú.
try { localStorage.removeItem('userData'); } catch (e) {}

const form = document.getElementById('staffLoginForm');

if (form) {
  const card = form.closest('.admin-login-card');
  const errorEl = document.getElementById('staffLoginError');
  const submitBtn = form.querySelector('.btn.solid');
  const showError = (msg) => {
    errorEl.textContent = msg;
    errorEl.classList.add('show');
    card.classList.remove('is-shake'); void card.offsetWidth; card.classList.add('is-shake');
  };
  ['staffUser', 'staffPassword'].forEach((id) => {
    document.getElementById(id).addEventListener('input', () => errorEl.classList.remove('show'));
  });
  // El usuario va en minúsculas y sin espacios.
  document.getElementById('staffUser').addEventListener('blur', function () {
    this.value = this.value.trim().toLowerCase();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const usuario = document.getElementById('staffUser').value.trim().toLowerCase();
    const password = document.getElementById('staffPassword').value;
    errorEl.textContent = '';
    errorEl.classList.remove('show');
    if (!usuario || !password) {
      showError(!usuario ? 'Escribe tu usuario.' : 'Escribe tu contraseña.');
      return;
    }
    submitBtn.disabled = true;
    submitBtn.classList.add('is-loading');
    try {
      const res = await fetch('/api/equipo/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario, password })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showError(data.error || 'Usuario o contraseña incorrectos.');
        submitBtn.disabled = false;
        submitBtn.classList.remove('is-loading');
        const pw = document.getElementById('staffPassword');
        pw.select();
        return;
      }
      card.classList.add('is-ok');
      setTimeout(() => { window.location.href = data.redirect || '/'; }, 320);
    } catch (err) {
      showError('No se pudo conectar con el servidor. Intenta de nuevo.');
      submitBtn.disabled = false;
      submitBtn.classList.remove('is-loading');
    }
  });
}

/* ---------- Mostrar / ocultar contraseña ----------
   El ojo parpadea al tocarlo; cuando la contraseña se ve, una línea lo
   tacha (se dibuja) y el texto aparece con un pequeño desenfoque. */
(function initPasswordToggle() {
  const toggle = document.getElementById('staffPasswordToggle');
  if (!toggle) return;
  const input = document.getElementById('staffPassword');
  toggle.addEventListener('click', function () {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    this.classList.toggle('is-shown', show);
    this.setAttribute('aria-pressed', show ? 'true' : 'false');
    this.setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña');
    this.classList.remove('is-blink'); void this.offsetWidth; this.classList.add('is-blink');
    input.classList.remove('is-reveal', 'is-hide'); void input.offsetWidth;
    input.classList.add(show ? 'is-reveal' : 'is-hide');
    // El cursor se queda al final para seguir escribiendo.
    input.focus({ preventScroll: true });
    const n = input.value.length;
    try { input.setSelectionRange(n, n); } catch (e) {}
  });
  // Al tocar el ojo no se pierde el foco del campo.
  toggle.addEventListener('mousedown', function (e) { e.preventDefault(); });
})();