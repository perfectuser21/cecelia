import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from '../lib/md-chain.mjs';
import { runActivityProcess } from './helpers/run-activity.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(HERE, '../activities/spec.mjs');
const FAKE_CLAUDE = path.join(HERE, 'fixtures/fake-claude.mjs');
const TASK_ID = '11111111-2222-3333-4444-555555555555';

function gitInit(dir) {
  const env = { ...process.env };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[key];
  execFileSync('git', ['init', '-q', dir], { env, stdio: 'ignore' });
}

describe('spec 活动（子进程 + 假 claude）', () => {
  let worktree;

  beforeAll(() => {
    fs.chmodSync(FAKE_CLAUDE, 0o755);
  });
  beforeEach(() => {
    worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-test-'));
    gitInit(worktree);
  });
  afterEach(() => {
    fs.rmSync(worktree, { recursive: true, force: true });
  });

  const input = (patch = {}) => ({
    run_tag: 'rt-1',
    task_id: TASK_ID,
    worktree,
    sprint_dir: 'sprints/s1',
    intent_file: '01-intent.md',
    intent_ids: ['I-1', 'I-2'],
    ...patch,
  });
  const run = (mode, patch, extraEnv = {}) =>
    runActivityProcess(ENTRY, input(patch), {
      CODING_WF_CLAUDE_BIN: FAKE_CLAUDE,
      FAKE_CLAUDE_MODE: mode,
      ...extraEnv,
    });
  const specFile = () => path.join(worktree, 'sprints/s1/02-spec.md');

  it('ok：completed，写出合法 02-spec.md，stdout 整体可解析为单个结果 JSON', async () => {
    const r = await run('ok');
    expect(r.exitCode).toBe(0);
    expect(r.result).not.toBeNull();
    expect(r.result.failure_class).toBeNull();
    expect(r.result.run_tag).toBe('rt-1');
    expect(r.result.outputs).toEqual({ spec_file: '02-spec.md' });
    expect(r.stdout.trim().split('\n')).toHaveLength(1);

    const md = fs.readFileSync(specFile(), 'utf8');
    const fm = parseFrontmatter(md);
    expect(fm.data).toEqual({
      task_id: TASK_ID,
      step: 'spec',
      upstream: ['01-intent.md#I-1', '01-intent.md#I-2'],
    });
    expect(md).toContain('### S-1');
    expect(md).toContain('### S-2');
  });

  it('ok：子进程输出转写到 stderr，参数与 cwd 正确', async () => {
    const r = await run('ok');
    expect(r.stderr).toContain('fake claude log line 199');
    expect(r.stderr).toContain('FAKE_ARGS: -p --permission-mode acceptEdits --disallowedTools Bash');
    expect(r.stderr).toContain(`FAKE_CWD: ${fs.realpathSync(worktree)}`);
  });

  it('退出 0 但没写文件 -> fatal spec_missing', async () => {
    const r = await run('nofile');
    expect(r.exitCode).toBe(2);
    expect(r.result.failure_class).toBe('fatal');
    expect(r.result.reason_code).toBe('spec_missing');
    expect(r.stdout.trim().split('\n')).toHaveLength(1);
  });

  it('认证失败 -> needs_human claude_auth', async () => {
    const r = await run('auth');
    expect(r.exitCode).toBe(2);
    expect(r.result.failure_class).toBe('needs_human');
    expect(r.result.reason_code).toBe('claude_auth');
  });

  it('其他非 0 退出 -> retryable claude_failed', async () => {
    const r = await run('fail');
    expect(r.exitCode).toBe(2);
    expect(r.result.failure_class).toBe('retryable');
    expect(r.result.reason_code).toBe('claude_failed');
  });

  it('claude 可执行文件不存在 -> retryable claude_failed', async () => {
    const r = await runActivityProcess(ENTRY, input(), { CODING_WF_CLAUDE_BIN: '/nonexistent/claude-bin' });
    expect(r.exitCode).toBe(2);
    expect(r.result.failure_class).toBe('retryable');
    expect(r.result.reason_code).toBe('claude_failed');
  });

  it('sprint_dir 为绝对路径 -> fatal sprint_dir_invalid，不启动 claude', async () => {
    const r = await run('ok', { sprint_dir: '/abs' });
    expect(r.exitCode).toBe(2);
    expect(r.result.failure_class).toBe('fatal');
    expect(r.result.reason_code).toBe('sprint_dir_invalid');
    expect(r.stderr).not.toContain('FAKE_CWD');
  });

  it('intent_ids 缺失或为空 -> fatal intent_ids_missing', async () => {
    const r = await run('ok', { intent_ids: [] });
    expect(r.exitCode).toBe(2);
    expect(r.result.failure_class).toBe('fatal');
    expect(r.result.reason_code).toBe('intent_ids_missing');
  });

  it('task_id 与 sprint_dir 同时非法 -> 先报 task_id_missing', async () => {
    const r = await run('ok', { task_id: '', sprint_dir: '/abs' });
    expect(r.result.reason_code).toBe('task_id_missing');
    expect(r.stderr).not.toContain('FAKE_CWD');
  });

  it('旧 02-spec.md 残留 + claude 退出 0 但没写新文件 -> fatal spec_missing（不把旧产物当新产物）', async () => {
    fs.mkdirSync(path.dirname(specFile()), { recursive: true });
    fs.writeFileSync(specFile(), '# stale spec\n');
    const r = await run('nofile');
    expect(r.exitCode).toBe(2);
    expect(r.result.failure_class).toBe('fatal');
    expect(r.result.reason_code).toBe('spec_missing');
    expect(fs.existsSync(specFile())).toBe(false);
  });

  it('子进程看不到 CLAUDECODE 与 CLAUDE_CODE_*', async () => {
    const r = await run('ok', {}, { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' });
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toContain('FAKE_ENV: CLAUDECODE=<unset> CLAUDE_CODE_ENTRYPOINT=<unset>');
  });

  it('继承的 GIT_DIR 被剥离，越界检查与 claude 子进程都不受影响', async () => {
    const r = await run('ok', {}, { GIT_DIR: path.join(worktree, 'bogus.git') });
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toContain('GIT_DIR=<unset>');
  });

  it('claude 越界写 sprint_dir 之外 -> fatal spec_out_of_scope_write，evidence 列出越界文件', async () => {
    const r = await run('outside');
    expect(r.exitCode).toBe(2);
    expect(r.result.failure_class).toBe('fatal');
    expect(r.result.reason_code).toBe('spec_out_of_scope_write');
    expect(r.result.evidence).toEqual([{ out_of_scope_changes: ['stray.txt'] }]);
  });

  it('运行前已存在的无关脏文件不算越界', async () => {
    fs.writeFileSync(path.join(worktree, 'pre-existing.txt'), 'dirty\n');
    const r = await run('ok');
    expect(r.exitCode).toBe(0);
    expect(r.result.failure_class).toBeNull();
  });

  it('sprint_dir 内的其他文件改动不算越界', async () => {
    fs.mkdirSync(path.dirname(specFile()), { recursive: true });
    fs.writeFileSync(path.join(worktree, 'sprints/s1/01-intent.md'), '# intent\n');
    const r = await run('ok');
    expect(r.exitCode).toBe(0);
  });

  it.each([[['I-1', 5]], [['i-1']], [['I-']], [['I-1;rm']], [['I-1\nX']]])(
    'intent_ids 元素非法 %j -> fatal intent_ids_invalid，不启动 claude',
    async (ids) => {
      const r = await run('ok', { intent_ids: ids });
      expect(r.exitCode).toBe(2);
      expect(r.result.failure_class).toBe('fatal');
      expect(r.result.reason_code).toBe('intent_ids_invalid');
      expect(r.stderr).not.toContain('FAKE_CWD');
    },
  );

  it('intent_file 入参不再生效，prompt 固定指向 01-intent.md', async () => {
    const r = await run('ok', { intent_file: '../../etc/passwd' });
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toContain(`FAKE_INTENT_PATH: ${path.join(worktree, 'sprints/s1/01-intent.md')}`);
  });

  it.each(['Invalid API key', 'please run /login', 'quota exceeded', 'rate limit reached', 'authentication failed'])(
    '认证/额度类输出 %s -> needs_human claude_auth',
    async (text) => {
      const r = await run('fail', {}, { FAKE_CLAUDE_TEXT: text });
      expect(r.result.failure_class).toBe('needs_human');
      expect(r.result.reason_code).toBe('claude_auth');
    },
  );

  it.each(['author mismatch in file', 'authorization of the plan failed'])(
    '输出含 author/authorization（%s）不误判为认证失败 -> retryable claude_failed',
    async (text) => {
      const r = await run('fail', {}, { FAKE_CLAUDE_TEXT: text });
      expect(r.result.failure_class).toBe('retryable');
      expect(r.result.reason_code).toBe('claude_failed');
    },
  );
});
