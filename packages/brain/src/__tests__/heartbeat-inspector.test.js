/**
 * Heartbeat Inspector 主流程测试
 * 覆盖：D1, D2, D3, D4, D7, D8, D9, D10
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPool, mockCallLLM, mockExecuteDecision } = vi.hoisted(() => ({
  mockPool: { query: vi.fn() },
  mockCallLLM: vi.fn(),
  mockExecuteDecision: vi.fn(),
}));

vi.mock('../db.js', () => ({ default: mockPool }));
vi.mock('../llm-caller.js', () => ({
  callLLM: (...args) => mockCallLLM(...args),
}));
vi.mock('../decision-executor.js', () => ({
  executeDecision: (...args) => mockExecuteDecision(...args),
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
        .mockResolvedValueOnce({ rows: [{ cnt: 4 }] });

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

    it('SQL 查询包含正确的表名和条件', async () => {
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
      expect(calls[4]).toContain('in_progress');
    });

    it('objectives 行为空时 active_goals=0', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });
      const snapshot = await collectSystemSnapshot(mockPool);
      expect(snapshot.active_goals).toBe(0);
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
        top_events_24h: [{ event_type: 'tick', count: 100 }],
        active_goals: 2,
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
      expect(prompt).toContain('自主权边界');
      expect(prompt).toContain('no_action');
      expect(prompt).toContain('活跃目标: 2');
    });

    it('active_goals=0 prompt 含方向性崩溃前置信号告警标语', () => {
      const snapshot = {
        tasks_in_progress: 0,
        tasks_queued: 0,
        tasks_failed: 0,
        pending_proposals: 0,
        current_hour: 9,
        day_of_week: 2,
        active_okrs: [],
        top_events_24h: [],
        active_goals: 0,
      };
      const prompt = buildHeartbeatPrompt('# 清单', snapshot);
      expect(prompt).toContain('活跃目标: 0');
      expect(prompt).toContain('方向性崩溃');
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

    // mock snapshot queries（5：含 active_goals 非零，避免触发告警 INSERT）
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ cnt: 5 }] });

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
      .mockResolvedValueOnce({ rows: [{ cnt: 5 }] });

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
      .mockResolvedValueOnce({ rows: [{ cnt: 5 }] })
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
      .mockResolvedValueOnce({ rows: [{ cnt: 5 }] })
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
      .mockResolvedValueOnce({ rows: [{ cnt: 5 }] });

    const result = await runHeartbeatInspection(mockPool, {
      heartbeatPath: new URL('../../../HEARTBEAT.md', import.meta.url).pathname,
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('parse_error');
  });

  // active_goals=0 告警（PRD：方向性崩溃前置信号 → emit cecelia_event 告警）
  describe('active_goals=0 告警', () => {
    it('active_goals=0 → emit cecelia_event(active_goals_zero_alert)，独立于 LLM 决策', async () => {
      mockCallLLM.mockResolvedValueOnce({
        text: '{"action": "no_action", "rationale": "ok"}',
      });
      // 5 snapshot queries（active_goals=0）+ 告警 INSERT
      mockPool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ cnt: 0 }] })
        .mockResolvedValueOnce({ rows: [] }); // INSERT active_goals_zero_alert

      const result = await runHeartbeatInspection(mockPool, {
        heartbeatPath: new URL('../../../HEARTBEAT.md', import.meta.url).pathname,
      });

      expect(result.alert).toEqual(expect.objectContaining({
        type: 'active_goals_zero_alert',
        active_goals: 0,
      }));
      // 必须存在一次 INSERT INTO cecelia_events 且 event_type='active_goals_zero_alert'
      const insertCalls = mockPool.query.mock.calls.filter(c =>
        typeof c[0] === 'string' && c[0].includes('INSERT INTO cecelia_events'));
      const alertInsert = insertCalls.find(c => {
        const payload = c[1] && c[1][0] ? JSON.parse(c[1][0]) : {};
        return payload.alert_type === 'active_goals_zero_alert' || c[0].includes('active_goals_zero_alert');
      });
      expect(alertInsert).toBeTruthy();
    });

    it('active_goals>0 → 不 emit active_goals_zero_alert', async () => {
      mockCallLLM.mockResolvedValueOnce({
        text: '{"action": "no_action", "rationale": "ok"}',
      });
      mockPool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ cnt: 3 }] });

      const result = await runHeartbeatInspection(mockPool, {
        heartbeatPath: new URL('../../../HEARTBEAT.md', import.meta.url).pathname,
      });

      expect(result.alert).toBeFalsy();
      const insertCalls = mockPool.query.mock.calls.filter(c =>
        typeof c[0] === 'string' && c[0].includes('active_goals_zero_alert'));
      expect(insertCalls).toHaveLength(0);
    });
  });
});
