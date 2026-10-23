/**
 * Keyword Engine v2 (Banana Traff MVP) — local semantic core generator: grounded keywords, clusters,
 * negative lists and RSA drafts. Ported 1:1 from keyword-engine-v2-new/server/engine.ts (types stripped).
 * Pure logic, no network: volume/CPC come from providers.js, SERP from providers.js, AI from ai.js.
 */
const RULES = {
  finance: {
    title: "Финансы / Криптовалюта / Forex",
    seedCommercialPrefixes: [
      "открыть брокерский счет",
      "купить акции онлайн",
      "торговая платформа mt5",
      "лучшие криптобиржи с выводом",
      "пассивный доход в долларах",
      "инвестиции для начинающих"
    ],
    productModifiers: ["CFD торговля", "стейкинг USDT", "Bitcoin ETF", "копитрейдинг", "золото спот"],
    competitorSeeds: ["Binance", "Bybit", "eToro", "Plus500", "Exness", "Interactive Brokers"],
    trustModifiers: ["отзывы клиентов 2026", "лицензия регулятора", "безопасный вывод денег", "проверка брокера"],
    informationalModifiers: ["как начать инвестировать", "стратегии скальпинга", "что такое плечо"],
    negativeCandidates: ["взлом терминала", "слив депозита бесплатно", "работа оператором вакансии", "чит на баланс"],
    cpcBenchmark: 3.4,
    policyRisk: "High",
    defaultPayout: 250,
    cr1: 0.08,
    cr2: 0.35
  },
  gambling: {
    title: "Казино / Беттинг / Слоты",
    seedCommercialPrefixes: [
      "казино с быстрым выводом",
      "бонус за первый депозит",
      "играть на реальные деньги",
      "официальный сайт казино",
      "лучшие слоты онлайн",
      "ставки на спорт онлайн"
    ],
    productModifiers: ["Gates of Olympus", "Sweet Bonanza", "Aviator игра", "JetX", "Crazy Time"],
    competitorSeeds: ["Betano", "1xBet", "Betsson", "Stake", "Codere", "Pin-Up"],
    trustModifiers: ["лицензионное казино", "реально платит отзывы", "проверка честности rtp"],
    informationalModifiers: ["как играть в слоты", "правила краш игры", "таблица выплат"],
    negativeCandidates: ["взлом слотов", "схемы обмана", "сигналы бот telegram", "работа крупье", "демо без денег"],
    cpcBenchmark: 1.65,
    policyRisk: "High",
    defaultPayout: 65,
    cr1: 0.14,
    cr2: 0.28
  },
  nutra: {
    title: "Нутра / Здоровье / БАДы",
    seedCommercialPrefixes: [
      "купить средство официальный сайт",
      "заказать с доставкой недорого",
      "натуральный комплекс цена",
      "оригинальный препарат аптека",
      "интернет магазин доставка курьером"
    ],
    productModifiers: ["капсулы растительные", "восстанавливающий крем", "капли очищение", "активный сбор"],
    competitorSeeds: ["Hondrocream", "Cardiline", "KetoDiet", "Optivis", "Prostaline"],
    trustModifiers: ["отзывы врачей специалистов", "сертификат соответствия", "результаты до и после"],
    informationalModifiers: ["симптомы и лечение", "профилактика в домашних условиях", "диета и режим"],
    negativeCandidates: ["своими руками рецепт", "народные методы форум", "скачать книгу бесплатно", "побочные эффекты"],
    cpcBenchmark: 0.95,
    policyRisk: "Medium",
    defaultPayout: 42,
    cr1: 0.12,
    cr2: 0.65
  },
  sweeps: {
    title: "Свипстейки / Опросы / CC-Submit",
    seedCommercialPrefixes: [
      "участвовать в розыгрыше призов",
      "получить подарочную карту",
      "онлайн опрос с вознаграждением",
      "акция года регистрация билета",
      "подарочный сертификат бесплатно"
    ],
    productModifiers: ["iPhone 16 Pro розыгрыш", "Amazon Gift Card $1000", "Walmart ваучер"],
    competitorSeeds: ["Sweepzone", "PrizeGrab", "SurveyJunkie", "Swagbucks"],
    trustModifiers: ["список победителей акции", "официальные условия регламент", "подтверждение выдачи"],
    informationalModifiers: ["как участвовать", "правила проведения конкурса"],
    negativeCandidates: ["генератор кодов накрутка", "взлом скрипта", "скам отзывы форум"],
    cpcBenchmark: 0.45,
    policyRisk: "Medium",
    defaultPayout: 24,
    cr1: 0.16,
    cr2: 0.5
  },
  ecommerce: {
    title: "E-commerce / White Services / Инфобизнес",
    seedCommercialPrefixes: [
      "купить онлайн с гарантией",
      "заказать с доставкой цена",
      "лучший сервис для работы",
      "официальный интернет магазин",
      "тарифы и скидки 2026"
    ],
    productModifiers: ["премиум пакет", "онлайн курс с сертификатом", "набор аксессуаров"],
    competitorSeeds: ["TopStore", "DirectShop", "MarketLeader"],
    trustModifiers: ["отзывы покупателей 2026", "гарантия возврата денег", "служба поддержки 24/7"],
    informationalModifiers: ["обзор функционала", "сравнение характеристик", "инструкция пользователя"],
    negativeCandidates: ["скачать бесплатно торрент", "слив курса складчина", "кряк активация"],
    cpcBenchmark: 1.1,
    policyRisk: "Low",
    defaultPayout: 50,
    cr1: 0.1,
    cr2: 0.4
  },
  other: {
    title: "Другие вертикали / Общие решения",
    seedCommercialPrefixes: [
      "заказать услугу онлайн",
      "лучший сервис под ключ",
      "официальный сайт компании",
      "стоимость и цены 2026"
    ],
    productModifiers: ["базовый тариф", "профессиональный сетап", "комплексное решение"],
    competitorSeeds: ["GlobalService", "PrimeSolution"],
    trustModifiers: ["надежная компания отзывы", "договор и гарантия качества"],
    informationalModifiers: ["как выбрать решение", "пошаговое руководство"],
    negativeCandidates: ["бесплатно без регистрации", "взлом скачать", "вакансии работа"],
    cpcBenchmark: 1.25,
    policyRisk: "Low",
    defaultPayout: 60,
    cr1: 0.1,
    cr2: 0.4
  }
};
const LOCALIZED_RULES = {
  de: {
    finance: {
      title: "Finanzen / Krypto / Forex",
      seedCommercialPrefixes: ["Brokerkonto eröffnen", "Aktien online kaufen", "MT5 Handelsplattform", "Krypto Börse mit Auszahlung", "Investieren für Anfänger", "seriöser Online Broker"],
      productModifiers: ["CFD Handel", "USDT Staking", "Bitcoin ETF", "Copy Trading", "Gold Spot Trading"],
      trustModifiers: ["Broker Erfahrungen", "regulierte Broker Lizenz", "sichere Auszahlung", "Broker prüfen"],
      informationalModifiers: ["wie investieren anfangen", "Scalping Strategie", "was ist Hebel Trading"],
      negativeCandidates: ["Trading Hack", "Depotverlust kostenlos", "Kundenservice Job", "Trading Cheat"]
    },
    gambling: {
      title: "Casino / Sportwetten / Slots",
      seedCommercialPrefixes: ["Casino schnelle Auszahlung", "Bonus für erste Einzahlung", "Casino Echtgeld spielen", "offizielle Casino Website", "beste Online Slots", "Sportwetten online"],
      productModifiers: ["Gates of Olympus", "Sweet Bonanza", "Aviator Spiel", "JetX", "Crazy Time"],
      trustModifiers: ["lizenziertes Casino", "Casino Erfahrungen Auszahlung", "RTP Fairness prüfen"],
      informationalModifiers: ["Slots spielen Anleitung", "Crash Spiel Regeln", "Casino Auszahlung Tabelle"],
      negativeCandidates: ["Slots Hack", "Casino Betrug Schema", "Casino Bot Telegram", "Croupier Job", "Demo Casino kostenlos"]
    },
    nutra: {
      title: "Nahrungsergänzung / Gesundheit",
      seedCommercialPrefixes: ["Nahrungsergänzung kaufen", "online bestellen Lieferung", "natürliches Produkt Preis", "originales Präparat kaufen", "Gesundheitsprodukte Online Shop"],
      productModifiers: ["pflanzliche Kapseln", "Regenerationscreme", "Reinigung Tropfen", "natürliche Mischung"],
      trustModifiers: ["Erfahrungen von Kunden", "Konformitätszertifikat", "Ergebnisse vorher nachher"],
      informationalModifiers: ["Symptome und Behandlung", "Prävention zu Hause", "Ernährung und Tagesplan"],
      negativeCandidates: ["Hausmittel Rezept", "Nebenwirkungen Forum", "Buch kostenlos herunterladen", "medizinische Studie"]
    },
    sweeps: {
      title: "Gewinnspiele / Umfragen / Prämien",
      seedCommercialPrefixes: ["an Gewinnspiel teilnehmen", "Geschenkkarte erhalten", "Online Umfrage mit Belohnung", "Gewinnspiel Anmeldung", "Gutschein online"],
      productModifiers: ["iPhone Gewinnspiel", "Amazon Geschenkkarte", "Walmart Gutschein"],
      trustModifiers: ["Gewinnerliste Gewinnspiel", "offizielle Teilnahmebedingungen", "Auszahlung bestätigt"],
      informationalModifiers: ["wie teilnehmen", "Gewinnspiel Regeln"],
      negativeCandidates: ["Code Generator", "Umfrage Betrug Forum", "Skript Hack", "Gewinnspiel Job"]
    },
    ecommerce: {
      title: "E-Commerce / Services / Infoprodukte",
      seedCommercialPrefixes: ["online kaufen mit Garantie", "bestellen mit Lieferung", "bester Service für Unternehmen", "offizieller Online Shop", "Preise und Angebote"],
      productModifiers: ["Premium Paket", "Online Kurs mit Zertifikat", "Zubehör Set"],
      trustModifiers: ["Kundenbewertungen", "Geld-zurück-Garantie", "Kundensupport"],
      informationalModifiers: ["Funktionsübersicht", "Eigenschaften vergleichen", "Bedienungsanleitung"],
      negativeCandidates: ["kostenloser Download Torrent", "Kurs Leak", "Crack Aktivierung"]
    },
    other: {
      title: "Andere Branchen / Allgemeine Lösungen",
      seedCommercialPrefixes: ["Dienstleistung online bestellen", "beste Komplettlösung", "offizielle Unternehmenswebsite", "Preise und Kosten"],
      productModifiers: ["Basispaket", "professionelles Setup", "Komplettlösung"],
      trustModifiers: ["Unternehmen Erfahrungen", "Vertrag und Qualitätsgarantie"],
      informationalModifiers: ["Lösung auswählen", "Schritt-für-Schritt-Anleitung"],
      negativeCandidates: ["kostenlos ohne Anmeldung", "Download Hack", "Stellenangebote Arbeit"]
    }
  },
  en: {
    finance: {
      title: "Finance / Crypto / Forex",
      seedCommercialPrefixes: ["open a broker account", "buy stocks online", "MT5 trading platform", "crypto exchange with withdrawal", "investing for beginners", "regulated online broker"],
      productModifiers: ["CFD trading", "USDT staking", "Bitcoin ETF", "copy trading", "spot gold trading"],
      trustModifiers: ["broker reviews", "regulated broker license", "safe withdrawal", "check a broker"],
      informationalModifiers: ["how to start investing", "scalping strategy", "what is trading leverage"],
      negativeCandidates: ["trading hack", "free deposit loss", "customer service job", "balance cheat"]
    },
    gambling: {
      title: "Casino / Sports Betting / Slots",
      seedCommercialPrefixes: ["casino with fast withdrawal", "first deposit bonus", "play casino for real money", "official casino website", "best online slots", "sports betting online"],
      productModifiers: ["Gates of Olympus", "Sweet Bonanza", "Aviator game", "JetX", "Crazy Time"],
      trustModifiers: ["licensed casino", "casino payout reviews", "check RTP fairness"],
      informationalModifiers: ["how to play slots", "crash game rules", "casino payout table"],
      negativeCandidates: ["slot hack", "casino scam scheme", "casino bot telegram", "dealer job", "free demo casino"]
    },
    nutra: {
      title: "Supplements / Health",
      seedCommercialPrefixes: ["buy health supplement", "order online with delivery", "natural product price", "original supplement", "health products online shop"],
      productModifiers: ["plant-based capsules", "recovery cream", "detox drops", "natural formula"],
      trustModifiers: ["customer reviews", "certificate of conformity", "before and after results"],
      informationalModifiers: ["symptoms and treatment", "home prevention", "diet and routine"],
      negativeCandidates: ["homemade recipe", "side effects forum", "download book free", "medical study"]
    },
    sweeps: {
      title: "Sweepstakes / Surveys / Rewards",
      seedCommercialPrefixes: ["enter a prize draw", "get a gift card", "paid online survey", "sweepstakes registration", "online voucher"],
      productModifiers: ["iPhone giveaway", "Amazon gift card", "Walmart voucher"],
      trustModifiers: ["sweepstakes winners list", "official rules", "prize delivery confirmation"],
      informationalModifiers: ["how to enter", "sweepstakes rules"],
      negativeCandidates: ["code generator", "survey scam forum", "script hack", "sweepstakes job"]
    },
    ecommerce: {
      title: "E-commerce / Services / Infoproducts",
      seedCommercialPrefixes: ["buy online with warranty", "order with delivery", "best service for business", "official online store", "prices and discounts"],
      productModifiers: ["premium package", "online course with certificate", "accessories set"],
      trustModifiers: ["customer reviews", "money-back guarantee", "customer support"],
      informationalModifiers: ["feature overview", "compare features", "user instructions"],
      negativeCandidates: ["free download torrent", "course leak", "crack activation"]
    },
    other: {
      title: "Other industries / General solutions",
      seedCommercialPrefixes: ["order a service online", "best all-in-one solution", "official company website", "pricing and costs"],
      productModifiers: ["basic package", "professional setup", "complete solution"],
      trustModifiers: ["company reviews", "contract and quality guarantee"],
      informationalModifiers: ["how to choose a solution", "step-by-step guide"],
      negativeCandidates: ["free without registration", "download hack", "jobs and vacancies"]
    }
  },
  es: {
    finance: {
      title: "Finanzas / Cripto / Forex",
      seedCommercialPrefixes: ["abrir cuenta de bróker", "comprar acciones online", "plataforma de trading MT5", "exchange de criptomonedas con retiro", "invertir para principiantes", "bróker online regulado"],
      productModifiers: ["trading CFD", "staking de USDT", "ETF de Bitcoin", "copy trading", "oro al contado"],
      trustModifiers: ["opiniones del bróker", "licencia del bróker", "retiro seguro", "verificar bróker"],
      informationalModifiers: ["cómo empezar a invertir", "estrategia de scalping", "qué es el apalancamiento"],
      negativeCandidates: ["hack de trading", "pérdida de depósito gratis", "trabajo atención al cliente", "truco de saldo"]
    },
    gambling: {
      title: "Casino / Apuestas / Slots",
      seedCommercialPrefixes: ["casino con retiro rápido", "bono primer depósito", "casino con dinero real", "sitio oficial casino", "mejores slots online", "apuestas deportivas online"],
      productModifiers: ["Gates of Olympus", "Sweet Bonanza", "juego Aviator", "JetX", "Crazy Time"],
      trustModifiers: ["casino con licencia", "opiniones de pagos casino", "verificar RTP"],
      informationalModifiers: ["cómo jugar slots", "reglas del juego crash", "tabla de pagos casino"],
      negativeCandidates: ["hack de slots", "estafa casino", "bot casino Telegram", "trabajo crupier", "casino demo gratis"]
    },
    nutra: {
      title: "Suplementos / Salud",
      seedCommercialPrefixes: ["comprar suplemento de salud", "pedir online con entrega", "precio producto natural", "suplemento original", "tienda online de salud"],
      productModifiers: ["cápsulas vegetales", "crema reparadora", "gotas depurativas", "fórmula natural"],
      trustModifiers: ["opiniones de clientes", "certificado de conformidad", "resultados antes y después"],
      informationalModifiers: ["síntomas y tratamiento", "prevención en casa", "dieta y rutina"],
      negativeCandidates: ["receta casera", "efectos secundarios foro", "descargar libro gratis", "estudio médico"]
    },
    sweeps: {
      title: "Sorteos / Encuestas / Recompensas",
      seedCommercialPrefixes: ["participar en sorteo", "recibir tarjeta regalo", "encuesta online remunerada", "registro sorteo", "vale online"],
      productModifiers: ["sorteo iPhone", "tarjeta Amazon", "vale Walmart"],
      trustModifiers: ["lista de ganadores", "reglas oficiales", "confirmación de entrega"],
      informationalModifiers: ["cómo participar", "reglas del sorteo"],
      negativeCandidates: ["generador de códigos", "estafa encuesta foro", "hack script", "trabajo sorteo"]
    },
    ecommerce: {
      title: "E-commerce / Servicios / Infoproductos",
      seedCommercialPrefixes: ["comprar online con garantía", "pedir con entrega", "mejor servicio para empresas", "tienda online oficial", "precios y descuentos"],
      productModifiers: ["paquete premium", "curso online con certificado", "set de accesorios"],
      trustModifiers: ["opiniones de compradores", "garantía de devolución", "atención al cliente"],
      informationalModifiers: ["resumen de funciones", "comparar características", "instrucciones de uso"],
      negativeCandidates: ["descarga gratis torrent", "filtración curso", "activación crack"]
    },
    other: {
      title: "Otros sectores / Soluciones generales",
      seedCommercialPrefixes: ["pedir servicio online", "mejor solución integral", "sitio web oficial empresa", "precios y costes"],
      productModifiers: ["paquete básico", "configuración profesional", "solución completa"],
      trustModifiers: ["opiniones de la empresa", "contrato y garantía de calidad"],
      informationalModifiers: ["cómo elegir una solución", "guía paso a paso"],
      negativeCandidates: ["gratis sin registro", "descargar hack", "empleo y vacantes"]
    }
  },
  vi: {
    gambling: {
      title: "Casino / Cá cược / Slot",
      seedCommercialPrefixes: ["casino trực tuyến uy tín", "casino rút tiền nhanh", "đăng ký casino online", "chơi casino tiền thật", "khuyến mãi casino", "cá cược thể thao online"],
      productModifiers: ["game nổ hũ", "Sweet Bonanza", "Aviator game", "JetX", "Crazy Time"],
      trustModifiers: ["casino được cấp phép", "casino đánh giá rút tiền", "kiểm tra độ uy tín casino", "1win có lừa đảo không"],
      informationalModifiers: ["cách chơi slot", "luật game crash", "bảng thanh toán casino", "cách nạp tiền casino", "cách rút tiền casino"],
      negativeCandidates: ["hack slot", "tool gian lận casino", "bot casino telegram", "việc làm đại lý casino", "casino demo miễn phí"]
    },
    finance: {
      title: "Tài chính / Crypto / Forex",
      seedCommercialPrefixes: ["mở tài khoản broker", "sàn crypto uy tín", "mua cổ phiếu online", "nền tảng giao dịch", "broker được cấp phép"],
      productModifiers: ["giao dịch CFD", "staking USDT", "sàn Bitcoin", "copy trading"],
      trustModifiers: ["đánh giá broker", "broker có giấy phép", "rút tiền an toàn", "kiểm tra broker"],
      informationalModifiers: ["cách bắt đầu đầu tư", "chiến lược giao dịch", "đòn bẩy là gì"],
      negativeCandidates: ["hack tài khoản trading", "bot trading miễn phí", "việc làm chăm sóc khách hàng", "tín hiệu miễn phí"]
    },
    nutra: {
      title: "Thực phẩm bổ sung / Sức khỏe",
      seedCommercialPrefixes: ["mua thực phẩm bổ sung", "đặt hàng online giao tận nơi", "sản phẩm sức khỏe chính hãng", "giá sản phẩm tự nhiên"],
      productModifiers: ["viên nang thảo dược", "kem phục hồi", "sản phẩm giảm cân"],
      trustModifiers: ["đánh giá khách hàng", "chứng nhận sản phẩm", "kiểm tra nguồn gốc"],
      informationalModifiers: ["cách sử dụng", "thành phần sản phẩm", "hướng dẫn dùng"],
      negativeCandidates: ["công thức tự làm", "tải sách miễn phí", "việc làm nhà thuốc", "tác dụng phụ diễn đàn"]
    },
    sweeps: {
      title: "Giveaway / Khảo sát / Phần thưởng",
      seedCommercialPrefixes: ["tham gia chương trình trúng thưởng", "nhận thẻ quà tặng", "khảo sát online nhận thưởng", "đăng ký giveaway"],
      productModifiers: ["quà tặng iPhone", "thẻ quà tặng Amazon"],
      trustModifiers: ["danh sách người thắng", "thể lệ chính thức", "xác nhận nhận thưởng"],
      informationalModifiers: ["cách tham gia", "thể lệ chương trình"],
      negativeCandidates: ["tạo mã miễn phí", "hack khảo sát", "việc làm giveaway"]
    },
    ecommerce: {
      title: "Thương mại điện tử / Dịch vụ",
      seedCommercialPrefixes: ["mua online chính hãng", "đặt hàng giao tận nơi", "dịch vụ cho doanh nghiệp", "bảng giá dịch vụ"],
      productModifiers: ["gói cao cấp", "khóa học online", "bộ phụ kiện"],
      trustModifiers: ["đánh giá khách hàng", "bảo hành hoàn tiền", "hỗ trợ khách hàng"],
      informationalModifiers: ["so sánh tính năng", "hướng dẫn sử dụng", "đánh giá sản phẩm"],
      negativeCandidates: ["tải miễn phí torrent", "crack kích hoạt", "việc làm bán hàng"]
    },
    other: {
      title: "Ngành khác / Giải pháp chung",
      seedCommercialPrefixes: ["đặt dịch vụ online", "giải pháp trọn gói", "website chính thức", "bảng giá dịch vụ"],
      productModifiers: ["gói cơ bản", "thiết lập chuyên nghiệp", "giải pháp hoàn chỉnh"],
      trustModifiers: ["đánh giá công ty", "hợp đồng và bảo hành", "hỗ trợ khách hàng"],
      informationalModifiers: ["cách chọn giải pháp", "hướng dẫn từng bước"],
      negativeCandidates: ["miễn phí không đăng ký", "tải hack", "việc làm tuyển dụng"]
    }
  },
  pl: {
    finance: {
      title: "Finanse / Kryptowaluty / Forex",
      seedCommercialPrefixes: ["otworzyć konto maklerskie", "kupować akcje online", "platforma tradingowa MT5", "giełda kryptowalut wypłata", "inwestowanie dla początkujących", "regulowany broker online"],
      productModifiers: ["handel CFD", "staking USDT", "ETF Bitcoin", "copy trading", "handel złotem"],
      trustModifiers: ["opinie o brokerze", "licencja brokera", "bezpieczna wypłata", "sprawdzić brokera"],
      informationalModifiers: ["jak zacząć inwestować", "strategia scalpingu", "co to jest dźwignia"],
      negativeCandidates: ["hack konta tradingowego", "darmowa strata depozytu", "praca obsługa klienta", "oszustwo tradingowe"]
    },
    gambling: {
      title: "Kasyno / Zakłady sportowe / Sloty",
      seedCommercialPrefixes: ["kasyno szybka wypłata", "bonus za pierwszy depozyt", "kasyno na prawdziwe pieniądze", "oficjalna strona kasyna", "najlepsze sloty online", "zakłady sportowe online"],
      productModifiers: ["gry kasynowe online", "bonus kasynowy", "sloty online", "automaty online", "gry crash", "kasyno z bonusem", "streamer kasyno", "polski streamer kasynowy", "influencer kasynowy Polska", "bloger kasynowy Polska", "live casino stream", "kasyno na Twitchu", "kasyno na YouTube", "kasyno na Kick"],
      trustModifiers: ["legalne kasyno", "opinie o wypłatach kasyna", "sprawdzić uczciwość RTP"],
      informationalModifiers: ["jak grać na slotach", "najlepsze sloty za darmo", "gry slot online", "recenzja slotów", "zasady gry crash", "tabela wypłat kasyna", "polscy streamerzy kasynowi", "polski streamer casino", "stream kasyna na żywo", "transmisje kasyna online", "polski youtuber kasynowy", "kanał YouTube o kasynach", "Twitch kasyno Polska", "Kick kasyno Polska", "blog o kasynach Polska"],
      negativeCandidates: ["hack slotów", "oszustwo kasyna", "bot kasyno telegram", "praca krupiera", "darmowe kasyno demo"]
    },
    nutra: {
      title: "Suplementy / Zdrowie",
      seedCommercialPrefixes: ["kupić suplement diety", "zamówić online z dostawą", "naturalny produkt cena", "oryginalny suplement", "sklep internetowy zdrowie"],
      productModifiers: ["kapsułki roślinne", "krem regenerujący", "naturalna formuła", "produkt odchudzający"],
      trustModifiers: ["opinie klientów", "certyfikat produktu", "wyniki przed i po"],
      informationalModifiers: ["objawy i leczenie", "profilaktyka w domu", "dieta i plan dnia"],
      negativeCandidates: ["domowy przepis", "skutki uboczne forum", "pobierz książkę za darmo", "badanie medyczne"]
    },
    sweeps: {
      title: "Konkursy / Ankiety / Nagrody",
      seedCommercialPrefixes: ["wziąć udział w konkursie", "otrzymać kartę podarunkową", "płatna ankieta online", "rejestracja konkursu", "bon online"],
      productModifiers: ["konkurs iPhone", "karta podarunkowa Amazon", "bon zakupowy"],
      trustModifiers: ["lista zwycięzców konkursu", "oficjalny regulamin", "potwierdzenie dostawy nagrody"],
      informationalModifiers: ["jak wziąć udział", "zasady konkursu"],
      negativeCandidates: ["generator kodów", "oszustwo ankiety forum", "hack skryptu", "praca przy konkursie"]
    },
    ecommerce: {
      title: "E-commerce / Usługi / Infoprodukty",
      seedCommercialPrefixes: ["kupić online z gwarancją", "zamówić z dostawą", "najlepsza usługa dla firm", "oficjalny sklep internetowy", "ceny i rabaty"],
      productModifiers: ["pakiet premium", "kurs online z certyfikatem", "zestaw akcesoriów"],
      trustModifiers: ["opinie klientów", "gwarancja zwrotu pieniędzy", "obsługa klienta"],
      informationalModifiers: ["opis funkcji", "porównać cechy", "instrukcja obsługi"],
      negativeCandidates: ["darmowy torrent", "wyciek kursu", "crack aktywacji"]
    },
    other: {
      title: "Inne branże / Rozwiązania ogólne",
      seedCommercialPrefixes: ["zamówić usługę online", "kompleksowe rozwiązanie", "oficjalna strona firmy", "cennik i koszty"],
      productModifiers: ["pakiet podstawowy", "profesjonalna konfiguracja", "kompletne rozwiązanie"],
      trustModifiers: ["opinie o firmie", "umowa i gwarancja jakości"],
      informationalModifiers: ["jak wybrać rozwiązanie", "instrukcja krok po kroku"],
      negativeCandidates: ["darmowa wersja", "pobierz hack", "praca i oferty pracy"]
    }
  }
};
function getRule(vertical, language) {
  const base = RULES[vertical] || RULES.other;
  const languageCode = language.toLowerCase().split("-")[0];
  const patch = LOCALIZED_RULES[languageCode]?.[vertical];
  return patch ? { ...base, ...patch } : base;
}
const UNIVERSAL_NEGATIVES = [
  "бесплатно",
  "free",
  "скачать",
  "download",
  "торрент",
  "torrent",
  "взлом",
  "hack",
  "кряк",
  "crack",
  "чит",
  "cheat",
  "генератор",
  "generator",
  "слив",
  "leak",
  "складчина",
  "обучение бесплатно",
  "работа",
  "вакансия",
  "вакансии",
  "резюме",
  "зарплата",
  "форум",
  "отзывы сотрудников",
  "жалоба",
  "мошенники",
  "скам",
  "scam",
  "кидалово",
  "обман",
  "реферат",
  "курсовая",
  "википедия"
];
const LANGUAGE_NEGATIVES = {
  ru: ["своими руками", "рецепт", "народные методы", "как сделать самому", "образец", "шаблон", "pdf", "youtube"],
  en: ["diy", "recipe", "how to make", "template", "sample", "pdf", "youtube", "reddit"],
  es: ["gratis", "descargar", "pirata", "trabajo", "empleo", "foro", "estafa"],
  de: ["kostenlos", "download", "job", "stelle", "forum", "betrug"],
  pl: ["za darmo", "darmowy poradnik", "pobierz pdf", "torrent", "oferty pracy", "forum pracownicze", "oszustwo", "skarga"],
  vi: ["miễn phí", "tải xuống", "việc làm", "tuyển dụng", "diễn đàn", "lừa đảo", "youtube"]
};
const VERTICAL_NEGATIVES = {
  finance: ["demo account", "paper trading", "signals free", "forex robot", "trading bot free", "смарт-мани", "прогноз бесплатно", "сигналы бесплатно"],
  gambling: ["demo casino", "free spins no deposit", "casino hack", "slot strategy bot", "сигналы казино", "бесплатные фриспины", "работа крупье", "играть бесплатно", "casino miễn phí", "hack slot", "bot casino", "việc làm casino"],
  nutra: ["побочные эффекты", "противопоказания", "отзывы врачей", "аптека", "pharmacy", "side effects", "medical study", "симптомы"],
  sweeps: ["fake winner", "promo code generator", "survey answers", "накрутка", "генератор кодов", "ответы на опрос"],
  ecommerce: ["manual", "review job", "repair", "своими руками", "ремонт", "инструкция бесплатно", "б/у", "second hand"],
  other: ["бесплатная версия", "пробная версия", "open source", "самостоятельно", "консультация бесплатно"]
};
function uniqueText(items) {
  return Array.from(new Set(items.map((item) => item.replace(/\s+/g, " ").trim()).filter(Boolean)));
}
function fitText(value, max) {
  // Google Ads rejects over-long assets and a cut word looks broken: end on a sentence, else on a whole word, never with "…"
  const clean = String(value).replace(/[|•]/g, " ").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const head = clean.slice(0, max + 1);
  const sentence = head.slice(0, max).match(/^.*[.!?](?=\s|$)/);
  if (sentence && sentence[0].length >= max * 0.45) return sentence[0].trim();
  const cut = head.lastIndexOf(" ");
  let out = (cut > max * 0.5 ? head.slice(0, cut) : clean.slice(0, max)).trim();
  for (let prev = ""; prev !== out;) {
    prev = out;
    out = out.replace(/[\s,;:–—-]+$/, "").replace(/\s+(and|or|the|a|an|for|with|to|from|of|by|in|on|at|your|our|и|или|для|с|в|на|от|по|und|oder|für|mit|y|o|de|para|con|i|oraz|dla|z|và|cho)$/i, "").trim();
  }
  return out;
}
const INTENT_MODIFIERS = {
  ru: ["купить", "заказать", "цена", "стоимость", "отзывы", "официальный сайт", "для бизнеса", "для арбитража", "для рекламы", "с поддержкой", "регистрация", "условия", "оплата", "в наличии"],
  en: ["buy", "order", "price", "cost", "reviews", "official website", "for business", "for affiliate marketing", "for advertising", "with support", "registration", "terms", "payment", "available"],
  es: ["comprar", "precio", "opiniones", "sitio oficial", "para empresas", "para afiliados", "con soporte", "registro", "pago", "disponible"],
  de: ["kaufen", "preis", "kosten", "erfahrungen", "offizielle website", "für unternehmen", "für affiliate marketing", "mit support", "registrierung", "zahlung", "verfügbar"],
  pl: ["kupić", "zamówić", "cena", "opinie", "oficjalna strona", "dla firm", "dla afiliantów", "z obsługą", "rejestracja", "płatność", "dostępny"],
  vi: ["mua", "giá", "đánh giá", "website chính thức", "uy tín", "đăng ký", "nạp tiền", "rút tiền", "khuyến mãi", "hỗ trợ", "online"]
};
const VERTICAL_INTENT_MODIFIERS = {
  ru: { gambling: ["купить", "бонус", "официальный сайт", "лицензионный", "вывод средств", "регистрация", "слоты", "казино онлайн", "отзывы"] },
  en: { gambling: ["bonus", "official website", "licensed", "fast withdrawal", "register", "online slots", "casino games", "reviews"] },
  de: { gambling: ["bonus", "offizielle website", "lizenziert", "schnelle auszahlung", "registrieren", "online slots", "casino spiele", "erfahrungen"] },
  es: { gambling: ["bono", "sitio oficial", "licenciado", "retiro rápido", "registrarse", "tragamonedas online", "juegos de casino", "opiniones"] },
  pl: { gambling: ["bonus", "oficjalna strona", "legalne", "szybka wypłata", "rejestracja", "sloty online", "automaty online", "gry kasynowe", "gry crash", "opinie", "streamer kasynowy", "polski streamer kasynowy", "stream kasyna", "kasyno na żywo", "kasyno Twitch", "kasyno YouTube"] },
  vi: { gambling: ["khuyến mãi", "website chính thức", "hợp pháp", "rút tiền nhanh", "đăng ký", "slot online", "trò chơi casino", "đánh giá"] }
};
const BRAND_INTENT_MODIFIERS = {
  vi: {
    gambling: ["casino online", "đăng nhập", "đăng ký", "nạp tiền", "rút tiền", "khuyến mãi", "app", "apk", "đánh giá", "có lừa đảo không", "chơi game"]
  },
  de: {
    gambling: ["casino online", "anmelden", "registrieren", "einzahlen", "auszahlen", "bonus", "app", "erfahrungen", "seriös"]
  },
  en: {
    gambling: ["online casino", "login", "sign up", "deposit", "withdrawal", "bonus", "app", "reviews", "legit"]
  },
  es: {
    gambling: ["casino online", "iniciar sesión", "registrarse", "depositar", "retirar", "bono", "app", "opiniones", "legítimo"]
  }
};
function cleanPhrase(value) {
  return value.replace(/[|•]/g, " ").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
}
function extractOfferDescriptionPhrases(description, language) {
  const fragments = cleanPhrase(description).split(/[.!?;,:|/()]+/u).map(cleanPhrase).filter(Boolean);
  return uniqueText(fragments.flatMap((fragment) => {
    const words = fragment.split(/\s+/).filter(Boolean);
    const candidates = [fragment];
    if (words.length > 6) {
      for (let index = 0; index <= words.length - 4; index += 1) {
        candidates.push(words.slice(index, index + 5).join(" "));
      }
    }
    return candidates;
  })).filter((phrase) => {
    const words = phrase.split(/\s+/).filter(Boolean);
    const meaningful = words.filter((word) => word.replace(/[^\p{L}\p{N}]/gu, "").length >= 3);
    return words.length >= 2 && words.length <= 6 && meaningful.length >= 2 && phrase.length >= 6 && phrase.length <= 70;
  }).filter((phrase) => isLanguageAllowed(phrase, language)).slice(0, 24);
}
function mergePhrase(...parts) {
  const seen = /* @__PURE__ */ new Set();
  return parts.flatMap((part) => cleanPhrase(part).split(/\s+/)).filter((token) => {
    const normalized = token.toLowerCase();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  }).join(" ");
}
const LANGUAGE_NOISE = {
  pl: ["buy", "order", "price", "reviews", "review", "official", "website", "support", "for", "from", "free", "download", "заказать", "цена", "отзывы", "поддержка", "бесплатно", "скачать", "miễn phí", "việc làm"],
  de: ["buy", "order", "price", "reviews", "official website", "заказать", "цена", "отзывы", "поддержка", "kasyno", "miễn phí"],
  en: ["kaufen", "preis", "erfahrungen", "заказать", "цена", "отзывы", "поддержка", "kasyno", "miễn phí"],
  es: ["buy", "order", "price", "reviews", "kaufen", "preis", "заказать", "цена", "отзывы", "поддержка", "kasyno", "miễn phí"],
  vi: ["buy", "order", "price", "reviews", "kaufen", "preis", "заказать", "цена", "отзывы", "поддержка", "kasyno", "бесплатно"],
  ru: ["buy", "order", "price", "reviews", "kaufen", "preis", "comprar", "precio", "kasyno", "miễn phí"]
};
function isLanguageAllowed(value, language) {
  const code = language.toLowerCase().split("-")[0];
  const normalized = ` ${cleanPhrase(value).toLowerCase()} `;
  return !(LANGUAGE_NOISE[code] || []).some((term) => normalized.includes(` ${term.toLowerCase()} `) || normalized.includes(` ${term.toLowerCase()}`));
}
// Without a landing page the vertical templates ("official online store", "compare features") are only kept when
// they share a word with the offer itself — otherwise a VPN offer gets generic e-commerce queries with big volume.
// Gambling templates (slots, casino formats) stay: they are an intentional vertical expansion.
const offerTokenSet = (offer) => new Set(`${offer.title} ${offer.offerDescription || ""} ${(offer.keywords || []).join(" ")}`.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || []);
const TEMPLATE_STOP = new Set(["user", "users", "with", "from", "your", "best", "online", "official", "service", "services", "price", "prices", "free", "купить", "цена", "онлайн", "лучший", "официальный", "сайт"]);
// function words never make a description fragment "about the product"
const ANCHOR_STOP = new Set(["is", "a", "an", "to", "of", "in", "on", "at", "by", "as", "it", "its", "we", "up", "и", "в", "на", "с", "по", "от", "до", "из", "к", "а", "for", "and", "the", "with", "from", "your", "you", "our", "are", "для", "или", "как", "что", "это", "und", "für", "mit", "der", "die", "das", "para", "con", "los", "las", "dla", "oraz", "jak", "cho", "của", "và", ...TEMPLATE_STOP]);
function templateIsRelevant(template, offer) {
  if (offer.vertical === "gambling") return true;
  const tokens = offerTokenSet(offer);
  return (template.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || []).some((t) => !TEMPLATE_STOP.has(t) && tokens.has(t));
}
function productModifierIsRelevant(modifier, offer, siteAudit, siteText) {
  if (siteAudit.checked) return siteText.includes(modifier.toLowerCase());
  if (offer.vertical === "gambling") return true;
  const offerTokens = new Set(`${offer.title} ${offer.offerDescription || ""} ${(offer.keywords || []).join(" ")}`.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || []);
  const modifierTokens = modifier.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || [];
  return modifierTokens.some((token) => offerTokens.has(token));
}
// Modifiers that read naturally in front of a phrase ("buy X"). Everything else is appended only —
// "for business google ads accounts" / "official website X" are not queries people type.
const PREFIX_MODIFIERS = new Set(["купить", "заказать", "buy", "order", "comprar", "kupić", "zamówić", "mua", "đăng ký"]);
function expandGroundedKeywords(offer, sitePhrases, siteText, language, offerDescriptionPhrases = []) {
  const languageCode = language.toLowerCase().split("-")[0];
  // audience-specific modifiers ("for affiliate marketing", "для арбитража", "для рекламы") only when the offer is about that audience
  const NICHE_MODIFIER = /affiliate|advertis|арбитраж|реклам|afiliant|werbung|publicidad|quảng cáo/i;
  const offerText = `${offer.title} ${offer.offerDescription || ""} ${(offer.keywords || []).join(" ")} ${siteText}`;
  const modifiers = (VERTICAL_INTENT_MODIFIERS[languageCode]?.[offer.vertical] || INTENT_MODIFIERS[languageCode] || INTENT_MODIFIERS.en)
    .filter((m) => !NICHE_MODIFIER.test(m) || NICHE_MODIFIER.test(offerText));
  const brandAnchors = [offer.title, ...offer.competitorBrands || []].map(cleanPhrase).filter(Boolean);
  const brandModifiers = BRAND_INTENT_MODIFIERS[languageCode]?.[offer.vertical] || [];
  const brandPhrases = brandAnchors.flatMap((brand) => brandModifiers.map((modifier) => `${brand} ${modifier}`));
  const anchors = uniqueText([
    ...offer.keywords || [],
    ...offerDescriptionPhrases,
    ...brandAnchors,
    ...brandPhrases,
    ...sitePhrases,
    ...sitePhrases.flatMap((phrase) => phrase.split(/[|/()]+/g))
  ]).map(cleanPhrase).filter((phrase) => {
    const words = phrase.split(/\s+/).filter(Boolean);
    return phrase.length >= 2 && phrase.length <= 70 && words.length >= 1 && words.length <= 8 && new RegExp("\\p{L}", "u").test(phrase);
  }).slice(0, 140);
  const siteTokens = new Set((`${siteText} ${sitePhrases.join(" ")}`.match(/[\p{L}]{3,}/gu) || []).map((token) => token.toLowerCase()));
  const competitorAnchors = (offer.competitorBrands || []).map(cleanPhrase).filter(Boolean);
  const userBrandPhrases = new Set([...competitorAnchors, ...competitorAnchors.flatMap((brand) => brandModifiers.map((modifier) => `${brand} ${modifier}`))].map((p) => p.toLowerCase()));
  const grounded = (phrase) => {
    if (!siteText.trim() && sitePhrases.length === 0) return true;
    if (userBrandPhrases.has(phrase.toLowerCase())) return true;
    const tokens = phrase.toLowerCase().match(/[\p{L}]{3,}/gu) || [];
    const overlap = tokens.filter((token) => siteTokens.has(token));
    return overlap.length >= (tokens.length > 3 ? 2 : 1);
  };
  const expanded = [];
  for (const anchor of anchors) {
    if (grounded(anchor)) expanded.push(anchor);
    for (const modifier of modifiers) {
      const left = mergePhrase(anchor, modifier);
      const right = mergePhrase(modifier, anchor);
      if (grounded(left)) expanded.push(left);
      if (PREFIX_MODIFIERS.has(modifier.toLowerCase()) && grounded(right)) expanded.push(right);
    }
  }
  return uniqueText(expanded).filter((phrase) => isLanguageAllowed(phrase, languageCode)).slice(0, 300);
}
function makeRsa(offer, rule, geo, siteAudit, keywords) {
  const siteTitles = (siteAudit.catalogItems || []).map((item) => item.title).filter(Boolean);
  const offerDescriptionPhrases = extractOfferDescriptionPhrases(offer.offerDescription || "", offer.language);
  const productPhrases = uniqueText([...keywords, ...offerDescriptionPhrases, ...siteTitles, ...siteAudit.contentPhrases]).filter((phrase) => isLanguageAllowed(phrase, offer.language)).filter((phrase) => phrase.split(/\s+/).length >= 2).slice(0, 8);
  const title = fitText(offer.title, 30);
  const primary = fitText(productPhrases[0] || title, 30);
  const secondary = fitText(productPhrases[1] || `${rule.title} ${geo}`, 30);
  const languageCode = offer.language.toLowerCase().split("-")[0];
  const baseCopy = languageCode === "de" ? { order: "Bestellen", terms: "Bedingungen", support: "Support", availability: "Verfügbarkeit prüfen", consult: "Beratung erhalten", first: "Details und Verfügbarkeit prüfen.", second: "Leistung, Bedingungen und Ablauf vor der Anfrage prüfen.", third: "Fragen Sie Support nach Verfügbarkeit und Lieferzeit.", fourth: "Wählen Sie eine passende Lösung und informieren Sie sich." } : languageCode === "en" ? { order: "Order", terms: "Terms", support: "Support", availability: "Check availability", consult: "Get support", first: "Review details and availability before enquiring.", second: "Check the offer, terms and process before ordering.", third: "Ask support about availability and delivery time.", fourth: "Choose a suitable option and learn more." } : languageCode === "es" ? { order: "Comprar", terms: "Condiciones", support: "Soporte", availability: "Ver disponibilidad", consult: "Pedir ayuda", first: "Consulta detalles y disponibilidad antes de contactar.", second: "Revisa la oferta, condiciones y proceso antes de pedir.", third: "Pregunta al soporte por disponibilidad y plazos.", fourth: "Elige una opción adecuada y obtén más información." } : languageCode === "vi" ? { order: "Đăng ký", terms: "Điều kiện", support: "Hỗ trợ", availability: "Kiểm tra thông tin", consult: "Nhận tư vấn", first: "Kiểm tra thông tin và điều kiện trước khi đăng ký.", second: "Xem ưu đãi, điều kiện và quy trình trước khi yêu cầu.", third: "Liên hệ hỗ trợ để hỏi thông tin và thời gian xử lý.", fourth: "Chọn lựa chọn phù hợp và xem thêm chi tiết." } : languageCode === "pl" ? { order: "Zamów teraz", terms: "Warunki", support: "Obsługa PL", availability: "Sprawdź dostępność", consult: "Uzyskaj informacje", first: "Sprawdź szczegóły, dostępność i warunki przed kontaktem.", second: "Poznaj ofertę, warunki i proces przed zamówieniem.", third: "Skontaktuj się z obsługą, aby sprawdzić szczegóły.", fourth: "Wybierz odpowiednią opcję i poznaj więcej informacji." } : { order: "Заказать", terms: "Условия", support: "Поддержка", availability: "Проверить наличие", consult: "Получить консультацию", first: "Проверьте детали и наличие перед обращением.", second: "Уточните предложение, условия и порядок заказа.", third: "Уточните у поддержки наличие и сроки.", fourth: "Выберите подходящий вариант и узнайте подробности." };
  const copy = offer.vertical === "gambling" && languageCode === "pl" ? { order: "Sprawdź ofertę", terms: "Warunki bonusu", support: "Obsługa gracza", availability: "Sprawdź gry", consult: "Poznaj zasady", first: "Sprawdź gry, warunki i zasady przed rejestracją.", second: "Poznaj ofertę, wymagania i warunki wypłaty.", third: "Sprawdź licencję i zasady odpowiedzialnej gry.", fourth: "Zobacz dostępne gry i informacje dla graczy." } : offer.vertical === "gambling" && languageCode === "en" ? { order: "Explore offer", terms: "Bonus terms", support: "Player support", availability: "Check games", consult: "Learn the rules", first: "Review games, terms and responsible play information before registering.", second: "Check the offer, requirements and withdrawal terms.", third: "Review licensing and responsible gambling information.", fourth: "See available games and player information." } : baseCopy;
  const featureTerms = productPhrases.slice(0, 5).map((item) => fitText(item, 30));
  const headlines = uniqueText([
    primary,
    title,
    secondary,
    ...featureTerms,
    fitText(`${copy.order} ${primary}`, 30),
    fitText(`${title}: ${copy.terms}`, 30),
    fitText(`${copy.support} ${geo}`, 30),
    copy.availability,
    copy.consult
  ]).map((item) => fitText(item, 30)).slice(0, 15);
  const descriptionAnchor = fitText(offerDescriptionPhrases[0] || primary, 45);
  const descriptions = uniqueText([
    fitText(`${title}: ${descriptionAnchor}. ${copy.first}`, 90),
    fitText(`${title}: ${primary}. ${copy.first}`, 90),
    fitText(`${primary}. ${copy.second}`, 90),
    fitText(copy.third, 90),
    fitText(copy.fourth, 90)
  ]).map((item) => fitText(item, 90)).slice(0, 4);
  return [{
    vertical: rule.title,
    cluster: "Grounded offer / verified site signals",
    headlines,
    descriptions,
    pins: [
      { position: 1, headline: headlines[0] || title },
      { position: 2, headline: headlines[1] || secondary }
    ],
    tmBypassHeadline: fitText(primary, 30)
  }];
}
class UniversalKeywordEngine {
  static async executeBuild(offer, siteAudit) {
    const vertical = offer.vertical || "other";
    const rule = getRule(vertical, offer.language || "ru");
    const geo = offer.geoCountry || "Global";
    const lang = offer.language || "ru";
    const languageCode = lang.toLowerCase().split("-")[0];
    const offerDescriptionPhrases = extractOfferDescriptionPhrases(offer.offerDescription || "", lang);
    const sitePhrases = siteAudit.checked ? siteAudit.contentPhrases.map((phrase) => phrase.replace(/[|•]/g, " ").replace(/[^\p{L}\p{N}\s$+-]/gu, " ").replace(/\s+/g, " ").trim()).filter((phrase) => {
      const words = phrase.split(/\s+/).filter(Boolean);
      const wordCount = words.length;
      const hasLetters = new RegExp("\\p{L}", "u").test(phrase);
      const looksLikeNumericSku = /\d|\$/.test(phrase) && !/[\p{L}]{3,}/u.test(phrase);
      const hasMeaningfulWord = words.some((word) => word.replace(/[^\p{L}]/gu, "").length >= 5);
      return hasLetters && !looksLikeNumericSku && hasMeaningfulWord && phrase.length >= 4 && phrase.length <= 60 && wordCount >= 2 && wordCount <= 5;
    }).slice(0, 36) : [];
    const siteText = `${offer.offerDescription || ""} ${siteAudit.title} ${siteAudit.description} ${siteAudit.visibleText} ${siteAudit.catalogText || ""} ${siteAudit.contentPhrases.join(" ")}`.toLowerCase();
    // description fragments become keyword anchors only when they mention the product ("vpn no-logs" yes, "windows and mac" no);
    // the full description still feeds the AI context and the RSA copy
    const anchorTokens = new Set((`${offer.title} ${(offer.keywords || []).join(" ")} ${(offer.competitorBrands || []).join(" ")}`.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []).filter((t) => !ANCHOR_STOP.has(t)));
    const descriptionAnchors = offerDescriptionPhrases.filter((p) => {
      const words = p.toLowerCase().split(/\s+/);
      // sentence fragments ("for small businesses…", "is a sales crm for") are not queries
      if (ANCHOR_STOP.has(words[0]) || ANCHOR_STOP.has(words[words.length - 1]) || words.filter((w) => ANCHOR_STOP.has(w)).length > 1) return false;
      const content = (p.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []).filter((t) => !ANCHOR_STOP.has(t));
      return content.filter((t) => anchorTokens.has(t)).length >= (content.length >= 3 ? 2 : 1);
    });
    // the user's own phrases are always part of the core, even when the landing page doesn't repeat them
    const inputKeywords = uniqueText([...(offer.keywords || []).map(cleanPhrase).filter(Boolean), ...expandGroundedKeywords(offer, sitePhrases, siteText, lang, descriptionAnchors)]);
    const keywords = [];
    keywords.push({
      keyword: offer.title.toLowerCase().trim(),
      cluster: "brand_own",
      intent: "Brand Navigation & Purchase",
      matchType: "Exact",
      volume: 0,
      cpc: 0,
      competition: "Unknown",
      policyRisk: "Low",
      decision: "Тест",
      dataSource: "unavailable",
      confidence: 0.25
    });
    for (const keyword of inputKeywords) {
      const normalizedKeyword = keyword.toLowerCase().trim();
      const ownBrand = offer.title.toLowerCase().trim();
      const competitorBrand = (offer.competitorBrands || []).some((brand) => normalizedKeyword.includes(brand.toLowerCase().trim()));
      const ownBrandKeyword = normalizedKeyword === ownBrand || normalizedKeyword.includes(`${ownBrand} `) || normalizedKeyword.endsWith(` ${ownBrand}`);
      keywords.push({
        keyword: normalizedKeyword,
        cluster: competitorBrand ? "brand_competitor" : ownBrandKeyword ? "brand_own" : "generic_commercial",
        intent: competitorBrand ? "Competitor Brand Research" : ownBrandKeyword ? "Brand Navigation & Purchase" : "Commercial High Intent",
        matchType: "Phrase",
        volume: 0,
        cpc: 0,
        competition: "Unknown",
        policyRisk: rule.policyRisk,
        decision: "Тест",
        dataSource: "unavailable",
        confidence: 0.25
      });
    }
    for (const prefix of siteAudit.checked ? [] : rule.seedCommercialPrefixes.filter((item) => templateIsRelevant(item, offer))) {
      keywords.push({
        keyword: prefix.trim(),
        cluster: "generic_commercial",
        intent: "Commercial Transactional",
        matchType: "Phrase",
        volume: 0,
        cpc: 0,
        competition: "Unknown",
        policyRisk: rule.policyRisk,
        decision: "Тест",
        dataSource: "unavailable",
        confidence: 0.25
      });
    }
    for (const mod of rule.productModifiers.filter((item) => productModifierIsRelevant(item, offer, siteAudit, siteText))) {
      keywords.push({
        keyword: mod.toLowerCase().trim(),
        cluster: "product_niche",
        intent: "Product Specific Interest",
        matchType: "Exact",
        volume: 0,
        cpc: 0,
        competition: "Unknown",
        policyRisk: rule.policyRisk === "High" ? "Medium" : "Low",
        decision: "Тест",
        dataSource: "unavailable",
        confidence: 0.25
      });
    }
    for (const trust of siteAudit.checked ? rule.trustModifiers.filter((item) => siteText.includes(item.toLowerCase())) : rule.trustModifiers) {
      keywords.push({
        keyword: `${offer.title.toLowerCase()} ${trust}`.trim(),
        cluster: "trust_reviews",
        intent: "Reputation & Security Check",
        matchType: "Exact",
        volume: 0,
        cpc: 0,
        competition: "Unknown",
        policyRisk: "Low",
        decision: "Тест",
        dataSource: "unavailable",
        confidence: 0.25
      });
    }
    for (const info of siteAudit.checked ? rule.informationalModifiers.filter((item) => siteText.includes(item.toLowerCase())) : rule.informationalModifiers.filter((item) => templateIsRelevant(item, offer))) {
      keywords.push({
        keyword: info.trim(),
        cluster: "info_discovery",
        intent: "Informational Discovery",
        matchType: "Broad",
        volume: 0,
        cpc: 0,
        competition: "Unknown",
        policyRisk: "Low",
        decision: "Осторожно",
        dataSource: "unavailable",
        confidence: 0.2
      });
    }
    const uniqueKeywords = Array.from(
      new Map(keywords.map((item) => [item.keyword.replace(/\s+/g, " ").trim().toLowerCase(), item])).values()
    ).filter((item) => {
      if (!siteAudit.checked) return true;
      const explicit = new Set((offer.keywords || []).map((keyword) => keyword.toLowerCase().trim()));
      if (explicit.has(item.keyword.toLowerCase().trim()) || item.cluster === "brand_own" || item.cluster === "brand_competitor") return true;
      const siteTokens = new Set((siteText.match(/[\p{L}]{4,}/gu) || []).map((token) => token.toLowerCase()));
      const tokens = item.keyword.toLowerCase().match(/[\p{L}]{4,}/gu) || [];
      const overlap = tokens.filter((token) => siteTokens.has(token));
      return overlap.length >= (tokens.length > 2 ? 2 : 1);
    });
    const clusterTypes = [
      "brand_own",
      "brand_competitor",
      "generic_commercial",
      "product_niche",
      "trust_reviews",
      "info_discovery"
    ];
    const clusters = clusterTypes.map((cType) => {
      const items = uniqueKeywords.filter((k) => k.cluster === cType);
      const count = items.length;
      const totalVolume = items.reduce((sum, k) => sum + k.volume, 0);
      const avgCpc = count > 0 ? Number((items.reduce((sum, k) => sum + k.cpc, 0) / count).toFixed(2)) : 0;
      let title = cType.replace("_", " ").toUpperCase();
      if (cType === "brand_own") title = "Свой бренд (Brand Own)";
      if (cType === "brand_competitor") title = "Бренды конкурентов (Competitors)";
      if (cType === "generic_commercial") title = "Общие коммерческие (Generic Commercial)";
      if (cType === "product_niche") title = "Нишевые категории и продукты";
      if (cType === "trust_reviews") title = "Запросы доверия и отзывов";
      if (cType === "info_discovery") title = "Информационные запросы (Discovery)";
      const payout = rule.defaultPayout;
      const epc = payout * rule.cr1 * rule.cr2;
      const maxCpc = epc / 1.3;
      const headroom = 0;
      const action = "Нет данных: подключите volume/CPC provider";
      return {
        cluster: cType,
        title,
        count,
        avgCpc,
        totalVolume,
        headroom,
        recommendedAction: action,
        policyRisk: cType === "generic_commercial" ? rule.policyRisk : "Low",
        dataSource: "unavailable"
      };
    });
    const languageUniversalNegatives = {
      ru: ["бесплатно", "скачать", "торрент", "взлом", "кряк", "чит", "генератор", "слив", "работа", "вакансия", "форум", "отзывы сотрудников", "жалоба", "мошенники", "обман", "реферат", "курсовая", "википедия"],
      en: ["free", "download", "torrent", "hack", "crack", "cheat", "generator", "leak", "job", "vacancy", "forum", "employee reviews", "complaint", "scam", "essay", "wikipedia"],
      de: ["kostenlos", "download", "torrent", "hack", "crack", "betrug", "job", "stelle", "forum", "mitarbeiterbewertungen", "beschwerde", "wikipedia"],
      es: ["gratis", "descargar", "torrent", "hack", "crack", "generador", "trabajo", "empleo", "foro", "estafa", "queja", "wikipedia"],
      pl: ["darmowe", "za darmo", "pobierz", "torrent", "włamanie", "hack", "crack", "oszustwo", "praca", "oferty pracy", "forum", "skarga", "generator", "wikipedia"],
      vi: ["miễn phí", "tải xuống", "torrent", "hack", "crack", "gian lận", "việc làm", "tuyển dụng", "diễn đàn", "lừa đảo", "wikipedia"]
    };
    const campaignNegatives = languageCode === "pl" ? {
      "Brand Own": ["oszustwo", "skarga", "praca", "pobierz", "forum"],
      "Brand Competitors": ["oszustwo", "wiadomości", "darmowa promocja", "opinie pracowników", "porównanie wynagrodzeń"],
      "Generic Commercial": ["darmowe", "demo", "pobierz", "praca", "forum", "youtube", "torrent"],
      "Product Niche": ["darmowe kasyno", "darmowe spiny", "hack slotów", "bot kasyno", "praca krupiera", "graj za darmo"],
      Informational: ["wypracowanie", "darmowy pdf", "książka pobierz", "tłumaczenie", "definicja"]
    } : languageCode === "vi" ? {
      "Brand Own": ["lừa đảo", "việc làm", "tải xuống", "diễn đàn"],
      "Brand Competitors": ["lừa đảo", "tin tức", "khuyến mãi miễn phí", "việc làm"],
      "Generic Commercial": ["miễn phí", "demo", "tải xuống", "việc làm", "tuyển dụng", "diễn đàn"],
      "Product Niche": [...VERTICAL_NEGATIVES[vertical], "công thức", "hướng dẫn miễn phí", "tác dụng phụ"],
      Informational: ["bài luận", "pdf miễn phí", "sách tải xuống", "dịch thuật", "định nghĩa"]
    } : {
      "Brand Own": [...(languageUniversalNegatives[languageCode] || languageUniversalNegatives.en).slice(0, 7)],
      "Brand Competitors": [...(languageUniversalNegatives[languageCode] || languageUniversalNegatives.en).slice(0, 5)],
      "Generic Commercial": [...languageUniversalNegatives[languageCode] || languageUniversalNegatives.en, ...LANGUAGE_NEGATIVES[languageCode] || []].slice(0, 14),
      "Product Niche": [...rule.negativeCandidates, ...LANGUAGE_NEGATIVES[languageCode] || []].slice(0, 14),
      Informational: [...LANGUAGE_NEGATIVES[languageCode] || [], ...languageUniversalNegatives[languageCode] || languageUniversalNegatives.en].slice(0, 10)
    };
    const baseNegatives = [...languageUniversalNegatives[languageCode] || languageUniversalNegatives.en, ...LANGUAGE_NEGATIVES[languageCode] || LANGUAGE_NEGATIVES.en];
    const verticalNegatives = [...LOCALIZED_RULES[languageCode]?.[vertical]?.negativeCandidates || VERTICAL_NEGATIVES[vertical], ...rule.negativeCandidates];
    // where each term came from — the PPC Helper refines and labels the list afterwards (services/ppcHelper/negatives.js)
    const negativeSources = {};
    for (const term of verticalNegatives) negativeSources[String(term).toLowerCase()] = "vertical";
    for (const term of baseNegatives) negativeSources[String(term).toLowerCase()] = "base";
    const negatives = {
      sources: negativeSources,
      accountNegatives: uniqueText([
        ...baseNegatives,
        ...verticalNegatives
      ].filter((term) => isLanguageAllowed(term, languageCode))),
      campaignNegatives: Object.fromEntries(Object.entries(campaignNegatives).map(([key, values]) => [key, uniqueText(values.filter((term) => isLanguageAllowed(term, languageCode)))]))
    };
    const ads = [];
    const rsa = makeRsa(offer, rule, geo, siteAudit, inputKeywords);
    const campaigns = clusters.map((c) => ({
      cluster: c.cluster,
      campaignName: `[GS] - ${offer.title} - ${c.title} - [${geo}]`,
      matchType: c.cluster === "brand_own" ? "Exact" : "Phrase",
      geoTargeting: "Presence (Люди, находящиеся в целевом местоположении)",
      startingBid: Number((c.avgCpc * 0.85).toFixed(2)),
      dailyBudget: Number((c.avgCpc * 25).toFixed(2)),
      biddingStrategy: "Maximize Clicks (с предельным CPC)"
    }));
    const economics = {
      targetAction: offer.targetAction || "Целевое действие (CPA)",
      crClickToLead: 0,
      crLeadToSale: 0,
      totalCr: 0,
      epc: 0,
      targetRoi: 0,
      maxCpc: 0,
      headroom: 0
    };
    const cost = {
      apifyCost: 0,
      dataforseoCost: 0,
      isearchTokens: 0,
      isearchCost: 0,
      aimlCost: 0,
      totalEstimatedCost: 0,
      isLiveApi: Boolean(offer.useLiveApi)
    };
    return {
      buildId: `build_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      offer,
      siteAudit,
      keywords: uniqueKeywords,
      clusters,
      negatives,
      ads,
      competitors: [],
      rsa,
      campaigns,
      economics,
      cost
    };
  }
}
export {
  UniversalKeywordEngine
};
