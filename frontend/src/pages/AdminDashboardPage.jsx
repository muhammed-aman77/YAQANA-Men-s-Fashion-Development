import React, { useEffect, useReducer, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminService, authService, categoryService, orderService, productService, supportService, uploadService } from '../services/api';
import { BarChart3, Boxes, Copy, LayoutDashboard, LifeBuoy, LogOut, Menu, Package, PenSquare, Plus, Search, Send, Settings, Users, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { catalogUnitsToRupees, formatInr, rupeesToCatalogUnits } from '../utils/currency';
import { getProductImage } from '../utils/productImage';
import { buildVariantMatrix } from '../utils/productVariants';
import { clearInventoryRequestKey, getInventoryRequestKey, updateInventoryDraft } from '../utils/inventoryDraft';
import { adminNavigationReducer, initialAdminNavigationState } from '../utils/adminNavigation';
import { buildSupportTicketQuery, SUPPORT_TICKET_PRIORITIES, SUPPORT_TICKET_STATUSES } from '../utils/supportCenter';
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

const sections = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'products', label: 'Products', icon: Package },
  { id: 'catalogue', label: 'Categories & Collections', icon: Boxes },
  { id: 'orders', label: 'Orders', icon: Boxes },
  { id: 'customers', label: 'Customers', icon: Users },
  { id: 'inventory', label: 'Inventory', icon: Boxes },
  { id: 'support', label: 'Support Centre', icon: LifeBuoy },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'settings', label: 'Settings', icon: Settings }
];

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
  const [chartData, setChartData] = useState([]);
  const [customers, setCustomers] = useState([]);
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
  const [inventoryItems, setInventoryItems] = useState([]);
  const [inventorySummary, setInventorySummary] = useState(null);
  const [stockMovements, setStockMovements] = useState([]);
  const [inventoryDrafts, setInventoryDrafts] = useState({});
  const [inventorySubmitting, setInventorySubmitting] = useState({});
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
  const [editingId, setEditingId] = useState(null);
  const [productEditorDirty, setProductEditorDirty] = useState(false);
  const productEditorDialogRef = useRef(null);
  const [productSearch, setProductSearch] = useState('');
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

  const loadAdminData = async () => {
    setLoading(true);
    setStatsStatus('loading');
    try {
      const [statsRes, customersRes, firstProductsRes, ordersRes, categoriesRes, collectionsRes, inventoryRes, movementsRes] = await Promise.all([
        adminService.getStats(),
        adminService.getCustomers(),
        productService.getProducts({ limit: 100, page: 1 }),
        orderService.getAllOrders({ limit: 50 }),
        categoryService.getCategories(),
        productService.getCollections(),
        adminService.getInventory(),
        adminService.getInventoryMovements({ limit: 50 })
      ]);

      const productPages = firstProductsRes.data.totalPages > 1
        ? await Promise.all(Array.from({ length: firstProductsRes.data.totalPages - 1 }, (_, index) => productService.getProducts({ limit: 100, page: index + 2 })))
        : [];

      if (!statsRes.data.success) throw new Error('Admin analytics response was unsuccessful.');
      setStats(statsRes.data.stats || statsRes.data);
      setChartData(statsRes.data.chartData || []);
      setCategoryDistribution(statsRes.data.categoryDistribution || []);
      setStatsStatus('loaded');

      if (customersRes.data.success) setCustomers(customersRes.data.customers || []);
      if (firstProductsRes.data.success) setProducts([...(firstProductsRes.data.products || []), ...productPages.flatMap((page) => page.data.products || [])]);
      if (ordersRes.data.success) setOrders(ordersRes.data.orders || []);
      if (categoriesRes.data.success) setCategories(categoriesRes.data.categories || []);
      if (inventoryRes.data.success) {
        setInventoryItems(inventoryRes.data.inventory || []);
        setInventorySummary(inventoryRes.data.summary || null);
      }
      if (movementsRes.data.success) setStockMovements(movementsRes.data.movements || []);
      if (collectionsRes.data.success) {
        setCollections(collectionsRes.data.collections || []);
        setCollectionRecords(collectionsRes.data.collectionRecords || []);
      }
    } catch (err) {
      setStatsStatus('error');
      showNotice(err.response?.data?.message || 'Could not load admin data. Check the API connection and your administrator session.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAdminData();
  }, []);

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

    if (editingId && !dialog.open) {
      dialog.showModal();
      dialog.querySelector('[name="name"]')?.focus();
    } else if (!editingId && dialog.open) {
      dialog.close();
    }
  }, [editingId]);

  const resetProductEditor = () => {
    if (productEditorDialogRef.current?.open) productEditorDialogRef.current.close();
    setEditingId(null);
    setProductForm(initialProductForm);
    setColourGalleryDraft({});
    setVariantMatrixDirty(false);
    setProductEditorDirty(false);
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
      setEditingId(null);
      setProductEditorDirty(false);
      await loadAdminData();
    } catch (err) {
      showNotice(err.response?.data?.message || 'Product save failed.', 'error');
    }
  };

  const handleEdit = (product) => {
    setEditingId(product._id);
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

    setEditingId(null);
    setProductEditorDirty(false);
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
    } catch (err) {
      showNotice(err.response?.data?.message || 'Order status update failed.', 'error');
    }
  };

  const handleCustomerStatus = async (id, status) => {
    try {
      await adminService.updateCustomerStatus(id, { status });
      showNotice('Customer account status updated.');
      await loadAdminData();
    } catch (err) {
      showNotice(err.response?.data?.message || 'Customer status update failed.', 'error');
    }
  };

  const handleInventoryAdjustment = async (event, item) => {
    event.preventDefault();
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
      await adminService.adjustInventory({
        adjustments: [{ ...(item.sku ? { sku: item.sku } : { productId: item.productId }), delta }],
        reason: draft.reason.trim()
      }, idempotencyKey);
      try {
        clearInventoryRequestKey(String(key), idempotencyKey, window.sessionStorage);
      } catch (storageError) {
        showNotice(`Inventory was saved, but the retry key could not be cleared: ${storageError.message}. Do not repeat this adjustment.`, 'error');
        setInventoryDrafts((current) => ({ ...current, [key]: { delta: '', reason: '' } }));
        await loadAdminData();
        return;
      }
      setInventoryDrafts((current) => ({ ...current, [key]: { delta: '', reason: '' } }));
      showNotice(`Inventory updated for ${item.sku || item.productName}.`);
      await loadAdminData();
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

  const filteredProducts = products.filter((product) =>
    `${product.name} ${product.category}`.toLowerCase().includes(productSearch.toLowerCase())
  );
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
  const inputClass = 'admin-input';
  const panelClass = 'admin-panel';
  const ProductEditorContainer = editingId ? 'dialog' : 'div';

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
              {sections.map(({ id, label, icon: Icon }) => (
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
              ))}

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
                  <div className="admin-header__eyebrow">Management workspace</div>
                  <h1 className="admin-header__title">Admin Dashboard</h1>
                </div>
              </div>
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
                        {orders.slice(0, 5).map((order) => (
                          <div key={order._id} className="admin-row-item">
                            <div className="admin-row-copy">
                              <strong>{order.customer?.name || 'Customer'}</strong>
                              <span>{order.orderStatus} · {order.paymentMethod}</span>
                            </div>
                            <span className="font-medium text-xs text-xora-charcoal">{formatInr(order.total)}</span>
                          </div>
                        ))}
                        {orders.length === 0 && <p className="admin-empty-state">No orders yet.</p>}
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
                  <ProductEditorContainer
                    ref={productEditorDialogRef}
                    className={`${panelClass} admin-product-editor ${editingId ? 'admin-product-editor-dialog' : ''}`}
                    aria-labelledby={editingId ? 'admin-product-editor-title' : undefined}
                    aria-modal={editingId ? 'true' : undefined}
                    onCancel={editingId ? handleProductEditorCancel : undefined}
                    onKeyDown={editingId ? handleProductEditorKeyDown : undefined}
                  >
                    <div className={`admin-panel-header ${editingId ? 'admin-product-editor__header' : ''}`}>
                      <div>
                        {editingId ? (
                          <>
                            <span className="admin-product-editor__eyebrow">Editing product</span>
                            <h2 id="admin-product-editor-title">{productForm.name || 'Product details'}</h2>
                          </>
                        ) : <h2>Add Product</h2>}
                      </div>
                      {editingId && (
                        <button
                          type="button"
                          onClick={closeProductEditor}
                          className="admin-button admin-button--ghost admin-product-editor__close"
                          aria-label="Close product editor"
                        >
                          <X aria-hidden="true" />
                        </button>
                      )}
                    </div>

                    <form
                      onSubmit={handleSubmit}
                      onChangeCapture={() => { if (editingId) setProductEditorDirty(true); }}
                      className={editingId ? 'admin-product-editor__form' : ''}
                    >
                      <div className={editingId ? 'admin-product-editor__body' : 'space-y-3'}>
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
                                <thead><tr><th>Size</th><th>Colour</th><th>SKU</th><th>Stock</th></tr></thead>
                                <tbody>
                                  {productForm.variants.map((variant, index) => (
                                    <tr key={`${variant.size}-${variant.colour}`}>
                                      <td>{variant.size}</td>
                                      <td>{variant.colour}</td>
                                      <td><input aria-label={`${variant.size} ${variant.colour} SKU`} className={inputClass} value={variant.sku} readOnly /></td>
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
                                  ))}
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
                      <div className={editingId ? 'admin-product-editor__footer' : ''}>
                        {editingId && (
                          <button type="button" onClick={closeProductEditor} className="admin-button admin-button--secondary">
                            Cancel
                          </button>
                        )}
                        <button type="submit" disabled={uploadingImage || variantMatrixDirty} className={`admin-button admin-button--primary ${editingId ? '' : 'w-full'}`}>
                        {editingId ? <PenSquare className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                        {editingId ? 'Save Changes' : 'Add Product'}
                        </button>
                      </div>
                    </form>
                  </ProductEditorContainer>

                  <div className={`${panelClass} admin-product-list-panel`}>
                    <div className="admin-panel-header">
                      <h2>Products ({products.length})</h2>
                      <label className="relative block w-full sm:max-w-xs">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#7d7267]" />
                        <input value={productSearch} onChange={(e) => setProductSearch(e.target.value)} placeholder="Search products" className={`${inputClass} pl-9`} />
                      </label>
                    </div>

                    <div className="admin-product-list">
                      {filteredProducts.map((product) => (
                        <div key={product._id} className="admin-product-card">
                          <div className="admin-product-card__thumb">
                            <img src={getProductImage(product)} alt={product.name} onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = getProductImage({ category: product.category }); }} />
                          </div>
                          <div className="admin-product-card__content">
                            <strong className="admin-product-card__name">{product.name}</strong>
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
                            {product.active === true ? (
                              <>
                                <button type="button" onClick={() => handleProductStatusChange(product, 'discontinue')} className="admin-button admin-button--secondary">Discontinue</button>
                                <button type="button" onClick={() => handleProductStatusChange(product, 'archive')} className="admin-button admin-button--danger">Archive</button>
                              </>
                            ) : (
                              <button type="button" onClick={() => handleProductStatusChange(product, 'activate')} className="admin-button admin-button--secondary">Activate</button>
                            )}
                          </div>
                        </div>
                      ))}
                      {filteredProducts.length === 0 && <p className="admin-empty-state text-center">No products match this search.</p>}
                    </div>
                  </div>
                </section>
              )}

              {activeSection === 'inventory' && (
                <section className="admin-inventory-layout">
                  <div className={panelClass}>
                    <div className="admin-panel-header">
                      <h2>SKU inventory ({inventoryItems.length})</h2>
                    </div>
                    <p className="mb-4 text-xs text-[#7d7267]">Adjustments are recorded with an operator, reason, before/after counts, and an idempotency key.</p>
                    {inventorySummary && (
                      <div className="admin-metric-grid admin-inventory-report mb-4" role="region" aria-label="Inventory summary">
                        {[
                          ['Products tracked', inventorySummary.totalProducts],
                          ['Stock records', inventorySummary.stockRecords],
                          ['Units on hand', inventorySummary.unitsOnHand],
                          ['Low stock records', inventorySummary.lowStockRecords],
                          ['Out of stock records', inventorySummary.outOfStockRecords]
                        ].map(([label, value]) => (
                          <div key={label} className="admin-metric-card">
                            <p className="admin-metric-card__label">{label}</p>
                            <p className="admin-metric-card__value">{value.toLocaleString('en-IN')}</p>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="admin-inventory-list">
                      {inventoryItems.map((item) => {
                        const key = item.sku || item.productId;
                        const draft = inventoryDrafts[key] || { delta: '', reason: '' };
                        return (
                          <article key={key} className="admin-inventory-row">
                            <div className="admin-row-copy">
                              <strong>{item.productName}{item.sku ? ` · ${item.sku}` : ' · Legacy stock'}</strong>
                              <span>{item.category}{item.size ? ` · ${item.size} · ${item.colour}` : ''}</span>
                            </div>
                            <div className="admin-inventory-row__status">
                              <strong>{item.stock} units</strong>
                              <span className={item.status === 'in_stock' ? 'text-emerald-800' : 'text-amber-800'}>{getInventoryStatus(item.stock)}</span>
                            </div>
                            <form className="admin-inventory-adjustment" onSubmit={(event) => handleInventoryAdjustment(event, item)}>
                              <label className="admin-form-field">
                                Change (+/-)
                                <input
                                  className={inputClass}
                                  type="number"
                                  step="1"
                                  value={draft.delta}
                                  disabled={Boolean(inventorySubmitting[key])}
                                  onChange={(event) => setInventoryDrafts((current) => ({
                                    ...current,
                                    [key]: updateInventoryDraft(current[key] || { delta: '', reason: '' }, { delta: event.target.value })
                                  }))}
                                  required
                                />
                              </label>
                              <label className="admin-form-field">
                                Reason
                                <input
                                  className={inputClass}
                                  value={draft.reason}
                                  disabled={Boolean(inventorySubmitting[key])}
                                  onChange={(event) => setInventoryDrafts((current) => ({
                                    ...current,
                                    [key]: updateInventoryDraft(current[key] || { delta: '', reason: '' }, { reason: event.target.value })
                                  }))}
                                  maxLength={300}
                                  minLength={5}
                                  required
                                />
                              </label>
                              <button type="submit" disabled={Boolean(inventorySubmitting[key])} className="admin-button admin-button--secondary">
                                {inventorySubmitting[key] ? 'Saving…' : 'Adjust stock'}
                              </button>
                            </form>
                          </article>
                        );
                      })}
                      {inventoryItems.length === 0 && <p className="admin-empty-state">No inventory records are available.</p>}
                    </div>
                  </div>

                  <div className={panelClass}>
                    <div className="admin-panel-header">
                      <h2>Stock movement history</h2>
                    </div>
                    <div className="admin-row-list">
                      {stockMovements.map((movement) => (
                        <article key={movement._id} className="admin-row-item">
                          <div className="admin-row-copy">
                            <strong>{movement.type.replaceAll('_', ' ')} · {movement.performedBy?.name || 'Administrator'}</strong>
                            <span>{movement.reason} · {new Date(movement.createdAt).toLocaleString()}</span>
                            {movement.changes.map((change, index) => (
                              <span key={`${change.sku || change.product}-${index}`}>
                                {change.productName}{change.sku ? ` · ${change.sku}` : ''}: {change.stockBefore} → {change.stockAfter} ({change.quantityDelta > 0 ? '+' : ''}{change.quantityDelta})
                              </span>
                            ))}
                          </div>
                        </article>
                      ))}
                      {stockMovements.length === 0 && <p className="admin-empty-state">No stock movements have been recorded.</p>}
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
                      <label className="admin-form-field admin-form-field--full">
                        Customer account
                        <select
                          className={inputClass}
                          value={supportForm.customerId}
                          onChange={(event) => setSupportForm((form) => ({ ...form, customerId: event.target.value, orderId: '' }))}
                        >
                          <option value="">My administrator account</option>
                          {customers.map((customer) => (
                            <option key={customer._id} value={customer._id}>{customer.name} · {customer.email}</option>
                          ))}
                        </select>
                      </label>
                      <label className="admin-form-field admin-form-field--full">
                        Related order (optional)
                        <select
                          className={inputClass}
                          value={supportForm.orderId}
                          onChange={(event) => setSupportForm((form) => ({ ...form, orderId: event.target.value }))}
                        >
                          <option value="">No related order</option>
                          {orders.filter((order) => String(order.customer?._id || order.customer) === String(supportForm.customerId || user?._id))
                            .map((order) => (
                              <option key={order._id} value={order._id}>Order {String(order._id).slice(-8)} · {order.orderStatus}</option>
                            ))}
                        </select>
                      </label>
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
                      <label className="admin-form-field admin-form-field--full">
                        Priority
                        <select
                          className={inputClass}
                          value={supportForm.priority}
                          onChange={(event) => setSupportForm((form) => ({ ...form, priority: event.target.value }))}
                        >
                          {SUPPORT_TICKET_PRIORITIES.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
                        </select>
                      </label>
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
                      <label className="admin-form-field">
                        Status
                        <select
                          className={inputClass}
                          value={supportFilters.status}
                          onChange={(event) => { setSupportFilters((filters) => ({ ...filters, status: event.target.value })); setSupportPage(1); }}
                        >
                          <option value="all">All statuses</option>
                          {SUPPORT_TICKET_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                        </select>
                      </label>
                      <label className="admin-form-field">
                        Priority
                        <select
                          className={inputClass}
                          value={supportFilters.priority}
                          onChange={(event) => { setSupportFilters((filters) => ({ ...filters, priority: event.target.value })); setSupportPage(1); }}
                        >
                          <option value="all">All priorities</option>
                          {SUPPORT_TICKET_PRIORITIES.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
                        </select>
                      </label>
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
                              <label className="admin-form-field">
                                Status
                                <select className={inputClass} value={supportEdit.status} onChange={(event) => setSupportEdit((current) => ({ ...current, status: event.target.value }))}>
                                  {SUPPORT_TICKET_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                                </select>
                              </label>
                              <label className="admin-form-field">
                                Priority
                                <select className={inputClass} value={supportEdit.priority} onChange={(event) => setSupportEdit((current) => ({ ...current, priority: event.target.value }))}>
                                  {SUPPORT_TICKET_PRIORITIES.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
                                </select>
                              </label>
                              <label className="admin-form-field">
                                Assigned to
                                <select className={inputClass} value={supportEdit.assignedTo} onChange={(event) => setSupportEdit((current) => ({ ...current, assignedTo: event.target.value }))}>
                                  <option value="">Unassigned</option>
                                  {supportAssignees.map((assignee) => <option key={assignee._id} value={assignee._id}>{assignee.name} · {assignee.email}</option>)}
                                </select>
                              </label>
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
                <section className={panelClass}>
                  <div className="admin-panel-header">
                    <h2>Orders ({orders.length})</h2>
                  </div>
                  <div className="admin-order-list">
                    {orders.map((order) => (
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
                          <select aria-label={`Order status for ${order.customer?.name || 'customer'}`} value={order.orderStatus} onChange={(e) => handleOrderStatus(order._id, e.target.value)} className={inputClass}>
                            {getAdminOrderStatusOptions(order).map((status) => <option key={status} value={status}>{status}</option>)}
                          </select>
                        </div>
                      </article>
                    ))}
                    {orders.length === 0 && <p className="admin-empty-state">No orders yet.</p>}
                  </div>
                </section>
              )}

              {activeSection === 'customers' && (
                <section className={panelClass}>
                  <div className="admin-panel-header">
                    <h2>Customers ({customers.length})</h2>
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
                        <select aria-label={`Account status for ${customer.name}`} value={customer.status} onChange={(e) => handleCustomerStatus(customer._id, e.target.value)} className={inputClass}>
                          {CUSTOMER_STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}
                        </select>
                      </article>
                    ))}
                    {customers.length === 0 && <p className="admin-empty-state">No registered customers yet.</p>}
                  </div>
                </section>
              )}

              {activeSection === 'analytics' && (
                <section className="space-y-6">
                  <div className="admin-metric-grid">
                    {metricCards.map(([label, value]) => (
                      <div key={label} className="admin-metric-card">
                        <div className="admin-metric-card__label">{label}</div>
                        <div className="admin-metric-card__value">{value}</div>
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                    <div className={panelClass}>
                      <div className="admin-panel-header">
                        <h2>Sales by Month</h2>
                      </div>
                      <div className="space-y-4">
                        {chartData.map((entry) => {
                          const maxRevenue = Math.max(...chartData.map((month) => month.revenue || 0), 1);
                          return (
                            <div key={entry.month} className="grid grid-cols-[2.5rem_1fr_auto] items-center gap-3 text-xs">
                              <span>{entry.month}</span>
                              <div className="h-2 bg-[#f0e7de] rounded-full overflow-hidden">
                                <div className="h-full bg-[#2b2724]" style={{ width: `${Math.max(0, (entry.revenue / maxRevenue) * 100)}%` }} />
                              </div>
                              <span>{formatInr(entry.revenue)} · {entry.orders} orders</span>
                            </div>
                          );
                        })}
                        {chartData.length === 0 && (
                          <p className="admin-empty-state">
                            {statsStatus === 'error' ? 'Sales data is unavailable because analytics failed to load.' : 'No sales data available yet.'}
                          </p>
                        )}
                      </div>
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
                      <input type="password" autoComplete="current-password" className={inputClass} value={passwordForm.currentPassword} onChange={(event) => setPasswordForm((form) => ({ ...form, currentPassword: event.target.value }))} required />
                    </label>
                    <label className="admin-form-field admin-form-field--full">
                      New password
                      <input type="password" autoComplete="new-password" className={inputClass} value={passwordForm.newPassword} onChange={(event) => setPasswordForm((form) => ({ ...form, newPassword: event.target.value }))} required minLength={8} maxLength={128} />
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
