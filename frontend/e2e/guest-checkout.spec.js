import { expect, test } from '@playwright/test';

const productId = '64b000000000000000000001';
const cartItem = {
  _id: 'temp-guest-line',
  productId,
  name: 'YAQANA Mock Tee',
  price: 90,
  originalPrice: 100,
  image: '/images/xora-garment-fallback.svg',
  category: 'T-Shirts',
  size: 'M',
  colour: 'Sand',
  quantity: 2,
  stock: 4
};
const cartProduct = {
  _id: productId,
  name: 'YAQANA Mock Tee',
  price: 100,
  discountPrice: 90,
  images: ['/images/xora-garment-fallback.svg'],
  category: 'T-Shirts',
  sizes: ['M'],
  colours: [{ name: 'Sand', images: [] }],
  variants: [{ size: 'M', colour: 'Sand', sku: 'YAQ-TEE-SND-M', stock: 4 }]
};
const signedQuote = {
  lines: [{
    productId,
    sku: 'YAQ-TEE-SND-M',
    name: 'YAQANA Mock Tee',
    image: '/images/xora-garment-fallback.svg',
    category: 'T-Shirts',
    price: 90,
    originalPrice: 100,
    quantity: 2,
    size: 'M',
    colour: 'Sand',
    availableStock: 4
  }],
  originalSubtotal: 200,
  discount: 20,
  subtotal: 180,
  shippingFee: 15,
  tax: 14.4,
  total: 209.4
};
const refreshedQuote = {
  ...signedQuote,
  lines: signedQuote.lines.map((line) => ({ ...line, price: 80 })),
  discount: 40,
  subtotal: 160,
  tax: 12.8,
  total: 187.8
};
const savedAddress = {
  _id: 'saved-address-1',
  fullName: 'Saved Name',
  phone: '9123456780',
  addressLine1: '44 Residency Road',
  addressLine2: '',
  city: 'Bengaluru',
  state: 'Karnataka',
  postalCode: '560025',
  isDefault: true
};
const confirmedOrder = {
  _id: 'order-1',
  paymentMethod: 'Google Pay (UPI)',
  paymentStatus: 'Pending',
  orderStatus: 'Confirmed',
  subtotal: 180,
  discount: 20,
  shippingFee: 15,
  tax: 14.4,
  total: 209.4,
  items: [{
    product: productId,
    name: 'YAQANA Mock Tee',
    category: 'T-Shirts',
    image: '/images/xora-garment-fallback.svg',
    price: 90,
    originalPrice: 100,
    quantity: 2,
    size: 'M',
    colour: 'Sand'
  }],
  shippingAddress: {
    fullName: 'Mira Rao',
    email: 'mira@example.test',
    phone: '9876543210',
    addressLine1: '12 MG Road',
    city: 'Bengaluru',
    state: 'Karnataka',
    postalCode: '560001',
    country: 'India'
  }
};

async function mockCheckoutApi(page, {
  failOrder = false,
  conflictFirstOrder = false,
  priceConflictFirst = false,
  failLogin = false,
  includeSavedAddress = false,
  accountMatchesDelivery = false
} = {}) {
  const requests = [];
  let orderAttempts = 0;
  let quoteAttempts = 0;
  const accountUser = {
    _id: 'customer-1',
    name: accountMatchesDelivery ? 'Mira Rao' : 'Aarav Sharma',
    email: accountMatchesDelivery ? 'mira@example.test' : 'aarav@example.test',
    phone: accountMatchesDelivery ? '9876543210' : '9123456780',
    role: 'customer'
  };
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    requests.push({
      method,
      pathname: url.pathname,
      body: request.postDataJSON(),
      idempotencyKey: request.headers()['idempotency-key']
    });

    if (method === 'POST' && url.pathname === '/api/auth/login') {
      await route.fulfill({
        status: failLogin ? 401 : 200,
        contentType: 'application/json',
        body: JSON.stringify(failLogin ? {
          success: false,
          message: 'The mock sign-in was rejected.'
        } : {
          success: true,
          token: 'mock-session-token',
          user: accountUser
        })
      });
      return;
    }

    if (method === 'GET' && url.pathname === '/api/auth/profile') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, user: accountUser })
      });
      return;
    }

    if (method === 'POST' && url.pathname === '/api/auth/register') {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          token: 'mock-session-token',
          user: { _id: 'customer-1', name: 'Mira Rao', email: 'mira@example.test', role: 'customer' }
        })
      });
      return;
    }

    if (method === 'POST' && url.pathname === '/api/cart/sync') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          cart: {
            items: [{
              _id: 'cart-line-1',
              product: cartProduct,
              size: 'M',
              colour: 'Sand',
              quantity: 2
            }]
          }
        })
      });
      return;
    }

    if (method === 'GET' && url.pathname === '/api/addresses') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, addresses: includeSavedAddress ? [savedAddress] : [] })
      });
      return;
    }

    if (method === 'POST' && url.pathname === '/api/orders/quote') {
      quoteAttempts += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          quote: priceConflictFirst && quoteAttempts > 1 ? refreshedQuote : signedQuote,
          quoteToken: priceConflictFirst && quoteAttempts > 1 ? 'signed-refreshed-quote' : 'signed-mock-quote'
        })
      });
      return;
    }

    if (method === 'POST' && url.pathname === '/api/orders') {
      orderAttempts += 1;
      if (priceConflictFirst && orderAttempts === 1) {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            code: 'PRICE_OR_AVAILABILITY_CHANGED',
            message: 'Product prices or availability changed. Review your order before continuing.'
          })
        });
        return;
      }
      if (conflictFirstOrder && orderAttempts === 1) {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            code: 'IDEMPOTENCY_KEY_REUSED',
            message: 'This checkout key was already used for a different order.'
          })
        });
        return;
      }
      await route.fulfill({
        status: failOrder ? 503 : 201,
        contentType: 'application/json',
        body: JSON.stringify(failOrder
          ? { success: false, message: 'Order service is temporarily unavailable.' }
          : { success: true, order: { _id: 'order-1' } })
      });
      return;
    }

    if (method === 'GET' && url.pathname === '/api/orders/order-1') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, order: confirmedOrder })
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true })
    });
  });
  return requests;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((item) => {
    localStorage.setItem('xora_local_cart', JSON.stringify([item]));
  }, cartItem);
});

async function enterDeliveryDetails(page) {
  await page.getByLabel('Full Name *').fill('Mira Rao');
  await page.getByLabel('Email *').fill('mira@example.test');
  await page.getByLabel('Mobile Number *').fill('9876543210');
  await page.getByLabel('House/Flat No. & Street/Area *').fill('12 MG Road');
  await page.getByLabel('City *').fill('Bengaluru');
  await page.getByLabel('State *').selectOption('Karnataka');
  await page.getByLabel('PIN Code *').fill('560001');
}

async function expectCheckoutLayoutFits(page, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const dimensions = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    contentWidth: document.documentElement.scrollWidth
  }));
  expect(dimensions.contentWidth, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(dimensions.viewportWidth);

  const formColumn = await page.locator('[class~="lg:col-span-7"]').boundingBox();
  const summaryColumn = await page.locator('[class~="lg:col-span-5"]').boundingBox();
  expect(formColumn).not.toBeNull();
  expect(summaryColumn).not.toBeNull();
  const overlapWidth = Math.min(formColumn.x + formColumn.width, summaryColumn.x + summaryColumn.width) -
    Math.max(formColumn.x, summaryColumn.x);
  const overlapHeight = Math.min(formColumn.y + formColumn.height, summaryColumn.y + summaryColumn.height) -
    Math.max(formColumn.y, summaryColumn.y);
  const overlaps = overlapWidth > 2 && overlapHeight > 2;
  expect(overlaps, `checkout columns overlap at ${width}px: ${JSON.stringify({ formColumn, summaryColumn })}`).toBe(false);
}

test('guest checkout has no horizontal overflow across narrow and breakpoint widths', async ({ page }) => {
  await page.goto('/checkout');
  for (const width of [280, 320, 390, 600, 768, 820, 860, 861, 1280]) {
    await expect(page.getByRole('heading', { name: 'Secure Checkout' })).toBeVisible();
    await expectCheckoutLayoutFits(page, width);
  }
});

test('delivery, authentication, and payment review remain responsive and keyboard-operable', async ({ page }) => {
  await mockCheckoutApi(page, { includeSavedAddress: true });

  await page.goto('/checkout');
  for (const width of [280, 320, 390, 600, 768, 820, 860, 861, 1280]) {
    await expectCheckoutLayoutFits(page, width);
  }

  await enterDeliveryDetails(page);
  await page.getByRole('button', { name: /continue to sign in/i }).click();
  for (const width of [280, 320, 390, 600, 768, 820, 860, 861, 1280]) {
    await expect(page.getByLabel('Email address')).toBeVisible();
    await expectCheckoutLayoutFits(page, width);
  }

  await page.getByLabel('Email address').fill('aarav@example.test');
  await page.locator('#checkout-account-password').fill('mock-password');
  await page.getByRole('button', { name: /sign in and continue/i }).click();
  for (const width of [280, 320, 390, 600, 768, 820, 860, 861, 1280]) {
    await expect(page.getByRole('heading', { name: '2. Payment Method' })).toBeVisible();
    await expectCheckoutLayoutFits(page, width);
  }

  const savedAddressButton = page.getByRole('button', { name: /Saved Name.*44 Residency Road/s });
  await savedAddressButton.focus();
  await expect(savedAddressButton).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#checkout-fullname')).toHaveValue('Saved Name');

  const upiOption = page.getByRole('radio', { name: 'Google Pay (UPI)' });
  await upiOption.focus();
  await expect(upiOption).toBeFocused();
  await page.keyboard.press('Space');
  await expect(upiOption).toBeChecked();
});

test('sign-in entry validates delivery details before opening authentication', async ({ page }) => {
  await page.goto('/checkout');
  await page.getByRole('button', { name: 'SIGN IN', exact: true }).click();

  await expect(page.getByRole('alert')).toHaveText('Please complete the required delivery details.');
  await expect(page.getByLabel('Email address')).toHaveCount(0);
  await expect(page.locator('#checkout-fullname')).toBeFocused();
});

test('authenticated checkout does not apply the default saved address without an explicit choice', async ({ page }) => {
  const requests = await mockCheckoutApi(page, {
    includeSavedAddress: true
  });
  await page.addInitScript(() => {
    sessionStorage.setItem('xora_token', 'mock-session-token');
  });

  await page.goto('/checkout');
  await expect(page.getByRole('heading', { name: '2. Payment Method' })).toBeVisible();
  await expect(page.locator('#checkout-fullname')).toHaveValue('Aarav Sharma');
  await expect(page.locator('#checkout-address1')).toHaveValue('');
  await expect(page.getByRole('button', { name: /Saved Name.*44 Residency Road/s })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: /place test order/i })).toBeEnabled();

  await page.getByRole('button', { name: /place test order/i }).click();
  expect(requests.some((request) => request.pathname === '/api/orders')).toBe(false);
});

test('guest delivery details survive inline sign-in before authenticated quote and payment', async ({ page }) => {
  const requests = await mockCheckoutApi(page);

  await page.goto('/checkout');
  await expect(page.getByRole('heading', { name: 'Secure Checkout' })).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(0);

  await enterDeliveryDetails(page);
  expect(requests.some((request) => request.pathname === '/api/orders/quote' || request.pathname === '/api/orders')).toBe(false);
  await page.getByRole('button', { name: /continue to sign in/i }).click();

  await page.getByLabel('Email address').fill('aarav@example.test');
  await page.locator('#checkout-account-password').fill('mock-password');
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(page.locator('#checkout-account-password')).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Hide password' }).click();
  await expect(page.locator('#checkout-account-password')).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: /sign in and continue/i }).click();

  await expect(page.getByRole('heading', { name: '2. Payment Method' })).toBeVisible();
  await expect(page.getByText('₹17,380', { exact: true })).toBeVisible();
  await expect(page.getByText(/Original price\s*₹16,600/)).toBeVisible();
  await expect(page.getByText('Available stock: 4', { exact: true })).toBeVisible();
  await expect(page.locator('#checkout-fullname')).toHaveValue('Mira Rao');
  await expect(page.locator('#checkout-email')).toHaveValue('mira@example.test');
  await expect(page.getByRole('radio', { name: 'Google Pay (UPI)' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Contact details differ from your account' })).toBeVisible();

  const quoteRequest = requests.find((request) => request.pathname === '/api/orders/quote');
  expect(quoteRequest?.body.items).toEqual([{
    product: productId,
    quantity: 2,
    size: 'M',
    colour: 'Sand'
  }]);
  expect(requests.some((request) => request.pathname === '/api/orders')).toBe(false);
});

test('account contact conflicts require an explicit choice before order placement', async ({ page }) => {
  await mockCheckoutApi(page);

  await page.goto('/checkout');
  await enterDeliveryDetails(page);
  await page.getByRole('button', { name: /continue to sign in/i }).click();
  await page.getByLabel('Email address').fill('aarav@example.test');
  await page.locator('#checkout-account-password').fill('mock-password');
  await page.getByRole('button', { name: /sign in and continue/i }).click();

  await expect(page.getByRole('heading', { name: 'Contact details differ from your account' })).toBeVisible();
  await expect(page.getByText('Name: Mira Rao · Account: Aarav Sharma')).toBeVisible();
  await expect(page.getByText('Email: mira@example.test · Account: aarav@example.test')).toBeVisible();
  await expect(page.getByText('Phone: 9876543210 · Account: 9123456780')).toBeVisible();
  const placeOrder = page.getByRole('button', { name: /place test order/i });
  await expect(placeOrder).toBeDisabled();

  await page.getByRole('button', { name: 'Keep checkout details' }).click();
  await expect(placeOrder).toBeEnabled();
  await page.locator('#checkout-email').fill('aarav@example.test');
  await expect(placeOrder).toBeDisabled();
  await page.getByRole('button', { name: 'Use account details' }).click();
  await expect(page.locator('#checkout-fullname')).toHaveValue('Aarav Sharma');
  await expect(page.locator('#checkout-phone')).toHaveValue('9123456780');
  await expect(page.locator('#checkout-email')).toHaveValue('aarav@example.test');
  await expect(placeOrder).toBeEnabled();
});

test('failed inline sign-in retains the delivery draft and does not request a quote', async ({ page }) => {
  const requests = await mockCheckoutApi(page, { failLogin: true });

  await page.goto('/checkout');
  await enterDeliveryDetails(page);
  await page.getByRole('button', { name: /continue to sign in/i }).click();
  await page.getByLabel('Email address').fill('aarav@example.test');
  await page.locator('#checkout-account-password').fill('wrong-password');
  await page.getByRole('button', { name: /sign in and continue/i }).click();

  await expect(page.getByRole('alert').filter({ hasText: 'The mock sign-in was rejected.' })).toBeVisible();
  await expect(page.locator('#checkout-fullname')).toHaveValue('Mira Rao');
  await expect(page.locator('#checkout-email')).toHaveValue('mira@example.test');
  await expect(page.locator('#checkout-address1')).toHaveValue('12 MG Road');
  expect(requests.some((request) => request.pathname === '/api/orders/quote' || request.pathname === '/api/orders')).toBe(false);
});

test('saved address selection is explicit and does not replace the delivery email', async ({ page }) => {
  await mockCheckoutApi(page, { includeSavedAddress: true });

  await page.goto('/checkout');
  await enterDeliveryDetails(page);
  await page.getByRole('button', { name: /continue to sign in/i }).click();
  await page.getByLabel('Email address').fill('aarav@example.test');
  await page.locator('#checkout-account-password').fill('mock-password');
  await page.getByRole('button', { name: /sign in and continue/i }).click();

  const savedAddressButton = page.getByRole('button', { name: /Saved Name.*44 Residency Road/s });
  await expect(savedAddressButton).toBeVisible();
  await expect(page.locator('#checkout-fullname')).toHaveValue('Mira Rao');
  await savedAddressButton.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#checkout-fullname')).toHaveValue('Saved Name');
  await expect(page.locator('#checkout-address1')).toHaveValue('44 Residency Road');
  await expect(page.locator('#checkout-email')).toHaveValue('mira@example.test');
});

test('stale prices block order placement until the refreshed total is reviewed', async ({ page }) => {
  const requests = await mockCheckoutApi(page, { priceConflictFirst: true, accountMatchesDelivery: true });

  await page.goto('/checkout');
  await enterDeliveryDetails(page);
  await page.getByRole('button', { name: /continue to sign in/i }).click();
  await page.getByLabel('Email address').fill('aarav@example.test');
  await page.locator('#checkout-account-password').fill('mock-password');
  await page.getByRole('button', { name: /sign in and continue/i }).click();
  await page.getByRole('button', { name: /place test order/i }).click();

  await expect(page.getByText('₹15,587', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /place test order/i })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'I reviewed the updated total' })).toBeVisible();
  expect(requests.filter((request) => request.pathname === '/api/orders')).toHaveLength(1);

  await page.getByRole('button', { name: 'I reviewed the updated total' }).click();
  await expect(page.getByRole('button', { name: /place test order/i })).toBeEnabled();
  await page.getByRole('button', { name: /place test order/i }).click();
  await expect(page.getByRole('heading', { name: 'Order Confirmed' })).toBeVisible();

  const orderRequests = requests.filter((request) => request.pathname === '/api/orders');
  expect(orderRequests[0].body.quoteToken).toBe('signed-mock-quote');
  expect(orderRequests[1].body.quoteToken).toBe('signed-refreshed-quote');
  expect(orderRequests[1].idempotencyKey).not.toBe(orderRequests[0].idempotencyKey);
});

test('guest can register inline and the order confirmation shows server-verified discounts', async ({ page }) => {
  const requests = await mockCheckoutApi(page);

  await page.goto('/checkout');
  await enterDeliveryDetails(page);
  await page.getByRole('button', { name: /continue to sign in/i }).click();
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.locator('#checkout-account-name').fill('Mira Rao');
  await page.getByLabel('Email address').fill('mira@example.test');
  await page.locator('#checkout-account-password').fill('mock-password');
  await page.locator('#checkout-account-confirm-password').fill('mock-password');
  await page.getByRole('button', { name: /create account and continue/i }).click();
  await page.getByRole('button', { name: /place test order/i }).click();

  await expect(page.getByRole('heading', { name: 'Order Confirmed' })).toBeVisible();
  await expect(page.getByText('Product discount', { exact: true })).toBeVisible();
  await expect(page.getByText('−₹1,660')).toBeVisible();
  await expect(page.getByText('₹16,600')).toBeVisible();
  await expect(page.getByText('mira@example.test', { exact: true })).toBeVisible();

  const orderRequest = requests.find((request) => request.pathname === '/api/orders');
  expect(orderRequest.body.quoteToken).toBe('signed-mock-quote');
  expect(orderRequest.body.shippingAddress.email).toBe('mira@example.test');
  expect(orderRequest.idempotencyKey).toMatch(/^[A-Za-z0-9_-]{16,100}$/);
  expect(orderRequest.body.items).toEqual([{
    product: productId,
    quantity: 2,
    size: 'M',
    colour: 'Sand'
  }]);
});

test('failed order submission stores only an opaque retry key, not delivery details', async ({ page }) => {
  const requests = await mockCheckoutApi(page, { failOrder: true, accountMatchesDelivery: true });

  await page.goto('/checkout');
  await enterDeliveryDetails(page);
  await page.getByRole('button', { name: /continue to sign in/i }).click();
  await page.getByLabel('Email address').fill('aarav@example.test');
  await page.locator('#checkout-account-password').fill('mock-password');
  await page.getByRole('button', { name: /sign in and continue/i }).click();
  await page.getByRole('button', { name: /Place test order/i }).click();

  await expect(page.getByText('Order service is temporarily unavailable.')).toBeVisible();
  const storedAttempt = await page.evaluate(() => sessionStorage.getItem('xora_checkout_attempt'));
  expect(storedAttempt).toMatch(/^[A-Za-z0-9_-]{16,100}$/);
  expect(storedAttempt).not.toContain('mira@example.test');
  expect(storedAttempt).not.toContain('12 MG Road');
  expect(requests.find((request) => request.pathname === '/api/orders')?.body.quoteToken).toBe('signed-mock-quote');
});

test('idempotency conflicts require an explicit retry with a fresh opaque key', async ({ page }) => {
  const requests = await mockCheckoutApi(page, {
    conflictFirstOrder: true,
    failOrder: true,
    accountMatchesDelivery: true
  });
  await page.addInitScript(() => {
    sessionStorage.setItem('xora_checkout_attempt', 'persisted-old-key-123456');
  });

  await page.goto('/checkout');
  await enterDeliveryDetails(page);
  await page.getByRole('button', { name: /continue to sign in/i }).click();
  await page.getByLabel('Email address').fill('aarav@example.test');
  await page.locator('#checkout-account-password').fill('mock-password');
  await page.getByRole('button', { name: /sign in and continue/i }).click();
  await page.getByRole('button', { name: /place test order/i }).click();

  await expect(page.getByText(/already used for a different order/i)).toBeVisible();
  await page.getByRole('button', { name: 'Start a new checkout attempt' }).click();
  await page.getByRole('button', { name: /place test order/i }).click();

  const orderAttempts = requests.filter((request) => request.pathname === '/api/orders');
  expect(orderAttempts).toHaveLength(2);
  expect(orderAttempts[0].idempotencyKey).toBe('persisted-old-key-123456');
  expect(orderAttempts[1].idempotencyKey).toMatch(/^[A-Za-z0-9_-]{16,100}$/);
  expect(orderAttempts[1].idempotencyKey).not.toBe(orderAttempts[0].idempotencyKey);
});
