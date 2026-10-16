/* Attomos Foundation — panel (rescatista y donador), conectado a /api/foundation */
(async function () {
    'use strict';
    const { store, session, toast, segmented, iosSelect, initSidebar, readImage, esc, money, slugify, ui, fmtDate } = window.AF;
    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => [...r.querySelectorAll(s)];
    const clone = (o) => JSON.parse(JSON.stringify(o));
    const app = $('#afApp');

    const user = await session.get();
    if (!user) { location.replace('/foundation/login?next=' + encodeURIComponent('/foundation/panel' + location.hash)); return; }
    const role = user.role === 'rescuer' ? 'rescuer' : 'donor';
    const first = () => user.name.split(' ')[0];

    // Solo las vistas y bloques del rol de la sesión
    $$('.af-view[data-for]').forEach((v) => { if (v.dataset.for !== role) v.remove(); });
    $$('[data-only]').forEach((v) => { if (v.dataset.only !== role) v.remove(); });
    $$('[data-hello]').forEach((h) => { h.textContent = `Hola, ${first()}`; });
    if (role === 'rescuer') {
        $('[data-cuenta-title]').textContent = 'Cobros y cuenta';
        $('[data-cuenta-sub]').textContent = 'Conecta Stripe para recibir aportes y Google Drive para tus fotos.';
    }

    const VIEWS = role === 'rescuer' ? ['resumen', 'perfil', 'planes', 'unica', 'cuenta'] : ['resumen', 'aportes', 'explorar', 'cuenta'];
    let current = null;
    let dirty = false;
    const RENDER = {};

    async function logout() {
        if (dirty && !confirm('Tienes cambios sin guardar. ¿Salir de todos modos?')) return;
        dirty = false;
        session.logout('/foundation/login');
    }
    const nav = initSidebar({ role, user, onNavigate: (v) => (v === '__logout' ? logout() : show(v)) });

    function show(view) {
        if (!VIEWS.includes(view)) view = 'resumen';
        if (view === current) return;
        current = view;
        $$('.af-view').forEach((v) => v.classList.toggle('is-active', v.dataset.view === view));
        nav && nav.setActive(view);
        history.replaceState(null, '', location.pathname + location.search + '#' + view);
        window.scrollTo({ top: 0 });
        RENDER[view] && RENDER[view]();
        requestAnimationFrame(() => $$('.af-view.is-active .af-seg-host').forEach((s) => s._afSeg && s._afSeg.place(true)));
    }
    document.addEventListener('click', (e) => {
        const go = e.target.closest('[data-go]');
        if (go) { e.preventDefault(); show(go.dataset.go); }
    });
    window.addEventListener('hashchange', () => show(location.hash.slice(1)));
    $$('#afApp [data-af-logout]').forEach((b) => b.addEventListener('click', logout));

    function busy(btn, on) {
        if (!btn) return;
        btn.classList.toggle('is-busy', on);
        btn.disabled = on;
    }
    function invalid(el, msg) {
        if (el) { el.classList.remove('is-invalid'); void el.offsetWidth; el.classList.add('is-invalid'); el.focus(); }
        if (msg) toast(msg, 'error');
    }
    document.addEventListener('input', (e) => { if (e.target.classList && e.target.classList.contains('is-invalid')) e.target.classList.remove('is-invalid'); });

    // ------------------------------------------------------------------
    // Hojas (modales)
    // ------------------------------------------------------------------
    let openSheetEl = null, lastFocus = null;
    function openSheet(el) {
        lastFocus = document.activeElement;
        openSheetEl = el;
        el.classList.add('is-open');
        el.setAttribute('aria-hidden', 'false');
        document.body.classList.add('af-lock');
        setTimeout(() => { const f = el.querySelector('input:not([type=file]):not([type=checkbox]), textarea'); f && f.focus({ preventScroll: true }); }, 250);
    }
    function closeSheet(el = openSheetEl) {
        if (!el) return;
        el.classList.remove('is-open');
        el.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('af-lock');
        openSheetEl = null;
        lastFocus && lastFocus.focus && lastFocus.focus({ preventScroll: true });
    }
    $$('.af-sheet').forEach((s) => s.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheet(s); }));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openSheetEl && !document.querySelector('.af-menu.is-open')) closeSheet(); });

    function confirmSheet(title, text, okLabel = 'Eliminar') {
        return new Promise((resolve) => {
            const s = $('#confirmSheet');
            $('[data-title]', s).textContent = title;
            $('[data-text]', s).textContent = text;
            const ok = $('[data-ok]', s);
            ok.textContent = okLabel;
            const done = (v) => { ok.removeEventListener('click', yes); s.removeEventListener('click', no); resolve(v); };
            const yes = () => { closeSheet(s); done(true); };
            const no = (e) => { if (e.target.closest('[data-close]')) done(false); };
            ok.addEventListener('click', yes);
            s.addEventListener('click', no);
            openSheet(s);
        });
    }

    // ------------------------------------------------------------------
    // Cuenta (ambos roles)
    // ------------------------------------------------------------------
    function renderAccount() {
        $('#aName').value = user.name;
        $('#aEmail').value = user.email;
        $('#aRole').textContent = role === 'rescuer' ? 'Rescatista' : 'Donador';
    }
    $('#aSave').addEventListener('click', async (e) => {
        const n = $('#aName').value.trim();
        if (n.length < 2) { invalid($('#aName'), 'Escribe tu nombre'); return; }
        busy(e.currentTarget, true);
        try {
            const u = await store.updateMe(n);
            user.name = u.name;
            $$('.af-side-name').forEach((x) => { x.textContent = u.name; });
            $$('.af-side-avatar').forEach((x) => { x.textContent = AF.initials(u.name); });
            toast('Datos guardados');
        } catch (ex) { toast(ex.message, 'error'); }
        busy(e.currentTarget, false);
    });
    RENDER.cuenta = renderAccount;

    function ready() { app.classList.add('is-ready'); }
    function fatal(msg) {
        $('#afLoading').innerHTML = `<div class="af-empty"><span class="af-ic is-coral"><svg viewBox="0 0 24 24"><path d="M12 8v5M12 16.5v.5"/><circle cx="12" cy="12" r="9"/></svg></span><strong>No pudimos cargar tu panel</strong><span>${esc(msg)}</span><button type="button" class="af-btn af-btn-primary af-btn-sm" onclick="location.reload()">Reintentar</button></div>`;
    }

    // ==================================================================
    // RESCATISTA
    // ==================================================================
    if (role === 'rescuer') {
        let saved;
        try { saved = await store.myRescuer(); } catch (ex) { fatal(ex.message); return; }
        let draft = clone(saved);
        let pledgeData = null;
        const saveBar = $('#afSaveBar');

        const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
        const setPath = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); ks.reduce((a, k) => (a[k] = a[k] || {}), o)[last] = v; };
        const curOf = (r) => (r.country === 'Venezuela' ? 'USD' : 'MXN');

        const EDITABLE = ['name', 'slug', 'city', 'country', 'bio', 'avatarFileId', 'socials', 'allowCustomMonthly', 'minCustomMonthly', 'oneTime', 'published'];
        const pick = (r) => JSON.stringify(EDITABLE.map((k) => r[k]));
        function markDirty() {
            dirty = pick(draft) !== pick(saved);
            saveBar.classList.toggle('is-show', dirty);
        }
        window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

        function payload(r) {
            return {
                name: (r.name || '').trim(), slug: r.slug, city: r.city, country: r.country, bio: r.bio,
                avatarFileId: r.avatarFileId || '',
                instagram: r.socials.instagram || '', facebook: r.socials.facebook || '', tiktok: r.socials.tiktok || '', whatsapp: r.socials.whatsapp || '',
                allowCustomMonthly: !!r.allowCustomMonthly, minCustomMonthly: Number(r.minCustomMonthly) || 0,
                oneTimeEnabled: !!r.oneTime.enabled, oneTimeSuggested: r.oneTime.suggested.map(Number),
                oneTimeAllowCustom: !!r.oneTime.allowCustom, oneTimeMin: Number(r.oneTime.min) || 0,
                published: !!r.published,
            };
        }

        /** Aplica la respuesta del backend: los planes se guardan al momento,
         *  el resto queda como estaba en el borrador. */
        function adoptLists(r) {
            saved.plans = r.plans;
            draft.plans = clone(r.plans);
            saved.payments = r.payments; draft.payments = r.payments;
            markDirty();
            renderPreview();
        }

        // --- moneda ---
        function renderCurrency() {
            const cur = curOf(draft);
            $$('[data-cur]').forEach((x) => { x.textContent = cur; });
            $$('[data-cur-month]').forEach((x) => { x.textContent = cur + '/mes'; });
        }

        // --- enlazar campos ---
        $$('[data-bind]').forEach((el) => {
            if (el.tagName === 'SELECT') iosSelect(el);
            const ev = el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input';
            el.addEventListener(ev, () => {
                let v = el.type === 'checkbox' ? el.checked : el.value;
                if (el.hasAttribute('data-num')) v = v === '' ? '' : Math.max(0, Number(v));
                if (el.dataset.bind === 'slug') {
                    const clean = v.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-{2,}/g, '-').slice(0, 48);
                    if (clean !== v) { const p = el.selectionStart; el.value = clean; try { el.setSelectionRange(p, p); } catch (_) { /* */ } }
                    v = clean;
                }
                setPath(draft, el.dataset.bind, v);
                afterChange(el.dataset.bind);
            });
        });
        $('#pSlug').addEventListener('blur', (e) => {
            const v = slugify(e.target.value || draft.name);
            e.target.value = v; draft.slug = v; afterChange('slug');
        });

        function afterChange(key) {
            if (key === 'bio') $('#pBioCount').textContent = (draft.bio || '').length;
            if (key === 'allowCustomMonthly') toggleRow($('#mMinRow'), draft.allowCustomMonthly);
            if (key === 'oneTime.enabled') toggleRow($('#oBody'), draft.oneTime.enabled);
            if (key === 'country') {
                draft.currency = curOf(draft);
                renderCurrency();
                if (draft.country === 'Venezuela') toast('Pagos con PayPal para Venezuela: muy pronto', 'info');
            }
            if (key === 'published' && draft.published) toast('Recuerda guardar para publicar tu página', 'info');
            markDirty();
            renderPreview();
        }
        function toggleRow(el, on) {
            el.style.transition = 'opacity .3s ease';
            el.style.opacity = on ? '' : '0.4';
            el.style.pointerEvents = on ? '' : 'none';
            $$('input, button', el).forEach((x) => { x.disabled = !on; });
        }

        function fillForm() {
            $$('[data-bind]').forEach((el) => {
                const v = getPath(draft, el.dataset.bind);
                if (el.type === 'checkbox') el.checked = !!v;
                else el.value = v ?? '';
            });
            $('#pBioCount').textContent = (draft.bio || '').length;
            toggleRow($('#mMinRow'), draft.allowCustomMonthly);
            toggleRow($('#oBody'), draft.oneTime.enabled);
            renderCurrency();
            renderImages();
            renderChips();
            renderPreview();
        }

        const FIELD = {
            name: ['perfil', '#pName'], slug: ['perfil', '#pSlug'], country: ['perfil', '#pCountryBtn'], bio: ['perfil', '#pBio'],
            socials: ['perfil', '#sIg'], photo: ['perfil', null], minCustomMonthly: ['planes', '#mMin'],
            oneTimeMin: ['unica', '#oMin'], oneTimeSuggested: ['unica', '#oNew'],
        };
        $('#afSave').addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            busy(btn, true);
            try {
                const wasPublished = saved.published;
                const r = await store.saveRescuer(payload(draft));
                saved = r;
                draft = clone(r);
                fillForm();
                markDirty();
                toast(!wasPublished && saved.published
                    ? (saved.payments.ready ? '¡Tu página ya está publicada!' : 'Página publicada. Activa tus cobros para recibir aportes.')
                    : 'Cambios guardados');
                RENDER[current] && RENDER[current]();
            } catch (ex) {
                const f = FIELD[ex.field];
                if (f) { show(f[0]); invalid(f[1] && $(f[1]), ex.message); } else toast(ex.message, 'error');
            }
            busy(btn, false);
        });
        $('#afDiscard').addEventListener('click', () => {
            draft = clone(saved);
            fillForm();
            markDirty();
            RENDER[current] && RENDER[current]();
            toast('Cambios descartados', 'info');
        });

        // --- foto de perfil (va al Google Drive de la rescatista) ---
        function needDrive(ex) {
            if (ex && ex.code === 'drive_required') {
                toast(ex.message, 'info');
                show('cuenta');
                const c = $('#driveCard');
                c && c.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.02)' }, { transform: 'scale(1)' }], { duration: 500, easing: 'ease-out' });
                return true;
            }
            return false;
        }
        $('[data-pick="avatar"]').addEventListener('click', () => {
            if (!saved.drive.connected) { needDrive({ code: 'drive_required', message: 'Conecta tu Google Drive para subir tu foto' }); return; }
            $('#pFile').click();
        });
        $('#pFile').addEventListener('change', async (e) => {
            const f = e.target.files[0];
            e.target.value = '';
            if (!f) return;
            const holder = $('#pAvatar');
            const btn = $('[data-pick="avatar"]');
            holder.classList.add('is-busy'); busy(btn, true);
            try {
                const res = await store.upload(await readImage(f, 600));
                draft.avatarFileId = res.fileId;
                draft.avatar = res.url;
                renderImages();
                afterChange('avatar');
                toast('Foto subida a tu Drive. Guarda para publicarla.');
            } catch (ex) { if (!needDrive(ex)) toast(ex.message, 'error'); }
            holder.classList.remove('is-busy'); busy(btn, false);
        });
        function renderImages() {
            $('#pAvatar').innerHTML = draft.avatar ? `<img src="${esc(draft.avatar)}" alt="">` : esc(AF.initials(draft.name));
        }
        $('#pName').addEventListener('input', () => { if (!draft.avatar) renderImages(); });

        // --- aviso de Drive ---
        function renderDriveIssue() {
            const box = $('#afDriveIssue');
            const issue = saved.drive && saved.drive.issue;
            box.hidden = !issue;
            if (issue) $('[data-text]', box).textContent = issue;
        }

        // --- vista previa ---
        function renderPreview() {
            const r = draft;
            const cur = curOf(r);
            const plans = (r.plans || []).slice(0, 3).map((p) => `<span class="af-preview-pill"><span>${esc(p.name)}</span><span>${money(p.amount, cur)}</span></span>`).join('');
            const html = `
                <div class="af-preview-frame">
                    <div class="af-preview-body">
                        ${ui.avatarHtml(r)}
                        <h4>${esc(r.name || 'Tu rescate')}</h4>
                        <p>${esc(r.city || 'Tu ciudad')}${r.country ? ' · ' + esc(r.country) : ''}</p>
                        <div class="af-preview-list">
                            ${plans || '<span class="af-preview-pill" style="opacity:.6"><span>Aún no hay planes</span></span>'}
                            ${r.allowCustomMonthly ? `<span class="af-preview-pill"><span>Monto libre</span><span>desde ${money(r.minCustomMonthly || 0, cur)}</span></span>` : ''}
                            ${r.oneTime.enabled ? `<span class="af-preview-pill is-coral"><span>Donación única</span><span>✓</span></span>` : ''}
                        </div>
                        <div class="af-preview-url"><span>/foundation/r/${esc(r.slug)}</span>
                            ${saved.published ? `<a class="af-icon-btn" style="width:30px;height:30px" href="/foundation/r/${encodeURIComponent(saved.slug)}" target="_blank" rel="noopener" aria-label="Abrir página"><svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9"/></svg></a>` : '<span class="af-badge is-gray" style="flex:none">Sin publicar</span>'}
                        </div>
                    </div>
                </div>`;
            $$('[data-preview]').forEach((p) => { p.innerHTML = `<p class="af-label" style="margin:0 0 10px 6px">Vista previa</p>${html}`; });
        }

        // --- resumen ---
        const stat = (i, ic, coral, val, label) => `<div class="af-stat" style="--i:${i}"><span class="af-ic${coral ? ' is-coral' : ''}">${ic}</span><strong>${val}</strong><span>${label}</span></div>`;
        const IC = {
            card: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18"/></svg>',
            total: '<svg viewBox="0 0 24 24"><path d="M12 3v18M17 7.5c0-1.9-2.2-3.5-5-3.5s-5 1.6-5 3.5S9.2 11 12 11.5s5 1.9 5 4-2.2 3.5-5 3.5-5-1.6-5-3.5"/></svg>',
            up: '<svg viewBox="0 0 24 24"><path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/></svg>',
            heart: '<svg viewBox="0 0 24 24"><path d="M12 21s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6-8 11-8 11Z"/></svg>',
        };
        function renderStats() {
            const s = pledgeData ? pledgeData.stats : { subscribers: 0, monthly: 0, oneTime: 0, received: 0, currency: curOf(saved) };
            $('#rStats').innerHTML = [
                stat(0, IC.card, false, s.subscribers, 'Suscriptores'),
                stat(1, IC.up, false, money(s.monthly, s.currency), 'Al mes'),
                stat(2, IC.heart, true, money(s.oneTime, s.currency), 'En donaciones únicas'),
                stat(3, IC.total, true, money(s.received, s.currency), 'Recibido en total'),
            ].join('');
        }
        RENDER.resumen = function () {
            const r = saved;
            renderStats();
            const steps = [
                ['Nombre y foto de perfil', !!(r.name && r.avatar), 'perfil'],
                ['Cuenta tu historia', (r.bio || '').length >= 40, 'perfil'],
                [r.country === 'Venezuela' ? 'Cobros para Venezuela (PayPal, muy pronto)' : 'Activa tus cobros con Stripe', r.payments.ready, 'cuenta'],
                ['Crea al menos un plan mensual', r.plans.length > 0, 'planes'],
                ['Configura la donación única', r.oneTime.enabled && (r.oneTime.suggested.length > 0 || r.oneTime.allowCustom), 'unica'],
                ['Publica tu página', r.published, 'perfil'],
            ];
            const done = steps.filter((s) => s[1]).length;
            $('#rProgressText').textContent = done === steps.length ? '¡Tu página está completa!' : `${done} de ${steps.length} pasos listos`;
            requestAnimationFrame(() => { $('#rProgressBar').style.width = `${(done / steps.length) * 100}%`; });
            const badge = $('#rPublishedBadge');
            badge.className = 'af-badge ' + (r.published ? 'is-green' : 'is-gray');
            badge.innerHTML = `<span class="af-dot"></span>${r.published ? 'Publicada' : 'Sin publicar'}`;
            $('#rChecklist').innerHTML = steps.map((s, i) => `
                <a href="#${s[2]}" data-go="${s[2]}" class="af-check-item${s[1] ? ' is-done' : ''} af-in" style="--i:${i}">
                    <span class="af-check-dot"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>
                    <span class="af-check-label">${s[0]}</span>
                    <svg class="af-go" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>
                </a>`).join('');
            $$('[data-public-link]').forEach((a) => {
                a.href = `/foundation/r/${encodeURIComponent(r.slug)}`;
                a.title = r.published ? '' : 'Tu página aún no está publicada; solo tú la puedes ver';
            });
            const recentBox = $('#rRecent');
            const paintRecent = () => {
                const list = (pledgeData ? pledgeData.pledges : []).slice(0, 6);
                recentBox.innerHTML = list.length
                    ? list.map((p, i) => ui.pledgeRow(p, i)).join('')
                    : `<div class="af-empty"><span class="af-ic is-coral">${IC.heart}</span><strong>Todavía no hay aportes</strong><span>Comparte tu página para recibir tus primeros apoyos.</span></div>`;
            };
            if (!pledgeData) recentBox.innerHTML = '<div class="af-loading" style="min-height:120px"><span class="af-spinner"></span></div>';
            else paintRecent();
            store.rescuerPledges().then((d) => { pledgeData = d; if (current === 'resumen') { renderStats(); paintRecent(); } }).catch(() => { if (!pledgeData) paintRecent(); });
        };

        RENDER.perfil = renderPreview;
        RENDER.unica = () => { renderChips(); renderPreview(); };

        // --- planes ---
        RENDER.planes = function () {
            const cur = curOf(saved);
            const plans = saved.plans.slice().sort((a, b) => a.amount - b.amount);
            $('#planList').innerHTML = plans.map((p, i) => `
                <div class="af-item" style="--i:${i}">
                    <h4>${esc(p.name)} ${p.featured ? '<span class="af-badge is-coral">Popular</span>' : ''}</h4>
                    <span class="af-price">${money(p.amount, '')}<small>${cur}/mes</small></span>
                    <p>${esc(p.description || 'Sin descripción')}</p>
                    ${p.perks && p.perks.length ? `<p>${p.perks.length} beneficio${p.perks.length > 1 ? 's' : ''}</p>` : ''}
                    <div class="af-item-actions">
                        <button type="button" class="af-btn af-btn-soft af-btn-sm" data-edit-plan="${p.id}"><svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z"/></svg>Editar</button>
                    </div>
                </div>`).join('') + `
                <button type="button" class="af-add-tile" data-new-plan>
                    <span class="af-ic"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></span>
                    ${plans.length ? 'Agregar otro plan' : 'Crea tu primer plan'}
                </button>`;
            renderPreview();
        };

        const planSheet = $('#planSheet');
        const planForm = $('form', planSheet);
        let editingPlan = null;
        function perkRow(v = '') {
            const d = document.createElement('div');
            d.className = 'af-perk';
            d.innerHTML = `<input class="af-input" maxlength="60" placeholder="Ej. Fotos mensuales de los rescates" value="${esc(v)}"><button type="button" class="af-icon-btn is-danger" aria-label="Quitar"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>`;
            $('button', d).addEventListener('click', () => d.remove());
            return d;
        }
        function openPlan(id) {
            editingPlan = id ? saved.plans.find((p) => p.id === id) : null;
            const p = editingPlan || { name: '', amount: '', description: '', perks: [], featured: false };
            $('[data-title]', planSheet).textContent = editingPlan ? 'Editar plan' : 'Nuevo plan';
            $('#plName').value = p.name;
            $('#plAmount').value = p.amount;
            $('#plDesc').value = p.description;
            $('#plFeatured').checked = !!p.featured;
            const perks = $('#plPerks');
            perks.innerHTML = '';
            (p.perks.length ? p.perks : ['']).forEach((x) => perks.appendChild(perkRow(x)));
            $('[data-delete]', planSheet).hidden = !editingPlan;
            $$('.is-invalid', planSheet).forEach((x) => x.classList.remove('is-invalid'));
            openSheet(planSheet);
        }
        $('#plAddPerk').addEventListener('click', () => {
            const perks = $('#plPerks');
            if (perks.children.length >= 6) { toast('Máximo 6 beneficios', 'info'); return; }
            const r = perkRow(); perks.appendChild(r); $('input', r).focus();
        });
        document.addEventListener('click', (e) => {
            if (e.target.closest('[data-new-plan]')) { openPlan(null); return; }
            const ed = e.target.closest('[data-edit-plan]');
            if (ed) openPlan(ed.dataset.editPlan);
        });
        planForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = $('#plName').value.trim();
            const amount = Number($('#plAmount').value);
            const min = saved.payments.minAmount || 1;
            if (name.length < 2) return invalid($('#plName'), 'Ponle nombre al plan');
            if (!(amount >= min)) return invalid($('#plAmount'), `El monto debe ser de al menos ${money(min, curOf(saved))}`);
            const data = {
                name, amount: Math.round(amount * 100) / 100,
                description: $('#plDesc').value.trim(),
                perks: $$('#plPerks input').map((i) => i.value.trim()).filter(Boolean),
                featured: $('#plFeatured').checked,
            };
            const btn = $('[type=submit]', planForm);
            busy(btn, true);
            try {
                const res = editingPlan ? await store.updatePlan(editingPlan.id, data) : await store.createPlan(data);
                adoptLists(res.rescuer);
                closeSheet(planSheet);
                toast(editingPlan ? 'Plan actualizado' : 'Plan creado');
                RENDER.planes();
            } catch (ex) { toast(ex.message, 'error'); }
            busy(btn, false);
        });
        $('[data-delete]', planSheet).addEventListener('click', async () => {
            const p = editingPlan;
            closeSheet(planSheet);
            if (!(await confirmSheet(`¿Eliminar el plan ${p.name}?`, 'Ya no se podrá elegir. Quienes ya estén suscritos seguirán con su suscripción.'))) return;
            try {
                const res = await store.deletePlan(p.id);
                adoptLists(res.rescuer);
                toast('Plan eliminado');
                RENDER.planes();
            } catch (ex) { toast(ex.message, 'error'); }
        });

        // --- donación única: montos sugeridos ---
        function renderChips() {
            const cur = curOf(draft);
            const s = draft.oneTime.suggested.slice().sort((a, b) => a - b);
            $('#oChips').innerHTML = s.length
                ? s.map((v) => `<button type="button" class="af-chip is-active" data-rm="${v}" aria-label="Quitar ${v}">${money(v, cur)}<span class="af-chip-x" style="background:rgba(255,255,255,.25)">×</span></button>`).join('')
                : '<span class="af-hint">Sin montos sugeridos</span>';
        }
        $('#oChips').addEventListener('click', (e) => {
            const c = e.target.closest('[data-rm]');
            if (!c) return;
            draft.oneTime.suggested = draft.oneTime.suggested.filter((v) => Number(v) !== Number(c.dataset.rm));
            renderChips(); afterChange('oneTime.suggested');
        });
        function addChip() {
            const inp = $('#oNew');
            const v = Math.round(Number(inp.value) * 100) / 100;
            const min = (draft.payments && draft.payments.minAmount) || 1;
            if (!(v >= min)) return invalid(inp, `Escribe un monto de al menos ${money(min, curOf(draft))}`);
            if (draft.oneTime.suggested.map(Number).includes(v)) return invalid(inp, 'Ese monto ya está');
            if (draft.oneTime.suggested.length >= 6) return invalid(inp, 'Máximo 6 montos sugeridos');
            draft.oneTime.suggested.push(v);
            inp.value = '';
            renderChips(); afterChange('oneTime.suggested');
        }
        $('#oAdd').addEventListener('click', addChip);
        $('#oNew').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addChip(); } });

        // --- Cobros (Stripe) y Google Drive ---
        const BADGE = (cls, txt) => `<span class="af-dot"></span>${txt}`;
        function setBadge(el, cls, txt) { el.className = 'af-badge ' + cls; el.innerHTML = BADGE(cls, txt); }
        function renderPayCard() {
            const card = $('#payCard');
            const body = $('[data-pay-body]', card);
            const badge = $('[data-pay-badge]', card);
            const sub = $('[data-pay-sub]', card);
            if (saved.country === 'Venezuela') {
                sub.textContent = 'Para Venezuela los cobros serán con PayPal.';
                setBadge(badge, 'is-gray', 'Muy pronto');
                body.innerHTML = `<div class="af-notice is-coral">Estamos terminando los pagos con PayPal para Venezuela. Puedes armar y publicar tu página desde ya; cuando esté listo te avisaremos para conectar tu cuenta.</div>`;
                return;
            }
            const st = saved.stripe || {};
            sub.textContent = 'El dinero llega directo a tu cuenta, sin pasar por Attomos.';
            if (!st.connected) {
                setBadge(badge, 'is-gray', 'Sin conectar');
                body.innerHTML = `<div class="af-connect">
                    <p class="af-connect-note">Conecta Stripe como <strong>persona física</strong>. No necesitas empresa. Stripe te pedirá:</p>
                    <ul class="af-connect-steps">
                        <li>Tu nombre como aparece en tu RFC y tu RFC (13 caracteres)</li>
                        <li>Tu fecha de nacimiento y domicilio en México</li>
                        <li>Una cuenta CLABE en pesos (sirve Spin by OXXO o cualquier banco)</li>
                        <li>Tu Instagram o Facebook del rescate como "sitio web"</li>
                    </ul>
                    <div class="af-connect-actions"><button type="button" class="af-btn af-btn-primary" data-stripe-connect>Conectar Stripe</button></div>
                </div>`;
            } else if (!st.chargesEnabled) {
                setBadge(badge, 'is-coral', st.status === 'pending_verification' ? 'En revisión' : 'Faltan datos');
                body.innerHTML = `<div class="af-connect">
                    <p class="af-connect-note">${st.status === 'pending_verification' ? 'Stripe está revisando tus datos. Suele tardar unos minutos; a veces pide algún documento extra.' : 'Te faltan datos en Stripe para empezar a recibir aportes.'}</p>
                    <div class="af-connect-actions">
                        <button type="button" class="af-btn af-btn-primary" data-stripe-connect>Continuar en Stripe</button>
                        <button type="button" class="af-btn af-btn-ghost" data-stripe-refresh>Actualizar estado</button>
                    </div>
                </div>`;
            } else {
                setBadge(badge, 'is-green', 'Cobros activos');
                body.innerHTML = `<div class="af-connect">
                    <p class="af-connect-note">Ya puedes recibir suscripciones mensuales y donaciones únicas.${st.payoutsEnabled ? '' : ' Stripe todavía no habilita tus depósitos: revisa tu panel de Stripe.'}</p>
                    <div class="af-connect-actions">
                        <button type="button" class="af-btn af-btn-soft" data-stripe-dashboard>Ver mi panel de Stripe</button>
                        <button type="button" class="af-btn af-btn-ghost" data-stripe-refresh>Actualizar estado</button>
                    </div>
                </div>`;
            }
        }
        function renderDriveCard() {
            const card = $('#driveCard');
            const body = $('[data-drive-body]', card);
            const badge = $('[data-drive-badge]', card);
            const d = saved.drive || {};
            if (!d.connected) {
                setBadge(badge, 'is-gray', 'Sin conectar');
                body.innerHTML = `<div class="af-connect">
                    <ul class="af-connect-steps">
                        <li>Creamos la carpeta <strong>Attomos Foundation</strong> en tu Drive para tu foto de perfil</li>
                        <li>Attomos solo ve los archivos que él mismo sube, nada más de tu Drive</li>
                        <li>No borres esa foto: si la borras dejará de verse en tu página</li>
                    </ul>
                    <div class="af-connect-actions"><button type="button" class="af-btn af-btn-primary" data-drive-connect>Conectar Google Drive</button></div>
                </div>`;
            } else {
                setBadge(badge, d.issue ? 'is-coral' : 'is-green', d.issue ? 'Revisar' : 'Conectado');
                body.innerHTML = `<div class="af-connect">
                    <p class="af-connect-note">Conectado con <strong>${esc(d.email || 'tu cuenta de Google')}</strong>.</p>
                    ${d.issue ? `<div class="af-notice is-coral">${esc(d.issue)}</div>` : ''}
                    <div class="af-connect-actions">
                        ${d.issue ? '<button type="button" class="af-btn af-btn-primary" data-drive-connect>Volver a conectar</button>' : ''}
                        <button type="button" class="af-btn af-btn-ghost" data-drive-disconnect>Desconectar</button>
                    </div>
                </div>`;
            }
        }
        RENDER.cuenta = () => { renderAccount(); renderPayCard(); renderDriveCard(); };

        async function refreshRescuer() {
            const r = await store.myRescuer();
            ['stripe', 'drive', 'payments'].forEach((k) => { saved[k] = r[k]; draft[k] = r[k]; });
            renderDriveIssue();
            if (current === 'cuenta') RENDER.cuenta();
            return r;
        }
        document.addEventListener('click', async (e) => {
            const b = e.target.closest('[data-stripe-connect], [data-stripe-refresh], [data-stripe-dashboard], [data-drive-connect], [data-drive-disconnect]');
            if (!b) return;
            if (b.hasAttribute('data-stripe-connect')) {
                busy(b, true);
                try { location.href = await store.stripeConnect(); } catch (ex) { toast(ex.message, 'error'); busy(b, false); }
            } else if (b.hasAttribute('data-stripe-refresh')) {
                busy(b, true);
                try { saved.stripe = await store.stripeStatus(); await refreshRescuer(); toast('Estado actualizado'); } catch (ex) { toast(ex.message, 'error'); }
                busy(b, false);
            } else if (b.hasAttribute('data-stripe-dashboard')) {
                const w = window.open('', '_blank');
                busy(b, true);
                try { const url = await store.stripeDashboard(); if (w) w.location = url; else location.href = url; } catch (ex) { if (w) w.close(); toast(ex.message, 'error'); }
                busy(b, false);
            } else if (b.hasAttribute('data-drive-connect')) {
                const w = window.open('', 'af-google', 'width=520,height=680');
                busy(b, true);
                try {
                    const url = await store.driveConnect();
                    if (w) w.location = url; else location.href = url;
                } catch (ex) { if (w) w.close(); toast(ex.message, 'error'); }
                busy(b, false);
            } else if (b.hasAttribute('data-drive-disconnect')) {
                if (!(await confirmSheet('¿Desconectar Google Drive?', 'Tu foto actual se seguirá viendo un tiempo, pero no podrás subir otra y podría dejar de verse. No borramos nada de tu Drive.', 'Desconectar'))) return;
                try { await store.driveDisconnect(); await refreshRescuer(); toast('Google Drive desconectado'); } catch (ex) { toast(ex.message, 'error'); }
            }
        });
        window.addEventListener('message', async (e) => {
            if (e.origin !== location.origin || !e.data || e.data.type !== 'af-google') return;
            if (e.data.success) {
                await refreshRescuer().catch(() => null);
                toast('¡Google Drive conectado! Ya puedes subir tu foto');
            } else if (e.data.error !== 'denied') {
                toast('No se pudo conectar Google Drive. Intenta de nuevo.', 'error');
            }
        });

        fillForm();
        renderDriveIssue();
        const qs = new URLSearchParams(location.search);
        if (qs.get('stripe')) {
            history.replaceState(null, '', location.pathname + location.hash);
            if (qs.get('stripe') === 'error') toast('No se pudo abrir Stripe. Intenta de nuevo.', 'error');
            else refreshRescuer().then((r) => toast(r.payments.ready ? '¡Tus cobros están activos!' : 'Guardamos tu avance en Stripe', r.payments.ready ? 'ok' : 'info')).catch(() => null);
        }
    }

    // ==================================================================
    // DONADOR
    // ==================================================================
    if (role === 'donor') {
        let pledges = null;
        const loadPledges = async (force) => {
            if (!pledges || force) pledges = await store.myPledges();
            return pledges;
        };
        const sumBy = (list) => {
            const by = {};
            list.forEach((p) => { by[p.currency] = (by[p.currency] || 0) + Number(p.amount); });
            const keys = Object.keys(by);
            return keys.length ? keys.map((k) => money(by[k], k)).join(' + ') : money(0);
        };
        const stat = (i, coral, val, label, ic) => `<div class="af-stat" style="--i:${i}"><span class="af-ic${coral ? ' is-coral' : ''}">${ic}</span><strong>${val}</strong><span>${label}</span></div>`;
        RENDER.resumen = async function () {
            let pl = [];
            try { pl = await loadPledges(); } catch (ex) { toast(ex.message, 'error'); }
            const live = (p) => p.status === 'active' || p.status === 'canceling';
            const subs = pl.filter((p) => p.type === 'subscription' && live(p));
            const once = pl.filter((p) => p.type === 'one_time' && p.status === 'paid');
            const helped = new Set(pl.filter((p) => live(p) || p.status === 'paid').map((p) => p.rescuerSlug)).size;
            $('#dStats').innerHTML = [
                stat(0, false, subs.length, 'Suscripciones', '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18"/></svg>'),
                stat(1, false, sumBy(subs), 'Al mes', '<svg viewBox="0 0 24 24"><path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/></svg>'),
                stat(2, true, sumBy(once), 'Donaciones únicas', '<svg viewBox="0 0 24 24"><path d="M12 21s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6-8 11-8 11Z"/></svg>'),
                stat(3, true, helped, 'Rescatistas apoyados', '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>'),
            ].join('');
            const box = $('#dSuggest');
            try {
                const rs = (await store.rescuers()).filter((r) => r.payments.ready);
                box.innerHTML = rs.length
                    ? rs.slice(0, 6).map((r, i) => ui.rescuerCard(r, i)).join('')
                    : '<div class="af-empty" style="grid-column:1/-1"><strong>Pronto habrá rescatistas aquí</strong></div>';
            } catch (_) { box.innerHTML = ''; }
        };
        let pf = 'all';
        const pfSeg = $('#pledgeFilter');
        segmented(pfSeg);
        pfSeg.addEventListener('click', (e) => {
            const b = e.target.closest('.af-seg-btn');
            if (!b) return;
            pf = b.dataset.filter;
            $$('.af-seg-btn', pfSeg).forEach((x) => x.classList.toggle('is-active', x === b));
            RENDER.aportes();
        });
        RENDER.aportes = async function () {
            const box = $('#dPledges');
            if (!pledges) box.innerHTML = '<div class="af-loading" style="min-height:160px"><span class="af-spinner"></span></div>';
            let list = [];
            try { list = await loadPledges(); } catch (ex) { toast(ex.message, 'error'); }
            list = list.filter((p) => pf === 'all' || p.type === pf);
            box.innerHTML = list.length
                ? list.map((p, i) => ui.pledgeRow(p, i, { who: 'donor' })).join('')
                : `<div class="af-empty"><span class="af-ic is-coral"><svg viewBox="0 0 24 24"><path d="M12 21s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6-8 11-8 11Z"/></svg></span><strong>Aún no tienes aportes aquí</strong><span>Elige a un rescatista y apóyalo como prefieras.</span><a href="/foundation/rescatistas" class="af-btn af-btn-primary af-btn-sm" style="margin-top:6px">Ver rescatistas</a></div>`;
        };
        document.addEventListener('click', async (e) => {
            const b = e.target.closest('[data-cancel-pledge]');
            if (!b) return;
            const p = (pledges || []).find((x) => x.id === b.dataset.cancelPledge);
            if (!p) return;
            if (!(await confirmSheet('¿Cancelar?', `Se cancela tu suscripción a ${p.rescuerName}. Ya no se te cobrará el siguiente mes.`, 'Cancelar suscripción'))) return;
            try {
                const np = await store.cancelPledge(p.id);
                pledges = pledges.map((x) => (x.id === np.id ? np : x));
                toast(np.currentPeriodEnd ? `Listo. Seguirá activa hasta el ${fmtDate(np.currentPeriodEnd)}` : 'Suscripción cancelada');
                RENDER.aportes();
            } catch (ex) { toast(ex.message, 'error'); }
        });
        RENDER.explorar = async function () {
            const box = $('#dExplore');
            try {
                const rs = await store.rescuers();
                box.innerHTML = rs.length ? rs.map((r, i) => ui.rescuerCard(r, i)).join('') : '<div class="af-empty"><strong>Aún no hay rescatistas publicados</strong></div>';
            } catch (ex) { box.innerHTML = `<div class="af-empty"><strong>${esc(ex.message)}</strong></div>`; }
        };
    }

    ready();
    show(location.hash.slice(1) || 'resumen');
    if (role === 'rescuer' && location.hash === '#perfil' && !$('#pBio').value) {
        setTimeout(() => toast('Completa tu perfil y publícalo para empezar a recibir apoyo', 'info'), 600);
    }
})();