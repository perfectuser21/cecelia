import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── injectToken tests ────────────────────────────────────────────────────────
// 这些测试会 fail，因为 injectToken 尚未 export

describe('injectToken', () => {
  it('无 token 时返回原 URL', async () => {
    const { injectToken } = await import('../contract-verify.js');
    expect(injectToken('https://github.com/org/repo.git', null)).toBe(
      'https://github.com/org/repo.git'
    );
  });

  it('有 token 时注入 x-access-token', async () => {
    const { injectToken } = await import('../contract-verify.js');
    expect(injectToken('https://github.com/org/repo.git', 'ghp_abc123')).toBe(
      'https://x-access-token:ghp_abc123@github.com/org/repo.git'
    );
  });

  it('已有 token 的 URL 不重复注入（幂等）', async () => {
    const { injectToken } = await import('../contract-verify.js');
    const url = 'https://x-access-token:old@github.com/org/repo.git';
    expect(injectToken(url, 'newtoken')).toBe(url);
  });

  it('非 HTTPS GitHub URL 原样返回', async () => {
    const { injectToken } = await import('../contract-verify.js');
    expect(injectToken('git@github.com:org/repo.git', 'tok')).toBe(
      'git@github.com:org/repo.git'
    );
  });
});

// ─── verifyProposerOutput ls-remote uses token ───────────────────────────────
vi.mock('node:child_process', () => ({ execFile: vi.fn() }));

const { execFile } = await import('node:child_process');
const { verifyProposerOutput } = await import('../contract-verify.js');

describe('verifyProposerOutput — githubToken ls-remote', () => {
  beforeEach(() => vi.resetAllMocks());

  it('ls-remote 使用带 token 的 URL', async () => {
    const capturedArgs = [];
    execFile.mockImplementation((cmd, args, _opts, cb) => {
      capturedArgs.push([...args]);
      if (args[0] === '-C') {
        // git -C baseRepo remote get-url origin
        cb(null, { stdout: 'https://github.com/org/repo.git\n' });
      } else if (args[0] === 'ls-remote') {
        // return non-empty → branch found
        cb(null, { stdout: 'abc\trefs/heads/cp-test\n' });
      } else if (args[0] === 'fetch') {
        cb(null, { stdout: '' });
      } else if (args[0] === 'show') {
        // return valid task-plan.json
        const plan = JSON.stringify({
          initiative_id: 'init1',
          tasks: [{ id: 't1', title: 'T', complexity: 'S', depends_on: [] }],
        });
        cb(null, { stdout: plan });
      } else {
        cb(null, { stdout: '' });
      }
    });

    await verifyProposerOutput({
      worktreePath: '/fake/wt',
      branch: 'cp-test',
      sprintDir: 'sprints',
      baseRepo: '/fake/repo',
      githubToken: 'ghp_secret999',
    }).catch(() => {}); // 可能因其他原因 throw，我们只关心 ls-remote 的参数

    const lsRemoteCall = capturedArgs.find(a => a[0] === 'ls-remote');
    expect(lsRemoteCall).toBeDefined();
    expect(lsRemoteCall[1]).toContain('x-access-token:ghp_secret999@github.com');
  });
});
