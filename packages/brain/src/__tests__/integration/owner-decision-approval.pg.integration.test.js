/**
 * owner_decision 批准/驳回处理器 + 到期默认 sweeper —— 真 PostgreSQL 验证
 * （决策 105a5868 三档协议最后一环，链 bf5088a3 棒 9，任务 8aa79219）。
 *
 * 状态机、事务、行锁、触发器（迁移 469）、decisions 的 CHECK 约束只有真库测得出。
 * 建库→跑全量 migrate.js→用完即删，照 task-governance-guards.pg.integration.test.js。
 * 只连临时库，绝不碰 cecelia 生产库。
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { DB_DEFAULTS } from '../../db-config.js';

const holder = vi.hoisted(() => ({ pool: null }));
vi.mock('../../db.js', () => ({
  default: {
    query: (...a) => holder.pool.query(...a),
    connect: (...a) => holder.pool.connect(...a),
  },
}));
vi.mock('../../actions.js', () => ({ createTask: vi.fn(), updateTask: vi.fn() }));

const { Pool } = pg;
const BRAIN_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

let adminPool;
let pool;
let databaseName;
let approvePendingAction;
let rejectPendingAction;
let expireStaleProposals;
let openOwnerDecisionPendingAction;
let unblockExpiredTasks;
let runOwnerDecisionDeadline;
let resetDeadlineGate;

const quoteIdentifier = (v) => {
  if (!/^odapprove_[a-z0-9_]+$/.test(v)) throw new Error('unsafe database name');
  return `"${v}"`;
};

const detailOf = (over = {}) => ({
  question: 'org_units 第一批数据从哪来？',
  options: ['A: 从 Notion 自动反推，先建表后人补', 'B: 主理人给清单再建表'],
  default: 'A',
  deadline: '2020-01-01T00:00:00Z',
  reversible: true,
  waiting_on: 'human',
  ...over,
});

/** 造一条 blocked owner_decision 任务 + 待办（waiting_on=human 才有待办）。 */
async function mkBlocked({ detail = {}, blockedUntil = '2020-01-01T00:00:00Z', payload = {} } = {}) {
  const d = detailOf(detail);
  const { rows } = await pool.query(
    `INSERT INTO tasks (title, task_type, status, priority, blocked_at, blocked_reason, blocked_detail, blocked_until, payload)
     VALUES ($1, 'research', 'blocked', 'P2', NOW(), 'owner_decision', $2::jsonb, $3, $4::jsonb) RETURNING id`,
    [`odapprove-${randomUUID().slice(0, 8)}`, JSON.stringify(d), blockedUntil, JSON.stringify(payload)],
  );
  const taskId = rows[0].id;
  const pa = await openOwnerDecisionPendingAction(pool, { taskId, title: 't', detail: d });
  return { taskId, paId: pa.id ?? null, detail: d };
}

const getTask = async (id) => (await pool.query('SELECT * FROM tasks WHERE id = $1', [id])).rows[0];
const getPa = async (id) => (await pool.query('SELECT * FROM pending_actions WHERE id = $1', [id])).rows[0];
const decisionsFor = async (taskId) =>
  (await pool.query('SELECT * FROM decisions WHERE source_ref LIKE $1 ORDER BY created_at', [`owner_decision:${taskId}%`])).rows;

beforeAll(async () => {
  databaseName = `odapprove_${process.pid}_${randomUUID().replaceAll('-', '')}`;
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
  pool = new Pool({ ...DB_DEFAULTS, database: databaseName, max: 6 });
  holder.pool = pool;
  ({ approvePendingAction, rejectPendingAction, expireStaleProposals } = await import('../../decision-executor.js'));
  ({ openOwnerDecisionPendingAction } = await import('../../lib/owner-decision.js'));
  ({ unblockExpiredTasks } = await import('../../task-updater.js'));
  ({ runOwnerDecisionDeadline, __resetOwnerDecisionDeadlineForTest: resetDeadlineGate } = await import('../../owner-decision-deadline.js'));
}, 180_000);

afterAll(async () => {
  if (pool) await pool.end();
  if (adminPool && databaseName) {
    await adminPool.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`);
  }
  if (adminPool) await adminPool.end();
}, 30_000);

beforeEach(() => resetDeadlineGate());

describe.sequential('块 A：批准处理器', () => {
  it('approve 选 A：任务回 queued、resolution 写回 payload、待办已处理、decisions 落一条 user 决策', async () => {
    const { taskId, paId } = await mkBlocked({ detail: { deadline: '2099-01-01T00:00:00Z' } });
    const r = await approvePendingAction(paId, 'alex', { choice: 'A' });
    expect(r.success).toBe(true);

    const t = await getTask(taskId);
    expect(t.status).toBe('queued');
    expect(t.blocked_reason).toBeNull();
    expect(t.blocked_detail).toBeNull();
    expect(t.blocked_until).toBeNull();
    const od = t.payload.owner_decision;
    expect(od.resolution).toMatchObject({
      choice: 'A',
      chosen_option: 'A: 从 Notion 自动反推，先建表后人补',
      by: 'alex',
      via: 'approve',
    });
    expect(Date.parse(od.resolution.at)).not.toBeNaN();
    expect(od.question).toBe('org_units 第一批数据从哪来？'); // 协议快照留在 payload（blocked_detail 已被清空）

    const pa = await getPa(paId);
    expect(pa.status).toBe('approved');
    expect(pa.reviewed_by).toBe('alex');

    const ds = await decisionsFor(taskId);
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({ category: 'decision', made_by: 'user', topic: 'org_units 第一批数据从哪来？' });
    expect(ds[0].decision).toContain('从 Notion 自动反推');
    expect(ds[0].reason).toContain(taskId);
    expect(ds[0].reason).toContain(paId);
  });

  it('approve 选 B（按选项全文匹配，大小写不敏感）', async () => {
    const { taskId, paId } = await mkBlocked({ detail: { deadline: '2099-01-01T00:00:00Z' } });
    const r = await approvePendingAction(paId, 'alex', { choice: 'b: 主理人给清单再建表' });
    expect(r.success).toBe(true);
    const t = await getTask(taskId);
    expect(t.payload.owner_decision.resolution.choice).toBe('B');
    expect(t.payload.owner_decision.resolution.chosen_option).toBe('B: 主理人给清单再建表');
  });

  it('approve choice="default" 或缺省 choice：都取协议 default', async () => {
    for (const body of [{ choice: 'default' }, {}]) {
      const { taskId, paId } = await mkBlocked({ detail: { deadline: '2099-01-01T00:00:00Z', default: 'B' } });
      const r = await approvePendingAction(paId, 'alex', body);
      expect(r.success).toBe(true);
      const t = await getTask(taskId);
      expect(t.payload.owner_decision.resolution).toMatchObject({ choice: 'B', via: 'approve' });
    }
  });

  it('未知 choice：400，任务/待办/decisions/payload 一个都不动', async () => {
    const { taskId, paId } = await mkBlocked({ detail: { deadline: '2099-01-01T00:00:00Z' } });
    const before = await getTask(taskId);
    const r = await approvePendingAction(paId, 'alex', { choice: 'Z' });
    expect(r.success).toBe(false);
    expect(r.status).toBe(400);
    expect(r.code).toBe('owner_decision_unknown_choice');
    const after = await getTask(taskId);
    expect(after.status).toBe('blocked');
    expect(after.payload).toEqual(before.payload);
    expect((await getPa(paId)).status).toBe('pending_approval');
    expect(await decisionsFor(taskId)).toHaveLength(0);
  });

  it('二次 approve：409，不重复 unblock、不重复写 decisions', async () => {
    const { taskId, paId } = await mkBlocked({ detail: { deadline: '2099-01-01T00:00:00Z' } });
    expect((await approvePendingAction(paId, 'alex', { choice: 'A' })).success).toBe(true);
    const first = await getTask(taskId);
    const second = await approvePendingAction(paId, 'alex', { choice: 'B' });
    expect(second.success).toBe(false);
    expect(second.status).toBe(409);
    const after = await getTask(taskId);
    expect(after.payload.owner_decision.resolution).toEqual(first.payload.owner_decision.resolution);
    expect(after.updated_at).toEqual(first.updated_at);
    expect(await decisionsFor(taskId)).toHaveLength(1);
  });

  it('waiting_on=machine 的任务不该有待办：手造待办点批准 → 400，任务保持 blocked', async () => {
    const { taskId } = await mkBlocked({ detail: { waiting_on: 'machine' } });
    const ins = await pool.query(
      `INSERT INTO pending_actions (action_type, params, context, status, category, priority, source, signature, options, comments)
       VALUES ('owner_decision', $1::jsonb, '{}'::jsonb, 'pending_approval', 'approval', 'urgent', 'test', $2, '[]'::jsonb, '[]'::jsonb) RETURNING id`,
      [JSON.stringify({ task_id: taskId }), `owner-decision:${taskId}`],
    );
    const r = await approvePendingAction(ins.rows[0].id, 'alex', { choice: 'A' });
    expect(r.success).toBe(false);
    expect(r.status).toBe(400);
    expect(r.code).toBe('owner_decision_not_human');
    expect((await getTask(taskId)).status).toBe('blocked');
    expect((await getPa(ins.rows[0].id)).status).toBe('pending_approval');
    expect(await decisionsFor(taskId)).toHaveLength(0);
  });

  it('任务已不在 blocked（被别处放行）：409，待办不被误关', async () => {
    const { taskId, paId } = await mkBlocked({ detail: { deadline: '2099-01-01T00:00:00Z' } });
    await pool.query(`UPDATE tasks SET status='queued', blocked_reason=NULL, blocked_detail=NULL, blocked_until=NULL, blocked_at=NULL WHERE id=$1`, [taskId]);
    const r = await approvePendingAction(paId, 'alex', { choice: 'A' });
    expect(r.success).toBe(false);
    expect(r.status).toBe(409);
    expect((await getPa(paId)).status).toBe('pending_approval');
  });

  it('reject：任务保持 blocked，resolution={choice:null,via:reject}，待办置 rejected；二次 reject 409', async () => {
    const { taskId, paId } = await mkBlocked({ detail: { deadline: '2099-01-01T00:00:00Z' } });
    const r = await rejectPendingAction(paId, 'alex', '这题不该问我');
    expect(r.success).toBe(true);
    const t = await getTask(taskId);
    expect(t.status).toBe('blocked');
    expect(t.blocked_reason).toBe('owner_decision');
    expect(t.payload.owner_decision.resolution).toMatchObject({ choice: null, via: 'reject', by: 'alex', reason: '这题不该问我' });
    const pa = await getPa(paId);
    expect(pa.status).toBe('rejected');
    expect(pa.reviewed_by).toBe('alex');
    expect(await decisionsFor(taskId)).toHaveLength(0);

    const again = await rejectPendingAction(paId, 'alex', 'x');
    expect(again.success).toBe(false);
    expect(again.status).toBe(409);
  });

  it('owner_decision 待办不被时间过期：deadline 已过 expireStaleProposals 不动它，且仍能批准', async () => {
    const { taskId, paId } = await mkBlocked({ detail: { deadline: '2020-01-01T00:00:00Z' } });
    expect((await getPa(paId)).expires_at).not.toBeNull();
    await expireStaleProposals();
    expect((await getPa(paId)).status).toBe('pending_approval');
    const r = await approvePendingAction(paId, 'alex', { choice: 'B' });
    expect(r.success).toBe(true);
    expect((await getTask(taskId)).status).toBe('queued');
  });

  it('非 owner_decision 的既有待办仍会过期（回归：排除条件不误伤）', async () => {
    const ins = await pool.query(
      `INSERT INTO pending_actions (action_type, params, context, status, expires_at, category, priority, source, options, comments)
       VALUES ('request_human_review', '{}'::jsonb, '{}'::jsonb, 'pending_approval', NOW() - interval '1 hour', 'approval', 'normal', 'test', '[]'::jsonb, '[]'::jsonb) RETURNING id`,
    );
    await expireStaleProposals();
    expect((await getPa(ins.rows[0].id)).status).toBe('expired');
  });
});

describe.sequential('块 B：到期默认 sweeper', () => {
  const mkBark = () => vi.fn().mockResolvedValue(true);

  it('可逆 + 有 default + 已到期：按默认放行，via=default_on_deadline，decisions=system，Bark P2 带去重键', async () => {
    const { taskId, paId } = await mkBlocked();
    const bark = mkBark();
    const r = await runOwnerDecisionDeadline(pool, { bark, force: true });
    expect(r.applied).toBeGreaterThanOrEqual(1);

    const t = await getTask(taskId);
    expect(t.status).toBe('queued');
    expect(t.payload.owner_decision.resolution).toMatchObject({
      choice: 'A',
      chosen_option: 'A: 从 Notion 自动反推，先建表后人补',
      by: 'system',
      via: 'default_on_deadline',
    });
    expect((await getPa(paId)).status).toBe('approved');

    const ds = await decisionsFor(taskId);
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({ made_by: 'system', category: 'decision' });
    expect(ds[0].reason).toContain('主理人未在截止前应答，按可逆默认执行，可推翻');

    const call = bark.mock.calls.find(([, , o]) => o?.dedupeKey === `owner_decision_default_${taskId}`);
    expect(call).toBeTruthy();
    expect(call[0]).toMatch(/P2/);
    expect(call[1]).toContain('A');
    expect(call[1]).toContain('推翻');
  });

  it('幂等：同一任务再跑一轮不重复处理、不重复写 decisions、不重复 Bark', async () => {
    const { taskId } = await mkBlocked();
    const bark = mkBark();
    await runOwnerDecisionDeadline(pool, { bark, force: true });
    await runOwnerDecisionDeadline(pool, { bark, force: true });
    expect(await decisionsFor(taskId)).toHaveLength(1);
    expect(bark.mock.calls.filter(([, , o]) => o?.dedupeKey === `owner_decision_default_${taskId}`)).toHaveLength(1);
  });

  it('不可逆：不自动执行，blocked_until 顺延 24h 并留痕次数，Bark P1；同轮/下一轮都不重复', async () => {
    const { taskId, paId } = await mkBlocked({ detail: { reversible: false } });
    const bark = mkBark();
    const t0 = Date.now();
    await runOwnerDecisionDeadline(pool, { bark, force: true });

    const t = await getTask(taskId);
    expect(t.status).toBe('blocked');
    expect(t.blocked_reason).toBe('owner_decision');
    const until = new Date(t.blocked_until).getTime();
    expect(until).toBeGreaterThan(t0 + 23.9 * 3600_000);
    expect(until).toBeLessThan(Date.now() + 24.1 * 3600_000);
    expect(t.payload.owner_decision.deadline_deferrals.count).toBe(1);
    expect(t.payload.owner_decision.resolution).toBeUndefined();
    expect(await decisionsFor(taskId)).toHaveLength(0);
    const pa = await getPa(paId);
    expect(pa.status).toBe('pending_approval');
    // expires_at 是 timestamp without time zone，Node 侧读回会受进程时区影响，所以在 SQL 里按会话时区比较
    const bumped = await pool.query(
      `SELECT expires_at::timestamptz > NOW() + interval '23 hours' AS ok FROM pending_actions WHERE id = $1`,
      [paId],
    );
    expect(bumped.rows[0].ok).toBe(true);

    const barkCalls = bark.mock.calls.filter(([, , o]) => String(o?.dedupeKey).includes(taskId));
    expect(barkCalls).toHaveLength(1);
    expect(barkCalls[0][0]).toMatch(/P1/);

    await runOwnerDecisionDeadline(pool, { bark, force: true });
    expect((await getTask(taskId)).payload.owner_decision.deadline_deferrals.count).toBe(1);
    expect(bark.mock.calls.filter(([, , o]) => String(o?.dedupeKey).includes(taskId))).toHaveLength(1);
  });

  it('顺延到期后再被扫到：次数累加到 2（不静默永卡，也留痕）', async () => {
    const { taskId } = await mkBlocked({ detail: { reversible: false } });
    const bark = mkBark();
    await runOwnerDecisionDeadline(pool, { bark, force: true });
    await pool.query(`UPDATE tasks SET blocked_until = NOW() - interval '1 minute' WHERE id = $1`, [taskId]);
    await runOwnerDecisionDeadline(pool, { bark, force: true });
    expect((await getTask(taskId)).payload.owner_decision.deadline_deferrals.count).toBe(2);
  });

  it('不到期不动：blocked_until 未到 / deadline 未到（blocked_until 早于 deadline 也不提前执行）', async () => {
    const future = await mkBlocked({ detail: { deadline: '2099-01-01T00:00:00Z' }, blockedUntil: '2099-01-01T00:00:00Z' });
    const early = await mkBlocked({ detail: { deadline: '2099-01-01T00:00:00Z' }, blockedUntil: '2020-01-01T00:00:00Z' });
    const bark = mkBark();
    await runOwnerDecisionDeadline(pool, { bark, force: true });
    expect((await getTask(future.taskId)).status).toBe('blocked');
    expect((await getTask(early.taskId)).status).toBe('blocked');
    expect(await decisionsFor(early.taskId)).toHaveLength(0);
  });

  it('只管 waiting_on=human：machine 型不碰', async () => {
    const { taskId } = await mkBlocked({ detail: { waiting_on: 'machine' } });
    await runOwnerDecisionDeadline(pool, { bark: mkBark(), force: true });
    expect((await getTask(taskId)).status).toBe('blocked');
  });

  it('主理人已驳回的不被默认覆盖', async () => {
    const { taskId, paId } = await mkBlocked();
    await rejectPendingAction(paId, 'alex', '先别动');
    await runOwnerDecisionDeadline(pool, { bark: mkBark(), force: true });
    const t = await getTask(taskId);
    expect(t.status).toBe('blocked');
    expect(t.payload.owner_decision.resolution.via).toBe('reject');
  });

  it('自 gate：10 分钟内第二次调用直接 skipped（不 force）', async () => {
    const bark = mkBark();
    await runOwnerDecisionDeadline(pool, { bark });
    const second = await runOwnerDecisionDeadline(pool, { bark });
    expect(second.skipped).toBe(true);
  });

  it('单条失败不拖垮整轮：一条任务的解阻塞被硬依赖拦住，其余照常处理', async () => {
    const stuck = await mkBlocked();
    const ok = await mkBlocked();
    const dep = await pool.query(
      `INSERT INTO tasks (title, task_type, status, priority) VALUES ('dep', 'research', 'queued', 'P2') RETURNING id`,
    );
    await pool.query(
      `INSERT INTO task_dependencies (from_task_id, to_task_id, edge_type, status) VALUES ($1, $2, 'hard', 'pending')`,
      [stuck.taskId, dep.rows[0].id],
    );
    const r = await runOwnerDecisionDeadline(pool, { bark: mkBark(), force: true });
    expect(r.failed).toBeGreaterThanOrEqual(1);
    expect((await getTask(stuck.taskId)).status).toBe('blocked');
    expect((await getTask(stuck.taskId)).payload.owner_decision?.resolution).toBeUndefined();
    expect((await getTask(ok.taskId)).status).toBe('queued');
  });
});

describe.sequential('unblockExpiredTasks 不再吞掉等主理人的决策', () => {
  it('waiting_on=human 的 owner_decision 到期不被自动放行；machine 型与其它 reason 照旧放行', async () => {
    const human = await mkBlocked();
    const machine = await mkBlocked({ detail: { waiting_on: 'machine' } });
    const other = await pool.query(
      `INSERT INTO tasks (title, task_type, status, priority, blocked_at, blocked_reason, blocked_until)
       VALUES ('rate', 'research', 'blocked', 'P2', NOW(), 'rate_limit', NOW() - interval '1 minute') RETURNING id`,
    );
    const recovered = await unblockExpiredTasks();
    const ids = recovered.map((x) => x.task_id);
    expect(ids).not.toContain(human.taskId);
    expect(ids).toContain(machine.taskId);
    expect(ids).toContain(other.rows[0].id);
    expect((await getTask(human.taskId)).status).toBe('blocked');
    expect((await getPa(human.paId)).status).toBe('pending_approval');
  });
});
