import test from 'node:test';
import assert from 'node:assert/strict';

const loadPolicy = async () => {
  const module = await import('../src/utils/inventoryApprovalPolicy.js').catch(() => null);
  assert.ok(module, 'inventoryApprovalPolicy.js should be implemented');
  return module;
};

test('inventory approval policy distinguishes normal, confirmed, admin, and owner quantities', async () => {
  const { getInventoryApprovalRequirement } = await loadPolicy();
  const policy = {
    normalAdjustmentLimit: 10,
    enhancedConfirmationLimit: 25,
    adminApprovalLimit: 50
  };

  assert.equal(getInventoryApprovalRequirement(10, policy), 'apply');
  assert.equal(getInventoryApprovalRequirement(-10, policy), 'apply');
  assert.equal(getInventoryApprovalRequirement(11, policy), 'enhanced_confirmation');
  assert.equal(getInventoryApprovalRequirement(-25, policy), 'enhanced_confirmation');
  assert.equal(getInventoryApprovalRequirement(26, policy), 'admin_approval');
  assert.equal(getInventoryApprovalRequirement(-50, policy), 'admin_approval');
  assert.equal(getInventoryApprovalRequirement(51, policy), 'owner_approval');
});

test('inventory approval policy rejects invalid quantities and unordered thresholds', async () => {
  const { getInventoryApprovalRequirement } = await loadPolicy();

  assert.throws(() => getInventoryApprovalRequirement(0), /non-zero whole number/);
  assert.throws(() => getInventoryApprovalRequirement(1.5), /non-zero whole number/);
  assert.throws(() => getInventoryApprovalRequirement(11, {
    normalAdjustmentLimit: 25,
    enhancedConfirmationLimit: 10,
    adminApprovalLimit: 50
  }), /thresholds/);
});

test('medium adjustments require explicit confirmation before they may apply', async () => {
  const { getInventoryAdjustmentOutcome } = await loadPolicy();
  assert.equal(typeof getInventoryAdjustmentOutcome, 'function');
  assert.equal(getInventoryAdjustmentOutcome(11, undefined, false), 'confirmation_required');
  assert.equal(getInventoryAdjustmentOutcome(-25, undefined, true), 'apply');
  assert.equal(getInventoryAdjustmentOutcome(26), 'admin_approval');
  assert.equal(getInventoryAdjustmentOutcome(51), 'owner_approval');
});

test('only another Admin can decide an Admin approval and Admin cannot decide Owner approval', async () => {
  const { canReviewInventoryApproval } = await loadPolicy();
  assert.equal(typeof canReviewInventoryApproval, 'function');
  const requester = '507f1f77bcf86cd799439011';

  assert.equal(canReviewInventoryApproval({
    status: 'pending', approvalLevel: 'admin', requestedBy: requester
  }, { _id: '507f1f77bcf86cd799439012', role: 'admin' }), true);
  assert.equal(canReviewInventoryApproval({
    status: 'pending', approvalLevel: 'admin', requestedBy: requester
  }, { _id: requester, role: 'admin' }), false);
  assert.equal(canReviewInventoryApproval({
    status: 'pending', approvalLevel: 'owner', requestedBy: requester
  }, { _id: '507f1f77bcf86cd799439012', role: 'admin' }), false);
  assert.equal(canReviewInventoryApproval({
    status: 'applied', approvalLevel: 'admin', requestedBy: requester
  }, { _id: '507f1f77bcf86cd799439012', role: 'admin' }), false);
});
