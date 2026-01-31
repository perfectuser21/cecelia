/**
 * Planner Agent Tests
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'cecelia_tasks',
  user: process.env.DB_USER || 'n8n_user',
  password: process.env.DB_PASSWORD || 'n8n_password_2025'
});

let testObjectiveIds = [];
let testKRIds = [];
let testProjectIds = [];
let testTaskIds = [];
let testLinkIds = [];

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
    if (testLinkIds.length > 0) {
      await pool.query('DELETE FROM project_kr_links WHERE id = ANY($1)', [testLinkIds]);
      testLinkIds = [];
    }
    if (testTaskIds.length > 0) {
      await pool.query('DELETE FROM tasks WHERE id = ANY($1)', [testTaskIds]);
      testTaskIds = [];
    }
    if (testProjectIds.length > 0) {
      await pool.query('DELETE FROM projects WHERE id = ANY($1)', [testProjectIds]);
      testProjectIds = [];
    }
    if (testKRIds.length > 0) {
      await pool.query('DELETE FROM goals WHERE id = ANY($1)', [testKRIds]);
      testKRIds = [];
    }
    if (testObjectiveIds.length > 0) {
      await pool.query('DELETE FROM goals WHERE id = ANY($1)', [testObjectiveIds]);
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
      // Create a project without repo_path
      const projResult = await pool.query(
        "INSERT INTO projects (name, status) VALUES ('no-repo-project', 'active') RETURNING id"
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

      expect(result.level).toBe('objective');
      expect(result.created.goals).toHaveLength(3); // 1 O + 2 KRs
      expect(result.created.goals[0].type).toBe('objective');
      expect(result.created.goals[1].type).toBe('key_result');

      // Cleanup
      for (const g of result.created.goals) {
        if (g.type === 'key_result') testKRIds.push(g.id);
        else testObjectiveIds.push(g.id);
      }
    });

    it('should create project with KR links', async () => {
      // Create a KR first
      const krResult = await pool.query(
        "INSERT INTO goals (title, type, priority, status, progress) VALUES ('Test KR', 'key_result', 'P1', 'pending', 0) RETURNING id"
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

      // Verify link was created
      const linkCheck = await pool.query(
        'SELECT * FROM project_kr_links WHERE project_id = $1 AND kr_id = $2',
        [result.created.projects[0].id, krResult.rows[0].id]
      );
      expect(linkCheck.rows).toHaveLength(1);
      testLinkIds.push(linkCheck.rows[0].id);
    });

    it('should create task linked to project with repo_path', async () => {
      // Create a project with repo_path
      const projResult = await pool.query(
        "INSERT INTO projects (name, repo_path, status) VALUES ('test-proj', '/tmp/test', 'active') RETURNING id"
      );
      testProjectIds.push(projResult.rows[0].id);

      const { handlePlanInput } = await import('../planner.js');
      const result = await handlePlanInput({
        task: {
          title: 'Test Task',
          project_id: projResult.rows[0].id,
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

      expect(result.level).toBe('objective');
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
        "INSERT INTO goals (title, type, priority, status, progress) VALUES ('Link KR', 'key_result', 'P1', 'pending', 0) RETURNING id"
      );
      testKRIds.push(krResult.rows[0].id);

      // First insert should succeed
      const link1 = await pool.query(
        'INSERT INTO project_kr_links (project_id, kr_id) VALUES ($1, $2) RETURNING id',
        [projResult.rows[0].id, krResult.rows[0].id]
      );
      testLinkIds.push(link1.rows[0].id);

      // Duplicate should fail (ON CONFLICT DO NOTHING in production code)
      await expect(pool.query(
        'INSERT INTO project_kr_links (project_id, kr_id) VALUES ($1, $2)',
        [projResult.rows[0].id, krResult.rows[0].id]
      )).rejects.toThrow();
    });
  });
});
