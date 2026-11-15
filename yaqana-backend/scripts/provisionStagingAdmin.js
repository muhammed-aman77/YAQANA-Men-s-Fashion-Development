import mongoose from 'mongoose';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import User from '../src/models/User.js';
import { mongoSeedHosts } from '../src/utils/dummyCatalogSeed.js';
import { verifyPassword } from '../src/utils/password.js';
import { provisionExistingAdmin, validateStagingTarget } from '../src/utils/stagingAdminProvisioning.js';

const LOCAL_URI = 'mongodb://127.0.0.1:27017/yaqana_local_dev_20261115';
const STAGING_DATABASE = 'yaqana_staging';

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

function confirmedArgument(prefix) {
  const matches = process.argv.filter((argument) => argument.startsWith(prefix));
  if (matches.length !== 1) throw new Error(`Provide exactly one ${prefix}<value> argument.`);
  return matches[0].slice(prefix.length);
}

function parseAtlasTarget(uri, expectedHost, confirmation) {
  let parsed;
  try {
    parsed = new URL(uri);
  } catch {
    throw new Error('The supplied Atlas connection string is invalid.');
  }
  const databaseName = parsed.pathname.replace(/^\/+/, '').split('/')[0];
  const target = {
    protocol: parsed.protocol,
    host: parsed.hostname,
    expectedHost,
    databaseName,
    confirmation
  };
  validateStagingTarget(target);
  return target;
}

function safeErrorMessage(error) {
  return String(error?.message || 'Unknown error')
    .replace(/mongodb(?:\+srv)?:\/\/[^\s"'`]+/gi, '[redacted MongoDB URI]')
    .replace(/(?:passwordHash|password)=\S+/gi, '[redacted credential]');
}

async function main() {
  const expectedHost = String(process.env.ATLAS_STAGING_EXPECTED_HOST || '').trim().toLowerCase();
  if (!expectedHost || expectedHost.includes('/') || expectedHost.includes('@')) {
    throw new Error('Set ATLAS_STAGING_EXPECTED_HOST to the exact approved Atlas staging cluster hostname.');
  }
  const confirmedHost = confirmedArgument('--confirm-staging-host=').trim().toLowerCase();
  const confirmation = confirmedArgument('--confirm-staging-database=');
  if (confirmation !== STAGING_DATABASE || confirmedHost !== expectedHost) {
    throw new Error('The explicit Atlas staging host and database confirmations do not match.');
  }

  const rl = createInterface({ input: stdin, output: stdout });
  const email = (await rl.question('Existing local administrator email: ')).trim().toLowerCase();
  rl.close();
  const password = await hiddenInput('Existing local administrator password: ');
  const stagingUri = await hiddenInput('Atlas staging MongoDB URI (input hidden): ');
  const target = parseAtlasTarget(stagingUri, expectedHost, confirmation);

  let localConnection;
  let stagingConnection;
  try {
    localConnection = await mongoose.createConnection(LOCAL_URI, {
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: 1
    }).asPromise();
    const localHosts = mongoSeedHosts(localConnection.getClient());
    if (localConnection.name !== 'yaqana_local_dev_20261115' ||
        localHosts.length !== 1 ||
        localHosts[0] !== '127.0.0.1:27017') {
      throw new Error('The source connection is not the fixed loopback local development database.');
    }

    const LocalUser = localConnection.model('User', User.schema);
    const localAdmin = await LocalUser.findOne({ email }).select('+passwordHash');
    if (!localAdmin || localAdmin.role !== 'admin' || localAdmin.status !== 'active') {
      throw new Error('The requested local account is not an existing active administrator.');
    }
    if (!await verifyPassword(password, localAdmin.passwordHash)) {
      throw new Error('The existing local administrator password is incorrect. No account was provisioned.');
    }

    stagingConnection = await mongoose.createConnection(stagingUri, {
      serverSelectionTimeoutMS: 10000,
      maxPoolSize: 1
    }).asPromise();
    const connectedHosts = mongoSeedHosts(stagingConnection.getClient()).map((host) => host.toLowerCase());
    if (stagingConnection.name !== STAGING_DATABASE ||
        connectedHosts.length === 0 ||
        connectedHosts.some((host) => !host.startsWith(`${expectedHost}:`) && host !== expectedHost)) {
      throw new Error('The connected Atlas target does not match the confirmed staging host and database.');
    }

    const StagingUser = stagingConnection.model('User', User.schema);
    const provisioned = await provisionExistingAdmin({
      LocalUser,
      StagingUser,
      email,
      password,
      target: {
        protocol: 'mongodb+srv:',
        host: expectedHost,
        expectedHost,
        databaseName: stagingConnection.name,
        confirmation
      }
    });
    console.log(`Provisioned the existing administrator in Atlas database ${STAGING_DATABASE} on the confirmed staging host.`);
    console.log(`Account email: ${provisioned.email}. Existing sessions were not copied.`);
    console.log('The original password hash was copied without changing the password; no credentials or hashes were printed.');
  } finally {
    if (stagingConnection) await stagingConnection.close();
    if (localConnection) await localConnection.close();
  }
}

main().catch((error) => {
  console.error(`Staging admin provisioning failed: ${safeErrorMessage(error)}`);
  process.exitCode = 1;
});
