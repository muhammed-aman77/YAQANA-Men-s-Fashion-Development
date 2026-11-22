import { expect, test } from '@playwright/test';

test('Add Product opens a draft dialog and cancelling does not write catalogue data', async ({ page }) => {
  const appOrigin = new URL(test.info().project.use.baseURL).origin;
  const externalApiRequests = [];
  const writeRequests = [];
  const responses = {
    '/api/auth/profile': {
      success: true,
      user: {
        _id: 'mock-admin',
        name: 'Local QA Admin',
        email: 'admin@example.test',
        role: 'admin',
        adminMfaVerified: true,
        status: 'active'
      }
    },
    '/api/admin/customers': { success: true, customers: [] },
    '/api/products': { success: true, products: [], totalPages: 1 },
    '/api/orders': { success: true, orders: [] },
    '/api/categories': { success: true, categories: [] },
    '/api/products/collections': { success: true, collections: [], collectionRecords: [] },
    '/api/admin/inventory': { success: true, inventory: [], summary: null },
    '/api/admin/inventory/movements': { success: true, movements: [] },
    '/api/cart': { success: true, items: [] },
    '/api/wishlist': { success: true, items: [] }
  };

  await page.addInitScript(() => sessionStorage.setItem('xora_token', 'mock-admin-token'));
  await page.route('**/*', async (route) => {
    const requestUrl = new URL(route.request().url());

    if (requestUrl.origin !== appOrigin) {
      if (requestUrl.pathname.startsWith('/api/')) externalApiRequests.push(requestUrl.href);
      await route.abort();
      return;
    }

    if (requestUrl.pathname.startsWith('/api/')) {
      if (route.request().method() !== 'GET') {
        writeRequests.push(`${route.request().method()} ${requestUrl.pathname}`);
      }
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
  const openNavigation = page.getByRole('button', { name: 'Open admin navigation' });
  if (await openNavigation.isVisible()) await openNavigation.click();
  await expect(page.getByRole('navigation', { name: 'Admin sections' })).toBeVisible();

  await page.getByRole('button', { name: 'Catalogue', exact: true }).click();
  await page.getByRole('button', { name: 'Products', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Products (0)' })).toBeVisible();

  await page.getByRole('button', { name: 'Add Product' }).click();
  const editor = page.getByRole('dialog', { name: 'Add Product' });
  await expect(editor).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Product name' })).toBeFocused();
  await page.getByRole('textbox', { name: 'Product name' }).fill('Manual SKU Test Tee');
  await editor.getByRole('button', { name: 'Generate matrix' }).click();
  const manualSku = editor.getByRole('textbox', { name: 'XS Neutral SKU' });
  await expect(manualSku).toBeEditable();
  await manualSku.fill('MANUAL-TEE-XS-NEUTRAL');
  await expect(manualSku).toHaveValue('MANUAL-TEE-XS-NEUTRAL');

  page.once('dialog', (dialog) => dialog.accept());
  await editor.getByRole('button', { name: 'Cancel' }).click();
  await expect(editor).not.toBeVisible();
  expect(writeRequests).toEqual([]);
  expect(externalApiRequests).toEqual([]);
});
