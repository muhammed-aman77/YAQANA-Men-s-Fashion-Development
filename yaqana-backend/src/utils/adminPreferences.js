import { isSupportedReportingSelection } from './dashboardReporting.js';
import { httpError } from './http.js';

export function setAdminReportingTimeZone(user, timeZone) {
  if (!['admin', 'owner'].includes(user.role)) {
    throw httpError(403, 'Only administrators can update reporting preferences.', 'ADMIN_REQUIRED');
  }
  if (!isSupportedReportingSelection('today', timeZone)) {
    throw httpError(400, 'Unsupported reporting time zone.');
  }

  if (!user.adminPreferences) user.adminPreferences = {};
  user.adminPreferences.reportingTimeZone = timeZone;
  return user;
}
