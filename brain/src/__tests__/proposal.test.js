/**
 * Plan Proposal System Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateChange,
  validateChanges,
  hasCycleInGraph,
  checkRateLimit,
  ALLOWED_CHANGE_TYPES,
  ALLOWED_TASK_FIELDS,
  BULK_THRESHOLD,
} from '../proposal.js';

// Mock db.js so proposal.js loads without a real DB connection
vi.mock('../db.js', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

describe('proposal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ----------------------------------------------------------
  // validateChange
  // ----------------------------------------------------------
  describe('validateChange', () => {
    it('accepts valid create_task', () => {
      const result = validateChange({
        type: 'create_task',
        title: 'Test task',
        project_id: 'proj-123',
        priority: 'P1',
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects invalid action type', () => {
      const result = validateChange({ type: 'delete_database' });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('not in whitelist');
    });

    it('rejects non-object input', () => {
      const result = validateChange(null);
      expect(result.valid).toBe(false);
    });

    it('rejects create_task without title', () => {
      const result = validateChange({ type: 'create_task', project_id: 'x' });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('create_task requires title');
    });

    it('rejects create_task without project_id', () => {
      const result = validateChange({ type: 'create_task', title: 'x' });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('create_task requires project_id');
    });

    it('rejects update_task with forbidden field', () => {
      const result = validateChange({
        type: 'update_task',
        task_id: 't1',
        fields: { payload: '{"hack": true}' },
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('payload');
    });

    it('accepts update_task with allowed fields', () => {
      const result = validateChange({
        type: 'update_task',
        task_id: 't1',
        fields: { priority: 'P0', next_run_at: '2026-02-08' },
      });
      expect(result.valid).toBe(true);
    });

    it('accepts set_focus with objective_id', () => {
      const result = validateChange({ type: 'set_focus', objective_id: 'obj-1' });
      expect(result.valid).toBe(true);
    });

    it('rejects set_focus without objective_id', () => {
      const result = validateChange({ type: 'set_focus' });
      expect(result.valid).toBe(false);
    });

    it('accepts add_dependency with both IDs', () => {
      const result = validateChange({
        type: 'add_dependency',
        task_id: 't1',
        depends_on_id: 't2',
      });
      expect(result.valid).toBe(true);
    });

    it('rejects add_dependency without task_id', () => {
      const result = validateChange({ type: 'add_dependency', depends_on_id: 't2' });
      expect(result.valid).toBe(false);
    });
  });

  // ----------------------------------------------------------
  // validateChanges
  // ----------------------------------------------------------
  describe('validateChanges', () => {
    it('validates array of changes', () => {
      const result = validateChanges([
        { type: 'set_focus', objective_id: 'obj-1' },
        { type: 'update_task', task_id: 't1', fields: { priority: 'P0' } },
      ]);
      expect(result.valid).toBe(true);
    });

    it('rejects empty array', () => {
      const result = validateChanges([]);
      expect(result.valid).toBe(false);
    });

    it('collects errors from multiple changes', () => {
      const result = validateChanges([
        { type: 'delete_all' },
        { type: 'create_task' }, // missing title and project_id
      ]);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(1);
    });

    it('bulk changes require review', () => {
      const changes = Array.from({ length: BULK_THRESHOLD + 1 }, (_, i) => ({
        type: 'update_task',
        task_id: `t${i}`,
        fields: { priority: 'P0' },
      }));
      const result = validateChanges(changes);
      expect(result.valid).toBe(true);
      expect(result.requires_review).toBe(true);
    });

    it('small changes do not require review', () => {
      const result = validateChanges([
        { type: 'set_focus', objective_id: 'obj-1' },
      ]);
      expect(result.requires_review).toBe(false);
    });
  });

  // ----------------------------------------------------------
  // hasCycleInGraph (pure graph — no DB needed)
  // ----------------------------------------------------------
  describe('hasCycleInGraph', () => {
    it('detects self-dependency', () => {
      const adj = new Map();
      expect(hasCycleInGraph('t1', 't1', adj)).toBe(true);
    });

    it('detects simple cycle A→B→A', () => {
      // B already depends on A
      const adj = new Map([['B', ['A']]]);
      // Adding A depends on B → A→B→A (cycle!)
      expect(hasCycleInGraph('A', 'B', adj)).toBe(true);
    });

    it('allows valid dependency (no cycle)', () => {
      // B depends on C
      const adj = new Map([['B', ['C']]]);
      // Adding A depends on B: A→B→C (linear, no cycle)
      expect(hasCycleInGraph('A', 'B', adj)).toBe(false);
    });

    it('detects transitive cycle A→B→C→A', () => {
      // B depends on C, C depends on A
      const adj = new Map([['B', ['C']], ['C', ['A']]]);
      // Adding A depends on B: A→B→C→A (cycle!)
      expect(hasCycleInGraph('A', 'B', adj)).toBe(true);
    });

    it('handles empty graph', () => {
      const adj = new Map();
      expect(hasCycleInGraph('A', 'B', adj)).toBe(false);
    });

    it('handles complex graph without cycle', () => {
      // D→C, C→B, B→A (linear chain)
      const adj = new Map([['D', ['C']], ['C', ['B']], ['B', ['A']]]);
      // Adding E depends on D: E→D→C→B→A (no cycle)
      expect(hasCycleInGraph('E', 'D', adj)).toBe(false);
    });
  });

  // ----------------------------------------------------------
  // checkRateLimit
  // ----------------------------------------------------------
  describe('checkRateLimit', () => {
    it('allows first request', () => {
      const result = checkRateLimit('test_unique_' + Date.now());
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeGreaterThan(0);
    });
  });

  // ----------------------------------------------------------
  // Constants
  // ----------------------------------------------------------
  describe('constants', () => {
    it('has expected change types', () => {
      expect(ALLOWED_CHANGE_TYPES.has('create_task')).toBe(true);
      expect(ALLOWED_CHANGE_TYPES.has('update_task')).toBe(true);
      expect(ALLOWED_CHANGE_TYPES.has('set_focus')).toBe(true);
      expect(ALLOWED_CHANGE_TYPES.has('add_dependency')).toBe(true);
      expect(ALLOWED_CHANGE_TYPES.has('remove_dependency')).toBe(true);
      expect(ALLOWED_CHANGE_TYPES.has('drop_table')).toBe(false);
    });

    it('has expected task fields', () => {
      expect(ALLOWED_TASK_FIELDS.has('priority')).toBe(true);
      expect(ALLOWED_TASK_FIELDS.has('next_run_at')).toBe(true);
      expect(ALLOWED_TASK_FIELDS.has('payload')).toBe(false);
      expect(ALLOWED_TASK_FIELDS.has('id')).toBe(false);
    });

    it('BULK_THRESHOLD is 5', () => {
      expect(BULK_THRESHOLD).toBe(5);
    });
  });
});
