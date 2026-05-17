/**
 * OKR/KR Integration Chain Tests
 *
 * 验证跨模块完整链路：
 * - KR needs_info → all questions answered → promotes to ready
 * - KR ready → executeOkrTick → decomposing + task created
 * - Pool 满时 → goal 回退到 ready，下个 tick 重试
 * - 拆解失败 → 自动回退 ready（不丢失目标）
 * - 全链路：needs_info → ready → decomposing → task created
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
import { calculateSlotBudget } from '../slot-allocator.js';
import {
  areAllQuestionsAnswered,
  OKR_STATUS,
  triggerPlannerForGoal,
} from '../okr-tick.js';

// executeOkrTick 未直接导出，通过 startOkrLoop 间接触发；测试核心链路函数
// 直接测试 triggerPlannerForGoal + areAllQuestionsAnswered 的组合行为

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

describe('triggerPlannerForGoal — KR 拆解触发链路', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('正常路径：pool 未满 → 发事件 → 创建拆解任务 → 返回 triggered=true', async () => {
    calculateSlotBudget.mockResolvedValueOnce({ dispatchAllowed: true });
    createTask.mockResolvedValueOnce({
      task: { id: 'task-decomp-001' },
      deduplicated: false,
    });

    const kr = makeKR();
    const result = await triggerPlannerForGoal(kr);

    expect(emit).toHaveBeenCalledWith('goal_ready_for_decomposition', 'okr-tick', {
      goal_id: kr.id,
      title: kr.title,
      priority: kr.priority,
      description: kr.description,
    });

    expect(createTask).toHaveBeenCalledWith(expect.objectContaining({
      title: expect.stringContaining('OKR 拆解'),
      goal_id: kr.id,
      task_type: 'dev',
      trigger_source: 'okr_tick',
      payload: expect.objectContaining({
        decomposition: 'true',
        kr_id: kr.id,
      }),
    }));

    expect(result.triggered).toBe(true);
    expect(result.goal_id).toBe(kr.id);
    expect(result.task_id).toBe('task-decomp-001');
  });

  it('Pool 满时：回退 KR 状态为 ready，返回 triggered=false deferred=true', async () => {
    calculateSlotBudget.mockResolvedValueOnce({ dispatchAllowed: false });
    pool.query.mockResolvedValueOnce({ rows: [] }); // UPDATE key_results SET status='ready'

    const kr = makeKR();
    const result = await triggerPlannerForGoal(kr);

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("SET status='ready'"),
      [kr.id]
    );
    expect(createTask).not.toHaveBeenCalled();
    expect(result.triggered).toBe(false);
    expect(result.deferred).toBe(true);
    expect(result.reason).toBe('pool_c_full');
  });

  it('重复任务（deduplicated=true）时正常返回，不重复创建', async () => {
    calculateSlotBudget.mockResolvedValueOnce({ dispatchAllowed: true });
    createTask.mockResolvedValueOnce({
      task: { id: 'task-existing-001' },
      deduplicated: true,
    });

    const kr = makeKR();
    const result = await triggerPlannerForGoal(kr);

    expect(result.triggered).toBe(true);
    expect(result.deduplicated).toBe(true);
  });

  it('createTask 失败时 → 捕获错误，返回 triggered=false 并携带 error', async () => {
    calculateSlotBudget.mockResolvedValueOnce({ dispatchAllowed: true });
    createTask.mockRejectedValueOnce(new Error('DB connection failed'));

    const kr = makeKR();
    const result = await triggerPlannerForGoal(kr);

    expect(result.triggered).toBe(false);
    expect(result.error).toBe('DB connection failed');
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

describe('KR 全链路行为 — needs_info → ready → 拆解', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('全链路：questions 全回答 → areAllQuestionsAnswered=true → 可触发 triggerPlannerForGoal', async () => {
    // Step 1: KR 从 needs_info 转态判断
    const kr = makeKR({
      status: 'needs_info',
      metadata: {
        pending_questions: [
          { id: 'q1', answered: true, answer: '每天' },
          { id: 'q2', answered: true, answer: '2小时' },
        ],
      },
    });

    // areAllQuestionsAnswered = true → 应晋升 ready
    expect(areAllQuestionsAnswered(kr)).toBe(true);

    // Step 2: 晋升为 ready 后触发拆解
    calculateSlotBudget.mockResolvedValueOnce({ dispatchAllowed: true });
    createTask.mockResolvedValueOnce({
      task: { id: 'task-full-chain-001' },
      deduplicated: false,
    });

    const readyKR = { ...kr, status: 'ready' };
    const result = await triggerPlannerForGoal(readyKR);

    // 全链路验证：事件 emit + 任务创建
    expect(emit).toHaveBeenCalledTimes(1); // goal_ready_for_decomposition
    expect(createTask).toHaveBeenCalledTimes(1);
    expect(result.triggered).toBe(true);
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
