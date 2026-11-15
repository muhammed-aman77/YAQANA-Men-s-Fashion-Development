import test from 'node:test';
import assert from 'node:assert/strict';
import { provisionExistingAdmin, validateStagingTarget } from '../src/utils/stagingAdminProvisioning.js';
import { hashPassword } from '../src/utils/password.js';

const target = {
  protocol: 'mongodb+srv:',
  host: 'yaqana-staging.example.mongodb.net',
  expectedHost: 'yaqana-staging.example.mongodb.net',
  databaseName: 'yaqana_staging',
  confirmation: 'yaqana_staging'
};

test('staging provisioning accepts only the confirmed Atlas staging host and database', () => {
  assert.doesNotThrow(() => validateStagingTarget(target));
  for (const override of [
    { protocol: 'mongodb:' },
    { host: 'production.example.mongodb.net' },
    { expectedHost: 'production.example.mongodb.net' },
    { host: 'yaqana-staging.example.invalid', expectedHost: 'yaqana-staging.example.invalid' },
    { databaseName: 'production' },
    { confirmation: 'production' }
  ]) {
    assert.throws(() => validateStagingTarget({ ...target, ...override }));
  }
});

test('staging provisioning preserves existing admin credentials and never creates a session', async () => {
  const password = 'Existing-admin-password-never-rotated';
  const passwordHash = await hashPassword(password);
  const created = [];
  const sourceAdmin = {
    _id: 'local-account-id',
    name: 'Existing YAQANA Admin',
    email: 'admin@example.test',
    phone: '+911234567890',
    passwordHash,
    role: 'admin',
    status: 'active',
    emailVerifiedAt: null
  };
  const LocalUser = {
    findOne: () => ({ select: async () => sourceAdmin })
  };
  const StagingUser = {
    findOne: async () => null,
    create: async (account) => {
      created.push(account);
      return account;
    }
  };
  const StagingSession = { create: async () => assert.fail('Existing local sessions must not be copied.') };

  const result = await provisionExistingAdmin({
    LocalUser,
    StagingUser,
    StagingSession,
    email: sourceAdmin.email,
    password,
    target,
    hashPassword: async () => assert.fail('Provisioning must copy, not replace, the password hash.')
  });

  assert.equal(result.email, sourceAdmin.email);
  assert.equal(created.length, 1);
  assert.equal(created[0].passwordHash, passwordHash);
  assert.equal(created[0].role, 'admin');
  assert.equal(created[0].status, 'active');
  assert.equal(Object.hasOwn(created[0], '_id'), false);
  assert.equal(Object.hasOwn(created[0], 'sessions'), false);
});

test('staging provisioning rejects wrong passwords and never writes an account', async () => {
  const passwordHash = await hashPassword('Correct-existing-password');
  let writes = 0;
  const LocalUser = {
    findOne: () => ({ select: async () => ({
      email: 'admin@example.test',
      name: 'Existing Admin',
      passwordHash,
      role: 'admin',
      status: 'active'
    }) })
  };
  const StagingUser = {
    findOne: async () => null,
    create: async () => { writes += 1; }
  };

  await assert.rejects(provisionExistingAdmin({
    LocalUser,
    StagingUser,
    email: 'admin@example.test',
    password: 'not-the-existing-password',
    target
  }), /existing password is incorrect/i);
  assert.equal(writes, 0);
});

test('staging provisioning refuses an existing staging email without modifying it', async () => {
  const existing = { email: 'admin@example.test', role: 'customer', status: 'blocked' };
  const LocalUser = { findOne: () => ({ select: async () => assert.fail('The staging collision is detected before source password verification.') }) };
  const StagingUser = { findOne: async () => existing, create: async () => assert.fail('Existing staging account must not be changed.') };

  await assert.rejects(provisionExistingAdmin({
    LocalUser,
    StagingUser,
    email: existing.email,
    password: 'not-used',
    target
  }), /already exists/i);
  assert.equal(existing.role, 'customer');
  assert.equal(existing.status, 'blocked');
});

test('staging provisioning rejects blocked or non-admin source accounts', async () => {
  const passwordHash = await hashPassword('Correct-existing-password');
  for (const source of [
    { email: 'admin@example.test', name: 'User', passwordHash, role: 'customer', status: 'active' },
    { email: 'admin@example.test', name: 'Blocked Admin', passwordHash, role: 'admin', status: 'blocked' }
  ]) {
    await assert.rejects(provisionExistingAdmin({
      LocalUser: { findOne: () => ({ select: async () => source }) },
      StagingUser: { findOne: async () => null, create: async () => assert.fail('Invalid source account must not be copied.') },
      email: source.email,
      password: 'Correct-existing-password',
      target
    }), /active administrator/i);
  }
});
