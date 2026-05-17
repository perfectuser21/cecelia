import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all external dependencies before importing harness-initiative.graph.js
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
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn(),
    setup: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
    getTuple: vi.fn().mockResolvedValue(null),
    putWrites: vi.fn(),
  }),
}));
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
}));

import { parsePrdNode } from '../harness-initiative.graph.js';
import * as fsPromises from 'node:fs/promises';

describe('parsePrdNode — B35: extract sprint_dir from planner verdict', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('从 planner verdict JSON 提取 sprint_dir，直接读对应子目录', async () => {
    const plannerOutput = JSON.stringify({
      verdict: 'DONE',
      branch: 'cp-w45-test',
      sprint_dir: 'sprints/w45-b35-test',
    });
    fsPromises.readFile.mockResolvedValue('# PRD content for w45');

    const result = await parsePrdNode({
      worktreePath: '/fake/worktree',
      plannerOutput,
      task: { payload: { sprint_dir: 'sprints' } },
      initiativeId: 'test-initiative',
    });

    expect(result.sprintDir).toBe('sprints/w45-b35-test');
    expect(result.prdContent).toBe('# PRD content for w45');
    expect(fsPromises.readFile).toHaveBeenCalledWith(
      '/fake/worktree/sprints/w45-b35-test/sprint-prd.md',
      'utf8'
    );
    expect(fsPromises.readdir).not.toHaveBeenCalled();
  });

  it('plannerOutput 不含 sprint_dir 时 fallback 到 payload', async () => {
    const plannerOutput = JSON.stringify({ verdict: 'DONE', branch: 'cp-test' });
    fsPromises.readFile.mockResolvedValue('# PRD from payload dir');

    const result = await parsePrdNode({
      worktreePath: '/fake/worktree',
      plannerOutput,
      task: { payload: { sprint_dir: 'sprints/w99-specific' } },
      initiativeId: 'test-initiative',
    });

    expect(result.sprintDir).toBe('sprints/w99-specific');
    expect(fsPromises.readFile).toHaveBeenCalledWith(
      '/fake/worktree/sprints/w99-specific/sprint-prd.md',
      'utf8'
    );
  });

  it('plannerOutput 非 JSON 时 graceful fallback', async () => {
    const plannerOutput = 'planner failed with some error text';
    fsPromises.readFile.mockResolvedValue('# PRD content');

    const result = await parsePrdNode({
      worktreePath: '/fake/worktree',
      plannerOutput,
      task: { payload: { sprint_dir: 'sprints/w88-fallback' } },
      initiativeId: 'test-initiative',
    });

    expect(result.sprintDir).toBe('sprints/w88-fallback');
  });

  it('plannerOutput 内嵌在多行文本中时用 regex 提取', async () => {
    const plannerOutput = 'Some prefix text\n{"verdict":"DONE","sprint_dir":"sprints/w77-embedded","branch":"cp-x"}';
    fsPromises.readFile.mockResolvedValue('# PRD');

    const result = await parsePrdNode({
      worktreePath: '/fake/worktree',
      plannerOutput,
      task: { payload: { sprint_dir: 'sprints' } },
      initiativeId: 'test-initiative',
    });

    expect(result.sprintDir).toBe('sprints/w77-embedded');
  });

  it('cache hit: taskPlan + prdContent 都存在时跳过重复执行', async () => {
    const result = await parsePrdNode({
      taskPlan: { tasks: [] },
      prdContent: '# cached',
      sprintDir: 'sprints/w-cached',
      worktreePath: '/fake',
      plannerOutput: '{}',
      task: { payload: {} },
      initiativeId: 'x',
    });

    expect(result.sprintDir).toBe('sprints/w-cached');
    expect(fsPromises.readFile).not.toHaveBeenCalled();
  });
});
