import test from 'node:test';
import assert from 'node:assert/strict';
import { getProductCompletenessIssues } from '../src/utils/productCompleteness.js';

test('product publication completeness checks required merchandising fields', () => {
  assert.deepEqual(getProductCompletenessIssues({
    name: 'Linen shirt', description: 'Lightweight linen.', category: 'Shirts', pricePaise: 250000,
    images: ['/images/shirt.jpg'], sizes: ['M'], colours: [{ name: 'Sand' }]
  }), []);
  assert.deepEqual(getProductCompletenessIssues({}), [
    'product name', 'description', 'category', 'price above zero', 'at least one product image', 'at least one size', 'at least one colour'
  ]);
});
