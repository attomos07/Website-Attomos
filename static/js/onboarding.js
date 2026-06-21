// ============================================
// STATE MANAGEMENT
// ============================================
let currentStep = 1;
let currentSection = 1;
window.selectedSocial = ''; let selectedSocial = window.selectedSocial;
let userBusinessType = '';
window.agentData = {
  social: '',        // plataforma: 'whatsapp' | 'meta'
  branchId: 0,       // ID de my_business_info (fuente de verdad)
  businessType: '',  // heredado de my-business (para validación local)
  name: '',
  phoneNumber: '',
  useDifferentPhone: false,
  location: {
    address: '', betweenStreets: '', number: '', neighborhood: '',
    city: '', state: '', country: '', postalCode: ''
  },
  social_media: {
    facebook: '', instagram: '', twitter: '', linkedin: ''
  },
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
};
let agentData = window.agentData;

// Datos del negocio/dependencia cargados desde API (solo lectura en onboarding)
let businessData = null;

// Flag: true cuando el usuario es de tipo gubernamental
let isGovernment = false;

// Section definitions — base (negocio privado)
const SECTIONS_BUSINESS = [
  { id: 1, name: 'Info. Negocio', icon: 'lni-briefcase', containerId: 'section-business' },
  { id: 2, name: 'Info. Básica', icon: 'lni-information', containerId: 'section-basic' },
  { id: 3, name: 'Ubicación', icon: 'lni-map-marker', containerId: 'section-location' },
  { id: 4, name: 'Redes Sociales', icon: 'lni-share-alt', containerId: 'section-social' },
  { id: 5, name: 'Personalidad', icon: 'lni-comments', containerId: 'section-personality' },
  { id: 6, name: 'Horarios', icon: 'lni-calendar', containerId: 'section-schedule' },
  { id: 7, name: 'Días Festivos', icon: 'lni-gift', containerId: 'section-holidays' },
  { id: 8, name: 'Servicios', icon: 'lni-package', containerId: 'section-services' },
  { id: 9, name: 'Menú', icon: 'lni-files', containerId: 'section-menu' },
  { id: 10, name: 'Trabajadores', icon: 'lni-users', containerId: 'section-workers' }
];

// Section definitions — gubernamental (usa My Agency)
const SECTIONS_GOVERNMENT = [
  { id: 1, name: 'Dependencia',    icon: 'lni-government',   containerId: 'section-business' },
  { id: 2, name: 'Info. Básica',   icon: 'lni-information',  containerId: 'section-basic' },
  { id: 3, name: 'Ubicación',      icon: 'lni-map-marker',   containerId: 'section-location' },
  { id: 4, name: 'Redes Sociales', icon: 'lni-share-alt',    containerId: 'section-social' },
  { id: 5, name: 'Personalidad',   icon: 'lni-comments',     containerId: 'section-personality' },
  { id: 6, name: 'Horarios',       icon: 'lni-calendar',     containerId: 'section-schedule' },
  { id: 7, name: 'Días Inhábiles', icon: 'lni-gift',         containerId: 'section-holidays' },
  { id: 8, name: 'Cursos',         icon: 'lni-graduation',   containerId: 'section-services' },
];

// Referencia activa (se asigna en fetchUserData)
let SECTIONS = SECTIONS_BUSINESS;

// ============================================
// BUSINESS CATEGORY HELPERS
// ============================================
const BUSINESS_CATEGORY_MAP = {
  'clinica-dental': 'servicio',
  'peluqueria':     'servicio',
  'automotriz':     'producto',
  'libreria':       'producto',
  'gorditas':       'comida',
  'mariscos':       'comida',
  'pizzeria':       'comida',
  'restaurante':    'comida',
  'panaderia':      'comida',
  'ensaladas':      'comida',
};

function getBusinessCategory(type) {
  return BUSINESS_CATEGORY_MAP[type] || 'servicio';
}

function _getServicePlaceholder() {
  const type = window.agentData?.businessType || '';
  // Modo gubernamental
  if (type.toLowerCase().includes('gubernamental')) {
    return 'Ej: Curso de computación básica';
  }
  const placeholders = {
    'clinica-dental': 'Ej: Limpieza dental',
    'peluqueria':     'Ej: Corte de cabello',
    'gorditas':       'Ej: Gordita de chicharrón',
    'mariscos':       'Ej: Caldo de camarón',
    'automotriz':     'Ej: Aceite de motor 5W-30',
    'pizzeria':       'Ej: Pizza margarita',
    'libreria':       'Ej: Cuaderno universitario',
    'restaurante':    'Ej: Caldo de res',
    'panaderia':      'Ej: Concha de vainilla',
    'ensaladas':      'Ej: Ensalada César',
  };
  return placeholders[type] || 'Ej: Corte de cabello';
}

/**
 * Actualiza dinámicamente las etiquetas de las tabs y secciones
 * "Servicios/Productos" y "Menú/Catálogo" según el giro del negocio.
 */
function updateSectionLabels(businessType) {
  const cat = getBusinessCategory(businessType);

  const svcTabLabel  = cat === 'servicio' ? 'Servicios'         : 'Productos';
  const svcTitle     = cat === 'servicio' ? 'Servicios'         : 'Productos';
  const svcBtnLabel  = cat === 'servicio' ? 'Agregar Servicio'  : 'Agregar Producto';
  const svcItemLabel = cat === 'servicio' ? 'Servicio'          : 'Producto';
  const svcHint      = cat === 'servicio'
    ? 'Define los servicios que ofreces'
    : 'Define los productos que ofreces';

  const menuTabLabel = cat === 'comida'   ? 'Menú'     : 'Catálogo';
  const menuTitle    = cat === 'comida'   ? 'Menú'     : 'Catálogo';
  const menuHint     = cat === 'comida'
    ? 'Sube tu menú en PDF o como imagen. El agente de IA lo usará como referencia para responder preguntas de tus clientes.'
    : 'Sube tu catálogo en PDF o como imagen. El agente de IA lo usará como referencia para responder preguntas de tus clientes.';

  // Guardar para uso en addService() / removeService()
  window._currentSvcItemLabel = svcItemLabel;

  // ── Tabs de navegación (seción 8 y 9) ─────────────────────────────────────
  document.querySelectorAll('.section-nav-btn').forEach(btn => {
    const id = parseInt(btn.dataset.sectionId);
    const spanEl = btn.querySelector('span');
    if (!spanEl) return;
    if (id === 8) spanEl.textContent = svcTabLabel;
    if (id === 9) spanEl.textContent = menuTabLabel;
  });

  // ── Título h3 de section-services ─────────────────────────────────────────
  const svcTitleEl = document.querySelector('#section-services .section-title');
  if (svcTitleEl) {
    const icon = svcTitleEl.querySelector('i');
    svcTitleEl.textContent = '\u00A0' + svcTitle;
    if (icon) svcTitleEl.prepend(icon);
  }

  // ── Hint de servicios ──────────────────────────────────────────────────────
  const svcHintEl = document.querySelector('#section-services .form-help');
  if (svcHintEl) svcHintEl.textContent = svcHint;

  // ── Botón "Agregar Servicio" ───────────────────────────────────────────────
  const addSvcBtn = document.getElementById('addServiceBtn');
  if (addSvcBtn) {
    const icon = addSvcBtn.querySelector('i');
    addSvcBtn.textContent = '\u00A0' + svcBtnLabel;
    if (icon) addSvcBtn.prepend(icon);
  }

  // ── Re-etiquetar items de servicio ya existentes ───────────────────────────
  const svcPlaceholder = _getServicePlaceholder();
  const fotosLabel     = svcItemLabel === 'Servicio' ? 'Fotos del Servicio' : 'Fotos del Producto';
  document.querySelectorAll('.service-item').forEach((item, idx) => {
    const numEl = item.querySelector('.service-number');
    if (numEl) numEl.textContent = `${svcItemLabel} ${idx + 1}`;
    // Etiqueta del campo título
    item.querySelectorAll('.form-label').forEach(lbl => {
      if (/^Título del (Servicio|Producto)/i.test(lbl.textContent.trim())) {
        lbl.textContent = `Título del ${svcItemLabel} *`;
      }
      if (/^Fotos del (Servicio|Producto)/i.test(lbl.textContent.trim())) {
        lbl.textContent = fotosLabel;
      }
    });
    // Placeholder del input título
    const titleInput = item.querySelector('.service-title');
    if (titleInput) titleInput.placeholder = svcPlaceholder;
  });

  // ── Título h3 de section-menu ──────────────────────────────────────────────
  const menuTitleEl = document.querySelector('#section-menu .section-title');
  if (menuTitleEl) {
    const icon = menuTitleEl.querySelector('i');
    menuTitleEl.textContent = '\u00A0' + menuTitle;
    if (icon) menuTitleEl.prepend(icon);
  }

  // ── Hint de menú ──────────────────────────────────────────────────────────
  const menuHintEl = document.querySelector('#section-menu .form-help');
  if (menuHintEl) menuHintEl.textContent = menuHint;

  console.log(`🏷️ Etiquetas actualizadas → cat: ${cat} | svc: ${svcTabLabel} | menu: ${menuTabLabel}`);
}

// Location data
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

const CITIES_MEXICO = {
  'sonora': ['Hermosillo', 'Ciudad Obregón', 'Nogales', 'San Luis Río Colorado', 'Navojoa', 
             'Guaymas', 'Empalme', 'Agua Prieta', 'Caborca', 'Cananea', 'Puerto Peñasco'],
  'default': ['Ciudad de México', 'Guadalajara', 'Monterrey', 'Puebla', 'Tijuana', 
              'León', 'Juárez', 'Zapopan', 'Mérida', 'Cancún']
};

// ============================================
// DOT INDICATOR ENGINE
// ============================================
const DOT_COUNT = 10;
const DOT_INTERVAL_MS = 600;   // velocidad 0.6s
let _dotTimer   = null;
let _dotCurrent = 0;
let _dotTarget  = 0;

function initDotIndicator() {
  const container = document.getElementById('progressDots');
  if (!container) return;
  container.innerHTML = '';
  for (let i = 0; i < DOT_COUNT; i++) {
    const d = document.createElement('div');
    d.className = 'progress-step';
    d.id = 'pdot-' + i;
    container.appendChild(d);
  }
  _dotCurrent = 0;
  _dotTarget  = 0;
  _renderDots();
  _startDotAnim();
}

function _renderDots() {
  for (let i = 0; i < DOT_COUNT; i++) {
    const d = document.getElementById('pdot-' + i);
    if (!d) continue;
    d.className = 'progress-step';
    if (i === _dotCurrent)    d.classList.add('dot-active');
    else if (i < _dotCurrent) d.classList.add('dot-lit');
  }
}

function _startDotAnim() {
  if (_dotTimer) clearInterval(_dotTimer);
  _dotTimer = setInterval(_tickDot, DOT_INTERVAL_MS);
}

function _tickDot() {
  const next = _dotCurrent + 1;
  if (next > _dotTarget) {
    // llegó al tope: apagar todo y reiniciar desde 0
    _dotCurrent = 0;
  } else {
    _dotCurrent = next;
  }
  _renderDots();
}

function setDotTarget(fraction) {
  // fraction 0.0 → 1.0
  _dotTarget = Math.round(fraction * (DOT_COUNT - 1));
  if (_dotCurrent > _dotTarget) _dotCurrent = 0;
  _renderDots();
}

// ============================================
// INITIALIZE
// ============================================
document.addEventListener('DOMContentLoaded', function() {
  initDotIndicator();
  fetchUserData();
  initializeBusinessTypeSelect();
  initializeSocialSelection();
  initializeNavigationButtons();
  initializeSectionNavigation();
  initializeToneSelection();
  initializeLanguageSelection();
  initializeRichEditor();
  initializePhoneToggle();
  initializeSchedule();
  initializeHolidays();
  initializeServices();
  initializeWorkers();
  initializeMenu();
  initializeLocationDropdowns();
  initializeSocialMediaInputs();
  
  // Inicializar custom pickers
  setTimeout(() => {
    initBusinessTimePickers();
    initHolidayDatePickers();
    initWorkerTimePickers();
  }, 100);
});

// ============================================
// SECTION NAVIGATION
// ============================================
function rebuildSectionNav(navigationContainer) {
  // Crear botones de navegación de secciones
  navigationContainer.innerHTML = '';
  SECTIONS.forEach(section => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `section-nav-btn ${section.id === 1 ? 'active' : ''}`;
    btn.dataset.sectionId = section.id;
    btn.innerHTML = `
      <i class="lni ${section.icon}"></i>
      <span>${section.name}</span>
    `;
    btn.addEventListener('click', () => navigateToSection(section.id));
    navigationContainer.appendChild(btn);
  });
}

function initializeSectionNavigation() {
  const navigationContainer = document.getElementById('sectionNavigation');
  if (!navigationContainer) return;

  rebuildSectionNav(navigationContainer);

  // Eventos para botones "Siguiente" de cada sección
  document.querySelectorAll('.btn-next-section').forEach(btn => {
    btn.addEventListener('click', () => {
      if (currentSection < SECTIONS.length) {
        navigateToSection(currentSection + 1);
      }
    });
  });

  // Eventos para botones "Anterior" de cada sección
  document.querySelectorAll('.btn-prev-section').forEach(btn => {
    btn.addEventListener('click', () => {
      if (currentSection > 1) {
        navigateToSection(currentSection - 1);
      }
    });
  });

  // Mostrar primera sección al iniciar
  navigateToSection(1);
}

function navigateToSection(sectionId) {
  if (sectionId < 1 || sectionId > SECTIONS.length) return;

  currentSection = sectionId;

  // Ocultar todas las secciones
  SECTIONS.forEach(section => {
    const container = document.getElementById(section.containerId);
    if (container) {
      container.classList.remove('active');
    }
  });

  // Mostrar sección actual
  const currentSectionData = SECTIONS.find(s => s.id === sectionId);
  if (currentSectionData) {
    const container = document.getElementById(currentSectionData.containerId);
    if (container) {
      container.classList.add('active');
      
      // Mostrar u ocultar botón "Anterior" según la sección
      const prevBtn = container.querySelector('.btn-prev-section');
      if (prevBtn) {
        if (sectionId === 1) {
          prevBtn.style.display = 'none';
        } else {
          prevBtn.style.display = 'flex';
        }
      }
    }
  }

  // Actualizar botones de navegación
  document.querySelectorAll('.section-nav-btn').forEach(btn => {
    const btnSectionId = parseInt(btn.dataset.sectionId);
    btn.classList.remove('active', 'completed');
    
    if (btnSectionId === sectionId) {
      btn.classList.add('active');
    } else if (btnSectionId < sectionId) {
      btn.classList.add('completed');
    }
  });

  // Scroll al inicio del contenedor
  window.scrollTo(0, 0);

  // Actualizar dot-indicator
  updateProgressBar();
}

// ============================================
// CUSTOM TIME PICKER - BUSINESS HOURS
// ============================================
function initBusinessTimePickers() {
  console.log('🕐 Inicializando Time Pickers del negocio...');
  
  const timeInputs = document.querySelectorAll('.time-input');
  
  timeInputs.forEach(input => {
    const parent = input.closest('.schedule-day');
    if (parent && !input.dataset.useCustom) {
      convertToCustomTimePicker(input);
    }
  });
}

function convertToCustomTimePicker(nativeInput) {
  const wrapper = document.createElement('div');
  wrapper.className = 'custom-time-wrapper';
  
  const customInput = document.createElement('input');
  customInput.type = 'text';
  customInput.className = 'time-input-custom';
  customInput.value = formatTimeDisplay(nativeInput.value || '09:00');
  customInput.readOnly = true;
  
  if (nativeInput.disabled) {
    customInput.disabled = true;
    wrapper.classList.add('disabled');
  }
  
  const arrow = document.createElement('i');
  arrow.className = 'lni lni-chevron-down time-arrow';
  
  const dropdown = document.createElement('div');
  dropdown.className = 'time-dropdown';
  
  const columnsContainer = document.createElement('div');
  columnsContainer.className = 'time-picker-columns';
  
  const initialTime = parseTime(nativeInput.value || '09:00');
  
  const hoursColumn = createTimeColumn('Hora', generateHours(), initialTime.hour);
  const minutesColumn = createTimeColumn('Min', generateMinutes(), initialTime.minute);
  const periodColumn = createTimeColumn('', ['AM', 'PM'], initialTime.period);
  
  columnsContainer.appendChild(hoursColumn);
  columnsContainer.appendChild(minutesColumn);
  columnsContainer.appendChild(periodColumn);
  
  const footer = document.createElement('div');
  footer.className = 'time-picker-footer';
  
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'time-picker-btn time-picker-cancel';
  cancelBtn.textContent = 'Cancelar';
  cancelBtn.onclick = (e) => {
    e.stopPropagation();
    closeBusinessDropdown(wrapper);
  };
  
  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.className = 'time-picker-btn time-picker-confirm';
  confirmBtn.textContent = 'Aceptar';
  confirmBtn.onclick = (e) => {
    e.stopPropagation();
    applyBusinessTime(wrapper, nativeInput, customInput, hoursColumn, minutesColumn, periodColumn);
  };
  
  footer.appendChild(cancelBtn);
  footer.appendChild(confirmBtn);
  
  dropdown.appendChild(columnsContainer);
  dropdown.appendChild(footer);
  
  customInput.addEventListener('click', (e) => {
    if (!customInput.disabled) {
      e.stopPropagation();
      toggleBusinessDropdown(wrapper);
    }
  });
  
  document.addEventListener('click', (e) => {
    if (!wrapper.contains(e.target)) {
      closeBusinessDropdown(wrapper);
    }
  });
  
  wrapper.appendChild(customInput);
  wrapper.appendChild(arrow);
  wrapper.appendChild(dropdown);
  
  nativeInput.parentNode.insertBefore(wrapper, nativeInput);
  nativeInput.style.display = 'none';
  nativeInput.dataset.useCustom = 'true';
  
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.attributeName === 'disabled') {
        customInput.disabled = nativeInput.disabled;
        if (nativeInput.disabled) {
          wrapper.classList.add('disabled');
          closeBusinessDropdown(wrapper);
        } else {
          wrapper.classList.remove('disabled');
        }
      }
    });
  });
  
  observer.observe(nativeInput, { attributes: true });
}

function createTimeColumn(label, options, selectedValue) {
  const column = document.createElement('div');
  column.className = 'time-column';
  
  if (label) {
    const header = document.createElement('div');
    header.className = 'time-column-header';
    header.textContent = label;
    column.appendChild(header);
  }
  
  options.forEach(option => {
    const optionElement = document.createElement('div');
    optionElement.className = 'time-column-option';
    optionElement.textContent = option;
    optionElement.dataset.value = option;
    
    if (option === selectedValue) {
      optionElement.classList.add('selected');
      setTimeout(() => {
        optionElement.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, 50);
    }
    
    optionElement.addEventListener('click', (e) => {
      e.stopPropagation();
      column.querySelectorAll('.time-column-option').forEach(opt => {
        opt.classList.remove('selected');
      });
      optionElement.classList.add('selected');
    });
    
    column.appendChild(optionElement);
  });
  
  return column;
}

function generateHours() {
  const hours = [];
  for (let i = 1; i <= 12; i++) {
    hours.push(i.toString().padStart(2, '0'));
  }
  return hours;
}

function generateMinutes() {
  return ['00', '15', '30', '45'];
}

function parseTime(time24) {
  const [hours, minutes] = time24.split(':');
  let hour = parseInt(hours);
  const period = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12 || 12;
  
  return {
    hour: hour.toString().padStart(2, '0'),
    minute: minutes,
    period: period
  };
}

function formatTimeDisplay(time24) {
  const parsed = parseTime(time24);
  return `${parsed.hour}:${parsed.minute} ${parsed.period}`;
}

function toggleBusinessDropdown(wrapper) {
  const isActive = wrapper.classList.contains('active');
  
  if (isActive) {
    closeBusinessDropdown(wrapper);
  } else {
    openBusinessDropdown(wrapper);
  }
}

function openBusinessDropdown(wrapper) {
  wrapper.classList.add('active');
  wrapper.querySelector('.time-input-custom').classList.add('active');
}

function closeBusinessDropdown(wrapper) {
  wrapper.classList.remove('active');
  const input = wrapper.querySelector('.time-input-custom');
  if (input) {
    input.classList.remove('active');
  }
}

function applyBusinessTime(wrapper, nativeInput, customInput, hoursColumn, minutesColumn, periodColumn) {
  const selectedHour = hoursColumn.querySelector('.time-column-option.selected');
  const selectedMinute = minutesColumn.querySelector('.time-column-option.selected');
  const selectedPeriod = periodColumn.querySelector('.time-column-option.selected');
  
  if (!selectedHour || !selectedMinute || !selectedPeriod) {
    return;
  }
  
  let hour = parseInt(selectedHour.dataset.value);
  const minute = selectedMinute.dataset.value;
  const period = selectedPeriod.dataset.value;
  
  if (period === 'PM' && hour !== 12) {
    hour += 12;
  } else if (period === 'AM' && hour === 12) {
    hour = 0;
  }
  
  const time24 = `${hour.toString().padStart(2, '0')}:${minute}`;
  const timeDisplay = `${selectedHour.dataset.value}:${minute} ${period}`;
  
  nativeInput.value = time24;
  customInput.value = timeDisplay;
  
  const event = new Event('change', { bubbles: true });
  nativeInput.dispatchEvent(event);
  
  closeBusinessDropdown(wrapper);
}

// ============================================
// CUSTOM DATE PICKER - HOLIDAYS
// ============================================
function initHolidayDatePickers() {
  console.log('📅 Inicializando Date Pickers de festivos...');
  
  const holidaysList = document.getElementById('holidaysList');
  if (!holidaysList) return;
  
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === 1 && node.classList.contains('holiday-item')) {
          const dateInput = node.querySelector('.holiday-date-input');
          if (dateInput && !dateInput.dataset.useCustom) {
            convertToCustomDatePicker(dateInput);
          }
        }
      });
    });
  });
  
  observer.observe(holidaysList, { childList: true });
  
  document.querySelectorAll('.holiday-date-input').forEach(input => {
    if (!input.dataset.useCustom) {
      convertToCustomDatePicker(input);
    }
  });
}

function convertToCustomDatePicker(nativeInput) {
  const wrapper = document.createElement('div');
  wrapper.className = 'custom-date-wrapper';
  
  const customInput = document.createElement('input');
  customInput.type = 'text';
  customInput.className = 'date-input-custom';
  customInput.value = formatDisplayDate(nativeInput.value || '');
  customInput.readOnly = true;
  customInput.placeholder = 'Selecciona una fecha';
  
  const arrow = document.createElement('i');
  arrow.className = 'lni lni-calendar date-arrow';
  
  const dropdown = document.createElement('div');
  dropdown.className = 'date-dropdown';
  
  const currentDate = new Date();
  let currentMonth = currentDate.getMonth();
  let currentYear = currentDate.getFullYear();
  
  function renderCalendar() {
    dropdown.innerHTML = '';
    
    const header = document.createElement('div');
    header.className = 'date-picker-header';
    
    const nav = document.createElement('div');
    nav.className = 'date-picker-nav';
    
    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.innerHTML = '<i class="lni lni-chevron-left"></i>';
    prevBtn.onclick = (e) => {
      e.stopPropagation();
      currentMonth--;
      if (currentMonth < 0) {
        currentMonth = 11;
        currentYear--;
      }
      renderCalendar();
    };
    
    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.innerHTML = '<i class="lni lni-chevron-right"></i>';
    nextBtn.onclick = (e) => {
      e.stopPropagation();
      currentMonth++;
      if (currentMonth > 11) {
        currentMonth = 0;
        currentYear++;
      }
      renderCalendar();
    };
    
    nav.appendChild(prevBtn);
    nav.appendChild(nextBtn);
    
    const current = document.createElement('div');
    current.className = 'date-picker-current';
    const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 
                        'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    current.textContent = `${monthNames[currentMonth]} ${currentYear}`;
    
    header.appendChild(nav);
    header.appendChild(current);
    dropdown.appendChild(header);
    
    const calendar = document.createElement('div');
    calendar.className = 'date-picker-calendar';
    
    const weekdays = document.createElement('div');
    weekdays.className = 'date-picker-weekdays';
    ['D', 'L', 'M', 'M', 'J', 'V', 'S'].forEach(day => {
      const weekday = document.createElement('div');
      weekday.className = 'date-picker-weekday';
      weekday.textContent = day;
      weekdays.appendChild(weekday);
    });
    calendar.appendChild(weekdays);
    
    const days = document.createElement('div');
    days.className = 'date-picker-days';
    
    const firstDay = new Date(currentYear, currentMonth, 1).getDay();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(currentYear, currentMonth, 0).getDate();
    
    for (let i = firstDay - 1; i >= 0; i--) {
      const day = document.createElement('div');
      day.className = 'date-picker-day other-month';
      day.textContent = daysInPrevMonth - i;
      days.appendChild(day);
    }
    
    const today = new Date();
    const selectedDate = nativeInput.value ? new Date(nativeInput.value + 'T00:00:00') : null;
    
    for (let i = 1; i <= daysInMonth; i++) {
      const day = document.createElement('div');
      day.className = 'date-picker-day';
      day.textContent = i;
      
      const thisDate = new Date(currentYear, currentMonth, i);
      
      if (today.toDateString() === thisDate.toDateString()) {
        day.classList.add('today');
      }
      
      if (selectedDate && selectedDate.toDateString() === thisDate.toDateString()) {
        day.classList.add('selected');
      }
      
      day.onclick = (e) => {
        e.stopPropagation();
        selectDate(wrapper, nativeInput, customInput, currentYear, currentMonth, i);
      };
      
      days.appendChild(day);
    }
    
    const totalCells = days.children.length;
    const remainingCells = 42 - totalCells;
    for (let i = 1; i <= remainingCells; i++) {
      const day = document.createElement('div');
      day.className = 'date-picker-day other-month';
      day.textContent = i;
      days.appendChild(day);
    }
    
    calendar.appendChild(days);
    dropdown.appendChild(calendar);
  }
  
  renderCalendar();
  
  customInput.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDateDropdown(wrapper);
  });
  
  document.addEventListener('click', (e) => {
    if (!wrapper.contains(e.target)) {
      closeDateDropdown(wrapper);
    }
  });
  
  wrapper.appendChild(customInput);
  wrapper.appendChild(arrow);
  wrapper.appendChild(dropdown);
  
  nativeInput.parentNode.insertBefore(wrapper, nativeInput);
  nativeInput.style.display = 'none';
  nativeInput.dataset.useCustom = 'true';
}

function toggleDateDropdown(wrapper) {
  const isActive = wrapper.classList.contains('active');
  
  if (isActive) {
    closeDateDropdown(wrapper);
  } else {
    openDateDropdown(wrapper);
  }
}

function openDateDropdown(wrapper) {
  wrapper.classList.add('active');
  wrapper.querySelector('.date-input-custom').classList.add('active');
}

function closeDateDropdown(wrapper) {
  wrapper.classList.remove('active');
  wrapper.querySelector('.date-input-custom').classList.remove('active');
}

function selectDate(wrapper, nativeInput, customInput, year, month, day) {
  const date = new Date(year, month, day);
  const dateString = date.toISOString().split('T')[0];
  
  nativeInput.value = dateString;
  customInput.value = formatDisplayDate(dateString);
  
  const event = new Event('change', { bubbles: true });
  nativeInput.dispatchEvent(event);
  
  closeDateDropdown(wrapper);
}

function formatDisplayDate(dateString) {
  if (!dateString) return '';
  
  const date = new Date(dateString + 'T00:00:00');
  const day = date.getDate();
  const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 
                      'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  
  return `${day} ${monthNames[date.getMonth()]} ${date.getFullYear()}`;
}

// ============================================
// CUSTOM TIME PICKER - WORKERS
// ============================================
function initWorkerTimePickers() {
  console.log('👷 Inicializando Time Pickers de trabajadores...');
  
  const workersList = document.getElementById('workersList');
  if (!workersList) return;
  
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === 1 && node.classList.contains('worker-item')) {
          const startTime = node.querySelector('.worker-start-time');
          const endTime = node.querySelector('.worker-end-time');
          
          if (startTime && !startTime.dataset.useCustom) {
            convertToWorkerTimePicker(startTime);
          }
          if (endTime && !endTime.dataset.useCustom) {
            convertToWorkerTimePicker(endTime);
          }
        }
      });
    });
  });
  
  observer.observe(workersList, { childList: true, subtree: true });
  
  document.querySelectorAll('.worker-start-time, .worker-end-time').forEach(input => {
    if (!input.dataset.useCustom) {
      convertToWorkerTimePicker(input);
    }
  });
}

function convertToWorkerTimePicker(nativeInput) {
  const wrapper = document.createElement('div');
  wrapper.className = 'worker-time-wrapper';
  
  const customInput = document.createElement('input');
  customInput.type = 'text';
  customInput.className = 'worker-time-input-custom';
  customInput.value = formatTimeDisplay(nativeInput.value || '09:00');
  customInput.readOnly = true;
  
  const arrow = document.createElement('i');
  arrow.className = 'lni lni-chevron-down worker-time-arrow';
  
  const dropdown = document.createElement('div');
  dropdown.className = 'worker-time-dropdown';
  
  const columnsContainer = document.createElement('div');
  columnsContainer.className = 'time-picker-columns';
  
  const initialTime = parseTime(nativeInput.value || '09:00');
  
  const hoursColumn = createTimeColumn('Hora', generateHours(), initialTime.hour);
  const minutesColumn = createTimeColumn('Min', generateMinutes(), initialTime.minute);
  const periodColumn = createTimeColumn('', ['AM', 'PM'], initialTime.period);
  
  columnsContainer.appendChild(hoursColumn);
  columnsContainer.appendChild(minutesColumn);
  columnsContainer.appendChild(periodColumn);
  
  const footer = document.createElement('div');
  footer.className = 'time-picker-footer';
  
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'time-picker-btn time-picker-cancel';
  cancelBtn.textContent = 'Cancelar';
  cancelBtn.onclick = (e) => {
    e.stopPropagation();
    closeWorkerDropdown(wrapper);
  };
  
  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.className = 'time-picker-btn time-picker-confirm';
  confirmBtn.textContent = 'Aceptar';
  confirmBtn.onclick = (e) => {
    e.stopPropagation();
    applyWorkerTime(wrapper, nativeInput, customInput, hoursColumn, minutesColumn, periodColumn);
  };
  
  footer.appendChild(cancelBtn);
  footer.appendChild(confirmBtn);
  
  dropdown.appendChild(columnsContainer);
  dropdown.appendChild(footer);
  
  customInput.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleWorkerDropdown(wrapper);
  });
  
  document.addEventListener('click', (e) => {
    if (!wrapper.contains(e.target)) {
      closeWorkerDropdown(wrapper);
    }
  });
  
  wrapper.appendChild(customInput);
  wrapper.appendChild(arrow);
  wrapper.appendChild(dropdown);
  
  nativeInput.parentNode.insertBefore(wrapper, nativeInput);
  nativeInput.style.display = 'none';
  nativeInput.dataset.useCustom = 'true';
}

function toggleWorkerDropdown(wrapper) {
  const isActive = wrapper.classList.contains('active');
  
  if (isActive) {
    closeWorkerDropdown(wrapper);
  } else {
    openWorkerDropdown(wrapper);
  }
}

function openWorkerDropdown(wrapper) {
  wrapper.classList.add('active');
  wrapper.querySelector('.worker-time-input-custom').classList.add('active');
}

function closeWorkerDropdown(wrapper) {
  wrapper.classList.remove('active');
  const input = wrapper.querySelector('.worker-time-input-custom');
  if (input) {
    input.classList.remove('active');
  }
}

function applyWorkerTime(wrapper, nativeInput, customInput, hoursColumn, minutesColumn, periodColumn) {
  const selectedHour = hoursColumn.querySelector('.time-column-option.selected');
  const selectedMinute = minutesColumn.querySelector('.time-column-option.selected');
  const selectedPeriod = periodColumn.querySelector('.time-column-option.selected');
  
  if (!selectedHour || !selectedMinute || !selectedPeriod) {
    return;
  }
  
  let hour = parseInt(selectedHour.dataset.value);
  const minute = selectedMinute.dataset.value;
  const period = selectedPeriod.dataset.value;
  
  if (period === 'PM' && hour !== 12) {
    hour += 12;
  } else if (period === 'AM' && hour === 12) {
    hour = 0;
  }
  
  const time24 = `${hour.toString().padStart(2, '0')}:${minute}`;
  const timeDisplay = `${selectedHour.dataset.value}:${minute} ${period}`;
  
  nativeInput.value = time24;
  customInput.value = timeDisplay;
  
  const event = new Event('change', { bubbles: true });
  nativeInput.dispatchEvent(event);
  
  closeWorkerDropdown(wrapper);
}

// ============================================
// USER DATA
// ============================================

// ============================================
// BUSINESS TYPE SELECT (Información del Negocio)
// ============================================
function initializeBusinessTypeSelect() {
  const wrapper = document.getElementById('businessTypeWrapper');
  const input = document.getElementById('businessTypeInput');
  const dropdown = document.getElementById('businessTypeDropdown');
  const search = document.getElementById('businessTypeSearch');
  const options = document.querySelectorAll('#businessTypeOptions .select-option');

  if (!wrapper) return;

  wrapper.addEventListener('click', function(e) {
    e.stopPropagation();
    wrapper.classList.toggle('active');
  });

  options.forEach(option => {
    option.addEventListener('click', function(e) {
      e.stopPropagation();
      const value = this.dataset.value;
      const text = this.querySelector('span').textContent;
      input.value = text;
      input.dataset.value = value;
      agentData.businessType = value;
      options.forEach(o => o.classList.remove('selected'));
      this.classList.add('selected');
      wrapper.classList.remove('active');
      updateSectionLabels(value);
    });
  });

  if (search) {
    search.addEventListener('input', function(e) {
      e.stopPropagation();
      const q = this.value.toLowerCase();
      options.forEach(opt => {
        const match = opt.querySelector('span').textContent.toLowerCase().includes(q);
        opt.style.display = match ? '' : 'none';
      });
    });
    search.addEventListener('click', e => e.stopPropagation());
  }

  document.addEventListener('click', () => wrapper.classList.remove('active'));
}

async function fetchUserData() {
  try {
    // Datos básicos del usuario
    const userResp = await fetch('/api/me', { credentials: 'include' });
    if (userResp.ok) {
      const data = await userResp.json();
      userBusinessType = data.user.businessType;
      agentData.businessType = userBusinessType;

      // Detectar si el usuario es gubernamental
      isGovernment = !!(
        data.user.isGovernment ||
        data.user.userType === 'government' ||
        data.user.accountType === 'government' ||
        (data.user.businessType || '').toLowerCase().includes('gubernamental')
      );
      if (isGovernment) {
        applyGovernmentMode();
      }
    }

    if (isGovernment) {
      // ── Ruta gubernamental: datos desde /api/my-agency ─────────────────────
      const agencyResp = await fetch('/api/my-agency', { credentials: 'include' });
      if (agencyResp.ok) {
        const agencyData = await agencyResp.json();
        console.log('🏛️ /api/my-agency response:', JSON.stringify(agencyData));
        const allOffices = agencyData.offices || agencyData.branches || [];
        const office = agencyData.activeBranch || agencyData.defaultBranch || (allOffices.length > 0 ? allOffices[0] : null);
        if (office) {
          businessData = office;
          agentData.branchId = office.id || 0;
          renderGovernmentPreview(office);
          console.log('✅ Datos de dependencia precargados, officeId:', agentData.branchId);
        } else {
          console.warn('⚠️ No se encontró oficina activa en /api/my-agency');
        }
        if (allOffices.length >= 1) {
          renderBranchSelectorBasic(allOffices, agentData.branchId);
        }
      }
    } else {
      // ── Ruta normal: datos desde /api/my-business ──────────────────────────
      const bizResp = await fetch('/api/my-business', { credentials: 'include' });
      if (bizResp.ok) {
        const bizData = await bizResp.json();
        console.log('📦 /api/my-business response:', JSON.stringify(bizData));
        const allBranches = (window._dashboardBranches && window._dashboardBranches.length > 0)
          ? window._dashboardBranches
          : (bizData.branches || []);
        const branch = bizData.activeBranch || bizData.defaultBranch;
        if (branch) {
          businessData = branch;
          agentData.branchId = branch.id || 0;
          agentData.businessType = branch.business?.type || agentData.businessType;
          renderBusinessPreview(branch);
          updateSectionLabels(agentData.businessType);
          console.log('✅ Datos del negocio precargados, branchId:', agentData.branchId);
        } else {
          console.warn('⚠️ No se encontró activeBranch ni defaultBranch en la respuesta');
        }
        if (allBranches.length >= 1) {
          renderBranchSelectorBasic(allBranches, agentData.branchId);
        }
      }
    }
  } catch (error) {
    console.error('❌ Error obteniendo datos del usuario:', error);
  }
}

// ============================================
// GOVERNMENT MODE — adapta UI del onboarding
// ============================================

/**
 * Cambia las secciones, etiquetas y readonly-notices del onboarding
 * para reflejar la terminología gubernamental de Mi Dependencia.
 */
function applyGovernmentMode() {
  console.log('🏛️ Modo Gubernamental activado en onboarding');

  // Cambiar el array de secciones activo (quita Menú, renombra varias)
  SECTIONS = SECTIONS_GOVERNMENT;

  // Ocultar sección-menú (no aplica para gobierno)
  const menuSection = document.getElementById('section-menu');
  if (menuSection) menuSection.style.display = 'none';

  // ── Adaptar sección "Info. Negocio" → "Dependencia" ──────────────────────

  // Título de la sección
  const bizTitle = document.querySelector('#section-business .section-title');
  if (bizTitle) {
    const icon = bizTitle.querySelector('i');
    bizTitle.innerHTML = '';
    if (icon) { icon.className = 'lni lni-government'; bizTitle.appendChild(icon); }
    bizTitle.append(' Información de la Dependencia');
  }

  // Readonly notice: apunta a "Mi Dependencia" en TODAS las secciones
  document.querySelectorAll(
    '#section-business .readonly-notice, ' +
    '#section-location .readonly-notice, ' +
    '#section-social .readonly-notice, ' +
    '#section-schedule .readonly-notice, ' +
    '#section-holidays .readonly-notice, ' +
    '#section-services .readonly-notice, ' +
    '#section-workers .readonly-notice'
  ).forEach(notice => {
    notice.innerHTML = `
      <i class="lni lni-lock-alt"></i>
      Datos precargados desde <strong>Mi Dependencia</strong>.
      Para editarlos ve a <a href="/my-agency" target="_blank">Mi Dependencia &rarr;</a>
    `;
  });

  // Adaptar labels del formulario de negocio
  _govLabel('businessNameInput', 'Nombre de la Dependencia', 'Ej: Secretaría de Educación Pública');
  _govPlaceholder('businessNameInput', 'Ej: Secretaría de Educación Pública');
  _govLabel('businessDescInput', 'Descripción de la Dependencia', 'Describe brevemente la función de tu dependencia');
  _govPlaceholder('businessDescInput', 'Ej: Somos la dirección de capacitación y desarrollo, ofrecemos cursos y talleres...');
  _govLabel('emailContactInput', 'Email Oficial', 'Email principal de contacto de la dependencia');
  _govPlaceholder('emailContactInput', 'atencion@dependencia.gob.mx');

  // Ocultar el selector de "Giro del Negocio" (no aplica)
  const bizTypeGroup = document.getElementById('businessTypeWrapper')?.closest('.form-group');
  if (bizTypeGroup) bizTypeGroup.style.display = 'none';

  // Inyectar campos gubernamentales extra (acrónimo, área, nivel de gobierno)
  _injectGovFields();

  // ── Adaptar sección "Días Festivos" → "Días Inhábiles" ───────────────────
  const holidayTitle = document.querySelector('#section-holidays .section-title');
  if (holidayTitle) {
    const icon = holidayTitle.querySelector('i');
    holidayTitle.innerHTML = '';
    if (icon) holidayTitle.appendChild(icon);
    holidayTitle.append(' Días Inhábiles');
  }
  const addHolidayBtn = document.getElementById('addHolidayBtn');
  if (addHolidayBtn) {
    const icon = addHolidayBtn.querySelector('i');
    addHolidayBtn.textContent = ' Agregar Día Inhábil';
    if (icon) addHolidayBtn.prepend(icon);
  }
  document.querySelectorAll('.holiday-name-input').forEach(el => {
    el.placeholder = 'Nombre del día inhábil';
  });

  // ── Adaptar sección "Servicios" → "Cursos y Talleres" ────────────────────
  const svcTitle = document.querySelector('#section-services .section-title');
  if (svcTitle) {
    const icon = svcTitle.querySelector('i');
    svcTitle.innerHTML = '';
    if (icon) { icon.className = 'lni lni-graduation'; svcTitle.appendChild(icon); }
    svcTitle.append(' Cursos y Talleres');
  }
  const svcHint = document.querySelector('#section-services .form-help');
  if (svcHint) svcHint.textContent = 'Define los cursos o talleres que ofrece tu dependencia';
  const addSvcBtn = document.getElementById('addServiceBtn');
  if (addSvcBtn) {
    const icon = addSvcBtn.querySelector('i');
    addSvcBtn.textContent = ' Agregar Curso';
    if (icon) addSvcBtn.prepend(icon);
  }
  window._currentSvcItemLabel = 'Curso';

  // Ocultar campos de precio en todos los service-items existentes y agregar campos gov
  document.querySelectorAll('.service-item').forEach(item => {
    _hideServicePriceFields(item);
    _injectCourseGovFields(item, null);
    // Actualizar label del título
    const titleLabel = item.querySelector('.form-label');
    if (titleLabel && titleLabel.textContent.includes('Título')) {
      titleLabel.textContent = 'Título del Curso *';
    }
    const titleInput = item.querySelector('.service-title');
    if (titleInput) titleInput.placeholder = 'Ej: Curso de computación básica';
  });

  // ── Adaptar sección "Ubicación" para gobierno ──────────────────────────────
  // Ocultar campos que no aplican (entre calles, número, colonia, código postal)
  ['postalCodeInput','betweenStreetsInput','numberInput','neighborhoodInput'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.closest('.form-group').style.display = 'none';
  });
  // Mostrar ciudad y estado (están ocultos por defecto en modo negocio)
  ['cityInput','stateInput','countryInput'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.style.display = '';
      el.closest('.form-group').style.display = '';
    }
  });
  // Actualizar el title de la sección
  const locTitle = document.querySelector('#section-location .section-title');
  if (locTitle) {
    const icon = locTitle.querySelector('i');
    locTitle.innerHTML = '';
    if (icon) locTitle.appendChild(icon);
    locTitle.append(' Ubicación de la Dependencia');
  }
  // Agregar campo de Maps si no existe
  if (!document.getElementById('govMapsLinkInput')) {
    const addressGroup = document.getElementById('addressInput')?.closest('.form-group');
    if (addressGroup) {
      const mapsGroup = document.createElement('div');
      mapsGroup.className = 'form-group';
      mapsGroup.innerHTML = `
        <label class="form-label">
          <i class="lni lni-map" style="color:#06b6d4;margin-right:4px;"></i>
          Link de Google Maps
        </label>
        <input type="url" id="govMapsLinkInput" class="form-input"
               placeholder="https://maps.google.com/?q=...">
        <span class="form-help">Pega el enlace de "Compartir" de Google Maps</span>
      `;
      addressGroup.after(mapsGroup);
    }
  }
  const workersTitle = document.querySelector('#section-workers .section-title');
  if (workersTitle) {
    const icon = workersTitle.querySelector('i');
    workersTitle.innerHTML = '';
    if (icon) workersTitle.appendChild(icon);
    workersTitle.append(' Personal de Atención');
  }
  const addWorkerBtn = document.getElementById('addWorkerBtn');
  if (addWorkerBtn) {
    const icon = addWorkerBtn.querySelector('i');
    addWorkerBtn.textContent = ' Agregar Trabajador';
    if (icon) addWorkerBtn.prepend(icon);
  }

  // ── Adaptar "Trabajadores" → "Personal de Atención" ──────────────────────
  const navContainer = document.getElementById('sectionNavigation');
  if (navContainer) rebuildSectionNav(navContainer);
}

/** Helper: cambia la etiqueta de un campo */
function _govLabel(inputId, newLabel, newHelp) {
  const el = document.getElementById(inputId);
  if (!el) return;
  const group = el.closest('.form-group');
  if (!group) return;
  const label = group.querySelector('.form-label');
  if (label) label.childNodes[label.childNodes.length - 1].textContent = newLabel;
  if (newHelp) {
    const help = group.querySelector('.form-help');
    if (help) help.textContent = newHelp;
  }
}

/** Helper: cambia el placeholder de un input */
function _govPlaceholder(inputId, placeholder) {
  const el = document.getElementById(inputId);
  if (el) el.placeholder = placeholder;
}

/** Inyecta campos de acrónimo, área, nivel de gobierno en section-business */
function _injectGovFields() {
  const grid = document.querySelector('#section-business .form-grid');
  if (!grid || document.getElementById('depAcronymInput')) return; // ya inyectados

  const govFieldsHTML = `
    <div class="form-group" id="govAcronymGroup">
      <label class="form-label">Siglas / Acrónimo</label>
      <input type="text" id="depAcronymInput" class="form-input" placeholder="Ej: SEP, IMSS, CONACYT" readonly />
      <span class="form-help">Abreviatura oficial de la dependencia</span>
    </div>
    <div class="form-group" id="govAreaGroup">
      <label class="form-label">Área / Departamento</label>
      <input type="text" id="depAreaInput" class="form-input" placeholder="Ej: Dirección de Capacitación" readonly />
      <span class="form-help">Unidad interna responsable</span>
    </div>
    <div class="form-group" id="govParentGroup">
      <label class="form-label">Organismo Superior</label>
      <input type="text" id="depParentInput" class="form-input" placeholder="Ej: Gobierno del Estado de Sonora" readonly />
      <span class="form-help">Dependencia madre o entidad superior</span>
    </div>
    <div class="form-group" id="govLevelGroup">
      <label class="form-label">Nivel de Gobierno</label>
      <input type="text" id="govLevelDisplayInput" class="form-input" placeholder="—" readonly />
      <span class="form-help">Federal, Estatal, Municipal u Organismo Autónomo</span>
    </div>
  `;

  // Insertar antes del primer form-group
  const firstGroup = grid.querySelector('.form-group');
  if (firstGroup) {
    firstGroup.insertAdjacentHTML('afterend', govFieldsHTML);
  } else {
    grid.insertAdjacentHTML('beforeend', govFieldsHTML);
  }
}

/**
 * Precarga los campos del onboarding con datos de /api/my-agency
 * (equivalente a renderBusinessPreview pero para dependencias).
 */
function renderGovernmentPreview(office) {
  // office shape from my-agency.js loadBranchData:
  // { depName, depAcronym, depArea, depParent, govLevel, rfc, description,
  //   website, email, phoneNumber, address, city, state, mapsLink,
  //   facebook, instagram, twitter, youtube, linkedin, schedule, holidays,
  //   sedes, cursos, officeName }

  // ── Información de la Dependencia ─────────────────────────────────────────
  const infoMap = {
    'businessNameInput':  office.depName      || '',
    'businessDescInput':  office.description  || '',
    'websiteInput':       office.website      || '',
    'emailContactInput':  office.email        || '',
    'depAcronymInput':    office.depAcronym   || '',
    'depAreaInput':       office.depArea      || '',
    'depParentInput':     office.depParent    || '',
    'govLevelDisplayInput': _govLevelLabel(office.govLevel),
  };
  Object.entries(infoMap).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) { el.value = val; el.readOnly = true; }
  });

  // Deshabilitar el selector de tipo de negocio
  const typeWrapper = document.getElementById('businessTypeWrapper');
  if (typeWrapper) typeWrapper.style.pointerEvents = 'none';

  // ── Ubicación ─────────────────────────────────────────────────────────────
  const locMap = {
    'addressInput':       office.address || '',
    'postalCodeInput':    office.postalCode || '',
    'betweenStreetsInput': '',
    'numberInput':        '',
    'neighborhoodInput':  '',
  };
  Object.entries(locMap).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) { el.value = val; el.readOnly = true; }
  });

  agentData.location = {
    address:        office.address || '',
    betweenStreets: '',
    number:         '',
    neighborhood:   '',
    city:           office.city    || '',
    state:          office.state   || '',
    country:        'México',
    postalCode:     office.postalCode || '',
  };

  preloadLocationDropdown('countryInput', 'México');
  preloadLocationDropdown('stateInput',   office.state || '');
  preloadLocationDropdown('cityInput',    office.city  || '');

  // ── Redes Sociales ────────────────────────────────────────────────────────
  const socialMap = {
    'facebookInput':  office.facebook  || '',
    'instagramInput': office.instagram || '',
    'twitterInput':   office.twitter   || '',
    'linkedinInput':  office.linkedin  || '',
  };
  Object.entries(socialMap).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) { el.value = val; el.readOnly = true; }
  });

  agentData.social_media = {
    facebook:  office.facebook  || '',
    instagram: office.instagram || '',
    twitter:   office.twitter   || '',
    linkedin:  office.linkedin  || '',
  };

  // ── Horario ───────────────────────────────────────────────────────────────
  const schedule = office.schedule || {};
  const days = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
  days.forEach(day => {
    const dayData = schedule[day];
    if (!dayData) return;
    const toggle  = document.getElementById(`${day}Toggle`);
    const startEl = document.getElementById(`${day}Start`);
    const endEl   = document.getElementById(`${day}End`);
    const dayBlock = document.querySelector(`[data-day="${day}"]`);

    const isOpen    = dayData.isOpen !== undefined ? dayData.isOpen : dayData.open;
    const openTime  = dayData.open   || dayData.start || '09:00';
    const closeTime = dayData.close  || dayData.end   || '18:00';

    if (toggle) { toggle.checked = !!isOpen; toggle.dispatchEvent(new Event('change')); }
    if (startEl) { startEl.value = openTime;  startEl.dispatchEvent(new Event('change')); _updateCustomTimePicker(startEl, openTime); }
    if (endEl)   { endEl.value   = closeTime; endEl.dispatchEvent(new Event('change'));   _updateCustomTimePicker(endEl, closeTime); }
    if (dayBlock) dayBlock.classList.toggle('closed', !isOpen);
  });

  // ── Días Inhábiles ────────────────────────────────────────────────────────
  const holidays = office.holidays || [];
  if (holidays.length > 0) {
    const holidaysList = document.getElementById('holidaysList');
    if (holidaysList) holidaysList.innerHTML = '';
    holidays.forEach(h => {
      const dateStr = h.date && h.date.includes('-') ? h.date :
                      (h.date ? `2025-${(h.date.split('/')[1]||'01').padStart(2,'0')}-${(h.date.split('/')[0]||'01').padStart(2,'0')}` : '');
      addHolidayWithData(dateStr, h.name || '');
    });
    updateHolidaysData();
  }

  // ── Cursos (equivalente a servicios en modo gobierno) ─────────────────────
  const cursos = office.cursos || [];
  if (cursos.length > 0) {
    const servicesList = document.getElementById('servicesList');
    if (servicesList) servicesList.innerHTML = '';
    cursos.forEach(c => {
      addServiceWithData({
        title:       c.title || '',
        description: c.description || '',
        price:       null,
        imageUrls:   c.imageUrls || [],
      });
      // Inyectar campos gov con los datos reales del curso
      const items = document.querySelectorAll('.service-item');
      const lastItem = items[items.length - 1];
      if (lastItem) _injectCourseGovFields(lastItem, c);
    });
    updateServicesData();
  }

  // ── Personal (trabajadores) ───────────────────────────────────────────────
  const workers = office.workers || [];
  if (workers.length > 0) {
    const workersList = document.getElementById('workersList');
    if (workersList) workersList.innerHTML = '';
    workers.forEach(w => addWorkerWithData(w));
    updateWorkersData();
  }

  // ── Nombre de la oficina en el selector de rama ───────────────────────────
  document.getElementById('branchDropdownLabel') && (document.getElementById('branchDropdownLabel').textContent = office.officeName || 'Oficina');
}

/** Inyecta campos gubernamentales (modalidad, cupos, periodo, sede) en un service-item */
function _injectCourseGovFields(item, courseData) {
  if (!item || item.querySelector('.course-gov-fields')) return; // ya inyectados

  const sedes = [...document.querySelectorAll('.sede-nombre')]
    .map(i => i.value.trim()).filter(Boolean);

  const modalidad  = courseData?.modalidad  || 'presencial';
  const cupos      = courseData?.cupos      || '';
  const fechaIni   = courseData?.fechaInicio || '';
  const fechaFin   = courseData?.fechaFin   || '';
  const sedeVal    = courseData?.sede        || '';
  const disponible = courseData?.disponible !== false;

  const govBlock = document.createElement('div');
  govBlock.className = 'course-gov-fields';
  govBlock.style.cssText = 'margin-top:1rem;display:flex;flex-direction:column;gap:.85rem;';

  govBlock.innerHTML = `
    <!-- Toggle disponible -->
    <div style="display:flex;align-items:center;gap:.75rem;">
      <label style="display:flex;align-items:center;gap:.5rem;cursor:pointer;user-select:none;">
        <input type="checkbox" class="curso-ob-disponible" ${disponible ? 'checked' : ''}
               style="width:16px;height:16px;accent-color:#06b6d4;">
        <span style="font-size:.875rem;font-weight:600;color:#374151;">Disponible</span>
      </label>
    </div>

    <!-- Modalidad -->
    <div>
      <label style="display:block;font-size:.8rem;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em;margin-bottom:.4rem;">Modalidad</label>
      <div style="display:flex;gap:.4rem;flex-wrap:wrap;">
        ${['presencial','en-linea','hibrido'].map(m => `
          <button type="button" class="ob-modalidad-btn${m===modalidad?' ob-modalidad-active':''}"
                  data-mod="${m}"
                  style="padding:.3rem .8rem;border-radius:8px;border:1.5px solid ${m===modalidad?'#06b6d4':'#e5e7eb'};
                         background:${m===modalidad?'#ecfeff':'white'};color:${m===modalidad?'#0891b2':'#6b7280'};
                         font-size:.78rem;font-weight:600;cursor:pointer;transition:all .2s;">
            ${m==='presencial'?'Presencial':m==='en-linea'?'En línea':'Híbrido'}
          </button>`).join('')}
      </div>
      <input type="hidden" class="curso-ob-modalidad" value="${modalidad}">
    </div>

    <!-- Cupos -->
    <div>
      <label style="display:block;font-size:.8rem;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em;margin-bottom:.4rem;">Cupos disponibles</label>
      <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;">
        <input type="number" class="form-input curso-ob-cupos" min="0" step="1"
               placeholder="—" value="${cupos}"
               style="width:80px;text-align:center;padding:.35rem .5rem;font-size:.9rem;">
        <span style="font-size:.82rem;color:#6b7280;">lugares</span>
      </div>
    </div>

    <!-- Periodo -->
    <div>
      <label style="display:block;font-size:.8rem;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em;margin-bottom:.4rem;">Periodo</label>
      <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;">
        <input type="date" class="form-input curso-ob-fecha-inicio" value="${fechaIni}"
               style="flex:1;min-width:130px;">
        <span style="color:#d1d5db;">→</span>
        <input type="date" class="form-input curso-ob-fecha-fin" value="${fechaFin}"
               style="flex:1;min-width:130px;">
      </div>
    </div>

    <!-- Sede -->
    <div>
      <label style="display:block;font-size:.8rem;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em;margin-bottom:.4rem;">Sede</label>
      <div style="position:relative;">
        <i class="lni lni-map-marker"
           style="position:absolute;left:.75rem;top:50%;transform:translateY(-50%);color:#06b6d4;font-size:.9rem;pointer-events:none;"></i>
        <select class="form-input curso-ob-sede"
                style="padding-left:2.2rem;cursor:pointer;appearance:none;-webkit-appearance:none;">
          <option value="">Sin sede asignada</option>
          ${sedes.map(s => `<option value="${s}"${s===sedeVal?' selected':''}>${s}</option>`).join('')}
        </select>
      </div>
    </div>
  `;

  // Listeners modalidad
  govBlock.querySelectorAll('.ob-modalidad-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      govBlock.querySelectorAll('.ob-modalidad-btn').forEach(b => {
        b.style.borderColor = '#e5e7eb'; b.style.background = 'white'; b.style.color = '#6b7280';
      });
      this.style.borderColor = '#06b6d4'; this.style.background = '#ecfeff'; this.style.color = '#0891b2';
      govBlock.querySelector('.curso-ob-modalidad').value = this.dataset.mod;
    });
  });

  item.querySelector('.service-fields').appendChild(govBlock);
}
function _govLevelLabel(val) {
  const map = {
    federal:   'Federal',
    estatal:   'Estatal',
    municipal: 'Municipal',
    autonomo:  'Organismo Autónomo',
  };
  return map[val] || val || '';
}

/** Oculta los campos de precio y adapta labels de un service-item para modo gobierno */
function _hideServicePriceFields(item) {
  if (!item) return;
  // Ocultar: tipo de precio, precio normal, precios de promoción, periodo promo
  item.querySelectorAll('.price-type-selector, .price-normal, .promotion-prices, .promo-period-block').forEach(el => {
    el.style.display = 'none';
  });
  item.querySelectorAll('.form-group').forEach(g => {
    const label = g.querySelector('.form-label');
    if (!label) return;
    if (label.textContent.includes('Tipo de Precio') || label.textContent.trim().startsWith('Precio')) {
      g.style.display = 'none';
    }
    // Renombrar "Descripción del Servicio/Producto" → "Descripción del Curso"
    if (label.textContent.includes('Descripción del Servicio') || label.textContent.includes('Descripción del Producto')) {
      label.textContent = 'Descripción del Curso';
    }
    // Renombrar "Título del Servicio/Producto" → "Título del Curso"
    if (label.textContent.includes('Título del Servicio') || label.textContent.includes('Título del Producto')) {
      label.textContent = 'Título del Curso *';
    }
  });
  // Renombrar cabecera del item (ej: "Servicio 1" → "Curso 1")
  const header = item.querySelector('.service-number');
  if (header) header.textContent = header.textContent.replace('Servicio', 'Curso').replace('Producto', 'Curso');
}

// ── Selector de sucursal en Info. Básica ─────────────────────────────────────

function renderBranchSelectorBasic(branches, activeBranchId) {
  const wrapper = document.getElementById('branchSelectorBasic');
  const container = document.getElementById('branchBasicCards');
  if (!wrapper || !container) return;

  container.innerHTML = '';

  // Con una sola sucursal: solo badge informativo, sin opción de cambiar
  if (branches.length === 1) {
    const b = branches[0];
    const badge = document.createElement('div');
    badge.className = 'branch-basic-card active branch-basic-single';
    badge.dataset.branchId = b.id;
    badge.innerHTML = `<span class="branch-basic-badge">${b.branchNumber}</span><i class="lni lni-map-marker"></i><span>${b.branchName || ('Sucursal ' + b.branchNumber)}</span><i class="lni lni-checkmark-circle branch-basic-check"></i>`;
    container.appendChild(badge);
    wrapper.style.display = 'block';
    return;
  }

  // Con múltiples sucursales: selector interactivo
  // Card "Todas las sucursales"
  const allCard = document.createElement('div');
  allCard.className = 'branch-basic-card' + (activeBranchId === 0 ? ' active' : '');
  allCard.dataset.branchId = '0';
  allCard.innerHTML = '<i class="lni lni-network"></i><span>Todas las sucursales</span>';
  allCard.addEventListener('click', () => selectBranchBasic(0, null));
  container.appendChild(allCard);

  branches.forEach(b => {
    const card = document.createElement('div');
    card.className = 'branch-basic-card' + (b.id === activeBranchId ? ' active' : '');
    card.dataset.branchId = b.id;
    card.innerHTML = `<span class="branch-basic-badge">${b.branchNumber}</span><i class="lni lni-map-marker"></i><span>${b.branchName || ('Sucursal ' + b.branchNumber)}</span>`;
    card.addEventListener('click', () => selectBranchBasic(b.id, b));
    container.appendChild(card);
  });

  wrapper.style.display = 'block';
}

async function selectBranchBasic(branchId, branchMeta) {
  if (agentData.branchId === branchId) return;

  document.querySelectorAll('#branchBasicCards .branch-basic-card').forEach(card => {
    card.classList.toggle('active', parseInt(card.dataset.branchId) === branchId);
  });

  if (branchId === 0) {
    agentData.branchId = 0;
    updatePhoneToggleHint(null);
    console.log('🔀 Sucursal: Todas');
    return;
  }

  try {
    const resp = await fetch(`/api/my-business/${branchId}`, { credentials: 'include' });
    if (!resp.ok) throw new Error('Error cargando sucursal');
    const branch = await resp.json();
    businessData = branch;
    agentData.branchId = branchId;
    agentData.businessType = branch.business?.type || agentData.businessType;
    renderBusinessPreview(branch);
    updatePhoneToggleHint(branch);
    updateSectionLabels(agentData.businessType);
    console.log('🔀 Sucursal cambiada a:', branchId);
  } catch (err) {
    console.error('❌ Error cargando sucursal:', err);
  }
}

// Actualiza el hint del toggle de teléfono según la sucursal seleccionada
function updatePhoneToggleHint(branch) {
  const desc = document.getElementById('phoneToggleDesc');
  // Remover hint anterior si existe
  const existing = document.getElementById('branchPhoneHint');
  if (existing) existing.remove();

  if (branch && branch.phoneNumber) {
    const hint = document.createElement('div');
    hint.id = 'branchPhoneHint';
    hint.className = 'branch-phone-hint';
    hint.innerHTML = `<i class="lni lni-map-marker"></i> Sucursal usa: <strong>${branch.phoneNumber}</strong> — activa esto si necesitas un número distinto`;
    if (desc && desc.parentNode) {
      desc.parentNode.insertBefore(hint, desc.nextSibling);
    }
  }
}


// Muestra un resumen read-only del negocio en las secciones del onboarding
function renderBusinessPreview(branch) {
  // El endpoint devuelve { business: { name, type, description, website, email }, ... }
  const biz = branch.business || {};
  const loc = branch.location || {};
  const soc = branch.social   || {};

  // ── Info del negocio ──────────────────────────
  const map = {
    'businessNameInput': biz.name        || '',
    'businessDescInput': biz.description || '',
    'websiteInput':      biz.website     || '',
    'emailContactInput': biz.email       || '',
    'phoneNumber':       branch.phoneNumber || '',
  };
  Object.entries(map).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) { el.value = val; el.readOnly = true; }
  });

  // Tipo de negocio (custom select — solo llenar el input visible)
  const typeInput = document.getElementById('businessTypeInput');
  if (typeInput && biz.type) {
    typeInput.value = biz.typeName || biz.type;
    typeInput.dataset.value = biz.type;
    const wrapper = document.getElementById('businessTypeWrapper');
    if (wrapper) wrapper.style.pointerEvents = 'none';
  }

  // ── Ubicación ─────────────────────────────────
  const locMap = {
    'addressInput':        loc.address        || '',
    'postalCodeInput':     loc.postalCode     || '',
    'betweenStreetsInput':  loc.betweenStreets || '',
    'numberInput':         loc.number         || '',
    'neighborhoodInput':   loc.neighborhood   || '',
  };
  Object.entries(locMap).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) { el.value = val; el.readOnly = true; }
  });

  // Precargar agentData.location para el summary
  agentData.location = {
    address:        loc.address        || '',
    betweenStreets: loc.betweenStreets || '',
    number:         loc.number         || '',
    neighborhood:   loc.neighborhood   || '',
    city:           loc.city           || '',
    state:          loc.state          || '',
    country:        loc.country        || '',
    postalCode:     loc.postalCode     || '',
  };

  // Precargar los custom dropdowns de ubicación (país, estado, ciudad)
  // Estos tienen un displayInput visible separado del hidden input original
  preloadLocationDropdown('countryInput', loc.country   || '');
  preloadLocationDropdown('stateInput',   loc.state     || '');
  preloadLocationDropdown('cityInput',    loc.city      || '');

  // ── Redes sociales ────────────────────────────
  const socialMap = {
    'facebookInput':  soc.facebook  || '',
    'instagramInput': soc.instagram || '',
    'twitterInput':   soc.twitter   || '',
    'linkedinInput':  soc.linkedin  || '',
  };
  Object.entries(socialMap).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) { el.value = val; el.readOnly = true; }
  });

  // Precargar agentData.social_media para el summary
  agentData.social_media = {
    facebook:  soc.facebook  || '',
    instagram: soc.instagram || '',
    twitter:   soc.twitter   || '',
    linkedin:  soc.linkedin  || '',
  };

  // ── Horario ───────────────────────────────────
  const schedule = branch.schedule || {};
  const days = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
  days.forEach(day => {
    const dayData = schedule[day];
    if (!dayData) return;

    const toggle   = document.getElementById(`${day}Toggle`);
    const startEl  = document.getElementById(`${day}Start`);
    const endEl    = document.getElementById(`${day}End`);
    const dayBlock = document.querySelector(`[data-day="${day}"]`);

    const isOpen = dayData.isOpen !== undefined ? dayData.isOpen : dayData.open;
    const openTime  = dayData.open  || dayData.start || '09:00';
    const closeTime = dayData.close || dayData.end   || '18:00';

    if (toggle) {
      toggle.checked = !!isOpen;
      toggle.dispatchEvent(new Event('change'));
    }
    if (startEl) {
      startEl.value = openTime;
      startEl.dispatchEvent(new Event('change'));
      // Actualizar custom time picker si ya fue inicializado
      _updateCustomTimePicker(startEl, openTime);
    }
    if (endEl) {
      endEl.value = closeTime;
      endEl.dispatchEvent(new Event('change'));
      _updateCustomTimePicker(endEl, closeTime);
    }
    if (dayBlock) {
      dayBlock.classList.toggle('closed', !isOpen);
    }
  });

  // ── Días Festivos ─────────────────────────────
  const holidays = branch.holidays || [];
  if (holidays.length > 0) {
    const holidaysList = document.getElementById('holidaysList');
    if (holidaysList) holidaysList.innerHTML = '';
    holidays.forEach(h => {
      // h.date puede venir como "YYYY-MM-DD" o en formato "dd/mm"
      const dateStr = h.date && h.date.includes('-') ? h.date :
                      (h.date ? `2025-${(h.date.split('/')[1]||'01').padStart(2,'0')}-${(h.date.split('/')[0]||'01').padStart(2,'0')}` : '');
      addHolidayWithData(dateStr, h.name || '');
    });
    updateHolidaysData();
  }

  // ── Servicios ─────────────────────────────────
  const services = branch.services || [];
  if (services.length > 0) {
    const servicesList = document.getElementById('servicesList');
    if (servicesList) servicesList.innerHTML = '';
    services.forEach(s => addServiceWithData(s));
    updateServicesData();
  }

  // ── Trabajadores ──────────────────────────────
  const workers = branch.workers || [];
  if (workers.length > 0) {
    const workersList = document.getElementById('workersList');
    if (workersList) workersList.innerHTML = '';
    workers.forEach(w => addWorkerWithData(w));
    updateWorkersData();
  }
}

// Precarga el displayInput visible de un location dropdown
function preloadLocationDropdown(inputId, value) {
  if (!value) return;
  const hiddenInput = document.getElementById(inputId);
  if (!hiddenInput) return;
  // El wrapper está justo antes del hidden input
  const wrapper = hiddenInput.previousElementSibling;
  if (wrapper && wrapper.classList.contains('location-dropdown-wrapper')) {
    const displayInput = wrapper.querySelector('.location-select');
    if (displayInput) displayInput.value = value;
    // Marcar la opción como selected si existe
    const option = wrapper.querySelector(`.location-option[data-value="${value.toLowerCase().replace(/\s+/g,'-')}"]`);
    if (option) {
      wrapper.querySelectorAll('.location-option').forEach(o => o.classList.remove('selected'));
      option.classList.add('selected');
    }
  }
  hiddenInput.value = value;
}

// Actualiza el custom time picker visual dado el input nativo
function _updateCustomTimePicker(nativeInput, time24) {
  if (!nativeInput || !time24) return;
  const wrapper = nativeInput.previousElementSibling;
  if (!wrapper || !wrapper.classList.contains('custom-time-wrapper')) return;
  const customInput = wrapper.querySelector('.time-input-custom');
  if (customInput) customInput.value = formatTimeDisplay(time24);
}

// Agrega un día festivo con datos precargados
function addHolidayWithData(dateStr, name) {
  const holidaysList = document.getElementById('holidaysList');
  if (!holidaysList) return;

  const holidayId = Date.now() + Math.random();
  const holidayItem = document.createElement('div');
  holidayItem.className = 'holiday-item';
  holidayItem.dataset.holidayId = holidayId;
  holidayItem.innerHTML = `
    <div class="holiday-date form-group">
      <input type="date" class="form-input holiday-date-input" value="${dateStr}" required>
    </div>
    <div class="holiday-name form-group">
      <input type="text" class="form-input holiday-name-input" placeholder="Nombre del día festivo" value="${name}" required>
    </div>
    <button type="button" class="btn-remove-holiday" onclick="removeHoliday(${holidayId})">
      <i class="lni lni-trash-can"></i>
    </button>
  `;
  holidaysList.appendChild(holidayItem);
  holidayItem.querySelector('.holiday-date-input').addEventListener('change', updateHolidaysData);
  holidayItem.querySelector('.holiday-name-input').addEventListener('input', updateHolidaysData);
}

// Agrega un servicio con datos precargados
function addServiceWithData(s) {
  addService(); // crea el DOM vacío
  const items = document.querySelectorAll('.service-item');
  const item = items[items.length - 1];
  if (!item) return;

  const titleEl = item.querySelector('.service-title');
  if (titleEl) titleEl.value = s.title || '';

  const editorEl = item.querySelector('.service-editor-content');
  if (editorEl) editorEl.innerHTML = s.description || '';

  const imgUrls = s.imageUrls || (s.imageUrl ? [s.imageUrl] : []);
  if (imgUrls.length > 0) {
    const grid    = item.querySelector('.service-images-grid');
    const urlsInput = item.querySelector('.service-image-urls');
    const addBtn  = item.querySelector('.service-img-add-btn');
    imgUrls.forEach(url => {
      const thumb = document.createElement('div');
      thumb.className = 'service-img-thumb';
      thumb.dataset.url = url; // URL real, no pendiente
      thumb.innerHTML = `<img src="${url}" alt="Foto"><button type="button" class="btn-remove-thumb" title="Quitar"><i class="lni lni-close"></i></button>`;
      grid.insertBefore(thumb, addBtn);
    });
    if (urlsInput) urlsInput.value = imgUrls.join(',');
  }

  // ── Precio ────────────────────────────────────────────────────────────────
  const priceType = (s.priceType === 'promotion' || s.priceType === 'promo') ? 'promotion' : 'normal';
  const priceTypeOpts = item.querySelectorAll('.price-type-option');
  priceTypeOpts.forEach(opt => {
    opt.classList.toggle('active', opt.dataset.type === priceType);
  });
  const promoSection = item.querySelector('.promotion-prices');
  const normalSection = item.querySelector('.price-normal');
  const promoPeriodBlock = item.querySelector('.promo-period-block');
  if (priceType === 'promotion') {
    if (promoSection) promoSection.classList.add('show');
    if (normalSection) normalSection.style.display = 'none';
    if (promoPeriodBlock) promoPeriodBlock.style.display = 'block';
    const origEl = item.querySelector('.service-original-price');
    const promoEl = item.querySelector('.service-promo-price');
    if (origEl) origEl.value = s.originalPrice || '';
    if (promoEl) promoEl.value = s.promoPrice || '';

    // ── Periodo de promo ──────────────────────────────────────────────────
    const periodType = s.promoPeriodType || 'days';
    const periodBtns = item.querySelectorAll('.period-tab-btn');
    periodBtns.forEach(b => b.classList.toggle('active', b.dataset.period === periodType));
    const daysPanel  = item.querySelector('.promo-days-panel');
    const rangePanel = item.querySelector('.promo-range-panel');
    if (daysPanel)  daysPanel.style.display  = periodType === 'range' ? 'none' : 'flex';
    if (rangePanel) rangePanel.style.display = periodType === 'range' ? 'flex' : 'none';

    if (periodType === 'days' && Array.isArray(s.promoDays)) {
      item.querySelectorAll('.promo-days-panel .day-chip').forEach(chip => {
        const val = chip.querySelector('input').value;
        const active = s.promoDays.includes(val);
        chip.classList.toggle('active', active);
        chip.querySelector('input').checked = active;
      });
    } else if (periodType === 'range') {
      const startEl = item.querySelector('.promo-date-start');
      const endEl   = item.querySelector('.promo-date-end');
      if (startEl) startEl.value = s.promoDateStart || '';
      if (endEl)   endEl.value   = s.promoDateEnd   || '';
    }
  } else {
    const priceEl = item.querySelector('.service-price');
    if (priceEl) priceEl.value = s.price || '';
  }
}

// Agrega un trabajador con datos precargados
function addWorkerWithData(w) {
  addWorker(); // crea el DOM vacío
  const items = document.querySelectorAll('.worker-item');
  const item = items[items.length - 1];
  if (!item) return;

  const nameEl = item.querySelector('.worker-name');
  if (nameEl) nameEl.value = w.name || '';

  const startEl = item.querySelector('.worker-start-time');
  const endEl   = item.querySelector('.worker-end-time');
  if (startEl) { startEl.value = w.startTime || '09:00'; _updateWorkerTimePicker(startEl, startEl.value); }
  if (endEl)   { endEl.value   = w.endTime   || '18:00'; _updateWorkerTimePicker(endEl,   endEl.value);   }

  const days = Array.isArray(w.days) ? w.days : [];
  item.querySelectorAll('.availability-day input[type="checkbox"]').forEach(cb => {
    cb.checked = days.includes(cb.value);
  });
}

function _updateWorkerTimePicker(nativeInput, time24) {
  if (!nativeInput || !time24) return;
  const wrapper = nativeInput.previousElementSibling;
  if (!wrapper || !wrapper.classList.contains('worker-time-wrapper')) return;
  const customInput = wrapper.querySelector('.worker-time-input-custom');
  if (customInput) customInput.value = formatTimeDisplay(time24);
}

// ============================================
// SOCIAL NETWORK SELECTION
// ============================================
function initializeSocialSelection() {
  const socialInputs = document.querySelectorAll('input[name="social"]');
  const btnStep1 = document.getElementById('btnStep1');

  socialInputs.forEach(input => {
    input.addEventListener('change', function() {
      selectedSocial = this.value;
      window.selectedSocial = this.value;
      agentData.social = this.value;
      window.agentData.social = this.value;

      // Mostrar campo de token solo para Telegram
      const tokenSection = document.getElementById('telegramTokenSection');
      if (tokenSection) {
        tokenSection.style.display = this.value === 'telegram' ? 'block' : 'none';
      }

      // Habilitar botón (para Telegram, requerir token)
      if (this.value === 'telegram') {
        const tokenInput = document.getElementById('telegramBotToken');
        if (tokenInput) {
          // Revisar si ya hay token escrito
          btnStep1.disabled = !tokenInput.value.trim().includes(':');
          // Escuchar cambios en el token
          tokenInput.oninput = function() {
            const hasToken = this.value.trim().includes(':');
            btnStep1.disabled = !hasToken;
            if (hasToken) {
              agentData.phoneNumber = this.value.trim();
              window.agentData.phoneNumber = this.value.trim();
            }
          };
        }
      } else {
        btnStep1.disabled = false;
      }
    });
  });
}

// ============================================
// PHONE TOGGLE
// ============================================
function initializePhoneToggle() {
  const phoneToggle = document.getElementById('phoneToggle');
  const differentPhoneSection = document.getElementById('differentPhoneSection');
  
  if (phoneToggle) {
    phoneToggle.addEventListener('change', function() {
      agentData.useDifferentPhone = this.checked;
      if (differentPhoneSection) {
        if (this.checked) {
          differentPhoneSection.style.display = 'block';
        } else {
          differentPhoneSection.style.display = 'none';
        }
      }
    });
  }
}

// ============================================
// TONE SELECTION
// ============================================
function initializeToneSelection() {
  const toneInputs = document.querySelectorAll('input[name="tone"]');
  const customToneEditor = document.getElementById('customToneEditor');

  // Al inicializar: limpiar clases .selected del HTML estático
  // y reasignar solo al radio realmente :checked (single source of truth)
  document.querySelectorAll('.tone-radio-option').forEach(opt => opt.classList.remove('selected'));
  const checkedInput = document.querySelector('input[name="tone"]:checked');
  if (checkedInput) {
    checkedInput.closest('.tone-radio-option').classList.add('selected');
    agentData.config.tone = checkedInput.value;
  }

  toneInputs.forEach(input => {
    input.addEventListener('change', function() {
      // Quitar selección de TODAS y poner solo en la activa
      document.querySelectorAll('.tone-radio-option').forEach(opt => {
        opt.classList.remove('selected');
      });
      this.closest('.tone-radio-option').classList.add('selected');
      agentData.config.tone = this.value;

      if (this.value === 'custom') {
        customToneEditor.classList.add('show');
      } else {
        customToneEditor.classList.remove('show');
        agentData.config.customTone = '';
      }
    });
  });
}

// ============================================
// LANGUAGE SELECTION
// ============================================
function initializeLanguageSelection() {
  const languageCheckboxes = document.querySelectorAll('input[name="additionalLanguage"]');
  
  languageCheckboxes.forEach(checkbox => {
    checkbox.addEventListener('change', function() {
      if (this.checked) {
        if (!agentData.config.additionalLanguages.includes(this.value)) {
          agentData.config.additionalLanguages.push(this.value);
        }
      } else {
        agentData.config.additionalLanguages = agentData.config.additionalLanguages.filter(lang => lang !== this.value);
      }
    });
  });
}

// ============================================
// RICH TEXT EDITOR
// ============================================
function initializeRichEditor() {
  const editorContent = document.getElementById('editorContent');
  if (!editorContent) return;

  const boldBtn = document.getElementById('boldBtn');
  const italicBtn = document.getElementById('italicBtn');
  const underlineBtn = document.getElementById('underlineBtn');
  const listBtn = document.getElementById('listBtn');

  if (boldBtn) {
    boldBtn.addEventListener('click', () => {
      document.execCommand('bold', false, null);
      editorContent.focus();
    });
  }

  if (italicBtn) {
    italicBtn.addEventListener('click', () => {
      document.execCommand('italic', false, null);
      editorContent.focus();
    });
  }

  if (underlineBtn) {
    underlineBtn.addEventListener('click', () => {
      document.execCommand('underline', false, null);
      editorContent.focus();
    });
  }

  if (listBtn) {
    listBtn.addEventListener('click', () => {
      document.execCommand('insertUnorderedList', false, null);
      editorContent.focus();
    });
  }

  editorContent.addEventListener('input', function() {
    agentData.config.customTone = this.innerHTML;
  });
}

// ============================================
// SCHEDULE MANAGEMENT
// ============================================
function initializeSchedule() {
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  
  days.forEach(day => {
    const toggle = document.getElementById(`${day}Toggle`);
    const startTime = document.getElementById(`${day}Start`);
    const endTime = document.getElementById(`${day}End`);
    const scheduleDay = document.querySelector(`[data-day="${day}"]`);
    
    if (toggle) {
      toggle.addEventListener('change', function() {
        if (!agentData.config.schedule) agentData.config.schedule = {};
        if (!agentData.config.schedule[day]) agentData.config.schedule[day] = { open: true, start: '09:00', end: '18:00' };
        agentData.config.schedule[day].open = this.checked;
        if (scheduleDay) {
          if (this.checked) {
            scheduleDay.classList.remove('closed');
            if (startTime) startTime.disabled = false;
            if (endTime) endTime.disabled = false;
          } else {
            scheduleDay.classList.add('closed');
            if (startTime) startTime.disabled = true;
            if (endTime) endTime.disabled = true;
          }
        }
      });
    }
    
    if (startTime) {
      startTime.addEventListener('change', function() {
        if (!agentData.config.schedule) agentData.config.schedule = {};
        if (!agentData.config.schedule[day]) agentData.config.schedule[day] = { open: true, start: '09:00', end: '18:00' };
        agentData.config.schedule[day].start = this.value;
      });
    }
    
    if (endTime) {
      endTime.addEventListener('change', function() {
        if (!agentData.config.schedule) agentData.config.schedule = {};
        if (!agentData.config.schedule[day]) agentData.config.schedule[day] = { open: true, start: '09:00', end: '18:00' };
        agentData.config.schedule[day].end = this.value;
      });
    }
  });
}

// ============================================
// HOLIDAYS MANAGEMENT
// ============================================
function initializeHolidays() {
  const addHolidayBtn = document.getElementById('addHolidayBtn');
  
  if (addHolidayBtn) {
    addHolidayBtn.addEventListener('click', addHoliday);
  }
}

function addHoliday() {
  const holidaysList = document.getElementById('holidaysList');
  if (!holidaysList) return;
  
  const holidayId = Date.now();
  const holidayItem = document.createElement('div');
  holidayItem.className = 'holiday-item';
  holidayItem.dataset.holidayId = holidayId;
  
  holidayItem.innerHTML = `
    <div class="holiday-date form-group">
      <input type="date" class="form-input holiday-date-input" required>
    </div>
    <div class="holiday-name form-group">
      <input type="text" class="form-input holiday-name-input" placeholder="Nombre del día festivo" required>
    </div>
    <button type="button" class="btn-remove-holiday" onclick="removeHoliday(${holidayId})">
      <i class="lni lni-trash-can"></i>
    </button>
  `;
  
  holidaysList.appendChild(holidayItem);
  
  const dateInput = holidayItem.querySelector('.holiday-date-input');
  const nameInput = holidayItem.querySelector('.holiday-name-input');
  
  dateInput.addEventListener('change', updateHolidaysData);
  nameInput.addEventListener('input', updateHolidaysData);
}

function removeHoliday(holidayId) {
  const holidayItem = document.querySelector(`[data-holiday-id="${holidayId}"]`);
  if (holidayItem) {
    holidayItem.remove();
    updateHolidaysData();
  }
}

function updateHolidaysData() {
  const holidays = [];
  document.querySelectorAll('.holiday-item').forEach(item => {
    const date = item.querySelector('.holiday-date-input').value;
    const name = item.querySelector('.holiday-name-input').value;
    if (date && name) {
      holidays.push({ date, name });
    }
  });
  agentData.config.holidays = holidays;
}

// ============================================
// SERVICES MANAGEMENT
// ============================================
function initializeServices() {
  const addServiceBtn = document.getElementById('addServiceBtn');
  
  if (addServiceBtn) {
    addServiceBtn.addEventListener('click', addService);
  }
}

function addService() {
  const servicesList = document.getElementById('servicesList');
  if (!servicesList) return;
  
  const serviceId = Date.now();
  const serviceNumber = document.querySelectorAll('.service-item').length + 1;
  const serviceItem = document.createElement('div');
  serviceItem.className = 'service-item';
  serviceItem.dataset.serviceId = serviceId;

  const svcUid = 'svc_' + serviceId;
  const serviceLabel   = window._currentSvcItemLabel || 'Servicio';
  const svcPlaceholder = _getServicePlaceholder();
  const fotosLabel     = serviceLabel === 'Curso' ? 'Fotos del Curso' : (serviceLabel === 'Servicio' ? 'Fotos del Servicio' : 'Fotos del Producto');

  serviceItem.innerHTML = `
    <div class="service-header">
      <div class="service-number">${serviceLabel} ${serviceNumber}</div>
      <button type="button" class="btn-remove-service" onclick="removeService(${serviceId})">
        <i class="lni lni-trash-can"></i>
      </button>
    </div>
    <div class="service-fields">
      <div class="form-group">
        <label class="form-label">Título del ${serviceLabel} *</label>
        <input type="text" class="form-input service-title" placeholder="${svcPlaceholder}" required>
      </div>

      <!-- FOTOS DEL SERVICIO -->
      <div class="form-group">
        <label class="form-label">${fotosLabel}</label>
        <div class="service-image-upload" data-uid="${svcUid}">
          <input type="file" class="service-image-file" id="file_${svcUid}" accept="image/*" style="display:none" multiple>
          <div class="service-images-grid">
            <div class="service-img-add-btn">
              <i class="lni lni-camera"></i>
              <span>Agregar foto</span>
            </div>
          </div>
          <input type="hidden" class="service-image-urls" value="">
          <div class="service-image-uploading" style="display:none">
            <i class="lni lni-spinner-arrow"></i> Subiendo...
          </div>
        </div>
      </div>
      
      <div class="form-group">
        <label class="form-label">Tipo de Precio</label>
        <div class="price-type-selector">
          <div class="price-type-option active" data-type="normal">Precio Normal</div>
          <div class="price-type-option" data-type="promotion">Promoción</div>
        </div>
      </div>
      
      <div class="form-group price-normal">
        <label class="form-label">Precio *</label>
        <div class="price-input-wrapper">
          <span class="price-currency">$</span>
          <input type="number" class="form-input service-price price-input" placeholder="0.00" step="0.01" required>
        </div>
      </div>
      
      <div class="promotion-prices">
        <div class="form-group">
          <label class="form-label">Precio Original *</label>
          <div class="price-input-wrapper">
            <span class="price-currency">$</span>
            <input type="number" class="form-input service-original-price price-input" placeholder="0.00" step="0.01">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Precio Promoción *</label>
          <div class="price-input-wrapper">
            <span class="price-currency">$</span>
            <input type="number" class="form-input service-promo-price price-input" placeholder="0.00" step="0.01">
          </div>
        </div>
      </div>

      <!-- PERIODO DE PROMOCIÓN -->
      <div class="promo-period-block" style="display:none">
        <div class="promo-period-header">
          <i class="lni lni-calendar"></i>
          <span>Disponibilidad de la promoción</span>
          <div class="promo-period-type-toggle">
            <button type="button" class="period-tab-btn active" data-period="days">Días de la semana</button>
            <button type="button" class="period-tab-btn" data-period="range">Rango de fechas</button>
          </div>
        </div>
        <div class="promo-days-panel" style="display:flex">
          <label class="day-chip"><input type="checkbox" value="monday" style="display:none"><span>Lun</span></label>
          <label class="day-chip"><input type="checkbox" value="tuesday" style="display:none"><span>Mar</span></label>
          <label class="day-chip"><input type="checkbox" value="wednesday" style="display:none"><span>Mié</span></label>
          <label class="day-chip"><input type="checkbox" value="thursday" style="display:none"><span>Jue</span></label>
          <label class="day-chip"><input type="checkbox" value="friday" style="display:none"><span>Vie</span></label>
          <label class="day-chip"><input type="checkbox" value="saturday" style="display:none"><span>Sáb</span></label>
          <label class="day-chip"><input type="checkbox" value="sunday" style="display:none"><span>Dom</span></label>
        </div>
        <div class="promo-range-panel" style="display:none">
          <label class="form-label">Desde</label>
          <input type="date" class="form-input promo-date-start">
          <label class="form-label">Hasta</label>
          <input type="date" class="form-input promo-date-end">
        </div>
      </div>
      
      <div class="form-group">
        <label class="form-label">Descripción del Servicio</label>
        <div class="service-description-editor">
          <div class="service-editor-toolbar">
            <button type="button" class="service-editor-btn" data-command="bold" title="Negrita">
              <i class="lni lni-text-format"></i>
            </button>
            <button type="button" class="service-editor-btn" data-command="italic" title="Cursiva">
              <i class="lni lni-italic"></i>
            </button>
            <button type="button" class="service-editor-btn" data-command="underline" title="Subrayado">
              <i class="lni lni-underline"></i>
            </button>
            <button type="button" class="service-editor-btn" data-command="insertUnorderedList" title="Lista">
              <i class="lni lni-list"></i>
            </button>
          </div>
          <div class="service-editor-content" 
               contenteditable="true" 
               data-placeholder="Describe las características del servicio...">
          </div>
        </div>
      </div>
    </div>
  `;
  
  servicesList.appendChild(serviceItem);

  // Si es modo gobierno, ocultar campos de precio y agregar campos de curso
  if (isGovernment) {
    _hideServicePriceFields(serviceItem);
    _injectCourseGovFields(serviceItem, null);
  }
  
  const editorButtons = serviceItem.querySelectorAll('.service-editor-btn');
  const editorContent = serviceItem.querySelector('.service-editor-content');
  
  editorButtons.forEach(btn => {
    btn.addEventListener('click', function() {
      const command = this.dataset.command;
      document.execCommand(command, false, null);
      editorContent.focus();
    });
  });
  
  editorContent.addEventListener('input', function() {
    updateServicesData();
  });
  
  const priceTypeOptions = serviceItem.querySelectorAll('.price-type-option');
  const promotionPrices = serviceItem.querySelector('.promotion-prices');
  const normalPrice = serviceItem.querySelector('.price-normal');
  
  priceTypeOptions.forEach(option => {
    option.addEventListener('click', function() {
      priceTypeOptions.forEach(opt => opt.classList.remove('active'));
      this.classList.add('active');
      
      if (this.dataset.type === 'promotion') {
        promotionPrices.classList.add('show');
        normalPrice.style.display = 'none';
      } else {
        promotionPrices.classList.remove('show');
        normalPrice.style.display = 'block';
      }
      updateServicesData();
    });
  });
  
  serviceItem.querySelectorAll('input, textarea').forEach(input => {
    input.addEventListener('input', updateServicesData);
  });

  // ── Promo period toggle ──────────────────────────────────────────────────
  const promoPeriodBlock = serviceItem.querySelector('.promo-period-block');
  serviceItem.querySelectorAll('.period-tab-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      serviceItem.querySelectorAll('.period-tab-btn').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      const isRange = this.dataset.period === 'range';
      serviceItem.querySelector('.promo-days-panel').style.display = isRange ? 'none' : 'flex';
      serviceItem.querySelector('.promo-range-panel').style.display = isRange ? 'flex' : 'none';
    });
  });

  serviceItem.querySelectorAll('.promo-days-panel .day-chip').forEach(chip => {
    chip.addEventListener('click', function(e) {
      e.preventDefault();
      this.classList.toggle('active');
      this.querySelector('input').checked = this.classList.contains('active');
    });
  });

  // Show/hide promo period block when switching price type
  const _origPriceTypeOpts = serviceItem.querySelectorAll('.price-type-option');
  _origPriceTypeOpts.forEach(option => {
    option.addEventListener('click', function() {
      const isPromo = this.dataset.type === 'promotion';
      if (promoPeriodBlock) promoPeriodBlock.style.display = isPromo ? 'block' : 'none';
    });
  });

  // ── Multi-image upload ───────────────────────────────────────────────────
  const _grid      = serviceItem.querySelector('.service-images-grid');
  const _fileInput = serviceItem.querySelector('.service-image-file');
  const _urlsInput = serviceItem.querySelector('.service-image-urls');
  const _uploadingEl = serviceItem.querySelector('.service-image-uploading');
  const _addBtn    = serviceItem.querySelector('.service-img-add-btn');

  function _syncUrls() {
    // Solo incluir URLs confirmadas (no las pendientes de upload)
    const urls = [..._grid.querySelectorAll('.service-img-thumb')]
      .filter(t => !t.dataset.pending && t.dataset.url)
      .map(t => t.dataset.url);
    _urlsInput.value = urls.join(',');
  }

  _grid.addEventListener('click', function(e) {
    const removeBtn = e.target.closest('.btn-remove-thumb');
    if (removeBtn) {
      e.stopPropagation();
      removeBtn.closest('.service-img-thumb').remove();
      _syncUrls();
      return;
    }
    if (!e.target.closest('.service-img-thumb')) {
      _fileInput.click();
    }
  });

  _fileInput.addEventListener('change', async function() {
    const files = [...this.files];
    if (!files.length) return;
    const oversize = files.filter(f => f.size > 5 * 1024 * 1024);
    if (oversize.length) {
      alert('Cada imagen debe ser menor a 5 MB');
      return;
    }

    // ── Guardar en memoria como base64; el upload real ocurre al crear el agente ──
    for (const file of files) {
      await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          // Crear preview local inmediato
          const previewUrl = e.target.result; // data URL para mostrar
          _addThumb(previewUrl, file);         // almacena el File en el thumb
          resolve();
        };
        reader.readAsDataURL(file);
      });
    }
    _syncUrls();
    _fileInput.value = '';
  });

  // url puede ser un data-URL (pendiente) o una URL real (ya subida / precargada)
  function _addThumb(url, pendingFile) {
    const thumb = document.createElement('div');
    thumb.className = 'service-img-thumb';
    // Si viene de precarga (URL real) la marcamos directamente; si es local, queda pendiente
    if (pendingFile) {
      thumb.dataset.pending = 'true';
      thumb._pendingFile = pendingFile; // referencia al File original
      thumb.dataset.url = '';           // se llenará tras el upload
    } else {
      thumb.dataset.url = url;
    }
    thumb.innerHTML = `<img src="${url}" alt="Foto"><button type="button" class="btn-remove-thumb" title="Quitar"><i class="lni lni-close"></i></button>`;
    _grid.insertBefore(thumb, _addBtn);
  }
}

function removeService(serviceId) {
  const serviceItem = document.querySelector(`[data-service-id="${serviceId}"]`);
  if (serviceItem) {
    serviceItem.remove();
    updateServicesData();
    
    document.querySelectorAll('.service-item').forEach((item, index) => {
      const numberDiv = item.querySelector('.service-number');
      if (numberDiv) {
        const lbl = window._currentSvcItemLabel || 'Servicio';
        numberDiv.textContent = `${lbl} ${index + 1}`;
      }
    });
  }
}

function updateServicesData() {
  const services = [];
  document.querySelectorAll('.service-item').forEach(item => {
    const title = item.querySelector('.service-title').value;
    const editorContent = item.querySelector('.service-editor-content');
    const description = editorContent ? editorContent.innerHTML : '';
    const priceType = item.querySelector('.price-type-option.active').dataset.type;
    
    // Imágenes
    const imageUrls = (item.querySelector('.service-image-urls')?.value || '').split(',').filter(Boolean);

    let price, originalPrice, promoPrice;
    let promoPeriodType = 'days', promoDays = [], promoDateStart = '', promoDateEnd = '';

    if (priceType === 'promotion') {
      originalPrice = parseFloat(item.querySelector('.service-original-price').value) || 0;
      promoPrice = parseFloat(item.querySelector('.service-promo-price').value) || 0;

      const activePeriodBtn = item.querySelector('.period-tab-btn.active');
      if (activePeriodBtn) promoPeriodType = activePeriodBtn.dataset.period;
      if (promoPeriodType === 'days') {
        item.querySelectorAll('.promo-days-panel .day-chip input:checked').forEach(cb => {
          promoDays.push(cb.value);
        });
      } else {
        promoDateStart = item.querySelector('.promo-date-start')?.value || '';
        promoDateEnd   = item.querySelector('.promo-date-end')?.value   || '';
      }
    } else {
      price = parseFloat(item.querySelector('.service-price').value) || 0;
    }
    
    if (title) {
      services.push({
        title,
        description,
        imageUrls,
        priceType,
        price: priceType === 'normal' ? price : null,
        originalPrice: priceType === 'promotion' ? originalPrice : null,
        promoPrice: priceType === 'promotion' ? promoPrice : null,
        promoPeriodType: priceType === 'promotion' ? promoPeriodType : '',
        promoDays:       priceType === 'promotion' && promoPeriodType === 'days' ? promoDays : [],
        promoDateStart:  priceType === 'promotion' && promoPeriodType === 'range' ? promoDateStart : '',
        promoDateEnd:    priceType === 'promotion' && promoPeriodType === 'range' ? promoDateEnd   : '',
      });
    }
  });
  agentData.config.services = services;
}

// ============================================
// WORKERS MANAGEMENT
// ============================================
function initializeWorkers() {
  const addWorkerBtn = document.getElementById('addWorkerBtn');
  
  if (addWorkerBtn) {
    addWorkerBtn.addEventListener('click', addWorker);
  }
}

function addWorker() {
  const workersList = document.getElementById('workersList');
  if (!workersList) return;
  
  const workerId = Date.now();
  const workerNumber = document.querySelectorAll('.worker-item').length + 1;
  const workerItem = document.createElement('div');
  workerItem.className = 'worker-item';
  workerItem.dataset.workerId = workerId;
  
  workerItem.innerHTML = `
    <div class="worker-header">
      <div class="worker-number">Trabajador ${workerNumber}</div>
      <button type="button" class="btn-remove-worker" onclick="removeWorker(${workerId})">
        <i class="lni lni-trash-can"></i>
      </button>
    </div>
    <div class="worker-fields">
      <div class="form-group">
        <label class="form-label">Nombre del Trabajador *</label>
        <input type="text" class="form-input worker-name" placeholder="Ej: Juan Pérez" required>
      </div>
      
      <div class="worker-availability">
        <div class="availability-title">Disponibilidad (Días de la Semana)</div>
        <div class="availability-grid">
          <label class="availability-day">
            <input type="checkbox" value="monday" checked>
            <span>Lunes</span>
          </label>
          <label class="availability-day">
            <input type="checkbox" value="tuesday" checked>
            <span>Martes</span>
          </label>
          <label class="availability-day">
            <input type="checkbox" value="wednesday" checked>
            <span>Miércoles</span>
          </label>
          <label class="availability-day">
            <input type="checkbox" value="thursday" checked>
            <span>Jueves</span>
          </label>
          <label class="availability-day">
            <input type="checkbox" value="friday" checked>
            <span>Viernes</span>
          </label>
          <label class="availability-day">
            <input type="checkbox" value="saturday">
            <span>Sábado</span>
          </label>
          <label class="availability-day">
            <input type="checkbox" value="sunday">
            <span>Domingo</span>
          </label>
        </div>
      </div>
      
      <div class="worker-hours">
        <div class="form-group">
          <label class="form-label">Hora de Inicio</label>
          <input type="time" class="form-input worker-start-time" value="09:00" required>
        </div>
        <div class="form-group">
          <label class="form-label">Hora de Fin</label>
          <input type="time" class="form-input worker-end-time" value="18:00" required>
        </div>
      </div>
    </div>
  `;
  
  workersList.appendChild(workerItem);
  
  workerItem.querySelectorAll('input').forEach(input => {
    input.addEventListener('input', updateWorkersData);
    input.addEventListener('change', updateWorkersData);
  });
}

function removeWorker(workerId) {
  const workerItem = document.querySelector(`[data-worker-id="${workerId}"]`);
  if (workerItem) {
    workerItem.remove();
    updateWorkersData();
    
    document.querySelectorAll('.worker-item').forEach((item, index) => {
      const numberDiv = item.querySelector('.worker-number');
      if (numberDiv) {
        numberDiv.textContent = `Trabajador ${index + 1}`;
      }
    });
  }
}

function updateWorkersData() {
  const workers = [];
  document.querySelectorAll('.worker-item').forEach(item => {
    const name = item.querySelector('.worker-name').value;
    const startTime = item.querySelector('.worker-start-time').value;
    const endTime = item.querySelector('.worker-end-time').value;
    
    const days = [];
    item.querySelectorAll('.availability-day input:checked').forEach(checkbox => {
      days.push(checkbox.value);
    });
    
    if (name && startTime && endTime) {
      workers.push({
        name,
        startTime,
        endTime,
        days
      });
    }
  });
  agentData.config.workers = workers;
}

// ============================================
// LOCATION DROPDOWNS
// ============================================
function initializeLocationDropdowns() {
  createLocationDropdown('countryInput', COUNTRIES, 'Selecciona un país');
  createLocationDropdown('stateInput', STATES_MEXICO.map(s => ({ 
    value: s.toLowerCase().replace(/\s+/g, '-'), 
    name: s 
  })), 'Selecciona un estado');
  createLocationDropdown('cityInput', CITIES_MEXICO.default.map(c => ({ 
    value: c.toLowerCase().replace(/\s+/g, '-'), 
    name: c 
  })), 'Selecciona una ciudad');
}

function createLocationDropdown(inputId, options, placeholder) {
  const input = document.getElementById(inputId);
  if (!input) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'location-dropdown-wrapper';
  
  const displayInput = document.createElement('input');
  displayInput.type = 'text';
  displayInput.className = 'form-input location-select';
  displayInput.placeholder = placeholder;
  displayInput.readOnly = true;
  
  const arrow = document.createElement('i');
  arrow.className = 'lni lni-chevron-down location-arrow';
  
  const dropdown = document.createElement('div');
  dropdown.className = 'location-dropdown';
  
  const searchContainer = document.createElement('div');
  searchContainer.className = 'location-search-container';
  searchContainer.innerHTML = `
    <i class="lni lni-search-alt location-search-icon"></i>
    <input type="text" class="location-search" placeholder="Buscar..." autocomplete="off">
  `;
  
  const optionsContainer = document.createElement('div');
  optionsContainer.className = 'location-options-container';
  
  options.forEach(opt => {
    const option = document.createElement('div');
    option.className = 'location-option';
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
  
  const searchInput = searchContainer.querySelector('.location-search');
  const selectOptions = optionsContainer.querySelectorAll('.location-option');
  
  displayInput.addEventListener('click', function(e) {
    e.stopPropagation();
    toggleLocationDropdown(wrapper, searchInput, selectOptions);
  });
  
  searchInput.addEventListener('input', function() {
    filterLocationOptions(this.value, selectOptions);
  });
  
  searchInput.addEventListener('click', function(e) {
    e.stopPropagation();
  });
  
  selectOptions.forEach(option => {
    option.addEventListener('click', function(e) {
      e.stopPropagation();
      selectLocationOption(this, displayInput, input, wrapper, selectOptions, inputId);
    });
  });
  
  document.addEventListener('click', function(e) {
    if (!wrapper.contains(e.target)) {
      closeLocationDropdown(wrapper);
    }
  });
}

function toggleLocationDropdown(wrapper, searchInput, options) {
  const isActive = wrapper.classList.contains('active');
  
  document.querySelectorAll('.location-dropdown-wrapper.active').forEach(w => {
    if (w !== wrapper) w.classList.remove('active');
  });
  
  if (isActive) {
    closeLocationDropdown(wrapper);
  } else {
    wrapper.classList.add('active');
    setTimeout(() => searchInput.focus(), 100);
    searchInput.value = '';
    options.forEach(opt => opt.classList.remove('hidden'));
  }
}

function closeLocationDropdown(wrapper) {
  wrapper.classList.remove('active');
  const searchInput = wrapper.querySelector('.location-search');
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

function selectLocationOption(option, displayInput, hiddenInput, wrapper, allOptions, inputId) {
  const value = option.getAttribute('data-value');
  const text = option.querySelector('span')?.textContent;
  
  displayInput.value = text;
  hiddenInput.value = text;
  hiddenInput.setAttribute('data-value', value);
  
  allOptions.forEach(opt => opt.classList.remove('selected'));
  option.classList.add('selected');
  
  // Update agentData
  if (inputId === 'countryInput') {
    agentData.location.country = text;
  } else if (inputId === 'stateInput') {
    agentData.location.state = text;
  } else if (inputId === 'cityInput') {
    agentData.location.city = text;
  }
  
  closeLocationDropdown(wrapper);
}

// ============================================
// SOCIAL MEDIA INPUTS
// ============================================
function initializeSocialMediaInputs() {
  const socialInputs = {
    'facebookInput': 'facebook',
    'instagramInput': 'instagram',
    'twitterInput': 'twitter',
    'linkedinInput': 'linkedin'
  };
  
  Object.keys(socialInputs).forEach(inputId => {
    const input = document.getElementById(inputId);
    if (input) {
      input.addEventListener('input', function() {
        agentData.social_media[socialInputs[inputId]] = this.value;
      });
    }
  });
  
  // Location text inputs
  const locationInputs = {
    'addressInput': 'address',
    'postalCodeInput': 'postalCode',
    'betweenStreetsInput': 'betweenStreets',
    'numberInput': 'number',
    'neighborhoodInput': 'neighborhood'
  };
  
  Object.keys(locationInputs).forEach(inputId => {
    const input = document.getElementById(inputId);
    if (input) {
      input.addEventListener('input', function() {
        agentData.location[locationInputs[inputId]] = this.value;
      });
    }
  });
}

// ============================================
// NAVIGATION
// ============================================
function initializeNavigationButtons() {
  const btnStep1 = document.getElementById('btnStep1');
  if (btnStep1) {
    btnStep1.addEventListener('click', () => nextStep());
  }
  
  const btnStep2Unified = document.getElementById('btnStep2Unified');
  if (btnStep2Unified) {
    btnStep2Unified.addEventListener('click', () => nextStep());
  }
  
  const btnBackStep3 = document.getElementById('btnBackStep3');
  if (btnBackStep3) {
    btnBackStep3.addEventListener('click', () => previousStep());
  }
  
  const btnCreateAgent = document.getElementById('btnCreateAgent');
  if (btnCreateAgent) {
    console.log('✅ Botón Crear Agente encontrado, agregando event listener');
    btnCreateAgent.addEventListener('click', () => {
      console.log('🔘 Click en botón Crear Agente');
      createAgent();
    });
  } else {
    console.warn('⚠️ Botón Crear Agente no encontrado en initializeNavigationButtons');
  }
  
  const btnGoToDashboard = document.getElementById('btnGoToDashboard');
  if (btnGoToDashboard) {
    btnGoToDashboard.addEventListener('click', function() {
      window.location.href = '/dashboard';
    });
  }
}

function nextStep() {
  if (currentStep === 1 && !selectedSocial) {
    alert('Por favor selecciona una red social');
    return;
  }

  if (currentStep === 2) {
    if (!validateStep2()) {
      return;
    }
    collectFormData();
  }

  if (currentStep === 3) {
    return;
  }

  currentStep++;
  updateStepDisplay();
  updateProgressBar();

  if (currentStep === 3) {
    generateSummary();
  }
}

function previousStep() {
  if (currentStep === 1) return;

  currentStep--;
  updateStepDisplay();
  updateProgressBar();
}

function validateStep2() {
  const agentName = document.getElementById('agentName').value.trim();

  if (!agentName) {
    alert('Por favor ingresa el nombre del agente');
    document.getElementById('agentName').focus();
    return false;
  }

  const useDifferentPhone = document.getElementById('phoneToggle').checked;
  if (useDifferentPhone) {
    const phoneNumber = document.getElementById('phoneNumber').value.trim();
    if (!phoneNumber) {
      alert('Por favor ingresa el número de teléfono');
      document.getElementById('phoneNumber').focus();
      return false;
    }
  }

  return true;
}

function updateStepDisplay() {
  document.querySelectorAll('.step').forEach(step => {
    step.classList.remove('active');
  });
  document.getElementById(`step${currentStep}`).classList.add('active');
  window.scrollTo(0, 0);
}

function updateProgressBar() {
  let fraction;
  if (currentStep === 1) {
    fraction = 0;
  } else if (currentStep === 2) {
    // Opción B: solo las 9 secciones del paso 2 marcan el progreso real (0%→100%)
    fraction = currentSection / SECTIONS.length;
  } else {
    fraction = 1.0;
  }

  // Porcentaje numérico
  const progressPercentage = document.getElementById('progressPercentage');
  if (progressPercentage) {
    const targetPct = Math.round(fraction * 100);
    const currentPct = parseInt(progressPercentage.textContent) || 0;
    animatePercentage(currentPct, targetPct, progressPercentage);
  }

  // Mover tope del dot-indicator
  setDotTarget(fraction);
}

function animatePercentage(start, end, element) {
  const duration = 600;
  const startTime = performance.now();
  
  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    
    const easeOutCubic = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(start + (end - start) * easeOutCubic);
    
    element.textContent = current + '%';
    
    if (progress < 1) {
      requestAnimationFrame(update);
    }
  }
  
  requestAnimationFrame(update);
}

function collectFormData() {
  // Solo datos propios del agente
  agentData.name = document.getElementById('agentName').value.trim();

  // Si es Telegram, el phoneNumber es el token del bot
  const telegramTokenInput = document.getElementById('telegramBotToken');
  const isTelegram = (agentData.social || '').toLowerCase() === 'telegram';

  if (isTelegram && telegramTokenInput && telegramTokenInput.value.trim()) {
    agentData.phoneNumber = telegramTokenInput.value.trim();
  } else {
    const useDifferentPhone = document.getElementById('phoneToggle').checked;
    if (useDifferentPhone) {
      const countryCode = document.getElementById('countryCode')?.value || '+52';
      const phoneNumber = document.getElementById('phoneNumber').value.trim();
      agentData.phoneNumber = countryCode + phoneNumber;
    } else {
      agentData.phoneNumber = '';
    }
  }

  const tone = document.querySelector('input[name="tone"]:checked');
  if (tone) {
    agentData.config.tone = tone.value;
    if (tone.value === 'custom') {
      const editorContent = document.getElementById('editorContent');
      if (editorContent) agentData.config.customTone = editorContent.innerHTML;
    }
  }

  // Idiomas seleccionados
  const langs = document.querySelectorAll('input[name="language"]:checked');
  agentData.config.languages = Array.from(langs).map(l => l.value);

  // Instrucciones especiales
  const special = document.getElementById('specialInstructionsInput');
  if (special) agentData.config.specialInstructions = special.value.trim();
}

function generateSummary() {
  const container = document.getElementById('summaryContainer');
  if (!container) return;

  const socialNames = {
    whatsapp: 'WhatsApp',
    facebook: 'Facebook Messenger',
    instagram: 'Instagram',
    telegram: 'Telegram',
    wechat: 'WeChat',
    kakaotalk: 'KakaoTalk',
    line: 'Line'
  };

  let html = `
    <div class="summary-section">
      <h3 class="summary-section-title">
        <i class="lni lni-network"></i>
        Red Social
      </h3>
      <div class="summary-item">
        <span class="summary-label">Plataforma:</span>
        <span class="summary-value">${socialNames[agentData.social]}</span>
      </div>
    </div>
    
    <div class="summary-section">
      <h3 class="summary-section-title">
        <i class="lni lni-information"></i>
        Información Básica
      </h3>
      <div class="summary-item">
        <span class="summary-label">Nombre del Agente:</span>
        <span class="summary-value">${agentData.name}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Número de Teléfono:</span>
        <span class="summary-value">${agentData.phoneNumber || 'Usar número registrado'}</span>
      </div>
      ${agentData.config.additionalLanguages.length > 0 ? `
      <div class="summary-item">
        <span class="summary-label">Idiomas Adicionales:</span>
        <span class="summary-value">${agentData.config.additionalLanguages.join(', ')}</span>
      </div>
      ` : ''}
    </div>
    
    <div class="summary-section">
      <h3 class="summary-section-title">
        <i class="lni lni-comments"></i>
        Personalidad
      </h3>
      <div class="summary-item">
        <span class="summary-label">Tono:</span>
        <span class="summary-value">${formatTone(agentData.config.tone)}</span>
      </div>
    </div>
  `;

  if (isGovernment) {
    // ── Resumen Gubernamental ────────────────────────────────────────────────
    const depName    = businessData?.depName     || document.getElementById('businessNameInput')?.value || '';
    const depAcronym = businessData?.depAcronym  || document.getElementById('depAcronymInput')?.value   || '';
    const depArea    = businessData?.depArea     || document.getElementById('depAreaInput')?.value      || '';
    const depParent  = businessData?.depParent   || document.getElementById('depParentInput')?.value    || '';
    const govLevel   = _govLevelLabel(businessData?.govLevel || '');
    const description = businessData?.description || document.getElementById('businessDescInput')?.value || '';
    const email      = businessData?.email       || document.getElementById('emailContactInput')?.value || '';
    const website    = businessData?.website     || document.getElementById('websiteInput')?.value      || '';
    const phone      = businessData?.phoneNumber || '';

    html += `
      <div class="summary-section">
        <h3 class="summary-section-title">
          <i class="lni lni-government"></i>
          Mi Dependencia
        </h3>
        ${depName    ? `<div class="summary-item"><span class="summary-label">Nombre:</span><span class="summary-value">${depName}</span></div>` : ''}
        ${depAcronym ? `<div class="summary-item"><span class="summary-label">Siglas:</span><span class="summary-value">${depAcronym}</span></div>` : ''}
        ${depArea    ? `<div class="summary-item"><span class="summary-label">Área:</span><span class="summary-value">${depArea}</span></div>` : ''}
        ${depParent  ? `<div class="summary-item"><span class="summary-label">Organismo superior:</span><span class="summary-value">${depParent}</span></div>` : ''}
        ${govLevel   ? `<div class="summary-item"><span class="summary-label">Nivel de gobierno:</span><span class="summary-value">${govLevel}</span></div>` : ''}
        ${description ? `<div class="summary-item"><span class="summary-label">Descripción:</span><span class="summary-value">${description}</span></div>` : ''}
        ${email      ? `<div class="summary-item"><span class="summary-label">Email:</span><span class="summary-value">${email}</span></div>` : ''}
        ${website    ? `<div class="summary-item"><span class="summary-label">Sitio web:</span><span class="summary-value">${website}</span></div>` : ''}
        ${phone      ? `<div class="summary-item"><span class="summary-label">Teléfono:</span><span class="summary-value">${phone}</span></div>` : ''}
      </div>
    `;

    // Ubicación gubernamental
    const addr  = businessData?.address || agentData.location.address || '';
    const city  = businessData?.city    || agentData.location.city    || '';
    const state = businessData?.state   || agentData.location.state   || '';
    if (addr || city) {
      html += `
        <div class="summary-section">
          <h3 class="summary-section-title"><i class="lni lni-map-marker"></i>Ubicación</h3>
          ${addr  ? `<div class="summary-item"><span class="summary-label">Dirección:</span><span class="summary-value">${addr}</span></div>` : ''}
          ${city  ? `<div class="summary-item"><span class="summary-label">Ciudad:</span><span class="summary-value">${city}${state ? ', '+state : ''}</span></div>` : ''}
        </div>
      `;
    }

    // Redes sociales
    const soc = agentData.social_media || {};
    if (soc.facebook || soc.instagram || soc.twitter || soc.linkedin) {
      html += `
        <div class="summary-section">
          <h3 class="summary-section-title"><i class="lni lni-share-alt"></i>Redes Sociales</h3>
          ${soc.facebook  ? `<div class="summary-item"><span class="summary-label">Facebook:</span><span class="summary-value">${soc.facebook}</span></div>` : ''}
          ${soc.instagram ? `<div class="summary-item"><span class="summary-label">Instagram:</span><span class="summary-value">${soc.instagram}</span></div>` : ''}
          ${soc.twitter   ? `<div class="summary-item"><span class="summary-label">Twitter/X:</span><span class="summary-value">${soc.twitter}</span></div>` : ''}
          ${soc.linkedin  ? `<div class="summary-item"><span class="summary-label">LinkedIn:</span><span class="summary-value">${soc.linkedin}</span></div>` : ''}
        </div>
      `;
    }

    // Horarios
    const sched = businessData?.schedule || {};
    const days = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
    const openDays = days.filter(d => { const dd = sched[d]; return dd && (dd.isOpen || dd.open); });
    if (openDays.length > 0) {
      html += `
        <div class="summary-section">
          <h3 class="summary-section-title"><i class="lni lni-calendar"></i>Horario de Atención</h3>
          <ul class="summary-list">
            ${openDays.map(d => {
              const dd = sched[d];
              return `<li>${formatDay(d)}: ${dd.open||dd.start||'09:00'} – ${dd.close||dd.end||'18:00'}</li>`;
            }).join('')}
          </ul>
        </div>
      `;
    }

    // Días inhábiles
    const hols = businessData?.holidays || [];
    if (hols.length > 0) {
      html += `
        <div class="summary-section">
          <h3 class="summary-section-title"><i class="lni lni-gift"></i>Días Inhábiles</h3>
          <ul class="summary-list">
            ${hols.map(h => `<li>${h.date} – ${h.name}</li>`).join('')}
          </ul>
        </div>
      `;
    }

    // Cursos
    const cursos = businessData?.cursos || [];
    if (cursos.length > 0) {
      html += `
        <div class="summary-section">
          <h3 class="summary-section-title"><i class="lni lni-graduation"></i>Cursos y Talleres</h3>
          <ul class="summary-list">
            ${cursos.map(c => `<li><strong>${c.title}</strong>${c.modalidad ? ' – '+c.modalidad : ''}</li>`).join('')}
          </ul>
        </div>
      `;
    }

  } else {
    // ── Resumen Normal (Negocio privado) ────────────────────────────────────
    const businessTypeNames = {
      'clinica-dental': 'Clínica Dental',
      'peluqueria': 'Peluquería / Salón de Belleza',
      'restaurante': 'Restaurante',
      'pizzeria': 'Pizzería',
      'escuela': 'Escuela / Educación',
      'gym': 'Gimnasio / Fitness',
      'spa': 'Spa / Wellness',
      'consultorio': 'Consultorio Médico',
      'veterinaria': 'Veterinaria',
      'hotel': 'Hotel / Hospedaje',
      'tienda': 'Tienda / Retail',
      'agencia': 'Agencia / Servicios',
      'otro': 'Otro'
    };

    // Append businessType to basic info section (only in private mode)
    html = html.replace(
      '<span class="summary-label">Número de Teléfono:</span>',
      `<span class="summary-label">Tipo de Negocio:</span>
        </div><div class="summary-item">
        <span class="summary-value">${businessTypeNames[agentData.businessType] || agentData.businessType}</span>
        </div><div class="summary-item"><span class="summary-label">Número de Teléfono:</span>`
    );

    const biz   = businessData?.business   || {};
    const loc   = businessData?.location   || {};
    const soc   = businessData?.social     || {};
    const sched = businessData?.schedule   || {};
    const hols  = businessData?.holidays   || [];
    const svcs  = businessData?.services   || [];
    const wrks  = businessData?.workers    || [];

    if (biz.name || biz.description || biz.email || biz.website) {
      html += `
        <div class="summary-section">
          <h3 class="summary-section-title">
            <i class="lni lni-briefcase"></i>
            Mi Negocio
          </h3>
          ${biz.name ? `<div class="summary-item"><span class="summary-label">Nombre:</span><span class="summary-value">${biz.name}</span></div>` : ''}
          ${biz.typeName || biz.type ? `<div class="summary-item"><span class="summary-label">Tipo:</span><span class="summary-value">${biz.typeName || biz.type}</span></div>` : ''}
          ${biz.description ? `<div class="summary-item"><span class="summary-label">Descripción:</span><span class="summary-value">${biz.description}</span></div>` : ''}
          ${biz.email ? `<div class="summary-item"><span class="summary-label">Email:</span><span class="summary-value">${biz.email}</span></div>` : ''}
          ${biz.website ? `<div class="summary-item"><span class="summary-label">Sitio web:</span><span class="summary-value">${biz.website}</span></div>` : ''}
          ${businessData?.phoneNumber ? `<div class="summary-item"><span class="summary-label">Teléfono:</span><span class="summary-value">${businessData.phoneNumber}</span></div>` : ''}
        </div>
      `;
    }

    if (loc.address || loc.city) {
      html += `
        <div class="summary-section">
          <h3 class="summary-section-title"><i class="lni lni-map-marker"></i>Ubicación</h3>
          ${loc.address ? `<div class="summary-item"><span class="summary-label">Dirección:</span><span class="summary-value">${loc.address}${loc.number ? ' #'+loc.number : ''}</span></div>` : ''}
          ${loc.neighborhood ? `<div class="summary-item"><span class="summary-label">Colonia:</span><span class="summary-value">${loc.neighborhood}</span></div>` : ''}
          ${loc.city ? `<div class="summary-item"><span class="summary-label">Ciudad:</span><span class="summary-value">${loc.city}${loc.state ? ', '+loc.state : ''}</span></div>` : ''}
          ${loc.postalCode ? `<div class="summary-item"><span class="summary-label">C.P.:</span><span class="summary-value">${loc.postalCode}</span></div>` : ''}
        </div>
      `;
    }

    if (soc.facebook || soc.instagram || soc.twitter || soc.linkedin) {
      html += `
        <div class="summary-section">
          <h3 class="summary-section-title"><i class="lni lni-share-alt"></i>Redes Sociales</h3>
          ${soc.facebook  ? `<div class="summary-item"><span class="summary-label">Facebook:</span><span class="summary-value">${soc.facebook}</span></div>` : ''}
          ${soc.instagram ? `<div class="summary-item"><span class="summary-label">Instagram:</span><span class="summary-value">${soc.instagram}</span></div>` : ''}
          ${soc.twitter   ? `<div class="summary-item"><span class="summary-label">Twitter/X:</span><span class="summary-value">${soc.twitter}</span></div>` : ''}
          ${soc.linkedin  ? `<div class="summary-item"><span class="summary-label">LinkedIn:</span><span class="summary-value">${soc.linkedin}</span></div>` : ''}
        </div>
      `;
    }

    const days = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
    const openDays = days.filter(d => { const dd = sched[d]; return dd && (dd.isOpen || dd.open); });
    if (openDays.length > 0) {
      html += `
        <div class="summary-section">
          <h3 class="summary-section-title"><i class="lni lni-calendar"></i>Horario de Atención</h3>
          <ul class="summary-list">
            ${openDays.map(d => {
              const dd = sched[d];
              const start = dd.start || dd.openTime  || '09:00';
              const end   = dd.end   || dd.closeTime || '18:00';
              return `<li>${formatDay(d)}: ${start} – ${end}</li>`;
            }).join('')}
          </ul>
        </div>
      `;
    }

    if (hols.length > 0) {
      html += `
        <div class="summary-section">
          <h3 class="summary-section-title"><i class="lni lni-gift"></i>Días Festivos</h3>
          <ul class="summary-list">
            ${hols.map(h => `<li>${h.date} – ${h.name}</li>`).join('')}
          </ul>
        </div>
      `;
    }

    if (svcs.length > 0) {
      html += `
        <div class="summary-section">
          <h3 class="summary-section-title"><i class="lni lni-package"></i>Servicios</h3>
          <ul class="summary-list">
            ${svcs.map(s => {
              let priceText = '';
              if (s.priceType === 'promotion') {
                priceText = ` – $${s.promoPrice} (antes $${s.originalPrice})`;
              } else if (s.price) {
                priceText = ` – $${s.price}`;
              }
              return `<li><strong>${s.title}</strong>${priceText}</li>`;
            }).join('')}
          </ul>
        </div>
      `;
    }

    if (wrks.length > 0) {
      html += `
        <div class="summary-section">
          <h3 class="summary-section-title"><i class="lni lni-users"></i>Trabajadores</h3>
          <ul class="summary-list">
            ${wrks.map(w => `<li><strong>${w.name}</strong> – ${w.startTime} a ${w.endTime} (${(w.days||[]).length} días)</li>`).join('')}
          </ul>
        </div>
      `;
    }
  }

  container.innerHTML = html;
}

function formatTone(tone) {
  const toneNames = {
    'formal': 'Formal',
    'friendly': 'Amigable',
    'casual': 'Casual',
    'custom': 'Personalizado'
  };
  return toneNames[tone] || tone;
}

function formatDay(day) {
  const dayNames = {
    'monday': 'Lunes',
    'tuesday': 'Martes',
    'wednesday': 'Miércoles',
    'thursday': 'Jueves',
    'friday': 'Viernes',
    'saturday': 'Sábado',
    'sunday': 'Domingo'
  };
  return dayNames[day] || day;
}

// ============================================
// ENSURE MODALS EXIST
// ============================================
function ensureModalsExist() {
  // Verificar si ya existen los tres modales
  if (
    document.getElementById('creatingModal') &&
    document.getElementById('qrModal') &&
    document.getElementById('successModal')
  ) {
    return;
  }
  
  // Crear el modal de creación si no existe
  if (!document.getElementById('creatingModal')) {
    const creatingModal = document.createElement('div');
    creatingModal.id = 'creatingModal';
    creatingModal.className = 'overlay creating-modal';
    creatingModal.innerHTML = `
      <div class="creating-content">
        <div class="creating-icon-wrapper">
          <div class="creating-icon robot-icon">
            <i class="lni lni-bot"></i>
          </div>
          <div class="pulse-ring"></div>
          <div class="pulse-ring"></div>
          <div class="pulse-ring"></div>
        </div>

        <h2 class="creating-title">Creando tu Agente</h2>
        <p class="creating-subtitle">
          Configurando infraestructura y desplegando el bot
        </p>

        <div class="agent-info">
          <div class="agent-info-label">Agente</div>
          <div class="agent-info-value" id="agentNameDisplay">Mi Agente</div>
        </div>

        <div class="status-info">
          <div class="current-status">
            <i class="lni lni-cog status-icon" id="currentStatusIcon"></i>
            <span class="status-text" id="currentStatusText">Iniciando creación...</span>
          </div>

          <div class="status-steps" id="statusStepsContainer">
            <div class="status-step active">
              <div class="status-step-indicator"></div>
              <div class="status-step-text">
                <i class="lni lni-apartment"></i> Creando infraestructura
              </div>
            </div>
            <div class="status-step">
              <div class="status-step-indicator"></div>
              <div class="status-step-text">
                <i class="lni lni-cog"></i> Inicializando sistema
              </div>
            </div>
            <div class="status-step">
              <div class="status-step-indicator"></div>
              <div class="status-step-text">
                <i class="lni lni-bot"></i> Desplegando bot
              </div>
            </div>
            <div class="status-step">
              <div class="status-step-indicator"></div>
              <div class="status-step-text">
                <i class="lni lni-checkmark"></i> Completado
              </div>
            </div>
          </div>
        </div>

        <div class="progress-section">
          <div class="progress-bar-bg">
            <div class="progress-bar-fill" id="creationProgressBar"></div>
          </div>

          <div class="time-info">
            <div class="time-item">
              <div class="time-label">Transcurrido</div>
              <div class="time-value" id="timeElapsed">0:00</div>
            </div>
            <div class="time-item">
              <div class="time-label">Estimado</div>
              <div class="time-value" id="timeRemaining">~15:00</div>
            </div>
          </div>
        </div>

        <div class="creating-note">
          <div class="creating-note-icon">
            <i class="lni lni-information"></i>
          </div>
          <p class="creating-note-text">
            Este proceso toma entre 10 y 20 minutos. Estamos configurando tu
            infraestructura en la nube y desplegando tu bot personalizado.
          </p>
        </div>
      </div>
    `;
    document.body.appendChild(creatingModal);
  }
  
  // ── Modal QR (Flujo 1: AtomicBot / WhatsApp Web) ──────────────────────────
  if (!document.getElementById('qrModal')) {
    const qrModal = document.createElement('div');
    qrModal.id = 'qrModal';
    qrModal.className = 'overlay creating-modal';
    qrModal.innerHTML = `
      <div class="creating-content success-modal-content" style="max-width:420px">
        <div class="success-icon-large">
          <i class="lni lni-whatsapp" style="color:#25d366;font-size:3rem"></i>
        </div>
        <h2 class="success-title" style="font-size:1.4rem">Vincula tu WhatsApp</h2>
        <p class="success-subtitle">Escanea el código QR con la app de WhatsApp en tu teléfono</p>

        <!-- QR image / spinner -->
        <div id="qrImageWrapper" style="
          display:flex;align-items:center;justify-content:center;
          min-height:200px;background:#f8fafc;border-radius:12px;
          padding:1rem;margin:1rem 0;border:1px solid #e2e8f0;
        ">
          <div id="qrSpinner" style="text-align:center">
            <div class="loading-spinner" style="margin:0 auto 0.75rem"></div>
            <p style="color:#64748b;font-size:0.85rem;margin:0">Generando código QR...</p>
          </div>
          <img id="qrImage" src="" alt="QR Code"
            style="display:none;max-width:200px;max-height:200px;border-radius:8px" />
        </div>

        <!-- Estado de vinculación -->
        <div id="qrStatusRow" style="
          display:flex;align-items:center;gap:8px;
          justify-content:center;margin-bottom:0.5rem;
          font-size:0.85rem;color:#64748b;
        ">
          <span id="qrStatusDot" style="
            width:8px;height:8px;border-radius:50%;
            background:#f59e0b;flex-shrink:0;display:inline-block
          "></span>
          <span id="qrStatusText">Esperando escaneo...</span>
        </div>

        <div class="creating-note" style="margin-top:1rem">
          <div class="creating-note-icon"><i class="lni lni-information"></i></div>
          <p class="creating-note-text">
            Abre WhatsApp → Dispositivos vinculados → Vincular dispositivo y escanea el QR.
          </p>
        </div>
      </div>
    `;
    document.body.appendChild(qrModal);
  }

  // ── Modal de éxito (Flujo 2: agente completamente listo) ──────────────────
  if (!document.getElementById('successModal')) {
    const successModal = document.createElement('div');
    successModal.id = 'successModal';
    successModal.className = 'overlay creating-modal';
    successModal.innerHTML = `
      <div class="creating-content success-modal-content">
        <div class="success-icon-large">
          <i class="lni lni-checkmark-circle" style="color: #10b981"></i>
        </div>
        <h2 class="success-title">¡Agente Creado Exitosamente!</h2>
        <p class="success-subtitle">Tu agente de IA está listo y operativo</p>

        <div class="agent-details-box">
          <div class="agent-detail-item">
            <span class="agent-detail-label">Nombre:</span>
            <span class="agent-detail-value" id="finalAgentName">Mi Agente</span>
          </div>
          <div class="agent-detail-item">
            <span class="agent-detail-label">Servidor:</span>
            <span class="agent-detail-value" id="finalAgentServer">Compartido</span>
          </div>
          <div class="agent-detail-item">
            <span class="agent-detail-label">Estado:</span>
            <span class="agent-detail-value" style="color: #10b981">
              <i class="lni lni-circle-fill" style="font-size: 8px"></i> Activo
            </span>
          </div>
        </div>

        <button
          type="button"
          id="btnGoToMyAgents"
          class="btn btn-next"
          style="width: 100%; justify-content: center"
          onclick="window.location.href='/my-agents'"
        >
          <i class="lni lni-list"></i>
          <span>Ir a Mis Agentes</span>
        </button>

        <div class="creating-note" style="margin-top: 20px">
          <div class="creating-note-icon"><i class="lni lni-bulb"></i></div>
          <p class="creating-note-text" id="successNoteText">
            Tu agente está listo. Puedes configurarlo desde Mis Agentes.
          </p>
        </div>
      </div>
    `;
    document.body.appendChild(successModal);
  }
}

// ============================================
// QR POLLING (AtomicBot / WhatsApp Web)
// ============================================
function startQRPolling(agentId, agentName) {
  const qrModal        = document.getElementById('qrModal');
  const qrSpinner      = document.getElementById('qrSpinner');
  const qrImage        = document.getElementById('qrImage');
  const qrStatusDot    = document.getElementById('qrStatusDot');
  const qrStatusText   = document.getElementById('qrStatusText');
  if (!qrModal) return;

  qrModal.classList.add('show');

  let _qrPollTimer = null;

  async function pollQR() {
    try {
      const resp = await fetch(`/api/agents/${agentId}/qr`, { credentials: 'include' });
      if (!resp.ok) {
        console.warn('⚠️ QR endpoint status:', resp.status);
        return;
      }

      const contentType = resp.headers.get('Content-Type') || '';
      console.log('📡 QR response Content-Type:', contentType);

      // ── Caso A: el endpoint devuelve imagen PNG/JPEG directamente ──────────
      if (contentType.includes('image/')) {
        const blob = await resp.blob();
        const objectUrl = URL.createObjectURL(blob);
        qrSpinner.style.display        = 'none';
        qrImage.src                    = objectUrl;
        qrImage.style.display          = 'block';
        qrStatusDot.style.background   = '#f59e0b';
        qrStatusText.textContent       = 'Esperando escaneo...';
        return;
      }

      // ── Caso B: JSON ───────────────────────────────────────────────────────
      const data = await resp.json();
      console.log('📡 QR response JSON:', data);

      // Detectar vinculación — cubre campos comunes del backend
      const isLinked =
        data.connected === true      ||
        data.linked === true ||
        data.status === 'connected'  || data.status === 'logged_in'  || data.status === 'active' ||
        data.whatsapp_status === 'connected' || data.whatsapp_status === 'logged_in' ||
        data.device_linked === true  ||
        data.qr_code === null        || data.qr === null ||
        data.message === 'connected' || data.message === 'linked';

      if (isLinked) {
        clearInterval(_qrPollTimer);
        qrModal.classList.remove('show');
        showSuccessModal(agentName, 'whatsapp');
        return;
      }

      // Si el campo qr llegó vacío y ya teníamos QR mostrado → también es vinculación
      const qrField = data.qr_code || data.qr || data.qrCode || data.image || data.data;
      const hadQR = document.getElementById('qrTextArt') || (qrImage && qrImage.style.display !== 'none');
      if (qrField === '' && hadQR) {
        clearInterval(_qrPollTimer);
        qrModal.classList.remove('show');
        showSuccessModal(agentName, 'whatsapp');
        return;
      }

      // Extraer código QR de cualquier campo común
      const qrCode = qrField || '';

      if (qrCode) {
        qrSpinner.style.display = 'none';

        // Quitar prefijo data-URI si lo tiene, para inspeccionar el contenido crudo
        const DATA_PREFIX = 'data:image/png;base64,';
        const rawContent  = qrCode.startsWith(DATA_PREFIX)
          ? qrCode.slice(DATA_PREFIX.length)
          : qrCode;

        // ¿Es base64 real? Solo contiene [A-Za-z0-9+/=\r\n]
        const isRealBase64 = /^[A-Za-z0-9+\/=\r\n]+$/.test(rawContent.trim());

        if (isRealBase64) {
          // PNG real — mostrar como <img>
          qrImage.src = qrCode.startsWith('data:')
            ? qrCode
            : `data:image/png;base64,${qrCode}`;
          qrImage.style.display = 'block';
          const existingPre = document.getElementById('qrTextArt');
          if (existingPre) existingPre.style.display = 'none';
        } else {
          // Arte ASCII/Unicode — mostrar como <pre>
          qrImage.style.display = 'none';
          let pre = document.getElementById('qrTextArt');
          if (!pre) {
            pre = document.createElement('pre');
            pre.id = 'qrTextArt';
            pre.style.cssText = 'font-family:monospace;font-size:7px;line-height:1.1;letter-spacing:0;white-space:pre;color:#000;background:#fff;padding:10px;border-radius:8px;overflow:auto;max-width:100%;margin:0 auto;display:block;';
            qrImage.parentNode.insertBefore(pre, qrImage.nextSibling);
          }
          pre.textContent = rawContent;
          pre.style.display = 'block';
        }

        qrStatusDot.style.background = '#f59e0b';
        qrStatusText.textContent     = 'Esperando escaneo...';
      }

    } catch (err) {
      console.error('❌ Error al obtener QR:', err);
    }
  }

  // ── Poll QR cada 3 s ──────────────────────────────────────────────────────
  pollQR();
  _qrPollTimer = setInterval(pollQR, 3000);

  // ── Fallback: poll estado del agente cada 4 s ─────────────────────────────
  // Por si el endpoint /qr no refleja la vinculación en su respuesta
  let _done = false;
  const _agentStatusTimer = setInterval(async () => {
    if (_done) { clearInterval(_agentStatusTimer); return; }
    try {
      const r = await fetch(`/api/agents/${agentId}`, { credentials: 'include' });
      if (!r.ok) return;
      const d = await r.json();
      const ag = d.agent || d;
      const linked =
        ag.whatsapp_status === 'connected' || ag.whatsapp_status === 'logged_in' ||
        ag.status === 'connected'          || ag.status === 'active'              ||
        ag.is_connected === true           || ag.linked === true;
      if (linked) {
        _done = true;
        clearInterval(_agentStatusTimer);
        clearInterval(_qrPollTimer);
        qrModal.classList.remove('show');
        showSuccessModal(agentName, 'whatsapp');
      }
    } catch (_) {}
  }, 4000);
}

// ============================================
// SHOW SUCCESS MODAL
// ============================================
function showSuccessModal(agentName, platform) {
  const successModal = document.getElementById('successModal');
  if (!successModal) return;

  // Nombre
  const nameEl = document.getElementById('finalAgentName');
  if (nameEl) nameEl.textContent = agentName || 'Mi Agente';

  // Servidor: Compartido (AtomicBot) o Propio (OrbitalBot)
  const serverEl = document.getElementById('finalAgentServer');
  if (serverEl) {
    if (platform === 'whatsapp') {
      serverEl.textContent = 'Compartido';
    } else {
      serverEl.textContent = 'Propio';
    }
  }

  // Nota inferior según plataforma
  const noteEl = document.getElementById('successNoteText');
  if (noteEl) {
    if (platform === 'meta') {
      noteEl.textContent = 'Configura las credenciales de Meta WhatsApp API en Mis Agentes para comenzar a usar tu agente.';
    } else {
      noteEl.textContent = 'Tu dispositivo está vinculado. El agente ya puede responder mensajes de WhatsApp.';
    }
  }

  successModal.classList.add('show');
}

// ============================================
// UPLOAD PENDING SERVICE IMAGES
// Recorre todos los thumbs marcados como pending=true y los sube al servidor.
// Actualiza el thumb con la URL real y sincroniza el hidden input de cada servicio.
// ============================================
async function uploadPendingServiceImages() {
  const pendingThumbs = [...document.querySelectorAll('.service-img-thumb[data-pending="true"]')];
  if (!pendingThumbs.length) return;

  console.log(`📸 Subiendo ${pendingThumbs.length} imagen(es) pendiente(s)...`);

  const uploadBranchId = agentData.branchId || 0;

  for (const thumb of pendingThumbs) {
    const file = thumb._pendingFile;
    if (!file) { thumb.removeAttribute('data-pending'); continue; }

    try {
      const formData = new FormData();
      formData.append('image', file);

      const res = await fetch(`/api/upload/service-image?branch_id=${uploadBranchId}`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json();

      // Actualizar thumb con la URL real
      thumb.dataset.url = result.url;
      thumb.removeAttribute('data-pending');
      delete thumb._pendingFile;

      // Actualizar la imagen visible (reemplazar data-URL con URL real)
      const img = thumb.querySelector('img');
      if (img) img.src = result.url;

      console.log(`✅ Imagen subida: ${result.url}`);
    } catch (err) {
      console.error('❌ Error subiendo imagen pendiente:', err);
      // No bloquear la creación del agente; la imagen simplemente no se incluirá
      thumb.remove();
    }

    // Sincronizar el hidden input de su servicio
    const serviceItem = thumb.closest('.service-item');
    if (serviceItem) {
      const urlsInput = serviceItem.querySelector('.service-image-urls');
      if (urlsInput) {
        const urls = [...serviceItem.querySelectorAll('.service-img-thumb')]
          .filter(t => !t.dataset.pending && t.dataset.url)
          .map(t => t.dataset.url);
        urlsInput.value = urls.join(',');
      }
    }
  }

  // Refrescar agentData.config.services con las URLs ya subidas
  updateServicesData();
  console.log('✅ Todas las imágenes pendientes procesadas');
}

// ============================================
// CREATE AGENT
// ============================================
async function createAgent() {
  console.log('🚀 Iniciando creación de agente...');
  
  // Cerrar el modal del onboarding si existe (cuando se abre desde el dashboard)
  const onboardingModal = document.getElementById('onboardingModal');
  if (onboardingModal && typeof closeOnboardingModal === 'function') {
    console.log('🔒 Cerrando modal del onboarding...');
    closeOnboardingModal();
  }
  
  // Asegurar que los modales existen
  ensureModalsExist();
  
  const creatingModal = document.getElementById('creatingModal');
  if (!creatingModal) {
    console.error('❌ Modal de creación no encontrado');
    alert('Error: No se pudo mostrar el modal de creación');
    return;
  }
  
  console.log('✅ Mostrando modal de creación...');
  creatingModal.classList.add('show');
  
  let elapsedSeconds = 0;
  const maxSeconds = 1200;
  
  const timerInterval = setInterval(() => {
    elapsedSeconds++;
    updateTimer(elapsedSeconds, maxSeconds);
  }, 1000);

  try {
    console.log('📤 Enviando petición de creación de agente...');
    console.log('Datos del agente:', {
      name: agentData.name,
      phoneNumber: agentData.phoneNumber,
      businessType: agentData.businessType
    });

    // ── Subir imágenes pendientes ANTES de crear el agente ──────────────────
    await uploadPendingServiceImages();
    // ────────────────────────────────────────────────────────────────────────

    const response = await fetch('/api/agents', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        name: agentData.name,
        phoneNumber: agentData.phoneNumber,
        businessType: agentData.businessType,
        branchId: agentData.branchId,
        menuUrl: agentData.menuUrl || '',
        metaDocument: '',
        social: agentData.social || '',
        config: agentData.config
      }),
    });

    const data = await response.json();
    console.log('📥 Respuesta recibida:', data);

    if (response.status === 202) {
      const agentId = data.agent.id;
      console.log('✅ Agente creado con ID:', agentId);
      
      const agentNameDisplay = document.getElementById('agentNameDisplay');
      if (agentNameDisplay) {
        agentNameDisplay.textContent = data.agent.name;
      }
      
      const checkInterval = setInterval(async () => {
        try {
          console.log('🔍 Verificando estado del agente...');
          const statusResp = await fetch(`/api/agents/${agentId}`, {
            credentials: 'include'
          });
          
          if (!statusResp.ok) {
            console.error('❌ Error al verificar estado:', statusResp.status);
            return;
          }
          
          const statusData = await statusResp.json();
          console.log('📊 Estado actual:', statusData.agent.deployStatus);
          
          updateCreationStatus(statusData.agent.deployStatus);
          
          if (statusData.agent.deployStatus === 'running') {
            console.log('🎉 ¡Agente completado exitosamente!');
            clearInterval(checkInterval);
            clearInterval(timerInterval);
            
            creatingModal.classList.remove('show');

            const platform = (agentData.social || '').toLowerCase(); // 'whatsapp' | 'meta' | 'telegram'

            if (platform === 'whatsapp') {
              // ── Flujo 1: AtomicBot ─ mostrar QR para vincular WhatsApp ──────
              console.log('📱 Plataforma AtomicBot – iniciando flujo QR');
              startQRPolling(agentId, statusData.agent.name);
            } else if (platform === 'telegram') {
              // ── Flujo 3: TelegramBot ─ éxito directo (no requiere QR) ──────
              console.log('✈️ Plataforma TelegramBot – mostrando éxito directo');
              showSuccessModal(statusData.agent.name, 'telegram');
            } else {
              // ── Flujo 2: OrbitalBot ─ mostrar pantalla de éxito directo ────
              console.log('🚀 Plataforma OrbitalBot – mostrando éxito directo');
              showSuccessModal(statusData.agent.name, platform);
            }
            
          } else if (statusData.agent.deployStatus === 'error') {
            console.error('❌ Error en el despliegue del agente');
            clearInterval(checkInterval);
            clearInterval(timerInterval);
            
            creatingModal.classList.remove('show');
            alert('Error al crear el agente. Por favor contacta a soporte.');
          }
        } catch (error) {
          console.error('❌ Error verificando estado:', error);
        }
      }, 5000);
      
    } else {
      clearInterval(timerInterval);
      throw new Error(data.error || 'Error al crear agente');
    }
    
  } catch (error) {
    clearInterval(timerInterval);
    console.error('❌ Error:', error);
    creatingModal.classList.remove('show');
    alert('Error al crear el agente. Por favor intenta de nuevo.');
  }
}

function updateTimer(elapsed, max) {
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const percentage = (elapsed / max) * 100;
  
  const timeElapsedEl = document.getElementById('timeElapsed');
  if (timeElapsedEl) {
    timeElapsedEl.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }
  
  const estimatedMinutes = Math.floor((max - elapsed) / 60);
  const estimatedSeconds = (max - elapsed) % 60;
  const timeRemainingEl = document.getElementById('timeRemaining');
  if (timeRemainingEl) {
    timeRemainingEl.textContent = `~${estimatedMinutes}:${estimatedSeconds.toString().padStart(2, '0')}`;
  }
  
  const progressBar = document.getElementById('creationProgressBar');
  if (progressBar) {
    progressBar.style.width = Math.min(percentage, 100) + '%';
  }
}

function updateCreationStatus(status) {
  const statusMessages = {
    'pending': {
      text: 'Preparando creación...',
      icon: 'lni-hourglass',
      step: 0
    },
    'creating': {
      text: 'Creando infraestructura...',
      icon: 'lni-apartment',
      step: 1
    },
    'provisioning': {
      text: 'Inicializando sistema operativo...',
      icon: 'lni-cog',
      step: 2
    },
    'initializing': {
      text: 'Instalando dependencias...',
      icon: 'lni-package',
      step: 2
    },
    'deploying': {
      text: 'Desplegando y configurando bot...',
      icon: 'lni-bot',
      step: 3
    },
    'running': {
      text: '¡Agente listo y funcionando!',
      icon: 'lni-checkmark-circle',
      step: 4
    },
    'error': {
      text: 'Error en la creación',
      icon: 'lni-cross-circle',
      step: 0
    }
  };
  
  const statusInfo = statusMessages[status] || statusMessages['pending'];
  
  const statusTextEl = document.getElementById('currentStatusText');
  if (statusTextEl) {
    statusTextEl.textContent = statusInfo.text;
  }
  
  const iconElement = document.getElementById('currentStatusIcon');
  if (iconElement) {
    iconElement.className = `lni ${statusInfo.icon} status-icon`;
  }
  
  updateStatusSteps(statusInfo.step);
}

function updateStatusSteps(currentStep) {
  const steps = [
    { icon: 'lni-apartment', text: 'Creando infraestructura' },
    { icon: 'lni-cog', text: 'Inicializando sistema' },
    { icon: 'lni-bot', text: 'Desplegando bot' },
    { icon: 'lni-checkmark', text: 'Completado' }
  ];
  
  const container = document.getElementById('statusStepsContainer');
  if (!container) return;
  
  container.innerHTML = '';
  
  steps.forEach((step, index) => {
    const stepDiv = document.createElement('div');
    stepDiv.className = 'status-step';
    
    if (index + 1 < currentStep) {
      stepDiv.classList.add('completed');
    } else if (index + 1 === currentStep) {
      stepDiv.classList.add('active');
    }
    
    stepDiv.innerHTML = `
      <div class="status-step-indicator"></div>
      <div class="status-step-text"><i class="${step.icon}"></i> ${step.text}</div>
    `;
    
    container.appendChild(stepDiv);
  });
}

// ============================================
// SECCIÓN MENÚ
// ============================================
function initializeMenu() {
  const area        = document.getElementById('ob-menuUploadArea');
  const fileInput   = document.getElementById('ob-menuFileInput');
  const placeholder = document.getElementById('ob-menuUploadPlaceholder');
  const btnRemove   = document.getElementById('ob-btnRemoveMenu');
  if (!area || !fileInput) return;

  placeholder?.addEventListener('click', () => fileInput.click());

  area.addEventListener('dragover', e => {
    e.preventDefault();
    area.classList.add('menu-drag-over');
  });
  area.addEventListener('dragleave', () => area.classList.remove('menu-drag-over'));
  area.addEventListener('drop', e => {
    e.preventDefault();
    area.classList.remove('menu-drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleMenuFileOnboarding(file);
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) handleMenuFileOnboarding(fileInput.files[0]);
  });

  btnRemove?.addEventListener('click', () => {
    document.getElementById('ob-menuUrlInput').value = '';
    document.getElementById('ob-menuFilePreview').style.display = 'none';
    document.getElementById('ob-menuUploadPlaceholder').style.display = '';
    const v = document.getElementById('ob-menuFileViewer');
    if (v) { v.style.display = 'none'; v.innerHTML = ''; }
    fileInput.value = '';
    agentData.menuUrl = '';
  });
}

async function handleMenuFileOnboarding(file) {
  const maxMB = 10;
  if (file.size > maxMB * 1024 * 1024) {
    Sileo?.toast(`El archivo supera ${maxMB}MB`, 'error');
    return;
  }

  const isPdf = file.type === 'application/pdf';
  document.getElementById('ob-menuFileIcon').className = isPdf ? 'lni lni-files' : 'lni lni-image';
  document.getElementById('ob-menuFileName').textContent = file.name;
  document.getElementById('ob-menuFileSize').textContent = (file.size / 1024).toFixed(0) + ' KB';
  document.getElementById('ob-menuUploadPlaceholder').style.display = 'none';
  document.getElementById('ob-menuFilePreview').style.display = '';
  document.getElementById('ob-menuUploadProgress').style.display = '';
  document.getElementById('ob-menuProgressBar').style.width = '0%';

  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', isPdf ? 'pdf' : 'image');

    let progress = 0;
    const interval = setInterval(() => {
      progress = Math.min(progress + 10, 85);
      document.getElementById('ob-menuProgressBar').style.width = progress + '%';
    }, 150);

    const branchId = agentData.branchId || 0;
    const resp = await fetch(`/api/upload/menu?branch_id=${branchId}`, {
      method: 'POST',
      credentials: 'include',
      body: formData
    });

    clearInterval(interval);
    if (!resp.ok) throw new Error('Error al subir el menú');

    const data = await resp.json();
    const url = data.url || data.menuUrl || '';

    document.getElementById('ob-menuProgressBar').style.width = '100%';
    document.getElementById('ob-menuUrlInput').value = url;
    agentData.menuUrl = url;

    setTimeout(() => {
      document.getElementById('ob-menuUploadProgress').style.display = 'none';
      _renderMenuViewerOnboarding(url);
    }, 500);

    Sileo?.toast('Menú subido correctamente', 'success');
  } catch (err) {
    console.error('❌ Error subiendo menú:', err);
    document.getElementById('ob-menuUploadProgress').style.display = 'none';
    document.getElementById('ob-menuFilePreview').style.display = 'none';
    document.getElementById('ob-menuUploadPlaceholder').style.display = '';
    Sileo?.toast('Error al subir el menú', 'error');
  }
}

function _renderMenuViewerOnboarding(url) {
  const viewer = document.getElementById('ob-menuFileViewer');
  if (!viewer || !url) return;
  const isPdf = url.toLowerCase().endsWith('.pdf');
  viewer.style.display = 'block';
  if (isPdf) {
    viewer.innerHTML = `<iframe src="${url}" title="Vista previa del menú" style="width:100%;height:300px;border:none;border-radius:8px;"></iframe>`;
  } else {
    viewer.innerHTML = `<img src="${url}" alt="Vista previa del menú" style="max-width:100%;border-radius:8px;margin-top:0.75rem;">`;
  }
}