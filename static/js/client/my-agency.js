// ============================================
// MY-AGENCY JS
// ============================================

let branches = [];
let activeBranchId = null;

document.addEventListener('DOMContentLoaded', function () {
    console.log('🏛️ Mi Dependencia JS cargado');
    initTabs();
    initBranchSelector();
    initGovLevelSelect();
    initSchedule();
    initHolidays();
    initSedes();
    initCursos();
    initSaveButton();
    console.log('✅ Mi Dependencia inicializada');
});

// ============================================
// DATA
// ============================================

const STATES_MEXICO = [
    'Aguascalientes','Baja California','Baja California Sur','Campeche','Chiapas',
    'Chihuahua','Ciudad de México','Coahuila','Colima','Durango','Guanajuato',
    'Guerrero','Hidalgo','Jalisco','México','Michoacán','Morelos','Nayarit',
    'Nuevo León','Oaxaca','Puebla','Querétaro','Quintana Roo','San Luis Potosí',
    'Sinaloa','Sonora','Tabasco','Tamaulipas','Tlaxcala','Veracruz','Yucatán','Zacatecas'
];

const MONTHS = [
    { value:'01',name:'Enero' },{ value:'02',name:'Febrero' },{ value:'03',name:'Marzo' },
    { value:'04',name:'Abril' },{ value:'05',name:'Mayo' },  { value:'06',name:'Junio' },
    { value:'07',name:'Julio' },{ value:'08',name:'Agosto' },{ value:'09',name:'Septiembre' },
    { value:'10',name:'Octubre' },{ value:'11',name:'Noviembre' },{ value:'12',name:'Diciembre' }
];

// ============================================
// TABS
// ============================================

function initTabs() {
    document.querySelectorAll('.page-tab').forEach(tab => {
        tab.addEventListener('click', function () {
            document.querySelectorAll('.page-tab').forEach(t => t.classList.remove('active'));
            this.classList.add('active');
            const target = this.dataset.tab;
            document.querySelectorAll('.page-tab-panel').forEach(panel => {
                const show = panel.id === 'tab-' + target;
                panel.style.display = show ? '' : 'none';
                panel.classList.toggle('active', show);
            });
            if (target === 'base-datos') loadBaseDatos();
        });
    });
}

// ============================================
// BRANCH SELECTOR
// ============================================

async function initBranchSelector() {
    try {
        const res  = await fetch('/api/my-agency');
        const data = await res.json();
        branches = data.offices || data.branches || [];
        renderBranchList();
        if (data.activeBranch) {
            activeBranchId = data.activeBranch.id;
            loadBranchData(data.activeBranch);
        } else if (data.defaultBranch) {
            activeBranchId = 0;
            loadBranchData(data.defaultBranch);
        }
        const btn     = document.getElementById('branchDropdownBtn');
        const wrapper = document.getElementById('branchDropdownWrapper');
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            wrapper.classList.toggle('active');
            document.getElementById('branchChevron').style.transform =
                wrapper.classList.contains('active') ? 'rotate(180deg)' : '';
        });
        document.addEventListener('click', function(e) {
            if (!wrapper.contains(e.target)) wrapper.classList.remove('active');
        });
        document.getElementById('btnAddBranch')?.addEventListener('click', addNewBranch);
    } catch (err) {
        console.warn('initBranchSelector:', err);
    }
}

function renderBranchList() {
    const list = document.getElementById('branchList');
    list.innerHTML = '';
    branches.forEach(b => {
        const item = document.createElement('div');
        item.className = 'branch-item' + (b.id === activeBranchId ? ' active' : '');
        item.innerHTML = `<i class="lni lni-map-marker"></i><span>${b.officeName || b.name || 'Oficina ' + b.id}</span>`;
        item.addEventListener('click', () => switchBranch(b.id));
        list.appendChild(item);
    });
}

async function switchBranch(id) {
    try {
        const res  = await fetch(`/api/my-agency/${id}`);
        const data = await res.json();
        activeBranchId = id;
        loadBranchData(data);
        renderBranchList();
        document.getElementById('branchDropdownWrapper').classList.remove('active');
        showNotification('Oficina cargada', 'success');
    } catch { showNotification('Error al cargar la oficina', 'error'); }
}

async function addNewBranch() {
    try {
        const res  = await fetch('/api/my-agency/office', { method:'POST', credentials:'include' });
        const data = await res.json();
        branches.push(data.branch);
        await switchBranch(data.branch.id);
        renderBranchList();
        showNotification('Nueva oficina creada', 'success');
    } catch { showNotification('Error al crear la oficina', 'error'); }
}

// ============================================
// LOAD BRANCH DATA
// ============================================

function loadBranchData(data) {
    setVal('depNameInput',        data.depName);
    setVal('depAcronymInput',     data.depAcronym);
    setVal('depAreaInput',        data.depArea);
    setVal('depParentInput',      data.depParent);
    setVal('rfcInput',            data.rfc);
    setVal('depDescriptionInput', data.description);
    setVal('websiteInput',        data.website);
    setVal('emailInput',          data.email);
    setVal('phoneNumberInput',    data.phoneNumber);
    setVal('addressInput',        data.address);
    setVal('mapsLinkInput',       data.mapsLink);
    setVal('facebookInput',       data.facebook);
    setVal('instagramInput',      data.instagram);
    setVal('twitterInput',        data.twitter);
    setVal('youtubeInput',        data.youtube);
    setVal('linkedinInput',       data.linkedin);
    setVal('cityInput',           data.city);
    setVal('stateInput',          data.state);

    // Nivel de gobierno
    if (data.govLevel) setWrapperSelect('govLevelWrapper', 'govLevelInput', data.govLevel);

    // Horario
    if (data.schedule) applySchedule(data.schedule);

    // Días inhábiles
    document.getElementById('holidaysList').innerHTML = '';
    if (data.holidays) data.holidays.forEach(h => addHoliday(h));

    // Sedes
    renderSedes(data.sedes || []);

    // Cursos
    renderCursos(data.cursos || []);

    document.getElementById('branchDropdownLabel').textContent = data.officeName || data.name || 'Oficina';
    document.getElementById('branchBadge').textContent = data.officeName || data.name || 'Oficina activa';
}

function setVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val || '';
}

// Activa la clase .active en el wrapper y marca la opción seleccionada
function setWrapperSelect(wrapperId, inputId, value) {
    const wrapper = document.getElementById(wrapperId);
    const input   = document.getElementById(inputId);
    if (!wrapper || !input) return;
    const opt = wrapper.querySelector(`[data-value="${value}"]`);
    if (opt) {
        input.value = opt.querySelector('span')?.textContent || value;
        input.setAttribute('data-value', value);
        wrapper.querySelectorAll('.select-option').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
    }
}

// ============================================
// CUSTOM SELECT — mismo patrón que my-business
// (activa clase .active en el wrapper)
// ============================================

function initGovLevelSelect() {
    initWrapperDropdown('govLevelWrapper', 'govLevelInput');
}

function initWrapperDropdown(wrapperId, inputId) {
    const wrapper = document.getElementById(wrapperId);
    const input   = document.getElementById(inputId);
    if (!wrapper || !input) return;

    input.addEventListener('click', function(e) {
        e.stopPropagation();
        // Cerrar otros wrappers activos
        document.querySelectorAll('.custom-select-wrapper.active').forEach(w => {
            if (w !== wrapper) w.classList.remove('active');
        });
        wrapper.classList.toggle('active');
    });

    wrapper.querySelectorAll('.select-option').forEach(opt => {
        opt.addEventListener('click', function(e) {
            e.stopPropagation();
            input.value = this.querySelector('span')?.textContent || this.dataset.value;
            input.setAttribute('data-value', this.dataset.value);
            wrapper.querySelectorAll('.select-option').forEach(o => o.classList.remove('selected'));
            this.classList.add('selected');
            wrapper.classList.remove('active');
        });
    });

    document.addEventListener('click', function(e) {
        if (!wrapper.contains(e.target)) wrapper.classList.remove('active');
    });
}

// ============================================
// SCHEDULE — idéntico a my-business.js
// ============================================

const DAYS = [
    { name:'Lunes',    key:'monday' },
    { name:'Martes',   key:'tuesday' },
    { name:'Miércoles',key:'wednesday' },
    { name:'Jueves',   key:'thursday' },
    { name:'Viernes',  key:'friday' },
    { name:'Sábado',   key:'saturday' },
    { name:'Domingo',  key:'sunday' },
];

function initSchedule() {
    const scheduleList = document.getElementById('scheduleList');
    if (!scheduleList) return;
    scheduleList.innerHTML = '';

    DAYS.forEach(day => {
        const dayDiv = document.createElement('div');
        dayDiv.className = 'schedule-day';
        // Gobierno: Lun–Vie abiertos por defecto, Sáb y Dom cerrados
        const defaultOpen  = !['saturday','sunday'].includes(day.key);
        const defaultStart = '08:00';
        const defaultEnd   = '15:00';

        dayDiv.innerHTML = `
            <div class="day-name">${day.name}</div>
            <div class="day-toggle">
                <label class="toggle-switch">
                    <input type="checkbox" id="day-${day.key}" ${defaultOpen ? 'checked' : ''}>
                    <span class="toggle-slider"></span>
                </label>
                <span class="toggle-label">${defaultOpen ? 'Abierto' : 'Cerrado'}</span>
            </div>
            <div class="day-times">
                <input type="time" class="time-input" id="time-${day.key}-open"  value="${defaultStart}" style="display:none;">
                <span class="time-separator">-</span>
                <input type="time" class="time-input" id="time-${day.key}-close" value="${defaultEnd}"   style="display:none;">
            </div>
        `;
        if (!defaultOpen) dayDiv.classList.add('closed');
        scheduleList.appendChild(dayDiv);

        const checkbox = dayDiv.querySelector(`#day-${day.key}`);
        const label    = dayDiv.querySelector('.toggle-label');
        checkbox.addEventListener('change', function() {
            dayDiv.classList.toggle('closed', !this.checked);
            label.textContent = this.checked ? 'Abierto' : 'Cerrado';
        });

        createTimePicker(dayDiv.querySelector(`#time-${day.key}-open`),  defaultStart);
        createTimePicker(dayDiv.querySelector(`#time-${day.key}-close`), defaultEnd);
    });
}

function createTimePicker(input, defaultValue = '09:00') {
    const wrapper = document.createElement('div');
    wrapper.className = 'time-picker-wrapper';

    const convert24to12 = (t) => {
        const [h24, min] = t.split(':');
        const h = parseInt(h24);
        const period = h >= 12 ? 'PM' : 'AM';
        const h12 = h === 0 ? 12 : (h > 12 ? h - 12 : h);
        return { hours: String(h12).padStart(2,'0'), minutes: min, period };
    };
    const convert12to24 = (h12, min, period) => {
        let h = parseInt(h12);
        if (period === 'AM' && h === 12) h = 0;
        if (period === 'PM' && h !== 12) h += 12;
        return `${String(h).padStart(2,'0')}:${min}`;
    };

    const init = convert24to12(defaultValue);

    const display = document.createElement('div');
    display.className = 'time-input-display';
    display.innerHTML = `
        <span class="time-display-value">${init.hours}:${init.minutes} ${init.period}</span>
        <i class="lni lni-chevron-down" style="font-size:14px;color:#06b6d4;"></i>
    `;

    const dropdown = document.createElement('div');
    dropdown.className = 'time-dropdown';
    const content = document.createElement('div');
    content.className = 'time-dropdown-content';

    const mkCol = (title, id) => {
        const col = document.createElement('div');
        col.className = 'time-column';
        col.innerHTML = `<div class="time-column-title">${title}</div><div class="time-scroll" id="${id}"></div>`;
        return col;
    };

    const hourCol   = mkCol('Hora',    'h');
    const minCol    = mkCol('Min',     'm');
    const periodCol = mkCol('Periodo', 'p');

    const hourScroll   = hourCol.querySelector('#h');
    const minScroll    = minCol.querySelector('#m');
    const periodScroll = periodCol.querySelector('#p');

    for (let i = 1; i <= 12; i++) {
        const o = document.createElement('div');
        o.className = 'time-option';
        o.textContent = o.dataset.value = String(i).padStart(2,'0');
        hourScroll.appendChild(o);
    }
    [0,15,30,45].forEach(m => {
        const o = document.createElement('div');
        o.className = 'time-option';
        o.textContent = o.dataset.value = String(m).padStart(2,'0');
        minScroll.appendChild(o);
    });
    ['AM','PM'].forEach(p => {
        const o = document.createElement('div');
        o.className = 'time-option';
        o.textContent = o.dataset.value = p;
        periodScroll.appendChild(o);
    });

    content.append(hourCol, minCol, periodCol);
    dropdown.appendChild(content);
    wrapper.append(display, dropdown);
    input.parentNode.insertBefore(wrapper, input);
    input.style.display = 'none';
    input.value = defaultValue;

    let selH = init.hours, selM = init.minutes, selP = init.period;

    hourScroll.querySelector(`[data-value="${selH}"]`)?.classList.add('selected');
    minScroll.querySelector(`[data-value="${selM}"]`)?.classList.add('selected');
    periodScroll.querySelector(`[data-value="${selP}"]`)?.classList.add('selected');

    display.addEventListener('click', function(e) {
        e.stopPropagation();
        const isOpen = dropdown.classList.contains('show');
        document.querySelectorAll('.time-dropdown.show').forEach(d => d.classList.remove('show'));
        document.querySelectorAll('.time-input-display.active').forEach(d => d.classList.remove('active'));
        if (!isOpen) { dropdown.classList.add('show'); display.classList.add('active'); }
    });

    const updateTime = () => {
        display.querySelector('.time-display-value').textContent = `${selH}:${selM} ${selP}`;
        input.value = convert12to24(selH, selM, selP);
    };

    hourScroll.addEventListener('click', e => {
        if (!e.target.classList.contains('time-option')) return;
        hourScroll.querySelectorAll('.time-option').forEach(o => o.classList.remove('selected'));
        e.target.classList.add('selected');
        selH = e.target.dataset.value;
        updateTime();
    });
    minScroll.addEventListener('click', e => {
        if (!e.target.classList.contains('time-option')) return;
        minScroll.querySelectorAll('.time-option').forEach(o => o.classList.remove('selected'));
        e.target.classList.add('selected');
        selM = e.target.dataset.value;
        updateTime();
    });
    periodScroll.addEventListener('click', e => {
        if (!e.target.classList.contains('time-option')) return;
        periodScroll.querySelectorAll('.time-option').forEach(o => o.classList.remove('selected'));
        e.target.classList.add('selected');
        selP = e.target.dataset.value;
        updateTime();
    });
    document.addEventListener('click', e => {
        if (!wrapper.contains(e.target)) {
            dropdown.classList.remove('show');
            display.classList.remove('active');
        }
    });

    wrapper._setTime = function(time24) {
        if (!time24) return;
        const t = convert24to12(time24);
        selH = t.hours; selM = t.minutes; selP = t.period;
        hourScroll.querySelectorAll('.time-option').forEach(o =>
            o.classList.toggle('selected', o.dataset.value === selH));
        minScroll.querySelectorAll('.time-option').forEach(o =>
            o.classList.toggle('selected', o.dataset.value === selM));
        periodScroll.querySelectorAll('.time-option').forEach(o =>
            o.classList.toggle('selected', o.dataset.value === selP));
        display.querySelector('.time-display-value').textContent = `${selH}:${selM} ${selP}`;
        input.value = time24;
    };
}

function applySchedule(schedule) {
    // schedule puede ser objeto {monday:{isOpen,open,close}} o array [{day,open,start,end}]
    const map = {};
    if (Array.isArray(schedule)) {
        schedule.forEach(s => { map[s.day] = { isOpen: s.open, start: s.start, end: s.end }; });
    } else {
        Object.entries(schedule).forEach(([day, data]) => { map[day] = data; });
    }

    Object.entries(map).forEach(([day, data]) => {
        const checkbox   = document.getElementById(`day-${day}`);
        const openInput  = document.getElementById(`time-${day}-open`);
        const closeInput = document.getElementById(`time-${day}-close`);
        if (!checkbox) return;

        checkbox.checked = data.isOpen ?? data.open ?? true;
        const dayDiv = checkbox.closest('.schedule-day');
        if (dayDiv) {
            dayDiv.classList.toggle('closed', !checkbox.checked);
            const label = dayDiv.querySelector('.toggle-label');
            if (label) label.textContent = checkbox.checked ? 'Abierto' : 'Cerrado';
        }

        const startTime = data.start || data.open  || '08:00';
        const endTime   = data.end   || data.close || '15:00';

        const openWrapper  = openInput?.previousElementSibling;
        const closeWrapper = closeInput?.previousElementSibling;
        if (openWrapper?._setTime)  openWrapper._setTime(startTime);
        else if (openInput)  openInput.value  = startTime;
        if (closeWrapper?._setTime) closeWrapper._setTime(endTime);
        else if (closeInput) closeInput.value = endTime;
    });
}

function collectSchedule() {
    return DAYS.map(d => ({
        day:   d.key,
        open:  document.getElementById(`day-${d.key}`)?.checked || false,
        start: document.getElementById(`time-${d.key}-open`)?.value  || '08:00',
        end:   document.getElementById(`time-${d.key}-close`)?.value || '15:00',
    }));
}

// ============================================
// DÍAS INHÁBILES
// ============================================

let holidayCounter = 0;

function initHolidays() {
    document.getElementById('btnAddHoliday')?.addEventListener('click', () => addHoliday());
}

// ============================================
// SEDES
// ============================================

function initSedes() {
    document.getElementById('btnAddSede')?.addEventListener('click', () => addSedeItem());
}

function addSedeItem(data = null) {
    const list = document.getElementById('sedesList');
    if (!list) return;

    const row = document.createElement('div');
    row.className = 'sede-item';
    row.innerHTML = `
        <div class="sede-fields">
            <input type="text" class="info-input sede-nombre"
                   placeholder="Nombre de la sede  (Ej: Centro Cultural, CBTIS 12)"
                   value="${data?.nombre || ''}">
            <input type="text" class="info-input sede-direccion"
                   placeholder="Dirección  (Ej: Blvd. Hidalgo 200)"
                   value="${data?.direccion || ''}">
            <div style="position:relative;">
                <i class="lni lni-map" style="position:absolute;left:.75rem;top:50%;transform:translateY(-50%);color:#06b6d4;font-size:.9rem;pointer-events:none;"></i>
                <input type="url" class="info-input sede-maps"
                       style="padding-left:2.2rem;"
                       placeholder="Link de Google Maps (opcional)"
                       value="${data?.maps || ''}">
            </div>
        </div>
        <button type="button" class="btn-remove-circle" onclick="this.closest('.sede-item').remove(); refreshSedeSelects();" title="Eliminar sede">
            <i class="lni lni-trash-can"></i>
        </button>
    `;

    row.querySelector('.sede-nombre').addEventListener('input', refreshSedeSelects);
    list.appendChild(row);
    refreshSedeSelects();
}

function renderSedes(sedes = []) {
    const list = document.getElementById('sedesList');
    if (!list) return;
    list.innerHTML = '';
    sedes.forEach(s => addSedeItem(s));
}

function collectSedes() {
    return [...document.querySelectorAll('.sede-item')].map(item => ({
        nombre:    item.querySelector('.sede-nombre')?.value    || '',
        direccion: item.querySelector('.sede-direccion')?.value || '',
        maps:      item.querySelector('.sede-maps')?.value      || '',
    })).filter(s => s.nombre);
}

// Retorna lista de nombres de sedes actuales
function getSedes() {
    return [...document.querySelectorAll('.sede-nombre')]
        .map(i => i.value.trim()).filter(Boolean);
}

// Actualiza todos los <select class="curso-sede"> con las sedes actuales
function refreshSedeSelects() {
    const sedes = getSedes();
    document.querySelectorAll('.curso-sede').forEach(sel => {
        const current = sel.value;
        sel.innerHTML = `<option value="">Sin sede asignada</option>` +
            sedes.map(s => `<option value="${s}" ${s===current?'selected':''}>${s}</option>`).join('');
    });
}

function addHoliday(data = null) {
    const container = document.getElementById('holidaysList');
    if (!container) return;

    // Reconstruir fecha ISO si viene del servidor (month + day)
    let isoDate = '';
    if (data?.date) {
        isoDate = data.date; // ya viene como YYYY-MM-DD
    } else if (data?.month && data?.day) {
        const y = new Date().getFullYear();
        isoDate = `${y}-${String(data.month).padStart(2,'0')}-${String(data.day).padStart(2,'0')}`;
    }

    const div = document.createElement('div');
    div.className = 'holiday-item';

    // Input oculto para la fecha
    const hiddenInput = document.createElement('input');
    hiddenInput.type = 'hidden';
    hiddenInput.className = 'holiday-date-val';
    hiddenInput.value = isoDate;

    // Wrap del calendario
    const calWrap = document.createElement('div');
    calWrap.className = 'attomos-cal-wrap';
    calWrap.style.flex = '1';

    // Nombre del día
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'holiday-name-input';
    nameInput.placeholder = 'Nombre del día inhábil';
    nameInput.value = data?.name || data?.description || '';
    nameInput.style.flex = '1';

    // Botón eliminar circular
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn-remove-circle';
    removeBtn.title = 'Eliminar';
    removeBtn.innerHTML = '<i class="lni lni-trash-can"></i>';
    removeBtn.addEventListener('click', () => div.remove());

    // Contenedor de fecha + nombre en fila
    const selector = document.createElement('div');
    selector.className = 'holiday-date-selector';
    selector.style.cssText = 'display:flex;align-items:center;gap:.65rem;flex:1;';
    calWrap.appendChild(hiddenInput);
    selector.append(calWrap, nameInput);
    div.append(selector, removeBtn);
    container.appendChild(div);

    // Inicializar calendario Attomos
    createAttomosCal(calWrap, hiddenInput, isoDate);
}

function collectHolidays() {
    return [...document.querySelectorAll('.holiday-item')].map(item => {
        const dateVal = item.querySelector('.holiday-date-val')?.value || '';
        if (!dateVal) return null;
        const [y, m, d] = dateVal.split('-');
        return {
            month:       m || '',
            day:         d || '',
            description: item.querySelector('.holiday-name-input')?.value || '',
        };
    }).filter(h => h && h.day);
}

// ============================================
// CURSOS
// ============================================

function initCursos() {
    document.getElementById('btnAddCurso')?.addEventListener('click', () => addCursoItem());
}

function renderCursos(cursos = []) {
    const list = document.getElementById('cursosList');
    const hint = document.getElementById('cursosHint');
    list.innerHTML = '';
    if (cursos.length === 0) { hint && (hint.style.display = 'flex'); return; }
    hint && (hint.style.display = 'none');
    cursos.forEach(c => addCursoItem(c));
}

function addCursoItem(data = null) {
    const list = document.getElementById('cursosList');
    const hint = document.getElementById('cursosHint');
    hint && (hint.style.display = 'none');

    const uid        = 'curso_' + Date.now() + Math.random().toString().slice(2,6);
    const disponible = data?.disponible !== false;
    const cupos      = data?.cupos ?? '';
    const modalidad  = data?.modalidad || 'presencial';
    const imgUrls    = data?.imageUrls || [];

    const div = document.createElement('div');
    div.className = 'curso-item';
    div.innerHTML = `
        <!-- Fila 1: nombre + toggle + eliminar -->
        <div class="curso-header-row">
            <input type="text" class="info-input curso-title"
                   placeholder="Nombre del curso o taller" value="${data?.title || ''}">
            <label class="cupos-toggle">
                <input type="checkbox" class="curso-disponible" ${disponible ? 'checked' : ''}>
                <span class="cupos-slider"></span>
                <span class="cupos-label">${disponible ? 'Disponible' : 'Agotado'}</span>
            </label>
            <button type="button" class="btn-remove-item" onclick="removeCurso(this)">
                <i class="lni lni-trash-can"></i>
            </button>
        </div>

        <!-- Fila 2: editor de texto enriquecido -->
        <div class="rte-wrap">
            <div class="rte-toolbar">
                <button type="button" class="rte-btn" data-cmd="bold"         title="Negrita"><b>B</b></button>
                <button type="button" class="rte-btn" data-cmd="italic"       title="Cursiva"><i>I</i></button>
                <button type="button" class="rte-btn" data-cmd="underline"    title="Subrayado"><u>S</u></u></button>
                <div class="rte-sep"></div>
                <button type="button" class="rte-btn" data-cmd="insertUnorderedList" title="Lista">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="width:13px;height:13px;">
                        <line x1="9" y1="6"  x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/>
                        <circle cx="4" cy="6"  r="1.5" fill="currentColor" stroke="none"/>
                        <circle cx="4" cy="12" r="1.5" fill="currentColor" stroke="none"/>
                        <circle cx="4" cy="18" r="1.5" fill="currentColor" stroke="none"/>
                    </svg>
                </button>
                <button type="button" class="rte-btn" data-cmd="insertOrderedList" title="Lista numerada">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="width:13px;height:13px;">
                        <line x1="10" y1="6"  x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/>
                        <path d="M4 6h1v4" stroke-width="2"/><path d="M4 10h2" stroke-width="2"/>
                        <path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" stroke-width="2"/>
                    </svg>
                </button>
                <div class="rte-sep"></div>
                <button type="button" class="rte-btn" data-cmd="removeFormat" title="Quitar formato">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="width:13px;height:13px;">
                        <path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>
                        <line x1="3" y1="3" x2="21" y2="21"/>
                    </svg>
                </button>
            </div>
            <div class="rte-body curso-desc-rte" contenteditable="true"
                 data-placeholder="Descripción, requisitos, temario...">${data?.description || ''}</div>
            <textarea class="curso-desc" style="display:none;">${data?.description || ''}</textarea>
        </div>

        <!-- Fila 3: modalidad + cupos -->
        <div class="curso-meta-row">
            <div class="curso-meta-group">
                <span class="curso-meta-label">Modalidad</span>
                <div class="curso-modalidad-toggle">
                    <button type="button" class="modalidad-btn ${modalidad==='presencial'?'active':''}" data-mod="presencial">Presencial</button>
                    <button type="button" class="modalidad-btn ${modalidad==='en-linea'?'active':''}" data-mod="en-linea">En línea</button>
                    <button type="button" class="modalidad-btn ${modalidad==='hibrido'?'active':''}" data-mod="hibrido">Híbrido</button>
                </div>
            </div>
            <div class="curso-meta-group">
                <span class="curso-meta-label">Cupos disponibles</span>
                <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;">
                    <input type="number" class="cupos-input curso-cupos" min="0" step="1"
                           placeholder="—" value="${cupos}">
                    <span class="cupos-unit">lugares</span>
                    <span class="cupos-status-badge ${getCuposBadgeClass(cupos, disponible)}">
                        ${getCuposLabel(cupos, disponible)}
                    </span>
                </div>
            </div>
        </div>

        <!-- Fila 4: fotos (izquierda) + fechas+sede (derecha) -->
        <div class="curso-bottom-grid">
            <!-- Fotos — izquierda -->
            <div class="curso-meta-group">
                <span class="curso-meta-label">Imágenes</span>
                <div class="curso-image-upload" data-uid="${uid}">
                    <input type="file" class="curso-image-file" id="file_${uid}" accept="image/*" style="display:none" multiple>
                    <div class="curso-images-grid">
                        ${imgUrls.map((url,i)=>`
                        <div class="curso-img-thumb" data-url="${url}">
                            <img src="${url}" alt="Foto ${i+1}">
                            <button type="button" class="btn-remove-thumb-curso" title="Quitar"><i class="lni lni-close"></i></button>
                        </div>`).join('')}
                        <div class="curso-img-add-btn">
                            <i class="lni lni-camera"></i><span>Foto</span>
                        </div>
                    </div>
                    <input type="hidden" class="curso-image-urls" value="${imgUrls.join(',')}">
                    <div class="curso-image-uploading">
                        <i class="lni lni-spinner-arrow"></i> Subiendo...
                    </div>
                </div>
            </div>

            <!-- Fechas + Sede — derecha -->
            <div class="curso-right-col">
                <!-- Inicio y Fin en la misma fila -->
                <div class="curso-meta-group">
                    <span class="curso-meta-label">Periodo</span>
                    <div class="curso-dates-row-inline">
                        <div class="attomos-cal-wrap" id="cal-inicio-${uid}" style="flex:1;">
                            <input type="hidden" class="curso-fecha-inicio" value="${data?.fechaInicio||''}">
                        </div>
                        <span class="curso-date-arrow">→</span>
                        <div class="attomos-cal-wrap" id="cal-fin-${uid}" style="flex:1;">
                            <input type="hidden" class="curso-fecha-fin" value="${data?.fechaFin||''}">
                        </div>
                    </div>
                </div>
                <!-- Sede -->
                <div class="curso-meta-group" style="margin-top:.75rem;">
                    <span class="curso-meta-label">Sede</span>
                    <div style="position:relative;">
                        <i class="lni lni-map-marker" style="position:absolute;left:.75rem;top:50%;transform:translateY(-50%);color:#06b6d4;font-size:.95rem;pointer-events:none;"></i>
                        <select class="info-input curso-sede" style="padding-left:2.2rem;cursor:pointer;">
                            <option value="">Sin sede asignada</option>
                        </select>
                    </div>
                </div>
            </div>
        </div>
    `;

    // ── Rich Text Editor ──────────────────────────────────────────────
    const rteBody    = div.querySelector('.curso-desc-rte');
    const rteTextarea= div.querySelector('.curso-desc');

    // Toolbar buttons
    div.querySelectorAll('.rte-btn').forEach(btn => {
        btn.addEventListener('mousedown', e => {
            e.preventDefault(); // no pierde focus del editor
            const cmd = btn.dataset.cmd;
            document.execCommand(cmd, false, null);
            rteBody.focus();
            syncRTE();
            updateRteActive();
        });
    });

    // Sync contenteditable → hidden textarea
    const syncRTE = () => { rteTextarea.value = rteBody.innerHTML; };
    rteBody.addEventListener('input',   syncRTE);
    rteBody.addEventListener('keyup',   updateRteActive);
    rteBody.addEventListener('mouseup', updateRteActive);

    function updateRteActive() {
        div.querySelectorAll('.rte-btn[data-cmd]').forEach(btn => {
            const cmd = btn.dataset.cmd;
            try { btn.classList.toggle('active', document.queryCommandState(cmd)); } catch {}
        });
    }

    // ── Calendarios Attomos ───────────────────────────────────────────
    const inicioWrap = div.querySelector(`#cal-inicio-${uid}`);
    const finWrap    = div.querySelector(`#cal-fin-${uid}`);
    createAttomosCal(inicioWrap, div.querySelector('.curso-fecha-inicio'), data?.fechaInicio || '');
    createAttomosCal(finWrap,    div.querySelector('.curso-fecha-fin'),    data?.fechaFin    || '');

    // ── Populate sede select con sedes actuales ───────────────────────
    const sedeSelect = div.querySelector('.curso-sede');
    const sedes = getSedes();
    sedes.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s; opt.textContent = s;
        if (s === data?.sede) opt.selected = true;
        sedeSelect.appendChild(opt);
    });

    // ── Disponibilidad toggle ─────────────────────────────────────────
    const checkbox   = div.querySelector('.curso-disponible');
    const cuposLabel = div.querySelector('.cupos-label');
    const cuposInput = div.querySelector('.curso-cupos');
    const badge      = div.querySelector('.cupos-status-badge');

    const updateBadge = () => {
        const qty = parseInt(cuposInput.value) || 0;
        badge.className = 'cupos-status-badge ' + getCuposBadgeClass(qty, checkbox.checked);
        badge.textContent = getCuposLabel(qty, checkbox.checked);
    };
    checkbox.addEventListener('change', function() {
        cuposLabel.textContent = this.checked ? 'Disponible' : 'Agotado';
        cuposLabel.style.color = this.checked ? '#06b6d4' : '#ef4444';
        updateBadge();
    });
    cuposInput.addEventListener('input', updateBadge);
    updateBadge();

    // ── Modalidad ─────────────────────────────────────────────────────
    div.querySelectorAll('.modalidad-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            div.querySelectorAll('.modalidad-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
        });
    });

    // ── Upload imágenes ───────────────────────────────────────────────
    const grid       = div.querySelector('.curso-images-grid');
    const fileInput  = div.querySelector('.curso-image-file');
    const urlsInput  = div.querySelector('.curso-image-urls');
    const uploadingEl= div.querySelector('.curso-image-uploading');
    const addBtn     = div.querySelector('.curso-img-add-btn');

    const syncUrls = () => {
        urlsInput.value = [...grid.querySelectorAll('.curso-img-thumb')].map(t => t.dataset.url).join(',');
    };
    grid.addEventListener('click', function(e) {
        const rb = e.target.closest('.btn-remove-thumb-curso');
        if (rb) { e.stopPropagation(); rb.closest('.curso-img-thumb').remove(); syncUrls(); return; }
        if (!e.target.closest('.curso-img-thumb')) fileInput.click();
    });
    fileInput.addEventListener('change', async function() {
        const files = [...this.files];
        if (!files.length) return;
        if (files.some(f => f.size > 5*1024*1024)) { showNotification('Máx. 5 MB','warning'); return; }
        uploadingEl.style.display = 'flex'; addBtn.style.pointerEvents = 'none';
        try {
            for (const file of files) {
                const fd = new FormData(); fd.append('image', file);
                const res = await fetch(`/api/upload/curso-image?branch_id=${activeBranchId}`,
                    { method:'POST', credentials:'include', body:fd });
                if (!res.ok) throw new Error();
                const result = await res.json();
                const thumb = document.createElement('div');
                thumb.className = 'curso-img-thumb'; thumb.dataset.url = result.url;
                thumb.innerHTML = `<img src="${result.url}" alt="Foto"><button type="button" class="btn-remove-thumb-curso" title="Quitar"><i class="lni lni-close"></i></button>`;
                grid.insertBefore(thumb, addBtn);
            }
            syncUrls(); showNotification('Imagen subida','success');
        } catch { showNotification('Error al subir','error'); }
        finally { uploadingEl.style.display='none'; addBtn.style.pointerEvents=''; fileInput.value=''; }
    });

    list.appendChild(div);
}

// ── Calendario Attomos ────────────────────────────────────────────────
function createAttomosCal(container, hiddenInput, initialValue) {
    const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                    'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    const DAYS_HDR = ['L','M','X','J','V','S','D'];

    let selDate = initialValue ? new Date(initialValue + 'T12:00:00') : null;
    let viewYear  = selDate ? selDate.getFullYear() : new Date().getFullYear();
    let viewMonth = selDate ? selDate.getMonth()    : new Date().getMonth();

    // Display button
    const btn = document.createElement('div');
    btn.className = 'attomos-cal-btn';
    btn.innerHTML = `
        <i class="lni lni-calendar" style="color:#06b6d4;font-size:.95rem;"></i>
        <span class="attomos-cal-val">${fmtDate(selDate)}</span>
        <i class="lni lni-chevron-down" style="font-size:.75rem;color:#9ca3af;margin-left:auto;"></i>
    `;

    // Dropdown
    const drop = document.createElement('div');
    drop.className = 'attomos-cal-drop';

    container.append(btn, drop);
    renderCal();

    btn.addEventListener('click', e => {
        e.stopPropagation();
        document.querySelectorAll('.attomos-cal-drop.open').forEach(d => {
            if (d !== drop) d.classList.remove('open');
        });
        drop.classList.toggle('open');
    });
    document.addEventListener('click', e => {
        if (!container.contains(e.target)) drop.classList.remove('open');
    });

    function fmtDate(d) {
        if (!d) return 'Seleccionar fecha';
        return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0,3)} ${d.getFullYear()}`;
    }

    function renderCal() {
        const today = new Date();
        const first = new Date(viewYear, viewMonth, 1);
        // Monday-based: 0=Mon..6=Sun
        let startDow = first.getDay(); // 0=Sun
        startDow = startDow === 0 ? 6 : startDow - 1;
        const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

        let html = `
        <div class="attomos-cal-header">
            <button type="button" class="attomos-cal-nav" data-dir="-1">&#8249;</button>
            <span class="attomos-cal-title">${MONTHS[viewMonth]} ${viewYear}</span>
            <button type="button" class="attomos-cal-nav" data-dir="1">&#8250;</button>
        </div>
        <div class="attomos-cal-grid">
            ${DAYS_HDR.map(d => `<div class="attomos-cal-dow">${d}</div>`).join('')}
        `;

        // Empty cells before first day
        for (let i = 0; i < startDow; i++) html += `<div class="attomos-cal-cell empty"></div>`;

        for (let day = 1; day <= daysInMonth; day++) {
            const isToday = today.getFullYear()===viewYear && today.getMonth()===viewMonth && today.getDate()===day;
            const isSel   = selDate && selDate.getFullYear()===viewYear && selDate.getMonth()===viewMonth && selDate.getDate()===day;
            html += `<div class="attomos-cal-cell${isToday?' today':''}${isSel?' selected':''}" data-day="${day}">${day}</div>`;
        }

        html += `</div>
        <div class="attomos-cal-footer">
            <button type="button" class="attomos-cal-clear">Limpiar</button>
            <button type="button" class="attomos-cal-today">Hoy</button>
        </div>`;

        drop.innerHTML = html;

        // Nav
        drop.querySelectorAll('.attomos-cal-nav').forEach(navBtn => {
            navBtn.addEventListener('click', e => {
                e.stopPropagation();
                viewMonth += parseInt(navBtn.dataset.dir);
                if (viewMonth > 11) { viewMonth = 0; viewYear++; }
                if (viewMonth < 0)  { viewMonth = 11; viewYear--; }
                renderCal();
            });
        });

        // Day click
        drop.querySelectorAll('.attomos-cal-cell[data-day]').forEach(cell => {
            cell.addEventListener('click', e => {
                e.stopPropagation();
                selDate = new Date(viewYear, viewMonth, parseInt(cell.dataset.day), 12);
                hiddenInput.value = `${viewYear}-${String(viewMonth+1).padStart(2,'0')}-${String(selDate.getDate()).padStart(2,'0')}`;
                btn.querySelector('.attomos-cal-val').textContent = fmtDate(selDate);
                drop.classList.remove('open');
                renderCal();
            });
        });

        // Hoy
        drop.querySelector('.attomos-cal-today')?.addEventListener('click', e => {
            e.stopPropagation();
            const t = new Date();
            viewYear = t.getFullYear(); viewMonth = t.getMonth();
            selDate  = new Date(viewYear, viewMonth, t.getDate(), 12);
            hiddenInput.value = `${viewYear}-${String(viewMonth+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
            btn.querySelector('.attomos-cal-val').textContent = fmtDate(selDate);
            drop.classList.remove('open');
            renderCal();
        });

        // Limpiar
        drop.querySelector('.attomos-cal-clear')?.addEventListener('click', e => {
            e.stopPropagation();
            selDate = null; hiddenInput.value = '';
            btn.querySelector('.attomos-cal-val').textContent = 'Seleccionar fecha';
            drop.classList.remove('open');
            renderCal();
        });
    }
}

function getCuposBadgeClass(cupos, disponible) {
    if (!disponible) return 'agotado';
    const n = parseInt(cupos);
    if (isNaN(n) || cupos === '') return 'disponible';
    if (n === 0) return 'agotado';
    if (n <= 5) return 'por-agotarse';
    return 'disponible';
}
function getCuposLabel(cupos, disponible) {
    if (!disponible) return 'Agotado';
    const n = parseInt(cupos);
    if (isNaN(n) || cupos === '') return 'Disponible';
    if (n === 0) return 'Sin cupos';
    if (n <= 5) return `¡Solo ${n} lugar${n===1?'':'es'}!`;
    return `${n} lugares disponibles`;
}
function removeCurso(btn) {
    btn.closest('.curso-item').remove();
    const list = document.getElementById('cursosList');
    const hint = document.getElementById('cursosHint');
    if (!list.children.length) hint && (hint.style.display = 'flex');
}

function collectCursos() {
    return [...document.querySelectorAll('.curso-item')].map(item => {
        const title = item.querySelector('.curso-title')?.value;
        if (!title) return null;
        return {
            title,
            description: item.querySelector('.curso-desc')?.value || item.querySelector('.curso-desc-rte')?.innerHTML || '',
            disponible:  item.querySelector('.curso-disponible')?.checked ?? true,
            cupos:       item.querySelector('.curso-cupos')?.value || '',
            modalidad:   item.querySelector('.modalidad-btn.active')?.dataset.mod || 'presencial',
            fechaInicio: item.querySelector('.curso-fecha-inicio')?.value || '',
            fechaFin:    item.querySelector('.curso-fecha-fin')?.value    || '',
            sede:        item.querySelector('.curso-sede')?.value         || '',
            imageUrls:   (item.querySelector('.curso-image-urls')?.value || '').split(',').filter(Boolean),
        };
    }).filter(Boolean);
}

// ============================================
// BASE DE DATOS
// ============================================

async function loadBaseDatos() {
    const tbody = document.getElementById('bdTbody');
    const empty = document.getElementById('bdEmpty');
    const loader= document.getElementById('bdLoader');
    if (!tbody) return;

    loader && (loader.style.display = 'flex');
    tbody.innerHTML = '';
    empty && (empty.style.display = 'none');

    try {
        const res  = await fetch(`/api/my-agency/registros?branch_id=${activeBranchId || ''}`, { credentials:'include' });
        if (!res.ok) throw new Error();
        const data = await res.json();
        const rows = data.registros || [];

        loader && (loader.style.display = 'none');

        if (rows.length === 0) {
            empty && (empty.style.display = 'flex');
            return;
        }

        rows.forEach(r => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${r.nombre || '—'}</td>
                <td>${r.curso || '—'}</td>
                <td>${r.fecha || '—'}</td>
                <td>${r.telefono || '—'}</td>
                <td>${r.email || '—'}</td>
                <td>
                    <span class="bd-status-badge ${r.estado || 'pendiente'}">
                        ${r.estado || 'pendiente'}
                    </span>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch {
        loader && (loader.style.display = 'none');
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#9ca3af;padding:2rem;">Error al cargar los registros</td></tr>';
    }
}

// Búsqueda en tabla
function initBdSearch() {
    document.getElementById('bdSearch')?.addEventListener('input', function() {
        const term = this.value.toLowerCase();
        document.querySelectorAll('#bdTbody tr').forEach(tr => {
            tr.style.display = tr.textContent.toLowerCase().includes(term) ? '' : 'none';
        });
    });
}

// ============================================
// GUARDAR
// ============================================

function initSaveButton() {
    document.getElementById('saveProfileBtn')?.addEventListener('click', saveProfile);
}

async function saveProfile() {
    const btn      = document.getElementById('saveProfileBtn');
    const origHTML = btn.innerHTML;
    btn.innerHTML  = '<div class="brand-spinner" style="width:16px;height:16px;border-width:2px;margin:auto;"></div>';
    btn.disabled   = true;

    const payload = {
        branchId:    activeBranchId,
        depName:     document.getElementById('depNameInput')?.value      || '',
        depAcronym:  document.getElementById('depAcronymInput')?.value   || '',
        depArea:     document.getElementById('depAreaInput')?.value      || '',
        depParent:   document.getElementById('depParentInput')?.value    || '',
        govLevel:    document.getElementById('govLevelInput')?.getAttribute('data-value') || '',
        rfc:         document.getElementById('rfcInput')?.value          || '',
        description: document.getElementById('depDescriptionInput')?.value || '',
        website:     document.getElementById('websiteInput')?.value      || '',
        email:       document.getElementById('emailInput')?.value        || '',
        phoneNumber: document.getElementById('phoneNumberInput')?.value  || '',
        address:     document.getElementById('addressInput')?.value      || '',
        city:        document.getElementById('cityInput')?.value         || '',
        state:       document.getElementById('stateInput')?.value        || '',
        mapsLink:    document.getElementById('mapsLinkInput')?.value     || '',
        facebook:    document.getElementById('facebookInput')?.value     || '',
        instagram:   document.getElementById('instagramInput')?.value    || '',
        twitter:     document.getElementById('twitterInput')?.value      || '',
        youtube:     document.getElementById('youtubeInput')?.value      || '',
        linkedin:    document.getElementById('linkedinInput')?.value     || '',
        bannerUrl:   '',
        logoUrl:     '',
        schedule:    collectSchedule(),
        holidays:    collectHolidays(),
        sedes:       collectSedes(),
        cursos:      collectCursos(),
    };

    try {
        const res = await fetch('/api/my-agency', {
            method:'POST', credentials:'include',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(await res.text());
        showNotification('Cambios guardados correctamente','success');
    } catch (err) {
        console.error(err);
        showNotification('Error al guardar los cambios','error');
    } finally {
        btn.innerHTML = origHTML;
        btn.disabled  = false;
    }
}

// ============================================
// NOTIFICACIONES
// ============================================

function showNotification(message, type = 'info') {
    if (typeof sileo !== 'undefined') {
        sileo.toast({ message, type });
    } else {
        console.log(`[${type}] ${message}`);
    }
}