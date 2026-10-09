/**
 * Recurring Tasks Engine（定时引擎）
 *
 * 由 scheduler-jobs 的 'recurring-tasks' job 每轮（60s）调用 runRecurringTasksJob。
 * 2026-09 复活（任务 3d0db274）：旧实现只挂在废弃的 tick-runner.executeTick、要求当前分钟恰好命中、
 * 按服务器本地时区判定、source_id 用 now，5 月起停摆。现行规则：
 *
 *   - 时区：固定 Asia/Shanghai，模板 template.timezone 可覆盖。
 *   - 到点：next_run_at 是唯一的"下一个时间点"，now >= next_run_at 即到点。
 *   - 基线：next_run_at 为空（首次启用）→ 只写 now 之后的下一个时间点，不建单、不补跑。
 *   - 迟到：最近一个到点时间点距 now 超过 catchup_minutes（默认 30）→ missed + P2 告警 + 推进，不建单；
 *           错过多个时间点只看最近一个。
 *   - 防重：CAS 占位（next_run_at 旧值比较）抢到才建单；source_id=recurring:<id>:<slotISO>。
 *   - 防叠单：同模板已有 queued/in_progress/paused/blocked 实例 → skipped_overlap，skip_streak+1，连续 3 次告警。
 *   - 透传：template.task_type/priority/dept/payload/assigned_to；due_at=时间点+due_offset_minutes；
 *           expires_after_minutes → payload.expires_at，过期未认领的实例取消（unclaimed_expired）。
 *   - 落后：处理后仍有 next_run_at < now-10min 的活模板 → 告警一次（去重）。
 *
 * 纯计算（cron/时区/到点判定/实例标题）在 lib/recurring-schedule.js。
 */

import pool from './db.js';
import { createTask } from './actions.js';
import { raise } from './alerting.js';
import { buildMutationRoute } from './system-coding-route.js';
import { RECURRING_CODING_MUTATION_TASK_TYPES } from './lib/task-type-registry.js';
import {
  MINUTE_MS, instanceTitle, minutesOr, planTemplate, templateOf, timeZoneOf,
} from './lib/recurring-schedule.js';

export {
  DEFAULT_TIMEZONE, calculateNextRunAt, isValidCron, isValidScheduleExpression, matchesCron, nextSlotAfter,
  planTemplate, validateSchedule,
} from './lib/recurring-schedule.js';

const LAG_ALERT_MS = 10 * 60 * 1000;
const SKIP_STREAK_ALERT = 3;
const OPEN_INSTANCE_STATUSES = ['queued', 'in_progress', 'paused', 'blocked'];

// ─── 执行 ────────────────────────────────────────────────────

const EXECUTOR_SKILL_MAP = {
  cecelia: null, // 内置：直接创建 task，不路由外部 skill
  qiumi: '/okr',
  vivian: '/decomp-check',
  nobel: '/n8n-manage',
  caramel: '/dev',
  qa: '/qa',
};

function safeRaise(raiseFn, level, eventType, message) {
  return Promise.resolve()
    .then(() => raiseFn(level, eventType, message))
    .catch((e) => console.warn(`[recurring] 告警发送失败 ${eventType}: ${e.message}`));
}

function toIso(d) {
  return d ? d.toISOString() : null;
}

async function createInstance(db, rt, slot) {
  const template = templateOf(rt);
  const slotIso = slot.toISOString();
  const executor = rt.executor || 'cecelia';
  const skill = EXECUTOR_SKILL_MAP[executor] ?? null;
  const taskType = skill ? 'skill' : (template.task_type || rt.task_type || 'dev');
  const codingMutation = skill === '/dev' || RECURRING_CODING_MUTATION_TASK_TYPES.includes(taskType);
  const mutationRoute = codingMutation
    ? buildMutationRoute({
        change_kind: template.change_kind,
        map_scope: template.map_scope,
        repo_hint: template.repo_hint || template.repo_path,
        repo_root: template.repo_root || template.repo_path,
      })
    : {};
  const expiresAfter = minutesOr(template.expires_after_minutes, null);
  const payload = {
    ...(template.payload || {}),
    // 系统键放后面：recurring_task_id 是叠单检测的依据，不允许被模板 payload 覆盖
    recurring_task_id: rt.id,
    recurring_title: rt.title,
    recurring_slot: slotIso,
    executor,
    ...(skill ? { skill } : {}),
    ...(expiresAfter != null ? { expires_at: new Date(slot.getTime() + expiresAfter * MINUTE_MS).toISOString() } : {}),
  };

  const creation = await createTask({
    db,
    source: 'scheduler',
    source_id: `recurring:${rt.id}:${slotIso}`,
    title: instanceTitle(template.title || rt.title, slot, timeZoneOf(rt)),
    description: template.description || rt.description || '',
    priority: template.priority || rt.priority || 'P1',
    task_type: taskType,
    dept: template.dept || null,
    goal_id: rt.goal_id || template.goal_id || null,
    project_id: rt.project_id || template.project_id || null,
    prd_content: template.prd_content || null,
    trigger_source: 'recurring',
    allow_unscoped: true,
    payload,
    ...mutationRoute,
  });
  const task = creation?.task;
  if (!task?.id) throw new Error('createTask 未返回任务');

  // createRoutedTask 的核心 INSERT 不写 assigned_to/due_at，建单后紧接着补写
  const dueAt = new Date(slot.getTime() + minutesOr(template.due_offset_minutes, 0) * MINUTE_MS);
  await db.query(
    `UPDATE tasks SET assigned_to = COALESCE($2, assigned_to), due_at = ($3::timestamptz AT TIME ZONE 'UTC'), updated_at = NOW()
      WHERE id = $1`,
    [task.id, template.assigned_to || null, dueAt.toISOString()],
  );
  return task;
}

async function processTemplate(db, rt, now, raiseFn, summary) {
  const plan = planTemplate(rt, now);
  if (plan.action === 'wait') return;

  if (plan.action === 'baseline') {
    const r = await db.query(
      `UPDATE recurring_tasks SET next_run_at = $1
        WHERE id = $2 AND is_active = true AND next_run_at IS NULL
      RETURNING id`,
      [toIso(plan.nextRunAt), rt.id],
    );
    if (r.rows.length) summary.baseline++;
    if (!plan.nextRunAt) console.warn(`[recurring] 模板 ${rt.id} 算不出下一个时间点（cron=${rt.cron_expression}）`);
    return;
  }

  const oldRaw = rt.next_run_at_raw ?? toIso(new Date(rt.next_run_at));

  if (plan.action === 'missed') {
    const r = await db.query(
      `UPDATE recurring_tasks SET next_run_at = $1, last_run_status = 'missed'
        WHERE id = $2 AND is_active = true AND next_run_at = $3::timestamptz
      RETURNING id`,
      [toIso(plan.nextRunAt), rt.id, oldRaw],
    );
    if (!r.rows.length) { summary.lost_race++; return; }
    summary.missed++;
    await safeRaise(raiseFn, 'P2', `recurring_missed_${rt.id}`,
      `⏰ 定时任务「${rt.title}」错过时间点 ${plan.slot.toISOString()}（超出补跑窗口，未建单），下一次 ${toIso(plan.nextRunAt)}`);
    return;
  }

  // run：先 CAS 占位，抢到才建单
  const claim = await db.query(
    `UPDATE recurring_tasks SET next_run_at = $1, last_run_at = $2
      WHERE id = $3 AND is_active = true AND next_run_at = $4::timestamptz
    RETURNING id`,
    [toIso(plan.nextRunAt), plan.slot.toISOString(), rt.id, oldRaw],
  );
  if (!claim.rows.length) { summary.lost_race++; return; }

  const open = await db.query(
    `SELECT id, status FROM tasks
      WHERE trigger_source = 'recurring' AND payload->>'recurring_task_id' = $1
        AND status = ANY($2::text[])
      LIMIT 1`,
    [String(rt.id), OPEN_INSTANCE_STATUSES],
  );
  if (open.rows.length) {
    const r = await db.query(
      `UPDATE recurring_tasks SET last_run_status = 'skipped_overlap', skip_streak = COALESCE(skip_streak, 0) + 1
        WHERE id = $1 RETURNING skip_streak`,
      [rt.id],
    );
    summary.skipped_overlap++;
    const streak = Number(r.rows[0]?.skip_streak ?? 0);
    if (streak >= SKIP_STREAK_ALERT) {
      await safeRaise(raiseFn, 'P2', `recurring_skip_streak_${rt.id}`,
        `🔁 定时任务「${rt.title}」连续 ${streak} 次因上一张（${open.rows[0].id}，${open.rows[0].status}）未完结而跳过`);
    }
    return;
  }

  try {
    const task = await createInstance(db, rt, plan.slot);
    await db.query(`UPDATE recurring_tasks SET last_run_status = 'created', skip_streak = 0 WHERE id = $1`, [rt.id]);
    summary.created.push({
      task_id: task.id, task_title: task.title, recurring_task_id: rt.id, recurring_title: rt.title,
      slot: plan.slot.toISOString(), next_run_at: toIso(plan.nextRunAt),
    });
    console.log(`[recurring] 建单 ${task.id}「${task.title}」← 模板 ${rt.id} 时间点 ${plan.slot.toISOString()}`);
  } catch (err) {
    summary.errors++;
    console.error(`[recurring] 模板 ${rt.id} 建单失败: ${err.message}`);
    await db.query(`UPDATE recurring_tasks SET last_run_status = 'error' WHERE id = $1`, [rt.id]).catch(() => {});
    await safeRaise(raiseFn, 'P2', `recurring_create_failed_${rt.id}`,
      `❌ 定时任务「${rt.title}」时间点 ${plan.slot.toISOString()} 建单失败：${err.message}`);
  }
}

/** 过期未认领的定时实例取消（queued/paused 且 payload.expires_at 已过）。返回取消条数。 */
async function expireRecurringInstances(db, now, raiseFn) {
  // DISTINCT ON(title) + NOT EXISTS：避开迁移 074 的 (title) WHERE cancelled 唯一索引，一条撞索引不能拖垮整批
  const r = await db.query(
    `WITH cand AS (
       SELECT DISTINCT ON (t.title) t.id
         FROM tasks t
        WHERE t.trigger_source = 'recurring'
          AND t.status IN ('queued', 'paused')
          AND (CASE WHEN t.payload->>'expires_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
                    THEN (t.payload->>'expires_at')::timestamptz END) <= $1::timestamptz
          AND NOT EXISTS (SELECT 1 FROM tasks c WHERE c.title = t.title AND c.status IN ('cancelled', 'canceled'))
        ORDER BY t.title, t.created_at
     )
     UPDATE tasks
        SET status = 'cancelled',
            blocked_reason = 'unclaimed_expired',
            error_message = 'unclaimed_expired',
            status_history = COALESCE(tasks.status_history, '[]'::jsonb) || jsonb_build_array(
              jsonb_build_object('from', tasks.status, 'to', 'cancelled', 'changed_at', NOW(), 'source', 'recurring_unclaimed_expired')
            ),
            updated_at = NOW()
       FROM cand
      WHERE tasks.id = cand.id
    RETURNING tasks.id, tasks.title`,
    [now.toISOString()],
  );
  if (r.rows.length) {
    const names = r.rows.slice(0, 5).map((x) => `「${x.title}」`).join('、');
    await safeRaise(raiseFn, 'P2', 'recurring_instance_expired',
      `⌛ ${r.rows.length} 张定时任务实例过期未认领已取消（unclaimed_expired）：${names}${r.rows.length > 5 ? ' 等' : ''}`);
  }
  return r.rows.length;
}

// 落后告警去重：key=模板id，value=告警时的 next_run_at。进程内状态，重启后最多再告一次。
const _lagAlerted = new Map();

async function alertLaggingTemplates(db, now, raiseFn) {
  const r = await db.query(
    `SELECT id, title, next_run_at FROM recurring_tasks
      WHERE is_active = true AND next_run_at < $1`,
    [new Date(now.getTime() - LAG_ALERT_MS).toISOString()],
  );
  const seen = new Set();
  for (const row of r.rows) {
    const key = String(row.id);
    const nr = toIso(new Date(row.next_run_at));
    seen.add(key);
    if (_lagAlerted.get(key) === nr) continue;
    _lagAlerted.set(key, nr);
    await safeRaise(raiseFn, 'P1', `recurring_lagging_${key}`,
      `🐢 定时任务「${row.title}」落后：next_run_at=${nr} 已过 10 分钟仍未推进，定时引擎可能卡住`);
  }
  for (const key of [..._lagAlerted.keys()]) if (!seen.has(key)) _lagAlerted.delete(key);
  return r.rows.length;
}

/** 测试用：清空进程内告警去重状态。 */
export function __resetRecurringAlertStateForTest() {
  _lagAlerted.clear();
}

/**
 * 定时引擎一轮。每条模板独立 try/catch，单条失败不影响其他并记日志。
 * @param {import('pg').Pool} db
 * @param {{ now?: Date, raiseFn?: Function }} [opts]
 */
export async function runRecurringTasksJob(db = pool, { now = new Date(), raiseFn = raise } = {}) {
  const summary = { checked: 0, baseline: 0, created: [], missed: 0, skipped_overlap: 0, lost_race: 0, errors: 0, expired: 0, lagging: 0 };

  const { rows } = await db.query(
    `SELECT *, next_run_at::text AS next_run_at_raw
       FROM recurring_tasks
      WHERE is_active = true AND (next_run_at IS NULL OR next_run_at <= $1)
      ORDER BY created_at ASC`,
    [now.toISOString()],
  );

  for (const rt of rows) {
    summary.checked++;
    try {
      await processTemplate(db, rt, now, raiseFn, summary);
    } catch (err) {
      summary.errors++;
      console.error(`[recurring] 模板 ${rt.id}「${rt.title}」处理失败: ${err.message}`);
    }
  }

  try {
    summary.expired = await expireRecurringInstances(db, now, raiseFn);
  } catch (err) {
    summary.errors++;
    console.error(`[recurring] 过期取消失败: ${err.message}`);
  }
  try {
    summary.lagging = await alertLaggingTemplates(db, now, raiseFn);
  } catch (err) {
    summary.errors++;
    console.error(`[recurring] 落后检查失败: ${err.message}`);
  }
  return summary;
}

/** 兼容旧入口（tick-runner.executeTick）：返回本轮建出的实例列表。 */
export async function checkRecurringTasks(now = new Date()) {
  const summary = await runRecurringTasksJob(pool, { now });
  return summary.created;
}
