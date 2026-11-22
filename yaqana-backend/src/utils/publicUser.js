const DEFAULT_ADMIN_REPORTING_TIME_ZONE = 'Asia/Kolkata';

export function toPublicUser(user) {
  const result = {
    _id: String(user._id),
    id: String(user._id),
    name: user.name,
    email: user.email,
    phone: user.phone || '',
    role: user.role,
    status: user.status,
    createdAt: user.createdAt
  };
  if (['admin', 'owner'].includes(user.role)) {
    result.reportingTimeZone = user.adminPreferences?.reportingTimeZone || DEFAULT_ADMIN_REPORTING_TIME_ZONE;
  }
  return result;
}
