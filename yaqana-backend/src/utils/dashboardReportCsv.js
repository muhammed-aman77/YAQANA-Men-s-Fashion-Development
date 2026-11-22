const FORMULA_PREFIX = /^[\u0000-\u0020]*[=+\-@]/u;

function csvCell(value) {
  if (value == null) return '""';
  const text = typeof value === 'string' && FORMULA_PREFIX.test(value) ? `'${value}` : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export function buildDashboardReportCsv(report) {
  const rows = [['Section', 'Metric', 'Current', 'Previous', 'Change']];
  rows.push(['Metadata', 'Period', report.period || '', '', '']);
  rows.push(['Metadata', 'Time zone', report.timeZone || '', '', '']);
  rows.push(['Metadata', 'Updated through', report.asOf ? new Date(report.asOf).toISOString() : '', '', '']);
  rows.push(['Metadata', 'Current period start', report.windows?.current?.start ? new Date(report.windows.current.start).toISOString() : '', '', '']);
  rows.push(['Metadata', 'Current period end', report.windows?.current?.end ? new Date(report.windows.current.end).toISOString() : '', '', '']);
  rows.push(['Metadata', 'Previous period start', report.windows?.previous?.start ? new Date(report.windows.previous.start).toISOString() : '', '', '']);
  rows.push(['Metadata', 'Previous period end', report.windows?.previous?.end ? new Date(report.windows.previous.end).toISOString() : '', '', '']);
  for (const [key, label] of [
    ['orders', 'Orders'],
    ['revenue', 'Revenue'],
    ['unitsSold', 'Units sold'],
    ['averageOrderValue', 'Average order value'],
    ['newCustomers', 'New customers']
  ]) {
    rows.push(['Performance', label, report.current?.[key] ?? 0, report.previous?.[key] ?? 0, report.comparisons?.[key]?.label ?? 'No change']);
  }
  for (const row of report.orderStatusBreakdown || []) rows.push(['Order status', row.status, row.count, '', '']);
  for (const row of report.paymentStatusBreakdown || []) rows.push(['Payment status', row.status, row.count, '', '']);
  for (const row of report.bestSellers || []) rows.push(['Best sellers', row.name, row.unitsSold, '', 'Paid units sold']);
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
