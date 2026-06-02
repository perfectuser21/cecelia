/**
 * B55: GAN abort 传播测试
 *
 * OPEN-5: GAN abort 时 tasks.status 未更新为 failed
 * OPEN-6: initiative_runs 只在 GAN 成功后创建，GAN abort 无 run 记录
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all external dependencies before importing
vi.mock('../../db.js', () => ({ default: { query: vi.fn(), connect: vi.fn() } }));
vi.mock('../../spawn/index.js', () => ({ spawn: vi.fn() }));
vi.mock('../../spawn/detached.js', () => ({ spawnDockerDetached: vi.fn() }));
vi.mock('../../harness-shared.js', () => ({
  parseDockerOutput: (s) => s,
  loadSkillContent: () => 'SKILL',
}));
vi.mock('../../harness-dag.js', () => ({
  parseTaskPlan: vi.fn().mockReturnValue(null),
  upsertTaskPlan: vi.fn(),
}));
vi.mock('../../harness-worktree.js', () => ({ ensureHarnessWorktree: vi.fn() }));
vi.mock('../../harness-credentials.js', () => ({ resolveGitHubToken: vi.fn() }));
vi.mock('../../harness-container-cleanup.js', () => ({ killInitiativeContainers: vi.fn() }));
vi.mock('../../lib/git-fence.js', () => ({ fetchAndShowOriginFile: vi.fn() }));
vi.mock('../../harness-gan-graph.js', () => ({ runGanContractGraph: vi.fn() }));
vi.mock('../../orchestrator/pg-checkpointer.js', () => ({
  getPgCheckpointer: vi.fn().mockResolvedValue({
    get: vi.fn().mockResolvedValue(null), put: vi.fn(), setup: vi.fn(),
    list: vi.fn().mockResolvedValue([]), getTuple: vi.fn().mockResolvedValue(null), putWrites: vi.fn(),
  }),
}));
vi.mock('../../spawn/middleware/account-rotation.js', () => ({ resolveAccount: vi.fn() }));

import {
  InitiativeState,
  prepInitiativeNode,
  runGanLoopNode,
  dbUpsertNode,
} from '../harness-initiative.graph.js';
import { ensureHarnessWorktree } from '../../harness-worktree.js';
import { resolveGitHubToken } from '../../harness-credentials.js';
import { runGanContractGraph } from '../../harness-gan-graph.js';

// ────────────────────────────────────────────────────────────
// InitiativeState schema
// ────────────────────────────────────────────────────────────
describe('InitiativeState schema', () => {
  it('有 initiative_run_id 字段，默认 null', () => {
    const defaults = {};
    for (const [k, ann] of Object.entries(InitiativeState.spec)) {
      defaults[k] = ann.default?.();
    }
    expect('initiative_run_id' in defaults).toBe(true);
    expect(defaults.initiative_run_id).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────
// OPEN-6: prepInitiativeNode 建 worktree 后 INSERT initiative_runs
// ────────────────────────────────────────────────────────────
describe('OPEN-6: prepInitiativeNode 建 initiative_runs（A_contract）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('worktree 建好后调用 pool.query INSERT initiative_runs，返回 initiative_run_id', async () => {
    const mockRunId = 'run-uuid-1234';
    ensureHarnessWorktree.mockResolvedValue('/tmp/worktree-test');
    resolveGitHubToken.mockResolvedValue('ghp_test_token');

    const mockPool = {
      query: vi.fn().mockImplementation((sql) => {
        if (sql.includes('INSERT INTO initiative_runs')) {
          return Promise.resolve({ rows: [{ id: mockRunId }] });
        }
        return Promise.resolve({ rows: [] });
      }),
    };

    const state = {
      task: {
        id: 'task-uuid-5555',
        payload: {
          journey_id: 'journey-uuid-111',
          journey_type: 'autonomous',
        },
      },
      worktreePath: null,
      initiativeId: null,
    };

    const result = await prepInitiativeNode(state, { pool: mockPool });

    // 应该返回 initiative_run_id
    expect(result.initiative_run_id).toBe(mockRunId);
    expect(result.worktreePath).toBe('/tmp/worktree-test');
    expect(result.initiativeId).toBe('task-uuid-5555');

    // pool.query 必须被调用过，且有一次包含 INSERT INTO initiative_runs
    const allCalls = mockPool.query.mock.calls;
    const insertRunCall = allCalls.find(([sql]) => sql.includes('INSERT INTO initiative_runs'));
    expect(insertRunCall).toBeDefined();

    // 验证 INSERT 包含 phase='A_contract'
    expect(insertRunCall[0]).toContain('A_contract');
    // 验证 initiative_id 传入正确
    expect(insertRunCall[1]).toContain('task-uuid-5555');
  });

  it('幂等门：worktreePath 已存在时不重复 INSERT，直接 passthrough', async () => {
    const mockPool = { query: vi.fn() };

    const state = {
      task: { id: 'task-uuid-5555', payload: {} },
      worktreePath: '/already/exists',
      initiative_run_id: 'existing-run-id',
    };

    const result = await prepInitiativeNode(state, { pool: mockPool });

    // 幂等：已有 worktreePath 不再 INSERT
    expect(result.worktreePath).toBe('/already/exists');
    expect(mockPool.query).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────
// OPEN-5: runGanLoopNode GAN 失败时更新 tasks + initiative_runs
// ────────────────────────────────────────────────────────────
describe('OPEN-5: runGanLoopNode GAN abort 传播到 tasks 和 initiative_runs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GAN 抛错时，pool.query 被调用且包含 UPDATE tasks SET status=failed', async () => {
    const ganError = new Error('GAN converge failed: budget exhausted');
    runGanContractGraph.mockRejectedValue(ganError);

    const queryMock = vi.fn().mockResolvedValue({ rows: [] });
    const mockPool = { query: queryMock };

    const state = {
      task: { id: 'task-uuid-5555', payload: { sprint_dir: 'sprints', budget_usd: 10 } },
      initiativeId: 'task-uuid-5555',
      initiative_run_id: 'run-uuid-1234',
      worktreePath: '/tmp/worktree',
      githubToken: 'ghp_test',
      prdContent: 'PRD content',
      plannerOutput: '',
      sprintDir: 'sprints',
      ganResult: null,
    };

    const result = await runGanLoopNode(state, { pool: mockPool });

    // 返回 error state
    expect(result.error).toBeDefined();
    expect(result.error.node).toBe('gan');
    expect(result.error.message).toContain('GAN converge failed');

    // pool.query 必须被调用，且至少一次包含 UPDATE tasks
    const allCalls = queryMock.mock.calls;
    const updateTasksCall = allCalls.find(([sql]) =>
      sql.includes('UPDATE tasks') && sql.includes("status='failed'")
    );
    expect(updateTasksCall).toBeDefined();

    // 验证 task_id 传入正确
    expect(updateTasksCall[1]).toContain('task-uuid-5555');
  });

  it('GAN 抛错时，pool.query 包含 UPDATE initiative_runs SET phase=failed', async () => {
    const ganError = new Error('GAN abort: reviewer rejected all proposals');
    runGanContractGraph.mockRejectedValue(ganError);

    const queryMock = vi.fn().mockResolvedValue({ rows: [] });
    const mockPool = { query: queryMock };

    const state = {
      task: { id: 'task-uuid-5555', payload: { sprint_dir: 'sprints', budget_usd: 10 } },
      initiativeId: 'task-uuid-5555',
      initiative_run_id: 'run-uuid-1234',
      worktreePath: '/tmp/worktree',
      githubToken: 'ghp_test',
      prdContent: 'PRD content',
      plannerOutput: '',
      sprintDir: 'sprints',
      ganResult: null,
    };

    const result = await runGanLoopNode(state, { pool: mockPool });

    expect(result.error).toBeDefined();

    // pool.query 必须有一次包含 UPDATE initiative_runs
    const allCalls = queryMock.mock.calls;
    const updateRunCall = allCalls.find(([sql]) =>
      sql.includes('UPDATE initiative_runs') && sql.includes('failed')
    );
    expect(updateRunCall).toBeDefined();

    // 验证 run_id 传入正确
    expect(updateRunCall[1]).toContain('run-uuid-1234');
  });

  it('initiative_run_id 为 null 时，GAN abort 只更新 tasks，不崩溃', async () => {
    const ganError = new Error('GAN abort');
    runGanContractGraph.mockRejectedValue(ganError);

    const queryMock = vi.fn().mockResolvedValue({ rows: [] });
    const mockPool = { query: queryMock };

    const state = {
      task: { id: 'task-uuid-5555', payload: {} },
      initiativeId: 'task-uuid-5555',
      initiative_run_id: null,  // 没有 run_id
      worktreePath: '/tmp/worktree',
      githubToken: 'ghp_test',
      prdContent: '',
      plannerOutput: '',
      sprintDir: 'sprints',
      ganResult: null,
    };

    // 不应抛出
    const result = await runGanLoopNode(state, { pool: mockPool });
    expect(result.error).toBeDefined();
    expect(result.error.node).toBe('gan');

    // tasks 仍然被更新
    const updateTasksCall = queryMock.mock.calls.find(([sql]) =>
      sql.includes('UPDATE tasks') && sql.includes("status='failed'")
    );
    expect(updateTasksCall).toBeDefined();
  });
});

// ────────────────────────────────────────────────────────────
// OPEN-6: dbUpsertNode 有 initiative_run_id 时 UPDATE 而非 INSERT
// ────────────────────────────────────────────────────────────
describe('OPEN-6: dbUpsertNode initiative_runs UPDATE vs INSERT', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('state.initiative_run_id 存在时，用 UPDATE initiative_runs 而非 INSERT', async () => {
    const mockClient = {
      query: vi.fn().mockImplementation((sql) => {
        if (sql.includes('INSERT INTO initiative_contracts')) {
          return Promise.resolve({ rows: [{ id: 'contract-uuid' }] });
        }
        if (sql.includes('UPDATE initiative_runs')) {
          return Promise.resolve({ rows: [] });
        }
        if (sql.includes('BEGIN') || sql.includes('COMMIT')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      }),
      release: vi.fn(),
    };

    const mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
    };

    const { upsertTaskPlan } = await import('../../harness-dag.js');
    upsertTaskPlan.mockResolvedValue({ idMap: {}, insertedTaskIds: [] });

    const state = {
      task: {
        id: 'task-uuid-5555',
        payload: { journey_id: 'journey-uuid', budget_usd: 10, timeout_sec: 3600 },
      },
      initiativeId: 'task-uuid-5555',
      initiative_run_id: 'run-uuid-1234',  // 已有 run_id
      taskPlan: { journey_type: 'autonomous' },
      plannerOutput: 'PRD output',
      ganResult: {
        contract_content: 'contract content',
        rounds: 2,
        propose_branch: 'cp-test-branch',
        verdict: 'PASS',
      },
      sprintDir: 'sprints',
      result: null,
    };

    await dbUpsertNode(state, { pool: mockPool });

    const allCalls = mockClient.query.mock.calls;

    // 不应有 INSERT INTO initiative_runs
    const insertRunCall = allCalls.find(([sql]) =>
      sql.includes('INSERT INTO initiative_runs')
    );
    expect(insertRunCall).toBeUndefined();

    // 必须有 UPDATE initiative_runs
    const updateRunCall = allCalls.find(([sql]) =>
      sql.includes('UPDATE initiative_runs')
    );
    expect(updateRunCall).toBeDefined();

    // UPDATE 应该把 phase 改为 B_task_loop，设置 contract_id
    expect(updateRunCall[0]).toMatch(/B_task_loop/);
  });

  it('state.initiative_run_id 为 null 时 fallback 到 INSERT initiative_runs', async () => {
    const mockClient = {
      query: vi.fn().mockImplementation((sql) => {
        if (sql.includes('INSERT INTO initiative_contracts')) {
          return Promise.resolve({ rows: [{ id: 'contract-uuid' }] });
        }
        if (sql.includes('INSERT INTO initiative_runs')) {
          return Promise.resolve({ rows: [{ id: 'new-run-uuid' }] });
        }
        if (sql.includes('BEGIN') || sql.includes('COMMIT')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      }),
      release: vi.fn(),
    };

    const mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
    };

    const { upsertTaskPlan } = await import('../../harness-dag.js');
    upsertTaskPlan.mockResolvedValue({ idMap: {}, insertedTaskIds: [] });

    const state = {
      task: {
        id: 'task-uuid-5555',
        payload: { journey_id: 'journey-uuid', budget_usd: 10, timeout_sec: 3600 },
      },
      initiativeId: 'task-uuid-5555',
      initiative_run_id: null,  // 无 run_id → fallback INSERT
      taskPlan: { journey_type: 'autonomous' },
      plannerOutput: 'PRD output',
      ganResult: {
        contract_content: 'contract content',
        rounds: 1,
        propose_branch: 'cp-test-branch',
        verdict: 'PASS',
      },
      sprintDir: 'sprints',
      result: null,
    };

    await dbUpsertNode(state, { pool: mockPool });

    const allCalls = mockClient.query.mock.calls;

    // 应该有 INSERT INTO initiative_runs（fallback）
    const insertRunCall = allCalls.find(([sql]) =>
      sql.includes('INSERT INTO initiative_runs')
    );
    expect(insertRunCall).toBeDefined();
  });
});
