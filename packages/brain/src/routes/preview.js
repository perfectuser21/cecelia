/**
 * Preview 环境路由
 *
 * POST   /api/brain/preview/start        — 旧PR预览生产入口，返回410
 * POST   /api/brain/preview/stop/:pr     — 停止预览 + 清理DB + 释放端口
 * GET    /api/brain/preview/status/:pr   — 查询预览状态
 * GET    /api/brain/preview              — 列出所有活跃预览环境
 *
 * 已废弃（向后兼容保留）:
 * POST   /api/brain/preview/allocate     — 旧分配入口，返回410
 * DELETE /api/brain/preview/:pr_number   — 旧停止接口
 */

import { Router } from 'express';
import { spawn, execFileSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pool from '../db.js';
import {
  markPreviewInactive,
  getPreview,
} from '../preview-manager.js';
import { destroyPreview } from '../preview-destroyer.js';
import { readTickDispatchEnabled } from '../tick-dispatch-gate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = process.env.REPO_ROOT || join(__dirname, '../../../../');
const SCRIPTS_DIR = join(REPO_ROOT, 'scripts');

// 启动时读取模块实际所在 worktree；不信任 GIT_SHA 或请求里声称的版本。
const CODE_ROOT = join(__dirname, '../../../../');
let runtimeSha = null;
try {
  const value = execFileSync('git', ['-C', CODE_ROOT, 'rev-parse', 'HEAD'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000,
  }).trim();
  if (/^[a-f0-9]{40}$/.test(value)) runtimeSha = value;
} catch { /* 无源码身份时 /identity 拒绝成功。 */ }

const router = Router();
router.get('/identity', async (_req, res) => {
  if (process.env.BRAIN_PREVIEW !== '1') return res.status(404).json({ error: 'not a preview instance' });
  try {
    if (!runtimeSha) throw new Error('preview code revision unavailable');
    const { rows } = await pool.query('SELECT current_database() AS db_name');
    if (!rows[0]?.db_name) throw new Error('preview database identity unavailable');
    const tick_enabled = await readTickDispatchEnabled(pool);
    res.json({ pr_number: Number(process.env.BRAIN_PREVIEW_PR), git_sha: runtimeSha,
      db_name: rows[0].db_name, tick_enabled });
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

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

// 旧PR Brain预览生产者已退役；保留鉴权与明确HTTP终态，不准入或启动资源。
router.post('/start', (req, res) => {
  if (checkDeployToken(req, res) === false) return;
  res.status(410).json({ error: 'PR_PREVIEW_RETIRED' });
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
router.post('/allocate', (_req, res) => {
  res.status(410).json({ error: 'PR_PREVIEW_RETIRED' });
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
