import test from 'node:test';
import assert from 'node:assert/strict';
import { seedLocalDummyCatalog, validateLocalDummyCatalogTarget } from '../src/utils/localDummyCatalogSeed.js';

const target = {
  nodeEnvironment: 'development',
  databaseName: 'yaqana_local_dev_20261115',
  hosts: ['127.0.0.1:27017'],
  confirmation: 'yaqana_local_dev_20261115'
};

function matches(record, filter) {
  if (filter.$or) return filter.$or.some((condition) => matches(record, condition));
  return Object.entries(filter).every(([key, condition]) => (
    Array.isArray(condition.$in) ? condition.$in.includes(record[key]) : record[key] === condition
  ));
}

function memoryModel(records = []) {
  let writes = 0;
  return {
    records,
    get writes() { return writes; },
    find: (filter) => ({
      select: (projection) => ({
        lean: async () => {
          const fields = projection.split(' ');
          return records.filter((record) => matches(record, filter))
            .map((record) => Object.fromEntries(fields.map((field) => [field, record[field]])));
        }
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

const seedInput = () => ({
  target,
  Category: memoryModel(),
  Collection: memoryModel(),
  Product: memoryModel(),
  categories: [{ name: 'Jeans', slug: 'jeans' }],
  collections: [{ name: 'Local samples', slug: 'local-samples' }],
  products: [{ name: 'Sample Jean', slug: 'dev-dummy-sample-jean', category: 'Jeans', collectionName: 'Local samples' }]
});

test('local catalogue target accepts only the confirmed development database and exact loopback host', () => {
  assert.doesNotThrow(() => validateLocalDummyCatalogTarget(target));
  for (const override of [
    { nodeEnvironment: 'production' },
    { databaseName: 'test' },
    { databaseName: 'yaqana_dev' },
    { confirmation: 'test' },
    { hosts: ['stage.example:27017'] },
    { hosts: ['127.0.0.1:27018'] },
    { hosts: ['127.0.0.1:27017', 'localhost:27017'] }
  ]) {
    assert.throws(() => validateLocalDummyCatalogTarget({ ...target, ...override }));
  }
});

test('local catalogue seeding inserts missing records and never overwrites existing records', async () => {
  const input = seedInput();
  const first = await seedLocalDummyCatalog(input);
  assert.deepEqual(first, {
    categories: { inserted: 1, alreadyPresent: 0 },
    collections: { inserted: 1, alreadyPresent: 0 },
    products: { inserted: 1, alreadyPresent: 0 }
  });

  input.Product.records[0].description = 'Existing local edit';
  const second = await seedLocalDummyCatalog(input);
  assert.deepEqual(second, {
    categories: { inserted: 0, alreadyPresent: 1 },
    collections: { inserted: 0, alreadyPresent: 1 },
    products: { inserted: 0, alreadyPresent: 1 }
  });
  assert.equal(input.Product.records[0].description, 'Existing local edit');
  assert.equal(input.Product.records.length, 1);
});

test('local seed rejects identity collisions before writing any collection', async () => {
  const input = seedInput();
  input.Product.records.push({
    name: 'Unrelated product',
    slug: 'dev-dummy-sample-jean',
    category: 'Jeans',
    collectionName: 'Other collection'
  });

  await assert.rejects(seedLocalDummyCatalog(input), /identity collision/i);
  assert.equal(input.Category.writes, 0);
  assert.equal(input.Collection.writes, 0);
  assert.equal(input.Product.writes, 0);
});

test('local seed does not duplicate a product name that already has a different slug', async () => {
  const input = seedInput();
  input.Product.records.push({
    name: 'Sample Jean',
    slug: 'existing-sample-jean',
    category: 'Jeans',
    collectionName: 'Local samples'
  });

  await assert.rejects(seedLocalDummyCatalog(input), /product identity collision/i);
  assert.equal(input.Product.writes, 0);
  assert.equal(input.Product.records.length, 1);
});
