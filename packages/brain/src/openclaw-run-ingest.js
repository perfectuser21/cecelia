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
 * 本文件当前只含纯函数：SQL 构造 / ssh 命令构造 / 输出解析 / 行映射。
 * 不碰数据库、不执行 ssh；后续任务在此追加游标读取、upsert、连败告警与主入口。
 *
 * 数据源：MMV ~/.openclaw/state/openclaw.sqlite（只读），task_runs WHERE runtime='cron'。
 */

const DAY_MS = 86400_000;
const BACKFILL_DAYS = 30;
const ERROR_MAX = 2000;
const SUMMARY_MAX = 4000;
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

function truncate(v, max) {
  if (v === null || v === undefined) return null;
  return String(v).slice(0, max);
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
    error: truncate(row.error, ERROR_MAX),
    detail: {
      source: 'openclaw',
      job_id: jobId,
      task_id: row.task_id,
      summary: truncate(row.terminal_summary, SUMMARY_MAX),
      status: row.status ?? null,
    },
  };
}
