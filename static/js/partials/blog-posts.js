// ============================================
// BLOG POSTS DATA
// Fuente única de los artículos del blog. La usan blog.js (para abrir
// cada tarjeta) y blog-detail.js (para pintar el artículo completo).
// Bloques de contenido: p, h2, h3, ul, ol, quote, tip.
// En los textos se permite **negritas**; todo lo demás se escapa.
// ============================================
(function () {
    const AUTHOR = { name: 'Eduardo Martínez', role: 'CEO Attomos' };

    window.BLOG_POSTS = [
        // ------------------------------------------------------------
        // 1. DESTACADO
        // ------------------------------------------------------------
        {
            slug: 'ia-transformando-servicio-al-cliente-2025',
            category: 'ai',
            categoryLabel: 'Inteligencia Artificial',
            date: '10 Enero 2025',
            readTime: '8 min lectura',
            featured: true,
            title: 'Cómo la IA está transformando el servicio al cliente en 2025',
            excerpt: 'Descubre las últimas tendencias en chatbots con IA y cómo están revolucionando la manera en que las empresas interactúan con sus clientes. Desde respuestas personalizadas hasta análisis predictivo.',
            cover: 'https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1600&q=80',
            coverAlt: 'IA transformando servicio al cliente',
            author: AUTHOR,
            content: [
                { type: 'p', text: 'Hace apenas unos años, un "chatbot" era un menú de opciones disfrazado de conversación: escribe 1 para horarios, 2 para precios, 3 para hablar con un asesor. Funcionaba, pero nadie lo disfrutaba. En 2025 la historia es distinta. Los modelos de lenguaje permiten que un asistente entienda lo que el cliente quiso decir, aunque lo escriba con faltas de ortografía, con abreviaturas o mezclando tres preguntas en un solo mensaje.' },
                { type: 'p', text: 'Para una pyme mexicana esto no es un lujo tecnológico: es la diferencia entre contestar a las 11 de la noche o perder la venta con el competidor que sí respondió. En este artículo repasamos qué está cambiando, qué conviene adoptar ya y qué errores evitar.' },

                { type: 'h2', text: 'De los menús rígidos a las conversaciones naturales' },
                { type: 'p', text: 'El cambio más visible es la forma de conversar. Un agente con IA moderna no necesita que el cliente siga un guion. Si alguien escribe "oye, ¿tienen cita el sábado temprano y cuánto cuesta el corte?", el asistente puede identificar dos intenciones (disponibilidad y precio), responder ambas y proponer el siguiente paso.' },
                { type: 'p', text: 'Esto reduce la fricción de forma notable. El cliente siente que habla con alguien que lo escucha, y el negocio deja de perder conversaciones en el punto donde el menú no tenía la opción correcta.' },
                { type: 'tip', title: 'Idea clave', text: 'La IA no reemplaza el conocimiento de tu negocio: lo **amplifica**. Un asistente es tan bueno como la información que le das sobre tus productos, precios y políticas.' },

                { type: 'h2', text: 'Personalización en tiempo real' },
                { type: 'p', text: 'La segunda gran tendencia es la personalización. Cuando el asistente tiene acceso al historial del cliente, puede saludarlo por su nombre, recordar su último pedido o sugerir algo relacionado. No se trata de "adivinar", sino de usar el contexto que el propio cliente ya compartió.' },
                { type: 'ul', items: [
                    '**Contexto de la conversación:** el asistente recuerda lo que se dijo hace cinco mensajes y no vuelve a preguntar lo mismo.',
                    '**Contexto del cliente:** con una integración a tu CRM, sabe si es cliente frecuente o si es su primera vez.',
                    '**Contexto del negocio:** horarios, inventario o agenda disponibles en ese momento, por ejemplo desde Google Sheets o Google Calendar.'
                ] },
                { type: 'p', text: 'Un ejemplo sencillo: una clínica dental que conecta su agenda permite que el asistente ofrezca horarios reales en lugar de decir "en un momento te contactamos". La cita queda agendada en la misma conversación.' },

                { type: 'h2', text: 'Análisis predictivo y conversaciones que generan datos' },
                { type: 'p', text: 'Cada conversación es información. Cuando las conversaciones se registran de forma ordenada, el negocio puede detectar patrones: qué preguntan más los clientes, a qué hora escriben, qué productos generan dudas y en qué punto abandonan.' },
                { type: 'p', text: 'Con esos datos es posible anticiparse. Si notas que muchos clientes preguntan por envíos los lunes, puedes preparar una respuesta más completa o una promoción específica. Si cierta pregunta siempre termina en "lo pienso", quizá el precio no está bien explicado.' },
                { type: 'quote', text: 'El valor no está solo en responder más rápido, sino en entender mejor a tus clientes con cada mensaje que recibes.' },

                { type: 'h2', text: 'El papel del equipo humano' },
                { type: 'p', text: 'Una preocupación común es que la IA sustituya al equipo. En la práctica, lo que vemos en negocios pequeños y medianos es lo contrario: la IA absorbe las preguntas repetitivas y el equipo se queda con las conversaciones que realmente requieren criterio, empatía o negociación.' },
                { type: 'ol', items: [
                    'El asistente responde preguntas frecuentes, agenda citas y toma pedidos sencillos.',
                    'Cuando detecta una queja, una solicitud especial o una venta de alto valor, transfiere la conversación a una persona.',
                    'El asesor recibe el historial completo y no tiene que empezar desde cero.'
                ] },
                { type: 'p', text: 'Herramientas como Chatwoot facilitan este traspaso: el equipo ve todas las conversaciones en una bandeja compartida y puede intervenir en cualquier momento.' },

                { type: 'h2', text: 'Cómo empezar sin complicarte' },
                { type: 'p', text: 'No necesitas un proyecto de seis meses para aprovechar estas tendencias. Lo recomendable es empezar con un caso de uso claro y medir resultados antes de ampliar.' },
                { type: 'ul', items: [
                    'Elige el canal donde ya están tus clientes. En México, casi siempre es WhatsApp.',
                    'Reúne tus 20 preguntas más frecuentes y sus respuestas correctas.',
                    'Define cuándo debe intervenir una persona y quién será responsable.',
                    'Mide durante un mes: tiempo de respuesta, conversaciones atendidas y ventas o citas generadas.'
                ] },
                { type: 'p', text: 'En Attomos creamos agentes de IA para WhatsApp y Telegram pensados justo para este escenario. Puedes conectar un número en minutos con Atomic Bot escaneando un código QR, o usar Orbital Bot a través de la API oficial de Meta si buscas mayor volumen y estabilidad.' },
                { type: 'tip', title: 'Recomendación', text: 'Empieza pequeño, pero empieza. Un asistente que resuelve bien cinco preguntas frecuentes ya libera horas de trabajo a la semana.' },

                { type: 'h2', text: 'Conclusión' },
                { type: 'p', text: 'La IA aplicada al servicio al cliente dejó de ser una promesa para convertirse en una herramienta práctica y accesible. Las empresas que la adopten con un enfoque ordenado, con información clara, reglas de escalamiento y métricas, tendrán clientes mejor atendidos y equipos más enfocados en lo que importa.' }
            ]
        },

        // ------------------------------------------------------------
        // 2. TUTORIAL: PRIMER CHATBOT WHATSAPP
        // ------------------------------------------------------------
        {
            slug: 'guia-crea-tu-primer-chatbot-whatsapp',
            category: 'tutorials',
            categoryLabel: 'Tutoriales',
            date: '8 Enero 2025',
            readTime: '5 min lectura',
            title: 'Guía completa: Crea tu primer chatbot para WhatsApp',
            excerpt: 'Aprende paso a paso cómo configurar y lanzar tu primer chatbot en WhatsApp Business sin necesidad de programar.',
            cover: 'https://images.unsplash.com/photo-1611746872915-64382b5c76da?w=1600&q=80',
            coverAlt: 'Tutorial chatbot WhatsApp',
            author: AUTHOR,
            content: [
                { type: 'p', text: 'WhatsApp es el canal donde tus clientes ya están. Por eso, el primer chatbot de casi cualquier negocio en México debería vivir ahí. La buena noticia: hoy puedes lanzarlo sin escribir una sola línea de código. En esta guía te explicamos el proceso completo, desde la preparación hasta el lanzamiento.' },

                { type: 'h2', text: 'Antes de empezar: define el objetivo' },
                { type: 'p', text: 'El error más común es querer que el chatbot haga todo desde el primer día. Mejor elige un objetivo principal y construye a partir de ahí.' },
                { type: 'ul', items: [
                    '**Responder preguntas frecuentes:** horarios, ubicación, precios, formas de pago.',
                    '**Agendar citas:** ideal para clínicas, barberías, consultorios o talleres.',
                    '**Tomar pedidos:** restaurantes, tiendas de abarrotes, panaderías.',
                    '**Calificar prospectos:** inmobiliarias, agencias o servicios profesionales.'
                ] },
                { type: 'tip', title: 'Consejo', text: 'Escribe en una sola frase qué debe lograr tu chatbot. Por ejemplo: "Que cualquier cliente pueda agendar su cita en menos de dos minutos, a cualquier hora".' },

                { type: 'h2', text: 'Paso 1: Elige cómo conectar tu número' },
                { type: 'p', text: 'Existen dos caminos principales para conectar WhatsApp a un asistente de IA, y cada uno tiene ventajas distintas.' },
                { type: 'h3', text: 'Conexión por código QR' },
                { type: 'p', text: 'Es la forma más rápida. Escaneas un código QR desde tu WhatsApp, como cuando abres WhatsApp Web, y el asistente empieza a responder. En Attomos esto es **Atomic Bot**: ideal para empezar, probar y negocios con un volumen moderado de mensajes.' },
                { type: 'h3', text: 'Conexión por la API oficial de Meta' },
                { type: 'p', text: 'Requiere verificar tu negocio en Meta y registrar un número, pero ofrece mayor estabilidad y está pensada para volúmenes altos. En Attomos esto es **Orbital Bot**. Es la opción recomendada cuando el chatbot ya es una pieza central de tu operación.' },

                { type: 'h2', text: 'Paso 2: Prepara la información de tu negocio' },
                { type: 'p', text: 'Un asistente de IA aprende de lo que le compartes. Dedica una tarde a reunir esta información en un documento claro:' },
                { type: 'ol', items: [
                    'Nombre del negocio, dirección, horarios y días festivos.',
                    'Lista de productos o servicios con precios actualizados.',
                    'Políticas: envíos, devoluciones, anticipos, cancelaciones.',
                    'Las preguntas que más te hacen y cómo las respondes normalmente.',
                    'Situaciones en las que prefieres que te contacte una persona.'
                ] },
                { type: 'p', text: 'Mientras más concreta sea la información, mejores serán las respuestas. Evita frases ambiguas como "precios variables"; si el precio depende de algo, explica de qué.' },

                { type: 'h2', text: 'Paso 3: Define la personalidad del asistente' },
                { type: 'p', text: 'Tu chatbot es la primera impresión de tu marca. Decide cómo debe hablar: ¿formal o cercano?, ¿tutea al cliente?, ¿usa emojis? Una barbería juvenil y un despacho contable no deberían sonar igual.' },
                { type: 'quote', text: 'El tono correcto hace que el cliente olvide que está hablando con un asistente automático.' },

                { type: 'h2', text: 'Paso 4: Conecta tus herramientas' },
                { type: 'p', text: 'Aquí es donde el chatbot pasa de "contestar" a "resolver". Algunas integraciones útiles para empezar:' },
                { type: 'ul', items: [
                    '**Google Calendar:** para que el asistente consulte disponibilidad y agende citas reales.',
                    '**Google Sheets:** para registrar pedidos, prospectos o consultar inventario.',
                    '**Chatwoot:** para que tu equipo vea las conversaciones y pueda intervenir cuando haga falta.'
                ] },

                { type: 'h2', text: 'Paso 5: Prueba antes de lanzar' },
                { type: 'p', text: 'Pide a dos o tres personas de confianza que escriban como si fueran clientes. Que hagan preguntas difíciles, que escriban con errores, que pregunten cosas fuera de tema. Anota cada respuesta que no te convenza y ajusta la información.' },
                { type: 'tip', title: 'Lista rápida de pruebas', text: 'Pregunta por un producto que no vendes, pide un descuento, intenta agendar en un horario cerrado y escribe una queja. Así verás cómo reacciona en los casos límite.' },

                { type: 'h2', text: 'Paso 6: Lanza y mide' },
                { type: 'p', text: 'Una vez lanzado, revisa las conversaciones durante las primeras dos semanas. Te darás cuenta de preguntas que no habías considerado. Agrégalas a la información del asistente y verás cómo mejora semana a semana.' },
                { type: 'p', text: 'Crear tu primer chatbot es más sencillo de lo que parece. Lo importante es empezar con un objetivo claro, buena información y la disposición de mejorar con base en lo que te digan tus clientes.' }
            ]
        },

        // ------------------------------------------------------------
        // 3. NEGOCIOS: ROI
        // ------------------------------------------------------------
        {
            slug: 'formas-de-calcular-el-roi-de-tu-chatbot',
            category: 'business',
            categoryLabel: 'Negocios',
            date: '5 Enero 2025',
            readTime: '7 min lectura',
            title: '10 formas de calcular el ROI de tu chatbot',
            excerpt: 'Descubre las métricas clave para medir el retorno de inversión de tu chatbot y justificar la inversión ante tu equipo.',
            cover: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1600&q=80',
            coverAlt: 'ROI chatbots',
            author: AUTHOR,
            content: [
                { type: 'p', text: '"¿Y cuánto me va a regresar?" Es la pregunta correcta antes de invertir en cualquier herramienta. Con un chatbot, el retorno no siempre aparece en una sola línea del estado de resultados: se reparte entre tiempo ahorrado, ventas recuperadas y clientes más satisfechos. Aquí tienes diez formas de medirlo, agrupadas en tres frentes.' },
                { type: 'p', text: 'La fórmula base es sencilla: **ROI = (beneficio obtenido − costo de la herramienta) ÷ costo de la herramienta**. Lo difícil es estimar bien el beneficio. Veamos de dónde sale.' },

                { type: 'h2', text: 'Ahorro operativo' },
                { type: 'h3', text: '1. Horas de atención liberadas' },
                { type: 'p', text: 'Cuenta cuántas conversaciones resuelve el chatbot sin intervención humana y multiplícalas por el tiempo promedio que le tomaría a una persona. Por ejemplo, si el asistente resuelve 600 conversaciones al mes y cada una tomaría 4 minutos, son 40 horas liberadas.' },
                { type: 'h3', text: '2. Costo por conversación' },
                { type: 'p', text: 'Divide el costo mensual de tu atención (sueldos, herramientas) entre el número de conversaciones atendidas. Compara ese número antes y después del chatbot.' },
                { type: 'h3', text: '3. Menos errores en pedidos y citas' },
                { type: 'p', text: 'Un pedido mal tomado cuesta dinero: producto desperdiciado, envíos repetidos, clientes molestos. Si el asistente registra los datos de forma estructurada, por ejemplo en Google Sheets, esos errores disminuyen y puedes medirlos.' },

                { type: 'h2', text: 'Ingresos generados' },
                { type: 'h3', text: '4. Ventas fuera de horario' },
                { type: 'p', text: 'Registra cuántos pedidos o citas llegan entre las 8 de la noche y las 8 de la mañana. Antes del chatbot, muchos de esos clientes simplemente no esperaban respuesta.' },
                { type: 'h3', text: '5. Tasa de conversión de prospectos' },
                { type: 'p', text: 'Compara qué porcentaje de las personas que escriben termina comprando o agendando. Responder en segundos en lugar de horas suele mejorar esta tasa de manera visible.' },
                { type: 'h3', text: '6. Ticket promedio' },
                { type: 'p', text: 'Un asistente bien configurado puede sugerir complementos: "¿Te agrego unas bebidas?" o "Con el tratamiento completo ahorras en la segunda sesión". Mide si el valor promedio por venta cambia.' },
                { type: 'h3', text: '7. Ventas recuperadas' },
                { type: 'p', text: 'Los clientes que preguntaron y no compraron pueden recibir un seguimiento amable. Cuenta cuántas ventas provienen de esos recordatorios.' },
                { type: 'tip', title: 'Ejemplo ilustrativo', text: 'Si un negocio recibe 20 pedidos extra al mes fuera de horario con un ticket promedio de $350, son $7,000 adicionales. Si la herramienta cuesta $1,500 al mes, solo esa métrica ya justifica la inversión.' },

                { type: 'h2', text: 'Experiencia del cliente' },
                { type: 'h3', text: '8. Tiempo de primera respuesta' },
                { type: 'p', text: 'Es quizá la métrica más fácil de medir y la que más impacto tiene en la percepción del cliente. Pasar de horas a segundos cambia por completo la experiencia.' },
                { type: 'h3', text: '9. Satisfacción del cliente' },
                { type: 'p', text: 'Al final de la conversación, el asistente puede preguntar "¿Te ayudé con lo que necesitabas?". Una calificación simple del 1 al 5 te da una tendencia clara mes con mes.' },
                { type: 'h3', text: '10. Clientes que regresan' },
                { type: 'p', text: 'La retención es el indicador de largo plazo. Si los clientes que fueron bien atendidos vuelven a comprar con más frecuencia, ese valor acumulado es parte del retorno.' },

                { type: 'h2', text: 'Cómo presentar el ROI a tu equipo' },
                { type: 'p', text: 'No necesitas un reporte de 30 páginas. Una tabla con tres columnas, métrica, antes y después, suele ser suficiente para tomar decisiones.' },
                { type: 'ol', items: [
                    'Mide tu situación actual durante dos semanas antes de lanzar el chatbot.',
                    'Elige de tres a cinco métricas de esta lista, no todas.',
                    'Compara después de 30 y 90 días.',
                    'Incluye tanto el ahorro como los ingresos nuevos.'
                ] },
                { type: 'h3', text: 'Errores comunes al medir' },
                { type: 'ul', items: [
                    'Comparar meses con temporadas muy distintas, como diciembre contra febrero.',
                    'Atribuir al chatbot ventas que habrían ocurrido de todos modos.',
                    'Olvidar el tiempo de configuración y mantenimiento dentro del costo.',
                    'Medir solo el ahorro y dejar fuera los ingresos nuevos, o al revés.'
                ] },
                { type: 'quote', text: 'Lo que no se mide no se puede mejorar, pero lo que se mide de más tampoco se analiza. Elige pocas métricas y revísalas con constancia.' },
                { type: 'p', text: 'En Attomos, las conversaciones quedan registradas y puedes conectar Google Sheets para llevar estas métricas sin esfuerzo adicional. Así el ROI deja de ser una suposición y se convierte en un número que puedes revisar cada mes.' }
            ]
        },

        // ------------------------------------------------------------
        // 4. IA: TENDENCIAS
        // ------------------------------------------------------------
        {
            slug: 'futuro-de-la-ia-conversacional-tendencias-2025',
            category: 'ai',
            categoryLabel: 'Inteligencia Artificial',
            date: '3 Enero 2025',
            readTime: '6 min lectura',
            title: 'El futuro de la IA conversacional: Tendencias 2025',
            excerpt: 'Explora las tecnologías emergentes que están dando forma al futuro de los chatbots y la IA conversacional.',
            cover: 'https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=1600&q=80',
            coverAlt: 'IA conversacional',
            author: AUTHOR,
            content: [
                { type: 'p', text: 'La IA conversacional avanza tan rápido que lo que hace un año parecía experimental hoy está disponible para cualquier negocio. Estas son las tendencias que, desde nuestra experiencia construyendo agentes para pymes, consideramos más relevantes para este año.' },

                { type: 'h2', text: 'Agentes que actúan, no solo responden' },
                { type: 'p', text: 'La gran evolución es pasar de chatbots que contestan a agentes que ejecutan tareas. Un agente moderno puede consultar tu agenda, registrar un pedido, actualizar una hoja de cálculo o crear un contacto en tu CRM, todo dentro de la misma conversación.' },
                { type: 'p', text: 'Para el cliente, esto significa resolver su necesidad en un solo paso. Para el negocio, significa menos tareas manuales y menos información perdida entre mensajes.' },

                { type: 'h2', text: 'Modelos multimodales' },
                { type: 'p', text: 'Los modelos como Gemini ya pueden interpretar texto, imágenes y audio. En la práctica esto abre posibilidades muy concretas:' },
                { type: 'ul', items: [
                    'Un cliente envía la foto de una pieza y el asistente identifica qué producto necesita.',
                    'Alguien manda una nota de voz y el agente entiende la solicitud sin pedir que la escriba.',
                    'Se comparte la imagen de un comprobante de pago y el asistente la registra para revisión.'
                ] },
                { type: 'tip', title: 'Dato práctico', text: 'En México, las notas de voz son una forma muy común de comunicarse por WhatsApp. Un asistente que las entiende elimina una barrera importante.' },

                { type: 'h2', text: 'Memoria y contexto de largo plazo' },
                { type: 'p', text: 'Los asistentes empiezan a recordar más allá de una sola conversación. Saber que un cliente prefiere entregas por la tarde o que siempre pide lo mismo permite una atención mucho más personal, siempre que se maneje con transparencia y respeto a la privacidad.' },
                { type: 'quote', text: 'La mejor tecnología es la que hace que el cliente se sienta reconocido, no vigilado.' },

                { type: 'h2', text: 'Voz natural y respuestas en tiempo real' },
                { type: 'p', text: 'Las voces sintéticas son cada vez más naturales y la latencia sigue bajando. Aunque el texto seguirá siendo dominante en WhatsApp, veremos más negocios que atienden llamadas con asistentes de voz para tareas simples como confirmar citas o dar horarios.' },

                { type: 'h2', text: 'Un mismo agente en varios canales' },
                { type: 'p', text: 'Los clientes no piensan en canales: escriben donde les resulta más cómodo. Por eso cobra fuerza la idea de un solo agente con la misma información y el mismo tono, disponible en WhatsApp, Telegram o el chat del sitio web. Así el negocio mantiene un único "cerebro" que actualiza una sola vez.' },
                { type: 'ul', items: [
                    'Respuestas consistentes sin importar el canal de entrada.',
                    'Un historial unificado para que el equipo no pierda contexto.',
                    'Menos trabajo de mantenimiento: cambias un precio una vez y se refleja en todos lados.'
                ] },
                { type: 'p', text: 'Para muchas pymes, empezar en WhatsApp y sumar Telegram después es un camino natural, sobre todo si atienden a comunidades, grupos de clientes o equipos de reparto.' },

                { type: 'h2', text: 'Integración con las herramientas de siempre' },
                { type: 'p', text: 'La IA más útil no vive aislada. La tendencia es conectar los agentes con las herramientas que el negocio ya usa: calendarios, hojas de cálculo, sistemas de punto de venta y CRMs como Chatwoot. Esto evita que el equipo tenga que aprender plataformas nuevas.' },

                { type: 'h2', text: 'IA responsable y supervisión humana' },
                { type: 'p', text: 'Conforme los agentes hacen más cosas, es más importante definir límites claros. ¿Qué puede decidir el asistente por sí solo y qué debe pasar a una persona? Algunas buenas prácticas:' },
                { type: 'ol', items: [
                    'Indicar al cliente que está hablando con un asistente automatizado.',
                    'Escalar a una persona en quejas, reembolsos o temas delicados.',
                    'Revisar periódicamente las conversaciones para detectar respuestas incorrectas.',
                    'Proteger los datos personales y pedir solo la información necesaria.'
                ] },

                { type: 'h2', text: 'Qué significa todo esto para tu negocio' },
                { type: 'p', text: 'No necesitas adoptar todas las tendencias a la vez. Lo importante es elegir una plataforma que evolucione contigo. En Attomos trabajamos con modelos actuales como Gemini para que tus agentes de WhatsApp y Telegram mejoren sin que tengas que rehacer tu configuración.' },
                { type: 'p', text: 'El futuro de la IA conversacional no es lejano ni exclusivo de las grandes empresas. Ya está aquí, y las pymes que se animen a probarlo tendrán una ventaja real en la forma de atender a sus clientes.' }
            ]
        },

        // ------------------------------------------------------------
        // 5. AUTOMATIZACIÓN: EMBUDO DE VENTAS
        // ------------------------------------------------------------
        {
            slug: 'automatiza-tu-embudo-de-ventas-con-chatbots',
            category: 'automation',
            categoryLabel: 'Automatización',
            date: '1 Enero 2025',
            readTime: '8 min lectura',
            title: 'Automatiza tu embudo de ventas con chatbots inteligentes',
            excerpt: 'Aprende cómo los chatbots pueden capturar leads, calificarlos y nutrir prospectos automáticamente.',
            cover: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=1600&q=80',
            coverAlt: 'Automatización ventas',
            author: AUTHOR,
            content: [
                { type: 'p', text: 'Un embudo de ventas describe el camino que recorre una persona desde que conoce tu negocio hasta que compra. En muchas pymes ese camino tiene fugas: mensajes que nadie contesta, prospectos que nadie sigue, cotizaciones que se quedan en el aire. Un chatbot inteligente puede tapar buena parte de esas fugas.' },

                { type: 'h2', text: 'Las etapas del embudo en WhatsApp' },
                { type: 'p', text: 'Aunque cada negocio es distinto, la mayoría de los embudos conversacionales siguen cuatro etapas:' },
                { type: 'ol', items: [
                    '**Captura:** la persona escribe por primera vez, normalmente desde un anuncio, tus redes o tu sitio web.',
                    '**Calificación:** se entiende qué necesita, cuándo y con qué presupuesto.',
                    '**Nutrición:** se resuelven dudas, se comparten opciones y se genera confianza.',
                    '**Cierre:** se concreta la venta, la cita o la cotización formal.'
                ] },

                { type: 'h2', text: 'Captura: no dejes ningún mensaje sin respuesta' },
                { type: 'p', text: 'El primer contacto es el más frágil. Si alguien escribe por un anuncio y no recibe respuesta en minutos, es probable que ya esté hablando con otro proveedor. El chatbot garantiza una respuesta inmediata, a cualquier hora, con un saludo que continúa la conversación de forma natural.' },
                { type: 'tip', title: 'Consejo', text: 'Usa enlaces de WhatsApp con mensaje prellenado en tus anuncios, por ejemplo "Hola, vi la promoción de enero". Así el asistente sabe de dónde viene el prospecto.' },

                { type: 'h2', text: 'Calificación: preguntas correctas, en el orden correcto' },
                { type: 'p', text: 'Calificar no es interrogar. Un buen asistente hace dos o tres preguntas clave de forma conversacional y adapta las siguientes según las respuestas.' },
                { type: 'ul', items: [
                    '¿Qué producto o servicio le interesa?',
                    '¿Para cuándo lo necesita?',
                    '¿Es para uso personal o para un negocio?',
                    '¿En qué zona se encuentra? (útil para envíos o servicios a domicilio)'
                ] },
                { type: 'p', text: 'Con esas respuestas el asistente puede clasificar al prospecto, por ejemplo como "listo para comprar", "explorando" o "fuera de cobertura", y registrar el resultado en Google Sheets o en tu CRM.' },

                { type: 'h2', text: 'Nutrición: acompañar sin presionar' },
                { type: 'p', text: 'No todos compran en el primer mensaje. La etapa de nutrición consiste en resolver dudas y dar razones para elegirte. El asistente puede compartir fotos, explicar diferencias entre paquetes o responder objeciones comunes como precio, tiempos de entrega o garantía.' },
                { type: 'p', text: 'También puede programar seguimientos: si alguien pidió una cotización y no respondió, un mensaje amable unos días después puede reactivar la conversación. Recuerda respetar las políticas de WhatsApp sobre mensajes fuera de la ventana de conversación y no saturar al cliente.' },
                { type: 'quote', text: 'Un seguimiento oportuno no es insistencia: es buen servicio cuando el cliente aún tiene la necesidad.' },

                { type: 'h2', text: 'Cierre: facilita el último paso' },
                { type: 'p', text: 'Cuando el prospecto está listo, cada paso extra es una oportunidad de perderlo. El asistente puede agendar directamente en Google Calendar, generar un resumen del pedido o pasar la conversación a un asesor con todo el contexto para cerrar una venta de mayor valor.' },
                { type: 'h3', text: 'Cuándo pasar a una persona' },
                { type: 'p', text: 'Define reglas claras: ventas por encima de cierto monto, solicitudes personalizadas o clientes que piden hablar con alguien. En Chatwoot, tu equipo recibe estas conversaciones en una bandeja compartida y puede continuar sin repetir preguntas.' },

                { type: 'h2', text: 'Un ejemplo de embudo completo' },
                { type: 'p', text: 'Imagina una escuela de idiomas en Hermosillo. Publica un anuncio de cursos de inglés. El asistente responde al instante, pregunta el nivel y el horario preferido, explica las opciones y sus costos, y ofrece una clase muestra. Si la persona acepta, la agenda en el calendario; si no, programa un seguimiento para la semana siguiente. Todo queda registrado para que el equipo vea qué anuncios generan más inscripciones.' },

                { type: 'h2', text: 'Métricas para cada etapa' },
                { type: 'ul', items: [
                    '**Captura:** número de conversaciones nuevas y tiempo de primera respuesta.',
                    '**Calificación:** porcentaje de prospectos que completan las preguntas clave.',
                    '**Nutrición:** respuestas a seguimientos y dudas más frecuentes.',
                    '**Cierre:** ventas o citas concretadas y valor promedio.'
                ] },
                { type: 'p', text: 'Automatizar el embudo no significa quitarle lo humano a tus ventas. Significa que ninguna oportunidad se pierde por falta de tiempo, y que tu equipo llega a cada conversación importante con la información lista para cerrar.' }
            ]
        },

        // ------------------------------------------------------------
        // 6. TUTORIAL: CRM
        // ------------------------------------------------------------
        {
            slug: 'integra-tu-chatbot-con-tu-crm',
            category: 'tutorials',
            categoryLabel: 'Tutoriales',
            date: '28 Diciembre 2024',
            readTime: '10 min lectura',
            title: 'Integra tu chatbot con tu CRM favorito',
            excerpt: 'Tutorial paso a paso para conectar tu chatbot con Salesforce, HubSpot y otros CRMs populares.',
            cover: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1600&q=80',
            coverAlt: 'Integraciones chatbot',
            author: AUTHOR,
            content: [
                { type: 'p', text: 'Un chatbot sin CRM es como un vendedor sin libreta: atiende bien, pero al final del día nadie sabe qué pasó con cada cliente. Conectar tu asistente con un CRM convierte cada conversación en información útil para ventas, marketing y servicio. En esta guía te explicamos cómo planear y ejecutar esa integración.' },

                { type: 'h2', text: 'Por qué integrar tu chatbot con un CRM' },
                { type: 'ul', items: [
                    '**Un solo historial por cliente:** conversaciones, compras y notas en el mismo lugar.',
                    '**Seguimiento ordenado:** los prospectos no se pierden entre chats.',
                    '**Atención personalizada:** el asistente puede saber si habla con un cliente nuevo o recurrente.',
                    '**Reportes reales:** sabes cuántos prospectos genera WhatsApp y cuántos se convierten.'
                ] },

                { type: 'h2', text: 'Paso 1: Define qué información quieres guardar' },
                { type: 'p', text: 'Antes de conectar nada, decide qué datos son útiles. Guardar de más complica el CRM; guardar de menos lo hace inútil. Un buen punto de partida:' },
                { type: 'ol', items: [
                    'Nombre y número de teléfono.',
                    'Producto o servicio de interés.',
                    'Etapa del prospecto (nuevo, calificado, cotizado, cliente).',
                    'Origen del contacto (anuncio, redes, recomendación).',
                    'Resumen breve de la conversación.'
                ] },
                { type: 'tip', title: 'Privacidad', text: 'Pide solo los datos que realmente vas a usar y ten a la mano tu aviso de privacidad. La confianza del cliente vale más que cualquier campo extra.' },

                { type: 'h2', text: 'Paso 2: Elige el tipo de integración' },
                { type: 'h3', text: 'Integración nativa' },
                { type: 'p', text: 'Algunas plataformas ya traen conexiones listas. Es la opción más rápida: autorizas el acceso y eliges qué campos sincronizar. En Attomos, por ejemplo, la integración con **Chatwoot** permite que tu equipo vea y continúe las conversaciones desde una bandeja compartida.' },
                { type: 'h3', text: 'Integración por API y webhooks' },
                { type: 'p', text: 'CRMs como HubSpot y Salesforce ofrecen APIs para crear y actualizar contactos, negocios y notas. Un webhook es un aviso automático: cuando ocurre algo en el chatbot, como un prospecto calificado, se envía la información al CRM. Esta opción da más control, pero normalmente requiere apoyo técnico.' },
                { type: 'h3', text: 'Integración ligera con hojas de cálculo' },
                { type: 'p', text: 'Si aún no usas un CRM formal, Google Sheets es un excelente primer paso. El asistente registra cada prospecto en una fila y tu equipo trabaja desde ahí. Cuando el volumen crezca, puedes migrar esa información a un CRM completo.' },

                { type: 'h2', text: 'Paso 3: Mapea los campos' },
                { type: 'p', text: 'El mapeo consiste en decidir qué dato del chatbot va a qué campo del CRM. Haz una tabla sencilla con dos columnas: "dato en la conversación" y "campo en el CRM". Presta atención a los formatos: teléfonos con lada internacional (+52), fechas en un formato consistente y listas de opciones que coincidan con las del CRM.' },

                { type: 'h2', text: 'Paso 4: Evita contactos duplicados' },
                { type: 'p', text: 'Es el problema más común en estas integraciones. Usa el número de teléfono como identificador principal: antes de crear un contacto, el sistema debe buscar si ya existe y, en ese caso, actualizarlo en lugar de duplicarlo.' },

                { type: 'h2', text: 'Paso 5: Define los momentos de sincronización' },
                { type: 'p', text: 'No todo tiene que enviarse en cada mensaje. Elige eventos concretos:' },
                { type: 'ul', items: [
                    'Cuando inicia una conversación nueva: crear o buscar el contacto.',
                    'Cuando el prospecto se califica: actualizar su etapa.',
                    'Cuando se agenda una cita o se toma un pedido: registrar la actividad.',
                    'Cuando la conversación pasa a una persona: asignar al asesor responsable.'
                ] },

                { type: 'h2', text: 'Paso 6: Prueba con casos reales' },
                { type: 'p', text: 'Simula diferentes escenarios: un cliente nuevo, uno que ya existe, alguien que da datos incompletos y alguien que cambia de opinión a mitad de la conversación. Revisa en el CRM que cada caso quede registrado correctamente.' },
                { type: 'quote', text: 'Una integración funciona bien cuando tu equipo deja de preguntar "¿y este cliente quién es?".' },

                { type: 'h2', text: 'Errores comunes que debes evitar' },
                { type: 'ul', items: [
                    'Sincronizar todo sin un propósito claro.',
                    'No definir quién da seguimiento a los prospectos que llegan al CRM.',
                    'Olvidar revisar la integración después de cambios en el chatbot o en el CRM.',
                    'No capacitar al equipo para usar la información que ahora tienen disponible.'
                ] },
                { type: 'p', text: 'Integrar tu chatbot con tu CRM es una de las inversiones de tiempo con mayor retorno. Empieza con pocos campos y eventos, comprueba que funcionen y amplía conforme tu equipo lo necesite.' }
            ]
        },

        // ------------------------------------------------------------
        // 7. NEGOCIOS: CASOS DE ÉXITO
        // ------------------------------------------------------------
        {
            slug: 'casos-de-exito-empresas-que-revolucionaron-su-atencion',
            category: 'business',
            categoryLabel: 'Negocios',
            date: '25 Diciembre 2024',
            readTime: '12 min lectura',
            title: 'Casos de éxito: Empresas que revolucionaron su atención',
            excerpt: 'Conoce cómo empresas reales han implementado chatbots para mejorar su servicio al cliente y aumentar ventas.',
            cover: 'https://images.unsplash.com/photo-1553877522-43269d4ea984?w=1600&q=80',
            coverAlt: 'Casos de éxito',
            author: AUTHOR,
            content: [
                { type: 'p', text: 'La teoría ayuda, pero los ejemplos convencen. En este artículo reunimos escenarios basados en situaciones que vemos con frecuencia en negocios pequeños y medianos de México. Por respeto a la privacidad de nuestros clientes, los nombres son ilustrativos y las cifras se presentan como referencia, no como resultados garantizados.' },

                { type: 'h2', text: 'Restaurante familiar: pedidos sin teléfono ocupado' },
                { type: 'p', text: 'Un restaurante de comida sonorense recibía la mayoría de sus pedidos para llevar por WhatsApp. En las horas pico, una sola persona contestaba mensajes mientras atendía la caja. Resultado: mensajes sin responder, pedidos mal anotados y clientes molestos.' },
                { type: 'h3', text: 'Qué se implementó' },
                { type: 'ul', items: [
                    'Un asistente que comparte el menú, toma el pedido completo y confirma el total.',
                    'Registro automático de cada pedido en Google Sheets para la cocina.',
                    'Transferencia a una persona cuando el cliente tiene una petición especial.'
                ] },
                { type: 'h3', text: 'Qué cambió' },
                { type: 'p', text: 'El equipo dejó de copiar pedidos a mano y la persona de caja pudo enfocarse en los clientes presentes. En escenarios como este, es común que el tiempo de respuesta pase de varios minutos a unos segundos y que disminuyan los errores en los pedidos.' },

                { type: 'h2', text: 'Clínica dental: agenda llena sin llamadas' },
                { type: 'p', text: 'Una clínica con tres consultorios dedicaba buena parte del día a agendar, confirmar y reagendar citas por teléfono y WhatsApp. Las inasistencias eran frecuentes porque los recordatorios dependían de que alguien tuviera tiempo de enviarlos.' },
                { type: 'h3', text: 'Qué se implementó' },
                { type: 'ul', items: [
                    'Conexión del asistente con Google Calendar para ofrecer horarios reales.',
                    'Recordatorios de cita y opción de reagendar desde la misma conversación.',
                    'Respuestas sobre tratamientos, precios de referencia y preparación previa.'
                ] },
                { type: 'h3', text: 'Qué cambió' },
                { type: 'p', text: 'La recepción pasó de agendar a dar seguimiento a pacientes con tratamientos largos. Al facilitar el reagendado, los huecos en la agenda se pueden llenar con mayor facilidad.' },
                { type: 'tip', title: 'Lección', text: 'Cuando el cliente puede reagendar fácilmente, es menos probable que simplemente no se presente.' },

                { type: 'h2', text: 'Tienda en línea: ventas a cualquier hora' },
                { type: 'p', text: 'Una tienda de ropa que vendía por Instagram y WhatsApp recibía muchas preguntas por la noche: tallas, colores disponibles, tiempos de envío. Al día siguiente, muchos de esos clientes ya habían comprado en otro lado.' },
                { type: 'h3', text: 'Qué se implementó' },
                { type: 'ul', items: [
                    'Un asistente que consulta el inventario desde una hoja de cálculo.',
                    'Guía de tallas y políticas de cambio explicadas de forma clara.',
                    'Envío del enlace de pago y paso a una persona para confirmar el envío.'
                ] },
                { type: 'h3', text: 'Qué cambió' },
                { type: 'p', text: 'Las conversaciones nocturnas dejaron de enfriarse. La dueña revisa cada mañana los pedidos listos para empacar en lugar de un montón de mensajes pendientes.' },

                { type: 'h2', text: 'Inmobiliaria: prospectos calificados para los asesores' },
                { type: 'p', text: 'Una inmobiliaria invertía en anuncios que generaban muchos mensajes, pero los asesores pasaban horas respondiendo a personas que buscaban algo muy distinto a lo que ofrecían.' },
                { type: 'h3', text: 'Qué se implementó' },
                { type: 'ul', items: [
                    'Preguntas de calificación: zona, presupuesto, tipo de propiedad y forma de pago.',
                    'Envío automático de opciones que coinciden con lo que busca la persona.',
                    'Asignación del prospecto calificado a un asesor en Chatwoot, con el resumen completo.'
                ] },
                { type: 'h3', text: 'Qué cambió' },
                { type: 'p', text: 'Los asesores empezaron cada conversación sabiendo qué buscaba el cliente. Menos tiempo en filtros y más tiempo en visitas y cierres.' },
                { type: 'quote', text: 'El chatbot no vende la casa, pero sí se asegura de que el asesor hable con la persona correcta en el momento correcto.' },

                { type: 'h2', text: 'Lo que tienen en común estos casos' },
                { type: 'p', text: 'Aunque son negocios muy distintos, todos siguieron un patrón similar:' },
                { type: 'ol', items: [
                    '**Un problema concreto:** no buscaban "tener IA", sino resolver una situación específica.',
                    '**Información bien preparada:** menús, precios, políticas y horarios claros.',
                    '**Integración con sus herramientas:** calendario, hojas de cálculo o CRM.',
                    '**Reglas de escalamiento:** el equipo humano sigue presente cuando hace falta.',
                    '**Mejora continua:** revisaron conversaciones y ajustaron durante las primeras semanas.'
                ] },

                { type: 'h2', text: 'Cómo aplicar esto en tu negocio' },
                { type: 'p', text: 'Piensa en la tarea que más tiempo le quita a tu equipo en WhatsApp. Esa suele ser la mejor candidata para automatizar primero. Después, mide el antes y el después durante un mes.' },
                { type: 'p', text: 'En Attomos ayudamos a negocios como estos a lanzar agentes de IA en WhatsApp y Telegram, conectados con Google Calendar, Google Sheets y Chatwoot. Si quieres saber cómo se vería en tu caso, escríbenos y lo platicamos.' }
            ]
        }
    ];

    window.getBlogPost = function (slug) {
        return window.BLOG_POSTS.find(p => p.slug === slug) || null;
    };
})();