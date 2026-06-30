/**
 * Preview 环境路由
 *
 * POST   /api/brain/preview/allocate  — 为 PR 分配预览端口（5300-5399）
 * GET    /api/brain/preview           — 列出所有活跃预览环境
 * DELETE /api/brain/preview/:pr_number — 停止某 PR 的预览环境
 */

import { Router } from 'express';
import { allocatePort, stopPreview } from '../preview-manager.js';

const router = Router();

router.post('/allocate', async (req, res) => {
  const { pr_number, branch_name, base_repo } = req.body;
  if (!pr_number || !branch_name) {
    return res.status(400).json({ error: 'pr_number and branch_name are required' });
  }
  try {
    const port = await allocatePort(Number(pr_number), branch_name, base_repo);
    res.json({ port });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const { default: pool } = await import('../db.js');
    const { rows } = await pool.query(
      "SELECT * FROM preview_environments WHERE status='active' ORDER BY created_at DESC"
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:pr_number', async (req, res) => {
  const prNumber = parseInt(req.params.pr_number, 10);
  if (isNaN(prNumber)) return res.status(400).json({ error: 'invalid pr_number' });
  try {
    await stopPreview(prNumber);
    res.json({ stopped: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
