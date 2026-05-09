import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock 依赖 ────────────────────────────────────────────────────────────────

const mockCallLLM = vi.hoisted(() => vi.fn());
const mockUpdateSelfModel = vi.hoisted(() => vi.fn());

vi.mock('../llm-caller.js', () => ({ callLLM: mockCallLLM }));
vi.mock('../self-model.js', () => ({ updateSelfModel: mockUpdateSelfModel }));

import {
  shouldRunConsolidation,
  shouldRunByElapsed,
  hasTodayConsolidation,
  runDailyConsolidation,
  runDailyConsolidationIfNeeded,
} from '../consolidation.js';

// ─── Helper: mock pool ────────────────────────────────────────────────────────

function makeMockPool() {
  const queryMock = vi.fn();
  // 默认所有 query 返回空 — 单独测试用 mockResolvedValueOnce 按调用顺序覆盖
  queryMock.mockResolvedValue({ rows: [] });
  return { pool: { query: queryMock }, queryMock };
}

// 模拟 shouldRunByElapsed 第一次查询（SELECT max(created_at) FROM memory_stream ...）
function mockElapsedQuery(queryMock, lastRun) {
  queryMock.mockResolvedValueOnce({ rows: [{ last_run: lastRun }] });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('shouldRunConsolidation (deprecated 旧时间窗口闸门)', () => {
  it('UTC 00:02 在窗口内返回 true', () => {
    expect(shouldRunConsolidation(new Date('2026-03-02T00:02:00.000Z'))).toBe(true);
  });

  it('UTC 10:00 在窗口外返回 false', () => {
    expect(shouldRunConsolidation(new Date('2026-03-02T10:00:00.000Z'))).toBe(false);
  });
});

describe('shouldRunByElapsed (新闸门)', () => {
  it('从未合并过 → shouldRun=true reason=never_run', async () => {
    const { pool, queryMock } = makeMockPool();
    mockElapsedQuery(queryMock, null);
    const result = await shouldRunByElapsed(pool);
    expect(result.shouldRun).toBe(true);
    expect(result.reason).toBe('never_run');
    expect(result.last_run).toBeNull();
  });

  it('距上次合并 ≥ intervalHours → shouldRun=true reason=elapsed', async () => {
    const { pool, queryMock } = makeMockPool();
    const now = new Date('2026-03-02T12:00:00.000Z');
    const lastRun = new Date('2026-03-02T07:00:00.000Z'); // 5h ago，超 4h 阈值
    mockElapsedQuery(queryMock, lastRun);
    const result = await shouldRunByElapsed(pool, now, 4);
    expect(result.shouldRun).toBe(true);
    expect(result.reason).toBe('elapsed');
    expect(result.hours_elapsed).toBeCloseTo(5, 1);
  });

  it('距上次合并 < intervalHours → shouldRun=false reason=too_soon', async () => {
    const { pool, queryMock } = makeMockPool();
    const now = new Date('2026-03-02T12:00:00.000Z');
    const lastRun = new Date('2026-03-02T10:00:00.000Z'); // 2h ago，未到 4h
    mockElapsedQuery(queryMock, lastRun);
    const result = await shouldRunByElapsed(pool, now, 4);
    expect(result.shouldRun).toBe(false);
    expect(result.reason).toBe('too_soon');
    expect(result.hours_elapsed).toBeCloseTo(2, 1);
  });
});

describe('hasTodayConsolidation (deprecated)', () => {
  it('今日无记录返回 false', async () => {
    const { pool, queryMock } = makeMockPool();
    queryMock.mockResolvedValueOnce({ rows: [] });
    expect(await hasTodayConsolidation(pool)).toBe(false);
  });

  it('今日有记录返回 true', async () => {
    const { pool, queryMock } = makeMockPool();
    queryMock.mockResolvedValueOnce({ rows: [{ id: 1 }] });
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

  it('too_soon 时跳过（不带 forceRun）', async () => {
    const { pool, queryMock } = makeMockPool();
    // shouldRunByElapsed: last_run 1 小时前 → too_soon
    mockElapsedQuery(queryMock, new Date(Date.now() - 60 * 60 * 1000));

    const result = await runDailyConsolidation(pool);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('too_soon');
    expect(mockCallLLM).not.toHaveBeenCalled();
  });

  it('forceRun=true 跳过防重复检查（不查 shouldRunByElapsed）', async () => {
    const { pool, queryMock } = makeMockPool();
    // 不 mock shouldRunByElapsed query — forceRun=true 路径直接进入
    // gatherTodayData: 3 queries (memories, learnings, tasks) 全空
    queryMock.mockResolvedValue({ rows: [] });
    const result = await runDailyConsolidation(pool, { forceRun: true });
    expect(result.empty).toBe(true);
  });

  it('空合并日也写入 memory_stream（PROBE_FAIL_CONSOLIDATION 跨日 0 误报回归）', async () => {
    const { pool, queryMock } = makeMockPool();
    // 1. shouldRunByElapsed: never_run
    mockElapsedQuery(queryMock, null);
    // 2-4. gatherTodayData: memories/learnings/tasks 全空
    queryMock.mockResolvedValueOnce({ rows: [] });
    queryMock.mockResolvedValueOnce({ rows: [] });
    queryMock.mockResolvedValueOnce({ rows: [] });
    // 5. INSERT memory_stream (空合并 — #2825 修复，必须保留)
    queryMock.mockResolvedValueOnce({ rows: [] });
    // 6-7. markConsolidationDone: SELECT + INSERT
    queryMock.mockResolvedValueOnce({ rows: [] });
    queryMock.mockResolvedValueOnce({ rows: [] });

    const result = await runDailyConsolidation(pool);
    expect(result.empty).toBe(true);

    // 必须写入 memory_stream（importance=3，source_type=daily_consolidation）
    const memCall = queryMock.mock.calls.find(
      c => String(c[0]).includes('INSERT INTO memory_stream') && String(c[0]).includes('daily_consolidation')
    );
    expect(memCall).toBeTruthy();
    expect(memCall[1][0]).toContain('"empty":true');
    expect(mockCallLLM).not.toHaveBeenCalled();
  });

  it('有数据时调用 LLM 并写入 memory_stream', async () => {
    const { pool, queryMock } = makeMockPool();
    // shouldRunByElapsed: never_run
    mockElapsedQuery(queryMock, null);
    // gatherTodayData
    queryMock.mockResolvedValueOnce({ rows: [{ content: '对话内容', source_type: 'feishu_chat', importance: 5, created_at: new Date() }] });
    queryMock.mockResolvedValueOnce({ rows: [{ title: '洞察', content: '内容', category: 'code' }] });
    queryMock.mockResolvedValueOnce({ rows: [{ title: '完成任务', task_type: 'dev', status: 'completed', ended_at: new Date() }] });
    // INSERT memory_stream
    queryMock.mockResolvedValueOnce({ rows: [] });
    // updateSelfModel 内部
    queryMock.mockResolvedValueOnce({ rows: [{ content: 'seed' }] });
    queryMock.mockResolvedValueOnce({ rows: [] });
    // markConsolidationDone
    queryMock.mockResolvedValueOnce({ rows: [] });
    queryMock.mockResolvedValueOnce({ rows: [] });

    const result = await runDailyConsolidation(pool);
    expect(result.done).toBe(true);
    expect(mockCallLLM).toHaveBeenCalledWith('cortex', expect.stringContaining('今日'), expect.any(Object));
    const insertCall = queryMock.mock.calls.find(c => String(c[0]).includes('daily_consolidation'));
    expect(insertCall).toBeTruthy();
  });

  it('LLM 调用失败时仍完成合并（graceful fallback）', async () => {
    mockCallLLM.mockRejectedValue(new Error('LLM error'));
    const { pool, queryMock } = makeMockPool();
    mockElapsedQuery(queryMock, null);
    queryMock.mockResolvedValueOnce({ rows: [{ content: 'x', source_type: 'orchestrator_chat', importance: 5, created_at: new Date() }] });
    queryMock.mockResolvedValueOnce({ rows: [] });
    queryMock.mockResolvedValueOnce({ rows: [] });
    queryMock.mockResolvedValueOnce({ rows: [] });
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
    mockElapsedQuery(queryMock, null);
    queryMock.mockResolvedValueOnce({ rows: [{ content: 'x', source_type: 'feishu_chat', importance: 5, created_at: new Date() }] });
    queryMock.mockResolvedValueOnce({ rows: [] });
    queryMock.mockResolvedValueOnce({ rows: [] });
    queryMock.mockResolvedValueOnce({ rows: [] });
    queryMock.mockResolvedValueOnce({ rows: [] });
    queryMock.mockResolvedValueOnce({ rows: [] });

    await runDailyConsolidation(pool);
    expect(mockUpdateSelfModel).not.toHaveBeenCalled();
  });
});

describe('runDailyConsolidationIfNeeded', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCallLLM.mockResolvedValue(
      '{"date":"2026-03-02","key_events":[],"new_learnings":[],"completed_goals":[],"mood_trajectory":"平稳","self_model_delta":{}}'
    );
  });

  it('last_run=null（never_run）时执行合并而非"outside time window"', async () => {
    const { pool, queryMock } = makeMockPool();
    // shouldRunByElapsed in IfNeeded
    mockElapsedQuery(queryMock, null);
    // shouldRunByElapsed inside runDailyConsolidation
    mockElapsedQuery(queryMock, null);
    // gatherTodayData 全空 → 空合并路径
    queryMock.mockResolvedValueOnce({ rows: [] });
    queryMock.mockResolvedValueOnce({ rows: [] });
    queryMock.mockResolvedValueOnce({ rows: [] });
    // INSERT memory_stream
    queryMock.mockResolvedValueOnce({ rows: [] });
    // markConsolidationDone
    queryMock.mockResolvedValueOnce({ rows: [] });
    queryMock.mockResolvedValueOnce({ rows: [] });

    const result = await runDailyConsolidationIfNeeded(pool);
    expect(result.skipped).toBeFalsy();
    expect(result.empty).toBe(true);
  });

  it('too_soon 时跳过且不查 gatherTodayData', async () => {
    const { pool, queryMock } = makeMockPool();
    const now = new Date('2026-03-02T12:00:00.000Z');
    mockElapsedQuery(queryMock, new Date('2026-03-02T11:00:00.000Z')); // 1h ago

    const result = await runDailyConsolidationIfNeeded(pool, now);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('too_soon');
    // 只调用了 1 次 query（shouldRunByElapsed），没去 gather/insert
    expect(queryMock).toHaveBeenCalledTimes(1);
  });
});
