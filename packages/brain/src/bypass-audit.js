/**
 * bypass-audit.js — 旁路报警（派发总闸 H，Brain 任务 865b502c）
 *
 * 目标：活不经过 Brain 就动手机或对外发东西 → 留「旁路动作」事件，按天汇总进运维记录，
 * 对外/动真人的旁路超过阈值才 Bark（决策 d3e7746c：系统类不推主理人）。先只告警不拦截。
 *
 * 覆盖三类（其余类别不在本期范围）：
 *   phone_lock    —— 手机领锁：Brain 设备锁 API 被调用、持有者追不到 Brain 任务（执行机 crontab 经 brain-lock.sh 领锁）；
 *                    执行机控制器本地领锁也可经 POST /bypass-actions/report 上报
 *   phone_outward —— 手机对外动作（发布/私信/点赞/关注/评论）：执行机控制器上报
 *   openclaw_push —— OpenClaw 对外推送：Brain 只读扫 MMV OpenClaw 审计库的 message 工具调用
 *
 * 「关联到 Brain」的判定一律在 Brain 侧做（执行机自报的 task_id 不直接采信）：
 *   tasks.id = 持有者/上报 task_id（uuid），或 tasks.payload.run_id = run（qiumi-/wfd- 等 Brain 生成的 run_id），
 *   或 run 形如 qiumi|wfd-<任务号前 8 位>-<毫秒>（重派换了 run_id 后迟到的上报也认得）。
 * 事件落 cecelia_events（event_type='bypass_action'，source=类别），按天汇总写 runs 一行
 * bypass-audit:<上海日期>，经现有 runs → Notion「最近执行」投影出现，不直写 Notion。
 */
import { existsSync } from 'fs';
import { defaultExecAsync, buildHostCmd } from './host-exec.js';
import { sendBark as defaultSendBark } from './notifier.js';
import { buildMmvCmd, parseSqliteJson } from './openclaw-run-ingest.js';

export const BYPASS_EVENT_TYPE = 'bypass_action';
export const BYPASS_KINDS = ['phone_lock', 'phone_outward', 'openclaw_push'];
const KIND_LABEL = { phone_lock: '手机领锁', phone_outward: '手机对外动作', openclaw_push: 'OpenClaw 对外推送' };
/** 对外/动真人的类别才可能 Bark；默认阈值（当天次数 ≥ 阈值），可用环境变量覆盖 */
const BARK_THRESHOLD_ENV = { phone_outward: ['BYPASS_BARK_PHONE_OUTWARD', 1], openclaw_push: ['BYPASS_BARK_OPENCLAW_PUSH', 5] };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BRAIN_RUN_RE = /^(?:qiumi|wfd)-([0-9a-f]{8})-\d{13}$/i;
const QIUMI_ROOT_RE = /^(qiumi-[0-9a-f]{8}-\d{13})(?:[-_]a\d+[-_].*)?$/i;
const FIELD_MAX = 300;
const GATE_INTERVAL_MS = 300_000;
const SCAN_LOOKBACK_MS = 2 * 3600_000;
const SCAN_OVERLAP_MS = 60_000;
const SCAN_LIMIT = 500;
const EXEC_TIMEOUT_MS = 60_000;
const DAY_MS = 86400_000;
const SH_OFFSET_MS = 8 * 3600_000;

let lastScanAt = 0;
let lastRollupAt = 0;
let scanCursorMs = null;

/** 测试用：重置自 gate 与扫描游标 */
export function _resetBypassAuditGates() {
  lastScanAt = 0;
  lastRollupAt = 0;
  scanCursorMs = null;
}

const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v.trim());
const clip = (v) => (v === null || v === undefined || v === '' ? null : String(v).slice(0, FIELD_MAX));

/** 与执行机 douyin-phone-adb 的 normalize_run_id 同口径：剥 :aN、-aN-<阶段>-<次数>、批次词序 -wN */
export function normalizeRunId(value) {
  let v = String(value ?? '').trim().split(':')[0];
  if (!v) return '';
  const q = QIUMI_ROOT_RE.exec(v);
  if (q) return q[1];
  v = v.replace(/[-_]a\d+[-_].*$/, '');
  return v.replace(/-w\d+$/, '');
}

/** 持有者 / 上报的 task_id / run_id 能否追到一条 Brain 任务；追不到返回 null */
export async function findLinkedTask(pool, { taskId, runId, owner } = {}) {
  const raw = [taskId, runId, owner].map((v) => (v === null || v === undefined ? '' : String(v).trim()));
  const uuids = [...new Set(raw.filter(isUuid))];
  const runIds = [...new Set([runId, owner].flatMap((v) => {
    const t = String(v ?? '').trim();
    return t ? [t, normalizeRunId(t)] : [];
  }).filter((v) => v && !isUuid(v)))];
  const prefixes = [...new Set(runIds.map((v) => BRAIN_RUN_RE.exec(v)?.[1]).filter(Boolean).map((h) => `${h.toLowerCase()}%`))];
  if (uuids.length === 0 && runIds.length === 0) return null;
  const { rows } = await pool.query(
    `SELECT id, status FROM tasks
      WHERE id::text = ANY($1)
         OR (created_at > now() - interval '30 days'
             AND (payload->>'run_id' = ANY($2) OR id::text LIKE ANY($3)))
      ORDER BY created_at DESC LIMIT 1`,
    [uuids, runIds, prefixes],
  );
  return rows[0] ? { id: rows[0].id, status: rows[0].status } : null;
}

/**
 * 记一次可能的旁路动作：能追到 Brain 任务 → 不记（正常派发不误报）；追不到 → 写 cecelia_events。
 * dedupe_key 相同的事件 2 天内只记一次（锁心跳续租、扫描窗口重叠都不重复）。
 */
export async function recordBypassAction(pool, input = {}) {
  const kind = String(input.kind ?? '');
  if (!BYPASS_KINDS.includes(kind)) throw new Error(`invalid_kind: ${kind}`);
  const linked = await findLinkedTask(pool, { taskId: input.task_id, runId: input.run_id, owner: input.owner });
  if (linked) return { bypass: false, linked_task_id: linked.id };

  const dedupeKey = clip(input.dedupe_key);
  if (dedupeKey) {
    const { rows } = await pool.query(
      `SELECT id FROM cecelia_events
        WHERE event_type = $1 AND payload->>'dedupe_key' = $2 AND created_at > now() - interval '2 days'
        LIMIT 1`,
      [BYPASS_EVENT_TYPE, dedupeKey],
    );
    if (rows.length > 0) return { bypass: true, recorded: false, deduped: true, event_id: rows[0].id };
  }

  const payload = {
    kind,
    action: clip(input.action),
    device: clip(input.device),
    host: clip(input.host),
    owner: clip(input.owner),
    run_id: clip(input.run_id),
    task_id: clip(input.task_id),
    source: clip(input.source),
    command: clip(input.command),
    dedupe_key: dedupeKey,
    detail: input.detail && typeof input.detail === 'object' ? input.detail : null,
  };
  const { rows } = await pool.query(
    'INSERT INTO cecelia_events (event_type, source, payload) VALUES ($1, $2, $3::jsonb) RETURNING id',
    [BYPASS_EVENT_TYPE, kind, JSON.stringify(payload)],
  );
  return { bypass: true, recorded: true, event_id: rows[0]?.id ?? null };
}

/** Brain 设备锁 API 抢锁成功后调用：持有者追不到 Brain 任务即记 phone_lock 旁路（同持有者同设备只记一次） */
export function noteDeviceLockAcquire(pool, { device, owner, taskId, runId, host }) {
  return recordBypassAction(pool, {
    kind: 'phone_lock', device, owner, task_id: taskId, run_id: runId, host,
    source: 'device-lock-api', action: 'lock-acquire', dedupe_key: `lock:${device}:${owner}`,
  });
}

/** OpenClaw 会话键 agent:<agent>:<会话>。Brain 派发的会话 = agent:<dept>:<run_id>；agent:<x>:main = 与主理人对话 */
export function parseOpenclawSession(sessionKey) {
  const m = /^agent:([^:]+):(.+)$/.exec(String(sessionKey ?? ''));
  if (!m) return null;
  return { agent: m[1], sessionId: m[2], conversation: m[2] === 'main' };
}

/** 只读 OpenClaw 审计库里 message 工具（对外发消息）的开始事件；数字直接内插，只收整数 */
export function buildOpenclawPushSql({ sinceMs, limit = SCAN_LIMIT }) {
  if (!Number.isSafeInteger(sinceMs)) throw new Error(`invalid_sinceMs: ${String(sinceMs)}`);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 2000) throw new Error(`invalid_limit: ${String(limit)}`);
  return [
    'SELECT occurred_at,agent_id,session_key,tool_call_id,run_id,status FROM audit_events',
    "WHERE kind='tool_action' AND action='tool.action.started' AND tool_name='message'",
    `AND occurred_at >= ${sinceMs} ORDER BY occurred_at LIMIT ${limit}`,
  ].join(' ');
}

/** 扫 MMV OpenClaw 审计库增量 message 调用 → 追不到 Brain run 的记 openclaw_push 旁路（自 gate 5 分钟） */
export async function runOpenclawPushScan(pool, deps = {}) {
  const exec = deps.exec ?? defaultExecAsync;
  const inContainer = deps.inContainer ?? existsSync('/.dockerenv');
  const nowMs = (deps.now ?? Date.now)();
  if (lastScanAt && nowMs - lastScanAt < GATE_INTERVAL_MS) return { skipped: true };
  lastScanAt = nowMs;

  const sinceMs = scanCursorMs ?? nowMs - SCAN_LOOKBACK_MS;
  const stdout = await exec(buildHostCmd(buildMmvCmd(buildOpenclawPushSql({ sinceMs })), inContainer), { timeoutMs: EXEC_TIMEOUT_MS });
  const rows = parseSqliteJson(stdout);
  const stats = { fetched: rows.length, recorded: 0, linked: 0, conversation: 0, deduped: 0 };
  let maxSeen = null;
  for (const row of rows) {
    const at = Number(row.occurred_at);
    if (Number.isFinite(at)) maxSeen = Math.max(maxSeen ?? at, at);
    const s = parseOpenclawSession(row.session_key);
    if (s?.conversation) { stats.conversation += 1; continue; }
    const r = await recordBypassAction(pool, {
      kind: 'openclaw_push', owner: row.session_key, run_id: s?.sessionId ?? null, host: 'mmv',
      source: 'openclaw-audit', action: 'message',
      dedupe_key: `openclaw:${row.tool_call_id || `${row.run_id}:${row.occurred_at}`}`,
      detail: { agent_id: row.agent_id ?? null, openclaw_run_id: row.run_id ?? null, occurred_at_ms: Number.isFinite(at) ? at : null },
    });
    if (!r.bypass) stats.linked += 1;
    else if (r.recorded) stats.recorded += 1;
    else stats.deduped += 1;
  }
  if (maxSeen !== null) scanCursorMs = Math.max(sinceMs, maxSeen - SCAN_OVERLAP_MS);
  return stats;
}

/** 上海日历日 YYYY-MM-DD */
export function shanghaiDay(ms) {
  return new Date(ms + SH_OFFSET_MS).toISOString().slice(0, 10);
}

function barkThreshold(kind) {
  const conf = BARK_THRESHOLD_ENV[kind];
  if (!conf) return null;
  const n = Number(process.env[conf[0]]);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : conf[1];
}

// cecelia_events.created_at 是不带时区的 timestamp（按会话时区存 now()），边界换算到同一时区再比
const DAY_COUNT_SQL = `
  SELECT source AS kind, count(*)::int AS n FROM cecelia_events
   WHERE event_type = $1
     AND created_at >= ($2::timestamptz AT TIME ZONE current_setting('TimeZone'))
     AND created_at <  ($3::timestamptz AT TIME ZONE current_setting('TimeZone'))
   GROUP BY source`;

const UPSERT_DAY_RUN_SQL = `
  INSERT INTO runs (run_id, trigger_kind, trigger_ref, executor_kind, executor_id, started_at, ended_at, outcome, error, detail, header_source)
  VALUES ($1, 'schedule', '旁路动作日报', 'code', 'brain:bypass-audit', $2, $3, $4, $5, $6::jsonb, 'owner')
  ON CONFLICT (run_id) DO UPDATE SET
    ended_at = EXCLUDED.ended_at, outcome = EXCLUDED.outcome, error = EXCLUDED.error, detail = EXCLUDED.detail, updated_at = now()
  WHERE runs.outcome IS DISTINCT FROM EXCLUDED.outcome OR runs.detail IS DISTINCT FROM EXCLUDED.detail`;

async function rollupDay(pool, day, nowMs) {
  const startMs = Date.parse(`${day}T00:00:00+08:00`);
  const endMs = startMs + DAY_MS;
  const { rows } = await pool.query(DAY_COUNT_SQL, [BYPASS_EVENT_TYPE, new Date(startMs).toISOString(), new Date(endMs).toISOString()]);
  const counts = Object.fromEntries(BYPASS_KINDS.map((k) => [k, 0]));
  for (const r of rows) if (r.kind in counts) counts[r.kind] = Number(r.n) || 0;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const error = total > 0
    ? `未经 Brain 任务：${BYPASS_KINDS.map((k) => `${KIND_LABEL[k]} ${counts[k]}`).join(' · ')}`
    : null;
  await pool.query(UPSERT_DAY_RUN_SQL, [
    `bypass-audit:${day}`, new Date(startMs), new Date(Math.max(startMs, Math.min(nowMs, endMs))),
    total > 0 ? 'fail' : 'pass', error,
    JSON.stringify({ source: 'bypass-audit', date: day, counts, total, summary: error ?? '当天无旁路动作' }),
  ]);
  return counts;
}

/** 按天汇总（今天 + 昨天收尾）写 runs；当天对外类旁路达阈值 Bark（每天每类最多一次）。自 gate 5 分钟 */
export async function runBypassDailyRollup(pool, deps = {}) {
  const sendBark = deps.sendBark ?? defaultSendBark;
  const nowMs = (deps.now ?? Date.now)();
  if (lastRollupAt && nowMs - lastRollupAt < GATE_INTERVAL_MS) return { skipped: true };
  lastRollupAt = nowMs;

  const day = shanghaiDay(nowMs);
  const counts = await rollupDay(pool, day, nowMs);
  await rollupDay(pool, shanghaiDay(nowMs - DAY_MS), nowMs);

  const barked = [];
  for (const kind of Object.keys(BARK_THRESHOLD_ENV)) {
    const threshold = barkThreshold(kind);
    if (counts[kind] < threshold) continue;
    try {
      await sendBark('旁路对外动作告警', `${day} ${KIND_LABEL[kind]}未经 Brain 任务 ${counts[kind]} 次（阈值 ${threshold}），明细见运维视图 /api/brain/bypass-actions/summary`, {
        dedupeKey: `bypass-alert:${day}:${kind}`,
        dedupeTtlSec: 2 * 86400,
      });
      barked.push(kind);
    } catch (e) {
      console.warn('[bypass-audit] Bark 失败（不影响汇总）:', String(e?.message).slice(0, 160));
    }
  }
  return { day, counts, barked };
}

/** 运维视图：近 N 天按上海日 × 类别汇总 + 最近 20 条明细 */
export async function summarizeBypass(pool, { days = 7 } = {}) {
  const n = Number(days);
  const d = Number.isFinite(n) ? Math.min(30, Math.max(1, Math.floor(n))) : 7;
  const { rows } = await pool.query(
    `SELECT to_char((created_at AT TIME ZONE current_setting('TimeZone')) AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') AS day,
            source AS kind, count(*)::int AS n,
            (array_agg(DISTINCT payload->>'owner'))[1:10] AS owners
       FROM cecelia_events
      WHERE event_type = $1
        AND created_at >= ((now() - make_interval(days => $2::int)) AT TIME ZONE current_setting('TimeZone'))
      GROUP BY 1, 2 ORDER BY 1 DESC, 2`,
    [BYPASS_EVENT_TYPE, d],
  );
  const { rows: recent } = await pool.query(
    `SELECT id, source AS kind, payload, created_at FROM cecelia_events
      WHERE event_type = $1 ORDER BY id DESC LIMIT 20`,
    [BYPASS_EVENT_TYPE],
  );
  return { days: d, rows, recent };
}

/** scheduler job 入口：扫描 OpenClaw 对外推送 + 按天汇总；扫描失败不挡汇总，但本轮记 fail */
export async function runBypassAudit(pool, deps = {}) {
  let scan;
  let scanError = null;
  try {
    scan = await runOpenclawPushScan(pool, deps);
  } catch (e) {
    scanError = String(e?.message).slice(0, 300);
    scan = { error: scanError };
  }
  const rollup = await runBypassDailyRollup(pool, deps);
  return { ok: !scanError, scan, rollup };
}
