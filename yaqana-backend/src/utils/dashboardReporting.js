const REPORTING_PERIOD_DAYS = Object.freeze({
  today: 1,
  last7days: 7,
  last30days: 30,
  last90days: 90
});

export const SUPPORTED_REPORTING_TIME_ZONES = Object.freeze(['Asia/Kolkata', 'Europe/London']);
const HOUR_MS = 60 * 60 * 1000;

function createDateTimeFormatter(timeZone) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });
}

function getZonedParts(date, formatter) {
  const parts = Object.fromEntries(
    formatter.formatToParts(date)
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value }) => [type, Number(value)])
  );
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
    millisecond: date.getUTCMilliseconds()
  };
}

function toWallTime(parts) {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour || 0,
    parts.minute || 0,
    parts.second || 0,
    parts.millisecond || 0
  );
}

function shiftCalendarDate(parts, days) {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate()
  };
}

function getTimeZoneOffset(timestamp, formatter) {
  const second = Math.floor(timestamp / 1000) * 1000;
  return toWallTime(getZonedParts(new Date(second), formatter)) - second;
}

function sameWallTime(left, right) {
  return left.year === right.year
    && left.month === right.month
    && left.day === right.day
    && left.hour === right.hour
    && left.minute === right.minute
    && left.second === right.second
    && left.millisecond === right.millisecond;
}

function localDateTimeToUtc(parts, formatter) {
  const desiredWallTime = toWallTime(parts);
  const offsets = new Set();
  for (const hours of [-36, -24, -12, 0, 12, 24, 36]) {
    offsets.add(getTimeZoneOffset(desiredWallTime + hours * HOUR_MS, formatter));
  }

  const candidates = [...offsets].map((offset) => {
    const timestamp = desiredWallTime - offset;
    return {
      date: new Date(timestamp),
      wallTime: toWallTime(getZonedParts(new Date(timestamp), formatter))
    };
  });
  const exact = candidates
    .filter(({ date }) => sameWallTime(getZonedParts(date, formatter), parts))
    .sort((left, right) => left.date - right.date);
  if (exact.length) return exact[0].date;

  const afterGap = candidates
    .filter(({ wallTime }) => wallTime > desiredWallTime)
    .sort((left, right) => left.wallTime - right.wallTime || left.date - right.date);
  if (afterGap.length) return afterGap[0].date;

  throw new RangeError('Could not resolve the reporting time in the selected time zone.');
}

export function isSupportedReportingSelection(period, timeZone) {
  return Object.hasOwn(REPORTING_PERIOD_DAYS, period)
    && SUPPORTED_REPORTING_TIME_ZONES.includes(timeZone);
}

export function getDashboardReportingWindows(period, timeZone, now = new Date()) {
  if (!isSupportedReportingSelection(period, timeZone)) {
    throw new RangeError('Unsupported reporting period or time zone.');
  }
  const asOf = new Date(now);
  if (Number.isNaN(asOf.getTime())) throw new TypeError('Reporting time must be a valid date.');

  const formatter = createDateTimeFormatter(timeZone);
  const localNow = getZonedParts(asOf, formatter);
  const days = REPORTING_PERIOD_DAYS[period];
  const currentStartDate = shiftCalendarDate(localNow, -(days - 1));
  const previousStartDate = shiftCalendarDate(currentStartDate, -days);
  const previousEndDate = shiftCalendarDate(currentStartDate, -1);
  const current = {
    start: localDateTimeToUtc({ ...currentStartDate, hour: 0, minute: 0, second: 0, millisecond: 0 }, formatter),
    end: asOf
  };
  const previous = {
    start: localDateTimeToUtc({ ...previousStartDate, hour: 0, minute: 0, second: 0, millisecond: 0 }, formatter),
    end: localDateTimeToUtc({
      ...previousEndDate,
      hour: localNow.hour,
      minute: localNow.minute,
      second: localNow.second,
      millisecond: localNow.millisecond
    }, formatter)
  };

  return { period, timeZone, asOf, current, previous };
}

export function compareMetricValues(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) {
    throw new TypeError('Metric values must be finite numbers.');
  }
  if (previous === 0) {
    if (current > 0) return { changePercent: null, direction: 'positive', label: 'New' };
    return { changePercent: 0, direction: 'neutral', label: '0%' };
  }

  const changePercent = ((current - previous) / previous) * 100;
  const direction = changePercent > 0 ? 'positive' : changePercent < 0 ? 'negative' : 'neutral';
  const label = direction === 'positive'
    ? `+${changePercent.toFixed(1)}%`
    : direction === 'negative' ? `${changePercent.toFixed(1)}%` : '0%';
  return { changePercent, direction, label };
}
