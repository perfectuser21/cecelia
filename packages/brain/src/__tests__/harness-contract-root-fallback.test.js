/**
 * defaultReadContractFile — sprints/ 根目录 fallback（修 sprintDir 误算导致合同找不到）
 *
 * Bug：sprintDir 被误算成 sprints/tests（合同实际在 sprints/）时，读取器只查
 * sprints/tests/ + 其子目录，从不回头看 sprints/ 根 → "contract file not found" → GAN 失败。
 * 修法：所有候选都失败后，从 worktree 的 sprints/ 根目录扫根+子目录找合同（以文件实际位置为准）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs/promises', () => {
  const mocks = { readFile: vi.fn(), readdir: vi.fn(), access: vi.fn(), mkdir: vi.fn() };
  return { default: mocks, ...mocks };
});
vi.mock('../db.js', () => ({ default: { connect: vi.fn(), query: vi.fn() } }));
vi.mock('../lib/contract-verify.js', () => ({
  ContractViolation: class extends Error {},
  verifyProposerOutput: vi.fn(), verifyGeneratorOutput: vi.fn(), verifyEvaluatorWorktree: vi.fn(),
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

const ENOENT = Object.assign(new Error('no such file'), { code: 'ENOENT' });

beforeEach(() => vi.clearAllMocks());

describe('defaultReadContractFile — sprints/ 根目录 fallback', () => {
  it('sprintDir=sprints/tests 但合同在 sprints/ → 根 fallback 找到', async () => {
    // sprintDir=sprints/tests 的所有候选 + B34 子目录扫描全失败
    fsPromises.readFile.mockImplementation(async (p) => {
      // 只有 sprints/contract-draft.md（根目录）成功
      if (p === '/repo/sprints/contract-draft.md') return '# Sprint Contract Draft\nDONE';
      throw ENOENT;
    });
    // sprints/tests/ 的 readdir（B34 扫子目录）返回空；sprints/ 根 readdir 返回子目录
    fsPromises.readdir.mockImplementation(async (p) => {
      if (p === '/repo/sprints/tests') return [];
      if (p === '/repo/sprints') return [{ name: 'tests', isDirectory: () => true }];
      return [];
    });

    const result = await defaultReadContractFile('/repo', 'sprints/tests');
    expect(result).toBe('# Sprint Contract Draft\nDONE');
  });

  it('sprintDir 正确（sprints）时直接命中，不依赖 fallback', async () => {
    fsPromises.readFile.mockImplementation(async (p) => {
      if (p === '/repo/sprints/contract-draft.md') return '# Direct hit';
      throw ENOENT;
    });
    fsPromises.readdir.mockResolvedValue([]);
    const result = await defaultReadContractFile('/repo', 'sprints');
    expect(result).toBe('# Direct hit');
  });

  it('合同在 sprints/<feature>/ 子目录 + sprintDir 误算 → 根 fallback 扫子目录找到', async () => {
    fsPromises.readFile.mockImplementation(async (p) => {
      if (p === '/repo/sprints/clamp-feat/contract-draft.md') return '# Subdir contract';
      throw ENOENT;
    });
    fsPromises.readdir.mockImplementation(async (p) => {
      if (p === '/repo/sprints') return [{ name: 'clamp-feat', isDirectory: () => true }, { name: 'tests', isDirectory: () => true }];
      return [];
    });
    const result = await defaultReadContractFile('/repo', 'sprints/tests');
    expect(result).toBe('# Subdir contract');
  });
});
