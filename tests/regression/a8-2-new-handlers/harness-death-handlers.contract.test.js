/**
 * 合同测试骨架 — A8-2 新处置器
 * 当前真实处置器合同；DB仅记录委托参数，不宣称持久化。
 *
 * 规则：
 * - 真实调用 classifyDeath（INV-01/INV-07）
 * - 只 mock docker/gh/tmux/Bark 最外层
 * - 不 mock 处置器路由条件、spawn 参数构造
 *
 * BEHAVIOR 编号与 contract-dod.md 对应：
 *   BEHAVIOR-1  auth 首次换号重点火
 *   BEHAVIOR-2  auth 连续 blocked
 *   BEHAVIOR-3  rate_limit defer 写库
 *   BEHAVIOR-4  rate_limit defer纯helper的未来/过期判断
 *   BEHAVIOR-5  green_waiting_merge 收尾棒
 *   BEHAVIOR-6  interactive_stuck kill+重点火
 *   BEHAVIOR-7  S0 startup-sync 批量恢复
 *   BEHAVIOR-8  孤儿复活：infra 死因的 failed 任务回队列（TOP2 刀1，task f4f28298）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { classifyDeath } from '../../../packages/brain/src/harness-death-classifier.js';

// ─── Mock 外部命令面（docker/gh/tmux）— 不 mock classifyDeath / 路由逻辑 ───

const escaped = vi.hoisted(() => ({ process: vi.fn(), network: vi.fn(), db: vi.fn() }));
vi.mock('node:child_process', () => ({
  execSync: (...args) => { escaped.process(...args); throw Error('禁止宿主命令'); },
  execFile: (...args) => { escaped.process(...args); throw Error('禁止宿主命令'); },
  spawn: (...args) => { escaped.process(...args); throw Error('禁止真实spawn'); },
}));
vi.mock('../../../packages/brain/src/db.js', () => ({ default: { query: (...args) => { escaped.db(...args); throw Error('禁止共享DB'); } } }));
vi.mock('../../../packages/brain/src/notifier.js', () => ({ sendBark: (...args) => { escaped.network(...args); throw Error('禁止真实通知'); } }));
afterEach(() => {
  expect(escaped.process).not.toHaveBeenCalled();
  expect(escaped.network).not.toHaveBeenCalled();
  expect(escaped.db).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

// ─── Stub 工厂 ────────────────────────────────────────────────────────────────

function makeDbStub() {
  const calls = [];
  return {
    query: vi.fn(async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [] };
    }),
    _calls: calls,
  };
}

function makeSpawnStub() {
  const calls = [];
  const fn = vi.fn(async (task, opts) => {
    calls.push({ task, opts });
    return { ok: true, containerId: 'c-test' };
  });
  return { fn, _calls: calls };
}

function makeBarkStub() {
  const calls = [];
  const fn = vi.fn(async (msg) => {
    calls.push({ msg });
    return { ok: true };
  });
  return { fn, _calls: calls };
}

function makeExecStub() {
  const calls = [];
  const fn = vi.fn((cmd) => {
    calls.push({ cmd });
    return '';
  });
  return { fn, _calls: calls };
}

beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', (...args) => { escaped.network(...args); throw Error('禁止外联'); }); });

// ─── BEHAVIOR-1: auth 首次换号重点火 ─────────────────────────────────────────

describe('[BEHAVIOR-1] auth 首次换号重点火', () => {
  it('cause=auth + auth_fail_count<2 → 换号 → spawnFn 调用1次，新账号 !== 旧账号', async () => {
    // S2: 真实分类
    const { cause, action } = classifyDeath({
      exitCode: 1,
      stdoutTail: '401 Unauthorized: invalid token',
      tmuxPane: null,
    });
    expect(cause).toBe('auth');
    expect(action).toBe('auth_retry');

    // S3: 路由（stub deps 注入）
    const currentAccount = 'account1';
    const newAccount = 'account2';
    const spawn = makeSpawnStub();
    const markAuthFailedFn = vi.fn();
    const resolveAccountFn = vi.fn(async (opts) => {
      opts.env.CECELIA_CREDENTIALS = newAccount;
    });

    const task = {
      id: 'task-auth-001',
      payload: {
        CECELIA_CREDENTIALS: currentAccount,
        auth_fail_count: 0,
      },
    };

    // 待实现：handleAuth(task, { cause, spawnFn: spawn.fn, markAuthFailedFn, resolveAccountFn, pool: makeDbStub() })
    // 目前 Red 占位：直接模拟预期行为以验证断言结构正确
    // TODO: 替换为真实处置器调用
    const { handleAuth } = await import(
      '../../../packages/brain/src/harness-death-handlers.js'
    ).catch(() => ({ handleAuth: null }));

    if (!handleAuth) {
      // Red 占位：处置器未实现，测试预期失败
      expect(false, 'handleAuth 未实现 — 请实现 packages/brain/src/harness-death-handlers.js').toBe(true);
      return;
    }

    await handleAuth(task, {
      cause,
      spawnFn: spawn.fn,
      markAuthFailedFn,
      resolveAccountFn,
      pool: makeDbStub(),
    });

    // 验收
    expect(markAuthFailedFn).toHaveBeenCalledWith(currentAccount);
    expect(spawn.fn).toHaveBeenCalledOnce();
    const spawnOpts = spawn._calls[0].opts;
    expect(spawnOpts.env.CECELIA_CREDENTIALS).toBe(newAccount);
    expect(spawnOpts.env.CECELIA_CREDENTIALS).not.toBe(currentAccount);
  });
});

// ─── BEHAVIOR-2: auth 连续 blocked ────────────────────────────────────────────

describe('[BEHAVIOR-2] auth 连续 blocked', () => {
  it('cause=auth + auth_fail_count≥2 → blocked + Bark，spawnFn 未调用', async () => {
    const { cause } = classifyDeath({
      exitCode: 1,
      stdoutTail: '401 Unauthorized',
      tmuxPane: null,
    });
    expect(cause).toBe('auth');

    const spawn = makeSpawnStub();
    const bark = makeBarkStub();
    const db = makeDbStub();

    const task = {
      id: 'task-auth-blocked-001',
      payload: {
        CECELIA_CREDENTIALS: 'account1',
        auth_fail_count: 2,
      },
    };

    const { handleAuth } = await import(
      '../../../packages/brain/src/harness-death-handlers.js'
    ).catch(() => ({ handleAuth: null }));

    if (!handleAuth) {
      expect(false, 'handleAuth 未实现').toBe(true);
      return;
    }

    await handleAuth(task, {
      cause,
      spawnFn: spawn.fn,
      barkFn: bark.fn,
      markAuthFailedFn: vi.fn(),
      resolveAccountFn: vi.fn(),
      pool: db,
    });

    // 验收
    expect(spawn.fn).not.toHaveBeenCalled();
    expect(bark.fn).toHaveBeenCalledOnce();
    const barkMsg = bark._calls[0].msg;
    expect(barkMsg).toMatch(/blocked/i);
    expect(barkMsg).toMatch(/codex-login/i);

    // DB 写 status='blocked'
    const statusUpdate = db._calls.find(c => c.sql.includes('blocked'));
    expect(statusUpdate).toBeTruthy();
  });
});

// ─── BEHAVIOR-3: rate_limit defer 写库 ───────────────────────────────────────

describe('[BEHAVIOR-3] rate_limit defer 写库', () => {
  it('cause=rate_limit + retry_after_ts 为空 → 不调 spawn → defer_until 写库 ≈ now+60min', async () => {
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

    const task = {
      id: 'task-rl-001',
      payload: {},
    };

    const { handleRateLimit } = await import(
      '../../../packages/brain/src/harness-death-handlers.js'
    ).catch(() => ({ handleRateLimit: null }));

    if (!handleRateLimit) {
      expect(false, 'handleRateLimit 未实现').toBe(true);
      return;
    }

    await handleRateLimit(task, { cause, spawnFn: spawn.fn, pool: db });

    // 验收
    expect(spawn.fn).not.toHaveBeenCalled();

    const deferCall = db._calls.find(c => c.sql.includes('defer_until'));
    expect(deferCall).toBeTruthy();

    // 断言真实handler交给DB的参数必达且为毫秒数；mock不执行SQL。
    expect(deferCall.params).toEqual([expect.any(Number), task.id]);
    const deferUntilTs = deferCall.params[0];
    expect(Number.isFinite(deferUntilTs)).toBe(true);
    expect(deferUntilTs).toBeGreaterThanOrEqual(beforeTs + 3599000);
    expect(deferUntilTs).toBeLessThanOrEqual(Date.now() + 3600000);

  });
});

// ─── BEHAVIOR-4: rate_limit defer 跳过 ───────────────────────────────────────

describe('[BEHAVIOR-4] defer判断纯helper（不宣称watchdog消费）', () => {
  it.each([
    ['未到期', 30 * 60 * 1000, true], ['已过期', -1000, false], ['无时间戳', null, false],
  ])('%s返回%s', async (_label, delta, expected) => {
    const { shouldSkipDeferredTask } = await import('../../../packages/brain/src/harness-death-handlers.js');
    const task = { payload: delta == null ? {} : { defer_until: Date.now() + delta } };
    expect(shouldSkipDeferredTask(task)).toBe(expected);
  });
});

// ─── BEHAVIOR-5: green_waiting_merge 收尾棒 ──────────────────────────────────

describe('[BEHAVIOR-5] green_waiting_merge 收尾棒', () => {
  it('cause=green_waiting_merge + PR OPEN + CI pass → spawn 带 resume_stage=finish', async () => {
    const { cause } = classifyDeath({
      exitCode: 0,
      stdoutTail: 'GREEN_WAITING: PR ready for merge',
      tmuxPane: null,
    });
    expect(cause).toBe('green_waiting_merge');

    const spawn = makeSpawnStub();
    const db = makeDbStub();
    const checkPrStatusFn = vi.fn(async () => ({ state: 'OPEN', ciStatus: 'pass' }));

    const task = {
      id: 'task-gwm-001',
      payload: {
        pr_url: 'https://github.com/org/repo/pull/42',
      },
    };

    const { handleGreenWaitingMerge } = await import(
      '../../../packages/brain/src/harness-death-handlers.js'
    ).catch(() => ({ handleGreenWaitingMerge: null }));

    if (!handleGreenWaitingMerge) {
      expect(false, 'handleGreenWaitingMerge 未实现').toBe(true);
      return;
    }

    await handleGreenWaitingMerge(task, {
      cause,
      spawnFn: spawn.fn,
      checkPrStatusFn,
      pool: db,
    });

    // 验收
    expect(spawn.fn).toHaveBeenCalledOnce();
    const spawnOpts = spawn._calls[0].opts;
    expect(spawnOpts.resume_stage).toBe('finish');
  });

  it('[BEHAVIOR-5b] pr_url 为空 → log_only，spawnFn 不调用', async () => {
    const { cause } = classifyDeath({
      exitCode: 0,
      stdoutTail: 'GREEN_WAITING',
      tmuxPane: null,
    });
    expect(cause).toBe('green_waiting_merge');

    const spawn = makeSpawnStub();
    const task = {
      id: 'task-gwm-nurl-001',
      payload: {}, // pr_url 缺失
    };

    const { handleGreenWaitingMerge } = await import(
      '../../../packages/brain/src/harness-death-handlers.js'
    ).catch(() => ({ handleGreenWaitingMerge: null }));

    if (!handleGreenWaitingMerge) {
      expect(false, 'handleGreenWaitingMerge 未实现').toBe(true);
      return;
    }

    await handleGreenWaitingMerge(task, {
      cause,
      spawnFn: spawn.fn,
      checkPrStatusFn: vi.fn(),
      pool: makeDbStub(),
    });

    expect(spawn.fn).not.toHaveBeenCalled();
  });
});

// ─── BEHAVIOR-6: interactive_stuck kill+重点火 ────────────────────────────────

describe('[BEHAVIOR-6] interactive_stuck kill+重点火', () => {
  it('cause=interactive_stuck → execFn 含 kill-session → spawnFn 调用1次', async () => {
    const { cause } = classifyDeath({
      exitCode: 1,
      stdoutTail: '',
      tmuxPane: 'Do you want to continue? Press Enter to confirm',
    });
    expect(cause).toBe('interactive_stuck');

    const spawn = makeSpawnStub();
    const exec = makeExecStub();
    const db = makeDbStub();

    const task = {
      id: 'task-stuck-001',
      payload: {
        tmux_session: 'cecelia-task-stuck-001',
      },
    };

    const { handleInteractiveStuck } = await import(
      '../../../packages/brain/src/harness-death-handlers.js'
    ).catch(() => ({ handleInteractiveStuck: null }));

    if (!handleInteractiveStuck) {
      expect(false, 'handleInteractiveStuck 未实现').toBe(true);
      return;
    }

    await handleInteractiveStuck(task, {
      cause,
      spawnFn: spawn.fn,
      execFn: exec.fn,
      pool: db,
    });

    // 验收
    const killCall = exec._calls.find(c => c.cmd.includes('kill-session'));
    expect(killCall).toBeTruthy();
    expect(spawn.fn).toHaveBeenCalledOnce();
  });
});

