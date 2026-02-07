/**
 * Tests for P1 FIX #3: Quarantine auto-release with TTL
 *
 * Before fix: No automatic release mechanism, quarantined tasks stayed forever
 * After fix: Tasks have TTL and are auto-released when expired
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import pool from '../db.js';
import { quarantineTask, checkExpiredQuarantineTasks } from '../quarantine.js';

describe('quarantine-auto-release (P1 Fix #3)', () => {
  let testTaskId;

  beforeEach(async () => {
    const result = await pool.query(`
      INSERT INTO tasks (title, status)
      VALUES ('test-auto-release', 'queued')
      RETURNING id
    `);
    testTaskId = result.rows[0].id;
  });

  afterEach(async () => {
    await pool.query('DELETE FROM tasks WHERE title LIKE $1', ['test-auto-release%']);
  });

  it('should add TTL and release_at when quarantining task', async () => {
    const result = await quarantineTask(testTaskId, 'repeated_failure', { count: 3 });

    expect(result.success).toBe(true);
    expect(result.quarantine_info.ttl_ms).toBeGreaterThan(0);
    expect(result.quarantine_info.release_at).toBeDefined();

    // Check database
    const task = await pool.query('SELECT payload FROM tasks WHERE id = $1', [testTaskId]);
    const quarantineInfo = task.rows[0].payload.quarantine_info;

    expect(quarantineInfo.ttl_ms).toBeDefined();
    expect(quarantineInfo.release_at).toBeDefined();
    expect(new Date(quarantineInfo.release_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('should use different TTL for different reasons', async () => {
    // repeated_failure should have 24h TTL (PRD requirement)
    const result1 = await quarantineTask(testTaskId, 'repeated_failure');
    expect(result1.quarantine_info.ttl_ms).toBe(24 * 60 * 60 * 1000);

    // Create another task for resource_hog (should be 1h)
    const task2 = await pool.query(`
      INSERT INTO tasks (title, status) VALUES ('test-auto-release-2', 'queued') RETURNING id
    `);
    const result2 = await quarantineTask(task2.rows[0].id, 'resource_hog');
    expect(result2.quarantine_info.ttl_ms).toBe(1 * 60 * 60 * 1000);

    // Cleanup
    await pool.query('DELETE FROM tasks WHERE id = $1', [task2.rows[0].id]);
  });

  it('should NOT release tasks before TTL expires', async () => {
    await quarantineTask(testTaskId, 'repeated_failure');

    const released = await checkExpiredQuarantineTasks();
    expect(released).toEqual([]);

    // Task should still be quarantined
    const task = await pool.query('SELECT status FROM tasks WHERE id = $1', [testTaskId]);
    expect(task.rows[0].status).toBe('quarantined');
  });

  it('should auto-release tasks after TTL expires', async () => {
    // Quarantine task with past release_at (simulate expired TTL)
    await pool.query(`
      UPDATE tasks
      SET status = 'quarantined',
          payload = $1::jsonb
      WHERE id = $2
    `, [JSON.stringify({
      quarantine_info: {
        quarantined_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
        reason: 'repeated_failure',
        ttl_ms: 24 * 60 * 60 * 1000,  // 24h TTL
        release_at: new Date(Date.now() - 1000).toISOString(),  // expired 1 second ago
      }
    }), testTaskId]);

    const released = await checkExpiredQuarantineTasks();

    expect(released.length).toBe(1);
    expect(released[0].task_id).toBe(testTaskId);

    // Task should be back to queued
    const task = await pool.query('SELECT status FROM tasks WHERE id = $1', [testTaskId]);
    expect(task.rows[0].status).toBe('queued');
  });

  it('should handle multiple expired tasks', async () => {
    // Create 3 expired quarantined tasks
    for (let i = 0; i < 3; i++) {
      const task = await pool.query(`
        INSERT INTO tasks (title, status, payload)
        VALUES ($1, 'quarantined', $2::jsonb)
        RETURNING id
      `, [
        `test-auto-release-multi-${i}`,
        JSON.stringify({
          quarantine_info: {
            quarantined_at: new Date(Date.now() - 1000).toISOString(),
            reason: 'timeout_pattern',
            ttl_ms: 500,  // 0.5 sec
            release_at: new Date(Date.now() - 100).toISOString(),  // expired
          }
        })
      ]);
    }

    const released = await checkExpiredQuarantineTasks();
    expect(released.length).toBeGreaterThanOrEqual(3);

    // Cleanup
    await pool.query('DELETE FROM tasks WHERE title LIKE $1', ['test-auto-release-multi%']);
  });
});
