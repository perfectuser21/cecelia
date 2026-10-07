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
 * 本文件含纯函数（SQL 构造 / ssh 命令构造 / 输出解析 / 行映射）与 DB 层（游标读取 / upsert）。
 * 不执行 ssh；后续任务在此追加连败告警与主入口。
 *
 * 数据源：MMV ~/.openclaw/state/openclaw.sqlite（只读），task_runs WHERE runtime='cron'。
 */

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

/** 逐行幂等写入 runs；返回实际插入/更新的行数 */
export async function upsertRuns(db, rows) {
  let written = 0;
  for (const r of rows) {
    const res = await db.query(UPSERT_SQL, [
      r.run_id, r.trigger_ref, r.executor_kind, r.executor_id,
      r.started_at, r.ended_at, r.outcome, r.error,
      r.detail === null || r.detail === undefined ? null : JSON.stringify(r.detail),
    ]);
    written += res.rowCount;
  }
  return { written };
}

const STREAK_MIN = 3;
const STREAK_BODY_MAX = 120;
const STREAK_DEDUPE_TTL_SEC = 7 * 86400;
const RECENT_SQL = `
  SELECT run_id, outcome, error, detail->>'summary' AS summary
    FROM runs
   WHERE run_id LIKE 'openclaw:%' AND trigger_ref = $1 AND outcome <> 'running'
   ORDER BY started_at DESC LIMIT 50`;

/**
 * 最近运行（started_at 降序）里从头开始的连续 fail/timeout 段。
 * 不足 3 条返回 null；否则 firstRunId 为该连败段最早一条（同一段稳定不变，作去重键）。
 */
export function findStreakStart(recent) {
  let count = 0;
  while (count < recent.length && (recent[count].outcome === 'fail' || recent[count].outcome === 'timeout')) count += 1;
  if (count < STREAK_MIN) return null;
  return { firstRunId: recent[count - 1].run_id, count };
}

/**
 * 对给定任务名判定连败并发 Bark（同一连败段由 dedupeKey 保证只发一次）。
 * 首轮回填（firstRound）不发，避免历史连败一次性炸出来。sendBark 由调用方注入。
 */
export async function notifyFailureStreaks(db, triggerRefs, { sendBark, firstRound }) {
  if (firstRound) return { notified: 0 };
  let notified = 0;
  for (const name of triggerRefs) {
    const { rows } = await db.query(RECENT_SQL, [name]);
    const streak = findStreakStart(rows);
    if (!streak) continue;
    const detail = truncateText(rows[0].error || rows[0].summary || '', STREAK_BODY_MAX);
    await sendBark('OpenClaw 任务连续失败', `${name} 连续 ${streak.count} 次失败：${detail}`, {
      dedupeKey: `openclaw-run-streak:${name}:${streak.firstRunId}`,
      dedupeTtlSec: STREAK_DEDUPE_TTL_SEC,
    });
    notified += 1;
  }
  return { notified };
}
