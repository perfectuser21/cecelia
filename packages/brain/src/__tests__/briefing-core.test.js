/**
 * Briefing 模块核心单元测试
 *
 * 覆盖所有导出函数：
 *   getBriefing(options)
 *
 * 间接覆盖内部函数：
 *   getGreeting() — 通过 getBriefing 返回值验证
 *   formatEventText(row) — 通过事件格式化验证
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted() 确保 mock 变量在 vi.mock factory 提升前已定义
const { mockQuery, mockRelease, mockConnect } = vi.hoisted(() => {
  const mockQuery = vi.fn();
  const mockRelease = vi.fn();
  const mockConnect = vi.fn().mockResolvedValue({
    query: mockQuery,
    release: mockRelease,
  });
  return { mockQuery, mockRelease, mockConnect };
});

vi.mock('../db.js', () => ({
  default: { connect: mockConnect },
}));

import { getBriefing } from '../briefing.js';

// ---------- 辅助函数 ----------

/**
 * 构造 6 个标准 mock 查询结果（按 Promise.all 顺序）
 * 1. 任务统计
 * 2. 最近事件
 * 3. 待决策 desires
 * 4. 今日焦点
 * 5. Token 费用
 * 6. 运行中任务
 */
function mockAllQueries({
  taskStats = { completed: '0', failed: '0', queued: '0', in_progress: '0' },
  events = [],
  desires = [],
  focus = [],
  token = [{ total_cost_usd: '0', api_calls: '0' }],
  running = [],
} = {}) {
  mockQuery
    .mockResolvedValueOnce({ rows: [taskStats] })   // 1. 任务统计
    .mockResolvedValueOnce({ rows: events })         // 2. 最近事件
    .mockResolvedValueOnce({ rows: desires })        // 3. 待决策 desires
    .mockResolvedValueOnce({ rows: focus })          // 4. 今日焦点
    .mockResolvedValueOnce({ rows: token })          // 5. Token 费用
    .mockResolvedValueOnce({ rows: running });       // 6. 运行中任务
}

// ---------- 测试 ----------

describe('briefing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue({
      query: mockQuery,
      release: mockRelease,
    });
  });

  // ==================== getBriefing — 顶层结构 ====================

  describe('getBriefing — 顶层结构', () => {
    it('返回所有必需的顶层字段', async () => {
      mockAllQueries();

      const result = await getBriefing();

      expect(result).toHaveProperty('greeting');
      expect(result).toHaveProperty('since_last_visit');
      expect(result).toHaveProperty('pending_decisions');
      expect(result).toHaveProperty('today_focus');
      expect(result).toHaveProperty('running_tasks');
      expect(result).toHaveProperty('token_cost_usd');
      expect(result).toHaveProperty('generated_at');
    });

    it('generated_at 是有效的 ISO 时间字符串', async () => {
      mockAllQueries();

      const result = await getBriefing();

      expect(() => new Date(result.generated_at)).not.toThrow();
      expect(new Date(result.generated_at).toISOString()).toBe(result.generated_at);
    });

    it('since_last_visit.since 默认为 24h 前', async () => {
      mockAllQueries();

      const before = Date.now() - 24 * 3600 * 1000;
      const result = await getBriefing();
      const after = Date.now() - 24 * 3600 * 1000;

      const sinceMs = new Date(result.since_last_visit.since).getTime();
      // 允许 1 秒误差
      expect(sinceMs).toBeGreaterThanOrEqual(before - 1000);
      expect(sinceMs).toBeLessThanOrEqual(after + 1000);
    });

    it('支持自定义 since 参数', async () => {
      const since = '2026-01-01T00:00:00.000Z';
      mockAllQueries();

      const result = await getBriefing({ since });

      expect(result.since_last_visit.since).toBe(since);
    });

    it('自定义 since 参数传递给第一个 SQL 查询', async () => {
      const since = '2026-02-15T08:00:00.000Z';
      mockAllQueries();

      await getBriefing({ since });

      // 第一个查询应包含 since 参数
      expect(mockQuery.mock.calls[0][1]).toContain(since);
    });

    it('并发执行 6 个查询', async () => {
      mockAllQueries();

      await getBriefing();

      // Promise.all 会一次性发出所有 query，总计 6 次
      expect(mockQuery).toHaveBeenCalledTimes(6);
    });
  });

  // ==================== getBriefing — 任务统计 ====================

  describe('getBriefing — 任务统计 (since_last_visit)', () => {
    it('正确解析任务统计数字', async () => {
      mockAllQueries({
        taskStats: { completed: '10', failed: '2', queued: '15', in_progress: '3' },
      });

      const result = await getBriefing();

      expect(result.since_last_visit.completed).toBe(10);
      expect(result.since_last_visit.failed).toBe(2);
      expect(result.since_last_visit.queued).toBe(15);
      expect(result.since_last_visit.in_progress).toBe(3);
    });

    it('数据库返回 null 时各字段降级为 0', async () => {
      mockAllQueries({
        taskStats: { completed: null, failed: null, queued: null, in_progress: null },
      });

      const result = await getBriefing();

      expect(result.since_last_visit.completed).toBe(0);
      expect(result.since_last_visit.failed).toBe(0);
      expect(result.since_last_visit.queued).toBe(0);
      expect(result.since_last_visit.in_progress).toBe(0);
    });

    it('数据库返回字符串数字时正确转换为整数', async () => {
      mockAllQueries({
        taskStats: { completed: '7', failed: '0', queued: '3', in_progress: '1' },
      });

      const result = await getBriefing();

      expect(typeof result.since_last_visit.completed).toBe('number');
      expect(result.since_last_visit.completed).toBe(7);
    });

    it('since_last_visit.events 是数组', async () => {
      mockAllQueries();

      const result = await getBriefing();

      expect(Array.isArray(result.since_last_visit.events)).toBe(true);
    });
  });

  // ==================== getBriefing — 事件格式化 (formatEventText) ====================

  describe('getBriefing — 事件格式化 (formatEventText)', () => {
    it('task_completed 事件显示 agent 和 title', async () => {
      const event = {
        event_type: 'task_completed',
        source: 'tick',
        payload: { agent: 'caramel', title: 'PR #550' },
        created_at: new Date('2026-03-06T10:00:00Z'),
      };
      mockAllQueries({ events: [event] });

      const result = await getBriefing();

      expect(result.since_last_visit.events[0].text).toBe('caramel 完成了 PR #550');
      expect(result.since_last_visit.events[0].type).toBe('task_completed');
    });

    it('task_completed 事件缺少 agent/title 时使用默认值', async () => {
      const event = {
        event_type: 'task_completed',
        source: 'tick',
        payload: {},
        created_at: new Date('2026-03-06T10:00:00Z'),
      };
      mockAllQueries({ events: [event] });

      const result = await getBriefing();

      expect(result.since_last_visit.events[0].text).toBe('agent 完成了 任务');
    });

    it('task_failed 事件显示 agent 和 title', async () => {
      const event = {
        event_type: 'task_failed',
        source: 'tick',
        payload: { agent: 'caramel', title: '修复 CI' },
        created_at: new Date('2026-03-06T11:00:00Z'),
      };
      mockAllQueries({ events: [event] });

      const result = await getBriefing();

      expect(result.since_last_visit.events[0].text).toBe('caramel 执行失败: 修复 CI');
    });

    it('task_failed 事件缺少 payload 字段时使用默认值', async () => {
      const event = {
        event_type: 'task_failed',
        source: 'tick',
        payload: {},
        created_at: new Date(),
      };
      mockAllQueries({ events: [event] });

      const result = await getBriefing();

      expect(result.since_last_visit.events[0].text).toBe('agent 执行失败: 任务');
    });

    it('task_dispatched 事件显示 title', async () => {
      const event = {
        event_type: 'task_dispatched',
        source: 'tick',
        payload: { title: '实现 Parser API' },
        created_at: new Date(),
      };
      mockAllQueries({ events: [event] });

      const result = await getBriefing();

      expect(result.since_last_visit.events[0].text).toBe('已派发: 实现 Parser API');
    });

    it('task_dispatched 事件缺少 title 时使用默认值', async () => {
      const event = {
        event_type: 'task_dispatched',
        source: 'tick',
        payload: {},
        created_at: new Date(),
      };
      mockAllQueries({ events: [event] });

      const result = await getBriefing();

      expect(result.since_last_visit.events[0].text).toBe('已派发: 任务');
    });

    it('daily_report_generated 事件返回固定文本', async () => {
      const event = {
        event_type: 'daily_report_generated',
        source: 'tick',
        payload: {},
        created_at: new Date(),
      };
      mockAllQueries({ events: [event] });

      const result = await getBriefing();

      expect(result.since_last_visit.events[0].text).toBe('日报已生成');
    });

    it('desire_expressed 事件显示 content 前 50 字', async () => {
      const longContent = '这是一段超过五十个字的欲望表达内容，用来测试截断逻辑是否正常工作，包括中文字符的处理';
      const event = {
        event_type: 'desire_expressed',
        source: 'desire',
        payload: { content: longContent },
        created_at: new Date(),
      };
      mockAllQueries({ events: [event] });

      const result = await getBriefing();

      expect(result.since_last_visit.events[0].text).toBe(
        `Cecelia 表达了: ${longContent.substring(0, 50)}`
      );
    });

    it('desire_expressed 事件缺少 content 时显示省略号', async () => {
      const event = {
        event_type: 'desire_expressed',
        source: 'desire',
        payload: {},
        created_at: new Date(),
      };
      mockAllQueries({ events: [event] });

      const result = await getBriefing();

      expect(result.since_last_visit.events[0].text).toBe('Cecelia 表达了: ...');
    });

    it('未知事件类型返回 event_type 和 source', async () => {
      const event = {
        event_type: 'unknown_event',
        source: 'system',
        payload: {},
        created_at: new Date(),
      };
      mockAllQueries({ events: [event] });

      const result = await getBriefing();

      expect(result.since_last_visit.events[0].text).toBe('unknown_event: system');
    });

    it('事件包含 time 字段（时:分格式）', async () => {
      const event = {
        event_type: 'task_completed',
        source: 'tick',
        payload: { agent: 'caramel', title: 'PR' },
        created_at: new Date('2026-03-06T14:30:00'),
      };
      mockAllQueries({ events: [event] });

      const result = await getBriefing();

      // time 是 HH:MM 格式的字符串
      expect(typeof result.since_last_visit.events[0].time).toBe('string');
      expect(result.since_last_visit.events[0].time).toMatch(/^\d{2}:\d{2}$/);
    });

    it('多个事件按原始顺序返回', async () => {
      const events = [
        { event_type: 'task_completed', source: 'tick', payload: { agent: 'a1', title: 'T1' }, created_at: new Date('2026-03-06T10:00:00Z') },
        { event_type: 'task_failed', source: 'tick', payload: { agent: 'a2', title: 'T2' }, created_at: new Date('2026-03-06T09:00:00Z') },
        { event_type: 'daily_report_generated', source: 'system', payload: {}, created_at: new Date('2026-03-06T08:00:00Z') },
      ];
      mockAllQueries({ events });

      const result = await getBriefing();

      expect(result.since_last_visit.events).toHaveLength(3);
      expect(result.since_last_visit.events[0].type).toBe('task_completed');
      expect(result.since_last_visit.events[1].type).toBe('task_failed');
      expect(result.since_last_visit.events[2].type).toBe('daily_report_generated');
    });
  });

  // ==================== getBriefing — 待决策 desires ====================

  describe('getBriefing — 待决策 desires (pending_decisions)', () => {
    it('正确映射 desire 字段', async () => {
      const desire = {
        id: 'desire-1',
        type: 'warn',
        content: 'CI 持续失败',
        proposed_action: '安排紧急修复',
        urgency: 9,
        created_at: new Date('2026-03-06T09:00:00Z'),
      };
      mockAllQueries({ desires: [desire] });

      const result = await getBriefing();

      expect(result.pending_decisions[0]).toEqual({
        desire_id: 'desire-1',
        type: 'warn',
        summary: 'CI 持续失败',
        proposed_action: '安排紧急修复',
        urgency: 9,
        created_at: desire.created_at,
      });
    });

    it('无待决策 desires 时返回空数组', async () => {
      mockAllQueries();

      const result = await getBriefing();

      expect(result.pending_decisions).toEqual([]);
    });

    it('多个 desires 全部映射', async () => {
      const desires = [
        { id: 'd1', type: 'explore', content: 'A', proposed_action: 'act-a', urgency: 5, created_at: new Date() },
        { id: 'd2', type: 'warn', content: 'B', proposed_action: 'act-b', urgency: 8, created_at: new Date() },
      ];
      mockAllQueries({ desires });

      const result = await getBriefing();

      expect(result.pending_decisions).toHaveLength(2);
      expect(result.pending_decisions[0].desire_id).toBe('d1');
      expect(result.pending_decisions[1].desire_id).toBe('d2');
    });
  });

  // ==================== getBriefing — 今日焦点 ====================

  describe('getBriefing — 今日焦点 (today_focus)', () => {
    it('有焦点时返回 title/progress/objective_id', async () => {
      const focusRow = {
        value_json: {
          objective_title: 'Task Intelligence',
          progress: 60,
          objective_id: 'goal-123',
        },
      };
      mockAllQueries({ focus: [focusRow] });

      const result = await getBriefing();

      expect(result.today_focus).toEqual({
        title: 'Task Intelligence',
        progress: 60,
        objective_id: 'goal-123',
      });
    });

    it('value_json 使用 title 字段时 fallback 正确', async () => {
      const focusRow = {
        value_json: {
          title: 'Fallback Title',
          progress: 30,
          id: 'goal-456',
        },
      };
      mockAllQueries({ focus: [focusRow] });

      const result = await getBriefing();

      expect(result.today_focus.title).toBe('Fallback Title');
      expect(result.today_focus.objective_id).toBe('goal-456');
    });

    it('value_json 缺少 progress 时默认为 0', async () => {
      const focusRow = {
        value_json: {
          objective_title: 'My KR',
          objective_id: 'goal-789',
        },
      };
      mockAllQueries({ focus: [focusRow] });

      const result = await getBriefing();

      expect(result.today_focus.progress).toBe(0);
    });

    it('无焦点记录时 today_focus 为 null', async () => {
      mockAllQueries({ focus: [] });

      const result = await getBriefing();

      expect(result.today_focus).toBeNull();
    });

    it('objective_title 优先于 title 字段', async () => {
      const focusRow = {
        value_json: {
          objective_title: 'Objective Title',
          title: 'Fallback Title',
          progress: 50,
          objective_id: 'goal-1',
        },
      };
      mockAllQueries({ focus: [focusRow] });

      const result = await getBriefing();

      expect(result.today_focus.title).toBe('Objective Title');
    });

    it('objective_id 优先于 id 字段', async () => {
      const focusRow = {
        value_json: {
          objective_title: 'Title',
          progress: 50,
          objective_id: 'obj-id-priority',
          id: 'id-fallback',
        },
      };
      mockAllQueries({ focus: [focusRow] });

      const result = await getBriefing();

      expect(result.today_focus.objective_id).toBe('obj-id-priority');
    });
  });

  // ==================== getBriefing — 运行中任务 ====================

  describe('getBriefing — 运行中任务 (running_tasks)', () => {
    it('正确映射运行中任务字段', async () => {
      const startedAt = new Date('2026-03-06T08:00:00Z');
      const task = {
        id: 'task-1',
        title: 'PR #552',
        task_type: 'dev',
        started_at: startedAt,
        priority: 'P0',
      };
      mockAllQueries({ running: [task] });

      const result = await getBriefing();

      expect(result.running_tasks[0]).toEqual({
        id: 'task-1',
        title: 'PR #552',
        type: 'dev',
        started_at: startedAt,
        priority: 'P0',
      });
    });

    it('无运行中任务时返回空数组', async () => {
      mockAllQueries();

      const result = await getBriefing();

      expect(result.running_tasks).toEqual([]);
    });

    it('多个运行中任务全部映射', async () => {
      const running = [
        { id: 't1', title: 'Task 1', task_type: 'dev', started_at: new Date(), priority: 'P0' },
        { id: 't2', title: 'Task 2', task_type: 'okr', started_at: new Date(), priority: 'P1' },
      ];
      mockAllQueries({ running });

      const result = await getBriefing();

      expect(result.running_tasks).toHaveLength(2);
      expect(result.running_tasks[0].id).toBe('t1');
      expect(result.running_tasks[1].id).toBe('t2');
    });

    it('task_type 映射为 type 字段', async () => {
      const task = {
        id: 't1', title: 'T1', task_type: 'architecture_design', started_at: new Date(), priority: 'P1',
      };
      mockAllQueries({ running: [task] });

      const result = await getBriefing();

      expect(result.running_tasks[0].type).toBe('architecture_design');
      expect(result.running_tasks[0]).not.toHaveProperty('task_type');
    });
  });

  // ==================== getBriefing — Token 费用 ====================

  describe('getBriefing — Token 费用 (token_cost_usd)', () => {
    it('正确解析 token 费用', async () => {
      mockAllQueries({ token: [{ total_cost_usd: '3.75', api_calls: '120' }] });

      const result = await getBriefing();

      expect(result.token_cost_usd).toBe(3.75);
    });

    it('token 费用为 0 时返回 0', async () => {
      mockAllQueries({ token: [{ total_cost_usd: '0', api_calls: '0' }] });

      const result = await getBriefing();

      expect(result.token_cost_usd).toBe(0);
    });

    it('token 费用为 null 时降级为 0', async () => {
      mockAllQueries({ token: [{ total_cost_usd: null }] });

      const result = await getBriefing();

      expect(result.token_cost_usd).toBe(0);
    });

    it('token_cost_usd 是浮点数', async () => {
      mockAllQueries({ token: [{ total_cost_usd: '1.234567' }] });

      const result = await getBriefing();

      expect(typeof result.token_cost_usd).toBe('number');
    });
  });

  // ==================== getBriefing — greeting (getGreeting) ====================

  describe('getBriefing — greeting (getGreeting)', () => {
    it('返回非空字符串', async () => {
      mockAllQueries();

      const result = await getBriefing();

      expect(typeof result.greeting).toBe('string');
      expect(result.greeting.length).toBeGreaterThan(0);
    });

    it('greeting 是合法的中文问候语之一', async () => {
      const validGreetings = ['夜深了', '早上好', '中午好', '下午好', '晚上好'];
      mockAllQueries();

      const result = await getBriefing();

      expect(validGreetings).toContain(result.greeting);
    });
  });

  // ==================== getBriefing — 数据库连接管理 ====================

  describe('getBriefing — 数据库连接管理', () => {
    it('成功时释放连接', async () => {
      mockAllQueries();

      await getBriefing();

      expect(mockRelease).toHaveBeenCalledTimes(1);
    });

    it('查询失败时仍然释放连接（finally 保证）', async () => {
      mockQuery.mockRejectedValueOnce(new Error('connection timeout'));

      await expect(getBriefing()).rejects.toThrow('connection timeout');

      expect(mockRelease).toHaveBeenCalledTimes(1);
    });

    it('查询失败时向上抛出错误', async () => {
      mockQuery.mockRejectedValueOnce(new Error('relation "tasks" does not exist'));

      await expect(getBriefing()).rejects.toThrow('relation "tasks" does not exist');
    });

    it('connect 失败时抛出错误且不调用 release', async () => {
      mockConnect.mockRejectedValueOnce(new Error('max connections reached'));

      await expect(getBriefing()).rejects.toThrow('max connections reached');

      // connect 失败，client 未获取，不会调用 release
      expect(mockRelease).not.toHaveBeenCalled();
    });

    it('每次调用都执行一次 connect', async () => {
      mockAllQueries();

      await getBriefing();

      expect(mockConnect).toHaveBeenCalledTimes(1);
    });
  });

  // ==================== getBriefing — 综合场景 ====================

  describe('getBriefing — 综合场景', () => {
    it('完整数据集返回正确的完整简报', async () => {
      const startedAt = new Date('2026-03-06T08:00:00Z');
      const eventAt = new Date('2026-03-06T09:30:00Z');
      const desireAt = new Date('2026-03-06T07:00:00Z');

      mockAllQueries({
        taskStats: { completed: '12', failed: '1', queued: '8', in_progress: '2' },
        events: [
          { event_type: 'task_completed', source: 'tick', payload: { agent: 'caramel', title: 'PR #555' }, created_at: eventAt },
          { event_type: 'task_dispatched', source: 'tick', payload: { title: '新任务' }, created_at: eventAt },
        ],
        desires: [
          { id: 'des-1', type: 'explore', content: '探索新功能', proposed_action: '调研', urgency: 3, created_at: desireAt },
        ],
        focus: [{ value_json: { objective_title: 'Q1 OKR', progress: 72, objective_id: 'kr-q1' } }],
        token: [{ total_cost_usd: '2.50', api_calls: '80' }],
        running: [{ id: 'rt-1', title: '进行中任务', task_type: 'dev', started_at: startedAt, priority: 'P0' }],
      });

      const result = await getBriefing();

      // 任务统计
      expect(result.since_last_visit.completed).toBe(12);
      expect(result.since_last_visit.failed).toBe(1);
      expect(result.since_last_visit.queued).toBe(8);
      expect(result.since_last_visit.in_progress).toBe(2);

      // 事件
      expect(result.since_last_visit.events).toHaveLength(2);
      expect(result.since_last_visit.events[0].text).toBe('caramel 完成了 PR #555');
      expect(result.since_last_visit.events[1].text).toBe('已派发: 新任务');

      // 待决策
      expect(result.pending_decisions).toHaveLength(1);
      expect(result.pending_decisions[0].desire_id).toBe('des-1');
      expect(result.pending_decisions[0].summary).toBe('探索新功能');

      // 今日焦点
      expect(result.today_focus.title).toBe('Q1 OKR');
      expect(result.today_focus.progress).toBe(72);
      expect(result.today_focus.objective_id).toBe('kr-q1');

      // 运行中任务
      expect(result.running_tasks).toHaveLength(1);
      expect(result.running_tasks[0].title).toBe('进行中任务');
      expect(result.running_tasks[0].type).toBe('dev');

      // Token 费用
      expect(result.token_cost_usd).toBe(2.5);

      // 连接释放
      expect(mockRelease).toHaveBeenCalledTimes(1);
    });

    it('空数据库场景：全部字段有合理的零值/空值', async () => {
      mockAllQueries({
        taskStats: { completed: '0', failed: '0', queued: '0', in_progress: '0' },
        events: [],
        desires: [],
        focus: [],
        token: [{ total_cost_usd: '0', api_calls: '0' }],
        running: [],
      });

      const result = await getBriefing();

      expect(result.since_last_visit.completed).toBe(0);
      expect(result.since_last_visit.events).toHaveLength(0);
      expect(result.pending_decisions).toHaveLength(0);
      expect(result.today_focus).toBeNull();
      expect(result.running_tasks).toHaveLength(0);
      expect(result.token_cost_usd).toBe(0);
    });
  });
});
