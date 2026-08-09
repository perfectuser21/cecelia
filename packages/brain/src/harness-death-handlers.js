/**
 * harness-death-handlers.js — A8-2 自愈链处置器
 *
 * 四个处置器函数，通过 deps 注入所有副作用（可测试）
 *
 * 接口（与合同测试对齐）：
 *   handleAuth(task, { cause, spawnFn, markAuthFailedFn, resolveAccountFn, pool, barkFn? })
 *   handleRateLimit(task, { cause, spawnFn, pool })
 *   handleGreenWaitingMerge(task, { cause, spawnFn, checkPrStatusFn?, pool })
 *   handleInteractiveStuck(task, { cause, spawnFn, execFn, pool })
 *   shouldSkipDeferredTask(task) → boolean
 */

import { persistTerminalFailure } from './orchestrator/failure-class.js';

/**
 * BEHAVIOR-1/2: auth 处置器
 * - auth_fail_count < 2 → 换号重点火
 * - auth_fail_count >= 2 → blocked + Bark 告警
 */
export async function handleAuth(task, {
  cause,
  spawnFn,
  markAuthFailedFn,
  resolveAccountFn,
  pool,
  barkFn = null,
}) {
  const currentAccount = task.payload?.CECELIA_CREDENTIALS;
  const authFailCount = task.payload?.auth_fail_count ?? 0;

  // 审计日志（INV-06）
  console.log(`cause=${cause} action=auth_retry initiative=${task.id} auth_fail_count=${authFailCount}`);

  // 标记当前账号失败
  await markAuthFailedFn(currentAccount);

  if (authFailCount >= 2) {
    // blocked + Bark
    await pool.query(
      `UPDATE tasks SET status='blocked', completed_at=NOW() WHERE id=$1`,
      [task.id]
    );
    // 收敛：连续 auth 失败 blocked terminal → result.failure_class（决策 e8f6134f 交付物2）
    await persistTerminalFailure(
      pool, task.id, 'infrastructure_blocked',
      `auth_blocked: ${authFailCount + 1} consecutive auth failures (${cause})`,
    );

    const barkMsg = `[Auth Blocked] task=${task.id} initiative=${task.id} 连续 ${authFailCount + 1} 次 auth 失败，已标 blocked。手册: docs/runbooks/codex-login.md`;
    if (barkFn) {
      await barkFn(barkMsg);
    }

    return { action: 'blocked' };
  }

  // 换账号
  const opts = { env: { CECELIA_CREDENTIALS: currentAccount }, cascade: task.payload?.cascade };
  await resolveAccountFn(opts);
  const newAccount = opts.env.CECELIA_CREDENTIALS;

  // 记录 auth_fail_count+1
  const newCount = authFailCount + 1;
  await pool.query(
    `UPDATE tasks SET payload = COALESCE(payload,'{}')::jsonb || $1::jsonb WHERE id=$2`,
    [JSON.stringify({ auth_fail_count: newCount }), task.id]
  );

  const r = await spawnFn(task, { pool, env: { CECELIA_CREDENTIALS: newAccount } });
  return { action: 'spawned', newAccount, containerId: r?.containerId };
}

/**
 * BEHAVIOR-3: rate_limit defer 处置器
 * - 不 spawn，写 defer_until 到 DB
 */
export async function handleRateLimit(task, {
  cause,
  spawnFn: _spawnFn,
  pool,
}) {
  const retryAfterTs = task.payload?.retry_after_ts;
  const deferUntil = retryAfterTs ?? (Date.now() + 60 * 60 * 1000);

  // 审计日志（INV-06）
  console.log(`cause=${cause} action=rate_limit_defer initiative=${task.id} defer_until=${new Date(deferUntil).toISOString()}`);

  await pool.query(
    `UPDATE tasks SET payload = COALESCE(payload,'{}')::jsonb || jsonb_build_object('defer_until', $1::bigint) WHERE id=$2`,
    [deferUntil, task.id]
  );

  return { action: 'deferred', defer_until: deferUntil };
}

/**
 * BEHAVIOR-4: rate_limit defer 跳过判断（watchdog tick 调用）
 * - 若 defer_until 未到期，返回 true（跳过）
 */
export function shouldSkipDeferredTask(task) {
  const deferUntil = task.payload?.defer_until;
  if (!deferUntil) return false;
  return deferUntil > Date.now();
}

/**
 * BEHAVIOR-5: green_waiting_merge 收尾棒处置器
 * - pr_url 存在 → spawn 带 resume_stage='finish'
 * - pr_url 不存在 → log_only，不 spawn
 */
export async function handleGreenWaitingMerge(task, {
  cause,
  spawnFn,
  checkPrStatusFn: _checkPrStatusFn = null,
  pool,
}) {
  const prUrl = task.payload?.pr_url;

  // 审计日志（INV-06）
  console.log(`cause=${cause} action=await_merge initiative=${task.id} pr_url=${prUrl}`);

  if (!prUrl) {
    console.warn(`[handleGreenWaitingMerge] pr_url 为空，跳过 spawn initiative=${task.id}`);
    return { action: 'skipped', reason: 'no_pr_url' };
  }

  // 调用 spawnFn 带 resume_stage='finish'
  const r = await spawnFn(task, { pool, resume_stage: 'finish' });
  return { action: 'spawned_finish', containerId: r?.containerId };
}

/**
 * BEHAVIOR-6: interactive_stuck kill+重点火处置器
 * - kill tmux session（non-fatal）
 * - 重点火
 */
export async function handleInteractiveStuck(task, {
  cause,
  spawnFn,
  execFn,
  pool,
}) {
  const tmuxSession = task.payload?.tmux_session ?? null;

  // 审计日志（INV-06）
  console.log(`cause=${cause} action=kill_refire initiative=${task.id} tmux=${tmuxSession}`);

  if (tmuxSession) {
    try {
      execFn(`tmux kill-session -t ${tmuxSession}`);
    } catch (err) {
      console.warn(`[handleInteractiveStuck] kill-session 失败（non-fatal）: ${err.message}`);
    }
  }

  const r = await spawnFn(task, { pool });
  return { action: 'refired', containerId: r?.containerId };
}
