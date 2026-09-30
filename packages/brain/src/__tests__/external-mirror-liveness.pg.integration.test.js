/**
 * external-mirror-liveness.pg.integration.test.js — 真实 pg 只钉判龄 SQL（任务 0004aceb）。
 *
 * fakePool 验不出：tasks.started_at/updated_at 是无时区列（生产实证 public.tasks.*_at = timestamp without time zone，
 * 会话 TZ=Etc/UTC，容器 TZ=Asia/Shanghai → JS 解析漂 8 小时），task_runs 是 timestamptz，payload 里 ISO 串 ::timestamptz，
 * 三类混算的 GREATEST 与脏值守卫必须在真库上跑一遍。门控：连不上 PG 整体 skip；每用例 BEGIN/ROLLBACK。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../db-config.js';
import { EXTERNAL_ACTIVITY_AGE_SQL, externalActivityAgeMs } from '../lib/external-mirror-liveness.js';

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

const AGE_QUERY = `SELECT ${EXTERNAL_ACTIVITY_AGE_SQL} AS external_activity_age_sec FROM tasks WHERE tasks.id = $1`;

describe.skipIf(!DB_AVAILABLE)('external-mirror-liveness — 判龄 SQL pg 集成（真实 SQL，不 mock pg）', () => {
  let pool;
  let client;
  let seq = 0;

  beforeAll(async () => { pool = new pg.Pool({ ...DB_DEFAULTS, max: 1 }); });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => { client = await pool.connect(); await client.query('BEGIN'); });
  afterEach(async () => { await client.query('ROLLBACK'); client.release(); });

  async function insertTask({ taskType = 'device_job', payload = { source: 'cron' }, createdAgo = '60 minutes', startedAgo = '60 minutes', updatedAgo = '40 minutes' }) {
    seq += 1;
    const { rows } = await client.query(
      `INSERT INTO tasks (title, task_type, status, priority, payload, created_at, started_at, updated_at)
       VALUES ($1, $2, 'in_progress', 'P2', $3::jsonb, NOW() - $4::interval, NOW() - $5::interval, NOW() - $6::interval)
       RETURNING id`,
      [`ext-mirror-it-${seq}-${Date.now()}`, taskType, JSON.stringify(payload), createdAgo, startedAgo, updatedAgo],
    );
    return rows[0].id;
  }

  async function ageOf(taskId) {
    const { rows } = await client.query(AGE_QUERY, [taskId]);
    return externalActivityAgeMs(rows[0]);
  }

  const near = (ms, expectedSec, tolSec = 60) => {
    expect(ms).not.toBeNull();
    expect(Math.abs(ms / 1000 - expectedSec)).toBeLessThanOrEqual(tolSec);
  };

  it('只有行时间：年龄 = 最近的 updated_at（无时区列与 NOW() 同会话 TZ 比较，不漂 8 小时）', async () => {
    const id = await insertTask({});
    near(await ageOf(id), 40 * 60);
  });

  it('payload.commander_heartbeat_at（ISO 串）更新 → 年龄取心跳', async () => {
    const id = await insertTask({ payload: { source: 'cron', commander_heartbeat_at: new Date(Date.now() - 5 * 60e3).toISOString() } });
    near(await ageOf(id), 5 * 60);
  });

  it('task_runs 阶段回执（timestamptz）最新 → 年龄取回执', async () => {
    const id = await insertTask({});
    await client.query(
      `INSERT INTO task_runs (task_id, run_id, status, started_at, ended_at)
       VALUES ($1, $2, 'success', NOW() - interval '3 minutes', NOW() - interval '2 minutes')`,
      [id, `social-keyword-leadgen-crontab-pTEST__a1.discovery-${seq}`],
    );
    near(await ageOf(id), 2 * 60);
  });

  it('payload 时间串脏值（非 ISO / 空串）不炸整轮查询，按其余来源判龄', async () => {
    const id = await insertTask({ payload: { source: 'cron', executed_at: 'garbage', commander_heartbeat_at: '' } });
    near(await ageOf(id), 40 * 60);
  });

  it('非 run 类型（dev）→ NULL，不为无关任务多算', async () => {
    const id = await insertTask({ taskType: 'dev', payload: {} });
    expect(await ageOf(id)).toBeNull();
  });
});
