/**
 * harness-fixloop-terminal-abort.test.js
 *
 * P2 Issue「在飞执行不感知任务终态」回归（run cf4f596c 08:28-08:34 实证）：
 * initiative 已标 failed 后，其进程内图实例的 fix loop 仍每 ~2 分钟 spawn 一个 generator
 * （r5、r6…），直到手动重启 Brain 才停。
 *
 * 修法：harness-task 子图的 fix loop 路由边 + generator/evaluator spawn 节点入口在每次 spawn 前
 * 查 tasks.status（isInitiativeTerminal）。任务已 failed/completed → 写明确终态 status='aborted'，
 * 走 END（与 END 终态口径一致），不再 spawn。
 *
 * 核心断言：任务标 failed 后 fix 路由不再 spawn（fixDispatchNode 返回 aborted + routeAfterFix→end）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPoolQuery = vi.hoisted(() => vi.fn(async () => ({ rows: [] })));
vi.mock('../db.js', () => ({ default: { query: mockPoolQuery } }));

let mod;
beforeEach(async () => {
  vi.resetModules();
  mockPoolQuery.mockClear();
  mockPoolQuery.mockResolvedValue({ rows: [] });
  mod = await import('../workflows/harness-task.graph.js');
});

// 便捷：让 isInitiativeTerminal 走 poolOverride 返回指定 status
const poolReturning = (status) => ({ query: vi.fn(async () => ({ rows: status === undefined ? [] : [{ status }] })) });

describe('isInitiativeTerminal — 终态判定', () => {
  const base = { initiativeId: 'init-1', task: { id: 't1' } };
  it('failed → terminal=true', async () => {
    const r = await mod.isInitiativeTerminal(base, { poolOverride: poolReturning('failed') });
    expect(r.terminal).toBe(true);
    expect(r.status).toBe('failed');
  });
  it('completed/cancelled → terminal=true', async () => {
    expect((await mod.isInitiativeTerminal(base, { poolOverride: poolReturning('completed') })).terminal).toBe(true);
    expect((await mod.isInitiativeTerminal(base, { poolOverride: poolReturning('cancelled') })).terminal).toBe(true);
  });
  it('in_progress → terminal=false（在飞 run 不误杀）', async () => {
    expect((await mod.isInitiativeTerminal(base, { poolOverride: poolReturning('in_progress') })).terminal).toBe(false);
  });
  it('无该任务行 → terminal=false', async () => {
    expect((await mod.isInitiativeTerminal(base, { poolOverride: poolReturning(undefined) })).terminal).toBe(false);
  });
  it('查询抛错 → fail-open terminal=false', async () => {
    const r = await mod.isInitiativeTerminal(base, { poolOverride: { query: async () => { throw new Error('db down'); } } });
    expect(r.terminal).toBe(false);
  });
  it('无 initiativeId → 不查库，terminal=false', async () => {
    const q = vi.fn();
    const r = await mod.isInitiativeTerminal({}, { poolOverride: { query: q } });
    expect(r.terminal).toBe(false);
    expect(q).not.toHaveBeenCalled();
  });
});

describe('fixDispatchNode — 任务终态后 fix 路由不再 spawn（核心修复）', () => {
  it('initiative=failed → 返回 status=aborted + error，routeAfterFix→end（不 ++fix_round、不 reset containerId 触发 spawn）', async () => {
    const state = { initiativeId: 'init-1', task: { id: 't1' }, fix_round: 4, containerId: 'old-cid' };
    const delta = await mod.fixDispatchNode(state, { poolOverride: poolReturning('failed') });
    expect(delta.status).toBe('aborted');
    expect(delta.error).toBeTruthy();
    expect(delta.error.node).toBe('fix_dispatch');
    // 关键：没有进入正常 fix 分支 → 不 ++fix_round、不 reset containerId（不会触发 spawn 幂等门重起）
    expect(delta.fix_round).toBeUndefined();
    expect(delta.containerId).toBeUndefined();
    // 路由：aborted 带 error → routeAfterFix 走 'end'，不 'spawn'
    expect(mod.routeAfterFix({ ...state, ...delta })).toBe('end');
  });

  it('initiative=in_progress → 正常 fix 路径（++fix_round + reset containerId），routeAfterFix→spawn', async () => {
    const state = { initiativeId: 'init-1', task: { id: 't1' }, fix_round: 4, containerId: 'old-cid' };
    const delta = await mod.fixDispatchNode(state, { poolOverride: poolReturning('in_progress') });
    expect(delta.status).toBeUndefined();
    expect(delta.fix_round).toBe(5);
    expect(delta.containerId).toBeNull();
    expect(mod.routeAfterFix({ ...state, ...delta })).toBe('spawn');
  });
});

describe('spawnNode — 任务终态后入口中止，不起 generator', () => {
  it('initiative=failed → status=aborted，不调 spawnDetached', async () => {
    const spawnSpy = vi.fn(async () => {});
    const ensureSpy = vi.fn(async () => '/wt');
    const delta = await mod.spawnNode(
      { initiativeId: 'init-1', task: { id: 't1', payload: {} }, fix_round: 5 },
      { poolOverride: poolReturning('failed'), spawnDetached: spawnSpy, ensureWorktree: ensureSpy, resolveToken: async () => 'tok' },
    );
    expect(delta.status).toBe('aborted');
    expect(delta.error.node).toBe('spawn');
    expect(spawnSpy).not.toHaveBeenCalled();
    expect(ensureSpy).not.toHaveBeenCalled();
    // routeAfterSpawn：error → end
    expect(mod.routeAfterSpawn({ ...delta })).toBe('end');
  });
});

describe('evaluateContractNode — 任务终态后中止，不起 evaluator', () => {
  it('initiative=failed → status=aborted + verdict=FAIL，不调 spawnDetached；routeAfterEvaluate→end', async () => {
    const spawnSpy = vi.fn(async () => {});
    const delta = await mod.evaluateContractNode(
      {
        evaluate_verdict: null,
        initiativeId: 'init-1',
        githubToken: 'tok',
        worktreePath: '/wt',
        prdContent: '## target_environment: local_api',
        task: { id: 't1', payload: { sprint_dir: 'sprints' } },
      },
      {
        poolOverride: poolReturning('failed'),
        spawnDetached: spawnSpy,
        resolveToken: async () => 'tok',
        // 注入 verifyArtifacts/runContractGate 以防终态门未触发时误跑真实 gate（防御）
        verifyArtifacts: async () => ({ ran: false }),
        runContractGate: async () => ({ ok: true }),
        checkPrMerged: async () => false,
      },
    );
    expect(delta.status).toBe('aborted');
    expect(delta.evaluate_verdict).toBe('FAIL');
    expect(spawnSpy).not.toHaveBeenCalled();
    expect(mod.routeAfterEvaluate({ ...delta })).toBe('end');
  });
});

describe('routeAfterEvaluate — aborted 直达 END', () => {
  it('status=aborted → end（优先于 fix）', () => {
    expect(mod.routeAfterEvaluate({ status: 'aborted', evaluate_verdict: 'FAIL' })).toBe('end');
  });
  it('普通 FAIL（非 aborted）→ fix', () => {
    expect(mod.routeAfterEvaluate({ evaluate_verdict: 'FAIL' })).toBe('fix');
  });
});
