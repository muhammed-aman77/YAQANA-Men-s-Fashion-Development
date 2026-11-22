import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { login, register } from '../src/controllers/authController.js';
import User from '../src/models/User.js';
import Session from '../src/models/Session.js';
import { hashPassword } from '../src/utils/password.js';

async function start(handler) {
  const app = express();
  app.use(express.json());
  app.post('/auth', handler);
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ code: error.code }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, url: `http://127.0.0.1:${server.address().port}/auth` };
}

test('public login rejects administrator accounts before creating a session', async (t) => {
  const user = { _id: 'admin-1', email: 'admin@example.test', role: 'admin', status: 'active', passwordHash: await hashPassword('valid-password') };
  t.mock.method(User, 'findOne', () => ({ select: async () => user }));
  t.mock.method(Session, 'create', async () => { throw new Error('A session must not be created.'); });
  const { server, url } = await start(login);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: user.email, password: 'valid-password' }) });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, 'ADMIN_SIGN_IN_REQUIRED');
});

test('public registration ignores submitted role and always creates a customer', async (t) => {
  t.mock.method(User, 'exists', async () => false);
  t.mock.method(User, 'create', async (record) => {
    assert.equal(record.role, 'customer');
    assert.equal(Object.hasOwn(record, 'customPermissions'), false);
    return { ...record, _id: 'customer-1' };
  });
  t.mock.method(Session, 'create', async () => ({}));
  const { server, url } = await start(register);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test Customer', email: 'customer@example.test', password: 'valid-password', role: 'owner', customPermissions: ['ownership.transfer'] })
  });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).user.role, 'customer');
});
