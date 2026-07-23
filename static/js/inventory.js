/* ============================================
   INVENTORY PAGE JS
   Visualizador GENÉRICO de cualquier Google Sheet
   conectada — no asume columnas fijas (sirve para
   cualquier giro de negocio). El backend manda:
     { headers: [...], rows: [{ row, cells: [...] }] }
   y cada celda ya viene clasificada por TIPO
   (kind: "text" | "number" | "boolean" | "image" | "link"),
   nunca por nombre de columna.
     GET  /api/inventory-sheets/status/:agent_id
     POST /api/inventory-sheets/connect/:agent_id
     POST /api/inventory-sheets/disconnect/:agent_id
     GET  /api/inventory-sheets/rows/:agent_id
   Los checkboxes se muestran de SOLO LECTURA: no
   sabemos si esa hoja tiene algún Apps Script propio
   colgado de un trigger onEdit en esa columna.
   ============================================ */

// A, B, C... Z, AA, AB... (por si la hoja tiene más de 26 columnas)
function columnLetter(index) {
    let n = index + 1;
    let letter = '';
    while (n > 0) {
        const rem = (n - 1) % 26;
        letter = String.fromCharCode(65 + rem) + letter;
        n = Math.floor((n - 1) / 26);
    }
    return letter;
}

function buildColLetterRow(headers) {
    const tr = document.createElement('tr');
    tr.className = 'col-letter-row';

    const corner = document.createElement('th');
    corner.className = 'corner-cell';
    tr.appendChild(corner);

    headers.forEach((_, i) => {
        const th = document.createElement('th');
        th.textContent = columnLetter(i);
        tr.appendChild(th);
    });

    return tr;
}

function buildHeaderRow(headers) {
    const tr = document.createElement('tr');
    tr.className = 'sheet-header-row';

    const rowNum = document.createElement('td');
    rowNum.className = 'row-number-cell';
    rowNum.textContent = '1';
    tr.appendChild(rowNum);

    headers.forEach((label, idx) => {
        const td = document.createElement('td');
        td.textContent = label;
        // Replica el recuadro azul de "celda activa" sobre A1, como en Sheets
        if (idx === 0) td.classList.add('cell-selected');
        tr.appendChild(td);
    });

    return tr;
}

function buildDataCell(cell, headerName, row) {
    const td = document.createElement('td');
    if (!cell) return td;

    // Columna de fotos configurada por el usuario: además de mostrar la foto
    // (si ya hay una), siempre se puede subir dándole clic al botón de la celda.
    if (inventoryPhotoColumn && headerName === inventoryPhotoColumn) {
        td.classList.add('sheet-photo-cell');
        if (cell.kind === 'image' && cell.url) {
            const img = document.createElement('img');
            img.className = 'sheet-photo-thumb';
            img.src = cell.url;
            img.alt = '';
            img.loading = 'lazy';
            td.appendChild(img);
        }
        const uploadBtn = document.createElement('button');
        uploadBtn.type = 'button';
        uploadBtn.className = 'sheet-photo-upload-btn';
        uploadBtn.title = cell.url ? 'Agregar más fotos a esta fila' : 'Subir foto(s) a esta fila';
        uploadBtn.innerHTML = '<i class="lni lni-camera"></i>';
        uploadBtn.addEventListener('click', () => triggerRowPhotoUpload(row));
        td.appendChild(uploadBtn);
        return td;
    }

    switch (cell.kind) {
        case 'image':
            if (cell.url) {
                const img = document.createElement('img');
                img.className = 'sheet-photo-thumb';
                img.src = cell.url;
                img.alt = '';
                img.loading = 'lazy';
                td.appendChild(img);
            }
            return td;

        case 'boolean': {
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'sheet-checkbox';
            checkbox.checked = !!cell.bool;
            // Solo lectura: no sabemos si esa columna dispara algo (un script
            // propio del cliente) en su hoja — nunca escribimos desde aquí.
            checkbox.disabled = true;
            checkbox.title = 'Solo lectura — edítalo desde Google Sheets';
            td.appendChild(checkbox);
            return td;
        }

        case 'link':
            if (cell.url) {
                const a = document.createElement('a');
                a.className = 'album-link';
                a.href = cell.url;
                a.target = '_blank';
                a.rel = 'noopener';
                a.textContent = cell.text || 'Abrir';
                td.appendChild(a);
            }
            return td;

        case 'number':
            td.classList.add('num-cell');
            td.textContent = cell.text || '';
            makeCellEditable(td, cell, headerName, row);
            return td;

        default:
            td.textContent = cell.text || '';
            makeCellEditable(td, cell, headerName, row);
            return td;
    }
}

// Convierte una celda de texto/número en editable: clic → input, Enter/blur
// guarda (PATCH al backend, que lo escribe en la hoja real), Escape cancela.
function makeCellEditable(td, cell, headerName, row) {
    td.classList.add('sheet-cell-editable');
    td.title = 'Clic para editar';

    td.addEventListener('click', () => {
        if (td.querySelector('input')) return; // ya está en edición
        const originalText = cell.text || '';
        const wasNumCell = td.classList.contains('num-cell');

        td.textContent = '';
        td.classList.remove('num-cell');
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'sheet-cell-input';
        input.value = originalText;
        td.appendChild(input);
        input.focus();
        input.select();

        let done = false;
        const finish = async (commit) => {
            if (done) return;
            done = true;
            const newValue = commit ? input.value : originalText;
            td.textContent = newValue;
            if (wasNumCell) td.classList.add('num-cell');

            if (!commit || newValue === originalText) return; // sin cambios reales

            cell.text = newValue;
            try {
                const res = await fetch(`/api/inventory-sheets/cell/${currentAgentId}`, {
                    method: 'PATCH',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ row: row.row, column: headerName, value: newValue }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.error || 'No se pudo guardar el cambio');
            } catch (err) {
                cell.text = originalText;
                td.textContent = originalText;
                if (wasNumCell) td.classList.add('num-cell');
                if (typeof showToast === 'function') showToast('error', err.message || 'No se pudo guardar el cambio en la hoja');
            }
        };

        input.addEventListener('blur', () => finish(true));
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
            if (e.key === 'Escape') { e.preventDefault(); finish(false); input.blur(); }
        });
    });
}

function buildDataRow(row, headers) {
    const tr = document.createElement('tr');

    const rowNum = document.createElement('td');
    rowNum.className = 'row-number-cell';
    rowNum.textContent = row.row;
    tr.appendChild(rowNum);

    const cells = row.cells || [];
    headers.forEach((headerName, i) => {
        tr.appendChild(buildDataCell(cells[i], headerName, row));
    });

    return tr;
}

function renderSheet(headers, rows) {
    const tbody = document.getElementById('sheetBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    tbody.appendChild(buildColLetterRow(headers));
    tbody.appendChild(buildHeaderRow(headers));

    rows.forEach(row => tbody.appendChild(buildDataRow(row, headers)));
}

/* ============================================
   AGENTE ACTUAL — compartido entre la sección
   de Sheets y la de RepairDesk, para no pedir
   /api/agents dos veces al cargar la página.
   ============================================ */

let _agentIdPromise = null;
function getAgentId() {
    if (!_agentIdPromise) {
        _agentIdPromise = fetch('/api/agents', { credentials: 'include' })
            .then(res => (res.ok ? res.json() : { agents: [] }))
            .then(data => (data.agents && data.agents.length ? data.agents[0].id : null))
            .catch(() => null);
    }
    return _agentIdPromise;
}

/* ============================================
   GOOGLE SHEETS DEL INVENTARIO — conexión real
   ============================================ */

let currentAgentId = null;
let sheetHeaders = [];
let sheetRows = [];
let inventoryPhotoColumn = null;
let inventoryAlbumColumn = null;
let inventoryFileNameColumns = [];
let inventoryTitleColumn = null;
let inventoryDescriptionColumn = null;
let inventoryOriginalPriceColumn = null;
let inventoryPromoPriceColumn = null;
let inventoryVinColumn = null;
let inventoryNewArrivalColumn = null;
let hasOwnGeminiKey = false;
let hasSharedGeminiKey = false;

function extractSpreadsheetId(input) {
    // Acepta tanto la URL completa (https://docs.google.com/spreadsheets/d/<ID>/edit#gid=0)
    // como el ID pelón, tal como lo pegue el usuario.
    const match = input.match(/\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : input.trim();
}

async function initSheetInventory() {
    const agentId = await getAgentId();
    if (!agentId) return;
    currentAgentId = agentId;
    await refreshSheetStatus();
}

async function refreshSheetStatus() {
    if (!currentAgentId) return;
    try {
        const res = await fetch(`/api/inventory-sheets/status/${currentAgentId}`, { credentials: 'include', cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        applySheetStatus(data);
        if (data.connected) await loadSheetRows();
    } catch (e) {
        console.warn('Inventory sheet status error:', e);
    }
}

function applySheetStatus(data) {
    const badge         = document.getElementById('sheetInvStatusBadge');
    const badgeText      = document.getElementById('sheetInvStatusText');
    const form           = document.getElementById('sheetInvConnectForm');
    const info           = document.getElementById('sheetInvConnectionInfo');
    const manageActions  = document.getElementById('sheetInvManageActions');
    const link           = document.getElementById('sheetInvLink');
    const connectedAt    = document.getElementById('sheetInvConnectedAt');
    const container      = document.getElementById('sheetInvContainer');
    const footnote       = document.getElementById('sheetInvFootnote');
    const empty          = document.getElementById('sheetInvEmpty');

    if (data.connected) {
        badge?.classList.remove('disconnected');
        badge?.classList.add('connected');
        if (badgeText) badgeText.textContent = 'Conectado';
        if (form) form.style.display = 'none';
        if (info) info.style.display = 'block';
        if (manageActions) manageActions.style.display = 'flex';
        if (link && data.spreadsheet_url) link.href = data.spreadsheet_url;
        if (connectedAt) {
            connectedAt.textContent = data.connected_at
                ? new Date(data.connected_at).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
                : '-';
        }
        inventoryPhotoColumn = data.photo_column || null;
        inventoryAlbumColumn = data.album_column || null;
        inventoryFileNameColumns = data.file_name_columns || [];
        inventoryTitleColumn = data.title_column || null;
        inventoryDescriptionColumn = data.description_column || null;
        inventoryOriginalPriceColumn = data.original_price_column || null;
        inventoryPromoPriceColumn = data.promo_price_column || null;
        inventoryVinColumn = data.vin_column || null;
        inventoryNewArrivalColumn = data.new_arrival_column || null;
        hasOwnGeminiKey = !!data.has_own_gemini_key;
        hasSharedGeminiKey = !!data.has_shared_gemini_key;
        updateGeminiKeyUI();
        sheetInvIsConnected = true;
    } else {
        badge?.classList.remove('connected');
        badge?.classList.add('disconnected');
        if (badgeText) badgeText.textContent = 'No conectado';
        if (form) form.style.display = 'block';
        if (info) info.style.display = 'none';
        if (manageActions) manageActions.style.display = 'none';
        if (container) container.style.display = 'none';
        if (footnote) footnote.style.display = 'none';
        if (empty) empty.style.display = 'none';
        sheetInvIsConnected = false;
    }
}

async function loadSheetRows() {
    if (!currentAgentId) return;
    try {
        const res = await fetch(`/api/inventory-sheets/rows/${currentAgentId}`, { credentials: 'include', cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        sheetHeaders = data.headers || [];
        sheetRows = data.rows || [];
        updateColumnConfigUI();
        renderSheetView(data.last_sync);
    } catch (e) {
        console.warn('Error cargando filas del inventario:', e);
    }
}

function renderSheetView(lastSync) {
    const container      = document.getElementById('sheetInvContainer');
    const empty          = document.getElementById('sheetInvEmpty');
    const footnote       = document.getElementById('sheetInvFootnote');
    const lastSyncLabel  = document.getElementById('sheetInvLastSync');

    if (!sheetRows.length) {
        if (container) container.style.display = 'none';
        if (footnote) footnote.style.display = 'none';
        if (empty) empty.style.display = 'flex';
        return;
    }

    if (container) container.style.display = 'block';
    if (empty) empty.style.display = 'none';
    renderSheet(sheetHeaders, sheetRows);

    if (footnote && lastSyncLabel) {
        footnote.style.display = 'flex';
        lastSyncLabel.textContent = lastSync
            ? `Actualizado: ${new Date(lastSync).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`
            : 'Actualizado ahora';
    }
}

/* ============================================
   COLUMNAS DE FOTOS/ÁLBUM — elegidas por el
   usuario de entre los headers reales de SU hoja
   ============================================ */

function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
}

/* ============================================
   COLUMNAS DE FOTOS/ÁLBUM — elegidas por el
   usuario de entre los headers reales de SU hoja,
   vía el ícono de la barra de herramientas + modal
   ============================================ */

function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
}

// Muestra/oculta la barra de herramientas y marca cada ícono con un puntito
// rojo mientras esa columna en particular no se haya configurado todavía.
function updateColumnConfigUI() {
    const toolbar = document.getElementById('sheetToolbar');
    const photoBtn = document.getElementById('btnOpenPhotoColConfig');
    const albumBtn = document.getElementById('btnOpenAlbumColConfig');
    if (!toolbar) return;

    if (sheetHeaders.length) {
        toolbar.style.display = 'flex';
        if (photoBtn) {
            photoBtn.classList.toggle('needs-config', !inventoryPhotoColumn);
            photoBtn.title = inventoryPhotoColumn ? 'Cambiar columna de fotos' : 'Configurar columna de fotos';
        }
        if (albumBtn) {
            albumBtn.classList.toggle('needs-config', !inventoryAlbumColumn);
            albumBtn.title = inventoryAlbumColumn ? 'Cambiar columna de álbum' : 'Configurar columna de álbum';
        }
    } else {
        toolbar.style.display = 'none';
    }
}

function openColumnConfigModal(focusField) {
    const overlay = document.getElementById('columnConfigModalOverlay');
    const photoSel = document.getElementById('sheetInvPhotoColSelect');
    const albumSel = document.getElementById('sheetInvAlbumColSelect');
    const nameColsList = document.getElementById('sheetInvNameColsList');
    if (!overlay || !sheetHeaders.length) return;

    if (photoSel) {
        photoSel.innerHTML = sheetHeaders.map(h => `<option value="${escapeHtml(h)}">${escapeHtml(h)}</option>`).join('');
        if (inventoryPhotoColumn) photoSel.value = inventoryPhotoColumn;
    }
    if (albumSel) {
        albumSel.innerHTML = '<option value="">Ninguna</option>'
            + sheetHeaders.map(h => `<option value="${escapeHtml(h)}">${escapeHtml(h)}</option>`).join('');
        albumSel.value = inventoryAlbumColumn || '';
    }
    if (nameColsList) {
        nameColsList.innerHTML = sheetHeaders.map(h => {
            const checked = inventoryFileNameColumns.includes(h);
            return `<label class="file-name-col-chip${checked ? ' checked' : ''}">
                <input type="checkbox" value="${escapeHtml(h)}" ${checked ? 'checked' : ''}>
                <span>${escapeHtml(h)}</span>
            </label>`;
        }).join('');
        nameColsList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.addEventListener('change', () => {
                cb.closest('.file-name-col-chip')?.classList.toggle('checked', cb.checked);
            });
        });
    }

    // Selects de vinculación con Mi Negocio (título/descripción/precios)
    const fillOptionalSelect = (id, currentValue, emptyLabel) => {
        const sel = document.getElementById(id);
        if (!sel) return;
        sel.innerHTML = `<option value="">${emptyLabel}</option>`
            + sheetHeaders.map(h => `<option value="${escapeHtml(h)}">${escapeHtml(h)}</option>`).join('');
        sel.value = currentValue || '';
    };
    fillOptionalSelect('sheetInvTitleColSelect', inventoryTitleColumn, 'No vincular');
    fillOptionalSelect('sheetInvDescColSelect', inventoryDescriptionColumn, 'Ninguna');
    fillOptionalSelect('sheetInvOrigPriceColSelect', inventoryOriginalPriceColumn, 'Ninguna');
    fillOptionalSelect('sheetInvPromoPriceColSelect', inventoryPromoPriceColumn, 'Ninguna');
    fillOptionalSelect('sheetInvVinColSelect', inventoryVinColumn, 'No vincular');
    fillOptionalSelect('sheetInvNewArrivalColSelect', inventoryNewArrivalColumn, 'Ninguna');

    overlay.classList.add('open');
    // Si vinimos del ícono de álbum, deja el foco ahí en vez de en el de fotos
    if (focusField === 'album') {
        setTimeout(() => albumSel?.focus(), 150);
    } else {
        setTimeout(() => photoSel?.focus(), 150);
    }
}

function closeColumnConfigModal() {
    document.getElementById('columnConfigModalOverlay')?.classList.remove('open');
}

async function saveInventoryColumns() {
    if (!currentAgentId) return;
    const photoColumn = document.getElementById('sheetInvPhotoColSelect')?.value;
    const albumColumn = document.getElementById('sheetInvAlbumColSelect')?.value || '';
    const fileNameColumns = Array.from(
        document.querySelectorAll('#sheetInvNameColsList input[type="checkbox"]:checked')
    ).map(cb => cb.value);
    const titleColumn = document.getElementById('sheetInvTitleColSelect')?.value || '';
    const descriptionColumn = document.getElementById('sheetInvDescColSelect')?.value || '';
    const originalPriceColumn = document.getElementById('sheetInvOrigPriceColSelect')?.value || '';
    const promoPriceColumn = document.getElementById('sheetInvPromoPriceColSelect')?.value || '';
    const vinColumn = document.getElementById('sheetInvVinColSelect')?.value || '';
    const newArrivalColumn = document.getElementById('sheetInvNewArrivalColSelect')?.value || '';
    if (!photoColumn) return;

    const btn = document.getElementById('btnSaveInventoryColumns');
    if (btn) btn.disabled = true;

    try {
        const res = await fetch(`/api/inventory-sheets/columns/${currentAgentId}`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                photo_column: photoColumn,
                album_column: albumColumn,
                file_name_columns: fileNameColumns,
                title_column: titleColumn,
                description_column: descriptionColumn,
                original_price_column: originalPriceColumn,
                promo_price_column: promoPriceColumn,
                vin_column: vinColumn,
                new_arrival_column: newArrivalColumn,
            }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'No se pudo guardar la configuración');

        inventoryPhotoColumn = data.photo_column || null;
        inventoryAlbumColumn = data.album_column || null;
        inventoryFileNameColumns = data.file_name_columns || [];
        inventoryTitleColumn = data.title_column || null;
        inventoryDescriptionColumn = data.description_column || null;
        inventoryOriginalPriceColumn = data.original_price_column || null;
        inventoryPromoPriceColumn = data.promo_price_column || null;
        inventoryVinColumn = data.vin_column || null;
        inventoryNewArrivalColumn = data.new_arrival_column || null;
        updateColumnConfigUI();
        closeColumnConfigModal();
        renderSheet(sheetHeaders, sheetRows); // vuelve a pintar para activar los botones de subida

        if (typeof showToast === 'function') {
            if (data.sync_error) {
                showToast('error', 'Columnas guardadas, pero no se pudo vincular con Mi Negocio: ' + data.sync_error);
            } else if (typeof data.synced_products === 'number') {
                showToast('success', `Vinculado — ${data.synced_products} producto(s) en Mi Negocio`);
            } else {
                showToast('success', 'Listo — ya puedes subir fotos desde la tabla');
            }
        }
    } catch (err) {
        if (typeof showToast === 'function') showToast('error', err.message || 'Error al guardar la configuración');
    } finally {
        if (btn) btn.disabled = false;
    }
}

/* ============================================
   SUBIR FOTOS A UNA FILA CONOCIDA
   (sin IA: la fila ya se sabe por la celda en la
   que se dio clic — la detección de VIN vía Gemini
   es aparte, para el botón general "Subir foto")
   ============================================ */

function triggerRowPhotoUpload(row) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.addEventListener('change', () => {
        if (input.files && input.files.length) uploadRowPhotos(row, input.files);
    });
    input.click();
}

async function uploadRowPhotos(row, fileList) {
    if (!currentAgentId) return;

    const formData = new FormData();
    formData.append('row', row.row);

    // Si la hoja tiene una columna "VIN" con valor en esta fila, se usa como
    // nombre de la subcarpeta en Drive (más legible); si no, "Fila N".
    const vinIdx = sheetHeaders.findIndex(h => (h || '').trim().toUpperCase() === 'VIN');
    const vinCell = vinIdx !== -1 ? (row.cells || [])[vinIdx] : null;
    if (vinCell && vinCell.text) formData.append('folder_label', vinCell.text);

    Array.from(fileList).forEach(f => formData.append('photos', f));

    try {
        const res = await fetch(`/api/inventory-sheets/upload/${currentAgentId}`, {
            method: 'POST',
            credentials: 'include',
            body: formData,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'No se pudieron subir las fotos');

        if (typeof showToast === 'function') showToast('success', `${data.count} foto(s) subida(s)`);
        await loadSheetRows(); // refresca para mostrar la miniatura nueva
    } catch (err) {
        if (typeof showToast === 'function') showToast('error', err.message || 'Error al subir las fotos');
    }
}

async function connectSheetInventory() {
    const input = document.getElementById('sheetInvUrlInput');
    const btn   = document.getElementById('btnConnectSheetInv');
    const raw   = input?.value?.trim();

    if (!raw) {
        if (typeof showToast === 'function') showToast('error', 'Pega el enlace o ID de tu hoja de inventario');
        return;
    }
    if (!currentAgentId) return;

    const spreadsheetId = extractSpreadsheetId(raw);
    const originalHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<div class="loading-spinner" style="width:14px;height:14px;border-width:2px;"></div> Conectando...';
    }

    try {
        const res = await fetch(`/api/inventory-sheets/connect/${currentAgentId}`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ spreadsheet_url: spreadsheetId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'No se pudo conectar la hoja');

        applySheetStatus(data);
        await loadSheetRows();
        if (typeof showToast === 'function') showToast('success', 'Hoja de inventario conectada');
    } catch (err) {
        if (typeof showToast === 'function') showToast('error', err.message || 'Error al conectar la hoja');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = originalHtml || '<i class="lni lni-link"></i><span>Conectar hoja</span>'; }
    }
}

async function disconnectSheetInventory() {
    if (!currentAgentId) return;
    try {
        const res = await fetch(`/api/inventory-sheets/disconnect/${currentAgentId}`, {
            method: 'POST',
            credentials: 'include',
        });
        if (!res.ok) throw new Error('No se pudo desconectar');
        sheetHeaders = [];
        sheetRows = [];
        inventoryPhotoColumn = null;
        inventoryAlbumColumn = null;
        inventoryFileNameColumns = [];
        inventoryTitleColumn = null;
        inventoryDescriptionColumn = null;
        inventoryOriginalPriceColumn = null;
        inventoryPromoPriceColumn = null;
        inventoryVinColumn = null;
        inventoryNewArrivalColumn = null;
        applySheetStatus({ connected: false });
        if (typeof showToast === 'function') showToast('success', 'Hoja desconectada');
    } catch (err) {
        if (typeof showToast === 'function') showToast('error', err.message || 'Error al desconectar');
    }
}

function wireSheetInventoryButtons() {
    document.getElementById('btnConnectSheetInv')?.addEventListener('click', connectSheetInventory);
    document.getElementById('btnRefreshSheetInv')?.addEventListener('click', loadSheetRows);
    document.getElementById('btnDisconnectSheetInv')?.addEventListener('click', disconnectSheetInventory);
    document.getElementById('btnChangeSheetInv')?.addEventListener('click', () => {
        const form = document.getElementById('sheetInvConnectForm');
        if (form) form.style.display = 'block';
    });
    document.getElementById('btnSaveInventoryColumns')?.addEventListener('click', saveInventoryColumns);

    document.getElementById('btnOpenPhotoColConfig')?.addEventListener('click', () => openColumnConfigModal('photo'));
    document.getElementById('btnOpenAlbumColConfig')?.addEventListener('click', () => openColumnConfigModal('album'));
    document.getElementById('btnCloseColumnConfig')?.addEventListener('click', closeColumnConfigModal);
    document.getElementById('btnCancelColumnConfig')?.addEventListener('click', closeColumnConfigModal);

    const columnOverlay = document.getElementById('columnConfigModalOverlay');
    columnOverlay?.addEventListener('click', (e) => {
        if (e.target === columnOverlay) closeColumnConfigModal(); // clic fuera de la tarjeta
    });

    document.getElementById('btnOpenAiUpload')?.addEventListener('click', openAiUploadModal);
    document.getElementById('btnCloseAiUpload')?.addEventListener('click', closeAiUploadModal);
    document.getElementById('btnCancelAiUpload')?.addEventListener('click', closeAiUploadModal);
    document.getElementById('btnSubmitAiUpload')?.addEventListener('click', submitAiUpload);
    document.getElementById('aiUploadDropzone')?.addEventListener('click', () => {
        document.getElementById('aiUploadFileInput')?.click();
    });
    document.getElementById('aiUploadFileInput')?.addEventListener('change', renderAiUploadPreview);

    document.getElementById('btnOpenGeminiKeyConfig')?.addEventListener('click', openGeminiKeyModal);
    document.getElementById('btnCloseGeminiKey')?.addEventListener('click', closeGeminiKeyModal);
    document.getElementById('btnCancelGeminiKey')?.addEventListener('click', closeGeminiKeyModal);
    document.getElementById('btnSaveGeminiKey')?.addEventListener('click', saveGeminiKey);
    document.getElementById('btnRemoveGeminiKey')?.addEventListener('click', removeGeminiKey);

    const geminiOverlay = document.getElementById('geminiKeyModalOverlay');
    geminiOverlay?.addEventListener('click', (e) => {
        if (e.target === geminiOverlay) closeGeminiKeyModal();
    });

    const aiOverlay = document.getElementById('aiUploadModalOverlay');
    aiOverlay?.addEventListener('click', (e) => {
        if (e.target === aiOverlay) closeAiUploadModal();
    });

    document.getElementById('btnOpenBulkUpdate')?.addEventListener('click', openBulkUpdateModal);
    document.getElementById('btnCloseBulkUpdate')?.addEventListener('click', closeBulkUpdateModal);
    document.getElementById('btnCancelBulkUpdate')?.addEventListener('click', closeBulkUpdateModal);
    document.getElementById('btnSubmitBulkUpdate')?.addEventListener('click', submitBulkUpdate);
    document.getElementById('bulkUpdateDropzone')?.addEventListener('click', () => {
        document.getElementById('bulkUpdateFileInput')?.click();
    });
    document.getElementById('bulkUpdateFileInput')?.addEventListener('change', onBulkUpdateFileChosen);

    const bulkOverlay = document.getElementById('bulkUpdateModalOverlay');
    bulkOverlay?.addEventListener('click', (e) => {
        if (e.target === bulkOverlay) closeBulkUpdateModal();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (columnOverlay?.classList.contains('open')) closeColumnConfigModal();
        if (aiOverlay?.classList.contains('open')) closeAiUploadModal();
        if (geminiOverlay?.classList.contains('open')) closeGeminiKeyModal();
        if (bulkOverlay?.classList.contains('open')) closeBulkUpdateModal();
    });
}

/* ============================================
   SUBIR FOTO CON IA (detecta el VIN) — SOLO
   FRONTEND por ahora. El endpoint todavía no
   existe en el backend (falta conectar Gemini);
   esta llamada ya queda lista para cuando exista.
   ============================================ */

function openAiUploadModal() {
    const overlay = document.getElementById('aiUploadModalOverlay');
    const fileInput = document.getElementById('aiUploadFileInput');
    const preview = document.getElementById('aiUploadPreview');
    if (fileInput) fileInput.value = '';
    if (preview) preview.innerHTML = '';
    overlay?.classList.add('open');
}

function closeAiUploadModal() {
    document.getElementById('aiUploadModalOverlay')?.classList.remove('open');
}

function renderAiUploadPreview() {
    const fileInput = document.getElementById('aiUploadFileInput');
    const preview = document.getElementById('aiUploadPreview');
    if (!fileInput || !preview) return;
    preview.innerHTML = '';
    Array.from(fileInput.files || []).forEach(file => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = document.createElement('img');
            img.className = 'ai-upload-preview-thumb';
            img.src = e.target.result;
            preview.appendChild(img);
        };
        reader.readAsDataURL(file);
    });
}

async function submitAiUpload() {
    const fileInput = document.getElementById('aiUploadFileInput');
    if (!fileInput || !fileInput.files.length) {
        if (typeof showToast === 'function') showToast('error', 'Elige al menos una foto');
        return;
    }
    if (!currentAgentId) return;

    const formData = new FormData();
    Array.from(fileInput.files).forEach(f => formData.append('photos', f));

    const btn = document.getElementById('btnSubmitAiUpload');
    const originalHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<div class="loading-spinner" style="width:14px;height:14px;border-width:2px;"></div> Detectando...';
    }

    try {
        const res = await fetch(`/api/inventory-sheets/detect-upload/${currentAgentId}`, {
            method: 'POST',
            credentials: 'include',
            body: formData,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'No se pudo procesar la foto');

        if (typeof showToast === 'function') showToast('success', `VIN detectado: ${data.vin || ''}`);
        closeAiUploadModal();
        await loadSheetRows();
    } catch (err) {
        if (typeof showToast === 'function') showToast('error', err.message || 'No se pudo procesar la foto con IA');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = originalHtml; }
    }
}

/* ============================================
   ACTUALIZAR DESDE ARCHIVO (Excel) — compara por
   VIN contra la hoja: actualiza, agrega, y marca
   "Nuevas llegadas" (solo la celda, se limpia en
   cada corrida). Lo que ya no aparece en el
   archivo no se toca. Necesita que ya se haya
   configurado la columna de VIN.
   ============================================ */

function openBulkUpdateModal() {
    const overlay = document.getElementById('bulkUpdateModalOverlay');
    const fileInput = document.getElementById('bulkUpdateFileInput');
    const label = document.getElementById('bulkUpdateFileLabel');
    if (!overlay) return;

    if (!inventoryVinColumn) {
        if (typeof showToast === 'function') showToast('error', 'Primero configura cuál es la columna de VIN (ícono de configuración)');
        return;
    }

    if (fileInput) fileInput.value = '';
    if (label) label.textContent = 'Elegir archivo .xlsx…';
    overlay.classList.add('open');
}

function closeBulkUpdateModal() {
    document.getElementById('bulkUpdateModalOverlay')?.classList.remove('open');
}

function onBulkUpdateFileChosen() {
    const fileInput = document.getElementById('bulkUpdateFileInput');
    const label = document.getElementById('bulkUpdateFileLabel');
    const file = fileInput?.files?.[0];
    if (label) label.textContent = file ? file.name : 'Elegir archivo .xlsx…';
}

async function submitBulkUpdate() {
    const fileInput = document.getElementById('bulkUpdateFileInput');
    const file = fileInput?.files?.[0];
    if (!file) {
        if (typeof showToast === 'function') showToast('error', 'Elige un archivo .xlsx primero');
        return;
    }
    if (!currentAgentId) return;

    const formData = new FormData();
    formData.append('file', file);

    const btn = document.getElementById('btnSubmitBulkUpdate');
    const originalHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<div class="loading-spinner" style="width:14px;height:14px;border-width:2px;"></div> Actualizando...';
    }

    try {
        const res = await fetch(`/api/inventory-sheets/bulk-update/${currentAgentId}`, {
            method: 'POST',
            credentials: 'include',
            body: formData,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'No se pudo actualizar el inventario');

        if (typeof showToast === 'function') {
            showToast('success', `Actualizados: ${data.updated || 0} · Nuevos: ${data.added || 0}`);
        }
        closeBulkUpdateModal();
        await loadSheetRows();
    } catch (err) {
        if (typeof showToast === 'function') showToast('error', err.message || 'No se pudo actualizar el inventario');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = originalHtml; }
    }
}

/* ============================================
   API KEY DE GEMINI PROPIA DEL AGENTE (opcional)
   Si no se configura, el backend usa el fallback
   compartido GEMINI_VISION_API_KEY.
   ============================================ */

function updateGeminiKeyUI() {
    const btn = document.getElementById('btnOpenGeminiKeyConfig');
    if (!btn) return;
    btn.classList.toggle('needs-config', !hasOwnGeminiKey && !hasSharedGeminiKey);
    btn.title = hasOwnGeminiKey ? 'Ya tienes tu propia API Key de Gemini' : 'Configura tu propia API Key de Gemini (opcional)';
}

function openGeminiKeyModal() {
    const overlay = document.getElementById('geminiKeyModalOverlay');
    const input = document.getElementById('geminiKeyInput');
    const hint = document.getElementById('geminiKeyStatusHint');
    const removeBtn = document.getElementById('btnRemoveGeminiKey');
    if (!overlay) return;

    if (input) input.value = '';
    if (hint) {
        hint.textContent = hasOwnGeminiKey
            ? 'Ya tienes una API Key propia configurada. Pega una nueva para reemplazarla.'
            : (hasSharedGeminiKey
                ? 'Si no configuras una propia, se usa la key compartida de Attomos.'
                : 'Todavía no hay ninguna key configurada (ni propia ni compartida) — la detección con IA no va a funcionar hasta que agregues una.');
    }
    if (removeBtn) removeBtn.style.display = hasOwnGeminiKey ? 'inline-flex' : 'none';

    overlay.classList.add('open');
}

function closeGeminiKeyModal() {
    document.getElementById('geminiKeyModalOverlay')?.classList.remove('open');
}

async function saveGeminiKey() {
    if (!currentAgentId) return;
    const input = document.getElementById('geminiKeyInput');
    const apiKey = input?.value?.trim();
    if (!apiKey) {
        if (typeof showToast === 'function') showToast('error', 'Pega tu API Key de Gemini');
        return;
    }

    const btn = document.getElementById('btnSaveGeminiKey');
    if (btn) btn.disabled = true;

    try {
        const res = await fetch(`/api/inventory-sheets/gemini-key/${currentAgentId}`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: apiKey }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'No se pudo guardar la API Key');

        hasOwnGeminiKey = true;
        updateGeminiKeyUI();
        closeGeminiKeyModal();
        if (typeof showToast === 'function') showToast('success', 'API Key de Gemini guardada');
    } catch (err) {
        if (typeof showToast === 'function') showToast('error', err.message || 'Error al guardar la API Key');
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function removeGeminiKey() {
    if (!currentAgentId) return;
    try {
        const res = await fetch(`/api/inventory-sheets/gemini-key/${currentAgentId}/remove`, {
            method: 'POST',
            credentials: 'include',
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'No se pudo quitar la API Key');

        hasOwnGeminiKey = false;
        updateGeminiKeyUI();
        closeGeminiKeyModal();
        if (typeof showToast === 'function') showToast('success', 'API Key propia eliminada — ahora se usa la compartida');
    } catch (err) {
        if (typeof showToast === 'function') showToast('error', err.message || 'Error al quitar la API Key');
    }
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

let sheetInvIsConnected = false;
let sheetAutoRefreshTimer = null;
const SHEET_AUTO_REFRESH_MS = 45000; // cada 45s mientras la vista de Sheets esté abierta

function startSheetAutoRefresh() {
    stopSheetAutoRefresh();
    sheetAutoRefreshTimer = setInterval(() => {
        if (document.hidden) return; // no gastar llamadas con la pestaña en segundo plano
        if (!sheetInvIsConnected) return;
        loadSheetRows();
    }, SHEET_AUTO_REFRESH_MS);
}

function stopSheetAutoRefresh() {
    if (sheetAutoRefreshTimer) {
        clearInterval(sheetAutoRefreshTimer);
        sheetAutoRefreshTimer = null;
    }
}

function setActiveView(view) {
    document.querySelectorAll('.inv-view-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === view);
    });
    document.querySelectorAll('.inv-view-panel').forEach(panel => {
        panel.classList.toggle('active', panel.dataset.view === view);
    });

    // Mientras se está viendo la hoja, se refresca sola (y con eso, también
    // el catálogo de Mi Negocio — ver GetInventorySheetRows en el backend).
    if (view === 'sheets') {
        startSheetAutoRefresh();
    } else {
        stopSheetAutoRefresh();
    }
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

// Le avisa al padre (Mi Negocio) si hay algún modal abierto dentro del
// iframe, para que oculte su botón flotante "Guardar Cambios" mientras
// tanto — si no, ese botón queda brillando por encima del fondo oscurecido
// del modal, porque vive fuera del iframe y el overlay no lo puede cubrir.
function notifyParentModalState() {
    if (!IS_EMBEDDED) return;
    const anyOpen = !!document.querySelector('.modal-overlay.open');
    window.parent.postMessage({ type: 'attomos:inventory:modal-state', open: anyOpen }, window.location.origin);
}

function initModalVisibilityBridge() {
    const overlays = document.querySelectorAll('.modal-overlay');
    if (!overlays.length || !IS_EMBEDDED) return;
    const observer = new MutationObserver(notifyParentModalState);
    overlays.forEach(el => observer.observe(el, { attributes: true, attributeFilter: ['class'] }));
}

/* ============================================
   REPAIRDESK — trasladado desde my-business.js.
   Es independiente de la pestaña Mi Negocio (usa
   sus propios endpoints con cookies de sesión),
   así que funciona igual standalone o embebido.
   ============================================ */

async function initRepairDeskInventory() {
    try {
        const agentId = await getAgentId();
        if (!agentId) return;
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
    initViewToggle();
    renderBusinessInventory([]); // estado vacío hasta que llegue el postMessage del padre
    wireSheetInventoryButtons();
    initSheetInventory();
    initRepairDeskInventory();
    notifyParentReady();
    initModalVisibilityBridge();
});