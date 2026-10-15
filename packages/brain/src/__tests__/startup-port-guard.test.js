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

// 让OS分配当前可用端口，不猜测CI并行进程的端口占用。
async function freePort() {
  const reservation = await occupyPort(0);
  const port = reservation.address().port;
  await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  return port;
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
    vi.restoreAllMocks();
    while (cleanup.length) {
      const srv = cleanup.pop();
      await new Promise((r) => srv.close(r));
    }
  });

  describe('isPortInUse', () => {
    it('returns false for a free port', async () => {
      // 原随机选择器恰好挑中一个真实占用端口，必须仍能取得独立空闲端口。
      const blocker = await occupyPort(0);
      cleanup.push(blocker);
      vi.spyOn(Math, 'random').mockReturnValue((blocker.address().port - 40000 + 0.25) / 20000);
      const port = await freePort();
      await expect(isPortInUse(port)).resolves.toBe(false);
    });

    it('returns true for an occupied port', async () => {
      const srv = await occupyPort(0);
      const port = srv.address().port;
      cleanup.push(srv);
      await expect(isPortInUse(port)).resolves.toBe(true);
    });
  });

  describe('waitForPortFree', () => {
    it('resolves immediately when port is free', async () => {
      const port = await freePort();
      const t0 = Date.now();
      await waitForPortFree(port, { maxWaitMs: 5000, pollMs: 100, log: () => {} });
      expect(Date.now() - t0).toBeLessThan(500);
    });

    it('retries while port is occupied and resolves once freed', async () => {
      const srv = await occupyPort(0);
      const port = srv.address().port;
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
      const srv = await occupyPort(0);
      const port = srv.address().port;
      cleanup.push(srv);

      await expect(
        waitForPortFree(port, { maxWaitMs: 400, pollMs: 100, log: () => {} })
      ).rejects.toThrow(/not free after/);
    });
  });

  describe('listenWithRetry', () => {
    it('succeeds on a free port (first attempt)', async () => {
      const port = await freePort();
      const server = createServer();
      cleanup.push(server);

      await listenWithRetry(server, port, { maxAttempts: 3, retryDelayMs: 50, log: () => {} });
      expect(server.listening).toBe(true);
    });

    it('retries on EADDRINUSE and eventually succeeds when port is freed', async () => {
      const blocker = await occupyPort(0);
      const port = blocker.address().port;

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
      const blocker = await occupyPort(0);
      const port = blocker.address().port;
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
