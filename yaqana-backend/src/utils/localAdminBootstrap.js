const LOCAL_DATABASE = 'yaqana_local_dev_20261115';
const LOCAL_HOST = '127.0.0.1:27017';

export function validateLocalAdminTarget({ nodeEnvironment, databaseName, hosts, confirmation }) {
  if (nodeEnvironment !== 'development') {
    throw new Error('Local admin creation requires NODE_ENV=development.');
  }
  if (databaseName !== LOCAL_DATABASE) {
    throw new Error(`Local admin creation requires database "${LOCAL_DATABASE}".`);
  }
  if (confirmation !== LOCAL_DATABASE) {
    throw new Error(`Pass --confirm-local-database=${LOCAL_DATABASE} to continue.`);
  }
  if (!Array.isArray(hosts) || hosts.length !== 1 || hosts[0] !== LOCAL_HOST) {
    throw new Error(`Local admin creation requires the exact MongoDB host "${LOCAL_HOST}".`);
  }
}

export async function createLocalAdmin({ User, target, admin }) {
  validateLocalAdminTarget(target);
  const name = String(admin?.name || '').trim();
  const email = String(admin?.email || '').trim().toLowerCase();
  if (name.length < 2 || name.length > 100) throw new Error('Admin name must be between 2 and 100 characters.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error('A valid admin email is required.');
  if (typeof admin?.passwordHash !== 'string' || !admin.passwordHash) throw new Error('A hashed admin password is required.');
  if (await User.findOne({ email })) throw new Error(`An account for "${email}" already exists. No account was changed.`);
  return User.create({
    name,
    email,
    passwordHash: admin.passwordHash,
    role: 'admin',
    status: 'active'
  });
}
