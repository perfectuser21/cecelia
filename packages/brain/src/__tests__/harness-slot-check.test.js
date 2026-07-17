import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock 只打在系统边界：DB、quota-guard 的 usage API 缓存、账号 cap 状态注入、vitals 缓存注入
vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../quota-guard.js', () => ({ checkQuotaGuard: vi.fn() }));
vi.mock('../account-usage.js', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, getAvailableAccountCount: vi.fn(() => 2) };
});

import pool from '../db.js';
import { checkQuotaGuard } from '../quota-guard.js';
import { getAvailableAccountCount } from '../account-usage.js';
import { _setVitalsCacheForTest, _resetVitalsCacheForTest } from '../machine-vitals.js';
import { harnessSlotCheck, PER_ACCOUNT_CONCURRENCY, HARNESS_HARD_CAP } from '../slot-allocator.js';

function vitals(over = {}) {
  return {
    sampled_at: Date.now(), error: null,
    relay_containers: [], relay_count: 0,
    vm_total_mb: 13600, vm_used_mb: 5400,   // 余量 8200MB → mem_cap=8
    host_disk_pct: 50, docker_disk_pct: 50,
    ...over,
  };
}

beforeEach(() => {
  _resetVitalsCacheForTest();
  pool.query.mockReset().mockResolvedValue({ rows: [{ n: 0 }] });   // inflight=0 默认
  checkQuotaGuard.mockReset().mockResolvedValue({ allow: true, priorityFilter: null, reason: 'ok', bestPct: 10 });
  getAvailableAccountCount.mockReturnValue(2);
});

describe('harnessSlotCheck 动态 cap（beeba317 主线）', () => {
  it('【主线A 收权】活容器 2 + 体征好 + 额度足 → 放行（任务数无关）', async () => {
    _setVitalsCacheForTest(vitals({ relay_count: 2, relay_containers: ['cecelia-relay-a-1', 'cecelia-relay-b-2'] }));
    const r = await harnessSlotCheck({ candidate: { priority: 'P1' } });
    expect(r.allow).toBe(true);
    expect(r.cap.effective).toBe(4);   // min(mem=8, acct=2*2=4, hard=8)
  });

  it('【主线B 函数化】活容器 4 + acct_cap=4 → 拒；账号加到 3（acct_cap=6）→ 放行——有内存+有账号则不被常数卡', async () => {
    _setVitalsCacheForTest(vitals({ relay_count: 4 }));
    const r1 = await harnessSlotCheck({ candidate: { priority: 'P1' } });
    expect(r1.allow).toBe(false);
    expect(r1.reason).toBe('cap_reached');
    getAvailableAccountCount.mockReturnValue(3);   // 加账号=池里加一行
    const r2 = await harnessSlotCheck({ candidate: { priority: 'P1' } });
    expect(r2.allow).toBe(true);
    expect(r2.cap.effective).toBe(6);
  });

  it('内存余量只够 1 档（1.5G）→ mem_cap=1，活容器 1 → 拒', async () => {
    _setVitalsCacheForTest(vitals({ vm_total_mb: 6900, vm_used_mb: 5400, relay_count: 1 }));
    const r = await harnessSlotCheck({ candidate: { priority: 'P1' } });
    expect(r.allow).toBe(false);
    expect(r.cap.mem_cap).toBe(1);
  });

  it('探针放行逃生阀：mem_cap<=0 且零容器 且 inflight=0 → 放行（effective 地板=1）', async () => {
    _setVitalsCacheForTest(vitals({ vm_total_mb: 5000, vm_used_mb: 5400, relay_count: 0, relay_containers: [] }));  // mem_cap<=0
    const r = await harnessSlotCheck({ candidate: { priority: 'P1' } });
    expect(r.allow).toBe(true);
    expect(r.cap.effective).toBe(1);
  });

  it('mem_cap<=0 且已有 1 个容器 → 拒 no_memory_headroom（锁死 reason）', async () => {
    _setVitalsCacheForTest(vitals({ vm_total_mb: 5000, vm_used_mb: 5400, relay_count: 1, relay_containers: ['cecelia-relay-a-1'] }));
    const r = await harnessSlotCheck({ candidate: { priority: 'P1' } });
    expect(r.allow).toBe(false);
    expect(r.reason).toBe('no_memory_headroom');
  });

  it('盘 >85% → 拒 disk_pressure', async () => {
    _setVitalsCacheForTest(vitals({ host_disk_pct: 91 }));
    const r = await harnessSlotCheck({ candidate: { priority: 'P1' } });
    expect(r.allow).toBe(false);
    expect(r.reason).toBe('disk_pressure');
  });

  it('vitals error → 保守拒', async () => {
    _setVitalsCacheForTest(vitals({ error: 'docker daemon down' }));
    const r = await harnessSlotCheck({ candidate: { priority: 'P1' } });
    expect(r.allow).toBe(false);
    expect(r.reason).toBe('vitals_error');
  });

  it('vitals stale（超180s）→ 保守拒', async () => {
    _setVitalsCacheForTest(vitals({ sampled_at: Date.now() - 200_000 }));
    const r = await harnessSlotCheck({ candidate: { priority: 'P1' } });
    expect(r.allow).toBe(false);
    expect(r.reason).toBe('vitals_stale');
  });

  it('quota >98%（allow=false）→ 拒 quota_critical', async () => {
    _setVitalsCacheForTest(vitals());
    checkQuotaGuard.mockResolvedValue({ allow: false, priorityFilter: null, reason: 'critical', bestPct: 99 });
    const r = await harnessSlotCheck({ candidate: { priority: 'P0' } });
    expect(r.allow).toBe(false);
    expect(r.reason).toBe('quota_critical');
  });

  it('quota >90%：P2 拒 / P0 过', async () => {
    _setVitalsCacheForTest(vitals());
    checkQuotaGuard.mockResolvedValue({ allow: true, priorityFilter: ['P0', 'P1'], reason: 'low', bestPct: 93 });
    const rP2 = await harnessSlotCheck({ candidate: { priority: 'P2' } });
    expect(rP2.allow).toBe(false);
    expect(rP2.reason).toBe('quota_low_priority');
    const rP0 = await harnessSlotCheck({ candidate: { priority: 'P0' } });
    expect(rP0.allow).toBe(true);
  });

  it('inflight 超发窗口：活容器 1 + 宽限期内无容器新派发 1 → 拟占用 2，cap=2 时拒', async () => {
    _setVitalsCacheForTest(vitals({ relay_count: 1, relay_containers: ['cecelia-relay-a-1'], vm_total_mb: 7900, vm_used_mb: 5400 })); // mem_cap=2
    pool.query.mockResolvedValue({ rows: [{ n: 1 }] });   // inflight=1
    const r = await harnessSlotCheck({ candidate: { priority: 'P1' } });
    expect(r.allow).toBe(false);
    expect(r.inflight).toBe(1);
    expect(r.reason).toBe('cap_reached');
  });

  it('inflight 查询抛错 → 保守拒', async () => {
    _setVitalsCacheForTest(vitals());
    pool.query.mockRejectedValue(new Error('db down'));
    const r = await harnessSlotCheck({ candidate: { priority: 'P1' } });
    expect(r.allow).toBe(false);
    expect(r.reason).toBe('inflight_query_error');
  });

  it('memory_pressure(halt) → 拒（brain_rss 注入走 vitals 缓存外的 evaluateMemoryHealth 现算，用超大 RSS 模拟不可行——改由 harnessSlotCheck 接受注入的 memHealth 覆盖参数验证）', async () => {
    _setVitalsCacheForTest(vitals());
    const r = await harnessSlotCheck({ candidate: { priority: 'P1' }, _memHealthOverride: { action: 'halt', reason: 'brain rss leak' } });
    expect(r.allow).toBe(false);
    expect(r.reason).toBe('memory_pressure');
  });
});
