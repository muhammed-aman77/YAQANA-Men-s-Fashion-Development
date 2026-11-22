import assert from 'node:assert/strict';
import test from 'node:test';
import { getDashboardStats } from '../src/controllers/adminController.js';
import { buildDashboardReportPipeline, buildDashboardCustomerPipeline, buildLegacyMonthlyChartPipeline, assembleLegacyMonthlyChart, assembleDashboardReport, parseDashboardReportQuery } from '../src/utils/dashboardReportPipeline.js';
import { getDashboardReportingWindows } from '../src/utils/dashboardReporting.js';
import Order from '../src/models/Order.js';
import User from '../src/models/User.js';

const windows = getDashboardReportingWindows(
  'last7days',
  'Asia/Kolkata',
  new Date('2026-11-16T08:45:12.345Z')
);

function findStages(value, predicate, result = []) {
  if (!value || typeof value !== 'object') return result;
  if (predicate(value)) result.push(value);
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) child.forEach((item) => findStages(item, predicate, result));
    else findStages(child, predicate, result);
  }
  return result;
}

test('order report pipeline bounds both periods by createdAt', () => {
  const pipeline = buildDashboardReportPipeline(windows, 'Asia/Kolkata');
  assert.deepEqual(pipeline[0].$match.$or, [
    { createdAt: { $gte: windows.previous.start, $lte: windows.previous.end } },
    { createdAt: { $gte: windows.current.start, $lte: windows.current.end } }
  ]);
  assert.deepEqual(buildDashboardCustomerPipeline(windows)[0].$match.createdAt, {
    $gte: windows.previous.start,
    $lte: windows.current.end
  });
  assert.equal(buildDashboardCustomerPipeline(windows)[0].$match.role, 'customer');
});

test('report queries have createdAt supporting indexes', () => {
  assert.ok(Order.schema.indexes().some(([keys]) =>
    keys.createdAt === 1 && Object.keys(keys).length === 1));
  assert.ok(User.schema.indexes().some(([keys]) =>
    keys.role === 1 && keys.createdAt === 1));
});

test('legacy dashboard chart preserves six monthly buckets and response shape', () => {
  const asOf = new Date('2026-11-16T14:05:00.000Z');
  const pipeline = buildLegacyMonthlyChartPipeline(asOf, 'Europe/London');
  assert.equal(pipeline[0].$match.paymentStatus, 'Paid');
  assert.equal(pipeline[1].$group._id.$dateToString.timezone, 'Europe/London');

  const chart = assembleLegacyMonthlyChart([
    { _id: '2026-11', revenuePaise: 16600, orders: 2 },
    { _id: '2026-09', revenuePaise: 8300, orders: 1 }
  ], asOf, 'Europe/London');
  assert.deepEqual(chart.map(({ month }) => month), ['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov']);
  assert.deepEqual(chart[3], { month: 'Sep', revenue: 1, orders: 1 });
  assert.deepEqual(chart[5], { month: 'Nov', revenue: 2, orders: 2 });
  assert.deepEqual(chart[4], { month: 'Oct', revenue: 0, orders: 0 });
});

test('revenue and units sold use paid non-cancelled orders', () => {
  const pipeline = buildDashboardReportPipeline(windows, 'Asia/Kolkata');
  const serialised = JSON.stringify(pipeline[1].$facet);
  assert.ok(serialised.includes('"$eq":["$paymentStatus","Paid"]'));
  assert.ok(serialised.includes('"$ne":["$orderStatus","Cancelled"]'));
  assert.ok(serialised.includes('"$reduce":'));
  assert.ok(serialised.includes('"$items"'));
});

test('order totals retain all-status created-order semantics', () => {
  const pipeline = buildDashboardReportPipeline(windows, 'Asia/Kolkata');
  const totalGroup = pipeline[1].$facet.totals[0].$group;
  assert.deepEqual(totalGroup.currentOrders, {
    $sum: {
      $cond: [
        { $and: [
          { $gte: ['$createdAt', windows.current.start] },
          { $lte: ['$createdAt', windows.current.end] }
        ] },
        1,
        0
      ]
    }
  });
  assert.equal(Object.hasOwn(totalGroup, 'currentPaidOrders'), true);
});

test('chart buckets use the selected time zone and the same revenue predicate', () => {
  const pipeline = buildDashboardReportPipeline(windows, 'Europe/London');
  const chartPipeline = pipeline[1].$facet.chart;
  const dateExpressions = findStages(chartPipeline, (stage) => stage.$dateToString);
  assert.equal(dateExpressions.length, 1);
  assert.equal(dateExpressions[0].$dateToString.timezone, 'Europe/London');
  const chartMatch = chartPipeline[0].$match;
  assert.equal(chartMatch.paymentStatus, 'Paid');
  assert.deepEqual(chartMatch.orderStatus, { $ne: 'Cancelled' });
});

test('dashboard facets derive current order status, payment status, and paid top sellers from records', () => {
  const pipeline = buildDashboardReportPipeline(windows, 'Asia/Kolkata');
  const facets = pipeline[1].$facet;
  assert.deepEqual(facets.statusBreakdown[0].$match, { createdAt: { $gte: windows.current.start, $lte: windows.current.end } });
  assert.deepEqual(facets.paymentBreakdown[0].$match, { createdAt: { $gte: windows.current.start, $lte: windows.current.end } });
  assert.equal(facets.bestSellers[0].$match.paymentStatus, 'Paid');
  assert.deepEqual(facets.bestSellers[0].$match.orderStatus, { $ne: 'Cancelled' });
  assert.deepEqual(facets.bestSellers[0].$match.createdAt, { $gte: windows.current.start, $lte: windows.current.end });
  assert.equal(facets.bestSellers.at(-2).$limit, 5);

  const report = assembleDashboardReport({
    orderRows: [{
      totals: [], chart: [],
      statusBreakdown: [{ _id: 'Processing', count: 3 }],
      paymentBreakdown: [{ _id: 'Paid', count: 2 }, { _id: 'Pending', count: 1 }],
      bestSellers: [{ _id: 'product-1', name: 'Linen Shirt', unitsSold: 4 }]
    }],
    customerRows: [], windows, period: 'last7days', timeZone: 'Asia/Kolkata'
  });
  assert.deepEqual(report.orderStatusBreakdown, [{ status: 'Processing', count: 3 }]);
  assert.deepEqual(report.paymentStatusBreakdown, [{ status: 'Paid', count: 2 }, { status: 'Pending', count: 1 }]);
  assert.deepEqual(report.bestSellers, [{ productId: 'product-1', name: 'Linen Shirt', unitsSold: 4 }]);
});

test('chart report aligns matching local dates and fills days without orders with zero', () => {
  const report = assembleDashboardReport({
    orderRows: [{
      totals: [],
      chart: [
        { _id: { period: 'current', localDate: '2026-11-10' }, revenuePaise: 8300, orders: 1 },
        { _id: { period: 'previous', localDate: '2026-11-03' }, revenuePaise: 16600, orders: 2 }
      ]
    }],
    customerRows: [],
    windows,
    period: 'last7days',
    timeZone: 'Asia/Kolkata'
  });
  assert.equal(report.chartData.length, 7);
  assert.deepEqual(report.chartData[0], {
    localDate: '2026-11-10',
    previousLocalDate: '2026-11-03',
    current: { revenue: 1, orders: 1 },
    previous: { revenue: 2, orders: 2 }
  });
  assert.deepEqual(report.chartData[6], {
    localDate: '2026-11-16',
    previousLocalDate: '2026-11-09',
    current: { revenue: 0, orders: 0 },
    previous: { revenue: 0, orders: 0 }
  });
});

test('report metrics derive AOV and changes from aggregate paise values', () => {
  const report = assembleDashboardReport({
    orderRows: [{
      totals: [{
        currentOrders: 2,
        previousOrders: 1,
        currentRevenuePaise: 16600,
        previousRevenuePaise: 8300,
        currentPaidOrders: 2,
        previousPaidOrders: 1,
        currentUnitsSold: 3,
        previousUnitsSold: 2
      }],
      chart: []
    }],
    customerRows: [{ current: 1, previous: 0 }],
    windows,
    period: 'last7days',
    timeZone: 'Asia/Kolkata'
  });

  assert.deepEqual(report.current, {
    orders: 2,
    revenue: 2,
    unitsSold: 3,
    averageOrderValue: 1,
    newCustomers: 1
  });
  assert.deepEqual(report.previous, {
    orders: 1,
    revenue: 1,
    unitsSold: 2,
    averageOrderValue: 1,
    newCustomers: 0
  });
  assert.equal(report.comparisons.revenue.changePercent, 100);
  assert.equal(report.comparisons.averageOrderValue.direction, 'neutral');
  assert.deepEqual(report.comparisons.newCustomers, {
    changePercent: null,
    direction: 'positive',
    label: 'New'
  });
});

test('report with no qualifying orders has no NaN or success-shaped sample values', () => {
  const report = assembleDashboardReport({
    orderRows: [],
    customerRows: [],
    windows,
    period: 'last7days',
    timeZone: 'Asia/Kolkata'
  });
  assert.deepEqual(report.current, {
    orders: 0,
    revenue: 0,
    unitsSold: 0,
    averageOrderValue: 0,
    newCustomers: 0
  });
  assert.deepEqual(report.previous, report.current);
  assert.ok(report.chartData.every(({ current, previous }) =>
    current.revenue === 0 && current.orders === 0 && previous.revenue === 0 && previous.orders === 0));
});

test('admin stats rejects unsupported period and reporting zone', async () => {
  assert.deepEqual(parseDashboardReportQuery({}), {
    period: 'last7days',
    timeZone: 'Asia/Kolkata'
  });
  for (const query of [
    { period: 'last14days', timeZone: 'Asia/Kolkata' },
    { period: 'last7days', timeZone: 'America/New_York' }
  ]) {
    const error = await new Promise((resolve) => {
      getDashboardStats(
        { query },
        { json: () => assert.fail('invalid query must not load dashboard data') },
        resolve
      );
    });
    assert.equal(error.statusCode, 400);
  }
});
