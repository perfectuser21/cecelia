/**
 * Preview 环境路由
 *
 * POST   /api/brain/preview/allocate  — 为 PR 分配预览端口（5300-5399）
 * GET    /api/brain/preview           — 列出所有活跃预览环境
 * DELETE /api/brain/preview/:pr_number — 停止某 PR 的预览环境（kill 进程 + 清 DB）
 */

import { Router } from 'express';
import { readFileSync } from 'fs';
import pool from '../db.js';
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
    const { rows } = await pool.query(
      'SELECT * FROM preview_environments ORDER BY created_at DESC'
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
    // 先查端口，再 kill 进程，最后删 DB 行
    const { rows } = await pool.query(
      'SELECT port FROM preview_environments WHERE pr_number=$1',
      [prNumber]
    );
    if (rows.length > 0) {
      const port = rows[0].port;
      try {
        const pidFile = `/tmp/review-preview-${port}.pid`;
        const pid = readFileSync(pidFile, 'utf8').trim();
        if (pid) process.kill(Number(pid));
      } catch { /* 进程已不存在，忽略 */ }
    }
    await stopPreview(prNumber);
    res.json({ stopped: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
