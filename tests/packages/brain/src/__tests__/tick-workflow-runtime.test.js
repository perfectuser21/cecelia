/**
 * Phase C6: tick.js WORKFLOW_RUNTIME flag + dev-task runWorkflow
 *
 * 覆盖：
 *   1. env 未设 / v1 → 不走 runWorkflow（legacy 被调，由 dispatch 条件保证）
 *   2. env=v2 且 task_type=dev → dispatchDevTaskViaWorkflow 调 runWorkflow('dev-task', id, attemptN, { task })
 *   3. attemptN 计算：(retry_count || 0) + 1
 *   4. runWorkflow 失败 → console.error 记录，不抛、不中断 tick
 *   5. 源码层：tick.js 含 WORKFLOW_RUNTIME 判断 + runWorkflow 调用
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest';

const mockRunWorkflow = vi.fn();

// tick.js 通过 `./orchestrator/graph-runtime.js` 导入；Vitest 以被 mock 模块的
// 解析路径匹配，这里从测试文件所在目录出发指向同一 source。
vi.mock('../../../../../packages/brain/src/orchestrator/graph-runtime.js', () => ({
  runWorkflow: (...args) => mockRunWorkflow(...args),
}));

// tick.js 启动路径上 heavy deps 全部打桩，让 `import tick.js` 不触发副作用。
vi.mock('../../../../../packages/brain/src/db.js', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));
vi.mock('../../../../../packages/brain/src/executor.js', () => ({
  triggerCeceliaRun: vi.fn(),
  checkCeceliaRunAvailable: vi.fn().mockResolvedValue({ available: false }),
  killProcess: vi.fn(),
  checkServerResources: vi.fn().mockReturnValue({ ok: true, metrics: {} }),
  probeTaskLiveness: vi.fn(),
  killProcessTwoStage: vi.fn(),
  requeueTask: vi.fn(),
  MAX_SEATS: 4,
  INTERACTIVE_RESERVE: 2,
  getBillingPause: vi.fn(() => ({ active: false })),
}));

let dispatchDevTaskViaWorkflow;

beforeAll(async () => {
  const mod = await import('../../../../../packages/brain/src/tick.js');
  dispatchDevTaskViaWorkflow = mod.dispatchDevTaskViaWorkflow;
});

describe('Phase C6 — dispatchDevTaskViaWorkflow', () => {
  beforeEach(() => {
    mockRunWorkflow.mockReset();
    mockRunWorkflow.mockResolvedValue({ ok: true });
  });

  it('env=v2 → 调 runWorkflow("dev-task", task.id, attemptN, { task })', () => {
    const task = { id: 'task-abc', task_type: 'dev', retry_count: 2 };
    const res = dispatchDevTaskViaWorkflow(task);

    expect(mockRunWorkflow).toHaveBeenCalledTimes(1);
    expect(mockRunWorkflow).toHaveBeenCalledWith('dev-task', 'task-abc', 3, { task });
    expect(res.success).toBe(true);
    expect(res.runId).toContain('task-abc');
    expect(res.runId).toContain('a3');
  });

  it('attemptN = (retry_count || 0) + 1：retry_count 缺省时 attemptN=1', () => {
    dispatchDevTaskViaWorkflow({ id: 'task-new', task_type: 'dev' });
    expect(mockRunWorkflow).toHaveBeenCalledWith('dev-task', 'task-new', 1, expect.any(Object));
  });

  it('attemptN 递增：retry_count=5 → attemptN=6', () => {
    dispatchDevTaskViaWorkflow({ id: 'task-retry', task_type: 'dev', retry_count: 5 });
    expect(mockRunWorkflow).toHaveBeenCalledWith('dev-task', 'task-retry', 6, expect.any(Object));
  });

  it('runWorkflow 失败 → console.error 记录，不抛，不中断 tick', async () => {
    const err = new Error('workflow boom');
    mockRunWorkflow.mockRejectedValueOnce(err);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = dispatchDevTaskViaWorkflow({ id: 'task-fail', task_type: 'dev', retry_count: 0 });

    // fire-and-forget：同步返回 success
    expect(res.success).toBe(true);

    // 让 Promise 的 .catch 有机会 flush
    await new Promise((r) => setImmediate(r));

    expect(spy).toHaveBeenCalled();
    const msg = spy.mock.calls[0][0];
    expect(msg).toContain('task-fail');
    expect(msg).toContain('workflow boom');

    spy.mockRestore();
  });
});

describe('Phase C6 — tick.js 源码合同', () => {
  it('tick.js 含 WORKFLOW_RUNTIME flag + runWorkflow 调用', async () => {
    const fs = await import('node:fs');
    const url = new URL('../../../../../packages/brain/src/tick.js', import.meta.url);
    const src = fs.readFileSync(url, 'utf-8');
    expect(src).toContain('WORKFLOW_RUNTIME');
    expect(src).toContain('runWorkflow');
    expect(src).toContain("WORKFLOW_RUNTIME === 'v2'");
  });

  it('tick.js v2 分支调 dispatchDevTaskViaWorkflow；legacy 分支仍走 triggerCeceliaRun', async () => {
    const fs = await import('node:fs');
    const url = new URL('../../../../../packages/brain/src/tick.js', import.meta.url);
    const src = fs.readFileSync(url, 'utf-8');
    expect(src).toContain('dispatchDevTaskViaWorkflow(taskToDispatch)');
    expect(src).toContain('triggerCeceliaRun(taskToDispatch)');
  });
});
