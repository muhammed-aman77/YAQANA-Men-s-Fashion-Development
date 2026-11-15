import mongoose from 'mongoose';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import User from '../src/models/User.js';
import { hashPassword } from '../src/utils/password.js';
import { mongoSeedHosts } from '../src/utils/dummyCatalogSeed.js';
import { createLocalAdmin, validateLocalAdminTarget } from '../src/utils/localAdminBootstrap.js';

const LOCAL_DATABASE = 'yaqana_local_dev_20261115';
const LOCAL_MONGODB_URI = `mongodb://127.0.0.1:27017/${LOCAL_DATABASE}`;
const confirmations = process.argv.filter((argument) => argument.startsWith('--confirm-local-database='));
const confirmation = confirmations.length === 1
  ? confirmations[0].slice('--confirm-local-database='.length)
  : undefined;

function hiddenInput(prompt) {
  return new Promise((resolve, reject) => {
    if (!stdin.isTTY || !stdout.isTTY) {
      reject(new Error('Run this script directly in a terminal.'));
      return;
    }

    stdout.write(prompt);
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();

    function cleanup() {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
    }

    function onData(data) {
      const key = data.toString();
      if (key === '\u0003') {
        cleanup();
        reject(new Error('Cancelled.'));
      } else if (key === '\r' || key === '\n') {
        cleanup();
        stdout.write('\n');
        resolve(value);
      } else if (key === '\u007f' || key === '\b') {
        value = value.slice(0, -1);
      } else if (key >= ' ') {
        value += key;
      }
    }

    stdin.on('data', onData);
  });
}

async function main() {
  let connected = false;
  const nodeEnvironment = process.env.NODE_ENV || 'development';

  if (confirmations.length !== 1) {
    throw new Error(`Pass --confirm-local-database=${LOCAL_DATABASE} exactly once.`);
  }
  if (process.env.MONGODB_URI && process.env.MONGODB_URI !== LOCAL_MONGODB_URI) {
    throw new Error('MONGODB_URI must be unset or exactly match the dedicated local development URI.');
  }
  validateLocalAdminTarget({
    nodeEnvironment,
    databaseName: LOCAL_DATABASE,
    hosts: ['127.0.0.1:27017'],
    confirmation
  });

  try {
    const rl = createInterface({ input: stdin, output: stdout });
    const email = (await rl.question('New local admin email: ')).trim().toLowerCase();
    const name = (await rl.question('Admin name: ')).trim();
    rl.close();
    const password = await hiddenInput('Password (minimum 12 characters): ');
    const confirmPassword = await hiddenInput('Confirm password: ');
    if (password.length < 12) throw new Error('Password must be at least 12 characters.');
    if (password !== confirmPassword) throw new Error('Passwords do not match.');

    await mongoose.connect(LOCAL_MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    connected = true;
    const target = {
      nodeEnvironment,
      databaseName: mongoose.connection.name,
      hosts: mongoSeedHosts(mongoose.connection.getClient()),
      confirmation
    };
    validateLocalAdminTarget(target);
    const user = await createLocalAdmin({
      User,
      target,
      admin: { name, email, passwordHash: await hashPassword(password) }
    });
    console.log(`Created local administrator ${user.email} in ${target.databaseName}.`);
    console.log('The password was not written to a file or printed.');
  } finally {
    if (connected) await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error(`Local administrator creation failed: ${error.message}`);
  process.exitCode = 1;
});
