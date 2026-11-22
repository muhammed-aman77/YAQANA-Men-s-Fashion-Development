import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const cartContext = await readFile(new URL('../src/context/CartContext.jsx', import.meta.url), 'utf8');

test('authenticated quantity update reports rejected responses and reloads the cart', () => {
  const rejectedResponseHandling = /else\s*\{\s*await loadBackendCart\(\);\s*return \{\s*success:\s*false,\s*message:\s*res\.data\.message\s*\|\|\s*['"]Could not update this item in your bag\.[^'"]*['"]\s*\};\s*\}/s;

  assert.match(cartContext, rejectedResponseHandling);
});

test('authenticated quantity update reports network failures without logging the raw error', () => {
  const start = cartContext.indexOf('const updateQuantity = async');
  const end = cartContext.indexOf('const removeFromCart = async', start);
  const updateQuantityHandler = cartContext.slice(start, end);

  assert.match(updateQuantityHandler, /catch \(err\)/);
  assert.match(updateQuantityHandler, /const message = err\.response\?\.data\?\.message \|\|/);
  assert.match(updateQuantityHandler, /await loadBackendCart\(\)/);
  assert.match(updateQuantityHandler, /return \{ success: false, message \}/);
  assert.doesNotMatch(updateQuantityHandler, /console\.warn\([^\n]*err\)/);
});
