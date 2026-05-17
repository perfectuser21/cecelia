import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemorySaver } from '@langchain/langgraph';

const {
  mockSpawn, mockEnsureWt, mockResolveTok, mockParseTaskPlan, mockUpsertTaskPlan,
  mockRunGan, mockReadFile, mockClient, mockPool,
} = vi.hoisted(() => {
  const client = { query: vi.fn(), release: vi.fn() };
  return {
    mockSpawn: vi.fn(),
    mockEnsureWt: vi.fn(),
    mockResolveTok: vi.fn(),
    mockParseTaskPlan: vi.fn(),
    mockUpsertTaskPlan: vi.fn(),
    mockRunGan: vi.fn(),
    mockReadFile: vi.fn(),
    mockClient: client,
    mockPool: {
      connect: vi.fn().mockResolvedValue(client),
      query: vi.fn(),
    },
  };
});

vi.mock('../../db.js', () => ({ default: mockPool }));
vi.mock('../../spawn/index.js', () => ({ spawn: (...a) => mockSpawn(...a) }));
vi.mock('../../harness-worktree.js', () => ({ ensureHarnessWorktree: (...a) => mockEnsureWt(...a) }));
vi.mock('../../harness-credentials.js', () => ({ resolveGitHubToken: (...a) => mockResolveTok(...a) }));
vi.mock('../../docker-executor.js', () => ({
  writeDockerCallback: vi.fn(),
  executeInDocker: (...a) => mockSpawn(...a),
}));
vi.mock('../../spawn/detached.js', () => ({
  spawnDockerDetached: vi.fn(async (o) => ({ containerId: o.containerId })),
}));
vi.mock('../../shepherd.js', () => ({
  checkPrStatus: vi.fn(),
  executeMerge: vi.fn(),
  classifyFailedChecks: vi.fn(),
}));
vi.mock('../../harness-dag.js', () => ({
  parseTaskPlan: (...a) => mockParseTaskPlan(...a),
  upsertTaskPlan: (...a) => mockUpsertTaskPlan(...a),
}));
vi.mock('../../harness-gan-graph.js', () => ({
  runGanContractGraph: (...a) => mockRunGan(...a),
}));
vi.mock('../../harness-shared.js', () => ({
  parseDockerOutput: (s) => s,
  loadSkillContent: () => 'SKILL',
  extractField: () => null,
  readBrainResult: vi.fn().mockResolvedValue({ verdict: 'PASS', failed_scenarios: [] }),
}));
vi.mock('../../lib/git-fence.js', () => ({
  fetchAndShowOriginFile: vi.fn().mockResolvedValue(
    JSON.stringify({ tasks: [{ id: 'ws1', title: 'T1', dod: [], files: [] }] })
  ),
}));
vi.mock('node:fs/promises', () => ({
  default: { readFile: (...a) => mockReadFile(...a), readdir: vi.fn().mockResolvedValue([]) },
  readFile: (...a) => mockReadFile(...a),
  readdir: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../orchestrator/pg-checkpointer.js', () => ({
  getPgCheckpointer: vi.fn().mockResolvedValue(new MemorySaver()),
}));
vi.mock('../../harness-final-e2e.js', () => ({
  runScenarioCommand: vi.fn(() => ({ exitCode: 0, output: 'ok' })),
  bootstrapE2E: vi.fn(() => ({ exitCode: 0, output: 'ok' })),
  teardownE2E: vi.fn(() => ({ exitCode: 0, output: '' })),
  normalizeAcceptance: (a) => a,
  attributeFailures: () => new Map(),
}));

import { buildHarnessFullGraph } from '../harness-initiative.graph.js';

describe('B44 — harness pipeline A→B→C: phase=done DB writeback', () => {
  beforeEach(() => {
    [mockSpawn, mockEnsureWt, mockResolveTok, mockParseTaskPlan, mockUpsertTaskPlan,
      mockRunGan, mockReadFile, mockPool.query, mockClient.query, mockClient.release,
      mockPool.connect,
    ].forEach((m) => m.mockReset());
    mockClient.release.mockReturnValue(undefined);
    mockClient.query.mockResolvedValue({ rows: [] });
    // NOTE: mockPool.query fallback intentionally omitted — RED: reportNode throws when
    // pool.query returns undefined → test fails to prove assertion is load-bearing.
    mockPool.connect.mockResolvedValue(mockClient);
  });

  it('full graph A→B→C: reportNode writes phase=done to initiative_runs', async () => {
    // Phase A mocks
    mockEnsureWt.mockResolvedValue('/wt-b44');
    mockResolveTok.mockResolvedValue('tok-b44');
    mockSpawn.mockResolvedValue({ exit_code: 0, stdout: 'planner output', stderr: '' });
    mockReadFile.mockResolvedValue('# Sprint PRD b44');
    mockParseTaskPlan.mockReturnValue({
      initiative_id: 'b44-init',
      tasks: [{ id: 'ws1', title: 'T1', dod: [], files: [] }],
    });
    mockRunGan.mockResolvedValue({
      contract_content: '# Contract',
      rounds: 2,
      propose_branch: 'cp-b44-test',
    });
    // DB transaction sequence for Phase A dbUpsert
    mockClient.query
      .mockResolvedValueOnce({ rows: [] })                    // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'cid-b44' }] })  // INSERT initiative_contracts
      .mockResolvedValueOnce({ rows: [{ id: 'rid-b44' }] })  // INSERT initiative_runs
      .mockResolvedValueOnce({ rows: [] });                   // COMMIT
    mockUpsertTaskPlan.mockResolvedValue({ idMap: {}, insertedTaskIds: ['ws1'] });

    // Phase B+C injectable mocks
    const mockRunSubTaskFn = vi.fn(async (state) => ({
      sub_tasks: [{ id: state.sub_task?.id, status: 'merged', pr_url: 'https://github.com/fake/pr/1' }],
    }));
    const mockFinalEvaluateFn = vi.fn(async () => ({
      final_e2e_verdict: 'PASS',
      final_e2e_failed_scenarios: [],
    }));

    const compiled = buildHarnessFullGraph({
      runSubTaskFn: mockRunSubTaskFn,
      finalEvaluateFn: mockFinalEvaluateFn,
    }).compile({ checkpointer: new MemorySaver() });

    const final = await compiled.invoke(
      { task: { id: 'b44-init', payload: { initiative_id: 'b44-init' } } },
      { configurable: { thread_id: 'b44:1' }, recursionLimit: 500 }
    );

    // B→C transition assertions (same as B43)
    expect(mockRunSubTaskFn).toHaveBeenCalledTimes(1);
    expect(mockFinalEvaluateFn).toHaveBeenCalledTimes(1);
    expect(final.final_e2e_verdict).toBe('PASS');

    // B44-specific: assert reportNode called pool.query with phase='done'
    const phaseCalls = mockPool.query.mock.calls.filter(
      ([sql, params]) =>
        typeof sql === 'string' &&
        sql.includes('phase') &&
        Array.isArray(params) &&
        params.includes('done')
    );
    expect(phaseCalls.length).toBeGreaterThan(0);
  }, 8000);
});
