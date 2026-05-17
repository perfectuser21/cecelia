/**
 * 验证：无任何 env flag 时，_dispatchViaWorkflowRuntime 派 task_type=dev
 * 任务走 v2 workflow runtime（runWorkflow），不再 fall through 到 legacy。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = {
  runWorkflow: vi.fn(),
  triggerCeceliaRun: vi.fn(),
  recordDispatchResult: vi.fn(),
  emit: vi.fn(),
  logTickDecision: vi.fn(),
};

vi.mock('../orchestrator/graph-runtime.js', () => ({
  runWorkflow: mocks.runWorkflow,
}));
vi.mock('../tick-state.js', () => ({
  recordDispatchResult: mocks.recordDispatchResult,
}));
vi.mock('../event-bus.js', () => ({
  emit: mocks.emit,
}));
vi.mock('../tick-status.js', () => ({
  logTickDecision: mocks.logTickDecision,
}));

describe('dispatcher default LangGraph routing', () => {
  let originalEnv;
  beforeEach(() => {
    originalEnv = process.env.WORKFLOW_RUNTIME;
    delete process.env.WORKFLOW_RUNTIME;
    Object.values(mocks).forEach((m) => m.mockReset?.());
    mocks.runWorkflow.mockResolvedValue({ result: { ok: true } });
  });
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.WORKFLOW_RUNTIME;
    else process.env.WORKFLOW_RUNTIME = originalEnv;
  });

  it('无 env flag + task_type=dev → runWorkflow 被调（默认 v2）', async () => {
    const { _dispatchViaWorkflowRuntime } = await import('../dispatcher.js');
    const task = { id: 'task-default', task_type: 'dev', title: 'default-route', retry_count: 0 };
    const result = await _dispatchViaWorkflowRuntime(task);
    expect(result.handled).toBe(true);
    expect(result.runtime).toBe('v2');
    expect(mocks.runWorkflow).toHaveBeenCalledWith('dev-task', 'task-default', 1, { task });
  });

  it('无 env flag + task_type=harness_initiative → handled:false（dispatcher 只接 dev）', async () => {
    const { _dispatchViaWorkflowRuntime } = await import('../dispatcher.js');
    const task = { id: 'task-init', task_type: 'harness_initiative', title: 'init', retry_count: 0 };
    const result = await _dispatchViaWorkflowRuntime(task);
    expect(result).toEqual({ handled: false });
    expect(mocks.runWorkflow).not.toHaveBeenCalled();
  });
});
