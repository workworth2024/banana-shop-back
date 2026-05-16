export const escapeRegex = (s) => String(s ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const buildSafeRegex = (input, maxLen = 100) => {
  const str = String(input ?? '').trim().slice(0, maxLen);
  if (!str) return null;
  return { $regex: escapeRegex(str), $options: 'i' };
};
