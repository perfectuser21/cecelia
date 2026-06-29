import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawnNode } from '../../../../packages/brain/src/workflows/harness-task.graph.js';

// ws2 [MAJOR #2 重写]：旧版断言 HARNESS_XIAN_ENABLED 全局开关行为，开关已删除。
// 改写成 resolveExecutor 路由断言（DI 注入 route），覆盖：
//   - route.executor=codex → spawnBridge 被调用（route.url+'/run'），spawnDetached 未调用
//   - route.executor=claude（默认）→ spawnDetached 被调用，spawnBridge 未调用
//   - codex 路由 spawnBridge 抛错 → loud-fail（返回 error，不偷偷降级到 docker/美国）[#5]
// 删除：HARNESS_XIAN 字面量 ARTIFACT 断言（开关已不存在）。

function makeState(overrides = {}) {
  return {
    task: { id: 'ws2', title: 'Test task', task_type: 'harness_task', payload: { sprint_dir: 'sprints/xian-branch-test' } },
    initiativeId: 'init-test-001',
    githubToken: 'gh-mock-token',
    worktreePath: '/mock-wt',
    fix_round: 0,
    contractBranch: null,
    contractImported: false,
    ...overrides,
  };
}

function makeOpts(overrides = {}) {
  return {
    ensureWorktree: vi.fn(async () => '/mock-wt'),
    spawnDetached: vi.fn(async () => ({ exit_code: 0 })),
    resolveToken: vi.fn(async () => 'gh-mock-token'),
    poolOverride: { query: vi.fn().mockResolvedValue({ rows: [] }) },
    execFile: vi.fn(async () => ({ stdout: '', stderr: '' })),
    ...overrides,
  };
}

// 路由 DI：直接注入 resolveExecutor 返回值，绕开 DB。
function routeTo(executor, url = 'http://host.docker.internal:13458') {
  return vi.fn(async () => ({ machineId: executor === 'codex' ? 'xian-m4' : 'mac-mini-m4-us', executor, url }));
}

describe('spawnNode 机器+执行器路由（resolveExecutor 收编）[BEHAVIOR]', () => {
  beforeEach(() => {
    delete process.env.HARNESS_XIAN_ENABLED;
    delete process.env.HARNESS_XIAN_BRIDGE_URL;
  });

  afterEach(() => {
    delete process.env.HARNESS_XIAN_ENABLED;
    delete process.env.HARNESS_XIAN_BRIDGE_URL;
  });

  it('route.executor=claude（默认）→ spawnDetached 被调用，spawnBridge 未调用', async () => {
    const spawnBridge = vi.fn(async () => ({ status: 'accepted', job_id: 'job-001' }));
    const opts = makeOpts({ spawnBridge, resolveExecutor: routeTo('claude', 'http://localhost:3457') });

    await spawnNode(makeState(), opts);

    expect(opts.spawnDetached).toHaveBeenCalledOnce();
    expect(spawnBridge).not.toHaveBeenCalled();
  });

  it('route.executor=codex → spawnBridge 被调用，spawnDetached 未调用', async () => {
    const spawnBridge = vi.fn(async () => ({ status: 'accepted', job_id: 'job-002' }));
    const opts = makeOpts({ spawnBridge, resolveExecutor: routeTo('codex') });

    await spawnNode(makeState(), opts);

    expect(spawnBridge).toHaveBeenCalledOnce();
    expect(opts.spawnDetached).not.toHaveBeenCalled();
  });

  it('route.executor=codex → spawnBridge 第一参数为 route.url + "/run"', async () => {
    const url = 'http://100.86.57.69:13458';
    const spawnBridge = vi.fn(async () => ({ status: 'accepted', job_id: 'job-003' }));
    const opts = makeOpts({ spawnBridge, resolveExecutor: routeTo('codex', url) });

    await spawnNode(makeState(), opts);

    const [firstArg] = spawnBridge.mock.calls[0];
    expect(firstArg).toBe(`${url}/run`);
  });

  it('route.executor=codex → spawnBridge payload 的 callback_url 含 containerId', async () => {
    const spawnBridge = vi.fn(async () => ({ status: 'accepted', job_id: 'job-004' }));
    const opts = makeOpts({ spawnBridge, resolveExecutor: routeTo('codex') });

    const result = await spawnNode(makeState(), opts);

    const [, payload] = spawnBridge.mock.calls[0];
    expect(typeof payload.callback_url).toBe('string');
    expect(payload.callback_url).toContain(result.containerId);
    expect(payload.mode).toBe('codex');
  });

  it('route.executor=codex，spawnBridge 抛错 → loud-fail（返回 error，不降级到 docker/美国）[#5]', async () => {
    const spawnBridge = vi.fn(async () => { throw new Error('Connection refused'); });
    const opts = makeOpts({ spawnBridge, resolveExecutor: routeTo('codex') });

    const result = await spawnNode(makeState(), opts);

    expect(spawnBridge).toHaveBeenCalledOnce();
    // loud-fail：显式 codex 路由失败 → 任务 failed，不偷偷 fallback spawnDetached
    expect(opts.spawnDetached).not.toHaveBeenCalled();
    expect(result.error).toBeDefined();
    expect(result.error.node).toBe('spawn');
  });

  it('显式 payload {machine:xian-m4, executor:codex} 经默认 resolveExecutor 路由（DI 假 DB）→ codex 分支', async () => {
    // 用真 resolveExecutor + 注入假 loadMachines，验证显式 payload 一路打到 codex 分支。
    const { resolveExecutor } = await import('../../../../packages/brain/src/routing/resolve-executor.js');
    const fakeMachines = [
      { name: 'xian-m4', status: 'active', metadata: { tags: ['general'], executors: [{ executor: 'codex', url: 'http://host.docker.internal:13458', default: true }] } },
    ];
    const resolveExec = (task) => resolveExecutor(task, {
      loadMachines: async () => fakeMachines,
      taskRequirements: { harness_task: ['general'] },
      selectLoadBalanced: async (c) => c[0],
    });
    const spawnBridge = vi.fn(async () => ({ status: 'accepted', job_id: 'job-005' }));
    const opts = makeOpts({ spawnBridge, resolveExecutor: resolveExec });
    const state = makeState({ task: { id: 'ws2', task_type: 'harness_task', payload: { machine: 'xian-m4', executor: 'codex' } } });

    await spawnNode(state, opts);

    expect(spawnBridge).toHaveBeenCalledOnce();
    expect(opts.spawnDetached).not.toHaveBeenCalled();
    const [firstArg] = spawnBridge.mock.calls[0];
    expect(firstArg).toBe('http://host.docker.internal:13458/run');
  });
});
