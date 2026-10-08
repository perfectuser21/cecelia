// lib/guards.mjs：md 链哈希、远端分支快照、历史/分支检查、提交改动清单、agent 配置识别、03 隐藏与放回。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { git, gitPlain, initCommittableRepo } from './helpers/git.mjs';
import {
  sha256File,
  tamperedChainFiles,
  remoteHead,
  currentBranch,
  isAncestor,
  changedFilesSince,
  agentConfigFiles,
  remoteSnapshot,
  remoteChangeFailure,
  hideFile,
  recoverHidden,
} from '../lib/guards.mjs';

const BRANCH = 'cp-1008000000-test';

describe('guards', () => {
  let root;
  let worktree;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'guards-'));
    worktree = path.join(root, 'wt');
    fs.mkdirSync(worktree);
    initCommittableRepo(worktree, path.join(root, 'no-hooks'), BRANCH);
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('sha256File：内容哈希；文件不存在返回 null', () => {
    const f = path.join(root, 'a.md');
    fs.writeFileSync(f, '内容\n');
    expect(sha256File(f)).toBe(crypto.createHash('sha256').update('内容\n').digest('hex'));
    expect(sha256File(path.join(root, 'none.md'))).toBeNull();
  });

  it('tamperedChainFiles：只比对上下文给了哈希的文件，内容变了或文件没了就列出', () => {
    const dir = path.join(root, 's');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, '01-intent.md'), 'i\n');
    fs.writeFileSync(path.join(dir, '02-spec.md'), 's\n');
    const input = { intent_sha256: sha256File(path.join(dir, '01-intent.md')), spec_sha256: sha256File(path.join(dir, '02-spec.md')) };
    expect(tamperedChainFiles(dir, input)).toEqual([]);
    expect(tamperedChainFiles(dir, {})).toEqual([]);
    fs.writeFileSync(path.join(dir, '02-spec.md'), 's 改过\n');
    expect(tamperedChainFiles(dir, input)).toEqual(['02-spec.md']);
    fs.rmSync(path.join(dir, '01-intent.md'));
    expect(tamperedChainFiles(dir, input)).toEqual(['01-intent.md', '02-spec.md']);
  });

  it('remoteHead：没有 origin 返回空串；推送后返回远端分支 SHA', async () => {
    expect(await remoteHead(worktree)).toBe('');
    const origin = path.join(root, 'origin.git');
    gitPlain('init', '--bare', '-q', origin);
    git(worktree, 'remote', 'add', 'origin', origin);
    expect(await remoteHead(worktree)).toBe('');
    git(worktree, 'push', '-q', 'origin', BRANCH);
    expect(await remoteHead(worktree)).toBe(git(worktree, 'rev-parse', 'HEAD').trim());
  });

  it('remoteHead / remoteSnapshot：origin 已配置但 ls-remote 失败 -> null（不当成空串）', async () => {
    git(worktree, 'remote', 'add', 'origin', path.join(root, 'no-such-origin.git'));
    expect(await remoteHead(worktree)).toBeNull();
    expect(await remoteSnapshot(worktree)).toBeNull();
  });

  it('remoteChangeFailure：任一侧查不到 -> retryable remote_check_failed；不同 -> fatal remote_changed；相同 -> null', async () => {
    expect(await remoteChangeFailure(worktree, '')).toBeNull();
    expect(await remoteChangeFailure(worktree, null)).toMatchObject({ failure_class: 'retryable', reason_code: 'remote_check_failed' });
    expect(await remoteChangeFailure(worktree, 'abc')).toMatchObject({ failure_class: 'fatal', reason_code: 'remote_changed' });
    git(worktree, 'remote', 'add', 'origin', path.join(root, 'no-such-origin.git'));
    expect(await remoteChangeFailure(worktree, '')).toEqual({
      status: 'failed', failure_class: 'retryable', reason_code: 'remote_check_failed', evidence: [{ remote_before: '', remote_after: null }],
    });
  });

  it('currentBranch / isAncestor：amend 改写历史后旧 HEAD 不再是祖先', async () => {
    const before = git(worktree, 'rev-parse', 'HEAD').trim();
    expect(await currentBranch(worktree)).toBe(BRANCH);
    git(worktree, 'commit', '-q', '--allow-empty', '-m', 'next');
    expect(await isAncestor(worktree, before)).toBe(true);
    git(worktree, 'reset', '-q', '--hard', before);
    git(worktree, 'commit', '-q', '--amend', '--allow-empty', '-m', 'rewritten');
    expect(await isAncestor(worktree, before)).toBe(false);
  });

  it('isAncestor / changedFilesSince：git 执行失败返回 null，不当成"不是祖先/无改动"', async () => {
    const missing = '0123456789abcdef0123456789abcdef01234567';
    expect(await isAncestor(worktree, missing)).toBeNull();
    expect(await changedFilesSince(worktree, missing)).toBeNull();
    expect(await changedFilesSince(worktree, missing, 'sprints/s1')).toBeNull();
  });

  it('changedFilesSince：自某提交以来改过的文件，可按 pathspec 限定', async () => {
    const before = git(worktree, 'rev-parse', 'HEAD').trim();
    fs.mkdirSync(path.join(worktree, 'sprints/s1'), { recursive: true });
    fs.writeFileSync(path.join(worktree, 'sprints/s1/01-intent.md'), 'x\n');
    fs.writeFileSync(path.join(worktree, 'a.js'), 'x\n');
    git(worktree, 'add', '--', 'sprints', 'a.js');
    git(worktree, 'commit', '-q', '-m', 'c');
    expect((await changedFilesSince(worktree, before)).sort()).toEqual(['a.js', 'sprints/s1/01-intent.md']);
    expect(await changedFilesSince(worktree, before, 'sprints/s1')).toEqual(['sprints/s1/01-intent.md']);
    expect(await changedFilesSince(worktree, before, 'sprints/s2')).toEqual([]);
  });

  it('agentConfigFiles：.claude/ 目录与任意层级的 CLAUDE.md / AGENTS.md', () => {
    expect(agentConfigFiles([
      'src/a.js', '.claude/settings.json', 'pkg/.claude/hooks/x.sh', 'CLAUDE.md', 'docs/AGENTS.md', 'docs/claude.md.txt',
    ])).toEqual(['.claude/settings.json', 'pkg/.claude/hooks/x.sh', 'CLAUDE.md', 'docs/AGENTS.md']);
  });

  it('hideFile：移到 git 目录下（git 不追踪），restore 放回；文件不存在时 restore 无操作', async () => {
    const file = path.join(worktree, 'sprints/s1/03-build.md');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '# build\n');
    const hidden = await hideFile(worktree, file);
    expect(fs.existsSync(file)).toBe(false);
    const gitDir = git(worktree, 'rev-parse', '--absolute-git-dir').trim();
    expect(fs.readFileSync(path.join(gitDir, 'coding-wf/03-build.md'), 'utf8')).toBe('# build\n');
    expect(git(worktree, 'status', '--porcelain', '-uall')).not.toContain('coding-wf');
    fs.writeFileSync(file, '# 冒充\n');
    hidden.restore();
    expect(fs.readFileSync(file, 'utf8')).toBe('# build\n');

    const absent = await hideFile(worktree, path.join(worktree, 'none.md'));
    expect(absent.restore()).toBe(true);
    expect(fs.existsSync(path.join(worktree, 'none.md'))).toBe(false);
  });

  it('hideFile.restore：幂等；暂存件丢失时返回 false 而不抛错', async () => {
    const file = path.join(worktree, 'sprints/s1/03-build.md');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '# build\n');
    const hidden = await hideFile(worktree, file);
    expect(hidden.restore()).toBe(true);
    expect(hidden.restore()).toBe(true);
    const again = await hideFile(worktree, file);
    fs.rmSync(again.hiddenPath);
    expect(again.restore()).toBe(false);
  });

  it('recoverHidden：上次中断留在 git 目录下的暂存件放回原处；没有残留返回 false', async () => {
    const file = path.join(worktree, 'sprints/s1/03-build.md');
    expect(await recoverHidden(worktree, file)).toBe(false);
    const gitDir = git(worktree, 'rev-parse', '--absolute-git-dir').trim();
    fs.mkdirSync(path.join(gitDir, 'coding-wf'), { recursive: true });
    fs.writeFileSync(path.join(gitDir, 'coding-wf/03-build.md'), '# 残留\n');
    expect(await recoverHidden(worktree, file)).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toBe('# 残留\n');
    expect(fs.existsSync(path.join(gitDir, 'coding-wf/03-build.md'))).toBe(false);
  });
});
