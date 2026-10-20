// ==========================================
// ORDERS.JS — gestión de pedidos (food verticals)
// ==========================================

let orders        = [];
let agents        = [];
let menuProducts  = [];   // productos cargados desde /api/my-business
let currentFilters = { status: 'all', agent: 'all', type: 'all', search: '' };
let openDropdown  = null;

// ==========================================
// INIT
// ==========================================
function getLang() {
    return localStorage.getItem('attomos_lang') || localStorage.getItem('lang') || 'es';
}
function t(key, fallback) {
    return window.Translations?.dict?.[getLang()]?.[key] || fallback;
}

// Re-renderiza la tabla (con sus badges de tipo/pago/estado generados por t())
// cuando cambia el idioma, usando los datos ya cargados en memoria.
document.addEventListener('attomos:langchange', function () {
    if (typeof renderOrders === 'function') renderOrders();
    if (typeof updateStats === 'function') updateStats();
});

document.addEventListener('DOMContentLoaded', () => {
    initOrders();
    document.addEventListener('click', e => {
        if (!e.target.closest('.actions-dropdown')) closeAllDropdowns();
        if (!e.target.closest('.custom-dropdown-wrapper'))
            document.querySelectorAll('.custom-dropdown-wrapper.active').forEach(d => d.classList.remove('active'));
    });
});

async function initOrders() {
    await Promise.all([loadAgents(), loadMenuProducts()]);
    await loadOrders();
    updateStats();
    renderOrders();
}

// ==========================================
// DATA
// ==========================================

async function loadAgents() {
    try {
        const res = await fetch('/api/agents', { credentials: 'include' });
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (data.agents) { agents = data.agents; populateAgentFilter(); }
    } catch {
        agents = [];
        populateAgentFilter();
    }
}

function populateAgentFilter() {
    const container = document.getElementById('agentFilterOptions');
    if (!container) return;
    container.querySelectorAll('[data-dynamic]').forEach(el => el.remove());
    agents.forEach(a => {
        const div = document.createElement('div');
        div.className = 'dropdown-option';
        div.dataset.dynamic = '1';
        div.dataset.value = a.id;
        div.innerHTML = `<svg style="width:1em;height:1em;vertical-align:middle;flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg><span>${a.name}</span>`;
        div.onclick = () => selectFilterOption(div, 'selectedAgent', 'agent', String(a.id));
        container.appendChild(div);
    });
}

async function loadOrders() {
    try {
        const res = await fetch('/api/orders', { credentials: 'include' });
        if (!res.ok) throw new Error();
        const data = await res.json();
        orders = data.orders || [];
    } catch (e) {
        console.error('Error cargando pedidos:', e);
        orders = [];
    }
    if (orders.length === 0) showEmptyState();
    else hideEmptyState();
}

// Carga los productos/servicios desde la sucursal activa de Mi Negocio
async function loadMenuProducts() {
    try {
        const res = await fetch('/api/my-business', { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        const branch = data.activeBranch || data.defaultBranch;
        if (!branch) return;
        const raw = branch.services || [];
        // Normalizar precio: si es promo usar promoPrice, si no price
        menuProducts = raw
            .filter(s => s.title)
            .map(s => ({
                title: s.title,
                price: s.priceType === 'promo' ? (s.promoPrice || s.price || 0) : (s.price || 0),
                description: s.description || '',
                imageUrl: (s.imageUrls && s.imageUrls[0]) || s.imageUrl || '',
            }));
    } catch (e) {
        menuProducts = [];
    }
}

// ==========================================
// STATS
// ==========================================

function updateStats() {
    const pending   = orders.filter(o => o.status === 'pending').length;
    const preparing = orders.filter(o => o.status === 'preparing').length;
    const ready     = orders.filter(o => o.status === 'ready').length;
    const today     = new Date().toISOString().slice(0, 10);
    const todayOrds = orders.filter(o => o.createdAt && o.createdAt.startsWith(today)).length;
    const total     = orders.reduce((s, o) => s + (o.total || 0), 0);

    setText('statPending',   pending);
    setText('statPreparing', preparing);
    setText('statReady',     ready);
    setText('statToday',     todayOrds);
    setText('statTotal',     '$' + total.toFixed(2));
}

function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

// ==========================================
// RENDER
// ==========================================

function filterOrders() {
    let f = [...orders];
    if (currentFilters.status !== 'all') f = f.filter(o => o.status === currentFilters.status);
    if (currentFilters.agent  !== 'all') f = f.filter(o => String(o.agentId) === currentFilters.agent);
    if (currentFilters.type   !== 'all') f = f.filter(o => o.orderType === currentFilters.type);
    if (currentFilters.search) {
        const s = currentFilters.search;
        f = f.filter(o =>
            o.clientName.toLowerCase().includes(s) ||
            (o.clientPhone && o.clientPhone.includes(s)) ||
            (o.items && itemsToText(o.items).toLowerCase().includes(s))
        );
    }
    return f;
}

function renderOrders() {
    const filtered = filterOrders();
    const tbody    = document.getElementById('ordersList');
    const view     = document.getElementById('ordersTableView');
    if (!tbody) return;

    if (orders.length === 0) { showEmptyState(); if (view) view.style.display = 'none'; return; }
    hideEmptyState();
    if (view) view.style.display = 'block';

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:3rem;color:#6b7280;">
            <svg style="width:1em;height:1em;vertical-align:middle;flex-shrink:0;font-size:3rem;opacity:.5;display:block;margin-bottom:.5rem;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <p>Sin pedidos con estos filtros</p></td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(createRow).join('');
}

function createRow(o) {
    const itemsText = itemsToText(o.items);

    const typeLabel = {
        delivery:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:.85rem;height:.85rem;vertical-align:middle;margin-right:.25rem;"><path d="M5 17H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v3"/><rect x="9" y="11" width="14" height="10" rx="2"/><path d="M12 17h.01M16 17h.01"/></svg>' + t('orders_type_delivery','A domicilio'),
        pickup:       '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:.85rem;height:.85rem;vertical-align:middle;margin-right:.25rem;"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><line x1="3" x2="21" y1="6" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>' + t('orders_type_pickup','Para llevar'),
        dine_in:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:.85rem;height:.85rem;vertical-align:middle;margin-right:.25rem;"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></svg>' + t('orders_type_dine_in','En el local'),
        local_pickup: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:.85rem;height:.85rem;vertical-align:middle;margin-right:.25rem;"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>' + t('orders_type_local_pickup','Recoger en local'),
    };
    const typeCls = {
        delivery:     'type-delivery',
        pickup:       'type-pickup',
        dine_in:      'type-dine_in',
        local_pickup: 'type-local_pickup',
    };

    const payLabel = {
        cash:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:.85rem;height:.85rem;vertical-align:middle;margin-right:.25rem;"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/></svg>' + t('pos_cash','Efectivo'),
        card:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:.85rem;height:.85rem;vertical-align:middle;margin-right:.25rem;"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>' + t('pos_card','Tarjeta'),
        transfer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:.85rem;height:.85rem;vertical-align:middle;margin-right:.25rem;"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" x2="12.01" y1="18" y2="18"/></svg>' + t('pos_transfer','Transferencia'),
    };
    const payCls   = { cash: 'pay-cash',    card: 'pay-card',   transfer: 'pay-transfer' };
    const payMethod = o.paymentMethod || '';

    // Cambio para efectivo
    let cambioHtml = '';
    if (payMethod === 'cash' && o.cashReceived && o.cashReceived > 0) {
        const cambio = (o.cashReceived - (o.total || 0));
        cambioHtml = `<div class="cambio-info">${t('orders_paid_prefix','Pagó')} $${o.cashReceived.toFixed(2)} · ${t('appts_pos_change','Cambio:')} <strong>$${cambio.toFixed(2)}</strong></div>`;
    }

    return `
    <tr>
      <td>
        <div class="table-client"><svg style="width:1em;height:1em;vertical-align:middle;flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>${escHtml(o.clientName)}</div>
        ${o.clientPhone ? `<div class="table-phone" style="margin-top:.25rem"><a href="tel:${o.clientPhone}">${escHtml(o.clientPhone)}</a></div>` : ''}
      </td>
      <td><div class="table-items">${escHtml(itemsText)}</div></td>
      <td>
        <div class="table-total">$${(o.total||0).toFixed(2)}</div>
        ${payMethod ? `<span class="pay-badge ${payCls[payMethod]||''}">${payLabel[payMethod]||payMethod}</span>` : ''}
        ${cambioHtml}
      </td>
      <td><span class="type-badge ${typeCls[o.orderType]||'type-pickup'}">${typeLabel[o.orderType]||o.orderType}</span></td>
      <td>
        <div class="source-badge">
          <span class="source-badge-icon">${
            o.source==='agent'
              ? '<svg style="width:1em;height:1em;vertical-align:middle;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>'
              : o.source==='ninda'
              ? '<svg style="width:1em;height:1em;vertical-align:middle;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><line x1="3" x2="21" y1="6" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>'
              : '<svg style="width:1em;height:1em;vertical-align:middle;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>'
          }</span>
          ${sourceLabel(o.source)}${o.agentName ? ' · '+escHtml(o.agentName) : ''}
        </div>
      </td>
      <td><span class="order-status status-${o.status}">${statusLabel(o.status)}</span></td>
      <td><div class="table-time">${o.createdAt||''}</div></td>
      <td>
        <div class="actions-dropdown">
          <button class="actions-btn" onclick="toggleDropdown(event,${o.id},this)"><svg style="width:1em;height:1em;vertical-align:middle;flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg></button>
          <div class="actions-menu" id="dropdown-${o.id}">
            ${o.status!=='preparing'&&o.status!=='ready'&&o.status!=='delivered' ? `<div class="action-item preparing" onclick="updateStatus(${o.id},'preparing')"><svg style="width:1em;height:1em;vertical-align:middle;flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M5 3 2 6M22 6l-3-3M6.38 18.7 4 21M17.64 18.67 20 21"/></svg>En preparación</div>` : ''}
            ${o.status!=='ready'&&o.status!=='delivered' ? `<div class="action-item ready" onclick="updateStatus(${o.id},'ready')"><svg style="width:1em;height:1em;vertical-align:middle;flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>Listo</div>` : ''}
            ${o.status==='ready'&&o.orderType==='delivery' ? `<div class="action-item delivered" onclick="updateStatus(${o.id},'delivered')"><svg style="width:1em;height:1em;vertical-align:middle;flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 17H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v3"/><rect x="9" y="11" width="14" height="10" rx="2"/><path d="M12 17h.01M16 17h.01"/></svg>Entregado</div>` : ''}
            ${o.clientPhone ? `<div class="action-item whatsapp" onclick="sendWhatsApp('${o.clientPhone}','${escHtml(o.clientName)}',${o.id})"><svg style="width:1em;height:1em;vertical-align:middle;flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>WhatsApp</div>` : ''}
            ${o.status!=='cancelled' ? `<div class="action-item cancel" onclick="updateStatus(${o.id},'cancelled')"><svg style="width:1em;height:1em;vertical-align:middle;flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>Cancelar</div>` : ''}
            <div class="action-item delete" onclick="deleteOrder(${o.id},'${escHtml(o.clientName)}')"><svg style="width:1em;height:1em;vertical-align:middle;flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>Eliminar</div>
          </div>
        </div>
      </td>
    </tr>`;
}

// ==========================================
// MODAL — NUEVO PEDIDO
// ==========================================

function openOrderModal() {
    const modal = document.getElementById('orderModal');
    document.getElementById('modalTitle').innerHTML =
        '<svg style="width:1em;height:1em;vertical-align:middle;flex-shrink:0;color:var(--accent)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><line x1="3" x2="21" y1="6" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg> Nuevo Pedido';

    document.getElementById('modalBody').innerHTML = `
    <form id="createOrderForm" class="order-form">
      <div class="form-grid">

        <div class="form-group">
          <label class="form-label"><svg style="width:1em;height:1em;vertical-align:middle;flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>Nombre del cliente</label>
          <input type="text" class="form-input" id="clientName" placeholder="Nombre completo" required>
        </div>
        <div class="form-group">
          <label class="form-label"><svg style="width:1em;height:1em;vertical-align:middle;flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13.6 19.79 19.79 0 0 1 1.65 5a2 2 0 0 1 1.995-2H6.6a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 10.09a16 16 0 0 0 6 6l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 17.42z"/></svg>Teléfono</label>
          <input type="tel" class="form-input" id="clientPhone" placeholder="+52 662 000 0000">
        </div>

        <div class="form-group">
          <label class="form-label"><svg style="width:1em;height:1em;vertical-align:middle;flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 17H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v3"/><rect x="9" y="11" width="14" height="10" rx="2"/><path d="M12 17h.01M16 17h.01"/></svg>Tipo de pedido</label>
          <select class="form-input" id="orderType">
            <option value="pickup">Para llevar</option>
            <option value="delivery">A domicilio</option>
            <option value="dine_in">En el local</option>
            <option value="local_pickup">Recoger en local</option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label"><svg style="width:1em;height:1em;vertical-align:middle;flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M9 3h6M12 3v2"/></svg>Tiempo estimado (min)</label>
          <input type="number" class="form-input" id="estimatedTime" value="30" min="5" max="120">
        </div>

        <div class="form-group full-width" id="deliveryAddressGroup" style="display:none">
          <label class="form-label"><svg style="width:1em;height:1em;vertical-align:middle;flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>Dirección de entrega</label>
          <input type="text" class="form-input" id="deliveryAddress" placeholder="Calle, número, colonia">
        </div>

      </div>

      <!-- Items del pedido -->
      <div class="form-group">
        <label class="form-label"><svg style="width:1em;height:1em;vertical-align:middle;flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>Productos / Items</label>
        <div class="items-list" id="itemsList"></div>
        <button type="button" class="btn-add-item" onclick="addItemRow()">
          <svg style="width:1em;height:1em;vertical-align:middle;flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Agregar producto
        </button>
      </div>

      <div class="total-display" id="totalDisplay">
        <svg style="width:1em;height:1em;vertical-align:middle;flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M14.31 8l.39 1.5M9 15.5l.37 1.5M17 12h-1.5M8.5 12H7M12 9v1m0 4v1"/></svg> Total: <strong id="modalTotal">$0.00</strong>
      </div>

      <!-- ── Método de pago ───────────────────────────────── -->
      <div class="form-group full-width">
        <label class="form-label"><svg style="width:1em;height:1em;vertical-align:middle;flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>Método de pago</label>
        <div class="pay-method-toggle" id="payMethodToggle">
          <button type="button" class="pay-method-btn active" data-pay="cash">
            <svg style="width:1em;height:1em;vertical-align:middle;flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/></svg> Efectivo
          </button>
          <button type="button" class="pay-method-btn" data-pay="card">
            <svg style="width:1em;height:1em;vertical-align:middle;flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg> Tarjeta
          </button>
          <button type="button" class="pay-method-btn" data-pay="transfer">
            <svg style="width:1em;height:1em;vertical-align:middle;flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" x2="12.01" y1="18" y2="18"/></svg> Transferencia
          </button>
        </div>
        <input type="hidden" id="paymentMethod" value="cash">
      </div>

      <!-- ── Calculadora de cambio (solo efectivo) ────────── -->
      <div class="cash-calculator" id="cashCalculator">
        <div class="cash-calc-row">
          <div class="form-group" style="flex:1">
            <label class="form-label"><svg style="width:1em;height:1em;vertical-align:middle;flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>Cliente paga con</label>
            <div class="cash-quick-btns" id="cashQuickBtns">
              <button type="button" class="cash-quick-btn" data-amount="20">$20</button>
              <button type="button" class="cash-quick-btn" data-amount="50">$50</button>
              <button type="button" class="cash-quick-btn" data-amount="100">$100</button>
              <button type="button" class="cash-quick-btn" data-amount="200">$200</button>
              <button type="button" class="cash-quick-btn" data-amount="500">$500</button>
            </div>
            <input type="number" class="form-input" id="cashReceived" placeholder="0.00" step="0.01" min="0">
          </div>
          <div class="cambio-display" id="cambioDisplay" style="display:none">
            <div class="cambio-label">Cambio</div>
            <div class="cambio-amount" id="cambioAmount">$0.00</div>
          </div>
        </div>
      </div>

      <div class="form-group full-width" style="margin-top:-.25rem">
        <label class="form-label"><svg style="width:1em;height:1em;vertical-align:middle;flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Notas del pedido</label>
        <textarea class="form-input" id="orderNotes" rows="2" placeholder="Sin cebolla, extra salsa, etc."></textarea>
      </div>

      <div class="form-actions">
        <button type="button" class="btn-cancel-form" onclick="closeOrderModal()">
          <svg style="width:1em;height:1em;vertical-align:middle;flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg><span>Cancelar</span>
        </button>
        <button type="submit" class="btn-submit">
          <svg style="width:1em;height:1em;vertical-align:middle;flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg><span>Crear Pedido</span>
        </button>
      </div>
    </form>`;

    // ── Tipo de pedido: mostrar/ocultar dirección ──────────────
    document.getElementById('orderType').addEventListener('change', function () {
        document.getElementById('deliveryAddressGroup').style.display =
            this.value === 'delivery' ? 'block' : 'none';
    });

    // ── Método de pago: toggle ────────────────────────────────
    document.getElementById('payMethodToggle').addEventListener('click', function(e) {
        const btn = e.target.closest('.pay-method-btn');
        if (!btn) return;
        this.querySelectorAll('.pay-method-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('paymentMethod').value = btn.dataset.pay;
        document.getElementById('cashCalculator').style.display =
            btn.dataset.pay === 'cash' ? 'block' : 'none';
    });

    // ── Botones rápidos de efectivo ───────────────────────────
    document.getElementById('cashQuickBtns').addEventListener('click', function(e) {
        const btn = e.target.closest('.cash-quick-btn');
        if (!btn) return;
        this.querySelectorAll('.cash-quick-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('cashReceived').value = btn.dataset.amount;
        calcCambio();
    });

    // ── Input manual de efectivo ──────────────────────────────
    document.getElementById('cashReceived').addEventListener('input', function() {
        // Deselect quick buttons if user types manually
        document.querySelectorAll('.cash-quick-btn').forEach(b => b.classList.remove('active'));
        calcCambio();
    });

    addItemRow();
    document.getElementById('createOrderForm').addEventListener('submit', handleCreateOrder);
    modal.classList.add('active');
}

function calcCambio() {
    const total    = parseFloat(document.getElementById('modalTotal').textContent.replace('$','')) || 0;
    const received = parseFloat(document.getElementById('cashReceived').value) || 0;
    const display  = document.getElementById('cambioDisplay');
    const amountEl = document.getElementById('cambioAmount');

    if (received <= 0) { display.style.display = 'none'; return; }

    const cambio = received - total;
    display.style.display = 'flex';

    if (cambio < 0) {
        amountEl.textContent = '-$' + Math.abs(cambio).toFixed(2);
        amountEl.className   = 'cambio-amount cambio-negative';
    } else {
        amountEl.textContent = '$' + cambio.toFixed(2);
        amountEl.className   = 'cambio-amount cambio-positive';
    }
}

function closeOrderModal() {
    document.getElementById('orderModal').classList.remove('active');
}

// ==========================================
// ITEM ROWS — con dropdown de productos del menú
// ==========================================

function addItemRow(data = {}) {
    const list = document.getElementById('itemsList');
    if (!list) return;

    const row = document.createElement('div');
    row.className = 'item-row';

    // Construir opciones del dropdown
    const hasMenu = menuProducts.length > 0;
    const optionsHTML = hasMenu
        ? menuProducts.map(p =>
            `<div class="product-option" data-title="${escHtml(p.title)}" data-price="${p.price}">
                <span class="product-opt-name">${escHtml(p.title)}</span>
                <span class="product-opt-price">$${p.price.toFixed(2)}</span>
             </div>`
          ).join('')
        : `<div class="product-option-empty">Sin productos en Mi Negocio</div>`;

    const selectedName  = data.name  || '';
    const selectedPrice = data.price || '';

    row.innerHTML = `
      <input type="number" class="form-input item-qty" placeholder="Cant." min="1" value="${data.quantity || 1}">

      <div class="product-dropdown-wrapper">
        <input type="text" class="form-input item-name product-dropdown-input"
               placeholder="${hasMenu ? 'Seleccionar producto…' : 'Nombre del producto'}"
               value="${escHtml(selectedName)}" autocomplete="off">
        ${hasMenu ? `<div class="product-dropdown-menu">
          <div class="product-dropdown-search-wrap">
            <svg style="width:1em;height:1em;vertical-align:middle;flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" class="product-dropdown-search" placeholder="Buscar…">
          </div>
          <div class="product-options-list">${optionsHTML}</div>
        </div>` : ''}
      </div>

      <input type="number" class="form-input item-price" placeholder="Precio" step="0.01" min="0" value="${selectedPrice}">
      <input type="text"   class="form-input item-notes" placeholder="Notas" value="${data.notes || ''}">
      <button type="button" class="btn-remove-item-row" onclick="this.closest('.item-row').remove(); recalcTotal()">
        <svg style="width:1em;height:1em;vertical-align:middle;flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>`;

    // ── Lógica del dropdown ───────────────────────────────────
    if (hasMenu) {
        const nameInput    = row.querySelector('.product-dropdown-input');
        const menu         = row.querySelector('.product-dropdown-menu');
        const searchInput  = row.querySelector('.product-dropdown-search');
        const optionsList  = row.querySelector('.product-options-list');
        const priceInput   = row.querySelector('.item-price');
        const wrapper      = row.querySelector('.product-dropdown-wrapper');

        // Abrir al hacer focus o click
        nameInput.addEventListener('focus', () => openProductMenu(wrapper));
        nameInput.addEventListener('click', () => openProductMenu(wrapper));

        // Filtrar opciones con búsqueda
        searchInput.addEventListener('input', function () {
            const term = this.value.toLowerCase();
            optionsList.querySelectorAll('.product-option').forEach(opt => {
                opt.style.display = opt.dataset.title.toLowerCase().includes(term) ? '' : 'none';
            });
        });
        searchInput.addEventListener('click', e => e.stopPropagation());

        // Seleccionar opción
        optionsList.addEventListener('click', function (e) {
            const opt = e.target.closest('.product-option');
            if (!opt) return;
            nameInput.value  = opt.dataset.title;
            priceInput.value = opt.dataset.price;
            closeProductMenu(wrapper);
            recalcTotal();
        });

        // Permitir también escritura libre (nombre personalizado)
        nameInput.addEventListener('input', function () {
            openProductMenu(wrapper);
            const term = this.value.toLowerCase();
            optionsList.querySelectorAll('.product-option').forEach(opt => {
                opt.style.display = opt.dataset.title.toLowerCase().includes(term) ? '' : 'none';
            });
        });
    }

    row.querySelectorAll('.item-qty, .item-price').forEach(i =>
        i.addEventListener('input', recalcTotal));
    list.appendChild(row);
}

function openProductMenu(wrapper) {
    // Cerrar otros menús abiertos primero
    document.querySelectorAll('.product-dropdown-wrapper.open').forEach(w => {
        if (w !== wrapper) closeProductMenu(w);
    });
    wrapper.classList.add('open');
    const search = wrapper.querySelector('.product-dropdown-search');
    if (search) { search.value = ''; search.focus(); }
    // Mostrar todas las opciones al abrir
    wrapper.querySelectorAll('.product-option').forEach(o => o.style.display = '');
}

function closeProductMenu(wrapper) {
    wrapper.classList.remove('open');
}

// Cerrar menús al click fuera
document.addEventListener('click', e => {
    if (!e.target.closest('.product-dropdown-wrapper')) {
        document.querySelectorAll('.product-dropdown-wrapper.open').forEach(w => closeProductMenu(w));
    }
});

function recalcTotal() {
    let sum = 0;
    document.querySelectorAll('.item-row').forEach(row => {
        const qty   = parseFloat(row.querySelector('.item-qty')?.value)   || 0;
        const price = parseFloat(row.querySelector('.item-price')?.value) || 0;
        sum += qty * price;
    });
    const el = document.getElementById('modalTotal');
    if (el) el.textContent = '$' + sum.toFixed(2);
    // Recalc cambio live when total changes
    const cashCalc = document.getElementById('cashCalculator');
    if (cashCalc && cashCalc.style.display !== 'none') calcCambio();
}

function collectItems() {
    const items = [];
    document.querySelectorAll('.item-row').forEach(row => {
        const name = row.querySelector('.item-name')?.value.trim();
        if (!name) return;
        items.push({
            name,
            quantity: parseInt(row.querySelector('.item-qty')?.value)    || 1,
            price:    parseFloat(row.querySelector('.item-price')?.value) || 0,
            notes:    row.querySelector('.item-notes')?.value.trim()      || '',
        });
    });
    return items;
}

// ==========================================
// SUBMIT
// ==========================================

async function handleCreateOrder(e) {
    e.preventDefault();
    const items         = collectItems();
    const total         = items.reduce((s, i) => s + i.quantity * i.price, 0);
    const paymentMethod = document.getElementById('paymentMethod').value;
    const cashReceived  = paymentMethod === 'cash'
        ? (parseFloat(document.getElementById('cashReceived').value) || 0)
        : 0;

    // Validar que si es efectivo, el monto sea suficiente
    if (paymentMethod === 'cash' && cashReceived > 0 && cashReceived < total) {
        showNotification(t('orders_amount_low', 'El monto recibido es menor al total del pedido'), 'warning');
        return;
    }

    const body = {
        clientName:      document.getElementById('clientName').value.trim(),
        clientPhone:     document.getElementById('clientPhone').value.trim(),
        orderType:       document.getElementById('orderType').value,
        estimatedTime:   parseInt(document.getElementById('estimatedTime').value) || 30,
        deliveryAddress: document.getElementById('deliveryAddress')?.value.trim() || '',
        items,
        total,
        notes:          document.getElementById('orderNotes').value.trim(),
        paymentMethod,
        cashReceived,
        status: 'pending',
    };

    const btn  = e.target.querySelector('.btn-submit');
    const orig = btn.innerHTML;
    btn.innerHTML = `<div class="loading-spinner-small"></div><span>${t('loading', 'Cargando...')}</span>`;
    btn.disabled  = true;

    try {
        const res = await fetch('/api/orders', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Error al crear el pedido');
        }
        closeOrderModal();
        showNotification(t('orders_created_ok', 'Pedido creado exitosamente'), 'success');
        await loadOrders(); updateStats(); renderOrders();
    } catch (err) {
        showNotification(err.message, 'error');
        btn.innerHTML = orig;
        btn.disabled  = false;
    }
}

// ==========================================
// ACTIONS
// ==========================================

async function updateStatus(id, status) {
    closeAllDropdowns();
    try {
        const res = await fetch(`/api/orders/${id}/status`, {
            method: 'PATCH', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status }),
        });
        if (!res.ok) throw new Error('Error actualizando');
        showNotification(`Pedido → ${statusLabel(status)}`, 'success');
        await loadOrders(); updateStats(); renderOrders();
    } catch (err) {
        showNotification(err.message, 'error');
    }
}

function deleteOrder(id, name) {
    closeAllDropdowns();
    showConfirmModal({
        type: 'danger', icon: 'lni-trash-can',
        title: '¿Eliminar pedido?',
        message: `Pedido de <strong>${name}</strong>`,
        list: [t('settings_delete_modal_desc', 'Esta acción no se puede deshacer')],
        confirmText: t('settings_delete_btn', 'Eliminar'),
        onConfirm: async () => {
            const res = await fetch(`/api/orders/${id}`, { method: 'DELETE', credentials: 'include' });
            if (!res.ok) throw new Error('Error eliminando');
            showNotification(t('orders_deleted_ok', 'Pedido eliminado'), 'success');
            await loadOrders(); updateStats(); renderOrders();
        },
    });
}

function sendWhatsApp(phone, name, id) {
    const o   = orders.find(x => x.id == id);
    const items = o ? itemsToText(o.items) : '';
    const msg = encodeURIComponent(`Hola ${name}, tu pedido está listo:\n${items}\nTotal: $${(o?.total||0).toFixed(2)}`);
    window.open(`https://wa.me/${phone.replace(/\D/g,'')}?text=${msg}`, '_blank');
    closeAllDropdowns();
}

// ==========================================
// FILTER HELPERS
// ==========================================

function selectFilterOption(el, labelId, filterKey, value) {
    const spanEl = el.querySelector('span:last-child') || el.querySelector('span');
    const text = spanEl?.innerText || '';
    const labelEl = document.getElementById(labelId);
    labelEl.innerText = text;

    // Si la opción tiene su propia key de traducción (ej. "Todos los estados"
    // o un estado/tipo concreto), el trigger la hereda para poder re-traducirse
    // al cambiar de idioma. Si no (ej. nombre de un agente), se suelta.
    const key = spanEl?.getAttribute('data-translate');
    if (key) {
        labelEl.setAttribute('data-translate', key);
    } else {
        labelEl.removeAttribute('data-translate');
    }

    const parent = el.closest('.dropdown-options');
    parent.querySelectorAll('.dropdown-option').forEach(o => o.classList.remove('selected'));
    el.classList.add('selected');
    currentFilters[filterKey] = value;
    el.closest('.custom-dropdown-wrapper').classList.remove('active');
    renderOrders();
}

document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('searchInput');
    if (searchInput) searchInput.addEventListener('input', function () {
        currentFilters.search = this.value.toLowerCase();
        renderOrders();
    });
});

// ==========================================
// DROPDOWN UTILITIES
// ==========================================

function toggleDropdown(e, id, btn) {
    e.stopPropagation();
    const el = document.getElementById(`dropdown-${id}`);
    if (!el) return;

    // Cerrar anterior
    if (openDropdown && openDropdown !== el) {
        openDropdown.classList.remove('active');
        openDropdown.style.cssText = '';
    }

    const isOpen = el.classList.contains('active');
    el.classList.toggle('active');

    if (!isOpen) {
        // btn siempre es el botón real (pasado como `this`)
        const rect = btn.getBoundingClientRect();
        const menuH = 220; // altura estimada del menú
        const spaceBelow = window.innerHeight - rect.bottom;

        el.style.position = 'fixed';
        el.style.right = (window.innerWidth - rect.right) + 'px';
        el.style.left  = 'auto';
        el.style.zIndex = '9999';

        if (spaceBelow >= menuH) {
            // Hay espacio abajo → mostrar debajo del botón
            el.style.top    = (rect.bottom + 6) + 'px';
            el.style.bottom = 'auto';
        } else {
            // Sin espacio abajo → mostrar encima del botón
            el.style.bottom = (window.innerHeight - rect.top + 6) + 'px';
            el.style.top    = 'auto';
        }

        openDropdown = el;
    } else {
        el.style.cssText = '';
        openDropdown = null;
    }
}

function closeAllDropdowns() {
    document.querySelectorAll('.actions-menu').forEach(m => {
        m.classList.remove('active');
        m.style.cssText = '';
    });
    openDropdown = null;
}

// ==========================================
// EMPTY STATE
// ==========================================

function showEmptyState() {
    const e = document.getElementById('emptyState');
    const v = document.getElementById('ordersTableView');
    if (e) e.style.display = 'flex';
    const t = document.getElementById('ordersList');
    if (t) t.innerHTML = '';
    if (v) v.style.display = 'none';
}

function hideEmptyState() {
    const e = document.getElementById('emptyState');
    const v = document.getElementById('ordersTableView');
    if (e) e.style.display = 'none';
    if (v) v.style.display = 'block';
}

// ==========================================
// CONFIRM MODAL
// ==========================================

function showConfirmModal({ type='danger', icon='lni-trash-can', title, message, list=[], confirmText='Confirmar', onConfirm }) {
    let modal = document.getElementById('confirmModal');
    if (!modal) { modal = document.createElement('div'); modal.id = 'confirmModal'; modal.className = 'confirm-modal'; document.body.appendChild(modal); }
    modal.innerHTML = `
      <div class="confirm-overlay" onclick="closeConfirmModal()"></div>
      <div class="confirm-content">
        <div class="confirm-header">
          <div class="confirm-icon ${type}"><i class="lni ${icon}"></i></div>
          <h3 class="confirm-title">${title}</h3>
          <p class="confirm-message">${message}</p>
        </div>
        <div class="confirm-body">
          ${list.length ? `<div class="confirm-list">${list.map(i=>`<div class="confirm-list-item"><svg style="width:1em;height:1em;vertical-align:middle;flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg><span>${i}</span></div>`).join('')}</div>` : ''}
          <div class="confirm-actions">
            <button class="btn-confirm-cancel" onclick="closeConfirmModal()"><svg style="width:1em;height:1em;vertical-align:middle;flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>Cancelar</button>
            <button class="btn-confirm-action danger" id="confirmActionBtn"><svg style="width:1em;height:1em;vertical-align:middle;flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>${confirmText}</button>
          </div>
        </div>
      </div>`;
    modal.classList.add('active');
    document.getElementById('confirmActionBtn').addEventListener('click', async function () {
        this.innerHTML = `<div class="loading-spinner-small"></div>Procesando...`;
        this.disabled = true;
        try { await onConfirm(); closeConfirmModal(); }
        catch (e) { this.disabled = false; this.innerHTML = confirmText; showNotification('Error, intenta de nuevo', 'error'); }
    });
}

function closeConfirmModal() {
    const m = document.getElementById('confirmModal');
    if (m) { m.classList.remove('active'); setTimeout(() => m.remove(), 300); }
}

// ==========================================
// HELPERS
// ==========================================

function itemsToText(items) {
    if (!items || !items.length) return '—';
    return items.map(i => `${i.quantity}x ${i.name}`).join(', ');
}

function statusLabel(s) {
    return {
        pending: t('orders_stat_pending','Pendiente'),
        confirmed: t('orders_status_confirmed','Confirmado'),
        preparing: t('orders_stat_preparing','En preparación'),
        ready: t('orders_status_ready','Listo'),
        delivered: t('orders_status_delivered','Entregado'),
        cancelled: t('orders_status_cancelled','Cancelado')
    }[s] || s;
}

function sourceLabel(s) {
    return { manual: t('hist_source_manual','Manual'), agent:'WhatsApp Bot', ninda:'Ninda' }[s] || s;
}

function escHtml(t) {
    if (!t) return '';
    return String(t).replace(/[&<>"']/g, m =>
        ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[m]));
}

function showNotification(message, type = 'info') {
    const titles = {
        success: t('hist_notif_title_success','Listo'),
        error:   t('hist_notif_title_error','Error'),
        warning: t('hist_notif_title_warning','Aviso'),
        info:    t('hist_notif_title_info','Info')
    };
    if (typeof Sileo !== 'undefined' && Sileo[type]) {
        Sileo[type]({ title: titles[type], description: message });
    } else {
        const color = type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : type === 'warning' ? '#f59e0b' : '#06b6d4';
        const d = document.createElement('div');
        d.style.cssText = `position:fixed;top:1.5rem;left:50%;transform:translateX(-50%);background:white;color:#18181b;padding:.75rem 1.25rem;border-radius:20px;z-index:10000;font-weight:600;font-size:.875rem;box-shadow:0 8px 32px rgba(0,0,0,.10);border:1px solid rgba(0,0,0,.08);display:flex;align-items:center;gap:.5rem;`;
        d.innerHTML = `<span style="background:${color}22;color:${color};border-radius:9999px;width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-size:.75rem;">●</span><span>${message}</span>`;
        document.body.appendChild(d);
        setTimeout(() => { d.style.opacity='0'; d.style.transition='opacity .3s'; setTimeout(()=>d.remove(),300); }, 3000);
    }
}
/* ============================================
   ORDERS PAGE TABS
   ============================================ */
document.querySelectorAll('.orders-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const target = tab.dataset.tab;
        document.querySelectorAll('.orders-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.orders-tab-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        const panel = document.getElementById('tab-' + target);
        if (panel) panel.classList.add('active');
        // Al entrar al POS cargar productos
        if (target === 'punto-venta') posLoadProducts();
    });
});

/* ============================================
   PUNTO DE VENTA (POS)
   ============================================ */
const posState = {
    items: [],        // { id, name, price, qty }
    type: 'dine_in',
    payment: 'efectivo',
    customerName: '',
    customerPhone: '',
    notes: '',
};

/* ── Cargar productos desde la API ── */
let _posAllServices = []; // cache para búsqueda sin re-fetch

async function posLoadProducts() {
    const grid = document.getElementById('posProductsGrid');
    if (!grid) return;

    // Loading state
    grid.innerHTML = `<div class="pos-empty-catalog" style="color:#9ca3af;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:2rem;height:2rem;color:#d1d5db;animation:spin 1s linear infinite;">
            <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
        </svg>
        <span>Cargando catálogo...</span>
    </div>`;

    try {
        const resp = await fetch('/api/my-business', { credentials: 'include' });
        if (!resp.ok) throw new Error();
        const data = await resp.json();

        // ✅ Path correcto según my-business.js: branch.services
        const branch   = data.activeBranch || data.defaultBranch;
        const services = branch?.services || branch?.business?.services || [];

        _posAllServices = services;
        posRenderCatalog(services);
    } catch (_) {
        grid.innerHTML = `<div class="pos-empty-catalog">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:2rem;height:2rem;color:#d1d5db;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <span>No se pudo cargar el catálogo.</span>
        </div>`;
    }
}

function posRenderCatalog(services) {
    const grid = document.getElementById('posProductsGrid');
    if (!grid) return;
    const query = (document.getElementById('posProductSearch')?.value || '').toLowerCase().trim();

    const filtered = services.filter(s => {
        const inStock = s.inStock !== false && s.InStock !== false;
        const nm = (s.name || s.Name || '').toLowerCase();
        return inStock && (!query || nm.includes(query));
    });

    if (filtered.length === 0) {
        grid.innerHTML = `<div class="pos-empty-catalog">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:2.5rem;height:2.5rem;color:#d1d5db;">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
                <line x1="12" y1="22.08" x2="12" y2="12"/>
            </svg>
            <span>${query
                ? `Sin resultados para "<strong>${query}</strong>"`
                : 'Agrega productos en <strong>Mi Negocio → Servicios / Productos</strong> para verlos aquí.'}</span>
        </div>`;
        return;
    }

    grid.innerHTML = filtered.map(s => {
        // ✅ Nombre: Go puede serializar como "Name" o "name"
        const name  = s.name || s.Name || s.serviceName || s.ServiceName || s.title || s.Title || 'Sin nombre';

        // ✅ Precio: puede ser normal o promo, y Go puede capitalizar
        const priceType = s.priceType || s.PriceType || 'normal';
        const price = priceType === 'promo'
            ? parseFloat(s.promoPrice || s.PromoPrice || s.price || s.Price || 0)
            : parseFloat(s.price || s.Price || 0);

        // ✅ Imagen: imageUrls es array, imageUrl es string fallback
        const imgUrls = s.imageUrls || s.ImageUrls || (s.imageUrl || s.ImageUrl ? [s.imageUrl || s.ImageUrl] : []);
        const imgSrc  = imgUrls[0] || '';

        // ✅ ID y nombre como data-attributes (evita conflicto de comillas en onclick)
        const rawId = s.id || s.ID || s.serviceId || name;

        return `
        <div class="pos-product-card"
             data-id="${String(rawId).replace(/"/g, '&quot;')}"
             data-name="${name.replace(/"/g, '&quot;')}"
             data-price="${price}">
            ${imgSrc
                ? `<div class="pos-product-img-wrap"><img class="pos-product-img" src="${imgSrc}" alt="${name.replace(/"/g,'')}" loading="lazy" onerror="this.parentElement.style.display='none'"></div>`
                : ''}
            <div class="pos-product-name">${name}</div>
            <div class="pos-product-price">$${price.toFixed(2)}</div>
            ${(s.priceType === 'promo' || s.PriceType === 'promo') && (s.originalPrice || s.OriginalPrice)
                ? `<div class="pos-product-original">$${parseFloat(s.originalPrice || s.OriginalPrice).toFixed(2)}</div>`
                : ''}
        </div>`;
    }).join('');

    // ── Delegación de eventos en el grid (un solo listener, sin problemas de comillas) ──
    grid.removeEventListener('click', _posGridClickHandler);
    grid.addEventListener('click', _posGridClickHandler);
}

function _posGridClickHandler(e) {
    const card = e.target.closest('.pos-product-card');
    if (!card) return;
    const id    = card.dataset.id;
    const name  = card.dataset.name;
    const price = parseFloat(card.dataset.price) || 0;
    posAddItem(id, name, price);
}

document.getElementById('posProductSearch')?.addEventListener('input', () => {
    posRenderCatalog(_posAllServices);
});

/* ── Agregar item al pedido ── */
function posAddItem(id, name, price) {
    const existing = posState.items.find(i => i.id === id);
    if (existing) {
        existing.qty++;
    } else {
        posState.items.push({ id, name, price, qty: 1 });
    }
    posRenderItems();
    posTotals();
}

function posRemoveItem(id) {
    posState.items = posState.items.filter(i => i.id !== id);
    posRenderItems();
    posTotals();
}

function posChangeQty(id, delta) {
    const item = posState.items.find(i => i.id === id);
    if (!item) return;
    item.qty += delta;
    if (item.qty <= 0) posState.items = posState.items.filter(i => i.id !== id);
    posRenderItems();
    posTotals();
}

function posRenderItems() {
    const list = document.getElementById('posItemsList');
    const empty = document.getElementById('posItemsEmpty');
    if (!list) return;

    if (posState.items.length === 0) {
        list.innerHTML = '';
        const emptyEl = document.createElement('div');
        emptyEl.id = 'posItemsEmpty';
        emptyEl.className = 'pos-items-empty';
        emptyEl.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:2.5rem;height:2.5rem;color:#d1d5db;"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><line x1="3" x2="21" y1="6" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg><span>Agrega productos al pedido</span>`;
        list.appendChild(emptyEl);
        return;
    }

    list.innerHTML = posState.items.map((item, idx) => `
        <div class="pos-item-row" data-idx="${idx}">
            <span class="pos-item-name" title="${item.name}">${item.name}</span>
            <div class="pos-item-qty">
                <button class="pos-qty-btn" data-action="dec" data-idx="${idx}">−</button>
                <span class="pos-qty-num">${item.qty}</span>
                <button class="pos-qty-btn" data-action="inc" data-idx="${idx}">+</button>
            </div>
            <span class="pos-item-price">$${(item.price * item.qty).toFixed(2)}</span>
            <button class="pos-item-remove" data-action="remove" data-idx="${idx}" title="Quitar">
                <svg style="width:1em;height:1em;vertical-align:middle;flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        </div>
    `).join('');

    // Delegación en la lista
    list.removeEventListener('click', _posItemListHandler);
    list.addEventListener('click', _posItemListHandler);
}

function _posItemListHandler(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const idx = parseInt(btn.dataset.idx, 10);
    const item = posState.items[idx];
    if (!item) return;
    if (btn.dataset.action === 'inc') {
        item.qty++;
    } else if (btn.dataset.action === 'dec') {
        item.qty--;
        if (item.qty <= 0) posState.items.splice(idx, 1);
    } else if (btn.dataset.action === 'remove') {
        posState.items.splice(idx, 1);
    }
    posRenderItems();
    posTotals();
}

/* ── Totales ── */
function posTotals() {
    const subtotal = posState.items.reduce((s, i) => s + i.price * i.qty, 0);
    document.getElementById('posSubtotal').textContent = '$' + subtotal.toFixed(2);
    document.getElementById('posTotal').textContent = '$' + subtotal.toFixed(2);
    posCalcChange();
}

/* ── Cambio ── */
function posCalcChange() {
    const total = posState.items.reduce((s, i) => s + i.price * i.qty, 0);
    const pays  = parseFloat(document.getElementById('posClientPays')?.value || 0);
    const change = pays > 0 ? Math.max(0, pays - total) : 0;
    const el = document.getElementById('posChange');
    if (el) el.textContent = '$' + change.toFixed(2);
}

document.getElementById('posClientPays')?.addEventListener('input', posCalcChange);

/* ── Tipo de pedido ── */
document.querySelectorAll('.pos-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.pos-type-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        posState.type = btn.dataset.type;
    });
});

/* ── Método de pago ── */
document.querySelectorAll('.pos-pay-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.pos-pay-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        posState.payment = btn.dataset.pay;
        const changeRow = document.getElementById('posChangeRow');
        if (changeRow) changeRow.style.display = posState.payment === 'efectivo' ? '' : 'none';
    });
});

/* ── Limpiar pedido ── */
document.getElementById('posClearBtn')?.addEventListener('click', () => {
    posState.items = [];
    posRenderItems();
    posTotals();
    document.getElementById('posCustomerName').value = '';
    document.getElementById('posCustomerPhone').value = '';
    document.getElementById('posNotes').value = '';
    document.getElementById('posClientPays').value = '';
});

/* ── Crear pedido desde POS ── */
document.getElementById('posSubmitBtn')?.addEventListener('click', async () => {
    if (posState.items.length === 0) {
        if (typeof sileo !== 'undefined') sileo.warning('Agrega al menos un producto al pedido.');
        else alert('Agrega al menos un producto al pedido.');
        return;
    }

    const customerName = document.getElementById('posCustomerName')?.value.trim() || 'Cliente POS';
    const btn = document.getElementById('posSubmitBtn');
    btn.disabled = true;
    btn.innerHTML = '<svg style="width:1em;height:1em;vertical-align:middle;animation:spin 1s linear infinite" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Creando...';

    const payload = {
        customerName,
        customerPhone: document.getElementById('posCustomerPhone')?.value.trim() || '',
        orderType: posState.type,
        paymentMethod: posState.payment,
        notes: document.getElementById('posNotes')?.value.trim() || '',
        items: posState.items.map(i => ({
            productId: i.id,
            name: i.name,
            price: i.price,
            quantity: i.qty,
        })),
        totalAmount: posState.items.reduce((s, i) => s + i.price * i.qty, 0),
        source: 'pos',
    };

    try {
        const agentId = window._currentAgentId || null;
        const url = agentId ? `/api/orders?agentId=${agentId}` : '/api/orders';
        const resp = await fetch(url, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (!resp.ok) throw new Error();

        if (typeof sileo !== 'undefined') sileo.success('¡Pedido creado exitosamente!');
        else alert('¡Pedido creado exitosamente!');

        // Limpiar y recargar
        posState.items = [];
        posRenderItems();
        posTotals();
        document.getElementById('posCustomerName').value = '';
        document.getElementById('posCustomerPhone').value = '';
        document.getElementById('posNotes').value = '';
        document.getElementById('posClientPays').value = '';

        // Recargar la lista de pedidos en background
        if (typeof loadOrders === 'function') loadOrders();

    } catch (_) {
        if (typeof sileo !== 'undefined') sileo.error('Error al crear el pedido. Inténtalo de nuevo.');
        else alert('Error al crear el pedido.');
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:1.1rem;height:1.1rem;"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><line x1="3" x2="21" y1="6" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg> Crear Pedido`;
    }
});

// ============================================================================
// CAPA iOS 27 — Mis Citas y Mis Pedidos
// El mismo bloque va al final de appointments.js y de orders.js. Mis Citas
// carga los dos archivos, así que el candado de abajo evita correrlo dos veces.
// No cambia la lógica de arriba: observa clases y nodos nuevos.
// ============================================================================
(function () {
    if (window.__attomosIosPages) return;
    window.__attomosIosPages = true;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
    const lerp = (a, b, t) => a + (b - a) * t;
    const SUPPORTS_LINEAR = window.CSS && CSS.supports('animation-timing-function', 'linear(0, 1)');
    const SPRING = SUPPORTS_LINEAR
        ? 'linear(0, 0.04, 0.139, 0.271, 0.416, 0.56, 0.691, 0.805, 0.897, 0.969, 1.021, 1.055, 1.074, 1.082, 1.081, 1.075, 1.065, 1.053, 1.041, 1.03, 1.02, 1.011, 1.005, 1, 0.996, 0.994, 0.993, 0.993, 0.994, 0.994, 0.995, 0.996, 0.997, 0.998, 0.999, 0.999, 1, 1, 1, 1.001, 1.001, 1.001, 1.001, 1, 1, 1, 1, 1, 1)'
        : 'cubic-bezier(0.34, 1.35, 0.64, 1)';

    // --- Motor de resortes ---
    const springs = new Set();
    const renderers = new Set();
    const spring = (v = 0, k = 380, d = 30, eps = 0.1) => {
        const s = { v, vel: 0, t: v, k, d, eps };
        springs.add(s);
        return s;
    };
    const atRest = (s) => Math.abs(s.v - s.t) < s.eps && Math.abs(s.vel) < s.eps * 5;
    let raf = null, last = 0;
    function tick(now) {
        const dt = Math.min((now - last) / 1000, 1 / 30);
        last = now;
        springs.forEach((s) => {
            if (reduce.matches) { s.v = s.t; s.vel = 0; return; }
            s.vel += (-s.k * (s.v - s.t) - s.d * s.vel) * dt;
            s.v += s.vel * dt;
        });
        renderers.forEach((r) => r());
        if ([...springs].every(atRest)) {
            springs.forEach((s) => { s.v = s.t; s.vel = 0; });
            renderers.forEach((r) => r());
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
    const pop = (el, from = 0.85, duration = 520) => {
        if (!el || reduce.matches || !el.animate) return;
        el.animate([{ transform: `scale(${from})` }, { transform: 'scale(1)' }], { duration, easing: SPRING });
    };

    // ====================================================================
    // 1. ENTRADA DE LA PÁGINA y de cada pestaña
    // ====================================================================
    function rise(elements, startAt = 0) {
        let i = startAt;
        elements.forEach((el) => {
            if (!el) return;
            el.classList.remove('ios-in');
            void el.offsetWidth;   // reinicia la animación si ya la tenía
            el.style.setProperty('--i', i++);
            el.classList.add('ios-in');
        });
        return i;
    }
    function panelParts(panel) {
        if (!panel) return [];
        if (panel.id === 'tab-punto-venta') return [...panel.querySelectorAll('.pos-catalog, .pos-ticket')];
        return [
            ...panel.querySelectorAll('.stats-grid > .stat-card'),
            panel.querySelector('.controls-section'),
            ...panel.querySelectorAll('.orders-container, .appointments-container, .calendar-container, .empty-state'),
        ];
    }
    function pageEntrance() {
        const header = document.querySelector('.page-header');
        const i = rise([
            header?.querySelector('.header-title'),
            header?.querySelector('.header-actions'),
            document.querySelector('.orders-tabs-bar'),
        ]);
        rise(panelParts(document.querySelector('.orders-tab-panel.active')), i);
        document.addEventListener('animationend', (e) => {
            if (e.animationName === 'iosRiseMove' && e.target.classList.contains('ios-in')) {
                e.target.classList.remove('ios-in');
            }
        });
    }

    // ====================================================================
    // 2. NÚMEROS DE LAS TARJETAS (también montos con $)
    // ====================================================================
    const countingNow = new WeakSet();
    function parseStat(text) {
        const raw = text.trim();
        if (/^\d+$/.test(raw)) return { n: parseInt(raw, 10), money: false };
        const m = /^\$([\d,]+(?:\.\d+)?)$/.exec(raw);
        if (m) return { n: parseFloat(m[1].replace(/,/g, '')), money: true, commas: raw.includes(',') };
        return null;
    }
    function formatStat(n, info) {
        if (!info.money) return String(Math.round(n));
        return '$' + (info.commas
            ? n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            : n.toFixed(2));
    }
    function countTo(el, from, to, info) {
        if (from === to || reduce.matches) return;
        countingNow.add(el);
        const start = performance.now(), dur = 750;
        (function frame(now) {
            const t = clamp((now - start) / dur);
            const e = 1 - Math.pow(1 - t, 3);
            el.textContent = formatStat(from + (to - from) * e, info);
            if (t < 1) requestAnimationFrame(frame);
            else {
                el.textContent = formatStat(to, info);
                requestAnimationFrame(() => countingNow.delete(el));
            }
        })(start);
    }
    function watchNumbers() {
        document.querySelectorAll('.stats-grid .stat-value').forEach((el) => {
            let shown = parseStat(el.textContent)?.n || 0;
            new MutationObserver(() => {
                if (countingNow.has(el)) return;
                const info = parseStat(el.textContent);
                if (!info || info.n === shown) return;
                const prev = shown;
                shown = info.n;
                el.textContent = formatStat(prev, info);
                countTo(el, prev, info.n, info);
            }).observe(el, { childList: true, characterData: true, subtree: true });
        });
    }

    // ====================================================================
    // 3. SEGMENTADOS: cápsula que se desliza (pestañas, vista, tipo, pago)
    // ====================================================================
    const SEGMENTS = [
        ['.orders-tabs-bar', '.orders-tab', 'tint'],
        ['.view-controls', '.view-btn', 'light'],
        ['.pos-type-row', '.pos-type-btn', 'tint'],
        ['.pos-payment-btns', '.pos-pay-btn', 'tint'],
        ['.pay-method-toggle', '.pay-method-btn', 'soft'],
    ];
    const segments = new WeakSet();
    function segmentFor(group, btnSel, tone) {
        if (segments.has(group)) return;
        segments.add(group);
        group.classList.add('ios-seg', `ios-seg-${tone}`);
        const thumb = document.createElement('span');
        thumb.className = 'ios-seg-thumb';
        thumb.setAttribute('aria-hidden', 'true');
        group.prepend(thumb);

        const X = spring(0, 440, 30), Y = spring(0, 440, 30), W = spring(0, 440, 30), H = spring(0, 440, 30);
        const S = spring(1, 600, 30, 0.001);
        let ready = false;

        function place(snap) {
            const a = group.querySelector(`${btnSel}.active`);
            if (!a || !group.offsetWidth || !a.offsetWidth) { ready = false; render(); return; }
            X.t = a.offsetLeft; Y.t = a.offsetTop; W.t = a.offsetWidth; H.t = a.offsetHeight;
            if (snap || !ready) {
                [X, Y, W, H].forEach((s) => { s.v = s.t; s.vel = 0; });
            }
            ready = true;
            render();
            kick();
        }
        function render() {
            if (!group.isConnected) { renderers.delete(render); [X, Y, W, H, S].forEach((s) => springs.delete(s)); return; }
            if (!ready) { thumb.style.opacity = 0; return; }
            const st = Math.min(Math.abs(X.vel) / 2600, 0.16);
            thumb.style.opacity = 1;
            thumb.style.width = `${W.v}px`;
            thumb.style.height = `${H.v}px`;
            thumb.style.transform = `translate(${X.v}px, ${Y.v}px) scale(${S.v * (1 + st)}, ${S.v * (1 - st * 0.4)})`;
        }
        renderers.add(render);

        // La lógica original cambia .active; aquí solo se sigue ese cambio
        new MutationObserver(() => place(false))
            .observe(group, { subtree: true, attributes: true, attributeFilter: ['class'] });
        group.addEventListener('pointerdown', (e) => {
            if (e.target.closest(`${btnSel}.active`)) { S.t = 0.94; kick(); }
        });
        const release = () => { S.t = 1; kick(); };
        ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => group.addEventListener(ev, release));
        if (window.ResizeObserver) new ResizeObserver(() => place(true)).observe(group);
        place(true);
    }
    function enhanceSegments(root = document) {
        SEGMENTS.forEach(([sel, btn, tone]) => {
            if (root.matches?.(sel)) segmentFor(root, btn, tone);
            root.querySelectorAll?.(sel).forEach((g) => segmentFor(g, btn, tone));
        });
    }

    // ====================================================================
    // 4. MENÚS: filtros, dropdowns del modal, productos y acciones de la tabla
    // Nacen del botón con resorte y tienen una cápsula que sigue al cursor.
    // ====================================================================
    const CLOSED_CLIP = 'inset(50% 50% 50% 50%)';
    const menus = new WeakMap();
    const ACTION_TONES = ['whatsapp', 'sheet', 'complete', 'preparing', 'ready', 'delivered', 'cancel', 'delete'];

    function describeMenu(el) {
        if (el.matches('.custom-dropdown-wrapper')) {
            const menu = el.querySelector(':scope > .dropdown-menu');
            return menu && {
                menu, root: el,
                anchor: el.querySelector(':scope > .form-dropdown, :scope > .filter-trigger, :scope > .form-input') || el,
                container: menu.querySelector('.dropdown-options') || menu,
                itemSel: '.dropdown-option',
                isOpen: () => el.classList.contains('active'),
            };
        }
        if (el.matches('.product-dropdown-wrapper')) {
            const menu = el.querySelector('.product-dropdown-menu');
            return menu && {
                menu, root: el,
                anchor: el.querySelector('.product-dropdown-input') || el,
                container: menu.querySelector('.product-options-list') || menu,
                itemSel: '.product-option',
                isOpen: () => el.classList.contains('open'),
            };
        }
        if (el.matches('.actions-menu')) {
            return {
                menu: el, root: el.parentElement,
                anchor: el.parentElement.querySelector('.actions-btn') || el.parentElement,
                container: el,
                itemSel: '.action-item',
                tones: true,
                isOpen: () => el.classList.contains('active'),
            };
        }
        return null;
    }

    function menuFor(el) {
        if (menus.has(el)) return menus.get(el);
        const d = describeMenu(el);
        if (!d) return null;
        const { menu, anchor, container, itemSel } = d;

        menu.classList.add('ios-dd');
        menu.style.visibility = 'hidden';
        menu.style.clipPath = CLOSED_CLIP;

        const ind = document.createElement('span');
        ind.className = 'ios-dd-ind';
        ind.setAttribute('aria-hidden', 'true');
        container.prepend(ind);

        const P = spring(0, 400, 30, 0.001);
        const X = spring(0, 520, 36), Y = spring(0, 520, 36), W = spring(0, 520, 36), H = spring(0, 520, 36);
        const V = spring(0, 600, 44, 0.001);
        let open = false, hovered = null, savedPos = null;

        function render() {
            if (!menu.isConnected) {
                renderers.delete(render);
                [P, X, Y, W, H, V].forEach((s) => springs.delete(s));
                return;
            }
            const p = P.v, pc = clamp(p);
            if (p < 0.002 && P.t === 0) {
                menu.style.visibility = 'hidden';
                menu.style.clipPath = CLOSED_CLIP;
                anchor.classList.remove('ios-dd-anchor-open');
                d.root?.classList.remove('ios-dd-host');
                savedPos = null;
            } else {
                // orders.js borra el style del menú de acciones al cerrarlo;
                // se repone la posición mientras termina la animación
                if (!open && savedPos && !menu.style.position) Object.assign(menu.style, savedPos);
                menu.style.visibility = 'visible';
                menu.style.setProperty('--ios-p', pc.toFixed(3));
                if (open && atRest(P)) menu.style.clipPath = 'none';
                else {
                    const a = anchor.getBoundingClientRect(), c = menu.getBoundingClientRect();
                    const t = lerp(a.top - c.top, 0, p), l = lerp(a.left - c.left, 0, p);
                    const r = lerp(c.right - a.right, 0, p), b = lerp(c.bottom - a.bottom, 0, p);
                    menu.style.clipPath = `inset(${t}px ${r}px ${b}px ${l}px round ${lerp(a.height / 2, 20, pc)}px)`;
                }
            }
            const st = Math.min(Math.abs(Y.vel) / 1800, 0.2);
            ind.style.width = `${W.v}px`;
            ind.style.height = `${H.v}px`;
            ind.style.opacity = clamp(V.v);
            ind.style.transform = `translate(${X.v}px, ${Y.v}px) scale(${1 - st * 0.2}, ${1 + st})`;
        }
        renderers.add(render);

        function hoverTo(item) {
            if (item === hovered) return;
            if (hovered) hovered.classList.remove('ios-hover');
            hovered = item;
            if (!item) { V.t = 0; kick(); return; }
            if (!container.contains(ind)) container.prepend(ind);   // la lista se volvió a pintar
            item.classList.add('ios-hover');
            if (d.tones) ind.dataset.tone = ACTION_TONES.find((c) => item.classList.contains(c)) || '';
            X.t = item.offsetLeft; Y.t = item.offsetTop; W.t = item.offsetWidth; H.t = item.offsetHeight; V.t = 1;
            if (V.v < 0.05) { X.v = X.t; Y.v = Y.t; W.v = W.t; H.v = H.t; }
            kick();
        }
        container.addEventListener('pointermove', (e) => {
            const item = e.target.closest(itemSel);
            if (item && container.contains(item)) hoverTo(item);
        });
        container.addEventListener('pointerleave', () => hoverTo(null));
        menu.addEventListener('input', () => hoverTo(null));

        function sync() {
            const now = d.isOpen();
            if (now === open) return;
            open = now;
            if (open) {
                anchor.classList.add('ios-dd-anchor-open');
                d.root?.classList.add('ios-dd-host');
                V.v = V.t = 0; hovered = null;
                P.t = 1;
                requestAnimationFrame(() => {
                    if (menu.style.position) {
                        savedPos = { position: menu.style.position, top: menu.style.top, bottom: menu.style.bottom, right: menu.style.right, left: menu.style.left, zIndex: menu.style.zIndex };
                    }
                    const sel = container.querySelector(`${itemSel}.selected`);
                    if (sel && container.scrollHeight > container.clientHeight) {
                        container.scrollTop = sel.offsetTop - container.clientHeight / 2 + sel.offsetHeight / 2;
                    }
                });
                if (!reduce.matches && menu.animate && d.tones) {
                    menu.querySelectorAll(itemSel).forEach((it, i) => {
                        it.animate(
                            [{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }],
                            { duration: 380, delay: 30 + i * 20, easing: SPRING, fill: 'backwards' }
                        );
                    });
                }
            } else {
                P.t = 0;
                hoverTo(null);
            }
            render();
            kick();
        }

        const api = { sync };
        menus.set(el, api);
        return api;
    }

    const MENU_SEL = '.custom-dropdown-wrapper, .product-dropdown-wrapper, .actions-menu';
    function enhanceMenus(root = document) {
        if (root.matches?.(MENU_SEL)) menuFor(root);
        root.querySelectorAll?.(MENU_SEL).forEach(menuFor);
    }

    // ====================================================================
    // 5. SELECTS NATIVOS (tipo de pedido, trabajador del POS)
    // ====================================================================
    const CHEVRON = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const iosSelects = new Set();
    function iosSelect(select) {
        if (!select || select.dataset.iosSelect) return;
        select.dataset.iosSelect = '1';

        const wrap = document.createElement('div');
        wrap.className = 'ios-select';
        select.parentNode.insertBefore(wrap, select);
        wrap.appendChild(select);
        select.classList.add('ios-select-native');
        select.tabIndex = -1;

        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'ios-select-trigger';
        trigger.innerHTML = `<span class="ios-select-label"></span>${CHEVRON}`;
        const label = trigger.querySelector('.ios-select-label');
        const menu = document.createElement('div');
        menu.className = 'ios-select-menu';
        menu.style.visibility = 'hidden';
        menu.style.clipPath = CLOSED_CLIP;
        const ind = document.createElement('span');
        ind.className = 'ios-dd-ind';
        wrap.append(trigger, menu);

        const P = spring(0, 400, 30, 0.001);
        const X = spring(0, 520, 36), Y = spring(0, 520, 36), W = spring(0, 520, 36), H = spring(0, 520, 36);
        const V = spring(0, 600, 44, 0.001);
        let open = false, hovered = null;

        const paint = () => {
            const o = select.options[select.selectedIndex];
            label.textContent = o ? o.textContent.trim() : '';
        };
        function build() {
            menu.innerHTML = '';
            menu.appendChild(ind);
            [...select.options].forEach((o) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'ios-select-option' + (o.selected ? ' selected' : '');
                b.dataset.value = o.value;
                b.textContent = o.textContent.trim();
                menu.appendChild(b);
            });
        }
        function render() {
            if (!wrap.isConnected) {
                renderers.delete(render);
                [P, X, Y, W, H, V].forEach((s) => springs.delete(s));
                iosSelects.delete(api);
                return;
            }
            const p = P.v, pc = clamp(p);
            if (p < 0.002 && P.t === 0) {
                menu.style.visibility = 'hidden';
                menu.style.clipPath = CLOSED_CLIP;
            } else {
                menu.style.visibility = 'visible';
                menu.style.setProperty('--ios-p', pc.toFixed(3));
                if (open && atRest(P)) menu.style.clipPath = 'none';
                else {
                    const a = trigger.getBoundingClientRect(), c = menu.getBoundingClientRect();
                    menu.style.clipPath = `inset(${lerp(a.top - c.top, 0, p)}px ${lerp(c.right - a.right, 0, p)}px ${lerp(c.bottom - a.bottom, 0, p)}px ${lerp(a.left - c.left, 0, p)}px round ${lerp(a.height / 2, 20, pc)}px)`;
                }
            }
            ind.style.width = `${W.v}px`;
            ind.style.height = `${H.v}px`;
            ind.style.opacity = clamp(V.v);
            ind.style.transform = `translate(${X.v}px, ${Y.v}px)`;
        }
        renderers.add(render);

        function hoverTo(b) {
            if (b === hovered) return;
            if (hovered) hovered.classList.remove('ios-hover');
            hovered = b;
            if (!b) { V.t = 0; kick(); return; }
            b.classList.add('ios-hover');
            X.t = b.offsetLeft; Y.t = b.offsetTop; W.t = b.offsetWidth; H.t = b.offsetHeight; V.t = 1;
            if (V.v < 0.05) { X.v = X.t; Y.v = Y.t; W.v = W.t; H.v = H.t; }
            kick();
        }
        function setOpen(v) {
            if (v === open) return;
            open = v;
            wrap.classList.toggle('is-open', v);
            if (v) {
                iosSelects.forEach((s) => s !== api && s.close());
                build();
                wrap.classList.remove('ios-up');
                const r = menu.getBoundingClientRect();
                if (r.bottom > window.innerHeight - 12 && trigger.getBoundingClientRect().top - r.height > 12) wrap.classList.add('ios-up');
                V.v = V.t = 0; hovered = null;
                P.t = 1;
            } else {
                P.t = 0;
                hoverTo(null);
            }
            render();
            kick();
        }
        trigger.addEventListener('click', (e) => { e.stopPropagation(); setOpen(!open); });
        menu.addEventListener('pointermove', (e) => { const b = e.target.closest('.ios-select-option'); if (b) hoverTo(b); });
        menu.addEventListener('pointerleave', () => hoverTo(null));
        menu.addEventListener('click', (e) => {
            e.stopPropagation();
            const b = e.target.closest('.ios-select-option');
            if (!b) return;
            if (select.value !== b.dataset.value) {
                select.value = b.dataset.value;
                select.dispatchEvent(new Event('change', { bubbles: true }));
            }
            paint();
            menu.querySelectorAll('.ios-select-option').forEach((x) => x.classList.toggle('selected', x === b));
            setTimeout(() => setOpen(false), 160);
        });
        new MutationObserver(paint).observe(select, { subtree: true, childList: true, characterData: true });
        select.addEventListener('change', paint);

        const api = { close: () => setOpen(false), contains: (n) => wrap.contains(n) };
        iosSelects.add(api);
        paint();
        render();
    }
    function enhanceSelects(root = document) {
        root.querySelectorAll?.('#orderType, #apptPosWorker').forEach(iosSelect);
    }
    document.addEventListener('pointerdown', (e) => {
        iosSelects.forEach((s) => { if (!s.contains(e.target)) s.close(); });
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') iosSelects.forEach((s) => s.close());
    });

    // ====================================================================
    // 6. LISTAS: filas de la tabla, calendario, catálogo y ticket del POS
    // ====================================================================
    function rowKey(tr) {
        return tr.querySelector('[id^="dropdown-"]')?.id || null;
    }
    function watchTable(tbody) {
        if (!tbody) return;
        let prev = new Set();
        new MutationObserver(() => {
            const now = new Set();
            let n = 0;
            tbody.querySelectorAll(':scope > tr').forEach((tr) => {
                const k = rowKey(tr);
                if (!k) return;
                now.add(k);
                // Solo entran animadas las filas que no estaban en la vista anterior
                if (!prev.has(k)) {
                    tr.style.setProperty('--r', Math.min(n++, 14));
                    tr.classList.add('ios-row');
                }
            });
            prev = now;
            enhanceMenus(tbody);
        }).observe(tbody, { childList: true });
    }

    let calDir = 0;
    function watchCalendar() {
        const grid = document.getElementById('calendarGrid');
        if (!grid) return;
        document.getElementById('prevMonth')?.addEventListener('click', () => { calDir = -1; }, true);
        document.getElementById('nextMonth')?.addEventListener('click', () => { calDir = 1; }, true);
        let pending = false;
        new MutationObserver(() => {
            if (pending) return;
            pending = true;
            requestAnimationFrame(() => {
                pending = false;
                if (reduce.matches || !grid.animate) return;
                if (calDir) {
                    grid.animate(
                        [{ transform: `translateX(${calDir * 30}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }],
                        { duration: 500, easing: SPRING }
                    );
                }
                grid.querySelectorAll('.calendar-day').forEach((c, i) => {
                    c.style.setProperty('--r', i);
                    c.classList.remove('ios-cell');
                    void c.offsetWidth;
                    c.classList.add('ios-cell');
                });
                calDir = 0;
            });
        }).observe(grid, { childList: true });
    }

    function watchCatalog() {
        const grid = document.getElementById('posProductsGrid');
        if (!grid) return;
        new MutationObserver(() => {
            let n = 0;
            grid.querySelectorAll('.pos-product-card:not(.ios-row)').forEach((c) => {
                c.style.setProperty('--r', Math.min(n++, 16));
                c.classList.add('ios-row');
            });
        }).observe(grid, { childList: true });
        // Al tocar un producto, rebota la tarjeta
        grid.addEventListener('click', (e) => pop(e.target.closest('.pos-product-card'), 0.9, 450));
    }

    function watchTicket() {
        const list = document.getElementById('posItemsList');
        if (!list) return;
        let prev = new Map();
        new MutationObserver(() => {
            const now = new Map();
            list.querySelectorAll('.pos-item-row').forEach((row) => {
                const name = row.querySelector('.pos-item-name')?.textContent || '';
                const qty = parseInt(row.querySelector('.pos-qty-num')?.textContent, 10) || 0;
                now.set(name, qty);
                if (!prev.has(name)) row.classList.add('ios-item-in');
                else if (prev.get(name) !== qty) pop(row.querySelector('.pos-qty-num'), qty > prev.get(name) ? 1.5 : 0.6, 460);
            });
            prev = now;
        }).observe(list, { childList: true });
    }

    // ====================================================================
    // 7. MODALES: entrada con resorte y salida animada
    // ====================================================================
    function animateClose(modal, done) {
        if (!modal || !modal.classList.contains('active') || reduce.matches || modal.classList.contains('ios-closing')) { done(); return; }
        modal.classList.add('ios-closing');
        setTimeout(() => { done(); modal.classList.remove('ios-closing'); }, 230);
    }
    function wrapClose(name, getModal) {
        const orig = window[name];
        if (typeof orig !== 'function' || orig.__ios) return;
        const wrapped = function () {
            const args = arguments, self = this;
            animateClose(getModal(), () => orig.apply(self, args));
        };
        wrapped.__ios = true;
        window[name] = wrapped;
    }

    // ====================================================================
    // OBSERVADOR GENERAL
    // ====================================================================
    new MutationObserver((records) => {
        records.forEach((r) => {
            if (r.type === 'attributes') {
                const el = r.target;
                if (!el.classList) return;
                if (el.matches(MENU_SEL)) menuFor(el)?.sync();
                // Al cambiar de pestaña, el panel nuevo entra escalonado
                if (el.matches('.orders-tab-panel') && el.classList.contains('active') && r.oldValue && !r.oldValue.includes('active')) {
                    rise(panelParts(el));
                    enhanceSegments(el);
                }
                return;
            }
            r.addedNodes.forEach((n) => {
                if (n.nodeType !== 1) return;
                enhanceMenus(n);
                enhanceSegments(n);
                enhanceSelects(n);
                if (n.matches('.item-row')) n.classList.add('ios-item-in');
            });
        });
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });

    window.addEventListener('resize', () => renderers.forEach((r) => r()));
    document.addEventListener('scroll', () => renderers.forEach((r) => r()), { passive: true, capture: true });

    function init() {
        pageEntrance();
        watchNumbers();
        enhanceSegments();
        enhanceMenus();
        enhanceSelects();
        watchTable(document.getElementById('ordersList'));
        watchTable(document.getElementById('appointmentsList'));
        watchCalendar();
        watchCatalog();
        watchTicket();
        // Se envuelven aquí (no antes) porque en Mis Citas orders.js vuelve a
        // declarar algunas de estas funciones después de appointments.js
        wrapClose('closeOrderModal', () => document.getElementById('orderModal'));
        wrapClose('closeAppointmentModal', () => document.getElementById('appointmentModal'));
        wrapClose('closeConfirmModal', () => document.getElementById('confirmModal'));
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();