/**
 * seven-ring-audit.test.js — 七环对账核心逻辑单元测试（刀3-T6 回归守卫）
 *
 * 覆盖：runSevenRingAudit 七环逐项结果结构 + 棘轮判定逻辑
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// mock 文件系统（七环7读 CURRENT_STATE.md）
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => { throw new Error('no file'); }),
  };
});

import { runSevenRingAudit, loadRatchet, __resetSevenRingAuditForTest } from '../seven-ring-audit.js';

function makePool(overrides = {}) {
  const defaults = {
    // 环1: test-pyramid 快照存在且新鲜
    quality_test_pyramid: {
      value_json: { pass: true, permanent: { total: 1100 } },
      updated_at: new Date(Date.now() - 1 * 3600_000).toISOString(),
    },
    // 环2: 2 个 scheduler job 哨兵，均在 1min 内
    'scheduler_job_last_run:%': [
      { key: 'scheduler_job_last_run:arch-review', value_json: {}, updated_at: new Date(Date.now() - 30_000).toISOString() },
      { key: 'scheduler_job_last_run:ci-patrol', value_json: {}, updated_at: new Date(Date.now() - 30_000).toISOString() },
    ],
    // 环3: 最近 24h 有 postdeploy_verified 任务
    postdeploy_tasks: [{ id: 'abc', title: 'deploy v1', updated_at: new Date(Date.now() - 3600_000).toISOString() }],
    // 环4: 最近 24h 有 line_ledger
    line_ledger: [{ id: 'ld1', title: 'L1 账本', created_at: new Date(Date.now() - 3600_000).toISOString() }],
    // 环5: 最近 48h 有 ci_patrol 完成
    ci_patrol: [{ id: 'cp1', title: 'ci_patrol 日报', updated_at: { toISOString: () => new Date(Date.now() - 7200_000).toISOString() } }],
    // 环6: launchd-patrol 在 5min 内
    'scheduler_job_last_run:launchd-patrol': { key: 'scheduler_job_last_run:launchd-patrol', value_json: {}, updated_at: new Date(Date.now() - 30_000).toISOString() },
  };
  return { ...defaults, ...overrides };
}

function buildPool(data) {
  return {
    async query(sql, params) {
      // 环1: quality_test_pyramid
      if (sql.includes("key = 'quality_test_pyramid'") || (params && params[0] === 'quality_test_pyramid')) {
        const row = data.quality_test_pyramid;
        return { rows: row ? [row] : [] };
      }
      // 环2: scheduler_job_last_run 全部
      if (sql.includes("LIKE 'scheduler_job_last_run:%'")) {
        return { rows: data['scheduler_job_last_run:%'] ?? [] };
      }
      // 环3: postdeploy_verified tasks
      if (sql.includes('postdeploy_verified') && sql.includes("status = 'completed'")) {
        return { rows: data.postdeploy_tasks ?? [] };
      }
      // 环4: line_ledger
      if (sql.includes("type = 'line_ledger'")) {
        return { rows: data.line_ledger ?? [] };
      }
      // 环5: ci_patrol
      if (sql.includes("task_type = 'ci_patrol'") && sql.includes("status = 'completed'")) {
        return { rows: data.ci_patrol ?? [] };
      }
      // 环6: launchd-patrol + bark 查询
      if (sql.includes("scheduler_job_last_run:launchd-patrol")) {
        const row = data['scheduler_job_last_run:launchd-patrol'];
        return { rows: row ? [row] : [] };
      }
      // 环7: quality_test_pyramid（再查一次时间）
      if (sql.includes('quality_test_pyramid')) {
        const row = data.quality_test_pyramid;
        return { rows: row ? [row] : [] };
      }
      return { rows: [] };
    },
  };
}

describe('runSevenRingAudit', () => {
  beforeEach(() => {
    __resetSevenRingAuditForTest();
  });

  it('七环全过 → pass=true, hard_flaws=0', async () => {
    const pool = buildPool(makePool());
    const result = await runSevenRingAudit(pool);
    expect(result.rings).toHaveLength(7);
    expect(result.pass).toBe(true);
    expect(result.hard_flaws).toBe(0);
    expect(result.ratchet_breached).toBe(false);
    expect(result.audited_at).toBeTruthy();
  });

  it('每个环对象含 ring/label/ok/warn/hard_flaw/detail', async () => {
    const pool = buildPool(makePool());
    const result = await runSevenRingAudit(pool);
    for (const ring of result.rings) {
      expect(ring).toMatchObject({
        ring: expect.any(Number),
        label: expect.any(String),
        ok: expect.any(Boolean),
        warn: expect.any(Boolean),
        hard_flaw: expect.any(Boolean),
        detail: expect.any(String),
      });
    }
  });

  it('环1失败（无 test-pyramid 快照）→ hard_flaw=true, pass=false', async () => {
    const pool = buildPool(makePool({ quality_test_pyramid: null }));
    const result = await runSevenRingAudit(pool);
    expect(result.rings[0].ok).toBe(false);
    expect(result.rings[0].hard_flaw).toBe(true);
    expect(result.pass).toBe(false);
    expect(result.hard_flaws).toBeGreaterThan(0);
  });

  it('环2失败（无 scheduler 哨兵）→ hard_flaw=true', async () => {
    const pool = buildPool(makePool({ 'scheduler_job_last_run:%': [] }));
    const result = await runSevenRingAudit(pool);
    expect(result.rings[1].ok).toBe(false);
    expect(result.rings[1].hard_flaw).toBe(true);
  });

  it('环3无部署 → warn=true 但非 hard_flaw（无部署不算硬伤）', async () => {
    const pool = buildPool(makePool({ postdeploy_tasks: [] }));
    const result = await runSevenRingAudit(pool);
    expect(result.rings[2].ok).toBe(true);
    expect(result.rings[2].warn).toBe(true);
    expect(result.rings[2].hard_flaw).toBe(false);
  });

  it('环4失败（无 line_ledger）→ hard_flaw=true', async () => {
    const pool = buildPool(makePool({ line_ledger: [] }));
    const result = await runSevenRingAudit(pool);
    expect(result.rings[3].ok).toBe(false);
    expect(result.rings[3].hard_flaw).toBe(true);
  });

  it('环5失败（无 ci_patrol 消费）→ hard_flaw=true', async () => {
    const pool = buildPool(makePool({ ci_patrol: [] }));
    const result = await runSevenRingAudit(pool);
    expect(result.rings[4].ok).toBe(false);
    expect(result.rings[4].hard_flaw).toBe(true);
  });

  it('棘轮击穿：hard_flaws > ratchet_max → ratchet_breached=true', async () => {
    // 让多个环失败超过 ratchet max=3
    const pool = buildPool(makePool({
      quality_test_pyramid: null,          // 环1 失败
      'scheduler_job_last_run:%': [],      // 环2 失败
      line_ledger: [],                     // 环4 失败
      ci_patrol: [],                       // 环5 失败
      'scheduler_job_last_run:launchd-patrol': null, // 环6 失败
    }));
    const result = await runSevenRingAudit(pool);
    expect(result.hard_flaws).toBeGreaterThan(3);
    expect(result.ratchet_breached).toBe(true);
  });

  it('各环异常不抛出（pool 报错 → 环 ok=false）', async () => {
    const errPool = {
      async query() { throw new Error('DB 挂了'); },
    };
    await expect(runSevenRingAudit(errPool)).resolves.toMatchObject({
      rings: expect.arrayContaining([expect.objectContaining({ ok: false })]),
    });
  });
});

describe('loadRatchet', () => {
  it('读不到文件时返回宽松默认值', () => {
    const r = loadRatchet();
    expect(r.hard_flaw_max).toBeGreaterThanOrEqual(0);
  });
});
