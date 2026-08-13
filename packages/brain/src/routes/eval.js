/**
 * eval.js — Skill Evaluator 上传与状态查询路由
 * Sprint: 07072314-skill-eval-service
 *
 * 端点：
 *   POST /api/skill-eval/upload  — 上传 zip（需 X-Eval-Proxy-Token）
 *   GET  /api/skill-eval/status/:task_id — 查询评估状态（不需 token）
 *
 * 铁律：
 * - X-Eval-Proxy-Token 从 env EVAL_PROXY_TOKEN 校验
 * - 凭据不进日志、不进 git
 * - 上传限制 MAX_ZIP_MB（env，default 10）
 * - zip 硬校验（魔数/解压/压缩比/SKILL.md/路径穿越）
 * - hash 去重幂等
 * - pending ≥ MAX_SKILL_EVAL_QUEUE → 429
 */

import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import pool from '../db.js';
import { createTask } from '../actions.js';
import {
  validateZipBuffer,
  computeZipHash,
  checkZipDuplication,
  checkSlotAvailable,
  getEvalQueuePosition,
} from '../skill-eval-validator.js';
import { renderReportHtml } from '../skill-eval-report-render.js';

const router = Router();

// ─── 配置 ──────────────────────────────────────────────────────────────────

const MAX_ZIP_MB = parseInt(process.env.MAX_ZIP_MB || '10', 10);
const MAX_ZIP_BYTES = MAX_ZIP_MB * 1024 * 1024;
const SKILL_EVAL_STAGING_DIR = process.env.SKILL_EVAL_STAGING_DIR || '/tmp/skill-eval-staging';

// ─── 鉴权中间件 ───────────────────────────────────────────────────────────

function requireEvalProxyToken(req, res, next) {
  const evalProxyToken = process.env.EVAL_PROXY_TOKEN || '';
  const token = req.headers['x-eval-proxy-token'];

  if (!evalProxyToken) {
    // 未配置 token（开发环境降级）
    console.warn('[skill-eval] EVAL_PROXY_TOKEN not set — auth disabled (dev mode)');
    return next();
  }

  if (!token || token !== evalProxyToken) {
    return res.status(403).json({
      error: 'forbidden: invalid or missing X-Eval-Proxy-Token',
    });
  }

  next();
}

// ─── multer 内存存储（先校验再落盘）────────────────────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_ZIP_BYTES,
  },
  fileFilter: (_req, file, cb) => {
    // 基本扩展名检查（主校验在 validateZipBuffer 中）
    if (!file.originalname.toLowerCase().endsWith('.zip')) {
      return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'file must be a .zip'));
    }
    cb(null, true);
  },
});

// ─── POST /api/skill-eval/upload ─────────────────────────────────────────

router.post(
  '/upload',
  requireEvalProxyToken,
  (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({
              error: `file too large: max ${MAX_ZIP_MB}MB allowed`,
            });
          }
          return res.status(422).json({ error: err.message });
        }
        return next(err);
      }
      next();
    });
  },
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'no file uploaded (field name: file)' });
      }

      const { skill_name, platform, journey_id, submitter } = req.body;

      if (!skill_name || !skill_name.trim()) {
        return res.status(400).json({ error: 'skill_name is required' });
      }

      const buf = req.file.buffer;

      // 1. zip 硬校验
      const validation = await validateZipBuffer(buf);
      if (!validation.valid) {
        return res.status(422).json({ error: validation.error });
      }

      // 2. 计算 hash
      const zipHash = computeZipHash(buf);

      // 3. 去重检查
      const dupResult = await checkZipDuplication(pool, zipHash);
      if (dupResult.isDuplicate) {
        if (dupResult.status === 'completed') {
          return res.json({
            task_id: dupResult.task_id,
            queue_position: 0,
            report_url: dupResult.report_url,
            deduped: true,
            message: '该 zip 已评估完成，返回历史报告',
          });
        }
        // pending / running → 合流
        return res.json({
          task_id: dupResult.task_id,
          queue_position: null,
          deduped: true,
          message: '该 zip 已在队列中或正在评估',
        });
      }

      // 4. 背压检查
      const slotCheck = await checkSlotAvailable(pool);
      if (slotCheck.queueFull) {
        return res.status(429).json({
          error: '排队已满，请稍后重试 (queue full: too many pending evaluations)',
        });
      }

      // 5. 落盘 staging
      let stagingPath = null;
      try {
        await fs.promises.mkdir(SKILL_EVAL_STAGING_DIR, { recursive: true });
        const filename = `${Date.now()}-${zipHash.slice(0, 8)}.zip`;
        stagingPath = path.join(SKILL_EVAL_STAGING_DIR, filename);
        await fs.promises.writeFile(stagingPath, buf);
      } catch (fsErr) {
        console.error('[skill-eval] staging write failed:', fsErr.message);
        return res.status(500).json({ error: 'failed to stage uploaded file' });
      }

      // 6. 建 task + skill_evals 行
      const _slugName = (skill_name || 'unknown')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .slice(0, 50);

      // 建 tasks + Routing Receipt（同一原子任务入口）
      const taskResult = await createTask({
        task_type: 'skill_eval',
        status: 'pending',
        title: `Skill Eval: ${skill_name}`,
        payload: {
          skill_name: skill_name.trim(),
          source_platform: platform || null,
          journey_id: journey_id || null,
          submitter: submitter || null,
          zip_hash: zipHash,
          staging_path: stagingPath,
        },
        trigger_source: 'skill_eval_api',
        source: 'api',
        source_id: `skill-eval:${zipHash}`,
        allow_unscoped: true,
        db: pool,
      });
      const taskId = taskResult.task.id;

      // 建 skill_evals 行
      await pool.query(
        `INSERT INTO skill_evals
           (task_id, zip_hash, skill_name, source_platform, submitter, status, staging_path, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'pending', $6, now(), now())`,
        [
          taskId,
          zipHash,
          skill_name.trim(),
          platform || null,
          submitter || null,
          stagingPath,
        ]
      );

      // 7. 计算队列位次
      const queuePosition = await getEvalQueuePosition(pool, taskId);

      return res.json({
        task_id: taskId,
        queue_position: queuePosition,
        message: `已进入评估队列，前面还有 ${Math.max(0, (queuePosition || 1) - 1)} 个任务`,
      });
    } catch (err) {
      console.error('[skill-eval] upload error:', err.message);
      return res.status(500).json({ error: `internal server error: ${err.message}` });
    }
  }
);

// ─── GET /api/skill-eval/status/:task_id ─────────────────────────────────

router.get('/status/:task_id', async (req, res) => {
  try {
    const { task_id } = req.params;

    if (!task_id) {
      return res.status(400).json({ error: 'task_id required' });
    }

    const result = await pool.query(
      `SELECT
         se.task_id::text,
         se.status,
         se.report_url,
         se.failure_reason,
         se.queue_position,
         se.created_at,
         se.updated_at
       FROM skill_evals se
       WHERE se.task_id = $1
       LIMIT 1`,
      [task_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'task not found' });
    }

    const row = result.rows[0];

    // 动态计算队列位次（pending 状态时）
    let queuePosition = row.queue_position;
    if (row.status === 'pending') {
      queuePosition = await getEvalQueuePosition(pool, task_id);
    } else if (row.status === 'running') {
      queuePosition = 0;
    } else {
      queuePosition = null;
    }

    return res.json({
      task_id: row.task_id,
      status: row.status,
      queue_position: queuePosition,
      report_url: row.status === 'completed' ? row.report_url : null,
      failure_reason: row.status === 'failed' ? row.failure_reason : null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
  } catch (err) {
    console.error('[skill-eval] status query error:', err.message);
    return res.status(500).json({ error: `internal server error: ${err.message}` });
  }
});

// ─── GET /api/skill-eval/report/:task_id ──────────────────────────────────

router.get('/report/:task_id', async (req, res) => {
  try {
    const { task_id } = req.params;
    const result = await pool.query(
      `SELECT report_data FROM skill_evals WHERE task_id = $1 LIMIT 1`,
      [task_id]
    );
    if (result.rows.length === 0 || !result.rows[0].report_data) {
      return res.status(404).json({ error: '报告未就绪或任务不存在' });
    }
    const reportData = result.rows[0].report_data;
    if (req.query.format === 'json') return res.json(reportData);
    res.set('Content-Type', 'text/html; charset=utf-8');
    return res.send(renderReportHtml(reportData));
  } catch (err) {
    console.error('[skill-eval] report error:', err.message);
    return res.status(500).json({ error: `internal server error: ${err.message}` });
  }
});

// ─── GET /api/skill-eval/staging/:task_id（内部：worker 拉取 zip 内容）─────
// Brain 跑在 Docker 容器里，上传的 zip 落盘在容器内的 SKILL_EVAL_STAGING_DIR；
// 常驻 worker（pm2）跑在宿主机，两者不共享文件系统，worker 不能直接 fs.readFile
// staging_path。worker 改走这个内部 HTTP 端点拉取 zip 字节，由 Brain（容器内）
// 自己读自己的文件再把内容传出去。

router.get('/staging/:task_id', requireEvalProxyToken, async (req, res) => {
  try {
    const { task_id } = req.params;
    const result = await pool.query(
      `SELECT staging_path FROM skill_evals WHERE task_id = $1 LIMIT 1`,
      [task_id]
    );
    if (result.rows.length === 0 || !result.rows[0].staging_path) {
      return res.status(404).json({ error: 'task not found or staging_path missing' });
    }
    let buf;
    try {
      buf = await fs.promises.readFile(result.rows[0].staging_path);
    } catch (readErr) {
      return res.status(404).json({ error: `staging file not found: ${readErr.message}` });
    }
    res.set('Content-Type', 'application/zip');
    return res.send(buf);
  } catch (err) {
    console.error('[skill-eval] staging download error:', err.message);
    return res.status(500).json({ error: `internal server error: ${err.message}` });
  }
});

// ─── POST /api/skill-eval/complete（内部回调，发布脚本调用）──────────────────

router.post('/complete', requireEvalProxyToken, async (req, res) => {
  try {
    const { task_id, report_url, report_data } = req.body;

    if (!task_id || !report_url) {
      return res.status(400).json({ error: 'task_id and report_url required' });
    }

    // 回写 skill_evals（report_data body 传了才写，未传保留原值）
    await pool.query(
      `UPDATE skill_evals
       SET status = 'completed',
           report_url = $1,
           report_data = COALESCE($2::jsonb, report_data),
           updated_at = now()
       WHERE task_id = $3`,
      [report_url, report_data ? JSON.stringify(report_data) : null, task_id]
    );

    // 回写 tasks
    await pool.query(
      `UPDATE tasks
       SET status = 'completed',
           result = jsonb_build_object('report_url', $1::text),
           updated_at = now()
       WHERE id = $2`,
      [report_url, task_id]
    );

    return res.json({ ok: true, task_id, report_url });
  } catch (err) {
    console.error('[skill-eval] complete callback error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
