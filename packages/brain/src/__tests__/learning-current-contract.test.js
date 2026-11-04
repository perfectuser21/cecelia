import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ source: null, created: null, updates: [], outcome: null }));
vi.mock('../db.js', () => ({ default: { query: vi.fn(async (sql, values) => {
  if (sql.includes('SELECT id, version FROM learnings')) return { rows: [] };
  if (sql.includes('INSERT INTO learnings')) return { rows: [{ id: 'learning-id', applied: false }] };
  if (sql.includes('SELECT') && sql.includes('FROM tasks')) return { rows: sql.includes('insight_learning_id') ? [] : (state.source ? [state.source] : []) };
  if (sql.includes('INSERT INTO memory_stream')) return { rows: [{ id: 'memory-id' }] };
  state.updates.push({ sql, values });
  return { rows: [] };
}) } }));
vi.mock('../actions.js', () => ({ createTask: vi.fn(async request => {
  state.created = request;
  return state.outcome ?? { success: true, task: { id: 'task-id' } };
}) }));
vi.mock('../capture-inbox.js', () => ({ pushCaptureAtom: vi.fn() }));
vi.mock('../embedding-service.js', () => ({ generateLearningEmbeddingAsync: vi.fn() }));
vi.mock('../openai-client.js', () => ({ generateEmbedding: vi.fn() }));
vi.mock('../llm-caller.js', () => ({ callLLM: vi.fn() }));
import { recordLearning, createLearningTask } from '../learning.js';
const analysis = { task_id: 'source-id', analysis: { root_cause: '真实来源故障' }, learnings: [], recommended_actions: [], confidence: 0.8 };
beforeEach(() => { state.source = null; state.created = null; state.updates = []; state.outcome = null; });
describe('RCA 当前路由合同', () => {
  it.each(['cecelia', 'zenithjoy-workspace'])('修复继承 %s 的真实仓库与范围', async repo => {
    state.source = { payload: { repo, map_scope: ['F2'] } };
    await recordLearning(analysis);
    expect(state.created).toMatchObject({ repo_hint: repo, map_scope_hint: ['F2'], mutation_intent: 'write', declared_change_kind: 'bugfix' });
    expect(state.updates.some(({sql}) => sql.includes('applied = true'))).toBe(true);
  });
  it.each([null, {}, { payload: { repo: 'cecelia' } }, { payload: { map_scope: ['F2'] } }, { payload: { repo: 'cecelia', map_scope: [''] } }])('上下文不足时不自动写仓库且留阻断证据 %j', async source => {
    state.source = source;
    await recordLearning(analysis);
    expect(state.created).toBeNull();
    expect(state.updates.some(({sql}) => sql.includes('applied = true'))).toBe(false);
    expect(state.updates.some(({values}) => JSON.stringify(values).includes('source_route_context_missing'))).toBe(true);
  });
  it('建单返回拒绝时不能虚标 applied', async () => {
    state.source = { payload: { repo: 'cecelia', map_scope: ['F2'] } };
    state.outcome = { success: false, error: 'rejected' };
    await recordLearning(analysis);
    expect(state.updates.some(({sql}) => sql.includes('applied = true'))).toBe(false);
  });
  it('学习分析显式声明只研究合同', async () => {
    await createLearningTask({ trigger: 'failure', failures: [] });
    expect(state.created).toMatchObject({ task_type: 'research', declared_domain: 'research', mutation_intent: 'none' });
  });
});
