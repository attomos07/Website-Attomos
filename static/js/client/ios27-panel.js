// ============================================================================
// CAPA iOS 27 — Inventario · Punto de venta · Mis citas · Laboratorio
// La misma capa de Mis Pedidos / Mi Negocio para las vistas que vienen de
// Avante. No cambia la lógica de cada página: solo observa clases y nodos
// nuevos y les pone el movimiento. Va con ios27-panel.css.
//   1. Entrada de la página escalonada (resorte + desenfoque)
//   2. Números de las tarjetas que cuentan hasta su valor
//   3. Segmentados: cápsula con resorte que se estira al moverse
//   4. Menús: cápsula que sigue al cursor
//   5. Renglones y tarjetas nuevas que entran escalonadas
// ============================================================================
(function () {
    'use strict';
    if (window.__attomosIosPanel) return;
    window.__attomosIosPanel = true;
    if (!document.body || !document.body.classList.contains('inv-body')) return;

    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    function clamp(v, a, b) { a = a === undefined ? 0 : a; b = b === undefined ? 1 : b; return Math.min(b, Math.max(a, v)); }

    // --- Motor de resortes (igual que en orders.js) ---
    var springs = new Set();
    var renderers = new Set();
    function spring(v, k, d, eps) {
        var s = { v: v || 0, vel: 0, t: v || 0, k: k || 380, d: d || 30, eps: eps || 0.1 };
        springs.add(s);
        return s;
    }
    function atRest(s) { return Math.abs(s.v - s.t) < s.eps && Math.abs(s.vel) < s.eps * 5; }
    var raf = null, last = 0;
    function tick(now) {
        var dt = Math.min((now - last) / 1000, 1 / 30);
        last = now;
        springs.forEach(function (s) {
            if (reduce.matches) { s.v = s.t; s.vel = 0; return; }
            s.vel += (-s.k * (s.v - s.t) - s.d * s.vel) * dt;
            s.v += s.vel * dt;
        });
        renderers.forEach(function (r) { r(); });
        var rest = true;
        springs.forEach(function (s) { if (!atRest(s)) rest = false; });
        if (rest) {
            springs.forEach(function (s) { s.v = s.t; s.vel = 0; });
            renderers.forEach(function (r) { r(); });
            raf = null;
            return;
        }
        raf = requestAnimationFrame(tick);
    }
    function kick() {
        if (raf) return;
        last = performance.now();
        raf = requestAnimationFrame(tick);
    }

    function visible(el) {
        return el && !el.hidden && el.offsetParent !== null && getComputedStyle(el).display !== 'none';
    }

    // ====================================================================
    // 1. ENTRADA DE LA PÁGINA
    // ====================================================================
    // Contenedores cuyas piezas entran una por una (y no como un bloque).
    var SPLIT = '.admin-header, .page-header, .inv-stats, .vt-stats, .stats-grid, .inv-layout, .pos-layout, .tkp-layout, .lab-head-row';
    var SKIP = '.admin-modal-overlay, script, template, style, .inv-subnav';

    function rise(elements, startAt) {
        var i = startAt || 0;
        elements.forEach(function (el) {
            if (!el) return;
            el.classList.remove('ios-in');
            void el.offsetWidth;
            el.style.setProperty('--i', Math.min(i++, 10));
            el.classList.add('ios-in');
        });
        return i;
    }
    function entranceParts(main) {
        var out = [];
        function walk(el, depth) {
            Array.prototype.forEach.call(el.children, function (c) {
                if (c.matches(SKIP) || !visible(c)) return;
                if (depth < 2 && c.matches(SPLIT)) {
                    // El subnav no entra: es la referencia fija entre pestañas.
                    if (c.querySelector(':scope > .inv-subnav') || c.matches('.admin-header, .page-header')) {
                        Array.prototype.forEach.call(c.children, function (h) {
                            if (h.matches(SKIP) || !visible(h)) return;
                            out.push(h);
                        });
                        return;
                    }
                    walk(c, depth + 1);
                    return;
                }
                out.push(c);
            });
        }
        walk(main, 0);
        return out;
    }
    function pageEntrance() {
        var main = document.querySelector('main.inv-page');
        if (!main) return;
        // Si llegó desde otra pestaña de sección, subnav-tabs.js ya hace su entrada.
        if (main.classList.contains('subnav-enter')) return;
        rise(entranceParts(main));
        document.addEventListener('animationend', function (e) {
            if (e.animationName === 'iosRiseMove' && e.target.classList.contains('ios-in')) {
                e.target.classList.remove('ios-in');
                e.target.style.removeProperty('--i');
            }
        });
    }

    // ====================================================================
    // 2. NÚMEROS DE LAS TARJETAS (también montos con $)
    // ====================================================================
    // Mis citas (.num) y Ventas (vtSt*) ya cuentan sus números: aquí se dejan en paz.
    var STAT_SEL = '.inv-stat strong, .vt-stat strong:not([id^="vtSt"])';
    var counting = new WeakSet();
    var shownByKey = {};
    function parseStat(text) {
        var raw = (text || '').trim();
        if (/^\d{1,9}$/.test(raw)) return { n: parseInt(raw, 10), money: false };
        var m = /^(-?)\$\s?([\d,]+(?:\.\d+)?)$/.exec(raw);
        if (m) return { n: (m[1] ? -1 : 1) * parseFloat(m[2].replace(/,/g, '')), money: true, commas: raw.indexOf(',') >= 0 || parseFloat(m[2].replace(/,/g, '')) >= 1000, dec: (m[2].split('.')[1] || '').length };
        return null;
    }
    function formatStat(n, info) {
        if (!info.money) return String(Math.round(n));
        var abs = Math.abs(n), d = info.dec;
        var txt = info.commas
            ? abs.toLocaleString('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d })
            : abs.toFixed(d);
        return (n < 0 ? '-$' : '$') + txt;
    }
    function countTo(el, from, to, info) {
        if (from === to || reduce.matches) return;
        counting.add(el);
        var final = el.textContent;
        var start = performance.now(), dur = 750;
        var wrote = formatStat(from, info);
        el.textContent = wrote;
        (function frame(now) {
            if (!el.isConnected) { counting.delete(el); return; }
            // La página escribió otro valor a la mitad: se respeta y se cuenta de nuevo.
            if (el.textContent !== wrote) { counting.delete(el); queue(pendingStats, el); return; }
            var t = clamp((now - start) / dur);
            var e = 1 - Math.pow(1 - t, 3);
            if (t < 1) {
                wrote = formatStat(from + (to - from) * e, info);
                el.textContent = wrote;
                requestAnimationFrame(frame);
            } else {
                el.textContent = final;
                requestAnimationFrame(function () { counting.delete(el); });
            }
        })(start);
    }
    function statKey(el) {
        if (el.id) return '#' + el.id;
        var card = el.closest('.inv-stat, .vt-stat, .stat-card');
        var label = card && card.querySelector('small, .stat-label');
        var box = card && card.parentElement;
        return (box && box.id ? box.id : '') + '|' + (label ? label.textContent.trim() : '');
    }
    function checkStat(el) {
        if (counting.has(el)) return;
        var info = parseStat(el.textContent);
        if (!info) return;
        var key = statKey(el);
        var prev = shownByKey[key];
        shownByKey[key] = info.n;
        // La primera vez cuenta desde 0; después, desde el valor anterior.
        if (prev === undefined) prev = 0;
        if (prev !== info.n) countTo(el, prev, info.n, info);
    }

    // ====================================================================
    // 3. SEGMENTADOS: cápsula que se desliza y se estira
    // ====================================================================
    // [selector del grupo, tono]. El botón activo lleva .is-on o .active.
    var SEGMENTS = [
        ['.inv-seg:not(.inv-subnav)', 'tint'],
        ['.vt-seg', 'tint'],
        ['.cf-seg', 'tint'],
        ['#labOrigen', 'tint'],
        ['.view-switch', 'tint'],
        ['.inv-tabs', 'tint'],
        ['.tkp-seg', 'light'],
        ['.cc-subtabs', 'line'],
    ];
    var SEG_SEL = SEGMENTS.map(function (s) { return s[0]; }).join(', ');
    var segments = new WeakSet();

    function activeIn(group) {
        return group.querySelector(':scope > .is-on, :scope > .active');
    }
    function segmentFor(group, tone) {
        if (segments.has(group)) return;
        segments.add(group);
        group.classList.add('ios-seg', 'ios-seg-' + tone);
        var thumb = document.createElement('span');
        thumb.className = 'ios-seg-thumb';
        thumb.setAttribute('aria-hidden', 'true');
        group.insertBefore(thumb, group.firstChild);

        var X = spring(0, 440, 30), Y = spring(0, 440, 30), W = spring(0, 440, 30), H = spring(0, 440, 30);
        var S = spring(1, 600, 30, 0.001);
        var ready = false, radiusFor = null;

        function place(snap) {
            var a = activeIn(group);
            if (!a || !group.offsetWidth || !a.offsetWidth) { ready = false; render(); return; }
            if (radiusFor !== a) {
                radiusFor = a;
                if (tone !== 'line') thumb.style.borderRadius = getComputedStyle(a).borderRadius || '999px';
            }
            X.t = a.offsetLeft; W.t = a.offsetWidth;
            if (tone === 'line') { Y.t = a.offsetTop + a.offsetHeight - 2.5; H.t = 2.5; }
            else { Y.t = a.offsetTop; H.t = a.offsetHeight; }
            if (snap || !ready) {
                [X, Y, W, H].forEach(function (s) { s.v = s.t; s.vel = 0; });
            }
            ready = true;
            render();
            kick();
        }
        function render() {
            if (!group.isConnected) {
                // Pestaña guardada por subnav-tabs.js: vuelve a aparecer después.
                if (group.closest('[data-subnav-parked]')) return;
                renderers.delete(render);
                [X, Y, W, H, S].forEach(function (s) { springs.delete(s); });
                return;
            }
            if (!ready) { thumb.style.opacity = 0; return; }
            var st = Math.min(Math.abs(X.vel) / 2600, 0.16);
            thumb.style.opacity = 1;
            thumb.style.width = W.v + 'px';
            thumb.style.height = H.v + 'px';
            thumb.style.transform = 'translate(' + X.v + 'px, ' + Y.v + 'px) scale(' + (S.v * (1 + st)) + ', ' + (S.v * (1 - st * 0.4)) + ')';
        }
        renderers.add(render);

        // La lógica de la página cambia .is-on / .active; aquí solo se sigue.
        new MutationObserver(function () { place(false); })
            .observe(group, { subtree: true, attributes: true, attributeFilter: ['class'], childList: true });
        group.addEventListener('pointerdown', function (e) {
            if (e.target.closest('.is-on, .active') && tone !== 'line') { S.t = 0.94; kick(); }
        });
        function release() { S.t = 1; kick(); }
        ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) { group.addEventListener(ev, release); });
        if (window.ResizeObserver) new ResizeObserver(function () { place(true); }).observe(group);
        place(true);
    }
    function enhanceSegments(root) {
        SEGMENTS.forEach(function (pair) {
            if (root.matches && root.matches(pair[0])) segmentFor(root, pair[1]);
            if (root.querySelectorAll) root.querySelectorAll(pair[0]).forEach(function (g) { segmentFor(g, pair[1]); });
        });
    }

    // ====================================================================
    // 4. MENÚS: cápsula que sigue al cursor
    // ====================================================================
    var MENUS = [
        ['.av-select-menu', '.av-select-option'],
        ['.admin-role-select-menu', '.admin-role-option'],
        ['.time-picker-menu', '.time-picker-option'],
        ['.row-menu-dropdown', '.row-menu-item'],
    ];
    var MENU_SEL = MENUS.map(function (m) { return m[0]; }).join(', ');
    var menus = new WeakMap();

    function menuFor(menu) {
        if (menus.has(menu)) return menus.get(menu);
        var itemSel = null;
        MENUS.forEach(function (m) { if (!itemSel && menu.matches(m[0])) itemSel = m[1]; });
        if (!itemSel) return null;
        menu.classList.add('ios-dd-on');
        var ind = document.createElement('span');
        ind.className = 'ios-dd-ind';
        ind.setAttribute('aria-hidden', 'true');

        var X = spring(0, 520, 36), Y = spring(0, 520, 36), W = spring(0, 520, 36), H = spring(0, 520, 36);
        var V = spring(0, 600, 44, 0.001);
        var hovered = null;

        function render() {
            if (!menu.isConnected) {
                if (menu.closest('[data-subnav-parked]')) return;
                renderers.delete(render);
                [X, Y, W, H, V].forEach(function (s) { springs.delete(s); });
                menus.delete(menu);
                return;
            }
            var st = Math.min(Math.abs(Y.vel) / 1800, 0.2);
            ind.style.width = W.v + 'px';
            ind.style.height = H.v + 'px';
            ind.style.opacity = clamp(V.v);
            ind.style.transform = 'translate(' + X.v + 'px, ' + Y.v + 'px) scale(' + (1 - st * 0.2) + ', ' + (1 + st) + ')';
        }
        renderers.add(render);

        function hoverTo(item) {
            if (item === hovered) return;
            if (hovered) hovered.classList.remove('ios-hover');
            hovered = item;
            if (!item) { V.t = 0; kick(); return; }
            // La lista se pudo volver a pintar: se repone la cápsula.
            if (ind.parentNode !== menu) menu.insertBefore(ind, menu.firstChild);
            item.classList.add('ios-hover');
            ind.dataset.tone = item.classList.contains('delete') ? 'danger' : '';
            X.t = item.offsetLeft; Y.t = item.offsetTop; W.t = item.offsetWidth; H.t = item.offsetHeight; V.t = 1;
            if (V.v < 0.05) { X.v = X.t; Y.v = Y.t; W.v = W.t; H.v = H.t; }
            kick();
        }
        menu.addEventListener('pointermove', function (e) {
            if (e.pointerType === 'touch') return;
            var item = e.target.closest(itemSel);
            if (item && menu.contains(item) && !item.disabled) hoverTo(item);
        });
        menu.addEventListener('pointerleave', function () { hoverTo(null); });
        menu.addEventListener('click', function () { hoverTo(null); });
        var api = { hoverTo: hoverTo };
        menus.set(menu, api);
        return api;
    }
    // Los menús se arman al abrirse: se preparan al pasar el cursor.
    document.addEventListener('pointerover', function (e) {
        var m = e.target.closest && e.target.closest(MENU_SEL);
        if (m) menuFor(m);
    }, true);

    // ====================================================================
    // 5. RENGLONES Y TARJETAS QUE ENTRAN
    // Solo entran las piezas nuevas: si la lista se vuelve a pintar igual
    // (al seleccionar un renglón, por ejemplo) no se mueve nada.
    // ====================================================================
    var LISTS = [
        ['tbody', 'ios-row'],
        ['.pos-grid', 'ios-row'],
        ['.pos-lines', 'ios-item-in'],
        ['.inv-dep-list', 'ios-row'],
        ['.inv-rs-list', 'ios-row'],
        ['.csl-results', 'ios-row'],
        ['.day-view-list', 'ios-row'],
        ['.day-events-list', 'ios-row'],
        ['.lab-board', 'ios-row'],
        ['.pos-client-list', 'ios-row'],
        ['.vt-stats', 'ios-row'],
        ['.cal-grid', 'ios-cell'],
    ];
    var LIST_SEL = LISTS.map(function (l) { return l[0]; }).join(', ');
    var seen = new WeakMap();
    var MAX_ANIM = 24;

    function sig(el) {
        var t = (el.textContent || '').replace(/\s+/g, ' ').trim();
        var key = el.getAttribute('data-date') || el.getAttribute('data-id') || '';
        return el.tagName + key + ':' + (t.length > 160 ? t.slice(0, 160) + t.length : t);
    }
    function classFor(list) {
        for (var i = 0; i < LISTS.length; i++) if (list.matches(LISTS[i][0])) return LISTS[i][1];
        return 'ios-row';
    }
    function processList(list) {
        if (!list.isConnected || !list.closest('main.inv-page, .admin-modal-overlay')) return;
        var prev = seen.get(list);
        var kids = Array.prototype.filter.call(list.children, function (c) { return c.nodeType === 1 && !c.classList.contains('ios-dd-ind'); });
        var now = new Map();
        kids.forEach(function (c) { var s = sig(c); now.set(s, (now.get(s) || 0) + 1); });
        seen.set(list, now);
        if (reduce.matches) return;
        // Calendario: solo cuando cambia el mes completo.
        var cls = classFor(list);
        var fresh = [];
        var budget = prev ? new Map(prev) : new Map();
        kids.forEach(function (c) {
            var s = sig(c), n = budget.get(s) || 0;
            if (n > 0) { budget.set(s, n - 1); return; }
            fresh.push(c);
        });
        if (!fresh.length) return;
        // Un solo renglón vacío/cargando no se anima.
        if (fresh.length === 1 && /cargando|sin |no hay/i.test(fresh[0].textContent || '') && cls === 'ios-row') return;
        if (cls === 'ios-cell' && prev && fresh.length < kids.length / 2) {
            // Mismo mes con citas nuevas: solo esos días hacen un pequeño "pop".
            fresh.forEach(function (c) { c.classList.remove('ios-cell'); void c.offsetWidth; c.style.setProperty('--r', 0); c.classList.add('ios-cell'); });
            return;
        }
        var r = 0;
        fresh.slice(0, cls === 'ios-cell' ? 60 : MAX_ANIM).forEach(function (c) {
            c.classList.remove('ios-row', 'ios-cell', 'ios-item-in');
            void c.offsetWidth;
            c.style.setProperty('--r', r++);
            c.classList.add(cls);
        });
    }
    var pendingLists = new Set(), pendingStats = new Set(), flushQueued = false;
    function queue(set, el) {
        set.add(el);
        if (flushQueued) return;
        flushQueued = true;
        requestAnimationFrame(function () {
            flushQueued = false;
            var ls = Array.from(pendingLists), ss = Array.from(pendingStats);
            pendingLists.clear(); pendingStats.clear();
            ls.forEach(processList);
            ss.forEach(checkStat);
        });
    }
    document.addEventListener('animationend', function (e) {
        var n = e.animationName, t = e.target;
        if (n === 'iosRowIn') {
            var row = t.tagName === 'TD' ? t.parentElement : t;
            if (row && row.classList.contains('ios-row') && (t.tagName !== 'TD' || t === row.lastElementChild)) {
                row.classList.remove('ios-row'); row.style.removeProperty('--r');
            }
        } else if (n === 'iosCellIn' || n === 'iosItemIn') {
            t.classList.remove('ios-cell', 'ios-item-in'); t.style.removeProperty('--r');
        }
    });

    // ====================================================================
    // OBSERVADOR GENERAL: segmentados, listas y números que aparecen
    // ====================================================================
    function scan(root) {
        if (!root || root.nodeType !== 1) return;
        enhanceSegments(root);
        if (root.matches(LIST_SEL)) queue(pendingLists, root);
        root.querySelectorAll(LIST_SEL).forEach(function (l) { queue(pendingLists, l); });
        if (root.matches(STAT_SEL)) queue(pendingStats, root);
        root.querySelectorAll(STAT_SEL).forEach(function (s) { queue(pendingStats, s); });
    }
    function watch() {
        new MutationObserver(function (records) {
            records.forEach(function (rec) {
                var t = rec.target.nodeType === 1 ? rec.target : rec.target.parentElement;
                if (!t) return;
                if (t.closest && t.closest('.ios-seg-thumb, .ios-dd-ind')) return;
                if (rec.type === 'characterData' || rec.type === 'childList') {
                    var stat = t.closest(STAT_SEL);
                    if (stat) queue(pendingStats, stat);
                }
                if (rec.type !== 'childList') return;
                if (t.matches(LIST_SEL)) queue(pendingLists, t);
                rec.addedNodes.forEach(function (n) { if (n.nodeType === 1) scan(n); });
            });
        }).observe(document.body, { childList: true, subtree: true, characterData: true });
    }

    function init() {
        enhanceSegments(document);
        pageEntrance();
        // Primeros datos: los números cuentan desde 0 y las listas entran.
        document.querySelectorAll(STAT_SEL).forEach(function (s) { queue(pendingStats, s); });
        document.querySelectorAll(LIST_SEL).forEach(function (l) {
            // Lo que ya viene pintado del servidor no se vuelve a animar.
            seen.set(l, (function () {
                var m = new Map();
                Array.prototype.forEach.call(l.children, function (c) { var s = sig(c); m.set(s, (m.get(s) || 0) + 1); });
                return m;
            })());
        });
        watch();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();