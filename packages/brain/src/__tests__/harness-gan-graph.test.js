import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// WS3 async: hoisted mocks so variables are available when vi.mock factories execute
const { mockSpawnDetached, mockInterrupt, mockDbQuery } = vi.hoisted(() => ({
  mockSpawnDetached: vi.fn().mockResolvedValue(undefined),
  mockInterrupt: vi.fn(),
  mockDbQuery: vi.fn().mockResolvedValue({ rows: [] }),
}));

vi.mock('../spawn/detached.js', () => ({ spawnDockerDetached: (...a) => mockSpawnDetached(...a) }));
vi.mock('../db.js', () => ({ default: { query: (...a) => mockDbQuery(...a) } }));
vi.mock('../spawn/middleware/account-rotation.js', () => ({ resolveAccount: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@langchain/langgraph', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, interrupt: (...a) => mockInterrupt(...a) };
});

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
  it('round 3+ 阈值固定 7（reviewer SKILL v6.4.0+ 单轮阈值不降）', () => {
    expect(thresholdForRound(3)).toBe(7);
    expect(thresholdForRound(5)).toBe(7);
    expect(thresholdForRound(10)).toBe(7);
  });
});

describe('computeVerdictFromRubric', () => {
  const allSeven = {
    dod_machineability: 7,
    scope_match_prd: 7,
    test_is_red: 7,
    internal_consistency: 7,
    risk_registered: 7,
    verification_oracle_completeness: 7,
    ci_workflow_alignment: 7,
  };

  it('round 1 全 ≥7 → APPROVED', () => {
    expect(computeVerdictFromRubric(allSeven, 1)).toBe('APPROVED');
  });

  it('round 1 一维 6 → REVISION（阈值 7）', () => {
    const scores = { ...allSeven, risk_registered: 6 };
    expect(computeVerdictFromRubric(scores, 1)).toBe('REVISION');
  });

  it('round 3 一维 6 → REVISION（阈值固定 7，不再降为 6）', () => {
    const scores = { ...allSeven, risk_registered: 6 };
    expect(computeVerdictFromRubric(scores, 3)).toBe('REVISION');
  });

  it('round 3 一维 5 → REVISION（低于阈值 7）', () => {
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
  verification_oracle_completeness: 8, ci_workflow_alignment: 8,
};
const RUBRIC_RISK_FAIL = {
  dod_machineability: 8, scope_match_prd: 7, test_is_red: 9, internal_consistency: 7, risk_registered: 5,
  verification_oracle_completeness: 8, ci_workflow_alignment: 8,
};
const RUBRIC_ALL_SIX = {
  dod_machineability: 6, scope_match_prd: 7, test_is_red: 6, internal_consistency: 6, risk_registered: 6,
  verification_oracle_completeness: 6, ci_workflow_alignment: 6,
};

describe.skip('createGanContractNodes [WS3 async 已回退 B44, 测试已废弃]', () => {
  let tmpWt;
  beforeEach(() => {
    tmpWt = mkdtempSync(path.join(tmpdir(), 'gan-test-'));
    mockSpawnDetached.mockReset().mockResolvedValue(undefined);
    mockInterrupt.mockReset();
    mockDbQuery.mockReset().mockResolvedValue({ rows: [] });
  });
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
      verifyProposer: vi.fn(async () => undefined),
      ...overrides,
    };
  }

  it('proposer node: spawnDetached 传 harness_contract_propose + HARNESS_CALLBACK_URL, round++', async () => {
    mockInterrupt.mockReturnValueOnce({ exit_code: 0, stdout: '' });
    writeFileSync(path.join(tmpWt, '.brain-result.json'),
      JSON.stringify({ propose_branch: 'cp-harness-propose-r1-task-123' }));
    const { createGanContractNodes } = await import('../harness-gan-graph.js');
    const nodes = createGanContractNodes(null, makeCtx());
    const newState = await nodes.proposer({ prdContent: '# PRD', feedback: null, round: 0, costUsd: 0 });
    expect(newState.round).toBe(1);
    expect(newState.contractContent).toBe('# Contract content');
    expect(mockSpawnDetached).toHaveBeenCalledTimes(1);
    const opts = mockSpawnDetached.mock.calls[0][0];
    expect(opts.task.task_type).toBe('harness_contract_propose');
    expect(opts.env.HARNESS_PROPOSE_ROUND).toBe('1');
    expect(opts.env.PROPOSE_BRANCH).toBe('cp-harness-propose-r1-task-123');
    expect(opts.env.HARNESS_CALLBACK_URL).toContain('/api/brain/harness/callback/');
  });

  it('proposer node: passes feedback from state into prompt at round > 1', async () => {
    mockInterrupt.mockReturnValueOnce({ exit_code: 0, stdout: '' });
    writeFileSync(path.join(tmpWt, '.brain-result.json'),
      JSON.stringify({ propose_branch: 'cp-harness-propose-r2-task-123' }));
    const { createGanContractNodes } = await import('../harness-gan-graph.js');
    const nodes = createGanContractNodes(null, makeCtx());
    await nodes.proposer({ prdContent: '# PRD', feedback: 'risk: x', round: 1, costUsd: 0.1 });
    const opts = mockSpawnDetached.mock.calls[0][0];
    expect(opts.prompt).toContain('上轮 Reviewer 反馈');
    expect(opts.prompt).toContain('risk: x');
    expect(opts.prompt).toContain('round: 2');
  });

  it('proposer node: throws proposer_spawn_failed when spawnDetached throws', async () => {
    mockSpawnDetached.mockRejectedValueOnce(new Error('docker died'));
    const { createGanContractNodes } = await import('../harness-gan-graph.js');
    const nodes = createGanContractNodes(null, makeCtx());
    await expect(nodes.proposer({ prdContent: '# PRD', round: 0, costUsd: 0 }))
      .rejects.toThrow(/proposer_spawn_failed/);
  });

  it('proposer node: interrupt exit_code!=0 → throws proposer_failed', async () => {
    mockInterrupt.mockReturnValueOnce({ exit_code: 1, stdout: '' });
    const { createGanContractNodes } = await import('../harness-gan-graph.js');
    const nodes = createGanContractNodes(null, makeCtx());
    await expect(nodes.proposer({ prdContent: '# PRD', round: 0, costUsd: 0 }))
      .rejects.toThrow(/proposer_failed/);
  });

  it('reviewer node: APPROVED verdict → state.verdict=APPROVED', async () => {
    // spawnDetached 模拟容器写入结果文件（reviewer 开始时会 unlink，所以必须在 spawn 里写）
    mockSpawnDetached.mockImplementationOnce(async () => {
      writeFileSync(path.join(tmpWt, '.brain-result.json'),
        JSON.stringify({ verdict: 'APPROVED', rubric_scores: RUBRIC_ALL_PASS, feedback: '' }));
    });
    mockInterrupt.mockReturnValueOnce({ exit_code: 0, stdout: '' });
    const { createGanContractNodes } = await import('../harness-gan-graph.js');
    const nodes = createGanContractNodes(null, makeCtx());
    const newState = await nodes.reviewer({ prdContent: '# PRD', contractContent: '# C', round: 1, costUsd: 0 });
    expect(newState.verdict).toBe('APPROVED');
    expect(mockSpawnDetached).toHaveBeenCalledTimes(1);
    const opts = mockSpawnDetached.mock.calls[0][0];
    expect(opts.task.task_type).toBe('harness_contract_review');
    expect(opts.env.HARNESS_REVIEW_ROUND).toBe('1');
  });

  it('reviewer node: REVISION verdict — feedback 来自结果文件', async () => {
    mockSpawnDetached.mockImplementationOnce(async () => {
      writeFileSync(path.join(tmpWt, '.brain-result.json'),
        JSON.stringify({ verdict: 'REVISION', rubric_scores: RUBRIC_RISK_FAIL, feedback: 'detailed feedback text' }));
    });
    mockInterrupt.mockReturnValueOnce({ exit_code: 0, stdout: '' });
    const { createGanContractNodes } = await import('../harness-gan-graph.js');
    const nodes = createGanContractNodes(null, makeCtx());
    const newState = await nodes.reviewer({ prdContent: '# PRD', contractContent: '# C', round: 1, costUsd: 0 });
    expect(newState.verdict).toBe('REVISION');
    expect(newState.feedback).toBe('detailed feedback text');
  });

  it('reviewer node: interrupt exit_code!=0 → throws reviewer_failed', async () => {
    mockInterrupt.mockReturnValueOnce({ exit_code: 137, stdout: '' });
    const { createGanContractNodes } = await import('../harness-gan-graph.js');
    const nodes = createGanContractNodes(null, makeCtx());
    await expect(nodes.reviewer({ prdContent: '# PRD', contractContent: '# C', round: 1, costUsd: 0 }))
      .rejects.toThrow(/reviewer_failed: exit=137/);
  });

  it('reviewer node: throws gan_budget_exceeded when costUsd > budgetCapUsd', async () => {
    mockInterrupt.mockReturnValueOnce({ exit_code: 0, stdout: '' });
    const { createGanContractNodes } = await import('../harness-gan-graph.js');
    const nodes = createGanContractNodes(null, makeCtx({ budgetCapUsd: 1 }));
    await expect(nodes.reviewer({ prdContent: '# PRD', contractContent: '# C', round: 1, costUsd: 5 }))
      .rejects.toThrow(/gan_budget_exceeded/);
  });

  it('reviewer node: 高轮数（round=10）单独不再 force APPROVED — 由收敛检测裁定', async () => {
    mockSpawnDetached.mockImplementationOnce(async () => {
      writeFileSync(path.join(tmpWt, '.brain-result.json'),
        JSON.stringify({ verdict: 'REVISION', rubric_scores: {}, feedback: '' }));
    });
    mockInterrupt.mockReturnValueOnce({ exit_code: 0, stdout: '' });
    const { createGanContractNodes } = await import('../harness-gan-graph.js');
    const nodes = createGanContractNodes(null, makeCtx());
    const newState = await nodes.reviewer({ prdContent: '# PRD', contractContent: '# C', round: 10, costUsd: 0 });
    expect(newState.verdict).toBe('REVISION');
    expect(newState.forcedApproval).toBe(false);
  });

  it('reviewer node: rubric 全 ≥7 → APPROVED（即使文件 verdict 说 REVISION）', async () => {
    mockSpawnDetached.mockImplementationOnce(async () => {
      writeFileSync(path.join(tmpWt, '.brain-result.json'),
        JSON.stringify({ verdict: 'REVISION', rubric_scores: RUBRIC_ALL_PASS, feedback: '' }));
    });
    mockInterrupt.mockReturnValueOnce({ exit_code: 0, stdout: '' });
    const { createGanContractNodes } = await import('../harness-gan-graph.js');
    const nodes = createGanContractNodes(null, makeCtx());
    const newState = await nodes.reviewer({ prdContent: '# PRD', contractContent: '# C', round: 1, costUsd: 0 });
    expect(newState.verdict).toBe('APPROVED');
  });

  it('reviewer node: rubric 一维 < 阈值 → REVISION（即使文件 verdict 说 APPROVED）', async () => {
    mockSpawnDetached.mockImplementationOnce(async () => {
      writeFileSync(path.join(tmpWt, '.brain-result.json'),
        JSON.stringify({ verdict: 'APPROVED', rubric_scores: RUBRIC_RISK_FAIL, feedback: 'fb' }));
    });
    mockInterrupt.mockReturnValueOnce({ exit_code: 0, stdout: '' });
    // 下面的旧 writeFileSync 保留以防 spawnDetached 未能覆盖
    const { createGanContractNodes } = await import('../harness-gan-graph.js');
    const nodes = createGanContractNodes(null, makeCtx());
    const newState = await nodes.reviewer({ prdContent: '# PRD', contractContent: '# C', round: 1, costUsd: 0 });
    expect(newState.verdict).toBe('REVISION');
  });

  it('reviewer node: 空 rubric_scores → fallback 到 file verdict（向后兼容）', async () => {
    mockSpawnDetached.mockImplementationOnce(async () => {
      writeFileSync(path.join(tmpWt, '.brain-result.json'),
        JSON.stringify({ verdict: 'APPROVED', rubric_scores: {}, feedback: '' }));
    });
    mockInterrupt.mockReturnValueOnce({ exit_code: 0, stdout: '' });
    const { createGanContractNodes } = await import('../harness-gan-graph.js');
    const nodes = createGanContractNodes(null, makeCtx());
    const newState = await nodes.reviewer({ prdContent: '# PRD', contractContent: '# C', round: 1, costUsd: 0 });
    expect(newState.verdict).toBe('APPROVED');
  });

  it('reviewer node: round 3 阈值固定 7，rubric 全 =6 → REVISION（不再降阈值）', async () => {
    mockSpawnDetached.mockImplementationOnce(async () => {
      writeFileSync(path.join(tmpWt, '.brain-result.json'),
        JSON.stringify({ verdict: 'REVISION', rubric_scores: RUBRIC_ALL_SIX, feedback: '' }));
    });
    mockInterrupt.mockReturnValueOnce({ exit_code: 0, stdout: '' });
    const { createGanContractNodes } = await import('../harness-gan-graph.js');
    const nodes = createGanContractNodes(null, makeCtx());
    const newState = await nodes.reviewer({ prdContent: '# PRD', contractContent: '# C', round: 3, costUsd: 0 });
    expect(newState.verdict).toBe('REVISION');
  });
});

// WS3 async: runGanContractGraph は kickoff モード（interrupt で止まる）
// 旧 e2e ループテストは削除し、kickoff 動作のみ検証
describe('runGanContractGraph', () => {
  let tmpWt;
  beforeEach(() => {
    tmpWt = mkdtempSync(path.join(tmpdir(), 'gan-run-test-'));
    mockSpawnDetached.mockReset().mockResolvedValue(undefined);
    mockInterrupt.mockReset().mockReturnValue({ exit_code: 0, stdout: '' });
    mockDbQuery.mockReset().mockResolvedValue({ rows: [] });
  });
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
      verifyProposer: vi.fn(async () => undefined),
      checkpointer: new MemorySaver(),
      ...overrides,
    };
  }

  it.skip('WS3 kickoff: runGanContractGraph 返回 {kickoff: true, thread_id}，不再阻塞 [需真实 GraphInterrupt，不兼容 mock interrupt]', async () => {
    // spawnDetached 模拟 proposer 容器写入 brain-result（包含 propose_branch）
    mockSpawnDetached.mockImplementationOnce(async () => {
      writeFileSync(path.join(tmpWt, '.brain-result.json'),
        JSON.stringify({ propose_branch: 'cp-harness-propose-r1-task-e2e' }));
    });
    const { runGanContractGraph } = await import('../harness-gan-graph.js');
    const res = await runGanContractGraph(makeOpts());
    expect(res.kickoff).toBe(true);
    expect(res.thread_id).toBe('task-e2e-1');
    expect(mockSpawnDetached).toHaveBeenCalledTimes(1);
    const opts = mockSpawnDetached.mock.calls[0][0];
    expect(opts.env.HARNESS_CALLBACK_URL).toContain('/api/brain/harness/callback/');
  });

  it('WS3 kickoff: checkpointer required — 缺少时 throw', async () => {
    const { runGanContractGraph } = await import('../harness-gan-graph.js');
    await expect(runGanContractGraph({ ...makeOpts(), checkpointer: undefined }))
      .rejects.toThrow(/checkpointer is required/);
  });

  it('WS3 kickoff: taskId required', async () => {
    const { runGanContractGraph } = await import('../harness-gan-graph.js');
    await expect(runGanContractGraph({ ...makeOpts(), taskId: undefined }))
      .rejects.toThrow(/taskId.*required/);
  });
});

