/**
 * workflow-run-lost-deadline.pg.integration.test.js — 真实 pg 只钉 SQL 本身（任务 c2d73868）。
 *
 * fakePool 按子串匹配验不出 `COALESCE(started_at, due_at, created_at) < NOW() - ($1::bigint * interval '1 millisecond')`
 * 这类占位符/类型/区间写法错——只有真的对着 tasks 表跑一遍才测得出。ssh 仍是桩，绝不真发。
 * 门控：连不上 PG 整个 describe 跳过；每个用例 BEGIN/ROLLBACK 不污染共享测试库。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../db-config.js';
import { runWorkflowRunLostDeadline, LOST_REASON } from '../workflow-run-lost-deadline.js';

let DB_AVAILABLE = false;
{
  let probePool;
  try {
    probePool = new pg.Pool({ ...DB_DEFAULTS, max: 1, connectionTimeoutMillis: 2000 });
    await probePool.query('SELECT 1');
    DB_AVAILABLE = true;
  } catch {
    DB_AVAILABLE = false;
  } finally {
    if (probePool) await probePool.end().catch(() => {});
  }
}

describe.skipIf(!DB_AVAILABLE)('workflow-run-lost-deadline — pg 集成（真实到期 SQL，不 mock pg）', () => {
  let pool;
  let client;

  beforeAll(async () => { pool = new pg.Pool({ ...DB_DEFAULTS, max: 1 }); });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => { client = await pool.connect(); await client.query('BEGIN'); });
  afterEach(async () => { await client.query('ROLLBACK'); client.release(); });

  // tasks 时间列都是 timestamp without time zone：用 NOW() - interval 写入，和 job 里 NOW() 比较同一会话时区，
  // 不用 ISO 'Z' 字符串（时区被忽略当本地钟存，会话 TZ 非 UTC 时 5h 前的行看起来在未来——时区案变体）。
  let seq = 0;
  async function insertTask({ type, payload, startedAgo = null, dueAgo = null, status = 'in_progress' }) {
    seq += 1;
    const { rows } = await client.query(
      `INSERT INTO tasks (title, task_type, status, priority, payload, started_at, due_at, created_at)
       VALUES ($1, $2, $3, 'P2', $4::jsonb,
               CASE WHEN $5::text IS NULL THEN NULL ELSE NOW() - $5::interval END,
               CASE WHEN $6::text IS NULL THEN NULL ELSE NOW() - $6::interval END,
               NOW()) RETURNING id`,
      [`wf-lost-it-${type}-${seq}-${Date.now()}`, type, status, JSON.stringify(payload), startedAgo, dueAgo],
    );
    return rows[0].id;
  }

  it('5h 前起跑的镜像单 + 直派单判 lost；1h 前的与已终态的不动；判据只看 started_at/due_at/created_at 三者最早可用者', async () => {
    const stale = await insertTask({ type: 'device_job', payload: { serial: 'S1', source: 'cron', read_only: true }, dueAgo: '5 hours' });
    const staleWf = await insertTask({ type: 'workflow_run', payload: { run_id: 'notion-x-1', wf_id: 'JinoHarvestDirect', machine: 'xian-mac-m4' }, startedAgo: '5 hours' });
    const fresh = await insertTask({ type: 'device_job', payload: { serial: 'S2', source: 'cron' }, dueAgo: '1 hour' });
    const notMirror = await insertTask({ type: 'device_job', payload: { serial: 'S3', source: 'oneoff' }, dueAgo: '9 hours' });
    const done = await insertTask({ type: 'device_job', payload: { serial: 'S4', source: 'cron' }, dueAgo: '9 hours', status: 'completed' });

    const execFileFn = vi.fn((cmd, args, opts, cb) => cb(null, 'ok', ''));
    const out = await runWorkflowRunLostDeadline(client, { execFileFn, gateMs: 0 });
    expect(out.lost).toBe(2);

    const { rows } = await client.query(
      `SELECT id, status, result->>'reason' AS reason, payload->>'lost_cleanup_at' AS cleaned FROM tasks WHERE id = ANY($1::uuid[])`,
      [[stale, staleWf, fresh, notMirror, done]],
    );
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId[stale]).toMatchObject({ status: 'failed', reason: LOST_REASON });
    expect(byId[stale].cleaned).toBeTruthy();
    expect(byId[staleWf]).toMatchObject({ status: 'failed', reason: LOST_REASON });
    expect(byId[fresh].status).toBe('in_progress');
    expect(byId[notMirror].status).toBe('in_progress');
    expect(byId[done].status).toBe('completed');

    const ev = await client.query(`SELECT task_id, event_type FROM task_events WHERE task_id = ANY($1::uuid[])`, [[stale, staleWf]]);
    expect(ev.rows.map((r) => r.event_type)).toEqual([LOST_REASON, LOST_REASON]);
    // 无 serial→台账查不到、无 tag：执行机善后跳过；staleWf machine 在注册表但无 profile 也跳过 → 零 ssh
    expect(execFileFn).not.toHaveBeenCalled();
  });

  it('总时限 env 缩到 1 分钟：2 分钟前的也判 lost（可配生效）', async () => {
    const id = await insertTask({ type: 'device_job', payload: { serial: 'S9', source: 'cron' }, dueAgo: '2 minutes' });
    const out = await runWorkflowRunLostDeadline(client, {
      execFileFn: vi.fn((c, a, o, cb) => cb(null, '', '')), gateMs: 0,
      env: { WORKFLOW_RUN_DEADLINE_MS: '30000', WORKFLOW_RUN_DEADLINE_GRACE_MS: '30000' },
    });
    expect(out.lost).toBe(1);
    const { rows } = await client.query(`SELECT status FROM tasks WHERE id = $1`, [id]);
    expect(rows[0].status).toBe('failed');
  });
});
