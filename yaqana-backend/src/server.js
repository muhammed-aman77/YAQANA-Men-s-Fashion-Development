import { app } from './app.js';
import { env } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { startAdminMfaReplacementCleanup } from './services/adminMfaReplacementCleanup.js';

let server;
let mfaReplacementCleanupTimer;

async function start() {
  await connectDatabase();
  mfaReplacementCleanupTimer = await startAdminMfaReplacementCleanup();
  const onListening = () => {
    console.log(`YAQANA API listening on port ${env.PORT} (${env.NODE_ENV})`);
  };
  server = env.HOST ? app.listen(env.PORT, env.HOST, onListening) : app.listen(env.PORT, onListening);
}

async function shutdown(signal) {
  console.log(`${signal} received; shutting down YAQANA API.`);
  if (mfaReplacementCleanupTimer) clearInterval(mfaReplacementCleanupTimer);
  if (server) await new Promise((resolve) => server.close(resolve));
  await disconnectDatabase();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

start().catch((error) => {
  console.error('YAQANA API failed to start:', error.message);
  process.exit(1);
});
