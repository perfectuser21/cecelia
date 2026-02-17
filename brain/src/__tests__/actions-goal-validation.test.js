/**
 * Actions - goal_id Validation Tests
 * Tests for goal_id requirement enforcement in createTask()
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import pool from '../db.js';
import { createTask } from '../actions.js';

describe('createTask - goal_id validation', () => {
  let testGoalId;

  beforeEach(async () => {
    // Create a test goal for valid tasks
    const goalResult = await pool.query(`
      INSERT INTO goals (title, description, status, priority, type)
      VALUES ('Test Goal', 'Test goal for validation tests', 'pending', 'P1', 'kr')
      RETURNING id
    `);
    testGoalId = goalResult.rows[0].id;
  });

  afterEach(async () => {
    // Clean up test data
    await pool.query(`DELETE FROM tasks WHERE title LIKE 'Test Task%'`);
    await pool.query(`DELETE FROM goals WHERE title = 'Test Goal'`);
  });

  describe('goal_id required validation', () => {
    it('should throw error when goal_id is missing for dev task', async () => {
      await expect(
        createTask({
          title: 'Test Task - Dev',
          description: 'Test task without goal_id',
          priority: 'P1',
          task_type: 'dev',
          trigger_source: 'okr_tick'
        })
      ).rejects.toThrow('goal_id is required');
    });

    it('should throw error when goal_id is missing for review task', async () => {
      await expect(
        createTask({
          title: 'Test Task - Review',
          description: 'Test task without goal_id',
          priority: 'P1',
          task_type: 'review',
          trigger_source: 'brain_auto'
        })
      ).rejects.toThrow('goal_id is required');
    });

    it('should throw error when goal_id is missing for talk task', async () => {
      await expect(
        createTask({
          title: 'Test Task - Talk',
          description: 'Test task without goal_id',
          priority: 'P1',
          task_type: 'talk',
          trigger_source: 'okr_tick'
        })
      ).rejects.toThrow('goal_id is required');
    });

    it('should accept task when goal_id is provided', async () => {
      const result = await createTask({
        title: 'Test Task - Valid',
        description: 'Test task with goal_id',
        priority: 'P1',
        task_type: 'dev',
        goal_id: testGoalId,
        trigger_source: 'okr_tick'
      });

      expect(result.success).toBe(true);
      expect(result.task.goal_id).toBe(testGoalId);
    });
  });

  describe('system task exemptions', () => {
    it('should allow exploratory task without goal_id', async () => {
      const result = await createTask({
        title: 'Test Task - Exploratory',
        description: 'Exploratory task',
        priority: 'P1',
        task_type: 'exploratory',
        trigger_source: 'brain_auto'
      });

      expect(result.success).toBe(true);
      expect(result.task.goal_id).toBeNull();
    });

    it('should allow research task without goal_id', async () => {
      const result = await createTask({
        title: 'Test Task - Research',
        description: 'Research task',
        priority: 'P1',
        task_type: 'research',
        trigger_source: 'brain_auto'
      });

      expect(result.success).toBe(true);
      expect(result.task.goal_id).toBeNull();
    });

    it('should allow manual trigger without goal_id', async () => {
      const result = await createTask({
        title: 'Test Task - Manual',
        description: 'Manual trigger task',
        priority: 'P1',
        task_type: 'dev',
        trigger_source: 'manual'
      });

      expect(result.success).toBe(true);
      expect(result.task.goal_id).toBeNull();
    });

    it('should allow test trigger without goal_id', async () => {
      const result = await createTask({
        title: 'Test Task - Test Trigger',
        description: 'Test trigger task',
        priority: 'P1',
        task_type: 'dev',
        trigger_source: 'test'
      });

      expect(result.success).toBe(true);
      expect(result.task.goal_id).toBeNull();
    });

    it('should allow watchdog trigger without goal_id', async () => {
      const result = await createTask({
        title: 'Test Task - Watchdog',
        description: 'Watchdog task',
        priority: 'P1',
        task_type: 'dev',
        trigger_source: 'watchdog'
      });

      expect(result.success).toBe(true);
      expect(result.task.goal_id).toBeNull();
    });

    it('should allow circuit_breaker trigger without goal_id', async () => {
      const result = await createTask({
        title: 'Test Task - Circuit Breaker',
        description: 'Circuit breaker task',
        priority: 'P1',
        task_type: 'dev',
        trigger_source: 'circuit_breaker'
      });

      expect(result.success).toBe(true);
      expect(result.task.goal_id).toBeNull();
    });
  });

  describe('okr_tick flow validation', () => {
    it('should require goal_id for okr_tick triggered dev task', async () => {
      await expect(
        createTask({
          title: 'Test Task - OKR Dev',
          description: 'OKR triggered dev task',
          priority: 'P0',
          task_type: 'dev',
          trigger_source: 'okr_tick'
        })
      ).rejects.toThrow('goal_id is required');
    });

    it('should accept okr_tick task with goal_id', async () => {
      const result = await createTask({
        title: 'Test Task - OKR Valid',
        description: 'OKR triggered task with goal_id',
        priority: 'P0',
        task_type: 'dev',
        goal_id: testGoalId,
        trigger_source: 'okr_tick',
        payload: {
          decomposition: 'true',
          kr_id: testGoalId,
          kr_goal: 'Test goal'
        }
      });

      expect(result.success).toBe(true);
      expect(result.task.goal_id).toBe(testGoalId);
      expect(result.task.trigger_source).toBe('okr_tick');
    });
  });

  describe('error message quality', () => {
    it('should include task_type and trigger_source in error message', async () => {
      try {
        await createTask({
          title: 'Test Task - Error Message',
          description: 'Test error message quality',
          priority: 'P1',
          task_type: 'qa',
          trigger_source: 'brain_auto'
        });
        expect.fail('Should have thrown error');
      } catch (err) {
        expect(err.message).toContain('task_type="qa"');
        expect(err.message).toContain('trigger_source="brain_auto"');
      }
    });
  });
});
