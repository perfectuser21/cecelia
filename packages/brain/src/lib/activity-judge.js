/**
 * 自动裁判（五块模型·裁判，决策 de6dff5d）：一次运行的 span 入库后，对涉及的每个 Activity 跑收敛对账（reconcileActivity），
 * 结果只追加写入 activity_judgments（迁移 538），readback 格同时翻色。
 *
 * 触发：POST /spans 写入成功后调 onSpansWritten(pool, 写入结果)。新插入的 span id 进缓冲，最多每 debounceMs（默认 30s，
 *   env ACTIVITY_JUDGE_DEBOUNCE_MS）冲一次：一次运行陆续上报的多批 span 合并成一次裁判。env ACTIVITY_JUDGE_AUTO=off 整体关闭。
 * fail-safe：钩子挂在上报主路径上，内部任何错误只记日志——同步不抛、异步不留未处理的拒绝，绝不让上报失败。
 * 缓冲在内存里，进程重启时未冲的会丢；下一次运行会再触发，也可手动 POST /step-reconcile/:activityId 补判。
 */
import { reconcileActivity } from './step-reconcile.js';

const DEFAULT_DEBOUNCE_MS = 30_000;

const INSERT_JUDGMENT = `
  INSERT INTO activity_judgments (activity_id, activity_definition_version_id, verdict, converged, consecutive_green,
                                  required_green, runs_considered, trigger_kind, trigger_ref, report)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
  RETURNING id, judged_at`;

/**
 * 对一个 Activity 裁判一次并落库（只追加）。
 * activity_definition_version_id 取本次对账窗口内最新一条带版本的 span 的定义版本（旧协议 span 没有版本则留空），
 * 窗口内出现的全部版本写进 report.window_version_ids。自动触发且 no_data（没有 Step 级 span）不落库，避免噪音。
 * @returns {Promise<object>} 对账报告 + judgment_id / judged_at / activity_definition_version_id
 */
export async function judgeActivity(db, activityId, {
  trigger = 'manual', triggerRef = null, runsWanted = 5, requiredGreen = 5, reconcile = reconcileActivity,
} = {}) {
  const report = await reconcile(db, activityId, { runsWanted, requiredGreen });
  if (trigger === 'auto' && report.verdict === 'no_data') return { ...report, judgment_id: null, skipped: 'no_data' };
  const runIds = (report.runs || []).map(r => r.run_id);
  const versionIds = runIds.length ? (await db.query(
    `SELECT activity_definition_version_id AS version_id, max(started_at) AS last FROM spans
      WHERE activity_id = $1 AND run_id = ANY($2::text[]) AND activity_definition_version_id IS NOT NULL
      GROUP BY activity_definition_version_id ORDER BY last DESC`, [activityId, runIds])).rows.map(r => r.version_id) : [];
  const versionId = versionIds[0] ?? null;
  const stored = { ...report, window_version_ids: versionIds };
  const row = (await db.query(INSERT_JUDGMENT, [
    activityId, versionId, report.verdict, Boolean(report.converged), report.consecutive_green ?? 0,
    report.required_green ?? requiredGreen, runIds.length, trigger, triggerRef, JSON.stringify(stored),
  ])).rows[0];
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

/** 冲一批：逐个 Activity 裁判（顺序跑，不挤占连接池）；单个失败只记日志。永不抛。 */
export async function flushJudgments(db, spanIds, { judge = judgeActivity, log = console } = {}) {
  let targets;
  try {
    targets = await activityTargetsForSpans(db, spanIds);
  } catch (e) {
    log.warn(`[activity-judge] 查归属 Activity 失败（不影响上报）: ${String(e?.message).slice(0, 200)}`);
    return [];
  }
  const results = [];
  for (const { activity_id: activityId, run_id: runId } of targets) {
    try {
      results.push(await judge(db, activityId, { trigger: 'auto', triggerRef: runId }));
    } catch (e) {
      log.warn(`[activity-judge] 裁判 ${activityId} 失败（不影响上报）: ${String(e?.message).slice(0, 200)}`);
      results.push({ activity_id: activityId, error: String(e?.message) });
    }
  }
  return results;
}

const state = { buffer: new Set(), timer: null, chain: Promise.resolve() };

function debounceFromEnv() {
  const n = Number(process.env.ACTIVITY_JUDGE_DEBOUNCE_MS);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_DEBOUNCE_MS;
}

/**
 * POST /spans 写入成功后的钩子。返回是否排上了裁判。永不抛。
 * @param {object} db  pg Pool
 * @param {{ids?:string[]}} written  writeSpans 的返回值（ids = 本次真插入的 span id）
 */
export function onSpansWritten(db, written, { debounceMs = debounceFromEnv(), judge = judgeActivity, log = console } = {}) {
  try {
    if (process.env.ACTIVITY_JUDGE_AUTO === 'off') return false;
    const ids = written?.ids;
    if (!Array.isArray(ids) || ids.length === 0) return false;
    for (const id of ids) state.buffer.add(id);
    if (state.timer) return true;
    state.timer = setTimeout(() => {
      state.timer = null;
      const batch = [...state.buffer];
      state.buffer.clear();
      state.chain = state.chain
        .then(() => flushJudgments(db, batch, { judge, log }))
        .catch(e => log.warn(`[activity-judge] 冲裁判失败: ${String(e?.message).slice(0, 200)}`));
    }, debounceMs);
    state.timer.unref?.();
    return true;
  } catch (e) {
    try { log.warn(`[activity-judge] 钩子异常（不影响上报）: ${String(e?.message).slice(0, 200)}`); } catch { /* 日志也坏了就算了 */ }
    return false;
  }
}

/** 测试用：清掉未冲的缓冲与定时器。 */
export function resetJudgeScheduler() {
  if (state.timer) clearTimeout(state.timer);
  state.timer = null;
  state.buffer.clear();
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
