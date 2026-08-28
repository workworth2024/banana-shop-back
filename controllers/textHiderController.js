/**
 * Backend proxy for the AI Text Hider tool's risk-analysis feature.
 * Keeps the AIMLAPI key server-side (the tool itself is a static page, so the
 * key must never be shipped to the browser) and gates usage behind customer
 * auth + a rate limit, since every call costs money on AIMLAPI.
 */
const AIML_BASE_URL = process.env.AIMLAPI_BASE_URL || 'https://api.aimlapi.com/v1';
const AIML_MODEL = process.env.AIMLAPI_MODEL || 'gpt-4o-mini';
const AIML_TIMEOUT_MS = 30000;
const MAX_TEXT_LENGTH = 4000;

const SYSTEM_PROMPT = `Ты — эксперт по модерации рекламы и арбитражу трафика с 10-летним опытом. Ты отлично разбираешься в:
- Google Ads, Meta Ads, TikTok Ads, Yandex Direct
- Арбитраже трафика (CPA, CPI, COD, нутра, гемблинг, крипта, беттинг)
- Современном сленге арбитражников ("лить", "кло", "прокла", "прела", "акк", "фарм", "залив", "бан", "прохлоп", "крео", "тз", "аппрув", "холд", "пиксель", "БМ", "агентский", "самовыкуп", "кэшбэк", "мультиакк", "антифрод", "пэймент", "процессинг")
- Методах обхода модерации и их эффективности
- Рисках блокировки аккаунтов и рекламных кабинетов

Анализируй текст с учётом реального контекста. Не суди формально по отдельным словам — понимай намерение и смысл.`;

function buildUserPrompt(text) {
  return `Проанализируй следующий текст с точки зрения прохождения модерации рекламных площадок (Google Ads, Meta, TikTok) и рисков для аккаунтов арбитражника.

ТЕКСТ ДЛЯ АНАЛИЗА:
"""
${text}
"""

Верни строго JSON без Markdown-разметки:
{
  "overallRisk": "low|medium|high",
  "overallMessage": "краткое объяснение оценки на русском",
  "context": "что реально означает этот текст в контексте арбитража (1-2 предложения)",
  "detectedIntent": "реальная цель текста: реклама крипты, продажа аккаунтов, гемблинг, нутра, легальный бизнес и т.д.",
  "moderationRisk": {
    "googleAds": "low|medium|high",
    "meta": "low|medium|high",
    "tiktok": "low|medium|high"
  },
  "categories": [
    {"name": "Название категории на русском", "score": 0-100, "reason": "почему такая оценка"}
  ],
  "triggerWords": ["список триггерных слов/фраз, которые нашел в тексте"],
  "recommendations": ["конкретные рекомендации по обфускации и прохождению модерации"],
  "suggestedMethods": ["какие методы обфускации лучше подойдут: homoglyphs, translit, slang, leet, zws, punctuation, spaced, phonetic, math, morphology"]
}`;
}

export const analyzeText = async (req, res) => {
  try {
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ available: false, error: 'Текст не указан' });
    if (text.length > MAX_TEXT_LENGTH) {
      return res.status(400).json({ available: false, error: `Текст слишком длинный (максимум ${MAX_TEXT_LENGTH} символов)` });
    }

    const apiKey = process.env.AIMLAPI_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ available: false, error: 'AI-анализ временно недоступен (не настроен ключ на сервере)' });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AIML_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(`${AIML_BASE_URL}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: AIML_MODEL,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: buildUserPrompt(text) }
          ],
          temperature: 0.3,
          max_tokens: 1500
        })
      });
    } finally {
      clearTimeout(timer);
    }

    const data = await response.json().catch(() => null);
    if (!response.ok || !data) {
      throw new Error(data?.error?.message || `AIMLAPI HTTP ${response.status}`);
    }

    const content = data.choices?.[0]?.message?.content || '';
    let parsed;
    try {
      const clean = content.replace(/```json\s*/, '').replace(/```\s*$/, '').trim();
      parsed = JSON.parse(clean);
    } catch {
      return res.status(200).json({
        available: true,
        overallRisk: 'medium',
        overallMessage: 'AI вернул ответ, но не в ожидаемом JSON-формате.',
        context: 'Не удалось распарсить JSON',
        detectedIntent: 'Неизвестно',
        moderationRisk: { googleAds: 'medium', meta: 'medium', tiktok: 'medium' },
        categories: [],
        triggerWords: [],
        recommendations: ['Попробуйте повторить запрос'],
        suggestedMethods: ['translit'],
        raw: content
      });
    }

    return res.status(200).json({ available: true, ...parsed });
  } catch (error) {
    console.error('[TextHider] analyzeText error:', error.message);
    return res.status(502).json({ available: false, error: error.message || 'Ошибка при обращении к AI API' });
  }
};
