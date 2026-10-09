import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runActivityProcess } from './helpers/run-activity.mjs';
import { git, gitPlain, initCommittableRepo } from './helpers/git.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(HERE, '../activities/verify.mjs');
const FAKE_CLAUDE = path.join(HERE, 'fixtures/fake-claude.mjs');
const TASK_ID = '11111111-2222-3333-4444-555555555555';

describe('verify 活动（子进程 + 假 claude）', () => {
  let root;
  let worktree;
  let sprintAbs;

  beforeAll(() => {
    fs.chmodSync(FAKE_CLAUDE, 0o755);
  });
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-test-'));
    worktree = path.join(root, 'wt');
    fs.mkdirSync(worktree);
    initCommittableRepo(worktree, path.join(root, 'no-hooks'));
    sprintAbs = path.join(worktree, 'sprints/s1');
    fs.mkdirSync(sprintAbs, { recursive: true });
    fs.writeFileSync(path.join(sprintAbs, '01-intent.md'), '# intent\n');
    fs.writeFileSync(path.join(sprintAbs, '03-build.md'), '# build 自述\n');
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const input = (patch = {}) => ({
    run_tag: 'rt-1',
    task_id: TASK_ID,
    worktree,
    sprint_dir: 'sprints/s1',
    intent_file: '01-intent.md',
    intent_ids: ['I-1', 'I-2'],
    build_file: '03-build.md',
    ...patch,
  });
  const run = (mode, patch, extraEnv = {}) =>
    runActivityProcess(ENTRY, input(patch), { CODING_WF_CLAUDE_BIN: FAKE_CLAUDE, FAKE_CLAUDE_MODE: mode, ...extraEnv });
  const evidenceFile = () => path.join(sprintAbs, '04-evidence.md');

  it('verify-pass：completed，outputs 为 04-evidence.md 与全部 I-n', async () => {
    const r = await run('verify-pass');
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.result.failure_class).toBeNull();
    expect(r.result.outputs).toEqual({ evidence_file: '04-evidence.md', verified_ids: ['I-1', 'I-2'] });
    expect(r.stdout.trim().split('\n')).toHaveLength(1);
    expect(fs.existsSync(evidenceFile())).toBe(true);
  });

  it('独立会话：prompt 不提 03-build；参数允许 Bash，禁 git push / git commit / gh', async () => {
    const r = await run('verify-pass');
    expect(r.stderr).toContain('FAKE_PROMPT_MENTIONS_BUILD: false');
    expect(r.stderr).toMatch(/FAKE_ARGS: .* --model opus\n/);
    expect(r.stderr).toContain(
      'FAKE_ARGS: -p --permission-mode acceptEdits --output-format stream-json --verbose --setting-sources user '
      + '--allowedTools Bash --disallowedTools Bash(git push:*) Bash(git commit:*) '
      // Claude Code 权限规则里 `//` 开头才是绝对路径
      + `Bash(git reset:*) Bash(git checkout:*) Bash(git rebase:*) Bash(gh:*) Read(/${path.join(sprintAbs, '03-build.md')})`,
    );
    expect(r.stderr).toContain(`FAKE_INTENT_PATH: ${path.join(sprintAbs, '01-intent.md')}`);
  });

  it('verify-fail：一条 FAIL -> fatal verification_failed，evidence 带失败条目与逐条 verdict', async () => {
    const r = await run('verify-fail');
    expect(r.exitCode).toBe(2);
    expect(r.result.failure_class).toBe('fatal');
    expect(r.result.reason_code).toBe('verification_failed');
    expect(r.result.evidence).toEqual([{
      failed: [{ id: 'E-2', covers: ['I-2'], command: 'npm test -- I-2', output: 'AssertionError: expected 500 to be 200' }],
      verdicts: [{ intent: 'I-1', verdict: 'PASS' }, { intent: 'I-2', verdict: 'FAIL' }],
    }]);
    // 失败结论放进 outputs，执行器会合并进上下文供 report 回写 Brain
    expect(r.result.outputs).toEqual({
      verification: {
        status: 'failed',
        reason_code: 'verification_failed',
        failed: [{ id: 'E-2', covers: ['I-2'], command: 'npm test -- I-2', output_tail: 'AssertionError: expected 500 to be 200' }],
      },
    });
  });

  it('verify-badformat：缺 output -> fatal evidence_invalid，evidence 列出格式错误', async () => {
    const r = await run('verify-badformat');
    expect(r.result.failure_class).toBe('fatal');
    expect(r.result.reason_code).toBe('evidence_invalid');
    expect(r.result.evidence[0].errors).toContain('E-1:output_missing');
    const { verification } = r.result.outputs;
    expect(verification).toMatchObject({ status: 'failed', reason_code: 'evidence_invalid', failed: [] });
    expect(verification.errors).toContain('E-1:output_missing');
  });

  it('verify-uncovered：有 I-n 无 E 条目 -> fatal evidence_incomplete，evidence 列出缺的 I-n', async () => {
    const r = await run('verify-uncovered');
    expect(r.result.failure_class).toBe('fatal');
    expect(r.result.reason_code).toBe('evidence_incomplete');
    expect(r.result.evidence).toEqual([{ missing: ['I-2'] }]);
    expect(r.result.outputs).toEqual({
      verification: { status: 'failed', reason_code: 'evidence_incomplete', failed: [], missing: ['I-2'] },
    });
  });

  it('verify-outside：sprint 目录外有新改动 -> fatal verify_out_of_scope_write', async () => {
    const r = await run('verify-outside');
    expect(r.result.failure_class).toBe('fatal');
    expect(r.result.reason_code).toBe('verify_out_of_scope_write');
    expect(r.result.evidence).toEqual([{ out_of_scope_changes: ['stray.txt'] }]);
    expect(r.result.outputs).toEqual({});
  });

  it('verify-reset：运行中 HEAD 被改（reset --hard HEAD~1）-> fatal verify_head_moved，evidence 带前后 SHA', async () => {
    fs.writeFileSync(path.join(worktree, 'code.js'), 'x\n');
    git(worktree, 'add', '--', 'code.js');
    git(worktree, 'commit', '-q', '-m', 'feat: code');
    const before = git(worktree, 'rev-parse', 'HEAD').trim();
    const parent = git(worktree, 'rev-parse', 'HEAD~1').trim();
    const r = await run('verify-reset');
    expect(r.exitCode).toBe(2);
    expect(r.result.failure_class).toBe('fatal');
    expect(r.result.reason_code).toBe('verify_head_moved');
    expect(r.result.evidence).toEqual([{ head_before: before, head_after: parent }]);
  });

  it('没写 04-evidence.md -> fatal evidence_missing；旧 04 残留会先被删', async () => {
    fs.writeFileSync(evidenceFile(), '# stale\n');
    const r = await run('nofile');
    expect(r.result.failure_class).toBe('fatal');
    expect(r.result.reason_code).toBe('evidence_missing');
    expect(fs.existsSync(evidenceFile())).toBe(false);
  });

  it('运行前已存在的无关脏文件不算越界', async () => {
    fs.writeFileSync(path.join(worktree, 'pre-existing.txt'), 'dirty\n');
    const r = await run('verify-pass');
    expect(r.exitCode, r.stderr).toBe(0);
  });

  it.each([[[], 'intent_ids_missing'], [['i-1'], 'intent_ids_invalid']])(
    'intent_ids=%j -> fatal %s，不启动 claude',
    async (ids, code) => {
      const r = await run('verify-pass', { intent_ids: ids });
      expect(r.result.reason_code).toBe(code);
      expect(r.stderr).not.toContain('FAKE_CWD');
    },
  );

  describe('独立性与防篡改', () => {
    const buildFile = () => path.join(sprintAbs, '03-build.md');
    const intentSha = () => crypto.createHash('sha256').update(fs.readFileSync(path.join(sprintAbs, '01-intent.md'))).digest('hex');

    it.each(['verify-pass', 'verify-fail', 'fail'])('%s：运行期间 03-build.md 不在 sprint 目录，结束后原样放回', async (mode) => {
      const r = await run(mode);
      if (mode !== 'fail') expect(r.stderr).toContain('FAKE_BUILD_PRESENT: false');
      expect(fs.readFileSync(buildFile(), 'utf8')).toBe('# build 自述\n');
      const gitDir = git(worktree, 'rev-parse', '--absolute-git-dir').trim();
      expect(fs.existsSync(path.join(gitDir, 'coding-wf/03-build.md'))).toBe(false);
    });

    it('claude 超时：03-build.md 仍被放回', async () => {
      const r = await run('sleep', {}, { CODING_WF_VERIFY_TIMEOUT_MS: '1500' });
      expect(r.result.reason_code).toBe('claude_timeout');
      expect(fs.readFileSync(buildFile(), 'utf8')).toBe('# build 自述\n');
    });

    it('上次中断残留在 git 目录下的 03 -> 开始时先放回，结束后仍在 sprint 目录', async () => {
      const gitDir = git(worktree, 'rev-parse', '--absolute-git-dir').trim();
      fs.mkdirSync(path.join(gitDir, 'coding-wf'), { recursive: true });
      fs.writeFileSync(path.join(gitDir, 'coding-wf/03-build.md'), '# 残留\n');
      fs.rmSync(buildFile());
      const r = await run('verify-pass');
      expect(r.exitCode, r.stderr).toBe(0);
      expect(r.stderr).toContain('FAKE_BUILD_PRESENT: false');
      expect(fs.readFileSync(buildFile(), 'utf8')).toBe('# 残留\n');
      expect(fs.existsSync(path.join(gitDir, 'coding-wf/03-build.md'))).toBe(false);
    });

    it('暂存的 03 在运行中丢失、放回失败 -> fatal build_report_restore_failed（不变成未声明的 ENOENT）', async () => {
      const gitDir = git(worktree, 'rev-parse', '--absolute-git-dir').trim();
      const r = await run('verify-pass', {}, { FAKE_DELETE_FILE: path.join(gitDir, 'coding-wf/03-build.md') });
      expect(r.result.failure_class).toBe('fatal');
      expect(r.result.reason_code).toBe('build_report_restore_failed');
    });

    it('prompt 写明只读 INTENT_PATH、不读 SPRINT_DIR 下其他文件', () => {
      const text = fs.readFileSync(path.join(HERE, '../prompts/verify.md'), 'utf8');
      expect(text).toContain('只读 INTENT_PATH，不读 SPRINT_DIR 下其他文件');
    });

    it('prompt 要求 command 块逐字照抄实际执行过的那条命令（不补 cd、不改写）', () => {
      const text = fs.readFileSync(path.join(HERE, '../prompts/verify.md'), 'utf8');
      expect(text).toContain('逐字照抄');
      expect(text).toContain('不要补 cd 前缀');
    });

    it('verify-cdprefix：证据命令带 cd <worktree> && 前缀，实际执行时没有 -> completed', async () => {
      const r = await run('verify-cdprefix');
      expect(r.result.status).toBe('completed');
    });

    it('verify-fabricated：04 的命令在对话记录里没执行过 -> fatal evidence_unverified，outputs 带 verification', async () => {
      const r = await run('verify-fabricated');
      expect(r.result.failure_class).toBe('fatal');
      expect(r.result.reason_code).toBe('evidence_unverified');
      const unverified = [{ id: 'E-1', reason: 'command_not_executed' }, { id: 'E-2', reason: 'command_not_executed' }];
      expect(r.result.evidence).toEqual([{ unverified }]);
      expect(r.result.outputs).toEqual({
        verification: { status: 'failed', reason_code: 'evidence_unverified', failed: [], unverified },
      });
    });

    it('上下文 intent_sha256 与 01 不符 -> 运行前就 fatal chain_tampered，不启动 claude', async () => {
      const r = await run('verify-pass', { intent_sha256: 'deadbeef' });
      expect(r.result.reason_code).toBe('chain_tampered');
      expect(r.result.evidence).toEqual([{ tampered_files: ['01-intent.md'] }]);
      expect(r.stderr).not.toContain('FAKE_CWD');
    });

    it('verify 期间 01 被改 -> fatal chain_tampered', async () => {
      const r = await run('verify-pass', { intent_sha256: intentSha() }, { FAKE_TAMPER_FILE: 'sprints/s1/01-intent.md' });
      expect(r.result.reason_code).toBe('chain_tampered');
      expect(r.result.evidence).toEqual([{ tampered_files: ['01-intent.md'] }]);
    });

    it('verify 期间远端分支变了 -> fatal remote_changed', async () => {
      const origin = path.join(root, 'origin.git');
      gitPlain('init', '--bare', '-q', origin);
      git(worktree, 'remote', 'add', 'origin', origin);
      const r = await run('verify-pass', {}, { FAKE_PUSH: '1' });
      expect(r.result.reason_code).toBe('remote_changed');
      expect(r.result.evidence).toEqual([{ remote_before: '', remote_after: git(worktree, 'rev-parse', 'HEAD').trim() }]);
    });

    it('origin 已配置但 ls-remote 失败（重试后仍失败）-> retryable remote_check_failed，不启动 claude', async () => {
      git(worktree, 'remote', 'add', 'origin', path.join(root, 'no-such-origin.git'));
      const r = await run('verify-pass');
      expect(r.result.failure_class).toBe('retryable');
      expect(r.result.reason_code).toBe('remote_check_failed');
      expect(r.stderr).not.toContain('FAKE_CWD');
    });

    it('claude 子进程拿不到 GH 令牌', async () => {
      const r = await run('verify-pass', {}, { GH_TOKEN: 'secret' });
      expect(r.stderr).toContain('GH_TOKEN=<unset>');
      expect(r.stderr).toContain('FAKE_GH_CONFIG_EMPTY: true');
    });
  });

  it('verify-bizauth：业务输出含 authentication failed、claude 非 0 退出 -> retryable claude_failed', async () => {
    const r = await run('verify-bizauth');
    expect(r.result.failure_class).toBe('retryable');
    expect(r.result.reason_code).toBe('claude_failed');
  });

  it('verify-authresult：result 事件是鉴权错误 -> needs_human claude_auth', async () => {
    const r = await run('verify-authresult');
    expect(r.result.failure_class).toBe('needs_human');
    expect(r.result.reason_code).toBe('claude_auth');
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

  it('claude 超时（CODING_WF_VERIFY_TIMEOUT_MS）-> retryable claude_timeout', async () => {
    const r = await run('sleep', {}, { CODING_WF_VERIFY_TIMEOUT_MS: '1500' });
    expect(r.result.failure_class).toBe('retryable');
    expect(r.result.reason_code).toBe('claude_timeout');
  });
});
