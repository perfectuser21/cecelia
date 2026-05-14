import { describe, it, expect, vi, beforeEach } from 'vitest';

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

describe('parsePrdNode — B36: last-match sprint_dir extraction', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('plannerOutput 含多个 sprint_dir 引用时，取最后一个（verdict）', async () => {
    // 模拟 planner 输出：先列举了 w19，最后输出 verdict 含正确的 w46
    const plannerOutput = [
      'Checking existing sprint directories...',
      'Found: {"sprint_dir": "sprints/w19-playground-sum"}',
      'Found: {"sprint_dir": "sprints/w20-hello-world"}',
      'Creating new sprint: w46-b36-test',
      '{"verdict": "DONE", "branch": "cp-w46-test", "sprint_dir": "sprints/w46-b36-test"}',
    ].join('\n');
    fsPromises.readFile.mockResolvedValue('# W46 PRD');

    const result = await parsePrdNode({
      worktreePath: '/fake/worktree',
      plannerOutput,
      task: { payload: { sprint_dir: 'sprints' } },
      initiativeId: 'test-initiative',
    });

    // 必须取最后一个（verdict 里的），不是 w19 或 w20
    expect(result.sprintDir).toBe('sprints/w46-b36-test');
    expect(fsPromises.readFile).toHaveBeenCalledWith(
      '/fake/worktree/sprints/w46-b36-test/sprint-prd.md',
      'utf8'
    );
  });

  it('只有一个 sprint_dir 时仍然正确提取', async () => {
    const plannerOutput = '{"verdict": "DONE", "sprint_dir": "sprints/w47-solo", "branch": "cp-x"}';
    fsPromises.readFile.mockResolvedValue('# PRD');

    const result = await parsePrdNode({
      worktreePath: '/fake/worktree',
      plannerOutput,
      task: { payload: { sprint_dir: 'sprints' } },
      initiativeId: 'test-initiative',
    });

    expect(result.sprintDir).toBe('sprints/w47-solo');
  });

  it('没有 sprint_dir 时 fallback 到 payload', async () => {
    const plannerOutput = 'Some output without sprint_dir key';
    fsPromises.readFile.mockResolvedValue('# PRD');

    const result = await parsePrdNode({
      worktreePath: '/fake/worktree',
      plannerOutput,
      task: { payload: { sprint_dir: 'sprints/w99-from-payload' } },
      initiativeId: 'test-initiative',
    });

    expect(result.sprintDir).toBe('sprints/w99-from-payload');
  });
});
