/* ============================================
   INVENTORY PAGE JS
   Vista estilo hoja de cálculo — SOLO VISUAL.
   No hay llamadas a backend todavía: los datos
   son de ejemplo y viven en `inventoryData`.
   Cuando exista el endpoint real, basta con
   reemplazar `inventoryData` por la respuesta
   del API (mismas claves = mismas columnas
   del sheet) y volver a llamar renderSheet().
   ============================================ */

// Definición de columnas: mapea 1:1 cada columna del Google Sheet
// (letra, encabezado, clave de dato y clase de ancho/alineación)
const SHEET_COLUMNS = [
    { letter: 'A', label: 'VIN', key: 'vin', cssClass: 'col-vin' },
    { letter: 'B', label: 'Marca', key: 'marca', cssClass: 'col-marca' },
    { letter: 'C', label: 'Vehículo', key: 'vehiculo', cssClass: 'col-vehiculo' },
    { letter: 'D', label: 'Color Ext./Int.', key: 'color', cssClass: 'col-color' },
    { letter: 'E', label: 'Año', key: 'anio', cssClass: 'col-anio' },
    { letter: 'F', label: 'Ubicación', key: 'ubicacion', cssClass: 'col-ubicacion' },
    { letter: 'G', label: 'Precio', key: 'precio', cssClass: 'col-precio' },
    { letter: 'H', label: 'Días en Inv.', key: 'diasInventario', cssClass: 'col-dias' },
    { letter: 'I', label: 'Kilometraje', key: 'kilometraje', cssClass: 'col-km' },
    { letter: 'J', label: 'Estatus', key: 'estatus', cssClass: 'col-estatus' },
    { letter: 'K', label: 'Foto', key: 'foto', cssClass: 'col-foto' },
    { letter: 'L', label: 'Subir Foto', key: 'subirFoto', cssClass: 'col-subirfoto' },
    { letter: 'M', label: 'Álbum', key: 'album', cssClass: 'col-album' },
];

// Datos de ejemplo (reflejan el sheet compartido).
// Los VIN de las filas 2-5 se completaron a 17 caracteres a partir
// del prefijo visible en la hoja; los de las filas con solo VIN
// (aún sin procesar por la IA) se dejaron tal cual.
const inventoryData = [
    {
        vin: 'MMBM7U5G2SF012345',
        marca: 'Mitsubishi',
        vehiculo: 'L200 4PTAS GL',
        color: 'WHITE SOLID/NEGRO',
        anio: 2025,
        ubicacion: 'MORELOS',
        precio: 479900,
        diasInventario: 19,
        kilometraje: 15478,
        estatus: '',
        foto: '',
        subirFoto: false,
        album: null, // { count: 0 } si tuviera fotos
    },
    {
        vin: 'MMBML45G4JH901234',
        marca: 'Mitsubishi',
        vehiculo: 'L200 2.4 GLS C',
        color: 'WHITE SOLID/E',
        anio: 2018,
        ubicacion: 'MITSU CHIHUAHUA',
        precio: 259900,
        diasInventario: 4,
        kilometraje: 136203,
        estatus: 'Vendido',
        foto: '',
        subirFoto: false,
        album: null,
    },
    {
        vin: 'NPTKH3BX2LR456789',
        marca: 'Mitsubishi',
        vehiculo: 'L200 4 PTAS GL',
        color: 'WHITE SOLID/E',
        anio: 2025,
        ubicacion: 'NISSAUTO',
        precio: 479900,
        diasInventario: 19,
        kilometraje: 16413,
        estatus: '',
        foto: '',
        subirFoto: false,
        album: null,
    },
    {
        vin: 'MZBET2A12PN345678',
        marca: 'Kia',
        vehiculo: 'SELTOS TURBO',
        color: 'WHITE PEARL',
        anio: 2023,
        ubicacion: 'GRAN AUTO',
        precio: 399900,
        diasInventario: 49,
        kilometraje: 73059,
        estatus: '',
        foto: '',
        subirFoto: true,
        album: { count: 12 },
    },
    // Fila en blanco (separador, tal como aparece en el sheet)
    { empty: true },
    {
        vin: 'LSFAM3ABXRA042654',
        marca: '',
        vehiculo: '',
        color: '',
        anio: '',
        ubicacion: '',
        precio: '',
        diasInventario: '',
        kilometraje: '',
        estatus: '',
        foto: '',
        subirFoto: false,
        album: { count: null }, // fotos ya subidas, aún sin el resto de datos
    },
    {
        vin: '3N1CN8AE8ML817705',
        marca: '',
        vehiculo: '',
        color: '',
        anio: '',
        ubicacion: '',
        precio: '',
        diasInventario: '',
        kilometraje: '',
        estatus: '',
        foto: '',
        subirFoto: false,
        album: null,
    },
];

function formatNumber(value) {
    if (value === '' || value === null || value === undefined) return '';
    return Number(value).toLocaleString('en-US');
}

function buildColLetterRow() {
    const tr = document.createElement('tr');
    tr.className = 'col-letter-row';

    const corner = document.createElement('th');
    corner.className = 'corner-cell';
    tr.appendChild(corner);

    SHEET_COLUMNS.forEach(col => {
        const th = document.createElement('th');
        th.textContent = col.letter;
        tr.appendChild(th);
    });

    return tr;
}

function buildHeaderRow() {
    const tr = document.createElement('tr');
    tr.className = 'sheet-header-row';

    const rowNum = document.createElement('td');
    rowNum.className = 'row-number-cell';
    rowNum.textContent = '1';
    tr.appendChild(rowNum);

    SHEET_COLUMNS.forEach((col, idx) => {
        const td = document.createElement('td');
        td.className = col.cssClass;
        td.textContent = col.label;
        // Replica el recuadro azul de "celda activa" sobre A1, como en el sheet original
        if (idx === 0) td.classList.add('cell-selected');
        tr.appendChild(td);
    });

    return tr;
}

function buildDataCell(col, row) {
    const td = document.createElement('td');
    td.className = col.cssClass;

    if (col.key === 'subirFoto') {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'sheet-checkbox';
        checkbox.checked = !!row.subirFoto;
        // Solo visual: cambia el estado local, sin llamadas a backend todavía
        checkbox.addEventListener('change', () => {
            row.subirFoto = checkbox.checked;
        });
        td.appendChild(checkbox);
        return td;
    }

    if (col.key === 'album') {
        if (row.album) {
            const a = document.createElement('a');
            a.href = '#';
            a.className = 'album-link';
            a.textContent = row.album.count ? `Ver fotos (${row.album.count})` : 'Ver fotos';
            a.addEventListener('click', (e) => e.preventDefault()); // sin backend aún
            td.appendChild(a);
        }
        return td;
    }

    if (col.key === 'precio' || col.key === 'kilometraje') {
        td.classList.add('num-cell');
        td.textContent = col.key === 'kilometraje' ? formatNumber(row.kilometraje) : (row.precio === '' ? '' : row.precio);
        return td;
    }

    if (col.key === 'diasInventario' || col.key === 'anio') {
        td.classList.add('num-cell');
        td.textContent = row[col.key] === '' ? '' : row[col.key];
        return td;
    }

    if (col.key === 'estatus') {
        td.classList.add('estatus-text');
        td.textContent = row.estatus || '';
        return td;
    }

    td.textContent = row[col.key] || '';
    return td;
}

function buildDataRow(row, rowNumber) {
    const tr = document.createElement('tr');

    if (row.empty) {
        tr.className = 'row-empty';
        const rowNum = document.createElement('td');
        rowNum.className = 'row-number-cell';
        rowNum.textContent = rowNumber;
        tr.appendChild(rowNum);
        SHEET_COLUMNS.forEach(() => tr.appendChild(document.createElement('td')));
        return tr;
    }

    if (row.estatus === 'Vendido') tr.classList.add('row-vendido');

    const rowNum = document.createElement('td');
    rowNum.className = 'row-number-cell';
    rowNum.textContent = rowNumber;
    tr.appendChild(rowNum);

    SHEET_COLUMNS.forEach(col => tr.appendChild(buildDataCell(col, row)));

    return tr;
}

function renderSheet(data) {
    const tbody = document.getElementById('sheetBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    tbody.appendChild(buildColLetterRow());
    tbody.appendChild(buildHeaderRow());

    data.forEach((row, i) => {
        tbody.appendChild(buildDataRow(row, i + 2)); // fila 1 = encabezados
    });
}

/* ============================================
   MODO EMBED
   Esta página puede cargarse standalone (con
   sidebar/userbar) o dentro del iframe del tab
   "Inventario" en Mi Negocio (?embed=1).
   La clase embed-mode ya se aplicó en un script
   inline al inicio del <body> para evitar el
   parpadeo del sidebar/userbar.
   ============================================ */

const IS_EMBEDDED = window.self !== window.top;
const params = new URLSearchParams(window.location.search);
const IS_EMBED_MODE = params.get('embed') === '1';

/* ============================================
   TOGGLE DE VISTA — Negocio / Sheets
   ============================================ */

function setActiveView(view) {
    document.querySelectorAll('.inv-view-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === view);
    });
    document.querySelectorAll('.inv-view-panel').forEach(panel => {
        panel.classList.toggle('active', panel.dataset.view === view);
    });
}

function initViewToggle() {
    document.querySelectorAll('.inv-view-tab').forEach(btn => {
        btn.addEventListener('click', () => setActiveView(btn.dataset.view));
    });

    // Dentro de Mi Negocio arrancamos en la vista de existencias (la que ya
    // conocía el usuario); accediendo directo a /inventory arrancamos en Sheets.
    const initial = params.get('view') || (IS_EMBED_MODE ? 'negocio' : 'sheets');
    setActiveView(initial);
}

/* ============================================
   VISTA NEGOCIO — datos que vienen de la
   pestaña "Mi Negocio" (catálogo/menú), vía
   postMessage cuando estamos embebidos en el
   iframe. Standalone no hay datos que mostrar.
   ============================================ */

let businessRows = [];

function renderBusinessInventory(rows) {
    businessRows = rows || [];
    const tbody = document.getElementById('invTableBody');
    const empty = document.getElementById('invEmpty');
    const table = document.getElementById('invTable');
    if (!tbody) return;

    if (businessRows.length === 0) {
        if (table) table.style.display = 'none';
        if (empty) empty.style.display = 'flex';
        updateInvSummary(0, 0, 0);
        return;
    }

    if (table) table.style.display = 'table';
    if (empty) empty.style.display = 'none';

    let cntOk = 0, cntLow = 0, cntOut = 0;

    tbody.innerHTML = businessRows.map((r, idx) => {
        let badgeClass, badgeText;
        if (!r.inStock || r.qty === 0) {
            badgeClass = 'inv-badge-out'; badgeText = 'Agotado'; cntOut++;
        } else if (r.qty !== null && r.qty <= 5) {
            badgeClass = 'inv-badge-low'; badgeText = 'Stock bajo'; cntLow++;
        } else {
            badgeClass = 'inv-badge-ok';  badgeText = 'En existencia'; cntOk++;
        }

        const qtyDisplay = r.qty !== null
            ? `<span class="inv-qty-cell">${r.qty}</span>`
            : `<span class="inv-qty-na">—</span>`;

        const imgTag = r.imgUrl
            ? `<img class="inv-prod-img" src="${r.imgUrl}" alt="${r.title}" onerror="this.style.display='none'">`
            : `<div class="inv-prod-img" style="display:inline-block;"></div>`;

        const adjHtml = r.qty !== null ? `
            <div class="inv-adj-wrap">
                <button type="button" class="inv-adj-btn" onclick="invAdjust(${idx}, -1)" title="Restar">−</button>
                <input type="number" class="inv-adj-input" min="0" value="${r.qty}"
                    data-inv-idx="${idx}" onchange="invSetQty(${idx}, this.value)" onclick="this.select()">
                <button type="button" class="inv-adj-btn" onclick="invAdjust(${idx}, 1)" title="Sumar">+</button>
            </div>
        ` : `<span class="inv-qty-na">Sin control</span>`;

        return `
        <tr>
            <td>
                <div class="inv-prod-cell">
                    ${imgTag}
                    <span class="inv-prod-name">${r.title}</span>
                </div>
            </td>
            <td class="inv-th-center"><span class="inv-badge ${badgeClass}">${badgeText}</span></td>
            <td class="inv-th-center">${qtyDisplay}</td>
            <td class="inv-adjust-cell">${adjHtml}</td>
        </tr>`;
    }).join('');

    updateInvSummary(cntOk, cntLow, cntOut);
}

function updateInvSummary(ok, low, out) {
    const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setTxt('invCountOk', ok);
    setTxt('invCountLow', low);
    setTxt('invCountOut', out);
}

// Botones +/- y el input de cantidad: si estamos embebidos, el dato real vive
// en Mi Negocio, así que solo le pedimos a la ventana padre que lo actualice
// (y ella nos vuelve a mandar las filas ya recalculadas). Standalone, no hay
// padre a quien pedirle nada — no hacemos nada (no hay backend propio aún).
function invAdjust(idx, delta) {
    if (!IS_EMBEDDED) return;
    window.parent.postMessage({ type: 'attomos:inventory:adjust', idx, delta }, window.location.origin);
}

function invSetQty(idx, value) {
    if (!IS_EMBEDDED) return;
    window.parent.postMessage({ type: 'attomos:inventory:setqty', idx, value }, window.location.origin);
}

/* ============================================
   PUENTE CON MI NEGOCIO (postMessage)
   ============================================ */

window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;
    const data = event.data || {};
    if (data.type === 'attomos:inventory:rows') {
        renderBusinessInventory(data.rows);
    }
});

function notifyParentReady() {
    if (!IS_EMBEDDED) return;
    window.parent.postMessage({ type: 'attomos:inventory:ready' }, window.location.origin);
}

/* ============================================
   REPAIRDESK — trasladado desde my-business.js.
   Es independiente de la pestaña Mi Negocio (usa
   sus propios endpoints con cookies de sesión),
   así que funciona igual standalone o embebido.
   ============================================ */

async function initRepairDeskInventory() {
    try {
        const res = await fetch('/api/agents', { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        const agents = data.agents || [];
        if (!agents.length) return;

        const agentId = agents[0].id;
        await checkRepairDeskStatus(agentId);
    } catch (e) {
        console.warn('RepairDesk check skipped:', e);
    }
}

async function checkRepairDeskStatus(agentId) {
    try {
        const res = await fetch(`/api/repairdesk/status/${agentId}`, { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();

        const syncBtn = document.getElementById('btnRdSyncInventory');
        if (data.connected) {
            if (syncBtn) {
                syncBtn.style.display = 'inline-flex';
                syncBtn.setAttribute('data-agent-id', agentId);
                syncBtn.onclick = () => syncRepairDeskInventory(agentId);
            }
            await loadRepairDeskInventory(agentId);
        } else {
            if (syncBtn) syncBtn.style.display = 'none';
        }
    } catch (e) {
        console.warn('RepairDesk status error:', e);
    }
}

async function syncRepairDeskInventory(agentId) {
    const btn = document.getElementById('btnRdSyncInventory');
    if (btn) { btn.innerHTML = '<div class="loading-spinner" style="width:14px;height:14px;border-width:2px;"></div> Sincronizando...'; btn.disabled = true; }

    try {
        const res = await fetch(`/api/repairdesk/sync/${agentId}`, {
            method: 'POST',
            credentials: 'include'
        });
        if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Error al sincronizar'); }
        const data = await res.json();

        await loadRepairDeskInventory(agentId);

        if (typeof showToast === 'function') {
            showToast('success', `Inventario RepairDesk actualizado: ${data.synced_count ?? ''} productos`);
        }
    } catch (err) {
        if (typeof showToast === 'function') showToast('error', err.message || 'Error al sincronizar');
    } finally {
        if (btn) {
            btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:1em;height:1em;"><rect x="3" y="3" width="18" height="18" rx="4" stroke="currentColor" stroke-width="1.7" fill="none"/><path d="M7 12h10M7 8.5h6M7 15.5h8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="17.5" cy="8.5" r="1.5" fill="currentColor"/></svg> Sync RepairDesk`;
            btn.disabled = false;
        }
    }
}

async function loadRepairDeskInventory(agentId) {
    try {
        const res = await fetch(`/api/repairdesk/inventory/${agentId}`, { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        renderRepairDeskInventory(data.items || [], data.last_sync);
    } catch (e) {
        console.warn('RepairDesk inventory load error:', e);
    }
}

function renderRepairDeskInventory(items, lastSync) {
    const section = document.getElementById('rdInventorySection');
    const tbody   = document.getElementById('rdInvTableBody');
    const table   = document.getElementById('rdInvTable');
    const empty   = document.getElementById('rdInvEmpty');
    const syncLbl = document.getElementById('rdLastSyncLabel');

    if (!section) return;
    section.style.display = 'block';

    if (syncLbl && lastSync) {
        const d = new Date(lastSync);
        syncLbl.innerHTML = `<i class="lni lni-reload"></i> Último sync: ${d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
    }

    if (!items.length) {
        if (table) table.style.display = 'none';
        if (empty) empty.style.display = 'flex';
        return;
    }

    if (table) table.style.display = 'table';
    if (empty) empty.style.display = 'none';

    tbody.innerHTML = items.map(item => {
        let badgeClass, badgeText;
        const qty = item.quantity ?? item.qty ?? null;
        const inStock = item.in_stock !== false && qty !== 0;

        if (!inStock || qty === 0) {
            badgeClass = 'inv-badge-out'; badgeText = 'Agotado';
        } else if (qty !== null && qty <= 5) {
            badgeClass = 'inv-badge-low'; badgeText = 'Stock bajo';
        } else {
            badgeClass = 'inv-badge-ok';  badgeText = 'En existencia';
        }

        const qtyDisplay = qty !== null ? `<span class="inv-qty-cell">${qty}</span>` : `<span class="inv-qty-na">—</span>`;
        const sku = item.sku || item.part_number || '—';

        return `
        <tr>
            <td><div class="inv-prod-cell"><span class="inv-prod-name">${item.name || item.title || 'Sin nombre'}</span></div></td>
            <td class="inv-th-center"><span style="font-family:monospace;font-size:.8rem;color:#6b7280;">${sku}</span></td>
            <td class="inv-th-center"><span class="inv-badge ${badgeClass}">${badgeText}</span></td>
            <td class="inv-th-center">${qtyDisplay}</td>
        </tr>`;
    }).join('');
}

/* ============================================
   INIT
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {
    renderSheet(inventoryData);
    initViewToggle();
    renderBusinessInventory([]); // estado vacío hasta que llegue el postMessage del padre
    initRepairDeskInventory();
    notifyParentReady();
});