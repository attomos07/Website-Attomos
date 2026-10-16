/* Attomos Foundation — páginas públicas (inicio, listas y página del rescatista) */
(function () {
    'use strict';
    const { store, session, toast, segmented, esc, money, ui } = window.AF;
    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => [...r.querySelectorAll(s)];
    const page = document.body.dataset.page;
    const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const ICON = {
        sub: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18M7 15h4"/></svg>',
        paw: '<svg viewBox="0 0 24 24"><circle cx="5.5" cy="10" r="2"/><circle cx="9.5" cy="5.5" r="2"/><circle cx="14.5" cy="5.5" r="2"/><circle cx="18.5" cy="10" r="2"/><path d="M8 17.5c0-2.5 1.8-4.5 4-4.5s4 2 4 4.5c0 1.7-1.8 2.5-4 2.5s-4-.8-4-2.5Z"/></svg>',
        heart: '<svg viewBox="0 0 24 24"><path d="M12 21s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6-8 11-8 11Z"/></svg>',
        pin: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
        shield: '<svg viewBox="0 0 24 24"><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6Z"/><path d="m9 12 2 2 4-4"/></svg>',
        share: '<svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>',
    };
    const emptyBox = (title, text, cta = '') => `<div class="af-empty" style="grid-column:1/-1"><span class="af-ic is-coral">${ICON.heart}</span><strong>${title}</strong><span>${text}</span>${cta}</div>`;

    // ------------------------------------------------------------------
    // Inicio
    // ------------------------------------------------------------------
    if (page === 'home') {
        const rs = store.rescuers().slice(0, 6);
        $('#afHomeRescuers').innerHTML = rs.length
            ? rs.map((r, i) => ui.rescuerCard(r, i)).join('')
            : emptyBox('Pronto habrá rescatistas aquí', '¿Eres rescatista? Crea tu página gratis.');
    }

    // ------------------------------------------------------------------
    // Listas: rescatistas / apadrina / donar
    // ------------------------------------------------------------------
    if (page === 'explore') {
        const mode = document.body.dataset.mode || 'rescatistas';
        const COPY = {
            rescatistas: ['Rescatistas', 'Suscríbete cada mes con uno de sus planes o con el monto que tú elijas.'],
            apadrina: ['Apadrina a un peludo', 'Elige a un gato o perro y cubre sus gastos cada mes. Le cambias la vida.'],
            donar: ['Donación única', 'Dona una sola vez la cantidad que quieras. Sin suscripciones.'],
        };
        $('#afExTitle').textContent = COPY[mode][0];
        $('#afExLead').textContent = COPY[mode][1];
        const grid = $('#afExGrid');
        const search = $('#afExSearch');
        let species = 'all';

        if (mode === 'apadrina') {
            search.placeholder = 'Buscar por nombre, ciudad o rescatista';
            const f = $('#afExFilter');
            f.hidden = false;
            segmented(f);
            f.addEventListener('click', (e) => {
                const b = e.target.closest('.af-seg-btn');
                if (!b) return;
                species = b.dataset.f;
                $$('.af-seg-btn', f).forEach((x) => x.classList.toggle('is-active', x === b));
                render();
            });
        }

        function render() {
            const q = norm(search.value.trim());
            const rs = store.rescuers();
            if (mode === 'apadrina') {
                const list = [];
                rs.forEach((r) => r.animals.forEach((a) => {
                    if (a.status === 'adoptado') return;
                    if (species !== 'all' && a.species !== species) return;
                    if (q && !norm(`${a.name} ${r.name} ${r.city}`).includes(q)) return;
                    list.push([a, r]);
                }));
                list.sort((x, y) => (x[0].status === 'disponible' ? 0 : 1) - (y[0].status === 'disponible' ? 0 : 1));
                grid.innerHTML = list.length
                    ? list.map(([a, r], i) => ui.animalCard(a, r, i)).join('')
                    : emptyBox('No encontramos peludos', 'Prueba con otra búsqueda.');
                return;
            }
            let list = rs.filter((r) => !q || norm(`${r.name} ${r.city} ${r.country}`).includes(q));
            if (mode === 'donar') list = list.filter((r) => r.oneTime && r.oneTime.enabled);
            grid.innerHTML = list.length
                ? list.map((r, i) => {
                    let html = ui.rescuerCard(r, i);
                    if (mode === 'donar') html = html.replace(`href="/foundation/r/${encodeURIComponent(r.slug)}"`, `href="/foundation/r/${encodeURIComponent(r.slug)}?tab=unica"`);
                    return html;
                }).join('')
                : emptyBox('No encontramos rescatistas', q ? 'Prueba con otra búsqueda.' : 'Pronto habrá más.');
        }
        let t;
        search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(render, 120); });
        render();
    }

    // ------------------------------------------------------------------
    // Página del rescatista
    // ------------------------------------------------------------------
    if (page === 'rescuer') {
        const root = $('#afRescuer');
        const slug = document.body.dataset.slug || decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');
        const r = store.rescuerBySlug(slug);
        const me = session.get();
        const isOwner = !!(r && me && me.rescuerId === r.id);

        if (!r || (!r.published && !isOwner)) {
            root.innerHTML = `<div class="af-empty af-in" style="margin-top:40px;padding:60px 20px"><span class="af-ic is-coral">${ICON.paw}</span><strong>No encontramos esta página</strong><span>Puede que el rescatista aún no la publique.</span><a href="/foundation/rescatistas" class="af-btn af-btn-primary af-btn-sm" style="margin-top:6px">Ver rescatistas</a></div>`;
            return;
        }
        document.title = `${r.name} · Attomos Foundation`;

        const params = new URLSearchParams(location.search);
        const hasMonthly = r.plans.length > 0 || r.allowCustomMonthly;
        const sponsorable = r.animals.filter((a) => a.status !== 'adoptado');
        const hasSponsor = sponsorable.length > 0;
        const hasOnce = r.oneTime && r.oneTime.enabled;
        const tabs = [
            hasMonthly && ['mensual', 'Suscripción mensual', ICON.sub, 'Mensual'],
            hasSponsor && ['apadrina', 'Apadrina', ICON.paw, 'Apadrina'],
            hasOnce && ['unica', 'Donación única', ICON.heart, 'Única'],
        ].filter(Boolean);

        const st = {
            tab: tabs.some((t) => t[0] === params.get('tab')) ? params.get('tab') : (tabs[0] && tabs[0][0]),
            plan: params.get('plan') || (r.plans.find((p) => p.featured) || r.plans[0] || {}).id || (r.allowCustomMonthly ? 'custom' : null),
            custom: params.get('custom') || '',
            animal: params.get('animal') && r.animals.some((a) => a.id === params.get('animal') && a.status === 'disponible') ? params.get('animal') : null,
            amount: params.get('amount') || (hasOnce && r.oneTime.suggested.length ? String(r.oneTime.suggested[Math.min(1, r.oneTime.suggested.length - 1)]) : 'custom'),
            once: params.get('once') || '',
            done: null,
        };
        if (st.tab === 'unica' && params.get('amount') && !r.oneTime.suggested.map(String).includes(params.get('amount'))) { st.once = params.get('amount'); st.amount = 'custom'; }

        const soc = r.socials || {};
        const socials = [
            soc.instagram && ['Instagram', `https://instagram.com/${soc.instagram.replace(/^@/, '')}`, '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".8"/></svg>'],
            soc.facebook && ['Facebook', /^https?:/.test(soc.facebook) ? soc.facebook : `https://${soc.facebook.replace(/^\/+/, '')}`, '<svg viewBox="0 0 24 24"><path d="M15 3h-3a4 4 0 0 0-4 4v3H6v4h2v7h4v-7h3l1-4h-4V7a1 1 0 0 1 1-1h2Z"/></svg>'],
            soc.tiktok && ['TikTok', `https://tiktok.com/@${soc.tiktok.replace(/^@/, '')}`, '<svg viewBox="0 0 24 24"><path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5M14 3c.5 2.8 2.4 4.6 5 5"/></svg>'],
            soc.whatsapp && ['WhatsApp', `https://wa.me/${soc.whatsapp.replace(/\D/g, '')}`, '<svg viewBox="0 0 24 24"><path d="M4 20l1.3-4A8 8 0 1 1 8 18.7Z"/><path d="M9 9.5c.3 2 2.5 4.2 4.5 4.5l1-1 2 1c-.3 1.2-1.3 1.8-2.5 1.6-3-.6-5.5-3-6-6-.2-1.2.4-2.2 1.6-2.5l1 2Z"/></svg>'],
        ].filter(Boolean);

        root.innerHTML = `
            ${!r.published ? `<div class="af-card af-in" style="padding:14px 20px;margin-bottom:16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap"><span class="af-badge is-gray"><span class="af-dot"></span>Sin publicar</span><span style="flex:1;min-width:200px;color:var(--af-muted);font-size:14px">Solo tú puedes ver esta página. Publícala desde tu panel.</span><a href="/foundation/panel#perfil" class="af-btn af-btn-primary af-btn-sm">Ir a mi perfil</a></div>` : ''}
            <div class="af-profile-cover af-in"${r.cover ? ` style="background-image:url('${esc(r.cover)}')"` : ''}></div>
            <div class="af-profile-head af-in" style="--i:1">
                ${ui.avatarHtml(r)}
                <div class="af-profile-name">
                    <h1>${esc(r.name)}</h1>
                    <div class="af-profile-meta">
                        ${r.city || r.country ? `<span>${ICON.pin}${esc([r.city, r.country].filter(Boolean).join(' · '))}</span>` : ''}
                        <span>${ICON.shield}Rescatista independiente</span>
                    </div>
                </div>
                <div style="display:flex;gap:8px;padding-bottom:8px">
                    ${socials.map((s) => `<a class="af-icon-btn" href="${esc(s[1])}" target="_blank" rel="noopener" aria-label="${s[0]}" title="${s[0]}">${s[2]}</a>`).join('')}
                    <button type="button" class="af-icon-btn" id="afShare" aria-label="Compartir" title="Compartir">${ICON.share}</button>
                    ${isOwner ? '<a href="/foundation/panel#perfil" class="af-btn af-btn-soft af-btn-sm">Editar</a>' : ''}
                </div>
            </div>
            ${r.bio ? `<p class="af-profile-bio af-in" style="--i:2">${esc(r.bio)}</p>` : ''}
            <div class="af-profile-body">
                <div class="af-in" style="--i:3">
                    ${tabs.length ? `<div class="af-seg af-profile-tabs" id="afTabs" role="tablist">${tabs.map((t) => `<button type="button" class="af-seg-btn${t[0] === st.tab ? ' is-active' : ''}" data-tab="${t[0]}" role="tab">${t[2]}<span class="af-tab-long">${t[1]}</span><span class="af-tab-short">${t[3]}</span></button>`).join('')}</div>` : ''}
                    <div id="afTabPanel"></div>
                </div>
                <aside class="af-card af-summary af-in" style="--i:4" id="afSummary"></aside>
            </div>`;

        const panel = $('#afTabPanel');
        const summary = $('#afSummary');
        const tabsEl = $('#afTabs');
        if (tabsEl) {
            segmented(tabsEl);
            tabsEl.addEventListener('click', (e) => {
                const b = e.target.closest('[data-tab]');
                if (!b || b.dataset.tab === st.tab) return;
                st.tab = b.dataset.tab;
                st.done = null;
                $$('[data-tab]', tabsEl).forEach((x) => x.classList.toggle('is-active', x === b));
                renderPanel(true);
                renderSummary();
            });
        }

        function syncUrl() {
            const p = new URLSearchParams();
            if (st.tab) p.set('tab', st.tab);
            if (st.tab === 'mensual' && st.plan) { p.set('plan', st.plan); if (st.plan === 'custom' && st.custom) p.set('custom', st.custom); }
            if (st.tab === 'apadrina' && st.animal) p.set('animal', st.animal);
            if (st.tab === 'unica') p.set('amount', st.amount === 'custom' ? (st.once || '') : st.amount);
            history.replaceState(null, '', `${location.pathname}?${p}`);
        }

        function renderPanel(animate) {
            let html = '';
            if (!tabs.length) {
                html = emptyBox('Este rescatista aún está preparando su página', 'Vuelve pronto.');
            } else if (st.tab === 'mensual') {
                const plans = r.plans.slice().sort((a, b) => a.amount - b.amount);
                html = `${plans.length ? `<div class="af-plans">${plans.map((p, i) => `
                    <button type="button" class="af-plan${p.featured ? ' is-featured' : ''}${st.plan === p.id ? ' is-picked' : ''} af-in" style="--i:${i}" data-plan="${p.id}" aria-pressed="${st.plan === p.id}">
                        <h4>${esc(p.name)}</h4>
                        <span class="af-price">${money(p.amount, '')}<small>USD/mes</small></span>
                        ${p.description ? `<p>${esc(p.description)}</p>` : ''}
                        ${p.perks && p.perks.length ? `<ul>${p.perks.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
                        <span style="height:20px"></span>
                        <span class="af-plan-radio"></span>
                    </button>`).join('')}</div>` : ''}
                    ${r.allowCustomMonthly ? `
                    <div class="af-custom${st.plan === 'custom' ? ' is-picked' : ''}" data-plan-custom>
                        <span class="af-ic">${ICON.heart}</span>
                        <div class="af-custom-text"><strong>Elige tu monto</strong><span>Desde ${money(r.minCustomMonthly)} al mes</span></div>
                        <div class="af-input-wrap"><span class="af-input-prefix">$</span><input class="af-input has-prefix" id="afCustomMonthly" type="number" min="${r.minCustomMonthly}" step="1" inputmode="decimal" placeholder="${Math.max(r.minCustomMonthly, 8)}" value="${esc(st.custom)}"><span class="af-input-suffix">/mes</span></div>
                    </div>` : ''}`;
            } else if (st.tab === 'apadrina') {
                html = `<div class="af-grid">${sponsorable.map((a, i) => ui.animalCard(a, r, i, {
                    href: false,
                    action: a.status === 'disponible'
                        ? `<button type="button" class="af-btn ${st.animal === a.id ? 'af-btn-coral' : 'af-btn-ghost'} af-btn-sm" data-sponsor="${a.id}">${st.animal === a.id ? 'Elegido' : 'Apadrinar'}</button>`
                        : '<span class="af-badge is-green">Ya tiene padrino</span>',
                })).join('')}</div>`;
            } else if (st.tab === 'unica') {
                const sug = r.oneTime.suggested.slice().sort((a, b) => a - b);
                html = `<div class="af-amounts">${sug.map((v, i) => `<button type="button" class="af-amount${st.amount === String(v) ? ' is-picked' : ''} af-in" style="--i:${i}" data-amount="${v}">$${v}<small>USD</small></button>`).join('')}</div>
                    ${r.oneTime.allowCustom ? `
                    <div class="af-custom${st.amount === 'custom' ? ' is-picked' : ''}" data-once-custom>
                        <span class="af-ic is-coral">${ICON.heart}</span>
                        <div class="af-custom-text"><strong>Otro monto</strong><span>Desde ${money(r.oneTime.min)}</span></div>
                        <div class="af-input-wrap"><span class="af-input-prefix">$</span><input class="af-input has-prefix" id="afOnceCustom" type="number" min="${r.oneTime.min}" step="1" inputmode="decimal" placeholder="20" value="${esc(st.once)}"><span class="af-input-suffix">USD</span></div>
                    </div>` : ''}`;
            }
            panel.innerHTML = html;
            if (animate) { panel.classList.remove('af-panel-fade'); void panel.offsetWidth; panel.classList.add('af-panel-fade'); }
            // al re-pintar sin cambio de pestaña, no repetimos la entrada
            if (!animate) $$('.af-in', panel).forEach((x) => { x.style.animation = 'none'; });
            if (st.tab === 'apadrina' && st.animal && animate) {
                const el = panel.querySelector(`[data-animal="${st.animal}"]`);
                el && el.classList.add('is-picked');
                el && setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 350);
            } else if (st.animal) {
                const el = panel.querySelector(`[data-animal="${st.animal}"]`);
                el && el.classList.add('is-picked');
            }
            syncUrl();
        }

        panel.addEventListener('click', (e) => {
            const p = e.target.closest('[data-plan]');
            if (p) { st.plan = p.dataset.plan; st.done = null; renderPanel(false); renderSummary(); return; }
            const pc = e.target.closest('[data-plan-custom]');
            if (pc && st.plan !== 'custom') { st.plan = 'custom'; st.done = null; renderPanel(false); renderSummary(); const i = $('#afCustomMonthly'); i && i.focus(); return; }
            const s = e.target.closest('[data-sponsor]');
            if (s) { st.animal = st.animal === s.dataset.sponsor ? null : s.dataset.sponsor; st.done = null; renderPanel(false); renderSummary(); return; }
            const a = e.target.closest('[data-amount]');
            if (a) { st.amount = a.dataset.amount; st.done = null; renderPanel(false); renderSummary(); return; }
            const oc = e.target.closest('[data-once-custom]');
            if (oc && st.amount !== 'custom') { st.amount = 'custom'; st.done = null; renderPanel(false); renderSummary(); const i = $('#afOnceCustom'); i && i.focus(); }
        });
        panel.addEventListener('input', (e) => {
            if (e.target.id === 'afCustomMonthly') { st.custom = e.target.value; st.plan = 'custom'; }
            if (e.target.id === 'afOnceCustom') { st.once = e.target.value; st.amount = 'custom'; }
            st.done = null;
            const box = e.target.closest('.af-custom');
            if (box && !box.classList.contains('is-picked')) {
                box.classList.add('is-picked');
                $$('.af-plan.is-picked, .af-amount.is-picked', panel).forEach((x) => x.classList.remove('is-picked'));
            }
            syncUrl();
            renderSummary();
        });

        /** Lo elegido: { type, amount, label, detail, min, error } */
        function selection() {
            if (st.tab === 'mensual') {
                if (st.plan === 'custom') {
                    const v = Number(st.custom);
                    return { type: 'subscription', amount: v || 0, label: 'Suscripción mensual', detail: 'Monto libre', monthly: true, error: !(v >= r.minCustomMonthly) ? `El mínimo es ${money(r.minCustomMonthly)} al mes` : null };
                }
                const p = r.plans.find((x) => x.id === st.plan);
                if (!p) return null;
                return { type: 'subscription', amount: p.amount, label: 'Suscripción mensual', detail: `Plan ${p.name}`, planId: p.id, planName: p.name, monthly: true };
            }
            if (st.tab === 'apadrina') {
                const a = r.animals.find((x) => x.id === st.animal);
                if (!a) return null;
                return { type: 'sponsor', amount: a.sponsorAmount, label: 'Apadrinamiento', detail: `Apadrinas a ${a.name}`, animalId: a.id, animalName: a.name, monthly: true };
            }
            if (st.tab === 'unica') {
                const v = st.amount === 'custom' ? Number(st.once) : Number(st.amount);
                return { type: 'one_time', amount: v || 0, label: 'Donación única', detail: 'Un solo pago', monthly: false, error: !(v >= r.oneTime.min) ? `El mínimo es ${money(r.oneTime.min)}` : null };
            }
            return null;
        }

        let lastTotal = null;
        function renderSummary() {
            if (st.done) {
                const d = st.done;
                summary.innerHTML = `
                    <span class="af-ic" style="width:56px;height:56px;background:linear-gradient(150deg,#4ade80,#16a34a);animation:afPop .5s var(--af-spring)"><svg viewBox="0 0 24 24" style="width:26px;height:26px"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>
                    <h3 style="margin:0;font-size:20px;letter-spacing:-.02em">¡Gracias, ${esc(me.name.split(' ')[0])}!</h3>
                    <p style="margin:0;color:var(--af-muted);font-size:14px">Guardamos tu ${d.label.toLowerCase()} de <strong style="color:var(--af-ink)">${money(d.amount)}${d.monthly ? '/mes' : ''}</strong> para ${esc(r.name)}. Los pagos con tarjeta llegan muy pronto y te avisaremos para completarlo.</p>
                    <a href="/foundation/panel#aportes" class="af-btn af-btn-primary af-btn-block">Ver mis aportes</a>
                    <button type="button" class="af-btn af-btn-ghost af-btn-block" data-again>Hacer otro aporte</button>`;
                $('[data-again]', summary).addEventListener('click', () => { st.done = null; renderSummary(); });
                return;
            }
            const s = selection();
            const total = s && !s.error ? s.amount : 0;
            const cta = st.tab === 'unica' ? 'Donar' : st.tab === 'apadrina' ? 'Apadrinar' : 'Suscribirme';
            summary.innerHTML = `
                <h3 class="af-card-title" style="font-size:17px"><span class="af-ic${st.tab === 'mensual' ? '' : ' is-coral'}">${st.tab === 'mensual' ? ICON.sub : st.tab === 'apadrina' ? ICON.paw : ICON.heart}</span>Tu aporte</h3>
                <div class="af-summary-row"><span>Para</span><strong>${esc(r.name)}</strong></div>
                ${s ? `
                <div class="af-summary-row"><span>Tipo</span><strong>${s.label}</strong></div>
                <div class="af-summary-row"><span>Detalle</span><strong>${esc(s.detail)}</strong></div>
                <div class="af-summary-row"><span>Frecuencia</span><strong>${s.monthly ? 'Cada mes' : 'Una sola vez'}</strong></div>` : `<p class="af-summary-empty">${st.tab === 'apadrina' ? 'Elige al peludo que quieres apadrinar.' : 'Elige un monto.'}</p>`}
                <div class="af-summary-total"><span style="font-weight:650">Total</span><span class="af-price" id="afTotal">${money(total, '')}<small>${s && s.monthly ? 'USD/mes' : 'USD'}</small></span></div>
                ${s && s.error ? `<p class="af-form-error is-show" style="animation:none;margin:0">${esc(s.error)}</p>` : ''}
                <button type="button" class="af-btn af-btn-coral af-btn-lg af-btn-block" id="afContinue" ${!s || s.error ? 'disabled' : ''}>${cta} · Continuar al pago</button>
                <p class="af-summary-note">${ICON.shield}<span>${s && s.monthly ? 'Puedes cancelar cuando quieras. ' : ''}El dinero va directo a ${esc(r.name)}.</span></p>`;
            if (lastTotal !== null && lastTotal !== total) {
                const t = $('#afTotal', summary);
                t && t.classList.add('is-bump');
            }
            lastTotal = total;
            const btn = $('#afContinue', summary);
            btn && btn.addEventListener('click', () => submit(s));
        }

        function submit(s) {
            if (!s || s.error) return;
            const user = session.get();
            if (!user) {
                syncUrl();
                toast('Inicia sesión o crea tu cuenta para continuar', 'info');
                setTimeout(() => location.assign(`/foundation/login?next=${encodeURIComponent(location.pathname + location.search)}`), 700);
                return;
            }
            if (user.rescuerId === r.id) { toast('No puedes apoyar tu propia página', 'error'); return; }
            if (s.type === 'sponsor' && store.pledgesByDonor(user.id).some((p) => p.type === 'sponsor' && p.animalId === s.animalId)) {
                toast(`Ya apadrinas a ${s.animalName}`, 'info'); return;
            }
            // TODO pagos: aquí se creará la sesión de cobro (suscripción o pago único)
            AF.store.addPledge({
                donorId: user.id, donorName: user.name,
                rescuerId: r.id, rescuerName: r.name, rescuerSlug: r.slug,
                type: s.type, amount: s.amount, currency: r.currency || 'USD',
                planId: s.planId || null, planName: s.planName || null,
                animalId: s.animalId || null, animalName: s.animalName || null,
            });
            toast('Los pagos llegan muy pronto. Guardamos tu aporte.', 'info');
            st.done = s;
            renderSummary();
            if (window.innerWidth < 960) summary.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

        $('#afShare').addEventListener('click', async () => {
            const url = `${location.origin}/foundation/r/${encodeURIComponent(r.slug)}`;
            try {
                if (navigator.share) await navigator.share({ title: r.name, text: `Apoya a ${r.name} en Attomos Foundation`, url });
                else { await navigator.clipboard.writeText(url); toast('Enlace copiado'); }
            } catch (_) { /* cancelado */ }
        });

        renderPanel(false);
        renderSummary();
        if (st.tab === 'apadrina' && st.animal) {
            const el = panel.querySelector(`[data-animal="${st.animal}"]`);
            el && setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 500);
        }
    }
})();
