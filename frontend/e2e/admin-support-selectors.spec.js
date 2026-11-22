import { expect, test } from '@playwright/test';

const localTestOrigin = new URL(`http://127.0.0.1:${process.env.PLAYWRIGHT_PORT || '4173'}`).origin;

test('support create form loads customer and order choices on first visit', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('xora_token', 'mock-admin-token'));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== localTestOrigin) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();

    let response = { success: true };
    if (url.pathname === '/api/auth/profile') {
      response.user = { _id: 'support-admin', name: 'QA Admin', email: 'admin@example.test', role: 'admin', status: 'active', adminMfaVerified: true };
    } else if (url.pathname === '/api/admin/stats') {
      response.stats = {};
      response.report = null;
    } else if (url.pathname === '/api/admin/preferences') {
      response.preferences = { savedFilters: [] };
    } else if (url.pathname === '/api/products' || url.pathname === '/api/categories' || url.pathname === '/api/products/collections') {
      response.products = [];
      response.categories = [];
      response.collections = [];
      response.collectionRecords = [];
      response.totalPages = 1;
    } else if (url.pathname === '/api/admin/customers') {
      response.customers = [{ _id: 'customer-1', name: 'Alex Customer', email: 'alex@example.test' }];
      response.totalCustomers = 1;
      response.totalPages = 1;
      response.currentPage = 1;
    } else if (url.pathname === '/api/orders') {
      response.orders = [{ _id: 'order-12345678', customer: { _id: 'customer-1' }, orderStatus: 'Confirmed' }];
      response.totalOrders = 1;
      response.totalPages = 1;
      response.currentPage = 1;
    } else if (url.pathname === '/api/support/tickets') {
      response.tickets = [];
      response.totalCount = 0;
      response.totalPages = 0;
    } else if (url.pathname === '/api/support/assignees') {
      response.assignees = [];
    }
    await route.fulfill({ json: response });
  });

  await page.goto('/admin');
  const openNavigation = page.getByRole('button', { name: 'Open admin navigation' });
  if (await openNavigation.isVisible()) await openNavigation.click();
  await page.getByRole('button', { name: 'Operations', exact: true }).click();
  await page.getByRole('button', { name: 'Support Centre', exact: true }).click();

  const support = page.getByRole('region', { name: 'Support Centre' });
  const customer = support.getByRole('button', { name: /Customer account/ });
  await expect(customer).toBeVisible();
  await customer.click();
  await expect(support.getByRole('option', { name: /Alex Customer/ })).toBeVisible();
  await support.getByRole('option', { name: /Alex Customer/ }).click();
  const order = support.getByRole('button', { name: /Related order/ });
  await order.click();
  await expect(support.getByRole('option', { name: /Order 12345678/ })).toBeVisible();
});
