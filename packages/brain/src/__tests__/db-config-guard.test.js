/**
 * db-config NODE_ENV=test guard 四场景覆盖。
 * 防止本地跑 integration test 污染 cecelia 生产 DB。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('db-config test-mode guard', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    // dotenv 默认不覆盖已存在的 env，这里清干净避免 repo 根 .env 污染
    delete process.env.NODE_ENV;
    delete process.env.VITEST;
    delete process.env.DB_NAME;
    delete process.env.DB_HOST;
    delete process.env.DB_PORT;
    delete process.env.DB_USER;
    delete process.env.DB_PASSWORD;
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.resetModules();
  });

  it('NODE_ENV=test + DB_NAME 未设 → 自动用 cecelia_test', async () => {
    process.env.NODE_ENV = 'test';
    const { DB_DEFAULTS } = await import('../db-config.js');
    expect(DB_DEFAULTS.database).toBe('cecelia_test');
  });

  it('NODE_ENV=test + DB_NAME=cecelia → throw（显式拒绝连生产）', async () => {
    process.env.NODE_ENV = 'test';
    process.env.DB_NAME = 'cecelia';
    await expect(import('../db-config.js')).rejects.toThrow(
      /NODE_ENV=test 禁止连 cecelia 生产 DB/
    );
  });

  it('NODE_ENV=test + DB_NAME=cecelia_test → database 用 cecelia_test（不抛）', async () => {
    process.env.NODE_ENV = 'test';
    process.env.DB_NAME = 'cecelia_test';
    const { DB_DEFAULTS } = await import('../db-config.js');
    expect(DB_DEFAULTS.database).toBe('cecelia_test');
  });

  it('非 test（production）+ DB_NAME=cecelia → 正常放行', async () => {
    process.env.NODE_ENV = 'production';
    process.env.DB_NAME = 'cecelia';
    const { DB_DEFAULTS } = await import('../db-config.js');
    expect(DB_DEFAULTS.database).toBe('cecelia');
  });

  it('VITEST=true（无 NODE_ENV）也触发 guard — 防止 vitest 直接跑时漏掉', async () => {
    process.env.VITEST = 'true';
    process.env.DB_NAME = 'cecelia';
    await expect(import('../db-config.js')).rejects.toThrow(
      /NODE_ENV=test 禁止连 cecelia 生产 DB/
    );
  });
});
