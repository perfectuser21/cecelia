/**
 * guard-drill.test.js — 月度守卫演习引擎单元测试（proven-to-fire 刀4-T4）
 *
 * 覆盖：
 *   1. monthly gate — 30天内跑过 → skipped
 *   2. 守卫叫了路径 — drillFn 返回 fired:true → KV 写 last_verified_at，不开 P1
 *   3. 守卫未叫路径 — drillFn 返回 fired:false → P1 Issue + Bark + raise P1
 *   4. drillTestPyramidGuard — 孤儿文件注入 → 守卫 exit 1（已验火）
 *   5. GUARD_REGISTRY — 6 个守卫，2 个 auto，4 个 manual-only
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock pool ──────────────────────────────────────────────────────────────
const _kvStore = {};
const { mockPool } = vi.hoisted(() => ({
  mockPool: {
    query: vi.fn(async (sql, params) => {
      if (/INSERT INTO working_memory/.test(sql)) {
        _kvStore[params[0]] = params[1];
        return { rows: [{ updated_at: new Date().toISOString() }] };
      }
      if (/SELECT value_json FROM working_memory/.test(sql)) {
        const key = params?.[0];
        const val = _kvStore[key];
        return { rows: val !== undefined ? [{ value_json: val }] : [] };
      }
      if (/INSERT INTO issues/.test(sql)) {
        return { rows: [] };
      }
      return { rows: [] };
    }),
  },
}));

vi.mock('../db.js', () => ({ default: mockPool }));

vi.mock('../alerting.js', () => ({ raise: vi.fn(async () => {}) }));
vi.mock('../notifier.js', () => ({ sendBark: vi.fn(async () => {}) }));

import { runGuardDrill, __resetGuardDrillForTest, GUARD_REGISTRY } from '../guard-drill.js';
import { raise as mockRaise } from '../alerting.js';
import { sendBark as mockSendBark } from '../notifier.js';

beforeEach(() => {
  __resetGuardDrillForTest();
  vi.clearAllMocks();
  for (const k of Object.keys(_kvStore)) delete _kvStore[k];
  // reset mock implementation after clearAllMocks
  mockPool.query.mockImplementation(async (sql, params) => {
    if (/INSERT INTO working_memory/.test(sql)) {
      _kvStore[params[0]] = params[1];
      return { rows: [{ updated_at: new Date().toISOString() }] };
    }
    if (/SELECT value_json FROM working_memory/.test(sql)) {
      const key = params?.[0];
      const val = _kvStore[key];
      return { rows: val !== undefined ? [{ value_json: val }] : [] };
    }
    if (/INSERT INTO issues/.test(sql)) {
      return { rows: [] };
    }
    return { rows: [] };
  });
});

// ── 1. monthly gate ────────────────────────────────────────────────────────

describe('monthly gate', () => {
  it('同一时间戳第二次调用 → { skipped: true }', async () => {
    const autoGuard = GUARD_REGISTRY.find((g) => g.auto);
    const originalFn = autoGuard.drillFn;
    autoGuard.drillFn = async () => ({ fired: true, detail: 'mock' });
    try {
      const now = Date.now();
      await runGuardDrill({ now });
      const result2 = await runGuardDrill({ now: now + 1000 });
      expect(result2).toEqual({ skipped: true });
    } finally {
      autoGuard.drillFn = originalFn;
    }
  });
});

// ── 2. 守卫叫了路径 ────────────────────────────────────────────────────────

describe('守卫叫了路径', () => {
  it('fired:true → KV 写 last_verified_at，不开 P1 Issue', async () => {
    const autoGuard = GUARD_REGISTRY.find((g) => g.auto);
    const originalFn = autoGuard.drillFn;
    autoGuard.drillFn = async () => ({ fired: true, detail: '孤儿注入 → exit 1 ✅' });

    try {
      const result = await runGuardDrill({ now: Date.now() });

      expect(result.ok).toBe(true);
      expect(result.fired).toBe(true);
      expect(result.verified_at).toBeTruthy();

      // guard-drill-status 已写
      expect(_kvStore['guard-drill-status']).toBeTruthy();

      // 不开 P1 Issue
      const issueCalls = mockPool.query.mock.calls.filter((c) => /INSERT INTO issues/.test(c[0]));
      expect(issueCalls).toHaveLength(0);
    } finally {
      autoGuard.drillFn = originalFn;
    }
  });
});

// ── 3. 守卫未叫路径 ────────────────────────────────────────────────────────

describe('守卫未叫路径', () => {
  it('fired:false → 开 P1 Issue + Bark + raise P1', async () => {
    const autoGuard = GUARD_REGISTRY.find((g) => g.auto);
    const originalFn = autoGuard.drillFn;
    autoGuard.drillFn = async () => ({ fired: false, detail: '演习：守卫未叫（假资产未接线）' });

    try {
      const result = await runGuardDrill({ now: Date.now() });

      expect(result.ok).toBe(true);
      expect(result.fired).toBe(false);
      expect(result.verified_at).toBeNull();

      // P1 Issue 开出
      const issueCalls = mockPool.query.mock.calls.filter((c) => /INSERT INTO issues/.test(c[0]));
      expect(issueCalls.length).toBeGreaterThan(0);
      expect(issueCalls[0][1][0]).toMatch(/守卫未叫/);
      expect(issueCalls[0][1][1]).toMatch(/月度演习.*未触发/);

      // Bark 推送（含 P1 字样的调用）
      const p1BarkCalls = mockSendBark.mock.calls.filter(
        (c) => String(c[0]).includes('P1') || String(c[1]).includes('未叫'),
      );
      expect(p1BarkCalls.length).toBeGreaterThan(0);

      // raise P1
      expect(mockRaise).toHaveBeenCalledWith(
        'P1',
        expect.stringMatching(/guard_drill_no_fire/),
        expect.any(String),
      );
    } finally {
      autoGuard.drillFn = originalFn;
    }
  });
});

// ── 4. drillTestPyramidGuard 集成演习 ─────────────────────────────────────

describe('drillTestPyramidGuard', () => {
  it('注入孤儿文件 → fired=true（守卫 exit 1）', async () => {
    const pyramidGuard = GUARD_REGISTRY.find((g) => g.id === 'test-pyramid-guard');
    expect(pyramidGuard).toBeDefined();

    const result = await pyramidGuard.drillFn();
    expect(result.fired).toBe(true);
    expect(result.detail).toMatch(/exit/);
  }, 15_000);
});

// ── 5. GUARD_REGISTRY 台账结构 ─────────────────────────────────────────────

describe('GUARD_REGISTRY', () => {
  it('共 6 个守卫：2 auto + 4 manual-only', () => {
    expect(GUARD_REGISTRY).toHaveLength(6);
    const auto = GUARD_REGISTRY.filter((g) => g.auto);
    const manual = GUARD_REGISTRY.filter((g) => !g.auto);
    expect(auto).toHaveLength(2);
    expect(manual).toHaveLength(4);
  });

  it('所有 auto 守卫有 drillFn', () => {
    for (const g of GUARD_REGISTRY.filter((g) => g.auto)) {
      expect(typeof g.drillFn).toBe('function');
    }
  });

  it('所有守卫有必要字段：id / name / file / boundary', () => {
    for (const g of GUARD_REGISTRY) {
      expect(g.id).toBeTruthy();
      expect(g.name).toBeTruthy();
      expect(g.file).toBeTruthy();
      expect(g.boundary).toBeTruthy();
    }
  });
});
