/**
 * Issue cc28d1af 根因B/C — 派发死循环的两个"无限"必须变"有限"：
 *   C1 handleTaskFailure skipCount(transient) requeue 必须计数，≥5 转 quarantine
 *   C2 quarantine 自动释放（TTL）必须计数，≥2 不再自动释放（等人工）
 * 0730实证：秒挂任务靠 transient 分类白嫖无限 requeue + 隔离被 TTL 自动放出，
 * 单任务霸占每个 tick 的派发动作，整个 P1 队列饿死3天。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => {
  const pool = { query: vi.fn() };
  return { default: pool, pool };
});

const { default: pool } = await import('../db.js');
const { handleTaskFailure, checkExpiredQuarantineTasks } = await import('../quarantine.js');

beforeEach(() => { vi.clearAllMocks(); });

function mockTaskRow(payload = {}, status = 'failed') {
  return { rows: [{ id: 't1', status, payload, title: 'x', task_type: 'research' }] };
}

describe('C1: skipCount transient requeue 上限', () => {
  it('transient requeue 递增 transient_requeue_count', async () => {
    // 守卫链真实查询序：①hasActiveCheckpoint(checkpoints表) ②hasActiveContainer(docker,非pool)
    // ③hasActivePr(SELECT pr_url,pr_status) ④cap计数SELECT payload
    pool.query.mockResolvedValueOnce({ rows: [] });                                  // ①checkpoint
    pool.query.mockResolvedValueOnce({ rows: [{ pr_url: null, pr_status: null }] }); // ③pr
    pool.query.mockResolvedValueOnce(mockTaskRow({ transient_requeue_count: 1 }));   // ④cap读payload
    pool.query.mockResolvedValue({ rows: [], rowCount: 1 }); // 后续 UPDATE
    const r = await handleTaskFailure('t1', { skipCount: true });
    expect(r.skipped_count).toBe(true);
    // 断言某次 UPDATE 写入了 transient_requeue_count 递增
    const updates = pool.query.mock.calls.filter(c => /UPDATE tasks/.test(c[0]));
    const touched = updates.some(c =>
      String(c[0]).includes('transient_requeue_count') ||
      JSON.stringify(c[1] ?? []).includes('transient_requeue_count')
    );
    expect(touched).toBe(true);
  });

  it('transient_requeue_count 达上限(≥5) → 不再requeue，转quarantine路径', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });                                  // ①checkpoint
    pool.query.mockResolvedValueOnce({ rows: [{ pr_url: null, pr_status: null }] }); // ③pr
    pool.query.mockResolvedValueOnce(mockTaskRow({ transient_requeue_count: 5 }));   // ④cap读payload
    pool.query.mockResolvedValueOnce(mockTaskRow({ transient_requeue_count: 5 }));   // 正常路径读task
    pool.query.mockResolvedValue({ rows: [], rowCount: 1 });
    const r = await handleTaskFailure('t1', { skipCount: true });
    expect(r.skipped_count).not.toBe(true);
  });
});

describe('C2: quarantine 自动释放上限', () => {
  it('quarantine_release_count ≥2 的任务不进入自动释放清单', async () => {
    // alertness 正常 → 查过期隔离
    pool.query.mockResolvedValueOnce({ rows: [] }); // SELECT 过期隔离（SQL应排除超限任务）
    const released = await checkExpiredQuarantineTasks();
    expect(released).toEqual([]);
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toMatch(/quarantine_release_count|release_count/);
  });
});
