/**
 * [BEHAVIOR] 棒3a 判定真 Postgres 集成（任务 33aa2bc4）：
 *   finishRun 补终态 → run.finished（真 event-bus on/emit）→ business-probe-judge 查 step_probes ⋈
 *   journey_step_links → 写 journey_assertion_receipts(business_probe_runner, 迁移 475 放行)
 *   → journey_step_links.cell_status 翻色。
 *
 * 禁 mock 边：task_runs / step_probes / journey_step_links / journey_assertion_receipts 全走真库
 * （单一 client 开事务，afterAll ROLLBACK，不留痕；回执表 append-only 触发器也因此不需要绕）。
 * 依赖迁移 474（step_probes，棒2）+ 475（回执表 CHECK 放宽，本棒）。
 * 登记进 vitest.config.js POSTGRES_INTEGRATION_TESTS，由 brain-integration 起真 PG 跑。
 */
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pool from '../../db.js';
import { startRun, finishRun } from '../../lib/task-run.js';
import { on } from '../../event-bus.js';
import { handleRunFinished, registerBusinessProbeJudge } from '../../lib/business-probe-judge.js';

const STAGE = 'preflight';
const KEY_OK = `pgtest.${randomUUID().slice(0, 8)}.slots_ready`;
const KEY_WARN = `pgtest.${randomUUID().slice(0, 8)}.ids_all`;
const KEY_OFF = `pgtest.${randomUUID().slice(0, 8)}.retired`;

function specOf(key, expect_, severity) {
  return { key, workflow: 'pgtest', stage: STAGE, journey_cell: `stage:${STAGE}`, probe: { type: 'sql', target: 'x', query: 'select 1' }, expect: expect_, severity };
}
const sha256 = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

let client;
let unsubscribe;
const ids = {};

beforeAll(async () => {
  client = await pool.connect();
  await client.query('BEGIN');
  const journey = await client.query(`INSERT INTO journeys (name) VALUES ($1) RETURNING id`, [`pgtest journey ${KEY_OK}`]);
  ids.journeyId = journey.rows[0].id;
  const step = await client.query(
    `INSERT INTO journey_steps (journey_id, name, step_number) VALUES ($1, 'preflight', 1) RETURNING id`,
    [ids.journeyId],
  );
  ids.stepId = step.rows[0].id;
  const link = async (key) => (await client.query(
    `INSERT INTO journey_step_links (journey_id, step_id, step_order, cell_kind, cell_key, cell_status, assertion_ref)
     VALUES ($1, $2, 1, 'scenario', $3, 'gray', $4) RETURNING id, assertion_revision`,
    [ids.journeyId, ids.stepId, `stage:${STAGE}:${key}`, `probe:${key}`],
  )).rows[0];
  ids.linkOk = await link(KEY_OK);
  ids.linkWarn = await link(KEY_WARN);
  const specOk = specOf(KEY_OK, { op: '>=', ref: 'metrics.want' }, 'error');
  const specWarn = specOf(KEY_WARN, { op: 'not_null_all' }, 'warn');
  ids.hashOk = sha256(specOk);
  ids.hashWarn = sha256(specWarn);
  await client.query(
    `INSERT INTO step_probes (probe_key, workflow, stage, journey_step_link_id, spec, spec_hash, severity)
     VALUES ($1,'pgtest',$2,$3,$4::jsonb,$5,'error'), ($6,'pgtest',$2,$7,$8::jsonb,$9,'warn')`,
    [KEY_OK, STAGE, ids.linkOk.id, JSON.stringify(specOk), ids.hashOk, KEY_WARN, ids.linkWarn.id, JSON.stringify(specWarn), ids.hashWarn],
  );
  // 停用探针（YAML 已删、库行 active=false）：挂在 linkOk 上，若被判定会以 probe_missing 把 linkOk 打红
  const specOff = specOf(KEY_OFF, { op: '==', value: 1 }, 'error');
  await client.query(
    `INSERT INTO step_probes (probe_key, workflow, stage, journey_step_link_id, spec, spec_hash, severity, active)
     VALUES ($1,'pgtest',$2,$3,$4::jsonb,$5,'error',false)`,
    [KEY_OFF, STAGE, ids.linkOk.id, JSON.stringify(specOff), sha256(specOff)],
  );
  const task = await client.query(
    `INSERT INTO tasks (title, task_type, status, payload) VALUES ($1, 'harness_initiative', 'in_progress', $2::jsonb) RETURNING id`,
    [`pgtest business probe judge ${KEY_OK}`, JSON.stringify({ anchor: { journey_id: ids.journeyId } })],
  );
  ids.taskId = task.rows[0].id;
  // 真接线：event-bus.on + 判定器（pool 注入为事务 client，所有写落在同一事务里）
  unsubscribe = registerBusinessProbeJudge({ pool: client, on });
});

afterAll(async () => {
  if (unsubscribe) unsubscribe();
  if (client) { await client.query('ROLLBACK'); client.release(); }
  await pool.end();
});

async function receiptsFor(runId) {
  const { rows } = await client.query(
    `SELECT journey_step_link_id, verdict, exit_code, executor_kind, source_repo, source_sha, machine_id,
            assertion_ref_snapshot, assertion_digest, assertion_revision, command_argv, scenario_evidence, synthetic
       FROM journey_assertion_receipts WHERE run_id = $1 ORDER BY assertion_ref_snapshot`,
    [runId],
  );
  return rows;
}

async function cellStatus(linkId) {
  return (await client.query('SELECT cell_status FROM journey_step_links WHERE id = $1', [linkId])).rows[0].cell_status;
}

describe('business-probe-judge [PostgreSQL] run.finished → 回执 → cell 翻色', () => {
  const runId = `pgtest-run-${randomUUID()}`;

  it('finishRun 终态触发判定：PASS 回执 + green，warn 档 FAIL 回执 + pending，字段按占位约定落库', async () => {
    await startRun({ taskId: ids.taskId, runId, source: 'pg-integration' }, { pool: client });
    // 棒1 合同：执行方把 stage/metrics/probes 写进 task_runs.result；本测试直接种（__tests__ 不在单写守卫口径内）
    await client.query(
      `UPDATE task_runs SET result = $2::jsonb WHERE run_id = $1`,
      [runId, JSON.stringify({
        stage: STAGE, stage_status: 'ok', metrics: { want: 2 }, evidence: {},
        probes: [
          { key: KEY_OK, observed: 3, probed_at: '2026-09-26T12:00:00.000Z' },
          { key: KEY_WARN, observed: ['a', null] },
        ],
      })],
    );

    const out = await finishRun({ runId, status: 'completed', exitCode: 0 }, { pool: client });
    expect(out).toEqual({ updated: true });

    const receipts = await receiptsFor(runId);
    expect(receipts).toHaveLength(2);
    const byKey = Object.fromEntries(receipts.map((r) => [r.assertion_ref_snapshot, r]));

    const pass = byKey[`probe:${KEY_OK}`];
    expect(pass).toMatchObject({
      journey_step_link_id: ids.linkOk.id, verdict: 'PASS', exit_code: 0,
      executor_kind: 'business_probe_runner', source_repo: 'zenithjoy-workspace',
      source_sha: null, machine_id: null, assertion_digest: ids.hashOk, synthetic: false,
      command_argv: ['probe', KEY_OK],
      scenario_evidence: { observed: 3, expected: 2, op: '>=', severity: 'error' },
    });
    expect(Number(pass.assertion_revision)).toBe(Number(ids.linkOk.assertion_revision));

    const fail = byKey[`probe:${KEY_WARN}`];
    expect(fail).toMatchObject({
      journey_step_link_id: ids.linkWarn.id, verdict: 'FAIL', exit_code: 1,
      executor_kind: 'business_probe_runner', assertion_digest: ids.hashWarn,
      scenario_evidence: { observed: ['a', null], expected: null, op: 'not_null_all', severity: 'warn', reason: 'value_mismatch' },
    });

    expect(await cellStatus(ids.linkOk.id)).toBe('green');
    expect(await cellStatus(ids.linkWarn.id)).toBe('pending');
  });

  it('停用探针（active=false）不判：无回执，且没把同格 linkOk 拖成 red', async () => {
    const receipts = await receiptsFor(runId);
    expect(receipts.some((r) => r.assertion_ref_snapshot === `probe:${KEY_OFF}`)).toBe(false);
    expect(receipts.filter((r) => r.journey_step_link_id === ids.linkOk.id)).toHaveLength(1);
    expect(await cellStatus(ids.linkOk.id)).toBe('green');
  });

  it('同一 run 重复判定幂等：409 唯一键（NULLS NOT DISTINCT）挡住重复回执，cell 不抖', async () => {
    const before = (await receiptsFor(runId)).length;
    const { rows } = await client.query('SELECT task_id, status, result FROM task_runs WHERE run_id = $1', [runId]);
    const again = await handleRunFinished(
      { runId, taskId: rows[0].task_id, status: rows[0].status, result: rows[0].result },
      { pool: client },
    );
    expect(again.judged).toBe(2);
    expect(again.receipts.every((r) => r.receipt_id === null)).toBe(true);
    expect((await receiptsFor(runId)).length).toBe(before);
    expect(await cellStatus(ids.linkOk.id)).toBe('green');
  });

  it('已终态的 run 再 finishRun 不再触发判定（updated=false）', async () => {
    const before = (await receiptsFor(runId)).length;
    const out = await finishRun({ runId, status: 'failed', error: 'late' }, { pool: client });
    expect(out).toEqual({ updated: false });
    expect((await receiptsFor(runId)).length).toBe(before);
  });

  it('迁移 475 约束：brain_assertion_runner PASS 仍必须带 sha/machine（原式未被放宽）', async () => {
    await client.query('SAVEPOINT brain_pass');
    await expect(client.query(
      `INSERT INTO journey_assertion_receipts (journey_step_link_id, run_id, assertion_revision, assertion_ref_snapshot,
         assertion_digest, source_repo, command_argv, scenario_count, scenario_evidence, verdict, exit_code,
         started_at, completed_at, executor_kind)
       VALUES ($1, 'pgtest-brain-run', 1, 'tests/x.test.js', $2, 'cecelia', '["npx"]', 1, '{"a":1}', 'PASS', 0, now(), now(), 'brain_assertion_runner')`,
      [ids.linkOk.id, 'c'.repeat(64)],
    )).rejects.toThrow(/journey_assertion_receipt_verdict_chk/);
    await client.query('ROLLBACK TO SAVEPOINT brain_pass');
  });
});
