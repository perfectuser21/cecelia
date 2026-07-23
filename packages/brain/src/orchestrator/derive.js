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
 *   inflight:{containers[],host_pids[]}          —— P0-1 在途观测
 *   lastAgentExit:{code,auth_failed,action?}     —— P0-3 exit/auth 观测；action 标识退出 worker 的 intent
 *   proposeBranchRn（propose 分支现查的最大 rN，0=无）
 *   ganLatestRoundVerdict（最新 rN 的 reviewer verdict，null=无本轮 verdict）
 *   generatorSpawned（决策日志里是否派过 generator）
 *   evaluateVerdict / judgeVerdict:{verdict,pr_head_sha,failure_class?}|null —— P0-2 SHA 锚定
 *   reviewRequired / reviewApproved
 *   counters:{hops,fixRound,pollCount,noPushStreak,noVerdictStreak,ganCostUsd}
 */
import { caps, isPassVerdict } from './gates.js';
import { ACTION } from './constants.js';

const REQUIRED_FIELDS = [
  'run', 'task', 'prdExists', 'contract', 'pr', 'inflight', 'lastAgentExit',
  'proposeBranchRn', 'ganLatestRoundVerdict', 'generatorSpawned',
  'evaluateVerdict', 'judgeVerdict', 'reviewRequired', 'reviewApproved', 'counters',
];

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

/** fix 分路统一出口：fix_round < MAX_FIX_ROUNDS → spawn:generator-fix，否则 failed */
function fixOrFail(counters, reason) {
  // routeAfterFix 语义：error→end(超 MAX_FIX_ROUNDS=20)；否则回 spawn
  if (caps.fixExceeded(counters.fixRound)) {
    return { phase: 'failed', action: 'mark_failed', reason: 'fix_cap' };
  }
  return { phase: 'generate', action: 'spawn:generator-fix', reason };
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

  // 0.5 在途观测（P0-1）：有在途容器/主机 pid → 只写心跳不派发，杜绝崩溃重拉双 spawn
  if (inflight.containers.length > 0 || inflight.host_pids.length > 0) {
    return { phase: run.phase, action: 'wait:running', reason: 'agent_inflight' };
  }

  // 0.6 hop 硬上限（P2）
  if (caps.hopsExceeded(counters.hops)) {
    return { phase: 'failed', action: 'mark_failed', reason: 'hop_cap' };
  }

  // merged 短路：任何时刻 pr.merged=true → 跳过所有 spawn 直入 5（routeAfterPoll merged 语义）
  if (pr && pr.merged) {
    return { phase: 'done', action: 'report', reason: 'pr_merged' };
  }

  // 1. planning：sprint-prd.md 落盘即真相，丢失重跑 planner（D2，plannerOutput 不持久化）
  if (!prdExists) {
    return { phase: 'planning', action: 'spawn:planner', reason: 'no_prd' };
  }

  // 2. GAN：prd 存在 && contract 未 approved
  if (!contract.approved) {
    return deriveGan(observed);
  }

  // 3/4/5. contract approved 之后的单 sub-task 主线
  return deriveTask(observed);
}

/**
 * 规则 2：GAN 对抗环。
 * 对齐 GAN Contract Graph：无硬轮数上限（刻意，勿加）；
 * 硬保护 budgetCapUsd(10)/MAX_NO_PUSH_STREAK(2)/MAX_NO_VERDICT_STREAK(3) 照抄。
 */
function deriveGan(observed) {
  const { counters, proposeBranchRn, ganLatestRoundVerdict } = observed;

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
  if (proposeBranchRn >= 1 && ganLatestRoundVerdict == null) {
    return { phase: 'gan', action: 'spawn:reviewer', reason: `contract_r${proposeBranchRn}_awaiting_review` };
  }

  // 崩溃窗口：reviewer 已出 APPROVED 但 contract.approved 尚未落库
  // → 只补落库不 spawn（否则误路由 proposer 白烧一轮）。loop/dispatcher 消费此控制 action。
  if (ganLatestRoundVerdict === 'APPROVED') {
    return { phase: 'gan', action: 'persist_contract_approval', reason: 'approved_pending_persist' };
  }
  return { phase: 'gan', action: 'spawn:proposer', reason: proposeBranchRn >= 1 ? 'revision_requested' : 'no_contract_yet' };
}

/**
 * 规则 3/4/5：contract approved 后的 generate → evaluate → judge → review → merge 主线。
 */
function deriveTask(observed) {
  const { pr, lastAgentExit, generatorSpawned, counters } = observed;

  // 3a. !pr
  if (!pr) {
    if (!generatorSpawned) {
      return { phase: 'generate', action: 'spawn:generator', reason: 'contract_approved' };
    }
    // generator 已退出且无 PR（no_pr）→ 计入 fix_round
    // （修订声明：旧图 routeAfterParse !pr_url→no_pr(END) 直接终局，新语义=可重试入 fix 上限）
    return fixOrFail(counters, 'no_pr');
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
    return fixOrFail(counters, lastAgentExit.auth_failed ? 'auth_failed' : 'container_exit');
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
    return fixOrFail(counters, 'ci_fail');
  }

  // 4. ci pass —— verdict 全部锚定当前 head SHA（P0-2）
  return deriveVerdictChain(observed);
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
    // routeAfterEvaluate 语义：failure_class==='contract_invalid'→end（责任在 GAN，不入 fix loop）；否则 fix
    if (evalRow.failure_class === 'contract_invalid') {
      return { phase: 'failed', action: 'mark_failed', reason: 'contract_invalid' };
    }
    return fixOrFail(counters, 'evaluate_fail');
  }

  // 4b. evaluate PASS(本 sha) && 无 judge 记录(本 sha) → judge（硬门禁，代码强制）
  if (!judgeRow) {
    return { phase: 'evaluate', action: 'spawn:judge', reason: 'evaluate_passed_awaiting_judge' };
  }

  // 4c. judge FAIL(本 sha) → generator-fix（P0-2 显式分支；新 commit 改 SHA，旧 verdict 天然作废）
  if (!isPassVerdict(judgeRow.verdict)) {
    return fixOrFail(counters, 'judge_fail');
  }

  // 4d. 双 PASS && review_required && 未批准 → 等人工（Bark/预览副作用归 T3）
  if (reviewRequired && !reviewApproved) {
    return { phase: 'review', action: 'wait:human_review', reason: 'awaiting_human_review' };
  }

  // 4e. 全门过 && !merged → merge（gates.mergeGate 放行；唯一 merge 权威）
  return { phase: 'merge', action: 'merge_pr', reason: 'all_gates_passed' };
}
