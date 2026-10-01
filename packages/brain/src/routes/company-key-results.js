import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import defaultPool from '../db.js';
import { companyKrView, COMPANY_METRIC_MODE } from '../lib/company-kr-metrics.js';
import { importCompanyKrs } from '../lib/company-kr-import.js';
import { observeCompanyKr } from '../lib/company-kr-observations.js';
import { readCompanySnapshot } from '../projection/company-key-results.js';

export function createCompanyKrRouter({ pool = defaultPool, token, notionReq } = {}) {
  const router = Router();
  router.use(rateLimit({ windowMs: 60000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false }));
  router.get('/company-key-results', async (req, res) => {
    try {
      const { rows } = await pool.query(`SELECT kr.*, kr.updated_at::text AS observation_version, o.title AS objective_title FROM key_results kr LEFT JOIN objectives o ON o.id=kr.objective_id WHERE kr.metadata->>'metric_mode'=$1 ORDER BY kr.custom_props->'company_notion'->>'page_id'`, [COMPANY_METRIC_MODE]);
      res.json({ success: true, items: rows.map(companyKrView) });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
  });
  router.post('/company-key-results/import', async (req, res) => {
    try {
      if (!req.body.task_id || !req.body.actor) return res.status(400).json({ success: false, error: 'task_id与actor必填' });
      const snapshot = await readCompanySnapshot({ token, notionReq });
      res.json(await importCompanyKrs(pool, snapshot, req.body));
    } catch (error) { res.status(error.status || 400).json({ success: false, error: error.message }); }
  });
  router.post('/key-results/:id/observations', async (req, res) => {
    try { res.json(await observeCompanyKr(pool, req.params.id, req.body)); }
    catch (error) { res.status(error.status || 400).json({ success: false, error: error.message }); }
  });
  return router;
}
export default createCompanyKrRouter();
