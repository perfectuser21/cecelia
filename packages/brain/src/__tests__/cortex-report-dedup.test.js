/**
 * cortex.js - generateSystemReport 语义去重单元测试
 *
 * 覆盖：
 * 1. _computeObservationKey — 相同入参同 key，不同入参异 key
 * 2. _deduplicateObservations — 5 克隆 → 1 原始 + 1 摘要行
 * 3. generateSystemReport 集成 — recent_failures 去重、recent_analyses SQL 含 failure_pattern
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../llm-caller.js', () => ({ callLLM: vi.fn() }));

import {
  _computeObservationKey,
  _deduplicateObservations,
  generateSystemReport,
} from '../cortex.js';

// ============================================================
// _computeObservationKey
// ============================================================
describe('_computeObservationKey', () => {
  it('相同参数返回相同 key', () => {
    const k1 = _computeObservationKey({ type: 'task_failure', failure_class: null, task_type: 'dev' });
    const k2 = _computeObservationKey({ type: 'task_failure', failure_class: null, task_type: 'dev' });
    expect(k1).toBe(k2);
  });

  it('不同 task_type 返回不同 key', () => {
    const k1 = _computeObservationKey({ type: 'task_failure', task_type: 'dev' });
    const k2 = _computeObservationKey({ type: 'task_failure', task_type: 'code_review' });
    expect(k1).not.toBe(k2);
  });

  it('failure_class 为 null 与有值不同 key', () => {
    const k1 = _computeObservationKey({ type: 'rca', failure_class: null, task_type: 'dev' });
    const k2 = _computeObservationKey({ type: 'rca', failure_class: 'timeout', task_type: 'dev' });
    expect(k1).not.toBe(k2);
  });

  it('返回 16 字符 hex', () => {
    const k = _computeObservationKey({ type: 'task_failure', task_type: 'dev' });
    expect(k).toMatch(/^[0-9a-f]{16}$/);
  });

  it('省略可选参数等同于 null', () => {
    const k1 = _computeObservationKey({ type: 'task_failure' });
    const k2 = _computeObservationKey({ type: 'task_failure', failure_class: null, task_type: null });
    expect(k1).toBe(k2);
  });
});

// ============================================================
// _deduplicateObservations
// ============================================================
describe('_deduplicateObservations', () => {
  it('5 条相同 key → 1 条原始 + 1 条摘要行', () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ title: `任务${i + 1}`, task_type: 'dev' }));
    const result = _deduplicateObservations(items, () => 'fixed-key-0000000');
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(items[0]);
    expect(result[1]._folded).toBe(true);
    expect(result[1].count).toBe(5);
    expect(result[1].message).toBe('5 条相同诊断，已折叠');
  });

  it('2 条相同 key → 1 + 摘要（count=2）', () => {
    const items = [{ task_type: 'dev' }, { task_type: 'dev' }];
    const result = _deduplicateObservations(items, () => 'same-key-00000000');
    expect(result).toHaveLength(2);
    expect(result[1].count).toBe(2);
  });

  it('1 条 → 不追加摘要行', () => {
    const items = [{ task_type: 'dev' }];
    const result = _deduplicateObservations(items, () => 'only-key-00000000');
    expect(result).toHaveLength(1);
    expect(result[0]._folded).toBeUndefined();
  });

  it('空数组 → 空数组', () => {
    expect(_deduplicateObservations([], () => 'k')).toEqual([]);
  });

  it('3 种不同 key → 3 条原始，无摘要行', () => {
    const items = [
      { task_type: 'dev' },
      { task_type: 'code_review' },
      { task_type: 'qa' },
    ];
    const keyFn = (row) => row.task_type;
    const result = _deduplicateObservations(items, keyFn);
    expect(result).toHaveLength(3);
    expect(result.every((r) => !r._folded)).toBe(true);
  });

  it('混合：2 个相同 key + 1 个不同 key → 3 条（1原始+1摘要+1原始）', () => {
    const items = [
      { task_type: 'dev' },
      { task_type: 'dev' },
      { task_type: 'qa' },
    ];
    const keyFn = (row) => row.task_type;
    const result = _deduplicateObservations(items, keyFn);
    expect(result).toHaveLength(3);
    const folded = result.filter((r) => r._folded);
    expect(folded).toHaveLength(1);
    expect(folded[0].count).toBe(2);
  });
});

// ============================================================
// generateSystemReport 集成测试
// ============================================================
describe('generateSystemReport — 语义去重集成', () => {
  let mockPool;

  beforeEach(async () => {
    vi.clearAllMocks();
    const db = await import('../db.js');
    mockPool = db.default;
  });

  it('5 条相同 task_type 失败任务 → recent_failures 折叠为 2 条', async () => {
    // 构造 mock pool.query
    const cloneRows = Array.from({ length: 5 }, (_, i) => ({
      title: `失败任务${i + 1}`,
      task_type: 'dev',
      error_message: 'timeout',
      updated_at: new Date().toISOString(),
    }));

    mockPool.query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })   // 1. KR 进度
      .mockResolvedValueOnce({ rows: [{ total: 10, completed: 8, failed: 2, queued: 0, in_progress: 0 }] }) // 2. 任务统计
      .mockResolvedValueOnce({ rows: [] })   // 3. working_memory
      .mockResolvedValueOnce({ rows: cloneRows })  // 4. recent_failures
      .mockResolvedValueOnce({ rows: [] })   // 5. recent_analyses
      .mockResolvedValueOnce({ rows: [{ id: 'test-id' }] }); // INSERT system_reports

    const { callLLM } = await import('../llm-caller.js');
    const llmJsonStr = '{"title":"test","summary":"ok","kr_progress":{},"task_stats":{},"system_health":{},"risks":[],"recommendations":[],"confidence":0.9}';
    callLLM.mockResolvedValue({ text: llmJsonStr });

    await generateSystemReport({ timeRangeHours: 48 });

    // 找到调用 recent_failures 的那次 query（第 4 次）
    const failuresCall = mockPool.query.mock.calls[3];
    expect(failuresCall[0]).toContain('FROM tasks');
    expect(failuresCall[0]).toContain("status = 'failed'");

    // recent_failures 应被折叠：5 条相同 dev → 2 条（1原始 + 1摘要）
    // callLLM 第 1 个参数是 agentId，第 2 个参数是 prompt
    const promptArg = callLLM.mock.calls[0][1];
    const contextMatch = promptArg.match(/```json\n([\s\S]*?)\n```/);
    expect(contextMatch).toBeTruthy();
    const ctx = JSON.parse(contextMatch[1]);
    expect(ctx.recent_failures).toHaveLength(2);
    expect(ctx.recent_failures[1]._folded).toBe(true);
    expect(ctx.recent_failures[1].count).toBe(5);
  });

  it('recent_analyses SQL 包含 failure_pattern 字段', async () => {
    mockPool.query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: 5, completed: 5, failed: 0, queued: 0, in_progress: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'test-id-2' }] });

    const { callLLM } = await import('../llm-caller.js');
    callLLM.mockResolvedValue({ text: '{"title":"t","summary":"s","kr_progress":{},"task_stats":{},"system_health":{},"risks":[],"recommendations":[],"confidence":0.8}' });

    await generateSystemReport({ timeRangeHours: 48 });

    // 第 5 次调用是 recent_analyses
    const analysesCall = mockPool.query.mock.calls[4];
    expect(analysesCall[0]).toContain('failure_pattern');
    expect(analysesCall[0]).toContain('FROM cortex_analyses');
  });
});
