/**
 * Brain v2 Phase D Part 1.5 — dispatchNextTask 抽出。
 *
 * 原在 tick.js L706-L1115（dispatchNextTask），瘦身抽出独立模块。
 * dev 任务与其他 task_type 一样走 triggerCeceliaRun 本地 spawn（活性信号已通）。
 *
 * 模块状态：
 * - `_lastDispatchTime` 私有计时器（旧逻辑只写不读，留作潜在 telemetry hook）
 *
 * 本模块复制 tickLog / logTickDecision 两个 helper（tick.js 内部 helper，无 module 状态依赖），
 * 保持原 [tick]/[dispatch] 日志前缀不变。
 */

import pool from './db.js';
import { isGlobalQuotaCooling, getQuotaCoolingState } from './quota-cooling.js';
import { isDraining, getDrainStartedAt } from './drain.js';
import { reconcileBlockingStates, maybeLogDrainSummary } from './blocking-states.js';
import {
  triggerCeceliaRun,
  checkCeceliaRunAvailable,
  killProcessTwoStage,
  getBillingPause,
} from './executor.js';
import { calculateSlotBudget, harnessSlotCheck } from './slot-allocator.js';
import { emit } from './event-bus.js';
import { isAllowed, recordFailure } from './circuit-breaker.js';
import { publishTaskStarted } from './events/taskEvents.js';
import { recordDispatchResult } from './dispatch-stats.js';
import { recordTaskEventSafe } from './lib/task-event-log.js';
import { incrementActionsToday } from './tick-stats.js';
import { proactiveTokenCheck } from './account-usage.js';
import { checkQuotaGuard } from './quota-guard.js';
import { updateTask } from './actions.js';
import { selectNextDispatchableTask, processCortexTask } from './dispatch-helpers.js';
import { findDuplicateSibling } from './dispatch-dedup.js';
import { blockTask } from './task-updater.js';
import { raise } from './alerting.js';
import { checkAnchor } from './anchor-check.js';
import { applyDispatchAllocationGuide } from './dispatch-allocation-guide.js';
import { getLlmCapacitySnapshot } from './llm-capacity.js';

const MINIMAL_MODE = process.env.BRAIN_MINIMAL_MODE === 'true';
const TICK_LAST_DISPATCH_KEY = 'tick_last_dispatch';

// ============================================================
// dispatch-fail-autoblock：连续派发失败自动隔离
// ============================================================
// 连续派发失败次数存储在 tasks.metadata.dispatch_fail_consecutive。
// 达到阈值后自动将 task 置 blocked，防止坏任务持续占据调度器。
// configError / spawn_deduplicated 类型失败不计入计数（非 executor 故障）。
// env DISPATCH_FAIL_AUTOBLOCK_THRESHOLD 可覆盖阈值；非法值（NaN / <1）回退默认 3。
export const DISPATCH_FAIL_AUTOBLOCK_THRESHOLD = (() => {
  const raw = parseInt(process.env.DISPATCH_FAIL_AUTOBLOCK_THRESHOLD || '', 10);
  return Number.isFinite(raw) && raw >= 1 ? raw : 3;
})();

// ============================================================
// harness 派发闸——判定唯一入口在 slot-allocator.harnessSlotCheck()（beeba317 收权）
// 数活容器不数任务：任务生命周期一半在等 CI，容器已退仍占任务数位 = 纸面满机器空转。
// 这里只留任务数纯兜底（docker 层全瞎时防无限叠加），阈值宽到正常永不触发。
// ============================================================
export const HARNESS_TASK_CAP_BACKSTOP = 12;

/**
 * 纯判定：候选任务是否应受 harness 并发 cap 限制。
 *
 * OPEN-2：看门狗把 parked in_progress 任务重排（resume_from_checkpoint=true）后，
 * 这条 resume 不是「新工作」——它恢复的是一个已经存在、已经占过 cap 槽的 initiative。
 * 若仍受 cap 限制，其它活跑占满 cap 时 resume 会被永久挡住 → 自愈被 cap 锁死。
 * 因此 resume 任务豁免 cap。
 *
 * @param {{ task_type?: string, payload?: object }} candidate
 * @returns {boolean} true=应套用并发 cap 检查
 */
export function shouldApplyHarnessCap(candidate) {
  if (!candidate) return false;
  if (candidate.task_type !== 'harness_initiative'
      && candidate.task_type !== 'golden_path_proposal') return false;
  if (candidate.payload?.resume_from_checkpoint === true) return false;
  return true;
}

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
  'golden_path_proposal',
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

// 6 小时：保守估计——同一件事被重复创建 task 通常在同一批派发/规划动作内发生（分钟级到
// 小时级），6 小时留足余量覆盖"人工补录/次日晨会补建"等滞后场景，同时不至于把几天后
// 恰好撞标题的无关任务误判为重复。暂无更精确的历史撞车时间差数据支撑这个数字，
// 如线上观测到误判率偏高（漏判或错杀）应基于实际案例回填数据后再收紧。
const DUPLICATE_TASK_WINDOW_HOURS = 6;
const DUPLICATE_TASK_TITLE_THRESHOLD = 0.6;

/**
 * 派发前判重：同 task_type 且状态 queued/in_progress 的任务里，
 * 找创建时间窗口内标题高度相似的 sibling。查询失败保守放行（返回 null），
 * 不能因为一次 DB 抖动阻塞整个派发循环。
 */
export async function _internals_findDuplicateTaskSibling(candidate) {
  try {
    // SELECT 列顺序/别名与下方 initiative-lock 查询（"SELECT id, title FROM tasks"）刻意区分，
    // 避免两条查询的 SQL 指纹在测试里按字符串前缀匹配时被混淆（同一 dispatchNextTask 内两条
    // 语义不同的查询都含 "task_type" + "SELECT ... FROM tasks"，纯前缀匹配无法区分）。
    const { rows } = await pool.query(
      `SELECT tasks.id AS id, tasks.title AS title
        FROM tasks
        WHERE tasks.task_type = $1
          AND tasks.status IN ('queued', 'in_progress')
          AND tasks.id != $2
          AND tasks.created_at BETWEEN $3::timestamptz - INTERVAL '${DUPLICATE_TASK_WINDOW_HOURS} hours'
                                    AND $3::timestamptz + INTERVAL '${DUPLICATE_TASK_WINDOW_HOURS} hours'
        LIMIT 20`,
      [candidate.task_type, candidate.id, candidate.created_at]
    );
    return findDuplicateSibling(candidate.title || '', rows, {
      threshold: DUPLICATE_TASK_TITLE_THRESHOLD,
      keyFn: (r) => r.title || '',
    });
  } catch (err) {
    console.warn(`[dispatch] duplicate-task lookup failed (non-fatal, fail-open): ${err.message}`);
    // 降级行为不变（仍返回 null 放行），但要计数进滚动统计，
    // 否则这个查询长期挂掉也不会有人发现（静默降级）。
    // recordDispatchResult 自身也走 pool.query——若同一次 DB 抖动导致它也失败，
    // 绝不能让这里的失败向上抛出并破坏 fail-open 承诺，吞掉即可。
    try {
      await recordDispatchResult(pool, false, 'duplicate_check_query_failed');
    } catch (statsErr) {
      console.warn(`[dispatch] recordDispatchResult failed while reporting duplicate_check_query_failed (non-fatal): ${statsErr.message}`);
    }
    return null;
  }
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
  let llmCapacitySnapshot = null;

  // 0-pre. 阻断类状态位 TTL 自愈——排空置位超 TTL 无人续期则自动解除 + 留痕 + 告警，
  // 避免「健康地停摆」（2026-08-10 tick_draining 卡 2h20m、5 条 P0 零派发事故）。
  // 放在 drain 闸之前：同一轮解除后下面 queued 任务即可正常被派发。
  try {
    await reconcileBlockingStates(pool);
  } catch (reconcileErr) {
    console.error('[dispatch] blocking-state reconcile failed (non-fatal):', reconcileErr.message);
  }

  // 0. Drain check — skip dispatch if draining (let in_progress tasks finish)
  // Also check alertness-requested drain mode
  const { getMitigationState } = await import('./alertness-actions.js');
  const mitigationState = getMitigationState();

  if (isDraining() || mitigationState.drain_mode_requested) {
    // 可观测兜底：排空生效期每 N 轮打印一条汇总（已排空多久 + 挡住多少候选），
    // 消除「排空期间日志里什么都没有」的排障黑洞（事故①连 slot_check 都不出现）。
    if (isDraining()) {
      try {
        await maybeLogDrainSummary(pool);
      } catch (summaryErr) {
        console.error('[dispatch] drain summary log failed (non-fatal):', summaryErr.message);
      }
    }
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
            SELECT task_type, location FROM tasks WHERE status = 'queued'
            ORDER BY CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 ELSE 9 END, created_at ASC
            LIMIT 1
          `);
          const nextTask = peekXian.rows[0];
          const nextType = nextTask?.task_type;
          // BEHAVIOR-8: task.location='xian' 直接判断（DB 字段驱动），或 getTaskLocation 静态映射
          if ((nextTask?.location === 'xian') || (nextType && getTaskLocation(nextType) === 'xian')) {
            tickLog(`[tick] Codex xian bypass: task_pool full but codex pool available for task_type=${nextType} location=${nextTask?.location}`);
            xianBypass = true;
          }
        } catch (bypassErr) {
          console.warn(`[tick] xian bypass check failed (non-fatal): ${bypassErr.message}`);
        }
      }
      if (!xianBypass) {
        const slotReason = slotBudget.user.mode === 'team' ? 'user_team_mode' :
                           slotBudget.taskPool.budget === 0 ? 'pool_exhausted' : 'pool_c_full';
        tickLog(`[tick] dispatch 停止: ${slotReason}（slot budget 不足，本 tick 不派发）`);
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
  //    If pre-flight fails, skip that task and try the next candidate (max 5 retries).
  //    HOL fix: non-P0 codex tasks blocked by full pool → release claim, skip, try next.
  //    HOL fix (issue 0014cd42): no_executor（bridge 不可用）也跳过该候选试下一个，
  //    防止队头一个需要 bridge 的任务把不需要 bridge 的 harness_initiative 堵死。
  //    Max MAX_SKIP_HEAD_FOR_BLOCKED HOL skips before giving up.
  const MAX_PRE_FLIGHT_RETRIES = 5;
  const MAX_SKIP_HEAD_FOR_BLOCKED = 10;
  const preFlightFailedIds = [];
  const holSkipIds = [];        // IDs skipped due to HOL blocking (codex pool full, non-P0)
  const noExecutorSkipIds = []; // IDs skipped due to executor/bridge unavailable (0014cd42)
  const duplicateSkipIds = []; // IDs skipped due to duplicate-title sibling already queued/in_progress
  let nextTask = null;

  const { preFlightCheck, alertOnPreFlightFail } = await import('./pre-flight-check.js');
  const claimerId = process.env.BRAIN_RUNNER_ID || `brain-tick-${process.pid}`;

  // C1 fix (fabf6bd6): claim 成功后到 triggerCeceliaRun 判定之间任何未预期异常都会让 task 永久卡在
  // claimed_by 已设 + status=in_progress（graph 从未真正 invoke）。统一兜底释放 claim + 标 failed，
  // 绝不 rethrow — dispatcher 调用方（tick-runner.js）没有包 try/catch。
  const postClaimException = async (err) => {
    console.error(`[dispatch] unexpected exception after claim, task=${nextTask?.id}: ${err.message}`);
    if (nextTask?.id) {
      try {
        await pool.query(
          `UPDATE tasks SET claimed_by = NULL, claimed_at = NULL WHERE id = $1`,
          [nextTask.id]
        );
        await pool.query(
          `UPDATE tasks SET status = 'failed', error_message = $2 WHERE id = $1`,
          [nextTask.id, String(err.message || 'dispatch_exception').slice(0, 500)]
        );
      } catch (cleanupErr) {
        console.error(`[dispatch] claim-leak cleanup failed (task=${nextTask.id}): ${cleanupErr.message}`);
      }
    }
    await recordDispatchResult(pool, false, 'dispatch_exception', undefined, nextTask?.id || null);
    return { dispatched: false, reason: 'dispatch_exception', task_id: nextTask?.id, error: err.message, actions };
  };

  // HOL fix (0014cd42)：外层循环把「claim 之后的 executor 可用性检查」纳入候选重选——
  // no_executor 时 revert + 记入 noExecutorSkipIds，回来选下一个候选，而不是整个 tick 直接放弃。
  // circuit_breaker / cortex / retired / harness 并发上限等分支保持原「直接 return 让位」语义不变。
  dispatchLoop: for (;;) {
  nextTask = null;
  for (let attempt = 0; attempt <= MAX_PRE_FLIGHT_RETRIES; attempt++) {
    const skipIds = [...preFlightFailedIds, ...holSkipIds, ...noExecutorSkipIds, ...duplicateSkipIds];
    const candidate = await selectNextDispatchableTask(goalIds, skipIds, { priorityFilter: _quotaPriorityFilter });
    if (!candidate) {
      if (noExecutorSkipIds.length > 0) {
        // 全部剩余候选都因 executor 不可用被跳过 → 最终结论仍是 no_executor（与修复前一致）
        tickLog(`[tick] no_executor: 已跳过 ${noExecutorSkipIds.length} 个候选后队列耗尽，本 tick 放弃派发`);
        return { dispatched: false, reason: 'no_executor', no_executor_skipped: noExecutorSkipIds.length, actions };
      }
      return { dispatched: false, reason: 'no_dispatchable_task', actions };
    }

    // 3a. Check if task requires Cortex processing (Brain-internal RCA)
    if (candidate.payload && candidate.payload.requires_cortex === true) {
      return await processCortexTask(candidate, actions);
    }

    // 3b. Pre-flight Check — validate task quality before dispatch
    const checkResult = await preFlightCheck(candidate);
    if (!checkResult.passed) {
      const currentStrikes = (candidate.metadata?.pre_flight_fail_count ?? 0);
      const newStrikes = currentStrikes + 1;
      const PRE_FLIGHT_MAX_STRIKES = 3;

      console.warn(`[dispatch] Pre-flight check failed for task ${candidate.id} (strike ${newStrikes}/${PRE_FLIGHT_MAX_STRIKES}):`, checkResult.issues);

      if (newStrikes >= PRE_FLIGHT_MAX_STRIKES) {
        // 三振出局：置 blocked，告警一次后因 blocked 不再入候选，自然止血
        const blockedDetail = {
          issues: checkResult.issues,
          suggestions: checkResult.suggestions,
          strikes: newStrikes,
        };
        await pool.query(
          `UPDATE tasks
           SET status = 'blocked',
               blocked_reason = 'pre_flight_rejected',
               blocked_at = NOW(),
               blocked_detail = $2::jsonb,
               metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb
           WHERE id = $1`,
          [
            candidate.id,
            JSON.stringify(blockedDetail),
            JSON.stringify({ pre_flight_fail_count: newStrikes, pre_flight_issues: checkResult.issues }),
          ]
        );
        await alertOnPreFlightFail(pool, candidate, { ...checkResult, strikes: newStrikes, blocked: true });
      } else {
        // 尚未三振：累加计数，继续跳过
        await pool.query(
          `UPDATE tasks SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
          [candidate.id, JSON.stringify({
            pre_flight_fail_count: newStrikes,
            pre_flight_failed: true,
            pre_flight_issues: checkResult.issues,
            pre_flight_suggestions: checkResult.suggestions,
            failed_at: new Date().toISOString()
          })]
        );
        await alertOnPreFlightFail(pool, candidate, checkResult);
      }

      await recordDispatchResult(pool, false, 'pre_flight_check_failed');
      preFlightFailedIds.push(candidate.id);
      continue;
    }

    // 3a'. 派发前语义查重（P1 6fc3bfe8 刀1）：同 task_type 时间窗口内标题高度相似的
    //      sibling 已 queued/in_progress → 大概率是同一件事被独立创建了两个 task 行，
    //      跳过本候选，让已在办的那个继续走，避免重复派发出两个几乎相同的 PR。
    const duplicateSibling = await _internals_findDuplicateTaskSibling(candidate);
    if (duplicateSibling) {
      tickLog(`[dispatch] task ${candidate.id} 与 sibling ${duplicateSibling.id} 标题高度相似，判定重复，跳过: ${candidate.title}`);
      await recordDispatchResult(pool, false, 'duplicate_task_title_match');
      duplicateSkipIds.push(candidate.id);
      // 与下方 HOL skip（line ~602 "HOL skip does not count against pre-flight attempt limit"）
      // 同类语义：候选本身没问题，只是暂不该选它，换下一个——不应消耗 pre-flight attempt
      // 预算，否则排在重复候选后面的合法候选可能被 all_candidates_failed_pre_flight 误判放弃。
      // 但和 HOL/no-executor 一样需要硬上限：异常场景下（如批量重复创建）单 tick 内
      // 判重命中可能连续很多个，每个都要多一次 DB round-trip，无上限会拖长单 tick 耗时。
      if (duplicateSkipIds.length >= MAX_SKIP_HEAD_FOR_BLOCKED) {
        tickLog(`[dispatch] duplicate skip cap reached (${MAX_SKIP_HEAD_FOR_BLOCKED}), giving up this tick`);
        await recordDispatchResult(pool, false, 'duplicate_skip_cap_exceeded');
        return { dispatched: false, reason: 'duplicate_skip_cap_exceeded', duplicate_skipped: duplicateSkipIds.length, actions };
      }
      attempt--;
      continue;
    }

    // 3b'. Retired harness task_types — 不需要 executor，直接标 terminal_failure。
    //      必须放在 checkCeceliaRunAvailable 之前，否则在 cecelia-bridge 不可用的环境
    //      （CI / brain-only deploy）retired task 永远 revert 回 queued。
    if (_RETIRED_HARNESS_TYPES_DISPATCH.has(candidate.task_type)) {
      tickLog(`[dispatch] retired task_type=${candidate.task_type} task=${candidate.id} → marking pipeline_terminal_failure`);
      try {
        await pool.query(
          `UPDATE tasks SET status='failed', completed_at=NOW(),
            error_message=$2,
            payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object('failure_class', 'pipeline_terminal_failure')
           WHERE id=$1::uuid`,
          [candidate.id, `task_type ${candidate.task_type} retired (subsumed by harness_initiative full graph)`]
        );
      } catch (err) {
        console.error(`[dispatch] mark retired task failed: ${err.message}`);
      }
      await recordDispatchResult(pool, false, 'retired_task_type');
      actions.push({
        action: 'retire-task',
        task_id: candidate.id,
        title: candidate.title,
        task_type: candidate.task_type,
      });
      return { dispatched: false, reason: 'retired_task_type', task_id: candidate.id, task_type: candidate.task_type, retired: true, actions };
    }

    // 3b''. harness admission —— 判定收归 slot-allocator（beeba317）。
    //       放在原子 claim 之前 → 被拒时无需释放 claim；拒发直接 return 让位下一 tick。
    if (shouldApplyHarnessCap(candidate)) {
      // 任务数纯兜底：docker 层全瞎时防无限叠加（正常永不触发）
      const capRes = await pool.query(
        `SELECT count(*)::int AS n FROM tasks
           WHERE task_type IN ('harness_initiative', 'golden_path_proposal')
             AND status = 'in_progress'
             AND id != $1`,
        [candidate.id]
      );
      const running = capRes.rows[0]?.n ?? 0;
      if (running >= HARNESS_TASK_CAP_BACKSTOP) {
        tickLog(`[dispatch] harness 任务数兜底 ${running}/${HARNESS_TASK_CAP_BACKSTOP}，延后派发 ${candidate.id}`);
        await recordDispatchResult(pool, false, 'task_cap_backstop');
        return { dispatched: false, reason: 'task_cap_backstop', running, task_id: candidate.id, actions };
      }

      const slotCheck = await harnessSlotCheck({ candidate });
      const capStr = slotCheck.cap
        ? `${slotCheck.cap.effective}(mem=${slotCheck.cap.mem_cap} acct=${slotCheck.cap.acct_cap} hard=${slotCheck.cap.hard_cap})`
        : 'n/a';
      tickLog(`[dispatch] slot_check containers=${slotCheck.containers} inflight=${slotCheck.inflight} cap=${capStr} stale=${slotCheck.stale} verdict=${slotCheck.allow ? 'allow' : `deny:${slotCheck.reason}`}`);
      if (!slotCheck.allow) {
        await recordDispatchResult(pool, false, slotCheck.reason);
        return { dispatched: false, reason: slotCheck.reason, slot_check: slotCheck, task_id: candidate.id, actions };
      }
    }

    // 3c. Initiative-level lock: 仅对 harness pipeline 类型生效，且只查同 project 的 harness blocker。
    //     dev / talk / audit 等通用任务不进入这条分支，避免单 project 死锁（bb245cb4 教训）。
    if (candidate.project_id && INITIATIVE_LOCK_TASK_TYPES.includes(candidate.task_type)) {
      const lockCheck = await pool.query(
        `SELECT id, title FROM tasks
         WHERE project_id = $1
           AND status = 'in_progress'
           AND task_type = ANY($3::text[])
           AND id != $2
         LIMIT 1`,
        [candidate.project_id, candidate.id, INITIATIVE_LOCK_TASK_TYPES]
      );
      if (lockCheck.rows.length > 0) {
        const blocker = lockCheck.rows[0];
        tickLog(`[dispatch] Initiative 已有进行中 harness 任务 (task_id: ${blocker.id})，跳过派发: ${candidate.title}`);
        await recordDispatchResult(pool, false, 'initiative_locked');
        return { dispatched: false, reason: 'initiative_locked', blocking_task_id: blocker.id, task_id: candidate.id, actions };
      }
    }

    // 3c'. C1 Atomic claim: 确保没被其他 runner（如外部 autonomous agent）抢先 claim
    //      放在 pre-flight / initiative lock 之后、mark in_progress 之前，
    //      让 UPDATE...WHERE claimed_by IS NULL 的原子性承担"同一 task 只能派给一个 runner"的保证。
    const claimResult = await pool.query(
      `UPDATE tasks SET claimed_by = $1, claimed_at = NOW()
       WHERE id = $2 AND claimed_by IS NULL
       RETURNING id`,
      [claimerId, candidate.id]
    );
    if (claimResult.rows.length === 0) {
      tickLog(`[dispatch] task ${candidate.id} already claimed by another runner, skipping`);
      await recordDispatchResult(pool, false, 'already_claimed');
      return { dispatched: false, reason: 'already_claimed', task_id: candidate.id, actions };
    }

    // 3c''. S2 锚点执法闸（MJ5 刀2）：新任务点火前校验 payload.anchor
    // 缺锚 → terminal failed（reason=missing_anchor），与 invalid_gear 同级处理形态。
    // 豁免：系统例行 task_type / 特殊 action / 存量任务（刀2上线前创建）。
    const anchorResult = checkAnchor(candidate);
    if (anchorResult.blocked) {
      tickLog(`[dispatch] task ${candidate.id} missing_anchor → terminal failed`);
      try {
        await pool.query(
          `UPDATE tasks SET status='failed', completed_at=NOW(),
            error_message=$2,
            payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object('failure_class', 'missing_anchor')
           WHERE id=$1::uuid`,
          [candidate.id, anchorResult.detail]
        );
      } catch (anchorMarkErr) {
        console.error(`[dispatch] anchor mark failed (non-fatal): ${anchorMarkErr.message}`);
      }
      await recordDispatchResult(pool, false, 'missing_anchor', undefined, candidate.id);
      return { dispatched: false, reason: 'missing_anchor', task_id: candidate.id, actions };
    }

    // 3d. Codex Pool D: check concurrent limit for Codex-native task types.
    //     HOL fix: non-P0 codex tasks blocked by full pool → release claim, skip, try next.
    //     P0 tasks stop the loop immediately (high-priority signal must not be bypassed).
    const budgetState = slotBudget?.budgetState?.state || 'abundant';
    if (!llmCapacitySnapshot && (candidate.task_type === 'dev' || candidate.task_type === 'harness_initiative')) {
      try {
        llmCapacitySnapshot = await getLlmCapacitySnapshot();
      } catch (err) {
        console.warn(`[dispatch] llm capacity snapshot failed (non-fatal): ${err.message}`);
      }
    }
    const guidedCandidate = applyDispatchAllocationGuide(candidate, { budgetState, llmCapacity: llmCapacitySnapshot }).task;
    const isCodexNativeTask = candidate.task_type === 'codex_qa'
      || candidate.task_type === 'codex_dev'
      || candidate.task_type === 'codex_test_gen'
      || guidedCandidate?.payload?.executor === 'codex';
    if (isCodexNativeTask) {
      const codexSlots = slotBudget?.codex;
      if (codexSlots && !codexSlots.available) {
        if (candidate.priority === 'P0') {
          // P0 blocked: stop immediately — do not bypass P0 HOL signal
          tickLog(`[dispatch] Codex pool full (${codexSlots.running}/${codexSlots.max}), P0 codex task ${candidate.id} stops dispatch`);
          await pool.query(
            `UPDATE tasks SET claimed_by = NULL, claimed_at = NULL WHERE id = $1`,
            [candidate.id]
          );
          await recordDispatchResult(pool, false, 'codex_pool_full', undefined, candidate.id);
          return { dispatched: false, reason: 'codex_pool_full', codex_running: codexSlots.running, codex_max: codexSlots.max, task_id: candidate.id, actions };
        }

        // Non-P0: HOL skip — release claim, add to holSkipIds, retry with next candidate
        tickLog(`[dispatch] HOL skip: codex pool full (${codexSlots.running}/${codexSlots.max}), skipping ${candidate.priority} codex task ${candidate.id} (skip ${holSkipIds.length + 1}/${MAX_SKIP_HEAD_FOR_BLOCKED})`);
        await pool.query(
          `UPDATE tasks SET claimed_by = NULL, claimed_at = NULL WHERE id = $1`,
          [candidate.id]
        );
        holSkipIds.push(candidate.id);

        if (holSkipIds.length >= MAX_SKIP_HEAD_FOR_BLOCKED) {
          tickLog(`[dispatch] HOL skip cap reached (${MAX_SKIP_HEAD_FOR_BLOCKED}), giving up`);
          await recordDispatchResult(pool, false, 'hol_skip_cap_exceeded');
          return { dispatched: false, reason: 'hol_skip_cap_exceeded', hol_skipped: holSkipIds.length, actions };
        }
        // HOL skip does not count against pre-flight attempt limit
        attempt--;
        continue;
      }
    }

    // Passed all checks — this is the task to dispatch
    nextTask = guidedCandidate;
    break;
  }

  if (!nextTask) {
    return { dispatched: false, reason: 'all_candidates_failed_pre_flight', skipped: preFlightFailedIds.length, actions };
  }

  // 4. Update task status to in_progress + 5. executor 可用性检查
  //    （claim 已持有，任何未预期异常走 postClaimException 兜底）
  try {
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
  // harness_initiative 走 Docker spawn 路径，完全不依赖 cecelia-bridge。
  // 跳过 bridge check，否则 bridge 不在时 harness 会被错误 revert 到 queued。
  const needsBridgeCheck = nextTask.task_type !== 'harness_initiative'
    && nextTask.task_type !== 'golden_path_proposal';

  // Circuit breaker — 只对依赖 cecelia-bridge 的任务生效（harness_initiative 豁免）
  // 注意：此检查在 atomic claim 和 mark in_progress 之后，
  //       所以拦截时必须回滚 task 状态和 claim。
  if (needsBridgeCheck && !isAllowed('cecelia-run')) {
    await updateTask({ task_id: nextTask.id, status: 'queued' });
    await pool.query('UPDATE tasks SET claimed_by = NULL, claimed_at = NULL WHERE id = $1', [nextTask.id]);
    await recordDispatchResult(pool, false, 'circuit_breaker_open', undefined, nextTask.id);
    return { dispatched: false, reason: 'circuit_breaker_open', actions };
  }

  const ceceliaAvailable = needsBridgeCheck
    ? await checkCeceliaRunAvailable()
    : { available: true };
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
    await recordDispatchResult(pool, false, 'no_executor', undefined, nextTask.id);

    // HOL fix (0014cd42)：不再整个 tick 直接 return 放弃——把该候选记入跳过列表，
    // 回到候选选择循环选下一个（如豁免 bridge 的 harness_initiative）。
    noExecutorSkipIds.push(nextTask.id);
    if (noExecutorSkipIds.length >= MAX_SKIP_HEAD_FOR_BLOCKED) {
      tickLog(`[tick] no_executor: 跳过数达上限 (${MAX_SKIP_HEAD_FOR_BLOCKED})，本 tick 放弃派发`);
      return { dispatched: false, reason: 'no_executor', task_id: nextTask.id, no_executor_skipped: noExecutorSkipIds.length, actions };
    }
    tickLog(`[tick] no_executor: task=${String(nextTask.id).slice(0, 8)} (${ceceliaAvailable.error || 'executor unavailable'}) 跳过，试下一候选`);
    continue dispatchLoop;
  }
  } catch (err) {
    return await postClaimException(err);
  }

  // 通过全部 executor 检查 → 跳出外层循环，派发 nextTask
  break;
  } // dispatchLoop

  // 6. 真正派发（claim 已持有；任何未预期异常仍走 postClaimException 兜底）
  let execResult;
  try {
  const fullTaskResult = await pool.query('SELECT * FROM tasks WHERE id = $1', [nextTask.id]);
  if (fullTaskResult.rows.length === 0) {
    await recordDispatchResult(pool, false, 'task_not_found', undefined, nextTask.id);
    return { dispatched: false, reason: 'task_not_found', task_id: nextTask.id, actions };
  }

  let taskToDispatch = fullTaskResult.rows[0];
  try {
    const budgetState = slotBudget?.budgetState?.state || 'abundant';
    if (!llmCapacitySnapshot && (taskToDispatch.task_type === 'dev' || taskToDispatch.task_type === 'harness_initiative')) {
      try {
        llmCapacitySnapshot = await getLlmCapacitySnapshot();
      } catch (err) {
        console.warn(`[dispatch] llm capacity snapshot failed (non-fatal): ${err.message}`);
      }
    }
    const guided = applyDispatchAllocationGuide(taskToDispatch, { budgetState, llmCapacity: llmCapacitySnapshot });
    taskToDispatch = guided.task;
    if (guided.changed && guided.payloadPatch) {
      if (guided.payloadPatch.executor === 'codex') {
        // 顶层 provider 与 payload.executor 同步写（PR#4155 保护：尚不能排除存量读方）
        taskToDispatch = { ...taskToDispatch, provider: 'codex' };
        tickLog(`[dispatch] allocation_guide task=${taskToDispatch.id} type=${taskToDispatch.task_type} budget_state=${budgetState} → executor=codex`);
      } else if (guided.payloadPatch.executor === 'grok') {
        taskToDispatch = { ...taskToDispatch, provider: 'grok' };
        tickLog(`[dispatch] allocation_guide task=${taskToDispatch.id} type=${taskToDispatch.task_type} budget_state=${budgetState} → executor=grok`);
      }
      try {
        await pool.query(
          `UPDATE tasks
             SET payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb,
                 updated_at = NOW()
           WHERE id = $1`,
          [taskToDispatch.id, JSON.stringify(guided.payloadPatch)]
        );
      } catch (persistErr) {
        console.warn(`[dispatch] allocation guide payload persist failed (non-fatal): ${persistErr.message}`);
      }
    }
  } catch (err) {
    console.warn(`[dispatch] allocation guide failed: ${err.message}, proceeding with original executor`);
  }

  execResult = await triggerCeceliaRun(taskToDispatch);

  // 5a. Check if executor actually succeeded — revert to queued if not
  if (!execResult.success) {
    console.warn(`[dispatch] triggerCeceliaRun failed for task ${nextTask.id}: ${execResult.error || execResult.reason}`);
    // fail-closed 回执（task 94ee0ec4）：claim 后 spawn 失败必须留 task_events 行，
    // 杜绝零留痕（写失败仅告警不阻断，任务仍回 queued 可重试）。
    await recordTaskEventSafe(pool, nextTask.id, 'failed_dispatch', {
      reason: execResult.reason || 'executor_failed',
      error: String(execResult.error || '').slice(0, 300) || null,
      config_error: !!execResult.configError,
    });
    await updateTask({ task_id: nextTask.id, status: 'queued' });
    // fabf6bd6: 必须同时释放 claim，否则 status=queued 但 claimed_by 仍设，atomic claim
    // 的 `WHERE claimed_by IS NULL` 永远选不中这个 task，等于换了个状态的同款死锁。
    await pool.query(
      `UPDATE tasks SET claimed_by = NULL, claimed_at = NULL WHERE id = $1`,
      [nextTask.id]
    );
    // configError 表示系统配置错误（如容器漏装 codex CLI），不属于运行时执行失败，
    // 不应累积 cecelia-run breaker（否则配置漂移会 trip breaker 阻断所有 dispatch）。
    // spawn_deduplicated 是 DB 级去重命中（良性防重入，跨进程/跨重启防双 spawn），
    // 不是执行故障，同样不应计入熔断（否则抖动期的正常去重会误停派全系统）。
    if (execResult.configError) {
      console.warn(`[dispatch] configError detected (reason=${execResult.reason}) — skipping cecelia-run breaker count`);
    } else if (execResult.reason === 'spawn_deduplicated') {
      console.warn(`[dispatch] spawn_deduplicated detected — skipping cecelia-run breaker count`);
    } else {
      await recordFailure('cecelia-run');

      // dispatch-fail-autoblock：连续失败计数 + 自动隔离
      // configError / spawn_deduplicated 已在上方 early-return，此处只处理真实执行失败。
      try {
        const metaRow = await pool.query(
          `SELECT metadata FROM tasks WHERE id = $1`,
          [nextTask.id]
        );
        const currentMeta = metaRow.rows[0]?.metadata || {};
        const prevCount = currentMeta.dispatch_fail_consecutive ?? 0;
        const newCount = prevCount + 1;

        await pool.query(
          `UPDATE tasks SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('dispatch_fail_consecutive', $2::int) WHERE id = $1`,
          [nextTask.id, newCount]
        );

        if (newCount >= DISPATCH_FAIL_AUTOBLOCK_THRESHOLD) {
          console.warn(`[dispatch] task ${nextTask.id} hit dispatch_fail_autoblock threshold (${newCount}/${DISPATCH_FAIL_AUTOBLOCK_THRESHOLD}), blocking task`);
          try {
            await blockTask(nextTask.id, {
              reason: 'dispatch_fail_autoblock',
              detail: {
                consecutive_failures: newCount,
                last_error: String(execResult.error || execResult.reason || 'executor_failed'),
                blocked_at_tick: new Date().toISOString(),
              },
            });
          } catch (blockErr) {
            console.error(`[dispatch] blockTask failed for task ${nextTask.id}: ${blockErr.message}`);
          }
          try {
            await raise('P2', 'dispatch_fail_autoblock', `task ${nextTask.id} blocked after ${newCount} consecutive dispatch failures`);
          } catch (raiseErr) {
            console.error(`[dispatch] raise failed for dispatch_fail_autoblock (task ${nextTask.id}): ${raiseErr.message}`);
          }
        }
      } catch (autoblockErr) {
        console.warn(`[dispatch] dispatch-fail-autoblock counter update failed (task ${nextTask.id}) (non-fatal): ${autoblockErr.message}`);
      }
    }
    await logTickDecision(
      'tick',
      `Executor failed, task reverted to queued: ${execResult.error || execResult.reason}`,
      { action: 'executor_failed', task_id: nextTask.id, reason: execResult.reason, error: execResult.error, configError: !!execResult.configError },
      { success: false }
    );
    await recordDispatchResult(pool, false, execResult.configError ? 'config_error' : 'executor_failed', undefined, nextTask.id);
    return { dispatched: false, reason: execResult.configError ? 'config_error' : 'executor_failed', task_id: nextTask.id, error: execResult.error || execResult.reason, configError: !!execResult.configError, actions };
  }
  } catch (err) {
    return await postClaimException(err);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // triggerCeceliaRun 已经 success=true → task 已真正派发出去（进程/graph 已 spawn）。
  // 下面全是"事后记账"（事件广播/working_memory/日志/统计），任何一步失败都绝不能
  // 触发释放 claim / 标 failed（否则下个 tick 会把已经在跑的同一个 task 重新派发一次，
  // 造成重复执行 —— 比修复前的死锁问题更糟）。只记日志，吞掉异常。
  // ─────────────────────────────────────────────────────────────────────────

  // dispatch-fail-autoblock：派发成功 → 重置 dispatch_fail_consecutive 计数
  // 放在 bookkeeping 块之前，与 setupSuccessQuerySequence 的 query 序列对齐。
  try {
    const metaRowSuccess = await pool.query(
      `SELECT metadata FROM tasks WHERE id = $1`,
      [nextTask.id]
    );
    const successMeta = metaRowSuccess.rows[0]?.metadata || {};
    const prevFailCount = successMeta.dispatch_fail_consecutive ?? 0;
    if (prevFailCount > 0) {
      await pool.query(
        `UPDATE tasks SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb WHERE id = $2 -- dispatch_fail_consecutive reset`,
        [{ dispatch_fail_consecutive: 0 }, nextTask.id]
      );
      tickLog(`[dispatch] task ${nextTask.id} dispatch succeeded, reset dispatch_fail_consecutive from ${prevFailCount} to 0`);
    }
  } catch (resetErr) {
    console.error(`[dispatch] dispatch-fail-autoblock reset failed (non-fatal): ${resetErr.message}`);
  }

  try {
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
  } catch (bookkeepingErr) {
    // 事后记账失败：task 已经真实派发成功，绝不能释放 claim / 标 failed，只记日志。
    console.error(`[dispatch] post-success bookkeeping failed for task=${nextTask.id} (dispatch itself succeeded, claim NOT released): ${bookkeepingErr.message}`);
  }

  // Wave-2 断链修复：派发成功计入当日 actions（fire-and-forget，吞错）
  incrementActionsToday(1).catch(() => {});
  return { dispatched: true, task_id: nextTask.id, run_id: execResult.runId, actions };
}
