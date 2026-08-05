/**
 * Trigger dictionaries, vertical & GEO risk tables.
 * Ported from the Banana Policy Scanner v3 client-side engine
 * (site-analizer.zip / policy-scanner-v3/scanner-engine.js) for server-side use.
 */
import countries from './countries.json' with { type: 'json' };

const COUNTRIES_BY_CODE = Object.fromEntries(countries.map((c) => [c.code, c]));

export const TRIGGERS = {
  circumventing: {
    name: "Обход системы",
    desc: "Фразы, указывающие на попытку обойти политики Google",
    patterns: [
      /\bcloaking\b/gi, /\bip\s*filter(ing)?\b/gi, /\buser[-\s]?agent\s*spoof/gi,
      /\bgeo[-\s]?redirect\b/gi, /\bfingerprint(ing)?\b/gi, /\bcanvas\s*fingerprint/gi,
      /\bbrowser\s*spoof/gi, /\bheadless\s*detect/gi, /\bbot\s*detect/gi,
      /\btraffic\s*filtering\b/gi, /\bshow\s*different\s*content\b/gi,
      /\bbypass\s*(google|policy|review|mod)/gi, /\bcircumvent\b/gi, /\bevade\s*detection/gi,
      /\bhide\s*from\s*(google|reviewer)/gi, /\bdifferent\s*page\s*for\s*google/gi,
      /\bgoogle\s*see(s)?\s*different/gi, /\breal\s*page\s*for\s*user/gi,
      /\bsafe\s*page\b/gi, /\bmoney\s*page\b/gi, /\bbridge\s*page\b/gi,
      /\bfarm(ed|ing)?\s*account/gi, /\bage(d)?\s*account(s)?\b/gi, /\bwarm(ed)?\s*account/gi,
      /\bmule\s*account/gi, /\brent(ed)?\s*account/gi, /\bbuy\s*(google|ads)?\s*account/gi,
      /\bstealth\s*account/gi, /\bmultiple\s*accounts\b/gi, /\bban\s*evasion/gi,
      /\banti[-\s]?detect\b/gi, /\bmultilogin\b/gi, /\bgo\s*login\b/gi, /\bads\s*power\b/gi,
      /\bdolphin\s*anty\b/gi, /\binsomniac\b/gi, /\blalicat\b/gi, /\bvm\s*mask\b/gi,
      /\bvmlogin\b/gi, /\bincogniton\b/gi,
      /\bblack\s*hat\b/gi, /\bgrey\s*hat\b/gi, /\bhijack(ed|ing)?\b/gi,
    ],
    severity: "CRITICAL",
    weight: 2.5
  },

  gambling: {
    name: "Гемблинг / Казино",
    desc: "Триггеры для игорной, букмекерской и казино-вертикали",
    patterns: [
      /\b(casino|казино)\b/gi, /\b(slot[s]?|слоты?)\b/gi, /\b(poker|покер)\b/gi,
      /\b(bet[t]?ing|ставки?)\b/gi, /\b(bet|бет)\b/gi, /\b(bookie|букмекер)\b/gi,
      /\b(roulette|рулетка)\b/gi, /\b(blackjack|блэкджек)\b/gi,
      /\b(sports\s*betting|спортивные\s*ставки)\b/gi, /\b(live\s*betting|лайв\s*ставки)\b/gi,
      /\b(odds|коэффициент)\b/gi, /\b(wager|вейджер)\b/gi,
      /\b(spin[s]?\s*(and\s*win)?|вращения?)\b/gi, /\b(jackpot|джекпот)\b/gi,
      /\bwin\s*(real\s*)?money\b/gi, /\bwin\s*(real\s*)?cash\b/gi,
      /\b(free\s*spins?|фриспины?)\b/gi, /\b(no\s*deposit\s*bonus|бездеп)\b/gi,
      /\b(deposit\s*bonus|бонус\s*за\s*депозит)\b/gi, /\b(welcome\s*bonus)\b/gi,
      /\b(gambling|гемблинг|гэмблинг)\b/gi, /\b(i[g]?aming)\b/gi,
      /\blotter(y|ies)\b/gi, /\bbingo\b/gi, /\bscratch\s*card/gi,
      /\b(esports\s*betting)\b/gi, /\bvirtual\s*sports\b/gi,
    ],
    severity: "HIGH",
    weight: 2.0
  },

  nutra: {
    name: "Нутра / Health",
    desc: "Триггеры для фармацевтических и wellness-офферов",
    patterns: [
      /\b(lose\s*weight|похудеть|похудение)\b/gi, /\b(weight\s*loss)\b/gi,
      /\b(fat\s*burner|жиросжигатель)\b/gi, /\b(diet\s*pill|таблетки\s*для\s*похудения)\b/gi,
      /\b(miracle\s*(cure|formula|pill)|чудо[-\s]*лекарство)\b/gi,
      /\b(quick\s*fix|быстрое\s*решение)\b/gi, /\b(instant\s*result|мгновенный\s*результат)\b/gi,
      /\b(magic\s*pill|волшебная\s*таблетка)\b/gi, /\b(doctor\s*recommended)\b/gi,
      /\b(clinically\s*proven)\b/gi, /\b(scientific\s*breakthrough)\b/gi,
      /\b(secret\s*(formula|method)|секретная\s*формула)\b/gi,
      /\b(100%\s*natural|100%\s*натуральный)\b/gi,
      /\b(side\s*effect[-\s]*free)\b/gi, /\b(no\s*side\s*effects)\b/gi,
      /\b(fda\s*approved)\b/gi, /\b(as\s*seen\s*on\s*(tv|shark\s*tank|oprah))\b/gi,
      /\b(celebrity\s*secret)\b/gi, /\b(hollywood\s*(diet|secret|method))\b/gi,
      /\b(detox|детокс)\b/gi, /\b(cleanse|очищение)\b/gi,
      /\b(superfood|суперфуд)\b/gi, /\b(antioxidant|антиоксидант)\b/gi,
      /\b(boost\s*(metabolism|immune))\b/gi, /\b(testosterone\s*booster)\b/gi,
      /\b(male\s*enhancement)\b/gi, /\b(performance\s*enhancer)\b/gi,
      /\b(get\s*ripped)\b/gi, /\b(build\s*muscle\s*fast)\b/gi,
      /\b(cbd|канабидиол)\b/gi, /\b(cannabis|марихуана)\b/gi,
      /\b(keto\s*(diet|gummies)?)\b/gi, /\b(garcinia)\b/gi,
      /\b(green\s*coffee)\b/gi, /\b(raspberry\s*ketone)\b/gi,
      /\b(workout\s*supplement)\b/gi, /\b(pre[-\s]?workout)\b/gi,
    ],
    severity: "HIGH",
    weight: 1.5
  },

  sexual: {
    name: "Adult / Dating",
    desc: "Триггеры для adult и dating вертикалей",
    patterns: [
      /\b(adult\s*dating)\b/gi, /\b(sex\s*hookup|sex\s*tonight)\b/gi,
      /\b(casual\s*sex)\b/gi, /\b(nsa\s*fun)\b/gi,
      /\b(hot\s*(singles|girls|milfs?|moms?))\b/gi,
      /\b(horny\s*(women|girls|locals?))\b/gi,
      /\b(nude[s]?|naked)\b/gi, /\b(escort|проститутка)\b/gi,
      /\b(cam\s*(girl|show|site))\b/gi, /\b(live\s*sex)\b/gi,
      /\b(sugar\s*(daddy|mommy|baby))\b/gi,
      /\b(affair|adultery|cheating\s*site)\b/gi,
      /\b(swinger[s]?)\b/gi, /\b(fetish|bdsm)\b/gi,
      /\b(mail[-\s]?order\s*bride)\b/gi, /\b(russian\s*bride)\b/gi,
      /\b(meet\s*and\s*fuck)\b/gi, /\b(fuck\s*buddy)\b/gi,
    ],
    severity: "HIGH",
    weight: 2.0
  },

  misrepresentation: {
    name: "Вводящая в заблуждение инфо",
    desc: "Обманчивые и вводящие в заблуждение утверждения",
    patterns: [
      /\b(guaranteed\s*(result|income|profit|weight\s*loss))\b/gi,
      /\b(make\s*\$[\d,]+\s*(per\s*(day|week|month))?)\b/gi,
      /\b(earn\s*\$[\d,]+\s*(daily|weekly|monthly))\b/gi,
      /\b(work\s*from\s*home\s*\$[\d,]+)\b/gi,
      /\b(quit\s*your\s*job\s*today)\b/gi,
      /\b(passive\s*income\s*\$[\d,]+)\b/gi,
      /\b(get\s*rich\s*quick)\b/gi, /\b(no\s*experience\s*necessary\s*\$)\b/gi,
      /\b(limited\s*(time|spots)\s*(left|remaining))\b/gi,
      /\b(act\s*now\s*before\s*(it|deal|offer)\s*(expires?|gone))\b/gi,
      /\b(only\s*\d+\s*(left|spots?|remaining))\b/gi,
      /\b(today\s*only)\b/gi, /\b(last\s*chance)\b/gi,
      /\b(risk[-\s]?free\s*(trial|offer))\b/gi,
      /\b(money[-\s]?back\s*guarantee)\b/gi,
      /\b(\d+%\s*off)\b/gi, /\b(special\s*promo)\b/gi,
      /\b(limited\s*offer)\b/gi, /\b(exclusive\s*deal)\b/gi,
      /\b(free\s*trial\s*(just\s*pay\s*shipping)?)\b/gi,
      /\b(before\s*and\s*after)\b/gi, /\b(results\s*not\s*typical)\b/gi,
      /\bnot\s*intended\s*to\s*diagnose/gi,
    ],
    severity: "MEDIUM",
    weight: 1.0
  },

  financial: {
    name: "Финансовые риски",
    desc: "Финансовые офферы, крипта, кредиты, инвестиции",
    patterns: [
      /\bbinary\s*option[s]?\b/gi, /\bforex\s*(robot|ea|autotrader)\b/gi,
      /\bget\s*rich\s*with\s*crypto\b/gi, /\b\d+%\s*daily\s*(return|profit)\b/gi,
      /\bguaranteed\s*(return|profit)\s*\d+%\b/gi,
      /\bcrypto\s*(pump|signals?)\b/gi, /\binsider\s*(tip|signal)\b/gi,
      /\bpayday\s*loan\b/gi, /\bno\s*credit\s*check\s*loan\b/gi,
      /\bhigh\s*interest\s*loan\b/gi, /\bpersonal\s*loan\s*(instant|fast|guaranteed)\b/gi,
      /\bdebt\s*consolidation\s*scam\b/gi,
      /\b(pyramid\s*scheme|mlm|multi[-\s]?level\s*market)\b/gi,
      /\bponzi\b/gi, /\bhyip\b/gi,
      /\bmake\s*money\s*online\s*guaranteed\b/gi,
    ],
    severity: "MEDIUM",
    weight: 1.2
  }
};

/**
 * Vertical risk configuration — base risk score per vertical.
 * TODO: Make this configurable via admin panel / API
 */
export const VERTICAL_RISK = {
  general:    { base: 15, label: "General",        desc: "Базовый уровень — стандартная модерация" },
  nutra:      { base: 45, label: "Nutra / Health", desc: "Высокий риск — медицинские и фарма-офферы" },
  gambling:   { base: 70, label: "Gambling",       desc: "Критический — требует лицензии и сертификации" },
  dating:     { base: 50, label: "Dating / Adult", desc: "Высокий риск — строгие ограничения на контент 18+" },
  crypto:     { base: 55, label: "Crypto",         desc: "Высокий риск — финансовые регуляторы и сертификация криптоактивов" },
  finance:    { base: 50, label: "Finance",        desc: "Высокий риск — forex, кредиты, инвестиции требуют лицензий и сертификации" },
  software:   { base: 12, label: "Software / SaaS", desc: "Низкий риск — стандартная модерация, важна прозрачность подписки" },
  sales:      { base: 15, label: "Sales / E-commerce", desc: "Средний риск — политики возврата, доставки и достоверности офферов" },
  real_estate: { base: 15, label: "Real Estate",   desc: "Средний риск — требования к раскрытию цен и лицензий агентств" },
  legal:      { base: 15, label: "Legal",          desc: "Средний риск — требования к раскрытию юрисдикции и лицензий" },
  ecom:       { base: 20, label: "E-commerce",     desc: "Средний риск — политики возврата и доставки" },
  white:      { base: 5,  label: "White",          desc: "Минимальный риск — одобренные вертикали" }
};

/**
 * GEO risk configuration — 60+ countries with regulatory explanations.
 * TODO: Sync with Google Ads policy updates (changes quarterly)
 * TODO: Add gambling regulator links per country
 */
export const GEO_RISK = {
  US: { risk: 35, tier: 1, name: "United States",    explain: "Самая строгая модерация в мире. FDA следит за нутрой, FTC — за мисрипом. Gambling разрешён только в штатах с лицензией." },
  CA: { risk: 30, tier: 1, name: "Canada",           explain: "CPA/Competition Act + provincial gambling regs. Health Canada контролирует нутру." },
  GB: { risk: 30, tier: 1, name: "United Kingdom",   explain: "UKGC для гемблинга, ASA для рекламы, CMA для мисрепа. Gambling Commission — самый строгий регулятор." },
  AU: { risk: 30, tier: 1, name: "Australia",        explain: "ACCC + TGA. «Miracle cure» — мгновенный бан. Gambling Advertising Act 2023." },
  DE: { risk: 28, tier: 1, name: "Germany",          explain: "GGL + UWG. Нутра — строгая BaPharm." },
  FR: { risk: 28, tier: 1, name: "France",           explain: "ANJ для гемблинга + ARPP. Запрет рекламы CFD/Forex." },
  IT: { risk: 25, tier: 1, name: "Italy",            explain: "ADM для гемблинга. Health claims — AGCM." },
  ES: { risk: 25, tier: 1, name: "Spain",            explain: "DGOJ для гемблинга. Real Decreto 958/2020." },
  NL: { risk: 25, tier: 1, name: "Netherlands",      explain: "KSA (Kansspelautoriteit). Gambling advertising сильно ограничена с 2024." },
  JP: { risk: 30, tier: 1, name: "Japan",            explain: "JGA + Consumer Affairs Agency. «Before/After» запрещены." },
  KR: { risk: 28, tier: 1, name: "South Korea",      explain: "KCSC блокирует гемблинг. Foreign gambling — блокировка." },
  BR: { risk: 20, tier: 2, name: "Brazil",           explain: "PIX и локальные платежи. Law 14.790/2023 легализовала гемблинг." },
  MX: { risk: 18, tier: 2, name: "Mexico",           explain: "SEGOB лицензирует гемблинг. PROFECO следит за мисрепом." },
  PL: { risk: 22, tier: 2, name: "Poland",           explain: "Ministry of Finance блокирует нелицензированный гемблинг." },
  RO: { risk: 15, tier: 2, name: "Romania",          explain: "ONJN для гемблинга. ANPC — мисреп." },
  IN: { risk: 12, tier: 3, name: "India",            explain: "State-wise regulation. ASCI для advertising." },
  TH: { risk: 10, tier: 3, name: "Thailand",         explain: "Gambling Act 1935 — запрет. Но underground market огромен." },
  KZ: { risk: 12, tier: 3, name: "Kazakhstan",       explain: "Law on Gambling 2020. Онлайн — запрет (кроме букмекеров)." },
  UA: { risk: 8,  tier: 3, name: "Ukraine",          explain: "KRAIL с 2020. Лицензированный гемблинг." },
};

/**
 * Resolves GEO risk data for any of the ~190 supported country codes.
 * Falls back to a generic tier-3 entry (using the real country name) for
 * codes without curated regulator data, instead of silently defaulting to US.
 */
export function getGeoRisk(code) {
  const upper = String(code || '').toUpperCase();
  if (GEO_RISK[upper]) return GEO_RISK[upper];

  const country = COUNTRIES_BY_CODE[upper];
  if (country) {
    return {
      risk: 10,
      tier: 3,
      name: country.name,
      explain: `Детальные данные по регулятору для ${country.name} пока не собраны — используется базовая оценка. Проверьте местные требования к рекламе вручную.`
    };
  }

  return GEO_RISK.US;
}

// ══════════════════════════════════════════════════════════════════════════════

