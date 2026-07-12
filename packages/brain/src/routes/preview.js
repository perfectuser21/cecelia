/**
 * Preview 环境路由
 *
 * POST   /api/brain/preview/start        — 分配端口 + 触发 preview-env-start.sh（完整预览：Brain + 隔离DB + 前端静态）
 * POST   /api/brain/preview/stop/:pr     — 停止预览 + 清理DB + 释放端口
 * GET    /api/brain/preview/status/:pr   — 查询预览状态
 * GET    /api/brain/preview              — 列出所有活跃预览环境
 *
 * 已废弃（向后兼容保留）:
 * POST   /api/brain/preview/allocate     — 仅分配端口
 * DELETE /api/brain/preview/:pr_number   — 旧停止接口
 *
 * E2E 端到端验证于 2026-07-12（PR #3794 合并后）：本 PR 用于触发一次真实预览部署验证。
 */

import { Router } from 'express';
import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pool from '../db.js';
import {
  allocatePreview,
  markPreviewInactive,
  getPreview,
  allocatePort,
} from '../preview-manager.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = process.env.REPO_ROOT || join(__dirname, '../../../../');
const SCRIPTS_DIR = join(REPO_ROOT, 'scripts');

const router = Router();

function checkDeployToken(req, res) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const expected = process.env.DEPLOY_TOKEN;
  if (!expected) return null; // dev 模式放行
  if (!token || token !== expected) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return null;
}

// ── POST /start ──────────────────────────────────────────────────────────────
// 分配端口 + 触发 preview-env-start.sh，立即返回 {port, db_name}
// 启动过程异步进行，可用 GET /status/:pr 轮询
router.post('/start', async (req, res) => {
  if (checkDeployToken(req, res) === false) return;
  const { pr_number, branch_name, base_repo = 'cecelia' } = req.body;
  if (!pr_number || !branch_name) {
    return res.status(400).json({ error: 'pr_number and branch_name are required' });
  }
  const prNum = Number(pr_number);
  try {
    const { port, db_name } = await allocatePreview(prNum, branch_name, base_repo);

    // 异步触发 preview-env-start.sh（不等待完成）
    const startScript = join(SCRIPTS_DIR, 'preview-env-start.sh');
    const child = spawn('bash', [startScript, String(prNum), branch_name, String(port), db_name], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, REPO_ROOT },
    });
    child.unref();

    res.json({ port, db_name, status: 'starting' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /stop/:pr ─────────────────────────────────────────────────────────
// 触发 preview-env-stop.sh，立即返回（异步清理）
router.post('/stop/:pr_number', async (req, res) => {
  if (checkDeployToken(req, res) === false) return;
  const prNumber = parseInt(req.params.pr_number, 10);
  if (isNaN(prNumber)) return res.status(400).json({ error: 'invalid pr_number' });
  try {
    const preview = await getPreview(prNumber);
    if (!preview) return res.json({ stopped: true, note: 'no active preview found' });

    // 异步触发 preview-env-stop.sh
    const stopScript = join(SCRIPTS_DIR, 'preview-env-stop.sh');
    const child = spawn('bash', [stopScript, String(prNumber), String(preview.port), preview.db_name], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, REPO_ROOT },
    });
    child.unref();

    await markPreviewInactive(prNumber);
    res.json({ stopped: true, port: preview.port, db_name: preview.db_name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /status/:pr ────────────────────────────────────────────────────────
router.get('/status/:pr_number', async (req, res) => {
  const prNumber = parseInt(req.params.pr_number, 10);
  if (isNaN(prNumber)) return res.status(400).json({ error: 'invalid pr_number' });
  try {
    const preview = await getPreview(prNumber);
    if (!preview) return res.status(404).json({ error: 'not found' });
    res.json(preview);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET / ──────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM preview_environments WHERE status != 'inactive' ORDER BY created_at DESC`,
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 向后兼容 ────────────────────────────────────────────────────────────────
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

router.delete('/:pr_number', async (req, res) => {
  const prNumber = parseInt(req.params.pr_number, 10);
  if (isNaN(prNumber)) return res.status(400).json({ error: 'invalid pr_number' });
  try {
    const preview = await getPreview(prNumber);
    if (preview) {
      const stopScript = join(SCRIPTS_DIR, 'preview-env-stop.sh');
      const child = spawn('bash', [stopScript, String(prNumber), String(preview.port), preview.db_name], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, REPO_ROOT },
      });
      child.unref();
      await markPreviewInactive(prNumber);
    }
    res.json({ stopped: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
