// ============================================
// CUSTOM TIME PICKER - 3 COLUMNAS (Hora | Minuto | AM/PM)
// Igual que el picker nativo de iOS/Android
// ============================================

console.log('🎨 Inicializando Custom Pickers (3 columnas)...');

// ============================================
// 1. TIME PICKER - HORARIOS DEL NEGOCIO
// ============================================

function initBusinessTimePickers() {
  console.log('🕐 Inicializando Time Pickers del negocio (3 columnas)...');
  
  const timeInputs = document.querySelectorAll('.time-input');
  
  timeInputs.forEach(input => {
    const parent = input.closest('.schedule-day');
    if (parent) {
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
  customInput.id = nativeInput.id + '_custom';
  
  if (nativeInput.disabled) {
    customInput.disabled = true;
    wrapper.classList.add('disabled');
  }
  
  const arrow = document.createElement('i');
  arrow.className = 'lni lni-chevron-down time-arrow';
  
  const dropdown = document.createElement('div');
  dropdown.className = 'time-dropdown';
  
  // Crear el picker de 3 columnas
  const columnsContainer = document.createElement('div');
  columnsContainer.className = 'time-picker-columns';
  
  // Parsear tiempo inicial
  const initialTime = parseTime(nativeInput.value || '09:00');
  
  // Columna 1: Horas (01-12)
  const hoursColumn = createTimeColumn('Hora', generateHours(), initialTime.hour);
  
  // Columna 2: Minutos (00, 30)
  const minutesColumn = createTimeColumn('Min', generateMinutes(), initialTime.minute);
  
  // Columna 3: AM/PM
  const periodColumn = createTimeColumn('', ['AM', 'PM'], initialTime.period);
  
  columnsContainer.appendChild(hoursColumn);
  columnsContainer.appendChild(minutesColumn);
  columnsContainer.appendChild(periodColumn);
  
  // Footer con botones
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
  
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && wrapper.classList.contains('active')) {
      closeBusinessDropdown(wrapper);
    }
  });
  
  wrapper.appendChild(customInput);
  wrapper.appendChild(arrow);
  wrapper.appendChild(dropdown);
  
  nativeInput.parentNode.insertBefore(wrapper, nativeInput);
  nativeInput.style.display = 'none';
  nativeInput.dataset.useCustom = 'true';
  
  // Observar cambios en disabled
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
      // Scroll to selected option after a brief delay
      setTimeout(() => {
        optionElement.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, 50);
    }
    
    optionElement.addEventListener('click', (e) => {
      e.stopPropagation();
      // Deseleccionar todos en esta columna
      column.querySelectorAll('.time-column-option').forEach(opt => {
        opt.classList.remove('selected');
      });
      // Seleccionar este
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
  
  // Animar opciones
  const options = wrapper.querySelectorAll('.time-column-option');
  options.forEach(option => {
    option.style.animation = 'none';
    setTimeout(() => {
      option.style.animation = '';
    }, 10);
  });
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
  
  // Convertir a 24h
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
  
  console.log(`⏰ Hora seleccionada: ${timeDisplay} (${time24})`);
}

// ============================================
// 2. DATE PICKER - DÍAS FESTIVOS
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
    
    // Días del mes anterior
    for (let i = firstDay - 1; i >= 0; i--) {
      const day = document.createElement('div');
      day.className = 'date-picker-day other-month';
      day.textContent = daysInPrevMonth - i;
      days.appendChild(day);
    }
    
    // Días del mes actual
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
    
    // Días del mes siguiente
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
  
  console.log(`📅 Fecha seleccionada: ${customInput.value}`);
}

function formatDisplayDate(dateString) {
  if (!dateString) return '';
  
  const date = new Date(dateString + 'T00:00:00');
  const day = date.getDate();
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  
  const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 
                      'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  
  return `${day} ${monthNames[date.getMonth()]} ${year}`;
}

// ============================================
// 3. WORKER TIME PICKER - 3 Columnas
// ============================================

function initWorkerTimePickers() {
  console.log('👷 Inicializando Time Pickers de trabajadores (3 columnas)...');
  
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
  
  // Crear el picker de 3 columnas (reutilizamos las mismas clases)
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
  
  const options = wrapper.querySelectorAll('.time-column-option');
  options.forEach(option => {
    option.style.animation = 'none';
    setTimeout(() => {
      option.style.animation = '';
    }, 10);
  });
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
  
  // Convertir a 24h
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
  
  console.log(`👷 Hora de trabajador: ${timeDisplay} (${time24})`);
}

// ============================================
// INICIALIZACIÓN
// ============================================

function initAllCustomPickers() {
  initBusinessTimePickers();
  initHolidayDatePickers();
  initWorkerTimePickers();
  
  console.log('✅ Todos los custom pickers (3 columnas) inicializados');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAllCustomPickers);
} else {
  setTimeout(initAllCustomPickers, 100);
}