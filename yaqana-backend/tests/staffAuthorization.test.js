import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CUSTOM_PERMISSIONS,
  ASSIGNABLE_CUSTOM_PERMISSIONS,
  roleHasPermission,
  userHasPermission,
  validateOwnerBootstrap,
  validateOwnerTransfer
} from '../src/utils/staffAuthorization.js';

test('customer, support agent, admin, and owner receive only their approved permission boundaries', () => {
  assert.equal(roleHasPermission('customer', 'inventory.read'), false);
  assert.equal(roleHasPermission('support_agent', 'support.manage_assigned'), true);
  assert.equal(roleHasPermission('support_agent', 'inventory.read'), false);
  assert.equal(roleHasPermission('admin', 'inventory.read'), true);
  assert.equal(roleHasPermission('owner', 'ownership.transfer'), true);
  assert.equal(ASSIGNABLE_CUSTOM_PERMISSIONS.includes('ownership.transfer'), false);
  assert.equal(userHasPermission({ role: 'admin', status: 'active', customPermissions: ['ownership.transfer'] }, 'ownership.transfer'), false);
  assert.equal(userHasPermission({ role: 'owner', status: 'active', customPermissions: [] }, 'ownership.transfer'), true);
  assert.deepEqual(CUSTOM_PERMISSIONS, [
    'inventory.read',
    'inventory.adjust',
    'orders.read',
    'orders.fulfil',
    'cod.manage',
    'returns.manage',
    'customers.manage',
    'support.manage_assigned',
    'staff.support.manage',
    'staff.permissions.manage',
    'ownership.transfer'
  ]);
});

test('Owner bootstrap refuses if an owner exists and requires an eligible existing account', () => {
  assert.throws(() => validateOwnerBootstrap({
    ownerCount: 1,
    target: { _id: '507f1f77bcf86cd799439011', role: 'admin', status: 'active' }
  }), /active Owner/i);
  assert.throws(() => validateOwnerBootstrap({
    ownerCount: 0,
    target: { _id: null, role: 'admin', status: 'active' }
  }), /eligible account/i);
  assert.doesNotThrow(() => validateOwnerBootstrap({
    ownerCount: 0,
    target: { _id: '507f1f77bcf86cd799439011', role: 'admin', status: 'active' }
  }));
});

test('Owner transfer protects the last owner and requires the current owner and different target', () => {
  assert.throws(() => validateOwnerTransfer({
    currentOwnerId: '507f1f77bcf86cd799439011',
    targetId: '507f1f77bcf86cd799439011',
    activeOwnerCount: 1,
    target: { role: 'admin', status: 'active' }
  }), /different/i);
  assert.throws(() => validateOwnerTransfer({
    currentOwnerId: '507f1f77bcf86cd799439011',
    targetId: '507f1f77bcf86cd799439012',
    activeOwnerCount: 1,
    target: { role: 'customer', status: 'active' }
  }), /admin or support agent/i);
  assert.doesNotThrow(() => validateOwnerTransfer({
    currentOwnerId: '507f1f77bcf86cd799439011',
    targetId: '507f1f77bcf86cd799439012',
    activeOwnerCount: 1,
    target: { role: 'admin', status: 'active' }
  }));
});
