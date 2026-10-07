/**
 * OpenClaw 运行记录采集（Brain 定时任务 openclaw-run-ingest，每 300s）
 *
 * 决策：
 *   - c7ff6e02：运行记录落库并同步 Notion，不再推飞书
 *   - 9ec7a010：本功能三点拍板（采集 / 连败升级 / 近 30 天回填）
 * 判定点：
 *   - b7be0e26：结果按 OpenClaw task_runs.status 判（succeeded/failed/timed_out/running/queued）
 *   - 6d4b7ed5：任务名取 cron_jobs.name，缺失回退 `openclaw-job:<job_id 前 8 位>`
 *
 * 本文件含纯函数（SQL 构造 / ssh 命令构造 / 输出解析 / 行映射）、DB 层（游标读取 / upsert / 连败告警）
 * 与主入口 runOpenclawRunIngest（ssh 经 deps.exec 注入，测试从不真连 mmv）。
 *
 * 数据源：MMV ~/.openclaw/state/openclaw.sqlite（只读），task_runs WHERE runtime='cron'。
 */

import { existsSync } from 'fs';
import { defaultExecAsync, buildHostCmd } from './host-exec.js';
import { sendBark as defaultSendBark } from './notifier.js';

const DAY_MS = 86400_000;
const BACKFILL_DAYS = 30;
const ERROR_MAX = 2000;
const SUMMARY_MAX = 4000;
const LIMIT_MAX = 2000;
const SQLITE_PATH = '~/.openclaw/state/openclaw.sqlite';

/** task_runs.status → runs.outcome（判定点 b7be0e26），其余一律 unknown */
export const OUTCOME_BY_STATUS = {
  succeeded: 'pass',
  failed: 'fail',
  timed_out: 'timeout',
  running: 'running',
  queued: 'running',
};

function assertInt(name, v) {
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) {
    throw new Error(`invalid_${name}: ${String(v)}`);
  }
  return v;
}

/**
 * 构造增量查询 SQL。数字直接内插，故只接受有限整数。
 * sinceMs 为 null/undefined（首轮）→ 回填 nowMs 往前 30 天。
 */
export function buildIngestSql({ sinceMs, nowMs, limit = 2000 }) {
  const now = assertInt('nowMs', nowMs);
  const lim = assertInt('limit', limit);
  // 越界（尤其 -1，sqlite 视为不限行）一律拒绝
  if (lim < 1 || lim > LIMIT_MAX) throw new Error(`invalid_limit: ${lim}`);
  const since = sinceMs == null ? now - BACKFILL_DAYS * DAY_MS : assertInt('sinceMs', sinceMs);
  return [
    'SELECT t.task_id,t.source_id,t.agent_id,t.status,t.created_at,t.started_at,t.ended_at,',
    't.terminal_summary,t.error,j.name,j.payload_kind',
    'FROM task_runs t LEFT JOIN cron_jobs j ON j.job_id=t.source_id',
    "WHERE t.runtime='cron'",
    `AND (coalesce(t.last_event_at,t.ended_at,t.created_at) >= ${since} OR t.status IN ('running','queued'))`,
    `ORDER BY t.created_at LIMIT ${lim}`,
  ].join(' ');
}

/** SQL 经 base64 编码拼进 ssh 命令，规避多层引号转义；~ 由远端 shell 展开 */
export function buildMmvCmd(sql) {
  const b64 = Buffer.from(sql, 'utf8').toString('base64');
  return `ssh -o BatchMode=yes -o ConnectTimeout=20 mmv 'echo ${b64} | base64 -d | sqlite3 -readonly -json ${SQLITE_PATH}'`;
}

/** sqlite3 -json 对空结果输出空串；其余必须是 JSON 数组 */
export function parseSqliteJson(stdout) {
  const text = String(stdout ?? '').trim();
  if (text === '') return [];
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`parse_error: ${e.message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error('parse_error: expected JSON array');
  }
  return parsed;
}

function toMs(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * 按 UTF-16 码元截断到 max；若末码元是高代理项（代理对被从中间切开）再去掉一位，
 * 避免写入 jsonb 时被 Postgres 以孤立代理项拒收。长度上限仍按码元计，始终 <= max。
 */
export function truncateText(v, max) {
  if (v === null || v === undefined) return null;
  let out = String(v).slice(0, max);
  if (out.length > 0) {
    const last = out.charCodeAt(out.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) out = out.slice(0, -1);
  }
  return out;
}

/**
 * task_runs 行 → runs 行（不含 trigger_kind/header_source/schedule 关联，由 upsert 层补）。
 * task_id 缺失或起止时间都不可用 → null（调用方跳过）。
 */
export function mapOpenclawRow(row) {
  if (!row || row.task_id === null || row.task_id === undefined || row.task_id === '') return null;

  const startMs = toMs(row.started_at) ?? toMs(row.created_at);
  if (startMs === null) return null;

  const outcome = OUTCOME_BY_STATUS[row.status] ?? 'unknown';

  let endedAt = null;
  const endMs = toMs(row.ended_at);
  if (outcome !== 'running' && endMs !== null) {
    endedAt = new Date(Math.max(endMs, startMs));
  }

  const jobId = row.source_id ?? null;
  const triggerRef = row.name
    ? String(row.name)
    : `openclaw-job:${jobId ? String(jobId).slice(0, 8) : 'unknown'}`;

  return {
    run_id: `openclaw:${row.task_id}`,
    trigger_ref: triggerRef,
    executor_kind: row.payload_kind === 'command' ? 'code' : 'agent',
    executor_id: row.agent_id ? `openclaw:${row.agent_id}` : 'openclaw',
    started_at: new Date(startMs),
    ended_at: endedAt,
    outcome,
    error: truncateText(row.error, ERROR_MAX),
    detail: {
      source: 'openclaw',
      job_id: jobId,
      task_id: row.task_id,
      summary: truncateText(row.terminal_summary, SUMMARY_MAX),
      status: row.status ?? null,
    },
  };
}

const CURSOR_SQL = "SELECT max(started_at) AS max_started FROM runs WHERE run_id LIKE 'openclaw:%'";
const CURSOR_OVERLAP_MS = 3600_000;

/** 增量游标：已采集运行的最大 started_at 回退 1 小时（覆盖状态迟到变化）；首轮无行返回 null */
export async function readCursorMs(db) {
  const { rows } = await db.query(CURSOR_SQL);
  const max = rows[0]?.max_started;
  return max ? new Date(max).getTime() - CURSOR_OVERLAP_MS : null;
}

// LATERAL 写法同 lib/workflow-runs.js 的 INSERT_SCHEDULER_RUN；
// WHERE 子句保证无变化的行不被改写（rowCount 不计入）。
const UPSERT_SQL = `
  INSERT INTO runs (run_id, workflow_id, trigger_kind, trigger_ref, schedule_entry_id, executor_kind, executor_id,
                    started_at, ended_at, outcome, error, detail, header_source)
  SELECT $1, e.workflow_id, 'schedule', $2, e.id, $3, $4, $5, $6, $7, $8, $9::jsonb, 'owner'
    FROM (SELECT 1) one
    LEFT JOIN LATERAL (
      SELECT id, workflow_id FROM ops_schedule_entries
       WHERE source = 'openclaw' AND label = $2
       ORDER BY active DESC, id LIMIT 1
    ) e ON true
  ON CONFLICT (run_id) DO UPDATE SET
    ended_at = EXCLUDED.ended_at,
    outcome = EXCLUDED.outcome,
    error = EXCLUDED.error,
    detail = EXCLUDED.detail,
    updated_at = now()
  WHERE runs.outcome IS DISTINCT FROM EXCLUDED.outcome
     OR runs.ended_at IS DISTINCT FROM EXCLUDED.ended_at
     OR runs.detail IS DISTINCT FROM EXCLUDED.detail`;

const WARN_ROWS_MAX = 5;

/**
 * 逐行幂等写入 runs；返回实际插入/更新的行数与写失败的行数。
 * 单行失败只计入 failed_rows、不中断整批：游标 = 已写入的最大 started_at，
 * 若一条坏行让整批中断，游标会永久卡在坏行之前。
 */
export async function upsertRuns(db, rows, { onError } = {}) {
  let written = 0;
  let failedRows = 0;
  for (const r of rows) {
    try {
      const res = await db.query(UPSERT_SQL, [
        r.run_id, r.trigger_ref, r.executor_kind, r.executor_id,
        r.started_at, r.ended_at, r.outcome, r.error,
        r.detail === null || r.detail === undefined ? null : JSON.stringify(r.detail),
      ]);
      written += res.rowCount;
    } catch (e) {
      failedRows += 1;
      if (onError) onError(e);
      // 逐行日志只打前 N 条，避免整批失败时刷出上千行
      if (failedRows <= WARN_ROWS_MAX) {
        console.warn(`[openclaw-run-ingest] 写入失败 ${r.run_id}:`, String(e?.message).slice(0, 160));
      }
    }
  }
  if (failedRows > WARN_ROWS_MAX) {
    console.warn(`[openclaw-run-ingest] 另有 ${failedRows - WARN_ROWS_MAX} 行写入失败（共 ${failedRows} 行，已省略逐行日志）`);
  }
  return { written, failed_rows: failedRows };
}

const STREAK_MIN = 3;
const STREAK_BODY_MAX = 120;
const STREAK_DEDUPE_TTL_SEC = 7 * 86400;

// 连败段 = 最近一次「已结束且非失败」运行之后的全部 fail/timeout（不设窗口，起点不随行数增长漂移）。
// count / first_run_id（最早一条，同时刻按 run_id）/ error+summary（最近一条）一次求出。
const STREAK_SQL = `
  WITH last_ok AS (
    SELECT max(started_at) AS t FROM runs
     WHERE run_id LIKE 'openclaw:%' AND trigger_ref = $1
       AND outcome NOT IN ('fail','timeout','running')
  ), streak AS (
    SELECT r.run_id, r.error, r.detail->>'summary' AS summary, r.started_at
      FROM runs r, last_ok
     WHERE r.run_id LIKE 'openclaw:%' AND r.trigger_ref = $1
       AND r.outcome IN ('fail','timeout')
       AND (last_ok.t IS NULL OR r.started_at > last_ok.t)
  )
  SELECT (SELECT count(*)::int FROM streak) AS count,
         (SELECT run_id FROM streak ORDER BY started_at ASC, run_id ASC LIMIT 1) AS first_run_id,
         (SELECT error FROM streak ORDER BY started_at DESC, run_id DESC LIMIT 1) AS error,
         (SELECT summary FROM streak ORDER BY started_at DESC, run_id DESC LIMIT 1) AS summary`;

/**
 * 对给定任务名判定连败并发 Bark（同一连败段由 dedupeKey 保证只发一次）。
 * 首轮回填（firstRound）不发，避免历史连败一次性炸出来。sendBark 由调用方注入。
 */
export async function notifyFailureStreaks(db, triggerRefs, { sendBark, firstRound }) {
  if (firstRound) return { notified: 0 };
  let notified = 0;
  for (const name of triggerRefs) {
    const { rows } = await db.query(STREAK_SQL, [name]);
    const streak = rows[0];
    if (!streak || streak.count < STREAK_MIN || !streak.first_run_id) continue;
    const detail = truncateText(streak.error || streak.summary || '', STREAK_BODY_MAX);
    await sendBark('OpenClaw 任务连续失败', `${name} 连续 ${streak.count} 次失败：${detail}`, {
      dedupeKey: `openclaw-run-streak:${name}:${streak.first_run_id}`,
      dedupeTtlSec: STREAK_DEDUPE_TTL_SEC,
    });
    notified += 1;
  }
  return { notified };
}

const EXEC_TIMEOUT_MS = 60_000;
const CATCHUP_MS = 24 * 3600_000;
const GATE_INTERVAL_MS = 300_000;
let lastRunAt = 0;

/** 测试用：重置自 gate 状态 */
export function _resetOpenclawIngestGate() { lastRunAt = 0; }

/**
 * 主入口：读游标 → 拉增量 → 映射 → upsert → 连败告警。
 * ssh/解析失败直接抛错（让调度器记 fail，且不写库）；连败告警失败只告警不抛。
 * @param {{query: Function}} db
 * @param {{exec?: Function, inContainer?: boolean, sendBark?: Function, now?: () => number}} [deps]
 */
export async function runOpenclawRunIngest(db, deps = {}) {
  const exec = deps.exec ?? defaultExecAsync;
  const inContainer = deps.inContainer ?? existsSync('/.dockerenv');
  const sendBark = deps.sendBark ?? defaultSendBark;
  const now = deps.now ?? Date.now;

  const nowMs = now();
  // 调度器每 ~60s 调一遍全部 JOBS，自 gate 到 300s 一跑；本轮开始即记时，失败也算一轮，避免故障时每分钟重试
  if (lastRunAt && nowMs - lastRunAt < GATE_INTERVAL_MS) return { skipped: true };
  lastRunAt = nowMs;
  const cursor = await readCursorMs(db);
  const sql = buildIngestSql({ sinceMs: cursor, nowMs, limit: LIMIT_MAX });
  const stdout = await exec(buildHostCmd(buildMmvCmd(sql), inContainer), { timeoutMs: EXEC_TIMEOUT_MS });
  const raw = parseSqliteJson(stdout);

  const rows = [];
  let skipped = 0;
  for (const r of raw) {
    const mapped = mapOpenclawRow(r);
    if (mapped) rows.push(mapped);
    else skipped += 1;
  }

  let firstError = null;
  const { written, failed_rows } = await upsertRuns(db, rows, { onError: (e) => { firstError ??= e; } });
  // 整批全部写失败 = 系统性故障（schema 漂移/权限等），抛错让调度器记 fail，不能静默记 pass
  if (rows.length > 0 && failed_rows === rows.length) {
    throw new Error(`upsert_all_failed: ${failed_rows} 行全部写入失败，首个错误: ${String(firstError?.message).slice(0, 200)}`);
  }

  const failedNames = [...new Set(
    rows.filter((r) => r.outcome === 'fail' || r.outcome === 'timeout').map((r) => r.trigger_ref),
  )];
  // 追赶模式：首轮或游标落后 now 超过 24h（30 天回填 >2000 行要多轮追平），不发连败 Bark，避免历史连败炸出来
  const catchingUp = cursor === null || cursor < nowMs - CATCHUP_MS;
  let notified = 0;
  try {
    ({ notified } = await notifyFailureStreaks(db, failedNames, { sendBark, firstRound: catchingUp }));
  } catch (e) {
    console.warn('[openclaw-run-ingest] 连败告警失败（不影响采集）:', String(e?.message).slice(0, 160));
  }

  return {
    fetched: raw.length,
    written,
    skipped_rows: skipped,
    failed_rows,
    notified,
    backlog: raw.length === LIMIT_MAX,
  };
}
