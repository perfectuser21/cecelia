/**
 * resolveExecutor 单元测试（Unit 2 of machine-executor-routing 设计）
 *
 * 注入假 machines，覆盖 spec 测试策略：
 *   - 显式合法组合
 *   - 显式非法组合（机器无此 executor / 机器非 active）→ 抛 ExecutorRouteError
 *   - 半显式机器（只给 machine → 用 default executor）
 *   - 半显式执行器（只给 executor → 负载策略选一台拥有该 executor 的机器）
 *   - 能力标签默认（都没给 → TASK_REQUIREMENTS 标签 → 机器 default executor）
 *   - 无匹配兜底 → us-m4 / claude
 *   - DB 读取失败 → 降级 us-m4 / claude
 *
 * Spec: docs/superpowers/specs/2026-06-03-machine-executor-routing-design.md §单元2 + 错误处理 + 测试策略
 */
import { describe, it, expect, vi } from 'vitest';
import { resolveExecutor, ExecutorRouteError, FALLBACK_ROUTE } from './resolve-executor.js';

// 假 machines（system_registry type=machine status=active 形态）
const FAKE_MACHINES = [
  {
    name: 'mac-mini-m4-us',
    status: 'active',
    metadata: {
      tags: ['has_git', 'general'],
      executors: [
        { executor: 'claude', url: 'http://localhost:3457', default: true },
      ],
    },
  },
  {
    name: 'xian-m4',
    status: 'active',
    metadata: {
      tags: ['general'],
      executors: [
        { executor: 'codex', url: 'http://host.docker.internal:13458', default: true },
      ],
    },
  },
  {
    name: 'xian-m1',
    status: 'active',
    metadata: {
      tags: ['general'],
      executors: [
        { executor: 'codex', url: 'http://host.docker.internal:13459', default: true },
      ],
    },
  },
];

function makeDeps(overrides = {}) {
  return {
    loadMachines: vi.fn().mockResolvedValue(FAKE_MACHINES),
    taskRequirements: {
      dev: ['has_git'],
      codex_qa: ['general'],
    },
    // 半显式 executor / 多候选时的负载选择 — 默认选第一个（确定性，便于断言）
    selectLoadBalanced: vi.fn(async (candidates) => candidates[0]),
    ...overrides,
  };
}

describe('resolveExecutor — 显式 {machine, executor}', () => {
  it('合法组合 → 返回 {machineId, executor, url}', async () => {
    const route = await resolveExecutor(
      { task_type: 'dev', payload: { machine: 'xian-m4', executor: 'codex' } },
      makeDeps(),
    );
    expect(route).toEqual({
      machineId: 'xian-m4',
      executor: 'codex',
      url: 'http://host.docker.internal:13458',
    });
  });

  it('机器存在但无此 executor 组合 → 抛 ExecutorRouteError', async () => {
    await expect(
      resolveExecutor(
        { task_type: 'dev', payload: { machine: 'mac-mini-m4-us', executor: 'codex' } },
        makeDeps(),
      ),
    ).rejects.toThrow(ExecutorRouteError);
  });

  it('机器不存在 → 抛 ExecutorRouteError', async () => {
    await expect(
      resolveExecutor(
        { task_type: 'dev', payload: { machine: 'no-such-machine', executor: 'codex' } },
        makeDeps(),
      ),
    ).rejects.toThrow(ExecutorRouteError);
  });

  it('机器非 active → 抛 ExecutorRouteError（不静默改派）', async () => {
    const deps = makeDeps({
      loadMachines: vi.fn().mockResolvedValue([
        { name: 'xian-m4', status: 'offline', metadata: { tags: ['general'], executors: [{ executor: 'codex', url: 'u', default: true }] } },
      ]),
    });
    await expect(
      resolveExecutor(
        { task_type: 'dev', payload: { machine: 'xian-m4', executor: 'codex' } },
        deps,
      ),
    ).rejects.toThrow(ExecutorRouteError);
  });
});

describe('resolveExecutor — 半显式', () => {
  it('只给 machine → 用该机器 default executor', async () => {
    const route = await resolveExecutor(
      { task_type: 'dev', payload: { machine: 'xian-m4' } },
      makeDeps(),
    );
    expect(route).toEqual({
      machineId: 'xian-m4',
      executor: 'codex',
      url: 'http://host.docker.internal:13458',
    });
  });

  it('只给 machine 但机器非 active → 抛 ExecutorRouteError', async () => {
    const deps = makeDeps({
      loadMachines: vi.fn().mockResolvedValue([
        { name: 'xian-m4', status: 'offline', metadata: { tags: ['general'], executors: [{ executor: 'codex', url: 'u', default: true }] } },
      ]),
    });
    await expect(
      resolveExecutor({ task_type: 'dev', payload: { machine: 'xian-m4' } }, deps),
    ).rejects.toThrow(ExecutorRouteError);
  });

  it('只给 executor → 在拥有该 executor 的 active 机器里按负载策略选一台', async () => {
    const select = vi.fn(async (candidates) => candidates[candidates.length - 1]); // 选最后一个
    const route = await resolveExecutor(
      { task_type: 'dev', payload: { executor: 'codex' } },
      makeDeps({ selectLoadBalanced: select }),
    );
    // candidates = [xian-m4, xian-m1]，select 选最后一个 → xian-m1
    expect(select).toHaveBeenCalled();
    expect(route).toEqual({
      machineId: 'xian-m1',
      executor: 'codex',
      url: 'http://host.docker.internal:13459',
    });
  });

  it('只给 executor 但无机器拥有该 executor → 抛 ExecutorRouteError', async () => {
    await expect(
      resolveExecutor(
        { task_type: 'dev', payload: { executor: 'nonexistent-exec' } },
        makeDeps(),
      ),
    ).rejects.toThrow(ExecutorRouteError);
  });
});

describe('resolveExecutor — 能力标签默认', () => {
  it('都没给 + has_git 标签 → 选满足标签机器 + 其 default executor', async () => {
    const route = await resolveExecutor(
      { task_type: 'dev', payload: {} },
      makeDeps(),
    );
    // dev → has_git → 只有 mac-mini-m4-us → default claude
    expect(route).toEqual({
      machineId: 'mac-mini-m4-us',
      executor: 'claude',
      url: 'http://localhost:3457',
    });
  });

  it('general 标签 + 多机器 → 按负载策略选 + 其 default executor', async () => {
    const select = vi.fn(async (candidates) => candidates.find(m => m.name === 'xian-m4'));
    const route = await resolveExecutor(
      { task_type: 'codex_qa', payload: {} },
      makeDeps({ selectLoadBalanced: select }),
    );
    expect(select).toHaveBeenCalled();
    expect(route.machineId).toBe('xian-m4');
    expect(route.executor).toBe('codex');
  });

  it('payload 缺省（无 payload 字段）行为等价空 payload', async () => {
    const route = await resolveExecutor({ task_type: 'dev' }, makeDeps());
    expect(route.machineId).toBe('mac-mini-m4-us');
    expect(route.executor).toBe('claude');
  });
});

describe('resolveExecutor — 未知 task_type 不漂移到 codex 机器 [BLOCKER #1]', () => {
  // 回归：未知 task_type → requirements[task_type]||[] 空数组 → [].every() 恒 true →
  // 所有 active 机器都"满足" → 默认任务可能路由到 DB 第一台（xian codex 排前就跑去西安）。
  // 修复后：未知 task_type 对齐 legacy ['has_git']（小写查表）→ 只 us-m4 满足 → 必走 us-m4/claude。
  it('两台 active（us-m4=claude + xian-m4=codex），未知 task_type 无 payload → 必 resolve 到 us-m4/claude（不去西安）', async () => {
    // 故意把 xian-m4 排在 DB 第一位：若 bug 存在会被负载策略选中
    const deps = makeDeps({
      loadMachines: vi.fn().mockResolvedValue([
        { name: 'xian-m4', status: 'active', metadata: { tags: ['general'], executors: [{ executor: 'codex', url: 'http://host.docker.internal:13458', default: true }] } },
        { name: 'mac-mini-m4-us', status: 'active', metadata: { tags: ['has_git', 'general'], executors: [{ executor: 'claude', url: 'http://localhost:3457', default: true }] } },
      ]),
      taskRequirements: { dev: ['has_git'] }, // harness_task 不在表里 → 未知
      // 选第一个：若 requiredTags=[] 让两台都进 candidates，会错选 xian-m4
      selectLoadBalanced: vi.fn(async (candidates) => candidates[0]),
    });
    const route = await resolveExecutor({ task_type: 'harness_task', payload: {} }, deps);
    expect(route.machineId).toBe('mac-mini-m4-us');
    expect(route.executor).toBe('claude');
  });

  it('未知 task_type 大小写混合（HARNESS_TASK）也对齐小写 has_git → us-m4', async () => {
    const deps = makeDeps({
      loadMachines: vi.fn().mockResolvedValue([
        { name: 'xian-m4', status: 'active', metadata: { tags: ['general'], executors: [{ executor: 'codex', url: 'u', default: true }] } },
        { name: 'mac-mini-m4-us', status: 'active', metadata: { tags: ['has_git', 'general'], executors: [{ executor: 'claude', url: 'http://localhost:3457', default: true }] } },
      ]),
      taskRequirements: { dev: ['has_git'] },
      selectLoadBalanced: vi.fn(async (candidates) => candidates[0]),
    });
    const route = await resolveExecutor({ task_type: 'HARNESS_TASK', payload: {} }, deps);
    expect(route.machineId).toBe('mac-mini-m4-us');
    expect(route.executor).toBe('claude');
  });
});

describe('resolveExecutor — 兜底 mac-mini-m4-us / claude', () => {
  it('未知 task_type 标签无匹配 → 兜底 mac-mini-m4-us / claude', async () => {
    // task_type 不在 taskRequirements 里 → 默认 ['has_git'] → 无满足机器 → 兜底
    const deps = makeDeps({
      loadMachines: vi.fn().mockResolvedValue([
        // 没有任何 has_git 机器，且没有 mac-mini-m4-us
        { name: 'xian-m4', status: 'active', metadata: { tags: ['general'], executors: [{ executor: 'codex', url: 'u', default: true }] } },
      ]),
      taskRequirements: { weird_type: ['has_browser'] },
    });
    const route = await resolveExecutor({ task_type: 'weird_type', payload: {} }, deps);
    expect(route).toEqual(FALLBACK_ROUTE);
    expect(route.machineId).toBe('mac-mini-m4-us');
    expect(route.executor).toBe('claude');
  });
});

describe('resolveExecutor — DB 失败降级', () => {
  it('loadMachines 抛错 → 降级 us-m4 / claude 兜底（不抛）', async () => {
    const deps = makeDeps({
      loadMachines: vi.fn().mockRejectedValue(new Error('db down')),
    });
    const route = await resolveExecutor({ task_type: 'dev', payload: {} }, deps);
    expect(route).toEqual(FALLBACK_ROUTE);
  });

  it('显式请求时 loadMachines 抛错 → 抛 ExecutorRouteError（不静默改派，spec line 83）[MAJOR #3]', async () => {
    // 有 payload.machine/executor = 显式偏好 → DB 挂时不能偷偷降级到美国，
    // 否则"我以为跑西安结果跑美国"。必须抛错让任务标 failed。
    const deps = makeDeps({
      loadMachines: vi.fn().mockRejectedValue(new Error('db down')),
    });
    await expect(
      resolveExecutor(
        { task_type: 'dev', payload: { machine: 'xian-m4', executor: 'codex' } },
        deps,
      ),
    ).rejects.toThrow(ExecutorRouteError);
  });

  it('只给 executor 的半显式请求 + loadMachines 抛错 → 同样抛 ExecutorRouteError [MAJOR #3]', async () => {
    const deps = makeDeps({
      loadMachines: vi.fn().mockRejectedValue(new Error('db down')),
    });
    await expect(
      resolveExecutor(
        { task_type: 'dev', payload: { executor: 'codex' } },
        deps,
      ),
    ).rejects.toThrow(ExecutorRouteError);
  });
});

describe('ExecutorRouteError', () => {
  it('是 Error 子类且带 name', () => {
    const err = new ExecutorRouteError('boom');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ExecutorRouteError');
    expect(err.message).toBe('boom');
  });
});
