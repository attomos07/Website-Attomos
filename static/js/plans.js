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

    const NAMES = {
        es: { gratuito: { name: 'Plan Gratuito', desc: 'Perfecto para empezar sin compromisos', display: 'Gratuito' }, proton: { name: 'Plan Protón', desc: 'Ideal para empresas de servicios', display: 'Protón' }, neutron: { name: 'Plan Neutrón', desc: 'Ideal para e-commerce', display: 'Neutrón' } },
        en: { gratuito: { name: 'Free Plan', desc: 'Perfect for getting started with no commitments', display: 'Free' }, proton: { name: 'Proton Plan', desc: 'Ideal for service businesses', display: 'Proton' }, neutron: { name: 'Neutron Plan', desc: 'Ideal for e-commerce', display: 'Neutron' } },
        ru: { gratuito: { name: 'Бесплатный тариф', desc: 'Идеально для начала без обязательств', display: 'Бесплатно' }, proton: { name: 'Тариф Proton', desc: 'Идеально для сервисных компаний', display: 'Proton' }, neutron: { name: 'Тариф Neutron', desc: 'Идеально для e-commerce', display: 'Neutron' } },
        uz: { gratuito: { name: 'Bepul reja', desc: "Majburiyatlarsiz boshlash uchun ideal", display: 'Bepul' }, proton: { name: 'Proton rejasi', desc: "Xizmat ko'rsatuvchi bizneslar uchun ideal", display: 'Proton' }, neutron: { name: 'Neutron rejasi', desc: 'Elektron tijorat uchun ideal', display: 'Neutron' } },
        ja: { gratuito: { name: '無料プラン', desc: '契約なしで気軽に始められます', display: '無料' }, proton: { name: 'Protonプラン', desc: 'サービス業に最適', display: 'Proton' }, neutron: { name: 'Neutronプラン', desc: 'ECサイトに最適', display: 'Neutron' } },
        zh: { gratuito: { name: '免费套餐', desc: '轻松起步，无需承诺', display: '免费' }, proton: { name: 'Proton套餐', desc: '适合服务型企业', display: 'Proton' }, neutron: { name: 'Neutron套餐', desc: '适合电商企业', display: 'Neutron' } },
        fr: { gratuito: { name: 'Plan Gratuit', desc: 'Parfait pour commencer sans engagement', display: 'Gratuit' }, proton: { name: 'Plan Proton', desc: 'Idéal pour les entreprises de services', display: 'Proton' }, neutron: { name: 'Plan Neutron', desc: 'Idéal pour le e-commerce', display: 'Neutron' } },
        pt: { gratuito: { name: 'Plano Grátis', desc: 'Perfeito para começar sem compromisso', display: 'Grátis' }, proton: { name: 'Plano Proton', desc: 'Ideal para empresas de serviços', display: 'Proton' }, neutron: { name: 'Plano Neutron', desc: 'Ideal para e-commerce', display: 'Neutron' } },
        de: { gratuito: { name: 'Kostenloser Plan', desc: 'Perfekt für den unverbindlichen Einstieg', display: 'Kostenlos' }, proton: { name: 'Proton-Plan', desc: 'Ideal für Dienstleistungsunternehmen', display: 'Proton' }, neutron: { name: 'Neutron-Plan', desc: 'Ideal für E-Commerce', display: 'Neutron' } },
        ko: { gratuito: { name: '무료 요금제', desc: '약정 없이 시작하기 좋은 요금제', display: '무료' }, proton: { name: 'Proton 요금제', desc: '서비스 기업에 적합', display: 'Proton' }, neutron: { name: 'Neutron 요금제', desc: '이커머스에 적합', display: 'Neutron' } },
    };

    function features(lang, planId) {
        const f = F[lang] || F.es;
        if (planId === 'gratuito') return [f.wa1, f.waweb, f.spei, f.card, f.gemini, f.gsheets, f.gcal, f.hours, f.catSvc, f.promoSvc, f.photos, f.promoSvc, f.promoPeriods, f.multiBranch, f.jobs];
        if (planId === 'proton') return [f.agentsUnl, f.metaApi, f.contactsUnl, f.msgsUnl, f.gemini, f.chatwoot, f.gsheets, f.gcal, f.hours, f.catSvc, f.promoSvc, f.jobs];
        if (planId === 'neutron') return [f.agentsUnl, f.metaApi, f.contactsUnl, f.msgsUnl, f.chatwoot, f.gemini, f.gsheets, f.catProd, f.promoPacks, f.inventory, f.pos, f.jobs];
        return null;
    }

    function getPlanData(lang, planId) {
        const langNames = NAMES[lang] || NAMES.es;
        const n = langNames[planId];
        if (!n) return null;
        return { name: n.name, description: n.desc, display: n.display, features: features(lang, planId) };
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
            if (this.classList.contains('upgrade') || this.classList.contains('free-trial')) {
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

function handleUpgrade(plan) {
    console.log('Upgrading to plan:', plan);
    
    // Si es el plan gratuito, ir directo a select-plan
    if (plan === 'gratuito') {
        window.location.href = '/select-plan';
        return;
    }
    
    // Detectar si está en modo anual
    const billingToggle = document.getElementById('billingToggle');
    const isAnnual = billingToggle ? billingToggle.checked : false;
    const billingPeriod = isAnnual ? 'annual' : 'monthly';
    
    // Redirigir con parámetros de plan y período
    window.location.href = `/checkout?plan=${plan}&billing=${billingPeriod}`;
}

function handleContactSales() {
    console.log('Contact sales clicked');
    
    // Redirigir a formulario de contacto o abrir modal
    window.location.href = '/contact-sales';
}