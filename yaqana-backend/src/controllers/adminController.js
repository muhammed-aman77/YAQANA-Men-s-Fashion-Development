import mongoose from 'mongoose';
import Product from '../models/Product.js';
import Order from '../models/Order.js';
import User from '../models/User.js';
import Address from '../models/Address.js';
import InventoryApproval from '../models/InventoryApproval.js';
import InventoryPolicy from '../models/InventoryPolicy.js';
import { asyncHandler, httpError } from '../utils/http.js';
import { paiseToCatalogUnits } from '../utils/money.js';
import { assembleDashboardReport, assembleLegacyMonthlyChart, buildDashboardCustomerPipeline, buildDashboardReportPipeline, buildLegacyMonthlyChartPipeline, parseDashboardReportQuery } from '../utils/dashboardReportPipeline.js';
import { getDashboardReportingWindows } from '../utils/dashboardReporting.js';
import AdminAudit from '../models/AdminAudit.js';
import ProductDeletionAudit from '../models/ProductDeletionAudit.js';
import StockMovement from '../models/StockMovement.js';
import { sanitizeSavedAdminFilters } from '../utils/savedAdminFilters.js';
import { buildDashboardReportCsv } from '../utils/dashboardReportCsv.js';
import { supportsMongoTransactions } from '../utils/mongoTransactions.js';
import { buildDashboardLowStockSummary } from '../utils/inventoryReadModel.js';
import {
  buildGlobalCustomerFilter,
  buildGlobalOrderFilter,
  buildGlobalProductFilter,
  buildGlobalSearchRegex,
  normalizeGlobalSearchTerm
} from '../utils/adminGlobalSearch.js';

export const getDashboardStats = asyncHandler(async (req, res) => {
  const { period, timeZone } = parseDashboardReportQuery(req.query);
  const windows = getDashboardReportingWindows(period, timeZone);
  const legacyTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [totalProducts, totalOrders, totalCustomers, pendingOrders, inventoryProducts, inventoryPolicy, deliveredOrders, recentOrders, revenueRows, categoryDistribution, orderRows, customerRows, legacyChartRows] = await Promise.all([
    Product.countDocuments({ active: { $ne: false } }), Order.countDocuments(), User.countDocuments({ role: 'customer' }),
    Order.countDocuments({ orderStatus: { $in: ['Pending', 'Confirmed', 'Processing'] } }),
    Product.find({ active: { $ne: false } }).select('name active stock variants'),
    InventoryPolicy.findOne({ scope: 'global' }).lean(),
    Order.countDocuments({ orderStatus: 'Delivered' }),
    Order.find().sort({ createdAt: -1 }).limit(5).populate('customer', 'name email'),
    Order.aggregate([
      { $match: { paymentStatus: 'Paid' } },
      { $group: { _id: null, totalRevenuePaise: { $sum: '$totalPaise' } } }
    ]),
    Product.aggregate([{ $match: { active: { $ne: false } } }, { $group: { _id: '$category', count: { $sum: 1 } } }]),
    Order.aggregate(buildDashboardReportPipeline(windows, timeZone)),
    User.aggregate(buildDashboardCustomerPipeline(windows)),
    Order.aggregate(buildLegacyMonthlyChartPipeline(windows.asOf, legacyTimeZone))
  ]);
  const { count: lowStockProducts } = buildDashboardLowStockSummary(inventoryProducts, inventoryPolicy || undefined);
  const report = assembleDashboardReport({ orderRows, customerRows, windows, period, timeZone });
  const totalRevenuePaise = revenueRows[0]?.totalRevenuePaise || 0;
  res.json({
    success: true,
    stats: { totalProducts, totalOrders, totalCustomers, totalRevenue: paiseToCatalogUnits(totalRevenuePaise), pendingOrders, lowStockProducts, deliveredOrders },
    chartData: assembleLegacyMonthlyChart(legacyChartRows, windows.asOf, legacyTimeZone),
    categoryDistribution: categoryDistribution.map((x) => ({ name: x._id, count: x.count })),
    recentOrders,
    report
  });
});

export const exportDashboardReportCsv = asyncHandler(async (req, res) => {
  const { period, timeZone } = parseDashboardReportQuery(req.query);
  const windows = getDashboardReportingWindows(period, timeZone);
  const [orderRows, customerRows] = await Promise.all([
    Order.aggregate(buildDashboardReportPipeline(windows, timeZone)),
    User.aggregate(buildDashboardCustomerPipeline(windows))
  ]);
  const report = assembleDashboardReport({ orderRows, customerRows, windows, period, timeZone });
  const date = new Date().toISOString().slice(0, 10);
  res.status(200)
    .type('text/csv; charset=utf-8')
    .set('Content-Disposition', `attachment; filename="yaqana-dashboard-${period}-${date}.csv"`)
    .send(buildDashboardReportCsv(report));
});
export const getCustomers = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query?.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query?.limit, 10) || 50));
  const search = String(req.query?.search || '').trim().slice(0, 100);
  const status = String(req.query?.status || 'all');
  const filter = { role: 'customer' };
  if (['active', 'blocked'].includes(status)) filter.status = status;
  if (search) {
    const term = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: term }, { email: term }, { phone: term }];
  }
  const [users, totalCustomers] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).select('name email phone status createdAt'),
    User.countDocuments(filter)
  ]);
  const ids = users.map((user) => user._id);
  const totals = await Order.aggregate([
    { $match: { customer: { $in: ids } } },
    { $group: { _id: '$customer', orderCount: { $sum: 1 }, totalSpentPaise: { $sum: { $cond: [{ $eq: ['$paymentStatus', 'Paid'] }, '$totalPaise', 0] } } } }
  ]);
  const byUser = new Map(totals.map((row) => [String(row._id), row]));
  res.json({
    success: true,
    customers: users.map((user) => { const row = byUser.get(String(user._id)); return { _id: user._id, name: user.name, email: user.email, phone: user.phone, status: user.status, createdAt: user.createdAt, orderCount: row?.orderCount || 0, totalSpent: paiseToCatalogUnits(row?.totalSpentPaise || 0) }; }),
    totalCustomers,
    currentPage: page,
    totalPages: Math.ceil(totalCustomers / limit)
  });
});
export const getCustomerDetails = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw httpError(404, 'Customer not found.');
  const customer = await User.findOne({ _id: req.params.id, role: 'customer' })
    .select('name email phone status createdAt')
    .lean();
  if (!customer) throw httpError(404, 'Customer not found.');
  const [addresses, orders, totals] = await Promise.all([
    Address.find({ user: customer._id }).sort({ isDefault: -1, createdAt: -1 }).lean(),
    Order.find({ customer: customer._id })
      .sort({ createdAt: -1 })
      .limit(10)
      .select('orderStatus paymentStatus paymentMethod createdAt totalPaise items shippingAddress')
      .lean(),
    Order.aggregate([
      { $match: { customer: customer._id } },
      { $group: {
        _id: null,
        orderCount: { $sum: 1 },
        totalSpentPaise: { $sum: { $cond: [{ $eq: ['$paymentStatus', 'Paid'] }, '$totalPaise', 0] } }
      } }
    ])
  ]);
  const summary = totals[0] || { orderCount: 0, totalSpentPaise: 0 };
  res.json({
    success: true,
    customer: {
      ...customer,
      orderCount: summary.orderCount,
      totalSpent: paiseToCatalogUnits(summary.totalSpentPaise),
      addresses,
      orders: orders.map((order) => ({ ...order, total: paiseToCatalogUnits(order.totalPaise || 0) }))
    }
  });
});
export const updateCustomerStatus = asyncHandler(async (req, res) => {
  if (!['active', 'blocked'].includes(req.body?.status)) throw httpError(400, 'Customer status must be active or blocked.');
  if (!mongoose.isValidObjectId(req.params.id)) throw httpError(404, 'Customer not found.');
  const user = await User.findOne({ _id: req.params.id, role: 'customer' });
  if (!user) throw httpError(404, 'Customer not found.');
  const previousStatus = user.status;
  await AdminAudit.create({
    actor: req.user._id,
    action: 'customer.status.update.started',
    reason: 'Administrator started a customer status change.',
    before: { status: previousStatus },
    after: { status: req.body.status },
    metadata: { targetId: String(user._id), phase: 'intent' }
  });
  user.status = req.body.status;
  await user.save();
  let revokedSessions = 0;
  if (user.status === 'blocked') {
    const result = await (await import('../models/Session.js')).default.updateMany({ user: user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
    revokedSessions = result.modifiedCount || 0;
  }
  await AdminAudit.create({
    actor: req.user._id,
    action: 'customer.status.update',
    reason: 'Administrator changed a customer account status.',
    before: { status: previousStatus },
    after: { status: user.status },
    metadata: { targetId: String(user._id), revokedSessions, phase: 'completed' }
  });
  res.json({ success: true, message: `Customer account status updated to ${user.status}.`, user: { id: user._id, name: user.name, email: user.email, status: user.status } });
});

export const getStaff = asyncHandler(async (req, res) => {
  const users = await User.find({ role: { $in: ['support_agent', 'admin', 'owner'] } })
    .sort({ createdAt: -1 })
    .select('name email role status createdAt');
  const staff = users.map(({ _id, name, email, role, status, createdAt }) => ({
    _id, name, email, role, status, createdAt
  }));
  res.json({ success: true, staff });
});

export const updateStaffPermissions = asyncHandler(async () => {
  throw httpError(501, 'Custom staff permissions are not enabled. Access is controlled by the account role.', 'CUSTOM_PERMISSIONS_DEFERRED');
});

export const updateSupportAgentRole = asyncHandler(async (req, res) => {
  if (!supportsMongoTransactions()) {
    throw httpError(503, 'Support Agent role changes require MongoDB transaction support.', 'TRANSACTIONS_REQUIRED');
  }
  if (!['admin', 'owner'].includes(req.user.role)) throw httpError(403, 'Support Agent changes require administrator access.');
  if (!mongoose.isValidObjectId(req.params.id)) throw httpError(404, 'Staff account not found.');
  const enabled = req.body?.enabled === true;
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 5 || reason.length > 500) throw httpError(400, 'Provide an audit reason between 5 and 500 characters.');
  const session = await mongoose.startSession();
  let user;
  try {
    await session.withTransaction(async () => {
      user = await User.findById(req.params.id).session(session);
      if (!user || user.role === 'owner') throw httpError(404, 'Eligible staff account not found.');
        const previousRole = user.role;
      if (enabled) {
        if (!['customer', 'admin'].includes(user.role)) throw httpError(409, 'The account already has a supported role.');
        if (user.role === 'admin') throw httpError(409, 'Admins cannot be converted to Support Agent through this role action.');
        user.role = 'support_agent';
      } else {
        if (user.role !== 'support_agent') throw httpError(409, 'The account is not a Support Agent.');
        user.role = 'customer';
      }
      await user.save({ session });
      await AdminAudit.create([{
        actor: req.user._id,
        action: enabled ? 'staff.support_agent.grant' : 'staff.support_agent.revoke',
        target: user._id,
        reason,
        before: { role: previousRole },
        after: { role: user.role }
      }], { session });
    });
  } finally {
    await session.endSession();
  }
  res.json({ success: true, message: enabled ? 'Support Agent role granted.' : 'Support Agent role revoked.', staff: user });
});

export const getAdminAudit = asyncHandler(async (_req, res) => {
  const audits = await AdminAudit.find()
    .sort({ createdAt: -1 })
    .limit(200)
    .populate('actor', 'name email role')
    .populate('target', 'name email role')
    .lean();
  res.json({ success: true, audits });
});

export const getAdminGlobalSearch = asyncHandler(async (req, res) => {
  const term = normalizeGlobalSearchTerm(req.query?.q);
  const regex = buildGlobalSearchRegex(term);
  const [customers, products] = await Promise.all([
    User.find(buildGlobalCustomerFilter(regex)).sort({ createdAt: -1 }).limit(5).select('_id name').lean(),
    Product.find(buildGlobalProductFilter(regex)).sort({ updatedAt: -1 }).limit(5).select('_id name category status isDemoData').lean()
  ]);
  const orderFilter = buildGlobalOrderFilter(term, customers.map(({ _id }) => _id));
  const orders = orderFilter
    ? await Order.find(orderFilter).sort({ createdAt: -1 }).limit(5).select('_id customer orderStatus createdAt').populate('customer', 'name').lean()
    : [];
  res.json({
    success: true,
    term,
    results: [
      ...products.map((product) => ({
        id: String(product._id),
        type: 'product',
        label: product.name,
        detail: [product.category, product.isDemoData ? 'Demo catalogue' : null].filter(Boolean).join(' · '),
        section: 'products',
        searchTerm: product.name,
        demo: product.isDemoData === true
      })),
      ...orders.map((order) => ({
        id: String(order._id),
        type: 'order',
        label: `Order ${String(order._id).slice(-8).toUpperCase()}`,
        detail: [order.customer?.name, order.orderStatus].filter(Boolean).join(' · '),
        section: 'orders',
        searchTerm: String(order._id)
      })),
      ...customers.map((customer) => ({
        id: String(customer._id),
        type: 'customer',
        label: customer.name,
        detail: 'Customer',
        section: 'customers',
        searchTerm: customer.name
      }))
    ]
  });
});

export const getAdminNotifications = asyncHandler(async (_req, res) => {
  const filter = { orderStatus: { $in: ['Pending', 'Confirmed', 'Processing'] } };
  const adminApprovalFilter = { status: 'pending', approvalLevel: 'admin', requestedBy: { $ne: _req.user?._id } };
  const [orders, orderCount, approvals, approvalCount, inventoryProducts, policy] = await Promise.all([
    Order.find(filter).sort({ createdAt: 1 }).limit(20).select('_id customer orderStatus createdAt').populate('customer', 'name').lean(),
    Order.countDocuments(filter),
    InventoryApproval.find(adminApprovalFilter).sort({ createdAt: 1 }).limit(20).select('_id sku productName quantityDelta reason createdAt requestedBy').populate('requestedBy', 'name').lean(),
    InventoryApproval.countDocuments(adminApprovalFilter),
    Product.find({ isDemoData: { $ne: true }, active: { $ne: false } })
      .select('name active stock variants updatedAt').lean(),
    InventoryPolicy.findOne({ scope: 'global' }).lean()
  ]);
  const lowStockSummary = buildDashboardLowStockSummary(inventoryProducts, policy || undefined);
  const lowStockProducts = lowStockSummary.products.slice(0, 20);
  const lowStockCount = lowStockSummary.count;
  const notifications = [
    ...orders.map((order) => ({
      id: `pending-order-${String(order._id)}`,
      type: 'pending_order',
      title: `Order ${String(order._id).slice(-8).toUpperCase()} needs attention`,
      detail: [order.customer?.name, order.orderStatus].filter(Boolean).join(' · '),
      createdAt: order.createdAt,
      section: 'orders',
      searchTerm: String(order._id)
    })),
    ...approvals.map((approval) => ({
      id: `inventory-approval-${String(approval._id)}`,
      type: 'inventory_approval',
      title: `Inventory adjustment for ${approval.productName || approval.sku || 'SKU'} needs review`,
      detail: [approval.sku, `${approval.quantityDelta > 0 ? '+' : ''}${approval.quantityDelta} units`, approval.requestedBy?.name ? `Requested by ${approval.requestedBy.name}` : null].filter(Boolean).join(' · '),
      createdAt: approval.createdAt,
      section: 'inventory',
      searchTerm: approval.sku || approval.productName || ''
    })),
    ...lowStockProducts.map((product) => ({
      id: `low-stock-${String(product._id)}`,
      type: 'low_stock',
      title: `${product.name} is low on stock`,
      detail: product.variants.map(({ sku, availableStock }) => `${sku || 'Legacy SKU'}: ${availableStock} available`).join(' · '),
      createdAt: product.updatedAt,
      section: 'inventory',
      searchTerm: product.name
    }))
  ].sort((first, second) => new Date(second.createdAt || 0) - new Date(first.createdAt || 0)).slice(0, 30);
  const readIds = new Set((_req.user.adminPreferences?.notificationStates || []).filter((state) => state.readAt).map((state) => state.notificationId));
  for (const notification of notifications) notification.isRead = readIds.has(notification.id);
  res.json({
    success: true,
    source: 'live_orders_and_inventory',
    totalCount: orderCount + approvalCount + lowStockCount,
    unreadCount: notifications.filter((notification) => !notification.isRead).length,
    notifications
  });
});

export const updateAdminNotificationReadState = asyncHandler(async (req, res) => {
  const notificationId = String(req.body?.notificationId || '').trim();
  const isRead = req.body?.isRead;
  if (!/^(pending-order|inventory-approval|low-stock)-[A-Za-z0-9_-]{1,120}$/.test(notificationId) || typeof isRead !== 'boolean') {
    throw httpError(400, 'A valid notification and read state are required.');
  }
  const user = req.user;
  if (!user.adminPreferences) user.adminPreferences = {};
  const states = Array.isArray(user.adminPreferences.notificationStates) ? [...user.adminPreferences.notificationStates] : [];
  const existingIndex = states.findIndex((state) => state.notificationId === notificationId);
  if (isRead) {
    const state = { notificationId, readAt: new Date() };
    if (existingIndex >= 0) states[existingIndex] = state;
    else states.push(state);
  } else if (existingIndex >= 0) states.splice(existingIndex, 1);
  user.adminPreferences.notificationStates = states.slice(-200);
  await user.save();
  res.json({ success: true, notificationId, isRead, updatedAt: isRead ? user.adminPreferences.notificationStates.find((state) => state.notificationId === notificationId)?.readAt : null });
});

export const getAdminActivity = asyncHandler(async (_req, res) => {
  const [auditRows, movementRows, deletionRows, orderRows] = await Promise.all([
    AdminAudit.find().sort({ createdAt: -1 }).limit(25).populate('actor', 'name role').lean(),
    StockMovement.find({ status: { $ne: 'pending' } }).sort({ createdAt: -1 }).limit(25).populate('performedBy', 'name role').lean(),
    ProductDeletionAudit.find().sort({ deletedAt: -1 }).limit(25).populate('performedBy', 'name role').lean(),
    Order.aggregate([
      { $match: { statusHistory: { $exists: true, $ne: [] } } },
      { $unwind: '$statusHistory' },
      { $sort: { 'statusHistory.at': -1 } },
      { $limit: 25 },
      { $lookup: { from: 'users', localField: 'statusHistory.changedBy', foreignField: '_id', as: 'actor' } },
      { $unwind: { path: '$actor', preserveNullAndEmptyArrays: true } },
      { $project: { _id: 1, orderId: '$_id', status: '$statusHistory.status', changedAt: '$statusHistory.at', actorName: '$actor.name' } }
    ])
  ]);
  const events = [
    ...auditRows.map((row) => ({
      id: `audit-${row._id}`,
      type: 'admin_audit',
      title: String(row.action || 'Administrative action').replace(/[._]/gu, ' '),
      detail: row.actor?.name ? `By ${row.actor.name}` : 'Administrator action',
      createdAt: row.createdAt,
      section: row.action?.startsWith('inventory.') ? 'inventory'
        : row.action?.startsWith('staff.') ? 'settings'
          : row.action?.startsWith('catalog.') ? (row.action.includes('category') || row.action.includes('collection') ? 'catalogue' : 'products')
            : row.action?.startsWith('order.') ? 'orders'
              : row.action?.startsWith('customer.') ? 'customers'
                : row.action?.startsWith('support.') ? 'support' : null,
      searchTerm: row.metadata?.sku || row.metadata?.productName || row.metadata?.targetId || ''
    })),
    ...movementRows.map((row) => {
      const first = row.changes?.[0];
      const label = first?.sku ? `${first.productName} · ${first.sku}` : first?.productName || 'Inventory';
      return {
        id: `movement-${row._id}`,
        type: 'inventory_movement',
        title: `Inventory ${String(row.type || 'movement').replace(/_/gu, ' ')}`,
        detail: [label, row.changes?.length > 1 ? `${row.changes.length} items` : null, row.performedBy?.name ? `By ${row.performedBy.name}` : null].filter(Boolean).join(' · '),
        createdAt: row.createdAt,
        section: 'inventory',
        searchTerm: first?.sku || first?.productName || ''
      };
    }),
    ...deletionRows.map((row) => ({
      id: `product-deletion-${row._id}`,
      type: 'product_deletion',
      title: 'Product permanently deleted',
      detail: [row.productName, row.performedBy?.name ? `By ${row.performedBy.name}` : null].filter(Boolean).join(' · '),
      createdAt: row.deletedAt,
      section: 'products',
      searchTerm: row.productName
    })),
    ...orderRows.map((row) => ({
      id: `order-status-${row._id}-${new Date(row.changedAt).getTime()}`,
      type: 'order_status',
      title: `Order status changed to ${row.status}`,
      detail: row.actorName ? `By ${row.actorName}` : 'Order update',
      createdAt: row.changedAt,
      section: 'orders',
      searchTerm: String(row.orderId)
    }))
  ].filter((event) => event.createdAt && Number.isFinite(new Date(event.createdAt).getTime()))
    .sort((first, second) => new Date(second.createdAt) - new Date(first.createdAt))
    .slice(0, 30);
  res.json({ success: true, source: 'database_audit_records', events });
});

export const getAdminPreferences = asyncHandler(async (req, res) => {
  res.json({ success: true, preferences: { savedFilters: req.user.adminPreferences?.savedFilters || [] } });
});

export const saveAdminFilters = asyncHandler(async (req, res) => {
  if (!req.user.adminPreferences) req.user.adminPreferences = {};
  req.user.adminPreferences.savedFilters = sanitizeSavedAdminFilters(req.body?.savedFilters);
  await req.user.save();
  res.json({ success: true, preferences: { savedFilters: req.user.adminPreferences.savedFilters } });
});
