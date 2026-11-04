/**
 * 分类器与真实 Auth/RateLimit/Green 处置器的窄接口测试
 * 保留 oom / ci_red / unknown 分类与 auth / rate_limit / green_waiting_merge 真实处置器
 * 真实调用 classifyDeath；外部副作用只由显式依赖注入承接，不代表真实新relay可启动
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { classifyDeath } from '../harness-death-classifier.js';
import {
  handleAuth,
  handleRateLimit,
  handleGreenWaitingMerge,
} from '../harness-death-handlers.js';

// ─── Mock 外部命令面（docker/gh/tmux）——不 mock classifyDeath / 路由逻辑 ────

const escapedProcess = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', async original => ({
  ...await original(),
  execSync: (...args) => { escapedProcess(...args); throw Error('处置器测试禁止宿主进程'); },
}));
afterEach(() => { expect(escapedProcess).not.toHaveBeenCalled(); });

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

// OOM/CI/unknown 的真实路由由 consumer 负责；此文件不再用本地 if + 自调 spy 冒充全链。
// 首次 OOM 的真实 watchdog 封套保护见 oom-aware-retry.test.js。

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
