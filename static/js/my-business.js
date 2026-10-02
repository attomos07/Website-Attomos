// ============================================
// PROFILE JAVASCRIPT
// ============================================

// Estado global de sucursales
let branches = [];
let activeBranchId = null;

// Expuesto para que api-explorer.js (si va embebido en esta misma página)
// reutilice la sucursal activa en vez de pedir /api/my-business otra vez.
window.getActiveBranchId = () => activeBranchId || null;

document.addEventListener('DOMContentLoaded', function () {
    console.log('🔧 Profile JS cargado correctamente');

    initBranchSelector();
    initCustomSelect();
    initLocationDropdowns();
    initSchedule();
    initHolidays();
    initServices();
    startServicesAutoRefresh();
    initWorkers();
    initSaveButton();
    initBrandImages();

    // Re-apply translations after all dynamic content is rendered
    if (window.Translations) window.Translations.apply(getLang());
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

function getLang() {
    return localStorage.getItem('attomos_lang') || localStorage.getItem('lang') || 'es';
}
function t(key, fallback) {
    return window.Translations?.dict?.[getLang()]?.[key] || fallback;
}

// Si el nombre de la sucursal es el default genérico ("Sucursal N" en
// cualquier idioma en que se haya creado), lo traducimos al idioma activo.
// Si el usuario le puso un nombre propio, lo dejamos tal cual.
const BRANCH_DEFAULT_WORDS = ['Sucursal','Branch','Филиал','Filial','支店','分店','Succursale','Filiale','지점'];
function displayBranchName(branchName, branchNumber) {
    const branchWord = t('mybiz_branch_default','Sucursal');
    if (!branchName) return branchWord + ' ' + branchNumber;
    const match = branchName.match(/^(.+?)\s+(\d+)$/);
    if (match && BRANCH_DEFAULT_WORDS.includes(match[1].trim())) {
        return branchWord + ' ' + match[2];
    }
    return branchName;
}

const MONTHS = [
    { value: '01', name: t('month_jan','Enero') },
    { value: '02', name: t('month_feb','Febrero') },
    { value: '03', name: t('month_mar','Marzo') },
    { value: '04', name: t('month_apr','Abril') },
    { value: '05', name: t('month_may','Mayo') },
    { value: '06', name: t('month_jun','Junio') },
    { value: '07', name: t('month_jul','Julio') },
    { value: '08', name: t('month_aug','Agosto') },
    { value: '09', name: t('month_sep','Septiembre') },
    { value: '10', name: t('month_oct','Octubre') },
    { value: '11', name: t('month_nov','Noviembre') },
    { value: '12', name: t('month_dec','Diciembre') }
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
        list.innerHTML = `<div class="branch-item-empty">${t('mybiz_no_branches','Sin sucursales guardadas')}</div>`;
        return;
    }

    branches.forEach(b => {
        const item = document.createElement('div');
        item.className = 'branch-item' + (b.id === activeBranchId ? ' active' : '');
        item.dataset.branchId = b.id;
        item.innerHTML = `
            <i class="lni lni-map-marker"></i>
            <span>${displayBranchName(b.branchName, b.branchNumber)}</span>
            ${b.branchNumber > 1 ? `<button type="button" class="btn-delete-branch" data-id="${b.id}" title="${t('mybiz_delete_tooltip','Eliminar')}"><i class="lni lni-trash-can"></i></button>` : ''}
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
            showNotification(t('mybiz_branch_created','Nueva sucursal creada'), 'success');
        }
    } catch(e) {
        console.error('Error creando sucursal', e);
    }
}

async function deleteBranch(branchId) {
    if (!confirm(t('mybiz_delete_branch_confirm','¿Eliminar esta sucursal?'))) return;
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
            showNotification(t('mybiz_branch_deleted','Sucursal eliminada'), 'success');
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
    h2.textContent = catalogoGiros.includes(giro) ? t('mybiz_catalog_title','Catálogo') : t('mybiz_menu_title','Menú');
}

function loadBranchData(branch) {
    // Actualizar label del dropdown
    const label = displayBranchName(branch.branchName, branch.branchNumber);
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
        const branchWord = t('mybiz_branch_default','Sucursal');
        const newName = addr ? branchWord + ' ' + addr : (branchWord + ' ' + (branch.branchNumber || 1));
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
    createLocationDropdown('countryInput', COUNTRIES, t('mybiz_select_country','Selecciona un país'));
    createLocationDropdown('stateInput', STATES_MEXICO.map(s => ({ value: s.toLowerCase().replace(/\s+/g, '-'), name: s })), t('mybiz_select_state','Selecciona un estado'));
    createLocationDropdown('cityInput', CITIES_SONORA.map(c => ({ value: c.toLowerCase().replace(/\s+/g, '-'), name: c })), t('mybiz_select_city','Selecciona una ciudad'));
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
        { name: t('day_monday','Lunes'), key: 'monday' },
        { name: t('day_tuesday','Martes'), key: 'tuesday' },
        { name: t('day_wednesday','Miércoles'), key: 'wednesday' },
        { name: t('day_thursday','Jueves'), key: 'thursday' },
        { name: t('day_friday','Viernes'), key: 'friday' },
        { name: t('day_saturday','Sábado'), key: 'saturday' },
        { name: t('day_sunday','Domingo'), key: 'sunday' }
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
                <span class="toggle-label" data-translate="mybiz_open">Abierto</span>
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
                <input type="text" class="holiday-name-input" data-field="name" placeholder="${t('mybiz_holiday_name','Nombre del día festivo')}">
            </div>
        </div>
        <button type="button" class="btn-remove-holiday" data-remove="${id}">
            <i class="lni lni-trash-can"></i>
        </button>
    `;

    container.appendChild(div);

    createHolidayDropdown(`month-${id}`, MONTHS, t('mybiz_month','Mes'), id);

    const days = [];
    for (let i = 1; i <= 31; i++) {
        days.push({ value: String(i).padStart(2, '0'), name: String(i) });
    }
    createHolidayDropdown(`day-${id}`, days, t('mybiz_day','Día'), id);

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
        saveBtn.innerHTML = `<div class="loading-spinner"></div><span>${t('mybiz_saving','Guardando...')}</span>`;
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

            if (!opts.silent) {
                // El guardado en sí ya avisa al bot por WebSocket
                // (SaveMyBusiness → syncAtomicBots en el backend), que lo
                // toma al instante sin redeploy. Ya NO llamamos a
                // autoRedeployAgentsAfterSave() aquí: ese redeploy completo
                // recompila, reinicia, y además borra la sesión de WhatsApp
                // del bot (forzando reescanear el QR) — innecesario para un
                // simple cambio de datos del negocio.
                showNotification('¡Cambios guardados exitosamente!', 'success');
            }
        } else {
            throw new Error(result.error || 'Error desconocido');
        }
    } catch (error) {
        console.error('❌ Error:', error);
        if (!opts.silent) { saveBtn.innerHTML = originalText; saveBtn.disabled = false; }
        showNotification(error.message || 'Error al guardar', 'error');
    }
}

// ============================================
// REDEPLOY DE AGENTES TRAS ACTUALIZAR EL NEGOCIO
// ============================================
let _onboardingScriptLoadedForBusiness = false;

// onboarding.js trae watchAgentRedeployToast/ensureModalsExist (toast de
// Sileo con progreso — no el modal grande, que es solo para creación nueva
// o el botón manual de "Redeploy" en Mis Agentes). Se carga bajo demanda
// porque my-business.html no lo incluye por defecto.
async function ensureOnboardingScriptLoadedForBusiness() {
    if (_onboardingScriptLoadedForBusiness || typeof window.watchAgentRedeployToast === 'function') {
        _onboardingScriptLoadedForBusiness = true;
        return;
    }
    await new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = '/static/js/onboarding.js?v=' + Date.now();
        script.onload  = () => { _onboardingScriptLoadedForBusiness = true; resolve(); };
        script.onerror = () => resolve(); // si falla, watchAgentRedeployToast no existirá y hacemos fallback
        document.body.appendChild(script);
    });
}

// Tras guardar cambios del negocio, se redeploya automáticamente TODOS los
// agentes del usuario (sin pedir confirmación) para que tomen la nueva info,
// igual que ocurre al editar un agente individual desde "Detalles del Agente".
async function autoRedeployAgentsAfterSave() {
    try {
        const res = await fetch('/api/agents', { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        const agents = data.agents || [];
        if (!agents.length) return;

        await redeployAgentsList(agents);
    } catch (err) {
        console.error('No se pudo redeployar los agentes tras guardar el negocio:', err);
    }
}

async function redeployAgentsList(agents) {
    if (!agents.length) return;

    // Un solo agente → mostramos el flujo completo: animación de progreso y,
    // si es de WhatsApp, el modal de QR automáticamente al terminar.
    if (agents.length === 1) {
        const agent = agents[0];
        try {
            const resp = await fetch(`/api/agents/${agent.id}/redeploy`, {
                method: 'POST',
                credentials: 'include'
            });
            if (!resp.ok) throw new Error('Error al iniciar el redeploy');

            if (agent.botType === 'atomic') {
                await ensureOnboardingScriptLoadedForBusiness();
                if (typeof window.watchAgentRedeployToast === 'function') {
                    window.watchAgentRedeployToast(agent.id, agent.name);
                    return; // el propio toast se encarga de avisar cuando termine
                }
            }
            showNotification('Agente actualizado con la nueva información del negocio.', 'success');
        } catch (err) {
            console.error('Error en redeploy de agente:', err);
            showNotification('No se pudo actualizar el agente, intenta de nuevo desde "Mis Agentes".', 'error');
        }
        return;
    }

    // Varios agentes → redeploy en lote (sin apilar varios modales de QR).
    // Los que sean de WhatsApp mostrarán su QR automáticamente al entrar a
    // "Mis Agentes", gracias a la detección que ya corre en esa página.
    showNotification(`Actualizando ${agents.length} agentes con la nueva información...`, 'info');
    const results = await Promise.allSettled(
        agents.map(a => fetch(`/api/agents/${a.id}/redeploy`, { method: 'POST', credentials: 'include' }))
    );
    const failed = results.filter(r => r.status === 'rejected' || (r.value && !r.value.ok)).length;

    if (failed === 0) {
        showNotification(`${agents.length} agentes actualizándose. Ve a "Mis Agentes" para vincular el WhatsApp de los que lo necesiten.`, 'success');
    } else {
        showNotification(`${agents.length - failed} de ${agents.length} agentes se actualizaron correctamente.`, 'warning');
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

// ============================================
// AUTO-REFRESCO DE SERVICIOS
// Los productos sincronizados desde el inventario de Sheets (fromSheetRow>0)
// pueden cambiar en cualquier momento desde allá. En vez de que el usuario
// tenga que recargar la página para verlo, refrescamos solo la lista de
// servicios cada cierto tiempo — sin tocarla si está escribiendo dentro de
// esa sección justo en ese momento (para no interrumpir una edición).
// ============================================

let servicesAutoRefreshTimer = null;
const SERVICES_AUTO_REFRESH_MS = 20000; // 20s

function startServicesAutoRefresh() {
    stopServicesAutoRefresh();
    servicesAutoRefreshTimer = setInterval(() => {
        if (document.hidden) return;
        if (!activeBranchId) return;
        const list = document.getElementById('servicesList');
        if (list && list.contains(document.activeElement)) return; // no interrumpe una edición en curso
        refreshServicesOnly();
    }, SERVICES_AUTO_REFRESH_MS);
}

function stopServicesAutoRefresh() {
    if (servicesAutoRefreshTimer) {
        clearInterval(servicesAutoRefreshTimer);
        servicesAutoRefreshTimer = null;
    }
}

async function refreshServicesOnly() {
    if (!activeBranchId) return;
    try {
        const res = await fetch(`/api/my-business/${activeBranchId}`, { credentials: 'include', cache: 'no-store' });
        if (!res.ok) return;
        const branch = await res.json();
        renderServices(branch.services || []);
    } catch (e) {
        console.warn('No se pudieron refrescar los productos:', e);
    }
}

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

// ── Precios con separador de miles ──
// Al mostrar: "949000" -> "949,000". Al enfocar el campo se le quitan las
// comas (para editar cómodo), y al salir se le vuelven a poner.
function formatPriceDisplay(value) {
    if (value === '' || value === null || value === undefined) return '';
    const num = parseFloat(String(value).toString().replace(/,/g, ''));
    if (isNaN(num)) return '';
    return num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function parsePriceValue(value) {
    const num = parseFloat(String(value || '').replace(/,/g, ''));
    return isNaN(num) ? 0 : num;
}

function initPriceInputFormatting(scope) {
    (scope || document).querySelectorAll('.price-input').forEach(input => {
        if (input.dataset.priceFormatBound) return;
        input.dataset.priceFormatBound = '1';
        input.addEventListener('focus', () => {
            input.value = input.value.replace(/,/g, '');
        });
        input.addEventListener('blur', () => {
            if (input.value !== '') input.value = formatPriceDisplay(input.value);
        });
    });
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
    div.dataset.fromSheetRow = data?.fromSheetRow || 0;
    if (data?.fromSheetRow) div.classList.add('service-from-inventory');

    const isPromo = data?.priceType === 'promo';
    const inStock = data?.inStock !== false; // true por defecto

    // Periodo de promoción
    const periodType = data?.promoPeriodType || 'days';
    const promoDays  = data?.promoDays || [];
    const promoStart = data?.promoDateStart || '';
    const promoEnd   = data?.promoDateEnd   || '';

    const DAY_OPTS = [
        { val: 'monday',    lbl: t('day_mon_abbr','Lun') },
        { val: 'tuesday',   lbl: t('day_tue_abbr','Mar') },
        { val: 'wednesday', lbl: t('day_wed_abbr','Mié') },
        { val: 'thursday',  lbl: t('day_thu_abbr','Jue') },
        { val: 'friday',    lbl: t('day_fri_abbr','Vie') },
        { val: 'saturday',  lbl: t('day_sat_abbr','Sáb') },
        { val: 'sunday',    lbl: t('day_sun_abbr','Dom') },
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
        ${data?.fromSheetRow ? `<div class="service-sync-badge" title="Este producto se actualiza solo desde tu inventario de Sheets"><i class="lni lni-reload"></i> Sincronizado desde inventario</div>` : ''}
        <div class="service-item-row">
            <input type="text" class="info-input service-title" placeholder="${t('mybiz_service_name','Nombre del servicio')}" value="${data?.title || ''}">
            <label class="stock-toggle" title="${inStock ? t('mybiz_in_stock','En existencia') : t('mybiz_out_of_stock','Agotado')}">
                <input type="checkbox" class="service-in-stock" ${inStock ? 'checked' : ''}>
                <span class="stock-slider"></span>
                <span class="stock-label">${inStock ? t('mybiz_in_stock','En existencia') : t('mybiz_out_of_stock','Agotado')}</span>
            </label>

            <button type="button" class="btn-remove-item" onclick="removeItem(this, 'servicesList', 'servicesHint')">
                <i class="lni lni-trash-can"></i>
            </button>
        </div>
        <div class="service-item-row">
            <input type="text" class="info-input service-desc" placeholder="${t('mybiz_desc_optional','Descripción (opcional)')}" value="${data?.description || ''}">
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
                    <span>${t('mybiz_add_photo','Agregar foto')}</span>
                </div>
            </div>
            <input type="hidden" class="service-image-urls" value="${imgUrls.join(',')}">
            <div class="service-image-uploading" style="display:none">
                <i class="lni lni-spinner-arrow"></i> ${t('mybiz_uploading','Subiendo...')}
            </div>
        </div>

        <!-- PRECIO -->
        <div class="service-price-row">
            <div class="price-type-toggle">
                <button type="button" class="price-type-btn ${!isPromo ? 'active' : ''}" data-type="normal">${t('mybiz_price_normal','Normal')}</button>
                <button type="button" class="price-type-btn ${isPromo ? 'active' : ''}" data-type="promo">${t('mybiz_price_promo','Promoción')}</button>
            </div>
            <div class="price-fields price-normal-fields" style="display:${isPromo ? 'none' : 'flex'}">
                <span class="price-symbol">$</span>
                <input type="text" inputmode="decimal" class="info-input service-price price-input" placeholder="0.00" value="${formatPriceDisplay(data?.price)}">
            </div>
            <div class="price-fields price-promo-fields" style="display:${isPromo ? 'flex' : 'none'}">
                <span class="price-symbol">$</span>
                <input type="text" inputmode="decimal" class="info-input service-original-price price-input" placeholder="Precio original" value="${formatPriceDisplay(data?.originalPrice)}">
                <span class="price-arrow">→</span>
                <span class="price-symbol">$</span>
                <input type="text" inputmode="decimal" class="info-input service-promo-price price-input" placeholder="Precio promo" value="${formatPriceDisplay(data?.promoPrice)}">
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
            label.textContent = this.checked ? t('mybiz_in_stock','En existencia') : t('mybiz_out_of_stock','Agotado');
            label.style.color = this.checked ? '#06b6d4' : '#ef4444';
            this.closest('.stock-toggle').title = this.checked ? t('mybiz_in_stock','En existencia') : t('mybiz_out_of_stock','Agotado');
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
    initPriceInputFormatting(div);

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
            price:          parsePriceValue(item.querySelector('.service-price')?.value),
            originalPrice:  parsePriceValue(item.querySelector('.service-original-price')?.value),
            promoPrice:     parsePriceValue(item.querySelector('.service-promo-price')?.value),
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

const DAY_LABELS = () => ({ monday:t('day_sun_abbr','Lun'), tuesday:t('day_tue_abbr','Mar'), wednesday:t('day_wed_abbr','Mié'), thursday:t('day_thu_abbr','Jue'), friday:t('day_fri_abbr','Vie'), saturday:t('day_sat_abbr','Sáb'), sunday:t('day_sun_abbr','Dom') });

function addWorkerItem(e, data = null) {
    const list = document.getElementById('workersList');
    const hint = document.getElementById('workersHint');
    hint && (hint.style.display = 'none');

    const div = document.createElement('div');
    div.className = 'worker-item';

    const checkedDays = data?.days || ['monday','tuesday','wednesday','thursday','friday'];
    const daysHTML = Object.entries(DAY_LABELS()).map(([val, label]) => `
        <label class="day-chip ${checkedDays.includes(val) ? 'active' : ''}">
            <input type="checkbox" value="${val}" ${checkedDays.includes(val) ? 'checked' : ''} style="display:none">
            <span>${label}</span>
        </label>
    `).join('');

    div.innerHTML = `
        <div class="worker-item-row">
            <input type="text" class="info-input worker-name" placeholder="${t('mybiz_worker_name','Nombre del trabajador')}" value="${data?.name || ''}">
            <button type="button" class="btn-remove-item" onclick="removeItem(this, 'workersList', 'workersHint')">
                <i class="lni lni-trash-can"></i>
            </button>
        </div>
        <div class="worker-item-row worker-times">
            <label class="info-label">${t('mybiz_from','De')}</label>
            <input type="time" class="info-input worker-start" value="${data?.startTime || '09:00'}">
            <label class="info-label">${t('mybiz_to','a')}</label>
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
// La vista (tabla de existencias + toggle a Sheets) ahora vive en
// inventory.html, embebida en un <iframe id="inventoryFrame">. Aquí solo
// calculamos las filas a partir del catálogo (.service-item, que sigue
// viviendo en esta página) y se las mandamos por postMessage.
// ============================================

let lastInventoryRows = [];

function refreshInventoryTable() {
    const rows = [];
    document.querySelectorAll('.service-item').forEach(item => {
        const title   = item.querySelector('.service-title')?.value?.trim();
        if (!title) return;
        const qtyEl   = item.querySelector('.service-stock-qty');
        const stockCb = item.querySelector('.service-in-stock');
        const imgUrl  = (item.querySelector('.service-image-urls')?.value || '').split(',').filter(Boolean)[0] || '';
        const qty     = qtyEl && qtyEl.value !== '' ? parseInt(qtyEl.value, 10) : null;
        const inStock = stockCb ? stockCb.checked : true;

        rows.push({ title, qty, inStock, imgUrl });
    });

    lastInventoryRows = rows;
    sendInventoryRowsToFrame();
}

function sendInventoryRowsToFrame() {
    const frame = document.getElementById('inventoryFrame');
    if (!frame || !frame.contentWindow) return;
    frame.contentWindow.postMessage({ type: 'attomos:inventory:rows', rows: lastInventoryRows }, window.location.origin);
}

// Ajustar qty desde los botones +/- de la tabla (dentro del iframe)
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
    qtyInput.dispatchEvent(new Event('input')); // refreshInventoryTable ya está enganchado a este evento
}

// Ajustar qty directo desde el input de la tabla (dentro del iframe)
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

// Puente con el iframe de inventory.html
window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;
    const data = event.data || {};
    if (data.type === 'attomos:inventory:ready') {
        sendInventoryRowsToFrame();
    } else if (data.type === 'attomos:inventory:adjust') {
        invAdjust(data.idx, data.delta);
    } else if (data.type === 'attomos:inventory:setqty') {
        invSetQty(data.idx, data.value);
    } else if (data.type === 'attomos:inventory:modal-state') {
        // Un modal del iframe de inventario está abierto/cerrado: el overlay
        // oscuro del modal vive DENTRO del iframe, así que solo cubre lo que
        // hay ahí — el botón flotante "Guardar Cambios" y el resto de la
        // pantalla (sidebar, header) viven fuera y hay que taparlos aparte.
        const saveBtn = document.getElementById('saveProfileBtn');
        if (saveBtn) saveBtn.style.visibility = data.open ? 'hidden' : '';
        const bridgeOverlay = document.getElementById('inventoryModalBridgeOverlay');
        if (bridgeOverlay) bridgeOverlay.style.display = data.open ? 'block' : 'none';
    }
});

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
        showNotification(t('mybiz_menu_uploaded','Menú subido correctamente'), 'success');
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
const MYBIZ_TAB_STORAGE_KEY = 'attomos_mybiz_active_tab';

function activateBusinessTab(target) {
    document.querySelectorAll('.page-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === target));
    document.querySelectorAll('.page-tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + target));
    if (target === 'inventario') refreshInventoryTable();
}

document.querySelectorAll('.page-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const target = tab.dataset.tab;
        activateBusinessTab(target);
        try { sessionStorage.setItem(MYBIZ_TAB_STORAGE_KEY, target); } catch (e) { /* modo privado, etc. — no pasa nada */ }
    });
});

// Al cargar/recargar la página: si venías de la pestaña Inventario, te
// quedas ahí en vez de regresar siempre a Mi Negocio.
(function restoreBusinessTab() {
    let saved = null;
    try { saved = sessionStorage.getItem(MYBIZ_TAB_STORAGE_KEY); } catch (e) { /* modo privado, etc. */ }
    if (saved && document.getElementById('tab-' + saved)) {
        activateBusinessTab(saved);
    }
})();

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
        el.innerHTML = `<div class="acct-er-empty">${tipo === 'ingreso' ? t('mybiz_no_income','Sin ingresos registrados.') : t('mybiz_no_expenses','Sin egresos registrados.')}</div>`;
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
// MI NEGOCIO — capa de estilo iOS 27
// Se carga después de my-business.js y NO cambia su lógica: observa el DOM
// (las clases .active/.show que ya pone my-business.js y los elementos que
// agrega) y encima pone las animaciones:
//   1. Entrada escalonada del contenido de la página.
//   2. Dropdowns que nacen del campo con resorte + resaltado que sigue al
//      cursor (giro, país/estado/ciudad, días festivos, sucursales).
//   3. Selector de hora con ruedas iOS (horario y trabajadores).
//   4. Animación al agregar/quitar producto, día festivo, trabajador e imagen.
// Los toggles iOS son solo CSS (my-business-ios.css).
// ============================================

(function () {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
    const lerp = (a, b, t) => a + (b - a) * t;

    // Curvas de resorte para Web Animations (mismas que en el CSS)
    const SUPPORTS_LINEAR = window.CSS && CSS.supports('animation-timing-function', 'linear(0, 1)');
    const SPRING = SUPPORTS_LINEAR
        ? 'linear(0, 0.04, 0.139, 0.271, 0.416, 0.56, 0.691, 0.805, 0.897, 0.969, 1.021, 1.055, 1.074, 1.082, 1.081, 1.075, 1.065, 1.053, 1.041, 1.03, 1.02, 1.011, 1.005, 1, 0.996, 0.994, 0.993, 0.993, 0.994, 0.994, 0.995, 0.996, 0.997, 0.998, 0.999, 0.999, 1, 1, 1, 1.001, 1.001, 1.001, 1.001, 1, 1, 1, 1, 1, 1)'
        : 'cubic-bezier(0.34, 1.35, 0.64, 1)';
    const SMOOTH = SUPPORTS_LINEAR
        ? 'linear(0, 0.028, 0.096, 0.186, 0.286, 0.387, 0.484, 0.572, 0.651, 0.72, 0.779, 0.828, 0.869, 0.902, 0.928, 0.948, 0.964, 0.977, 0.986, 0.992, 0.997, 1, 1.002, 1.003, 1.004, 1.004, 1.004, 1.004, 1.003, 1.003, 1.003, 1.002, 1.002, 1.001, 1.001, 1.001, 1.001, 1.001, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1)'
        : 'cubic-bezier(0.22, 1, 0.36, 1)';

    // ====================================================================
    // Motor de resortes (compartido por todos los dropdowns)
    // ====================================================================
    const springs = [];
    const renderers = new Set();
    const spring = (v = 0, k = 380, d = 30, eps = 0.1) => {
        const s = { v, vel: 0, t: v, k, d, eps };
        springs.push(s);
        return s;
    };
    function step(s, dt) {
        if (reduce.matches) { s.v = s.t; s.vel = 0; return; }
        s.vel += (-s.k * (s.v - s.t) - s.d * s.vel) * dt;
        s.v += s.vel * dt;
    }
    const atRest = (s) => Math.abs(s.v - s.t) < s.eps && Math.abs(s.vel) < s.eps * 5;
    let raf = null, last = 0;
    function tick(now) {
        const dt = Math.min((now - last) / 1000, 1 / 30);
        last = now;
        springs.forEach((s) => step(s, dt));
        renderers.forEach((r) => r());
        if (springs.every(atRest)) {
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

    // ====================================================================
    // 1. ENTRADA DE LA PÁGINA
    // ====================================================================
    function pageEntrance() {
        const layout = document.querySelector('.profile-layout');
        if (!layout) return;
        let i = 0;
        // Encabezado, selector de sucursal, pestañas… (lo que no es un panel)
        [...layout.children].forEach((el) => {
            if (el.classList.contains('page-tab-panel') || el.tagName === 'SCRIPT') return;
            if (el.querySelector('.profile-card') && !el.classList.contains('profile-card')) return;
            el.style.setProperty('--i', i++);
            el.classList.add('ios-in');
        });
        // Tarjetas: cada panel cuenta desde después del encabezado. Al cambiar
        // de pestaña la animación se repite sola (el panel pasa de oculto a visible).
        const base = i;
        const groups = new Map();
        document.querySelectorAll('.profile-card, .acct-period-bar, .acct-kpi-card').forEach((card) => {
            const key = card.closest('.page-tab-panel') || layout;
            const n = groups.get(key) || 0;
            groups.set(key, n + 1);
            card.style.setProperty('--i', base + n);
            card.classList.add('ios-in');
        });
    }

    // ====================================================================
    // 2 y 3. DROPDOWNS Y SELECTOR DE HORA
    // ====================================================================
    const controllers = new WeakMap();
    const ITEM_H = 36;   // alto de cada fila de las ruedas

    function describe(wrapper) {
        if (wrapper.classList.contains('custom-select-wrapper')) {
            return {
                menu: wrapper.querySelector(':scope > .select-dropdown'),
                anchor: wrapper.querySelector(':scope > .form-select') || wrapper,
                isOpen: () => wrapper.classList.contains('active'),
                container: wrapper.querySelector('.select-options-container'),
                itemSel: '.select-option',
            };
        }
        if (wrapper.classList.contains('branch-dropdown-wrapper')) {
            return {
                menu: wrapper.querySelector('.branch-dropdown-menu'),
                anchor: wrapper.querySelector('.branch-dropdown-btn') || wrapper,
                isOpen: () => wrapper.classList.contains('active'),
                container: wrapper.querySelector('.branch-list'),
                itemSel: '.branch-item',
            };
        }
        if (wrapper.classList.contains('time-picker-wrapper')) {
            const menu = wrapper.querySelector('.time-dropdown');
            return {
                menu,
                anchor: wrapper.querySelector('.time-input-display') || wrapper,
                isOpen: () => menu.classList.contains('show'),
                container: null,
                itemSel: null,
                wheels: true,
            };
        }
        return null;
    }

    function controllerFor(wrapper) {
        if (controllers.has(wrapper)) return controllers.get(wrapper);
        const d = describe(wrapper);
        if (!d || !d.menu) return null;
        const { menu, anchor, container, itemSel } = d;

        const CLOSED_CLIP = 'inset(50% 50% 50% 50%)';
        menu.classList.add('ios-dd');
        menu.style.visibility = 'hidden';
        menu.style.clipPath = CLOSED_CLIP;

        const P = spring(0, 380, 28, 0.001);
        const X = spring(0, 520, 36), Y = spring(0, 520, 36), W = spring(0, 520, 36), H = spring(0, 520, 36);
        const V = spring(0, 600, 44, 0.001);
        let open = false, radius = 18, hovered = null;

        let ind = null;
        if (container) {
            ind = document.createElement('div');
            ind.className = 'ios-dd-ind';
            ind.setAttribute('aria-hidden', 'true');
            container.prepend(ind);
        }

        // Tarjeta que contiene el menú: se sube de capa mientras está abierto.
        // .profile-card:hover usa transform y eso crea un contexto de apilamiento;
        // sin esto el menú quedaba debajo de la tarjeta vecina (p. ej. "Estado").
        const hosts = [wrapper.closest('.profile-card'), wrapper.closest('.schedule-day, .worker-item, .service-item')].filter(Boolean);
        const setHosts = (on) => hosts.forEach((h) => h.classList.toggle('ios-dd-host', on));

        // Si el menú se sale de la tarjeta por la derecha, se alinea al borde derecho del campo
        function fitMenu() {
            if (!d.wheels) return;
            menu.style.left = ''; menu.style.right = '';
            if (getComputedStyle(menu).transform !== 'none') return;   // móvil: ya va centrado
            const card = wrapper.closest('.profile-card') || document.documentElement;
            const m = menu.getBoundingClientRect(), k = card.getBoundingClientRect();
            const limit = Math.min(k.right, window.innerWidth) - 8;
            if (m.right > limit) {
                menu.style.left = 'auto'; menu.style.right = '0';
                if (menu.getBoundingClientRect().left < k.left + 8) { menu.style.left = ''; menu.style.right = ''; }
            }
        }

        function render() {
            const p = P.v, pc = clamp(p);
            if (p < 0.002 && P.t === 0) {
                menu.style.visibility = 'hidden';
                menu.style.clipPath = CLOSED_CLIP;
                setHosts(false);
            } else {
                menu.style.visibility = 'visible';
                menu.style.setProperty('--ios-p', pc.toFixed(3));
                if (open && atRest(P)) {
                    menu.style.clipPath = 'none';   // quieto y abierto: sin recorte para ver la sombra
                } else {
                    const a = anchor.getBoundingClientRect(), c = menu.getBoundingClientRect();
                    const t = lerp(a.top - c.top, 0, p), l = lerp(a.left - c.left, 0, p);
                    const r = lerp(c.right - a.right, 0, p), b = lerp(c.bottom - a.bottom, 0, p);
                    menu.style.clipPath = `inset(${t}px ${r}px ${b}px ${l}px round ${lerp(a.height / 2, radius, pc)}px)`;
                }
            }
            if (ind) {
                const st = Math.min(Math.abs(Y.vel) / 1800, 0.2);
                ind.style.width = `${W.v}px`;
                ind.style.height = `${H.v}px`;
                ind.style.opacity = clamp(V.v);
                ind.style.transform = `translate(${X.v}px, ${Y.v}px) scale(${1 - st * 0.2}, ${1 + st})`;
            }
        }
        renderers.add(render);

        function hoverTo(el) {
            if (el === hovered) return;
            if (hovered) hovered.classList.remove('ios-hover');
            hovered = el;
            if (!el || !ind) { V.t = 0; kick(); return; }
            // renderBranchList() vacía la lista: si el indicador se fue, se vuelve a poner
            if (!container.contains(ind)) container.prepend(ind);
            el.classList.add('ios-hover');
            const r = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
            X.t = r.x; Y.t = r.y; W.t = r.w; H.t = r.h; V.t = 1;
            if (V.v < 0.05) { X.v = r.x; Y.v = r.y; W.v = r.w; H.v = r.h; }   // aparece en su lugar
            kick();
        }

        if (container && itemSel) {
            container.addEventListener('pointermove', (e) => {
                const el = e.target.closest(itemSel);
                if (el && container.contains(el)) hoverTo(el);
            });
            container.addEventListener('pointerleave', () => hoverTo(null));
            menu.addEventListener('input', () => hoverTo(null));   // al filtrar con el buscador
        }

        // --- Ruedas del selector de hora ---
        const wheels = [];
        function setupWheels() {
            menu.querySelectorAll('.time-scroll').forEach((scroll) => {
                if (scroll.classList.contains('ios-wheel')) return;
                scroll.classList.add('ios-wheel');
                const opts = () => [...scroll.querySelectorAll('.time-option')];
                let timer = null, syncing = false;

                function paint() {
                    const st = scroll.scrollTop;
                    opts().forEach((o, i) => {
                        const dd = (i * ITEM_H - st) / ITEM_H;
                        if (Math.abs(dd) > 4) { o.style.opacity = 0; return; }
                        o.style.transform = `perspective(320px) rotateX(${-dd * 22}deg)`;
                        o.style.opacity = Math.max(0.28, 1 - Math.abs(dd) * 0.3);
                    });
                }
                function settle() {
                    if (syncing) return;
                    const list = opts();
                    const i = clamp(Math.round(scroll.scrollTop / ITEM_H), 0, list.length - 1);
                    const o = list[i];
                    // Reutiliza el clic de my-business.js: marca seleccionado y actualiza la hora
                    if (o && !o.classList.contains('selected')) {
                        o.click();
                        if (navigator.vibrate) navigator.vibrate(4);
                    }
                }
                scroll.addEventListener('scroll', () => {
                    paint();
                    clearTimeout(timer);
                    timer = setTimeout(settle, 110);
                }, { passive: true });
                // Tocar un valor lo centra en la rueda
                scroll.addEventListener('click', (e) => {
                    if (!e.isTrusted) return;
                    const o = e.target.closest('.time-option');
                    if (!o) return;
                    const i = opts().indexOf(o);
                    scroll.scrollTo({ top: i * ITEM_H, behavior: reduce.matches ? 'auto' : 'smooth' });
                });
                wheels.push({
                    sync() {
                        syncing = true;
                        const list = opts();
                        const i = Math.max(0, list.findIndex((o) => o.classList.contains('selected')));
                        scroll.scrollTop = i * ITEM_H;
                        paint();
                        requestAnimationFrame(() => { syncing = false; });
                    },
                });
            });
        }

        function sync() {
            const nowOpen = d.isOpen();
            if (nowOpen === open) return;
            open = nowOpen;
            if (open) {
                closeOthers(wrapper);
                radius = 18;
                anchor.classList.add('ios-dd-anchor-open');
                setHosts(true);
                fitMenu();
                V.v = V.t = 0; hovered = null;
                P.t = 1;
                if (d.wheels) {
                    setupWheels();
                    requestAnimationFrame(() => wheels.forEach((w) => w.sync()));
                }
            } else {
                anchor.classList.remove('ios-dd-anchor-open');
                P.t = 0;
                hoverTo(null);
            }
            render();
            kick();
        }

        const ctrl = { sync };
        controllers.set(wrapper, ctrl);
        return ctrl;
    }

    // Abrir un dropdown cierra los demás (algunos clics de my-business.js
    // detienen la propagación y el otro menú se quedaba abierto)
    function closeOthers(current) {
        document.querySelectorAll('.custom-select-wrapper.active, .branch-dropdown-wrapper.active').forEach((w) => {
            if (w === current) return;
            w.classList.remove('active');
            const chev = w.querySelector('#branchChevron');
            if (chev) chev.style.transform = 'rotate(0deg)';
        });
        document.querySelectorAll('.time-dropdown.show').forEach((m) => {
            const w = m.closest('.time-picker-wrapper');
            if (w === current) return;
            m.classList.remove('show');
            w?.querySelector('.time-input-display')?.classList.remove('active');
        });
    }

    function wrapperOf(el) {
        if (el.matches('.custom-select-wrapper, .branch-dropdown-wrapper')) return el;
        if (el.matches('.time-dropdown')) return el.closest('.time-picker-wrapper');
        return null;
    }

    // Prepara los dropdowns que ya existen para que el primer cierre también se anime
    function enhanceExisting(root = document) {
        root.querySelectorAll('.custom-select-wrapper, .branch-dropdown-wrapper, .time-picker-wrapper')
            .forEach((w) => controllerFor(w));
        enhanceSegments(root);
        enhanceDates(root);
    }


    // ====================================================================
    // 5. BOTONES DE SELECCIÓN
    // ====================================================================
    const segments = new WeakSet();
    function segmentFor(toggle) {
        if (segments.has(toggle)) return;
        segments.add(toggle);
        toggle.classList.add('ios-seg');
        const thumb = document.createElement('span');
        thumb.className = 'ios-seg-thumb';
        thumb.setAttribute('aria-hidden', 'true');
        toggle.prepend(thumb);

        const X = spring(0, 420, 30), W = spring(0, 420, 30), S = spring(1, 600, 30, 0.001);
        let ready = false;

        function place(snap) {
            const a = toggle.querySelector(':scope > button.active');
            if (!a || !toggle.offsetWidth) { ready = false; return; }
            X.t = a.offsetLeft; W.t = a.offsetWidth;
            if (snap || !ready) { X.v = X.t; W.v = W.t; X.vel = W.vel = 0; }
            ready = true;
            render();
            kick();
        }
        function render() {
            if (!ready) { thumb.style.opacity = 0; return; }
            // Se estira un poco mientras viaja, como en iOS
            const st = Math.min(Math.abs(X.vel) / 3000, 0.1);
            thumb.style.opacity = 1;
            thumb.style.width = `${W.v}px`;
            thumb.style.transform = `translateX(${X.v}px) scale(${S.v}, ${S.v * (1 - st)})`;
        }
        renderers.add(render);

        // Los clics de my-business.js ya marcaron .active cuando llega aquí
        toggle.addEventListener('click', () => place(false));
        toggle.addEventListener('pointerdown', (e) => {
            if (e.target.closest('button.active')) { S.t = 0.94; kick(); }
        });
        const release = () => { S.t = 1; kick(); };
        ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => toggle.addEventListener(ev, release));
        // Se muestra cuando el bloque deja de estar oculto o cambia de tamaño
        if (window.ResizeObserver) new ResizeObserver(() => place(true)).observe(toggle);
        place(true);
    }

    // Horario: modo compacto cuando la lista es angosta (tarjeta en dos columnas)
    function watchSchedule() {
        const list = document.getElementById('scheduleList');
        if (!list || !window.ResizeObserver) return;
        new ResizeObserver(() => {
            list.classList.toggle('is-compact', list.clientWidth < 640);
        }).observe(list);
    }

    function enhanceSegments(root = document) {
        root.querySelectorAll('.price-type-toggle, .promo-period-type-toggle, .page-tabs-bar, .acct-subtabs').forEach(segmentFor);
    }

    // Chips de días: rebote al activar o desactivar
    document.addEventListener('click', (e) => {
        const chip = e.target.closest('.day-chip');
        if (!chip || reduce.matches || !chip.animate) return;
        const on = chip.classList.contains('active');
        chip.animate(
            [{ transform: `scale(${on ? 0.82 : 0.88})` }, { transform: 'scale(1)' }],
            { duration: 550, easing: SPRING }
        );
    });


    // ====================================================================
    // 6. SELECTOR DE FECHA (promoción: Desde / Hasta)
    // El <input type="date"> original se queda oculto dentro y guarda el
    // valor AAAA-MM-DD, así que la lógica de guardado no cambia.
    // ====================================================================
    const LOCALE = document.documentElement.lang || 'es';
    const pad2 = (n) => String(n).padStart(2, '0');
    const toISO = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const fromISO = (s) => {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
        return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
    };
    const fmtValue = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' });
    const fmtTitle = new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric' });
    const WEEK = Array.from({ length: 7 }, (_, i) =>
        new Intl.DateTimeFormat(LOCALE, { weekday: 'narrow' }).format(new Date(2024, 0, 1 + i)));   // 1 ene 2024 = lunes
    const CAL_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="4"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>';
    const CHEV = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
    const datePickers = new Set();

    function datePickerFor(input) {
        if (input.dataset.iosDate) return;
        input.dataset.iosDate = '1';

        const wrap = document.createElement('div');
        wrap.className = 'ios-date';
        input.parentNode.insertBefore(wrap, input);
        wrap.innerHTML = `
            <button type="button" class="ios-date-trigger" aria-haspopup="dialog">
                ${CAL_ICON}<span class="ios-date-value"></span>
            </button>
            <div class="ios-date-pop" role="dialog">
                <div class="ios-date-head">
                    <span class="ios-date-title"></span>
                    <button type="button" class="ios-date-nav" data-step="-1" aria-label="Mes anterior">${CHEV('M15 18l-6-6 6-6')}</button>
                    <button type="button" class="ios-date-nav" data-step="1" aria-label="Mes siguiente">${CHEV('M9 18l6-6-6-6')}</button>
                </div>
                <div class="ios-date-week">${WEEK.map((w) => `<span>${w}</span>`).join('')}</div>
                <div class="ios-date-grid"><span class="ios-date-sel" aria-hidden="true"></span></div>
                <div class="ios-date-foot">
                    <button type="button" class="ios-date-clear">Borrar</button>
                    <button type="button" class="ios-date-today">Hoy</button>
                </div>
            </div>`;
        wrap.appendChild(input);
        input.classList.add('ios-date-native');
        input.tabIndex = -1;

        const trigger = wrap.querySelector('.ios-date-trigger');
        const valueEl = wrap.querySelector('.ios-date-value');
        const pop = wrap.querySelector('.ios-date-pop');
        const title = wrap.querySelector('.ios-date-title');
        const grid = wrap.querySelector('.ios-date-grid');
        const sel = wrap.querySelector('.ios-date-sel');
        const placeholder = input.classList.contains('promo-date-end') ? 'Fecha final' : 'Fecha inicial';

        // Pareja Desde/Hasta del mismo bloque, para marcar el rango y el mínimo
        const scope = input.closest('.promo-range-panel') || wrap.parentNode;
        const partner = () => scope.querySelector(input.classList.contains('promo-date-start') ? '.promo-date-end' : '.promo-date-start');
        const isEnd = input.classList.contains('promo-date-end');

        const P = spring(0, 380, 28, 0.001);
        const SX = spring(0, 520, 34), SY = spring(0, 520, 34), SS = spring(0, 600, 30, 0.001);
        let open = false, view = new Date(), hostEls = [];

        function paintValue() {
            const d = fromISO(input.value);
            valueEl.textContent = d ? fmtValue.format(d) : placeholder;
            trigger.classList.toggle('is-empty', !d);
        }

        function buildMonth(dir) {
            const tt = fmtTitle.format(view);
            title.textContent = tt.charAt(0).toUpperCase() + tt.slice(1);
            grid.querySelectorAll('.ios-date-day').forEach((b) => b.remove());
            const first = new Date(view.getFullYear(), view.getMonth(), 1);
            const lead = (first.getDay() + 6) % 7;   // semana inicia en lunes
            const days = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
            const todayISO = toISO(new Date());
            const selISO = input.value;
            const other = partner()?.value || '';
            const lo = isEnd ? other : selISO, hi = isEnd ? selISO : other;
            const frag = document.createDocumentFragment();
            for (let i = 0; i < lead; i++) {
                const s = document.createElement('span');
                s.className = 'ios-date-day is-pad';
                frag.appendChild(s);
            }
            for (let d = 1; d <= days; d++) {
                const iso = toISO(new Date(view.getFullYear(), view.getMonth(), d));
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'ios-date-day';
                b.textContent = d;
                b.dataset.iso = iso;
                if (iso === todayISO) b.classList.add('is-today');
                if (iso === selISO) b.classList.add('is-selected');
                if (lo && hi && iso > lo && iso < hi) b.classList.add('in-range');
                if (other && iso === other) b.classList.add('is-edge');
                if (isEnd && other && iso < other) b.disabled = true;
                frag.appendChild(b);
            }
            grid.appendChild(frag);
            placeSel(true);
            if (dir && !reduce.matches && grid.animate) {
                grid.animate(
                    [{ transform: `translateX(${dir * 28}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }],
                    { duration: 480, easing: SPRING }
                );
            }
        }

        function placeSel(snap) {
            const b = grid.querySelector('.ios-date-day.is-selected');
            if (!b) { SS.t = 0; if (snap) SS.v = 0; kick(); return; }
            SX.t = b.offsetLeft; SY.t = b.offsetTop; SS.t = 1;
            if (snap || SS.v < 0.05) { SX.v = SX.t; SY.v = SY.t; SX.vel = SY.vel = 0; }
            if (snap && SS.v < 0.05) SS.v = 0.4;   // pequeño "pop" al aparecer
            kick();
        }

        function render() {
            if (!wrap.isConnected) { renderers.delete(render); datePickers.delete(api); return; }
            const p = P.v, pc = clamp(p);
            if (p < 0.002 && P.t === 0) {
                pop.style.visibility = 'hidden';
                pop.style.clipPath = 'inset(50% 50% 50% 50%)';
                hostEls.forEach((h) => h.classList.remove('ios-dd-host'));
            } else {
                pop.style.visibility = 'visible';
                pop.style.setProperty('--ios-p', pc.toFixed(3));
                if (open && atRest(P)) pop.style.clipPath = 'none';
                else {
                    const a = trigger.getBoundingClientRect(), m = pop.getBoundingClientRect();
                    pop.style.clipPath = `inset(${lerp(a.top - m.top, 0, p)}px ${lerp(m.right - a.right, 0, p)}px ${lerp(m.bottom - a.bottom, 0, p)}px ${lerp(a.left - m.left, 0, p)}px round ${lerp(a.height / 2, 22, pc)}px)`;
                }
            }
            sel.style.opacity = clamp(SS.v);
            sel.style.transform = `translate(${SX.v}px, ${SY.v}px) scale(${Math.max(0, SS.v)})`;
        }
        renderers.add(render);

        function fitPop() {
            pop.style.left = ''; pop.style.right = '';
            const card = wrap.closest('.service-item, .profile-card') || document.documentElement;
            const m = pop.getBoundingClientRect(), k = card.getBoundingClientRect();
            if (m.right > Math.min(k.right, window.innerWidth) - 8) { pop.style.left = 'auto'; pop.style.right = '0'; }
            if (pop.getBoundingClientRect().left < 8) { pop.style.left = ''; pop.style.right = ''; }
        }

        function setOpen(v) {
            if (v === open) return;
            open = v;
            wrap.classList.toggle('is-open', v);
            trigger.setAttribute('aria-expanded', v);
            if (v) {
                datePickers.forEach((o) => o !== api && o.close());
                closeOthers(null);
                hostEls = [wrap.closest('.profile-card'), wrap.closest('.service-item')].filter(Boolean);
                hostEls.forEach((h) => h.classList.add('ios-dd-host'));
                const d = fromISO(input.value) || fromISO(partner()?.value) || new Date();
                view = new Date(d.getFullYear(), d.getMonth(), 1);
                buildMonth(0);
                fitPop();
                P.t = 1;
            } else {
                P.t = 0;
            }
            render();
            kick();
        }

        function setValue(iso) {
            input.value = iso;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            paintValue();
            // Si "Desde" queda después de "Hasta", "Hasta" se mueve a la misma fecha
            const o = partner();
            if (o && iso && o.value) {
                if ((!isEnd && o.value < iso) || (isEnd && o.value > iso)) {
                    o.value = iso;
                    o.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }
            datePickers.forEach((x) => x.refresh());
        }

        function step(dir) {
            view = new Date(view.getFullYear(), view.getMonth() + dir, 1);
            buildMonth(dir);
        }

        trigger.addEventListener('click', () => setOpen(!open));
        wrap.querySelectorAll('.ios-date-nav').forEach((b) => b.addEventListener('click', () => step(+b.dataset.step)));
        grid.addEventListener('click', (e) => {
            const b = e.target.closest('.ios-date-day[data-iso]');
            if (!b || b.disabled) return;
            grid.querySelectorAll('.is-selected').forEach((x) => x.classList.remove('is-selected'));
            b.classList.add('is-selected');
            placeSel(false);
            setValue(b.dataset.iso);
            setTimeout(() => setOpen(false), 260);   // deja ver el cambio antes de cerrar
        });
        wrap.querySelector('.ios-date-today').addEventListener('click', () => {
            const t = new Date();
            if (isEnd && partner()?.value && toISO(t) < partner().value) return;
            view = new Date(t.getFullYear(), t.getMonth(), 1);
            setValue(toISO(t));
            buildMonth(0);
            setTimeout(() => setOpen(false), 260);
        });
        wrap.querySelector('.ios-date-clear').addEventListener('click', () => { setValue(''); setOpen(false); });

        // Deslizar a los lados cambia de mes
        let sx = null;
        grid.addEventListener('pointerdown', (e) => { sx = e.clientX; });
        grid.addEventListener('pointerup', (e) => {
            if (sx === null) return;
            const dx = e.clientX - sx; sx = null;
            if (Math.abs(dx) > 45) step(dx < 0 ? 1 : -1);
        });

        const api = {
            close: () => setOpen(false),
            refresh: () => { paintValue(); if (open) buildMonth(0); },
            contains: (n) => wrap.contains(n),
        };
        datePickers.add(api);
        paintValue();
        render();
    }

    document.addEventListener('pointerdown', (e) => {
        datePickers.forEach((p) => { if (!p.contains(e.target)) p.close(); });
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') datePickers.forEach((p) => p.close());
    });

    function enhanceDates(root = document) {
        root.querySelectorAll('input.promo-date-start, input.promo-date-end').forEach(datePickerFor);
    }

    // ====================================================================
    // 4. ELEMENTOS QUE SE AGREGAN / QUITAN
    // ====================================================================
    let userAddAt = 0;
    document.addEventListener('click', (e) => {
        if (e.target.closest('#btnAddService, #btnAddWorker, #btnAddHoliday')) userAddAt = Date.now();
    }, true);

    function animateIn(el) {
        if (reduce.matches) return;
        const cs = getComputedStyle(el);
        const h = el.offsetHeight;
        el.style.overflow = 'hidden';
        const grow = el.animate([
            { height: '0px', paddingTop: '0px', paddingBottom: '0px', transform: 'translateY(-10px) scale(0.96)' },
            { height: `${h}px`, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, transform: 'none' },
        ], { duration: 700, easing: SPRING });
        el.animate([
            { opacity: 0, filter: 'blur(6px)' },
            { opacity: 1, filter: 'blur(0px)' },
        ], { duration: 420, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
        grow.onfinish = grow.oncancel = () => { el.style.overflow = ''; };
        el.classList.add('ios-added');
        setTimeout(() => el.classList.remove('ios-added'), 1600);
        // Si quedó fuera de la vista, se desplaza suavemente hasta él
        setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 80);
    }

    function animateOut(el) {
        return new Promise((resolve) => {
            if (!el || reduce.matches) { resolve(); return; }
            const cs = getComputedStyle(el);
            el.style.overflow = 'hidden';
            el.style.pointerEvents = 'none';
            const a = el.animate([
                { height: `${el.offsetHeight}px`, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, opacity: 1, transform: 'none', filter: 'blur(0px)' },
                { height: '0px', paddingTop: '0px', paddingBottom: '0px', opacity: 0, transform: 'scale(0.95)', filter: 'blur(4px)' },
            ], { duration: 320, easing: SMOOTH, fill: 'forwards' });
            a.onfinish = () => resolve();
        });
    }

    function popThumb(el) {
        if (reduce.matches) return;
        el.animate([
            { transform: 'scale(0.4)', opacity: 0 },
            { transform: 'scale(1)', opacity: 1 },
        ], { duration: 650, easing: SPRING });
    }

    // Los horarios de trabajadores usan el mismo selector de hora iOS
    function enhanceWorker(item) {
        if (typeof window.createTimePicker !== 'function') return;
        item.querySelectorAll('input.worker-start, input.worker-end').forEach((inp) => {
            if (inp.dataset.iosPicker) return;
            inp.dataset.iosPicker = '1';
            window.createTimePicker(inp, inp.value || (inp.classList.contains('worker-start') ? '09:00' : '18:00'));
        });
        enhanceExisting(item);
    }

    // Quitar producto / trabajador (onclick="removeItem(...)") con animación
    // Nota: la versión original buscaba closest('[class$="-item"]'), que encuentra
    // primero al propio botón (.btn-remove-item) y solo quitaba el botón.
    if (typeof window.removeItem === 'function') {
        window.removeItem = function (btn, listId, hintId) {
            const item = btn.closest('.service-item, .worker-item');
            if (!item) return;
            animateOut(item).then(() => {
                item.remove();
                const list = document.getElementById(listId);
                const hint = document.getElementById(hintId);
                if (hint && list && list.children.length === 0) hint.style.display = 'flex';
                if (typeof window.refreshInventoryTable === 'function') window.refreshInventoryTable();
            });
        };
    }

    // Quitar día festivo con animación
    if (typeof window.removeHoliday === 'function') {
        window.removeHoliday = function (id) {
            const el = document.querySelector(`[data-id="${id}"]`);
            if (!el) return;
            animateOut(el).then(() => el.remove());
        };
    }

    // Quitar imagen: primero se encoge y luego sigue el flujo normal de my-business.js
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-remove-thumb');
        if (!btn || btn.dataset.iosGo || reduce.matches) return;
        e.stopPropagation();
        e.preventDefault();
        const thumb = btn.closest('.service-img-thumb');
        const a = thumb.animate([
            { transform: 'scale(1)', opacity: 1 },
            { transform: 'scale(0.5)', opacity: 0 },
        ], { duration: 220, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' });
        a.onfinish = () => { btn.dataset.iosGo = '1'; btn.click(); };
    }, true);

    // ====================================================================
    // Observadores
    // ====================================================================
    const ITEM_CLASSES = ['service-item', 'worker-item', 'holiday-item'];

    const classObserver = new MutationObserver((records) => {
        const seen = new Set();
        records.forEach((r) => {
            const w = wrapperOf(r.target);
            if (w && !seen.has(w)) { seen.add(w); controllerFor(w)?.sync(); }
        });
    });

    const domObserver = new MutationObserver((records) => {
        const now = Date.now();
        records.forEach((r) => {
            r.addedNodes.forEach((node) => {
                if (node.nodeType !== 1) return;
                const isItem = ITEM_CLASSES.some((c) => node.classList.contains(c));
                if (isItem) {
                    if (node.classList.contains('worker-item')) enhanceWorker(node);
                    else enhanceExisting(node);
                    // Solo se anima lo que agregó el usuario (no las recargas automáticas)
                    if (now - userAddAt < 1000) animateIn(node);
                    return;
                }
                if (node.classList.contains('service-img-thumb')) {
                    const item = node.closest('.service-item');
                    if (item && item.dataset.iosSeen) popThumb(node);
                    return;
                }
                if (node.matches('.custom-select-wrapper, .time-picker-wrapper')) controllerFor(node);
                else if (node.querySelector) enhanceExisting(node);
            });
        });
        document.querySelectorAll('.service-item:not([data-ios-seen])').forEach((el) => { el.dataset.iosSeen = '1'; });
    });

    function init() {
        pageEntrance();
        enhanceExisting();
        watchSchedule();
        document.querySelectorAll('.worker-item').forEach(enhanceWorker);
        document.querySelectorAll('.service-item').forEach((el) => { el.dataset.iosSeen = '1'; });
        classObserver.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
        domObserver.observe(document.body, { subtree: true, childList: true });
        window.addEventListener('resize', () => renderers.forEach((r) => r()));
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();