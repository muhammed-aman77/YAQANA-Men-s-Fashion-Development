import { expect, test } from '@playwright/test';

async function mockApplicationRequests(page) {
  const appOrigin = new URL(test.info().project.use.baseURL).origin;
  const unexpectedRequests = [];
  const credentialSubmissions = [];

  await page.route('**/*', async (route) => {
    const requestUrl = new URL(route.request().url());

    if (requestUrl.origin !== appOrigin) {
      if (requestUrl.pathname.startsWith('/api/')) unexpectedRequests.push(requestUrl.href);
      await route.abort();
      return;
    }

    if (requestUrl.pathname.startsWith('/api/')) {
      if (['/api/auth/login', '/api/auth/register'].includes(requestUrl.pathname) && route.request().method() === 'POST') {
        credentialSubmissions.push(requestUrl.pathname);
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true })
      });
      return;
    }

    await route.continue();
  });

  return { credentialSubmissions, unexpectedRequests };
}

test('sign-in password can be revealed and hidden without changing its value', async ({ page }) => {
  const { credentialSubmissions, unexpectedRequests } = await mockApplicationRequests(page);
  await page.goto('/login?redirect=%2Fadmin');

  const password = page.locator('input[name="password"]');
  await password.fill('local-test-password');
  await expect(password).toHaveAttribute('type', 'password');

  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await expect(password).toHaveValue('local-test-password');

  await page.getByRole('button', { name: 'Hide password' }).click();
  await expect(password).toHaveAttribute('type', 'password');
  await expect(password).toHaveValue('local-test-password');
  expect(credentialSubmissions).toEqual([]);
  expect(unexpectedRequests).toEqual([]);
});

test('registration password fields can be revealed independently', async ({ page }) => {
  const { credentialSubmissions, unexpectedRequests } = await mockApplicationRequests(page);
  await page.goto('/register');

  const password = page.locator('input[name="password"]');
  const confirmation = page.locator('input[name="confirmPassword"]');
  await password.fill('local-test-password');
  await confirmation.fill('local-confirmation');

  const showButtons = page.getByRole('button', { name: 'Show password' });
  await showButtons.nth(0).click();

  await expect(password).toHaveAttribute('type', 'text');
  await expect(confirmation).toHaveAttribute('type', 'password');
  await expect(password).toHaveValue('local-test-password');
  await expect(confirmation).toHaveValue('local-confirmation');

  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(confirmation).toHaveAttribute('type', 'text');
  await expect(password).toHaveAttribute('type', 'text');
  expect(credentialSubmissions).toEqual([]);
  expect(unexpectedRequests).toEqual([]);
});
