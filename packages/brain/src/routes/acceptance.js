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

/** 仅覆盖 migration 392 之前的历史 failed run；新状态机不产生 failed，D4 接管后删除 */
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
export async function submitAcceptanceResults(pool, results, { run_key } = {}) {
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
      'SELECT id FROM acceptance_runs WHERE run_key = $1', [run_key]
    );
    if (runRows.length === 0) {
      await safeRollback(client);
      throw new AcceptanceResultsError(404, { error: 'run not found', run_key });
    }
    const scopedRunId = runRows[0].id;
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

      // 新状态机永不产生 failed（computeRunStatus 的全集是 RUN_STATUSES），这段只对
      // migration 392 之前落库的历史 failed run 生效。分流建任务由 D4 的聚合式分流接管，
      // 届时整段删除。此处显式命名而不是留一个恒不触发的裸条件——「看起来在工作、实际
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

async function loadChecks(q, runId) {
  const { rows } = await q.query(
    'SELECT * FROM acceptance_checks WHERE run_id = $1 ORDER BY check_key',
    [runId]
  );
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
    const { rows } = await pool.query(
      'SELECT * FROM acceptance_checks WHERE run_id = ANY($1) ORDER BY check_key',
      [ids]
    );
    checkRows = rows;
  }
  const byRun = new Map(runs.map((r) => [r.id, { ...r, checks: [] }]));
  for (const c of checkRows) byRun.get(c.run_id)?.checks.push(c);
  return [...byRun.values()];
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
        `INSERT INTO acceptance_runs (run_key, title, gp_id, line, surface, version, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [run_key, title, gp_id || null, line || null, surface || null, version || null, source]
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
    const client = await pool.connect();
    try {
      const { rows } = await client.query('SELECT * FROM acceptance_runs WHERE run_key = $1', [req.params.run_key]);
      if (rows.length === 0) return res.status(404).json({ error: 'run not found' });
      const checks = await loadChecks(client, rows[0].id);
      return res.json({ run: rows[0], checks });
    } catch (err) {
      console.error('[acceptance] GET /runs/:run_key error:', err.message);
      return res.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  router.post('/results', async (req, res) => {
    try {
      const result = await submitAcceptanceResults(pool, req.body?.results, { run_key: req.body?.run_key });
      return res.json(result);
    } catch (err) {
      if (err instanceof AcceptanceResultsError) return res.status(err.status).json(err.body);
      console.error('[acceptance] internal POST /results error:', err.message);
      return res.status(500).json({ error: 'internal_error' });
    }
  });

  registerAiResultsRoute(router, { pool, safeRollback });

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

  router.post('/acceptance/results', async (req, res) => {
    try {
      const result = await submitAcceptanceResults(pool, req.body?.results, { run_key: req.body?.run_key });
      return res.json(result);
    } catch (err) {
      if (err instanceof AcceptanceResultsError) return res.status(err.status).json(err.body);
      console.error('[acceptance] public POST /results error:', err.message);
      return res.status(500).json({ error: 'internal_error' });
    }
  });

  return router;
}
