/**
 * dispatch-route.js — 一个任务类型「派出去到底谁接」的唯一判定（派发总闸 F，任务 0a70684f）。
 *
 * 背景：注册表 surface 字段长期与实际路由脱节（talk/research/data 标 brain-internal 实走西安
 * Codex Bridge；dev/trigger_backup 等 location=us 类型落在已退役的 Claude 桥接路径），建单不拦，
 * 进队后 tick 每轮 claim → claude_channel_retired → 回 queued，静默卡死（10-10 a55c7664、
 * c8fab3c8 实例）。本模块按 executor._triggerCeceliaRunInner 的分支顺序，把每个类型解析成一条
 * 路由（route）并给出是否有可用执行者；createRoutedTask 建单前据此拒绝无执行者的 queued 单，
 * 守卫测试据此要求注册表 surface 与实际路由一致。
 *
 * 路由与 surface 对照（surface 是注册表字段，route 是本模块判定）：
 *   codex-review   → surface 'codex-review'   （REVIEW 族 → triggerCodexReview 独立 Codex 审查池）
 *   internal       → surface 'brain-internal' （Brain 进程内联 handler / staging_e2e native）
 *   openclaw-agent → surface 'openclaw-agent' （ssh MMV 起 openclaw agent）
 *   script         → surface 'script'         （ssh 跑场机执行确定性脚本）
 *   codex-bridge   → surface 'codex-bridge'   （location=xian / xian_m1 → 西安 Codex Bridge）
 *   kernel         → surface 'kernel'         （harness_initiative / golden_path_proposal → Kernel Harness）
 *   claude-retired / retired-harness → surface 'none'（无可用执行者，建单即拒）
 *   external-mirror → surface 'external'（workflow_run 外部起跑账本镜像，只以 in_progress/终态入账，queued 建单即拒）
 *   own-consumer   → tick 不派（tick_dispatchable=false），由该类型专属消费方领单，surface 不受约束
 *   headed         → payload.headed_manual=true，执行者是有头会话（人），不进 tick
 */
import {
  getTaskType,
  LOCATION_MAP,
  REVIEW_TASK_TYPES,
  RETIRED_HARNESS_TYPES_DISPATCH,
  KERNEL_RUN_ELIGIBLE_TASK_TYPES,
} from './task-type-registry.js';

export const NO_EXECUTOR_FOR_TASK_TYPE = 'no_executor_for_task_type';

/** Brain 进程内联 handler 的类型（与 task-router.js INTERNAL_TASK_HANDLERS 键一致，守卫测试钉死）。 */
export const INTERNAL_HANDLER_TASK_TYPES = Object.freeze(['harness_intervention']);

/** 路由 → 注册表 surface 应取的值（own-consumer / headed / explicit-override 不约束 surface）。 */
export const SURFACE_FOR_ROUTE = Object.freeze({
  'codex-review': 'codex-review',
  internal: 'brain-internal',
  'openclaw-agent': 'openclaw-agent',
  script: 'script',
  'codex-bridge': 'codex-bridge',
  'local-codex': 'codex-review',
  kernel: 'kernel',
  'claude-retired': 'none',
  'retired-harness': 'none',
  'external-mirror': 'external',
});

// executor 2.85 分支（harness_initiative / golden_path_proposal → Kernel Harness）= 注册表 kernel_run_eligible 标签
const KERNEL_HARNESS_TYPES = new Set(KERNEL_RUN_ELIGIBLE_TASK_TYPES);
const RETIRED = new Set(RETIRED_HARNESS_TYPES_DISPATCH);
const REVIEW = new Set(REVIEW_TASK_TYPES);
const INTERNAL = new Set(INTERNAL_HANDLER_TASK_TYPES);

const ROUTE_REASON = Object.freeze({
  'claude-retired': 'location=us 落在已退役的 US Claude 桥接路径（任务 76a160b3），无执行者',
  'retired-harness': '已退役的 harness 子类型（归入 harness_initiative 全图），派到即终态失败',
  'external-mirror': '外部起跑的账本镜像（执行机自己起跑，Brain 只记账），只以 in_progress/终态入账，queued 无人领',
});

export function isHeadedManual(payload) {
  return payload?.headed_manual === true || payload?.headed_manual === 'true';
}

const ok = (route, executor) => ({ route, available: true, executor, reason: null });
const none = (route) => ({ route, available: false, executor: null, reason: ROUTE_REASON[route] });

/**
 * 解析任务的派发路由（纯函数，顺序与 executor._triggerCeceliaRunInner 一致）。
 *
 * @param {{task_type: string, payload?: object}} task
 * @param {{ dynamic?: {location?: string|null, executor?: string|null} | null }} [opts]
 *   dynamic = task_type_configs 动态配置（executor 运行时优先读它），没有就传 null
 * @returns {{route: string, available: boolean, executor: string|null, reason: string|null}}
 */
export function resolveDispatchRoute(task, { dynamic = null } = {}) {
  const type = task?.task_type;
  const entry = getTaskType(type);
  // 未登记类型交给 tasks_task_type_check 判（DB 400），本模块不抢错误语义。
  if (!entry || !entry.db) return ok('unregistered', null);
  const payload = task?.payload || {};
  if (isHeadedManual(payload)) return ok('headed', 'human');
  if (!entry.tick_dispatchable) return ok('own-consumer', entry.executor ?? entry.surface);
  // 外部 run 镜像（判据同 external-mirror-liveness：kind=workflow + surface=external + watchdog=none，即 workflow_run）
  if (entry.kind === 'workflow' && entry.surface === 'external' && entry.watchdog === 'none') return none('external-mirror');
  if (REVIEW.has(type)) return ok('codex-review', 'codex-review-local');
  if (type === 'staging_e2e') return ok('internal', 'brain-local');
  if (INTERNAL.has(type)) return ok('internal', 'brain-local');
  if (type === 'qiumi_task') return ok('openclaw-agent', 'openclaw-agent');
  if (type === 'script_run') return ok('script', 'script');
  // 显式 override（payload.machine/executor）：executor=claude 强制落退役收口；其余（codex / 只给 machine）
  // 由 resolveExecutor 在派发时决定，解析失败在派发点 loud-fail，不在建单时猜。
  if ((payload.machine || payload.executor) && !KERNEL_HARNESS_TYPES.has(type) && !RETIRED.has(type)) {
    if (payload.executor === 'claude') return none('claude-retired');
    return ok('explicit-override', payload.executor === 'codex' ? 'bridge' : null);
  }
  const location = dynamic?.location ?? LOCATION_MAP[type] ?? 'us';
  if (location === 'xian' || location === 'xian_m1') return ok('codex-bridge', 'bridge');
  if (location === 'us' && dynamic?.executor === 'codex') return ok('local-codex', 'codex-review-local');
  if (KERNEL_HARNESS_TYPES.has(type)) return ok('kernel', 'kernel-process');
  if (RETIRED.has(type)) return none('retired-harness');
  return none('claude-retired');
}

/**
 * 建单闸：要以 queued 进队、会被 tick 派发、却解析不到执行者的单直接拒绝（不再进队静默卡死）。
 * 非 queued（in_progress 镜像 / blocked / completed 账本行）不受影响。
 *
 * @throws {Error} code=no_executor_for_task_type
 */
export function assertTaskTypeHasExecutor({ task_type, status = 'queued', payload = {} }, opts = {}) {
  if (status !== 'queued') return;
  const route = resolveDispatchRoute({ task_type, payload }, opts);
  if (route.available) return;
  const error = new Error(
    `${NO_EXECUTOR_FOR_TASK_TYPE}: task_type="${task_type}" 没有可用执行者（route=${route.route}：${route.reason}）。`
    + '改用有执行者的类型；确需人工接手请带 payload.headed_manual=true',
  );
  error.code = NO_EXECUTOR_FOR_TASK_TYPE;
  error.task_type = task_type;
  error.route = route.route;
  throw error;
}

/**
 * 借壳类型归一（任务 0a70684f）：技能工厂执行单曾借 research + payload.factory_dispatch，
 * 编码 workflow 曾借 data + payload.coding_workflow，靠 headed_manual 一个字段挡 tick。
 * 现各有独立类型；老调用方（含按旧文档建单的 LLM 会话）照旧形状建单时在这里改成新类型。
 */
export function normalizeBorrowedTaskType(requestedType, payload = {}) {
  if (requestedType === 'research' && payload?.factory_dispatch === true) return 'skill_factory_run';
  if (requestedType === 'data' && payload?.coding_workflow === true) return 'coding_workflow';
  return requestedType;
}
