import { Router } from 'express';
import { getJobs, runJob, setJobConfig, getJobHistory } from '../janitor.js';

const router = Router();

router.get('/jobs', async (req, res) => {
  try {
    res.json(await getJobs(req.app.locals.pool));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/jobs/:id/run', async (req, res) => {
  try {
    const result = await runJob(req.app.locals.pool, req.params.id);
    res.json(result);
  } catch (err) {
    res.status(err.message.startsWith('Unknown') ? 404 : 500)
       .json({ error: err.message });
  }
});

router.patch('/jobs/:id/config', async (req, res) => {
  try {
    const { enabled } = req.body ?? {};
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be boolean' });
    }
    res.json(await setJobConfig(req.app.locals.pool, req.params.id, { enabled }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/jobs/:id/history', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit ?? '20'), 100);
    res.json(await getJobHistory(req.app.locals.pool, req.params.id, limit));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
