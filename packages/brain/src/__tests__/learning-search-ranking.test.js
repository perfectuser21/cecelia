/** 真实公开检索入口；DB/SDK只记录请求，禁止模型、写入和外部业务动作。 */
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const boundary = vi.hoisted(() => ({ query: vi.fn(), embedding: vi.fn(),
  forbidden: vi.fn(() => { throw new Error('非检索外部边界禁止执行'); }) }));
vi.mock('../db.js', () => ({ default: { query: (...args) => boundary.query(...args) } }));
vi.mock('../openai-client.js', () => ({ generateEmbedding: (...args) => boundary.embedding(...args) }));
vi.mock('../actions.js', () => ({ createTask: boundary.forbidden }));
vi.mock('../embedding-service.js', () => ({ generateLearningEmbeddingAsync: boundary.forbidden }));
vi.mock('../memory-utils.js', () => ({ generateL0Summary: boundary.forbidden }));
vi.mock('../llm-caller.js', () => ({ callLLM: boundary.forbidden }));
vi.mock('../capture-inbox.js', () => ({ pushCaptureAtom: boundary.forbidden }));
import { searchRelevantLearnings } from '../learning.js';

const now = Date.UTC(2026, 10, 6);
const context = { task_type: 'dev', failure_class: 'NETWORK', event_type: 'systemic_failure' };
const candidates = [...Array.from({ length: 5 }, (_, i) => ({
  id: `new-unrelated-${i}`, title: `无关经验${i}`, category: 'optimization', trigger_event: 'manual',
  content: 'unrelated', metadata: { task_type: 'qa' }, created_at: new Date(now - 86400000 - i * 60000).toISOString(),
})), {
  id: 'older-exact-match', title: '网络恢复经验', category: 'failure_pattern', trigger_event: 'systemic_failure',
  content: 'NETWORK handling', metadata: { task_type: 'dev' }, created_at: new Date(now - 2 * 86400000).toISOString(),
}];
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.stubEnv('OPENAI_API_KEY', '');
  boundary.query.mockReset(); boundary.embedding.mockReset(); boundary.forbidden.mockClear();
});
afterEach(() => {
  expect(boundary.forbidden).not.toHaveBeenCalled();
  vi.unstubAllEnvs(); vi.useRealTimers();
});
function arrangeKeywords({ vectorCount = 0, rows = candidates } = {}) {
  boundary.query.mockImplementation(async (sql, params) => {
    if (sql.includes('SELECT COUNT(*) FROM learnings WHERE embedding IS NOT NULL')) return { rows: [{ count: String(vectorCount) }] };
    if (sql.includes('FROM learnings') && sql.includes('ORDER BY created_at DESC') && sql.includes('LIMIT 100')) {
      expect(params).toBeUndefined();
      return { rows: structuredClone(rows) }; // 已按created_at排序的真实DB边界，不复制评分/截断。
    }
    throw new Error('未安排的检索SQL');
  });
}
async function expectTopFive() {
  const all = await searchRelevantLearnings(context, 6);
  const limited = await searchRelevantLearnings(context, 5);
  expect(all).toHaveLength(6);
  expect(all[0].id).toBe('older-exact-match');
  expect(all[0].relevance_score).toBeGreaterThan(all[1].relevance_score);
  expect(limited.map(row => row.id)).toEqual(all.slice(0, 5).map(row => row.id));
  expect(limited.map(row => row.id)).toEqual(['older-exact-match', ...candidates.slice(0, 4).map(row => row.id)]);
}
it('无key关键词路径先评分排序后截断，limit5不能丢较旧的最佳匹配', async () => {
  arrangeKeywords();
  await expectTopFive();
  expect(boundary.query).toHaveBeenCalledTimes(2);
  expect(boundary.embedding).not.toHaveBeenCalled();
});
it('embedding Promise拒绝后降级仍先排序，不能空返回或提前截断', async () => {
  vi.stubEnv('OPENAI_API_KEY', 'owned-synthetic-key');
  arrangeKeywords({ vectorCount: 6 });
  boundary.embedding.mockRejectedValue(new Error('owned embedding rejection'));
  await expectTopFive();
  expect(boundary.embedding).toHaveBeenCalledTimes(2);
  expect(boundary.embedding).toHaveBeenCalledWith('dev NETWORK systemic_failure');
  expect(boundary.query).toHaveBeenCalledTimes(4);
});
it('有key但无embedding时关键词降级同样保留最佳匹配', async () => {
  vi.stubEnv('OPENAI_API_KEY', 'owned-synthetic-key');
  arrangeKeywords();
  await expectTopFive();
  expect(boundary.embedding).not.toHaveBeenCalled();
  expect(boundary.query).toHaveBeenCalledTimes(4);
});
it('向量健康路径仍遵守原limit*2查询候选和最终排序上限', async () => {
  vi.stubEnv('OPENAI_API_KEY', 'owned-synthetic-key');
  boundary.embedding.mockResolvedValue([.1, .2]);
  boundary.query.mockImplementation(async (sql, params) => {
    if (sql.includes('SELECT COUNT(*)')) return { rows: [{ count: '2' }] };
    expect(sql).toContain('ORDER BY embedding <=> $1::vector');
    expect(params).toEqual(['[0.1,0.2]', 2]);
    return { rows: [{ ...candidates[0], id: 'vector-low', vector_score: .2 },
      { ...candidates[0], id: 'vector-high', vector_score: .9 }] };
  });
  const result = await searchRelevantLearnings(context, 1);
  expect(result).toHaveLength(1);
  expect(result[0].id).toBe('vector-high');
  expect(boundary.query).toHaveBeenCalledTimes(2);
});
it('空候选仍返回空，关键词查询继续维持100条上界', async () => {
  arrangeKeywords({ rows: [] });
  expect(await searchRelevantLearnings(context, 5)).toEqual([]);
  expect(boundary.query).toHaveBeenCalledTimes(1);
  expect(boundary.embedding).not.toHaveBeenCalled();
});
it('SDK与关键词读取都失败时，原最近记录末级降级保留零分与有限条数', async () => {
  vi.stubEnv('OPENAI_API_KEY', 'owned-synthetic-key');
  boundary.embedding.mockRejectedValue(new Error('owned SDK rejection'));
  boundary.query.mockImplementation(async (sql, params) => {
    if (sql.includes('SELECT COUNT(*)')) return { rows: [{ count: '6' }] };
    if (sql.includes('LIMIT 100')) throw new Error('owned keyword DB rejection');
    expect(sql).toContain('ORDER BY created_at DESC LIMIT $1');
    expect(params).toEqual([5]);
    return { rows: structuredClone(candidates.slice(0, 5)) };
  });
  const result = await searchRelevantLearnings(context, 5);
  expect(result.map(row => row.id)).toEqual(candidates.slice(0, 5).map(row => row.id));
  expect(result.every(row => row.relevance_score === 0)).toBe(true);
  expect(boundary.query).toHaveBeenCalledTimes(3);
});
