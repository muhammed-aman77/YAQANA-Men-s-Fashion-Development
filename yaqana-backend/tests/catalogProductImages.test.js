import test from 'node:test';
import assert from 'node:assert/strict';
import Product from '../src/models/Product.js';
import Category from '../src/models/Category.js';
import Collection from '../src/models/Collection.js';
import AdminAudit from '../src/models/AdminAudit.js';
import { createProduct, getProducts, removeCollection, renameCollection, updateCategory, updateProduct } from '../src/controllers/catalogController.js';

const cloudinaryUrl = 'https://res.cloudinary.com/yaqana/image/upload/v1763120000/yaqana/products/yaqana-7f38a9c2e6d14b10a9ce23d4.jpg';
const legacyUrl = '/images/yaqana-products/classic-shirt.jpg';
const validId = '65f1a3b2c4d5e6f7890a1234';

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

test('creates a product with a Cloudinary secure_url in the images array', async (t) => {
  t.mock.method(AdminAudit, 'create', async () => {});
  const originalCreate = Product.create;
  let createdProduct;
  Product.create = async (data) => {
    createdProduct = data;
    return data;
  };
  t.after(() => { Product.create = originalCreate; });

  const response = createResponse();
  await createProduct({
    body: {
      name: 'Cloudinary Shirt',
      description: 'A product with a durable image.',
      category: 'Shirts',
      price: 2500,
      sizes: ['M'],
      colours: ['Neutral'],
      stock: 5,
      images: [cloudinaryUrl]
    },
    user: { _id: 'admin-1' }
  }, response, (error) => { throw error; });

  assert.equal(response.statusCode, 201);
  assert.deepEqual(createdProduct.images, [cloudinaryUrl]);
  assert.deepEqual(response.body.product.images, [cloudinaryUrl]);
});

test('updates a product with a Cloudinary secure_url while preserving existing image URLs', async (t) => {
  t.mock.method(AdminAudit, 'create', async () => {});
  const originalFindById = Product.findById;
  const product = {
    _id: validId,
    pricePaise: 250000,
    discountPricePaise: null,
    stock: 5,
    variants: [],
    images: [legacyUrl],
    async save() {}
  };
  Product.findById = async () => product;
  t.after(() => { Product.findById = originalFindById; });

  const response = createResponse();
  await updateProduct({
    params: { id: validId }, user: { _id: 'admin-1' },
    body: { images: [legacyUrl, cloudinaryUrl] }
  }, response, (error) => { throw error; });

  assert.deepEqual(product.images, [legacyUrl, cloudinaryUrl]);
  assert.deepEqual(response.body.product.images, [legacyUrl, cloudinaryUrl]);
});

test('optional-auth catalog reads keep an administrator without an MFA-verified session on public filters', async (t) => {
  let queryUsed;
  t.mock.method(Product, 'find', (query) => {
    queryUsed = query;
    return { sort() { return this; }, skip() { return this; }, limit: async () => [] };
  });
  t.mock.method(Product, 'countDocuments', async () => 0);
  const response = createResponse();

  await getProducts({ user: { role: 'admin' }, session: { mfaVerifiedAt: null }, query: {} }, response, (error) => { throw error; });

  assert.deepEqual(queryUsed.active, { $ne: false });
  assert.deepEqual(queryUsed.gender, { $in: ['men', 'unisex'] });
});

test('category rename is rejected before product or category writes when transaction-safe rename is unavailable', async (t) => {
  const category = { _id: validId, name: 'Seasonal', slug: 'seasonal', active: true, async save() { this.saved = true; } };
  let productWrite = false;
  let auditWrite = false;
  t.mock.method(Category, 'findById', async () => category);
  t.mock.method(Product, 'updateMany', async () => { productWrite = true; });
  t.mock.method(AdminAudit, 'create', async () => { auditWrite = true; });
  let forwardedError;

  await updateCategory({ params: { id: validId }, body: { name: 'New Season' }, user: { _id: 'admin-1' } }, createResponse(), (error) => { forwardedError = error; });

  assert.equal(forwardedError?.code, 'TRANSACTIONS_REQUIRED');
  assert.equal(productWrite, false);
  assert.equal(auditWrite, false);
  assert.equal(category.saved, undefined);
});

test('collection rename and removal are rejected before product or collection writes', async (t) => {
  const collection = { _id: validId, name: 'Summer', slug: 'summer', active: true, async save() { this.saved = true; } };
  let productWrite = false;
  let collectionDelete = false;
  let auditWrite = false;
  t.mock.method(Collection, 'findOne', async () => collection);
  t.mock.method(Product, 'updateMany', async () => { productWrite = true; });
  t.mock.method(Collection, 'deleteOne', async () => { collectionDelete = true; return { deletedCount: 1 }; });
  t.mock.method(AdminAudit, 'create', async () => { auditWrite = true; });
  let renameError;
  let removalError;

  await renameCollection({ params: { name: 'Summer' }, body: { name: 'New Summer' }, user: { _id: 'admin-1' } }, createResponse(), (error) => { renameError = error; });
  await removeCollection({ params: { name: 'Summer' }, user: { _id: 'admin-1' } }, createResponse(), (error) => { removalError = error; });

  assert.equal(renameError?.code, 'TRANSACTIONS_REQUIRED');
  assert.equal(removalError?.code, 'TRANSACTIONS_REQUIRED');
  assert.equal(productWrite, false);
  assert.equal(collectionDelete, false);
  assert.equal(auditWrite, false);
  assert.equal(collection.saved, undefined);
});
