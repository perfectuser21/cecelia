/**
 * Regression: B40 parsePrdNode 不把 sprints/tests/ 误判为 sprint 目录
 * 根因：infrastructure repo 的 sprints/ 下只有 tests/ 一个子目录，
 *       B40 find fallback 没有排除 tests/，导致 sprintDir = 'sprints/tests'，
 *       verifyContractProposerOutput 找不到合同 → GAN 永不收敛。
 *
 * 同时覆盖 verifyContractProposerOutput B56 fallback：
 * sprintDir 误算时，sprints/contract-draft.md 根目录依然能找到合同。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock node:child_process BEFORE any import that uses it
vi.mock('node:child_process', () => ({ execFile: vi.fn() }));

vi.mock('node:fs/promises', () => {
  const mocks = { readFile: vi.fn(), readdir: vi.fn(), access: vi.fn(), mkdir: vi.fn() };
  return { default: mocks, ...mocks };
});

vi.mock('../db.js', () => ({ default: { connect: vi.fn(), query: vi.fn() } }));
vi.mock('../lib/contract-verify.js', () => ({
  ContractViolation: class extends Error {},
  verifyProposerOutput: vi.fn(),
  verifyContractProposerOutput: vi.fn(),
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

import { execFile as execFileCb } from 'node:child_process';
import fsPromises from 'node:fs/promises';
import { parsePrdNode } from '../workflows/harness-initiative.graph.js';

const ENOENT = Object.assign(new Error('no such file'), { code: 'ENOENT' });

// promisify(execFileCb) 调用方式: execFileCb(cmd, args, opts, cb)
function mockExecFile(impl) {
  execFileCb.mockImplementation((cmd, args, opts, cb) => {
    const done = typeof opts === 'function' ? opts : cb;
    impl(cmd, args, done);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fsPromises.readFile.mockRejectedValue(ENOENT);
  fsPromises.readdir.mockRejectedValue(ENOENT);
});

// ── B40 ─────────────────────────────────────────────────────────────────────

describe('parsePrdNode B40: sprints/tests/ 不误判为 sprint 目录', () => {
  it('sprints/tests/ 是唯一子目录时 → sprintDir 保持 sprints', async () => {
    mockExecFile((cmd, args, done) => {
      if (cmd === 'find' && Array.isArray(args) && args.includes('sprint-prd.md')) { done(null, { stdout: '' }); return; }
      if (cmd === 'git') {
        done(null, { stdout: '' }); // git log 返回空 → 触发 B40
      } else if (cmd === 'find') {
        done(null, { stdout: '/repo/sprints/tests\n' }); // 只有 tests/
      } else {
        done(new Error(`unexpected cmd: ${cmd}`));
      }
    });

    const state = {
      task: { payload: {} },
      plannerOutput: 'fallback',
      worktreePath: '/repo',
      initiativeId: 'init-1',
    };
    const result = await parsePrdNode(state);
    expect(result.sprintDir).toBe('sprints');
  });

  it('sprints/tests/ + sprints/clamp/ → 排除 tests，只剩 clamp 则取 clamp', async () => {
    mockExecFile((cmd, args, done) => {
      if (cmd === 'find' && Array.isArray(args) && args.includes('sprint-prd.md')) { done(null, { stdout: '' }); return; }
      if (cmd === 'git') {
        done(null, { stdout: '' });
      } else if (cmd === 'find') {
        done(null, { stdout: '/repo/sprints/tests\n/repo/sprints/clamp\n' });
      } else {
        done(new Error(`unexpected cmd: ${cmd}`));
      }
    });

    const state = {
      task: { payload: {} },
      plannerOutput: 'fallback',
      worktreePath: '/repo',
      initiativeId: 'init-1',
    };
    const result = await parsePrdNode(state);
    expect(result.sprintDir).toBe('sprints/clamp');
  });

  it('sprints/tests/ + sprints/__tests__/ → 两个都被排除 → sprintDir 保持 sprints', async () => {
    mockExecFile((cmd, args, done) => {
      if (cmd === 'find' && Array.isArray(args) && args.includes('sprint-prd.md')) { done(null, { stdout: '' }); return; }
      if (cmd === 'git') {
        done(null, { stdout: '' });
      } else if (cmd === 'find') {
        done(null, { stdout: '/repo/sprints/tests\n/repo/sprints/__tests__\n' });
      } else {
        done(new Error(`unexpected cmd: ${cmd}`));
      }
    });

    const state = {
      task: { payload: {} },
      plannerOutput: 'fallback',
      worktreePath: '/repo',
      initiativeId: 'init-1',
    };
    const result = await parsePrdNode(state);
    expect(result.sprintDir).toBe('sprints');
  });
});

// ── verifyContractProposerOutput B56 fallback ─────────────────────────────

describe('verifyContractProposerOutput B56: sprintDir 误算时走 sprints/ 根 fallback', () => {
  it('sprintDir=sprints/tests 时，sprints/contract-draft.md 仍能通过验证', async () => {
    const { verifyContractProposerOutput: realFn } = await vi.importActual('../lib/contract-verify.js');

    const execFn = vi.fn(async (_cmd, args) => {
      const joined = args.join(' ');
      if (joined.includes('ls-remote')) return { stdout: 'abc123\trefs/heads/my-branch\n' };
      if (joined.includes('fetch')) return { stdout: '' };
      if (joined.includes('sprints/tests/')) throw new Error('not found');
      if (joined.includes('sprints/contract-draft.md')) return { stdout: '# Contract Content' };
      throw new Error(`unexpected: ${joined}`);
    });

    await expect(realFn({
      worktreePath: '/repo',
      branch: 'my-branch',
      sprintDir: 'sprints/tests',
      baseRepo: 'https://github.com/test/repo.git',
      execFn,
    })).resolves.toBeUndefined();
  });
});
