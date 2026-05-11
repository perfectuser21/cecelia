/**
 * Brain v2 Phase D Part 1.5 — dispatchNextTask + _dispatchViaWorkflowRuntime 抽出。
 *
 * 原在 tick.js L706-L1115（dispatchNextTask）+ L3020-L3061（_dispatchViaWorkflowRuntime
 * — dev 任务走 L2 workflow runtime），瘦身抽出独立模块。
 *
 * 模块状态：
 * - `_lastDispatchTime` 私有计时器（旧逻辑只写不读，留作潜在 telemetry hook，未来若确认死代码可清）
 *
 * 本模块复制 tickLog / logTickDecision 两个 helper（tick.js 内部 helper，无 module 状态依赖），
 * 保持原 [tick]/[dispatch] 日志前缀不变。
 *
 * tick.js 通过 import + re-export 维持既有 caller 兼容（_dispatchViaWorkflowRuntime test）。
 */

import pool from './db.js';
import { isGlobalQuotaCooling, getQuotaCoolingState } from './quota-cooling.js';
import { isDraining, getDrainStartedAt } from './drain.js';
import {
  triggerCeceliaRun,
  checkCeceliaRunAvailable,
  killProcessTwoStage,
  getBillingPause,
} from './executor.js';
import { calculateSlotBudget } from './slot-allocator.js';
import { shouldDowngrade } from './token-budget-planner.js';
import { emit } from './event-bus.js';
import { isAllowed, recordFailure } from './circuit-breaker.js';
import { publishTaskStarted } from './events/taskEvents.js';
import { recordDispatchResult } from './dispatch-stats.js';
import { proactiveTokenCheck } from './account-usage.js';
import { checkQuotaGuard } from './quota-guard.js';
import { updateTask } from './actions.js';
import { selectNextDispatchableTask, processCortexTask } from './dispatch-helpers.js';

const MINIMAL_MODE = process.env.BRAIN_MINIMAL_MODE === 'true';
const TICK_LAST_DISPATCH_KEY = 'tick_last_dispatch';

// Initiative-level lock 仅对 harness pipeline 类型生效。
// dev / talk / audit / qa 等通用任务不持有 initiative lock，避免单 project 内死锁
// （bb245cb4 教训：harness Initiative Phase A 跑期间整个 project 通用任务全被拒派）。
const INITIATIVE_LOCK_TASK_TYPES = [
  'harness_task',
  'harness_planner',
  'harness_contract_propose',
  'harness_contract_review',
  'harness_fix',
  'harness_initiative',
];

// Retired harness task types — 全部归入 harness_initiative full-graph sub-graph。
// 这些类型不再需要 executor / cecelia-bridge：派发路径上直接标 pipeline_terminal_failure。
// 必须在 `checkCeceliaRunAvailable` 之前拦截，否则在没有 bridge 的环境（CI clean docker /
// brain-only deploy）retired task 会被永远 revert 回 queued，无法 terminate。
// executor.js 内 `triggerCeceliaRun` 也保留同款拦截作 defense-in-depth（老 caller 直
// 调 executor 时仍然有效）。
const _RETIRED_HARNESS_TYPES_DISPATCH = new Set([
  'harness_task', 'harness_ci_watch', 'harness_fix', 'harness_final_e2e',
  'harness_planner',
]);

// 私有计时器（旧只写不读，保留 hook 给未来 telemetry）
let _lastDispatchTime = 0;

// 日志 helper：[tick] 前缀 + Asia/Shanghai 时间戳，与 tick.js 同风格
function tickLog(...args) {
  const ts = new Date().toLocaleTimeString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
  console.log(`[${ts}]`, ...args);
}

// decision_log 落盘（用于 dispatch 路径排障，CI 可 grep）
async function logTickDecision(trigger, inputSummary, decision, result) {
  await pool.query(`
    INSERT INTO decision_log (trigger, input_summary, llm_output_json, action_result_json, status)
    VALUES ($1, $2, $3, $4, $5)
  `, [
    trigger,
    inputSummary,
    decision,
    result,
    result?.success ? 'success' : 'failed',
  ]);
}

/**
 * Dispatch the next queued task for execution.
 * Checks concurrency limit, executor availability, and dependencies.
 *
 * @param {string[]} goalIds - Goal IDs to scope the dispatch
 * @returns {Object} - Dispatch result with actions taken
 */
export async function dispatchNextTask(goalIds) {
  const actions = [];

  // 0. Drain check — skip dispatch if draining (let in_progress tasks finish)
  // Also check alertness-requested drain mode
  const { getMitigationState } = await import('./alertness-actions.js');
  const mitigationState = getMitigationState();

  if (isDraining() || mitigationState.drain_mode_requested) {
    await recordDispatchResult(pool, false, 'draining');
    return {
      dispatched: false,
      reason: 'draining',
      detail: isDraining() ? `Drain mode active since ${getDrainStartedAt()}` : 'Alertness COMA drain mode',
      actions
    };
  }

  // 0a-pre. Quota cooling check — 全局 quota 冷却期内跳过派发
  let _qcActive = false;
  try {
    _qcActive = isGlobalQuotaCooling();
  } catch (qcErr) {
    console.error('[tick] quota_cooling_check_error (non-fatal):', qcErr.message);
  }
  if (_qcActive) {
    const qcState = getQuotaCoolingState();
    tickLog(`[tick] quota cooling until: ${qcState.until}`);
    return { skipped: true, reason: 'quota_cooling' };
  }

  // 0a-token. Proactive token expiry check — 派发前主动检测各账号 token 状态
  // token 过期 → 立即 markAuthFailure 熔断，阻止派发级联 401
  // MINIMAL_MODE 下跳过（不创建 research 告警任务）
  if (!MINIMAL_MODE) {
  try {
    await proactiveTokenCheck();
  } catch (tokenCheckErr) {
    console.error('[tick] proactiveTokenCheck failed (non-fatal):', tokenCheckErr.message);
  }
  }

  // 0a. Billing pause check — quota_exhausted 全局熔断
  const billingPause = getBillingPause();
  if (billingPause.active) {
    tickLog(`[tick] Billing pause active until ${billingPause.resetTime} (${billingPause.reason}), skipping dispatch`);
    await recordDispatchResult(pool, false, 'billing_pause');
    return {
      dispatched: false,
      reason: 'billing_pause',
      detail: `Billing pause active until ${billingPause.resetTime}`,
      actions
    };
  }

  // 0b. Quota guard check — 根据账号 5h 余量限制调度范围（MINIMAL_MODE 下跳过）
  let _quotaPriorityFilter = null;
  if (!MINIMAL_MODE) {
    try {
      const qg = await checkQuotaGuard();
      if (!qg.allow) {
        tickLog(`[tick] quota guard: ${qg.reason} bestPct=${qg.bestPct.toFixed(1)}%，暂停全部调度`);
        await recordDispatchResult(pool, false, 'quota_critical');
        return {
          dispatched: false,
          reason: 'quota_critical',
          detail: `所有账号 quota > 98%（最优=${qg.bestPct.toFixed(1)}%），请等待 quota 重置`,
          actions,
        };
      }
      if (qg.priorityFilter) {
        _quotaPriorityFilter = qg.priorityFilter;
        tickLog(`[tick] quota guard: ${qg.reason} bestPct=${qg.bestPct.toFixed(1)}%，仅派 ${qg.priorityFilter.join('/')}`);
      }
    } catch (qgErr) {
      console.error('[tick] quota guard check failed (non-fatal):', qgErr.message);
    }
  }

  // 0. Three-pool slot budget check (replaces flat MAX_SEATS - INTERACTIVE_RESERVE)
  const slotBudget = await calculateSlotBudget();
  if (!slotBudget.dispatchAllowed) {
    // Eviction: if a high-priority task is waiting, try to evict a low-priority one
    try {
      // Peek at the next queued task to check its priority
      const peekResult = await pool.query(`
        SELECT priority FROM tasks WHERE status = 'queued'
        ORDER BY CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 ELSE 9 END, created_at ASC
        LIMIT 1
      `);
      const nextPriority = peekResult.rows[0]?.priority;
      if (nextPriority === 'P0' || nextPriority === 'P1') {
        const { findEvictionCandidate, requeueEvictedTask } = await import('./eviction.js');
        const candidate = await findEvictionCandidate(nextPriority);
        if (candidate) {
          tickLog(`[tick] Eviction: ${nextPriority} task waiting, evicting ${candidate.priority} task=${candidate.taskId} (score=${candidate.score.toFixed(1)})`);
          const evictKill = await killProcessTwoStage(candidate.taskId, candidate.pgid);
          if (evictKill.killed) {
            // Emergency cleanup for evicted task
            try {
              const { emergencyCleanup } = await import('./emergency-cleanup.js');
              if (candidate.slot) emergencyCleanup(candidate.taskId, candidate.slot);
            } catch { /* non-fatal */ }
            await requeueEvictedTask(candidate.taskId, candidate.priority, `evicted_for_${nextPriority}`);
            const { cleanupMetrics } = await import('./watchdog.js');
            cleanupMetrics(candidate.taskId);
            actions.push({ action: 'eviction', evicted_task: candidate.taskId, evicted_priority: candidate.priority, for_priority: nextPriority });
            // Don't return - fall through to re-check budget and continue dispatch
          }
        }
      }
    } catch (evictionErr) {
      console.error(`[tick] Eviction error (non-fatal): ${evictionErr.message}`);
    }

    // Re-check budget after potential eviction
    const slotBudgetAfter = await calculateSlotBudget();
    if (!slotBudgetAfter.dispatchAllowed) {
      // Xian bypass: xian-type tasks use independent Codex Bridge pool, not task_pool.
      // Allow them through when codex pool has capacity, even if task_pool is full.
      let xianBypass = false;
      if (slotBudgetAfter.codex?.available) {
        try {
          const { getTaskLocation } = await import('./task-router.js');
          const peekXian = await pool.query(`
            SELECT task_type FROM tasks WHERE status = 'queued'
            ORDER BY CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 ELSE 9 END, created_at ASC
            LIMIT 1
          `);
          const nextType = peekXian.rows[0]?.task_type;
          if (nextType && getTaskLocation(nextType) === 'xian') {
            tickLog(`[tick] Codex xian bypass: task_pool full but codex pool available for task_type=${nextType}`);
            xianBypass = true;
          }
        } catch (bypassErr) {
          console.warn(`[tick] xian bypass check failed (non-fatal): ${bypassErr.message}`);
        }
      }
      if (!xianBypass) {
        const slotReason = slotBudget.user.mode === 'team' ? 'user_team_mode' :
                           slotBudget.taskPool.budget === 0 ? 'pool_exhausted' : 'pool_c_full';
        await recordDispatchResult(pool, false, slotReason);
        return {
          dispatched: false,
          reason: slotReason,
          budget: slotBudgetAfter,
          actions,
        };
      }
    }
  }

  // 2. Circuit breaker check
  if (!isAllowed('cecelia-run')) {
    await recordDispatchResult(pool, false, 'circuit_breaker_open');
    return { dispatched: false, reason: 'circuit_breaker_open', actions };
  }

  // 2.6 Executor preflight — bridge ping 提到队首，
  //     bridge 不可用时整波 dispatch 立刻退场：不抢 task、不写 in_progress、
  //     不释放 claim。原 checkCeceliaRunAvailable 在 in_progress 标记之后才调，
  //     bridge 离线时每个 tick 需要 4 次 DB 写 (claim/in_progress/revert/release)
  //     才发现执行不了，1 小时断联累积数百次无谓 IO + 短暂 zombie 窗口。
  //     Insight learning_id=c8b0160f-709b-483c-bc49-384df2691809：
  //     "一次 ping 阻止整个断联期间的所有僵尸任务"。
  //     第 5 步保留同款检查作 defense-in-depth（preflight 与 trigger 之间窗口）。
  const executorPreflight = await checkCeceliaRunAvailable();
  if (!executorPreflight.available) {
    tickLog(`[dispatch] executor preflight failed: ${executorPreflight.error} — skip dispatch (no claim, no status write)`);
    await recordDispatchResult(pool, false, 'executor_offline');
    return {
      dispatched: false,
      reason: 'executor_offline',
      detail: executorPreflight.error,
      executor_url: executorPreflight.path,
      actions,
    };
  }

  // 2.5 Drain retired harness tasks — 一次 SQL 把所有 queued retired 类型批量
  //     标 pipeline_terminal_failure。必须在 selectNextDispatchableTask 之前，
  //     防止 retired task 跟正常 P0/P1 队列竞争 — 在 bridge 不可用的环境（CI
  //     clean docker / brain-only deploy）retired task 会被 no_executor revert
  //     永远循环，挤占调度器算力。
  //     放在所有 skip 检查（drain/quota_cooling/billing/slot/circuit）之后，
  //     这样系统不健康时不写 DB（保持调度路径侧效应一致性）。
  try {
    const drained = await pool.query(
      `UPDATE tasks
         SET status='failed', completed_at=NOW(),
             error_message='task_type ' || task_type || ' retired (subsumed by harness_initiative full graph)',
             payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object('failure_class', 'pipeline_terminal_failure')
       WHERE status='queued'
         AND task_type = ANY($1::text[])
       RETURNING id, task_type`,
      [Array.from(_RETIRED_HARNESS_TYPES_DISPATCH)]
    );
    if (drained.rowCount > 0) {
      tickLog(`[dispatch] drained ${drained.rowCount} queued retired harness task(s)`);
      for (const row of drained.rows) {
        actions.push({ action: 'retire-task', task_id: row.id, task_type: row.task_type });
      }
    }
  } catch (drainErr) {
    console.error(`[dispatch] retired task drain failed (non-fatal): ${drainErr.message}`);
  }

  // 3. Select next task (with dependency check + pre-flight validation)
  //    If pre-flight fails, skip that task and try the next candidate (max 5 retries)
  const MAX_PRE_FLIGHT_RETRIES = 5;
  const preFlightFailedIds = [];
  let nextTask = null;

  const { preFlightCheck, alertOnPreFlightFail } = await import('./pre-flight-check.js');

  for (let attempt = 0; attempt <= MAX_PRE_FLIGHT_RETRIES; attempt++) {
    const candidate = await selectNextDispatchableTask(goalIds, preFlightFailedIds, { priorityFilter: _quotaPriorityFilter });
    if (!candidate) {
      return { dispatched: false, reason: 'no_dispatchable_task', actions };
    }

    // 3a. Check if task requires Cortex processing (Brain-internal RCA)
    if (candidate.payload && candidate.payload.requires_cortex === true) {
      return await processCortexTask(candidate, actions);
    }

    // 3b. Pre-flight Check — validate task quality before dispatch
    const checkResult = await preFlightCheck(candidate);
    if (checkResult.passed) {
      nextTask = candidate;
      break;
    }

    // Pre-flight failed — record and skip to next candidate
    console.warn(`[dispatch] Pre-flight check failed for task ${candidate.id} (attempt ${attempt + 1}/${MAX_PRE_FLIGHT_RETRIES + 1}):`, checkResult.issues);
    await pool.query(
      `UPDATE tasks SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
      [candidate.id, JSON.stringify({
        pre_flight_failed: true,
        pre_flight_issues: checkResult.issues,
        pre_flight_suggestions: checkResult.suggestions,
        failed_at: new Date().toISOString()
      })]
    );
    await recordDispatchResult(pool, false, 'pre_flight_check_failed');
    // C4: 通过飞书告警推送 pre-flight cancel，防止任务静默堆积（不抛异常，不影响 dispatch）
    await alertOnPreFlightFail(pool, candidate, checkResult);
    preFlightFailedIds.push(candidate.id);
  }

  if (!nextTask) {
    return { dispatched: false, reason: 'all_candidates_failed_pre_flight', skipped: preFlightFailedIds.length, actions };
  }

  // 3b'. Retired harness task_types — 不需要 executor，直接标 terminal_failure。
  //      必须放在 checkCeceliaRunAvailable 之前，否则在 cecelia-bridge 不可用的环境
  //      （CI / brain-only deploy）retired task 永远 revert 回 queued。
  if (_RETIRED_HARNESS_TYPES_DISPATCH.has(nextTask.task_type)) {
    tickLog(`[dispatch] retired task_type=${nextTask.task_type} task=${nextTask.id} → marking pipeline_terminal_failure`);
    try {
      await pool.query(
        `UPDATE tasks SET status='failed', completed_at=NOW(),
          error_message=$2,
          payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object('failure_class', 'pipeline_terminal_failure')
         WHERE id=$1::uuid`,
        [nextTask.id, `task_type ${nextTask.task_type} retired (subsumed by harness_initiative full graph)`]
      );
    } catch (err) {
      console.error(`[dispatch] mark retired task failed: ${err.message}`);
    }
    await recordDispatchResult(pool, false, 'retired_task_type');
    actions.push({
      action: 'retire-task',
      task_id: nextTask.id,
      title: nextTask.title,
      task_type: nextTask.task_type,
    });
    return { dispatched: false, reason: 'retired_task_type', task_id: nextTask.id, task_type: nextTask.task_type, retired: true, actions };
  }

  // 3c. Initiative-level lock: 仅对 harness pipeline 类型生效，且只查同 project 的 harness blocker。
  //     dev / talk / audit 等通用任务不进入这条分支，避免单 project 死锁（bb245cb4 教训）。
  if (nextTask.project_id && INITIATIVE_LOCK_TASK_TYPES.includes(nextTask.task_type)) {
    const lockCheck = await pool.query(
      `SELECT id, title FROM tasks
       WHERE project_id = $1
         AND status = 'in_progress'
         AND task_type = ANY($3::text[])
         AND id != $2
       LIMIT 1`,
      [nextTask.project_id, nextTask.id, INITIATIVE_LOCK_TASK_TYPES]
    );
    if (lockCheck.rows.length > 0) {
      const blocker = lockCheck.rows[0];
      tickLog(`[dispatch] Initiative 已有进行中 harness 任务 (task_id: ${blocker.id})，跳过派发: ${nextTask.title}`);
      await recordDispatchResult(pool, false, 'initiative_locked');
      return { dispatched: false, reason: 'initiative_locked', blocking_task_id: blocker.id, task_id: nextTask.id, actions };
    }
  }

  // 3c'. C1 Atomic claim: 确保没被其他 runner（如外部 autonomous agent）抢先 claim
  //      放在 pre-flight / initiative lock 之后、mark in_progress 之前，
  //      让 UPDATE...WHERE claimed_by IS NULL 的原子性承担"同一 task 只能派给一个 runner"的保证。
  const claimerId = process.env.BRAIN_RUNNER_ID || `brain-tick-${process.pid}`;
  const claimResult = await pool.query(
    `UPDATE tasks SET claimed_by = $1, claimed_at = NOW()
     WHERE id = $2 AND claimed_by IS NULL
     RETURNING id`,
    [claimerId, nextTask.id]
  );
  if (claimResult.rows.length === 0) {
    tickLog(`[dispatch] task ${nextTask.id} already claimed by another runner, skipping`);
    await recordDispatchResult(pool, false, 'already_claimed');
    return { dispatched: false, reason: 'already_claimed', task_id: nextTask.id, actions };
  }

  // 3d. Codex Pool D: check concurrent limit for Codex-native task types
  const isCodexNativeTask = nextTask.task_type === 'codex_qa' || nextTask.task_type === 'codex_dev' || nextTask.task_type === 'codex_test_gen';
  if (isCodexNativeTask) {
    const codexSlots = slotBudget?.codex;
    if (codexSlots && !codexSlots.available) {
      tickLog(`[dispatch] Codex pool full (${codexSlots.running}/${codexSlots.max}), skipping codex task ${nextTask.id}`);
      await recordDispatchResult(pool, false, 'codex_pool_full');
      return { dispatched: false, reason: 'codex_pool_full', codex_running: codexSlots.running, codex_max: codexSlots.max, task_id: nextTask.id, actions };
    }
  }

  // 4. Update task status to in_progress
  const updateResult = await updateTask({
    task_id: nextTask.id,
    status: 'in_progress'
  });

  if (!updateResult.success) {
    // C1: mark in_progress 失败 → 释放 claim 让下次 tick 重试
    await pool.query(
      `UPDATE tasks SET claimed_by = NULL, claimed_at = NULL WHERE id = $1`,
      [nextTask.id]
    );
    return { dispatched: false, reason: 'update_failed', task_id: nextTask.id, actions };
  }

  actions.push({
    action: 'update-task',
    task_id: nextTask.id,
    title: nextTask.title,
    status: 'in_progress'
  });

  // 5. Check executor availability and trigger
  const ceceliaAvailable = await checkCeceliaRunAvailable();
  if (!ceceliaAvailable.available) {
    // Revert task to queued so it can be retried next tick
    await updateTask({ task_id: nextTask.id, status: 'queued' });
    // C1: 释放 claim，否则下次 tick 会被误判为"已被 claim"永远起不来
    await pool.query(
      `UPDATE tasks SET claimed_by = NULL, claimed_at = NULL WHERE id = $1`,
      [nextTask.id]
    );
    await logTickDecision(
      'tick',
      `cecelia-run not available, task reverted to queued`,
      { action: 'no-executor', task_id: nextTask.id, reason: ceceliaAvailable.error },
      { success: false, warning: 'cecelia-run not available, task reverted to queued' }
    );
    await recordDispatchResult(pool, false, 'no_executor');
    return { dispatched: false, reason: 'no_executor', task_id: nextTask.id, actions };
  }

  const fullTaskResult = await pool.query('SELECT * FROM tasks WHERE id = $1', [nextTask.id]);
  if (fullTaskResult.rows.length === 0) {
    await recordDispatchResult(pool, false, 'task_not_found');
    return { dispatched: false, reason: 'task_not_found', task_id: nextTask.id, actions };
  }

  // Budget-aware executor downgrade：
  // 当 Claude 7day 配额紧张（tight/critical）时，将可降级的任务（dev/code_review）
  // 自动路由到 Codex（设置 provider=codex），节省 Claude token。
  let taskToDispatch = fullTaskResult.rows[0];
  try {
    const budgetState = slotBudget?.budgetState?.state || 'abundant';
    const taskType = taskToDispatch.task_type || 'dev';
    if (shouldDowngrade(taskType, budgetState)) {
      tickLog(`[dispatch] budget_state=${budgetState} → downgrade task=${taskToDispatch.id} type=${taskType} to codex`);
      taskToDispatch = {
        ...taskToDispatch,
        provider: 'codex',
        _downgraded: true,
        _downgrade_reason: `budget_state=${budgetState}`,
      };
    }
  } catch (err) {
    console.warn(`[dispatch] shouldDowngrade check failed: ${err.message}, proceeding with original executor`);
  }

  // dev 任务走 L2 workflow runtime → runWorkflow 接线（fire-and-forget）
  const v2Result = await _dispatchViaWorkflowRuntime(taskToDispatch);
  if (v2Result.handled) {
    return {
      dispatched: true,
      task_id: v2Result.task_id,
      runtime: 'v2',
      actions: [...actions, ...v2Result.actions],
    };
  }

  const execResult = await triggerCeceliaRun(taskToDispatch);

  // 5a. Check if executor actually succeeded — revert to queued if not
  if (!execResult.success) {
    console.warn(`[dispatch] triggerCeceliaRun failed for task ${nextTask.id}: ${execResult.error || execResult.reason}`);
    await updateTask({ task_id: nextTask.id, status: 'queued' });
    // configError 表示系统配置错误（如容器漏装 codex CLI），不属于运行时执行失败，
    // 不应累积 cecelia-run breaker（否则配置漂移会 trip breaker 阻断所有 dispatch）。
    if (execResult.configError) {
      console.warn(`[dispatch] configError detected (reason=${execResult.reason}) — skipping cecelia-run breaker count`);
    } else {
      await recordFailure('cecelia-run');
    }
    await logTickDecision(
      'tick',
      `Executor failed, task reverted to queued: ${execResult.error || execResult.reason}`,
      { action: 'executor_failed', task_id: nextTask.id, reason: execResult.reason, error: execResult.error, configError: !!execResult.configError },
      { success: false }
    );
    await recordDispatchResult(pool, false, execResult.configError ? 'config_error' : 'executor_failed');
    return { dispatched: false, reason: execResult.configError ? 'config_error' : 'executor_failed', task_id: nextTask.id, error: execResult.error || execResult.reason, configError: !!execResult.configError, actions };
  }

  _lastDispatchTime = Date.now();

  // Publish WebSocket event: task started (non-blocking, errors don't break dispatch)
  try {
    publishTaskStarted({
      id: nextTask.id,
      run_id: execResult.runId,
      title: nextTask.title
    });

    // Executor status is now available via GET /api/brain/slots (slot budget)
  } catch (wsErr) {
    console.error(`[tick] WebSocket broadcast failed: ${wsErr.message}`);
  }

  await emit('task_dispatched', 'tick', {
    task_id: nextTask.id,
    title: nextTask.title,
    run_id: execResult.runId,
    success: execResult.success
  });

  // Record dispatch info in working_memory
  await pool.query(`
    INSERT INTO working_memory (key, value_json, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()
  `, [TICK_LAST_DISPATCH_KEY, {
    task_id: nextTask.id,
    task_title: nextTask.title,
    run_id: execResult.runId,
    dispatched_at: new Date().toISOString(),
    success: execResult.success
  }]);

  await logTickDecision(
    'tick',
    `Dispatched cecelia-run for task: ${nextTask.title}`,
    { action: 'dispatch', task_id: nextTask.id, run_id: execResult.runId },
    execResult
  );

  actions.push({
    action: 'dispatch',
    task_id: nextTask.id,
    title: nextTask.title,
    run_id: execResult.runId,
    success: execResult.success
  });

  // Record pre-flight check statistics
  try {
    const { getPreFlightStats } = await import('./pre-flight-check.js');
    const stats = await getPreFlightStats(pool);
    await pool.query(`
      INSERT INTO working_memory (key, value_json, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()
    `, ['pre_flight_stats', stats]);
  } catch (statsErr) {
    console.error(`[dispatch] Failed to record pre-flight stats: ${statsErr.message}`);
  }

  // Record dispatch success to rolling window stats
  await recordDispatchResult(pool, true);

  return { dispatched: true, task_id: nextTask.id, run_id: execResult.runId, actions };
}

// ═══════════════════════════════════════════════════════════════════════════

/**
 * task_type=dev 任务一律走 L2 orchestrator runWorkflow('dev-task')，
 * fire-and-forget 派发。其他 task_type 返回 {handled:false} 让 caller fall through。
 *
 * @param {object} taskToDispatch Brain task row（含 id / task_type / retry_count 等）
 * @returns {Promise<{handled:boolean, runtime?:string, task_id?:string, actions?:Array}>}
 */
export async function _dispatchViaWorkflowRuntime(taskToDispatch) {
  if (taskToDispatch?.task_type !== 'dev') return { handled: false };

  const { runWorkflow } = await import('./orchestrator/graph-runtime.js');
  const attemptN = (taskToDispatch.payload?.attempt_n ?? taskToDispatch.retry_count ?? 0) + 1;

  // fire-and-forget：graph 层 pg checkpointer 负责崩溃 resume；.catch 落 logTickDecision 排障
  runWorkflow('dev-task', taskToDispatch.id, attemptN, { task: taskToDispatch })
    .catch((err) => {
      logTickDecision(
        'tick',
        `runWorkflow dev-task failed: ${err.message}`,
        {
          action: 'workflow_runtime_error',
          task_id: taskToDispatch.id,
          runtime: 'v2',
          attemptN,
          error: err.message,
        },
        { success: false },
      );
    });

  _lastDispatchTime = Date.now();
  await recordDispatchResult(pool, true, 'workflow_runtime_v2');
  await emit('task_dispatched', 'tick', {
    task_id: taskToDispatch.id,
    title: taskToDispatch.title,
    runtime: 'v2',
    success: true,
  });

  const actions = [{
    action: 'dispatch_v2_workflow',
    task_id: taskToDispatch.id,
    runtime: 'v2',
    attemptN,
  }];

  return { handled: true, runtime: 'v2', task_id: taskToDispatch.id, actions };
}
