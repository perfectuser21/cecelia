/**
 * counters.js —— 从决策日志行 + 外部产物快照推导各计数/streak（纯函数）。
 *
 * 语义 SSOT：docs/superpowers/specs/2026-07-04-orchestrator-skeleton-design.md §关键设计决策 5。
 * streak 清零语义出处：routing-extraction.md（gan.graph.js:94-103——push 成功/拿到 verdict 即清零，
 * "连续性"计数而非累计计数）。
 * 确定性纪律：禁 Date.now/Math.random/new Date；不产生任何 IO。
 *
 * 入参：
 *   logRows —— orchestrator_decision_log 行数组 [{hop, action, observed, ...}]，可乱序/含防御性重复 hop
 *   proposeBranchMaxRn —— propose 分支现查的最大 rN（外部真相，ganRound 唯一权威）
 *
 * 计数语义：
 *   hops       = 去重后的行数（同 hop 不重复计——崩溃重放窗口防御，UNIQUE 正常场景已挡）
 *   fixRound   = 只计产生新 SHA 的有效 product fix（spawn:generator-fix + callback pr_head_sha !== trigger_sha）
 *                Sprint 07231527：语义修正，同 SHA no-progress 不递增 fixRound；
 *                fixRound 仅保留为观测指标，不再承担终止判据。
 *   ganRound   = proposeBranchMaxRn（权威）；COUNT(action='spawn:proposer') 仅交叉校验，不一致取分支值
 *   noPushStreak    = 尾部连续的已启动、成功终态 proposer Attempt 中未推进提案分支的个数；
 *                     未启动/未 callback/失败终态 intent 保守断开不计
 *   noVerdictStreak = 同理，已启动、成功终态 reviewer Attempt 必须有同 attempt verdict 行
 *   crossCheckMismatch = proposerCount !== proposeBranchMaxRn（崩溃窗口漏记 / 记了没派的交叉校验信号，
 *                        loop 把它写进 appendHop detail 供回放排障）
 *   pollCount  = 从 decision log 推导：最后一次非 wait:poll_ci action 后的 wait:poll_ci 行数（持久化）
 *   blockedStreak = 从 decision log 推导：尾部连续且 failure_class 相同的
 *                   gate_verdict=deny:BLOCKED 行数
 *   noProgress = 最新 spawn:generator-fix 的 trigger_sha === verdict:generator-fix-callback 的 pr_head_sha；
 *                例外（b19e6e6e 实证）：该 fix 轮由基础设施故障触发
 *                （intent.observed.failure_class === 'infrastructure_blocked'）且回调 status 为
 *                completed / completed_with_concerns 时，SHA 不变是正确行为，不判 no-progress。
 *   noProgressReason = 'no_progress_same_sha' | null
 */
import { ACTION, LOG_ACTION } from './constants.js';
import {
  failureSetKey,
  normalizeFailureSet,
} from './convergence-signatures.js';

/** jsonb 列兼容：pg 返回对象，测试/fake 可能是 JSON 字符串 */
function asJson(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return null; }
  }
  return value;
}

function sortedUniqueRows(logRows) {
  const seen = new Set();
  return [...logRows]
    .sort((a, b) => Number(a.hop) - Number(b.hop))
    .filter((row) => {
      if (seen.has(row.hop)) return false;
      seen.add(row.hop);
      return true;
    });
}

function isProductFixIntent(row) {
  if (row.action !== ACTION.SPAWN_GENERATOR_FIX) return false;
  const observed = asJson(row.observed) ?? {};
  const detail = asJson(row.detail) ?? {};
  return observed.failure_class === 'product_failure'
    || (observed.failure_class == null && detail.reason === 'ci_fail');
}

function dispatchDidNotExecute(rows, intent) {
  return rows.some((row) => {
    if (row.action !== LOG_ACTION.DISPATCH_RESULT) return false;
    const detail = asJson(row.detail) ?? {};
    return Number(detail.dispatch_hop) === Number(intent.hop)
      && ['BLOCKED', 'NEEDS_CONTEXT'].includes(detail.status);
  });
}

function callbackForIntentFromRows(rows, callbacks, intent, nextIntent) {
  return callbacks.find((callback) => {
    const callbackObserved = asJson(callback.observed) ?? {};
    if (Number(callbackObserved.trigger_hop) === Number(intent.hop)) return true;
    if (callbackObserved.trigger_hop != null) return false;
    return Number(callback.hop) > Number(intent.hop)
      && (nextIntent == null || Number(callback.hop) < Number(nextIntent.hop));
  }) ?? null;
}

function approvalForRequest(rows, request) {
  const requestObserved = asJson(request.observed) ?? {};
  const requestHeadSha = requestObserved.pr?.head_sha ?? null;
  return rows.find((row) => {
    if (row.action !== LOG_ACTION.VERDICT_HUMAN_REVIEW) return false;
    const detail = asJson(row.detail) ?? {};
    return Number(row.hop) > Number(request.hop)
      && detail.approved === true
      && detail.pr_head_sha === requestHeadSha
      && String(detail.review_request_hop) === String(request.hop);
  }) ?? null;
}

/**
 * Replay product-fix convergence directly from the append-only decision log.
 * No natural-language fields are inspected. Old rows without explicit
 * trigger/status/set fields are ignored rather than promoted to progress.
 */
export function replayProductConvergence(
  logRows,
  { currentFailureSet, currentHeadSha, historicalFailureSets = [] },
) {
  if (!Array.isArray(logRows)) {
    throw new Error('replayProductConvergence: logRows must be an array');
  }
  const allRows = sortedUniqueRows(logRows);
  // reopen_gan_contract = 纪元切换(r43 实证):合同重开后旧产品修复周期整体作废,
  // 收敛守卫只看重开之后的行——否则会拿着重开前 blocked 的 fix intent 追讨一个
  // 永远不会来的回调,两拍后误杀 run(generator_fix_callback_missing_after_observation)。
  const latestReopenHop = allRows.reduce(
    (max, r) => (r.action === ACTION.REOPEN_GAN_CONTRACT && Number(r.hop) > max ? Number(r.hop) : max),
    -1,
  );
  const rows = latestReopenHop === -1
    ? allRows
    : allRows.filter((r) => Number(r.hop) > latestReopenHop);
  const intents = rows.filter(isProductFixIntent);
  const callbacks = rows.filter(
    (row) => row.action === LOG_ACTION.VERDICT_GENERATOR_FIX_CALLBACK,
  );
  const modernIntents = intents.filter((intent) => {
    const observed = asJson(intent.observed) ?? {};
    return typeof observed.trigger_sha === 'string'
      && observed.trigger_sha.length > 0
      && !dispatchDidNotExecute(rows, intent);
  });
  const completed = [];
  let latestMissingCallback = false;
  let latestMissingCallbackObserved = false;
  let pendingReason = null;
  let immediateFailureReason = null;

  for (let index = 0; index < modernIntents.length; index++) {
    const intent = modernIntents[index];
    const observed = asJson(intent.observed) ?? {};
    const callback = callbackForIntentFromRows(
      rows,
      callbacks,
      intent,
      modernIntents[index + 1],
    );
    if (!callback) {
      // 终局的 attempt 回调 = 已答(r43 二次实证):fix attempt 以 blocked/failed/
      // cancelled 终局时走 verdict:attempt_callback(不产生 generator-fix-callback 行),
      // 其出路已被别的路由收编(仲裁/人工/重开)——不是"回调失踪",不追讨。
      const abortedByTerminalAttempt = rows.some((row) => {
        if (row.action !== LOG_ACTION.ATTEMPT_CALLBACK) return false;
        if (!(Number(row.hop) > Number(intent.hop))) return false;
        if (modernIntents[index + 1] != null
          && !(Number(row.hop) < Number(modernIntents[index + 1].hop))) return false;
        const detail = asJson(row.detail) ?? {};
        return ['blocked', 'failed', 'cancelled'].includes(detail.status);
      });
      if (abortedByTerminalAttempt) continue;
      if (index === modernIntents.length - 1) {
        latestMissingCallback = true;
        latestMissingCallbackObserved = rows.some((row) => (
          row.action === ACTION.WAIT_GENERATOR_FIX_CALLBACK
          && Number(row.hop) > Number(intent.hop)
          && (
            modernIntents[index + 1] == null
            || Number(row.hop) < Number(modernIntents[index + 1].hop)
          )
        ));
      }
      continue;
    }
    const callbackObserved = asJson(callback.observed) ?? {};
    const callbackDetail = asJson(callback.detail) ?? {};
    const verificationStatus = callbackDetail.verification_status ?? null;
    let callbackSha = callbackObserved.pr_head_sha
      ?? callbackDetail.pr_head_sha
      ?? null;
    const legacyVerified = verificationStatus == null;
    if (verificationStatus === 'verification_pending') {
      const claimedSha = callbackDetail.claimed_pr_head_sha ?? null;
      if (currentHeadSha == null) {
        if (index === modernIntents.length - 1) {
          pendingReason = 'callback_sha_verification_pending';
        }
        continue;
      }
      if (
        claimedSha != null
        && claimedSha !== currentHeadSha
        && currentHeadSha === observed.trigger_sha
      ) {
        if (index === modernIntents.length - 1) {
          immediateFailureReason = 'callback_sha_unverified';
        }
        continue;
      }
      callbackSha = currentHeadSha;
    } else if (verificationStatus !== 'verified' && !legacyVerified) {
      if (index === modernIntents.length - 1) {
        immediateFailureReason = callbackDetail.no_progress_reason
          ?? 'callback_sha_unverified';
      }
      continue;
    }
    if (!callbackSha || callbackSha === observed.trigger_sha) {
      if (index === modernIntents.length - 1) {
        immediateFailureReason = 'no_progress_same_sha';
      }
      continue;
    }
    completed.push({
      intent,
      callback,
      callbackSha,
      failureSet: normalizeFailureSet(observed.failure_set),
      failureSetKey: failureSetKey(observed.failure_set),
    });
  }

  const currentSet = normalizeFailureSet(currentFailureSet);
  const currentKey = failureSetKey(currentSet);
  const historicalKeys = new Set(
    (Array.isArray(historicalFailureSets) ? historicalFailureSets : [])
      .map((failureSet) => failureSetKey(failureSet))
      .filter(Boolean),
  );
  const repeatedAcrossRuns = currentKey != null && historicalKeys.has(currentKey);
  const structuredCompleted = completed.filter(
    (round) => round.failureSetKey != null,
  );
  const seenKeys = new Set();
  let historicalMinimum = null;
  let patience = 0;
  for (const round of structuredCompleted) {
    const size = round.failureSet.length;
    if (historicalMinimum == null || size < historicalMinimum) {
      historicalMinimum = size;
      patience = 0;
    } else if (!seenKeys.has(round.failureSetKey)) {
      patience += 1;
    }
    seenKeys.add(round.failureSetKey);
  }

  const reviewReasons = new Set([
    'failure_set_repeated',
    'failure_set_patience_exhausted',
    'failure_set_repeated_across_runs',
  ]);
  const requests = rows.filter((row) => {
    if (row.action !== LOG_ACTION.HUMAN_REVIEW_REQUESTED) return false;
    const detail = asJson(row.detail) ?? {};
    return reviewReasons.has(detail.review_reason)
      && failureSetKey(detail.failure_set) != null;
  });
  const request = requests.at(-1) ?? null;
  const approval = request == null
    ? null
    : approvalForRequest(rows, request);
  const crossRunRequest = [...requests].reverse().find((candidate) => {
    const detail = asJson(candidate.detail) ?? {};
    return failureSetKey(detail.failure_set) === currentKey;
  }) ?? null;
  const crossRunApproval = crossRunRequest == null
    ? null
    : approvalForRequest(rows, crossRunRequest);

  if (immediateFailureReason != null) {
    return { outcome: 'failed', reason: immediateFailureReason };
  }
  if (repeatedAcrossRuns && !crossRunApproval) {
    return {
      outcome: 'review',
      reason: 'failure_set_repeated_across_runs',
      failureSet: currentSet,
      failureSetKey: currentKey,
    };
  }
  if (modernIntents.length === 0) {
    return {
      outcome: 'continue',
      reason: repeatedAcrossRuns
        ? 'failure_set_approved_single_retry'
        : 'first_product_fix',
    };
  }
  if (pendingReason != null) {
    return { outcome: 'pending', reason: pendingReason };
  }
  if (latestMissingCallback) {
    return latestMissingCallbackObserved
      ? {
          outcome: 'failed',
          reason: 'generator_fix_callback_missing_after_observation',
        }
      : {
          outcome: 'pending',
          reason: 'generator_fix_callback_pending',
        };
  }
  const latestCompletedSha = completed.at(-1)?.callbackSha ?? null;
  const latestCompletedTriggerSha = asJson(
    completed.at(-1)?.intent?.observed,
  )?.trigger_sha ?? null;
  if (
    latestCompletedSha != null
    && currentHeadSha != null
    && latestCompletedSha !== currentHeadSha
  ) {
    if (
      latestCompletedTriggerSha != null
      && currentHeadSha !== latestCompletedTriggerSha
    ) {
      return { outcome: 'continue', reason: 'verified_new_sha' };
    }
    return { outcome: 'failed', reason: 'callback_sha_unverified' };
  }

  if (repeatedAcrossRuns && crossRunApproval) {
    return {
      outcome: 'failed',
      reason: 'failure_set_no_progress_after_approval',
    };
  }

  if (approval) {
    const postApprovalIntents = modernIntents.filter(
      (intent) => Number(intent.hop) > Number(approval.hop),
    );
    if (postApprovalIntents.length === 0) {
      return { outcome: 'continue', reason: 'failure_set_approved_single_retry' };
    }

    // The first post-approval intent is the one explicitly unlocked by the
    // approval. A later structured intent proves the one-shot observation
    // already reached a historical low and normal replay may resume.
    const laterStructuredIntent = postApprovalIntents.slice(1).find((intent) => {
      const observed = asJson(intent.observed) ?? {};
      return failureSetKey(observed.failure_set) != null;
    });
    if (!laterStructuredIntent && currentSet != null) {
      const preApprovalSets = modernIntents
        .filter((intent) => Number(intent.hop) < Number(request.hop))
        .map((intent) => normalizeFailureSet((asJson(intent.observed) ?? {}).failure_set))
        .filter(Boolean);
      const preApprovalMinimum = preApprovalSets.length > 0
        ? Math.min(...preApprovalSets.map((set) => set.length))
        : null;
      if (preApprovalMinimum != null && currentSet.length >= preApprovalMinimum) {
        return {
          outcome: 'failed',
          reason: 'failure_set_no_progress_after_approval',
        };
      }
    }
  }

  if (currentSet == null) {
    return { outcome: 'continue', reason: 'verified_new_sha' };
  }
  if (historicalMinimum == null || currentSet.length < historicalMinimum) {
    return { outcome: 'continue', reason: 'failure_set_historical_low' };
  }
  if (seenKeys.has(currentKey)) {
    return {
      outcome: 'review',
      reason: 'failure_set_repeated',
      failureSet: currentSet,
      failureSetKey: currentKey,
    };
  }
  if (patience + 1 >= 3) {
    return {
      outcome: 'review',
      reason: 'failure_set_patience_exhausted',
      failureSet: currentSet,
      failureSetKey: currentKey,
    };
  }
  return { outcome: 'continue', reason: 'failure_set_novel' };
}

const SUCCESSFUL_ROLE_STATUSES = new Set(['completed', 'completed_with_concerns']);

function completedRoleOutcomes(rows, role, currentProposalRn) {
  const action = `spawn:${role}`;
  const intents = rows.filter((candidate) => candidate.action === action);
  return intents.map((intent, index) => {
    const launch = rows.find((candidate) => {
      if (candidate.action !== LOG_ACTION.ATTEMPT_LAUNCHED) return false;
      const detail = asJson(candidate.detail) ?? {};
      return Number(detail.dispatch_hop) === Number(intent.hop)
        && detail.dispatch_action === action
        && typeof detail.attempt_id === 'string'
        && detail.attempt_id.length > 0;
    });
    if (!launch) return null;

    const attemptId = (asJson(launch.detail) ?? {}).attempt_id;
    const callback = rows.find((candidate) => {
      if (candidate.action !== LOG_ACTION.ATTEMPT_CALLBACK) return false;
      const detail = asJson(candidate.detail) ?? {};
      return detail.attempt_id === attemptId && detail.role === role;
    });
    const callbackDetail = asJson(callback?.detail) ?? {};
    if (!callback || !SUCCESSFUL_ROLE_STATUSES.has(callbackDetail.status)) return null;

    if (role === 'reviewer') {
      return rows.some((candidate) => (
        candidate.action === LOG_ACTION.VERDICT_REVIEWER
        && (asJson(candidate.detail) ?? {}).attempt_id === attemptId
      ));
    }

    const before = Number((asJson(intent.observed) ?? {}).proposeBranchRn);
    const laterIntent = intents[index + 1];
    const after = laterIntent == null
      ? currentProposalRn
      : Number((asJson(laterIntent.observed) ?? {}).proposeBranchRn);
    return Number.isFinite(before) && Number.isFinite(after) ? after > before : null;
  });
}

function terminalFalseStreak(outcomes) {
  let streak = 0;
  for (let index = outcomes.length - 1; index >= 0; index--) {
    if (outcomes[index] === false) streak++;
    else break;
  }
  return streak;
}

export function deriveCounters(logRows, options) {
  if (!Array.isArray(logRows)) {
    throw new Error('deriveCounters: logRows must be an array');
  }
  if (!options || typeof options.proposeBranchMaxRn !== 'number') {
    throw new Error('deriveCounters: options.proposeBranchMaxRn (number) is required');
  }
  const { proposeBranchMaxRn } = options;

  // 按 hop 排序 + 同 hop 去重（保留首次出现的行）
  const rows = sortedUniqueRows(logRows);

  // fixRound：只计 callback 证明 SHA 前进的 product fix。
  // intent/崩溃、same-SHA、evidence repair、environment recovery 都不消耗 product fix cap。
  const fixIntents = rows.filter((r) => r.action === ACTION.SPAWN_GENERATOR_FIX);
  const callbacks = rows.filter((r) => r.action === LOG_ACTION.VERDICT_GENERATOR_FIX_CALLBACK);
  const excludedFixClasses = new Set([
    'evidence_invalid',
    'environment_recovery',
    'needs_context',
    'contract_invalid',
    'unknown',
    'infrastructure_blocked',
  ]);
  const callbackForIntent = (intent, nextIntent) => callbackForIntentFromRows(
    rows,
    callbacks,
    intent,
    nextIntent,
  );

  let fixRound = 0;
  for (let i = 0; i < fixIntents.length; i++) {
    const intent = fixIntents[i];
    const intentObs = asJson(intent.observed) ?? {};
    const triggerSha = intentObs.trigger_sha ?? null;
    if (excludedFixClasses.has(intentObs.failure_class)) continue;
    const cb = callbackForIntent(intent, fixIntents[i + 1]);
    if (triggerSha && cb) {
      const cbObs = asJson(cb.observed) ?? {};
      const cbDetail = asJson(cb.detail) ?? {};
      const callbackSha = cbObs.pr_head_sha ?? null;
      if (
        (cbDetail.verification_status === 'verified'
          || cbDetail.verification_status == null)
        && callbackSha
        && callbackSha !== triggerSha
      ) {
        fixRound++;
      }
      continue;
    }

    // Legacy rows before trigger_sha/callback wiring: only the final intent in a
    // consecutive fix burst may claim the immediately following PR snapshot.
    // This preserves replayability without treating an uncompleted modern
    // intent (which always has trigger_sha) as an effective fix.
    if (!Object.hasOwn(intentObs, 'trigger_sha')) {
      const rowIndex = rows.indexOf(intent);
      const nextRow = rows[rowIndex + 1];
      if (nextRow && nextRow.action !== ACTION.SPAWN_GENERATOR_FIX) {
        const beforeSha = intentObs.pr?.head_sha ?? null;
        const afterSha = (asJson(nextRow.observed) ?? {}).pr?.head_sha ?? null;
        if (afterSha && afterSha !== beforeSha) fixRound++;
      }
    }
  }

  // ganRound：分支 rN 是唯一权威（外部真相）；proposer intent COUNT 只作交叉校验，
  // 不一致（崩溃窗口漏记 / 记了没派）一律取分支值，mismatch 信号由 loop 写进 appendHop detail。
  const proposerCount = rows.filter((r) => r.action === ACTION.SPAWN_PROPOSER).length;
  const ganRound = proposeBranchMaxRn;
  const proposerOutcomes = completedRoleOutcomes(rows, 'proposer', proposeBranchMaxRn);
  const reviewerOutcomes = completedRoleOutcomes(rows, 'reviewer', proposeBranchMaxRn);

  // pollCount：从 decision log 推导，重启后不归零（Sprint 07231527 Blocking 2）
  // 语义：最后一次非 wait:poll_ci action 后的 wait:poll_ci 行数（连续 poll 环计数）
  let pollCount = 0;
  {
    let counting = true;
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      if (r.action === ACTION.WAIT_POLL_CI) {
        if (counting) pollCount++;
      } else {
        // 遇到非 poll action → 重置起点（该 action 之前的 poll 不算当前轮次）
        break;
      }
    }
  }

  // blockedStreak：从 append-only dispatch result 推导。
  // 每个 BLOCKED/NEEDS_CONTEXT result 紧跟对应 intent；扫描时跳过这条配对 intent，
  // 但遇到任何其他行即断开，保证 DONE 后不会沿用旧 streak。
  let blockedStreak = 0;
  let blockedStatus = null;
  let blockedFailureClass = null;
  for (let i = rows.length - 1; i >= 0;) {
    const resultRow = rows[i];
    if (resultRow.action !== LOG_ACTION.DISPATCH_RESULT) break;
    const verdict = String(resultRow.gate_verdict ?? '');
    const status = verdict.startsWith('deny:') ? verdict.slice('deny:'.length) : null;
    const detail = asJson(resultRow.detail) ?? {};
    const failureClass = detail.failure_class ?? null;
    if (!['BLOCKED', 'NEEDS_CONTEXT'].includes(status)) break;
    if (blockedStatus == null) {
      blockedStatus = status;
      blockedFailureClass = failureClass;
    }
    if (status !== blockedStatus || failureClass !== blockedFailureClass) break;
    blockedStreak++;
    i--;
    if (i >= 0 && rows[i].gate_verdict === 'allow') i--;
    if (i >= 0 && rows[i].action !== LOG_ACTION.DISPATCH_RESULT) {
      break;
    }
  }

  // noProgress：从 decision log 推导 same-SHA no-progress（Sprint 07231527 Blocking 4）
  // 逻辑：最新 spawn:generator-fix 有 trigger_sha，且最新 verdict:generator-fix-callback
  // 的 pr_head_sha === trigger_sha → no-progress
  let noProgress = false;
  let noProgressReason = null;
  {
    // 找最新 generator-fix intent
    let lastFixIntent = null;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].action === ACTION.SPAWN_GENERATOR_FIX) {
        lastFixIntent = rows[i];
        break;
      }
    }
    if (lastFixIntent) {
      const lastFixObs = asJson(lastFixIntent.observed) ?? {};
      const triggerSha = lastFixObs.trigger_sha ?? null;
      if (triggerSha) {
        // 找该 intent 之后的第一个 verdict:generator-fix-callback
        const lastCallback = callbackForIntent(lastFixIntent, null);
        if (lastCallback) {
          const cbObs = asJson(lastCallback.observed) ?? {};
          const callbackSha = cbObs.pr_head_sha ?? null;
          const cbDetail = asJson(lastCallback.detail) ?? {};
          // 基础设施故障触发的 fix 轮（intent 的 observed.failure_class ===
          // 'infrastructure_blocked'）若正常完成（callback status = completed /
          // completed_with_concerns），说明前一轮 generator 已把活干完并 push，这轮 fix
          // 正确地无事可做——SHA 不变是正确行为，不判 no-progress，放行下游正常路由
          // （CI 轮询 / verdict chain）。判定只读结构化字段（observed.failure_class +
          // callback detail.status），不对 reason 字符串做模糊匹配。b19e6e6e 实证误杀修复。
          // 反向红线：product_failure / ci_fail 等产品缺陷触发的 fix 轮 SHA 不变仍终局，
          // 且基础设施触发但 fix 轮回调 status=failed（agent 没跑成）时也仍判无进展。
          const infraTriggered = lastFixObs.failure_class === 'infrastructure_blocked';
          const fixCallbackSucceeded = SUCCESSFUL_ROLE_STATUSES.has(cbDetail.status);
          if (
            (cbDetail.verification_status === 'verified'
              || cbDetail.verification_status == null)
            && callbackSha
            && callbackSha === triggerSha
          ) {
            if (infraTriggered && fixCallbackSucceeded) {
              noProgress = false;
              noProgressReason = null;
            } else {
              noProgress = true;
              noProgressReason = 'no_progress_same_sha'; // 统一 reason 常量（derive 和 ground-truth 对齐）
            }
          } else if (cbDetail.verification_status != null
              && !['verified', 'verification_pending'].includes(
                cbDetail.verification_status,
              )) {
            noProgress = true;
            noProgressReason = cbDetail.no_progress_reason ?? 'callback_sha_unverified';
          }
        }
      }
    }
  }

  return {
    hops: rows.length,
    fixRound,
    ganRound,
    noPushStreak: terminalFalseStreak(proposerOutcomes),
    noVerdictStreak: terminalFalseStreak(reviewerOutcomes),
    crossCheckMismatch: proposerCount !== proposeBranchMaxRn,
    pollCount,
    blockedStreak,
    blockedStatus,
    blockedFailureClass,
    noProgress,
    noProgressReason,
  };
}
