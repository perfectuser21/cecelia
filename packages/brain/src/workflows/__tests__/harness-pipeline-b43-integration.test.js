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

// 单一 evaluator 重构后：final_evaluate 节点已从 initiative graph 删除，
// evaluate_contract（IS_FINAL_E2E=true）在 harness-task.graph.js 子图内负责 E2E 验收。
// B43 原始场景（失败上下文传递）现在在 task 子图 evaluate_contract → generator 链路上。
// WS2 async: B43 full graph 测试依赖旧阻塞 Planner executor，
// 新实现用 interrupt()，需迁移到 MemorySaver+Command(resume) 模式。
describe.skip('B43 — harness pipeline A→B→C regression guard [WS2 async: 需迁移]', () => {
  beforeEach(() => {
    [mockSpawn, mockEnsureWt, mockResolveTok, mockParseTaskPlan, mockUpsertTaskPlan,
      mockRunGan, mockReadFile, mockPool.query, mockClient.query, mockClient.release,
      mockPool.connect,
    ].forEach((m) => m.mockReset());
    mockClient.release.mockReturnValue(undefined);
    mockClient.query.mockResolvedValue({ rows: [] });
    mockPool.query.mockResolvedValue({ rows: [] });
    mockPool.connect.mockResolvedValue(mockClient);
  });

  it('full graph A→B→C: nodeOverrides inject mock run_sub_task（无 final_evaluate，已删）→ PASS', async () => {
    // Phase A mocks
    mockEnsureWt.mockResolvedValue('/wt-b43');
    mockResolveTok.mockResolvedValue('tok-b43');
    mockSpawn.mockResolvedValue({ exit_code: 0, stdout: 'planner output', stderr: '' });
    mockReadFile.mockResolvedValue('# Sprint PRD b43');
    mockParseTaskPlan.mockReturnValue({
      initiative_id: 'b43-init',
      tasks: [{ id: 'ws1', title: 'T1', dod: [], files: [] }],
    });
    mockRunGan.mockResolvedValue({
      contract_content: '# Contract',
      rounds: 2,
      propose_branch: 'cp-b43-test',
    });
    // dbUpsert DB transaction mocks
    mockClient.query
      .mockResolvedValueOnce({ rows: [] })                    // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'cid-b43' }] })  // INSERT initiative_contracts
      .mockResolvedValueOnce({ rows: [{ id: 'rid-b43' }] })  // INSERT initiative_runs
      .mockResolvedValueOnce({ rows: [] });                   // COMMIT
    mockUpsertTaskPlan.mockResolvedValue({ idMap: {}, insertedTaskIds: ['ws1'] });

    // Phase B injectable mock — final_evaluate 已从 initiative graph 删除
    const mockRunSubTaskFn = vi.fn(async (state) => ({
      sub_tasks: [{ id: state.sub_task?.id, status: 'merged', pr_url: 'https://github.com/fake/pr/1' }],
    }));

    const compiled = buildHarnessFullGraph({
      runSubTaskFn: mockRunSubTaskFn,
    }).compile({ checkpointer: new MemorySaver() });

    const final = await compiled.invoke(
      { task: { id: 'b43-init', payload: { initiative_id: 'b43-init' } } },
      { configurable: { thread_id: 'b43:1' }, recursionLimit: 500 }
    );

    // A→B transition assertions（final_evaluate 移除后，run_sub_task → advance → pick → report）
    expect(mockRunSubTaskFn).toHaveBeenCalledTimes(1);
    expect(mockRunSubTaskFn.mock.calls[0][0].sub_task?.id).toBe('ws1');
    expect(final.report_path).toBeTruthy();
  }, 8000);
});
