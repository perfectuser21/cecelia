// lib/claude.mjs 单测：超时计算、失败映射、进程组收割、越界写快照（spec/build/verify 共用）。
// 取消路径（执行器 SIGTERM）会让活动进程 process.exit，不在本进程内测，由 spec.test 经 callActivityProcess 覆盖。
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitPlain } from './helpers/git.mjs';
import { expectGone, readPid } from './helpers/procs.mjs';
import {
  claudeTimeoutMs,
  claudeFailure,
  runClaude,
  snapshotChanges,
  outOfScopeChanges,
  renderPrompt,
} from '../lib/claude.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = path.join(HERE, 'fixtures/fake-claude.mjs');

describe('claudeTimeoutMs', () => {
  const opts = (raw) => ({ envVar: 'X_TIMEOUT_MS', defaultMs: 870000, env: raw === undefined ? {} : { X_TIMEOUT_MS: raw } });

  it('无覆盖、无 budget -> 默认值', () => {
    expect(claudeTimeoutMs(undefined, opts())).toBe(870000);
  });
  it('合法覆盖值生效', () => {
    expect(claudeTimeoutMs(undefined, opts('2500'))).toBe(2500);
  });
  it.each(['abc', '0', '-5', '1.5', '', '99999999999999999999'])('非法覆盖 %j -> 回退默认', (raw) => {
    expect(claudeTimeoutMs(undefined, opts(raw))).toBe(870000);
  });
  it('钳到 budget - 5s KILL 宽限 - 10s 余量', () => {
    expect(claudeTimeoutMs({ max_duration_s: 17 }, opts('600000'))).toBe(2000);
    expect(claudeTimeoutMs({ max_duration_s: 2400 }, { envVar: 'X', defaultMs: 2370000, env: {} })).toBe(2370000);
  });
  it('budget 很小时最低 1000ms', () => {
    expect(claudeTimeoutMs({ max_duration_s: 3 }, opts())).toBe(1000);
  });

  it('reserveMs：再为 claude 退出后的检查阶段预留时间（钳制与默认都在其内）', () => {
    const verify = { envVar: 'X', defaultMs: 1110000, reserveMs: 75000 };
    expect(claudeTimeoutMs({ max_duration_s: 1200 }, { ...verify, env: {} })).toBe(1110000);
    expect(claudeTimeoutMs({ max_duration_s: 1200 }, { ...verify, env: { X: '1185000' } })).toBe(1110000);
    expect(claudeTimeoutMs({ max_duration_s: 60 }, { ...verify, env: {} })).toBe(1000);
  });
});

describe('claudeFailure', () => {
  const base = { code: 0, output: '', timedOut: false, terminated: false };

  it('退出 0 -> null（不是失败）', () => {
    expect(claudeFailure(base)).toBeNull();
  });
  it('超时 -> retryable claude_timeout', () => {
    expect(claudeFailure({ ...base, code: null, timedOut: true })).toMatchObject({
      status: 'failed', failure_class: 'retryable', reason_code: 'claude_timeout',
    });
  });
  it('被取消 -> retryable claude_failed，evidence 标 terminated', () => {
    expect(claudeFailure({ ...base, code: null, terminated: true })).toEqual({
      status: 'failed', failure_class: 'retryable', reason_code: 'claude_failed', evidence: [{ terminated: true }],
    });
  });
  it.each(['Invalid API key', 'please run /login', 'quota exceeded', 'rate limit reached', 'authentication failed'])(
    '非 0 且输出 %s -> needs_human claude_auth',
    (output) => {
      expect(claudeFailure({ ...base, code: 1, output })).toMatchObject({ failure_class: 'needs_human', reason_code: 'claude_auth' });
    },
  );
  it.each(['author mismatch', 'authorization of the plan failed', '', '登录功能 login 测试失败', 'GET /login 返回 500', 'login failed for user test'])('非 0 且输出 %j -> retryable claude_failed', (output) => {
    expect(claudeFailure({ ...base, code: 1, output })).toMatchObject({ failure_class: 'retryable', reason_code: 'claude_failed' });
  });
  it('spawn 失败（code null）-> retryable claude_failed', () => {
    expect(claudeFailure({ ...base, code: null, output: 'ENOENT' })).toMatchObject({ reason_code: 'claude_failed' });
  });
});

describe('claudeFailure（stream-json 模式只看 claude 自身的错误事件）', () => {
  const event = (obj) => JSON.stringify(obj);
  const bizOutput = [
    event({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } }] } }),
    event({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'authentication failed for user admin' }] } }),
  ].join('\n');
  const base = { code: 1, timedOut: false, terminated: false, stderr: '' };

  it('tool_result 里的业务输出含 authentication failed -> retryable claude_failed', () => {
    const run = { ...base, stdout: bizOutput, output: bizOutput };
    expect(claudeFailure(run, { streamJson: true })).toMatchObject({ failure_class: 'retryable', reason_code: 'claude_failed' });
    // 非 stream-json 模式仍按全部输出的正则判定
    expect(claudeFailure(run)).toMatchObject({ failure_class: 'needs_human', reason_code: 'claude_auth' });
  });

  it('result 事件是鉴权错误 -> needs_human claude_auth', () => {
    const stdout = `${bizOutput}\n${event({ type: 'result', subtype: 'error', is_error: true, result: 'Invalid API key · Please run /login' })}`;
    expect(claudeFailure({ ...base, stdout, output: stdout }, { streamJson: true }))
      .toMatchObject({ failure_class: 'needs_human', reason_code: 'claude_auth' });
  });

  it('claude 自己写到 stderr 的鉴权报错（未进入 stream）-> needs_human claude_auth', () => {
    const run = { ...base, stdout: '', stderr: 'Invalid API key · Please run /login\n', output: 'Invalid API key' };
    expect(claudeFailure(run, { streamJson: true })).toMatchObject({ reason_code: 'claude_auth' });
  });
});

describe('renderPrompt', () => {
  it('替换 {{KEY}}，值里的 $& 等特殊序列原样保留', () => {
    expect(renderPrompt('a {{X}} b {{X}} {{Y}}', { X: '$&1', Y: 'y' })).toBe('a $&1 b $&1 y');
  });
});

describe('runClaude（进程内 + 假 claude）', () => {
  let tmp;
  const saved = {};
  const setEnv = (vars) => {
    for (const [k, v] of Object.entries(vars)) {
      if (!(k in saved)) saved[k] = process.env[k];
      process.env[k] = v;
    }
  };

  beforeAll(() => {
    fs.chmodSync(FAKE_CLAUDE, 0o755);
  });
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-lib-'));
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
      delete saved[k];
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const prompt = () => `TASK_ID: t-1\nSPEC_PATH: ${path.join(tmp, 'out/02-spec.md')}\nINTENT_IDS: I-1\n`;
  const pids = () => ({
    FAKE_CLAUDE_PID_FILE: path.join(tmp, 'claude.pid'),
    FAKE_CLAUDE_CHILD_PID_FILE: path.join(tmp, 'child.pid'),
  });

  it('正常退出：code 0，输出收集完整，参数与 cwd 透传，CLAUDECODE/CLAUDE_CODE_*/GIT_DIR 被剥离', async () => {
    setEnv({
      CODING_WF_CLAUDE_BIN: FAKE_CLAUDE,
      FAKE_CLAUDE_MODE: 'ok',
      CLAUDECODE: '1',
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      GIT_DIR: path.join(tmp, 'bogus.git'),
    });
    const r = await runClaude({ args: ['-p', prompt(), '--x', 'y'], cwd: tmp, timeoutMs: 20000, tag: 'test' });
    expect(r).toMatchObject({ code: 0, timedOut: false, terminated: false });
    expect(r.output).toContain('FAKE_ARGS: -p --x y');
    expect(r.output).toContain(`FAKE_CWD: ${fs.realpathSync(tmp)}`);
    expect(r.output).toContain('FAKE_ENV: CLAUDECODE=<unset> CLAUDE_CODE_ENTRYPOINT=<unset> GIT_DIR=<unset>');
    expect(r.output).toContain('fake claude log line 199');
  });

  it('非 0 退出：code 与输出返回给调用方', async () => {
    setEnv({ CODING_WF_CLAUDE_BIN: FAKE_CLAUDE, FAKE_CLAUDE_MODE: 'auth' });
    const r = await runClaude({ args: ['-p', prompt()], cwd: tmp, timeoutMs: 20000, tag: 'test' });
    expect(r.code).toBe(1);
    expect(r.output).toContain('Invalid API key');
  });

  it('stdout 单独收集（stderr 不混入），output 仍是两者合并', async () => {
    setEnv({ CODING_WF_CLAUDE_BIN: FAKE_CLAUDE, FAKE_CLAUDE_MODE: 'auth' });
    const r = await runClaude({ args: ['-p', prompt()], cwd: tmp, timeoutMs: 20000, tag: 'test' });
    expect(r.output).toContain('Invalid API key');
    expect(r.stdout).not.toContain('Invalid API key');
    setEnv({ FAKE_CLAUDE_MODE: 'ok' });
    const ok = await runClaude({ args: ['-p', prompt()], cwd: tmp, timeoutMs: 20000, tag: 'test' });
    expect(ok.stdout).toContain('fake claude log line 199');
  });

  it('isolateRemote：GH 令牌剥离、GH_CONFIG_DIR 指向空临时目录（结束后删除）、GIT_TERMINAL_PROMPT=0', async () => {
    setEnv({
      CODING_WF_CLAUDE_BIN: FAKE_CLAUDE,
      FAKE_CLAUDE_MODE: 'ok',
      GH_TOKEN: 't1',
      GITHUB_TOKEN: 't2',
      GH_ENTERPRISE_TOKEN: 't3',
      GH_CONFIG_DIR: path.join(tmp, 'real-gh'),
    });
    const r = await runClaude({ args: ['-p', prompt()], cwd: tmp, timeoutMs: 20000, tag: 'test', isolateRemote: true });
    expect(r.code).toBe(0);
    expect(r.output).toContain('GH_TOKEN=<unset> GITHUB_TOKEN=<unset> GH_ENTERPRISE_TOKEN=<unset> GIT_TERMINAL_PROMPT=0');
    expect(r.output).toContain('FAKE_GH_CONFIG_EMPTY: true');
    const ghDir = /FAKE_GH_CONFIG_DIR: (.+)/.exec(r.output)[1];
    expect(ghDir).not.toBe(path.join(tmp, 'real-gh'));
    expect(fs.existsSync(ghDir)).toBe(false);
  });

  it('不开 isolateRemote（spec）时 GH 环境原样继承', async () => {
    setEnv({ CODING_WF_CLAUDE_BIN: FAKE_CLAUDE, FAKE_CLAUDE_MODE: 'ok', GH_TOKEN: 't1' });
    const r = await runClaude({ args: ['-p', prompt()], cwd: tmp, timeoutMs: 20000, tag: 'test' });
    expect(r.output).toContain('GH_TOKEN=t1');
  });

  it('可执行文件不存在：code null，不抛错', async () => {
    setEnv({ CODING_WF_CLAUDE_BIN: path.join(tmp, 'no-such-claude') });
    const r = await runClaude({ args: ['-p', 'x'], cwd: tmp, timeoutMs: 20000, tag: 'test' });
    expect(r.code).toBeNull();
    expect(r.timedOut).toBe(false);
  });

  it('卡死超时：timedOut，claude 与孙进程整组被清理', async () => {
    const files = pids();
    setEnv({ CODING_WF_CLAUDE_BIN: FAKE_CLAUDE, FAKE_CLAUDE_MODE: 'sleep', ...files });
    const started = Date.now();
    const r = await runClaude({ args: ['-p', prompt()], cwd: tmp, timeoutMs: 2500, tag: 'test' });
    expect(r.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(10000);
    await expectGone(readPid(files.FAKE_CLAUDE_PID_FILE), '假 claude');
    await expectGone(readPid(files.FAKE_CLAUDE_CHILD_PID_FILE), '孙进程');
  });

  it.each(['inherit', 'ignore'])('正常退出但留下孙进程（stdio=%s）-> 不等超时，孙进程被清理', async (stdio) => {
    const files = pids();
    setEnv({ CODING_WF_CLAUDE_BIN: FAKE_CLAUDE, FAKE_CLAUDE_MODE: 'linger', FAKE_CLAUDE_CHILD_STDIO: stdio, ...files });
    const started = Date.now();
    const r = await runClaude({ args: ['-p', prompt()], cwd: tmp, timeoutMs: 60000, tag: 'test' });
    expect(r.code).toBe(0);
    expect(Date.now() - started).toBeLessThan(10000);
    await expectGone(readPid(files.FAKE_CLAUDE_CHILD_PID_FILE), '孙进程');
  });
});

describe('snapshotChanges / outOfScopeChanges', () => {
  let worktree;
  beforeEach(() => {
    worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-scope-'));
    gitPlain('init', '-q', worktree);
  });
  afterEach(() => {
    fs.rmSync(worktree, { recursive: true, force: true });
  });

  it('只报运行后新增且在 sprint 目录之外的改动；运行前已脏的不算', async () => {
    fs.writeFileSync(path.join(worktree, 'pre.txt'), 'dirty\n');
    const before = await snapshotChanges(worktree);
    fs.mkdirSync(path.join(worktree, 'sprints/s1'), { recursive: true });
    fs.writeFileSync(path.join(worktree, 'sprints/s1/a.md'), 'in scope\n');
    fs.mkdirSync(path.join(worktree, 'sprints/s10'), { recursive: true });
    fs.writeFileSync(path.join(worktree, 'sprints/s10/b.md'), 'sibling dir\n');
    fs.writeFileSync(path.join(worktree, 'stray.txt'), 'out\n');
    const stray = await outOfScopeChanges(worktree, 'sprints/s1/', before);
    expect(stray.sort()).toEqual(['sprints/s10/b.md', 'stray.txt']);
  });

  it('不是 git 仓库 -> snapshot 为 null，越界检查返回 []', async () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-plain-'));
    try {
      const before = await snapshotChanges(plain);
      expect(before).toBeNull();
      fs.writeFileSync(path.join(plain, 'x.txt'), 'x\n');
      expect(await outOfScopeChanges(plain, 'sprints/s1', before)).toEqual([]);
    } finally {
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });
});
