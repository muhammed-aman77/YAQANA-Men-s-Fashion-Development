import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminService, authService, categoryService, orderService, productService, supportService, uploadService } from '../services/api';
import { AlertTriangle, BarChart3, Boxes, ChevronDown, ChevronLeft, ChevronRight, Copy, Download, LayoutDashboard, LifeBuoy, LogOut, Menu, Package, PenSquare, Plus, Search, Send, Settings, ShieldCheck, Trash2, Users, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { catalogUnitsToRupees, formatInr, rupeesToCatalogUnits } from '../utils/currency';
import { getProductImage } from '../utils/productImage';
import PasswordInput from '../components/PasswordInput.jsx';
import AdminSelect from '../components/AdminSelect.jsx';
import AdminGlobalSearch from '../components/AdminGlobalSearch.jsx';
import AdminNotificationCenter from '../components/AdminNotificationCenter.jsx';
import { buildVariantMatrix } from '../utils/productVariants';
import {
  clearInventoryRequestKey,
  getInventoryRequestKey,
  isInventoryPolicyValid,
  requiresEnhancedInventoryConfirmation,
  updateInventoryDraft
} from '../utils/inventoryDraft';
import { formatUpdatedThrough, getComparisonPresentation, getDashboardPeriodLabel } from '../utils/dashboardAnalytics';
import {
  ADMIN_SECTION_GROUPS,
  ADMIN_STANDALONE_SECTIONS,
  adminNavigationReducer,
  getAdminSectionLabel,
  initialAdminNavigationState
} from '../utils/adminNavigation';
import { adminProductEditorReducer, initialProductEditorState } from '../utils/adminProductEditor.js';
import { filterAndSortAdminProducts, paginateAdminProducts } from '../utils/adminProductList.js';
import { buildSupportTicketQuery, SUPPORT_TICKET_PRIORITIES, SUPPORT_TICKET_STATUSES } from '../utils/supportCenter';
import {
  getInventoryDrawerState,
  getInventoryKpiFilter,
  getQuickAdjustmentDelta,
  getInventoryVariantOptions,
  getInventoryReceiptTargetOptions
} from '../utils/adminInventory';
import {
  canRenameCategory,
  CUSTOMER_STATUS_OPTIONS,
  formatShippingAddress,
  getAdminOrderStatusOptions,
  getInventoryStatus,
  getMetricDisplayValue,
  getProductStatusUpdate,
  LOW_STOCK_THRESHOLD
} from '../utils/adminStatus';

const sectionIcons = {
  dashboard: LayoutDashboard,
  products: Package,
  catalogue: Boxes,
  orders: Boxes,
  customers: Users,
  inventory: Boxes,
  support: LifeBuoy,
  analytics: BarChart3,
  settings: Settings
};

const initialProductForm = {
  name: '',
  description: '',
  category: '',
  gender: 'men',
  price: '',
  discountPrice: '',
  sizes: 'XS,S,M,L,XL',
  shortDescription: '',
  collection: '',
  fabricDetails: '',
  fitDetails: '',
  careInstructions: '',
  measurements: '',
  colours: 'Neutral,Black',
  stock: '0',
  variants: [],
  images: '',
  featured: false,
  newArrival: false,
  bestSeller: false,
  status: 'draft'
};

const initialProductListFilters = {
  search: '',
  category: 'all',
  collection: 'all',
  stock: 'all',
  status: 'all',
  sortBy: 'name-asc'
};

const INVENTORY_PAGE_SIZE = 25;
const ORDER_PAGE_SIZES = [10, 25, 50, 100];
const CUSTOMER_PAGE_SIZE = 10;
const ORDER_STATUS_FILTERS = ['Pending', 'Confirmed', 'Processing', 'Shipped', 'Delivered', 'Cancelled', 'RTO'];
const ORDER_PAYMENT_STATUS_FILTERS = ['Pending', 'Paid', 'Failed', 'Partially Refunded', 'Refunded'];

const formatInventoryPaise = (value) => value == null
  ? 'Not available'
  : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value) / 100);

const getOrderTimelineEvents = (order) => [
  { status: 'Order placed', at: order.createdAt },
  ...(Array.isArray(order.statusHistory) ? order.statusHistory : [])
].map((event, index) => ({
  ...event,
  index,
  key: event._id || `${event.status || 'event'}-${index}`,
  timestamp: Date.parse(event.at || '')
})).sort((first, second) => {
  const firstTime = Number.isFinite(first.timestamp) ? first.timestamp : Number.POSITIVE_INFINITY;
  const secondTime = Number.isFinite(second.timestamp) ? second.timestamp : Number.POSITIVE_INFINITY;
  return firstTime - secondTime || first.index - second.index;
});

const formatOrderTimelineDate = (value) => {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString();
};

const inventoryStatusLabel = (item) => {
  if (item.status === 'out_of_stock') return 'Out of stock';
  if (item.stockStatus === 'critical_stock') return 'Critical';
  if (item.status === 'low_stock') return 'Low stock';
  return 'In stock';
};

const inventoryStatusClass = (item) => {
  if (item.status === 'out_of_stock' || item.stockStatus === 'critical_stock') return 'admin-inventory-status--critical';
  if (item.status === 'low_stock') return 'admin-inventory-status--low';
  return 'admin-inventory-status--healthy';
};

function InventoryAdjustmentForm({ item, draft, submitting, inputClass, policy, onDraftChange, onSubmit }) {
  const delta = Number(draft.delta);
  const policyAvailable = isInventoryPolicyValid(policy);
  const requiresConfirmation = requiresEnhancedInventoryConfirmation(delta, policy);
  return (
    <form className="admin-inventory-adjustment" onSubmit={(event) => onSubmit(event, item)}>
      <div className="admin-inventory-drawer__quantity">
        <label className="admin-form-field">
          Units to change
          <input
            className={inputClass}
            type="number"
            step="1"
            value={draft.delta}
            disabled={submitting}
            onChange={(event) => onDraftChange(item, { delta: event.target.value })}
            required
          />
        </label>
        <div className="admin-inventory-drawer__quick">
          {[-5, -1, 1, 5].map((change) => (
            <button
              key={change}
              type="button"
              className="admin-button admin-button--secondary admin-button--compact"
              disabled={submitting}
              onClick={() => onDraftChange(item, { delta: String(getQuickAdjustmentDelta(delta, change)) })}
            >
              {change > 0 ? `+${change}` : change}
            </button>
          ))}
        </div>

      </div>
      <AdminSelect
        label="Reason preset"
        value={draft.reasonPreset || ''}
        options={[
          { value: '', label: 'Select a reason' },
          ...['Restock', 'Damaged / QC failure', 'Customer return', 'Photoshoot / showroom withdrawal', 'Stocktake correction', 'Other']
            .map((reason) => ({ value: reason, label: reason }))
        ]}
        className="admin-form-field"
        disabled={submitting}
        onChange={(value) => onDraftChange(item, {
          reasonPreset: value,
          reason: value === 'Other' ? draft.reason : value
        })}
      />
      {draft.reasonPreset === 'Other' && (
        <label className="admin-form-field">
          Reason details
          <input
            className={inputClass}
            value={draft.reason}
            disabled={submitting}
            onChange={(event) => onDraftChange(item, { reason: event.target.value })}
            maxLength={300}
            minLength={5}
            required
          />
        </label>
      )}
      {requiresConfirmation && (
        <label className="flex items-start gap-2 text-xs leading-5 text-[#514439]">
          <input
            type="checkbox"
            checked={draft.enhancedConfirmed === true}
            disabled={submitting}
            onChange={(event) => onDraftChange(item, { enhancedConfirmed: event.target.checked })}
          />
          <span>Confirm this unusually large adjustment ({Math.abs(delta)} units).</span>
        </label>
      )}
      {!policyAvailable && <p className="text-xs text-red-700" role="alert">Inventory policy is unavailable. Reload this section before submitting an adjustment.</p>}
      <label className="admin-form-field">
        Notes
        <textarea
          className={inputClass}
          value={draft.notes || ''}
          disabled={submitting}
          onChange={(event) => onDraftChange(item, { notes: event.target.value })}
          maxLength={1000}
          rows={3}
        />
      </label>
      <button type="submit" disabled={submitting || !policyAvailable} className="admin-button admin-button--secondary">
        {submitting ? 'Saving…' : 'Apply adjustment'}
      </button>
    </form>
  );
}

export default function AdminDashboardPage() {
  const { user, logout, updateUser } = useAuth();
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState('dashboard');
  const [navigationState, dispatchNavigation] = useReducer(adminNavigationReducer, initialAdminNavigationState);
  const [stats, setStats] = useState({
    totalProducts: 0,
    totalOrders: 0,
    totalCustomers: 0,
    totalRevenue: 0,
    pendingOrders: 0,
    lowStockProducts: 0,
    deliveredOrders: 0
  });
  const [statsStatus, setStatsStatus] = useState('loading');
  const [reportPeriod, setReportPeriod] = useState('last7days');
  const [reportingTimeZone, setReportingTimeZone] = useState(user?.reportingTimeZone || 'Asia/Kolkata');
  const [report, setReport] = useState(null);
  const [reportStatus, setReportStatus] = useState('loading');
  const [reportError, setReportError] = useState('');
  const [activityEvents, setActivityEvents] = useState([]);
  const [activityStatus, setActivityStatus] = useState('idle');
  const [savedAdminFilters, setSavedAdminFilters] = useState([]);
  const [savedFilterName, setSavedFilterName] = useState('');
  const [savedFilterStatus, setSavedFilterStatus] = useState('idle');
  const [reportingPreferenceSaving, setReportingPreferenceSaving] = useState(false);
  const [reportExporting, setReportExporting] = useState(false);
  const [customers, setCustomers] = useState([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerStatusFilter, setCustomerStatusFilter] = useState('all');
  const [customerPage, setCustomerPage] = useState(1);
  const [customerTotalCount, setCustomerTotalCount] = useState(0);
  const [customerTotalPages, setCustomerTotalPages] = useState(0);
  const [customerListStatus, setCustomerListStatus] = useState('idle');
  const [customerListError, setCustomerListError] = useState('');
  const [customerRefreshKey, setCustomerRefreshKey] = useState(0);
  const [customerDetailId, setCustomerDetailId] = useState('');
  const [customerDetail, setCustomerDetail] = useState(null);
  const [customerDetailStatus, setCustomerDetailStatus] = useState('idle');
  const [customerDetailError, setCustomerDetailError] = useState('');
  const customerDetailRequestRef = useRef(0);
  const [categoryDistribution, setCategoryDistribution] = useState([]);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [collections, setCollections] = useState([]);
  const [collectionRecords, setCollectionRecords] = useState([]);
  const [categoryForm, setCategoryForm] = useState({ name: '', description: '', image: '' });
  const [editingCategoryId, setEditingCategoryId] = useState(null);
  const [collectionForm, setCollectionForm] = useState({ name: '', description: '' });
  const [collectionRename, setCollectionRename] = useState({ current: '', name: '', description: '' });
  const [orders, setOrders] = useState([]);
  const [recentOrders, setRecentOrders] = useState([]);
  const [orderFilters, setOrderFilters] = useState({
    search: '',
    status: 'all',
    paymentStatus: 'all',
    paymentType: 'all',
    dateFrom: '',
    dateTo: ''
  });
  const [orderSearchInput, setOrderSearchInput] = useState('');
  const [orderPage, setOrderPage] = useState(1);
  const [orderPageSize, setOrderPageSize] = useState(25);
  const [orderTotalCount, setOrderTotalCount] = useState(0);
  const [orderTotalPages, setOrderTotalPages] = useState(0);
  const [orderStatus, setOrderStatus] = useState('idle');
  const [orderError, setOrderError] = useState('');
  const [orderRefreshKey, setOrderRefreshKey] = useState(0);
  const [inventoryItems, setInventoryItems] = useState([]);
  const [inventorySummary, setInventorySummary] = useState(null);
  const [inventoryPolicy, setInventoryPolicy] = useState(null);
  const [inventoryTransactionSupportAvailable, setInventoryTransactionSupportAvailable] = useState(false);
  const [inventorySkuRestoreBusy, setInventorySkuRestoreBusy] = useState({});
  const [inventoryFilters, setInventoryFilters] = useState({
    search: '',
    category: 'all',
    status: 'all',
    incomingOnly: false,
    active: 'all',
    variantStatus: 'all',
    sort: 'name-asc'
  });
  const [inventorySearchInput, setInventorySearchInput] = useState('');
  const [inventoryPage, setInventoryPage] = useState(1);
  const [inventoryTotalCount, setInventoryTotalCount] = useState(0);
  const [inventoryTotalPages, setInventoryTotalPages] = useState(0);
  const [inventoryStatus, setInventoryStatus] = useState('idle');
  const [inventoryError, setInventoryError] = useState('');
  const [inventoryRefreshKey, setInventoryRefreshKey] = useState(0);
  const [inventoryExporting, setInventoryExporting] = useState(false);
  const [inventoryTargetDrafts, setInventoryTargetDrafts] = useState({});
  const [inventoryTargetSubmitting, setInventoryTargetSubmitting] = useState({});
  const [inventoryApprovals, setInventoryApprovals] = useState([]);
  const [inventoryApprovalError, setInventoryApprovalError] = useState('');
  const [inventoryApprovalBusy, setInventoryApprovalBusy] = useState({});
  const [inventoryApprovalReasons, setInventoryApprovalReasons] = useState({});
  const [inventoryReceipts, setInventoryReceipts] = useState([]);
  const [inventoryReceiptError, setInventoryReceiptError] = useState('');
  const [inventoryReceiptDraft, setInventoryReceiptDraft] = useState({
    target: '',
    expectedQuantity: '',
    expectedDate: '',
    reference: '',
    unitCostPaise: ''
  });
  const [inventoryReceiptSubmitting, setInventoryReceiptSubmitting] = useState(false);
  const [inventoryReceiveDrafts, setInventoryReceiveDrafts] = useState({});
  const [inventoryReceiveSubmitting, setInventoryReceiveSubmitting] = useState({});
  const [inventoryUnitCostDraft, setInventoryUnitCostDraft] = useState({ sku: '', unitCost: '', costedQuantity: '', reason: '' });
  const [inventoryStocktakeDraft, setInventoryStocktakeDraft] = useState({ productId: '', sku: '', countedQuantity: '' });
  const [inventoryCsvText, setInventoryCsvText] = useState('');
  const [inventoryCsvPreview, setInventoryCsvPreview] = useState(null);
  const [stockMovements, setStockMovements] = useState([]);
  const [inventoryDrafts, setInventoryDrafts] = useState({});
  const [inventorySubmitting, setInventorySubmitting] = useState({});
  const [inventoryDrawerKey, setInventoryDrawerKey] = useState(null);
  const [inventoryDrawerItemOverride, setInventoryDrawerItemOverride] = useState(null);
  const [inventoryDrawerTargetLoading, setInventoryDrawerTargetLoading] = useState(false);
  const inventoryRequestLocks = useRef(new Set());
  const [supportTickets, setSupportTickets] = useState([]);
  const [supportTotalCount, setSupportTotalCount] = useState(0);
  const [supportTotalPages, setSupportTotalPages] = useState(0);
  const [supportPage, setSupportPage] = useState(1);
  const [supportFilters, setSupportFilters] = useState({ status: 'all', priority: 'all', search: '', assignedToMe: false });
  const [selectedSupportTicketId, setSelectedSupportTicketId] = useState('');
  const [selectedSupportTicket, setSelectedSupportTicket] = useState(null);
  const [supportAssignees, setSupportAssignees] = useState([]);
  const [supportLoading, setSupportLoading] = useState(false);
  const [supportError, setSupportError] = useState('');
  const [supportRefreshKey, setSupportRefreshKey] = useState(0);
  const [supportSubmitting, setSupportSubmitting] = useState(false);
  const [supportForm, setSupportForm] = useState({ customerId: '', orderId: '', subject: '', message: '', priority: 'Normal' });
  const [supportEdit, setSupportEdit] = useState({ status: 'Open', priority: 'Normal', assignedTo: '' });
  const [supportInternalNote, setSupportInternalNote] = useState('');
  const [supportReply, setSupportReply] = useState('');
  const [productForm, setProductForm] = useState(initialProductForm);
  const [colourGalleryDraft, setColourGalleryDraft] = useState({});
  const [variantMatrixDirty, setVariantMatrixDirty] = useState(false);
  const [productEditorState, dispatchProductEditor] = useReducer(adminProductEditorReducer, initialProductEditorState);
  const { isOpen: productEditorOpen, editingId } = productEditorState;
  const [productEditorDirty, setProductEditorDirty] = useState(false);
  const productEditorDialogRef = useRef(null);
  const [productListFilters, setProductListFilters] = useState(initialProductListFilters);
  const [productListPage, setProductListPage] = useState(1);
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [profileForm, setProfileForm] = useState({ name: user?.name || '', phone: user?.phone || '' });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '' });
  const [noticeType, setNoticeType] = useState('success');

  const showNotice = (message, type = 'success') => {
    setNotice(message);
    setNoticeType(type);
  };

  const handleReportingTimeZoneChange = async (nextTimeZone) => {
    if (nextTimeZone === reportingTimeZone) return;
    setReportingPreferenceSaving(true);
    setReportError('');
    try {
      const { data } = await authService.updateProfile({ reportingTimeZone: nextTimeZone });
      if (!data.success || data.user?.reportingTimeZone !== nextTimeZone) {
        throw new Error('The reporting time zone could not be saved.');
      }
      updateUser(data.user);
      setReportingTimeZone(nextTimeZone);
    } catch (error) {
      setReportError(error.response?.data?.message || error.message || 'The reporting time zone could not be saved.');
    } finally {
      setReportingPreferenceSaving(false);
    }
  };

  const handleDashboardReportExport = async () => {
    setReportExporting(true);
    try {
      const { data } = await adminService.exportDashboardCsv({ period: reportPeriod, timeZone: reportingTimeZone });
      const url = URL.createObjectURL(new Blob([data], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `yaqana-dashboard-${reportPeriod}-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      showNotice('Dashboard report exported. Customer contact details are not included.');
    } catch (error) {
      showNotice(error.response?.data?.message || 'Dashboard report export failed.', 'error');
    } finally {
      setReportExporting(false);
    }
  };

  const loadAdminData = async () => {
    setLoading(true);
    try {
      const [firstProductsRes, ordersRes, categoriesRes, collectionsRes] = await Promise.all([
        productService.getProducts({ limit: 100, page: 1 }),
        orderService.getAllOrders({ limit: 5 }),
        categoryService.getCategories(),
        productService.getCollections()
      ]);

      const productPages = firstProductsRes.data.totalPages > 1
        ? await Promise.all(Array.from({ length: firstProductsRes.data.totalPages - 1 }, (_, index) => productService.getProducts({ limit: 100, page: index + 2 })))
        : [];

      if (firstProductsRes.data.success) setProducts([...(firstProductsRes.data.products || []), ...productPages.flatMap((page) => page.data.products || [])]);
      if (ordersRes.data.success) setRecentOrders(ordersRes.data.orders || []);
      if (categoriesRes.data.success) setCategories(categoriesRes.data.categories || []);
      if (collectionsRes.data.success) {
        setCollections(collectionsRes.data.collections || []);
        setCollectionRecords(collectionsRes.data.collectionRecords || []);
      }
    } catch (err) {
      showNotice(err.response?.data?.message || 'Could not load admin data. Check the API connection and your administrator session.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeSection !== 'dashboard') return undefined;
    let active = true;
    setActivityStatus('loading');
    adminService.getActivity().then(({ data }) => {
      if (!active) return;
      setActivityEvents(Array.isArray(data.events) ? data.events : []);
      setActivityStatus(data.success ? 'loaded' : 'error');
    }).catch(() => {
      if (active) setActivityStatus('error');
    });
    return () => { active = false; };
  }, [activeSection]);

  useEffect(() => {
    adminService.getPreferences().then(({ data }) => {
      if (data.success) setSavedAdminFilters(Array.isArray(data.preferences?.savedFilters) ? data.preferences.savedFilters : []);
    }).catch(() => setSavedFilterStatus('error'));
  }, []);

  const saveCurrentOrderFilters = async (event) => {
    event.preventDefault();
    const label = savedFilterName.trim();
    if (!label) return;
    const next = [...savedAdminFilters.filter((item) => item.section !== 'orders' || item.label !== label), {
      id: `orders-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      label,
      section: 'orders',
      filters: { ...orderFilters }
    }].slice(-12);
    setSavedFilterStatus('saving');
    try {
      const { data } = await adminService.saveFilters(next);
      setSavedAdminFilters(data.preferences.savedFilters);
      setSavedFilterName('');
      setSavedFilterStatus('saved');
    } catch {
      setSavedFilterStatus('error');
    }
  };

  const applySavedAdminFilter = (saved) => {
    if (saved.section === 'orders') {
      setOrderFilters({ ...orderFilters, ...saved.filters });
      setOrderSearchInput('');
      setOrderPage(1);
      setActiveSection('orders');
    } else if (saved.section === 'products') {
      setProductListFilters({ ...initialProductListFilters, ...saved.filters });
      setProductListPage(1);
      setActiveSection('products');
    } else if (saved.section === 'inventory') {
      setInventoryFilters((filters) => ({ ...filters, ...saved.filters }));
      setInventoryPage(1);
      setActiveSection('inventory');
    }
  };

  useEffect(() => {
    loadAdminData();
  }, []);

  useEffect(() => {
    if (activeSection !== 'customers') return undefined;
    let active = true;
    const loadCustomers = async () => {
      setCustomerListStatus('loading');
      setCustomerListError('');
      try {
        const { data } = await adminService.getCustomers({
          search: customerSearch.trim(),
          status: customerStatusFilter,
          page: customerPage,
          limit: CUSTOMER_PAGE_SIZE
        });
        if (!active) return;
        if (!data.success) throw new Error('Customers could not be loaded.');
        const resultCustomers = Array.isArray(data.customers) ? data.customers : [];
        const totalCustomers = Number.isSafeInteger(data.totalCustomers) && data.totalCustomers >= 0
          ? data.totalCustomers
          : resultCustomers.length;
        const totalPages = Number.isSafeInteger(data.totalPages) && data.totalPages >= 0
          ? data.totalPages
          : Math.ceil(totalCustomers / CUSTOMER_PAGE_SIZE);
        setCustomers(resultCustomers);
        setCustomerTotalCount(totalCustomers);
        setCustomerTotalPages(totalPages);
        setCustomerPage(Number.isSafeInteger(data.currentPage) && data.currentPage > 0 ? data.currentPage : customerPage);
        setCustomerListStatus('loaded');
      } catch (error) {
        if (!active) return;
        setCustomers([]);
        setCustomerTotalCount(0);
        setCustomerTotalPages(0);
        setCustomerListStatus('error');
        setCustomerListError(error.response?.data?.message || error.message || 'Customers could not be loaded.');
      }
    };
    loadCustomers();
    return () => { active = false; };
  }, [activeSection, customerSearch, customerStatusFilter, customerPage, customerRefreshKey]);

  useEffect(() => {
    if (activeSection !== 'support') return undefined;
    let active = true;
    Promise.allSettled([
      adminService.getCustomers({ status: 'all', page: 1, limit: 100 }),
      orderService.getAllOrders({ page: 1, limit: 100 })
    ]).then(([customersResult, ordersResult]) => {
      if (!active) return;
      if (customersResult.status === 'fulfilled' && customersResult.value.data.success) {
        setCustomers(Array.isArray(customersResult.value.data.customers) ? customersResult.value.data.customers : []);
      }
      if (ordersResult.status === 'fulfilled' && ordersResult.value.data.success) {
        setOrders(Array.isArray(ordersResult.value.data.orders) ? ordersResult.value.data.orders : []);
      }
    });
    return () => { active = false; };
  }, [activeSection]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const search = orderSearchInput.trim();
      setOrderPage(1);
      setOrderFilters((current) => current.search === search ? current : { ...current, search });
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [orderSearchInput]);

  useEffect(() => {
    if (activeSection !== 'orders') return undefined;
    let active = true;
    const loadOrders = async () => {
      setOrderStatus('loading');
      setOrderError('');
      try {
        const { data } = await orderService.getAllOrders({
          ...orderFilters,
          page: orderPage,
          limit: orderPageSize
        });
        if (!active) return;
        if (!data.success) throw new Error('Orders could not be loaded.');
        const resultOrders = Array.isArray(data.orders) ? data.orders : [];
        const totalOrders = Number.isSafeInteger(data.totalOrders) && data.totalOrders >= 0
          ? data.totalOrders
          : resultOrders.length;
        const totalPages = Number.isSafeInteger(data.totalPages) && data.totalPages >= 0
          ? data.totalPages
          : Math.ceil(totalOrders / orderPageSize);
        setOrders(resultOrders);
        setOrderTotalCount(totalOrders);
        setOrderTotalPages(totalPages);
        setOrderPage(Number.isSafeInteger(data.currentPage) && data.currentPage > 0 ? data.currentPage : orderPage);
        setOrderStatus('loaded');
      } catch (error) {
        if (!active) return;
        setOrders([]);
        setOrderTotalCount(0);
        setOrderTotalPages(0);
        setOrderStatus('error');
        setOrderError(error.response?.data?.message || error.message || 'Orders could not be loaded.');
      }
    };
    loadOrders();
    return () => { active = false; };
  }, [activeSection, orderFilters, orderPage, orderPageSize, orderRefreshKey]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setInventoryPage(1);
      setInventoryFilters((current) => current.search === inventorySearchInput
        ? current
        : { ...current, search: inventorySearchInput });
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [inventorySearchInput]);

  useEffect(() => {
    if (activeSection !== 'inventory') return undefined;
    let active = true;
    const loadInventory = async () => {
      setInventoryStatus('loading');
      setInventoryError('');
      setInventoryPolicy(null);
      try {
        const [inventoryRes, movementsRes] = await Promise.all([
          adminService.getInventory({
            ...inventoryFilters,
            page: inventoryPage,
            limit: INVENTORY_PAGE_SIZE
          }),
          adminService.getInventoryMovements({ limit: 50 })
        ]);
        let loadedPolicy = null;
        try {
          const { data: policyData } = await adminService.getInventoryPolicy();
          if (policyData.success && isInventoryPolicyValid(policyData.policy)) loadedPolicy = policyData.policy;
        } catch {
          loadedPolicy = null;
        }
        if (!active) return;
        setInventoryPolicy(loadedPolicy);
        if (!inventoryRes.data.success) throw new Error('Inventory could not be loaded.');
        setInventoryItems(inventoryRes.data.inventory || []);
        setInventorySummary(inventoryRes.data.summary || null);
        setInventoryTransactionSupportAvailable(inventoryRes.data.transactionSupportAvailable === true);
        setInventoryTotalCount(inventoryRes.data.totalCount ?? inventoryRes.data.inventory?.length ?? 0);
        setInventoryTotalPages(inventoryRes.data.totalPages ?? 1);
        setInventoryStatus('loaded');
        setStockMovements(movementsRes.data.movements || []);
        try {
          const approvalsRes = await adminService.getInventoryApprovals({ status: 'pending', limit: 50 });
          if (!active) return;
          setInventoryApprovals(approvalsRes.data.approvals || []);
          setInventoryApprovalError('');
        } catch (approvalError) {
          if (!active) return;
          setInventoryApprovalError(
            approvalError.response?.data?.message || approvalError.message || 'Pending approvals could not be loaded.'
          );
        }
        try {
          const receiptsRes = await adminService.getInventoryInbound({ status: 'open', limit: 50 });
          if (!active) return;
          setInventoryReceipts(receiptsRes.data.receipts || []);
          setInventoryReceiptError('');
        } catch (receiptError) {
          if (!active) return;
          setInventoryReceiptError(
            receiptError.response?.data?.message || receiptError.message || 'Inbound receipts could not be loaded.'
          );
        }
      } catch (error) {
        if (!active) return;
        setInventoryStatus('error');
        setInventoryError(error.response?.data?.message || error.message || 'Inventory could not be loaded.');
      }
    };
    loadInventory();
    return () => { active = false; };
  }, [activeSection, inventoryFilters, inventoryPage, inventoryRefreshKey]);

  useEffect(() => {
    if (user?.reportingTimeZone && user.reportingTimeZone !== reportingTimeZone) {
      setReportingTimeZone(user.reportingTimeZone);
    }
  }, [user?.reportingTimeZone]);

  useEffect(() => {
    let active = true;
    const loadReport = async () => {
      setReport(null);
      setReportStatus('loading');
      setStatsStatus('loading');
      setReportError('');
      try {
        const { data } = await adminService.getStats({ period: reportPeriod, timeZone: reportingTimeZone });
        if (!data.success || !data.report) throw new Error('Dashboard report data is unavailable.');
        if (!active) return;
        setReport(data.report);
        setStats(data.stats || data);
        setCategoryDistribution(data.categoryDistribution || []);
        setReportStatus('loaded');
        setStatsStatus('loaded');
      } catch (error) {
        if (!active) return;
        setReport(null);
        setReportStatus('error');
        setStatsStatus('error');
        setReportError(error.response?.data?.message || error.message || 'Dashboard report data could not be loaded.');
      }
    };
    loadReport();
    return () => { active = false; };
  }, [reportPeriod, reportingTimeZone]);

  useEffect(() => {
    if (activeSection !== 'support') return undefined;
    let active = true;
    const loadSupportTickets = async () => {
      setSupportLoading(true);
      setSupportError('');
      try {
        const [ticketsRes, assigneesRes] = await Promise.all([
          supportService.getTickets(buildSupportTicketQuery({ page: supportPage, ...supportFilters })),
          supportService.getAssignees()
        ]);
        if (!active) return;
        const nextTickets = ticketsRes.data.tickets || [];
        setSupportTickets(nextTickets);
        setSupportTotalCount(ticketsRes.data.totalCount || 0);
        setSupportTotalPages(ticketsRes.data.totalPages || 0);
        setSupportAssignees(assigneesRes.data.assignees || []);
        if (!nextTickets.some((ticket) => String(ticket._id) === String(selectedSupportTicketId))) {
          setSelectedSupportTicketId(nextTickets[0]?._id || '');
          setSelectedSupportTicket(null);
        }
      } catch (error) {
        if (active) setSupportError(error.response?.data?.message || 'Support tickets could not be loaded.');
      } finally {
        if (active) setSupportLoading(false);
      }
    };
    loadSupportTickets();
    return () => { active = false; };
  }, [activeSection, supportPage, supportFilters, supportRefreshKey]);

  useEffect(() => {
    if (activeSection !== 'support' || !selectedSupportTicketId) return undefined;
    let active = true;
    supportService.getTicket(selectedSupportTicketId).then((response) => {
      if (!active) return;
      const ticket = response.data.ticket;
      setSelectedSupportTicket(ticket);
      setSupportEdit({
        status: ticket.status,
        priority: ticket.priority,
        assignedTo: ticket.assignedTo?._id || ''
      });
    }).catch((error) => {
      if (active) setSupportError(error.response?.data?.message || 'The selected support ticket could not be loaded.');
    });
    return () => { active = false; };
  }, [activeSection, selectedSupportTicketId, supportRefreshKey]);

  useEffect(() => {
    if (!navigationState.isOpen) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') dispatchNavigation({ type: 'escape' });
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigationState.isOpen]);

  useEffect(() => {
    const dialog = productEditorDialogRef.current;
    if (!dialog) return;

    if (productEditorOpen && !dialog.open) {
      dialog.showModal();
      dialog.querySelector('[name="name"]')?.focus();
    } else if (!productEditorOpen && dialog.open) {
      dialog.close();
    }
  }, [productEditorOpen]);

  const resetProductEditor = () => {
    if (productEditorDialogRef.current?.open) productEditorDialogRef.current.close();
    dispatchProductEditor({ type: 'close' });
    setProductForm(initialProductForm);
    setColourGalleryDraft({});
    setVariantMatrixDirty(false);
    setProductEditorDirty(false);
  };

  const openNewProductEditor = () => {
    setProductForm(initialProductForm);
    setColourGalleryDraft({});
    setVariantMatrixDirty(false);
    setProductEditorDirty(false);
    dispatchProductEditor({ type: 'create' });
  };

  const closeProductEditor = () => {
    if (productEditorDirty && !window.confirm('Discard unsaved product changes?')) return;
    resetProductEditor();
  };

  const handleProductEditorCancel = (event) => {
    event.preventDefault();
    closeProductEditor();
  };

  const handleProductEditorKeyDown = (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    closeProductEditor();
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setProductForm((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
    if (name === 'sizes' || name === 'colours') setVariantMatrixDirty(true);
  };

  const updateProductListFilter = (key, value) => {
    setProductListFilters((current) => ({ ...current, [key]: value }));
    setProductListPage(1);
  };

  const handleGlobalSearchSelect = (result) => {
    setActiveSection(result.section);
    if (result.section === 'products') updateProductListFilter('search', result.searchTerm);
    if (result.section === 'orders') {
      setOrderSearchInput(result.searchTerm);
      setOrderPage(1);
    }
    if (result.section === 'customers') {
      setCustomerSearch(result.searchTerm);
      setCustomerPage(1);
    }
    if (result.section === 'inventory') {
      setInventorySearchInput(result.searchTerm);
      updateInventoryFilter('search', result.searchTerm);
    }
    dispatchNavigation({ type: 'close' });
  };

  const clearProductListFilters = () => {
    setProductListFilters(initialProductListFilters);
    setProductListPage(1);
  };

  const generateProductVariants = () => {
    const sizes = productForm.sizes.split(',').map((value) => value.trim()).filter(Boolean);
    const colours = productForm.colours.split(',').map((value) => value.trim()).filter(Boolean);
    if (!sizes.length || !colours.length) {
      showNotice('Add at least one size and one colour before generating SKU variants.', 'error');
      return;
    }

    try {
      const variants = buildVariantMatrix({
        productName: productForm.name,
        sizes,
        colours,
        existingVariants: productForm.variants
      });
      setProductForm((form) => ({ ...form, variants }));
      setVariantMatrixDirty(false);
      if (editingId) setProductEditorDirty(true);
    } catch (error) {
      showNotice(error.message || 'Could not generate the SKU matrix.', 'error');
    }
  };

  const handleProductImageUpload = async (event) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      showNotice('Product images must be 5 MB or smaller.', 'error');
      input.value = '';
      return;
    }

    const formData = new FormData();
    formData.append('image', file);
    setUploadingImage(true);
    showNotice('Uploading product image...');
    try {
      const res = await uploadService.uploadImage(formData);
      if (!res.data.success || typeof res.data.imageUrl !== 'string' || !res.data.imageUrl) {
        showNotice(res.data.message || 'Image upload failed.', 'error');
        return;
      }

      setProductForm((form) => {
        const images = form.images.split(',').map((value) => value.trim()).filter(Boolean);
        return { ...form, images: [...new Set([...images, res.data.imageUrl])].join(', ') };
      });
      showNotice('Product image uploaded and added to the image list.');
    } catch (err) {
      showNotice(err.response?.data?.message || 'Image upload failed.', 'error');
    } finally {
      input.value = '';
      setUploadingImage(false);
    }
  };

  const handleColourGalleryUpload = async (event, colourName) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      showNotice('Product images must be 5 MB or smaller.', 'error');
      input.value = '';
      return;
    }

    const formData = new FormData();
    formData.append('image', file);
    setUploadingImage(true);
    showNotice(`Uploading ${colourName} gallery image...`);
    try {
      const res = await uploadService.uploadImage(formData);
      if (!res.data.success || typeof res.data.imageUrl !== 'string' || !res.data.imageUrl) {
        showNotice(res.data.message || 'Image upload failed.', 'error');
        return;
      }

      const key = colourName.toLowerCase();
      setColourGalleryDraft((current) => {
        const existing = (current[key] || '').split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
        return { ...current, [key]: [...new Set([...existing, res.data.imageUrl])].join('\n') };
      });
      showNotice(`${colourName} gallery image uploaded.`);
    } catch (err) {
      showNotice(err.response?.data?.message || 'Image upload failed.', 'error');
    } finally {
      input.value = '';
      setUploadingImage(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const originalProduct = editingId ? products.find((product) => product._id === editingId) : null;
      const formColours = productForm.colours.split(',').map((value) => value.trim()).filter(Boolean);
      const payload = {
        ...productForm,
        measurements: productForm.measurements ? JSON.parse(productForm.measurements) : undefined,
        price: rupeesToCatalogUnits(productForm.price),
        discountPrice: productForm.discountPrice ? rupeesToCatalogUnits(productForm.discountPrice) : null,
        stock: Number(productForm.stock),
        sizes: productForm.sizes.split(',').map((v) => v.trim()).filter(Boolean),
        colours: formColours.map((name) => {
          const existingColour = originalProduct?.colours?.find((colour) => colour.name.toLowerCase() === name.toLowerCase());
          const gallery = colourGalleryDraft[name.toLowerCase()] ?? (existingColour?.images || []).join('\n');
          return {
            name,
            hex: existingColour?.hex || '#D4C5B9',
            images: gallery.split(/\r?\n|,/).map((image) => image.trim()).filter(Boolean)
          };
        }),
        images: productForm.images
          ? productForm.images.split(',').map((value) => value.trim()).filter(Boolean)
          : originalProduct?.images || []
      };
      if (payload.variants?.length) {
        payload.variants = payload.variants.map((variant) => {
          const next = {
            size: variant.size,
            colour: variant.colour,
            sku: variant.sku,
            stock: Number(variant.stock),
            status: variant.status || 'active'
          };
          if (variant.barcode?.trim()) next.barcode = variant.barcode.trim();
          if (variant.pricePaise !== undefined && variant.pricePaise !== null && variant.pricePaise !== '') {
            next.pricePaise = Number(variant.pricePaise);
          }
          if (variant.discountPricePaise !== undefined && variant.discountPricePaise !== null && variant.discountPricePaise !== '') {
            next.discountPricePaise = Number(variant.discountPricePaise);
          }
          const images = Array.isArray(variant.images)
            ? variant.images
            : String(variant.images || '').split(/\r?\n|,/);
          const normalizedImages = images.map((image) => image.trim()).filter(Boolean);
          if (normalizedImages.length) next.images = normalizedImages;
          return next;
        });
      }
      if (!payload.variants?.length) delete payload.variants;
      if (payload.variants?.length) delete payload.stock;
      if (editingId) delete payload.stock;

      if (editingId) {
        await productService.updateProduct(editingId, payload);
        showNotice('Product updated successfully.');
      } else {
        await productService.createProduct(payload);
        showNotice('Product created successfully.');
      }

      setProductForm(initialProductForm);
      setColourGalleryDraft({});
      setVariantMatrixDirty(false);
      if (productEditorDialogRef.current?.open) productEditorDialogRef.current.close();
      dispatchProductEditor({ type: 'close' });
      setProductEditorDirty(false);
      await loadAdminData();
    } catch (err) {
      showNotice(err.response?.data?.message || 'Product save failed.', 'error');
    }
  };

  const handleEdit = (product) => {
    dispatchProductEditor({ type: 'edit', productId: product._id });
    setProductEditorDirty(false);
    setVariantMatrixDirty(false);
    setColourGalleryDraft(Object.fromEntries((product.colours || []).map((colour) => [
      colour.name.toLowerCase(),
      (colour.images || []).join('\n')
    ])));
    setProductForm({
      name: product.name,
      description: product.description,
      category: product.category,
      gender: product.gender,
      price: String(catalogUnitsToRupees(product.price)),
      discountPrice: product.discountPrice ? String(catalogUnitsToRupees(product.discountPrice)) : '',
      sizes: Array.isArray(product.sizes) ? product.sizes.join(', ') : '',
      shortDescription: product.shortDescription || '',
      collection: product.collection || '',
      fabricDetails: product.fabricDetails || '',
      fitDetails: product.fitDetails || '',
      careInstructions: product.careInstructions || '',
      measurements: product.measurements ? JSON.stringify(product.measurements, null, 2) : '',
      colours: Array.isArray(product.colours) ? product.colours.map((c) => c.name).join(', ') : '',
      stock: String(product.stock),
      variants: Array.isArray(product.variants) ? product.variants.map((variant) => ({ ...variant })) : [],
      images: Array.isArray(product.images) ? product.images.join(', ') : '',
      featured: Boolean(product.featured),
      newArrival: Boolean(product.newArrival),
        bestSeller: Boolean(product.bestSeller),
        status: product.status || (product.active === true ? 'active' : 'archived')
    });
  };

  const handleDuplicate = (product) => {
    const baseName = `${product.name} Copy`;
    let name = baseName;
    let suffix = 2;
    while (products.some((entry) => entry.name === name)) name = `${baseName} ${suffix++}`;

    const sizes = Array.isArray(product.sizes) ? product.sizes : [];
    const colours = Array.isArray(product.colours) ? product.colours : [];
    const variants = product.variants?.length
        ? buildVariantMatrix({
          productName: name,
          sizes,
          colours: colours.map((colour) => colour.name),
          existingVariants: []
        })
        : [];

    dispatchProductEditor({ type: 'create' });
    setProductEditorDirty(true);
    setVariantMatrixDirty(false);
    setColourGalleryDraft(Object.fromEntries(colours.map((colour) => [
        colour.name.toLowerCase(),
        (colour.images || []).join('\n')
    ])));
    setProductForm({
        name,
        description: product.description || '',
        category: product.category || '',
        gender: product.gender || 'men',
        price: String(catalogUnitsToRupees(product.price)),
        discountPrice: product.discountPrice ? String(catalogUnitsToRupees(product.discountPrice)) : '',
        sizes: sizes.join(', '),
        shortDescription: product.shortDescription || '',
        collection: product.collection || '',
        fabricDetails: product.fabricDetails || '',
        fitDetails: product.fitDetails || '',
        careInstructions: product.careInstructions || '',
        measurements: product.measurements ? JSON.stringify(product.measurements, null, 2) : '',
        colours: colours.map((colour) => colour.name).join(', '),
        stock: '0',
        variants,
        images: Array.isArray(product.images) ? product.images.join(', ') : '',
        featured: Boolean(product.featured),
        newArrival: Boolean(product.newArrival),
        bestSeller: Boolean(product.bestSeller),
        status: 'draft'
    });
    setActiveSection('products');
    dispatchNavigation({ type: 'navigate' });
    showNotice('Copy loaded as a draft with zero stock and newly generated SKUs. Review it before saving.');
  };

  const handleProductStatusChange = async (product, action) => {
    try {
      await productService.updateProduct(product._id, getProductStatusUpdate(action));
        const messages = {
          archive: 'Product archived; its order history is preserved.',
          activate: 'Product activated and published.',
          discontinue: 'Product discontinued; its order history is preserved.'
        };
        showNotice(messages[action]);
      await loadAdminData();
    } catch (err) {
      showNotice(err.response?.data?.message || 'Could not update product status.', 'error');
    }
  };

  const handlePermanentProductDelete = async (product) => {
    const confirmed = window.confirm(
      `Permanently delete "${product.name}"? This cannot be undone. Products with stock or order, inventory, cart, or wishlist history cannot be deleted.`
    );
    if (!confirmed) return;

    try {
      await productService.permanentlyDeleteProduct(product._id);
      showNotice(`${product.name} was permanently deleted.`);
      await loadAdminData();
    } catch (err) {
      showNotice(err.response?.data?.message || 'Could not permanently delete product.', 'error');
    }
  };

  const handleCategorySubmit = async (event) => {
    event.preventDefault();
    try {
      if (editingCategoryId) await categoryService.updateCategory(editingCategoryId, categoryForm);
      else await categoryService.createCategory(categoryForm);
      setCategoryForm({ name: '', description: '', image: '' });
      setEditingCategoryId(null);
      showNotice('Category saved.');
      await loadAdminData();
    } catch (err) { showNotice(err.response?.data?.message || 'Category save failed.', 'error'); }
  };

  const handleCollectionRename = async (event) => {
    event.preventDefault();
    try {
      await productService.renameCollection(collectionRename.current, collectionRename.name, collectionRename.description);
      setCollectionRename({ current: '', name: '', description: '' });
      showNotice('Collection renamed.');
      await loadAdminData();
    } catch (err) { showNotice(err.response?.data?.message || 'Collection rename failed.', 'error'); }
  };

  const handleCollectionCreate = async (event) => {
    event.preventDefault();
    try {
      await productService.createCollection(collectionForm);
      setCollectionForm({ name: '', description: '' });
      showNotice('Collection created. Add products to it from the product form.');
      await loadAdminData();
    } catch (err) { showNotice(err.response?.data?.message || 'Collection creation failed.', 'error'); }
  };

  const handleCategoryEdit = (category) => {
    setEditingCategoryId(category._id);
    setCategoryForm({ name: category.name, description: category.description || '', image: category.image || '' });
  };

  const handleCategoryArchive = async (category) => {
    if (!window.confirm(`Archive “${category.name}”? Existing product records will remain unchanged.`)) return;
    try {
      await categoryService.deleteCategory(category._id);
      showNotice('Category archived.');
      await loadAdminData();
    } catch (err) {
      showNotice(err.response?.data?.message || 'Category could not be archived.', 'error');
    }
  };

  const handleCollectionRemove = async (name) => {
    if (!window.confirm(`Remove “${name}” and unassign its products?`)) return;
    try {
      await productService.removeCollection(name);
      showNotice('Collection removed and products unassigned.');
      await loadAdminData();
    } catch (err) { showNotice(err.response?.data?.message || 'Collection removal failed.', 'error'); }
  };

  const handleOrderStatus = async (id, status) => {
    try {
      await orderService.updateOrderStatus(id, { orderStatus: status });
      showNotice('Order status updated.');
      await loadAdminData();
      setOrderRefreshKey((current) => current + 1);
    } catch (err) {
      showNotice(err.response?.data?.message || 'Order status update failed.', 'error');
    }
  };

  const updateOrderFilter = (key, value) => {
    setOrderPage(1);
    setOrderFilters((current) => ({ ...current, [key]: value }));
  };

  const handleCustomerStatus = async (id, status) => {
    try {
      await adminService.updateCustomerStatus(id, { status });
      showNotice('Customer account status updated.');
      setCustomerRefreshKey((current) => current + 1);
    } catch (err) {
      showNotice(err.response?.data?.message || 'Customer status update failed.', 'error');
    }
  };

  const handleCustomerDetails = async (customerId) => {
    if (customerDetailId === customerId) {
      customerDetailRequestRef.current += 1;
      setCustomerDetailId('');
      setCustomerDetail(null);
      setCustomerDetailStatus('idle');
      setCustomerDetailError('');
      return;
    }
    const requestId = customerDetailRequestRef.current + 1;
    customerDetailRequestRef.current = requestId;
    setCustomerDetailId(customerId);
    setCustomerDetail(null);
    setCustomerDetailStatus('loading');
    setCustomerDetailError('');
    try {
      const { data } = await adminService.getCustomerDetails(customerId);
      if (customerDetailRequestRef.current !== requestId) return;
      if (!data.success || data.customer?._id !== customerId) throw new Error('Customer details could not be loaded.');
      setCustomerDetail(data.customer);
      setCustomerDetailStatus('loaded');
    } catch (error) {
      if (customerDetailRequestRef.current !== requestId) return;
      setCustomerDetailStatus('error');
      setCustomerDetailError(error.response?.data?.message || error.message || 'Customer details could not be loaded.');
    }
  };

  const handleInventoryDraftChange = (item, changes) => {
    const key = item.sku || item.productId;
    setInventoryDrafts((current) => ({
      ...current,
      [key]: updateInventoryDraft(
        current[key] || { delta: '', reason: '', enhancedConfirmed: false },
        changes.delta === undefined ? changes : { ...changes, enhancedConfirmed: false }
      )
    }));
  };

  const openInventoryDrawer = (item) => {
    const key = item.sku || item.productId;
    setInventoryDrawerItemOverride({ key, item });
    setInventoryDrawerKey(key);
  };

  const closeInventoryDrawer = () => {
    setInventoryDrawerKey(null);
    setInventoryDrawerItemOverride(null);
  };

  const handleInventoryVariantChange = async (sku) => {
    if (!sku || sku === inventoryDrawerKey) return;
    setInventoryDrawerTargetLoading(true);
    try {
      const { data } = await adminService.getInventory({ search: sku, page: 1, limit: 100 });
      const item = (data.inventory || []).find((row) => row.sku === sku);
      if (!item) {
        throw new Error(`Inventory details for ${sku} were not found.`);
      }
      const key = item.sku || item.productId;
      setInventoryDrawerItemOverride({ key, item });
      setInventoryDrawerKey(key);
    } catch (error) {
      showNotice(error.response?.data?.message || error.message || 'The selected SKU inventory could not be loaded.', 'error');
    } finally {
      setInventoryDrawerTargetLoading(false);
    }
  };

  const updateInventoryFilter = (key, value) => {
    setInventoryPage(1);
    setInventoryFilters((current) => ({
      ...current,
      [key]: value,
      ...(key === 'status' ? { incomingOnly: false } : {})
    }));
  };

  const handleInventoryTargetSave = async (event, item) => {
    event.preventDefault();
    const key = item.sku;
    if (!key) return;
    const rawTarget = inventoryTargetDrafts[key] ?? item.reorderTarget ?? '';
    const reorderTarget = rawTarget === '' ? null : Number(rawTarget);
    if (reorderTarget !== null && (!Number.isSafeInteger(reorderTarget) || reorderTarget < 0)) {
      showNotice('Restock target must be a non-negative whole number.', 'error');
      return;
    }

    setInventoryTargetSubmitting((current) => ({ ...current, [key]: true }));
    try {
      await adminService.setInventoryReorderTarget(key, reorderTarget);
      showNotice(`Restock target saved for ${key}.`);
      setInventoryRefreshKey((current) => current + 1);
    } catch (error) {
      showNotice(error.response?.data?.message || 'Restock target could not be saved.', 'error');
    } finally {
      setInventoryTargetSubmitting((current) => ({ ...current, [key]: false }));
    }
  };

  const handleInventoryExport = async () => {
    setInventoryExporting(true);
    try {
      const { data } = await adminService.exportInventoryCsv(inventoryFilters);
      const url = window.URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `yaqana-inventory-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      showNotice('Inventory CSV downloaded.');
    } catch (error) {
      showNotice(error.response?.data?.message || 'Inventory export failed.', 'error');
    } finally {
      setInventoryExporting(false);
    }
  };

  const handleInventorySkuRestore = async (item) => {
    const reason = window.prompt(`Why should ${item.sku} be restored?`);
    if (reason === null) return;
    const normalizedReason = reason.trim();
    if (normalizedReason.length < 5 || normalizedReason.length > 500) {
      showNotice('Provide an audit reason between 5 and 500 characters.', 'error');
      return;
    }

    setInventorySkuRestoreBusy((current) => ({ ...current, [item.sku]: true }));
    try {
      const { data } = await adminService.restoreInventorySku(item.productId, item.sku, normalizedReason);
      showNotice(data.message || `SKU ${item.sku} restored; product publication status was not changed.`);
      setInventoryRefreshKey((current) => current + 1);
    } catch (error) {
      showNotice(error.response?.data?.message || 'SKU restoration failed.', 'error');
    } finally {
      setInventorySkuRestoreBusy((current) => ({ ...current, [item.sku]: false }));
    }
  };

  const handleInventoryApprovalDecision = async (event, approval, decision) => {
    event.preventDefault();
    const id = String(approval._id);
    setInventoryApprovalBusy((current) => ({ ...current, [id]: true }));
    try {
      if (decision === 'approve') {
        await adminService.approveInventoryAdjustment(id);
        showNotice('Inventory adjustment approved and applied.');
      } else {
        const reason = String(inventoryApprovalReasons[id] || '').trim();
        if (reason.length < 5) {
          showNotice('Enter a rejection reason of at least five characters.', 'error');
          return;
        }
        await adminService.rejectInventoryAdjustment(id, reason);
        showNotice('Inventory adjustment rejected. Stock was not changed.');
      }
      setInventoryRefreshKey((current) => current + 1);
    } catch (error) {
      showNotice(error.response?.data?.message || error.message || 'The inventory approval could not be updated.', 'error');
    } finally {
      setInventoryApprovalBusy((current) => ({ ...current, [id]: false }));
    }
  };

  const handleInventoryReceiptCreate = async (event) => {
    event.preventDefault();
    const item = getInventoryReceiptTargetOptions(products)
      .find((target) => target.value === inventoryReceiptDraft.target);
    const expectedQuantity = Number(inventoryReceiptDraft.expectedQuantity);
    const unitCostPaise = inventoryReceiptDraft.unitCostPaise === ''
      ? undefined
      : Number(inventoryReceiptDraft.unitCostPaise);
    if (!item || !Number.isSafeInteger(expectedQuantity) || expectedQuantity < 1 || expectedQuantity > 100000 ||
      (unitCostPaise !== undefined && (!Number.isSafeInteger(unitCostPaise) || unitCostPaise < 0))) {
      showNotice('Choose an inventory SKU and enter valid expected quantity and optional cost in paise.', 'error');
      return;
    }

    const requestDetails = [
      inventoryReceiptDraft.expectedDate,
      inventoryReceiptDraft.reference.trim(),
      unitCostPaise === undefined ? '' : String(unitCostPaise)
    ].join('|');
    const idempotencyKey = getInventoryRequestKey(
      `receipt:${item.sku || item.productId}`,
      expectedQuantity,
      requestDetails || 'inbound receipt',
      window.sessionStorage,
      () => crypto.randomUUID()
    );
    setInventoryReceiptSubmitting(true);
    try {
      const { data } = await adminService.createInventoryInbound({
        productId: item.productId,
        ...(item.sku ? { sku: item.sku } : {}),
        expectedQuantity,
        ...(inventoryReceiptDraft.expectedDate ? { expectedDate: inventoryReceiptDraft.expectedDate } : {}),
        reference: inventoryReceiptDraft.reference.trim(),
        ...(unitCostPaise === undefined ? {} : { unitCostPaise })
      }, idempotencyKey);
      try {
        clearInventoryRequestKey(`receipt:${item.sku || item.productId}`, idempotencyKey, window.sessionStorage);
      } catch (storageError) {
        showNotice(`Receipt was saved, but the retry key could not be cleared: ${storageError.message}. Do not repeat this receipt.`, 'error');
        setInventoryRefreshKey((current) => current + 1);
        return;
      }
      setInventoryReceiptDraft({
        target: '',
        expectedQuantity: '',
        expectedDate: '',
        reference: '',
        unitCostPaise: ''
      });
      showNotice(data.message || 'Inbound receipt created.');
      setInventoryRefreshKey((current) => current + 1);
    } catch (error) {
      showNotice(error.response?.data?.message || error.message || 'Inbound receipt could not be created.', 'error');
    } finally {
      setInventoryReceiptSubmitting(false);
    }
  };

  const handleInventoryReceiptReceive = async (event, receipt) => {
    event.preventDefault();
    const id = String(receipt._id);
    const draft = inventoryReceiveDrafts[id] || {};
    const quantities = {
      receivedQuantity: Number(draft.receivedQuantity || 0),
      damagedQuantity: Number(draft.damagedQuantity || 0),
      rejectedQuantity: Number(draft.rejectedQuantity || 0),
      cancelledQuantity: Number(draft.cancelledQuantity || 0),
      cancellationReason: String(draft.cancellationReason || '').trim()
    };
    const enteredQuantities = [
      quantities.receivedQuantity,
      quantities.damagedQuantity,
      quantities.rejectedQuantity,
      quantities.cancelledQuantity
    ];
    const quantityTotal = quantities.receivedQuantity + quantities.damagedQuantity +
      quantities.rejectedQuantity + quantities.cancelledQuantity;
    const remaining = Number(receipt.expectedQuantity || 0) -
      Number(receipt.receivedQuantity || 0) -
      Number(receipt.damagedQuantity || 0) -
      Number(receipt.rejectedQuantity || 0) -
      Number(receipt.cancelledQuantity || 0);
    if (enteredQuantities.some((quantity) => !Number.isSafeInteger(quantity) || quantity < 0) ||
      !Number.isSafeInteger(quantityTotal) || quantityTotal > remaining) {
      showNotice('Receipt quantities must be non-negative whole numbers within the remaining expected units.', 'error');
      return;
    }
    if (quantityTotal < 1) {
      showNotice('Enter at least one accepted, damaged, rejected, or cancelled unit.', 'error');
      return;
    }
    const target = `receipt-event:${id}`;
    const idempotencyKey = getInventoryRequestKey(
      target,
      quantityTotal,
      JSON.stringify(quantities),
      window.sessionStorage,
      () => crypto.randomUUID()
    );
    setInventoryReceiveSubmitting((current) => ({ ...current, [id]: true }));
    try {
      const { data } = await adminService.receiveInventoryInbound(id, quantities, idempotencyKey);
      try {
        clearInventoryRequestKey(target, idempotencyKey, window.sessionStorage);
      } catch (storageError) {
        showNotice(`Receipt was recorded, but the retry key could not be cleared: ${storageError.message}. Do not repeat this receipt.`, 'error');
        setInventoryRefreshKey((current) => current + 1);
        return;
      }
      showNotice(data.message || 'Receipt quantities recorded.');
      setInventoryRefreshKey((current) => current + 1);
    } catch (error) {
      showNotice(error.response?.data?.message || error.message || 'Receipt quantities could not be recorded.', 'error');
    } finally {
      setInventoryReceiveSubmitting((current) => ({ ...current, [id]: false }));
    }
  };

  const handleVerifiedUnitCost = async (event) => {
    event.preventDefault();
    const sku = String(inventoryUnitCostDraft.sku || '').trim().toUpperCase();
    const unitCost = Number(inventoryUnitCostDraft.unitCost);
    const costedQuantity = Number(inventoryUnitCostDraft.costedQuantity);
    if (!sku || !Number.isFinite(unitCost) || unitCost < 0 ||
      !Number.isSafeInteger(costedQuantity) || costedQuantity < 0 ||
      String(inventoryUnitCostDraft.reason || '').trim().length < 5) {
      showNotice('Enter a SKU, verified cost in rupees, costed quantity, and audit reason.', 'error');
      return;
    }
    try {
      await adminService.updateVerifiedUnitCost(sku, {
        unitCost,
        costedQuantity,
        reason: inventoryUnitCostDraft.reason.trim()
      });
      showNotice('Verified unit cost saved.');
      setInventoryRefreshKey((current) => current + 1);
    } catch (error) {
      showNotice(error.response?.data?.message || 'Verified unit cost could not be saved.', 'error');
    }
  };

  const handleInventoryStocktakePreview = async (event) => {
    event.preventDefault();
    if (!inventoryStocktakeDraft.productId || !Number.isSafeInteger(Number(inventoryStocktakeDraft.countedQuantity))) {
      showNotice('Select a product and enter a whole counted quantity.', 'error');
      return;
    }
    try {
      const { data } = await adminService.previewInventoryStocktake(inventoryStocktakeDraft.productId, {
        sku: inventoryStocktakeDraft.sku,
        countedQuantity: Number(inventoryStocktakeDraft.countedQuantity)
      });
      showNotice(`Stocktake preview: ${data.preview.variance > 0 ? '+' : ''}${data.preview.variance} units variance.`);
    } catch (error) {
      showNotice(error.response?.data?.message || 'Stocktake preview could not be loaded.', 'error');
    }
  };

  const handleInventoryCsvPreview = async () => {
    if (!inventoryCsvText.trim()) {
      showNotice('Paste inventory CSV content to preview.', 'error');
      return;
    }
    try {
      const { data } = await adminService.previewInventoryCsvImport(inventoryCsvText);
      setInventoryCsvPreview(data.preview);
      showNotice(`CSV preview: ${data.preview.validRows} valid, ${data.preview.invalidRows} invalid.`);
    } catch (error) {
      showNotice(error.response?.data?.message || 'CSV preview failed.', 'error');
    }
  };

  const handleInventoryAdjustment = async (event, item) => {
    event.preventDefault();
    if (!isInventoryPolicyValid(inventoryPolicy)) {
      showNotice('Inventory policy is unavailable. Reload the inventory section before adjusting stock.', 'error');
      return;
    }
    const key = item.sku || item.productId;
    if (inventoryRequestLocks.current.has(key)) return;
    const draft = inventoryDrafts[key] || {};
    const delta = Number(draft.delta);
    if (!Number.isSafeInteger(delta) || delta === 0 || !draft.reason?.trim()) {
      showNotice('Enter a non-zero whole-number adjustment and a reason.', 'error');
      return;
    }

    inventoryRequestLocks.current.add(key);
    setInventorySubmitting((current) => ({ ...current, [key]: true }));
    try {
      const idempotencyKey = getInventoryRequestKey(
        String(key),
        delta,
        draft.reason.trim(),
        window.sessionStorage,
        () => crypto.randomUUID()
      );
      setInventoryDrafts((current) => ({
        ...current,
        [key]: { ...(current[key] || {}), idempotencyKey }
      }));
      const { data } = await adminService.adjustInventory({
        adjustments: [{ ...(item.sku ? { sku: item.sku } : { productId: item.productId }), delta }],
        reason: draft.reason.trim(),
        notes: String(draft.notes || '').trim(),
        enhancedConfirmed: requiresEnhancedInventoryConfirmation(delta, inventoryPolicy) && draft.enhancedConfirmed === true
      }, idempotencyKey);
      try {
        clearInventoryRequestKey(String(key), idempotencyKey, window.sessionStorage);
      } catch (storageError) {
        showNotice(`Inventory was saved, but the retry key could not be cleared: ${storageError.message}. Do not repeat this adjustment.`, 'error');
        setInventoryDrafts((current) => ({ ...current, [key]: { delta: '', reason: '' } }));
        closeInventoryDrawer();
        setInventoryRefreshKey((current) => current + 1);
        return;
      }
      setInventoryDrafts((current) => ({ ...current, [key]: { delta: '', reason: '' } }));
      showNotice(data.approval
        ? `Adjustment submitted for ${data.approval.approvalLevel === 'owner' ? 'Owner' : 'Admin'} approval. Stock was not changed.`
        : `Inventory updated for ${item.sku || item.productName}.`);
      closeInventoryDrawer();
      setInventoryRefreshKey((current) => current + 1);
    } catch (err) {
      showNotice(err.response?.data?.message || 'Inventory adjustment failed.', 'error');
    } finally {
      inventoryRequestLocks.current.delete(key);
      setInventorySubmitting((current) => ({ ...current, [key]: false }));
    }
  };

  const handleAdminProfileSave = async (event) => {
    event.preventDefault();
    try {
      const res = await authService.updateProfile(profileForm);
      if (!res.data.success || !res.data.user) {
        showNotice(res.data.message || 'Admin profile update failed.', 'error');
        return;
      }
      updateUser(res.data.user);
      showNotice('Admin profile updated.');
    } catch (err) {
      showNotice(err.response?.data?.message || 'Admin profile update failed.', 'error');
    }
  };

  const handleAdminPasswordChange = async (event) => {
    event.preventDefault();
    try {
      const res = await authService.changePassword(passwordForm);
      if (!res.data.success) {
        showNotice(res.data.message || 'Password update failed.', 'error');
        return;
      }
      setPasswordForm({ currentPassword: '', newPassword: '' });
      window.alert(res.data.message || 'Password changed. Please sign in again.');
      logout();
      navigate('/login');
    } catch (err) {
      showNotice(err.response?.data?.message || 'Password update failed.', 'error');
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const handleSupportTicketCreate = async (event) => {
    event.preventDefault();
    setSupportSubmitting(true);
    setSupportError('');
    try {
      const { data } = await supportService.createTicket({
        ...supportForm,
        customerId: supportForm.customerId || undefined,
        orderId: supportForm.orderId || undefined
      });
      setSupportForm({ customerId: '', orderId: '', subject: '', message: '', priority: 'Normal' });
      setSupportPage(1);
      setSelectedSupportTicketId(data.ticket._id);
      setSelectedSupportTicket(data.ticket);
      setSupportEdit({ status: data.ticket.status, priority: data.ticket.priority, assignedTo: data.ticket.assignedTo?._id || '' });
      setSupportRefreshKey((key) => key + 1);
    } catch (error) {
      setSupportError(error.response?.data?.message || 'The support ticket could not be created.');
    } finally {
      setSupportSubmitting(false);
    }
  };

  const handleSupportTicketUpdate = async (event) => {
    event.preventDefault();
    if (!selectedSupportTicket) return;
    setSupportSubmitting(true);
    setSupportError('');
    try {
      const payload = {
        ...supportEdit,
        assignedTo: supportEdit.assignedTo || null,
        ...(supportInternalNote.trim() ? { internalNote: supportInternalNote.trim() } : {})
      };
      const { data } = await supportService.updateTicket(selectedSupportTicket._id, payload);
      setSelectedSupportTicket(data.ticket);
      setSupportEdit({
        status: data.ticket.status,
        priority: data.ticket.priority,
        assignedTo: data.ticket.assignedTo?._id || ''
      });
      setSupportInternalNote('');
      setSupportRefreshKey((key) => key + 1);
    } catch (error) {
      setSupportError(error.response?.data?.message || 'The support ticket could not be updated.');
    } finally {
      setSupportSubmitting(false);
    }
  };

  const handleSupportReply = async (event) => {
    event.preventDefault();
    if (!selectedSupportTicket) return;
    setSupportSubmitting(true);
    setSupportError('');
    try {
      const { data } = await supportService.addReply(selectedSupportTicket._id, supportReply);
      setSelectedSupportTicket(data.ticket);
      setSupportReply('');
      setSupportRefreshKey((key) => key + 1);
    } catch (error) {
      setSupportError(error.response?.data?.message || 'The reply could not be added.');
    } finally {
      setSupportSubmitting(false);
    }
  };

  const filteredProducts = useMemo(
    () => filterAndSortAdminProducts(products, productListFilters),
    [products, productListFilters]
  );
  const productPagination = useMemo(
    () => paginateAdminProducts(filteredProducts, productListPage),
    [filteredProducts, productListPage]
  );
  const productCategories = useMemo(
    () => [...new Set(products.map((product) => String(product.category || '').trim()).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right)),
    [products]
  );
  const productCollections = useMemo(
    () => [...new Set(products.map((product) => String(product.collectionName || product.collection || '').trim()).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right)),
    [products]
  );
  const hasProductListFilters = Object.entries(productListFilters)
    .some(([key, value]) => value !== initialProductListFilters[key]);
  const editingCategory = categories.find((category) => category._id === editingCategoryId);
  const categoryNameReadOnly = Boolean(editingCategoryId && !canRenameCategory(editingCategory?.slug));
  const formColourNames = productForm.colours.split(',').map((value) => value.trim()).filter(Boolean);
  const editingVariantProduct = products.find((product) => product._id === editingId);
  const variantStockLocked = Boolean(editingVariantProduct?.variants?.length);
  const variantStockTotal = productForm.variants.reduce((total, variant) => total + Number(variant.stock || 0), 0);

  const metricCards = [
    ['Total Products', getMetricDisplayValue(stats.totalProducts, statsStatus)],
    ['Total Orders', getMetricDisplayValue(stats.totalOrders, statsStatus)],
    ['Total Customers', getMetricDisplayValue(stats.totalCustomers, statsStatus)],
    ['Total Revenue', statsStatus === 'loaded' ? formatInr(stats.totalRevenue) : getMetricDisplayValue(null, statsStatus)],
    ['Pending Orders', getMetricDisplayValue(stats.pendingOrders, statsStatus)],
    ['Low Stock Products', getMetricDisplayValue(stats.lowStockProducts, statsStatus)]
  ];
  const reportMetricCards = [
    { key: 'orders', label: 'Orders', format: (value) => String(value) },
    { key: 'revenue', label: 'Revenue', format: (value) => formatInr(value) },
    { key: 'unitsSold', label: 'Units sold', format: (value) => String(value) },
    { key: 'averageOrderValue', label: 'Average order value', format: (value) => formatInr(value) },
    { key: 'newCustomers', label: 'New customers', format: (value) => String(value) }
  ];
  const reportChartMaxRevenue = Math.max(
    ...(report?.chartData || []).flatMap((row) => [row.current.revenue || 0, row.previous.revenue || 0]),
    1
  );
  const renderReportingSummary = () => (
    <section className="space-y-4" aria-label="Period comparison">
      <div className={panelClass}>
        <div className="admin-reporting-header">
          <div>
            <h2 className="text-sm font-semibold text-[#2a2724]">Performance comparison</h2>
            <p className="mt-1 text-xs text-[#7d7267]">
              {reportStatus === 'loaded' && report
                ? `Updated through ${formatUpdatedThrough(report.asOf, reportingTimeZone)}`
                : 'Compare commerce performance with the previous period.'}
            </p>
          </div>
          <div className="admin-reporting-controls">
            <AdminSelect
              label="Reporting period"
              value={reportPeriod}
              options={['today', 'last7days', 'last30days', 'last90days'].map((period) => ({
                value: period,
                label: getDashboardPeriodLabel(period)
              }))}
              onChange={setReportPeriod}
            />
            <AdminSelect
              label="Time zone"
              value={reportingTimeZone}
              options={[
                { value: 'Asia/Kolkata', label: 'Asia/Kolkata' },
                { value: 'Europe/London', label: 'Europe/London' }
              ]}
              onChange={handleReportingTimeZoneChange}
              disabled={reportingPreferenceSaving}
            />
            <button
              type="button"
              className="admin-button admin-button--secondary"
              onClick={handleDashboardReportExport}
              disabled={reportStatus !== 'loaded' || reportExporting}
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              {reportExporting ? 'Exporting…' : 'Export CSV'}
            </button>
          </div>

        </div>
      </div>
      {reportError && <p role="alert" className="admin-reporting-error">{reportError}</p>}
      {reportStatus === 'loading' && <p role="status" className="admin-empty-state">Loading period report…</p>}
      {reportStatus === 'error' && <p role="alert" className="admin-reporting-error">Period reporting is unavailable. Try changing the period or reload the dashboard.</p>}
      {reportStatus === 'loaded' && report && (
        <div className="admin-reporting-kpi-grid">
          {reportMetricCards.map(({ key, label, format }) => {
            const comparison = getComparisonPresentation(report.comparisons[key]);
            return (
              <article key={key} className="admin-metric-card admin-reporting-kpi">
                <div className="admin-metric-card__label">{label}</div>
                <div className="admin-metric-card__value">{format(report.current[key])}</div>
                <span
                  className={`admin-reporting-kpi__change admin-reporting-kpi__change--${comparison.direction}`}
                  aria-label={comparison.ariaLabel}
                >
                  {comparison.text}
                </span>
                <p className="admin-reporting-kpi__previous">Previous: {format(report.previous[key])}</p>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
  const activeSectionLabel = getAdminSectionLabel(activeSection);
  const inputClass = 'admin-input';
  const panelClass = 'admin-panel';
  const renderStandaloneSection = ({ id, label }) => {
    const Icon = sectionIcons[id];
    return (
      <button
        key={id}
        type="button"
        onClick={() => {
          setActiveSection(id);
          dispatchNavigation({ type: 'navigate' });
        }}
        aria-current={activeSection === id ? 'page' : undefined}
        className={`admin-nav__button ${activeSection === id ? 'admin-nav__button--active' : ''}`}
      >
        <Icon className="w-4 h-4 flex-shrink-0" />
        <span>{label}</span>
      </button>
    );
  };

  return (
    <div className="admin-shell">
      <div className="admin-shell__inner">
        <div className="admin-shell__layout">
          <aside id="admin-navigation" className={`admin-sidebar ${navigationState.isOpen ? 'admin-sidebar--open' : ''}`} aria-label="Admin navigation">
            <div className="admin-brand">
              <div className="admin-brand__mark">Y</div>
              <div>
                <div className="admin-brand__title">Atelier</div>
                <div className="admin-brand__name">YAQANA</div>
              </div>
              <button
                type="button"
                className="admin-sidebar__close"
                onClick={() => dispatchNavigation({ type: 'close' })}
                aria-label="Close admin navigation"
              >
                <X aria-hidden="true" />
              </button>
            </div>

            <nav aria-label="Admin sections" className="admin-nav">
              {ADMIN_STANDALONE_SECTIONS
                .filter(({ placement }) => placement === 'top')
                .map(renderStandaloneSection)}

              {ADMIN_SECTION_GROUPS.map((group) => {
                const isExpanded = navigationState.expandedGroups[group.id];
                const groupPanelId = `admin-nav-group-${group.id}`;
                return (
                  <div key={group.id} className="admin-nav-group">
                    <button
                      type="button"
                      className="admin-nav-group__toggle"
                      aria-expanded={isExpanded}
                      aria-controls={groupPanelId}
                      onClick={() => dispatchNavigation({ type: 'toggle-group', groupId: group.id })}
                    >
                      <span>{group.label}</span>
                      <ChevronDown aria-hidden="true" />
                    </button>
                    <div
                      id={groupPanelId}
                      className="admin-nav-group__items"
                      role="group"
                      aria-label={`${group.label} sections`}
                      hidden={!isExpanded}
                    >
                      {group.sections.map(({ id, label }) => {
                        const Icon = sectionIcons[id];
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={() => {
                              setActiveSection(id);
                              dispatchNavigation({ type: 'navigate', groupId: group.id });
                            }}
                            aria-current={activeSection === id ? 'page' : undefined}
                            className={`admin-nav__button admin-nav__button--nested ${activeSection === id ? 'admin-nav__button--active' : ''}`}
                          >
                            <Icon className="w-4 h-4 flex-shrink-0" />
                            <span>{label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {ADMIN_STANDALONE_SECTIONS
                .filter(({ placement }) => placement === 'bottom')
                .map(renderStandaloneSection)}

              <button
                type="button"
                onClick={() => {
                  navigate('/admin/security');
                  dispatchNavigation({ type: 'close' });
                }}
                className="admin-nav__button"
              >
                <ShieldCheck className="w-4 h-4 flex-shrink-0" />
                <span>Security &amp; Authenticator</span>
              </button>


              <div className="admin-sidebar__signature" aria-hidden="true">
                <span className="admin-sidebar__signature-label">YAQANA / ATELIER</span>
                <p>Modern menswear.<br />Timeless confidence.</p>
              </div>

              <div className="admin-nav__logout">
                <button type="button" onClick={handleLogout} className="admin-nav__button">
                  <LogOut className="w-4 h-4 flex-shrink-0" />
                  <span>Logout</span>
                </button>
              </div>
            </nav>
          </aside>

          {navigationState.isOpen && (
            <button
              type="button"
              className="admin-sidebar-backdrop"
              aria-label="Close admin navigation"
              onClick={() => dispatchNavigation({ type: 'close' })}
            />
          )}

          <main className="admin-main">
            <header className="admin-header">
              <div className="admin-header__heading">
                <button
                  type="button"
                  className="admin-menu-toggle"
                  onClick={() => dispatchNavigation({ type: 'toggle' })}
                  aria-expanded={navigationState.isOpen}
                  aria-controls="admin-navigation"
                  aria-label={navigationState.isOpen ? 'Close admin navigation' : 'Open admin navigation'}
                >
                  {navigationState.isOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
                </button>
                <div>
                  <nav className="admin-header__breadcrumb" aria-label="Breadcrumb">
                    <span>Management</span>
                    <span aria-hidden="true">/</span>
                    <span aria-current="page">{activeSectionLabel}</span>
                  </nav>
                  <h1 className="admin-header__title">{activeSectionLabel}</h1>
                </div>
              </div>
              <AdminGlobalSearch onSelect={handleGlobalSearchSelect} />
              <AdminNotificationCenter onSelect={handleGlobalSearchSelect} />
              <div className="admin-header__meta">
                <div className="admin-user-pill">{user?.name || 'Administrator'}</div>
                <div className="text-xs text-[#7d7267]">{user?.email || 'admin@yaqana.local'}</div>
              </div>
            </header>

            {loading && <div role="status" className="mb-4 text-sm text-xora-taupe-dark">Loading admin data…</div>}
            {notice && (
              <div role={noticeType === 'error' ? 'alert' : 'status'} className={`mb-6 rounded-xl border px-4 py-3 text-xs ${noticeType === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
                {notice}
              </div>
            )}

            <div className="admin-section">
              {activeSection === 'dashboard' && (
                <section aria-label="Dashboard overview">
                  {renderReportingSummary()}
                  <div className="admin-metric-grid">
                    {metricCards.map(([label, value]) => (
                      <div key={label} className="admin-metric-card">
                        <div className="admin-metric-card__label">{label}</div>
                        <div className="admin-metric-card__value">{value}</div>
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mt-6">
                    <div className={panelClass}>
                      <div className="admin-panel-header">
                        <h2>Recent Orders</h2>
                      </div>
                      <div className="admin-row-list">
                        {recentOrders.map((order) => (
                          <div key={order._id} className="admin-row-item">
                            <div className="admin-row-copy">
                              <strong>{order.customer?.name || 'Customer'}</strong>
                              <span>{order.orderStatus} · {order.paymentMethod}</span>
                            </div>
                            <span className="font-medium text-xs text-xora-charcoal">{formatInr(order.total)}</span>
                          </div>
                        ))}
                        {recentOrders.length === 0 && <p className="admin-empty-state">No orders yet.</p>}
                      </div>
                    </div>

                    <div className={panelClass}>
                      <div className="admin-panel-header">
                        <h2>Inventory Attention</h2>
                      </div>
                      <div className="admin-row-list">
                        {products.filter((product) => product.active !== false && product.stock <= LOW_STOCK_THRESHOLD).slice(0, 6).map((product) => (
                          <div key={product._id} className="admin-row-item">
                            <div className="admin-row-copy">
                              <strong>{product.name}</strong>
                              <span>{product.category}</span>
                            </div>
                            <span className="text-xs text-amber-800">{getInventoryStatus(product.stock)} · {product.stock}</span>
                          </div>
                        ))}
                        {statsStatus === 'error' && <p className="admin-empty-state">Inventory attention could not be loaded.</p>}
                        {statsStatus === 'loaded' && products.every((product) => product.active === false || product.stock > LOW_STOCK_THRESHOLD) && <p className="admin-empty-state">No low or out-of-stock products.</p>}
                      </div>
                    </div>
                  </div>
                  <div className={`${panelClass} mt-6`}>
                    <div className="admin-panel-header"><h2>Recent Activity</h2></div>
                    <div className="admin-row-list" aria-live="polite">
                      {activityEvents.map((event) => (
                        <button key={event.id} type="button" className="admin-row-item admin-activity-row" disabled={!event.section} onClick={() => {
                          if (!event.section) return;
                          setActiveSection(event.section);
                          if (event.section === 'orders') setOrderSearchInput(event.searchTerm || '');
                          if (event.section === 'products') setProductListFilters((filters) => ({ ...filters, search: event.searchTerm || '' }));
                          if (event.section === 'inventory') setInventorySearchInput(event.searchTerm || '');
                        }}>
                          <span className="admin-row-copy"><strong>{event.title}</strong><span>{event.detail}</span></span>
                          <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString()}</time>
                        </button>
                      ))}
                      {activityStatus === 'loading' && <p className="admin-empty-state" role="status">Loading activity…</p>}
                      {activityStatus === 'error' && <p className="admin-empty-state" role="alert">Recent activity could not be loaded.</p>}
                      {activityStatus === 'loaded' && activityEvents.length === 0 && <p className="admin-empty-state">No recorded activity yet.</p>}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-6 mt-6 xl:grid-cols-3" aria-label="Current period operations">
                    {[
                      { title: 'Order Status', rows: report?.orderStatusBreakdown, label: (row) => row.status },
                      { title: 'Payment Overview', rows: report?.paymentStatusBreakdown, label: (row) => row.status }
                    ].map(({ title, rows = [], label }) => {
                      const maximum = Math.max(1, ...rows.map((row) => row.count));
                      return (
                        <div key={title} className={panelClass}>
                          <div className="admin-panel-header"><h2>{title}</h2></div>
                          {reportStatus === 'loading' && <p className="admin-empty-state" role="status">Loading period data…</p>}
                          {reportStatus === 'error' && <p className="admin-empty-state" role="alert">This breakdown is unavailable.</p>}
                          {reportStatus === 'loaded' && rows.length > 0 && (
                            <ul className="admin-breakdown-list">
                              {rows.map((row) => (
                                <li key={row.status}>
                                  <div className="admin-breakdown-list__label"><span>{label(row)}</span><strong>{row.count}</strong></div>
                                  <div className="admin-breakdown-list__track" aria-hidden="true"><span style={{ width: `${Math.max(4, (row.count / maximum) * 100)}%` }} /></div>
                                </li>
                              ))}
                            </ul>
                          )}
                          {reportStatus === 'loaded' && rows.length === 0 && <p className="admin-empty-state">No records for this period.</p>}
                        </div>
                      );
                    })}
                    <div className={panelClass}>
                      <div className="admin-panel-header"><h2>Best Sellers</h2></div>
                      {reportStatus === 'loading' && <p className="admin-empty-state" role="status">Loading period data…</p>}
                      {reportStatus === 'error' && <p className="admin-empty-state" role="alert">Best sellers are unavailable.</p>}
                      {reportStatus === 'loaded' && report?.bestSellers?.length > 0 && (
                        <ol className="admin-best-sellers">
                          {report.bestSellers.map((product, index) => (
                            <li key={product.productId || `${product.name}-${index}`}>
                              <span className="admin-best-sellers__rank">{index + 1}</span>
                              <span className="admin-row-copy"><strong>{product.name}</strong><span>Paid units sold</span></span>
                              <strong>{product.unitsSold}</strong>
                            </li>
                          ))}
                        </ol>
                      )}
                      {reportStatus === 'loaded' && !report?.bestSellers?.length && <p className="admin-empty-state">No paid sales for this period.</p>}
                    </div>
                  </div>
                </section>
              )}

              {activeSection === 'catalogue' && (
                <section aria-label="Category and collection management" className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                  <div className={panelClass}>
                    <div className="admin-panel-header">
                      <h2>{editingCategoryId ? 'Edit Category' : 'Add Category'}</h2>
                      {editingCategoryId && (
                        <button type="button" onClick={() => { setEditingCategoryId(null); setCategoryForm({ name: '', description: '', image: '' }); }} className="admin-button admin-button--ghost">Cancel</button>
                      )}
                    </div>

                    <form onSubmit={handleCategorySubmit} className="space-y-3">
                      <label className="admin-form-field admin-form-field--full">
                        Name
                        <input className={inputClass} value={categoryForm.name} onChange={(event) => setCategoryForm((form) => ({ ...form, name: event.target.value }))} required maxLength={80} readOnly={categoryNameReadOnly} />
                        {categoryNameReadOnly && <span className="text-[10px] normal-case text-[#7d7267]">Core storefront category names cannot be changed.</span>}
                      </label>
                      <label className="admin-form-field admin-form-field--full">
                        Description
                        <textarea className={`${inputClass} admin-textarea`} value={categoryForm.description} onChange={(event) => setCategoryForm((form) => ({ ...form, description: event.target.value }))} rows="2" maxLength={500} />
                      </label>
                      <label className="admin-form-field admin-form-field--full">
                        Category image URL
                        <input className={inputClass} value={categoryForm.image} onChange={(event) => setCategoryForm((form) => ({ ...form, image: event.target.value }))} maxLength={2048} />
                      </label>
                      <button className="admin-button admin-button--primary w-full" type="submit">{editingCategoryId ? 'Save Category' : 'Add Category'}</button>
                    </form>

                    <div className="mt-6 space-y-2">
                      {categories.map((category) => (
                        <div key={category._id} className="admin-row-item">
                          <div className="admin-row-copy">
                            <strong>{category.name}</strong>
                            <span>{category.itemCount || 0} active products</span>
                          </div>
                          <div className="admin-action-strip">
                            <button type="button" onClick={() => handleCategoryEdit(category)} className="admin-button admin-button--secondary">Edit</button>
                            {canRenameCategory(category.slug) && category.active !== false && (
                              <button type="button" onClick={() => handleCategoryArchive(category)} className="admin-button admin-button--danger">Archive</button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className={`${panelClass} space-y-6`}>
                    <div>
                      <div className="admin-panel-header">
                        <h2>Collections</h2>
                      </div>
                      <p className="text-xs text-[#7d7267] mb-4">Collections are stored independently so an empty collection can be prepared before products are assigned.</p>
                      <form onSubmit={handleCollectionCreate} className="space-y-3">
                        <label className="admin-form-field admin-form-field--full">
                          New collection name
                          <input className={inputClass} value={collectionForm.name} onChange={(event) => setCollectionForm((form) => ({ ...form, name: event.target.value }))} required maxLength={100} />
                        </label>
                        <label className="admin-form-field admin-form-field--full">
                          Description
                          <textarea className={`${inputClass} admin-textarea`} value={collectionForm.description} onChange={(event) => setCollectionForm((form) => ({ ...form, description: event.target.value }))} rows="2" maxLength={500} />
                        </label>
                        <button className="admin-button admin-button--primary w-full" type="submit">Create Collection</button>
                      </form>
                    </div>

                    <form onSubmit={handleCollectionRename} className="space-y-3 border-t border-[#8f8a82]/20 pt-5">
                      <h3 className="font-serif text-xl">Rename Collection</h3>
                      <label className="admin-form-field admin-form-field--full">
                        Collection
                        <select className={inputClass} value={collectionRename.current} onChange={(event) => { const current = event.target.value; const record = collectionRecords.find((item) => item.name === current); setCollectionRename({ current, name: current, description: record?.description || '' }); }} required>
                          <option value="">Choose a collection</option>
                          {collections.map((name) => <option key={name} value={name}>{name}</option>)}
                        </select>
                      </label>
                      <label className="admin-form-field admin-form-field--full">
                        New name
                        <input className={inputClass} value={collectionRename.name} onChange={(event) => setCollectionRename((form) => ({ ...form, name: event.target.value }))} required maxLength={100} />
                      </label>
                      <label className="admin-form-field admin-form-field--full">
                        Description
                        <textarea className={`${inputClass} admin-textarea`} value={collectionRename.description} onChange={(event) => setCollectionRename((form) => ({ ...form, description: event.target.value }))} rows="2" maxLength={500} />
                      </label>
                      <button className="admin-button admin-button--secondary w-full" type="submit" disabled={!collectionRename.current}>Save Collection</button>
                    </form>

                    <div className="border-t border-[#8f8a82]/20 pt-4 space-y-2">
                      {collections.map((name) => (
                        <div key={name} className="admin-row-item">
                          <span className="text-xs text-[#2a2724]">{name}</span>
                          <button type="button" onClick={() => handleCollectionRemove(name)} className="admin-button admin-button--danger">Remove</button>
                        </div>
                      ))}
                      {collections.length === 0 && <p className="admin-empty-state">No collections yet.</p>}
                    </div>
                  </div>
                </section>
              )}

              {activeSection === 'products' && (
                <section aria-label="Product management" className="admin-product-management">
                  <dialog
                    id="admin-product-editor"
                    ref={productEditorDialogRef}
                    className={`${panelClass} admin-product-editor admin-product-editor-dialog`}
                    aria-labelledby="admin-product-editor-title"
                    aria-modal="true"
                    onCancel={handleProductEditorCancel}
                    onKeyDown={handleProductEditorKeyDown}
                  >
                    <div className="admin-panel-header admin-product-editor__header">
                      <div>
                        {editingId ? (
                          <>
                            <span className="admin-product-editor__eyebrow">Editing product</span>
                            <h2 id="admin-product-editor-title">{productForm.name || 'Product details'}</h2>
                          </>
                        ) : <h2 id="admin-product-editor-title">Add Product</h2>}
                      </div>
                      <button
                        type="button"
                        onClick={closeProductEditor}
                        className="admin-button admin-button--ghost admin-product-editor__close"
                        aria-label="Close product editor"
                      >
                        <X aria-hidden="true" />
                      </button>
                    </div>

                    <form
                      onSubmit={handleSubmit}
                      onChangeCapture={() => setProductEditorDirty(true)}
                      className="admin-product-editor__form"
                    >
                      <div className="admin-product-editor__body">
                      {editingId && notice && (
                        <div role={noticeType === 'error' ? 'alert' : 'status'} className={`admin-product-editor__notice ${noticeType === 'error' ? 'admin-product-editor__notice--error' : ''}`}>
                          {notice}
                        </div>
                      )}
                      <label className="admin-form-field admin-form-field--full">
                        Product name
                        <input name="name" value={productForm.name} onChange={handleChange} placeholder="Oversized Linen Shirt" className={inputClass} required />
                      </label>
                      <label className="admin-form-field admin-form-field--full">
                        Description
                        <textarea name="description" value={productForm.description} onChange={handleChange} rows="3" placeholder="Product description" className={`${inputClass} admin-textarea`} required />
                      </label>
                      <label className="admin-form-field admin-form-field--full">
                        Short description
                        <input name="shortDescription" value={productForm.shortDescription} onChange={handleChange} className={inputClass} maxLength={300} />
                      </label>

                      <div className="admin-form-grid">
                        <label className="admin-form-field">
                          Category
                          <select name="category" value={productForm.category} onChange={handleChange} className={inputClass} required>
                            <option value="" disabled>Select an active category</option>
                            {categories.filter((category) => category.active !== false).map((category) => <option key={category._id} value={category.name}>{category.name}</option>)}
                          </select>
                        </label>
                        <label className="admin-form-field">
                          Gender
                          <select name="gender" value={productForm.gender} onChange={handleChange} className={inputClass} required>
                            {productForm.gender === 'women' && <option value="women">Women (legacy)</option>}
                            <option value="men">Men</option>
                            <option value="unisex">Unisex</option>
                          </select>
                        </label>
                      </div>

                      <div className="admin-form-grid">
                        <label className="admin-form-field">
                          Price (₹)
                          <input name="price" type="number" min="0" step="1" value={productForm.price} onChange={handleChange} placeholder="2499" className={inputClass} required />
                        </label>
                        <label className="admin-form-field">
                          Sale price (₹)
                          <input name="discountPrice" type="number" min="0" step="1" value={productForm.discountPrice} onChange={handleChange} placeholder="Optional" className={inputClass} />
                        </label>
                      </div>

                      <div className="admin-form-grid">
                        <label className="admin-form-field">
                          Sizes
                          <input name="sizes" value={productForm.sizes} onChange={handleChange} placeholder="S, M, L, XL" className={inputClass} />
                        </label>
                        {!productForm.variants.length && (
                          <label className="admin-form-field">
                            Stock quantity
                            <input name="stock" type="number" min="0" value={productForm.stock} onChange={handleChange} disabled={Boolean(editingId)} placeholder="25" className={inputClass} />
                            {editingId && <span className="text-xs normal-case text-[#7d7267]">Use Inventory to change stock so the movement is recorded.</span>}
                          </label>
                        )}
                      </div>

                      <label className="admin-form-field admin-form-field--full">
                        Colours
                        <input name="colours" value={productForm.colours} onChange={handleChange} placeholder="Beige, White" className={inputClass} />
                      </label>
                      {formColourNames.length > 0 && (
                        <div className="admin-variant-galleries">
                          <h3 className="text-sm font-semibold">Colour image galleries</h3>
                          {formColourNames.map((colourName) => {
                            const key = colourName.toLowerCase();
                            const existingGallery = products.find((product) => product._id === editingId)?.colours
                              ?.find((colour) => colour.name.toLowerCase() === key)?.images || [];
                            const galleryValue = colourGalleryDraft[key] ?? existingGallery.join('\n');
                            return (
                              <div key={key} className="admin-variant-gallery">
                                <label className="admin-form-field admin-form-field--full">
                                  {colourName} image URLs (one per line; order is gallery order)
                                  <textarea
                                    value={galleryValue}
                                    onChange={(event) => setColourGalleryDraft((current) => ({ ...current, [key]: event.target.value }))}
                                    rows="3"
                                    className={`${inputClass} admin-textarea`}
                                    placeholder="https://... or /uploads/..."
                                  />
                                </label>
                                <label className="admin-form-field admin-form-field--full">
                                  Upload to {colourName} gallery
                                  <input
                                    type="file"
                                    accept="image/jpeg,image/png,image/webp,image/avif"
                                    onChange={(event) => handleColourGalleryUpload(event, colourName)}
                                    disabled={uploadingImage}
                                    className={inputClass}
                                  />
                                </label>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      <div className="admin-variant-matrix">
                        <div className="admin-panel-header">
                          <h3>SKU variant matrix</h3>
                          <button type="button" onClick={generateProductVariants} className="admin-button admin-button--secondary">
                            {productForm.variants.length ? 'Regenerate matrix' : 'Generate matrix'}
                          </button>
                        </div>
                        <p className="text-xs text-[#7d7267]">
                          Every size and colour gets a unique SKU and its own stock count. New combinations start at zero; existing stock and SKUs are preserved.
                        </p>
                        {variantMatrixDirty && <p role="alert" className="text-xs text-red-700">Sizes or colours changed. Regenerate the matrix before saving.</p>}
                        {editingId && !variantStockLocked && productForm.variants.length > 0 && (
                          <p className="text-xs text-amber-800">Existing aggregate stock is {productForm.stock}; allocate that exact total across the new SKUs before converting.</p>
                        )}
                        {productForm.variants.length > 0 && (
                          <>
                            <div className="admin-variant-table-wrap">
                                  <table className="admin-variant-table">
                                    <thead><tr><th>Size</th><th>Colour</th><th>SKU</th><th>Barcode</th><th>Price (₹)</th><th>Sale price (₹)</th><th>Status</th><th>Images</th><th>Stock</th></tr></thead>
                                    <tbody>
                                      {productForm.variants.map((variant, index) => {
                                        const existingVariant = editingVariantProduct?.variants?.find((entry) =>
                                          entry.size.toLowerCase() === variant.size.toLowerCase() &&
                                          entry.colour.toLowerCase() === variant.colour.toLowerCase()
                                        );
                                        return (
                                        <tr key={`${variant.size}-${variant.colour}`}>
                                      <td>{variant.size}</td>
                                      <td>{variant.colour}</td>
                                          <td>
                                            <input
                                              aria-label={`${variant.size} ${variant.colour} SKU`}
                                              className={inputClass}
                                              value={variant.sku}
                                              readOnly={Boolean(existingVariant)}
                                              onChange={(event) => setProductForm((form) => ({
                                                ...form,
                                                variants: form.variants.map((entry, entryIndex) => entryIndex === index
                                                  ? { ...entry, sku: event.target.value }
                                                  : entry)
                                              }))}
                                            />
                                          </td>
                                          <td>
                                            <input
                                              aria-label={`${variant.size} ${variant.colour} barcode`}
                                              className={inputClass}
                                              value={variant.barcode || ''}
                                              onChange={(event) => setProductForm((form) => ({
                                                ...form,
                                                variants: form.variants.map((entry, entryIndex) => entryIndex === index
                                                  ? { ...entry, barcode: event.target.value }
                                                  : entry)
                                              }))}
                                            />
                                          </td>
                                          <td>
                                            <input
                                              aria-label={`${variant.size} ${variant.colour} price`}
                                              className={inputClass}
                                              type="number"
                                              min="0"
                                              step="0.01"
                                              value={variant.pricePaise == null ? '' : Number(variant.pricePaise) / 100}
                                              onChange={(event) => setProductForm((form) => ({
                                                ...form,
                                                variants: form.variants.map((entry, entryIndex) => entryIndex === index
                                                  ? { ...entry, pricePaise: event.target.value === '' ? null : Math.round(Number(event.target.value) * 100) }
                                                  : entry)
                                              }))}
                                            />
                                          </td>
                                          <td>
                                            <input
                                              aria-label={`${variant.size} ${variant.colour} sale price`}
                                              className={inputClass}
                                              type="number"
                                              min="0"
                                              step="0.01"
                                              value={variant.discountPricePaise == null ? '' : Number(variant.discountPricePaise) / 100}
                                              onChange={(event) => setProductForm((form) => ({
                                                ...form,
                                                variants: form.variants.map((entry, entryIndex) => entryIndex === index
                                                  ? { ...entry, discountPricePaise: event.target.value === '' ? null : Math.round(Number(event.target.value) * 100) }
                                                  : entry)
                                              }))}
                                            />
                                          </td>
                                          <td>
                                            <select
                                              aria-label={`${variant.size} ${variant.colour} status`}
                                              className={inputClass}
                                              value={variant.status || 'active'}
                                              onChange={(event) => setProductForm((form) => ({
                                                ...form,
                                                variants: form.variants.map((entry, entryIndex) => entryIndex === index
                                                  ? { ...entry, status: event.target.value }
                                                  : entry)
                                              }))}
                                            >
                                              <option value="active">Active</option>
                                              <option value="inactive">Inactive</option>
                                              <option value="discontinued">Discontinued</option>
                                            </select>
                                          </td>
                                          <td>
                                            <input
                                              aria-label={`${variant.size} ${variant.colour} image URLs`}
                                              className={inputClass}
                                              value={Array.isArray(variant.images) ? variant.images.join(', ') : variant.images || ''}
                                              onChange={(event) => setProductForm((form) => ({
                                                ...form,
                                                variants: form.variants.map((entry, entryIndex) => entryIndex === index
                                                  ? { ...entry, images: event.target.value }
                                                  : entry)
                                              }))}
                                            />
                                          </td>
                                      <td>
                                        <input
                                          aria-label={`${variant.size} ${variant.colour} stock`}
                                          className={inputClass}
                                          type="number"
                                          min="0"
                                          step="1"
                                          value={variant.stock}
                                          disabled={variantStockLocked}
                                          onChange={(event) => setProductForm((form) => ({
                                            ...form,
                                            variants: form.variants.map((entry, entryIndex) => entryIndex === index
                                              ? { ...entry, stock: Number(event.target.value) }
                                              : entry)
                                          }))}
                                        />
                                      </td>
                                    </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                            <p className="text-xs font-medium text-[#2a2724]">SKU count: {productForm.variants.length} · Total stock: {variantStockTotal}</p>
                          </>
                        )}
                      </div>
                      <label className="admin-form-field admin-form-field--full">
                        Product image URL(s)
                        <input name="images" value={productForm.images} onChange={handleChange} placeholder="https://..." className={inputClass} />
                      </label>
                      <label className="admin-form-field admin-form-field--full">
                        Upload product image
                        <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={handleProductImageUpload} disabled={uploadingImage} className={inputClass} />
                        <span className="mt-1 block text-[10px] normal-case text-[#7d7267]">{uploadingImage ? 'Uploading image…' : 'JPG, PNG, WebP or AVIF; maximum 5 MB.'}</span>
                      </label>
                      <label className="admin-form-field admin-form-field--full">
                        Collection name
                        <select name="collection" value={productForm.collection} onChange={handleChange} className={inputClass}>
                          <option value="">No collection</option>
                          {!collections.includes(productForm.collection) && productForm.collection && <option value={productForm.collection}>{productForm.collection} (existing)</option>}
                          {collections.map((collection) => <option key={collection} value={collection}>{collection}</option>)}
                        </select>
                      </label>
                      <label className="admin-form-field admin-form-field--full">
                        Materials
                        <textarea name="fabricDetails" value={productForm.fabricDetails} onChange={handleChange} rows="2" className={`${inputClass} admin-textarea`} />
                      </label>
                      <label className="admin-form-field admin-form-field--full">
                        Fit / style information
                        <textarea name="fitDetails" value={productForm.fitDetails} onChange={handleChange} rows="2" className={`${inputClass} admin-textarea`} />
                      </label>
                      <label className="admin-form-field admin-form-field--full">
                        Care instructions
                        <textarea name="careInstructions" value={productForm.careInstructions} onChange={handleChange} rows="2" className={`${inputClass} admin-textarea`} />
                      </label>
                      <label className="admin-form-field admin-form-field--full">
                        Garment measurements by size (JSON)
                        <textarea name="measurements" value={productForm.measurements} onChange={handleChange} rows="4" placeholder={'{"M":{"chest":102,"length":70}}'} className={`${inputClass} admin-textarea font-mono`} />
                      </label>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px] uppercase tracking-wider text-[#2a2724]">
                        <label className="flex items-center gap-2"><input type="checkbox" name="featured" checked={productForm.featured} onChange={handleChange} /> Featured</label>
                        <label className="flex items-center gap-2"><input type="checkbox" name="newArrival" checked={productForm.newArrival} onChange={handleChange} /> New</label>
                        <label className="flex items-center gap-2"><input type="checkbox" name="bestSeller" checked={productForm.bestSeller} onChange={handleChange} /> Best</label>
                      </div>
                      <label className="admin-form-field admin-form-field--full">
                        Product status
                        <select name="status" value={productForm.status} onChange={handleChange} className={inputClass}>
                          <option value="draft">Draft — not visible in the storefront</option>
                          <option value="active">Active — published</option>
                          <option value="archived">Archived — hidden, retained for records</option>
                          <option value="discontinued">Discontinued — no longer sold</option>
                        </select>
                      </label>

                      </div>
                      <div className="admin-product-editor__footer">
                        <button type="button" onClick={closeProductEditor} className="admin-button admin-button--secondary">
                          Cancel
                        </button>
                        <button type="submit" disabled={uploadingImage || variantMatrixDirty} className="admin-button admin-button--primary">
                        {editingId ? <PenSquare className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                        {editingId ? 'Save Changes' : 'Add Product'}
                        </button>
                      </div>
                    </form>
                  </dialog>

                  <div className={`${panelClass} admin-product-list-panel`}>
                    <div className="admin-panel-header">
                      <h2>Products ({products.length})</h2>
                      <div className="admin-product-list-panel__actions">
                        <label className="relative block admin-product-list-panel__search-field">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#7d7267]" />
                          <input
                            type="search"
                            aria-label="Search products by name, category, collection, or SKU"
                            value={productListFilters.search}
                            onChange={(event) => updateProductListFilter('search', event.target.value)}
                            placeholder="Search products"
                            className={`${inputClass} admin-product-list-panel__search-input`}
                          />
                        </label>
                        <button
                          type="button"
                          onClick={openNewProductEditor}
                          aria-haspopup="dialog"
                          aria-controls="admin-product-editor"
                          className="admin-button admin-button--primary admin-button--compact"
                        >
                          <Plus aria-hidden="true" className="w-4 h-4" />
                          <span>Add Product</span>
                        </button>
                      </div>
                    </div>

                    <div className="admin-product-filters" role="group" aria-label="Product filters">
                      <label className="admin-product-filter">
                        Category
                        <select
                          aria-label="Category filter"
                          className={inputClass}
                          value={productListFilters.category}
                          onChange={(event) => updateProductListFilter('category', event.target.value)}
                        >
                          <option value="all">All categories</option>
                          {productCategories.map((category) => <option key={category} value={category}>{category}</option>)}
                        </select>
                      </label>
                      <label className="admin-product-filter">
                        Collection
                        <select
                          aria-label="Collection filter"
                          className={inputClass}
                          value={productListFilters.collection}
                          onChange={(event) => updateProductListFilter('collection', event.target.value)}
                        >
                          <option value="all">All collections</option>
                          {productCollections.map((collection) => <option key={collection} value={collection}>{collection}</option>)}
                        </select>
                      </label>
                      <label className="admin-product-filter">
                        Stock
                        <select
                          aria-label="Stock filter"
                          className={inputClass}
                          value={productListFilters.stock}
                          onChange={(event) => updateProductListFilter('stock', event.target.value)}
                        >
                          <option value="all">All stock</option>
                          <option value="in-stock">In stock</option>
                          <option value="low-stock">Low stock</option>
                          <option value="out-of-stock">Out of stock</option>
                        </select>
                      </label>
                      <label className="admin-product-filter">
                        Status
                        <select
                          aria-label="Status filter"
                          className={inputClass}
                          value={productListFilters.status}
                          onChange={(event) => updateProductListFilter('status', event.target.value)}
                        >
                          <option value="all">All statuses</option>
                          <option value="active">Active</option>
                          <option value="draft">Draft</option>
                          <option value="archived">Archived</option>
                          <option value="discontinued">Discontinued</option>
                        </select>
                      </label>
                      <label className="admin-product-filter">
                        Sort by
                        <select
                          aria-label="Sort products"
                          className={inputClass}
                          value={productListFilters.sortBy}
                          onChange={(event) => updateProductListFilter('sortBy', event.target.value)}
                        >
                          <option value="name-asc">Name A–Z</option>
                          <option value="name-desc">Name Z–A</option>
                          <option value="price-asc">Price: low to high</option>
                          <option value="price-desc">Price: high to low</option>
                          <option value="stock-asc">Stock: low to high</option>
                          <option value="stock-desc">Stock: high to low</option>
                          <option value="newest">Newest first</option>
                        </select>
                      </label>
                    </div>

                    <div className="admin-product-list-summary">
                      <p aria-live="polite">
                        Showing {productPagination.firstItem}–{productPagination.lastItem} of {productPagination.totalItems} products
                      </p>
                      <button
                        type="button"
                        onClick={clearProductListFilters}
                        disabled={!hasProductListFilters}
                        className="admin-button admin-button--ghost admin-button--compact"
                      >
                        Clear filters
                      </button>
                    </div>

                    <div className="admin-product-list">
                      {productPagination.items.map((product) => {
                        const productSkus = [...new Set([
                          product.sku,
                          ...(Array.isArray(product.variants) ? product.variants.map((variant) => variant.sku) : [])
                        ].filter(Boolean))];
                        const productStockValues = [
                          product.stock,
                          ...(Array.isArray(product.variants) ? product.variants.map((variant) => variant.stock) : [])
                        ];
                        const productIsInactive = product.active === false && product.status !== 'active';
                        const productHasZeroStock = productStockValues.every((stock) => Number.isSafeInteger(stock) && stock === 0);
                        const canPermanentlyDelete = productIsInactive && productHasZeroStock;
                        const deleteUnavailableReason = !productIsInactive
                          ? 'Change the product to an inactive status before deletion.'
                          : 'Set product and variant stock to zero before deletion.';
                        return (
                          <div key={product._id} className="admin-product-card">
                            <div className="admin-product-card__thumb">
                              <img src={getProductImage(product)} alt={product.name} onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = getProductImage({ category: product.category }); }} />
                            </div>
                            <div className="admin-product-card__content">
                              <div className="admin-product-card__heading">
                                <strong className="admin-product-card__name">{product.name}</strong>
                                <button
                                  type="button"
                                  onClick={() => handlePermanentProductDelete(product)}
                                  className="admin-button admin-button--danger admin-product-card__delete"
                                  aria-label={`Permanently delete ${product.name}${canPermanentlyDelete ? '' : ` (unavailable: ${deleteUnavailableReason})`}`}
                                  title={canPermanentlyDelete ? 'Permanently delete' : deleteUnavailableReason}
                                  disabled={!canPermanentlyDelete}
                                >
                                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                                </button>
                              </div>
                              <div className="admin-product-card__meta">
                                <span className="admin-product-card__category">{product.category} · {product.gender}</span>
                                <div className="admin-product-card__badges">
                                  {product.featured && <span className="admin-product-badge">Featured</span>}
                                  {product.newArrival && <span className="admin-product-badge">New arrival</span>}
                                  {product.bestSeller && <span className="admin-product-badge">Best seller</span>}
                                  <span className={`admin-product-badge admin-product-badge--status admin-product-badge--${product.status || (product.active === true ? 'active' : 'archived')}`}>
                                    {product.status || (product.active === true ? 'active' : 'archived')}
                                  </span>
                                </div>
                                <div
                                  className="admin-product-card__sku"
                                  aria-label={`SKU: ${productSkus.length ? productSkus.join(', ') : 'Not assigned'}`}
                                  title={productSkus.join(', ')}
                                >
                                  <span>SKU</span>
                                  <strong>{productSkus[0] || 'Not assigned'}</strong>
                                  {productSkus.length > 1 && <span>+{productSkus.length - 1} more</span>}
                                </div>
                              </div>
                            </div>
                            <div className="admin-product-card__price">
                              <strong>{formatInr(product.discountPrice || product.price)}</strong>
                              <span><span className="admin-product-card__stock-label">Stock</span> {product.stock}</span>
                            </div>
                            <div className="admin-action-strip admin-product-card__actions">
                              <button type="button" onClick={() => handleEdit(product)} className="admin-button admin-button--secondary">Edit</button>
                              <button type="button" onClick={() => handleDuplicate(product)} className="admin-button admin-button--secondary" aria-label={`Duplicate ${product.name}`}>
                                <Copy className="w-4 h-4" /> Duplicate
                              </button>
                              {product.active === true && (
                                <>
                                  <button type="button" onClick={() => handleProductStatusChange(product, 'discontinue')} className="admin-button admin-button--secondary">Discontinue</button>
                                </>
                              )}
                              {product.active !== true && (
                                <button type="button" onClick={() => handleProductStatusChange(product, 'activate')} className="admin-button admin-button--secondary">Activate</button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleProductStatusChange(product, 'archive')}
                                className="admin-button admin-button--danger"
                                disabled={product.status === 'archived'}
                              >
                                Archive
                              </button>
                            </div>
                          </div>
                        );
                      })}
                      {productPagination.totalItems === 0 && <p className="admin-empty-state text-center">No products match these filters.</p>}
                    </div>
                    <nav className="admin-product-pagination" aria-label="Product list pages">
                      <span>
                        Page {productPagination.currentPage} of {productPagination.totalPages}
                      </span>
                      <div>
                        <button
                          type="button"
                          onClick={() => setProductListPage(productPagination.currentPage - 1)}
                          disabled={productPagination.currentPage <= 1}
                          className="admin-button admin-button--secondary admin-button--compact"
                          aria-label="Previous product page"
                        >
                          Previous
                        </button>
                        <button
                          type="button"
                          onClick={() => setProductListPage(productPagination.currentPage + 1)}
                          disabled={productPagination.currentPage >= productPagination.totalPages}
                          className="admin-button admin-button--secondary admin-button--compact"
                          aria-label="Next product page"
                        >
                          Next
                        </button>
                      </div>
                    </nav>
                  </div>
                </section>
              )}

              {activeSection === 'inventory' && (
                <section className="admin-inventory-layout" aria-label="SKU inventory" aria-busy={inventoryStatus === 'loading'}>
                  <div className={panelClass}>
                    <div className="admin-panel-header">
                      <h2>SKU inventory · {inventoryTotalCount.toLocaleString('en-IN')} records</h2>
                      <button
                        type="button"
                        onClick={handleInventoryExport}
                        disabled={inventoryExporting || inventoryStatus === 'loading'}
                        className="admin-button admin-button--secondary admin-button--compact"
                      >
                        <Download className="h-4 w-4" aria-hidden="true" />
                        {inventoryExporting ? 'Preparing CSV…' : 'Export CSV'}
                      </button>
                    </div>
                    <p className="mb-4 text-xs text-[#7d7267]">Available stock is on-hand stock minus reserved stock. Legacy stock without a verified SKU remains unallocated and is not assigned to a size or colour. Adjustments record the operator, reason, before/after counts, and a retry-safe request key.</p>
                    {!inventoryTransactionSupportAvailable && (
                      <p className="mb-4 text-xs text-[#7d7267]" role="status">
                        SKU restoration is disabled until MongoDB transaction support is available; no inventory or audit data will be changed.
                      </p>
                    )}
                    {inventorySummary && (
                      <div className="admin-metric-grid admin-inventory-report mb-4" role="region" aria-label="Inventory summary">
                        {[
                          ['Total SKUs', inventorySummary.totalSkus],
                          ['Physical stock', inventorySummary.unitsOnHand],
                          ['Unallocated legacy', inventorySummary.unallocatedLegacyUnits ?? '—'],
                          ['Available stock', inventorySummary.availableUnits],
                          ['Reserved stock', inventorySummary.reservedUnits],
                          ['Committed stock', inventorySummary.committedUnits],
                          ['Incoming stock', inventorySummary.incomingUnits],
                          ['Low-stock SKUs', inventorySummary.lowStockRecords],
                          ['Out-of-stock SKUs', inventorySummary.outOfStockRecords],
                          ['Retail valuation', formatInventoryPaise(inventorySummary.retailValuePaise)],
                          ['Known cost value', formatInventoryPaise(inventorySummary.costedValuePaise)],
                          ['Pending receipts', inventorySummary.pendingReceiptCount]
                        ].map(([label, value]) => {
                          const filter = getInventoryKpiFilter(label);
                          const active = filter && inventoryFilters.status === filter.status
                            && Boolean(filter.incomingOnly) === inventoryFilters.incomingOnly;
                          return (
                          <button
                            key={label}
                            type="button"
                            className={`admin-metric-card ${filter ? 'admin-metric-card--interactive' : ''} ${active ? 'admin-metric-card--active' : ''}`}
                            onClick={() => {
                              if (!filter) return;
                              closeInventoryDrawer();
                              if (filter.incomingOnly) {
                                setInventoryPage(1);
                                setInventoryFilters((current) => ({
                                  ...current,
                                  status: 'all',
                                  incomingOnly: !current.incomingOnly
                                }));
                              } else {
                                setInventoryPage(1);
                                setInventoryFilters((current) => ({ ...current, status: filter.status, incomingOnly: false }));
                              }
                            }}
                            disabled={!filter}
                          >
                            <p className="admin-metric-card__label">{label}</p>
                            <p className="admin-metric-card__value">{typeof value === 'number' ? value.toLocaleString('en-IN') : value}</p>
                            {label === 'Known cost value' && inventorySummary.uncostedQuantity > 0 && (
                              <span className="admin-metric-card__detail">{inventorySummary.uncostedQuantity.toLocaleString('en-IN')} units not costed</span>
                            )}
                          </button>
                          );
                        })}
                      </div>
                    )}
                    <div className="admin-inventory-toolbar" role="search" aria-label="Filter inventory">
                      <label className="admin-inventory-search">
                        <span>Search inventory by product, SKU, size, or colour</span>
                        <span className="admin-inventory-search__input">
                          <Search className="h-4 w-4" aria-hidden="true" />
                          <input
                            type="search"
                            value={inventorySearchInput}
                            onChange={(event) => setInventorySearchInput(event.target.value)}
                            placeholder="Product, SKU, size, colour"
                            maxLength={100}
                          />
                        </span>
                      </label>
                      <AdminSelect
                        label="Category"
                        value={inventoryFilters.category}
                        options={[
                          { value: 'all', label: 'All categories' },
                          ...categories.map((category) => ({ value: category.name, label: category.name }))
                        ]}
                        onChange={(value) => updateInventoryFilter('category', value)}
                      />
                      <AdminSelect
                        label="Stock status"
                        value={inventoryFilters.status}
                        options={[
                          { value: 'all', label: 'All stock levels' },
                          { value: 'in_stock', label: 'In stock' },
                          { value: 'low_stock', label: 'Low stock' },
                          { value: 'critical_stock', label: 'Critical' },
                          { value: 'out_of_stock', label: 'Out of stock' }
                        ]}
                        onChange={(value) => updateInventoryFilter('status', value)}
                      />
                      <AdminSelect
                        label="Product status"
                        value={inventoryFilters.active}
                        options={[
                          { value: 'all', label: 'All product states' },
                          { value: 'true', label: 'Active products' },
                          { value: 'false', label: 'Inactive products' }
                        ]}
                        onChange={(value) => updateInventoryFilter('active', value)}
                      />
                      <AdminSelect
                        label="Variant lifecycle"
                        value={inventoryFilters.variantStatus}
                        options={[
                          { value: 'all', label: 'All variant states' },
                          { value: 'active', label: 'Active variants' },
                          { value: 'inactive', label: 'Inactive variants' },
                          { value: 'discontinued', label: 'Discontinued variants' }
                        ]}
                        onChange={(value) => updateInventoryFilter('variantStatus', value)}
                      />
                      <AdminSelect
                        label="Sort by"
                        value={inventoryFilters.sort}
                        options={[
                          { value: 'name-asc', label: 'Product name' },
                          { value: 'sku-asc', label: 'SKU' },
                          { value: 'available-asc', label: 'Fewest available' },
                          { value: 'available-desc', label: 'Most available' },
                          { value: 'on-hand-asc', label: 'Fewest on hand' },
                          { value: 'incoming-desc', label: 'Most incoming' },
                          { value: 'updated-desc', label: 'Recent activity' }
                        ]}
                        onChange={(value) => updateInventoryFilter('sort', value)}
                      />
                    </div>

                    {(inventoryFilters.status !== 'all' || inventoryFilters.incomingOnly) && (
                      <div className="admin-inventory-active-filter" role="status">
                        <span>Active filter: {inventoryFilters.incomingOnly ? 'incoming stock' : inventoryFilters.status.replaceAll('_', ' ')}</span>
                        <button
                          type="button"
                          className="admin-button admin-button--secondary admin-button--compact"
                          onClick={() => updateInventoryFilter('status', 'all')}
                        >
                          Clear filter
                        </button>
                      </div>
                    )}

                    {inventoryDrawerKey && (() => {
                      const drawerItem = inventoryDrawerItemOverride?.key === inventoryDrawerKey
                        ? inventoryDrawerItemOverride.item
                        : inventoryItems.find((item) =>
                          (item.sku || item.productId) === inventoryDrawerKey
                        );
                      if (!drawerItem) return null;
                      const drawerProduct = products.find((product) =>
                        String(product._id || product.id) === String(drawerItem.productId)
                      );
                      const drawerVariantOptions = getInventoryVariantOptions(drawerProduct);
                      const drawerState = getInventoryDrawerState(drawerItem);
                      const drawerDraft = inventoryDrafts[inventoryDrawerKey] || { delta: '', reason: '', reasonPreset: '', notes: '' };
                      const nextQuantity = Number.isSafeInteger(Number(drawerDraft.delta))
                        ? drawerItem.onHand + Number(drawerDraft.delta)
                        : drawerItem.onHand;
                      return (
                        <div className="admin-inventory-drawer" role="dialog" aria-modal="true" aria-label={`Adjust ${drawerState.sku}`}>
                          <button
                            type="button"
                            className="admin-inventory-drawer__backdrop"
                            aria-label="Close stock adjustment"
                            onClick={closeInventoryDrawer}
                          />
                          <aside className="admin-inventory-drawer__panel">
                            <div className="admin-inventory-drawer__header">
                              <div>
                                <span>Stock adjustment</span>
                                <h3>{drawerState.title}</h3>
                                <p>{drawerState.identity} · {drawerState.sku}</p>
                              </div>
                              <button
                                type="button"
                                className="admin-button admin-button--secondary admin-button--compact"
                                onClick={closeInventoryDrawer}
                              >
                                <X className="h-4 w-4" aria-hidden="true" /> Close
                              </button>
                            </div>
                            {drawerVariantOptions.length > 1 && (
                              <div className="admin-inventory-drawer__variant-picker">
                                <AdminSelect
                                  label="Adjust colour / size"
                                  value={drawerItem.sku}
                                  options={drawerVariantOptions}
                                  disabled={inventoryDrawerTargetLoading || Boolean(inventorySubmitting[inventoryDrawerKey])}
                                  onChange={handleInventoryVariantChange}
                                />
                                {inventoryDrawerTargetLoading && (
                                  <p role="status">Loading selected SKU inventory…</p>
                                )}
                              </div>
                            )}
                            <div className="admin-inventory-drawer__identity">
                              <img
                                src={getProductImage({ category: drawerItem.category, images: drawerState.image ? [drawerState.image] : [] })}
                                alt=""
                                onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = getProductImage({ category: drawerItem.category }); }}
                              />
                              <dl>
                                <div><dt>On hand</dt><dd>{drawerItem.onHand.toLocaleString('en-IN')}</dd></div>
                                <div><dt>Reserved</dt><dd>{drawerItem.reservedQuantity.toLocaleString('en-IN')}</dd></div>
                                <div><dt>Available</dt><dd>{drawerItem.availableStock.toLocaleString('en-IN')}</dd></div>
                                <div><dt>Committed</dt><dd>{drawerItem.committedQuantity.toLocaleString('en-IN')}</dd></div>
                                <div><dt>New on hand</dt><dd>{Math.max(0, nextQuantity).toLocaleString('en-IN')}</dd></div>
                              </dl>
                            </div>
                            <InventoryAdjustmentForm
                              item={drawerItem}
                              draft={drawerDraft}
                              submitting={Boolean(inventorySubmitting[inventoryDrawerKey])}
                              inputClass={inputClass}
                              policy={inventoryPolicy}
                              onDraftChange={handleInventoryDraftChange}
                              onSubmit={handleInventoryAdjustment}
                            />
                            {drawerItem.sku && (
                              <form className="admin-inventory-target-form" onSubmit={(event) => handleInventoryTargetSave(event, drawerItem)}>
                                <label className="admin-form-field">
                                  Restock target
                                  <input
                                    className={inputClass}
                                    type="number"
                                    min="0"
                                    step="1"
                                    value={inventoryTargetDrafts[drawerItem.sku] ?? drawerItem.reorderTarget ?? ''}
                                    disabled={Boolean(inventoryTargetSubmitting[drawerItem.sku])}
                                    onChange={(event) => setInventoryTargetDrafts((current) => ({ ...current, [drawerItem.sku]: event.target.value }))}
                                  />
                                </label>
                                <button type="submit" className="admin-button admin-button--secondary" disabled={Boolean(inventoryTargetSubmitting[drawerItem.sku])}>
                                  {inventoryTargetSubmitting[drawerItem.sku] ? 'Saving…' : 'Save target'}
                                </button>
                              </form>
                            )}
                          </aside>
                        </div>
                      );
                    })()}

                    {(inventoryApprovals.length > 0 || inventoryApprovalError) && (
                      <section className="mb-5 rounded-xl border border-[#d8cabb] bg-[#fbf8f3] p-4" aria-label="Pending inventory approvals">
                        <div className="admin-panel-header">
                          <h3>Pending stock approvals</h3>
                          <span>{inventoryApprovals.length}</span>
                        </div>
                        {inventoryApprovalError && <p className="text-sm text-red-800" role="alert">{inventoryApprovalError}</p>}
                        <div className="admin-row-list">
                          {inventoryApprovals.map((approval) => {
                            const id = String(approval._id);
                            const busy = Boolean(inventoryApprovalBusy[id]);
                            return (
                              <article key={id} className="admin-row-item">
                                <div className="admin-row-copy">
                                  <strong>{approval.productName}{approval.sku ? ` · ${approval.sku}` : ''}</strong>
                                  <span>{approval.quantityDelta > 0 ? '+' : ''}{approval.quantityDelta} units · {approval.type} · requested by {approval.requestedBy?.name || 'Admin'}</span>
                                  <span>{approval.reason}{approval.reference ? ` · ${approval.reference}` : ''}</span>
                                  {approval.approvalLevel === 'owner' ? (
                                    <span role="status">Owner authorization is required. Admin accounts cannot approve this request.</span>
                                  ) : (
                                    <form
                                      className="flex flex-wrap items-end gap-2"
                                      onSubmit={(event) => handleInventoryApprovalDecision(event, approval, 'reject')}
                                    >
                                      <label className="admin-form-field min-w-[220px] flex-1">
                                        Rejection reason
                                        <input
                                          className={inputClass}
                                          value={inventoryApprovalReasons[id] || ''}
                                          onChange={(event) => setInventoryApprovalReasons((current) => ({ ...current, [id]: event.target.value }))}
                                          minLength={5}
                                          maxLength={300}
                                          disabled={busy}
                                        />
                                      </label>
                                      <button
                                        type="button"
                                        className="admin-button admin-button--secondary"
                                        disabled={busy}
                                        onClick={(event) => handleInventoryApprovalDecision(event, approval, 'approve')}
                                      >
                                        {busy ? 'Saving…' : 'Approve and apply'}
                                      </button>
                                      <button type="submit" className="admin-button admin-button--secondary" disabled={busy}>
                                        Reject
                                      </button>
                                    </form>
                                  )}
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      </section>
                    )}

                    <section className="mb-5 rounded-xl border border-[#d8cabb] bg-[#fbf8f3] p-4" aria-label="Inbound receipts">
                      <div className="admin-panel-header">
                        <h3>Inbound receipts</h3>
                        <span>{inventoryReceipts.length} open</span>
                      </div>
                      <p className="mb-3 text-xs text-[#7d7267]">
                        Receipt creation records expected stock only. Accepted quantities update sellable stock only after a transaction-capable MongoDB is available; damaged and rejected units never enter stock.
                      </p>
                      {inventoryReceiptError && <p className="mb-3 text-sm text-red-800" role="alert">{inventoryReceiptError}</p>}
                      <form className="admin-inventory-toolbar" onSubmit={handleInventoryReceiptCreate}>
                        <AdminSelect
                          label="Product / SKU"
                          value={inventoryReceiptDraft.target}
                          options={[
                            { value: '', label: 'Choose a SKU' },
                            ...getInventoryReceiptTargetOptions(products)
                          ]}
                          onChange={(target) => setInventoryReceiptDraft((current) => ({ ...current, target }))}
                        />
                        <label className="admin-form-field">
                          Expected units
                          <input
                            className={inputClass}
                            type="number"
                            min="1"
                            max="100000"
                            step="1"
                            value={inventoryReceiptDraft.expectedQuantity}
                            onChange={(event) => setInventoryReceiptDraft((current) => ({ ...current, expectedQuantity: event.target.value }))}
                            required
                          />
                        </label>
                        <label className="admin-form-field">
                          Expected date
                          <input
                            className={inputClass}
                            type="date"
                            value={inventoryReceiptDraft.expectedDate}
                            onChange={(event) => setInventoryReceiptDraft((current) => ({ ...current, expectedDate: event.target.value }))}
                          />
                        </label>
                        <label className="admin-form-field">
                          Reference
                          <input
                            className={inputClass}
                            value={inventoryReceiptDraft.reference}
                            onChange={(event) => setInventoryReceiptDraft((current) => ({ ...current, reference: event.target.value }))}
                            maxLength={120}
                          />
                        </label>
                        <label className="admin-form-field">
                          Verified unit cost (paise, optional)
                          <input
                            className={inputClass}
                            type="number"
                            min="0"
                            step="1"
                            value={inventoryReceiptDraft.unitCostPaise}
                            onChange={(event) => setInventoryReceiptDraft((current) => ({ ...current, unitCostPaise: event.target.value }))}
                          />
                        </label>
                        <button type="submit" className="admin-button admin-button--secondary" disabled={inventoryReceiptSubmitting || inventoryStatus === 'loading'}>
                          {inventoryReceiptSubmitting ? 'Saving receipt…' : 'Create receipt'}
                        </button>
                      </form>

                      <div className="admin-row-list mt-4">
                        {inventoryReceipts.map((receipt) => {
                          const id = String(receipt._id);
                          const draft = inventoryReceiveDrafts[id] || {};
                          const remaining = Math.max(0,
                            Number(receipt.expectedQuantity || 0) -
                            Number(receipt.receivedQuantity || 0) -
                            Number(receipt.damagedQuantity || 0) -
                            Number(receipt.rejectedQuantity || 0) -
                            Number(receipt.cancelledQuantity || 0)
                          );
                          return (
                            <article key={id} className="admin-row-item">
                              <div className="admin-row-copy">
                                <strong>{receipt.product?.name || receipt.productName || 'Product'}{receipt.sku ? ` · ${receipt.sku}` : ''}</strong>
                                <span>{remaining} of {receipt.expectedQuantity} units outstanding{receipt.expectedDate ? ` · expected ${new Date(receipt.expectedDate).toLocaleDateString()}` : ''}{receipt.reference ? ` · ${receipt.reference}` : ''}</span>
                                <form
                                  className="admin-inventory-toolbar"
                                  onSubmit={(event) => handleInventoryReceiptReceive(event, receipt)}
                                >
                                  {[
                                    ['receivedQuantity', 'Accepted'],
                                    ['damagedQuantity', 'Damaged'],
                                    ['rejectedQuantity', 'Rejected'],
                                    ['cancelledQuantity', 'Cancelled']
                                  ].map(([field, label]) => (
                                    <label className="admin-form-field" key={field}>
                                      {label} units
                                      <input
                                        className={inputClass}
                                        type="number"
                                        min="0"
                                        max={remaining}
                                        step="1"
                                        value={draft[field] ?? ''}
                                        onChange={(event) => setInventoryReceiveDrafts((current) => ({
                                          ...current,
                                          [id]: { ...(current[id] || {}), [field]: event.target.value }
                                        }))}
                                        disabled={inventoryReceiveSubmitting[id] || remaining === 0}
                                      />
                                    </label>
                                  ))}
                                  {Number(draft.cancelledQuantity) > 0 && (
                                    <label className="admin-form-field">
                                      Cancellation reason
                                      <input
                                        className={inputClass}
                                        value={draft.cancellationReason || ''}
                                        onChange={(event) => setInventoryReceiveDrafts((current) => ({
                                          ...current,
                                          [id]: { ...(current[id] || {}), cancellationReason: event.target.value }
                                        }))}
                                        minLength={5}
                                        maxLength={300}
                                        required
                                      />
                                    </label>
                                  )}
                                  <button type="submit" className="admin-button admin-button--secondary" disabled={inventoryReceiveSubmitting[id] || remaining === 0}>
                                    {inventoryReceiveSubmitting[id] ? 'Recording…' : 'Record receipt'}
                                  </button>
                                </form>
                              </div>
                            </article>
                          );
                        })}
                        {inventoryReceipts.length === 0 && !inventoryReceiptError && (
                          <p className="admin-empty-state">No open inbound receipts.</p>
                        )}
                      </div>
                    </section>

                    <section className="mb-5 rounded-xl border border-[#d8cabb] bg-[#fbf8f3] p-4" aria-label="Inventory cost and stocktake operations">
                      <div className="admin-panel-header">
                        <h3>Cost, stocktake and CSV preview</h3>
                      </div>
                      <div className="admin-inventory-operations-grid">
                        <form className="admin-inventory-operation" onSubmit={handleVerifiedUnitCost}>
                          <h4>Verified unit cost</h4>
                          <label className="admin-form-field">
                            SKU
                            <AdminSelect
                              label=""
                              value={inventoryUnitCostDraft.sku}
                              options={[
                                { value: '', label: 'Choose SKU' },
                                ...inventoryItems.filter((item) => item.sku).map((item) => ({
                                  value: item.sku,
                                  label: `${item.sku} · ${item.productName}`
                                }))
                              ]}
                              onChange={(sku) => setInventoryUnitCostDraft((current) => ({ ...current, sku }))}
                            />
                          </label>
                          <label className="admin-form-field">
                            Unit cost (rupees)
                            <input
                              className={inputClass}
                              type="number"
                              min="0"
                              step="0.01"
                              value={inventoryUnitCostDraft.unitCost}
                              onChange={(event) => setInventoryUnitCostDraft((current) => ({ ...current, unitCost: event.target.value }))}
                            />
                          </label>
                          <label className="admin-form-field">
                            Costed quantity
                            <input
                              className={inputClass}
                              type="number"
                              min="0"
                              step="1"
                              value={inventoryUnitCostDraft.costedQuantity}
                              onChange={(event) => setInventoryUnitCostDraft((current) => ({ ...current, costedQuantity: event.target.value }))}
                            />
                          </label>
                          <label className="admin-form-field">
                            Audit reason
                            <input
                              className={inputClass}
                              value={inventoryUnitCostDraft.reason}
                              onChange={(event) => setInventoryUnitCostDraft((current) => ({ ...current, reason: event.target.value }))}
                              minLength={5}
                              maxLength={300}
                            />
                          </label>
                          <button type="submit" className="admin-button admin-button--secondary">Save verified cost</button>
                        </form>

                        <form className="admin-inventory-operation" onSubmit={handleInventoryStocktakePreview}>
                          <h4>Cycle count preview</h4>
                          <label className="admin-form-field">
                            Product / SKU
                            <AdminSelect
                              label=""
                              value={inventoryStocktakeDraft.sku ? `${inventoryStocktakeDraft.productId}:${inventoryStocktakeDraft.sku}` : inventoryStocktakeDraft.productId}
                              options={[
                                { value: '', label: 'Choose product or SKU' },
                                ...inventoryItems.map((item) => ({
                                  value: item.sku ? `${item.productId}:${item.sku}` : item.productId,
                                  label: `${item.productName}${item.sku ? ` · ${item.sku}` : ' · Legacy stock'}`
                                }))
                              ]}
                              onChange={(value) => {
                                const [productId, sku] = value.includes(':') ? value.split(':') : [value, ''];
                                setInventoryStocktakeDraft((current) => ({ ...current, productId, sku }));
                              }}
                            />
                          </label>
                          <label className="admin-form-field">
                            Physical count
                            <input
                              className={inputClass}
                              type="number"
                              min="0"
                              step="1"
                              value={inventoryStocktakeDraft.countedQuantity}
                              onChange={(event) => setInventoryStocktakeDraft((current) => ({ ...current, countedQuantity: event.target.value }))}
                            />
                          </label>
                          <button type="submit" className="admin-button admin-button--secondary">Preview variance</button>
                        </form>

                        <div className="admin-inventory-operation">
                          <h4>CSV import preview</h4>
                          <label className="admin-form-field">
                            CSV content
                            <textarea
                              className={inputClass}
                              rows={5}
                              value={inventoryCsvText}
                              onChange={(event) => setInventoryCsvText(event.target.value)}
                              placeholder="SKU,Quantity,Reason"
                            />
                          </label>
                          <button type="button" className="admin-button admin-button--secondary" onClick={handleInventoryCsvPreview}>
                            Preview import
                          </button>
                          {inventoryCsvPreview && (
                            <p className="text-xs text-[#7d7267]" role="status">
                              {inventoryCsvPreview.validRows} valid · {inventoryCsvPreview.invalidRows} invalid · {inventoryCsvPreview.duplicates} duplicate
                            </p>
                          )}
                        </div>
                      </div>
                    </section>

                    {inventoryStatus === 'error' && (
                      <div className="admin-inventory-feedback admin-inventory-feedback--error" role="alert">
                        <p>{inventoryError}</p>
                        <button type="button" className="admin-button admin-button--secondary" onClick={() => setInventoryRefreshKey((current) => current + 1)}>
                          Retry inventory
                        </button>
                      </div>
                    )}
                    {inventoryStatus === 'loading' && (
                      <p className="admin-inventory-feedback" role="status">Loading inventory records…</p>
                    )}

                    <div className="admin-inventory-table-wrap" aria-label="SKU inventory table">
                      <table className="admin-inventory-table">
                        <thead>
                          <tr>
                            <th scope="col">Product</th>
                            <th scope="col">SKU</th>
                            <th scope="col">Size / colour</th>
                            <th scope="col">Variant state</th>
                            <th scope="col">On hand</th>
                            <th scope="col">Reserved</th>
                            <th scope="col">Available</th>
                            <th scope="col">Committed</th>
                            <th scope="col">Incoming</th>
                            <th scope="col">Status</th>
                            <th scope="col">Last updated</th>
                            <th scope="col">Quick actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {inventoryItems.map((item) => {
                            const key = item.sku || item.productId;
                            return (
                              <tr key={key}>
                                <td>
                                  <div className="admin-inventory-product">
                                    <img
                                      src={getProductImage({ category: item.category, images: item.image ? [item.image] : [] })}
                                      alt=""
                                      onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = getProductImage({ category: item.category }); }}
                                    />
                                    <span>
                                      <strong>{item.productName}</strong>
                                      <small>{item.category || 'Uncategorised'}</small>
                                      {item.isDemoData && <small>DEMO CATALOGUE</small>}
                                    </span>
                                  </div>
                                </td>
                                <td><span className="admin-inventory-sku">{item.sku || 'Legacy stock'}</span></td>
                                <td>{item.size ? `${item.size} · ${item.colour}` : '—'}</td>
                                <td>{item.variantStatus || 'active'}</td>
                                <td>{item.onHand.toLocaleString('en-IN')}</td>
                                <td>{item.reservedQuantity.toLocaleString('en-IN')}</td>
                                <td><strong>{item.availableStock.toLocaleString('en-IN')}</strong></td>
                                <td>{item.committedQuantity.toLocaleString('en-IN')}</td>
                                <td>
                                  <span>{item.incomingQuantity.toLocaleString('en-IN')}</span>
                                  {item.restockSuggestion > 0 && <small className="admin-inventory-restock">Restock {item.restockSuggestion}</small>}
                                </td>
                                <td><span className={`admin-inventory-status ${inventoryStatusClass(item)}`}>{inventoryStatusLabel(item)}</span></td>
                                <td>{item.updatedAt ? new Date(item.updatedAt).toLocaleDateString() : 'Unknown'}</td>
                                <td>
                                  <div className="admin-inventory-action-stack">
                                    <button
                                      type="button"
                                      className="admin-button admin-button--secondary admin-button--compact"
                                      onClick={() => openInventoryDrawer(item)}
                                    >
                                      Adjust
                                    </button>
                                    {item.sku && ['inactive', 'discontinued'].includes(item.variantStatus) && (
                                      <button
                                        type="button"
                                        className="admin-button admin-button--secondary admin-button--compact"
                                        aria-label={`Restore SKU ${item.sku}`}
                                        title={inventoryTransactionSupportAvailable ? undefined : 'Restoring an SKU requires MongoDB transaction support.'}
                                        disabled={!inventoryTransactionSupportAvailable || Boolean(inventorySkuRestoreBusy[item.sku])}
                                        onClick={() => handleInventorySkuRestore(item)}
                                      >
                                        {inventorySkuRestoreBusy[item.sku] ? 'Restoring…' : 'Restore SKU'}
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      className="admin-button admin-button--ghost admin-button--compact"
                                      onClick={() => {
                                        setInventoryReceiptDraft((current) => ({ ...current, target: key }));
                                        document.querySelector('[aria-label="Inbound receipts"]')?.scrollIntoView({ block: 'start' });
                                      }}
                                    >
                                      Restock
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    <div className="admin-inventory-mobile-list">
                      {inventoryItems.map((item) => {
                        const key = item.sku || item.productId;
                        return (
                          <article key={key} className="admin-inventory-mobile-card">
                            <div className="admin-inventory-mobile-card__heading">
                              <img
                                src={getProductImage({ category: item.category, images: item.image ? [item.image] : [] })}
                                alt=""
                                onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = getProductImage({ category: item.category }); }}
                              />
                              <div>
                                <strong>{item.productName}</strong>
                                <span>{item.sku || 'Legacy stock'} · {item.size ? `${item.size} · ${item.colour}` : item.category}</span>
                                {item.isDemoData && <span>DEMO CATALOGUE</span>}
                              </div>
                              <span className={`admin-inventory-status ${inventoryStatusClass(item)}`}>{inventoryStatusLabel(item)}</span>
                            </div>
                            <dl className="admin-inventory-mobile-card__quantities">
                              <div><dt>On hand</dt><dd>{item.onHand.toLocaleString('en-IN')}</dd></div>
                              <div><dt>Reserved</dt><dd>{item.reservedQuantity.toLocaleString('en-IN')}</dd></div>
                              <div><dt>Available</dt><dd>{item.availableStock.toLocaleString('en-IN')}</dd></div>
                              <div><dt>Committed</dt><dd>{item.committedQuantity.toLocaleString('en-IN')}</dd></div>
                              <div><dt>Incoming</dt><dd>{item.incomingQuantity.toLocaleString('en-IN')}</dd></div>
                              <div><dt>Last updated</dt><dd>{item.updatedAt ? new Date(item.updatedAt).toLocaleDateString() : 'Unknown'}</dd></div>
                              <div><dt>Last stock activity</dt><dd>{item.lastActivity ? new Date(item.lastActivity).toLocaleDateString() : 'Unknown'}</dd></div>
                            </dl>
                            {item.restockSuggestion > 0 && (
                              <p className="admin-inventory-mobile-card__restock"><AlertTriangle className="h-4 w-4" aria-hidden="true" /> Suggested restock: {item.restockSuggestion}</p>
                            )}
                            <div className="admin-inventory-action-stack">
                              <button
                                type="button"
                                className="admin-button admin-button--secondary"
                                onClick={() => openInventoryDrawer(item)}
                              >
                                Manage stock
                              </button>
                              {item.sku && ['inactive', 'discontinued'].includes(item.variantStatus) && (
                                <button
                                  type="button"
                                  className="admin-button admin-button--secondary"
                                  aria-label={`Restore SKU ${item.sku}`}
                                  title={inventoryTransactionSupportAvailable ? undefined : 'Restoring an SKU requires MongoDB transaction support.'}
                                  disabled={!inventoryTransactionSupportAvailable || Boolean(inventorySkuRestoreBusy[item.sku])}
                                  onClick={() => handleInventorySkuRestore(item)}
                                >
                                  {inventorySkuRestoreBusy[item.sku] ? 'Restoring…' : 'Restore SKU'}
                                </button>
                              )}
                              <button
                                type="button"
                                className="admin-button admin-button--ghost"
                                onClick={() => {
                                  setInventoryReceiptDraft((current) => ({ ...current, target: key }));
                                  document.querySelector('[aria-label="Inbound receipts"]')?.scrollIntoView({ block: 'start' });
                                }}
                              >
                                Restock
                              </button>
                            </div>
                          </article>
                        );
                      })}
                    </div>

                    {inventoryStatus === 'loaded' && inventoryItems.length === 0 && (
                      <p className="admin-empty-state" role="status">
                        {inventoryTotalCount === 0 ? 'No SKU records match these filters.' : 'No inventory records are available.'}
                      </p>
                    )}
                    <nav className="admin-product-pagination" aria-label="Inventory pages">
                      <span>
                        {inventoryTotalCount === 0
                          ? 'No records to show'
                          : `Showing ${((inventoryPage - 1) * INVENTORY_PAGE_SIZE) + 1}–${Math.min(inventoryPage * INVENTORY_PAGE_SIZE, inventoryTotalCount)} of ${inventoryTotalCount.toLocaleString('en-IN')} records`}
                      </span>
                      <div>
                        <button
                          type="button"
                          className="admin-button admin-button--secondary admin-button--compact"
                          aria-label="Previous inventory page"
                          onClick={() => setInventoryPage((page) => Math.max(1, page - 1))}
                          disabled={inventoryPage <= 1 || inventoryStatus === 'loading'}
                        >
                          <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Previous
                        </button>
                        <span>Page {inventoryPage} of {Math.max(inventoryTotalPages, 1)}</span>
                        <button
                          type="button"
                          className="admin-button admin-button--secondary admin-button--compact"
                          aria-label="Next inventory page"
                          onClick={() => setInventoryPage((page) => Math.min(inventoryTotalPages, page + 1))}
                          disabled={inventoryPage >= inventoryTotalPages || inventoryStatus === 'loading'}
                        >
                          Next <ChevronRight className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </nav>
                  </div>

                  <div className={panelClass}>
                    <div className="admin-panel-header">
                      <h2>Stock movement history</h2>
                    </div>
                    <div className="admin-row-list">
                      {stockMovements.map((movement) => (
                        <article key={movement._id} className="admin-row-item">
                          <div className="admin-row-copy">
                            <strong>{String(movement.type || 'manual').replaceAll('_', ' ')} · {movement.performedBy?.name || 'Administrator'}</strong>
                            <span>{movement.reason} · {new Date(movement.createdAt).toLocaleString()}</span>
                            {movement.changes.map((change, index) => (
                              <span key={`${change.sku || change.product}-${index}`}>
                                {change.productName}{change.sku ? ` · ${change.sku}` : ''}: {change.stockBefore} → {change.stockAfter} ({change.quantityDelta > 0 ? '+' : ''}{change.quantityDelta})
                              </span>
                            ))}
                          </div>
                        </article>
                      ))}
                      {inventoryStatus === 'loading' && <p className="admin-empty-state" role="status">Loading stock activity…</p>}
                      {inventoryStatus === 'loaded' && stockMovements.length === 0 && <p className="admin-empty-state">No stock movements have been recorded.</p>}
                    </div>
                  </div>
                </section>
              )}

              {activeSection === 'support' && (
                <section aria-label="Support Centre" className="admin-support-layout">
                  <div className={panelClass}>
                    <div className="admin-panel-header">
                      <h2>Create a support ticket</h2>
                    </div>
                    <p className="mb-4 text-xs text-[#7d7267]">Create a case for a customer, or record an internal case for your own admin account.</p>
                    <form onSubmit={handleSupportTicketCreate} className="space-y-3">
                      <AdminSelect
                        label="Customer account"
                        className="admin-form-field admin-form-field--full"
                        value={supportForm.customerId}
                        options={[
                          { value: '', label: 'My administrator account' },
                          ...customers.map((customer) => ({
                            value: customer._id,
                            label: `${customer.name} · ${customer.email}`
                          }))
                        ]}
                        onChange={(customerId) => setSupportForm((form) => ({ ...form, customerId, orderId: '' }))}
                      />
                      <AdminSelect
                        label="Related order (optional)"
                        className="admin-form-field admin-form-field--full"
                        value={supportForm.orderId}
                        options={[
                          { value: '', label: 'No related order' },
                          ...orders.filter((order) => String(order.customer?._id || order.customer) === String(supportForm.customerId || user?._id))
                            .map((order) => ({
                              value: order._id,
                              label: `Order ${String(order._id).slice(-8)} · ${order.orderStatus}`
                            }))
                        ]}
                        onChange={(orderId) => setSupportForm((form) => ({ ...form, orderId }))}
                      />
                      <label className="admin-form-field admin-form-field--full">
                        Subject
                        <input
                          className={inputClass}
                          value={supportForm.subject}
                          onChange={(event) => setSupportForm((form) => ({ ...form, subject: event.target.value }))}
                          minLength={4}
                          maxLength={150}
                          required
                        />
                      </label>
                      <label className="admin-form-field admin-form-field--full">
                        Initial message
                        <textarea
                          className={`${inputClass} admin-textarea`}
                          value={supportForm.message}
                          onChange={(event) => setSupportForm((form) => ({ ...form, message: event.target.value }))}
                          rows="4"
                          minLength={5}
                          maxLength={5000}
                          required
                        />
                      </label>
                      <AdminSelect
                        label="Priority"
                        className="admin-form-field admin-form-field--full"
                        value={supportForm.priority}
                        options={SUPPORT_TICKET_PRIORITIES.map((priority) => ({ value: priority, label: priority }))}
                        onChange={(priority) => setSupportForm((form) => ({ ...form, priority }))}
                      />
                      <button type="submit" disabled={supportSubmitting} className="admin-button admin-button--primary w-full">
                        {supportSubmitting ? 'Creating…' : 'Create ticket'}
                      </button>
                    </form>
                  </div>

                  <div className={panelClass}>
                    <div className="admin-panel-header">
                      <h2>Tickets ({supportTotalCount})</h2>
                    </div>
                    <div className="admin-support-filters">
                      <label className="admin-form-field">
                        Search tickets
                        <input
                          className={inputClass}
                          value={supportFilters.search}
                          onChange={(event) => { setSupportFilters((filters) => ({ ...filters, search: event.target.value })); setSupportPage(1); }}
                          placeholder="Subject, message, customer or ID"
                        />
                      </label>
                      <AdminSelect
                        label="Status"
                        className="admin-form-field"
                        value={supportFilters.status}
                        options={[
                          { value: 'all', label: 'All statuses' },
                          ...SUPPORT_TICKET_STATUSES.map((status) => ({ value: status, label: status }))
                        ]}
                        onChange={(status) => { setSupportFilters((filters) => ({ ...filters, status })); setSupportPage(1); }}
                      />
                      <AdminSelect
                        label="Priority"
                        className="admin-form-field"
                        value={supportFilters.priority}
                        options={[
                          { value: 'all', label: 'All priorities' },
                          ...SUPPORT_TICKET_PRIORITIES.map((priority) => ({ value: priority, label: priority }))
                        ]}
                        onChange={(priority) => { setSupportFilters((filters) => ({ ...filters, priority })); setSupportPage(1); }}
                      />
                      <label className="admin-support-filter-check">
                        <input
                          type="checkbox"
                          checked={supportFilters.assignedToMe}
                          onChange={(event) => { setSupportFilters((filters) => ({ ...filters, assignedToMe: event.target.checked })); setSupportPage(1); }}
                        />
                        Assigned to me
                      </label>
                    </div>
                    {supportError && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{supportError}</p>}
                    <div className="admin-support-columns">
                      <div className="admin-support-ticket-list" aria-label="Support tickets">
                        {supportLoading && <p role="status" className="admin-empty-state">Loading support tickets…</p>}
                        {!supportLoading && supportTickets.map((ticket) => (
                          <button
                            key={ticket._id}
                            type="button"
                            onClick={() => setSelectedSupportTicketId(ticket._id)}
                            aria-pressed={String(selectedSupportTicketId) === String(ticket._id)}
                            className={`admin-support-ticket ${String(selectedSupportTicketId) === String(ticket._id) ? 'admin-support-ticket--selected' : ''}`}
                          >
                            <strong>{ticket.subject}</strong>
                            <span>{ticket.customer?.name || 'Customer'} · {ticket.status}</span>
                            <span>{ticket.priority} priority · {ticket.assignedTo?.name || 'Unassigned'}</span>
                          </button>
                        ))}
                        {!supportLoading && supportTickets.length === 0 && <p className="admin-empty-state">No tickets match these filters.</p>}
                        <div className="admin-support-pagination">
                          <button type="button" className="admin-button admin-button--secondary" disabled={supportPage <= 1 || supportLoading} onClick={() => setSupportPage((page) => page - 1)}>Previous</button>
                          <span>Page {supportPage} of {Math.max(supportTotalPages, 1)}</span>
                          <button type="button" className="admin-button admin-button--secondary" disabled={supportPage >= supportTotalPages || supportLoading} onClick={() => setSupportPage((page) => page + 1)}>Next</button>
                        </div>
                      </div>

                      <div className="admin-support-detail">
                        {!selectedSupportTicket && <p className="admin-empty-state">Select a ticket to view its history and update it.</p>}
                        {selectedSupportTicket && (
                          <>
                            <div className="admin-panel-header">
                              <div>
                                <h3>{selectedSupportTicket.subject}</h3>
                                <p className="text-xs text-[#7d7267]">
                                  {selectedSupportTicket.customer?.name} · {selectedSupportTicket.customer?.email}
                                  {selectedSupportTicket.order && ` · Order ${String(selectedSupportTicket.order._id).slice(-8)} (${selectedSupportTicket.order.orderStatus})`}
                                </p>
                              </div>
                              <span className="text-xs text-[#7d7267]">#{String(selectedSupportTicket._id).slice(-8)}</span>
                            </div>
                            <form onSubmit={handleSupportTicketUpdate} className="admin-support-update-form">
                              <AdminSelect
                                label="Status"
                                className="admin-form-field"
                                value={supportEdit.status}
                                options={SUPPORT_TICKET_STATUSES.map((status) => ({ value: status, label: status }))}
                                onChange={(status) => setSupportEdit((current) => ({ ...current, status }))}
                              />
                              <AdminSelect
                                label="Priority"
                                className="admin-form-field"
                                value={supportEdit.priority}
                                options={SUPPORT_TICKET_PRIORITIES.map((priority) => ({ value: priority, label: priority }))}
                                onChange={(priority) => setSupportEdit((current) => ({ ...current, priority }))}
                              />
                              <AdminSelect
                                label="Assigned to"
                                className="admin-form-field"
                                value={supportEdit.assignedTo}
                                options={[
                                  { value: '', label: 'Unassigned' },
                                  ...supportAssignees.map((assignee) => ({
                                    value: assignee._id,
                                    label: `${assignee.name} · ${assignee.email}`
                                  }))
                                ]}
                                onChange={(assignedTo) => setSupportEdit((current) => ({ ...current, assignedTo }))}
                              />
                              <label className="admin-form-field admin-form-field--full">
                                Internal note (visible only to administrators)
                                <textarea className={`${inputClass} admin-textarea`} value={supportInternalNote} onChange={(event) => setSupportInternalNote(event.target.value)} rows="2" maxLength={5000} />
                              </label>
                              <button type="submit" className="admin-button admin-button--secondary" disabled={supportSubmitting}>
                                {supportSubmitting ? 'Saving…' : 'Save ticket updates'}
                              </button>
                            </form>
                            <div className="admin-support-history" aria-label="Ticket activity history">
                              <h4>Activity history</h4>
                              {[...selectedSupportTicket.history].sort((a, b) => new Date(a.at) - new Date(b.at)).map((entry) => (
                                <article key={entry._id} className={`admin-support-history-entry ${entry.visibility === 'internal' ? 'admin-support-history-entry--internal' : ''}`}>
                                  <div className="admin-support-history-entry__meta">
                                    <strong>{entry.actor?.name || 'YAQANA Support'}</strong>
                                    <span>{entry.visibility === 'internal' ? 'Internal note' : entry.type.replaceAll('_', ' ')} · {new Date(entry.at).toLocaleString()}</span>
                                  </div>
                                  <p>{entry.body}</p>
                                </article>
                              ))}
                            </div>
                            {selectedSupportTicket.status !== 'Closed' && (
                              <form onSubmit={handleSupportReply} className="admin-support-reply-form">
                                <label className="admin-form-field admin-form-field--full">
                                  Public reply
                                  <textarea className={`${inputClass} admin-textarea`} value={supportReply} onChange={(event) => setSupportReply(event.target.value)} rows="3" maxLength={5000} minLength={2} required />
                                </label>
                                <button type="submit" className="admin-button admin-button--primary" disabled={supportSubmitting}>
                                  <Send className="h-4 w-4" aria-hidden="true" /> Send reply
                                </button>
                              </form>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {activeSection === 'orders' && (
                <section className={`${panelClass} admin-orders-panel`} aria-label="Orders" aria-busy={orderStatus === 'loading'}>
                  <div className="admin-panel-header">
                    <h2>Orders ({orderTotalCount.toLocaleString('en-IN')})</h2>
                  </div>
                  <div className="admin-orders-toolbar" aria-label="Order filters">
                    <label className="admin-form-field admin-orders-search">
                      Search orders
                      <input
                        type="search"
                        className={inputClass}
                        aria-label="Search orders by order ID, customer name, email or phone"
                        placeholder="Order ID, name, email or phone"
                        maxLength={100}
                        value={orderSearchInput}
                        onChange={(event) => setOrderSearchInput(event.target.value)}
                      />
                    </label>
                    <AdminSelect
                      label="Order status"
                      className="admin-form-field"
                      value={orderFilters.status}
                      options={[
                        { value: 'all', label: 'All statuses' },
                        ...ORDER_STATUS_FILTERS.map((status) => ({ value: status, label: status }))
                      ]}
                      onChange={(value) => updateOrderFilter('status', value)}
                    />
                    <AdminSelect
                      label="Payment status"
                      className="admin-form-field"
                      value={orderFilters.paymentStatus}
                      options={[
                        { value: 'all', label: 'All payment statuses' },
                        ...ORDER_PAYMENT_STATUS_FILTERS.map((status) => ({ value: status, label: status }))
                      ]}
                      onChange={(value) => updateOrderFilter('paymentStatus', value)}
                    />
                    <AdminSelect
                      label="Payment type"
                      className="admin-form-field"
                      value={orderFilters.paymentType}
                      options={[
                        { value: 'all', label: 'All payment types' },
                        { value: 'cod', label: 'Cash on delivery' },
                        { value: 'prepaid', label: 'Prepaid' }
                      ]}
                      onChange={(value) => updateOrderFilter('paymentType', value)}
                    />
                    <label className="admin-form-field admin-orders-date">
                      Order date from
                      <input
                        type="date"
                        className={inputClass}
                        aria-label="Order date from"
                        value={orderFilters.dateFrom}
                        max={orderFilters.dateTo || undefined}
                        onChange={(event) => updateOrderFilter('dateFrom', event.target.value)}
                      />
                    </label>
                    <label className="admin-form-field admin-orders-date">
                      Order date to
                      <input
                        type="date"
                        className={inputClass}
                        aria-label="Order date to"
                        value={orderFilters.dateTo}
                        min={orderFilters.dateFrom || undefined}
                        onChange={(event) => updateOrderFilter('dateTo', event.target.value)}
                      />
                    </label>
                  </div>
                  <div className="admin-saved-filters" aria-label="Saved filters">
                    <form onSubmit={saveCurrentOrderFilters}>
                      <label className="admin-form-field">Save current order filters
                        <input className={inputClass} maxLength={40} value={savedFilterName} onChange={(event) => setSavedFilterName(event.target.value)} placeholder="e.g. Pending COD" />
                      </label>
                      <button className="admin-button admin-button--secondary" type="submit" disabled={savedFilterStatus === 'saving' || !savedFilterName.trim()}>Save filter</button>
                    </form>
                    <label className="admin-form-field">Saved filters
                      <select className={inputClass} value="" onChange={(event) => {
                        const selected = savedAdminFilters.find((item) => item.id === event.target.value);
                        if (selected) applySavedAdminFilter(selected);
                      }}>
                        <option value="">Choose a saved filter</option>
                        {savedAdminFilters.map((saved) => <option key={saved.id} value={saved.id}>{saved.label} Â· {saved.section}</option>)}
                      </select>
                    </label>
                    {savedFilterStatus === 'error' && <span role="alert">Saved filters could not be loaded or saved.</span>}
                  </div>
                  {orderStatus === 'loading' && <p className="admin-inventory-feedback" role="status">Loading orders…</p>}
                  {orderStatus === 'error' && <p className="admin-inventory-feedback admin-inventory-feedback--error" role="alert">{orderError}</p>}
                  <div className="admin-order-list">
                    {orders.map((order) => {
                      const timelineEvents = getOrderTimelineEvents(order);
                      const shipment = order.shipment || {};
                      const hasShipmentDetails = Boolean(shipment.carrier || shipment.trackingNumber || shipment.shippedAt);
                      return (
                        <article key={order._id} className="admin-order-card">
                          <div className="admin-order-card__content">
                            <strong>{order.customer?.name || 'Customer'} · {order.customer?.email || ''}</strong>
                            <div className="admin-order-card__meta">
                              Order #{String(order._id).slice(-8)} · {order.createdAt ? new Date(order.createdAt).toLocaleString() : 'Date unavailable'}
                            </div>
                            <div className="admin-order-card__meta">
                              {order.customer?.phone || 'No mobile number'} · {order.paymentMethod} · Payment: {order.paymentStatus}
                            </div>
                            <div className="admin-order-card__meta mt-2">
                              <strong className="!mb-1 !text-[0.68rem] !font-semibold">Ship to</strong>
                              {formatShippingAddress(order.shippingAddress) || 'No shipping address recorded'}
                            </div>
                            <div className="mt-2 space-y-1">
                              {(order.items || []).map((item, index) => (
                                <div key={`${item.product || item.name}-${index}`} className="admin-order-card__meta flex flex-wrap justify-between gap-x-3">
                                  <span>{item.name} · {item.size} · {item.colour} · Qty {item.quantity}</span>
                                  <span>{formatInr(item.price)} each</span>
                                </div>
                              ))}
                              {(!order.items || order.items.length === 0) && <div className="admin-order-card__meta">No items recorded.</div>}
                            </div>
                          </div>
                          <div className="admin-order-card__aside">
                            <span className="admin-order-card__total">{formatInr(order.total)}</span>
                            <AdminSelect
                              label={`Order status for ${order.customer?.name || 'customer'}`}
                              value={order.orderStatus}
                              options={getAdminOrderStatusOptions(order).map((status) => ({ value: status, label: status }))}
                              onChange={(status) => handleOrderStatus(order._id, status)}
                            />
                          </div>
                          <details className="admin-order-details">
                            <summary>Order timeline and fulfilment details</summary>
                            <div className="admin-order-details__content">
                              <section className="admin-order-details__timeline" aria-label="Order timeline">
                                <h3>Order timeline</h3>
                                <ol className="admin-order-timeline">
                                  {timelineEvents.map((event) => (
                                    <li key={event.key} className="admin-order-timeline__entry">
                                      <span className="admin-order-timeline__marker" aria-hidden="true" />
                                      <div className="admin-order-timeline__copy">
                                        <div className="admin-order-timeline__meta">
                                          <strong>{event.status || 'Status updated'}</strong>
                                          <span>{formatOrderTimelineDate(event.at)}</span>
                                        </div>
                                        {event.reason && <p>{event.reason}</p>}
                                      </div>
                                    </li>
                                  ))}
                                </ol>
                              </section>
                              <section className="admin-order-details__fulfilment" aria-label="Fulfilment details">
                                <h3>Fulfilment details</h3>
                                {order.paymentMethod === 'Cash on Delivery' && (
                                  <p><strong>COD state:</strong> {order.codState || 'Not recorded'}</p>
                                )}
                                <h4>Shipment</h4>
                                {hasShipmentDetails ? (
                                  <dl>
                                    {shipment.carrier && <><dt>Carrier</dt><dd>{shipment.carrier}</dd></>}
                                    {shipment.trackingNumber && <><dt>Tracking number</dt><dd>{shipment.trackingNumber}</dd></>}
                                    {shipment.shippedAt && <><dt>Shipped</dt><dd>{formatOrderTimelineDate(shipment.shippedAt)}</dd></>}
                                  </dl>
                                ) : <p>No shipment information recorded.</p>}
                              </section>
                            </div>
                          </details>
                        </article>
                      );
                    })}
                    {orderStatus === 'loaded' && orders.length === 0 && (
                      <p className="admin-empty-state" role="status">No orders match these filters.</p>
                    )}
                  </div>
                  <nav className="admin-orders-pagination" aria-label="Orders pagination">
                    <AdminSelect
                      label="Orders per page"
                      value={String(orderPageSize)}
                      options={ORDER_PAGE_SIZES.map((size) => ({ value: String(size), label: `${size} per page` }))}
                      onChange={(value) => {
                        setOrderPageSize(Number(value));
                        setOrderPage(1);
                      }}
                    />
                    <span className="admin-orders-pagination__summary">
                      Page {orderTotalPages === 0 ? 0 : orderPage} of {orderTotalPages}
                      <span>{orderTotalCount.toLocaleString('en-IN')} orders</span>
                    </span>
                    <div className="admin-orders-pagination__actions">
                      <button
                        type="button"
                        className="admin-button admin-button--secondary admin-button--compact"
                        aria-label="Previous orders page"
                        disabled={orderPage <= 1 || orderTotalPages === 0 || orderStatus === 'loading'}
                        onClick={() => setOrderPage((current) => Math.max(1, current - 1))}
                      >
                        <ChevronLeft aria-hidden="true" /> Previous
                      </button>
                      <button
                        type="button"
                        className="admin-button admin-button--secondary admin-button--compact"
                        aria-label="Next orders page"
                        disabled={orderPage >= orderTotalPages || orderTotalPages === 0 || orderStatus === 'loading'}
                        onClick={() => setOrderPage((current) => Math.min(orderTotalPages, current + 1))}
                      >
                        Next <ChevronRight aria-hidden="true" />
                      </button>
                    </div>
                  </nav>
                </section>
              )}

              {activeSection === 'customers' && (
                <section className={panelClass} aria-label="Customers" aria-busy={customerListStatus === 'loading'}>
                  <div className="admin-panel-header">
                    <h2>Customers ({customerTotalCount.toLocaleString('en-IN')})</h2>
                  </div>
                  <div className="admin-customers-toolbar" aria-label="Customer filters">
                    <label className="admin-form-field admin-customers-search">
                      <span>Search customers</span>
                      <input
                        type="search"
                        value={customerSearch}
                        onChange={(event) => {
                          setCustomerSearch(event.target.value);
                          setCustomerPage(1);
                        }}
                        aria-label="Search customers by name, email or phone"
                        placeholder="Name, email or phone"
                        maxLength={100}
                        className={inputClass}
                      />
                    </label>
                    <AdminSelect
                      label="Customer status"
                      value={customerStatusFilter}
                      options={[
                        { value: 'all', label: 'All customers' },
                        { value: 'active', label: 'Active' },
                        { value: 'blocked', label: 'Blocked' }
                      ]}
                      onChange={(value) => {
                        setCustomerStatusFilter(value);
                        setCustomerPage(1);
                      }}
                    />
                  </div>
                  <div className="admin-customer-list">
                    {customers.map((customer) => (
                      <article key={customer._id} className="admin-customer-card">
                        <div className="admin-customer-card__content">
                          <strong>{customer.name}</strong>
                          <div className="admin-customer-card__meta">{customer.email}</div>
                          <div className="admin-customer-card__meta">{customer.phone || 'No mobile number'}</div>
                          <div className="admin-customer-card__meta mt-2">{customer.orderCount} orders · {formatInr(customer.totalSpent)} spent</div>
                        </div>
                        <div className="admin-customer-card__actions">
                          <button
                            type="button"
                            className="admin-button admin-button--secondary admin-button--compact"
                            aria-expanded={customerDetailId === customer._id}
                            aria-controls={`customer-details-${customer._id}`}
                            onClick={() => handleCustomerDetails(customer._id)}
                          >
                            {customerDetailId === customer._id ? 'Hide details' : 'View details'}
                          </button>
                          <select aria-label={`Account status for ${customer.name}`} value={customer.status} onChange={(e) => handleCustomerStatus(customer._id, e.target.value)} className={inputClass}>
                            {CUSTOMER_STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}
                          </select>
                        </div>
                        {customerDetailId === customer._id && (
                          <div id={`customer-details-${customer._id}`} className="admin-customer-details" aria-busy={customerDetailStatus === 'loading'}>
                            {customerDetailStatus === 'loading' && <p role="status">Loading customer detailsâ€¦</p>}
                            {customerDetailStatus === 'error' && <p role="alert">{customerDetailError}</p>}
                            {customerDetailStatus === 'loaded' && customerDetail && (
                              <>
                                <section aria-label="Customer addresses">
                                  <h3>Address book</h3>
                                  {customerDetail.addresses?.length > 0 ? customerDetail.addresses.map((address, index) => (
                                    <address key={address._id || index}>
                                      {address.isDefault ? <strong>Default address Â· </strong> : null}
                                      {[address.fullName, address.addressLine1, address.addressLine2, address.city, address.state, address.postalCode, address.country, address.phone].filter(Boolean).join(' Â· ')}
                                    </address>
                                  )) : <p>No saved addresses.</p>}
                                </section>
                                <section aria-label="Recent customer orders">
                                  <h3>Recent orders (up to 10)</h3>
                                  <p>{customerDetail.orderCount} total orders Â· {formatInr(customerDetail.totalSpent)} paid</p>
                                  {customerDetail.orders?.length > 0 ? customerDetail.orders.map((order) => (
                                    <div key={order._id} className="admin-customer-details__order">
                                      <strong>Order #{String(order._id).slice(-8)}</strong>
                                      <span>{order.orderStatus} Â· {order.paymentMethod} Â· {order.paymentStatus}</span>
                                      <span>{(order.items || []).map((item) => `${item.name} Â· ${item.size || 'One size'} Â· Qty ${item.quantity}`).join(', ') || 'No items recorded.'}</span>
                                      <span>{new Date(order.createdAt).toLocaleDateString()} Â· {formatInr(order.total)}</span>
                                    </div>
                                  )) : <p>No orders yet.</p>}
                                </section>
                              </>
                            )}
                          </div>
                        )}
                      </article>
                    ))}
                    {customerListStatus === 'loading' && <p className="admin-empty-state" role="status">Loading customersâ€¦</p>}
                    {customerListStatus === 'error' && <p className="admin-empty-state" role="alert">{customerListError}</p>}
                    {customerListStatus === 'loaded' && customers.length === 0 && <p className="admin-empty-state" role="status">No customers match these filters.</p>}
                  </div>
                  <nav className="admin-customer-pagination" aria-label="Customer pagination">
                    <span className="admin-customer-pagination__summary">
                      Page {customerTotalPages === 0 ? 0 : customerPage} of {customerTotalPages}
                      <span>{customerTotalCount.toLocaleString('en-IN')} customers</span>
                    </span>
                    <div className="admin-orders-pagination__actions">
                      <button
                        type="button"
                        className="admin-button admin-button--secondary admin-button--compact"
                        aria-label="Previous customers page"
                        disabled={customerPage <= 1 || customerTotalPages === 0 || customerListStatus === 'loading'}
                        onClick={() => setCustomerPage((current) => Math.max(1, current - 1))}
                      >
                        <ChevronLeft aria-hidden="true" /> Previous
                      </button>
                      <button
                        type="button"
                        className="admin-button admin-button--secondary admin-button--compact"
                        aria-label="Next customers page"
                        disabled={customerPage >= customerTotalPages || customerTotalPages === 0 || customerListStatus === 'loading'}
                        onClick={() => setCustomerPage((current) => Math.min(customerTotalPages, current + 1))}
                      >
                        Next <ChevronRight aria-hidden="true" />
                      </button>
                    </div>
                  </nav>
                </section>
              )}

              {activeSection === 'analytics' && (
                <section className="space-y-6">
                  {renderReportingSummary()}
                  <div>
                    <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-[#7d7267]">Operational snapshots</h2>
                    <div className="admin-metric-grid">
                      {metricCards.map(([label, value]) => (
                        <div key={label} className="admin-metric-card">
                          <div className="admin-metric-card__label">{label}</div>
                          <div className="admin-metric-card__value">{value}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                    <div className={panelClass}>
                      <div className="admin-panel-header">
                        <h2>Daily sales comparison</h2>
                      </div>
                      {reportStatus === 'loading' && <p role="status" className="admin-empty-state">Loading chart data…</p>}
                      {reportStatus === 'error' && <p role="alert" className="admin-reporting-error">Sales comparison is unavailable because the report failed to load.</p>}
                      {reportStatus === 'loaded' && report && (
                        <>
                          <div className="admin-report-chart__legend" aria-label="Chart series">
                            <span><i className="admin-report-chart__swatch admin-report-chart__swatch--current" />Current period</span>
                            <span><i className="admin-report-chart__swatch admin-report-chart__swatch--previous" />Previous period</span>
                          </div>
                          <div className="admin-report-chart">
                            {report.chartData.map((entry) => {
                              return (
                                <div
                                  key={entry.localDate}
                                  className="admin-report-chart__row"
                                  aria-label={`${entry.localDate}: current ${formatInr(entry.current.revenue)}, ${entry.current.orders} orders; previous ${formatInr(entry.previous.revenue)}, ${entry.previous.orders} orders`}
                                >
                                  <span className="admin-report-chart__date">{entry.localDate}</span>
                                  <div className="admin-report-chart__bars" aria-hidden="true">
                                    <div className="admin-report-chart__bar admin-report-chart__bar--current" style={{ width: `${Math.max(0, (entry.current.revenue / reportChartMaxRevenue) * 100)}%` }} />
                                    <div className="admin-report-chart__bar admin-report-chart__bar--previous" style={{ width: `${Math.max(0, (entry.previous.revenue / reportChartMaxRevenue) * 100)}%` }} />
                                  </div>
                                  <span className="admin-report-chart__values">
                                    Current {formatInr(entry.current.revenue)} · {entry.current.orders} orders
                                    <br />
                                    Previous {formatInr(entry.previous.revenue)} · {entry.previous.orders} orders
                                  </span>
                                </div>
                              );
                            })}
                            {report.chartData.length === 0 && (
                              <p className="admin-empty-state">No sales data available for this reporting period.</p>
                            )}
                          </div>
                        </>
                      )}
                    </div>

                    <div className={panelClass}>
                      <div className="admin-panel-header">
                        <h2>Products by Category</h2>
                      </div>
                      <div className="admin-row-list">
                        {categoryDistribution.map((category) => (
                          <div key={category.name} className="admin-row-item">
                            <span className="text-xs text-[#2a2724]">{category.name}</span>
                            <span className="text-xs text-[#7d7267]">{category.count} products</span>
                          </div>
                        ))}
                        {categoryDistribution.length === 0 && (
                          <p className="admin-empty-state">
                            {statsStatus === 'error' ? 'Category analytics are unavailable because data failed to load.' : 'No product categories available.'}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {activeSection === 'settings' && (
                <section className={`${panelClass} max-w-2xl`}>
                  <div className="admin-panel-header">
                    <h2>Admin Settings</h2>
                  </div>
                  <p className="text-xs text-[#7d7267] mb-4">{user?.email} · <span className="capitalize">{user?.role}</span></p>

                  <form onSubmit={handleAdminProfileSave} className="space-y-3">
                    <h3 className="font-serif text-xl">Administrator profile</h3>
                    <label className="admin-form-field admin-form-field--full">
                      Name
                      <input className={inputClass} value={profileForm.name} onChange={(event) => setProfileForm((form) => ({ ...form, name: event.target.value }))} required minLength={2} maxLength={100} />
                    </label>
                    <label className="admin-form-field admin-form-field--full">
                      Phone
                      <input className={inputClass} value={profileForm.phone} onChange={(event) => setProfileForm((form) => ({ ...form, phone: event.target.value }))} maxLength={25} />
                    </label>
                    <button type="submit" className="admin-button admin-button--secondary">Save profile</button>
                  </form>

                  <form onSubmit={handleAdminPasswordChange} className="mt-8 space-y-3 border-t border-[#8f8a82]/20 pt-6">
                    <h3 className="font-serif text-xl">Change password</h3>
                    <label className="admin-form-field admin-form-field--full">
                      Current password
                      <PasswordInput id="admin-current-password" autoComplete="current-password" className={inputClass} value={passwordForm.currentPassword} onChange={(event) => setPasswordForm((form) => ({ ...form, currentPassword: event.target.value }))} required />
                    </label>
                    <label className="admin-form-field admin-form-field--full">
                      New password
                      <PasswordInput id="admin-new-password" autoComplete="new-password" className={inputClass} value={passwordForm.newPassword} onChange={(event) => setPasswordForm((form) => ({ ...form, newPassword: event.target.value }))} required minLength={8} maxLength={128} />
                    </label>
                    <button type="submit" className="admin-button admin-button--secondary">Change password</button>
                  </form>

                  <button type="button" onClick={handleLogout} className="admin-button admin-button--secondary mt-6 inline-flex items-center gap-2"><LogOut className="w-4 h-4" />Logout</button>
                </section>
              )}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
