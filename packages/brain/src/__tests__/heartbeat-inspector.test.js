/**
 * Heartbeat Inspector 主流程测试
 * 覆盖：D1, D2, D3, D4, D7, D8, D9, D10
 *   + active_goals=0 P0 告警（Cortex Insight ec71a550）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPool, mockCallLLM, mockExecuteDecision, mockRaiseAlert } = vi.hoisted(() => ({
  mockPool: { query: vi.fn() },
  mockCallLLM: vi.fn(),
  mockExecuteDecision: vi.fn(),
  mockRaiseAlert: vi.fn(),
}));

vi.mock('../db.js', () => ({ default: mockPool }));
vi.mock('../llm-caller.js', () => ({
  callLLM: (...args) => mockCallLLM(...args),
}));
vi.mock('../decision-executor.js', () => ({
  executeDecision: (...args) => mockExecuteDecision(...args),
}));
vi.mock('../alerting.js', () => ({
  raise: (...args) => mockRaiseAlert(...args),
}));

const {
  runHeartbeatInspection,
  collectSystemSnapshot,
  buildHeartbeatPrompt,
  parseHeartbeatResponse,
  readHeartbeatFile,
  HEARTBEAT_ALLOWED_ACTIONS,
  HEARTBEAT_INTERVAL_MS,
} = await import('../heartbeat-inspector.js');

describe('Heartbeat Inspector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 默认 mock pool.query 返回空行
    mockPool.query.mockResolvedValue({ rows: [] });
  });

  // D2: 导出验证
  it('导出 runHeartbeatInspection 函数', () => {
    expect(typeof runHeartbeatInspection).toBe('function');
  });

  it('导出 HEARTBEAT_INTERVAL_MS = 30 分钟', () => {
    expect(HEARTBEAT_INTERVAL_MS).toBe(30 * 60 * 1000);
  });

  it('导出 HEARTBEAT_ALLOWED_ACTIONS 白名单（6 个）', () => {
    expect(HEARTBEAT_ALLOWED_ACTIONS).toHaveLength(6);
    expect(HEARTBEAT_ALLOWED_ACTIONS).toContain('no_action');
    expect(HEARTBEAT_ALLOWED_ACTIONS).toContain('heartbeat_finding');
  });

  // D1: HEARTBEAT.md 文件读取
  describe('readHeartbeatFile', () => {
    it('文件不存在返回 null', () => {
      const result = readHeartbeatFile('/tmp/nonexistent-heartbeat-test.md');
      expect(result).toBeNull();
    });
  });

  // D10: HEARTBEAT.md 不存在时优雅跳过
  it('HEARTBEAT.md 不存在 → skipped=true, reason=file_not_found', async () => {
    const result = await runHeartbeatInspection(mockPool, {
      heartbeatPath: '/tmp/nonexistent-heartbeat-test.md',
    });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('file_not_found');
    expect(mockCallLLM).not.toHaveBeenCalled();
  });

  // D3: collectSystemSnapshot
  describe('collectSystemSnapshot', () => {
    it('并行查询 5 张表返回结构化快照（含 active_goals）', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ status: 'in_progress', count: 3 }, { status: 'queued', count: 5 }] })
        .mockResolvedValueOnce({ rows: [{ event_type: 'tick', count: 100 }] })
        .mockResolvedValueOnce({ rows: [{ count: 2 }] })
        .mockResolvedValueOnce({ rows: [{ title: 'KR1', progress: 50 }] })
        .mockResolvedValueOnce({ rows: [{ count: 4 }] });

      const snapshot = await collectSystemSnapshot(mockPool);

      expect(mockPool.query).toHaveBeenCalledTimes(5);
      expect(snapshot.tasks_in_progress).toBe(3);
      expect(snapshot.tasks_queued).toBe(5);
      expect(snapshot.tasks_failed).toBe(0);
      expect(snapshot.pending_proposals).toBe(2);
      expect(snapshot.active_okrs).toEqual([{ title: 'KR1', progress: 50 }]);
      expect(snapshot.active_goals).toBe(4);
      expect(typeof snapshot.current_hour).toBe('number');
      expect(typeof snapshot.day_of_week).toBe('number');
    });

    it('active_goals 数据缺失时降级为 0', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const snapshot = await collectSystemSnapshot(mockPool);
      expect(snapshot.active_goals).toBe(0);
    });

    it('SQL 查询包含正确的表名和条件（含 objectives）', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });
      await collectSystemSnapshot(mockPool);

      const calls = mockPool.query.mock.calls.map(c => c[0]);
      expect(calls[0]).toContain('tasks');
      expect(calls[0]).toContain('in_progress');
      expect(calls[1]).toContain('cecelia_events');
      expect(calls[1]).toContain('24 hours');
      expect(calls[2]).toContain('pending_actions');
      expect(calls[2]).toContain('pending_approval');
      expect(calls[3]).toContain('key_results');
      expect(calls[3]).toContain('in_progress');
      expect(calls[4]).toContain('objectives');
      expect(calls[4]).toContain("status = 'in_progress'");
    });

    it('cecelia_events 查询使用 event_type 列名（不是 type）', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });
      await collectSystemSnapshot(mockPool);

      const eventsQuery = mockPool.query.mock.calls[1][0];
      expect(eventsQuery).toContain('event_type');
      expect(eventsQuery).not.toMatch(/SELECT\s+type\b/);
    });
  });

  // D4: buildHeartbeatPrompt
  describe('buildHeartbeatPrompt', () => {
    it('prompt 包含 HEARTBEAT.md 内容和系统快照', () => {
      const snapshot = {
        tasks_in_progress: 3,
        tasks_queued: 5,
        tasks_failed: 1,
        pending_proposals: 2,
        current_hour: 10,
        day_of_week: 1,
        active_okrs: [{ title: 'KR1', progress: 50 }],
        active_goals: 2,
        top_events_24h: [{ event_type: 'tick', count: 100 }],
      };
      const prompt = buildHeartbeatPrompt('# 检查清单\n- 检查任务', snapshot);

      expect(prompt).toContain('# 检查清单');
      expect(prompt).toContain('检查任务');
      expect(prompt).toContain('进行中任务: 3');
      expect(prompt).toContain('排队任务: 5');
      expect(prompt).toContain('失败任务: 1');
      expect(prompt).toContain('待处理提案: 2');
      expect(prompt).toContain('星期一');
      expect(prompt).toContain('KR1(50%)');
      expect(prompt).toContain('tick:100');
      expect(prompt).toContain('active_goals): 2');
      expect(prompt).toContain('自主权边界');
      expect(prompt).toContain('no_action');
    });

    it('active_goals=0 时 prompt 含方向性崩溃先兆标记', () => {
      const snapshot = {
        tasks_in_progress: 0,
        tasks_queued: 0,
        tasks_failed: 0,
        pending_proposals: 0,
        current_hour: 10,
        day_of_week: 1,
        active_okrs: [],
        active_goals: 0,
        top_events_24h: [],
      };
      const prompt = buildHeartbeatPrompt('check', snapshot);
      expect(prompt).toContain('active_goals): 0');
      expect(prompt).toContain('方向性崩溃先兆');
    });
  });

  // D4 补充：parseHeartbeatResponse
  describe('parseHeartbeatResponse', () => {
    it('解析 code block 中的 JSON', () => {
      const result = parseHeartbeatResponse('```json\n{"action": "no_action"}\n```');
      expect(result).toEqual({ action: 'no_action' });
    });

    it('解析裸 JSON', () => {
      const result = parseHeartbeatResponse('{"action": "no_action", "rationale": "ok"}');
      expect(result).toEqual({ action: 'no_action', rationale: 'ok' });
    });

    it('无效 JSON 返回 null', () => {
      const result = parseHeartbeatResponse('这不是 JSON');
      expect(result).toBeNull();
    });
  });

  // D9: no_action 静默返回
  it('L1 返回 no_action → actions_count=0, 不调用 executeDecision', async () => {
    mockCallLLM.mockResolvedValueOnce({
      text: '```json\n{"action": "no_action", "rationale": "一切正常"}\n```',
    });

    // mock snapshot queries (5: tasks/events/proposals/focus/objectives)
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: 3 }] });

    const result = await runHeartbeatInspection(mockPool, {
      heartbeatPath: new URL('../../../HEARTBEAT.md', import.meta.url).pathname,
    });

    expect(result.skipped).toBe(false);
    expect(result.actions_count).toBe(0);
    expect(mockExecuteDecision).not.toHaveBeenCalled();
  });

  // callLLM 超时参数验证
  it('callLLM 被调用时传入 thalamus + 90s 超时参数', async () => {
    mockCallLLM.mockResolvedValueOnce({
      text: '{"action": "no_action", "rationale": "ok"}',
      model: 'test', provider: 'test', elapsed_ms: 10,
    });

    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: 3 }] });

    await runHeartbeatInspection(mockPool, {
      heartbeatPath: new URL('../../../HEARTBEAT.md', import.meta.url).pathname,
    });

    expect(mockCallLLM).toHaveBeenCalledTimes(1);
    expect(mockCallLLM).toHaveBeenCalledWith(
      'thalamus',
      expect.any(String),
      { timeout: 90000 },
    );
  });

  // D7: executeDecision 调用参数验证
  it('L1 返回 heartbeat_finding → 调用 executeDecision(source=heartbeat_inspection)', async () => {
    mockCallLLM.mockResolvedValueOnce({
      text: '```json\n{"actions": [{"type": "heartbeat_finding", "params": {"msg": "任务卡住"}}], "rationale": "发现问题"}\n```',
    });

    // mock snapshot queries (5) + event INSERT (1)
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: 3 }] })
      .mockResolvedValueOnce({ rows: [] }); // INSERT cecelia_events

    mockExecuteDecision.mockResolvedValueOnce({});

    const result = await runHeartbeatInspection(mockPool, {
      heartbeatPath: new URL('../../../HEARTBEAT.md', import.meta.url).pathname,
    });

    expect(result.skipped).toBe(false);
    expect(result.actions_count).toBe(1);
    expect(mockExecuteDecision).toHaveBeenCalledTimes(1);
    expect(mockExecuteDecision).toHaveBeenCalledWith(
      { action: 'heartbeat_finding', params: { msg: '任务卡住' } },
      expect.objectContaining({ source: 'heartbeat_inspection' }),
    );
  });

  // D8: cecelia_events 记录
  it('巡检完成后记录 cecelia_events (type=heartbeat_inspection)', async () => {
    mockCallLLM.mockResolvedValueOnce({
      text: '{"actions": [{"type": "heartbeat_finding", "params": {}}], "rationale": "test"}',
    });
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: 3 }] })
      .mockResolvedValueOnce({ rows: [] }); // INSERT

    mockExecuteDecision.mockResolvedValueOnce({});

    await runHeartbeatInspection(mockPool, {
      heartbeatPath: new URL('../../../HEARTBEAT.md', import.meta.url).pathname,
    });

    // 最后一个 query 调用应该是 INSERT INTO cecelia_events
    const lastCall = mockPool.query.mock.calls[mockPool.query.mock.calls.length - 1];
    expect(lastCall[0]).toContain('INSERT INTO cecelia_events');
    expect(lastCall[0]).toContain('event_type');
    expect(lastCall[0]).not.toMatch(/\(type,/);
    expect(lastCall[0]).toContain('heartbeat_inspection');
    const payload = JSON.parse(lastCall[1][0]);
    expect(payload.actions_count).toBe(1);
  });

  // LLM 响应解析失败
  it('LLM 返回无法解析的内容 → skipped=true, reason=parse_error', async () => {
    mockCallLLM.mockResolvedValueOnce({ text: '这不是JSON格式的回复' });

    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: 3 }] });

    const result = await runHeartbeatInspection(mockPool, {
      heartbeatPath: new URL('../../../HEARTBEAT.md', import.meta.url).pathname,
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('parse_error');
  });

  // active_goals=0 P0 告警（Cortex Insight ec71a550）
  describe('active_goals=0 P0 告警', () => {
    it('active_goals=0 → 立即触发 P0 告警 (heartbeat_active_goals_zero)', async () => {
      mockCallLLM.mockResolvedValueOnce({
        text: '{"action": "no_action", "rationale": "ok"}',
      });
      // 5 snapshot queries：第 5 个 objectives 计数为 0
      mockPool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ count: 0 }] });

      await runHeartbeatInspection(mockPool, {
        heartbeatPath: new URL('../../../HEARTBEAT.md', import.meta.url).pathname,
      });

      expect(mockRaiseAlert).toHaveBeenCalledTimes(1);
      const [level, eventType, message] = mockRaiseAlert.mock.calls[0];
      expect(level).toBe('P0');
      expect(eventType).toBe('heartbeat_active_goals_zero');
      expect(message).toMatch(/active_goals=0/);
    });

    it('active_goals>0 → 不触发告警', async () => {
      mockCallLLM.mockResolvedValueOnce({
        text: '{"action": "no_action", "rationale": "ok"}',
      });
      mockPool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ count: 2 }] });

      await runHeartbeatInspection(mockPool, {
        heartbeatPath: new URL('../../../HEARTBEAT.md', import.meta.url).pathname,
      });

      expect(mockRaiseAlert).not.toHaveBeenCalled();
    });

    it('告警函数抛异常时不阻塞巡检主流程（非致命）', async () => {
      mockRaiseAlert.mockRejectedValueOnce(new Error('feishu down'));
      mockCallLLM.mockResolvedValueOnce({
        text: '{"action": "no_action", "rationale": "ok"}',
      });
      mockPool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ count: 0 }] });

      const result = await runHeartbeatInspection(mockPool, {
        heartbeatPath: new URL('../../../HEARTBEAT.md', import.meta.url).pathname,
      });

      // 告警失败不阻塞，巡检仍走完 LLM 流程
      expect(mockRaiseAlert).toHaveBeenCalledTimes(1);
      expect(mockCallLLM).toHaveBeenCalledTimes(1);
      expect(result.skipped).toBe(false);
    });
  });

  // 闭环契约：active_goals=0 P0 告警的所有相关 Cortex Insight learning_id
  // 必须在 heartbeat-inspector.js 源码中显式登记，
  // 防止 Cortex 反复派发同一类 insight 修复任务
  // （重复识别 e41acc59、c17fae35 已分别发生 1 次、2 次）。
  describe('Cortex Insight learning_id 登记契约', () => {
    it('heartbeat-inspector.js 源码同时引用 ec71a550 与 e41acc59 两个 learning_id', async () => {
      const { readFileSync } = await import('fs');
      const inspectorPath = new URL('../heartbeat-inspector.js', import.meta.url).pathname;
      const src = readFileSync(inspectorPath, 'utf-8');
      expect(src).toMatch(/ec71a550/);
      expect(src).toMatch(/e41acc59/);
    });

    it('heartbeat-inspector.js 源码登记第三次重复识别 learning_id c17fae35', async () => {
      const { readFileSync } = await import('fs');
      const inspectorPath = new URL('../heartbeat-inspector.js', import.meta.url).pathname;
      const src = readFileSync(inspectorPath, 'utf-8');
      expect(src).toMatch(/c17fae35/);
    });
  });
});
