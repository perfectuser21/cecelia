/**
 * Integration Test: KR 进度按 projects/tasks 聚合（棒5，接力棒链 2afa6d69，决策 ee4842a6/3feeae3e）
 *
 * mock 测不到的三件事（真库才能验证）：
 *   1. cancelled 任务真的被排除在分母外（mock 测只能验证 SQL 文本里带了这个条件，
 *      测不到 Postgres 真的按它过滤）
 *   2. updateKrProgress 真的把 progress + metadata.progress_source 写进 key_results
 *   3. KR 名下没有 project 时，现值真的没被覆盖（不是"mock 没调用 UPDATE"这种弱断言）
 *
 * 场景（任务简报指定的验收数值）：
 *   KR 下 2 个 project：
 *     project-A：3 个任务，2 个 completed，1 个 in_progress → 66.67%
 *     project-B：2 个任务，全部 completed（含 1 个 completed_no_pr）→ 100%
 *   KR 进度 = (66.67 + 100) / 2 = 83.335 → round → 83
 *
 * 依赖：PostgreSQL cecelia_test 数据库可访问（DB_DEFAULTS，见 db-config.js）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { DB_DEFAULTS } from '../../db-config.js';
import { updateKrProgress } from '../../kr-progress.js';
import { getProjectsForKrBatch } from '../../project-progress.js';
import { recalculateKrProgress } from '../../lib/kr-recalculate-progress.js';

const pool = new pg.Pool({ ...DB_DEFAULTS, max: 3 });

let objId;
let krWithProjectsId;
let krNoProjectId;
let projectAId;
let projectBId;

async function insertTask({ projectId, status, taskType = 'dev' }) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO tasks (id, title, task_type, status, priority, project_id)
     VALUES ($1, $2, $3, $4, 'P2', $5)`,
    [id, `[kr-agg-test] task-${id.slice(0, 8)}`, taskType, status, projectId]
  );
  return id;
}

beforeAll(async () => {
  const objRes = await pool.query(
    `INSERT INTO objectives (title, status) VALUES ($1, 'active') RETURNING id`,
    [`[kr-agg-test] Objective-${Date.now()}`]
  );
  objId = objRes.rows[0].id;

  const kr1Res = await pool.query(
    `INSERT INTO key_results (objective_id, title, target_value, current_value, unit, status, progress)
     VALUES ($1, $2, 100, 0, '%', 'active', 0) RETURNING id`,
    [objId, `[kr-agg-test] KR-with-projects-${Date.now()}`]
  );
  krWithProjectsId = kr1Res.rows[0].id;

  const kr2Res = await pool.query(
    `INSERT INTO key_results (objective_id, title, target_value, current_value, unit, status, progress)
     VALUES ($1, $2, 100, 0, '%', 'active', 42) RETURNING id`,
    [objId, `[kr-agg-test] KR-no-project-${Date.now()}`]
  );
  krNoProjectId = kr2Res.rows[0].id;

  const projARes = await pool.query(
    `INSERT INTO projects (kr_id, name, status) VALUES ($1, $2, 'active') RETURNING id`,
    [krWithProjectsId, '[kr-agg-test] Project-A']
  );
  projectAId = projARes.rows[0].id;

  const projBRes = await pool.query(
    `INSERT INTO projects (kr_id, name, status) VALUES ($1, $2, 'active') RETURNING id`,
    [krWithProjectsId, '[kr-agg-test] Project-B']
  );
  projectBId = projBRes.rows[0].id;

  // Project A：3 个任务，2 completed，1 in_progress
  await insertTask({ projectId: projectAId, status: 'completed' });
  await insertTask({ projectId: projectAId, status: 'completed' });
  await insertTask({ projectId: projectAId, status: 'in_progress' });
  // 混一个 cancelled 任务：必须被排除在分母外，否则会变成 2/4=50%
  await insertTask({ projectId: projectAId, status: 'cancelled' });
  // 混一个 task_type='project' 的子项目根任务：同样必须被排除在分母外
  await insertTask({ projectId: projectAId, status: 'completed', taskType: 'project' });

  // Project B：2 个任务全 completed（一个 completed_no_pr）
  await insertTask({ projectId: projectBId, status: 'completed' });
  await insertTask({ projectId: projectBId, status: 'completed_no_pr' });
}, 30_000);

afterAll(async () => {
  await pool.query('DELETE FROM tasks WHERE project_id IN ($1, $2)', [projectAId, projectBId]);
  await pool.query('DELETE FROM projects WHERE id IN ($1, $2)', [projectAId, projectBId]);
  if (objId) await pool.query('DELETE FROM objectives WHERE id = $1', [objId]); // CASCADE 清 key_results
  await pool.end();
}, 30_000);

describe('project-progress.js: 真库聚合口径', () => {
  it('cancelled 任务与 task_type=project 的子项目根任务不计入分母', async () => {
    const byKr = await getProjectsForKrBatch(pool, [krWithProjectsId]);
    const projA = byKr[krWithProjectsId].find((p) => p.id === projectAId);
    expect(projA.task_total).toBe(3); // 5 条任务里只有 3 条计数
    expect(projA.task_done).toBe(2);
    expect(projA.progress).toBeCloseTo(66.67, 1);
  });

  it('completed_no_pr 算作完成', async () => {
    const byKr = await getProjectsForKrBatch(pool, [krWithProjectsId]);
    const projB = byKr[krWithProjectsId].find((p) => p.id === projectBId);
    expect(projB.task_total).toBe(2);
    expect(projB.task_done).toBe(2);
    expect(projB.progress).toBe(100);
  });
});

describe('updateKrProgress: 真写入 key_results', () => {
  it('KR 进度 = 名下 project 进度算术平均，四舍五入取整；写 progress_source 标记', async () => {
    const result = await updateKrProgress(pool, krWithProjectsId);
    expect(result.progress).toBe(83);
    expect(result.total).toBe(2);

    const { rows } = await pool.query(
      'SELECT progress, metadata FROM key_results WHERE id = $1',
      [krWithProjectsId]
    );
    expect(rows[0].progress).toBe(83);
    expect(rows[0].metadata.progress_source).toBe('projects_v1');
    expect(rows[0].metadata.progress_computed_at).toBeTruthy();
  });

  it('KR 名下无 project 时不覆盖现值（保留手填的 42）', async () => {
    const result = await updateKrProgress(pool, krNoProjectId);
    expect(result.progress).toBe(42);

    const { rows } = await pool.query('SELECT progress FROM key_results WHERE id = $1', [krNoProjectId]);
    expect(rows[0].progress).toBe(42);
  });
});


describe('KR 重算写库回归（任务7aeb81a6）', () => {
  it('NULL target 清除 NaN，项目等权 progress=83 与来源实际入库', async () => {
    await pool.query("UPDATE key_results SET target_value=NULL,current_value='NaN' WHERE id=$1",[krWithProjectsId]);
    const result = await recalculateKrProgress(pool,krWithProjectsId);
    expect(result).toMatchObject({progress:83,current_value:null,completed_tasks:4,total_tasks:5});
    const { rows } = await pool.query('SELECT current_value,progress,metadata FROM key_results WHERE id=$1',[krWithProjectsId]);
    expect(rows[0]).toMatchObject({current_value:null,progress:83,metadata:{progress_source:'projects_v1'}});
  });
  it('target=200 时按同一进度写166，并保持幂等', async () => {
    await pool.query('UPDATE key_results SET target_value=200 WHERE id=$1',[krWithProjectsId]);
    const first = await recalculateKrProgress(pool,krWithProjectsId);
    expect(await recalculateKrProgress(pool,krWithProjectsId)).toEqual(first);
    const { rows } = await pool.query('SELECT current_value::text,progress FROM key_results WHERE id=$1',[krWithProjectsId]);
    expect(Number(rows[0].current_value)).toBe(166);
    expect(rows[0].progress).toBe(83);
  });
});


it('无项目清理与人类更新交错时保留新目标和新现值（审阅回归）', async () => {
  await pool.query('UPDATE key_results SET target_value=NULL,current_value=12,progress=42 WHERE id=$1',[krNoProjectId]);
  let changed = false;
  const racingPool = { query: async (sql, params) => {
    if (!changed && sql.includes('FROM projects')) {
      changed = true;
      await pool.query('UPDATE key_results SET target_value=100,current_value=70 WHERE id=$1',[krNoProjectId]);
    }
    return pool.query(sql,params);
  }};
  const result = await recalculateKrProgress(racingPool,krNoProjectId);
  expect(result).toMatchObject({target_value:100,current_value:70,progress:42});
  const { rows } = await pool.query('SELECT current_value FROM key_results WHERE id=$1',[krNoProjectId]);
  expect(Number(rows[0].current_value)).toBe(70);
});
