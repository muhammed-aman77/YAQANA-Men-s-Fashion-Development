import test from 'node:test';
import assert from 'node:assert/strict';
import { addProductToCartAndCheckout } from './buyNow.js';

test('buy now adds the selected variant without opening the cart and continues to checkout', async () => {
  const calls = [];
  const product = { _id: 'product-1' };
  const navigate = (path) => calls.push(['navigate', path]);
  const addToCart = async (...args) => {
    calls.push(['addToCart', ...args]);
    return { success: true };
  };

  const result = await addProductToCartAndCheckout({
    addToCart,
    navigate,
    product,
    size: 'M',
    colour: 'Black',
    quantity: 2
  });

  assert.deepEqual(result, { success: true });
  assert.deepEqual(calls, [
    ['addToCart', product, 'M', 'Black', 2, { openCart: false }],
    ['navigate', '/checkout']
  ]);
});

test('buy now stays on the product page when adding the item fails', async () => {
  const calls = [];
  const result = await addProductToCartAndCheckout({
    addToCart: async () => ({ success: false, message: 'Not available' }),
    navigate: (path) => calls.push(path),
    product: { _id: 'product-1' },
    size: 'M',
    colour: 'Black',
    quantity: 1
  });

  assert.deepEqual(result, { success: false, message: 'Not available' });
  assert.deepEqual(calls, []);
});
