/* Attomos Foundation — panel (rescatista y donador) */
(function () {
    'use strict';
    const { store, session, toast, segmented, iosSelect, initSidebar, readImage, uid, esc, money, slugify, ui } = window.AF;

    const user = session.get();
    if (!user) { location.replace('/foundation/login?next=' + encodeURIComponent('/foundation/panel' + location.hash)); return; }
    const role = user.role === 'rescuer' ? 'rescuer' : 'donor';
    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => [...r.querySelectorAll(s)];
    const clone = (o) => JSON.parse(JSON.stringify(o));
    const first = user.name.split(' ')[0];

    // Solo las vistas del rol de la sesión
    $$('.af-view[data-for]').forEach((v) => { if (v.dataset.for !== role) v.remove(); });
    $$('[data-hello]').forEach((h) => { h.textContent = `Hola, ${first}`; });

    const VIEWS = role === 'rescuer' ? ['resumen', 'perfil', 'planes', 'apadrina', 'unica', 'cuenta'] : ['resumen', 'aportes', 'explorar', 'cuenta'];
    let current = null;
    const nav = initSidebar({ role, onNavigate: (v) => show(v) });

    function show(view) {
        if (!VIEWS.includes(view)) view = 'resumen';
        if (view === current) return;
        current = view;
        $$('.af-view').forEach((v) => v.classList.toggle('is-active', v.dataset.view === view));
        nav && nav.setActive(view);
        history.replaceState(null, '', '#' + view);
        window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
        RENDER[view] && RENDER[view]();
        requestAnimationFrame(() => $$('.af-view.is-active .af-seg-host').forEach((s) => s._afSeg && s._afSeg.place(true)));
    }
    document.addEventListener('click', (e) => {
        const go = e.target.closest('[data-go]');
        if (go) { e.preventDefault(); show(go.dataset.go); }
    });
    window.addEventListener('hashchange', () => show(location.hash.slice(1)));
    $$('#afApp [data-af-logout]').forEach((b) => b.addEventListener('click', () => {
        if (dirty && !confirm('Tienes cambios sin guardar. ¿Salir de todos modos?')) return;
        dirty = false; session.clear(); location.href = '/foundation/login';
    }));

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

    function confirmDelete(title, text) {
        return new Promise((resolve) => {
            const s = $('#confirmSheet');
            $('[data-title]', s).textContent = title;
            $('[data-text]', s).textContent = text;
            const ok = $('[data-ok]', s);
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
    function renderCuenta() {
        $('#aName').value = user.name;
        $('#aEmail').value = user.email;
        $('#aRole').textContent = role === 'rescuer' ? 'Rescatista' : 'Donador';
    }
    $('#aSave').addEventListener('click', () => {
        const n = $('#aName').value.trim();
        if (n.length < 2) { toast('Escribe tu nombre', 'error'); return; }
        // TODO backend: PATCH /api/foundation/me
        const db = JSON.parse(localStorage.getItem('af_db_v1'));
        const u = db.users.find((x) => x.id === user.id);
        if (u) { u.name = n; localStorage.setItem('af_db_v1', JSON.stringify(db)); user.name = n; }
        $$('.af-side-name').forEach((x) => { x.textContent = n; });
        $$('.af-side-avatar').forEach((x) => { x.textContent = AF.initials(n); });
        toast('Datos guardados');
    });

    const RENDER = { cuenta: renderCuenta };
    let dirty = false;

    // ==================================================================
    // RESCATISTA
    // ==================================================================
    if (role === 'rescuer') {
        let saved = store.rescuerById(user.rescuerId);
        if (!saved) {
            toast('No encontramos tu perfil de rescatista', 'error');
            return;
        }
        saved = clone(saved);
        let draft = clone(saved);
        const saveBar = $('#afSaveBar');

        const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
        const setPath = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); ks.reduce((a, k) => (a[k] = a[k] || {}), o)[last] = v; };

        function markDirty() {
            dirty = JSON.stringify(draft) !== JSON.stringify(saved);
            saveBar.classList.toggle('is-show', dirty);
        }
        window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

        // --- enlazar campos ---
        $$('[data-bind]').forEach((el) => {
            if (el.tagName === 'SELECT') iosSelect(el);
            const ev = el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input';
            el.addEventListener(ev, () => {
                let v = el.type === 'checkbox' ? el.checked : el.value;
                if (el.hasAttribute('data-num')) v = v === '' ? '' : Math.max(0, Number(v));
                if (el.dataset.bind === 'slug') {
                    const clean = v.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-{2,}/g, '-').slice(0, 48);
                    if (clean !== v) { const p = el.selectionStart; el.value = clean; el.setSelectionRange(p, p); }
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
            renderImages();
            renderChips();
            renderPreview();
        }

        function validate(r) {
            if (!r.name || r.name.trim().length < 2) return ['Escribe el nombre de tu rescate', 'perfil', '#pName'];
            if (!r.slug) return ['Escribe la dirección de tu página', 'perfil', '#pSlug'];
            if (r.allowCustomMonthly && !(Number(r.minCustomMonthly) >= 1)) return ['El monto mínimo mensual debe ser de al menos $1', 'planes', '#mMin'];
            if (r.oneTime.enabled && !(Number(r.oneTime.min) >= 1)) return ['El monto mínimo de donación única debe ser de al menos $1', 'unica', '#oMin'];
            if (r.oneTime.enabled && !r.oneTime.allowCustom && !r.oneTime.suggested.length) return ['Agrega al menos un monto sugerido o permite otro monto', 'unica', '#oNew'];
            return null;
        }
        function persist(r) {
            try { return store.saveRescuer(r); } catch (ex) { toast(ex.message, 'error'); return false; }
        }
        $('#afSave').addEventListener('click', () => {
            draft.name = (draft.name || '').trim();
            const bad = validate(draft);
            if (bad) {
                toast(bad[0], 'error');
                show(bad[1]);
                const f = $(bad[2]);
                if (f) { f.classList.remove('is-invalid'); void f.offsetWidth; f.classList.add('is-invalid'); f.focus(); }
                return;
            }
            draft.minCustomMonthly = Number(draft.minCustomMonthly);
            draft.oneTime.min = Number(draft.oneTime.min);
            if (!persist(draft)) return;
            const wasPublished = saved.published;
            saved = clone(draft);
            markDirty();
            toast(!wasPublished && saved.published ? '¡Tu página ya está publicada!' : 'Cambios guardados');
            RENDER[current] && RENDER[current]();
        });
        $('#afDiscard').addEventListener('click', () => {
            draft = clone(saved);
            fillForm();
            markDirty();
            RENDER[current] && RENDER[current]();
            toast('Cambios descartados', 'info');
        });

        /** Cambios que se guardan al momento (planes y peludos). */
        function commit(fn) {
            const next = clone(saved);
            fn(next);
            if (!persist(next)) return false;
            saved = next;
            fn(draft);
            markDirty();
            return true;
        }

        // --- imágenes de perfil ---
        let pickTarget = null;
        $$('[data-pick]').forEach((b) => b.addEventListener('click', () => { pickTarget = b.dataset.pick; $('#pFile').click(); }));
        $('#pFile').addEventListener('change', async (e) => {
            const f = e.target.files[0];
            e.target.value = '';
            if (!f) return;
            try {
                draft[pickTarget] = await readImage(f, pickTarget === 'cover' ? 1400 : 500);
                renderImages();
                afterChange(pickTarget);
            } catch (ex) { toast(ex.message, 'error'); }
        });
        function renderImages() {
            const c = $('#pCover');
            c.style.backgroundImage = draft.cover ? `url('${draft.cover}')` : '';
            $('#pAvatar').innerHTML = draft.avatar ? `<img src="${esc(draft.avatar)}" alt="">` : esc(AF.initials(draft.name));
        }
        $('#pName').addEventListener('input', () => { if (!draft.avatar) renderImages(); });

        // --- vista previa ---
        function renderPreview() {
            const r = draft;
            const plans = (r.plans || []).slice(0, 3).map((p) => `<span class="af-preview-pill"><span>${esc(p.name)}</span><span>${money(p.amount)}</span></span>`).join('');
            const avail = (r.animals || []).filter((a) => a.status === 'disponible').length;
            const html = `
                <div class="af-preview-frame">
                    <div class="af-preview-cover"${r.cover ? ` style="background-image:url('${esc(r.cover)}')"` : ''}></div>
                    <div class="af-preview-body">
                        ${ui.avatarHtml(r)}
                        <h4>${esc(r.name || 'Tu rescate')}</h4>
                        <p>${esc(r.city || 'Tu ciudad')}${r.country ? ' · ' + esc(r.country) : ''}</p>
                        <div class="af-preview-list">
                            ${plans || '<span class="af-preview-pill" style="opacity:.6"><span>Aún no hay planes</span></span>'}
                            ${r.allowCustomMonthly ? `<span class="af-preview-pill"><span>Monto libre</span><span>desde ${money(r.minCustomMonthly || 0)}</span></span>` : ''}
                            ${avail ? `<span class="af-preview-pill is-coral"><span>Para apadrinar</span><span>${avail}</span></span>` : ''}
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
        RENDER.resumen = function () {
            const r = saved;
            const pl = store.pledgesByRescuer(r.id);
            const subs = pl.filter((p) => p.type === 'subscription');
            const spon = pl.filter((p) => p.type === 'sponsor');
            const monthly = subs.concat(spon).reduce((a, p) => a + Number(p.amount), 0);
            const once = pl.filter((p) => p.type === 'one_time').reduce((a, p) => a + Number(p.amount), 0);
            const stat = (i, ic, coral, val, label) => `<div class="af-stat" style="--i:${i}"><span class="af-ic${coral ? ' is-coral' : ''}">${ic}</span><strong>${val}</strong><span>${label}</span></div>`;
            $('#rStats').innerHTML = [
                stat(0, '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18"/></svg>', false, subs.length, 'Suscriptores'),
                stat(1, '<svg viewBox="0 0 24 24"><circle cx="5.5" cy="10" r="2"/><circle cx="9.5" cy="5.5" r="2"/><circle cx="14.5" cy="5.5" r="2"/><circle cx="18.5" cy="10" r="2"/><path d="M8 17.5c0-2.5 1.8-4.5 4-4.5s4 2 4 4.5c0 1.7-1.8 2.5-4 2.5s-4-.8-4-2.5Z"/></svg>', true, spon.length, 'Padrinos'),
                stat(2, '<svg viewBox="0 0 24 24"><path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/></svg>', false, money(monthly), 'Al mes (comprometido)'),
                stat(3, '<svg viewBox="0 0 24 24"><path d="M12 21s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6-8 11-8 11Z"/></svg>', true, money(once), 'En donaciones únicas'),
            ].join('');

            const steps = [
                ['Nombre y foto de perfil', !!(r.name && r.avatar), 'perfil'],
                ['Cuenta tu historia', (r.bio || '').length >= 40, 'perfil'],
                ['Crea al menos un plan mensual', r.plans.length > 0, 'planes'],
                ['Sube un peludo para apadrinar', r.animals.length > 0, 'apadrina'],
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

            const recent = pl.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
            $('#rRecent').innerHTML = recent.length
                ? recent.map((p, i) => ui.pledgeRow(p, i)).join('')
                : `<div class="af-empty"><span class="af-ic is-coral"><svg viewBox="0 0 24 24"><path d="M12 21s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6-8 11-8 11Z"/></svg></span><strong>Todavía no hay aportes</strong><span>Comparte tu página para recibir tus primeros apoyos.</span></div>`;
            $$('[data-public-link]').forEach((a) => {
                a.href = `/foundation/r/${encodeURIComponent(r.slug)}`;
                a.title = r.published ? '' : 'Tu página aún no está publicada; solo tú la puedes ver';
            });
        };

        RENDER.perfil = renderPreview;
        RENDER.unica = () => { renderChips(); renderPreview(); };

        // --- planes ---
        RENDER.planes = function () {
            const plans = saved.plans.slice().sort((a, b) => a.amount - b.amount);
            $('#planList').innerHTML = plans.map((p, i) => `
                <div class="af-item" style="--i:${i}">
                    <h4>${esc(p.name)} ${p.featured ? '<span class="af-badge is-coral">Popular</span>' : ''}</h4>
                    <span class="af-price">${money(p.amount, '')}<small>USD/mes</small></span>
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
            const n = e.target.closest('[data-new-plan]');
            if (n) { openPlan(null); return; }
            const ed = e.target.closest('[data-edit-plan]');
            if (ed) openPlan(ed.dataset.editPlan);
        });
        function invalid(el, msg) {
            el.classList.remove('is-invalid'); void el.offsetWidth; el.classList.add('is-invalid'); el.focus();
            toast(msg, 'error');
        }
        planForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const name = $('#plName').value.trim();
            const amount = Number($('#plAmount').value);
            if (name.length < 2) return invalid($('#plName'), 'Ponle nombre al plan');
            if (!(amount >= 1)) return invalid($('#plAmount'), 'El monto debe ser de al menos $1');
            const data = {
                name,
                amount: Math.round(amount * 100) / 100,
                description: $('#plDesc').value.trim(),
                perks: $$('#plPerks input').map((i) => i.value.trim()).filter(Boolean),
                featured: $('#plFeatured').checked,
            };
            const id = editingPlan ? editingPlan.id : uid('pl');
            const ok = commit((r) => {
                if (data.featured) r.plans.forEach((p) => { p.featured = false; });
                const i = r.plans.findIndex((p) => p.id === id);
                if (i >= 0) r.plans[i] = Object.assign({}, r.plans[i], data);
                else r.plans.push(Object.assign({ id }, data));
            });
            if (!ok) return;
            closeSheet(planSheet);
            toast(editingPlan ? 'Plan actualizado' : 'Plan creado');
            RENDER.planes();
        });
        $('[data-delete]', planSheet).addEventListener('click', async () => {
            const p = editingPlan;
            closeSheet(planSheet);
            if (!(await confirmDelete(`¿Eliminar el plan ${p.name}?`, 'Los donadores ya no podrán elegirlo.'))) return;
            commit((r) => { r.plans = r.plans.filter((x) => x.id !== p.id); });
            toast('Plan eliminado');
            RENDER.planes();
        });

        // --- apadrinamientos ---
        let animalFilter = 'all';
        const filterSeg = $('#animalFilter');
        segmented(filterSeg);
        filterSeg.addEventListener('click', (e) => {
            const b = e.target.closest('.af-seg-btn');
            if (!b) return;
            animalFilter = b.dataset.filter;
            $$('.af-seg-btn', filterSeg).forEach((x) => x.classList.toggle('is-active', x === b));
            RENDER.apadrina();
        });
        RENDER.apadrina = function () {
            const all = saved.animals;
            ['all', 'disponible', 'apadrinado', 'adoptado'].forEach((k) => {
                $(`[data-c="${k}"]`, filterSeg).textContent = k === 'all' ? all.length : all.filter((a) => a.status === k).length;
            });
            const list = animalFilter === 'all' ? all : all.filter((a) => a.status === animalFilter);
            const STATUS = { disponible: ['Disponible', 'is-coral'], apadrinado: ['Con padrino', 'is-green'], adoptado: ['Adoptado', 'is-gray'] };
            $('#animalList').innerHTML = list.map((a, i) => {
                const st = STATUS[a.status] || STATUS.disponible;
                return `<div class="af-item" style="--i:${i}">
                    <div class="af-item-thumb">${a.photo ? `<img src="${esc(a.photo)}" alt="">` : ui.petArt(a.species)}</div>
                    <h4>${esc(a.name)} <span class="af-badge ${st[1]}"><span class="af-dot"></span>${st[0]}</span></h4>
                    <p>${a.species === 'perro' ? 'Perro' : 'Gato'} · ${a.sex === 'macho' ? 'Macho' : 'Hembra'}${a.age ? ' · ' + esc(a.age) : ''}</p>
                    <span class="af-price">${money(a.sponsorAmount, '')}<small>USD/mes</small></span>
                    <div class="af-item-actions">
                        <button type="button" class="af-btn af-btn-soft af-btn-sm" data-edit-animal="${a.id}"><svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z"/></svg>Editar</button>
                    </div>
                </div>`;
            }).join('') + (animalFilter === 'all' || animalFilter === 'disponible' ? `
                <button type="button" class="af-add-tile" data-new-animal>
                    <span class="af-ic is-coral"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></span>
                    ${all.length ? 'Agregar otro peludo' : 'Sube a tu primer peludo'}
                </button>` : (list.length ? '' : '<div class="af-empty" style="grid-column:1/-1"><strong>Nada por aquí</strong><span>No hay peludos con este estado.</span></div>'));
        };

        const animalSheet = $('#animalSheet');
        const animalForm = $('form', animalSheet);
        ['#anSpecies', '#anSex', '#anStatus'].forEach((s) => iosSelect($(s)));
        let editingAnimal = null, animalPhoto = '';
        function setAnimalPhoto(src) {
            animalPhoto = src || '';
            const img = $('#anPhotoImg');
            img.hidden = !animalPhoto;
            if (animalPhoto) img.src = animalPhoto; else img.removeAttribute('src');
            $('#anPhotoText').textContent = animalPhoto ? 'Cambiar foto' : 'Subir foto';
        }
        function openAnimal(id) {
            editingAnimal = id ? saved.animals.find((a) => a.id === id) : null;
            const a = editingAnimal || { name: '', species: 'gato', sex: 'hembra', age: '', sponsorAmount: '', status: 'disponible', story: '', photo: '' };
            $('[data-title]', animalSheet).textContent = editingAnimal ? `Editar a ${a.name}` : 'Nuevo peludo';
            $('#anName').value = a.name;
            $('#anSpecies').value = a.species;
            $('#anSex').value = a.sex;
            $('#anAge').value = a.age;
            $('#anAmount').value = a.sponsorAmount;
            $('#anStatus').value = a.status;
            $('#anStory').value = a.story;
            setAnimalPhoto(a.photo);
            $('[data-delete]', animalSheet).hidden = !editingAnimal;
            $$('.is-invalid', animalSheet).forEach((x) => x.classList.remove('is-invalid'));
            openSheet(animalSheet);
        }
        $('#anPhoto').addEventListener('change', async (e) => {
            const f = e.target.files[0];
            e.target.value = '';
            if (!f) return;
            try { setAnimalPhoto(await readImage(f, 800)); } catch (ex) { toast(ex.message, 'error'); }
        });
        document.addEventListener('click', (e) => {
            const n = e.target.closest('[data-new-animal]');
            if (n) { openAnimal(null); return; }
            const ed = e.target.closest('[data-edit-animal]');
            if (ed) openAnimal(ed.dataset.editAnimal);
        });
        animalForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const name = $('#anName').value.trim();
            const amount = Number($('#anAmount').value);
            if (name.length < 1) return invalid($('#anName'), '¿Cómo se llama?');
            if (!(amount >= 1)) return invalid($('#anAmount'), 'El monto debe ser de al menos $1');
            const data = {
                name,
                species: $('#anSpecies').value,
                sex: $('#anSex').value,
                age: $('#anAge').value.trim(),
                sponsorAmount: Math.round(amount * 100) / 100,
                status: $('#anStatus').value,
                story: $('#anStory').value.trim(),
                photo: animalPhoto,
            };
            const id = editingAnimal ? editingAnimal.id : uid('an');
            const ok = commit((r) => {
                const i = r.animals.findIndex((a) => a.id === id);
                if (i >= 0) r.animals[i] = Object.assign({}, r.animals[i], data);
                else r.animals.push(Object.assign({ id }, data));
            });
            if (!ok) return;
            closeSheet(animalSheet);
            toast(editingAnimal ? `${name} actualizado` : `${name} ya se puede apadrinar`);
            RENDER.apadrina();
        });
        $('[data-delete]', animalSheet).addEventListener('click', async () => {
            const a = editingAnimal;
            closeSheet(animalSheet);
            if (!(await confirmDelete(`¿Eliminar a ${a.name}?`, 'Ya no aparecerá en tu página.'))) return;
            commit((r) => { r.animals = r.animals.filter((x) => x.id !== a.id); });
            toast(`${a.name} eliminado`);
            RENDER.apadrina();
        });

        // --- donación única: montos sugeridos ---
        function renderChips() {
            const s = draft.oneTime.suggested.slice().sort((a, b) => a - b);
            $('#oChips').innerHTML = s.length
                ? s.map((v) => `<button type="button" class="af-chip is-active" data-rm="${v}" aria-label="Quitar ${v}">${money(v)}<span class="af-chip-x" style="background:rgba(255,255,255,.25)">×</span></button>`).join('')
                : '<span class="af-hint">Sin montos sugeridos</span>';
        }
        $('#oChips').addEventListener('click', (e) => {
            const c = e.target.closest('[data-rm]');
            if (!c) return;
            draft.oneTime.suggested = draft.oneTime.suggested.filter((v) => v !== Number(c.dataset.rm));
            renderChips(); afterChange('oneTime.suggested');
        });
        function addChip() {
            const inp = $('#oNew');
            const v = Math.round(Number(inp.value) * 100) / 100;
            if (!(v >= 1)) return invalid(inp, 'Escribe un monto de al menos $1');
            if (draft.oneTime.suggested.includes(v)) return invalid(inp, 'Ese monto ya está');
            if (draft.oneTime.suggested.length >= 6) return invalid(inp, 'Máximo 6 montos sugeridos');
            draft.oneTime.suggested.push(v);
            inp.value = '';
            renderChips(); afterChange('oneTime.suggested');
        }
        $('#oAdd').addEventListener('click', addChip);
        $('#oNew').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addChip(); } });

        fillForm();
    }

    // ==================================================================
    // DONADOR
    // ==================================================================
    if (role === 'donor') {
        const mine = () => store.pledgesByDonor(user.id).sort((a, b) => b.createdAt - a.createdAt);
        RENDER.resumen = function () {
            const pl = mine();
            const subs = pl.filter((p) => p.type === 'subscription');
            const spon = pl.filter((p) => p.type === 'sponsor');
            const monthly = subs.concat(spon).reduce((a, p) => a + Number(p.amount), 0);
            const once = pl.filter((p) => p.type === 'one_time').reduce((a, p) => a + Number(p.amount), 0);
            const stat = (i, coral, val, label, ic) => `<div class="af-stat" style="--i:${i}"><span class="af-ic${coral ? ' is-coral' : ''}">${ic}</span><strong>${val}</strong><span>${label}</span></div>`;
            $('#dStats').innerHTML = [
                stat(0, false, subs.length, 'Suscripciones', '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18"/></svg>'),
                stat(1, true, spon.length, 'Ahijados', '<svg viewBox="0 0 24 24"><circle cx="5.5" cy="10" r="2"/><circle cx="9.5" cy="5.5" r="2"/><circle cx="14.5" cy="5.5" r="2"/><circle cx="18.5" cy="10" r="2"/><path d="M8 17.5c0-2.5 1.8-4.5 4-4.5s4 2 4 4.5c0 1.7-1.8 2.5-4 2.5s-4-.8-4-2.5Z"/></svg>'),
                stat(2, false, money(monthly), 'Al mes', '<svg viewBox="0 0 24 24"><path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/></svg>'),
                stat(3, true, money(once), 'Donaciones únicas', '<svg viewBox="0 0 24 24"><path d="M12 21s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6-8 11-8 11Z"/></svg>'),
            ].join('');
            const animals = [];
            store.rescuers().forEach((r) => r.animals.filter((a) => a.status === 'disponible').forEach((a) => animals.push([a, r])));
            $('#dSuggest').innerHTML = animals.length
                ? animals.slice(0, 6).map(([a, r], i) => ui.animalCard(a, r, i)).join('')
                : '<div class="af-empty" style="grid-column:1/-1"><strong>Por ahora no hay peludos disponibles</strong></div>';
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
        RENDER.aportes = function () {
            const pl = mine().filter((p) => pf === 'all' || p.type === pf);
            $('#dPledges').innerHTML = pl.length
                ? pl.map((p, i) => ui.pledgeRow(p, i, { who: 'donor' })).join('')
                : `<div class="af-empty"><span class="af-ic is-coral"><svg viewBox="0 0 24 24"><path d="M12 21s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6-8 11-8 11Z"/></svg></span><strong>Aún no tienes aportes aquí</strong><span>Elige a un rescatista y apóyalo como prefieras.</span><a href="/foundation/rescatistas" class="af-btn af-btn-primary af-btn-sm" style="margin-top:6px">Ver rescatistas</a></div>`;
        };
        RENDER.explorar = function () {
            const rs = store.rescuers();
            $('#dExplore').innerHTML = rs.length ? rs.map((r, i) => ui.rescuerCard(r, i)).join('') : '<div class="af-empty"><strong>Aún no hay rescatistas publicados</strong></div>';
        };
    }

    show(location.hash.slice(1) || 'resumen');
    if (role === 'rescuer' && location.hash === '#perfil' && !store.rescuerById(user.rescuerId).bio) {
        setTimeout(() => toast('Completa tu perfil y publícalo para empezar a recibir apoyo', 'info'), 600);
    }
})();
