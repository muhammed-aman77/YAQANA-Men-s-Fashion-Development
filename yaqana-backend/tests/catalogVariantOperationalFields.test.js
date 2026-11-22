import test from 'node:test';
import assert from 'node:assert/strict';
import Product from '../src/models/Product.js';
import AdminAudit from '../src/models/AdminAudit.js';
import { updateProduct } from '../src/controllers/catalogController.js';

test('editing a variant matrix preserves the saved per-SKU reorder target', async (t) => {
  t.mock.method(AdminAudit, 'create', async () => {});
  const originalFindById = Product.findById;
  const originalExists = Product.exists;
  const product = {
    _id: '507f1f77bcf86cd799439011',
    name: 'Core Tee',
    description: 'Core tee',
    category: 'T-Shirts',
    pricePaise: 90000,
    discountPricePaise: null,
    sizes: ['S'],
    colours: [{ name: 'Black', hex: '#000000', images: [] }],
    stock: 5,
    variants: [{
      size: 'S',
      colour: 'Black',
      sku: 'CORE-TEE-S',
      stock: 5,
      reorderTarget: 18,
      reservedQuantity: 2,
      unitCostPaise: 12000,
      costedQuantity: 3
    }],
    async save() { return this; }
  };
  Product.findById = async () => product;
  Product.exists = async () => null;
  t.after(() => {
    Product.findById = originalFindById;
    Product.exists = originalExists;
  });

  const response = {
    body: null,
    json(body) { this.body = body; return this; }
  };
  let forwardedError;
  await updateProduct({
    params: { id: product._id },
    user: { _id: 'admin-1' },
    body: {
      variants: [{ size: 'S', colour: 'Black', sku: 'CORE-TEE-S', stock: 5, status: 'active' }]
    }
  }, response, (error) => { forwardedError = error; });

  assert.ifError(forwardedError);
  assert.equal(product.variants[0].reorderTarget, 18);
  assert.equal(product.variants[0].reservedQuantity, 2);
  assert.equal(product.variants[0].unitCostPaise, 12000);
  assert.equal(product.variants[0].costedQuantity, 3);
});
