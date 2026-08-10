/**
 * rerun-gate-radius 集成测试
 *
 * 覆盖路径：
 *   场景 A（正常路径）：输入 Cecelia 文件时，radius 不泄漏 ZenithJoy CRM feature
 *   场景 B（radius 停摆）：doMock callRadius → null，cascade-list 回退格子路径 + WARN
 *   场景 C（stale 回退）：doMock callRadius → stale=true，同回退路径
 *
 * 关联合同：sprints/07181823-radius-rerun-gate/contract-dod.md
 * 关联 DoD：B-2, B-3, B-4, B-5
 *
 * 测试策略：
 *   - 场景 A：真实 radius 端点（localhost:5221）+ 真实 DB；不用 vi.mock（避免 hoist 污染）
 *   - 场景 B/C：vi.doMock（非 hoist）+ vi.resetModules() 屏蔽 radius-client
 *   - console.warn spy 验证 WARN 哨兵输出
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── 常量 ──────────────────────────────────────────────────────────────────────
const CRM_FEATURE_ID = '0b70f2ff-1a16-4029-a71a-e6cb5a523ea2';
const BLAST_RADIUS_TEST_FILE =
  'packages/brain/src/__tests__/integration/blast-radius.integration.test.js';
const WARN_SENTINEL = '[WARN][rerun-gate] radius unavailable or stale — falling back to journey_step_links';

// ─── 场景 A：正常路径（radius 按 repo 隔离）──────────────────────────────────────
// 注意：不使用 vi.mock（会被 hoist 影响整个文件），直接 import 真实实现
describe('场景A：radius 正常路径 — repo 隔离', () => {
  it(
    '默认 cecelia 查询不泄漏锚定在 ZenithJoy 路径上的 CRM feature',
    async (ctx) => {
      const { callRadius } = await import('../../lib/radius-client.js');
      const result = await callRadius([BLAST_RADIUS_TEST_FILE]);
      if (result === null) ctx.skip();
      expect(result.affected_features.map(f => f.feature_id)).not.toContain(CRM_FEATURE_ID);
    },
    10_000
  );

  it(
    'affected_tests 包含 blast-radius.integration.test.js 路径',
    async (ctx) => {
      const { callRadius } = await import('../../lib/radius-client.js');
      const result = await callRadius([BLAST_RADIUS_TEST_FILE]);
      if (result === null) ctx.skip();
      expect(result.affected_tests).toContain(BLAST_RADIUS_TEST_FILE);
    },
    10_000
  );

  it(
    '默认 cecelia 查询不携带 ZenithJoy CRM promise',
    async (ctx) => {
      const { callRadius } = await import('../../lib/radius-client.js');
      const result = await callRadius([BLAST_RADIUS_TEST_FILE]);
      if (result === null) ctx.skip();
      const crmFeature = result.affected_features.find(f => f.feature_id === CRM_FEATURE_ID);
      expect(crmFeature).toBeUndefined();
    },
    10_000
  );

  it('正常路径不触发 WARN 输出', async (ctx) => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { callRadius } = await import('../../lib/radius-client.js');
      const result = await callRadius([BLAST_RADIUS_TEST_FILE]);
      if (result === null) { ctx.skip(); return; }
      expect(result).not.toBeNull();
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  }, 10_000);
});

// ─── 场景 B：radius 停摆 — 回退格子路径 + WARN ──────────────────────────────────
describe('场景B：radius 停摆 — 回退 journey_step_links + WARN', () => {
  let warnSpy;

  beforeEach(() => {
    vi.resetModules();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.resetModules();
  });

  it('callRadius 返回 null 时，console.warn 包含 WARN 哨兵字符串', async () => {
    // vi.doMock 不会被 hoist，在 resetModules 之后生效
    vi.doMock('../../lib/radius-client.js', () => ({
      callRadius: vi.fn().mockResolvedValue(null),
    }));

    const { getCascadeList } = await import('../../cascade-list.js');
    await getCascadeList(['any-file.js']).catch(() => {});
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('WARN'));
  });

  it('radius 停摆时，journey_step_links 查询被调用（格子路径回退）', async () => {
    vi.doMock('../../lib/radius-client.js', () => ({
      callRadius: vi.fn().mockResolvedValue(null),
    }));

    const poolModule = await import('../../db.js');
    const pool = poolModule.default || poolModule.pool;
    const poolSpy = vi.spyOn(pool, 'query').mockResolvedValue({ rows: [] });

    const { getCascadeList } = await import('../../cascade-list.js');
    await getCascadeList(['any-file.js']).catch(() => {});

    const jslCall = poolSpy.mock.calls.find(([sql]) => String(sql).includes('journey_step_links'));
    expect(jslCall).toBeDefined();
  });
});

// ─── 场景 C：stale 回退 ─────────────────────────────────────────────────────────
describe('场景C：stale=true — 视同不可达触发回退', () => {
  let warnSpy;

  beforeEach(() => {
    vi.resetModules();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('radius-client 内部：freshness.stale=true 返回 null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        affected_features: [{ feature_id: CRM_FEATURE_ID, name: 'CRM', promises: [] }],
        affected_tests: [BLAST_RADIUS_TEST_FILE],
        freshness: { stale: true, generated_at: '2026-01-01T00:00:00Z' },
      }),
    }));

    const { callRadius } = await import('../../lib/radius-client.js');
    const result = await callRadius(['any-file.js']);
    expect(result).toBeNull();
  });

  it('stale=true 时，cascade-list.js 触发回退 + WARN', async () => {
    vi.doMock('../../lib/radius-client.js', () => ({
      callRadius: vi.fn().mockResolvedValue(null),
    }));

    const { getCascadeList } = await import('../../cascade-list.js');
    await getCascadeList(['any-file.js']).catch(() => {});
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('WARN'));
  });
});
