/**
 * Briefing API 测试
 *
 * 验证 GET /api/brain/briefing 返回正确的简报格式
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted() 解决 vi.mock factory 提升问题
const { mockQuery, mockRelease, mockConnect } = vi.hoisted(() => {
  const mockQuery = vi.fn();
  const mockRelease = vi.fn();
  const mockConnect = vi.fn().mockResolvedValue({
    query: mockQuery,
    release: mockRelease
  });
  return { mockQuery, mockRelease, mockConnect };
});

vi.mock('../db.js', () => ({
  default: { connect: mockConnect }
}));

import { getBriefing } from '../briefing.js';

describe('Briefing API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue({
      query: mockQuery,
      release: mockRelease
    });
  });

  it('返回完整的简报结构', async () => {
    // Mock 6 个并发查询的返回
    mockQuery
      // 1. 任务统计
      .mockResolvedValueOnce({ rows: [{ completed: '3', failed: '1', queued: '5', in_progress: '2' }] })
      // 2. 最近事件
      .mockResolvedValueOnce({ rows: [
        { event_type: 'task_completed', source: 'tick', payload: { agent: 'caramel', title: 'PR #550' }, created_at: new Date() }
      ] })
      // 3. 待决策 desires
      .mockResolvedValueOnce({ rows: [
        { id: 'd1', type: 'warn', content: 'CI 失败', proposed_action: '安排修复', urgency: 8, created_at: new Date() }
      ] })
      // 4. 今日焦点
      .mockResolvedValueOnce({ rows: [{ value_json: { objective_title: 'Task Intelligence', progress: 45, objective_id: 'goal-1' } }] })
      // 5. Token 费用
      .mockResolvedValueOnce({ rows: [{ total_cost_usd: '1.24', api_calls: '47' }] })
      // 6. 运行中任务
      .mockResolvedValueOnce({ rows: [
        { id: 't1', title: 'PR #552', task_type: 'dev', started_at: new Date(), priority: 'P0' }
      ] });

    const briefing = await getBriefing();

    // 验证顶层结构
    expect(briefing).toHaveProperty('greeting');
    expect(briefing).toHaveProperty('since_last_visit');
    expect(briefing).toHaveProperty('pending_decisions');
    expect(briefing).toHaveProperty('today_focus');
    expect(briefing).toHaveProperty('running_tasks');
    expect(briefing).toHaveProperty('token_cost_usd');
    expect(briefing).toHaveProperty('generated_at');

    // 验证 since_last_visit
    expect(briefing.since_last_visit.completed).toBe(3);
    expect(briefing.since_last_visit.failed).toBe(1);
    expect(briefing.since_last_visit.queued).toBe(5);
    expect(briefing.since_last_visit.in_progress).toBe(2);
    expect(briefing.since_last_visit.events).toHaveLength(1);
    expect(briefing.since_last_visit.events[0].text).toContain('caramel');

    // 验证 pending_decisions
    expect(briefing.pending_decisions).toHaveLength(1);
    expect(briefing.pending_decisions[0]).toEqual(expect.objectContaining({
      desire_id: 'd1',
      type: 'warn',
      summary: 'CI 失败',
      urgency: 8
    }));

    // 验证 today_focus
    expect(briefing.today_focus).toEqual(expect.objectContaining({
      title: 'Task Intelligence',
      progress: 45
    }));

    // 验证 running_tasks
    expect(briefing.running_tasks).toHaveLength(1);
    expect(briefing.running_tasks[0].title).toBe('PR #552');

    // 验证 token_cost_usd
    expect(briefing.token_cost_usd).toBe(1.24);
  });

  it('greeting 根据时段变化', async () => {
    // Mock 空数据（6 个查询）
    mockQuery.mockResolvedValue({ rows: [{ completed: '0', failed: '0', queued: '0', in_progress: '0', total_cost_usd: '0', api_calls: '0' }] });

    const briefing = await getBriefing();
    expect(typeof briefing.greeting).toBe('string');
    expect(briefing.greeting.length).toBeGreaterThan(0);
  });

  it('没有焦点时 today_focus 为 null', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ completed: '0', failed: '0', queued: '0', in_progress: '0' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })  // 空焦点
      .mockResolvedValueOnce({ rows: [{ total_cost_usd: '0' }] })
      .mockResolvedValueOnce({ rows: [] });

    const briefing = await getBriefing();
    expect(briefing.today_focus).toBeNull();
  });

  it('支持 since 参数', async () => {
    const since = '2026-02-24T00:00:00Z';
    mockQuery.mockResolvedValue({ rows: [{ completed: '0', failed: '0', queued: '0', in_progress: '0', total_cost_usd: '0' }] });

    const briefing = await getBriefing({ since });
    expect(briefing.since_last_visit.since).toBe(since);

    // 验证第一个查询用了 since 参数
    expect(mockQuery.mock.calls[0][1]).toContain(since);
  });

  it('始终释放数据库连接', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB error'));

    await expect(getBriefing()).rejects.toThrow('DB error');
    expect(mockRelease).toHaveBeenCalled();
  });
});
