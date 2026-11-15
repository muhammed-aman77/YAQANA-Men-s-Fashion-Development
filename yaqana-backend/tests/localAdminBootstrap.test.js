import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalAdmin, validateLocalAdminTarget } from '../src/utils/localAdminBootstrap.js';

const target = {
  nodeEnvironment: 'development',
  databaseName: 'yaqana_local_dev_20261115',
  hosts: ['127.0.0.1:27017'],
  confirmation: 'yaqana_local_dev_20261115'
};

function memoryUser(existing = null) {
  const writes = [];
  return {
    writes,
    findOne: async ({ email }) => (existing?.email === email ? existing : null),
    create: async (record) => {
      writes.push(record);
      return record;
    }
  };
}

test('local admin bootstrap refuses any environment, database, host or confirmation outside the local target', () => {
  assert.doesNotThrow(() => validateLocalAdminTarget(target));
  for (const override of [
    { nodeEnvironment: 'production' },
    { databaseName: 'yaqana_staging' },
    { hosts: ['mongodb.example.invalid:27017'] },
    { confirmation: 'yaqana_staging' }
  ]) {
    assert.throws(() => validateLocalAdminTarget({ ...target, ...override }));
  }
});

test('local admin bootstrap creates only a new active administrator account', async () => {
  const User = memoryUser();
  const user = await createLocalAdmin({
    User,
    target,
    admin: { name: 'Local Admin', email: 'admin@example.test', passwordHash: 'hashed-password' }
  });

  assert.equal(user.role, 'admin');
  assert.equal(user.status, 'active');
  assert.equal(User.writes.length, 1);
});

test('local admin bootstrap never overwrites an existing account', async () => {
  const existing = { email: 'admin@example.test', role: 'customer', status: 'blocked' };
  const User = memoryUser(existing);

  await assert.rejects(createLocalAdmin({
    User,
    target,
    admin: { name: 'Local Admin', email: existing.email, passwordHash: 'new-hash' }
  }), /already exists/i);
  assert.equal(User.writes.length, 0);
  assert.equal(existing.role, 'customer');
  assert.equal(existing.status, 'blocked');
});
