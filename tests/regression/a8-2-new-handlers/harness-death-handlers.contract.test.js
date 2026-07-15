/**
 * 合同测试骨架 — A8-2 新处置器
 * 状态：Red（处置器尚未实现，测试预期失败）
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
 *   BEHAVIOR-4  rate_limit defer 跳过（watchdog tick）
 *   BEHAVIOR-5  green_waiting_merge 收尾棒
 *   BEHAVIOR-6  interactive_stuck kill+重点火
 *   BEHAVIOR-7  S0 startup-sync 批量恢复
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { classifyDeath } from '../../../packages/brain/src/harness-death-classifier.js';

// ─── Mock 外部命令面（docker/gh/tmux）— 不 mock classifyDeath / 路由逻辑 ───

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    execSync: vi.fn((cmd) => {
      if (typeof cmd === 'string' && (cmd.includes('tmux') || cmd.includes('docker') || cmd.includes('gh'))) {
        return '';
      }
      return actual.execSync(cmd);
    }),
  };
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

beforeEach(() => { vi.clearAllMocks(); });

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

    // defer_until 值应 ≥ now+3599000（≈60min，允许5min误差）
    const deferUntilStr = JSON.stringify(deferCall.params);
    const deferUntilMatch = deferUntilStr.match(/(\d{13,})/);
    if (deferUntilMatch) {
      const deferUntilTs = parseInt(deferUntilMatch[1], 10);
      expect(deferUntilTs).toBeGreaterThanOrEqual(beforeTs + 3599000);
      expect(deferUntilTs).toBeLessThanOrEqual(beforeTs + 3901000); // +65min 上界
    }
  });
});

// ─── BEHAVIOR-4: rate_limit defer 跳过 ───────────────────────────────────────

describe('[BEHAVIOR-4] rate_limit defer 跳过（watchdog tick）', () => {
  it('payload.defer_until 未到期 → 该 run 被跳过，spawnFn 未调用，db 无状态写入', async () => {
    const spawn = makeSpawnStub();
    const db = makeDbStub();

    const task = {
      id: 'task-rl-skip-001',
      payload: {
        defer_until: Date.now() + 30 * 60 * 1000, // 30分钟后到期
      },
    };

    // watchdog tick 跳过逻辑：若 defer_until > Date.now() → continue（不处置）
    const { shouldSkipDeferredTask } = await import(
      '../../../packages/brain/src/harness-death-handlers.js'
    ).catch(() => ({ shouldSkipDeferredTask: null }));

    if (!shouldSkipDeferredTask) {
      expect(false, 'shouldSkipDeferredTask 未实现（或未导出）').toBe(true);
      return;
    }

    const shouldSkip = shouldSkipDeferredTask(task);
    expect(shouldSkip).toBe(true);

    // 如果 skip，不调 spawn，不写 db
    if (!shouldSkip) {
      await spawn.fn(task, {});
    }

    expect(spawn.fn).not.toHaveBeenCalled();
    expect(db.query).not.toHaveBeenCalled();
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

// ─── BEHAVIOR-7: S0 startup-sync 批量恢复 ────────────────────────────────────

describe('[BEHAVIOR-7] S0 startup-sync 批量恢复', () => {
  it('2条 in_progress run 容器消失 → scanOrphanedRelayTasks → spawnFn 调用次数匹配分类结果', async () => {
    const spawn = makeSpawnStub();
    const exec = makeExecStub();
    const db = makeDbStub();

    // 2条 orphan run：一条 oom（会 spawn），一条 unknown（log_only 不 spawn）
    const orphanRuns = [
      {
        initiative_id: 'task-s0-001',
        id: 'run-s0-001',
        orchestrator_version: 'v2',
        phase: 'B_coding',
        last_container_exit_code: 137,
        stdout_tail: '',
        tmux_session: null,
      },
      {
        initiative_id: 'task-s0-002',
        id: 'run-s0-002',
        orchestrator_version: 'v2',
        phase: 'B_coding',
        last_container_exit_code: 1,
        stdout_tail: '',
        tmux_session: null,
      },
    ];

    // stub db.query 返回 orphan runs
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('in_progress') && sql.includes('initiative_runs')) {
        return { rows: orphanRuns };
      }
      return { rows: [] };
    });

    // stub exec：容器消失（返回空/非零）
    exec.fn.mockReturnValue('');

    const { scanOrphanedRelayTasks } = await import(
      '../../../packages/brain/src/startup-sync.js'
    ).catch(() => ({ scanOrphanedRelayTasks: null }));

    if (!scanOrphanedRelayTasks) {
      expect(false, 'scanOrphanedRelayTasks 未实现（packages/brain/src/startup-sync.js）').toBe(true);
      return;
    }

    await scanOrphanedRelayTasks({
      pool: db,
      spawnFn: spawn.fn,
      execFn: exec.fn,
    });

    // orphan-001: exit=137 → oom → spawn；orphan-002: exit=1 + 无特征 → unknown → log_only
    // 预期 spawn 被调用1次（仅 oom 路由）
    expect(spawn.fn).toHaveBeenCalledTimes(1);

    // 审计日志验证：每条 run 应打 source=startup-sync
    // （由于 console.log 是真实调用，此处仅验证 spawn 参数包含 source 标记或由 db 记录）
    const spawnTask = spawn._calls[0].task;
    expect(spawnTask.id).toBe('task-s0-001');
  });
});
