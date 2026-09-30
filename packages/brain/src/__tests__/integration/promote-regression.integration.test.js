/**
 * T2 累积 FR 链路集成测试（真实 PostgreSQL）——golden_path 旧表退役版（任务 7d312fd8）。
 *
 * 旧表 golden_path（L4 step）已由 steps / journey_step_links / step_probes 取代，
 * 本文件钉死三件事：
 *   1. harness_initiative merged 终态 → promoteRegressionOnHarnessMerged 不再向 golden_path 写行
 *   2. 二次触发同样零写入（幂等 = 没有副作用）
 *   3. line-context 默认（GOLDEN_PATH_LEGACY_READ 未开）不读旧表、cumulativeFR 为空且不 throw；
 *      应急放行窗口下旧 SQL 仍可执行（表未 DROP），读到的也是空
 *
 * 运行环境：CI brain-integration job（pgvector:pg15 service + node src/migrate.js）。
 * 连接约定与 golden-path.integration.test.js 一致：pg.Pool({ ...DB_DEFAULTS })，
 * db-config.js 在 VITEST 下默认库名 cecelia_test 并 guard 禁连生产 cecelia。
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
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
const STEP_2 = 'golden_path 旧表已退役，merged 终态不再落行';

describe('promote-regression integration (T2): merged → golden_path 停写 → line-context 不读旧表', () => {
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
      '- [x] [BEHAVIOR] promote 后 golden_path 零新增行',
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
      })]
    );
    taskId = t.rows[0].id;
  }, 30000);

  afterAll(async () => {
    if (taskId) await pool.query('DELETE FROM tasks WHERE id = $1', [taskId]);
    if (abilityId) await pool.query('DELETE FROM journey_features WHERE id = $1', [abilityId]);
    if (journeyId) await pool.query('DELETE FROM journeys WHERE id = $1', [journeyId]);
    if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
    await pool.end();
  });

  beforeEach(() => { delete process.env.GOLDEN_PATH_LEGACY_READ; });

  async function goldenPathRows() {
    const { rows } = await pool.query(
      'SELECT count(*)::int AS n FROM golden_path WHERE owner_task_id = $1',
      [taskId]
    );
    return rows[0].n;
  }

  it('merged 终态 → golden_path 零新增行（旧表停写），表本身仍在（未 DROP）', async () => {
    await promoteRegressionOnHarnessMerged(taskId, { merged: true }, null, pool);
    expect(await goldenPathRows()).toBe(0);
  });

  it('二次触发同样零写入', async () => {
    await promoteRegressionOnHarnessMerged(taskId, { merged: true }, null, pool);
    expect(await goldenPathRows()).toBe(0);
  });

  it('line-context 默认不读旧表：cumulativeFR 为空、invariants 无 step 层、不 throw', async () => {
    const ctx = await fetchLineContext({ pool }, { taskId, journeyId, abilityId });
    expect(ctx.cumulativeFR).toEqual([]);
    expect(ctx.invariants.some((d) => d.source_level === 'step')).toBe(false);
  });

  it('GOLDEN_PATH_LEGACY_READ=1 应急窗口：旧 SQL 仍可跑（表未 DROP），该 journey 读回为空', async () => {
    process.env.GOLDEN_PATH_LEGACY_READ = '1';
    try {
      const ctx = await fetchLineContext({ pool }, { taskId, journeyId, abilityId });
      expect(ctx.cumulativeFR).toEqual([]);
    } finally {
      delete process.env.GOLDEN_PATH_LEGACY_READ;
    }
  });
});
