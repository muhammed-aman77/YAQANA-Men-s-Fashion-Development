const periodLabels = Object.freeze({
  today: 'Today',
  last7days: 'Last 7 days',
  last30days: 'Last 30 days',
  last90days: 'Last 90 days'
});

export function getDashboardPeriodLabel(period) {
  const label = periodLabels[period];
  if (!label) throw new RangeError('Unsupported dashboard reporting period.');
  return label;
}

export function formatUpdatedThrough(asOf, timeZone) {
  const date = new Date(asOf);
  if (Number.isNaN(date.getTime())) throw new TypeError('Report update time must be a valid date.');
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

export function getComparisonPresentation(comparison) {
  if (comparison.direction === 'positive' && comparison.changePercent === null) {
    return {
      text: 'New',
      ariaLabel: 'New compared with the previous period',
      direction: 'positive'
    };
  }
  if (comparison.direction === 'neutral') {
    return {
      text: '0%',
      ariaLabel: 'No change compared with the previous period',
      direction: 'neutral'
    };
  }
  if (!['positive', 'negative'].includes(comparison.direction)
      || !Number.isFinite(comparison.changePercent)) {
    throw new TypeError('Report comparison is invalid.');
  }

  const percentage = Math.abs(comparison.changePercent).toFixed(1);
  if (comparison.direction === 'positive') {
    return {
      text: `+${percentage}%`,
      ariaLabel: `Increase ${percentage}% compared with the previous period`,
      direction: 'positive'
    };
  }
  return {
    text: `-${percentage}%`,
    ariaLabel: `Decrease ${percentage}% compared with the previous period`,
    direction: 'negative'
  };
}
