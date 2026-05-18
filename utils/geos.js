import countries from './countries.json' with { type: 'json' };

export const ALLOWED_GEO_CODES = countries.map(c => c.code);
export const GEO_SET = new Set(ALLOWED_GEO_CODES);

export const isValidGeo = (code) => typeof code === 'string' && GEO_SET.has(code);

export const sanitizeGeos = (input) => {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const code = String(raw.code || '').trim().toUpperCase();
    if (!GEO_SET.has(code) || seen.has(code)) continue;
    const counts = Math.max(0, parseInt(raw.counts, 10) || 0);
    seen.add(code);
    out.push({ code, counts });
  }
  return out;
};

export default { ALLOWED_GEO_CODES, GEO_SET, isValidGeo, sanitizeGeos };
