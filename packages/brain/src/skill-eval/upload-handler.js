/**
 * upload-handler.js — Skill Eval 上传处理中间件
 * 职责：令牌验证 / 背压检查 / zip 校验 / SHA-256 去重 / 建 task
 */

import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import pool from '../db.js';
import { validateZip, detectPathTraversal } from './zip-validator.js';

// Re-export detectPathTraversal for tests
export { detectPathTraversal };

// ─── 配置（全来自 env，无硬编码）────────────────────────────────────
const getMaxQueue = () => parseInt(process.env.MAX_SKILL_EVAL_QUEUE || '20', 10);
const getToken = () => process.env.EVAL_PROXY_TOKEN || '';

// ─── B01: 令牌验证中间件 ─────────────────────────────────────────────
export function validateToken(req, res, next) {
  const token = req.headers['x-eval-proxy-token'];
  const expected = getToken();

  if (!token || !expected || token !== expected) {
    return res.status(403).json({ error: 'forbidden', detail: 'invalid or missing X-Eval-Proxy-Token' });
  }
  next();
}

// ─── B02: ZIP 硬校验中间件 ────────────────────────────────────────────
export async function validateZipMiddleware(req, res, next) {
  if (!req.file || !req.file.buffer) {
    return res.status(400).json({ error: 'no_file', detail: 'no file uploaded' });
  }

  try {
    const result = await validateZip(req.file.buffer);
    req.zipMeta = result;
    next();
  } catch (err) {
    const code = err.code || 'zip_error';
    return res.status(400).json({ error: code, detail: err.message });
  }
}

// Re-export validateZip for tests
export { validateZip };

// ─── B06: 背压检查中间件 ─────────────────────────────────────────────
export async function checkBackpressure(req, res, next) {
  const maxQueue = getMaxQueue();

  try {
    const result = await pool.query(
      `SELECT COUNT(*)::int AS count FROM tasks WHERE task_type = 'skill_eval' AND status = 'pending'`
    );
    const pendingCount = parseInt(result.rows[0]?.count || '0', 10);

    if (pendingCount >= maxQueue) {
      return res.status(429).json({
        error: 'queue_full',
        detail: `pending queue ${pendingCount} >= max ${maxQueue}`,
        queue_position: pendingCount,
      });
    }

    req.pendingCount = pendingCount;
    next();
  } catch (err) {
    return res.status(500).json({ error: 'db_error', detail: err.message });
  }
}

// ─── SHA-256 计算 ─────────────────────────────────────────────────────
export function computeHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// ─── B03: 去重检查 + 建 task ─────────────────────────────────────────
export async function handleUpload(req, res) {
  const { skill_name, source_platform, journey_id } = req.body || {};

  if (!skill_name) {
    return res.status(400).json({ error: 'missing_field', detail: 'skill_name is required' });
  }

  const fileBuffer = req.file?.buffer;
  if (!fileBuffer) {
    return res.status(400).json({ error: 'no_file', detail: 'file buffer missing' });
  }

  const sha256 = computeHash(fileBuffer);

  // 去重查询
  const dupResult = await pool.query(
    `SELECT id, status FROM tasks
     WHERE task_type = 'skill_eval'
       AND (payload->>'sha256') = $1
     ORDER BY created_at DESC LIMIT 1`,
    [sha256]
  );

  if (dupResult.rows.length > 0) {
    const existing = dupResult.rows[0];
    if (existing.status === 'completed') {
      return res.status(200).json({
        task_id: existing.id,
        status: 'completed',
        deduplicated: true,
      });
    }
    if (existing.status === 'pending' || existing.status === 'in_progress') {
      return res.status(200).json({
        task_id: existing.id,
        status: existing.status,
        deduplicated: true,
      });
    }
  }

  // 建新 task
  const slug = skill_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const payload = {
    sha256,
    skill_name,
    slug,
    source_platform: source_platform || 'unknown',
    zip_size: fileBuffer.length,
  };

  const insertResult = await pool.query(
    `INSERT INTO tasks (task_type, title, status, journey_id, payload)
     VALUES ('skill_eval', $1, 'pending', $2, $3)
     RETURNING id`,
    [`Skill Eval: ${skill_name}`, journey_id || null, JSON.stringify(payload)]
  );

  const taskId = insertResult.rows[0].id;

  return res.status(201).json({
    task_id: taskId,
    status: 'pending',
    sha256,
  });
}
