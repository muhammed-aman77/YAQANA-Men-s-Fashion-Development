export const COD_STATES = Object.freeze(['Pending', 'Confirmed', 'Collected', 'Failed', 'Cancelled']);

const COD_TRANSITIONS = Object.freeze({
  Pending: ['Confirmed', 'Cancelled', 'Failed'],
  Confirmed: ['Collected', 'Cancelled', 'Failed'],
  Collected: [],
  Failed: [],
  Cancelled: []
});

export function canTransitionCod(current, next) {
  return COD_TRANSITIONS[current]?.includes(next) === true;
}

export function normalizeShipment({ carrier = '', trackingNumber = '', shippedAt } = {}) {
  const safeCarrier = String(carrier).trim().slice(0, 100);
  const safeTracking = String(trackingNumber).trim().slice(0, 100);
  if (!safeCarrier) throw new Error('Shipment carrier is required.');
  if (!safeTracking) throw new Error('Shipment tracking number is required.');
  const date = shippedAt ? new Date(shippedAt) : new Date();
  if (Number.isNaN(date.getTime())) throw new Error('Shipment date is invalid.');
  return { carrier: safeCarrier, trackingNumber: safeTracking, shippedAt: date };
}

export function validateRefundRequest({ amountPaise, evidence = '', reason = '' } = {}) {
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) throw new Error('Refund amount must be a positive integer.');
  const safeEvidence = String(evidence).trim();
  if (safeEvidence.length < 5 || safeEvidence.length > 500) throw new Error('Verified refund evidence is required.');
  return {
    amountPaise,
    evidence: safeEvidence,
    reason: String(reason).trim().slice(0, 300)
  };
}
