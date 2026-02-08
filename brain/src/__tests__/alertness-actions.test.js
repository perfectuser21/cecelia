/**
 * Tests for Alertness Response Actions
 *
 * Verifies that alertness level changes trigger correct protective and recovery actions.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import pool from '../db.js';
import {
  executeResponseActions,
  notifyAlert,
  escalateToAnalysis,
  applyMitigation,
  activateShutdownSafety,
  recoverFromLevel,
  getMitigationState,
  _resetMitigationState,
} from '../alertness-actions.js';

describe('alertness-actions', () => {
  beforeEach(async () => {
    // Clean up test events
    await pool.query(`DELETE FROM cecelia_events WHERE source = 'alertness'`);
    // Clean up test tasks
    await pool.query(`DELETE FROM tasks WHERE title LIKE 'Alertness RCA%'`);
    // Reset mitigation state
    _resetMitigationState();
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM cecelia_events WHERE source = 'alertness'`);
    await pool.query(`DELETE FROM tasks WHERE title LIKE 'Alertness RCA%'`);
    _resetMitigationState();
  });

  describe('executeResponseActions', () => {
    it('should not execute actions if level unchanged', async () => {
      const result = await executeResponseActions(0, 0, {});
      expect(result.actions).toEqual([]);
      expect(result.reason).toBe('no_change');
    });

    it('should execute notification on NORMAL → ALERT', async () => {
      const result = await executeResponseActions(0, 1, { resource_pressure: 0.3 });

      expect(result.actions).toContain('notification');
      expect(result.from_level).toBe(0);
      expect(result.to_level).toBe(1);

      // Check event was logged
      const events = await pool.query(
        `SELECT * FROM cecelia_events WHERE event_type = 'alertness_notification' ORDER BY created_at DESC LIMIT 1`
      );
      expect(events.rows.length).toBe(1);
      expect(events.rows[0].payload.level).toBe(1);
    });

    it('should execute escalation + mitigation on ALERT → EMERGENCY', async () => {
      const result = await executeResponseActions(1, 2, { consecutive_failures: 5 });

      expect(result.actions).toContain('notification');
      expect(result.actions).toContain('escalation');
      expect(result.actions).toContain('mitigation');

      // Check RCA task was created
      const tasks = await pool.query(`SELECT * FROM tasks WHERE title LIKE 'Alertness RCA%'`);
      expect(tasks.rows.length).toBe(1);
      expect(tasks.rows[0].task_type).toBe('research');

      // Check mitigation state
      const state = getMitigationState();
      expect(state.p2_paused).toBe(true);
    });

    it('should execute shutdown safety on EMERGENCY → COMA', async () => {
      const result = await executeResponseActions(2, 3, { resource_pressure: 0.95 });

      expect(result.actions).toContain('shutdown_safety');

      // Check drain mode requested
      const state = getMitigationState();
      expect(state.drain_mode_requested).toBe(true);

      // Check checkpoint was saved
      const events = await pool.query(
        `SELECT * FROM cecelia_events WHERE event_type = 'alertness_checkpoint' ORDER BY created_at DESC LIMIT 1`
      );
      expect(events.rows.length).toBe(1);
    });

    it('should execute recovery on COMA → NORMAL (multi-step downgrade)', async () => {
      // Simulate COMA state first
      await executeResponseActions(0, 3, {});

      // Now recover
      const result = await executeResponseActions(3, 0, {});

      expect(result.actions).toContain('recovery');

      // Check mitigation state cleared
      const state = getMitigationState();
      expect(state.p2_paused).toBe(false);
      expect(state.drain_mode_requested).toBe(false);

      // Check recovery event
      const events = await pool.query(
        `SELECT * FROM cecelia_events WHERE event_type = 'alertness_recovery' ORDER BY created_at DESC LIMIT 1`
      );
      expect(events.rows.length).toBe(1);
    });
  });

  describe('notifyAlert', () => {
    it('should record notification to events table', async () => {
      await notifyAlert(1, { resource_pressure: 0.3 });

      const events = await pool.query(
        `SELECT * FROM cecelia_events WHERE event_type = 'alertness_notification' LIMIT 1`
      );

      expect(events.rows.length).toBe(1);
      expect(events.rows[0].payload.level).toBe(1);
      expect(events.rows[0].payload.level_name).toBe('ALERT');
      expect(events.rows[0].payload.signals).toEqual({ resource_pressure: 0.3 });
    });
  });

  describe('escalateToAnalysis', () => {
    it('should create RCA task with correct details', async () => {
      const signals = { consecutive_failures: 5, resource_pressure: 0.8 };
      const result = await escalateToAnalysis(signals);

      expect(result.task_id).toBeDefined();

      const tasks = await pool.query(`SELECT * FROM tasks WHERE id = $1`, [result.task_id]);
      expect(tasks.rows.length).toBe(1);

      const task = tasks.rows[0];
      expect(task.title).toBe('Alertness RCA - System Health Degradation');
      expect(task.task_type).toBe('research');
      expect(task.priority).toBe('P1');
      expect(task.status).toBe('queued');
      expect(task.payload.requires_cortex).toBe(true);
      expect(task.payload.signals).toEqual(signals);
    });

    it('should handle escalation failure gracefully', async () => {
      // Mock database failure
      vi.spyOn(pool, 'query').mockRejectedValueOnce(new Error('DB error'));

      const result = await escalateToAnalysis({});

      expect(result.error).toBe('DB error');
      // Should not throw
    });
  });

  describe('applyMitigation', () => {
    it('should pause P2 tasks', async () => {
      const result = await applyMitigation({ resource_pressure: 0.85 });

      expect(result.actions).toContain('p2_paused');

      const state = getMitigationState();
      expect(state.p2_paused).toBe(true);
    });

    it('should cleanup orphan processes', async () => {
      // This will call executor.cleanupOrphanProcesses()
      // In test environment, this might be 0, but we verify it doesn't crash
      const result = await applyMitigation({});

      expect(result.actions).toBeDefined();
      // May or may not contain cleaned_X_orphans depending on actual orphans
    });
  });

  describe('activateShutdownSafety', () => {
    it('should request drain mode', async () => {
      const result = await activateShutdownSafety({ resource_pressure: 0.95 });

      expect(result.drain_mode).toBe(true);

      const state = getMitigationState();
      expect(state.drain_mode_requested).toBe(true);
    });

    it('should save checkpoint to database', async () => {
      await activateShutdownSafety({ resource_pressure: 0.95 });

      const events = await pool.query(
        `SELECT * FROM cecelia_events WHERE event_type = 'alertness_checkpoint' LIMIT 1`
      );

      expect(events.rows.length).toBe(1);
      expect(events.rows[0].payload.level).toBe('COMA');
    });
  });

  describe('recoverFromLevel', () => {
    it('should disable drain mode on COMA → EMERGENCY', async () => {
      // Setup: enter COMA
      await activateShutdownSafety({});
      expect(getMitigationState().drain_mode_requested).toBe(true);

      // Recover
      await recoverFromLevel(3, 2);

      const state = getMitigationState();
      expect(state.drain_mode_requested).toBe(false);
    });

    it('should resume P2 on EMERGENCY → ALERT', async () => {
      // Setup: enter EMERGENCY
      await applyMitigation({});
      expect(getMitigationState().p2_paused).toBe(true);

      // Recover
      await recoverFromLevel(2, 1);

      const state = getMitigationState();
      expect(state.p2_paused).toBe(false);
    });

    it('should clear all restrictions on ALERT → NORMAL', async () => {
      // Setup: mitigation active
      await applyMitigation({});
      await activateShutdownSafety({});

      // Recover
      await recoverFromLevel(1, 0);

      const state = getMitigationState();
      expect(state.p2_paused).toBe(false);
      expect(state.drain_mode_requested).toBe(false);
    });

    it('should record recovery event', async () => {
      await recoverFromLevel(2, 1);

      const events = await pool.query(
        `SELECT * FROM cecelia_events WHERE event_type = 'alertness_recovery' LIMIT 1`
      );

      expect(events.rows.length).toBe(1);
      expect(events.rows[0].payload.from_level).toBe(2);
      expect(events.rows[0].payload.to_level).toBe(1);
    });
  });

  describe('getMitigationState', () => {
    it('should return copy of internal state', () => {
      const state1 = getMitigationState();
      state1.p2_paused = true;

      // Should not affect internal state
      const state2 = getMitigationState();
      expect(state2.p2_paused).toBe(false);
    });
  });
});
