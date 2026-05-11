import { describe, it, expect, vi } from 'vitest';

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
import {
  buildProposerPrompt,
  buildReviewerPrompt,
  extractVerdict,
  extractFeedback,
  extractRubricScores,
  computeVerdictFromRubric,
  thresholdForRound,
} from '../harness-gan-graph.js';

describe('buildProposerPrompt', () => {
  it('round 1 without feedback: inline SKILL pattern (no slash command)', () => {
    const out = buildProposerPrompt('# PRD content', null, 1);
    // Bug 6 修复：用 inline SKILL pattern，container 不再自解析 slash command
    expect(out).toContain('你是 harness-contract-proposer agent');
    expect(out).not.toContain('/harness-contract-proposer');
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
    // Bug 6 修复：用 inline SKILL pattern
    expect(out).toContain('你是 harness-contract-reviewer agent');
    expect(out).not.toContain('/harness-contract-reviewer');
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
    // skeptical persona 在 SKILL.md 里
    expect(out).toContain('skeptical staff engineer');
  });
});

describe('extractVerdict', () => {
  it('APPROVED from stdout', () => {
    expect(extractVerdict('blah\nVERDICT: APPROVED\n')).toBe('APPROVED');
  });
  it('REVISION from stdout', () => {
    expect(extractVerdict('blah\nVERDICT: REVISION\n')).toBe('REVISION');
  });
  it('fallback REVISION when no verdict match', () => {
    expect(extractVerdict('no verdict here')).toBe('REVISION');
  });
  it('fallback REVISION for null/empty', () => {
    expect(extractVerdict(null)).toBe('REVISION');
    expect(extractVerdict('')).toBe('REVISION');
  });
});

describe('extractFeedback', () => {
  it('returns last 2000 chars of stdout', () => {
    const s = 'x'.repeat(3000);
    expect(extractFeedback(s)).toHaveLength(2000);
  });
  it('returns empty for null/empty', () => {
    expect(extractFeedback(null)).toBe('');
    expect(extractFeedback('')).toBe('');
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

describe('extractRubricScores', () => {
  it('解析 final JSON 含 rubric_scores', () => {
    const stdout = 'analysis...\n{"verdict":"REVISION","rubric_scores":{"dod_machineability":8,"scope_match_prd":7,"test_is_red":9,"internal_consistency":6,"risk_registered":5},"pivot_signal":false}';
    const scores = extractRubricScores(stdout);
    expect(scores).toEqual({
      dod_machineability: 8,
      scope_match_prd: 7,
      test_is_red: 9,
      internal_consistency: 6,
      risk_registered: 5,
    });
  });

  it('解析 ```json fence 里的 rubric scores（v7 markdown 格式）', () => {
    const stdout = '## RUBRIC SCORES\n\n```json\n{"dod_machineability": 8, "scope_match_prd": 7, "test_is_red": 9, "internal_consistency": 6, "risk_registered": 5}\n```\n\n## VERDICT: REVISION';
    const scores = extractRubricScores(stdout);
    expect(scores).toEqual({
      dod_machineability: 8,
      scope_match_prd: 7,
      test_is_red: 9,
      internal_consistency: 6,
      risk_registered: 5,
    });
  });

  it('无 rubric → null', () => {
    expect(extractRubricScores('just text')).toBeNull();
    expect(extractRubricScores('')).toBeNull();
    expect(extractRubricScores(null)).toBeNull();
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

describe('createGanContractNodes', () => {
  function makeCtx(overrides = {}) {
    return {
      taskId: 'task-123',
      initiativeId: 'init-1',
      sprintDir: 'sprints/demo',
      worktreePath: '/tmp/wt/demo',
      githubToken: 'ghs_test',
      readContractFile: vi.fn(async () => '# Contract content'),
      // H10: 默认 fetchOriginFile = fetchAndShowOriginFile 会真跑 git；测试里 mock 为成功。
      fetchOriginFile: vi.fn(async () => '{"tasks":[]}'),
      ...overrides,
    };
  }

  it('proposer node: calls executor with harness_contract_propose, increments round, accumulates cost', async () => {
    const executor = vi.fn(async () => ({
      exit_code: 0, stdout: 'proposer ok', stderr: '', cost_usd: 0.25, timed_out: false,
    }));
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
    // CECELIA_CREDENTIALS 不再硬编码 — 由 executeInDocker middleware 动态选（selectBestAccount）
    expect(call.env.CECELIA_CREDENTIALS).toBeUndefined();
    expect(call.env.HARNESS_PROPOSE_ROUND).toBe('1');
  });

  it('proposer node: passes feedback from state into prompt at round > 1', async () => {
    const executor = vi.fn(async () => ({
      exit_code: 0, stdout: '', stderr: '', cost_usd: 0.1, timed_out: false,
    }));
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
    const executor = vi.fn(async () => ({
      exit_code: 0, stdout: 'analysis\nVERDICT: APPROVED\n', stderr: '', cost_usd: 0.05, timed_out: false,
    }));
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

  it('reviewer node: REVISION verdict sets feedback from last 2000 chars', async () => {
    const stdout = 'x'.repeat(2500) + '\nVERDICT: REVISION\n';
    const executor = vi.fn(async () => ({
      exit_code: 0, stdout, stderr: '', cost_usd: 0.05, timed_out: false,
    }));
    const { createGanContractNodes } = await import('../harness-gan-graph.js');
    const nodes = createGanContractNodes(executor, makeCtx());
    const newState = await nodes.reviewer({
      prdContent: '# PRD', contractContent: '# C', round: 1, costUsd: 0,
    });
    expect(newState.verdict).toBe('REVISION');
    expect(newState.feedback).toHaveLength(2000);
    expect(newState.feedback.endsWith('VERDICT: REVISION\n')).toBe(true);
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
    const executor = vi.fn(async () => ({
      exit_code: 0, stdout: 'VERDICT: REVISION', stderr: '', cost_usd: 5, timed_out: false,
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
    const executor = vi.fn(async () => ({
      exit_code: 0, stdout: 'VERDICT: REVISION', stderr: '', cost_usd: 0.1, timed_out: false,
    }));
    const { createGanContractNodes } = await import('../harness-gan-graph.js');
    const nodes = createGanContractNodes(executor, makeCtx());
    // 没有 rubricHistory（insufficient_data）→ 不 force，按 LLM 文本走 REVISION
    const newState = await nodes.reviewer({
      prdContent: '# PRD', contractContent: '# C', round: 10, costUsd: 0,
    });
    expect(newState.verdict).toBe('REVISION');
    expect(newState.forcedApproval).toBe(false);
  });

  // ── rubric 代码权威判决测试 ──
  it('reviewer node: rubric 全 ≥7 → APPROVED（即使 LLM 文本说 REVISION）', async () => {
    // LLM 说 REVISION，但 rubric scores 表明所有维度都达标
    const stdout = [
      '## RUBRIC SCORES',
      '```json',
      '{"dod_machineability":8,"scope_match_prd":7,"test_is_red":9,"internal_consistency":7,"risk_registered":7}',
      '```',
      '',
      'VERDICT: REVISION',  // LLM 想继续挑毛病但 rubric 达标
    ].join('\n');
    const executor = vi.fn(async () => ({
      exit_code: 0, stdout, stderr: '', cost_usd: 0.1, timed_out: false,
    }));
    const { createGanContractNodes } = await import('../harness-gan-graph.js');
    const nodes = createGanContractNodes(executor, makeCtx());
    const newState = await nodes.reviewer({
      prdContent: '# PRD', contractContent: '# C', round: 1, costUsd: 0,
    });
    // 代码权威判 APPROVED，忽略 LLM 文本 REVISION
    expect(newState.verdict).toBe('APPROVED');
    expect(newState.forcedApproval).toBe(false); // 不是 MAX_ROUNDS 强制，是 rubric 自然 PASS
  });

  it('reviewer node: rubric 一维 < 阈值 → REVISION（即使 LLM 文本说 APPROVED）', async () => {
    const stdout = [
      '## RUBRIC SCORES',
      '```json',
      '{"dod_machineability":8,"scope_match_prd":7,"test_is_red":9,"internal_consistency":7,"risk_registered":5}',
      '```',
      '',
      'VERDICT: APPROVED',  // LLM 宽容说 APPROVED 但 rubric risk_registered=5 < 7
    ].join('\n');
    const executor = vi.fn(async () => ({
      exit_code: 0, stdout, stderr: '', cost_usd: 0.1, timed_out: false,
    }));
    const { createGanContractNodes } = await import('../harness-gan-graph.js');
    const nodes = createGanContractNodes(executor, makeCtx());
    const newState = await nodes.reviewer({
      prdContent: '# PRD', contractContent: '# C', round: 1, costUsd: 0,
    });
    expect(newState.verdict).toBe('REVISION');
    expect(newState.feedback).toBeDefined();
  });

  it('reviewer node: 无 rubric → fallback 到 LLM 文本 verdict（向后兼容）', async () => {
    const executor = vi.fn(async () => ({
      exit_code: 0, stdout: 'Only text, no rubric scores.\nVERDICT: APPROVED', stderr: '', cost_usd: 0.1, timed_out: false,
    }));
    const { createGanContractNodes } = await import('../harness-gan-graph.js');
    const nodes = createGanContractNodes(executor, makeCtx());
    const newState = await nodes.reviewer({
      prdContent: '# PRD', contractContent: '# C', round: 1, costUsd: 0,
    });
    expect(newState.verdict).toBe('APPROVED');
  });

  it('reviewer node: round 3 阈值降 6，rubric 全 ≥6 → APPROVED', async () => {
    const stdout = [
      '```json',
      '{"dod_machineability":6,"scope_match_prd":7,"test_is_red":6,"internal_consistency":6,"risk_registered":6}',
      '```',
      'VERDICT: REVISION',
    ].join('\n');
    const executor = vi.fn(async () => ({
      exit_code: 0, stdout, stderr: '', cost_usd: 0.1, timed_out: false,
    }));
    const { createGanContractNodes } = await import('../harness-gan-graph.js');
    const nodes = createGanContractNodes(executor, makeCtx());
    const newState = await nodes.reviewer({
      prdContent: '# PRD', contractContent: '# C', round: 3, costUsd: 0,
    });
    // round 3 阈值 6，全部 ≥6 → APPROVED（虽然 round 1 规则下会 REVISION）
    expect(newState.verdict).toBe('APPROVED');
  });
});

describe('runGanContractGraph', () => {
  function makeOpts(overrides = {}) {
    return {
      taskId: 'task-e2e-1',
      initiativeId: 'init-1',
      sprintDir: 'sprints/demo',
      prdContent: '# PRD content',
      worktreePath: '/tmp/wt/demo',
      githubToken: 'ghs_test',
      budgetCapUsd: 10,
      readContractFile: vi.fn(async () => '# Contract'),
      // H10: 注入成功 fetchOriginFile，避免默认 fetchAndShowOriginFile 真跑 git。
      fetchOriginFile: vi.fn(async () => '{"tasks":[]}'),
      // v1.229.0 起 checkpointer 必填（不再 fallback MemorySaver）。
      // 单测里仍允许用 MemorySaver mock 替代真 PostgresSaver。
      checkpointer: new MemorySaver(),
      ...overrides,
    };
  }

  it('round 1 APPROVED: returns rounds=1, contract_content, cost_usd', async () => {
    const executor = vi.fn(async (opts) => {
      if (opts.task.task_type === 'harness_contract_propose') {
        return { exit_code: 0, stdout: 'p1', stderr: '', cost_usd: 0.1, timed_out: false };
      }
      return { exit_code: 0, stdout: 'VERDICT: APPROVED', stderr: '', cost_usd: 0.05, timed_out: false };
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
        return { exit_code: 0, stdout: 'p', stderr: '', cost_usd: 0.1, timed_out: false };
      }
      reviewerCalls++;
      const verdict = reviewerCalls === 1 ? 'REVISION' : 'APPROVED';
      return { exit_code: 0, stdout: `feedback body\nVERDICT: ${verdict}`, stderr: '', cost_usd: 0.05, timed_out: false };
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
        return { exit_code: 0, stdout: 'p', stderr: '', cost_usd: 6, timed_out: false };
      }
      return { exit_code: 0, stdout: 'VERDICT: REVISION', stderr: '', cost_usd: 5, timed_out: false };
    });
    const { runGanContractGraph } = await import('../harness-gan-graph.js');
    await expect(runGanContractGraph({ ...makeOpts({ budgetCapUsd: 10 }), executor }))
      .rejects.toThrow(/gan_budget_exceeded/);
  });

  it('passes thread_id = taskId into LangGraph config (MemorySaver checkpoint written)', async () => {
    const executor = vi.fn(async (opts) => {
      if (opts.task.task_type === 'harness_contract_propose') {
        return { exit_code: 0, stdout: 'p', stderr: '', cost_usd: 0.1, timed_out: false };
      }
      return { exit_code: 0, stdout: 'VERDICT: APPROVED', stderr: '', cost_usd: 0.05, timed_out: false };
    });
    const { runGanContractGraph } = await import('../harness-gan-graph.js');
    const { MemorySaver } = await import('@langchain/langgraph');
    const checkpointer = new MemorySaver();
    const res = await runGanContractGraph({ ...makeOpts({ taskId: 'task-thread-1' }), executor, checkpointer });
    expect(res.rounds).toBe(1);
    const tuple = await checkpointer.getTuple({ configurable: { thread_id: 'task-thread-1' } });
    expect(tuple).toBeTruthy();
  });

  it('proposer stdout 含 propose_branch → finalState 透传到 runGanContractGraph 返回值（v6 P0-final）', async () => {
    let round = 0;
    const executor = vi.fn(async ({ task: { task_type } }) => {
      if (task_type === 'harness_contract_propose') {
        round += 1;
        return {
          exit_code: 0,
          stdout: `propose stuff\n{"verdict": "PROPOSED", "propose_branch": "cp-harness-propose-r${round}-deadbeef", "workstream_count": 4, "test_files_count": 4}\n`,
          stderr: '',
          cost_usd: 0.1,
          timed_out: false,
        };
      }
      // reviewer 直接 APPROVED（rubric 全 8 → 通过 round-1 阈值 7）
      return {
        exit_code: 0,
        stdout: '```json\n{"dod_machineability":8,"scope_match_prd":8,"test_is_red":8,"internal_consistency":8,"risk_registered":8}\n```\nVERDICT: APPROVED',
        stderr: '',
        cost_usd: 0.05,
        timed_out: false,
      };
    });
    const { runGanContractGraph } = await import('../harness-gan-graph.js');
    const res = await runGanContractGraph({ ...makeOpts(), executor });
    expect(res.propose_branch).toBe('cp-harness-propose-r1-deadbeef');
  });

  it('proposer stdout 缺 propose_branch → fallback 用 cp-harness-propose-r{round}-<taskId8>（不为 null，跟 SKILL push 同格式）', async () => {
    const executor = vi.fn(async ({ task: { task_type } }) => {
      if (task_type === 'harness_contract_propose') {
        return { exit_code: 0, stdout: 'no json here', stderr: '', cost_usd: 0.1, timed_out: false };
      }
      return {
        exit_code: 0,
        stdout: '```json\n{"dod_machineability":8,"scope_match_prd":8,"test_is_red":8,"internal_consistency":8,"risk_registered":8}\n```\nVERDICT: APPROVED',
        stderr: '',
        cost_usd: 0.05,
        timed_out: false,
      };
    });
    const { runGanContractGraph } = await import('../harness-gan-graph.js');
    const res = await runGanContractGraph({ ...makeOpts({ taskId: 'abcd1234-ffff-0000-0000-000000000000' }), executor });
    // 2026-05-08 双修：fallback 改用 cp-harness-propose-r{round}-{taskIdSlice} 跟 SKILL push 同格式
    expect(res.propose_branch).not.toBeNull();
    expect(res.propose_branch).toMatch(/^cp-harness-propose-r\d+-abcd1234$/);
  });
});

describe('extractProposeBranch', () => {
  it('提取 SKILL Step 3 字面量 JSON 中的 propose_branch', async () => {
    const { extractProposeBranch } = await import('../harness-gan-graph.js');
    const stdout = '...输出blah\n{"verdict": "PROPOSED", "contract_draft_path": "sprints/foo/contract-draft.md", "propose_branch": "cp-harness-propose-r2-12345678", "workstream_count": 4, "test_files_count": 4}\n';
    expect(extractProposeBranch(stdout)).toBe('cp-harness-propose-r2-12345678');
  });

  it('未找到字段 → null', async () => {
    const { extractProposeBranch } = await import('../harness-gan-graph.js');
    expect(extractProposeBranch('no json')).toBeNull();
    expect(extractProposeBranch('')).toBeNull();
    expect(extractProposeBranch(null)).toBeNull();
  });
});

// fallbackProposeBranch 测试已迁移到 src/workflows/__tests__/extract-and-fallback-propose-branch.test.js
// 旧 cp-MMDDHHmm-<taskId8> 格式作废（2026-05-08 双修，跟 SKILL push 格式 cp-harness-propose-r{round}-XXX 对齐）。
