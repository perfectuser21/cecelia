import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import pool from '../../db.js';
import { createAcceptanceInternalRouter } from '../../routes/acceptance.js';
import { _resetSpecSetsForTest } from '../../routes/acceptance-ai.js';
import { buildChecksFromSpec } from '../../../scripts/acceptance/build-checks-from-spec.mjs';

const RUN_KEY = `ai-itest-${process.pid}`;
const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)), '../fixtures/acceptance/line02-android.yaml'
);

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain/acceptance', createAcceptanceInternalRouter({ pool }));
  return app;
}

async function seed(detail) {
  await pool.query('DELETE FROM acceptance_runs WHERE run_key LIKE $1', [`${RUN_KEY}%`]);
  const { rows } = await pool.query(
    `INSERT INTO acceptance_runs (run_key, title, gp_id, detail)
     VALUES ($1, 'AI 回写测试', '7790f728', $2::jsonb) RETURNING id`,
    [RUN_KEY, JSON.stringify(detail)]
  );
  for (const key of ['S7-c1', 'S12-c1']) {
    await pool.query(
      `INSERT INTO acceptance_checks (run_id, check_key, kind, name) VALUES ($1,$2,'FR',$3)`,
      [rows[0].id, key, key]
    );
  }
}

const FULL_SCENARIOS = { scenarios_observed: ['S4-c2', 'S4-c3', 'S5-c3', 'S5-c4', 'S10-c4'] };

beforeEach(() => seed(FULL_SCENARIOS));
afterAll(async () => {
  await pool.query('DELETE FROM acceptance_runs WHERE run_key LIKE $1', [`${RUN_KEY}%`]);
  await pool.end();
});

describe('POST /ai-results 落库语义', () => {
  it('AI 四列落库：ai_verdict / ai_evidence.reason / ai_run_at', async () => {
    const res = await request(makeApp()).post('/api/brain/acceptance/ai-results').send({
      run_key: RUN_KEY,
      results: [
        { check_key: 'S7-c1', ai_verdict: '通过', evidence: { screenshot: 's3://x.png' } },
        { check_key: 'S12-c1', ai_verdict: '无法验证', reason: 'human_only' },
      ],
    });
    expect(res.status).toBe(200);

    const { rows } = await pool.query(
      `SELECT check_key, ai_verdict, ai_evidence, ai_run_at FROM acceptance_checks c
       JOIN acceptance_runs r ON r.id = c.run_id WHERE r.run_key = $1 ORDER BY check_key`, [RUN_KEY]
    );
    const s12 = rows.find((r) => r.check_key === 'S12-c1');
    expect(s12.ai_verdict).toBe('无法验证');
    expect(s12.ai_evidence.reason).toBe('human_only');
    expect(s12.ai_run_at).toBeInstanceOf(Date);
    expect(rows.find((r) => r.check_key === 'S7-c1').ai_evidence.screenshot).toBe('s3://x.png');
  });

  it('A4⑦ 任一格 scenario_not_triggered → 400，且该批不落库', async () => {
    const res = await request(makeApp()).post('/api/brain/acceptance/ai-results').send({
      run_key: RUN_KEY,
      results: [{ check_key: 'S7-c1', ai_verdict: '无法验证', reason: 'scenario_not_triggered' }],
    });
    expect(res.status).toBe(400);
    const { rows } = await pool.query(
      `SELECT ai_verdict FROM acceptance_checks c JOIN acceptance_runs r ON r.id = c.run_id
       WHERE r.run_key = $1 AND c.check_key = 'S7-c1'`, [RUN_KEY]
    );
    expect(rows[0].ai_verdict).toBeNull();
  });

  it('A4③ machine_db 格自报 human_only → 400，整批不落库（含同批合法的那格）', async () => {
    const res = await request(makeApp()).post('/api/brain/acceptance/ai-results').send({
      run_key: RUN_KEY,
      results: [
        { check_key: 'S12-c1', ai_verdict: '通过' },
        { check_key: 'S7-c1', ai_verdict: '无法验证', reason: 'human_only' },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('reason_not_allowed_for_cell');
    const { rows } = await pool.query(
      `SELECT ai_verdict FROM acceptance_checks c JOIN acceptance_runs r ON r.id = c.run_id
       WHERE r.run_key = $1`, [RUN_KEY]
    );
    expect(rows.every((r) => r.ai_verdict === null)).toBe(true);
  });

  it('故障类 reason 可提交，但不进绿通道（落库即可，格级判绿由 computeCellState 把关）', async () => {
    const res = await request(makeApp()).post('/api/brain/acceptance/ai-results').send({
      run_key: RUN_KEY,
      results: [{ check_key: 'S7-c1', ai_verdict: '无法验证', reason: 'timeout' }],
    });
    expect(res.status).toBe(200);
    const { rows } = await pool.query(
      `SELECT ai_evidence FROM acceptance_checks c JOIN acceptance_runs r ON r.id = c.run_id
       WHERE r.run_key = $1 AND c.check_key = 'S7-c1'`, [RUN_KEY]
    );
    expect(rows[0].ai_evidence.reason).toBe('timeout');
  });

  it('端点忽略请求体里的人列字段：result / submitted_by 不落库', async () => {
    const res = await request(makeApp()).post('/api/brain/acceptance/ai-results').send({
      run_key: RUN_KEY,
      results: [{ check_key: 'S7-c1', ai_verdict: '通过', result: '通过', submitted_by: 'ai-collector' }],
    });
    expect(res.status).toBe(200);
    const { rows } = await pool.query(
      `SELECT result, submitted_by, decided_at FROM acceptance_checks c
       JOIN acceptance_runs r ON r.id = c.run_id WHERE r.run_key = $1 AND c.check_key = 'S7-c1'`, [RUN_KEY]
    );
    expect(rows[0].result).toBeNull();
    expect(rows[0].submitted_by).toBeNull();
    expect(rows[0].decided_at).toBeNull();
  });

  it('AI 回写不改 run.status（status 只看人列进度）', async () => {
    // 先断回写真的成功了：只断「status 还是 pending」的话，端点整个不存在时它也成立
    const res = await request(makeApp()).post('/api/brain/acceptance/ai-results').send({
      run_key: RUN_KEY, results: [{ check_key: 'S7-c1', ai_verdict: '通过' }],
    });
    expect(res.status).toBe(200);
    const { rows } = await pool.query('SELECT status FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
    expect(rows[0].status).toBe('pending');
  });

  it('哑火判据写进 detail.ai_status / ai_incomplete', async () => {
    const res = await request(makeApp()).post('/api/brain/acceptance/ai-results').send({
      run_key: RUN_KEY, results: [{ check_key: 'S7-c1', ai_verdict: '通过' }],
    });
    expect(res.status).toBe(200);
    const { rows } = await pool.query('SELECT detail FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
    // S12-c1 没回写 → 缺格数 > 0 → 条件③ 成立
    expect(rows[0].detail.ai_status).toBe('dumb');
    expect(rows[0].detail.ai_incomplete).toBe(true);
    // 单头原有字段不能被整段覆盖掉
    expect(rows[0].detail.scenarios_observed).toEqual(FULL_SCENARIOS.scenarios_observed);
  });

  it('run_key 不存在 → 404，不静默写空', async () => {
    const res = await request(makeApp()).post('/api/brain/acceptance/ai-results').send({
      run_key: `${RUN_KEY}-nonexistent`, results: [{ check_key: 'S7-c1', ai_verdict: '通过' }],
    });
    expect(res.status).toBe(404);
    // 断到 body：只断 404 的话，端点根本不存在时 express 的路由未命中也是 404，这条会假绿
    expect(res.body.error).toBe('run not found');
  });

  it('格号在规程里、但这张单没建这一行 → 400，不谎报 updated', async () => {
    // UPDATE ... WHERE run_id AND check_key 匹配不到就是 0 行，PG 不报错。
    // 不查一下就直接回 {updated: results.length}，采证器会收到"写成功了"然后安心退出，
    // 那一格永远停在 ai_verdict IS NULL——只有事后翻库才发现。
    const res = await request(makeApp()).post('/api/brain/acceptance/ai-results').send({
      run_key: RUN_KEY,
      results: [{ check_key: 'S7-c1', ai_verdict: '通过' }, { check_key: 'S3-c1', ai_verdict: '通过' }],
    });
    expect(res.status).toBe(400);
    // 与 validateAiReason 的 'unknown_check_key'（规程里没这个格号）机械可区分：
    // 两个码只差一个下划线的话，看日志的人分不出"规程没有"和"这张单没建"
    expect(res.body.error).toBe('check_key_not_in_run');
    expect(res.body.missing).toEqual(['S3-c1']);
    // 同批里合法的那格也不许落库
    const { rows } = await pool.query(
      `SELECT ai_verdict FROM acceptance_checks c JOIN acceptance_runs r ON r.id = c.run_id
       WHERE r.run_key = $1 AND c.check_key = 'S7-c1'`, [RUN_KEY]
    );
    expect(rows[0].ai_verdict).toBeNull();
  });

  it('同一批里格号重复 → 400（后写覆盖先写是静默的）', async () => {
    const res = await request(makeApp()).post('/api/brain/acceptance/ai-results').send({
      run_key: RUN_KEY,
      results: [
        { check_key: 'S7-c1', ai_verdict: '通过' },
        { check_key: 'S7-c1', ai_verdict: '不通过' },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('duplicate_check_key');
  });

  it('ai_verdict 不在枚举内 → 400', async () => {
    const res = await request(makeApp()).post('/api/brain/acceptance/ai-results').send({
      run_key: RUN_KEY, results: [{ check_key: 'S7-c1', ai_verdict: 'PASS' }],
    });
    expect(res.status).toBe(400);
  });
});

describe('增项3 规程读不出来时路由层的错误映射（服务端错误 → 500，不打裸堆栈）', () => {
  const ORIGINAL = process.env.ACCEPTANCE_SPEC_PATH;
  const tmpFiles = [];
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.ACCEPTANCE_SPEC_PATH;
    else process.env.ACCEPTANCE_SPEC_PATH = ORIGINAL;
    _resetSpecSetsForTest();
    while (tmpFiles.length) fs.rmSync(tmpFiles.pop(), { force: true });
  });

  function writeTmpSpec(body) {
    const p = path.join(os.tmpdir(), `acceptance-spec-${process.pid}-${tmpFiles.length}.yaml`);
    fs.writeFileSync(p, body);
    tmpFiles.push(p);
    return p;
  }

  async function postOne() {
    return request(makeApp()).post('/api/brain/acceptance/ai-results').send({
      run_key: RUN_KEY, results: [{ check_key: 'S7-c1', ai_verdict: '通过' }],
    });
  }

  it('规程文件不存在 → 500 spec_unavailable，响应体里没有堆栈帧', async () => {
    process.env.ACCEPTANCE_SPEC_PATH = '/nonexistent/acceptance-spec/line02-android.yaml';
    _resetSpecSetsForTest();
    const res = await postOne();
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('spec_unavailable');
    expect(JSON.stringify(res.body)).not.toMatch(/\bat .+:\d+:\d+/);
  });

  it('yaml 语法坏了 → 同样 500 spec_unavailable，不是 express 默认的裸堆栈页', async () => {
    process.env.ACCEPTANCE_SPEC_PATH = writeTmpSpec('version: 1.0\nsteps: [ {n: 1,\n');
    _resetSpecSetsForTest();
    const res = await postOne();
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('spec_unavailable');
    expect(res.text).not.toMatch(/\bat .+:\d+:\d+/);
  });

  it('yaml 结构异常（steps 不是数组）→ 500 spec_unavailable', async () => {
    process.env.ACCEPTANCE_SPEC_PATH = writeTmpSpec('version: 1.0\nsteps: 不是数组\n');
    _resetSpecSetsForTest();
    const res = await postOne();
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('spec_unavailable');
  });
});

describe('全链路：生成器 36 行 → 建单 → AI 全格回写 → ai_status 转 ok', () => {
  // 其余用例全落在 dumb 分支上，'ok' 这一支一个断言都没有——哑火判据要是恒判 dumb，
  // 上面那些测试会一条不落地全绿。这条从生成器真实产出的 36 行走完整条链把它钉住。
  it('36 格全给确定判定 → ai_status=ok / ai_incomplete=false，且 AI 列真落到库里', async () => {
    const fullRunKey = `${RUN_KEY}-full`;
    const { checks } = buildChecksFromSpec(FIXTURE);
    expect(checks).toHaveLength(36);

    const app = makeApp();
    // A4⑧ 推进闸的前提：mandatory 场景码勾齐才收 AI 回写。单头（含 scenarios_observed
    // 与租户账号）从建单端点原路落库——写入侧接上后，这里不再需要建完单再补写一次库。
    const created = await request(app).post('/api/brain/acceptance/runs').send({
      run_key: fullRunKey, title: '全链路', gp_id: `${RUN_KEY}-gp`, checks,
      detail: { tenant_account: 'acc-verify-01', ...FULL_SCENARIOS },
    });
    expect(created.status).toBe(201);

    const res = await request(app).post('/api/brain/acceptance/ai-results').send({
      run_key: fullRunKey,
      results: checks.map((c) => ({ check_key: c.check_key, ai_verdict: '通过' })),
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ updated: 36, ai_status: 'ok', ai_incomplete: false });

    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM acceptance_checks c JOIN acceptance_runs r ON r.id = c.run_id
       WHERE r.run_key = $1 AND c.ai_verdict = '通过' AND c.ai_run_at IS NOT NULL`, [fullRunKey]
    );
    expect(rows[0].n).toBe(36);

    const { rows: runRows } = await pool.query(
      'SELECT detail, status FROM acceptance_runs WHERE run_key = $1', [fullRunKey]
    );
    expect(runRows[0].detail.ai_missing_cells).toEqual([]);
    // 人列一格没填，run 仍停在 pending——AI 填满 36 格也推不动人列进度
    expect(runRows[0].status).toBe('pending');
  });
});

describe('增项3 建单端点吃生成器输出的结构异常 → 400（客户端错误）', () => {
  it('同一批 checks 里格号重复 → 400，且不落半张单', async () => {
    const dupRunKey = `${RUN_KEY}-dup`;
    const res = await request(makeApp()).post('/api/brain/acceptance/runs').send({
      run_key: dupRunKey,
      title: '重复格号',
      gp_id: '7790f728',
      checks: [
        { check_key: 'S7-c1', kind: 'FR', name: '第一份' },
        { check_key: 'S7-c1', kind: 'FR', name: '第二份' },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/duplicate_check_key/);
    const { rows } = await pool.query('SELECT id FROM acceptance_runs WHERE run_key = $1', [dupRunKey]);
    expect(rows).toHaveLength(0);
  });
});
