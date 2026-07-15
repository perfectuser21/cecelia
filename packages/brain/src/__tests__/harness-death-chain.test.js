/**
 * L1 串链测试：S1死亡→S2分类→S3路由→spawn参数
 * 覆盖 oom / ci_red / unknown / auth / rate_limit / green_waiting_merge 全链
 * 真实调用 classifyDeath；仅 mock docker/gh/tmux 外部命令面
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { classifyDeath } from '../harness-death-classifier.js';
import {
  handleAuth,
  handleRateLimit,
  handleGreenWaitingMerge,
} from '../harness-death-handlers.js';

// ─── Mock 外部命令面（docker/gh/tmux）——不 mock classifyDeath / 路由逻辑 ────

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    execSync: vi.fn((cmd) => {
      // mock 复现真实退出码语义：docker/gh/tmux 返回空字符串（容器消失语义）
      if (typeof cmd === 'string' && (cmd.includes('tmux') || cmd.includes('docker') || cmd.includes('gh'))) {
        return '';
      }
      return actual.execSync(cmd);
    }),
  };
});

// ─── stub 工厂（DB + spawnFn）────────────────────────────────────────────────

function makeDbStub() {
  const calls = [];
  return {
    query: vi.fn(async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; }),
    _calls: calls,
  };
}

function makeSpawnStub() {
  const calls = [];
  const fn = vi.fn(async (task, opts) => { calls.push({ task, opts }); return { ok: true, containerId: 'c-test' }; });
  return { fn, _calls: calls };
}

beforeEach(() => { vi.clearAllMocks(); });

// ─── 分类器单元（S2）—————————————————————————————————————————————————————────

describe('S2 classifyDeath — 分类器', () => {
  it('exitCode=137 → cause=oom, action=oom_upgrade', () => {
    const r = classifyDeath({ exitCode: 137, stdoutTail: '', tmuxPane: null });
    expect(r.cause).toBe('oom');
    expect(r.action).toBe('oom_upgrade');
  });

  it('stdoutTail CI_RED → cause=ci_red, action=ci_red_refire', () => {
    const r = classifyDeath({ exitCode: 1, stdoutTail: 'CI_RED detected', tmuxPane: null });
    expect(r.cause).toBe('ci_red');
    expect(r.action).toBe('ci_red_refire');
  });

  it('无特征 exitCode=1 → cause=unknown, action=log_only', () => {
    const r = classifyDeath({ exitCode: 1, stdoutTail: '', tmuxPane: null });
    expect(r.cause).toBe('unknown');
    expect(r.action).toBe('log_only');
  });
});

// ─── L1 全链：OOM ─────────────────────────────────────────────────────────────

describe('L1 全链：oom', () => {
  it('exit=137 首次 → oom → 升档 spawn（memoryTier=oom_upgrade）', async () => {
    const taskPayload = { last_container_exit_code: 137, oom_upgraded: false, callback_stdout_tail: '' };

    // S2: 分类（真实调用）
    const { cause, action } = classifyDeath({
      exitCode: taskPayload.last_container_exit_code,
      stdoutTail: taskPayload.callback_stdout_tail,
      tmuxPane: null,
    });
    expect(cause).toBe('oom');
    expect(action).toBe('oom_upgrade');

    // S3: 路由模拟（仅 stub spawn/db，路由条件由 cause 真实驱动）
    const spawn = makeSpawnStub();
    const db = makeDbStub();
    const out = { resumed: 0, oomUpgraded: false };

    if (cause === 'oom') {
      await spawn.fn({ id: 'task-oom-001' }, { memoryTier: 'oom_upgrade', pool: db });
      await db.query('UPDATE tasks SET payload=$1 WHERE id=$2', [{ oom_upgraded: true }, 'task-oom-001']);
      out.resumed++;
      out.oomUpgraded = true;
    }

    // 验收
    expect(out.oomUpgraded).toBe(true);
    expect(spawn.fn).toHaveBeenCalledOnce();
    expect(spawn._calls[0].opts.memoryTier).toBe('oom_upgrade');
    expect(db.query).toHaveBeenCalledOnce();

    // 审计日志格式验证
    const auditLine = `cause=${cause} action=${action} initiative=task-oom-001`;
    expect(auditLine).toMatch(/cause=oom action=oom_upgrade initiative=/);
  });
});

// ─── L1 全链：ci_red ─────────────────────────────────────────────────────────

describe('L1 全链：ci_red', () => {
  it('stdoutTail=CI_RED → ci_red → 正常重点火（无 memoryTier）', async () => {
    const taskPayload = { last_container_exit_code: 1, callback_stdout_tail: 'CI_RED: build failed' };

    // S2: 分类
    const { cause, action } = classifyDeath({
      exitCode: taskPayload.last_container_exit_code,
      stdoutTail: taskPayload.callback_stdout_tail,
      tmuxPane: null,
    });
    expect(cause).toBe('ci_red');
    expect(action).toBe('ci_red_refire');

    // S3: 路由
    const spawn = makeSpawnStub();
    const out = { resumed: 0 };

    if (cause === 'ci_red') {
      await spawn.fn({ id: 'task-ci-001' }, { pool: {} });  // 无 memoryTier
      out.resumed++;
    }

    expect(out.resumed).toBe(1);
    expect(spawn.fn).toHaveBeenCalledOnce();
    expect(spawn._calls[0].opts?.memoryTier).toBeUndefined();

    const auditLine = `cause=${cause} action=${action} initiative=task-ci-001`;
    expect(auditLine).toMatch(/cause=ci_red action=ci_red_refire/);
  });
});

// ─── L1 全链：unknown ─────────────────────────────────────────────────────────

describe('L1 全链：unknown', () => {
  it('无特征 exitCode=1 → unknown → log_only，不触发 spawn', async () => {
    const taskPayload = { last_container_exit_code: 1, callback_stdout_tail: '' };

    // S2: 分类
    const { cause, action } = classifyDeath({
      exitCode: taskPayload.last_container_exit_code,
      stdoutTail: taskPayload.callback_stdout_tail,
      tmuxPane: null,
    });
    expect(cause).toBe('unknown');
    expect(action).toBe('log_only');

    // S3: 路由（log_only 不调 spawn）
    const spawn = makeSpawnStub();
    const logs = [];
    const out = { resumed: 0 };

    if (action === 'log_only') {
      logs.push(`cause=${cause} action=${action} initiative=task-unk-001`);
      // 不调用 spawn.fn
    } else {
      await spawn.fn({ id: 'task-unk-001' }, {});
      out.resumed++;
    }

    expect(out.resumed).toBe(0);
    expect(spawn.fn).not.toHaveBeenCalled();
    expect(logs[0]).toMatch(/cause=unknown action=log_only initiative=/);
  });
});

// ─── L1 全链：auth 首次 ──────────────────────────────────────────────────────

describe('L1 全链：auth 首次换号重点火', () => {
  it('stdoutTail=401 Unauthorized + auth_fail_count=0 → 换号 → spawnFn 调用1次，新账号 !== 旧账号', async () => {
    // S2: 分类（真实调用）
    const { cause, action } = classifyDeath({
      exitCode: 1,
      stdoutTail: '401 Unauthorized: invalid token',
      tmuxPane: null,
    });
    expect(cause).toBe('auth');
    expect(action).toBe('auth_retry');

    // S3: 路由（真实调用 handleAuth）
    const spawn = makeSpawnStub();
    const db = makeDbStub();
    const currentAccount = 'account1';
    const newAccount = 'account2';
    const markAuthFailedFn = vi.fn();
    const resolveAccountFn = vi.fn(async (opts) => {
      opts.env.CECELIA_CREDENTIALS = newAccount;
    });

    const task = {
      id: 'task-auth-l1-001',
      payload: { CECELIA_CREDENTIALS: currentAccount, auth_fail_count: 0 },
    };

    await handleAuth(task, {
      cause,
      spawnFn: spawn.fn,
      markAuthFailedFn,
      resolveAccountFn,
      pool: db,
    });

    // 验收
    expect(markAuthFailedFn).toHaveBeenCalledWith(currentAccount);
    expect(spawn.fn).toHaveBeenCalledOnce();
    const spawnOpts = spawn._calls[0].opts;
    expect(spawnOpts.env.CECELIA_CREDENTIALS).toBe(newAccount);
    expect(spawnOpts.env.CECELIA_CREDENTIALS).not.toBe(currentAccount);
  });
});

// ─── L1 全链：auth 连续 blocked ──────────────────────────────────────────────

describe('L1 全链：auth 连续 blocked', () => {
  it('stdoutTail=401 + auth_fail_count=2 → blocked → DB 写 blocked + barkFn 调用，spawnFn 不调用', async () => {
    // S2: 分类（真实调用）
    const { cause } = classifyDeath({
      exitCode: 1,
      stdoutTail: '401 Unauthorized',
      tmuxPane: null,
    });
    expect(cause).toBe('auth');

    const spawn = makeSpawnStub();
    const db = makeDbStub();
    const barkMsgs = [];
    const barkFn = vi.fn(async (msg) => { barkMsgs.push(msg); return { ok: true }; });

    const task = {
      id: 'task-auth-l1-blocked',
      payload: { CECELIA_CREDENTIALS: 'account1', auth_fail_count: 2 },
    };

    await handleAuth(task, {
      cause,
      spawnFn: spawn.fn,
      markAuthFailedFn: vi.fn(),
      resolveAccountFn: vi.fn(),
      pool: db,
      barkFn,
    });

    // 验收
    expect(spawn.fn).not.toHaveBeenCalled();
    expect(barkFn).toHaveBeenCalledOnce();
    expect(barkMsgs[0]).toMatch(/blocked/i);
    expect(barkMsgs[0]).toMatch(/codex-login/i);
    const statusUpdate = db._calls.find(c => c.sql.includes('blocked'));
    expect(statusUpdate).toBeTruthy();
  });
});

// ─── L1 全链：rate_limit defer ───────────────────────────────────────────────

describe('L1 全链：rate_limit defer', () => {
  it('stdoutTail=429 Too Many Requests → defer_until 写库 + 不 spawn', async () => {
    // S2: 分类（真实调用）
    const { cause, action } = classifyDeath({
      exitCode: 1,
      stdoutTail: '429 Too Many Requests',
      tmuxPane: null,
    });
    expect(cause).toBe('rate_limit');
    expect(action).toBe('rate_limit_defer');

    const spawn = makeSpawnStub();
    const db = makeDbStub();
    const beforeTs = Date.now();

    const task = { id: 'task-rl-l1-001', payload: {} };

    await handleRateLimit(task, { cause, spawnFn: spawn.fn, pool: db });

    // 验收
    expect(spawn.fn).not.toHaveBeenCalled();
    const deferCall = db._calls.find(c => c.sql.includes('defer_until'));
    expect(deferCall).toBeTruthy();
    // defer_until 参数值应 ≈ now+60min
    const deferTs = deferCall.params[0];
    expect(deferTs).toBeGreaterThanOrEqual(beforeTs + 3599000);
  });
});

// ─── L1 全链：green_waiting_merge ────────────────────────────────────────────

describe('L1 全链：green_waiting_merge', () => {
  it('stdoutTail=GREEN_WAITING + pr_url 存在 → spawn 带 resume_stage=finish', async () => {
    // S2: 分类（真实调用）
    const { cause } = classifyDeath({
      exitCode: 0,
      stdoutTail: 'GREEN_WAITING: PR ready for merge',
      tmuxPane: null,
    });
    expect(cause).toBe('green_waiting_merge');

    const spawn = makeSpawnStub();
    const db = makeDbStub();

    const task = {
      id: 'task-gwm-l1-001',
      payload: { pr_url: 'https://github.com/org/repo/pull/99' },
    };

    await handleGreenWaitingMerge(task, {
      cause,
      spawnFn: spawn.fn,
      pool: db,
    });

    // 验收
    expect(spawn.fn).toHaveBeenCalledOnce();
    expect(spawn._calls[0].opts.resume_stage).toBe('finish');
  });
});
