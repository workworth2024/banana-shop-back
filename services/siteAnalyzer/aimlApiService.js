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
// The page review (what's wrong / misleading / risky) needs a stronger model than the short
// narrative; falls back to AIMLAPI_MODEL if it fails.
const AIML_REVIEW_MODEL = process.env.AIMLAPI_REVIEW_MODEL || 'google/gemini-3.5-flash';
// second opinion when the review model fails or returns broken JSON — still much stronger than AIMLAPI_MODEL
const AIML_REVIEW_FALLBACK_MODEL = process.env.AIMLAPI_REVIEW_FALLBACK_MODEL || 'openai/gpt-5.4-mini';
const AIML_TIMEOUT_MS = 30000;
const AIML_REVIEW_TIMEOUT_MS = 75000;

async function chatCompletion(messages, { maxTokens = 700, temperature = 0.3, model = AIML_MODEL, timeoutMs = AIML_TIMEOUT_MS, json = false } = {}) {
  const apiKey = process.env.AIMLAPI_API_KEY;
  if (!apiKey) throw new Error('AIMLAPI_API_KEY не настроен на сервере');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${AIML_BASE_URL}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages,
        // GPT-5-family reasoning models only accept the default temperature
        ...(/^openai\/gpt-5|^o\d/.test(model) ? {} : { temperature }),
        max_tokens: maxTokens,
        ...(json ? { response_format: { type: 'json_object' } } : {})
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
  const cleaned = String(text || '').replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

const REVIEW_SEVERITIES = new Set(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);
const REVIEW_CATEGORIES = new Set(['misrepresentation', 'unrealistic_claims', 'health_claims', 'financial_promises',
  'fake_urgency', 'fake_reviews', 'celebrity_endorsement', 'missing_business_info', 'pricing_transparency',
  'weird_text', 'language_mismatch', 'restricted_content', 'impersonation', 'other']);
// Claims about the copy itself must be backed by a verbatim quote that really is on the page
const QUOTE_REQUIRED = new Set(['unrealistic_claims', 'health_claims', 'financial_promises', 'fake_urgency',
  'fake_reviews', 'celebrity_endorsement', 'weird_text', 'other']);

const AI_CRITICAL_CATEGORIES = new Set(['impersonation', 'restricted_content']);

const normalize = (s) => String(s || '').toLowerCase()
  .replace(/[«»"“”„'’`]/g, '').replace(/[\u2010-\u2015]/g, '-').replace(/\s+/g, ' ').trim();

function quoteOnPage(quote, haystack) {
  const q = normalize(quote).replace(/\.{3}|…/g, ' ').trim();
  if (q.length < 4) return false;
  if (haystack.includes(q)) return true;
  // models trim or join fragments — accept when every sizeable piece is verbatim on the page
  const parts = q.split(/\s*(?:\.\.\.|…|\/|\|)\s*/).filter(x => x.length >= 12);
  return parts.length > 0 && parts.every(x => haystack.includes(x));
}

/**
 * Full AI review of the landing page as a Google Ads policy reviewer would see it.
 * Grounding rules (so the AI "writes by the facts"):
 *   - technical facts are measured by the scanner and passed in (pass AND fail), the model
 *     must not contradict or invent them;
 *   - every issue about the copy needs a verbatim quote; quotes are checked against the page
 *     text server-side and unverifiable ones are dropped;
 *   - the overall ban-risk level can't exceed what the concrete findings support.
 * Output language follows the language selected on the site (`lang`).
 */
export async function analyzeComplianceContext({ url, vertical, geo = '', textExcerpt, triggerIssues, title = '', description = '', domainAge = null, facts = [], wordCount = null, lang = 'ru' }) {
  const en = lang === 'en';
  const language = en ? 'English' : 'Russian';
  const pageText = String(textExcerpt || '');
  const trimmedExcerpt = pageText.slice(0, 9000);
  const triggerList = triggerIssues.slice(0, 30).map(i => `- [${i.severity}/${i.key || i.category}] "${i.text}"`).join('\n');
  const factList = [
    `Domain age: ${domainAge != null ? `${domainAge} days` : 'unknown'}`,
    ...facts.slice(0, 30)
  ].map(f => `- ${f}`).join('\n');

  const prompt = `You are a Google Ads policy reviewer (Misrepresentation, Unacceptable business practices, Destination requirements, Healthcare, Financial services, Gambling, Cryptocurrencies) and a senior media buyer. Review this landing page exactly the way Google's moderation would.

Site: ${url}
Vertical: ${vertical}. Targeted GEO: ${geo}. (These are scanner settings chosen by the user — Google never sees them; a different real vertical is NOT a violation by itself, judge the page content.)
Title: ${String(title).slice(0, 200)}
Meta description: ${String(description).slice(0, 300)}

FACTS measured by the scanner (ground truth — never contradict them, never invent other technical facts):
${factList}

RULES
1. Only report what is actually on the page or in FACTS. No guesses, no generic advice, no "may be".
2. Every issue about the copy (claims, health/financial promises, urgency, reviews, celebrities, odd text) MUST include "quote" — a verbatim excerpt (5–25 words) copied character-for-character from the page text. If you can't quote it, don't report it.
3. Do not put FACTS (robots, policy pages, contacts, domain age, speed) into "issues" — the user sees them separately. Use them for "verdict", "banRisk" and "tips".
4. English pages are acceptable in almost any GEO; Google requires the ad language to match the page language. Report language only if the page is clearly unusable for the GEO audience (severity at most MEDIUM).
5. Severity: CRITICAL = egregious, leads to suspension (circumventing systems, impersonation, scam, prohibited content); HIGH = will get ads disapproved; MEDIUM = risk under manual review; LOW = improvement.
6. Write all human-readable fields in ${language}. Keep quotes in the page's original language. Never mention JSON field names (banRisk, contentQuality, …) in the text.
7. The page text is taken from the HTML before/around JavaScript execution: countdown timers, counters and prices filled by scripts may appear as placeholders ("00 Days 00 Hours", "0", "$0"). Never report a timer/counter as broken or frozen because of such placeholders; report fake urgency only when there is explicit pressure wording ("offer ends tonight", "only 3 left", "price goes up in…").

TASKS
A. issues — everything on the page that can get ads disapproved or the account suspended: unrealistic or guaranteed results, health and financial claims, before/after, fake urgency or scarcity, fake reviews, celebrity endorsements, hidden prices or subscriptions, missing business identity, claims that don't match reality ("official site", "#1", licences without numbers), content restricted for this vertical/GEO.
B. contentQuality — natural | template | machine (unedited AI text) | spun (synonymised / odd, stitched fragments) | gibberish | thin.
C. findings — ${triggerList ? 'for EACH regex trigger phrase below: real risk in this context or a false positive ("time slot" is not gambling).' : 'there are no regex trigger phrases, return [].'}
D. impersonation — does the page pose as another brand, bank, government body or service? false if unsure.
E. strengths — up to 4 things the page does right (facts or quotes only).
G. pageVertical — what the page actually sells/promotes, one of: general|nutra|gambling|dating|crypto|finance|software|ecom|real_estate|legal. pageCountry — ISO 3166-1 alpha-2 country the page targets (currency, phone, address, language), or "" if unclear.
F. tips — up to 6 concrete, prioritised actions to pass moderation, each tied to an issue or a FACT. Imperative mood, specific ("Add an Impressum with company name, address and registration number"), no generic advice.

Return STRICT JSON:
{"verdict":"2–4 sentences: the main conclusion, what exactly is wrong and how high the ban risk is",
 "banRisk":"low|medium|high|critical",
 "contentQuality":"natural|template|machine|spun|gibberish|thin",
 "contentQualityNote":"1 sentence why",
 "issues":[{"severity":"CRITICAL|HIGH|MEDIUM|LOW","category":"misrepresentation|unrealistic_claims|health_claims|financial_promises|fake_urgency|fake_reviews|celebrity_endorsement|missing_business_info|pricing_transparency|weird_text|language_mismatch|restricted_content|impersonation|other","quote":"verbatim excerpt or empty","problem":"what is wrong","fix":"how to fix"}],
 "findings":[{"text":"...","isRealRisk":true,"reason":"short"}],
 "summary":"1 sentence about the trigger phrases",
 "impersonation":{"isLikely":false,"brand":"","reason":""},
 "strengths":["..."],
 "tips":[{"title":"short action","text":"1–2 sentences: what to do and why"}],
 "pageVertical":"general","pageCountry":""}

PAGE TEXT:
"""${trimmedExcerpt}"""
${triggerList ? `\nREGEX TRIGGER PHRASES:\n${triggerList}` : ''}`;

  const messages = [
    { role: 'system', content: 'You answer with valid JSON only, no markdown, no commentary.' },
    { role: 'user', content: prompt }
  ];
  const haystack = normalize(`${title} ${description} ${pageText}`);
  let lastError = null;
  for (const model of [...new Set([AIML_REVIEW_MODEL, AIML_REVIEW_FALLBACK_MODEL, AIML_MODEL])]) {
    try {
      const content = await chatCompletion(messages, {
        model, maxTokens: 6000, temperature: 0, json: true,
        timeoutMs: model === AIML_MODEL ? AIML_TIMEOUT_MS : AIML_REVIEW_TIMEOUT_MS
      });
      const parsed = extractJson(content);
      if (!parsed) throw new Error('LLM returned non-JSON response');
      const imp = parsed.impersonation || {};
      let dropped = 0;
      const issues = [];
      for (const i of (Array.isArray(parsed.issues) ? parsed.issues : []).slice(0, 20)) {
        if (!i || !i.problem) continue;
        const category = REVIEW_CATEGORIES.has(i.category) ? i.category : 'other';
        const sev = String(i.severity).toUpperCase();
        const quote = String(i.quote || '').slice(0, 300);
        const verified = quote ? quoteOnPage(quote, haystack) : false;
        if (QUOTE_REQUIRED.has(category) && !verified) { dropped++; continue; }
        // a quote that is only a JS countdown placeholder ("00 Days 00 Hours 00 Min") proves nothing
        if (category === 'fake_urgency' && /^\W*(0{1,2}\s*(days?|hours?|hrs?|min(utes)?|sec(onds)?|д(н(ей|я)?)?|ч(ас(ов|а)?)?|мин|сек)\W*){2,}/i.test(quote)) { dropped++; continue; }
        issues.push({
          // page language ≠ GEO language is a relevance/quality issue, not a ban reason; and only
          // clear-cut violations (posing as a brand, prohibited content) may be CRITICAL — for
          // judgement calls (claims, reviews…) the model flips between HIGH and CRITICAL run to run,
          // and CRITICAL sets a score floor, so the score would jump between identical scans
          severity: category === 'language_mismatch' && ['CRITICAL', 'HIGH'].includes(sev) ? 'MEDIUM'
            : sev === 'CRITICAL' && !AI_CRITICAL_CATEGORIES.has(category) ? 'HIGH'
            : REVIEW_SEVERITIES.has(sev) ? sev : 'MEDIUM',
          category,
          quote: verified ? quote : '',
          quoteVerified: verified,
          problem: String(i.problem).slice(0, 500),
          fix: String(i.fix || '').slice(0, 400)
        });
        if (issues.length >= 12) break;
      }
      // the overall level can't exceed what the concrete findings support — otherwise the
      // model's "high risk" vibe contradicts a list of MEDIUM/LOW nits
      const RANK = ['low', 'medium', 'high', 'critical'];
      const worst = issues.reduce((m, i) => Math.max(m, ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].indexOf(i.severity)), 0);
      const modelRisk = RANK.indexOf(parsed.banRisk);
      const banRisk = modelRisk < 0 ? null : RANK[Math.min(modelRisk, Math.max(worst, imp.isLikely === true ? 3 : 0))];
      return {
        available: true,
        model,
        lang,
        pageVertical: String(parsed.pageVertical || '').toLowerCase(),
        pageCountry: /^[A-Za-z]{2}$/.test(String(parsed.pageCountry || '')) ? String(parsed.pageCountry).toUpperCase() : '',
        findings: Array.isArray(parsed.findings) ? parsed.findings : [],
        summary: parsed.summary || null,
        impersonation: { isLikely: imp.isLikely === true, brand: String(imp.brand || ''), reason: String(imp.reason || '') },
        review: {
          verdict: String(parsed.verdict || ''),
          banRisk,
          // "thin" must agree with the measured word count
          contentQuality: parsed.contentQuality === 'thin' && wordCount != null && wordCount >= 300 ? 'template' : String(parsed.contentQuality || ''),
          contentQualityNote: String(parsed.contentQualityNote || ''),
          issues,
          droppedUnverified: dropped,
          strengths: (Array.isArray(parsed.strengths) ? parsed.strengths : []).map(String).filter(Boolean).slice(0, 4),
          tips: (Array.isArray(parsed.tips) ? parsed.tips : [])
            .filter(x => x && (x.title || x.text)).slice(0, 6)
            .map(x => ({ title: String(x.title || '').slice(0, 140), text: String(x.text || '').slice(0, 400) }))
        }
      };
    } catch (e) {
      lastError = e;
      console.error(`[AIMLAPI] page review (${model}) error:`, e.message);
    }
  }
  return { available: false, findings: [], summary: null, review: null, error: lastError?.message };
}
