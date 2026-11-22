import test from 'node:test';
import assert from 'node:assert/strict';

let restoreInventorySku;
try {
  ({ restoreInventorySku } = await import('../src/services/inventorySkuLifecycleService.js'));
} catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
}

function createRestoreHarness(status = 'inactive') {
  const session = {
    async withTransaction(callback) { await callback(); },
    async endSession() {}
  };
  const variant = {
    sku: 'YQ-DEMO-TEE-GRN-M',
    size: 'M',
    colour: 'Green',
    status,
    stock: 5,
    reservedQuantity: 2,
    unitCostPaise: 12500,
    costedQuantity: 3
  };
  const product = {
    _id: 'demo-product',
    name: 'DEMO Essential Tee',
    variants: [variant],
    async save(options) { this.savedWithSession = options.session; }
  };
  const state = {
    product,
    variant,
    session,
    sessionStarts: 0,
    productReads: 0,
    audits: []
  };
  const dependencies = {
    productId: 'demo-product',
    sku: variant.sku,
    actorId: 'admin-user',
    reason: 'Restore verified demo SKU',
    connection: { client: { topology: { description: { type: 'ReplicaSetWithPrimary' } } } },
    startSession: async () => { state.sessionStarts += 1; return session; },
    ProductModel: {
      findById: () => ({
        session: async (transactionSession) => {
          state.productReads += 1;
          assert.equal(transactionSession, session);
          return product;
        }
      })
    },
    AdminAuditModel: {
      async create(records, options) {
        state.audits.push({ records, options });
      }
    }
  };
  return { dependencies, state };
}

test('restores inactive SKUs without changing inventory and records the audit in the same transaction', async () => {
  assert.equal(typeof restoreInventorySku, 'function', 'SKU lifecycle restore service is implemented');
  if (!restoreInventorySku) return;

  const { dependencies, state } = createRestoreHarness();
  const result = await restoreInventorySku(dependencies);

  assert.equal(result.variantStatus, 'active');
  assert.equal(state.variant.status, 'active');
  assert.deepEqual(
    [state.variant.stock, state.variant.reservedQuantity, state.variant.unitCostPaise, state.variant.costedQuantity],
    [5, 2, 12500, 3]
  );
  assert.equal(state.product.savedWithSession, state.session);
  assert.equal(state.audits.length, 1);
  assert.equal(state.audits[0].options.session, state.session);
  assert.equal(state.audits[0].records[0].action, 'inventory.sku.restore');
  assert.deepEqual(state.audits[0].records[0].before, { status: 'inactive' });
  assert.deepEqual(state.audits[0].records[0].after, { status: 'active' });
});

test('restores discontinued SKUs while preserving their stock level', async () => {
  if (!restoreInventorySku) assert.equal(typeof restoreInventorySku, 'function');
  if (!restoreInventorySku) return;

  const { dependencies, state } = createRestoreHarness('discontinued');
  await restoreInventorySku(dependencies);

  assert.equal(state.variant.status, 'active');
  assert.equal(state.variant.stock, 5);
  assert.equal(state.audits[0].records[0].before.status, 'discontinued');
});

test('refuses restoration without transaction support before opening a session or reading the product', async () => {
  if (!restoreInventorySku) assert.equal(typeof restoreInventorySku, 'function');
  if (!restoreInventorySku) return;

  const { dependencies, state } = createRestoreHarness();
  dependencies.connection.client.topology.description.type = 'Single';

  await assert.rejects(restoreInventorySku(dependencies), (error) =>
    error.statusCode === 503 && error.code === 'TRANSACTIONS_REQUIRED'
  );
  assert.equal(state.sessionStarts, 0);
  assert.equal(state.productReads, 0);
  assert.equal(state.audits.length, 0);
  assert.equal(state.variant.status, 'inactive');
});

test('does not create an audit entry when an active SKU is restored again', async () => {
  if (!restoreInventorySku) assert.equal(typeof restoreInventorySku, 'function');
  if (!restoreInventorySku) return;

  const { dependencies, state } = createRestoreHarness('active');

  await assert.rejects(restoreInventorySku(dependencies), (error) =>
    error.statusCode === 409 && error.code === 'SKU_ALREADY_ACTIVE'
  );
  assert.equal(state.product.savedWithSession, undefined);
  assert.equal(state.audits.length, 0);
});
