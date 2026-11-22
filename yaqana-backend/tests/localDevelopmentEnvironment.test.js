import test from 'node:test';
import assert from 'node:assert/strict';
import {
  configureLocalDevelopmentMongoose,
  createLocalDevelopmentEnvironment,
  createLocalDemoScriptEnvironment,
  LOCAL_DEVELOPMENT_MONGODB_URI
} from '../src/config/localDevelopmentEnvironment.js';

test('local development startup overrides a remote MongoDB target without mutating the parent environment', () => {
  const configuredEnvironment = {
    NODE_ENV: 'production',
    MONGODB_URI: 'mongodb+srv://example.invalid/production',
    JWT_SECRET: 'preserve-this-local-secret-1234567890'
  };

  const localEnvironment = createLocalDevelopmentEnvironment(configuredEnvironment);

  assert.equal(localEnvironment.NODE_ENV, 'development');
  assert.equal(localEnvironment.HOST, '127.0.0.1');
  assert.equal(localEnvironment.MONGODB_URI, 'mongodb://127.0.0.1:27017/yaqana_local_dev_20261115');
  assert.equal(
    localEnvironment.FRONTEND_ORIGINS,
    'http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173'
  );
  assert.equal(localEnvironment.JWT_SECRET, 'preserve-this-local-secret-1234567890');
  assert.equal(configuredEnvironment.MONGODB_URI, 'mongodb+srv://example.invalid/production');
});

test('local preview disables automatic collection and index creation', () => {
  const settings = [];
  configureLocalDevelopmentMongoose({ set: (name, value) => settings.push([name, value]) });
  assert.deepEqual(settings, [['autoIndex', false], ['autoCreate', false]]);
});

test('local development generates a process-only JWT secret when one is missing', () => {
  const configuredEnvironment = {
    NODE_ENV: 'production',
    MONGODB_URI: 'mongodb+srv://example.invalid/production'
  };

  const localEnvironment = createLocalDevelopmentEnvironment(configuredEnvironment);

  assert.equal(typeof localEnvironment.JWT_SECRET, 'string');
  assert.ok(localEnvironment.JWT_SECRET.length >= 32);
  assert.equal(configuredEnvironment.JWT_SECRET, undefined);
});

test('local demo scripts use the pinned development database and a fresh process-only JWT secret', () => {
  const configuredEnvironment = {
    NODE_ENV: 'production',
    MONGODB_URI: 'mongodb+srv://example.invalid/production'
  };

  const first = createLocalDemoScriptEnvironment(configuredEnvironment);
  const second = createLocalDemoScriptEnvironment(configuredEnvironment);

  assert.equal(first.NODE_ENV, 'development');
  assert.equal(first.MONGODB_URI, LOCAL_DEVELOPMENT_MONGODB_URI);
  assert.ok(first.JWT_SECRET.length >= 32);
  assert.notEqual(first.JWT_SECRET, second.JWT_SECRET);
  assert.equal(configuredEnvironment.MONGODB_URI, 'mongodb+srv://example.invalid/production');
  assert.equal(configuredEnvironment.JWT_SECRET, undefined);
});
