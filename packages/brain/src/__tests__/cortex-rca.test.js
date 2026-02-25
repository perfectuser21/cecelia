/**
 * Cortex RCA Processing Tests
 *
 * Tests the Brain's internal Cortex task processing (requires_cortex=true).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import pool from '../db.js';
import { processCortexTask } from '../tick.js';

describe('Cortex RCA Task Processing', () => {
  beforeAll(async () => {
    // Clear test data
    await pool.query("DELETE FROM cecelia_events WHERE event_type = 'cortex_rca_complete'");
    await pool.query("DELETE FROM tasks WHERE title LIKE 'Test Cortex%'");
  });

  afterAll(async () => {
    // Clean up test data
    await pool.query("DELETE FROM cecelia_events WHERE event_type = 'cortex_rca_complete'");
    await pool.query("DELETE FROM tasks WHERE title LIKE 'Test Cortex%'");
  });

  beforeEach(() => {
    // Reset mocks before each test
    vi.restoreAllMocks();
  });

  it('should process Cortex task with requires_cortex=true', async () => {
    // Create test task
    const insertResult = await pool.query(`
      INSERT INTO tasks (title, description, task_type, priority, status, payload)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [
      'Test Cortex RCA Task',
      'Test RCA analysis for alertness emergency',
      'research',
      'P1',
      'queued',
      JSON.stringify({
        requires_cortex: true,
        trigger: 'alertness_emergency',
        signals: {
          active_tasks: 10,
          failed_tasks: 3,
          cpu_load: 0.85
        }
      })
    ]);

    const task = insertResult.rows[0];
    const actions = [];

    // Mock performRCA to avoid actual API call
    const mockPerformRCA = vi.fn(async () => ({
      task_id: task.id,
      analysis: {
        root_cause: 'High concurrent task load causing resource exhaustion',
        contributing_factors: ['Failed task retries', 'CPU pressure'],
        impact_assessment: 'System performance degraded'
      },
      recommended_actions: [
        { type: 'pause_p2_tasks', params: {} },
        { type: 'increase_task_timeout', params: { new_timeout: 120 } }
      ],
      learnings: ['Resource limits should be more conservative'],
      confidence: 0.85
    }));

    vi.doMock('../cortex.js', () => ({
      performRCA: mockPerformRCA
    }));

    // Execute processCortexTask
    const result = await processCortexTask(task, actions);

    // Verify dispatch result
    expect(result.dispatched).toBe(true);
    expect(result.reason).toBe('cortex_processed');
    expect(result.task_id).toBe(task.id);

    // Verify actions recorded
    expect(actions).toHaveLength(2);
    expect(actions[0].action).toBe('cortex-start');
    expect(actions[1].action).toBe('cortex-complete');
    expect(actions[1].confidence).toBe(0.85);
    expect(actions[1].learnings_count).toBe(1);

    // Verify task status updated to completed
    const updatedTask = await pool.query('SELECT status, payload FROM tasks WHERE id = $1', [task.id]);
    expect(updatedTask.rows[0].status).toBe('completed');

    const taskPayload = updatedTask.rows[0].payload;
    expect(taskPayload.rca_result.root_cause).toBe('High concurrent task load causing resource exhaustion');
    expect(taskPayload.rca_result.confidence).toBe(0.85);

    // Verify cecelia_events contains RCA result
    const events = await pool.query(`
      SELECT payload FROM cecelia_events
      WHERE event_type = 'cortex_rca_complete' AND payload->>'task_id' = $1
    `, [task.id.toString()]);

    expect(events.rows.length).toBeGreaterThan(0);
    const eventPayload = events.rows[0].payload;
    expect(eventPayload.analysis.root_cause).toBe('High concurrent task load causing resource exhaustion');
    expect(eventPayload.analysis.contributing_factors).toEqual(['Failed task retries', 'CPU pressure']);
    expect(eventPayload.recommended_actions).toBeDefined();
    expect(eventPayload.learnings).toEqual(['Resource limits should be more conservative']);
  });

  it('should handle Cortex task failure gracefully', async () => {
    // Create test task
    const insertResult = await pool.query(`
      INSERT INTO tasks (title, description, task_type, priority, status, payload)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [
      'Test Cortex Failure Task',
      'Test RCA failure handling',
      'research',
      'P1',
      'queued',
      JSON.stringify({
        requires_cortex: true,
        trigger: 'test_failure',
        signals: {}
      })
    ]);

    const task = insertResult.rows[0];
    const actions = [];

    // Mock performRCA to throw error
    const mockPerformRCA = vi.fn(async () => {
      throw new Error('Opus API error: 429 rate limit');
    });

    vi.doMock('../cortex.js', () => ({
      performRCA: mockPerformRCA
    }));

    // Execute processCortexTask
    const result = await processCortexTask(task, actions);

    // Verify dispatch result indicates failure
    expect(result.dispatched).toBe(false);
    expect(result.reason).toBe('cortex_error');
    expect(result.error).toContain('Opus API error');

    // Verify actions recorded
    expect(actions).toHaveLength(2);
    expect(actions[0].action).toBe('cortex-start');
    expect(actions[1].action).toBe('cortex-failed');
    expect(actions[1].error).toContain('Opus API error');

    // Verify task status updated to failed
    const updatedTask = await pool.query('SELECT status, payload FROM tasks WHERE id = $1', [task.id]);
    expect(updatedTask.rows[0].status).toBe('failed');

    const taskPayload = updatedTask.rows[0].payload;
    expect(taskPayload.rca_error.error).toContain('Opus API error');
  });

  it('should verify analysis result structure', async () => {
    // Create test task
    const insertResult = await pool.query(`
      INSERT INTO tasks (title, description, task_type, priority, status, payload)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [
      'Test Cortex Analysis Structure',
      'Verify complete analysis structure',
      'research',
      'P1',
      'queued',
      JSON.stringify({
        requires_cortex: true,
        trigger: 'alertness_emergency',
        signals: { test: true }
      })
    ]);

    const task = insertResult.rows[0];
    const actions = [];

    // Mock complete RCA result
    const mockPerformRCA = vi.fn(async () => ({
      task_id: task.id,
      analysis: {
        root_cause: 'Test root cause',
        contributing_factors: ['Factor 1', 'Factor 2'],
        impact_assessment: 'Test impact'
      },
      recommended_actions: [
        { type: 'test_action', params: { test: true } }
      ],
      learnings: ['Learning 1', 'Learning 2'],
      confidence: 0.9
    }));

    vi.doMock('../cortex.js', () => ({
      performRCA: mockPerformRCA
    }));

    await processCortexTask(task, actions);

    // Verify cecelia_events has complete structure
    const events = await pool.query(`
      SELECT payload FROM cecelia_events
      WHERE event_type = 'cortex_rca_complete' AND payload->>'task_id' = $1
    `, [task.id.toString()]);

    const payload = events.rows[0].payload;

    // Verify required fields
    expect(payload.analysis).toBeDefined();
    expect(payload.analysis.root_cause).toBe('Test root cause');
    expect(payload.analysis.contributing_factors).toEqual(['Factor 1', 'Factor 2']);
    expect(payload.recommended_actions).toBeDefined();
    expect(payload.recommended_actions[0].type).toBe('test_action');
    expect(payload.learnings).toEqual(['Learning 1', 'Learning 2']);
    expect(payload.confidence).toBe(0.9);
    expect(payload.completed_at).toBeDefined();
  });
});
