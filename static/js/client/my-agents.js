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
        script.src = '/static/js/client/onboarding.js?v=' + Date.now();
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
                link.href = '/static/css/client/onboarding.css';
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
                script.src = '/static/js/client/onboarding.js?v=' + Date.now();
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

    // Igual que en el Dashboard: si ya hay agentes (el negocio ya está
    // llenado en Mi Negocio), solo se configuran Info. Básica y Personalidad
    // (+ Resumen). El resto de secciones viene de Mi Negocio y se oculta.
    let _hasExistingAgents = !!_editingAgentId;
    if (!_hasExistingAgents) {
        try {
            const _agentsResp = await fetch('/api/agents', { credentials: 'include' });
            if (_agentsResp.ok) {
                const _agentsData = await _agentsResp.json();
                _hasExistingAgents = Array.isArray(_agentsData.agents) && _agentsData.agents.length > 0;
            }
        } catch (_) {}
    }
    if (_hasExistingAgents) {
        const _keep = ['section-basic', 'section-personality'];
        AGENT_SECTIONS = AGENT_SECTIONS.filter(s => _keep.includes(s.containerId));
        ['section-business','section-location','section-social','section-schedule','section-holidays',
         'section-services','section-menu','section-workers'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.classList.remove('active'); el.style.display = 'none'; }
        });
    }
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
        // Una sola fila deslizable: la cápsula cian (ob-seg-thumb) solo viaja en horizontal
        sectionNav.style.justifyContent = '';
        sectionNav.style.flexWrap = '';
        sectionNav.style.gap = '';
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

// ============================================================================
// CAPA iOS 27 — dropdown de acciones y modales
// No cambia la lógica de arriba: observa la clase .show del dropdown y
// envuelve closeConfirmModal / closeOnboardingModal para animar la salida.
// ============================================================================
(function () {
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

    // ====================================================================
    // 1. DROPDOWN DE ACCIONES
    // Nace del botón de 3 puntos, resaltado que sigue al cursor con el color
    // de cada acción, y se abre hacia arriba si no cabe abajo.
    // ====================================================================
    const CLOSED_CLIP = 'inset(50% 50% 50% 50%)';
    const menus = new WeakMap();

    function menuFor(dd) {
        if (menus.has(dd)) return menus.get(dd);
        const trigger = dd.parentElement.querySelector('.actions-trigger');
        if (!trigger) return null;
        dd.classList.add('ios-menu');
        dd.style.visibility = 'hidden';
        dd.style.clipPath = CLOSED_CLIP;

        const ind = document.createElement('span');
        ind.className = 'ios-menu-ind';
        ind.setAttribute('aria-hidden', 'true');
        dd.prepend(ind);

        const P = spring(0, 400, 30, 0.001);
        const X = spring(0, 520, 36), Y = spring(0, 520, 36), W = spring(0, 520, 36), H = spring(0, 520, 36);
        const V = spring(0, 600, 44, 0.001);
        let open = false, hovered = null;

        function render() {
            if (!dd.isConnected) {
                renderers.delete(render);
                [P, X, Y, W, H, V].forEach((s) => springs.delete(s));
                return;
            }
            const p = P.v, pc = clamp(p);
            if (p < 0.002 && P.t === 0) {
                dd.style.visibility = 'hidden';
                dd.style.clipPath = CLOSED_CLIP;
                if (trigger.classList.contains('ios-open')) trigger.classList.remove('ios-open');
            } else {
                dd.style.visibility = 'visible';
                dd.style.setProperty('--ios-p', pc.toFixed(3));
                if (open && atRest(P)) dd.style.clipPath = 'none';
                else {
                    const a = trigger.getBoundingClientRect(), c = dd.getBoundingClientRect();
                    const t = lerp(a.top - c.top, 0, p), l = lerp(a.left - c.left, 0, p);
                    const r = lerp(c.right - a.right, 0, p), b = lerp(c.bottom - a.bottom, 0, p);
                    dd.style.clipPath = `inset(${t}px ${r}px ${b}px ${l}px round ${lerp(a.height / 2, 20, pc)}px)`;
                }
            }
            const st = Math.min(Math.abs(Y.vel) / 1800, 0.2);
            ind.style.width = `${W.v}px`;
            ind.style.height = `${H.v}px`;
            ind.style.opacity = clamp(V.v);
            ind.style.transform = `translate(${X.v}px, ${Y.v}px) scale(${1 - st * 0.2}, ${1 + st})`;
        }
        renderers.add(render);

        const TONES = ['view', 'edit', 'qr', 'redeploy', 'pause', 'delete'];
        function hoverTo(el) {
            if (el === hovered) return;
            if (hovered) hovered.classList.remove('ios-hover');
            hovered = el;
            if (!el) { V.t = 0; kick(); return; }
            el.classList.add('ios-hover');
            ind.dataset.tone = TONES.find((c) => el.classList.contains(c)) || '';
            X.t = el.offsetLeft; Y.t = el.offsetTop; W.t = el.offsetWidth; H.t = el.offsetHeight; V.t = 1;
            if (V.v < 0.05) { X.v = X.t; Y.v = Y.t; W.v = W.t; H.v = H.t; }
            kick();
        }
        dd.addEventListener('pointermove', (e) => {
            const el = e.target.closest('.dropdown-item');
            if (el && dd.contains(el)) hoverTo(el);
        });
        dd.addEventListener('pointerleave', () => hoverTo(null));
        // Al elegir una acción el menú se cierra (su onclick ya se ejecutó)
        dd.addEventListener('click', (e) => {
            if (e.target.closest('.dropdown-item')) dd.classList.remove('show');
        });

        // Si abajo no cabe, se abre hacia arriba
        function placeMenu() {
            if (dd.classList.contains('ios-up')) dd.classList.remove('ios-up');
            const scroller = dd.closest('.content-wrapper');
            const bottomLimit = Math.min(window.innerHeight, scroller ? scroller.getBoundingClientRect().bottom : Infinity) - 12;
            const r = dd.getBoundingClientRect(), a = trigger.getBoundingClientRect();
            if (r.bottom > bottomLimit && a.top - r.height - 10 > 8) dd.classList.add('ios-up');
        }

        function sync() {
            const nowOpen = dd.classList.contains('show');
            if (nowOpen === open) return;
            open = nowOpen;
            if (open) {
                placeMenu();
                trigger.classList.add('ios-open');
                V.v = V.t = 0; hovered = null;
                P.t = 1;
                if (!reduce.matches && dd.animate) {
                    dd.querySelectorAll('.dropdown-item, .dropdown-divider').forEach((it, i) => {
                        it.animate(
                            [{ opacity: 0, transform: `translateY(${dd.classList.contains('ios-up') ? 8 : -8}px)` }, { opacity: 1, transform: 'none' }],
                            { duration: 420, delay: 40 + i * 22, easing: SPRING, fill: 'backwards' }
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
        menus.set(dd, api);
        return api;
    }

    // Al renderizar la tabla se preparan los menús nuevos (cerrados)
    function prepareMenus(root = document) {
        root.querySelectorAll('.actions-dropdown').forEach(menuFor);
    }

    new MutationObserver((records) => {
        records.forEach((r) => {
            if (r.type === 'attributes') {
                const el = r.target;
                if (el.classList && el.classList.contains('actions-dropdown')) menuFor(el)?.sync();
            } else {
                r.addedNodes.forEach((n) => {
                    if (n.nodeType !== 1) return;
                    if (n.querySelector) prepareMenus(n);
                });
            }
        });
    }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });

    window.addEventListener('resize', () => renderers.forEach((r) => r()));
    document.addEventListener('scroll', () => renderers.forEach((r) => r()), { passive: true, capture: true });

    // ====================================================================
    // 2. MODALES
    // Entrada: el fondo se difumina y la tarjeta sube con resorte.
    // Salida: se anima antes de que la lógica original lo oculte.
    // ====================================================================
    function animateClose(modal, done) {
        if (!modal || !modal.classList.contains('active') || modal.classList.contains('ios-closing') || reduce.matches) {
            done();
            return;
        }
        modal.classList.add('ios-closing');
        setTimeout(() => {
            done();
            modal.classList.remove('ios-closing');
        }, 230);
    }

    const origCloseConfirm = window.closeConfirmModal;
    if (typeof origCloseConfirm === 'function') {
        window.closeConfirmModal = function () {
            animateClose(document.getElementById('confirmModal'), () => origCloseConfirm.apply(this, arguments));
        };
    }

    const origCloseOnboarding = window.closeOnboardingModal;
    if (typeof origCloseOnboarding === 'function') {
        window.closeOnboardingModal = function () {
            animateClose(document.getElementById('onboardingModal'), () => origCloseOnboarding.apply(this, arguments));
        };
    }

    // Esc cierra el modal de confirmación
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const c = document.querySelector('.confirm-modal.active');
        if (c) { window.closeConfirmModal(); return; }
        document.querySelectorAll('.actions-dropdown.show').forEach((d) => d.classList.remove('show'));
    });


    // ====================================================================
    // 3. ENTRADA DE LOS ELEMENTOS
    // Encabezado, tarjetas y tabla suben escalonados con desenfoque; las
    // filas de agentes entran una tras otra y los números cuentan hacia arriba.
    // ====================================================================
    function pageEntrance() {
        const parts = [
            '.page-header .header-left', '.page-header .header-right',
            '.agents-stats > .stat-card', '#agentsTableContainer', '#emptyState',
        ];
        let i = 0;
        parts.forEach((sel) => document.querySelectorAll(sel).forEach((el) => {
            el.style.setProperty('--i', i++);
            el.classList.add('ios-in');
        }));
        // Al terminar se quita la clase para que el hover de las tarjetas vuelva a usar transform
        document.addEventListener('animationend', (e) => {
            if (e.target.classList && e.target.classList.contains('ios-in') && e.animationName === 'iosRiseMove') {
                e.target.classList.remove('ios-in');
            }
        });
    }

    // Filas: en la primera carga entran todas; en las recargas automáticas
    // (cada 30 s) solo se animan los agentes nuevos.
    const seenAgents = new Set();
    let firstRows = true;
    function animateRows() {
        const rows = [...document.querySelectorAll('#agentsTableBody tr[data-agent-id]')];
        if (!rows.length) return;
        let n = 0;
        rows.forEach((tr) => {
            const id = tr.dataset.agentId;
            if (!seenAgents.has(id)) {
                if (firstRows || seenAgents.size) {
                    tr.style.setProperty('--r', n++);
                    tr.classList.add('ios-row');
                }
                seenAgents.add(id);
            }
        });
        firstRows = false;
    }

    // Números de las tarjetas: cuentan del valor anterior al nuevo
    const countingNow = new WeakSet();
    function countTo(el, from, to) {
        if (from === to || reduce.matches) return;
        countingNow.add(el);
        const start = performance.now(), dur = 700;
        (function frame(now) {
            const t = clamp((now - start) / dur);
            const e = 1 - Math.pow(1 - t, 3);
            el.textContent = Math.round(from + (to - from) * e);
            if (t < 1) requestAnimationFrame(frame);
            else {
                el.textContent = to;
                // El observer recibe el último cambio después; se suelta en el siguiente frame
                requestAnimationFrame(() => countingNow.delete(el));
            }
        })(start);
    }
    function watchStats() {
        document.querySelectorAll('.stat-value').forEach((el) => {
            let shown = parseInt(el.textContent, 10) || 0;
            new MutationObserver(() => {
                if (countingNow.has(el)) return;
                const next = parseInt(el.textContent, 10);
                if (isNaN(next) || next === shown) return;
                const prev = shown;
                shown = next;
                el.textContent = prev;
                countTo(el, prev, next);
            }).observe(el, { childList: true, characterData: true, subtree: true });
        });
    }

    const tbody = document.getElementById('agentsTableBody');
    if (tbody) new MutationObserver(animateRows).observe(tbody, { childList: true });

    function initEntrance() {
        pageEntrance();
        watchStats();
        animateRows();
    }

    function initIOS() {
        prepareMenus();
        initEntrance();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initIOS);
    else initIOS();
})();

// ============================================================================
// iOS PICKERS — selector de hora (ruedas) y de fecha (calendario) con resortes
// Mismo diseño y animación que Mi Negocio, empaquetado para usarse en
// cualquier página (modal de onboarding en Mis Agentes, Dashboard, etc.).
//
// - El <input type="time|date"> original se queda en el DOM (oculto) y sigue
//   guardando el valor HH:MM / AAAA-MM-DD, así que la lógica que lo lee no cambia.
// - Si otro script escribe input.value o input.disabled, el picker se actualiza.
// - Los popovers van en <body> con position:fixed para que no los recorte
//   el overflow de .content-card ni el scroll del modal.
// - Clases con prefijo iosp- para no chocar con onboarding.css.
//
// Se aplica solo a:
//   .schedule-day input.time-input, input[data-ios-time]
//   input.holiday-date, input[data-ios-date]
// API: window.IOSPickers.enhance(root)
// ============================================================================
(function () {
    if (window.IOSPickers) return;

    const TIME_SEL = '.schedule-day input.time-input, input[data-ios-time]';
    const DATE_SEL = 'input.holiday-date, input[data-ios-date]';
    const ITEM_H = 36;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
    const lerp = (a, b, t) => a + (b - a) * t;
    const SUPPORTS_LINEAR = window.CSS && CSS.supports('animation-timing-function', 'linear(0, 1)');
    const SPRING = SUPPORTS_LINEAR
        ? 'linear(0, 0.04, 0.139, 0.271, 0.416, 0.56, 0.691, 0.805, 0.897, 0.969, 1.021, 1.055, 1.074, 1.082, 1.081, 1.075, 1.065, 1.053, 1.041, 1.03, 1.02, 1.011, 1.005, 1, 0.996, 0.994, 0.993, 0.993, 0.994, 0.994, 0.995, 0.996, 0.997, 0.998, 0.999, 0.999, 1, 1, 1, 1.001, 1.001, 1.001, 1.001, 1, 1, 1, 1, 1, 1)'
        : 'cubic-bezier(0.34, 1.35, 0.64, 1)';

    const tr = (key, fallback) => (typeof window.t === 'function' ? window.t(key, fallback) : fallback);

    // ------------------------------------------------------------------------
    // Motor de resortes
    // ------------------------------------------------------------------------
    const springs = [];
    const renderers = new Set();
    function spring(v = 0, k = 380, d = 30, eps = 0.1) {
        const s = { v, vel: 0, t: v, k, d, eps };
        springs.push(s);
        return s;
    }
    const atRest = (s) => Math.abs(s.v - s.t) < s.eps && Math.abs(s.vel) < s.eps * 5;
    let raf = 0, last = 0;
    function tick(now) {
        const dt = Math.min((now - last) / 1000, 1 / 30);
        last = now;
        springs.forEach((s) => {
            if (reduce.matches) { s.v = s.t; s.vel = 0; return; }
            s.vel += (-s.k * (s.v - s.t) - s.d * s.vel) * dt;
            s.v += s.vel * dt;
        });
        renderers.forEach((r) => r());
        if (springs.every(atRest)) {
            springs.forEach((s) => { s.v = s.t; s.vel = 0; });
            renderers.forEach((r) => r());
            raf = 0;
            return;
        }
        raf = requestAnimationFrame(tick);
    }
    function kick() {
        if (raf) return;
        last = performance.now();
        raf = requestAnimationFrame(tick);
    }

    // ------------------------------------------------------------------------
    // Input nativo: escribir sin disparar el setter interceptado y vigilar
    // cambios de value/disabled hechos por otros scripts.
    // ------------------------------------------------------------------------
    const VALUE = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    const DISABLED = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'disabled');

    function watchNative(input, onChange) {
        Object.defineProperty(input, 'value', {
            configurable: true,
            get() { return VALUE.get.call(this); },
            set(v) { VALUE.set.call(this, v); onChange(); },
        });
        Object.defineProperty(input, 'disabled', {
            configurable: true,
            get() { return DISABLED.get.call(this); },
            set(v) { DISABLED.set.call(this, v); onChange(); },
        });
        new MutationObserver(onChange).observe(input, { attributes: true, attributeFilter: ['disabled', 'value'] });
    }

    function writeNative(input, v) {
        VALUE.set.call(input, v);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // ------------------------------------------------------------------------
    // Popover compartido: crece desde el campo con un recorte animado
    // ------------------------------------------------------------------------
    const popovers = new Set();

    function createPopover(className) {
        const pop = document.createElement('div');
        pop.className = `iosp-pop ${className}`;
        pop.setAttribute('role', 'dialog');
        pop.style.visibility = 'hidden';
        pop.style.clipPath = 'inset(50% 50% 50% 50%)';
        document.body.appendChild(pop);

        const P = spring(0, 380, 28, 0.001);
        const state = { open: false, anchor: null, onClose: null };

        function place() {
            const a = state.anchor;
            if (!a || !a.isConnected) return;
            const r = a.getBoundingClientRect();
            const w = pop.offsetWidth, h = pop.offsetHeight;
            const gap = 8, vw = window.innerWidth, vh = window.innerHeight;
            let top = r.bottom + gap;
            if (top + h > vh - gap && r.top - gap - h > gap) top = r.top - gap - h;
            const left = clamp(r.left, gap, Math.max(gap, vw - w - gap));
            pop.style.top = `${Math.round(top)}px`;
            pop.style.left = `${Math.round(left)}px`;
        }

        function render() {
            const p = P.v, pc = clamp(p);
            if (p < 0.002 && P.t === 0) {
                pop.style.visibility = 'hidden';
                pop.style.clipPath = 'inset(50% 50% 50% 50%)';
                return;
            }
            pop.style.visibility = 'visible';
            pop.style.setProperty('--iosp-p', pc.toFixed(3));
            if (state.open && atRest(P)) { pop.style.clipPath = 'none'; return; }
            const a = state.anchor && state.anchor.isConnected ? state.anchor.getBoundingClientRect() : null;
            const m = pop.getBoundingClientRect();
            if (!a) { pop.style.clipPath = `inset(0 round 20px)`; pop.style.opacity = pc; return; }
            const W = m.width, H = m.height;
            const t = clamp(a.top - m.top, 0, H), b = clamp(m.bottom - a.bottom, 0, H);
            const l = clamp(a.left - m.left, 0, W), r = clamp(m.right - a.right, 0, W);
            pop.style.clipPath = `inset(${lerp(t, 0, p)}px ${lerp(r, 0, p)}px ${lerp(b, 0, p)}px ${lerp(l, 0, p)}px round ${lerp(a.height / 2, 20, pc)}px)`;
        }
        renderers.add(render);

        const api = {
            el: pop,
            get open() { return state.open; },
            get anchor() { return state.anchor; },
            show(anchor, onClose) {
                popovers.forEach((o) => o !== api && o.hide());
                if (state.open && state.anchor !== anchor) state.onClose && state.onClose();
                state.anchor = anchor;
                state.onClose = onClose;
                state.open = true;
                place();
                P.t = 1;
                render();
                kick();
            },
            hide() {
                if (!state.open) return;
                state.open = false;
                const cb = state.onClose;
                state.onClose = null;
                P.t = 0;
                render();
                kick();
                cb && cb();
            },
            place,
            contains: (n) => pop.contains(n) || (state.anchor && state.anchor.contains(n)),
        };
        popovers.add(api);
        return api;
    }

    document.addEventListener('pointerdown', (e) => {
        popovers.forEach((p) => { if (p.open && !p.contains(e.target)) p.hide(); });
    }, true);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') popovers.forEach((p) => p.hide());
    });
    function reposition(e) {
        popovers.forEach((p) => {
            if (!p.open) return;
            if (e && e.target && p.el.contains(e.target)) return;   // scroll de las ruedas
            const a = p.anchor;
            if (!a || !a.isConnected) { p.hide(); return; }
            const r = a.getBoundingClientRect();
            if (r.bottom < 0 || r.top > window.innerHeight) { p.hide(); return; }
            p.place();
        });
    }
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);

    // ========================================================================
    // SELECTOR DE HORA — tres ruedas (Hora | Min | Periodo)
    // ========================================================================
    const HOURS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
    const BASE_MINUTES = ['00', '15', '30', '45'];
    const PERIODS = ['AM', 'PM'];

    function to12(v) {
        const m = /^(\d{1,2}):(\d{2})/.exec(v || '');
        if (!m) return null;
        const h = +m[1];
        return { h: String(h % 12 === 0 ? 12 : h % 12).padStart(2, '0'), m: m[2], p: h >= 12 ? 'PM' : 'AM' };
    }
    function to24(h, m, p) {
        let x = parseInt(h, 10);
        if (p === 'AM' && x === 12) x = 0;
        if (p === 'PM' && x !== 12) x += 12;
        return `${String(x).padStart(2, '0')}:${m}`;
    }

    let timePop = null;
    let timeTarget = null;   // { input, trigger, refresh }
    const wheels = {};

    function buildTimePop() {
        timePop = createPopover('iosp-time-pop');
        timePop.el.innerHTML = `
            <div class="iosp-time-cols">
                <div class="iosp-time-col"><div class="iosp-time-title">${tr('onb_time_hour', 'Hora')}</div><div class="iosp-wheel" data-k="h"></div></div>
                <div class="iosp-time-col"><div class="iosp-time-title">${tr('onb_time_min', 'Min')}</div><div class="iosp-wheel" data-k="m"></div></div>
                <div class="iosp-time-col"><div class="iosp-time-title">${tr('onb_time_period', 'Periodo')}</div><div class="iosp-wheel" data-k="p"></div></div>
            </div>`;
        timePop.el.querySelectorAll('.iosp-wheel').forEach((scroll) => {
            const k = scroll.dataset.k;
            const w = wheels[k] = { scroll, items: [], value: null, timer: null, syncing: false };

            w.setItems = (list) => {
                if (w.items.join() === list.join()) return;
                w.items = list.slice();
                scroll.innerHTML = list.map((v) => `<div class="iosp-opt" data-v="${v}">${v}</div>`).join('');
            };
            w.paint = () => {
                const st = scroll.scrollTop;
                [...scroll.children].forEach((o, i) => {
                    const dd = (i * ITEM_H - st) / ITEM_H;
                    if (Math.abs(dd) > 4) { o.style.opacity = 0; return; }
                    o.style.transform = `perspective(320px) rotateX(${-dd * 22}deg)`;
                    o.style.opacity = Math.max(0.28, 1 - Math.abs(dd) * 0.3);
                    o.classList.toggle('is-sel', Math.abs(dd) < 0.5);
                });
            };
            w.sync = (v) => {
                w.value = v;
                w.syncing = true;
                const i = Math.max(0, w.items.indexOf(v));
                scroll.scrollTop = i * ITEM_H;
                w.paint();
                requestAnimationFrame(() => requestAnimationFrame(() => { w.syncing = false; }));
            };
            const settle = () => {
                if (w.syncing) return;
                const i = clamp(Math.round(scroll.scrollTop / ITEM_H), 0, w.items.length - 1);
                const v = w.items[i];
                if (v === undefined || v === w.value) return;
                w.value = v;
                if (navigator.vibrate) { try { navigator.vibrate(4); } catch (e) { /* sin vibración */ } }
                commitTime();
            };
            scroll.addEventListener('scroll', () => {
                w.paint();
                clearTimeout(w.timer);
                w.timer = setTimeout(settle, 110);
            }, { passive: true });
            scroll.addEventListener('click', (e) => {
                const o = e.target.closest('.iosp-opt');
                if (!o) return;
                const i = [...scroll.children].indexOf(o);
                scroll.scrollTo({ top: i * ITEM_H, behavior: reduce.matches ? 'auto' : 'smooth' });
            });
        });
    }

    function commitTime() {
        if (!timeTarget) return;
        const v = to24(wheels.h.value, wheels.m.value, wheels.p.value);
        if (v !== timeTarget.input.value) writeNative(timeTarget.input, v);
        timeTarget.refresh();
    }

    function openTime(target) {
        if (!timePop) buildTimePop();
        if (timePop.open && timeTarget === target) { timePop.hide(); return; }
        timeTarget = target;
        const t = to12(target.input.value) || to12(target.fallback) || { h: '09', m: '00', p: 'AM' };
        const mins = BASE_MINUTES.includes(t.m) ? BASE_MINUTES : [...BASE_MINUTES, t.m].sort();
        wheels.h.setItems(HOURS);
        wheels.m.setItems(mins);
        wheels.p.setItems(PERIODS);
        target.trigger.classList.add('is-open');
        timePop.show(target.trigger, () => {
            target.trigger.classList.remove('is-open');
            if (timeTarget === target) timeTarget = null;
        });
        wheels.h.sync(t.h); wheels.m.sync(t.m); wheels.p.sync(t.p);
    }

    function enhanceTime(input) {
        if (input.dataset.iospDone) return;
        input.dataset.iospDone = '1';
        const fallback = input.getAttribute('value') || '09:00';

        const wrap = document.createElement('div');
        wrap.className = 'iosp-time';
        input.parentNode.insertBefore(wrap, input);
        wrap.innerHTML = `
            <button type="button" class="iosp-trigger" aria-haspopup="dialog">
                <span class="iosp-value"></span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
            </button>`;
        wrap.appendChild(input);
        input.classList.add('iosp-native');
        input.tabIndex = -1;

        const trigger = wrap.querySelector('.iosp-trigger');
        const valueEl = wrap.querySelector('.iosp-value');
        const target = {
            input, trigger, fallback,
            refresh() {
                const t = to12(input.value);
                valueEl.textContent = t ? `${t.h}:${t.m} ${t.p}` : '--:--';
                trigger.disabled = input.disabled;
                wrap.classList.toggle('is-disabled', input.disabled);
                if (input.disabled && timeTarget === target) timePop.hide();
            },
        };
        trigger.addEventListener('click', () => { if (!input.disabled) openTime(target); });
        watchNative(input, () => target.refresh());
        target.refresh();
    }

    // ========================================================================
    // SELECTOR DE FECHA — calendario con cápsula que salta al día elegido
    // ========================================================================
    const LOCALE = (document.documentElement.lang || 'es').toLowerCase();
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

    let datePop = null, dateTarget = null, view = new Date();
    let grid, titleEl, selEl;
    const SX = spring(0, 520, 34), SY = spring(0, 520, 34), SS = spring(0, 600, 30, 0.001);

    function buildDatePop() {
        datePop = createPopover('iosp-date-pop');
        datePop.el.innerHTML = `
            <div class="iosp-date-head">
                <span class="iosp-date-title"></span>
                <button type="button" class="iosp-date-nav" data-step="-1" aria-label="${tr('onb_prev_month', 'Mes anterior')}">${CHEV('M15 18l-6-6 6-6')}</button>
                <button type="button" class="iosp-date-nav" data-step="1" aria-label="${tr('onb_next_month', 'Mes siguiente')}">${CHEV('M9 18l6-6-6-6')}</button>
            </div>
            <div class="iosp-date-week">${WEEK.map((w) => `<span>${w}</span>`).join('')}</div>
            <div class="iosp-date-grid"><span class="iosp-date-sel" aria-hidden="true"></span></div>
            <div class="iosp-date-foot">
                <button type="button" class="iosp-date-clear">${tr('onb_date_clear', 'Borrar')}</button>
                <button type="button" class="iosp-date-today">${tr('onb_date_today', 'Hoy')}</button>
            </div>`;
        grid = datePop.el.querySelector('.iosp-date-grid');
        titleEl = datePop.el.querySelector('.iosp-date-title');
        selEl = datePop.el.querySelector('.iosp-date-sel');

        renderers.add(() => {
            selEl.style.opacity = clamp(SS.v);
            selEl.style.transform = `translate(${SX.v}px, ${SY.v}px) scale(${Math.max(0, SS.v)})`;
        });

        datePop.el.querySelectorAll('.iosp-date-nav').forEach((b) => b.addEventListener('click', () => stepMonth(+b.dataset.step)));
        grid.addEventListener('click', (e) => {
            const b = e.target.closest('.iosp-date-day[data-iso]');
            if (!b || b.disabled) return;
            grid.querySelectorAll('.is-selected').forEach((x) => x.classList.remove('is-selected'));
            b.classList.add('is-selected');
            placeSel(false);
            setDate(b.dataset.iso);
            setTimeout(() => datePop.hide(), 260);   // deja ver el cambio antes de cerrar
        });
        datePop.el.querySelector('.iosp-date-today').addEventListener('click', () => {
            const t = new Date();
            view = new Date(t.getFullYear(), t.getMonth(), 1);
            setDate(toISO(t));
            buildMonth(0);
            setTimeout(() => datePop.hide(), 260);
        });
        datePop.el.querySelector('.iosp-date-clear').addEventListener('click', () => { setDate(''); datePop.hide(); });

        // Deslizar a los lados cambia de mes
        let sx = null;
        grid.addEventListener('pointerdown', (e) => { sx = e.clientX; });
        grid.addEventListener('pointerup', (e) => {
            if (sx === null) return;
            const dx = e.clientX - sx; sx = null;
            if (Math.abs(dx) > 45) stepMonth(dx < 0 ? 1 : -1);
        });
    }

    function buildMonth(dir) {
        const tt = fmtTitle.format(view);
        titleEl.textContent = tt.charAt(0).toUpperCase() + tt.slice(1);
        grid.querySelectorAll('.iosp-date-day').forEach((b) => b.remove());
        const first = new Date(view.getFullYear(), view.getMonth(), 1);
        const lead = (first.getDay() + 6) % 7;   // semana inicia en lunes
        const days = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
        const todayISO = toISO(new Date());
        const selISO = dateTarget ? dateTarget.input.value : '';
        const frag = document.createDocumentFragment();
        for (let i = 0; i < lead; i++) {
            const s = document.createElement('span');
            s.className = 'iosp-date-day is-pad';
            frag.appendChild(s);
        }
        for (let d = 1; d <= days; d++) {
            const iso = toISO(new Date(view.getFullYear(), view.getMonth(), d));
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'iosp-date-day';
            b.textContent = d;
            b.dataset.iso = iso;
            if (iso === todayISO) b.classList.add('is-today');
            if (iso === selISO) b.classList.add('is-selected');
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
        const b = grid.querySelector('.iosp-date-day.is-selected');
        if (!b) { SS.t = 0; if (snap) SS.v = 0; kick(); return; }
        SX.t = b.offsetLeft; SY.t = b.offsetTop; SS.t = 1;
        if (snap || SS.v < 0.05) { SX.v = SX.t; SY.v = SY.t; SX.vel = SY.vel = 0; }
        if (snap && SS.v < 0.05) SS.v = 0.4;   // pequeño "pop" al aparecer
        kick();
    }

    function stepMonth(dir) {
        view = new Date(view.getFullYear(), view.getMonth() + dir, 1);
        buildMonth(dir);
    }

    function setDate(iso) {
        if (!dateTarget) return;
        writeNative(dateTarget.input, iso);
        dateTarget.refresh();
    }

    function openDate(target) {
        if (!datePop) buildDatePop();
        if (datePop.open && dateTarget === target) { datePop.hide(); return; }
        dateTarget = target;
        const d = fromISO(target.input.value) || new Date();
        view = new Date(d.getFullYear(), d.getMonth(), 1);
        buildMonth(0);
        target.wrap.classList.add('is-open');
        datePop.show(target.trigger, () => {
            target.wrap.classList.remove('is-open');
            if (dateTarget === target) dateTarget = null;
        });
    }

    function enhanceDate(input) {
        if (input.dataset.iospDone) return;
        input.dataset.iospDone = '1';

        const wrap = document.createElement('div');
        wrap.className = 'iosp-date';
        input.parentNode.insertBefore(wrap, input);
        wrap.innerHTML = `
            <button type="button" class="iosp-trigger iosp-date-trigger" aria-haspopup="dialog">
                ${CAL_ICON}<span class="iosp-value"></span>
            </button>`;
        wrap.appendChild(input);
        input.classList.add('iosp-native');
        input.tabIndex = -1;

        const trigger = wrap.querySelector('.iosp-trigger');
        const valueEl = wrap.querySelector('.iosp-value');
        const placeholder = input.dataset.placeholder || tr('onb_date_placeholder', 'Seleccionar fecha');
        const target = {
            input, trigger, wrap,
            refresh() {
                const d = fromISO(input.value);
                valueEl.textContent = d ? fmtValue.format(d) : placeholder;
                trigger.classList.toggle('is-empty', !d);
                trigger.disabled = input.disabled;
                if (input.disabled && dateTarget === target) datePop.hide();
            },
        };
        trigger.addEventListener('click', () => { if (!input.disabled) openDate(target); });
        watchNative(input, () => target.refresh());
        target.refresh();
    }

    // ------------------------------------------------------------------------
    // Arranque: inputs actuales + los que se agreguen después (modal, filas nuevas)
    // ------------------------------------------------------------------------
    function enhance(root = document) {
        if (!root || !root.querySelectorAll) return;
        root.querySelectorAll(TIME_SEL).forEach(enhanceTime);
        root.querySelectorAll(DATE_SEL).forEach(enhanceDate);
    }

    let pending = false;
    function schedule() {
        if (pending) return;
        pending = true;
        requestAnimationFrame(() => { pending = false; enhance(document); });
    }

    function start() {
        enhance(document);
        new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    }

    window.IOSPickers = { enhance };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();