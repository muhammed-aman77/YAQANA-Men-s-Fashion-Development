import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSavedAdminFilters } from '../src/utils/savedAdminFilters.js';

test('saved admin filters retain only supported bounded values', () => {
  assert.deepEqual(sanitizeSavedAdminFilters([{
    id: 'orders-1', label: 'Pending COD', section: 'orders',
    filters: { status: 'Pending', paymentType: 'cod', customerEmail: 'secret@example.test' }
  }]), [{ id: 'orders-1', label: 'Pending COD', section: 'orders', filters: { status: 'Pending', paymentType: 'cod' } }]);
});

test('saved admin filters reject duplicate IDs, excess presets and unsupported sections', () => {
  assert.throws(() => sanitizeSavedAdminFilters([
    { id: 'same', label: 'One', section: 'orders' }, { id: 'same', label: 'Two', section: 'orders' }
  ]), /unique/u);
  assert.throws(() => sanitizeSavedAdminFilters(Array.from({ length: 13 }, (_, index) => ({ id: `f-${index}`, label: 'Filter', section: 'orders' }))), /12/u);
  assert.throws(() => sanitizeSavedAdminFilters([{ id: 'bad', label: 'Bad', section: 'users' }]), /Unsupported/u);
});
