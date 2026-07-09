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