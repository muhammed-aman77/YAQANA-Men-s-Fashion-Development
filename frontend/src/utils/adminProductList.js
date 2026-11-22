import { LOW_STOCK_THRESHOLD } from './adminStatus.js';

const getProductStatus = (product) => product.status || (product.active === false ? 'archived' : 'active');
const getProductCollection = (product) => product.collectionName || product.collection || '';
const getProductPrice = (product) => Number(product.discountPrice ?? product.price ?? 0);
const getProductStock = (product) => Number(product.stock ?? 0);
const compareNames = (left, right) => String(left.name || '').localeCompare(String(right.name || ''), undefined, { sensitivity: 'base' });

function matchesStockFilter(product, stockFilter) {
  const stock = getProductStock(product);
  if (stockFilter === 'in-stock') return stock > LOW_STOCK_THRESHOLD;
  if (stockFilter === 'low-stock') return stock > 0 && stock <= LOW_STOCK_THRESHOLD;
  if (stockFilter === 'out-of-stock') return stock <= 0;
  return true;
}

function compareProducts(left, right, sortBy) {
  if (sortBy === 'name-desc') return compareNames(right, left);
  if (sortBy === 'price-asc') return getProductPrice(left) - getProductPrice(right) || compareNames(left, right);
  if (sortBy === 'price-desc') return getProductPrice(right) - getProductPrice(left) || compareNames(left, right);
  if (sortBy === 'stock-asc') return getProductStock(left) - getProductStock(right) || compareNames(left, right);
  if (sortBy === 'stock-desc') return getProductStock(right) - getProductStock(left) || compareNames(left, right);
  if (sortBy === 'newest') {
    const dateDifference = new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime();
    return dateDifference || compareNames(left, right);
  }
  return compareNames(left, right);
}

export function filterAndSortAdminProducts(products, filters = {}) {
  const search = String(filters.search || '').trim().toLowerCase();
  const category = String(filters.category || 'all').toLowerCase();
  const collection = String(filters.collection || 'all').toLowerCase();
  const status = String(filters.status || 'all').toLowerCase();
  const stock = String(filters.stock || 'all').toLowerCase();

  return (Array.isArray(products) ? products : [])
    .filter((product) => {
      const searchFields = [
        product.name,
        product.slug,
        product.category,
        getProductCollection(product),
        product.sku,
        ...(Array.isArray(product.variants) ? product.variants.map((variant) => variant.sku) : [])
      ].filter(Boolean).join(' ').toLowerCase();

      return (!search || searchFields.includes(search))
        && (category === 'all' || String(product.category || '').toLowerCase() === category)
        && (collection === 'all' || String(getProductCollection(product) || '').toLowerCase() === collection)
        && (status === 'all' || getProductStatus(product).toLowerCase() === status)
        && matchesStockFilter(product, stock);
    })
    .sort((left, right) => compareProducts(left, right, filters.sortBy || 'name-asc'));
}

export function paginateAdminProducts(products, page, pageSize = 10) {
  const safeProducts = Array.isArray(products) ? products : [];
  const safePageSize = Number.isInteger(pageSize) && pageSize > 0 ? pageSize : 10;
  const totalItems = safeProducts.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
  const requestedPage = Number.isInteger(page) ? page : 1;
  const currentPage = Math.min(Math.max(1, requestedPage), totalPages);
  const start = (currentPage - 1) * safePageSize;
  const items = safeProducts.slice(start, start + safePageSize);

  return {
    items,
    currentPage,
    totalPages,
    totalItems,
    firstItem: totalItems ? start + 1 : 0,
    lastItem: totalItems ? start + items.length : 0
  };
}
