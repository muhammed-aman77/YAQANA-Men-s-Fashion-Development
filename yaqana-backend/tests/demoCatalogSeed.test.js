import test from 'node:test';
import assert from 'node:assert/strict';
import {
  seedDemoCatalog,
  validateDemoCatalogTarget
} from '../src/utils/demoCatalogSeed.js';

const localTarget = {
  nodeEnvironment: 'development',
  databaseName: 'yaqana_local_dev_20261115',
  hosts: ['127.0.0.1:27017'],
  confirmation: 'yaqana_local_dev_20261115'
};

function matches(record, filter) {
  if (filter.$or) return filter.$or.some((condition) => matches(record, condition));
  if (filter['variants.sku']?.$in) {
    return (record.variants || []).some((variant) => filter['variants.sku'].$in.includes(variant.sku));
  }
  return Object.entries(filter).every(([key, condition]) => (
    Array.isArray(condition.$in) ? condition.$in.includes(record[key]) : record[key] === condition
  ));
}

function memoryModel(records = []) {
  let writes = 0;
  return {
    records,
    get writes() { return writes; },
    exists: async (filter) => records.some((record) => {
      if (filter['variants.sku']?.$in) {
        return (record.variants || []).some((variant) => filter['variants.sku'].$in.includes(variant.sku));
      }
      return matches(record, filter);
    }) ? { _id: 'existing' } : null,
    find: (filter) => ({
      select: (projection) => ({
        lean: async () => records
          .filter((record) => matches(record, filter))
          .map((record) => Object.fromEntries(
            projection.split(' ').map((field) => [field, record[field]])
          ))
      })
    }),
    updateOne: async (filter, update, options) => {
      writes += 1;
      assert.deepEqual(Object.keys(update), ['$setOnInsert']);
      assert.equal(options.upsert, true);
      if (records.some((record) => matches(record, filter))) return { upsertedCount: 0 };
      records.push(structuredClone(update.$setOnInsert));
      return { upsertedCount: 1 };
    }
  };
}

test('demo seed accepts only the exact approved local target', () => {
  assert.doesNotThrow(() => validateDemoCatalogTarget(localTarget));
  for (const override of [
    { nodeEnvironment: 'production' },
    { databaseName: 'yaqana_staging' },
    { databaseName: 'yaqana_demo_preview' },
    { confirmation: 'test' },
    { hosts: ['stage.example:27017'] }
  ]) {
    assert.throws(() => validateDemoCatalogTarget({ ...localTarget, ...override }));
  }
});

test('demo seed is insert-only and preserves manual demo edits', async () => {
  const input = {
    target: localTarget,
    Category: memoryModel(),
    Collection: memoryModel(),
    Product: memoryModel(),
    categories: [{ name: 'T-Shirts', slug: 't-shirts', gender: 'men', active: true }],
    collections: [{ name: 'DEMO — Essential Layers', slug: 'demo-essential-layers', active: true }],
    products: [{
      name: 'DEMO Classic Cotton Tee',
      slug: 'yaqana-demo-classic-cotton-tee',
      category: 'T-Shirts',
      collectionName: 'DEMO — Essential Layers',
      demoKey: 'YAQANA-DEMO-DEMO-CLASSIC-COTTON-Tee',
      isDemoData: true
    }]
  };

  const first = await seedDemoCatalog(input);
  assert.equal(first.products.inserted, 1);

  input.Product.records[0].description = 'Manually edited demo description';
  const second = await seedDemoCatalog(input);
  assert.equal(second.products.inserted, 0);
  assert.equal(second.products.alreadyPresent, 1);
  assert.equal(input.Product.records[0].description, 'Manually edited demo description');
});

test('demo seed rejects SKU collisions and legacy product identity collisions before writes', async () => {
  const input = {
    target: localTarget,
    Category: memoryModel(),
    Collection: memoryModel(),
    Product: memoryModel([{
      name: 'Existing Product',
      slug: 'yaqana-demo-classic-cotton-tee',
      category: 'T-Shirts',
      collectionName: 'Other',
      isDemoData: false,
      variants: [{ sku: 'YQ-DEMO-TEE-BLK-M' }]
    }]),
    categories: [{ name: 'T-Shirts', slug: 't-shirts', gender: 'men', active: true }],
    collections: [{ name: 'DEMO — Essential Layers', slug: 'demo-essential-layers', active: true }],
    products: [{
      name: 'DEMO Classic Cotton Tee',
      slug: 'yaqana-demo-classic-cotton-tee',
      category: 'T-Shirts',
      collectionName: 'DEMO — Essential Layers',
      demoKey: 'YAQANA-DEMO-DEMO-CLASSIC-COTTON-Tee',
      isDemoData: true,
      variants: [{ sku: 'YQ-DEMO-TEE-BLK-M' }]
    }]
  };

  await assert.rejects(seedDemoCatalog(input), /demo identity collision|SKU collision/i);
  assert.equal(input.Category.writes, 0);
  assert.equal(input.Collection.writes, 0);
  assert.equal(input.Product.writes, 0);
});
