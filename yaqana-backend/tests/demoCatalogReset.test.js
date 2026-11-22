import test from 'node:test';
import assert from 'node:assert/strict';
import { resetDemoCatalog, validateDemoCatalogResetTarget } from '../src/utils/demoCatalogReset.js';

const target = {
  nodeEnvironment: 'development',
  databaseName: 'yaqana_local_dev_20261115',
  hosts: ['127.0.0.1:27017'],
  confirmation: 'yaqana_local_dev_20261115',
  resetConfirmation: 'RESET-DEMO-CATALOGUE'
};

test('demo reset accepts only exact local target and explicit reset confirmation', () => {
  assert.doesNotThrow(() => validateDemoCatalogResetTarget(target));
  for (const override of [
    { nodeEnvironment: 'production' },
    { databaseName: 'yaqana_staging' },
    { hosts: ['127.0.0.1:27018'] },
    { confirmation: 'test' },
    { resetConfirmation: 'reset' }
  ]) {
    assert.throws(() => validateDemoCatalogResetTarget({ ...target, ...override }));
  }
});

test('demo reset dry-run makes no writes and reports only demo records', async () => {
  const productIds = ['demo-a', 'demo-b'];
  const writes = { deleted: 0 };
  const Product = {
    find: () => ({
      select: () => ({
        lean: async () => productIds.map((_id) => ({ _id, isDemoData: true }))
      })
    }),
    deleteMany: async () => { writes.deleted += 1; }
  };
  const result = await resetDemoCatalog({ target, apply: false, Product, Cart: null, Wishlist: null, Order: null, StockMovement: null, InventoryInbound: null });
  assert.equal(result.apply, false);
  assert.equal(result.productCount, 2);
  assert.equal(writes.deleted, 0);
});

test('demo reset refuses apply if a demo product has references, including pending inventory approvals', async () => {
  const Product = {
    find: () => ({ select: () => ({ lean: async () => [{ _id: 'demo-a', isDemoData: true }] }) })
  };
  const referenced = {
    exists: async () => ({ _id: 'reference' })
  };
  await assert.rejects(resetDemoCatalog({
    target,
    apply: true,
    Product,
    Cart: referenced,
    Wishlist: referenced,
    Order: referenced,
    StockMovement: referenced,
    InventoryInbound: referenced,
    InventoryApproval: referenced
  }), /referenced|reset refused/i);
});

test('demo reset checks inventory approvals before deleting a demo product', async () => {
  let deleted = false;
  const Product = {
    find: () => ({ select: () => ({ lean: async () => [{ _id: 'demo-a', isDemoData: true }] }) }),
    deleteMany: async () => { deleted = true; return { deletedCount: 1 }; }
  };
  const none = { exists: async () => null };
  const approvals = { exists: async () => ({ _id: 'approval-a' }) };
  await assert.rejects(resetDemoCatalog({
    target, apply: true, Product, Cart: none, Wishlist: none, Order: none,
    StockMovement: none, InventoryInbound: none, InventoryApproval: approvals
  }), /referenced|reset refused/i);
  assert.equal(deleted, false);
});
