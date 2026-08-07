/**
 * startup-sync 孤儿复活 单测(TOP2 刀1 件② — task f4f28298)
 *
 * 2026-08-07 实证:W1/W2/W3 三条 harness_initiative 因 spawn-guard 死锁被 orphan-guard
 * requeue 三次后终态 failed。死因全是基础设施(容器 OOM / 早退),不是业务失败,
 * 但系统没有任何路径能把它们捞回来——Brain 重启也不行(scanOrphanedRelayTasks 本身是坏的)。
 *
 * 复活闸只认 orphan-guard 的 requeue 超限签名,业务失败一律不碰;
 * 且带复活次数封顶,防"每次 Brain 启动复活一次"的无限循环。
 */
import { describe, it, expect, vi } from 'vitest';
import {
  reviveOrphanedHarnessTasks,
  REVIVAL_ERROR_SIGNATURE,
} from '../startup-sync.js';

const TASK_ID = '0b7df1ca-da50-4928-9d24-bfbb8ae7cd90';

function poolWith(rows) {
  const calls = [];
  return {
    calls,
    query: vi.fn(async (sql, params) => {
      const s = String(sql);
      calls.push({ sql: s, params });
      if (s.includes('SELECT') && s.includes('FROM tasks')) return { rows, rowCount: rows.length };
      return { rows: [], rowCount: 1 };
    }),
  };
}

const orphanTask = {
  id: TASK_ID,
  title: 'W2 背靠背',
  status: 'failed',
  payload: { orchestrator: 'skill-relay', orphan_requeue_count: 3 },
  error_message: `${REVIVAL_ERROR_SIGNATURE}(3次),终态 failed: sweep-orphan(idle>15min,无活容器)`,
};

const noContainer = () => '';

describe('reviveOrphanedHarnessTasks', () => {
  it('只捞 orphan-guard requeue 超限签名的 failed 任务(业务失败不碰)', async () => {
    const pool = poolWith([]);
    await reviveOrphanedHarnessTasks({ pool, execFn: noContainer });
    const sel = pool.calls.find((c) => c.sql.includes('SELECT'));
    expect(sel.sql).toContain("status = 'failed'");
    expect(sel.sql).toContain('error_message LIKE');
    expect(JSON.stringify(sel.params)).toContain(REVIVAL_ERROR_SIGNATURE);
  });

  it('无活容器 → task 回 queued + requeue 计数重置 + 留痕 revived_from', async () => {
    const pool = poolWith([orphanTask]);
    const r = await reviveOrphanedHarnessTasks({ pool, execFn: noContainer });
    expect(r.revived).toBe(1);

    const upd = pool.calls.find((c) => c.sql.includes('UPDATE tasks'));
    expect(upd.sql).toContain("status = 'queued'");
    expect(upd.sql).toContain('claimed_by = NULL');
    // 并发守卫:只动仍是 failed 的行
    expect(upd.sql).toContain("status = 'failed'");
    // requeue 计数清零 + 复活计数 + 留痕,三者都得写进 payload
    expect(upd.sql).toContain("'orphan_requeue_count', 0");
    expect(upd.sql).toContain('harness_revival_count');
    expect(upd.sql).toContain('revived_from');
    // 留痕内容必须能追回原死因,否则事后无从判断这条是被谁复活的
    const trace = JSON.parse(upd.params[2]);
    expect(trace.reason).toBe('infra_death');
    expect(trace.previous_error).toContain(REVIVAL_ERROR_SIGNATURE);
  });

  it('复活前先终态化残留 run(否则重派立刻又撞 spawn-guard,白复活)', async () => {
    const pool = poolWith([orphanTask]);
    await reviveOrphanedHarnessTasks({ pool, execFn: noContainer });
    const runUpd = pool.calls.findIndex((c) => c.sql.includes('UPDATE initiative_runs'));
    const taskUpd = pool.calls.findIndex((c) => c.sql.includes('UPDATE tasks'));
    expect(runUpd).toBeGreaterThanOrEqual(0);
    // 顺序死规矩:run 先终态化,task 才回 queued——反过来会留下"queued 但被 guard 拒"的窗口
    expect(runUpd).toBeLessThan(taskUpd);
  });

  it('还有活容器 → 不复活(防与在跑的执行体双跑)', async () => {
    const pool = poolWith([orphanTask]);
    const r = await reviveOrphanedHarnessTasks({
      pool, execFn: () => 'cecelia-relay-0b7df1ca-alive\n',
    });
    expect(r.revived).toBe(0);
    expect(pool.calls.some((c) => c.sql.includes('UPDATE tasks'))).toBe(false);
  });

  it('docker 判活失败 → fail-open 跳过(宁可不复活,不能盲目重派)', async () => {
    const pool = poolWith([orphanTask]);
    const r = await reviveOrphanedHarnessTasks({
      pool, execFn: () => { throw new Error('docker down'); },
    });
    expect(r.revived).toBe(0);
    expect(pool.calls.some((c) => c.sql.includes('UPDATE tasks'))).toBe(false);
  });

  it('复活次数封顶写进查询条件(防每次 Brain 启动复活一次的无限循环)', async () => {
    const pool = poolWith([]);
    await reviveOrphanedHarnessTasks({ pool, execFn: noContainer, maxRevivals: 1 });
    const sel = pool.calls.find((c) => c.sql.includes('SELECT'));
    expect(sel.sql).toContain('harness_revival_count');
    expect(sel.params).toContain(1);
  });

  it('单条处理异常不拖垮整轮扫描', async () => {
    const pool = poolWith([orphanTask, { ...orphanTask, id: 'bad' }]);
    let n = 0;
    pool.query = vi.fn(async (sql) => {
      const s = String(sql);
      pool.calls.push({ sql: s });
      if (s.includes('SELECT') && s.includes('FROM tasks')) {
        return { rows: [{ ...orphanTask, id: 'bad-id' }, orphanTask] };
      }
      if (s.includes('UPDATE tasks') && ++n === 1) throw new Error('boom');
      return { rows: [], rowCount: 1 };
    });
    const r = await reviveOrphanedHarnessTasks({ pool, execFn: noContainer });
    expect(r.revived).toBe(1);
    expect(r.errors.length).toBe(1);
  });
});
