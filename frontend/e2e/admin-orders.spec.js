import { expect, test } from '@playwright/test';

const localTestOrigin = new URL(`http://127.0.0.1:${process.env.PLAYWRIGHT_PORT || '4173'}`).origin;

const sampleOrder = {
  _id: '507f191e810c19729de860ea',
  customer: {
    name: 'Alex Customer',
    email: 'alex@example.test',
    phone: '+919876543210'
  },
  orderStatus: 'Confirmed',
  allowedNextStatuses: ['Processing', 'Cancelled'],
  paymentMethod: 'Cash on Delivery',
  paymentStatus: 'Pending',
  createdAt: '2026-11-15T10:30:00.000Z',
  total: 1450,
  shippingAddress: {
    fullName: 'Alex Customer',
    phone: '+919876543210',
    addressLine1: '12 Demo Road',
    city: 'Kolkata',
    state: 'West Bengal',
    postalCode: '700001',
    country: 'India'
  },
  items: [{
    product: 'product-demo',
    name: 'Demo Shirt',
    size: 'M',
    colour: 'Green',
    quantity: 1,
    price: 1450
  }],
  statusHistory: [{
    status: 'Confirmed',
    changedBy: 'internal-staff-id',
    reason: 'Address reviewed',
    at: '2026-11-15T11:00:00.000Z'
  }],
  codState: 'Pending',
  shipment: {
    carrier: 'Demo Courier',
    trackingNumber: 'DEMO-TRACKING-12345',
    shippedAt: null
  }
};

async function openOrders(page, {
  orderTotal = 53,
  orderDelayMs = 0,
  orderStatusCode = 200,
  orderDelayBySearch = {},
  holdOrders = false
} = {}) {
  const orderRequests = [];
  let persistedSavedFilters = [];
  const notificationReadState = new Set();
  let releaseOrders;
  const ordersGate = holdOrders ? new Promise((resolve) => { releaseOrders = resolve; }) : null;
  await page.addInitScript(() => sessionStorage.setItem('xora_token', 'mock-admin-token'));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== localTestOrigin) {
      await route.abort();
      return;
    }
    if (!url.pathname.startsWith('/api/')) {
      await route.continue();
      return;
    }

    let response = { success: true };
    let status = 200;
    if (url.pathname === '/api/admin/preferences') {
      response = { success: true, preferences: { savedFilters: persistedSavedFilters } };
    } else if (url.pathname === '/api/admin/preferences/filters' && route.request().method() === 'PUT') {
      persistedSavedFilters = (await route.request().postDataJSON()).savedFilters;
      response = { success: true, preferences: { savedFilters: persistedSavedFilters } };
    } else if (url.pathname === '/api/auth/profile') {
      response = {
        success: true,
        user: { _id: 'orders-admin', name: 'Local QA Admin', email: 'admin@example.test', role: 'admin', status: 'active', adminMfaVerified: true }
      };
    } else if (url.pathname === '/api/admin/stats') {
      response = {
        success: true,
        stats: { totalProducts: 0, totalOrders: orderTotal, totalCustomers: 1, totalRevenue: 0, pendingOrders: 0, lowStockProducts: 0, deliveredOrders: 0 },
        report: null,
        categoryDistribution: []
      };
    } else if (url.pathname === '/api/admin/notifications/read-state' && route.request().method() === 'PUT') {
      const { notificationId, isRead } = await route.request().postDataJSON();
      if (isRead) notificationReadState.add(notificationId);
      else notificationReadState.delete(notificationId);
      response = { success: true, notificationId, isRead };
    } else if (url.pathname === '/api/admin/notifications') {
      response = {
        success: true,
        source: 'live_orders_and_inventory',
        totalCount: 3,
        notifications: [
          { id: `pending-order-${sampleOrder._id}`, type: 'pending_order', title: 'Order #9de860ea needs attention', detail: 'Alex Customer · Confirmed', section: 'orders', searchTerm: sampleOrder._id, createdAt: sampleOrder.createdAt },
          { id: 'inventory-approval-1', type: 'inventory_approval', title: 'Inventory adjustment for Core Tee needs review', detail: 'TEE-M · -20 units', section: 'inventory', searchTerm: 'TEE-M', createdAt: sampleOrder.createdAt },
          { id: 'low-stock-1', type: 'low_stock', title: 'Oxford Shirt is low on stock', detail: '3 units remaining', section: 'inventory', searchTerm: 'Oxford Shirt', createdAt: sampleOrder.createdAt }
        ].map((item) => ({ ...item, isRead: notificationReadState.has(item.id) })),
        unreadCount: 3 - notificationReadState.size
      };
    } else if (url.pathname === '/api/admin/search') {
      response = {
        success: true,
        term: url.searchParams.get('q'),
        results: [{ id: sampleOrder._id, type: 'order', label: 'Order #9de860ea', detail: 'Alex Customer · Confirmed', section: 'orders', searchTerm: sampleOrder._id }]
      };
    } else if (url.pathname === '/api/admin/customers') {
      response = { success: true, customers: [] };
    } else if (url.pathname === '/api/products') {
      response = { success: true, products: [], totalPages: 1 };
    } else if (url.pathname === '/api/categories') {
      response = { success: true, categories: [] };
    } else if (url.pathname === '/api/products/collections') {
      response = { success: true, collections: [], collectionRecords: [] };
    } else if (url.pathname === '/api/orders') {
      orderRequests.push(new URL(url));
      if (ordersGate && url.searchParams.has('page')) await ordersGate;
      const search = url.searchParams.get('search') || '';
      const delay = orderDelayBySearch[search] || orderDelayMs;
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      const limit = Number(url.searchParams.get('limit') || 50);
      const currentPage = Number(url.searchParams.get('page') || 1);
      const totalPages = Math.ceil(orderTotal / limit);
      status = orderStatusCode;
      response = orderStatusCode >= 400
        ? { success: false, message: 'Orders are temporarily unavailable.' }
        : {
            success: true,
            orders: orderTotal === 0 ? [] : [{
              ...sampleOrder,
              customer: { ...sampleOrder.customer, name: search || sampleOrder.customer.name }
            }],
            totalOrders: orderTotal,
            currentPage,
            totalPages
          };
    } else if (url.pathname === '/api/admin/inventory') {
      response = { success: true, inventory: [], summary: null, totalCount: 0, totalPages: 0 };
    } else if (url.pathname === '/api/admin/inventory/movements') {
      response = { success: true, movements: [], totalCount: 0, currentPage: 1, totalPages: 0 };
    }
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(response)
    });
  });

  await page.goto('/admin');
  const openNavigation = page.getByRole('button', { name: 'Open admin navigation' });
  if (await openNavigation.isVisible()) {
    await openNavigation.click();
    await expect(page.locator('.admin-menu-toggle')).toHaveAttribute('aria-expanded', 'true');
  }
  await page.getByRole('button', { name: 'Sales', exact: true }).click();
  await page.getByRole('button', { name: 'Orders', exact: true }).click();
  const orders = page.getByRole('region', { name: 'Orders' });
  await expect(orders).toBeVisible();
  return { orders, orderRequests, releaseOrders, getPersistedSavedFilters: () => persistedSavedFilters };
}

test('global search opens the matching order and applies its server filter', async ({ page }) => {
  const { orders, orderRequests } = await openOrders(page);
  const search = page.getByRole('combobox', { name: 'Search products, orders, and customers' });
  await search.fill('Alex Customer');
  const result = page.getByRole('option', { name: /Order #9de860ea Alex Customer · Confirmed/ });
  await expect(result).toBeVisible();
  await search.press('ArrowDown');
  await search.press('Enter');
  await expect(orders.getByRole('searchbox', { name: 'Search orders by order ID, customer name, email or phone' })).toHaveValue(sampleOrder._id);
  await expect.poll(() => orderRequests.some((request) => request.searchParams.get('search') === sampleOrder._id)).toBe(true);
});

test('Control or Command K focuses admin global search and Escape closes its results', async ({ page, browserName }) => {
  await openOrders(page);
  const search = page.getByRole('combobox', { name: 'Search products, orders, and customers' });
  await page.keyboard.press(browserName === 'webkit' ? 'Meta+k' : 'Control+k');
  await expect(search).toBeFocused();
  await search.fill('Alex Customer');
  await expect(search).toHaveAttribute('aria-expanded', 'true');
  await search.press('Escape');
  await expect(search).toHaveAttribute('aria-expanded', 'false');
});

test('notification centre reads a real-data-shaped task and links to the order filter', async ({ page }) => {
  const { orders } = await openOrders(page);
  await page.getByRole('button', { name: /Notifications/ }).click();
  const panel = page.getByRole('region', { name: 'Notifications' });
  await expect(panel.getByText('Orders, stock alerts, and adjustments needing attention')).toBeVisible();
  const notification = panel.getByRole('button', { name: /Order #9de860ea needs attention/ });
  await expect(notification).toBeVisible();
  await notification.click();
  await expect(orders.getByRole('searchbox', { name: 'Search orders by order ID, customer name, email or phone' })).toHaveValue(sampleOrder._id);
});

test('notification read state persists when the action centre is reopened', async ({ page }) => {
  await openOrders(page);
  await page.getByRole('button', { name: /Notifications/ }).click();
  const panel = page.getByRole('region', { name: 'Notifications' });
  const markRead = panel.getByRole('button', { name: 'Mark as read' }).first();
  await expect(markRead).toBeVisible();
  await markRead.scrollIntoViewIfNeeded();
  await markRead.click({ timeout: 5000 });
  await expect(page.getByRole('button', { name: 'Notifications, 2 unread' })).toBeVisible();
  await page.getByRole('button', { name: 'Close notifications' }).click();
  await page.getByRole('button', { name: /Notifications/ }).click();
  await expect(panel.getByRole('button', { name: 'Mark as unread' })).toHaveCount(1);
});

test('inventory approval notification opens the matching inventory filter', async ({ page }) => {
  await openOrders(page);
  await page.getByRole('button', { name: /Notifications/ }).click();
  const panel = page.getByRole('region', { name: 'Notifications' });
  const approval = panel.getByRole('button', { name: /Inventory adjustment for Core Tee needs review/ });
  await approval.click();
  await expect(page.getByRole('searchbox', { name: 'Search inventory by product, SKU, size, or colour' })).toHaveValue('TEE-M');
});

test('saved order filters persist through the admin API and can be applied', async ({ page }) => {
  const { orders, getPersistedSavedFilters } = await openOrders(page);
  await orders.getByRole('button', { name: 'Order status All statuses' }).click();
  await page.getByRole('option', { name: 'Pending', exact: true }).click();
  await orders.getByLabel('Save current order filters').fill('Pending queue');
  await orders.getByRole('button', { name: 'Save filter' }).click();
  await expect.poll(() => getPersistedSavedFilters().length).toBe(1);
  expect(getPersistedSavedFilters()[0].filters.status).toBe('Pending');

  await orders.getByRole('button', { name: 'Order status Pending' }).click();
  await page.getByRole('option', { name: 'All statuses' }).click();
  await orders.locator('.admin-saved-filters select').selectOption(getPersistedSavedFilters()[0].id);
  await expect(orders.getByRole('button', { name: 'Order status Pending' })).toBeVisible();
});

test('admin orders combine search and filters and navigate backend pages', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const { orders, orderRequests } = await openOrders(page);
  await expect(orders.getByText('Order #9de860ea', { exact: false })).toBeVisible();

  await orders.getByRole('searchbox', {
    name: 'Search orders by order ID, customer name, email or phone'
  }).fill('alex@example.test');
  await orders.getByRole('button', { name: 'Order status All statuses' }).click();
  await orders.getByRole('option', { name: 'Processing', exact: true }).click();
  await orders.getByRole('button', { name: 'Payment status All payment statuses' }).click();
  await orders.getByRole('option', { name: 'Pending', exact: true }).click();
  await orders.getByRole('button', { name: 'Payment type All payment types' }).click();
  await orders.getByRole('option', { name: 'Cash on delivery', exact: true }).click();
  await orders.getByLabel('Order date from').fill('2026-11-01');
  await orders.getByLabel('Order date to').fill('2026-11-20');

  await expect.poll(() => {
    const latest = orderRequests.at(-1);
    if (!latest) return null;
    return [
      latest.searchParams.get('search'),
      latest.searchParams.get('status'),
      latest.searchParams.get('paymentStatus'),
      latest.searchParams.get('paymentType'),
      latest.searchParams.get('dateFrom'),
      latest.searchParams.get('dateTo')
    ].join('|');
  }).toBe('alex@example.test|Processing|Pending|cod|2026-11-01|2026-11-20');
  await expect(orders.locator('.admin-orders-pagination__summary')).toContainText('Page 1 of 3');

  await orders.getByRole('button', { name: 'Orders per page 25 per page' }).click();
  await orders.getByRole('option', { name: '10 per page', exact: true }).click();
  await expect.poll(() => orderRequests.at(-1)?.searchParams.get('limit')).toBe('10');
  await orders.getByRole('button', { name: 'Next orders page' }).click();
  await expect.poll(() => orderRequests.at(-1)?.searchParams.get('page')).toBe('2');
  await expect(orders.locator('.admin-orders-pagination__summary')).toContainText('Page 2 of 6');
});

test('admin orders expose loading and empty states', async ({ page }) => {
  const { orders, releaseOrders } = await openOrders(page, { orderTotal: 0, holdOrders: true });
  await expect(orders.getByText('Loading orders')).toBeVisible();
  releaseOrders();
  await expect(orders.getByRole('status')).toContainText('No orders match these filters.');
});

test('admin orders reveal chronological status history and read-only fulfilment details', async ({ page }) => {
  const { orders } = await openOrders(page);
  const disclosure = orders.locator('.admin-order-details');

  await expect(disclosure.locator('summary')).toHaveText('Order timeline and fulfilment details');
  await disclosure.locator('summary').click();

  const eventLabels = await disclosure.locator('.admin-order-timeline__entry strong').allTextContents();
  expect(eventLabels).toEqual(['Order placed', 'Confirmed']);
  await expect(disclosure).toContainText('Address reviewed');
  await expect(disclosure).toContainText('COD state: Pending');
  await expect(disclosure).toContainText('Demo Courier');
  await expect(disclosure).toContainText('DEMO-TRACKING-12345');
  await expect(disclosure).not.toContainText('internal-staff-id');
  await expect(disclosure.locator('button')).toHaveCount(0);
});

test('admin orders report API errors without hiding the failure', async ({ page }) => {
  const { orders } = await openOrders(page, { orderStatusCode: 503 });
  await expect(orders.getByRole('alert'))
    .toContainText('Orders are temporarily unavailable.');
});

test('admin orders ignore stale search responses that finish after newer results', async ({ page }) => {
  const { orders, orderRequests } = await openOrders(page, { orderDelayBySearch: { 'old-customer': 700 } });
  const search = orders.getByRole('searchbox', {
    name: 'Search orders by order ID, customer name, email or phone'
  });
  const staleResponse = page.waitForResponse((response) =>
    new URL(response.url()).searchParams.get('search') === 'old-customer'
  );
  await search.fill('old-customer');
  await expect.poll(() => orderRequests.some((request) =>
    request.searchParams.get('search') === 'old-customer'
  )).toBe(true);
  await search.fill('new-customer');
  await expect(orders.getByText('new-customer · alex@example.test')).toBeVisible();
  await staleResponse;
  await expect(orders.getByText('new-customer · alex@example.test')).toBeVisible();
  await expect(orders.getByText('old-customer · alex@example.test')).toHaveCount(0);
});

test('admin orders fit compact phones, tablets, and desktop widths', async ({ page }) => {
  const { orders } = await openOrders(page);
  const disclosure = orders.locator('.admin-order-details');
  await disclosure.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(disclosure).toHaveAttribute('open', '');

  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(orders.getByRole('searchbox', {
      name: 'Search orders by order ID, customer name, email or phone'
    })).toBeVisible();
    await expect(disclosure.getByText('DEMO-TRACKING-12345')).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      viewportWidth: document.documentElement.clientWidth,
      contentWidth: document.documentElement.scrollWidth
    }));
    expect(dimensions.contentWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
    const disclosureDimensions = await disclosure.evaluate((element) => ({
      contentWidth: element.scrollWidth,
      visibleWidth: element.clientWidth
    }));
    expect(disclosureDimensions.contentWidth).toBeLessThanOrEqual(disclosureDimensions.visibleWidth);
  }
});

test('admin customers search and paginate with server-backed filters', async ({ page }) => {
  await openOrders(page);
  const customerRequests = [];
  await page.route('**/api/admin/customers**', async (route) => {
    const url = new URL(route.request().url());
    customerRequests.push(url);
    const search = url.searchParams.get('search') || '';
    const currentPage = Number(url.searchParams.get('page') || 1);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        customers: [{
          _id: `customer-${currentPage}`,
          name: search || `Customer ${currentPage}`,
          email: 'customer@example.test',
          phone: '+919876543210',
          status: 'active',
          orderCount: 2,
          totalSpent: 2900
        }],
        totalCustomers: 13,
        currentPage,
        totalPages: Number(url.searchParams.get('limit')) === 10 ? 2 : 1
      })
    });
  });

  const openNavigation = page.getByRole('button', { name: 'Open admin navigation' });
  if (await openNavigation.isVisible()) await openNavigation.click();
  await page.getByRole('button', { name: 'Customers', exact: true }).click();
  const customers = page.getByRole('region', { name: 'Customers' });
  const search = customers.getByRole('searchbox', { name: 'Search customers by name, email or phone' });
  await expect(search).toBeVisible();
  await search.fill('alex@example.test');
  await customers.getByRole('button', { name: 'Customer status All customers' }).click();
  await customers.getByRole('option', { name: 'Blocked', exact: true }).click();
  await expect.poll(() => customerRequests.at(-1)?.searchParams.toString()).toContain('search=alex%40example.test');
  await expect.poll(() => customerRequests.at(-1)?.searchParams.get('status')).toBe('blocked');
  await expect.poll(() => customerRequests.at(-1)?.searchParams.get('page')).toBe('1');
  await expect(customers).toContainText('alex@example.test');
  await expect(customers.locator('.admin-customer-pagination__summary')).toContainText('Page 1 of 2');
  await customers.getByRole('button', { name: 'Next customers page' }).click();
  await expect.poll(() => customerRequests.at(-1)?.searchParams.get('page')).toBe('2');
  await expect(customers.locator('.admin-customer-pagination__summary')).toContainText('Page 2 of 2');
});

test('admin customer details disclose only the selected profile address book and recent orders', async ({ page }) => {
  await openOrders(page);
  await page.route('**/api/admin/customers**', async (route) => {
    const url = new URL(route.request().url());
    const customer = {
      _id: 'customer-1',
      name: 'Alex Customer',
      email: 'alex@example.test',
      phone: '+919876543210',
      status: 'active',
      orderCount: 4,
      totalSpent: 2900
    };
    const response = url.pathname.endsWith('/customer-1')
      ? {
          success: true,
          customer: {
            ...customer,
            addresses: [{ _id: 'address-1', fullName: 'Alex Customer', addressLine1: '12 Demo Road', city: 'Kolkata', postalCode: '700001', country: 'India', isDefault: true }],
            orders: [{ _id: '507f191e810c19729de860ea', orderStatus: 'Delivered', paymentMethod: 'Cash on Delivery', paymentStatus: 'Paid', createdAt: '2026-11-15T10:30:00.000Z', total: 1450, items: [{ name: 'Demo Shirt', size: 'M', quantity: 2 }] }]
          }
        }
      : { success: true, customers: [customer], totalCustomers: 1, currentPage: 1, totalPages: 1 };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
  });
  const openNavigation = page.getByRole('button', { name: 'Open admin navigation' });
  if (await openNavigation.isVisible()) await openNavigation.click();
  await page.getByRole('button', { name: 'Customers', exact: true }).click();
  const customers = page.getByRole('region', { name: 'Customers' });
  await customers.getByRole('button', { name: 'View details' }).click();
  const addressBook = customers.getByRole('region', { name: 'Customer addresses' });
  await expect(addressBook).toContainText('Default address');
  await expect(addressBook).toContainText('12 Demo Road');
  await expect(customers.getByRole('region', { name: 'Recent customer orders' })).toContainText('Order #9de860ea');
  await expect(customers.getByRole('region', { name: 'Recent customer orders' })).toContainText('Delivered');
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const dimensions = await page.evaluate(() => ({
      viewportWidth: document.documentElement.clientWidth,
      contentWidth: document.documentElement.scrollWidth
    }));
    expect(dimensions.contentWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
  }
  await customers.getByRole('button', { name: 'Hide details' }).click();
  await expect(customers.getByRole('region', { name: 'Recent customer orders' })).toHaveCount(0);
});
