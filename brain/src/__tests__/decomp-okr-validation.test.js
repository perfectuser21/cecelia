/**
 * Tests: OKR Validator integration with decomposition-checker
 * DoD: D1 (BLOCK → skip), D2 (ok → create), D3 (error → non-fatal)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock validate-okr-structure before importing decomposition-checker
vi.mock('../validate-okr-structure.js', () => ({
  validateOkrStructure: vi.fn(),
}));

// Mock db.js
vi.mock('../db.js', () => {
  const mockPool = {
    query: vi.fn(),
  };
  return { default: mockPool };
});

// Mock capacity.js
vi.mock('../capacity.js', () => ({
  computeCapacity: vi.fn(() => ({
    project: { max: 5, softMin: 1, cooldownMs: 180000 },
    initiative: { max: 9, softMin: 3, cooldownMs: 120000 },
    task: { queuedCap: 27, softMin: 9, cooldownMs: 60000 },
  })),
  isAtCapacity: vi.fn(() => false),
}));

// Mock task-quality-gate.js
vi.mock('../task-quality-gate.js', () => ({
  validateTaskDescription: vi.fn(() => ({ valid: true, reasons: [] })),
}));

import { validateOkrStructure } from '../validate-okr-structure.js';
import pool from '../db.js';
import {
  createDecompositionTask,
  runDecompositionChecks,
  _resetBlockedEntityIds,
} from '../decomposition-checker.js';

// Helper: mock pool.query for standard decomp-checker queries
function setupPoolMock(opts = {}) {
  const {
    manualMode = false,
    projectCount = 0,
    initiativeCount = 0,
    taskCount = 0,
    insertResult = { rows: [{ id: 'task-1', title: 'test' }] },
  } = opts;

  pool.query.mockImplementation(async (sql) => {
    const s = typeof sql === 'string' ? sql : '';
    // manual_mode
    if (s.includes('manual_mode')) {
      return manualMode
        ? { rows: [{ value_json: { enabled: true } }] }
        : { rows: [] };
    }
    // capacity counts
    if (s.includes("type = 'project'") && s.includes('COUNT')) {
      return { rows: [{ cnt: String(projectCount) }] };
    }
    if (s.includes("type = 'initiative'") && s.includes('COUNT')) {
      return { rows: [{ cnt: String(initiativeCount) }] };
    }
    if (s.includes("status = 'queued'") && s.includes('COUNT')) {
      return { rows: [{ cnt: String(taskCount) }] };
    }
    // Active execution paths
    if (s.includes('last_activity')) {
      return { rows: [] };
    }
    // Check 1-7 queries (goals, projects, etc.)
    if (s.includes('FROM goals') || s.includes('from goals')) {
      return { rows: [] };
    }
    if (s.includes('FROM projects') || s.includes('from projects')) {
      return { rows: [] };
    }
    if (s.includes('project_kr_links')) {
      return { rows: [] };
    }
    if (s.includes('FROM tasks') || s.includes('from tasks')) {
      return { rows: [] };
    }
    // INSERT (createDecompositionTask)
    if (s.includes('INSERT INTO tasks')) {
      return insertResult;
    }
    return { rows: [] };
  });
}

describe('decomp-checker OKR validation integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetBlockedEntityIds();
  });

  // ─── D1: BLOCK → skip creation ───

  describe('D1: BLOCK entities → skip task creation', () => {
    it('should skip task creation when goalId is in blocked set', async () => {
      // Simulate: runDecompositionChecks populates _blockedEntityIds
      validateOkrStructure.mockResolvedValue({
        ok: false,
        issues: [
          { level: 'BLOCK', entityId: 'goal-blocked-1', type: 'required_field', message: 'missing title' },
        ],
      });
      setupPoolMock();

      // Run checks to populate blocked set
      await runDecompositionChecks();

      // Now try to create a task for the blocked goal
      const result = await createDecompositionTask({
        title: 'Decompose blocked goal',
        description: 'A sufficiently long description that passes the quality gate validation with action keywords like implement and build something meaningful',
        goalId: 'goal-blocked-1',
        projectId: null,
        payload: {},
      });

      expect(result.rejected).toBe(true);
      expect(result.reasons).toContain('okr_validation_blocked');
      expect(result.id).toBeNull();
    });

    it('should skip task creation when projectId is in blocked set', async () => {
      validateOkrStructure.mockResolvedValue({
        ok: false,
        issues: [
          { level: 'BLOCK', entityId: 'proj-blocked-1', type: 'required_field', message: 'missing name' },
        ],
      });
      setupPoolMock();

      await runDecompositionChecks();

      const result = await createDecompositionTask({
        title: 'Decompose blocked project',
        description: 'A sufficiently long description that passes the quality gate validation with action keywords like implement and build something meaningful',
        goalId: 'goal-ok-1',
        projectId: 'proj-blocked-1',
        payload: {},
      });

      expect(result.rejected).toBe(true);
      expect(result.reasons).toContain('okr_validation_blocked');
    });

    it('should log blocked count when BLOCK issues exist', async () => {
      const consoleSpy = vi.spyOn(console, 'log');
      validateOkrStructure.mockResolvedValue({
        ok: false,
        issues: [
          { level: 'BLOCK', entityId: 'e1', type: 'required_field', message: 'x' },
          { level: 'BLOCK', entityId: 'e2', type: 'required_field', message: 'y' },
          { level: 'WARN', entityId: 'e3', type: 'text_too_short', message: 'z' },
        ],
      });
      setupPoolMock();

      await runDecompositionChecks();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('OKR validation: 2 entities blocked')
      );
      consoleSpy.mockRestore();
    });
  });

  // ─── D2: ok → create normally ───

  describe('D2: ok validation → create tasks normally', () => {
    it('should allow task creation when validation passes', async () => {
      validateOkrStructure.mockResolvedValue({
        ok: true,
        issues: [],
      });
      setupPoolMock({
        insertResult: { rows: [{ id: 'task-created-1', title: 'Decompose OK goal' }] },
      });

      await runDecompositionChecks();

      const result = await createDecompositionTask({
        title: 'Decompose OK goal',
        description: 'A sufficiently long description that passes the quality gate validation with action keywords like implement and build something meaningful',
        goalId: 'goal-ok-1',
        projectId: null,
        payload: {},
      });

      expect(result.id).toBe('task-created-1');
      expect(result.rejected).toBeUndefined();
    });

    it('should allow task creation when issues are only WARN level', async () => {
      validateOkrStructure.mockResolvedValue({
        ok: true,
        issues: [
          { level: 'WARN', entityId: 'goal-warn-1', type: 'text_too_short', message: 'short desc' },
        ],
      });
      setupPoolMock({
        insertResult: { rows: [{ id: 'task-warn-ok', title: 'Decompose warned goal' }] },
      });

      await runDecompositionChecks();

      const result = await createDecompositionTask({
        title: 'Decompose warned goal',
        description: 'A sufficiently long description that passes the quality gate validation with action keywords like implement and build something meaningful',
        goalId: 'goal-warn-1',
        projectId: null,
        payload: {},
      });

      expect(result.id).toBe('task-warn-ok');
      expect(result.rejected).toBeUndefined();
    });
  });

  // ─── D3: validator error → non-fatal ───

  describe('D3: validator exception → non-fatal', () => {
    it('should continue normally when validateOkrStructure throws', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn');
      validateOkrStructure.mockRejectedValue(new Error('DB connection failed'));
      setupPoolMock({
        insertResult: { rows: [{ id: 'task-after-error', title: 'Works despite error' }] },
      });

      // Should not throw
      const result = await runDecompositionChecks();
      expect(result.actions).toBeDefined();

      // Verify warning was logged
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('OKR validation failed (non-fatal)'),
        'DB connection failed'
      );

      // Task creation should still work (blocked set is empty)
      const task = await createDecompositionTask({
        title: 'Task after error',
        description: 'A sufficiently long description that passes the quality gate validation with action keywords like implement and build something meaningful',
        goalId: 'goal-after-error',
        projectId: null,
        payload: {},
      });

      expect(task.id).toBe('task-after-error');
      expect(task.rejected).toBeUndefined();
      consoleWarnSpy.mockRestore();
    });

    it('should clear blocked set on validator error', async () => {
      // First: populate blocked set
      validateOkrStructure.mockResolvedValue({
        ok: false,
        issues: [{ level: 'BLOCK', entityId: 'goal-temp-blocked', type: 'required_field', message: 'x' }],
      });
      setupPoolMock();
      await runDecompositionChecks();

      // Verify blocked
      const blocked = await createDecompositionTask({
        title: 'Should be blocked',
        description: 'A sufficiently long description that passes the quality gate validation with action keywords like implement and build something meaningful',
        goalId: 'goal-temp-blocked',
        projectId: null,
        payload: {},
      });
      expect(blocked.rejected).toBe(true);

      // Second: validator throws → blocked set should be cleared
      validateOkrStructure.mockRejectedValue(new Error('timeout'));
      setupPoolMock({
        insertResult: { rows: [{ id: 'task-unblocked', title: 'Unblocked' }] },
      });
      await runDecompositionChecks();

      const unblocked = await createDecompositionTask({
        title: 'Should be unblocked now',
        description: 'A sufficiently long description that passes the quality gate validation with action keywords like implement and build something meaningful',
        goalId: 'goal-temp-blocked',
        projectId: null,
        payload: {},
      });
      expect(unblocked.id).toBe('task-unblocked');
    });

    it('should not block when validation returns issues without entityId', async () => {
      validateOkrStructure.mockResolvedValue({
        ok: false,
        issues: [
          { level: 'BLOCK', type: 'dependency_cycle', message: 'cycle detected' },
        ],
      });
      setupPoolMock({
        insertResult: { rows: [{ id: 'task-no-entity', title: 'No entity ID' }] },
      });

      await runDecompositionChecks();

      const result = await createDecompositionTask({
        title: 'Should not be blocked',
        description: 'A sufficiently long description that passes the quality gate validation with action keywords like implement and build something meaningful',
        goalId: 'goal-safe',
        projectId: null,
        payload: {},
      });

      expect(result.id).toBe('task-no-entity');
    });
  });

  // ─── _resetBlockedEntityIds ───

  describe('_resetBlockedEntityIds', () => {
    it('should clear blocked set after reset', async () => {
      validateOkrStructure.mockResolvedValue({
        ok: false,
        issues: [{ level: 'BLOCK', entityId: 'goal-reset-test', type: 'required_field', message: 'x' }],
      });
      setupPoolMock();
      await runDecompositionChecks();

      // Before reset: blocked
      const before = await createDecompositionTask({
        title: 'Before reset',
        description: 'A sufficiently long description that passes the quality gate validation with action keywords like implement and build something meaningful',
        goalId: 'goal-reset-test',
        projectId: null,
        payload: {},
      });
      expect(before.rejected).toBe(true);

      // After reset: allowed
      _resetBlockedEntityIds();
      setupPoolMock({
        insertResult: { rows: [{ id: 'task-after-reset', title: 'After reset' }] },
      });

      const after = await createDecompositionTask({
        title: 'After reset',
        description: 'A sufficiently long description that passes the quality gate validation with action keywords like implement and build something meaningful',
        goalId: 'goal-reset-test',
        projectId: null,
        payload: {},
      });
      expect(after.id).toBe('task-after-reset');
    });
  });
});
