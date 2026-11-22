import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {
  buildGlobalCustomerFilter,
  buildGlobalOrderFilter,
  buildGlobalProductFilter,
  buildGlobalSearchRegex,
  normalizeGlobalSearchTerm
} from '../src/utils/adminGlobalSearch.js';

test('global search bounds user input and strips control characters', () => {
  assert.equal(normalizeGlobalSearchTerm('  AB\n12  '), 'AB12');
  assert.throws(() => normalizeGlobalSearchTerm('x'), (error) => error.code === 'INVALID_SEARCH');
  assert.throws(() => normalizeGlobalSearchTerm('a'.repeat(101)), (error) => error.code === 'INVALID_SEARCH');
});

test('global search escapes regex syntax and scopes customer/product matches', () => {
  const regex = buildGlobalSearchRegex('shirt.*(sale)');
  assert.equal(regex.test('shirtXYZsale'), false);
  assert.equal(regex.test('A shirt.*(sale) today'), true);
  assert.equal(buildGlobalCustomerFilter(regex).role, 'customer');
  assert.deepEqual(buildGlobalProductFilter(regex).active, { $ne: false });
});

test('global order search is limited to exact ObjectId or matched customer ids', () => {
  const id = new mongoose.Types.ObjectId();
  assert.deepEqual(buildGlobalOrderFilter(String(id), []), { $or: [{ _id: id }] });
  assert.deepEqual(buildGlobalOrderFilter('term', [id]), { $or: [{ customer: { $in: [id] } }] });
  assert.equal(buildGlobalOrderFilter('term', []), null);
});
