// My Agents Page functionality

function getLang() {
    return localStorage.getItem('attomos_lang') || localStorage.getItem('lang') || 'es';
}
function t(key, fallback) {
    return window.Translations?.dict?.[getLang()]?.[key] || fallback;
}

let agents = [];

// Re-renderiza la tabla (con dropdowns traducidos) cuando cambia el idioma,
// usando los agentes ya cargados en memoria — sin esto, las filas y menús
// se quedan "pegados" en el idioma que estaba activo quando se cargó la
// página, porque createAgentRow() solo corre al hacer fetch, no en cada
// cambio de idioma.
document.addEventListener('attomos:langchange', function () {
    if (agents.length) renderAgentsTable(agents);
});

// Inicializar página
document.addEventListener('DOMContentLoaded', function () {
    console.log('🚀 My Agents JS cargado');
    loadAgents();
    initializeDropdowns();
    initializeCreateAgentButton();

    // ¿Venimos de "Editar" en agent-details.html? (/my-agents?editAgent=123)
    const params = new URLSearchParams(window.location.search);
    const editId = params.get('editAgent');
    if (editId) {
        openOnboardingModalForEdit(editId);
        // Limpiar el query param para que un refresh no vuelva a abrir el modal
        history.replaceState(null, '', window.location.pathname);
    }
});

// Abre el modal de onboarding en modo edición para un agente existente.
// Reutiliza toda la infraestructura de openOnboardingModal() (crea el modal,
// carga onboarding.html/css/js); reinitializeOnboardingEvents() detecta el
// flag _pendingEditAgentId y precarga el agente en el momento correcto
// (después de inicializar todas las secciones, para no pisar nada).
function openOnboardingModalForEdit(agentId) {
    document.querySelectorAll('.actions-dropdown').forEach(d => d.classList.remove('show'));
    window._pendingEditAgentId = agentId;
    openOnboardingModal();
}

// Inicializar botón de crear agente (onclick en HTML)
function initializeCreateAgentButton() {
    // no-op: los botones usan onclick="openOnboardingModal()" directo
}

// Abrir modal de onboarding
function openOnboardingModal() {
    // Si quedó un editingAgentId de una edición anterior sin guardar (ej. el
    // usuario cerró el modal sin terminar), lo limpiamos para que "Crear
    // Agente" no termine editando por accidente el agente anterior.
    if (typeof window.agentData !== 'undefined' && window.agentData) {
        window.agentData.editingAgentId = null;
    }
    window.editingAgentId = null;
    const existingTitle = document.querySelector('.onboarding-modal-title span');
    if (existingTitle) existingTitle.textContent = t('agents_create_modal_title', 'Crear Nuevo Agente');
    const existingNotice = document.getElementById('editPlatformNotice');
    if (existingNotice) existingNotice.remove();

    // Crear modal si no existe
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
                        <span data-translate="agents_create_modal_title">Crear Nuevo Agente</span>
                    </h2>
                    <button class="btn-close-onboarding" onclick="closeOnboardingModal()">
                        <i class="lni lni-close"></i>
                    </button>
                </div>
                <div class="onboarding-modal-body" id="onboardingModalBody">
                    <div style="display: flex; justify-content: center; align-items: center; padding: 3rem;">
                        <div class="loading-spinner"></div>
                        <div class="loading-text" style="margin-left: 1rem;" data-translate="loading">Cargando...</div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    // Mostrar modal
    modal.classList.add('active');

    // Cargar contenido del onboarding
    loadOnboardingContent();
}

// Cerrar modal de onboarding
function closeOnboardingModal() {
    const modal = document.getElementById('onboardingModal');
    if (modal) {
        modal.classList.remove('active');
        // Recargar agentes al cerrar
        setTimeout(() => {
            loadAgents();
        }, 300);
    }
}

// ============================================
// MOSTRAR AUTOMÁTICAMENTE EL QR DE AGENTES WHATSAPP SIN VINCULAR
// Ya no depende de localStorage: el backend persiste `whatsappConnected` en
// el agente (ver /api/agents/:id/qr en agent.go). Cada vez que se carga la
// tabla de Mis Agentes — desde cualquier navegador o dispositivo — si hay un
// agente WhatsApp que ya terminó de desplegar pero todavía no está
// vinculado, se le muestra el modal del QR automáticamente.
// ============================================
const _whatsappModalShownFor = new Set(); // evita reabrir el mismo agente varias veces en la misma sesión de pestaña

function ensureOnboardingScriptLoaded() {
    return new Promise((resolve) => {
        if (_onboardingScriptLoaded || typeof window.watchAgentDeployment === 'function') {
            resolve();
            return;
        }
        const script = document.createElement('script');
        script.src = '/static/js/onboarding.js?v=' + Date.now();
        script.onload = () => { _onboardingScriptLoaded = true; resolve(); };
        script.onerror = () => resolve(); // no bloquear el resto de la página si falla
        document.body.appendChild(script);
    });
}

async function checkUnlinkedWhatsAppAgents(agentsList) {
    if (!Array.isArray(agentsList) || !agentsList.length) return;

    const pending = agentsList.find(a =>
        a.botType === 'atomic' &&
        a.deployStatus === 'running' &&
        a.isActive &&
        !a.whatsappConnected &&
        !_whatsappModalShownFor.has(a.id)
    );
    if (!pending) return;

    _whatsappModalShownFor.add(pending.id);

    await ensureOnboardingScriptLoaded();
    if (typeof window.ensureModalsExist !== 'function' || typeof window.startQRPolling !== 'function') return;

    console.log('📱 Agente WhatsApp sin vincular detectado — mostrando QR:', pending.id);
    window.ensureModalsExist();
    window.startQRPolling(pending.id, pending.name);
}

// Cargar contenido del onboarding (con caché)
let _onboardingHTMLCache = null;
let _onboardingScriptLoaded = false;

async function loadOnboardingContent() {
    const modalBody = document.getElementById('onboardingModalBody');
    if (!modalBody) return;

    try {
        let rawHtml;
        if (_onboardingHTMLCache) {
            rawHtml = _onboardingHTMLCache;
        } else {
            const response = await fetch('/onboarding', { credentials: 'include' });
            if (!response.ok) throw new Error('Error al cargar onboarding');
            rawHtml = await response.text();
            _onboardingHTMLCache = rawHtml;
        }

        const parser = new DOMParser();
        const doc = parser.parseFromString(rawHtml, 'text/html');
        const mainContainer = doc.querySelector('.main-container');

        if (mainContainer) {
            modalBody.innerHTML = mainContainer.innerHTML;
            // Re-apply translations to the newly injected onboarding content
            if (window.Translations) window.Translations.apply(getLang());
            if (window.renderLangFlags) window.renderLangFlags();

            if (!document.getElementById('onboarding-css')) {
                const link = document.createElement('link');
                link.id = 'onboarding-css'; link.rel = 'stylesheet';
                link.href = '/static/css/onboarding.css';
                document.head.appendChild(link);
            }
            if (!document.getElementById('onboarding-modal-fixes')) {
                const fix = document.createElement('style');
                fix.id = 'onboarding-modal-fixes';
                fix.textContent = `
                    .section-nav-btn.completed:hover {
                        background:#d1fae5!important;color:#10b981!important;
                        border-color:#10b981!important;
                        box-shadow:0 4px 12px rgba(16,185,129,.2)!important;
                    }
                    .section-nav-btn.completed:hover i{color:#10b981!important;}
                    #onboardingModalBody .progress-wrapper,
                    #onboardingModalBody .progress-header,
                    #onboardingModalBody #progressPercentage,
                    #onboardingModalBody .progress-dots{display:none!important;}
                    .onboarding-modal-header{display:flex!important;align-items:center!important;justify-content:space-between!important;padding:1rem 1.5rem!important;border-bottom:1px solid #eef2f7!important;position:sticky!important;top:0!important;background:white!important;z-index:10!important;flex-direction:row!important;}
                    .onboarding-modal-title{display:inline-flex!important;align-items:center!important;gap:0.6rem!important;font-weight:800!important;font-size:1.1rem!important;color:#0f172a!important;margin:0!important;flex:1!important;}
                    .btn-close-onboarding{width:40px!important;height:40px!important;border-radius:50%!important;border:none!important;background:#f3f4f6!important;color:#6b7280!important;cursor:pointer!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;font-size:1.1rem!important;flex-shrink:0!important;transition:all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)!important;}
                    .btn-close-onboarding:hover{background:#fee2e2!important;color:#ef4444!important;transform:rotate(90deg) scale(1.1)!important;box-shadow:0 4px 12px rgba(239, 68, 68, 0.2)!important;}
                    .btn-close-onboarding i{transition:all 0.3s ease!important;}
                    .btn-close-onboarding:hover i{transform:scale(1.2)!important;}
                    #onboardingModalBody .main-container,#onboardingModalBody .onboarding-container{padding-top:0!important;margin-top:0!important;}
                    #onboardingModalBody .step2-header,#onboardingModalBody .step-header{padding-top:1rem!important;}
                    .readonly-notice{display:flex;align-items:center;gap:8px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 14px;font-size:0.82rem;color:#15803d;margin-bottom:16px;}
                    .readonly-notice i{font-size:1rem;flex-shrink:0;}
                    .readonly-notice a{color:#0891b2;text-decoration:underline;}
    .platform-badge.telegram {
        background: rgba(34, 158, 217, 0.1);
        color: #229ED9;
        border: 1px solid rgba(34, 158, 217, 0.2);
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px 8px;
        border-radius: 6px;
        font-size: 0.78rem;
        font-weight: 600;
    }

                    .form-input[readonly]:not(.form-select){background:#f8fafc;color:#64748b;cursor:not-allowed;border-color:#e2e8f0;}

                    /* Scrollbar delgado color cian, consistente con el resto de la app */
                    #onboardingModal, #onboardingModalBody, .onboarding-modal-content {
                        scrollbar-width: thin;
                        scrollbar-color: #06b6d4 transparent;
                    }
                    #onboardingModal::-webkit-scrollbar,
                    #onboardingModalBody::-webkit-scrollbar,
                    .onboarding-modal-content::-webkit-scrollbar {
                        width: 6px;
                    }
                    #onboardingModal::-webkit-scrollbar-track,
                    #onboardingModalBody::-webkit-scrollbar-track,
                    .onboarding-modal-content::-webkit-scrollbar-track {
                        background: transparent;
                    }
                    #onboardingModal::-webkit-scrollbar-thumb,
                    #onboardingModalBody::-webkit-scrollbar-thumb,
                    .onboarding-modal-content::-webkit-scrollbar-thumb {
                        background-color: #06b6d4;
                        border-radius: 999px;
                    }
                    #onboardingModal::-webkit-scrollbar-thumb:hover,
                    #onboardingModalBody::-webkit-scrollbar-thumb:hover,
                    .onboarding-modal-content::-webkit-scrollbar-thumb:hover {
                        background-color: #0891b2;
                    }
                `;
                document.head.appendChild(fix);
            }

            if (!_onboardingScriptLoaded) {
                const script = document.createElement('script');
                script.src = '/static/js/onboarding.js?v=' + Date.now();
                script.onload = () => {
                    _onboardingScriptLoaded = true;
                    // Re-apply translations after onboarding script loaded
                    if (window.Translations) window.Translations.apply(getLang());
            if (window.renderLangFlags) window.renderLangFlags();
                    // ── Validar nombre antes de crear (evita POST con name:"") ──
                    setTimeout(() => {
                        var _origCreateAgent = window.createAgent;
                        window.createAgent = function() {
                            if (typeof collectFormData === 'function') collectFormData();
                            var nombre = ((window.agentData && window.agentData.name) ? window.agentData.name : '').trim();
                            if (!nombre) {
                                var inp = document.getElementById('agentName');
                                if (inp) nombre = inp.value.trim();
                            }
                            if (!nombre) {
                                alert('Por favor ingresa el nombre del agente en la sección "Info. Básica".');
                                if (typeof window._modalGoToSection === 'function') window._modalGoToSection('section-basic');
                                return;
                            }
                            if (window.agentData) window.agentData.name = nombre;
                            console.log('[my-agents] createAgent validado — nombre:', nombre);
                            if (typeof _origCreateAgent === 'function') _origCreateAgent();
                        };
                    }, 100);
                    setTimeout(() => reinitializeOnboardingEvents(), 50);
                };
                document.body.appendChild(script);
            } else {
                if (window.Translations) window.Translations.apply(getLang());
            if (window.renderLangFlags) window.renderLangFlags();
                setTimeout(() => {
                    var _origCA = window.createAgent;
                    window.createAgent = function() {
                        if (typeof collectFormData === 'function') collectFormData();
                        var nombre = ((window.agentData && window.agentData.name) ? window.agentData.name : '').trim();
                        if (!nombre) { var inp = document.getElementById('agentName'); if (inp) nombre = inp.value.trim(); }
                        if (!nombre) {
                            alert('Por favor ingresa el nombre del agente en la sección "Info. Básica".');
                            if (typeof window._modalGoToSection === 'function') window._modalGoToSection('section-basic');
                            return;
                        }
                        if (window.agentData) window.agentData.name = nombre;
                        if (typeof _origCA === 'function') _origCA();
                    };
                }, 100);
                setTimeout(() => reinitializeOnboardingEvents(), 20);
            }
        } else {
            throw new Error('No se encontró .main-container');
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

// Reinicializar eventos del onboarding en el modal
async function reinitializeOnboardingEvents() {
    console.log('🔄 Reinicializando modal del agente (my-agents)');

    // ¿Se abrió este modal para editar un agente existente? (ver openOnboardingModalForEdit)
    const _editingAgentId = window._pendingEditAgentId || null;
    window._pendingEditAgentId = null;

    if (!_editingAgentId) {
        if (typeof agentData !== 'undefined') { agentData.social=''; agentData.name=''; agentData.phoneNumber=''; agentData.config={tone:'formal',customTone:'',languages:[],additionalLanguages:[],specialInstructions:'',schedule:{monday:{open:true,start:'09:00',end:'18:00'},tuesday:{open:true,start:'09:00',end:'18:00'},wednesday:{open:true,start:'09:00',end:'18:00'},thursday:{open:true,start:'09:00',end:'18:00'},friday:{open:true,start:'09:00',end:'18:00'},saturday:{open:false,start:'09:00',end:'14:00'},sunday:{open:false,start:'09:00',end:'14:00'}}}; }
        // Resetear radio buttons de plataforma para que el usuario deba elegir de nuevo
        document.querySelectorAll('input[name="social"]').forEach(r => r.checked = false);
        const btnStep1 = document.getElementById('btnStep1'); if (btnStep1) btnStep1.disabled = true;
    }
    if (typeof window.currentSection !== 'undefined') window.currentSection = 1;

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

    document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
    const step1 = document.getElementById('step1');
    const step2 = document.getElementById('step2');
    if (_editingAgentId) {
        // Modo edición: no existe el paso 1 (la plataforma ya está definida)
        if (step1) { step1.classList.remove('active'); step1.style.display = 'none'; }
        if (step2) { step2.classList.add('active'); step2.style.display = ''; }
    } else {
        // Mostrar step1 (selección de red social) primero
        if (step1) { step1.classList.add('active'); step1.style.display = ''; }
        if (step2) { step2.classList.remove('active'); step2.style.display = 'none'; }
    }
    // Ocultar nav de secciones hasta que se complete step1
    const sectionNavEl = document.getElementById('sectionNavigation');
    if (sectionNavEl) sectionNavEl.style.display = _editingAgentId ? '' : 'none';

    // ── Habilitar Continuar al seleccionar red social (SINCRÓNICO, antes de cualquier await) ──
    (function setupSocialSelectionEarly() {
        function _enableContinuarEarly(value) {
            try { window.selectedSocial = value; } catch(e) {}
            try { window.agentData = window.agentData || {}; window.agentData.social = value; } catch(e) {}
            var btn = document.getElementById('btnStep1');
            if (btn) { btn.disabled = false; btn.removeAttribute('disabled'); }
        }
        document.querySelectorAll('input[name="social"]').forEach(function(radio) {
            radio.addEventListener('change', function() { _enableContinuarEarly(this.value); });
        });
        document.querySelectorAll('.social-card').forEach(function(label) {
            label.addEventListener('click', function() {
                var radio = label.querySelector('input[type="radio"]');
                if (radio && !radio.disabled) {
                    setTimeout(function() { _enableContinuarEarly(radio.value); }, 10);
                }
            });
        });
    })();

    const AGENT_SECTIONS_BUSINESS = [
        { id:1, containerId:'section-business',    name:() => t('onb_tab_business','Info. Negocio'),   icon:'lni-briefcase' },
        { id:2, containerId:'section-basic',       name:() => t('onb_tab_basic','Info. Básica'),    icon:'lni-information' },
        { id:5, containerId:'section-personality', name:() => t('onb_tab_personality','Personalidad'),    icon:'lni-comments' },
        { id:6, containerId:'section-schedule',    name:() => t('onb_tab_schedule','Horarios'),        icon:'lni-calendar' },
        { id:7, containerId:'section-holidays',    name:() => t('onb_tab_holidays','Días Festivos'),   icon:'lni-gift' },
        { id:8, containerId:'section-services',    name:() => t('onb_tab_services','Servicios / Productos'),       icon:'lni-package' },
        { id:9, containerId:'section-menu',        name:() => t('onb_sec_menu','Menú'),            icon:'lni-files' },
        { id:10,containerId:'section-workers',     name:() => t('onb_tab_workers','Trabajadores'),    icon:'lni-users' },
    ];
    const AGENT_SECTIONS_GOV = [
        { id:1, containerId:'section-business',    name:() => t('onb_tab_agency','Dependencia'),     icon:'lni-government' },
        { id:2, containerId:'section-basic',       name:() => t('onb_tab_basic','Info. Básica'),    icon:'lni-information' },
        { id:3, containerId:'section-location',    name:() => t('onb_tab_location','Ubicación'),       icon:'lni-map-marker' },
        { id:4, containerId:'section-social',      name:() => t('onb_tab_social','Redes Sociales'),  icon:'lni-share-alt' },
        { id:5, containerId:'section-personality', name:() => t('onb_tab_personality','Personalidad'),    icon:'lni-comments' },
        { id:6, containerId:'section-schedule',    name:() => t('onb_tab_schedule','Horarios'),        icon:'lni-calendar' },
        { id:7, containerId:'section-holidays',    name:() => t('onb_tab_holidays_gov','Días Inhábiles'),  icon:'lni-gift' },
        { id:8, containerId:'section-services',    name:() => t('onb_tab_courses','Cursos'),          icon:'lni-graduation' },
    ];

    // Detectar modo gobierno
    let _isGovModal = false;
    try {
        const _meCheck = await fetch('/api/me', { credentials: 'include' });
        if (_meCheck.ok) {
            const _meCheckData = await _meCheck.json();
            _isGovModal = (_meCheckData.user?.businessType || '').toLowerCase().includes('gubernamental') ||
                          !!_meCheckData.user?.isGovernment ||
                          _meCheckData.user?.userType === 'government';
        }
    } catch (_) {}

    // Ocultar secciones que no aplican según modo
    if (_isGovModal) {
        const menuSec    = document.getElementById('section-menu');
        const workersSec = document.getElementById('section-workers');
        if (menuSec)    menuSec.style.display    = 'none';
        if (workersSec) workersSec.style.display = 'none';
    } else {
        ['section-location','section-social'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.classList.remove('active'); el.style.display = 'none'; }
        });
    }

    let AGENT_SECTIONS = _isGovModal ? AGENT_SECTIONS_GOV : AGENT_SECTIONS_BUSINESS;
    const AGENT_IDS = AGENT_SECTIONS.map(s => s.containerId);

    if (typeof initializeRichEditor==='function') initializeRichEditor();
    if (typeof initializePhoneToggle==='function') initializePhoneToggle();
    if (typeof initializeSchedule==='function') initializeSchedule();
    if (typeof initializeHolidays==='function') initializeHolidays();
    if (typeof initializeServices==='function') initializeServices();
    if (typeof initializeWorkers==='function') initializeWorkers();
    if (typeof initializeMenu==='function') initializeMenu();
    if (typeof initializeLocationDropdowns==='function') initializeLocationDropdowns();
    if (typeof initializeSocialMediaInputs==='function') initializeSocialMediaInputs();
    if (typeof initializeBusinessTypeSelect==='function') initializeBusinessTypeSelect();
    if (typeof initializeToneSelection==='function') initializeToneSelection();
    if (typeof initializeLanguageSelection==='function') initializeLanguageSelection();
    setTimeout(() => {
        if (!_editingAgentId) {
            if (typeof fetchUserData==='function') fetchUserData();
        }
        if (typeof initBusinessTimePickers==='function') initBusinessTimePickers();
        if (typeof initHolidayDatePickers==='function') initHolidayDatePickers();
        if (typeof initWorkerTimePickers==='function') initWorkerTimePickers();
        // Cargar bizType para negocios normales
        if (!_isGovModal && !_editingAgentId) {
            (async () => {
                try {
                    let bizType = '';
                    const meResp = await fetch('/api/me', { credentials: 'include' });
                    if (meResp.ok) {
                        const meData = await meResp.json();
                        bizType = (meData.user?.businessType || '').toLowerCase();
                    }
                    const bizResp = await fetch('/api/my-business', { credentials: 'include' });
                    if (bizResp.ok) {
                        const bizData = await bizResp.json();
                        const branch = bizData.activeBranch || bizData.defaultBranch;
                        const branchType = (branch?.business?.type || branch?.business?.typeName || '').toLowerCase();
                        if (branchType) bizType = branchType;
                    }
                    if (bizType) {
                        if (window.agentData) window.agentData.businessType = bizType;
                        if (typeof updateSectionLabels === 'function') updateSectionLabels(bizType);
                    }
                } catch (_) {}
            })();
        }
    }, 100);

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
            btn.innerHTML = `<i class="lni ${sec.icon}"></i><span>${typeof sec.name === "function" ? sec.name() : sec.name}</span>`;
            btn.addEventListener('click', () => window._modalGoToSection(sec.containerId));
            sectionNav.appendChild(btn);
        });
        const resumenBtn = document.createElement('button');
        resumenBtn.type = 'button';
        resumenBtn.id = 'modal-resumen-tab';
        resumenBtn.className = 'section-nav-btn';
        resumenBtn.innerHTML = `<i class="lni lni-checkmark-circle"></i><span>${t('onb_step3_title','Resumen')}</span>`;
        resumenBtn.addEventListener('click', () => window._modalGoToResumen());
        sectionNav.appendChild(resumenBtn);
    }

    window._modalGoToSection = function(targetId) {
        AGENT_IDS.forEach(id => { const el=document.getElementById(id); if(el){el.classList.remove('active');el.style.display='none';} });
        document.querySelectorAll('.step').forEach(s=>s.classList.remove('active'));
        if(step1) step1.style.display='none';
        if(step2){step2.classList.add('active');step2.style.display='';}
        const target=document.getElementById(targetId);
        if(target){target.style.display='';target.classList.add('active');}
        const currentIdx=AGENT_SECTIONS.findIndex(s=>s.containerId===targetId);
        document.querySelectorAll('#sectionNavigation .section-nav-btn').forEach(btn=>{
            btn.classList.remove('active','completed');
            const sid=parseInt(btn.dataset.sectionId);
            const sec=AGENT_SECTIONS.find(s=>s.id===sid);
            if(!sec) return;
            const idx=AGENT_SECTIONS.indexOf(sec);
            if(idx===currentIdx) btn.classList.add('active');
            else if(idx<currentIdx) btn.classList.add('completed');
        });
        const el=document.getElementById(targetId);
        if(el) el.querySelectorAll('.btn-prev-section').forEach(b=>{ b.style.display=currentIdx===0?'none':'flex'; });
        if(typeof window.updateProgressBar==='function') window.updateProgressBar();
        if(modalBody) modalBody.scrollTop=0;
    };

    window._modalGoToResumen = function() {
        AGENT_IDS.forEach(id=>{ const el=document.getElementById(id); if(el){el.classList.remove('active');el.style.display='none';} });
        document.querySelectorAll('.step').forEach(s=>s.classList.remove('active'));
        if(step1) step1.style.display='none';
        const step3=document.getElementById('step3');
        if(step3){step3.classList.add('active');step3.style.display='';}
        document.querySelectorAll('#sectionNavigation .section-nav-btn').forEach(b=>{
            b.classList.remove('active','completed');
            if(b.id==='modal-resumen-tab') b.classList.add('active');
            else b.classList.add('completed');
        });
        if(typeof collectFormData==='function') collectFormData();
        if(typeof generateSummary==='function') generateSummary();
        if(typeof window.updateProgressBar==='function') window.updateProgressBar();
        if(modalBody) modalBody.scrollTop=0;
    };

    setTimeout(() => {
        // Parchar navigateToSection para que use _modalGoToSection en el modal
        window.navigateToSection = function(sectionId) {
            const sec = AGENT_SECTIONS.find(s => s.id === sectionId);
            if (sec && typeof window._modalGoToSection === 'function') {
                window._modalGoToSection(sec.containerId);
            }
        };

        // Aplicar modo gobierno DESPUÉS de construir _modalGoToSection
        if (_isGovModal && typeof applyGovernmentMode === 'function') {
            try { applyGovernmentMode(); } catch (_) {}
        }

        AGENT_SECTIONS.forEach((sec,idx)=>{
            const el=document.getElementById(sec.containerId);
            if(!el) return;
            const prevSec=AGENT_SECTIONS[idx-1], nextSec=AGENT_SECTIONS[idx+1];
            el.querySelectorAll('.btn-prev-section').forEach(btn=>{
                btn.style.display=idx===0?'none':'flex';
                if(prevSec) btn.onclick=(e)=>{e.stopPropagation();window._modalGoToSection(prevSec.containerId);};
            });
            el.querySelectorAll('.btn-next-section,[class*="next"]').forEach(btn=>{
                btn.onclick=(e)=>{e.stopPropagation();nextSec?window._modalGoToSection(nextSec.containerId):window._modalGoToResumen();};
            });
        });
        const b3=document.getElementById('btnBackStep3');
        if(b3){ const last=AGENT_SECTIONS[AGENT_SECTIONS.length-1]; b3.onclick=(e)=>{e.stopPropagation();window._modalGoToSection(last.containerId);}; }

        // Interceptar btnCreateAgent para loguear desde el contexto de my-agents
        const btnSubmit = document.getElementById('btnCreateAgent');
        if (btnSubmit) {
            // Clonar el nodo para limpiar listeners previos de onboarding.js
            const btnClone = btnSubmit.cloneNode(true);
            btnSubmit.parentNode.replaceChild(btnClone, btnSubmit);

            btnClone.addEventListener('click', () => {
                // ── Garantizar que agentData.social tiene el valor correcto ──
                // Leer directamente del radio button seleccionado antes del fetch
                const checkedSocial = document.querySelector('input[name="social"]:checked');
                if (checkedSocial && typeof agentData !== 'undefined') {
                    agentData.social = checkedSocial.value;
                    window.agentData.social = checkedSocial.value;
                }
                const snapshot = (typeof agentData !== 'undefined')
                    ? JSON.parse(JSON.stringify(agentData))
                    : {};
                console.log('🤖 [my-agents] Crear Agente — click registrado');
                console.log('📋 [my-agents] agentData.social:', snapshot.social);
                console.log('📋 [my-agents] agentData snapshot:', snapshot);
                // Delegar a createAgent() de onboarding.js
                if (typeof createAgent === 'function') createAgent();
            });
            console.log('✅ [my-agents] Listener de btnCreateAgent registrado');
        } else {
            console.warn('⚠️ [my-agents] #btnCreateAgent no encontrado en step3');
        }
    }, 150);

    // Hook btnStep1 (Continuar de Red Social) → mostrar step2 + sectionNav
    const btnStep1El = document.getElementById('btnStep1');
    if (btnStep1El) {
        const btnStep1Clone = btnStep1El.cloneNode(true);
        btnStep1El.parentNode.replaceChild(btnStep1Clone, btnStep1El);
        btnStep1Clone.addEventListener('click', () => {
            if (step1) { step1.classList.remove('active'); step1.style.display = 'none'; }
            if (step2) { step2.classList.add('active'); step2.style.display = ''; }
            const nav = document.getElementById('sectionNavigation');
            if (nav) nav.style.display = '';
            window._modalGoToSection('section-basic');
        });
        console.log('✅ [my-agents] Hook btnStep1 registrado');
    }


    // ── Social radio: event delegation robusta sobre step1 ──────────────────
    const _step1El = document.getElementById('step1');
    if (_step1El) {
        _step1El.addEventListener('change', function(e) {
            if (e.target && e.target.name === 'social') {
                if (window.agentData) window.agentData.social = e.target.value;
                const btn = document.getElementById('btnStep1');
                if (btn) btn.disabled = false;
            }
        });
    }
    // También llamar initializeSocialSelection si ya está disponible
    if (typeof initializeSocialSelection === 'function') initializeSocialSelection();

    // ── Modo edición: ir directo a "Info. Básica" y precargar el agente ────
    if (_editingAgentId) {
        if (typeof window._modalGoToSection === 'function') {
            window._modalGoToSection('section-basic');
        }
        if (typeof window.enterAgentEditMode === 'function') {
            window.enterAgentEditMode(_editingAgentId);
        } else {
            console.error('❌ enterAgentEditMode no está disponible (onboarding.js no cargó bien)');
        }
    }
}


// Función para actualizar la barra de progreso en el modal
function updateModalProgressBar(currentStep) {
    const progressSteps = document.querySelectorAll('.progress-step');
    const progressPercentage = document.getElementById('progressPercentage');
    const totalSteps = 3;
    const totalCircles = progressSteps.length;

    const circlesPerStep = totalCircles / totalSteps;
    const targetCircles = Math.ceil((currentStep - 1) * circlesPerStep) + 1;

    progressSteps.forEach((step, index) => {
        step.classList.remove('active', 'completed', 'cascading');

        if (index < targetCircles - 1) {
            step.classList.add('completed');
        } else if (index === targetCircles - 1) {
            step.classList.add('active');
        }
    });

    const previousCircles = Math.ceil(((currentStep - 2) * circlesPerStep)) + 1;
    const startCascade = Math.max(0, previousCircles);

    for (let i = startCascade; i < targetCircles; i++) {
        setTimeout(() => {
            if (progressSteps[i]) {
                progressSteps[i].classList.add('cascading');
                setTimeout(() => {
                    progressSteps[i].classList.remove('cascading');
                    if (i < targetCircles - 1) {
                        progressSteps[i].classList.add('completed');
                    } else {
                        progressSteps[i].classList.add('active');
                    }
                }, 600);
            }
        }, i * 80);
    }

    if (progressPercentage) {
        const targetProgress = ((currentStep - 1) / 2) * 100;
        const currentProgress = parseInt(progressPercentage.textContent) || 0;
        animatePercentage(currentProgress, targetProgress, progressPercentage);
    }
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

// Cargar agentes desde el backend
async function loadAgents() {
    try {
        const response = await fetch('/api/agents', {
            credentials: 'include'
        });

        if (!response.ok) {
            throw new Error('Error al cargar agentes');
        }

        const data = await response.json();
        agents = data.agents || [];

        console.log('📊 Agentes cargados:', agents);

        updateStats(agents);
        renderAgentsTable(agents);
        checkUnlinkedWhatsAppAgents(agents);
    } catch (error) {
        console.error('❌ Error:', error);
        showEmptyState();
    }
}

// Actualizar estadísticas
function updateStats(agents) {
    const activeCount = agents.filter(a => a.isActive && a.deployStatus === 'running').length;
    const totalCount = agents.length;
    const platformsCount = totalCount > 0 ? 1 : 0;

    document.getElementById('activeAgentsCount').textContent = activeCount;
    document.getElementById('totalAgentsCount').textContent = totalCount;
    document.getElementById('platformsCount').textContent = platformsCount;
}

// Renderizar tabla de agentes
function renderAgentsTable(agents) {
    const emptyState = document.getElementById('emptyState');
    const tableContainer = document.getElementById('agentsTableContainer');

    if (agents.length === 0) {
        if (emptyState) emptyState.style.display = 'block';
        if (tableContainer) tableContainer.style.display = 'none';
        return;
    }

    if (emptyState) emptyState.style.display = 'none';
    if (tableContainer) tableContainer.style.display = 'block';

    const tbody = document.getElementById('agentsTableBody');
    if (!tbody) {
        console.error('❌ No se encontró tbody con id="agentsTableBody"');
        return;
    }

    const rows = agents.map(agent => createAgentRow(agent));
    tbody.innerHTML = rows.join('');

    console.log('✅ Tabla renderizada con', agents.length, 'agentes');
}

// Crear fila de agente
function createAgentRow(agent) {
    const botType = (agent.botType || '').toLowerCase();
    // Los bots de WhatsApp Web (plan gratuito, QR con whatsmeow) nunca tienen
    // un número registrado — usan el número personal vinculado por QR, no uno
    // dado de alta vía Meta. "Sin número" ahí suena a error; aclaramos que es
    // por diseño. Solo WhatsApp Business (orbital/builderbot) y Telegram usan
    // un número/token real, y ahí sí "Sin número" indica algo pendiente.
    const isWhatsAppWeb = botType === 'atomic';
    const phone = agent.phoneNumber
        || (isWhatsAppWeb ? t('agents_whatsapp_web_number', 'WhatsApp Web') : t('agents_no_number', 'Sin número'));
    const statusBadge = getStatusBadge(agent);

    return `<tr data-agent-id="${agent.id}">
    <td>
        <div class="agent-name-cell">
            <div class="agent-robot-icon">
                <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <line x1="24" y1="6" x2="24" y2="10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    <circle cx="24" cy="5" r="1.5" fill="currentColor"/>
                    <rect x="14" y="10" width="20" height="16" rx="4" stroke="currentColor" stroke-width="2" fill="none"/>
                    <circle cx="19" cy="16" r="2" fill="currentColor"/>
                    <circle cx="29" cy="16" r="2" fill="currentColor"/>
                    <path d="M 18 21 Q 24 23 30 21" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>
                    <rect x="16" y="26" width="16" height="12" rx="3" stroke="currentColor" stroke-width="2" fill="none"/>
                    <circle cx="24" cy="31" r="2" stroke="currentColor" stroke-width="1.5" fill="none"/>
                    <circle cx="24" cy="31" r="0.8" fill="currentColor"/>
                    <rect x="10" y="28" width="4" height="8" rx="2" stroke="currentColor" stroke-width="2" fill="none"/>
                    <rect x="34" y="28" width="4" height="8" rx="2" stroke="currentColor" stroke-width="2" fill="none"/>
                    <rect x="18" y="38" width="4" height="4" rx="1.5" stroke="currentColor" stroke-width="2" fill="none"/>
                    <rect x="26" y="38" width="4" height="4" rx="1.5" stroke="currentColor" stroke-width="2" fill="none"/>
                </svg>
            </div>
            <a class="agent-name agent-name-link" href="/agents/${agent.id}">${escapeHtml(agent.name)}</a>
        </div>
    </td>
    <td>
        <span class="agent-id-badge">#${agent.id}</span>
    </td>
    <td>${getPlatformBadge(agent)}</td>
    <td>
        <div class="phone-number">
            <i class="lni lni-phone"></i>
            <span>${escapeHtml(phone)}</span>
        </div>
    </td>
    <td>${statusBadge}</td>
    <td class="actions-cell">
        <div class="actions-menu">
            <button class="actions-trigger" onclick="toggleDropdown(event, ${agent.id})">
                <i class="lni lni-more-alt"></i>
            </button>
            <div class="actions-dropdown" id="dropdown-${agent.id}">
                <button class="dropdown-item view" onclick="viewAgentDetails(${agent.id})">
                    <i class="lni lni-eye"></i>
                    <span>${t('agents_dd_view', 'Ver Detalles')}</span>
                </button>
                <button class="dropdown-item edit" onclick="openOnboardingModalForEdit(${agent.id})">
                    <i class="lni lni-pencil"></i>
                    <span>${t('agents_dd_edit', 'Editar Agente')}</span>
                </button>
                <button class="dropdown-item qr" onclick="showQRModal(${agent.id}, '${escapeHtml(agent.name).replace(/'/g, "\\'")}')">
                    <svg class="qr-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <rect x="3" y="3" width="7" height="7" rx="1"/>
                        <rect x="14" y="3" width="7" height="7" rx="1"/>
                        <rect x="3" y="14" width="7" height="7" rx="1"/>
                        <rect x="14.5" y="14.5" width="2.5" height="2.5" rx="0.5"/>
                        <rect x="18.5" y="14.5" width="2.5" height="2.5" rx="0.5"/>
                        <rect x="14.5" y="18.5" width="2.5" height="2.5" rx="0.5"/>
                        <rect x="18.5" y="18.5" width="2.5" height="2.5" rx="0.5"/>
                    </svg>
                    <span>${t('agents_dd_qr', 'Ver QR')}</span>
                </button>
                <button class="dropdown-item redeploy" onclick="confirmRedeploy(${agent.id}, '${escapeHtml(agent.name).replace(/'/g, "\\'")}', '${agent.botType || ''}')">
                    <i class="lni lni-reload"></i>
                    <span>${t('agents_dd_redeploy', 'Redeploy')}</span>
                </button>
                <div class="dropdown-divider"></div>
                <button class="dropdown-item pause" onclick="toggleAgentStatus(${agent.id}, ${agent.isActive})">
                    <i class="lni lni-${agent.isActive ? 'pause' : 'play'}"></i>
                    <span>${agent.isActive ? t('ad_pause', 'Pausar') : t('ad_activate', 'Activar')}</span>
                </button>
                <button class="dropdown-item delete" onclick="confirmDeleteAgent(${agent.id})">
                    <i class="lni lni-trash-can"></i>
                    <span>${t('agents_dd_delete', 'Eliminar')}</span>
                </button>
            </div>
        </div>
    </td>
</tr>`;
}


// Obtener badge de plataforma según botType
function getPlatformBadge(agent) {
    const botType = (agent.botType || '').toLowerCase();

    if (botType === 'telegram') {
        return `<div class="platform-badge telegram">
            <svg viewBox="0 0 24 24" fill="currentColor" style="width:14px;height:14px;flex-shrink:0">
                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L8.32 13.617l-2.96-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.828.942z"/>
            </svg>
            <span>Telegram</span>
        </div>`;
    }

    if (botType === 'orbital' || botType === 'builderbot') {
        return `<div class="platform-badge whatsapp">
            <i class="lni lni-whatsapp"></i>
            <span>WhatsApp Business</span>
        </div>`;
    }

    // atomic o cualquier otro → WhatsApp
    return `<div class="platform-badge whatsapp">
        <i class="lni lni-whatsapp"></i>
        <span>WhatsApp</span>
    </div>`;
}

// Obtener badge de estado
function getStatusBadge(agent) {
    if (agent.deployStatus === 'running' && agent.isActive) {
        return `<div class="status-badge active">
                <span class="status-dot"></span>
                <span>${t('ad_status_active', 'Activo')}</span>
            </div>`;
    } else if (agent.deployStatus === 'pending' || agent.deployStatus === 'deploying') {
        return `<div class="status-badge pending">
                <span class="status-dot"></span>
                <span>${t('ad_status_deploying', 'Desplegando')}</span>
            </div>`;
    } else if (agent.deployStatus === 'error') {
        return `<div class="status-badge inactive">
                <span class="status-dot"></span>
                <span>${t('ad_status_error', 'Error')}</span>
            </div>`;
    } else {
        return `<div class="status-badge inactive">
                <span class="status-dot"></span>
                <span>${t('ad_status_inactive', 'Inactivo')}</span>
            </div>`;
    }
}

// Toggle dropdown con animación smooth
function toggleDropdown(event, agentId) {
    event.stopPropagation();

    const dropdown = document.getElementById(`dropdown-${agentId}`);
    if (!dropdown) return;

    const allDropdowns = document.querySelectorAll('.actions-dropdown');

    // Cerrar todos los otros dropdowns
    allDropdowns.forEach(d => {
        if (d !== dropdown && d.classList.contains('show')) {
            d.classList.remove('show');
        }
    });

    // Toggle el dropdown actual
    dropdown.classList.toggle('show');
}

// Inicializar event listeners para dropdowns
function initializeDropdowns() {
    // Cerrar dropdowns al hacer click fuera
    document.addEventListener('click', function (event) {
        if (!event.target.closest('.actions-menu')) {
            const allDropdowns = document.querySelectorAll('.actions-dropdown');
            allDropdowns.forEach(d => d.classList.remove('show'));
        }
    });

    console.log('✅ Dropdowns inicializados');
}

// Ver detalles del agente
function viewAgentDetails(agentId) {
    console.log('👁️ Ver detalles del agente:', agentId);
    window.location.href = `/agents/${agentId}`;
}

// Toggle status del agente - CON MODAL
async function toggleAgentStatus(agentId, currentStatus) {
    const agent = agents.find(a => a.id === agentId);
    if (!agent) return;

    const action = currentStatus ? t('ad_pause', 'Pausar').toLowerCase() : t('ad_activate', 'Activar').toLowerCase();
    const actionTitle = currentStatus ? t('ad_pause', 'Pausar') : t('ad_activate', 'Activar');

    showConfirmModal({
        type: 'warning',
        icon: currentStatus ? 'lni-pause' : 'lni-play',
        title: t('agents_toggle_title', '¿{action} Agente?').replace('{action}', actionTitle),
        message: t('agents_pause_msg', 'Estás a punto de {action} el agente "{name}"')
            .replace('{action}', action).replace('{name}', `<strong>${escapeHtml(agent.name)}</strong>`),
        list: currentStatus ? [
            t('agents_pause_list1', 'El agente dejará de responder mensajes'),
            t('agents_pause_list2', 'Los clientes no recibirán atención automática'),
            t('agents_pause_list3', 'Puedes reactivarlo cuando quieras')
        ] : [
            t('agents_activate_list1', 'El agente volverá a responder mensajes'),
            t('agents_activate_list2', 'Se reanudará la atención automática'),
            t('agents_activate_list3', 'Los clientes podrán interactuar nuevamente')
        ],
        confirmText: t('agents_action_agent_btn', '{action} Agente').replace('{action}', actionTitle),
        confirmClass: 'warning',
        onConfirm: async () => {
            try {
                const response = await fetch(`/api/agents/${agentId}/toggle`, {
                    method: 'PATCH',
                    credentials: 'include'
                });

                if (!response.ok) {
                    throw new Error('Error al cambiar estado del agente');
                }

                await loadAgents();
                showNotification(`✅ ${t('agents_toggle_success', 'Agente {action} exitosamente').replace('{action}', action)}`, 'success');
            } catch (error) {
                console.error('❌ Error:', error);
                showNotification(`❌ ${t('agents_toggle_error', 'Error al cambiar el estado del agente')}`, 'error');
            }
        }
    });
}

// Confirmar eliminación de agente - CON MODAL
function confirmDeleteAgent(agentId) {
    const agent = agents.find(a => a.id === agentId);
    if (!agent) return;

    showConfirmModal({
        type: 'danger',
        icon: 'lni-trash-can',
        title: t('agents_delete_title', '¿Eliminar Agente?'),
        message: t('agents_delete_msg', 'Estás a punto de eliminar el agente "{name}"')
            .replace('{name}', `<strong>${escapeHtml(agent.name)}</strong>`),
        list: [
            t('agents_delete_list1', 'El bot de WhatsApp'),
            t('agents_delete_list2', 'Todas las configuraciones'),
            t('agents_delete_list3', 'El historial de conversaciones')
        ],
        confirmText: t('agents_delete_confirm_btn', 'Eliminar Agente'),
        confirmClass: 'danger',
        onConfirm: () => deleteAgent(agentId)
    });
}

// Eliminar agente
async function deleteAgent(agentId) {
    try {
        const response = await fetch(`/api/agents/${agentId}`, {
            method: 'DELETE',
            credentials: 'include'
        });

        if (!response.ok) {
            throw new Error('Error al eliminar agente');
        }

        await loadAgents();
        showNotification(`✅ ${t('agents_delete_success', 'Agente eliminado exitosamente')}`, 'success');
    } catch (error) {
        console.error('❌ Error:', error);
        showNotification(`❌ ${t('agents_delete_error', 'Error al eliminar el agente')}`, 'error');
    }
}

// Mostrar modal de confirmación
function showConfirmModal(options) {
    const {
        type = 'warning',
        icon = 'lni-warning',
        title = '¿Estás seguro?',
        message = '',
        list = [],
        confirmText = 'Confirmar',
        confirmClass = 'danger',
        onConfirm = () => { }
    } = options;

    // Crear modal si no existe
    let modal = document.getElementById('confirmModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'confirmModal';
        modal.className = 'confirm-modal';
        document.body.appendChild(modal);
    }

    // Renderizar contenido
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
                        <span>${t('agents_cancel', 'Cancelar')}</span>
                    </button>
                    <button class="btn-confirm-action ${confirmClass}" id="confirmActionBtn">
                        <i class="lni lni-checkmark"></i>
                        <span>${confirmText}</span>
                    </button>
                </div>
            </div>
        </div>
    `;

    // Mostrar modal
    modal.classList.add('active');

    // Event listener para confirmar
    document.getElementById('confirmActionBtn').addEventListener('click', async function () {
        // Mostrar loading
        this.innerHTML = `
            <div class="loading-spinner-small"></div>
            <span>Procesando...</span>
        `;
        this.disabled = true;

        try {
            await onConfirm();
            closeConfirmModal();
        } catch (error) {
            console.error('Error en confirmación:', error);
            this.disabled = false;
            this.innerHTML = `
                <i class="lni lni-checkmark"></i>
                <span>${confirmText}</span>
            `;
        }
    });
}

// Cerrar modal de confirmación
function closeConfirmModal() {
    const modal = document.getElementById('confirmModal');
    if (modal) {
        modal.classList.remove('active');
        setTimeout(() => modal.remove(), 300);
    }
}

// Mostrar notificación — usa Sileo toast system
function showNotification(message, type = 'info') {
    if (typeof Sileo === 'undefined') {
        console.warn('Sileo no disponible, fallback a console');
        console.log(`[${type}] ${message}`);
        return;
    }

    const titleMap = {
        success: 'Éxito',
        error:   'Error',
        warning: 'Advertencia',
        info:    'Información'
    };

    const sileoType = ['success', 'error', 'warning', 'info'].includes(type) ? type : 'info';

    Sileo[sileoType]({
        title:       titleMap[sileoType],
        description: message
    });
}

// Mostrar estado vacío
function showEmptyState() {
    const emptyState = document.getElementById('emptyState');
    const tableContainer = document.getElementById('agentsTableContainer');

    if (emptyState) emptyState.style.display = 'block';
    if (tableContainer) tableContainer.style.display = 'none';

    updateStats([]);

    // También interceptar el botón del empty state
    const emptyStateBtn = emptyState.querySelector('.btn-primary');
    if (emptyStateBtn) {
        emptyStateBtn.addEventListener('click', function (e) {
            e.preventDefault();
            openOnboardingModal();
        });
    }
}

// Escape HTML para prevenir XSS
function escapeHtml(text) {
    if (!text) return '';
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return String(text).replace(/[&<>"']/g, m => map[m]);
}


// ─── QR Modal ────────────────────────────────────────────────
// Usa el mismo modal / flujo que el QR automático de onboarding.js
// (ensureModalsExist + startQRPolling) para que el usuario vea siempre
// la misma UI, sin importar si el QR se abrió automáticamente al
// detectar un agente sin vincular, o manualmente desde el dropdown.
async function showQRModal(agentId, agentName) {
    document.querySelectorAll('.actions-dropdown').forEach(d => d.classList.remove('show'));

    // Evita que el auto-detect (checkUnlinkedWhatsAppAgents) abra un segundo
    // polling duplicado para este mismo agente más tarde en la sesión.
    _whatsappModalShownFor.add(agentId);

    await ensureOnboardingScriptLoaded();

    if (typeof window.ensureModalsExist !== 'function' || typeof window.startQRPolling !== 'function') {
        showNotification(`❌ ${t('agents_qr_error', 'Error al obtener QR')}`, 'error');
        return;
    }

    window.ensureModalsExist();
    window.startQRPolling(agentId, agentName || '');
}

// ─── Redeploy ────────────────────────────────────────────────
function confirmRedeploy(agentId, agentName, botType) {
    document.querySelectorAll('.actions-dropdown').forEach(d => d.classList.remove('show'));
    showConfirmModal({
        type: 'warning',
        icon: 'lni-reload',
        title: t('agents_redeploy_title', '¿Redeploy del Agente?'),
        message: t('agents_redeploy_msg', 'Se reiniciará el bot {name} desde cero. El QR se regenerará y tendrás que volver a escanear.')
            .replace('{name}', `<strong>${escapeHtml(agentName)}</strong>`),
        list: [
            t('agents_redeploy_list1', 'El bot se desconectará momentáneamente'),
            t('agents_redeploy_list2', 'Se generará un nuevo QR'),
            t('agents_redeploy_list3', 'Los datos del negocio no se perderán')
        ],
        confirmText: t('agents_redeploy_confirm_btn', 'Sí, Redeploy'),
        confirmClass: 'warning',
        onConfirm: () => redeployAgent(agentId, agentName, botType)
    });
}

async function redeployAgent(agentId, agentName, botType) {
    try {
        showNotification(`🔄 ${t('agents_redeploy_starting', 'Iniciando redeploy...')}`, 'info');
        const resp = await fetch(`/api/agents/${agentId}/redeploy`, {
            method: 'POST',
            credentials: 'include'
        });
        if (!resp.ok) throw new Error('Error en redeploy');
        showNotification(`✅ ${t('agents_redeploy_success', 'Redeploy iniciado.')}`, 'success');

        // Si es un agente de WhatsApp (AtomicBot), mostrar la animación de
        // progreso (misma que al crear un agente) y, cuando detecte que el
        // bot volvió a "running", abrir automáticamente el modal de QR.
        if (botType === 'atomic') {
            await ensureOnboardingScriptLoaded();
            if (typeof window.watchAgentRedeploy === 'function') {
                _whatsappModalShownFor.add(agentId); // evita que el auto-detect abra un QR duplicado
                window.watchAgentRedeploy(agentId, agentName);
            }
        }

        setTimeout(() => loadAgents(), 3000);
    } catch (e) {
        showNotification(`❌ ${t('agents_redeploy_error', 'Error al hacer redeploy')}`, 'error');
    }
}

// Recargar agentes cada 30 segundos
setInterval(async () => {
    const currentlyOpen = document.querySelector('.actions-dropdown.show');
    const onboardingOpen = document.querySelector('.onboarding-modal.active');
    if (!currentlyOpen && !onboardingOpen) {
        await loadAgents();
    }
}, 30000);

window.reinitializeOnboardingEvents = reinitializeOnboardingEvents;

// CSS para animaciones y spinner
const style = document.createElement('style');
style.textContent = `
    .loading-spinner-small {
        width: 16px;
        height: 16px;
        border: 2px solid rgba(255, 255, 255, 0.3);
        border-top: 2px solid white;
        border-radius: 50%;
        animation: spin 1s linear infinite;
    }
    
    /* slideIn / slideOut removed — using Sileo toast system */
`;
document.head.appendChild(style);
// ============================================
// DÍAS FESTIVOS / SERVICIOS / TRABAJADORES (wizard del agente)
// reinitializeOnboardingEvents() (aquí y en dashboard.js/my-agents.js/integrations.js)
// siempre llamó a initializeHolidays/initializeServices/initializeWorkers de forma
// defensiva (typeof === 'function') pero esas funciones nunca existieron en ningún
// archivo — por eso los botones "Agregar" no hacían nada. Se agregan aquí: como
// onboarding.js se carga (directo o inyectado dinámicamente) en las 4 superficies
// antes de llamar reinitializeOnboardingEvents, quedan disponibles en las 4 sin
// tocar los otros archivos. No se reutilizan los nombres de my-business.js
// (addServiceItem, addWorkerItem, addHoliday, removeItem, etc.) porque my-business.js
// también carga onboarding.js dinámicamente (para el modal de QR) — usar los mismos
// nombres globales pisaría las funciones reales de Mi Negocio si ambos scripts
// conviven en la página.
// ============================================

function initializeHolidays() {
    const btn = document.getElementById('addHolidayBtn');
    if (!btn || btn.dataset.obWired) return;
    btn.dataset.obWired = '1';
    btn.addEventListener('click', () => _obAddHolidayRow());
}

function _obAddHolidayRow(data) {
    const list = document.getElementById('holidaysList');
    if (!list) return;
    const row = document.createElement('div');
    row.className = 'holiday-item';
    row.innerHTML = `
        <input type="date" class="form-input holiday-date" value="${data?.date || ''}">
        <input type="text" class="form-input holiday-name" placeholder="${t('onb_hol_name_ph','Nombre del día festivo')}" value="${(data?.name || '').replace(/"/g, '&quot;')}">
        <button type="button" class="btn-remove-holiday" title="${t('onb_remove_item','Eliminar')}">
            <i class="lni lni-trash-can"></i>
        </button>
    `;
    row.querySelector('.btn-remove-holiday').addEventListener('click', () => row.remove());
    list.appendChild(row);
}

function initializeServices() {
    const btn = document.getElementById('addServiceBtn');
    if (!btn || btn.dataset.obWired) return;
    btn.dataset.obWired = '1';
    btn.addEventListener('click', () => _obAddServiceRow());
}

function _obRenumberServices() {
    const list = document.getElementById('servicesList');
    if (!list) return;
    list.querySelectorAll('.service-item .service-number').forEach((el, idx) => {
        el.textContent = `${t('onb_svc_label','Servicio')} #${idx + 1}`;
    });
}

function _obAddServiceRow(data) {
    const list = document.getElementById('servicesList');
    if (!list) return;
    const isPromo = data?.priceType === 'promo';
    const item = document.createElement('div');
    item.className = 'service-item';
    item.innerHTML = `
        <div class="service-header">
            <span class="service-number"></span>
            <button type="button" class="btn-remove-service" title="${t('onb_remove_item','Eliminar')}">
                <i class="lni lni-trash-can"></i>
            </button>
        </div>
        <div class="service-fields">
            <input type="text" class="form-input service-title" placeholder="${t('onb_svc_name_ph','Nombre del servicio o producto')}" value="${(data?.title || '').replace(/"/g, '&quot;')}">
            <div class="price-input-wrapper">
                <span class="price-currency">$</span>
                <input type="number" min="0" step="0.01" class="form-input price-input service-price" placeholder="${t('onb_svc_price_ph','Precio')}" value="${data?.price ?? ''}">
            </div>
            <div class="price-type-selector">
                <div class="price-type-option${isPromo ? '' : ' active'}" data-type="normal">${t('onb_svc_price_normal','Precio normal')}</div>
                <div class="price-type-option${isPromo ? ' active' : ''}" data-type="promo">${t('onb_svc_price_promo','En promoción')}</div>
            </div>
            <div class="promotion-prices${isPromo ? ' show' : ''}">
                <input type="number" min="0" step="0.01" class="form-input service-price-original" placeholder="${t('onb_svc_price_original','Precio original')}" value="${data?.originalPrice ?? ''}">
                <input type="number" min="0" step="0.01" class="form-input service-price-promo" placeholder="${t('onb_svc_price_promo_val','Precio en promoción')}" value="${data?.promoPrice ?? ''}">
            </div>
            <div class="service-description-editor">
                <div class="service-editor-toolbar">
                    <button type="button" class="service-editor-btn" data-cmd="bold" title="${t('onb_editor_bold','Negrita')}"><i class="lni lni-text-format"></i></button>
                    <button type="button" class="service-editor-btn" data-cmd="italic" title="${t('onb_editor_italic','Cursiva')}"><i class="lni lni-italic"></i></button>
                    <button type="button" class="service-editor-btn" data-cmd="insertUnorderedList" title="${t('onb_editor_list','Lista')}"><i class="lni lni-list"></i></button>
                </div>
                <div class="service-editor-content" contenteditable="true" data-placeholder="${t('onb_svc_desc_ph','Descripción (opcional)')}">${data?.description || ''}</div>
            </div>
        </div>
    `;
    item.querySelector('.btn-remove-service').addEventListener('click', () => { item.remove(); _obRenumberServices(); });
    const options = item.querySelectorAll('.price-type-option');
    const promoBox = item.querySelector('.promotion-prices');
    options.forEach(opt => {
        opt.addEventListener('click', () => {
            options.forEach(o => o.classList.remove('active'));
            opt.classList.add('active');
            promoBox.classList.toggle('show', opt.dataset.type === 'promo');
        });
    });
    item.querySelectorAll('.service-editor-btn').forEach(tbtn => {
        tbtn.addEventListener('click', () => {
            item.querySelector('.service-editor-content').focus();
            document.execCommand(tbtn.dataset.cmd, false, null);
        });
    });
    list.appendChild(item);
    _obRenumberServices();
}

function initializeWorkers() {
    const btn = document.getElementById('addWorkerBtn');
    if (!btn || btn.dataset.obWired) return;
    btn.dataset.obWired = '1';
    btn.addEventListener('click', () => _obAddWorkerRow());
}

function _obRenumberWorkers() {
    const list = document.getElementById('workersList');
    if (!list) return;
    list.querySelectorAll('.worker-item .worker-number').forEach((el, idx) => {
        el.textContent = `${t('onb_wkr_label','Trabajador')} #${idx + 1}`;
    });
}

function _obAddWorkerRow(data) {
    const list = document.getElementById('workersList');
    if (!list) return;
    // Declarado local (no a nivel de archivo) a propósito: este mismo bloque
    // se duplica en onboarding.js/dashboard.js/my-agents.js/integrations.js —
    // un const/let a nivel de archivo repetido en 2 scripts que conviven en
    // la misma página revienta con "Identifier ya declarado" (SyntaxError),
    // igual que pasó con STATUS_BADGE_KEY_MAP. Dentro de una función no hay ese riesgo.
    const weekDays = [
        { key: 'monday',    label: () => t('day_monday','Lunes') },
        { key: 'tuesday',   label: () => t('day_tuesday','Martes') },
        { key: 'wednesday', label: () => t('day_wednesday','Miércoles') },
        { key: 'thursday',  label: () => t('day_thursday','Jueves') },
        { key: 'friday',    label: () => t('day_friday','Viernes') },
        { key: 'saturday',  label: () => t('day_saturday','Sábado') },
        { key: 'sunday',    label: () => t('day_sunday','Domingo') },
    ];
    const checkedDays = data?.days || ['monday','tuesday','wednesday','thursday','friday'];
    const daysHTML = weekDays.map(d => `
        <label class="availability-day">
            <input type="checkbox" value="${d.key}" ${checkedDays.includes(d.key) ? 'checked' : ''}>
            <span>${d.label()}</span>
        </label>
    `).join('');
    const item = document.createElement('div');
    item.className = 'worker-item';
    item.innerHTML = `
        <div class="worker-header">
            <span class="worker-number"></span>
            <button type="button" class="btn-remove-worker" title="${t('onb_remove_item','Eliminar')}">
                <i class="lni lni-trash-can"></i>
            </button>
        </div>
        <div class="worker-fields">
            <input type="text" class="form-input worker-name" placeholder="${t('onb_wkr_name_ph','Nombre del trabajador')}" value="${(data?.name || '').replace(/"/g, '&quot;')}">
            <div class="worker-availability">
                <div class="availability-title">${t('onb_wkr_availability','Disponibilidad')}</div>
                <div class="availability-grid">${daysHTML}</div>
            </div>
            <div class="worker-hours">
                <input type="time" class="form-input worker-start" value="${data?.startTime || '09:00'}">
                <input type="time" class="form-input worker-end" value="${data?.endTime || '18:00'}">
            </div>
        </div>
    `;
    item.querySelector('.btn-remove-worker').addEventListener('click', () => { item.remove(); _obRenumberWorkers(); });
    list.appendChild(item);
    _obRenumberWorkers();
}