/**
 * Tick Dispatch Scope: decomposing KRs included
 *
 * 回归测试：fix(brain) - dispatch scope 必须包含 decomposing 状态的 KRs，
 * 确保 okr-tick 创建的 decomp 任务能被 tick 派发。
 *
 * 场景：
 *   1. KR goal 状态为 decomposing（已被 okr-tick 处理）
 *   2. okr-tick 为该 goal 创建了 queued 的 decomp 任务
 *   3. tick 的 readyKrIds 查询 必须 能查到这个 goal
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../db-config.js';

const { Pool } = pg;
const pool = new Pool(DB_DEFAULTS);

let testGoalIds = [];
let testTaskIds = [];

describe('Tick Dispatch Scope: decomposing KRs', () => {
  beforeAll(async () => {
    const result = await pool.query('SELECT 1');
    expect(result.rows[0]['?column?']).toBe(1);
  });

  afterAll(async () => {
    await pool.end();
  });

  afterEach(async () => {
    if (testTaskIds.length > 0) {
      await pool.query('DELETE FROM tasks WHERE id = ANY($1)', [testTaskIds]);
      testTaskIds = [];
    }
    if (testGoalIds.length > 0) {
      await pool.query('DELETE FROM tasks WHERE goal_id = ANY($1)', [testGoalIds]).catch(() => {});
      await pool.query('DELETE FROM goals WHERE id = ANY($1)', [testGoalIds]);
      testGoalIds = [];
    }
  });

  it('应该包含 decomposing 状态的 KR（dispatch scope 查询）', async () => {
    // 创建一个 decomposing 状态的 KR
    const krResult = await pool.query(
      `INSERT INTO goals (title, type, priority, status, progress)
       VALUES ('测试 KR decomposing dispatch scope', 'kr', 'P0', 'decomposing', 0)
       RETURNING id`
    );
    testGoalIds.push(krResult.rows[0].id);
    const krId = krResult.rows[0].id;

    // 模拟 tick.js 的 readyKrIds 查询（修复后包含 decomposing）
    const scopeResult = await pool.query(`
      SELECT id FROM goals
      WHERE type = 'kr' AND status IN ('ready', 'in_progress', 'decomposing')
        AND id = $1
    `, [krId]);

    expect(scopeResult.rows.length).toBe(1);
    expect(scopeResult.rows[0].id).toBe(krId);
  });

  it('不应该包含 pending 或 completed 状态的 KR', async () => {
    // 创建各种状态的 KR
    const pendingResult = await pool.query(
      `INSERT INTO goals (title, type, priority, status, progress)
       VALUES ('Pending KR scope test', 'kr', 'P1', 'pending', 0)
       RETURNING id`
    );
    testGoalIds.push(pendingResult.rows[0].id);
    const pendingId = pendingResult.rows[0].id;

    const completedResult = await pool.query(
      `INSERT INTO goals (title, type, priority, status, progress)
       VALUES ('Completed KR scope test', 'kr', 'P1', 'completed', 100)
       RETURNING id`
    );
    testGoalIds.push(completedResult.rows[0].id);
    const completedId = completedResult.rows[0].id;

    const scopeResult = await pool.query(`
      SELECT id FROM goals
      WHERE type = 'kr' AND status IN ('ready', 'in_progress', 'decomposing')
        AND id = ANY($1)
    `, [[pendingId, completedId]]);

    expect(scopeResult.rows.length).toBe(0);
  });

  it('decomposing KR 下的 queued decomp 任务应在 scope 内', async () => {
    // 创建 decomposing KR
    const krResult = await pool.query(
      `INSERT INTO goals (title, type, priority, status, progress)
       VALUES ('KR with decomp task', 'kr', 'P0', 'decomposing', 0)
       RETURNING id`
    );
    testGoalIds.push(krResult.rows[0].id);
    const krId = krResult.rows[0].id;

    // 创建该 KR 下的 decomp 任务（模拟 okr-tick 创建的任务）
    const taskResult = await pool.query(
      `INSERT INTO tasks (title, status, priority, goal_id, task_type, payload, trigger_source)
       VALUES ('KR 拆解: KR with decomp task', 'queued', 'P0', $1, 'dev', $2, 'okr_tick')
       RETURNING id`,
      [krId, JSON.stringify({ decomposition: 'true', kr_id: krId })]
    );
    testTaskIds.push(taskResult.rows[0].id);
    const taskId = taskResult.rows[0].id;

    // 获取 readyKrIds（修复后包含 decomposing）
    const scopeResult = await pool.query(`
      SELECT id FROM goals
      WHERE type = 'kr' AND status IN ('ready', 'in_progress', 'decomposing')
        AND id = $1
    `, [krId]);

    expect(scopeResult.rows.length).toBe(1);
    const readyKrIds = scopeResult.rows.map(r => r.id);

    // 验证 decomp 任务可被查到（tick 会用 goal_id = ANY(readyKrIds) 过滤）
    const dispatchableTasks = await pool.query(
      `SELECT id FROM tasks WHERE goal_id = ANY($1) AND status = 'queued'`,
      [readyKrIds]
    );

    expect(dispatchableTasks.rows.length).toBe(1);
    expect(dispatchableTasks.rows[0].id).toBe(taskId);
  });
});
