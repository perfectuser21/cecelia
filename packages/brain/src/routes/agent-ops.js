/**
 * agent-ops.js — 运行舱只读端点（指挥舱 G1 S1 刀1，task 6fcb5356）
 * GET /agent-ops/agents   — agent/机器清单 + per-source freshness
 * GET /agent-ops/calendar — 过去24h实跑 + 排程面（ops_schedule_entries；recurring_tasks 模板已落表）
 * GET /agent-ops/alarms   — 闹钟总账：统一 11 列 + 来源心跳 + 未登记数（任务 fe10d1a0）
 * 契约：0条须 source_status 佐证；42P01→503 migration_pending 禁 200 空数组；stale 用服务端时钟。
 */
import { Router } from 'express';
import pool from '../db.js';
import { INTERVAL_MS } from '../ops-collector.js';
import { MODEL_ACCOUNT_STATUS } from '../ops-model-accounts-collector.js';
import { statusFromCollectorState } from '../ops-alarm-ledger.js';
import { importInventorySnapshot } from '../ops-alarm-import.js';
import { internalAuthOrLoopback } from '../middleware/internal-auth.js';

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

const RECURRING_DEAD_MS = 3 * 24 * 3600 * 1000;

// executeTick 废弃族：recurring 模板长期无实跑 → ⚠️，禁画绿灯。模板已落 ops_schedule_entries(kind=brain_recurring)，
// 判定改读表里的 last_run_at（原先在 API 层拼接 recurring_tasks 时现算）。
function isSuspiciousSchedule(s, now) {
  return s.kind === 'brain_recurring' && (!s.last_run_at || (now - new Date(s.last_run_at)) > RECURRING_DEAD_MS);
}

// 盘点静态快照行（source=inventory-20261004）只进 /alarms 总账，不进 calendar/graph 的"实时采集"视图。
const LIVE_SCHEDULES_SQL = `SELECT * FROM ops_schedule_entries WHERE active = TRUE AND source <> 'inventory-20261004' ORDER BY source, label`;

export async function buildCalendarPayload(dbPool, now = new Date()) {
  let tasks, schedules;
  try {
    tasks = (await dbPool.query(
      `SELECT id, title, task_type, status, location, claimed_by, executor_kind, updated_at
       FROM tasks WHERE updated_at > NOW() - INTERVAL '24 hours'
         AND status IN ('in_progress','completed','failed','blocked','cancelled')
       ORDER BY updated_at DESC LIMIT 200`)).rows;
    schedules = (await dbPool.query(LIVE_SCHEDULES_SQL)).rows;
  } catch (err) {
    if (isMissingTable(err)) throw migrationPendingError(err);
    throw err;
  }
  return {
    runs: tasks.map((t) => ({
      ...t,
      skill: SKILL_BY_TASK_TYPE[t.task_type] ?? null, // 推不出=null，前端显示"未标注"，禁编造
      machine: t.location || null,                     // 只有 us/hk/xian 粒度，如实透出
    })),
    schedules: schedules.map((s) => ({ ...s, suspicious: isSuspiciousSchedule(s, now) })),
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
  let agents, schedules, hbs;
  try {
    agents = (await dbPool.query(`SELECT * FROM ops_agents ORDER BY source, host_alias, name`)).rows;
    schedules = (await dbPool.query(LIVE_SCHEDULES_SQL)).rows;
    hbs = (await dbPool.query(`SELECT * FROM ops_source_heartbeats`)).rows;
  } catch (err) {
    if (isMissingTable(err)) throw migrationPendingError(err);
    throw err;
  }
  const staleMs = STALE_FACTOR * INTERVAL_MS;
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

  // 孤儿排程（无对应 agent）：独立成行 role=scheduled。
  // recurring_tasks 模板、Brain job 已落 ops_schedule_entries（registered_via 非空，来源不是采集腿，
  // 没有 per-source 心跳可比对 → stale=false）；死 recurring 排程标 suspicious。
  for (const s of schedules) {
    const k = `${s.source}|${s.host_alias}|${s.label}`;
    if (consumed.has(k)) continue;
    const selfRegistered = Boolean(s.registered_via) && s.registered_via !== 'external-legacy';
    units.push({
      source: s.source, host_alias: s.host_alias, name: s.label,
      agent_type: s.kind === 'brain_recurring' ? 'brain_recurring' : 'schedule',
      status: 'active', last_seen_at: s.kind === 'brain_recurring' ? s.last_run_at : null, role: 'scheduled',
      orchestrates: [], orchestrated_by: [],
      kind: s.kind, schedule_desc: s.schedule_desc, next_run_utc: s.next_run_utc,
      ...(s.kind === 'brain_recurring' ? { suspicious: isSuspiciousSchedule(s, now) } : {}),
      stale: staleByKey.get(`${s.source}|${s.host_alias}`) ?? !selfRegistered,
    });
  }

  return { units, sources, global_stale, stale_threshold_ms: staleMs, server_now: now.toISOString() };
}

/** 定时机制（总账「定时机制」列）：采集腿的 kind 归一；盘点快照行的 kind 本身就是机制名。 */
export function mechanismOf(kind) {
  const k = String(kind ?? '');
  if (k === 'brain_job') return 'brain-job';
  if (k === 'brain_recurring') return 'recurring_tasks';
  if (k === 'gha_cron') return 'gha-schedule';
  if (k.startsWith('launchd')) return 'launchd';
  if (k.startsWith('openclaw_')) return 'openclaw-cron';
  return k || 'unknown';
}

function toAlarmRow(r) {
  const capability = r.journey_parent_id ? String(r.journey_name).split(' · ').pop() : null;
  const treePath = r.journey_id
    ? [r.department_name, r.value_stream_name, capability].filter(Boolean).join(' / ')
    : (r.tree_bucket_manual || null);
  return {
    id: String(r.id),
    name: r.label,
    machine: r.host_alias,
    source: r.source,
    mechanism: mechanismOf(r.kind),
    cadence: r.schedule_desc || '',
    interval_sec: r.interval_sec ?? null,
    enabled: r.enabled !== false,
    tree: {
      path: treePath,
      department: r.journey_id ? (r.department_name ?? null) : null,
      value_stream: r.journey_id ? (r.value_stream_name ?? null) : null,
      capability,
      bucket: r.tree_bucket_manual ?? null,
    },
    last_run_at: r.last_run_at ?? null,
    last_success_at: r.last_success_at ?? null,
    last_status: r.last_status ?? statusFromCollectorState(r.last_state, r.last_exit_code),
    liveness: r.liveness ?? null,
    silent_sec: r.silent_sec ?? null,
    next_run_utc: r.next_run_utc ?? null,
    note: r.note_manual || r.note || null,
    owner: r.owner_manual ?? null,
    registered_via: r.registered_via ?? null,
    ledger_status: r.ledger_status,
  };
}

// GET /agent-ops/alarms — 闹钟总账：统一 11 列（# 名称 机器 机制 周期 启用 挂树 上次运行 上次成功 最近状态 备注）
// + 各来源采集心跳 + 未登记数。数据全部来自 ops_schedule_entries（不建新表，决策 9e9d90b6）。
export async function buildAlarmsPayload(dbPool, now = new Date()) {
  let rows, hbs;
  try {
    rows = (await dbPool.query(
      `SELECT e.*, j.name AS journey_name, j.parent_journey_id AS journey_parent_id,
              vs.name AS value_stream_name, a.name AS department_name
         FROM ops_schedule_entries e
         LEFT JOIN journeys j ON j.id = e.journey_id
         LEFT JOIN journeys vs ON vs.id = COALESCE(j.parent_journey_id, j.id)
         LEFT JOIN areas a ON a.id = vs.area_id
        WHERE e.active = TRUE
        ORDER BY e.source, e.host_alias, e.label`)).rows;
    hbs = (await dbPool.query(`SELECT * FROM ops_source_heartbeats ORDER BY source, host_alias`)).rows;
  } catch (err) {
    if (isMissingTable(err) || err?.code === '42703') throw migrationPendingError(err); // 42703=517 新列未迁
    throw err;
  }
  const staleMs = STALE_FACTOR * INTERVAL_MS;
  const alarms = rows.map(toAlarmRow);
  const tally = (key) => alarms.reduce((m, a) => { m[a[key]] = (m[a[key]] || 0) + 1; return m; }, {});
  return {
    alarms,
    summary: {
      total: alarms.length,
      enabled: alarms.filter((a) => a.enabled).length,
      by_mechanism: tally('mechanism'),
      by_status: tally('last_status'),
      unregistered: alarms.filter((a) => a.ledger_status === 'unregistered').length, // 棘轮只许降
      without_tree: alarms.filter((a) => !a.tree.path).length,
    },
    sources: hbs.map((h) => ({
      source: h.source, host_alias: h.host_alias, source_status: h.source_status,
      reason_code: h.reason_code, last_error: h.last_error,
      last_report_at: h.last_report_at, last_collected_at: h.last_collected_at,
      stale: h.source_status !== 'ok' || !h.last_report_at || (now - new Date(h.last_report_at)) > staleMs,
    })),
    server_now: now.toISOString(),
  };
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
router.get('/alarms', handle(buildAlarmsPayload)); // 闹钟总账（扩 ops_schedule_entries，任务 fe10d1a0）

// POST /agent-ops/alarms/import — 盘点静态快照一次性导入（E.4）。内部令牌鉴权；缺省 dry_run=true，必须显式 false 才写。
router.post('/alarms/import', internalAuthOrLoopback, async (req, res) => {
  const items = req.body?.items;
  if (!Array.isArray(items) || items.length === 0 || items.length > 1000) {
    return res.status(400).json({ success: false, error: { code: 'bad_request', message: 'items 必须是 1~1000 条的数组' } });
  }
  try {
    const data = await importInventorySnapshot(pool, items, { dryRun: req.body?.dry_run !== false });
    res.json({ success: true, data });
  } catch (err) {
    if (isMissingTable(err) || err?.code === '42703') {
      return res.status(503).json({ success: false, error: { code: 'migration_pending', message: '517 迁移未跑' } });
    }
    console.error('[agent-ops] alarms import', err);
    res.status(500).json({ success: false, error: { code: 'internal', message: err.message } });
  }
});

export default router;
