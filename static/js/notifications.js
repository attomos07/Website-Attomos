// ============================================
// NOTIFICATIONS PAGE — notifications.js
// ============================================

let allNotifications = [];
let currentFilter = 'all';

document.addEventListener('DOMContentLoaded', function () {
    initNotificationsPage();
    setupFilterTabs();
    setupHeaderActions();
});

// ============================================
// INIT
// ============================================

async function initNotificationsPage() {
    try {
        const appointments = await loadAppointments();
        allNotifications = buildNotifications(appointments);
        updateStats();
        renderNotifications();
    } catch (err) {
        console.error('Error inicializando notificaciones:', err);
        renderEmpty('Error al cargar las notificaciones');
    } finally {
        hideSkeleton();
    }
}

// ============================================
// DATA LOADING
// ============================================

async function loadAppointments() {
    const res = await fetch('/api/appointments', { credentials: 'include' });
    if (!res.ok) throw new Error('API error');
    const data = await res.json();
    return data.appointments || [];
}

function buildNotifications(appointments) {
    const notifications = [];
    const now = new Date();

    const pad = n => String(n).padStart(2, '0');
    const todayStr    = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const tomorrowD   = new Date(now);
    tomorrowD.setDate(tomorrowD.getDate() + 1);
    const tomorrowStr = `${tomorrowD.getFullYear()}-${pad(tomorrowD.getMonth() + 1)}-${pad(tomorrowD.getDate())}`;

    const weekLaterD  = new Date(now);
    weekLaterD.setDate(weekLaterD.getDate() + 7);

    const active = appointments.filter(a => a.status !== 'cancelled');

    // ── Urgentes: citas en la próxima hora ──────────────────────────────
    const todayAppts = active.filter(a => a.date === todayStr);
    todayAppts.forEach(a => {
        const [h, m] = a.time.split(':').map(Number);
        const apptTime = new Date(now);
        apptTime.setHours(h, m, 0, 0);
        const diffMin = (apptTime - now) / 60000;

        if (diffMin > 0 && diffMin <= 60) {
            notifications.push({
                id: `urgent-${a.id}`,
                type: 'urgent',
                text: `Cita con <strong>${a.client}</strong> en ${Math.round(diffMin)} min`,
                detail: `${a.service || '—'} · ${a.time} · ${a.worker || 'Sin trabajador'}`,
                time: 'En breve',
                group: 'Hoy — Urgentes',
                unread: true,
                appointmentId: a.id
            });
        } else if (diffMin > 0) {
            // Resto de citas hoy
            notifications.push({
                id: `today-${a.id}`,
                type: 'appointment',
                text: `Cita con <strong>${a.client}</strong> a las ${a.time}`,
                detail: `${a.service || '—'} · ${a.worker || 'Sin trabajador'}`,
                time: 'Hoy',
                group: 'Hoy',
                unread: true,
                appointmentId: a.id
            });
        } else {
            // Pasadas hoy
            notifications.push({
                id: `past-${a.id}`,
                type: 'appointment',
                text: `Cita completada con <strong>${a.client}</strong>`,
                detail: `${a.service || '—'} · ${a.time}`,
                time: 'Hoy (pasada)',
                group: 'Hoy — Completadas',
                unread: false,
                appointmentId: a.id
            });
        }
    });

    // ── Mañana ──────────────────────────────────────────────────────────
    const tomorrowAppts = active.filter(a => a.date === tomorrowStr);
    if (tomorrowAppts.length > 0) {
        const s = tomorrowAppts.length;
        notifications.push({
            id: 'tomorrow-summary',
            type: 'warning',
            text: `Tienes <strong>${s} cita${s > 1 ? 's' : ''}</strong> programada${s > 1 ? 's' : ''} para mañana`,
            detail: tomorrowAppts.map(a => `${a.time} · ${a.client}`).join(' &nbsp;|&nbsp; '),
            time: 'Mañana',
            group: 'Próximamente',
            unread: true
        });
    }

    // ── Esta semana (excluyendo hoy y mañana) ───────────────────────────
    const weekAppts = active.filter(a => {
        return a.date > tomorrowStr && a.date <= weekLaterD.toISOString().split('T')[0];
    });
    if (weekAppts.length > 0) {
        const s = weekAppts.length;
        notifications.push({
            id: 'week-summary',
            type: 'appointment',
            text: `<strong>${s} cita${s > 1 ? 's' : ''}</strong> esta semana`,
            detail: weekAppts.slice(0, 3).map(a => `${a.date} · ${a.client}`).join(' &nbsp;|&nbsp; ') + (s > 3 ? ' …' : ''),
            time: 'Esta semana',
            group: 'Próximamente',
            unread: false
        });
    }

    // ── Citas pendientes (sin confirmar) ────────────────────────────────
    const pendingAppts = appointments.filter(a => a.status === 'pending');
    if (pendingAppts.length > 0) {
        const s = pendingAppts.length;
        notifications.push({
            id: 'pending-summary',
            type: 'warning',
            text: `<strong>${s} cita${s > 1 ? 's' : ''}</strong> pendiente${s > 1 ? 's' : ''} de confirmación`,
            detail: pendingAppts.map(a => a.client).slice(0, 4).join(', ') + (s > 4 ? '…' : ''),
            time: 'Pendientes',
            group: 'Atención requerida',
            unread: true
        });
    }

    // ── Citas canceladas recientes ───────────────────────────────────────
    const cancelledAppts = appointments.filter(a => a.status === 'cancelled');
    cancelledAppts.slice(0, 3).forEach(a => {
        notifications.push({
            id: `cancelled-${a.id}`,
            type: 'warning',
            text: `Cita cancelada con <strong>${a.client}</strong>`,
            detail: `${a.service || '—'} · ${a.date} ${a.time}`,
            time: 'Cancelada',
            group: 'Cancelaciones',
            unread: false,
            appointmentId: a.id
        });
    });

    return notifications;
}

// ============================================
// STATS
// ============================================

function updateStats() {
    const unread  = allNotifications.filter(n => n.unread).length;
    const total   = allNotifications.length;
    const urgent  = allNotifications.filter(n => n.type === 'urgent').length;

    document.getElementById('unreadCount').textContent = unread;
    document.getElementById('totalCount').textContent  = total;
    document.getElementById('urgentCount').textContent = urgent;

    const urgentPill = document.getElementById('urgentPill');
    if (urgentPill) urgentPill.style.display = urgent > 0 ? 'inline-flex' : 'none';
}

// ============================================
// RENDER
// ============================================

function getFiltered() {
    if (currentFilter === 'all')     return allNotifications;
    if (currentFilter === 'unread')  return allNotifications.filter(n => n.unread);
    return allNotifications.filter(n => n.type === currentFilter);
}

function renderNotifications() {
    const container = document.getElementById('notificationsContainer');
    const emptyState = document.getElementById('emptyState');
    const filtered = getFiltered();

    if (filtered.length === 0) {
        container.innerHTML = '';
        emptyState.style.display = 'flex';
        const msgs = {
            unread:      'No tienes notificaciones sin leer',
            urgent:      'No hay alertas urgentes en este momento',
            appointment: 'No hay notificaciones de citas',
            warning:     'No hay avisos pendientes',
            all:         'No tienes notificaciones pendientes'
        };
        document.getElementById('emptyMessage').textContent = msgs[currentFilter] || msgs.all;
        return;
    }

    emptyState.style.display = 'none';

    // Group notifications
    const groups = {};
    filtered.forEach(n => {
        const g = n.group || 'General';
        if (!groups[g]) groups[g] = [];
        groups[g].push(n);
    });

    container.innerHTML = Object.entries(groups).map(([groupName, items], gi) => `
        <div class="notif-group" style="animation-delay: ${gi * 0.05}s">
            <div class="group-label">${groupName}</div>
            ${items.map((n, i) => renderCard(n, gi * 10 + i)).join('')}
        </div>
    `).join('');

    // Attach events
    container.querySelectorAll('.notif-card').forEach(card => {
        const id = card.dataset.id;

        card.addEventListener('click', (e) => {
            if (e.target.closest('.notif-action-btn')) return;
            markAsRead(id);
            const n = allNotifications.find(x => x.id === id);
            if (n?.appointmentId) {
                window.location.href = `/appointments`;
            }
        });

        const deleteBtn = card.querySelector('.notif-action-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                dismissNotification(id);
            });
        }
    });
}

function renderCard(n, idx) {
    const iconMap = {
        urgent: 'lni-alarm',
        appointment: 'lni-calendar',
        warning: 'lni-warning'
    };
    const icon = iconMap[n.type] || 'lni-alarm';

    return `
        <div class="notif-card type-${n.type} ${n.unread ? 'unread' : ''}"
             data-id="${n.id}"
             style="animation-delay: ${idx * 0.04}s">
            <div class="notif-icon-wrap type-${n.type}">
                <i class="lni ${icon}"></i>
            </div>
            <div class="notif-card-body">
                <div class="notif-card-text">${n.text}</div>
                ${n.detail ? `<div class="notif-card-text" style="font-size:0.82rem;color:#9ca3af;margin-top:0.2rem;">${n.detail}</div>` : ''}
                <div class="notif-card-meta">
                    <span class="notif-card-time">
                        <i class="lni lni-clock"></i> ${n.time}
                    </span>
                    <span class="notif-type-badge badge-${n.type}">${labelFor(n.type)}</span>
                </div>
            </div>
            <div class="notif-card-actions">
                <span class="notif-unread-dot"></span>
                <button class="notif-action-btn" title="Descartar">
                    <i class="lni lni-close"></i>
                </button>
            </div>
        </div>
    `;
}

function labelFor(type) {
    return { urgent: 'Urgente', appointment: 'Cita', warning: 'Aviso' }[type] || type;
}

// ============================================
// ACTIONS
// ============================================

function markAsRead(id) {
    const n = allNotifications.find(x => x.id === id);
    if (n) n.unread = false;
    updateStats();
    renderNotifications();
}

function dismissNotification(id) {
    const card = document.querySelector(`.notif-card[data-id="${id}"]`);
    if (card) {
        card.style.transition = 'all 0.3s ease';
        card.style.opacity = '0';
        card.style.transform = 'translateX(40px)';
        setTimeout(() => {
            allNotifications = allNotifications.filter(x => x.id !== id);
            updateStats();
            renderNotifications();
        }, 300);
    }
}

function setupHeaderActions() {
    document.getElementById('markAllReadBtn')?.addEventListener('click', () => {
        allNotifications.forEach(n => n.unread = false);
        updateStats();
        renderNotifications();
    });

    document.getElementById('clearAllBtn')?.addEventListener('click', () => {
        const filtered = getFiltered();
        const ids = new Set(filtered.map(n => n.id));
        // Animate out all visible cards
        document.querySelectorAll('.notif-card').forEach((card, i) => {
            card.style.transition = `all 0.25s ease ${i * 0.04}s`;
            card.style.opacity = '0';
            card.style.transform = 'translateX(40px)';
        });
        setTimeout(() => {
            allNotifications = allNotifications.filter(n => !ids.has(n.id));
            updateStats();
            renderNotifications();
        }, filtered.length * 40 + 300);
    });
}

// ============================================
// FILTER TABS
// ============================================

function setupFilterTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            currentFilter = this.dataset.filter;
            renderNotifications();
        });
    });
}

// ============================================
// SKELETON
// ============================================

function hideSkeleton() {
    const sk = document.getElementById('skeletonLoader');
    if (sk) {
        sk.style.transition = 'opacity 0.3s ease';
        sk.style.opacity = '0';
        setTimeout(() => sk.remove(), 300);
    }
}