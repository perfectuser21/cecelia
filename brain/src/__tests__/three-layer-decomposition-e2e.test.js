/**
 * Three-Layer Decomposition E2E Tests
 * Tests the complete flow: Objective → KR → Initiative → PR Plans → Tasks
 *
 * This validates the integration of:
 * - PR #1: PR Plans API
 * - PR #2: OKR Integration in Engine
 * - PR #3: Brain PR Plans Dispatch
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import pool from '../db.js';
import {
  getPrPlansByInitiative,
  isPrPlanCompleted,
  canExecutePrPlan,
  getNextPrPlan,
  checkPrPlansCompletion,
  planNextTask
} from '../planner.js';

describe('Three-Layer Decomposition E2E', () => {
  let testObjective, testKR, testProject, testInitiativeA, testInitiativeB;
  let prPlan1, prPlan2, prPlan3, prPlanB1;

  beforeEach(async () => {
    // Create Objective (goals with parent_id=NULL)
    const objectiveResult = await pool.query(`
      INSERT INTO goals (title, description, status)
      VALUES ('Q1 2026 Product Launch', 'Launch new product features', 'in_progress')
      RETURNING *
    `);
    testObjective = objectiveResult.rows[0];

    // Create KR (goals with parent_id=Objective)
    const krResult = await pool.query(`
      INSERT INTO goals (title, description, status, parent_id, priority)
      VALUES (
        'Implement core features',
        'Complete 3 major features',
        'in_progress',
        $1,
        'P0'
      )
      RETURNING *
    `, [testObjective.id]);
    testKR = krResult.rows[0];

    // Create Project
    const projectResult = await pool.query(`
      INSERT INTO projects (name, repo_path, status)
      VALUES ('cecelia-core', '/home/xx/perfect21/cecelia/core', 'active')
      RETURNING *
    `);
    testProject = projectResult.rows[0];

    // Create Initiative A (Sub-Project, linked to KR)
    // After migration 027: Initiative = Sub-Project (parent_id=Project, repo_path=NULL)
    const initiativeAResult = await pool.query(`
      INSERT INTO projects (name, description, status, parent_id, kr_id)
      VALUES (
        'User Authentication System',
        'Complete auth system with OAuth',
        'planning',
        $1,
        $2
      )
      RETURNING *
    `, [testProject.id, testKR.id]);
    testInitiativeA = initiativeAResult.rows[0];

    // Create Initiative B (Sub-Project)
    const initiativeBResult = await pool.query(`
      INSERT INTO projects (name, description, status, parent_id, kr_id)
      VALUES (
        'Dashboard Analytics',
        'Real-time analytics dashboard',
        'planning',
        $1,
        $2
      )
      RETURNING *
    `, [testProject.id, testKR.id]);
    testInitiativeB = initiativeBResult.rows[0];

    // Create PR Plan 1 for Initiative A (no dependencies)
    const prPlan1Result = await pool.query(`
      INSERT INTO pr_plans (
        project_id, title, dod, files, sequence, depends_on, complexity, status
      ) VALUES ($1, 'Basic Auth API', 'Implement login/logout endpoints', '{}', 1, '{}', 'medium', 'planning')
      RETURNING *
    `, [testInitiativeA.id]);
    prPlan1 = prPlan1Result.rows[0];

    // Create PR Plan 2 for Initiative A (depends on PR Plan 1)
    const prPlan2Result = await pool.query(`
      INSERT INTO pr_plans (
        project_id, title, dod, files, sequence, depends_on, complexity, status
      ) VALUES ($1, 'OAuth Integration', 'Add Google/GitHub OAuth', '{}', 2, $2, 'large', 'planning')
      RETURNING *
    `, [testInitiativeA.id, `{"${prPlan1.id}"}`]);
    prPlan2 = prPlan2Result.rows[0];

    // Create PR Plan 3 for Initiative A (depends on PR Plan 2)
    const prPlan3Result = await pool.query(`
      INSERT INTO pr_plans (
        project_id, title, dod, files, sequence, depends_on, complexity, status
      ) VALUES ($1, 'Session Management', 'JWT tokens and refresh', '{}', 3, $2, 'medium', 'planning')
      RETURNING *
    `, [testInitiativeA.id, `{"${prPlan2.id}"}`]);
    prPlan3 = prPlan3Result.rows[0];

    // Create PR Plan for Initiative B (independent)
    const prPlanB1Result = await pool.query(`
      INSERT INTO pr_plans (
        project_id, title, dod, files, sequence, depends_on, complexity, status
      ) VALUES ($1, 'Chart Components', 'Build reusable chart library', '{}', 1, '{}', 'small', 'planning')
      RETURNING *
    `, [testInitiativeB.id]);
    prPlanB1 = prPlanB1Result.rows[0];
  });

  afterEach(async () => {
    // Clean up in correct order to avoid FK violations
    // tasks → pr_plans → sub-projects (initiatives) → projects → goals
    if (prPlan1 || prPlan2 || prPlan3 || prPlanB1) {
      await pool.query('DELETE FROM tasks WHERE pr_plan_id IN ($1, $2, $3, $4)', [
        prPlan1?.id || null,
        prPlan2?.id || null,
        prPlan3?.id || null,
        prPlanB1?.id || null
      ]);
    }

    // Delete pr_plans manually
    if (prPlan1) await pool.query('DELETE FROM pr_plans WHERE id = $1', [prPlan1.id]);
    if (prPlan2) await pool.query('DELETE FROM pr_plans WHERE id = $1', [prPlan2.id]);
    if (prPlan3) await pool.query('DELETE FROM pr_plans WHERE id = $1', [prPlan3.id]);
    if (prPlanB1) await pool.query('DELETE FROM pr_plans WHERE id = $1', [prPlanB1.id]);

    // Delete sub-projects (initiatives) - must delete before parent project
    if (testInitiativeA || testInitiativeB) {
      await pool.query('DELETE FROM projects WHERE id IN ($1, $2)', [
        testInitiativeA?.id || null,
        testInitiativeB?.id || null
      ]);
    }

    if (testKR || testObjective) {
      await pool.query('DELETE FROM goals WHERE id IN ($1, $2)', [
        testKR?.id || null,
        testObjective?.id || null
      ]);
    }

    if (testProject) {
      await pool.query('DELETE FROM projects WHERE id = $1', [testProject.id]);
    }
  });

  describe('Scenario 1: Full Flow - Objective to Task', () => {
    it('should dispatch tasks following the complete 3-layer hierarchy', async () => {
      // Step 1: planNextTask should identify PR Plan 1 needs a task
      const plan1 = await planNextTask();

      expect(plan1).toBeDefined();
      expect(plan1.planned).toBe(false);
      expect(plan1.reason).toBe('pr_plan_needs_task');
      expect(plan1.pr_plan).toBeDefined();
      expect(plan1.pr_plan.id).toBe(prPlan1.id);
      expect(plan1.initiative.id).toBe(testInitiativeA.id);

      // Step 2: Create a task for PR Plan 1 (simulating 秋米's job)
      const task1Result = await pool.query(`
        INSERT INTO tasks (title, project_id, pr_plan_id, goal_id, status, task_type)
        VALUES ('Implement login endpoint', $1, $2, $3, 'queued', 'dev')
        RETURNING *
      `, [testInitiativeA.id, prPlan1.id, testKR.id]);
      const task1 = task1Result.rows[0];

      expect(task1.pr_plan_id).toBe(prPlan1.id);
      expect(task1.project_id).toBe(testInitiativeA.id);

      // Step 3: planNextTask should now return the created task
      const plan1WithTask = await planNextTask();
      expect(plan1WithTask.planned).toBe(true);
      expect(plan1WithTask.source).toBe('pr_plan');
      expect(plan1WithTask.pr_plan.id).toBe(prPlan1.id);
      expect(plan1WithTask.task.id).toBe(task1.id);

      // Step 4: Complete the task
      await pool.query('UPDATE tasks SET status = $1 WHERE id = $2', ['completed', task1.id]);

      // Step 5: Mark PR Plan 1 as in_progress to test auto-completion
      await pool.query('UPDATE pr_plans SET status = $1 WHERE id = $2', ['in_progress', prPlan1.id]);

      // Step 6: Auto-completion check should complete PR Plan 1
      const completedIds = await checkPrPlansCompletion();
      expect(completedIds).toContain(prPlan1.id);

      // Verify PR Plan 1 is now completed
      const prPlan1Updated = await pool.query('SELECT status FROM pr_plans WHERE id = $1', [prPlan1.id]);
      expect(prPlan1Updated.rows[0].status).toBe('completed');

      // Step 7: planNextTask should now identify PR Plan 2 (dependency satisfied)
      const plan2 = await planNextTask();
      expect(plan2).toBeDefined();
      expect(plan2.pr_plan).toBeDefined();
      expect(plan2.pr_plan.id).toBe(prPlan2.id);
    });

    it('should complete all PR Plans in sequence following dependencies', async () => {
      // Complete PR Plan 1
      await pool.query('UPDATE pr_plans SET status = $1 WHERE id = $2', ['completed', prPlan1.id]);

      // PR Plan 2 should now be available
      const nextPlan = await getNextPrPlan(testInitiativeA.id);
      expect(nextPlan).not.toBeNull();
      expect(nextPlan.id).toBe(prPlan2.id);

      // Complete PR Plan 2
      await pool.query('UPDATE pr_plans SET status = $1 WHERE id = $2', ['completed', prPlan2.id]);

      // PR Plan 3 should now be available
      const nextPlan2 = await getNextPrPlan(testInitiativeA.id);
      expect(nextPlan2).not.toBeNull();
      expect(nextPlan2.id).toBe(prPlan3.id);

      // Complete PR Plan 3
      await pool.query('UPDATE pr_plans SET status = $1 WHERE id = $2', ['completed', prPlan3.id]);

      // No more PR Plans
      const nextPlan3 = await getNextPrPlan(testInitiativeA.id);
      expect(nextPlan3).toBeNull();
    });
  });

  describe('Scenario 2: Dependency Blocking', () => {
    it('should block PR Plan 2 when PR Plan 1 is not completed', async () => {
      // PR Plan 1 is still in planning state
      const nextPlan = await getNextPrPlan(testInitiativeA.id);

      // Should return PR Plan 1 (no dependencies)
      expect(nextPlan).not.toBeNull();
      expect(nextPlan.id).toBe(prPlan1.id);

      // Mark PR Plan 1 as in_progress (not completed)
      await pool.query('UPDATE pr_plans SET status = $1 WHERE id = $2', ['in_progress', prPlan1.id]);

      // Now getNextPrPlan should return null (PR Plan 2 is blocked)
      const nextPlan2 = await getNextPrPlan(testInitiativeA.id);
      expect(nextPlan2).toBeNull();
    });

    it('should unblock PR Plan 2 when PR Plan 1 is completed', async () => {
      // Complete PR Plan 1
      await pool.query('UPDATE pr_plans SET status = $1 WHERE id = $2', ['completed', prPlan1.id]);

      // Now PR Plan 2 should be available
      const nextPlan = await getNextPrPlan(testInitiativeA.id);
      expect(nextPlan).not.toBeNull();
      expect(nextPlan.id).toBe(prPlan2.id);

      // canExecutePrPlan should return true for PR Plan 2
      const allPrPlans = await getPrPlansByInitiative(testInitiativeA.id);
      const refreshedPrPlan2 = allPrPlans.find(p => p.id === prPlan2.id);
      const canExecute = canExecutePrPlan(refreshedPrPlan2, allPrPlans);
      expect(canExecute).toBe(true);
    });

    it('should respect the full dependency chain', async () => {
      // Initially, only PR Plan 1 is available
      const plan1 = await getNextPrPlan(testInitiativeA.id);
      expect(plan1.id).toBe(prPlan1.id);

      // Complete PR Plan 1 → PR Plan 2 available
      await pool.query('UPDATE pr_plans SET status = $1 WHERE id = $2', ['completed', prPlan1.id]);
      const plan2 = await getNextPrPlan(testInitiativeA.id);
      expect(plan2.id).toBe(prPlan2.id);

      // PR Plan 3 still blocked
      const allPlans = await getPrPlansByInitiative(testInitiativeA.id);
      const plan3Obj = allPlans.find(p => p.id === prPlan3.id);
      expect(canExecutePrPlan(plan3Obj, allPlans)).toBe(false);

      // Complete PR Plan 2 → PR Plan 3 available
      await pool.query('UPDATE pr_plans SET status = $1 WHERE id = $2', ['completed', prPlan2.id]);
      const plan3 = await getNextPrPlan(testInitiativeA.id);
      expect(plan3.id).toBe(prPlan3.id);
    });
  });

  describe('Scenario 3: Multiple Initiatives', () => {
    it('should not mix PR Plans from different Initiatives', async () => {
      // Get PR Plans for Initiative A
      const prPlansA = await getPrPlansByInitiative(testInitiativeA.id);
      expect(prPlansA).toHaveLength(3);
      expect(prPlansA.every(p => p.project_id === testInitiativeA.id)).toBe(true);

      // Get PR Plans for Initiative B
      const prPlansB = await getPrPlansByInitiative(testInitiativeB.id);
      expect(prPlansB).toHaveLength(1);
      expect(prPlansB[0].project_id).toBe(testInitiativeB.id);

      // Verify isolation
      expect(prPlansA.some(p => p.id === prPlanB1.id)).toBe(false);
      expect(prPlansB.some(p => p.id === prPlan1.id)).toBe(false);
    });

    it('should dispatch tasks for different Initiatives independently', async () => {
      // planNextTask might return either Initiative A or B based on creation time
      const plan1 = await planNextTask();
      expect(plan1).toBeDefined();
      expect(plan1.initiative).toBeDefined();
      expect([testInitiativeA.id, testInitiativeB.id]).toContain(plan1.initiative.id);

      // If it selected Initiative A, PR Plan 1 should be selected
      if (plan1.initiative.id === testInitiativeA.id) {
        expect(plan1.pr_plan.id).toBe(prPlan1.id);
      }

      // If it selected Initiative B, PR Plan B1 should be selected
      if (plan1.initiative.id === testInitiativeB.id) {
        expect(plan1.pr_plan.id).toBe(prPlanB1.id);
      }
    });

    it('should handle completion of PR Plans from different Initiatives', async () => {
      // Mark PR Plans as in_progress and add tasks
      await pool.query('UPDATE pr_plans SET status = $1 WHERE id = $2', ['in_progress', prPlan1.id]);
      await pool.query('UPDATE pr_plans SET status = $1 WHERE id = $2', ['in_progress', prPlanB1.id]);

      // Add completed tasks for both initiatives
      await pool.query(`
        INSERT INTO tasks (title, project_id, pr_plan_id, status)
        VALUES
          ('Task A1', $1, $2, 'completed'),
          ('Task B1', $3, $4, 'completed')
      `, [testInitiativeA.id, prPlan1.id, testInitiativeB.id, prPlanB1.id]);

      // Auto-completion should handle both
      const completedIds = await checkPrPlansCompletion();
      expect(completedIds).toContain(prPlan1.id);
      expect(completedIds).toContain(prPlanB1.id);
    });
  });

  describe('Scenario 4: Tick Auto-Completion', () => {
    it('should auto-complete PR Plan when all tasks are done', async () => {
      // Set PR Plan 1 to in_progress
      await pool.query('UPDATE pr_plans SET status = $1 WHERE id = $2', ['in_progress', prPlan1.id]);

      // Add tasks (all completed)
      await pool.query(`
        INSERT INTO tasks (title, project_id, pr_plan_id, status)
        VALUES
          ('Task 1', $1, $2, 'completed'),
          ('Task 2', $1, $2, 'completed')
      `, [testInitiativeA.id, prPlan1.id]);

      // Run auto-completion
      const completedIds = await checkPrPlansCompletion();

      expect(completedIds).toHaveLength(1);
      expect(completedIds[0]).toBe(prPlan1.id);

      // Verify status updated
      const result = await pool.query('SELECT status FROM pr_plans WHERE id = $1', [prPlan1.id]);
      expect(result.rows[0].status).toBe('completed');
    });

    it('should not auto-complete when tasks are incomplete', async () => {
      // Set PR Plan 1 to in_progress
      await pool.query('UPDATE pr_plans SET status = $1 WHERE id = $2', ['in_progress', prPlan1.id]);

      // Add tasks (one incomplete)
      await pool.query(`
        INSERT INTO tasks (title, project_id, pr_plan_id, status)
        VALUES
          ('Task 1', $1, $2, 'completed'),
          ('Task 2', $1, $2, 'in_progress')
      `, [testInitiativeA.id, prPlan1.id]);

      // Run auto-completion
      const completedIds = await checkPrPlansCompletion();

      expect(completedIds).not.toContain(prPlan1.id);

      // Verify status unchanged
      const result = await pool.query('SELECT status FROM pr_plans WHERE id = $1', [prPlan1.id]);
      expect(result.rows[0].status).toBe('in_progress');
    });

    it('should handle multiple PR Plans in one auto-completion cycle', async () => {
      // Set multiple PR Plans to in_progress
      await pool.query('UPDATE pr_plans SET status = $1 WHERE id IN ($2, $3)',
        ['in_progress', prPlan1.id, prPlanB1.id]);

      // Add completed tasks for both initiatives
      await pool.query(`
        INSERT INTO tasks (title, project_id, pr_plan_id, status)
        VALUES
          ('Task A', $1, $2, 'completed'),
          ('Task B', $3, $4, 'completed')
      `, [testInitiativeA.id, prPlan1.id, testInitiativeB.id, prPlanB1.id]);

      // Run auto-completion
      const completedIds = await checkPrPlansCompletion();

      expect(completedIds).toHaveLength(2);
      expect(completedIds).toContain(prPlan1.id);
      expect(completedIds).toContain(prPlanB1.id);
    });
  });

  describe('Edge Cases', () => {
    it('should handle Initiative with no PR Plans', async () => {
      // Create Initiative (Sub-Project) without PR Plans
      const emptyInitResult = await pool.query(`
        INSERT INTO projects (name, description, status, parent_id, kr_id)
        VALUES ('Empty Initiative', 'No PR Plans yet', 'planning', $1, $2)
        RETURNING *
      `, [testProject.id, testKR.id]);
      const emptyInit = emptyInitResult.rows[0];

      const nextPlan = await getNextPrPlan(emptyInit.id);
      expect(nextPlan).toBeNull();

      // Clean up
      await pool.query('DELETE FROM projects WHERE id = $1', [emptyInit.id]);
    });

    it('should handle PR Plan with no tasks', async () => {
      // Set PR Plan to in_progress but don't create tasks
      await pool.query('UPDATE pr_plans SET status = $1 WHERE id = $2', ['in_progress', prPlan1.id]);

      const isCompleted = await isPrPlanCompleted(prPlan1.id);
      expect(isCompleted).toBe(false);

      // Auto-completion should not complete it
      const completedIds = await checkPrPlansCompletion();
      expect(completedIds).not.toContain(prPlan1.id);
    });

    it('should handle all PR Plans completed for an Initiative', async () => {
      // Complete all PR Plans for Initiative A
      await pool.query('UPDATE pr_plans SET status = $1 WHERE project_id = $2',
        ['completed', testInitiativeA.id]);

      const nextPlan = await getNextPrPlan(testInitiativeA.id);
      expect(nextPlan).toBeNull();

      // planNextTask should select Initiative B (or fallback to traditional KR dispatch)
      const plan = await planNextTask();
      expect(plan).toBeDefined();

      // Either returns Initiative B's PR Plan or falls back to traditional KR dispatch
      const isInitiativeB = plan.initiative && plan.initiative.id === testInitiativeB.id;
      const isFallback = plan.kr !== undefined;
      expect(isInitiativeB || isFallback).toBe(true);
    });
  });
});
