import { describe, it, expect, vi } from 'vitest';

function baseOpts(overrides = {}) {
  return {
    taskId: 'task-abcdef1234567890',
    initiativeId: 'init-xxx',
    sprintDir: 'sprints/test',
    prdContent: '# PRD\n\nGoal: build X',
    worktreePath: '/tmp/wt/harness-v2/task-abcdef12',
    githubToken: 'ghs_test',
    budgetCapUsd: 10,
    ...overrides,
  };
}

describe('runGanContractLoop', () => {
  it('round 1 APPROVED → returns rounds=1 contract_content', async () => {
    const reads = [];
    const executor = vi.fn(async (opts) => {
      if (opts.task.task_type === 'harness_contract_propose') {
        return { exit_code: 0, stdout: 'proposer-1 stdout', stderr: '', cost_usd: 0.1, timed_out: false };
      }
      return { exit_code: 0, stdout: 'analysis...\nVERDICT: APPROVED\n', stderr: '', cost_usd: 0.05, timed_out: false };
    });
    const readContractFile = vi.fn(async (wt, sd) => { reads.push([wt, sd]); return '# Contract R1'; });
    const { runGanContractLoop } = await import('../harness-gan-loop.js');
    const res = await runGanContractLoop({ ...baseOpts(), executor, readContractFile });
    expect(res.rounds).toBe(1);
    expect(res.contract_content).toBe('# Contract R1');
    expect(res.cost_usd).toBeCloseTo(0.15, 3);
    expect(executor).toHaveBeenCalledTimes(2);
  });

  it('round 1 REVISION → round 2 APPROVED; round 2 proposer prompt includes feedback', async () => {
    const capturedPrompts = [];
    let proposerCalls = 0;
    const executor = vi.fn(async (opts) => {
      if (opts.task.task_type === 'harness_contract_propose') {
        proposerCalls++;
        capturedPrompts.push(opts.prompt);
        return { exit_code: 0, stdout: `proposer-${proposerCalls}`, stderr: '', cost_usd: 0.1, timed_out: false };
      }
      if (proposerCalls === 1) {
        return { exit_code: 0, stdout: '[Reviewer analysis]\nRisk: X unclear\nRisk: Y underspecified\n\nVERDICT: REVISION', stderr: '', cost_usd: 0.05, timed_out: false };
      }
      return { exit_code: 0, stdout: 'looks good\nVERDICT: APPROVED', stderr: '', cost_usd: 0.05, timed_out: false };
    });
    const readContractFile = vi.fn(async () => 'contract-roundN');
    const { runGanContractLoop } = await import('../harness-gan-loop.js');
    const res = await runGanContractLoop({ ...baseOpts(), executor, readContractFile });
    expect(res.rounds).toBe(2);
    expect(capturedPrompts.length).toBe(2);
    expect(capturedPrompts[0]).not.toMatch(/Risk: X unclear/);
    expect(capturedPrompts[1]).toMatch(/Risk: X unclear/);
    expect(capturedPrompts[1]).toMatch(/Risk: Y underspecified/);
  });

  it('accumulated cost exceeds budget → throws gan_budget_exceeded', async () => {
    const executor = vi.fn(async () => ({ exit_code: 0, stdout: 'VERDICT: REVISION', stderr: '', cost_usd: 3, timed_out: false }));
    const readContractFile = vi.fn(async () => 'c');
    const { runGanContractLoop } = await import('../harness-gan-loop.js');
    await expect(
      runGanContractLoop({ ...baseOpts({ budgetCapUsd: 5 }), executor, readContractFile })
    ).rejects.toThrow(/gan_budget_exceeded/);
  });

  it('proposer exit!=0 → throws proposer_failed', async () => {
    const executor = vi.fn(async () => ({ exit_code: 1, stdout: '', stderr: 'boom', cost_usd: 0.1, timed_out: false }));
    const readContractFile = vi.fn(async () => 'c');
    const { runGanContractLoop } = await import('../harness-gan-loop.js');
    await expect(
      runGanContractLoop({ ...baseOpts(), executor, readContractFile })
    ).rejects.toThrow(/proposer_failed/);
  });

  it('reviewer stdout has no VERDICT → treated as REVISION (continues)', async () => {
    let proposerCalls = 0;
    const executor = vi.fn(async (opts) => {
      if (opts.task.task_type === 'harness_contract_propose') {
        proposerCalls++;
        return { exit_code: 0, stdout: `p${proposerCalls}`, stderr: '', cost_usd: 0.1, timed_out: false };
      }
      if (proposerCalls === 1) return { exit_code: 0, stdout: 'no verdict text', stderr: '', cost_usd: 0.05, timed_out: false };
      return { exit_code: 0, stdout: 'VERDICT: APPROVED', stderr: '', cost_usd: 0.05, timed_out: false };
    });
    const readContractFile = vi.fn(async () => 'c');
    const { runGanContractLoop } = await import('../harness-gan-loop.js');
    const res = await runGanContractLoop({ ...baseOpts(), executor, readContractFile });
    expect(res.rounds).toBe(2);
  });
});
