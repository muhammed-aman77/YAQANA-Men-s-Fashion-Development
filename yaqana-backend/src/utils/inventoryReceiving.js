const MAX_QUANTITY = 100000;
const isSafeNonNegativeInteger = (value) => Number.isSafeInteger(value) && value >= 0;

export function getInboundRemaining(receipt) {
  const expected = receipt?.expectedQuantity;
  const accounted = [
    receipt?.receivedQuantity ?? 0,
    receipt?.damagedQuantity ?? 0,
    receipt?.rejectedQuantity ?? 0,
    receipt?.cancelledQuantity ?? 0
  ];
  if (!Number.isSafeInteger(expected) || expected < 1 ||
    accounted.some((quantity) => !isSafeNonNegativeInteger(quantity))) {
    throw new Error('Inbound receipt quantities are invalid.');
  }
  return Math.max(0, expected - accounted.reduce((total, quantity) => total + quantity, 0));
}

export function normalizeInboundDraft(input = {}) {
  const productId = typeof input.productId === 'string' ? input.productId.trim() : '';
  if (!/^[a-f\d]{24}$/i.test(productId)) throw new Error('A valid product ID is required.');

  if (input.sku !== undefined && input.sku !== null && typeof input.sku !== 'string') {
    throw new Error('Inbound SKU must be text.');
  }
  const sku = typeof input.sku === 'string' ? input.sku.trim().toUpperCase() : '';
  if (sku && !/^[A-Z0-9][A-Z0-9._-]{1,47}$/.test(sku)) throw new Error('Inbound SKU is invalid.');
  const expectedQuantity = input.expectedQuantity;
  if (!Number.isSafeInteger(expectedQuantity) || expectedQuantity < 1 || expectedQuantity > MAX_QUANTITY) {
    throw new Error(`Expected quantity must be a whole number between 1 and ${MAX_QUANTITY}.`);
  }

  let expectedDate = null;
  if (input.expectedDate !== undefined && input.expectedDate !== null && input.expectedDate !== '') {
    expectedDate = new Date(input.expectedDate);
    if (!Number.isFinite(expectedDate.getTime())) throw new Error('Expected delivery date is invalid.');
  }
  const reference = typeof input.reference === 'string' ? input.reference.trim() : '';
  if (input.reference !== undefined && typeof input.reference !== 'string') throw new Error('Receipt reference must be text.');
  if (reference.length > 120) throw new Error('Receipt reference exceeds 120 characters.');

  const unitCostPaise = input.unitCostPaise === undefined || input.unitCostPaise === null
    ? null
    : input.unitCostPaise;
  if (unitCostPaise !== null && !isSafeNonNegativeInteger(unitCostPaise)) {
    throw new Error('Purchase cost must be a non-negative whole number of paise.');
  }

  return {
    productId,
    sku: sku || undefined,
    expectedDate,
    expectedQuantity,
    reference,
    unitCostPaise
  };
}

export function normalizeInboundReceipt(input = {}, remaining) {
  if (!isSafeNonNegativeInteger(remaining)) throw new Error('Remaining receipt quantity is invalid.');
  const quantities = {
    receivedQuantity: input.receivedQuantity ?? 0,
    damagedQuantity: input.damagedQuantity ?? 0,
    rejectedQuantity: input.rejectedQuantity ?? 0,
    cancelledQuantity: input.cancelledQuantity ?? 0
  };
  if (Object.values(quantities).some((quantity) =>
    !Number.isSafeInteger(quantity) || quantity < 0 || quantity > MAX_QUANTITY
  )) {
    throw new Error('Receipt quantities must be non-negative whole numbers.');
  }
  const accountedQuantity = Object.values(quantities).reduce((total, quantity) => total + quantity, 0);
  if (accountedQuantity === 0) throw new Error('Receive, damage, reject, or cancel at least one unit.');
  if (accountedQuantity > remaining) throw new Error('Receipt quantities exceed the remaining expected quantity.');

  const unitCostPaise = input.unitCostPaise === undefined || input.unitCostPaise === null
    ? null
    : input.unitCostPaise;
  if (unitCostPaise !== null && !isSafeNonNegativeInteger(unitCostPaise)) {
    throw new Error('Purchase cost must be a non-negative whole number of paise.');
  }
  const cancellationReason = typeof input.cancellationReason === 'string'
    ? input.cancellationReason.trim()
    : '';
  if (quantities.cancelledQuantity > 0 && cancellationReason.length < 5) {
    throw new Error('Provide a cancellation reason of at least 5 characters.');
  }
  if (cancellationReason.length > 300) throw new Error('Cancellation reason exceeds 300 characters.');
  return { ...quantities, unitCostPaise, cancellationReason };
}

export function calculateWeightedAverageCost(current, acceptedQuantity, receiptUnitCostPaise) {
  const onHand = current?.onHand;
  const costedQuantity = current?.costedQuantity;
  const currentUnitCost = current?.unitCostPaise ?? null;
  if (!isSafeNonNegativeInteger(onHand) || !isSafeNonNegativeInteger(costedQuantity) ||
    costedQuantity > onHand || !Number.isSafeInteger(acceptedQuantity) || acceptedQuantity < 0) {
    throw new Error('Existing inventory cost coverage is invalid.');
  }
  if (currentUnitCost !== null && !isSafeNonNegativeInteger(currentUnitCost)) {
    throw new Error('Existing unit cost is invalid.');
  }
  if (receiptUnitCostPaise !== null && receiptUnitCostPaise !== undefined &&
    !isSafeNonNegativeInteger(receiptUnitCostPaise)) {
    throw new Error('Receipt unit cost is invalid.');
  }
  if (acceptedQuantity === 0 || receiptUnitCostPaise == null || costedQuantity !== onHand) {
    return { unitCostPaise: currentUnitCost, costedQuantity };
  }
  if (costedQuantity > 0 && currentUnitCost === null) {
    throw new Error('Existing costed inventory is missing its verified unit cost.');
  }
  const currentValue = (currentUnitCost ?? 0) * costedQuantity;
  const receiptValue = receiptUnitCostPaise * acceptedQuantity;
  const combinedQuantity = costedQuantity + acceptedQuantity;
  const combinedValue = currentValue + receiptValue;
  if (!Number.isSafeInteger(currentValue) || !Number.isSafeInteger(receiptValue) ||
    !Number.isSafeInteger(combinedValue) || !Number.isSafeInteger(combinedQuantity)) {
    throw new Error('Weighted-average inventory cost exceeds the safe numeric range.');
  }
  return {
    unitCostPaise: Math.round(combinedValue / combinedQuantity),
    costedQuantity: combinedQuantity
  };
}
