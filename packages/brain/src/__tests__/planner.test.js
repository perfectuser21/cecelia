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

    // Ensure project_kr_links table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables WHERE table_name = 'project_kr_links'
      )
    `);
    expect(tableCheck.rows[0].exists).toBe(true);
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
      // Create a project with type='project' so trigger syncs to okr_projects, but no repo_path in metadata
      const projResult = await pool.query(
        "INSERT INTO projects (name, type, status) VALUES ('no-repo-project', 'project', 'active') RETURNING id"
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
      // Insert with type='project' so trigger syncs to okr_projects with metadata containing repo_path
      const projResult = await pool.query(
        `INSERT INTO projects (name, type, repo_path, status, metadata) VALUES ('test-proj', 'project', '/tmp/test', 'active', '{"repo_path":"/tmp/test"}') RETURNING id`
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

  describe('project_kr_links table', () => {
    it('should enforce unique constraint on (project_id, kr_id)', async () => {
      const projResult = await pool.query(
        "INSERT INTO projects (name, repo_path, status) VALUES ('link-test', '/tmp/link', 'active') RETURNING id"
      );
      testProjectIds.push(projResult.rows[0].id);

      const krResult = await pool.query(
        "INSERT INTO goals (title, type, priority, status, progress) VALUES ('Link KR', 'area_okr', 'P1', 'pending', 0) RETURNING id"
      );
      testKRIds.push(krResult.rows[0].id);

      // First insert should succeed
      const link1 = await pool.query(
        'INSERT INTO project_kr_links (project_id, kr_id) VALUES ($1, $2) RETURNING project_id, kr_id',
        [projResult.rows[0].id, krResult.rows[0].id]
      );
      testLinks.push({ project_id: link1.rows[0].project_id, kr_id: link1.rows[0].kr_id });

      // Duplicate should fail (ON CONFLICT DO NOTHING in production code)
      await expect(pool.query(
        'INSERT INTO project_kr_links (project_id, kr_id) VALUES ($1, $2)',
        [projResult.rows[0].id, krResult.rows[0].id]
      )).rejects.toThrow();
    });
  });

  describe('generateNextTask (V2: no auto-generation)', () => {
    it('should return null when no queued tasks exist for KR+Project', async () => {
      const { generateNextTask } = await import('../planner.js');

      const projResult = await pool.query(
        "INSERT INTO projects (name, repo_path, status) VALUES ('empty-test', '/tmp/empty', 'active') RETURNING id"
      );
      testProjectIds.push(projResult.rows[0].id);

      const krResult = await pool.query(
        "INSERT INTO goals (title, type, priority, status, progress) VALUES ('Empty KR', 'area_okr', 'P0', 'pending', 0) RETURNING *"
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
        "INSERT INTO projects (name, repo_path, status) VALUES ('queued-test', '/tmp/queued', 'active') RETURNING id"
      );
      testProjectIds.push(projResult.rows[0].id);

      const krResult = await pool.query(
        "INSERT INTO goals (title, type, priority, status, progress) VALUES ('Queued KR', 'area_okr', 'P0', 'pending', 0) RETURNING *"
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

      // Create 2 KRs under one objective
      const objResult = await pool.query(
        "INSERT INTO goals (title, type, priority, status, progress) VALUES ('Rotation Test Obj', 'mission', 'P0', 'in_progress', 0) RETURNING id"
      );
      testObjectiveIds.push(objResult.rows[0].id);

      // KR1: no queued tasks（type='area_kr' → 同步到 key_results，planner 从 key_results 查询）
      const kr1Result = await pool.query(
        "INSERT INTO goals (title, type, priority, status, progress, parent_id) VALUES ('Empty KR', 'area_kr', 'P0', 'pending', 0, $1) RETURNING id",
        [objResult.rows[0].id]
      );
      testKRIds.push(kr1Result.rows[0].id);

      // KR2: has a queued task（type='area_kr' → 同步到 key_results）
      const kr2Result = await pool.query(
        "INSERT INTO goals (title, type, priority, status, progress, parent_id) VALUES ('Active KR', 'area_kr', 'P1', 'pending', 0, $1) RETURNING id",
        [objResult.rows[0].id]
      );
      testKRIds.push(kr2Result.rows[0].id);

      // Create project with repo_path + link both KRs
      const projResult = await pool.query(
        "INSERT INTO projects (name, repo_path, status) VALUES ('rotation-test', '/tmp/rotation-test', 'active') RETURNING id"
      );
      testProjectIds.push(projResult.rows[0].id);

      await pool.query(
        'INSERT INTO project_kr_links (project_id, kr_id) VALUES ($1, $2), ($1, $3) ON CONFLICT DO NOTHING',
        [projResult.rows[0].id, kr1Result.rows[0].id, kr2Result.rows[0].id]
      );
      testLinks.push({ project_id: projResult.rows[0].id, kr_id: kr1Result.rows[0].id });
      testLinks.push({ project_id: projResult.rows[0].id, kr_id: kr2Result.rows[0].id });

      // Add a queued task only for KR2
      const tResult = await pool.query(
        "INSERT INTO tasks (title, priority, project_id, goal_id, status) VALUES ('KR2 Task', 'P0', $1, $2, 'queued') RETURNING id",
        [projResult.rows[0].id, kr2Result.rows[0].id]
      );
      testTaskIds.push(tResult.rows[0].id);

      const result = await planNextTask([kr1Result.rows[0].id, kr2Result.rows[0].id]);

      expect(result.planned).toBe(true);
      expect(result.kr.id).toBe(kr2Result.rows[0].id);
      expect(result.task.title).toBe('KR2 Task');
    });

    it('returns needs_planning when no KRs have queued tasks', async () => {
      const { planNextTask } = await import('../planner.js');

      const objResult = await pool.query(
        "INSERT INTO goals (title, type, priority, status, progress) VALUES ('All Empty Obj', 'mission', 'P0', 'in_progress', 0) RETURNING id"
      );
      testObjectiveIds.push(objResult.rows[0].id);

      // type='area_kr' → 同步到 key_results（旧 'area_okr' 同步到 objectives，planner 不查 objectives）
      const krResult = await pool.query(
        "INSERT INTO goals (title, type, priority, status, progress, parent_id) VALUES ('Solo Empty KR', 'area_kr', 'P0', 'pending', 0, $1) RETURNING id",
        [objResult.rows[0].id]
      );
      testKRIds.push(krResult.rows[0].id);

      const projResult = await pool.query(
        "INSERT INTO projects (name, repo_path, status) VALUES ('empty-plan-test', '/tmp/empty-plan', 'active') RETURNING id"
      );
      testProjectIds.push(projResult.rows[0].id);

      await pool.query(
        'INSERT INTO project_kr_links (project_id, kr_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [projResult.rows[0].id, krResult.rows[0].id]
      );
      testLinks.push({ project_id: projResult.rows[0].id, kr_id: krResult.rows[0].id });

      const result = await planNextTask([krResult.rows[0].id]);

      expect(result.planned).toBe(false);
      expect(result.reason).toBe('needs_planning');
    });
  });
});
