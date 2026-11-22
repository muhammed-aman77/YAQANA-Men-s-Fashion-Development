import test from 'node:test';
import assert from 'node:assert/strict';
import Product from '../src/models/Product.js';
import Cart from '../src/models/Cart.js';
import { addToCart, updateQuantity, validateCartItem } from '../src/controllers/cartController.js';

const productId = '507f1f77bcf86cd799439011';

async function invoke(handler, req) {
  let error;
  await handler(req, { json() { return this; } }, (nextError) => { error = nextError; });
  return error;
}

test('backend cart validation uses available stock after reservations', async (t) => {
  const originalFindOne = Product.findOne;
  Product.findOne = async () => ({
    _id: productId,
    sizes: ['M'],
    colours: [{ name: 'Black' }],
    stock: 5,
    variants: [{ size: 'M', colour: 'Black', stock: 5, reservedQuantity: 2, status: 'active' }]
  });
  t.after(() => { Product.findOne = originalFindOne; });

  await assert.rejects(
    validateCartItem(productId, 'M', 'Black', 4),
    (error) => error.statusCode === 409
  );
  assert.ok(await validateCartItem(productId, 'M', 'Black', 3));
});

test('backend cart validation rejects inactive variants even when stock exists', async (t) => {
  const originalFindOne = Product.findOne;
  Product.findOne = async () => ({
    _id: productId,
    sizes: ['M'],
    colours: [{ name: 'Black' }],
    stock: 5,
    variants: [{ size: 'M', colour: 'Black', stock: 5, reservedQuantity: 0, status: 'inactive' }]
  });
  t.after(() => { Product.findOne = originalFindOne; });

  await assert.rejects(
    validateCartItem(productId, 'M', 'Black', 1),
    (error) => error.statusCode === 409
  );
});

test('backend repeated cart addition rejects an aggregate above available stock without saving', async (t) => {
  const originals = { findProduct: Product.findOne, findCart: Cart.findOne };
  let saved = false;
  Product.findOne = async () => ({
    _id: productId, sizes: ['M'], colours: [{ name: 'Black' }], stock: 4,
    variants: [{ size: 'M', colour: 'Black', stock: 4, reservedQuantity: 1, status: 'active' }]
  });
  Cart.findOne = async () => ({
    items: [{ product: productId, size: 'M', colour: 'Black', quantity: 3 }],
    async save() { saved = true; }
  });
  t.after(() => { Product.findOne = originals.findProduct; Cart.findOne = originals.findCart; });

  const error = await invoke(addToCart, {
    user: { _id: 'customer-1' },
    body: { productId, size: 'M', colour: 'Black', quantity: 1 }
  });
  assert.equal(error?.statusCode, 409);
  assert.equal(saved, false);
});

test('backend cart update rejects stock that changed below the requested quantity', async (t) => {
  const originals = { findProduct: Product.findOne, findCart: Cart.findOne };
  let saved = false;
  Product.findOne = async () => ({
    _id: productId, sizes: ['M'], colours: [{ name: 'Black' }], stock: 3,
    variants: [{ size: 'M', colour: 'Black', stock: 3, reservedQuantity: 1, status: 'active' }]
  });
  Cart.findOne = async () => ({
    items: { id: () => ({ product: productId, size: 'M', colour: 'Black', quantity: 2 }) },
    async save() { saved = true; }
  });
  t.after(() => { Product.findOne = originals.findProduct; Cart.findOne = originals.findCart; });

  const error = await invoke(updateQuantity, {
    user: { _id: 'customer-1' },
    body: { itemId: 'line-1', quantity: 3 }
  });
  assert.equal(error?.statusCode, 409);
  assert.equal(saved, false);
});
