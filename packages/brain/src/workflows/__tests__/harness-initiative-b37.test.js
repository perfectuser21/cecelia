import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted 确保 mockExecFile 在 vi.mock 提升执行前就已定义
const { mockExecFile } = vi.hoisted(() => ({ mockExecFile: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: mockExecFile }));
// promisify 返回调用 mockExecFile 的 promise 包装
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
  upsertTaskPlan: vi.fn(),
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
}));

import { parsePrdNode } from '../harness-initiative.graph.js';
import * as fsPromises from 'node:fs/promises';

describe('parsePrdNode — B37: git diff 找新 sprint 目录', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('git diff 找到新 sprint 目录，覆盖 plannerOutput 中错误的 regex 结果', async () => {
    // 模拟 planner 输出含错误的 w19 引用（B35/B36 失败场景）
    const plannerOutput = [
      'Existing sprints: {"sprint_dir": "sprints/w19-playground-sum"}',
      '{"verdict": "DONE", "sprint_dir": "sprints/w19-playground-sum", "branch": "cp-x"}',
    ].join('\n');

    // git diff 返回正确的新 sprint 文件
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      cb(null, 'sprints/w47-b37-test/sprint-prd.md\n', '');
    });
    fsPromises.readFile.mockResolvedValue('# PRD from correct sprint');

    const result = await parsePrdNode({
      worktreePath: '/fake/worktree',
      plannerOutput,
      task: { payload: { sprint_dir: 'sprints' } },
      initiativeId: 'test-initiative',
    });

    // git diff 结果应优先于 plannerOutput regex
    expect(result.sprintDir).toBe('sprints/w47-b37-test');
    expect(fsPromises.readFile).toHaveBeenCalledWith(
      '/fake/worktree/sprints/w47-b37-test/sprint-prd.md',
      'utf8'
    );
  });

  it('git diff 无新 sprint 文件时，使用 plannerOutput regex 的正确结果', async () => {
    const plannerOutput = '{"verdict":"DONE","sprint_dir":"sprints/w48-from-regex","branch":"cp-x"}';

    // git diff 返回空（非 sprints/ 下的文件）
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      cb(null, 'some-other-file.md\n', '');
    });
    fsPromises.readFile.mockResolvedValue('# PRD');

    const result = await parsePrdNode({
      worktreePath: '/fake/worktree',
      plannerOutput,
      task: { payload: { sprint_dir: 'sprints' } },
      initiativeId: 'test-initiative',
    });

    expect(result.sprintDir).toBe('sprints/w48-from-regex');
  });

  it('git diff 报错时 graceful fallback 到 plannerOutput regex', async () => {
    const plannerOutput = '{"verdict":"DONE","sprint_dir":"sprints/w49-fallback","branch":"cp-x"}';

    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      cb(new Error('git command failed'), '', '');
    });
    fsPromises.readFile.mockResolvedValue('# PRD');

    const result = await parsePrdNode({
      worktreePath: '/fake/worktree',
      plannerOutput,
      task: { payload: { sprint_dir: 'sprints' } },
      initiativeId: 'test-initiative',
    });

    expect(result.sprintDir).toBe('sprints/w49-fallback');
  });
});
