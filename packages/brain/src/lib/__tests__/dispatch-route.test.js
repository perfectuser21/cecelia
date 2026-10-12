/**
 * 派发只认路由表（派发总闸 F，任务 0a70684f）。
 *
 * ① resolveDispatchRoute 按 executor 分支顺序判出每个类型的真实路由与执行者有无
 * ② 守卫：注册表 surface 必须与真实路由一致（talk/research/data 曾标 brain-internal 实走西安 bridge）
 * ③ 建单闸：queued + 无执行者 → 抛 no_executor_for_task_type；非 queued / 有头 不拦
 * ④ 借壳类型归一：research+factory_dispatch → skill_factory_run；data+coding_workflow → coding_workflow
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db.js', () => ({ default: { query: vi.fn() } }));

import {
  resolveDispatchRoute,
  assertTaskTypeHasExecutor,
  normalizeBorrowedTaskType,
  SURFACE_FOR_ROUTE,
  INTERNAL_HANDLER_TASK_TYPES,
  NO_EXECUTOR_FOR_TASK_TYPE,
} from '../dispatch-route.js';
import { TASK_TYPE_REGISTRY, TICK_DISPATCH_EXCLUDED, HEADLESS_KERNEL_RETIRED_TASK_TYPES, getTaskType } from '../task-type-registry.js';

const route = (task_type, payload = {}, opts) => resolveDispatchRoute({ task_type, payload }, opts);

describe('resolveDispatchRoute：按 executor 分支顺序判真实路由', () => {
  it('talk / research / data / explore / knowledge 走西安 Codex Bridge（有执行者）', () => {
    for (const t of ['talk', 'research', 'data', 'explore', 'knowledge']) {
      expect(route(t)).toMatchObject({ route: 'codex-bridge', available: true });
    }
  });

  it('dev / trigger_backup / content_publish / workflow_run 以 queued 无头派发落已退役 Claude 桥接 → 无执行者', () => {
    for (const t of ['dev', 'trigger_backup', 'content_publish', 'dept_heartbeat', 'strategist_decision']) {
      const r = route(t);
      expect(r.available, t).toBe(false);
      expect(r.route, t).toBe('claude-retired');
    }
  });

  it('workflow_run（外部起跑账本镜像）以 queued 建 → external-mirror 无执行者', () => {
    expect(route('workflow_run')).toMatchObject({ route: 'external-mirror', available: false });
  });

  it('退役 harness 子类型 → retired-harness 无执行者', () => {
    expect(route('harness_planner')).toMatchObject({ route: 'retired-harness', available: false });
  });

  it('有执行者的专用路由：kernel / openclaw / script / 审查池 / 内联 handler', () => {
    expect(route('golden_path_proposal')).toMatchObject({ route: 'kernel', available: true });
    expect(route('qiumi_task')).toMatchObject({ route: 'openclaw-agent', available: true });
    expect(route('script_run')).toMatchObject({ route: 'script', available: true });
    expect(route('code_review')).toMatchObject({ route: 'codex-review', available: true });
    expect(route('harness_intervention')).toMatchObject({ route: 'internal', available: true });
  });

  it('headed_manual（布尔或字符串）→ 执行者是有头会话，即使类型本身无执行者', () => {
    expect(route('dev', { headed_manual: 'true' })).toMatchObject({ route: 'headed', available: true });
    expect(route('dev', { headed_manual: true })).toMatchObject({ route: 'headed', available: true });
  });

  it('tick 不派的类型 → own-consumer（由专属消费方领单）', () => {
    expect(route('device_job')).toMatchObject({ route: 'own-consumer', available: true });
    expect(route('skill_factory_run')).toMatchObject({ route: 'own-consumer', available: true });
    expect(route('coding_workflow')).toMatchObject({ route: 'own-consumer', available: true });
  });

  it('动态配置把 us 类型改到 xian / executor=codex → 有执行者', () => {
    expect(route('dev', {}, { dynamic: { location: 'xian' } })).toMatchObject({ route: 'codex-bridge', available: true });
    expect(route('trigger_backup', {}, { dynamic: { location: 'us', executor: 'codex' } }).available).toBe(true);
  });

  it('显式 override：executor=claude 仍是退役通道；executor=codex 走指定机', () => {
    expect(route('dev', { executor: 'claude', machine: 'x' }).available).toBe(false);
    expect(route('dev', { executor: 'codex', machine: 'xian-m4' }).available).toBe(true);
  });

  it('未登记类型不抢 DB CHECK 的错误语义', () => {
    expect(route('no_such_type').available).toBe(true);
  });
});

describe('harness_initiative 无头 kernel 入口退役（kernel 自 09-30 起派发全败 kernel_authority_not_created）', () => {
  const kernelPayload = { orchestrator: 'skill-relay', harness_runtime: 'kernel-v1' };

  it('无头 harness_initiative（含 relay-baton 子单形状）→ retired-harness-kernel 无执行者', () => {
    expect(route('harness_initiative', kernelPayload)).toMatchObject({ route: 'retired-harness-kernel', available: false });
    expect(route('harness_initiative')).toMatchObject({ route: 'retired-harness-kernel', available: false });
    expect(route('harness_initiative').reason).toMatch(/coding_workflow/);
  });

  it('有头（headed_manual 字符串 \'true\' 或布尔 true）不受影响 → headed', () => {
    expect(route('harness_initiative', { ...kernelPayload, headed_manual: 'true' })).toMatchObject({ route: 'headed', available: true });
    expect(route('harness_initiative', { ...kernelPayload, headed_manual: true })).toMatchObject({ route: 'headed', available: true });
  });

  it('动态配置 / 显式 override 不能把无头 harness_initiative 绕回其它执行面', () => {
    expect(route('harness_initiative', {}, { dynamic: { location: 'xian' } })).toMatchObject({ route: 'retired-harness-kernel', available: false });
    expect(route('harness_initiative', { executor: 'codex' })).toMatchObject({ route: 'retired-harness-kernel', available: false });
  });

  it('建单闸（A4）：harness_initiative 只当有头账本类型——无头 queued 建单即拒 no_executor_for_task_type', () => {
    // A2 已把无头编码建单方（work-router / relay-baton / GP 签字实现单）改投 coding_workflow，建单入口收紧：
    // 无头 queued harness_initiative 不再进队等 drain，直接拒（含 kernel-v1 子单形状与空 payload）。
    let err;
    try { assertTaskTypeHasExecutor({ task_type: 'harness_initiative', status: 'queued', payload: kernelPayload }); } catch (e) { err = e; }
    expect(err?.code).toBe('no_executor_for_task_type');
    expect(err?.route).toBe('retired-harness-kernel');
    expect(err?.message).toMatch(/coding_workflow/);
    expect(() => assertTaskTypeHasExecutor({ task_type: 'harness_initiative', status: 'queued', payload: {} })).toThrow(/no_executor_for_task_type/);
    expect(() => assertTaskTypeHasExecutor({ task_type: 'harness_initiative' })).toThrow(/no_executor_for_task_type/);
  });

  it('建单闸（A4）：有头账本行照常——headed_manual 字符串 \'true\' / 布尔 true；非 queued（in_progress / blocked / completed）入账不拦', () => {
    expect(() => assertTaskTypeHasExecutor({ task_type: 'harness_initiative', status: 'queued', payload: { headed_manual: 'true' } })).not.toThrow();
    expect(() => assertTaskTypeHasExecutor({ task_type: 'harness_initiative', status: 'queued', payload: { ...kernelPayload, headed_manual: true } })).not.toThrow();
    expect(() => assertTaskTypeHasExecutor({ task_type: 'harness_initiative', status: 'in_progress', payload: {} })).not.toThrow();
    expect(() => assertTaskTypeHasExecutor({ task_type: 'harness_initiative', status: 'blocked', payload: {} })).not.toThrow();
    expect(() => assertTaskTypeHasExecutor({ task_type: 'harness_initiative', status: 'completed', payload: {} })).not.toThrow();
    // headed_manual 只认字符串 'true' / 布尔 true，'false' 等不算有头
    expect(() => assertTaskTypeHasExecutor({ task_type: 'harness_initiative', status: 'queued', payload: { headed_manual: 'false' } })).toThrow(/no_executor_for_task_type/);
    // 其它无执行者类型照旧拒
    expect(() => assertTaskTypeHasExecutor({ task_type: 'harness_planner', status: 'queued', payload: {} })).toThrow(/no_executor_for_task_type/);
  });

  it('注册表：harness_initiative surface=none 且打 headless_kernel_retired 标签；golden_path_proposal 不动', () => {
    expect(getTaskType('harness_initiative').surface).toBe('none');
    expect(HEADLESS_KERNEL_RETIRED_TASK_TYPES).toEqual(['harness_initiative']);
    expect(getTaskType('golden_path_proposal').surface).toBe('kernel');
    expect(SURFACE_FOR_ROUTE['retired-harness-kernel']).toBe('none');
  });
});

describe('守卫：注册表 surface 与真实路由一致', () => {
  it('每个会被 tick 派发的 DB 类型，surface === SURFACE_FOR_ROUTE[真实路由]', () => {
    const drift = [];
    for (const [type, entry] of Object.entries(TASK_TYPE_REGISTRY)) {
      if (!entry.db || !entry.tick_dispatchable) continue;
      const r = route(type);
      const expected = SURFACE_FOR_ROUTE[r.route];
      if (expected && entry.surface !== expected) drift.push(`${type}: surface=${entry.surface} 实际路由=${r.route}（应为 ${expected}）`);
    }
    expect(drift).toEqual([]);
  });

  it('内联 handler 名单与 task-router 真实注册一致', async () => {
    const { getInternalTaskHandler } = await import('../../task-router.js');
    const actual = Object.keys(TASK_TYPE_REGISTRY).filter((t) => getInternalTaskHandler(t));
    expect(actual.sort()).toEqual([...INTERNAL_HANDLER_TASK_TYPES].sort());
  });

  it('exploratory（画布线停车待人工）/ platform_scraper（Brain 内部采集器自领）不进 tick', () => {
    expect(TICK_DISPATCH_EXCLUDED).toContain('exploratory');
    expect(TICK_DISPATCH_EXCLUDED).toContain('platform_scraper');
  });
});

describe('新类型：技能工厂执行单 / 编码 workflow 独立 task_type', () => {
  it('skill_factory_run：tick 不派、执行体 openclaw-agent、外部看门狗、agent kind、DB 白名单', () => {
    const e = getTaskType('skill_factory_run');
    expect(e).toMatchObject({ db: true, tick_dispatchable: false, executor: 'openclaw-agent', watchdog: 'external-worker', kind: 'agent' });
    expect(e.surface).not.toBe('openclaw-agent'); // openclaw-agent 面 PATCH completed 会被 409，执行单沿用 completed 语义
    expect(TICK_DISPATCH_EXCLUDED).toContain('skill_factory_run');
  });

  it('coding_workflow：tick 不派、执行体 coding-workflow-runner、外部看门狗、workflow kind', () => {
    const e = getTaskType('coding_workflow');
    expect(e).toMatchObject({ db: true, tick_dispatchable: false, executor: 'coding-workflow-runner', watchdog: 'external-worker', kind: 'workflow' });
    expect(TICK_DISPATCH_EXCLUDED).toContain('coding_workflow');
  });
});

describe('assertTaskTypeHasExecutor：建单闸', () => {
  it('queued + 无执行者 → 抛 no_executor_for_task_type，带 task_type/route 和可读原因', () => {
    let err;
    try { assertTaskTypeHasExecutor({ task_type: 'trigger_backup', status: 'queued', payload: {} }); } catch (e) { err = e; }
    expect(err?.code).toBe(NO_EXECUTOR_FOR_TASK_TYPE);
    expect(err.task_type).toBe('trigger_backup');
    expect(err.route).toBe('claude-retired');
    expect(err.message).toMatch(/没有可用执行者/);
  });

  it('缺省 status 视为 queued', () => {
    expect(() => assertTaskTypeHasExecutor({ task_type: 'dev' })).toThrow(/no_executor_for_task_type/);
  });

  it('非 queued（账本镜像 in_progress / completed）不拦', () => {
    expect(() => assertTaskTypeHasExecutor({ task_type: 'workflow_run', status: 'in_progress' })).not.toThrow();
    expect(() => assertTaskTypeHasExecutor({ task_type: 'workflow_run', status: 'completed' })).not.toThrow();
  });

  it('有头单与有执行者类型不拦', () => {
    expect(() => assertTaskTypeHasExecutor({ task_type: 'dev', payload: { headed_manual: 'true' } })).not.toThrow();
    expect(() => assertTaskTypeHasExecutor({ task_type: 'research' })).not.toThrow();
  });
});

describe('normalizeBorrowedTaskType：借壳类型归一', () => {
  it('research + factory_dispatch=true → skill_factory_run', () => {
    expect(normalizeBorrowedTaskType('research', { factory_dispatch: true })).toBe('skill_factory_run');
  });
  it('data + coding_workflow=true → coding_workflow', () => {
    expect(normalizeBorrowedTaskType('data', { coding_workflow: true })).toBe('coding_workflow');
  });
  it('其余原样（包括开关为字符串的非标准写法）', () => {
    expect(normalizeBorrowedTaskType('research', {})).toBe('research');
    expect(normalizeBorrowedTaskType('data', { coding_workflow: 'true' })).toBe('data');
    expect(normalizeBorrowedTaskType('dev', { factory_dispatch: true })).toBe('dev');
  });
});
