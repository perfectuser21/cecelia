/**
 * OKR/KR 问答状态保留及旧自动拆解退役合同。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}));

vi.mock('../event-bus.js', () => ({
  emit: vi.fn(() => Promise.resolve()),
}));

vi.mock('../actions.js', () => ({
  createTask: vi.fn(),
}));

vi.mock('../slot-allocator.js', () => ({
  harnessSlotCheck: vi.fn().mockResolvedValue({ allow: true, reason: 'ok', containers: 0, inflight: 0, cap: { effective: 4, mem_cap: 8, acct_cap: 4, hard_cap: 8 }, stale: false }),
  calculateSlotBudget: vi.fn(),
  TOTAL_CAPACITY: 12,
  CECELIA_RESERVED: 2,
  USER_RESERVED_BASE: 1,
  USER_PRIORITY_HEADROOM: 1,
  SESSION_TTL_SECONDS: 14400,
  detectUserSessions: vi.fn(() => ({ headed: [], headless: [], total: 0 })),
  detectUserMode: vi.fn(() => 'absent'),
  hasPendingInternalTasks: vi.fn(() => Promise.resolve(false)),
  countCeceliaInProgress: vi.fn(() => Promise.resolve(0)),
  countAutoDispatchInProgress: vi.fn(() => Promise.resolve(0)),
  getSlotStatus: vi.fn(() => Promise.resolve({})),
}));

import pool from '../db.js';
import { emit } from '../event-bus.js';
import { createTask } from '../actions.js';
import {
  areAllQuestionsAnswered,
  OKR_STATUS,
  triggerPlannerForGoal,
} from '../okr-tick.js';


const makeKR = (overrides = {}) => ({
  id: 'kr-001',
  title: 'Test KR',
  description: 'Test description',
  status: 'ready',
  priority: 'P1',
  project_id: null,
  metadata: {},
  ...overrides,
});

describe('areAllQuestionsAnswered — 问题状态判断', () => {
  it('无 pending_questions 时返回 true', () => {
    expect(areAllQuestionsAnswered({ metadata: {} })).toBe(true);
  });

  it('pending_questions 为空数组时返回 true', () => {
    expect(areAllQuestionsAnswered({ metadata: { pending_questions: [] } })).toBe(true);
  });

  it('所有问题已回答时返回 true', () => {
    const kr = makeKR({
      metadata: {
        pending_questions: [
          { id: 'q1', answered: true, answer: 'A1' },
          { id: 'q2', answered: true, answer: 'A2' },
        ],
      },
    });
    expect(areAllQuestionsAnswered(kr)).toBe(true);
  });

  it('有未回答问题时返回 false，阻止 needs_info → ready 转换', () => {
    const kr = makeKR({
      metadata: {
        pending_questions: [
          { id: 'q1', answered: true, answer: 'A1' },
          { id: 'q2', answered: false, answer: null },
        ],
      },
    });
    expect(areAllQuestionsAnswered(kr)).toBe(false);
  });
});

describe('triggerPlannerForGoal — 旧拆解退役', () => {
  beforeEach(() => vi.clearAllMocks());
  it('直接调用不发拆解事件、不创建任务、不更改 KR', async () => {
    const kr = makeKR();
    const result = await triggerPlannerForGoal(kr);
    expect(result).toMatchObject({ triggered: false, reason: 'decomposition_retired', goal_id: kr.id });
    expect(emit).not.toHaveBeenCalled();
    expect(createTask).not.toHaveBeenCalled();
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('OKR_STATUS 常量完整性', () => {
  it('包含完整状态机所需的全部状态', () => {
    expect(OKR_STATUS.PENDING).toBe('pending');
    expect(OKR_STATUS.NEEDS_INFO).toBe('needs_info');
    expect(OKR_STATUS.READY).toBe('ready');
    expect(OKR_STATUS.DECOMPOSING).toBe('decomposing');
    expect(OKR_STATUS.IN_PROGRESS).toBe('in_progress');
    expect(OKR_STATUS.COMPLETED).toBe('completed');
    expect(OKR_STATUS.CANCELLED).toBe('cancelled');
  });
});

describe('KR 问答与退役拆解边界', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('问题全部回答后可判为 ready，但不触发退役拆解', async () => {
    const kr = makeKR({ metadata: { pending_questions: [{ answered: true }] } });
    expect(areAllQuestionsAnswered(kr)).toBe(true);
    const result = await triggerPlannerForGoal(kr);
    expect(result.reason).toBe('decomposition_retired');
    expect(createTask).not.toHaveBeenCalled();
  });

  it('questions 有未回答 → areAllQuestionsAnswered=false → 不触发拆解', async () => {
    const kr = makeKR({
      status: 'needs_info',
      metadata: {
        pending_questions: [
          { id: 'q1', answered: true, answer: '已回答' },
          { id: 'q2', answered: false, answer: null }, // 未回答
        ],
      },
    });

    // 不满足条件，不应触发拆解
    const shouldTrigger = areAllQuestionsAnswered(kr);
    expect(shouldTrigger).toBe(false);

    // createTask 不应被调用
    expect(createTask).not.toHaveBeenCalled();
  });
});
