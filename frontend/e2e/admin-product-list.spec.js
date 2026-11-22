import { expect, test } from '@playwright/test';

const localTestOrigin = new URL(`http://127.0.0.1:${process.env.PLAYWRIGHT_PORT || '4173'}`).origin;

const products = [
  ['product-a', 'Alpha Tee', 'T-Shirts', 'Essentials', 'active', true, 8, 'YAQ-ALP-TEE-M'],
  ['product-b', 'Bravo Shirt', 'Shirts', 'Winter', 'draft', false, 0, 'YAQ-BRA-SHR-L'],
  ['product-c', 'Charlie Trouser', 'Trousers', 'Tailored', 'active', true, 24, 'YAQ-CHA-TRS-32'],
  ['product-d', 'Delta Hoodie', 'Hoodies', 'Winter', 'active', true, 12, 'YAQ-DEL-HDY-M'],
  ['product-e', 'Echo Tee', 'T-Shirts', 'Essentials', 'active', true, 18, 'YAQ-ECH-TEE-S'],
  ['product-f', 'Foxtrot Shirt', 'Shirts', 'Summer', 'active', true, 15, 'YAQ-FOX-SHR-M'],
  ['product-g', 'Golf Trouser', 'Trousers', 'Tailored', 'active', true, 6, 'YAQ-GOL-TRS-34'],
  ['product-h', 'Hotel Hoodie', 'Hoodies', 'Winter', 'archived', false, 0, 'YAQ-HOT-HDY-L'],
  ['product-i', 'India Tee', 'T-Shirts', 'Essentials', 'active', true, 30, 'YAQ-IND-TEE-L'],
  ['product-j', 'Juliet Shirt', 'Shirts', 'Summer', 'active', true, 14, 'YAQ-JUL-SHR-S'],
  ['product-o', 'Oxford Shirt', 'Shirts', 'Winter', 'active', true, 20, 'YAQ-OXF-SHR-M'],
  ['product-z', 'Zulu Trousers', 'Trousers', 'Tailored', 'draft', false, 0, 'YAQ-ZUL-TRS-30']
].map(([
  _id,
  name,
  category,
  collectionName,
  status,
  active,
  stock,
  sku
], index) => ({
  _id,
  name,
  slug: name.toLowerCase().replaceAll(' ', '-'),
  category,
  collectionName,
  status,
  active,
  price: 100 + index * 10,
  discountPrice: index === 0 ? 90 : null,
  stock,
  images: [],
  sizes: ['M'],
  colours: [{ name: 'Black', images: [] }],
  variants: [{ size: 'M', colour: 'Black', sku, stock }]
}));

const sampleReport = {
  period: 'last7days',
  timeZone: 'Asia/Kolkata',
  asOf: '2026-11-16T12:00:00.000Z',
  windows: {
    current: { start: '2026-11-10T00:00:00.000Z', end: '2026-11-16T23:59:59.999Z' },
    previous: { start: '2026-11-03T00:00:00.000Z', end: '2026-11-09T23:59:59.999Z' }
  },
  current: { orders: 21, revenue: 310, unitsSold: 31, averageOrderValue: 14.76, newCustomers: 7 },
  previous: { orders: 17, revenue: 263, unitsSold: 27, averageOrderValue: 15.47, newCustomers: 5 },
  comparisons: {
    orders: { changePercent: 23.5, direction: 'positive', label: '+23.5%' },
    revenue: { changePercent: 17.9, direction: 'positive', label: '+17.9%' },
    unitsSold: { changePercent: 14.8, direction: 'positive', label: '+14.8%' },
    averageOrderValue: { changePercent: -4.5, direction: 'negative', label: '-4.5%' },
    newCustomers: { changePercent: 40, direction: 'positive', label: '+40.0%' }
  },
  chartData: [
    { localDate: '2026-11-10', previousLocalDate: '2026-11-03', current: { revenue: 38, orders: 3 }, previous: { revenue: 29, orders: 2 } },
    { localDate: '2026-11-11', previousLocalDate: '2026-11-04', current: { revenue: 0, orders: 0 }, previous: { revenue: 42, orders: 3 } },
    { localDate: '2026-11-12', previousLocalDate: '2026-11-05', current: { revenue: 54, orders: 4 }, previous: { revenue: 22, orders: 2 } },
    { localDate: '2026-11-13', previousLocalDate: '2026-11-06', current: { revenue: 34, orders: 2 }, previous: { revenue: 31, orders: 2 } },
    { localDate: '2026-11-14', previousLocalDate: '2026-11-07', current: { revenue: 63, orders: 4 }, previous: { revenue: 51, orders: 3 } },
    { localDate: '2026-11-15', previousLocalDate: '2026-11-08', current: { revenue: 47, orders: 3 }, previous: { revenue: 36, orders: 2 } },
    { localDate: '2026-11-16', previousLocalDate: '2026-11-09', current: { revenue: 74, orders: 5 }, previous: { revenue: 52, orders: 3 } }
  ],
  orderStatusBreakdown: [{ status: 'Processing', count: 8 }, { status: 'Delivered', count: 5 }],
  paymentStatusBreakdown: [{ status: 'Paid', count: 15 }, { status: 'Pending', count: 4 }],
  bestSellers: [{ productId: 'product-a', name: 'Alpha Tee', unitsSold: 9 }]
};

async function openProductList(page, { stayOnDashboard = false } = {}) {
  await page.addInitScript(() => sessionStorage.setItem('xora_token', 'mock-admin-token'));
  let listedProducts = [...products];
  await page.route('**/*', async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.origin !== localTestOrigin) {
      await route.abort();
      return;
    }

    if (requestUrl.pathname.startsWith('/api/')) {
      if (requestUrl.pathname === '/api/admin/stats/export.csv') {
        await route.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8', body: 'Section,Metric,Current,Previous,Change\r\nPerformance,Orders,21,17,+23.5%\r\n' });
        return;
      }
      if (requestUrl.pathname.endsWith('/permanent') && route.request().method() === 'DELETE') {
        const productId = requestUrl.pathname.split('/').at(-2);
        listedProducts = listedProducts.filter((product) => product._id !== productId);
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
        return;
      }

      const responses = {
        '/api/auth/profile': {
          success: true,
          user: { _id: 'mock-admin', name: 'Local QA Admin', email: 'admin@example.test', role: 'admin', status: 'active', adminMfaVerified: true }
        },
        '/api/admin/customers': { success: true, customers: [] },
        '/api/products': { success: true, products: listedProducts, totalPages: 1 },
        '/api/orders': {
          success: true,
          orders: [
            { _id: 'qa-order-001', customer: { name: 'Sample customer 1' }, orderStatus: 'Processing', paymentMethod: 'Card', total: 22 },
            { _id: 'qa-order-002', customer: { name: 'Sample customer 2' }, orderStatus: 'Confirmed', paymentMethod: 'Cash on delivery', total: 18.5 },
            { _id: 'qa-order-003', customer: { name: 'Sample customer 3' }, orderStatus: 'Delivered', paymentMethod: 'Card', total: 31 }
          ]
        },
        '/api/categories': {
          success: true,
          categories: ['T-Shirts', 'Shirts', 'Trousers', 'Hoodies'].map((name) => ({ _id: name, name }))
        },
        '/api/products/collections': {
          success: true,
          collections: ['Essentials', 'Winter', 'Tailored', 'Summer'],
          collectionRecords: []
        },
        '/api/admin/inventory': { success: true, inventory: [], summary: null },
        '/api/admin/inventory/movements': { success: true, movements: [] },
        '/api/admin/stats': {
          success: true,
          stats: {
            totalProducts: 24,
            totalOrders: 38,
            totalCustomers: 22,
            totalRevenue: 310,
            pendingOrders: 4,
            lowStockProducts: 3,
            deliveredOrders: 17
          },
          report: sampleReport,
          categoryDistribution: [
            { name: 'Shirts', count: 12 },
            { name: 'Trousers', count: 8 },
            { name: 'Outerwear', count: 4 }
          ]
        }
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(responses[requestUrl.pathname] || { success: true })
      });
      return;
    }

    await route.continue();
  });

  await page.goto('/admin');
  await expect(page.getByText(/^Updated through /)).toBeVisible();
  const viewportWidth = await page.evaluate(() => document.documentElement.clientWidth);
  const reportValueRows = await page.locator('.admin-reporting-kpi').evaluateAll((cards) => cards.map((card) => ({
    row: Math.round(card.getBoundingClientRect().top),
    left: card.getBoundingClientRect().left,
    width: card.getBoundingClientRect().width,
    valueTop: card.querySelector('.admin-metric-card__value').getBoundingClientRect().top
  })));
  const valuesByRow = reportValueRows.reduce((rows, metric) => {
    rows[metric.row] = [...(rows[metric.row] || []), metric.valueTop];
    return rows;
  }, {});
  const widthsByRow = reportValueRows.reduce((rows, metric) => {
    rows[metric.row] = [...(rows[metric.row] || []), metric.width];
    return rows;
  }, {});
  for (const row of Object.keys(valuesByRow)) {
    const values = valuesByRow[row];
    expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
    const widths = widthsByRow[row];
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
  }
  if (viewportWidth > 740) {
    expect(new Set(reportValueRows.map((metric) => metric.row)).size).toBe(1);
  }
  const reportGridBounds = await page.locator('.admin-reporting-kpi-grid').boundingBox();
  const lastRow = reportValueRows.filter((metric) =>
    metric.row === Math.max(...reportValueRows.map((entry) => entry.row))
  );
  if (viewportWidth <= 740) {
    expect(Math.abs(lastRow[0].left - reportGridBounds.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(lastRow[0].width - reportGridBounds.width)).toBeLessThanOrEqual(1);
  }
  if (stayOnDashboard) return;
  const openNavigation = page.getByRole('button', { name: 'Open admin navigation' });
  if (await openNavigation.isVisible()) await openNavigation.click();
  await page.getByRole('button', { name: 'Insights', exact: true }).click();
  await page.getByRole('button', { name: 'Analytics', exact: true }).click();
  const firstCurrentBar = page.locator('.admin-report-chart__bar--current').first();
  await expect(firstCurrentBar).toBeVisible();
  expect(Number.parseFloat(await firstCurrentBar.evaluate((bar) => bar.style.width))).toBeGreaterThan(0);
  if (await openNavigation.isVisible()) await openNavigation.click();
  await page.getByRole('button', { name: 'Catalogue', exact: true }).click();
  await page.getByRole('button', { name: 'Products', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Products (12)' })).toBeVisible();
}

test('reporting period picker uses a styled accessible menu with keyboard controls', async ({ page }) => {
  await openProductList(page, { stayOnDashboard: true });

  const trigger = page.getByRole('button', { name: 'Reporting period Last 7 days' });
  await expect(trigger).toBeVisible();
  await trigger.click();

  const menu = page.getByRole('listbox', { name: 'Reporting period' });
  await expect(menu).toBeVisible();
  await expect(menu).toHaveCSS('background-color', 'rgb(255, 253, 250)');
  await expect(menu.getByRole('option', { name: 'Last 7 days' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();

  const timeZoneTrigger = page.getByRole('button', { name: 'Time zone Asia/Kolkata' });
  await timeZoneTrigger.click();
  const timeZoneMenu = page.getByRole('listbox', { name: 'Time zone' });
  await expect(timeZoneMenu).toBeVisible();
  await expect(timeZoneMenu).toHaveCSS('background-color', 'rgb(255, 253, 250)');
  await page.keyboard.press('Escape');
  await expect(timeZoneMenu).toBeHidden();

  await trigger.click();
  await page.keyboard.press('Tab');
  await expect(menu).toBeHidden();
  await expect(timeZoneTrigger).toBeFocused();

  await trigger.click();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('option', { name: 'Last 30 days' })).toHaveAttribute('data-active', 'true');
  await page.keyboard.press('Enter');

  await expect(page.getByRole('button', { name: 'Reporting period Last 30 days' })).toBeVisible();
  await expect(menu).toBeHidden();
});

test('dashboard shows data-backed order status, payment, and best-seller summaries', async ({ page }) => {
  await openProductList(page, { stayOnDashboard: true });
  await expect(page.getByRole('heading', { name: 'Order Status' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Payment Overview' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Best Sellers' })).toBeVisible();
  await expect(page.getByText('Processing', { exact: true })).toBeVisible();
  await expect(page.getByText('Paid', { exact: true })).toBeVisible();
  await expect(page.locator('.admin-best-sellers').getByText('Alpha Tee', { exact: true })).toBeVisible();
  await expect(page.getByText('Paid units sold')).toBeVisible();
});

test('dashboard exports the selected period as a CSV download', async ({ page }) => {
  await openProductList(page, { stayOnDashboard: true });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^yaqana-dashboard-last7days-\d{4}-\d{2}-\d{2}\.csv$/u);
});

test('support centre filters use themed dropdown menus with keyboard navigation', async ({ page }) => {
  await openProductList(page, { stayOnDashboard: true });
  const openNavigation = page.getByRole('button', { name: 'Open admin navigation' });
  if (await openNavigation.isVisible()) await openNavigation.click();
  await page.getByRole('button', { name: 'Operations', exact: true }).click();
  await page.getByRole('button', { name: 'Support Centre', exact: true }).click();

  const supportCentre = page.getByRole('region', { name: 'Support Centre' });
  await expect(supportCentre.getByRole('combobox')).toHaveCount(0);

  const statusTrigger = page.getByRole('button', { name: 'Status All statuses' });
  await expect(statusTrigger).toBeVisible();
  await statusTrigger.click();

  const statusMenu = page.getByRole('listbox', { name: 'Status' });
  await expect(statusMenu).toBeVisible();
  await expect(statusMenu).toHaveCSS('background-color', 'rgb(255, 253, 250)');
  await expect(statusMenu).toHaveCSS('scrollbar-width', 'thin');
  await expect(statusMenu).toHaveCSS('scrollbar-color', 'rgb(196, 181, 165) rgb(243, 239, 234)');
  await expect(statusMenu.getByRole('option', { name: 'Open' })).toHaveCSS('text-transform', 'none');
  await expect(statusMenu.getByRole('option', { name: 'Open' })).toHaveCSS('letter-spacing', 'normal');
  await page.keyboard.press('ArrowDown');
  await expect(statusMenu.getByRole('option', { name: 'Open' })).toHaveAttribute('data-active', 'true');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Status Open' })).toBeVisible();
  await expect(statusMenu).toBeHidden();

  const priorityTrigger = page.getByRole('button', { name: 'Priority All priorities' });
  await priorityTrigger.click();
  const priorityMenu = page.getByRole('listbox', { name: 'Priority' });
  await expect(priorityMenu).toBeVisible();
  await expect(priorityMenu).toHaveCSS('background-color', 'rgb(255, 253, 250)');
  await page.keyboard.press('End');
  await expect(priorityMenu.getByRole('option', { name: 'Urgent' })).toHaveAttribute('data-active', 'true');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Priority Urgent' })).toBeVisible();
  await expect(priorityMenu).toBeHidden();
});

test('product list searches SKUs and combines category, collection, status, and stock filters', async ({ page }) => {
  await openProductList(page);

  const search = page.getByRole('searchbox', { name: 'Search products by name, category, collection, or SKU' });
  await search.fill('yaq-bra-shr-l');
  await expect(page.locator('.admin-product-card')).toHaveCount(1);
  await expect(page.getByText('Bravo Shirt', { exact: true })).toBeVisible();
  await expect(page.getByText('YAQ-BRA-SHR-L', { exact: true })).toBeVisible();

  await search.fill('');
  await page.getByLabel('Category filter').selectOption('Shirts');
  await page.getByLabel('Collection filter').selectOption('Winter');
  await page.getByLabel('Status filter').selectOption('draft');
  await page.getByLabel('Stock filter').selectOption('out-of-stock');
  await expect(page.locator('.admin-product-card')).toHaveCount(1);
  await expect(page.getByText('Bravo Shirt', { exact: true })).toBeVisible();
});

test('product list paginates results and fits common viewport widths', async ({ page }) => {
  await openProductList(page);

  await expect(page.getByText('Showing 1–10 of 12 products')).toBeVisible();
  await page.getByRole('button', { name: 'Next product page' }).click();
  await expect(page.getByText('Showing 11–12 of 12 products')).toBeVisible();
  await expect(page.getByText('Oxford Shirt', { exact: true })).toBeVisible();
  await expect(page.getByText('Zulu Trousers', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next product page' })).toBeDisabled();

  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const dimensions = await page.evaluate(() => ({
      viewportWidth: document.documentElement.clientWidth,
      contentWidth: document.documentElement.scrollWidth
    }));
    expect(dimensions.contentWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
  }
});

test('product cards show archive state, safe delete controls, and contained product images', async ({ page }) => {
  await openProductList(page);

  const cards = page.locator('.admin-product-card');
  await expect(cards).toHaveCount(10);
  for (const card of await cards.all()) {
    await expect(card.getByRole('button', { name: 'Archive' })).toBeVisible();
  }

  const archivedCard = cards.filter({ hasText: 'Hotel Hoodie' });
  await expect(archivedCard.getByRole('button', { name: 'Archive' })).toBeDisabled();
  await expect(archivedCard.getByRole('button', { name: 'Permanently delete' })).toBeVisible();

  const draftCard = cards.filter({ hasText: 'Bravo Shirt' });
  await expect(draftCard.getByRole('button', { name: 'Archive' })).toBeEnabled();
  await expect(draftCard.getByRole('button', { name: 'Permanently delete' })).toBeVisible();
  await expect(draftCard.getByRole('button', { name: 'Permanently delete' })).toBeEnabled();

  for (const card of await cards.all()) {
    await expect(card.getByRole('button', { name: /Permanently delete/ })).toBeVisible();
  }

  const activeCard = cards.filter({ hasText: 'Alpha Tee' });
  await expect(activeCard.getByRole('button', { name: 'Permanently delete' })).toBeDisabled();
  await expect(activeCard.getByRole('button', { name: 'Permanently delete' })).toHaveAttribute(
    'title',
    'Change the product to an inactive status before deletion.'
  );

  const thumbnails = page.locator('.admin-product-card__thumb img');
  await expect.poll(() => thumbnails.evaluateAll((images) =>
    images.every((image) => image.complete && image.naturalWidth > 0 && getComputedStyle(image).objectFit === 'contain')
  )).toBe(true);
});

test('permanently deletes an inactive product only after confirmation', async ({ page }) => {
  await openProductList(page);

  const deletedCard = page.locator('.admin-product-card').filter({ hasText: 'Bravo Shirt' });
  const deleteRequest = page.waitForRequest((request) =>
    request.method() === 'DELETE' && request.url().endsWith('/api/products/product-b/permanent')
  );
  const confirmation = page.waitForEvent('dialog').then((dialog) => {
    expect(dialog.message()).toContain('Permanently delete');
    return dialog.accept();
  });
  await deletedCard.getByRole('button', { name: 'Permanently delete' }).click();
  await Promise.all([deleteRequest, confirmation]);
  await expect(deletedCard).toHaveCount(0);
});

test('product thumbnails are large enough to see the garment', async ({ page }) => {
  await openProductList(page);

  const imageDimensions = await page.locator('.admin-product-card__thumb').evaluateAll((thumbnails) =>
    thumbnails.map((thumbnail) => ({
      width: thumbnail.getBoundingClientRect().width,
      height: thumbnail.getBoundingClientRect().height
    }))
  );
  expect(imageDimensions.every(({ width, height }) => width >= 90 && height >= 110)).toBe(true);
});

test('product action rows stay aligned across product states', async ({ page }) => {
  await openProductList(page);
  const actionHeights = await page.locator('.admin-product-card__actions').evaluateAll((actions) =>
    actions.map((action) => action.getBoundingClientRect().height)
  );
  expect(Math.max(...actionHeights) - Math.min(...actionHeights)).toBeLessThanOrEqual(1);
});
