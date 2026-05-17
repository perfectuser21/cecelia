/**
 * db-config-guard.test.js
 * 验证 NODE_ENV=test 时：
 * - 自动 cecelia_test fallback
 * - DB_NAME=cecelia 显式 throw
 * - 生产环境不受影响
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('db-config NODE_ENV=test guard', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('场景 1: NODE_ENV=test + VITEST="" + DB_NAME="" → database=cecelia_test', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('VITEST', '');
    vi.stubEnv('DB_NAME', '');
    const mod = await import('../db-config.js');
    expect(mod.DB_DEFAULTS.database).toBe('cecelia_test');
  });

  it('场景 2: NODE_ENV=test + DB_NAME=cecelia → throw', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DB_NAME', 'cecelia');
    await expect(import('../db-config.js')).rejects.toThrow(/生产 DB/);
  });

  it('场景 3: NODE_ENV=test + DB_NAME=cecelia_test → OK', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DB_NAME', 'cecelia_test');
    const mod = await import('../db-config.js');
    expect(mod.DB_DEFAULTS.database).toBe('cecelia_test');
  });

  it('场景 4: NODE_ENV=production + VITEST="" + DB_NAME=cecelia → OK（生产不受影响）', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITEST', '');
    vi.stubEnv('DB_NAME', 'cecelia');
    const mod = await import('../db-config.js');
    expect(mod.DB_DEFAULTS.database).toBe('cecelia');
  });
});
