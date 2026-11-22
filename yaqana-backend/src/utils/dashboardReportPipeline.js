import { compareMetricValues, isSupportedReportingSelection } from './dashboardReporting.js';
import { httpError } from './http.js';
import { paiseToCatalogUnits } from './money.js';

const REPORTING_PERIOD_DAYS = Object.freeze({
  today: 1,
  last7days: 7,
  last30days: 30,
  last90days: 90
});

function inWindowExpression(window) {
  return {
    $and: [
      { $gte: ['$createdAt', window.start] },
      { $lte: ['$createdAt', window.end] }
    ]
  };
}

function qualifiedOrderExpression(window) {
  return {
    $and: [
      inWindowExpression(window),
      { $eq: ['$paymentStatus', 'Paid'] },
      { $ne: ['$orderStatus', 'Cancelled'] }
    ]
  };
}

function sumItemQuantitiesExpression() {
  return {
    $reduce: {
      input: { $ifNull: ['$items', []] },
      initialValue: 0,
      in: { $add: ['$$value', { $ifNull: ['$$this.quantity', 0] }] }
    }
  };
}

function sumIf(condition, value) {
  return { $sum: { $cond: [condition, value, 0] } };
}

export function buildDashboardReportPipeline(windows, timeZone) {
  const periodMatch = {
    $or: [
      { createdAt: { $gte: windows.previous.start, $lte: windows.previous.end } },
      { createdAt: { $gte: windows.current.start, $lte: windows.current.end } }
    ]
  };
  const currentWindow = inWindowExpression(windows.current);
  const previousWindow = inWindowExpression(windows.previous);
  const currentPaidOrder = qualifiedOrderExpression(windows.current);
  const previousPaidOrder = qualifiedOrderExpression(windows.previous);

  return [
    { $match: periodMatch },
    {
      $facet: {
        totals: [{
          $group: {
            _id: null,
            currentOrders: sumIf(currentWindow, 1),
            previousOrders: sumIf(previousWindow, 1),
            currentRevenuePaise: sumIf(currentPaidOrder, { $ifNull: ['$totalPaise', 0] }),
            previousRevenuePaise: sumIf(previousPaidOrder, { $ifNull: ['$totalPaise', 0] }),
            currentPaidOrders: sumIf(currentPaidOrder, 1),
            previousPaidOrders: sumIf(previousPaidOrder, 1),
            currentUnitsSold: sumIf(currentPaidOrder, sumItemQuantitiesExpression()),
            previousUnitsSold: sumIf(previousPaidOrder, sumItemQuantitiesExpression())
          }
        }],
        chart: [
          {
            $match: {
              ...periodMatch,
              paymentStatus: 'Paid',
              orderStatus: { $ne: 'Cancelled' }
            }
          },
          {
            $project: {
              period: {
                $cond: [currentWindow, 'current', 'previous']
              },
              localDate: {
                $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: timeZone }
              },
              totalPaise: 1
            }
          },
          {
            $group: {
              _id: { period: '$period', localDate: '$localDate' },
              revenuePaise: { $sum: { $ifNull: ['$totalPaise', 0] } },
              orders: { $sum: 1 }
            }
          }
        ],
        statusBreakdown: [
          { $match: { createdAt: { $gte: windows.current.start, $lte: windows.current.end } } },
          { $group: { _id: { $ifNull: ['$orderStatus', 'Unknown'] }, count: { $sum: 1 } } },
          { $sort: { count: -1, _id: 1 } }
        ],
        paymentBreakdown: [
          { $match: { createdAt: { $gte: windows.current.start, $lte: windows.current.end } } },
          { $group: { _id: { $ifNull: ['$paymentStatus', 'Unknown'] }, count: { $sum: 1 } } },
          { $sort: { count: -1, _id: 1 } }
        ],
        bestSellers: [
          { $match: {
            createdAt: { $gte: windows.current.start, $lte: windows.current.end },
            paymentStatus: 'Paid',
            orderStatus: { $ne: 'Cancelled' }
          } },
          { $unwind: '$items' },
          { $group: {
            _id: { productId: '$items.product', name: '$items.name' },
            unitsSold: { $sum: { $ifNull: ['$items.quantity', 0] } }
          } },
          { $sort: { unitsSold: -1, '_id.productId': 1 } },
          { $limit: 5 },
          { $project: { _id: '$_id.productId', name: '$_id.name', unitsSold: 1 } }
        ]
      }
    }
  ];
}

export function buildDashboardCustomerPipeline(windows) {
  return [
    {
      $match: {
        role: 'customer',
        createdAt: { $gte: windows.previous.start, $lte: windows.current.end }
      }
    },
    {
      $group: {
        _id: null,
        current: sumIf(inWindowExpression(windows.current), 1),
        previous: sumIf(inWindowExpression(windows.previous), 1)
      }
    },
    { $project: { _id: 0, current: 1, previous: 1 } }
  ];
}

function localDateKey(date, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date)
    .filter(({ type }) => type !== 'literal')
    .map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function shiftDateKey(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function getLocalYearMonth(date, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit'
  }).formatToParts(date)
    .filter(({ type }) => type !== 'literal')
    .map(({ type, value }) => [type, Number(value)]));
  return parts;
}

export function buildLegacyMonthlyChartPipeline(asOf, timeZone) {
  const { year, month } = getLocalYearMonth(asOf, timeZone);
  const start = new Date(Date.UTC(year, month - 6, 1) - 24 * 60 * 60 * 1000);
  return [
    { $match: { paymentStatus: 'Paid', createdAt: { $gte: start, $lte: asOf } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: timeZone } },
        revenuePaise: { $sum: '$totalPaise' },
        orders: { $sum: 1 }
      }
    }
  ];
}

export function assembleLegacyMonthlyChart(rows, asOf, timeZone) {
  const { year, month } = getLocalYearMonth(asOf, timeZone);
  const byMonth = new Map((rows || []).map((row) => [row._id, row]));
  return Array.from({ length: 6 }, (_value, index) => {
    const date = new Date(Date.UTC(year, month - 6 + index, 1));
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    const row = byMonth.get(key);
    return {
      month: new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(date),
      revenue: paiseToCatalogUnits(row?.revenuePaise || 0),
      orders: row?.orders || 0
    };
  });
}

function chartRows(rows, currentDays, timeZone) {
  const byPeriodDate = new Map((rows || []).map((row) => [
    `${row._id.period}:${row._id.localDate}`,
    row
  ]));
  const currentStart = localDateKey(currentDays.start, timeZone);
  const previousStart = localDateKey(currentDays.previousStart, timeZone);

  return Array.from({ length: currentDays.length }, (_value, index) => {
    const localDate = shiftDateKey(currentStart, index);
    const previousLocalDate = shiftDateKey(previousStart, index);
    const currentRow = byPeriodDate.get(`current:${localDate}`);
    const previousRow = byPeriodDate.get(`previous:${previousLocalDate}`);
    return {
      localDate,
      previousLocalDate,
      current: {
        revenue: paiseToCatalogUnits(currentRow?.revenuePaise || 0),
        orders: currentRow?.orders || 0
      },
      previous: {
        revenue: paiseToCatalogUnits(previousRow?.revenuePaise || 0),
        orders: previousRow?.orders || 0
      }
    };
  });
}

export function assembleDashboardReport({ orderRows, customerRows, windows, period, timeZone }) {
  const summary = orderRows?.[0]?.totals?.[0] || {};
  const customerSummary = customerRows?.[0] || {};
  const currentRevenuePaise = summary.currentRevenuePaise || 0;
  const previousRevenuePaise = summary.previousRevenuePaise || 0;
  const currentPaidOrders = summary.currentPaidOrders || 0;
  const previousPaidOrders = summary.previousPaidOrders || 0;
  const currentAverageOrderPaise = currentPaidOrders ? currentRevenuePaise / currentPaidOrders : 0;
  const previousAverageOrderPaise = previousPaidOrders ? previousRevenuePaise / previousPaidOrders : 0;
  const current = {
    orders: summary.currentOrders || 0,
    revenue: paiseToCatalogUnits(currentRevenuePaise),
    unitsSold: summary.currentUnitsSold || 0,
    averageOrderValue: paiseToCatalogUnits(currentAverageOrderPaise),
    newCustomers: customerSummary.current || 0
  };
  const previous = {
    orders: summary.previousOrders || 0,
    revenue: paiseToCatalogUnits(previousRevenuePaise),
    unitsSold: summary.previousUnitsSold || 0,
    averageOrderValue: paiseToCatalogUnits(previousAverageOrderPaise),
    newCustomers: customerSummary.previous || 0
  };
  const comparisons = {
    orders: compareMetricValues(current.orders, previous.orders),
    revenue: compareMetricValues(currentRevenuePaise, previousRevenuePaise),
    unitsSold: compareMetricValues(current.unitsSold, previous.unitsSold),
    averageOrderValue: compareMetricValues(currentAverageOrderPaise, previousAverageOrderPaise),
    newCustomers: compareMetricValues(current.newCustomers, previous.newCustomers)
  };

  return {
    period,
    timeZone,
    asOf: windows.asOf,
    windows: {
      current: windows.current,
      previous: windows.previous
    },
    current,
    previous,
    comparisons,
    chartData: chartRows(orderRows?.[0]?.chart, {
      start: windows.current.start,
      previousStart: windows.previous.start,
      length: REPORTING_PERIOD_DAYS[period]
    }, timeZone),
    orderStatusBreakdown: (orderRows?.[0]?.statusBreakdown || []).map((row) => ({ status: row._id || 'Unknown', count: row.count || 0 })),
    paymentStatusBreakdown: (orderRows?.[0]?.paymentBreakdown || []).map((row) => ({ status: row._id || 'Unknown', count: row.count || 0 })),
    bestSellers: (orderRows?.[0]?.bestSellers || []).map((row) => ({
      productId: row._id == null ? null : String(row._id),
      name: String(row.name || 'Product'),
      unitsSold: row.unitsSold || 0
    }))
  };
}

export function parseDashboardReportQuery(query = {}) {
  const period = query.period ?? 'last7days';
  const timeZone = query.timeZone ?? 'Asia/Kolkata';
  if (!isSupportedReportingSelection(period, timeZone)) {
    throw httpError(400, 'Unsupported reporting period or time zone.');
  }
  return { period, timeZone };
}
