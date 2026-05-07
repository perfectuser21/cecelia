/**
 * diagnostic-deadlock.test.js
 *
 * 诊断循环死锁硬编码检测（learning_id e8ecab79-68c7-4000-aac1-8230151c02a0）：
 * 诊断工具与被诊断工具共享 executor 时，诊断循环死锁是架构必然，
 * 必须在 dispatch 层硬编码拒绝派发。
 *
 * 触发条件（4 项必须同时满足）：
 *   1. 待派发任务 task_type ∈ DIAGNOSTIC_TASK_TYPES
 *   2. metadata.target_task_id 指向另一任务
 *   3. target task 当前 status='in_progress'
 *   4. target task 与本任务路由到同一 executor location（共享 executor）
 *
 * 任意条件不满足 → 不视为死锁，允许派发。
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const mockQuery = vi.hoisted(() => vi.fn());
vi.mock('../db.js', () => ({ default: { query: mockQuery } }));

let checkDiagnosticDeadlock, DIAGNOSTIC_TASK_TYPES;

beforeAll(async () => {
  vi.resetModules();
  const mod = await import('../diagnostic-deadlock.js');
  checkDiagnosticDeadlock = mod.checkDiagnosticDeadlock;
  DIAGNOSTIC_TASK_TYPES = mod.DIAGNOSTIC_TASK_TYPES;
});

describe('DIAGNOSTIC_TASK_TYPES 集合', () => {
  it('应包含核心诊断/审查类 task type', () => {
    expect(DIAGNOSTIC_TASK_TYPES.has('code_review')).toBe(true);
    expect(DIAGNOSTIC_TASK_TYPES.has('code_review_gate')).toBe(true);
    expect(DIAGNOSTIC_TASK_TYPES.has('arch_review')).toBe(true);
    expect(DIAGNOSTIC_TASK_TYPES.has('prd_review')).toBe(true);
    expect(DIAGNOSTIC_TASK_TYPES.has('spec_review')).toBe(true);
    expect(DIAGNOSTIC_TASK_TYPES.has('decomp_review')).toBe(true);
    expect(DIAGNOSTIC_TASK_TYPES.has('initiative_review')).toBe(true);
    expect(DIAGNOSTIC_TASK_TYPES.has('initiative_verify')).toBe(true);
    expect(DIAGNOSTIC_TASK_TYPES.has('audit')).toBe(true);
  });

  it('不应把普通执行类 task 误标为诊断类', () => {
    expect(DIAGNOSTIC_TASK_TYPES.has('dev')).toBe(false);
    expect(DIAGNOSTIC_TASK_TYPES.has('harness_initiative')).toBe(false);
    expect(DIAGNOSTIC_TASK_TYPES.has('intent_expand')).toBe(false);
    expect(DIAGNOSTIC_TASK_TYPES.has('content-pipeline')).toBe(false);
  });
});

describe('checkDiagnosticDeadlock — 死锁判定', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('非诊断 task → 不检查，无死锁', async () => {
    const task = {
      id: 'task-1',
      task_type: 'dev',
      metadata: { target_task_id: 'target-99' },
    };
    const result = await checkDiagnosticDeadlock(task);
    expect(result.deadlock).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('诊断 task 但 metadata 缺 target_task_id → 无死锁', async () => {
    const task = {
      id: 'task-2',
      task_type: 'code_review',
      metadata: {},
    };
    const result = await checkDiagnosticDeadlock(task);
    expect(result.deadlock).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('诊断 task metadata=null → 无死锁（容错）', async () => {
    const task = {
      id: 'task-2b',
      task_type: 'code_review',
      metadata: null,
    };
    const result = await checkDiagnosticDeadlock(task);
    expect(result.deadlock).toBe(false);
  });

  it('target task 已 completed → 无死锁', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'target-3', status: 'completed', task_type: 'dev' }],
    });
    const task = {
      id: 'task-3',
      task_type: 'code_review',
      metadata: { target_task_id: 'target-3' },
    };
    const result = await checkDiagnosticDeadlock(task);
    expect(result.deadlock).toBe(false);
  });

  it('target task 不存在 → 无死锁（孤儿引用不阻塞）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const task = {
      id: 'task-4',
      task_type: 'arch_review',
      metadata: { target_task_id: 'target-not-found' },
    };
    const result = await checkDiagnosticDeadlock(task);
    expect(result.deadlock).toBe(false);
  });

  it('target task in_progress 但不同 location → 无死锁（不共享 executor）', async () => {
    // arch_review 是 'us'，content-pipeline 是 'xian'，不同 location
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'target-5', status: 'in_progress', task_type: 'content-pipeline' }],
    });
    const task = {
      id: 'task-5',
      task_type: 'arch_review',
      metadata: { target_task_id: 'target-5' },
    };
    const result = await checkDiagnosticDeadlock(task);
    expect(result.deadlock).toBe(false);
  });

  it('target task in_progress 且同 location（共享 executor）→ 死锁', async () => {
    // code_review 和 dev 都路由到 'us'，共享 cecelia-run executor
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'target-6', status: 'in_progress', task_type: 'dev' }],
    });
    const task = {
      id: 'task-6',
      task_type: 'code_review',
      metadata: { target_task_id: 'target-6' },
    };
    const result = await checkDiagnosticDeadlock(task);
    expect(result.deadlock).toBe(true);
    expect(result.reason).toBe('diagnostic_deadlock_risk');
    expect(result.target_task_id).toBe('target-6');
    expect(result.location).toBe('us');
  });

  it('target task in_progress + 同 location，diagnostic 也是 us → 死锁（initiative_verify 对 dev）', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'target-7', status: 'in_progress', task_type: 'harness_initiative' }],
    });
    const task = {
      id: 'task-7',
      task_type: 'initiative_verify',
      metadata: { target_task_id: 'target-7' },
    };
    const result = await checkDiagnosticDeadlock(task);
    expect(result.deadlock).toBe(true);
    expect(result.target_task_id).toBe('target-7');
  });

  it('诊断 task 自指（target=自己）→ 死锁（最退化场景）', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'task-8', status: 'in_progress', task_type: 'code_review' }],
    });
    const task = {
      id: 'task-8',
      task_type: 'code_review',
      metadata: { target_task_id: 'task-8' },
    };
    const result = await checkDiagnosticDeadlock(task);
    expect(result.deadlock).toBe(true);
  });

  it('target task 状态为 queued → 无死锁（尚未占用 executor）', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'target-9', status: 'queued', task_type: 'dev' }],
    });
    const task = {
      id: 'task-9',
      task_type: 'code_review',
      metadata: { target_task_id: 'target-9' },
    };
    const result = await checkDiagnosticDeadlock(task);
    expect(result.deadlock).toBe(false);
  });
});
