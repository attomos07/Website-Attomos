// Plans page functionality

function getLang() {
    return localStorage.getItem('attomos_lang') || localStorage.getItem('lang') || 'es';
}

// ============================================
// Traducción de contenido dinámico (renderizado desde Go en español)
// Cards: nombre / descripción / features de cada plan
// Banner: nombre del plan actual
// Tabla: términos técnicos que no llevan data-translate propio
// ============================================
const PLAN_I18N = (function () {
    const F = {
        es: { wa1: '1 agente de WhatsApp', waweb: 'WhatsApp Web (escaneo QR)', spei: 'Pasarela de pagos SPEI', card: 'Pasarela de pagos con tarjeta', gemini: 'IA con Gemini', gsheets: 'Google Sheets', gcal: 'Google Calendar', hours: 'Horarios personalizados de atención', catSvc: 'Catálogo de servicios', promoSvc: 'Promociones de servicios', photos: 'Subida de fotos a servicios', promoPeriods: 'Periodos de promocion', multiBranch: 'Multi Sucursal', jobs: 'Ofertas de trabajo (Próximamente)', agentsUnl: 'Agentes ilimitados', metaApi: 'Meta WhatsApp Business API', contactsUnl: 'Contactos ilimitados', msgsUnl: 'Mensajes ilimitados', chatwoot: 'Chatwoot CRM', catProd: 'Catálogo de productos', promoPacks: 'Promociones y packs', inventory: 'Sistema de inventario', pos: 'Punto de venta (POS)', geminiAdv: 'Gemini Avanzada', businessApi: 'Business API', webQr: 'Web (QR)' },
        en: { wa1: '1 WhatsApp agent', waweb: 'WhatsApp Web (QR scan)', spei: 'SPEI payment gateway', card: 'Card payment gateway', gemini: 'AI with Gemini', gsheets: 'Google Sheets', gcal: 'Google Calendar', hours: 'Customized business hours', catSvc: 'Services catalog', promoSvc: 'Service promotions', photos: 'Photo uploads for services', promoPeriods: 'Promotion periods', multiBranch: 'Multi-branch', jobs: 'Job listings (Coming soon)', agentsUnl: 'Unlimited agents', metaApi: 'Meta WhatsApp Business API', contactsUnl: 'Unlimited contacts', msgsUnl: 'Unlimited messages', chatwoot: 'Chatwoot CRM', catProd: 'Product catalog', promoPacks: 'Promotions and bundles', inventory: 'Inventory system', pos: 'Point of sale (POS)', geminiAdv: 'Advanced Gemini', businessApi: 'Business API', webQr: 'Web (QR)' },
        ru: { wa1: '1 агент WhatsApp', waweb: 'WhatsApp Web (сканирование QR)', spei: 'Платёжный шлюз SPEI', card: 'Платёжный шлюз для карт', gemini: 'ИИ на базе Gemini', gsheets: 'Google Sheets', gcal: 'Google Calendar', hours: 'Индивидуальный график работы', catSvc: 'Каталог услуг', promoSvc: 'Акции на услуги', photos: 'Загрузка фото к услугам', promoPeriods: 'Периоды акций', multiBranch: 'Мультифилиал', jobs: 'Вакансии (Скоро)', agentsUnl: 'Неограниченное количество агентов', metaApi: 'Meta WhatsApp Business API', contactsUnl: 'Неограниченное количество контактов', msgsUnl: 'Неограниченные сообщения', chatwoot: 'Chatwoot CRM', catProd: 'Каталог товаров', promoPacks: 'Акции и наборы', inventory: 'Система инвентаризации', pos: 'Точка продаж (POS)', geminiAdv: 'Продвинутый Gemini', businessApi: 'Business API', webQr: 'Web (QR)' },
        uz: { wa1: "1 ta WhatsApp agenti", waweb: 'WhatsApp Web (QR skanerlash)', spei: "SPEI to'lov shlyuzi", card: "Karta orqali to'lov shlyuzi", gemini: 'Gemini bilan AI', gsheets: 'Google Sheets', gcal: 'Google Calendar', hours: 'Shaxsiylashtirilgan ish vaqti', catSvc: 'Xizmatlar katalogi', promoSvc: 'Xizmatlar aksiyalari', photos: 'Xizmatlarga rasm yuklash', promoPeriods: 'Aksiya davrlari', multiBranch: "Ko'p filial", jobs: 'Ish takliflari (Tez orada)', agentsUnl: 'Cheksiz agentlar', metaApi: 'Meta WhatsApp Business API', contactsUnl: 'Cheksiz kontaktlar', msgsUnl: 'Cheksiz xabarlar', chatwoot: 'Chatwoot CRM', catProd: 'Mahsulotlar katalogi', promoPacks: 'Aksiyalar va paketlar', inventory: 'Ombor tizimi', pos: 'Savdo nuqtasi (POS)', geminiAdv: "Ilg'or Gemini", businessApi: 'Business API', webQr: 'Web (QR)' },
        ja: { wa1: 'WhatsAppエージェント1つ', waweb: 'WhatsApp Web（QRスキャン）', spei: 'SPEI決済ゲートウェイ', card: 'カード決済ゲートウェイ', gemini: 'Gemini搭載AI', gsheets: 'Google Sheets', gcal: 'Google カレンダー', hours: 'カスタム営業時間', catSvc: 'サービスカタログ', promoSvc: 'サービスプロモーション', photos: 'サービスへの写真アップロード', promoPeriods: 'プロモーション期間', multiBranch: 'マルチ支店', jobs: '求人情報（近日公開）', agentsUnl: '無制限のエージェント', metaApi: 'Meta WhatsApp Business API', contactsUnl: '無制限の連絡先', msgsUnl: '無制限のメッセージ', chatwoot: 'Chatwoot CRM', catProd: '商品カタログ', promoPacks: 'プロモーションとパック', inventory: '在庫管理システム', pos: 'POSレジ', geminiAdv: '高度なGemini', businessApi: 'Business API', webQr: 'Web（QR）' },
        zh: { wa1: '1个WhatsApp坐席', waweb: 'WhatsApp网页版（扫描二维码）', spei: 'SPEI支付网关', card: '银行卡支付网关', gemini: '由Gemini提供的AI', gsheets: 'Google Sheets', gcal: 'Google 日历', hours: '自定义营业时间', catSvc: '服务目录', promoSvc: '服务促销', photos: '为服务上传照片', promoPeriods: '促销时段', multiBranch: '多分店', jobs: '招聘信息（即将推出）', agentsUnl: '无限坐席', metaApi: 'Meta WhatsApp Business API', contactsUnl: '无限联系人', msgsUnl: '无限消息', chatwoot: 'Chatwoot CRM', catProd: '产品目录', promoPacks: '促销与套装', inventory: '库存系统', pos: '销售点（POS）', geminiAdv: '高级版Gemini', businessApi: 'Business API', webQr: 'Web（QR）' },
        fr: { wa1: '1 agent WhatsApp', waweb: 'WhatsApp Web (scan QR)', spei: 'Passerelle de paiement SPEI', card: 'Passerelle de paiement par carte', gemini: 'IA avec Gemini', gsheets: 'Google Sheets', gcal: 'Google Agenda', hours: "Horaires d'ouverture personnalisés", catSvc: 'Catalogue de services', promoSvc: 'Promotions de services', photos: 'Téléchargement de photos pour les services', promoPeriods: 'Périodes de promotion', multiBranch: 'Multi-succursales', jobs: "Offres d'emploi (Bientôt disponible)", agentsUnl: 'Agents illimités', metaApi: 'Meta WhatsApp Business API', contactsUnl: 'Contacts illimités', msgsUnl: 'Messages illimités', chatwoot: 'Chatwoot CRM', catProd: 'Catalogue de produits', promoPacks: 'Promotions et forfaits', inventory: "Système d'inventaire", pos: 'Point de vente (POS)', geminiAdv: 'Gemini Avancé', businessApi: 'Business API', webQr: 'Web (QR)' },
        pt: { wa1: '1 agente de WhatsApp', waweb: 'WhatsApp Web (escaneamento de QR)', spei: 'Gateway de pagamento SPEI', card: 'Gateway de pagamento com cartão', gemini: 'IA com Gemini', gsheets: 'Google Sheets', gcal: 'Google Agenda', hours: 'Horários de atendimento personalizados', catSvc: 'Catálogo de serviços', promoSvc: 'Promoções de serviços', photos: 'Upload de fotos nos serviços', promoPeriods: 'Períodos de promoção', multiBranch: 'Multi Filial', jobs: 'Vagas de emprego (Em breve)', agentsUnl: 'Agentes ilimitados', metaApi: 'Meta WhatsApp Business API', contactsUnl: 'Contatos ilimitados', msgsUnl: 'Mensagens ilimitadas', chatwoot: 'Chatwoot CRM', catProd: 'Catálogo de produtos', promoPacks: 'Promoções e pacotes', inventory: 'Sistema de inventário', pos: 'Ponto de venda (PDV)', geminiAdv: 'Gemini Avançado', businessApi: 'Business API', webQr: 'Web (QR)' },
        de: { wa1: '1 WhatsApp-Agent', waweb: 'WhatsApp Web (QR-Scan)', spei: 'SPEI-Zahlungsgateway', card: 'Zahlungsgateway für Kartenzahlungen', gemini: 'KI mit Gemini', gsheets: 'Google Sheets', gcal: 'Google Kalender', hours: 'Individuelle Öffnungszeiten', catSvc: 'Dienstleistungskatalog', promoSvc: 'Aktionen für Dienstleistungen', photos: 'Fotos zu Dienstleistungen hochladen', promoPeriods: 'Aktionszeiträume', multiBranch: 'Mehrere Filialen', jobs: 'Stellenangebote (Demnächst)', agentsUnl: 'Unbegrenzte Agenten', metaApi: 'Meta WhatsApp Business API', contactsUnl: 'Unbegrenzte Kontakte', msgsUnl: 'Unbegrenzte Nachrichten', chatwoot: 'Chatwoot CRM', catProd: 'Produktkatalog', promoPacks: 'Aktionen und Pakete', inventory: 'Lagerverwaltungssystem', pos: 'Kassensystem (POS)', geminiAdv: 'Erweitertes Gemini', businessApi: 'Business API', webQr: 'Web (QR)' },
        ko: { wa1: 'WhatsApp 에이전트 1개', waweb: 'WhatsApp Web (QR 스캔)', spei: 'SPEI 결제 게이트웨이', card: '카드 결제 게이트웨이', gemini: 'Gemini 기반 AI', gsheets: 'Google Sheets', gcal: 'Google 캘린더', hours: '맞춤형 영업시간', catSvc: '서비스 카탈로그', promoSvc: '서비스 프로모션', photos: '서비스 사진 업로드', promoPeriods: '프로모션 기간', multiBranch: '다중 지점', jobs: '채용 정보 (출시 예정)', agentsUnl: '무제한 에이전트', metaApi: 'Meta WhatsApp Business API', contactsUnl: '무제한 연락처', msgsUnl: '무제한 메시지', chatwoot: 'Chatwoot CRM', catProd: '제품 카탈로그', promoPacks: '프로모션 및 패키지', inventory: '재고 관리 시스템', pos: '포스(POS) 시스템', geminiAdv: '고급 Gemini', businessApi: 'Business API', webQr: 'Web (QR)' },
    };

    // Nombre y "display" del plan son universales (siempre en inglés),
    // igual que en el userbar — no dependen del idioma de la interfaz.
    const UNIVERSAL_NAMES = {
        gratuito: { name: 'Free Plan', display: 'Free' },
        proton:   { name: 'Proton',    display: 'Proton' },
        neutron:  { name: 'Neutron',   display: 'Neutron' },
    };

    // La descripción corta de cada plan sí se mantiene traducida por idioma.
    const DESCRIPTIONS = {
        es: { gratuito: 'Perfecto para empezar sin compromisos', proton: 'Ideal para empresas de servicios', neutron: 'Ideal para e-commerce' },
        en: { gratuito: 'Perfect for getting started with no commitments', proton: 'Ideal for service businesses', neutron: 'Ideal for e-commerce' },
        ru: { gratuito: 'Идеально для начала без обязательств', proton: 'Идеально для сервисных компаний', neutron: 'Идеально для e-commerce' },
        uz: { gratuito: "Majburiyatlarsiz boshlash uchun ideal", proton: "Xizmat ko'rsatuvchi bizneslar uchun ideal", neutron: 'Elektron tijorat uchun ideal' },
        ja: { gratuito: '契約なしで気軽に始められます', proton: 'サービス業に最適', neutron: 'ECサイトに最適' },
        zh: { gratuito: '轻松起步，无需承诺', proton: '适合服务型企业', neutron: '适合电商企业' },
        fr: { gratuito: 'Parfait pour commencer sans engagement', proton: 'Idéal pour les entreprises de services', neutron: 'Idéal pour le e-commerce' },
        pt: { gratuito: 'Perfeito para começar sem compromisso', proton: 'Ideal para empresas de serviços', neutron: 'Ideal para e-commerce' },
        de: { gratuito: 'Perfekt für den unverbindlichen Einstieg', proton: 'Ideal für Dienstleistungsunternehmen', neutron: 'Ideal für E-Commerce' },
        ko: { gratuito: '약정 없이 시작하기 좋은 요금제', proton: '서비스 기업에 적합', neutron: '이커머스에 적합' },
    };

    function features(lang, planId) {
        const f = F[lang] || F.es;
        if (planId === 'gratuito') return [f.wa1, f.waweb, f.spei, f.card, f.gemini, f.gsheets, f.gcal, f.hours, f.catSvc, f.promoSvc, f.photos, f.promoSvc, f.promoPeriods, f.multiBranch, f.jobs];
        if (planId === 'proton') return [f.agentsUnl, f.metaApi, f.contactsUnl, f.msgsUnl, f.gemini, f.chatwoot, f.gsheets, f.gcal, f.hours, f.catSvc, f.promoSvc, f.jobs];
        if (planId === 'neutron') return [f.agentsUnl, f.metaApi, f.contactsUnl, f.msgsUnl, f.chatwoot, f.gemini, f.gsheets, f.catProd, f.promoPacks, f.inventory, f.pos, f.jobs];
        return null;
    }

    function getPlanData(lang, planId) {
        const universal = UNIVERSAL_NAMES[planId];
        if (!universal) return null;
        const descByLang = DESCRIPTIONS[lang] || DESCRIPTIONS.es;
        const desc = descByLang[planId] || DESCRIPTIONS.es[planId];
        return { name: universal.name, description: desc, display: universal.display, features: features(lang, planId) };
    }

    function getTerms(lang) {
        return F[lang] || F.es;
    }

    return { getPlanData, getTerms };
})();

function applyPlanTranslations(lang) {
    // Nombre, descripción y features de cada card (contenido renderizado en Go)
    document.querySelectorAll('.pricing-card[data-plan]').forEach(card => {
        const planId = card.getAttribute('data-plan');
        const data = PLAN_I18N.getPlanData(lang, planId);
        if (!data) return;

        const nameEl = card.querySelector('.plan-name');
        if (nameEl) nameEl.textContent = data.name;

        const descEl = card.querySelector('.plan-description');
        if (descEl) descEl.textContent = data.description;

        const featureSpans = card.querySelectorAll('.plan-features li span');
        featureSpans.forEach((span, i) => {
            if (data.features && data.features[i]) span.textContent = data.features[i];
        });
    });

    // Nombre del plan actual en el banner ("Plan Actual: <strong>gratuito</strong>")
    const bannerStrong = document.querySelector('.current-plan-banner .banner-title strong');
    if (bannerStrong) {
        if (!bannerStrong.hasAttribute('data-plan-id')) {
            bannerStrong.setAttribute('data-plan-id', bannerStrong.textContent.trim().toLowerCase());
        }
        const planId = bannerStrong.getAttribute('data-plan-id');
        const data = PLAN_I18N.getPlanData(lang, planId);
        if (data) bannerStrong.textContent = data.display;
    }

    // Términos técnicos de la tabla comparativa que no tienen su propia data-translate
    // (Web (QR), Business API, Gemini / Gemini Avanzada, Chatwoot ya queda igual por ser marca)
    const terms = PLAN_I18N.getTerms(lang);
    document.querySelectorAll('.comparison-table [data-i18n-term]').forEach(el => {
        const key = el.getAttribute('data-i18n-term');
        if (terms[key]) el.textContent = terms[key];
    });

    // Nombres de plan (Protón/Neutrón) en los encabezados de la tabla,
    // para que coincidan exactamente con lo mostrado en las cards
    document.querySelectorAll('.comparison-table [data-i18n-plan]').forEach(el => {
        const planId = el.getAttribute('data-i18n-plan');
        const data = PLAN_I18N.getPlanData(lang, planId);
        if (data) el.textContent = data.display;
    });
}

// Registrado a nivel superior (no dentro de DOMContentLoaded) para no perder
// el evento inicial que translations.js dispara en su propio DOMContentLoaded
document.addEventListener('attomos:langchange', function (e) {
    applyPlanTranslations(e.detail.lang);
});

document.addEventListener('DOMContentLoaded', function() {
    const billingToggle = document.getElementById('billingToggle');
    const priceAmounts = document.querySelectorAll('.price-amount');
    const pricePeriods = document.querySelectorAll('.price-period');

    // Toggle between monthly and annual billing
    if (billingToggle) {
        billingToggle.addEventListener('change', function() {
            const isAnnual = this.checked;
            
            priceAmounts.forEach(priceElement => {
                const monthly = priceElement.getAttribute('data-monthly');
                const annual = priceElement.getAttribute('data-annual');
                
                if (monthly && annual) {
                    if (isAnnual) {
                        // Mostrar precio anual (ya con descuento del 20%)
                        priceElement.textContent = '$' + annual;
                    } else {
                        // Mostrar precio mensual
                        priceElement.textContent = '$' + monthly;
                    }
                }
            });

            // Actualizar el texto del período
            pricePeriods.forEach(period => {
                if (isAnnual) {
                    period.textContent = window.Translations?.dict?.[getLang()]?.plans_period_year || '/ año';
                } else {
                    period.textContent = window.Translations?.dict?.[getLang()]?.plans_period_month || '/ mes';
                }
            });
        });
    }

    // Handle plan button clicks
    const planButtons = document.querySelectorAll('.plan-button');
    planButtons.forEach(button => {
        button.addEventListener('click', function() {
            if (this.classList.contains('upgrade')) {
                const plan = this.closest('.pricing-card').getAttribute('data-plan');
                openApiKeyModal(plan);
            } else if (this.classList.contains('free-trial')) {
                const plan = this.closest('.pricing-card').getAttribute('data-plan');
                handleUpgrade(plan);
            } else if (this.classList.contains('secondary')) {
                handleContactSales();
            }
        });
    });

    // Animación de entrada para filas de la comparison table
    const tableRows = document.querySelectorAll('.comparison-table tbody tr');
    if (tableRows.length) {
        const rowObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('animate-in');
                    rowObserver.unobserve(entry.target);
                }
            });
        }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

        tableRows.forEach(row => rowObserver.observe(row));
    }

    // Handle FAQ accordion
    const faqItems = document.querySelectorAll('.faq-item');
    faqItems.forEach(item => {
        const question = item.querySelector('.faq-question');
        
        question.addEventListener('click', function() {
            // Toggle active class
            const isActive = item.classList.contains('active');
            
            // Close all other FAQs with smooth animation
            faqItems.forEach(otherItem => {
                if (otherItem !== item && otherItem.classList.contains('active')) {
                    otherItem.classList.remove('active');
                }
            });
            
            // Toggle current FAQ
            if (isActive) {
                item.classList.remove('active');
            } else {
                item.classList.add('active');
            }
        });
    });
});

function handleUpgrade(plan, hasOwnKey, ownApiKey) {
    console.log('Upgrading to plan:', plan, 'hasOwnKey:', hasOwnKey);

    // Si es el plan gratuito, ir directo a select-plan
    if (plan === 'gratuito') {
        window.location.href = '/select-plan';
        return;
    }

    // Detectar si está en modo anual
    const billingToggle = document.getElementById('billingToggle');
    const isAnnual = billingToggle ? billingToggle.checked : false;
    const billingPeriod = isAnnual ? 'annual' : 'monthly';

    // Redirigir con parámetros de plan y período — hasOwnKey le dice al
    // backend si debe saltarse el aprovisionamiento automático de GCP
    // (creación de proyecto + API key de Gemini) para este usuario.
    let url = `/checkout?plan=${plan}&billing=${billingPeriod}`;
    if (typeof hasOwnKey === 'boolean') {
        url += `&hasOwnKey=${hasOwnKey}`;
        if (hasOwnKey && ownApiKey) {
            url += `&apiKey=${encodeURIComponent(ownApiKey)}`;
        }
    }
    window.location.href = url;
}

// ── Modal: ¿ya tienes tu propia API key de Gemini? ──────────────────────────
// Solo aplica a planes de pago ("Actualizar Plan") — el plan gratuito no
// pasa por aquí, sigue yendo directo a /select-plan.
let apiKeyModalPlan = null;

function openApiKeyModal(plan) {
    apiKeyModalPlan = plan;
    const overlay = document.getElementById('apiKeyModalOverlay');
    const inputWrap = document.getElementById('apiKeyInputWrap');
    const input = document.getElementById('apiKeyModalInput');
    if (!overlay) {
        // Si por lo que sea el modal no está en el DOM, no bloquear el flujo
        handleUpgrade(plan);
        return;
    }
    if (inputWrap) inputWrap.style.display = 'none';
    if (input) input.value = '';
    overlay.style.display = 'flex';
}

function closeApiKeyModal() {
    const overlay = document.getElementById('apiKeyModalOverlay');
    if (overlay) overlay.style.display = 'none';
    apiKeyModalPlan = null;
}

document.addEventListener('DOMContentLoaded', function() {
    const overlay = document.getElementById('apiKeyModalOverlay');
    const btnNo = document.getElementById('apiKeyModalNo');
    const btnYes = document.getElementById('apiKeyModalYes');
    const inputWrap = document.getElementById('apiKeyInputWrap');
    const input = document.getElementById('apiKeyModalInput');

    if (!overlay || !btnNo || !btnYes) return;

    // "No, créenmela automáticamente" → GCP corre normal (hasOwnKey=false)
    btnNo.addEventListener('click', function() {
        const plan = apiKeyModalPlan;
        closeApiKeyModal();
        handleUpgrade(plan, false);
    });

    // "Sí, ya tengo una" → primer click revela el campo para pegarla;
    // segundo click (mismo botón) confirma y sigue, con o sin key pegada.
    btnYes.addEventListener('click', function() {
        if (inputWrap && inputWrap.style.display === 'none') {
            inputWrap.style.display = 'block';
            if (input) input.focus();
            btnYes.textContent = window.Translations?.dict?.[getLang()]?.plans_apikey_modal_continue || 'Continuar';
            return;
        }
        const plan = apiKeyModalPlan;
        const ownKey = input ? input.value.trim() : '';
        closeApiKeyModal();
        handleUpgrade(plan, true, ownKey);
    });

    // Cerrar el modal si le dan clic al overlay fuera de la tarjeta
    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) {
            closeApiKeyModal();
        }
    });
});

function handleContactSales() {
    console.log('Contact sales clicked');
    
    // Redirigir a formulario de contacto o abrir modal
    window.location.href = '/contact-sales';
}

// ============================================================================
// CAPA iOS 27 — Planes
// Entrada escalonada, Mensual/Anual como selector segmentado, precios que
// ruedan al cambiar, secciones que aparecen al hacer scroll y modal de API key.
// No cambia la lógica de arriba: el checkbox #billingToggle sigue siendo
// la fuente de verdad (se le cambia el valor y se dispara "change").
// ============================================================================
(function () {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
    const SUPPORTS_LINEAR = window.CSS && CSS.supports('animation-timing-function', 'linear(0, 1)');
    const SPRING = SUPPORTS_LINEAR
        ? 'linear(0, 0.04, 0.139, 0.271, 0.416, 0.56, 0.691, 0.805, 0.897, 0.969, 1.021, 1.055, 1.074, 1.082, 1.081, 1.075, 1.065, 1.053, 1.041, 1.03, 1.02, 1.011, 1.005, 1, 0.996, 0.994, 0.993, 0.993, 0.994, 0.994, 0.995, 0.996, 0.997, 0.998, 0.999, 0.999, 1, 1, 1, 1.001, 1.001, 1.001, 1.001, 1, 1, 1, 1, 1, 1)'
        : 'cubic-bezier(0.34, 1.35, 0.64, 1)';

    // --- Motor de resortes (solo para la cápsula del selector) ---
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
    // 1. ENTRADA DE LA PÁGINA
    // ====================================================================
    function rise(elements, startAt = 0) {
        let i = startAt;
        elements.forEach((el) => {
            if (!el) return;
            el.style.setProperty('--i', i++);
            el.classList.add('ios-in');
        });
        return i;
    }
    function pageEntrance() {
        rise([
            document.querySelector('.page-header'),
            document.querySelector('.current-plan-banner'),
            document.querySelector('.billing-toggle'),
            ...document.querySelectorAll('.pricing-grid > .pricing-card'),
        ]);
        document.addEventListener('animationend', (e) => {
            if (e.animationName === 'iosRiseMove' && e.target.classList.contains('ios-in')) {
                e.target.classList.remove('ios-in');
            }
        });
    }

    // Tabla comparativa y preguntas frecuentes: entran al llegar con el scroll
    function scrollReveal() {
        const items = [
            document.querySelector('.comparison-title'),
            document.querySelector('.comparison-table-wrapper'),
            document.querySelector('.faq-title'),
            ...document.querySelectorAll('.faq-item'),
        ].filter(Boolean);
        if (!('IntersectionObserver' in window) || reduce.matches) return;
        items.forEach((el) => el.classList.add('ios-wait'));
        let batch = 0, batchTimer = null;
        const io = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                const el = entry.target;
                io.unobserve(el);
                // Los que aparecen juntos entran escalonados
                el.style.setProperty('--i', batch++);
                clearTimeout(batchTimer);
                batchTimer = setTimeout(() => { batch = 0; }, 120);
                el.classList.remove('ios-wait');
                el.classList.add('ios-in');
            });
        }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
        items.forEach((el) => io.observe(el));
    }

    // ====================================================================
    // 2. MENSUAL / ANUAL: selector segmentado con cápsula que se desliza
    // ====================================================================
    function billingSegment() {
        const box = document.getElementById('billingToggleContainer');
        const input = document.getElementById('billingToggle');
        if (!box || !input) return;
        const labels = box.querySelectorAll('.toggle-label');
        if (labels.length < 2) return;

        const seg = document.createElement('div');
        seg.className = 'ios-billing-seg';
        seg.setAttribute('role', 'radiogroup');
        const thumb = document.createElement('span');
        thumb.className = 'ios-billing-thumb';
        thumb.setAttribute('aria-hidden', 'true');
        const monthly = document.createElement('button');
        const annual = document.createElement('button');
        [monthly, annual].forEach((b, i) => {
            b.type = 'button';
            b.className = 'ios-billing-opt';
            b.setAttribute('role', 'radio');
            b.appendChild(labels[i]);   // se mueven las etiquetas: siguen traduciéndose
        });
        const save = document.createElement('span');
        save.className = 'savings-badge';
        save.textContent = '-20%';
        annual.appendChild(save);
        seg.append(thumb, monthly, annual);
        box.appendChild(seg);
        box.classList.add('ios-billing');

        const X = spring(0, 440, 30), W = spring(0, 440, 30), S = spring(1, 600, 30, 0.001);
        let ready = false;
        function place(snap) {
            const a = input.checked ? annual : monthly;
            monthly.classList.toggle('active', !input.checked);
            annual.classList.toggle('active', input.checked);
            monthly.setAttribute('aria-checked', !input.checked);
            annual.setAttribute('aria-checked', input.checked);
            if (!a.offsetWidth) return;
            X.t = a.offsetLeft; W.t = a.offsetWidth;
            if (snap || !ready) { X.v = X.t; W.v = W.t; X.vel = W.vel = 0; }
            ready = true;
            render();
            kick();
        }
        function render() {
            const st = Math.min(Math.abs(X.vel) / 2600, 0.16);
            thumb.style.opacity = ready ? 1 : 0;
            thumb.style.width = `${W.v}px`;
            thumb.style.transform = `translateX(${X.v}px) scale(${S.v * (1 + st)}, ${S.v * (1 - st * 0.4)})`;
        }
        renderers.add(render);

        function choose(isAnnual) {
            if (input.checked === isAnnual) return;
            input.checked = isAnnual;
            input.dispatchEvent(new Event('change', { bubbles: true }));
            place(false);
        }
        monthly.addEventListener('click', () => choose(false));
        annual.addEventListener('click', () => choose(true));
        seg.addEventListener('pointerdown', (e) => {
            if (e.target.closest('.ios-billing-opt.active')) { S.t = 0.94; kick(); }
        });
        const release = () => { S.t = 1; kick(); };
        ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => seg.addEventListener(ev, release));
        input.addEventListener('change', () => place(false));
        if (window.ResizeObserver) new ResizeObserver(() => place(true)).observe(seg);
        place(true);
    }

    // ====================================================================
    // 3. PRECIOS: el número rueda del valor anterior al nuevo
    // ====================================================================
    const rolling = new WeakSet();
    function parsePrice(text) {
        const m = /\$\s*([\d,]+(?:\.(\d+))?)/.exec(text || '');
        if (!m) return null;
        return { n: parseFloat(m[1].replace(/,/g, '')), decimals: m[2] ? m[2].length : 0, commas: m[1].includes(',') };
    }
    function formatPrice(n, info) {
        const s = info.commas
            ? n.toLocaleString('es-MX', { minimumFractionDigits: info.decimals, maximumFractionDigits: info.decimals })
            : n.toFixed(info.decimals);
        return '$' + s;
    }
    function watchPrices() {
        document.querySelectorAll('.price-amount').forEach((el) => {
            let shown = parsePrice(el.textContent);
            new MutationObserver(() => {
                if (rolling.has(el)) return;
                const next = parsePrice(el.textContent);
                if (!next || !shown || next.n === shown.n) { shown = next; return; }
                const from = shown.n, to = next.n;
                shown = next;
                if (reduce.matches) return;
                rolling.add(el);
                const start = performance.now(), dur = 650;
                (function frame(now) {
                    const t = clamp((now - start) / dur);
                    const e = 1 - Math.pow(1 - t, 3);
                    el.textContent = formatPrice(from + (to - from) * e, next);
                    if (t < 1) requestAnimationFrame(frame);
                    else {
                        el.textContent = formatPrice(to, next);
                        requestAnimationFrame(() => rolling.delete(el));
                    }
                })(start);
                if (el.animate) {
                    el.animate(
                        [
                            { transform: `translateY(${to > from ? 10 : -10}px)`, filter: 'blur(4px)', opacity: 0.4 },
                            { transform: 'none', filter: 'blur(0)', opacity: 1 },
                        ],
                        { duration: 600, easing: SPRING }
                    );
                }
            }).observe(el, { childList: true, characterData: true, subtree: true });
        });
    }

    // ====================================================================
    // 4. MODAL DE API KEY: salida animada
    // ====================================================================
    function wrapApiKeyClose() {
        const orig = window.closeApiKeyModal;
        if (typeof orig !== 'function' || orig.__ios) return;
        const wrapped = function () {
            const args = arguments, self = this;
            const overlay = document.getElementById('apiKeyModalOverlay');
            if (!overlay || overlay.style.display === 'none' || reduce.matches) { orig.apply(self, args); return; }
            overlay.classList.add('ios-closing');
            setTimeout(() => { orig.apply(self, args); overlay.classList.remove('ios-closing'); }, 220);
        };
        wrapped.__ios = true;
        window.closeApiKeyModal = wrapped;
    }

    function init() {
        pageEntrance();
        billingSegment();
        watchPrices();
        scrollReveal();
        wrapApiKeyClose();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();