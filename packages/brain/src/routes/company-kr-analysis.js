import { Router } from 'express';
import { companyAnalysisStatus, configureCompanyAnalysis, requestCompanyKrAnalysis } from '../lib/company-kr-analysis.js';

export function createCompanyAnalysisRouter(pool) {
  const router = Router();
  router.get('/company-key-results/analysis', async (_req, res) => {
    try { res.json({ success: true, ...await companyAnalysisStatus(pool) }); }
    catch (error) { res.status(500).json({ success: false, error: error.message }); }
  });
  router.patch('/company-key-results/analysis', async (req, res) => {
    try { res.json({ success: true, ...await configureCompanyAnalysis(pool, req.body) }); }
    catch (error) { res.status(400).json({ success: false, error: error.message }); }
  });
  router.post('/company-key-results/analysis', async (req, res) => {
    try {
      if (Object.keys(req.body).some(k => k !== 'retry') || (req.body.retry !== undefined && typeof req.body.retry !== 'boolean')) return res.status(400).json({ success: false, error: '仅接受布尔retry参数' });
      res.json(await requestCompanyKrAnalysis(pool, { manual: true, retry: req.body.retry === true }));
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
  });
  return router;
}
