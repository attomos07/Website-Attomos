/* ============================================
   API EXPLORER
   Consume CUALQUIER endpoint que responda JSON —
   no está atado a ningún negocio/esquema en
   particular.

   El endpoint + la API key viven en el backend
   (tabla agents, campos APIExplorer*) — nunca en
   localStorage del navegador. El propio backend
   hace el fetch al endpoint externo (proxy), así
   que la key nunca se manda al cliente y se evita
   el problema de CORS que tenía la versión 100%
   frontend.
   ============================================ */

const APX_AUTO_REFRESH_MS = 60000; // cada 60s mientras la vista esté abierta y conectada

let apxAgentId = null;
let apxConnected = false;
let apxEndpoint = '';
let apxAuthMode = 'header';
let apxLastRaw = null;
let apxRawVisible = false;
let apxAutoRefreshTimer = null;

function apxEscapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
}

/* ---------- agente actual ---------- */
// Si esta página ya cargó inventory.js en el mismo DOM (embebida en el tab
// de Inventario), reutilizamos su getAgentId()/currentAgentId para no pedir
// /api/agents dos veces. Si no existe (api-explorer.html standalone), cae a
// su propia implementación con nombre único para no chocar con la de
// inventory.js si en algún momento ambas conviven.

let _apxAgentIdPromise = null;
function apxGetAgentId() {
    if (typeof window.getAgentId === 'function') {
        return window.getAgentId();
    }
    if (!_apxAgentIdPromise) {
        _apxAgentIdPromise = fetch('/api/agents', { credentials: 'include' })
            .then(res => (res.ok ? res.json() : { agents: [] }))
            .then(data => (data.agents && data.agents.length ? data.agents[0].id : null))
            .catch(() => null);
    }
    return _apxAgentIdPromise;
}

/* ---------- auto refresh ---------- */

function apxStartAutoRefresh() {
    apxStopAutoRefresh();
    apxAutoRefreshTimer = setInterval(() => {
        if (document.hidden) return;
        if (!apxConnected) return;
        fetchApiExplorerData();
    }, APX_AUTO_REFRESH_MS);
}

function apxStopAutoRefresh() {
    if (apxAutoRefreshTimer) {
        clearInterval(apxAutoRefreshTimer);
        apxAutoRefreshTimer = null;
    }
}

/* ---------- connection UI ---------- */

function apxSetStatus(state, text) {
    const badge = document.getElementById('apxStatusBadge');
    const badgeText = document.getElementById('apxStatusText');
    if (badge) badge.className = 'apx-status-badge apx-' + state;
    if (badgeText) badgeText.textContent = text;
}

function applyApxConnectionUI(connected) {
    const form          = document.getElementById('apxConnectForm');
    const info          = document.getElementById('apxConnectionInfo');
    const manageActions = document.getElementById('apxManageActions');
    const link          = document.getElementById('apxLink');
    const linkText      = document.getElementById('apxLinkText');
    const indicators    = document.getElementById('apxIndicators');
    const tableWrap     = document.getElementById('apxTableWrap');
    const rawContainer  = document.getElementById('apxRawContainer');
    const empty         = document.getElementById('apxEmpty');

    if (connected) {
        apxSetStatus('connected', 'Conectado');
        if (form) form.style.display = 'none';
        if (info) info.style.display = 'block';
        if (manageActions) manageActions.style.display = 'flex';
        if (link) link.href = apxEndpoint;
        if (linkText) linkText.textContent = apxEndpoint;
        apxConnected = true;
    } else {
        apxSetStatus('disconnected', 'Sin conectar');
        if (form) form.style.display = 'flex';
        if (info) info.style.display = 'none';
        if (manageActions) manageActions.style.display = 'none';
        if (indicators) indicators.style.display = 'none';
        if (tableWrap) tableWrap.style.display = 'none';
        if (rawContainer) rawContainer.style.display = 'none';
        if (empty) empty.style.display = 'none';
        apxConnected = false;
    }
}

/* ---------- indicators ---------- */

function renderApxIndicators({ estadoOk, estadoText, total, tiempoMs, actualizado }) {
    const indicators = document.getElementById('apxIndicators');
    if (indicators) indicators.style.display = 'grid';

    const estadoEl = document.getElementById('apxIndEstado');
    if (estadoEl) {
        estadoEl.textContent = estadoText;
        estadoEl.style.color = estadoOk === null ? '#b45309' : (estadoOk ? '#16a34a' : '#dc2626');
    }
    const totalEl = document.getElementById('apxIndTotal');
    if (totalEl) totalEl.textContent = (typeof total === 'number') ? total.toLocaleString('es-MX') : '—';

    const tiempoEl = document.getElementById('apxIndTiempo');
    if (tiempoEl) tiempoEl.textContent = (tiempoMs != null) ? `${tiempoMs} ms` : '—';

    const actEl = document.getElementById('apxIndActualizado');
    if (actEl) {
        actEl.textContent = actualizado
            ? new Date(actualizado).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
            : '—';
    }
}

function showApxEmpty(show, msg) {
    const empty = document.getElementById('apxEmpty');
    const text = document.getElementById('apxEmptyText');
    if (!empty) return;
    empty.style.display = show ? 'flex' : 'none';
    if (text && msg) text.textContent = msg;
}

/* ---------- detección genérica de imágenes ---------- */
// No asumimos nombres de columna fijos: cualquier endpoint puede tener su
// propio esquema. Se detecta por el nombre del campo (foto/imagen/photo/...)
// o porque el valor mismo se ve como una URL de imagen.

const APX_IMAGE_FIELD_RE = /foto|imagen|image|photo|picture|thumbnail|avatar|logo|banner/i;
const APX_IMAGE_URL_RE = /\.(jpe?g|png|gif|webp|avif|bmp)(\?.*)?$/i;

function apxLooksLikeImageUrl(v) {
    if (typeof v !== 'string') return false;
    return APX_IMAGE_URL_RE.test(v) || v.startsWith('data:image') || /\/(img|images|photos|fotos)\//i.test(v);
}

function apxFieldOrValueIsImage(headerName, value) {
    if (Array.isArray(value)) return value.some(apxLooksLikeImageUrl);
    if (apxLooksLikeImageUrl(value)) return true;
    return APX_IMAGE_FIELD_RE.test(headerName) && typeof value === 'string' && /^https?:\/\//i.test(value);
}

/* ---------- parseo genérico de la respuesta ---------- */

// Busca la lista de "filas" dentro de la respuesta, sin asumir el nombre de
// la llave: intenta las más comunes primero, y si no, usa el primer array
// que encuentre en el objeto raíz.
function apxExtractRows(data) {
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== 'object') return [];

    const preferredKeys = ['vehiculos', 'items', 'rows', 'results', 'records', 'productos', 'products', 'autos', 'list', 'data'];
    for (const k of preferredKeys) {
        if (Array.isArray(data[k])) return data[k];
    }
    for (const k in data) {
        if (Array.isArray(data[k])) return data[k];
    }
    return [];
}

function apxCollectHeaders(rows) {
    const seen = [];
    const set = new Set();
    rows.forEach(row => {
        if (!row || typeof row !== 'object' || Array.isArray(row)) return;
        Object.keys(row).forEach(k => {
            if (!set.has(k)) { set.add(k); seen.push(k); }
        });
    });
    return seen;
}

function apxFormatCellValue(value) {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'number') return value.toLocaleString('es-MX');
    if (typeof value === 'boolean') return value ? 'Sí' : 'No';
    if (Array.isArray(value)) {
        if (value.every(v => typeof v !== 'object' || v === null)) return value.join(', ');
        return `${value.length} elemento(s)`;
    }
    if (typeof value === 'object') {
        try { return JSON.stringify(value); } catch (e) { return String(value); }
    }
    return String(value);
}

function apxBuildImageCell(value) {
    let url = null;
    let extra = 0;
    if (Array.isArray(value)) {
        const imgs = value.filter(apxLooksLikeImageUrl);
        url = imgs[0] || null;
        extra = Math.max(0, imgs.length - 1);
    } else if (apxLooksLikeImageUrl(value)) {
        url = value;
    }

    const td = document.createElement('td');
    td.classList.add('apx-photo-cell');
    if (url) {
        const img = document.createElement('img');
        img.className = 'apx-thumb';
        img.src = url;
        img.alt = '';
        img.loading = 'lazy';
        img.onerror = function () { this.style.visibility = 'hidden'; };
        td.appendChild(img);
        if (extra > 0) {
            const badge = document.createElement('span');
            badge.className = 'apx-thumb-extra';
            badge.textContent = `+${extra}`;
            td.appendChild(badge);
        }
    } else {
        td.textContent = '—';
    }
    return td;
}

/* ---------- tabla ---------- */

function renderApxTable(rows) {
    const wrap     = document.getElementById('apxTableWrap');
    const theadRow = document.getElementById('apxTableHead');
    const tbody    = document.getElementById('apxTableBody');
    if (!wrap || !theadRow || !tbody) return;

    if (!rows.length) {
        wrap.style.display = 'none';
        theadRow.innerHTML = '';
        tbody.innerHTML = '';
        return;
    }

    wrap.style.display = 'block';
    const headers = apxCollectHeaders(rows);
    theadRow.innerHTML = headers.map(h => `<th>${apxEscapeHtml(h)}</th>`).join('');

    tbody.innerHTML = '';
    rows.forEach(row => {
        const tr = document.createElement('tr');
        headers.forEach(h => {
            const value = row ? row[h] : undefined;
            if (apxFieldOrValueIsImage(h, value)) {
                tr.appendChild(apxBuildImageCell(value));
            } else {
                const td = document.createElement('td');
                td.textContent = apxFormatCellValue(value);
                td.title = td.textContent;
                tr.appendChild(td);
            }
        });
        tbody.appendChild(tr);
    });
}

function renderApxRaw() {
    const pre = document.getElementById('apxRawJson');
    if (!pre) return;
    pre.textContent = apxLastRaw ? JSON.stringify(apxLastRaw, null, 2) : 'Sin datos todavía.';
}

/* ---------- aplica el resultado del proxy (connect o data) a la UI ---------- */
// Mismo shape que regresa el backend en ambos casos:
// { ok, status, elapsed_ms, data } o { ok:false, error }

function applyApxFetchResult(result) {
    apxLastRaw = result.data ?? null;

    if (!result.ok) {
        const msg = result.error || `HTTP ${result.status}`;
        renderApxIndicators({ estadoOk: false, estadoText: result.status ? `Error (${result.status})` : 'Error', total: 0, tiempoMs: result.elapsed_ms ?? null, actualizado: null });
        renderApxTable([]);
        showApxEmpty(true, `No se pudo leer la API: ${msg}`);
        if (apxRawVisible) renderApxRaw();
        if (typeof showToast === 'function') showToast('error', msg);
        return;
    }

    const data = result.data;
    const rows = apxExtractRows(data);
    const total = (data && typeof data.total === 'number') ? data.total : rows.length;
    const actualizado = (data && (data.actualizado || data.updated_at || data.updatedAt || data.last_sync)) || null;

    renderApxIndicators({ estadoOk: true, estadoText: 'OK', total, tiempoMs: result.elapsed_ms ?? null, actualizado });
    renderApxTable(rows);
    showApxEmpty(rows.length === 0, 'La API respondió pero no se encontraron elementos para mostrar.');
    if (apxRawVisible) renderApxRaw();
}

/* ---------- fetch principal (vía backend) ---------- */

async function fetchApiExplorerData() {
    if (!apxAgentId || !apxConnected) return;

    const btnRefresh = document.getElementById('btnApxRefresh');
    if (btnRefresh) btnRefresh.disabled = true;
    renderApxIndicators({ estadoOk: null, estadoText: 'Consultando…', total: null, tiempoMs: null, actualizado: null });

    try {
        const res = await fetch(`/api/api-explorer/data/${apxAgentId}`, { credentials: 'include', cache: 'no-store' });
        const result = await res.json().catch(() => ({ ok: false, error: 'Respuesta inválida del servidor' }));
        applyApxFetchResult(result);
    } catch (err) {
        applyApxFetchResult({ ok: false, error: err.message || 'No se pudo conectar con el servidor' });
    } finally {
        if (btnRefresh) btnRefresh.disabled = false;
    }
}

/* ---------- status / connect / disconnect (vía backend) ---------- */

async function apxRefreshStatus() {
    if (!apxAgentId) return;
    try {
        const res = await fetch(`/api/api-explorer/status/${apxAgentId}`, { credentials: 'include', cache: 'no-store' });
        if (!res.ok) { applyApxConnectionUI(false); return; }
        const data = await res.json();

        if (data.connected) {
            apxEndpoint = data.endpoint || '';
            apxAuthMode = data.auth_mode || 'header';

            const endpointInput = document.getElementById('apxEndpointInput');
            const authSelect    = document.getElementById('apxAuthModeSelect');
            if (endpointInput) endpointInput.value = apxEndpoint;
            if (authSelect) authSelect.value = apxAuthMode;
            // La key nunca vuelve del backend — el campo se deja vacío;
            // solo hay que volver a pegarla si se quiere cambiar.

            applyApxConnectionUI(true);
            await fetchApiExplorerData();
            apxStartAutoRefresh();
        } else {
            applyApxConnectionUI(false);
        }
    } catch (err) {
        applyApxConnectionUI(false);
    }
}

async function apxConnect() {
    const endpointInput = document.getElementById('apxEndpointInput');
    const keyInput       = document.getElementById('apxKeyInput');
    const authSelect     = document.getElementById('apxAuthModeSelect');
    const connectBtn     = document.getElementById('btnApxConnect');

    const endpoint = (endpointInput?.value || '').trim();
    if (!endpoint) {
        if (typeof showToast === 'function') showToast('error', 'Ingresa el endpoint de la API.');
        return;
    }
    if (!apxAgentId) {
        if (typeof showToast === 'function') showToast('error', 'No se encontró el agente. Recarga la página.');
        return;
    }

    const apiKey = (keyInput?.value || '').trim();
    const authMode = authSelect?.value || 'header';

    if (connectBtn) connectBtn.disabled = true;
    apxSetStatus('pending', 'Conectando…');

    try {
        const res = await fetch(`/api/api-explorer/connect/${apxAgentId}`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint, api_key: apiKey, auth_mode: authMode }),
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
            apxSetStatus('error', 'Error');
            if (typeof showToast === 'function') showToast('error', data.error || 'No se pudo conectar');
            applyApxConnectionUI(false);
            return;
        }

        apxEndpoint = data.endpoint || endpoint;
        apxAuthMode = data.auth_mode || authMode;
        if (keyInput) keyInput.value = ''; // ya no hace falta tenerla en el campo

        applyApxConnectionUI(true);
        if (data.preview) applyApxFetchResult(data.preview);
        apxStartAutoRefresh();
        if (typeof showToast === 'function') showToast('success', 'Endpoint conectado');
    } catch (err) {
        apxSetStatus('error', 'Error');
        if (typeof showToast === 'function') showToast('error', 'No se pudo conectar con el servidor');
        applyApxConnectionUI(false);
    } finally {
        if (connectBtn) connectBtn.disabled = false;
    }
}

async function apxDisconnect() {
    if (!apxAgentId) return;
    try {
        const res = await fetch(`/api/api-explorer/disconnect/${apxAgentId}`, {
            method: 'POST',
            credentials: 'include',
        });
        if (!res.ok) {
            if (typeof showToast === 'function') showToast('error', 'No se pudo desconectar');
            return;
        }
    } catch (err) {
        if (typeof showToast === 'function') showToast('error', 'No se pudo conectar con el servidor');
        return;
    }

    apxEndpoint = '';
    apxAuthMode = 'header';
    apxLastRaw = null;
    apxRawVisible = false;
    apxStopAutoRefresh();

    const endpointInput = document.getElementById('apxEndpointInput');
    const keyInput       = document.getElementById('apxKeyInput');
    if (endpointInput) endpointInput.value = '';
    if (keyInput) keyInput.value = '';

    applyApxConnectionUI(false);
    if (typeof showToast === 'function') showToast('success', 'Endpoint olvidado del servidor');
}

/* ---------- init + botones ---------- */

async function initApiExplorer() {
    apxAgentId = await apxGetAgentId();
    if (!apxAgentId) {
        applyApxConnectionUI(false);
        return;
    }
    await apxRefreshStatus();
}

function wireApiExplorerButtons() {
    document.getElementById('apxToggleEye')?.addEventListener('click', () => {
        const keyInput = document.getElementById('apxKeyInput');
        const icon = document.getElementById('apxEyeIcon');
        if (!keyInput) return;
        const isPw = keyInput.type === 'password';
        keyInput.type = isPw ? 'text' : 'password';
        if (icon) icon.className = isPw ? 'lni lni-eye-slash' : 'lni lni-eye';
    });

    document.getElementById('btnApxConnect')?.addEventListener('click', apxConnect);
    document.getElementById('btnApxRefresh')?.addEventListener('click', () => fetchApiExplorerData());

    document.getElementById('btnApxChange')?.addEventListener('click', () => {
        applyApxConnectionUI(false);
        apxStopAutoRefresh();
    });

    document.getElementById('btnApxDisconnect')?.addEventListener('click', apxDisconnect);

    document.getElementById('btnApxToggleRaw')?.addEventListener('click', () => {
        apxRawVisible = !apxRawVisible;
        const container = document.getElementById('apxRawContainer');
        const label = document.getElementById('btnApxToggleRawLabel');
        if (container) container.style.display = apxRawVisible ? 'block' : 'none';
        if (label) label.textContent = apxRawVisible ? 'Ocultar JSON crudo' : 'Ver JSON crudo';
        if (apxRawVisible) renderApxRaw();
    });
}

document.addEventListener('DOMContentLoaded', () => {
    wireApiExplorerButtons();
    initApiExplorer();
});