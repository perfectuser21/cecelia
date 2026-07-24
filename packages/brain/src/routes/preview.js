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
 */

import { Router } from 'express';
import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pool from '../db.js';
import {
  markPreviewInactive,
  getPreview,
  allocatePort,
} from '../preview-manager.js';
import { admitPreview } from '../capacity-gate.js';
import { destroyPreview } from '../preview-destroyer.js';

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
    // 唯一调用 admitPreview()（方案A：判定+端口扫描+INSERT 全程包在同一把
    // pg_advisory_xact_lock 事务内），不再单独调用无锁的 allocatePreview()——
    // 消除 admitPreview 判定与端口预留之间的 TOCTOU 竞态窗口（见合同 Risks #2）。
    const admission = await admitPreview(prNum, branch_name, base_repo, pool);
    if (!admission.admitted) {
      return res.status(503).json({
        error: 'preview admission rejected',
        reason: admission.reason,
        free_bytes: admission.free_bytes,
        projected_cost_bytes: admission.projected_cost_bytes,
        need_release_bytes: admission.need_release_bytes,
      });
    }
    const { port, db_name } = admission;

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
// 唯一调用 destroyPreview()（统一销毁器，7 步流程 + 安全防护 + 幂等 + 并发去重），
// 同步等待其终态并直接透出 status/cleanup_detail，不再异步 spawn preview-env-stop.sh。
router.post('/stop/:pr_number', async (req, res) => {
  if (checkDeployToken(req, res) === false) return;
  const prNumber = parseInt(req.params.pr_number, 10);
  if (isNaN(prNumber)) return res.status(400).json({ error: 'invalid pr_number' });
  try {
    const preview = await getPreview(prNumber);
    if (!preview) return res.json({ stopped: true, note: 'no active preview found' });

    const result = await destroyPreview(prNumber, 'api', `stop-${prNumber}-${Date.now()}`, pool);

    res.json({
      stopped: result.destroyed,
      port: preview.port,
      db_name: preview.db_name,
      status: result.status,
      cleanup_detail: result.cleanup_detail ?? null,
    });
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
