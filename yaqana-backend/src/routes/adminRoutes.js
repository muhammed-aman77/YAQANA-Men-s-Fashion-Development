import { Router } from 'express';
import {
 getDashboardStats,
 exportDashboardReportCsv,
 getCustomers,
 getCustomerDetails,
 updateCustomerStatus,
 getStaff,
 updateStaffPermissions,
 updateSupportAgentRole,
 getAdminAudit,
 getAdminGlobalSearch,
 getAdminNotifications,
 updateAdminNotificationReadState,
 getAdminActivity,
 getAdminPreferences,
 saveAdminFilters
} from '../controllers/adminController.js';
import {
  adjustInventory,
  approveInventoryAdjustment,
  createInventoryInbound,
  exportInventoryCsv,
  getInventoryApprovals,
  getInventory,
  getInventoryInbound,
  getInventoryMovements,
  getInventoryPolicy,
  rejectInventoryAdjustment,
  receiveInventoryInboundController,
  setInventoryReorderTarget,
  getLegacyAllocationPreview,
  previewInventoryAllocation,
  updateVerifiedUnitCost,
  previewInventoryStocktake,
  previewInventoryCsvImport,
  restoreInventorySku
} from '../controllers/inventoryController.js';
import { requireAuth, requireAdmin, requireRecentAdminReauthentication } from '../middleware/auth.js';
const router = Router();
router.use(requireAuth, requireAdmin);
router.get('/stats', getDashboardStats);
router.get('/stats/export.csv', exportDashboardReportCsv);
router.get('/customers', getCustomers);
router.get('/customers/:id', getCustomerDetails);
router.put('/customers/:id/status', updateCustomerStatus);
router.get('/staff', getStaff);
router.patch('/staff/:id/permissions', requireRecentAdminReauthentication, updateStaffPermissions);
router.patch('/staff/:id/support-agent', requireRecentAdminReauthentication, updateSupportAgentRole);
router.get('/audit', getAdminAudit);
router.get('/search', getAdminGlobalSearch);
router.get('/notifications', getAdminNotifications);
router.put('/notifications/read-state', updateAdminNotificationReadState);
router.get('/activity', getAdminActivity);
router.get('/preferences', getAdminPreferences);
router.put('/preferences/filters', saveAdminFilters);
router.get('/inventory', getInventory);
router.post('/inventory/products/:productId/skus/:sku/restore', restoreInventorySku);
router.get('/inventory/policy', getInventoryPolicy);
router.get('/inventory/approvals', getInventoryApprovals);
router.get('/inventory/inbound', getInventoryInbound);
router.post('/inventory/inbound', createInventoryInbound);
router.post('/inventory/inbound/:id/receive', receiveInventoryInboundController);
router.get('/inventory/export.csv', exportInventoryCsv);
router.get('/inventory/movements', getInventoryMovements);
router.patch('/inventory/:sku/reorder-target', setInventoryReorderTarget);
router.get('/inventory/products/:productId/legacy-allocation', getLegacyAllocationPreview);
router.post('/inventory/products/:productId/legacy-allocation/preview', previewInventoryAllocation);
router.patch('/inventory/:sku/unit-cost', updateVerifiedUnitCost);
router.post('/inventory/products/:productId/stocktake/preview', previewInventoryStocktake);
router.post('/inventory/csv/preview', previewInventoryCsvImport);
router.post('/inventory/adjustments', adjustInventory);
router.post('/inventory/approvals/:id/approve', approveInventoryAdjustment);
router.post('/inventory/approvals/:id/reject', rejectInventoryAdjustment);
export default router;
