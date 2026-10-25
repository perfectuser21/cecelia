import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { git } from '../../__tests__/helpers/git.mjs';
import { makeSandbox } from './helpers/sandbox.mjs';
import { preparePrWorktree } from '../lib/pr-branch.mjs';
import { removeWorktree } from '../lib/worktree.mjs';

const branch = 'cp-10250000-cw-aaaaaaa1';
const roots = [];
afterEach(() => { for (const sb of roots.splice(0)) sb.cleanup(); });

function fixture(occupied = true) {
  const sb = makeSandbox();
  roots.push(sb);
  git(sb.seed, 'checkout', '-q', '-b', branch);
  const sprint = 'sprints/10250000-cw-aaaaaaa1';
  fs.mkdirSync(path.join(sb.seed, sprint), { recursive: true });
  fs.writeFileSync(path.join(sb.seed, sprint, '01-intent.md'),
    'task_id: aaaaaaa1-0000-4000-8000-000000000001\n### I-1\n保留真实证据\n');
  fs.writeFileSync(path.join(sb.seed, 'README.md'), 'published\n');
  git(sb.seed, 'add', '.');
  git(sb.seed, 'commit', '-q', '-m', 'docs: published');
  git(sb.seed, 'push', '-q', 'origin', branch);
  const head = git(sb.seed, 'rev-parse', 'HEAD').trim();
  git(sb.clone, 'fetch', '-q', 'origin', branch);
  fs.mkdirSync(sb.worktreeBase, { recursive: true });
  const original = path.join(sb.worktreeBase, 'original-failed-run');
  if (occupied) {
    git(sb.clone, 'worktree', 'add', '-q', '-b', branch, original, `origin/${branch}`);
    fs.writeFileSync(path.join(original, 'README.md'), 'staged failure evidence\n');
    git(original, 'add', 'README.md');
    fs.appendFileSync(path.join(original, 'README.md'), 'unstaged failure evidence\n');
    fs.writeFileSync(path.join(original, 'untracked.bin'), Buffer.from([0, 255, 12]));
  }
  return { sb, original, head, pr: { number: 1, headRefName: branch, headRefOid: head },
    qa: path.join(sb.worktreeBase, 'qa-1-1'), cfg: { repo: sb.clone, skipNpmCi: true } };
}

function originalEvidence(f) {
  return {
    head: git(f.original, 'rev-parse', 'HEAD'),
    status: git(f.original, 'status', '--porcelain=v1', '-uall'),
    index: git(f.original, 'diff', '--cached', '--binary'),
    work: fs.readFileSync(path.join(f.original, 'README.md')),
    untracked: fs.readFileSync(path.join(f.original, 'untracked.bin')),
  };
}

describe('保留失败现场后的 PR 检出', () => {
  it('同名分支仍被脏工作树占用时，QA保留真实分支、精确HEAD和独立索引，并可推送及独立清理', async () => {
    const f = fixture();
    const before = originalEvidence(f);
    await expect(preparePrWorktree(f.cfg, f.pr, f.qa)).resolves.toBeUndefined();
    expect(git(f.qa, 'branch', '--show-current').trim()).toBe(branch);
    expect(git(f.qa, 'rev-parse', 'HEAD').trim()).toBe(f.head);
    expect(git(f.qa, 'status', '--porcelain=v1', '-uall')).toBe('');
    expect(fs.realpathSync(path.resolve(f.qa, git(f.qa, 'rev-parse', '--git-common-dir').trim())))
      .not.toBe(fs.realpathSync(path.resolve(f.sb.clone, git(f.sb.clone, 'rev-parse', '--git-common-dir').trim())));
    expect(fs.readFileSync(path.join(f.qa, `.dev-mode.${branch}`), 'utf8'))
      .toContain('task_id: aaaaaaa1-0000-4000-8000-000000000001');
    expect(git(f.qa, 'remote', 'get-url', 'origin').trim()).toBe(f.sb.origin);
    git(f.qa, 'config', 'user.name', 'qa');
    git(f.qa, 'config', 'user.email', 'qa@example.com');
    git(f.qa, 'config', 'core.hooksPath', path.join(f.sb.root, 'no-hooks'));
    fs.writeFileSync(path.join(f.qa, 'qa-record.md'), 'actual QA record\n');
    git(f.qa, 'add', 'qa-record.md');
    git(f.qa, 'commit', '-q', '-m', 'docs: QA record');
    git(f.qa, 'push', '-q', 'origin', `HEAD:refs/heads/${branch}`);
    const qaHead = git(f.qa, 'rev-parse', 'HEAD').trim();
    expect(git(f.sb.origin, 'rev-parse', branch).trim()).toBe(qaHead);
    expect(await removeWorktree(f.cfg, f.qa, branch)).toBe(true);
    expect(fs.existsSync(f.qa)).toBe(false);
    expect(originalEvidence(f)).toEqual(before);
    expect(git(f.sb.clone, 'rev-parse', branch).trim()).toBe(f.head);
    // 下一轮从已更新的真实远端头开始，不复用原失败现场或上次QA索引。
    await preparePrWorktree(f.cfg, { ...f.pr, headRefOid: qaHead }, f.qa);
    expect(git(f.qa, 'rev-parse', 'HEAD').trim()).toBe(qaHead);
    expect(originalEvidence(f)).toEqual(before);
    expect(await removeWorktree(f.cfg, f.qa, branch)).toBe(true);
  }, 30000);

  it('分支未被占用时保留原工作树路径及正常清理行为', async () => {
    const f = fixture(false);
    await preparePrWorktree(f.cfg, f.pr, f.qa);
    expect(git(f.qa, 'branch', '--show-current').trim()).toBe(branch);
    expect(git(f.qa, 'rev-parse', 'HEAD').trim()).toBe(f.head);
    expect(fs.statSync(path.join(f.qa, '.git')).isFile()).toBe(true);
    expect(await removeWorktree(f.cfg, f.qa, branch)).toBe(true);
    expect(fs.existsSync(f.qa)).toBe(false);
  }, 30000);

  it('不会把没有受控归属记录的独立仓库作为QA现场删除', async () => {
    const f = fixture(false);
    git(f.sb.clone, 'clone', '-q', f.sb.origin, f.qa);
    expect(await removeWorktree(f.cfg, f.qa, branch)).toBe(false);
    expect(fs.existsSync(path.join(f.qa, '.git'))).toBe(true);
    expect(git(f.qa, 'rev-parse', 'HEAD').trim()).toBe(git(f.sb.origin, 'rev-parse', 'main').trim());
  }, 30000);

  it('工作树删除被拒绝时也不删除已有的本地分支', async () => {
    const f = fixture(false);
    git(f.sb.clone, 'branch', branch, f.head);
    expect(await removeWorktree(f.cfg, f.qa, branch)).toBe(false);
    expect(git(f.sb.clone, 'rev-parse', '--verify', `refs/heads/${branch}`).trim()).toBe(f.head);
  });
});
