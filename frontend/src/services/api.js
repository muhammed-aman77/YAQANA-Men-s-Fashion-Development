import axios from 'axios';
import { API_BASE_URL } from '../utils/apiUrl.js';
import { AUTH_MODE, CSRF_COOKIE_NAME, readCookieValue } from '../utils/authMode.js';

const API = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: AUTH_MODE === 'cookie'
});

API.interceptors.request.use((config) => {
  if (AUTH_MODE === 'cookie') {
    if (!['get', 'head', 'options'].includes(String(config.method || 'get').toLowerCase())) {
      const csrfToken = readCookieValue(document.cookie, CSRF_COOKIE_NAME);
      if (csrfToken) config.headers['X-YAQANA-CSRF-TOKEN'] = csrfToken;
    }
    return config;
  }

  const token = sessionStorage.getItem('xora_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

API.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      const currentPath = window.location.pathname;
      if (currentPath.startsWith('/account') || currentPath.startsWith('/admin')) {
        sessionStorage.removeItem('xora_token');
        sessionStorage.removeItem('xora_user');
        localStorage.removeItem('xora_token');
        localStorage.removeItem('xora_user');
      }
    }
    return Promise.reject(error);
  }
);

// Auth Services
export const authService = {
  login: (data) => API.post('/auth/login', data),
  register: (data) => API.post('/auth/register', data),
  getProfile: () => API.get('/auth/profile'),
  updateProfile: (data) => API.put('/auth/profile', data),
  changePassword: (data) => API.put('/auth/change-password', data),
  logout: (token) => API.post('/auth/logout', {}, token
    ? { headers: { Authorization: `Bearer ${token}` } }
    : undefined)
};

export const adminAuthService = {
  beginLogin: (data) => API.post('/admin-auth/login', data),
  verifyMfa: (data) => API.post('/admin-auth/verify', data),
  beginMfaReplacement: (data) => API.post('/admin-auth/mfa/replacement/start', data),
  verifyMfaReplacement: (data) => API.post('/admin-auth/mfa/replacement/verify', data),
  reauthenticate: (data) => API.post('/admin-auth/reauthenticate', data),
  getMfaStatus: () => API.get('/admin-auth/mfa'),
  rotateRecoveryCodes: (data) => API.post('/admin-auth/recovery-codes', data),
  revokeOtherSessions: () => API.post('/admin-auth/sessions/revoke-others')
};

// Product Services
export const productService = {
  getCollections: () => API.get('/products/collections'),
  createCollection: (data) => API.post('/products/collections', data),
  renameCollection: (name, nextName, description) => API.put(`/products/collections/${encodeURIComponent(name)}`, { name: nextName, description }),
  removeCollection: (name) => API.delete(`/products/collections/${encodeURIComponent(name)}`),
  getProducts: (params) => API.get('/products', { params }),
  getProductById: (id) => API.get(`/products/${id}`),
  createProduct: (data) => API.post('/products', data),
  updateProduct: (id, data) => API.put(`/products/${id}`, data),
  deleteProduct: (id) => API.delete(`/products/${id}`),
  permanentlyDeleteProduct: (id) => API.delete(`/products/${id}/permanent`)
};

// Category Services
export const categoryService = {
  getCategories: () => API.get('/categories'),
  createCategory: (data) => API.post('/categories', data),
  updateCategory: (id, data) => API.put(`/categories/${id}`, data),
  deleteCategory: (id) => API.delete(`/categories/${id}`)
};

// Order Services
export const orderService = {
  getCheckoutQuote: (data) => API.post('/orders/quote', data),
  createOrder: (data, idempotencyKey) => API.post('/orders', data, { headers: { 'Idempotency-Key': idempotencyKey } }),
  getMyOrders: () => API.get('/orders/my-orders'),
  getOrderById: (id) => API.get(`/orders/${id}`),
  getAllOrders: (params) => API.get('/orders', { params }),
  updateOrderStatus: (id, data) => API.put(`/orders/${id}`, data),
  updateCodLifecycle: (id, data) => API.patch(`/orders/${id}/cod`, data),
  updateShipment: (id, data) => API.patch(`/orders/${id}/shipment`, data)
};

// Cart Services
export const cartService = {
  getCart: () => API.get('/cart'),
  addToCart: (data) => API.post('/cart', data),
  updateQuantity: (data) => API.put('/cart/update', data),
  removeFromCart: (itemId) => API.delete(`/cart/${itemId}`),
  syncCart: (data) => API.post('/cart/sync', data)
};

// Wishlist Services
export const wishlistService = {
  getWishlist: () => API.get('/wishlist'),
  toggleWishlist: (data) => API.post('/wishlist', data)
};

// Address Services
export const addressService = {
  getAddresses: () => API.get('/addresses'),
  createAddress: (data) => API.post('/addresses', data),
  updateAddress: (id, data) => API.put(`/addresses/${id}`, data),
  deleteAddress: (id) => API.delete(`/addresses/${id}`),
  setDefaultAddress: (id) => API.put(`/addresses/${id}/default`)
};

// Admin Services
export const adminService = {
  getStats: ({ period, timeZone } = {}) => API.get('/admin/stats', { params: { period, timeZone } }),
  exportDashboardCsv: ({ period, timeZone } = {}) => API.get('/admin/stats/export.csv', {
    params: { period, timeZone },
    responseType: 'blob'
  }),
  globalSearch: (q, config = {}) => API.get('/admin/search', { ...config, params: { ...config.params, q } }),
  getNotifications: (config = {}) => API.get('/admin/notifications', config),
  updateNotificationReadState: (notificationId, isRead) => API.put('/admin/notifications/read-state', { notificationId, isRead }),
  getActivity: (config = {}) => API.get('/admin/activity', config),
  getPreferences: () => API.get('/admin/preferences'),
  saveFilters: (savedFilters) => API.put('/admin/preferences/filters', { savedFilters }),
  getCustomers: (params) => API.get('/admin/customers', { params }),
  getCustomerDetails: (id) => API.get(`/admin/customers/${id}`),
  updateCustomerStatus: (id, data) => API.put(`/admin/customers/${id}/status`, data),
  getInventory: (params) => API.get('/admin/inventory', { params }),
  restoreInventorySku: (productId, sku, reason) => API.post(
    `/admin/inventory/products/${encodeURIComponent(productId)}/skus/${encodeURIComponent(sku)}/restore`,
    { reason }
  ),
  getInventoryPolicy: () => API.get('/admin/inventory/policy'),
  getInventoryApprovals: (params) => API.get('/admin/inventory/approvals', { params }),
  approveInventoryAdjustment: (id) => API.post(`/admin/inventory/approvals/${encodeURIComponent(id)}/approve`),
  rejectInventoryAdjustment: (id, reason) => API.post(`/admin/inventory/approvals/${encodeURIComponent(id)}/reject`, { reason }),
  getInventoryInbound: (params) => API.get('/admin/inventory/inbound', { params }),
  createInventoryInbound: (data, idempotencyKey) => API.post('/admin/inventory/inbound', data, { headers: { 'Idempotency-Key': idempotencyKey } }),
  receiveInventoryInbound: (id, data, idempotencyKey) => API.post(
    `/admin/inventory/inbound/${encodeURIComponent(id)}/receive`,
    data,
    { headers: { 'Idempotency-Key': idempotencyKey } }
  ),
  getInventoryMovements: (params) => API.get('/admin/inventory/movements', { params }),
  exportInventoryCsv: (params) => API.get('/admin/inventory/export.csv', { params, responseType: 'blob' }),
  setInventoryReorderTarget: (sku, reorderTarget) => API.patch(
    `/admin/inventory/${encodeURIComponent(sku)}/reorder-target`,
    { reorderTarget }
  ),
  getLegacyAllocationPreview: (productId) => API.get(`/admin/inventory/products/${encodeURIComponent(productId)}/legacy-allocation`),
  previewLegacyAllocation: (productId, allocations) => API.post(
    `/admin/inventory/products/${encodeURIComponent(productId)}/legacy-allocation/preview`,
    { allocations }
  ),
  updateVerifiedUnitCost: (sku, data) => API.patch(
    `/admin/inventory/${encodeURIComponent(sku)}/unit-cost`,
    data
  ),
  previewInventoryStocktake: (productId, data) => API.post(
    `/admin/inventory/products/${encodeURIComponent(productId)}/stocktake/preview`,
    data
  ),
  previewInventoryCsvImport: (csvText) => API.post('/admin/inventory/csv/preview', { csvText }),
  adjustInventory: (data, idempotencyKey) => API.post('/admin/inventory/adjustments', data, { headers: { 'Idempotency-Key': idempotencyKey } })
};

export const supportService = {
  getTickets: (params) => API.get('/support/tickets', { params }),
  getTicket: (id) => API.get(`/support/tickets/${id}`),
  createTicket: (data) => API.post('/support/tickets', data),
  updateTicket: (id, data) => API.patch(`/support/tickets/${id}`, data),
  addReply: (id, message) => API.post(`/support/tickets/${id}/replies`, { message }),
  getAssignees: () => API.get('/support/assignees')
};

// Upload Service
export const uploadService = {
  uploadImage: (formData) => API.post('/upload', formData),
  deleteImage: (imageUrl) => API.delete('/upload', { data: { imageUrl } })
};

export default API;
