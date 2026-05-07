import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock 依赖 ────────────────────────────────────────────────────────────────

const mockCallLLM = vi.hoisted(() => vi.fn());
const mockUpdateSelfModel = vi.hoisted(() => vi.fn());

vi.mock('../llm-caller.js', () => ({ callLLM: mockCallLLM }));
vi.mock('../self-model.js', () => ({ updateSelfModel: mockUpdateSelfModel }));

import {
  shouldRunConsolidation,
  hasTodayConsolidation,
  runDailyConsolidation,
  runDailyConsolidationIfNeeded,
  shouldRunByElapsed,
} from '../consolidation.js';

// ─── Helper: mock pool ────────────────────────────────────────────────────────

function makeMockPool(overrides = {}) {
  const queryMock = vi.fn();
  const pool = { query: queryMock };

  // 默认：所有 query 返回空
  queryMock.mockResolvedValue({ rows: [] });

  if (overrides.hasTodayConsolidation !== undefined) {
    // hasTodayConsolidation: SELECT id FROM daily_logs
    queryMock.mockImplementationOnce(() =>
      Promise.resolve({
        rows: overrides.hasTodayConsolidation ? [{ id: 1 }] : [],
      })
    );
  }

  return { pool, queryMock };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('shouldRunConsolidation', () => {
  it('时间在 4h 周期窗口内（UTC 00:02）返回 true', () => {
    const now = new Date('2026-03-02T00:02:00.000Z'); // 0 % 4 = 0, min=2 < 5
    expect(shouldRunConsolidation(now)).toBe(true);
  });

  it('时间在 4h 周期窗口内（UTC 08:03）返回 true', () => {
    const now = new Date('2026-03-02T08:03:00.000Z'); // 8 % 4 = 0, min=3 < 5
    expect(shouldRunConsolidation(now)).toBe(true);
  });

  it('时间在窗口外（UTC 10:00）返回 false', () => {
    const now = new Date('2026-03-02T10:00:00.000Z'); // 10 % 4 = 2 ≠ 0
    expect(shouldRunConsolidation(now)).toBe(false);
  });

  it('时间窗口边界：UTC 04:05 返回 false', () => {
    const now = new Date('2026-03-02T04:05:00.000Z'); // 4 % 4 = 0 但 min=5 >= 5
    expect(shouldRunConsolidation(now)).toBe(false);
  });
});

describe('hasTodayConsolidation', () => {
  it('今日无记录返回 false', async () => {
    const { pool } = makeMockPool({ hasTodayConsolidation: false });
    expect(await hasTodayConsolidation(pool)).toBe(false);
  });

  it('今日有记录返回 true', async () => {
    const { pool } = makeMockPool({ hasTodayConsolidation: true });
    expect(await hasTodayConsolidation(pool)).toBe(true);
  });
});

describe('runDailyConsolidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCallLLM.mockResolvedValue(
      '{"date":"2026-03-02","key_events":["test"],"new_learnings":[],"completed_goals":[],"mood_trajectory":"平稳","self_model_delta":{"insight":"今日有所进展"}}'
    );
    mockUpdateSelfModel.mockResolvedValue('ok');
  });

  it('今日已合并时跳过（不带 forceRun）', async () => {
    const { pool, queryMock } = makeMockPool();
    // hasTodayConsolidation = true
    queryMock.mockResolvedValueOnce({ rows: [{ id: 1 }] });

    const result = await runDailyConsolidation(pool);
    expect(result.skipped).toBe(true);
    expect(mockCallLLM).not.toHaveBeenCalled();
  });

  it('forceRun=true 跳过防重复检查', async () => {
    const { pool, queryMock } = makeMockPool();
    // hasTodayConsolidation query (skipped due to forceRun)
    // gatherTodayData: 3 queries (memories, learnings, tasks)
    queryMock.mockResolvedValue({ rows: [] }); // all queries return empty
    // empty data case
    const result = await runDailyConsolidation(pool, { forceRun: true });
    expect(result.empty).toBe(true);
  });

  it('有数据时调用 LLM 并写入 memory_stream', async () => {
    const { pool, queryMock } = makeMockPool();
    // hasTodayConsolidation = false
    queryMock.mockResolvedValueOnce({ rows: [] });
    // gatherTodayData: memories
    queryMock.mockResolvedValueOnce({ rows: [{ content: '对话内容', source_type: 'feishu_chat', importance: 5, created_at: new Date() }] });
    // learnings
    queryMock.mockResolvedValueOnce({ rows: [{ title: '洞察', content: '内容', category: 'code' }] });
    // tasks
    queryMock.mockResolvedValueOnce({ rows: [{ title: '完成任务', task_type: 'dev', status: 'completed', ended_at: new Date() }] });
    // INSERT memory_stream
    queryMock.mockResolvedValueOnce({ rows: [] });
    // updateSelfModel 内部 getSelfModel query
    queryMock.mockResolvedValueOnce({ rows: [{ content: 'seed' }] });
    // updateSelfModel INSERT
    queryMock.mockResolvedValueOnce({ rows: [] });
    // markConsolidationDone: SELECT + INSERT
    queryMock.mockResolvedValueOnce({ rows: [] }); // no existing
    queryMock.mockResolvedValueOnce({ rows: [] }); // insert

    const result = await runDailyConsolidation(pool);
    expect(result.done).toBe(true);
    expect(mockCallLLM).toHaveBeenCalledWith('cortex', expect.stringContaining('今日'), expect.any(Object));
    // memory_stream 写入
    const insertCall = queryMock.mock.calls.find(c => String(c[0]).includes('daily_consolidation'));
    expect(insertCall).toBeTruthy();
  });

  it('LLM 调用失败时仍完成合并（graceful fallback）', async () => {
    mockCallLLM.mockRejectedValue(new Error('LLM error'));
    const { pool, queryMock } = makeMockPool();
    // hasTodayConsolidation = false
    queryMock.mockResolvedValueOnce({ rows: [] });
    // memories
    queryMock.mockResolvedValueOnce({ rows: [{ content: 'x', source_type: 'orchestrator_chat', importance: 5, created_at: new Date() }] });
    // learnings
    queryMock.mockResolvedValueOnce({ rows: [] });
    // tasks
    queryMock.mockResolvedValueOnce({ rows: [] });
    // INSERT memory_stream (fallback summary)
    queryMock.mockResolvedValueOnce({ rows: [] });
    // markConsolidationDone: SELECT + INSERT
    queryMock.mockResolvedValueOnce({ rows: [] });
    queryMock.mockResolvedValueOnce({ rows: [] });

    const result = await runDailyConsolidation(pool);
    expect(result.done).toBe(true);
    expect(result.summary.note).toContain('LLM');
  });

  it('self_model_delta.insight 不存在时不调用 updateSelfModel', async () => {
    mockCallLLM.mockResolvedValue(
      '{"date":"2026-03-02","key_events":[],"new_learnings":[],"completed_goals":[],"mood_trajectory":"平稳","self_model_delta":{}}'
    );
    const { pool, queryMock } = makeMockPool();
    queryMock.mockResolvedValueOnce({ rows: [] }); // hasTodayConsolidation
    queryMock.mockResolvedValueOnce({ rows: [{ content: 'x', source_type: 'feishu_chat', importance: 5, created_at: new Date() }] });
    queryMock.mockResolvedValueOnce({ rows: [] });
    queryMock.mockResolvedValueOnce({ rows: [] });
    queryMock.mockResolvedValueOnce({ rows: [] }); // INSERT memory_stream
    queryMock.mockResolvedValueOnce({ rows: [] }); // markConsolidationDone SELECT
    queryMock.mockResolvedValueOnce({ rows: [] }); // markConsolidationDone INSERT

    await runDailyConsolidation(pool);
    expect(mockUpdateSelfModel).not.toHaveBeenCalled();
  });
});

describe('shouldRunByElapsed', () => {
  it('从未运行（last_run=null）返回 shouldRun=true reason=never_run', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ last_run: null }] }) };
    const result = await shouldRunByElapsed(pool, new Date('2026-05-07T03:30:00Z'), 4);
    expect(result.shouldRun).toBe(true);
    expect(result.reason).toBe('never_run');
  });

  it('上次运行 5 小时前 + 间隔 4h → shouldRun=true reason=elapsed', async () => {
    const lastRun = new Date('2026-05-07T00:00:00Z');
    const now = new Date('2026-05-07T05:00:00Z');
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ last_run: lastRun }] }) };
    const result = await shouldRunByElapsed(pool, now, 4);
    expect(result.shouldRun).toBe(true);
    expect(result.reason).toBe('elapsed');
  });

  it('上次运行 1 小时前 + 间隔 4h → shouldRun=false reason=too_soon', async () => {
    const lastRun = new Date('2026-05-07T04:00:00Z');
    const now = new Date('2026-05-07T05:00:00Z');
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ last_run: lastRun }] }) };
    const result = await shouldRunByElapsed(pool, now, 4);
    expect(result.shouldRun).toBe(false);
    expect(result.reason).toBe('too_soon');
  });

  it('查询 memory_stream 而非 daily_logs（与 capability-probe 同源）', async () => {
    const queryMock = vi.fn().mockResolvedValue({ rows: [{ last_run: null }] });
    const pool = { query: queryMock };
    await shouldRunByElapsed(pool, new Date(), 4);
    const sql = String(queryMock.mock.calls[0][0]);
    expect(sql).toMatch(/memory_stream/);
    expect(sql).toMatch(/daily_consolidation/);
  });
});

describe('runDailyConsolidationIfNeeded — elapsed gating (regression: PROBE_FAIL_CONSOLIDATION)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCallLLM.mockResolvedValue(
      '{"date":"2026-05-07","key_events":[],"new_learnings":[],"completed_goals":[],"mood_trajectory":"平稳","self_model_delta":{}}'
    );
  });

  it('memory_stream 无 daily_consolidation 记录时（last_run=never）应执行而非按窄时间窗口跳过', async () => {
    // 复现 PROBE_FAIL_CONSOLIDATION 故障：48h_consolidations=0 last_run=never
    // 旧逻辑：当前不在 UTC 0/4/8/12/16/20 时段前 5 分钟 → shouldRunConsolidation()=false
    //        → 直接 skipped:'outside time window' → 永远不会自愈
    // 新逻辑：基于 memory_stream 中实际 last_run 的 elapsed 判断 → 从未运行时立即执行
    const queryMock = vi.fn();
    // 1. shouldRunByElapsed → memory_stream max(created_at) → null
    queryMock.mockResolvedValueOnce({ rows: [{ last_run: null }] });
    // 2-4. gatherTodayData: memories / learnings / tasks
    queryMock.mockResolvedValueOnce({ rows: [] });
    queryMock.mockResolvedValueOnce({ rows: [] });
    queryMock.mockResolvedValueOnce({ rows: [] });
    // 5-7. markConsolidationDone (empty path: SELECT + INSERT — empty also writes daily_logs)
    queryMock.mockResolvedValueOnce({ rows: [] });
    queryMock.mockResolvedValueOnce({ rows: [] });

    const pool = { query: queryMock };

    // 注入一个明显在旧窄时间窗口外的"现在"（UTC 03:30 — 旧逻辑会 skipped:'outside time window'）
    const nowOutsideOldWindow = new Date('2026-05-07T03:30:00Z');

    const result = await runDailyConsolidationIfNeeded(pool, nowOutsideOldWindow);

    // 关键断言：不再因"窗口外"被跳过
    expect(result.reason).not.toBe('outside time window');
    // 实际进入了 runDailyConsolidation（empty 路径 — 没今日数据）
    expect(result.empty).toBe(true);
  });

  it('上次运行不久（too_soon）则跳过', async () => {
    const queryMock = vi.fn();
    const recentRun = new Date('2026-05-07T03:00:00Z');
    queryMock.mockResolvedValueOnce({ rows: [{ last_run: recentRun }] });
    const pool = { query: queryMock };

    const result = await runDailyConsolidationIfNeeded(pool, new Date('2026-05-07T03:30:00Z'));
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('too_soon');
    // 没继续触发 LLM
    expect(mockCallLLM).not.toHaveBeenCalled();
  });
});
