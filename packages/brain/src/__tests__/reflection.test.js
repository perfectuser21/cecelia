/**
 * 反思模块测试 - 静默期 + 持久化熔断器 + 折叠记录
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock 设置 ──────────────────────────────────────────────

const mockQuery = vi.hoisted(() => vi.fn());
const mockCallLLM = vi.hoisted(() => vi.fn());
const mockGenerateL0Summary = vi.hoisted(() => vi.fn());
const mockGenerateMemoryStreamL1Async = vi.hoisted(() => vi.fn());
const mockGenerateMemoryStreamEmbeddingAsync = vi.hoisted(() => vi.fn());

vi.mock('../db.js', () => ({
  default: { query: mockQuery },
}));

vi.mock('../llm-caller.js', () => ({
  callLLM: mockCallLLM,
}));

vi.mock('../memory-utils.js', () => ({
  generateL0Summary: mockGenerateL0Summary,
  generateMemoryStreamL1Async: mockGenerateMemoryStreamL1Async,
}));

vi.mock('../embedding-service.js', () => ({
  generateMemoryStreamEmbeddingAsync: mockGenerateMemoryStreamEmbeddingAsync,
}));

// ────────────────────────────────────────────────────────────

import { runReflection, _resetBreakerStateForTest } from '../desire/reflection.js';

// Helper: mock breaker state not found in DB (first load)
function mockBreakerStateEmpty() {
  mockQuery.mockResolvedValueOnce({ rows: [] }); // _loadBreakerState: no state
}

// Helper: mock breaker state loaded from DB
function mockBreakerStateLoaded(state) {
  mockQuery.mockResolvedValueOnce({ rows: [{ value_json: state }] });
}

describe('反思静默期机制', () => {
  let pool;

  beforeEach(() => {
    pool = { query: mockQuery };
    vi.clearAllMocks();
    _resetBreakerStateForTest();
    mockGenerateL0Summary.mockReturnValue('summary');
  });

  it('静默期-阻止触发: 静默期内不触发反思', async () => {
    const silenceUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    mockBreakerStateEmpty(); // _loadBreakerState
    mockQuery.mockResolvedValueOnce({ rows: [{ value_json: silenceUntil }] }); // silence check

    const result = await runReflection(pool);

    expect(result.triggered).toBe(false);
    expect(result.reason).toBe('in_silence_period');
    expect(result.silence_until).toBe(silenceUntil);
  });

  it('静默期-自动恢复: 静默期结束后恢复正常', async () => {
    const silenceUntil = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();

    mockBreakerStateEmpty(); // _loadBreakerState
    mockQuery
      .mockResolvedValueOnce({ rows: [{ value_json: silenceUntil }] }) // silence check (expired)
      .mockResolvedValueOnce({ rows: [] }) // DELETE silence
      .mockResolvedValueOnce({ rows: [] }) // _saveBreakerState
      .mockResolvedValueOnce({ rows: [{ value_json: 5 }] }); // accumulator

    const result = await runReflection(pool);

    expect(mockQuery).toHaveBeenCalledWith(
      "DELETE FROM working_memory WHERE key = 'reflection_silence_until'"
    );
    expect(result.triggered).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  it('静默期-DB错误降级: working_memory 读写失败时降级处理', async () => {
    mockBreakerStateEmpty(); // _loadBreakerState
    mockQuery
      .mockRejectedValueOnce(new Error('DB connection failed')) // silence check fails
      .mockResolvedValueOnce({ rows: [{ value_json: 5 }] }); // accumulator

    const result = await runReflection(pool);

    expect(result.triggered).toBe(false);
    expect(result.reason).toBeUndefined();
  });
});

describe('反思模块-基础功能', () => {
  let pool;

  beforeEach(() => {
    pool = { query: mockQuery };
    vi.clearAllMocks();
    _resetBreakerStateForTest();
  });

  it('accumulator 低于阈值时不触发', async () => {
    mockBreakerStateEmpty(); // _loadBreakerState
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // silence check
      .mockResolvedValueOnce({ rows: [{ value_json: 5 }] }); // accumulator

    const result = await runReflection(pool);

    expect(result.triggered).toBe(false);
    expect(result.accumulator).toBe(5);
  });

  it('无记忆时不触发', async () => {
    mockBreakerStateEmpty(); // _loadBreakerState
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // silence check
      .mockResolvedValueOnce({ rows: [{ value_json: 15 }] }) // accumulator >= 12
      .mockResolvedValueOnce({ rows: [] }); // no memories

    const result = await runReflection(pool);

    expect(result.triggered).toBe(false);
  });
});

describe('反思熔断器持久化', () => {
  let pool;

  beforeEach(() => {
    pool = { query: mockQuery };
    vi.clearAllMocks();
    _resetBreakerStateForTest();
    mockGenerateL0Summary.mockReturnValue('summary');
  });

  it('启动时从 DB 加载熔断器状态', async () => {
    const savedState = {
      consecutiveDuplicates: 2,
      lastInsightHash: 'abc12345deadbeef',
      consecutiveSkips: 1,
    };

    mockBreakerStateLoaded(savedState); // _loadBreakerState: has state
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // silence check
      .mockResolvedValueOnce({ rows: [{ value_json: 5 }] }); // accumulator < 12

    const result = await runReflection(pool);

    expect(result.triggered).toBe(false);
    // Verify the load query was called
    expect(mockQuery).toHaveBeenCalledWith(
      "SELECT value_json FROM working_memory WHERE key = 'reflection_breaker_state'"
    );
  });

  it('DB 加载失败时降级为默认值（不抛异常）', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB down')); // _loadBreakerState fails
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // silence check
      .mockResolvedValueOnce({ rows: [{ value_json: 5 }] }); // accumulator < 12

    const result = await runReflection(pool);

    expect(result.triggered).toBe(false);
    expect(result.accumulator).toBe(5);
  });

  it('相似度去重时写入折叠记录到 memory_stream', async () => {
    mockBreakerStateEmpty();
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // silence check
      .mockResolvedValueOnce({ rows: [{ value_json: 15 }] }) // accumulator >= 12
      .mockResolvedValueOnce({ rows: [ // memories
        { content: '系统正常运行', importance: 5, memory_type: 'short', created_at: new Date() },
      ]});

    // LLM returns an insight
    mockCallLLM.mockResolvedValueOnce({ text: '系统运行稳定，无异常模式' });

    mockQuery
      .mockResolvedValueOnce({ rows: [ // recent insights with similar content
        { content: '[反思洞察] 系统运行稳定，无异常模式发现' },
      ]})
      .mockResolvedValueOnce({ rows: [] }) // fold record INSERT (memory_stream)
      .mockResolvedValueOnce({ rows: [] }) // accumulator reset
      .mockResolvedValueOnce({ rows: [] }); // _saveBreakerState

    const result = await runReflection(pool);

    expect(result.triggered).toBe(true);
    expect(result.skipped).toBe('duplicate');

    // Verify fold record was written
    const insertCalls = mockQuery.mock.calls.filter(call =>
      typeof call[0] === 'string' && call[0].includes('[反思折叠]') === false &&
      call[1]?.[0] && typeof call[1][0] === 'string' && call[1][0].includes('[反思折叠]')
    );
    expect(insertCalls.length).toBe(1);
    expect(insertCalls[0][1][0]).toContain('[反思折叠]');
  });

  it('成功写入洞察后重置跳过计数器并持久化', async () => {
    mockBreakerStateEmpty();
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // silence check
      .mockResolvedValueOnce({ rows: [{ value_json: 15 }] }) // accumulator >= 12
      .mockResolvedValueOnce({ rows: [ // memories
        { content: '完全不同的新内容', importance: 5, memory_type: 'short', created_at: new Date() },
      ]});

    mockCallLLM.mockResolvedValueOnce({ text: '这是一个全新的独特洞察，包含全新信息' });

    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // recent insights (none similar)
      .mockResolvedValueOnce({ rows: [] }) // _saveBreakerState (after dedup pass)
      .mockResolvedValueOnce({ rows: [{ id: 42 }] }) // insight INSERT RETURNING
      .mockResolvedValueOnce({ rows: [] }) // _saveBreakerState (after write)
      .mockResolvedValueOnce({ rows: [] }); // accumulator reset

    const result = await runReflection(pool);

    expect(result.triggered).toBe(true);
    expect(result.insight).toContain('全新的独特洞察');

    // Verify _saveBreakerState was called (check for reflection_breaker_state key)
    const saveCalls = mockQuery.mock.calls.filter(call =>
      call[1]?.[0] === 'reflection_breaker_state'
    );
    expect(saveCalls.length).toBeGreaterThanOrEqual(1);
  });
});
