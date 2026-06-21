// Helper: detectar si el usuario está en plan gratuito
function isFreePlan() {
    const plan = document.querySelector('.app-container')?.dataset?.plan || '';
    return plan === 'gratuito' || plan === 'free' || plan === '';
}

// Dashboard functionality (sin sección de agentes)
let costChart = null;
let mostRequestedPieChart = null;
let leastRequestedPieChart = null;
let servicesData = null;

// Cache de onboarding para acelerar recargas
let onboardingHTMLCache = null;
let onboardingScriptLoaded = false;

// Estado base del onboarding (mismo shape que en onboarding.js)
const defaultAgentData = () => ({
    social: '',
    branchId: 0,
    businessType: '',
    name: '',
    phoneNumber: '',
    useDifferentPhone: false,
    config: {
        tone: 'formal',
        customTone: '',
        languages: [],
        additionalLanguages: [],
        specialInstructions: '',
        schedule: {
            monday:    { open: true,  start: '09:00', end: '18:00' },
            tuesday:   { open: true,  start: '09:00', end: '18:00' },
            wednesday: { open: true,  start: '09:00', end: '18:00' },
            thursday:  { open: true,  start: '09:00', end: '18:00' },
            friday:    { open: true,  start: '09:00', end: '18:00' },
            saturday:  { open: false, start: '09:00', end: '14:00' },
            sunday:    { open: false, start: '09:00', end: '14:00' }
        }
    }
});

// Currency conversion rates (relative to USD)
const currencyRates = {
    MXN: 17.50,
    USD: 1.00,
    EUR: 0.92,
    GBP: 0.79,
    CAD: 1.36,
    ARS: 350.0,
    COP: 4000.0,
    CLP: 900.0
};
function getCurrencySymbol(currency) {
    const symbols = { MXN: '$', USD: '$', EUR: '€', GBP: '£', CAD: 'C$', ARS: 'AR$', COP: 'COL$', CLP: 'CLP$' };
    return symbols[currency] || '$';
}
function convertCurrency(amountUSD, toCurrency) {
    return amountUSD * (currencyRates[toCurrency] || 1);
}

// View states
let billingView = 'line'; // 'line', 'bar', 'table'
let billingTimelineData = null; // cached timeline for view switching

// =================== VIEW TOGGLE FUNCTIONS ===================

function setBillingView(view) {
    billingView = view;

    // Update toggle button states
    document.querySelectorAll('#billingViewToggle .view-toggle-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === view);
    });

    const chartContainer = document.getElementById('costChartContainer');
    const tableContainer = document.getElementById('costTableContainer');

    if (view === 'table') {
        chartContainer.style.display = 'none';
        tableContainer.style.display = 'block';
        if (billingTimelineData) renderBillingTable(billingTimelineData);
    } else {
        chartContainer.style.display = 'block';
        tableContainer.style.display = 'none';
        if (costChart) {
            costChart.config.type = view === 'bar' ? 'bar' : 'line';
            if (view === 'bar') {
                costChart.data.datasets[0].fill = false;
                costChart.data.datasets[0].tension = 0;
                costChart.data.datasets[0].backgroundColor = 'rgba(6, 182, 212, 0.7)';
                costChart.data.datasets[0].borderColor = '#06b6d4';
                costChart.data.datasets[0].borderWidth = 1;
                costChart.data.datasets[0].pointRadius = 0;
            } else {
                costChart.data.datasets[0].fill = true;
                costChart.data.datasets[0].tension = 0.4;
                costChart.data.datasets[0].backgroundColor = 'rgba(6, 182, 212, 0.1)';
                costChart.data.datasets[0].borderColor = '#06b6d4';
                costChart.data.datasets[0].borderWidth = 3;
                costChart.data.datasets[0].pointRadius = 4;
            }
            costChart.update();
        }
    }
}

function renderBillingTable(timeline) {
    const container = document.getElementById('costTableContainer');
    if (!container || !timeline) return;

    const currency = document.getElementById('currencySelect')?.value || 'MXN';
    const symbol = getCurrencySymbol(currency);

    let prevCost = 0;
    const rows = timeline.labels.map((label, i) => {
        const cumulative = convertCurrency(timeline.costs[i], currency);
        const daily = i === 0 ? cumulative : cumulative - convertCurrency(timeline.costs[i - 1], currency);
        return { label, cumulative, daily };
    });

    container.innerHTML = `
        <div class="data-table-wrapper">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Fecha</th>
                        <th>Costo Diario</th>
                        <th>Costo Acumulado</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map(row => `
                        <tr>
                            <td>${row.label}</td>
                            <td class="cost-cell">${symbol}${row.daily.toFixed(4)} ${currency}</td>
                            <td class="cost-cell-accent">${symbol}${row.cumulative.toFixed(4)} ${currency}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function setUnifiedView(section, view) {
    const barsViewId   = section === 'most' ? 'mostBarsView'  : 'leastBarsView';
    const pieViewId    = section === 'most' ? 'mostPieView'   : 'leastPieView';
    const tableViewId  = section === 'most' ? 'mostTableView' : 'leastTableView';
    const data         = section === 'most' ? servicesData?.mostRequested : servicesData?.leastRequested;
    const isLeast      = section === 'least';

    // Update toggle buttons
    document.querySelectorAll(`[data-section="${section}"].view-toggle-btn`).forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === view);
    });

    // Hide all panels
    [barsViewId, pieViewId, tableViewId].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    if (view === 'bars') {
        const panel = document.getElementById(barsViewId);
        if (panel) panel.style.display = '';
        const containerId = section === 'most' ? 'mostRequestedServicesContainer' : 'leastRequestedServicesContainer';
        renderServiceBars(containerId, data, isLeast);

    } else if (view === 'pie') {
        const panel = document.getElementById(pieViewId);
        if (panel) panel.style.display = '';
        const canvasId = section === 'most' ? 'mostRequestedPieChart' : 'leastRequestedPieChart';
        const legendId = section === 'most' ? 'mostRequestedLegend'   : 'leastRequestedLegend';
        const totalId  = section === 'most' ? 'mostRequestedTotal'     : 'leastRequestedTotal';
        renderPieChart(canvasId, legendId, totalId, data, isLeast);

    } else if (view === 'table') {
        const panel = document.getElementById(tableViewId);
        if (panel) {
            panel.style.display = '';
            renderServiceTable(panel, data, isLeast);
        }
    }
}


function renderServiceTable(container, services, isLeast = false) {
    if (!services || services.length === 0) {
        container.innerHTML = `<div class="service-chart-empty"><i class="lni lni-pie-chart"></i><p>No hay datos disponibles</p></div>`;
        return;
    }
    const total = services.reduce((sum, s) => sum + s.count, 0);
    const accentClass = isLeast ? 'purple' : 'cyan';
    container.innerHTML = `
        <div class="data-table-wrapper">
            <table class="data-table service-data-table">
                <thead>
                    <tr>
                        <th>#</th>
                        <th>Servicio</th>
                        <th>Solicitudes</th>
                        <th>Porcentaje</th>
                    </tr>
                </thead>
                <tbody>
                    ${services.map((s, i) => {
                        const pct = ((s.count / total) * 100).toFixed(1);
                        return `
                        <tr>
                            <td class="rank-cell">${i + 1}</td>
                            <td>${s.name}</td>
                            <td class="count-cell ${accentClass}">${s.count}</td>
                            <td>
                                <div class="pct-bar-mini">
                                    <div class="pct-bar-fill-mini ${accentClass}" style="width:${pct}%"></div>
                                    <span>${pct}%</span>
                                </div>
                            </td>
                        </tr>`;
                    }).join('')}
                </tbody>
                <tfoot>
                    <tr><td colspan="2"><strong>Total</strong></td><td class="count-cell ${accentClass}"><strong>${total}</strong></td><td></td></tr>
                </tfoot>
            </table>
        </div>
    `;
}



// ================== Estadísticas de Agentes ==================
async function loadAgentStats() {
    try {
        const response = await fetch('/api/agents', { credentials: 'include' });
        if (!response.ok) throw new Error('Error al obtener agentes');
        const data = await response.json();

        const agents = Array.isArray(data.agents) ? data.agents : [];

        // Un agente está activo si isActive=true Y deployStatus='running'
        // (misma lógica que my-agents.js línea 416)
        const activeCount = agents.filter(a => a.isActive && a.deployStatus === 'running').length;

        const activeEl = document.getElementById('activeAgentsCount');
        if (activeEl) activeEl.textContent = activeCount;

    } catch (err) {
        console.warn('loadAgentStats:', err.message);
    }
}

// ── Citas vs Pedidos (misma lógica que sidebar.js) ─────────────────
const DASHBOARD_GIROS_COMIDA = ['pizzeria','pizza','mariscos','gorditas','restaurante',
                                 'taqueria','tacos','hamburguesas','sushi','comida'];

async function applyFoodLogic() {
    try {
        // Paso 1: /api/me (igual que sidebar)
        const meResp = await fetch('/api/me', { credentials: 'include' });
        if (!meResp.ok) return;
        const meData    = await meResp.json();
        let bizType     = (meData.user?.businessType || '').toLowerCase();
        console.log('🍕 [dashboard] businessType desde /api/me:', bizType);

        // Paso 2: /api/my-business tiene prioridad (igual que sidebar)
        try {
            const bizResp = await fetch('/api/my-business', { credentials: 'include' });
            if (bizResp.ok) {
                const bizData  = await bizResp.json();
                const branch   = bizData.activeBranch || bizData.defaultBranch;
                const branchType = (branch?.business?.type || branch?.business?.typeName || branch?.businessType || '').toLowerCase();
                if (branchType) { bizType = branchType; console.log('🍕 [dashboard] businessType desde /api/my-business:', bizType); }
            }
        } catch (_) {}

        // Pasar bizType a agentData para que el modal de onboarding use los labels correctos
        if (bizType) {
            window._dashboardBizType = bizType;
            if (window.agentData) window.agentData.businessType = bizType;
        }

        const isFood   = DASHBOARD_GIROS_COMIDA.some(g => bizType.includes(g));
        const labelEl  = document.getElementById('statThirdLabel');
        const iconEl   = document.getElementById('statThirdIcon');
        const sectionTitle   = document.getElementById('sectionServicesTitle');
        const mostTitle      = document.getElementById('mostRequestedTitle');
        const leastTitle     = document.getElementById('leastRequestedTitle');

        if (isFood) {
            if (labelEl)      labelEl.textContent = 'Pedidos Hoy';
            if (iconEl)       iconEl.className    = 'lni lni-cart';
            if (sectionTitle) sectionTitle.textContent = 'Estadísticas de Productos';
            if (mostTitle)    mostTitle.textContent    = 'Productos Más Pedidos';
            if (leastTitle)   leastTitle.textContent   = 'Productos Menos Pedidos';
        } else {
            if (labelEl)      labelEl.textContent = 'Citas Agendadas';
            if (iconEl)       iconEl.className    = 'lni lni-calendar';
            if (sectionTitle) sectionTitle.textContent = 'Estadísticas de Servicios';
            if (mostTitle)    mostTitle.textContent    = 'Servicios Más Pedidos';
            if (leastTitle)   leastTitle.textContent   = 'Servicios Menos Pedidos';
        }
        console.log('✅ [dashboard] applyFoodLogic — isFood:', isFood, '— bizType:', bizType);
    } catch (err) {
        console.warn('applyFoodLogic error:', err.message);
    }
}

document.addEventListener('DOMContentLoaded', function () {
    console.log('dashboard.js listo');
    loadAgentStats();
    applyFoodLogic();
    if (!isFreePlan()) {
        initializeCostChart();
        loadBillingData();
    }
    loadServicesStatistics();
    initializeCreateAgentButton();
    checkBusinessInfoOnLoad();

    const timeRangeSelect = document.getElementById('billingTimeRange');
    if (timeRangeSelect) {
        timeRangeSelect.addEventListener('change', function () {
            loadBillingData(this.value);
        });
    }

    const currencySelect = document.getElementById('currencySelect');
    if (currencySelect) {
        currencySelect.addEventListener('change', function () {
            const days = document.getElementById('billingTimeRange')?.value || 28;
            loadBillingData(days);
        });
    }
});

// ================== Onboarding en modal (Dashboard) ==================
function initializeCreateAgentButton() {
    const createBtn = document.getElementById('createAgentBtnDashboard');
    if (createBtn) {
        console.log('Botón Crear Agente encontrado');
    } else {
        console.warn('⚠️ No se encontró el botón Crear Agente');
    }
}

// Verificar negocio antes de crear agente
async function checkBusinessBeforeAgent() {
    try {
        const response = await fetch('/api/my-business');
        if (response.ok) {
            const data = await response.json();
            // El endpoint devuelve { activeBranch: { business: { name, type } } }
            // o { branches: [], defaultBranch: {...} } cuando no hay sucursales guardadas
            const branch = data.activeBranch || data.defaultBranch;
            const hasBusinessInfo =
                branch &&
                branch.business &&
                branch.business.name &&
                branch.business.name.trim() !== '' &&
                branch.business.type &&
                branch.business.type.trim() !== '';

            if (hasBusinessInfo) {
                openOnboardingModal();
            } else {
                showBusinessWarningModal();
            }
        } else {
            showBusinessWarningModal();
        }
    } catch (error) {
        console.warn('No se pudo verificar el perfil del negocio:', error);
        showBusinessWarningModal();
    }
}

function showBusinessWarningModal() {
    const existing = document.getElementById('businessWarningModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'businessWarningModal';
    modal.style.cssText = [
        'position:fixed', 'inset:0', 'z-index:20000',
        'display:flex', 'align-items:center', 'justify-content:center',
        'background:rgba(0,0,0,0.45)', 'backdrop-filter:blur(4px)',
        'animation:bwFadeIn 0.2s ease'
    ].join(';');

    modal.innerHTML = `
        <style>
            @keyframes bwFadeIn { from { opacity:0; } to { opacity:1; } }
            @keyframes bwSlideUp {
                from { opacity:0; transform:translateY(28px) scale(0.97); }
                to   { opacity:1; transform:translateY(0) scale(1); }
            }
            #bwBox { animation: bwSlideUp 0.3s cubic-bezier(0.23,1,0.32,1); }
            #bwCancelBtn:hover { background:#e5e7eb !important; }
            #bwGoBtn:hover { transform:translateY(-2px) !important; box-shadow:0 8px 20px rgba(6,182,212,0.4) !important; }
            #bwCloseBtn { transition: all 0.3s cubic-bezier(0.34,1.56,0.64,1) !important; }
            #bwCloseBtn:hover { background:#fee2e2 !important; color:#ef4444 !important; transform:rotate(90deg) scale(1.1) !important; box-shadow:0 4px 12px rgba(239,68,68,0.2) !important; }
            #bwCloseBtn i { transition: transform 0.3s ease; }
            #bwCloseBtn:hover i { transform: scale(1.2); }
        </style>
        <div id="bwBox" style="
            background:white; border-radius:20px; padding:2.5rem;
            max-width:460px; width:90%; box-shadow:0 20px 60px rgba(0,0,0,0.2);
            text-align:center; position:relative;
        ">
            <button id="bwCloseBtn" style="
                position:absolute; top:1rem; right:1rem;
                background:#f3f4f6; border:none; border-radius:50%;
                width:44px; height:44px; cursor:pointer;
                display:flex; align-items:center; justify-content:center;
                font-size:1.25rem; color:#6b7280;
            "><i class="lni lni-close"></i></button>

            <div style="
                width:72px; height:72px;
                background:linear-gradient(135deg,#fef3c7,#fde68a);
                border-radius:50%; display:flex; align-items:center;
                justify-content:center; margin:0 auto 1.5rem; font-size:2rem;
            "><i class="lni lni-warning" style="color:#f59e0b;"></i></div>

            <h3 style="font-size:1.4rem; font-weight:800; color:#1a1a1a; margin-bottom:0.75rem;">
                Completa tu perfil de negocio
            </h3>
            <p style="color:#6b7280; font-size:0.95rem; line-height:1.6; margin-bottom:2rem;">
                Antes de crear un agente necesitas configurar la información
                de tu negocio. Esto permite que el agente conozca tu empresa
                y responda correctamente a tus clientes.
            </p>

            <div style="display:flex; gap:0.75rem; justify-content:center;">
                <button id="bwCancelBtn" style="
                    padding:0.75rem 1.5rem; background:#f3f4f6; border:none;
                    border-radius:10px; font-weight:600; color:#6b7280;
                    cursor:pointer; font-size:0.95rem; transition:background 0.2s;
                ">Cancelar</button>
                <a href="/my-business" id="bwGoBtn" style="
                    padding:0.75rem 1.5rem; background:#06b6d4; border:none;
                    border-radius:10px; font-weight:600; color:white;
                    cursor:pointer; font-size:0.95rem; text-decoration:none;
                    display:inline-flex; align-items:center; gap:0.5rem;
                    box-shadow:0 4px 12px rgba(6,182,212,0.3);
                    transition:all 0.2s;
                "><i class="lni lni-pencil-alt"></i> Ir a Mi Negocio</a>
            </div>
        </div>
    `;

    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);
    document.getElementById('bwCloseBtn').addEventListener('click', () => modal.remove());
    document.getElementById('bwCancelBtn').addEventListener('click', () => modal.remove());
}
window.showBusinessWarningModal = showBusinessWarningModal;

// Verificar info del negocio al cargar el dashboard — si está vacía, mostrar popup obligatorio
async function checkBusinessInfoOnLoad() {
    try {
        const response = await fetch('/api/my-business');
        if (!response.ok) return;
        const data = await response.json();

        const branch = data.activeBranch || data.defaultBranch;
        const hasBusinessInfo =
            branch &&
            branch.business &&
            branch.business.name &&
            branch.business.name.trim() !== '' &&
            branch.business.type &&
            branch.business.type.trim() !== '';

        console.log('[BusinessCheck] hasBusinessInfo:', hasBusinessInfo, '| branch:', branch?.business);

        if (!hasBusinessInfo) {
            showBusinessRequiredModal();
        }
    } catch (e) {
        console.warn('No se pudo verificar info del negocio:', e);
    }
}

// Modal obligatorio — NO se puede cerrar con Cancelar ni haciendo click fuera
function showBusinessRequiredModal() {
    const existing = document.getElementById('businessRequiredModal');
    if (existing) return;

    const modal = document.createElement('div');
    modal.id = 'businessRequiredModal';
    modal.style.cssText = [
        'position:fixed', 'inset:0', 'z-index:20001',
        'display:flex', 'align-items:center', 'justify-content:center',
        'background:rgba(0,0,0,0.6)', 'backdrop-filter:blur(6px)',
        'animation:bwFadeIn 0.25s ease'
    ].join(';');

    modal.innerHTML = `
        <div id="brqBox" style="
            background:white; border-radius:24px; padding:2.5rem;
            max-width:480px; width:92%; box-shadow:0 24px 64px rgba(0,0,0,0.25);
            text-align:center; position:relative;
            animation:bwSlideUp 0.35s cubic-bezier(0.23,1,0.32,1);
        ">
            <div style="
                width:80px; height:80px;
                background:linear-gradient(135deg,#e0f2fe,#bae6fd);
                border-radius:50%; display:flex; align-items:center;
                justify-content:center; margin:0 auto 1.5rem; font-size:2.2rem;
            "><i class="lni lni-briefcase" style="color:#0284c7;"></i></div>

            <h3 style="font-size:1.5rem; font-weight:800; color:#1a1a1a; margin-bottom:0.75rem;">
                ¡Configura tu negocio primero!
            </h3>
            <p style="color:#6b7280; font-size:0.95rem; line-height:1.65; margin-bottom:0.75rem;">
                Para usar Attomos necesitas completar la información básica de tu negocio —
                nombre y giro. Esto le permite a tu agente conocer tu empresa y responder
                correctamente a tus clientes.
            </p>
            <p style="color:#9ca3af; font-size:0.82rem; margin-bottom:2rem;">
                Solo te toma 2 minutos ⚡
            </p>

            <div style="display:flex; flex-direction:column; gap:0.75rem;">
                <a href="/my-business" style="
                    padding:0.9rem 2rem; background:linear-gradient(135deg,#06b6d4,#0284c7);
                    border-radius:12px; font-weight:700; color:white;
                    text-decoration:none; display:flex; align-items:center;
                    justify-content:center; gap:0.6rem; font-size:1rem;
                    box-shadow:0 4px 16px rgba(6,182,212,0.35);
                    transition:all 0.2s;
                    " onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 8px 24px rgba(6,182,212,0.45)'"
                       onmouseout="this.style.transform='';this.style.boxShadow='0 4px 16px rgba(6,182,212,0.35)'">
                    <i class="lni lni-pencil-alt"></i>
                    Completar información del negocio
                </a>
                <button onclick="document.getElementById('businessRequiredModal').style.display='none'" style="
                    padding:0.75rem; background:transparent; border:none;
                    color:#9ca3af; font-size:0.85rem; cursor:pointer;
                    transition:color 0.2s;
                " onmouseover="this.style.color='#6b7280'" onmouseout="this.style.color='#9ca3af'">
                    Recordármelo después
                </button>
            </div>
        </div>
    `;

    // NO cierra al hacer click en el overlay — es intencional
    document.body.appendChild(modal);
}
window.showBusinessRequiredModal = showBusinessRequiredModal;

// Abrir modal
function openOnboardingModal() {
    let modal = document.getElementById('onboardingModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'onboardingModal';
        modal.className = 'onboarding-modal';
        modal.innerHTML = `
      <div class="onboarding-overlay" onclick="closeOnboardingModal()"></div>
      <div class="onboarding-modal-content">
        <div class="onboarding-modal-header">
          <h2 class="onboarding-modal-title">
            <i class="lni lni-rocket"></i>
            Crear Nuevo Agente
          </h2>
          <button class="btn-close-onboarding" onclick="closeOnboardingModal()">
            <i class="lni lni-close"></i>
          </button>
        </div>
        <div class="onboarding-modal-body" id="onboardingModalBody">
          <div style="display: flex; justify-content: center; align-items: center; padding: 3rem;">
            <div class="loading-spinner"></div>
            <div class="loading-text" style="margin-left: 1rem;">Cargando formulario...</div>
          </div>
        </div>
      </div>
    `;
        document.body.appendChild(modal);
    }

    modal.classList.add('active');
    loadOnboardingContent();
}

// Cerrar modal
function closeOnboardingModal() {
    const modal = document.getElementById('onboardingModal');
    if (modal) {
        modal.classList.remove('active');
    }
}
window.closeOnboardingModal = closeOnboardingModal;

// Cargar contenido (cacheado) y reinit
async function loadOnboardingContent() {
    const modalBody = document.getElementById('onboardingModalBody');
    if (!modalBody) return;

    try {
        let html;
        if (onboardingHTMLCache) {
            html = onboardingHTMLCache;
        } else {
            const response = await fetch('/onboarding');
            if (!response.ok) throw new Error('Error al cargar onboarding');
            html = await response.text();
            onboardingHTMLCache = html;
        }

        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const mainContainer = doc.querySelector('.main-container');

        if (mainContainer) {
            modalBody.innerHTML = mainContainer.innerHTML;

            if (!document.getElementById('onboarding-css')) {
                const link = document.createElement('link');
                link.id = 'onboarding-css'; link.rel = 'stylesheet';
                link.href = '/static/css/onboarding.css';
                document.head.appendChild(link);
            }
            // Restaurar estilos del layout de dashboard que onboarding.css sobreescribe
            // (onboarding.css define .app-container, .main-content, .content-wrapper
            //  con valores genéricos que remueven el padding-left del sidebar)
            if (!document.getElementById('dashboard-layout-restore')) {
                const restore = document.createElement('style');
                restore.id = 'dashboard-layout-restore';
                restore.textContent = `
                    @media (min-width: 769px) {
                        .app-container  { display: flex !important; height: 100vh !important; overflow: hidden !important; }
                        .main-content   { flex: 1 !important; display: flex !important; flex-direction: column !important; overflow: hidden !important; }
                        .content-wrapper { flex: 1 !important; overflow-y: auto !important; padding: 2rem !important; padding-top: 100px !important; padding-left: calc(2rem + 96px) !important; }
                    }
                `;
                document.head.appendChild(restore);
            }
            if (!document.getElementById('onboarding-inline-styles')) {
                const headStyles = doc.querySelectorAll('head style');
                if (headStyles.length > 0) {
                    const combined = document.createElement('style');
                    combined.id = 'onboarding-inline-styles';
                    headStyles.forEach(s => { combined.textContent += s.textContent; });
                    document.head.appendChild(combined);
                }
            }
            // Fix hover en tab completada: evitar que el hover cyan
            // sobreescriba el verde de .completed
            if (!document.getElementById('onboarding-modal-fixes')) {
                const fix = document.createElement('style');
                fix.id = 'onboarding-modal-fixes';
                fix.textContent = `
                    /* Tab completed hover */
                    .section-nav-btn.completed:hover {
                        background: #d1fae5 !important; color: #10b981 !important;
                        border-color: #10b981 !important;
                        box-shadow: 0 4px 12px rgba(16,185,129,0.2) !important;
                    }
                    .section-nav-btn.completed:hover i { color: #10b981 !important; }

                    /* Ocultar barra de progreso (no necesaria en modal) */
                    #onboardingModalBody .progress-wrapper,
                    #onboardingModalBody .steps-progress,
                    #onboardingModalBody .step-indicators,
                    #onboardingModalBody #progressPercentage,
                    #onboardingModalBody .progress-header,
                    #onboardingModalBody .progress-dots { display: none !important; }

                    /* ── Corregir header del modal ── */
                    /* El onboarding.css puede pisar el header — forzar layout correcto */
                    .onboarding-modal-header {
                        display: flex !important;
                        align-items: center !important;
                        justify-content: space-between !important;
                        padding: 1rem 1.5rem !important;
                        border-bottom: 1px solid #eef2f7 !important;
                        position: sticky !important;
                        top: 0 !important;
                        background: white !important;
                        z-index: 10 !important;
                        flex-direction: row !important;
                    }
                    .onboarding-modal-title {
                        display: inline-flex !important;
                        align-items: center !important;
                        gap: 0.6rem !important;
                        font-weight: 800 !important;
                        font-size: 1.1rem !important;
                        color: #0f172a !important;
                        margin: 0 !important;
                        flex: 1 !important;
                    }
                    .btn-close-onboarding {
                        width: 40px !important; height: 40px !important;
                        border-radius: 50% !important; border: none !important;
                        background: #f3f4f6 !important; color: #6b7280 !important;
                        cursor: pointer !important;
                        display: inline-flex !important;
                        align-items: center !important; justify-content: center !important;
                        font-size: 1.1rem !important;
                        flex-shrink: 0 !important;
                        transition: all 0.2s !important;
                    }
                    .btn-close-onboarding:hover {
                        background: #fee2e2 !important; color: #ef4444 !important;
                    }
                    /* Quitar padding extra que agrega el onboarding dentro del modal */
                    #onboardingModalBody .main-container,
                    #onboardingModalBody .onboarding-container {
                        padding-top: 0 !important;
                        margin-top: 0 !important;
                    }
                    #onboardingModalBody .step2-header,
                    #onboardingModalBody .step-header {
                        padding-top: 1rem !important;
                    }
                `;
                document.head.appendChild(fix);
            }

            if (!onboardingScriptLoaded) {
                const script = document.createElement('script');
                script.src = '/static/js/onboarding.js';
                script.onload = () => {
                    onboardingScriptLoaded = true;
                    setTimeout(() => reinitializeOnboardingEvents(), 50);
                };
                document.body.appendChild(script);
            } else {
                setTimeout(() => reinitializeOnboardingEvents(), 20);
            }
        } else {
            modalBody.innerHTML = `
        <div style="text-align: center; padding: 2rem;">
          <i class="lni lni-warning" style="font-size: 3rem; color: #ef4444;"></i>
          <h3 style="margin: 1rem 0; color: #1a1a1a;">No se pudo cargar el formulario</h3>
          <p style="color: #6b7280; margin-bottom: 1.5rem;">Intenta nuevamente</p>
          <button class="btn-primary" onclick="loadOnboardingContent()">
            <i class="lni lni-reload"></i>
            <span>Reintentar</span>
          </button>
        </div>
      `;
        }
    } catch (error) {
        console.error('❌ Error cargando onboarding:', error);
        modalBody.innerHTML = `
      <div style="text-align: center; padding: 3rem;">
        <i class="lni lni-warning" style="font-size: 3rem; color: #ef4444;"></i>
        <h3 style="margin: 1rem 0; color: #1a1a1a;">Error al cargar el formulario</h3>
        <p style="color: #6b7280; margin-bottom: 1.5rem;">Por favor, intenta de nuevo</p>
        <button class="btn-primary" onclick="loadOnboardingContent()">
          <i class="lni lni-reload"></i>
          <span>Reintentar</span>
        </button>
      </div>
    `;
    }
}

// Reinicializar usando el onboarding original
async function reinitializeOnboardingEvents() {
    console.log('🔄 Reinicializando modal del agente (dashboard)');

    if (typeof window.agentData !== 'undefined') window.agentData = defaultAgentData();
    if (typeof window.currentSection !== 'undefined') window.currentSection = 1;

    // ── Tamaño del modal ──────────────────────────────────────────────
    const modal = document.getElementById('onboardingModal');
    const modalContent = modal?.querySelector('.onboarding-modal-content');
    if (modalContent) {
        modalContent.style.maxWidth = '1100px';
        modalContent.style.width = '95vw';
        modalContent.style.maxHeight = '90vh';
        modalContent.style.overflow = 'hidden';
    }
    const modalBody = document.getElementById('onboardingModalBody');
    if (modalBody) {
        modalBody.style.maxHeight = '82vh';
        modalBody.style.overflowY = 'auto';
        modalBody.scrollTop = 0;
    }

    // ── Mostrar step1 (Red Social) primero ──────────────────────────
    document.querySelectorAll('.step').forEach(s => { s.classList.remove('active'); s.style.display = 'none'; });
    const step1 = document.getElementById('step1');
    const step2 = document.getElementById('step2');
    if (step1) { step1.classList.add('active'); step1.style.display = ''; }
    if (step2) { step2.classList.remove('active'); step2.style.display = 'none'; }
    // Ocultar sectionNav hasta que el usuario complete step1
    const sectionNavEl = document.getElementById('sectionNavigation');
    if (sectionNavEl) sectionNavEl.style.display = 'none';

    // ── Detectar si ya existe al menos un agente ─────────────────────
    let _hasExistingAgents = false;
    let _isGovModal = false;
    try {
        const _agentsResp = await fetch('/api/agents', { credentials: 'include' });
        if (_agentsResp.ok) {
            const _agentsData = await _agentsResp.json();
            _hasExistingAgents = Array.isArray(_agentsData.agents) && _agentsData.agents.length > 0;
            window._onboardingReadonly = false;
        }
    } catch (_) {}

    // Detectar modo gobierno
    try {
        const _meCheck = await fetch('/api/me', { credentials: 'include' });
        if (_meCheck.ok) {
            const _meData = await _meCheck.json();
            _isGovModal = (_meData.user?.businessType || '').toLowerCase().includes('gubernamental') ||
                          !!_meData.user?.isGovernment ||
                          _meData.user?.userType === 'government';
        }
    } catch (_) {}

    // ── Secciones del agente ──────────────────────────────────────────
    const AGENT_SECTIONS = _isGovModal
        ? (_hasExistingAgents
            ? [
                { id: 2, containerId: 'section-basic',       name: 'Info. Básica',  icon: 'lni-information' },
                { id: 5, containerId: 'section-personality', name: 'Personalidad',  icon: 'lni-comments' },
              ]
            : [
                { id: 1, containerId: 'section-business',    name: 'Dependencia',    icon: 'lni-government' },
                { id: 2, containerId: 'section-basic',       name: 'Info. Básica',   icon: 'lni-information' },
                { id: 3, containerId: 'section-location',    name: 'Ubicación',      icon: 'lni-map-marker' },
                { id: 4, containerId: 'section-social',      name: 'Redes Sociales', icon: 'lni-share-alt' },
                { id: 5, containerId: 'section-personality', name: 'Personalidad',   icon: 'lni-comments' },
                { id: 6, containerId: 'section-schedule',    name: 'Horarios',       icon: 'lni-calendar' },
                { id: 7, containerId: 'section-holidays',    name: 'Días Inhábiles', icon: 'lni-gift' },
                { id: 8, containerId: 'section-services',    name: 'Cursos',         icon: 'lni-graduation' },
              ])
        : (_hasExistingAgents
            ? [
                { id: 2,  containerId: 'section-basic',       name: 'Info. Básica',   icon: 'lni-information' },
                { id: 5,  containerId: 'section-personality', name: 'Personalidad',   icon: 'lni-comments' },
              ]
            : [
                { id: 1,  containerId: 'section-business',    name: 'Info. Negocio',  icon: 'lni-briefcase' },
                { id: 2,  containerId: 'section-basic',       name: 'Info. Básica',   icon: 'lni-information' },
                { id: 5,  containerId: 'section-personality', name: 'Personalidad',   icon: 'lni-comments' },
                { id: 6,  containerId: 'section-schedule',    name: 'Horarios',       icon: 'lni-calendar' },
                { id: 7,  containerId: 'section-holidays',    name: 'Días Festivos',  icon: 'lni-gift' },
                { id: 8,  containerId: 'section-services',    name: 'Servicios',      icon: 'lni-package' },
                { id: 9,  containerId: 'section-menu',        name: 'Menú',           icon: 'lni-files' },
                { id: 10, containerId: 'section-workers',     name: 'Trabajadores',   icon: 'lni-users' },
              ]);

    // Secciones a ocultar según contexto
    const _alwaysHide = _isGovModal ? [] : ['section-location', 'section-social'];
    if (_hasExistingAgents) {
        if (_isGovModal) {
            _alwaysHide.push('section-business','section-location','section-social','section-schedule','section-holidays','section-services','section-menu','section-workers');
        } else {
            _alwaysHide.push('section-business','section-schedule','section-holidays','section-services','section-menu','section-workers');
        }
    } else if (_isGovModal) {
        _alwaysHide.push('section-menu','section-workers');
    }
    _alwaysHide.forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.classList.remove('active'); el.style.display = 'none'; }
    });

    const AGENT_IDS = AGENT_SECTIONS.map(s => s.containerId);

    // ── Inicializar sub-funciones ANTES de tocar el nav ───────────────
    // (no llamar initializeSectionNavigation — la reemplazamos nosotros)
    if (typeof initializeRichEditor === 'function') initializeRichEditor();
    if (typeof initializePhoneToggle === 'function') initializePhoneToggle();
    if (typeof initializeToneSelection === 'function') initializeToneSelection();
    if (typeof initializeLanguageSelection === 'function') initializeLanguageSelection();
    if (typeof initializeSchedule === 'function') initializeSchedule();
    if (typeof initializeHolidays === 'function') initializeHolidays();
    if (typeof initializeServices === 'function') initializeServices();
    if (typeof initializeMenu === 'function') initializeMenu();
    if (typeof initializeWorkers === 'function') initializeWorkers();
    if (typeof initializeLocationDropdowns === 'function') initializeLocationDropdowns();
    if (typeof initializeSocialMediaInputs === 'function') initializeSocialMediaInputs();
    if (typeof initializeBusinessTypeSelect === 'function') initializeBusinessTypeSelect();
    setTimeout(() => {
        if (typeof fetchUserData === 'function') fetchUserData();
        if (typeof initBusinessTimePickers === 'function') initBusinessTimePickers();
        if (typeof initHolidayDatePickers === 'function') initHolidayDatePickers();
        if (typeof initWorkerTimePickers === 'function') initWorkerTimePickers();
        // En modo gobierno fetchUserData ya llama applyGovernmentMode
        // Para negocios normales, aplicar labels del giro
        if (!_isGovModal && window._dashboardBizType && typeof updateSectionLabels === 'function') {
            if (window.agentData) window.agentData.businessType = window._dashboardBizType;
            updateSectionLabels(window._dashboardBizType);
        }
    }, 100);

    // ── Construir nav DESPUÉS de las inicializaciones ─────────────────
    const sectionNav = document.getElementById('sectionNavigation');
    if (sectionNav) {
        sectionNav.innerHTML = '';
        sectionNav.style.justifyContent = 'center';
        sectionNav.style.flexWrap = 'wrap';
        sectionNav.style.gap = '0.5rem';

        AGENT_SECTIONS.forEach(sec => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'section-nav-btn';
            btn.dataset.sectionId = sec.id;
            btn.dataset.modalSection = sec.containerId;
            btn.innerHTML = `<i class="lni ${sec.icon}"></i><span>${sec.name}</span>`;
            btn.addEventListener('click', () => window._modalGoToSection(sec.containerId));
            sectionNav.appendChild(btn);
        });

        const resumenBtn = document.createElement('button');
        resumenBtn.type = 'button';
        resumenBtn.id = 'modal-resumen-tab';
        resumenBtn.className = 'section-nav-btn';
        resumenBtn.innerHTML = '<i class="lni lni-checkmark-circle"></i><span>Resumen</span>';
        resumenBtn.addEventListener('click', () => window._modalGoToResumen());
        sectionNav.appendChild(resumenBtn);
    }

    // ── Función cambiar sección ───────────────────────────────────────
    window._modalGoToSection = function(targetId) {
        AGENT_IDS.forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.classList.remove('active'); el.style.display = 'none'; }
        });
        document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
        if (step1) step1.style.display = 'none';
        if (step2) { step2.classList.add('active'); step2.style.display = ''; }

        const target = document.getElementById(targetId);
        if (target) { target.style.display = ''; target.classList.add('active'); }

        const currentIdx = AGENT_SECTIONS.findIndex(s => s.containerId === targetId);
        document.querySelectorAll('#sectionNavigation .section-nav-btn').forEach(btn => {
            btn.classList.remove('active', 'completed');
            const sid = parseInt(btn.dataset.sectionId);
            const sec = AGENT_SECTIONS.find(s => s.id === sid);
            if (!sec) return;
            const idx = AGENT_SECTIONS.indexOf(sec);
            if (idx === currentIdx) btn.classList.add('active');
            else if (idx < currentIdx) btn.classList.add('completed');
        });

        const el = document.getElementById(targetId);
        if (el) {
            el.querySelectorAll('.btn-prev-section').forEach(b => {
                b.style.display = currentIdx === 0 ? 'none' : 'flex';
            });
        }

        if (typeof window.updateProgressBar === 'function') window.updateProgressBar();
        const mb = document.getElementById('onboardingModalBody');
        if (mb) mb.scrollTop = 0;
    };

    // ── Función ir a Resumen ──────────────────────────────────────────
    window._modalGoToResumen = function() {
        AGENT_IDS.forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.classList.remove('active'); el.style.display = 'none'; }
        });
        document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
        if (step1) step1.style.display = 'none';
        const step3 = document.getElementById('step3');
        if (step3) { step3.classList.add('active'); step3.style.display = ''; }

        document.querySelectorAll('#sectionNavigation .section-nav-btn').forEach(b => {
            b.classList.remove('active', 'completed');
            if (b.id === 'modal-resumen-tab') b.classList.add('active');
            else b.classList.add('completed');
        });

        if (typeof collectFormData === 'function') collectFormData();
        if (typeof generateSummary === 'function') generateSummary();
        if (typeof window.updateProgressBar === 'function') window.updateProgressBar();
        const mb = document.getElementById('onboardingModalBody');
        if (mb) mb.scrollTop = 0;

        // ── Enganchar btnCreateAgent con onclick (sobrescribe cualquier handler previo) ──
        setTimeout(function() {
            var btnCA = document.getElementById('btnCreateAgent');
            if (btnCA) {
                btnCA.onclick = function() {
                    console.log('[dashboard] Click en Crear Agente');

                    // Re-colectar datos del formulario en el momento exacto del click
                    if (typeof collectFormData === 'function') collectFormData();

                    // Validar nombre del agente
                    var nombre = (window.agentData && window.agentData.name) ? window.agentData.name.trim() : '';
                    if (!nombre) {
                        // Intentar leerlo directo del input por si collectFormData no corrió
                        var inputNombre = document.getElementById('agentName');
                        if (inputNombre) nombre = inputNombre.value.trim();
                    }

                    if (!nombre) {
                        alert('Por favor ingresa el nombre del agente en la sección "Info. Básica".');
                        if (typeof window._modalGoToSection === 'function') {
                            window._modalGoToSection('section-basic');
                        }
                        return;
                    }

                    // Asegurar que agentData.name tenga el valor correcto
                    if (window.agentData) window.agentData.name = nombre;

                    // Si phoneToggle está desactivado, phoneNumber queda vacío
                    // (el backend usa el número registrado del usuario en ese caso)

                    console.log('[dashboard] Creando agente:', nombre);
                    if (typeof createAgent === 'function') {
                        createAgent();
                    } else {
                        console.error('[dashboard] createAgent no definida');
                    }
                };
                console.log('[dashboard] btnCreateAgent.onclick asignado en _modalGoToResumen');
            } else {
                console.warn('[dashboard] btnCreateAgent no encontrado en _modalGoToResumen');
            }
        }, 80);
    };

    // ── Parchear botones Siguiente/Anterior ───────────────────────────
    setTimeout(() => {
        // Parchar navigateToSection para que use _modalGoToSection en el modal
        window.navigateToSection = function(sectionId) {
            const sec = AGENT_SECTIONS.find(s => s.id === sectionId);
            if (sec && typeof window._modalGoToSection === 'function') {
                window._modalGoToSection(sec.containerId);
            }
        };

        // Aplicar modo gobierno DESPUÉS de _modalGoToSection
        if (_isGovModal && typeof applyGovernmentMode === 'function') {
            try { applyGovernmentMode(); } catch (_) {}
        }

        AGENT_SECTIONS.forEach((sec, idx) => {
            const el = document.getElementById(sec.containerId);
            if (!el) return;
            const prevSec = AGENT_SECTIONS[idx - 1];
            const nextSec = AGENT_SECTIONS[idx + 1];

            el.querySelectorAll('.btn-prev-section').forEach(btn => {
                btn.style.display = idx === 0 ? 'none' : 'flex';
                if (prevSec) btn.onclick = (e) => { e.stopPropagation(); window._modalGoToSection(prevSec.containerId); };
            });

            el.querySelectorAll('.btn-next-section, [class*="next"]').forEach(btn => {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    nextSec ? window._modalGoToSection(nextSec.containerId) : window._modalGoToResumen();
                };
            });
        });

        const btnBackStep3 = document.getElementById('btnBackStep3');
        if (btnBackStep3) {
            const lastSec = AGENT_SECTIONS[AGENT_SECTIONS.length - 1];
            btnBackStep3.onclick = (e) => { e.stopPropagation(); window._modalGoToSection(lastSec.containerId); };
        }
    }, 150);

    // ── Hook btnStep1: al hacer clic en "Continuar" de Red Social ──
    setTimeout(() => {
        // Reemplazar btnStep1 con clone para limpiar listeners previos
        const btnStep1El = document.getElementById('btnStep1');
        if (btnStep1El) {
            const btnStep1Clone = btnStep1El.cloneNode(true);
            btnStep1El.parentNode.replaceChild(btnStep1Clone, btnStep1El);
            btnStep1Clone.addEventListener('click', () => {
                if (step1) { step1.classList.remove('active'); step1.style.display = 'none'; }
                if (step2) { step2.classList.add('active'); step2.style.display = ''; }
                const nav = document.getElementById('sectionNavigation');
                if (nav) nav.style.display = '';
                window._modalGoToSection(_hasExistingAgents ? 'section-basic' : (_isGovModal ? 'section-business' : 'section-business'));
            });
            console.log('[dashboard] Hook btnStep1 registrado');
        }

        // ── Habilitar Continuar al seleccionar red social ──────────────────
        function _enableContinuar(value) {
            try { window.selectedSocial = value; } catch(e) {}
            try { window.agentData = window.agentData || {}; window.agentData.social = value; } catch(e) {}
            var btn = document.getElementById('btnStep1');
            if (btn) { btn.disabled = false; btn.removeAttribute('disabled'); }
            console.log('[dashboard] Red social:', value, '=> Continuar habilitado');
        }

        // change en radio inputs
        document.querySelectorAll('input[name="social"]').forEach(function(radio) {
            radio.addEventListener('change', function() { _enableContinuar(this.value); });
        });

        // click en label .social-card (fallback)
        document.querySelectorAll('.social-card').forEach(function(label) {
            label.addEventListener('click', function() {
                var radio = this.querySelector('input[type="radio"]');
                if (radio && !radio.disabled) {
                    setTimeout(function() { _enableContinuar(radio.value); }, 10);
                }
            });
        });

        // Si ya hay uno preseleccionado
        var checkedRadio = document.querySelector('input[name="social"]:checked');
        if (checkedRadio) _enableContinuar(checkedRadio.value);

    }, 200);

    if (typeof updateProgressBar === 'function') updateProgressBar();
}

// ================== Fin onboarding modal ==================


function updateStatCard(elementId, value) {
    const element = document.getElementById(elementId);
    if (!element) return;
    element.textContent = value;
}

// BILLING CHART
function initializeCostChart() {
    const ctx = document.getElementById('costChart');
    if (!ctx) return;

    const isDarkMode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const textColor = isDarkMode ? '#e5e7eb' : '#6b7280';

    costChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Costo Total',
                    data: [],
                    borderColor: '#06b6d4',
                    backgroundColor: 'rgba(6, 182, 212, 0.1)',
                    borderWidth: 3,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 4,
                    pointHoverRadius: 6,
                    pointBackgroundColor: '#06b6d4',
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2,
                    pointHoverBackgroundColor: '#06b6d4',
                    pointHoverBorderColor: '#fff'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { intersect: false, mode: 'index' },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    titleColor: '#fff',
                    bodyColor: '#fff',
                    borderColor: '#06b6d4',
                    borderWidth: 1,
                    padding: 12,
                    displayColors: false,
                    callbacks: {
                        label: function (context) {
                            const currency = document.getElementById('currencySelect')?.value || 'MXN';
                            const symbol = getCurrencySymbol(currency);
                            return 'Costo: ' + symbol + context.parsed.y.toFixed(2) + ' ' + currency;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false, drawBorder: false },
                    ticks: { color: textColor, font: { size: 11 } }
                },
                y: {
                    beginAtZero: true,
                    grid: { display: false, drawBorder: false },
                    ticks: {
                        color: textColor,
                        font: { size: 11 },
                        callback: function (value) {
                            const currency = document.getElementById('currencySelect')?.value || 'MXN';
                            const symbol = getCurrencySymbol(currency);
                            return symbol + value.toFixed(2);
                        }
                    }
                }
            }
        }
    });
}

async function loadBillingData(days = 28) {
    if (isFreePlan()) return;
    try {
        const response = await fetch(`/api/billing/data?days=${days}`);

        if (!response.ok) throw new Error('Error fetching billing data');

        const data = await response.json();
        updateCostSummary(data.summary, days);
        updateCostChart(data.timeline);
    } catch (error) {
        console.error('Error loading billing data:', error);
        const mockData = generateMockBillingData(days);
        updateCostSummary(mockData.summary, days);
        updateCostChart(mockData.timeline);
    }
}

function updateCostSummary(summary) {
    const currency = document.getElementById('currencySelect')?.value || 'MXN';
    const symbol = getCurrencySymbol(currency);
    const convertedCost = convertCurrency(summary.cost, currency);
    document.getElementById('totalCost').textContent = symbol + convertedCost.toFixed(2) + ' ' + currency;
}

function updateCostChart(timeline) {
    billingTimelineData = timeline; // cache for table view
    if (billingView === 'table') {
        renderBillingTable(timeline);
        return;
    }
    if (!costChart) return;
    const currency = document.getElementById('currencySelect')?.value || 'MXN';
    const convertedCosts = timeline.costs.map((cost) => convertCurrency(cost, currency));
    costChart.data.labels = timeline.labels;
    costChart.data.datasets[0].data = convertedCosts;
    costChart.update('none');
}

function generateMockBillingData(days) {
    const labels = [];
    const costs = [];
    let totalCost = 0;

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toLocaleDateString('es-MX', { month: 'short', day: 'numeric' });
        labels.push(dateStr);

        const dailyCost = Math.random() * 0.05 + 0.01;
        totalCost += dailyCost;
        costs.push(parseFloat(totalCost.toFixed(2)));
    }

    return {
        summary: { cost: totalCost },
        timeline: { labels: labels, costs: costs }
    };
}

// SERVICES STATISTICS
async function loadServicesStatistics() {
    try {
        const response = await fetch('/api/services/statistics');

        if (!response.ok) throw new Error('Error fetching services statistics');

        const data = await response.json();
        servicesData = data;

        renderServiceBars('mostRequestedServicesContainer', data.mostRequested, false);
        renderServiceBars('leastRequestedServicesContainer', data.leastRequested, true);

        renderPieChart('mostRequestedPieChart', 'mostRequestedLegend', 'mostRequestedTotal', data.mostRequested, false);
        renderPieChart('leastRequestedPieChart', 'leastRequestedLegend', 'leastRequestedTotal', data.leastRequested, true);
    } catch (error) {
        console.error('Error loading services statistics:', error);

        const mockData = generateMockServicesData();
        servicesData = mockData;

        renderServiceBars('mostRequestedServicesContainer', mockData.mostRequested, false);
        renderServiceBars('leastRequestedServicesContainer', mockData.leastRequested, true);

        renderPieChart('mostRequestedPieChart', 'mostRequestedLegend', 'mostRequestedTotal', mockData.mostRequested, false);
        renderPieChart('leastRequestedPieChart', 'leastRequestedLegend', 'leastRequestedTotal', mockData.leastRequested, true);
    }
}

function renderServiceBars(containerId, services) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';

    if (!services || services.length === 0) {
        container.innerHTML = `
      <div class="service-chart-empty">
        <i class="lni lni-pie-chart"></i>
        <p>No hay datos disponibles</p>
      </div>
    `;
        return;
    }

    const maxCount = Math.max(...services.map((s) => s.count));

    services.forEach((service) => {
        const percentage = (service.count / maxCount) * 100;

        const barItem = document.createElement('div');
        barItem.className = 'service-bar-item';
        barItem.innerHTML = `
      <div class="service-bar-label">${service.name}</div>
      <div class="service-bar-wrapper">
        <div class="service-bar-track">
          <div class="service-bar-fill" style="width: 0%;">
            <span class="service-bar-value">${percentage.toFixed(0)}%</span>
          </div>
        </div>
        <div class="service-count">${service.count}</div>
      </div>
    `;

        container.appendChild(barItem);

        setTimeout(() => {
            const fillBar = barItem.querySelector('.service-bar-fill');
            if (fillBar) {
                fillBar.style.width = percentage + '%';
            }
        }, 100);
    });
}

function generateMockServicesData() {
    const allServices = [
        { name: 'Corte de Cabello', count: 145 },
        { name: 'Manicure', count: 132 },
        { name: 'Pedicure', count: 98 },
        { name: 'Tinte', count: 87 },
        { name: 'Depilación', count: 76 },
        { name: 'Masaje', count: 65 },
        { name: 'Facial', count: 54 },
        { name: 'Maquillaje', count: 43 },
        { name: 'Extensiones', count: 21 },
        { name: 'Keratina', count: 15 }
    ];

    const mostRequested = allServices.slice(0, 5);
    const leastRequested = allServices.slice(-5).reverse();

    return { mostRequested, leastRequested };
}

// PIE CHARTS
const pieColors = [
    '#06b6d4', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444',
    '#ec4899', '#6366f1', '#14b8a6', '#f97316', '#a855f7'
];

function renderPieChart(canvasId, legendId, totalId, services, isLeast = false) {
    const canvas = document.getElementById(canvasId);
    const legendContainer = document.getElementById(legendId);
    const totalBadge = document.getElementById(totalId);

    if (!canvas || !legendContainer || !totalBadge) return;

    if (!services || services.length === 0) {
        canvas.parentElement.innerHTML = `
      <div class="service-chart-empty">
        <i class="lni lni-pie-chart"></i>
        <p>No hay datos disponibles</p>
      </div>
    `;
        return;
    }

    const total = services.reduce((sum, service) => sum + service.count, 0);
    totalBadge.textContent = `${total} Total`;

    const labels = services.map((s) => s.name);
    const data = services.map((s) => s.count);
    const colors = services.map((_, index) => pieColors[index % pieColors.length]);

    if (isLeast && leastRequestedPieChart) {
        leastRequestedPieChart.destroy();
    } else if (!isLeast && mostRequestedPieChart) {
        mostRequestedPieChart.destroy();
    }

    const chart = new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [
                {
                    data: data,
                    backgroundColor: colors,
                    borderWidth: 3,
                    borderColor: '#fff',
                    hoverOffset: 15
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    titleColor: '#fff',
                    bodyColor: '#fff',
                    borderColor: colors[0],
                    borderWidth: 1,
                    padding: 12,
                    displayColors: true,
                    callbacks: {
                        label: function (context) {
                            const value = context.parsed;
                            const percentage = ((value / total) * 100).toFixed(1);
                            return ` ${context.label}: ${value} (${percentage}%)`;
                        }
                    }
                }
            },
            cutout: '65%',
            animation: {
                animateRotate: true,
                animateScale: true,
                duration: 1000,
                easing: 'easeOutQuart'
            }
        }
    });

    if (isLeast) leastRequestedPieChart = chart;
    else mostRequestedPieChart = chart;

    renderPieLegend(legendContainer, services, colors, total);
}

function renderPieLegend(container, services, colors, total) {
    container.innerHTML = '';

    services.forEach((service, index) => {
        const percentage = ((service.count / total) * 100).toFixed(1);

        const legendItem = document.createElement('div');
        legendItem.className = 'pie-legend-item';
        legendItem.innerHTML = `
      <div class="pie-legend-color" style="background-color: ${colors[index]};"></div>
      <div class="pie-legend-info">
        <span class="pie-legend-label">${service.name}</span>
        <div class="pie-legend-value">
          <span class="pie-legend-percentage">${percentage}%</span>
          <span class="pie-legend-count">(${service.count})</span>
        </div>
      </div>
    `;

        container.appendChild(legendItem);
    });
}

// EXPORTS
function exportToExcel() {
    if (!servicesData) {
        showNotification('No hay datos para exportar', 'error');
        return;
    }

    try {
        const wb = XLSX.utils.book_new();

        const mostRequestedData = [
            ['Servicios Más Pedidos'],
            ['Servicio', 'Cantidad', 'Porcentaje'],
            ...servicesData.mostRequested.map((service) => {
                const total = servicesData.mostRequested.reduce((sum, s) => sum + s.count, 0);
                const percentage = ((service.count / total) * 100).toFixed(1) + '%';
                return [service.name, service.count, percentage];
            }),
            [],
            ['Total', servicesData.mostRequested.reduce((sum, s) => sum + s.count, 0)]
        ];

        const leastRequestedData = [
            ['Servicios Menos Pedidos'],
            ['Servicio', 'Cantidad', 'Porcentaje'],
            ...servicesData.leastRequested.map((service) => {
                const total = servicesData.leastRequested.reduce((sum, s) => sum + s.count, 0);
                const percentage = ((service.count / total) * 100).toFixed(1) + '%';
                return [service.name, service.count, percentage];
            }),
            [],
            ['Total', servicesData.leastRequested.reduce((sum, s) => sum + s.count, 0)]
        ];

        const wsMostRequested = XLSX.utils.aoa_to_sheet(mostRequestedData);
        const wsLeastRequested = XLSX.utils.aoa_to_sheet(leastRequestedData);

        XLSX.utils.book_append_sheet(wb, wsMostRequested, 'Más Pedidos');
        XLSX.utils.book_append_sheet(wb, wsLeastRequested, 'Menos Pedidos');

        const fileName = `servicios_${new Date().toISOString().split('T')[0]}.xlsx`;
        XLSX.writeFile(wb, fileName);

        showNotification('Excel exportado exitosamente', 'success');
    } catch (error) {
        console.error('Error exporting to Excel:', error);
        showNotification('Error al exportar a Excel', 'error');
    }
}

function exportToPDF() {
    if (!servicesData) {
        showNotification('No hay datos para exportar', 'error');
        return;
    }

    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        doc.setFontSize(20);
        doc.setTextColor(6, 182, 212);
        doc.text('Reporte de Servicios', 20, 20);

        doc.setFontSize(10);
        doc.setTextColor(100);
        doc.text(`Fecha: ${new Date().toLocaleDateString('es-MX')}`, 20, 30);

        doc.setFontSize(16);
        doc.setTextColor(0);
        doc.text('Servicios Más Pedidos', 20, 45);

        let yPos = 55;
        const mostTotal = servicesData.mostRequested.reduce((sum, s) => sum + s.count, 0);

        doc.setFontSize(10);
        servicesData.mostRequested.forEach((service, index) => {
            const percentage = ((service.count / mostTotal) * 100).toFixed(1);
            doc.setTextColor(80);
            doc.text(`${index + 1}. ${service.name}`, 25, yPos);
            doc.setTextColor(6, 182, 212);
            doc.text(`${service.count} (${percentage}%)`, 150, yPos);
            yPos += 8;
        });

        yPos += 5;
        doc.setFontSize(12);
        doc.setTextColor(0);
        doc.text(`Total: ${mostTotal}`, 25, yPos);

        yPos += 20;
        doc.setFontSize(16);
        doc.text('Servicios Menos Pedidos', 20, yPos);

        yPos += 10;
        const leastTotal = servicesData.leastRequested.reduce((sum, s) => sum + s.count, 0);

        doc.setFontSize(10);
        servicesData.leastRequested.forEach((service, index) => {
            const percentage = ((service.count / leastTotal) * 100).toFixed(1);
            doc.setTextColor(80);
            doc.text(`${index + 1}. ${service.name}`, 25, yPos);
            doc.setTextColor(139, 92, 246);
            doc.text(`${service.count} (${percentage}%)`, 150, yPos);
            yPos += 8;
        });

        yPos += 5;
        doc.setFontSize(12);
        doc.setTextColor(0);
        doc.text(`Total: ${leastTotal}`, 25, yPos);

        const pageHeight = doc.internal.pageSize.height;
        doc.setFontSize(8);
        doc.setTextColor(150);
        doc.text('Generado por Attomos Dashboard', 20, pageHeight - 10);

        const fileName = `servicios_${new Date().toISOString().split('T')[0]}.pdf`;
        doc.save(fileName);

        showNotification('PDF exportado exitosamente', 'success');
    } catch (error) {
        console.error('Error exporting to PDF:', error);
        showNotification('Error al exportar a PDF', 'error');
    }
}

// Notifications
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
    <i class="lni lni-${type === 'success' ? 'checkmark-circle' : 'warning'}"></i>
    <span>${message}</span>
  `;
    document.body.appendChild(notification);
    setTimeout(() => notification.classList.add('active'), 10);
    setTimeout(() => {
        notification.classList.remove('active');
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}