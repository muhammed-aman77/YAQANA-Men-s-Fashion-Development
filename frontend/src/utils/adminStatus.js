export const CUSTOMER_STATUS_OPTIONS = ['active', 'blocked'];
export const LOW_STOCK_THRESHOLD = 10;
const FIXED_CATEGORY_SLUGS = new Set(['t-shirts', 'hoodies', 'shirts', 'trousers']);

export const getInventoryStatus = (stock) => {
  if (stock <= 0) return 'Out of Stock';
  if (stock <= LOW_STOCK_THRESHOLD) return 'Low Stock';
  return 'In Stock';
};

export const getProductStatusUpdate = (action) => {
  if (action === 'archive') return { active: false };
  if (action === 'activate') return { active: true };
  if (action === 'draft') return { status: 'draft' };
  if (action === 'discontinue') return { status: 'discontinued' };
  throw new Error(`Unknown product status action: ${action}`);
};

export const canRenameCategory = (slug) => !FIXED_CATEGORY_SLUGS.has(slug);

export const getMetricDisplayValue = (value, status) => status === 'loaded' ? value : '—';

export const formatShippingAddress = (address) => {
  if (!address) return '';
  return [
    address.fullName,
    address.addressLine1,
    address.addressLine2,
    address.city,
    address.state,
    address.postalCode,
    address.country,
    address.phone
  ].filter(Boolean).join(' · ');
};

export const getAdminOrderStatusOptions = (order) => {
  const statuses = [order?.orderStatus, ...(Array.isArray(order?.allowedNextStatuses) ? order.allowedNextStatuses : [])];
  return [...new Set(statuses.filter((status) => typeof status === 'string' && status))];
};
