/** OpenClaw 运行记录采集的游标与 upsert（真 Postgres）。每个用例在事务里跑，结束回滚。 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';
import { readCursorMs, upsertRuns, notifyFailureStreaks } from '../../openclaw-run-ingest.js';

let pool, client, workflow;
beforeAll(async () => {
  if (!(DB_DEFAULTS.database === 'cecelia_scratch' || (process.env.CI === 'true' && DB_DEFAULTS.database === 'cecelia_test'))) throw new Error('仅允许隔离 scratch 或 CI 测试库');
  pool = new pg.Pool({ ...DB_DEFAULTS, max: 1 });
});
afterAll(async () => { await pool?.end(); });
beforeEach(async () => {
  client = await pool.connect();
  await client.query('BEGIN');
  const vs = randomUUID(), cap = randomUUID();
  workflow = randomUUID();
  await client.query("INSERT INTO value_streams(id,name) VALUES($1,'采集验收')", [vs]);
  await client.query("INSERT INTO capabilities(id,name,parent_journey_id) VALUES($1,'采集能力',$2)", [cap, vs]);
  await client.query("INSERT INTO workflows(id,capability_id,key,name,channel) VALUES($1,$2,$3,'采集流程','test')", [workflow, cap, `ingest-test-${workflow}`]);
});
afterEach(async () => { await client.query('ROLLBACK'); client.release(); });

const T = new Date('2026-10-07T01:00:00Z');
const mk = (id, extra = {}) => ({
  run_id: `openclaw:${id}`,
  trigger_ref: 'OPC 午前班会（11:50）',
  executor_kind: 'agent',
  executor_id: 'openclaw:main',
  started_at: T,
  ended_at: new Date(T.getTime() + 5000),
  outcome: 'pass',
  error: null,
  detail: { source: 'openclaw', job_id: 'j1', task_id: id, summary: 's', status: 'succeeded' },
  ...extra,
});
const one = async (sql, params) => (await client.query(sql, params)).rows[0];

describe('readCursorMs', () => {
  it('无 openclaw 运行 → null；有则返回最大 started_at 减 1 小时', async () => {
    expect(await readCursorMs(client)).toBeNull();
    await client.query(`INSERT INTO runs(run_id,trigger_kind,started_at) VALUES('sched:x','schedule','2026-10-08T00:00:00Z')`);
    expect(await readCursorMs(client)).toBeNull();
    await upsertRuns(client, [mk('a'), mk('b', { started_at: new Date(T.getTime() - 60000), ended_at: null, outcome: 'running' })]);
    expect(await readCursorMs(client)).toBe(T.getTime() - 3600_000);
  });
});

describe('upsertRuns', () => {
  it('同一批写两次：仍 2 行，第二次 written 为 0', async () => {
    const rows = [mk('a'), mk('b')];
    expect(await upsertRuns(client, rows)).toEqual({ written: 2, failed_rows: 0 });
    expect(await upsertRuns(client, rows)).toEqual({ written: 0, failed_rows: 0 });
    expect((await one("SELECT count(*)::int AS n FROM runs WHERE run_id LIKE 'openclaw:%'")).n).toBe(2);
  });

  it('先写 running 再写 pass：同一行更新结果与结束时间', async () => {
    await upsertRuns(client, [mk('a', { outcome: 'running', ended_at: null })]);
    const r = await upsertRuns(client, [mk('a')]);
    expect(r).toEqual({ written: 1, failed_rows: 0 });
    const run = await one("SELECT outcome, ended_at, duration_ms FROM runs WHERE run_id='openclaw:a'");
    expect(run.outcome).toBe('pass');
    expect(run.ended_at.getTime()).toBe(T.getTime() + 5000);
    expect(run.duration_ms).toBe(5000);
    expect((await one("SELECT count(*)::int AS n FROM runs WHERE run_id='openclaw:a'")).n).toBe(1);
  });

  it('固定补列：trigger_kind=schedule、header_source=owner，错误与详情落库', async () => {
    await upsertRuns(client, [mk('a', { outcome: 'fail', error: '炸了' })]);
    expect(await one("SELECT * FROM runs WHERE run_id='openclaw:a'")).toMatchObject({
      trigger_kind: 'schedule', header_source: 'owner', trigger_ref: 'OPC 午前班会（11:50）',
      executor_kind: 'agent', executor_id: 'openclaw:main', outcome: 'fail', error: '炸了',
      detail: { source: 'openclaw', task_id: 'a', status: 'succeeded' },
    });
  });

  it('任务名对上闹钟总账 → 带出 schedule_entry_id 与 workflow_id；对不上 → 两列为空', async () => {
    const entry = await one(`INSERT INTO ops_schedule_entries(source,host_alias,label,kind,active,workflow_id)
      VALUES('openclaw','mmv','OPC 午前班会（11:50）','openclaw_cron',true,$1) RETURNING id`, [workflow]);
    await upsertRuns(client, [mk('a'), mk('b', { trigger_ref: '没登记的任务' })]);
    expect(await one("SELECT schedule_entry_id, workflow_id FROM runs WHERE run_id='openclaw:a'"))
      .toEqual({ schedule_entry_id: entry.id, workflow_id: workflow });
    expect(await one("SELECT schedule_entry_id, workflow_id FROM runs WHERE run_id='openclaw:b'"))
      .toEqual({ schedule_entry_id: null, workflow_id: null });
  });

  it('一批中夹一行会被 DB 拒绝的数据（started_at 为 Invalid Date）：其余行照常写入、failed_rows===1', async () => {
    // 外层测试在事务里，单行失败会让事务进入 aborted；这里给每次 query 套 SAVEPOINT，模拟生产里“失败不影响后续语句”的连接
    const db = {
      query: async (sql, params) => {
        await client.query('SAVEPOINT row_guard');
        try {
          const res = await client.query(sql, params);
          await client.query('RELEASE SAVEPOINT row_guard');
          return res;
        } catch (e) {
          await client.query('ROLLBACK TO SAVEPOINT row_guard');
          throw e;
        }
      },
    };
    const bad = mk('bad', { started_at: new Date('not-a-date'), ended_at: null, outcome: 'running' });
    const r = await upsertRuns(db, [mk('ok1'), bad, mk('ok2')]);
    expect(r).toEqual({ written: 2, failed_rows: 1 });
    const ids = (await client.query("SELECT run_id FROM runs WHERE run_id LIKE 'openclaw:%' ORDER BY run_id")).rows.map((x) => x.run_id);
    expect(ids).toEqual(['openclaw:ok1', 'openclaw:ok2']);
  });

  it('空数组 → written 为 0', async () => {
    expect(await upsertRuns(client, [])).toEqual({ written: 0, failed_rows: 0 });
  });
});

describe('notifyFailureStreaks（真库）', () => {
  it('同任务名 3 条 fail → 发 1 次；其后补一条 pass 则不再发', async () => {
    const t = (i) => new Date(T.getTime() + i * 60000);
    const name = '连败验收任务';
    await upsertRuns(client, [1, 2, 3].map((i) => mk(`s${i}`, {
      trigger_ref: name, outcome: 'fail', error: `炸了${i}`, started_at: t(i), ended_at: t(i),
    })));
    const calls = [];
    const sendBark = async (...args) => { calls.push(args); };
    expect(await notifyFailureStreaks(client, [name], { sendBark, firstRound: false })).toEqual({ notified: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('OpenClaw 任务连续失败');
    expect(calls[0][1]).toBe(`${name} 连续 3 次失败：炸了3`);
    expect(calls[0][2]).toEqual({ dedupeKey: `openclaw-run-streak:${name}:openclaw:s1`, dedupeTtlSec: 604800 });

    await upsertRuns(client, [mk('s4', { trigger_ref: name, started_at: t(4), ended_at: t(4) })]);
    expect(await notifyFailureStreaks(client, [name], { sendBark, firstRound: false })).toEqual({ notified: 0 });
    expect(calls).toHaveLength(1);
  });

  it('running 不计入连败判定', async () => {
    const t = (i) => new Date(T.getTime() + i * 60000);
    const name = '连败验收任务2';
    await upsertRuns(client, [
      ...[1, 2, 3].map((i) => mk(`q${i}`, { trigger_ref: name, outcome: 'timeout', started_at: t(i), ended_at: t(i) })),
      mk('q4', { trigger_ref: name, outcome: 'running', ended_at: null, started_at: t(4) }),
    ]);
    const calls = [];
    const r = await notifyFailureStreaks(client, [name], { sendBark: async (...a) => { calls.push(a); }, firstRound: false });
    expect(r).toEqual({ notified: 1 });
    expect(calls[0][1]).toContain('连续 3 次失败');
  });

  it('连败超过 50 条：dedupeKey 不随窗口滑动；中间有成功则新连败段换键', async () => {
    const t = (i) => new Date(T.getTime() + i * 60000);
    const name = '长连败验收任务';
    const fail = (i) => mk(`L${String(i).padStart(3, '0')}`, {
      trigger_ref: name, outcome: 'fail', error: `炸了${i}`, started_at: t(i), ended_at: t(i),
    });
    await upsertRuns(client, Array.from({ length: 51 }, (_, k) => fail(k + 1)));
    const calls = [];
    const sendBark = async (...args) => { calls.push(args); };
    await notifyFailureStreaks(client, [name], { sendBark, firstRound: false });
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toBe(`${name} 连续 51 次失败：炸了51`);
    const key = calls[0][2].dedupeKey;
    expect(key).toBe(`openclaw-run-streak:${name}:openclaw:L001`);

    await upsertRuns(client, [fail(52)]);
    await notifyFailureStreaks(client, [name], { sendBark, firstRound: false });
    expect(calls).toHaveLength(2);
    expect(calls[1][1]).toBe(`${name} 连续 52 次失败：炸了52`);
    expect(calls[1][2].dedupeKey).toBe(key);

    await upsertRuns(client, [mk('Lok', { trigger_ref: name, started_at: t(53), ended_at: t(53) }),
      ...[54, 55, 56].map(fail)]);
    await notifyFailureStreaks(client, [name], { sendBark, firstRound: false });
    expect(calls).toHaveLength(3);
    expect(calls[2][1]).toBe(`${name} 连续 3 次失败：炸了56`);
    expect(calls[2][2].dedupeKey).toBe(`openclaw-run-streak:${name}:openclaw:L054`);
  });
});
