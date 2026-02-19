/**
 * Planner Learning Penalty Tests
 *
 * DoD 覆盖：
 * - DoD 1: buildLearningPenaltyMap 函数存在，接受 projectId，返回 Map
 * - DoD 2: 当无 learnings 时，任务评分不变
 * - DoD 3: 同 task_type 失败 2+ 次后，对应任务被惩罚 -20 分
 * - DoD 4: generateNextTask 中失败 task_type 排序靠后
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../db-config.js';

const { Pool } = pg;
const pool = new Pool(DB_DEFAULTS);

let testProjectIds = [];
let testKRIds = [];
let testTaskIds = [];
let testLearningIds = [];
let testObjectiveIds = [];
let testLinks = [];

describe('Planner Learning Penalty', () => {
  beforeAll(async () => {
    const result = await pool.query('SELECT 1');
    expect(result.rows[0]['?column?']).toBe(1);

    // Verify learnings table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables WHERE table_name = 'learnings'
      )
    `);
    expect(tableCheck.rows[0].exists).toBe(true);
  });

  afterAll(async () => {
    await pool.end();
  });

  afterEach(async () => {
    // Cleanup in dependency order
    if (testLearningIds.length > 0) {
      await pool.query('DELETE FROM learnings WHERE id = ANY($1)', [testLearningIds]).catch(() => {});
      testLearningIds = [];
    }
    for (const link of testLinks) {
      await pool.query('DELETE FROM project_kr_links WHERE project_id = $1 AND kr_id = $2', [link.project_id, link.kr_id]).catch(() => {});
    }
    testLinks = [];
    if (testTaskIds.length > 0) {
      await pool.query('DELETE FROM tasks WHERE id = ANY($1)', [testTaskIds]).catch(() => {});
      testTaskIds = [];
    }
    if (testProjectIds.length > 0) {
      await pool.query('DELETE FROM tasks WHERE project_id = ANY($1)', [testProjectIds]).catch(() => {});
      await pool.query('DELETE FROM projects WHERE id = ANY($1)', [testProjectIds]).catch(() => {});
      testProjectIds = [];
    }
    if (testKRIds.length > 0) {
      await pool.query('DELETE FROM goals WHERE id = ANY($1)', [testKRIds]).catch(() => {});
      testKRIds = [];
    }
    if (testObjectiveIds.length > 0) {
      await pool.query('DELETE FROM goals WHERE id = ANY($1)', [testObjectiveIds]).catch(() => {});
      testObjectiveIds = [];
    }
  });

  // Helper: create a test project
  async function createTestProject(name) {
    const result = await pool.query(
      "INSERT INTO projects (name, repo_path, status) VALUES ($1, '/tmp/penalty-test', 'active') RETURNING id",
      [name]
    );
    testProjectIds.push(result.rows[0].id);
    return result.rows[0].id;
  }

  // Helper: insert a learning record with specific task_type
  async function insertLearning(projectId, taskType, taskId = null, daysAgo = 0) {
    const createdAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
    const result = await pool.query(`
      INSERT INTO learnings (title, category, trigger_event, content, metadata, created_at)
      VALUES ($1, 'failure_pattern', 'systemic_failure', 'test failure', $2, $3)
      RETURNING id
    `, [
      `Test Failure - ${taskType}`,
      JSON.stringify({
        task_type: taskType,
        project_id: projectId,
        task_id: taskId,
      }),
      createdAt,
    ]);
    testLearningIds.push(result.rows[0].id);
    return result.rows[0].id;
  }

  describe('DoD 1: buildLearningPenaltyMap 函数存在且返回 Map', () => {
    it('should return an empty Map when no learnings exist for project', async () => {
      const { buildLearningPenaltyMap } = await import('../planner.js');
      const projectId = await createTestProject('no-learnings-proj');

      const penaltyMap = await buildLearningPenaltyMap(projectId);

      expect(penaltyMap).toBeInstanceOf(Map);
      expect(penaltyMap.size).toBe(0);
    });

    it('should accept projectId parameter and return a Map', async () => {
      const { buildLearningPenaltyMap } = await import('../planner.js');
      const projectId = await createTestProject('map-type-test-proj');

      const result = await buildLearningPenaltyMap(projectId);
      expect(result).toBeInstanceOf(Map);
    });
  });

  describe('DoD 2: 无 learnings 时任务评分不变', () => {
    it('should not penalize tasks when no failure learnings exist', async () => {
      const { buildLearningPenaltyMap, LEARNING_PENALTY_SCORE } = await import('../planner.js');
      const projectId = await createTestProject('no-penalty-proj');

      const penaltyMap = await buildLearningPenaltyMap(projectId);

      // No penalty applied
      expect(penaltyMap.get('dev')).toBeUndefined();
      expect(penaltyMap.get('review')).toBeUndefined();
      expect(penaltyMap.size).toBe(0);
    });

    it('should not penalize when only 1 failure (below threshold)', async () => {
      const { buildLearningPenaltyMap } = await import('../planner.js');
      const projectId = await createTestProject('below-threshold-proj');

      // Only 1 failure — below LEARNING_FAILURE_THRESHOLD (2)
      await insertLearning(projectId, 'dev');

      const penaltyMap = await buildLearningPenaltyMap(projectId);
      expect(penaltyMap.get('dev')).toBeUndefined();
      expect(penaltyMap.size).toBe(0);
    });

    it('should not penalize learnings older than LEARNING_LOOKBACK_DAYS', async () => {
      const { buildLearningPenaltyMap, LEARNING_LOOKBACK_DAYS } = await import('../planner.js');
      const projectId = await createTestProject('old-learning-proj');

      // Insert 2 learnings older than the lookback window
      await insertLearning(projectId, 'dev', null, LEARNING_LOOKBACK_DAYS + 1);
      await insertLearning(projectId, 'dev', null, LEARNING_LOOKBACK_DAYS + 2);

      const penaltyMap = await buildLearningPenaltyMap(projectId);
      expect(penaltyMap.get('dev')).toBeUndefined();
      expect(penaltyMap.size).toBe(0);
    });
  });

  describe('DoD 3: 失败 >= 2 次的任务类型打 -20 分惩罚', () => {
    it('should penalize task_type with 2+ failures in lookback window', async () => {
      const { buildLearningPenaltyMap, LEARNING_PENALTY_SCORE } = await import('../planner.js');
      const projectId = await createTestProject('penalty-proj');

      // Insert 2 failures for 'dev' task_type
      await insertLearning(projectId, 'dev');
      await insertLearning(projectId, 'dev');

      const penaltyMap = await buildLearningPenaltyMap(projectId);

      expect(penaltyMap.get('dev')).toBe(LEARNING_PENALTY_SCORE);
      expect(LEARNING_PENALTY_SCORE).toBe(-20);
    });

    it('should penalize with exactly LEARNING_PENALTY_SCORE (-20)', async () => {
      const { buildLearningPenaltyMap, LEARNING_PENALTY_SCORE } = await import('../planner.js');
      const projectId = await createTestProject('exact-penalty-proj');

      // 3 failures — still gets same penalty
      await insertLearning(projectId, 'review');
      await insertLearning(projectId, 'review');
      await insertLearning(projectId, 'review');

      const penaltyMap = await buildLearningPenaltyMap(projectId);
      expect(penaltyMap.get('review')).toBe(LEARNING_PENALTY_SCORE);
      expect(penaltyMap.get('review')).toBe(-20);
    });

    it('should penalize multiple task_types independently', async () => {
      const { buildLearningPenaltyMap, LEARNING_PENALTY_SCORE } = await import('../planner.js');
      const projectId = await createTestProject('multi-type-penalty-proj');

      // 2 failures for 'dev', 2 failures for 'research'
      await insertLearning(projectId, 'dev');
      await insertLearning(projectId, 'dev');
      await insertLearning(projectId, 'research');
      await insertLearning(projectId, 'research');

      const penaltyMap = await buildLearningPenaltyMap(projectId);
      expect(penaltyMap.get('dev')).toBe(LEARNING_PENALTY_SCORE);
      expect(penaltyMap.get('research')).toBe(LEARNING_PENALTY_SCORE);
      expect(penaltyMap.size).toBe(2);
    });

    it('should not cross-contaminate between projects', async () => {
      const { buildLearningPenaltyMap } = await import('../planner.js');
      const projectA = await createTestProject('proj-a-penalty');
      const projectB = await createTestProject('proj-b-no-penalty');

      // Only project A has failures
      await insertLearning(projectA, 'dev');
      await insertLearning(projectA, 'dev');

      const penaltyMapA = await buildLearningPenaltyMap(projectA);
      const penaltyMapB = await buildLearningPenaltyMap(projectB);

      expect(penaltyMapA.get('dev')).toBe(-20);
      expect(penaltyMapB.size).toBe(0);  // project B not affected
    });
  });

  describe('DoD 4: generateNextTask 中失败 task_type 排序靠后', () => {
    it('should deprioritize tasks with penalized task_type', async () => {
      const { generateNextTask } = await import('../planner.js');

      // Create project and KR
      const projResult = await pool.query(
        "INSERT INTO projects (name, repo_path, status) VALUES ('learning-penalty-dispatch-test', '/tmp/lp-test', 'active') RETURNING id"
      );
      const projectId = projResult.rows[0].id;
      testProjectIds.push(projectId);

      const krResult = await pool.query(
        "INSERT INTO goals (title, type, priority, status, progress) VALUES ('LP Test KR', 'kr', 'P1', 'pending', 0) RETURNING *"
      );
      const kr = krResult.rows[0];
      testKRIds.push(kr.id);

      // Task A: task_type='dev' (will be penalized)
      const taskA = await pool.query(
        "INSERT INTO tasks (title, priority, project_id, goal_id, status, task_type) VALUES ('Dev Task (penalized)', 'P1', $1, $2, 'queued', 'dev') RETURNING id",
        [projectId, kr.id]
      );
      testTaskIds.push(taskA.rows[0].id);

      // Task B: task_type='research' (no penalty, same priority)
      const taskB = await pool.query(
        "INSERT INTO tasks (title, priority, project_id, goal_id, status, task_type) VALUES ('Research Task (normal)', 'P1', $1, $2, 'queued', 'research') RETURNING id",
        [projectId, kr.id]
      );
      testTaskIds.push(taskB.rows[0].id);

      // Insert 2 failures for 'dev' task_type to trigger penalty
      await insertLearning(projectId, 'dev');
      await insertLearning(projectId, 'dev');

      // generateNextTask should prefer the non-penalized task
      const selected = await generateNextTask(kr, { id: projectId }, { recentCompleted: [] });

      expect(selected).not.toBeNull();
      expect(selected.title).toBe('Research Task (normal)');
    });

    it('should return penalized task when it is the only task', async () => {
      const { generateNextTask } = await import('../planner.js');

      const projResult = await pool.query(
        "INSERT INTO projects (name, repo_path, status) VALUES ('only-penalized-test', '/tmp/op-test', 'active') RETURNING id"
      );
      const projectId = projResult.rows[0].id;
      testProjectIds.push(projectId);

      const krResult = await pool.query(
        "INSERT INTO goals (title, type, priority, status, progress) VALUES ('Only Penalized KR', 'kr', 'P1', 'pending', 0) RETURNING *"
      );
      const kr = krResult.rows[0];
      testKRIds.push(kr.id);

      // Only one task with penalized type
      const taskResult = await pool.query(
        "INSERT INTO tasks (title, priority, project_id, goal_id, status, task_type) VALUES ('Solo Dev Task', 'P1', $1, $2, 'queued', 'dev') RETURNING id",
        [projectId, kr.id]
      );
      testTaskIds.push(taskResult.rows[0].id);

      // Insert penalty learnings
      await insertLearning(projectId, 'dev');
      await insertLearning(projectId, 'dev');

      // Should still return the task (graceful degradation — can't return null if only option)
      const selected = await generateNextTask(kr, { id: projectId }, { recentCompleted: [] });

      expect(selected).not.toBeNull();
      expect(selected.title).toBe('Solo Dev Task');
    });

    it('should not affect ordering when no penalties exist', async () => {
      const { generateNextTask } = await import('../planner.js');

      const projResult = await pool.query(
        "INSERT INTO projects (name, repo_path, status) VALUES ('no-penalty-order-test', '/tmp/npo-test', 'active') RETURNING id"
      );
      const projectId = projResult.rows[0].id;
      testProjectIds.push(projectId);

      const krResult = await pool.query(
        "INSERT INTO goals (title, type, priority, status, progress) VALUES ('No Penalty KR', 'kr', 'P1', 'pending', 0) RETURNING *"
      );
      const kr = krResult.rows[0];
      testKRIds.push(kr.id);

      // P0 task (should come first even without penalty effects)
      const taskP0 = await pool.query(
        "INSERT INTO tasks (title, priority, project_id, goal_id, status, task_type) VALUES ('P0 Dev Task', 'P0', $1, $2, 'queued', 'dev') RETURNING id",
        [projectId, kr.id]
      );
      testTaskIds.push(taskP0.rows[0].id);

      // P1 task
      const taskP1 = await pool.query(
        "INSERT INTO tasks (title, priority, project_id, goal_id, status, task_type) VALUES ('P1 Dev Task', 'P1', $1, $2, 'queued', 'dev') RETURNING id",
        [projectId, kr.id]
      );
      testTaskIds.push(taskP1.rows[0].id);

      // No learnings — no penalties
      const selected = await generateNextTask(kr, { id: projectId }, { recentCompleted: [] });

      expect(selected).not.toBeNull();
      expect(selected.title).toBe('P0 Dev Task');
    });
  });
});
