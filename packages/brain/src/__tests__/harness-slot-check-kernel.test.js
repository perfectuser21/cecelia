/**
 * harness-slot-check-kernel.test.js —— 产能账本认识 Kernel v1（刀2）
 *
 * 缺口：occupied = v.relay_count + inflight。
 *   - v.relay_count 来自 docker ps 前缀匹配 cecelia-relay- → Kernel 进程恒 0
 *   - inflight 只覆盖 INFLIGHT_GRACE_MS(5min) 宽限期
 * 于是 Kernel run 起来 5 分钟后从产能账本上彻底消失，闸门以为槽是空的会继续超发。
 *
 * 修法：kernel 在跑的 run 从 initiative_runs 数（心跳新鲜或刚落行），
 * 并把 kernel-v1 任务从 inflight 的 SQL 里排除，避免同一条 run 被数两遍。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
import { harnessSlotCheck } from '../slot-allocator.js';

function vitals(over = {}) {
  return {
    sampled_at: Date.now(), error: null,
    relay_containers: [], relay_count: 0,
    vm_total_mb: 13600, vm_used_mb: 5400,   // 余量 8200MB → mem_cap=8
    host_disk_pct: 50, docker_disk_pct: 50,
    ...over,
  };
}

/** inflight 查（FROM tasks）与 kernel 占用查（FROM initiative_runs）分开喂数 */
function routeCounts({ inflight = 0, kernelActive = 0, kernelThrows = false } = {}) {
  const seen = [];
  pool.query.mockImplementation(async (sql, params) => {
    const s = String(sql);
    seen.push({ sql: s, params });
    if (/FROM initiative_runs/.test(s)) {
      if (kernelThrows) throw new Error('db down');
      return { rows: [{ n: kernelActive }] };
    }
    return { rows: [{ n: inflight }] };
  });
  return seen;
}

beforeEach(() => {
  _resetVitalsCacheForTest();
  pool.query.mockReset();
  checkQuotaGuard.mockReset().mockResolvedValue({ allow: true, priorityFilter: null, reason: 'ok', bestPct: 10 });
  getAvailableAccountCount.mockReturnValue(2);
});

describe('kernel-v1 在跑的 run 计入产能账本', () => {
  it('零容器 + 零 inflight + 4 条 kernel run（cap=4）→ 拒 cap_reached', async () => {
    _setVitalsCacheForTest(vitals());
    routeCounts({ inflight: 0, kernelActive: 4 });
    const r = await harnessSlotCheck({ candidate: { priority: 'P1' } });
    expect(r.kernel_active).toBe(4);
    expect(r.allow).toBe(false);
    expect(r.reason).toBe('cap_reached');
  });

  it('修前病灶复现：零容器 + 零 inflight + 2 条 kernel run → 占用 2 而不是 0', async () => {
    _setVitalsCacheForTest(vitals());
    routeCounts({ inflight: 0, kernelActive: 2 });
    const r = await harnessSlotCheck({ candidate: { priority: 'P1' } });
    expect(r.kernel_active).toBe(2);
    expect(r.allow).toBe(true);      // cap=4，还剩 2 个槽
  });

  it('kernel 占用查 SQL：只数 v2 非终态 + kernel-v1 + 心跳新鲜/刚落行（不依赖 docker）', async () => {
    _setVitalsCacheForTest(vitals());
    const seen = routeCounts({ inflight: 0, kernelActive: 1 });
    await harnessSlotCheck({ candidate: { priority: 'P1' } });
    const q = seen.find((c) => /FROM initiative_runs/.test(c.sql));
    expect(q).toBeTruthy();
    expect(q.sql).toContain("orchestrator_version = 'v2'");
    expect(q.sql).toContain("phase NOT IN ('done','failed')");
    expect(q.sql).toContain('kernel-v1');
    expect(q.sql).toContain('orchestrator_heartbeat_at');
    expect(q.sql).not.toContain('cecelia-relay-');
  });

  it('inflight 查排除 kernel-v1，防同一条 run 被数两遍', async () => {
    _setVitalsCacheForTest(vitals());
    const seen = routeCounts({ inflight: 0, kernelActive: 0 });
    await harnessSlotCheck({ candidate: { priority: 'P1' } });
    const q = seen.find((c) => /FROM tasks/.test(c.sql));
    expect(q.sql).toContain('harness_runtime');
    expect(q.sql).toContain('kernel-v1');
  });

  it('kernel 占用查抛错 → 保守拒（与 inflight 查同规格）', async () => {
    _setVitalsCacheForTest(vitals());
    routeCounts({ inflight: 0, kernelThrows: true });
    const r = await harnessSlotCheck({ candidate: { priority: 'P1' } });
    expect(r.allow).toBe(false);
    expect(r.reason).toBe('kernel_active_query_error');
  });

  it('回归锁:纯旧 relay 场景（kernel_active=0）判定与改前一致', async () => {
    _setVitalsCacheForTest(vitals({ relay_count: 1, relay_containers: ['cecelia-relay-a-1'], vm_total_mb: 7900, vm_used_mb: 5400 })); // mem_cap=2
    routeCounts({ inflight: 1, kernelActive: 0 });
    const r = await harnessSlotCheck({ candidate: { priority: 'P1' } });
    expect(r.allow).toBe(false);
    expect(r.inflight).toBe(1);
    expect(r.kernel_active).toBe(0);
    expect(r.reason).toBe('cap_reached');
  });
});
