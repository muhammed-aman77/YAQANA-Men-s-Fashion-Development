import test from 'node:test';
import assert from 'node:assert/strict';

const now = new Date('2026-02-01T12:00:00.000Z');
const loadInventoryReadModel = async () => {
  const module = await import('../src/utils/inventoryReadModel.js').catch(() => null);
  assert.ok(module, 'inventoryReadModel.js should be implemented');
  for (const name of ['buildInventoryReadModel', 'filterInventoryRows', 'inventoryRowsToCsv', 'paginateInventoryRows']) {
    assert.equal(typeof module[name], 'function', `${name} should be exported`);
  }
  return module;
};

test('inventory read model exposes demo identity without mixing legacy and demo totals', async () => {
  const { buildInventoryReadModel } = await loadInventoryReadModel();
  const result = buildInventoryReadModel({
    now,
    products: [
      {
        _id: 'legacy-product',
        name: 'Legacy Product',
        category: 'T-Shirts',
        active: true,
        stock: 370,
        isDemoData: false,
        variants: []
      },
      {
        _id: 'demo-product',
        name: 'DEMO Fictional Tee',
        category: 'T-Shirts',
        active: true,
        stock: 12,
        isDemoData: true,
        demoKey: 'YAQANA-DEMO-FICTIONAL-Tee',
        demoLabel: 'DEMO CATALOGUE',
        variants: [{
          size: 'M',
          colour: 'Green',
          sku: 'YQ-DEMO-FICTIONAL-GRN-M',
          status: 'active',
          stock: 12,
          reservedQuantity: 2
        }]
      }
    ]
  });

  const demoRow = result.inventory.find((row) => row.sku === 'YQ-DEMO-FICTIONAL-GRN-M');
  assert.equal(demoRow.isDemoData, true);
  assert.equal(demoRow.demoLabel, 'DEMO CATALOGUE');
  assert.equal(demoRow.availableStock, 10);
  assert.equal(result.summary.unitsOnHand, 382);
  assert.equal(result.summary.unallocatedLegacyUnits, 370);
});

test('inventory read model totals SKU, legacy, reserved, committed, incoming, retail, and cost coverage separately', async () => {
  const { buildInventoryReadModel } = await loadInventoryReadModel();
  const result = buildInventoryReadModel({
    now,
    policy: { lowStockThreshold: 10, criticalStockThreshold: 3 },
    committedQuantities: new Map([['product-1:YAQ-TEE-S', 1]]),
    products: [
      {
        _id: 'product-1',
        name: 'Core Tee',
        category: 'T-Shirts',
        active: true,
        updatedAt: new Date('2026-01-30T12:00:00.000Z'),
        pricePaise: 90000,
        discountPricePaise: 80000,
        images: ['/images/core-tee.jpg'],
        stock: 10,
        variants: [
          {
            size: 'S',
            colour: 'Black',
            sku: 'YAQ-TEE-S',
            status: 'active',
            stock: 10,
            reservedQuantity: 2,
            pricePaise: 50000,
            discountPricePaise: 45000,
            unitCostPaise: 10000,
            costedQuantity: 2,
            reorderTarget: 15
          },
          { size: 'M', colour: 'Black', sku: 'YAQ-TEE-M', stock: 0, status: 'discontinued' }
        ]
      },
      {
        _id: 'product-2',
        name: 'Legacy Shirt',
        category: 'Shirts',
        active: true,
        pricePaise: 20000,
        stock: 5,
        variants: []
      }
    ],
    receipts: [{
      product: 'product-1',
      sku: 'YAQ-TEE-S',
      expectedQuantity: 10,
      receivedQuantity: 2,
      damagedQuantity: 1,
      rejectedQuantity: 1,
      cancelledQuantity: 0,
      status: 'open'
    }],
    movements: [{
      createdAt: new Date('2026-01-20T12:00:00.000Z'),
      status: 'applied',
      changes: [{ product: 'product-1', sku: 'YAQ-TEE-S', quantityDelta: 2 }]
    }],
    orders: [{
      createdAt: new Date('2026-01-20T12:00:00.000Z'),
      orderStatus: 'Confirmed',
      items: [{ product: 'product-1', sku: 'YAQ-TEE-S', quantity: 2 }]
    }, {
      createdAt: new Date('2026-01-18T12:00:00.000Z'),
      orderStatus: 'Cancelled',
      items: [{ product: 'product-1', sku: 'YAQ-TEE-S', quantity: 9 }]
    }],
    orderHistoryCoveredFrom: new Date('2025-10-01T00:00:00.000Z')
  });

  const sku = result.inventory.find((item) => item.sku === 'YAQ-TEE-S');
  const legacy = result.inventory.find((item) => item.sku === null);
  assert.deepEqual({
    onHand: sku.onHand,
    reserved: sku.reservedQuantity,
    available: sku.availableStock,
    committed: sku.committedQuantity,
    incoming: sku.incomingQuantity,
    price: sku.pricePaise,
    retail: sku.retailValuePaise,
    costed: sku.costedQuantity,
    uncosted: sku.uncostedQuantity,
    costCoverage: sku.costCoverage,
    acquisitionValue: sku.acquisitionValuePaise,
    demand30: sku.demand30Days,
    demand90: sku.demand90Days,
    age: sku.stockAgeDays,
    variantStatus: sku.variantStatus,
    updatedAt: sku.updatedAt,
    restock: sku.restockSuggestion
  }, {
    onHand: 10,
    reserved: 2,
    available: 8,
    committed: 1,
    incoming: 6,
    price: 45000,
    retail: 450000,
    costed: 2,
    uncosted: 8,
    costCoverage: 'partial',
    acquisitionValue: null,
    demand30: 2,
    demand90: 2,
    age: 12,
    variantStatus: 'active',
    updatedAt: new Date('2026-01-30T12:00:00.000Z'),
    restock: 1
  });
  assert.equal(result.inventory.find((item) => item.sku === 'YAQ-TEE-M').variantStatus, 'discontinued');
  assert.equal(legacy.sku, null);
  assert.equal(legacy.costCoverage, 'unknown');
  assert.equal(legacy.acquisitionValuePaise, null);
  assert.deepEqual(result.summary, {
    totalProducts: 2,
    totalSkus: 2,
    stockRecords: 3,
    unitsOnHand: 15,
    unallocatedLegacyUnits: 5,
    availableUnits: 13,
    reservedUnits: 2,
    committedUnits: 1,
    incomingUnits: 6,
    lowStockRecords: 2,
    criticalStockRecords: 0,
    outOfStockRecords: 1,
    retailValuePaise: 550000,
    costedQuantity: 2,
    costedValuePaise: 20000,
    uncostedQuantity: 13,
    acquisitionValuePaise: null,
    pendingReceiptCount: 1
  });
});

test('inventory search, filters, sorting, and pagination use bounded page sizes', async () => {
  const { filterInventoryRows, paginateInventoryRows } = await loadInventoryReadModel();
  const rows = [
    { productName: 'Sand Tee', sku: 'TEE-S', category: 'T-Shirts', active: true, colour: 'Sand', status: 'low_stock', availableStock: 4, onHand: 7 },
    { productName: 'Black Shirt', sku: 'SHIRT-M', category: 'Shirts', active: true, colour: 'Black', status: 'in_stock', availableStock: 12, onHand: 12 },
    { productName: 'Black Tee', sku: 'TEE-M', category: 'T-Shirts', active: false, variantStatus: 'discontinued', colour: 'Black', status: 'out_of_stock', availableStock: 0, onHand: 0 }
  ];

  assert.deepEqual(filterInventoryRows(rows, {
    search: 'black',
    category: 'T-Shirts',
    active: 'false',
    status: 'out_of_stock',
    sort: 'available-asc'
  }), [rows[2]]);
  assert.deepEqual(filterInventoryRows(rows, { variantStatus: 'discontinued' }), [rows[2]]);
  const page = paginateInventoryRows(Array.from({ length: 105 }, (_, index) => ({ sku: `SKU-${index}` })), 0, 1000);
  assert.equal(page.inventory.length, 100);
  assert.equal(page.currentPage, 1);
  assert.equal(page.pageSize, 100);
  assert.equal(page.totalCount, 105);
  assert.equal(page.totalPages, 2);
});

test('incoming-only inventory filter excludes SKUs without open inbound stock', async () => {
  const { filterInventoryRows } = await loadInventoryReadModel();
  const rows = [
    { sku: 'TEE-S', incomingQuantity: 4 },
    { sku: 'TEE-M', incomingQuantity: 0 },
    { sku: 'TEE-L', incomingQuantity: 2 }
  ];

  assert.deepEqual(filterInventoryRows(rows, { incomingOnly: true }), [rows[2], rows[0]]);
});

test('inventory CSV escapes delimiters and formula-like text without customer fields', async () => {
  const { inventoryRowsToCsv } = await loadInventoryReadModel();
  const csv = inventoryRowsToCsv([{
    productName: '=HYPERLINK("https://example.test")',
    category: 'T-Shirts, Shirts',
    sku: 'YAQ-TEE-S',
    size: 'S',
    colour: 'Black',
    onHand: 4,
    reservedQuantity: 1,
    availableStock: 3,
    committedQuantity: 1,
    incomingQuantity: 2,
    status: 'low_stock',
    pricePaise: 45000,
    retailValuePaise: 180000,
    costedQuantity: 0,
    costedValuePaise: 0,
    costCoverage: 'unknown',
    lastActivity: null
  }]);

  assert.match(csv, /"'=HYPERLINK\(""https:\/\/example\.test""\)"/);
  assert.match(csv, /"T-Shirts, Shirts"/);
  assert.doesNotMatch(csv, /email|customer|payment/i);
});

test('inventory cost valuation stays unavailable when any legacy stock is uncosted', async () => {
  const { buildInventoryReadModel } = await loadInventoryReadModel();
  const result = buildInventoryReadModel({
    now,
    policy: { lowStockThreshold: 10, criticalStockThreshold: 3 },
    products: [{
      _id: 'legacy-product',
      name: 'Legacy Tee',
      category: 'T-Shirts',
      active: true,
      pricePaise: 20000,
      stock: 4,
      variants: []
    }]
  });

  assert.equal(result.inventory[0].retailValuePaise, 80000);
  assert.equal(result.inventory[0].acquisitionValuePaise, null);
  assert.equal(result.summary.acquisitionValuePaise, null);
});
