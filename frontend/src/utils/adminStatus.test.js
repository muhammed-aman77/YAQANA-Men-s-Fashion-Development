import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LOW_STOCK_THRESHOLD,
  canRenameCategory,
  formatShippingAddress,
  getInventoryStatus,
  getMetricDisplayValue,
  getProductStatusUpdate
} from './adminStatus.js';

test('inventory status uses one inclusive low-stock threshold', () => {
  assert.equal(LOW_STOCK_THRESHOLD, 10);
  assert.equal(getInventoryStatus(0), 'Out of Stock');
  assert.equal(getInventoryStatus(10), 'Low Stock');
  assert.equal(getInventoryStatus(11), 'In Stock');
});

test('archive and activate actions set explicit product state', () => {
  assert.deepEqual(getProductStatusUpdate('archive'), { active: false });
  assert.deepEqual(getProductStatusUpdate('activate'), { active: true });
});

test('draft and discontinued products remain unpublished', () => {
  assert.deepEqual(getProductStatusUpdate('draft'), { status: 'draft' });
  assert.deepEqual(getProductStatusUpdate('discontinue'), { status: 'discontinued' });
});

test('only fixed storefront categories prevent renaming', () => {
  assert.equal(canRenameCategory('shirts'), false);
  assert.equal(canRenameCategory('seasonal-edit'), true);
});

test('analytics values are unavailable until stats load successfully', () => {
  assert.equal(getMetricDisplayValue(0, 'loading'), '—');
  assert.equal(getMetricDisplayValue(0, 'error'), '—');
  assert.equal(getMetricDisplayValue(0, 'loaded'), 0);
});

test('shipping address formatter includes available delivery fields', () => {
  assert.equal(
    formatShippingAddress({
      fullName: 'A. Customer',
      addressLine1: '12 Park Street',
      addressLine2: 'Apartment 4',
      city: 'Kolkata',
      state: 'West Bengal',
      postalCode: '700016',
      country: 'India',
      phone: '9876543210'
    }),
    'A. Customer · 12 Park Street · Apartment 4 · Kolkata · West Bengal · 700016 · India · 9876543210'
  );
  assert.equal(formatShippingAddress(null), '');
});
