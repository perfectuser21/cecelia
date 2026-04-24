/**
 * Brain v2 Phase C6: tick.js WORKFLOW_RUNTIME env gate 单测。
 *
 * 验证 task_type=dev 时：
 *  - env 未设 / v1 → legacy triggerCeceliaRun 被调
 *  - env=v2 → runWorkflow('dev-task', taskId, attemptN, {task}) 被调，triggerCeceliaRun 不调
 *  - attemptN 从 retry_count / payload.attempt_n 计算 +1
 *  - env=v2 但 task_type != dev → legacy 被调（flag 只影响 dev）
 *
 * 用 vi.hoisted() 建 mock（C2 learning：裸对象引 top-level 会被 vitest hoist 打爆）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  triggerCeceliaRun: vi.fn(),
  runWorkflow: vi.fn(),
  logTickDecision: vi.fn(),
  recordDispatchResult: vi.fn(),
  emit: vi.fn(),
}));

vi.mock('../executor.js', () => ({
  triggerCeceliaRun: mocks.triggerCeceliaRun,
  checkCeceliaRunAvailable: vi.fn().mockResolvedValue({ available: true }),
  killProcess: vi.fn(),
  checkServerResources: vi.fn(),
  probeTaskLiveness: vi.fn(),
  killProcessTwoStage: vi.fn(),
  requeueTask: vi.fn(),
  MAX_SEATS: 2,
  INTERACTIVE_RESERVE: 0,
  getBillingPause: vi.fn().mockReturnValue({ active: false }),
}));

vi.mock('../orchestrator/graph-runtime.js', () => ({
  runWorkflow: mocks.runWorkflow,
}));

vi.mock('../dispatch-stats.js', () => ({
  recordDispatchResult: mocks.recordDispatchResult,
}));

vi.mock('../event-bus.js', () => ({
  emit: mocks.emit,
}));

describe('tick.js WORKFLOW_RUNTIME env gate (C6)', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = process.env.WORKFLOW_RUNTIME;
    Object.values(mocks).forEach((m) => m.mockReset?.());
    mocks.triggerCeceliaRun.mockResolvedValue({ success: true, runId: 'legacy-run' });
    mocks.runWorkflow.mockResolvedValue({ result: { ok: true } });
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.WORKFLOW_RUNTIME;
    else process.env.WORKFLOW_RUNTIME = originalEnv;
  });

  it('env 未设 + task_type=dev → legacy triggerCeceliaRun 被调', async () => {
    delete process.env.WORKFLOW_RUNTIME;
    const { _dispatchViaWorkflowRuntime } = await import('../tick.js');
    const task = { id: 'task-aaa', task_type: 'dev', title: 'hello', retry_count: 0 };
    const result = await _dispatchViaWorkflowRuntime(task);
    expect(result).toEqual({ handled: false });
    expect(mocks.runWorkflow).not.toHaveBeenCalled();
  });

  it('env=v1 + task_type=dev → legacy 被调（显式 v1）', async () => {
    process.env.WORKFLOW_RUNTIME = 'v1';
    const { _dispatchViaWorkflowRuntime } = await import('../tick.js');
    const task = { id: 'task-bbb', task_type: 'dev', title: 'hello', retry_count: 0 };
    const result = await _dispatchViaWorkflowRuntime(task);
    expect(result).toEqual({ handled: false });
    expect(mocks.runWorkflow).not.toHaveBeenCalled();
  });

  it('env=v2 + task_type=dev → runWorkflow 被调 fire-and-forget，attemptN=1', async () => {
    process.env.WORKFLOW_RUNTIME = 'v2';
    const { _dispatchViaWorkflowRuntime } = await import('../tick.js');
    const task = { id: 'task-ccc', task_type: 'dev', title: 'v2-smoke', retry_count: 0 };
    const result = await _dispatchViaWorkflowRuntime(task);
    expect(result.handled).toBe(true);
    expect(result.runtime).toBe('v2');
    expect(mocks.runWorkflow).toHaveBeenCalledTimes(1);
    expect(mocks.runWorkflow).toHaveBeenCalledWith(
      'dev-task',
      'task-ccc',
      1,
      { task },
    );
    expect(mocks.triggerCeceliaRun).not.toHaveBeenCalled();
    expect(mocks.recordDispatchResult).toHaveBeenCalledWith(expect.anything(), true, 'workflow_runtime_v2');
    expect(mocks.emit).toHaveBeenCalledWith(
      'task_dispatched',
      'tick',
      expect.objectContaining({ task_id: 'task-ccc', runtime: 'v2', success: true }),
    );
  });

  it('env=v2 + task_type=dev + retry_count=2 → attemptN=3', async () => {
    process.env.WORKFLOW_RUNTIME = 'v2';
    const { _dispatchViaWorkflowRuntime } = await import('../tick.js');
    const task = { id: 'task-ddd', task_type: 'dev', title: 'retry', retry_count: 2 };
    await _dispatchViaWorkflowRuntime(task);
    expect(mocks.runWorkflow).toHaveBeenCalledWith(
      'dev-task',
      'task-ddd',
      3,
      { task },
    );
  });

  it('env=v2 + task_type=harness_initiative → legacy 被调（flag 仅影响 dev）', async () => {
    process.env.WORKFLOW_RUNTIME = 'v2';
    const { _dispatchViaWorkflowRuntime } = await import('../tick.js');
    const task = { id: 'task-eee', task_type: 'harness_initiative', title: 'harness', retry_count: 0 };
    const result = await _dispatchViaWorkflowRuntime(task);
    expect(result).toEqual({ handled: false });
    expect(mocks.runWorkflow).not.toHaveBeenCalled();
  });
});
