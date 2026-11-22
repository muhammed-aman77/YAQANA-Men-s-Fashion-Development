import { expect, test } from '@playwright/test';

test('direct administrator URL sends a guest to the separate sign-in route', async ({ page }) => {
  await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) }));
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/login\?redirect=/u);
  await expect(page.getByRole('heading', { name: 'Administrator Sign In' })).toBeVisible();
  await expect(page.getByText(/Customer sign-in and registration do not grant administrative access/)).toBeVisible();
});

test('administrator sign-in requires password then MFA enrollment and shows one-time recovery codes', async ({ page }) => {
  let loginCount = 0;
  let verifyBody;
  await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) }));
  await page.route('**/api/admin-auth/login', async (route) => {
    loginCount += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        status: 'mfa_setup_required',
        challengeToken: 'challenge-token-mock',
        secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
        otpauthUrl: 'otpauth://totp/YAQANA%20Admin%3Astaff%40example.test?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=YAQANA&algorithm=SHA1&digits=6&period=30'
      })
    });
  });
  await page.route('**/api/admin-auth/verify', async (route) => {
    verifyBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        authMode: 'bearer',
        token: 'mock-admin-session-token',
        user: { _id: 'admin-1', role: 'admin', status: 'active', adminMfaVerified: true },
        recoveryCodes: ['one-time-code-alpha', 'one-time-code-bravo']
      })
    });
  });
  await page.goto('/admin/login');
  await page.getByLabel('Email').fill('staff@example.test');
  await page.locator('input[name="password"]').fill('mock-password');
  await page.getByRole('button', { name: 'Continue securely' }).click();
  await expect(page.getByRole('heading', { name: 'Set Up Authenticator' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Scan this QR code with Google Authenticator' })).toHaveAttribute('src', /^data:image\/png;base64,/u);
  await expect(page.getByRole('list', { name: 'Google Authenticator setup steps' }).getByRole('listitem')).toHaveCount(7);
  await expect(page.getByText('Enter the temporary six-digit code from your phone, not the private setup key.')).toBeVisible();
  await page.getByText('Can’t scan? Show the private setup key').click();
  await expect(page.getByText('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP')).toBeVisible();
  await page.getByLabel('Six-digit code from Google Authenticator').fill('123456');
  await page.getByRole('button', { name: 'Enable MFA and sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Save Recovery Codes' })).toBeVisible();
  await expect(page.getByText('one-time-code-alpha')).toBeVisible();
  expect(loginCount).toBe(1);
  expect(verifyBody).toMatchObject({ challengeToken: 'challenge-token-mock', code: '123456' });
  expect(verifyBody).not.toHaveProperty('email');
  expect(verifyBody).not.toHaveProperty('password');
});

test('admin authenticator replacement is protected and shows a locally rendered replacement QR', async ({ page }) => {
  let proofRequest;
  let verifyRequest;
  await page.addInitScript(() => sessionStorage.setItem('xora_token', 'mock-admin-session'));
  await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) }));
  await page.route('**/api/auth/profile', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, user: { _id: 'admin-1', role: 'admin', status: 'active', adminMfaVerified: true } })
  }));
  await page.route('**/api/admin-auth/mfa/replacement/start', async (route) => {
    proofRequest = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Cache-Control': 'no-store, private' },
      body: JSON.stringify({
        success: true,
        challengeId: 'replacement-challenge-mock',
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
        secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
        otpauthUrl: 'otpauth://totp/YAQANA%20Admin%3Astaff%40example.test?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=YAQANA&algorithm=SHA1&digits=6&period=30'
      })
    });
  });
  await page.route('**/api/admin-auth/mfa/replacement/verify', async (route) => {
    verifyRequest = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, recoveryCodes: ['new-recovery-alpha', 'new-recovery-bravo'] })
    });
  });

  await page.goto('/admin/security');
  await expect(page.getByRole('heading', { name: 'Change Authenticator' })).toBeVisible();
  await page.getByLabel('Current password').fill('mock-current-password');
  await page.getByLabel('Current six-digit authenticator code').fill('234567');
  await page.getByRole('button', { name: 'Verify and show replacement QR' }).click();
  await expect(page.getByRole('img', { name: 'Scan replacement QR code with Google Authenticator' })).toHaveAttribute('src', /^data:image\/png;base64,/u);
  await expect(page.getByRole('heading', { name: 'Set Up Replacement Authenticator' })).toBeVisible();
  await page.getByLabel('New six-digit code from Google Authenticator').fill('345678');
  await page.getByRole('button', { name: 'Verify replacement and activate' }).click();
  await expect(page.getByRole('heading', { name: 'Save New Recovery Codes' })).toBeVisible();
  await expect(page.getByText('new-recovery-alpha')).toBeVisible();
  expect(proofRequest).toMatchObject({ currentPassword: 'mock-current-password', code: '234567' });
  expect(proofRequest).not.toHaveProperty('recoveryCode');
  expect(verifyRequest).toEqual({ challengeId: 'replacement-challenge-mock', code: '345678' });
});

test('admin can begin authenticator replacement with a one-time recovery code', async ({ page }) => {
  let proofRequest;
  await page.addInitScript(() => sessionStorage.setItem('xora_token', 'mock-admin-session'));
  await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) }));
  await page.route('**/api/auth/profile', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, user: { _id: 'admin-1', role: 'admin', status: 'active', adminMfaVerified: true } })
  }));
  await page.route('**/api/admin-auth/mfa/replacement/start', async (route) => {
    proofRequest = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        challengeId: 'replacement-recovery-mock',
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
        secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
        otpauthUrl: 'otpauth://totp/YAQANA%20Admin%3Astaff%40example.test?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=YAQANA&algorithm=SHA1&digits=6&period=30'
      })
    });
  });

  await page.goto('/admin/security');
  await page.getByRole('button', { name: 'Use one recovery code instead' }).click();
  await page.getByLabel('Current password').fill('mock-current-password');
  await page.getByLabel('One unused recovery code').fill('one-unused-recovery-code');
  await page.getByRole('button', { name: 'Verify and show replacement QR' }).click();
  await expect(page.getByRole('heading', { name: 'Set Up Replacement Authenticator' })).toBeVisible();
  expect(proofRequest).toMatchObject({ currentPassword: 'mock-current-password', recoveryCode: 'one-unused-recovery-code' });
  expect(proofRequest).not.toHaveProperty('code');
});

test('guest direct access to Admin security redirects to separate Admin sign-in', async ({ page }) => {
  await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) }));
  await page.goto('/admin/security');
  await expect(page).toHaveURL(/\/admin\/login\?redirect=/u);
  await expect(page.getByRole('heading', { name: 'Administrator Sign In' })).toBeVisible();
});
