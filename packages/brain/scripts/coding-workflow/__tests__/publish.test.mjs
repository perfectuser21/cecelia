import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runActivityProcess } from './helpers/run-activity.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(HERE, '../activities/publish.mjs');
const FAKE_GH = path.join(HERE, 'fixtures/fake-gh.mjs');
const TASK_ID = '11111111-2222-3333-4444-555555555555';
const TITLE = 'docs(sprint): 11111111 md 链 01-intent → 02-spec';

const git = (cwd, ...args) =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

describe('publish 活动（临时裸仓 + 假 gh）', () => {
  let root;
  let origin;
  let worktree;
  let ghLog;

  beforeAll(() => {
    fs.chmodSync(FAKE_GH, 0o755);
  });
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-test-'));
    origin = path.join(root, 'origin.git');
    worktree = path.join(root, 'wt');
    ghLog = path.join(root, 'gh.log');
    execFileSync('git', ['init', '--bare', '-b', 'main', origin], { stdio: 'ignore' });
    execFileSync('git', ['clone', origin, worktree], { stdio: 'ignore' });
    git(worktree, 'config', 'user.name', 'Test');
    git(worktree, 'config', 'user.email', 'test@example.com');
    fs.writeFileSync(path.join(worktree, 'README.md'), 'hi\n');
    git(worktree, 'add', '--', 'README.md');
    git(worktree, 'commit', '-m', 'init');
    git(worktree, 'push', '-u', 'origin', 'main');
    git(worktree, 'checkout', '-b', 'cp-test');
    fs.mkdirSync(path.join(worktree, 'sprints/s1'), { recursive: true });
    fs.writeFileSync(path.join(worktree, 'sprints/s1/01-intent.md'), '# intent\n');
    fs.writeFileSync(path.join(worktree, 'sprints/s1/02-spec.md'), '# spec\n');
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const input = (patch = {}) => ({
    run_tag: 'rt-1',
    task_id: TASK_ID,
    worktree,
    sprint_dir: 'sprints/s1',
    chain_files: ['01-intent.md', '02-spec.md'],
    ...patch,
  });
  const run = (mode, patch) =>
    runActivityProcess(ENTRY, input(patch), {
      CODING_WF_GH_BIN: FAKE_GH,
      FAKE_GH_MODE: mode,
      FAKE_GH_LOG: ghLog,
    });
  const ghCalls = () =>
    fs.existsSync(ghLog)
      ? fs.readFileSync(ghLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
      : [];

  it('new：提交并推送分支，开草稿 PR，输出新 URL 与分支', async () => {
    const r = await run('new');
    expect(r.exitCode).toBe(0);
    expect(r.result.failure_class).toBeNull();
    expect(r.result.outputs).toEqual({ pr_url: 'https://github.com/example/repo/pull/2', branch: 'cp-test' });
    expect(r.stdout.trim().split('\n')).toHaveLength(1);

    const files = git(origin, 'ls-tree', '-r', '--name-only', 'cp-test').trim().split('\n');
    expect(files).toContain('sprints/s1/01-intent.md');
    expect(files).toContain('sprints/s1/02-spec.md');
    expect(git(origin, 'log', '-1', '--format=%s', 'cp-test').trim()).toBe(TITLE);

    const create = ghCalls().find((a) => a[0] === 'pr' && a[1] === 'create');
    expect(create).toBeDefined();
    expect(create).toContain('--draft');
    expect(create[create.indexOf('--head') + 1]).toBe('cp-test');
    expect(create[create.indexOf('--title') + 1]).toBe(TITLE);
    const body = create[create.indexOf('--body') + 1];
    expect(body).toContain('- sprints/s1/01-intent.md');
    expect(body).toContain('- sprints/s1/02-spec.md');
  });

  it('existing：复用已有 PR，不再 pr create', async () => {
    const r = await run('existing');
    expect(r.exitCode).toBe(0);
    expect(r.result.outputs).toEqual({ pr_url: 'https://github.com/example/repo/pull/1', branch: 'cp-test' });
    expect(ghCalls().some((a) => a[1] === 'create')).toBe(false);
  });

  it('无改动再跑一次：不新增 commit，仍 completed', async () => {
    const first = await run('new');
    expect(first.exitCode).toBe(0);
    const before = git(worktree, 'rev-parse', 'HEAD').trim();
    const second = await run('existing');
    expect(second.exitCode).toBe(0);
    expect(second.result.failure_class).toBeNull();
    expect(git(worktree, 'rev-parse', 'HEAD').trim()).toBe(before);
  });

  it('gh 鉴权失败 -> needs_human gh_auth', async () => {
    const r = await run('auth');
    expect(r.exitCode).toBe(2);
    expect(r.result.failure_class).toBe('needs_human');
    expect(r.result.reason_code).toBe('gh_auth');
    expect(r.stdout.trim().split('\n')).toHaveLength(1);
  });

  it('push 失败（origin 不可用）-> retryable push_failed', async () => {
    git(worktree, 'remote', 'set-url', 'origin', path.join(root, 'no-such.git'));
    const r = await run('new');
    expect(r.exitCode).toBe(2);
    expect(r.result.failure_class).toBe('retryable');
    expect(r.result.reason_code).toBe('push_failed');
  });

  it('分支为 main -> fatal branch_invalid，且未暂存任何文件', async () => {
    git(worktree, 'checkout', 'main');
    const r = await run('new');
    expect(r.exitCode).toBe(2);
    expect(r.result.failure_class).toBe('fatal');
    expect(r.result.reason_code).toBe('branch_invalid');
    expect(git(worktree, 'status', '--porcelain')).toContain('?? sprints/');
    expect(() => git(origin, 'rev-parse', '--verify', 'refs/heads/main')).not.toThrow();
    expect(() => git(origin, 'rev-parse', '--verify', 'refs/heads/cp-test')).toThrow();
    expect(ghCalls()).toHaveLength(0);
  });

  it('gh 非鉴权类失败（网络超时）-> retryable gh_failed', async () => {
    const r = await run('branchfail');
    expect(r.exitCode).toBe(2);
    expect(r.result.failure_class).toBe('retryable');
    expect(r.result.reason_code).toBe('gh_failed');
  });

  it('只提交 sprint_dir：目录外的未跟踪文件与已暂存文件不进 origin 分支', async () => {
    fs.writeFileSync(path.join(worktree, 'extra.txt'), 'untracked\n');
    fs.writeFileSync(path.join(worktree, 'staged.txt'), 'staged\n');
    git(worktree, 'add', '--', 'staged.txt');
    const r = await run('new');
    expect(r.exitCode).toBe(0);
    const files = git(origin, 'ls-tree', '-r', '--name-only', 'cp-test').trim().split('\n');
    expect(files).toContain('sprints/s1/01-intent.md');
    expect(files).not.toContain('extra.txt');
    expect(files).not.toContain('staged.txt');
  });

  it.each(['.', './', ':/', ':(top)'])('sprint_dir=%s 不能扩大提交范围', async (bad) => {
    fs.writeFileSync(path.join(worktree, 'extra.txt'), 'untracked\n');
    const r = await run('new', { sprint_dir: bad });
    expect(r.exitCode).toBe(2);
    expect(r.result.failure_class).toBe('fatal');
    expect(() => git(origin, 'rev-parse', '--verify', 'refs/heads/cp-test')).toThrow();
    expect(git(worktree, 'log', '--oneline').trim().split('\n')).toHaveLength(1);
  });

  it('sprint_dir 非法 -> fatal sprint_dir_invalid，不碰 git/gh', async () => {
    const r = await run('new', { sprint_dir: 'a/../../b' });
    expect(r.exitCode).toBe(2);
    expect(r.result.failure_class).toBe('fatal');
    expect(r.result.reason_code).toBe('sprint_dir_invalid');
    expect(git(worktree, 'log', '--oneline').trim().split('\n')).toHaveLength(1);
    expect(ghCalls()).toHaveLength(0);
  });

  it('task_id 与 sprint_dir 同时非法 -> 先报 task_id_missing', async () => {
    const r = await run('new', { task_id: '', sprint_dir: 'a/../../b' });
    expect(r.result.reason_code).toBe('task_id_missing');
    expect(ghCalls()).toHaveLength(0);
  });
});
