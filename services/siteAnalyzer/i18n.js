/**
 * Report language = the language the user has selected on the site (RU / EN). Every text the
 * scanner produces (findings, recommendations, AI review) is written in that language.
 */
export const LANGS = ['ru', 'en'];

export const normalizeLang = (lang) => (String(lang || '').toLowerCase().startsWith('en') ? 'en' : 'ru');

/** tr('en')('по-русски', 'in English') → 'in English' */
export const tr = (lang) => (ru, en) => (normalizeLang(lang) === 'en' ? en : ru);
