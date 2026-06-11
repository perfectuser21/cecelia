/**
 * P1 修复回归：harness sub-graph 死线程复用（合同重新收敛后复用旧终局 checkpoint，invoke 秒回）。
 *
 * 实证 run da418741（2026-06-12）：
 *   早期合同经 Contract Gate 判 contract_invalid → 子图线程 `harness-task:<init>:ws1:fix0`
 *   留下终局 checkpoint（evaluate→END，status 停默认 'queued'，failure_class=contract_invalid）；
 *   其后 gate 规则进化 + GAN 重新收敛新合同（新 propose 分支）；runSubTaskNode 仍 invoke 同一
 *   fix0 线程 → LangGraph 终局线程 invoke 立即返回最终态、无节点执行 → 三连秒回
 *   `status=queued`。
 *
 * 修复核心：thread_id 绑定合同版本——追加 contractBranch 折出的稳定短 token。
 *   合同变 → 新线程 → 执行历史归零。
 *
 * 本文件覆盖：
 *   A. harnessContractThreadSuffix 纯函数语义（空/确定性/区分度/格式）
 *   B. 核心：合同重新收敛 → runSubTaskNode invoke 用【新】thread_id（不复用旧终局线程）
 *   C. 回归：同合同同 fix_count → 同 thread_id（callback router lookup 稳定）
 *   D. Fix 2：contract_invalid 终局 → sub_task.ci_fail_type='contract_invalid' + 明确 feedback
 *   E. Fix 3：死线程探测 → 目标线程已有终局 checkpoint 时 console.warn 告警钩子
 *   F. 回归：spawn/evaluate 两处子图 thread_id 与 runSubTaskNode 同口径（源级不变量）
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

vi.mock('../../db.js', () => ({ default: { query: vi.fn(async () => ({ rows: [] })) } }));

import { runSubTaskNode } from '../harness-initiative.graph.js';
import { harnessContractThreadSuffix } from '../../harness-utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function baseState(overrides = {}) {
  return {
    initiativeId: 'init-da418741',
    task: { id: 'ti', payload: {} },
    sub_task: { id: 'ws1', title: 'T', description: 'D', payload: { dod: [], files: [] } },
    task_loop_fix_count: 0,
    final_e2e_fix_count: 0,
    ...overrides,
  };
}

// 捕获 invoke 收到的 config.thread_id；返回成功终态以走直返分支（跳过 poll wait）。
function captureThreadCompiled(returnFinal = { status: 'merged', pr_url: 'https://pr/1' }) {
  const seen = { threadIds: [] };
  const compiled = {
    invoke: async (_input, config) => {
      seen.threadIds.push(config?.configurable?.thread_id);
      return returnFinal;
    },
    // 死线程探测会调 getState；默认返回 fresh（无 checkpoint）。
    getState: async () => ({ values: {}, next: [] }),
  };
  return { compiled, seen };
}

describe('A. harnessContractThreadSuffix 纯函数', () => {
  it('contractBranch 为 null/空 → 返回空串（退回旧 thread_id 格式，向后兼容）', () => {
    expect(harnessContractThreadSuffix(null)).toBe('');
    expect(harnessContractThreadSuffix(undefined)).toBe('');
    expect(harnessContractThreadSuffix('')).toBe('');
  });

  it('contractBranch 有值 → 返回 :c<8位hex>（确定性，同输入同输出）', () => {
    const s1 = harnessContractThreadSuffix('cp-harness-propose-r3-da418741');
    expect(s1).toMatch(/^:c[0-9a-f]{8}$/);
    expect(harnessContractThreadSuffix('cp-harness-propose-r3-da418741')).toBe(s1);
  });

  it('不同 contractBranch → 不同 token（合同重新收敛可区分）', () => {
    const r2 = harnessContractThreadSuffix('cp-harness-propose-r2-da418741');
    const r3 = harnessContractThreadSuffix('cp-harness-propose-r3-da418741');
    expect(r2).not.toBe(r3);
  });
});

describe('B. 核心：合同重新收敛 → 用新 thread_id 不复用旧终局线程', () => {
  it('两个不同 contractBranch → runSubTaskNode invoke 收到不同 thread_id', async () => {
    const c1 = captureThreadCompiled();
    await runSubTaskNode(
      baseState({ contractBranch: 'cp-harness-propose-r2-da418741' }),
      { compiledTaskGraph: c1.compiled, waitMs: 0 }
    );
    const c2 = captureThreadCompiled();
    await runSubTaskNode(
      baseState({ contractBranch: 'cp-harness-propose-r3-da418741' }),
      { compiledTaskGraph: c2.compiled, waitMs: 0 }
    );
    expect(c1.seen.threadIds[0]).toBeTruthy();
    expect(c2.seen.threadIds[0]).toBeTruthy();
    expect(c1.seen.threadIds[0]).not.toBe(c2.seen.threadIds[0]);
    // 两者都带合同后缀
    expect(c1.seen.threadIds[0]).toMatch(/:c[0-9a-f]{8}$/);
    expect(c2.seen.threadIds[0]).toMatch(/:c[0-9a-f]{8}$/);
  });

  it('thread_id 仍含 harness-task: 前缀 + :fix<N>（callback router/格式校验不破坏）', async () => {
    const { compiled, seen } = captureThreadCompiled();
    await runSubTaskNode(
      baseState({ contractBranch: 'cp-x', final_e2e_fix_count: 2 }),
      { compiledTaskGraph: compiled, waitMs: 0 }
    );
    expect(seen.threadIds[0]).toMatch(/^harness-task:init-da418741:ws1:fix2:c[0-9a-f]{8}$/);
  });

  it('ganResult.propose_branch 作为 contractBranch 兜底来源也进 thread_id', async () => {
    const { compiled, seen } = captureThreadCompiled();
    await runSubTaskNode(
      baseState({ contractBranch: null, ganResult: { propose_branch: 'cp-gan-fallback' } }),
      { compiledTaskGraph: compiled, waitMs: 0 }
    );
    expect(seen.threadIds[0]).toBe(
      `harness-task:init-da418741:ws1:fix0${harnessContractThreadSuffix('cp-gan-fallback')}`
    );
  });
});

describe('C. 回归：同合同同 fix_count → 同 thread_id（lookup 稳定）', () => {
  it('两次调用同 contractBranch → 同 thread_id', async () => {
    const c1 = captureThreadCompiled();
    await runSubTaskNode(baseState({ contractBranch: 'cp-same' }), { compiledTaskGraph: c1.compiled, waitMs: 0 });
    const c2 = captureThreadCompiled();
    await runSubTaskNode(baseState({ contractBranch: 'cp-same' }), { compiledTaskGraph: c2.compiled, waitMs: 0 });
    expect(c1.seen.threadIds[0]).toBe(c2.seen.threadIds[0]);
  });

  it('无 contractBranch → thread_id 退回旧格式（无合同后缀）', async () => {
    const { compiled, seen } = captureThreadCompiled();
    await runSubTaskNode(baseState({ contractBranch: null }), { compiledTaskGraph: compiled, waitMs: 0 });
    expect(seen.threadIds[0]).toBe('harness-task:init-da418741:ws1:fix0');
  });
});

describe('D. Fix 2：contract_invalid 终局上浮为明确状态', () => {
  // 实证形态：contract_invalid 路径 evaluate→END，status 停默认 'queued'（不写 merged），
  // 终局 checkpoint values 带 failure_class + evaluate_error。invoke 秒回 'queued' → 走 poll-wait
  // 分支 → _waitForSubGraphCompletion getState 拿到终局 values 作 final。两处都给同一终局态。
  function contractInvalidTerminal(evaluateError) {
    const terminal = { status: 'queued', failure_class: 'contract_invalid', evaluate_error: evaluateError };
    return {
      invoke: async () => terminal,
      getState: async () => ({ values: terminal, next: [] }),
    };
  }

  it('子图返回 failure_class=contract_invalid → sub_task.ci_fail_type=contract_invalid + feedback 含原因', async () => {
    const compiled = contractInvalidTerminal('Contract Gate 命中合同产物（contract-dod.md）——责任在 GAN proposer');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = await runSubTaskNode(baseState({ contractBranch: 'cp-bad' }), { compiledTaskGraph: compiled, waitMs: 0 });
    warnSpy.mockRestore();
    const st = out.sub_tasks[0];
    expect(st.ci_fail_type).toBe('contract_invalid');
    expect(String(st.evaluator_feedback || '')).toContain('GAN proposer');
  });

  it('warn 日志带 failure_class（不再只 status=queued 通用文案）', async () => {
    const compiled = contractInvalidTerminal('x');
    const calls = [];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...a) => calls.push(a.map(String).join(' ')));
    await runSubTaskNode(baseState({ contractBranch: 'cp-bad' }), { compiledTaskGraph: compiled, waitMs: 0 });
    warnSpy.mockRestore();
    expect(calls.some((c) => /failure_class=contract_invalid/.test(c))).toBe(true);
  });
});

describe('E. Fix 3：死线程探测告警钩子', () => {
  it('目标线程已有终局 checkpoint（next=[] 且 values 非空）→ console.warn 死线程探测', async () => {
    const compiled = {
      invoke: async () => ({ status: 'merged', pr_url: 'p' }),
      getState: async () => ({ values: {}, next: [] }),
    };
    const calls = [];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...a) => calls.push(a.map(String).join(' ')));
    await runSubTaskNode(
      baseState({ contractBranch: 'cp-x' }),
      {
        compiledTaskGraph: compiled,
        waitMs: 0,
        // 注入终局 checkpoint 形态（模拟旧合同留下的死线程）
        _getStateForDiag: async () => ({ values: { status: 'queued', failure_class: 'contract_invalid' }, next: [] }),
      }
    );
    warnSpy.mockRestore();
    expect(calls.some((c) => /死线程探测/.test(c))).toBe(true);
  });

  it('fresh 线程（values 空）→ 不告警', async () => {
    const compiled = {
      invoke: async () => ({ status: 'merged', pr_url: 'p' }),
      getState: async () => ({ values: {}, next: [] }),
    };
    const calls = [];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...a) => calls.push(a.map(String).join(' ')));
    await runSubTaskNode(
      baseState({ contractBranch: 'cp-x' }),
      { compiledTaskGraph: compiled, waitMs: 0, _getStateForDiag: async () => ({ values: {}, next: [] }) }
    );
    warnSpy.mockRestore();
    expect(calls.some((c) => /死线程探测/.test(c))).toBe(false);
  });
});

describe('F. 回归：子图 spawn/evaluate thread_id 与父节点同口径（源级不变量）', () => {
  const taskSrc = readFileSync(resolve(__dirname, '..', 'harness-task.graph.js'), 'utf8');
  const initSrc = readFileSync(resolve(__dirname, '..', 'harness-initiative.graph.js'), 'utf8');

  it('harness-task.graph spawn/evaluate 两处 thread_id 都追加 harnessContractThreadSuffix(state.contractBranch)', () => {
    const occurrences = taskSrc.match(/harnessContractThreadSuffix\(state\.contractBranch\)/g) || [];
    expect(occurrences.length).toBe(2);
    // 且 import 了 helper
    expect(taskSrc).toMatch(/import\s*\{[^}]*harnessContractThreadSuffix[^}]*\}\s*from\s*'\.\.\/harness-utils\.js'/);
    // 前缀仍为 harness-task:（B10 不变量）
    expect(taskSrc).toMatch(/const\s+threadId\s*=\s*`harness-task:\$\{/);
  });

  it('runSubTaskNode thread_id 含 harnessContractThreadSuffix + contractBranchForThread 单一解析点', () => {
    const fnMatch = initSrc.match(/export async function runSubTaskNode[\s\S]*?\n\}/);
    expect(fnMatch).toBeTruthy();
    const body = fnMatch[0];
    expect(body).toMatch(/harnessContractThreadSuffix\(contractBranchForThread\)/);
    // invoke 输入与 thread_id 用同一 contractBranchForThread（父子一致）
    expect(body).toMatch(/contractBranch:\s*contractBranchForThread/);
  });
});
