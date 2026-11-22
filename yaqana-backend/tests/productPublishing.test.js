import test from 'node:test';
import assert from 'node:assert/strict';
import Product from '../src/models/Product.js';
import AdminAudit from '../src/models/AdminAudit.js';
import { createProduct } from '../src/controllers/catalogController.js';

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; }
});

test('incomplete product drafts can be saved without an image or colour matrix', async (t) => {
  t.mock.method(Product, 'create', async (record) => ({ _id: 'draft-1', ...record }));
  let audit;
  t.mock.method(AdminAudit, 'create', async (record) => { audit = record; });
  const res = response();
  await createProduct({ body: {
    name: 'Draft shirt', description: 'Work in progress', category: 'Shirts', price: 25,
    sizes: ['M'], colours: [], status: 'draft'
  }, user: { _id: 'admin-1' } }, res, (error) => { throw error; });
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.product.status, 'draft');
  assert.deepEqual(res.body.product.images, []);
  assert.equal(audit.action, 'catalog.product.create');
  assert.equal(audit.metadata.targetId, 'draft-1');
});

test('active product creation rejects incomplete merchandising before writing', async (t) => {
  t.mock.method(Product, 'create', async () => assert.fail('incomplete products must not be created as active'));
  const res = response();
  let error;
  await createProduct({ body: {
    name: 'Incomplete shirt', description: 'Description', category: 'Shirts', price: 25,
    sizes: ['M'], colours: [], images: ['https://images.example.test/shirt.jpg'], status: 'active'
  } }, res, (caught) => { error = caught; });
  assert.equal(error?.statusCode, 400);
  assert.equal(error?.code, 'PRODUCT_INCOMPLETE');
  assert.match(error.message, /at least one colour/u);
});

test('product creation does not persist when its audit intent cannot be written', async (t) => {
  let productWriteCalled = false;
  t.mock.method(Product, 'create', async () => { productWriteCalled = true; return {}; });
  t.mock.method(AdminAudit, 'create', async () => { throw new Error('audit storage unavailable'); });
  const res = response();
  let forwardedError;
  await createProduct({ body: {
    name: 'Draft shirt', description: 'Work in progress', category: 'Shirts', price: 25,
    sizes: ['M'], colours: [], status: 'draft'
  }, user: { _id: 'admin-1' } }, res, (error) => { forwardedError = error; });
  assert.match(forwardedError?.message || '', /audit storage unavailable/);
  assert.equal(productWriteCalled, false);
});
