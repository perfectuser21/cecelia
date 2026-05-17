import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// H15: stub contract-verify so proposer/evaluator nodes don't shell out to git/gh.
vi.mock('../lib/contract-verify.js', () => ({
  ContractViolation: class extends Error {
    constructor(message, details) {
      super(message);
      this.name = 'ContractViolation';
      this.details = details || {};
    }
  },
  verifyProposerOutput: vi.fn(async () => undefined),
  verifyGeneratorOutput: vi.fn(async () => undefined),
  verifyEvaluatorWorktree: vi.fn(async () => undefined),
}));

import { MemorySaver } from '@langchain/langgraph';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  buildProposerPrompt,
  buildReviewerPrompt,
  computeVerdictFromRubric,
  thresholdForRound,
} from '../harness-gan-graph.js';

describe('buildProposerPrompt', () => {
  it('round 1 without feedback: inline SKILL pattern (no slash command)', () => {
    const out = buildProposerPrompt('# PRD content', null, 1);
    // Bug 6 修复：第一行不再是 slash command，是 inline agent 引导
    expect(out.split('\n')[0]).toBe('你是 harness-contract-proposer agent。按下面 SKILL 指令工作。');
    // SKILL 真注入了（v7.4 关键词）
    expect(out).toContain('contract-dod-ws');
    expect(out).toContain('round: 1');
    expect(out).toContain('## PRD');
    expect(out).toContain('# PRD content');
    expect(out).not.toContain('上轮 Reviewer 反馈');
  });

  it('round 2 with feedback: appends feedback block', () => {
    const out = buildProposerPrompt('# PRD', 'risk 1: xxx', 2);
    expect(out).toContain('round: 2');
    expect(out).toContain('## 上轮 Reviewer 反馈（必须处理）');
    expect(out).toContain('risk 1: xxx');
  });
});

describe('buildReviewerPrompt', () => {
  it('round 1: inline SKILL (含 7 维 rubric) + 删 hardcoded 5 维 (Bug 6 fix)', () => {
    const out = buildReviewerPrompt('# PRD', '# Contract R1', 1);
    // Bug 6 修复：第一行 inline agent 引导，不是 slash command
    expect(out.split('\n')[0]).toBe('你是 harness-contract-reviewer agent。按下面 SKILL 指令工作。');
    // SKILL v6.2 真注入了（含 7 维）
    expect(out).toContain('dod_machineability');
    expect(out).toContain('scope_match_prd');
    expect(out).toContain('test_is_red');
    expect(out).toContain('internal_consistency');
    expect(out).toContain('risk_registered');
    // v6.1 第 6 维 + v6.2 第 7 维（关键 — Bug 6 修复后必有）
    expect(out).toContain('verification_oracle_completeness');
    expect(out).toContain('behavior_count_position');
    // PRD/Contract 仍嵌入
    expect(out).toContain('round: 1');
    expect(out).toContain('## Proposer 当前合同草案');
    expect(out).toContain('# Contract R1');
    // brain code 不再 hardcode 5 维 rubric（让 SKILL 做 SSOT）
    expect(out).not.toContain('按以下 5 个维度');
    // skeptical persona 在 SKILL.md 里（注意大写 S）
    expect(out).toContain('Skeptical staff engineer');
  });
});

describe('thresholdForRound', () => {
  it('round 1-2 阈值 7', () => {
    expect(thresholdForRound(1)).toBe(7);
    expect(thresholdForRound(2)).toBe(7);
  });
  it('round 3+ 阈值 6', () => {
    expect(thresholdForRound(3)).toBe(6);
    expect(thresholdForRound(5)).toBe(6);
    expect(thresholdForRound(10)).toBe(6);
  });
});

describe('computeVerdictFromRubric', () => {
  const allSeven = {
    dod_machineability: 7,
    scope_match_prd: 7,
    test_is_red: 7,
    internal_consistency: 7,
    risk_registered: 7,
  };

  it('round 1 全 ≥7 → APPROVED', () => {
    expect(computeVerdictFromRubric(allSeven, 1)).toBe('APPROVED');
  });

  it('round 1 一维 6 → REVISION（阈值 7）', () => {
    const scores = { ...allSeven, risk_registered: 6 };
    expect(computeVerdictFromRubric(scores, 1)).toBe('REVISION');
  });

  it('round 3 同样一维 6 → APPROVED（阈值降到 6）', () => {
    const scores = { ...allSeven, risk_registered: 6 };
    expect(computeVerdictFromRubric(scores, 3)).toBe('APPROVED');
  });

  it('round 3 一维 5 → REVISION（仍低于阈值 6）', () => {
    const scores = { ...allSeven, risk_registered: 5 };
    expect(computeVerdictFromRubric(scores, 3)).toBe('REVISION');
  });

  it('scores null → null（fallback 到 LLM 文本）', () => {
    expect(computeVerdictFromRubric(null, 1)).toBeNull();
  });

  it('维度不完整 → null', () => {
    expect(computeVerdictFromRubric({ dod_machineability: 8 }, 1)).toBeNull();
  });
});

const RUBRIC_ALL_PASS = {
  dod_machineability: 8, scope_match_prd: 8, test_is_red: 8, internal_consistency: 8, risk_registered: 8,
};
const RUBRIC_RISK_FAIL = {
  dod_machineability: 8, scope_match_prd: 7, test_is_red: 9, internal_consistency: 7, risk_registered: 5,
};
const RUBRIC_ALL_SIX = {
  dod_machineability: 6, scope_match_prd: 7, test_is_red: 6, internal_consistency: 6, risk_registered: 6,
};

describe('createGanContractNodes', () => {
  let tmpWt;
  beforeEach(() => { tmpWt = mkdtempSync(path.join(tmpdir(), 'gan-test-')); });
  afterEach(() => { rmSync(tmpWt, { recursive: true, force: true }); });

  function makeCtx(overrides = {}) {
    return {
      taskId: 'task-123',
      initiativeId: 'init-1',
      sprintDir: 'sprints/demo',
      worktreePath: tmpWt,
      githubToken: 'ghs_test',
      readContractFile: vi.fn(async () => '# Contract content'),
      fetchOriginFile: vi.fn(async () => '{"tasks":[]}'),
      ...overrides,
    };
  }

  // B39: proposer executor writes .brain-result.json with PROPOSE_BRANCH from env
  function makeProposerExecutor(cost = 0.25) {
    return vi.fn(async ({ env }) => {
      writeFileSync(
        path.join(tmpWt, '.brain-result.json'),
        JSON.stringify({ propose_branch: env.PROPOSE_BRANCH, workstream_count: 1, task_plan_path: 'sprints/demo/task-plan.json' }),
      );
      return { exit_code: 0, stdout: '', stderr: '', cost_usd: cost, timed_out: false };
    });
  }

  // B39: reviewer executor writes .brain-result.json with verdict/rubric_scores/feedback
  function makeReviewerExecutor(verdict, rubricScores, feedback = '', cost = 0.05) {
    return vi.fn(async () => {
      writeFileSync(
        path.join(tmpWt, '.brain-result.json'),
        JSON.stringify({ verdict, rubric_scores: rubricScores, feedback }),
      );
      return { exit_code: 0, stdout: '', stderr: '', cost_usd: cost, timed_out: false };
    });
  }

  it('proposer node: calls executor with harness_contract_propose, increments round, accumulates cost', async () => {
    const executor = makeProposerExecutor(0.25);
    const { createGanContractNodes } = await import('../harness-gan-graph.js');
    const nodes = createGanContractNodes(executor, makeCtx());
    const newState = await nodes.proposer({ prdContent: '# PRD', feedback: null, round: 0, costUsd: 0 });
    expect(newState.round).toBe(1);
    expect(newState.costUsd).toBeCloseTo(0.25, 3);
    expect(newState.contractContent).toBe('# Contract content');
    expect(executor).toHaveBeenCalledTimes(1);
    const call = executor.mock.calls[0][0];
    expect(call.task.task_type).toBe('harness_contract_propose');
    expect(call.prompt).toContain('round: 1');
    expect(call.env.CECELIA_CREDENTIALS).toBeUndefined();
    expect(call.env.HARNESS_PROPOSE_ROUND).toBe('1');
    // B39: PROPOSE_BRANCH 由 Brain 注入（确定性计算）
    expect(call.env.PROPOSE_BRANCH).toBe('cp-harness-propose-r1-task-123');
  });

  it('proposer node: passes feedback from state into prompt at round > 1', async () => {
    const executor = makeProposerExecutor(0.1);
    const { createGanContractNodes } = await import('../harness-gan-graph.js');
    const nodes = createGanContractNodes(executor, makeCtx());
    await nodes.proposer({ prdContent: '# PRD', feedback: 'risk: x', round: 1, costUsd: 0.1 });
    const call = executor.mock.calls[0][0];
    expect(call.prompt).toContain('上轮 Reviewer 反馈');
    expect(call.prompt).toContain('risk: x');
    expect(call.prompt).toContain('round: 2');
  });

  it('proposer node: throws proposer_failed when exit_code != 0', async () => {
    const executor = vi.fn(async () => ({
      exit_code: 1, stdout: '', stderr: 'boom', cost_usd: 0, timed_out: false,
    }));
    const { createGanContractNodes } = await import('../harness-gan-graph.js');
    const nodes = createGanContractNodes(executor, makeCtx());
    await expect(nodes.proposer({ prdContent: '# PRD', round: 0, costUsd: 0 }))
      .rejects.toThrow(/proposer_failed: exit=1/);
  });

  it('reviewer node: APPROVED verdict sets state.verdict=APPROVED, no feedback update', async () => {
    const executor = makeReviewerExecutor('APPROVED', RUBRIC_ALL_PASS, '', 0.05);
    const { createGanContractNodes } = await import('../harness-gan-graph.js');
    const nodes = createGanContractNodes(executor, makeCtx());
    const newState = await nodes.reviewer({
      prdContent: '# PRD', contractContent: '# C', round: 1, costUsd: 0.1,
    });
    expect(newState.verdict).toBe('APPROVED');
    expect(newState.costUsd).toBeCloseTo(0.15, 3);
    const call = executor.mock.calls[0][0];
    expect(call.task.task_type).toBe('harness_contract_review');
    expect(call.env.HARNESS_REVIEW_ROUND).toBe('1');
  });

  // B39: feedback 从 .brain-result.json 读取（不再是 stdout 最后 2000 字符）
  it('reviewer node: REVISION verdict — feedback 来自结果文件', async () => {
    const executor = makeReviewerExecutor('REVISION', RUBRIC_RISK_FAIL, 'detailed feedback text', 0.05);
    const { createGanContractNodes } = await import('../harness-gan-graph.js');
    const nodes = createGanContractNodes(executor, makeCtx());
    const newState = await nodes.reviewer({
      prdContent: '# PRD', contractContent: '# C', round: 1, costUsd: 0,
    });
    expect(newState.verdict).toBe('REVISION');
    expect(newState.feedback).toBe('detailed feedback text');
  });

  it('reviewer node: throws reviewer_failed when exit_code != 0', async () => {
    const executor = vi.fn(async () => ({
      exit_code: 137, stdout: '', stderr: '', cost_usd: 0, timed_out: false,
    }));
    const { createGanContractNodes } = await import('../harness-gan-graph.js');
    const nodes = createGanContractNodes(executor, makeCtx());
    await expect(nodes.reviewer({ prdContent: '# PRD', contractContent: '# C', round: 1, costUsd: 0 }))
      .rejects.toThrow(/reviewer_failed: exit=137/);
  });

  it('reviewer node: throws gan_budget_exceeded when costUsd > budgetCapUsd', async () => {
    // budget check happens BEFORE readBrainResult — no file write needed
    const executor = vi.fn(async () => ({
      exit_code: 0, stdout: '', stderr: '', cost_usd: 5, timed_out: false,
    }));
    const { createGanContractNodes } = await import('../harness-gan-graph.js');
    const nodes = createGanContractNodes(executor, makeCtx({ budgetCapUsd: 1 }));
    await expect(nodes.reviewer({ prdContent: '# PRD', contractContent: '# C', round: 1, costUsd: 0 }))
      .rejects.toThrow(/gan_budget_exceeded: spent=5\.000 cap=1/);
  });

  // 旧的 MAX_ROUNDS 硬 cap 已被收敛检测取代（见 cp-05071847-gan-convergence-detect）。
  // 行为契约迁移到：packages/brain/src/workflows/__tests__/harness-gan-convergence.test.js
  // 这里只保留一个 smoke：高轮数（曾经的 MAX_ROUNDS）单独不再 force APPROVED。
  it('reviewer node: 高轮数（round=10）单独不再 force APPROVED — 由收敛检测裁定', async () => {
    // 空 rubric_scores={} → computeVerdictFromRubric 返回 null → fallback 到 file verdict REVISION
    const executor = makeReviewerExecutor('REVISION', {}, '', 0.1);
    const { createGanContractNodes } = await import('../harness-gan-graph.js');
    const nodes = createGanContractNodes(executor, makeCtx());
    const newState = await nodes.reviewer({
      prdContent: '# PRD', contractContent: '# C', round: 10, costUsd: 0,
    });
    expect(newState.verdict).toBe('REVISION');
    expect(newState.forcedApproval).toBe(false);
  });

  // ── rubric 代码权威判决测试 ──
  it('reviewer node: rubric 全 ≥7 → APPROVED（即使文件 verdict 说 REVISION）', async () => {
    const executor = makeReviewerExecutor('REVISION', RUBRIC_ALL_PASS, 'some feedback', 0.1);
    const { createGanContractNodes } = await import('../harness-gan-graph.js');
    const nodes = createGanContractNodes(executor, makeCtx());
    const newState = await nodes.reviewer({
      prdContent: '# PRD', contractContent: '# C', round: 1, costUsd: 0,
    });
    expect(newState.verdict).toBe('APPROVED');
    expect(newState.forcedApproval).toBe(false);
  });

  it('reviewer node: rubric 一维 < 阈值 → REVISION（即使文件 verdict 说 APPROVED）', async () => {
    const executor = makeReviewerExecutor('APPROVED', RUBRIC_RISK_FAIL, 'feedback text', 0.1);
    const { createGanContractNodes } = await import('../harness-gan-graph.js');
    const nodes = createGanContractNodes(executor, makeCtx());
    const newState = await nodes.reviewer({
      prdContent: '# PRD', contractContent: '# C', round: 1, costUsd: 0,
    });
    expect(newState.verdict).toBe('REVISION');
    expect(newState.feedback).toBeDefined();
  });

  // B39: 空 rubric_scores={} → readBrainResult 通过（非 null），但 computeVerdictFromRubric 返回 null → fallback 到 file verdict
  it('reviewer node: 空 rubric_scores → fallback 到 file verdict（向后兼容）', async () => {
    const executor = makeReviewerExecutor('APPROVED', {}, '', 0.1);
    const { createGanContractNodes } = await import('../harness-gan-graph.js');
    const nodes = createGanContractNodes(executor, makeCtx());
    const newState = await nodes.reviewer({
      prdContent: '# PRD', contractContent: '# C', round: 1, costUsd: 0,
    });
    expect(newState.verdict).toBe('APPROVED');
  });

  it('reviewer node: round 3 阈值降 6，rubric 全 ≥6 → APPROVED', async () => {
    const executor = makeReviewerExecutor('REVISION', RUBRIC_ALL_SIX, '', 0.1);
    const { createGanContractNodes } = await import('../harness-gan-graph.js');
    const nodes = createGanContractNodes(executor, makeCtx());
    const newState = await nodes.reviewer({
      prdContent: '# PRD', contractContent: '# C', round: 3, costUsd: 0,
    });
    expect(newState.verdict).toBe('APPROVED');
  });
});

describe('runGanContractGraph', () => {
  let tmpWt;
  beforeEach(() => { tmpWt = mkdtempSync(path.join(tmpdir(), 'gan-run-test-')); });
  afterEach(() => { rmSync(tmpWt, { recursive: true, force: true }); });

  function makeOpts(overrides = {}) {
    return {
      taskId: 'task-e2e-1',
      initiativeId: 'init-1',
      sprintDir: 'sprints/demo',
      prdContent: '# PRD content',
      worktreePath: tmpWt,
      githubToken: 'ghs_test',
      budgetCapUsd: 10,
      readContractFile: vi.fn(async () => '# Contract'),
      fetchOriginFile: vi.fn(async () => '{"tasks":[]}'),
      checkpointer: new MemorySaver(),
      ...overrides,
    };
  }

  it('round 1 APPROVED: returns rounds=1, contract_content, cost_usd', async () => {
    const executor = vi.fn(async (opts) => {
      if (opts.task.task_type === 'harness_contract_propose') {
        writeFileSync(path.join(tmpWt, '.brain-result.json'), JSON.stringify({
          propose_branch: opts.env.PROPOSE_BRANCH, workstream_count: 1, task_plan_path: 'sprints/demo/task-plan.json',
        }));
        return { exit_code: 0, stdout: '', stderr: '', cost_usd: 0.1, timed_out: false };
      }
      writeFileSync(path.join(tmpWt, '.brain-result.json'), JSON.stringify({
        verdict: 'APPROVED', rubric_scores: RUBRIC_ALL_PASS, feedback: '',
      }));
      return { exit_code: 0, stdout: '', stderr: '', cost_usd: 0.05, timed_out: false };
    });
    const { runGanContractGraph } = await import('../harness-gan-graph.js');
    const res = await runGanContractGraph({ ...makeOpts(), executor });
    expect(res.rounds).toBe(1);
    expect(res.contract_content).toBe('# Contract');
    expect(res.cost_usd).toBeCloseTo(0.15, 3);
    expect(executor).toHaveBeenCalledTimes(2);
  });

  it('round 1 REVISION → round 2 APPROVED: loops back to proposer with feedback', async () => {
    let reviewerCalls = 0;
    const executor = vi.fn(async (opts) => {
      if (opts.task.task_type === 'harness_contract_propose') {
        writeFileSync(path.join(tmpWt, '.brain-result.json'), JSON.stringify({
          propose_branch: opts.env.PROPOSE_BRANCH, workstream_count: 1, task_plan_path: 'sprints/demo/task-plan.json',
        }));
        return { exit_code: 0, stdout: '', stderr: '', cost_usd: 0.1, timed_out: false };
      }
      reviewerCalls++;
      const verdict = reviewerCalls === 1 ? 'REVISION' : 'APPROVED';
      const scores = reviewerCalls === 1 ? { dod_machineability: 5, scope_match_prd: 5, test_is_red: 5, internal_consistency: 5, risk_registered: 5 } : RUBRIC_ALL_PASS;
      writeFileSync(path.join(tmpWt, '.brain-result.json'), JSON.stringify({
        verdict, rubric_scores: scores, feedback: 'feedback body',
      }));
      return { exit_code: 0, stdout: '', stderr: '', cost_usd: 0.05, timed_out: false };
    });
    const { runGanContractGraph } = await import('../harness-gan-graph.js');
    const res = await runGanContractGraph({ ...makeOpts(), executor });
    expect(res.rounds).toBe(2);
    expect(executor).toHaveBeenCalledTimes(4);
    const proposerR2Call = executor.mock.calls.find(
      (c) => c[0].task.task_type === 'harness_contract_propose' && c[0].env.PROPOSE_ROUND === '2'
    );
    expect(proposerR2Call[0].prompt).toContain('上轮 Reviewer 反馈');
  });

  it('budget exceeded: throws gan_budget_exceeded', async () => {
    const executor = vi.fn(async (opts) => {
      if (opts.task.task_type === 'harness_contract_propose') {
        writeFileSync(path.join(tmpWt, '.brain-result.json'), JSON.stringify({
          propose_branch: opts.env.PROPOSE_BRANCH, workstream_count: 1, task_plan_path: 'sprints/demo/task-plan.json',
        }));
        return { exit_code: 0, stdout: '', stderr: '', cost_usd: 6, timed_out: false };
      }
      // budget check throws before readBrainResult — no file needed
      return { exit_code: 0, stdout: '', stderr: '', cost_usd: 5, timed_out: false };
    });
    const { runGanContractGraph } = await import('../harness-gan-graph.js');
    await expect(runGanContractGraph({ ...makeOpts({ budgetCapUsd: 10 }), executor }))
      .rejects.toThrow(/gan_budget_exceeded/);
  });

  it('passes thread_id = taskId into LangGraph config (MemorySaver checkpoint written)', async () => {
    const executor = vi.fn(async (opts) => {
      if (opts.task.task_type === 'harness_contract_propose') {
        writeFileSync(path.join(tmpWt, '.brain-result.json'), JSON.stringify({
          propose_branch: opts.env.PROPOSE_BRANCH, workstream_count: 1, task_plan_path: 'sprints/demo/task-plan.json',
        }));
        return { exit_code: 0, stdout: '', stderr: '', cost_usd: 0.1, timed_out: false };
      }
      writeFileSync(path.join(tmpWt, '.brain-result.json'), JSON.stringify({
        verdict: 'APPROVED', rubric_scores: RUBRIC_ALL_PASS, feedback: '',
      }));
      return { exit_code: 0, stdout: '', stderr: '', cost_usd: 0.05, timed_out: false };
    });
    const { runGanContractGraph } = await import('../harness-gan-graph.js');
    const { MemorySaver } = await import('@langchain/langgraph');
    const checkpointer = new MemorySaver();
    const res = await runGanContractGraph({ ...makeOpts({ taskId: 'task-thread-1' }), executor, checkpointer });
    expect(res.rounds).toBe(1);
    const tuple = await checkpointer.getTuple({ configurable: { thread_id: 'task-thread-1' } });
    expect(tuple).toBeTruthy();
  });

  // B39: propose_branch 由 Brain 确定性计算（cp-harness-propose-r1-{taskId.slice(0,8)}）
  it('propose_branch 由 Brain 计算并写入结果文件，正确透传到返回值', async () => {
    const executor = vi.fn(async (opts) => {
      if (opts.task.task_type === 'harness_contract_propose') {
        writeFileSync(path.join(tmpWt, '.brain-result.json'), JSON.stringify({
          propose_branch: opts.env.PROPOSE_BRANCH, workstream_count: 4, task_plan_path: 'sprints/demo/task-plan.json',
        }));
        return { exit_code: 0, stdout: '', stderr: '', cost_usd: 0.1, timed_out: false };
      }
      writeFileSync(path.join(tmpWt, '.brain-result.json'), JSON.stringify({
        verdict: 'APPROVED', rubric_scores: RUBRIC_ALL_PASS, feedback: '',
      }));
      return { exit_code: 0, stdout: '', stderr: '', cost_usd: 0.05, timed_out: false };
    });
    const { runGanContractGraph } = await import('../harness-gan-graph.js');
    const res = await runGanContractGraph({ ...makeOpts(), executor });
    // taskId='task-e2e-1'.slice(0,8) = 'task-e2e' → propose_branch='cp-harness-propose-r1-task-e2e'
    expect(res.propose_branch).toBe('cp-harness-propose-r1-task-e2e');
  });

  it('propose_branch 格式符合 cp-harness-propose-r{round}-{taskId8} 规范', async () => {
    const executor = vi.fn(async (opts) => {
      if (opts.task.task_type === 'harness_contract_propose') {
        writeFileSync(path.join(tmpWt, '.brain-result.json'), JSON.stringify({
          propose_branch: opts.env.PROPOSE_BRANCH, workstream_count: 1, task_plan_path: 'sprints/demo/task-plan.json',
        }));
        return { exit_code: 0, stdout: '', stderr: '', cost_usd: 0.1, timed_out: false };
      }
      writeFileSync(path.join(tmpWt, '.brain-result.json'), JSON.stringify({
        verdict: 'APPROVED', rubric_scores: RUBRIC_ALL_PASS, feedback: '',
      }));
      return { exit_code: 0, stdout: '', stderr: '', cost_usd: 0.05, timed_out: false };
    });
    const { runGanContractGraph } = await import('../harness-gan-graph.js');
    const res = await runGanContractGraph({ ...makeOpts({ taskId: 'abcd1234-ffff-0000-0000-000000000000' }), executor });
    // taskId.slice(0,8)='abcd1234'
    expect(res.propose_branch).not.toBeNull();
    expect(res.propose_branch).toMatch(/^cp-harness-propose-r\d+-abcd1234$/);
  });
});

