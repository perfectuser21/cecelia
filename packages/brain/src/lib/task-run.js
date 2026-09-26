/**
 * run 原语：一次执行 = 一行 task_runs（链 bf5088a3 棒1，任务 66db3dfb）。
 *
 * 本文件是全仓【唯一】写 task_runs 的入口（INSERT / UPDATE 都只许出现在这里，
 * task-run-single-writer-guard.test.js 机械扫 src 钉死）。任何执行路径（dispatcher /
 * executor / openclaw-agent-executor / 回执通道 / kernel 终态）都经 startRun / finishRun 留痕。
 *
 * 语义（合同 contract-draft 摘要）：
 *   - run_id 是幂等键（migration 059 UNIQUE idx_task_runs_run_id）：同一次执行重复 startRun
 *     只留一行（ON CONFLICT DO NOTHING）。
 *   - finishRun 只补终态：WHERE ended_at IS NULL，已终态不覆盖（DB 为真相源，不许伪造/改写终态）。
 *   - 无终态回执 → 行保持 running，由日报裸跑/悬挂检测暴露；绝不超时猜 failed/success。
 *   - fail-open：留痕失败只 console.warn，永不抛，永不拖垮执行主链（旁路）。
 *   - 状态枚举以 059 注释为准：running / success / failed / timeout / cancelled
 *     （散文里的 succeeded 归一到 success）。
 *
 * 纯逻辑函数（normalizeRunStatus / buildRunContext / buildRunResult / detectBareRuns）
 * 不碰 DB，可直接单测；DB 函数默认走 db.js 的 pool（动态 import，纯逻辑测试不必连库），
 * 也可经 deps.pool 注入（openclaw-agent-executor 等已持有 pool 的调用方）。
 */

const RUN_STATUS_MAP = Object.freeze({
  running: 'running',
  completed: 'success',
  completed_no_pr: 'success',
  succeeded: 'success',
  success: 'success',
  failed: 'failed',
  quota_exhausted: 'failed',
  timeout: 'timeout',
  cancelled: 'cancelled',
  canceled: 'cancelled',
});

/** 回执里 status 的松散写法（'AI Done' 等）→ normalizeRunStatus 认识的词。 */
const CALLBACK_STATUS_ALIASES = Object.freeze({
  'AI Done': 'completed',
  'AI Failed': 'failed',
  'AI Quota Exhausted': 'quota_exhausted',
});

/**
 * 回调/执行状态 → task_runs 状态枚举。未知状态抛错（禁止静默落入非法枚举）。
 * @param {string} status
 * @returns {'running'|'success'|'failed'|'timeout'|'cancelled'}
 */
export function normalizeRunStatus(status) {
  const key = typeof status === 'string' ? status.trim() : '';
  const hit = Object.prototype.hasOwnProperty.call(RUN_STATUS_MAP, key) ? RUN_STATUS_MAP[key] : undefined;
  if (!hit) throw new Error(`unknown run status: ${JSON.stringify(status)}`);
  return hit;
}

/**
 * 执行路径必经留痕：source 必填（缺失 = 留痕不可归因，无法定位裸跑来源），剔除 undefined 字段。
 * @param {{source: string, [k: string]: any}} input
 */
export function buildRunContext(input = {}) {
  const { source, ...rest } = input || {};
  if (typeof source !== 'string' || source.trim() === '') {
    throw new Error('run context requires non-empty source');
  }
  const ctx = { source: source.trim() };
  for (const [k, v] of Object.entries(rest)) {
    if (v !== undefined) ctx[k] = v;
  }
  return ctx;
}

/**
 * exit code + 产物引用 → result jsonb 片段。产物只存引用（路径/URL/ID），不落大 blob。
 * @returns {{exit_code: number|null, artifacts: any[]}}
 */
export function buildRunResult({ exitCode, artifacts } = {}) {
  const code = exitCode === undefined || exitCode === null || exitCode === '' ? null : Number(exitCode);
  let refs = [];
  if (Array.isArray(artifacts)) refs = artifacts.filter((a) => a !== undefined && a !== null);
  else if (artifacts !== undefined && artifacts !== null) refs = [artifacts];
  return { exit_code: Number.isFinite(code) ? code : null, artifacts: refs };
}

const RECEIPT_SCALAR_KEYS = Object.freeze(['stage', 'stage_status']);
const RECEIPT_REF_KEYS = Object.freeze(['ref', 'url', 'path', 'name', 'key', 'observed', 'probed_at', 'error']);

/** 引用形态：字符串（路径/URL/名字）原样；对象只留引用键；其余（数字/大 blob）丢弃。 */
function toReference(item) {
  if (typeof item === 'string') return item;
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const ref = {};
  for (const k of RECEIPT_REF_KEYS) {
    if (item[k] === undefined || item[k] === null) continue;
    ref[k] = typeof item[k] === 'string' ? item[k] : String(item[k]);
  }
  return Object.keys(ref).length ? ref : null;
}

/**
 * 回执 result → 账本字段（纯函数）：只取存在的 stage / stage_status / metrics / evidence / probes；
 * evidence / probes 只留引用形态，不落大 blob。无命中返回 {}。
 * @param {any} result
 * @returns {{stage?: string, stage_status?: string, metrics?: object, evidence?: any[], probes?: any[]}}
 */
export function extractStageReceipt(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return {};
  const out = {};
  for (const k of RECEIPT_SCALAR_KEYS) {
    if (result[k] !== undefined && result[k] !== null) out[k] = String(result[k]);
  }
  if (result.metrics && typeof result.metrics === 'object' && !Array.isArray(result.metrics)) out.metrics = result.metrics;
  for (const k of ['evidence', 'probes']) {
    if (result[k] === undefined || result[k] === null) continue;
    const refs = [].concat(result[k]).map(toReference).filter((r) => r !== null);
    if (refs.length) out[k] = refs;
  }
  return out;
}

/**
 * 裸跑检测（纯集合差）：被派发但没有任何 run 记录的 task_id，去重。
 * @param {string[]} dispatchedTaskIds
 * @param {string[]} runTaskIds
 * @returns {string[]}
 */
export function detectBareRuns(dispatchedTaskIds = [], runTaskIds = []) {
  const withRun = new Set(runTaskIds);
  const bare = new Set();
  for (const id of dispatchedTaskIds) {
    if (!withRun.has(id)) bare.add(id);
  }
  return [...bare];
}

async function resolvePool(deps) {
  if (deps?.pool) return deps.pool;
  return (await import('../db.js')).default;
}

async function resolveEmit(deps) {
  if (deps?.emit) return deps.emit;
  return (await import('../event-bus.js')).emit;
}

/**
 * run 终态单点广播（棒3a 判定入口）：五条执行路径都经 finishRun，这里一处 emit 覆盖全部。
 * 订阅方（business-probe-judge 等）拿 RETURNING 回来的合并 result（含棒1 写入的 stage/probes）。
 * fail-open：事件失败只 warn，finishRun 返回值不受影响。
 */
async function emitRunFinished(row, runId, deps) {
  try {
    const emit = await resolveEmit(deps);
    await emit('run.finished', 'task-run', {
      runId: String(runId),
      taskId: row.task_id,
      status: row.status,
      result: row.result,
    });
  } catch (err) {
    console.warn(`[task-run] run.finished emit failed (non-fatal) run=${runId}: ${err.message}`);
  }
}

/**
 * 一次执行开始：落一行 running（幂等）。
 * fail-open：DB 错误 / 参数缺失都只 warn 并返回 null，绝不抛。
 *
 * @param {{taskId: string, runId: string, source: string, context?: object}} input
 * @param {{pool?: {query: Function}}} [deps]
 * @returns {Promise<{id: string|null, run_id: string, created: boolean}|null>}
 */
export async function startRun({ taskId, runId, source, context } = {}, deps = {}) {
  try {
    if (!taskId || !runId) throw new Error('startRun requires taskId and runId');
    const ctx = buildRunContext({ ...(context || {}), source });
    const pool = await resolvePool(deps);
    const ins = await pool.query(
      `INSERT INTO task_runs (task_id, run_id, status, context)
       VALUES ($1, $2, 'running', $3::jsonb)
       ON CONFLICT (run_id) DO NOTHING
       RETURNING id, run_id`,
      [taskId, String(runId), JSON.stringify(ctx)],
    );
    if (ins?.rows?.length) return { id: ins.rows[0].id, run_id: ins.rows[0].run_id, created: true };
    const existing = await pool.query('SELECT id, run_id FROM task_runs WHERE run_id = $1', [String(runId)]);
    const row = existing?.rows?.[0];
    return { id: row?.id ?? null, run_id: String(runId), created: false };
  } catch (err) {
    console.warn(`[task-run] startRun failed (non-fatal) task=${taskId} run=${runId}: ${err.message}`);
    return null;
  }
}

/**
 * 一次执行结束：补 ended_at / 终态 / exit code / 产物引用。已终态的 run 不覆盖。
 * status 为 running 或未知 → 不动（只认真实终态，绝不据不明状态伪造终态）。
 *
 * 成功补终态（updated=true）后单点发 run.finished 事件（deps.emit 可注入；默认 event-bus）。
 *
 * result 入参（可选）是调用方提炼好的附加字段（如回执的 stage/metrics），与 exit_code/artifacts 合并，
 * 后者优先；SQL 侧 `COALESCE(result,'{}') || $3` 再与已有 result 合并。
 *
 * @param {{runId: string, status: string, exitCode?: number, artifacts?: any, error?: string, result?: object}} input
 * @param {{pool?: {query: Function}, emit?: Function}} [deps]
 * @returns {Promise<{updated: boolean}>}
 */
export async function finishRun({ runId, status, exitCode, artifacts, error, result: extra = {} } = {}, deps = {}) {
  try {
    if (!runId) throw new Error('finishRun requires runId');
    const finalStatus = normalizeRunStatus(status);
    if (finalStatus === 'running') return { updated: false };
    const base = extra && typeof extra === 'object' && !Array.isArray(extra) ? extra : {};
    const result = { ...base, ...buildRunResult({ exitCode, artifacts }) };
    const pool = await resolvePool(deps);
    const upd = await pool.query(
      `UPDATE task_runs
          SET status = $2,
              ended_at = NOW(),
              result = COALESCE(result, '{}'::jsonb) || $3::jsonb,
              error_message = COALESCE($4, error_message),
              updated_at = NOW()
        WHERE run_id = $1 AND ended_at IS NULL
        RETURNING id, task_id, status, result`,
      [String(runId), finalStatus, JSON.stringify(result), error ? String(error).slice(0, 500) : null],
    );
    const row = upd?.rows?.[0];
    if (row) await emitRunFinished(row, runId, deps);
    return { updated: Boolean(row) };
  } catch (err) {
    console.warn(`[task-run] finishRun failed (non-fatal) run=${runId}: ${err.message}`);
    return { updated: false };
  }
}

/**
 * 执行入口留痕（executor 漏斗 / dispatcher 兜底共用）：一次「触发执行」的返回值 → run 行。
 *
 *   - 触发失败（success !== true）不留 run：没有执行发生，谈不上裸跑。
 *   - 有 runId：startRun 幂等（executor 漏斗先落，dispatcher 兜底再调只是 no-op）。
 *   - internal handler（Brain 内联同步跑完、无 runId）：合成确定性 runId 落一行并立即 finish 成功，
 *     否则这类执行有 dispatched 事件却永远无 run，会被裸跑检测长期误报。
 *   - 其余 success 却无 runId 的返回（异常形状）：合成 runId 落 running 行、context.synthetic=true，
 *     不猜终态，日报悬挂检测可见。
 *
 * fail-open，永不抛。
 * @returns {Promise<string|null>} 实际使用的 runId
 */
export async function startRunForExecResult({ task, execResult, source }, deps = {}) {
  try {
    if (!task?.id || execResult?.success !== true) return null;
    const context = { task_type: task.task_type };
    if (execResult.executor) context.executor = execResult.executor;
    const hasRunId = typeof execResult.runId === 'string' && execResult.runId.trim() !== '';
    if (hasRunId) {
      await startRun({ taskId: task.id, runId: execResult.runId, source, context }, deps);
      return execResult.runId;
    }
    const kind = execResult.internal ? 'internal' : 'dispatch';
    const runId = `${kind}-${task.id}-${new Date().toISOString().slice(0, 16)}`;
    const started = await startRun(
      { taskId: task.id, runId, source, context: { ...context, synthetic: true } },
      deps,
    );
    if (started?.created && execResult.internal) {
      await finishRun({ runId, status: 'completed', artifacts: execResult.action ? [`action:${execResult.action}`] : [] }, deps);
    }
    return runId;
  } catch (err) {
    console.warn(`[task-run] startRunForExecResult failed (non-fatal) task=${task?.id}: ${err.message}`);
    return null;
  }
}

/**
 * 回执通道（execution-callback 等脚本步/设备回调）→ run 原语：
 * 保证该 run_id 的行存在（startRun 幂等 upsert），终态回执再 finishRun 补齐。
 * 同一次执行始终一行。无 run_id 的回执无从关联，直接跳过。
 *
 * @param {{taskId: string, runId?: string, status?: string, exitCode?: number, result?: any,
 *          prUrl?: string, error?: string, source?: string}} input
 */
export async function recordRunFromCallback(
  { taskId, runId, status, exitCode, result, prUrl, error, source = 'execution-callback' } = {},
  deps = {},
) {
  if (!taskId || !runId) return { skipped: true };
  const raw = typeof status === 'string' ? status.trim() : '';
  const alias = CALLBACK_STATUS_ALIASES[raw] ?? raw;
  let runStatus;
  try {
    runStatus = normalizeRunStatus(alias);
  } catch {
    // in_progress / pending_postdeploy 等中间态回执：只保证行存在，不结束。
    runStatus = 'running';
  }
  const started = await startRun({ taskId, runId, source }, deps);
  if (runStatus === 'running') return { started, finished: { updated: false } };
  const artifacts = [];
  if (result && typeof result === 'object' && result.artifacts !== undefined) {
    artifacts.push(...[].concat(result.artifacts));
  }
  const pr = prUrl || (result && typeof result === 'object' ? result.pr_url : null);
  if (pr) artifacts.push(pr);
  // 账本 stage/metrics/evidence/probes 随终态回执进 task_runs.result（棒1 回执线）
  const finished = await finishRun(
    { runId, status: runStatus, exitCode, artifacts, error: runStatus === 'success' ? undefined : error, result: extractStageReceipt(result) },
    deps,
  );
  return { started, finished };
}

/**
 * 裸跑检测：窗口内有 dispatched 事件、却没有对应 run 行（run 允许比事件早开始 5 分钟，
 * 覆盖「先起 run 再记 dispatched」的顺序）的 task。晨报据此标 AMBER。
 *
 * @param {{query: Function}} pool
 * @param {{windowMinutes?: number}} [opts]
 * @returns {Promise<Array<{task_id: string, dispatched_at: Date}>>}
 */
export async function findBareRuns(pool, { windowMinutes = 60 } = {}) {
  const mins = Number.isFinite(Number(windowMinutes)) && Number(windowMinutes) > 0 ? Number(windowMinutes) : 60;
  const { rows } = await pool.query(
    `SELECT de.task_id, MIN(de.created_at) AS dispatched_at
       FROM dispatch_events de
      WHERE de.event_type = 'dispatched'
        AND de.task_id IS NOT NULL
        AND de.created_at > NOW() - make_interval(mins => $1::int)
        AND NOT EXISTS (
          SELECT 1 FROM task_runs tr
           WHERE tr.task_id = de.task_id
             AND tr.started_at >= de.created_at - INTERVAL '5 minutes'
        )
      GROUP BY de.task_id
      ORDER BY MIN(de.created_at) ASC`,
    [Math.floor(mins)],
  );
  return rows;
}
