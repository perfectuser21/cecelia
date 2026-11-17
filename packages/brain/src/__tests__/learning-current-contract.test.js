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
  return state.outcome ?? { success: true, task: { id: 'task-id', payload: { ...request.payload, repo: request.repo_hint, map_scope: request.map_scope_hint } } };
}) }));
vi.mock('../capture-inbox.js', () => ({ pushCaptureAtom: vi.fn() }));
vi.mock('../embedding-service.js', () => ({ generateLearningEmbeddingAsync: vi.fn() }));
vi.mock('../openai-client.js', () => ({ generateEmbedding: vi.fn() }));
vi.mock('../llm-caller.js', () => ({ callLLM: vi.fn() }));
import { recordLearning, createLearningTask } from '../learning.js';
const analysis = { task_id: 'source-id', analysis: { root_cause: '真实来源故障' }, learnings: [], recommended_actions: [], confidence: 0.8 };
beforeEach(() => { state.source = null; state.created = null; state.updates = []; state.outcome = null; });
describe('RCA 记录与研究合同', () => {
  it.each(['cecelia', 'zenithjoy-workspace'])('高置信RCA即使有完整%s路由也只记录学习', async repo => {
    state.source = { payload: { repo, map_scope: ['F2'] } };
    const learning = await recordLearning(analysis);
    expect(learning).toMatchObject({ id: 'learning-id', source_memory_id: 'memory-id' });
    expect(state.created).toBeNull();
    expect(state.updates.some(({sql}) => sql.includes('applied = true'))).toBe(false);
  });
  it.each([null, {}, { payload: { repo: 'cecelia' } }])('缺路由仍可保存学习与记忆，不虚标修复完成 %j', async source => {
    state.source = source;
    const learning = await recordLearning(analysis);
    expect(learning.source_memory_id).toBe('memory-id');
    expect(state.created).toBeNull();
    expect(state.updates.some(({sql}) => sql.includes('applied = true'))).toBe(false);
  });
  it('学习分析仍显式声明只研究合同', async () => {
    await createLearningTask({ trigger: 'failure', failures: [] });
    expect(state.created).toMatchObject({ task_type: 'research', declared_domain: 'research', mutation_intent: 'none' });
  });
});
