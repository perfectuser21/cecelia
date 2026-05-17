/**
 * health-monitor-callback-stats.test.js
 * 验证 health-monitor.js 中新增的 callback_queue_stats 逻辑
 * 覆盖目标：runLayer2HealthCheck 中 callback_queue_stats 代码块（lines 113-142）
 *
 * runLayer2HealthCheck(pool) 接受 pool 作为参数，无需 mock db 模块。
 */
import { describe, it, expect, vi } from 'vitest';
import { runLayer2HealthCheck } from '../health-monitor.js';

/**
 * 构造一个 mock pool，返回 8 次 query 的默认值：
 *   1. dispatched_1h count
 *   2. uptime_h
 *   3. stuck_tasks count
 *   4. last_success_ago_min
 *   5. queue_depth count
 *   6. callback_queue unprocessed
 *   7. callback_queue failed_retries
 *   8. recordHealthEvent INSERT
 */
function makeMockPool({ unprocessed = '2', failedRetries = '1', cbError = null } = {}) {
  const q = vi.fn()
    .mockResolvedValueOnce({ rows: [{ cnt: '5' }] })          // 1. dispatched_1h
    .mockResolvedValueOnce({ rows: [{ uptime_h: '100' }] })   // 2. uptime
    .mockResolvedValueOnce({ rows: [{ cnt: '0' }] })           // 3. stuck_tasks
    .mockResolvedValueOnce({ rows: [{ ago_min: '10' }] })      // 4. last_success_ago_min
    .mockResolvedValueOnce({ rows: [{ cnt: '3' }] });          // 5. queue_depth

  if (cbError) {
    q.mockRejectedValueOnce(cbError);                          // 6. callback_queue unprocessed → 失败
  } else {
    q.mockResolvedValueOnce({ rows: [{ cnt: unprocessed }] }) // 6. callback_queue unprocessed
     .mockResolvedValueOnce({ rows: [{ cnt: failedRetries }] }); // 7. callback_queue failed_retries
  }
  q.mockResolvedValueOnce({ rowCount: 1 });                    // 8. recordHealthEvent INSERT

  return { query: q };
}

describe('runLayer2HealthCheck — callback_queue_stats', () => {
  it('正常情况：返回 unprocessed 和 failed_retries 计数', async () => {
    const pool = makeMockPool({ unprocessed: '7', failedRetries: '3' });
    const result = await runLayer2HealthCheck(pool);

    expect(result.callback_queue_stats).toBeDefined();
    expect(result.callback_queue_stats.unprocessed).toBe(7);
    expect(result.callback_queue_stats.failed_retries).toBe(3);
  });

  it('空队列：unprocessed 和 failed_retries 均为 0', async () => {
    const pool = makeMockPool({ unprocessed: '0', failedRetries: '0' });
    const result = await runLayer2HealthCheck(pool);

    expect(result.callback_queue_stats.unprocessed).toBe(0);
    expect(result.callback_queue_stats.failed_retries).toBe(0);
  });

  it('callback_queue 查询失败时降级为默认值 {unprocessed:0, failed_retries:0}', async () => {
    const pool = makeMockPool({ cbError: new Error('relation "callback_queue" does not exist') });
    const result = await runLayer2HealthCheck(pool);

    // 不抛异常，使用默认值
    expect(result.callback_queue_stats).toEqual({ unprocessed: 0, failed_retries: 0 });
  });

  it('结果顶层包含 level / checks / failing / callback_queue_stats / summary', async () => {
    const pool = makeMockPool();
    const result = await runLayer2HealthCheck(pool);

    expect(result).toHaveProperty('level');
    expect(result).toHaveProperty('checks');
    expect(result).toHaveProperty('failing');
    expect(result).toHaveProperty('callback_queue_stats');
    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('checked_at');
  });

  it('大量未处理回调：数字正确解析', async () => {
    const pool = makeMockPool({ unprocessed: '999', failedRetries: '42' });
    const result = await runLayer2HealthCheck(pool);

    expect(result.callback_queue_stats.unprocessed).toBe(999);
    expect(result.callback_queue_stats.failed_retries).toBe(42);
  });
});
