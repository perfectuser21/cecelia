/**
 * routes/shared.js 单元测试
 *
 * 配套 PR 2b-1（shared.js 的 getActiveExecutionPaths 查询 status 改 running）。
 * 验证常量业务契约与默认活跃任务队列的 SQL 分页边界；数据库调用使用 mock。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../db.js', () => ({ default: mockPool }));
import { ALLOWED_ACTIONS, INVENTORY_CONFIG, getTopTasks } from '../shared.js';

describe('默认活跃任务队列的稳定分页', () => {
  beforeEach(() => mockPool.query.mockReset());
  it.each([undefined, 0])('offset=%s 保留单一 limit 绑定、活跃集合和优先级排序', async (offset) => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'active' }] });
    expect(await getTopTasks(2, offset)).toEqual([{ id: 'active' }]);
    const [sql, params] = mockPool.query.mock.calls[0];
    expect(params).toEqual([2]);
    expect(sql).toContain("status NOT IN ('completed', 'cancelled')");
    expect(sql).toContain("CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END, created_at ASC, id ASC");
    expect(sql).not.toContain('OFFSET');
  });
  it('后续页增加 OFFSET 绑定，保留同一集合和完整排序', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'next' }] });
    expect(await getTopTasks(2, 2)).toEqual([{ id: 'next' }]);
    const [sql, params] = mockPool.query.mock.calls[0];
    expect(params).toEqual([2, 2]);
    expect(sql).toContain("status NOT IN ('completed', 'cancelled')");
    expect(sql).toMatch(/created_at ASC, id ASC LIMIT \$1 OFFSET \$2$/);
  });
});

describe('routes/shared — ALLOWED_ACTIONS 白名单', () => {
  it('create-task 必填 title，update-task 必填 task_id', () => {
    expect(ALLOWED_ACTIONS['create-task'].required).toContain('title');
    expect(ALLOWED_ACTIONS['update-task'].required).toContain('task_id');
  });

  it('update-task 允许改 status（生命周期推进入口）', () => {
    expect(ALLOWED_ACTIONS['update-task'].optional).toContain('status');
  });
});

describe('routes/shared — INVENTORY_CONFIG 库存阈值', () => {
  it('低水位/目标就绪/批量大小为预期业务常量', () => {
    expect(INVENTORY_CONFIG.LOW_WATERMARK).toBe(3);
    expect(INVENTORY_CONFIG.TARGET_READY_TASKS).toBe(9);
    expect(INVENTORY_CONFIG.BATCH_SIZE).toBe(3);
  });
});
