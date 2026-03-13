/**
 * Learning Deduplication Tests
 *
 * 验证 upsertFailureLearning() 的去重逻辑：
 * - 24h 内同 category + error_type → 合并（increment occurrence_count）
 * - 无近期记录 → 新插入
 * - occurrence_count 正确累加
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock db ───────────────────────────────────────────────────────────────────
const mockQuery = vi.fn();
vi.mock('../db.js', () => ({ default: { query: (...args) => mockQuery(...args) } }));

// ── Mock dependencies of learning.js ─────────────────────────────────────────
vi.mock('../openai-client.js', () => ({
  generateEmbedding: vi.fn().mockResolvedValue(new Array(1536).fill(0)),
}));
vi.mock('../embedding-service.js', () => ({
  generateLearningEmbeddingAsync: vi.fn(),
}));
vi.mock('../memory-utils.js', () => ({
  generateL0Summary: vi.fn((text) => text.slice(0, 100)),
}));
vi.mock('../llm-caller.js', () => ({
  callLLM: vi.fn(),
}));

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('upsertFailureLearning', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('新记录：24h 内无同类 → INSERT，返回 merged=false', async () => {
    // SELECT 返回空（无近期记录）
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                           // SELECT 不存在
      .mockResolvedValueOnce({ rows: [{ id: 'new-uuid-001' }] });   // INSERT

    const { upsertFailureLearning } = await import('../learning.js');
    const result = await upsertFailureLearning({
      title: '隔离分析：OAuth task',
      content: 'OAuth token 失效，认证失败',
      category: 'quarantine_pattern',
      errorType: 'auth',
    });

    expect(result.id).toBe('new-uuid-001');
    expect(result.merged).toBe(false);

    // 第一次 query 是 SELECT（检查 24h 内是否存在）
    const selectCall = mockQuery.mock.calls[0];
    expect(selectCall[0]).toContain('INTERVAL');
    expect(selectCall[1]).toEqual(['quarantine_pattern', 'auth']);

    // 第二次 query 是 INSERT
    const insertCall = mockQuery.mock.calls[1];
    expect(insertCall[0]).toContain('INSERT INTO learnings');
    expect(insertCall[0]).toContain('occurrence_count');
    expect(insertCall[1]).toContain('quarantine_pattern');
    expect(insertCall[1]).toContain('auth');
  });

  it('重复记录：24h 内已有同 category + error_type → UPDATE occurrence_count，返回 merged=true', async () => {
    // SELECT 返回已存在记录（occurrence_count=2）
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'existing-uuid-001', occurrence_count: 2 }] }) // SELECT 存在
      .mockResolvedValueOnce({ rows: [] });                                                  // UPDATE

    const { upsertFailureLearning } = await import('../learning.js');
    const result = await upsertFailureLearning({
      title: '隔离分析：另一个 OAuth task',
      content: '相同的 OAuth 失败',
      category: 'quarantine_pattern',
      errorType: 'auth',
    });

    expect(result.id).toBe('existing-uuid-001');
    expect(result.merged).toBe(true);

    // 第二次 query 是 UPDATE，occurrence_count = 2 + 1 = 3
    const updateCall = mockQuery.mock.calls[1];
    expect(updateCall[0]).toContain('UPDATE learnings');
    expect(updateCall[0]).toContain('occurrence_count');
    expect(updateCall[1][0]).toBe(3);
    expect(updateCall[1][1]).toBe('existing-uuid-001');
  });

  it('occurrence_count 为 null 时按 1 处理（+1 = 2）', async () => {
    // 旧记录 occurrence_count=null（字段新加，旧行默认为 null）
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'old-uuid-001', occurrence_count: null }] })
      .mockResolvedValueOnce({ rows: [] });

    const { upsertFailureLearning } = await import('../learning.js');
    const result = await upsertFailureLearning({
      title: '隔离分析：billing_cap task',
      content: '账单上限达到',
      category: 'quarantine_pattern',
      errorType: 'billing_cap',
    });

    expect(result.merged).toBe(true);

    const updateCall = mockQuery.mock.calls[1];
    // (null || 1) + 1 = 2
    expect(updateCall[1][0]).toBe(2);
  });

  it('不同 error_type 不合并（分别写入）', async () => {
    // 第一次：auth 类型，SELECT 无记录 → INSERT
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'auth-uuid-001' }] });

    const { upsertFailureLearning } = await import('../learning.js');
    const result = await upsertFailureLearning({
      title: '隔离分析：auth fail',
      content: 'auth error',
      category: 'quarantine_pattern',
      errorType: 'auth',
    });

    expect(result.merged).toBe(false);
    // SELECT 查询的是 error_type='auth'
    expect(mockQuery.mock.calls[0][1]).toEqual(['quarantine_pattern', 'auth']);
  });

  it('errorType 默认值为 unknown', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'unknown-uuid-001' }] });

    const { upsertFailureLearning } = await import('../learning.js');
    await upsertFailureLearning({
      title: '隔离分析：unknown',
      content: 'unknown error',
      category: 'quarantine_pattern',
      // errorType 未传
    });

    // SELECT 应传 'unknown'
    expect(mockQuery.mock.calls[0][1]).toEqual(['quarantine_pattern', 'unknown']);
    // INSERT 也应含 'unknown'
    expect(mockQuery.mock.calls[1][1]).toContain('unknown');
  });

  it('DB 错误时抛出（不静默吞噬）', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB connection failed'));

    const { upsertFailureLearning } = await import('../learning.js');
    await expect(
      upsertFailureLearning({
        title: '隔离分析：error',
        content: 'error',
        category: 'quarantine_pattern',
        errorType: 'network',
      })
    ).rejects.toThrow('DB connection failed');
  });
});
