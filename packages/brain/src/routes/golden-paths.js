/**
 * /api/brain/golden-paths — GP 蓝图级实体 CRUD + 状态机流转
 *
 * GET  /api/brain/golden-paths?status=   列表（支持 ?status= 筛选）
 * POST /api/brain/golden-paths           建 candidate
 * PATCH /api/brain/golden-paths/:id      状态机内部流转（非法流转 → 422）
 *
 * select/approve/veto 三个拍板端点在 T7 实现，不在本文件。
 * 依据 decisions cb6be3f6/b416bfb3，数据模型见 migrations/334_golden_paths.sql。
 */
import { Router } from 'express';
import pool from '../db.js';

const router = Router();

const VALID_STATUSES = new Set([
  'candidate', 'proposed', 'converged', 'approved', 'in_dev',
  'delivered', 'expired', 'rejected', 'blocked_gate', 'superseded',
]);

const VALID_SOURCES = new Set(['strategist', 'alex_direct', 'capture_triage']);

/**
 * 合法状态流转表（from → Set<to>）。
 * select/approve/veto 对应的流转由 T7 端点直接写，这里不重复定义。
 * PATCH 只允许内部/系统流转（tick job、gp-shelf-life 等调用）。
 */
const ALLOWED_TRANSITIONS = new Map([
  ['candidate',     new Set(['proposed', 'superseded'])],
  ['proposed',      new Set(['converged', 'rejected', 'superseded'])],
  ['converged',     new Set(['approved', 'rejected', 'superseded'])],
  ['approved',      new Set(['in_dev', 'expired', 'blocked_gate', 'superseded'])],
  ['in_dev',        new Set(['delivered', 'blocked_gate', 'superseded'])],
  ['delivered',     new Set(['superseded'])],
  ['expired',       new Set(['proposed', 'superseded'])],
  ['rejected',      new Set(['candidate', 'superseded'])],
  ['blocked_gate',  new Set(['approved', 'rejected', 'superseded'])],
  ['superseded',    new Set()],
]);

// ─── GET /api/brain/golden-paths ────────────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const { status, source, limit = 50, offset = 0 } = req.query;
    const conditions = [];
    const values = [];

    if (status) {
      if (!VALID_STATUSES.has(status)) {
        return res.status(400).json({ error: `invalid status: ${status}` });
      }
      values.push(status);
      conditions.push(`status = $${values.length}`);
    }
    if (source) {
      if (!VALID_SOURCES.has(source)) {
        return res.status(400).json({ error: `invalid source: ${source}` });
      }
      values.push(source);
      conditions.push(`source = $${values.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    values.push(parseInt(limit, 10) || 50);
    values.push(parseInt(offset, 10) || 0);

    const { rows } = await pool.query(
      `SELECT * FROM golden_paths
       ${where}
       ORDER BY created_at DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list golden_paths', details: err.message });
  }
});

// ─── POST /api/brain/golden-paths ───────────────────────────────────────────

router.post('/', async (req, res) => {
  try {
    const {
      title,
      one_liner,
      journey_id = null,
      kr_id = null,
      est_scale = null,
      source = 'strategist',
      proposal_doc = null,
      demo_url = null,
      auto_release = false,
      veto_deadline = null,
    } = req.body || {};

    if (!title || !one_liner) {
      return res.status(400).json({ error: 'title and one_liner are required' });
    }
    if (!VALID_SOURCES.has(source)) {
      return res.status(400).json({ error: `invalid source: ${source}` });
    }

    const { rows } = await pool.query(
      `INSERT INTO golden_paths
         (title, one_liner, journey_id, kr_id, est_scale, source,
          proposal_doc, demo_url, auto_release, veto_deadline)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [title, one_liner, journey_id, kr_id, est_scale, source,
       proposal_doc, demo_url, auto_release, veto_deadline],
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create golden_path', details: err.message });
  }
});

// ─── PATCH /api/brain/golden-paths/:id ──────────────────────────────────────
// 状态机内部流转（tick job / gp-shelf-life 用）；非法流转 → 422
// Body: { status, status_reason?, approved_at?, review_after?, proposal_task_id? }

router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      status: newStatus,
      status_reason = null,
      approved_at = null,
      review_after = null,
      proposal_task_id = null,
      proposal_doc = null,
      demo_url = null,
      findings_log = null,
      auto_release = null,
      veto_deadline = null,
      judgment_refs = null,
    } = req.body || {};

    const current = await pool.query(
      'SELECT * FROM golden_paths WHERE id = $1',
      [id],
    );
    if (current.rows.length === 0) {
      return res.status(404).json({ error: 'golden_path not found' });
    }
    const row = current.rows[0];

    if (newStatus) {
      if (!VALID_STATUSES.has(newStatus)) {
        return res.status(400).json({ error: `invalid status: ${newStatus}` });
      }
      const allowed = ALLOWED_TRANSITIONS.get(row.status) ?? new Set();
      if (!allowed.has(newStatus)) {
        return res.status(422).json({
          error: `illegal transition: ${row.status} → ${newStatus}`,
          allowed: [...allowed],
        });
      }
    }

    const setClauses = ['updated_at = NOW()'];
    const values = [];

    const maybeSet = (col, val) => {
      if (val !== null && val !== undefined) {
        values.push(val);
        setClauses.push(`${col} = $${values.length}`);
      }
    };

    maybeSet('status', newStatus);
    maybeSet('status_reason', status_reason);
    maybeSet('approved_at', approved_at);
    maybeSet('review_after', review_after);
    maybeSet('proposal_task_id', proposal_task_id);
    maybeSet('proposal_doc', proposal_doc);
    maybeSet('demo_url', demo_url);
    maybeSet('auto_release', auto_release);
    maybeSet('veto_deadline', veto_deadline);

    if (findings_log !== null) {
      values.push(JSON.stringify(findings_log));
      setClauses.push(`findings_log = $${values.length}::jsonb`);
    }
    if (judgment_refs !== null) {
      values.push(judgment_refs);
      setClauses.push(`judgment_refs = $${values.length}`);
    }

    values.push(id);
    const { rows } = await pool.query(
      `UPDATE golden_paths SET ${setClauses.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values,
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update golden_path', details: err.message });
  }
});

export default router;
