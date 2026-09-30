/**
 * Integration Test: OKR 任务完成 → KR 进度反馈链路
 *
 * 棒4（决策 ee4842a6/3feeae3e）：okr_scopes / okr_initiatives 层退役，migration 499 给
 * okr_scopes / okr_initiatives / okr_projects 加写保护触发器（INSERT/UPDATE 抛
 * layer_retired，DELETE 允许）。原「objectives → key_results → okr_projects → okr_scopes
 * → okr_initiatives → tasks」全链路任务驱动进度测试的前置写入（直接 INSERT INTO
 * okr_scopes/okr_initiatives）现在必然被写保护 trigger 拦截，因此整段删除——
 * project 层的任务聚合进度重算改写是接力棒棒5的工作范围（本棒不做），
 * 这里只保留“无任务时的基线行为”与“写保护 trigger 真报红”两类断言。
 *
 * 路由：packages/brain/src/routes/okr-hierarchy.js
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';

const { Pool } = pg;
const pool = new Pool({ ...DB_DEFAULTS, max: 3 });

let app;
let objId, krId, projectId;

beforeAll(async () => {
  const okrMod = await import('../../routes/okr-hierarchy.js');
  app = express();
  app.use(express.json());
  app.use('/api/brain/okr', okrMod.default);

  const objRes = await pool.query(
    `INSERT INTO objectives (title, status) VALUES ($1, 'active') RETURNING id`,
    [`[l3-test] Objective-${Date.now()}`]
  );
  objId = objRes.rows[0].id;

  const krRes = await pool.query(
    `INSERT INTO key_results (objective_id, title, target_value, current_value, unit, status)
     VALUES ($1, $2, 100, 0, '%', 'active') RETURNING id`,
    [objId, `[l3-test] KR-${Date.now()}`]
  );
  krId = krRes.rows[0].id;

  // Project 层真身表已改指 projects（棒1/棒4），okr_projects 不再是创建目标
  const projRes = await pool.query(
    `INSERT INTO projects (kr_id, name, status) VALUES ($1, $2, 'active') RETURNING id`,
    [krId, `[l3-test] Project-${Date.now()}`]
  );
  projectId = projRes.rows[0].id;
});

afterAll(async () => {
  if (projectId) {
    await pool.query('DELETE FROM projects WHERE id = $1', [projectId]);
  }
  if (objId) {
    // CASCADE from objective removes key_results
    await pool.query('DELETE FROM objectives WHERE id = $1', [objId]);
  }
  await pool.end();
});

// ─── 无任务时的初始状态（新链路下唯一还能验证的基线行为） ──────────────────────────

describe('OKR 任务进度链路: 初始状态（无任务）', () => {
  it('recalculate-progress 返回 progress=0, total=0', async () => {
    const res = await request(app)
      .post(`/api/brain/okr/key-results/${krId}/recalculate-progress`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.kr_id).toBe(krId);
    expect(res.body.completed_tasks).toBe(0);
    expect(res.body.total_tasks).toBe(0);
    expect(res.body.current_value).toBe(0);
    expect(typeof res.body.target_value).toBe('number');
  });

  it('不存在的 KR → 404', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const res = await request(app)
      .post(`/api/brain/okr/key-results/${fakeId}/recalculate-progress`)
      .expect(404);
    expect(res.body.success).toBe(false);
  });
});

// ─── 写保护 trigger：proven-to-fire（migration 499） ──────────────────────────────

describe('OKR 层退役: 写保护 trigger（migration 499）', () => {
  it('直接 INSERT INTO okr_scopes 被拒绝（layer_retired）', async () => {
    await expect(
      pool.query(
        `INSERT INTO okr_scopes (project_id, title, status) VALUES ($1, $2, 'active')`,
        [projectId, '[l3-test] should be rejected']
      )
    ).rejects.toThrow(/layer_retired/);
  });

  it('直接 INSERT INTO okr_initiatives 被拒绝（layer_retired）', async () => {
    await expect(
      pool.query(
        `INSERT INTO okr_initiatives (title, status) VALUES ($1, 'planned')`,
        ['[l3-test] should be rejected']
      )
    ).rejects.toThrow(/layer_retired/);
  });

  it('直接 INSERT INTO okr_projects 被拒绝（layer_retired，新数据一律进 projects）', async () => {
    await expect(
      pool.query(
        `INSERT INTO okr_projects (kr_id, title, status) VALUES ($1, $2, 'active')`,
        [krId, '[l3-test] should be rejected']
      )
    ).rejects.toThrow(/layer_retired/);
  });
});
