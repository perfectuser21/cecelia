/**
 * Tests for Alertness Response Actions
 *
 * Verifies that alertness level changes trigger correct protective and recovery actions.
 * Uses unified alertness levels: SLEEPING=0, CALM=1, AWARE=2, ALERT=3, PANIC=4
 */

import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { privatePgConfig, verifyPrivatePg } from '../../../../scripts/ci/private-pg-contract.mjs';
vi.mock('../db.js', () => ({ default: pool }));
vi.mock('../executor.js', () => ({ cleanupOrphanProcesses: vi.fn(async () => 2) }));
vi.mock('../task-updater.js', () => ({ broadcastTaskState: vi.fn() }));
vi.mock('../llm-caller.js', () => ({ callLLM: vi.fn(() => { throw Error('external model forbidden'); }) }));
vi.mock('../openai-client.js', () => ({ generateEmbedding: vi.fn(() => { throw Error('external model forbidden'); }) }));
let pool;
afterAll(async () => { vi.unstubAllGlobals(); await pool?.end(); });
let executeResponseActions, notifyAlert, escalateToAnalysis, applyMitigation, activateShutdownSafety, recoverFromLevel, getMitigationState, _resetMitigationState;

beforeAll(async () => {
  vi.resetModules();
  vi.stubGlobal('fetch', vi.fn(async () => { throw Error('external network forbidden'); }));
  pool = new pg.Client(privatePgConfig());
  await pool.connect();
  await verifyPrivatePg(pool);
  ({ executeResponseActions, notifyAlert, escalateToAnalysis, applyMitigation, activateShutdownSafety, recoverFromLevel, getMitigationState, _resetMitigationState } = await import('../alertness-actions.js'));
});

// New unified levels: SLEEPING=0, CALM=1, AWARE=2, ALERT=3, PANIC=4
const CALM = 1;
const AWARE = 2;
const ALERT = 3;
const PANIC = 4;

describe('alertness-actions', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await pool.query('BEGIN');
    _resetMitigationState();
  });

  afterEach(async () => {
    await pool.query('ROLLBACK');
    _resetMitigationState();
  });

  describe('executeResponseActions', () => {
    it('should not execute actions if level unchanged', async () => {
      const result = await executeResponseActions(CALM, CALM, {});
      expect(result.actions).toEqual([]);
      expect(result.reason).toBe('no_change');
    });

    it('should execute notification on CALM -> AWARE', async () => {
      const result = await executeResponseActions(CALM, AWARE, { resource_pressure: 0.3 });

      expect(result.actions).toContain('notification');
      expect(result.from_level).toBe(CALM);
      expect(result.to_level).toBe(AWARE);

      // Check event was logged
      const events = await pool.query(
        `SELECT * FROM cecelia_events WHERE event_type = 'alertness_notification' ORDER BY created_at DESC LIMIT 1`
      );
      expect(events.rows.length).toBe(1);
      expect(events.rows[0].payload.level).toBe(AWARE);
    });

    it('should execute escalation + mitigation on AWARE -> ALERT', async () => {
      const result = await executeResponseActions(AWARE, ALERT, { consecutive_failures: 5 });

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

    it('should execute shutdown safety on ALERT -> PANIC', async () => {
      const result = await executeResponseActions(ALERT, PANIC, { resource_pressure: 0.95 });

      expect(result.actions).toContain('shutdown_safety');

      // COMA 不再自动请求 drain mode（防止叠加 drain 自杀）
      const state = getMitigationState();
      expect(state.drain_mode_requested).toBe(false);

      // Check checkpoint was saved
      const events = await pool.query(
        `SELECT * FROM cecelia_events WHERE event_type = 'alertness_checkpoint' ORDER BY created_at DESC LIMIT 1`
      );
      expect(events.rows.length).toBe(1);
    });

    it('should execute recovery on PANIC -> CALM (multi-step downgrade)', async () => {
      // Simulate PANIC state first
      await executeResponseActions(CALM, PANIC, {});

      // Now recover
      const result = await executeResponseActions(PANIC, CALM, {});

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
      await notifyAlert(AWARE, { resource_pressure: 0.3 });

      const events = await pool.query(
        `SELECT * FROM cecelia_events WHERE event_type = 'alertness_notification' LIMIT 1`
      );

      expect(events.rows.length).toBe(1);
      expect(events.rows[0].payload.level).toBe(AWARE);
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
      const receipt = await pool.query('SELECT source, work_kind, canonical_task_type FROM work_routing_receipts WHERE task_id=$1', [task.id]);
      expect(receipt.rows).toEqual([{ source: 'discovery', work_kind: 'research', canonical_task_type: 'research' }]);
    });

    it('should handle escalation failure gracefully', async () => {
      // Mock database failure
      vi.spyOn(pool, 'query').mockRejectedValueOnce(new Error('DB error'));

      const result = await escalateToAnalysis({});

      expect(result.error).toBe('DB error');
      expect((await pool.query("SELECT id FROM tasks WHERE title LIKE 'Alertness RCA%'")).rows).toHaveLength(0);
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
      const { cleanupOrphanProcesses } = await import('../executor.js');
      const result = await applyMitigation({});

      expect(cleanupOrphanProcesses).toHaveBeenCalled();
      expect(result.actions).toContain('cleaned_2_orphans');
    });
  });

  describe('activateShutdownSafety', () => {
    it('should NOT request drain mode (COMA no longer auto-drains)', async () => {
      const result = await activateShutdownSafety({ resource_pressure: 0.95 });

      // COMA 不再自动请求 drain mode
      expect(result.drain_mode).toBe(false);

      const state = getMitigationState();
      expect(state.drain_mode_requested).toBe(false);
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
    it('should keep drain mode false on PANIC -> ALERT (COMA no longer auto-drains)', async () => {
      // Setup: enter PANIC (no longer sets drain_mode_requested)
      await activateShutdownSafety({});
      expect(getMitigationState().drain_mode_requested).toBe(false);

      // Recover
      await recoverFromLevel(PANIC, ALERT);

      const state = getMitigationState();
      expect(state.drain_mode_requested).toBe(false);
    });

    it('should resume P2 on ALERT -> AWARE', async () => {
      // Setup: enter ALERT
      await applyMitigation({});
      expect(getMitigationState().p2_paused).toBe(true);

      // Recover
      await recoverFromLevel(ALERT, AWARE);

      const state = getMitigationState();
      expect(state.p2_paused).toBe(false);
    });

    it('should clear all restrictions on AWARE -> CALM', async () => {
      // Setup: mitigation active
      await applyMitigation({});
      await activateShutdownSafety({});

      // Recover
      await recoverFromLevel(AWARE, CALM);

      const state = getMitigationState();
      expect(state.p2_paused).toBe(false);
      expect(state.drain_mode_requested).toBe(false);
    });

    it('should record recovery event', async () => {
      await recoverFromLevel(ALERT, AWARE);

      const events = await pool.query(
        `SELECT * FROM cecelia_events WHERE event_type = 'alertness_recovery' LIMIT 1`
      );

      expect(events.rows.length).toBe(1);
      expect(events.rows[0].payload.from_level).toBe(ALERT);
      expect(events.rows[0].payload.to_level).toBe(AWARE);
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
