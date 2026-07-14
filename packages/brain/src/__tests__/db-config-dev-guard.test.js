/**
 * db-config-dev-guard.test.js
 * 验证 NODE_ENV=development 时：
 * - DB_NAME=cecelia_dev 正常
 * - DB_NAME=cecelia 显式 throw（禁止 dev 误连生产库）
 * - production / 未设 NODE_ENV 不受影响
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('db-config NODE_ENV=development guard', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('场景 1: NODE_ENV=development + DB_NAME=cecelia_dev → OK', async () => {
    vi.stubEnv('VITEST', '');
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('DB_NAME', 'cecelia_dev');
    const mod = await import('../db-config.js');
    expect(mod.DB_DEFAULTS.database).toBe('cecelia_dev');
  });

  it('场景 2: NODE_ENV=development + DB_NAME=cecelia → throw（禁止dev误连生产库）', async () => {
    vi.stubEnv('VITEST', '');
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('DB_NAME', 'cecelia');
    await expect(import('../db-config.js')).rejects.toThrow(/dev 环境/);
  });

  it('场景 3: NODE_ENV=production + DB_NAME=cecelia → OK（生产不受影响）', async () => {
    vi.stubEnv('VITEST', '');
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DB_NAME', 'cecelia');
    const mod = await import('../db-config.js');
    expect(mod.DB_DEFAULTS.database).toBe('cecelia');
  });

  it('场景 4: 未设 NODE_ENV + DB_NAME=cecelia → OK（默认行为不受影响）', async () => {
    vi.stubEnv('VITEST', '');
    vi.stubEnv('NODE_ENV', '');
    vi.stubEnv('DB_NAME', 'cecelia');
    const mod = await import('../db-config.js');
    expect(mod.DB_DEFAULTS.database).toBe('cecelia');
  });
});
