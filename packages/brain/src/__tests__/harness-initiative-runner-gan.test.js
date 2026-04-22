import { describe, it, expect, vi } from 'vitest';

describe('runInitiative GAN integration', () => {
  it('runs planner + GAN then writes approved contract + B_task_loop run', async () => {
    vi.resetModules();
    vi.doMock('../harness-worktree.js', () => ({
      ensureHarnessWorktree: vi.fn(async () => '/tmp/wt/harness-v2/task-abcdef12'),
      cleanupHarnessWorktree: vi.fn(),
    }));
    vi.doMock('../harness-credentials.js', () => ({
      resolveGitHubToken: vi.fn(async () => 'ghs_test'),
    }));
    vi.doMock('../harness-gan-graph.js', () => ({
      runGanContractGraph: vi.fn(async () => ({
        contract_content: '# Final Contract',
        rounds: 2,
        cost_usd: 0.3,
      })),
    }));

    const insertedContractArgs = [];
    const insertedRunArgs = [];
    const mockClient = {
      query: vi.fn(async (sql, params) => {
        if (/INSERT INTO initiative_contracts/i.test(sql)) {
          insertedContractArgs.push({ sql, params });
          return { rows: [{ id: 'contract-1' }] };
        }
        if (/INSERT INTO initiative_runs/i.test(sql)) {
          insertedRunArgs.push({ sql, params });
          return { rows: [{ id: 'run-1' }] };
        }
        if (/INSERT INTO tasks/i.test(sql)) {
          return { rows: [{ id: 'sub-task-1' }] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const mockPool = { connect: async () => mockClient };

    const validPlan = {
      initiative_id: 'i',
      tasks: [
        {
          task_id: 'ws1',
          title: 't',
          scope: 's',
          complexity: 'S',
          files: ['packages/brain/src/x.js'],
          dod: ['[BEHAVIOR] y'],
          depends_on: [],
          estimated_minutes: 30,
        },
      ],
    };
    const plannerStdout = JSON.stringify({
      type: 'result',
      result: '```json\n' + JSON.stringify(validPlan) + '\n```',
    });
    const mockExec = vi.fn(async () => ({ exit_code: 0, stdout: plannerStdout, stderr: '', timed_out: false }));

    const { runInitiative } = await import('../harness-initiative-runner.js');
    const res = await runInitiative(
      { id: 'task-abcdef1234567890', title: 'x', description: 'y' },
      { executor: mockExec, pool: mockPool }
    );

    expect(res.success).toBe(true);
    expect(insertedContractArgs.length).toBe(1);
    expect(insertedContractArgs[0].sql).toMatch(/approved/);
    expect(insertedContractArgs[0].params).toEqual(expect.arrayContaining(['# Final Contract']));
    expect(insertedRunArgs.length).toBe(1);
    expect(insertedRunArgs[0].sql).toMatch(/B_task_loop/);
  });

  it('returns {success:false} when GAN throws', async () => {
    vi.resetModules();
    vi.doMock('../harness-worktree.js', () => ({
      ensureHarnessWorktree: vi.fn(async () => '/tmp/wt/harness-v2/task-abcdef12'),
      cleanupHarnessWorktree: vi.fn(),
    }));
    vi.doMock('../harness-credentials.js', () => ({
      resolveGitHubToken: vi.fn(async () => 'ghs_test'),
    }));
    vi.doMock('../harness-gan-graph.js', () => ({
      runGanContractGraph: vi.fn(async () => { throw new Error('gan_budget_exceeded: spent=11 cap=10'); }),
    }));

    const mockClient = {
      query: vi.fn(async () => ({ rows: [] })),
      release: vi.fn(),
    };
    const mockPool = { connect: async () => mockClient };

    const validPlan = {
      initiative_id: 'i',
      tasks: [
        {
          task_id: 'ws1',
          title: 't',
          scope: 's',
          complexity: 'S',
          files: ['packages/brain/src/x.js'],
          dod: ['[BEHAVIOR] y'],
          depends_on: [],
          estimated_minutes: 30,
        },
      ],
    };
    const plannerStdout = JSON.stringify({
      type: 'result',
      result: '```json\n' + JSON.stringify(validPlan) + '\n```',
    });
    const mockExec = vi.fn(async () => ({ exit_code: 0, stdout: plannerStdout, stderr: '', timed_out: false }));

    const { runInitiative } = await import('../harness-initiative-runner.js');
    const res = await runInitiative(
      { id: 'task-abcdef1234567890', title: 'x', description: 'y' },
      { executor: mockExec, pool: mockPool }
    );

    expect(res.success).toBe(false);
    expect(String(res.error || '')).toMatch(/gan|budget/);
    expect(mockClient.query).not.toHaveBeenCalledWith(expect.stringMatching(/INSERT INTO initiative_contracts/));
  });
});
