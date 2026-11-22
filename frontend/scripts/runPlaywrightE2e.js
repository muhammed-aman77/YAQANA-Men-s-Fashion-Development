import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number.parseInt(process.env.PLAYWRIGHT_PORT || '4173', 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PLAYWRIGHT_PORT must be a valid TCP port.');
}

const vitePath = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const playwrightPath = path.join(projectRoot, 'node_modules', '@playwright', 'test', 'cli.js');
const vite = spawn(process.execPath, [
  vitePath,
  '--configLoader', 'runner',
  '--host', '127.0.0.1',
  '--port', String(port),
  '--strictPort'
], {
  cwd: projectRoot,
  env: { ...process.env, VITE_AUTH_MODE: 'bearer' },
  stdio: 'inherit',
  windowsHide: true
});

const waitForChildExit = (child) => new Promise((resolve) => {
  if (child.exitCode !== null || child.signalCode !== null) {
    resolve({ code: child.exitCode, signal: child.signalCode });
    return;
  }
  child.once('exit', (code, signal) => resolve({ code, signal }));
});

const waitForServer = async () => {
  const url = `http://127.0.0.1:${port}/`;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (vite.exitCode !== null || vite.signalCode !== null) {
      throw new Error(`The Playwright Vite server exited before becoming available (code ${vite.exitCode ?? 'none'}).`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {
      // The server is still starting or the requested port is unavailable.
    }
    await delay(150);
  }
  throw new Error(`The Playwright Vite server did not become available at ${url}.`);
};

let testExitCode = 1;
try {
  await waitForServer();
  const runner = spawn(process.execPath, [playwrightPath, 'test', ...process.argv.slice(2)], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PLAYWRIGHT_PORT: String(port),
      PLAYWRIGHT_REUSE_SERVER: 'true'
    },
    stdio: 'inherit',
    windowsHide: true
  });
  const result = await waitForChildExit(runner);
  testExitCode = result.code ?? 1;
} catch (error) {
  process.stderr.write(`${error.message}\n`);
} finally {
  if (vite.exitCode === null && vite.signalCode === null) {
    vite.kill('SIGTERM');
    const stopped = await Promise.race([
      waitForChildExit(vite).then(() => true),
      delay(3000).then(() => false)
    ]);
    if (!stopped && process.platform === 'win32' && vite.pid) {
      spawnSync('taskkill', ['/PID', String(vite.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      await Promise.race([waitForChildExit(vite), delay(3000)]);
    }
  }
}

process.exitCode = testExitCode;
