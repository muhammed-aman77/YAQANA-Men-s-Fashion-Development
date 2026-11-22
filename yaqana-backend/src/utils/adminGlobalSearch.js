import mongoose from 'mongoose';
import { httpError } from './http.js';

export function normalizeGlobalSearchTerm(value) {
  const term = String(value || '').trim().replace(/[\u0000-\u001f\u007f]/gu, '');
  if (term.length < 2 || term.length > 100) throw httpError(400, 'Search must contain between 2 and 100 characters.', 'INVALID_SEARCH');
  return term;
}

export function escapeSearchRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

export function buildGlobalSearchRegex(term) {
  return new RegExp(escapeSearchRegex(normalizeGlobalSearchTerm(term)), 'i');
}

export function buildGlobalCustomerFilter(regex) {
  return { role: 'customer', $or: [{ name: regex }, { email: regex }, { phone: regex }] };
}

export function buildGlobalProductFilter(regex) {
  return {
    active: { $ne: false },
    $or: [{ name: regex }, { category: regex }, { 'variants.sku': regex }]
  };
}

export function buildGlobalOrderFilter(term, customerIds) {
  const conditions = [];
  if (mongoose.isValidObjectId(term)) conditions.push({ _id: new mongoose.Types.ObjectId(term) });
  if (customerIds.length) conditions.push({ customer: { $in: customerIds } });
  return conditions.length ? { $or: conditions } : null;
}
