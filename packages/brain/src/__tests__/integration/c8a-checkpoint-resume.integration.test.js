/**
 * Brain v2 C8a — harness-initiative graph checkpoint/resume E2E
 *
 * 验证：
 *   1. compileHarnessInitiativeGraph + invoke (thread_id="e2e-test-1") 跑通 5 节点
 *   2. checkpointer.put 调用 >= 5 次（每节点 1 checkpoint，对应 PostgresSaver 表写入）
 *   3. 模拟 Brain 重启：新 graph instance 复用同一 saver
 *   4. graph.getState({thread_id:"e2e-test-1"}) 验 5 channel 全恢复
 *      （worktreePath / plannerOutput / taskPlan / ganResult / result）
 *   5. 同 thread_id 第二次 invoke (null input) → 5 个节点幂等门触发，spawn mock not called
 *
 * mock 策略：
 *   - 真用 MemorySaver 模拟 PostgresSaver（pg-checkpointer.js 也 fallback to MemorySaver）
 *   - getPgCheckpointer mock 返回同一 saver 实例（测试要在 invoke 间保持 state）
 *   - spawn / pool / worktree / git token 等真依赖全 mock
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { MemorySaver } from '@langchain/langgraph';

// 只 hoist 纯 vi.fn mock；saver 创建放 beforeAll，避免 hoist 时 MemorySaver 未 init
const { mockSpawn, mockEnsureWt, mockResolveTok, mockParseTaskPlan,
        mockUpsertTaskPlan, mockRunGan, mockReadFile, mockClient, mockPool } =
  vi.hoisted(() => {
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
      mockPool: { connect: vi.fn().mockResolvedValue(client), query: vi.fn() },
    };
  });

// non-hoisted module-level saver — vi.mock 工厂闭包引用，调用时（runtime）已 init
let saver;

vi.mock('../../db.js', () => ({ default: mockPool }));
vi.mock('../../spawn/index.js', () => ({ spawn: (...a) => mockSpawn(...a) }));
vi.mock('../../harness-worktree.js', () => ({ ensureHarnessWorktree: (...a) => mockEnsureWt(...a) }));
vi.mock('../../harness-credentials.js', () => ({ resolveGitHubToken: (...a) => mockResolveTok(...a) }));
vi.mock('../../harness-graph.js', () => ({
  parseDockerOutput: (s) => s,
  loadSkillContent: () => 'SKILL CONTENT',
}));
vi.mock('../../harness-dag.js', () => ({
  parseTaskPlan: (...a) => mockParseTaskPlan(...a),
  upsertTaskPlan: (...a) => mockUpsertTaskPlan(...a),
}));
vi.mock('../../harness-gan-graph.js', () => ({ runGanContractGraph: (...a) => mockRunGan(...a) }));
vi.mock('node:fs/promises', () => ({
  default: { readFile: (...a) => mockReadFile(...a) },
  readFile: (...a) => mockReadFile(...a),
}));
vi.mock('../../orchestrator/pg-checkpointer.js', () => ({
  getPgCheckpointer: vi.fn(async () => saver),
  _resetPgCheckpointerForTests: () => {},
}));

import { compileHarnessInitiativeGraph } from '../../workflows/harness-initiative.graph.js';

const THREAD_ID = 'e2e-test-1';

function setupHappyMocks() {
  mockEnsureWt.mockResolvedValue('/wt/e2e');
  mockResolveTok.mockResolvedValue('ghp_test');
  mockSpawn.mockResolvedValue({ exit_code: 0, stdout: 'STUB OUT', stderr: '' });
  mockReadFile.mockResolvedValue('# E2E PRD content');
  mockParseTaskPlan.mockReturnValue({ initiative_id: 'init-e2e', tasks: [] });
  mockRunGan.mockResolvedValue({ contract_content: 'C', rounds: 2, propose_branch: 'b' });
  mockUpsertTaskPlan.mockResolvedValue({ idMap: {}, insertedTaskIds: ['t1'] });

  // dbUpsertNode 期待 BEGIN → INSERT contracts → INSERT runs → COMMIT
  mockClient.query.mockReset();
  mockClient.query
    .mockResolvedValueOnce({ rows: [] })                          // BEGIN
    .mockResolvedValueOnce({ rows: [{ id: 'contract-uuid' }] })   // INSERT initiative_contracts
    .mockResolvedValueOnce({ rows: [{ id: 'run-uuid' }] })        // INSERT initiative_runs
    .mockResolvedValueOnce({ rows: [] });                         // COMMIT
}

describe('C8a checkpoint resume integration E2E', () => {
  beforeAll(() => {
    saver = new MemorySaver();
  });

  beforeEach(() => {
    mockSpawn.mockReset();
    mockEnsureWt.mockReset();
    mockResolveTok.mockReset();
    mockParseTaskPlan.mockReset();
    mockUpsertTaskPlan.mockReset();
    mockRunGan.mockReset();
    mockReadFile.mockReset();
    mockClient.query.mockReset();
    mockClient.release.mockReset();
    setupHappyMocks();
  });

  it('compile + invoke 跑通 5 节点 → checkpointer.put 调用 >= 5 次', async () => {
    // 重新 init saver 让 put count 干净
    saver = new MemorySaver();
    const putSpy = vi.spyOn(saver, 'put');

    const compiled = await compileHarnessInitiativeGraph();
    const final = await compiled.invoke(
      { task: { id: 'init-e2e-1', payload: { initiative_id: 'init-e2e' } } },
      { configurable: { thread_id: THREAD_ID }, recursionLimit: 50 }
    );

    // 跑通到 dbUpsert：result 含 contractId + runId
    expect(final.result?.contractId).toBe('contract-uuid');
    expect(final.result?.runId).toBe('run-uuid');
    expect(final.result?.success).toBe(true);

    // 5 节点 graph，put 至少 5 次（每节点 1 checkpoint）
    expect(putSpy.mock.calls.length).toBeGreaterThanOrEqual(5);
  });

  it('Brain 重启：新 graph instance 复用 saver → getState 5 channel 全恢复', async () => {
    saver = new MemorySaver();

    // 第一次 invoke：把 state 写到 saver
    const compiled1 = await compileHarnessInitiativeGraph();
    await compiled1.invoke(
      { task: { id: 'init-e2e-1', payload: { initiative_id: 'init-e2e' } } },
      { configurable: { thread_id: THREAD_ID }, recursionLimit: 50 }
    );

    // 模拟 Brain 重启：新 graph instance（compileHarnessInitiativeGraph 第二次调返回新 compiled
    // graph，getPgCheckpointer mock 返回同一 saver — state 通过 saver 持久化）
    setupHappyMocks();
    const compiled2 = await compileHarnessInitiativeGraph();

    const stateSnap = await compiled2.getState({ configurable: { thread_id: THREAD_ID } });
    const ch = stateSnap?.values || {};
    expect(ch.worktreePath).toBe('/wt/e2e');
    expect(ch.plannerOutput).toBe('STUB OUT');
    expect(ch.taskPlan).toBeDefined();
    expect(ch.taskPlan.initiative_id).toBe('init-e2e');
    expect(ch.ganResult).toEqual({ contract_content: 'C', rounds: 2, propose_branch: 'b' });
    expect(ch.result).toBeDefined();
    expect(ch.result.contractId).toBe('contract-uuid');
    expect(ch.result.runId).toBe('run-uuid');
  });

  it('同 thread_id 第二次 invoke (null input) → 节点幂等门触发，spawn 不再被调', async () => {
    saver = new MemorySaver();

    // 首次 invoke 把 state 写到 saver
    const compiled1 = await compileHarnessInitiativeGraph();
    await compiled1.invoke(
      { task: { id: 'init-e2e-1', payload: { initiative_id: 'init-e2e' } } },
      { configurable: { thread_id: THREAD_ID }, recursionLimit: 50 }
    );
    const firstCallCount = mockSpawn.mock.calls.length;
    expect(firstCallCount).toBeGreaterThanOrEqual(1); // planner 至少跑过

    // 第二次 invoke 同 thread_id：graph 已在 END，再 invoke 应不触发任何节点
    // （即便触发，幂等门也应让 spawn 不再被调）
    setupHappyMocks();
    mockSpawn.mockClear();
    mockEnsureWt.mockClear();
    mockRunGan.mockClear();

    const compiled2 = await compileHarnessInitiativeGraph();
    await compiled2.invoke(
      null, // null input → resume from saved state
      { configurable: { thread_id: THREAD_ID }, recursionLimit: 50 }
    );

    // 幂等门：所有节点首句 if (state.X) return → 不会 spawn 不会 ensureWorktree 不会 runGan
    expect(mockSpawn).not.toHaveBeenCalled();
    expect(mockEnsureWt).not.toHaveBeenCalled();
    expect(mockRunGan).not.toHaveBeenCalled();
  });
});
