import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from '../lib/md-chain.mjs';
import { runActivityProcess } from './helpers/run-activity.mjs';
import { git, gitPlain, initCommittableRepo } from './helpers/git.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(HERE, '../activities/build.mjs');
const FAKE_CLAUDE = path.join(HERE, 'fixtures/fake-claude.mjs');
const TASK_ID = '11111111-2222-3333-4444-555555555555';
const SPEC = `---\ntask_id: ${TASK_ID}\nstep: spec\nupstream: ["01-intent.md#I-1"]\n---\n# spec\n\n### S-1\n一\n\n### S-2\n二\n`;

describe('build 活动（子进程 + 假 claude + 真实 git 提交）', () => {
  let root;
  let worktree;
  let sprintAbs;

  beforeAll(() => {
    fs.chmodSync(FAKE_CLAUDE, 0o755);
  });
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'build-test-'));
    worktree = path.join(root, 'wt');
    fs.mkdirSync(worktree);
    initCommittableRepo(worktree, path.join(root, 'no-hooks'));
    sprintAbs = path.join(worktree, 'sprints/s1');
    fs.mkdirSync(sprintAbs, { recursive: true });
    fs.writeFileSync(path.join(sprintAbs, '01-intent.md'), '# intent\n');
    fs.writeFileSync(path.join(sprintAbs, '02-spec.md'), SPEC);
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const input = (patch = {}) => ({
    run_tag: 'rt-1',
    task_id: TASK_ID,
    worktree,
    sprint_dir: 'sprints/s1',
    spec_file: '02-spec.md',
    ...patch,
  });
  const run = (mode, patch, extraEnv = {}) =>
    runActivityProcess(ENTRY, input(patch), { CODING_WF_CLAUDE_BIN: FAKE_CLAUDE, FAKE_CLAUDE_MODE: mode, ...extraEnv });
  const buildFile = () => path.join(sprintAbs, '03-build.md');
  const head = () => git(worktree, 'rev-parse', 'HEAD').trim();

  it('build-ok：completed，outputs 带 03-build.md 与新提交 SHA，03 覆盖全部 S-n', async () => {
    const before = head();
    const r = await run('build-ok');
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.result.failure_class).toBeNull();
    expect(r.stdout.trim().split('\n')).toHaveLength(1);
    const sha = head();
    expect(sha).not.toBe(before);
    expect(r.result.outputs).toEqual({ build_file: '03-build.md', build_commits: [sha] });

    const fm = parseFrontmatter(fs.readFileSync(buildFile(), 'utf8'));
    expect(fm.data).toEqual({ task_id: TASK_ID, step: 'build', upstream: ['02-spec.md#S-1', '02-spec.md#S-2'] });
    expect(git(worktree, 'show', '--name-only', '--format=', 'HEAD').trim().split('\n').sort())
      .toEqual(['src/feature.js', 'src/feature.test.js']);
  });

  it('claude 参数：acceptEdits，允许 Bash，禁 git push 与 gh；prompt 带 S-n 列表与 03 路径', async () => {
    const r = await run('build-ok');
    expect(r.stderr).toContain(
      'FAKE_ARGS: -p --permission-mode acceptEdits --allowedTools Bash --disallowedTools Bash(git push:*) Bash(gh:*)',
    );
    expect(r.stderr).toContain(`FAKE_CWD: ${fs.realpathSync(worktree)}`);
  });

  it('多个提交按时间顺序（旧→新）全部列出', async () => {
    const r = await run('build-ok', {}, { FAKE_BUILD_COMMITS: '3' });
    expect(r.exitCode, r.stderr).toBe(0);
    const expected = git(worktree, 'rev-list', '--reverse', 'HEAD~3..HEAD').trim().split('\n');
    expect(expected).toHaveLength(3);
    expect(r.result.outputs.build_commits).toEqual(expected);
  });

  it('build-nocommit：HEAD 未前进 -> fatal build_no_commit', async () => {
    const r = await run('build-nocommit');
    expect(r.exitCode).toBe(2);
    expect(r.result.failure_class).toBe('fatal');
    expect(r.result.reason_code).toBe('build_no_commit');
  });

  it('build-dirty：运行后留有未提交改动 -> fatal build_uncommitted，evidence 列出文件', async () => {
    const r = await run('build-dirty');
    expect(r.exitCode).toBe(2);
    expect(r.result.failure_class).toBe('fatal');
    expect(r.result.reason_code).toBe('build_uncommitted');
    expect(r.result.evidence).toEqual([{ uncommitted_changes: ['src/dirty.js'] }]);
  });

  it('build-noreport：没写 03-build.md -> fatal build_report_missing', async () => {
    const r = await run('build-noreport');
    expect(r.exitCode).toBe(2);
    expect(r.result.failure_class).toBe('fatal');
    expect(r.result.reason_code).toBe('build_report_missing');
  });

  it('旧 03-build.md 残留 + 本次没写 -> build_report_missing（运行前先删旧文件）', async () => {
    fs.writeFileSync(buildFile(), '# stale\n');
    const r = await run('build-noreport');
    expect(r.result.reason_code).toBe('build_report_missing');
    expect(fs.existsSync(buildFile())).toBe(false);
  });

  it('运行前已存在的无关脏文件、sprint 目录内的改动都不算未提交改动', async () => {
    fs.writeFileSync(path.join(worktree, 'pre-existing.txt'), 'dirty\n');
    const r = await run('build-ok');
    expect(r.exitCode, r.stderr).toBe(0);
    expect(git(worktree, 'status', '--porcelain', '--', 'sprints')).toContain('sprints/');
  });

  it('02-spec.md 不存在 -> fatal spec_missing，不启动 claude', async () => {
    fs.rmSync(path.join(sprintAbs, '02-spec.md'));
    const r = await run('build-ok');
    expect(r.result.failure_class).toBe('fatal');
    expect(r.result.reason_code).toBe('spec_missing');
    expect(r.stderr).not.toContain('FAKE_CWD');
  });

  it('02-spec.md 没有任何 S-n -> fatal spec_ids_missing，不启动 claude', async () => {
    fs.writeFileSync(path.join(sprintAbs, '02-spec.md'), `---\ntask_id: ${TASK_ID}\nstep: spec\nupstream: []\n---\n# 空\n`);
    const r = await run('build-ok');
    expect(r.result.reason_code).toBe('spec_ids_missing');
    expect(r.stderr).not.toContain('FAKE_CWD');
  });

  it('worktree 不是 git 仓库 -> fatal git_head_unavailable，不启动 claude', async () => {
    fs.rmSync(path.join(worktree, '.git'), { recursive: true, force: true });
    const r = await run('build-ok');
    expect(r.result.failure_class).toBe('fatal');
    expect(r.result.reason_code).toBe('git_head_unavailable');
    expect(r.stderr).not.toContain('FAKE_CWD');
  });

  it('sprint_dir 非法 -> fatal sprint_dir_invalid', async () => {
    const r = await run('build-ok', { sprint_dir: '../x' });
    expect(r.result.reason_code).toBe('sprint_dir_invalid');
  });

  describe('防篡改与防误操作', () => {
    const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(path.join(sprintAbs, file))).digest('hex');
    const hashes = () => ({ intent_sha256: sha('01-intent.md'), spec_sha256: sha('02-spec.md') });

    it('哈希与上下文一致 -> 正常 completed', async () => {
      const r = await run('build-ok', hashes());
      expect(r.exitCode, r.stderr).toBe(0);
    });

    it('claude 改了 02-spec.md -> fatal chain_tampered，evidence 指出文件', async () => {
      const r = await run('build-ok', hashes(), { FAKE_TAMPER_FILE: 'sprints/s1/02-spec.md' });
      expect(r.result.failure_class).toBe('fatal');
      expect(r.result.reason_code).toBe('chain_tampered');
      expect(r.result.evidence).toEqual([{ tampered_files: ['02-spec.md'] }]);
    });

    it('本次提交触及 sprint 目录 -> fatal chain_tampered，evidence 列出被提交的 sprint 文件', async () => {
      const r = await run('build-ok', hashes(), { FAKE_BUILD_EXTRA_FILE: 'sprints/s1/notes.md' });
      expect(r.result.reason_code).toBe('chain_tampered');
      expect(r.result.evidence).toEqual([{ committed_sprint_files: ['sprints/s1/notes.md'] }]);
    });

    it('build 期间远端分支变了（被推送）-> fatal remote_changed，evidence 带前后远端 SHA', async () => {
      const origin = path.join(root, 'origin.git');
      gitPlain('init', '--bare', '-q', origin);
      git(worktree, 'remote', 'add', 'origin', origin);
      const r = await run('build-ok', {}, { FAKE_PUSH: '1' });
      expect(r.result.failure_class).toBe('fatal');
      expect(r.result.reason_code).toBe('remote_changed');
      expect(r.result.evidence).toEqual([{ remote_before: '', remote_after: head() }]);
    });

    it('origin 已配置但 ls-remote 失败（重试后仍失败）-> retryable remote_check_failed，不启动 claude', async () => {
      git(worktree, 'remote', 'add', 'origin', path.join(root, 'no-such-origin.git'));
      const r = await run('build-ok');
      expect(r.result.failure_class).toBe('retryable');
      expect(r.result.reason_code).toBe('remote_check_failed');
      expect(r.stderr).not.toContain('FAKE_CWD');
    });

    it('claude 子进程拿不到 GH 令牌，GIT_TERMINAL_PROMPT=0', async () => {
      const r = await run('build-ok', {}, { GH_TOKEN: 'secret', GITHUB_TOKEN: 'secret' });
      expect(r.stderr).toContain('GH_TOKEN=<unset> GITHUB_TOKEN=<unset> GH_ENTERPRISE_TOKEN=<unset> GIT_TERMINAL_PROMPT=0');
      expect(r.stderr).toContain('FAKE_GH_CONFIG_EMPTY: true');
    });

    it('build-amend：运行前的 HEAD 不再是祖先 -> fatal build_history_rewritten', async () => {
      const before = head();
      const r = await run('build-amend');
      expect(r.result.failure_class).toBe('fatal');
      expect(r.result.reason_code).toBe('build_history_rewritten');
      expect(r.result.evidence[0]).toMatchObject({ head_before: before, head_after: head() });
    });

    it('build 期间切了分支 -> fatal build_history_rewritten，evidence 带前后分支', async () => {
      const r = await run('build-ok', {}, { FAKE_SWITCH_BRANCH: 'cp-1008000000-other' });
      expect(r.result.reason_code).toBe('build_history_rewritten');
      expect(r.result.evidence[0]).toMatchObject({ branch_before: 'cp-1008000000-test', branch_after: 'cp-1008000000-other' });
    });

    it.each(['CLAUDE.md', '.claude/settings.json', 'docs/AGENTS.md'])(
      '本次提交触及 agent 配置 %s -> fatal build_touched_agent_config',
      async (file) => {
        const r = await run('build-ok', {}, { FAKE_BUILD_EXTRA_FILE: file });
        expect(r.result.failure_class).toBe('fatal');
        expect(r.result.reason_code).toBe('build_touched_agent_config');
        expect(r.result.evidence).toEqual([{ files: [file] }]);
      },
    );

    it.each(['sprints/s1/CLAUDE.md', 'sprints/s1/notes.md'])(
      'sprint 目录里出现 03-build.md 以外的新文件 %s -> fatal build_sprint_polluted',
      async (file) => {
        const r = await run('build-ok', {}, { FAKE_TAMPER_FILE: file });
        expect(r.result.failure_class).toBe('fatal');
        expect(r.result.reason_code).toBe('build_sprint_polluted');
        expect(r.result.evidence).toEqual([{ files: [file] }]);
      },
    );

    it('build-badreport：03 的 upstream 没覆盖全部 S-n -> fatal build_report_invalid', async () => {
      const r = await run('build-badreport');
      expect(r.result.failure_class).toBe('fatal');
      expect(r.result.reason_code).toBe('build_report_invalid');
      expect(r.result.evidence[0].errors).toContain('not_covered:S-2');
    });

    it('03 没有 frontmatter -> fatal build_report_invalid', async () => {
      const r = await run('build-noreport', {}, { FAKE_TAMPER_FILE: 'sprints/s1/03-build.md' });
      expect(r.result.reason_code).toBe('build_report_invalid');
      expect(r.result.evidence[0].errors).toContain('frontmatter_missing');
    });
  });

  it('claude 鉴权失败 -> needs_human claude_auth', async () => {
    const r = await run('auth');
    expect(r.result.failure_class).toBe('needs_human');
    expect(r.result.reason_code).toBe('claude_auth');
  });

  it('claude 其他非 0 -> retryable claude_failed', async () => {
    const r = await run('fail');
    expect(r.result.failure_class).toBe('retryable');
    expect(r.result.reason_code).toBe('claude_failed');
  });

  it('claude 超时（CODING_WF_BUILD_TIMEOUT_MS）-> retryable claude_timeout', async () => {
    const started = Date.now();
    const r = await run('sleep', {}, { CODING_WF_BUILD_TIMEOUT_MS: '1500' });
    expect(r.result.failure_class).toBe('retryable');
    expect(r.result.reason_code).toBe('claude_timeout');
    expect(Date.now() - started).toBeLessThan(10000);
  });
});
