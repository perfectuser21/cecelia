/**
 * harness-end-status-and-gate-deps.test.js
 *
 * 一个 PR 批量修两个已诊断问题的回归测试：
 *
 * 【问题 1】harness-task 子图存在"END 不写终态"的残余路径（run cf4f596c 实证：
 *   fix0 线程走到 next=[], status=queued）。规则：图的每条 END 边都是 API，
 *   每条通向 END 前必须写明确终态（status）。否则停在 status channel 默认值 'queued'，
 *   父 runSubTaskNode getState 读到 queued → Serial gate 误判。
 *   本测试用真实节点 + 真实路由跑 invoke，断言终局线程读到的 status 非 'queued'。
 *
 * 【问题 2】ARTIFACT 门裸 checkout 缺依赖致环境性误判（run 56b5cc39 实证：
 *   临时目录无 node_modules → `Cannot find package 'zod'` → 门 FAIL → 打回 generator）。
 *   规则：门的环境失败不能算被测者（generator）的失败。
 *   修法：注入 NODE_PATH 指向宿主 node_modules；依赖/环境类错误 fail-open 跳过（warning），
 *   真断言失败照旧 FAIL。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StateGraph, START, END } from '@langchain/langgraph';

const mockPoolQuery = vi.hoisted(() => vi.fn(async () => ({ rows: [] })));
vi.mock('../db.js', () => ({ default: { query: mockPoolQuery } }));

let mod;
beforeEach(async () => {
  vi.resetModules();
  mockPoolQuery.mockClear();
  mod = await import('../workflows/harness-task.graph.js');
});

// ══════════════════════════════════════════════════════════════════════════
// 问题 1：每条 END 边都写明确终态（status 非默认 'queued'）
// ══════════════════════════════════════════════════════════════════════════

describe('问题1 · END 终态 — 节点级（每条 END 前写明确 status）', () => {
  it('parseCallbackNode 无 pr_url（no_pr 终局）→ status=no_pr，不留 queued', async () => {
    const res = await mod.parseCallbackNode({ generator_output: '' });
    expect(res.status).toBe('no_pr');
    expect(res.pr_url).toBeFalsy();
  });

  it('pollCiNode 达 MAX_POLL_COUNT（timeout 终局）→ status=timeout', async () => {
    const res = await mod.pollCiNode({ poll_count: mod.MAX_POLL_COUNT, pr_url: 'http://x' });
    expect(res.ci_status).toBe('timeout');
    expect(res.status).toBe('timeout');
  });

  it('pollCiNode PR 被外部关闭（终局失败）→ status=failed + error', async () => {
    const res = await mod.pollCiNode(
      { poll_count: 0, pr_url: 'http://x' },
      { checkPr: () => ({ state: 'CLOSED', ciStatus: 'closed' }), sleepMs: 0 },
    );
    expect(res.status).toBe('failed');
    expect(res.error).toBeTruthy();
  });

  it('mergePrNode 无 pr_url → status=failed', async () => {
    const res = await mod.mergePrNode({}, { execFile: async () => ({ stdout: '' }) });
    expect(res.status).toBe('failed');
    expect(res.error).toBeTruthy();
  });

  it('mergePrNode 真冲突（CONFLICTING）→ status=failed', async () => {
    const execFile = vi.fn(async (bin, args) => {
      if (args.includes('merge')) { throw new Error('not mergeable'); }
      // queryMergeState: gh pr view --json mergeable,mergeStateStatus
      return { stdout: JSON.stringify({ mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' }) };
    });
    const res = await mod.mergePrNode({ pr_url: 'http://x' }, { execFile });
    expect(res.status).toBe('failed');
    expect(res.error.reason).toBe('conflicting');
  });

  it('evaluateContractNode Contract Gate 命中合同产物 → status=contract_invalid（终局，子图层写终态）', async () => {
    const res = await mod.evaluateContractNode(
      {
        evaluate_verdict: null,
        githubToken: 'tok',
        initiativeId: 'init-1',
        worktreePath: '/tmp/wt',
        prdContent: '## target_environment: local_api',
        task: { id: 'task-1', payload: { sprint_dir: 'sprints' } },
      },
      {
        verifyArtifacts: async () => ({ ran: false }),
        runContractGate: async () => ({ ok: false, contractFile: 'contract-dod.md' }),
        resolveToken: async () => 'tok',
        poolOverride: { query: mockPoolQuery },
      },
    );
    expect(res.evaluate_verdict).toBe('FAIL');
    expect(res.failure_class).toBe('contract_invalid');
    expect(res.status).toBe('contract_invalid');
  });
});

describe('问题1 · END 终态 — invoke 终局线程读到非 queued（图级集成）', () => {
  // 真实节点 + 真实路由跑 compiled.invoke，断言 final.status 非 status channel 默认 'queued'。
  // 这两条正是此前漏写终态的路径（no_pr / timeout）。

  it('no_pr 路径：parse_callback → END，invoke 终局 status=no_pr（非 queued）', async () => {
    const g = new StateGraph(mod.TaskState)
      .addNode('parse_callback', mod.parseCallbackNode)
      .addEdge(START, 'parse_callback')
      // 镜像真实 routeAfterParse：无 pr_url → no_pr → END
      .addConditionalEdges('parse_callback', (s) => (s.pr_url ? 'poll' : 'no_pr'), { no_pr: END, poll: END })
      .compile();
    const final = await g.invoke({ task: { id: 't1' }, generator_output: '' });
    expect(final.status).not.toBe('queued');
    expect(final.status).toBe('no_pr');
  });

  it('timeout 路径：poll_ci → END，invoke 终局 status=timeout（非 queued）', async () => {
    const g = new StateGraph(mod.TaskState)
      .addNode('poll_ci', mod.pollCiNode)
      .addEdge(START, 'poll_ci')
      .addConditionalEdges('poll_ci', mod.routeAfterPoll, {
        end: END, merge: END, evaluate: END, fix: END, timeout: END, poll: 'poll_ci',
      })
      .compile();
    const final = await g.invoke({ task: { id: 't1' }, pr_url: 'http://x', poll_count: mod.MAX_POLL_COUNT });
    expect(final.status).not.toBe('queued');
    expect(final.status).toBe('timeout');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 问题 2：ARTIFACT 门依赖注入 + 环境失败 fail-open
// ══════════════════════════════════════════════════════════════════════════

describe('问题2 · isDependencyError 分类', () => {
  it('依赖/环境类错误命中', () => {
    expect(mod.isDependencyError("Cannot find package 'zod' imported from /tmp/x")).toBe(true);
    expect(mod.isDependencyError('Error [ERR_MODULE_NOT_FOUND]: Cannot find module ...')).toBe(true);
    expect(mod.isDependencyError('MODULE_NOT_FOUND')).toBe(true);
  });
  it('真断言失败不命中（不会被误当环境错误放过）', () => {
    expect(mod.isDependencyError('AssertionError: /healthz route missing')).toBe(false);
    expect(mod.isDependencyError('exit 1: process.exit(1)')).toBe(false);
  });
});

describe('问题2 · NODE_PATH 注入宿主依赖', () => {
  it('HOST_NODE_PATH 指向宿主 packages/brain/node_modules', () => {
    expect(mod.HOST_NODE_PATH).toContain('packages/brain/node_modules');
  });
  it('artifactGateEnv 把宿主 node_modules 注入 NODE_PATH', () => {
    const env = mod.artifactGateEnv('/host/repo/node_modules');
    expect(env.NODE_PATH).toContain('/host/repo/node_modules');
  });
});

describe('问题2 · runArtifactGate 环境失败 fail-open（修复前 FAIL / 修复后跳过）', () => {
  it('依赖类错误（Cannot find package zod）→ fail-open 跳过，ok=true，不计 failures', async () => {
    const execShell = vi.fn(async () => {
      const e = new Error("Cannot find package 'zod' imported from /tmp/x/src/harness-shared.js");
      e.stderr = e.message;
      throw e;
    });
    const r = await mod.runArtifactGate({ commands: ['node -e import-shared'], execShell, cwd: '/tmp/x' });
    expect(r.ok).toBe(true);              // 修复后：门的环境失败不算 generator 失败
    expect(r.skipped.length).toBe(1);
    expect(r.failures).toEqual([]);
  });

  it('真断言失败（实现没做）→ 照旧 FAIL，进 failures', async () => {
    const execShell = vi.fn(async () => {
      const e = new Error('exit 1');
      e.stderr = 'AssertionError: /healthz route missing';
      throw e;
    });
    const r = await mod.runArtifactGate({ commands: ['check-healthz'], execShell, cwd: '/tmp/x' });
    expect(r.ok).toBe(false);
    expect(r.failures.length).toBe(1);
    expect(r.skipped).toEqual([]);
  });

  it('混合：依赖错误跳过 + 真失败仍 FAIL', async () => {
    const execShell = vi.fn(async (cmd) => {
      if (cmd.includes('dep')) { const e = new Error("Cannot find package 'zod'"); e.stderr = e.message; throw e; }
      const e = new Error('exit 1'); e.stderr = 'route missing'; throw e;
    });
    const r = await mod.runArtifactGate({ commands: ['node dep', 'check-real'], execShell, cwd: '/tmp/x' });
    expect(r.ok).toBe(false);            // 有真失败 → 仍 FAIL
    expect(r.failures.length).toBe(1);
    expect(r.skipped.length).toBe(1);
  });
});
