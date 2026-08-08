import express from 'express';
import request from 'supertest';
import { describe, expect, it, afterAll } from 'vitest';
import pool from '../../db.js';
import { createAcceptanceInternalRouter, createAcceptancePublicRouter } from '../../routes/acceptance.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain/acceptance', createAcceptanceInternalRouter({ pool }));
  app.use(createAcceptancePublicRouter({ pool }));
  return app;
}

const RUN_KEY = `itest-run-${process.pid}`;
/**
 * gp_id 按进程取唯一值：建单期复盘闭环闸（A15①）拿「同 gp 上一轮」说事，
 * 借用真实 gp_id 会撞上库里别的单（本机 scratch 就躺着一条同 gp 的未闭环单），
 * 让这条与 gp 无关的全链测试随环境红。
 */
const GP_ID = `itest-gp-${process.pid}`;
/** 建单单头：租户白名单（A16②）与版本戳双源对账（A9）对所有建单生效 */
const HEAD = {
  tenant_account: 'acc-verify-01',
  backend_sha: 'a'.repeat(40), backend_sha_src2: 'a'.repeat(40),
  frontend_sha: 'b'.repeat(40), frontend_sha_src2: 'b'.repeat(40),
  spec_sha: 'c'.repeat(64),
};
/** 带版本戳的 run 提交人列时必须自报当前 sha，否则冻结锁按 fail-closed 拒收 */
const SHAS = { backend_sha: 'a'.repeat(40), frontend_sha: 'b'.repeat(40), spec_sha: 'c'.repeat(64) };

describe('acceptance 全链 integration', () => {
  afterAll(async () => {
    await pool.query('DELETE FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
    await pool.end();
  });

  it('建单 → pending 可见 → 回写 results → pass_rate/status 更新', async () => {
    const app = makeApp();

    const create = await request(app).post('/api/brain/acceptance/runs').send({
      run_key: RUN_KEY,
      title: 'integration 测试单',
      gp_id: GP_ID,
      detail: HEAD,
      checks: [
        { check_key: 'S1-c1', kind: 'FR', name: 'step1' },
        { check_key: 'S1-c3', kind: 'FR', name: 'step2' },
        { check_key: 'S11-c4', kind: 'Invariant', name: '不向未授权账号发消息' },
      ],
    });
    expect(create.status).toBe(201);
    expect(create.body.checks).toHaveLength(3);

    const again = await request(app).post('/api/brain/acceptance/runs').send({
      run_key: RUN_KEY, title: '重复', detail: HEAD,
      checks: [{ check_key: 'S1-c1', kind: 'FR', name: 'x' }],
    });
    expect(again.status).toBe(200);
    expect(again.body.created).toBe(false);

    const pending = await request(app).get('/acceptance/pending');
    expect(pending.status).toBe(200);
    const mine = pending.body.runs.find((r) => r.run_key === RUN_KEY);
    expect(mine.checks).toHaveLength(3);

    const results = await request(app).post('/api/brain/acceptance/results').send({
      run_key: RUN_KEY, ...SHAS,
      results: [
        { check_key: 'S1-c1', result: '通过' },
        { check_key: 'S1-c3', result: '不通过', note: '挂了' },
        { check_key: 'S11-c4', result: '通过' },
      ],
    });
    expect(results.status).toBe(200);
    const updated = results.body.runs.find((r) => r.run_key === RUN_KEY);
    // migration 392 起 run 级 status 只看人列填写进度：填满即 human_complete，
    // 与其中有几格不通过无关（旧断言写 failed，正是 A10⑤ 要堵的洞）
    expect(updated.status).toBe('human_complete');
    expect(Number(updated.pass_rate)).toBeCloseTo(2 / 3, 2);

    const { rows } = await pool.query('SELECT status, pass_rate FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
    expect(rows[0].status).toBe('human_complete');
  });

  it('并发场景：同一 run_key 两次插入未终态驳回任务，第二次必须撞唯一索引', async () => {
    const runKey = `${RUN_KEY}-dedup`;
    await pool.query(
      `INSERT INTO tasks (title, task_type, status, payload)
       VALUES ('probe-1', 'dev', 'queued', $1::jsonb)`,
      [JSON.stringify({ acceptance_run_key: runKey })]
    );
    await expect(
      pool.query(
        `INSERT INTO tasks (title, task_type, status, payload)
         VALUES ('probe-2', 'dev', 'queued', $1::jsonb)`,
        [JSON.stringify({ acceptance_run_key: runKey })]
      )
    ).rejects.toMatchObject({ code: '23505' });
    await pool.query(`DELETE FROM tasks WHERE payload->>'acceptance_run_key' = $1`, [runKey]);
  });

  it('并发提交同一 run 不同 check_key：行锁保证最终 pass_rate 基于完整数据', async () => {
    const runKey = `${RUN_KEY}-race`;
    const app = makeApp();
    await request(app).post('/api/brain/acceptance/runs').send({
      run_key: runKey, title: 'race 测试单', detail: HEAD,
      checks: [{ check_key: 'S1-c1', kind: 'FR', name: 'a' }, { check_key: 'S2-c1', kind: 'FR', name: 'b' }],
    });
    const [r1, r2] = await Promise.all([
      request(app).post('/api/brain/acceptance/results').send({ run_key: runKey, ...SHAS, results: [{ check_key: 'S1-c1', result: '通过' }] }),
      request(app).post('/api/brain/acceptance/results').send({ run_key: runKey, ...SHAS, results: [{ check_key: 'S2-c1', result: '通过' }] }),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const final = await request(app).get(`/api/brain/acceptance/runs/${runKey}`);
    // 人列全通过同样只是 human_complete；「通过与否」由 gate_verdict 表达，不是 status
    expect(final.body.run.status).toBe('human_complete');
    expect(Number(final.body.run.pass_rate)).toBe(1);
    await pool.query('DELETE FROM acceptance_runs WHERE run_key = $1', [runKey]);
  });

  // migration 392 起 computeRunStatus 永不产生 failed，isLegacyRejectionTransition 恒不成立，
  // 驳回建任务分支（含它的 SAVEPOINT 保护）对新 run 已不可达。本测试因此改为锁住新语义：
  // 判「不通过」的那一轮照样走到 human_complete，且不再自动建驳回任务。
  // SAVEPOINT 不毒化外层事务的那条保护需要在 D4 聚合式分流落地时重新覆盖。
  it('判不通过的一轮：check 结果落库 + run 达 human_complete + 不再自动建驳回任务', async () => {
    const runKey = `${RUN_KEY}-savepoint`;
    const rejectTitle = `[验收驳回] ${runKey} 标题探针`;
    const app = makeApp();
    await request(app).post('/api/brain/acceptance/runs').send({
      run_key: runKey, title: `${runKey} 标题探针`, detail: HEAD,
      checks: [{ check_key: 'S1-c1', kind: 'FR', name: 'will-fail' }],
    });
    // 手工占住 idx_tasks_dedup_active（title 相同 + 未终态），模拟"标题冲突但不是本次唯一索引"的场景
    await pool.query(
      `INSERT INTO tasks (title, task_type, status, payload) VALUES ($1, 'dev', 'queued', '{}'::jsonb)`,
      [rejectTitle]
    );
    const submit = await request(app).post('/api/brain/acceptance/results').send({
      run_key: runKey, ...SHAS,
      results: [{ check_key: 'S1-c1', result: '不通过' }],
    });
    expect(submit.status).toBe(200);
    const final = await request(app).get(`/api/brain/acceptance/runs/${runKey}`);
    expect(final.body.run.status).toBe('human_complete');
    expect(final.body.checks[0].result).toBe('不通过');
    // 只剩测试自己占位插进去的那一条；分支若仍在触发会多出一条同名任务
    const { rows: rejectTasks } = await pool.query(
      'SELECT count(*)::int AS n FROM tasks WHERE title = $1', [rejectTitle]
    );
    expect(rejectTasks[0].n).toBe(1);
    await pool.query('DELETE FROM tasks WHERE title = $1', [rejectTitle]);
    await pool.query('DELETE FROM acceptance_runs WHERE run_key = $1', [runKey]);
  });
});
