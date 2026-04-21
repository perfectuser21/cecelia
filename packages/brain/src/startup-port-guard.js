/**
 * Startup Port Guard
 *
 * Guards Brain startup against launchd-restart races:
 * 1) If the old process hasn't released the port yet, wait (polling every 2s) instead of
 *    killing with -9 — graceful ownership transfer.
 * 2) Server.listen() wrapped with retry on EADDRINUSE (up to 3 attempts, 2s apart).
 *
 * Motivation: Brain self-crashed ~8h uptime (unknown root cause),
 * launchd auto-restarted, but new process hit `EADDRINUSE 5221` because the OLD
 * process was still in TCP_TIME_WAIT / not yet fully released.
 * Result: FATAL loop throttled by launchd ThrottleInterval=10s.
 *
 * Strategy now: wait for port free (up to maxWaitMs) BEFORE listen(),
 * and on listen() error EADDRINUSE, retry N times before giving up.
 *
 * Pure module, no side effects on import — testable.
 */

import net from 'net';

/**
 * Probe whether `port` is currently in use on the loopback interface.
 * Uses a throwaway TCP server bind attempt — fastest reliable check on macOS/Linux.
 *
 * @param {number} port
 * @returns {Promise<boolean>} true if in use
 */
export function isPortInUse(port) {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once('error', (err) => {
      if (err && err.code === 'EADDRINUSE') {
        resolve(true);
      } else {
        // Other errors (EACCES, etc) — treat as "cannot bind", i.e. effectively in use.
        resolve(true);
      }
    });
    tester.once('listening', () => {
      tester.close(() => resolve(false));
    });
    try {
      tester.listen(port);
    } catch {
      resolve(true);
    }
  });
}

/**
 * Wait until `port` is free, polling every `pollMs`, up to `maxWaitMs`.
 * Returns normally once port is free; throws if deadline exceeded.
 *
 * @param {number} port
 * @param {object} [opts]
 * @param {number} [opts.maxWaitMs=30000]
 * @param {number} [opts.pollMs=2000]
 * @param {(msg:string)=>void} [opts.log]
 * @returns {Promise<void>}
 */
export async function waitForPortFree(port, opts = {}) {
  const maxWaitMs = opts.maxWaitMs ?? 30000;
  const pollMs = opts.pollMs ?? 2000;
  const log = opts.log ?? ((msg) => console.warn(msg));
  const start = Date.now();
  let attempts = 0;
  while (Date.now() - start < maxWaitMs) {
    attempts += 1;
    const inUse = await isPortInUse(port);
    if (!inUse) {
      if (attempts > 1) {
        log(`[startup] port ${port} now free after ${attempts} checks`);
      }
      return;
    }
    log(`[startup] port ${port} still in use, retry in ${pollMs}ms (attempt ${attempts})`);
    await sleep(pollMs);
  }
  throw new Error(`port ${port} not free after ${maxWaitMs}ms`);
}

/**
 * Call `server.listen(port)` with EADDRINUSE retry.
 * Resolves once listening; rejects after maxAttempts fail.
 *
 * @param {import('http').Server} server
 * @param {number} port
 * @param {object} [opts]
 * @param {number} [opts.maxAttempts=3]
 * @param {number} [opts.retryDelayMs=2000]
 * @param {(msg:string)=>void} [opts.log]
 * @returns {Promise<void>}
 */
export async function listenWithRetry(server, port, opts = {}) {
  const maxAttempts = opts.maxAttempts ?? 3;
  const retryDelayMs = opts.retryDelayMs ?? 2000;
  const log = opts.log ?? ((msg) => console.warn(msg));

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await listenOnce(server, port);
      return;
    } catch (err) {
      if (err && err.code === 'EADDRINUSE' && attempt < maxAttempts) {
        log(`[startup] listen(${port}) EADDRINUSE (attempt ${attempt}/${maxAttempts}), retry in ${retryDelayMs}ms`);
        await sleep(retryDelayMs);
        continue;
      }
      throw err;
    }
  }
}

function listenOnce(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
