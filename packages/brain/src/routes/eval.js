/**
 * Skill Evaluator 上传 + 状态查询路由
 * POST /api/eval/upload   — 上传 skill zip，建 skill_eval task
 * GET  /api/eval/tasks/:id — 查询评估状态
 */
import { Router } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import { mkdirSync } from 'fs';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import JSZip from 'jszip';
import pool from '../db.js';

const router = Router();

// NFR 配置（全部从 env 读，禁写死）
const MAX_ZIP_BYTES = parseInt(process.env.MAX_ZIP_MB || '10', 10) * 1024 * 1024;
const MAX_DECOMPRESS_BYTES = parseInt(process.env.MAX_DECOMPRESS_MB || '50', 10) * 1024 * 1024;
const MAX_COMPRESS_RATIO = parseInt(process.env.MAX_COMPRESS_RATIO || '100', 10);
const MAX_FILES = parseInt(process.env.MAX_SKILL_FILES || '2000', 10);
const STAGING_DIR = process.env.SKILL_EVAL_STAGING_DIR || '/tmp/skill-eval-staging';
const EVAL_PROXY_TOKEN = process.env.EVAL_PROXY_TOKEN || '';
const BACKPRESSURE_THRESHOLD = parseInt(process.env.SKILL_EVAL_BACKPRESSURE || '20', 10);

// 确保 staging 目录存在
try { mkdirSync(STAGING_DIR, { recursive: true }); } catch {}

// multer 内存存储（校验后再落盘）
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ZIP_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!file.originalname.toLowerCase().endsWith('.zip')) {
      return cb(new Error('only .zip files accepted'));
    }
    cb(null, true);
  },
});

// 令牌校验中间件（常数时间比较防时序攻击）
function requireProxyToken(req, res, next) {
  const token = req.headers['x-eval-proxy-token'] || '';
  if (!EVAL_PROXY_TOKEN || !token) {
    return res.status(403).json({ error: 'missing or invalid X-Eval-Proxy-Token' });
  }
  try {
    const expected = Buffer.from(EVAL_PROXY_TOKEN);
    const actual = Buffer.from(
      token.length >= EVAL_PROXY_TOKEN.length
        ? token.slice(0, EVAL_PROXY_TOKEN.length)
        : token.padEnd(EVAL_PROXY_TOKEN.length, '\0')
    );
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
      return res.status(403).json({ error: 'missing or invalid X-Eval-Proxy-Token' });
    }
  } catch {
    return res.status(403).json({ error: 'missing or invalid X-Eval-Proxy-Token' });
  }
  next();
}

// zip 魔数检查（PK\x03\x04）
function isValidZipMagic(buf) {
  return buf.length >= 4 &&
    buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
}

// POST /api/eval/upload
router.post('/upload', requireProxyToken, upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(422).json({ error: 'no file uploaded' });

    // 魔数校验
    if (!isValidZipMagic(file.buffer)) {
      return res.status(422).json({
        error: 'validation_failed',
        stage: 'zip_magic_check',
        message: '文件不是有效 ZIP（magic bytes 校验失败）',
      });
    }

    // 解压校验（大小/压缩比/文件数/SKILL.md/路径穿越）
    let zip;
    try {
      zip = await JSZip.loadAsync(file.buffer);
    } catch (e) {
      return res.status(422).json({ error: 'cannot parse zip: ' + e.message });
    }

    const entries = Object.values(zip.files);
    if (entries.length > MAX_FILES) {
      return res.status(422).json({
        error: 'validation_failed',
        stage: 'file_count_limit',
        message: `too many files: ${entries.length} > ${MAX_FILES}`,
      });
    }

    let totalDecompressed = 0;
    let skillMdCount = 0;
    for (const entry of entries) {
      if (entry.dir) continue;
      const name = entry.name;
      // 路径穿越拦截
      if (name.includes('..') || name.startsWith('/') || name.includes('\0')) {
        return res.status(422).json({
          error: 'validation_failed',
          stage: 'path_traversal',
          message: `path traversal detected: ${name}`,
        });
      }
      // 检查 SKILL.md（支持顶层或一层目录内）
      const basename = name.includes('/') ? name.split('/').slice(1).join('/') : name;
      if (basename === 'SKILL.md' || name === 'SKILL.md') {
        skillMdCount++;
      }
      // 估算解压大小
      const uncompressedSize = entry._data?.uncompressedSize ?? 0;
      totalDecompressed += uncompressedSize;
    }

    if (skillMdCount !== 1) {
      return res.status(422).json({
        error: 'validation_failed',
        stage: 'skill_md_missing',
        message: `must contain exactly 1 SKILL.md (found ${skillMdCount})`,
      });
    }

    if (totalDecompressed > MAX_DECOMPRESS_BYTES) {
      return res.status(422).json({
        error: 'validation_failed',
        stage: 'decompressed_size',
        message: `decompressed size ${totalDecompressed} > ${MAX_DECOMPRESS_BYTES}`,
      });
    }

    const compressRatio = totalDecompressed / Math.max(file.buffer.length, 1);
    if (compressRatio > MAX_COMPRESS_RATIO) {
      return res.status(422).json({
        error: 'validation_failed',
        stage: 'compression_ratio',
        message: `compression ratio ${compressRatio.toFixed(1)} > ${MAX_COMPRESS_RATIO}`,
      });
    }

    // SHA256 hash（去重键）
    const zipHash = crypto.createHash('sha256').update(file.buffer).digest('hex');

    // 去重检查：命中 completed → 返回历史 report_url
    const { rows: completedRows } = await pool.query(
      "SELECT e.task_id, e.report_url FROM evals e WHERE e.zip_hash = $1 AND e.status = 'completed' LIMIT 1",
      [zipHash]
    );
    if (completedRows.length > 0) {
      return res.json({
        task_id: completedRows[0].task_id,
        status: 'completed',
        report_url: completedRows[0].report_url,
        dedup: true,
        position: 0,
      });
    }

    // 命中 in_progress / queued → 合流返回既有 task_id
    const { rows: activeRows } = await pool.query(
      "SELECT e.task_id FROM evals e WHERE e.zip_hash = $1 AND e.status IN ('queued','in_progress') LIMIT 1",
      [zipHash]
    );
    if (activeRows.length > 0) {
      const { rows: posRows } = await pool.query(
        "SELECT count(*) FROM tasks WHERE task_type='skill_eval' AND status='queued'"
      );
      return res.json({
        task_id: activeRows[0].task_id,
        status: 'queued',
        dedup: true,
        position: parseInt(posRows[0].count, 10),
      });
    }

    // 背压检查
    const { rows: queueRows } = await pool.query(
      "SELECT count(*) FROM tasks WHERE task_type='skill_eval' AND status='queued'"
    );
    const queueDepth = parseInt(queueRows[0].count, 10);
    if (queueDepth >= BACKPRESSURE_THRESHOLD) {
      return res.status(429).json({
        error: 'queue_full',
        message: '排队已满（pending≥20），请稍后重试',
        queue_depth: queueDepth,
      });
    }

    // 落 staging
    const stagingPath = join(STAGING_DIR, `${zipHash}.zip`);
    await writeFile(stagingPath, file.buffer);

    // 元数据
    const skillName = (req.body.skill_name || file.originalname.replace('.zip', '')).trim().slice(0, 100);
    const platform = req.body.platform || 'unknown';
    const line = req.body.line || '';
    const submitter = req.body.submitter || '';

    // 建 task
    const { rows: taskRows } = await pool.query(
      `INSERT INTO tasks (task_type, title, status, payload, priority)
       VALUES ('skill_eval', $1, 'queued', $2, 'P2')
       RETURNING id`,
      [
        `Skill Eval: ${skillName}`,
        JSON.stringify({
          skill_name: skillName,
          platform,
          line,
          submitter,
          zip_hash: zipHash,
          staging_path: stagingPath,
        }),
      ]
    );
    const taskId = taskRows[0].id;

    // 建 eval 记录
    await pool.query(
      `INSERT INTO evals (task_id, skill_name, platform, line, submitter, zip_hash, zip_path, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued')`,
      [taskId, skillName, platform, line, submitter, zipHash, stagingPath]
    );

    return res.json({
      task_id: taskId,
      status: 'queued',
      position: queueDepth + 1,
      dedup: false,
    });
  } catch (err) {
    console.error('[eval/upload] error:', err);
    return res.status(500).json({ error: err.message });
  }
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/eval/tasks/:id
router.get('/tasks/:id', async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) {
    return res.status(404).json({ error: 'task not found' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT e.task_id, e.skill_name, e.platform, e.line, e.submitter,
              e.status, e.report_url, e.failure_stage,
              (SELECT count(*) FROM tasks WHERE task_type='skill_eval' AND status='queued') as queue_depth
       FROM evals e WHERE e.task_id = $1`,
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'task not found' });
    }
    const row = rows[0];
    return res.json({
      task_id: row.task_id,
      status: row.status,
      skill_name: row.skill_name,
      platform: row.platform,
      line: row.line,
      submitted_by: row.submitter,
      position: row.status === 'queued' ? parseInt(row.queue_depth, 10) : 0,
      report_url: row.report_url || null,
      failure_stage: row.failure_stage || null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
