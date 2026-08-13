/**
 * derive(observed) → {phase, action, reason} —— reconcile loop 路由核心（纯函数）。
 *
 * 语义 SSOT：docs/superpowers/specs/2026-07-04-orchestrator-skeleton-design.md §phase/action 推导语义。
 * 逐条对齐：docs/current/harness-orchestration-redesign/routing-extraction.md。
 * 确定性纪律：禁 Date.now/Math.random/new Date；缺字段 fail-fast（throw 带字段名）。
 *
 * observed schema（键必须存在，值可为 null）：
 *   run:{phase} / task:{status} / prdExists / contract:{approved}
 *   pr:{url,state,ci,merged,head_sha}|null
 *   inflight:{containers[],host_pids[],attempts[]} —— P0-1 在途观测
 *   lastAgentExit:{code,auth_failed,action?}     —— P0-3 exit/auth 观测；action 标识退出 worker 的 intent
 *   proposeBranchRn（propose 分支现查的最大 rN，0=无）
 *   ganLatestRoundVerdict（最新 rN 的 reviewer verdict，null=无本轮 verdict）
 *   generatorSpawned（决策日志里是否派过 generator）
 *   evaluateVerdict / judgeVerdict:{verdict,pr_head_sha,failure_class?}|null —— P0-2 SHA 锚定
 *   reviewRequired / reviewApproved
 *   counters:{hops,fixRound,pollCount,noPushStreak,noVerdictStreak,ganCostUsd}
 */
import { caps, isPassVerdict } from './gates.js';
import { ACTION, LOG_ACTION } from './constants.js';
import { replayProductConvergence } from './counters.js';
import { detectRubricTrend } from './rubric-trend.js';
import {
  asStructuredJson,
  crashSignatureKey,
  failureSignatureKey,
  generatorCrashSignature,
  normalizeFailureSignature,
} from './convergence-signatures.js';

const REQUIRED_FIELDS = [
  'run', 'task', 'prdExists', 'contract', 'pr', 'inflight', 'lastAgentExit',
  'proposeBranchRn', 'ganLatestRoundVerdict', 'generatorSpawned',
  'evaluateVerdict', 'judgeVerdict', 'reviewRequired', 'reviewApproved', 'counters',
  // noProgress / noProgressReason 可选（ground-truth 从 decisionLog 推导注入，测试可手动注入）
  // gear 可选：ground-truth 从 initiative_runs.gear 注入（缺省 'default'），不进 REQUIRED_FIELDS——
  //   否则 100+ 存量 derive 用例（不传 gear）全炸（零回归红线）。
];

// harness gear 档位枚举。SSOT 是 packages/brain/src/harness-skill-relay.js 的 GEAR_VALUES；
// derive 是纯函数状态机，刻意不 import relay（其顶层 import 了 db.js，会把 DB 依赖拖进纯函数
// 与其纯函数测试），故此处按值复制同一枚举，两端由评审/回归守卫保持一致。
const GEAR_VALUES = ['default', 'hotfix', 'segmented'];
const EXECUTION_PROFILES = new Set([
  'new-capability-v1',
  'capability-change-v1',
  'hotfix-v1',
  'parameter-only-v1',
]);

function assertObservedShape(observed) {
  for (const field of REQUIRED_FIELDS) {
    if (!(field in observed)) {
      throw new Error(`derive: missing required observed field "${field}"`);
    }
  }
}

/** verdict 记录是否锚定在当前 PR head SHA 上（P0-2：旧 sha 的记录视为不存在） */
function verdictForSha(verdictRow, headSha) {
  return verdictRow && verdictRow.pr_head_sha === headSha ? verdictRow : null;
}

/**
 * decisionLog 里锚定 currentHeadSha 的某类 verdict 行的最大 hop（无则 null）。
 * passOnly=true 时只计 PASS verdict 行。issue dbea513f：用于比较 evaluate/judge verdict 新旧时序。
 */
function latestVerdictHop(decisionLog, verdictAction, currentHeadSha, passOnly = false) {
  let maxHop = null;
  for (const row of sortedLogRows(decisionLog)) {
    if (row.action !== verdictAction) continue;
    const detail = asStructuredJson(row.detail) ?? {};
    if (detail.pr_head_sha !== currentHeadSha) continue;
    if (passOnly && !isPassVerdict(detail.verdict)) continue;
    const hop = Number(row.hop);
    if (maxHop == null || hop > maxHop) maxHop = hop;
  }
  return maxHop;
}

/**
 * recollect 收敛护栏（issue dbea513f 缺陷2）：补证后是否产出了【晚于】最新 judge verdict 的
 * evaluate PASS。为真表示 Evaluator 已按 Judge 要求重新取证成功，陈旧 judge FAIL 不应再遮蔽
 * 新证据——应派 judge 复核而非再进 failure_class 重派 evaluator。均按 currentHeadSha 锚定 +
 * decisionLog verdict 行 hop 时序（纯函数唯一确定性可比信号，禁 Date/时间戳）。
 */
function hasNewerEvaluatePassThanJudge(decisionLog, currentHeadSha) {
  const evalHop = latestVerdictHop(decisionLog, LOG_ACTION.VERDICT_EVALUATE, currentHeadSha, true);
  if (evalHop == null) return false;
  const judgeHop = latestVerdictHop(decisionLog, LOG_ACTION.VERDICT_JUDGE, currentHeadSha, false);
  // 无 judge verdict 行 → 无遮蔽问题（由 4b「无 judge 记录」路径处理），不在此触发
  if (judgeHop == null) return false;
  return evalHop > judgeHop;
}

/**
 * recollect 落库快照是否锚定在 currentHeadSha（issue dbea513f 缺陷1）：
 * 生产实证 spawn:evaluator 落库 observed 快照顶层【缺】trigger_sha（只有 pr.head_sha），
 * 故 trigger_sha 优先、缺失时回退 observed.pr.head_sha 兜底匹配，防死循环 guard 才能触发。
 */
function recollectSnapshotMatchesHead(observedSnapshot, currentHeadSha) {
  const snapshot = asStructuredJson(observedSnapshot) ?? {};
  const sha = snapshot.trigger_sha ?? snapshot.pr?.head_sha ?? null;
  return sha === currentHeadSha;
}

/** fix 分路统一出口；fixRound 只作观测，终止由结构化收敛探测器决定。 */
function fixRoute(reason) {
  return { phase: 'generate', action: 'spawn:generator-fix', reason };
}

function currentProductFailureSet(observed) {
  if (observed.pr?.ci === 'fail') {
    return normalizeFailureSignature(observed.pr.failed_checks);
  }
  const currentHeadSha = observed.pr?.head_sha ?? null;
  const productVerdict = [observed.judgeVerdict, observed.evaluateVerdict]
    .find((verdict) => (
      verdict?.pr_head_sha === currentHeadSha
      && !isPassVerdict(verdict.verdict)
      && (verdict.failure_class === 'product_failure'
        || verdict.failure_class == null)
    ));
  return normalizeFailureSignature(productVerdict?.failure_signature);
}

function productFixRoute(observed, reason) {
  const convergence = replayProductConvergence(observed.decisionLog ?? [], {
    currentFailureSet: currentProductFailureSet(observed),
    currentHeadSha: observed.pr?.head_sha ?? null,
    historicalFailureSets: observed.historicalFailureSets ?? [],
  });
  if (convergence.outcome === 'failed') {
    return {
      phase: 'failed',
      action: ACTION.MARK_FAILED,
      reason: convergence.reason,
    };
  }
  if (convergence.outcome === 'review') {
    return {
      phase: 'review',
      action: ACTION.WAIT_HUMAN_REVIEW,
      reason: convergence.reason,
    };
  }
  if (convergence.outcome === 'pending') {
    return {
      phase: 'generate',
      action: ACTION.WAIT_GENERATOR_FIX_CALLBACK,
      reason: convergence.reason,
    };
  }
  return fixRoute(reason);
}

function applyHopFence(decision, counters) {
  // Convergence and escalation routes are the primary stop condition. The hop
  // budget is only a wide fallback for otherwise continuing automation.
  if ([
    ACTION.MARK_FAILED,
    ACTION.PAUSE_RUN,
    ACTION.WAIT_HUMAN_REVIEW,
    ACTION.WAIT_GENERATOR_FIX_CALLBACK,
  ].includes(decision.action)) {
    return decision;
  }
  if (caps.hopsExceeded(counters.hops)) {
    return { phase: 'failed', action: ACTION.MARK_FAILED, reason: 'hop_cap' };
  }
  return decision;
}

function sortedLogRows(decisionLog) {
  return Array.isArray(decisionLog)
    ? [...decisionLog].sort((a, b) => Number(a.hop) - Number(b.hop))
    : [];
}

const INFRA_RETRY_ACTION_BY_ROLE = Object.freeze({
  planner: { phase: 'planning', action: ACTION.SPAWN_PLANNER },
  proposer: { phase: 'gan', action: ACTION.SPAWN_PROPOSER },
  reviewer: { phase: 'gan', action: ACTION.SPAWN_REVIEWER },
  generator: { phase: 'generate', action: ACTION.SPAWN_GENERATOR_FIX },
  evaluator: { phase: 'evaluate', action: ACTION.SPAWN_EVALUATOR },
  judge: { phase: 'judge', action: ACTION.SPAWN_JUDGE },
  reporter: { phase: 'done', action: ACTION.SPAWN_CANARY },
});

const CONTEXT_RETRY_PHASE_BY_ACTION = Object.freeze({
  [ACTION.SPAWN_PLANNER]: 'planning',
  [ACTION.SPAWN_PROPOSER]: 'gan',
  [ACTION.SPAWN_REVIEWER]: 'gan',
  [ACTION.SPAWN_GENERATOR]: 'generate',
  [ACTION.SPAWN_GENERATOR_FIX]: 'generate',
  [ACTION.SPAWN_EVALUATOR]: 'evaluate',
  [ACTION.SPAWN_EVALUATOR_EVIDENCE_REPAIR]: 'evaluate',
  [ACTION.SPAWN_JUDGE]: 'evaluate',
});

function callbackDetail(row) {
  return asStructuredJson(row?.detail) ?? {};
}

function latestUnconsumedAttemptResult(decisionLog) {
  const rows = sortedLogRows(decisionLog);
  const latestSpawn = [...rows].reverse().find(
    (row) => typeof row.action === 'string' && row.action.startsWith('spawn:'),
  );
  const answeredCallbackHops = new Set(rows
    .filter((row) => (
      row.action === LOG_ACTION.CONTEXT_ANSWER
      || row.action === ACTION.REOPEN_GAN_CONTRACT
    ))
    .map((row) => Number(callbackDetail(row).callback_hop))
    .filter(Number.isInteger));
  return [...rows].reverse().find((row) => {
    const detail = callbackDetail(row);
    const isAttemptCallback = row.action === LOG_ACTION.ATTEMPT_CALLBACK;
    const isExpiredInfrastructureTerminal = (
      row.action === LOG_ACTION.EXPIRED_ATTEMPT_RECONCILED
      && detail.status === 'failed'
      && detail.failure_class === 'infrastructure_blocked'
    );
    return (
      (isAttemptCallback || isExpiredInfrastructureTerminal)
      && !answeredCallbackHops.has(Number(row.hop))
      && (latestSpawn == null || Number(row.hop) > Number(latestSpawn.hop))
    );
  }) ?? null;
}

function answeredContextRetryRoute(decisionLog) {
  const rows = sortedLogRows(decisionLog);
  const answer = [...rows].reverse().find(
    (row) => row.action === LOG_ACTION.CONTEXT_ANSWER,
  );
  if (!answer) return null;

  const answerDetail = callbackDetail(answer);
  const callbackHop = Number(answerDetail.callback_hop);
  const callback = rows.find((row) => (
    Number(row.hop) === callbackHop
    && row.action === LOG_ACTION.ATTEMPT_CALLBACK
    && callbackDetail(row).status === 'needs_context'
  ));
  if (!callback) return null;

  const alreadyRetried = rows.some((row) => (
    Number(row.hop) > Number(answer.hop)
    && Object.hasOwn(CONTEXT_RETRY_PHASE_BY_ACTION, row.action)
  ));
  if (alreadyRetried) return null;

  const callbackDispatchHop = Number(callbackDetail(callback).hop);
  const exactAction = rows.find((row) => (
    Number(row.hop) === callbackDispatchHop
    && Object.hasOwn(CONTEXT_RETRY_PHASE_BY_ACTION, row.action)
  ));
  const originalAction = exactAction ?? [...rows].reverse().find((row) => (
    Number(row.hop) < Number(callback.hop)
    && Object.hasOwn(CONTEXT_RETRY_PHASE_BY_ACTION, row.action)
  ));
  if (!originalAction) return null;

  return {
    phase: CONTEXT_RETRY_PHASE_BY_ACTION[originalAction.action],
    action: originalAction.action,
    reason: 'context_answered_retry',
  };
}

function noPrSignatureKey(detail) {
  const structured = failureSignatureKey(detail.failure_signature);
  if (structured != null) return `failure:${structured}`;
  // Callback artifacts are provider claims until a server-side projector
  // verifies them (for example by resolving a PR head). They cannot by
  // themselves reset convergence or an Agent could rotate arbitrary strings.
  return 'unknown_no_pr';
}

function generatorNoPrRoute(observed, currentDetail) {
  const currentKey = noPrSignatureKey(currentDetail);
  const matchingCallbacks = sortedLogRows(observed.decisionLog).filter((row) => {
    if (row.action !== LOG_ACTION.ATTEMPT_CALLBACK) return false;
    const detail = callbackDetail(row);
    if (detail.role !== 'generator') return false;
    if (!['completed', 'completed_with_concerns'].includes(detail.status)) return false;
    if ((detail.artifacts ?? []).some((artifact) => artifact?.type === 'pull_request')) {
      return false;
    }
    return noPrSignatureKey(detail) === currentKey;
  });
  if (matchingCallbacks.length >= 2) {
    return {
      phase: 'failed',
      action: ACTION.MARK_FAILED,
      reason: currentKey === 'unknown_no_pr'
        ? 'repeated_unknown_no_pr'
        : 'repeated_no_pr_signature',
    };
  }
  return {
    phase: 'generate',
    action: ACTION.SPAWN_GENERATOR_FIX,
    reason: currentKey === 'unknown_no_pr' ? 'unknown_no_pr' : 'structured_no_pr',
  };
}

function attemptCallbackRoute(observed) {
  const row = latestUnconsumedAttemptResult(observed.decisionLog);
  if (!row) return null;
  const detail = callbackDetail(row);
  const { status, failure_class: failureClass, role } = detail;
  const assemblyFailureReasons = new Map([
    ['FROZEN_CONTRACT_ARTIFACTS_MISSING', 'frozen_contract_artifacts_missing'],
    ['FROZEN_CONTRACT_ARTIFACT_INVALID', 'frozen_contract_artifact_invalid'],
    [
      'FROZEN_CONTRACT_ARTIFACT_MATERIALIZATION_FAILED',
      'frozen_contract_artifact_materialization_failed',
    ],
  ]);
  const assemblyFailureReason = assemblyFailureReasons.get(
    String(detail.error_code ?? '').toUpperCase(),
  );

  if (assemblyFailureReason) {
    return {
      phase: 'failed',
      action: ACTION.MARK_FAILED,
      reason: assemblyFailureReason,
    };
  }

  if (status === 'needs_context') {
    return {
      phase: 'paused',
      action: ACTION.PAUSE_RUN,
      reason: 'callback_needs_context',
    };
  }
  if (
    (status === 'blocked' || status === 'failed')
    && failureClass === 'infrastructure_blocked'
  ) {
    const retry = INFRA_RETRY_ACTION_BY_ROLE[role];
    if (!retry) {
      return {
        phase: 'review',
        action: ACTION.WAIT_HUMAN_REVIEW,
        reason: 'callback_infrastructure_route_unknown',
      };
    }
    return {
      phase: retry.phase,
      action: retry.action,
      reason: 'callback_infrastructure_blocked',
    };
  }
  // 账号配额耗尽类失败（issue 7c9f427e）：某 attempt 撞 429 周限/额度耗尽，根因不是
  // 代码/运行器错，而是该账号额度用尽——不判 run 终态，在同一 run 内重派同角色（选目标时
  // 由 resolveExecutionTarget 消费 account-usage CAPPED 判定轮换到下一可用账号）。
  // 复用 INFRA_RETRY_ACTION_BY_ROLE 的非终态重试相位/动作，仅 reason 区分为 account_exhausted。
  if (status === 'failed' && failureClass === 'account_exhausted') {
    const retry = INFRA_RETRY_ACTION_BY_ROLE[role];
    if (!retry) {
      return {
        phase: 'review',
        action: ACTION.WAIT_HUMAN_REVIEW,
        reason: 'callback_account_exhausted_route_unknown',
      };
    }
    return {
      phase: retry.phase,
      action: retry.action,
      reason: 'callback_account_exhausted',
    };
  }
  // 合同故障重开 GAN（r40 实证）：Generator 报出的故障根因在合同资产自身
  // （伪 RED 占位桩 / final-E2E 脚本缺陷），它受 CONTRACT IS LAW 约束无权修。
  // 责任在写合同的 Proposer 与批合同的 Reviewer——自动降级合同重开 GAN 让
  // 他们修，而不是死等人工。每 run 只重开一次：第二次同类故障说明 GAN 修
  // 不动，回落人工。
  // CONTRACT_CI_SCOPE_CONFLICT(r43 实证):合同的改动范围限定与仓库级 CI 硬要求
  // (如 test-registry.yaml 登记制)客观冲突——执行者无法在不违约的前提下修复 CI。
  // 核心 token 组合(F6/codexC 案卷,run 8374ab73 实证):精确 token 集合比对(排序后
  // 整体相等)对付得了词序漂移,对付不了"多词/丢词"漂移——LLM 报
  // APPROVED_CONTRACT_CI_CONFLICT(比 CONTRACT_CI_SCOPE_CONFLICT 多了修饰词
  // APPROVED、少了 SCOPE),精确集合比对两头不沾直接漏判掉回死等人工。改用
  // "报出的 token 集合是否包含某条核心组合的全部 token"子集匹配——SCOPE/其余
  // 修饰词不是语义必需,只挑每条码里区分度最高的词做核心组合,防止过度放宽
  // 误把无关产品 bug 路由成合同申诉。
  const CONTRACT_FAULT_CORE_TOKENS = [
    ['SELF', 'CONTRADICTION'], // CONTRACT_SELF_CONTRADICTION
    ['TEST', 'UNSATISFIABLE'], // CONTRACT_TEST_UNSATISFIABLE
    ['CI', 'CONFLICT'], // CONTRACT_CI_SCOPE_CONFLICT（SCOPE 非必需——已实证会被丢）
  ];
  const reportedTokens = new Set(String(detail.error_code ?? '').toUpperCase().split('_').filter(Boolean));
  const matchesContractFaultCode = CONTRACT_FAULT_CORE_TOKENS.some(
    (core) => core.every((token) => reportedTokens.has(token)),
  );
  if (
    role === 'generator'
    && (status === 'blocked' || (status === 'failed' && failureClass === 'semantic_refusal'))
    && matchesContractFaultCode
  ) {
    // 仲裁制(Alex 拍板 2026-08-06):Generator 的合同故障码只是"申诉",不能
    // 自动成立——被审查者不能自己触发对审查产物(合同)的推翻。独立仲裁器
    // (Judge 同模型)裁定后才分流:成立→重开 GAN;驳回→打回 generator-fix
    // 继续干活;仲裁器不可用→人工,不缺席审判任何一方。
    const arbitration = [...sortedLogRows(observed.decisionLog)].reverse().find(
      (r) => r.action === LOG_ACTION.CONTRACT_ARBITRATION
        && Number(callbackDetail(r).callback_hop) === Number(row.hop),
    );
    if (!arbitration) {
      return {
        phase: 'gan',
        action: ACTION.ARBITRATE_CONTRACT_FAULT,
        reason: 'contract_fault_appeal',
        callbackHop: Number(row.hop),
      };
    }
    const upheld = callbackDetail(arbitration).upheld;
    if (upheld === false) {
      return fixRoute('contract_appeal_rejected');
    }
    if (upheld !== true) {
      return {
        phase: 'review',
        action: ACTION.WAIT_HUMAN_REVIEW,
        reason: 'contract_arbitration_unavailable',
      };
    }
    const priorReopens = sortedLogRows(observed.decisionLog)
      .filter((r) => r.action === ACTION.REOPEN_GAN_CONTRACT).length;
    if (priorReopens < 1) {
      return {
        phase: 'gan',
        action: ACTION.REOPEN_GAN_CONTRACT,
        reason: 'contract_fault_reopen_gan',
        callbackHop: Number(row.hop),
      };
    }
  }
  if (
    status === 'blocked'
    || (status === 'failed' && failureClass === 'semantic_refusal')
  ) {
    return {
      phase: 'review',
      action: ACTION.WAIT_HUMAN_REVIEW,
      reason: 'callback_semantic_refusal',
    };
  }
  if (status === 'failed') {
    return {
      phase: 'failed',
      action: ACTION.MARK_FAILED,
      reason: `callback_${failureClass ?? 'failed'}`,
    };
  }
  if (status === 'cancelled') {
    return {
      phase: 'failed',
      action: ACTION.MARK_FAILED,
      reason: 'callback_cancelled',
    };
  }
  if (
    role === 'generator'
    && observed.pr == null
    && ['completed', 'completed_with_concerns'].includes(status)
  ) {
    if ((detail.artifacts ?? []).some((artifact) => (
      artifact?.type === 'pull_request' && typeof artifact.url === 'string'
    ))) {
      return {
        phase: 'generate',
        action: ACTION.WAIT_RUNNING,
        reason: 'callback_pr_projection_pending',
      };
    }
    return generatorNoPrRoute(observed, detail);
  }
  return null;
}

function currentHumanReviewRejection(decisionLog, currentHeadSha) {
  const rows = sortedLogRows(decisionLog);
  return rows.find((row) => {
    if (row.action !== LOG_ACTION.VERDICT_HUMAN_REVIEW) return false;
    const detail = asStructuredJson(row.detail) ?? {};
    if (detail.rejected !== true && detail.verdict !== 'REJECTED') return false;
    if (detail.pr_head_sha !== currentHeadSha) return false;
    return rows.some((request) => (
      request.action === LOG_ACTION.HUMAN_REVIEW_REQUESTED
      && Number(request.hop) < Number(row.hop)
      && String(request.hop) === String(detail.review_request_hop)
      && (asStructuredJson(request.observed) ?? {}).pr?.head_sha === currentHeadSha
    ));
  }) ?? null;
}

function evidenceReplayRoute(decisionLog, currentHeadSha, currentVerdict) {
  const signature = normalizeFailureSignature(currentVerdict?.failure_signature);
  const signatureKey = failureSignatureKey(signature);
  if (signatureKey == null) {
    const rows = sortedLogRows(decisionLog);
    const unsignedVerdicts = rows.filter((row) => {
      if (![LOG_ACTION.VERDICT_EVALUATE, LOG_ACTION.VERDICT_JUDGE].includes(row.action)) {
        return false;
      }
      const detail = asStructuredJson(row.detail) ?? {};
      return detail.failure_class === 'evidence_invalid'
        && detail.pr_head_sha === currentHeadSha
        && failureSignatureKey(detail.failure_signature) == null;
    });
    const unsignedRepairs = rows.filter((row) => {
      if (row.action !== ACTION.SPAWN_EVALUATOR_EVIDENCE_REPAIR) return false;
      const snapshot = asStructuredJson(row.observed) ?? {};
      return snapshot.pr?.head_sha === currentHeadSha
        && snapshot.failure_class === 'evidence_invalid'
        && failureSignatureKey(snapshot.failure_signature) == null;
    });
    const latestVerdict = unsignedVerdicts.at(-1) ?? null;
    const latestRepair = unsignedRepairs.at(-1) ?? null;
    const reviewRequests = rows.filter((row) => {
      if (row.action !== LOG_ACTION.HUMAN_REVIEW_REQUESTED) return false;
      const snapshot = asStructuredJson(row.observed) ?? {};
      const detail = asStructuredJson(row.detail) ?? {};
      return snapshot.pr?.head_sha === currentHeadSha
        && detail.review_reason === 'unknown:missing_failure_signature';
    });
    const request = reviewRequests.at(-1) ?? null;
    const approval = request == null
      ? null
      : rows.find((row) => {
          if (row.action !== LOG_ACTION.VERDICT_HUMAN_REVIEW) return false;
          const detail = asStructuredJson(row.detail) ?? {};
          return detail.approved === true
            && detail.pr_head_sha === currentHeadSha
            && Number(row.hop) > Number(request.hop)
            && String(detail.review_request_hop) === String(request.hop);
        }) ?? null;
    if (approval) {
      const postApprovalRepair = unsignedRepairs.find(
        (row) => Number(row.hop) > Number(approval.hop),
      ) ?? null;
      if (!postApprovalRepair) {
        return {
          phase: 'evaluate',
          action: ACTION.SPAWN_EVALUATOR_EVIDENCE_REPAIR,
          reason: 'evidence_invalid:approved_single_retry',
        };
      }
      if (latestVerdict && Number(latestVerdict.hop) > Number(postApprovalRepair.hop)) {
        return {
          phase: 'failed',
          action: ACTION.MARK_FAILED,
          reason: 'repeated_evidence_invalid_after_approval',
        };
      }
      return {
        phase: 'evaluate',
        action: ACTION.WAIT_RUNNING,
        reason: 'evidence_repair_awaiting_verdict',
      };
    }
    if (latestRepair && latestVerdict
        && Number(latestVerdict.hop) > Number(latestRepair.hop)) {
      return {
        phase: 'review',
        action: ACTION.WAIT_HUMAN_REVIEW,
        reason: 'unknown:missing_failure_signature',
      };
    }
    if (latestRepair) {
      return {
        phase: 'evaluate',
        action: ACTION.WAIT_RUNNING,
        reason: 'evidence_repair_awaiting_verdict',
      };
    }
    return {
      phase: 'evaluate',
      action: ACTION.SPAWN_EVALUATOR_EVIDENCE_REPAIR,
      reason: 'evidence_invalid',
    };
  }

  const rows = sortedLogRows(decisionLog);
  const matchesSignature = (value) => failureSignatureKey(value) === signatureKey;
  const sameHead = (value) => value === currentHeadSha;
  const matchingVerdicts = rows.filter((row) => {
    if (![LOG_ACTION.VERDICT_EVALUATE, LOG_ACTION.VERDICT_JUDGE].includes(row.action)) {
      return false;
    }
    const detail = asStructuredJson(row.detail) ?? {};
    return detail.failure_class === 'evidence_invalid'
      && sameHead(detail.pr_head_sha)
      && matchesSignature(detail.failure_signature);
  });
  const matchingRepairs = rows.filter((row) => {
    if (row.action !== ACTION.SPAWN_EVALUATOR_EVIDENCE_REPAIR) return false;
    const snapshot = asStructuredJson(row.observed) ?? {};
    return sameHead(snapshot.pr?.head_sha)
      && snapshot.failure_class === 'evidence_invalid'
      && matchesSignature(snapshot.failure_signature);
  });
  const reviewRequests = rows.filter((row) => {
    if (row.action !== LOG_ACTION.HUMAN_REVIEW_REQUESTED) return false;
    const snapshot = asStructuredJson(row.observed) ?? {};
    const detail = asStructuredJson(row.detail) ?? {};
    return sameHead(snapshot.pr?.head_sha)
      && detail.review_reason === 'evidence_invalid:repeated_signature'
      && matchesSignature(detail.failure_signature);
  });
  const request = reviewRequests.at(-1) ?? null;
  const approval = request == null
    ? null
    : rows.find((row) => {
        if (row.action !== LOG_ACTION.VERDICT_HUMAN_REVIEW) return false;
        const detail = asStructuredJson(row.detail) ?? {};
        return detail.approved === true
          && sameHead(detail.pr_head_sha)
          && Number(row.hop) > Number(request.hop)
          && String(detail.review_request_hop) === String(request.hop);
      }) ?? null;

  const latestVerdict = matchingVerdicts.at(-1) ?? null;
  const latestRepair = matchingRepairs.at(-1) ?? null;
  if (approval) {
    const postApprovalRepair = matchingRepairs.find(
      (row) => Number(row.hop) > Number(approval.hop),
    ) ?? null;
    if (!postApprovalRepair) {
      return {
        phase: 'evaluate',
        action: ACTION.SPAWN_EVALUATOR_EVIDENCE_REPAIR,
        reason: 'evidence_invalid:approved_single_retry',
      };
    }
    if (latestVerdict && Number(latestVerdict.hop) > Number(postApprovalRepair.hop)) {
      return {
        phase: 'failed',
        action: ACTION.MARK_FAILED,
        reason: 'repeated_evidence_invalid_after_approval',
      };
    }
    return {
      phase: 'evaluate',
      action: ACTION.WAIT_RUNNING,
      reason: 'evidence_repair_awaiting_verdict',
    };
  }

  if (!latestRepair) {
    return {
      phase: 'evaluate',
      action: ACTION.SPAWN_EVALUATOR_EVIDENCE_REPAIR,
      reason: 'evidence_invalid',
    };
  }
  if (latestVerdict && Number(latestVerdict.hop) > Number(latestRepair.hop)) {
    return {
      phase: 'review',
      action: ACTION.WAIT_HUMAN_REVIEW,
      reason: 'evidence_invalid:repeated_signature',
    };
  }
  return {
    phase: 'evaluate',
    action: ACTION.WAIT_RUNNING,
    reason: 'evidence_repair_awaiting_verdict',
  };
}

export function derive(observed) {
  assertObservedShape(observed);
  const { run, task, prdExists, contract, pr, inflight, counters } = observed;

  // 0. terminal（P2 修订：aborted/cancelled 也终局；routeAfterEvaluate status==='aborted'→end）
  if (run.phase === 'done' || run.phase === 'failed') {
    return { phase: 'terminal', action: 'exit', reason: `run_${run.phase}` };
  }
  if (task.status === 'aborted' || task.status === 'cancelled') {
    return { phase: 'terminal', action: 'exit', reason: `task_${task.status}` };
  }

  // merged 短路：GitHub merged 是外部终态真相，必须先于所有 fence / 在途观测。
  if (pr && pr.merged) {
    return { phase: 'done', action: 'report', reason: 'pr_merged' };
  }

  if (currentHumanReviewRejection(observed.decisionLog, pr?.head_sha ?? null)) {
    return {
      phase: 'failed',
      action: ACTION.MARK_FAILED,
      reason: 'human_review_rejected',
    };
  }

  // A received callback is the newest control truth. Route it before the
  // legacy same-SHA projection so blocked/needs_context cannot be mistaken
  // for a successful no-progress completion.
  const callbackRoute = attemptCallbackRoute(observed);
  if (callbackRoute) return applyHopFence(callbackRoute, counters);

  const contextRetryRoute = answeredContextRetryRoute(observed.decisionLog);
  if (contextRetryRoute) return applyHopFence(contextRetryRoute, counters);

  // 0.4 no-progress terminal（Sprint 07231527 Blocking 4）：
  // generator-fix callback SHA === trigger_sha → 无进展，立即终局
  // INV-K4：no-progress 后禁止对相同 (run_id, failure_class, trigger_sha, role) 再派 generator-fix
  if (observed.noProgress === true) {
    const noProgressReason = String(observed.noProgressReason ?? '');
    const terminalReason = noProgressReason.startsWith('callback_sha_')
      ? noProgressReason
      : 'no_progress_same_sha';
    return {
      phase: 'failed',
      action: ACTION.MARK_FAILED,
      reason: terminalReason,
    };
  }

  // 0.5 在途观测（P0-1）：有在途容器/主机 pid/Attempt → 只写心跳不派发，杜绝崩溃重拉双 spawn
  if (
    inflight.containers.length > 0
    || inflight.host_pids.length > 0
    || (inflight.attempts?.length ?? 0) > 0
  ) {
    return { phase: run.phase, action: 'wait:running', reason: 'agent_inflight' };
  }

  // 0.6 harness gear 分档（sprint 08091640：kernel 真读 payload.gear）。
  // 位置刻意在所有 gear 无关守卫（terminal / merged / human-review-reject / callbackRoute /
  // contextRetry / noProgress / inflight）之后、planning 门之前——外部终态真相与在途观测优先，
  // 分档只决定「从初始态往哪条相位链走」。
  //  - 非法 gear（不在 GEAR_VALUES）：kernel 侧 fail-closed，terminal failed，不静默降级、
  //    不进任何相位（对齐 executor.js 的 invalid_gear terminal failed）。
  //  - hotfix：初始态（prd 未落盘 && 合同未批）跳过 planning/gan 直进 generate，保留
  //    generator→evaluator→judge（决策 1b677ae3：免 planner/GAN 但保留评估）。
  //  - segmented / default / 缺省：落到下面现行 planning 门（default 逐字节等价，零回归）。
  const hasReceiptObservation = Object.hasOwn(observed, 'routingReceipt');
  const receipt = observed.routingReceipt;
  if (hasReceiptObservation && !receipt) {
    return { phase: 'failed', action: ACTION.MARK_FAILED, reason: 'routing_receipt_missing' };
  }
  const executionProfile = receipt
    ? (receipt.execution_profile_override ?? receipt.default_execution_profile)
    : null;
  if (receipt && !EXECUTION_PROFILES.has(executionProfile)) {
    return { phase: 'failed', action: ACTION.MARK_FAILED, reason: 'invalid_execution_profile' };
  }
  if (executionProfile === 'hotfix-v1' || executionProfile === 'parameter-only-v1') {
    return applyHopFence(deriveTask(observed), counters);
  }
  if (executionProfile === 'capability-change-v1') {
    if (!prdExists) {
      return applyHopFence(
        { phase: 'planning', action: ACTION.SPAWN_PLANNER, reason: 'profile_light_planner_required' },
        counters,
      );
    }
    if (!contract.approved) {
      const decision = observed.proposeBranchRn >= 1
        ? { phase: 'gan', action: ACTION.FORCE_APPROVE_CONTRACT, reason: 'profile_direct_contract_convergence' }
        : { phase: 'gan', action: ACTION.SPAWN_PROPOSER, reason: 'profile_direct_contract_proposal' };
      return applyHopFence(decision, counters);
    }
    return applyHopFence(deriveTask(observed), counters);
  }

  const gear = receipt ? 'default' : (observed.gear ?? 'default');
  if (!GEAR_VALUES.includes(gear)) {
    return { phase: 'failed', action: ACTION.MARK_FAILED, reason: 'invalid_gear' };
  }
  if (gear === 'hotfix' && !prdExists && !contract.approved) {
    return applyHopFence(deriveTask(observed), counters);
  }

  // 1. planning：sprint-prd.md 落盘即真相，丢失重跑 planner（D2，plannerOutput 不持久化）
  if (!prdExists) {
    return applyHopFence(
      { phase: 'planning', action: 'spawn:planner', reason: 'no_prd' },
      counters,
    );
  }

  // 2. GAN：prd 存在 && contract 未 approved
  if (!contract.approved) {
    return applyHopFence(deriveGan(observed), counters);
  }

  // 3/4/5. contract approved 之后的单 sub-task 主线
  return applyHopFence(deriveTask(observed), counters);
}

/**
 * 规则 2：GAN 对抗环。
 * 对齐 GAN Contract Graph：无硬轮数上限（刻意，勿加）；
 * 硬保护 budgetCapUsd(10)/MAX_NO_PUSH_STREAK(2)/MAX_NO_VERDICT_STREAK(3) 照抄。
 */
function deriveGan(observed) {
  const {
    counters, proposeBranchRn, proposeBranchSha, ganLatestRoundVerdict,
  } = observed;

  if (caps.budgetExceeded(counters.ganCostUsd)) {
    return { phase: 'failed', action: 'mark_failed', reason: 'gan_budget_cap' };
  }
  if (caps.noPushStreakExceeded(counters.noPushStreak)) {
    return { phase: 'failed', action: 'mark_failed', reason: 'gan_no_push_streak' };
  }
  if (caps.noVerdictStreakExceeded(counters.noVerdictStreak)) {
    return { phase: 'failed', action: 'mark_failed', reason: 'gan_no_verdict_streak' };
  }

  // rN 从 propose 分支现查（外部真相，非内存）：
  // 最新 rN 合同存在且无本轮 verdict → reviewer；否则 proposer（proposerRouter/reviewerRouter 交替）。
  // F5（审查修复）：此判断必须留在趋势闸之前——本轮 SHA 还没被任何人（含代码）评审过时，
  // 不能被趋势闸越过去直接冻结批准，否则会出现"冻结一个从未被评审过的 SHA"的窗口。
  if (proposeBranchRn >= 1 && ganLatestRoundVerdict == null) {
    return { phase: 'gan', action: 'spawn:reviewer', reason: `contract_r${proposeBranchRn}_awaiting_review` };
  }

  // 崩溃窗口：reviewer 已出 APPROVED 但 contract.approved 尚未落库
  // → 只补落库不 spawn（否则误路由 proposer 白烧一轮）。loop/dispatcher 消费此控制 action。
  // F2(b)（审查修复）：真实 reviewer APPROVED 是权威 verdict，趋势闸绝不能覆盖/劫持它——
  // 这里必须无条件先判，不受下面的趋势闸影响。
  if (ganLatestRoundVerdict === 'APPROVED') {
    return { phase: 'gan', action: 'persist_contract_approval', reason: 'approved_pending_persist' };
  }

  // 案卷式 GAN 趋势观测安全网（issue ce42f68f / 决策 ba33fc68）：GAN 本身无轮数 cap（用户铁律），
  // 但 rubric 评分逐轮走低/震荡时代码层强制收敛——不再指望"reviewer 自己会喊停"
  // （r17 四轮零收敛实锤：R2 47 分 → R3 46 分多维走低仍继续对抗，无人踩刹车）。
  // 语义 SSOT：docs/superpowers/specs/2026-08-04-gan-case-file-design.md §数据流 4。
  // 位置（F5）：必须在上面两个判断之后——此刻能走到这里，说明本轮 SHA 要么还没有
  // propose 分支（rn<1），要么已经有一个非 APPROVED（REVISION）的真实 verdict，不存在
  // "冻结从未被评审 SHA" 的窗口。
  //
  // F1（审查实锤复现修复）：如果最近一条 verdict:reviewer 决策行是"validation-identity-policy
  // 硬门驳回当前 propose 分支 SHA"（force_approve_contract / persist_contract_approval 分支复用
  // 同一硬门检查产生的 REVISION），caseFile 案卷不会因此改变，趋势闸会在下一跳对同一 SHA 重复
  // 判 diverging/oscillating → 重复 force_approve_contract → 重复撞硬门 → 重复 REVISION……
  // 4096 跳热循环直到宽兜底 hop_cap 才被打断。修法：这种情况下趋势闸让路，回落到下面的
  // spawn:proposer，把"改代码"这件事交还给 proposer（新 SHA 产生后趋势闸再开火）。
  const latestReviewerLogRow = [...sortedLogRows(observed.decisionLog)]
    .reverse()
    .find((row) => row.action === LOG_ACTION.VERDICT_REVIEWER);
  const latestReviewerLogDetail = latestReviewerLogRow
    ? (asStructuredJson(latestReviewerLogRow.detail) ?? {})
    : null;
  const identityPolicyBlockedCurrentSha = latestReviewerLogDetail?.source === 'validation_identity_policy'
    && latestReviewerLogDetail?.contract_sha === proposeBranchSha;

  // 合同故障重开后（reopen 行比最新 reviewer verdict 新 = proposer 还没出修复轮）：
  // 趋势闸必须让路。案卷未变，趋势仍会判 diverging/oscillating——若不让路，
  // force_approve 会把刚被下游证伪的坏合同原样再批回去，generate 复撞同一故障。
  const rows = sortedLogRows(observed.decisionLog);
  const latestReopenHop = [...rows].reverse()
    .find((r) => r.action === ACTION.REOPEN_GAN_CONTRACT)?.hop ?? null;
  const reopenPendingProposerFix = latestReopenHop != null
    && (latestReviewerLogRow == null || Number(latestReopenHop) > Number(latestReviewerLogRow.hop));

  if (!identityPolicyBlockedCurrentSha && !reopenPendingProposerFix) {
    // 趋势闸案卷输入按纪元切(r43 实证):重开后 reviewer 一出新 REVISION,上面的
    // 让路守卫即解除,若仍拿重开前旧轮拼趋势,会把刚被下游证伪的合同判"震荡"
    // 原样强批回去——重开被静默撤销。纪元起点 = 重开写入的 E 号故障轮;
    // 纪元内不足 3 轮有效评分 → detectRubricTrend 自然判 insufficient → 回 proposer。
    const reopenEraStartRound = latestReopenHop == null
      ? null
      : (observed.caseFile ?? []).reduce((max, r) => {
        const hasEBlocker = Array.isArray(r?.blockers)
          && r.blockers.some((b) => /^E\d+-/.test(String(b?.id ?? '')));
        return hasEBlocker && Number(r.round) > max ? Number(r.round) : max;
      }, -1);
    const eraCaseFile = reopenEraStartRound == null || reopenEraStartRound === -1
      ? observed.caseFile
      : (observed.caseFile ?? []).filter((r) => Number(r.round) >= reopenEraStartRound);
    const rubricTrend = detectRubricTrend(eraCaseFile);
    if (rubricTrend === 'diverging' || rubricTrend === 'oscillating') {
      return {
        phase: 'gan',
        action: ACTION.FORCE_APPROVE_CONTRACT,
        reason: `convergence_${rubricTrend}`,
      };
    }
  }

  return { phase: 'gan', action: 'spawn:proposer', reason: proposeBranchRn >= 1 ? 'revision_requested' : 'no_contract_yet' };
}

/**
 * 规则 3/4/5：contract approved 后的 generate → evaluate → judge → review → merge 主线。
 */
function deriveTask(observed) {
  const {
    pr,
    lastAgentExit,
    generatorSpawned,
    counters,
    decisionLog,
  } = observed;

  // 3a. !pr
  if (!pr) {
    if (!generatorSpawned) {
      return { phase: 'generate', action: 'spawn:generator', reason: 'contract_approved' };
    }
    const crashSignature = generatorCrashSignature(lastAgentExit);
    const currentCrashKey = crashSignatureKey(crashSignature);
    if (currentCrashKey != null && sortedLogRows(decisionLog).some((row) => {
      if (row.action !== ACTION.SPAWN_GENERATOR_FIX) return false;
      const snapshot = asStructuredJson(row.observed) ?? {};
      return crashSignatureKey(snapshot.crash_signature) === currentCrashKey;
    })) {
      return {
        phase: 'failed',
        action: ACTION.MARK_FAILED,
        reason: 'repeated_generator_crash_signature',
      };
    }
    // generator 已退出且无 PR（no_pr）→ 计入 fix_round
    // （修订声明：旧图 routeAfterParse !pr_url→no_pr(END) 直接终局，新语义=可重试入 fix 上限）
    return fixRoute('no_pr');
  }

  // 3d. exit/auth 观测分路（P0-3）——优先于 CI 状态判定：
  // routeAfterCallback 语义：ci_fail_type∈{container_exit,auth_failed}→fix（agent 死了不必等 CI）。
  // 熔断/换号由 T3 dispatcher 依 DB 熔断状态处理，derive 只分路。
  // 契约（T2-C/T3 实现责任）：ground-truth 必须按最新 intent hop 作用域提供 lastAgentExit——
  // fix 后残留旧 exit code 会让本分支反复命中、白吃 fix round。
  const exitBelongsToGenerator =
    lastAgentExit.action == null ||
    lastAgentExit.action === ACTION.SPAWN_GENERATOR ||
    lastAgentExit.action === ACTION.SPAWN_GENERATOR_FIX;
  if (
    exitBelongsToGenerator &&
    (lastAgentExit.auth_failed || (lastAgentExit.code != null && lastAgentExit.code !== 0))
  ) {
    return fixRoute(lastAgentExit.auth_failed ? 'auth_failed' : 'container_exit');
  }

  // 3b. ci pending → poll；超限（20×90s）→ failed
  // （修订声明：旧 routeAfterPoll timeout→END，新=failed 终局，语义等价）
  if (pr.ci === 'pending') {
    if (caps.pollExceeded(counters.pollCount)) {
      return { phase: 'failed', action: 'mark_failed', reason: 'ci_timeout' };
    }
    return { phase: 'generate', action: 'wait:poll_ci', reason: 'ci_pending' };
  }

  // 3c. ci fail → fix loop（routeAfterPoll fail→fix；fix 同 PR，不 reset pr_url/pr_branch）
  if (pr.ci === 'fail') {
    return productFixRoute(observed, 'ci_fail');
  }

  // 4. ci pass —— verdict 全部锚定当前 head SHA（P0-2）
  return deriveVerdictChain(observed);
}

/**
 * failure_class 路由矩阵（Sprint 07231527 Blocking 3）：
 * evaluate/judge FAIL 时根据 failure_class 分差异路由，而非统一 fixOrFail。
 *
 * | failure_class           | 路由动作                        |
 * |------------------------|--------------------------------|
 * | product_failure（或null）| spawn:generator-fix             |
 * | evidence_invalid        | spawn:evaluator-evidence-repair |
 * | environment_recovery    | 首次 generator-fix；第二次相同签名 mark_failed |
 * | needs_context           | wait:human_review（保守）        |
 * | contract_invalid        | mark_failed                     |
 * | unknown                 | wait:human_review（INV-K3）      |
 */
function deriveFailureClassRoute(
  failureClass,
  counters,
  decisionLog,
  currentHeadSha,
  currentVerdict = null,
  observed = null,
) {
  const fc = failureClass ?? null;

  if (fc === 'contract_invalid') {
    return { phase: 'failed', action: 'mark_failed', reason: 'contract_invalid' };
  }

  if (fc === 'evidence_invalid') {
    // INV-K6：只按 SHA + 结构化签名回放。第二次同签名停在人审；
    // 人工批准只解锁一次，批准后的 repair 再产出同签名即终局。
    return evidenceReplayRoute(decisionLog, currentHeadSha, currentVerdict);
  }

  if (fc === 'evidence_insufficient') {
    // 证据不足 ≠ 代码有 bug（r41 实证）：Judge 说"你给的证据不支撑 PASS"时，缺的是
    // 取证（Evaluator 的活），产品实现往往完全正确——派 Generator 改代码是改错了人，
    // 还会动到本来对的实现。重派 Evaluator 按 Judge 的具体要求重新取证。
    // 防死循环：同一 SHA 已因此重新取证过一次仍判证据不足 → 回落人工。
    const alreadyRecollected = (decisionLog ?? []).some(
      (r) => r.action === ACTION.SPAWN_EVALUATOR
        && (asStructuredJson(r.detail) ?? {}).reason === 'judge_evidence_insufficient_recollect'
        && recollectSnapshotMatchesHead(r.observed, currentHeadSha),
    );
    if (alreadyRecollected) {
      return {
        phase: 'review',
        action: ACTION.WAIT_HUMAN_REVIEW,
        reason: 'evidence_insufficient_after_recollect',
      };
    }
    return {
      phase: 'evaluate',
      action: ACTION.SPAWN_EVALUATOR,
      reason: 'judge_evidence_insufficient_recollect',
    };
  }

  if (fc === 'needs_context' || fc === 'unknown') {
    // INV-K3：不确定原因不应默认归为产品代码失败 → 等人工介入
    return { phase: 'review', action: 'wait:human_review', reason: `${fc}:awaiting_human_review` };
  }

  if (fc === 'environment_recovery') {
    // 首次 environment_recovery → generator-fix；相同签名第二次 → terminal
    const prevEnvRecovery = (decisionLog ?? []).some(
      (r) => r.action === 'spawn:generator-fix'
        && (r.observed?.failure_class === 'environment_recovery')
        && (r.observed?.trigger_sha === currentHeadSha),
    );
    if (prevEnvRecovery) {
      return { phase: 'failed', action: 'mark_failed', reason: 'repeated_environment_recovery' };
    }
    return fixRoute('environment_recovery');
  }

  // product_failure / null / 任何其他 → 保守路由 generator-fix
  if (observed != null) {
    return productFixRoute(observed, fc ?? 'evaluate_fail');
  }
  return fixRoute(fc ?? 'evaluate_fail');
}

/**
 * 规则 4a-4e：evaluate → judge → human review → merge。
 */
function deriveVerdictChain(observed) {
  const { pr, evaluateVerdict, judgeVerdict, reviewRequired, reviewApproved, counters } = observed;
  const evalRow = verdictForSha(evaluateVerdict, pr.head_sha);
  const judgeRow = verdictForSha(judgeVerdict, pr.head_sha);

  // 4a. 当前 head_sha 无 evaluate PASS 记录 → evaluate（stale PASS+新 sha 也走这里重新 evaluate）
  if (!evalRow) {
    return { phase: 'evaluate', action: 'spawn:evaluator', reason: 'no_evaluate_verdict_for_head_sha' };
  }
  if (!isPassVerdict(evalRow.verdict)) {
    // routeAfterEvaluate 语义：failure_class 差异路由矩阵（Sprint 07231527 Blocking 3）
    // INV-K3：Judge 缺 failure_class → unknown，禁止默认归为产品代码失败
    return deriveFailureClassRoute(
      evalRow.failure_class,
      counters,
      observed.decisionLog,
      pr.head_sha,
      evalRow,
      observed,
    );
  }

  // 4b. evaluate PASS(本 sha) && 无 judge 记录(本 sha) → judge（硬门禁，代码强制）
  if (!judgeRow) {
    return { phase: 'evaluate', action: 'spawn:judge', reason: 'evaluate_passed_awaiting_judge' };
  }

  // 4c. judge FAIL(本 sha) → 按 failure_class 显式分支；缺失分类归 unknown 等人工。
  if (!isPassVerdict(judgeRow.verdict)) {
    // recollect 收敛护栏（issue dbea513f 缺陷2）：若补证后产出了【晚于】最新 judge 的 evaluate
    // PASS，说明 Evaluator 已按 Judge 要求重新取证成功，此时陈旧 judge FAIL 不应再遮蔽新证据——
    // 派 judge 复核新证据（evaluate_passed_awaiting_judge），而非再进 failure_class 重派 evaluator。
    if (hasNewerEvaluatePassThanJudge(observed.decisionLog, pr.head_sha)) {
      return { phase: 'evaluate', action: 'spawn:judge', reason: 'evaluate_passed_awaiting_judge' };
    }
    if (judgeRow.failure_class == null) {
      return deriveFailureClassRoute(
        'unknown',
        counters,
        observed.decisionLog,
        pr.head_sha,
        judgeRow,
        observed,
      );
    }
    return deriveFailureClassRoute(
      judgeRow.failure_class,
      counters,
      observed.decisionLog,
      pr.head_sha,
      judgeRow,
      observed,
    );
  }

  // 4d. 双 PASS && review_required && 未批准 → 等人工（Bark/预览副作用归 T3）
  if (reviewRequired && !reviewApproved) {
    return { phase: 'review', action: 'wait:human_review', reason: 'awaiting_human_review' };
  }

  // 4e. 全门过 && !merged → merge（gates.mergeGate 放行；唯一 merge 权威）
  return { phase: 'merge', action: 'merge_pr', reason: 'all_gates_passed' };
}
