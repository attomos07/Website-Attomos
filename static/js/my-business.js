// ============================================
// PROFILE JAVASCRIPT
// ============================================

// Estado global de sucursales
let branches = [];
let activeBranchId = null;

document.addEventListener('DOMContentLoaded', function () {
    console.log('🔧 Profile JS cargado correctamente');

    initBranchSelector();
    initCustomSelect();
    initLocationDropdowns();
    initSchedule();
    initHolidays();
    initServices();
    initWorkers();
    initSaveButton();
    initBrandImages();
    initMenu();

    console.log('✅ Profile funcionalidades inicializadas');
});

// ============================================
// DATA COLLECTIONS
// ============================================

const COUNTRIES = [
    { value: 'mexico', name: 'México', icon: 'lni-flag-mx' },
    { value: 'usa', name: 'Estados Unidos', icon: 'lni-flag-us' },
    { value: 'canada', name: 'Canadá', icon: 'lni-flag-ca' },
    { value: 'spain', name: 'España', icon: 'lni-flag-es' },
    { value: 'argentina', name: 'Argentina', icon: 'lni-flag-ar' }
];

const STATES_MEXICO = [
    'Aguascalientes', 'Baja California', 'Baja California Sur', 'Campeche', 'Chiapas',
    'Chihuahua', 'Ciudad de México', 'Coahuila', 'Colima', 'Durango', 'Guanajuato',
    'Guerrero', 'Hidalgo', 'Jalisco', 'México', 'Michoacán', 'Morelos', 'Nayarit',
    'Nuevo León', 'Oaxaca', 'Puebla', 'Querétaro', 'Quintana Roo', 'San Luis Potosí',
    'Sinaloa', 'Sonora', 'Tabasco', 'Tamaulipas', 'Tlaxcala', 'Veracruz', 'Yucatán', 'Zacatecas'
];

const CITIES_SONORA = [
    'Hermosillo', 'Ciudad Obregón', 'Nogales', 'San Luis Río Colorado', 'Navojoa',
    'Guaymas', 'Empalme', 'Agua Prieta', 'Caborca', 'Cananea', 'Puerto Peñasco',
    'Huatabampo', 'Etchojoa', 'Magdalena', 'Santa Ana'
];

const MONTHS = [
    { value: '01', name: 'Enero' },
    { value: '02', name: 'Febrero' },
    { value: '03', name: 'Marzo' },
    { value: '04', name: 'Abril' },
    { value: '05', name: 'Mayo' },
    { value: '06', name: 'Junio' },
    { value: '07', name: 'Julio' },
    { value: '08', name: 'Agosto' },
    { value: '09', name: 'Septiembre' },
    { value: '10', name: 'Octubre' },
    { value: '11', name: 'Noviembre' },
    { value: '12', name: 'Diciembre' }
];

// Giros que manejan existencias/inventario físico (NO son servicios puros)
const SERVICE_TYPES = ['clinica-dental', 'peluqueria'];
function isCommerceType() {
    const giro = (document.getElementById('businessTypeInput')?.getAttribute('data-value') || '').toLowerCase();
    if (!giro) return false;
    return !SERVICE_TYPES.includes(giro);
}
function refreshStockQtyVisibility() {
    const show = isCommerceType();
    document.querySelectorAll('.service-stock-qty-row').forEach(el => {
        el.style.display = show ? 'flex' : 'none';
    });
}

// ============================================
// BRANCH SELECTOR
// ============================================

async function initBranchSelector() {
    try {
        const res = await fetch('/api/my-business');
        const data = await res.json();

        branches = data.branches || [];

        // Renderizar lista de sucursales en el dropdown
        renderBranchList();

        // Cargar la primera sucursal activa
        if (data.activeBranch) {
            activeBranchId = data.activeBranch.id;
            loadBranchData(data.activeBranch);
            updateNindaBanner(activeBranchId);
        } else if (data.defaultBranch) {
            activeBranchId = 0;
            loadBranchData(data.defaultBranch);
            // Sin ID real todavía, el banner permanece oculto
        }

        // Toggle del dropdown
        const btn = document.getElementById('branchDropdownBtn');
        const menu = document.getElementById('branchDropdownMenu');
        const wrapper = document.getElementById('branchDropdownWrapper');

        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            wrapper.classList.toggle('active');
            document.getElementById('branchChevron').style.transform =
                wrapper.classList.contains('active') ? 'rotate(180deg)' : 'rotate(0deg)';
        });

        document.addEventListener('click', function(e) {
            if (!wrapper.contains(e.target)) {
                wrapper.classList.remove('active');
                document.getElementById('branchChevron').style.transform = 'rotate(0deg)';
            }
        });

        // Botón nueva sucursal
        document.getElementById('btnAddBranch').addEventListener('click', createNewBranch);

    } catch (e) {
        console.error('Error cargando sucursales', e);
    }
}

function renderBranchList() {
    const list = document.getElementById('branchList');
    list.innerHTML = '';

    if (branches.length === 0) {
        list.innerHTML = '<div class="branch-item-empty">Sin sucursales guardadas</div>';
        return;
    }

    branches.forEach(b => {
        const item = document.createElement('div');
        item.className = 'branch-item' + (b.id === activeBranchId ? ' active' : '');
        item.dataset.branchId = b.id;
        item.innerHTML = `
            <i class="lni lni-map-marker"></i>
            <span>${b.branchName || 'Sucursal ' + b.branchNumber}</span>
            ${b.branchNumber > 1 ? `<button type="button" class="btn-delete-branch" data-id="${b.id}" title="Eliminar"><i class="lni lni-trash-can"></i></button>` : ''}
        `;

        item.addEventListener('click', async function(e) {
            if (e.target.closest('.btn-delete-branch')) return;
            await switchBranch(b.id);
        });

        const deleteBtn = item.querySelector('.btn-delete-branch');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', async function(e) {
                e.stopPropagation();
                await deleteBranch(b.id);
            });
        }

        list.appendChild(item);
    });
}

async function switchBranch(branchId) {
    try {
        const res = await fetch(`/api/my-business/${branchId}`);
        const data = await res.json();
        activeBranchId = branchId;
        loadBranchData(data);
        renderBranchList();
        updateNindaBanner(branchId);

        // Cerrar dropdown
        document.getElementById('branchDropdownWrapper').classList.remove('active');
    } catch(e) {
        console.error('Error cargando sucursal', e);
    }
}

async function createNewBranch() {
    try {
        const res = await fetch('/api/my-business/branch', { method: 'POST', credentials: 'include' });
        const data = await res.json();
        if (data.success) {
            branches.push({ id: data.branch.id, branchNumber: data.branch.branchNumber, branchName: data.branch.branchName });
            activeBranchId = data.branch.id;
            loadBranchData(data.branch);
            renderBranchList();
            showNotification('Nueva sucursal creada', 'success');
        }
    } catch(e) {
        console.error('Error creando sucursal', e);
    }
}

async function deleteBranch(branchId) {
    if (!confirm('¿Eliminar esta sucursal?')) return;
    try {
        const res = await fetch(`/api/my-business/branch/${branchId}`, { method: 'DELETE', credentials: 'include' });
        const data = await res.json();
        if (data.success) {
            branches = branches.filter(b => b.id !== branchId);
            // Si era la activa, cargar la primera
            if (activeBranchId === branchId && branches.length > 0) {
                await switchBranch(branches[0].id);
            }
            renderBranchList();
            showNotification('Sucursal eliminada', 'success');
        }
    } catch(e) {
        console.error('Error eliminando sucursal', e);
    }
}

// Actualiza el título de la sección Menú/Catálogo según el giro seleccionado
function updateMenuLabel() {
    const giro = (document.getElementById('businessTypeInput')?.getAttribute('data-value') || '').toLowerCase();
    const h2 = document.querySelector('.menu-section-title');
    if (!h2) return;
    // Giros que usan "Catálogo" en lugar de "Menú"
    const catalogoGiros = [
        'libreria', 'librería', 'libros',
        'automotriz', 'concesionario', 'agencia', 'taller', 'refaccionaria',
        'clinica-dental', 'clinica', 'dental',
        'peluqueria', 'peluquería', 'estetica', 'estética', 'salon', 'salón',
    ];
    h2.textContent = catalogoGiros.includes(giro) ? 'Catálogo' : 'Menú';
}

function loadBranchData(branch) {
    // Actualizar label del dropdown
    const label = branch.branchName || ('Sucursal ' + branch.branchNumber);
    document.getElementById('branchDropdownLabel').textContent = label;
    document.getElementById('branchBadge').textContent = label;

    // Información del negocio
    setInputValue('businessNameInput', branch.business?.name);
    setInputValue('descriptionInput', branch.business?.description);
    setInputValue('websiteInput', branch.business?.website);
    setInputValue('emailInput', branch.business?.email);
    setInputValue('phoneNumberInput', branch.phoneNumber);

    const typeInput = document.getElementById('businessTypeInput');
    if (typeInput) {
        typeInput.value = branch.business?.typeName || '';
        typeInput.setAttribute('data-value', branch.business?.type || '');
        updateMenuLabel(); // Ajustar título Menú/Catálogo según giro
    }

    // Ubicación
    setInputValue('addressInput', branch.location?.address);
    setInputValue('numberInput', branch.location?.number);
    setInputValue('neighborhoodInput', branch.location?.neighborhood);
    setInputValue('postalCodeInput', branch.location?.postalCode);
    setInputValue('betweenStreetsInput', branch.location?.betweenStreets);

    setLocationDropdown('countryInput', branch.location?.country);
    setLocationDropdown('stateInput', branch.location?.state);
    setLocationDropdown('cityInput', branch.location?.city);

    // Redes sociales
    setInputValue('facebookInput', branch.social?.facebook);
    setInputValue('instagramInput', branch.social?.instagram);
    setInputValue('twitterInput', branch.social?.twitter);
    setInputValue('linkedinInput', branch.social?.linkedin);

    // Horario y festivos
    if (branch.schedule) applySchedule(branch.schedule);
    if (branch.holidays) {
        document.getElementById('holidaysList').innerHTML = '';
        applyHolidays(branch.holidays);
    }

    // Imágenes de marca
    loadBrandImages(branch.business?.logoUrl || '', branch.business?.bannerUrl || '');

    // Menú
    const menuUrlEl = document.getElementById('menuUrlInput');
    if (menuUrlEl) {
        menuUrlEl.value = branch.business?.menuUrl || '';
        // Restaurar nombre original si viene del servidor
        const origNameEl = document.getElementById('menuOriginalName');
        if (origNameEl && branch.business?.menuName) origNameEl.value = branch.business.menuName;
        if (branch.business?.menuUrl) renderMenuPreview(branch.business.menuUrl);
    }

    // Servicios y trabajadores
    renderServices(branch.services || []);
    renderWorkers(branch.workers || []);
    refreshInventoryTable();

    // Actualizar nombre si la dirección cambia
    document.getElementById('addressInput').addEventListener('input', function() {
        const addr = this.value.trim();
        const newName = addr ? 'Sucursal ' + addr : ('Sucursal ' + (branch.branchNumber || 1));
        document.getElementById('branchDropdownLabel').textContent = newName;
        document.getElementById('branchBadge').textContent = newName;
        // Actualizar en lista
        const branchInList = branches.find(b => b.id === activeBranchId);
        if (branchInList) branchInList.branchName = newName;
        renderBranchList();
    });
}


function updateDropdownSelection(wrapperId, value) {
    const wrapper = document.getElementById(wrapperId);
    if (!wrapper) return;

    const options = wrapper.querySelectorAll('.select-option');
    options.forEach(opt => {
        if (opt.getAttribute('data-value') === value || opt.querySelector('span')?.textContent === value) {
            opt.classList.add('selected');
        } else {
            opt.classList.remove('selected');
        }
    });
}

function applySchedule(schedule) {
    Object.entries(schedule).forEach(([day, data]) => {
        const checkbox = document.getElementById(`day-${day}`);
        const openInput  = document.getElementById(`time-${day}-open`);
        const closeInput = document.getElementById(`time-${day}-close`);

        if (!checkbox) return;

        // Sincronizar toggle
        checkbox.checked = data.isOpen;
        const dayDiv = checkbox.closest('.schedule-day');
        if (dayDiv) {
            dayDiv.classList.toggle('closed', !data.isOpen);
        }

        // Actualizar el time-picker visual si ya fue creado
        const openWrapper  = openInput  && openInput.previousElementSibling;
        const closeWrapper = closeInput && closeInput.previousElementSibling;

        const startTime = data.start || data.open;
        const endTime   = data.end   || data.close;

        if (openWrapper  && typeof openWrapper._setTime  === 'function') openWrapper._setTime(startTime);
        else if (openInput)  openInput.value  = startTime || '09:00';

        if (closeWrapper && typeof closeWrapper._setTime === 'function') closeWrapper._setTime(endTime);
        else if (closeInput) closeInput.value = endTime   || '20:00';
    });
}

function applyHolidays(holidays = []) {
    holidays.forEach(h => {
        addHoliday();

        const last = document.querySelector('.holiday-item:last-child');
        last.querySelector('[data-field="month"]').value = h.month;
        last.querySelector('[data-field="day"]').value = h.day;
        last.querySelector('[data-field="name"]').value = h.name;
    });
}

function setLocationDropdown(inputId, value) {
    if (!value) return;
    const hiddenInput = document.getElementById(inputId);
    const displayInput = document.getElementById(inputId + 'Display');
    const wrapper = document.getElementById(inputId + 'Wrapper');
    if (!hiddenInput || !displayInput || !wrapper) return;

    // Buscar la opción que coincida por value o por texto
    const options = wrapper.querySelectorAll('.select-option');
    let matched = null;
    options.forEach(opt => {
        const optVal = opt.getAttribute('data-value');
        const optText = opt.querySelector('span')?.textContent || '';
        if (optVal === value || optText === value ||
            optVal === value.toLowerCase().replace(/\s+/g, '-') ||
            optText.toLowerCase() === value.toLowerCase()) {
            matched = opt;
        }
        opt.classList.remove('selected');
    });

    if (matched) {
        matched.classList.add('selected');
        const text = matched.querySelector('span')?.textContent || value;
        displayInput.value = text;
        hiddenInput.value = text;
        hiddenInput.setAttribute('data-value', matched.getAttribute('data-value'));
    } else {
        // Si no hay match en el dropdown, al menos mostrar el valor en el hidden
        displayInput.value = value;
        hiddenInput.value = value;
    }
}

function setInputValue(elementId, value) {
    const element = document.getElementById(elementId);
    if (element) {
        element.value = value || '';
    }
}

// ============================================
// CUSTOM SELECT FUNCTIONALITY
// ============================================

function initCustomSelect() {
    const selectWrapper = document.getElementById('businessTypeWrapper');
    const selectInput = document.getElementById('businessTypeInput');
    const dropdown = document.getElementById('businessTypeDropdown');
    const searchInput = document.getElementById('businessTypeSearch');
    const optionsContainer = document.getElementById('businessTypeOptions');
    const options = optionsContainer?.querySelectorAll('.select-option');

    if (!selectWrapper || !selectInput || !dropdown) {
        console.warn('⚠️ Custom select elements no encontrados');
        return;
    }

    selectInput.addEventListener('click', function (e) {
        e.stopPropagation();
        toggleDropdown();
    });

    if (searchInput) {
        searchInput.addEventListener('input', function () {
            filterOptions(this.value);
        });

        searchInput.addEventListener('click', function (e) {
            e.stopPropagation();
        });
    }

    options?.forEach(option => {
        option.addEventListener('click', function (e) {
            e.stopPropagation();
            selectOption(this);
        });
    });

    document.addEventListener('click', function (e) {
        if (!selectWrapper.contains(e.target)) {
            closeDropdown();
        }
    });

    function toggleDropdown() {
        const isActive = selectWrapper.classList.contains('active');
        if (isActive) { closeDropdown(); } else { openDropdown(); }
    }

    function openDropdown() {
        selectWrapper.classList.add('active');
        if (searchInput) {
            setTimeout(() => { searchInput.focus(); }, 100);
            searchInput.value = '';
        }
        filterOptions('');
    }

    function closeDropdown() {
        selectWrapper.classList.remove('active');
        if (searchInput) { searchInput.value = ''; }
    }

    function filterOptions(searchTerm) {
        const term = searchTerm.toLowerCase().trim();
        options?.forEach(option => {
            const text = option.querySelector('span')?.textContent.toLowerCase() || '';
            if (text.includes(term)) {
                option.classList.remove('hidden');
            } else {
                option.classList.add('hidden');
            }
        });
    }

    function selectOption(option) {
        const value = option.getAttribute('data-value');
        const text = option.querySelector('span')?.textContent;

        selectInput.value = text;
        selectInput.setAttribute('data-value', value);

        options?.forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');

        closeDropdown();
        updateMenuLabel(); // Actualizar Menú/Catálogo al cambiar giro
        refreshStockQtyVisibility(); // Mostrar/ocultar campo existencias
        console.log(`✅ Giro seleccionado: ${text} (${value})`);
    }

    console.log('🎯 Custom select inicializado');
}

// ============================================
// LOCATION DROPDOWNS (Country, State, City)
// ============================================

function initLocationDropdowns() {
    createLocationDropdown('countryInput', COUNTRIES, 'Selecciona un país');
    createLocationDropdown('stateInput', STATES_MEXICO.map(s => ({ value: s.toLowerCase().replace(/\s+/g, '-'), name: s })), 'Selecciona un estado');
    createLocationDropdown('cityInput', CITIES_SONORA.map(c => ({ value: c.toLowerCase().replace(/\s+/g, '-'), name: c })), 'Selecciona una ciudad');
}

function createLocationDropdown(inputId, options, placeholder) {
    const input = document.getElementById(inputId);
    if (!input) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'custom-select-wrapper';
    wrapper.id = `${inputId}Wrapper`;

    const displayInput = document.createElement('input');
    displayInput.type = 'text';
    displayInput.className = 'info-input form-select';
    displayInput.id = `${inputId}Display`;
    displayInput.placeholder = placeholder;
    displayInput.readOnly = true;
    displayInput.value = input.value;

    const arrow = document.createElement('i');
    arrow.className = 'lni lni-chevron-down select-arrow';

    const dropdown = document.createElement('div');
    dropdown.className = 'select-dropdown';

    const searchContainer = document.createElement('div');
    searchContainer.className = 'select-search-container';
    searchContainer.innerHTML = `
        <i class="lni lni-search-alt search-icon"></i>
        <input type="text" class="select-search" placeholder="Buscar..." autocomplete="off">
    `;

    const optionsContainer = document.createElement('div');
    optionsContainer.className = 'select-options-container';

    options.forEach(opt => {
        const option = document.createElement('div');
        option.className = 'select-option';
        option.setAttribute('data-value', opt.value);
        option.innerHTML = `
            ${opt.icon ? `<i class="lni ${opt.icon}"></i>` : '<i class="lni lni-map-marker"></i>'}
            <span>${opt.name}</span>
        `;
        optionsContainer.appendChild(option);
    });

    dropdown.appendChild(searchContainer);
    dropdown.appendChild(optionsContainer);
    wrapper.appendChild(displayInput);
    wrapper.appendChild(arrow);
    wrapper.appendChild(dropdown);

    input.parentNode.insertBefore(wrapper, input);
    input.style.display = 'none';

    const searchInput = searchContainer.querySelector('.select-search');
    const selectOptions = optionsContainer.querySelectorAll('.select-option');

    displayInput.addEventListener('click', function (e) {
        e.stopPropagation();
        toggleLocationDropdown(wrapper, searchInput);
    });

    searchInput.addEventListener('input', function () {
        filterLocationOptions(this.value, selectOptions);
    });

    searchInput.addEventListener('click', function (e) {
        e.stopPropagation();
    });

    selectOptions.forEach(option => {
        option.addEventListener('click', function (e) {
            e.stopPropagation();
            selectLocationOption(this, displayInput, input, wrapper, selectOptions);
        });
    });

    document.addEventListener('click', function (e) {
        if (!wrapper.contains(e.target)) {
            closeLocationDropdown(wrapper);
        }
    });
}

function toggleLocationDropdown(wrapper, searchInput) {
    const isActive = wrapper.classList.contains('active');

    document.querySelectorAll('.custom-select-wrapper.active').forEach(w => {
        if (w !== wrapper) { w.classList.remove('active'); }
    });

    if (isActive) {
        closeLocationDropdown(wrapper);
    } else {
        wrapper.classList.add('active');
        setTimeout(() => searchInput.focus(), 100);
        searchInput.value = '';
        const options = wrapper.querySelectorAll('.select-option');
        options.forEach(opt => opt.classList.remove('hidden'));
    }
}

function closeLocationDropdown(wrapper) {
    wrapper.classList.remove('active');
    const searchInput = wrapper.querySelector('.select-search');
    if (searchInput) searchInput.value = '';
}

function filterLocationOptions(searchTerm, options) {
    const term = searchTerm.toLowerCase().trim();
    options.forEach(option => {
        const text = option.querySelector('span')?.textContent.toLowerCase() || '';
        if (text.includes(term)) {
            option.classList.remove('hidden');
        } else {
            option.classList.add('hidden');
        }
    });
}

function selectLocationOption(option, displayInput, hiddenInput, wrapper, allOptions) {
    const value = option.getAttribute('data-value');
    const text = option.querySelector('span')?.textContent;

    displayInput.value = text;
    hiddenInput.value = text;
    hiddenInput.setAttribute('data-value', value);

    allOptions.forEach(opt => opt.classList.remove('selected'));
    option.classList.add('selected');

    closeLocationDropdown(wrapper);
}

// ============================================
// SCHEDULE FUNCTIONALITY
// ============================================

function initSchedule() {
    const days = [
        { name: 'Lunes', key: 'monday' },
        { name: 'Martes', key: 'tuesday' },
        { name: 'Miércoles', key: 'wednesday' },
        { name: 'Jueves', key: 'thursday' },
        { name: 'Viernes', key: 'friday' },
        { name: 'Sábado', key: 'saturday' },
        { name: 'Domingo', key: 'sunday' }
    ];

    const scheduleList = document.getElementById('scheduleList');
    if (!scheduleList) return;

    scheduleList.innerHTML = '';

    days.forEach(day => {
        const dayDiv = document.createElement('div');
        dayDiv.className = 'schedule-day';
        dayDiv.innerHTML = `
            <div class="day-name">${day.name}</div>
            <div class="day-toggle">
                <label class="toggle-switch">
                    <input type="checkbox" id="day-${day.key}" checked>
                    <span class="toggle-slider"></span>
                </label>
                <span class="toggle-label">Abierto</span>
            </div>
            <div class="day-times">
                <input type="time" class="time-input" id="time-${day.key}-open" value="09:00" style="display: none;">
                <span class="time-separator">-</span>
                <input type="time" class="time-input" id="time-${day.key}-close" value="20:00" style="display: none;">
            </div>
        `;
        scheduleList.appendChild(dayDiv);

        const checkbox = dayDiv.querySelector(`#day-${day.key}`);
        checkbox.addEventListener('change', function () {
            if (this.checked) {
                dayDiv.classList.remove('closed');
            } else {
                dayDiv.classList.add('closed');
            }
        });

        const openInput = dayDiv.querySelector(`#time-${day.key}-open`);
        const closeInput = dayDiv.querySelector(`#time-${day.key}-close`);
        createTimePicker(openInput, '09:00');
        createTimePicker(closeInput, '20:00');
    });
}

function createTimePicker(input, defaultValue = '09:00') {
    const wrapper = document.createElement('div');
    wrapper.className = 'time-picker-wrapper';

    const convert24to12 = (time24) => {
        const [hours24, minutes] = time24.split(':');
        const h = parseInt(hours24);
        const period = h >= 12 ? 'PM' : 'AM';
        const hours12 = h === 0 ? 12 : (h > 12 ? h - 12 : h);
        return { hours: String(hours12).padStart(2, '0'), minutes, period };
    };

    const convert12to24 = (hours12, minutes, period) => {
        let h = parseInt(hours12);
        if (period === 'AM' && h === 12) h = 0;
        if (period === 'PM' && h !== 12) h += 12;
        return `${String(h).padStart(2, '0')}:${minutes}`;
    };

    const initialTime = convert24to12(defaultValue);

    const display = document.createElement('div');
    display.className = 'time-input-display';
    display.innerHTML = `
        <span class="time-display-value">${initialTime.hours}:${initialTime.minutes} ${initialTime.period}</span>
        <i class="lni lni-chevron-down" style="font-size: 14px; color: #06b6d4;"></i>
    `;

    const dropdown = document.createElement('div');
    dropdown.className = 'time-dropdown';

    const content = document.createElement('div');
    content.className = 'time-dropdown-content';

    const hourColumn = document.createElement('div');
    hourColumn.className = 'time-column';
    hourColumn.innerHTML = '<div class="time-column-title">Hora</div><div class="time-scroll" id="hours"></div>';

    const minuteColumn = document.createElement('div');
    minuteColumn.className = 'time-column';
    minuteColumn.innerHTML = '<div class="time-column-title">Min</div><div class="time-scroll" id="minutes"></div>';

    const periodColumn = document.createElement('div');
    periodColumn.className = 'time-column';
    periodColumn.innerHTML = '<div class="time-column-title">Periodo</div><div class="time-scroll" id="period"></div>';

    const hourScroll = hourColumn.querySelector('#hours');
    const minuteScroll = minuteColumn.querySelector('#minutes');
    const periodScroll = periodColumn.querySelector('#period');

    for (let i = 1; i <= 12; i++) {
        const hour = String(i).padStart(2, '0');
        const option = document.createElement('div');
        option.className = 'time-option';
        option.textContent = hour;
        option.dataset.value = hour;
        hourScroll.appendChild(option);
    }

    [0, 15, 30, 45].forEach(min => {
        const minute = String(min).padStart(2, '0');
        const option = document.createElement('div');
        option.className = 'time-option';
        option.textContent = minute;
        option.dataset.value = minute;
        minuteScroll.appendChild(option);
    });

    ['AM', 'PM'].forEach(p => {
        const option = document.createElement('div');
        option.className = 'time-option';
        option.textContent = p;
        option.dataset.value = p;
        periodScroll.appendChild(option);
    });

    content.appendChild(hourColumn);
    content.appendChild(minuteColumn);
    content.appendChild(periodColumn);
    dropdown.appendChild(content);
    wrapper.appendChild(display);
    wrapper.appendChild(dropdown);

    input.parentNode.insertBefore(wrapper, input);
    input.style.display = 'none';
    input.value = defaultValue;

    let selectedHour = initialTime.hours;
    let selectedMinute = initialTime.minutes;
    let selectedPeriod = initialTime.period;

    hourScroll.querySelector(`[data-value="${selectedHour}"]`).classList.add('selected');
    minuteScroll.querySelector(`[data-value="${selectedMinute}"]`).classList.add('selected');
    periodScroll.querySelector(`[data-value="${selectedPeriod}"]`).classList.add('selected');

    display.addEventListener('click', function (e) {
        e.stopPropagation();
        const isOpen = dropdown.classList.contains('show');

        document.querySelectorAll('.time-dropdown.show').forEach(d => d.classList.remove('show'));
        document.querySelectorAll('.time-input-display.active').forEach(d => d.classList.remove('active'));

        if (!isOpen) {
            dropdown.classList.add('show');
            display.classList.add('active');
        }
    });

    hourScroll.addEventListener('click', function (e) {
        if (e.target.classList.contains('time-option')) {
            hourScroll.querySelectorAll('.time-option').forEach(o => o.classList.remove('selected'));
            e.target.classList.add('selected');
            selectedHour = e.target.dataset.value;
            updateTime();
        }
    });

    minuteScroll.addEventListener('click', function (e) {
        if (e.target.classList.contains('time-option')) {
            minuteScroll.querySelectorAll('.time-option').forEach(o => o.classList.remove('selected'));
            e.target.classList.add('selected');
            selectedMinute = e.target.dataset.value;
            updateTime();
        }
    });

    periodScroll.addEventListener('click', function (e) {
        if (e.target.classList.contains('time-option')) {
            periodScroll.querySelectorAll('.time-option').forEach(o => o.classList.remove('selected'));
            e.target.classList.add('selected');
            selectedPeriod = e.target.dataset.value;
            updateTime();
        }
    });

    function updateTime() {
        const displayTime = `${selectedHour}:${selectedMinute} ${selectedPeriod}`;
        display.querySelector('.time-display-value').textContent = displayTime;
        input.value = convert12to24(selectedHour, selectedMinute, selectedPeriod);
    }

    document.addEventListener('click', function (e) {
        if (!wrapper.contains(e.target)) {
            dropdown.classList.remove('show');
            display.classList.remove('active');
        }
    });

    // API pública para actualizar el picker desde fuera
    wrapper._setTime = function(time24) {
        if (!time24) return;
        const t = convert24to12(time24);
        selectedHour   = t.hours;
        selectedMinute = t.minutes;
        selectedPeriod = t.period;

        hourScroll.querySelectorAll('.time-option').forEach(o =>
            o.classList.toggle('selected', o.dataset.value === selectedHour));
        minuteScroll.querySelectorAll('.time-option').forEach(o =>
            o.classList.toggle('selected', o.dataset.value === selectedMinute));
        periodScroll.querySelectorAll('.time-option').forEach(o =>
            o.classList.toggle('selected', o.dataset.value === selectedPeriod));

        display.querySelector('.time-display-value').textContent =
            `${selectedHour}:${selectedMinute} ${selectedPeriod}`;
        input.value = time24;
    };
}

// ============================================
// HOLIDAYS FUNCTIONALITY
// ============================================

let holidayCounter = 0;

function initHolidays() {
    const btnAddHoliday = document.getElementById('btnAddHoliday');
    if (btnAddHoliday) {
        btnAddHoliday.addEventListener('click', addHoliday);
    }
}

function addHoliday() {
    const container = document.getElementById('holidaysList');
    if (!container) return;

    holidayCounter++;
    const id = `holiday-${holidayCounter}`;

    const div = document.createElement('div');
    div.className = 'holiday-item';
    div.dataset.id = id;

    div.innerHTML = `
        <div class="holiday-date-selector">
            <div class="holiday-dropdown-group" id="month-${id}"></div>
            <div class="holiday-dropdown-group" id="day-${id}"></div>
            <div class="holiday-name-group">
                <input type="text" class="holiday-name-input" data-field="name" placeholder="Nombre del día festivo">
            </div>
        </div>
        <button type="button" class="btn-remove-holiday" data-remove="${id}">
            <i class="lni lni-trash-can"></i>
        </button>
    `;

    container.appendChild(div);

    createHolidayDropdown(`month-${id}`, MONTHS, 'Mes', id);

    const days = [];
    for (let i = 1; i <= 31; i++) {
        days.push({ value: String(i).padStart(2, '0'), name: String(i) });
    }
    createHolidayDropdown(`day-${id}`, days, 'Día', id);

    div.querySelector('.btn-remove-holiday').addEventListener('click', function () {
        removeHoliday(id);
    });

    console.log(`✅ Día festivo agregado: ${id}`);
}

function createHolidayDropdown(containerId, options, placeholder, holidayId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'custom-select-wrapper';

    const displayInput = document.createElement('input');
    displayInput.type = 'text';
    displayInput.className = 'info-input form-select';
    displayInput.placeholder = placeholder;
    displayInput.readOnly = true;
    displayInput.dataset.holidayId = holidayId;
    displayInput.dataset.field = containerId.includes('month') ? 'month' : 'day';

    const arrow = document.createElement('i');
    arrow.className = 'lni lni-chevron-down select-arrow';

    const dropdown = document.createElement('div');
    dropdown.className = 'select-dropdown';

    const optionsContainer = document.createElement('div');
    optionsContainer.className = 'select-options-container';

    options.forEach(opt => {
        const option = document.createElement('div');
        option.className = 'select-option';
        option.setAttribute('data-value', opt.value);
        option.innerHTML = `
            <i class="lni lni-calendar"></i>
            <span>${opt.name}</span>
        `;
        optionsContainer.appendChild(option);
    });

    dropdown.appendChild(optionsContainer);
    wrapper.appendChild(displayInput);
    wrapper.appendChild(arrow);
    wrapper.appendChild(dropdown);
    container.appendChild(wrapper);

    const selectOptions = optionsContainer.querySelectorAll('.select-option');

    displayInput.addEventListener('click', function (e) {
        e.stopPropagation();
        toggleHolidayDropdown(wrapper);
    });

    selectOptions.forEach(option => {
        option.addEventListener('click', function (e) {
            e.stopPropagation();
            selectHolidayOption(this, displayInput, wrapper, selectOptions);
        });
    });

    document.addEventListener('click', function (e) {
        if (!wrapper.contains(e.target)) {
            closeHolidayDropdown(wrapper);
        }
    });
}

function toggleHolidayDropdown(wrapper) {
    const isActive = wrapper.classList.contains('active');

    document.querySelectorAll('.custom-select-wrapper.active').forEach(w => {
        if (w !== wrapper) { w.classList.remove('active'); }
    });

    if (isActive) {
        closeHolidayDropdown(wrapper);
    } else {
        wrapper.classList.add('active');
    }
}

function closeHolidayDropdown(wrapper) {
    wrapper.classList.remove('active');
}

function selectHolidayOption(option, displayInput, wrapper, allOptions) {
    const value = option.getAttribute('data-value');
    const text = option.querySelector('span')?.textContent;

    displayInput.value = text;
    displayInput.setAttribute('data-value', value);

    allOptions.forEach(opt => opt.classList.remove('selected'));
    option.classList.add('selected');

    closeHolidayDropdown(wrapper);
}

function removeHoliday(id) {
    const element = document.querySelector(`[data-id="${id}"]`);
    if (element) {
        element.style.animation = 'fadeOut 0.3s ease';
        setTimeout(() => element.remove(), 300);
        console.log(`🗑️ Día festivo eliminado: ${id}`);
    }
}

function collectHolidaysData() {
    const holidayItems = document.querySelectorAll('.holiday-item');
    const holidays = [];

    holidayItems.forEach(item => {
        const monthInput = item.querySelector('[data-field="month"]');
        const dayInput = item.querySelector('[data-field="day"]');
        const nameInput = item.querySelector('[data-field="name"]');

        const month = monthInput?.getAttribute('data-value');
        const day = dayInput?.getAttribute('data-value');
        const name = nameInput?.value;

        if (month && day && name) {
            holidays.push({ month, day, name, date: `${day}/${month}` });
        }
    });

    return holidays;
}

// ============================================
// SAVE BUTTON FUNCTIONALITY
// ============================================

function initSaveButton() {
    const saveBtn = document.getElementById('saveProfileBtn');
    if (saveBtn) {
        saveBtn.addEventListener('click', saveProfile);
    }
}

async function saveProfile(opts = {}) {
    const saveBtn = document.getElementById('saveProfileBtn');
    const originalText = saveBtn.innerHTML;
    if (!opts.silent) {
        saveBtn.innerHTML = `<div class="loading-spinner"></div><span>Guardando...</span>`;
        saveBtn.disabled = true;
    }

    const profileData = {
        branchId: activeBranchId || 0,
        phoneNumber: document.getElementById('phoneNumberInput')?.value || '',
        business: {
            name: document.getElementById('businessNameInput').value,
            type: document.getElementById('businessTypeInput').getAttribute('data-value'),
            description: document.getElementById('descriptionInput').value,
            website: document.getElementById('websiteInput').value,
            email: document.getElementById('emailInput').value,
            logoUrl:   document.getElementById('logoUrlInput')?.value   || '',
            bannerUrl: document.getElementById('bannerUrlInput')?.value || '',
            menuUrl:   document.getElementById('menuUrlInput')?.value   || '',
        },
        schedule: collectScheduleData(),
        holidays: collectHolidaysData(),
        location: {
            address: document.getElementById('addressInput').value,
            betweenStreets: document.getElementById('betweenStreetsInput').value,
            number: document.getElementById('numberInput').value,
            neighborhood: document.getElementById('neighborhoodInput').value,
            city: document.getElementById('cityInput').value,
            state: document.getElementById('stateInput').value,
            country: document.getElementById('countryInput').value,
            postalCode: document.getElementById('postalCodeInput').value
        },
        social: {
            facebook: document.getElementById('facebookInput').value,
            instagram: document.getElementById('instagramInput').value,
            twitter: document.getElementById('twitterInput').value,
            linkedin: document.getElementById('linkedinInput').value
        },
        services: collectServicesData(),
        workers: collectWorkersData()
    };

    try {
        const response = await fetch('/api/my-business', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(profileData)
        });

        const result = await response.json();
        if (!opts.silent) { saveBtn.innerHTML = originalText; saveBtn.disabled = false; }

        if (response.ok && result.success) {
            // Actualizar nombre en el dropdown si cambió
            if (result.branchName) {
                document.getElementById('branchDropdownLabel').textContent = result.branchName;
                document.getElementById('branchBadge').textContent = result.branchName;
                const b = branches.find(b => b.id === activeBranchId);
                if (b) b.branchName = result.branchName;
                // Si es nueva sucursal (branchId=0), agregar a la lista
                if (!activeBranchId && result.branch) {
                    activeBranchId = result.branch.id;
                    branches.push({ id: result.branch.id, branchNumber: result.branch.branchNumber, branchName: result.branchName });
                }
                renderBranchList();
            }

            // Reflejar el giro en el userbar inmediatamente
            const newBusinessType = document.getElementById('businessTypeInput')?.getAttribute('data-value');
            if (newBusinessType && window.userbarUtils?.updateUserData) {
                window.userbarUtils.updateUserData('businessType', newBusinessType);
                updateMenuLabel();
            }

            if (!opts.silent) showNotification('¡Cambios guardados exitosamente!', 'success');
        } else {
            throw new Error(result.error || 'Error desconocido');
        }
    } catch (error) {
        console.error('❌ Error:', error);
        if (!opts.silent) { saveBtn.innerHTML = originalText; saveBtn.disabled = false; }
        showNotification(error.message || 'Error al guardar', 'error');
    }
}

function collectScheduleData() {
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const schedule = {};

    days.forEach(day => {
        const checkbox = document.getElementById(`day-${day}`);
        const openInput = document.getElementById(`time-${day}-open`);
        const closeInput = document.getElementById(`time-${day}-close`);

        schedule[day] = {
            isOpen: checkbox ? checkbox.checked : false,
            open: openInput ? openInput.value : '09:00',
            close: closeInput ? closeInput.value : '20:00'
        };
    });

    return schedule;
}

// ============================================
// NOTIFICATION VIA SILEO
// ============================================

function initSileoViewport() {
    if (!document.getElementById('sileo-vp')) {
        const vp = document.createElement('div');
        vp.id = 'sileo-vp';
        vp.setAttribute('role', 'region');
        vp.setAttribute('aria-live', 'polite');
        document.body.appendChild(vp);
        initRenderer();
    }
}

function showNotification(message, type = 'info') {
    initSileoViewport();
    const titles = {
        success: 'Guardado',
        error:   'Error',
        warning: 'Aviso',
        info:    'Información'
    };
    const opts = { title: titles[type] || 'Aviso', description: message };
    if (Sileo[type]) {
        Sileo[type](opts);
    } else {
        Sileo.info(opts);
    }
}

// ============================================
// ANIMATIONS
// ============================================

// (fadeIn/fadeOut are handled by profile.css keyframes)

// ============================================
// SERVICES
// ============================================

function initServices() {
    document.getElementById('btnAddService')?.addEventListener('click', addServiceItem);
}

function renderServices(services = []) {
    const list = document.getElementById('servicesList');
    const hint = document.getElementById('servicesHint');
    list.innerHTML = '';
    if (services.length === 0) {
        hint && (hint.style.display = 'flex');
        return;
    }
    hint && (hint.style.display = 'none');
    services.forEach((s, i) => addServiceItem(null, s));
}

function addServiceItem(e, data = null) {
    const list = document.getElementById('servicesList');
    const hint = document.getElementById('servicesHint');
    hint && (hint.style.display = 'none');

    const id = Date.now() + Math.random();
    const uid = 'svc_' + id.toString().replace('.', '');
    const div = document.createElement('div');
    div.className = 'service-item';
    div.dataset.serviceId = id;

    const isPromo = data?.priceType === 'promo';
    const inStock = data?.inStock !== false; // true por defecto

    // Periodo de promoción
    const periodType = data?.promoPeriodType || 'days';
    const promoDays  = data?.promoDays || [];
    const promoStart = data?.promoDateStart || '';
    const promoEnd   = data?.promoDateEnd   || '';

    const DAY_OPTS = [
        { val: 'monday',    lbl: 'Lun' },
        { val: 'tuesday',   lbl: 'Mar' },
        { val: 'wednesday', lbl: 'Mié' },
        { val: 'thursday',  lbl: 'Jue' },
        { val: 'friday',    lbl: 'Vie' },
        { val: 'saturday',  lbl: 'Sáb' },
        { val: 'sunday',    lbl: 'Dom' },
    ];
    const daysHTML = DAY_OPTS.map(d => `
        <label class="day-chip ${promoDays.includes(d.val) ? 'active' : ''}">
            <input type="checkbox" value="${d.val}" ${promoDays.includes(d.val) ? 'checked' : ''} style="display:none">
            <span>${d.lbl}</span>
        </label>
    `).join('');

    // Imágenes previas (array)
    const imgUrls = data?.imageUrls || (data?.imageUrl ? [data.imageUrl] : []);

    div.innerHTML = `
        <div class="service-item-row">
            <input type="text" class="info-input service-title" placeholder="Nombre del servicio" value="${data?.title || ''}">
            <label class="stock-toggle" title="${inStock ? 'En existencia' : 'Agotado'}">
                <input type="checkbox" class="service-in-stock" ${inStock ? 'checked' : ''}>
                <span class="stock-slider"></span>
                <span class="stock-label">${inStock ? 'En existencia' : 'Agotado'}</span>
            </label>

            <button type="button" class="btn-remove-item" onclick="removeItem(this, 'servicesList', 'servicesHint')">
                <i class="lni lni-trash-can"></i>
            </button>
        </div>
        <div class="service-item-row">
            <input type="text" class="info-input service-desc" placeholder="Descripción (opcional)" value="${data?.description || ''}">
        </div>
        <div class="service-item-row service-stock-qty-row" style="display:none;align-items:center;gap:10px;">
            <label class="stock-qty-label"><i class="lni lni-layers"></i> Existencias</label>
            <input type="number" class="info-input service-stock-qty" min="0" step="1"
                placeholder="0" value="${data?.stockQty ?? ''}"
                style="width:100px;text-align:center;">
            <span class="stock-qty-unit">unidades</span>
        </div>

        <!-- FOTOS DEL SERVICIO (múltiples) -->
        <div class="service-image-upload" data-uid="${uid}">
            <input type="file" class="service-image-file" id="file_${uid}" accept="image/*" style="display:none" multiple>
            <div class="service-images-grid">
                ${imgUrls.map((url, i) => `
                <div class="service-img-thumb" data-url="${url}">
                    <img src="${url}" alt="Foto ${i+1}" onerror="this.style.display='none';this.nextElementSibling?.remove();this.parentElement.style.background='#f3f4f6';this.parentElement.insertAdjacentHTML('beforeend','<span style=\"font-size:0.7rem;color:#9ca3af;padding:4px\">Sin vista previa</span>')">
                    <button type="button" class="btn-remove-thumb" title="Quitar"><i class="lni lni-close"></i></button>
                </div>`).join('')}
                <div class="service-img-add-btn">
                    <i class="lni lni-camera"></i>
                    <span>Agregar foto</span>
                </div>
            </div>
            <input type="hidden" class="service-image-urls" value="${imgUrls.join(',')}">
            <div class="service-image-uploading" style="display:none">
                <i class="lni lni-spinner-arrow"></i> Subiendo...
            </div>
        </div>

        <!-- PRECIO -->
        <div class="service-price-row">
            <div class="price-type-toggle">
                <button type="button" class="price-type-btn ${!isPromo ? 'active' : ''}" data-type="normal">Normal</button>
                <button type="button" class="price-type-btn ${isPromo ? 'active' : ''}" data-type="promo">Promoción</button>
            </div>
            <div class="price-fields price-normal-fields" style="display:${isPromo ? 'none' : 'flex'}">
                <span class="price-symbol">$</span>
                <input type="number" class="info-input service-price" placeholder="0.00" step="0.01" value="${data?.price || ''}">
            </div>
            <div class="price-fields price-promo-fields" style="display:${isPromo ? 'flex' : 'none'}">
                <span class="price-symbol">$</span>
                <input type="number" class="info-input service-original-price" placeholder="Precio original" step="0.01" value="${data?.originalPrice || ''}">
                <span class="price-arrow">→</span>
                <span class="price-symbol">$</span>
                <input type="number" class="info-input service-promo-price" placeholder="Precio promo" step="0.01" value="${data?.promoPrice || ''}">
            </div>
        </div>

        <!-- PERIODO DE PROMOCIÓN (sólo visible en modo promo) -->
        <div class="promo-period-block" style="display:${isPromo ? 'block' : 'none'}">
            <div class="promo-period-header">
                <i class="lni lni-calendar"></i>
                <span>Disponibilidad de la promoción</span>
                <div class="promo-period-type-toggle">
                    <button type="button" class="period-tab-btn ${periodType === 'days' ? 'active' : ''}" data-period="days">Días de la semana</button>
                    <button type="button" class="period-tab-btn ${periodType === 'range' ? 'active' : ''}" data-period="range">Rango de fechas</button>
                </div>
            </div>

            <div class="promo-days-panel" style="display:${periodType === 'days' ? 'flex' : 'none'}">
                ${daysHTML}
            </div>

            <div class="promo-range-panel" style="display:${periodType === 'range' ? 'flex' : 'none'}">
                <label class="info-label">Desde</label>
                <input type="date" class="info-input promo-date-start" value="${promoStart}">
                <label class="info-label">Hasta</label>
                <input type="date" class="info-input promo-date-end" value="${promoEnd}">
            </div>
        </div>
    `;


    // Toggle Normal / Promo
    div.querySelectorAll('.price-type-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            div.querySelectorAll('.price-type-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            const isP = this.dataset.type === 'promo';
            div.querySelector('.price-normal-fields').style.display = isP ? 'none' : 'flex';
            div.querySelector('.price-promo-fields').style.display = isP ? 'flex' : 'none';
            div.querySelector('.promo-period-block').style.display = isP ? 'block' : 'none';
        });
    });

    // Toggle Días / Rango en el periodo
    div.querySelectorAll('.period-tab-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            div.querySelectorAll('.period-tab-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            const isRange = this.dataset.period === 'range';
            div.querySelector('.promo-days-panel').style.display = isRange ? 'none' : 'flex';
            div.querySelector('.promo-range-panel').style.display = isRange ? 'flex' : 'none';
        });
    });

    // Day chips del periodo de promo
    div.querySelectorAll('.promo-days-panel .day-chip').forEach(chip => {
        chip.addEventListener('click', function(e) {
            e.preventDefault();
            this.classList.toggle('active');
            this.querySelector('input').checked = this.classList.contains('active');
        });
    });

    // ── Upload múltiples imágenes ────────────────────────────────────────────
    const grid      = div.querySelector('.service-images-grid');
    const fileInput = div.querySelector('.service-image-file');
    const urlsInput = div.querySelector('.service-image-urls');
    const uploadingEl = div.querySelector('.service-image-uploading');
    const addBtn    = div.querySelector('.service-img-add-btn');

    // Sync hidden input from current thumbs
    function syncUrls() {
        const urls = [...grid.querySelectorAll('.service-img-thumb')].map(t => t.dataset.url);
        urlsInput.value = urls.join(',');
    }

    // Delegate remove-thumb clicks
    grid.addEventListener('click', function(e) {
        const removeBtn = e.target.closest('.btn-remove-thumb');
        if (removeBtn) {
            e.stopPropagation();
            removeBtn.closest('.service-img-thumb').remove();
            syncUrls();
            return;
        }
        // Click on add button or anywhere else in grid (not on a thumb) → trigger file picker
        if (!e.target.closest('.service-img-thumb')) {
            fileInput.click();
        }
    });

    fileInput.addEventListener('change', async function() {
        const files = [...this.files];
        if (!files.length) return;

        // Validar tamaños
        const oversize = files.filter(f => f.size > 5 * 1024 * 1024);
        if (oversize.length) {
            showNotification('Cada imagen debe ser menor a 5 MB', 'warning');
            return;
        }

        uploadingEl.style.display = 'flex';
        addBtn.style.pointerEvents = 'none';

        try {
            for (const file of files) {
                const formData = new FormData();
                formData.append('image', file);
                const res = await fetch(`/api/upload/service-image?branch_id=${activeBranchId}`, {
                    method: 'POST',
                    credentials: 'include',
                    body: formData,
                });
                if (!res.ok) throw new Error('Upload fallido');
                const result = await res.json();
                addThumb(result.url);
            }
            syncUrls();
            showNotification(files.length > 1 ? `${files.length} imágenes subidas` : 'Imagen subida correctamente', 'success');
        } catch (err) {
            console.error(err);
            showNotification('Error al subir la imagen', 'error');
        } finally {
            uploadingEl.style.display = 'none';
            addBtn.style.pointerEvents = '';
            fileInput.value = '';
        }
    });

    function addThumb(url) {
        const thumb = document.createElement('div');
        thumb.className = 'service-img-thumb';
        thumb.dataset.url = url;
        thumb.innerHTML = `<img src="${url}" alt="Foto" onerror="this.style.opacity='0.3'"><button type="button" class="btn-remove-thumb" title="Quitar"><i class="lni lni-close"></i></button>`;
        // Insert before the add button
        grid.insertBefore(thumb, addBtn);
    }

    // Wire existing remove buttons (loaded from data)
    div.querySelectorAll('.btn-remove-thumb').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            this.closest('.service-img-thumb').remove();
            syncUrls();
        });
    });

    // Toggle de stock — actualizar color del label al cambiar
    const stockCheckbox = div.querySelector('.service-in-stock');
    if (stockCheckbox) {
        // Color inicial
        const stockLabel = div.querySelector('.stock-label');
        if (stockLabel) stockLabel.style.color = stockCheckbox.checked ? '#06b6d4' : '#ef4444';
        // Al cambiar
        stockCheckbox.addEventListener('change', function() {
            const label = this.closest('.stock-toggle').querySelector('.stock-label');
            label.textContent = this.checked ? 'En existencia' : 'Agotado';
            label.style.color = this.checked ? '#06b6d4' : '#ef4444';
            this.closest('.stock-toggle').title = this.checked ? 'En existencia' : 'Agotado';
            refreshInventoryTable();
        });
    }

    // Auto-toggle inStock cuando cambia la cantidad de existencias
    const qtyInput = div.querySelector('.service-stock-qty');
    if (qtyInput) {
        qtyInput.addEventListener('input', function() {
            const qty = parseInt(this.value, 10);
            const cb  = div.querySelector('.service-in-stock');
            if (!cb) return;
            if (!isNaN(qty) && qty === 0) {
                cb.checked = false;
                cb.dispatchEvent(new Event('change'));
            } else if (!isNaN(qty) && qty > 0 && !cb.checked) {
                cb.checked = true;
                cb.dispatchEvent(new Event('change'));
            }
            refreshInventoryTable();
        });
    }

    // Actualizar inventario al cambiar nombre del producto
    div.querySelector('.service-title')?.addEventListener('input', refreshInventoryTable);

    list.appendChild(div);

    // Mostrar existencias solo si es giro de comercio
    const qtyRow = div.querySelector('.service-stock-qty-row');
    if (qtyRow) qtyRow.style.display = isCommerceType() ? 'flex' : 'none';
}

function collectServicesData() {
    const services = [];
    document.querySelectorAll('.service-item').forEach(item => {
        const title = item.querySelector('.service-title')?.value;
        if (!title) return;

        const isPromo = item.querySelector('.price-type-btn.active')?.dataset.type === 'promo';

        // Periodo de promoción
        let promoPeriodType = 'days';
        let promoDays = [];
        let promoDateStart = '';
        let promoDateEnd = '';

        const activePeriodBtn = item.querySelector('.period-tab-btn.active');
        if (activePeriodBtn) {
            promoPeriodType = activePeriodBtn.dataset.period;
        }
        if (promoPeriodType === 'days') {
            item.querySelectorAll('.promo-days-panel .day-chip input:checked').forEach(cb => {
                promoDays.push(cb.value);
            });
        } else {
            promoDateStart = item.querySelector('.promo-date-start')?.value || '';
            promoDateEnd   = item.querySelector('.promo-date-end')?.value || '';
        }

        const inStockEl = item.querySelector('.service-in-stock');
        const stockQtyVal = item.querySelector('.service-stock-qty')?.value;
        services.push({
            title,
            description:    item.querySelector('.service-desc')?.value || '',
            inStock:        inStockEl ? inStockEl.checked : true,
            stockQty:       stockQtyVal !== '' && stockQtyVal !== undefined ? parseInt(stockQtyVal, 10) : null,
            imageUrls:      (item.querySelector('.service-image-urls')?.value || '').split(',').filter(Boolean),
            priceType:      isPromo ? 'promo' : 'normal',
            price:          parseFloat(item.querySelector('.service-price')?.value) || 0,
            originalPrice:  parseFloat(item.querySelector('.service-original-price')?.value) || 0,
            promoPrice:     parseFloat(item.querySelector('.service-promo-price')?.value) || 0,
            promoPeriodType: isPromo ? promoPeriodType : '',
            promoDays:       isPromo && promoPeriodType === 'days' ? promoDays : [],
            promoDateStart:  isPromo && promoPeriodType === 'range' ? promoDateStart : '',
            promoDateEnd:    isPromo && promoPeriodType === 'range' ? promoDateEnd   : '',
        });
    });
    return services;
}

// ============================================
// WORKERS
// ============================================

function initWorkers() {
    document.getElementById('btnAddWorker')?.addEventListener('click', addWorkerItem);
}

function renderWorkers(workers = []) {
    const list = document.getElementById('workersList');
    const hint = document.getElementById('workersHint');
    list.innerHTML = '';
    if (workers.length === 0) {
        hint && (hint.style.display = 'flex');
        return;
    }
    hint && (hint.style.display = 'none');
    workers.forEach(w => addWorkerItem(null, w));
}

const DAY_LABELS = { monday:'Lun', tuesday:'Mar', wednesday:'Mié', thursday:'Jue', friday:'Vie', saturday:'Sáb', sunday:'Dom' };

function addWorkerItem(e, data = null) {
    const list = document.getElementById('workersList');
    const hint = document.getElementById('workersHint');
    hint && (hint.style.display = 'none');

    const div = document.createElement('div');
    div.className = 'worker-item';

    const checkedDays = data?.days || ['monday','tuesday','wednesday','thursday','friday'];
    const daysHTML = Object.entries(DAY_LABELS).map(([val, label]) => `
        <label class="day-chip ${checkedDays.includes(val) ? 'active' : ''}">
            <input type="checkbox" value="${val}" ${checkedDays.includes(val) ? 'checked' : ''} style="display:none">
            <span>${label}</span>
        </label>
    `).join('');

    div.innerHTML = `
        <div class="worker-item-row">
            <input type="text" class="info-input worker-name" placeholder="Nombre del trabajador" value="${data?.name || ''}">
            <button type="button" class="btn-remove-item" onclick="removeItem(this, 'workersList', 'workersHint')">
                <i class="lni lni-trash-can"></i>
            </button>
        </div>
        <div class="worker-item-row worker-times">
            <label class="info-label">De</label>
            <input type="time" class="info-input worker-start" value="${data?.startTime || '09:00'}">
            <label class="info-label">a</label>
            <input type="time" class="info-input worker-end" value="${data?.endTime || '18:00'}">
        </div>
        <div class="worker-days">${daysHTML}</div>
    `;

    div.querySelectorAll('.day-chip').forEach(chip => {
        chip.addEventListener('click', function(e) {
            e.preventDefault();
            this.classList.toggle('active');
            this.querySelector('input').checked = this.classList.contains('active');
        });
    });

    list.appendChild(div);
}

function collectWorkersData() {
    const workers = [];
    document.querySelectorAll('.worker-item').forEach(item => {
        const name = item.querySelector('.worker-name')?.value;
        if (!name) return;
        const days = [];
        item.querySelectorAll('.day-chip input:checked').forEach(cb => days.push(cb.value));
        workers.push({
            name,
            startTime: item.querySelector('.worker-start')?.value || '09:00',
            endTime: item.querySelector('.worker-end')?.value || '18:00',
            days,
        });
    });
    return workers;
}

function removeItem(btn, listId, hintId) {
    btn.closest('[class$="-item"]').remove();
    const list = document.getElementById(listId);
    const hint = document.getElementById(hintId);
    if (hint && list.children.length === 0) hint.style.display = 'flex';
    refreshInventoryTable();
}

// ============================================
// INVENTARIO
// ============================================

function refreshInventoryTable() {
    const tbody  = document.getElementById('invTableBody');
    const empty  = document.getElementById('invEmpty');
    const table  = document.getElementById('invTable');
    if (!tbody) return;

    // Recopilar productos con existencias definidas (solo si es giro comercio)
    const rows = [];
    document.querySelectorAll('.service-item').forEach(item => {
        const title   = item.querySelector('.service-title')?.value?.trim();
        if (!title) return;
        const qtyEl   = item.querySelector('.service-stock-qty');
        const stockCb = item.querySelector('.service-in-stock');
        const imgUrl  = (item.querySelector('.service-image-urls')?.value || '').split(',').filter(Boolean)[0] || '';
        const qty     = qtyEl && qtyEl.value !== '' ? parseInt(qtyEl.value, 10) : null;
        const inStock = stockCb ? stockCb.checked : true;

        rows.push({ title, qty, inStock, imgUrl, item });
    });

    if (rows.length === 0) {
        if (table)  table.style.display  = 'none';
        if (empty)  empty.style.display  = 'flex';
        updateInvSummary(0, 0, 0);
        return;
    }

    if (table)  table.style.display  = 'table';
    if (empty)  empty.style.display  = 'none';

    let cntOk = 0, cntLow = 0, cntOut = 0;

    tbody.innerHTML = rows.map((r, idx) => {
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
    setTxt('invCountOk',  ok);
    setTxt('invCountLow', low);
    setTxt('invCountOut', out);
}

// Ajustar qty desde botones +/-
function invAdjust(rowIdx, delta) {
    const items = [...document.querySelectorAll('.service-item')].filter(item => {
        return item.querySelector('.service-title')?.value?.trim();
    });
    const item = items[rowIdx];
    if (!item) return;
    const qtyInput = item.querySelector('.service-stock-qty');
    if (!qtyInput) return;
    const cur = parseInt(qtyInput.value, 10) || 0;
    const newVal = Math.max(0, cur + delta);
    qtyInput.value = newVal;
    qtyInput.dispatchEvent(new Event('input'));
}

// Ajustar qty directo desde la tabla
function invSetQty(rowIdx, val) {
    const items = [...document.querySelectorAll('.service-item')].filter(item => {
        return item.querySelector('.service-title')?.value?.trim();
    });
    const item = items[rowIdx];
    if (!item) return;
    const qtyInput = item.querySelector('.service-stock-qty');
    if (!qtyInput) return;
    const newVal = Math.max(0, parseInt(val, 10) || 0);
    qtyInput.value = newVal;
    qtyInput.dispatchEvent(new Event('input'));
}

// ============================================
// NINDA BANNER — estado de visibilidad
// ============================================

// Verifica si la sucursal activa tiene pagos configurados
// y actualiza el banner correspondiente.
async function updateNindaBanner(branchId) {
    const banner      = document.getElementById('nindaBanner');
    const noPay       = document.getElementById('nindaBannerNoPay');
    const active      = document.getElementById('nindaBannerActive');
    const storeLink   = document.getElementById('nindaStoreLink');

    if (!banner || !branchId) return;

    try {
        const res = await fetch(`/api/payment-config/${branchId}`, {
            credentials: 'include'
        });

        if (!res.ok) throw new Error('Error obteniendo config de pagos');

        const data = await res.json();

        const hasPayments = data.speiEnabled || (data.stripeEnabled && data.stripeChargesEnabled);

        // Mostrar el banner correcto
        banner.style.display = 'block';

        if (hasPayments) {
            noPay.style.display  = 'none';
            active.style.display = 'flex';
            if (storeLink) {
                storeLink.href = `/ninda/${branchId}`;
            }
        } else {
            noPay.style.display  = 'flex';
            active.style.display = 'none';
        }

    } catch (e) {
        // Si no hay config aún (404/error) → mostrar banner de advertencia
        banner.style.display = 'block';
        noPay.style.display  = 'flex';
        active.style.display = 'none';
        console.warn('[Ninda] No se pudo cargar config de pagos:', e.message);
    }
}

// ============================================================
// BRAND IMAGES — Logo y Banner para Ninda
// ============================================================

function initBrandImages() {
    // ── Banner ────────────────────────────────────────────────
    const bannerFile    = document.getElementById('bannerFileInput');
    const bannerUpBtn   = document.getElementById('bannerUploadBtn');
    const bannerRemBtn  = document.getElementById('bannerRemoveBtn');
    const bannerPreview = document.getElementById('bannerPreview');
    const bannerPrevImg = document.getElementById('bannerPreviewImg');
    const bannerPh      = document.getElementById('bannerPlaceholder');
    const bannerLoad    = document.getElementById('bannerUploading');
    const bannerUrl     = document.getElementById('bannerUrlInput');

    bannerUpBtn?.addEventListener('click', () => bannerFile?.click());

    bannerFile?.addEventListener('change', async function() {
        const file = this.files[0];
        if (!file) return;
        await uploadBrandFile(file, 'banner', {
            urlInput: bannerUrl, preview: bannerPreview,
            previewImg: bannerPrevImg, placeholder: bannerPh, loader: bannerLoad,
        });
        this.value = '';
    });

    bannerRemBtn?.addEventListener('click', () => {
        bannerUrl.value = '';
        bannerPreview.style.display = 'none';
        bannerPh.style.display = 'flex';
    });

    // ── Logo ──────────────────────────────────────────────────
    const logoFile    = document.getElementById('logoFileInput');
    const logoUpBtn   = document.getElementById('logoUploadBtn');
    const logoRemBtn  = document.getElementById('logoRemoveBtn');
    const logoArea    = document.getElementById('logoArea');
    const logoPreview = document.getElementById('logoPreview');
    const logoPrevImg = document.getElementById('logoPreviewImg');
    const logoPh      = document.getElementById('logoPlaceholder');
    const logoLoad    = document.getElementById('logoUploading');
    const logoUrl     = document.getElementById('logoUrlInput');

    logoArea?.addEventListener('click', e => {
        if (e.target.closest('.brand-remove-logo')) return;
        logoFile?.click();
    });
    logoUpBtn?.addEventListener('click', () => logoFile?.click());

    logoFile?.addEventListener('change', async function() {
        const file = this.files[0];
        if (!file) return;
        await uploadBrandFile(file, 'logo', {
            urlInput: logoUrl, preview: logoPreview,
            previewImg: logoPrevImg, placeholder: logoPh, loader: logoLoad,
        });
        this.value = '';
    });

    logoRemBtn?.addEventListener('click', e => {
        e.stopPropagation();
        logoUrl.value = '';
        logoPreview.style.display = 'none';
        logoPh.style.display = 'flex';
    });
}

async function uploadBrandFile(file, type, els) {
    const { urlInput, preview, previewImg, placeholder, loader } = els;
    if (placeholder) placeholder.style.display = 'none';
    if (preview)     preview.style.display = 'none';
    if (loader)      loader.style.display = 'flex';
    try {
        const fd = new FormData();
        fd.append('image', file);
        const res = await fetch(
            `/api/upload/service-image?branch_id=${activeBranchId}&type=${type}`,
            { method: 'POST', credentials: 'include', body: fd }
        );
        if (!res.ok) throw new Error('Upload fallido');
        const { url } = await res.json();
        urlInput.value = url;
        if (previewImg) previewImg.src = url;
        if (preview)    preview.style.display = 'block';
        if (placeholder) placeholder.style.display = 'none';
        showNotification(type === 'logo' ? 'Logo subido' : 'Banner subido', 'success');
    } catch (err) {
        console.error(err);
        showNotification('Error al subir imagen', 'error');
        if (placeholder) placeholder.style.display = 'flex';
    } finally {
        if (loader) loader.style.display = 'none';
    }
}

function loadBrandImages(logoUrl, bannerUrl) {
    const logoUrlEl     = document.getElementById('logoUrlInput');
    const logoPreview   = document.getElementById('logoPreview');
    const logoPrevImg   = document.getElementById('logoPreviewImg');
    const logoPh        = document.getElementById('logoPlaceholder');
    const bannerUrlEl   = document.getElementById('bannerUrlInput');
    const bannerPreview = document.getElementById('bannerPreview');
    const bannerPrevImg = document.getElementById('bannerPreviewImg');
    const bannerPh      = document.getElementById('bannerPlaceholder');

    if (logoUrlEl) logoUrlEl.value = logoUrl || '';
    if (logoUrl) {
        if (logoPrevImg) logoPrevImg.src = logoUrl;
        if (logoPreview) logoPreview.style.display = 'block';
        if (logoPh)      logoPh.style.display = 'none';
    } else {
        if (logoPreview) logoPreview.style.display = 'none';
        if (logoPh)      logoPh.style.display = 'flex';
    }

    if (bannerUrlEl) bannerUrlEl.value = bannerUrl || '';
    if (bannerUrl) {
        if (bannerPrevImg) bannerPrevImg.src = bannerUrl;
        if (bannerPreview) bannerPreview.style.display = 'block';
        if (bannerPh)      bannerPh.style.display = 'none';
    } else {
        if (bannerPreview) bannerPreview.style.display = 'none';
        if (bannerPh)      bannerPh.style.display = 'flex';
    }
}
// ============================================
// MENU UPLOAD
// ============================================

function initMenu() {
    const area      = document.getElementById('menuUploadArea');
    const fileInput = document.getElementById('menuFileInput');
    const placeholder = document.getElementById('menuUploadPlaceholder');
    const btnRemove = document.getElementById('btnRemoveMenu');
    if (!area || !fileInput) return;

    // Click en placeholder → abrir file picker
    placeholder?.addEventListener('click', () => fileInput.click());

    // Drag & drop
    area.addEventListener('dragover', e => { e.preventDefault(); area.classList.add('menu-drag-over'); });
    area.addEventListener('dragleave', () => area.classList.remove('menu-drag-over'));
    area.addEventListener('drop', e => {
        e.preventDefault();
        area.classList.remove('menu-drag-over');
        const file = e.dataTransfer.files[0];
        if (file) handleMenuFile(file);
    });

    fileInput.addEventListener('change', () => {
        if (fileInput.files[0]) handleMenuFile(fileInput.files[0]);
    });

    btnRemove?.addEventListener('click', () => {
        document.getElementById('menuUrlInput').value = '';
        document.getElementById('menuFilePreview').style.display = 'none';
        document.getElementById('menuUploadPlaceholder').style.display = '';
        const v = document.getElementById('menuFileViewer');
        if (v) { v.style.display = 'none'; v.innerHTML = ''; }
        fileInput.value = '';
    });
}

async function handleMenuFile(file) {
    const maxMB = 10;
    if (file.size > maxMB * 1024 * 1024) {
        Sileo?.toast(`El archivo supera ${maxMB}MB`, 'error');
        return;
    }

    // Mostrar preview inmediato
    const isPdf = file.type === 'application/pdf';
    document.getElementById('menuFileIcon').className = isPdf ? 'lni lni-files' : 'lni lni-image';
    document.getElementById('menuFileName').textContent = file.name;
    document.getElementById('menuFileSize').textContent = (file.size / 1024).toFixed(0) + ' KB';
    // Guardar nombre original para mostrarlo al recargar
    const menuOrigNameEl = document.getElementById('menuOriginalName');
    if (menuOrigNameEl) menuOrigNameEl.value = file.name;
    document.getElementById('menuUploadPlaceholder').style.display = 'none';
    document.getElementById('menuFilePreview').style.display = '';
    const localUrl = URL.createObjectURL(file);
    _renderMenuViewer(localUrl, isPdf);
    document.getElementById('menuUploadProgress').style.display = '';
    document.getElementById('menuProgressBar').style.width = '0%';

    try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('type', isPdf ? 'pdf' : 'image');

        // Animar progress (fake)
        let progress = 0;
        const interval = setInterval(() => {
            progress = Math.min(progress + 10, 85);
            document.getElementById('menuProgressBar').style.width = progress + '%';
        }, 150);

        const branchId = activeBranchId || 0;
        const resp = await fetch(`/api/upload/menu?branch_id=${branchId}`, {
            method: 'POST',
            credentials: 'include',
            body: formData
        });

        clearInterval(interval);

        if (!resp.ok) throw new Error('Error al subir el menú');
        const data = await resp.json();
        const url = data.url || data.menuUrl || '';

        document.getElementById('menuProgressBar').style.width = '100%';
        document.getElementById('menuUrlInput').value = url;
        setTimeout(() => {
            document.getElementById('menuUploadProgress').style.display = 'none';
        }, 500);
        await saveProfile({ silent: true });
        showNotification('Menú subido correctamente', 'success');
    } catch (err) {
        console.error('❌ Error subiendo menú:', err);
        document.getElementById('menuUploadProgress').style.display = 'none';
        document.getElementById('menuFilePreview').style.display = 'none';
        document.getElementById('menuUploadPlaceholder').style.display = '';
        Sileo?.toast('Error al subir el menú', 'error');
    }
}

function renderMenuPreview(url) {
    if (!url) return;
    const isPdf = url.toLowerCase().endsWith('.pdf');
    // Preferir nombre original guardado; si no, usar el de la URL
    const origName = document.getElementById('menuOriginalName')?.value || '';
    const urlFileName = url.split('/').pop()?.split('?')[0] || 'menu';
    const fileName = origName || urlFileName;
    document.getElementById('menuFileIcon').className = isPdf ? 'lni lni-files' : 'lni lni-image';
    document.getElementById('menuFileName').textContent = fileName;
    document.getElementById('menuFileSize').textContent = isPdf ? 'PDF' : 'Imagen';
    document.getElementById('menuUploadPlaceholder').style.display = 'none';
    document.getElementById('menuFilePreview').style.display = '';
    document.getElementById('menuUrlInput').value = url;
    _renderMenuViewer(url);
}

// Renderiza iframe (PDF) o img (imagen) en el viewer
async function _renderMenuViewer(url, isPdf) {
    const viewer = document.getElementById('menuFileViewer');
    if (!viewer || !url) return;
    if (isPdf === undefined) isPdf = url.toLowerCase().endsWith('.pdf');
    viewer.style.display = 'block';
    if (isPdf) {
        if (url.startsWith('blob:')) {
            // Archivo local recién subido — directo al iframe
            viewer.innerHTML = `<iframe src="${url}" title="Vista previa del menú"></iframe>`;
        } else {
            // URL del servidor — fetchear como blob para evitar Content-Disposition: attachment
            viewer.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:80px;color:#9ca3af;font-size:.85rem;gap:.5rem"><div class="brand-spinner"></div> Cargando vista previa...</div>`;
            try {
                const resp = await fetch(url, { credentials: 'include', mode: 'cors' });
                if (!resp.ok) throw new Error('fetch failed');
                const blob = await resp.blob();
                const blobUrl = URL.createObjectURL(blob);
                viewer.innerHTML = `<iframe src="${blobUrl}" title="Vista previa del menú"></iframe>`;
            } catch (e) {
                // Fallback: botón para abrir en nueva pestaña
                viewer.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.75rem;padding:1.5rem;color:#6b7280;font-size:.85rem;text-align:center;">
                    <i class="lni lni-files" style="font-size:2rem;color:#06b6d4;"></i>
                    <span>Vista previa no disponible</span>
                    <a href="${url}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:.4rem;padding:.45rem 1rem;border:1.5px solid #06b6d4;border-radius:8px;background:white;color:#06b6d4;font-size:.82rem;font-weight:600;text-decoration:none;">
                        <i class="lni lni-eye"></i> Ver PDF
                    </a>
                </div>`;
            }
        }
    } else {
        viewer.innerHTML = `<img src="${url}" alt="Vista previa del menú">`;
    }
}
/* ============================================
   PAGE TABS — Mi Negocio / Inventario
   ============================================ */
document.querySelectorAll('.page-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const target = tab.dataset.tab;
        document.querySelectorAll('.page-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.page-tab-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        const panel = document.getElementById('tab-' + target);
        if (panel) panel.classList.add('active');
        if (target === 'inventario') refreshInventoryTable();
    });
});

/* ============================================
   CONTABILIDAD
   ============================================ */

// ── Estado local ──────────────────────────────
const acctState = {
    month: new Date().getMonth() + 1,
    year:  new Date().getFullYear(),
    movimientos: [],   // { id, tipo, concepto, monto, fecha, categoria, notas }
    bankTx: [],        // movimientos del banco importados
    sysTx: [],         // movimientos del sistema (pedidos/citas)
};

// ── Init año selector ─────────────────────────
(function initAcctSelectors() {
    const yearSel  = document.getElementById('acctYear');
    const monthSel = document.getElementById('acctMonth');
    if (!yearSel || !monthSel) return;
    const now = new Date();
    for (let y = now.getFullYear(); y >= now.getFullYear() - 4; y--) {
        const opt = document.createElement('option');
        opt.value = y; opt.textContent = y;
        yearSel.appendChild(opt);
    }
    monthSel.value = now.getMonth() + 1;
    yearSel.value  = now.getFullYear();
    loadFromLocalStorage();
})();

// ── Persistencia local ────────────────────────
function acctStorageKey() {
    const m = document.getElementById('acctMonth')?.value;
    const y = document.getElementById('acctYear')?.value;
    return `attomos_acct_${y}_${m}`;
}

function saveToLocalStorage() {
    try { localStorage.setItem(acctStorageKey(), JSON.stringify(acctState.movimientos)); } catch(_) {}
}

function loadFromLocalStorage() {
    try {
        const data = localStorage.getItem(acctStorageKey());
        if (data) { acctState.movimientos = JSON.parse(data); acctRender(); }
    } catch(_) {}
}

// ── Cargar periodo ────────────────────────────
document.getElementById('acctLoadBtn')?.addEventListener('click', async () => {
    loadFromLocalStorage();
    await acctLoadSysTx();
    acctRender();
});

async function acctLoadSysTx() {
    const m = document.getElementById('acctMonth')?.value;
    const y = document.getElementById('acctYear')?.value;
    try {
        const resp = await fetch(`/api/orders?month=${m}&year=${y}`, { credentials: 'include' });
        if (!resp.ok) throw new Error();
        const data = await resp.json();
        acctState.sysTx = (data.orders || []).map(o => ({
            fecha:       o.createdAt?.split('T')[0] || '',
            descripcion: `Pedido #${o.id || ''} — ${o.customerName || 'Cliente'}`,
            monto:       parseFloat(o.totalAmount || o.total || 0),
            tipo:        'ingreso',
            conciliado:  false,
        }));
    } catch(_) { acctState.sysTx = []; }
    renderSysTx();
}

// ── Render principal ──────────────────────────
function acctRender() {
    const movs = acctState.movimientos;
    const ingresos = movs.filter(m => m.tipo === 'ingreso');
    const egresos  = movs.filter(m => m.tipo === 'egreso');

    const totalIngresos = ingresos.reduce((s, m) => s + m.monto, 0);
    const totalEgresos  = egresos.reduce((s, m) => s + m.monto, 0);
    const utilidad      = totalIngresos - totalEgresos;

    // KPIs
    setText('kpiIngresos',     fmt(totalIngresos));
    setText('kpiEgresos',      fmt(totalEgresos));
    setText('kpiUtilidad',     fmt(utilidad));
    setText('kpiTransacciones', movs.length);

    // Utilidad color
    const utilCard = document.getElementById('kpiUtilCard');
    if (utilCard) {
        utilCard.className = 'acct-kpi-card ' + (utilidad >= 0 ? 'blue' : 'red');
    }

    renderEstadoResultados(ingresos, egresos, totalIngresos, totalEgresos, utilidad);
    renderFlujo(ingresos, egresos, totalIngresos, totalEgresos, utilidad);
    updateSaldoLibros(totalIngresos - totalEgresos);
}

function renderEstadoResultados(ingresos, egresos, totI, totE, util) {
    setText('erTotalIngresos', fmt(totI));
    setText('erTotalEgresos',  fmt(totE));
    const utilEl = document.getElementById('erUtilidad');
    if (utilEl) {
        utilEl.textContent = fmt(util);
        utilEl.style.color = util >= 0 ? '#06b6d4' : '#ef4444';
    }

    renderErRows('erIngresosRows', ingresos, 'ingreso');
    renderErRows('erEgresosRows',  egresos,  'egreso');
}

function renderErRows(containerId, items, tipo) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (items.length === 0) {
        el.innerHTML = `<div class="acct-er-empty">Sin ${tipo === 'ingreso' ? 'ingresos' : 'egresos'} registrados.</div>`;
        return;
    }
    el.innerHTML = items.map((m, i) => `
        <div class="acct-er-row">
            <span class="acct-er-row-concepto">${m.concepto}</span>
            ${m.categoria ? `<span class="acct-er-row-cat">${m.categoria}</span>` : ''}
            <span class="acct-er-row-monto ${tipo}">${tipo === 'ingreso' ? '+' : '-'}${fmt(m.monto)}</span>
            <div class="acct-er-row-actions">
                <button class="acct-er-row-del" onclick="acctDelMov(${m._idx})" title="Eliminar">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:.75rem;height:.75rem;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>
        </div>
    `).join('');
}

function renderFlujo(ingresos, egresos, totI, totE, util) {
    setText('flujoTotalEntradas', fmt(totI));
    setText('flujoTotalSalidas',  fmt(totE));
    const netoEl = document.getElementById('flujoNeto');
    if (netoEl) { netoEl.textContent = fmt(util); netoEl.style.color = util >= 0 ? '#06b6d4' : '#ef4444'; }

    renderFlujoRows('flujoEntradas', ingresos);
    renderFlujoRows('flujoSalidas',  egresos);
}

function renderFlujoRows(containerId, items) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (items.length === 0) {
        el.innerHTML = '<div class="acct-er-empty">Sin datos.</div>';
        return;
    }
    el.innerHTML = items.map(m => `
        <div class="acct-er-row">
            <span class="acct-er-row-concepto">${m.concepto}</span>
            <span class="acct-er-row-monto">${fmt(m.monto)}</span>
        </div>
    `).join('');
}

function renderSysTx() {
    const tbody = document.getElementById('sysTxBody');
    if (!tbody) return;
    if (acctState.sysTx.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="acct-table-empty">Sin movimientos del sistema en este periodo.</td></tr>';
        return;
    }
    tbody.innerHTML = acctState.sysTx.map(t => `
        <tr>
            <td>${t.fecha}</td>
            <td>${t.descripcion}</td>
            <td style="color:#16a34a;font-weight:600;">${fmt(t.monto)}</td>
            <td><span class="concil-badge ok">Ingreso</span></td>
            <td><span class="concil-badge ${t.conciliado ? 'ok' : 'pendiente'}">${t.conciliado ? '✓ Conciliado' : 'Pendiente'}</span></td>
        </tr>
    `).join('');
}

function updateSaldoLibros(saldo) {
    const el = document.getElementById('saldoLibros');
    if (el) { el.textContent = fmt(saldo); el.style.color = saldo >= 0 ? '#1a1a1a' : '#ef4444'; }
    calcDiff();
}

function calcDiff() {
    const banco  = parseFloat(document.getElementById('saldoBanco')?.value || 0);
    const movs   = acctState.movimientos;
    const libros = movs.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + m.monto, 0)
                 - movs.filter(m => m.tipo === 'egreso').reduce((s, m) => s + m.monto, 0);
    const diff   = banco - libros;
    const el     = document.getElementById('acctDiff');
    if (el) {
        el.textContent = fmt(diff);
        el.className   = 'acct-concil-diff-val' + (Math.abs(diff) < 0.01 ? '' : ' negative');
    }
}
document.getElementById('saldoBanco')?.addEventListener('input', calcDiff);

// ── Sub-tabs ──────────────────────────────────
document.querySelectorAll('.acct-subtab').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.acct-subtab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.acct-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        const panel = document.getElementById('acct-' + btn.dataset.acct);
        if (panel) panel.classList.add('active');
    });
});

// ── Modal movimiento ──────────────────────────
let _acctMovType = 'ingreso';

document.getElementById('btnAddIngreso')?.addEventListener('click', () => openMovModal('ingreso'));

function openMovModal(tipo = 'ingreso') {
    _acctMovType = tipo;
    const modal = document.getElementById('acctMovModal');
    if (!modal) return;
    modal.style.display = 'flex';
    document.getElementById('movConcepto').value  = '';
    document.getElementById('movMonto').value     = '';
    document.getElementById('movFecha').value     = new Date().toISOString().split('T')[0];
    document.getElementById('movCategoria').value = '';
    document.getElementById('movNotas').value     = '';
    // Set type button
    document.querySelectorAll('.acct-mov-type').forEach(b => {
        b.classList.toggle('active', b.dataset.type === tipo);
    });
}

function closeMovModal() {
    const modal = document.getElementById('acctMovModal');
    if (modal) modal.style.display = 'none';
}

document.querySelectorAll('.acct-mov-type').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.acct-mov-type').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _acctMovType = btn.dataset.type;
    });
});

document.getElementById('acctMovSubmit')?.addEventListener('click', () => {
    const concepto  = document.getElementById('movConcepto')?.value.trim();
    const monto     = parseFloat(document.getElementById('movMonto')?.value || 0);
    const fecha     = document.getElementById('movFecha')?.value || '';
    const categoria = document.getElementById('movCategoria')?.value || '';
    const notas     = document.getElementById('movNotas')?.value.trim() || '';

    if (!concepto) { alert('Escribe un concepto para el movimiento.'); return; }
    if (!monto || monto <= 0) { alert('Escribe un monto válido.'); return; }

    const mov = { _idx: acctState.movimientos.length, tipo: _acctMovType, concepto, monto, fecha, categoria, notas };
    acctState.movimientos.push(mov);
    // Re-index
    acctState.movimientos.forEach((m, i) => m._idx = i);

    saveToLocalStorage();
    acctRender();
    closeMovModal();
});

// ── Eliminar movimiento ───────────────────────
function acctDelMov(idx) {
    if (!confirm('¿Eliminar este movimiento?')) return;
    acctState.movimientos.splice(idx, 1);
    acctState.movimientos.forEach((m, i) => m._idx = i);
    saveToLocalStorage();
    acctRender();
}

// ── Importar CSV banco ────────────────────────
document.getElementById('bankUploadArea')?.addEventListener('click', () => {
    document.getElementById('bankFileInput')?.click();
});

document.getElementById('bankFileInput')?.addEventListener('change', function() {
    const file = this.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        const lines = e.target.result.split('\n').filter(Boolean);
        const rows  = lines.slice(1).map(line => {
            const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
            return { fecha: cols[0]||'', descripcion: cols[1]||'', cargo: parseFloat(cols[2])||0, abono: parseFloat(cols[3])||0, saldo: parseFloat(cols[4])||0, conciliado: false };
        }).filter(r => r.descripcion);
        acctState.bankTx = rows;
        renderBankTx();
    };
    reader.readAsText(file);
});

function renderBankTx() {
    const tbody = document.getElementById('bankTxBody');
    const table = document.getElementById('bankTxTable');
    const upload = document.getElementById('bankUploadArea');
    if (!tbody || !table) return;

    if (acctState.bankTx.length === 0) {
        table.style.display = 'none';
        if (upload) upload.style.display = 'flex';
        return;
    }
    if (upload) upload.style.display = 'none';
    table.style.display = 'table';

    tbody.innerHTML = acctState.bankTx.map((t, i) => `
        <tr>
            <td>${t.fecha}</td>
            <td>${t.descripcion}</td>
            <td style="color:#ef4444;">${t.cargo > 0 ? fmt(t.cargo) : ''}</td>
            <td style="color:#16a34a;">${t.abono > 0 ? fmt(t.abono) : ''}</td>
            <td>
                <span class="concil-badge ${t.conciliado ? 'ok' : 'pendiente'}"
                      style="cursor:pointer;"
                      onclick="acctToggleBankConcil(${i})">
                    ${t.conciliado ? '✓ Conciliado' : 'Pendiente'}
                </span>
            </td>
            <td>
                <button class="acct-er-row-del" onclick="acctDelBankTx(${i})" title="Eliminar">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:.75rem;height:.75rem;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </td>
        </tr>
    `).join('');
}

function acctToggleBankConcil(i) {
    acctState.bankTx[i].conciliado = !acctState.bankTx[i].conciliado;
    renderBankTx();
}
function acctDelBankTx(i) {
    acctState.bankTx.splice(i, 1);
    renderBankTx();
}

// ── Exportar CSV ──────────────────────────────
document.getElementById('acctExportBtn')?.addEventListener('click', () => {
    const m = document.getElementById('acctMonth')?.value;
    const y = document.getElementById('acctYear')?.value;
    const rows = [['Tipo','Concepto','Monto','Fecha','Categoria','Notas']];
    acctState.movimientos.forEach(mv => {
        rows.push([mv.tipo, mv.concepto, mv.monto.toFixed(2), mv.fecha, mv.categoria, mv.notas]);
    });
    const csv  = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: `contabilidad_${y}_${m}.csv` });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
});

// ── Helpers ───────────────────────────────────
function fmt(n) {
    return '$' + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}
// ============================================
// REPAIRDESK INVENTORY SYNC — My Business
// ============================================

// Al cargar la página: verificar si hay integración activa
document.addEventListener('DOMContentLoaded', function () {
    initRepairDeskInventory();
});

async function initRepairDeskInventory() {
    try {
        // Obtener el primer agente disponible para consultar el status
        const res = await fetch('/api/agents', { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        const agents = data.agents || [];
        if (!agents.length) return;

        // Usar el primer agente conectado (mismo criterio que integrations.js)
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
            // Mostrar botón Sync RepairDesk en la cabecera del inventario
            if (syncBtn) {
                syncBtn.style.display = 'inline-flex';
                syncBtn.setAttribute('data-agent-id', agentId);
                syncBtn.onclick = () => syncRepairDeskInventory(agentId);
            }
            // Cargar productos ya sincronizados
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

        // Recargar tabla
        await loadRepairDeskInventory(agentId);

        // Toast
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
    const section  = document.getElementById('rdInventorySection');
    const tbody    = document.getElementById('rdInvTableBody');
    const table    = document.getElementById('rdInvTable');
    const empty    = document.getElementById('rdInvEmpty');
    const syncLbl  = document.getElementById('rdLastSyncLabel');

    if (!section) return;
    section.style.display = 'block';

    if (syncLbl && lastSync) {
        const d = new Date(lastSync);
        syncLbl.innerHTML = `<i class="lni lni-reload"></i> Último sync: ${d.toLocaleDateString('es-MX', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })}`;
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