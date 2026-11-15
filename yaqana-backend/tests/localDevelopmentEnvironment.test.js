import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalDevelopmentEnvironment, LOCAL_DEVELOPMENT_MONGODB_URI } from '../src/config/localDevelopmentEnvironment.js';

test('local development startup overrides a remote MongoDB target without mutating the parent environment', () => {
  const configuredEnvironment = {
    NODE_ENV: 'production',
    MONGODB_URI: 'mongodb+srv://example.invalid/production',
    JWT_SECRET: 'preserve-this-local-secret'
  };

  const localEnvironment = createLocalDevelopmentEnvironment(configuredEnvironment);

  assert.equal(localEnvironment.NODE_ENV, 'development');
  assert.equal(localEnvironment.MONGODB_URI, 'mongodb://127.0.0.1:27017/yaqana_local_dev_20261115');
  assert.equal(localEnvironment.JWT_SECRET, 'preserve-this-local-secret');
  assert.equal(configuredEnvironment.MONGODB_URI, 'mongodb+srv://example.invalid/production');
});
