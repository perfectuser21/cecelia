/**
 * db.test.js — smoke tests for db.js exports
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('dotenv/config', () => ({}));
vi.mock('pg', () => {
  const Pool = vi.fn(() => ({
    totalCount: 2,
    idleCount: 1,
    waitingCount: 0,
    query: vi.fn(),
    end: vi.fn(),
  }));
  return { default: { Pool } };
});
vi.mock('../db-config.js', () => ({
  DB_DEFAULTS: { host: 'localhost', port: 5432, database: 'test', user: 'test', max: 5, idleTimeoutMillis: 10000, connectionTimeoutMillis: 5000 },
}));

const { pool, getPoolHealth, default: defaultExport } = await import('../db.js');

describe('db.js', () => {
  it('exports pool as named export', () => {
    expect(pool).toBeDefined();
    expect(typeof pool.query).toBe('function');
  });

  it('default export equals named pool export', () => {
    expect(defaultExport).toBe(pool);
  });

  it('getPoolHealth returns correct shape', () => {
    const health = getPoolHealth();
    expect(health).toHaveProperty('total');
    expect(health).toHaveProperty('idle');
    expect(health).toHaveProperty('waiting');
    expect(health).toHaveProperty('activeCount');
    expect(health.activeCount).toBe(health.total - health.idle);
  });
});
