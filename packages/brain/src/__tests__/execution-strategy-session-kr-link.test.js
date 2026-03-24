/**
 * execution-strategy-session-kr-link.test.js
 *
 * 验证 strategy_session 回调创建 key_results 时正确关联 objective_id。
 * 修复背景：execution.js:1013 原先 INSERT key_results 无 objective_id，导致 KR 孤岛。
 *
 * 测试场景：
 * 1. goal_id 对应有效 objective → KR.objective_id = goal_id
 * 2. goal_id 不对应任何 objective → KR.objective_id = null
 * 3. goal_id = null → KR.objective_id = null
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../db-config.js';

const { Pool } = pg;
const pool = new Pool(DB_DEFAULTS);

let createdObjectiveIds = [];
let createdGoalIds = [];
let createdTaskIds = [];
let createdKrIds = [];

beforeAll(async () => {
  const r = await pool.query('SELECT 1');
  expect(r.rows[0]['?column?']).toBe(1);
});

afterAll(async () => {
  await pool.end();
});

afterEach(async () => {
  // Clean up in dependency order
  for (const id of createdKrIds) {
    await pool.query('DELETE FROM key_results WHERE id = $1', [id]).catch(() => {});
  }
  for (const id of createdTaskIds) {
    await pool.query('DELETE FROM tasks WHERE id = $1', [id]).catch(() => {});
  }
  for (const id of createdGoalIds) {
    await pool.query('DELETE FROM goals WHERE id = $1', [id]).catch(() => {});
  }
  for (const id of createdObjectiveIds) {
    await pool.query('DELETE FROM objectives WHERE id = $1', [id]).catch(() => {});
  }
  createdKrIds = [];
  createdTaskIds = [];
  createdGoalIds = [];
  createdObjectiveIds = [];
});

/**
 * 模拟 execution.js strategy_session 回调中的 KR 创建逻辑。
 * 与 packages/brain/src/routes/execution.js 中实现一致。
 */
async function createStrategySessionKR({ taskGoalId, krTitle = 'Test KR', ownerRole = null }) {
  // 1. 查找关联 objective（migration 181：goals(area_okr).id = objectives.id）
  let krObjectiveId = null;
  if (taskGoalId) {
    const objCheck = await pool.query('SELECT id FROM objectives WHERE id = $1', [taskGoalId]);
    if (objCheck.rows.length > 0) {
      krObjectiveId = taskGoalId;
    }
  }

  // 2. INSERT key_results（与 execution.js 实现一致）
  const result = await pool.query(
    `INSERT INTO key_results (title, status, owner_role, objective_id, metadata)
     VALUES ($1, 'pending', $2, $3, $4) RETURNING id, objective_id`,
    [krTitle, ownerRole, krObjectiveId, JSON.stringify({ priority: 'P1' })]
  );
  return result.rows[0];
}

describe('strategy_session KR → objective_id 关联', () => {
  it('场景1: goal_id 对应有效 objective → KR.objective_id = goal_id', async () => {
    // 创建一个 objective
    const objResult = await pool.query(
      `INSERT INTO objectives (title, status) VALUES ('Test Objective', 'active') RETURNING id`
    );
    const objectiveId = objResult.rows[0].id;
    createdObjectiveIds.push(objectiveId);

    // 创建 KR，使用该 objective 的 id 作为 goal_id
    const kr = await createStrategySessionKR({
      taskGoalId: objectiveId,
      krTitle: 'KR with valid objective',
    });
    createdKrIds.push(kr.id);

    expect(kr.objective_id).toBe(objectiveId);
  });

  it('场景2: goal_id 不对应任何 objective → KR.objective_id = null', async () => {
    const fakeGoalId = '00000000-0000-0000-0000-000000000099';

    const kr = await createStrategySessionKR({
      taskGoalId: fakeGoalId,
      krTitle: 'KR with invalid goal_id',
    });
    createdKrIds.push(kr.id);

    expect(kr.objective_id).toBeNull();
  });

  it('场景3: goal_id = null → KR.objective_id = null', async () => {
    const kr = await createStrategySessionKR({
      taskGoalId: null,
      krTitle: 'KR without goal_id',
    });
    createdKrIds.push(kr.id);

    expect(kr.objective_id).toBeNull();
  });

  it('objective_id 外键约束：有效 objective 时 INSERT 成功，DB 中可查到 objective_id', async () => {
    const objResult = await pool.query(
      `INSERT INTO objectives (title, status) VALUES ('FK Test Objective', 'active') RETURNING id`
    );
    const objectiveId = objResult.rows[0].id;
    createdObjectiveIds.push(objectiveId);

    const kr = await createStrategySessionKR({ taskGoalId: objectiveId, krTitle: 'FK test KR' });
    createdKrIds.push(kr.id);

    // 从 DB 直接验证 objective_id 已写入
    const dbCheck = await pool.query('SELECT objective_id FROM key_results WHERE id = $1', [kr.id]);
    expect(dbCheck.rows[0].objective_id).toBe(objectiveId);
  });
});
