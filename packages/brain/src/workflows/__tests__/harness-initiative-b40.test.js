import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockExecFile } = vi.hoisted(() => ({ mockExecFile: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: mockExecFile }));
vi.mock('node:util', () => ({
  promisify: (fn) => (...args) => new Promise((resolve, reject) => {
    fn(...args, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve({ stdout, stderr });
    });
  }),
}));

vi.mock('../../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../../spawn/index.js', () => ({ spawn: vi.fn() }));
vi.mock('../../harness-shared.js', () => ({
  parseDockerOutput: (s) => s,
  loadSkillContent: () => 'SKILL',
}));
vi.mock('../../harness-dag.js', () => ({
  parseTaskPlan: vi.fn().mockReturnValue(null),
  upsertTaskPlan: vi.fn().mockResolvedValue({ idMap: {}, insertedTaskIds: ['task-uuid-1', 'task-uuid-2'] }),
}));
vi.mock('../../harness-final-e2e.js', () => ({ runFinalE2E: vi.fn(), attributeFailures: vi.fn() }));
vi.mock('../../harness-worktree.js', () => ({ ensureHarnessWorktree: vi.fn() }));
vi.mock('../../harness-credentials.js', () => ({ resolveGitHubToken: vi.fn() }));
vi.mock('../../lib/git-fence.js', () => ({ fetchAndShowOriginFile: vi.fn() }));
vi.mock('../../harness-gan-graph.js', () => ({ runGanContractGraph: vi.fn() }));
vi.mock('../../orchestrator/pg-checkpointer.js', () => ({
  getPgCheckpointer: vi.fn().mockResolvedValue({
    get: vi.fn().mockResolvedValue(null), put: vi.fn(), setup: vi.fn(),
    list: vi.fn().mockResolvedValue([]), getTuple: vi.fn().mockResolvedValue(null), putWrites: vi.fn(),
  }),
}));
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
  access: vi.fn(),
}));

import { parsePrdNode, dbUpsertNode } from '../harness-initiative.graph.js';
import * as fsPromises from 'node:fs/promises';
import * as harnessdag from '../../harness-dag.js';

describe('B40: parsePrdNode git log fallback + dbUpsertNode sprint_dir 写回', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('B40-1: git log 使用 log 而非 diff（验证命令第一个 arg）', async () => {
    let capturedArgs = null;
    mockExecFile.mockImplementation((_cmd, args, _opts, cb) => {
      if (!capturedArgs) capturedArgs = args;
      cb(null, 'sprints/ws2-test/sprint-prd.md\n', '');
    });
    fsPromises.readFile.mockResolvedValue('# PRD');

    const result = await parsePrdNode({
      worktreePath: '/fake/worktree',
      plannerOutput: '',
      task: { payload: { sprint_dir: 'sprints' } },
      initiativeId: 'test-init',
    });

    expect(capturedArgs[0]).toBe('log');
    expect(result.sprintDir).toBe('sprints/ws2-test');
  });

  it('B40-2: git log 返回空 + find 找到单个子目录 → 使用 find 结果', async () => {
    // Call 1: git log 返回空
    mockExecFile.mockImplementationOnce((_cmd, _args, _opts, cb) => {
      cb(null, '', '');
    });
    // Call 2: find 返回一个子目录
    mockExecFile.mockImplementationOnce((_cmd, _args, _opts, cb) => {
      cb(null, '/fake/worktree/sprints/ws3\n', '');
    });
    fsPromises.readFile.mockResolvedValue('# PRD content');

    const result = await parsePrdNode({
      worktreePath: '/fake/worktree',
      plannerOutput: '',
      task: { payload: { sprint_dir: 'sprints' } },
      initiativeId: 'test-init',
    });

    expect(result.sprintDir).toBe('sprints/ws3');
    expect(fsPromises.readFile).toHaveBeenCalledWith(
      '/fake/worktree/sprints/ws3/sprint-prd.md',
      'utf8'
    );
  });

  it('B40-3: dbUpsertNode 把 state.sprintDir 写回 insertedTaskIds 的 payload', async () => {
    // vi.resetAllMocks() 会清掉顶部 mock 的 return value，需重新设置
    vi.mocked(harnessdag.upsertTaskPlan).mockResolvedValue({ idMap: {}, insertedTaskIds: ['task-uuid-1', 'task-uuid-2'] });
    const mockClient = {
      query: vi.fn().mockImplementation((sql) => {
        if (typeof sql === 'string' && sql.includes('INSERT INTO initiative_contracts')) {
          return Promise.resolve({ rows: [{ id: 'contract-uuid-1' }], rowCount: 1 });
        }
        if (typeof sql === 'string' && sql.includes('INSERT INTO initiative_runs')) {
          return Promise.resolve({ rows: [{ id: 'run-uuid-1' }], rowCount: 1 });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      }),
      release: vi.fn(),
    };
    const mockPool = { connect: vi.fn().mockResolvedValue(mockClient) };

    try {
      await dbUpsertNode(
        {
          task: { id: 'init-1', payload: { sprint_dir: 'sprints', timeout_sec: 3600, budget_usd: 1 } },
          initiativeId: 'init-1',
          taskPlan: { tasks: [], dependencies: [] },
          ganResult: { propose_branch: 'cp-test', pr_url: null },
          prdContent: '# PRD',
          sprintDir: 'sprints/ws5',
        },
        { pool: mockPool }
      );
    } catch (_) { /* mock 不完整可能抛，忽略 */ }

    const sprintDirUpdate = mockClient.query.mock.calls.find(
      call => typeof call[0] === 'string' &&
              call[0].includes('UPDATE tasks') &&
              call[0].includes('ANY') &&
              Array.isArray(call[1]) && call[1].length >= 2 &&
              (() => { try { const p = JSON.parse(call[1][1]); return p.sprint_dir === 'sprints/ws5'; } catch { return false; } })()
    );
    expect(sprintDirUpdate).toBeTruthy();
  });
});
