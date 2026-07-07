/**
 * Skill Eval 路由 — POST /upload, GET /:task_id/status, GET /list, GET /config
 */

import { createRequire } from 'module';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import JSZip from 'jszip';
import express from 'express';

const require = createRequire(import.meta.url);
const multer = require('multer');

// 配置读取（每次调用时从 env 读取，支持测试注入）
function getConfig() {
  return {
    MAX_ZIP_MB: parseInt(process.env.MAX_ZIP_MB || '10', 10),
    SKILL_EVAL_PENDING_LIMIT: parseInt(process.env.SKILL_EVAL_PENDING_LIMIT || '20', 10),
    SKILL_EVAL_PROXY_TOKEN: process.env.SKILL_EVAL_PROXY_TOKEN || '',
    EVAL_PROXY_TOKEN: process.env.EVAL_PROXY_TOKEN || '',
    MAX_CONCURRENT_SKILL_EVAL: parseInt(process.env.MAX_CONCURRENT_SKILL_EVAL || '1', 10),
    SKILL_EVAL_TIMEOUT: parseInt(process.env.SKILL_EVAL_TIMEOUT || '1800', 10),
    SKILL_EVAL_STAGING_RETENTION_SUCCESS_DAYS: parseInt(
      process.env.SKILL_EVAL_STAGING_RETENTION_SUCCESS_DAYS || '3', 10
    ),
    SKILL_EVAL_STAGING_RETENTION_FAILURE_DAYS: parseInt(
      process.env.SKILL_EVAL_STAGING_RETENTION_FAILURE_DAYS || '14', 10
    ),
  };
}

/**
 * Token 验证中间件
 */
function tokenAuth(req, res, next) {
  const token = req.headers['x-eval-proxy-token'];
  const cfg = getConfig();
  const validTokens = [cfg.SKILL_EVAL_PROXY_TOKEN, cfg.EVAL_PROXY_TOKEN].filter(Boolean);

  if (!token || !validTokens.some(t => t === token)) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  next();
}

/**
 * 验证 zip 文件（六件套硬校验）
 * 返回 { ok: true } 或 { ok: false, status: number, error: string }
 */
async function validateZip(buffer) {
  const cfg = getConfig();
  const MAX_ZIP_MB = cfg.MAX_ZIP_MB;

  // a. zip 魔数检查
  if (
    buffer.length < 4 ||
    buffer[0] !== 0x50 ||
    buffer[1] !== 0x4b ||
    buffer[2] !== 0x03 ||
    buffer[3] !== 0x04
  ) {
    return { ok: false, status: 400, error: 'Invalid zip: magic bytes check failed, not a valid zip file' };
  }

  // b. 大小检查
  if (buffer.length > MAX_ZIP_MB * 1024 * 1024) {
    return { ok: false, status: 400, error: `zip exceeds MAX_ZIP_MB limit of ${MAX_ZIP_MB}MB` };
  }

  // f. 路径穿越（在解压前，在原始 buffer 层面检测）
  if (buffer.includes('../')) {
    return { ok: false, status: 400, error: 'Invalid zip: path traversal detected' };
  }

  // 解压验证
  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (e) {
    return { ok: false, status: 400, error: 'Invalid zip: failed to parse zip file' };
  }

  const entries = Object.values(zip.files).filter(f => !f.dir);
  const entryNames = Object.keys(zip.files);

  // c. 文件数量检查
  if (entryNames.length > 2000) {
    return { ok: false, status: 400, error: `zip file count ${entryNames.length} exceeds limit of 2000` };
  }

  // d. 压缩比检查
  let totalUncompressedSize = 0;
  for (const entry of Object.values(zip.files)) {
    if (!entry.dir) {
      const content = await entry.async('nodebuffer');
      totalUncompressedSize += content.length;
    }
  }
  const ratio = totalUncompressedSize / buffer.length;
  if (ratio > 100) {
    return { ok: false, status: 400, error: `zip compression ratio ${ratio.toFixed(1)}:1 exceeds limit of 100:1, possible zip bomb` };
  }

  // e. SKILL.md 唯一性检查（所有层级）
  const skillMdEntries = entryNames.filter(name => {
    const parts = name.split('/');
    return parts[parts.length - 1] === 'SKILL.md';
  });
  if (skillMdEntries.length === 0) {
    return { ok: false, status: 400, error: 'zip must contain exactly one SKILL.md file' };
  }
  if (skillMdEntries.length > 1) {
    return { ok: false, status: 400, error: `zip contains ${skillMdEntries.length} SKILL.md files, expected exactly 1` };
  }

  return { ok: true };
}

/**
 * 创建 Skill Eval 路由器
 */
export function createSkillEvalRouter({ db }) {
  const router = express.Router();
  const upload = multer({ storage: multer.memoryStorage() });

  // POST /upload
  router.post('/upload', tokenAuth, upload.single('file'), async (req, res) => {
    try {
      const buffer = req.file?.buffer;
      if (!buffer) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      // 硬校验
      const validation = await validateZip(buffer);
      if (!validation.ok) {
        return res.status(validation.status).json({ error: validation.error });
      }

      // 计算 hash（支持测试用 X-Test-Force-Hash 头）
      const forceHash = req.headers['x-test-force-hash'];
      const zipHash = (forceHash && forceHash.trim())
        ? forceHash.trim()
        : createHash('sha256').update(buffer).digest('hex');

      // hash 去重查询
      const existing = await db.oneOrNone(
        `SELECT task_id, status, report_url FROM skill_eval_tasks
         WHERE zip_hash = $1
           AND status IN ('running', 'pending', 'in_progress', 'completed')
         ORDER BY created_at DESC LIMIT 1`,
        [zipHash]
      );

      if (existing) {
        if (existing.status === 'completed') {
          return res.status(200).json({ status: 'duplicate', report_url: existing.report_url });
        } else {
          return res.status(200).json({ status: 'merged', task_id: existing.task_id });
        }
      }

      // 背压检查
      const cfg = getConfig();
      const { pending_count } = await db.one(
        `SELECT COUNT(*) as pending_count FROM skill_eval_tasks WHERE status = 'pending'`
      );
      if (parseInt(pending_count) >= cfg.SKILL_EVAL_PENDING_LIMIT) {
        return res.status(429).json({ error: '排队已满' });
      }

      // 建 task
      const taskId = uuidv4();
      const skillName = req.body.skill_name || 'unknown';
      const platform = req.body.platform || 'unknown';
      const submitter = req.body.submitter || null;

      // 计算队列位置
      const { queue_pos } = await db.one(
        `SELECT COUNT(*) as queue_pos FROM skill_eval_tasks WHERE status = 'pending'`
      );

      await db.none(
        `INSERT INTO skill_eval_tasks
           (task_id, zip_hash, skill_name, platform, submitter, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'pending', NOW(), NOW())`,
        [taskId, zipHash, skillName, platform, submitter]
      );

      return res.status(201).json({
        task_id: taskId,
        position: parseInt(queue_pos) + 1,
      });
    } catch (err) {
      console.error('[skill-evals] upload error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /:task_id/status
  router.get('/:task_id/status', async (req, res) => {
    try {
      const { task_id } = req.params;
      const row = await db.oneOrNone(
        `SELECT task_id, status, skill_name, platform, report_url, failure_reason,
                pending_reason, created_at, started_at, completed_at
         FROM skill_eval_tasks WHERE task_id = $1`,
        [task_id]
      );
      if (!row) {
        return res.status(404).json({ error: 'Task not found' });
      }
      return res.status(200).json(row);
    } catch (err) {
      console.error('[skill-evals] status error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /list
  router.get('/list', async (req, res) => {
    try {
      const rows = await db.manyOrNone(
        `SELECT task_id, status, skill_name, platform, submitter, report_url,
                created_at, started_at, completed_at
         FROM skill_eval_tasks
         ORDER BY created_at DESC LIMIT 20`
      );
      return res.status(200).json(rows || []);
    } catch (err) {
      console.error('[skill-evals] list error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}

/**
 * GET /api/brain/config handler 工厂
 */
export function getSkillEvalConfigHandler() {
  return (req, res) => {
    const cfg = getConfig();
    return res.status(200).json({
      MAX_ZIP_MB: cfg.MAX_ZIP_MB,
      SKILL_EVAL_TIMEOUT: cfg.SKILL_EVAL_TIMEOUT,
      MAX_CONCURRENT_SKILL_EVAL: cfg.MAX_CONCURRENT_SKILL_EVAL,
      SKILL_EVAL_PENDING_LIMIT: cfg.SKILL_EVAL_PENDING_LIMIT,
      SKILL_EVAL_STAGING_RETENTION_SUCCESS_DAYS: cfg.SKILL_EVAL_STAGING_RETENTION_SUCCESS_DAYS,
      SKILL_EVAL_STAGING_RETENTION_FAILURE_DAYS: cfg.SKILL_EVAL_STAGING_RETENTION_FAILURE_DAYS,
    });
  };
}
