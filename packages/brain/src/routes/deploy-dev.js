/**
 * deploy-dev.js — Brain deploy/dev 端点
 * POST /api/brain/deploy {dev:true} → 触发 dev 部署
 * GET  /api/brain/deploy/dev/status → 返回部署状态
 *
 * Sprint: 07131922-环境模型三段常驻收尾
 * task_id: d063b3e5-8fb1-4d53-b176-8e8198c7a084
 */

import express from 'express';
import { execFile } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();
const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = join(__dirname, '../../../../scripts');

// 内存中保存最近一次部署状态（重启后重置为 idle）
let devDeployState = {
  status: 'idle',       // idle | pending | running | success | failed
  job_id: null,
  started_at: null,
  finished_at: null,
  error: null,
};

/**
 * POST /api/brain/deploy
 * body: { dev: true }
 * 触发 dev 部署脚本（scripts/dev-deploy.sh）
 */
router.post('/deploy', (req, res) => {
  const { dev } = req.body || {};

  if (!dev) {
    return res.status(400).json({ error: 'body.dev must be true for dev deploy' });
  }

  // 若正在运行，返回 409
  if (devDeployState.status === 'running' || devDeployState.status === 'pending') {
    return res.status(409).json({
      error: 'dev deploy already in progress',
      status: devDeployState.status,
      job_id: devDeployState.job_id,
    });
  }

  const jobId = `dev-deploy-${Date.now()}`;
  devDeployState = {
    status: 'pending',
    job_id: jobId,
    started_at: new Date().toISOString(),
    finished_at: null,
    error: null,
  };

  // 异步执行部署脚本
  const scriptPath = join(SCRIPTS_DIR, 'dev-deploy.sh');
  const child = execFile('bash', [scriptPath], { timeout: 300000 }, (err, stdout, stderr) => {
    if (err) {
      devDeployState.status = 'failed';
      devDeployState.finished_at = new Date().toISOString();
      devDeployState.error = err.message || 'deploy script failed';
      console.error(`[deploy-dev] 部署失败 job_id=${jobId}:`, err.message);
      console.error('[deploy-dev] stderr:', stderr);
    } else {
      devDeployState.status = 'success';
      devDeployState.finished_at = new Date().toISOString();
      devDeployState.error = null;
      console.log(`[deploy-dev] 部署成功 job_id=${jobId}`);
    }
  });

  child.on('spawn', () => {
    devDeployState.status = 'running';
  });

  res.status(202).json({
    accepted: true,
    job_id: jobId,
    message: 'dev deploy triggered',
    status_url: '/api/brain/deploy/dev/status',
  });
});

/**
 * GET /api/brain/deploy/dev/status
 * 返回最近一次 dev 部署状态
 */
router.get('/deploy/dev/status', (_req, res) => {
  res.json({
    status: devDeployState.status,
    job_id: devDeployState.job_id,
    started_at: devDeployState.started_at,
    finished_at: devDeployState.finished_at,
    error: devDeployState.error,
  });
});

export default router;
