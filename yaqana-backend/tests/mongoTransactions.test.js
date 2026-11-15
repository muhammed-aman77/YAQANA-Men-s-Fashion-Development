import test from 'node:test';
import assert from 'node:assert/strict';
import { requireTransactionTopology } from '../src/utils/mongoTransactions.js';

test('transaction capability is limited to replica-set and sharded MongoDB topologies', async () => {
  const { supportsMongoTransactions } = await import('../src/utils/mongoTransactions.js').catch(() => ({}));
  assert.equal(supportsMongoTransactions?.({ client: { topology: { description: { type: 'Single' } } } }), false);
  assert.equal(supportsMongoTransactions?.({ client: { topology: { description: { type: 'ReplicaSetWithPrimary' } } } }), true);
  assert.equal(supportsMongoTransactions?.({ client: { topology: { description: { type: 'Sharded' } } } }), true);
});

test('a configured production database refuses to start without transaction support', () => {
  const standalone = { client: { topology: { description: { type: 'Single' } } } };
  const replicaSet = { client: { topology: { description: { type: 'ReplicaSetWithPrimary' } } } };

  assert.throws(() => requireTransactionTopology(standalone, true), /replica set or sharded/i);
  assert.doesNotThrow(() => requireTransactionTopology(replicaSet, true));
  assert.doesNotThrow(() => requireTransactionTopology(standalone, false));
});
