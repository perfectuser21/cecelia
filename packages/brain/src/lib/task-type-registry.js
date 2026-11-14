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
 *   surface   执行面：kernel | codex-bridge | codex-review | openclaw-agent | script | device | brain-internal | external | none
 *             会被 tick 派发的类型，surface 必须等于真实路由（lib/dispatch-route.js resolveDispatchRoute，
 *             守卫 lib/__tests__/dispatch-route.test.js）；none = 无头无可用执行者，queued 建单即拒（任务 0a70684f）
 *   coding    是否编码变更（走 change_kind/map_scope 校验）
 *   pr        完成是否要求 PR（false → 完成态写 completed_no_pr）
 *   executor  派发时写进 tasks.executor_kind 的值（null = 由派发路径自决）
 *   watchdog  活性判定策略名（与 executor-contracts 合同对齐）
 *   push_to_notion  是否进 Notion 投影窗口
 *   tick_dispatchable  tick 主派发谓词是否允许（false → 进 TICK_DISPATCH_EXCLUDED）
 *   cleanup_class  none | recurring | protected
 *   db        是否在 tasks_task_type_check 白名单（false = 仅用于免锚等逻辑的虚拟类型）
 *   tags      行为标签，派生集合按标签过滤（名字与替换前常量语义一一对应）
 *   kind      任务的第一维度（决策 df67a9d6，落 tasks.kind 真列，迁移 466）：
 *             agent    = 一个执行方一步交付（agent 会话 / 脚本 / 设备领单器 / Brain 内联都算「一步」）
 *             workflow = 类型本身不产结果，只编排 ≥2 个阶段/子任务（有 orchestrator、stages、子任务链）
 *             T() 缺省 agent，编排型用 workflow() 包一层显式标出。「谁执行」仍由 surface/executor 表达，不混。
 */

export const TASK_KINDS = Object.freeze(['agent', 'workflow']);

const T = (surface, coding, pr, executor, watchdog, push, tick, cleanup, db, tags = []) =>
  Object.freeze({ surface, coding, pr, executor, watchdog, push_to_notion: push, tick_dispatchable: tick, cleanup_class: cleanup, db, tags: Object.freeze([...tags]), kind: 'agent' });
const workflow = (entry) => Object.freeze({ ...entry, kind: 'workflow' });

const V = 'router_valid';            // task-router VALID_TASK_TYPES
const SYS = 'system_no_prd';         // pre-flight SYSTEM_TASK_TYPES
const ANC = 'anchor_exempt';         // anchor-check ANCHOR_EXEMPT_TASK_TYPES
const ESC = 'escalation_exempt';     // escalation pauseLowPriority 内联 NOT IN（:364-379）
const CX = 'cancel_exempt';          // escalation export CANCEL_EXEMPT_TYPES（:73-83，比 ESC 多 research/suggestion_plan/content_publish）
const NIT = 'nightly_excluded';      // nightly-orchestrator NOT IN
const MON = 'monitor_long_running';  // monitor-loop HARNESS_TASK_TYPES
const NKR = 'nightly_kr_bonus';      // nightly-orchestrator.js:122 scoreTask typeScore（KR 对齐加分名单）
const GPSCOPE = 'gp_scope_task_types';
const DEVDASH = 'dev_dashboard_query';  // routes/execution.js:3721 GET /api/brain/dev/tasks 查询名单 ['dev','review']
const GPIMPL = 'gp_implementation';  // golden-path-contracts 现役签字实现单类型：有头dev与无头coding_workflow
const WARROOM = 'warroom_feed_types';    // routes/warroom.js:36 FEED_TYPES（战情室 feed 纳入的"有实质执行"任务类型）
const BP = 'backpressure_bypass';    // slot-allocator BACKPRESSURE_BYPASS_TASK_TYPES
const CODEX = 'codex_slot';          // slot-allocator countCodexInProgress
const OCPASS = 'openclaw_passthrough'; // dispatcher 任务池总闸关着时仍可放行的类型（穿透 MMV 网关，不占 fleet 槽位）
const GUIDE = 'allocation_guided';   // dispatch-allocation-guide GUIDED_TASK_TYPES
const CM = 'coding_mutation';        // routes/task-tasks CODING_MUTATION_TASK_TYPES
const FC = 'family:content';         // actions.js CONTENT_TASK_TYPES
const FR = 'family:research';        // actions.js RESEARCH_TASK_TYPES
const FV = 'family:review';          // actions.js REVIEW_TASK_TYPES
const FK = 'family:coding';          // actions.js CODING_TASK_TYPES
const RECUR = 'recurring';           // task-cleanup RECURRING_TASK_TYPES
const PROT = 'protected';            // task-cleanup PROTECTED_TASK_TYPES
const AUTHSKIP = 'auth_recovery_skip'; // credential-expiry-checker SKIP_TASK_TYPES
const PIPELN = 'queue_lane_pipeline'; // task-queue-lanes PIPELINE_TASK_TYPES
const NOGOAL = 'no_goal_required';   // actions.js isSystemTask systemTypes
const ASYNCCB = 'async_callback';    // task-router.js ASYNC_CALLBACK_TYPES
const REVIEWISO = 'review_isolation';
const REVIEW_SKILL = 'review_skill_binding';
const RECMUT = 'recurring_coding_mutation';

export const RETIRED_DEVELOPMENT_CODE = 'task_type_retired';
export const RETIRED_DEVELOPMENT_TASK_TYPES = Object.freeze(['sprint_planner', 'sprint_contract_propose', 'sprint_contract_review', 'sprint_generate', 'sprint_evaluate', 'sprint_fix', 'sprint_report', 'harness_planner', 'harness_contract_propose', 'harness_contract_review', 'harness_generate', 'harness_generator', 'harness_ci_watch', 'harness_evaluate', 'harness_fix', 'harness_deploy_watch', 'harness_report', 'harness_initiative', 'harness_task', 'harness_final_e2e', 'harness_intervention', 'golden_path_proposal', 'harness_controller']);
const retiredDevelopmentTypes = new Set(RETIRED_DEVELOPMENT_TASK_TYPES);
export function isRetiredDevelopmentTask(task) {
  return retiredDevelopmentTypes.has(task?.task_type)
    || task?.kernel_continuation === true || task?.payload?.kernel_continuation === true
    || task?.payload?.harness_mode === true || ['true','t'].includes(task?.payload?.harness_mode);
}
export function assertActiveDevelopmentTask(task) {
  if (!isRetiredDevelopmentTask(task)) return;
  const error = new Error(`${RETIRED_DEVELOPMENT_CODE}: ${task?.task_type ?? 'legacy development payload'}`);
  error.code = RETIRED_DEVELOPMENT_CODE;
  error.task_type = task?.task_type;
  throw error;
}

export const TASK_TYPE_REGISTRY = Object.freeze({
  dev:                 T('none', true,  true,  'headed-session', 'none', true, true, 'none', true, [V, BP, GUIDE, CM, FK, RECMUT, NKR, GPSCOPE, DEVDASH, WARROOM, GPIMPL]),
  review:              T('codex-review', false, false, null, 'kernel', true, true, 'none', true, [V, FV, NKR, DEVDASH]),
  talk:                T('codex-bridge', false, false, null, 'none', true, true, 'none', true, [V, ANC, FR]),
  data:                T('codex-bridge', false, false, null, 'none', true, true, 'none', true, [V, ANC]),
  research:            T('codex-bridge', false, false, null, 'none', true, true, 'none', true, [V, ANC, FR, CX, NOGOAL, ASYNCCB]),
  exploratory:         T('none', false, false, null, 'none', true, false, 'none', true, []),
  explore:             T('codex-bridge', false, false, null, 'none', true, true, 'none', true, [V, ANC, FR, ASYNCCB]),
  knowledge:           T('codex-bridge', false, false, null, 'none', true, true, 'none', true, [V, FR]),
  qa:                  T('codex-review', false, false, null, 'kernel', true, true, 'none', true, [V, FV, NKR]),
  audit:               T('codex-review', false, false, null, 'kernel', true, true, 'none', true, [V, FV]),
  decomp_review:       T('codex-review', false, false, null, 'kernel', true, true, 'none', true, [V, FV, REVIEWISO]),
  codex_qa:            T('codex-review', false, false, null, 'kernel', true, true, 'recurring', true, [V, SYS, ANC, CODEX, FV, RECUR]),
  codex_dev:           T('codex-bridge', true,  true,  null, 'kernel', true, true, 'none', true, [V, ANC, CODEX, CM, FK, RECMUT]),
  codex_test_gen:      T('codex-review', false, false, null, 'kernel', true, true, 'none', true, [V, ANC, CODEX, FV]),
  pr_review:           T('codex-review', false, false, null, 'kernel', true, true, 'none', true, [V, FV]),
  code_review:         T('codex-review', false, false, null, 'kernel', true, true, 'none', true, [V, SYS, ANC, FV, REVIEWISO, NKR]),
  initiative_plan:     T('none', false, false, null, 'none', true, true, 'protected', true, [V, SYS, ANC, FR, PROT, REVIEWISO]),
  initiative_verify:   T('codex-review', false, false, null, 'none', true, true, 'protected', true, [V, SYS, ANC, FV, PROT, REVIEWISO]),
  initiative_execute:  T('none', true,  true,  null, 'kernel', true, true, 'none', true, [V, CM, FK, RECMUT]),
  dept_heartbeat:      T('none', false, false, null, 'none', true, true, 'recurring', true, [V, SYS, ANC, FR, RECUR]),
  suggestion_plan:     T('codex-bridge', false, false, null, 'none', true, true, 'none', true, [V, FR, CX]),
  notion_synced:       T('none', false, false, null, 'none', true, true, 'none', true, []),
  architecture_design: T('codex-review', false, false, null, 'kernel', true, true, 'none', true, [V, FV, REVIEWISO]),
  architecture_scan:   T('codex-review', false, false, null, 'kernel', true, true, 'none', true, [V, FV, REVIEWISO, REVIEW_SKILL]),
  arch_review:         T('codex-review', false, false, null, 'kernel', true, true, 'protected', true, [V, ANC, ESC, MON, FV, PROT, CX, REVIEWISO, REVIEW_SKILL]),
  strategy_session:    T('codex-bridge', false, false, null, 'none', true, true, 'none', true, [V, FR]),
  intent_expand:       T('none', false, false, null, 'none', true, true, 'none', true, [V, FR, NOGOAL]),
  cto_review:          T('none', false, false, null, 'kernel', true, true, 'none', true, []),
  spec_review:         T('codex-review', false, false, null, 'kernel', true, true, 'none', true, [V, SYS, ANC, FV, REVIEWISO]),
  code_review_gate:    T('codex-review', false, false, null, 'kernel', true, true, 'none', true, [V, SYS, ANC, FV, REVIEWISO]),
  prd_review:          T('codex-review', false, false, null, 'kernel', true, true, 'none', true, [V, SYS, ANC, FV, REVIEWISO]),
  initiative_review:   T('codex-review', false, false, null, 'kernel', true, true, 'none', true, [V, SYS, ANC, FV, REVIEWISO]),
  scope_plan:          T('codex-bridge', false, false, null, 'none', true, true, 'none', true, [V, FR]),
  project_plan:        T('codex-bridge', false, false, null, 'none', true, true, 'none', true, [V, FR]),
  okr_initiative_plan: T('codex-bridge', false, false, null, 'none', true, true, 'none', true, [V, FR]),
  okr_scope_plan:      T('codex-bridge', false, false, null, 'none', true, true, 'none', true, [V, FR]),
  okr_project_plan:    T('codex-bridge', false, false, null, 'none', true, true, 'none', true, [V, FR]),
  'content-pipeline':     workflow(T('external', false, false, 'external-worker', 'external-worker', true, false, 'none', true, [V, SYS, ESC, FC, CX, PIPELN, ANC, WARROOM])),
  'content-research':     T('external', false, false, 'external-worker', 'external-worker', true, false, 'none', true, [V, SYS, ESC, FC, CX, PIPELN, ANC]),
  'content-generate':     T('external', false, false, 'external-worker', 'external-worker', true, false, 'none', true, [V, SYS, ESC, FC, CX, PIPELN, ANC]),
  'content-review':       T('none', false, false, null, 'none', true, true, 'none', true, [PIPELN]),
  'content-export':       T('external', false, false, 'external-worker', 'external-worker', true, false, 'none', true, [V, SYS, ESC, FC, CX, PIPELN, ANC]),
  content_publish:        T('none', false, false, null, 'none', true, true, 'none', true, [V, SYS, BP, FC, CX, PIPELN, ANC]),
  'content-copywriting':  T('external', false, false, 'external-worker', 'external-worker', true, false, 'none', true, [V, SYS, ESC, FC, CX, PIPELN, ANC]),
  'content-copy-review':  T('external', false, false, 'external-worker', 'external-worker', true, false, 'none', true, [V, SYS, ESC, FC, CX, PIPELN, ANC]),
  'content-image-review': T('external', false, false, 'external-worker', 'external-worker', true, false, 'none', true, [V, SYS, ESC, FC, CX, PIPELN, ANC]),
  pipeline_rescue:        T('none', true, true, null, 'kernel', true, true, 'none', true, [CM, FK, AUTHSKIP, RECMUT]),
  crystallize:          workflow(T('codex-bridge', false, false, null, 'kernel', true, true, 'none', true, [V, SYS, ANC, CODEX])),
  crystallize_scope:    T('codex-bridge', false, false, null, 'kernel', true, true, 'none', true, [V, SYS, ANC, CODEX]),
  crystallize_forge:    T('codex-bridge', false, false, null, 'kernel', true, true, 'none', true, [V, SYS, ANC, CODEX]),
  crystallize_verify:   T('codex-bridge', false, false, null, 'kernel', true, true, 'none', true, [V, SYS, ANC, CODEX]),
  crystallize_register: T('codex-bridge', false, false, null, 'kernel', true, true, 'none', true, [V, SYS, ANC, CODEX]),
  cecelia_event:           T('none', false, false, null, 'none', true, true, 'none', true, []),
  platform_scraper:         T('brain-internal', false, false, null, 'none', true, false, 'none', true, [V, WARROOM]),
  trigger_backup:           T('none', false, false, null, 'none', true, true, 'none', true, []),
  staging_e2e:              T('codex-review', false, false, null, 'none', true, true, 'none', true, [V, ANC, FV]),
  skill_eval:               T('none', false, false, null, 'none', true, true, 'none', true, []),
  ci_patrol:                T('codex-review', false, false, null, 'none', true, true, 'none', true, [V, ANC, FV]),
  strategist_decision:      T('none', false, false, null, 'none', true, true, 'none', true, [V, ANC, FR]),
  workflow_run:             workflow(T('external', false, false, null, 'none', true, true, 'none', true, [])),
  device_job:               T('device', false, false, null, 'external-worker', false, false, 'none', true, []),
  project:                  workflow(T('brain-internal', false, false, null, 'none', true, false, 'none', true, [])),
  qiumi_task:               T('openclaw-agent', false, false, 'openclaw-agent', 'openclaw-agent', false, true, 'none', true, [V, ANC, OCPASS]),
  workflow_dispatch:        workflow(T('openclaw-agent', false, false, 'openclaw-agent', 'openclaw-agent', false, false, 'none', true, [V, ANC])),
  skill_factory_run:        T('external', false, false, 'openclaw-agent', 'external-worker', true, false, 'none', true, [V, ANC, CX, NOGOAL]),
  coding_workflow:          workflow(T('external', false, false, 'coding-workflow-runner', 'external-worker', true, false, 'none', true, [V, CM, ANC, GPIMPL])),
  script_run:               T('script', false, false, 'script', 'script', true, true, 'none', true, [V, SYS, ANC]),
  deploy_drill:      T('none', false, false, null, 'none', false, false, 'none', false, [ANC]),
  nightly:            T('none', false, false, null, 'none', false, false, 'none', false, [ANC]),
  app_server_run: T('app-server', false, false, 'app-server-controller', 'external-worker', true, false, 'protected', true, [ANC, PROT, ESC, CX]),
  janitor:            T('preview-janitor', false, false, 'preview-janitor', 'preview-janitor', true, false, 'protected', true, [ANC, PROT, ESC, CX]),
});

export const KIND_FOR_TASK_TYPE = Object.freeze(
  Object.fromEntries(Object.entries(TASK_TYPE_REGISTRY).map(([k, e]) => [k, e.kind])),
);

export const WORKFLOW_KIND_TASK_TYPES = Object.freeze(
  Object.entries(TASK_TYPE_REGISTRY).filter(([, e]) => e.db && e.kind === 'workflow').map(([k]) => k),
);

export function getTaskType(type) {
  return TASK_TYPE_REGISTRY[type] ?? null;
}

export function tagged(tag) {
  return Object.freeze(
    Object.entries(TASK_TYPE_REGISTRY).filter(([, e]) => e.tags.includes(tag)).map(([k]) => k),
  );
}

export const TICK_DISPATCH_EXCLUDED = Object.freeze(
  [...RETIRED_DEVELOPMENT_TASK_TYPES, ...Object.entries(TASK_TYPE_REGISTRY).filter(([, e]) => e.db && !e.tick_dispatchable).map(([k]) => k)],
);
export const GUIDED_TASK_TYPES = tagged(GUIDE);
export const BACKPRESSURE_BYPASS_TASK_TYPES = tagged(BP);
export const CODEX_SLOT_TASK_TYPES = tagged(CODEX);
export const OPENCLAW_PASSTHROUGH_TASK_TYPES = tagged(OCPASS);
export const SYSTEM_TASK_TYPES = tagged(SYS);
export const VALID_TASK_TYPES = tagged(V);

export const LAYER_RETIRED_TASK_TYPES = Object.freeze([
  'scope_plan', 'initiative_plan', 'project_plan',
  'okr_scope_plan', 'okr_initiative_plan', 'okr_project_plan',
]);
export const CONTENT_TASK_TYPES = tagged(FC);
export const RESEARCH_TASK_TYPES = tagged(FR);
export const REVIEW_TASK_TYPES = tagged(FV);
export const REVIEW_SKILL_BINDING_TASK_TYPES = tagged(REVIEW_SKILL);
export const CODING_TASK_TYPES = tagged(FK);
export const CODING_MUTATION_TASK_TYPES = tagged(CM);
export const PUSH_EXCLUDED_TASK_TYPES = Object.freeze(
  Object.entries(TASK_TYPE_REGISTRY).filter(([, e]) => e.db && !e.push_to_notion).map(([k]) => k),
);

export const ANCHOR_EXEMPT_TASK_TYPES = tagged(ANC);
export const MONITOR_LONG_RUNNING_TASK_TYPES = tagged(MON);

export const NIGHTLY_KR_BONUS_TASK_TYPES = tagged(NKR);

export const GP_SCOPE_TASK_TYPES = tagged(GPSCOPE);

export const GP_IMPLEMENTATION_TASK_TYPES = tagged(GPIMPL);

export const DEV_DASHBOARD_TASK_TYPES = tagged(DEVDASH);

export const WARROOM_FEED_TASK_TYPES = tagged(WARROOM);

export const VALUABLE_LEARNING_TASK_TYPES = Object.freeze(['dev', 'feature', 'research']);

export const CRYSTALLIZE_ORCHESTRATOR_STAGES = Object.freeze([
  'crystallize_scope',
  'crystallize_forge',
  'crystallize_verify',
  'crystallize_register',
]);

export const CRYSTALLIZE_ORCHESTRATOR_STAGE_LABELS = Object.freeze({
  crystallize_forge: 'Forge',
  crystallize_verify: 'Verify',
  crystallize_register: 'Register',
});

export const DAILY_SMOKE_STAGE_ORDER = Object.freeze([
  'content-research',
  'content-copywriting',
  'content-copy-review',
  'content-generate',
  'content-image-review',
  'content-export',
]);

export const EXEC_STATUS_US_TASK_TYPES = Object.freeze(['dev', 'review', 'qa', 'audit']);

export const EXEC_STATUS_HK_TASK_TYPES = Object.freeze(['talk', 'research', 'data']);
export const RECURRING_TASK_TYPES = tagged(RECUR);
export const PROTECTED_TASK_TYPES = tagged(PROT);
export const ESCALATION_EXEMPT_TASK_TYPES = tagged(ESC);
export const CANCEL_EXEMPT_TYPES = tagged(CX);
export const AUTH_RECOVERY_SKIP_TASK_TYPES = tagged(AUTHSKIP);
export const NIGHTLY_EXCLUDED_TASK_TYPES = tagged(NIT);
export const PIPELINE_TASK_TYPES = tagged(PIPELN);

export const CONTENT_PIPELINE_TYPES = Object.freeze(
  Object.entries(TASK_TYPE_REGISTRY).filter(([, e]) => e.executor === 'external-worker').map(([k]) => k),
);

export const EXTERNAL_WATCHDOG_TASK_TYPES = Object.freeze(
  Object.entries(TASK_TYPE_REGISTRY).filter(([, e]) => e.watchdog === 'external-worker').map(([k]) => k),
);

const REMOTE_EXECUTION_SURFACES = new Set(['device', 'openclaw-agent', 'script', 'preview-janitor', 'image-janitor', 'app-server']);

export const EXTERNALLY_EXECUTED_TASK_TYPES = Object.freeze(
  Object.entries(TASK_TYPE_REGISTRY).filter(([, e]) => e.db && REMOTE_EXECUTION_SURFACES.has(e.surface)).map(([k]) => k),
);
export const NO_GOAL_TASK_TYPES = tagged(NOGOAL);
export const ASYNC_CALLBACK_TASK_TYPES = tagged(ASYNCCB);

export const REVIEW_ISOLATION_TASK_TYPES = tagged(REVIEWISO);

export const RECURRING_CODING_MUTATION_TASK_TYPES = tagged(RECMUT);
export const DB_WHITELISTED_TASK_TYPES = Object.freeze(
  [...RETIRED_DEVELOPMENT_TASK_TYPES.filter(type=>type!=='harness_controller'), ...Object.entries(TASK_TYPE_REGISTRY).filter(([, e]) => e.db).map(([k]) => k)],
);

export const EXECUTOR_KIND_FOR_TASK_TYPE = Object.freeze(
  Object.fromEntries(Object.entries(TASK_TYPE_REGISTRY).filter(([, e]) => e.executor).map(([k, e]) => [k, e.executor])),
);

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
  'intent_expand': '/intent-expand',  // 意图扩展 → US 本机，查 OKR/Vision 链路补全 PRD
  'initiative_execute': '/dev',       // Initiative 执行 → US 本机，/dev 全流程
  'content-pipeline': '/content-creator',
  'content-research': '/notebooklm',
  'content-copywriting': '/content-creator',
  'content-copy-review': '/content-creator',
  'content-generate': '/content-creator',
  'content-image-review': '/content-creator',
  'content-export': '/content-creator',
  'content_publish': '/content-creator',  // 发布阶段 → executor 按 payload.platform 路由到对应 publisher skill
  'prd_review': '/prd-review',              // PRD 审查
  'spec_review': '/spec-review',            // Spec 审查
  'code_review_gate': '/code-review-gate',  // 代码质量门禁
  'initiative_review': '/initiative-review', // Initiative 整体审查
  'ci_patrol': '/ci-patrol',
  'strategist_decision': '/line-strategist',
  'staging_e2e': '/_internal',                                // Slice9: native 执行（executor 短路），不派 agent
  'scope_plan': '/decomp',        // Scope 内规划下一个 Initiative
  'project_plan': '/decomp',      // Project 内规划下一个 Scope
  'okr_initiative_plan': '/decomp',  // OKR Scope 内规划下一个 Initiative
  'okr_scope_plan': '/decomp',       // OKR Project 内规划下一个 Scope
  'okr_project_plan': '/decomp',     // OKR Project 层完成后规划
  'platform_scraper': '/media-scraping',
});

export const LOCATION_MAP = Object.freeze({
  'dev': 'us',        // 写代码 → US (Nobel + Opus + /dev)
  'review': 'us',     // 代码审查 → US (Sonnet + /review)
  'qa': 'us',         // QA → US (Sonnet)
  'audit': 'us',      // 审计 → US (Sonnet)
  'codex_qa': 'xian',  // Codex 免疫检查 → 西安 Mac mini (Codex CLI via codex-bridge)
  'codex_dev': 'xian', // Codex /dev → 西安 Mac mini（Brain 自有 legacy runner）
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
  'content-pipeline': 'xian',  // Pipeline 编排入口 → 西安 Codex
  'content-research': 'xian',  // 调研阶段 → 西安 (/notebooklm)
  'content-copywriting': 'xian', // 文案生成 → 西安 (/content-creator)
  'content-copy-review': 'xian', // 文案审核 → 西安（纯规则检查）
  'content-generate': 'xian',  // 图片生成 → 西安 (/content-creator)
  'content-image-review': 'xian', // 图片审核 → 西安（规则+视觉检查）
  'content-export': 'xian',    // 导出阶段 → 西安 (card-renderer.mjs)
  'content_publish': 'us',     // 发布阶段 → US 本机（publisher skills 需要浏览器 CDP，在 US Mac mini 跑）
  'ci_patrol': 'us',  // CI 巡检 → US 本机（需读本地 repo + gh + Brain DB）
  'strategist_decision': 'us',  // line-strategist 需读 git 历史 + decisions API → US
  'prd_review': 'us',            // PRD 审查 → US 本机 Codex
  'spec_review': 'us',           // Spec 审查 → US 本机 Codex
  'code_review_gate': 'us',      // 代码质量门禁 → US 本机 Codex
  'initiative_review': 'us',     // Initiative 整体审查 → US 本机 Codex
  'scope_plan': 'xian',            // Scope 规划 → 西安 Codex (B類，/decomp skill)
  'project_plan': 'xian',          // Project 规划 → 西安 Codex (B類，/decomp skill)
  'okr_initiative_plan': 'xian',   // OKR Initiative 规划 → 西安 Codex (B類，/decomp skill)
  'okr_scope_plan': 'xian',        // OKR Scope 规划 → 西安 Codex (B類，/decomp skill)
  'okr_project_plan': 'xian',      // OKR Project 规划 → 西安 Codex (B類，/decomp skill)
  'pipeline_rescue': 'us',        // Pipeline 救援 → US 本机（需读 .dev-mode + worktree）
  'platform_scraper': 'us',       // 数据采集任务 → Brain 内部处理（不走外部 executor，见 post-publish-data-collector.js）
  'staging_e2e': 'us',          // Slice9: staging E2E native 执行 → US 本机
});

export const TASK_REQUIREMENTS = Object.freeze({
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
  'crystallize':          ['has_browser'],
  'crystallize_scope':    ['has_browser'],
  'crystallize_forge':    ['has_browser'],
  'crystallize_verify':   ['has_browser'],
  'crystallize_register': ['has_browser'],
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
});

export const EXECUTOR_SKILL_MAP = Object.freeze({
  'dev': '/dev',           // 写代码：Opus
  'review': '/code-review', // 审查：已迁移到 /code-review
  'qa_init': '/review init', // QA 初始化：设置 CI 和分支保护
  'talk': '/talk',         // 对话：写文档，不改代码
  'research': '',          // 研究：完全只读，不挂 skill，由 preparePrompt 直接构建 prompt
  'dept_heartbeat': '/repo-lead heartbeat', // 部门主管心跳：MiniMax
  'code_review': '/code-review', // 代码审查：Sonnet + /code-review skill
  'ci_patrol': '/ci-patrol', // CI/CD 巡检：每日按 line 报硬伤（ci-patrol skill）
  'initiative_plan': '/decomp',     // Phase 2 规划下一个 PR：/decomp
  'initiative_verify': '/architect', // Initiative 收尾验收 → /architect Mode 3
  'decomp_review': '/decomp-check', // 拆解质检：/decomp-check
  'suggestion_plan': '/plan',       // Suggestion 层级识别 → /plan skill
  'architecture_design': '/architect', // Initiative 级架构设计 → /architect skill
  'strategy_session': '/strategy-session',
  'content-pipeline': '/content-creator',      // 编排入口：触发完整内容生成流程
  'content-research': '/notebooklm',           // 调研阶段：NotebookLM 深度调研
  'content-copywriting': '/content-creator',   // 文案生成阶段
  'content-copy-review': '/content-creator',   // 文案审核阶段
  'content-generate': '/content-creator',      // 生成阶段：图片+文案生成
  'content-image-review': '/content-creator',  // 图片审核阶段
  'content-review': '/content-creator',        // 审核阶段：AI 质量评分
  'content-export': '/content-creator',        // 导出阶段：NAS 存储 + manifest
  'qa': '/code-review',
  'audit': '/code-review',
  'intent_expand': '/intent-expand',  // 意图扩展：查 OKR/Vision 链路补全 PRD
  'initiative_execute': '/dev',       // Initiative 执行：/dev 全流程
  'content_publish': '/dev',          // fallback：正常由上方平台路由拦截
  'prd_review': '/prd-review',              // PRD 审查
  'spec_review': '/spec-review',            // Spec 审查
  'code_review_gate': '/code-review-gate',  // 代码质量门禁
  'initiative_review': '/initiative-review', // Initiative 整体审查
  'scope_plan': '/decomp',        // Phase 3: Scope 内规划下一个 Initiative
  'project_plan': '/decomp',      // Phase 4: Project 内规划下一个 Scope
  'pipeline_rescue': '/dev',       // 卡住的 pipeline 接管修复 → /dev 全流程
  'codex_test_gen': '/codex-test-gen',  // Codex 自动生成测试 → 西安 M4
  'platform_scraper': '/media-scraping', // 平台数据采集 → CN Mac mini (/media-scraping skill)
  'strategist_decision': '/line-strategist',  // Line 军师决策（PR3674 终态钩子派发，见 line-strategist-dispatch.js）
});

export const EXECUTOR_MODE_MAP = Object.freeze({
  'dev': 'bypassPermissions',        // 写代码
  'review': 'bypassPermissions',     // 已迁移到 /code-review，需写报告
  'talk': 'bypassPermissions',       // 要调 API 写数据库
  'research': 'bypassPermissions',   // 要调 API
  'code_review': 'bypassPermissions', // 需要写报告文件到 docs/reviews/
  'qa': 'bypassPermissions',
  'audit': 'bypassPermissions',
});
