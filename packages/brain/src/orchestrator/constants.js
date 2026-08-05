/**
 * Orchestrator 常量（T2 骨架）。
 * 全部照抄旧图数值，出处：docs/current/harness-orchestration-redesign/routing-extraction.md。
 * 纯常量文件——禁任何运行时计算/非确定性调用。
 */

// Task Graph routeAfterPoll：pending→回环 poll，超限 timeout（20 次 × 90s）
export const MAX_POLL_COUNT = 20;
export const POLL_INTERVAL_MS = 90000;

// GAN Contract Graph 硬保护：budgetCapUsd(10)/MAX_NO_PUSH_STREAK(2)/MAX_NO_VERDICT_STREAK(3)
export const MAX_NO_PUSH_STREAK = 2;
export const MAX_NO_VERDICT_STREAK = 3;
export const BUDGET_CAP_USD = 10;

// mergePrNode：BEHIND→update-branch(≤3)
export const MAX_REBASE_ATTEMPTS = 3;

// 整条 run 的宽兜底：poll/callback/effect 都会记 hop，正常终止由收敛探测器负责。
// 4096 不作为 repair 轮次预算，只防决策日志异常失控。
export const MAX_HOPS = 4096;

// loop 四态最小语义：语义类 NEEDS_CONTEXT/BLOCKED 连续 2 次同态 → failed。
// infrastructure_blocked 是外部可恢复状态，按 POLL_INTERVAL_MS 退避并由 deadline 收敛，
// 不得占用“同模型无变化”语义栅栏。
// （"绝不同模型无变化重试"铁律骨架版；对应父图 serial_gate requeue CAP(2) 精神）
export const BLOCKED_SAME_STATE_CAP = 2;

/**
 * action 枚举（spec §action 枚举，T3 dispatcher 认领清单，防漏项）：
 * - spawn:planner
 * - spawn:proposer
 * - spawn:reviewer            —— GAN feedback 随 propose 分支 push（决策 10，重拉可能换主机）
 * - spawn:canary              —— 合成只读 fleet 运输探针，无 Skill/工作区依赖
 * - spawn:generator
 * - spawn:generator-fix       —— fix 同 PR（fixDispatch 不 reset pr_url/pr_branch）
 * - spawn:evaluator           —— 前置 ARTIFACT 门 + Contract Gate，归 T3
 * - spawn:judge
 * - wait:running              —— 在途容器/pid 存在，只写心跳不派发（P0-1）
 * - wait:poll_ci
 * - wait:human_review         —— 副作用（Bark 通知+spawnReviewPreview+allocatePort）归 T3
 * - merge_pr                  —— 含 BEHIND update-branch≤3 / CONFLICTING→failed / ALREADY_MERGED 幂等
 * - report                    —— 六步链（promoteToRegression/buildHandoff/syncOkrInitiativeStatus/
 *                                _spawnStagingE2eTask/killInitiativeContainers），归 T3
 * 控制类（loop 自消费，不派 dispatcher）：
 * - exit                      —— terminal（run done/failed 或 task aborted/cancelled）
 * - mark_failed               —— 守护/上限触发，run 置 failed
 * - persist_contract_approval —— reviewer 已 APPROVED 但 contract.approved 未落库（崩溃窗口），
 *                                loop/dispatcher 补落库，不 spawn
 * - force_approve_contract    —— 案卷式 GAN 趋势观测（PR-B，issue ce42f68f）：detectRubricTrend
 *                                判 diverging/oscillating 时代码层强制收敛，跳过 reviewer 直接把
 *                                当前 propose 分支标 approved 落库 + 发 P1 告警，不 spawn
 */
export const ACTION = Object.freeze({
  SPAWN_PLANNER: 'spawn:planner',
  SPAWN_PROPOSER: 'spawn:proposer',
  SPAWN_REVIEWER: 'spawn:reviewer',
  SPAWN_CANARY: 'spawn:canary',
  SPAWN_GENERATOR: 'spawn:generator',
  SPAWN_GENERATOR_FIX: 'spawn:generator-fix',
  SPAWN_EVALUATOR: 'spawn:evaluator',
  SPAWN_EVALUATOR_EVIDENCE_REPAIR: 'spawn:evaluator-evidence-repair',
  SPAWN_JUDGE: 'spawn:judge',
  WAIT_RUNNING: 'wait:running',
  WAIT_POLL_CI: 'wait:poll_ci',
  WAIT_GENERATOR_FIX_CALLBACK: 'wait:generator_fix_callback',
  WAIT_HUMAN_REVIEW: 'wait:human_review',
  PAUSE_RUN: 'pause_run',
  MERGE_PR: 'merge_pr',
  REPORT: 'report',
  EXIT: 'exit',
  MARK_FAILED: 'mark_failed',
  PERSIST_CONTRACT_APPROVAL: 'persist_contract_approval',
  FORCE_APPROVE_CONTRACT: 'force_approve_contract',
  // 合同故障重开 GAN（r40 实证）：下游执行(Generator/Evaluator)证伪合同资产
  // 自身时,降级已批准合同回 revision、退回 GAN 让 Proposer/Reviewer 修——
  // Generator 无权改合同(CONTRACT IS LAW),不能让它扛,更不能死等人工。
  REOPEN_GAN_CONTRACT: 'reopen_gan_contract',
});

export const ACTIONS = Object.freeze(Object.values(ACTION));

// wait:* 四个动作的枚举集合（M-1 审查修正）：只复查在途状态、不派 dispatcher、
// 不代表相位真的前进——loop.js 用它替代 decision.action.startsWith('wait:')
// 字符串前缀判断，防止新增非 wait: 前缀的等待动作时静默漏判。
export const WAIT_ACTIONS = Object.freeze(new Set([
  ACTION.WAIT_RUNNING,
  ACTION.WAIT_POLL_CI,
  ACTION.WAIT_GENERATOR_FIX_CALLBACK,
  ACTION.WAIT_HUMAN_REVIEW,
]));

/**
 * LOG_ACTION —— 决策日志 verdict 行的 action 值（T3 dispatcher 写入契约，spec 决策 3：
 * verdict 权威 = 决策日志行，detail={verdict, pr_head_sha}[, rn / approved]）。
 * ground-truth/loop 与 T3 必须引用同一常量，magic string 拼错会静默丢 verdict。
 */
export const LOG_ACTION = Object.freeze({
  VERDICT_EVALUATE: 'verdict:evaluate',
  VERDICT_JUDGE: 'verdict:judge',
  VERDICT_REVIEWER: 'verdict:reviewer',
  VERDICT_HUMAN_REVIEW: 'verdict:human_review',
  HUMAN_REVIEW_REQUESTED: 'effect:human_review_requested',
  CONTEXT_REQUESTED: 'effect:context_requested',
  CONTEXT_ANSWER: 'verdict:context_answer',
  ATTEMPT_LAUNCHED: 'effect:attempt_launched',
  EXPIRED_ATTEMPT_RECONCILED: 'effect:expired_attempt_reconciled',
  ATTEMPT_CALLBACK: 'verdict:attempt_callback',
  DISPATCH_RESULT: 'result:dispatch',
  // Sprint 07231527：generator-fix callback verdict（no-progress 推导依赖）
  VERDICT_GENERATOR_FIX_CALLBACK: 'verdict:generator-fix-callback',
});

// 案卷式 GAN（issue ce42f68f）：TaskBundle 膨胀双闸的两个常量。
// 闸1：loadCaseFile 只让最近 CASE_FILE_FULL_TEXT_ROUNDS 轮带 feedback_md 全文，
// 更早轮次的 SQL 投影直接截断为 NULL，只留结构化字段（round/author_role/
// contract_sha/rubric_scores/blockers）。
export const CASE_FILE_FULL_TEXT_ROUNDS = 2;
// 闸2：dispatcher 派发前对整条 TaskBundle 做字节数体检的上限；超限即使闸1
// 已经收窄过也可能发生（round 多、单条 feedback_md 长），按 round 从旧到新
// 继续丢 feedback_md，丢完还超只告警不阻断派发。
export const HARNESS_BUNDLE_MAX_BYTES = 256 * 1024;
// 落库前每条案卷文本字段（feedback_md / blockers 里的字符串叶子值）的硬上限
// （review CHANGES REQUESTED P2-4 复审）：只是极端输入的最后防线，正常反馈
// 远小于这个值；不折行、不套用诊断日志的 2000 字符截断（那会砸烂"完整反馈
// 原文"这条设计不变量，见 attempt-store.js sanitizeCaseFileValue）。
export const CASE_FILE_TEXT_MAX_BYTES = 32 * 1024;

// 每 attempt 固定记账单价（安全网代理值，非真实成本）：
// callback schema（execution-contract.js harnessResultSchema）顶层 strip 未知键、
// 三家 provider 均不上报用量 → 真实成本当前物理不可达（判定点 1391f0c6）。
// BUDGET_CAP_USD(10) ÷ 0.25 = 40 个 attempt 触发 cap——定位是"明显异常才触发"的
// 兜底，正常收敛由案卷机制 + 趋势观测负责（决策 ba33fc68）。
export const ATTEMPT_COST_ACCRUAL_USD = 0.25;
