import test from 'node:test';
import assert from 'node:assert/strict';
import Order from '../src/models/Order.js';
import User from '../src/models/User.js';
import { exportDashboardReportCsv } from '../src/controllers/adminController.js';

test('dashboard report CSV uses report aggregates and excludes customer contact data', async (t) => {
  t.mock.method(Order, 'aggregate', async (pipeline) => {
    assert.equal(pipeline[1].$facet.bestSellers[0].$match.paymentStatus, 'Paid');
    return [{
      totals: [{ currentOrders: 2, previousOrders: 1, currentRevenuePaise: 20000, previousRevenuePaise: 10000, currentPaidOrders: 2, previousPaidOrders: 1, currentUnitsSold: 3, previousUnitsSold: 1 }],
      chart: [],
      statusBreakdown: [{ _id: 'Processing', count: 2 }],
      paymentBreakdown: [{ _id: 'Paid', count: 2 }],
      bestSellers: [{ _id: 'product-1', name: 'Linen Shirt', unitsSold: 3 }]
    }];
  });
  t.mock.method(User, 'aggregate', async (pipeline) => {
    assert.equal(pipeline[0].$match.role, 'customer');
    return [{ current: 1, previous: 0 }];
  });
  const response = {
    statusCode: null,
    headers: {},
    body: '',
    status(code) { this.statusCode = code; return this; },
    type(value) { this.contentType = value; return this; },
    set(name, value) { this.headers[name] = value; return this; },
    send(body) { this.body = body; return this; }
  };
  await exportDashboardReportCsv({ query: { period: 'last7days', timeZone: 'Asia/Kolkata' } }, response, (error) => { throw error; });
  assert.equal(response.statusCode, 200);
  assert.match(response.contentType, /text\/csv/u);
  assert.match(response.headers['Content-Disposition'], /^attachment; filename="yaqana-dashboard-last7days-/u);
  assert.match(response.body, /"Order status","Processing","2"/u);
  assert.match(response.body, /"Payment status","Paid","2"/u);
  assert.match(response.body, /"Best sellers","Linen Shirt","3"/u);
  assert.doesNotMatch(response.body, /email|phone|customer@example/iu);
});
