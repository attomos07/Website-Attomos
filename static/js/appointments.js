// ==========================================
// VARIABLES GLOBALES Y ESTADO
// ==========================================
let appointments = [];
let agents = [];
let currentView = 'list';
let currentFilters = {
    status: 'all',
    agent: 'all',
    date: 'all',
    search: ''
};
let openDropdown = null;

// ==========================================
// INICIALIZACIÓN
// ==========================================
function getLang() {
    return localStorage.getItem('attomos_lang') || localStorage.getItem('lang') || 'es';
}
function t(key, fallback) {
    return window.Translations?.dict?.[getLang()]?.[key] || fallback;
}

// Re-renderiza el contenido dinámico (tabla/calendario/stats) cuando cambia
// el idioma, usando los datos ya cargados en memoria (sin volver a pedirlos).
document.addEventListener('attomos:langchange', function () {
    updateStats();
    renderAppointments();
    if (typeof renderCalendar === 'function' && currentView === 'calendar') renderCalendar();
});

document.addEventListener('DOMContentLoaded', function () {
    console.log('🚀 Inicializando página de citas...');
    initializeAppointments();
    setupEventListeners();

    // Cerrar dropdowns de acciones (los de la tabla) al hacer clic fuera
    document.addEventListener('click', function (e) {
        if (!e.target.closest('.actions-dropdown')) {
            closeAllDropdowns();
        }
    });
});

async function initializeAppointments() {
    await loadAgents();
    await loadAppointments();
    updateStats();
    renderAppointments();
}

function setupEventListeners() {
    // 1. Alternar Vistas (Lista vs Calendario)
    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            currentView = this.dataset.view;
            toggleView();
        });
    });

    // 2. Filtros
    document.getElementById('statusFilter')?.addEventListener('change', function () {
        currentFilters.status = this.value;
        renderAppointments();
    });

    document.getElementById('agentFilter')?.addEventListener('change', function () {
        currentFilters.agent = this.value;
        renderAppointments();
    });

    document.getElementById('dateFilter')?.addEventListener('change', function () {
        currentFilters.date = this.value;
        renderAppointments();
    });

    document.getElementById('searchInput')?.addEventListener('input', function () {
        currentFilters.search = this.value.toLowerCase();
        renderAppointments();
    });

    // 3. Navegación del Calendario
    const prevMonth = document.getElementById('prevMonth');
    const nextMonth = document.getElementById('nextMonth');

    if (prevMonth) prevMonth.addEventListener('click', () => changeMonth(-1));
    if (nextMonth) nextMonth.addEventListener('click', () => changeMonth(1));
}

// ==========================================
// LÓGICA DEL MODAL "NUEVA CITA"
// ==========================================

function openAppointmentModal() {
    const modal = document.getElementById('appointmentModal');
    const modalTitle = document.getElementById('modalTitle');
    const modalBody = document.getElementById('modalBody');

    modalTitle.innerHTML = `<i class="lni lni-calendar-plus" style="color: #06b6d4;"></i> ${t('appts_new_btn', 'Nueva Cita')}`;

    modalBody.innerHTML = `
        <form id="createAppointmentForm" class="appointment-form">
            <div class="form-grid">
                <div class="form-group">
                    <label class="form-label"><i class="lni lni-user"></i> Nombre(s)</label>
                    <input type="text" class="form-input" id="clientFirstName" placeholder="Nombre(s)" required>
                </div>
                <div class="form-group">
                    <label class="form-label"><i class="lni lni-user"></i> Apellido(s)</label>
                    <input type="text" class="form-input" id="clientLastName" placeholder="Apellido(s)" required>
                </div>

                <div class="form-group">
                    <label class="form-label"><i class="lni lni-phone"></i> Teléfono</label>
                    <input type="tel" class="form-input" id="clientPhone">
                </div>

                <div class="form-group">
                    <label class="form-label"><i class="lni lni-briefcase"></i> Servicio</label>
                    <input type="text" class="form-input" id="serviceName" required>
                </div>

                <div class="form-group">
                    <label class="form-label"><i class="lni lni-user"></i> Trabajador/Especialista</label>
                    <input type="text" class="form-input" id="workerName">
                </div>

                <div class="form-group">
                    <label class="form-label"><i class="lni lni-database"></i> Agente</label>
                    <div class="custom-dropdown-wrapper" id="agentDropdownWrapper">
                        <input type="text" class="form-input form-dropdown" id="agentSelectDisplay" readonly required placeholder="Selecciona un agente">
                        <i class="lni lni-chevron-down dropdown-arrow"></i>
                        <div class="dropdown-menu">
                            <div class="dropdown-options" id="agentOptions"></div>
                        </div>
                    </div>
                    <input type="hidden" id="agentSelect" required>
                </div>

                <div class="form-group">
                    <label class="form-label"><i class="lni lni-calendar"></i> Fecha</label>
                    <input type="date" class="form-input" id="appointmentDate" required>
                </div>

                <div class="form-group">
                    <label class="form-label"><i class="lni lni-clock"></i> Hora</label>
                    <div class="custom-dropdown-wrapper" id="timeDropdownWrapper">
                        <input type="text" class="form-input form-dropdown" id="timeSelectDisplay" readonly required>
                        <i class="lni lni-chevron-down dropdown-arrow"></i>
                        <div class="dropdown-menu">
                            <div class="dropdown-options" id="timeOptions"></div>
                        </div>
                    </div>
                    <input type="hidden" id="appointmentTime" required>
                </div>

                <input type="hidden" id="appointmentStatus" value="confirmed">
            </div>

            <div class="form-actions">
                <button type="button" class="btn-cancel" onclick="closeAppointmentModal()">
                    <i class="lni lni-close"></i> <span>Cancelar</span>
                </button>
                <button type="submit" class="btn-submit">
                    <i class="lni lni-checkmark"></i> <span>Crear Cita</span>
                </button>
            </div>
        </form>
    `;

    initAgentDropdown();
    initTimeDropdown();

    const dateInput = document.getElementById('appointmentDate');
    const today = new Date().toISOString().split('T')[0];
    dateInput.min = today;
    dateInput.value = today;

    document.getElementById('createAppointmentForm').addEventListener('submit', handleCreateAppointment);

    modal.classList.add('active');
}

function closeAppointmentModal() {
    const modal = document.getElementById('appointmentModal');
    modal.classList.remove('active');
}

// ==========================================
// MANEJO DE FORMULARIO (SUBMIT)
// ==========================================
async function handleCreateAppointment(e) {
    e.preventDefault();

    const formData = {
        client: (document.getElementById('clientFirstName').value + ' ' + document.getElementById('clientLastName').value).trim(),
        phone: document.getElementById('clientPhone').value,
        service: document.getElementById('serviceName').value,
        worker: document.getElementById('workerName').value,
        agentId: parseInt(document.getElementById('agentSelect').value),
        date: document.getElementById('appointmentDate').value,
        time: document.getElementById('appointmentTime').value,
        status: document.getElementById('appointmentStatus').value
    };

    if (!formData.agentId) {
        showNotification(t('appts_filter_all_agents', 'Por favor selecciona un agente'), 'error');
        return;
    }

    const submitBtn = e.target.querySelector('.btn-submit');
    const originalHTML = submitBtn.innerHTML;
    submitBtn.innerHTML = `<div class="loading-spinner-small"></div> <span>${t('loading', 'Cargando...')}</span>`;
    submitBtn.disabled = true;

    try {
        // El backend espera date (YYYY-MM-DD) y time (HH:MM) como campos separados
        const body = {
            clientFirstName: document.getElementById('clientFirstName').value.trim(),
            clientLastName:  document.getElementById('clientLastName').value.trim(),
            clientPhone:     formData.phone,
            service:         formData.service,
            worker:          formData.worker,
            agentId:         formData.agentId,
            date:            formData.date,                               // YYYY-MM-DD
            time:            formData.time || '09:00',                    // HH:MM
            notes:           '',
            status:          formData.status || 'confirmed'
        };

        console.log('📤 Enviando cita:', body);

        const response = await fetch('/api/appointments', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            console.error('❌ Respuesta del servidor:', errText);
            let err = {};
            try { err = JSON.parse(errText); } catch (e) {}
            throw new Error(err.details || err.error || err.message || errText || 'Error al crear la cita');
        }

        closeAppointmentModal();
        showNotification('✅ Cita creada exitosamente', 'success');
        await loadAppointments();
        updateStats();
        renderAppointments();

    } catch (error) {
        console.error('❌ Error al crear cita:', error);
        showNotification(`❌ ${error.message || 'Error al crear la cita'}`, 'error');
        submitBtn.innerHTML = originalHTML;
        submitBtn.disabled = false;
    }
}

// ==========================================
// DROPDOWNS PERSONALIZADOS
// ==========================================

function setupCustomDropdown(wrapper, display, hidden, placeholder, defaultValue = '') {
    display.onclick = function (e) {
        e.stopPropagation();
        document.querySelectorAll('.custom-dropdown-wrapper.active').forEach(w => {
            if (w !== wrapper) w.classList.remove('active');
        });
        wrapper.classList.toggle('active');
    };

    const menu = wrapper.querySelector('.dropdown-menu');
    menu.onclick = function (e) {
        const option = e.target.closest('.dropdown-option');
        if (!option) return;
        e.stopPropagation();

        const value = option.getAttribute('data-value');
        if (!value) return;

        const text = option.querySelector('span').innerText;
        display.value = text;
        hidden.value = value;

        wrapper.querySelectorAll('.dropdown-option').forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');
        wrapper.classList.remove('active');
    };

    document.addEventListener('click', function (e) {
        if (!wrapper.contains(e.target)) {
            wrapper.classList.remove('active');
        }
    });

    if (defaultValue) {
        hidden.value = defaultValue;
    } else {
        display.placeholder = placeholder;
    }
}

function initAgentDropdown() {
    const wrapper = document.getElementById('agentDropdownWrapper');
    const display = document.getElementById('agentSelectDisplay');
    const hidden = document.getElementById('agentSelect');
    const container = document.getElementById('agentOptions');

    if (!wrapper || !display || !container) return;

    container.innerHTML = '';

    if (agents && agents.length > 0) {
        agents.forEach(agent => {
            const div = document.createElement('div');
            div.className = 'dropdown-option';
            div.setAttribute('data-value', agent.id);
            div.innerHTML = `<i class="lni lni-database"></i> <span>${agent.name}</span>`;
            container.appendChild(div);
        });
    } else {
        container.innerHTML = `<div class="dropdown-option"><span>${t('agents_loading', 'Cargando agentes...')}</span></div>`;
    }

    setupCustomDropdown(wrapper, display, hidden, t('appts_filter_all_agents', 'Selecciona un agente'));
}

function initTimeDropdown() {
    const wrapper = document.getElementById('timeDropdownWrapper');
    const display = document.getElementById('timeSelectDisplay');
    const hidden = document.getElementById('appointmentTime');
    const container = document.getElementById('timeOptions');

    if (!wrapper || !display || !container) return;

    container.innerHTML = '';
    for (let h = 0; h < 24; h++) {
        for (let m = 0; m < 60; m += 15) {
            const h24 = String(h).padStart(2, '0');
            const mStr = String(m).padStart(2, '0');
            const val = `${h24}:${mStr}`;

            const h12 = h === 0 ? 12 : (h > 12 ? h - 12 : h);
            const ampm = h >= 12 ? 'PM' : 'AM';
            const label = `${String(h12).padStart(2, '0')}:${mStr} ${ampm}`;

            const div = document.createElement('div');
            div.className = 'dropdown-option';
            div.setAttribute('data-value', val);
            div.innerHTML = `<i class="lni lni-clock"></i> <span>${label}</span>`;
            container.appendChild(div);
        }
    }

    const now = new Date();
    const curH = String(now.getHours()).padStart(2, '0');
    const curM = String(Math.ceil(now.getMinutes() / 15) * 15).padStart(2, '0');
    const defVal = `${curH}:${curM === '60' ? '00' : curM}`;

    setupCustomDropdown(wrapper, display, hidden, 'Selecciona hora', defVal);
}

function initStatusDropdown() {
    const wrapper = document.getElementById('statusDropdownWrapper');
    const display = document.getElementById('statusSelectDisplay');
    const hidden = document.getElementById('appointmentStatus');
    if (!wrapper) return;
    setupCustomDropdown(wrapper, display, hidden, 'Selecciona estado', 'confirmed');
}

// ==========================================
// CARGA DE DATOS
// ==========================================

async function loadAgents() {
    try {
        const response = await fetch('/api/agents', { credentials: 'include' });
        if (!response.ok) throw new Error('Error API Agentes');
        const data = await response.json();
        if (data.agents) {
            agents = data.agents;
            populateAgentFilter();
        }
    } catch (error) {
        console.warn('⚠️ Fallo carga de agentes, usando backup local.');
        agents = [
            { id: 1, name: 'Respaldo 1' },
            { id: 2, name: 'Respaldo 2' }
        ];
        populateAgentFilter();
    }
}

function populateAgentFilter() {
    const filter = document.getElementById('agentFilter');
    if (!filter) return;

    while (filter.options.length > 1) filter.remove(1);

    agents.forEach(agent => {
        const opt = document.createElement('option');
        opt.value = agent.id;
        opt.textContent = agent.name;
        filter.appendChild(opt);
    });
}

async function loadAppointments() {
    try {
        const response = await fetch('/api/appointments', { credentials: 'include' });
        if (!response.ok) throw new Error('Error API Citas');
        const data = await response.json();
        // El backend devuelve { appointments: [...] } con:
        // id (string numérico real del DB), client, phone, service, worker,
        // date (YYYY-MM-DD), time (HH:MM), status, agentId, agentName, source, sheetUrl, sheetCell
        appointments = (data.appointments || []).map(a => ({
            ...a,
            // Asegurar que el id sea siempre el numérico de BD (no el sheetCell)
            id: a.id,
            // Guardar sheetCell por separado para no confundirlo con el id
            sheetCell: a.sheetCell || ''
        }));
        if (appointments.length === 0) showEmptyState();
        else hideEmptyState();
    } catch (error) {
        console.error('❌ Error cargando citas:', error);
        appointments = [];
        showEmptyState();
    }
}

// ==========================================
// RENDERIZADO
// ==========================================

function showEmptyState() {
    const empty = document.getElementById('emptyState');
    const list = document.getElementById('appointmentsList');
    const container = document.getElementById('appointmentsListView');
    if (empty) empty.style.display = 'flex';
    if (list) list.innerHTML = '';
    if (container) container.style.display = 'none';
}

function hideEmptyState() {
    const empty = document.getElementById('emptyState');
    const container = document.getElementById('appointmentsListView');
    if (empty) empty.style.display = 'none';
    if (container) container.style.display = 'block';
}

function updateStats() {
    const today = new Date().toISOString().split('T')[0];
    const todayCount = appointments.filter(a => a.date === today).length;
    const cancelled = appointments.filter(a => a.status === 'cancelled').length;
    const confirmed = appointments.filter(a => a.status === 'confirmed').length;
    const total = appointments.length;

    if (document.getElementById('totalAppointments')) document.getElementById('totalAppointments').textContent = todayCount;
    if (document.getElementById('confirmedAppointments')) document.getElementById('confirmedAppointments').textContent = confirmed;
    if (document.getElementById('pendingAppointments')) document.getElementById('pendingAppointments').textContent = cancelled;
    if (document.getElementById('totalClients')) document.getElementById('totalClients').textContent = total;
}

function filterAppointments() {
    let filtered = [...appointments];

    if (currentFilters.status !== 'all') {
        filtered = filtered.filter(a => a.status === currentFilters.status);
    }

    if (currentFilters.agent !== 'all') {
        filtered = filtered.filter(a => a.agentId === parseInt(currentFilters.agent));
    }

    if (currentFilters.date !== 'all') {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        filtered = filtered.filter(a => {
            const d = new Date(a.date);
            d.setHours(0, 0, 0, 0);
            const dTime = d.getTime();
            const tTime = today.getTime();

            switch (currentFilters.date) {
                case 'today': return dTime === tTime;
                case 'tomorrow': return dTime === tTime + 86400000;
                case 'week': return dTime >= tTime && dTime <= tTime + (86400000 * 7);
                case 'month':
                    return d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
                default: return true;
            }
        });
    }

    if (currentFilters.search) {
        const s = currentFilters.search;
        filtered = filtered.filter(a =>
            a.client.toLowerCase().includes(s) ||
            a.service.toLowerCase().includes(s) ||
            (a.phone && a.phone.includes(s))
        );
    }

    return filtered;
}

function renderAppointments() {
    const filtered = filterAppointments();
    const list = document.getElementById('appointmentsList');
    const container = document.getElementById('appointmentsListView');

    if (!list) return;

    // Show/hide table container vs empty state
    if (appointments.length === 0) {
        showEmptyState();
        if (container) container.style.display = 'none';
        return;
    }

    hideEmptyState();
    if (container) container.style.display = 'block';

    if (filtered.length === 0) {
        list.innerHTML = `
            <tr><td colspan="9" style="text-align: center; padding: 3rem; color: #6b7280;">
                <i class="lni lni-search-alt" style="font-size: 3rem; opacity: 0.5; display:block; margin-bottom:0.5rem;"></i>
                <p>No se encontraron citas con estos filtros</p>
            </td></tr>`;
        return;
    }

    filtered.sort((a, b) => new Date(b.date + ' ' + b.time) - new Date(a.date + ' ' + a.time));

    list.innerHTML = filtered.map(createTableRow).join('');
}

function createTableRow(appt) {
    const agent = agents.find(a => a.id === appt.agentId);
    const agentName = agent ? agent.name : (appt.agentName || t('ad_not_configured', 'Desconocido'));

    const [y, m, d] = appt.date.split('-');
    const dateObj = new Date(y, m - 1, d);
    const dateStr = dateObj.toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' });

    return `
        <tr>
            <td>
                <div class="table-client"><i class="lni lni-user"></i> <span>${escapeHtml(appt.client)}</span></div>
            </td>
            <td>
                <div class="table-phone">${appt.phone ? `<a href="tel:${appt.phone}">${escapeHtml(appt.phone)}</a>` : '-'}</div>
            </td>
            <td><div class="table-service">${escapeHtml(appt.service)}</div></td>
            <td>
                ${appt.worker ? `<div class="table-worker"><i class="lni lni-user"></i> ${escapeHtml(appt.worker)}</div>` : '-'}
            </td>
            <td><div class="table-date">${dateStr}</div></td>
            <td><div class="table-time">${formatTime(appt.time)}</div></td>
            <td>
                <div class="agent-tag">
                    <span class="agent-tag-icon"><i class="lni lni-database"></i></span>
                    ${escapeHtml(agentName)}
                </div>
            </td>
            <td><span class="appointment-status status-${appt.status}">${getStatusText(appt.status)}</span></td>
            <td>
                <div class="actions-dropdown">
                    <button class="actions-btn" onclick="toggleDropdown(event, ${appt.id})">
                        <i class="lni lni-more-alt"></i>
                    </button>
                    <div class="actions-menu" id="dropdown-${appt.id}">
                        ${appt.sheetUrl ? `<div class="action-item sheet" onclick="openGoogleSheet('${appt.sheetUrl}')"><i class="lni lni-text-format"></i> Ver Sheet</div>` : ''}
                        ${appt.phone ? `<div class="action-item whatsapp" onclick="sendWhatsApp('${appt.phone}', '${escapeHtml(appt.client)}')"><i class="lni lni-whatsapp"></i> WhatsApp</div>` : ''}
                        ${appt.status !== 'completed' ? `<div class="action-item complete" onclick="updateAppointmentStatus(${appt.id}, 'completed')"><i class="lni lni-checkmark-circle"></i> Marcar Completada</div>` : ''}
                        ${appt.status !== 'cancelled' ? `<div class="action-item cancel" onclick="updateAppointmentStatus(${appt.id}, 'cancelled')"><i class="lni lni-ban"></i> Marcar Cancelada</div>` : ''}
                        <div class="action-item delete" onclick="deleteAppointment(${appt.id}, '${escapeHtml(appt.client)}')"><i class="lni lni-trash-can"></i> Eliminar</div>
                    </div>
                </div>
            </td>
        </tr>
    `;
}

// ==========================================
// CALENDARIO
// ==========================================
let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();

function toggleView() {
    const list = document.getElementById('appointmentsListView');
    const cal = document.getElementById('calendarView');

    if (currentView === 'list') {
        list.style.display = 'block';
        cal.style.display = 'none';
    } else {
        list.style.display = 'none';
        cal.style.display = 'block';
        renderCalendar();
    }
}

function renderCalendar() {
    const grid = document.getElementById('calendarGrid');
    const title = document.getElementById('calendarMonth');
    if (!grid) return;

    const months = [t('month_jan','Enero'),t('month_feb','Febrero'),t('month_mar','Marzo'),t('month_apr','Abril'),t('month_may','Mayo'),t('month_jun','Junio'),t('month_jul','Julio'),t('month_aug','Agosto'),t('month_sep','Septiembre'),t('month_oct','Octubre'),t('month_nov','Noviembre'),t('month_dec','Diciembre')];
    title.textContent = `${months[currentMonth]} ${currentYear}`;
    grid.innerHTML = '';

    [t('day_sun','Dom'),t('day_mon','Lun'),t('day_tue','Mar'),t('day_wed','Mié'),t('day_thu','Jue'),t('day_fri','Vie'),t('day_sat','Sáb')].forEach(d => {
        const div = document.createElement('div');
        div.className = 'calendar-day-header';
        div.textContent = d;
        grid.appendChild(div);
    });

    const firstDay = new Date(currentYear, currentMonth, 1).getDay();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

    for (let i = 0; i < firstDay; i++) grid.appendChild(document.createElement('div'));

    for (let d = 1; d <= daysInMonth; d++) {
        const cell = document.createElement('div');
        cell.className = 'calendar-day';

        const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const count = appointments.filter(a => a.date === dateStr).length;

        if (count > 0) {
            cell.classList.add('has-appointments');
            cell.onclick = () => showDayAppointments(dateStr);
        }

        cell.innerHTML = `<div class="calendar-day-number">${d}</div>` +
            (count > 0 ? `<div class="calendar-day-count">${count}</div>` : '');
        grid.appendChild(cell);
    }
}

function changeMonth(delta) {
    currentMonth += delta;
    if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    else if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    renderCalendar();
}

function showDayAppointments(dateStr) {
    const modal = document.getElementById('appointmentModal');
    const title = document.getElementById('modalTitle');
    const body = document.getElementById('modalBody');

    const d = new Date(dateStr);
    title.textContent = `Citas: ${d.toLocaleDateString('es-MX')}`;

    const dayAppts = appointments.filter(a => a.date === dateStr);
    dayAppts.sort((a, b) => a.time.localeCompare(b.time));

    body.innerHTML = `<div style="display:flex; flex-direction:column; gap:1rem;">` +
        dayAppts.map(a => `
            <div style="padding:1rem; border:1px solid #eee; border-radius:8px; background:#f9fafb;">
                <strong>${formatTime(a.time)}</strong> - ${escapeHtml(a.client)}<br>
                <small>${escapeHtml(a.service)}</small>
            </div>
        `).join('') + `</div>
        <div class="form-actions" style="margin-top:1rem;">
            <button class="btn-cancel" onclick="closeAppointmentModal()">Cerrar</button>
        </div>`;

    modal.classList.add('active');
}

// ==========================================
// UTILIDADES Y ACCIONES
// ==========================================

function toggleDropdown(event, id) {
    event.stopPropagation();
    const el = document.getElementById(`dropdown-${id}`);
    if (!el) return;
    if (openDropdown && openDropdown !== el) openDropdown.classList.remove('active');
    el.classList.toggle('active');
    openDropdown = el.classList.contains('active') ? el : null;
}

function closeAllDropdowns() {
    document.querySelectorAll('.actions-menu').forEach(m => m.classList.remove('active'));
    openDropdown = null;
}

function openGoogleSheet(url) {
    window.open(url, '_blank');
    closeAllDropdowns();
}


async function updateAppointmentStatus(id, newStatus) {
    const labels = { completed: 'completada', cancelled: 'cancelada' };
    closeAllDropdowns();
    try {
        // Ruta correcta del backend: PATCH /api/appointments/:id/status
        const response = await fetch(`/api/appointments/${id}/status`, {
            method: 'PATCH',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus })
        });

        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            console.error(`❌ PATCH /api/appointments/${id}/status → ${response.status}:`, errText);
            let err = {};
            try { err = JSON.parse(errText); } catch (e) {}
            throw new Error(err.error || err.message || `Error ${response.status}`);
        }

        showNotification(`Cita marcada como ${labels[newStatus]}`, 'success');
        await loadAppointments();
        updateStats();
        renderAppointments();
    } catch (err) {
        console.error('❌ Error updating appointment status:', err);
        showNotification(`Error al actualizar el estado: ${err.message}`, 'error');
    }
}

function deleteAppointment(id, clientName) {
    closeAllDropdowns();
    showConfirmModal({
        type: 'danger',
        icon: 'lni-trash-can',
        title: '¿Eliminar Cita?',
        message: `Estás a punto de eliminar la cita de <strong>${clientName}</strong>`,
        list: [
            'Esta acción no se puede deshacer',
            'Se perderán todos los datos de la cita'
        ],
        confirmText: t('appts_delete_btn', 'Eliminar Cita'),
        confirmClass: 'danger',
        onConfirm: async () => {
            const response = await fetch(`/api/appointments/${id}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            if (!response.ok) throw new Error('Error al eliminar');
            showNotification(t('appts_deleted_ok', 'Cita eliminada correctamente'), 'success');
            await loadAppointments();
            updateStats();
            renderAppointments();
        }
    });
}

function sendWhatsApp(phone, name) {
    const num = phone.replace(/\D/g, '');
    const msg = encodeURIComponent(`Hola ${name}, te contacto respecto a tu cita.`);
    window.open(`https://wa.me/${num}?text=${msg}`, '_blank');
    closeAllDropdowns();
}

function formatTime(t) {
    if (!t) return '';
    const [h, m] = t.split(':');
    const hh = parseInt(h);
    const ampm = hh >= 12 ? 'PM' : 'AM';
    const h12 = hh > 12 ? hh - 12 : (hh === 0 ? 12 : hh);
    return `${h12}:${m} ${ampm}`;
}

function getStatusText(s) {
    const map = { confirmed: t('appts_status_confirmed', 'Confirmada'), pending: t('appts_status_pending', 'Pendiente'), cancelled: t('appts_status_cancelled', 'Cancelada'), completed: t('appts_status_completed', 'Completada') };
    return map[s] || s;
}

function escapeHtml(text) {
    if (!text) return '';
    return String(text).replace(/[&<>"']/g, function (m) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
    });
}

// ── Modal de Confirmación ──────────────────────────────────
function showConfirmModal(options) {
    const {
        type = 'warning',
        icon = 'lni-warning',
        title = '¿Estás seguro?',
        message = '',
        list = [],
        confirmText = 'Confirmar',
        confirmClass = 'danger',
        onConfirm = () => {}
    } = options;

    let modal = document.getElementById('confirmModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'confirmModal';
        modal.className = 'confirm-modal';
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <div class="confirm-overlay" onclick="closeConfirmModal()"></div>
        <div class="confirm-content">
            <div class="confirm-header">
                <div class="confirm-icon ${type}">
                    <i class="lni ${icon}"></i>
                </div>
                <h3 class="confirm-title">${title}</h3>
                <p class="confirm-message">${message}</p>
            </div>
            <div class="confirm-body">
                ${list.length > 0 ? `
                    <div class="confirm-list">
                        ${list.map(item => `
                            <div class="confirm-list-item">
                                <i class="lni lni-close"></i>
                                <span>${item}</span>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}
                <div class="confirm-actions">
                    <button class="btn-confirm-cancel" onclick="closeConfirmModal()">
                        <i class="lni lni-close"></i>
                        <span>Cancelar</span>
                    </button>
                    <button class="btn-confirm-action ${confirmClass}" id="confirmActionBtn">
                        <i class="lni lni-checkmark"></i>
                        <span>${confirmText}</span>
                    </button>
                </div>
            </div>
        </div>
    `;

    modal.classList.add('active');

    document.getElementById('confirmActionBtn').addEventListener('click', async function () {
        this.innerHTML = `<div class="loading-spinner-small"></div><span>Procesando...</span>`;
        this.disabled = true;
        try {
            await onConfirm();
            closeConfirmModal();
        } catch (error) {
            console.error('Error en confirmación:', error);
            this.disabled = false;
            this.innerHTML = `<i class="lni lni-checkmark"></i><span>${confirmText}</span>`;
            showNotification('Ocurrió un error, intenta de nuevo', 'error');
        }
    });
}

function closeConfirmModal() {
    const modal = document.getElementById('confirmModal');
    if (modal) {
        modal.classList.remove('active');
        setTimeout(() => modal.remove(), 300);
    }
}

function showNotification(message, type = 'info') {
    const titles = {
        success: 'Listo',
        error:   'Error',
        warning: 'Aviso',
        info:    'Información'
    };
    const opts = { title: titles[type] || 'Aviso', description: message };
    if (typeof Sileo !== 'undefined' && Sileo[type]) {
        Sileo[type](opts);
    } else {
        // fallback si Sileo no cargó aún
        const color = type === 'success' ? '#10b981' : (type === 'error' ? '#ef4444' : '#06b6d4');
        const div = document.createElement('div');
        div.style.cssText = `position:fixed;top:1.5rem;left:50%;transform:translateX(-50%);background:white;color:#18181b;padding:.75rem 1.25rem;border-radius:20px;z-index:10000;font-weight:600;font-size:.875rem;box-shadow:0 8px 32px rgba(0,0,0,0.10);border:1px solid rgba(0,0,0,0.08);display:flex;align-items:center;gap:.5rem;`;
        div.innerHTML = `<span style="background:color-mix(in srgb,${color} 20%,transparent);color:${color};border-radius:9999px;width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-size:.75rem;">●</span><span>${message}</span>`;
        document.body.appendChild(div);
        setTimeout(() => { div.style.opacity='0'; div.style.transition='opacity .3s'; setTimeout(()=>div.remove(),300); }, 3000);
    }
}

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

// ============================================================================
// CORRECCIÓN DEL SIDEBAR — los modales viven dentro de .main-content, que
// crea su propio nivel de apilamiento (z-index: 1); por eso el sidebar quedaba
// encima del fondo oscuro. Se mueven a <body> para que cubran todo.
// ============================================================================
(function () {
    function lift() {
        document.querySelectorAll('.app-container .modal, .app-container .confirm-modal').forEach((m) => document.body.appendChild(m));
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', lift);
    else lift();
})();

// ============================================================================
// CALENDARIO iOS 27
// Sustituye el calendario nativo de cualquier <input type="date"> de la
// página (el del modal de Mis Citas y el del POS). El input sigue siendo
// el mismo: su valor es AAAA-MM-DD, respeta min/max y dispara input/change.
// ============================================================================
(function () {
    const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    const WEEK = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
    const pad = (n) => String(n).padStart(2, '0');
    const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const parse = (s) => {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
        return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
    };
    const ICON = '<svg class="ios-date-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="4"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>';
    const CHEV = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;

    let pop = null, input = null, view = null;

    function enhance(el) {
        if (el.classList.contains('ios-date')) return;
        el.classList.add('ios-date');
        if (!el.parentElement.classList.contains('ios-date-wrap')) {
            const wrap = document.createElement('span');
            wrap.className = 'ios-date-wrap';
            if (el.style.flex) wrap.style.flex = el.style.flex;
            el.parentNode.insertBefore(wrap, el);
            wrap.appendChild(el);
            wrap.insertAdjacentHTML('beforeend', ICON);
        }
    }

    function scan(root) {
        (root.querySelectorAll ? root : document).querySelectorAll('input[type="date"]').forEach(enhance);
    }

    function build() {
        pop = document.createElement('div');
        pop.className = 'ios-cal';
        pop.setAttribute('role', 'dialog');
        pop.setAttribute('aria-label', 'Elegir fecha');
        pop.innerHTML = `
            <div class="ios-cal-head">
                <div class="ios-cal-title"><span></span></div>
                <div class="ios-cal-nav">
                    <button type="button" class="ios-cal-prev" aria-label="Mes anterior">${CHEV('m15 18-6-6 6-6')}</button>
                    <button type="button" class="ios-cal-next" aria-label="Mes siguiente">${CHEV('m9 18 6-6-6-6')}</button>
                </div>
            </div>
            <div class="ios-cal-week">${WEEK.map((w) => `<span>${w}</span>`).join('')}</div>
            <div class="ios-cal-body"><div class="ios-cal-grid"></div></div>
            <div class="ios-cal-foot">
                <button type="button" class="ios-cal-clear">Borrar</button>
                <button type="button" class="ios-cal-today">Hoy</button>
            </div>`;
        pop.querySelector('.ios-cal-prev').addEventListener('click', () => go(-1));
        pop.querySelector('.ios-cal-next').addEventListener('click', () => go(1));
        pop.querySelector('.ios-cal-today').addEventListener('click', () => pick(new Date()));
        pop.querySelector('.ios-cal-clear').addEventListener('click', () => { if (!input.required) commit(''); else close(); });
        pop.querySelector('.ios-cal-grid').addEventListener('click', (e) => {
            const b = e.target.closest('.ios-cal-day');
            if (b) pick(parse(b.dataset.date));
        });
        // Deslizar con el dedo para cambiar de mes
        let x0 = null;
        pop.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
        pop.addEventListener('touchend', (e) => {
            if (x0 === null) return;
            const dx = e.changedTouches[0].clientX - x0;
            if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
            x0 = null;
        });
        document.body.appendChild(pop);
    }

    function bounds() {
        return { min: parse(input.min), max: parse(input.max) };
    }

    function render(dir) {
        const { min, max } = bounds();
        const sel = parse(input.value);
        const today = toISO(new Date());
        const y = view.getFullYear(), m = view.getMonth();
        const first = new Date(y, m, 1);
        const offset = (first.getDay() + 6) % 7; // lunes primero
        const start = new Date(y, m, 1 - offset);
        let html = '';
        for (let i = 0; i < 42; i++) {
            const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
            const iso = toISO(d);
            const cls = ['ios-cal-day'];
            if (d.getMonth() !== m) cls.push('is-out');
            if (iso === today) cls.push('is-today');
            if (sel && iso === toISO(sel)) cls.push('is-selected');
            if ((min && d < min) || (max && d > max)) cls.push('is-disabled');
            html += `<button type="button" class="${cls.join(' ')}" data-date="${iso}" aria-label="${d.getDate()} de ${MONTHS[d.getMonth()]}"><span>${d.getDate()}</span></button>`;
        }
        const grid = pop.querySelector('.ios-cal-grid');
        grid.innerHTML = html;
        const title = pop.querySelector('.ios-cal-title span');
        title.textContent = `${MONTHS[m][0].toUpperCase()}${MONTHS[m].slice(1)} de ${y}`;
        [grid, title].forEach((el) => {
            el.classList.remove('slide-next', 'slide-prev');
            if (dir) { void el.offsetWidth; el.classList.add(dir > 0 ? 'slide-next' : 'slide-prev'); }
        });
        pop.querySelector('.ios-cal-prev').disabled = !!(min && new Date(y, m, 0) < min);
        pop.querySelector('.ios-cal-next').disabled = !!(max && new Date(y, m + 1, 1) > max);
    }

    function go(dir) {
        view = new Date(view.getFullYear(), view.getMonth() + dir, 1);
        render(dir);
    }

    function place() {
        const r = input.getBoundingClientRect();
        const sheet = window.innerWidth <= 480;
        pop.classList.toggle('is-sheet', sheet);
        if (sheet) return;
        const w = pop.offsetWidth, h = pop.offsetHeight;
        let left = Math.min(Math.max(12, r.left), window.innerWidth - w - 12);
        let top = r.bottom + 8;
        let oy = '0%';
        if (top + h > window.innerHeight - 12 && r.top - h - 8 > 12) { top = r.top - h - 8; oy = '100%'; }
        pop.style.left = `${left}px`;
        pop.style.top = `${Math.max(12, top)}px`;
        pop.style.setProperty('--ox', `${Math.min(Math.max(r.left + 30 - left, 0), w)}px`);
        pop.style.setProperty('--oy', oy);
    }

    function open(el) {
        if (input === el && pop && !pop.classList.contains('is-closing')) return;
        if (pop) pop.remove();
        input = el;
        build();
        const sel = parse(input.value) || bounds().min || new Date();
        view = new Date(sel.getFullYear(), sel.getMonth(), 1);
        render(0);
        place();
        input.closest('.ios-date-wrap')?.classList.add('is-open');
    }

    function close() {
        if (!pop) return;
        const p = pop, el = input;
        pop = null; input = null;
        el?.closest('.ios-date-wrap')?.classList.remove('is-open');
        p.classList.add('is-closing');
        setTimeout(() => p.remove(), 220);
    }

    function commit(value) {
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        close();
    }

    function pick(d) {
        if (!d) return;
        const { min, max } = bounds();
        if ((min && d < min) || (max && d > max)) return;
        if (view.getMonth() !== d.getMonth() || view.getFullYear() !== d.getFullYear()) {
            const dir = d > view ? 1 : -1;
            view = new Date(d.getFullYear(), d.getMonth(), 1);
            const prev = input.value;
            input.value = toISO(d);
            render(dir);
            input.value = prev;
        } else {
            pop.querySelectorAll('.ios-cal-day.is-selected').forEach((b) => b.classList.remove('is-selected'));
            pop.querySelector(`.ios-cal-day[data-date="${toISO(d)}"]`)?.classList.add('is-selected');
        }
        if (navigator.vibrate) navigator.vibrate(6);
        const v = toISO(d);
        setTimeout(() => { if (input) commit(v); }, 160);
    }

    // Abrir con clic (evita el calendario nativo) o con Enter/Espacio/Alt+↓
    document.addEventListener('mousedown', (e) => {
        const el = e.target.closest && e.target.closest('input[type="date"].ios-date');
        if (el) { e.preventDefault(); open(el); return; }
        if (pop && !pop.contains(e.target)) close();
    }, true);
    document.addEventListener('touchstart', (e) => {
        const el = e.target.closest && e.target.closest('input[type="date"].ios-date');
        if (el) return;
        if (pop && !pop.contains(e.target)) close();
    }, { passive: true, capture: true });
    document.addEventListener('click', (e) => {
        const el = e.target.closest && e.target.closest('input[type="date"].ios-date');
        if (el) { e.preventDefault(); open(el); }
    }, true);
    document.addEventListener('keydown', (e) => {
        if (pop && e.key === 'Escape') { e.stopPropagation(); close(); return; }
        const el = e.target.closest && e.target.closest('input[type="date"].ios-date');
        if (el && (e.key === 'Enter' || e.key === ' ' || (e.altKey && e.key === 'ArrowDown'))) { e.preventDefault(); open(el); }
    }, true);
    window.addEventListener('resize', () => { if (pop) place(); });
    document.addEventListener('scroll', (e) => { if (pop && !pop.contains(e.target)) place(); }, true);

    // Los campos de fecha del modal se crean por JS: se detectan al aparecer
    scan(document);
    new MutationObserver((muts) => muts.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1) scan(n); })))
        .observe(document.body, { childList: true, subtree: true });
})();