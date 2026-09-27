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

  it('同一 run 重复判定幂等：五列唯一键（NULLS NOT DISTINCT，迁移 477）挡住重复回执，skipped 点名 duplicate，cell 不抖', async () => {
    const before = (await receiptsFor(runId)).length;
    const { rows } = await client.query('SELECT task_id, status, result FROM task_runs WHERE run_id = $1', [runId]);
    const again = await handleRunFinished(
      { runId, taskId: rows[0].task_id, status: rows[0].status, result: rows[0].result },
      { pool: client },
    );
    expect(again.judged).toBe(2);
    expect(again.persisted).toBe(0);
    expect(again.receipts.every((r) => r.receipt_id === null && r.persisted === false && r.skipped_reason === 'duplicate')).toBe(true);
    expect(again.skipped).toEqual([
      { probe_key: KEY_OK, reason: 'duplicate' },
      { probe_key: KEY_WARN, reason: 'duplicate' },
    ]);
    expect((await receiptsFor(runId)).length).toBe(before);
    expect(await cellStatus(ids.linkOk.id)).toBe('green');
  });

  it('已终态的 run 再 finishRun 不再触发判定（updated=false）', async () => {
    const before = (await receiptsFor(runId)).length;
    const out = await finishRun({ runId, status: 'failed', error: 'late' }, { pool: client });
    expect(out).toEqual({ updated: false });
    expect((await receiptsFor(runId)).length).toBe(before);
  });

  it('无 anchor 任务（zenithjoy device_job 镜像）：按 run_id <workflow>-crontab-… 解析 workflow 判定，回执落库、cell 真翻、锚回填（任务 1be07583）', async () => {
    const mirror = await client.query(
      `INSERT INTO tasks (title, task_type, status, payload) VALUES ($1, 'harness_initiative', 'in_progress', '{}'::jsonb) RETURNING id`,
      [`pgtest mirror task no anchor ${KEY_OK}`],
    );
    const mirrorTaskId = mirror.rows[0].id;
    const mirrorRunId = `pgtest-crontab-auto09270600__a1.${STAGE}`;
    await startRun({ taskId: mirrorTaskId, runId: mirrorRunId, source: 'pg-integration' }, { pool: client });
    // 反向取值：KEY_OK 故意不达标（green→red）、KEY_WARN 全非空（pending→green），证明 cell 真被本 run 翻过
    await client.query(
      `UPDATE task_runs SET result = $2::jsonb WHERE run_id = $1`,
      [mirrorRunId, JSON.stringify({
        stage: STAGE, stage_status: 'ok', metrics: { want: 10 }, evidence: {},
        probes: [{ key: KEY_OK, observed: 3 }, { key: KEY_WARN, observed: ['a', 'b'] }],
      })],
    );
    expect(await cellStatus(ids.linkOk.id)).toBe('green');
    expect(await cellStatus(ids.linkWarn.id)).toBe('pending');

    expect(await finishRun({ runId: mirrorRunId, status: 'completed', exitCode: 0 }, { pool: client })).toEqual({ updated: true });

    const receipts = await receiptsFor(mirrorRunId);
    expect(receipts).toHaveLength(2);
    const byKey = Object.fromEntries(receipts.map((r) => [r.assertion_ref_snapshot, r]));
    expect(byKey[`probe:${KEY_OK}`]).toMatchObject({ verdict: 'FAIL', executor_kind: 'business_probe_runner', scenario_evidence: { observed: 3, expected: 10, reason: 'value_mismatch' } });
    expect(byKey[`probe:${KEY_WARN}`]).toMatchObject({ verdict: 'PASS', scenario_evidence: { observed: ['a', 'b'] } });
    expect(await cellStatus(ids.linkOk.id)).toBe('red');
    expect(await cellStatus(ids.linkWarn.id)).toBe('green');

    const { rows } = await client.query(`SELECT payload->'anchor'->>'journey_id' AS journey_id FROM tasks WHERE id = $1`, [mirrorTaskId]);
    expect(rows[0].journey_id).toBe(ids.journeyId);
  });

  it('无 anchor 且 run_id 不含 -crontab- → skipped no_anchor_no_workflow，不写回执', async () => {
    const plain = await client.query(
      `INSERT INTO tasks (title, task_type, status, payload) VALUES ($1, 'harness_initiative', 'in_progress', '{}'::jsonb) RETURNING id`,
      [`pgtest plain task no anchor ${KEY_OK}`],
    );
    const plainRunId = `pgtest-plain-${randomUUID()}`;
    const out = await handleRunFinished(
      { runId: plainRunId, taskId: plain.rows[0].id, status: 'completed', result: { stage: STAGE, probes: [{ key: KEY_OK, observed: 99 }] } },
      { pool: client },
    );
    expect(out).toEqual({ skipped: 'no_anchor_no_workflow' });
    expect(await receiptsFor(plainRunId)).toHaveLength(0);
  });

  describe('迁移 477：同一 cell 多条探针回执不再互吞（09-27 生产 judged=3 只落 1 行，FAIL 行丢失）', () => {
    const MULTI_STAGE = 'delivery';
    const K1 = `pgtest.${randomUUID().slice(0, 8)}.comments_readback`;
    const K2 = `pgtest.${randomUUID().slice(0, 8)}.videos_readback`;
    const K3 = `pgtest.${randomUUID().slice(0, 8)}.line_key_not_null`;
    const multiRunId = `pgtest-multi-${randomUUID()}`;
    let multiLink;

    beforeAll(async () => {
      multiLink = (await client.query(
        `INSERT INTO journey_step_links (journey_id, step_id, step_order, cell_kind, cell_key, cell_status, assertion_ref)
         VALUES ($1, $2, 2, 'scenario', $3, 'gray', $4) RETURNING id, assertion_revision`,
        [ids.journeyId, ids.stepId, `stage:${MULTI_STAGE}`, `probe:${K1}`],
      )).rows[0];
      const s1 = specOf(K1, { op: '>=', ref: 'metrics.comments_expected' }, 'error');
      const s2 = specOf(K2, { op: '>=', ref: 'metrics.videos_expected' }, 'warn');
      const s3 = specOf(K3, { op: 'not_null_all' }, 'error');
      await client.query(
        `INSERT INTO step_probes (probe_key, workflow, stage, journey_step_link_id, spec, spec_hash, severity)
         VALUES ($1,'pgtest',$2,$3,$4::jsonb,$5,'error'), ($6,'pgtest',$2,$3,$7::jsonb,$8,'warn'), ($9,'pgtest',$2,$3,$10::jsonb,$11,'error')`,
        [K1, MULTI_STAGE, multiLink.id, JSON.stringify(s1), sha256(s1), K2, JSON.stringify(s2), sha256(s2), K3, JSON.stringify(s3), sha256(s3)],
      );
    });

    it('同一 run 同一格三条探针（source_sha / impact_contract_hash 皆 NULL）→ 三行全落库，FAIL 行可查，cell=pending', async () => {
      await startRun({ taskId: ids.taskId, runId: multiRunId, source: 'pg-integration' }, { pool: client });
      await client.query(
        `UPDATE task_runs SET result = $2::jsonb WHERE run_id = $1`,
        [multiRunId, JSON.stringify({
          stage: MULTI_STAGE, stage_status: 'ok',
          metrics: { comments_expected: 7, videos_expected: 7 }, evidence: {},
          probes: [
            { key: K1, observed: 7 },
            { key: K2, observed: 6 },
            { key: K3, observed: ['a', 'b'] },
          ],
        })],
      );
      expect(await finishRun({ runId: multiRunId, status: 'completed', exitCode: 0 }, { pool: client })).toEqual({ updated: true });

      const receipts = await receiptsFor(multiRunId);
      expect(receipts).toHaveLength(3);
      expect(receipts.every((r) => r.journey_step_link_id === multiLink.id && r.source_sha === null)).toBe(true);
      const byKey = Object.fromEntries(receipts.map((r) => [r.assertion_ref_snapshot, r]));
      expect(byKey[`probe:${K1}`]).toMatchObject({ verdict: 'PASS', exit_code: 0 });
      expect(byKey[`probe:${K2}`]).toMatchObject({ verdict: 'FAIL', exit_code: 1, scenario_evidence: { observed: 6, expected: 7, op: '>=', severity: 'warn', reason: 'value_mismatch' } });
      expect(byKey[`probe:${K3}`]).toMatchObject({ verdict: 'PASS', exit_code: 0 });

      // 晨报/日报「断言红灯」读法：按 run 查 FAIL 行必须能查到
      const fails = await client.query(
        `SELECT assertion_ref_snapshot FROM journey_assertion_receipts WHERE run_id = $1 AND verdict = 'FAIL'`,
        [multiRunId],
      );
      expect(fails.rows.map((r) => r.assertion_ref_snapshot)).toEqual([`probe:${K2}`]);
      expect(await cellStatus(multiLink.id)).toBe('pending');
    });

    it('重放同一 run：三条全 skipped=duplicate，persisted=0，行数不变', async () => {
      const { rows } = await client.query('SELECT task_id, status, result FROM task_runs WHERE run_id = $1', [multiRunId]);
      const again = await handleRunFinished(
        { runId: multiRunId, taskId: rows[0].task_id, status: rows[0].status, result: rows[0].result },
        { pool: client },
      );
      expect(again).toMatchObject({ judged: 3, persisted: 0 });
      expect(again.skipped.map((s) => s.reason)).toEqual(['duplicate', 'duplicate', 'duplicate']);
      expect(await receiptsFor(multiRunId)).toHaveLength(3);
    });

    it('harness 行（brain_assertion_runner）同 run 同格重复插入仍去重：assertion_ref_snapshot 固定，五列键与四列键语义一致', async () => {
      const harnessRunId = `pgtest-harness-${randomUUID()}`;
      const insertHarness = () => client.query(
        `INSERT INTO journey_assertion_receipts (journey_step_link_id, run_id, assertion_revision, assertion_ref_snapshot,
           assertion_digest, source_repo, source_sha, impact_contract_hash, command_argv, scenario_count, scenario_evidence,
           verdict, exit_code, started_at, completed_at, machine_id, output_digest, output_tail, executor_kind)
         VALUES ($1, $2, 1, 'tests/x.test.js', $3, 'cecelia', $4, $5, '["npx"]', 1, '{"cases":["a"]}',
           'PASS', 0, now(), now(), 'mac-1', $6, '', 'brain_assertion_runner')
         ON CONFLICT (run_id, journey_step_link_id, source_sha, impact_contract_hash, assertion_ref_snapshot) DO NOTHING
         RETURNING id`,
        // impact_contract_hash NULL = legacy_exempt 形态（409 检查约束要求 hash 与 contract_id/attempt_id 同在）
        [multiLink.id, harnessRunId, 'c'.repeat(64), 'a'.repeat(40), null, 'e'.repeat(64)],
      );
      await client.query('SAVEPOINT harness_dedup');
      try {
        expect((await insertHarness()).rows).toHaveLength(1);
        expect((await insertHarness()).rows).toHaveLength(0);
        const count = await client.query(
          `SELECT COUNT(*)::int AS n FROM journey_assertion_receipts WHERE run_id = $1 AND journey_step_link_id = $2`,
          [harnessRunId, multiLink.id],
        );
        expect(count.rows[0].n).toBe(1);
      } finally {
        await client.query('ROLLBACK TO SAVEPOINT harness_dedup');
      }
    });
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
