// ═══════════════════════════════════════════════════
// CLIENT HISTORY — JavaScript
// Attomos — Historial del Cliente / Historial Clínico
// ═══════════════════════════════════════════════════

// ── Estado global ────────────────────────────────────
let historialData = [];
let agents        = [];
let currentPage   = 1;
let totalRecords  = 0;
const LIMIT       = 10;

let filters = {
    search:  '',
    type:    'all',
    range:   'all',
    agentId: 'all'
};

// ═══════════════════════════════════════════════════
// TÍTULO DINÁMICO POR TIPO DE NEGOCIO
// ═══════════════════════════════════════════════════
async function adaptPageTitle() {
    try {
        const r = await fetch('/api/me', { credentials: 'include' });
        if (!r.ok) return;
        const data = await r.json();
        const bt   = (data.user?.businessType || '').toLowerCase();
        const CLINICA = ['clinica','clínica','dental','medico','médico','salud','veterinaria','odontologia'];
        const PELUQ   = ['peluqueria','peluquería','salon','salón','barberia','barbería','spa','estetica','estética','belleza'];

        if (CLINICA.some(t => bt.includes(t))) {
            document.getElementById('pageTitle').textContent    = 'Historial Clínico';
            document.getElementById('pageSubtitle').textContent = 'Expediente completo de pacientes y consultas';
            document.title = 'Historial Clínico - Attomos';
        } else if (PELUQ.some(t => bt.includes(t))) {
            document.getElementById('pageTitle').textContent    = 'Historial de Cliente';
            document.getElementById('pageSubtitle').textContent = 'Ficha completa de visitas y servicios';
            document.title = 'Historial de Cliente - Attomos';
        }
    } catch(e) {}
}

// ═══════════════════════════════════════════════════
// CARGA DE DATOS
// ═══════════════════════════════════════════════════
async function loadAgents() {
    try {
        const r = await fetch('/api/agents', { credentials: 'include' });
        if (!r.ok) return;
        const d = await r.json();
        agents = d.agents || [];
        const container = document.getElementById('agentFilterOptions');
        agents.forEach(ag => {
            const div = document.createElement('div');
            div.className = 'dropdown-option';
            div.innerHTML = `<span>${escapeHtml(ag.name)}</span>`;
            div.onclick   = () => selectAgentFilter(div, ag.id);
            container.appendChild(div);
        });
    } catch(e) {}
}

async function loadHistorial() {
    showSkeleton();
    const params = new URLSearchParams({
        page:    currentPage,
        limit:   LIMIT,
        search:  filters.search,
        type:    filters.type,
        range:   filters.range,
        agentId: filters.agentId
    });

    try {
        const r = await fetch(`/api/client-history?${params}`, { credentials: 'include' });
        if (!r.ok) throw new Error('Error al cargar historial');
        const d = await r.json();

        historialData = d.historial || [];
        totalRecords  = d.total     || 0;

        renderStats(d.stats);
        renderTable();
        renderPagination();
    } catch(e) {
        showError(e.message);
    }
}

// ═══════════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════════
function renderStats(stats) {
    if (!stats) return;
    document.getElementById('statVisitas').textContent    = stats.totalVisitas    ?? '—';
    document.getElementById('statClientes').textContent   = stats.totalClientes   ?? '—';
    document.getElementById('statMes').textContent        = stats.visitasMes      ?? '—';
    document.getElementById('statCanceladas').textContent = stats.totalCanceladas ?? '—';
}

function renderTable() {
    const tbody = document.getElementById('historialBody');

    if (!historialData.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8">
                    <div class="empty-historial">
                        <i class="lni lni-files"></i>
                        <h3>Sin registros</h3>
                        <p>No se encontraron entradas con los filtros actuales</p>
                    </div>
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = historialData.map(h => {
        const initials      = ((h.clientFirst||'')[0]||'') + ((h.clientLast||'')[0]||'');
        const dateFormatted = formatDate(h.date);
        const timeFormatted = formatTime(h.time);

        const typeBadge = h.entryType === 'visita'
            ? `<span class="badge badge-visita"><i class="lni lni-checkmark-circle"></i> Visita</span>`
            : h.entryType === 'cancelada'
            ? `<span class="badge badge-cancelada"><i class="lni lni-close"></i> Cancelada</span>`
            : `<span class="badge badge-cita"><i class="lni lni-calendar"></i> Cita</span>`;

        const srcClass = h.source === 'sheets' ? 'sheets' : h.source === 'agent' ? 'agent' : 'manual';
        const srcLabel = h.source === 'sheets' ? 'Sheets' : h.source === 'agent' ? 'Agente' : 'Manual';

        const sheetBtn = h.sheetUrl
            ? `<a class="sheet-link" href="${h.sheetUrl}" target="_blank"><i class="lni lni-google"></i></a>`
            : '';

        return `
        <tr>
            <td>
                <div class="client-cell">
                    <div class="client-avatar">${escapeHtml(initials.toUpperCase()) || '?'}</div>
                    <div class="client-info">
                        <div class="client-name">${escapeHtml(h.client)}</div>
                        <div class="client-phone">${escapeHtml(h.phone || '—')}</div>
                    </div>
                </div>
            </td>
            <td>${escapeHtml(h.service || '—')}</td>
            <td>${escapeHtml(h.worker  || '—')}</td>
            <td>
                <div class="date-cell">
                    <div class="date-main">${dateFormatted}</div>
                    <div class="date-time">${timeFormatted}</div>
                </div>
            </td>
            <td>${escapeHtml(h.agentName || '—')}</td>
            <td>${typeBadge}</td>
            <td>
                <span class="source-badge ${srcClass}">${srcLabel}</span>
                ${sheetBtn}
            </td>
            <td>
                <div class="actions-cell">
                    <button class="action-btn" title="Ver historial del cliente"
                        onclick="openClientPanel('${escapeHtml(h.phone)}', '${escapeHtml(h.client)}')">
                        <i class="lni lni-user"></i>
                    </button>
                    ${h.phone ? `
                    <button class="action-btn" title="WhatsApp"
                        onclick="sendWhatsApp('${escapeHtml(h.phone)}', '${escapeHtml(h.client)}')">
                        <i class="lni lni-whatsapp"></i>
                    </button>` : ''}
                </div>
            </td>
        </tr>`;
    }).join('');
}

function renderPagination() {
    const pages = Math.ceil(totalRecords / LIMIT);
    const start = (currentPage - 1) * LIMIT + 1;
    const end   = Math.min(currentPage * LIMIT, totalRecords);

    document.getElementById('paginationInfo').textContent =
        totalRecords === 0 ? 'Sin resultados' : `${start}–${end} de ${totalRecords}`;

    // Prev
    const btnsPrev = document.getElementById('paginationBtnsPrev');
    btnsPrev.innerHTML = '';
    const prev = document.createElement('button');
    prev.className = 'page-btn';
    prev.innerHTML = '<i class="lni lni-chevron-left"></i>';
    prev.disabled  = currentPage <= 1;
    prev.onclick   = () => { currentPage--; loadHistorial(); };
    btnsPrev.appendChild(prev);

    // Next
    const btns = document.getElementById('paginationBtns');
    btns.innerHTML = '';
    const next = document.createElement('button');
    next.className = 'page-btn';
    next.innerHTML = '<i class="lni lni-chevron-right"></i>';
    next.disabled  = currentPage >= pages;
    next.onclick   = () => { currentPage++; loadHistorial(); };
    btns.appendChild(next);
}

function showSkeleton() {
    document.getElementById('historialBody').innerHTML = Array(8).fill(`
        <tr class="skeleton-row">
            ${Array(8).fill('<td><div style="height:14px;border-radius:6px;"></div></td>').join('')}
        </tr>`).join('');
}

function showError(msg) {
    document.getElementById('historialBody').innerHTML = `
        <tr><td colspan="8">
            <div class="empty-historial">
                <i class="lni lni-warning"></i>
                <h3>Error al cargar</h3>
                <p>${escapeHtml(msg)}</p>
                <button class="btn-primary" style="margin-top:1rem" onclick="loadHistorial()">
                    <i class="lni lni-reload"></i> Reintentar
                </button>
            </div>
        </td></tr>`;
}

// ═══════════════════════════════════════════════════
// PANEL LATERAL DEL CLIENTE
// ═══════════════════════════════════════════════════
async function openClientPanel(phone, name) {
    if (!phone) return;
    document.getElementById('clientPanelOverlay').classList.add('active');
    document.getElementById('clientPanelContent').innerHTML =
        '<div style="text-align:center;padding:2rem;color:#9ca3af;"><i class="lni lni-spinner lni-spin" style="font-size:1.5rem;"></i></div>';

    try {
        const r = await fetch(`/api/client-history/client/${encodeURIComponent(phone)}`, { credentials: 'include' });
        const d = await r.json();
        const entries  = d.historial || [];
        const initials = name.split(' ').map(p => p[0]||'').join('').slice(0,2).toUpperCase();

        const itemsHTML = entries.length === 0
            ? '<p style="color:#9ca3af;font-size:.87rem;">Sin registros anteriores</p>'
            : entries.map(e => `
                <div class="panel-timeline-item">
                    <div class="timeline-dot ${e.entryType}"></div>
                    <div class="timeline-content">
                        <div class="timeline-service">${escapeHtml(e.service || 'Servicio sin nombre')}</div>
                        <div class="timeline-meta">
                            ${formatDate(e.date)} · ${formatTime(e.time)}
                            ${e.worker    ? ` · ${escapeHtml(e.worker)}`              : ''}
                            ${e.agentName ? ` · <em>${escapeHtml(e.agentName)}</em>` : ''}
                        </div>
                    </div>
                </div>`).join('');

        document.getElementById('clientPanelContent').innerHTML = `
            <div class="panel-client-info">
                <div class="panel-avatar">${initials}</div>
                <div>
                    <div class="panel-client-name">${escapeHtml(name)}</div>
                    <div class="panel-client-phone">${escapeHtml(phone)}</div>
                </div>
            </div>
            <div style="display:flex;gap:.5rem;margin-bottom:1rem;">
                <span class="badge badge-visita">${entries.filter(e=>e.entryType==='visita').length} visitas</span>
                <span class="badge badge-cancelada">${entries.filter(e=>e.entryType==='cancelada').length} canceladas</span>
            </div>
            <div class="panel-section-title">Historial de Visitas</div>
            <div class="panel-timeline">${itemsHTML}</div>
            ${phone ? `
            <div style="margin-top:1.5rem;">
                <button class="btn-primary" style="width:100%" onclick="sendWhatsApp('${escapeHtml(phone)}','${escapeHtml(name)}')">
                    <i class="lni lni-whatsapp"></i> Contactar por WhatsApp
                </button>
            </div>` : ''}
        `;
    } catch(e) {
        document.getElementById('clientPanelContent').innerHTML =
            '<p style="color:#ef4444;padding:1rem;">Error cargando historial del cliente</p>';
    }
}

function closeClientPanel() {
    document.getElementById('clientPanelOverlay').classList.remove('active');
}

function closePanelIfOutside(e) {
    if (e.target === document.getElementById('clientPanelOverlay')) closeClientPanel();
}

// ═══════════════════════════════════════════════════
// FILTROS
// ═══════════════════════════════════════════════════
function setupFilters() {
    // Chips de tipo (Todos / Visitas / Canceladas)
    document.getElementById('typeFilters').addEventListener('click', e => {
        const chip = e.target.closest('.filter-chip');
        if (!chip) return;
        document.querySelectorAll('#typeFilters .filter-chip')
            .forEach(c => c.classList.remove('active','active-green','active-red'));
        chip.classList.add('active');
        filters.type = chip.dataset.type;
        currentPage  = 1;
        loadHistorial();
    });

    // Chips de rango (Todo / 7 días / Mes / Año)
    document.getElementById('rangeFilters').addEventListener('click', e => {
        const chip = e.target.closest('.filter-chip');
        if (!chip) return;
        document.querySelectorAll('#rangeFilters .filter-chip')
            .forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        filters.range = chip.dataset.range;
        currentPage   = 1;
        loadHistorial();
    });

    // Búsqueda con debounce
    let searchTimeout;
    document.getElementById('searchInput').addEventListener('input', e => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            filters.search = e.target.value.trim();
            currentPage    = 1;
            loadHistorial();
        }, 350);
    });

    // Dropdowns custom
    document.querySelectorAll('.custom-dropdown-wrapper').forEach(wrapper => {
        wrapper.addEventListener('click', function(e) {
            document.querySelectorAll('.custom-dropdown-wrapper.active').forEach(o => {
                if (o !== this) o.classList.remove('active');
            });
            this.classList.toggle('active');
            e.stopPropagation();
        });
    });

    document.addEventListener('click', () => {
        document.querySelectorAll('.custom-dropdown-wrapper.active')
            .forEach(d => d.classList.remove('active'));
    });
}

function selectAgentFilter(el, agentId) {
    document.getElementById('selectedAgent').innerText = el.querySelector('span').innerText;
    el.closest('.dropdown-options').querySelectorAll('.dropdown-option')
        .forEach(o => o.classList.remove('selected'));
    el.classList.add('selected');
    filters.agentId = String(agentId);
    currentPage     = 1;
    loadHistorial();
}

// ═══════════════════════════════════════════════════
// EXPORT PDF
// ═══════════════════════════════════════════════════
function exportPDF() {
    if (!historialData.length) {
        showNotification('No hay datos para exportar', 'warning');
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();

    // Encabezado
    doc.setFillColor(6, 182, 212);
    doc.rect(0, 0, pageW, 18, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.text(document.getElementById('pageTitle').textContent || 'Historial', 12, 12);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(
        `Generado: ${new Date().toLocaleDateString('es-MX', { day:'2-digit', month:'long', year:'numeric' })}`,
        pageW - 12, 12, { align: 'right' }
    );

    // Subtítulo
    doc.setTextColor(100, 116, 139);
    doc.setFontSize(8);
    doc.text(`Total de registros: ${totalRecords}`, 12, 24);

    // Tabla
    const columns = ['Cliente','Teléfono','Servicio','Trabajador','Fecha','Hora','Agente','Tipo','Origen'];
    const rows = historialData.map(h => [
        h.client    || '—', h.phone     || '—', h.service   || '—', h.worker    || '—',
        formatDate(h.date), formatTime(h.time), h.agentName || '—',
        h.entryType === 'visita' ? 'Visita' : h.entryType === 'cancelada' ? 'Cancelada' : 'Cita',
        h.source    === 'sheets' ? 'Sheets' : h.source    === 'agent'    ? 'Agente'    : 'Manual'
    ]);

    doc.autoTable({
        head: [columns],
        body: rows,
        startY: 28,
        styles: { fontSize: 8, cellPadding: 3, font: 'helvetica', textColor: [26,26,46], lineColor: [229,231,235], lineWidth: 0.3 },
        headStyles: { fillColor: [248,250,252], textColor: [107,114,128], fontStyle: 'bold', fontSize: 7.5 },
        alternateRowStyles: { fillColor: [249,250,251] },
        columnStyles: {
            0: { cellWidth: 38 }, 1: { cellWidth: 28 }, 2: { cellWidth: 38 },
            3: { cellWidth: 28 }, 4: { cellWidth: 26 }, 5: { cellWidth: 18 },
            6: { cellWidth: 28 }, 7: { cellWidth: 22 }, 8: { cellWidth: 18 }
        },
        didParseCell(data) {
            if (data.section === 'body' && data.column.index === 7) {
                const v = data.cell.raw;
                if (v === 'Visita')    data.cell.styles.textColor = [16, 185, 129];
                if (v === 'Cancelada') data.cell.styles.textColor = [239, 68, 68];
                if (v === 'Cita')      data.cell.styles.textColor = [6, 182, 212];
            }
        },
        didDrawPage(data) {
            const pageCount = doc.internal.getNumberOfPages();
            const current   = doc.internal.getCurrentPageInfo().pageNumber;
            doc.setFontSize(7);
            doc.setTextColor(156, 163, 175);
            doc.text(
                `Página ${current} de ${pageCount}  ·  Attomos`,
                pageW / 2, doc.internal.pageSize.getHeight() - 5, { align: 'center' }
            );
        }
    });

    doc.save(`historial_${new Date().toISOString().split('T')[0]}.pdf`);
    showNotification('PDF exportado exitosamente', 'success');
}

// ═══════════════════════════════════════════════════
// EXPORT CSV
// ═══════════════════════════════════════════════════
function exportCSV() {
    if (!historialData.length) {
        showNotification('No hay datos para exportar', 'warning');
        return;
    }
    const headers = ['Cliente','Teléfono','Servicio','Trabajador','Fecha','Hora','Agente','Tipo','Origen'];
    const rows = historialData.map(h => [
        h.client, h.phone, h.service, h.worker,
        h.date, h.time, h.agentName, h.entryType, h.source
    ].map(v => `"${(v||'').replace(/"/g,'""')}"`));

    const csv  = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `historial_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showNotification('CSV exportado exitosamente', 'success');
}

// ═══════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════
function formatDate(d) {
    if (!d) return '—';
    const [y, m, day] = d.split('-');
    const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    return `${parseInt(day)} ${months[parseInt(m)-1]} ${y}`;
}

function formatTime(t) {
    if (!t) return '';
    const [h, m] = t.split(':');
    const hh   = parseInt(h);
    const ampm = hh >= 12 ? 'PM' : 'AM';
    const h12  = hh > 12 ? hh - 12 : (hh === 0 ? 12 : hh);
    return `${h12}:${m} ${ampm}`;
}

function sendWhatsApp(phone, name) {
    const num = phone.replace(/\D/g, '');
    const msg = encodeURIComponent(`Hola ${name}, te contacto desde Attomos.`);
    window.open(`https://wa.me/${num}?text=${msg}`, '_blank');
}

function escapeHtml(t) {
    if (!t) return '';
    return String(t).replace(/[&<>"']/g, m =>
        ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}

function showNotification(message, type = 'info') {
    const titles = { success: 'Listo', error: 'Error', warning: 'Aviso', info: 'Info' };
    if (typeof Sileo !== 'undefined' && Sileo[type]) {
        Sileo[type]({ title: titles[type], description: message });
    } else {
        alert(message);
    }
}

// ═══════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
    await adaptPageTitle();
    await loadAgents();
    setupFilters();
    await loadHistorial();
});