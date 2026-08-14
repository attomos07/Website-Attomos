/* ============================================================
   admin-metrics.js — Panel de métricas de bots, Attomos Admin
   ============================================================ */

const REFRESH_INTERVAL_MS = 15000; // 15s — es monitoreo en vivo, no un catálogo

// ── Helpers de formato ──────────────────────────────────────
function fmtPct(n) {
    return `${(n ?? 0).toFixed(1)}%`;
}
function fmtMB(n) {
    n = n ?? 0;
    if (n >= 1024) return `${(n / 1024).toFixed(2)} GB`;
    return `${n.toFixed(0)} MB`;
}
function fmtGB(n) {
    return `${(n ?? 0).toFixed(1)} GB`;
}
function fmtUptime(seconds) {
    seconds = seconds ?? 0;
    if (seconds <= 0) return '—';
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}
function fmtAgo(unixMs) {
    if (!unixMs) return 'Nunca';
    const diffSec = Math.max(0, Math.floor((Date.now() - unixMs) / 1000));
    if (diffSec < 60) return `hace ${diffSec}s`;
    if (diffSec < 3600) return `hace ${Math.floor(diffSec / 60)}m`;
    return `hace ${Math.floor(diffSec / 3600)}h`;
}
function typeLabel(botType) {
    const map = { atomic: 'AtomicBot', orbital: 'OrbitalBot', telegram: 'TelegramBot', builderbot: 'OrbitalBot' };
    return map[botType] || botType || '—';
}
function typeClass(botType) {
    if (botType === 'orbital' || botType === 'builderbot') return 'orbital';
    if (botType === 'telegram') return 'telegram';
    return 'atomic';
}
function barClass(pct) {
    if (pct >= 85) return 'bad';
    if (pct >= 60) return 'warn';
    return 'ok';
}
function bar(pct, label) {
    const cls = barClass(pct);
    const width = Math.min(100, Math.max(0, pct));
    return `
        <div class="bar-cell">
            <div class="bar-track"><div class="bar-fill ${cls}" style="width:${width}%"></div></div>
            <div class="bar-value">${label}</div>
        </div>`;
}

// ── Carga y render ───────────────────────────────────────────
async function loadMetrics() {
    try {
        const res = await fetch('/admin/api/metrics', { credentials: 'include' });
        if (res.status === 401) { window.location.href = '/admin/login'; return; }
        const data = await res.json();

        document.getElementById('statTotal').textContent     = data.summary?.total ?? '—';
        document.getElementById('statConnected').textContent = data.summary?.connected ?? '—';
        document.getElementById('statCPU').textContent        = fmtPct(data.summary?.totalCpuPct);
        document.getElementById('statMem').textContent        = fmtMB(data.summary?.totalMemMb);

        renderTable(data.agents || []);
        document.getElementById('tableMeta').textContent = `Actualizado ${new Date().toLocaleTimeString('es-MX')}`;
    } catch (err) {
        console.error('Error cargando métricas:', err);
        document.getElementById('tableMeta').textContent = 'Error al actualizar';
    }
}

function renderTable(agents) {
    const tbody = document.getElementById('metricsBody');

    if (agents.length === 0) {
        tbody.innerHTML = `
            <tr><td colspan="10">
                <div class="empty-state">
                    <i class="lni lni-cog"></i>
                    <p>No hay agentes con bot todavía.</p>
                </div>
            </td></tr>`;
        return;
    }

    tbody.innerHTML = agents.map(a => {
        const statusCls   = a.connected ? 'active' : 'inactive';
        const statusLabel = a.connected ? 'Conectado' : 'Desconectado';
        const cpuBar = a.hasMetrics ? bar(a.cpuPercent, fmtPct(a.cpuPercent)) : '<span style="color:var(--muted)">—</span>';
        const memVal = a.hasMetrics ? fmtMB(a.memRssMb) : '—';

        return `
        <tr>
            <td data-label="Agente">
                <div class="bot-name">${a.agentName || '—'}</div>
                <div class="bot-business">${a.businessName || '—'}</div>
            </td>
            <td data-label="Tipo"><span class="bot-type-badge ${typeClass(a.botType)}">${typeLabel(a.botType)}</span></td>
            <td data-label="Estado"><span class="status-dot ${statusCls}">${statusLabel}</span></td>
            <td data-label="CPU">${cpuBar}</td>
            <td data-label="RAM">${memVal}</td>
            <td data-label="Goroutines">${a.hasMetrics ? a.goroutines : '—'}</td>
            <td data-label="Sesión">${a.hasMetrics ? fmtMB(a.dbSizeMb) : '—'}</td>
            <td data-label="Disco libre">${a.hasMetrics ? fmtGB(a.diskFreeGb) : '—'}</td>
            <td data-label="Uptime">${a.hasMetrics ? fmtUptime(a.uptimeSeconds) : '—'}</td>
            <td data-label="Últ. reporte">${fmtAgo(a.lastUpdated)}</td>
        </tr>`;
    }).join('');
}

// ── Init + auto-refresh ──────────────────────────────────────
loadMetrics();
setInterval(loadMetrics, REFRESH_INTERVAL_MS);