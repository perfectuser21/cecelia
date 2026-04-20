/**
 * Harness v2 M4 — harness-graph v2 流程单测
 *
 * 覆盖：
 *   - Generator isFixMode 分流（eval_round=0 → 新建；eval_round>0 → Fix）
 *   - ci_gate 节点 PASS / FAIL / TIMEOUT / pr_url 缺失 / pollFn 抛错
 *   - HARNESS_NODE_NAMES 含 ci_gate
 *   - compileHarnessApp 不抛错
 *   - 端到端 PASS 路径：planner → proposer → reviewer → generator → ci_gate → evaluator → report
 *   - CI FAIL 回到 generator（Fix 模式）后 CI PASS → evaluator → PASS → report
 *   - Evaluator FAIL 回到 generator（Fix 模式）后 PASS → report
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createDockerNodes,
  createCiGateNode,
  compileHarnessApp,
  HARNESS_NODE_NAMES,
} from '../harness-graph.js';

// ─── Generator 两模式 ───────────────────────────────────────────────────────

describe('Generator isFixMode 分流', () => {
  it('eval_round=0 → 新建 PR 模式，task_type=harness_generate', async () => {
    const captured = { prompt: null, task_type: null };
    const dockerMock = vi.fn(async ({ prompt, task }) => {
      captured.prompt = prompt;
      captured.task_type = task.task_type;
      return {
        exit_code: 0,
        timed_out: false,
        stdout: 'pr_url: https://github.com/o/r/pull/1\npr_branch: cp-0420-x',
      };
    });
    const nodes = createDockerNodes(dockerMock, { id: 't1' });
    const out = await nodes.generator({
      task_id: 't1',
      task_description: '',
      contract_content: '',
      eval_round: 0,
    });
    expect(captured.task_type).toBe('harness_generate');
    expect(captured.prompt).toMatch(/新建\s*PR\s*模式|checkout -b cp-|gh pr create/);
    // 新建模式 harness-graph.js 注入段（non-SKILL 部分）不应含 Fix 模式标题
    // SKILL.md 本身描述两模式，但外层 harness-graph.js 的 modeSection 只应是新建模式
    const afterSkill = captured.prompt.split('---').slice(-1)[0];
    expect(afterSkill).not.toMatch(/## 模式：Fix 模式/);
    expect(afterSkill).toMatch(/## 模式：新建 PR 模式/);
    expect(out.pr_url).toBe('https://github.com/o/r/pull/1');
    expect(out.pr_branch).toBe('cp-0420-x');
  });

  it('eval_round>0 → Fix 模式，task_type=harness_fix，硬约束"永远不要开新 PR"', async () => {
    const captured = { prompt: null, task_type: null };
    const dockerMock = vi.fn(async ({ prompt, task }) => {
      captured.prompt = prompt;
      captured.task_type = task.task_type;
      return {
        exit_code: 0,
        timed_out: false,
        stdout: 'commit_sha: abc1234\npr_url: https://github.com/o/r/pull/1',
      };
    });
    const nodes = createDockerNodes(dockerMock, { id: 't1' });
    const out = await nodes.generator({
      task_id: 't1',
      pr_url: 'https://github.com/o/r/pull/1',
      pr_branch: 'cp-0420-x',
      eval_round: 1,
      eval_feedback: 'Feature A broken on empty input',
    });
    expect(captured.task_type).toBe('harness_fix');
    // Fix 模式 prompt 必须含关键词
    expect(captured.prompt).toMatch(/Fix 模式/);
    expect(captured.prompt).toMatch(/永远不要在 Fix 模式开新 PR/);
    expect(captured.prompt).toMatch(/同分支累积 commit/);
    // 已有分支被注入 prompt
    expect(captured.prompt).toContain('cp-0420-x');
    // Evaluator 反馈被注入
    expect(captured.prompt).toContain('Feature A broken on empty input');
    // Fix 模式输出保留原 pr_url（绝不开新 PR）
    expect(out.pr_url).toBe('https://github.com/o/r/pull/1');
    expect(out.pr_branch).toBe('cp-0420-x');
    // commit_shas 累积
    expect(Array.isArray(out.commit_shas)).toBe(true);
    expect(out.commit_shas).toContain('abc1234');
  });

  it('Fix 模式注入 CI feedback（CI FAIL 回来）', async () => {
    const captured = { prompt: null };
    const dockerMock = vi.fn(async ({ prompt }) => {
      captured.prompt = prompt;
      return { exit_code: 0, timed_out: false, stdout: 'commit_sha: def5678' };
    });
    const nodes = createDockerNodes(dockerMock, { id: 't1' });
    await nodes.generator({
      task_id: 't1',
      pr_url: 'https://github.com/o/r/pull/1',
      pr_branch: 'cp-0420-x',
      eval_round: 1,
      ci_feedback: 'lint error: unused variable foo',
    });
    expect(captured.prompt).toContain('lint error: unused variable foo');
    expect(captured.prompt).toMatch(/CI 失败片段/);
  });

  it('Generator 进入后清除上轮 ci_status/ci_feedback（重新走 ci_gate）', async () => {
    const dockerMock = vi.fn(async () => ({
      exit_code: 0,
      timed_out: false,
      stdout: 'commit_sha: xxx',
    }));
    const nodes = createDockerNodes(dockerMock, { id: 't1' });
    const out = await nodes.generator({
      task_id: 't1',
      pr_url: 'https://github.com/o/r/pull/1',
      pr_branch: 'cp-0420-x',
      eval_round: 1,
      ci_status: 'fail',
      ci_feedback: 'old feedback',
      ci_failed_check: 'L1',
    });
    expect(out.ci_status).toBeNull();
    expect(out.ci_feedback).toBeNull();
    expect(out.ci_failed_check).toBeNull();
  });
});

// ─── ci_gate 节点 ──────────────────────────────────────────────────────────

describe('ci_gate 节点', () => {
  it('pollFn PASS → ci_status=pass', async () => {
    const pollFn = vi.fn(async () => ({ status: 'PASS', checks: [{ name: 'L1', bucket: 'pass' }] }));
    const node = createCiGateNode(pollFn);
    const out = await node({ pr_url: 'https://github.com/o/r/pull/1' });
    expect(out.ci_status).toBe('pass');
    expect(out.ci_feedback).toBeFalsy();
    expect(out.ci_failed_check).toBeFalsy();
    expect(pollFn).toHaveBeenCalledWith('https://github.com/o/r/pull/1');
  });

  it('pollFn FAIL → ci_status=fail + feedback + ci_failed_check + eval_round++', async () => {
    const pollFn = vi.fn(async () => ({
      status: 'FAIL',
      failedCheck: { name: 'L1', link: 'https://github.com/o/r/actions/runs/1' },
      logSnippet: 'Error: foo',
    }));
    const node = createCiGateNode(pollFn);
    const out = await node({ pr_url: 'https://github.com/o/r/pull/1', eval_round: 0 });
    expect(out.ci_status).toBe('fail');
    expect(out.ci_feedback).toContain('Error: foo');
    expect(out.ci_feedback).toContain('L1');
    expect(out.ci_failed_check).toBe('L1');
    expect(out.eval_round).toBe(1);
  });

  it('pollFn TIMEOUT → ci_status=timeout + eval_round++', async () => {
    const pollFn = vi.fn(async () => ({ status: 'TIMEOUT' }));
    const node = createCiGateNode(pollFn);
    const out = await node({ pr_url: 'https://github.com/o/r/pull/1', eval_round: 0 });
    expect(out.ci_status).toBe('timeout');
    expect(out.eval_round).toBe(1);
    expect(out.ci_feedback).toMatch(/TIMEOUT/);
  });

  it('pr_url 缺失 → ci_status=fail（不调 pollFn）', async () => {
    const pollFn = vi.fn();
    const node = createCiGateNode(pollFn);
    const out = await node({ pr_url: null, eval_round: 0 });
    expect(out.ci_status).toBe('fail');
    expect(out.eval_round).toBe(1);
    expect(pollFn).not.toHaveBeenCalled();
  });

  it('pollFn 抛错 → ci_status=fail + eval_round++', async () => {
    const pollFn = vi.fn(async () => {
      throw new Error('gh not logged in');
    });
    const node = createCiGateNode(pollFn);
    const out = await node({ pr_url: 'https://github.com/o/r/pull/1', eval_round: 0 });
    expect(out.ci_status).toBe('fail');
    expect(out.eval_round).toBe(1);
    expect(out.ci_feedback).toMatch(/pollPRChecks 抛错/);
  });

  it('pollFn FAIL 但 failedCheck 无 link → ci_failed_check=check name', async () => {
    const pollFn = vi.fn(async () => ({
      status: 'FAIL',
      failedCheck: { name: 'lint', link: null },
      logSnippet: '',
    }));
    const node = createCiGateNode(pollFn);
    const out = await node({ pr_url: 'https://github.com/o/r/pull/1', eval_round: 2 });
    expect(out.ci_status).toBe('fail');
    expect(out.ci_failed_check).toBe('lint');
    expect(out.eval_round).toBe(3);
  });
});

// ─── 图结构 ────────────────────────────────────────────────────────────────

describe('buildHarnessGraph v2 结构', () => {
  it('HARNESS_NODE_NAMES 含 ci_gate，位于 generator 和 evaluator 之间', () => {
    expect(HARNESS_NODE_NAMES).toContain('ci_gate');
    const gi = HARNESS_NODE_NAMES.indexOf('generator');
    const ci = HARNESS_NODE_NAMES.indexOf('ci_gate');
    const ei = HARNESS_NODE_NAMES.indexOf('evaluator');
    expect(gi).toBeGreaterThanOrEqual(0);
    expect(ci).toBe(gi + 1);
    expect(ei).toBe(ci + 1);
  });

  it('compileHarnessApp 不抛错', () => {
    const app = compileHarnessApp();
    expect(app).toBeDefined();
  });

  it('端到端流 PASS 路径：planner → proposer → reviewer(APPROVED) → generator → ci_gate(PASS) → evaluator(PASS) → report', async () => {
    const trace = [];
    const app = compileHarnessApp({
      overrides: {
        planner: async () => { trace.push('planner'); return { prd_content: 'P', trace: 'planner' }; },
        proposer: async () => { trace.push('proposer'); return { contract_content: 'C', trace: 'proposer' }; },
        reviewer: async () => { trace.push('reviewer'); return { review_verdict: 'APPROVED', trace: 'reviewer' }; },
        generator: async () => { trace.push('generator'); return { pr_url: 'https://github.com/o/r/pull/1', trace: 'generator' }; },
        ci_gate: async () => { trace.push('ci_gate'); return { ci_status: 'pass', trace: 'ci_gate' }; },
        evaluator: async () => { trace.push('evaluator'); return { evaluator_verdict: 'PASS', trace: 'evaluator' }; },
        report: async () => { trace.push('report'); return { report_path: 'sprints/r.md', trace: 'report' }; },
      },
    });
    await app.invoke({ task_id: 't1' }, { configurable: { thread_id: 't1' } });
    expect(trace).toEqual(['planner', 'proposer', 'reviewer', 'generator', 'ci_gate', 'evaluator', 'report']);
  });

  it('CI FAIL 路径：generator → ci_gate(FAIL) → generator(Fix) → ci_gate(PASS) → evaluator(PASS) → report', async () => {
    const trace = [];
    let ciCalls = 0;
    const app = compileHarnessApp({
      overrides: {
        planner: async () => ({ trace: 'planner' }),
        proposer: async () => ({ trace: 'proposer' }),
        reviewer: async () => ({ review_verdict: 'APPROVED', trace: 'reviewer' }),
        generator: async (state) => {
          trace.push(`generator(eval_round=${state.eval_round || 0})`);
          return { pr_url: 'https://github.com/o/r/pull/1', trace: 'generator' };
        },
        ci_gate: async (state) => {
          ciCalls++;
          // 第 1 次 fail，第 2 次 pass
          const status = ciCalls >= 2 ? 'pass' : 'fail';
          trace.push(`ci_gate(${status})`);
          const update = { ci_status: status, trace: `ci_gate(${status})` };
          if (status === 'fail') update.eval_round = (state.eval_round || 0) + 1;
          return update;
        },
        evaluator: async () => { trace.push('evaluator'); return { evaluator_verdict: 'PASS', trace: 'evaluator' }; },
        report: async () => { trace.push('report'); return { trace: 'report' }; },
      },
    });
    await app.invoke({ task_id: 't1' }, { configurable: { thread_id: 't1' }, recursionLimit: 25 });
    // generator 应被调 2 次，ci_gate 2 次，evaluator 1 次
    const genCount = trace.filter((t) => t.startsWith('generator')).length;
    const ciCount = trace.filter((t) => t.startsWith('ci_gate')).length;
    expect(genCount).toBe(2);
    expect(ciCount).toBe(2);
    expect(trace).toContain('evaluator');
    expect(trace).toContain('report');
  });

  it('Evaluator FAIL 路径：generator → ci_gate(PASS) → evaluator(FAIL) → generator(Fix) → ci_gate(PASS) → evaluator(PASS) → report', async () => {
    const trace = [];
    let evalCalls = 0;
    const app = compileHarnessApp({
      overrides: {
        planner: async () => ({ trace: 'planner' }),
        proposer: async () => ({ trace: 'proposer' }),
        reviewer: async () => ({ review_verdict: 'APPROVED', trace: 'reviewer' }),
        generator: async () => { trace.push('generator'); return { pr_url: 'https://github.com/o/r/pull/1', trace: 'generator' }; },
        ci_gate: async () => { trace.push('ci_gate'); return { ci_status: 'pass', trace: 'ci_gate' }; },
        evaluator: async (state) => {
          evalCalls++;
          const verdict = evalCalls >= 2 ? 'PASS' : 'FAIL';
          trace.push(`evaluator(${verdict})`);
          return {
            evaluator_verdict: verdict,
            eval_round: evalCalls,
            eval_feedback: verdict === 'FAIL' ? 'adversarial case X broken' : null,
          };
        },
        report: async () => { trace.push('report'); return { trace: 'report' }; },
      },
    });
    await app.invoke({ task_id: 't1' }, { configurable: { thread_id: 't1' }, recursionLimit: 25 });
    // generator 2 次（1 次新建 + 1 次 Fix），evaluator 2 次（1 FAIL + 1 PASS）
    const genCount = trace.filter((t) => t === 'generator').length;
    const evalFail = trace.filter((t) => t === 'evaluator(FAIL)').length;
    const evalPass = trace.filter((t) => t === 'evaluator(PASS)').length;
    expect(genCount).toBe(2);
    expect(evalFail).toBe(1);
    expect(evalPass).toBe(1);
    expect(trace[trace.length - 1]).toBe('report');
  });
});

// ─── Evaluator 节点（Docker mock）── Task 级对抗 QA，prompt 不含 E2E ───────

describe('Evaluator 节点 prompt 去 E2E', () => {
  it('eval prompt 明确禁止启动 Brain 5222 / 真实前端 / 真实 PG', async () => {
    const captured = { prompt: null };
    const dockerMock = vi.fn(async ({ prompt }) => {
      captured.prompt = prompt;
      return { exit_code: 0, timed_out: false, stdout: 'VERDICT: PASS' };
    });
    const nodes = createDockerNodes(dockerMock, { id: 't1' });
    const out = await nodes.evaluator({
      task_id: 't1',
      pr_url: 'https://github.com/o/r/pull/1',
      pr_branch: 'cp-0420-x',
      eval_round: 0,
      contract_content: 'contract',
    });
    expect(captured.prompt).toMatch(/禁止启动 Brain 5222/);
    expect(captured.prompt).toMatch(/禁止启动真实前端/);
    expect(captured.prompt).toMatch(/禁止启动真实 PostgreSQL/);
    expect(captured.prompt).toMatch(/Task 级对抗 QA|对抗 case|空输入|并发/);
    // 无上限停止条件
    expect(captured.prompt).toMatch(/无上限/);
    expect(out.evaluator_verdict).toBe('PASS');
    expect(out.eval_round).toBe(1);
  });

  it('pr_url 缺失 → 直接 FAIL，不调 docker', async () => {
    const dockerMock = vi.fn();
    const nodes = createDockerNodes(dockerMock, { id: 't1' });
    const out = await nodes.evaluator({
      task_id: 't1',
      pr_url: null,
      eval_round: 0,
    });
    expect(out.evaluator_verdict).toBe('FAIL');
    expect(out.eval_feedback).toMatch(/pr_url 缺失|未产出 PR/);
    expect(dockerMock).not.toHaveBeenCalled();
  });
});
