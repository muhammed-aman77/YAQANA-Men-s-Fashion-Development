import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatUpdatedThrough,
  getComparisonPresentation,
  getDashboardPeriodLabel
} from './dashboardAnalytics.js';

test('reporting period labels match the supported presets', () => {
  assert.equal(getDashboardPeriodLabel('today'), 'Today');
  assert.equal(getDashboardPeriodLabel('last7days'), 'Last 7 days');
  assert.equal(getDashboardPeriodLabel('last30days'), 'Last 30 days');
  assert.equal(getDashboardPeriodLabel('last90days'), 'Last 90 days');
});

test('updated-through time uses the selected reporting zone', () => {
  const asOf = '2026-11-16T14:05:00.000Z';
  assert.equal(formatUpdatedThrough(asOf, 'Europe/London'), '16 Nov 2026, 14:05');
  assert.equal(formatUpdatedThrough(asOf, 'Asia/Kolkata'), '16 Nov 2026, 19:35');
});

test('positive zero-baseline comparisons render as New without a percentage', () => {
  assert.deepEqual(getComparisonPresentation({
    changePercent: null,
    direction: 'positive',
    label: 'New'
  }), {
    text: 'New',
    ariaLabel: 'New compared with the previous period',
    direction: 'positive'
  });
});

test('negative and neutral comparisons have accessible text labels', () => {
  assert.deepEqual(getComparisonPresentation({
    changePercent: -25,
    direction: 'negative',
    label: '-25.0%'
  }), {
    text: '-25.0%',
    ariaLabel: 'Decrease 25.0% compared with the previous period',
    direction: 'negative'
  });
  assert.deepEqual(getComparisonPresentation({
    changePercent: 0,
    direction: 'neutral',
    label: '0%'
  }), {
    text: '0%',
    ariaLabel: 'No change compared with the previous period',
    direction: 'neutral'
  });
});
