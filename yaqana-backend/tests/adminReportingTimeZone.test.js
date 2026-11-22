import assert from 'node:assert/strict';
import test from 'node:test';
import { updateProfile } from '../src/controllers/authController.js';
import User from '../src/models/User.js';
import { setAdminReportingTimeZone } from '../src/utils/adminPreferences.js';
import { toPublicUser } from '../src/utils/publicUser.js';

const publicUserFields = {
  _id: 'user-id',
  id: 'user-id',
  name: 'YAQANA User',
  email: 'user@example.test',
  phone: '12345',
  status: 'active',
  createdAt: new Date('2026-01-02T03:04:05.000Z')
};

function invokeUpdateProfile(user, body) {
  return new Promise((resolve) => {
    updateProfile(
      { body, user },
      { json: (payload) => resolve({ status: 200, payload }) },
      (error) => resolve({ status: error.statusCode, error })
    );
  });
}

test('admin public profiles include the saved or default reporting time zone', () => {
  assert.equal(toPublicUser({ ...publicUserFields, role: 'admin' }).reportingTimeZone, 'Asia/Kolkata');
  assert.equal(toPublicUser({
    ...publicUserFields,
    role: 'admin',
    adminPreferences: { reportingTimeZone: 'Europe/London' }
  }).reportingTimeZone, 'Europe/London');
});

test('customer public profiles do not expose admin reporting preferences', () => {
  const customer = toPublicUser({
    ...publicUserFields,
    role: 'customer',
    adminPreferences: { reportingTimeZone: 'Europe/London' }
  });
  assert.deepEqual(customer, {
    ...publicUserFields,
    phone: '12345',
    role: 'customer'
  });
});

test('admins can save only supported reporting time zones', () => {
  const admin = { role: 'admin' };
  assert.equal(setAdminReportingTimeZone(admin, 'Europe/London'), admin);
  assert.deepEqual(admin.adminPreferences, { reportingTimeZone: 'Europe/London' });
});

test('profile API persists and returns a supported zone for admins', async () => {
  let saveCalls = 0;
  const admin = {
    ...publicUserFields,
    role: 'admin',
    save: async () => { saveCalls += 1; }
  };
  const response = await invokeUpdateProfile(admin, { reportingTimeZone: 'Europe/London' });

  assert.equal(response.status, 200);
  assert.equal(saveCalls, 1);
  assert.equal(admin.adminPreferences.reportingTimeZone, 'Europe/London');
  assert.equal(response.payload.user.reportingTimeZone, 'Europe/London');
});

test('profile API rejects zone changes for customers without saving', async () => {
  let saveCalls = 0;
  const customer = {
    ...publicUserFields,
    role: 'customer',
    save: async () => { saveCalls += 1; }
  };
  const response = await invokeUpdateProfile(customer, { reportingTimeZone: 'Europe/London' });

  assert.equal(response.status, 403);
  assert.equal(saveCalls, 0);
  assert.equal(Object.hasOwn(customer, 'adminPreferences'), false);
});

test('invalid reporting time zones are rejected without changing the user', async () => {
  const admin = {
    ...publicUserFields,
    role: 'admin',
    adminPreferences: { reportingTimeZone: 'Asia/Kolkata' },
    save: async () => assert.fail('invalid preferences must not be saved')
  };
  const response = await invokeUpdateProfile(admin, { reportingTimeZone: 'America/New_York' });

  assert.equal(response.status, 400);
  assert.equal(admin.adminPreferences.reportingTimeZone, 'Asia/Kolkata');
  assert.equal(response.error.message, 'Unsupported reporting time zone.');
});

test('user schema prevents customers from storing administrator preferences', () => {
  const customer = new User({
    name: 'YAQANA Customer',
    email: 'customer@example.test',
    passwordHash: 'not-used-by-validation',
    role: 'customer',
    adminPreferences: { reportingTimeZone: 'Europe/London' }
  });
  assert.match(customer.validateSync().errors.adminPreferences.message, /only available for admin users/);
});
