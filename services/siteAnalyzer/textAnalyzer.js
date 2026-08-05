/**
 * Text trigger analysis + content-uniqueness heuristics.
 * Ported from policy-scanner-v3/scanner-engine.js (PART 2 & PART 3).
 */
import { TRIGGERS } from './triggers.js';

// PART 2: TEXT ANALYZER
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Analyzes text for trigger patterns across all 6 categories.
 * @param {string} text — page body text
 * @param {string} headline — ad headline
 * @param {string} description — ad description
 * @param {string} keywords — comma-separated keywords
 * @returns {object} { totalScore, maxPossible, categories[], issues[] }
 */
export function analyzeText(text, headline, description, keywords) {
  const combined = [text, headline, description, keywords].filter(Boolean).join(" ");
  if (!combined || combined.length < 5) return { totalScore: 0, maxPossible: 0, categories: [], issues: [] };

  const categories = [];
  const issues = [];
  let totalScore = 0;

  for (const [key, cat] of Object.entries(TRIGGERS)) {
    let catScore = 0;
    const foundPatterns = [];
    const matchedSet = new Set();

    for (const pattern of cat.patterns) {
      const matches = combined.match(pattern);
      if (matches) {
        const matchStr = matches[0];
        if (!matchedSet.has(matchStr.toLowerCase())) {
          matchedSet.add(matchStr.toLowerCase());
          foundPatterns.push(matchStr);
          catScore += cat.weight;
        }
      }
    }

    const maxCatScore = cat.patterns.length * cat.weight;
    const normalizedScore = Math.min(100, Math.round((catScore / Math.min(maxCatScore, 50)) * 100));

    categories.push({ key, name: cat.name, desc: cat.desc, score: normalizedScore, rawScore: catScore, severity: cat.severity, weight: cat.weight, matches: foundPatterns });
    totalScore += normalizedScore;

    foundPatterns.slice(0, 8).forEach((match) => {
      issues.push({ category: cat.name, severity: cat.severity, text: match, key, explain: getTriggerExplanation(key, match) });
    });
  }

  const maxPossible = Object.keys(TRIGGERS).length * 100;
  return { totalScore, maxPossible, categories, issues };
}

export function getTriggerExplanation(catKey, match) {
  const explanations = {
    circumventing: `Паттерн «${match}» указывает на попытку обхода политик Google Ads. ML-модераторы Google обучены на сотнях тысяч кейсов клоакинга и фарминга.`,
    gambling: `Термин «${match}» относится к игорной вертикали. Google Ads требует сертификацию для рекламы гемблинга: лицензия регулятора, сертификат соответствия, дисклеймер.`,
    nutra: `Фраза «${match}» — типичный health claim. Google требует сертификацию FDA/EMA для медицинских заявлений. «Miracle», «guaranteed result» — автоматические триггеры.`,
    sexual: `Контент «${match}» относится к adult-категории. Google Ads запрещает sexually explicit content в большинстве GEO.`,
    misrepresentation: `Утверждение «${match}» классифицируется как misleading claim. FTC требует доказательной базы для любых гарантий.`,
    financial: `Термин «${match}» связан с финансовыми рисками. CFD, binary options, HYIP — запрещены или строго регулируются в Tier 1 странах.`,
  };
  return explanations[catKey] || `Паттерн «${match}» обнаружен в категории ${catKey}. Рекомендуется удалить или заменить.`;
}

// ══════════════════════════════════════════════════════════════════════════════
// PART 3: UNIQUENESS CHECKER
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Checks text for: placeholder text, repeated phrases, template expressions.
 * TODO BACKEND: Add internet duplicate detection via text.ru API or Copyscape
 * TODO BACKEND: Add readability score (Flesch-Kincaid)
 */
export function checkUniqueness(text) {
  if (!text || text.length < 20) return { score: 0, label: "Нет данных", details: [] };

  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
  const genericPatterns = [
    /lorem\s*ipsum/gi, /sample\s*text/gi, /placeholder/gi,
    /your\s*(company|brand|name)\s*here/gi, /coming\s*soon/gi,
    /under\s*construction/gi, /test\s*page/gi, /default\s*content/gi,
    /click\s*here\s*to\s*learn\s*more/gi, /welcome\s*to\s*our\s*website/gi,
  ];
  const genericFound = [];
  genericPatterns.forEach(p => { const m = text.match(p); if (m) genericFound.push(m[0]); });

  const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const trigrams = {};
  for (let i = 0; i < words.length - 2; i++) {
    const gram = words.slice(i, i + 3).join(" ");
    trigrams[gram] = (trigrams[gram] || 0) + 1;
  }
  const repeats = [];
  for (const [gram, count] of Object.entries(trigrams)) { if (count > 3) repeats.push({ phrase: gram, count }); }
  repeats.sort((a, b) => b.count - a.count);

  const templatePhrases = [
    "we are committed to", "our mission is to", "we strive to", "our goal is",
    "quality service", "customer satisfaction", "best in class", "industry leading",
    "years of experience", "trusted by", "contact us today", "learn more about",
  ];
  let templateCount = 0;
  sentences.forEach(sent => {
    const lower = sent.toLowerCase();
    templatePhrases.forEach(tp => { if (lower.includes(tp)) templateCount++; });
  });

  let score = 100;
  if (genericFound.length > 0) score -= 40;
  if (repeats.length > 5) score -= 25; else if (repeats.length > 2) score -= 15;
  if (templateCount > 3) score -= 20; else if (templateCount > 1) score -= 10;
  if (sentences.length < 3 && text.length > 100) score -= 15;
  score = Math.max(0, Math.min(100, score));

  const details = [];
  if (genericFound.length > 0) details.push({ type: "generic", label: "Placeholder / шаблонный текст", items: genericFound.slice(0, 5) });
  if (repeats.length > 0) details.push({ type: "repeat", label: "Повторяющиеся фразы", items: repeats.slice(0, 5).map(r => `"${r.phrase}" ×${r.count}`) });
  if (templateCount > 0) details.push({ type: "template", label: "Шаблонные выражения", count: templateCount });

  let label = "Высокая уникальность";
  if (score < 30) label = "Критически низкая — placeholder текст";
  else if (score < 50) label = "Низкая — много шаблонов";
  else if (score < 70) label = "Средняя — есть повторы";
  else if (score < 85) label = "Хорошая — небольшие замечания";

  return { score, label, details, sentenceCount: sentences.length, wordCount: words.length };
}


// ══════════════════════════════════════════════════════════════════════════════
