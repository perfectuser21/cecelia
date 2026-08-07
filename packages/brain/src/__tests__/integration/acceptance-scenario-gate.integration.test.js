import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import request from 'supertest';
import yaml from 'js-yaml';
import { describe, it, expect, afterAll, afterEach } from 'vitest';
import pool from '../../db.js';
import { createAcceptanceInternalRouter } from '../../routes/acceptance.js';
import { missingMandatoryScenarios, _resetSpecSetsForTest } from '../../routes/acceptance-ai.js';

const RUN_KEY = `gate-itest-${process.pid}`;
const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)), '../fixtures/acceptance/line02-android.yaml'
);
/** fixture 规程里 scenario_class: mandatory 的那 5 格 */
const ALL = ['S4-c2', 'S4-c3', 'S5-c3', 'S5-c4', 'S10-c4'];

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain/acceptance', createAcceptanceInternalRouter({ pool }));
  return app;
}

async function seed(scenarios_observed) {
  await pool.query('DELETE FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
  const { rows } = await pool.query(
    `INSERT INTO acceptance_runs (run_key, title, detail) VALUES ($1,'推进闸',$2::jsonb) RETURNING id`,
    [RUN_KEY, JSON.stringify({ scenarios_observed })]
  );
  await pool.query(
    `INSERT INTO acceptance_checks (run_id, check_key, kind, name) VALUES ($1,'S7-c1','FR','x')`,
    [rows[0].id]
  );
}

const post = () => request(makeApp()).post('/api/brain/acceptance/ai-results')
  .send({ run_key: RUN_KEY, results: [{ check_key: 'S7-c1', ai_verdict: '通过' }] });

// 收尾挂在文件级而不是某个 describe 上：挂进 describe 的话 pool 会在后面那组用例开跑前
// 就被 end 掉，那一组会以 "Cannot use a pool after calling end" 整组挂掉。
afterAll(async () => {
  await pool.query('DELETE FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
  await pool.end();
});

describe('A4⑧ 收单期推进闸', () => {
  it('缺一个 mandatory 场景码 → 409，响应体列出缺失清单', async () => {
    await seed(ALL.slice(0, 4));
    const res = await post();
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('mandatory_scenarios_missing');
    expect(res.body.missing).toEqual(['S10-c4']);
  });

  it('scenarios_observed 完全为空 → 409 且缺失清单为全部 5 个', async () => {
    await seed([]);
    const res = await post();
    expect(res.status).toBe(409);
    expect(res.body.missing.sort()).toEqual([...ALL].sort());
  });

  it('detail 里根本没有 scenarios_observed 字段 → 409（fail-closed，不当作已勾齐）', async () => {
    await pool.query('DELETE FROM acceptance_runs WHERE run_key = $1', [RUN_KEY]);
    const { rows } = await pool.query(
      `INSERT INTO acceptance_runs (run_key, title) VALUES ($1,'无字段') RETURNING id`, [RUN_KEY]
    );
    await pool.query(
      `INSERT INTO acceptance_checks (run_id, check_key, kind, name) VALUES ($1,'S7-c1','FR','x')`,
      [rows[0].id]
    );
    const res = await post();
    expect(res.status).toBe(409);
  });

  it('5 个 mandatory 码勾齐 → 放行 200', async () => {
    await seed(ALL);
    const res = await post();
    expect(res.status).toBe(200);
  });

  it('闸拦下时该批一格都不落库（整 run 拒收）', async () => {
    await seed(ALL.slice(0, 2));
    await post();
    const { rows } = await pool.query(
      `SELECT ai_verdict FROM acceptance_checks c JOIN acceptance_runs r ON r.id = c.run_id
       WHERE r.run_key = $1`, [RUN_KEY]
    );
    expect(rows.every((r) => r.ai_verdict === null)).toBe(true);
  });
});

describe('mandatory 集合从规程派生（r6-P2-2：代码里不许出现格号）', () => {
  // 上面那组用例全在 fixture 的 5 个码上打转：把这 5 个码抄进实现里当常量，它们会一条不落地全绿。
  // 这一组换一份 mandatory 集合不同的规程，闸的结论必须跟着规程走。
  const ORIGINAL = process.env.ACCEPTANCE_SPEC_PATH;
  const tmpFiles = [];

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.ACCEPTANCE_SPEC_PATH;
    else process.env.ACCEPTANCE_SPEC_PATH = ORIGINAL;
    _resetSpecSetsForTest();
    while (tmpFiles.length) fs.rmSync(tmpFiles.pop(), { force: true });
  });

  it('规程里 S10-c4 不再是 mandatory → 只勾另外 4 个码也放行 200', async () => {
    const doc = yaml.load(fs.readFileSync(FIXTURE, 'utf-8'));
    delete doc.steps.find((s) => s.n === 10).cells.c4.scenario_class;
    const tmp = path.join(os.tmpdir(), `acceptance-gate-spec-${process.pid}.yaml`);
    fs.writeFileSync(tmp, yaml.dump(doc));
    tmpFiles.push(tmp);
    process.env.ACCEPTANCE_SPEC_PATH = tmp;
    _resetSpecSetsForTest();

    await seed(ALL.filter((c) => c !== 'S10-c4'));
    const res = await post();
    expect(res.status).toBe(200);
  });

  it('纯函数只认传进来的集合，不自带格号', () => {
    const sets = { mandatoryScenarioCodes: ['X1-c1', 'X2-c2'] };
    expect(missingMandatoryScenarios({ scenarios_observed: ['X1-c1'] }, sets)).toEqual(['X2-c2']);
    expect(missingMandatoryScenarios({ scenarios_observed: ALL }, sets)).toEqual(['X1-c1', 'X2-c2']);
    expect(missingMandatoryScenarios(null, sets)).toEqual(['X1-c1', 'X2-c2']);
  });
});
