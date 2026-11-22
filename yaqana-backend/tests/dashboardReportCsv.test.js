import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDashboardReportCsv } from '../src/utils/dashboardReportCsv.js';

test('dashboard CSV contains report metrics and operational breakdowns without customer fields', () => {
  const csv = buildDashboardReportCsv({
    current: { orders: 4, revenue: 90, unitsSold: 5, averageOrderValue: 22.5, newCustomers: 2 },
    previous: { orders: 3, revenue: 70, unitsSold: 4, averageOrderValue: 23.3, newCustomers: 1 },
    comparisons: { orders: { label: '+33.3%' }, revenue: { label: '+28.6%' }, unitsSold: { label: '+25.0%' }, averageOrderValue: { label: '-3.4%' }, newCustomers: { label: '+100.0%' } },
    orderStatusBreakdown: [{ status: 'Processing', count: 2 }],
    paymentStatusBreakdown: [{ status: 'Paid', count: 3 }],
    bestSellers: [{ name: 'Linen Shirt', unitsSold: 5 }]
  });
  assert.match(csv, /"Performance","Revenue","90","70","'\+28\.6%"/u);
  assert.match(csv, /"Order status","Processing","2"/u);
  assert.match(csv, /"Payment status","Paid","3"/u);
  assert.match(csv, /"Best sellers","Linen Shirt","5"/u);
  assert.doesNotMatch(csv, /email|phone|@/iu);
});

test('dashboard CSV quotes fields and neutralizes spreadsheet formula prefixes', () => {
  const csv = buildDashboardReportCsv({
    current: {}, previous: {}, comparisons: {},
    orderStatusBreakdown: [{ status: '=HYPERLINK("https://example.test")', count: 1 }]
  });
  assert.match(csv, /"'=HYPERLINK\(""https:\/\/example\.test""\)","1"/u);
});
