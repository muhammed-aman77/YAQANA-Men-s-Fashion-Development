import { expect, test } from '@playwright/test';

const localTestOrigin = new URL(`http://127.0.0.1:${process.env.PLAYWRIGHT_PORT || '4173'}`).origin;

const inventoryRows = [
  {
    productId: 'product-tee',
    productName: 'Core Tee',
    category: 'T-Shirts',
    image: '/images/xora-products/t-shirts.jpg',
    sku: 'CORE-TEE-S',
    size: 'S',
    colour: 'Black',
    onHand: 5,
    stock: 5,
    reservedQuantity: 1,
    availableStock: 4,
    committedQuantity: 1,
    incomingQuantity: 6,
    variantStatus: 'active',
    pricePaise: 45000,
    retailValuePaise: 225000,
    reorderTarget: 15,
    restockSuggestion: 5,
    lastActivity: '2026-11-18T12:00:00.000Z',
    status: 'low_stock',
    stockStatus: 'low_stock',
    active: true
  },
  {
    productId: 'product-shirt',
    productName: 'Linen Shirt',
    category: 'Shirts',
    image: '/images/xora-products/shirts.jpg',
    sku: 'LINEN-SHIRT-M',
    size: 'M',
    colour: 'Sand',
    onHand: 20,
    stock: 20,
    reservedQuantity: 0,
    availableStock: 20,
    committedQuantity: 0,
    incomingQuantity: 0,
    variantStatus: 'discontinued',
    pricePaise: 92000,
    retailValuePaise: 1840000,
    reorderTarget: null,
    restockSuggestion: null,
    lastActivity: null,
    status: 'in_stock',
    stockStatus: 'in_stock',
    active: true
  }
];

const inventorySummary = {
  totalProducts: 2,
  totalSkus: 2,
  stockRecords: 2,
  unitsOnHand: 25,
  unallocatedLegacyUnits: 0,
  availableUnits: 24,
  reservedUnits: 1,
  committedUnits: 1,
  incomingUnits: 6,
  lowStockRecords: 1,
  criticalStockRecords: 0,
  outOfStockRecords: 0,
  retailValuePaise: 2065000,
  costedQuantity: 0,
  costedValuePaise: 0,
  uncostedQuantity: 25,
  acquisitionValuePaise: null,
  pendingReceiptCount: 1
};

async function openInventory(page, {
  adjustmentResponse = null,
  approvalsResponse = null,
  inboundResponse = null,
  inboundReceiveStatus = 503,
  transactionsSupported = true,
  inventoryPolicyResponse = { success: true, policy: { normalAdjustmentLimit: 10, enhancedConfirmationLimit: 25, adminApprovalLimit: 50 } },
  productsResponse = [],
  inventoryRowsResponse = inventoryRows,
  inventorySearchRowsResponse = inventoryRowsResponse
} = {}) {
  const adjustmentRequests = [];
  const inventoryRequests = [];
  const approvalRequests = [];
  const inboundRequests = [];
  const receiveRequests = [];
  const restoreRequests = [];
  let currentInventoryRows = inventoryRowsResponse;
  let currentSearchInventoryRows = inventorySearchRowsResponse;
  await page.setViewportSize({ width: 1280, height: 900 });
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
    let responseStatus = 200;
    if (url.pathname === '/api/auth/profile') {
      response = {
        success: true,
        user: { _id: 'inventory-admin', name: 'Local Admin', email: 'admin@example.test', role: 'admin', status: 'active', adminMfaVerified: true }
      };
    } else if (url.pathname === '/api/admin/stats') {
      response = {
        success: true,
        stats: { totalProducts: 24, totalOrders: 0, totalCustomers: 0, totalRevenue: 0, pendingOrders: 0, lowStockProducts: 1, deliveredOrders: 0 },
        report: null,
        categoryDistribution: []
      };
    } else if (url.pathname === '/api/admin/customers') {
      response = { success: true, customers: [] };
    } else if (url.pathname === '/api/products') {
      response = { success: true, products: productsResponse, totalPages: 1 };
    } else if (url.pathname === '/api/orders') {
      response = { success: true, orders: [] };
    } else if (url.pathname === '/api/categories') {
      response = { success: true, categories: [{ _id: 'shirts', name: 'Shirts' }, { _id: 'tees', name: 'T-Shirts' }] };
    } else if (url.pathname === '/api/products/collections') {
      response = { success: true, collections: [], collectionRecords: [] };
    } else if (url.pathname === '/api/admin/inventory') {
      inventoryRequests.push(url);
      const search = (url.searchParams.get('search') || '').toLowerCase();
      const variantStatus = url.searchParams.get('variantStatus') || 'all';
      const incomingOnly = url.searchParams.get('incomingOnly') === 'true';
      const sourceRows = search ? currentSearchInventoryRows : currentInventoryRows;
      const filtered = sourceRows.filter((row) => {
        const matchesSearch = [row.productName, row.sku, row.category, row.size, row.colour]
          .some((value) => value.toLowerCase().includes(search));
        return matchesSearch
          && (variantStatus === 'all' || row.variantStatus === variantStatus)
          && (!incomingOnly || row.incomingQuantity > 0);
      });
      const pageSize = Number(url.searchParams.get('limit') || 50);
      response = {
        success: true,
        inventory: filtered.slice(0, pageSize),
        summary: inventorySummary,
        lowStockThreshold: 10,
        criticalStockThreshold: 3,
        transactionSupportAvailable: transactionsSupported,
        totalCount: filtered.length,
        totalPages: Math.ceil(filtered.length / pageSize),
        currentPage: 1,
        pageSize
      };
    } else if (url.pathname === '/api/admin/inventory/policy') {
      response = inventoryPolicyResponse;
    } else if (/^\/api\/admin\/inventory\/products\/[^/]+\/skus\/[^/]+\/restore$/.test(url.pathname) && route.request().method() === 'POST') {
      const pathParts = url.pathname.split('/').map(decodeURIComponent);
      const productId = pathParts[5];
      const sku = pathParts[7];
      const body = route.request().postDataJSON();
      restoreRequests.push({ productId, sku, reason: body.reason });
      const markRestored = (rows) => rows.map((row) =>
        row.productId === productId && row.sku === sku ? { ...row, variantStatus: 'active' } : row
      );
      currentInventoryRows = markRestored(currentInventoryRows);
      currentSearchInventoryRows = markRestored(currentSearchInventoryRows);
      response = { success: true, message: 'SKU restored.' };
    } else if (url.pathname === '/api/admin/inventory/movements') {
      response = { success: true, movements: [], totalCount: 0, currentPage: 1, totalPages: 0 };
    } else if (url.pathname === '/api/admin/inventory/approvals') {
      response = approvalsResponse || { success: true, approvals: [], totalCount: 0, currentPage: 1, totalPages: 0 };
    } else if (url.pathname === '/api/admin/inventory/inbound' && route.request().method() === 'GET') {
      response = inboundResponse || { success: true, receipts: [], totalCount: 0, currentPage: 1, totalPages: 0 };
    } else if (url.pathname === '/api/admin/inventory/inbound' && route.request().method() === 'POST') {
      inboundRequests.push({
        body: route.request().postDataJSON(),
        key: route.request().headers()['idempotency-key']
      });
      responseStatus = 201;
      response = { success: true, message: 'Inbound receipt created.' };
    } else if (url.pathname.startsWith('/api/admin/inventory/inbound/') && route.request().method() === 'POST') {
      receiveRequests.push({
        body: route.request().postDataJSON(),
        key: route.request().headers()['idempotency-key']
      });
      responseStatus = inboundReceiveStatus;
      response = inboundReceiveStatus >= 400
        ? { success: false, message: 'Receiving stock requires MongoDB transactions. No receipt or stock data was changed.' }
        : { success: true, message: 'Inbound receipt quantities recorded.' };
    } else if (url.pathname === '/api/admin/inventory/adjustments' && route.request().method() === 'POST') {
      adjustmentRequests.push(route.request().postDataJSON());
      response = adjustmentResponse || { success: true, movement: {} };
    } else if (url.pathname.startsWith('/api/admin/inventory/approvals/') && route.request().method() === 'POST') {
      approvalRequests.push(url.pathname);
      response = { success: true, approval: { status: 'applied' } };
    }

    await route.fulfill({
      status: responseStatus,
      contentType: 'application/json',
      body: JSON.stringify(response)
    });
  });

  await page.goto('/admin');
  const openNavigation = page.getByRole('button', { name: 'Open admin navigation' });
  if (await openNavigation.isVisible()) await openNavigation.click();
  await page.getByRole('button', { name: 'Operations', exact: true }).click();
  await page.getByRole('button', { name: 'Inventory', exact: true }).click();
  return { adjustmentRequests, approvalRequests, inboundRequests, receiveRequests, restoreRequests, inventoryRequests };
}

test('incoming stock KPI applies an incoming-only inventory query', async ({ page }) => {
  const { inventoryRequests } = await openInventory(page);
  await page.getByRole('button', { name: /Incoming stock/ }).click();
  await expect.poll(() => inventoryRequests.some((request) => request.searchParams.get('incomingOnly') === 'true')).toBe(true);
});

test('SKU inventory stays usable from compact phones to wide desktop viewports', async ({ page }) => {
  await openInventory(page, {
    approvalsResponse: {
      success: true,
      approvals: [{
        _id: 'responsive-approval',
        productName: 'Core Tee',
        sku: 'CORE-TEE-S',
        quantityDelta: 30,
        type: 'correction',
        approvalLevel: 'admin',
        reason: 'Correct the physical count.',
        requestedBy: { name: 'Requesting Admin' }
      }],
      totalCount: 1,
      currentPage: 1,
      totalPages: 1
    },
    inboundResponse: {
      success: true,
      receipts: [{
        _id: 'responsive-receipt',
        product: { name: 'Core Tee' },
        sku: 'CORE-TEE-S',
        expectedQuantity: 6,
        receivedQuantity: 1,
        damagedQuantity: 0,
        rejectedQuantity: 0,
        cancelledQuantity: 0,
        reference: 'PO-42',
        status: 'open'
      }],
      totalCount: 1,
      currentPage: 1,
      totalPages: 1
    }
  });
  const inventory = page.getByRole('region', { name: 'SKU inventory' });
  const unallocatedLegacyMetric = inventory.getByRole('button').filter({ hasText: 'Unallocated legacy' });
  await expect(unallocatedLegacyMetric).toContainText('0');
  const inventoryRows = page.viewportSize().width <= 640
    ? inventory.locator('.admin-inventory-mobile-list')
    : inventory.locator('.admin-inventory-table-wrap');
  await expect(inventory.getByText('Available stock', { exact: true })).toBeVisible();
  await expect(inventoryRows.getByText(/CORE-TEE-S/)).toBeVisible();
  await expect(inventoryRows.getByText('Linen Shirt', { exact: true })).toBeVisible();

  const search = inventory.getByRole('searchbox', { name: 'Search inventory by product, SKU, size, or colour' });
  await search.fill('CORE-TEE-S');
  await expect(inventoryRows.getByText(/CORE-TEE-S/)).toBeVisible();
  await expect(inventoryRows.getByText('Linen Shirt', { exact: true })).toHaveCount(0);
  await search.fill('');
  await inventory.getByRole('button', { name: 'Variant lifecycle All variant states' }).click();
  await inventory.getByRole('option', { name: 'Discontinued variants' }).click();
  const displayedRows = page.viewportSize().width <= 640
    ? inventory.locator('.admin-inventory-mobile-list')
    : inventory.locator('.admin-inventory-table-wrap');
  await expect(displayedRows.getByText(/LINEN-SHIRT-M/)).toBeVisible();
  await expect(displayedRows.getByText(/CORE-TEE-S/)).toHaveCount(0);

  for (const width of [320, 360, 375, 390, 430, 640, 641, 768, 820, 1024, 1280, 1366, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    const dimensions = await page.evaluate(() => ({
      viewportWidth: document.documentElement.clientWidth,
      contentWidth: document.documentElement.scrollWidth
    }));
    expect(dimensions.contentWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
    const responsiveSections = inventory.locator(
      '[aria-label="Inventory summary"], [aria-label="Pending inventory approvals"], [aria-label="Inbound receipts"]'
    );
    for (const section of await responsiveSections.all()) {
      const bounds = await section.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth
        };
      });
      expect(bounds.left).toBeGreaterThanOrEqual(-1);
      expect(bounds.right).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
      expect(
        bounds.scrollWidth,
        `${width}px viewport: ${await section.getAttribute('aria-label')} section overflows internally`
      ).toBeLessThanOrEqual(bounds.clientWidth + 1);
    }
    const panelWidth = await inventory.locator(':scope > .admin-panel').first().evaluate((panel) => ({
      panel: panel.getBoundingClientRect().width,
      section: panel.parentElement.getBoundingClientRect().width
    }));
    expect(panelWidth.panel).toBeLessThanOrEqual(panelWidth.section + 1);
    if (width <= 640) {
      await expect(inventory.locator('.admin-inventory-mobile-card')).toBeVisible();
      await expect(inventory.locator('.admin-inventory-table-wrap')).toBeHidden();
      const card = inventory.locator('.admin-inventory-mobile-card').filter({ hasText: 'LINEN-SHIRT-M' });
      await expect(card).toBeVisible();
      await card.getByRole('button', { name: 'Manage stock' }).click();
      const drawer = inventory.locator('.admin-inventory-drawer');
      await expect(drawer).toBeVisible();
      const drawerBounds = await drawer.locator('.admin-inventory-drawer__panel').evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth
        };
      });
      expect(drawerBounds.left).toBeGreaterThanOrEqual(-1);
      expect(drawerBounds.right).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
      expect(drawerBounds.scrollWidth).toBeLessThanOrEqual(drawerBounds.clientWidth + 1);
      await drawer.getByRole('button', { name: 'Close', exact: true }).click();
    } else {
      await expect(inventory.locator('.admin-inventory-table-wrap')).toBeVisible();
      await expect(inventory.locator('.admin-inventory-table-wrap').getByText(/LINEN-SHIRT-M/)).toBeVisible();
    }
  }
});

test('medium adjustments require explicit confirmation and report pending approval accurately', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const { adjustmentRequests } = await openInventory(page, {
    adjustmentResponse: {
      success: true,
      approval: { _id: 'approval-1', approvalLevel: 'admin', status: 'pending' }
    }
  });
  const inventory = page.getByRole('region', { name: 'SKU inventory' });
  const row = page.viewportSize().width <= 640
    ? inventory.locator('.admin-inventory-mobile-card').filter({ hasText: 'CORE-TEE-S' })
    : inventory.locator('.admin-inventory-table tbody tr').filter({ hasText: 'CORE-TEE-S' });
  await row.getByRole('button', { name: 'Adjust' }).click();
  const drawer = inventory.locator('.admin-inventory-drawer');
  await expect(drawer).toBeVisible();
  await drawer.getByLabel('Units to change').fill('11');
  await drawer.getByRole('button', { name: /Reason preset/ }).click();
  await drawer.getByRole('option', { name: 'Stocktake correction' }).click();
  const confirmation = drawer.getByLabel('Confirm this unusually large adjustment (11 units).');
  await expect(confirmation).toBeVisible();
  await confirmation.check();
  await drawer.getByRole('button', { name: 'Apply adjustment' }).click();

  await expect(page.getByText('Adjustment submitted for Admin approval. Stock was not changed.')).toBeVisible();
  expect(adjustmentRequests).toHaveLength(1);
  expect(adjustmentRequests[0].adjustments[0].delta).toBe(11);
  expect(adjustmentRequests[0].enhancedConfirmed).toBe(true);
});

test('inventory adjustment confirmation uses the backend configured thresholds', async ({ page }) => {
  const { adjustmentRequests } = await openInventory(page, {
    inventoryPolicyResponse: {
      success: true,
      policy: { normalAdjustmentLimit: 3, enhancedConfirmationLimit: 6, adminApprovalLimit: 9 }
    }
  });
  const inventory = page.getByRole('region', { name: 'SKU inventory' });
  await inventory.locator('.admin-inventory-table tbody tr').filter({ hasText: 'CORE-TEE-S' }).getByRole('button', { name: 'Adjust' }).click();
  const drawer = inventory.locator('.admin-inventory-drawer');
  await drawer.getByLabel('Units to change').fill('4');
  await drawer.getByRole('button', { name: /Reason preset/ }).click();
  await drawer.getByRole('option', { name: 'Stocktake correction' }).click();
  const confirmation = drawer.getByLabel('Confirm this unusually large adjustment (4 units).');
  await expect(confirmation).toBeVisible();
  await confirmation.check();
  await drawer.getByRole('button', { name: 'Apply adjustment' }).click();
  await expect(page.getByText('Inventory updated for CORE-TEE-S.')).toBeVisible();
  expect(adjustmentRequests).toHaveLength(1);
  expect(adjustmentRequests[0].enhancedConfirmed).toBe(true);
});

test('adjustment drawer can target another colour-size SKU with themed controls on narrow screens', async ({ page }) => {
  const greenVariant = {
    ...inventoryRows[0],
    sku: 'GREEN-TEE-M',
    size: 'M',
    colour: 'Green',
    onHand: 2,
    stock: 2,
    reservedQuantity: 0,
    availableStock: 2,
    committedQuantity: 0,
    incomingQuantity: 0,
    pricePaise: 45000,
    retailValuePaise: 90000
  };
  const { adjustmentRequests } = await openInventory(page, {
    productsResponse: [{
      _id: 'product-tee',
      name: 'Core Tee',
      variants: [
        { sku: 'CORE-TEE-S', colour: 'Black', size: 'S', status: 'active', stock: 5 },
        { sku: 'GREEN-TEE-M', colour: 'Green', size: 'M', status: 'active', stock: 2 }
      ]
    }],
    inventoryRowsResponse: inventoryRows,
    inventorySearchRowsResponse: [...inventoryRows, greenVariant]
  });
  const inventory = page.getByRole('region', { name: 'SKU inventory' });
  await inventory.locator('.admin-inventory-table tbody tr')
    .filter({ hasText: 'CORE-TEE-S' })
    .getByRole('button', { name: 'Adjust' })
    .click();

  const drawer = inventory.locator('.admin-inventory-drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer.locator('select')).toHaveCount(0);
  const skuPicker = drawer.getByRole('button', { name: /Adjust colour \/ size/ });

  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await skuPicker.click();
    const menu = drawer.getByRole('listbox', { name: 'Adjust colour / size' });
    await expect(menu).toBeVisible();
    const bounds = await menu.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right };
    });
    expect(bounds.left).toBeGreaterThanOrEqual(-1);
    expect(bounds.right).toBeLessThanOrEqual(width + 1);
    await page.keyboard.press('Escape');
  }

  await skuPicker.click();
  await drawer.getByRole('option', { name: /Green · M · GREEN-TEE-M/ }).click();
  await expect(inventory.getByRole('dialog', { name: 'Adjust GREEN-TEE-M' })).toBeVisible();
  await drawer.getByLabel('Units to change').fill('1');
  await drawer.getByRole('button', { name: /Reason preset/ }).click();
  await drawer.getByRole('option', { name: 'Stocktake correction' }).click();
  await drawer.getByRole('button', { name: 'Apply adjustment' }).click();

  await expect(page.getByText('Inventory updated for GREEN-TEE-M.')).toBeVisible();
  expect(adjustmentRequests).toHaveLength(1);
  expect(adjustmentRequests[0].adjustments).toEqual([{ sku: 'GREEN-TEE-M', delta: 1 }]);
});

test('Admin can approve an independent Admin request, while Owner requests remain blocked', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const { approvalRequests } = await openInventory(page, {
    approvalsResponse: {
      success: true,
      approvals: [
        {
          _id: 'admin-approval-1',
          productName: 'Core Tee',
          sku: 'CORE-TEE-S',
          quantityDelta: 30,
          type: 'correction',
          approvalLevel: 'admin',
          reason: 'Correct the physical count.',
          requestedBy: { name: 'Requesting Admin' }
        },
        {
          _id: 'owner-approval-1',
          productName: 'Linen Shirt',
          sku: 'LINEN-SHIRT-M',
          quantityDelta: 60,
          type: 'correction',
          approvalLevel: 'owner',
          reason: 'Large count correction.',
          requestedBy: { name: 'Requesting Admin' }
        }
      ],
      totalCount: 2,
      currentPage: 1,
      totalPages: 1
    }
  });
  const approvals = page.getByRole('region', { name: 'Pending inventory approvals' });
  await expect(approvals.getByText('Owner authorization is required. Admin accounts cannot approve this request.')).toBeVisible();
  await expect(approvals.getByRole('button', { name: 'Approve and apply' })).toHaveCount(1);
  await approvals.getByRole('button', { name: 'Approve and apply' }).click();

  await expect(page.getByText('Inventory adjustment approved and applied.')).toBeVisible();
  expect(approvalRequests).toEqual(['/api/admin/inventory/approvals/admin-approval-1/approve']);
});

test('inbound receipt creation uses an idempotency key and receiving surfaces the transaction gate', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const { inboundRequests, receiveRequests } = await openInventory(page, {
    productsResponse: [{
      _id: 'product-tee',
      name: 'Core Tee',
      variants: [
        { sku: 'CORE-TEE-S', colour: 'Black', size: 'S', status: 'active' },
        { sku: 'GREEN-TEE-M', colour: 'Green', size: 'M', status: 'active' }
      ]
    }],
    inboundResponse: {
      success: true,
      receipts: [{
        _id: 'receipt-1',
        product: { name: 'Core Tee' },
        sku: 'CORE-TEE-S',
        expectedQuantity: 6,
        receivedQuantity: 1,
        damagedQuantity: 0,
        rejectedQuantity: 0,
        cancelledQuantity: 0,
        reference: 'PO-42',
        status: 'open'
      }],
      totalCount: 1,
      currentPage: 1,
      totalPages: 1
    }
  });
  const inventory = page.getByRole('region', { name: 'SKU inventory' });
  const inbound = inventory.getByRole('region', { name: 'Inbound receipts' });
  const receiptForm = inbound.locator('form').first();
  await receiptForm.getByRole('button', { name: /Product \/ SKU/ }).click();
  await receiptForm.getByRole('option', { name: /Green · M · GREEN-TEE-M/ }).click();
  await receiptForm.getByLabel('Expected units').fill('6');
  await receiptForm.getByLabel('Reference').fill('PO-42');
  await receiptForm.getByRole('button', { name: 'Create receipt' }).click();
  await expect(page.getByText('Inbound receipt created.')).toBeVisible();
  expect(inboundRequests).toHaveLength(1);
  expect(inboundRequests[0].body).toMatchObject({
    productId: 'product-tee',
    sku: 'GREEN-TEE-M',
    expectedQuantity: 6,
    reference: 'PO-42'
  });
  expect(inboundRequests[0].key).toBeTruthy();

  const receiveForm = inbound.locator('form').nth(1);
  await receiveForm.getByLabel('Accepted units').fill('2');
  await receiveForm.getByRole('button', { name: 'Record receipt' }).click();
  await expect(page.getByText(/Receiving stock requires MongoDB transactions/)).toBeVisible();
  expect(receiveRequests).toHaveLength(1);
  expect(receiveRequests[0].body).toMatchObject({
    receivedQuantity: 2,
    damagedQuantity: 0,
    rejectedQuantity: 0,
    cancelledQuantity: 0
  });
  expect(receiveRequests[0].key).toBeTruthy();
});

test('inactive and discontinued SKUs expose Restore and restore only the selected SKU', async ({ page }) => {
  const { restoreRequests } = await openInventory(page);
  const inventory = page.getByRole('region', { name: 'SKU inventory' });
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const row = page.viewportSize().width <= 640
      ? inventory.locator('.admin-inventory-mobile-card').filter({ hasText: 'LINEN-SHIRT-M' })
      : inventory.locator('.admin-inventory-table tbody tr').filter({ hasText: 'LINEN-SHIRT-M' });
    const activeRow = page.viewportSize().width <= 640
      ? inventory.locator('.admin-inventory-mobile-card').filter({ hasText: 'CORE-TEE-S' })
      : inventory.locator('.admin-inventory-table tbody tr').filter({ hasText: 'CORE-TEE-S' });

    await expect(row.getByRole('button', { name: 'Restore SKU LINEN-SHIRT-M' })).toBeVisible();
    await expect(activeRow.getByRole('button', { name: /Restore SKU/ })).toHaveCount(0);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  const row = inventory.locator('.admin-inventory-table tbody tr').filter({ hasText: 'LINEN-SHIRT-M' });
  page.once('dialog', (dialog) => dialog.accept('Reintroduce this verified demo SKU.'));
  await row.getByRole('button', { name: 'Restore SKU LINEN-SHIRT-M' }).click();

  await expect(row.getByRole('button', { name: /Restore SKU/ })).toHaveCount(0);
  expect(restoreRequests).toEqual([{
    productId: 'product-shirt',
    sku: 'LINEN-SHIRT-M',
    reason: 'Reintroduce this verified demo SKU.'
  }]);
});

test('SKU Restore stays visible but disabled when the backend lacks transaction support', async ({ page }) => {
  await openInventory(page, { transactionsSupported: false });
  const inventory = page.getByRole('region', { name: 'SKU inventory' });
  const row = page.viewportSize().width <= 640
    ? inventory.locator('.admin-inventory-mobile-card').filter({ hasText: 'LINEN-SHIRT-M' })
    : inventory.locator('.admin-inventory-table tbody tr').filter({ hasText: 'LINEN-SHIRT-M' });
  const restoreButton = row.getByRole('button', { name: 'Restore SKU LINEN-SHIRT-M' });

  await expect(restoreButton).toBeVisible();
  await expect(restoreButton).toBeDisabled();
  await expect(restoreButton).toHaveAttribute('title', /transaction support/);
});

test('every SKU has a restock action that fits old and current viewport widths', async ({ page }) => {
  await openInventory(page, {
    productsResponse: [{
      _id: 'product-shirt',
      name: 'Linen Shirt',
      variants: [{ sku: 'LINEN-SHIRT-M', colour: 'Sand', size: 'M', status: 'discontinued' }]
    }]
  });
  const inventory = page.getByRole('region', { name: 'SKU inventory' });
  await expect(inventory.locator('.admin-inventory-table tbody tr')).toHaveCount(inventoryRows.length);

  for (const width of [320, 360, 375, 390, 430, 640, 641, 768, 1024, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const row = width <= 640
      ? inventory.locator('.admin-inventory-mobile-card').filter({ hasText: 'LINEN-SHIRT-M' })
      : inventory.locator('.admin-inventory-table tbody tr').filter({ hasText: 'LINEN-SHIRT-M' });
    await expect(row.getByRole('button', { name: 'Restock' })).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      viewportWidth: document.documentElement.clientWidth,
      contentWidth: document.documentElement.scrollWidth
    }));
    expect(dimensions.contentWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileRow = inventory.locator('.admin-inventory-mobile-card').filter({ hasText: 'LINEN-SHIRT-M' });
  await mobileRow.getByRole('button', { name: 'Restock' }).click();
  const receiptForm = inventory.getByRole('region', { name: 'Inbound receipts' }).locator('form').first();
  await expect(receiptForm.getByRole('button', { name: /Product \/ SKU.*LINEN-SHIRT-M/ })).toBeVisible();
});
