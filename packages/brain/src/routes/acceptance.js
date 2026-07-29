/**
 * Acceptance 验收端点（刀 1）— Notion Worker 闭环 SSOT
 * 内网 router：建单/查单（挂 5221 /api/brain/acceptance）
 * 公网 router：pending 拉取 / results 回写（挂 5223，见 acceptance-public-server.js）
 */
import express from 'express';
import rateLimit from 'express-rate-limit';

export const ACCEPTANCE_KINDS = ['FR', 'NFR', 'Invariant', 'SOP'];
export const ACCEPTANCE_RESULTS = ['通过', '不通过', '无法验证'];
const SOURCES = ['manual', 'harness'];

async function safeRollback(client) {
  try { await client.query('ROLLBACK'); } catch { /* 连接已坏，忽略 */ }
}

async function loadChecks(q, runId) {
  const { rows } = await q.query(
    'SELECT * FROM acceptance_checks WHERE run_id = $1 ORDER BY check_key',
    [runId]
  );
  return rows;
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
      if (!ACCEPTANCE_KINDS.includes(c.kind)) {
        return res.status(400).json({ error: `checks[${i}].kind must be one of: ${ACCEPTANCE_KINDS.join(',')}` });
      }
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
      for (let i = 0; i < checks.length; i++) {
        const c = checks[i];
        const checkKey = `${run_key}:${String(i + 1).padStart(3, '0')}`;
        const { rows } = await client.query(
          `INSERT INTO acceptance_checks (run_id, check_key, kind, name, device)
           VALUES ($1,$2,$3,$4,$5) RETURNING *`,
          [run.id, checkKey, c.kind, c.name, c.device || null]
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

  return router;
}

export function createAcceptancePublicRouter({ pool }) {
  const router = express.Router();

  router.get('/acceptance/pending', async (_req, res) => {
    try {
      const { rows: runs } = await pool.query(
        `SELECT * FROM acceptance_runs WHERE status IN ('pending','in_review') ORDER BY created_at`
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
      return res.json({ runs: [...byRun.values()] });
    } catch (err) {
      console.error('[acceptance] GET /pending error:', err.message);
      return res.status(500).json({ error: 'internal_error' });
    }
  });

  router.post('/acceptance/results', async (req, res) => {
    const { results } = req.body || {};
    if (!Array.isArray(results) || results.length === 0) {
      return res.status(400).json({ error: 'results must be a non-empty array' });
    }
    const invalid = [];
    for (const [i, r] of results.entries()) {
      if (!r || !r.check_key) invalid.push({ index: i, error: 'check_key required' });
      else if (!ACCEPTANCE_RESULTS.includes(r.result)) {
        invalid.push({ index: i, check_key: r.check_key, error: `result must be one of: ${ACCEPTANCE_RESULTS.join(',')}` });
      }
    }
    if (invalid.length > 0) return res.status(400).json({ error: 'invalid results', invalid });

    const seen = new Set();
    for (const r of results) {
      if (r?.check_key) {
        if (seen.has(r.check_key)) return res.status(400).json({ error: 'duplicate check_key in batch', check_key: r.check_key });
        seen.add(r.check_key);
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const keys = results.map((r) => r.check_key);
      const { rows: found } = await client.query(
        'SELECT check_key, run_id FROM acceptance_checks WHERE check_key = ANY($1)',
        [keys]
      );
      const foundKeys = new Set(found.map((r) => r.check_key));
      const missing = keys.filter((k) => !foundKeys.has(k));
      if (missing.length > 0) {
        await safeRollback(client);
        return res.status(400).json({ error: 'unknown check_key', missing });
      }
      for (const r of results) {
        await client.query(
          `UPDATE acceptance_checks SET result = $1, note = $2, decided_at = NOW(), updated_at = NOW()
           WHERE check_key = $3`,
          [r.result, r.note || null, r.check_key]
        );
      }
      const runIds = [...new Set(found.map((r) => r.run_id))];
      const updatedRuns = [];
      for (const runId of runIds) {
        const { rows: counts } = await client.query(
          `SELECT COUNT(*)::int AS total,
                  COUNT(*) FILTER (WHERE result = '通过')::int AS pass,
                  COUNT(*) FILTER (WHERE result = '不通过')::int AS fail,
                  COUNT(*) FILTER (WHERE result IS NULL)::int AS pending
             FROM acceptance_checks WHERE run_id = $1`,
          [runId]
        );
        const { total, pass, fail, pending } = counts[0];
        const passRate = total > 0 ? pass / total : 0;
        const status = pending > 0 ? 'in_review' : fail > 0 ? 'failed' : pass === total ? 'passed' : 'in_review';
        const { rows: updated } = await client.query(
          `UPDATE acceptance_runs SET pass_rate = $1, status = $2, updated_at = NOW()
           WHERE id = $3 RETURNING run_key, pass_rate, status`,
          [passRate, status, runId]
        );
        updatedRuns.push(updated[0]);
      }
      await client.query('COMMIT');
      return res.json({ updated: results.length, runs: updatedRuns });
    } catch (err) {
      await safeRollback(client);
      console.error('[acceptance] POST /results error:', err.message);
      return res.status(500).json({ error: 'internal_error' });
    } finally {
      client.release();
    }
  });

  return router;
}
