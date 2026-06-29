/**
 * TDD Red-phase tests for review-env-manager.js
 * These tests MUST FAIL before implementation (Red → Green cycle).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import fs from 'fs';
import http from 'http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Mock DB pool
const mockPool = {
  query: vi.fn(),
};

// Dynamic import so vitest sees it as a module (not hoisted static import)
let allocateReviewEnv, releaseReviewEnv, cleanupHarnessReviewEnvs, findFreePort;

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();

  // The module will fail to import if it doesn't exist — that's the Red evidence
  const mod = await import('../../../packages/brain/src/review-env-manager.js');
  allocateReviewEnv = mod.allocateReviewEnv;
  releaseReviewEnv = mod.releaseReviewEnv;
  cleanupHarnessReviewEnvs = mod.cleanupHarnessReviewEnvs;
  findFreePort = mod.findFreePort;
});

describe('findFreePort [BEHAVIOR]', () => {
  it('returns a port in 5300-5399 when all ports are free', async () => {
    mockPool.query.mockResolvedValue({ rows: [] }); // no occupied ports
    const port = await findFreePort(mockPool);
    expect(port).toBeGreaterThanOrEqual(5300);
    expect(port).toBeLessThanOrEqual(5399);
  });

  it('returns null when all 100 ports are occupied (exhaustion)', async () => {
    // DB reports all 100 ports occupied
    const allPorts = Array.from({ length: 100 }, (_, i) => ({ port: 5300 + i }));
    mockPool.query.mockResolvedValue({ rows: allPorts });
    const port = await findFreePort(mockPool);
    expect(port).toBeNull();
  });

  it('skips ports already in DB and returns next available', async () => {
    // Ports 5300-5350 occupied
    const occupied = Array.from({ length: 51 }, (_, i) => ({ port: 5300 + i }));
    mockPool.query.mockResolvedValue({ rows: occupied });
    const port = await findFreePort(mockPool);
    expect(port).toBeGreaterThanOrEqual(5351);
    expect(port).toBeLessThanOrEqual(5399);
  });
});

describe('allocateReviewEnv [BEHAVIOR]', () => {
  let tmpDistDir;

  beforeEach(() => {
    // Create real temp dist dir for testing
    tmpDistDir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-env-test-'));
    fs.writeFileSync(path.join(tmpDistDir, 'index.html'), '<html><body>Test Dashboard</body></html>');
    mockPool.query.mockImplementation((sql) => {
      if (sql.includes('SELECT port FROM review_environments')) {
        return Promise.resolve({ rows: [] }); // no occupied ports
      }
      if (sql.includes('INSERT INTO review_environments')) {
        return Promise.resolve({ rows: [{ port: 5300, pid: 12345 }] });
      }
      return Promise.resolve({ rows: [] });
    });
  });

  afterEach(() => {
    // Cleanup temp dir
    fs.rmSync(tmpDistDir, { recursive: true, force: true });
  });

  it('returns { initiative_id, port, pid, skipped:false } when dist exists', async () => {
    const initiativeId = 'test-initiative-00000000-0000-0000-0000-000000000001';
    const result = await allocateReviewEnv(initiativeId, mockPool, { distDir: tmpDistDir });

    expect(result.initiative_id).toBe(initiativeId);
    expect(result.port).toBeGreaterThanOrEqual(5300);
    expect(result.port).toBeLessThanOrEqual(5399);
    expect(result.pid).toBeGreaterThan(0);
    expect(result.skipped).toBe(false);
  });

  it('returns { skipped:true, port:null, pid:null } when dist dir does not exist', async () => {
    const result = await allocateReviewEnv('test-id', mockPool, {
      distDir: '/nonexistent/path/that/does/not/exist',
    });
    expect(result.skipped).toBe(true);
    expect(result.port).toBeNull();
    expect(result.pid).toBeNull();
  });

  it('returns { skipped:true } when all ports are exhausted', async () => {
    // All ports occupied
    const allPorts = Array.from({ length: 100 }, (_, i) => ({ port: 5300 + i }));
    mockPool.query.mockImplementation((sql) => {
      if (sql.includes('SELECT port FROM review_environments')) {
        return Promise.resolve({ rows: allPorts });
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await allocateReviewEnv('test-id', mockPool, { distDir: tmpDistDir });
    expect(result.skipped).toBe(true);
    expect(result.port).toBeNull();
  });

  it('writes DB record with initiative_id, port, pid on successful allocation', async () => {
    const initiativeId = 'test-db-write-00000000';
    await allocateReviewEnv(initiativeId, mockPool, { distDir: tmpDistDir });

    const insertCall = mockPool.query.mock.calls.find(([sql]) =>
      sql.includes('INSERT INTO review_environments')
    );
    expect(insertCall).toBeTruthy();
    const [sql, params] = insertCall;
    // Should include initiative_id, port, pid in params
    expect(params).toContain(initiativeId);
  });

  it('handles duplicate allocation: releases old env and reallocates', async () => {
    let existingRecord = { initiative_id: 'existing', port: 5300, pid: 9999 };
    mockPool.query.mockImplementation((sql) => {
      if (sql.includes('SELECT') && sql.includes('review_environments') && sql.includes('initiative_id')) {
        return Promise.resolve({ rows: [existingRecord] });
      }
      if (sql.includes('DELETE') || sql.includes('INSERT')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await allocateReviewEnv('existing', mockPool, {
      distDir: tmpDistDir,
      _killPid: vi.fn(), // mock kill to avoid real process kill
    });

    // Should not throw, and should return valid result
    expect(result).toBeDefined();
  });
});

describe('releaseReviewEnv [BEHAVIOR]', () => {
  it('returns { released:true, initiative_id } when record exists', async () => {
    mockPool.query.mockImplementation((sql) => {
      if (sql.includes('SELECT')) {
        return Promise.resolve({ rows: [{ initiative_id: 'test-id', port: 5300, pid: 12345 }] });
      }
      if (sql.includes('DELETE')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const mockKill = vi.fn();
    const result = await releaseReviewEnv('test-id', mockPool, { _killPid: mockKill });

    expect(result.released).toBe(true);
    expect(result.initiative_id).toBe('test-id');
    expect(mockKill).toHaveBeenCalledWith(12345);
  });

  it('returns { released:true } even when record does not exist (idempotent)', async () => {
    mockPool.query.mockResolvedValue({ rows: [] }); // no record found

    const result = await releaseReviewEnv('nonexistent-id', mockPool);
    expect(result.released).toBe(true);
    expect(result.initiative_id).toBe('nonexistent-id');
  });

  it('does not throw when kill fails (process already dead)', async () => {
    mockPool.query.mockImplementation((sql) => {
      if (sql.includes('SELECT')) {
        return Promise.resolve({ rows: [{ initiative_id: 'test-id', port: 5300, pid: 99999 }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const mockKill = vi.fn().mockImplementation(() => { throw new Error('ESRCH: no such process'); });

    // Should not throw
    const result = await releaseReviewEnv('test-id', mockPool, { _killPid: mockKill });
    expect(result.released).toBe(true);
  });

  it('deletes DB record after kill', async () => {
    mockPool.query.mockImplementation((sql) => {
      if (sql.includes('SELECT')) {
        return Promise.resolve({ rows: [{ initiative_id: 'test-id', port: 5300, pid: 12345 }] });
      }
      return Promise.resolve({ rows: [] });
    });

    await releaseReviewEnv('test-id', mockPool, { _killPid: vi.fn() });

    const deleteCall = mockPool.query.mock.calls.find(([sql]) =>
      sql.includes('DELETE FROM review_environments')
    );
    expect(deleteCall).toBeTruthy();
  });
});

describe('cleanupHarnessReviewEnvs [BEHAVIOR]', () => {
  it('releases review envs for done/failed initiatives', async () => {
    const staleEnvs = [
      { initiative_id: 'done-init-1', port: 5300, pid: 1001 },
      { initiative_id: 'failed-init-2', port: 5301, pid: 1002 },
    ];

    mockPool.query.mockImplementation((sql) => {
      if (sql.includes('JOIN initiative_runs')) {
        return Promise.resolve({ rows: staleEnvs });
      }
      if (sql.includes('SELECT') && sql.includes('review_environments') && sql.includes('initiative_id')) {
        return Promise.resolve({ rows: [] }); // individual lookup returns empty
      }
      return Promise.resolve({ rows: [] });
    });

    const mockKill = vi.fn();
    const released = await cleanupHarnessReviewEnvs(mockPool, { _killPid: mockKill });

    // Should have attempted to kill both processes
    expect(mockKill).toHaveBeenCalledTimes(2);
    expect(released).toBe(2);
  });

  it('returns 0 when no stale envs found', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });
    const released = await cleanupHarnessReviewEnvs(mockPool);
    expect(released).toBe(0);
  });
});
