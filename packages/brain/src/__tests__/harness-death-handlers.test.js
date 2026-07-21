/**
 * harness-death-handlers.test.js — A8-2 处置器单元测试
 *
 * 覆盖五个导出函数的核心分支逻辑（deps 注入，无真实 DB/Docker）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleAuth,
  handleRateLimit,
  handleGreenWaitingMerge,
  handleInteractiveStuck,
  shouldSkipDeferredTask,
} from '../harness-death-handlers.js';

beforeEach(() => vi.clearAllMocks());

// ─── Stub 工厂 ────────────────────────────────────────────────────────────────

function makeDbStub() {
  return {
    query: vi.fn(async () => ({ rows: [] })),
  };
}

function makeSpawnStub() {
  return vi.fn(async () => ({ containerId: 'c-test' }));
}

// ─── handleAuth ───────────────────────────────────────────────────────────────

describe('handleAuth', () => {
  it('auth_fail_count < 2 → 换号重点火，spawnFn 调用1次，newAccount 正确传入', async () => {
    const currentAccount = 'account1';
    const newAccount = 'account2';
    const spawnFn = makeSpawnStub();
    const markAuthFailedFn = vi.fn();
    const resolveAccountFn = vi.fn(async (opts) => {
      opts.env.CECELIA_CREDENTIALS = newAccount;
    });

    const task = {
      id: 'task-001',
      payload: { CECELIA_CREDENTIALS: currentAccount, auth_fail_count: 0 },
    };

    const result = await handleAuth(task, {
      cause: 'auth',
      spawnFn,
      markAuthFailedFn,
      resolveAccountFn,
      pool: makeDbStub(),
    });

    expect(markAuthFailedFn).toHaveBeenCalledWith(currentAccount);
    expect(spawnFn).toHaveBeenCalledOnce();
    const spawnOpts = spawnFn.mock.calls[0][1];
    expect(spawnOpts.env.CECELIA_CREDENTIALS).toBe(newAccount);
    expect(result.action).toBe('spawned');
  });

  it('auth_fail_count >= 2 → blocked + Bark，spawnFn 未调用', async () => {
    const spawnFn = makeSpawnStub();
    const barkFn = vi.fn(async () => {});
    const db = makeDbStub();

    const task = {
      id: 'task-blocked-001',
      payload: { CECELIA_CREDENTIALS: 'account1', auth_fail_count: 2 },
    };

    const result = await handleAuth(task, {
      cause: 'auth',
      spawnFn,
      barkFn,
      markAuthFailedFn: vi.fn(),
      resolveAccountFn: vi.fn(),
      pool: db,
    });

    expect(spawnFn).not.toHaveBeenCalled();
    expect(barkFn).toHaveBeenCalledOnce();
    const barkMsg = barkFn.mock.calls[0][0];
    expect(barkMsg).toMatch(/blocked/i);
    expect(result.action).toBe('blocked');
  });

  it('auth_fail_count = 1 → 仍换号（< 2），resolveAccountFn 被调用', async () => {
    const spawnFn = makeSpawnStub();
    const resolveAccountFn = vi.fn(async (opts) => {
      opts.env.CECELIA_CREDENTIALS = 'account3';
    });

    const task = {
      id: 'task-002',
      payload: { CECELIA_CREDENTIALS: 'account2', auth_fail_count: 1 },
    };

    const result = await handleAuth(task, {
      cause: 'auth',
      spawnFn,
      markAuthFailedFn: vi.fn(),
      resolveAccountFn,
      pool: makeDbStub(),
    });

    expect(resolveAccountFn).toHaveBeenCalledOnce();
    expect(spawnFn).toHaveBeenCalledOnce();
    expect(result.action).toBe('spawned');
  });
});

// ─── handleRateLimit ──────────────────────────────────────────────────────────

describe('handleRateLimit', () => {
  it('grok skill-relay rate_limit → 续接到 claude，并写 continuation 留痕', async () => {
    const spawnFn = makeSpawnStub();
    const db = makeDbStub();

    const task = {
      id: 'task-rl-grok-001',
      task_type: 'harness_initiative',
      payload: { orchestrator: 'skill-relay', executor: 'grok' },
    };

    const result = await handleRateLimit(task, {
      cause: 'rate_limit',
      spawnFn,
      pool: db,
      now: () => new Date('2026-07-21T12:00:00.000Z'),
    });

    expect(spawnFn).toHaveBeenCalledOnce();
    expect(spawnFn.mock.calls[0][0].payload.executor).toBe('claude');
    expect(spawnFn.mock.calls[0][1]).toMatchObject({
      continuation: {
        level: 'L3_cross_vendor_fallback',
        reason: 'grok_rate_limit_runtime_continuation',
      },
    });
    const sqlCall = db.query.mock.calls.find(([sql]) => /UPDATE tasks SET payload/.test(sql));
    expect(sqlCall).toBeTruthy();
    expect(sqlCall[1][0]).toContain('"executor":"claude"');
    expect(sqlCall[1][0]).toContain('"continuation_level":"L3_cross_vendor_fallback"');
    expect(sqlCall[1][0]).toContain('"reason":"grok_rate_limit_runtime_continuation"');
    expect(result).toMatchObject({
      action: 'continued',
      executor: 'claude',
      continuation_level: 'L3_cross_vendor_fallback',
      reason: 'grok_rate_limit_runtime_continuation',
    });
  });

  it('非 grok 任务仍写 defer_until 到 DB，不调 spawnFn', async () => {
    const spawnFn = makeSpawnStub();
    const db = makeDbStub();
    const beforeTs = Date.now();

    const task = { id: 'task-rl-001', payload: { orchestrator: 'skill-relay', executor: 'claude' } };

    const result = await handleRateLimit(task, {
      cause: 'rate_limit',
      spawnFn,
      pool: db,
    });

    expect(spawnFn).not.toHaveBeenCalled();
    expect(db.query).toHaveBeenCalled();
    const sqlCall = db.query.mock.calls.find(([sql]) => sql.includes('defer_until'));
    expect(sqlCall).toBeTruthy();
    expect(result.action).toBe('deferred');
    expect(result.defer_until).toBeGreaterThanOrEqual(beforeTs + 3599000);
  });

  it('payload.retry_after_ts 存在时直接使用该值作为 defer_until', async () => {
    const spawnFn = makeSpawnStub();
    const db = makeDbStub();
    const customTs = Date.now() + 2 * 60 * 60 * 1000; // 2小时

    const task = { id: 'task-rl-002', payload: { retry_after_ts: customTs } };

    const result = await handleRateLimit(task, {
      cause: 'rate_limit',
      spawnFn,
      pool: db,
    });

    expect(result.defer_until).toBe(customTs);
    expect(spawnFn).not.toHaveBeenCalled();
  });
});

// ─── shouldSkipDeferredTask ───────────────────────────────────────────────────

describe('shouldSkipDeferredTask', () => {
  it('defer_until 未到期 → true（应跳过）', () => {
    const task = { payload: { defer_until: Date.now() + 30 * 60 * 1000 } };
    expect(shouldSkipDeferredTask(task)).toBe(true);
  });

  it('defer_until 已到期 → false（不跳过）', () => {
    const task = { payload: { defer_until: Date.now() - 1000 } };
    expect(shouldSkipDeferredTask(task)).toBe(false);
  });

  it('无 defer_until → false（不跳过）', () => {
    const task = { payload: {} };
    expect(shouldSkipDeferredTask(task)).toBe(false);
  });

  it('payload 为 null/undefined → false', () => {
    const task = { payload: null };
    expect(shouldSkipDeferredTask(task)).toBe(false);
  });
});

// ─── handleGreenWaitingMerge ──────────────────────────────────────────────────

describe('handleGreenWaitingMerge', () => {
  it('pr_url 为空 → action=skipped，spawnFn 未调用', async () => {
    const spawnFn = makeSpawnStub();
    const task = { id: 'task-gwm-nurl', payload: {} };

    const result = await handleGreenWaitingMerge(task, {
      cause: 'green_waiting_merge',
      spawnFn,
      pool: makeDbStub(),
    });

    expect(spawnFn).not.toHaveBeenCalled();
    expect(result.action).toBe('skipped');
    expect(result.reason).toBe('no_pr_url');
  });

  it('有 pr_url → 调 spawnFn 含 resume_stage=finish', async () => {
    const spawnFn = makeSpawnStub();
    const task = {
      id: 'task-gwm-001',
      payload: { pr_url: 'https://github.com/org/repo/pull/42' },
    };

    const result = await handleGreenWaitingMerge(task, {
      cause: 'green_waiting_merge',
      spawnFn,
      pool: makeDbStub(),
    });

    expect(spawnFn).toHaveBeenCalledOnce();
    const spawnOpts = spawnFn.mock.calls[0][1];
    expect(spawnOpts.resume_stage).toBe('finish');
    expect(result.action).toBe('spawned_finish');
  });
});

// ─── handleInteractiveStuck ───────────────────────────────────────────────────

describe('handleInteractiveStuck', () => {
  it('kill tmux session + 重点火（execFn 含 kill-session，spawnFn 调用1次）', async () => {
    const spawnFn = makeSpawnStub();
    const execFn = vi.fn(() => '');

    const task = {
      id: 'task-stuck-001',
      payload: { tmux_session: 'cecelia-task-stuck-001' },
    };

    const result = await handleInteractiveStuck(task, {
      cause: 'interactive_stuck',
      spawnFn,
      execFn,
      pool: makeDbStub(),
    });

    const killCall = execFn.mock.calls.find(([cmd]) => cmd.includes('kill-session'));
    expect(killCall).toBeTruthy();
    expect(spawnFn).toHaveBeenCalledOnce();
    expect(result.action).toBe('refired');
  });

  it('tmux_session 为 null → 跳过 kill，仍重点火', async () => {
    const spawnFn = makeSpawnStub();
    const execFn = vi.fn(() => '');

    const task = {
      id: 'task-stuck-002',
      payload: {},
    };

    const result = await handleInteractiveStuck(task, {
      cause: 'interactive_stuck',
      spawnFn,
      execFn,
      pool: makeDbStub(),
    });

    expect(execFn).not.toHaveBeenCalled();
    expect(spawnFn).toHaveBeenCalledOnce();
    expect(result.action).toBe('refired');
  });
});
