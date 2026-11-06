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

// 断言旧拆解退役后不再调用容量和任务创建。
vi.mock('../slot-allocator.js', () => ({
  harnessSlotCheck: vi.fn().mockResolvedValue({ allow: true, reason: 'ok', containers: 0, inflight: 0, cap: { effective: 4, mem_cap: 8, acct_cap: 4, hard_cap: 8 }, stale: false }),
  calculateSlotBudget: vi.fn(() => Promise.resolve({ dispatchAllowed: true })),
  TOTAL_CAPACITY: 12,
  CECELIA_RESERVED: 2,
  USER_RESERVED_BASE: 1,
  USER_PRIORITY_HEADROOM: 1,
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
import { areAllQuestionsAnswered, OKR_STATUS, executeOkrTick } from '../okr-tick.js';

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

describe('triggerPlannerForGoal — 旧拆解退役合同', () => {
  it('直接调用旧入口仍拒绝创建任务或修改状态', async () => {
    vi.resetAllMocks();
    const result = await triggerPlannerForGoal({ id: 'goal-abc', title: 'Test Goal' });
    expect(result).toMatchObject({ triggered: false, reason: 'decomposition_retired', goal_id: 'goal-abc' });
    expect(createTask).not.toHaveBeenCalled();
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('executeOkrTick 建单失败恢复合同变更', () => {
  it('旧建单链退役后不再调用建单，ready 状态保持不变', async () => {
    vi.resetAllMocks();
    pool.query.mockResolvedValue({ rows: [] });
    createTask.mockRejectedValue(new Error('task create unavailable'));
    const result = await executeOkrTick();
    expect(createTask).not.toHaveBeenCalled();
    expect(result.ready_goals_processed).toBe(0);
  });
});

describe('退役 OKR 旧自动拆解', () => {
  it('ready 的 KR 不创建旧拆解任务、不更改状态，已答问题仍可晋升', async () => {
    vi.resetAllMocks();
    const ready = { id: 'old-ready', title: 'ready', metadata: {} };
    const answered = { id: 'answered', title: 'answered', metadata: { pending_questions: [{ answered: true }] } };
    pool.query.mockImplementation(async (sql, params = []) => {
      if (sql.includes('SELECT id, title')) return { rows: params.includes('ready') ? [ready] : [answered] };
      if (sql.includes('UPDATE key_results')) return { rows: [] };
      throw new Error(`unexpected query: ${sql}`);
    });
    calculateSlotBudget.mockResolvedValue({ dispatchAllowed: true });
    createTask.mockResolvedValue({ task: { id: 'legacy-task' } });
    const result = await executeOkrTick();
    expect(createTask).not.toHaveBeenCalled();
    expect(pool.query.mock.calls.filter(([sql, params]) => sql.includes('UPDATE key_results') && params[0] === 'old-ready')).toHaveLength(0);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE key_results'), ['answered', 'ready']);
    expect(result.needs_info_promoted).toBe(1);
  });
});
