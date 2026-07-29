/**
 * Acceptance 验收端点（刀 1）— Notion Worker 闭环 SSOT
 * 内网 router：建单/查单（挂 5221 /api/brain/acceptance）
 * 公网 router：pending 拉取 / results 回写（挂 5223，见 acceptance-public-server.js）
 */
import express from 'express';

export const ACCEPTANCE_KINDS = ['FR', 'NFR', 'Invariant', 'SOP'];
export const ACCEPTANCE_RESULTS = ['通过', '不通过', '无法验证'];
const SOURCES = ['manual', 'harness'];

async function loadChecks(q, runId) {
  const { rows } = await q.query(
    'SELECT * FROM acceptance_checks WHERE run_id = $1 ORDER BY check_key',
    [runId]
  );
  return rows;
}

export function createAcceptanceInternalRouter({ pool }) {
  const router = express.Router();

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
      await client.query('ROLLBACK');
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
