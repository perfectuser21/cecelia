/**
 * 决策分档机械守卫 —— 真 PostgreSQL 验证（决策 105a5868，链 bf5088a3 棒5，任务 3fad28e0）。
 *
 * mock 测不到的三件事只能上真库：
 *   1. 迁移 469 触发器真的拦 psql/任意 SQL 直写（proven-to-fire），且只拦新写入、存量行不报错
 *   2. createRoutedTask 真库：Objective id 被拒 / KR id 放行；owner_decision 按 waiting_on 分流 pending_action
 *   3. 依赖单一写口：边与 payload.depends_on 双写一致、成环被拒
 *
 * 建库→跑全量 migrate.js→用完即删，照 task-run-primitive.pg.integration.test.js 的手法。
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DB_DEFAULTS } from '../../db-config.js';
import { createRoutedTask } from '../../work-routing-store.js';
import { GoalGuardError } from '../../lib/goal-guard.js';
import { OwnerDecisionProtocolError } from '../../lib/owner-decision.js';
import { addTaskDependency, removeTaskDependency, listTaskDependencies } from '../../lib/task-dependencies.js';

const { Pool } = pg;
const BRAIN_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

let adminPool;
let pool;
let databaseName;
let krId;
let objectiveId;

function quoteIdentifier(value) {
  if (!/^govguard_[a-z0-9_]+$/.test(value)) throw new Error('unsafe database name');
  return `"${value}"`;
}

const goodDetail = (over = {}) => ({
  question: '要不要摘掉 X？',
  options: ['A 摘', 'B 留'],
  default: 'B 留',
  deadline: '2099-01-01T00:00:00Z',
  reversible: true,
  waiting_on: 'human',
  ...over,
});

let seq = 0;
const mk = (over = {}) => {
  seq += 1;
  const { task, ...rest } = over;
  return createRoutedTask(pool, {
    source: 'api',
    source_id: `govguard-${randomUUID()}`,
    title: `govguard-${seq}-${randomUUID().slice(0, 8)}`,
    description: 'd',
    requested_task_type: 'research',
    mutation_intent: 'none',
    declared_domain: 'research',
    metadata: {},
    task: { priority: 'P2', status: 'queued', ...(task || {}) },
    ...rest,
  });
};

beforeAll(async () => {
  databaseName = `govguard_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  adminPool = new Pool({ ...DB_DEFAULTS, database: 'postgres', max: 1 });
  await adminPool.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
  execFileSync(process.execPath, ['src/migrate.js'], {
    cwd: BRAIN_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DB_HOST: DB_DEFAULTS.host,
      DB_PORT: String(DB_DEFAULTS.port),
      DB_USER: DB_DEFAULTS.user,
      DB_PASSWORD: DB_DEFAULTS.password,
      DB_NAME: databaseName,
    },
    stdio: 'pipe',
  });
  pool = new Pool({ ...DB_DEFAULTS, database: databaseName, max: 4 });
  const obj = await pool.query(`INSERT INTO objectives (title, status) VALUES ('govguard-obj', 'active') RETURNING id`);
  objectiveId = obj.rows[0].id;
  const kr = await pool.query(
    `INSERT INTO key_results (objective_id, title, status) VALUES ($1, 'govguard-kr', 'active') RETURNING id`,
    [objectiveId],
  );
  krId = kr.rows[0].id;
}, 180_000);

afterAll(async () => {
  if (pool) await pool.end();
  if (adminPool && databaseName) {
    await adminPool.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`);
  }
  if (adminPool) await adminPool.end();
}, 30_000);

describe.sequential('迁移 469：owner_decision 触发器（psql 直写也拦）', () => {
  it('触发器存在且是 BEFORE INSERT OR UPDATE', async () => {
    const { rows } = await pool.query(
      `SELECT pg_get_triggerdef(oid) AS def FROM pg_trigger
        WHERE tgrelid = 'tasks'::regclass AND tgname = 'trg_tasks_owner_decision_protocol'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].def).toMatch(/BEFORE INSERT OR UPDATE/);
  });

  it('proven-to-fire：直插 owner_decision 无 detail → 23514', async () => {
    let err;
    try {
      await pool.query(
        `INSERT INTO tasks (title, task_type, status, priority, blocked_at, blocked_reason)
         VALUES ('trg-bad-1', 'research', 'blocked', 'P2', NOW(), 'owner_decision')`,
      );
    } catch (e) { err = e; }
    expect(err?.code).toBe('23514');
    expect(err?.message).toMatch(/owner_decision_protocol_violation/);
  });

  it.each([
    ['question 缺失', (d) => { delete d.question; }, /question/],
    ['options 只有一项', (d) => { d.options = ['A']; }, /options/],
    ['default 缺失', (d) => { delete d.default; }, /default/],
    ['deadline 不可解析', (d) => { d.deadline = '下周吧'; }, /deadline/],
    ['reversible 非布尔', (d) => { d.reversible = 'yes'; }, /reversible/],
    ['waiting_on 非枚举', (d) => { d.waiting_on = 'owner'; }, /waiting_on/],
  ])('proven-to-fire：直插 %s → 23514 且报出字段', async (_n, mutate, fieldRe) => {
    const d = goodDetail();
    mutate(d);
    let err;
    try {
      await pool.query(
        `INSERT INTO tasks (title, task_type, status, priority, blocked_at, blocked_reason, blocked_detail)
         VALUES ('trg-bad-2', 'research', 'blocked', 'P2', NOW(), 'owner_decision', $1::jsonb)`,
        [JSON.stringify(d)],
      );
    } catch (e) { err = e; }
    expect(err?.code).toBe('23514');
    expect(err?.message).toMatch(fieldRe);
  });

  it('完整协议直插放行；把已有任务 UPDATE 成 owner_decision 缺协议 → 拒', async () => {
    const ok = await pool.query(
      `INSERT INTO tasks (title, task_type, status, priority, blocked_at, blocked_reason, blocked_detail)
       VALUES ('trg-ok', 'research', 'blocked', 'P2', NOW(), 'owner_decision', $1::jsonb) RETURNING id`,
      [JSON.stringify(goodDetail())],
    );
    expect(ok.rows).toHaveLength(1);
    const plain = await pool.query(
      `INSERT INTO tasks (title, task_type, status, priority) VALUES ('trg-plain', 'research', 'queued', 'P2') RETURNING id`,
    );
    let err;
    try {
      await pool.query(
        `UPDATE tasks SET status='blocked', blocked_at=NOW(), blocked_reason='owner_decision' WHERE id=$1`,
        [plain.rows[0].id],
      );
    } catch (e) { err = e; }
    expect(err?.code).toBe('23514');
  });

  it('存量行不回填不报错：旧 owner_decision 行（无协议）改别的列 / 变终态都放行，只有改 blocked_detail 才校验', async () => {
    await pool.query(`ALTER TABLE tasks DISABLE TRIGGER trg_tasks_owner_decision_protocol`);
    const legacy = await pool.query(
      `INSERT INTO tasks (title, task_type, status, priority, blocked_at, blocked_reason)
       VALUES ('trg-legacy', 'research', 'blocked', 'P2', NOW(), 'owner_decision') RETURNING id`,
    );
    await pool.query(`ALTER TABLE tasks ENABLE TRIGGER trg_tasks_owner_decision_protocol`);
    const id = legacy.rows[0].id;

    await pool.query(`UPDATE tasks SET title='trg-legacy-renamed', updated_at=NOW() WHERE id=$1`, [id]);
    await pool.query(`UPDATE tasks SET status='cancelled' WHERE id=$1`, [id]);

    let err;
    try {
      await pool.query(`UPDATE tasks SET blocked_detail = '{"message":"补个说明"}'::jsonb WHERE id=$1`, [id]);
    } catch (e) { err = e; }
    expect(err?.code).toBe('23514');
  });

  it('其它 blocked_reason 完全不受影响', async () => {
    const r = await pool.query(
      `INSERT INTO tasks (title, task_type, status, priority, blocked_at, blocked_reason)
       VALUES ('trg-other', 'research', 'blocked', 'P2', NOW(), 'billing_cap') RETURNING id`,
    );
    expect(r.rows).toHaveLength(1);
  });
});

describe.sequential('守卫 1：createRoutedTask 真库 goal_id 必须是 KR', () => {
  it('违规输入被拒：Objective id → GoalGuardError（is_objective，列出 KR），且没有任务落库', async () => {
    const title = `goal-bad-${randomUUID().slice(0, 8)}`;
    const err = await mk({ title, task: { priority: 'P2', status: 'queued', goal_id: objectiveId } }).catch((e) => e);
    expect(err).toBeInstanceOf(GoalGuardError);
    expect(err.details.is_objective).toBe(true);
    expect(err.details.key_results.map((k) => k.id)).toContain(krId);
    const { rows } = await pool.query('SELECT 1 FROM tasks WHERE title = $1', [title]);
    expect(rows).toHaveLength(0);
  });

  it('KR id 放行并落 goal_id；不给 goal_id 行为不变', async () => {
    const withKr = await mk({ task: { priority: 'P2', status: 'queued', goal_id: krId } });
    const without = await mk({});
    const { rows } = await pool.query('SELECT id, goal_id FROM tasks WHERE id = ANY($1::uuid[])', [[withKr.task_id, without.task_id]]);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.goal_id]));
    expect(byId[withKr.task_id]).toBe(krId);
    expect(byId[without.task_id]).toBeNull();
  });
});

describe.sequential('守卫 2：createRoutedTask 真库 owner_decision', () => {
  it('违规输入被拒：owner_decision 无协议 → OwnerDecisionProtocolError，无任务落库', async () => {
    const title = `od-bad-${randomUUID().slice(0, 8)}`;
    const err = await mk({
      title, task: { priority: 'P2', status: 'blocked', blocked_reason: 'owner_decision' },
    }).catch((e) => e);
    expect(err).toBeInstanceOf(OwnerDecisionProtocolError);
    const { rows } = await pool.query('SELECT 1 FROM tasks WHERE title = $1', [title]);
    expect(rows).toHaveLength(0);
  });

  it('human：落 blocked_reason/blocked_detail 且生成 pending_action（signature 带任务 id，expires_at=deadline）', async () => {
    const r = await mk({
      task: { priority: 'P2', status: 'blocked', blocked_at: new Date().toISOString(), blocked_reason: 'owner_decision', blocked_detail: goodDetail() },
    });
    const t = await pool.query('SELECT status, blocked_reason, blocked_detail FROM tasks WHERE id=$1', [r.task_id]);
    expect(t.rows[0].status).toBe('blocked');
    expect(t.rows[0].blocked_reason).toBe('owner_decision');
    expect(t.rows[0].blocked_detail.waiting_on).toBe('human');
    const pa = await pool.query(
      `SELECT action_type, status, options, expires_at FROM pending_actions WHERE signature = $1`,
      [`owner-decision:${r.task_id}`],
    );
    expect(pa.rows).toHaveLength(1);
    expect(pa.rows[0]).toMatchObject({ action_type: 'owner_decision', status: 'pending_approval' });
    expect(pa.rows[0].options).toEqual(['A 摘', 'B 留']);
  });

  it('machine：落库但不生成 pending_action（不进主理人待办）', async () => {
    const r = await mk({
      task: { priority: 'P2', status: 'blocked', blocked_at: new Date().toISOString(), blocked_reason: 'owner_decision', blocked_detail: goodDetail({ waiting_on: 'machine' }) },
    });
    const pa = await pool.query(`SELECT 1 FROM pending_actions WHERE signature = $1`, [`owner-decision:${r.task_id}`]);
    expect(pa.rows).toHaveLength(0);
  });
});

describe.sequential('依赖单一写口：真库', () => {
  const newTask = async () => (await mk({})).task_id;

  it('addTaskDependency：边与 payload.depends_on 双写一致，重复幂等', async () => {
    const a = await newTask();
    const b = await newTask();
    expect(await addTaskDependency(pool, { fromTaskId: a, toTaskId: b })).toEqual({ added: true });
    expect(await addTaskDependency(pool, { fromTaskId: a, toTaskId: b })).toEqual({ added: false });
    const edge = await pool.query('SELECT edge_type FROM task_dependencies WHERE from_task_id=$1 AND to_task_id=$2', [a, b]);
    expect(edge.rows).toEqual([{ edge_type: 'hard' }]);
    const t = await pool.query('SELECT payload FROM tasks WHERE id=$1', [a]);
    expect(t.rows[0].payload.depends_on).toEqual([b]);
    const listed = await listTaskDependencies(pool, a);
    expect(listed.blocked_by.map((x) => x.id)).toEqual([b]);
    const back = await listTaskDependencies(pool, b);
    expect(back.blocks.map((x) => x.id)).toEqual([a]);
  });

  it('违规输入被拒：A→B 再 B→A 成环 → dependency_cycle；边未落库', async () => {
    const a = await newTask();
    const b = await newTask();
    await addTaskDependency(pool, { fromTaskId: a, toTaskId: b });
    const err = await addTaskDependency(pool, { fromTaskId: b, toTaskId: a }).catch((e) => e);
    expect(err.code).toBe('dependency_cycle');
    const { rows } = await pool.query('SELECT 1 FROM task_dependencies WHERE from_task_id=$1 AND to_task_id=$2', [b, a]);
    expect(rows).toHaveLength(0);
  });

  it('createRoutedTask 建单带 payload.depends_on → 同事务写出 hard 边（所有建单入口统一）', async () => {
    const dep = await newTask();
    const r = await mk({ metadata: { depends_on: [dep] } });
    const edge = await pool.query('SELECT edge_type FROM task_dependencies WHERE from_task_id=$1 AND to_task_id=$2', [r.task_id, dep]);
    expect(edge.rows).toEqual([{ edge_type: 'hard' }]);
  });

  it('removeTaskDependency：删边并从 payload.depends_on 摘掉', async () => {
    const a = await newTask();
    const b = await newTask();
    await addTaskDependency(pool, { fromTaskId: a, toTaskId: b });
    expect((await removeTaskDependency(pool, { fromTaskId: a, toTaskId: b })).removed).toBe(true);
    const t = await pool.query('SELECT payload FROM tasks WHERE id=$1', [a]);
    expect(t.rows[0].payload.depends_on).toEqual([]);
    const { rows } = await pool.query('SELECT 1 FROM task_dependencies WHERE from_task_id=$1', [a]);
    expect(rows).toHaveLength(0);
  });
});
