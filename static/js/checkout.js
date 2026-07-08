// ============================================
// CHECKOUT JAVASCRIPT - INTEGRACIÓN STRIPE REAL CON PRECIOS DINÁMICOS
// ============================================

let STRIPE_PUBLISHABLE_KEY = '';
let plansData = null;
let selectedPlanData = null;
let currentBillingPeriod = 'monthly';
let currentSelectedCountry = 'MX';

// ============================================
// i18n — helper de traducción para textos generados por JS
// (alerts, mensajes de error, cupón) usando el diccionario de translations.js
// ============================================
function getCheckoutLang() {
    return localStorage.getItem('attomos_lang') || localStorage.getItem('lang') || 'es';
}

function t(key, fallback) {
    const lang = getCheckoutLang();
    const dict = window.Translations && window.Translations.dict;
    return (dict && dict[lang] && dict[lang][key]) || fallback;
}

// Nombre/features de cada plan, traducidos — mismo criterio usado en plans.js
// (Protón/Neutron se mantienen en latino salvo en español, igual que en /plans)
const CHECKOUT_PLAN_I18N = (function () {
    const F = {
        es: { wa1: '1 agente de WhatsApp', waweb: 'WhatsApp Web (escaneo QR)', spei: 'Pasarela de pagos SPEI', card: 'Pasarela de pagos con tarjeta', gemini: 'IA con Gemini', gsheets: 'Google Sheets', gcal: 'Google Calendar', hours: 'Horarios personalizados de atención', catSvc: 'Catálogo de servicios', promoSvc: 'Promociones de servicios', photos: 'Subida de fotos a servicios', promoPeriods: 'Periodos de promocion', multiBranch: 'Multi Sucursal', jobs: 'Ofertas de trabajo (Próximamente)', agentsUnl: 'Agentes ilimitados', metaApi: 'Meta WhatsApp Business API', contactsUnl: 'Contactos ilimitados', msgsUnl: 'Mensajes ilimitados', chatwoot: 'Chatwoot CRM', catProd: 'Catálogo de productos', promoPacks: 'Promociones y packs', inventory: 'Sistema de inventario', pos: 'Punto de venta (POS)' },
        en: { wa1: '1 WhatsApp agent', waweb: 'WhatsApp Web (QR scan)', spei: 'SPEI payment gateway', card: 'Card payment gateway', gemini: 'AI with Gemini', gsheets: 'Google Sheets', gcal: 'Google Calendar', hours: 'Customized business hours', catSvc: 'Services catalog', promoSvc: 'Service promotions', photos: 'Photo uploads for services', promoPeriods: 'Promotion periods', multiBranch: 'Multi-branch', jobs: 'Job listings (Coming soon)', agentsUnl: 'Unlimited agents', metaApi: 'Meta WhatsApp Business API', contactsUnl: 'Unlimited contacts', msgsUnl: 'Unlimited messages', chatwoot: 'Chatwoot CRM', catProd: 'Product catalog', promoPacks: 'Promotions and bundles', inventory: 'Inventory system', pos: 'Point of sale (POS)' },
        ru: { wa1: '1 агент WhatsApp', waweb: 'WhatsApp Web (сканирование QR)', spei: 'Платёжный шлюз SPEI', card: 'Платёжный шлюз для карт', gemini: 'ИИ на базе Gemini', gsheets: 'Google Sheets', gcal: 'Google Calendar', hours: 'Индивидуальный график работы', catSvc: 'Каталог услуг', promoSvc: 'Акции на услуги', photos: 'Загрузка фото к услугам', promoPeriods: 'Периоды акций', multiBranch: 'Мультифилиал', jobs: 'Вакансии (Скоро)', agentsUnl: 'Неограниченное количество агентов', metaApi: 'Meta WhatsApp Business API', contactsUnl: 'Неограниченное количество контактов', msgsUnl: 'Неограниченные сообщения', chatwoot: 'Chatwoot CRM', catProd: 'Каталог товаров', promoPacks: 'Акции и наборы', inventory: 'Система инвентаризации', pos: 'Точка продаж (POS)' },
        uz: { wa1: "1 ta WhatsApp agenti", waweb: 'WhatsApp Web (QR skanerlash)', spei: "SPEI to'lov shlyuzi", card: "Karta orqali to'lov shlyuzi", gemini: 'Gemini bilan AI', gsheets: 'Google Sheets', gcal: 'Google Calendar', hours: 'Shaxsiylashtirilgan ish vaqti', catSvc: 'Xizmatlar katalogi', promoSvc: 'Xizmatlar aksiyalari', photos: 'Xizmatlarga rasm yuklash', promoPeriods: 'Aksiya davrlari', multiBranch: "Ko'p filial", jobs: 'Ish takliflari (Tez orada)', agentsUnl: 'Cheksiz agentlar', metaApi: 'Meta WhatsApp Business API', contactsUnl: 'Cheksiz kontaktlar', msgsUnl: 'Cheksiz xabarlar', chatwoot: 'Chatwoot CRM', catProd: 'Mahsulotlar katalogi', promoPacks: 'Aksiyalar va paketlar', inventory: 'Ombor tizimi', pos: 'Savdo nuqtasi (POS)' },
        ja: { wa1: 'WhatsAppエージェント1つ', waweb: 'WhatsApp Web（QRスキャン）', spei: 'SPEI決済ゲートウェイ', card: 'カード決済ゲートウェイ', gemini: 'Gemini搭載AI', gsheets: 'Google Sheets', gcal: 'Google カレンダー', hours: 'カスタム営業時間', catSvc: 'サービスカタログ', promoSvc: 'サービスプロモーション', photos: 'サービスへの写真アップロード', promoPeriods: 'プロモーション期間', multiBranch: 'マルチ支店', jobs: '求人情報（近日公開）', agentsUnl: '無制限のエージェント', metaApi: 'Meta WhatsApp Business API', contactsUnl: '無制限の連絡先', msgsUnl: '無制限のメッセージ', chatwoot: 'Chatwoot CRM', catProd: '商品カタログ', promoPacks: 'プロモーションとパック', inventory: '在庫管理システム', pos: 'POSレジ' },
        zh: { wa1: '1个WhatsApp坐席', waweb: 'WhatsApp网页版（扫描二维码）', spei: 'SPEI支付网关', card: '银行卡支付网关', gemini: '由Gemini提供的AI', gsheets: 'Google Sheets', gcal: 'Google 日历', hours: '自定义营业时间', catSvc: '服务目录', promoSvc: '服务促销', photos: '为服务上传照片', promoPeriods: '促销时段', multiBranch: '多分店', jobs: '招聘信息（即将推出）', agentsUnl: '无限坐席', metaApi: 'Meta WhatsApp Business API', contactsUnl: '无限联系人', msgsUnl: '无限消息', chatwoot: 'Chatwoot CRM', catProd: '产品目录', promoPacks: '促销与套装', inventory: '库存系统', pos: '销售点（POS）' },
        fr: { wa1: '1 agent WhatsApp', waweb: 'WhatsApp Web (scan QR)', spei: 'Passerelle de paiement SPEI', card: 'Passerelle de paiement par carte', gemini: 'IA avec Gemini', gsheets: 'Google Sheets', gcal: 'Google Agenda', hours: "Horaires d'ouverture personnalisés", catSvc: 'Catalogue de services', promoSvc: 'Promotions de services', photos: 'Téléchargement de photos pour les services', promoPeriods: 'Périodes de promotion', multiBranch: 'Multi-succursales', jobs: "Offres d'emploi (Bientôt disponible)", agentsUnl: 'Agents illimités', metaApi: 'Meta WhatsApp Business API', contactsUnl: 'Contacts illimités', msgsUnl: 'Messages illimités', chatwoot: 'Chatwoot CRM', catProd: 'Catalogue de produits', promoPacks: 'Promotions et forfaits', inventory: "Système d'inventaire", pos: 'Point de vente (POS)' },
        pt: { wa1: '1 agente de WhatsApp', waweb: 'WhatsApp Web (escaneamento de QR)', spei: 'Gateway de pagamento SPEI', card: 'Gateway de pagamento com cartão', gemini: 'IA com Gemini', gsheets: 'Google Sheets', gcal: 'Google Agenda', hours: 'Horários de atendimento personalizados', catSvc: 'Catálogo de serviços', promoSvc: 'Promoções de serviços', photos: 'Upload de fotos nos serviços', promoPeriods: 'Períodos de promoção', multiBranch: 'Multi Filial', jobs: 'Vagas de emprego (Em breve)', agentsUnl: 'Agentes ilimitados', metaApi: 'Meta WhatsApp Business API', contactsUnl: 'Contatos ilimitados', msgsUnl: 'Mensagens ilimitadas', chatwoot: 'Chatwoot CRM', catProd: 'Catálogo de produtos', promoPacks: 'Promoções e pacotes', inventory: 'Sistema de inventário', pos: 'Ponto de venda (PDV)' },
        de: { wa1: '1 WhatsApp-Agent', waweb: 'WhatsApp Web (QR-Scan)', spei: 'SPEI-Zahlungsgateway', card: 'Zahlungsgateway für Kartenzahlungen', gemini: 'KI mit Gemini', gsheets: 'Google Sheets', gcal: 'Google Kalender', hours: 'Individuelle Öffnungszeiten', catSvc: 'Dienstleistungskatalog', promoSvc: 'Aktionen für Dienstleistungen', photos: 'Fotos zu Dienstleistungen hochladen', promoPeriods: 'Aktionszeiträume', multiBranch: 'Mehrere Filialen', jobs: 'Stellenangebote (Demnächst)', agentsUnl: 'Unbegrenzte Agenten', metaApi: 'Meta WhatsApp Business API', contactsUnl: 'Unbegrenzte Kontakte', msgsUnl: 'Unbegrenzte Nachrichten', chatwoot: 'Chatwoot CRM', catProd: 'Produktkatalog', promoPacks: 'Aktionen und Pakete', inventory: 'Lagerverwaltungssystem', pos: 'Kassensystem (POS)' },
        ko: { wa1: 'WhatsApp 에이전트 1개', waweb: 'WhatsApp Web (QR 스캔)', spei: 'SPEI 결제 게이트웨이', card: '카드 결제 게이트웨이', gemini: 'Gemini 기반 AI', gsheets: 'Google Sheets', gcal: 'Google 캘린더', hours: '맞춤형 영업시간', catSvc: '서비스 카탈로그', promoSvc: '서비스 프로모션', photos: '서비스 사진 업로드', promoPeriods: '프로모션 기간', multiBranch: '다중 지점', jobs: '채용 정보 (출시 예정)', agentsUnl: '무제한 에이전트', metaApi: 'Meta WhatsApp Business API', contactsUnl: '무제한 연락처', msgsUnl: '무제한 메시지', chatwoot: 'Chatwoot CRM', catProd: '제품 카탈로그', promoPacks: '프로모션 및 패키지', inventory: '재고 관리 시스템', pos: '포스(POS) 시스템' },
    };

    const NAMES = {
        es: { gratuito: 'Gratuito', proton: 'Protón', neutron: 'Neutrón' },
        en: { gratuito: 'Free', proton: 'Proton', neutron: 'Neutron' },
        ru: { gratuito: 'Бесплатно', proton: 'Proton', neutron: 'Neutron' },
        uz: { gratuito: 'Bepul', proton: 'Proton', neutron: 'Neutron' },
        ja: { gratuito: '無料', proton: 'Proton', neutron: 'Neutron' },
        zh: { gratuito: '免费', proton: 'Proton', neutron: 'Neutron' },
        fr: { gratuito: 'Gratuit', proton: 'Proton', neutron: 'Neutron' },
        pt: { gratuito: 'Grátis', proton: 'Proton', neutron: 'Neutron' },
        de: { gratuito: 'Kostenlos', proton: 'Proton', neutron: 'Neutron' },
        ko: { gratuito: '무료', proton: 'Proton', neutron: 'Neutron' },
    };

    function features(lang, planId) {
        const f = F[lang] || F.es;
        if (planId === 'gratuito') return [f.wa1, f.waweb, f.spei, f.card, f.gemini, f.gsheets, f.gcal, f.hours, f.catSvc, f.promoSvc, f.photos, f.promoSvc, f.promoPeriods, f.multiBranch, f.jobs];
        if (planId === 'proton') return [f.agentsUnl, f.metaApi, f.contactsUnl, f.msgsUnl, f.gemini, f.chatwoot, f.gsheets, f.gcal, f.hours, f.catSvc, f.promoSvc, f.jobs];
        if (planId === 'neutron') return [f.agentsUnl, f.metaApi, f.contactsUnl, f.msgsUnl, f.chatwoot, f.gemini, f.gsheets, f.catProd, f.promoPacks, f.inventory, f.pos, f.jobs];
        return null;
    }

    function getDisplayName(lang, planId) {
        const names = NAMES[lang] || NAMES.es;
        return names[planId] || null;
    }

    return { features, getDisplayName };
})();

// Re-traduce nombre/período/features del plan seleccionado cuando cambia el idioma
function applyCheckoutDynamicTranslations(lang) {
    if (!selectedPlanData) return;

    const planNameElement = document.getElementById('selectedPlanName');
    if (planNameElement) {
        const displayName = CHECKOUT_PLAN_I18N.getDisplayName(lang, selectedPlanData.id);
        planNameElement.textContent = displayName || selectedPlanData.displayName || selectedPlanData.name;
    }

    const billingPeriodElement = document.getElementById('billingPeriod');
    if (billingPeriodElement) {
        const dict = window.Translations && window.Translations.dict && window.Translations.dict[lang];
        billingPeriodElement.textContent = currentBillingPeriod === 'annual'
            ? (dict && dict.plans_toggle_annual) || 'Anual'
            : (dict && dict.plans_toggle_monthly) || 'Mensual';
    }

    const translatedFeatures = CHECKOUT_PLAN_I18N.features(lang, selectedPlanData.id);
    if (translatedFeatures) {
        const featuresList = document.getElementById('planFeatures');
        if (featuresList) {
            featuresList.innerHTML = translatedFeatures.map(feature => `
                <li>
                    <i class="lni lni-checkmark-circle"></i>
                    <span>${feature}</span>
                </li>
            `).join('');
        }
    }
}

document.addEventListener('attomos:langchange', function (e) {
    applyCheckoutDynamicTranslations(e.detail.lang);
    updateCountryInputLanguage();
    // El loop genérico de data-translate acaba de resetear los hints de
    // teléfono/CP al ejemplo por defecto (MX) — los reaplicamos para el país activo.
    updateFormatExamples(currentSelectedCountry);
    updateStripeElementsLocale(e.detail.lang);
});

// Actualiza el texto del país mostrado en el input (México/Mexico/Мексика...)
// cuando cambia el idioma, manteniendo la bandera y el país seleccionado.
function updateCountryInputLanguage() {
    const selectedOption = document.querySelector('.select-option.selected')
        || document.querySelector('.select-option[data-value="MX"]');
    const selectInput = document.getElementById('country');
    if (!selectedOption || !selectInput) return;

    const flag = selectedOption.getAttribute('data-flag');
    const nameSpan = selectedOption.querySelector('span:last-child');
    const name = nameSpan ? nameSpan.textContent : selectedOption.getAttribute('data-name');
    selectInput.value = `${flag} ${name}`;
}

// Mapeo de códigos de país a códigos telefónicos
const COUNTRY_PHONE_CODES = {
    'MX': '+52',
    'US': '+1',
    'CA': '+1',
    'ES': '+34',
    'AR': '+54',
    'CO': '+57',
    'CL': '+56',
    'PE': '+51',
    'RU': '+7',
    'UZ': '+998',
    'JP': '+81',
    'CN': '+86',
    'FR': '+33',
    'PT': '+351',
    'DE': '+49',
    'KR': '+82'
};

// Ejemplos de número telefónico (sin lada) y código postal por país,
// para que el hint en cursiva debajo del campo tenga sentido según el país elegido.
const COUNTRY_FORMAT_EXAMPLES = {
    'MX': { phone: '6621234567', postal: '83000' },
    'US': { phone: '2025551234', postal: '10001' },
    'CA': { phone: '4165551234', postal: 'M5H 2N2' },
    'ES': { phone: '612345678', postal: '28001' },
    'AR': { phone: '91123456789', postal: 'C1002' },
    'CO': { phone: '3001234567', postal: '110111' },
    'CL': { phone: '912345678', postal: '8320000' },
    'PE': { phone: '987654321', postal: '15001' },
    'RU': { phone: '9161234567', postal: '101000' },
    'UZ': { phone: '901234567', postal: '100000' },
    'JP': { phone: '9012345678', postal: '100-0001' },
    'CN': { phone: '13812345678', postal: '100000' },
    'FR': { phone: '612345678', postal: '75001' },
    'PT': { phone: '912345678', postal: '1000-001' },
    'DE': { phone: '15123456789', postal: '10115' },
    'KR': { phone: '1012345678', postal: '03187' }
};

document.addEventListener('DOMContentLoaded', async function() {
    console.log('🛒 Checkout page loaded');
    
    // Cargar clave pública de Stripe desde el backend
    await loadStripePublicKey();
    
    // Cargar datos de planes desde la API
    await loadPlansData();
    
    initLogoAnimation();
    initPaymentMethodToggle();
    initCountryDropdown();
    initStripeElements();
    initFormValidation();
    initPaymentForm();
    
    // Cargar detalles del plan seleccionado (ahora con precios reales)
    loadPlanDetails();
});

// ============================================
// CARGAR DATOS DE PLANES DESDE LA API
// ============================================

async function loadPlansData() {
    try {
        const response = await fetch('/api/plans-data', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (!response.ok || !data.success) {
            throw new Error(t('checkout_err_load_plans', 'Error al cargar los datos de los planes'));
        }
        
        plansData = data.plans;
        console.log('✅ Datos de planes cargados:', plansData);
        
    } catch (error) {
        console.error('❌ Error cargando planes:', error);
        // Si falla, usar precios de respaldo
        plansData = getFallbackPlansData();
    }
}

// ============================================
// DATOS DE RESPALDO SI LA API FALLA
// ============================================

function getFallbackPlansData() {
    return [
        {
            id: 'gratuito',
            name: 'Gratuito',
            displayName: 'Plan Gratuito',
            monthly: { amount: 0, currency: 'MXN' },
            annual: { amount: 0, currency: 'MXN' },
            isFree: true
        },
        {
            id: 'proton',
            name: 'Protón',
            displayName: 'Plan Protón',
            monthly: { amount: 149, currency: 'MXN' },
            annual: { amount: 119, currency: 'MXN' }
        },
        {
            id: 'neutron',
            name: 'Neutrón',
            displayName: 'Plan Neutrón',
            monthly: { amount: 349, currency: 'MXN' },
            annual: { amount: 279, currency: 'MXN' }
        },
        {
            id: 'electron',
            name: 'Electrón',
            displayName: 'Plan Electrón',
            monthly: { amount: 749, currency: 'MXN' },
            annual: { amount: 599, currency: 'MXN' }
        }
    ];
}

// ============================================
// CARGAR CLAVE PÚBLICA DE STRIPE
// ============================================

async function loadStripePublicKey() {
    try {
        const response = await fetch('/api/stripe/public-key', {
            credentials: 'include'
        });
        
        if (response.ok) {
            const data = await response.json();
            STRIPE_PUBLISHABLE_KEY = data.publicKey;
            console.log('✅ Stripe public key loaded');
        } else {
            console.error('❌ Error loading Stripe key');
            alert(t('checkout_err_config_payment', 'Error al configurar el sistema de pagos. Por favor recarga la página.'));
        }
    } catch (error) {
        console.error('❌ Error:', error);
        alert(t('checkout_err_connection', 'Error de conexión. Por favor recarga la página.'));
    }
}

// ============================================
// LOGO ANIMATION - ATTMOS
// ============================================

function initLogoAnimation() {
    const lettering = function(el, optionalArg) {
        const text = el.innerHTML;
        const arg = optionalArg || "char";
        const size = window.getComputedStyle(el).getPropertyValue("font-size").substring(0, 2);
        
        if (el.classList.contains('fallback')) return;
        
        if (el.parentNode.getAttribute('aria-hidden') === null) {
            const clone = el.cloneNode(true);
            clone.classList.add('fallback');
            el.setAttribute('aria-hidden', 'true');
            clone.classList.add('hide');
            el.parentNode.insertBefore(clone, el.nextSibling);
        }
        
        el.innerHTML = "";
        
        if (arg === "char") {
            for (let i = 0; i < text.length; i++) {
                const span = document.createElement("span");
                span.innerHTML = text[i];
                if (text[i] == " ") {
                    span.style.margin = "0 " + (size / 10) + "px";
                }
                span.classList.add("char" + (i + 1));
                el.appendChild(span);
            }
        }
    };

    const h1 = document.querySelector(".logo-container h1");
    if (h1) {
        lettering(h1);

        // Insertar el átomo (SVG) en el flujo de letras, como la "O" de ATT(O)MOS:
        // va entre char3 (segunda T) y char4 (M), dentro de un slot inline.
        const svgEl = document.getElementById('svg');
        const char3 = h1.querySelector('.char3');
        if (svgEl && char3) {
            const slot = document.createElement('span');
            slot.className = 'atom-slot';
            char3.after(slot);
            slot.appendChild(svgEl);
        }
    }

    const ring = document.querySelector("path#ring");
    const path = "M45,145 c-50,-10 -60,-40 10,-35 c95,8 150,50 51,46";
    const base = document.querySelector('circle#base');
    const second = document.querySelector('path#second');
    const third = document.querySelector('path#third');

    if (base) {
        base.setAttribute('cx', 80);
        base.setAttribute('cy', 135);
        base.setAttribute('r', 35);
    }

    if (ring) ring.setAttribute('d', path);
    if (second) second.setAttribute('d', path);
    if (third) third.setAttribute('d', path);

    const animate = function() {
        if (ring) ring.classList.add('animate');
        if (second) second.classList.add('animate');
        if (third) third.classList.add('animate');
    };

    setTimeout(animate, 100);
}

// ============================================
// CUSTOM COUNTRY DROPDOWN
// ============================================

// Ejemplo de teléfono/código postal según país — función global para poder
// re-aplicarla también cuando cambia el idioma (ver listener attomos:langchange)
function updateFormatExamples(countryCode) {
    const example = COUNTRY_FORMAT_EXAMPLES[countryCode] || COUNTRY_FORMAT_EXAMPLES.MX;
    const phoneHint = document.getElementById('phoneHintExample');
    const postalHint = document.getElementById('postalHintExample');
    if (phoneHint) phoneHint.textContent = example.phone;
    if (postalHint) postalHint.textContent = example.postal;
}

function initCountryDropdown() {
    const selectWrapper = document.querySelector('.country-select-wrapper');
    const selectInput = document.getElementById('country');
    const dropdown = document.getElementById('countryDropdown');
    const optionsContainer = document.getElementById('countryOptionsContainer');
    const options = optionsContainer.querySelectorAll('.select-option');
    const phoneCodeInput = document.getElementById('phoneCode');
    const countryCodeInput = document.getElementById('countryCode');
    
    if (!selectWrapper || !selectInput || !dropdown) {
        console.warn('⚠️ Country select elements no encontrados');
        return;
    }

    updatePhoneCode('MX', '+52');
    updateFormatExamples('MX');

    selectInput.addEventListener('click', function(e) {
        e.stopPropagation();
        toggleDropdown();
    });

    options.forEach(option => {
        option.addEventListener('click', function(e) {
            e.stopPropagation();
            selectOption(this);
        });
    });

    document.addEventListener('click', function(e) {
        if (!selectWrapper.contains(e.target)) {
            closeDropdown();
        }
    });

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && selectWrapper.classList.contains('active')) {
            closeDropdown();
        }
    });

    function toggleDropdown() {
        const isActive = selectWrapper.classList.contains('active');
        
        if (isActive) {
            closeDropdown();
        } else {
            openDropdown();
        }
    }

    function openDropdown() {
        selectWrapper.classList.add('active');
        selectInput.classList.add('active');
        
        const visibleOptions = optionsContainer.querySelectorAll('.select-option:not(.hidden)');
        visibleOptions.forEach((option, index) => {
            option.style.animation = 'none';
            setTimeout(() => {
                option.style.animation = '';
            }, 10);
        });

        console.log('🌍 Dropdown de países abierto');
    }

    function closeDropdown() {
        selectWrapper.classList.remove('active');
        selectInput.classList.remove('active');
    }

    function selectOption(option) {
        const value = option.getAttribute('data-value');
        const flag = option.getAttribute('data-flag');
        const code = option.getAttribute('data-code');
        const nameSpan = option.querySelector('span:last-child');
        const name = (nameSpan ? nameSpan.textContent : null) || option.getAttribute('data-name');

        selectInput.value = `${flag} ${name}`;
        
        if (countryCodeInput) {
            countryCodeInput.value = value;
        }

        updatePhoneCode(value, code);
        updateFormatExamples(value);
        currentSelectedCountry = value;

        options.forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');

        clearError(selectInput);
        closeDropdown();
        checkFormCompletion();

        console.log(`✅ País seleccionado: ${name} (${value}) - Código: ${code}`);
    }
    
    function updatePhoneCode(countryCode, manualCode = null) {
        if (phoneCodeInput) {
            const code = manualCode || COUNTRY_PHONE_CODES[countryCode] || '+52';
            phoneCodeInput.value = code;
            console.log(`📱 Código telefónico actualizado: ${code}`);
        }
    }

    console.log('✅ Country dropdown inicializado');
}

// ============================================
// PAYMENT METHOD TOGGLE
// ============================================

function initPaymentMethodToggle() {
    const methodOptions = document.querySelectorAll('.payment-method-option');
    const cardDetails = document.getElementById('cardDetails');
    const paypalDetails = document.getElementById('paypalDetails');

    methodOptions.forEach(option => {
        option.addEventListener('click', function() {
            methodOptions.forEach(opt => opt.classList.remove('active'));
            this.classList.add('active');

            const radio = this.querySelector('input[type="radio"]');
            radio.checked = true;

            if (radio.value === 'card') {
                cardDetails.style.display = 'block';
                paypalDetails.style.display = 'none';
            } else {
                cardDetails.style.display = 'none';
                paypalDetails.style.display = 'block';
            }
        });
    });
}

// ============================================
// STRIPE ELEMENTS INITIALIZATION
// ============================================

let stripe;
let cardElement;
let stripeElementsInstance;
let currentStripeLocale = null;
let cardData = {
    complete: false,
    empty: true
};

// Stripe no soporta 'uz' como locale — usamos 'en' de respaldo para ese caso.
const STRIPE_LOCALE_MAP = {
    es: 'es-419', en: 'en', ru: 'ru', uz: 'en', ja: 'ja',
    zh: 'zh', fr: 'fr', pt: 'pt-BR', de: 'de', ko: 'ko'
};

function getStripeLocale() {
    const lang = getCheckoutLang();
    return STRIPE_LOCALE_MAP[lang] || 'auto';
}

function initStripeElements() {
    if (!STRIPE_PUBLISHABLE_KEY) {
        console.error('❌ Stripe key not loaded yet');
        setTimeout(initStripeElements, 500);
        return;
    }

    if (!stripe) {
        stripe = Stripe(STRIPE_PUBLISHABLE_KEY);
    }

    currentStripeLocale = getStripeLocale();

    const elements = stripe.elements({
        locale: currentStripeLocale,
        appearance: {
            theme: 'stripe',
            variables: {
                colorPrimary: '#06b6d4',
                colorBackground: '#ffffff',
                colorText: '#1a1a1a',
                colorDanger: '#ef4444',
                fontFamily: 'Inter, sans-serif',
                spacingUnit: '4px',
                borderRadius: '10px'
            }
        }
    });
    stripeElementsInstance = elements;

    cardElement = elements.create('card', {
        style: {
            base: {
                fontSize: '16px',
                color: '#1a1a1a',
                fontFamily: 'Inter, sans-serif',
                '::placeholder': {
                    color: '#9ca3af'
                }
            },
            invalid: {
                color: '#ef4444'
            }
        }
    });

    cardElement.mount('#card-element');

    const stripeContainer = document.getElementById('stripe-container');
    const errorElement = document.getElementById('card-errors');

    cardElement.on('focus', () => {
        stripeContainer.classList.add('focused');
        stripeContainer.classList.remove('error');
    });

    cardElement.on('blur', () => {
        stripeContainer.classList.remove('focused');
    });

    cardElement.on('change', (event) => {
        cardData.complete = event.complete || false;
        cardData.empty = event.empty !== false;

        if (event.error) {
            errorElement.innerHTML = `<i class="lni lni-warning"></i> ${event.error.message}`;
            errorElement.classList.add('active');
            stripeContainer.classList.add('error');
        } else {
            errorElement.textContent = '';
            errorElement.classList.remove('active');
            stripeContainer.classList.remove('error');
        }

        checkFormCompletion();
    });

    console.log('✅ Stripe Elements initialized');
}

// Cambia el idioma del placeholder/textos de Stripe Elements ("Número de tarjeta", etc.)
// Stripe solo permite fijar el locale al crear elements(), así que si cambió,
// desmontamos y recreamos el campo de tarjeta con el nuevo locale.
function updateStripeElementsLocale(lang) {
    const newLocale = getStripeLocale();
    if (!stripe || newLocale === currentStripeLocale) return;

    try {
        if (cardElement) {
            cardElement.unmount();
            cardElement.destroy();
        }
    } catch (e) {
        console.warn('⚠️ No se pudo desmontar el card element anterior:', e);
    }

    initStripeElements();
}

// ============================================
// FORM VALIDATION
// ============================================

function initFormValidation() {
    const inputs = document.querySelectorAll('.form-input, .form-select');

    inputs.forEach(input => {
        input.addEventListener('blur', function() {
            if (this.hasAttribute('required')) {
                validateInput(this);
            }
        });

        input.addEventListener('input', function() {
            if (this.classList.contains('error')) {
                validateInput(this);
            }
            checkFormCompletion();
        });
    });
}

function validateInput(input) {
    const value = input.value.trim();
    
    if (input.hasAttribute('required') && !value) {
        showError(input, t('checkout_err_required_field', 'Este campo es obligatorio'));
        return false;
    }

    if (input.type === 'email' && value) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(value)) {
            showError(input, t('checkout_err_invalid_email', 'Email inválido'));
            return false;
        }
    }

    clearError(input);
    return true;
}

function showError(input, message) {
    input.classList.add('error');
    
    const errorMsg = input.parentElement.querySelector('.error-message');
    if (errorMsg) {
        errorMsg.innerHTML = `<i class="lni lni-warning"></i> ${message}`;
        errorMsg.classList.add('active');
    }
    
    setTimeout(() => {
        input.classList.remove('error');
    }, 500);
    
    setTimeout(() => {
        if (!input.value.trim() && input.hasAttribute('required')) {
            input.classList.add('error');
        }
    }, 510);
}

function clearError(input) {
    input.classList.remove('error');
    
    const errorMsg = input.parentElement.querySelector('.error-message');
    if (errorMsg) {
        errorMsg.classList.remove('active');
    }
}

function checkFormCompletion() {
    const fullName = document.getElementById('fullName')?.value.trim();
    const email = document.getElementById('email')?.value.trim();
    const countryCode = document.getElementById('countryCode')?.value;
    const postalCode = document.getElementById('postalCode')?.value.trim();
    
    const submitButton = document.getElementById('submitButton');
    
    const isFormComplete = fullName && email && countryCode && postalCode && cardData.complete;
    
    if (submitButton) {
        submitButton.disabled = !isFormComplete;
    }
    
    return isFormComplete;
}

// ============================================
// FORM SUBMISSION CON INTEGRACIÓN REAL
// ============================================

function initPaymentForm() {
    const form = document.getElementById('paymentForm');
    
    if (form) {
        form.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            console.log('📝 Form submitted');
            
            const requiredInputs = form.querySelectorAll('[required]');
            let isValid = true;
            let firstErrorField = null;
            
            requiredInputs.forEach(input => {
                if (input.type !== 'checkbox' && input.type !== 'hidden' && !validateInput(input)) {
                    isValid = false;
                    if (!firstErrorField) {
                        firstErrorField = input;
                    }
                }
            });
            
            if (!isValid) {
                alert(t('checkout_err_fill_required', 'Por favor completa todos los campos requeridos correctamente.'));
                if (firstErrorField) {
                    firstErrorField.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    firstErrorField.focus();
                }
                return;
            }
            
            if (!cardData.complete) {
                alert(t('checkout_err_fill_card', 'Por favor completa los datos de tu tarjeta.'));
                const stripeContainer = document.getElementById('stripe-container');
                stripeContainer.classList.add('error');
                setTimeout(() => {
                    stripeContainer.classList.remove('error');
                }, 500);
                return;
            }
            
            showProcessingModal();
            
            await processPayment();
        });
    }
}

async function processPayment() {
    try {
        console.log('💳 Processing payment...');
        
        // Obtener datos del formulario
        const fullName = document.getElementById('fullName').value.trim();
        const email = document.getElementById('email').value.trim();
        const phoneCode = document.getElementById('phoneCode')?.value.trim() || '';
        const phone = document.getElementById('phone')?.value.trim() || '';
        const fullPhone = phoneCode && phone ? phoneCode + phone.replace(/\s/g, '') : '';
        const countryCode = document.getElementById('countryCode')?.value || 'MX';
        const postalCode = document.getElementById('postalCode').value.trim();
        
        const urlParams = new URLSearchParams(window.location.search);
        const plan = urlParams.get('plan') || 'neutron';
        const billingPeriod = urlParams.get('billing') || 'monthly';
        
        // Crear checkout session en el backend
        console.log('📤 Creating checkout session...');
        const checkoutResponse = await fetch('/api/stripe/checkout', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({
                fullName,
                email,
                phone: fullPhone,
                countryCode,
                postalCode,
                plan,
                billingPeriod
            })
        });
        
        if (!checkoutResponse.ok) {
            const error = await checkoutResponse.json();
            throw new Error(error.error || t('checkout_err_create_session', 'Error al crear sesión de pago'));
        }
        
        const checkoutData = await checkoutResponse.json();
        console.log('✅ Checkout session created:', checkoutData);
        
        // Confirmar pago con Stripe
        console.log('💳 Confirming payment with Stripe...');
        const { error: confirmError, paymentIntent: confirmedPI } = await stripe.confirmCardPayment(
            checkoutData.clientSecret,
            {
                payment_method: {
                    card: cardElement,
                    billing_details: {
                        name: fullName,
                        email: email,
                        phone: fullPhone,
                        address: {
                            country: countryCode,
                            postal_code: postalCode
                        }
                    }
                }
            }
        );
        
        if (confirmError) {
            hideProcessingModal();
            console.error('❌ Payment error:', confirmError);
            alert(`${t('checkout_err_generic_prefix', 'Error:')} ${confirmError.message}`);
            return;
        }

        // Usar el ID real del paymentIntent confirmado
        const confirmedPaymentIntentId = confirmedPI
            ? confirmedPI.id
            : checkoutData.clientSecret.split('_secret_')[0];

        console.log('✅ Payment confirmed with Stripe');
        
        // Confirmar pago en el backend
        const confirmResponse = await fetch('/api/stripe/confirm', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({
                paymentIntentId: confirmedPaymentIntentId,
                plan,
                billingPeriod,
                invoice: (() => {
                    const cb = document.getElementById('requiresInvoice');
                    if (!cb || !cb.checked) return null;
                    return {
                        requiresInvoice: true,
                        razonSocial:     document.getElementById('razonSocial')?.value.trim()     || '',
                        rfc:             document.getElementById('rfc')?.value.trim().toUpperCase() || '',
                        direccionFiscal: document.getElementById('direccionFiscal')?.value.trim() || '',
                        codigoPostal:    document.getElementById('codigoPostal')?.value.trim()    || '',
                        emailFactura:    document.getElementById('emailFactura')?.value.trim()    || '',
                        usoCfdi:         document.getElementById('usoCfdi')?.value                || '',
                        regimenFiscal:   document.getElementById('regimenFiscal')?.value          || '',
                    };
                })()
            })
        });
        
        if (!confirmResponse.ok) {
            throw new Error(t('checkout_err_confirm_server', 'Error al confirmar pago en el servidor'));
        }
        
        console.log('✅ Payment confirmed on backend');
        
        hideProcessingModal();
        showSuccessModal();
        
    } catch (error) {
        console.error('❌ Payment error:', error);
        hideProcessingModal();
        alert(`${t('checkout_err_processing_prefix', 'Error procesando el pago:')} ${error.message}`);
    }
}

// ============================================
// MODALS
// ============================================

function showProcessingModal() {
    const modal = document.getElementById('processingModal');
    if (modal) {
        modal.classList.add('show');
        document.body.style.overflow = 'hidden';
    }
}

function hideProcessingModal() {
    const modal = document.getElementById('processingModal');
    if (modal) {
        modal.classList.remove('show');
        document.body.style.overflow = '';
    }
}

function showSuccessModal() {
    const modal = document.getElementById('successModal');
    if (modal) {
        modal.classList.add('show');
        document.body.style.overflow = 'hidden';
    }
}

// ============================================
// LOAD PLAN DETAILS CON PRECIOS REALES
// ============================================

function loadPlanDetails() {
    const urlParams = new URLSearchParams(window.location.search);
    const planId = urlParams.get('plan') || 'neutron';
    const billingPeriod = urlParams.get('billing') || 'monthly';
    
    currentBillingPeriod = billingPeriod;
    
    // Buscar el plan en los datos cargados
    if (!plansData) {
        console.warn('⚠️ Plans data not loaded yet, using fallback');
        plansData = getFallbackPlansData();
    }
    
    selectedPlanData = plansData.find(p => p.id === planId);
    
    if (!selectedPlanData) {
        console.warn(`⚠️ Plan ${planId} not found, using fallback`);
        selectedPlanData = plansData.find(p => p.id === 'neutron') || plansData[1];
    }
    
    console.log('📋 Selected plan data:', selectedPlanData);
    
    // Actualizar nombre del plan
    const planNameElement = document.getElementById('selectedPlanName');
    if (planNameElement) {
        planNameElement.textContent = selectedPlanData.displayName || selectedPlanData.name;
    }
    
    // Actualizar período de facturación
    const billingPeriodElement = document.getElementById('billingPeriod');
    if (billingPeriodElement) {
        billingPeriodElement.textContent = billingPeriod === 'annual' ? 'Anual' : 'Mensual';
    }
    
    // Obtener precio según el período
    const priceData = billingPeriod === 'annual' 
        ? selectedPlanData.annual 
        : selectedPlanData.monthly;
    
    const subtotal = priceData.amount || 0;
    const currency = priceData.currency || 'MXN';
    
    // IVA incluido en el precio — no se suma
    const total = subtotal;

    // Actualizar elementos de precio
    const subtotalElement = document.getElementById('subtotal');
    const totalElement = document.getElementById('total');

    if (subtotalElement) {
        subtotalElement.textContent = `$${subtotal.toFixed(2)} ${currency}`;
    }
    if (totalElement) {
        totalElement.textContent = `$${total.toFixed(2)} ${currency}`;
    }
    
    // Actualizar features si existen en los datos
    if (selectedPlanData.features) {
        const featuresList = document.getElementById('planFeatures');
        if (featuresList) {
            featuresList.innerHTML = selectedPlanData.features.map(feature => {
                // Remover marcadores de check/cross si existen
                const cleanFeature = feature.replace(/^[✓✗]\s*/, '');
                return `
                    <li>
                        <i class="lni lni-checkmark-circle"></i>
                        <span>${cleanFeature}</span>
                    </li>
                `;
            }).join('');
        }
    }
    
    console.log(`📋 Plan details loaded: ${selectedPlanData.name}`);
    console.log(`💰 Subtotal: $${subtotal.toFixed(2)} ${currency}`);
    // IVA incluido en precio — removido
    console.log(`💳 Total: $${total.toFixed(2)} ${currency}`);

    // Aplicar traducción del idioma actual al nombre/período/features del plan
    applyCheckoutDynamicTranslations(getCheckoutLang());
}

// ============================================
// KEYBOARD NAVIGATION
// ============================================

document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        hideProcessingModal();
    }
});

document.querySelectorAll('.form-input, .form-select').forEach(input => {
    input.addEventListener('keypress', function(e) {
        if (e.key === 'Enter' && this.tagName !== 'TEXTAREA') {
            e.preventDefault();
            const formInputs = Array.from(document.querySelectorAll('.form-input, .form-select'));
            const currentIndex = formInputs.indexOf(this);
            if (currentIndex < formInputs.length - 1) {
                formInputs[currentIndex + 1].focus();
            }
        }
    });
});

console.log('✅ Checkout JS initialized');
console.log('🔒 Security: PCI compliant payment processing');
console.log('💳 Stripe integration: READY');
console.log('💰 Dynamic pricing: ENABLED');
// ============================================
// FACTURACIÓN - NUEVOS CAMPOS
// ============================================

function initBillingFields() {
    const checkbox = document.getElementById('requiresInvoice');
    const billingFields = document.getElementById('billingFields');
    if (!checkbox || !billingFields) return;

    checkbox.addEventListener('change', function() {
        if (this.checked) {
            billingFields.classList.add('open');
        } else {
            billingFields.classList.remove('open');
            // Clear values when hidden
            ['razonSocial','rfc','direccionFiscal','codigoPostal','emailFactura'].forEach(id => {
                const el = document.getElementById(id);
                if (el) { el.value = ''; el.classList.remove('error'); }
            });
            ['usoCfdi','regimenFiscal'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = '';
            });
            document.getElementById('usoCfdi-selected').textContent = t('checkout_cfdi_use_placeholder', 'Seleccionar uso');
            document.getElementById('regimenFiscal-selected').textContent = t('checkout_fiscal_regime_placeholder', 'Seleccionar régimen');
        }
        checkFormCompletion();
    });

    // RFC uppercase
    const rfcInput = document.getElementById('rfc');
    if (rfcInput) {
        rfcInput.addEventListener('input', function() {
            this.value = this.value.toUpperCase();
        });
    }

    // Código postal solo números
    const cpInput = document.getElementById('codigoPostal');
    if (cpInput) {
        cpInput.addEventListener('input', function() {
            this.value = this.value.replace(/[^0-9]/g, '');
        });
    }

    // Attach blur validation to billing inputs
    const billingInputs = ['razonSocial', 'rfc', 'direccionFiscal', 'codigoPostal', 'emailFactura'];
    billingInputs.forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener('blur', () => { checkFormCompletion(); });
            input.addEventListener('input', () => { checkFormCompletion(); });
        }
    });

    // Init CFDI dropdowns
    initCfdiSelect('usoCfdi-trigger', 'usoCfdi-dropdown', 'usoCfdi-selected', 'usoCfdi');
    initCfdiSelect('regimenFiscal-trigger', 'regimenFiscal-dropdown', 'regimenFiscal-selected', 'regimenFiscal');

    console.log('✅ Billing fields initialized');
}

function initCfdiSelect(triggerId, dropdownId, selectedId, inputId) {
    const trigger = document.getElementById(triggerId);
    const dropdown = document.getElementById(dropdownId);
    const selectedEl = document.getElementById(selectedId);
    const input = document.getElementById(inputId);
    if (!trigger || !dropdown || !selectedEl || !input) return;

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = dropdown.classList.contains('open');
        // Close all other dropdowns
        document.querySelectorAll('.cfdi-select-dropdown.open').forEach(d => {
            d.classList.remove('open');
            d.previousElementSibling?.classList.remove('open');
        });
        if (!isOpen) {
            dropdown.classList.add('open');
            trigger.classList.add('open');
        }
    });

    trigger.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); trigger.click(); }
    });

    dropdown.querySelectorAll('.cfdi-option').forEach(option => {
        option.addEventListener('click', () => {
            const value = option.dataset.value;
            const text = option.textContent.trim();
            selectedEl.textContent = text;
            input.value = value;
            dropdown.querySelectorAll('.cfdi-option').forEach(o => o.classList.remove('selected'));
            if (value) option.classList.add('selected');
            trigger.classList.remove('open');
            dropdown.classList.remove('open');
            checkFormCompletion();
        });
    });

    document.addEventListener('click', (e) => {
        if (!trigger.contains(e.target) && !dropdown.contains(e.target)) {
            trigger.classList.remove('open');
            dropdown.classList.remove('open');
        }
    });
}

// ============================================
// CUPÓN DE DESCUENTO
// ============================================

const couponState = {
    applied: false,
    discountAmount: 0,
    originalAmount: 0,
    finalAmount: 0
};

function initCoupon() {
    const applyBtn = document.getElementById('apply-coupon');
    const removeBtn = document.getElementById('remove-coupon');
    const couponInput = document.getElementById('coupon-code');
    if (!applyBtn || !couponInput) return;

    applyBtn.addEventListener('click', () => applyCoupon());
    couponInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') applyCoupon();
    });
    if (removeBtn) removeBtn.addEventListener('click', removeCoupon);
}

async function applyCoupon() {
    const code = document.getElementById('coupon-code')?.value.trim();
    if (!code) {
        showCouponResult(t('checkout_coupon_enter_code', 'Ingresa un código de descuento'), 'error');
        return;
    }

    const applyBtn = document.getElementById('apply-coupon');
    if (applyBtn) applyBtn.disabled = true;
    showCouponResult(t('checkout_coupon_validating', 'Validando...'), 'loading');

    try {
        const urlParams = new URLSearchParams(window.location.search);
        const plan = urlParams.get('plan') || 'neutron';
        const period = urlParams.get('billing') || 'monthly';

        const res = await fetch('/api/billing/validate-coupon', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ coupon_code: code, plan, period })
        });

        const result = await res.json();

        if (result.success) {
            couponState.applied = true;
            couponState.discountAmount = result.discount_amount || 0;
            couponState.finalAmount = result.final_amount || couponState.originalAmount;

            document.getElementById('coupon-input-container').style.display = 'none';
            document.getElementById('discount-breakdown').style.display = 'block';

            const nameEl = document.getElementById('coupon-name');
            if (nameEl) nameEl.textContent = result.coupon_name || t('checkout_coupon_applied_default', 'Cupón aplicado');

            showCouponResult(`${t('checkout_coupon_applied_prefix', '¡Cupón aplicado!')} ${result.discount_text || ''}`, 'success');
            updatePriceDisplay();
        } else {
            showCouponResult(result.error || t('checkout_coupon_invalid', 'Código inválido'), 'error');
        }
    } catch (err) {
        showCouponResult(t('checkout_coupon_error', 'Error al validar el código. Intenta de nuevo.'), 'error');
    } finally {
        if (applyBtn) applyBtn.disabled = false;
    }
}

function removeCoupon() {
    couponState.applied = false;
    couponState.discountAmount = 0;
    couponState.finalAmount = couponState.originalAmount;

    document.getElementById('coupon-input-container').style.display = 'block';
    document.getElementById('discount-breakdown').style.display = 'none';
    document.getElementById('coupon-result').style.display = 'none';

    const codeInput = document.getElementById('coupon-code');
    if (codeInput) codeInput.value = '';

    updatePriceDisplay();
}

function showCouponResult(message, type) {
    const el = document.getElementById('coupon-result');
    if (!el) return;
    const icons = { success: 'lni-checkmark-circle', error: 'lni-warning', loading: 'lni-spinner' };
    el.className = `coupon-result ${type}`;
    el.innerHTML = `<i class="lni ${icons[type] || 'lni-information'}"></i> ${message}`;
    el.style.display = 'flex';
    if (type === 'success') {
        setTimeout(() => { el.style.display = 'none'; }, 3000);
    }
}

function updatePriceDisplay() {
    const subtotalEl = document.getElementById('subtotal');
    const discountLine = document.getElementById('discount-line');
    const discountSummaryEl = document.getElementById('discount-summary');
    const totalEl = document.getElementById('total');

    if (!subtotalEl || !totalEl) return;

    // Parse current subtotal
    const subtotalText = subtotalEl.textContent.replace(/[^0-9.]/g, '');
    const subtotal = parseFloat(subtotalText) || couponState.originalAmount;
    const currency = subtotalEl.textContent.includes('MXN') ? 'MXN' : '';

    const taxRate = 0.16;

    if (couponState.applied && couponState.discountAmount > 0) {
        const discounted = subtotal - (couponState.discountAmount / 100);
        const tax = discounted * taxRate;
        const total = discounted + tax;

        if (discountLine) discountLine.style.display = 'flex';
        if (discountSummaryEl) discountSummaryEl.textContent = `-$${(couponState.discountAmount / 100).toFixed(2)} ${currency}`;
        totalEl.textContent = `$${total.toFixed(2)} ${currency}`;
    } else {
        const tax = subtotal * taxRate;
        const total = subtotal + tax;
        if (discountLine) discountLine.style.display = 'none';
        totalEl.textContent = `$${total.toFixed(2)} ${currency}`;
    }
}

// ============================================
// PATCH checkFormCompletion para incluir campos nuevos
// ============================================
const _originalCheckFormCompletion = checkFormCompletion;
checkFormCompletion = function() {
    const result = _originalCheckFormCompletion();

    // Validar campos de facturación si están activos
    const checkbox = document.getElementById('requiresInvoice');
    if (checkbox && checkbox.checked) {
        const required = ['razonSocial', 'rfc', 'direccionFiscal', 'codigoPostal', 'emailFactura', 'usoCfdi', 'regimenFiscal'];
        const allFilled = required.every(id => {
            const el = document.getElementById(id);
            return el && el.value.trim().length > 0;
        });
        if (!allFilled) {
            const submitButton = document.getElementById('submitButton');
            if (submitButton) submitButton.disabled = true;
            return false;
        }
    }
    return result;
};

// Inicializar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', function() {
    initBillingFields();
    initCoupon();
});