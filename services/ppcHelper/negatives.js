/**
 * Negative keywords that fit the offer instead of a fixed template.
 *
 * The engine starts from generic lists (language-wide + niche templates). This pass removes what would hurt
 * this particular offer and labels where every remaining term came from:
 *   - seed      → the term is part of the user's own phrases
 *   - keyword   → as a broad negative it would block a keyword of the build (all its words occur in the keyword)
 *   - site      → the landing page promises it in its title / description / headings ("free trial" → keep "free")
 *   - irrelevant→ a niche-template term whose topic never appears in the offer, page or keywords ("recipe" for a CRM)
 *   - duplicate → a broad negative that is already covered by a shorter kept one ("free download" vs "free")
 *   - ai        → the AI review says it blocks real buyers of this offer (reason stored)
 * AI-proposed new negatives are returned as `suggested` (with reasons) and only enter the list when the user adds them.
 * Removed terms are kept with the reason so the UI can show them. Idempotent: safe to re-run after the keyword
 * list changes (metrics refresh, applied AI candidates).
 */

const norm = (s) => ` ${String(s || '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim()} `;
const wordsOf = (s) => norm(s).trim().split(' ').filter(Boolean);
const hasPhrase = (text, term) => text.includes(norm(term));
const hasAllWords = (kwWords, termWords) => termWords.every((w) => kwWords.has(w));

// words that are junk by themselves: a niche template term made only of these adds nothing to the base list
// topic-bound informational terms: fine to drop when the offer has nothing to do with them
const TOPICAL = new Set(['diy', 'recipe', 'how to make', 'своими руками', 'рецепт', 'народные методы', 'как сделать самому']);
const JUNK = new Set(['free', 'download', 'torrent', 'hack', 'crack', 'cheat', 'generator', 'leak', 'activation', 'pdf',
  'бесплатно', 'скачать', 'торрент', 'взлом', 'кряк', 'слив', 'kostenlos', 'gratis', 'descargar', 'darmowe', 'pobierz', 'miễn', 'phí']);

/** Context snippet around the match on the page, for the "it's on your site" explanation. */
function snippet(rawText, term) {
  const text = String(rawText || '').replace(/\s+/g, ' ');
  const i = text.toLowerCase().indexOf(String(term).toLowerCase());
  if (i < 0) return '';
  const from = Math.max(0, text.lastIndexOf(' ', Math.max(0, i - 24)));
  const to = text.indexOf(' ', Math.min(text.length, i + term.length + 24));
  return text.slice(from, to < 0 ? undefined : to).trim().slice(0, 80);
}

export function refineNegatives(result, ai = null) {
  const neg = result.negatives || { accountNegatives: [], campaignNegatives: {} };
  const sources = { ...(neg.sources || {}) };
  const notes = { ...(neg.notes || {}) };
  const removed = new Map((neg.removed || []).map((r) => [r.term, r]));
  const offer = result.offer || {};
  const audit = result.siteAudit || {};

  const seeds = (offer.keywords || []).map((k) => ({ k, w: new Set(wordsOf(k)) }));
  const kws = (result.keywords || []).filter((k) => k.cluster !== 'negative_candidate').map((k) => ({ k, w: new Set(wordsOf(k.keyword)) }));
  const promiseRaw = [audit.title, audit.description, ...(audit.h1 || []), ...(audit.headings || [])].filter(Boolean).join(' · ');
  const promise = norm(promiseRaw);
  const topic = norm([promiseRaw, String(audit.visibleText || '').slice(0, 12000), offer.offerDescription, offer.title,
    ...(offer.keywords || []), ...(result.keywords || []).map((k) => k.keyword)].join(' '));

  // AI additions join the pool; AI removals are verdicts on existing terms
  const aiRemove = new Map((ai?.remove || []).map((r) => [String(r.term).toLowerCase().trim(), r]));
  const pool = new Set([...(neg.accountNegatives || []), ...Object.values(neg.campaignNegatives || {}).flat()].map((t) => String(t).toLowerCase().trim()).filter(Boolean));
  // AI additions are only suggestions: a new negative can cut paying traffic, so the user adds them with one click
  const suggestions = ai ? (ai.add || []).map((a) => ({ term: String(a.term || '').toLowerCase().trim(), reason: String(a.reason || '').slice(0, 200) })).filter((a) => a.term && !pool.has(a.term))
    : (neg.suggested || []).filter((a) => !pool.has(a.term));

  const verdict = new Map(); // term → null (keep) | removal record
  for (const term of pool) {
    const tw = wordsOf(term);
    if (!tw.length) { verdict.set(term, { term, code: 'duplicate' }); continue; }
    const src = sources[term] || 'base';
    const seed = seeds.find((s) => hasAllWords(s.w, tw));
    if (seed) { verdict.set(term, { term, source: src, code: 'seed', ref: seed.k }); continue; }
    const hit = kws.filter((x) => hasAllWords(x.w, tw)).sort((a, b) => (b.k.volume || 0) - (a.k.volume || 0))[0];
    if (hit) { verdict.set(term, { term, source: src, code: 'keyword', ref: hit.k.keyword, volume: hit.k.dataSource === 'real' ? hit.k.volume : null }); continue; }
    if (promise.trim() && hasPhrase(promise, term)) { verdict.set(term, { term, source: src, code: 'site', ref: snippet(promiseRaw, term) }); continue; }
    if (src === 'vertical') {
      const topicWords = tw.filter((w) => !JUNK.has(w));
      if (topicWords.length && !topicWords.some((w) => topic.includes(` ${w} `))) { verdict.set(term, { term, source: src, code: 'irrelevant' }); continue; }
    }
    // "blocks buyers" is accepted for any term; "irrelevant" only where a term is topic-bound (generic junk filters stay)
    const air = aiRemove.get(term);
    if (air && (air.kind !== 'irrelevant' || src !== 'base' || TOPICAL.has(term))) { verdict.set(term, { term, source: src, code: 'ai', reason: String(air.reason || '').slice(0, 200) }); continue; }
    verdict.set(term, null);
  }
  // broad negatives: "free download torrent" is already blocked by a kept "free"
  const kept = [...verdict.entries()].filter(([, v]) => !v).map(([t]) => t);
  for (const term of kept) {
    const tw = wordsOf(term);
    const cover = kept.find((o) => o !== term && wordsOf(o).length < tw.length && wordsOf(o).every((w) => tw.includes(w)));
    if (cover) verdict.set(term, { term, source: sources[term] || 'base', code: 'duplicate', ref: cover });
  }

  const keep = (t) => !verdict.get(String(t).toLowerCase().trim());
  for (const [term, v] of verdict) if (v) removed.set(term, v); else removed.delete(term);
  const accountNegatives = Array.from(new Set((neg.accountNegatives || []).map((t) => String(t).toLowerCase().trim()))).filter((t) => t && keep(t));
  // a suggestion that would block the user's own phrases or keywords is not offered at all
  // competitor names are a keyword cluster (conquesting), never a negative
  const rivals = new Set([...(offer.competitorBrands || []), ...(result.competitors || []).map((c) => String(c.domain || '').split('.').slice(-2)[0])].flatMap(wordsOf)
    .concat((result.keywords || []).filter((k) => k.cluster === 'brand_competitor').flatMap((k) => wordsOf(k.keyword)).filter((w) => w.length > 3 && !JUNK.has(w))));
  // a word the landing page itself uses ("plagiarism", "resume builder", "for students") describes the product, not junk
  const siteTokens = wordsOf([promiseRaw, String(audit.visibleText || '').slice(0, 12000), offer.offerDescription].join(' '));
  const onSite = (w) => w.length >= 4 && siteTokens.some((t) => t.startsWith(w.slice(0, Math.max(4, w.length - 2))));
  const suggested = suggestions.filter((a) => {
    const tw = wordsOf(a.term);
    return tw.length && !tw.some(onSite) && !tw.some((w) => rivals.has(w)) && !accountNegatives.some((k) => wordsOf(k).every((w) => tw.includes(w))) && !seeds.some((x) => hasAllWords(x.w, tw)) && !kws.some((x) => hasAllWords(x.w, tw)) && !(promise.trim() && hasPhrase(promise, a.term));
  }).slice(0, 12);
  const campaignNegatives = Object.fromEntries(Object.entries(neg.campaignNegatives || {}).map(([g, list]) => [g, list.filter(keep)]));

  result.negatives = {
    ...neg,
    accountNegatives,
    campaignNegatives,
    sources: Object.fromEntries(accountNegatives.concat(Object.values(campaignNegatives).flat()).map((t) => [String(t).toLowerCase(), sources[String(t).toLowerCase()] || 'base'])),
    notes: Object.fromEntries(Object.entries(notes).filter(([t]) => accountNegatives.includes(t))),
    removed: [...removed.values()].slice(0, 120),
    suggested,
    review: ai ? { ai: true, at: new Date().toISOString() } : (neg.review || { ai: false })
  };
  return result.negatives;
}
