import { verifyPassword as verifyExistingPassword } from './password.js';

const STAGING_DATABASE = 'yaqana_staging';

export function validateStagingTarget({
  protocol,
  host,
  expectedHost,
  databaseName,
  confirmation
}) {
  if (protocol !== 'mongodb+srv:') {
    throw new Error('Staging administrator provisioning requires the approved Atlas mongodb+srv connection.');
  }
  if (!expectedHost ||
      host !== expectedHost ||
      !/^[a-z0-9.-]+\.mongodb\.net$/i.test(host)) {
    throw new Error('Atlas host does not match the explicitly approved staging host.');
  }
  if (databaseName !== STAGING_DATABASE) {
    throw new Error(`Staging administrator provisioning requires database "${STAGING_DATABASE}".`);
  }
  if (confirmation !== STAGING_DATABASE) {
    throw new Error(`Pass --confirm-staging-database=${STAGING_DATABASE} to continue.`);
  }
}

export async function provisionExistingAdmin({
  LocalUser,
  StagingUser,
  email,
  password,
  target,
  verifyPassword = verifyExistingPassword
}) {
  validateStagingTarget(target);
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 254) {
    throw new Error('A valid existing administrator email is required.');
  }
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('The existing administrator password is required for verification.');
  }

  if (await StagingUser.findOne({ email: normalizedEmail })) {
    throw new Error(`An account for "${normalizedEmail}" already exists in staging. No account was changed.`);
  }

  const sourceAdmin = await LocalUser.findOne({ email: normalizedEmail }).select('+passwordHash');
  if (!sourceAdmin || sourceAdmin.role !== 'admin' || sourceAdmin.status !== 'active') {
    throw new Error('The local source must be the existing active administrator account.');
  }
  if (!await verifyPassword(password, sourceAdmin.passwordHash)) {
    throw new Error('The existing password is incorrect for the local administrator. No account was provisioned.');
  }

  return StagingUser.create({
    name: sourceAdmin.name,
    email: sourceAdmin.email,
    passwordHash: sourceAdmin.passwordHash,
    phone: sourceAdmin.phone || '',
    role: 'admin',
    status: 'active',
    emailVerifiedAt: sourceAdmin.emailVerifiedAt || null
  });
}
