import { vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { privatePgConfig, verifyPrivatePg } from '../../../../../scripts/ci/private-pg-contract.mjs';

// 导入生产db之前校验本人owner，handoff只能落在runner本例TMPDIR。
const env = process.env;
privatePgConfig(env);
if (env.POSTGRES_INTEGRATION !== '1') throw new Error('callback-closure requires private PG integration lane');
const previousHandoffs = env.HANDOFF_DOCS_DIR;
const temporary = realpathSync(tmpdir());
let ownedHandoffs;
if (previousHandoffs) {
  const target = resolve(previousHandoffs), child = relative(temporary, target);
  if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('callback handoffs must stay inside owned TMPDIR');
  const realChild = relative(temporary, realpathSync(target));
  if (!realChild || realChild.startsWith('..') || isAbsolute(realChild)) throw new Error('callback handoff symlink escapes owned TMPDIR');
} else {
  ownedHandoffs = mkdtempSync(join(temporary, 'callback-handoffs-'));
  env.HANDOFF_DOCS_DIR = ownedHandoffs;
}

// 只隔离模型、通知、事件和进程/调度边界；router、SQL、CAS、任务创建与后处理均用真身。
vi.mock('../../tick.js', () => ({ runTickSafe: async () => ({ actions_taken: [] }), getTickStatus: () => ({}) }));
vi.mock('../../thalamus.js', async (original) => ({ ...(await original()), EVENT_TYPES: { TASK_COMPLETED: 'task_completed' },
  processEvent: async () => ({ level: 0, actions: [{ type: 'fallback_to_tick' }] }) }));
vi.mock('../../llm-caller.js', async (original) => ({ ...(await original()), callLLM: async () => { throw new Error('callback fixture forbids models'); } }));
vi.mock('../../notifier.js', async (original) => ({ ...(await original()), notifyTaskCompleted: async () => {}, notifyTaskFailed: async () => {} }));
vi.mock('../../embedding-service.js', async (original) => ({ ...(await original()), generateTaskEmbeddingAsync: async () => {} }));
vi.mock('../../event-bus.js', async (original) => ({ ...(await original()), emit: async () => {}, emitEvent: async () => {} }));
vi.mock('../../events/taskEvents.js', async (original) => ({ ...(await original()), publishTaskCompleted: () => {}, publishTaskFailed: () => {} }));
vi.mock('../../proactive-mouth.js', async (original) => ({ ...(await original()), notifyTaskCompletion: async () => {} }));
vi.mock('../../executor.js', async (original) => {
  const actual = await original();
  return { ...actual, removeActiveProcess: () => {}, triggerCeceliaRun: async () => { throw new Error('callback fixture forbids dispatch'); } };
});
vi.mock('child_process', async (original) => {
  const actual = await original();
  const deny = () => { throw new Error('callback fixture forbids external processes'); };
  return { ...actual, exec: deny, execSync: deny, spawn: deny, spawnSync: deny,
    execFile: deny, execFileSync: deny, fork: deny };
});

let pool, app, fetchSpy;
export async function startCallbackFixture() {
  ({ default: pool } = await import('../../db.js'));
  await verifyPrivatePg(pool, env);
  if (!(await pool.query("SELECT 1 FROM schema_version WHERE version='557'")).rowCount) throw new Error('callback fixture requires full migrations through 557');
  // fetch 绝不允许访问 5221、外网或其它服务。supertest 使用 loopback HTTP，不经过 fetch。
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { throw new Error('callback fixture forbids fetch'); });
  env.CECELIA_INTERNAL_TOKEN = 'callback-closure-local-only';
  const { default: router } = await import('../../routes/execution.js');
  app = express(); app.use(express.json()); app.use(router);
  const { default: tasksRouter } = await import('../../routes/task-tasks.js');
  app.use('/tasks', tasksRouter);
  return pool;
}
export async function stopCallbackFixture() {
  try { if (pool) await pool.end(); } finally {
    fetchSpy?.mockRestore();
    if (ownedHandoffs) { rmSync(ownedHandoffs, { recursive: true, force: true }); delete env.HANDOFF_DOCS_DIR; }
  }
}
export async function sourceTask(taskType, { goalId = null, payload = {}, ...fields } = {}) {
  const id = randomUUID(), runId = randomUUID();
  const row = (await pool.query(`INSERT INTO tasks (id,title,task_type,status,goal_id,payload,claimed_by)
    VALUES ($1,$2,$3,'in_progress',$4,$5,'callback-fixture') RETURNING *`,
  [id, `callback-closure-${id}`, taskType, goalId, { ...payload, current_run_id: runId }])).rows[0];
  return { ...row, runId, ...fields };
}
export function callback(task, result, overrides = {}) {
  return request(app).post('/execution-callback').set('Authorization', 'Bearer callback-closure-local-only')
    .send({ task_id: task.id, run_id: task.runId, status: 'AI Done', result, ...overrides });
}
export async function readTask(id) { return (await pool.query('SELECT * FROM tasks WHERE id=$1', [id])).rows[0]; }

export function createTaskHttp(body) { return request(app).post('/tasks').send(body); }
