/* Attomos Foundation — login y registro */
(function () {
    'use strict';
    const { store, session, segmented, toast } = window.AF;

    const params = new URLSearchParams(location.search);
    const next = params.get('next');
    const safeNext = next && next.startsWith('/foundation') ? next : null;

    // Si ya hay sesión, no tiene caso mostrar el formulario
    session.get().then((u) => { if (u) location.replace(safeNext || '/foundation/panel'); });

    // Mostrar / ocultar contraseña
    document.querySelectorAll('[data-af-eye]').forEach((b) => b.addEventListener('click', () => {
        const input = b.parentElement.querySelector('input');
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        b.setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña');
        b.innerHTML = show
            ? '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 5.1A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>'
            : '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
        input.focus();
    }));

    function showError(box, msg, field) {
        box.textContent = msg;
        box.classList.remove('is-show'); void box.offsetWidth; box.classList.add('is-show');
        if (field) {
            field.classList.remove('is-invalid'); void field.offsetWidth; field.classList.add('is-invalid');
            field.focus();
        }
    }
    document.addEventListener('input', (e) => { if (e.target.classList.contains('is-invalid')) e.target.classList.remove('is-invalid'); });
    const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);

    function busy(btn, on) {
        btn.disabled = on;
        btn.style.opacity = on ? '0.7' : '';
    }

    // ------------------------------------------------------------------
    // Login
    // ------------------------------------------------------------------
    const loginForm = document.getElementById('afLoginForm');
    if (loginForm) {
        const err = document.getElementById('afLoginError');
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            err.classList.remove('is-show');
            const email = loginForm.email.value.trim();
            const pass = loginForm.password.value;
            if (!isEmail(email)) return showError(err, 'Escribe un correo válido', loginForm.email);
            if (!pass) return showError(err, 'Escribe tu contraseña', loginForm.password);
            const btn = loginForm.querySelector('[type=submit]');
            busy(btn, true);
            try {
                const user = await store.login(email, pass);
                toast(`¡Hola, ${user.name.split(' ')[0]}!`);
                setTimeout(() => location.assign(safeNext || '/foundation/panel'), 450);
            } catch (ex) {
                busy(btn, false);
                showError(err, ex.message, loginForm.password);
            }
        });
    }

    // ------------------------------------------------------------------
    // Registro
    // ------------------------------------------------------------------
    const regForm = document.getElementById('afRegisterForm');
    if (regForm) {
        const err = document.getElementById('afRegisterError');
        const seg = document.getElementById('afRoleSeg');
        const note = document.getElementById('afRoleNote');
        const nameLabel = document.getElementById('regNameLabel');
        const nameInput = document.getElementById('regName');
        const title = document.getElementById('afRegTitle');
        const lead = document.getElementById('afRegLead');
        let role = params.get('role') === 'rescuer' ? 'rescuer' : 'donor';

        const COPY = {
            donor: {
                note: 'Apoya a rescatistas con suscripciones, apadrinamientos o donaciones únicas.',
                label: 'Tu nombre', ph: 'Nombre y apellido',
                title: 'Ayuda a quienes rescatan todos los días.',
                lead: 'Como donador puedes suscribirte cada mes, apadrinar a un peludo o hacer una donación única.',
            },
            rescuer: {
                note: 'Crea tu perfil, tus planes mensuales y sube a los peludos que se pueden apadrinar.',
                label: 'Nombre de tu rescate', ph: 'Ej. Huellitas Hermosillo',
                title: 'Recibe apoyo mensual para tus rescates.',
                lead: 'Arma tus planes de suscripción, publica a tus peludos para apadrinar y recibe donaciones únicas.',
            },
        };
        function setRole(r, first) {
            role = r;
            seg.querySelectorAll('.af-seg-btn').forEach((b) => {
                const on = b.dataset.role === r;
                b.classList.toggle('is-active', on);
                b.setAttribute('aria-selected', String(on));
            });
            const c = COPY[r];
            const swap = () => {
                note.textContent = c.note;
                nameLabel.textContent = c.label;
                nameInput.placeholder = c.ph;
                title.textContent = c.title;
                lead.textContent = c.lead;
                [note, title, lead].forEach((el) => { el.style.opacity = ''; });
            };
            if (first) { swap(); return; }
            [note, title, lead].forEach((el) => { el.style.opacity = '0'; });
            setTimeout(swap, 160);
        }
        [note, title, lead].forEach((el) => { el.style.transition = 'opacity .2s ease'; });
        seg.addEventListener('click', (e) => {
            const b = e.target.closest('.af-seg-btn');
            if (b && b.dataset.role !== role) setRole(b.dataset.role);
        });
        setRole(role, true);
        segmented(seg);

        // Indicador de contraseña
        const meter = document.getElementById('afStrength');
        regForm.password.addEventListener('input', () => {
            const v = regForm.password.value;
            let s = 0;
            if (v.length >= 8) s++;
            if (/[A-Z]/.test(v) && /[a-z]/.test(v)) s++;
            if (/\d/.test(v)) s++;
            if (/[^A-Za-z0-9]/.test(v) || v.length >= 12) s++;
            if (!v) s = 0;
            meter.querySelectorAll('i').forEach((i, k) => i.classList.toggle('is-on', k < s));
            meter.classList.toggle('is-weak', s > 0 && s < 2);
        });

        regForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            err.classList.remove('is-show');
            const name = nameInput.value.trim();
            const email = regForm.email.value.trim();
            const pass = regForm.password.value;
            if (name.length < 2) return showError(err, role === 'rescuer' ? 'Escribe el nombre de tu rescate' : 'Escribe tu nombre', nameInput);
            if (!isEmail(email)) return showError(err, 'Escribe un correo válido', regForm.email);
            if (pass.length < 8) return showError(err, 'La contraseña debe tener al menos 8 caracteres', regForm.password);
            if (!document.getElementById('regTerms').checked) return showError(err, 'Acepta los términos para continuar');
            const btn = document.getElementById('afRegisterSubmit');
            busy(btn, true);
            try {
                await store.register({ name, email, password: pass, role });
                toast(role === 'rescuer' ? '¡Listo! Ahora completa tu perfil' : '¡Bienvenido a la manada!');
                const dest = safeNext || (role === 'rescuer' ? '/foundation/panel#perfil' : '/foundation/panel');
                setTimeout(() => location.assign(dest), 500);
            } catch (ex) {
                busy(btn, false);
                showError(err, ex.message, ex.status === 409 ? regForm.email : null);
            }
        });
    }
})();