/**
 * [BEHAVIOR] run 原语 task_runs 真 Postgres 集成 — 唯一写口 startRun/finishRun/findBareRuns
 * 落库真验（sprint 09251224-kernel-66db3dfb，链 bf5088a3 第 1 棒 F1 执行基座）。
 *
 * 覆盖父路: 独立小路（无父路）—— PRD「累积 FR」段注明本 line 无已验收前序 ability。
 *
 * 禁 mock 边（合同「禁 mock 边清单」）：
 *  - 代码 ↔ task_runs 表：startRun INSERT / finishRun UPDATE 写路径 —— 真 pool 连真 PG，
 *    禁 vi.mock('../../db.js') 顶替 INSERT/UPDATE。
 *  - dispatch_events ↔ task_runs：findBareRuns 跨表 LEFT JOIN 裸跑检测 —— 真 PG 两表联查，禁替身。
 * 本文件不含对被改边（db.js / lib/task-run.js）的 vi.mock（INV-1 机械 grep 核查）。
 *
 * 登记进 packages/brain/vitest.config.js 的 POSTGRES_INTEGRATION_TESTS，由 brain-integration
 * job 起真 PG 跑（Generator 实现阶段补登记）。
 *
 * 现状（TDD Red）：packages/brain/src/lib/task-run.js 尚未存在 → 顶层 import 失败 → 全红（预期 Red）。
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pool from '../../db.js';
import { startRun, finishRun, findBareRuns } from '../../lib/task-run.js';

const created = [];

async function seedTask(status = 'in_progress') {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO tasks (id, task_type, status, payload) VALUES ($1,'harness_initiative',$2,'{}'::jsonb)`,
    [id, status],
  );
  created.push(id);
  return id;
}

beforeAll(async () => {
  // 前置：唯一写口原语必须可导入（未实现即 import 失败，本 hook 不会执行 → 全红）
  expect(typeof startRun).toBe('function');
  expect(typeof finishRun).toBe('function');
  expect(typeof findBareRuns).toBe('function');
});

afterAll(async () => {
  if (created.length) {
    await pool.query(`DELETE FROM dispatch_events WHERE task_id = ANY($1::uuid[])`, [created]);
    await pool.query(`DELETE FROM task_runs WHERE task_id = ANY($1::uuid[])`, [created]);
    await pool.query(`DELETE FROM tasks WHERE id = ANY($1::uuid[])`, [created]);
  }
  await pool.end().catch(() => {});
});

describe('run 原语 startRun/finishRun/findBareRuns — 真 Postgres 落库', () => {
  it('startRun 写入恰好一行 running（含 context.source，真 PG）', async () => {
    const t = await seedTask();
    const r = `pg-b01-${randomUUID()}`;
    await startRun({ taskId: t, runId: r, source: 'dispatcher' });
    const { rows } = await pool.query(
      `SELECT status, ended_at, context->>'source' AS source FROM task_runs WHERE run_id=$1`,
      [r],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('running');
    expect(rows[0].ended_at).toBeNull();
    expect(rows[0].source).toBe('dispatcher');
  });

  it('同一 run_id 重复 startRun 幂等，仅一行（ON CONFLICT DO NOTHING）', async () => {
    const t = await seedTask();
    const r = `pg-b02-${randomUUID()}`;
    await startRun({ taskId: t, runId: r, source: 'executor' });
    await startRun({ taskId: t, runId: r, source: 'executor' });
    const { rows } = await pool.query(
      `SELECT count(*)::int AS c FROM task_runs WHERE run_id=$1`,
      [r],
    );
    expect(rows[0].c).toBe(1);
  });

  it('finishRun 补齐 ended_at / exit_code / 产物 / 终态 success（同一行）', async () => {
    const t = await seedTask();
    const r = `pg-b03-${randomUUID()}`;
    await startRun({ taskId: t, runId: r, source: 'openclaw-agent' });
    await finishRun({ runId: r, status: 'completed', exitCode: 0, artifacts: ['pr:1'] });
    const { rows } = await pool.query(
      `SELECT status, ended_at, result FROM task_runs WHERE run_id=$1`,
      [r],
    );
    expect(rows[0].status).toBe('success');
    expect(rows[0].ended_at).not.toBeNull();
    expect(String(rows[0].result.exit_code)).toBe('0');
    expect(Array.isArray(rows[0].result.artifacts)).toBe(true);
    expect(rows[0].result.artifacts[0]).toBe('pr:1');
  });

  it('已结束的 run 再次 finishRun 不覆盖终态（防伪造 succeeded，DB 为真相源）', async () => {
    const t = await seedTask();
    const r = `pg-inv3-${randomUUID()}`;
    await startRun({ taskId: t, runId: r, source: 'bridge' });
    await finishRun({ runId: r, status: 'failed', exitCode: 1, artifacts: [] });
    const before = await pool.query(
      `SELECT status, ended_at FROM task_runs WHERE run_id=$1`,
      [r],
    );
    await finishRun({ runId: r, status: 'success', exitCode: 0, artifacts: ['x'] });
    const after = await pool.query(
      `SELECT status, ended_at FROM task_runs WHERE run_id=$1`,
      [r],
    );
    expect(after.rows[0].status).toBe('failed');
    expect(after.rows[0].ended_at.getTime()).toBe(before.rows[0].ended_at.getTime());
  });

  it('findBareRuns 检出被派发但无 run 记录的 task（裸跑）且无误报', async () => {
    const bare = await seedTask();
    const ok = await seedTask();
    await pool.query(
      `INSERT INTO dispatch_events (task_id,event_type,reason)
         VALUES ($1,'dispatched','pg-bare'),($2,'dispatched','pg-ok')`,
      [bare, ok],
    );
    await startRun({ taskId: ok, runId: `pg-b04-${randomUUID()}`, source: 'dispatcher' });
    const rows = await findBareRuns(pool, { windowMinutes: 60 });
    const ids = rows.map((x) => x.task_id);
    expect(ids).toContain(bare);
    expect(ids).not.toContain(ok);
  });
});
