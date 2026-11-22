import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [cartPage, cartDrawer] = await Promise.all([
  readFile(new URL('../src/pages/CartPage.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/CartDrawer.jsx', import.meta.url), 'utf8')
]);

test('cart page displays rejected quantity updates as an accessible alert', () => {
  assert.match(cartPage, /const result = await updateQuantity\(itemId, quantity\)/);
  assert.match(cartPage, /if \(result && !result\.success\)\s*\{\s*setCartError\(result\.message/);
  assert.match(cartPage, /role="alert"[^>]*>\{cartError\}/);
});

test('cart drawer displays rejected quantity updates as an accessible alert', () => {
  assert.match(cartDrawer, /const result = await updateQuantity\(itemId, quantity\)/);
  assert.match(cartDrawer, /if \(result && !result\.success\)\s*\{\s*setQuantityError\(result\.message/);
  assert.match(cartDrawer, /role="alert"[^>]*>\{quantityError\}/);
});
