/** Commander 心跳登记、旧运行失联巡检与趋势告警；不再启动或收养执行器。 */
import { recordTaskEventSafe } from './lib/task-event-log.js';
import { sendBark as defaultBark } from './notifier.js';
import { deriveRunTag, workflowRunLabel } from './workflow-run-lost-deadline.js';

export const DEFAULT_HEARTBEAT_STALE_MS = 15 * 60 * 1000;
const DEFAULT_GATE_MS = 5 * 60 * 1000;
const BATCH_LIMIT = 20;
const SAFE_ARG = /^[A-Za-z0-9._-]{1,64}$/;
const RUN_TYPES_SQL = `(task_type = 'workflow_run' OR (task_type = 'device_job' AND payload->>'source' = 'cron'))`;
const LAUNCH_KEY = (tag) => `commander_launch:${tag}`;
const TREND_KEY = 'workflow_trend_bark:last_day';
let lastWatchdogAt = 0;

function positiveInt(raw, fallback) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
function firstString(...values) {
  for (const v of values) if (typeof v === 'string' && v.trim()) return v.trim();
  return null;
}
function safeArg(v) {
  const s = firstString(v);
  return s && SAFE_ARG.test(s) ? s : null;
}
async function mergeTaskPayload(pool, taskId, patch) {
  const res = await pool.query(
    `UPDATE tasks SET payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb, updated_at = NOW()
      WHERE id = $1 AND status = 'in_progress' RETURNING id`,
    [taskId, JSON.stringify(patch)],
  );
  return (res?.rowCount ?? res?.rows?.length ?? 0) > 0;
}

// ── 心跳 ──────────────────────────────────────────────────────────────────
async function findRunByTag(pool, tag) {
  const { rows } = await pool.query(
    `SELECT id, payload FROM tasks WHERE status = 'in_progress' AND ${RUN_TYPES_SQL} AND payload->>'tag' = $1
      ORDER BY created_at DESC LIMIT 2`, [tag]);
  return rows?.[0] ? { row: rows[0], via: 'tag' } : null;
}
async function findRunByLedger(pool, tag) {
  const { rows } = await pool.query(
    `SELECT t.id, t.payload FROM tasks t JOIN task_runs r ON r.task_id = t.id
      WHERE t.status = 'in_progress' AND ${RUN_TYPES_SQL.replace(/task_type/g, 't.task_type').replace(/payload/g, 't.payload')}
        AND r.run_id LIKE $1 ESCAPE '\\'
      ORDER BY r.started_at DESC LIMIT 2`, [`%-${tag}\\_\\_%`]);
  return rows?.[0] ? { row: rows[0], via: 'ledger' } : null;
}
async function findRunBySerial(pool, serial) {
  const { rows } = await pool.query(
    `SELECT id, payload FROM tasks WHERE status = 'in_progress' AND task_type = 'device_job'
        AND payload->>'source' = 'cron' AND payload->>'serial' = $1 ORDER BY created_at DESC LIMIT 2`, [serial]);
  return rows?.length === 1 ? { row: rows[0], via: 'serial' } : null;
}

async function readLaunch(pool, tag) {
  try {
    const { rows } = await pool.query('SELECT value_json FROM working_memory WHERE key = $1', [LAUNCH_KEY(tag)]);
    const v = rows?.[0]?.value_json;
    return v && typeof v === 'object' ? v : null;
  } catch { return null; }
}

/**
 * 心跳/起跑登记。body: {kind?: 'launch'|'tick', tag, host?, serial?, profile?, cap?, escort_name?, escort_id?}
 * @returns {Promise<{matched:boolean, task_id?:string, via?:string, stored?:string}>}
 */
export async function recordCommanderHeartbeat(pool, body = {}, deps = {}) {
  const tag = safeArg(body.tag);
  const serial = safeArg(body.serial);
  if (body.tag && !tag) throw Object.assign(new Error('tag 非法（只允许 [A-Za-z0-9._-]{1,64}）'), { status: 400 });
  if (!tag && !serial) throw Object.assign(new Error('缺 tag 或 serial'), { status: 400 });
  const now = new Date(deps.now ?? Date.now()).toISOString();
  const fields = {
    tag, host: safeArg(body.host), serial, profile: safeArg(body.profile),
    escort_name: safeArg(body.escort_name), escort_id: safeArg(body.escort_id), cap: safeArg(body.cap),
  };
  const patch = { commander_heartbeat_at: now };
  for (const [k, v] of Object.entries(fields)) if (v) patch[k] = v;

  let hit = tag ? await findRunByTag(pool, tag) : null;
  if (!hit && tag) hit = await findRunByLedger(pool, tag);
  if (!hit && serial) hit = await findRunBySerial(pool, serial);
  if (hit) {
    const launch = tag && !hit.row.payload?.escort_id && !patch.escort_id ? await readLaunch(pool, tag) : null;
    if (launch?.escort_id) patch.escort_id = launch.escort_id;
    if (launch?.host && !patch.host) patch.host = launch.host;
    const ok = await mergeTaskPayload(pool, hit.row.id, patch);
    return { matched: ok, task_id: hit.row.id, via: hit.via };
  }
  if (body.kind === 'launch' && tag) {
    await pool.query(
      `INSERT INTO working_memory (key, value_json, updated_at) VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = NOW()`,
      [LAUNCH_KEY(tag), JSON.stringify({ ...fields, at: now })],
    );
    return { matched: false, stored: 'launch' };
  }
  return { matched: false, stored: 'none' };
}

// ── 看门狗 ────────────────────────────────────────────────────────────────
async function loadRunTags(pool, taskId) {
  try {
    const { rows } = await pool.query(
      `SELECT run_id, ended_at FROM task_runs WHERE task_id = $1 ORDER BY started_at DESC LIMIT 10`, [taskId]);
    return (rows ?? []).map((r) => r.run_id);
  } catch { return []; }
}
async function loadPhone(pool, serial) {
  if (!serial) return null;
  try {
    const { rows } = await pool.query('SELECT host, profile FROM phone_registry WHERE serial = $1 LIMIT 1', [serial]);
    return rows?.[0] ?? null;
  } catch { return null; }
}

async function resolveRunContext(pool, task) {
  const p = task.payload ?? {};
  const serial = safeArg(p.serial ?? p.device_serial);
  const tag = safeArg(p.tag ?? p.run_tag) ?? deriveRunTag(task, await loadRunTags(pool, task.id));
  const launch = tag ? await readLaunch(pool, tag) : null;
  let host = safeArg(p.host ?? p.hostkey ?? p.machine ?? launch?.host);
  if (serial && !host) host = safeArg((await loadPhone(pool, serial))?.host);
  return { tag, host, serial };
}

/** scheduler 巡检仅发失联告警，成功后记去重时间；不冒充心跳或执行恢复。 */
export async function runCommanderWatchdog(pool, deps = {}) {
  const now = deps.now ?? Date.now();
  const gateMs = deps.gateMs ?? DEFAULT_GATE_MS;
  const out = { scanned: 0, relaunched: 0, adopted: 0, barked: 0, failed: 0, skipped: 0 };
  if (gateMs > 0 && now - lastWatchdogAt < gateMs) return { ...out, skipped_reason: 'interval_gate' };
  lastWatchdogAt = now;
  const bark = deps.bark ?? defaultBark;
  const staleMs = deps.staleMs ?? positiveInt(process.env.COMMANDER_HEARTBEAT_STALE_MS, DEFAULT_HEARTBEAT_STALE_MS);
  let rows;
  try {
    ({ rows } = await pool.query(
      `SELECT id, title, task_type, payload
         FROM tasks
        WHERE status = 'in_progress' AND ${RUN_TYPES_SQL}
          AND COALESCE(started_at, due_at, created_at) < NOW() - ($1::bigint * interval '1 millisecond')
          AND COALESCE(NULLIF(payload->>'commander_heartbeat_at', '')::timestamptz, '-infinity'::timestamptz)
              < NOW() - ($1::bigint * interval '1 millisecond')
          AND payload->>'commander_bark_at' IS NULL
        ORDER BY COALESCE(started_at, due_at, created_at) ASC
        LIMIT ${BATCH_LIMIT}`,
      [staleMs],
    ));
  } catch (err) {
    console.warn(`[cmdr-watchdog] 扫描失败: ${err.message}`);
    return { ...out, error: err.message };
  }
  out.scanned = rows?.length ?? 0;
  for (const task of rows ?? []) {
    try {
      const ctx = await resolveRunContext(pool, task);
      const sent = await bark('Commander 心跳失联',
        `${workflowRunLabel(task)} TAG=${ctx.tag ?? '-'} 机器=${ctx.host ?? '-'} serial=${ctx.serial ?? '-'} 单=${task.id.slice(0, 8)}：心跳缺失或过期；旧 OpenClaw 陪跑已退役，请核查运行现场`,
        { dedupeKey: `commander-stale:${task.id}`, dedupeTtlSec: 86400 });
      if (sent === false) throw new Error('bark_not_sent');
      await mergeTaskPayload(pool, task.id, { commander_bark_at: new Date(now).toISOString() });
      await recordTaskEventSafe(pool, task.id, 'commander_heartbeat_stale', ctx);
      out.barked += 1;
    } catch (err) {
      out.failed += 1;
      console.warn(`[cmdr-watchdog] ${task.id} 失联告警失败: ${err.message}`);
    }
  }
  return out;
}

// ── 趋势 Bark ──────────────────────────────────────────────────────────────
function beijingParts(ms) {
  const d = new Date(ms + 8 * 3600 * 1000);
  return { day: d.toISOString().slice(0, 10), minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
}
function dayOffset(day, delta) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/**
 * 每日趋势 Bark（北京 08:30–10:00 窗口，working_memory 当日去重）。deps: bark / now / staleSerialMs / windowOverride。
 */
export async function runWorkflowTrendBark(pool, deps = {}) {
  const now = deps.now ?? Date.now();
  const bark = deps.bark ?? defaultBark;
  const { day, minutes } = beijingParts(now);
  if (!deps.windowOverride && (minutes < 8 * 60 + 30 || minutes > 10 * 60)) return { skipped: 'outside_window' };
  try {
    const { rows } = await pool.query('SELECT value_json FROM working_memory WHERE key = $1', [TREND_KEY]);
    if (rows?.[0]?.value_json?.day === day) return { skipped: 'already_today' };
  } catch (err) {
    console.warn(`[trend-bark] 去重键读取失败（照跑）: ${err.message}`);
  }
  const out = { day, zeroLeads: [], staleSerials: [], barks: 0 };
  // ① 同一 wf 连续 2 个自然日（北京）零线索：能力名只认 payload 字段/标题前段，不认账本 run_id 前缀
  try {
    const { rows } = await pool.query(
      `SELECT COALESCE(payload->>'wf_id', payload->>'capability', payload->>'cap', split_part(title, ' · ', 1)) AS label,
              (COALESCE(completed_at, updated_at)::timestamptz AT TIME ZONE 'Asia/Shanghai')::date::text AS day,
              COUNT(*) AS runs,
              COALESCE(SUM(COALESCE(NULLIF(payload->>'leads', '')::numeric, NULLIF(result->'metrics'->>'leads', '')::numeric, 0)), 0) AS leads
         FROM tasks
        WHERE status IN ('completed', 'failed') AND ${RUN_TYPES_SQL}
          AND COALESCE(completed_at, updated_at) >= NOW() - interval '4 days'
        GROUP BY 1, 2`);
    const d1 = dayOffset(day, -1);
    const d2 = dayOffset(day, -2);
    const byLabel = new Map();
    for (const r of rows ?? []) {
      if (!byLabel.has(r.label)) byLabel.set(r.label, {});
      byLabel.get(r.label)[r.day] = { runs: Number(r.runs), leads: Number(r.leads) };
    }
    for (const [label, days] of byLabel) {
      const a = days[d1]; const b = days[d2];
      if (a && b && a.runs > 0 && b.runs > 0 && a.leads === 0 && b.leads === 0) out.zeroLeads.push(label);
    }
    if (out.zeroLeads.length) {
      const sent = await bark('workflow 连续 2 天零线索', `${out.zeroLeads.join('、')}：${d2}/${d1} 两天有批但 0 线索，请看趋势表`, { dedupeKey: `trend:zero-leads:${day}`, dedupeTtlSec: 86400 });
      if (sent !== false) out.barks += 1;
    }
  } catch (err) {
    console.warn(`[trend-bark] 零线索统计失败: ${err.message}`);
  }
  // ② 一台 serial 近 72h 有批但 24h 无 completed
  try {
    const { rows } = await pool.query(
      `SELECT p.serial, p.nickname,
              COUNT(t.id) FILTER (WHERE t.created_at >= NOW() - interval '72 hours') AS recent_runs,
              MAX(t.completed_at) FILTER (WHERE t.status = 'completed') AS last_ok
         FROM phone_registry p
         LEFT JOIN tasks t ON t.task_type = 'device_job' AND t.payload->>'source' = 'cron'
              AND t.payload->>'serial' = p.serial AND t.created_at >= NOW() - interval '7 days'
        WHERE p.enabled = true
        GROUP BY p.serial, p.nickname`);
    const staleMs = deps.staleSerialMs ?? 24 * 3600 * 1000;
    const names = [];
    for (const r of rows ?? []) {
      if (Number(r.recent_runs) <= 0) continue;
      const lastOk = r.last_ok ? new Date(r.last_ok).getTime() : null;
      if (lastOk === null || now - lastOk > staleMs) { out.staleSerials.push(r.serial); names.push(r.nickname || r.serial); }
    }
    if (names.length) {
      const sent = await bark('手机 24h 无成功批', `${names.join('、')}：近 72h 有批但 24h 内没有 completed，请查设备`, { dedupeKey: `trend:stale-serial:${day}`, dedupeTtlSec: 86400 });
      if (sent !== false) out.barks += 1;
    }
  } catch (err) {
    console.warn(`[trend-bark] 手机 24h 统计失败: ${err.message}`);
  }
  try {
    await pool.query(
      `INSERT INTO working_memory (key, value_json, updated_at) VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = NOW()`,
      [TREND_KEY, JSON.stringify({ day, zero_leads: out.zeroLeads, stale_serials: out.staleSerials, barks: out.barks })],
    );
  } catch (err) {
    console.warn(`[trend-bark] 去重键写入失败: ${err.message}`);
  }
  return out;
}
