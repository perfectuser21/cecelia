/**
 * settings-muted-api.test.js
 *
 * 测试 /api/brain/settings/muted GET + PATCH 的底层逻辑（muted-guard 函数）
 * + 静态检查 routes/settings.js 有 /muted 路由定义。
 *
 * 不起 express（避免 supertest 依赖），通过检查 router 定义 + 调 muted-guard 函数验证行为。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const originalEnv = { ...process.env };

describe('/api/brain/settings/muted', () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.BRAIN_MUTED;
  });

  it('routes/settings.js 含 GET /muted 定义', () => {
    const src = readFileSync(resolve(__dirname, '../routes/settings.js'), 'utf8');
    expect(src).toMatch(/router\.get\(['"]\/muted['"]/);
    expect(src).toContain('getMutedStatus()');
  });

  it('routes/settings.js 含 PATCH /muted 定义 + boolean 校验', () => {
    const src = readFileSync(resolve(__dirname, '../routes/settings.js'), 'utf8');
    expect(src).toMatch(/router\.patch\(['"]\/muted['"]/);
    expect(src).toContain('setMuted(pool');
    // boolean 校验
    expect(src).toMatch(/typeof enabled !== ['"]boolean['"]/);
    expect(src).toMatch(/status\(400\)/);
  });

  it('muted-guard.setMuted + getMutedStatus 联动行为', async () => {
    vi.resetModules();
    const g = await import('../muted-guard.js');
    g._resetCacheForTest();
    let stored = { enabled: false, last_toggled_at: null };
    const mockPool = {
      query: async (sql, params) => {
        if (sql.includes('SELECT')) return { rows: [{ value_json: stored }] };
        if (sql.includes('INSERT') || sql.includes('UPDATE')) {
          stored = JSON.parse(params[1]);
          return { rows: [] };
        }
        return { rows: [] };
      },
    };
    await g.initMutedGuard(mockPool);

    // 初始状态
    expect(g.getMutedStatus().enabled).toBe(false);

    // PATCH equivalent: setMuted(true)
    await g.setMuted(mockPool, true);
    const after = g.getMutedStatus();
    expect(after.enabled).toBe(true);
    expect(after.last_toggled_at).toBeTruthy();
    expect(after.env_override).toBe(false);

    // 切回 false
    await g.setMuted(mockPool, false);
    expect(g.getMutedStatus().enabled).toBe(false);
  });
});
