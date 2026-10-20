// ============================================
// FLOWS.JS — Lista + Editor Canvas (Miro-style)
// ============================================

(function () {
    if (!document.getElementById('flowModal') && !document.getElementById('canvasOverlay')) return;

    // ── Estado global ─────────────────────────────────────────────
    let flows      = [];
    let filterState = 'all';

    // ── Estado del canvas ─────────────────────────────────────────
    let canvasFlow   = null;   // flujo que se está editando
    let nodes        = [];     // [{id, type, x, y, w, h, data:{}}]
    let connections  = [];     // [{id, from, fromPort, to, toPort}]
    let selectedNode = null;
    let dragging     = null;   // {node, ox, oy}
    let connecting   = null;   // {fromNode, fromPort, mx, my}
    let pan          = {x: 0, y: 0};
    let panDragging  = false;
    let panStart     = {x: 0, y: 0};
    let zoom         = 1;
    let nodeCounter  = 0;
    let connCounter  = 0;

    const NODE_W     = 220;
    const NODE_H_BASE = 80;
    const PORT_R     = 8;

    // Colores por tipo de nodo
    const NODE_COLORS = {
        message: { bg: '#e0f9ff', border: '#06b6d4', icon: '#06b6d4', label: 'Mensaje' },
        options:  { bg: '#ede9fe', border: '#8b5cf6', icon: '#8b5cf6', label: 'Opciones' },
        condition:{ bg: '#fef3c7', border: '#f59e0b', icon: '#f59e0b', label: 'Condición' },
        action:   { bg: '#d1fae5', border: '#10b981', icon: '#10b981', label: 'Acción' },
        delay:    { bg: '#f1f5f9', border: '#94a3b8', icon: '#94a3b8', label: 'Pausa' },
    };

    // ── DOM Refs — Lista ──────────────────────────────────────────
    const btnNewFlow      = document.getElementById('btnNewFlow');
    const btnNewFlowEmpty = document.getElementById('btnNewFlowEmpty');
    const flowsTableBody  = document.getElementById('flowsTableBody');
    const flowsTableWrap  = document.getElementById('flowsTableWrap');
    const flowsEmpty      = document.getElementById('flowsEmpty');

    // ── DOM Refs — Canvas ─────────────────────────────────────────
    const canvasOverlay   = document.getElementById('canvasOverlay');
    const svgEl           = document.getElementById('flowCanvas');
    const svgG            = document.getElementById('canvasGroup');
    const canvasFlowName  = document.getElementById('canvasFlowName');
    const btnCloseCanvas  = document.getElementById('btnCloseCanvas');
    const btnSaveDraft    = document.getElementById('btnSaveDraftCanvas');
    const btnPublish      = document.getElementById('btnPublishCanvas');
    const btnZoomIn       = document.getElementById('btnZoomIn');
    const btnZoomOut      = document.getElementById('btnZoomOut');
    const zoomLabel       = document.getElementById('zoomLabel');
    const propsPanel      = document.getElementById('propsPanel');
    const propsClose      = document.getElementById('propsClose');
    const propsBody       = document.getElementById('propsBody');

    // ── Toast ─────────────────────────────────────────────────────
    function showToast(msg, type = 'info') {
        const existing = document.querySelector('.flows-toast');
        if (existing) existing.remove();
        const icons = {
            success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>',
            error:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
            info:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/></svg>',
        };
        const t = document.createElement('div');
        t.className = `flows-toast ${type}`;
        t.innerHTML = (icons[type] || icons.info) + `<span>${msg}</span>`;
        document.body.appendChild(t);
        requestAnimationFrame(() => t.classList.add('show'));
        setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 3000);
    }

    // ── Cargar flujos ─────────────────────────────────────────────
    async function loadFlows() {
        try {
            const res = await fetch('/api/flows', { credentials: 'include' });
            if (!res.ok) throw new Error();
            flows = await res.json();
        } catch (_) { flows = []; }
        renderTable();
    }


    function renderTable() {
        const filtered = filterState === 'all' ? flows : flows.filter(f => f.status === filterState);
        if (filtered.length === 0) {
            flowsTableWrap.style.display = 'none';
            flowsEmpty.style.display = 'flex';
            return;
        }
        flowsTableWrap.style.display = '';
        flowsEmpty.style.display = 'none';
        flowsTableBody.innerHTML = filtered.map(f => {
            const bc = f.status === 'active' ? 'badge-active' : f.status === 'draft' ? 'badge-draft' : 'badge-paused';
            const bl = f.status === 'active' ? 'Activo' : f.status === 'draft' ? 'Borrador' : 'Pausado';
            const ctr = f.sent ? Math.round((f.clicked / f.sent) * 100) : 0;
            return `<tr data-id="${f.id}">
                <td><div class="flow-name-cell"><span class="flow-name">${esc(f.name)}</span><span class="flow-trigger-badge">${esc(f.trigger || '—')}</span></div></td>
                <td><span class="badge ${bc}">${bl}</span></td>
                <td class="metric-cell">${esc(f.trigger || '—')}</td>
                <td class="metric-cell">${(f.sent||0).toLocaleString('es-MX')}</td>
                <td class="metric-cell">${(f.delivered||0).toLocaleString('es-MX')}</td>
                <td class="ctr-cell">${ctr}%</td>
                <td><div class="row-actions">
                    <button class="row-btn" title="Editar" data-action="edit" data-id="${f.id}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button class="row-btn" title="${f.status==='active'?'Pausar':'Activar'}" data-action="toggle" data-id="${f.id}">
                        ${f.status==='active'
                            ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>'
                            : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>'}
                    </button>
                    <button class="row-btn danger" title="Eliminar" data-action="delete" data-id="${f.id}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                    </button>
                </div></td>
            </tr>`;
        }).join('');
    }

    // ── Acciones tabla ────────────────────────────────────────────
    flowsTableBody?.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const id = btn.dataset.id;
        const action = btn.dataset.action;
        if (action === 'edit')   { const f = flows.find(x => String(x.id) === id); openCanvas(f); }
        if (action === 'toggle') { await toggleFlow(id); }
        if (action === 'delete') { if (confirm('¿Eliminar este flujo?')) await deleteFlow(id); }
    });

    async function toggleFlow(id) {
        try {
            const res = await fetch(`/api/flows/${id}/toggle`, { method: 'POST', credentials: 'include' });
            if (!res.ok) throw new Error();
            await loadFlows(); showToast('Estado actualizado', 'success');
        } catch (_) { showToast('Error al actualizar', 'error'); }
    }

    async function deleteFlow(id) {
        try {
            const res = await fetch(`/api/flows/${id}`, { method: 'DELETE', credentials: 'include' });
            if (!res.ok) throw new Error();
            flows = flows.filter(f => String(f.id) !== id);
            renderStats(); renderTable(); showToast('Flujo eliminado', 'success');
        } catch (_) { showToast('Error al eliminar', 'error'); }
    }

    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            filterState = btn.dataset.filter;
            renderTable();
        });
    });

    // ══════════════════════════════════════════
    // CANVAS EDITOR
    // ══════════════════════════════════════════

    function openCanvas(flow) {
        canvasFlow = flow || { id: null, name: 'Nuevo flujo', status: 'draft', nodes: [], connections: [] };
        canvasFlowName.value  = canvasFlow.name;
        const triggerInput = document.getElementById('canvasFlowTrigger');
        if (triggerInput) triggerInput.value = canvasFlow.trigger || '';
        nodes = parseNodes(canvasFlow.nodes);
        connections = parseConnections(canvasFlow.connections);
        pan = { x: 0, y: 0 };
        zoom = 1;
        selectedNode = null;
        closeProps();
        if (!nodes.length) addStarterNode();
        render();
        canvasOverlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeCanvas() {
        canvasOverlay.classList.remove('active');
        document.body.style.overflow = '';
    }

    function parseNodes(raw) {
        if (!raw || !Array.isArray(raw)) return [];
        return raw.map(n => ({ ...n }));
    }
    function parseConnections(raw) {
        if (!raw || !Array.isArray(raw)) return [];
        return raw.map(c => ({ ...c }));
    }

    function addStarterNode() {
        nodes.push({
            id: 'n' + (++nodeCounter),
            type: 'message',
            x: 120, y: 80,
            data: { text: '¡Hola! ¿En qué puedo ayudarte?' }
        });
    }

    // ── Render SVG ────────────────────────────────────────────────
    function render() {
        if (!svgG) return;
        svgG.setAttribute('transform', `translate(${pan.x},${pan.y}) scale(${zoom})`);
        svgG.innerHTML = '';

        // Conexiones
        connections.forEach(c => renderConnection(c));

        // Línea de conexión en curso
        if (connecting) {
            const src = nodes.find(n => n.id === connecting.fromNode);
            if (src) {
                const sp = getPortPos(src, connecting.fromPort);
                const line = makeSVG('line', {
                    x1: sp.x, y1: sp.y,
                    x2: connecting.mx, y2: connecting.my,
                    stroke: '#06b6d4', 'stroke-width': 2,
                    'stroke-dasharray': '6 3',
                    'stroke-linecap': 'round'
                });
                svgG.appendChild(line);
            }
        }

        // Nodos
        nodes.forEach(n => renderNode(n));

        zoomLabel.textContent = Math.round(zoom * 100) + '%';
    }

    function renderConnection(c) {
        const from = nodes.find(n => n.id === c.from);
        const to   = nodes.find(n => n.id === c.to);
        if (!from || !to) return;

        const sp = getPortPos(from, c.fromPort);
        const ep = getPortPos(to, c.toPort || 'in');

        const dx = Math.abs(ep.x - sp.x) * 0.5;
        const path = `M ${sp.x} ${sp.y} C ${sp.x + dx} ${sp.y}, ${ep.x - dx} ${ep.y}, ${ep.x} ${ep.y}`;

        const el = makeSVG('path', {
            d: path, fill: 'none',
            stroke: '#94a3b8', 'stroke-width': 2,
            'stroke-linecap': 'round',
        });
        el.setAttribute('class', 'conn-path');
        el.dataset.connId = c.id;

        // Flecha
        const angle = Math.atan2(ep.y - sp.y, ep.x - sp.x);
        const ax = ep.x - 10 * Math.cos(angle);
        const ay = ep.y - 10 * Math.sin(angle);
        const arrowPoints = `${ep.x},${ep.y} ${ax - 5*Math.sin(angle)},${ay + 5*Math.cos(angle)} ${ax + 5*Math.sin(angle)},${ay - 5*Math.cos(angle)}`;
        const arrow = makeSVG('polygon', { points: arrowPoints, fill: '#94a3b8' });

        // Click para borrar conexión
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm('¿Eliminar esta conexión?')) {
                connections = connections.filter(x => x.id !== c.id);
                render();
            }
        });

        svgG.appendChild(el);
        svgG.appendChild(arrow);
    }

    function renderNode(node) {
        const c = NODE_COLORS[node.type] || NODE_COLORS.message;
        const h = getNodeHeight(node);
        const g = makeSVG('g', {});
        g.dataset.nodeId = node.id;
        g.style.cursor = 'pointer';

        const isSelected = selectedNode === node.id;

        // Sombra / selección
        if (isSelected) {
            const sel = makeSVG('rect', {
                x: node.x - 3, y: node.y - 3,
                width: NODE_W + 6, height: h + 6,
                rx: 14, fill: 'none',
                stroke: c.border, 'stroke-width': 2.5,
                'stroke-dasharray': '0'
            });
            g.appendChild(sel);
        }

        // Cuerpo
        const rect = makeSVG('rect', {
            x: node.x, y: node.y,
            width: NODE_W, height: h,
            rx: 14, fill: c.bg,
            stroke: c.border, 'stroke-width': isSelected ? 2.5 : 1.5,
            filter: isSelected ? '' : 'drop-shadow(0 2px 6px rgba(0,0,0,.08))'
        });
        g.appendChild(rect);

        // Header strip
        const strip = makeSVG('rect', {
            x: node.x, y: node.y,
            width: NODE_W, height: 36,
            rx: 14, fill: c.border
        });
        // Bottom square corners on strip
        const stripCover = makeSVG('rect', {
            x: node.x, y: node.y + 24,
            width: NODE_W, height: 12,
            fill: c.border
        });
        g.appendChild(strip);
        g.appendChild(stripCover);

        // Ícono + label en header (SVG embebido con x/y)
        const icon = getNodeIcon(node.type);
        icon.setAttribute('x', node.x + 10);
        icon.setAttribute('y', node.y + 8);
        g.appendChild(icon);

        const label = makeSVG('text', {
            x: node.x + 36, y: node.y + 22,
            'font-size': 12, 'font-weight': 600,
            fill: '#fff', 'font-family': 'system-ui'
        });
        label.textContent = c.label;
        g.appendChild(label);

        // Contenido según tipo
        renderNodeBody(g, node, h);

        // Puerto de entrada (izquierda)
        const inPort = makeSVG('circle', {
            cx: node.x, cy: node.y + h / 2,
            r: PORT_R, fill: '#fff',
            stroke: c.border, 'stroke-width': 2,
            'class': 'port port-in'
        });
        inPort.dataset.nodeId = node.id;
        inPort.dataset.port = 'in';
        g.appendChild(inPort);

        // Puerto(s) de salida (derecha)
        if (node.type === 'options' && node.data.options && node.data.options.length > 0) {
            node.data.options.forEach((opt, i) => {
                const portY = node.y + 50 + i * 28 + 10;
                const outPort = makeSVG('circle', {
                    cx: node.x + NODE_W, cy: portY,
                    r: PORT_R, fill: '#fff',
                    stroke: c.border, 'stroke-width': 2,
                    'class': 'port port-out'
                });
                outPort.dataset.nodeId = node.id;
                outPort.dataset.port = 'out_' + i;
                outPort.addEventListener('mousedown', (e) => startConnecting(e, node.id, 'out_' + i));
                outPort.addEventListener('touchstart', (e) => startConnecting(e, node.id, 'out_' + i), { passive: true });
                g.appendChild(outPort);
            });
        } else if (node.type === 'condition') {
            const ports = [{ label: 'Sí', offset: 0.4 }, { label: 'No', offset: 0.7 }];
            ports.forEach((p, i) => {
                const portY = node.y + h * p.offset;
                const outPort = makeSVG('circle', {
                    cx: node.x + NODE_W, cy: portY,
                    r: PORT_R, fill: '#fff',
                    stroke: c.border, 'stroke-width': 2,
                    'class': 'port port-out'
                });
                outPort.dataset.nodeId = node.id;
                outPort.dataset.port = 'out_' + i;
                const lbl = makeSVG('text', {
                    x: node.x + NODE_W + 12, y: portY + 4,
                    'font-size': 11, fill: '#64748b', 'font-family': 'system-ui'
                });
                lbl.textContent = p.label;
                outPort.addEventListener('mousedown', (e) => startConnecting(e, node.id, 'out_' + i));
                g.appendChild(outPort);
                g.appendChild(lbl);
            });
        } else {
            const outPort = makeSVG('circle', {
                cx: node.x + NODE_W, cy: node.y + h / 2,
                r: PORT_R, fill: '#fff',
                stroke: c.border, 'stroke-width': 2,
                'class': 'port port-out'
            });
            outPort.dataset.nodeId = node.id;
            outPort.dataset.port = 'out';
            outPort.addEventListener('mousedown', (e) => startConnecting(e, node.id, 'out'));
            g.appendChild(outPort);
        }

        // Eventos del nodo
        g.addEventListener('mousedown', (e) => onNodeMouseDown(e, node));
        g.addEventListener('click', (e) => {
            if (!e.target.classList.contains('port')) {
                selectNode(node.id);
                e.stopPropagation();
            }
        });

        svgG.appendChild(g);
    }

    function renderNodeBody(g, node, h) {
        const textX = node.x + 14;
        let textY = node.y + 52;

        if (node.type === 'message') {
            const preview = (node.data.text || 'Sin texto').slice(0, 80);
            wrapSVGText(g, preview, textX, textY, NODE_W - 28, 14, '#334155');
        } else if (node.type === 'options') {
            const opts = node.data.options || [];
            opts.forEach((opt, i) => {
                const t = makeSVG('text', {
                    x: textX + 18, y: textY + i * 28,
                    'font-size': 12, fill: '#334155', 'font-family': 'system-ui'
                });
                t.textContent = (i + 1) + '. ' + (opt || '').slice(0, 24);
                const badge = makeSVG('rect', {
                    x: textX, y: textY + i * 28 - 14,
                    width: NODE_W - 28, height: 22, rx: 6,
                    fill: '#fff', stroke: '#8b5cf6', 'stroke-width': 1
                });
                g.appendChild(badge);
                g.appendChild(t);
            });
        } else if (node.type === 'condition') {
            const t = makeSVG('text', {
                x: textX, y: textY,
                'font-size': 12, fill: '#334155', 'font-family': 'system-ui'
            });
            t.textContent = (node.data.condition || 'Ingresa condición').slice(0, 30);
            g.appendChild(t);
        } else if (node.type === 'action') {
            const t = makeSVG('text', {
                x: textX, y: textY,
                'font-size': 12, fill: '#334155', 'font-family': 'system-ui'
            });
            const actionLabels = { sheets:'Google Sheets', mark_open:'Marcar abierta', mark_closed:'Marcar cerrada', agent:'Escalar agente', none:'Sin acción' };
            t.textContent = actionLabels[node.data.action] || 'Configurar acción';
            g.appendChild(t);
        } else if (node.type === 'delay') {} else if (node.type === 'delay') {
            const t = makeSVG('text', {
                x: textX, y: textY,
                'font-size': 12, fill: '#334155', 'font-family': 'system-ui'
            });
            t.textContent = `Esperar ${node.data.seconds || 10} segundos`;
            g.appendChild(t);
        }
    }

    function getNodeHeight(node) {
        if (node.type === 'options') {
            const opts = node.data.options || [];
            return Math.max(NODE_H_BASE, 50 + opts.length * 28 + 16);
        }
        if (node.type === 'condition') return 120;
        return NODE_H_BASE;
    }

    function getPortPos(node, port) {
        const h = getNodeHeight(node);
        if (port === 'in')  return { x: node.x,          y: node.y + h / 2 };
        if (port === 'out') return { x: node.x + NODE_W, y: node.y + h / 2 };
        if (port && port.startsWith('out_')) {
            const i = parseInt(port.split('_')[1]);
            if (node.type === 'options') {
                return { x: node.x + NODE_W, y: node.y + 50 + i * 28 + 10 };
            }
            if (node.type === 'condition') {
                const offsets = [0.4, 0.7];
                return { x: node.x + NODE_W, y: node.y + h * (offsets[i] || 0.5) };
            }
        }
        return { x: node.x + NODE_W, y: node.y + h / 2 };
    }

    function getNodeIcon(type) {
        // Wrapper SVG group posicionado en (0,0) — se traslada en renderNode
        const wrap = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        wrap.setAttribute('width', 20);
        wrap.setAttribute('height', 20);
        wrap.setAttribute('viewBox', '0 0 24 24');
        wrap.setAttribute('fill', 'none');
        wrap.setAttribute('stroke', '#ffffff');
        wrap.setAttribute('stroke-width', '2');
        wrap.setAttribute('stroke-linecap', 'round');
        wrap.setAttribute('stroke-linejoin', 'round');

        const shapes = {
            message: [
                {tag:'path', d:'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'}
            ],
            options: [
                {tag:'line',x1:'8',y1:'6',x2:'21',y2:'6'},
                {tag:'line',x1:'8',y1:'12',x2:'21',y2:'12'},
                {tag:'line',x1:'8',y1:'18',x2:'21',y2:'18'},
                {tag:'circle',cx:'3.5',cy:'6',r:'1.3'},
                {tag:'circle',cx:'3.5',cy:'12',r:'1.3'},
                {tag:'circle',cx:'3.5',cy:'18',r:'1.3'}
            ],
            condition: [
                {tag:'path', d:'M12 3L21 8v8l-9 5-9-5V8z'},
                {tag:'line',x1:'12',y1:'3',x2:'12',y2:'21'},
                {tag:'line',x1:'3',y1:'12',x2:'21',y2:'12'}
            ],
            action: [
                {tag:'path', d:'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'},
                {tag:'polyline',points:'14 2 14 8 20 8'},
                {tag:'line',x1:'9',y1:'13',x2:'15',y2:'13'},
                {tag:'line',x1:'9',y1:'17',x2:'15',y2:'17'}
            ],
            delay: [
                {tag:'circle',cx:'12',cy:'12',r:'9'},
                {tag:'polyline',points:'12 7 12 12 15.5 14'}
            ]
        };

        (shapes[type] || shapes.message).forEach(s => {
            const el = document.createElementNS('http://www.w3.org/2000/svg', s.tag);
            Object.entries(s).forEach(([k, v]) => { if (k !== 'tag') el.setAttribute(k, v); });
            wrap.appendChild(el);
        });
        return wrap;
    }

    function wrapSVGText(g, text, x, y, maxWidth, fontSize, fill) {
        const words = text.split(' ');
        let line = '';
        let lineY = y;
        words.forEach(word => {
            const test = line + (line ? ' ' : '') + word;
            if (test.length * (fontSize * 0.55) > maxWidth && line) {
                const t = makeSVG('text', { x, y: lineY, 'font-size': fontSize, fill, 'font-family': 'system-ui' });
                t.textContent = line;
                g.appendChild(t);
                line = word;
                lineY += fontSize + 4;
            } else {
                line = test;
            }
        });
        if (line) {
            const t = makeSVG('text', { x, y: lineY, 'font-size': fontSize, fill, 'font-family': 'system-ui' });
            t.textContent = line;
            g.appendChild(t);
        }
    }

    // ── Drag nodos ────────────────────────────────────────────────
    function onNodeMouseDown(e, node) {
        if (e.target.classList.contains('port')) return;
        e.stopPropagation();
        const pt = svgPoint(e);
        dragging = { node, ox: pt.x - node.x, oy: pt.y - node.y };
    }

    svgEl?.addEventListener('mousemove', (e) => {
        if (dragging) {
            const pt = svgPoint(e);
            dragging.node.x = pt.x - dragging.ox;
            dragging.node.y = pt.y - dragging.oy;
            render();
        } else if (panDragging) {
            pan.x = e.clientX - panStart.x;
            pan.y = e.clientY - panStart.y;
            render();
        } else if (connecting) {
            const pt = svgPoint(e);
            connecting.mx = pt.x;
            connecting.my = pt.y;
            render();
        } else {
            svgEl.style.cursor = isBg(e.target) ? 'grab' : 'default';
        }
    });


    // ── Pan del canvas (fondo gris) ──────────────────────────────
    // isBg: true si el click fue en el fondo vacío, no sobre un nodo
    function isBg(el) {
        if (!el) return true;
        // Si hay un ancestro con data-node-id → es parte de un nodo
        const nodeEl = el.closest ? el.closest('[data-node-id]') : null;
        return !nodeEl;
    }

    svgEl?.addEventListener('mousedown', (e) => {
        if (isBg(e.target) && !connecting) {
            e.preventDefault();
            panDragging = true;
            panStart = { x: e.clientX - pan.x, y: e.clientY - pan.y };
            svgEl.style.cursor = 'grabbing';
            selectedNode = null;
            closeProps();
            render();
        }
    });

    svgEl?.addEventListener('mouseup', (e) => {
        if (connecting) {
            const target = e.target;
            if (target.classList.contains('port-in') && target.dataset.nodeId !== connecting.fromNode) {
                connections.push({
                    id: 'c' + (++connCounter),
                    from: connecting.fromNode,
                    fromPort: connecting.fromPort,
                    to: target.dataset.nodeId,
                    toPort: 'in'
                });
            }
            connecting = null;
            render();
        }
        dragging = null;
        panDragging = false;
        if (svgEl) svgEl.style.cursor = 'grab';
    });

    svgEl?.addEventListener('click', (e) => {
        if (isBg(e.target)) {
            selectedNode = null; closeProps(); render();
        }
    });

    // Zoom rueda
    svgEl?.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        zoom = Math.min(2.5, Math.max(0.2, zoom * delta));
        render();
    }, { passive: false });

    // ── Connecting ────────────────────────────────────────────────
    function startConnecting(e, nodeId, port) {
        e.stopPropagation();
        const pt = svgPoint(e);
        connecting = { fromNode: nodeId, fromPort: port, mx: pt.x, my: pt.y };
    }

    // ── Select node ───────────────────────────────────────────────
    function selectNode(id) {
        selectedNode = id;
        openProps(nodes.find(n => n.id === id));
        render();
    }

    // ── Props panel ───────────────────────────────────────────────
    function openProps(node) {
        if (!node) return;
        propsPanel.classList.add('open');
        renderProps(node);
    }
    function closeProps() {
        propsPanel.classList.remove('open');
    }
    propsClose?.addEventListener('click', () => { selectedNode = null; closeProps(); render(); });

    function renderProps(node) {
        const c = NODE_COLORS[node.type] || NODE_COLORS.message;
        let html = `<div class="prop-group"><p class="prop-label" style="color:${c.border}">${c.label}</p></div>`;

        if (node.type === 'message') {
            const imgPreview = node.data.imageUrl
                ? `<div class="img-preview-wrap" id="imgPreviewWrap">
                    <img src="${esc(node.data.imageUrl)}" class="img-preview" id="imgPreview"/>
                    <button class="img-remove-btn" id="btnRemoveImg" title="Quitar imagen">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </div>`
                : `<div class="img-upload-zone" id="imgUploadZone">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" width="28" height="28"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                    <span>Agregar imagen</span>
                    <span style="font-size:11px;color:var(--slate-400)">JPG, PNG o GIF · máx 5 MB</span>
                   </div>`;

            // Curso embebido en mensaje
            const hasCurso = !!node.data.curso;
            const cd = node.data.curso || {};
            const cMod = cd.modalidad || 'presencial';
            const cDisp = cd.disponible !== false;

            const cursoSection = hasCurso
                ? `<div class="curso-embed-body" id="cursoEmbedBody">
                    <div class="prop-group">
                        <label class="prop-label">Nombre del curso</label>
                        <input class="prop-input" id="prop_curso_title" value="${esc(cd.title||'')}" placeholder="Ej. Taller de emprendimiento"/>
                    </div>
                    <div class="prop-group">
                        <label class="prop-label">Descripción</label>
                        <textarea class="prop-textarea" id="prop_curso_desc" rows="3" placeholder="Requisitos, temario, horarios...">${esc(cd.description||'')}</textarea>
                    </div>
                    <div class="prop-group">
                        <label class="prop-label">Modalidad</label>
                        <div style="display:flex;gap:6px;flex-wrap:wrap;">
                            <button type="button" class="modalidad-btn-prop ${cMod==='presencial'?'active':''}" data-mod="presencial">Presencial</button>
                            <button type="button" class="modalidad-btn-prop ${cMod==='en-linea'?'active':''}" data-mod="en-linea">En línea</button>
                            <button type="button" class="modalidad-btn-prop ${cMod==='hibrido'?'active':''}" data-mod="hibrido">Híbrido</button>
                        </div>
                    </div>
                    <div class="prop-group">
                        <label class="prop-label">Cupos disponibles</label>
                        <div style="display:flex;align-items:center;gap:8px;">
                            <input class="prop-input" id="prop_curso_cupos" type="number" min="0" style="width:100px;" value="${esc(String(cd.cupos||''))}" placeholder="—"/>
                            <span style="font-size:13px;color:#6b7280;">lugares</span>
                        </div>
                    </div>
                    <div class="prop-group" style="flex-direction:row;align-items:center;justify-content:space-between;">
                        <label class="prop-label" style="margin:0;">Estado</label>
                        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
                            <input type="checkbox" id="prop_curso_disponible" ${cDisp?'checked':''} style="accent-color:#06b6d4;width:14px;height:14px;">
                            <span id="prop_disp_label" style="font-size:12px;font-weight:600;color:${cDisp?'#06b6d4':'#ef4444'};">${cDisp?'Disponible':'Agotado'}</span>
                        </label>
                    </div>
                    <div class="prop-group">
                        <label class="prop-label">Periodo</label>
                        <div style="display:flex;gap:8px;align-items:center;">
                            <input class="prop-input" id="prop_curso_inicio" type="date" value="${esc(cd.fechaInicio||'')}" style="flex:1;"/>
                            <span style="color:#9ca3af;font-size:13px;">→</span>
                            <input class="prop-input" id="prop_curso_fin" type="date" value="${esc(cd.fechaFin||'')}" style="flex:1;"/>
                        </div>
                    </div>
                    <button type="button" class="btn-remove-curso-embed" id="btnRemoveCursoEmbed">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="13" height="13"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        Quitar curso
                    </button>
                   </div>`
                : `<button type="button" class="btn-add-curso-embed" id="btnAddCursoEmbed">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="14" height="14"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
                    Adjuntar curso / taller
                   </button>`;

            html += `<div class="prop-group">
                <label class="prop-label">Mensaje</label>
                <textarea class="prop-textarea" id="prop_text" rows="4">${esc(node.data.text || '')}</textarea>
            </div>
            <div class="prop-group">
                <label class="prop-label">Imagen adjunta <span style="font-weight:400;color:var(--slate-400)">(opcional)</span></label>
                ${imgPreview}
                <input type="file" id="prop_imgFile" accept="image/*" style="display:none"/>
            </div>
            <div class="prop-group curso-embed-section">
                <label class="prop-label" style="display:flex;align-items:center;gap:6px;">
                    <svg viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2" stroke-linecap="round" width="13" height="13"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
                    Curso adjunto
                </label>
                ${cursoSection}
            </div>`;
        } else if (node.type === 'options') {
            const opts = node.data.options || [];
            const rows = opts.map((o, i) => `
                <div class="option-prop-row">
                    <div class="option-num-badge">${i+1}</div>
                    <input class="option-prop-input" data-opt-idx="${i}" value="${esc(o)}" placeholder="Opción ${i+1}"/>
                    <button class="btn-remove-opt" data-remove-opt="${i}" title="Eliminar">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" width="12" height="12"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>`).join('');
            html += `<div class="prop-group">
                <label class="prop-label">Opciones</label>
                <p style="font-size:11px;color:var(--slate-400);margin:0 0 8px">El usuario responde con el número</p>
                <div class="options-prop-list" id="optsPropList">${rows}</div>
                <button class="btn-add-opt" id="btnAddOptProp" style="margin-top:8px">+ Agregar opción</button>
            </div>`;
        } else if (node.type === 'condition') {
            html += `<div class="prop-group">
                <label class="prop-label">Condición</label>
                <input class="prop-input" id="prop_condition" value="${esc(node.data.condition || '')}" placeholder="Ej. respuesta == 1"/>
            </div>`;
        } else if (node.type === 'action') {
            const actionVal = node.data.action || 'none';
            html += `<div class="prop-group">
                <label class="prop-label">Acción</label>
                <select class="prop-select" id="prop_action">
                    <option value="none" ${actionVal==='none'?'selected':''}>Sin acción</option>
                    <option value="sheets" ${actionVal==='sheets'?'selected':''}>Guardar en Google Sheets</option>
                    <option value="mark_open" ${actionVal==='mark_open'?'selected':''}>Marcar conversación abierta</option>
                    <option value="mark_closed" ${actionVal==='mark_closed'?'selected':''}>Marcar conversación cerrada</option>
                    <option value="agent" ${actionVal==='agent'?'selected':''}>Escalar a agente humano</option>
                </select>
            </div>
            <div class="prop-group" id="prop_sheets_wrap" style="display:${actionVal==='sheets'?'flex':'none'}">
                <label class="prop-label">ID de Google Sheet</label>
                <input class="prop-input" id="prop_sheetsId" value="${esc(node.data.sheetsId || '')}" placeholder="Ej. 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"/>
                <p style="font-size:11px;color:var(--slate-400);margin:2px 0 0;">El ID está en la URL del Sheet entre /d/ y /edit</p>
            </div>
            <div class="prop-group" id="prop_sheets_tab_wrap" style="display:${actionVal==='sheets'?'flex':'none'}">
                <label class="prop-label">Nombre de la hoja (tab)</label>
                <input class="prop-input" id="prop_sheetsTab" value="${esc(node.data.sheetsTab || 'Hoja 1')}" placeholder="Ej. Hoja 1, Inscripciones"/>
            </div>
            <div class="prop-group" id="prop_sheets_range_wrap" style="display:${actionVal==='sheets'?'flex':'none'}">
                <label class="prop-label">Rango de inicio</label>
                <input class="prop-input" id="prop_sheetsRange" value="${esc(node.data.sheetsRange || 'A1')}" placeholder="Ej. A1, B2"/>
                <p style="font-size:11px;color:var(--slate-400);margin:2px 0 0;">El bot agregará cada respuesta en la siguiente fila disponible</p>
            </div>`;
        } else if (node.type === 'curso') {
            const t1 = makeSVG('text', { x: textX, y: textY, 'font-size': 13, 'font-weight': 600, fill: '#374151', 'font-family': 'system-ui' });
            t1.textContent = (node.data.title || 'Sin título').slice(0, 28);
            g.appendChild(t1);
            const t2 = makeSVG('text', { x: textX, y: textY + 18, 'font-size': 11, fill: '#9ca3af', 'font-family': 'system-ui' });
            const mod = node.data.modalidad || 'presencial';
            const cupos = node.data.cupos ? `· ${node.data.cupos} cupos` : '';
            t2.textContent = mod.charAt(0).toUpperCase() + mod.slice(1) + cupos;
            g.appendChild(t2);
            const disp = node.data.disponible !== false;
            const badge = makeSVG('rect', { x: textX, y: textY + 28, width: 70, height: 18, rx: 9, fill: disp ? '#d1fae5' : '#fee2e2' });
            const bdgTxt = makeSVG('text', { x: textX + 8, y: textY + 41, 'font-size': 10, 'font-weight': 600, fill: disp ? '#065f46' : '#991b1b', 'font-family': 'system-ui' });
            bdgTxt.textContent = disp ? 'Disponible' : 'Agotado';
            g.appendChild(badge);
            g.appendChild(bdgTxt);
        } else if (node.type === 'curso') {
            const disp = node.data.disponible !== false;
            const mod  = node.data.modalidad || 'presencial';
            html += `<div class="prop-group">
                <label class="prop-label">Nombre del curso</label>
                <input class="prop-input" id="prop_curso_title" value="${esc(node.data.title || '')}" placeholder="Ej. Taller de emprendimiento"/>
            </div>
            <div class="prop-group">
                <label class="prop-label">Descripción</label>
                <textarea class="prop-textarea" id="prop_curso_desc" rows="3" placeholder="Requisitos, temario, horarios...">${esc(node.data.description || '')}</textarea>
            </div>
            <div class="prop-group">
                <label class="prop-label">Modalidad</label>
                <div style="display:flex;gap:6px;flex-wrap:wrap;">
                    <button type="button" class="modalidad-btn-prop ${mod==='presencial'?'active':''}" data-mod="presencial">Presencial</button>
                    <button type="button" class="modalidad-btn-prop ${mod==='en-linea'?'active':''}" data-mod="en-linea">En línea</button>
                    <button type="button" class="modalidad-btn-prop ${mod==='hibrido'?'active':''}" data-mod="hibrido">Híbrido</button>
                </div>
            </div>
            <div class="prop-group">
                <label class="prop-label">Cupos disponibles</label>
                <div style="display:flex;align-items:center;gap:8px;">
                    <input class="prop-input" id="prop_curso_cupos" type="number" min="0" style="width:90px;" value="${esc(String(node.data.cupos || ''))}" placeholder="—"/>
                    <span style="font-size:13px;color:#6b7280;">lugares</span>
                </div>
            </div>
            <div class="prop-group">
                <label class="prop-label" style="display:flex;align-items:center;justify-content:space-between;">
                    Estado
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-weight:400;">
                        <input type="checkbox" id="prop_curso_disponible" ${disp?'checked':''} style="accent-color:#06b6d4;width:14px;height:14px;">
                        <span id="prop_disp_label" style="font-size:12px;color:${disp?'#06b6d4':'#ef4444'};font-weight:600;">${disp?'Disponible':'Agotado'}</span>
                    </label>
                </label>
            </div>
            <div class="prop-group">
                <label class="prop-label">Periodo</label>
                <div style="display:flex;gap:8px;align-items:center;">
                    <input class="prop-input" id="prop_curso_inicio" type="date" value="${esc(node.data.fechaInicio || '')}" style="flex:1;"/>
                    <span style="color:#9ca3af;">→</span>
                    <input class="prop-input" id="prop_curso_fin" type="date" value="${esc(node.data.fechaFin || '')}" style="flex:1;"/>
                </div>
            </div>`;
        } else if (node.type === 'delay') {
            html += `<div class="prop-group">
                <label class="prop-label">Segundos de espera</label>
                <input class="prop-input" id="prop_seconds" type="number" min="1" max="3600" value="${node.data.seconds || 10}"/>
            </div>`;
        }

        html += `<button class="btn-delete-node" id="btnDeleteNode">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
            Eliminar nodo
        </button>`;

        propsBody.innerHTML = html;
        bindProps(node);
    }

    function bindProps(node) {
        const get = id => document.getElementById(id);

        const autosave = () => { render(); };

        if (node.type === 'message') {
            get('prop_text')?.addEventListener('input', e => { node.data.text = e.target.value; autosave(); });

            // Click en zona de upload
            const zone = get('imgUploadZone');
            const fileInput = get('prop_imgFile');
            if (zone && fileInput) {
                zone.addEventListener('click', () => fileInput.click());
                zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
                zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
                zone.addEventListener('drop', e => {
                    e.preventDefault(); zone.classList.remove('drag-over');
                    const file = e.dataTransfer.files[0];
                    if (file) handleImageFile(file, node);
                });
            }
            fileInput?.addEventListener('change', e => {
                if (e.target.files[0]) handleImageFile(e.target.files[0], node);
            });

            // Quitar imagen
            get('btnRemoveImg')?.addEventListener('click', () => {
                node.data.imageUrl = '';
                renderProps(node);
                autosave();
            });

            // Adjuntar / quitar curso
            get('btnAddCursoEmbed')?.addEventListener('click', () => {
                node.data.curso = { title: '', description: '', disponible: true, cupos: '', modalidad: 'presencial', fechaInicio: '', fechaFin: '' };
                renderProps(node);
                autosave();
            });
            get('btnRemoveCursoEmbed')?.addEventListener('click', () => {
                node.data.curso = null;
                renderProps(node);
                autosave();
            });

            // Campos del curso embebido
            if (node.data.curso) {
                const syncCurso = () => {
                    if (!node.data.curso) return;
                    node.data.curso.title       = get('prop_curso_title')?.value       || '';
                    node.data.curso.description = get('prop_curso_desc')?.value        || '';
                    node.data.curso.cupos       = get('prop_curso_cupos')?.value       || '';
                    node.data.curso.fechaInicio = get('prop_curso_inicio')?.value      || '';
                    node.data.curso.fechaFin    = get('prop_curso_fin')?.value         || '';
                    autosave();
                };
                ['prop_curso_title','prop_curso_desc','prop_curso_cupos','prop_curso_inicio','prop_curso_fin']
                    .forEach(id => get(id)?.addEventListener('input',  syncCurso));
                ['prop_curso_inicio','prop_curso_fin']
                    .forEach(id => get(id)?.addEventListener('change', syncCurso));

                get('prop_curso_disponible')?.addEventListener('change', e => {
                    if (!node.data.curso) return;
                    node.data.curso.disponible = e.target.checked;
                    const lbl = get('prop_disp_label');
                    if (lbl) { lbl.textContent = e.target.checked ? 'Disponible' : 'Agotado'; lbl.style.color = e.target.checked ? '#06b6d4' : '#ef4444'; }
                    autosave();
                });

                propsBody.addEventListener('click', e => {
                    const mb = e.target.closest('.modalidad-btn-prop');
                    if (mb && node.data.curso) {
                        propsBody.querySelectorAll('.modalidad-btn-prop').forEach(b => b.classList.remove('active'));
                        mb.classList.add('active');
                        node.data.curso.modalidad = mb.dataset.mod;
                        autosave();
                    }
                });
            }
        } else if (node.type === 'options') {
            propsBody.addEventListener('input', e => {
                if (e.target.dataset.optIdx !== undefined) {
                    const i = parseInt(e.target.dataset.optIdx);
                    if (!node.data.options) node.data.options = [];
                    node.data.options[i] = e.target.value;
                    autosave();
                }
            });
            propsBody.addEventListener('click', e => {
                if (e.target.closest('[data-remove-opt]') !== null) {
                    const i = parseInt(e.target.closest('[data-remove-opt]').dataset.removeOpt);
                    node.data.options.splice(i, 1);
                    connections = connections.filter(c => !(c.from === node.id && c.fromPort === 'out_' + i));
                    renderProps(node); autosave();
                }
                if (e.target.id === 'btnAddOptProp') {
                    if (!node.data.options) node.data.options = [];
                    if (node.data.options.length >= 10) { showToast('Máximo 10 opciones', 'error'); return; }
                    node.data.options.push('');
                    renderProps(node); autosave();
                }
            });
        } else if (node.type === 'condition') {
            get('prop_condition')?.addEventListener('input', e => { node.data.condition = e.target.value; autosave(); });
        } else if (node.type === 'action') {
            get('prop_action')?.addEventListener('change', e => {
                node.data.action = e.target.value;
                const isSheets = e.target.value === 'sheets';
                ['prop_sheets_wrap','prop_sheets_tab_wrap','prop_sheets_range_wrap'].forEach(id => {
                    const el = get(id);
                    if (el) el.style.display = isSheets ? 'flex' : 'none';
                });
                autosave();
            });
            get('prop_sheetsId')?.addEventListener('input',    e => { node.data.sheetsId    = e.target.value; });
            get('prop_sheetsTab')?.addEventListener('input',   e => { node.data.sheetsTab   = e.target.value; });
            get('prop_sheetsRange')?.addEventListener('input', e => { node.data.sheetsRange = e.target.value; });
        } else if (node.type === 'curso') {
            const t1 = makeSVG('text', { x: textX, y: textY, 'font-size': 13, 'font-weight': 600, fill: '#374151', 'font-family': 'system-ui' });
            t1.textContent = (node.data.title || 'Sin título').slice(0, 28);
            g.appendChild(t1);
            const t2 = makeSVG('text', { x: textX, y: textY + 18, 'font-size': 11, fill: '#9ca3af', 'font-family': 'system-ui' });
            const mod = node.data.modalidad || 'presencial';
            const cupos = node.data.cupos ? `· ${node.data.cupos} cupos` : '';
            t2.textContent = mod.charAt(0).toUpperCase() + mod.slice(1) + cupos;
            g.appendChild(t2);
            const disp = node.data.disponible !== false;
            const badge = makeSVG('rect', { x: textX, y: textY + 28, width: 70, height: 18, rx: 9, fill: disp ? '#d1fae5' : '#fee2e2' });
            const bdgTxt = makeSVG('text', { x: textX + 8, y: textY + 41, 'font-size': 10, 'font-weight': 600, fill: disp ? '#065f46' : '#991b1b', 'font-family': 'system-ui' });
            bdgTxt.textContent = disp ? 'Disponible' : 'Agotado';
            g.appendChild(badge);
            g.appendChild(bdgTxt);
        } else if (node.type === 'delay') {
            get('prop_seconds')?.addEventListener('input', e => { node.data.seconds = parseInt(e.target.value) || 10; autosave(); });
        }

        if (node.type === 'curso') {
            get('prop_curso_title')?.addEventListener('input',    e => { node.data.title       = e.target.value;               autosave(); });
            get('prop_curso_desc')?.addEventListener('input',     e => { node.data.description = e.target.value;               autosave(); });
            get('prop_curso_cupos')?.addEventListener('input',    e => { node.data.cupos        = e.target.value;               autosave(); });
            get('prop_curso_inicio')?.addEventListener('change',  e => { node.data.fechaInicio  = e.target.value;               autosave(); });
            get('prop_curso_fin')?.addEventListener('change',     e => { node.data.fechaFin     = e.target.value;               autosave(); });
            const dispChk   = get('prop_curso_disponible');
            const dispLabel = get('prop_disp_label');
            dispChk?.addEventListener('change', e => {
                node.data.disponible = e.target.checked;
                if (dispLabel) {
                    dispLabel.textContent = e.target.checked ? 'Disponible' : 'Agotado';
                    dispLabel.style.color = e.target.checked ? '#06b6d4' : '#ef4444';
                }
                autosave();
            });
            propsBody.addEventListener('click', e => {
                const mb = e.target.closest('.modalidad-btn-prop');
                if (mb) {
                    propsBody.querySelectorAll('.modalidad-btn-prop').forEach(b => b.classList.remove('active'));
                    mb.classList.add('active');
                    node.data.modalidad = mb.dataset.mod;
                    autosave();
                }
            });
        }

        get('btnDeleteNode')?.addEventListener('click', () => {
            if (confirm('¿Eliminar este nodo?')) {
                nodes = nodes.filter(n => n.id !== node.id);
                connections = connections.filter(c => c.from !== node.id && c.to !== node.id);
                selectedNode = null;
                closeProps();
                render();
            }
        });
    }

    // ── Drag desde toolbar para crear nodo ───────────────────────
    document.querySelectorAll('.tool-item').forEach(item => {
        item.addEventListener('click', () => {
            const type = item.dataset.type;
            if (!type) return;
            const rect = svgEl.getBoundingClientRect();
            const cx = (rect.width  / 2 - pan.x) / zoom;
            const cy = (rect.height / 2 - pan.y) / zoom;
            const defaultData = {
                message:   { text: 'Nuevo mensaje', imageUrl: '' },
                options:   { options: ['Opción 1', 'Opción 2'] },
                condition: { condition: '' },
                action:    { action: 'none', sheetsId: '', sheetsTab: 'Hoja 1', sheetsRange: 'A1' },
                delay:     { seconds: 10 },
            };
            nodes.push({
                id: 'n' + (++nodeCounter),
                type,
                x: cx - NODE_W / 2 + (Math.random() * 40 - 20),
                y: cy - 40 + (Math.random() * 40 - 20),
                data: { ...defaultData[type] }
            });
            render();
        });
    });

    // ── Zoom buttons ──────────────────────────────────────────────
    btnZoomIn?.addEventListener('click',  () => { zoom = Math.min(2.5, zoom * 1.2); render(); });
    btnZoomOut?.addEventListener('click', () => { zoom = Math.max(0.2, zoom / 1.2); render(); });

    // ── Guardar flujo ─────────────────────────────────────────────
    async function saveCanvas(status) {
        const name    = canvasFlowName.value.trim() || 'Sin nombre';
        const trigger = (document.getElementById('canvasFlowTrigger')?.value || '').trim().toUpperCase() || 'FLUJO';

        // Validar nombre
        if (!name || name === 'Sin nombre') {
            const inp = document.getElementById('canvasFlowName');
            if (inp) { inp.focus(); inp.style.outline = '2px solid #ef4444'; setTimeout(() => inp.style.outline = '', 2000); }
            showToast('Escribe un nombre para el flujo', 'error');
            return;
        }

        const firstMsg = nodes.find(n => n.type === 'message');
        const optsNode = nodes.find(n => n.type === 'options');
        const options  = (optsNode?.data?.options || []).map((t, i) => ({ num: i + 1, text: t }));

        const payload = {
            name,
            trigger,
            welcome:    firstMsg?.data?.text || '',
            closingMsg: '',
            action:     nodes.find(n => n.type === 'action')?.data?.action || 'none',
            sheetsId:    nodes.find(n => n.type === 'action')?.data?.sheetsId    || '',
            sheetsTab:   nodes.find(n => n.type === 'action')?.data?.sheetsTab   || 'Hoja 1',
            sheetsRange: nodes.find(n => n.type === 'action')?.data?.sheetsRange || 'A1',
            options,
            status,
            canvasData: JSON.stringify({ nodes, connections }),
        };

        // UI: loading state
        const saveBtn = status === 'active'
            ? document.getElementById('btnPublishCanvas')
            : document.getElementById('btnSaveDraftCanvas');
        const origHTML = saveBtn?.innerHTML;
        if (saveBtn) { saveBtn.innerHTML = '<i class="lni lni-spinner-arrow" style="animation:spin .7s linear infinite;"></i> Guardando...'; saveBtn.disabled = true; }

        try {
            const isNew = !canvasFlow?.id;
            const url    = isNew ? '/api/flows' : `/api/flows/${canvasFlow.id}`;
            const method = isNew ? 'POST' : 'PUT';
            const res = await fetch(url, {
                method, credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (!res.ok) {
                const errText = await res.text();
                console.error('Save flow error:', res.status, errText);
                throw new Error(errText);
            }

            const saved = await res.json();
            canvasFlow = { ...canvasFlow, ...saved };
            closeCanvas();
            await loadFlows();
            showToast(status === 'active' ? 'Flujo publicado ✓' : 'Borrador guardado ✓', 'success');
        } catch (err) {
            console.error('saveCanvas error:', err);
            showToast('Error al guardar: ' + (err.message || 'revisa la consola'), 'error');
        } finally {
            if (saveBtn && origHTML) { saveBtn.innerHTML = origHTML; saveBtn.disabled = false; }
        }
    }

    btnSaveDraft?.addEventListener('click',  () => saveCanvas('draft'));
    btnPublish?.addEventListener('click',    () => saveCanvas('active'));
    btnCloseCanvas?.addEventListener('click', closeCanvas);
    btnNewFlow?.addEventListener('click',      () => openCanvas(null));
    btnNewFlowEmpty?.addEventListener('click', () => openCanvas(null));

    // ── Helpers ───────────────────────────────────────────────────
    function svgPoint(e) {
        const rect = svgEl.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left - pan.x) / zoom,
            y: (e.clientY - rect.top  - pan.y) / zoom,
        };
    }

    function makeSVG(tag, attrs) {
        const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
        Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
        return el;
    }

    function esc(str) {
        return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    // ── Upload imagen para nodo Mensaje ──────────────────────────
    function handleImageFile(file, node) {
        if (!file.type.startsWith('image/')) { showToast('Solo se permiten imágenes', 'error'); return; }
        if (file.size > 5 * 1024 * 1024)    { showToast('La imagen supera 5 MB', 'error');    return; }

        // Subir al servidor
        const fd = new FormData();
        fd.append('image', file);
        showToast('Subiendo imagen…', 'info');

        fetch('/api/upload/service-image', { method: 'POST', credentials: 'include', body: fd })
            .then(r => r.ok ? r.json() : Promise.reject())
            .then(data => {
                node.data.imageUrl = data.url || data.imageUrl || data.path || '';
                showToast('Imagen agregada ✓', 'success');
                renderProps(node);
                render();
            })
            .catch(() => {
                // Si el endpoint falla, usar base64 local como fallback
                const reader = new FileReader();
                reader.onload = ev => {
                    node.data.imageUrl = ev.target.result;
                    showToast('Imagen cargada ✓', 'success');
                    renderProps(node);
                    render();
                };
                reader.readAsDataURL(file);
            });
    }

    // ── Init ──────────────────────────────────────────────────────
    loadFlows();

})();