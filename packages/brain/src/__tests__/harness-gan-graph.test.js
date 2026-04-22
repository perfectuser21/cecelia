import { describe, it, expect, vi } from 'vitest';
import {
  buildProposerPrompt,
  buildReviewerPrompt,
  extractVerdict,
  extractFeedback,
} from '../harness-gan-graph.js';

describe('buildProposerPrompt', () => {
  it('round 1 without feedback: PRD only', () => {
    const out = buildProposerPrompt('# PRD content', null, 1);
    expect(out).toContain('/harness-contract-proposer');
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
  it('round 1: PRD + contract + verdict instruction', () => {
    const out = buildReviewerPrompt('# PRD', '# Contract R1', 1);
    expect(out).toContain('/harness-contract-reviewer');
    expect(out).toContain('round: 1');
    expect(out).toContain('## Proposer 当前合同草案');
    expect(out).toContain('# Contract R1');
    expect(out).toContain('VERDICT: APPROVED');
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

describe('createGanContractNodes', () => {
  function makeCtx(overrides = {}) {
    return {
      taskId: 'task-123',
      initiativeId: 'init-1',
      sprintDir: 'sprints/demo',
      worktreePath: '/tmp/wt/demo',
      githubToken: 'ghs_test',
      readContractFile: vi.fn(async () => '# Contract content'),
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
});
