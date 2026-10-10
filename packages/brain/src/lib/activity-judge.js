/**
 * 自动裁判（五块模型·裁判，决策 de6dff5d）：一次运行的 span 入库后，对涉及的每个 Activity 跑收敛对账（reconcileActivity），
 * 结果只追加写入 activity_judgments（迁移 538），readback 格同时翻色。
 *
 * 触发：POST /spans 写入成功后调 onSpansWritten(pool, 写入结果)。新插入的 span id 进缓冲，最多每 debounceMs（默认 30s，
 *   env ACTIVITY_JUDGE_DEBOUNCE_MS）冲一次：一次运行陆续上报的多批 span 合并成一次裁判。env ACTIVITY_JUDGE_AUTO=off 整体关闭。
 * 等运行结束再判：技能按 Step 逐条上报（emit-step-span），一次运行常常超过去抖窗口。自动触发时先只算报告不翻色，
 *   触发这次裁判的运行若还有 Step 没上报（missing）、没有失败（failed），且最后一条 span 距今不到静默期
 *   （默认 10 分钟，env ACTIVITY_JUDGE_RUN_IDLE_MS），就认为还没跑完：不落库、不翻色，放回待判队列，过了静默期再判。
 *   过了静默期仍缺步 = 确实缺步，按真实结果落库翻色。runs 表的 pass 状态在只报 span 的运行里收到第一条就置上，不能当结束信号。
 * fail-safe：钩子挂在上报主路径上，内部任何错误只记日志——同步不抛、异步不留未处理的拒绝，绝不让上报失败。
 * 缓冲与待判队列在内存里，进程重启时未冲的会丢；下一次运行会再触发，也可手动 POST /step-reconcile/:activityId 补判。
 */
import { reconcileActivity, applyReadbackCell } from './step-reconcile.js';
import { onJudgmentRecorded } from './release-line-rollback.js';

const DEFAULT_DEBOUNCE_MS = 30_000;
const DEFAULT_RUN_IDLE_MS = 600_000;
const MIN_RETRY_MS = 1_000;

function msFromEnv(name, fallback) {
  const raw = process.env[name];
  const n = Number(raw);
  return raw !== undefined && raw !== '' && Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * 触发运行是否还没跑完：有 missing、没有 failed、最后一条 span 在静默期内。
 * @returns {number|null} 还没跑完时返回距静默期结束的毫秒数，否则 null
 */
export function pendingRunWaitMs(report, runId, { now = Date.now(), runIdleMs = DEFAULT_RUN_IDLE_MS } = {}) {
  if (!runId) return null;
  const run = (report?.runs || []).find(r => r.run_id === runId);
  if (!run || !Array.isArray(run.steps)) return null;
  const statuses = run.steps.map(s => s.status);
  if (!statuses.includes('missing') || statuses.includes('failed')) return null;
  const last = Date.parse(run.last_span_at);
  if (!Number.isFinite(last)) return null;
  const wait = runIdleMs - (now - last);
  return wait > 0 ? wait : null;
}

const INSERT_JUDGMENT = `
  INSERT INTO activity_judgments (activity_id, activity_definition_version_id, verdict, converged, consecutive_green,
                                  required_green, runs_considered, trigger_kind, trigger_ref, report)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
  RETURNING id, judged_at`;

/**
 * 对一个 Activity 裁判一次并落库（只追加）。
 * activity_definition_version_id 取本次对账窗口内最新一条带版本的 span 的定义版本（旧协议 span 没有版本则留空），
 * 窗口内出现的全部版本写进 report.window_version_ids。自动触发且 no_data（没有 Step 级 span）不落库，避免噪音。
 * 自动触发时对账不翻色，先看触发运行跑完没有：没跑完返回 { deferred:true, run_id, retry_after_ms }，不落库不翻色；
 * 跑完了先落库再翻色（翻色出错只记日志）。手动触发照旧由 reconcile 自己翻色。
 * @returns {Promise<object>} 对账报告 + judgment_id / judged_at / activity_definition_version_id（或 deferred）
 */
export async function judgeActivity(db, activityId, {
  trigger = 'manual', triggerRef = null, runsWanted = 5, requiredGreen = 5, reconcile = reconcileActivity,
  applyCell = applyReadbackCell, onRecorded = onJudgmentRecorded, now = Date.now(), runIdleMs = msFromEnv('ACTIVITY_JUDGE_RUN_IDLE_MS', DEFAULT_RUN_IDLE_MS),
  log = console,
} = {}) {
  const auto = trigger === 'auto';
  const report = await reconcile(db, activityId, auto ? { runsWanted, requiredGreen, applyCell: false } : { runsWanted, requiredGreen });
  if (auto && report.verdict === 'no_data') return { ...report, judgment_id: null, skipped: 'no_data' };
  if (auto) {
    const wait = pendingRunWaitMs(report, triggerRef, { now, runIdleMs });
    if (wait !== null) return { ...report, judgment_id: null, deferred: true, run_id: triggerRef, retry_after_ms: wait };
  }
  const runIds = (report.runs || []).map(r => r.run_id);
  const versionIds = runIds.length ? (await db.query(
    `SELECT activity_definition_version_id AS version_id, max(started_at) AS last FROM spans
      WHERE activity_id = $1 AND run_id = ANY($2::text[]) AND activity_definition_version_id IS NOT NULL
      GROUP BY activity_definition_version_id ORDER BY last DESC`, [activityId, runIds])).rows.map(r => r.version_id) : [];
  const versionId = versionIds[0] ?? null;
  // 发布线用：每次运行带版本的 span 属于哪些构建（自动退回只认触发运行纯属生产版的），以及窗口里没有任何带版本 span 的运行数
  //（everConverged 只认 window_unversioned_run_count = 0 的纯净窗口）
  const runVersionIds = {};
  if (runIds.length) {
    const perRun = (await db.query(
      `SELECT DISTINCT run_id, activity_definition_version_id AS version_id FROM spans
        WHERE activity_id = $1 AND run_id = ANY($2::text[]) AND activity_definition_version_id IS NOT NULL`, [activityId, runIds])).rows;
    for (const r of perRun) if (r.run_id) (runVersionIds[r.run_id] ||= []).push(r.version_id);
  }
  const stored = { ...report, window_version_ids: versionIds, run_version_ids: runVersionIds,
    window_unversioned_run_count: runIds.filter(id => !runVersionIds[id]).length };
  const row = (await db.query(INSERT_JUDGMENT, [
    activityId, versionId, report.verdict, Boolean(report.converged), report.consecutive_green ?? 0,
    report.required_green ?? requiredGreen, runIds.length, trigger, triggerRef, JSON.stringify(stored),
  ])).rows[0];
  if (auto) {
    try {
      await applyCell(db, activityId, report.verdict);
    } catch (e) {
      log.warn(`[activity-judge] ${activityId} readback 格翻色失败（裁判已落库）: ${String(e?.message).slice(0, 200)}`);
    }
    // 发布线自动退回评估：fire-and-forget，出任何错只记日志，绝不影响上报与裁判落库。
    // 只在拿到连接池时评估（它要另开事务）；调用方传的是单连接（可能正处在调用方自己的事务里）就跳过，不碰别人的事务。
    try {
      if (typeof db?.totalCount === 'number') Promise.resolve()
        .then(() => onRecorded(db, activityId, { id: row?.id ?? null, trigger_kind: trigger, trigger_ref: triggerRef }, { log }))
        .catch(e => log.warn(`[activity-judge] ${activityId} 发布线退回评估失败: ${String(e?.message).slice(0, 200)}`));
    } catch { /* 钩子本身坏了也不影响 */ }
  }
  return { ...stored, activity_definition_version_id: versionId, judgment_id: row?.id ?? null, judged_at: row?.judged_at ?? null };
}

/** 新插入的 span → 涉及的 Activity（Step 级 span 没带 activity_id 时经 steps 表找归属），每个带最新一条的 run_id。 */
export async function activityTargetsForSpans(db, spanIds) {
  if (!Array.isArray(spanIds) || spanIds.length === 0) return [];
  const { rows } = await db.query(
    `SELECT COALESCE(s.activity_id, st.activity_id) AS activity_id,
            (array_agg(s.run_id ORDER BY s.started_at DESC))[1] AS run_id
       FROM spans s LEFT JOIN steps st ON st.id = s.step_id
      WHERE s.id = ANY($1::uuid[])
      GROUP BY 1`, [spanIds]);
  return rows.filter(r => r.activity_id).map(r => ({ activity_id: r.activity_id, run_id: r.run_id }));
}

/**
 * 冲一批：逐个 Activity 裁判（顺序跑，不挤占连接池）；单个失败只记日志。永不抛。
 * extraTargets = 之前被推迟、要重判的 {activity_id, run_id}；同一 Activity 这批有新 span 时以新 span 的运行为准。
 */
export async function flushJudgments(db, spanIds, { judge = judgeActivity, log = console, extraTargets = [] } = {}) {
  let fresh = [];
  try {
    fresh = await activityTargetsForSpans(db, spanIds);
  } catch (e) {
    log.warn(`[activity-judge] 查归属 Activity 失败（不影响上报）: ${String(e?.message).slice(0, 200)}`);
    if (extraTargets.length === 0) return [];
  }
  const seen = new Set(fresh.map(t => t.activity_id));
  const targets = [...fresh, ...extraTargets.filter(t => t?.activity_id && !seen.has(t.activity_id) && seen.add(t.activity_id))];
  const results = [];
  for (const { activity_id: activityId, run_id: runId } of targets) {
    try {
      results.push({ activity_id: activityId, ...(await judge(db, activityId, { trigger: 'auto', triggerRef: runId })) });
    } catch (e) {
      log.warn(`[activity-judge] 裁判 ${activityId} 失败（不影响上报）: ${String(e?.message).slice(0, 200)}`);
      results.push({ activity_id: activityId, error: String(e?.message) });
    }
  }
  return results;
}

const state = { buffer: new Set(), deferred: new Map(), timer: null, timerDue: 0, chain: Promise.resolve() };

/**
 * 安排一次冲裁判：已有不晚于这次的定时器就并进它（它会连同缓冲和待判队列一起处理）；
 * 已有的是更晚的重判定时器（等静默期）就换成这次更早的，免得新 span 跟着等。
 */
function scheduleFlush(db, delayMs, opts) {
  const due = Date.now() + delayMs;
  if (state.timer && state.timerDue <= due) return;
  if (state.timer) clearTimeout(state.timer);
  state.timerDue = due;
  state.timer = setTimeout(() => {
    state.timer = null;
    const batch = [...state.buffer];
    state.buffer.clear();
    const extraTargets = [...state.deferred].map(([activity_id, run_id]) => ({ activity_id, run_id }));
    state.deferred.clear();
    state.chain = state.chain
      .then(() => flushJudgments(db, batch, { ...opts, extraTargets }))
      .then(results => requeueDeferred(db, results, opts))
      .catch(e => opts.log.warn(`[activity-judge] 冲裁判失败: ${String(e?.message).slice(0, 200)}`));
  }, delayMs);
  state.timer.unref?.();
}

/** 被推迟（运行还没跑完）的放回待判队列，过了静默期再判。 */
function requeueDeferred(db, results, opts) {
  let wait = Infinity;
  for (const r of results || []) {
    if (!r?.deferred || !r.activity_id) continue;
    if (!state.deferred.has(r.activity_id)) state.deferred.set(r.activity_id, r.run_id);
    wait = Math.min(wait, Number(r.retry_after_ms) || 0);
  }
  if (wait !== Infinity) scheduleFlush(db, Math.max(MIN_RETRY_MS, wait + MIN_RETRY_MS), opts);
}

/**
 * POST /spans 写入成功后的钩子。返回是否排上了裁判。永不抛。
 * @param {object} db  pg Pool
 * @param {{ids?:string[]}} written  writeSpans 的返回值（ids = 本次真插入的 span id）
 */
export function onSpansWritten(db, written, { debounceMs = msFromEnv('ACTIVITY_JUDGE_DEBOUNCE_MS', DEFAULT_DEBOUNCE_MS), judge = judgeActivity, log = console } = {}) {
  try {
    if (process.env.ACTIVITY_JUDGE_AUTO === 'off') return false;
    const ids = written?.ids;
    if (!Array.isArray(ids) || ids.length === 0) return false;
    for (const id of ids) state.buffer.add(id);
    scheduleFlush(db, debounceMs, { judge, log });
    return true;
  } catch (e) {
    try { log.warn(`[activity-judge] 钩子异常（不影响上报）: ${String(e?.message).slice(0, 200)}`); } catch { /* 日志也坏了就算了 */ }
    return false;
  }
}

/** 测试用：清掉未冲的缓冲、待判队列与定时器。 */
export function resetJudgeScheduler() {
  if (state.timer) clearTimeout(state.timer);
  state.timer = null;
  state.buffer.clear();
  state.deferred.clear();
  state.chain = Promise.resolve();
}

/** 某 Activity 最新一条裁判；没有返回 null。 */
export async function getLatestJudgment(db, activityId) {
  return (await db.query(
    'SELECT * FROM activity_judgments WHERE activity_id = $1 ORDER BY id DESC LIMIT 1', [activityId])).rows[0] ?? null;
}

/** 某 Activity 的裁判历史（新→旧）。 */
export async function listJudgments(db, activityId, { limit = 20 } = {}) {
  return (await db.query(
    'SELECT * FROM activity_judgments WHERE activity_id = $1 ORDER BY id DESC LIMIT $2', [activityId, limit])).rows;
}
