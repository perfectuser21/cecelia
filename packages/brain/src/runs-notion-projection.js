/**
 * runs → Notion「最近执行」库投影（决策 9ec7a010；设计：docs/superpowers/specs/2026-10-07-openclaw-runs-ingest-design.md）。
 *
 * 窗口：OpenClaw 运行最近 7 天全部、fail/timeout 保留 30 天；其他 runs（Brain 内部定时任务、spans 外部上报）
 * 只放 fail/timeout 30 天。每轮先推窗口内变化的行（复用 notion-projection-engine 的指纹增量），
 * 再把移出窗口且还挂着 notion_id 的页归档并清空三列。
 * 库未登记（notion_projection_map 仍是 pending_vessel 占位）时整体安静跳过，不碰 Notion。
 */
import { resolveDbId, pushRegisteredRows, isPageGoneError, isWrongDatabaseError } from './lib/notion-projection-engine.js';
import { getToken as defaultGetToken, notionReq as defaultNotionReq } from './recurring-notion-sync.js';
import { truncateText } from './openclaw-run-ingest.js';

const TEXT_MAX = 1900;
const GATE_INTERVAL_MS = 120_000;
let lastRunAt = 0;

/** 测试用：重置自 gate 状态 */
export function _resetRunsNotionPushGate() { lastRunAt = 0; }

/** Notion 错误的 HTTP 状态：优先 err.status，其次从 notionReq 的报错文案「→ 4xx:」解析；网络/超时错误没有状态返回 null */
function httpStatusOf(err) {
  if (Number.isInteger(err?.status)) return err.status;
  const m = /→ (\d{3}):/.exec(err?.message || '');
  return m ? Number(m[1]) : null;
}

/**
 * 致命 = 继续逐行打只会放大或拖过 job 超时：401/403（key 失效/权限收回，每行都会同样失败）、429 限流、5xx、
 * 以及没有 HTTP 状态的错误（AbortError/TimeoutError 超时、TypeError 'fetch failed' 网络断）。整批终止，下轮继续（digest 没写就会重推）。
 */
export function isFatalNotionError(err) {
  const status = httpStatusOf(err);
  return status === null || status === 401 || status === 403 || status === 429 || status >= 500;
}

/** 归档时可放弃该页的错误：400（如已在回收站）/404/410——页本身已不可用，重试也不会成功 */
const ABANDONABLE_ARCHIVE_STATUS = new Set([400, 404, 410]);

/** 页已在回收站：PATCH 返回 400「Can't edit block that is archived」，只能清 id 重建 */
const isArchivedBlockError = (err) => /can't edit block that is archived/i.test(err?.message || '');
const isWrongDbOrArchived = (err) => isWrongDatabaseError(err) || isArchivedBlockError(err);

/** 窗口内的 runs（SQL 片段，供推送与归档两个查询共用，保证两边互补） */
// coding workflow（run_id coding-workflow:<task>，决策 b34e346a）与 OpenClaw 一样 7 天内全量可见，失败留 30 天
export const IN_WINDOW_SQL = `(run_id LIKE 'openclaw:%' AND (started_at >= now() - interval '7 days' OR (outcome IN ('fail','timeout') AND started_at >= now() - interval '30 days')))
  OR (run_id LIKE 'coding-workflow:%' AND (started_at >= now() - interval '7 days' OR (outcome IN ('fail','timeout') AND started_at >= now() - interval '30 days')))
  OR (run_id NOT LIKE 'openclaw:%' AND run_id NOT LIKE 'coding-workflow:%' AND outcome IN ('fail','timeout') AND started_at >= now() - interval '30 days')`;

const OUTCOME_LABEL = { pass: '成功', fail: '失败', timeout: '超时', running: '运行中', skipped: '跳过' };

/** Notion「最近执行」库的 9 列 schema（select 选项写全），建库脚本与缺列补齐共用 */
export const RUNS_DB_PROPS = {
  '任务': { title: {} },
  '开始时间': { date: {} },
  '结果': {
    select: {
      options: [
        { name: '成功', color: 'green' }, { name: '失败', color: 'red' }, { name: '超时', color: 'orange' },
        { name: '运行中', color: 'blue' }, { name: '跳过', color: 'gray' }, { name: '未知', color: 'default' },
      ],
    },
  },
  '耗时（秒）': { number: { format: 'number' } },
  '执行者': { rich_text: {} },
  '来源': {
    select: {
      options: [
        { name: 'OpenClaw', color: 'purple' }, { name: 'Brain', color: 'blue' }, { name: '外部上报', color: 'yellow' },
        { name: 'Coding Workflow', color: 'green' },
      ],
    },
  },
  '摘要': { rich_text: {} },
  '错误': { rich_text: {} },
  'Brain ID': { rich_text: {} },
};

const RUN_COLUMNS = `id, run_id, trigger_kind, trigger_ref, executor_id, started_at, duration_ms, outcome, error, detail, notion_id, notion_digest`;

/** 窗口内、从未推过或推后有更新（含 404 清 id 后需重建）的行，最新的优先 */
export async function selectRowsToPush(db, limit = 100) {
  const { rows } = await db.query(
    `SELECT ${RUN_COLUMNS} FROM runs
      WHERE (${IN_WINDOW_SQL})
        AND (notion_id IS NULL OR notion_synced_at IS NULL OR updated_at > notion_synced_at)
      ORDER BY started_at DESC
      LIMIT $1`, [limit]);
  return rows;
}

/** 已挂 Notion 页但移出窗口的行（待归档），最新的优先 */
export async function selectRowsToArchive(db, limit = 100) {
  const { rows } = await db.query(
    `SELECT ${RUN_COLUMNS} FROM runs
      WHERE notion_id IS NOT NULL AND NOT (${IN_WINDOW_SQL})
      ORDER BY started_at DESC
      LIMIT $1`, [limit]);
  return rows;
}

const richText = (v) => {
  const t = truncateText(v, TEXT_MAX);
  return t ? [{ text: { content: t } }] : [];
};

function sourceLabel(row) {
  if (String(row.run_id || '').startsWith('openclaw:')) return 'OpenClaw';
  if (String(row.run_id || '').startsWith('coding-workflow:')) return 'Coding Workflow';
  return row.trigger_kind === 'external' ? '外部上报' : 'Brain';
}

/** runs 行 → Notion properties（列与类型见设计「列」表） */
export function buildRunProps(row) {
  const started = row.started_at instanceof Date ? row.started_at : new Date(row.started_at);
  const seconds = row.duration_ms === null || row.duration_ms === undefined
    ? null : Math.round((Number(row.duration_ms) / 1000) * 10) / 10;
  return {
    '任务': { title: [{ text: { content: truncateText(row.trigger_ref || row.run_id, 200) } }] },
    '开始时间': { date: { start: started.toISOString() } },
    '结果': { select: { name: OUTCOME_LABEL[row.outcome] || '未知' } },
    '耗时（秒）': { number: seconds },
    '执行者': { rich_text: richText(row.executor_id) },
    '来源': { select: { name: sourceLabel(row) } },
    '摘要': { rich_text: richText(row.detail?.summary) },
    '错误': { rich_text: richText(row.error) },
    'Brain ID': { rich_text: richText(row.run_id) },
  };
}

/**
 * 归档移出窗口的页并清三列。404/页已不可用 = 已经归档，照样清列；
 * 400/410（如主理人手动删页后 400 已归档）重试也不会成功，打 warn 后照样清列继续下一行，免得一行堵死后面所有过期页；
 * 其余错误（401/403/409/429/5xx/网络超时）停止本轮归档，行保持原样下轮再来——清列会让 Notion 页永久残留。
 */
export async function archiveRows(db, token, rows, notionReq = defaultNotionReq) {
  let archived = 0;
  for (const r of rows) {
    try {
      await notionReq(token, `/pages/${r.notion_id}`, 'PATCH', { archived: true });
    } catch (err) {
      if (!isPageGoneError(err)) {
        if (!ABANDONABLE_ARCHIVE_STATUS.has(httpStatusOf(err))) {
          console.warn(`[runs-notion-push] 归档 ${r.notion_id} 失败，本轮停止归档: ${err.message}`);
          return { archived, stopped: true };
        }
        console.warn(`[runs-notion-push] 归档 ${r.notion_id} 返回不可重试错误，清列放弃该页: ${err.message}`);
      }
    }
    await db.query(
      'UPDATE runs SET notion_id = NULL, notion_digest = NULL, notion_synced_at = NULL WHERE id = $1', [r.id]);
    archived++;
  }
  return { archived, stopped: false };
}

/**
 * 定时入口。返回 { skipped } 或 { pushed: 引擎统计, archived, archive_stopped }。
 * @param {object} pool
 * @param {object} [deps] 测试注入：notionReq / getToken / now
 */
export async function runRunsNotionPush(pool, deps = {}) {
  const { notionReq = defaultNotionReq, getToken = defaultGetToken, now = Date.now } = deps;
  // 调度器每 ~60s 调一遍全部 JOBS，自 gate 到 120s 一跑；本轮开始即记时，失败也算一轮
  const nowMs = now();
  if (lastRunAt && nowMs - lastRunAt < GATE_INTERVAL_MS) return { skipped: true };
  lastRunAt = nowMs;
  const dbId = await resolveDbId(pool, 'runs');
  if (!dbId) return { skipped: 'db_not_registered' };
  let token;
  try {
    token = getToken();
  } catch {
    return { skipped: 'no_token' };
  }

  const rows = await selectRowsToPush(pool);
  let fatal = false;
  const pushed = await pushRegisteredRows(pool, token, {
    table: 'runs', dbId, rows, buildProps: buildRunProps, notionReq, label: 'runs',
    isWrongDatabaseError: isWrongDbOrArchived,
    onFatal: (err) => { fatal = isFatalNotionError(err); return fatal; },
  });
  if (fatal) return { pushed, archived: 0, archive_stopped: true };

  const { archived, stopped } = await archiveRows(pool, token, await selectRowsToArchive(pool), notionReq);
  return { pushed, archived, archive_stopped: stopped };
}
