import test from 'node:test';
import assert from 'node:assert/strict';
import Product from '../src/models/Product.js';
import * as catalogController from '../src/controllers/catalogController.js';

function createResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

test('permanent deletion rejects active products without removing them', async (t) => {
  const originalFindById = Product.findById;
  const originalDeleteOne = Product.deleteOne;
  let deleteAttempted = false;
  Product.findById = async () => ({ _id: 'product-active', name: 'Active product', active: true, stock: 0, variants: [] });
  Product.deleteOne = async () => {
    deleteAttempted = true;
    return { deletedCount: 1 };
  };
  t.after(() => {
    Product.findById = originalFindById;
    Product.deleteOne = originalDeleteOne;
  });

  assert.equal(typeof catalogController.permanentlyDeleteProduct, 'function');
  const response = createResponse();
  let error;
  await catalogController.permanentlyDeleteProduct({
    params: { id: 'product-active' },
    user: { _id: 'admin-1', role: 'admin' }
  }, response, (caught) => { error = caught; });

  assert.equal(error?.statusCode, 409);
  assert.equal(deleteAttempted, false);
});

test('permanent deletion rejects products whose stock is not exactly zero', async (t) => {
  const originalFindById = Product.findById;
  const originalDeleteOne = Product.deleteOne;
  Product.findById = async () => ({ _id: 'product-invalid-stock', name: 'Invalid stock', active: false, stock: -1, variants: [] });
  Product.deleteOne = async () => ({ deletedCount: 1 });
  t.after(() => {
    Product.findById = originalFindById;
    Product.deleteOne = originalDeleteOne;
  });

  const response = createResponse();
  let error;
  await catalogController.permanentlyDeleteProduct({
    params: { id: 'product-invalid-stock' },
    user: { _id: 'admin-1', role: 'admin' }
  }, response, (caught) => { error = caught; });

  assert.equal(error?.statusCode, 409);
  assert.equal(error?.code, 'PRODUCT_HAS_STOCK');
});

test('permanent deletion rejects products with conflicting active status fields', async (t) => {
  const originalFindById = Product.findById;
  Product.findById = async () => ({ _id: 'product-conflicting-status', name: 'Conflicting status', active: false, status: 'active', stock: 0, variants: [] });
  t.after(() => { Product.findById = originalFindById; });

  const response = createResponse();
  let error;
  await catalogController.permanentlyDeleteProduct({
    params: { id: 'product-conflicting-status' },
    user: { _id: 'admin-1', role: 'admin' }
  }, response, (caught) => { error = caught; });

  assert.equal(error?.statusCode, 409);
  assert.equal(error?.code, 'PRODUCT_MUST_BE_ARCHIVED');
});
