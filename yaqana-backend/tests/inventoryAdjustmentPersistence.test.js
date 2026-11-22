import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import Product from '../src/models/Product.js';
import StockMovement from '../src/models/StockMovement.js';
import User from '../src/models/User.js';
import { adjustInventory, getInventoryMovements } from '../src/controllers/inventoryController.js';
import { updateProduct } from '../src/controllers/catalogController.js';

const localDatabaseUri = 'mongodb://127.0.0.1:27017/yaqana_local_dev_20261115';

test('a single inventory adjustment persists once on standalone MongoDB', {
  skip: process.env.RUN_LOCAL_DB_TESTS !== '1'
}, async (t) => {
  await mongoose.connect(localDatabaseUri, { serverSelectionTimeoutMS: 3000 });
  const suffix = randomUUID().replace(/-/g, '');
  const idempotencyKey = `inventory-test-${suffix}`;
  const variantKey = `inventory-variant-${suffix}`;
  const concurrentKey = `inventory-concurrent-${suffix}`;
  const distinctKeyA = `inventory-distinct-a-${suffix}`;
  const distinctKeyB = `inventory-distinct-b-${suffix}`;
  const rejectedKey = `inventory-rejected-${suffix}`;
  const batchKey = `inventory-batch-${suffix}`;
  const products = [];

  t.after(async () => {
    await StockMovement.deleteMany({ idempotencyKey: { $in: [idempotencyKey, variantKey, concurrentKey, distinctKeyA, distinctKeyB, rejectedKey, batchKey] } });
    if (products.length) await Product.deleteMany({ _id: { $in: products.map(({ _id }) => _id) } });
    await mongoose.disconnect();
  });

  const product = await Product.create({
    name: `Inventory Integration ${suffix}`,
    slug: `inventory-integration-${suffix}`,
    description: 'Temporary local inventory integration fixture.',
    category: 'Test',
    pricePaise: 10000,
    stock: 10,
    active: true
  });
  products.push(product);
  const secondProduct = await Product.create({
    name: `Inventory Integration Second ${suffix}`,
    slug: `inventory-integration-second-${suffix}`,
    description: 'Temporary local inventory integration fixture.',
    category: 'Test',
    pricePaise: 10000,
    stock: 5,
    active: true
  });
  products.push(secondProduct);
  const variantProduct = await Product.create({
    name: `Inventory Variant ${suffix}`,
    slug: `inventory-variant-${suffix}`,
    description: 'Temporary local SKU inventory integration fixture.',
    category: 'Test',
    pricePaise: 10000,
    sizes: ['S'],
    colours: [{ name: 'Black', hex: '#000000', images: ['/images/test-black-front.jpg', '/images/test-black-back.jpg'] }],
    variants: [{ size: 'S', colour: 'Black', sku: `YQ-TEST-BLACK-S-${suffix.slice(0, 8).toUpperCase()}`, stock: 2 }],
    images: ['/images/test-black-front.jpg'],
    active: true
  });
  products.push(variantProduct);
  const concurrentProduct = await Product.create({
    name: `Inventory Distinct Concurrent ${suffix}`,
    slug: `inventory-distinct-concurrent-${suffix}`,
    description: 'Temporary local inventory concurrency fixture.',
    category: 'Test',
    pricePaise: 10000,
    stock: 5,
    active: true
  });
  products.push(concurrentProduct);
  const admin = await User.findOne({ role: 'admin', status: 'active' }).select('_id');
  assert.ok(admin, 'the confirmed local database must contain an active admin');

  const invokeAdjustment = async (adjustments, key, metadata = {}) => {
    const response = {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; }
    };
    let forwardedError;
    await adjustInventory({
      body: { adjustments, reason: 'integration test receipt', ...metadata },
      user: admin,
      get: (name) => name === 'Idempotency-Key' ? key : undefined
    }, response, (error) => { forwardedError = error; });
    return { response, error: forwardedError };
  };

  const adjustment = [{ productId: String(product._id), delta: 2 }];
  const adjustmentMetadata = {
    type: 'restock',
    reference: 'LOCAL-RECEIPT-1',
    notes: 'Received during the local integration test.'
  };
  const first = await invokeAdjustment(adjustment, idempotencyKey, adjustmentMetadata);
  assert.ifError(first.error);
  const firstResponse = first.response;
  assert.equal(firstResponse.statusCode, 201);
  assert.equal(await Product.findById(product._id).then((entry) => entry.stock), 12);
  const movement = await StockMovement.findOne({ idempotencyKey }).select('+requestHash');
  assert.ok(movement);
  assert.equal(movement.changes[0].stockBefore, 10);
  assert.equal(movement.changes[0].stockAfter, 12);
  assert.equal(movement.type, 'restock');
  assert.equal(movement.reference, 'LOCAL-RECEIPT-1');
  assert.equal(movement.notes, 'Received during the local integration test.');

  const retry = await invokeAdjustment(adjustment, idempotencyKey, adjustmentMetadata);
  assert.ifError(retry.error);
  const retryResponse = retry.response;
  assert.equal(retryResponse.statusCode, 200);
  assert.equal(await Product.findById(product._id).then((entry) => entry.stock), 12);
  assert.equal(await StockMovement.countDocuments({ idempotencyKey }), 1);
  const changedMetadataRetry = await invokeAdjustment(adjustment, idempotencyKey, {
    ...adjustmentMetadata,
    reference: 'LOCAL-RECEIPT-2'
  });
  assert.equal(changedMetadataRetry.error?.statusCode, 409);
  assert.equal(await Product.findById(product._id).then((entry) => entry.stock), 12);

  const concurrentAdjustment = [{ productId: String(secondProduct._id), delta: 2 }];
  const concurrentResults = await Promise.all([
    invokeAdjustment(concurrentAdjustment, concurrentKey),
    invokeAdjustment(concurrentAdjustment, concurrentKey)
  ]);
  assert.ok(concurrentResults.every((result) => !result.error));
  assert.equal(await Product.findById(secondProduct._id).then((entry) => entry.stock), 7);
  assert.equal(await StockMovement.countDocuments({ idempotencyKey: concurrentKey }), 1);

  const distinctResults = await Promise.all([
    invokeAdjustment([{ productId: String(concurrentProduct._id), delta: 2 }], distinctKeyA),
    invokeAdjustment([{ productId: String(concurrentProduct._id), delta: 3 }], distinctKeyB)
  ]);
  assert.ok(distinctResults.every((result) => !result.error));
  assert.equal(await Product.findById(concurrentProduct._id).then((entry) => entry.stock), 10);
  const distinctMovements = await StockMovement.find({ idempotencyKey: { $in: [distinctKeyA, distinctKeyB] } });
  assert.equal(distinctMovements.length, 2);
  const stockTransitions = distinctMovements.map(({ changes }) => [changes[0].stockBefore, changes[0].stockAfter])
    .sort((left, right) => left[0] - right[0]);
  assert.ok(
    JSON.stringify(stockTransitions) === JSON.stringify([[5, 7], [7, 10]]) ||
    JSON.stringify(stockTransitions) === JSON.stringify([[5, 8], [8, 10]])
  );

  const rejected = await invokeAdjustment([{ productId: String(product._id), delta: -100 }], rejectedKey);
  assert.equal(rejected.error?.statusCode, 409);
  assert.equal(await Product.findById(product._id).then((entry) => entry.stock), 12);
  assert.equal(await StockMovement.findOne({ idempotencyKey: rejectedKey }).then((entry) => entry.status), 'rejected');
  const historyResponse = {
    body: null,
    json(body) { this.body = body; return this; }
  };
  await getInventoryMovements({ query: { productId: String(product._id) } }, historyResponse, assert.ifError);
  assert.equal(historyResponse.body.movements.some((entry) => entry.idempotencyKey === rejectedKey), false);

  const variantAdjustment = await invokeAdjustment([
    { sku: variantProduct.variants[0].sku, delta: 3 }
  ], variantKey);
  assert.ifError(variantAdjustment.error);
  assert.equal(variantAdjustment.response.statusCode, 201);
  const updatedVariantProduct = await Product.findById(variantProduct._id);
  assert.equal(updatedVariantProduct.stock, 5);
  assert.equal(updatedVariantProduct.variants[0].stock, 5);
  const variantMovement = await StockMovement.findOne({ idempotencyKey: variantKey });
  assert.equal(variantMovement.changes[0].sku, variantProduct.variants[0].sku);
  assert.equal(variantMovement.changes[0].size, 'S');
  assert.equal(variantMovement.changes[0].colour, 'Black');
  assert.equal(variantMovement.changes[0].stockBefore, 2);
  assert.equal(variantMovement.changes[0].stockAfter, 5);

  const productEditResponse = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  let stockEditError;
  await updateProduct({
    params: { id: String(product._id) },
    body: { stock: 99 }
  }, productEditResponse, (error) => { stockEditError = error; });
  assert.equal(stockEditError?.statusCode, 400);
  assert.equal(await Product.findById(product._id).then((entry) => entry.stock), 12);

  const batch = await invokeAdjustment([
    { productId: String(product._id), delta: 1 },
    { productId: String(secondProduct._id), delta: 1 }
  ], batchKey);
  assert.equal(batch.error?.statusCode, 503);
  assert.equal(await Product.findById(product._id).then((entry) => entry.stock), 12);
  assert.equal(await Product.findById(secondProduct._id).then((entry) => entry.stock), 7);
});
