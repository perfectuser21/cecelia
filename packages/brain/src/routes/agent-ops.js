/**
 * agent-ops.js — 运行舱只读端点（指挥舱 G1 S1 刀1，task 6fcb5356）
 * GET /agent-ops/agents   — agent/机器清单 + per-source freshness
 * GET /agent-ops/calendar — 过去24h实跑 + 排程面（ops_schedule_entries + recurring_tasks）
 * 契约：0条须 source_status 佐证；42P01→503 migration_pending 禁 200 空数组；stale 用服务端时钟。
 */
import { Router } from 'express';
import pool from '../db.js';
import { INTERVAL_MS } from '../ops-collector.js';
import { MODEL_ACCOUNT_STATUS } from '../ops-model-accounts-collector.js';

// MODEL_ACCOUNT_STATUS 单源 import（INV-3 [枚举单份]）——只从 collector 引用，禁在此手抄字面量副本。
export { MODEL_ACCOUNT_STATUS };

export const STALE_FACTOR = 3;

export const SKILL_BY_TASK_TYPE = {
  dev: '/dev',
  harness_initiative: 'harness(skill-relay)',
  harness_intervention: 'harness(skill-relay)',
  ci_patrol: '/ci-patrol',
  code_review: '/code-review',
  arch_review: '/arch-review',
  strategist_decision: '/strategy-session',
  strategy_session: '/strategy-session',
  initiative_verify: '/arch-review',
  data: null, // Brain 内部数据任务，无 skill
};

function isMissingTable(err) { return err?.code === '42P01'; }
function migrationPendingError(err) {
  const e = new Error('ops 表不存在，迁移未跑'); e.reason_code = 'migration_pending'; e.cause = err; return e;
}

export async function buildAgentsPayload(dbPool, now = new Date()) {
  let agents, hbs;
  try {
    agents = (await dbPool.query(`SELECT * FROM ops_agents ORDER BY source, host_alias, name`)).rows;
    hbs = (await dbPool.query(`SELECT * FROM ops_source_heartbeats`)).rows;
  } catch (err) {
    if (isMissingTable(err)) throw migrationPendingError(err);
    throw err;
  }
  const staleMs = STALE_FACTOR * INTERVAL_MS;
  const sources = hbs.map((h) => ({
    source: h.source, host_alias: h.host_alias,
    source_status: h.source_status, reason_code: h.reason_code, last_error: h.last_error,
    last_report_at: h.last_report_at, last_collected_at: h.last_collected_at,
    stale: h.source_status !== 'ok' || !h.last_report_at || (now - new Date(h.last_report_at)) > staleMs,
  }));
  const staleByKey = new Map(sources.map((s) => [`${s.source}|${s.host_alias}`, s.stale]));
  const global_stale = sources.length === 0 || sources.every((s) => s.stale);
  const { primaryCounts, fallbackCounts } = aggregateModelCounts(agents);
  return {
    agents: agents.map((a) => ({
      ...a,
      stale: staleByKey.get(`${a.source}|${a.host_alias}`) ?? true,
      model_role: buildModelRole(a, primaryCounts, fallbackCounts),
    })),
    sources, global_stale, stale_threshold_ms: staleMs, server_now: now.toISOString(),
  };
}

// model_role：全体分身 meta 真实聚合（不造分层标签）。
// model_id = 该分身原始 primary model id；primary_count/fallback_count = 全体分身里
// 把该 model 设为 primary / 列入 fallback 的真实计数。
export function aggregateModelCounts(agents = []) {
  const primaryCounts = new Map();
  const fallbackCounts = new Map();
  for (const a of agents) {
    const m = a.meta || {};
    if (m.model) primaryCounts.set(m.model, (primaryCounts.get(m.model) || 0) + 1);
    const fbs = Array.isArray(m.model_fallbacks) ? m.model_fallbacks : [];
    for (const fb of fbs) fallbackCounts.set(fb, (fallbackCounts.get(fb) || 0) + 1);
  }
  return { primaryCounts, fallbackCounts };
}

export function buildModelRole(agent, primaryCounts, fallbackCounts) {
  const modelId = agent?.meta?.model ?? null;
  return {
    model_id: modelId,
    primary_count: modelId ? (primaryCounts.get(modelId) || 0) : 0,
    fallback_count: modelId ? (fallbackCounts.get(modelId) || 0) : 0,
  };
}

// GET /agent-ops/model-accounts — 8 个静态模型账号的配额快照（只读投影，刀2）。
// 全表读回；每条含 PRD 约定 11 字段（+ account_id 身份键）。单账号失败仍 200（status+last_error 双写）。
// 表不存在(42P01) → 503 migration_pending（沿用刀1 handle 契约）。
export async function buildModelAccountsPayload(dbPool, now = new Date()) {
  let rows;
  try {
    rows = (await dbPool.query(`SELECT * FROM ops_model_accounts ORDER BY account_id`)).rows;
  } catch (err) {
    if (isMissingTable(err)) throw migrationPendingError(err);
    throw err;
  }
  return {
    accounts: rows.map((r) => ({
      account_id: r.account_id,
      provider: r.provider,
      plan: r.plan ?? null,
      five_hour_pct: r.five_hour_pct ?? null,
      seven_day_pct: r.seven_day_pct ?? null,
      reset_at: r.reset_at ?? null,                 // 5h 窗重置时刻
      // 0921 起一并暴露：光看水位看不出"快满"还是"快重置了"。
      // 0921 实例：account2 7d=85% 但 2 小时后就滚窗——只显示 85% 会让人误判成要干预。
      seven_day_reset_at: r.seven_day_reset_at ?? null,
      seven_day_sonnet_pct: r.seven_day_sonnet_pct ?? null,
      seven_day_opus_pct: r.seven_day_opus_pct ?? null,
      host_alias: r.host_alias,
      forwardable: r.forwardable,
      forward_targets: r.forward_targets ?? [],
      status: r.status,
      last_checked_at: r.last_checked_at ?? null,
      last_error: r.last_error ?? null,
    })),
    server_now: now.toISOString(),
  };
}

export async function buildCalendarPayload(dbPool, now = new Date()) {
  let tasks, schedules, recurring;
  try {
    tasks = (await dbPool.query(
      `SELECT id, title, task_type, status, location, claimed_by, executor_kind, updated_at
       FROM tasks WHERE updated_at > NOW() - INTERVAL '24 hours'
         AND status IN ('in_progress','completed','failed','blocked','cancelled')
       ORDER BY updated_at DESC LIMIT 200`)).rows;
    schedules = (await dbPool.query(`SELECT * FROM ops_schedule_entries WHERE active = TRUE ORDER BY source, label`)).rows;
    recurring = (await dbPool.query(
      `SELECT title, cron_expression, last_run_at, next_run_at, last_run_status, is_active
       FROM recurring_tasks WHERE is_active = TRUE`)).rows;
  } catch (err) {
    if (isMissingTable(err)) throw migrationPendingError(err);
    throw err;
  }
  const DEAD_MS = 3 * 24 * 3600 * 1000;
  return {
    runs: tasks.map((t) => ({
      ...t,
      skill: SKILL_BY_TASK_TYPE[t.task_type] ?? null, // 推不出=null，前端显示"未标注"，禁编造
      machine: t.location || null,                     // 只有 us/hk/xian 粒度，如实透出
    })),
    schedules: [
      ...schedules.map((s) => ({ ...s, suspicious: false })),
      ...recurring.map((r) => ({
        source: 'brain', host_alias: 'local', label: r.title, kind: 'brain_recurring',
        schedule_desc: r.cron_expression || '', next_run_utc: r.next_run_at, last_state: r.last_run_status,
        // executeTick 废弃族：长期无实跑的排程标 ⚠️，禁画绿灯
        suspicious: !r.last_run_at || (now - new Date(r.last_run_at)) > DEAD_MS,
      })),
    ],
    server_now: now.toISOString(),
  };
}

// 编排角色：orchestrates 非空=orchestrator(它是某 workflow 的头)；否则被编排=member；都不=solo。
// 一个 agent 可能既编排又被编排(如 work-commander)，优先标 orchestrator(它领一个 workflow)，
// 父归属另由 orchestrated_by 数组表达。
export function computeAgentRole(orchestrates = [], orchestratedBy = []) {
  if (orchestrates.length > 0) return 'orchestrator';
  if (orchestratedBy.length > 0) return 'member';
  return 'solo';
}

// 合并投影：一行=一个"运行单元"。ops_agents 每行为主，launchd 的 schedule 按 name==label 合并进同一行；
// 无对应 agent 的排程(gha/brain_recurring)独立成行 role=scheduled。调度(desc/next_run)是属性不是独立库。
export async function buildGraphPayload(dbPool, now = new Date()) {
  let agents, schedules, hbs, recurring;
  try {
    agents = (await dbPool.query(`SELECT * FROM ops_agents ORDER BY source, host_alias, name`)).rows;
    schedules = (await dbPool.query(`SELECT * FROM ops_schedule_entries WHERE active = TRUE ORDER BY source, label`)).rows;
    hbs = (await dbPool.query(`SELECT * FROM ops_source_heartbeats`)).rows;
    recurring = (await dbPool.query(
      `SELECT title, cron_expression, last_run_at, next_run_at, last_run_status, is_active
       FROM recurring_tasks WHERE is_active = TRUE`)).rows;
  } catch (err) {
    if (isMissingTable(err)) throw migrationPendingError(err);
    throw err;
  }
  const staleMs = STALE_FACTOR * INTERVAL_MS;
  const DEAD_MS = 3 * 24 * 3600 * 1000;
  const staleByKey = new Map(hbs.map((h) => [`${h.source}|${h.host_alias}`,
    h.source_status !== 'ok' || !h.last_report_at || (now - new Date(h.last_report_at)) > staleMs]));
  const sources = hbs.map((h) => ({
    source: h.source, host_alias: h.host_alias, source_status: h.source_status,
    reason_code: h.reason_code, last_error: h.last_error, last_report_at: h.last_report_at,
    stale: staleByKey.get(`${h.source}|${h.host_alias}`),
  }));
  const global_stale = sources.length === 0 || sources.every((s) => s.stale);

  // 反查 orchestrated_by：child → [parents]
  const orchestratedBy = new Map();
  for (const a of agents) {
    for (const child of a.meta?.orchestrates || []) {
      if (!orchestratedBy.has(child)) orchestratedBy.set(child, []);
      orchestratedBy.get(child).push(a.name);
    }
  }
  // schedule 按 (source,host,label) 索引，供 agent 行合并 + 标记已消费
  const schedByKey = new Map(schedules.map((s) => [`${s.source}|${s.host_alias}|${s.label}`, s]));
  const consumed = new Set();

  const units = agents.map((a) => {
    const orchestrates = a.meta?.orchestrates || [];
    const parents = orchestratedBy.get(a.name) || [];
    const schedKey = `${a.source}|${a.host_alias}|${a.name}`;
    const sched = schedByKey.get(schedKey);
    if (sched) consumed.add(schedKey);
    return {
      source: a.source, host_alias: a.host_alias, name: a.name, agent_type: a.agent_type,
      status: a.status, last_seen_at: a.last_seen_at,
      role: computeAgentRole(orchestrates, parents),
      orchestrates, orchestrated_by: parents,
      kind: sched?.kind ?? null,
      schedule_desc: sched?.schedule_desc ?? null,
      next_run_utc: sched?.next_run_utc ?? null,
      stale: staleByKey.get(`${a.source}|${a.host_alias}`) ?? true,
    };
  });

  // 孤儿排程（无对应 agent）：独立成行 role=scheduled
  for (const s of schedules) {
    const k = `${s.source}|${s.host_alias}|${s.label}`;
    if (consumed.has(k)) continue;
    units.push({
      source: s.source, host_alias: s.host_alias, name: s.label, agent_type: 'schedule',
      status: 'active', last_seen_at: null, role: 'scheduled',
      orchestrates: [], orchestrated_by: [],
      kind: s.kind, schedule_desc: s.schedule_desc, next_run_utc: s.next_run_utc,
      stale: staleByKey.get(`${s.source}|${s.host_alias}`) ?? true,
    });
  }
  // recurring_tasks（Brain 内部定时）：并入，死排程标 suspicious
  for (const r of recurring) {
    units.push({
      source: 'brain', host_alias: 'local', name: r.title, agent_type: 'brain_recurring',
      status: 'active', last_seen_at: r.last_run_at, role: 'scheduled',
      orchestrates: [], orchestrated_by: [],
      kind: 'brain_recurring', schedule_desc: r.cron_expression || '', next_run_utc: r.next_run_at,
      suspicious: !r.last_run_at || (now - new Date(r.last_run_at)) > DEAD_MS,
      stale: staleByKey.get('brain|local') ?? false,
    });
  }

  return { units, sources, global_stale, stale_threshold_ms: staleMs, server_now: now.toISOString() };
}

const router = Router();

function handle(builder) {
  return async (req, res) => {
    try {
      res.json({ success: true, data: await builder(pool, new Date()) });
    } catch (err) {
      if (err.reason_code === 'migration_pending') {
        return res.status(503).json({ success: false, error: { code: 'migration_pending', message: err.message } });
      }
      console.error('[agent-ops]', err);
      res.status(500).json({ success: false, error: { code: 'internal', message: err.message } });
    }
  };
}

router.get('/agents', handle(buildAgentsPayload));
router.get('/calendar', handle(buildCalendarPayload));
router.get('/graph', handle(buildGraphPayload)); // 合并视图：运行单元行（agent+schedule 去重，role/workflow 现算）
router.get('/model-accounts', handle(buildModelAccountsPayload)); // 8 模型账号配额快照（刀2）

export default router;
