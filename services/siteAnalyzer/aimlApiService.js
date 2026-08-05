/**
 * AIMLAPI (aimlapi.com) — OpenAI-compatible LLM gateway.
 * Used for two things the regex-only MVP couldn't do (see TECH_SPEC.md "NLP Context"
 * and Ban_Predictor_AI doc from the analyzer research pack):
 *   1. Contextual compliance review of the found trigger phrases (reduces false positives
 *      like "time slot" vs. gambling "slot").
 *   2. Final human-readable ban-risk narrative summarizing all collected signals.
 */
const AIML_BASE_URL = process.env.AIMLAPI_BASE_URL || 'https://api.aimlapi.com/v1';
const AIML_MODEL = process.env.AIMLAPI_MODEL || 'gpt-4o-mini';
const AIML_TIMEOUT_MS = 30000;

async function chatCompletion(messages, { maxTokens = 700, temperature = 0.3 } = {}) {
  const apiKey = process.env.AIMLAPI_API_KEY;
  if (!apiKey) throw new Error('AIMLAPI_API_KEY не настроен на сервере');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AIML_TIMEOUT_MS);
  try {
    const res = await fetch(`${AIML_BASE_URL}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: AIML_MODEL,
        messages,
        temperature,
        max_tokens: maxTokens
      })
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) throw new Error(data?.error?.message || `AIMLAPI HTTP ${res.status}`);
    return data?.choices?.[0]?.message?.content || '';
  } finally {
    clearTimeout(timer);
  }
}

function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

/**
 * Contextual review of trigger matches — LLM decides which are real policy
 * risks vs. false positives, with a short explanation for each.
 */
export async function analyzeComplianceContext({ url, vertical, textExcerpt, triggerIssues }) {
  if (!triggerIssues.length) return { available: true, findings: [], summary: 'Триггеры не обнаружены.' };

  const trimmedExcerpt = String(textExcerpt || '').slice(0, 4000);
  const triggerList = triggerIssues.slice(0, 30).map(i => `- [${i.severity}/${i.category}] "${i.text}"`).join('\n');

  const prompt = `Ты — эксперт по политикам Google Ads. Сайт: ${url}. Заявленная вертикаль: ${vertical}.
Ниже приведён фрагмент текста страницы и список триггерных фраз, найденных regex-сканером.
Для КАЖДОЙ фразы определи: это реальный риск нарушения политик Google Ads в данном контексте, или ложное срабатывание (например "time slot" — не гемблинг).
Верни СТРОГО валидный JSON без markdown-обёртки в формате:
{"findings":[{"text":"...","isRealRisk":true|false,"reason":"кратко на русском"}],"summary":"общий вывод в 1-2 предложениях на русском"}

Текст страницы (фрагмент):
"""${trimmedExcerpt}"""

Найденные фразы:
${triggerList}`;

  try {
    const content = await chatCompletion([
      { role: 'system', content: 'Ты отвечаешь только валидным JSON, без пояснений и markdown.' },
      { role: 'user', content: prompt }
    ], { maxTokens: 1200 });

    const parsed = extractJson(content);
    if (!parsed) throw new Error('LLM returned non-JSON response');
    return { available: true, ...parsed };
  } catch (e) {
    console.error('[AIMLAPI] analyzeComplianceContext error:', e.message);
    return { available: false, findings: [], summary: null, error: e.message };
  }
}

/**
 * Final ban-risk narrative — synthesizes the heuristic ML score + all collected
 * signals into a short human-readable explanation (Ban Predictor AI-style).
 */
export async function generateBanRiskNarrative({ url, vertical, geo, riskScore, riskLevel, topFactors, aiCompliance }) {
  const factorsText = (topFactors || [])
    .slice(0, 5)
    .map(f => `- ${f.name}: score ${Math.round(f.score)}, вклад ${f.contribution}`)
    .join('\n');

  const prompt = `Ты — AI ban-предиктор для рекламных аккаунтов Google Ads (аналог внутреннего инструмента Banana Traff).
Сайт: ${url}. Вертикаль: ${vertical}. GEO: ${geo}.
Расчётный риск-скор эвристической ML-модели: ${riskScore}/100 (${riskLevel}).
Топ факторы риска:
${factorsText}
${aiCompliance?.summary ? `Контекстный AI-анализ триггеров: ${aiCompliance.summary}` : ''}

Напиши краткий (3-5 предложений) прогноз вероятности бана аккаунта/отклонения объявления при запуске рекламы на этот сайт через Google Ads, и что сделать в первую очередь. Пиши на русском, по делу, без воды.`;

  try {
    const content = await chatCompletion([
      { role: 'system', content: 'Ты — лаконичный технический эксперт по policy compliance Google Ads.' },
      { role: 'user', content: prompt }
    ], { maxTokens: 500, temperature: 0.4 });
    return { available: true, narrative: content.trim() };
  } catch (e) {
    console.error('[AIMLAPI] generateBanRiskNarrative error:', e.message);
    return { available: false, narrative: null, error: e.message };
  }
}
