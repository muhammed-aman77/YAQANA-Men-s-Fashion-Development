const DEFAULT_THRESHOLDS = {
  normalAdjustmentLimit: 10,
  enhancedConfirmationLimit: 25,
  adminApprovalLimit: 50
};

export function getInventoryApprovalRequirement(quantityDelta, policy = {}) {
  if (!Number.isSafeInteger(quantityDelta) || quantityDelta === 0) {
    throw new Error('Inventory adjustment quantity must be a non-zero whole number.');
  }

  const thresholds = {
    normalAdjustmentLimit: policy.normalAdjustmentLimit ?? DEFAULT_THRESHOLDS.normalAdjustmentLimit,
    enhancedConfirmationLimit: policy.enhancedConfirmationLimit ?? DEFAULT_THRESHOLDS.enhancedConfirmationLimit,
    adminApprovalLimit: policy.adminApprovalLimit ?? DEFAULT_THRESHOLDS.adminApprovalLimit
  };
  const values = Object.values(thresholds);
  if (values.some((value) => !Number.isSafeInteger(value) || value < 1) ||
    !(thresholds.normalAdjustmentLimit < thresholds.enhancedConfirmationLimit &&
      thresholds.enhancedConfirmationLimit < thresholds.adminApprovalLimit)) {
    throw new Error('Inventory approval thresholds must be positive, whole numbers in increasing order.');
  }

  const quantity = Math.abs(quantityDelta);
  if (quantity <= thresholds.normalAdjustmentLimit) return 'apply';
  if (quantity <= thresholds.enhancedConfirmationLimit) return 'enhanced_confirmation';
  if (quantity <= thresholds.adminApprovalLimit) return 'admin_approval';
  return 'owner_approval';
}

export function getInventoryAdjustmentOutcome(quantityDelta, policy = {}, enhancedConfirmed = false) {
  const requirement = getInventoryApprovalRequirement(quantityDelta, policy);
  if (requirement === 'enhanced_confirmation') {
    return enhancedConfirmed === true ? 'apply' : 'confirmation_required';
  }
  return requirement;
}

export function canReviewInventoryApproval(approval, reviewer) {
  if (approval?.status !== 'pending' || approval?.approvalLevel !== 'admin' || reviewer?.role !== 'admin') {
    return false;
  }
  return String(approval.requestedBy) !== String(reviewer._id);
}
