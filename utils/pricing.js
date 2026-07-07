export const parsePriceTiers = (raw, basePrice) => {
  let tiers = raw;
  if (typeof tiers === 'string') {
    if (!tiers.trim()) return [];
    try { tiers = JSON.parse(tiers); } catch { throw new Error('Некорректный формат уровней опт. цен'); }
  }
  if (tiers === undefined || tiers === null) return [];
  if (!Array.isArray(tiers)) throw new Error('Некорректный формат уровней опт. цен');

  const base = parseFloat(Number(basePrice) || 0);
  const parsed = tiers.map(t => ({
    min_qty: parseInt(t?.min_qty, 10),
    price: parseFloat(t?.price)
  }));

  const sorted = [...parsed].sort((a, b) => a.min_qty - b.min_qty);
  let prevQty = 1;
  let prevPrice = base;
  for (const t of sorted) {
    if (!Number.isFinite(t.min_qty) || !Number.isFinite(t.price)) {
      throw new Error('Заполните количество и цену для каждого уровня');
    }
    if (t.min_qty <= prevQty) {
      throw new Error('Количество каждого следующего уровня должно быть больше предыдущего');
    }
    if (t.price < 0 || t.price >= prevPrice) {
      throw new Error('Цена каждого следующего уровня должна быть меньше предыдущей');
    }
    prevQty = t.min_qty;
    prevPrice = t.price;
  }
  return sorted;
};

export const getEffectiveUnitPrice = (product, quantity) => {
  const qty = Math.max(1, parseInt(quantity, 10) || 1);
  const base = parseFloat(Number(product?.price) || 0);
  const tiers = Array.isArray(product?.price_tiers) ? product.price_tiers : [];
  let price = base;
  for (const t of tiers) {
    if (qty >= t.min_qty) price = t.price;
  }
  return price;
};
