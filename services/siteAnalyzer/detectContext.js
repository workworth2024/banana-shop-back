/**
 * Works out what the page is about (vertical) and which country it targets (GEO) from the page
 * itself, so a scan is right even when the user leaves the defaults or picks the wrong option.
 *
 * GEO signals, strongest first (how Google itself infers a page's target locale): country-code
 * TLD (except vanity ccTLDs like .io/.co/.ai that Google treats as generic), html lang / hreflang
 * region, local currency, phone country code, then page language as a weak fallback.
 * Vertical: weighted multilingual keyword hits on the visible text, title and description.
 */

// Google treats these ccTLDs as generic — they say nothing about the country
const GENERIC_CCTLDS = new Set(['ai', 'co', 'io', 'me', 'tv', 'fm', 'cc', 'ws', 'eu', 'asia', 'app', 'to', 'ly', 'gg', 'sh', 'la', 'nu', 'vc', 'gl', 'im', 'sc', 'ag', 'bz', 'mu', 'tk', 'ac', 'ad', 'cx', 'dj', 'gd', 'hn', 'ms', 'pr', 'sx', 'tm', 'vu', 'su']);
const TLD_COUNTRY = { uk: 'GB', 'co.uk': 'GB', 'com.au': 'AU', 'com.br': 'BR', 'com.mx': 'MX', 'com.tr': 'TR', 'co.za': 'ZA', 'co.in': 'IN', 'com.ar': 'AR', 'co.jp': 'JP', 'co.kr': 'KR', 'com.ua': 'UA', 'рф': 'RU', 'xn--p1ai': 'RU' };
const LANG_COUNTRY = { de: 'DE', fr: 'FR', es: 'ES', it: 'IT', pl: 'PL', pt: 'PT', ru: 'RU', uk: 'UA', tr: 'TR', ja: 'JP', ko: 'KR', nl: 'NL', cs: 'CZ', ro: 'RO', sv: 'SE', da: 'DK', fi: 'FI', nb: 'NO', no: 'NO', hu: 'HU', el: 'GR', bg: 'BG', he: 'IL', th: 'TH', vi: 'VN', id: 'ID', ms: 'MY', kk: 'KZ', sk: 'SK', hr: 'HR', sr: 'RS', lt: 'LT', lv: 'LV', et: 'EE', sl: 'SI', en: 'US' };
const CURRENCIES = [
  [/£|\bGBP\b/g, 'GB'], [/₽|\bруб\.?|\bRUB\b/gi, 'RU'], [/₴|\bгрн\b|\bUAH\b/gi, 'UA'], [/₹|\bINR\b|\bRs\.?\s?\d/g, 'IN'],
  [/R\$|\bBRL\b/g, 'BR'], [/zł|\bPLN\b/gi, 'PL'], [/₺|\bTRY\b/g, 'TR'], [/\bCHF\b/g, 'CH'], [/A\$|\bAUD\b/g, 'AU'], [/C\$|\bCAD\b/g, 'CA'],
  [/¥|\bJPY\b/g, 'JP'], [/₩|\bKRW\b/g, 'KR'], [/\bMXN\b|MX\$/g, 'MX'], [/₸|\bKZT\b/g, 'KZ'], [/\bKč\b|\bCZK\b/g, 'CZ'], [/\blei\b|\bRON\b/gi, 'RO'],
  [/\bSEK\b/g, 'SE'], [/\bNOK\b/g, 'NO'], [/\bDKK\b/g, 'DK'], [/\bHUF\b|\bFt\b/g, 'HU'], [/\bZAR\b/g, 'ZA'], [/\bNZD\b|NZ\$/g, 'NZ'], [/\bSGD\b|S\$/g, 'SG']
];
const PHONE_CODES = [['+49', 'DE'], ['+44', 'GB'], ['+33', 'FR'], ['+34', 'ES'], ['+39', 'IT'], ['+48', 'PL'], ['+351', 'PT'], ['+55', 'BR'], ['+52', 'MX'], ['+91', 'IN'],
  ['+90', 'TR'], ['+380', 'UA'], ['+31', 'NL'], ['+43', 'AT'], ['+41', 'CH'], ['+32', 'BE'], ['+420', 'CZ'], ['+40', 'RO'], ['+46', 'SE'], ['+47', 'NO'], ['+45', 'DK'],
  ['+358', 'FI'], ['+36', 'HU'], ['+30', 'GR'], ['+81', 'JP'], ['+82', 'KR'], ['+61', 'AU'], ['+64', 'NZ'], ['+27', 'ZA'], ['+971', 'AE'], ['+65', 'SG'], ['+7', 'RU'], ['+1', 'US']];

const VERTICAL_WORDS = {
  gambling: ['casino', 'slots', 'slot machine', 'jackpot', 'free spins', 'bookmaker', 'sportsbook', 'betting', 'roulette', 'blackjack', 'poker', 'казино', 'слоты', 'ставки', 'букмекер', 'фриспин', 'джекпот', 'apuestas', 'tragamonedas', 'spielautomaten', 'wetten', 'scommesse', 'paris sportifs', 'aposta'],
  nutra: ['weight loss', 'lose weight', 'diet pill', 'fat burn', 'supplement', 'keto', 'detox', 'joint pain', 'diabetes', 'blood pressure', 'prostate', 'potency', 'erectile', 'anti-aging', 'wrinkles', 'похуд', 'жиросжиг', 'суставы', 'давлени', 'потенци', 'диабет', 'простатит', 'adelgazar', 'pérdida de peso', 'abnehmen', 'dimagrire', 'perdre du poids', 'emagrecer', 'capsules', 'капсул'],
  dating: ['dating', 'singles', 'hookup', 'meet women', 'meet men', 'find your match', 'webcam girls', 'знакомств', 'одинок', 'citas', 'partnersuche', 'rencontre', 'incontri', 'namoro'],
  crypto: ['crypto', 'bitcoin', 'btc', 'ethereum', 'blockchain', 'token', 'airdrop', 'defi', 'nft', 'wallet', 'exchange', 'staking', 'криптовалют', 'биткоин', 'блокчейн', 'токен', 'криптобирж', 'mining'],
  finance: ['forex', 'trading', 'invest', 'loan', 'credit', 'mortgage', 'broker', 'cfd', 'stocks', 'insurance', 'payday', 'interest rate', 'кредит', 'займ', 'инвестиц', 'брокер', 'трейдинг', 'ипотек', 'страхован', 'préstamo', 'kredit', 'prestito', 'crédit'],
  software: ['download', 'free trial', 'saas', 'software', 'app for', 'install', 'api', 'dashboard', 'sign up free', 'pricing plans', 'integrations', 'скачать', 'программа', 'приложение', 'подписк', 'descargar', 'herunterladen', 'télécharger'],
  ecom: ['add to cart', 'add to bag', 'shopping cart', 'checkout', 'free shipping', 'in stock', 'buy now', 'shop now', 'size guide', 'returns', 'в корзину', 'корзина', 'доставка', 'купить', 'оформить заказ', 'añadir al carrito', 'in den warenkorb', 'ajouter au panier', 'aggiungi al carrello', 'comprar'],
  real_estate: ['real estate', 'apartments for sale', 'property', 'realtor', 'rent an apartment', 'mortgage calculator', 'недвижимост', 'квартир', 'новостройк', 'inmobiliaria', 'immobilien', 'immobilier', 'immobiliare'],
  legal: ['law firm', 'attorney', 'lawyer', 'legal advice', 'personal injury', 'юрист', 'адвокат', 'юридическ', 'abogado', 'rechtsanwalt', 'avocat', 'avvocato']
};
const VERTICAL_MIN_SCORE = 6; // weighted hits needed before we call it anything but "general"

const count = (hay, needle) => {
  let n = 0, i = hay.indexOf(needle);
  while (i !== -1 && n < 20) { n++; i = hay.indexOf(needle, i + needle.length); }
  return n;
};

export function detectVertical({ text = '', title = '', description = '' }) {
  const body = ` ${String(text).toLowerCase().slice(0, 60000)} `;
  const head = ` ${`${title} ${description}`.toLowerCase()} `;
  const scores = {};
  const evidence = {};
  for (const [key, words] of Object.entries(VERTICAL_WORDS)) {
    let s = 0;
    const hits = [];
    for (const w of words) {
      const n = Math.min(5, count(body, w)) + 3 * Math.min(2, count(head, w));
      if (n) { s += n; hits.push(w); }
    }
    scores[key] = s;
    evidence[key] = hits.slice(0, 4);
  }
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [top, topScore] = ranked[0];
  const second = ranked[1]?.[1] || 0;
  if (topScore < VERTICAL_MIN_SCORE) return { value: 'general', confidence: 'low', evidence: [] };
  const confidence = topScore >= 15 && topScore >= second * 1.6 ? 'high' : 'medium';
  return { value: top, confidence, evidence: evidence[top] };
}

export function detectGeo({ hostname = '', html = '', text = '', headers = {} }) {
  const votes = {};
  const evidence = [];
  const vote = (cc, w, why) => { if (!cc) return; votes[cc] = (votes[cc] || 0) + w; evidence.push({ cc, why }); };
  const host = String(hostname).toLowerCase();
  const parts = host.split('.');
  const tld2 = parts.slice(-2).join('.');
  const tld = parts[parts.length - 1];
  if (TLD_COUNTRY[tld2]) vote(TLD_COUNTRY[tld2], 6, `.${tld2}`);
  else if (TLD_COUNTRY[tld]) vote(TLD_COUNTRY[tld], 6, `.${tld}`);
  else if (tld.length === 2 && !GENERIC_CCTLDS.has(tld)) vote(tld.toUpperCase(), 6, `.${tld}`);

  const htmlTag = (html.match(/<html\b[^>]*>/i) || [''])[0];
  const lang = ((htmlTag.match(/\blang\s*=\s*["']?([a-z]{2,3})(?:[-_]([a-z]{2}))?/i) || []).slice(1));
  if (lang[1]) vote(lang[1].toUpperCase() === 'UK' ? 'GB' : lang[1].toUpperCase(), 4, `lang=${lang[0]}-${lang[1]}`);
  const contentLang = String(headers['content-language'] || '').match(/^[a-z]{2}-([a-z]{2})/i);
  if (contentLang) vote(contentLang[1].toUpperCase(), 3, `Content-Language`);
  const hreflangs = [...html.matchAll(/hreflang\s*=\s*["']?([a-z]{2})-([a-z]{2})/gi)].map((m) => m[2].toUpperCase());
  if (hreflangs.length && new Set(hreflangs).size === 1) vote(hreflangs[0], 3, `hreflang ${hreflangs[0]}`);

  const sample = String(text).slice(0, 40000);
  for (const [re, cc] of CURRENCIES) {
    const n = (sample.match(re) || []).length;
    if (n) vote(cc, Math.min(4, 1 + n), `currency ${cc}`);
  }
  const euros = (sample.match(/€|\bEUR\b/g) || []).length;
  const phones = sample.match(/\+\d{1,3}[\s(-]*\d/g) || [];
  for (const p of phones.slice(0, 10)) {
    const code = p.replace(/[^\d+]/g, '');
    const hit = PHONE_CODES.find(([pre]) => code.startsWith(pre));
    if (hit) vote(hit[1], 2, `phone ${hit[0]}`);
  }
  // page language: weak on its own, but decides which euro country it is
  if (lang[0] && LANG_COUNTRY[lang[0].toLowerCase()]) {
    const cc = LANG_COUNTRY[lang[0].toLowerCase()];
    vote(cc, euros && cc !== 'US' ? 3 : lang[0].toLowerCase() === 'en' ? 0.5 : 1.5, `lang=${lang[0]}`);
  }
  if (!Object.keys(votes).length) return { value: null, confidence: 'low', evidence: [] };
  const ranked = Object.entries(votes).sort((a, b) => b[1] - a[1]);
  const [cc, score] = ranked[0];
  const second = ranked[1]?.[1] || 0;
  const confidence = score >= 6 && score >= second * 1.5 ? 'high' : score >= 3 ? 'medium' : 'low';
  return { value: cc, confidence, evidence: evidence.filter((e) => e.cc === cc).map((e) => e.why).slice(0, 4) };
}
