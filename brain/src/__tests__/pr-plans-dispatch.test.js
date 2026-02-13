/**
 * PR Plans Dispatch Tests
 * Tests for PR Plans (Layer 2) dispatch and dependency handling
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import pool from '../db.js';
import {
  getPrPlansByInitiative,
  isPrPlanCompleted,
  updatePrPlanStatus,
  canExecutePrPlan,
  getNextPrPlan,
  checkPrPlansCompletion
} from '../planner.js';

describe('PR Plans Dispatch', () => {
  let testProject, testPrPlan1, testPrPlan2, testPrPlan3;

  beforeEach(async () => {
    // Create test project (Project = Initiative after migration 027)
    const projectResult = await pool.query(`
      INSERT INTO projects (name, repo_path, status)
      VALUES ('test-repo', '/test/repo', 'active')
      RETURNING *
    `);
    testProject = projectResult.rows[0];

    // Create PR Plan 1 (no dependencies)
    const prPlan1Result = await pool.query(`
      INSERT INTO pr_plans (
        project_id, title, dod, files, sequence, depends_on, complexity, status
      ) VALUES ($1, 'PR Plan 1', 'DoD for PR 1', '{}', 1, '{}', 'medium', 'planning')
      RETURNING *
    `, [testProject.id]);
    testPrPlan1 = prPlan1Result.rows[0];

    // Create PR Plan 2 (depends on PR Plan 1)
    const prPlan2Result = await pool.query(`
      INSERT INTO pr_plans (
        project_id, title, dod, files, sequence, depends_on, complexity, status
      ) VALUES ($1, 'PR Plan 2', 'DoD for PR 2', '{}', 2, $2, 'medium', 'planning')
      RETURNING *
    `, [testProject.id, `{"${testPrPlan1.id}"}`]);
    testPrPlan2 = prPlan2Result.rows[0];

    // Create PR Plan 3 (depends on PR Plan 2)
    const prPlan3Result = await pool.query(`
      INSERT INTO pr_plans (
        project_id, title, dod, files, sequence, depends_on, complexity, status
      ) VALUES ($1, 'PR Plan 3', 'DoD for PR 3', '{}', 3, $2, 'medium', 'planning')
      RETURNING *
    `, [testProject.id, `{"${testPrPlan2.id}"}`]);
    testPrPlan3 = prPlan3Result.rows[0];
  });

  afterEach(async () => {
    // Clean up test data in correct order (tasks → pr_plans → projects)
    // First delete any tasks that reference pr_plans
    if (testPrPlan1 || testPrPlan2 || testPrPlan3) {
      await pool.query('DELETE FROM tasks WHERE pr_plan_id IN ($1, $2, $3)', [
        testPrPlan1?.id || null,
        testPrPlan2?.id || null,
        testPrPlan3?.id || null
      ]);
    }

    // Delete pr_plans manually (project deletion won't cascade)
    if (testPrPlan1) await pool.query('DELETE FROM pr_plans WHERE id = $1', [testPrPlan1.id]);
    if (testPrPlan2) await pool.query('DELETE FROM pr_plans WHERE id = $1', [testPrPlan2.id]);
    if (testPrPlan3) await pool.query('DELETE FROM pr_plans WHERE id = $1', [testPrPlan3.id]);

    // Delete project
    if (testProject) {
      await pool.query('DELETE FROM projects WHERE id = $1', [testProject.id]);
    }
  });

  describe('getPrPlansByInitiative', () => {
    it('should return all PR Plans for an Initiative sorted by sequence', async () => {
      const prPlans = await getPrPlansByInitiative(testProject.id);

      expect(prPlans).toHaveLength(3);
      expect(prPlans[0].sequence).toBe(1);
      expect(prPlans[1].sequence).toBe(2);
      expect(prPlans[2].sequence).toBe(3);
      expect(prPlans[0].title).toBe('PR Plan 1');
    });

    it('should return empty array for Initiative with no PR Plans', async () => {
      const randomId = '00000000-0000-0000-0000-000000000000';
      const prPlans = await getPrPlansByInitiative(randomId);

      expect(prPlans).toHaveLength(0);
    });
  });

  describe('isPrPlanCompleted', () => {
    it('should return false when PR Plan has no tasks', async () => {
      const isCompleted = await isPrPlanCompleted(testPrPlan1.id);
      expect(isCompleted).toBe(false);
    });

    it('should return false when PR Plan has incomplete tasks', async () => {
      // Create a task for PR Plan 1 (not completed)
      await pool.query(`
        INSERT INTO tasks (title, project_id, pr_plan_id, status)
        VALUES ('Test Task 1', $1, $2, 'in_progress')
      `, [testProject.id, testPrPlan1.id]);

      const isCompleted = await isPrPlanCompleted(testPrPlan1.id);
      expect(isCompleted).toBe(false);
    });

    it('should return true when all tasks are completed', async () => {
      // Create tasks for PR Plan 1 (all completed)
      await pool.query(`
        INSERT INTO tasks (title, project_id, pr_plan_id, status)
        VALUES
          ('Test Task 1', $1, $2, 'completed'),
          ('Test Task 2', $1, $2, 'completed')
      `, [testProject.id, testPrPlan1.id]);

      const isCompleted = await isPrPlanCompleted(testPrPlan1.id);
      expect(isCompleted).toBe(true);
    });
  });

  describe('updatePrPlanStatus', () => {
    it('should update PR Plan status successfully', async () => {
      await updatePrPlanStatus(testPrPlan1.id, 'in_progress');

      const result = await pool.query('SELECT status FROM pr_plans WHERE id = $1', [testPrPlan1.id]);
      expect(result.rows[0].status).toBe('in_progress');
    });

    it('should update PR Plan status to completed', async () => {
      await updatePrPlanStatus(testPrPlan1.id, 'completed');

      const result = await pool.query('SELECT status FROM pr_plans WHERE id = $1', [testPrPlan1.id]);
      expect(result.rows[0].status).toBe('completed');
    });
  });

  describe('canExecutePrPlan', () => {
    it('should return true for PR Plan with no dependencies', async () => {
      const allPrPlans = [testPrPlan1, testPrPlan2, testPrPlan3];
      const canExecute = canExecutePrPlan(testPrPlan1, allPrPlans);

      expect(canExecute).toBe(true);
    });

    it('should return false when dependencies are not completed', async () => {
      const allPrPlans = [testPrPlan1, testPrPlan2, testPrPlan3];
      const canExecute = canExecutePrPlan(testPrPlan2, allPrPlans);

      expect(canExecute).toBe(false); // PR Plan 1 is still pending
    });

    it('should return true when all dependencies are completed', async () => {
      // Mark PR Plan 1 as completed
      await pool.query('UPDATE pr_plans SET status = $1 WHERE id = $2', ['completed', testPrPlan1.id]);

      // Refresh PR Plan 1 status
      const refreshResult = await pool.query('SELECT * FROM pr_plans WHERE id = $1', [testPrPlan1.id]);
      testPrPlan1 = refreshResult.rows[0];

      const allPrPlans = [testPrPlan1, testPrPlan2, testPrPlan3];
      const canExecute = canExecutePrPlan(testPrPlan2, allPrPlans);

      expect(canExecute).toBe(true); // PR Plan 1 is completed
    });
  });

  describe('getNextPrPlan', () => {
    it('should return first PR Plan with no dependencies', async () => {
      const nextPrPlan = await getNextPrPlan(testProject.id);

      expect(nextPrPlan).not.toBeNull();
      expect(nextPrPlan.id).toBe(testPrPlan1.id);
      expect(nextPrPlan.sequence).toBe(1);
    });

    it('should return null when no pending PR Plans exist', async () => {
      // Mark all PR Plans as completed
      await pool.query('UPDATE pr_plans SET status = $1 WHERE project_id = $2',
        ['completed', testProject.id]);

      const nextPrPlan = await getNextPrPlan(testProject.id);
      expect(nextPrPlan).toBeNull();
    });

    it('should return second PR Plan after first is completed', async () => {
      // Complete PR Plan 1
      await pool.query('UPDATE pr_plans SET status = $1 WHERE id = $2', ['completed', testPrPlan1.id]);

      const nextPrPlan = await getNextPrPlan(testProject.id);

      expect(nextPrPlan).not.toBeNull();
      expect(nextPrPlan.id).toBe(testPrPlan2.id);
      expect(nextPrPlan.sequence).toBe(2);
    });

    it('should return null when pending PR Plans are blocked by dependencies', async () => {
      // Only PR Plan 2 and 3 are pending, but both depend on others
      await pool.query('UPDATE pr_plans SET status = $1 WHERE id = $2', ['in_progress', testPrPlan1.id]);

      const nextPrPlan = await getNextPrPlan(testProject.id);
      expect(nextPrPlan).toBeNull(); // PR Plan 1 in_progress, not completed
    });
  });

  describe('checkPrPlansCompletion', () => {
    it('should auto-complete PR Plans with all tasks done', async () => {
      // Set PR Plan 1 to in_progress
      await pool.query('UPDATE pr_plans SET status = $1 WHERE id = $2', ['in_progress', testPrPlan1.id]);

      // Add completed tasks to PR Plan 1
      await pool.query(`
        INSERT INTO tasks (title, project_id, pr_plan_id, status)
        VALUES ('Task 1', $1, $2, 'completed')
      `, [testProject.id, testPrPlan1.id]);

      const completed = await checkPrPlansCompletion();

      expect(completed).toContain(testPrPlan1.id);

      // Verify status was updated
      const result = await pool.query('SELECT status FROM pr_plans WHERE id = $1', [testPrPlan1.id]);
      expect(result.rows[0].status).toBe('completed');
    });

    it('should not complete PR Plans with incomplete tasks', async () => {
      // Set PR Plan 1 to in_progress
      await pool.query('UPDATE pr_plans SET status = $1 WHERE id = $2', ['in_progress', testPrPlan1.id]);

      // Add incomplete task to PR Plan 1
      await pool.query(`
        INSERT INTO tasks (title, project_id, pr_plan_id, status)
        VALUES ('Task 1', $1, $2, 'in_progress')
      `, [testProject.id, testPrPlan1.id]);

      const completed = await checkPrPlansCompletion();

      expect(completed).not.toContain(testPrPlan1.id);

      // Verify status was NOT updated
      const result = await pool.query('SELECT status FROM pr_plans WHERE id = $1', [testPrPlan1.id]);
      expect(result.rows[0].status).toBe('in_progress');
    });

    it('should return empty array when no in_progress PR Plans exist', async () => {
      const completed = await checkPrPlansCompletion();
      expect(completed).toHaveLength(0);
    });
  });
});
