/* ============================================================
   database-admin.js — Panel de empresas Attomos
   ============================================================ */

const ROWS_PER_PAGE = 15;

let allCompanies  = [];   // datos originales de la API
let filteredList  = [];   // después de búsqueda / filtros
let currentPage   = 1;

// ── Colores de avatar por inicial ───────────────────────────
const AVATAR_COLORS = [
    '#06b6d4','#6366f1','#f59e0b','#10b981',
    '#ef4444','#8b5cf6','#ec4899','#0ea5e9',
];
function avatarColor(name = '') {
    const i = (name.charCodeAt(0) || 0) % AVATAR_COLORS.length;
    return AVATAR_COLORS[i];
}

// ── Helpers de formato ───────────────────────────────────────
function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

function planBadge(plan) {
    const map = {
        gratuito: { label: 'Gratuito',  cls: 'gratuito' },
        proton:   { label: 'Protón',    cls: 'proton'   },
        neutron:  { label: 'Neutrón',   cls: 'neutron'  },
        electron: { label: 'Electrón',  cls: 'electron' },
    };
    const p = map[plan?.toLowerCase()] || { label: plan || '—', cls: 'gratuito' };
    return `<span class="plan-badge ${p.cls}">${p.label}</span>`;
}

function statusDot(status) {
    const map = {
        active:   'active',
        inactive: 'inactive',
        pending:  'pending',
    };
    const labels = { active: 'Activa', inactive: 'Inactiva', pending: 'Pendiente' };
    const cls = map[status] || 'inactive';
    return `<span class="status-dot ${cls}">${labels[cls] || '—'}</span>`;
}

function getTypeName(code) {
    const types = {
        'clinica-dental': 'Clínica Dental',
        'peluqueria':     'Peluquería / Salón',
        'restaurante':    'Restaurante',
        'pizzeria':       'Pizzería',
        'escuela':        'Escuela',
        'gym':            'Gimnasio',
        'spa':            'Spa / Wellness',
        'consultorio':    'Consultorio Médico',
        'veterinaria':    'Veterinaria',
        'hotel':          'Hotel',
        'tienda':         'Tienda / Retail',
        'agencia':        'Agencia',
        'otro':           'Otro',
    };
    return types[code] || code || '—';
}

// ── Carga inicial ────────────────────────────────────────────
async function loadCompanies() {
    try {
        const res  = await fetch('/admin/api/companies', { credentials: 'include' });
        if (res.status === 401) { window.location.href = '/admin/login'; return; }
        const data = await res.json();

        // Stats
        document.getElementById('statTotal').textContent  = data.stats?.total  ?? '—';
        document.getElementById('statActive').textContent = data.stats?.active ?? '—';
        document.getElementById('statPaid').textContent   = data.stats?.paid   ?? '—';
        document.getElementById('statNew').textContent    = data.stats?.new    ?? '—';

        allCompanies = data.companies || [];
        applyFilters();

    } catch (err) {
        console.error('Error cargando empresas:', err);
        document.getElementById('companiesBody').innerHTML = `
            <tr><td colspan="8">
                <div class="empty-state">
                    <i class="lni lni-warning"></i>
                    <p>Error al cargar datos. Intenta de nuevo.</p>
                </div>
            </td></tr>`;
    }
}

// ── Filtros y búsqueda ───────────────────────────────────────
function applyFilters() {
    const q    = (document.getElementById('searchInput')?.value  || '').toLowerCase();
    const plan = (document.getElementById('planFilter')?.value   || '');
    const size = (document.getElementById('sizeFilter')?.value   || '');

    filteredList = allCompanies.filter(c => {
        const matchQ = !q ||
            (c.businessName || '').toLowerCase().includes(q) ||
            (c.email        || '').toLowerCase().includes(q) ||
            (c.phoneNumber  || '').toLowerCase().includes(q) ||
            (c.city         || '').toLowerCase().includes(q);

        const matchPlan = !plan || (c.plan || '').toLowerCase() === plan;
        const matchSize = !size || (c.businessSize || '').toLowerCase() === size;

        return matchQ && matchPlan && matchSize;
    });

    currentPage = 1;
    renderTable();
}

// ── Render tabla ─────────────────────────────────────────────
function renderTable() {
    const tbody     = document.getElementById('companiesBody');
    const countEl   = document.getElementById('tableCount');
    const total     = filteredList.length;
    const totalPages = Math.max(1, Math.ceil(total / ROWS_PER_PAGE));
    currentPage     = Math.min(currentPage, totalPages);

    const start = (currentPage - 1) * ROWS_PER_PAGE;
    const slice = filteredList.slice(start, start + ROWS_PER_PAGE);

    countEl.textContent = `${total} empresa${total !== 1 ? 's' : ''}`;

    if (slice.length === 0) {
        tbody.innerHTML = `
            <tr><td colspan="8">
                <div class="empty-state">
                    <i class="lni lni-database"></i>
                    <p>No se encontraron empresas.</p>
                </div>
            </td></tr>`;
        renderPagination(total, totalPages);
        return;
    }

    tbody.innerHTML = slice.map(c => {
        const initials = (c.businessName || c.email || '?').charAt(0).toUpperCase();
        const color    = avatarColor(c.businessName || '');
        return `
        <tr>
            <td>
                <div class="company-cell">
                    <div class="company-avatar" style="background:${color};">${initials}</div>
                    <div>
                        <div class="company-name">${c.businessName || '—'}</div>
                        <div class="company-email">${c.email || '—'}</div>
                    </div>
                </div>
            </td>
            <td>${c.phoneNumber || '—'}</td>
            <td>${getTypeName(c.businessType)}</td>
            <td>${c.businessSize || '—'}</td>
            <td>${planBadge(c.plan)}</td>
            <td>${statusDot(c.status)}</td>
            <td>${formatDate(c.createdAt)}</td>
            <td>
                <button class="action-btn" title="Ver detalle" onclick="openModal(${JSON.stringify(c).replace(/"/g, '&quot;')})">
                    <i class="lni lni-eye"></i>
                </button>
            </td>
        </tr>`;
    }).join('');

    renderPagination(total, totalPages);
}

// ── Paginación ───────────────────────────────────────────────
function renderPagination(total, totalPages) {
    const infoEl   = document.getElementById('pageInfo');
    const btnsEl   = document.getElementById('pageBtns');
    const start    = (currentPage - 1) * ROWS_PER_PAGE + 1;
    const end      = Math.min(currentPage * ROWS_PER_PAGE, total);

    infoEl.textContent = total > 0 ? `${start}–${end} de ${total}` : '0 resultados';

    if (totalPages <= 1) { btnsEl.innerHTML = ''; return; }

    // Mostrar máximo 5 páginas centradas
    let pages = [];
    const delta = 2;
    for (let i = Math.max(1, currentPage - delta); i <= Math.min(totalPages, currentPage + delta); i++) {
        pages.push(i);
    }

    let html = '';
    if (currentPage > 1) {
        html += `<button class="page-btn" onclick="goPage(${currentPage - 1})"><i class="lni lni-chevron-left"></i></button>`;
    }
    pages.forEach(p => {
        html += `<button class="page-btn ${p === currentPage ? 'active' : ''}" onclick="goPage(${p})">${p}</button>`;
    });
    if (currentPage < totalPages) {
        html += `<button class="page-btn" onclick="goPage(${currentPage + 1})"><i class="lni lni-chevron-right"></i></button>`;
    }

    btnsEl.innerHTML = html;
}

function goPage(p) {
    currentPage = p;
    renderTable();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Modal detalle ────────────────────────────────────────────
function openModal(company) {
    document.getElementById('modalCompany').textContent = company.businessName || '—';
    document.getElementById('modalEmail').textContent   = company.email        || '—';
    document.getElementById('modalPlan').innerHTML      = planBadge(company.plan);
    document.getElementById('modalSize').textContent    = company.businessSize  || '—';
    document.getElementById('modalPhone').textContent   = company.phoneNumber   || '—';
    document.getElementById('modalType').textContent    = getTypeName(company.businessType);
    document.getElementById('modalDate').textContent    = formatDate(company.createdAt);
    document.getElementById('modalId').textContent      = company.id            || '—';

    document.getElementById('detailModal').classList.add('open');
}

function closeModal() {
    document.getElementById('detailModal').classList.remove('open');
}

// Cerrar modal al hacer clic en backdrop
document.getElementById('detailModal')?.addEventListener('click', function(e) {
    if (e.target === this) closeModal();
});

// ── Listeners de filtros ─────────────────────────────────────
document.getElementById('searchInput')?.addEventListener('input',  applyFilters);
document.getElementById('planFilter')?.addEventListener('change',  applyFilters);
document.getElementById('sizeFilter')?.addEventListener('change',  applyFilters);

// ── Init ─────────────────────────────────────────────────────
loadCompanies();