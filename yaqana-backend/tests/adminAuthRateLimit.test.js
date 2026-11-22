import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import User from '../src/models/User.js';

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/yaqana_test';
process.env.JWT_SECRET ||= 'test-only-secret-that-is-at-least-thirty-two-characters-long';
const { default: adminAuthRoutes } = await import('../src/routes/adminAuthRoutes.js');

test('administrator authentication rate limit allows 12 requests and blocks the 13th per client window', async (t) => {
  t.mock.method(User, 'findOne', () => ({ select: async () => null }));
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use('/admin-auth', adminAuthRoutes);
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ code: error.code }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const url = `http://127.0.0.1:${server.address().port}/admin-auth/login`;
  const statuses = [];
  for (let i = 0; i < 13; i += 1) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.101' },
      body: JSON.stringify({ email: `attempt-${i}@example.test`, password: 'not-a-valid-password' })
    });
    statuses.push(response.status);
  }
  assert.deepEqual(statuses.slice(0, 12), Array(12).fill(401));
  assert.equal(statuses[12], 429);
});

test('failed public auth attempts do not throttle unrelated authenticated MFA routes', async (t) => {
  t.mock.method(User, 'findOne', () => ({ select: async () => null }));
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use('/admin-auth', adminAuthRoutes);
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ code: error.code }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const base = `http://127.0.0.1:${server.address().port}/admin-auth`;

  for (let i = 0; i < 12; i += 1) {
    await fetch(`${base}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.102' },
      body: JSON.stringify({ email: `blocked-${i}@example.test`, password: 'invalid-password' })
    });
  }

  const statuses = [];
  for (let i = 0; i < 13; i += 1) {
    const response = await fetch(`${base}/mfa/replacement/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.102' },
      body: JSON.stringify({ password: 'not-authenticated' })
    });
    statuses.push(response.status);
  }
  assert.deepEqual(statuses, [...Array(12).fill(401), 429]);
});
