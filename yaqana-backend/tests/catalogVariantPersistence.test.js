import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import Product from '../src/models/Product.js';
import { createProduct, getProductById, updateProduct } from '../src/controllers/catalogController.js';

const localDatabaseUri = 'mongodb://127.0.0.1:27017/yaqana_local_dev_20261115';

test('colour galleries can supply the primary image and variant edits persist across reloads', {
  skip: process.env.RUN_LOCAL_DB_TESTS !== '1'
}, async (t) => {
  await mongoose.connect(localDatabaseUri, { serverSelectionTimeoutMS: 3000 });
  const suffix = randomUUID().replace(/-/g, '');
  const slug = `local-variant-persistence-${suffix}`;
  let productId;

  t.after(async () => {
    if (productId) await Product.deleteOne({ _id: productId, slug });
    await mongoose.disconnect();
  });

  const invoke = async (handler, req) => {
    const response = {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; }
    };
    let forwardedError;
    await handler(req, response, (error) => { forwardedError = error; });
    return { response, error: forwardedError };
  };

  const blackGallery = ['/images/variant-black-front.jpg', '/images/variant-black-back.jpg'];
  const stoneGallery = ['/images/variant-stone-front.jpg'];
  const create = await invoke(createProduct, {
    body: {
      name: `Local Variant Persistence ${suffix}`,
      slug,
      description: 'Temporary local product variant persistence test.',
      category: 'Test',
      pricePaise: 250000,
      sizes: ['S', 'M'],
      colours: [
        { name: 'Black', hex: '#000000', images: blackGallery },
        { name: 'Stone', hex: '#CCCCCC', images: stoneGallery }
      ],
      variants: [
        { size: 'S', colour: 'Black', sku: `YQ-${suffix.slice(0, 8)}-BLK-S`, stock: 0 },
        { size: 'S', colour: 'Stone', sku: `YQ-${suffix.slice(0, 8)}-STN-S`, stock: 0 },
        { size: 'M', colour: 'Black', sku: `YQ-${suffix.slice(0, 8)}-BLK-M`, stock: 0 },
        { size: 'M', colour: 'Stone', sku: `YQ-${suffix.slice(0, 8)}-STN-M`, stock: 0 }
      ],
      status: 'draft'
    }
  });

  assert.ifError(create.error);
  assert.equal(create.response.statusCode, 201);
  productId = create.response.body.product._id;
  assert.deepEqual(create.response.body.product.images, blackGallery);
  assert.deepEqual(create.response.body.product.colours[0].images, blackGallery);

  const updated = await invoke(updateProduct, {
    params: { id: String(productId) },
    body: {
      sizes: ['S', 'M', 'L'],
      colours: [
        { name: 'Black', hex: '#000000', images: [...blackGallery, '/images/variant-black-detail.jpg'] },
        { name: 'Stone', hex: '#CCCCCC', images: stoneGallery }
      ],
      variants: [
        { size: 'S', colour: 'Black', sku: `YQ-${suffix.slice(0, 8)}-BLK-S`, stock: 0 },
        { size: 'S', colour: 'Stone', sku: `YQ-${suffix.slice(0, 8)}-STN-S`, stock: 0 },
        { size: 'M', colour: 'Black', sku: `YQ-${suffix.slice(0, 8)}-BLK-M`, stock: 0 },
        { size: 'M', colour: 'Stone', sku: `YQ-${suffix.slice(0, 8)}-STN-M`, stock: 0 },
        { size: 'L', colour: 'Black', sku: `YQ-${suffix.slice(0, 8)}-BLK-L`, stock: 0 },
        { size: 'L', colour: 'Stone', sku: `YQ-${suffix.slice(0, 8)}-STN-L`, stock: 0 }
      ]
    }
  });

  assert.ifError(updated.error);
  assert.equal(updated.response.statusCode, 200);
  const read = await invoke(getProductById, { params: { id: String(productId) }, user: { role: 'admin' } });
  assert.ifError(read.error);
  const reloaded = await Product.findById(productId).lean();
  assert.equal(reloaded.variants.length, 6);
  assert.deepEqual(reloaded.sizes, ['S', 'M', 'L']);
  assert.deepEqual(reloaded.colours[0].images, [...blackGallery, '/images/variant-black-detail.jpg']);
  assert.deepEqual(reloaded.colours[1].images, stoneGallery);
  assert.equal(reloaded.stock, 0);
  assert.deepEqual(read.response.body.product.images, blackGallery);
});
