import { httpError } from './http.js';

const FILTER_FIELDS = {
  orders: ['status', 'paymentStatus', 'paymentType', 'dateFrom', 'dateTo'],
  products: ['category', 'collection', 'stock', 'status', 'sortBy'],
  inventory: ['category', 'status', 'active', 'variantStatus', 'sort']
};

export function sanitizeSavedAdminFilters(input) {
  if (!Array.isArray(input) || input.length > 12) throw httpError(400, 'Provide at most 12 saved filters.');
  const ids = new Set();
  return input.map((entry) => {
    const id = String(entry?.id || '').slice(0, 64);
    const label = String(entry?.label || '').trim();
    const section = String(entry?.section || '');
    if (!/^[\w-]{1,64}$/u.test(id) || ids.has(id)) throw httpError(400, 'Saved filter identifiers must be unique.');
    if (!label || label.length > 40) throw httpError(400, 'Saved filter names must be 1 to 40 characters.');
    if (!Object.hasOwn(FILTER_FIELDS, section)) throw httpError(400, 'Unsupported saved filter section.');
    const source = entry?.filters && typeof entry.filters === 'object' && !Array.isArray(entry.filters) ? entry.filters : {};
    const filters = {};
    for (const field of FILTER_FIELDS[section]) {
      if (source[field] === undefined) continue;
      const value = String(source[field]);
      if (value.length > 100) throw httpError(400, 'Saved filter value is too long.');
      filters[field] = value;
    }
    ids.add(id);
    return { id, label, section, filters };
  });
}
