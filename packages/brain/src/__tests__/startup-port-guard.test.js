/**
 * Tests for startup-port-guard.
 *
 * Covers:
 *   - isPortInUse returns true/false correctly using real TCP bind (loopback)
 *   - waitForPortFree resolves fast when port is free
 *   - waitForPortFree retries while occupied, resolves when freed
 *   - waitForPortFree throws after maxWaitMs
 *   - listenWithRetry succeeds on clean port
 *   - listenWithRetry retries on EADDRINUSE and eventually succeeds
 *   - listenWithRetry gives up after maxAttempts and rethrows EADDRINUSE
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import net from 'net';
import { createServer } from 'http';
import { isPortInUse, waitForPortFree, listenWithRetry } from '../startup-port-guard.js';

// Use high, random ports to avoid conflicting with running Brain on 5221
function randomPort() {
  return 40000 + Math.floor(Math.random() * 20000);
}

function occupyPort(port) {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(port, () => resolve(srv));
  });
}

describe('startup-port-guard', () => {
  const cleanup = [];

  afterEach(async () => {
    while (cleanup.length) {
      const srv = cleanup.pop();
      await new Promise((r) => srv.close(r));
    }
  });

  describe('isPortInUse', () => {
    it('returns false for a free port', async () => {
      const port = randomPort();
      await expect(isPortInUse(port)).resolves.toBe(false);
    });

    it('returns true for an occupied port', async () => {
      const port = randomPort();
      const srv = await occupyPort(port);
      cleanup.push(srv);
      await expect(isPortInUse(port)).resolves.toBe(true);
    });
  });

  describe('waitForPortFree', () => {
    it('resolves immediately when port is free', async () => {
      const port = randomPort();
      const t0 = Date.now();
      await waitForPortFree(port, { maxWaitMs: 5000, pollMs: 100, log: () => {} });
      expect(Date.now() - t0).toBeLessThan(500);
    });

    it('retries while port is occupied and resolves once freed', async () => {
      const port = randomPort();
      const srv = await occupyPort(port);
      const logs = [];

      // Free the port after ~250ms
      setTimeout(() => srv.close(), 250);

      await waitForPortFree(port, {
        maxWaitMs: 3000,
        pollMs: 100,
        log: (m) => logs.push(m),
      });

      // Must have retried at least once before resolving
      const retryLogs = logs.filter((m) => m.includes('still in use'));
      expect(retryLogs.length).toBeGreaterThanOrEqual(1);
    });

    it('throws if port stays occupied past maxWaitMs', async () => {
      const port = randomPort();
      const srv = await occupyPort(port);
      cleanup.push(srv);

      await expect(
        waitForPortFree(port, { maxWaitMs: 400, pollMs: 100, log: () => {} })
      ).rejects.toThrow(/not free after/);
    });
  });

  describe('listenWithRetry', () => {
    it('succeeds on a free port (first attempt)', async () => {
      const port = randomPort();
      const server = createServer();
      cleanup.push(server);

      await listenWithRetry(server, port, { maxAttempts: 3, retryDelayMs: 50, log: () => {} });
      expect(server.listening).toBe(true);
    });

    it('retries on EADDRINUSE and eventually succeeds when port is freed', async () => {
      const port = randomPort();
      const blocker = await occupyPort(port);

      // Free the port after ~200ms
      setTimeout(() => blocker.close(), 200);

      const server = createServer();
      cleanup.push(server);
      const logs = [];

      await listenWithRetry(server, port, {
        maxAttempts: 5,
        retryDelayMs: 100,
        log: (m) => logs.push(m),
      });
      expect(server.listening).toBe(true);
      expect(logs.some((m) => m.includes('EADDRINUSE'))).toBe(true);
    });

    it('rethrows EADDRINUSE after exhausting maxAttempts', async () => {
      const port = randomPort();
      const blocker = await occupyPort(port);
      cleanup.push(blocker);

      const server = createServer();
      // Server won't be listening on failure — still track to close if unexpectedly bound.
      cleanup.push(server);

      await expect(
        listenWithRetry(server, port, { maxAttempts: 2, retryDelayMs: 50, log: () => {} })
      ).rejects.toMatchObject({ code: 'EADDRINUSE' });
      expect(server.listening).toBe(false);
    });
  });
});
