/**
 * 定时引擎复活（任务 3d0db274）—— 真 PostgreSQL 验证。
 *
 * 假库单测（recurring-engine.test.js）验的是分支逻辑；这里验 SQL 本身：CAS 占位、next_run_at 文本回写比较、
 * payload jsonb 过滤、skip_streak 列（迁移 489）、过期取消 SQL、真 createTask 建单后回写 assigned_to/due_at。
 * 建临时库 → 跑全量 migrate.js → 用完即删，照 owner-decision-approval.pg.integration.test.js。只连临时库。
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { DB_DEFAULTS } from '../../db-config.js';

const holder = vi.hoisted(() => ({ pool: null }));
vi.mock('../../db.js', () => ({
  default: {
    query: (...a) => holder.pool.query(...a),
    connect: (...a) => holder.pool.connect(...a),
  },
}));
vi.mock('../../alerting.js', () => ({ raise: vi.fn().mockResolvedValue(undefined) }));

const { Pool } = pg;
const BRAIN_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

let adminPool;
let pool;
let databaseName;
let runRecurringTasksJob;

const quoteIdentifier = (v) => {
  if (!/^recurring_it_[a-z0-9_]+$/.test(v)) throw new Error('unsafe database name');
  return `"${v}"`;
};

const getTpl = async (id) => (await pool.query(
  'SELECT *, next_run_at::text AS nr_text FROM recurring_tasks WHERE id = $1', [id],
)).rows[0];
const instancesOf = async (id) => (await pool.query(
  `SELECT id, status, assigned_to, to_char(due_at, 'YYYY-MM-DD HH24:MI:SS') AS due_text, payload, trigger_source, blocked_reason
     FROM tasks WHERE payload->>'recurring_task_id' = $1 ORDER BY created_at`, [id],
)).rows;

async function mkTemplate({ cron = '0 22 * * *', nextRunAt = null, template = {} } = {}) {
  const { rows } = await pool.query(
    `INSERT INTO recurring_tasks (title, task_type, cron_expression, recurrence_type, is_active, next_run_at, template)
     VALUES ($1, 'research', $2, 'cron', true, $3, $4::jsonb) RETURNING id`,
    [`recurring-it-${randomUUID().slice(0, 8)}`, cron, nextRunAt, JSON.stringify({ task_type: 'research', ...template })],
  );
  return rows[0].id;
}

beforeAll(async () => {
  databaseName = `recurring_it_${process.pid}_${randomUUID().replaceAll('-', '')}`;
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
  ({ runRecurringTasksJob } = await import('../../recurring.js'));
}, 180_000);

afterAll(async () => {
  if (pool) await pool.end();
  if (adminPool && databaseName) {
    await adminPool.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`);
  }
  if (adminPool) await adminPool.end();
}, 30_000);

describe.sequential('recurring 引擎（真库）', () => {
  it('迁移 489：skip_streak 列存在且默认 0', async () => {
    const id = await mkTemplate();
    expect((await getTpl(id)).skip_streak).toBe(0);
    await pool.query('UPDATE recurring_tasks SET is_active = false WHERE id = $1', [id]);
  });

  it('首次启用只写基线；到点后并发两次调用只建 1 张，字段透传落库', async () => {
    const raiseFn = vi.fn().mockResolvedValue(undefined);
    const id = await mkTemplate({ template: { assigned_to: 'alex', due_offset_minutes: 90, expires_after_minutes: 120, dept: 'ops' } });

    // 北京 22:00:10（UTC 14:00:10）首次启用：不建单，基线落次日 22:00
    await runRecurringTasksJob(pool, { now: new Date('2026-09-29T14:00:10Z'), raiseFn });
    expect(await instancesOf(id)).toHaveLength(0);
    expect(new Date((await getTpl(id)).next_run_at).toISOString()).toBe('2026-09-30T14:00:00.000Z');

    // 次日北京 22:00:20：并发两次，只建 1 张
    const now = new Date('2026-09-30T14:00:20Z');
    await Promise.all([runRecurringTasksJob(pool, { now, raiseFn }), runRecurringTasksJob(pool, { now, raiseFn })]);
    const inst = await instancesOf(id);
    expect(inst).toHaveLength(1);
    expect(inst[0]).toMatchObject({ status: 'queued', assigned_to: 'alex', trigger_source: 'recurring', due_text: '2026-09-30 15:30:00' });
    expect(inst[0].payload).toMatchObject({ recurring_task_id: id, recurring_slot: '2026-09-30T14:00:00.000Z', expires_at: '2026-09-30T16:00:00.000Z' });

    const tpl = await getTpl(id);
    expect(tpl.last_run_status).toBe('created');
    expect(tpl.skip_streak).toBe(0);
    expect(new Date(tpl.last_run_at).toISOString()).toBe('2026-09-30T14:00:00.000Z');
    expect(new Date(tpl.next_run_at).toISOString()).toBe('2026-10-01T14:00:00.000Z');
  });

  it('上一张还在 queued → 下个时间点跳过叠单，skip_streak=1；过期后被取消(unclaimed_expired)', async () => {
    const raiseFn = vi.fn().mockResolvedValue(undefined);
    const id = await mkTemplate({ nextRunAt: '2026-10-01T14:00:00Z', template: { expires_after_minutes: 60 } });
    await runRecurringTasksJob(pool, { now: new Date('2026-10-01T14:00:05Z'), raiseFn });
    expect(await instancesOf(id)).toHaveLength(1);

    await runRecurringTasksJob(pool, { now: new Date('2026-10-02T14:00:05Z'), raiseFn });
    expect(await instancesOf(id)).toHaveLength(1);
    const tpl = await getTpl(id);
    expect(tpl.last_run_status).toBe('skipped_overlap');
    expect(tpl.skip_streak).toBe(1);

    // 第一张的 expires_at = 10-01 15:00Z，早已过期 → 取消
    const inst = await instancesOf(id);
    expect(inst[0].status).toBe('cancelled');
    expect(inst[0].blocked_reason).toBe('unclaimed_expired');
    expect(raiseFn).toHaveBeenCalledWith('P2', 'recurring_instance_expired', expect.any(String));
  });

  it('迟到超窗：missed，不建单，推进 next_run_at', async () => {
    const raiseFn = vi.fn().mockResolvedValue(undefined);
    const id = await mkTemplate({ nextRunAt: '2026-10-03T14:00:00Z' });
    await runRecurringTasksJob(pool, { now: new Date('2026-10-03T15:00:00Z'), raiseFn });
    expect(await instancesOf(id)).toHaveLength(0);
    const tpl = await getTpl(id);
    expect(tpl.last_run_status).toBe('missed');
    expect(new Date(tpl.next_run_at).toISOString()).toBe('2026-10-04T14:00:00.000Z');
  });

  it('next_run_at 带微秒（旧数据 NOW() 写入）也能 CAS 抢到，不会永远卡住', async () => {
    const raiseFn = vi.fn().mockResolvedValue(undefined);
    const id = await mkTemplate({ cron: '* * * * *' });
    await pool.query(`UPDATE recurring_tasks SET next_run_at = '2026-10-05T14:00:00.123456Z' WHERE id = $1`, [id]);
    await runRecurringTasksJob(pool, { now: new Date('2026-10-05T14:00:30Z'), raiseFn });
    expect(await instancesOf(id)).toHaveLength(1);
  });
});
