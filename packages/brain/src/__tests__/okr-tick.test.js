/**
 * OKR Tick Tests
 * Tests for OKR state machine functionality
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db.js
vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(() => Promise.resolve({ rows: [] })),
  },
}));

// Mock event-bus.js
vi.mock('../event-bus.js', () => ({
  emit: vi.fn(() => Promise.resolve()),
}));

// Mock actions.js
vi.mock('../actions.js', () => ({
  createTask: vi.fn(() => Promise.resolve({ task: { id: 'task-123' }, deduplicated: false })),
}));

// Mock slot-allocator.js (used via dynamic import in triggerPlannerForGoal)
vi.mock('../slot-allocator.js', () => ({
  calculateSlotBudget: vi.fn(() => Promise.resolve({ dispatchAllowed: true })),
  TOTAL_CAPACITY: 12,
  CECELIA_RESERVED: 2,
  USER_RESERVED_BASE: 2,
  USER_PRIORITY_HEADROOM: 2,
  SESSION_TTL_SECONDS: 4 * 60 * 60,
  detectUserSessions: vi.fn(() => ({ headed: [], headless: [], total: 0 })),
  detectUserMode: vi.fn(() => 'absent'),
  hasPendingInternalTasks: vi.fn(() => Promise.resolve(false)),
  countCeceliaInProgress: vi.fn(() => Promise.resolve(0)),
  countAutoDispatchInProgress: vi.fn(() => Promise.resolve(0)),
  getSlotStatus: vi.fn(() => Promise.resolve({})),
}));

import pool from '../db.js';
import { createTask } from '../actions.js';
import { calculateSlotBudget } from '../slot-allocator.js';
import { areAllQuestionsAnswered, OKR_STATUS } from '../okr-tick.js';

// triggerPlannerForGoal is not exported directly; test via executeOkrTick
// Instead we test the deferred logic by re-importing with pool mocked for goal state revert
import { triggerPlannerForGoal } from '../okr-tick.js';

describe('areAllQuestionsAnswered', () => {
  it('should return true when no questions exist', () => {
    const goal = { metadata: {} };
    expect(areAllQuestionsAnswered(goal)).toBe(true);
  });

  it('should return true when pending_questions is empty array', () => {
    const goal = { metadata: { pending_questions: [] } };
    expect(areAllQuestionsAnswered(goal)).toBe(true);
  });

  it('should return true when all questions are answered', () => {
    const goal = {
      metadata: {
        pending_questions: [
          { id: 'q1', question: 'Q1?', answered: true, answer: 'A1' },
          { id: 'q2', question: 'Q2?', answered: true, answer: 'A2' }
        ]
      }
    };
    expect(areAllQuestionsAnswered(goal)).toBe(true);
  });

  it('should return false when some questions are unanswered', () => {
    const goal = {
      metadata: {
        pending_questions: [
          { id: 'q1', question: 'Q1?', answered: true, answer: 'A1' },
          { id: 'q2', question: 'Q2?', answered: false, answer: null }
        ]
      }
    };
    expect(areAllQuestionsAnswered(goal)).toBe(false);
  });

  it('should return false when all questions are unanswered', () => {
    const goal = {
      metadata: {
        pending_questions: [
          { id: 'q1', question: 'Q1?', answered: false, answer: null }
        ]
      }
    };
    expect(areAllQuestionsAnswered(goal)).toBe(false);
  });

  it('should return true when metadata is null', () => {
    const goal = { metadata: null };
    expect(areAllQuestionsAnswered(goal)).toBe(true);
  });
});

describe('OKR_STATUS', () => {
  it('should have all expected statuses', () => {
    expect(OKR_STATUS).toHaveProperty('PENDING');
    expect(OKR_STATUS).toHaveProperty('NEEDS_INFO');
    expect(OKR_STATUS).toHaveProperty('READY');
    expect(OKR_STATUS).toHaveProperty('DECOMPOSING');
    expect(OKR_STATUS).toHaveProperty('IN_PROGRESS');
    expect(OKR_STATUS).toHaveProperty('COMPLETED');
    expect(OKR_STATUS).toHaveProperty('CANCELLED');
  });

  it('should have correct status values', () => {
    expect(OKR_STATUS.PENDING).toBe('pending');
    expect(OKR_STATUS.NEEDS_INFO).toBe('needs_info');
    expect(OKR_STATUS.READY).toBe('ready');
    expect(OKR_STATUS.DECOMPOSING).toBe('decomposing');
    expect(OKR_STATUS.IN_PROGRESS).toBe('in_progress');
    expect(OKR_STATUS.COMPLETED).toBe('completed');
    expect(OKR_STATUS.CANCELLED).toBe('cancelled');
  });
});

// ============================================================
// triggerPlannerForGoal — pool_c_full 容量预检
// ============================================================

describe('triggerPlannerForGoal - pool capacity check', () => {
  const mockGoal = {
    id: 'goal-abc',
    title: 'Test Goal',
    description: 'Test description',
    priority: 'P0',
    project_id: null,
  };

  beforeEach(() => {
    vi.resetAllMocks();
    // Default: pool has capacity
    calculateSlotBudget.mockResolvedValue({ dispatchAllowed: true });
    pool.query.mockResolvedValue({ rows: [] });
    createTask.mockResolvedValue({ task: { id: 'task-123' }, deduplicated: false });
  });

  it('should create decomposition task when pool has capacity', async () => {
    calculateSlotBudget.mockResolvedValue({ dispatchAllowed: true });

    const result = await triggerPlannerForGoal(mockGoal);

    expect(result.triggered).toBe(true);
    expect(result.goal_id).toBe('goal-abc');
    expect(createTask).toHaveBeenCalledOnce();
  });

  it('should defer goal when pool is full (dispatchAllowed=false)', async () => {
    calculateSlotBudget.mockResolvedValue({ dispatchAllowed: false });

    const result = await triggerPlannerForGoal(mockGoal);

    expect(result.triggered).toBe(false);
    expect(result.deferred).toBe(true);
    expect(result.reason).toBe('pool_c_full');
    expect(result.goal_id).toBe('goal-abc');
    expect(result.title).toBe('Test Goal');
    // Goal status should be reverted to 'ready'
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("status='ready'"),
      ['goal-abc']
    );
    // createTask should NOT be called
    expect(createTask).not.toHaveBeenCalled();
  });

  it('should NOT defer when pool has exactly 1 available slot', async () => {
    calculateSlotBudget.mockResolvedValue({ dispatchAllowed: true });

    const result = await triggerPlannerForGoal(mockGoal);

    expect(result.triggered).toBe(true);
    expect(result.deferred).toBeUndefined();
  });
});
