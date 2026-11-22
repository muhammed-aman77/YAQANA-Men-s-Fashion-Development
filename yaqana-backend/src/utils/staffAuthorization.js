export const USER_ROLES = Object.freeze(['customer', 'support_agent', 'admin', 'owner']);

export const CUSTOM_PERMISSIONS = Object.freeze([
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

export const ASSIGNABLE_CUSTOM_PERMISSIONS = Object.freeze(CUSTOM_PERMISSIONS.filter((permission) => permission !== 'ownership.transfer'));

const ROLE_PERMISSIONS = Object.freeze({
  customer: Object.freeze([]),
  support_agent: Object.freeze(['support.manage_assigned']),
  admin: Object.freeze([
    'inventory.read',
    'inventory.adjust',
    'orders.read',
    'orders.fulfil',
    'cod.manage',
    'returns.manage',
    'customers.manage',
    'staff.support.manage',
    'staff.permissions.manage'
  ]),
  owner: Object.freeze([...CUSTOM_PERMISSIONS])
});

export function roleHasPermission(role, permission) {
  return ROLE_PERMISSIONS[role]?.includes(permission) === true;
}

export function userHasPermission(user, permission) {
  if (!user || user.status !== 'active') return false;
  // Legacy customPermissions values are not an authorization source. Only approved
  // role rules may grant access; route middleware remains the enforcement boundary.
  return roleHasPermission(user.role, permission);
}

export function validateOwnerBootstrap({ ownerCount, target }) {
  if (Number(ownerCount) !== 0) throw new Error('An active Owner already exists.');
  if (!target?.id && !target?._id) throw new Error('Owner bootstrap requires an eligible account.');
  if (target.status !== 'active' || !['admin', 'support_agent'].includes(target.role)) {
    throw new Error('Owner bootstrap requires an eligible account.');
  }
  return true;
}

export function validateOwnerTransfer({ currentOwnerId, targetId, activeOwnerCount, target }) {
  if (!currentOwnerId) throw new Error('The current Owner is required.');
  if (!targetId) throw new Error('A target account is required.');
  if (String(currentOwnerId) === String(targetId)) throw new Error('The target must be different from the current Owner.');
  if (Number(activeOwnerCount) !== 1) throw new Error('Exactly one active Owner is required before transfer.');
  if (!target || target.status !== 'active' || !['admin', 'support_agent'].includes(target.role)) {
    throw new Error('Ownership transfer requires an active admin or support agent target.');
  }
  return true;
}
