/**
 * paused-requeuer.js 单元测试
 *
 * 验证核心 SQL 行为：
 * - retry_count >= MAX → archived（防无限循环）
 * - paused > 1h && retry < MAX → requeued + retry_count++
 * - 返回结构：{ requeued, archived }
 */

import { describe, it, expect, vi } from 'vitest';
import { runPausedRequeue } from '../paused-requeuer.js';

describe('runPausedRequeue', () => {
  it('archive 优先：先归档 retry_count >= MAX 的 paused', async () => {
    const mockQuery = vi.fn()
      .mockResolvedValueOnce({ rowCount: 2, rows: [{ id: 't1' }, { id: 't2' }] }) // archive
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });                          // requeue

    const r = await runPausedRequeue({ query: mockQuery });

    expect(r.archived).toBe(2);
    expect(r.requeued).toBe(0);

    // 第一次调用：archive SQL 必须含 retry_count >= MAX 子句
    const [archiveSql] = mockQuery.mock.calls[0];
    expect(archiveSql).toMatch(/UPDATE tasks/i);
    expect(archiveSql).toMatch(/status = 'archived'/);
    expect(archiveSql).toMatch(/COALESCE\(retry_count, 0\) >= \$1/);
  });

  it('requeue：paused > 1h 且 retry < MAX → status=queued + retry_count++', async () => {
    const mockQuery = vi.fn()
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })                              // archive
      .mockResolvedValueOnce({ rowCount: 3, rows: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }); // requeue

    const r = await runPausedRequeue({ query: mockQuery });

    expect(r.archived).toBe(0);
    expect(r.requeued).toBe(3);

    // 第二次调用：requeue SQL
    const [requeueSql] = mockQuery.mock.calls[1];
    expect(requeueSql).toMatch(/UPDATE tasks/i);
    expect(requeueSql).toMatch(/status = 'queued'/);
    expect(requeueSql).toMatch(/retry_count = COALESCE\(retry_count, 0\) \+ 1/);
    expect(requeueSql).toMatch(/updated_at < NOW\(\) - INTERVAL '60 minutes'/);
    expect(requeueSql).toMatch(/COALESCE\(retry_count, 0\) < \$1/);
  });

  it('双路径同时触发：archive 与 requeue 计数独立累加', async () => {
    const mockQuery = vi.fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'old' }] })  // archive 1
      .mockResolvedValueOnce({ rowCount: 2, rows: [{ id: 'a' }, { id: 'b' }] }); // requeue 2

    const r = await runPausedRequeue({ query: mockQuery });

    expect(r.archived).toBe(1);
    expect(r.requeued).toBe(2);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('MAX_RETRY_COUNT=3 作为上限传给 SQL $1 参数', async () => {
    const mockQuery = vi.fn()
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });

    await runPausedRequeue({ query: mockQuery });

    // archive SQL $1
    expect(mockQuery.mock.calls[0][1]).toEqual([3]);
    // requeue SQL $1
    expect(mockQuery.mock.calls[1][1]).toEqual([3]);
  });

  it('无 dbPool 参数：fallback 到 default pool import（基本 smoke）', async () => {
    // runPausedRequeue 不传 dbPool 时使用 import 的默认 pool。
    // 这里仅验证函数签名允许无参（实际 DB 调用走 default pool 不在单测范围）。
    expect(typeof runPausedRequeue).toBe('function');
    expect(runPausedRequeue.length).toBeLessThanOrEqual(1); // 接受 0 或 1 个参数
  });
});
