// ============================================
// ADMIN · BLOG (lista)
// Filtros, borrar, categorías y etiquetas.
// ============================================
(function () {
    const $ = (s, r) => (r || document).querySelector(s);
    const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

    // ── Toast ──
    let toastTimer;
    function toast(msg, isError) {
        const el = $('#toast');
        if (!el) return;
        el.textContent = msg;
        el.classList.toggle('error', !!isError);
        el.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
    }

    // ── Confirmación ──
    function confirmBox({ title, html, okText, danger }) {
        const modal = $('#confirmModal');
        if (!modal) return Promise.resolve(window.confirm(title));
        $('#confirmTitle').textContent = title;
        $('#confirmText').innerHTML = html || '';
        const ok = $('#confirmOk');
        ok.textContent = okText || 'Aceptar';
        ok.classList.toggle('btn-danger', !!danger);
        modal.classList.add('open');
        return new Promise(resolve => {
            function done(v) {
                modal.classList.remove('open');
                ok.removeEventListener('click', yes);
                $('#confirmCancel').removeEventListener('click', no);
                modal.removeEventListener('click', back);
                document.removeEventListener('keydown', esc);
                resolve(v);
            }
            const yes = () => done(true);
            const no = () => done(false);
            const back = e => { if (e.target === modal) done(false); };
            const esc = e => { if (e.key === 'Escape') done(false); };
            ok.addEventListener('click', yes);
            $('#confirmCancel').addEventListener('click', no);
            modal.addEventListener('click', back);
            document.addEventListener('keydown', esc);
        });
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    async function api(method, url, body) {
        const opts = { method, credentials: 'include', headers: {} };
        if (body !== undefined) {
            opts.headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(body);
        }
        const res = await fetch(url, opts);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Algo salió mal. Intenta de nuevo.');
        return data;
    }

    // ── Filtros de tabla (búsqueda + estado/categoría) ──
    function initFilters() {
        const rows = $$('#bpRows tr');
        if (!rows.length) return;
        const search = $('#bpSearch');
        const cat = $('#bpCategory');
        const empty = $('#bpEmpty');
        let status = '';

        function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

        function apply() {
            const q = norm(search && search.value);
            const c = cat ? cat.value : '';
            let shown = 0;
            rows.forEach(tr => {
                const ok = (!q || norm(tr.dataset.search).includes(q))
                    && (!status || tr.dataset.status === status)
                    && (!c || tr.dataset.cat === c);
                tr.hidden = !ok;
                if (ok) shown++;
            });
            if (empty) empty.hidden = shown > 0;
        }

        search && search.addEventListener('input', apply);
        cat && cat.addEventListener('change', apply);
        $$('.stat-card[data-filter]').forEach(card => {
            card.addEventListener('click', () => {
                status = card.dataset.filter;
                $$('.stat-card[data-filter]').forEach(c => c.classList.toggle('filter-active', c === card));
                apply();
            });
        });
    }

    // ── Acciones de artículos ──
    function initPostActions() {
        const tbody = $('#bpRows');
        if (!tbody) return;
        tbody.addEventListener('click', async e => {
            const btn = e.target.closest('button[data-action]');
            if (!btn) return;
            const tr = btn.closest('tr');
            const id = tr.dataset.id;
            const title = btn.dataset.title;

            if (btn.dataset.action === 'delete') {
                const ok = await confirmBox({
                    title: 'Eliminar artículo',
                    html: `Se borrará <strong>${esc(title)}</strong> y su portada. Esta acción no se puede deshacer.`,
                    okText: 'Eliminar', danger: true
                });
                if (!ok) return;
                try {
                    await api('DELETE', `/admin/api/blog/${id}`);
                    tr.remove();
                    toast('Artículo eliminado');
                } catch (err) { toast(err.message, true); }
            }
        });
    }

    // ── Categorías / etiquetas ──
    function initTaxonomy() {
        const pairs = [
            { form: '#catForm', list: '#catList', url: '/admin/api/blog-categorias', kind: 'categoria' },
            { form: '#tagForm', list: '#tagList', url: '/admin/api/blog-etiquetas', kind: 'etiqueta' }
        ];
        pairs.forEach(p => {
            const form = $(p.form);
            const list = $(p.list);
            if (!form || !list) return;

            form.addEventListener('submit', async e => {
                e.preventDefault();
                const fd = new FormData(form);
                const body = { name: (fd.get('name') || '').trim(), icon: fd.get('icon') || '' };
                if (!body.name) return;
                try {
                    const item = await api('POST', p.url, body);
                    const id = item.id || item.ID;
                    const name = item.name || item.Name;
                    const icon = item.icon || item.Icon;
                    const empty = list.querySelector('.chip-empty');
                    if (empty) empty.remove();
                    const chip = document.createElement('span');
                    chip.className = 'chip';
                    chip.dataset.id = id;
                    chip.innerHTML = (p.kind === 'categoria' ? `<i class="lni ${esc(icon)}"></i>` : '#') + esc(name) +
                        `<button type="button" class="chip-del" data-kind="${p.kind}" data-name="${esc(name)}" aria-label="Eliminar ${esc(name)}"><i class="lni lni-close"></i></button>`;
                    list.appendChild(chip);
                    form.reset();
                    toast(p.kind === 'categoria' ? 'Categoría creada' : 'Etiqueta creada');
                } catch (err) { toast(err.message, true); }
            });

            list.addEventListener('click', async e => {
                const del = e.target.closest('.chip-del');
                if (!del) return;
                const chip = del.closest('.chip');
                const isCat = del.dataset.kind === 'categoria';
                const ok = await confirmBox({
                    title: isCat ? 'Eliminar categoría' : 'Eliminar etiqueta',
                    html: isCat
                        ? `Los artículos de <strong>${esc(del.dataset.name)}</strong> se quedarán sin categoría.`
                        : `Se quitará <strong>#${esc(del.dataset.name)}</strong> de todos los artículos.`,
                    okText: 'Eliminar', danger: true
                });
                if (!ok) return;
                try {
                    await api('DELETE', `${p.url}/${chip.dataset.id}`);
                    chip.remove();
                    if (!list.querySelector('.chip')) list.innerHTML = `<span class="chip-empty">Sin ${isCat ? 'categorías' : 'etiquetas'}.</span>`;
                } catch (err) { toast(err.message, true); }
            });
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        initFilters();
        initPostActions();
        initTaxonomy();
    });
})();