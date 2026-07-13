/**
 * T2 累积 FR 通电端到端集成测试（真实 PostgreSQL）
 *
 * 覆盖三件事：
 *   1. harness_initiative merged 终态 → promoteRegressionOnHarnessMerged →
 *      golden_path 落行且 feature_id 非空（payload 缺 feature_id 时回退 tasks.ability_id）
 *   2. 二次触发幂等（DELETE by owner_task_id + INSERT 覆盖写，行数不叠加）
 *   3. line-context 新 SQL（golden_path.feature_id 直连 journey_features）能读回该 run
 *
 * 运行环境：CI brain-integration job（pgvector:pg15 service + node src/migrate.js）。
 * 连接约定与 golden-path.integration.test.js 一致：pg.Pool({ ...DB_DEFAULTS })，
 * db-config.js 在 VITEST 下默认库名 cecelia_test 并 guard 禁连生产 cecelia。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';
import { promoteRegressionOnHarnessMerged } from '../../lib/callback-postprocess.js';
import { fetchLineContext } from '../../harness-line-context.js';

const pool = new pg.Pool({ ...DB_DEFAULTS, max: 3 });

const SPRINT_DIR = 'docs/sprints/t2-promote-regression-itest';
const STEP_1 = '用户提交 harness 任务，PR 合并触发 merged 终态回调';
const STEP_2 = 'golden_path 表落行，line-context 累积 FR 可读回';

describe('promote-regression integration (T2): merged → golden_path → line-context 读回', () => {
  let tmpRoot;
  let journeyId;
  let abilityId;
  let taskId;

  beforeAll(async () => {
    // ── tmp worktree 夹具（sprint-prd.md + contract-dod.md）──
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 't2-promote-itest-'));
    const sprintPath = path.join(tmpRoot, SPRINT_DIR);
    fs.mkdirSync(sprintPath, { recursive: true });
    fs.writeFileSync(path.join(sprintPath, 'sprint-prd.md'), [
      '# Sprint PRD — T2 promote-regression 集成测试夹具',
      '',
      '## Golden Path（核心场景）',
      '',
      `1. ${STEP_1}`,
      `2. ${STEP_2}`,
      '',
      '## 其他',
      '',
      '无。',
      '',
    ].join('\n'), 'utf8');
    fs.writeFileSync(path.join(sprintPath, 'contract-dod.md'), [
      '# Contract DoD',
      '',
      '- [x] [BEHAVIOR] promote 后 golden_path 有行且 feature_id 非空',
      '  Test: manual:node -e "process.exit(0)"',
      '',
    ].join('\n'), 'utf8');

    // ── DB 夹具：journey → journey_feature(ability, done) → harness_initiative task ──
    const j = await pool.query(
      `INSERT INTO journeys (name, description)
       VALUES ('[t2-itest] promote-regression 集成测试 journey', '集成测试自动创建，afterAll 清理')
       RETURNING id`
    );
    journeyId = j.rows[0].id;

    const f = await pool.query(
      `INSERT INTO journey_features (journey_id, name, kind, status)
       VALUES ($1, '[t2-itest] promote-regression 集成测试 ability', 'ability', 'done')
       RETURNING id`,
      [journeyId]
    );
    abilityId = f.rows[0].id;

    const t = await pool.query(
      `INSERT INTO tasks (title, task_type, status, pr_url, ability_id, payload)
       VALUES ('[t2-itest] harness merged 终态任务', 'harness_initiative', 'completed',
               'https://github.com/test/cecelia/pull/99999', $1, $2::jsonb)
       RETURNING id`,
      [abilityId, JSON.stringify({
        sprint_dir: SPRINT_DIR,
        worktree_path: tmpRoot,
        journey_id: journeyId,
        // 故意不带 feature_id：验证回退 tasks.ability_id 路径
      })]
    );
    taskId = t.rows[0].id;
  }, 30000);

  afterAll(async () => {
    // 逆序清理；golden_path 行随 tasks ON DELETE CASCADE 自动清
    if (taskId) await pool.query('DELETE FROM tasks WHERE id = $1', [taskId]);
    if (abilityId) await pool.query('DELETE FROM journey_features WHERE id = $1', [abilityId]);
    if (journeyId) await pool.query('DELETE FROM journeys WHERE id = $1', [journeyId]);
    if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
    await pool.end();
  });

  it('merged 终态 → golden_path 落 2 行，feature_id 回退 tasks.ability_id，note 含步骤文字', async () => {
    await promoteRegressionOnHarnessMerged(taskId, { merged: true }, null, pool);

    const { rows } = await pool.query(
      'SELECT order_no, feature_id, note FROM golden_path WHERE owner_task_id = $1 ORDER BY order_no',
      [taskId]
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].feature_id).toBe(abilityId);
    expect(rows[1].feature_id).toBe(abilityId);
    expect(rows[0].note).toContain(STEP_1);
    expect(rows[1].note).toContain(STEP_2);
  });

  it('二次触发幂等：再调一次，仍是 2 行（DELETE+INSERT 覆盖写，不叠加）', async () => {
    await promoteRegressionOnHarnessMerged(taskId, { merged: true }, null, pool);

    const { rows } = await pool.query(
      'SELECT count(*)::int AS n FROM golden_path WHERE owner_task_id = $1',
      [taskId]
    );
    expect(rows[0].n).toBe(2);
  });

  it('line-context 新 SQL（feature_id 直连）读回：cumulativeFR 含该 run，steps=2', async () => {
    const ctx = await fetchLineContext({ pool }, { journeyId });

    const run = ctx.cumulativeFR.find((g) => g.owner_task_id === taskId);
    expect(run).toBeDefined();
    expect(run.ability_id).toBe(abilityId);
    expect(run.ability_status).toBe('done');
    expect(run.steps).toHaveLength(2);
    expect(run.steps.map((s) => s.order_no)).toEqual([1, 2]);
    expect(run.steps[0].feature_id).toBe(abilityId);
  });
});
