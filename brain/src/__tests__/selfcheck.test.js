/**
 * Self-Check Unit Tests (mock pool — no real DB needed)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runSelfCheck, EXPECTED_SCHEMA_VERSION } from '../selfcheck.js';

function makeMockPool(overrides = {}) {
  const defaults = {
    'SELECT 1': { rows: [{ ok: 1 }] },
    'brain_config_region': { rows: [{ value: 'us' }] },
    'information_schema': { rows: [
      { table_name: 'tasks' },
      { table_name: 'goals' },
      { table_name: 'projects' },
      { table_name: 'working_memory' },
      { table_name: 'cecelia_events' },
      { table_name: 'decision_log' },
      { table_name: 'daily_logs' },
      { table_name: 'cortex_analyses' },
    ]},
    'schema_version': { rows: [{ max_ver: EXPECTED_SCHEMA_VERSION }] },
    'config_fingerprint': { rows: [] }, // first run
    'INSERT': { rows: [] },
  };

  const merged = { ...defaults, ...overrides };

  return {
    query: vi.fn(async (sql, params) => {
      if (sql.includes('SELECT 1')) return merged['SELECT 1'];
      if (sql.includes('brain_config') && sql.includes('region') && !sql.includes('fingerprint') && !sql.includes('INSERT'))
        return merged['brain_config_region'];
      if (sql.includes('information_schema')) return merged['information_schema'];
      if (sql.includes('MAX(version)')) return merged['schema_version'];
      if (sql.includes('config_fingerprint') && sql.includes('SELECT'))
        return merged['config_fingerprint'];
      if (sql.includes('INSERT') || sql.includes('UPDATE'))
        return merged['INSERT'];
      return { rows: [] };
    }),
  };
}

describe('selfcheck', () => {
  beforeEach(() => {
    vi.stubEnv('ENV_REGION', 'us');
    vi.stubEnv('DB_HOST', 'localhost');
    vi.stubEnv('DB_PORT', '5432');
    vi.stubEnv('DB_NAME', 'cecelia');
  });

  it('should pass all checks with correct config', async () => {
    const pool = makeMockPool();
    const ok = await runSelfCheck(pool, { envRegion: 'us' });
    expect(ok).toBe(true);
  });

  it('should fail when ENV_REGION is missing', async () => {
    vi.stubEnv('ENV_REGION', '');
    const pool = makeMockPool();
    const ok = await runSelfCheck(pool, { envRegion: '' });
    expect(ok).toBe(false);
  });

  it('should fail when ENV_REGION is invalid', async () => {
    const pool = makeMockPool();
    const ok = await runSelfCheck(pool, { envRegion: 'eu' });
    expect(ok).toBe(false);
  });

  it('should fail when DB connection fails', async () => {
    const pool = makeMockPool({
      'SELECT 1': 'THROW',
    });
    pool.query = vi.fn(async (sql) => {
      if (sql.includes('SELECT 1')) throw new Error('connection refused');
      return { rows: [] };
    });

    const ok = await runSelfCheck(pool, { envRegion: 'us' });
    expect(ok).toBe(false);
  });

  it('should fail when DB region does not match ENV_REGION', async () => {
    const pool = makeMockPool({
      'brain_config_region': { rows: [{ value: 'hk' }] },
    });
    const ok = await runSelfCheck(pool, { envRegion: 'us' });
    expect(ok).toBe(false);
  });

  it('should fail when core tables are missing', async () => {
    const pool = makeMockPool({
      'information_schema': { rows: [
        { table_name: 'tasks' },
        { table_name: 'goals' },
        // missing the rest
      ]},
    });
    const ok = await runSelfCheck(pool, { envRegion: 'us' });
    expect(ok).toBe(false);
  });

  it('should fail when schema version is behind', async () => {
    const pool = makeMockPool({
      'schema_version': { rows: [{ max_ver: '003' }] },
    });
    const ok = await runSelfCheck(pool, { envRegion: 'us' });
    expect(ok).toBe(false);
  });

  it('should pass with fingerprint match', async () => {
    // Compute expected fingerprint
    const crypto = await import('crypto');
    const fp = crypto.createHash('sha256')
      .update('localhost:5432:cecelia:us')
      .digest('hex').slice(0, 16);

    const pool = makeMockPool({
      'config_fingerprint': { rows: [{ value: fp }] },
    });
    const ok = await runSelfCheck(pool, { envRegion: 'us' });
    expect(ok).toBe(true);
  });

  it('should pass (with warning) on fingerprint mismatch', async () => {
    const pool = makeMockPool({
      'config_fingerprint': { rows: [{ value: 'old_fingerprint' }] },
    });
    // Fingerprint mismatch is a warning, not a failure
    const ok = await runSelfCheck(pool, { envRegion: 'us' });
    expect(ok).toBe(true);
  });

  it('EXPECTED_SCHEMA_VERSION should be 042', () => {
    expect(EXPECTED_SCHEMA_VERSION).toBe('042');
  });
});
