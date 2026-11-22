import test from 'node:test';
import assert from 'node:assert/strict';
import { getAdminPreferences, saveAdminFilters } from '../src/controllers/adminController.js';

function response() {
  return {
    body: null,
    json(body) { this.body = body; return this; }
  };
}

test('admin saved filters are sanitized and persisted to that administrator account', async () => {
  let saveCount = 0;
  const user = {
    role: 'admin',
    adminPreferences: { savedFilters: [] },
    async save() { saveCount += 1; }
  };
  const res = response();
  await saveAdminFilters({ user, body: { savedFilters: [{ id: 'orders-1', label: 'COD orders', section: 'orders', filters: { paymentType: 'cod', email: 'private@example.test' } }] } }, res, (error) => { throw error; });
  assert.equal(saveCount, 1);
  assert.deepEqual(res.body.preferences.savedFilters[0].filters, { paymentType: 'cod' });
  const read = response();
  await getAdminPreferences({ user }, read, (error) => { throw error; });
  assert.deepEqual(read.body.preferences.savedFilters, res.body.preferences.savedFilters);
});
