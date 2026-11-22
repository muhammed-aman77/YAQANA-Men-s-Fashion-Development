import test from 'node:test';
import assert from 'node:assert/strict';
import { filterAndSortAdminProducts, paginateAdminProducts } from './adminProductList.js';

const products = [
  {
    _id: 'tee',
    name: 'Heavyweight Tee',
    slug: 'heavyweight-tee',
    category: 'T-Shirts',
    collectionName: 'Essentials',
    status: 'active',
    active: true,
    price: 120,
    discountPrice: 90,
    stock: 7,
    variants: [{ sku: 'YAQ-TEE-BLK-M', size: 'M', colour: 'Black', stock: 7 }]
  },
  {
    _id: 'shirt',
    name: 'Oxford Shirt',
    slug: 'oxford-shirt',
    category: 'Shirts',
    collection: 'Winter',
    status: 'draft',
    active: false,
    price: 100,
    stock: 0,
    variants: [{ sku: 'YAQ-OXF-WHT-L', size: 'L', colour: 'White', stock: 0 }]
  },
  {
    _id: 'trouser',
    name: 'Tailored Trouser',
    slug: 'tailored-trouser',
    category: 'Trousers',
    collectionName: 'Winter',
    status: 'active',
    active: true,
    price: 150,
    stock: 24,
    variants: [{ sku: 'YAQ-TRS-NVY-32', size: '32', colour: 'Navy', stock: 24 }]
  }
];

test('search finds a product through any variant SKU without case sensitivity', () => {
  const result = filterAndSortAdminProducts(products, {
    search: 'yaq-tee-blk-m',
    sortBy: 'name-asc'
  });

  assert.deepEqual(result.map((product) => product._id), ['tee']);
});

test('category, collection, status, and stock filters can be combined', () => {
  const result = filterAndSortAdminProducts(products, {
    category: 'Shirts',
    collection: 'Winter',
    status: 'draft',
    stock: 'out-of-stock'
  });

  assert.deepEqual(result.map((product) => product._id), ['shirt']);
});

test('price sorting uses the effective discounted price', () => {
  const result = filterAndSortAdminProducts(products, { sortBy: 'price-asc' });

  assert.deepEqual(result.map((product) => product._id), ['tee', 'shirt', 'trouser']);
});

test('pagination returns the requested slice and clamps a stale page', () => {
  const items = Array.from({ length: 24 }, (_, index) => ({ id: index + 1 }));

  assert.deepEqual(paginateAdminProducts(items, 3, 10), {
    items: [{ id: 21 }, { id: 22 }, { id: 23 }, { id: 24 }],
    currentPage: 3,
    totalPages: 3,
    totalItems: 24,
    firstItem: 21,
    lastItem: 24
  });
  assert.equal(paginateAdminProducts(items.slice(0, 1), 3, 10).currentPage, 1);
});

test('empty product results expose a usable first page without a false range', () => {
  assert.deepEqual(paginateAdminProducts([], 5, 10), {
    items: [],
    currentPage: 1,
    totalPages: 1,
    totalItems: 0,
    firstItem: 0,
    lastItem: 0
  });
});
