/**
 * rumination-fallback-context.test.js
 * P0 修复：NotebookLM fallback 时注入 synthesis_archive 历史上下文
 *
 * 覆盖：
 * - NotebookLM 失败 + synthesis_archive 有记录 → prompt 含历史上下文
 * - NotebookLM 失败 + synthesis_archive 无记录 → prompt 无历史上下文（graceful）
 * - NotebookLM 成功时 synthesis_archive fallback 查询不被触发（主路不变）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks（hoisted）──────────────────────────────────────

const mockQuery = vi.hoisted(() => vi.fn());
const mockCallLLM = vi.hoisted(() => vi.fn());
const mockBuildMemoryContext = vi.hoisted(() => vi.fn());
const mockQueryNotebook = vi.hoisted(() => vi.fn());
const mockAddTextSource = vi.hoisted(() => vi.fn());
const mockCreateTask = vi.hoisted(() => vi.fn());
const mockUpdateSelfModel = vi.hoisted(() => vi.fn());
const mockProcessEvent = vi.hoisted(() => vi.fn());

vi.mock('../db.js', () => ({ default: { query: mockQuery } }));
vi.mock('../llm-caller.js', () => ({ callLLM: mockCallLLM }));
vi.mock('../memory-retriever.js', () => ({ buildMemoryContext: mockBuildMemoryContext }));
vi.mock('../notebook-adapter.js', () => ({
  queryNotebook: mockQueryNotebook,
  addSource: vi.fn(),
  addTextSource: mockAddTextSource,
}));
vi.mock('../actions.js', () => ({ createTask: mockCreateTask }));
vi.mock('../self-model.js', () => ({ updateSelfModel: mockUpdateSelfModel }));
vi.mock('../thalamus.js', () => ({
  processEvent: mockProcessEvent,
  EVENT_TYPES: { RUMINATION_RESULT: 'rumination_result' },
}));

import { runRumination, _resetState } from '../rumination.js';

const pool = { query: mockQuery };

const sampleLearning = {
  id: 'l-fallback-1',
  title: '新架构模式',
  content: '微服务拆分经验',
  category: 'tech',
};

beforeEach(() => {
  vi.resetAllMocks();
  _resetState();
  mockCallLLM.mockResolvedValue({ text: 'fallback 洞察：系统优化方向' });
  mockBuildMemoryContext.mockResolvedValue({ block: '短期记忆上下文', meta: {} });
  mockAddTextSource.mockResolvedValue({ ok: true });
  mockCreateTask.mockResolvedValue({ success: true });
  mockUpdateSelfModel.mockResolvedValue('self-model-v2');
  mockProcessEvent.mockResolvedValue({
    level: 0, actions: [], rationale: 'ok', confidence: 0.8, safety: false,
  });
});

/**
 * DB 查询顺序（NotebookLM 失败 fallback 路径）：
 * 1. runRumination 入口 rumination_run 心跳 INSERT
 * 2. isSystemIdle → idle check
 * 3. learnings fetch (LIMIT MAX_PER_TICK)
 * 4. fetchMemoryStreamItems (1 < MAX_PER_TICK → 补充)
 * 5. digestLearnings 入口 rumination_digest_run 心跳 INSERT
 * 6. working_memory (notebook_id)
 * 7. synthesis_archive 历史查询（fallback 时）
 * 8+ remaining: dedup, memory_stream insert, cecelia_events, synthesis_archive write, digested update
 */
function setupForFallback(archiveRows) {
  mockQuery
    .mockResolvedValueOnce({ rows: [] })                                   // 1. rumination_run heartbeat INSERT
    .mockResolvedValueOnce({ rows: [{ in_progress: '0', queued: '0' }] }) // 2. idle check
    .mockResolvedValueOnce({ rows: [sampleLearning] })                     // 3. learnings query
    .mockResolvedValueOnce({ rows: [] })                                   // 4. fetchMemoryStreamItems (empty)
    .mockResolvedValueOnce({ rows: [] })                                   // 5. rumination_digest_run heartbeat INSERT
    .mockResolvedValueOnce({ rows: [] })                                   // 6. working_memory (no notebook_id)
    .mockResolvedValueOnce({ rows: archiveRows })                          // 7. synthesis_archive history
    .mockResolvedValue({ rows: [] });                                      // 8+. all remaining
}

// ── 测试 ─────────────────────────────────────────────────

describe('Rumination fallback — synthesis_archive 历史上下文注入（P0 修复）', () => {

  it('NotebookLM 主路失败 + synthesis_archive 有记录 → fallback prompt 含历史反刍上下文', async () => {
    mockQueryNotebook.mockRejectedValue(new Error('bridge connection refused'));

    setupForFallback([
      { content: '历史洞察A：数据库连接池需要动态扩缩容' },
      { content: '历史洞察B：异步任务队列监控不完善' },
    ]);

    const result = await runRumination(pool);

    expect(result.digested).toBe(1);

    // callLLM 第一次调用（洞察生成）的 prompt 必须包含历史上下文
    expect(mockCallLLM).toHaveBeenCalled();
    const promptArg = mockCallLLM.mock.calls[0][1];
    expect(promptArg).toContain('历史反刍上下文');
    expect(promptArg).toContain('历史洞察A：数据库连接池需要动态扩缩容');
  });

  it('NotebookLM 主路失败 + synthesis_archive 无记录 → fallback 无历史上下文（graceful）', async () => {
    mockQueryNotebook.mockRejectedValue(new Error('timeout'));

    setupForFallback([]); // 无历史记录

    const result = await runRumination(pool);

    expect(result.digested).toBe(1);

    // 无历史记录时 prompt 不含历史上下文区块
    expect(mockCallLLM).toHaveBeenCalled();
    const promptArg = mockCallLLM.mock.calls[0][1];
    expect(promptArg).not.toContain('历史反刍上下文');
  });

  it('NotebookLM 主路成功时，synthesis_archive fallback 查询不被触发（主路不变）', async () => {
    // text.length > 50 才被接受为有效响应（触发 notebooklm_primary 路径）
    mockQueryNotebook.mockResolvedValue({
      ok: true,
      text: 'NotebookLM 综合分析结果：过去反刍发现系统存在多处架构隐患，包括断链、孤岛、死循环等，建议按优先级修复。',
    });

    mockQuery
      .mockResolvedValueOnce({ rows: [] })                                   // 1. rumination_run heartbeat INSERT
      .mockResolvedValueOnce({ rows: [{ in_progress: '0', queued: '0' }] }) // 2. idle check
      .mockResolvedValueOnce({ rows: [sampleLearning] })                     // 3. learnings query
      .mockResolvedValueOnce({ rows: [] })                                   // 4. fetchMemoryStreamItems
      .mockResolvedValueOnce({ rows: [] })                                   // 5. rumination_digest_run heartbeat INSERT
      .mockResolvedValueOnce({ rows: [{ value_json: 'nb-id-123' }] })       // 6. working_memory (has notebook_id)
      .mockResolvedValue({ rows: [] });                                      // 7+. remaining (no fallback synthesis_archive)

    const result = await runRumination(pool);

    expect(result.digested).toBe(1);

    // 验证 synthesis_archive ORDER BY period_start DESC（fallback 特征查询）未被触发
    const queryCalls = mockQuery.mock.calls.map(c => c[0]);
    const fallbackArchiveQuery = queryCalls.find(
      sql => typeof sql === 'string' &&
             sql.includes('synthesis_archive') &&
             sql.includes('ORDER BY period_start DESC')
    );
    expect(fallbackArchiveQuery).toBeUndefined();
  });

});
