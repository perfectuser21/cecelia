/**
 * Tests for db-config.js — Single Source of Truth for DB defaults
 */

import { describe, it, expect } from 'vitest';

describe('db-config', () => {
  it('exports correct defaults matching .env.docker', async () => {
    const { DB_DEFAULTS } = await import('../db-config.js');

    expect(DB_DEFAULTS).toBeDefined();
    expect(DB_DEFAULTS.host).toBe(process.env.DB_HOST || 'localhost');
    expect(DB_DEFAULTS.port).toBe(parseInt(process.env.DB_PORT || '5432', 10));
    const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
    const expectedDb = process.env.DB_NAME || (isTest ? 'cecelia_test' : 'cecelia');
    expect(DB_DEFAULTS.database).toBe(expectedDb);
    expect(DB_DEFAULTS.user).toBe(process.env.DB_USER || 'cecelia');
    expect(DB_DEFAULTS.password).toBe(process.env.DB_PASSWORD || '');
  });

  it('has no n8n legacy values', async () => {
    const { DB_DEFAULTS } = await import('../db-config.js');

    expect(DB_DEFAULTS.database).not.toBe('cecelia_tasks');
    expect(DB_DEFAULTS.user).not.toBe('n8n_user');
    expect(DB_DEFAULTS.password).not.toBe('n8n_password_2025');
  });

  it('port is a number', async () => {
    const { DB_DEFAULTS } = await import('../db-config.js');

    expect(typeof DB_DEFAULTS.port).toBe('number');
    expect(DB_DEFAULTS.port).toBeGreaterThan(0);
  });

  it('query_timeout 默认 10 分钟：整轮唯一无界的 await 是 pg 查询（09-24 gtd 循环卡死案）', async () => {
    const { DB_DEFAULTS } = await import('../db-config.js');
    expect(DB_DEFAULTS.query_timeout).toBe(parseInt(process.env.DB_QUERY_TIMEOUT_MS || '600000', 10));
    expect(typeof DB_DEFAULTS.query_timeout).toBe('number');
    expect(DB_DEFAULTS.query_timeout).toBeGreaterThan(0);
  });
});
