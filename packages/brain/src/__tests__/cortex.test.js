import { describe, it, expect, beforeEach, afterAll, beforeAll, vi } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../db-config.js';
import { verifyDebt02Scratch } from './helpers/debt-02-scratch.js';
import { createIntakeTestDatabase } from './fixtures/task-intake-db.js';

vi.mock('../llm-caller.js', () => ({ callLLM: vi.fn() }));
// Embedding/model boundaries are isolated; RCA, validation, learning and SQL remain real.
vi.mock('../openai-client.js', () => ({ generateEmbedding: vi.fn().mockRejectedValue(new Error('no external embedding')) }));
let pool, fixture, performRCA, validateCortexDecision, applyStrategyAdjustments, callLLM, task;
const decision = (updates = []) => ({
  level: 2,
  analysis: { root_cause: 'debt02 persistence check: upstream timeout', contributing_factors: ['timeout'], impact_assessment: 'retry delayed' },
  actions: [], strategy_updates: updates, learnings: [], rationale: 'fixture RCA', confidence: 0.8, safety: false,
});
const update = { key: 'retry.max_attempts', old_value: 3, new_value: 5, reason: 'bounded retry' };
const adjustment = { params: { param: 'retry.max_attempts', current_value: 3, new_value: 5, reason: 'bounded retry' } };

beforeAll(async () => {
  const guard = new pg.Pool(DB_DEFAULTS);
  try { await verifyDebt02Scratch(guard); } finally { await guard.end(); }
  fixture = await createIntakeTestDatabase();
  pool = fixture.pool;
  for (const table of ['cortex_analyses', 'working_memory', 'decision_log', 'learnings',
    'memory_stream', 'decisions', 'brain_config', 'strategy_adoptions']) {
    await pool.query(`CREATE TABLE ${fixture.schema}.${table} (LIKE public.${table} INCLUDING ALL)`);
  }
  await pool.query('ALTER TABLE cortex_analyses ADD FOREIGN KEY (task_id) REFERENCES tasks(id)');
  task = (await pool.query("INSERT INTO tasks(title,task_type,status) VALUES('debt02 RCA','dev','failed') RETURNING *")).rows[0];
});
afterAll(async () => { await fixture?.close(); });
beforeEach(async () => {
  await pool.query('TRUNCATE cortex_analyses, working_memory, brain_config, strategy_adoptions');
  vi.resetModules();
  vi.doMock('../db.js', () => ({ default: pool }));
  ({ performRCA, validateCortexDecision } = await import('../cortex.js'));
  ({ applyStrategyAdjustments } = await import('../learning.js'));
  ({ callLLM } = await import('../llm-caller.js'));
  callLLM.mockReset().mockResolvedValue({ text: JSON.stringify(decision([update])) });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('debt02 forbids external network'); }));
});
const run = () => performRCA(task, [{ failure_reason: 'persistence check', failure_classification: { class: 'NETWORK' } }]);

describe('Cortex strategy contract — real PostgreSQL and production functions', () => {
  it('converts strategy updates through performRCA and persists exact values', async () => {
    const result = await run();
    expect(callLLM).toHaveBeenCalledOnce();
    expect(result.strategy_adjustments).toEqual([adjustment]);
    const saved = await pool.query('SELECT * FROM cortex_analyses WHERE task_id=$1', [task.id]);
    expect(saved.rows).toHaveLength(1);
    expect(saved.rows[0]).toMatchObject({ root_cause: decision().analysis.root_cause, strategy_adjustments: [adjustment], analyst: 'cortex' });
    await vi.waitFor(async () => {
      const quality = (await pool.query('SELECT quality_score FROM cortex_analyses WHERE task_id=$1', [task.id])).rows[0];
      expect(quality.quality_score).toBeGreaterThan(0);
    }, { timeout: 2000, interval: 10 });
  });

  it('applies a generated whitelisted adjustment using the real learning consumer', async () => {
    const result = await run();
    expect(await applyStrategyAdjustments(result.strategy_adjustments, null)).toEqual({ applied: 1, skipped: 0, errors: [] });
    expect((await pool.query("SELECT value FROM brain_config WHERE key='retry.max_attempts'")).rows[0].value).toBe('5');
  });

  it('rejects unknown parameters and out-of-range values without writing config', async () => {
    const result = await applyStrategyAdjustments([
      { params: { param: 'arbitrary.unsafe', new_value: 1 } },
      { params: { param: 'retry.max_attempts', new_value: 999 } },
    ], null);
    expect(result.applied).toBe(0);
    expect(result.skipped).toBe(2);
    expect(result.errors.map(e => e.reason)).toEqual(['param_not_whitelisted', expect.stringContaining('value_out_of_range')]);
    expect((await pool.query('SELECT * FROM brain_config')).rows).toHaveLength(0);
  });

  it('validates real decisions and rejects actions outside the whitelist', () => {
    expect(validateCortexDecision(decision([update]))).toEqual({ valid: true, errors: [] });
    const bad = validateCortexDecision({ ...decision(), actions: [{ type: 'unsafe_action' }] });
    expect(bad.valid).toBe(false);
    expect(bad.errors).toContain('action type "unsafe_action" not in whitelist');
  });

  it('preserves empty strategy updates through the real RCA path', async () => {
    callLLM.mockResolvedValue({ text: JSON.stringify(decision()) });
    const result = await run();
    expect(result.strategy_adjustments).toEqual([]);
    expect((await pool.query('SELECT strategy_adjustments FROM cortex_analyses WHERE task_id=$1', [task.id])).rows).toEqual([{ strategy_adjustments: [] }]);
  });

  it('persists the actual fallback analysis on model failure', async () => {
    callLLM.mockRejectedValue(new Error('debt02 isolated model failure'));
    const result = await run();
    expect(result.strategy_adjustments).toEqual([]);
    expect(result.analysis.root_cause).toBe('Cortex analysis failed');
    const saved = await pool.query('SELECT root_cause FROM cortex_analyses WHERE task_id=$1', [task.id]);
    expect(saved.rows).toEqual([{ root_cause: 'Cortex analysis failed' }]);
  });
});
