/**
 * executor-route-override.test.js — phase 2 单元 1
 *
 * 验证 triggerCeceliaRun 顶部的显式 override 分支（REVIEW 短路之后、location 路由之前）：
 *   - payload.executor=codex + machine=xian-m4 → triggerCodexBridge(task, route.url)
 *     （断言：fetch 被调到 route.url/run；走 codex-bridge，不进 US claude 路径）
 *   - payload.executor=claude → 不调 codex bridge，落 US Claude 默认路径
 *     （断言：fetch 没被调到 codex /run；进入 US claude（traceStep 被调））
 *   - resolveExecutor 抛错 → 任务标 failed + 不派发
 *     （断言：updateTaskStatus(task.id,'failed',...) 被调；fetch / traceStep 都没被调）
 *   - 无 payload.machine/executor → 现有 location 路由完全不变（回归保护）
 *     （location='xian' → triggerCodexBridge(task)；默认 → US claude）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── 注入 resolveExecutor（单元 1 的核心依赖，可控返回 / 抛错）─────────
const resolveExecutorMock = vi.fn();
const ExecutorRouteErrorMock = class ExecutorRouteError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ExecutorRouteError';
  }
};
vi.mock('../routing/resolve-executor.js', () => ({
  resolveExecutor: (...args) => resolveExecutorMock(...args),
  ExecutorRouteError: ExecutorRouteErrorMock,
  FALLBACK_ROUTE: { machineId: 'mac-mini-m4-us', executor: 'claude', url: 'http://localhost:3457' },
}));

// ── 任务状态写回（断言 failed loud-fail 用）────────────────────────
const updateTaskStatusMock = vi.fn(async () => {});
vi.mock('../task-updater.js', () => ({
  updateTaskStatus: (...args) => updateTaskStatusMock(...args),
  updateTaskProgress: vi.fn(),
}));

// ── task-router：默认 location='us'，可被单测覆写 ──────────────────
const getTaskLocationMock = vi.fn(() => 'us');
// Slice5: internal task handler 路由（默认 null=非 internal，不影响现有路径）
const getInternalTaskHandlerMock = vi.fn(() => null);
vi.mock('../task-router.js', () => ({
  getTaskLocation: (...args) => getTaskLocationMock(...args),
  getInternalTaskHandler: (...args) => getInternalTaskHandlerMock(...args),
  TASK_REQUIREMENTS: {},
}));

// ── task-type-config-cache：默认无动态配置（走 hardcoded LOCATION_MAP）─
vi.mock('../task-type-config-cache.js', () => ({
  loadCache: vi.fn(),
  refreshCache: vi.fn(),
  getCachedLocation: vi.fn(() => null),
  getCachedConfig: vi.fn(() => null),
}));

// ── trace：US claude 路径入口标记（traceStep 被调 = 进了 US claude）──
const traceStartMock = vi.fn(async () => {});
const traceEndMock = vi.fn(async () => {});
const traceStepMock = vi.fn(() => ({ start: traceStartMock, end: traceEndMock }));
vi.mock('../trace.js', () => ({
  traceStep: (...args) => traceStepMock(...args),
  LAYER: { L0_ORCHESTRATOR: 'l0' },
  STATUS: { FAILED: 'failed', SUCCESS: 'success' },
  EXECUTOR_HOSTS: { US_VPS: 'us', HK: 'hk' },
}));

// ── codex bridge 旁路依赖（让 triggerCodexBridge 能直达 fetch）──────
vi.mock('../decisions-context.js', () => ({ getDecisionsSummary: vi.fn(async () => '') }));
vi.mock('../db.js', () => ({ default: { query: vi.fn(async () => ({ rows: [] })) } }));

// 其余 executor.js 顶层副作用依赖最小化 mock
vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({ on: vi.fn(), unref: vi.fn(), pid: 12345, stdout: { on: vi.fn() }, stderr: { on: vi.fn() } })),
  execSync: vi.fn(() => ''),
  exec: vi.fn(),
}));
vi.mock('fs/promises', () => ({ writeFile: vi.fn(), mkdir: vi.fn(), access: vi.fn() }));

describe('triggerCeceliaRun: 显式 executor override 分支（phase 2 单元 1）', () => {
  let triggerCeceliaRun;
  let fetchMock;

  beforeEach(async () => {
    vi.clearAllMocks();
    getTaskLocationMock.mockReturnValue('us');
    getInternalTaskHandlerMock.mockReturnValue(null);

    // fetch：codex bridge /run 命中此 mock；US claude 不走 fetch
    fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, account: 'team3' }) }));
    vi.stubGlobal('fetch', fetchMock);

    const executor = await import('../executor.js');
    triggerCeceliaRun = executor.triggerCeceliaRun;
  });

  // 找出所有打到「/run」（codex bridge 入口）的 fetch 调用
  function codexFetchCalls() {
    return fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/run'));
  }

  it('codex override（machine=xian-m4, executor=codex）→ triggerCodexBridge(task, route.url)', async () => {
    resolveExecutorMock.mockResolvedValue({
      machineId: 'xian-m4',
      executor: 'codex',
      url: 'http://100.86.57.69:13458',
    });
    const task = {
      id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      task_type: 'codex_dev',
      title: 't',
      payload: { machine: 'xian-m4', executor: 'codex' },
    };

    const res = await triggerCeceliaRun(task);

    // resolveExecutor 被这条 task 调用
    expect(resolveExecutorMock).toHaveBeenCalledWith(task);
    // 走了 codex-bridge（不是 US claude）
    expect(res.executor).toBe('codex-bridge');
    // fetch 打到 route.url（而非默认 xian bridge），即 triggerCodexBridge(task, route.url)
    const calls = codexFetchCalls();
    expect(calls.length).toBe(1);
    expect(String(calls[0][0])).toBe('http://100.86.57.69:13458/run');
    // 没进 US claude 路径
    expect(traceStepMock).not.toHaveBeenCalled();
  });

  it('claude override（executor=claude）→ 不调 codex bridge，落 US Claude 默认路径', async () => {
    resolveExecutorMock.mockResolvedValue({
      machineId: 'mac-mini-m4-us',
      executor: 'claude',
      url: 'http://localhost:3457',
    });
    const task = {
      id: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff',
      task_type: 'dev',
      title: 't',
      payload: { machine: 'mac-mini-m4-us', executor: 'claude' },
    };

    await triggerCeceliaRun(task);

    expect(resolveExecutorMock).toHaveBeenCalledWith(task);
    // 没有任何 codex bridge /run 调用
    expect(codexFetchCalls().length).toBe(0);
    // 进入 US claude 默认路径（traceStep 在 US claude 块最前面被调）
    expect(traceStepMock).toHaveBeenCalled();
    // 不应被标 failed
    expect(updateTaskStatusMock).not.toHaveBeenCalledWith(
      task.id, 'failed', expect.anything(),
    );
  });

  it('resolveExecutor 抛错 → 任务标 failed + 不派发（loud-fail, terminal）', async () => {
    resolveExecutorMock.mockRejectedValue(
      new ExecutorRouteErrorMock("显式路由失败：机器 'xian-m4' 未部署 executor 'claude'"),
    );
    const task = {
      id: 'cccccccc-dddd-eeee-ffff-000000000000',
      task_type: 'dev',
      title: 't',
      payload: { machine: 'xian-m4', executor: 'claude' },
    };

    const res = await triggerCeceliaRun(task);

    // 标 failed（loud-fail）
    expect(updateTaskStatusMock).toHaveBeenCalledWith(
      task.id, 'failed', expect.objectContaining({ error_message: expect.stringContaining('executor route') }),
    );
    // 既没派 codex 也没进 US claude
    expect(codexFetchCalls().length).toBe(0);
    expect(traceStepMock).not.toHaveBeenCalled();
    // [BLOCKER 2] terminal：返回 success:true（dispatcher 见 success → 不回退 queued、不污染熔断器），
    // 但带 failed 标记，executor 已把任务标 failed。
    expect(res.success).toBe(true);
    expect(res.failed).toBe(true);
    expect(res.executor).toBe('route-rejected');
    expect(res.taskId).toBe(task.id);
  });

  it('[BLOCKER 1] claude override + getTaskLocation=xian → 短路 location 路由，落 US claude（不被西安劫持）', async () => {
    // 天然 location='xian' 的 task_type（如 codex_dev/explore），显式 payload.executor='claude'
    // 必须落 US claude，绝不能被下方 if(location==='xian') 二次劫持送到西安 codex。
    resolveExecutorMock.mockResolvedValue({
      machineId: 'mac-mini-m4-us',
      executor: 'claude',
      url: 'http://localhost:3457',
    });
    getTaskLocationMock.mockReturnValue('xian'); // 天然西安，但显式要 claude
    const task = {
      id: 'ffffffff-0000-1111-2222-333333333333',
      task_type: 'codex_dev',
      title: 't',
      payload: { machine: 'mac-mini-m4-us', executor: 'claude' },
    };

    await triggerCeceliaRun(task);

    expect(resolveExecutorMock).toHaveBeenCalledWith(task);
    // 关键断言：codex bridge 完全没被调（没被西安劫持）
    expect(codexFetchCalls().length).toBe(0);
    // 落到 US claude 默认派发
    expect(traceStepMock).toHaveBeenCalled();
    expect(updateTaskStatusMock).not.toHaveBeenCalledWith(
      task.id, 'failed', expect.anything(),
    );
  });

  it('[MINOR 3] harness_initiative 带 payload.executor → 仍走 harness graph，不进 override 分支', async () => {
    // harness 任务误传 payload.executor 不能绕过 harness graph。
    const task = {
      id: '11111111-2222-3333-4444-555555555555',
      task_type: 'harness_initiative',
      title: 't',
      payload: { executor: 'codex', machine: 'xian-m4' },
    };

    const res = await triggerCeceliaRun(task);

    // override 分支被排除：resolveExecutor 不被调
    expect(resolveExecutorMock).not.toHaveBeenCalled();
    // 走 harness graph（runHarnessInitiativeRouter 在本测试环境会抛错被 catch，
    // 但返回 success:true + initiative:true 是 harness 块的标志）
    expect(res.initiative).toBe(true);
  });

  it('无 payload.machine/executor → location=xian 仍 triggerCodexBridge（默认 xian bridge），不调 resolveExecutor（回归保护）', async () => {
    getTaskLocationMock.mockReturnValue('xian');
    const task = {
      id: 'dddddddd-eeee-ffff-0000-111111111111',
      task_type: 'codex_dev',
      title: 't',
      payload: {},
    };

    const res = await triggerCeceliaRun(task);

    // override 分支被跳过
    expect(resolveExecutorMock).not.toHaveBeenCalled();
    // location-map 路由：走 codex bridge（默认 xian bridge url，未带 route.url）
    expect(res.executor).toBe('codex-bridge');
    expect(codexFetchCalls().length).toBe(1);
    expect(traceStepMock).not.toHaveBeenCalled();
  });

  it('无 payload → 默认 location=us 仍走 US Claude（traceStep 被调），不调 resolveExecutor（回归保护）', async () => {
    getTaskLocationMock.mockReturnValue('us');
    const task = {
      id: 'eeeeeeee-ffff-0000-1111-222222222222',
      task_type: 'dev',
      title: 't',
      payload: {},
    };

    await triggerCeceliaRun(task);

    expect(resolveExecutorMock).not.toHaveBeenCalled();
    expect(codexFetchCalls().length).toBe(0);
    expect(traceStepMock).toHaveBeenCalled();
  });

  // Slice5: internal task handler 内联短路 —— harness_intervention 等注册的 internal type 被
  // pick up 后直接在 brain 内跑 handler，不当普通任务派 claude/codex（否则整条死代码）。
  it('Slice5: internal type（harness_intervention）→ 内联 handler 短路，传 deps.updateTaskResult，不走 location 派发', async () => {
    const handlerSpy = vi.fn(async () => ({ action: 'alert' }));
    getInternalTaskHandlerMock.mockReturnValue(handlerSpy);
    const task = {
      id: '99999999-aaaa-bbbb-cccc-dddddddddddd',
      task_type: 'harness_intervention',
      title: 't',
      payload: { container_id: 'harness-task-x-r0-abcd' },
    };

    const res = await triggerCeceliaRun(task);

    // getInternalTaskHandler 用 task_type 查
    expect(getInternalTaskHandlerMock).toHaveBeenCalledWith('harness_intervention');
    // handler 被内联调用
    expect(handlerSpy).toHaveBeenCalledTimes(1);
    expect(handlerSpy.mock.calls[0][0]).toBe(task);
    // 必须传 deps.updateTaskResult（否则 handleIntervention 无法写 task.result）
    const deps = handlerSpy.mock.calls[0][1];
    expect(typeof deps.updateTaskResult).toBe('function');
    // 没走 location 派发（不进 US claude，不调 codex bridge）
    expect(traceStepMock).not.toHaveBeenCalled();
    expect(codexFetchCalls().length).toBe(0);
    expect(res.internal).toBe(true);
  });

  it('Slice5: 非 internal type（dev）→ getInternalTaskHandler 返回 null，正常走 location 路由（回归保护）', async () => {
    getInternalTaskHandlerMock.mockReturnValue(null);
    getTaskLocationMock.mockReturnValue('us');
    const task = {
      id: '88888888-aaaa-bbbb-cccc-dddddddddddd',
      task_type: 'dev',
      title: 't',
      payload: {},
    };

    await triggerCeceliaRun(task);

    // 走正常 US claude 路径
    expect(traceStepMock).toHaveBeenCalled();
  });
});
