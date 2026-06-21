// ============================================
// TRANSLATIONS.JS — Sistema de traducción Attomos
// Idiomas: es, en, ru, uz, ja, zh, fr, pt, de, ko
// Uso: window.Translations.apply('en')
// ============================================

window.Translations = (function () {

    const STORAGE_KEY = 'attomos_lang';
    const DEFAULT_LANG = 'es';

    // ── Diccionario ─────────────────────────────────────────────────
    const dict = {

        es: {
            // Navbar
            nav_inicio:   'Inicio',
            nav_agentes:  'Agentes',
            nav_blog:     'Blog',
            nav_precios:  'Precios',
            nav_ninda:    'Ninda',
            nav_contacto: 'Contacto',
            nav_login:    'Iniciar sesión',
            nav_register: 'Registrarse',

            // Hero
            hero_line1:    'Automatiza tu negocio con',
            hero_subtitle: 'Crea Agentes inteligentes para WhatsApp, Messenger, Instagram y más. Disponible 24/7, listo en minutos y sin escribir una línea de código.',
            hero_cta:      'Crear mi Agente',

            // Social platforms section
            social_title: 'Integra con tus plataformas favoritas',

            // Platforms carousel section
            carousel_title:    'Agentes en Todas las Plataformas',
            carousel_subtitle: 'Llega a tus clientes donde sea que estén. Nuestros agentes se integran perfectamente con las plataformas más populares.',

            // Tutorial section
            tutorial_title:    '¿Cómo crear tu Agente IA?',
            tutorial_subtitle: 'En menos de 5 minutos tienes tu chatbot listo. Mira cómo funciona.',
            tutorial_step1_title: 'Crea tu cuenta',
            tutorial_step1_desc: 'Regístrate gratis en segundos',
            tutorial_step2_title: 'Configura tu agente',
            tutorial_step2_desc: 'Elige el giro y personaliza',
            tutorial_step3_title: 'Conecta WhatsApp',
            tutorial_step3_desc: 'Escanea el QR y listo',
            tutorial_step4_title: '¡Empieza a vender!',
            tutorial_step4_desc: 'Tu bot atiende 24/7',

            // Pricing section
            pricing_title:    'Planes y Precios',
            pricing_subtitle: 'Elige el plan perfecto para tu negocio. Cambia o cancela en cualquier momento.',
            billing_monthly:  'Mensual',
            billing_annual:   'Anual',
            plan_btn_primary:   'Elegir Plan',
            plan_btn_secondary: 'Contactar Ventas',
            price_period:       'por mes',
        },

        en: {
            nav_inicio:   'Home',
            nav_agentes:  'Agents',
            nav_blog:     'Blog',
            nav_precios:  'Pricing',
            nav_ninda:    'Ninda',
            nav_contacto: 'Contact',
            nav_login:    'Sign in',
            nav_register: 'Sign up',

            hero_line1:    'Automate your business with',
            hero_subtitle: 'Create intelligent agents for WhatsApp, Messenger, Instagram and more. Available 24/7, ready in minutes, no coding required.',
            hero_cta:      'Create my Agent',

            social_title: 'Integrate with your favorite platforms',

            carousel_title:    'Agents on Every Platform',
            carousel_subtitle: 'Reach your customers wherever they are. Our agents integrate seamlessly with the most popular platforms.',

            tutorial_title:    'How to create your AI Agent?',
            tutorial_subtitle: 'Your chatbot is ready in under 5 minutes. See how it works.',
            tutorial_step1_title: 'Create your account',
            tutorial_step1_desc: 'Sign up for free in seconds',
            tutorial_step2_title: 'Set up your agent',
            tutorial_step2_desc: 'Choose your industry & customize',
            tutorial_step3_title: 'Connect WhatsApp',
            tutorial_step3_desc: 'Scan the QR and you\'re done',
            tutorial_step4_title: 'Start selling!',
            tutorial_step4_desc: 'Your bot answers 24/7',

            pricing_title:    'Plans & Pricing',
            pricing_subtitle: 'Choose the perfect plan for your business. Change or cancel anytime.',
            billing_monthly:  'Monthly',
            billing_annual:   'Annual',
            plan_btn_primary:   'Choose Plan',
            plan_btn_secondary: 'Contact Sales',
            price_period:       'per month',
        },

        ru: {
            nav_inicio:   'Главная',
            nav_agentes:  'Агенты',
            nav_blog:     'Блог',
            nav_precios:  'Цены',
            nav_ninda:    'Ninda',
            nav_contacto: 'Контакты',
            nav_login:    'Войти',
            nav_register: 'Регистрация',

            hero_line1:    'Автоматизируй свой бизнес с',
            hero_subtitle: 'Создавайте умных агентов для WhatsApp, Messenger, Instagram и других платформ. Доступно 24/7, готово за минуты, без программирования.',
            hero_cta:      'Создать агента',

            social_title: 'Интегрируйтесь с любимыми платформами',

            carousel_title:    'Агенты на всех платформах',
            carousel_subtitle: 'Достигайте клиентов там, где они находятся. Наши агенты легко интегрируются с самыми популярными платформами.',

            tutorial_title:    'Как создать AI-агента?',
            tutorial_subtitle: 'Ваш чат-бот готов менее чем за 5 минут. Смотрите, как это работает.',
            tutorial_step1_title: 'Создайте аккаунт',
            tutorial_step1_desc: 'Зарегистрируйтесь бесплатно',
            tutorial_step2_title: 'Настройте агента',
            tutorial_step2_desc: 'Выберите отрасль и настройте',
            tutorial_step3_title: 'Подключите WhatsApp',
            tutorial_step3_desc: 'Отсканируйте QR-код',
            tutorial_step4_title: 'Начните продавать!',
            tutorial_step4_desc: 'Бот работает 24/7',

            pricing_title:    'Планы и цены',
            pricing_subtitle: 'Выберите идеальный план для вашего бизнеса. Меняйте или отменяйте в любое время.',
            billing_monthly:  'Месячный',
            billing_annual:   'Годовой',
            plan_btn_primary:   'Выбрать план',
            plan_btn_secondary: 'Связаться с продажами',
            price_period:       'в месяц',
        },

        uz: {
            nav_inicio:   'Bosh sahifa',
            nav_agentes:  'Agentlar',
            nav_blog:     'Blog',
            nav_precios:  'Narxlar',
            nav_ninda:    'Ninda',
            nav_contacto: 'Aloqa',
            nav_login:    'Kirish',
            nav_register: 'Ro\'yxatdan o\'tish',

            hero_line1:    'Biznesingizni avtomatlashtiring',
            hero_subtitle: 'WhatsApp, Messenger, Instagram va boshqalar uchun aqlli agentlar yarating. 24/7 ishlaydi, daqiqalarda tayyor, kod yozish shart emas.',
            hero_cta:      'Agentimni yaratish',

            social_title: 'Sevimli platformalaringiz bilan integratsiya qiling',

            carousel_title:    'Barcha platformalarda agentlar',
            carousel_subtitle: 'Mijozlaringizga ular qaerda bo\'lsa ham yeting. Agentlarimiz eng mashhur platformalar bilan muammosiz integratsiyalashadi.',

            tutorial_title:    'AI agentni qanday yaratish?',
            tutorial_subtitle: '5 daqiqadan kamroq vaqtda chatbotingiz tayyor. Qanday ishlashini ko\'ring.',
            tutorial_step1_title: 'Hisob yarating',
            tutorial_step1_desc: 'Soniyalarda bepul ro\'yxatdan o\'ting',
            tutorial_step2_title: 'Agentni sozlang',
            tutorial_step2_desc: 'Soha tanlang va sozlang',
            tutorial_step3_title: 'WhatsApp ulang',
            tutorial_step3_desc: 'QR-kodni skanerlang va tayyor',
            tutorial_step4_title: 'Sotishni boshlang!',
            tutorial_step4_desc: 'Botingiz 24/7 javob beradi',

            pricing_title:    'Rejalar va narxlar',
            pricing_subtitle: 'Biznesingiz uchun mukammal rejani tanlang. Istalgan vaqtda o\'zgartiring yoki bekor qiling.',
            billing_monthly:  'Oylik',
            billing_annual:   'Yillik',
            plan_btn_primary:   'Rejani tanlash',
            plan_btn_secondary: 'Savdo bilan bog\'lanish',
            price_period:       'oyiga',
        },

        ja: {
            nav_inicio:   'ホーム',
            nav_agentes:  'エージェント',
            nav_blog:     'ブログ',
            nav_precios:  '料金',
            nav_ninda:    'Ninda',
            nav_contacto: 'お問い合わせ',
            nav_login:    'ログイン',
            nav_register: '新規登録',

            hero_line1:    'ビジネスを自動化しよう',
            hero_subtitle: 'WhatsApp、Messenger、Instagramなど向けのインテリジェントエージェントを作成。24時間365日対応、数分で準備完了、コード不要。',
            hero_cta:      'エージェントを作成',

            social_title: 'お気に入りのプラットフォームと統合',

            carousel_title:    'あらゆるプラットフォームのエージェント',
            carousel_subtitle: 'どこにいてもお客様に届けましょう。当社のエージェントは最も人気のあるプラットフォームとシームレスに統合されます。',

            tutorial_title:    'AIエージェントの作り方',
            tutorial_subtitle: '5分以内にチャットボットの準備が整います。使い方をご覧ください。',
            tutorial_step1_title: 'アカウント作成',
            tutorial_step1_desc: '数秒で無料登録',
            tutorial_step2_title: 'エージェント設定',
            tutorial_step2_desc: '業種を選んでカスタマイズ',
            tutorial_step3_title: 'WhatsApp接続',
            tutorial_step3_desc: 'QRコードをスキャンして完了',
            tutorial_step4_title: '販売開始！',
            tutorial_step4_desc: 'ボットが24/7対応',

            pricing_title:    'プランと料金',
            pricing_subtitle: 'ビジネスに最適なプランを選びましょう。いつでも変更・解約可能。',
            billing_monthly:  '月払い',
            billing_annual:   '年払い',
            plan_btn_primary:   'プランを選択',
            plan_btn_secondary: '営業に問い合わせ',
            price_period:       '月額',
        },

        zh: {
            nav_inicio:   '首页',
            nav_agentes:  '智能体',
            nav_blog:     '博客',
            nav_precios:  '定价',
            nav_ninda:    'Ninda',
            nav_contacto: '联系我们',
            nav_login:    '登录',
            nav_register: '注册',

            hero_line1:    '用AI自动化您的业务',
            hero_subtitle: '为WhatsApp、Messenger、Instagram等平台创建智能代理。24/7全天候服务，几分钟内即可准备就绪，无需编写代码。',
            hero_cta:      '创建我的智能体',

            social_title: '与您最喜欢的平台集成',

            carousel_title:    '覆盖所有平台的智能体',
            carousel_subtitle: '无论客户在哪里，都能轻松触达。我们的智能体与最流行的平台无缝集成。',

            tutorial_title:    '如何创建AI智能体？',
            tutorial_subtitle: '不到5分钟即可准备好您的聊天机器人。看看它是如何工作的。',
            tutorial_step1_title: '创建账户',
            tutorial_step1_desc: '几秒钟内免费注册',
            tutorial_step2_title: '配置智能体',
            tutorial_step2_desc: '选择行业并自定义',
            tutorial_step3_title: '连接WhatsApp',
            tutorial_step3_desc: '扫描二维码即可完成',
            tutorial_step4_title: '开始销售！',
            tutorial_step4_desc: '机器人24/7响应',

            pricing_title:    '方案与定价',
            pricing_subtitle: '为您的业务选择完美方案。随时更改或取消。',
            billing_monthly:  '按月',
            billing_annual:   '按年',
            plan_btn_primary:   '选择方案',
            plan_btn_secondary: '联系销售',
            price_period:       '每月',
        },

        fr: {
            nav_inicio:   'Accueil',
            nav_agentes:  'Agents',
            nav_blog:     'Blog',
            nav_precios:  'Tarifs',
            nav_ninda:    'Ninda',
            nav_contacto: 'Contact',
            nav_login:    'Se connecter',
            nav_register: 'S\'inscrire',

            hero_line1:    'Automatisez votre entreprise avec',
            hero_subtitle: 'Créez des agents intelligents pour WhatsApp, Messenger, Instagram et plus. Disponible 24h/7j, prêt en minutes, sans une ligne de code.',
            hero_cta:      'Créer mon Agent',

            social_title: 'Intégrez vos plateformes préférées',

            carousel_title:    'Agents sur toutes les plateformes',
            carousel_subtitle: 'Atteignez vos clients où qu\'ils soient. Nos agents s\'intègrent parfaitement avec les plateformes les plus populaires.',

            tutorial_title:    'Comment créer votre Agent IA ?',
            tutorial_subtitle: 'Votre chatbot est prêt en moins de 5 minutes. Voyez comment ça fonctionne.',
            tutorial_step1_title: 'Créez votre compte',
            tutorial_step1_desc: 'Inscrivez-vous gratuitement en secondes',
            tutorial_step2_title: 'Configurez votre agent',
            tutorial_step2_desc: 'Choisissez le secteur et personnalisez',
            tutorial_step3_title: 'Connectez WhatsApp',
            tutorial_step3_desc: 'Scannez le QR et c\'est prêt',
            tutorial_step4_title: 'Commencez à vendre !',
            tutorial_step4_desc: 'Votre bot répond 24h/7j',

            pricing_title:    'Plans et Tarifs',
            pricing_subtitle: 'Choisissez le plan parfait pour votre entreprise. Modifiez ou annulez à tout moment.',
            billing_monthly:  'Mensuel',
            billing_annual:   'Annuel',
            plan_btn_primary:   'Choisir le plan',
            plan_btn_secondary: 'Contacter les ventes',
            price_period:       'par mois',
        },

        pt: {
            nav_inicio:   'Início',
            nav_agentes:  'Agentes',
            nav_blog:     'Blog',
            nav_precios:  'Preços',
            nav_ninda:    'Ninda',
            nav_contacto: 'Contato',
            nav_login:    'Entrar',
            nav_register: 'Cadastrar',

            hero_line1:    'Automatize seu negócio com',
            hero_subtitle: 'Crie Agentes inteligentes para WhatsApp, Messenger, Instagram e mais. Disponível 24/7, pronto em minutos, sem escrever código.',
            hero_cta:      'Criar meu Agente',

            social_title: 'Integre com suas plataformas favoritas',

            carousel_title:    'Agentes em Todas as Plataformas',
            carousel_subtitle: 'Alcance seus clientes onde quer que estejam. Nossos agentes se integram perfeitamente com as plataformas mais populares.',

            tutorial_title:    'Como criar seu Agente de IA?',
            tutorial_subtitle: 'Seu chatbot fica pronto em menos de 5 minutos. Veja como funciona.',
            tutorial_step1_title: 'Crie sua conta',
            tutorial_step1_desc: 'Cadastre-se gratuitamente em segundos',
            tutorial_step2_title: 'Configure seu agente',
            tutorial_step2_desc: 'Escolha o setor e personalize',
            tutorial_step3_title: 'Conecte o WhatsApp',
            tutorial_step3_desc: 'Escaneie o QR e pronto',
            tutorial_step4_title: 'Comece a vender!',
            tutorial_step4_desc: 'Seu bot atende 24/7',

            pricing_title:    'Planos e Preços',
            pricing_subtitle: 'Escolha o plano perfeito para o seu negócio. Mude ou cancele a qualquer momento.',
            billing_monthly:  'Mensal',
            billing_annual:   'Anual',
            plan_btn_primary:   'Escolher Plano',
            plan_btn_secondary: 'Falar com Vendas',
            price_period:       'por mês',
        },

        de: {
            nav_inicio:   'Startseite',
            nav_agentes:  'Agenten',
            nav_blog:     'Blog',
            nav_precios:  'Preise',
            nav_ninda:    'Ninda',
            nav_contacto: 'Kontakt',
            nav_login:    'Anmelden',
            nav_register: 'Registrieren',

            hero_line1:    'Automatisiere dein Unternehmen mit',
            hero_subtitle: 'Erstelle intelligente Agenten für WhatsApp, Messenger, Instagram und mehr. Verfügbar 24/7, in Minuten bereit, ohne eine Zeile Code.',
            hero_cta:      'Meinen Agenten erstellen',

            social_title: 'Integriere deine Lieblingsplattformen',

            carousel_title:    'Agenten auf allen Plattformen',
            carousel_subtitle: 'Erreiche deine Kunden, wo immer sie sind. Unsere Agenten integrieren sich nahtlos mit den beliebtesten Plattformen.',

            tutorial_title:    'Wie erstelle ich meinen KI-Agenten?',
            tutorial_subtitle: 'Dein Chatbot ist in weniger als 5 Minuten bereit. Sieh, wie es funktioniert.',
            tutorial_step1_title: 'Konto erstellen',
            tutorial_step1_desc: 'Kostenlos in Sekunden registrieren',
            tutorial_step2_title: 'Agenten konfigurieren',
            tutorial_step2_desc: 'Branche wählen und anpassen',
            tutorial_step3_title: 'WhatsApp verbinden',
            tutorial_step3_desc: 'QR-Code scannen und fertig',
            tutorial_step4_title: 'Verkaufen starten!',
            tutorial_step4_desc: 'Dein Bot antwortet 24/7',

            pricing_title:    'Pläne & Preise',
            pricing_subtitle: 'Wähle den perfekten Plan für dein Unternehmen. Jederzeit änderbar oder kündbar.',
            billing_monthly:  'Monatlich',
            billing_annual:   'Jährlich',
            plan_btn_primary:   'Plan wählen',
            plan_btn_secondary: 'Vertrieb kontaktieren',
            price_period:       'pro Monat',
        },

        ko: {
            nav_inicio:   '홈',
            nav_agentes:  '에이전트',
            nav_blog:     '블로그',
            nav_precios:  '요금제',
            nav_ninda:    'Ninda',
            nav_contacto: '연락처',
            nav_login:    '로그인',
            nav_register: '회원가입',

            hero_line1:    '비즈니스를 자동화하세요',
            hero_subtitle: 'WhatsApp, Messenger, Instagram 등을 위한 지능형 에이전트를 만드세요. 24/7 이용 가능, 몇 분 안에 준비 완료, 코드 없이 시작.',
            hero_cta:      '에이전트 만들기',

            social_title: '좋아하는 플랫폼과 통합하세요',

            carousel_title:    '모든 플랫폼의 에이전트',
            carousel_subtitle: '고객이 어디 있든 연결하세요. 저희 에이전트는 가장 인기 있는 플랫폼과 원활하게 통합됩니다.',

            tutorial_title:    'AI 에이전트를 만드는 방법',
            tutorial_subtitle: '5분 안에 챗봇이 준비됩니다. 작동 방식을 확인하세요.',
            tutorial_step1_title: '계정 만들기',
            tutorial_step1_desc: '몇 초 만에 무료 가입',
            tutorial_step2_title: '에이전트 설정',
            tutorial_step2_desc: '업종 선택 및 맞춤 설정',
            tutorial_step3_title: 'WhatsApp 연결',
            tutorial_step3_desc: 'QR 스캔 후 완료',
            tutorial_step4_title: '판매 시작!',
            tutorial_step4_desc: '봇이 24/7 응대',

            pricing_title:    '요금제 및 가격',
            pricing_subtitle: '비즈니스에 맞는 완벽한 요금제를 선택하세요. 언제든지 변경 또는 취소 가능.',
            billing_monthly:  '월간',
            billing_annual:   '연간',
            plan_btn_primary:   '요금제 선택',
            plan_btn_secondary: '영업팀 문의',
            price_period:       '월',
        },
    };

    // ── Mapa de keys → selectores CSS ───────────────────────────────
    // Cada entrada: [key, selector, propiedad ('text'|'html'|atributo)]
    const mappings = [
        // Navbar links (data-translate attrs en el HTML)
        ['nav_inicio',   '[data-translate="nav_inicio"]',   'text'],
        ['nav_agentes',  '[data-translate="nav_agentes"]',  'text'],
        ['nav_blog',     '[data-translate="nav_blog"]',     'text'],
        ['nav_precios',  '[data-translate="nav_precios"]',  'text'],
        ['nav_ninda',    '[data-translate="nav_ninda"]',    'text'],
        ['nav_contacto', '[data-translate="nav_contacto"]', 'text'],
        ['nav_login',    '[data-translate="nav_login"]',    'text'],
        ['nav_register', '[data-translate="nav_register"]', 'text'],

        // Hero
        ['hero_line1',    '[data-translate="hero_line1"]',    'text'],
        ['hero_subtitle', '[data-translate="hero_subtitle"]', 'text'],
        ['hero_cta',      '[data-translate="hero_cta"]',      'text'],

        // Social
        ['social_title', '[data-translate="social_title"]', 'text'],

        // Carousel
        ['carousel_title',    '[data-translate="carousel_title"]',    'text'],
        ['carousel_subtitle', '[data-translate="carousel_subtitle"]', 'text'],

        // Tutorial
        ['tutorial_title',       '[data-translate="tutorial_title"]',       'text'],
        ['tutorial_subtitle',    '[data-translate="tutorial_subtitle"]',     'text'],
        ['tutorial_step1_title', '[data-translate="tutorial_step1_title"]',  'text'],
        ['tutorial_step1_desc',  '[data-translate="tutorial_step1_desc"]',   'text'],
        ['tutorial_step2_title', '[data-translate="tutorial_step2_title"]',  'text'],
        ['tutorial_step2_desc',  '[data-translate="tutorial_step2_desc"]',   'text'],
        ['tutorial_step3_title', '[data-translate="tutorial_step3_title"]',  'text'],
        ['tutorial_step3_desc',  '[data-translate="tutorial_step3_desc"]',   'text'],
        ['tutorial_step4_title', '[data-translate="tutorial_step4_title"]',  'text'],
        ['tutorial_step4_desc',  '[data-translate="tutorial_step4_desc"]',   'text'],

        // Pricing
        ['pricing_title',      '[data-translate="pricing_title"]',      'text'],
        ['pricing_subtitle',   '[data-translate="pricing_subtitle"]',   'text'],
        ['billing_monthly',    '[data-translate="billing_monthly"]',    'text'],
        ['billing_annual',     '[data-translate="billing_annual"]',     'text'],
        ['plan_btn_primary',   '[data-translate="plan_btn_primary"]',   'text'],
        ['plan_btn_secondary', '[data-translate="plan_btn_secondary"]', 'text'],
        ['price_period',       '[data-translate="price_period"]',       'text'],
    ];

    // ── Aplicar idioma ───────────────────────────────────────────────
    function apply(lang) {
        const translations = dict[lang] || dict[DEFAULT_LANG];
        const isRTL = false; // ninguno de los idiomas actuales es RTL

        mappings.forEach(([key, selector, prop]) => {
            const val = translations[key];
            if (!val) return;
            document.querySelectorAll(selector).forEach(el => {
                if (prop === 'text') el.textContent = val;
                else if (prop === 'html') el.innerHTML = val;
                else el.setAttribute(prop, val);
            });
        });

        // Traducir botones de plan generados por Go templates
        document.querySelectorAll('.plan-button.primary').forEach(btn => {
            btn.textContent = translations['plan_btn_primary'] || btn.textContent;
        });
        document.querySelectorAll('.plan-button.secondary').forEach(btn => {
            btn.textContent = translations['plan_btn_secondary'] || btn.textContent;
        });
        document.querySelectorAll('.price-period').forEach(el => {
            el.textContent = translations['price_period'] || el.textContent;
        });

        // Guardar preferencia
        localStorage.setItem(STORAGE_KEY, lang);

        // Marcar activo en el botón del navbar
        document.querySelectorAll('.lang-option').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.lang === lang);
        });

        // Actualizar label del botón trigger
        const trigger = document.getElementById('langTriggerLabel');
        if (trigger) trigger.textContent = LANG_META[lang]?.flag + ' ' + LANG_META[lang]?.label;

        console.log(`🌐 Idioma aplicado: ${lang}`);
    }

    // ── Inicializar con idioma guardado o predeterminado ─────────────
    function init() {
        const saved = localStorage.getItem(STORAGE_KEY) || DEFAULT_LANG;
        apply(saved);
    }

    // ── Metadatos de idiomas (para el dropdown) ──────────────────────
    const LANG_META = {
        es: { label: 'Español',    flag: '🇲🇽' },
        en: { label: 'English',    flag: '🇺🇸' },
        ru: { label: 'Русский',    flag: '🇷🇺' },
        uz: { label: "O'zbekcha",  flag: '🇺🇿' },
        ja: { label: '日本語',      flag: '🇯🇵' },
        zh: { label: '中文',        flag: '🇨🇳' },
        fr: { label: 'Français',   flag: '🇫🇷' },
        pt: { label: 'Português',  flag: '🇧🇷' },
        de: { label: 'Deutsch',    flag: '🇩🇪' },
        ko: { label: '한국어',      flag: '🇰🇷' },
    };

    return { apply, init, dict, LANG_META };

})();

// Auto-inicializar cuando el DOM esté listo
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.Translations.init());
} else {
    window.Translations.init();
}