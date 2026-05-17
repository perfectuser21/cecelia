import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock node:fs/promises — must come before any import that uses it
vi.mock('node:fs/promises', () => {
  const mocks = {
    readFile: vi.fn(),
    readdir: vi.fn(),
    access: vi.fn(),
    mkdir: vi.fn(),
  };
  return {
    default: mocks,
    ...mocks,
  };
});

// Stub heavy deps so the graph files can be imported without side effects
vi.mock('../db.js', () => ({ default: { connect: vi.fn(), query: vi.fn() } }));
vi.mock('../lib/contract-verify.js', () => ({
  ContractViolation: class extends Error {},
  verifyProposerOutput: vi.fn(),
  verifyGeneratorOutput: vi.fn(),
  verifyEvaluatorWorktree: vi.fn(),
}));
vi.mock('../harness-dag.js', () => ({ parseTaskPlan: vi.fn(() => null), upsertTaskPlan: vi.fn() }));
vi.mock('../harness-final-e2e.js', () => ({ runFinalE2E: vi.fn(), attributeFailures: vi.fn() }));
vi.mock('../harness-worktree.js', () => ({ ensureHarnessWorktree: vi.fn() }));
vi.mock('../harness-credentials.js', () => ({ resolveGitHubToken: vi.fn() }));
vi.mock('../lib/git-fence.js', () => ({ fetchAndShowOriginFile: vi.fn() }));
vi.mock('../spawn/index.js', () => ({ spawn: vi.fn() }));
vi.mock('../harness-shared.js', () => ({ parseDockerOutput: vi.fn(), loadSkillContent: vi.fn(() => '') }));
vi.mock('../harness-pg-checkpointer.js', () => ({ getPgCheckpointer: vi.fn() }));

import fsPromises from 'node:fs/promises';
import { defaultReadContractFile } from '../workflows/harness-gan.graph.js';
import { parsePrdNode } from '../workflows/harness-initiative.graph.js';

const ENOENT = Object.assign(new Error('no such file'), { code: 'ENOENT' });

beforeEach(() => {
  vi.clearAllMocks();
});

// ── defaultReadContractFile ─────────────────────────────────────────────────

describe('defaultReadContractFile: subdir scan (B34)', () => {
  it('returns contract from subdir when flat paths fail', async () => {
    // Flat candidates throw ENOENT
    fsPromises.readFile.mockRejectedValueOnce(ENOENT);   // sprints/contract-draft.md
    fsPromises.readFile.mockRejectedValueOnce(ENOENT);   // sprints/sprint-contract.md
    // readdir returns one subdirectory
    fsPromises.readdir.mockResolvedValueOnce([
      { name: 'w44-walking-skeleton-b33', isDirectory: () => true },
    ]);
    // Subdir contract-draft.md found
    fsPromises.readFile.mockResolvedValueOnce('# Sprint Contract\nDONE');

    const result = await defaultReadContractFile('/repo', 'sprints');
    expect(result).toBe('# Sprint Contract\nDONE');
  });

  it('throws when flat AND subdir both fail (no file anywhere)', async () => {
    fsPromises.readFile.mockRejectedValue(ENOENT);
    fsPromises.readdir.mockResolvedValueOnce([
      { name: 'w44-walking-skeleton-b33', isDirectory: () => true },
    ]);
    await expect(defaultReadContractFile('/repo', 'sprints')).rejects.toThrow('contract file not found');
  });
});

// ── parsePrdNode ────────────────────────────────────────────────────────────

describe('parsePrdNode: subdir scan (B34)', () => {
  it('finds sprint-prd.md in subdir and returns effectiveSprintDir', async () => {
    // Flat read fails
    fsPromises.readFile.mockRejectedValueOnce(ENOENT);
    // readdir returns one subdir
    fsPromises.readdir.mockResolvedValueOnce([
      { name: 'w44-walking-skeleton-b33', isDirectory: () => true },
    ]);
    // Subdir sprint-prd.md found
    fsPromises.readFile.mockResolvedValueOnce('# PRD content');

    const state = {
      task: { payload: { sprint_dir: 'sprints' } },
      plannerOutput: 'fallback stdout',
      worktreePath: '/repo',
      initiativeId: 'init-1',
    };
    const result = await parsePrdNode(state);
    expect(result.prdContent).toBe('# PRD content');
    expect(result.sprintDir).toBe('sprints/w44-walking-skeleton-b33');
  });

  it('falls back to plannerOutput when no subdir has sprint-prd.md', async () => {
    fsPromises.readFile.mockRejectedValue(ENOENT);
    fsPromises.readdir.mockResolvedValueOnce([
      { name: 'w44-walking-skeleton-b33', isDirectory: () => true },
    ]);

    const state = {
      task: { payload: { sprint_dir: 'sprints' } },
      plannerOutput: 'fallback stdout',
      worktreePath: '/repo',
      initiativeId: 'init-1',
    };
    const result = await parsePrdNode(state);
    expect(result.prdContent).toBe('fallback stdout');
    expect(result.sprintDir).toBe('sprints');
  });
});

// ── parsePrdNode B39 ────────────────────────────────────────────────────────

describe('parsePrdNode: B39 LLM-derived sprintDir validation', () => {
  it('B39: LLM 提取的 sprintDir 目录不存在时，回退到 payload 值并读平铺文件', async () => {
    // B35 从 plannerOutput 提取 "sprints/tests"，但该目录不存在 → B39 回退
    fsPromises.access.mockRejectedValueOnce(ENOENT);  // access('sprints/tests') 失败
    fsPromises.readFile.mockResolvedValueOnce('# PRD from flat sprints/');  // 读 sprints/sprint-prd.md 成功

    const state = {
      task: { payload: { sprint_dir: 'sprints' } },
      plannerOutput: '{"sprint_dir": "sprints/tests", "verdict": "DONE"}',
      worktreePath: '/repo',
      initiativeId: 'init-b39-fallback',
    };
    const result = await parsePrdNode(state);
    expect(result.sprintDir).toBe('sprints');  // 回退到 payload 值
    expect(result.prdContent).toBe('# PRD from flat sprints/');
  });

  it('B39: LLM 提取的 sprintDir 目录存在时保持不变', async () => {
    // access 成功 → B39 不回退，sprintDir 保持 LLM 值
    fsPromises.access.mockResolvedValueOnce(undefined);
    fsPromises.readFile.mockResolvedValueOnce('# PRD in sprints/tests/');

    const state = {
      task: { payload: { sprint_dir: 'sprints' } },
      plannerOutput: '{"sprint_dir": "sprints/tests", "verdict": "DONE"}',
      worktreePath: '/repo',
      initiativeId: 'init-b39-keep',
    };
    const result = await parsePrdNode(state);
    expect(result.sprintDir).toBe('sprints/tests');
    expect(result.prdContent).toBe('# PRD in sprints/tests/');
  });

  it('B39: 无 worktreePath 时不触发 access 校验，sprintDir 保持 LLM 值', async () => {
    fsPromises.readFile.mockRejectedValue(ENOENT);
    fsPromises.readdir.mockRejectedValue(ENOENT);

    const state = {
      task: { payload: { sprint_dir: 'sprints' } },
      plannerOutput: '{"sprint_dir": "sprints/tests", "verdict": "DONE"}',
      worktreePath: null,
      initiativeId: 'init-b39-no-wt',
    };
    const result = await parsePrdNode(state);
    // 无 worktreePath → B39 不执行 → sprintDir = LLM 值
    expect(result.sprintDir).toBe('sprints/tests');
    expect(fsPromises.access).not.toHaveBeenCalled();
  });

  it('B39: 无 plannerOutput sprint_dir 时不触发（非 LLM 来源）', async () => {
    // plannerOutput 无 sprint_dir 字段 → _sprintDirFromLlm = false → B39 不执行
    fsPromises.readFile.mockResolvedValueOnce('# PRD content');

    const state = {
      task: { payload: { sprint_dir: 'sprints/custom' } },
      plannerOutput: 'some output without sprint_dir key',
      worktreePath: '/repo',
      initiativeId: 'init-b39-no-llm',
    };
    const result = await parsePrdNode(state);
    expect(result.sprintDir).toBe('sprints/custom');  // payload 值直接使用，无 B39
    expect(fsPromises.access).not.toHaveBeenCalled();
  });
});
