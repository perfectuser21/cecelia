import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from '../lib/md-chain.mjs';
import { runActivityProcess } from './helpers/run-activity.mjs';
import { gitPlain } from './helpers/git.mjs';
import { expectGone, readPid } from './helpers/procs.mjs';
import { callActivityProcess } from '../../../src/orchestrator/activity-process.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(HERE, '../activities/spec.mjs');
const FAKE_CLAUDE = path.join(HERE, 'fixtures/fake-claude.mjs');
const TASK_ID = '11111111-2222-3333-4444-555555555555';

describe('spec 活动（子进程 + 假 claude）', () => {
  let worktree;
  let pidDir;

  beforeAll(() => {
    fs.chmodSync(FAKE_CLAUDE, 0o755);
  });
  beforeEach(() => {
    worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-test-'));
    pidDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-pids-')); // 不放进 worktree，免得被当成越界写
    gitPlain('init', '-q', worktree);
  });
  afterEach(() => {
    fs.rmSync(worktree, { recursive: true, force: true });
    fs.rmSync(pidDir, { recursive: true, force: true });
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
    expect(r.stdout.trim().split('\n')).toHaveLength(1);

    const md = fs.readFileSync(specFile(), 'utf8');
    expect(r.result.outputs).toEqual({ spec_file: '02-spec.md', spec_sha256: crypto.createHash('sha256').update(md).digest('hex') });
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
    expect(r.stderr).toContain('FAKE_ARGS: -p --permission-mode acceptEdits --disallowedTools Bash --model opus\n');
    expect(r.stderr).toContain(`FAKE_CWD: ${fs.realpathSync(worktree)}`);
  });

  it('claude 改了 01-intent.md（与上下文 intent_sha256 不符）-> fatal chain_tampered', async () => {
    const intent = path.join(worktree, 'sprints/s1/01-intent.md');
    fs.mkdirSync(path.dirname(intent), { recursive: true });
    fs.writeFileSync(intent, '# intent\n');
    const intentSha = crypto.createHash('sha256').update('# intent\n').digest('hex');
    const r = await run('ok', { intent_sha256: intentSha }, { FAKE_TAMPER_FILE: 'sprints/s1/01-intent.md' });
    expect(r.exitCode).toBe(2);
    expect(r.result.failure_class).toBe('fatal');
    expect(r.result.reason_code).toBe('chain_tampered');
    expect(r.result.evidence).toEqual([{ tampered_files: ['01-intent.md'] }]);
  });

  // 审计 P1 #3：有铁律清单（01-invariants.md）时，02 必须有 `## 铁律对照` 逐条交代
  describe('铁律对照', () => {
    const writeInvariants = () => {
      fs.mkdirSync(path.join(worktree, 'sprints/s1'), { recursive: true });
      fs.writeFileSync(path.join(worktree, 'sprints/s1/01-invariants.md'), '# 铁律清单\n\n### INV-02d8e749\n不得缩减已拍板设计\n\n### INV-96054a8b\nus-vps 零执行\n');
    };

    it('prompt 带 INVARIANTS_PATH；02 逐条交代 → completed', async () => {
      writeInvariants();
      const r = await run('ok');
      expect(r.result.status, JSON.stringify(r.result)).toBe('completed');
      expect(fs.readFileSync(specFile(), 'utf8')).toContain('## 铁律对照');
      const prompt = fs.readFileSync(path.join(HERE, '../prompts/spec.md'), 'utf8');
      for (const s of ['INVARIANTS_PATH: {{INVARIANTS_PATH}}', '## 铁律对照', '不适用', '无相关铁律']) expect(prompt).toContain(s);
    });

    it('有清单但 02 没写铁律对照 → retryable spec_invalid（invariants_section_missing）', async () => {
      writeInvariants();
      const r = await run('noinv');
      expect(r.result.reason_code).toBe('spec_invalid');
      expect(JSON.stringify(r.result.evidence)).toContain('invariants_section_missing');
    });

    it('没有清单文件（旧 sprint）→ 不要求铁律对照', async () => {
      const r = await run('noinv');
      expect(r.result.status).toBe('completed');
    });
  });

  it('titled：S-n 标题行带说明文字（真实 claude c2afa8ba）-> completed', async () => {
    const r = await run('titled');
    expect(r.result.status).toBe('completed');
  });

  it('noids：02 没有任何 S-n 标题 -> retryable spec_invalid（当场拦，不留给 build 报 spec_ids_missing）', async () => {
    const r = await run('noids');
    expect(r.result.failure_class).toBe('retryable');
    expect(r.result.reason_code).toBe('spec_invalid');
    expect(JSON.stringify(r.result.evidence)).toContain('spec_ids_missing');
  });

  it('noqa：02 没写 QA 场景 -> retryable spec_invalid（qa_missing），prompt 要求用户视角 QA 场景', async () => {
    const r = await run('noqa');
    expect(r.result.reason_code).toBe('spec_invalid');
    expect(JSON.stringify(r.result.evidence)).toContain('qa_missing');
    const prompt = fs.readFileSync(path.join(HERE, '../prompts/spec.md'), 'utf8');
    for (const s of ['## QA 场景', '### Q-n', '对应:', '前提:', '操作:', '期望:', '不能是单元测试']) expect(prompt).toContain(s);
    // QA 场景不写死生产地址（金丝雀 3e8414f6：Q-n 写着 localhost:5221，诱发 QA 越界/误判）
    expect(prompt).toContain('<预览环境>/api/brain/');
    expect(prompt).toContain('不能写 `localhost:5221`');
  });

  // 审计 #33：重试必须带新信息——上次生成的 02 不合格，重跑时把问题交给 claude，而不是原样再来一遍
  it('重试：上次的 02 不合格 → prompt 的 PREV_ERRORS 列出上次的问题；首次生成写「无」', async () => {
    let r = await run('ok');
    expect(r.stderr).toContain('FAKE_PREV_ERRORS: 无');
    r = await run('noids');
    expect(r.result.reason_code).toBe('spec_invalid');
    r = await run('ok');
    expect(r.result.status, r.stderr).toBe('completed');
    expect(r.stderr).toMatch(/FAKE_PREV_ERRORS: .*spec_ids_missing/);
    const prompt = fs.readFileSync(path.join(HERE, '../prompts/spec.md'), 'utf8');
    expect(prompt).toContain('PREV_ERRORS: {{PREV_ERRORS}}');
  });

  it('uncovered：02 的 upstream 没覆盖全部 I-n -> retryable spec_invalid，evidence 点名未覆盖的 I-n', async () => {
    const r = await run('uncovered');
    expect(r.result.failure_class).toBe('retryable');
    expect(r.result.reason_code).toBe('spec_invalid');
    expect(JSON.stringify(r.result.evidence)).toContain('not_covered:I-2');
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

  const pidFiles = () => ({
    FAKE_CLAUDE_PID_FILE: path.join(pidDir, 'claude.pid'),
    FAKE_CLAUDE_CHILD_PID_FILE: path.join(pidDir, 'child.pid'),
  });

  it('claude 卡死超时 -> retryable claude_timeout，不留 02-spec.md，claude 与孙进程都已被清理', async () => {
    const files = pidFiles();
    const started = Date.now();
    // 2500ms：给假 claude 留足启动并写 pid 文件的时间，CI 高负载下不早于 pid 文件写入
    const r = await run('sleep', {}, { CODING_WF_SPEC_TIMEOUT_MS: '2500', ...files });
    const elapsed = Date.now() - started;
    expect(r.exitCode).toBe(2);
    expect(r.result.status).toBe('failed');
    expect(r.result.failure_class).toBe('retryable');
    expect(r.result.reason_code).toBe('claude_timeout');
    expect(r.stdout.trim().split('\n')).toHaveLength(1);
    expect(elapsed).toBeLessThan(10000);
    expect(fs.existsSync(specFile())).toBe(false);

    await expectGone(readPid(files.FAKE_CLAUDE_PID_FILE), '假 claude');
    // 孙进程（claude 起的子进程）也必须随进程组一起被清理，不能成孤儿
    await expectGone(readPid(files.FAKE_CLAUDE_CHILD_PID_FILE), '孙进程');
  });

  it('超时被 budget 钳制：CODING_WF_SPEC_TIMEOUT_MS 远大于 budget 时仍在 budget 之内报 claude_timeout', async () => {
    const files = pidFiles();
    const started = Date.now();
    // budget 17s -> 钳到 17000 - 5000(KILL 宽限) - 10000(余量) = 2000ms；不钳制则要等 600s
    const r = await run('sleep', { budget: { max_duration_s: 17, heartbeat_s: 30 } }, {
      CODING_WF_SPEC_TIMEOUT_MS: '600000',
      ...files,
    });
    expect(r.exitCode).toBe(2);
    expect(r.result.failure_class).toBe('retryable');
    expect(r.result.reason_code).toBe('claude_timeout');
    expect(Date.now() - started).toBeLessThan(10000);
    await expectGone(readPid(files.FAKE_CLAUDE_CHILD_PID_FILE), '孙进程');
  });

  it('执行器取消（callActivityProcess + AbortSignal）-> claude 与孙进程都被清理，不成孤儿', async () => {
    const files = pidFiles();
    const saved = {};
    const env = {
      CODING_WF_CLAUDE_BIN: FAKE_CLAUDE,
      FAKE_CLAUDE_MODE: 'sleep',
      CODING_WF_SPEC_TIMEOUT_MS: '600000',
      ...files,
    };
    for (const [k, v] of Object.entries(env)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    try {
      const ac = new AbortController();
      const activity = {
        key: 'spec',
        runtime: { entry: 'activities/spec.mjs' },
        budget: { max_duration_s: 900, heartbeat_s: 30 },
      };
      const pending = callActivityProcess(activity, input(), {
        cwd: path.join(HERE, '..'),
        signal: ac.signal,
      });
      // 等假 claude 与孙进程都就绪再取消
      for (let i = 0; i < 100 && !(fs.existsSync(files.FAKE_CLAUDE_PID_FILE) && fs.existsSync(files.FAKE_CLAUDE_CHILD_PID_FILE)); i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      ac.abort();
      const r = await pending;
      expect(r.reason_code).toBe('run_cancelled');
      expect(r.duration_s).toBeLessThan(10);
      await expectGone(readPid(files.FAKE_CLAUDE_PID_FILE), '假 claude');
      await expectGone(readPid(files.FAKE_CLAUDE_CHILD_PID_FILE), '孙进程');
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  }, 30000);

  it.each(['inherit', 'ignore'])(
    'claude 正常退出但留下孙进程（stdio=%s）-> 仍 completed，孙进程被清理，不等到超时',
    async (stdio) => {
      const files = pidFiles();
      const started = Date.now();
      const r = await run('linger', {}, { FAKE_CLAUDE_CHILD_STDIO: stdio, ...files });
      expect(r.exitCode).toBe(0);
      expect(r.result.failure_class).toBeNull();
      expect(r.result.outputs.spec_file).toBe('02-spec.md');
      expect(Date.now() - started).toBeLessThan(10000);
      expect(fs.existsSync(specFile())).toBe(true);
      await expectGone(readPid(files.FAKE_CLAUDE_CHILD_PID_FILE), '孙进程');
    },
  );

  it.each(['abc', '0', '-5', '1.5', ''])(
    'CODING_WF_SPEC_TIMEOUT_MS=%j 非法 -> 回退默认超时，正常 claude 不受影响',
    async (value) => {
      const r = await run('ok', {}, { CODING_WF_SPEC_TIMEOUT_MS: value });
      expect(r.exitCode).toBe(0);
      expect(r.result.failure_class).toBeNull();
    },
  );
});
