import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { app } from '../src/app.js';

test('direct API requests to admin, staff, and admin-auth profile routes reject anonymous callers', async (t) => {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  for (const [path, method] of [
    ['/admin/stats', 'GET'],
    ['/admin/notifications', 'GET'],
    ['/admin/notifications/read-state', 'PUT'],
    ['/admin/staff/507f1f77bcf86cd799439011/permissions', 'PATCH'],
    ['/orders', 'GET'],
    ['/orders/507f1f77bcf86cd799439011/return-refund', 'POST'],
    ['/admin-auth/mfa', 'GET'],
    ['/admin-auth/mfa/replacement/start', 'POST'],
    ['/admin-auth/mfa/replacement/verify', 'POST'],
    ['/upload', 'POST']
  ]) {
    const response = await fetch(`${base}${path}`, { method });
    assert.equal(response.status, 401, `${method} ${path} must reject anonymous access`);
    assert.equal((await response.json()).code, 'AUTHENTICATION_REQUIRED');
  }
});
