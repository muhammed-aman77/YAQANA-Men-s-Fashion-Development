import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareMetricValues,
  getDashboardReportingWindows,
  isSupportedReportingSelection
} from '../src/utils/dashboardReporting.js';

const iso = (date) => date.toISOString();

test('today compares local midnight-to-now with yesterday through the same local time', () => {
  const india = getDashboardReportingWindows(
    'today',
    'Asia/Kolkata',
    new Date('2026-11-16T08:45:12.345Z')
  );
  assert.equal(iso(india.current.start), '2026-11-15T18:30:00.000Z');
  assert.equal(iso(india.current.end), '2026-11-16T08:45:12.345Z');
  assert.equal(iso(india.previous.start), '2026-11-14T18:30:00.000Z');
  assert.equal(iso(india.previous.end), '2026-11-15T08:45:12.345Z');

  const london = getDashboardReportingWindows(
    'today',
    'Europe/London',
    new Date('2026-11-16T14:05:00.000Z')
  );
  assert.equal(iso(london.current.start), '2026-11-16T00:00:00.000Z');
  assert.equal(iso(london.current.end), '2026-11-16T14:05:00.000Z');
  assert.equal(iso(london.previous.start), '2026-11-15T00:00:00.000Z');
  assert.equal(iso(london.previous.end), '2026-11-15T14:05:00.000Z');
});

test('last seven days includes today and six preceding local dates', () => {
  const originalTimeZone = process.env.TZ;
  try {
    process.env.TZ = 'UTC';
    const utcProcess = getDashboardReportingWindows(
      'last7days',
      'Asia/Kolkata',
      new Date('2026-11-16T08:45:12.345Z')
    );
    process.env.TZ = 'America/Los_Angeles';
    const pacificProcess = getDashboardReportingWindows(
      'last7days',
      'Asia/Kolkata',
      new Date('2026-11-16T08:45:12.345Z')
    );

    assert.deepEqual(pacificProcess, utcProcess);
    assert.equal(iso(utcProcess.current.start), '2026-11-09T18:30:00.000Z');
    assert.equal(iso(utcProcess.current.end), '2026-11-16T08:45:12.345Z');
    assert.equal(iso(utcProcess.previous.start), '2026-11-02T18:30:00.000Z');
    assert.equal(iso(utcProcess.previous.end), '2026-11-09T08:45:12.345Z');
  } finally {
    if (originalTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimeZone;
  }
});

test('last thirty and ninety day windows preserve their local calendar lengths', () => {
  const thirtyDays = getDashboardReportingWindows(
    'last30days',
    'Asia/Kolkata',
    new Date('2026-11-16T08:45:12.345Z')
  );
  assert.equal(iso(thirtyDays.current.start), '2026-10-17T18:30:00.000Z');
  assert.equal(iso(thirtyDays.previous.start), '2026-09-17T18:30:00.000Z');
  assert.equal(iso(thirtyDays.previous.end), '2026-10-17T08:45:12.345Z');

  const ninetyDays = getDashboardReportingWindows(
    'last90days',
    'Europe/London',
    new Date('2026-11-16T14:05:00.000Z')
  );
  assert.equal(iso(ninetyDays.current.start), '2026-08-18T23:00:00.000Z');
  assert.equal(iso(ninetyDays.previous.start), '2026-05-20T23:00:00.000Z');
  assert.equal(iso(ninetyDays.previous.end), '2026-08-18T13:05:00.000Z');
});

test('London reporting windows handle spring-forward and fall-back transitions', () => {
  const springForward = getDashboardReportingWindows(
    'last7days',
    'Europe/London',
    new Date('2026-03-29T12:00:00.000Z')
  );
  assert.equal(iso(springForward.current.start), '2026-03-23T00:00:00.000Z');
  assert.equal(iso(springForward.previous.start), '2026-03-16T00:00:00.000Z');
  assert.equal(iso(springForward.previous.end), '2026-03-22T13:00:00.000Z');

  const fallBack = getDashboardReportingWindows(
    'last7days',
    'Europe/London',
    new Date('2026-10-25T01:30:00.000Z')
  );
  assert.equal(iso(fallBack.current.start), '2026-10-18T23:00:00.000Z');
  assert.equal(iso(fallBack.previous.start), '2026-10-11T23:00:00.000Z');
  assert.equal(iso(fallBack.previous.end), '2026-10-18T00:30:00.000Z');
});

test('unsupported periods and time zones are rejected', () => {
  assert.equal(isSupportedReportingSelection('last7days', 'Asia/Kolkata'), true);
  assert.equal(isSupportedReportingSelection('last30days', 'Europe/London'), true);
  assert.equal(isSupportedReportingSelection('last14days', 'Asia/Kolkata'), false);
  assert.equal(isSupportedReportingSelection('today', 'America/New_York'), false);
});

test('metric comparisons handle positive, negative, neutral, and zero baselines', () => {
  assert.deepEqual(compareMetricValues(125, 100), {
    changePercent: 25,
    direction: 'positive',
    label: '+25.0%'
  });
  assert.deepEqual(compareMetricValues(75, 100), {
    changePercent: -25,
    direction: 'negative',
    label: '-25.0%'
  });
  assert.deepEqual(compareMetricValues(100, 100), {
    changePercent: 0,
    direction: 'neutral',
    label: '0%'
  });
  assert.deepEqual(compareMetricValues(0, 0), {
    changePercent: 0,
    direction: 'neutral',
    label: '0%'
  });
  assert.deepEqual(compareMetricValues(8, 0), {
    changePercent: null,
    direction: 'positive',
    label: 'New'
  });
});
