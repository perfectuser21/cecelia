/**
 * task-type-registry.js — 任务类型的唯一真身（铁律 76cb816c）。
 *
 * PR1 之前，Brain 里有 22 处各自手抄的 task_type 名单（派发黑名单 / 推送排除 /
 * 看门狗 / 清理保护 / 路由白名单 / 执行体打标……）。加一种类型要改 22 处，漏一处
 * 就被 tick 抢跑或被推送刷屏（device_job 当时要加两道闸才拦住）。
 *
 * 这里每个 task_type 一行声明；各消费方只 import 下面的派生集合，禁止再手抄。
 * 守卫：__tests__/task-type-registry.guard.test.js（grep 字面量名单必红）。
 *
 * 字段：
 *   surface   执行面：kernel | openclaw-agent | device | brain-internal | external | none
 *   coding    是否编码变更（走 change_kind/map_scope 校验）
 *   pr        完成是否要求 PR（false → 完成态写 completed_no_pr）
 *   executor  派发时写进 tasks.executor_kind 的值（null = 由派发路径自决）
 *   watchdog  活性判定策略名（与 executor-contracts 合同对齐）
 *   push_to_notion  是否进 Notion 投影窗口
 *   tick_dispatchable  tick 主派发谓词是否允许（false → 进 TICK_DISPATCH_EXCLUDED）
 *   cleanup_class  none | recurring | protected
 *   db        是否在 tasks_task_type_check 白名单（false = 仅用于免锚等逻辑的虚拟类型）
 *   tags      行为标签，派生集合按标签过滤（名字与替换前常量语义一一对应）
 */

const T = (surface, coding, pr, executor, watchdog, push, tick, cleanup, db, tags = []) =>
  Object.freeze({ surface, coding, pr, executor, watchdog, push_to_notion: push, tick_dispatchable: tick, cleanup_class: cleanup, db, tags: Object.freeze([...tags]) });

// 常用标签缩写
const V = 'router_valid';            // task-router VALID_TASK_TYPES
const SYS = 'system_no_prd';         // pre-flight SYSTEM_TASK_TYPES
const ANC = 'anchor_exempt';         // anchor-check ANCHOR_EXEMPT_TASK_TYPES
const ESC = 'escalation_exempt';     // escalation pauseLowPriority 内联 NOT IN（:364-379）
const CX = 'cancel_exempt';          // escalation export CANCEL_EXEMPT_TYPES（:73-83，比 ESC 多 research/suggestion_plan/content_publish）
const NIT = 'nightly_excluded';      // nightly-orchestrator NOT IN
const PW = 'pipeline_watchdog';      // pipeline-watchdog HARNESS_TASK_TYPES
const MON = 'monitor_long_running';  // monitor-loop HARNESS_TASK_TYPES
const HC = 'harness_chain';          // monitor-loop:200 HARNESS_CHAIN_TYPES（链式任务感知，检查下游任务）
const NKR = 'nightly_kr_bonus';      // nightly-orchestrator.js:122 scoreTask typeScore（KR 对齐加分名单）
// triage-officer-15min.js/triage-officer-rank.js（各1/2处）/work-routing-observability.js
// 共4处手抄 ['dev','harness_initiative']（GP 锚点体系下可编排的任务类型）。字面量恰好与
// GUIDED_TASK_TYPES（dispatch-allocation-guide GUIDE 标签）相同，但语义不同（一个是排序官/
// 观测口径，一个是分配指南）——独立打标签，不复用 GUIDE，避免两个不相关特性被意外耦合。
const GPSCOPE = 'gp_scope_task_types';
const DEVDASH = 'dev_dashboard_query';  // routes/execution.js:3721 GET /api/brain/dev/tasks 查询名单 ['dev','review']
const VERDICT = 'verdict_harness_types'; // routes/execution.js:1659 VERDICT_HARNESS_TYPES（产生 verdict 需持久化到 tasks.result 的 harness 任务类型）
const WARROOM = 'warroom_feed_types';    // routes/warroom.js:36 FEED_TYPES（战情室 feed 纳入的"有实质执行"任务类型）
const REC = 'recovery_harness';      // recovery-loop HARNESS_TASK_TYPES
const LOCK = 'initiative_lock';      // dispatcher INITIATIVE_LOCK_TASK_TYPES
const RET = 'retired_dispatch';      // dispatcher _RETIRED_HARNESS_TYPES_DISPATCH
const BP = 'backpressure_bypass';    // slot-allocator BACKPRESSURE_BYPASS_TASK_TYPES
const CODEX = 'codex_slot';          // slot-allocator countCodexInProgress
const INF = 'harness_inflight';      // slot-allocator inflight 计数
const GUIDE = 'allocation_guided';   // dispatch-allocation-guide GUIDED_TASK_TYPES
const KR = 'kernel_run_eligible';    // kernel-run-store ELIGIBLE_TASK_TYPES
const CM = 'coding_mutation';        // routes/task-tasks CODING_MUTATION_TASK_TYPES
const FC = 'family:content';         // actions.js CONTENT_TASK_TYPES
const FR = 'family:research';        // actions.js RESEARCH_TASK_TYPES
const FV = 'family:review';          // actions.js REVIEW_TASK_TYPES
const FK = 'family:coding';          // actions.js CODING_TASK_TYPES
const RECUR = 'recurring';           // task-cleanup RECURRING_TASK_TYPES
const PROT = 'protected';            // task-cleanup PROTECTED_TASK_TYPES
const AUTHSKIP = 'auth_recovery_skip'; // credential-expiry-checker SKIP_TASK_TYPES
const PIPELN = 'queue_lane_pipeline'; // task-queue-lanes PIPELINE_TASK_TYPES
const FIXMD = 'fix_mode';            // executor.js _prepareSprintPrompt isFixMode
const HV4 = 'harness_v4_generate_fix'; // executor.js _prepareSprintPrompt isHarnessV4 / _HARNESS_GENERATE_TYPES
const SPRINTDEV = 'sprint_or_harness_dev'; // executor.js _isSprintOrHarnessDevMode
const NOGOAL = 'no_goal_required';   // actions.js isSystemTask systemTypes
const ASYNCCB = 'async_callback';    // task-router.js ASYNC_CALLBACK_TYPES
// lib/review-task-types.js 的 REVIEW_TASK_TYPES 与 actions.js 的 REVIEW_TASK_TYPES（family:review
// 标签派生）语义不同：本 tag 只搬家不合并——差集是 lib/review-task-types.js 多 initiative_plan、
// 少 review/qa/audit/codex_qa/codex_test_gen/pr_review/ci_patrol/staging_e2e/harness_evaluate/
// harness_final_e2e 共 9 项。哪个该改（或该合并成一份）待主理人裁决，PR1 只做零行为变化搬家。
const REVIEWISO = 'review_isolation';
// recurring.js:221 的编码变更判定与 actions.js/routes/task-tasks.js 的 CODING_MUTATION_TASK_TYPES
// 语义不同：本 tag 只搬家不合并——差集是本 tag 缺 harness_initiative（是否该补待主理人裁决）。
const RECMUT = 'recurring_coding_mutation';

export const TASK_TYPE_REGISTRY = Object.freeze({
  // ── 通用 ──
  dev:                 T('kernel', true,  true,  'brain-local', 'kernel', true, true, 'none', true, [V, BP, GUIDE, CM, FK, RECMUT, NKR, GPSCOPE, DEVDASH, WARROOM]),
  review:              T('kernel', false, false, null, 'kernel', true, true, 'none', true, [V, FV, NKR, DEVDASH]),
  talk:                T('brain-internal', false, false, null, 'none', true, true, 'none', true, [V, ANC, FR]),
  data:                T('brain-internal', false, false, null, 'none', true, true, 'none', true, [V, ANC]),
  research:            T('brain-internal', false, false, null, 'none', true, true, 'none', true, [V, ANC, FR, CX, NOGOAL, ASYNCCB]),
  exploratory:         T('brain-internal', false, false, null, 'none', true, true, 'none', true, []),
  explore:             T('brain-internal', false, false, null, 'none', true, true, 'none', true, [V, ANC, FR, ASYNCCB]),
  knowledge:           T('brain-internal', false, false, null, 'none', true, true, 'none', true, [V, FR]),
  qa:                  T('kernel', false, false, null, 'kernel', true, true, 'none', true, [V, FV, NKR]),
  audit:               T('kernel', false, false, null, 'kernel', true, true, 'none', true, [V, FV]),
  decomp_review:       T('kernel', false, false, null, 'kernel', true, true, 'none', true, [V, FV, REVIEWISO]),
  codex_qa:            T('kernel', false, false, null, 'kernel', true, true, 'recurring', true, [V, SYS, ANC, CODEX, FV, RECUR]),
  codex_dev:           T('kernel', true,  true,  null, 'kernel', true, true, 'none', true, [V, ANC, CODEX, CM, FK, RECMUT]),
  codex_test_gen:      T('kernel', false, false, null, 'kernel', true, true, 'none', true, [V, ANC, CODEX, FV]),
  pr_review:           T('kernel', false, false, null, 'kernel', true, true, 'none', true, [V, FV]),
  code_review:         T('kernel', false, false, null, 'kernel', true, true, 'none', true, [V, SYS, ANC, FV, REVIEWISO, NKR]),
  initiative_plan:     T('brain-internal', false, false, null, 'none', true, true, 'protected', true, [V, SYS, ANC, FR, PROT, REVIEWISO]),
  initiative_verify:   T('brain-internal', false, false, null, 'none', true, true, 'protected', true, [V, SYS, ANC, FV, PROT, REVIEWISO]),
  initiative_execute:  T('kernel', true,  true,  null, 'kernel', true, true, 'none', true, [V, CM, FK, RECMUT]),
  dept_heartbeat:      T('brain-internal', false, false, null, 'none', true, true, 'recurring', true, [V, SYS, ANC, FR, RECUR]),
  suggestion_plan:     T('brain-internal', false, false, null, 'none', true, true, 'none', true, [V, FR, CX]),
  notion_synced:       T('brain-internal', false, false, null, 'none', true, true, 'none', true, []),
  architecture_design: T('kernel', false, false, null, 'kernel', true, true, 'none', true, [V, FV, REVIEWISO]),
  architecture_scan:   T('kernel', false, false, null, 'kernel', true, true, 'none', true, [V, FV, REVIEWISO]),
  arch_review:         T('kernel', false, false, null, 'kernel', true, true, 'protected', true, [V, ANC, ESC, MON, FV, PROT, CX, REVIEWISO]),
  strategy_session:    T('brain-internal', false, false, null, 'none', true, true, 'none', true, [V, FR]),
  intent_expand:       T('brain-internal', false, false, null, 'none', true, true, 'none', true, [V, FR, NOGOAL]),
  cto_review:          T('kernel', false, false, null, 'kernel', true, true, 'none', true, []),
  spec_review:         T('kernel', false, false, null, 'kernel', true, true, 'none', true, [V, SYS, ANC, FV, REVIEWISO]),
  code_review_gate:    T('kernel', false, false, null, 'kernel', true, true, 'none', true, [V, SYS, ANC, FV, REVIEWISO]),
  prd_review:          T('kernel', false, false, null, 'kernel', true, true, 'none', true, [V, SYS, ANC, FV, REVIEWISO]),
  initiative_review:   T('kernel', false, false, null, 'kernel', true, true, 'none', true, [V, SYS, ANC, FV, REVIEWISO]),
  scope_plan:          T('brain-internal', false, false, null, 'none', true, true, 'none', true, [V, FR]),
  project_plan:        T('brain-internal', false, false, null, 'none', true, true, 'none', true, [V, FR]),
  okr_initiative_plan: T('brain-internal', false, false, null, 'none', true, true, 'none', true, [V, FR]),
  okr_scope_plan:      T('brain-internal', false, false, null, 'none', true, true, 'none', true, [V, FR]),
  okr_project_plan:    T('brain-internal', false, false, null, 'none', true, true, 'none', true, [V, FR]),
  // ── 内容工厂（外部 pipeline-worker 执行，不进 tick 派发）──
  'content-pipeline':     T('external', false, false, 'external-worker', 'external-worker', true, false, 'none', true, [V, SYS, ESC, FC, CX, PIPELN, ANC, WARROOM]),
  'content-research':     T('external', false, false, 'external-worker', 'external-worker', true, false, 'none', true, [V, SYS, ESC, FC, CX, PIPELN, ANC]),
  'content-generate':     T('external', false, false, 'external-worker', 'external-worker', true, false, 'none', true, [V, SYS, ESC, FC, CX, PIPELN, ANC]),
  'content-review':       T('external', false, false, null, 'none', true, true, 'none', true, [PIPELN]),
  'content-export':       T('external', false, false, 'external-worker', 'external-worker', true, false, 'none', true, [V, SYS, ESC, FC, CX, PIPELN, ANC]),
  content_publish:        T('external', false, false, null, 'none', true, true, 'none', true, [V, SYS, BP, FC, CX, PIPELN, ANC]),
  'content-copywriting':  T('external', false, false, 'external-worker', 'external-worker', true, false, 'none', true, [V, SYS, ESC, FC, CX, PIPELN, ANC]),
  'content-copy-review':  T('external', false, false, 'external-worker', 'external-worker', true, false, 'none', true, [V, SYS, ESC, FC, CX, PIPELN, ANC]),
  'content-image-review': T('external', false, false, 'external-worker', 'external-worker', true, false, 'none', true, [V, SYS, ESC, FC, CX, PIPELN, ANC]),
  pipeline_rescue:        T('kernel', true, true, null, 'kernel', true, true, 'none', true, [CM, FK, AUTHSKIP, RECMUT]),
  // ── crystallize ──
  crystallize:          T('kernel', false, false, null, 'kernel', true, true, 'none', true, [V, SYS, ANC, CODEX]),
  crystallize_scope:    T('kernel', false, false, null, 'kernel', true, true, 'none', true, [V, SYS, ANC, CODEX]),
  crystallize_forge:    T('kernel', false, false, null, 'kernel', true, true, 'none', true, [V, SYS, ANC, CODEX]),
  crystallize_verify:   T('kernel', false, false, null, 'kernel', true, true, 'none', true, [V, SYS, ANC, CODEX]),
  crystallize_register: T('kernel', false, false, null, 'kernel', true, true, 'none', true, [V, SYS, ANC, CODEX]),
  // ── sprint（v3.x 旧）──
  sprint_planner:          T('kernel', false, false, null, 'kernel', true, true, 'none', true, [V, ESC, NIT, CX, HC]),
  sprint_contract_propose: T('kernel', false, false, null, 'kernel', true, true, 'none', true, [V, ESC, CX, HC]),
  sprint_contract_review:  T('kernel', false, false, null, 'kernel', true, true, 'none', true, [V, ESC, CX, HC]),
  sprint_generate:         T('kernel', true,  true,  null, 'kernel', true, true, 'none', true, [V, ESC, NIT, CM, FK, CX, SPRINTDEV, RECMUT, ANC, HC]),
  sprint_evaluate:         T('kernel', false, false, null, 'kernel', true, true, 'none', true, [ESC, NIT, CX, ANC]),
  sprint_fix:              T('kernel', true,  true,  null, 'kernel', true, true, 'none', true, [V, ESC, CM, FK, CX, SPRINTDEV, FIXMD, RECMUT, ANC, HC]),
  sprint_report:           T('kernel', false, false, null, 'kernel', true, true, 'none', true, [V, ANC, HC]),
  cecelia_event:           T('brain-internal', false, false, null, 'none', true, true, 'none', true, []),
  // ── harness ──
  harness_planner:          T('kernel', false, false, null, 'kernel', true, true, 'protected', true, [SYS, ANC, ESC, NIT, PW, MON, REC, LOCK, RET, BP, PROT, CX, HC]),
  harness_contract_propose: T('kernel', false, false, null, 'kernel', true, true, 'protected', true, [V, SYS, ANC, ESC, NIT, PW, MON, REC, LOCK, BP, PROT, CX, HC, VERDICT]),
  harness_contract_review:  T('kernel', false, false, null, 'kernel', true, true, 'protected', true, [V, SYS, ANC, ESC, NIT, PW, MON, REC, LOCK, BP, PROT, CX, HC, VERDICT]),
  harness_generate:         T('kernel', true,  true,  null, 'kernel', true, true, 'protected', true, [V, SYS, ANC, ESC, NIT, PW, MON, REC, FK, PROT, CM, CX, HV4, RECMUT, HC]),
  harness_generator:        T('kernel', true,  true,  null, 'kernel', true, true, 'none', true, [REC]),
  harness_ci_watch:         T('brain-internal', false, false, null, 'none', true, false, 'protected', true, [V, ESC, PW, RET, BP, PROT, CX, PIPELN]),
  harness_evaluate:         T('kernel', false, false, null, 'kernel', true, true, 'none', true, [V, SYS, ANC, ESC, NIT, PW, REC, FV, CX, VERDICT]),
  harness_fix:              T('kernel', true,  true,  null, 'kernel', true, true, 'protected', true, [V, SYS, ANC, ESC, NIT, PW, MON, REC, LOCK, RET, BP, FK, PROT, CM, CX, FIXMD, HV4, RECMUT, HC]),
  harness_deploy_watch:     T('brain-internal', false, false, null, 'none', true, false, 'protected', true, [V, ESC, PW, BP, PROT, CX, PIPELN]),
  harness_report:           T('kernel', false, false, null, 'kernel', true, true, 'protected', true, [V, SYS, ANC, ESC, NIT, PW, PROT, CX, HC]),
  platform_scraper:         T('brain-internal', false, false, null, 'none', true, true, 'none', true, [V, WARROOM]),
  harness_initiative:       T('kernel', true,  true,  'relay-container', 'kernel', true, true, 'none', true, [V, SYS, ANC, ESC, REC, LOCK, INF, BP, GUIDE, KR, CM, FK, GPSCOPE, WARROOM]),
  harness_task:             T('kernel', false, false, null, 'kernel', true, true, 'none', true, [V, SYS, ANC, ESC, REC, LOCK, RET, BP]),
  harness_final_e2e:        T('kernel', false, false, null, 'kernel', true, true, 'none', true, [V, SYS, ANC, RET, FV]),
  trigger_backup:           T('brain-internal', false, false, null, 'none', true, true, 'none', true, []),
  harness_intervention:     T('brain-internal', false, false, null, 'none', true, true, 'none', true, [V]),
  staging_e2e:              T('brain-internal', false, false, null, 'none', true, true, 'none', true, [V, ANC, FV]),
  skill_eval:               T('brain-internal', false, false, null, 'none', true, true, 'none', true, []),
  ci_patrol:                T('brain-internal', false, false, null, 'none', true, true, 'none', true, [V, ANC, FV]),
  golden_path_proposal:     T('kernel', false, false, 'relay-container', 'kernel', true, true, 'none', true, [V, LOCK, INF, KR, ANC]),
  strategist_decision:      T('brain-internal', false, false, null, 'none', true, true, 'none', true, [V, ANC, FR]),
  workflow_run:             T('external', false, false, null, 'none', true, true, 'none', true, []),
  device_job:               T('device', false, false, null, 'external-worker', false, false, 'none', true, []),
  // ── 本刀新增：秋米中文 GTD 表来的非编码任务，Brain 经 ssh 在 MMV 起 openclaw agent ──
  // PR1 不进 V（router_valid）：task-router.js 的路由细节（SKILL_WHITELIST/LOCATION_MAP/
  // TASK_REQUIREMENTS）与 DB CHECK 迁移 459 都还没接线，V 标签留给 PR2 入口刀开启。
  qiumi_task:               T('openclaw-agent', false, false, 'openclaw-agent', 'openclaw-agent', true, true, 'none', true, []),
  // ── 虚拟类型（不在 DB 白名单，只用于免锚判断）──
  deploy_drill:       T('none', false, false, null, 'none', false, false, 'none', false, [ANC]),
  nightly:            T('none', false, false, null, 'none', false, false, 'none', false, [ANC]),
  janitor:            T('none', false, false, null, 'none', false, false, 'none', false, [ANC]),
  harness_controller: T('none', false, false, null, 'none', false, false, 'none', false, [ANC]),
});

export function getTaskType(type) {
  return TASK_TYPE_REGISTRY[type] ?? null;
}

/** 按标签派生（保持注册表声明顺序，冻结）。 */
export function tagged(tag) {
  return Object.freeze(
    Object.entries(TASK_TYPE_REGISTRY).filter(([, e]) => e.tags.includes(tag)).map(([k]) => k),
  );
}

// ── 派生集合：名字与替换前各消费方的常量一一对应 ──
export const TICK_DISPATCH_EXCLUDED = Object.freeze(
  Object.entries(TASK_TYPE_REGISTRY).filter(([, e]) => e.db && !e.tick_dispatchable).map(([k]) => k),
);
export const INITIATIVE_LOCK_TASK_TYPES = tagged(LOCK);
export const RETIRED_HARNESS_TYPES_DISPATCH = tagged(RET);
export const GUIDED_TASK_TYPES = tagged(GUIDE);
export const BACKPRESSURE_BYPASS_TASK_TYPES = tagged(BP);
export const CODEX_SLOT_TASK_TYPES = tagged(CODEX);
export const HARNESS_INFLIGHT_TASK_TYPES = tagged(INF);
export const SYSTEM_TASK_TYPES = tagged(SYS);
export const VALID_TASK_TYPES = tagged(V);
export const CONTENT_TASK_TYPES = tagged(FC);
export const RESEARCH_TASK_TYPES = tagged(FR);
export const REVIEW_TASK_TYPES = tagged(FV);
export const CODING_TASK_TYPES = tagged(FK);
export const CODING_MUTATION_TASK_TYPES = tagged(CM);
export const PUSH_EXCLUDED_TASK_TYPES = Object.freeze(
  Object.entries(TASK_TYPE_REGISTRY).filter(([, e]) => e.db && !e.push_to_notion).map(([k]) => k),
);
export const KERNEL_RUN_ELIGIBLE_TASK_TYPES = tagged(KR);
export const ANCHOR_EXEMPT_TASK_TYPES = tagged(ANC);
export const MONITOR_LONG_RUNNING_TASK_TYPES = tagged(MON);
/** monitor-loop.js:200 原内联 HARNESS_CHAIN_TYPES（harness/sprint 链式任务感知，检查下游任务是否已派生）。 */
export const HARNESS_CHAIN_TASK_TYPES = tagged(HC);
/** nightly-orchestrator.js:122 原内联 scoreTask KR 对齐加分名单。 */
export const NIGHTLY_KR_BONUS_TASK_TYPES = tagged(NKR);
/** triage-officer-15min.js / triage-officer-rank.js / work-routing-observability.js 原内联 ['dev','harness_initiative']。 */
export const GP_SCOPE_TASK_TYPES = tagged(GPSCOPE);
/** routes/execution.js:3721 GET /api/brain/dev/tasks 原内联 ['dev','review']。 */
export const DEV_DASHBOARD_TASK_TYPES = tagged(DEVDASH);
/** routes/execution.js:1659 原内联 VERDICT_HARNESS_TYPES。 */
export const VERDICT_HARNESS_TASK_TYPES = tagged(VERDICT);
/** routes/warroom.js:36 原内联 FEED_TYPES。 */
export const WARROOM_FEED_TASK_TYPES = tagged(WARROOM);
/**
 * auto-learning.js:20 原内联 VALUABLE_TASK_TYPES——含 'feature'，从不是真实 task_type
 * （grep 全库无一处 INSERT/CHECK 用过 'feature'，registry 里也没有这个 key），不能用
 * tagged() 派生（tagged() 只能筛注册表已声明的 key）。原样保留为纯字面量导出（PR1 零行为
 * 变化），'feature' 的存废待主理人裁决。
 */
export const VALUABLE_LEARNING_TASK_TYPES = Object.freeze(['dev', 'feature', 'research', 'harness_initiative']);
/** crystallize-orchestrator.js:54 原导出 CRYSTALLIZE_STAGES（有序四阶段，crystallize 基础类型不在其中）。 */
export const CRYSTALLIZE_ORCHESTRATOR_STAGES = Object.freeze([
  'crystallize_scope',
  'crystallize_forge',
  'crystallize_verify',
  'crystallize_register',
]);
/** crystallize-orchestrator.js:278 原内联 stageLabels（阶段推进日志展示用）。 */
export const CRYSTALLIZE_ORCHESTRATOR_STAGE_LABELS = Object.freeze({
  crystallize_forge: 'Forge',
  crystallize_verify: 'Verify',
  crystallize_register: 'Register',
});
/** cron/daily-real-business-smoke.js:42 原内联 STAGE_ORDER（内容工厂 smoke 用于定位失败阶段的执行顺序）。 */
export const DAILY_SMOKE_STAGE_ORDER = Object.freeze([
  'content-research',
  'content-copywriting',
  'content-copy-review',
  'content-generate',
  'content-image-review',
  'content-export',
]);

// ── 展示用 stage 顺序/标签（不进 T()/tagged()：混杂了非 task_type 的 UI 阶段名
//    如 harness_auto_merge/harness_deploy/harness_smoke_test/harness_cleanup，
//    是 pipeline 展示顺序而非"哪类 task_type"的行为标签；顺序本身也是展示语义，
//    塞进 tagged() 按注册表声明顺序重排会打乱展示顺序）。逐字搬自原消费方文件。

/** routes/harness.js:702 buildStages() 原内联 STAGE_ORDER（10步 Harness 展示，混合真实
 *  task_type 与展示专用伪阶段名，harness_planner 已退役未列入）。 */
export const HARNESS_BUILD_STAGE_ORDER = Object.freeze([
  'harness_contract_propose', 'harness_contract_review',
  'harness_generate', 'harness_evaluate', 'harness_report',
  'harness_auto_merge', 'harness_deploy', 'harness_smoke_test', 'harness_cleanup',
]);
/** routes/harness.js:707 buildStages() 原内联 STAGE_LABELS（与上面顺序一一对应）。 */
export const HARNESS_BUILD_STAGE_LABELS = Object.freeze({
  harness_contract_propose: 'Propose',
  harness_contract_review: 'Review',
  harness_generate: 'Generate',
  harness_evaluate: 'Evaluate',
  harness_report: 'Report',
  harness_auto_merge: 'Auto-merge',
  harness_deploy: 'Deploy',
  harness_smoke_test: 'Smoke-test',
  harness_cleanup: 'Cleanup',
});

/** routes/status.js:334 GET /api/brain/harness-pipelines 原内联 HARNESS_STAGE_ORDER
 *  （5步汇总列表，与上面 buildStages 的 9 步不同集合——各自独立展示用途，不合并）。 */
export const HARNESS_PIPELINE_LIST_STAGE_ORDER = Object.freeze([
  'harness_contract_propose',
  'harness_contract_review',
  'harness_generate',
  'harness_ci_watch',
  'harness_report',
]);
/** routes/status.js:342 原内联 HARNESS_STAGE_LABELS。 */
export const HARNESS_PIPELINE_LIST_STAGE_LABELS = Object.freeze({
  harness_contract_propose: 'Propose',
  harness_contract_review: 'Review',
  harness_generate: 'Generate',
  harness_ci_watch: 'CI Watch',
  harness_report: 'Report',
});
/**
 * routes/execution.js:3006 GET /status US 机展示 task_types；learning.js:571,590 共用同一
 * 字面量（3处手抄）。展示顺序有意义（前端按此顺序渲染），不用 tagged() 派生（那会按注册表
 * 声明顺序重排，[dev,review,qa,audit] 恰好与声明顺序一致，但下面的 HK 列表不是——为避免两者
 * 处理方式不一致引发误解，US/HK 都用固定顺序的纯字面量导出，registry.js 本身不在守卫扫描
 * 范围内（guard.lib.js walk() 显式排除 REGISTRY 自身），单处手抄即满足"唯一真身"。
 */
export const EXEC_STATUS_US_TASK_TYPES = Object.freeze(['dev', 'review', 'qa', 'audit']);
/** routes/execution.js:3025 GET /status HK 机展示 task_types（原字面量顺序 talk→research→data）。 */
export const EXEC_STATUS_HK_TASK_TYPES = Object.freeze(['talk', 'research', 'data']);
export const PIPELINE_WATCHDOG_TASK_TYPES = tagged(PW);
export const RECOVERY_HARNESS_TASK_TYPES = tagged(REC);
export const RECURRING_TASK_TYPES = tagged(RECUR);
export const PROTECTED_TASK_TYPES = tagged(PROT);
export const ESCALATION_EXEMPT_TASK_TYPES = tagged(ESC);
export const CANCEL_EXEMPT_TYPES = tagged(CX);
export const AUTH_RECOVERY_SKIP_TASK_TYPES = tagged(AUTHSKIP);
export const NIGHTLY_EXCLUDED_TASK_TYPES = tagged(NIT);
export const PIPELINE_TASK_TYPES = tagged(PIPELN);
export const FIX_MODE_TASK_TYPES = tagged(FIXMD);
export const HARNESS_V4_TASK_TYPES = tagged(HV4);
export const SPRINT_HARNESS_DEV_TASK_TYPES = tagged(SPRINTDEV);
/** executor==='external-worker' 的 task_type（executor.js 的 CONTENT_PIPELINE_TYPES：内容工厂由外部 pipeline-worker 执行，liveness 探针需跳过）。 */
export const CONTENT_PIPELINE_TYPES = Object.freeze(
  Object.entries(TASK_TYPE_REGISTRY).filter(([, e]) => e.executor === 'external-worker').map(([k]) => k),
);
export const NO_GOAL_TASK_TYPES = tagged(NOGOAL);
export const ASYNC_CALLBACK_TASK_TYPES = tagged(ASYNCCB);
/** lib/review-task-types.js 的 REVIEW_TASK_TYPES（与 actions.js REVIEW_TASK_TYPES 语义不同，见上方 REVIEWISO 定义处注释）。 */
export const REVIEW_ISOLATION_TASK_TYPES = tagged(REVIEWISO);
/** recurring.js:221 的编码变更判定（与 CODING_MUTATION_TASK_TYPES 语义不同，见上方 RECMUT 定义处注释）。 */
export const RECURRING_CODING_MUTATION_TASK_TYPES = tagged(RECMUT);
export const DB_WHITELISTED_TASK_TYPES = Object.freeze(
  Object.entries(TASK_TYPE_REGISTRY).filter(([, e]) => e.db).map(([k]) => k),
);
/** task_type → executor_kind（只含声明了 executor 的类型；路径 sentinel 由 executor-contracts 自己补）。 */
export const EXECUTOR_KIND_FOR_TASK_TYPE = Object.freeze(
  Object.fromEntries(Object.entries(TASK_TYPE_REGISTRY).filter(([, e]) => e.executor).map(([k, e]) => [k, e.executor])),
);

// ── task_type → 值 的独立映射（不接入 T()/tagged()：每个值都是该 task_type 专属的
//    路由/权限细节，不是"属于哪一类"的行为标签，硬塞进 T() 的 tags 反而混淆语义）。
//    这些表逐字搬自原消费方文件（PR1 Task 3 裁决后），consuming 方只 import，不再手抄。

/** task-router.js SKILL_WHITELIST：task_type → 调用的 skill 名。 */
export const SKILL_WHITELIST = Object.freeze({
  'dev': '/dev',
  'review': '/code-review',
  'talk': '/cecelia',
  'data': '/sync-hk',
  'qa': '/code-review',
  'audit': '/code-review',
  'research': '/research',
  'explore': '/explore',
  'knowledge': '/knowledge',
  'codex_qa': '/codex',
  'codex_dev': '/dev',  // Codex Provider 跑 /dev — 与 dev 相同 skill，通过 runner.sh 执行
  'crystallize': '/playwright',         // crystallize 编排入口 — 西安 M4 CDP 控制 PC
  'crystallize_scope': '/playwright',   // Scope 阶段：定义目标 + DoD
  'crystallize_forge': '/playwright',   // Forge 阶段：Codex 探索写脚本
  'crystallize_verify': '/playwright',  // Verify 阶段：无 LLM 验证3次
  'crystallize_register': '/playwright', // Register 阶段：注册到 SKILL.md
  'codex_test_gen': '/codex-test-gen',  // Codex 自动生成测试 — 西安 M4 扫描覆盖率低模块
  'pr_review': '/review',  // 异步 PR 审查 → 西安 Codex 独立 LLM 审查
  'code_review': '/code-review',
  'decomp_review': '/decomp-check',
  'dept_heartbeat': '/cecelia',
  'initiative_plan': '/decomp',
  'initiative_verify': '/arch-review verify',
  'suggestion_plan': '/plan',
  'architecture_design': '/architect design',
  'architecture_scan': '/architect scan',
  'arch_review': '/arch-review review',
  'strategy_session': '/strategy-session',
  // 前置审查（Intent Expansion）
  'intent_expand': '/intent-expand',  // 意图扩展 → US 本机，查 OKR/Vision 链路补全 PRD
  // Initiative 执行
  'initiative_execute': '/dev',       // Initiative 执行 → US 本机，/dev 全流程
  // 内容工厂 Pipeline（Content Factory）
  'content-pipeline': '/content-creator',
  'content-research': '/notebooklm',
  'content-copywriting': '/content-creator',
  'content-copy-review': '/content-creator',
  'content-generate': '/content-creator',
  'content-image-review': '/content-creator',
  'content-export': '/content-creator',
  'content_publish': '/content-creator',  // 发布阶段 → executor 按 payload.platform 路由到对应 publisher skill
  // Codex Gate 审查任务类型
  'prd_review': '/prd-review',              // PRD 审查
  'spec_review': '/spec-review',            // Spec 审查
  'code_review_gate': '/code-review-gate',  // 代码质量门禁
  'initiative_review': '/initiative-review', // Initiative 整体审查
  // Harness v3.x 旧类型（向后兼容）
  'sprint_planner': '/sprint-planner',
  'sprint_contract_propose': '/sprint-contract-proposer',
  'sprint_contract_review': '/sprint-contract-reviewer',
  'sprint_generate': '/dev',
  'sprint_fix': '/dev',
  'sprint_report': '/sprint-report',
  // Harness v4.0 新类型
  // 注：harness_planner 已退役（PR retire-harness-planner，2026-04-26）
  'harness_contract_propose': '/harness-contract-proposer',   // Layer 2a: 提合同草案
  'harness_contract_review': '/harness-contract-reviewer',    // Layer 2b: 挑战合同
  'harness_generate': '/harness-generator',                   // Layer 3a: Generator 写代码
  'ci_patrol': '/ci-patrol',
  'strategist_decision': '/line-strategist',
  'harness_ci_watch': '/_internal',                           // Brain tick 内联处理（不派 agent）
  'harness_fix': '/harness-generator',                        // Layer 3d: Generator 修复（同 generator skill）
  'harness_deploy_watch': '/_internal',                       // Brain tick 内联处理（不派 agent）
  'harness_evaluate': '/harness-evaluator',                   // FIX (P0) Layer 3e: Evaluator 对抗性功能验收（运行中应用 curl/Playwright）
  'harness_report': '/harness-report',                        // Layer 4: 最终报告
  'staging_e2e': '/_internal',                                // Slice9: native 执行（executor 短路），不派 agent
  'harness_intervention': '/_internal',                       // 人工干预任务类型（Brain 内部处理）
  // Scope 层飞轮（Project→Scope→Initiative）
  'scope_plan': '/decomp',        // Scope 内规划下一个 Initiative
  'project_plan': '/decomp',      // Project 内规划下一个 Scope
  // OKR 新表飞轮（okr_projects→okr_scopes→okr_initiatives）
  'okr_initiative_plan': '/decomp',  // OKR Scope 内规划下一个 Initiative
  'okr_scope_plan': '/decomp',       // OKR Project 内规划下一个 Scope
  'okr_project_plan': '/decomp',     // OKR Project 层完成后规划
  // 发布后数据回收（Brain 内部处理，声明 skill 避免路由校验失败）
  'platform_scraper': '/media-scraping',
  // Harness v2 新类型（M1 复用现有 skill，M2/M5 会重写）
  'harness_initiative': '/harness-planner',   // 阶段 A — M1 复用 planner skill
  'harness_task': '/_internal',               // 阶段 B — Brain tick 内部状态机，不派 agent
  'harness_final_e2e': '/harness-evaluator',  // 阶段 C — M1 复用 evaluator skill
  'golden_path_proposal': '/capability-controller', // GP 提案 — relay 实际 spawn skill 由 harness-skill-relay 映射
});

/** task-router.js LOCATION_MAP：task_type → 执行地点（us=US Mac mini，xian=西安 Mac mini）。 */
export const LOCATION_MAP = Object.freeze({
  'dev': 'us',        // 写代码 → US (Nobel + Opus + /dev)
  'review': 'us',     // 代码审查 → US (Sonnet + /review)
  'qa': 'us',         // QA → US (Sonnet)
  'audit': 'us',      // 审计 → US (Sonnet)
  'codex_qa': 'xian',  // Codex 免疫检查 → 西安 Mac mini (Codex CLI via codex-bridge)
  'codex_dev': 'xian', // Codex /dev → 西安 Mac mini (runner.sh + devloop-check.sh SSOT)
  // crystallize 能力蒸馏流水线 → 西安 M4 (playwright-runner.sh + CDP → PC)
  'crystallize': 'xian',
  'crystallize_scope': 'xian',
  'crystallize_forge': 'xian',
  'crystallize_verify': 'xian',
  'crystallize_register': 'xian',
  'codex_test_gen': 'xian',   // 自动生成测试 → 西安 M4 (Codex 扫描覆盖率低模块 + 生成测试)
  'pr_review': 'xian',  // 异步 PR 审查 → 西安 Mac mini (MiniMax via Codex CLI, 独立账号)
  'code_review': 'us',      // 代码审查 → US 本机 Codex (需读代码上下文，/code-review skill)
  'decomp_review': 'us',    // 拆解审查 → US 本机 Codex (需读代码结构，Vivian 角色)
  'dept_heartbeat': 'us',   // 部门心跳 → US (MiniMax-M2.5-highspeed via cecelia-run)
  'initiative_plan': 'us',        // Initiative 规划 → US 本机 Codex (需读现有代码，/decomp skill)
  'initiative_verify': 'us',      // Initiative 验收 → US 本机 Codex (需核查代码实现，/arch-review verify)
  'suggestion_plan': 'xian',      // Suggestion 层级识别 → 西安 Codex (B類纯策略，/plan skill)
  'architecture_design': 'us',    // Architecture 设计 → US 本机 Codex (需读代码，/architect design)
  'architecture_scan': 'us',      // 系统扫描 → US 本机 Codex (需读代码，/architect scan)
  'arch_review': 'us',             // 架构巡检 → US 本机（需读本地代码+DB，/arch-review review）
  'strategy_session': 'xian',     // 战略会议 → 西安 Codex (B類，/strategy-session)
  'intent_expand': 'us',          // 意图扩展 → US 本机（需读本地 Brain DB，补全 PRD）
  'initiative_execute': 'us',     // Initiative 执行 → US 本机（/dev 全流程，A類）
  'explore': 'xian',  // 快速调研 → 西安 Codex (general，任意可用机器)
  'knowledge': 'xian',  // 知识记录 → 西安 Codex (B類，/knowledge skill)
  'talk': 'xian',     // 对话 → 西安 Codex (general，任意可用机器)
  'research': 'xian', // 深度调研 → 西安 Codex (general，任意可用机器)
  'data': 'xian',     // 数据处理 → 西安 Codex (general)
  // 内容工厂 Pipeline（Content Factory）→ 西安 Codex 执行
  'content-pipeline': 'xian',  // Pipeline 编排入口 → 西安 Codex
  'content-research': 'xian',  // 调研阶段 → 西安 (/notebooklm)
  'content-copywriting': 'xian', // 文案生成 → 西安 (/content-creator)
  'content-copy-review': 'xian', // 文案审核 → 西安（纯规则检查）
  'content-generate': 'xian',  // 图片生成 → 西安 (/content-creator)
  'content-image-review': 'xian', // 图片审核 → 西安（规则+视觉检查）
  'content-export': 'xian',    // 导出阶段 → 西安 (card-renderer.mjs)
  'content_publish': 'us',     // 发布阶段 → US 本机（publisher skills 需要浏览器 CDP，在 US Mac mini 跑）
  // Harness v3.x 旧类型（向后兼容）→ US 本机
  'sprint_planner': 'us',
  'sprint_contract_propose': 'us',
  'sprint_contract_review': 'us',
  'sprint_generate': 'us',
  'sprint_fix': 'us',
  'sprint_report': 'us',
  // Harness v4.0 → US 本机
  'harness_contract_propose': 'us',   // Layer 2a: Generator 提合同草案 → US
  'harness_contract_review': 'us',    // Layer 2b: Evaluator 挑战合同 → US
  'harness_generate': 'us',           // Layer 3a: Generator 写代码 → US
  'ci_patrol': 'us',  // CI 巡检 → US 本机（需读本地 repo + gh + Brain DB）
  'strategist_decision': 'us',  // line-strategist 需读 git 历史 + decisions API → US
  'harness_ci_watch': 'us',           // Layer 3b: CI 监控（Brain tick 内联处理）→ US
  'harness_fix': 'us',                // Layer 3d: Generator 修复 → US
  'harness_deploy_watch': 'us',       // Layer 3e: Deploy 监控（Brain tick 内联处理）→ US
  'harness_report': 'us',             // Layer 4: 最终报告 → US
  // Codex Gate 审查任务类型 → US 本机（需读 worktree diff + Brain DB）
  'prd_review': 'us',            // PRD 审查 → US 本机 Codex
  'spec_review': 'us',           // Spec 审查 → US 本机 Codex
  'code_review_gate': 'us',      // 代码质量门禁 → US 本机 Codex
  'initiative_review': 'us',     // Initiative 整体审查 → US 本机 Codex
  // Scope 层飞轮
  'scope_plan': 'xian',            // Scope 规划 → 西安 Codex (B類，/decomp skill)
  'project_plan': 'xian',          // Project 规划 → 西安 Codex (B類，/decomp skill)
  // OKR 新表飞轮
  'okr_initiative_plan': 'xian',   // OKR Initiative 规划 → 西安 Codex (B類，/decomp skill)
  'okr_scope_plan': 'xian',        // OKR Scope 规划 → 西安 Codex (B類，/decomp skill)
  'okr_project_plan': 'xian',      // OKR Project 规划 → 西安 Codex (B類，/decomp skill)
  'pipeline_rescue': 'us',        // Pipeline 救援 → US 本机（需读 .dev-mode + worktree）
  'platform_scraper': 'us',       // 数据采集任务 → Brain 内部处理（不走外部 executor，见 post-publish-data-collector.js）
  // Harness v2 → US 本机
  'harness_initiative': 'us',     // 阶段 A 入口（复用 planner skill 运行 /dev）
  'golden_path_proposal': 'us',   // GP 提案 → US 本机 relay（同 harness_initiative 路径）
  'harness_task': 'us',           // 阶段 B 单 Task（tick 内部，US Brain 处理）
  'harness_final_e2e': 'us',      // 阶段 C 最终 E2E（复用 evaluator skill）
  'harness_evaluate': 'us',      // Layer 3e: Evaluator 对抗性功能验收 → US
  'harness_intervention': 'us', // 人工干预任务类型 → US 本机处理
  'staging_e2e': 'us',          // Slice9: staging E2E native 执行 → US 本机
});

/** task-router.js TASK_REQUIREMENTS：task_type → 机器能力需求标签数组。 */
export const TASK_REQUIREMENTS = Object.freeze({
  // A类 - 需要 git/代码访问（US M4 独有）
  'dev':                ['has_git'],
  'ci_patrol':          ['has_git'],
  'strategist_decision':['has_git'],
  'review':             ['has_git'],
  'qa':                 ['has_git'],
  'audit':              ['has_git'],
  'code_review':        ['has_git'],
  'decomp_review':      ['has_git'],
  'initiative_plan':    ['has_git'],
  'initiative_verify':  ['has_git'],
  'arch_review':        ['has_git'],
  'architecture_design':['has_git'],
  'architecture_scan':  ['has_git'],
  'prd_review':         ['has_git'],
  'spec_review':        ['has_git'],
  'code_review_gate':   ['has_git'],
  'initiative_review':  ['has_git'],
  'intent_expand':      ['has_git'],
  'initiative_execute': ['has_git'],
  'pipeline_rescue':    ['has_git'],
  'codex_dev':          ['has_git'],
  // 需要浏览器（crystallize 各阶段均通过 CDP 控制西安 PC 浏览器）
  'crystallize':          ['has_browser'],
  'crystallize_scope':    ['has_browser'],
  'crystallize_forge':    ['has_browser'],
  'crystallize_verify':   ['has_browser'],
  'crystallize_register': ['has_browser'],
  // B类通用 - 任意 general 机器
  'codex_qa':           ['general'],
  'codex_test_gen':     ['general'],
  'pr_review':          ['general'],
  'suggestion_plan':    ['general'],
  'strategy_session':   ['general'],
  'scope_plan':         ['general'],
  'project_plan':       ['general'],
  'okr_initiative_plan': ['general'],
  'okr_scope_plan':     ['general'],
  'okr_project_plan':   ['general'],
  'knowledge':          ['general'],
  'talk':               ['general'],
  'research':           ['general'],
  'explore':            ['general'],
  'data':               ['general'],
  'dept_heartbeat':     ['general'],
  'content-pipeline':   ['general'],
  'content-research':   ['general'],
  'content-copywriting': ['general'],
  'content-copy-review': ['general'],
  'content-generate':   ['general'],
  'content-image-review': ['general'],
  'content-export':     ['general'],
  'platform_scraper':   ['has_browser'],  // 需要 CDP 浏览器接入各平台
  'content_publish':    ['has_browser'],  // 发布 skill（douyin/kuaishou 等）需要 CDP 浏览器控制
  // Harness v4.0 — 需要 git 访问（US M4 独有）
  'harness_contract_propose': ['has_git'],
  'harness_contract_review':  ['has_git'],
  'harness_generate':         ['has_git'],
  'harness_ci_watch':         ['has_git'],
  'harness_fix':              ['has_git'],
  'harness_deploy_watch':     ['has_git'],
  'harness_report':           ['has_git'],
  // Harness v2 — 需要 git 访问（US M4）
  'harness_initiative':       ['has_git'],
  'golden_path_proposal':     ['has_git'],
  'harness_task':             ['has_git'],
  'harness_final_e2e':        ['has_git'],
});

/**
 * executor.js 私有 skillMap（`getSkillForTaskType` 内联）：task_type → skill 名。
 * 与上面 SKILL_WHITELIST 语义重叠（都是"task_type 该调哪个 skill"）但值不完全一致
 * （如 talk: SKILL_WHITELIST='/cecelia' 此表='/talk'；research: SKILL_WHITELIST=
 * '/research' 此表=''）——PR1 只搬家不合并，两份历史上就是独立维护，差异待主理人裁决
 * 是否该合并成一份。搬家后仍保持独立导出，消费方各自 import 各自的，零行为变化。
 */
export const EXECUTOR_SKILL_MAP = Object.freeze({
  'dev': '/dev',           // 写代码：Opus
  'review': '/code-review', // 审查：已迁移到 /code-review
  'qa_init': '/review init', // QA 初始化：设置 CI 和分支保护
  'talk': '/talk',         // 对话：写文档，不改代码
  'research': '',          // 研究：完全只读，不挂 skill，由 preparePrompt 直接构建 prompt
  'dept_heartbeat': '/repo-lead heartbeat', // 部门主管心跳：MiniMax
  'code_review': '/code-review', // 代码审查：Sonnet + /code-review skill
  'ci_patrol': '/ci-patrol', // CI/CD 巡检：每日按 line 报硬伤（ci-patrol skill）
  // Initiative 执行循环
  'initiative_plan': '/decomp',     // Phase 2 规划下一个 PR：/decomp
  'initiative_verify': '/architect', // Initiative 收尾验收 → /architect Mode 3
  'decomp_review': '/decomp-check', // 拆解质检：/decomp-check
  // Suggestion 驱动的自主规划
  'suggestion_plan': '/plan',       // Suggestion 层级识别 → /plan skill
  // Architecture 设计
  'architecture_design': '/architect', // Initiative 级架构设计 → /architect skill
  // 战略会议：C-Suite 模拟讨论，输出带 domain 的 KR
  'strategy_session': '/strategy-session',
  // 内容工厂 Pipeline（Content Factory）
  'content-pipeline': '/content-creator',      // 编排入口：触发完整内容生成流程
  'content-research': '/notebooklm',           // 调研阶段：NotebookLM 深度调研
  'content-copywriting': '/content-creator',   // 文案生成阶段
  'content-copy-review': '/content-creator',   // 文案审核阶段
  'content-generate': '/content-creator',      // 生成阶段：图片+文案生成
  'content-image-review': '/content-creator',  // 图片审核阶段
  'content-review': '/content-creator',        // 审核阶段：AI 质量评分
  'content-export': '/content-creator',        // 导出阶段：NAS 存储 + manifest
  // 旧类型向后兼容 → 统一走 /code-review
  'qa': '/code-review',
  'audit': '/code-review',
  // 前置审查
  'intent_expand': '/intent-expand',  // 意图扩展：查 OKR/Vision 链路补全 PRD
  // Initiative 执行
  'initiative_execute': '/dev',       // Initiative 执行：/dev 全流程
  // 多平台发布（payload.platform 动态路由，见上方特判逻辑）
  'content_publish': '/dev',          // fallback：正常由上方平台路由拦截
  // Codex Gate 审查任务类型（替代旧的多步审查流程）
  'prd_review': '/prd-review',              // PRD 审查
  'spec_review': '/spec-review',            // Spec 审查
  'code_review_gate': '/code-review-gate',  // 代码质量门禁
  'initiative_review': '/initiative-review', // Initiative 整体审查
  // Scope 层飞轮（Project→Scope→Initiative）
  'scope_plan': '/decomp',        // Phase 3: Scope 内规划下一个 Initiative
  'project_plan': '/decomp',      // Phase 4: Project 内规划下一个 Scope
  'pipeline_rescue': '/dev',       // 卡住的 pipeline 接管修复 → /dev 全流程
  'codex_test_gen': '/codex-test-gen',  // Codex 自动生成测试 → 西安 M4
  'platform_scraper': '/media-scraping', // 平台数据采集 → CN Mac mini (/media-scraping skill)
  'strategist_decision': '/line-strategist',  // Line 军师决策（PR3674 终态钩子派发，见 line-strategist-dispatch.js）
});

/** executor.js 私有 modeMap（`getPermissionModeForTaskType` 内联）：task_type → Claude 权限模式。 */
export const EXECUTOR_MODE_MAP = Object.freeze({
  'dev': 'bypassPermissions',        // 写代码
  'review': 'bypassPermissions',     // 已迁移到 /code-review，需写报告
  'talk': 'bypassPermissions',       // 要调 API 写数据库
  'research': 'bypassPermissions',   // 要调 API
  'code_review': 'bypassPermissions', // 需要写报告文件到 docs/reviews/
  // 旧类型向后兼容 → 统一走 /code-review
  'qa': 'bypassPermissions',
  'audit': 'bypassPermissions',
});
