/**
 * muted-guard.test.js
 * 测试 brain mute 双层开关（env + runtime）
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const originalEnv = { ...process.env };

async function loadGuard(envOverrides = {}) {
  delete process.env.BRAIN_MUTED;
  for (const [k, v] of Object.entries(envOverrides)) process.env[k] = v;
  vi.resetModules();
  return import('../muted-guard.js');
}

describe('muted-guard 双层开关', () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  it('场景 1: env unset + runtime false → isMuted=false', async () => {
    const g = await loadGuard();
    g._resetCacheForTest();
    const mockPool = { query: async () => ({ rows: [{ value_json: { enabled: false, last_toggled_at: null } }] }) };
    await g.initMutedGuard(mockPool);
    expect(g.isMuted()).toBe(false);
  });

  it('场景 2: env unset + runtime true → isMuted=true', async () => {
    const g = await loadGuard();
    g._resetCacheForTest();
    const mockPool = { query: async () => ({ rows: [{ value_json: { enabled: true, last_toggled_at: '2026-04-21T00:00:00Z' } }] }) };
    await g.initMutedGuard(mockPool);
    expect(g.isMuted()).toBe(true);
  });

  it('场景 3: env=true + runtime false → isMuted=true（env 覆盖）', async () => {
    const g = await loadGuard({ BRAIN_MUTED: 'true' });
    g._resetCacheForTest();
    const mockPool = { query: async () => ({ rows: [{ value_json: { enabled: false, last_toggled_at: null } }] }) };
    await g.initMutedGuard(mockPool);
    expect(g.isMuted()).toBe(true);
    expect(g.getMutedStatus().env_override).toBe(true);
  });

  it('场景 4: env=true + runtime true → isMuted=true', async () => {
    const g = await loadGuard({ BRAIN_MUTED: 'true' });
    g._resetCacheForTest();
    const mockPool = { query: async () => ({ rows: [{ value_json: { enabled: true, last_toggled_at: null } }] }) };
    await g.initMutedGuard(mockPool);
    expect(g.isMuted()).toBe(true);
  });

  it('setMuted(pool, true) 写 DB + 更新 cache', async () => {
    const g = await loadGuard();
    g._resetCacheForTest();
    const calls = [];
    const mockPool = {
      query: async (sql, params) => {
        calls.push({ sql, params });
        if (sql.includes('SELECT')) return { rows: [{ value_json: { enabled: false, last_toggled_at: null } }] };
        return { rows: [] };
      },
    };
    await g.initMutedGuard(mockPool);
    const result = await g.setMuted(mockPool, true);
    expect(result.enabled).toBe(true);
    expect(g.isMuted()).toBe(true);
    const upsert = calls.find(c => c.sql.includes('INSERT') || c.sql.includes('UPDATE'));
    expect(upsert).toBeTruthy();
  });

  it('getMutedStatus 返回 {enabled, last_toggled_at, env_override}', async () => {
    const g = await loadGuard();
    g._resetCacheForTest();
    const mockPool = { query: async () => ({ rows: [{ value_json: { enabled: false, last_toggled_at: null } }] }) };
    await g.initMutedGuard(mockPool);
    const s = g.getMutedStatus();
    expect(s).toHaveProperty('enabled');
    expect(s).toHaveProperty('last_toggled_at');
    expect(s).toHaveProperty('env_override');
    expect(s.env_override).toBe(false);
  });
});
