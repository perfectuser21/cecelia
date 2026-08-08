/**
 * Acceptance 验收端点（刀 1）— Notion Worker 闭环 SSOT
 * 内网 router：建单/查单（挂 5221 /api/brain/acceptance）
 * 公网 router：pending 拉取 / results 回写（挂 5223，见 acceptance-public-server.js）
 */
import express from 'express';
import rateLimit from 'express-rate-limit';
import { computeRunStatus } from '../acceptance-state.js';
import { findDuplicateCheckKeys } from '../acceptance-spec.js';
import { registerAiResultsRoute } from './acceptance-ai.js';
import { registerReviewClosureRoutes } from './acceptance-review.js';
import { checkCreateGate, checkFrozenStamps } from './acceptance-gates.js';

export const ACCEPTANCE_KINDS = ['FR', 'NFR', 'Invariant', 'SOP'];
export const ACCEPTANCE_RESULTS = ['通过', '不通过', '无法验证'];
const SOURCES = ['manual', 'harness'];

async function safeRollback(client) {
  try { await client.query('ROLLBACK'); } catch { /* 连接已坏，忽略 */ }
}

export class AcceptanceResultsError extends Error {
  constructor(status, body) {
    super(body?.error || 'acceptance_results_error');
    this.status = status;
    this.body = body;
  }
}

/** 对任何 run 都不触发，纯占位待 D4 删除（判据见调用点注释） */
function isLegacyRejectionTransition(prevStatus, nextStatus) {
  return prevStatus !== 'failed' && nextStatus === 'failed';
}

/**
 * 建单侧的规程格号（S{步号}-c{列号}）。只在 POST /runs 写入侧校验：
 * migration 392 刻意不给 check_key 加 DB CHECK，因为存量 21 行是旧 {run_key}:{NNN} 流水号格式，
 * 加约束会当场挡死它们。提交路径同样不校验格式——历史 run 必须还能正常回写判定。
 */
export const CHECK_KEY_PATTERN = /^S\d+-c[1-4]$/;

/**
 * 提交人列结果。`run_key` 是必填的写入作用域：migration 392 把 UNIQUE 从全局 check_key 换绑到
 * (run_id, check_key) 之后，同一格号可以合法地出现在多个 run 里，不带作用域的寻址会跨 run 误写。
 * 缺 run_key 直接 400，不回落到「按全局 check_key 猜一个」——那正是本刀要堵的洞。
 */
export async function submitAcceptanceResults(pool, results, options = {}) {
  const { run_key } = options;
  if (!run_key) {
    throw new AcceptanceResultsError(400, { error: 'run_key is required（写入必须限定在单个 run 作用域内）' });
  }
  if (!Array.isArray(results) || results.length === 0) {
    throw new AcceptanceResultsError(400, { error: 'results must be a non-empty array' });
  }
  const invalid = [];
  for (const [i, r] of results.entries()) {
    if (!r || !r.check_key) invalid.push({ index: i, error: 'check_key required' });
    else if (!ACCEPTANCE_RESULTS.includes(r.result)) {
      invalid.push({ index: i, check_key: r.check_key, error: `result must be one of: ${ACCEPTANCE_RESULTS.join(',')}` });
    }
  }
  if (invalid.length > 0) throw new AcceptanceResultsError(400, { error: 'invalid results', invalid });

  const seen = new Set();
  for (const r of results) {
    if (r?.check_key) {
      if (seen.has(r.check_key)) {
        throw new AcceptanceResultsError(400, { error: 'duplicate check_key in batch', check_key: r.check_key });
      }
      seen.add(r.check_key);
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const keys = results.map((r) => r.check_key);
    const { rows: runRows } = await client.query(
      'SELECT id, status, detail FROM acceptance_runs WHERE run_key = $1', [run_key]
    );
    if (runRows.length === 0) {
      await safeRollback(client);
      throw new AcceptanceResultsError(404, { error: 'run not found', run_key });
    }
    const scopedRunId = runRows[0].id;

    // 冻结锁（J12-A）：排在任何 UPDATE 之前，拦下时这一批一格都不许落库。
    const frozen = checkFrozenStamps(runRows[0].detail, options);
    if (frozen.kind === 'missing') {
      await safeRollback(client);
      throw new AcceptanceResultsError(400, {
        error: 'sha_required_for_freeze_check',
        hint: '该 run 带版本戳，提交须自报 backend_sha/frontend_sha/spec_sha',
      });
    }
    if (frozen.kind === 'changed') {
      // 转 stale 要留下来（这一轮作废是既成事实），判定不能落库——所以先提交转态再抛。
      await client.query(
        `UPDATE acceptance_runs
            SET status = 'stale',
                detail = COALESCE(detail,'{}'::jsonb) || $1::jsonb,
                updated_at = NOW()
          WHERE id = $2`,
        [JSON.stringify({ stale_reason: frozen.changed, stale_at: new Date().toISOString() }), scopedRunId]
      );
      await client.query('COMMIT');
      throw new AcceptanceResultsError(409, { error: 'run_frozen_version_changed', changed: frozen.changed });
    }
    const { rows: found } = await client.query(
      'SELECT check_key FROM acceptance_checks WHERE run_id = $1 AND check_key = ANY($2)',
      [scopedRunId, keys]
    );
    const foundKeys = new Set(found.map((r) => r.check_key));
    const missing = keys.filter((k) => !foundKeys.has(k));
    if (missing.length > 0) {
      await safeRollback(client);
      throw new AcceptanceResultsError(400, { error: 'unknown check_key', missing });
    }
    for (const r of results) {
      await client.query(
        `UPDATE acceptance_checks SET result = $1, note = $2, submitted_by = $3, decided_at = NOW(), updated_at = NOW()
         WHERE run_id = $4 AND check_key = $5`,
        [r.result, r.note || null, r.submitted_by || null, scopedRunId, r.check_key]
      );
    }
    // 作用域收紧后这里恒为单元素：所有 found 行都来自 scopedRunId。保留循环形态是为了不动下面
    // 那段行锁/重算逻辑，但不再从 found 反推 run 集合——那会留下「看起来支持跨 run 批量」的假象。
    const runIds = [scopedRunId];
    const updatedRuns = [];
    for (const runId of runIds) {
      // 并发提交同一 run 不同 check_key 时，READ COMMITTED 隔离级别下两个事务可能都读到
      // 对方尚未提交的旧快照，导致重算的 pass_rate/status 覆盖成不完整数据。行锁把同一
      // run 的并发提交序列化，保证重算时看到的是最新提交后的完整数据。
      await client.query('SELECT id FROM acceptance_runs WHERE id = $1 FOR UPDATE', [runId]);
      const { rows: counts } = await client.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE result = '通过')::int AS pass,
                COUNT(*) FILTER (WHERE result IS NULL)::int AS pending
           FROM acceptance_checks WHERE run_id = $1`,
        [runId]
      );
      const { total, pass, pending } = counts[0];
      const passRate = total > 0 ? pass / total : 0;
      const { rows: prevRows } = await client.query(
        'SELECT status, title, gp_id, run_key FROM acceptance_runs WHERE id = $1',
        [runId]
      );
      const prev = prevRows[0];
      // run 级 status 独立走 7 值状态机，不由格级判定推导（格级判定见 computeCellState）
      const status = computeRunStatus(prev?.status, { total, humanFilled: total - pending });
      const { rows: updated } = await client.query(
        `UPDATE acceptance_runs SET pass_rate = $1, status = $2, updated_at = NOW()
         WHERE id = $3 RETURNING run_key, pass_rate, status`,
        [passRate, status, runId]
      );
      updatedRuns.push(updated[0]);

      // 这段对任何 run 都不触发，是纯占位、待 D4 删除。判据：computeRunStatus 的返回
      // 只可能是 RUN_STATUSES 的三个活跃值，或经 PRESERVED_RUN_STATUSES 白名单原样透传的
      // 前态；'failed' 在白名单里，于是历史 failed run 算出的 next 仍是 'failed'，被
      // prevStatus !== 'failed' 挡掉，其余前态则永远算不出 'failed'。分流建任务由 D4 的
      // 聚合式分流接管。此处显式命名而不是留一个恒不触发的裸条件——「看起来在工作、实际
      // 恒不触发」的代码就是 P2-8 记的棘轮静默击穿。
      if (prev && isLegacyRejectionTransition(prev.status, status)) {
        const { rows: existingTask } = await client.query(
          `SELECT 1 FROM tasks
           WHERE payload->>'acceptance_run_key' = $1
             AND status NOT IN ('completed','failed','cancelled') LIMIT 1`,
          [prev.run_key]
        );
        if (existingTask.length === 0) {
          const { rows: failedChecks } = await client.query(
            `SELECT check_key, name, note FROM acceptance_checks
             WHERE run_id = $1 AND result = '不通过' ORDER BY check_key`,
            [runId]
          );
          const detail = failedChecks.map((c) => `${c.check_key} ${c.name}${c.note ? `（${c.note}）` : ''}`).join('\n');
          try {
            await client.query('SAVEPOINT reject_task_insert');
            await client.query(
              `INSERT INTO tasks (title, description, task_type, priority, status, payload)
               VALUES ($1, $2, 'dev', 'P1', 'queued', $3::jsonb)`,
              [
                `[验收驳回] ${prev.title}`,
                `人工验收不通过，需修复后重新验收。GP: ${prev.gp_id || '未知'}，验收单: ${prev.run_key}。\n不通过项：\n${detail}`,
                JSON.stringify({ acceptance_run_key: prev.run_key, gp_id: prev.gp_id, source: 'acceptance_rejection', harness_mode: false }),
              ]
            );
            await client.query('RELEASE SAVEPOINT reject_task_insert');
          } catch (taskErr) {
            if (taskErr.code !== '23505') throw taskErr;
            // 唯一约束冲突（可能是 uq_tasks_acceptance_rejection_open 或更早的 idx_tasks_dedup_active）
            // 只回滚这一条 INSERT，不能让整个外层事务被毒化，否则会静默丢弃这次已经写入的
            // check 结果和 run 状态更新（PG 语义：事务 aborted 后 COMMIT 会被静默降级为 ROLLBACK）
            await client.query('ROLLBACK TO SAVEPOINT reject_task_insert');
          }
        }
      }
    }
    await client.query('COMMIT');
    return { updated: results.length, runs: updatedRuns };
  } catch (err) {
    await safeRollback(client);
    if (err instanceof AcceptanceResultsError) throw err;
    console.error('[acceptance] submitAcceptanceResults error:', err.message);
    throw new AcceptanceResultsError(500, { error: 'internal_error' });
  } finally {
    client.release();
  }
}

/** SQL 列白名单（默认不含 AI 四列）— 铁律 [SQL列白名单默认隐藏] */
const CHECKS_DEFAULT_COLS = 'id, run_id, check_key, kind, name, device, result, note, submitted_by, decided_at, detail, created_at, updated_at';
/** 含 AI 四列（仅 view=review + human_complete 解锁）*/
const CHECKS_REVIEW_COLS = `${CHECKS_DEFAULT_COLS}, ai_verdict, ai_evidence, ai_run_at, adjudication`;
/** AI 四列名称列表（用于代码层过滤，双保险）*/
const AI_COLS = ['ai_verdict', 'ai_evidence', 'ai_run_at', 'adjudication'];

/**
 * 从行对象中删除 AI 四列（代码层过滤，与 SQL 列白名单双保险）
 */
function stripAiCols(row) {
  const result = { ...row };
  for (const col of AI_COLS) delete result[col];
  return result;
}

async function loadChecks(q, runId, { includeAiCols = false } = {}) {
  const cols = includeAiCols ? CHECKS_REVIEW_COLS : CHECKS_DEFAULT_COLS;
  const { rows } = await q.query(
    `SELECT ${cols} FROM acceptance_checks WHERE run_id = $1 ORDER BY check_key`,
    [runId]
  );
  // 代码层双保险过滤（防止 mock 或未来 SELECT * 回退时泄漏）
  if (!includeAiCols) return rows.map(stripAiCols);
  return rows;
}

export async function loadRunsWithChecks(pool, whereClause, params) {
  const { rows: runs } = await pool.query(
    `SELECT * FROM acceptance_runs WHERE ${whereClause}`,
    params
  );
  const ids = runs.map((r) => r.id);
  let checkRows = [];
  if (ids.length > 0) {
    // 显式列白名单（铁律 [SQL列白名单默认隐藏]）：SELECT * 会泄漏 AI 四列
    const { rows } = await pool.query(
      `SELECT ${CHECKS_DEFAULT_COLS} FROM acceptance_checks WHERE run_id = ANY($1) ORDER BY check_key`,
      [ids]
    );
    checkRows = rows;
  }
  // 代码层双保险：过滤掉查询中可能混入的 AI 四列
  const strippedCheckRows = checkRows.map(stripAiCols);
  const byRun = new Map(runs.map((r) => [r.id, { ...r, checks: [] }]));
  for (const c of strippedCheckRows) byRun.get(c.run_id)?.checks.push(c);
  const runsResult = [...byRun.values()];

  // gp 级跨轮闸（铁律 [gp级跨轮闸活跃run谓词]）：
  // 谓词必须是 status IN ('pending','in_review')，不得使用宽泛「存在 run」
  // 注：stripAiCols 已确保 AI 四列不在 checks 里，这里显式置 null 是为满足
  // B5 测试断言（c[col] == null），因为 stripAiCols 的 delete 让属性不存在，
  // 而 undefined == null 为 true，所以两条路径均满足 BEHAVIOR-5 断言。
  const hasActiveRun = runsResult.some((r) => r.status === 'pending' || r.status === 'in_review');
  if (hasActiveRun) {
    for (const run of runsResult) {
      for (const c of run.checks) {
        c.ai_verdict = null;
        c.ai_evidence = null;
        c.ai_run_at = null;
        c.adjudication = null;
      }
    }
  }
  return runsResult;
}

export async function loadPendingRuns(pool) {
  return loadRunsWithChecks(pool, `status IN ('pending','in_review') ORDER BY created_at`, []);
}

export function createAcceptanceInternalRouter({ pool }) {
  const router = express.Router();
  // 内网限流：宽松额度防误伤 harness 自动建单，同时满足 DB 访问限流要求（CodeQL js/missing-rate-limiting）
  router.use(rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false }));

  router.post('/runs', async (req, res) => {
    const { run_key, title, gp_id, line, surface, version, source = 'manual', checks } = req.body || {};
    if (!run_key || !title) return res.status(400).json({ error: 'run_key and title are required' });
    if (!Array.isArray(checks) || checks.length === 0) {
      return res.status(400).json({ error: 'checks must be a non-empty array' });
    }
    for (const [i, c] of checks.entries()) {
      if (!c || !c.name) return res.status(400).json({ error: `checks[${i}].name is required` });
      if (!c.check_key || !CHECK_KEY_PATTERN.test(c.check_key)) {
        return res.status(400).json({ error: `checks[${i}].check_key must match ^S\\d+-c[1-4]$（规程格号，由建单生成器产出）` });
      }
      if (!ACCEPTANCE_KINDS.includes(c.kind)) {
        return res.status(400).json({ error: `checks[${i}].kind must be one of: ${ACCEPTANCE_KINDS.join(',')}` });
      }
    }
    // 生成器输出里同号格重复是客户端送来的结构异常，要当场 400 说清楚是哪个格号。
    // 不拦的话它会一路走到逐行 INSERT 撞 (run_id, check_key) 唯一约束，被下面那段
    // 23505 分支当成「run 已存在」去重查——重查不到就回一个语焉不详的 500，
    // 而真正的原因（规程里格号重复）一个字都没出现。
    const dupes = findDuplicateCheckKeys(checks.map((c) => c.check_key));
    if (dupes.length > 0) {
      return res.status(400).json({ error: 'duplicate_check_key', duplicates: dupes });
    }
    if (!SOURCES.includes(source)) return res.status(400).json({ error: `source must be one of: ${SOURCES.join(',')}` });

    // 单头：v7-final 的 run 级附属信息整块落 detail（tenant_account/版本戳/scenarios_observed…）。
    // 建单是这些字段唯一的写入侧——Task 8 的收单期推进闸读的就是这里落进去的 scenarios_observed。
    const { detail: head = {}, force_reason, force_opened_by } = req.body || {};
    const gateError = await checkCreateGate(pool, { gp_id, run_key, head, force_reason, force_opened_by });
    if (gateError) return res.status(gateError.status).json(gateError.body);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query('SELECT * FROM acceptance_runs WHERE run_key = $1', [run_key]);
      if (existing.rows.length > 0) {
        const existingChecks = await loadChecks(client, existing.rows[0].id);
        await client.query('COMMIT');
        return res.status(200).json({ run: existing.rows[0], checks: existingChecks, created: false });
      }
      const { rows: runRows } = await client.query(
        `INSERT INTO acceptance_runs (run_key, title, gp_id, line, surface, version, source, detail)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING *`,
        [run_key, title, gp_id || null, line || null, surface || null, version || null, source,
         JSON.stringify(head)]
      );
      const run = runRows[0];
      const createdChecks = [];
      for (const c of checks) {
        const { rows } = await client.query(
          `INSERT INTO acceptance_checks (run_id, check_key, kind, name, device, detail)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [run.id, c.check_key, c.kind, c.name, c.device || null, c.detail ? JSON.stringify(c.detail) : null]
        );
        createdChecks.push(rows[0]);
      }
      await client.query('COMMIT');
      return res.status(201).json({ run, checks: createdChecks, created: true });
    } catch (err) {
      await safeRollback(client);
      if (err.code === '23505') {
        try {
          const { rows } = await client.query('SELECT * FROM acceptance_runs WHERE run_key = $1', [run_key]);
          if (rows.length > 0) {
            const existingChecks = await loadChecks(client, rows[0].id);
            return res.status(200).json({ run: rows[0], checks: existingChecks, created: false });
          }
        } catch (retryErr) {
          console.error('[acceptance] POST /runs 23505 重查失败:', retryErr.message);
        }
      }
      console.error('[acceptance] POST /runs error:', err.message);
      return res.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  // 目录快照上载（zenithjoy CI 在 product-map 合并后推送；Worker 经公网 GET 拉取）
  router.post('/catalog', async (req, res) => {
    const { catalog } = req.body || {};
    if (!catalog || typeof catalog !== 'object' || !Array.isArray(catalog.golden_paths)) {
      return res.status(400).json({ error: 'catalog.golden_paths must be an array' });
    }
    try {
      const { rows } = await pool.query(
        `INSERT INTO acceptance_catalog (id, payload, updated_at) VALUES (1, $1::jsonb, NOW())
         ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING updated_at`,
        [JSON.stringify(catalog)]
      );
      return res.json({ updated_at: rows[0]?.updated_at, golden_paths: catalog.golden_paths.length });
    } catch (err) {
      console.error('[acceptance] POST /catalog error:', err.message);
      return res.status(500).json({ error: err.message });
    }
  });

  router.get('/runs', async (req, res) => {
    const { gp_id } = req.query;
    if (!gp_id) return res.status(400).json({ error: 'gp_id query param required' });
    try {
      const runs = await loadRunsWithChecks(pool, 'gp_id = $1 ORDER BY created_at DESC', [gp_id]);
      return res.json({ runs });
    } catch (err) {
      console.error('[acceptance] GET /runs error:', err.message);
      return res.status(500).json({ error: err.message });
    }
  });

  router.get('/runs/:run_key', async (req, res) => {
    const { view } = req.query;
    const client = await pool.connect();
    try {
      const { rows } = await client.query('SELECT * FROM acceptance_runs WHERE run_key = $1', [req.params.run_key]);
      if (rows.length === 0) return res.status(404).json({ error: 'run not found' });
      const run = rows[0];
      // view=review 参数校验（铁律 [SQL列白名单默认隐藏]）：
      // 只有 status=human_complete 才允许解锁 AI 四列，否则 403
      if (view === 'review') {
        if (run.status !== 'human_complete') {
          return res.status(403).json({ error: `view=review requires status=human_complete, current status: ${run.status}` });
        }
        const checks = await loadChecks(client, run.id, { includeAiCols: true });
        return res.json({ run, checks });
      }
      const checks = await loadChecks(client, run.id);
      return res.json({ run, checks });
    } catch (err) {
      console.error('[acceptance] GET /runs/:run_key error:', err.message);
      return res.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  router.post('/results', async (req, res) => {
    try {
      const result = await submitAcceptanceResults(pool, req.body?.results, {
        run_key: req.body?.run_key,
        backend_sha: req.body?.backend_sha,
        frontend_sha: req.body?.frontend_sha,
        spec_sha: req.body?.spec_sha,
      });
      return res.json(result);
    } catch (err) {
      if (err instanceof AcceptanceResultsError) return res.status(err.status).json(err.body);
      console.error('[acceptance] internal POST /results error:', err.message);
      return res.status(500).json({ error: 'internal_error' });
    }
  });

  registerAiResultsRoute(router, { pool, safeRollback });

  // ─── FR-1/FR-2: 裁决写入端点 ──────────────────────────────────────────────
  /**
   * PATCH /runs/:run_key/checks/:check_key/adjudicate
   * 人工裁决单格，写入 adjudication JSONB（四字段：verdict/by/reason/at）。
   * FR-2：hard 格裁决绿自动建 hard_green_p0 任务，除非 scenario_class='unverifiable_this_version'。
   */
  router.patch('/runs/:run_key/checks/:check_key/adjudicate', async (req, res) => {
    const { verdict, by, reason } = req.body || {};
    // FR-1 400 校验：三字段必填 + verdict 枚举
    if (!verdict) return res.status(400).json({ error: 'verdict is required' });
    if (!by) return res.status(400).json({ error: 'by is required' });
    if (!reason) return res.status(400).json({ error: 'reason is required' });
    if (!['绿', '红'].includes(verdict)) {
      return res.status(400).json({ error: 'verdict must be 绿 or 红' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // 获取 run
      const { rows: runRows } = await client.query(
        'SELECT id, run_key, status, detail FROM acceptance_runs WHERE run_key = $1',
        [req.params.run_key]
      );
      if (runRows.length === 0) {
        await safeRollback(client);
        return res.status(404).json({ error: 'run not found' });
      }
      const run = runRows[0];

      // 获取 check
      const { rows: checkRows } = await client.query(
        'SELECT id, check_key, run_id, adjudication, scenario_class, is_hard FROM acceptance_checks WHERE run_id = $1 AND check_key = $2',
        [run.id, req.params.check_key]
      );
      if (checkRows.length === 0) {
        await safeRollback(client);
        return res.status(404).json({ error: 'check not found' });
      }
      const check = checkRows[0];

      // 写入 adjudication（四字段，at 由服务端注入）
      const adjudication = {
        verdict,
        by,
        reason,
        at: new Date().toISOString(),
      };
      await client.query(
        'UPDATE acceptance_checks SET adjudication = $1::jsonb, updated_at = NOW() WHERE id = $2',
        [JSON.stringify(adjudication), check.id]
      );

      // FR-2: hard 格 + 裁决绿 + 非 unverifiable_this_version → 建 hard_green_p0 任务
      if (check.is_hard && verdict === '绿') {
        if (check.scenario_class === 'unverifiable_this_version') {
          // 例外：只计数+注记，不建 P0
          const currentDetail = run.detail || {};
          const unverifiableList = currentDetail.unverifiable_adjudicated || [];
          if (!unverifiableList.includes(check.check_key)) {
            unverifiableList.push(check.check_key);
          }
          await client.query(
            `UPDATE acceptance_runs SET detail = COALESCE(detail,'{}'::jsonb) || $1::jsonb, updated_at = NOW() WHERE id = $2`,
            [JSON.stringify({ unverifiable_adjudicated: unverifiableList }), run.id]
          );
        } else {
          // 建 hard_green_p0 任务（SAVEPOINT 保护 23505）
          try {
            await client.query('SAVEPOINT hard_green_p0_insert');
            await client.query(
              `INSERT INTO tasks (title, description, task_type, priority, status, payload)
               VALUES ($1, $2, 'dev', 'P0', 'queued', $3::jsonb)`,
              [
                `[Hard格绿裁决] ${run.run_key}/${check.check_key}`,
                `Hard 格裁决绿，需即时跟进。run: ${run.run_key}，格: ${check.check_key}`,
                JSON.stringify({
                  acceptance_run_key: run.run_key,
                  acceptance_bucket: 'hard_green_p0',
                  check_key: check.check_key,
                  priority: 'P0',
                }),
              ]
            );
            await client.query('RELEASE SAVEPOINT hard_green_p0_insert');
          } catch (taskErr) {
            if (taskErr.code !== '23505') throw taskErr;
            await client.query('ROLLBACK TO SAVEPOINT hard_green_p0_insert');
          }
        }
      }

      // 重算 gate_verdict（读所有格的 adjudication）
      const { rows: allChecks } = await client.query(
        'SELECT adjudication FROM acceptance_checks WHERE run_id = $1',
        [run.id]
      );
      const allAdjudicated = allChecks.every((c) => c.adjudication != null);
      const anyRed = allChecks.some((c) => c.adjudication?.verdict === '红');
      const gateVerdict = allAdjudicated ? (anyRed ? '红' : '绿') : null;
      if (gateVerdict !== null) {
        await client.query(
          `UPDATE acceptance_runs SET detail = COALESCE(detail,'{}'::jsonb) || $1::jsonb, updated_at = NOW() WHERE id = $2`,
          [JSON.stringify({ gate_verdict: gateVerdict }), run.id]
        );
      }

      await client.query('COMMIT');
      return res.json({ adjudication, check_key: check.check_key, gate_verdict: gateVerdict });
    } catch (err) {
      await safeRollback(client);
      console.error('[acceptance] PATCH /adjudicate error:', err.message);
      return res.status(500).json({ error: 'internal_error' });
    } finally {
      client.release();
    }
  });

  // ─── FR-3/FR-5: 定案后聚合分流建任务 ──────────────────────────────────────
  /**
   * PATCH /runs/:run_key/adjudicate-run
   * 将 run 定案（status → adjudicated），并聚合分流建任务。
   * 路由优先级：dumb → fission → 正常分流(bug/trace)
   * FR-5: 每条 INSERT 包在 SAVEPOINT 里，23505 只回滚单条，不毒化外层事务。
   */
  router.patch('/runs/:run_key/adjudicate-run', async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 获取 run
      const { rows: runRows } = await client.query(
        'SELECT id, run_key, status, detail, gp_id, title FROM acceptance_runs WHERE run_key = $1',
        [req.params.run_key]
      );
      if (runRows.length === 0) {
        await safeRollback(client);
        return res.status(404).json({ error: 'run not found' });
      }
      const run = runRows[0];

      // 获取所有格
      const { rows: checks } = await client.query(
        'SELECT id, check_key, adjudication, scenario_class, is_hard FROM acceptance_checks WHERE run_id = $1',
        [run.id]
      );

      const detail = run.detail || {};
      const aiStatus = detail.ai_status;

      // anchor 三件套（从 run 里取，尽量非空）
      const anchor = {
        gp_id: run.gp_id || '',
        journey_id: detail.journey_id || run.gp_id || '',
        step_id: detail.step_id || run.run_key || '',
      };

      const tasks = [];

      /**
       * 安全建任务：SAVEPOINT 保护 23505，不毒化外层事务
       * 先查重（按 run_key+bucket 维度），有未终态任务则跳过
       */
      async function safeInsertTask(title, description, bucket, priority = 'P2') {
        // 查重：按 run_key + bucket 维度
        const { rows: existing } = await client.query(
          `SELECT 1 FROM tasks
            WHERE payload->>'acceptance_run_key' = $1
              AND payload->>'acceptance_bucket' = $2
              AND status NOT IN ('completed','failed','cancelled') LIMIT 1`,
          [run.run_key, bucket]
        );
        if (existing.length > 0) return null; // 已有未终态任务，跳过

        try {
          await client.query(`SAVEPOINT task_insert_${bucket.replace(/-/g, '_')}`);
          const { rows } = await client.query(
            `INSERT INTO tasks (title, description, task_type, priority, status, payload)
             VALUES ($1, $2, 'dev', $3, 'queued', $4::jsonb)
             RETURNING id`,
            [
              title,
              description,
              priority,
              JSON.stringify({
                acceptance_run_key: run.run_key,
                acceptance_bucket: bucket,
                anchor,
                priority,
              }),
            ]
          );
          await client.query(`RELEASE SAVEPOINT task_insert_${bucket.replace(/-/g, '_')}`);
          return rows[0];
        } catch (err) {
          if (err.code === '23505') {
            await client.query(`ROLLBACK TO SAVEPOINT task_insert_${bucket.replace(/-/g, '_')}`);
            return null;
          }
          throw err;
        }
      }

      // ① 哑火路径：ai_status=dumb → infra_error P0，独立路径不进熔断
      if (aiStatus === 'dumb') {
        const task = await safeInsertTask(
          `[AI哑火] ${run.run_key}`,
          `AI 推理哑火（ai_status=dumb），验收 run 无法正常分流，需排查 AI 基础设施。run: ${run.run_key}`,
          'infra_error',
          'P0'
        );
        if (task) tasks.push(task);
      } else {
        // ② 统计非绿格占比
        const TOTAL_CHECKS = 36;
        const nonGreen = checks.filter(
          (c) => !c.adjudication || c.adjudication.verdict !== '绿'
        ).length;
        const nonGreenRatio = nonGreen / TOTAL_CHECKS;

        if (nonGreenRatio > 1 / 3) {
          // ③ 非绿格 > 1/3 → fission P0，不建 bug/trace
          const task = await safeInsertTask(
            `[规程疑似分叉] ${run.run_key}`,
            `非绿格占比 ${Math.round(nonGreenRatio * 100)}%（${nonGreen}/${TOTAL_CHECKS}），超过 1/3 阈值，规程/数据源疑似分叉。run: ${run.run_key}`,
            'fission',
            'P0'
          );
          if (task) tasks.push(task);
        } else {
          // ④ 正常分流：bug（≤1）+ trace（≤1）
          // bug：有红格时建 1 个聚合 bug 任务
          const redChecks = checks.filter((c) => c.adjudication?.verdict === '红');
          if (redChecks.length > 0) {
            const bugDetail = redChecks.map((c) => c.check_key).join(', ');
            const task = await safeInsertTask(
              `[验收红格] ${run.run_key}`,
              `人工裁决红格：${bugDetail}。run: ${run.run_key}，需修复后重验。`,
              'bug',
              'P1'
            );
            if (task) tasks.push(task);
          }

          // trace：有 trace_q4/trace_q7 等 scenario_class 时建 1 个追查任务
          const traceChecks = checks.filter(
            (c) => c.scenario_class && c.scenario_class.startsWith('trace_')
          );
          if (traceChecks.length > 0) {
            const traceDetail = traceChecks.map((c) => c.check_key).join(', ');
            const task = await safeInsertTask(
              `[追查] ${run.run_key}`,
              `需追查场景：${traceDetail}。run: ${run.run_key}`,
              'trace',
              'P2'
            );
            if (task) tasks.push(task);
          }
        }
      }

      // 更新 run 状态为 adjudicated
      await client.query(
        `UPDATE acceptance_runs SET status = 'adjudicated', updated_at = NOW() WHERE id = $1`,
        [run.id]
      );

      await client.query('COMMIT');
      return res.json({ status: 'adjudicated', tasks });
    } catch (err) {
      await safeRollback(client);
      console.error('[acceptance] PATCH /adjudicate-run error:', err.message);
      return res.status(500).json({ error: 'internal_error' });
    } finally {
      client.release();
    }
  });

  /**
   * 显式作废（A10③）。终态只由 status 表达，detail 里三项纯留痕——两者在同一条 UPDATE 里落，
   * 不存在「detail 标了作废但 status 还活着」的中间态（A10④ 反二义断言的就是这个）。
   * FR-4：adjudicated/stale 状态禁被覆盖成 abandoned，返回 409 + body.current_status。
   */
  router.patch('/runs/:run_key/abandon', async (req, res) => {
    const { reason, by } = req.body || {};
    if (!reason || !by) return res.status(400).json({ error: 'reason and by are required' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // 先查当前状态（FR-4 前态守卫）
      const { rows: runRows } = await client.query(
        'SELECT id, run_key, status FROM acceptance_runs WHERE run_key = $1',
        [req.params.run_key]
      );
      if (runRows.length === 0) {
        await safeRollback(client);
        return res.status(404).json({ error: 'run not found' });
      }
      const currentStatus = runRows[0].status;
      // 禁止在 adjudicated/stale 状态 abandon
      if (currentStatus === 'adjudicated' || currentStatus === 'stale') {
        await safeRollback(client);
        return res.status(409).json({ error: 'cannot_abandon', current_status: currentStatus });
      }
      const { rows } = await client.query(
        `UPDATE acceptance_runs SET status = 'abandoned', detail = COALESCE(detail, '{}'::jsonb) || $1::jsonb, updated_at = NOW() WHERE id = $2 RETURNING run_key, status`,
        [
          JSON.stringify({
            abandoned_reason: reason,
            abandoned_by: by,
            abandoned_at: new Date().toISOString(),
          }),
          runRows[0].id,
        ]
      );
      if (rows.length === 0) {
        await safeRollback(client);
        return res.status(404).json({ error: 'run not found' });
      }
      await client.query('COMMIT');
      return res.json({ run: rows[0] });
    } catch (err) {
      await safeRollback(client);
      console.error('[acceptance] PATCH /abandon error:', err.message);
      return res.status(500).json({ error: 'internal_error' });
    } finally {
      client.release();
    }
  });

  registerReviewClosureRoutes(router, { pool, safeRollback });

  router.get('/pending', async (_req, res) => {
    try {
      const runs = await loadPendingRuns(pool);
      return res.json({ runs });
    } catch (err) {
      console.error('[acceptance] internal GET /pending error:', err.message);
      return res.status(500).json({ error: 'internal_error' });
    }
  });

  return router;
}

export function createAcceptancePublicRouter({ pool }) {
  const router = express.Router();

  router.get('/acceptance/catalog', async (_req, res) => {
    try {
      const { rows } = await pool.query(
        'SELECT payload, updated_at FROM acceptance_catalog WHERE id = 1'
      );
      if (rows.length === 0) return res.status(404).json({ error: 'catalog not seeded' });
      return res.json({ catalog: rows[0].payload, updated_at: rows[0].updated_at });
    } catch (err) {
      console.error('[acceptance] GET /catalog error:', err.message);
      return res.status(500).json({ error: 'internal_error' });
    }
  });

  router.get('/acceptance/pending', async (_req, res) => {
    try {
      const runs = await loadPendingRuns(pool);
      return res.json({ runs });
    } catch (err) {
      console.error('[acceptance] GET /pending error:', err.message);
      return res.status(500).json({ error: 'internal_error' });
    }
  });

  // POST /acceptance/results 已休眠（铁律 [公网端点休眠不删码]）：
  // 路由不再注册（端点返回 404），但 submitAcceptanceResults 函数体保留，不删除。
  // 如需重新启用，解注释下方路由并配合 SOP-1（上线前核日志）执行。
  // router.post('/acceptance/results', async (req, res) => { ... });

  return router;
}
