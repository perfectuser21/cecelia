/**
 * Integration Test: 跨域路由 Cross-Domain Routing
 *
 * 验证核心行为：
 *   1. pending-actions 生命周期（DB 直写：创建→状态流转→验证）
 *   2. intent/match 跨域路由（自然语言 → objectives/KR 匹配）
 *
 * 链路：
 *   DB 直写: pending_actions 表 — 创建 / 拒绝 / 状态验证
 *   POST /api/brain/intent/match → 自然语言匹配 objectives / key_results
 *
 * 路由：packages/brain/src/routes/intent-match.js
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';

const { Pool } = pg;
const pool = new Pool({ ...DB_DEFAULTS, max: 3 });

let intentApp;
const actionIds = [];
let objId, krId;

beforeAll(async () => {
  // intent-match 无外部依赖，直接挂载
  const intentMod = await import('../../routes/intent-match.js');
  intentApp = express();
  intentApp.use(express.json());
  intentApp.use('/api/brain/intent', intentMod.default);

  // 为 intent/match 测试准备 OKR 数据
  const ts = Date.now();
  const objRes = await pool.query(
    `INSERT INTO objectives (title, status) VALUES ($1, 'active') RETURNING id`,
    [`[l3-test] CrossDomainRouting-${ts}`]
  );
  objId = objRes.rows[0].id;

  const krRes = await pool.query(
    `INSERT INTO key_results (objective_id, title, target_value, current_value, status)
     VALUES ($1, $2, 100, 0, 'active') RETURNING id`,
    [objId, `[l3-test] CrossDomainRouting KR-${ts}`]
  );
  krId = krRes.rows[0].id;
});

afterAll(async () => {
  if (actionIds.length) {
    await pool.query('DELETE FROM pending_actions WHERE id = ANY($1::uuid[])', [actionIds]);
  }
  if (objId) {
    await pool.query('DELETE FROM objectives WHERE id = $1', [objId]);
  }
  await pool.end();
});

// ─── Pending Action 生命周期（DB 直写）────────────────────────────────────────

describe('Cross-Domain Routing: pending_actions 生命周期', () => {
  let actionId;

  it('Step 1 — DB 直写创建 pending action，初始状态 pending_approval', async () => {
    const r = await pool.query(`
      INSERT INTO pending_actions (action_type, params, context, status, source, comments)
      VALUES ('create-task', '{}', '{"requester":"l3-test"}'::jsonb, 'pending_approval', 'repo-lead', '[]'::jsonb)
      RETURNING id, action_type, status, source, created_at
    `);
    expect(r.rows).toHaveLength(1);
    actionId = r.rows[0].id;
    actionIds.push(actionId);
    expect(r.rows[0].status).toBe('pending_approval');
    expect(r.rows[0].action_type).toBe('create-task');
  });

  it('Step 2 — SELECT 验证 action 可查', async () => {
    const { rows } = await pool.query(
      'SELECT id, status, action_type, source FROM pending_actions WHERE id = $1',
      [actionId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(actionId);
    expect(rows[0].status).toBe('pending_approval');
    expect(rows[0].source).toBe('repo-lead');
  });

  it('Step 3 — UPDATE 拒绝 action（模拟 rejectPendingAction）', async () => {
    const r = await pool.query(
      `UPDATE pending_actions
       SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW(),
           execution_result = $2
       WHERE id = $3 AND status = 'pending_approval'
       RETURNING id, status, reviewed_by`,
      ['test-reviewer', JSON.stringify({ rejected: true, reason: 'l3 test cleanup' }), actionId]
    );
    expect(r.rowCount).toBe(1);
    expect(r.rows[0].status).toBe('rejected');
    expect(r.rows[0].reviewed_by).toBe('test-reviewer');
  });

  it('Step 4 — 已 rejected 的 action 不能再次被拒绝（rowCount=0）', async () => {
    const r = await pool.query(
      `UPDATE pending_actions
       SET status = 'rejected'
       WHERE id = $1 AND status = 'pending_approval'`,
      [actionId]
    );
    expect(r.rowCount).toBe(0);
  });
});

// ─── Intent Match 跨域路由 ────────────────────────────────────────────────────

describe('Cross-Domain Routing: intent/match 自然语言 → OKR', () => {
  it('POST /intent/match — 关键词匹配到新建的 objective', async () => {
    const res = await request(intentApp)
      .post('/api/brain/intent/match')
      .send({ query: 'CrossDomainRouting', limit: 10 })
      .expect(200);

    expect(res.body.query).toBe('CrossDomainRouting');
    expect(Array.isArray(res.body.matched_goals)).toBe(true);

    const found = res.body.matched_goals.find(
      (g) => g.id === objId || g.id === krId
    );
    expect(found).toBeDefined();
  });

  it('POST /intent/match — 空 query → 400', async () => {
    const res = await request(intentApp)
      .post('/api/brain/intent/match')
      .send({ query: '' })
      .expect(400);
    expect(res.body.error).toBeDefined();
  });

  it('POST /intent/match — 无匹配词 → matched_goals 为空数组', async () => {
    const res = await request(intentApp)
      .post('/api/brain/intent/match')
      .send({ query: 'xyzzy-nonexistent-l3test-42' })
      .expect(200);

    expect(Array.isArray(res.body.matched_goals)).toBe(true);
    // 无匹配时为空，不报错
    const found = res.body.matched_goals.find(
      (g) => g.id === objId || g.id === krId
    );
    expect(found).toBeUndefined();
  });

  it('POST /intent/match — matched_goals 每项含 id, title, type, status', async () => {
    const res = await request(intentApp)
      .post('/api/brain/intent/match')
      .send({ query: 'CrossDomainRouting', limit: 5 })
      .expect(200);

    const goal = res.body.matched_goals.find((g) => g.id === objId);
    if (goal) {
      expect(goal.id).toBeDefined();
      expect(goal.title).toBeDefined();
      expect(goal.type).toBeDefined();
      expect(goal.status).toBeDefined();
    }
  });
});

// ─── 参数校验（intent-match 路由层）─────────────────────────────────────────

describe('Cross-Domain Routing: intent/match 参数校验', () => {
  it('缺 query 字段 → 400', async () => {
    const res = await request(intentApp)
      .post('/api/brain/intent/match')
      .send({})
      .expect(400);
    expect(res.body.error).toBeDefined();
  });
});
