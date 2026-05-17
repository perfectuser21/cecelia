/**
 * Integration Test: OKR 任务完成 → KR 进度反馈链路
 *
 * 验证核心行为：
 *   Task 完成状态 → POST recalculate-progress → current_value 更新
 *
 * 链路：
 *   objectives → key_results → okr_projects → okr_scopes
 *     → okr_initiatives → tasks（okr_initiative_id 外键）
 *   POST /api/brain/okr/key-results/:id/recalculate-progress
 *     统计 completed 任务数 → 更新 KR.current_value
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
let objId, krId, projectId, scopeId, initiativeId;
const taskIds = [];

beforeAll(async () => {
  const okrMod = await import('../../routes/okr-hierarchy.js');
  app = express();
  app.use(express.json());
  app.use('/api/brain/okr', okrMod.default);

  // 创建 OKR 层级：objective → KR(target=100) → project → scope → initiative
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

  const projRes = await pool.query(
    `INSERT INTO okr_projects (kr_id, title, status) VALUES ($1, $2, 'active') RETURNING id`,
    [krId, `[l3-test] Project-${Date.now()}`]
  );
  projectId = projRes.rows[0].id;

  const scopeRes = await pool.query(
    `INSERT INTO okr_scopes (project_id, title, status) VALUES ($1, $2, 'active') RETURNING id`,
    [projectId, `[l3-test] Scope-${Date.now()}`]
  );
  scopeId = scopeRes.rows[0].id;

  const initRes = await pool.query(
    `INSERT INTO okr_initiatives (scope_id, title, status) VALUES ($1, $2, 'active') RETURNING id`,
    [scopeId, `[l3-test] Initiative-${Date.now()}`]
  );
  initiativeId = initRes.rows[0].id;
});

afterAll(async () => {
  // 先解除 tasks 的 FK 引用，再删除
  if (taskIds.length) {
    await pool.query(
      'UPDATE tasks SET okr_initiative_id = NULL WHERE id = ANY($1::uuid[])',
      [taskIds]
    );
    await pool.query('DELETE FROM tasks WHERE id = ANY($1::uuid[])', [taskIds]);
  }
  // CASCADE from objective removes KR → projects → scopes → initiatives
  if (objId) {
    await pool.query('DELETE FROM objectives WHERE id = $1', [objId]);
  }
  await pool.end();
});

// ─── 无任务时的初始状态 ────────────────────────────────────────────────────────

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
});

// ─── 任务状态 → progress 反馈 ─────────────────────────────────────────────────

describe('OKR 任务进度链路: 任务状态驱动 KR 进度', () => {
  it('Step 1 — 创建 3 个 queued 任务，progress 仍为 0', async () => {
    for (let i = 0; i < 3; i++) {
      const r = await pool.query(
        `INSERT INTO tasks (title, status, priority, task_type, okr_initiative_id)
         VALUES ($1, 'queued', 'P2', 'dev', $2) RETURNING id`,
        [`[l3-test] Task-${i}`, initiativeId]
      );
      taskIds.push(r.rows[0].id);
    }

    const res = await request(app)
      .post(`/api/brain/okr/key-results/${krId}/recalculate-progress`)
      .expect(200);

    expect(res.body.completed_tasks).toBe(0);
    expect(res.body.total_tasks).toBe(3);
    expect(res.body.current_value).toBe(0);
  });

  it('Step 2 — 完成 1/3 任务 → progress ≈ 33.33', async () => {
    await pool.query(
      `UPDATE tasks SET status = 'completed' WHERE id = $1`,
      [taskIds[0]]
    );

    const res = await request(app)
      .post(`/api/brain/okr/key-results/${krId}/recalculate-progress`)
      .expect(200);

    expect(res.body.completed_tasks).toBe(1);
    expect(res.body.total_tasks).toBe(3);
    // target=100, completed=1/3 → current_value ≈ 33.33
    expect(res.body.current_value).toBeCloseTo(33.33, 1);
    expect(res.body.current_value).toBeGreaterThan(0);
  });

  it('Step 3 — 全部完成 → progress=100 = target_value', async () => {
    await pool.query(
      `UPDATE tasks SET status = 'completed' WHERE id = ANY($1::uuid[])`,
      [taskIds]
    );

    const res = await request(app)
      .post(`/api/brain/okr/key-results/${krId}/recalculate-progress`)
      .expect(200);

    expect(res.body.completed_tasks).toBe(3);
    expect(res.body.total_tasks).toBe(3);
    expect(res.body.current_value).toBe(100);
    expect(res.body.current_value).toBe(res.body.target_value);
  });

  it('Step 4 — DB 验证：key_results.current_value 已持久化为 100', async () => {
    const { rows } = await pool.query(
      'SELECT current_value FROM key_results WHERE id = $1',
      [krId]
    );
    expect(parseFloat(rows[0].current_value)).toBe(100);
  });
});

// ─── 边界条件 ─────────────────────────────────────────────────────────────────

describe('OKR 任务进度链路: 边界条件', () => {
  it('不存在的 KR → 404', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const res = await request(app)
      .post(`/api/brain/okr/key-results/${fakeId}/recalculate-progress`)
      .expect(404);
    expect(res.body.success).toBe(false);
  });
});
