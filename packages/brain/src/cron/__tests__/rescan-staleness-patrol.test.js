/**
 * rescan-staleness-patrol.js — 地图照相层 rescan 停滞哨兵（P0 9dfd873a 案）
 * 全程注入假 pool + 假 raise：绝不碰真库/真飞书。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  runRescanStalenessPatrol,
  RESCAN_STALE_KEY,
  RESCAN_STALE_SECONDS,
  REQUIRED_KINDS,
  __resetRescanStalenessGateForTest,
} from '../rescan-staleness-patrol.js';
// 渲染函数(renderRescanStalenessLine/Section)与 readRescanStalenessState 的测试
// 见 ../../lib/__tests__/rescan-staleness-report.test.js（lint-test-pairing 要求配对文件同目录）

/** 假 fact_snapshot_headers + working_memory pool */
function fakePool({ headerRows = [] } = {}) {
  const workingMemory = new Map();
  return {
    workingMemory,
    query: vi.fn(async (sql, params = []) => {
      if (/FROM fact_snapshot_headers/i.test(sql)) {
        return { rows: headerRows.filter((r) => r.repo === (params[0] ?? 'cecelia')) };
      }
      if (/INSERT INTO working_memory/i.test(sql)) {
        workingMemory.set(params[0], JSON.parse(params[1]));
        return { rows: [] };
      }
      if (/FROM working_memory/i.test(sql)) {
        return workingMemory.has(params[0])
          ? { rows: [{ value_json: workingMemory.get(params[0]) }] }
          : { rows: [] };
      }
      return { rows: [] };
    }),
  };
}

const NOW = new Date('2026-09-25T12:00:00Z').getTime();
const freshHeaders = (repo = 'cecelia') => REQUIRED_KINDS.map((kind) => ({
  repo, kind, scanned_at: new Date(NOW - 60_000).toISOString(), // 1min 前
}));
const staleHeaders = (repo = 'cecelia') => REQUIRED_KINDS.map((kind) => ({
  repo, kind, scanned_at: new Date(NOW - (RESCAN_STALE_SECONDS + 60) * 1000).toISOString(), // 超预算1min
}));

beforeEach(() => {
  __resetRescanStalenessGateForTest();
});

describe('runRescanStalenessPatrol — 停滞判定与 P1 告警', () => {
  it('四类快照均新鲜 → 不停滞，不告警', async () => {
    const pool = fakePool({ headerRows: freshHeaders() });
    const raiseFn = vi.fn().mockResolvedValue(undefined);
    const r = await runRescanStalenessPatrol(pool, { now: () => NOW, raiseFn });

    expect(r).toMatchObject({ checked: true, stale: false, missing_kinds: [] });
    expect(raiseFn).not.toHaveBeenCalled();
    expect(pool.workingMemory.get(RESCAN_STALE_KEY)).toMatchObject({ stale: false, repo: 'cecelia' });
  });

  it('最旧快照超过 30min 账龄预算 → 停滞，raise P1 一次', async () => {
    const pool = fakePool({ headerRows: staleHeaders() });
    const raiseFn = vi.fn().mockResolvedValue(undefined);
    const r = await runRescanStalenessPatrol(pool, { now: () => NOW, raiseFn });

    expect(r.stale).toBe(true);
    expect(r.age_minutes).toBeGreaterThan(30);
    expect(raiseFn).toHaveBeenCalledTimes(1);
    expect(raiseFn).toHaveBeenCalledWith('P1', 'rescan_stale', expect.stringContaining('停滞超 30 分钟'));
  });

  it('缺失快照类型（扫描链从未成功跑过某类型）→ 即使不算账龄也判停滞', async () => {
    const onlyTwoKinds = freshHeaders().slice(0, 2);
    const pool = fakePool({ headerRows: onlyTwoKinds });
    const raiseFn = vi.fn().mockResolvedValue(undefined);
    const r = await runRescanStalenessPatrol(pool, { now: () => NOW, raiseFn });

    expect(r.stale).toBe(true);
    expect(r.missing_kinds.sort()).toEqual(['graph', 'test'].sort());
    expect(raiseFn).toHaveBeenCalledWith('P1', 'rescan_stale', expect.stringContaining('缺失快照类型'));
  });

  it('全空表（扫描链从未跑过）→ 停滞且 missing_kinds 为全部四类', async () => {
    const pool = fakePool({ headerRows: [] });
    const raiseFn = vi.fn().mockResolvedValue(undefined);
    const r = await runRescanStalenessPatrol(pool, { now: () => NOW, raiseFn });

    expect(r.stale).toBe(true);
    expect(r.missing_kinds.sort()).toEqual([...REQUIRED_KINDS].sort());
  });

  it('自 gate：窗口内第二次调用跳过，不重复查询/告警', async () => {
    const pool = fakePool({ headerRows: staleHeaders() });
    const raiseFn = vi.fn().mockResolvedValue(undefined);
    await runRescanStalenessPatrol(pool, { now: () => NOW, raiseFn, gateMs: 5 * 60 * 1000 });
    const r2 = await runRescanStalenessPatrol(pool, { now: () => NOW + 1000, raiseFn, gateMs: 5 * 60 * 1000 });

    expect(r2).toEqual({ skipped: true, reason: 'interval_gate' });
    expect(raiseFn).toHaveBeenCalledTimes(1);
  });

  it('raise() 抛错不掀翻 patrol（best-effort，返回值仍正常）', async () => {
    const pool = fakePool({ headerRows: staleHeaders() });
    const raiseFn = vi.fn().mockRejectedValue(new Error('feishu down'));
    const r = await runRescanStalenessPatrol(pool, { now: () => NOW, raiseFn });

    expect(r.stale).toBe(true);
  });
});
