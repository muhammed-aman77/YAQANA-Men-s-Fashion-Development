import test from 'node:test';
import assert from 'node:assert/strict';
import { getCartQuantityError } from './cartStock.js';

test('guest cart rejects repeated additions that exceed available quantity', () => {
  assert.equal(getCartQuantityError({ currentQuantity: 3, addQuantity: 2, availableStock: 4, status: 'active' }), 'STOCK_CHANGED');
  assert.equal(getCartQuantityError({ currentQuantity: 2, addQuantity: 2, availableStock: 4, status: 'active' }), null);
});

test('guest quantity update respects current available stock', () => {
  assert.equal(getCartQuantityError({ desiredQuantity: 5, availableStock: 4, status: 'active' }), 'STOCK_CHANGED');
  assert.equal(getCartQuantityError({ desiredQuantity: 3, availableStock: 4, status: 'active' }), null);
});

test('cart validation rejects unavailable variants and invalid stock data', () => {
  assert.equal(getCartQuantityError({ desiredQuantity: 1, availableStock: 4, status: 'inactive' }), 'UNAVAILABLE');
  assert.equal(getCartQuantityError({ desiredQuantity: 1, availableStock: undefined, status: 'active' }), 'UNAVAILABLE');
  assert.equal(getCartQuantityError({ desiredQuantity: 0, availableStock: 4, status: 'active' }), 'INVALID_QUANTITY');
});
