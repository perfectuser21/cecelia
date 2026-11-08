import { randomUUID } from 'node:crypto';
import { validateTestDatabaseUrl } from './suggestion-plan-db-url-guard.mjs';
import pg from 'pg';
import express from 'express';
import request from 'supertest';
import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';

// These tests intentionally require a local scratch DB and an isolated schema.
const url = validateTestDatabaseUrl(process.env.TEST_DATABASE_URL);
const schema = `suggestion_callback_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const { holder, dbProxy } = vi.hoisted(() => {
  const holder = { pool: null };
  return { holder, dbProxy: { query: (...args) => holder.pool.query(...args), connect: (...args) => holder.pool.connect(...args) } };
});
vi.mock('../../db.js', () => ({ default: dbProxy }));
const mockCreateTask = vi.fn().mockResolvedValue({ success: true, task: { id: 'new-task-id' } });
vi.mock('../../actions.js', () => ({
  createTask: mockCreateTask,
  updateTask: vi.fn(),
  createGoal: vi.fn(),
  updateGoal: vi.fn(),
  triggerN8n: vi.fn(),
  setMemory: vi.fn(),
  batchUpdateTasks: vi.fn(),
}));

vi.mock('../../quarantine.js', () => ({ handleTaskFailure: vi.fn(async () => ({})), classifyFailure: vi.fn(() => ({})) }));
vi.mock('../../executor.js', () => ({
  getActiveProcesses: vi.fn(() => []),
  getActiveProcessCount: vi.fn(() => 0),
  checkCeceliaRunAvailable: vi.fn(async () => ({ available: true })),
  removeActiveProcess: vi.fn(),
  probeTaskLiveness: vi.fn(async () => []),
  syncOrphanTasksOnStartup: vi.fn(async () => ({ orphans_found: 0, orphans_fixed: 0, rebuilt: 0 })),
  recordHeartbeat: vi.fn(async () => ({ success: true })),
}));
vi.mock('../../focus.js', () => ({ getDailyFocus: vi.fn(), setDailyFocus: vi.fn(), clearDailyFocus: vi.fn(), getFocusSummary: vi.fn() }));
vi.mock('../../tick.js', () => ({ getTickStatus: vi.fn(), enableTick: vi.fn(), disableTick: vi.fn(), executeTick: vi.fn(), runTickSafe: vi.fn(async () => ({ actions_taken: [] })), routeTask: vi.fn(), TASK_TYPE_AGENT_MAP: {} }));
vi.mock('../../task-router.js', () => ({
  getInternalTaskHandler: vi.fn(() => null), identifyWorkType: vi.fn(), getTaskLocation: vi.fn(), routeTaskCreate: vi.fn(), isValidTaskType: vi.fn(() => true), getDomainSkillOverride: vi.fn(() => null), VALID_TASK_TYPES: ['dev', 'code_review', 'initiative_verify', 'initiative_plan', 'decomp_review', 'architecture_design', 'cecelia_events'] }));
vi.mock('../../thalamus.js', () => ({ processEvent: vi.fn(async () => ({})), ACTION_WHITELIST: [], EVENT_TYPES: { TASK_COMPLETED: 'task_completed', TASK_FAILED: 'task_failed' } }));
vi.mock('../../cortex.js', () => ({ analyzeEvent: vi.fn(async () => ({})), loadReflectionState: vi.fn(async () => {}) }));
vi.mock('../../alertness.js', () => ({ getAlertnessLevel: vi.fn(() => ({ level: 1, levelName: 'CALM' })), updateAlertnessFromEvent: vi.fn(async () => {}), setAlertnessOverride: vi.fn(), clearAlertnessOverride: vi.fn() }));
vi.mock('../../circuit-breaker.js', () => ({ getState: vi.fn(() => ({})), isAllowed: vi.fn(() => true), recordSuccess: vi.fn(async () => {}), recordFailure: vi.fn(async () => {}), reset: vi.fn(async () => {}), getAllStates: vi.fn(() => ({})), FAILURE_THRESHOLD: 3, OPEN_DURATION_MS: 60000 }));
vi.mock('../../notifier.js', () => ({ notifyTaskCompleted: vi.fn(async () => {}), notifyTaskFailed: vi.fn(async () => {}), sendFeishuMessage: vi.fn(async () => {}) }));
vi.mock('../../event-bus.js', () => ({ emitEvent: vi.fn(async () => {}), emit: vi.fn(async () => {}), onEvent: vi.fn(), publishTaskCompleted: vi.fn(), publishTaskFailed: vi.fn(), ensureEventsTable: vi.fn(async () => {}), queryEvents: vi.fn(async () => []), getEventCounts: vi.fn(async () => ({})) }));
vi.mock('../../auto-learning.js', () => ({ triggerLearningCapture: vi.fn(async () => {}), processExecutionAutoLearning: vi.fn(async () => null) }));
vi.mock('../../desire-feedback.js', () => ({ updateDesireFromTask: vi.fn(async () => {}) }));
vi.mock('../../proactive-mouth.js', () => ({ notifyTaskCompletion: vi.fn(async () => {}) }));
vi.mock('../../review-gate.js', () => ({ processReviewResult: vi.fn(async () => {}) }));
vi.mock('../../progress-ledger.js', () => ({ recordProgressStep: vi.fn(async () => {}) }));
vi.mock('../../llm-caller.js', () => ({ callLLM: vi.fn(async () => ({})) }));
vi.mock('../../working-memory.js', () => ({ getMemory: vi.fn(async () => null), setMemory: vi.fn(async () => {}) }));
vi.mock('../../watchdog.js', () => ({ startWatching: vi.fn(), stopWatching: vi.fn(), sampleAll: vi.fn(async () => []) }));
vi.mock('../../desire-engine.js', () => ({ processDesires: vi.fn(async () => ({})) }));
vi.mock('../../dev-failure-classifier.js', () => ({ classifyDevFailure: vi.fn(async () => ({})) }));
vi.mock('../../self-model.js', () => ({ updateSelfModel: vi.fn(async () => {}), getSelfModel: vi.fn(async () => ({})) }));
vi.mock('../../suggestion-dispatcher.js', () => ({ dispatchSuggestion: vi.fn(async () => {}) }));
vi.mock('../../dep-cascade.js', () => ({ propagateDependencyFailure: vi.fn(async () => ({ affected: [] })), recoverDependencyChain: vi.fn(async () => ({ recovered: [] })) }));


import { runTickSafe } from '../../tick.js';
import { handleTaskFailure } from '../../quarantine.js';

let admin;
let pool;
let app;
let pollAndProcess;
let taskId;
let suggestionId;
let runId;

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${schema}`);
  pool = new pg.Pool({ connectionString: url, max: 8, options: `-c search_path=${schema}` });
  holder.pool = pool;
  await pool.query(`
    CREATE TABLE tasks (
      id uuid PRIMARY KEY, task_type text, status text, payload jsonb DEFAULT '{}'::jsonb,
      result jsonb, pr_url text, pr_status text, completed_at timestamptz, quota_exhausted_at timestamptz,
      error_message text, blocked_detail jsonb, updated_at timestamptz, claimed_by text, claimed_at timestamptz
    );
    CREATE TABLE suggestions (id uuid PRIMARY KEY, status text, updated_at timestamptz);
    CREATE TABLE callback_queue (
      id bigserial PRIMARY KEY, task_id uuid, checkpoint_id text, run_id text, status text, result_json jsonb,
      stderr_tail text, duration_ms integer, attempt integer, exit_code integer, failure_class text,
      claimed_at timestamptz, claimed_by text, processed_at timestamptz, created_at timestamptz DEFAULT now(),
      retry_count integer DEFAULT 0
    );
    CREATE TABLE decision_log (id bigserial PRIMARY KEY, trigger text, input_summary text, llm_output_json jsonb,
      action_result_json jsonb, status text);
    CREATE TABLE workflows (id uuid PRIMARY KEY);
    CREATE TABLE task_runs (id bigserial PRIMARY KEY, task_id uuid, run_id text UNIQUE, status text, context jsonb,
      workflow_id uuid, ended_at timestamptz, result jsonb, error_message text, updated_at timestamptz);
  `);
  const { default: router } = await import('../../routes/execution.js');
  ({ pollAndProcess } = await import('../../callback-worker.js'));
  app = express(); app.use(express.json()); app.use('/api/brain', router);
});

beforeEach(async () => {
  vi.clearAllMocks();
  await pool.query('TRUNCATE callback_queue, decision_log, task_runs, suggestions, tasks RESTART IDENTITY');
  taskId = randomUUID(); suggestionId = randomUUID(); runId = randomUUID();
  await pool.query('INSERT INTO suggestions(id,status) VALUES($1,$2)', [suggestionId, 'in_progress']);
  await pool.query('INSERT INTO tasks(id,task_type,status,payload) VALUES($1,$2,$3,$4)',
    [taskId, 'suggestion_plan', 'in_progress', { suggestion_id: suggestionId, current_run_id: runId }]);
});
afterAll(async () => {
  if (pool) await pool.end();
  if (admin) { await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end(); }
});

const receipt = () => ({ task_id: taskId, run_id: runId, status: 'AI Done',
  result: JSON.stringify({ suggestion_id: suggestionId, identified_layer: 'unknown', status: 'failed', error: 'insufficient information' }) });
async function state() {
  return (await pool.query(`SELECT t.status,t.result,t.blocked_detail,s.status AS suggestion_status,
    (SELECT status FROM task_runs WHERE run_id=$2) AS run_status,
    (SELECT count(*)::int FROM callback_queue WHERE processed_at IS NULL) AS pending
    FROM tasks t JOIN suggestions s ON s.id=$3 WHERE t.id=$1`, [taskId, runId, suggestionId])).rows[0];
}

describe('suggestion plan callback with PostgreSQL', () => {
  it('records semantic failure through HTTP without dispatch and preserves null exit code', async () => {
    const res = await request(app).post('/api/brain/execution-callback').send(receipt());
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.new_status).toBe('failed');
    const row = await state();
    expect(row.status).toBe('failed'); expect(row.suggestion_status).toBe('failed');
    expect(row.run_status).toBe('failed'); expect(row.pending).toBe(0);
    expect(row.blocked_detail.exit_code).toBeNull();
    const repeated = await request(app).post('/api/brain/execution-callback').send(receipt());
    expect(repeated.status).toBe(200); expect(repeated.body.duplicate).toBe(true);
    expect(Number((await pool.query('SELECT count(*) FROM task_runs WHERE run_id=$1', [runId])).rows[0].count)).toBe(1);
    expect((await state()).pending).toBe(0);
    expect(mockCreateTask).not.toHaveBeenCalled(); expect(runTickSafe).not.toHaveBeenCalled(); expect(handleTaskFailure).not.toHaveBeenCalled();
  });

  it('rolls back the task and suggestion after a transaction failure, then worker replays the durable receipt', async () => {
    await pool.query(`CREATE OR REPLACE FUNCTION ${schema}.reject_suggestion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test fault'; END $$;
      CREATE TRIGGER reject_suggestion BEFORE UPDATE ON suggestions FOR EACH ROW EXECUTE FUNCTION ${schema}.reject_suggestion()`);
    try {
      const res = await request(app).post('/api/brain/execution-callback').send(receipt());
      expect(res.status).toBe(500);
      let row = await state();
      expect(row.status).toBe('in_progress'); expect(row.suggestion_status).toBe('in_progress');
      expect(row.run_status).toBeNull(); expect(row.pending).toBe(1);
    } finally { await pool.query('DROP TRIGGER IF EXISTS reject_suggestion ON suggestions'); }
    await pollAndProcess();
    const row = await state();
    expect(row.status).toBe('failed'); expect(row.suggestion_status).toBe('failed');
    expect(row.run_status).toBe('failed'); expect(row.pending).toBe(0);
    expect(mockCreateTask).not.toHaveBeenCalled(); expect(runTickSafe).not.toHaveBeenCalled(); expect(handleTaskFailure).not.toHaveBeenCalled();
  });

  it('recovers a run ledger failure after commit on queue replay', async () => {
    await pool.query(`CREATE OR REPLACE FUNCTION ${schema}.reject_run_finish() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test fault'; END $$;
      CREATE TRIGGER reject_run_finish BEFORE UPDATE ON task_runs FOR EACH ROW EXECUTE FUNCTION ${schema}.reject_run_finish()`);
    try {
      const res = await request(app).post('/api/brain/execution-callback').send(receipt());
      expect(res.status).toBe(500);
      const row = await state();
      expect(row.status).toBe('failed'); expect(row.suggestion_status).toBe('failed');
      expect(row.run_status).toBe('running'); expect(row.pending).toBe(1);
    } finally { await pool.query('DROP TRIGGER IF EXISTS reject_run_finish ON task_runs'); }
    await pollAndProcess();
    const row = await state(); expect(row.run_status).toBe('failed'); expect(row.pending).toBe(0);
    expect(mockCreateTask).not.toHaveBeenCalled(); expect(runTickSafe).not.toHaveBeenCalled(); expect(handleTaskFailure).not.toHaveBeenCalled();
  });

  it('preserves a concurrently resolved suggestion and records the mismatch', async () => {
    const editor = await pool.connect();
    let pending;
    try {
      await editor.query('BEGIN');
      await editor.query("UPDATE suggestions SET status='processed' WHERE id=$1", [suggestionId]);
      pending = request(app).post('/api/brain/execution-callback').send(receipt()).then(result => result);
      let waiting = false;
      for (let i = 0; i < 100 && !waiting; i++) {
        const result = await pool.query(`SELECT 1 FROM pg_stat_activity WHERE pid <> pg_backend_pid()
          AND datname = current_database() AND wait_event_type = 'Lock'
          AND query LIKE 'UPDATE suggestions SET status = %'`);
        waiting = result.rowCount > 0;
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 30));
      }
      expect(waiting, 'HTTP transaction must actually wait on the concurrent update').toBe(true);
      await editor.query('COMMIT');
    } finally {
      await editor.query('ROLLBACK').catch(() => {});
      editor.release();
    }
    const res = await pending;
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = await state(); expect(row.status).toBe('failed'); expect(row.suggestion_status).toBe('processed');
    expect(row.result.suggestion_plan_resolution.status).toBe('conflict_or_missing');
    expect(row.run_status).toBe('failed'); expect(mockCreateTask).not.toHaveBeenCalled();
    expect(runTickSafe).not.toHaveBeenCalled(); expect(handleTaskFailure).not.toHaveBeenCalled();
  });
  it('does not overwrite a run owned by another task and records a visible conflict', async () => {
    const otherTask = randomUUID();
    await pool.query("INSERT INTO task_runs(task_id,run_id,status,ended_at) VALUES($1,$2,'success',now())", [otherTask,runId]);
    const res = await request(app).post('/api/brain/execution-callback').send(receipt());
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = await state();
    const run = (await pool.query('SELECT task_id,status FROM task_runs WHERE run_id=$1', [runId])).rows[0];
    expect(run).toEqual({ task_id:otherTask, status:'success' });
    expect(row.result.suggestion_plan_run_resolution.status).toBe('conflict_or_missing');
    expect(row.status).toBe('failed'); expect(row.suggestion_status).toBe('failed'); expect(row.pending).toBe(0);
    expect(mockCreateTask).not.toHaveBeenCalled(); expect(runTickSafe).not.toHaveBeenCalled(); expect(handleTaskFailure).not.toHaveBeenCalled();
  });

});
