/**
 * Planner Agent Tests
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../db-config.js';

const { Pool } = pg;

const pool = new Pool(DB_DEFAULTS);

let testObjectiveIds = [];
let testKRIds = [];
let testProjectIds = [];
let testTaskIds = [];
let testLinks = [];

describe('Planner Agent', () => {
  beforeAll(async () => {
    const result = await pool.query('SELECT 1');
    expect(result.rows[0]['?column?']).toBe(1);
  });

  afterAll(async () => {
    await pool.end();
  });

  afterEach(async () => {
    // Cleanup test data
    testLinks = [];
    if (testTaskIds.length > 0) {
      await pool.query('DELETE FROM tasks WHERE id = ANY($1)', [testTaskIds]);
      testTaskIds = [];
    }
    if (testProjectIds.length > 0) {
      await pool.query('DELETE FROM tasks WHERE project_id = ANY($1)', [testProjectIds]).catch(() => {});
      // 新表 okr_projects（新代码写这里）
      await pool.query('DELETE FROM okr_projects WHERE id = ANY($1)', [testProjectIds]).catch(() => {});
      await pool.query('DELETE FROM projects WHERE id = ANY($1)', [testProjectIds]).catch(() => {});
      testProjectIds = [];
    }
    if (testKRIds.length > 0) {
      // 新代码写 key_results，旧测试写 goals，两边都清理
      await pool.query('DELETE FROM key_results WHERE id = ANY($1)', [testKRIds]).catch(() => {});
      await pool.query('DELETE FROM goals WHERE id = ANY($1)', [testKRIds]).catch(() => {});
      testKRIds = [];
    }
    if (testObjectiveIds.length > 0) {
      // 新代码写 visions/objectives，旧测试写 goals，两边都清理
      await pool.query('DELETE FROM objectives WHERE id = ANY($1)', [testObjectiveIds]).catch(() => {});
      await pool.query('DELETE FROM visions WHERE id = ANY($1)', [testObjectiveIds]).catch(() => {});
      await pool.query('DELETE FROM goals WHERE id = ANY($1)', [testObjectiveIds]).catch(() => {});
      testObjectiveIds = [];
    }
  });

  describe('selectTargetKR', () => {
    it('should return null when no KRs exist', async () => {
      const { selectTargetKR } = await import('../planner.js');
      const result = selectTargetKR({
        keyResults: [],
        activeTasks: [],
        focus: null
      });
      expect(result).toBeNull();
    });

    it('should prefer P0 KR over P1', async () => {
      const { selectTargetKR } = await import('../planner.js');
      const state = {
        keyResults: [
          { id: 'kr-p1', priority: 'P1', progress: 0 },
          { id: 'kr-p0', priority: 'P0', progress: 0 }
        ],
        activeTasks: [],
        focus: null
      };
      const result = selectTargetKR(state);
      expect(result.id).toBe('kr-p0');
    });

    it('should prefer focus-linked KR', async () => {
      const { selectTargetKR } = await import('../planner.js');
      const kr1 = { id: 'kr-1', priority: 'P1', progress: 0 };
      const kr2 = { id: 'kr-2', priority: 'P0', progress: 0 };
      const state = {
        keyResults: [kr1, kr2],
        activeTasks: [],
        focus: {
          focus: {
            key_results: [{ id: 'kr-1' }]
          }
        }
      };
      const result = selectTargetKR(state);
      expect(result.id).toBe('kr-1'); // focus boost > priority
    });
  });

  describe('planNextTask', () => {
    it('should return valid planning result', async () => {
      const { planNextTask } = await import('../planner.js');
      const result = await planNextTask();
      expect(result).toHaveProperty('planned');
      if (result.planned) {
        expect(result).toHaveProperty('task');
        expect(result).toHaveProperty('kr');
        expect(result).toHaveProperty('project');
      } else {
        expect(result).toHaveProperty('reason');
        expect(['no_active_kr', 'no_project_for_kr', 'needs_planning']).toContain(result.reason);
      }
    });
  });

  describe('handlePlanInput - hard constraints', () => {
    it('should reject project without repo_path', async () => {
      const { handlePlanInput } = await import('../planner.js');
      await expect(handlePlanInput({
        project: { title: 'Test Project' }
      })).rejects.toThrow('Hard constraint: Project must have repo_path');
    });

    it('should reject task without project_id', async () => {
      const { handlePlanInput } = await import('../planner.js');
      await expect(handlePlanInput({
        task: { title: 'Test Task' }
      })).rejects.toThrow('Hard constraint: Task must have project_id');
    });

    it('should reject task whose project has no repo_path', async () => {
      // Create project in okr_projects with no repo_path in metadata
      const projResult = await pool.query(
        "INSERT INTO okr_projects (title, status) VALUES ('no-repo-project', 'active') RETURNING id"
      );
      testProjectIds.push(projResult.rows[0].id);

      const { handlePlanInput } = await import('../planner.js');
      await expect(handlePlanInput({
        task: { title: 'Test Task', project_id: projResult.rows[0].id }
      })).rejects.toThrow('Hard constraint');
    });

    it('should reject invalid input', async () => {
      const { handlePlanInput } = await import('../planner.js');
      await expect(handlePlanInput({})).rejects.toThrow('Input must contain one of');
    });

    it('should create objective with KRs', async () => {
      const { handlePlanInput } = await import('../planner.js');
      const result = await handlePlanInput({
        objective: {
          title: 'Test Objective',
          priority: 'P1',
          key_results: [
            { title: 'KR 1', weight: 0.5 },
            { title: 'KR 2', weight: 0.5 }
          ]
        }
      });

      expect(result.level).toBe('mission');
      expect(result.created.goals).toHaveLength(3); // 1 vision + 2 objectives
      // visions don't have type column directly, but metadata has type='mission'
      expect(result.created.goals[0].title).toBeTruthy();
      expect(result.created.goals[1].title).toBeTruthy();

      // Cleanup: created goals are in visions/objectives tables
      for (const g of result.created.goals) {
        testObjectiveIds.push(g.id);
      }
    });

    it('should create project with KR links', async () => {
      // Create a KR in key_results table (not goals — FK constraint)
      const krResult = await pool.query(
        "INSERT INTO key_results (title, priority, status, progress) VALUES ('Test KR', 'P1', 'pending', 0) RETURNING id"
      );
      testKRIds.push(krResult.rows[0].id);

      const { handlePlanInput } = await import('../planner.js');
      const result = await handlePlanInput({
        project: {
          title: 'Test Project',
          repo_path: '/tmp/test-repo',
          kr_ids: [krResult.rows[0].id]
        }
      });

      expect(result.level).toBe('project');
      expect(result.created.projects).toHaveLength(1);
      expect(result.created.projects[0].repo_path).toBe('/tmp/test-repo');
      testProjectIds.push(result.created.projects[0].id);

      // Verify kr_id was linked on okr_projects
      const linkCheck = await pool.query(
        'SELECT kr_id FROM okr_projects WHERE id = $1',
        [result.created.projects[0].id]
      );
      expect(linkCheck.rows).toHaveLength(1);
      expect(linkCheck.rows[0].kr_id).toBe(krResult.rows[0].id);
    });

    it('should create task linked to project with repo_path', async () => {
      // Insert into okr_projects with metadata containing repo_path
      const projResult = await pool.query(
        `INSERT INTO okr_projects (title, status, metadata) VALUES ('test-proj', 'active', '{"repo_path":"/tmp/test"}') RETURNING id`
      );
      const projectId = projResult.rows[0].id;
      testProjectIds.push(projectId);
      const { handlePlanInput } = await import('../planner.js');
      const result = await handlePlanInput({
        task: {
          title: 'Test Task',
          project_id: projectId,
          priority: 'P0'
        }
      });

      expect(result.level).toBe('task');
      expect(result.created.tasks).toHaveLength(1);
      expect(result.created.tasks[0].status).toBe('queued');
      expect(result.created.tasks[0].priority).toBe('P0');
      testTaskIds.push(result.created.tasks[0].id);
    });

    it('should support dry_run mode', async () => {
      const { handlePlanInput } = await import('../planner.js');
      const result = await handlePlanInput({
        objective: { title: 'Dry Run Objective', priority: 'P2' }
      }, true);

      expect(result.level).toBe('mission');
      expect(result.created.goals).toHaveLength(0); // Nothing created
    });
  });

  describe('getPlanStatus', () => {
    it('should return status structure', async () => {
      const { getPlanStatus } = await import('../planner.js');
      const status = await getPlanStatus();

      expect(status).toHaveProperty('target_kr');
      expect(status).toHaveProperty('target_project');
      expect(status).toHaveProperty('queued_tasks');
      expect(status).toHaveProperty('last_completed');
    });
  });

  describe('okr_projects kr_id FK', () => {
    it('should enforce FK constraint on okr_projects.kr_id', async () => {
      const fakeKrId = '00000000-0000-0000-0000-000000000999';

      // Should fail: kr_id doesn't exist in key_results
      await expect(pool.query(
        'INSERT INTO okr_projects (title, status, kr_id) VALUES ($1, $2, $3)',
        ['fk-test-proj', 'active', fakeKrId]
      )).rejects.toThrow();

      // Should succeed with valid kr_id
      const krResult = await pool.query(
        "INSERT INTO key_results (title, priority, status) VALUES ('FK Test KR', 'P1', 'pending') RETURNING id"
      );
      testKRIds.push(krResult.rows[0].id);

      const projResult = await pool.query(
        'INSERT INTO okr_projects (title, status, kr_id) VALUES ($1, $2, $3) RETURNING id',
        ['fk-test-proj-valid', 'active', krResult.rows[0].id]
      );
      testProjectIds.push(projResult.rows[0].id);
      expect(projResult.rows[0].id).toBeTruthy();
    });
  });

  describe('generateNextTask (V2: no auto-generation)', () => {
    it('should return null when no queued tasks exist for KR+Project', async () => {
      const { generateNextTask } = await import('../planner.js');

      const projResult = await pool.query(
        "INSERT INTO okr_projects (title, status) VALUES ('empty-test', 'active') RETURNING id"
      );
      testProjectIds.push(projResult.rows[0].id);

      const krResult = await pool.query(
        "INSERT INTO key_results (title, priority, status) VALUES ('Empty KR', 'P0', 'pending') RETURNING *"
      );
      testKRIds.push(krResult.rows[0].id);

      const result = await generateNextTask(
        krResult.rows[0],
        { id: projResult.rows[0].id },
        { recentCompleted: [] }
      );
      expect(result).toBeNull();
    });

    it('should return existing queued task', async () => {
      const { generateNextTask } = await import('../planner.js');

      const projResult = await pool.query(
        "INSERT INTO okr_projects (title, status) VALUES ('queued-test', 'active') RETURNING id"
      );
      testProjectIds.push(projResult.rows[0].id);

      const krResult = await pool.query(
        "INSERT INTO key_results (title, priority, status) VALUES ('Queued KR', 'P0', 'pending') RETURNING *"
      );
      testKRIds.push(krResult.rows[0].id);

      const tResult = await pool.query(
        "INSERT INTO tasks (title, priority, project_id, goal_id, status) VALUES ('Existing Task', 'P0', $1, $2, 'queued') RETURNING id",
        [projResult.rows[0].id, krResult.rows[0].id]
      );
      testTaskIds.push(tResult.rows[0].id);

      const result = await generateNextTask(
        krResult.rows[0],
        { id: projResult.rows[0].id },
        { recentCompleted: [] }
      );
      expect(result).not.toBeNull();
      expect(result.title).toBe('Existing Task');
    });
  });

  describe('scoreKRs', () => {
    it('should return scored and sorted KRs', async () => {
      const { scoreKRs } = await import('../planner.js');
      const state = {
        keyResults: [
          { id: 'kr-p1', priority: 'P1', progress: 0 },
          { id: 'kr-p0', priority: 'P0', progress: 0 }
        ],
        activeTasks: [],
        focus: null
      };
      const scored = scoreKRs(state);
      expect(scored).toHaveLength(2);
      expect(scored[0].kr.id).toBe('kr-p0');
      expect(scored[0].score).toBeGreaterThan(scored[1].score);
    });
  });

  describe('planNextTask KR rotation', () => {
    it('rotates to next KR when top has no queued tasks', async () => {
      const { planNextTask } = await import('../planner.js');

      // KR1: no queued tasks（直接写入 key_results，planner 从 key_results 查询）
      const kr1Result = await pool.query(
        "INSERT INTO key_results (title, priority, status) VALUES ('Empty KR', 'P0', 'pending') RETURNING id"
      );
      testKRIds.push(kr1Result.rows[0].id);

      // KR2: has a queued task
      const kr2Result = await pool.query(
        "INSERT INTO key_results (title, priority, status) VALUES ('Active KR', 'P1', 'pending') RETURNING id"
      );
      testKRIds.push(kr2Result.rows[0].id);

      // 每个 KR 对应独立的 okr_project（通过 kr_id 绑定）
      const proj1Result = await pool.query(
        "INSERT INTO okr_projects (title, status, kr_id) VALUES ('rotation-test-kr1', 'active', $1) RETURNING id",
        [kr1Result.rows[0].id]
      );
      testProjectIds.push(proj1Result.rows[0].id);

      const proj2Result = await pool.query(
        "INSERT INTO okr_projects (title, status, kr_id) VALUES ('rotation-test-kr2', 'active', $1) RETURNING id",
        [kr2Result.rows[0].id]
      );
      testProjectIds.push(proj2Result.rows[0].id);

      // Add a queued task only for KR2 (project_id = proj2, goal_id = kr2)
      const tResult = await pool.query(
        "INSERT INTO tasks (title, priority, project_id, goal_id, status) VALUES ('KR2 Task', 'P0', $1, $2, 'queued') RETURNING id",
        [proj2Result.rows[0].id, kr2Result.rows[0].id]
      );
      testTaskIds.push(tResult.rows[0].id);

      const result = await planNextTask([kr1Result.rows[0].id, kr2Result.rows[0].id]);

      expect(result.planned).toBe(true);
      expect(result.kr.id).toBe(kr2Result.rows[0].id);
      expect(result.task.title).toBe('KR2 Task');
    });

    it('returns needs_planning when no KRs have queued tasks', async () => {
      const { planNextTask } = await import('../planner.js');

      // 直接写入 key_results（planner 从 key_results 查询 KR）
      const krResult = await pool.query(
        "INSERT INTO key_results (title, status, priority) VALUES ('Solo Empty KR', 'active', 'P0') RETURNING id"
      );
      testKRIds.push(krResult.rows[0].id);

      // 直接写入 okr_projects 并设置 kr_id（planner 通过 okr_projects WHERE kr_id 查项目链接）
      const projResult = await pool.query(
        "INSERT INTO okr_projects (title, status, kr_id) VALUES ('empty-plan-test', 'active', $1) RETURNING id",
        [krResult.rows[0].id]
      );
      testProjectIds.push(projResult.rows[0].id);

      const result = await planNextTask([krResult.rows[0].id]);

      expect(result.planned).toBe(false);
      expect(result.reason).toBe('needs_planning');
    });
  });
});
