import { expect, test } from '@playwright/test';

const selectionBrown = 'rgb(106, 85, 67)';

test('selected size and colour use the Add to Cart brown', async ({ page }) => {
  const baseURL = test.info().project.use.baseURL;
  const appOrigin = new URL(baseURL).origin;
  const mockedApiPaths = [];
  const externalApiRequests = [];
  const product = {
    _id: 'test-product',
    name: 'YAQANA Mock Tee',
    category: 't-shirts',
    gender: 'men',
    price: 2490,
    description: 'A mock product used only by the browser regression test.',
    sizes: ['S', 'M'],
    colours: [
      { name: 'Black', hex: '#1b1b1b', images: ['/images/black-gallery.jpg'] },
      { name: 'Sand', hex: '#c6b8a4', images: ['/images/sand-gallery.jpg'] }
    ],
    variants: [
      { size: 'S', colour: 'Black', stock: 8, sku: 'TEST-BLACK-S', status: 'inactive' },
      {
        size: 'M',
        colour: 'Black',
        stock: 6,
        sku: 'TEST-BLACK-M',
        pricePaise: 399000,
        discountPricePaise: 350000,
        images: ['/images/m-black-front.jpg']
      },
      { size: 'S', colour: 'Sand', stock: 7, sku: 'TEST-SAND-S' },
      { size: 'M', colour: 'Sand', stock: 5, sku: 'TEST-SAND-M' }
    ],
    images: ['/images/xora-garment-fallback.svg']
  };

  await page.route('**/*', async (route) => {
    const requestUrl = new URL(route.request().url());

    if (requestUrl.origin !== appOrigin) {
      if (requestUrl.pathname.startsWith('/api/')) {
        externalApiRequests.push(requestUrl.href);
      }
      await route.abort();
      return;
    }

    if (requestUrl.pathname.startsWith('/images/')) {
      await route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1" fill="#ddd"/></svg>'
      });
      return;
    }

    if (requestUrl.pathname.startsWith('/api/')) {
      mockedApiPaths.push(requestUrl.pathname);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          product,
          relatedProducts: []
        })
      });
      return;
    }

    await route.continue();
  });

  await page.goto('/product/test-product');
  await expect(page.getByRole('heading', { name: product.name, level: 1 })).toBeVisible();

  const addToCart = page.locator('#add-to-cart-detail-btn');
  const addToCartBrown = await addToCart.evaluate((button) => getComputedStyle(button).backgroundColor);
  expect(addToCartBrown).toBe(selectionBrown);
  await expect(addToCart).toBeDisabled();
  await expect(page.getByText('This variant is currently unavailable')).toBeVisible();

  const mediumSize = page.getByRole('button', { name: 'M', exact: true });
  await expect(mediumSize).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await mediumSize.click();
  await expect(mediumSize).toHaveCSS('background-color', addToCartBrown);
  await expect(addToCart).toBeEnabled();
  await expect(page.getByText('₹3,500')).toBeVisible();
  await expect(page.getByRole('img', { name: product.name })).toHaveAttribute('src', /m-black-front/);

  const sandColour = page.locator('button[title="Sand"]');
  await sandColour.click();
  await expect(sandColour).toHaveCSS('border-top-color', addToCartBrown);
  await expect(page.getByRole('img', { name: product.name })).toHaveAttribute('src', /sand-gallery/);

  expect(mockedApiPaths.length).toBeGreaterThan(0);
  expect(mockedApiPaths.every((path) => path === '/api/products/test-product')).toBe(true);
  expect(externalApiRequests).toEqual([]);
});

test('demo catalogue filters sizes by colour and blocks unavailable variants', async ({ page }) => {
  const baseURL = test.info().project.use.baseURL;
  const appOrigin = new URL(baseURL).origin;
  const product = {
    _id: 'demo-green-tee',
    name: 'DEMO Fictional Cotton Tee',
    isDemoData: true,
    demoLabel: 'DEMO CATALOGUE',
    category: 'T-Shirts',
    gender: 'men',
    price: 1899,
    description: 'DEMO DATA — Fictional menswear product.',
    sizes: ['S', 'M', 'L'],
    colours: [
      { name: 'Green', hex: '#5F725D', images: ['/images/demo-green.jpg'] },
      { name: 'Black', hex: '#171717', images: ['/images/demo-black.jpg'] }
    ],
    variants: [
      { size: 'S', colour: 'Green', stock: 0, sku: 'YQ-DEMO-GRN-S', status: 'active' },
      { size: 'M', colour: 'Green', stock: 5, reservedQuantity: 1, sku: 'YQ-DEMO-GRN-M', status: 'active' },
      { size: 'L', colour: 'Green', stock: 2, sku: 'YQ-DEMO-GRN-L', status: 'inactive' },
      { size: 'M', colour: 'Black', stock: 8, sku: 'YQ-DEMO-BLK-M', status: 'active' }
    ],
    images: ['/images/xora-garment-fallback.svg']
  };

  await page.route('**/*', async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.origin !== appOrigin) {
      await route.abort();
      return;
    }
    if (requestUrl.pathname.startsWith('/images/')) {
      await route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1" fill="#ddd"/></svg>'
      });
      return;
    }
    if (requestUrl.pathname.startsWith('/api/')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, product, relatedProducts: [] })
      });
      return;
    }
    await route.continue();
  });

  await page.goto('/product/demo-green-tee');
  await expect(page.getByRole('heading', { name: product.name, level: 1 })).toBeVisible();
  await expect(page.getByText('DEMO CATALOGUE', { exact: false })).toBeVisible();

  await expect(page.getByRole('button', { name: 'S', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'M', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'L', exact: true })).toBeDisabled();
  await expect(page.locator('#add-to-cart-detail-btn')).toBeEnabled();

  await page.locator('button[title="Black"]').click();
  await expect(page.getByRole('button', { name: 'M', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'S', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'L', exact: true })).toHaveCount(0);
  await expect(page.locator('#add-to-cart-detail-btn')).toBeEnabled();
});
